// The layer system (rule 613). Recomputes every battlefield object's `chars`
// from its `printed` base by applying active continuous effects in layer order,
// honoring timestamps and dependencies:
//   layer 3  — text-changing (a land's basic land type is replaced: Spreading Seas)
//   layer 4  — add types/subtypes (Kenku Artificer animating an artifact)
//   layer 5  — color-changing ("target creature becomes black", e.g. Aphotic Wisps)
//   layer 6  — ability adding/removing (grant keywords; "loses all abilities")
//   layer 7a — characteristic-defining P/T ("*/* equal to …", e.g. Nightmare)
//   layer 7b — set power/toughness ("base P/T becomes X/Y")
//   layer 7c — counters (+1/+1, -1/-1)
//   layer 7d — modify power/toughness (anthems, lords, until-EOT pumps)
// Layer 1 (copy) is applied at enter-time by rewriting the object's copiable
// `printed` base (see engine._applyCopy for Clone), so `baseChars` already reflects
// a copy here. Layer 2 (control) is tracked on state.continuous and reverted by
// engine._expireEffects.
//
// Within a layer, effects apply in timestamp order (613.7) unless one depends on
// another (613.8): if applying A would change what B applies to, A is applied
// first regardless of timestamps.

function baseChars(o) {
  const p = o.printed
  return {
    name: p.name,
    types: [...p.types],
    subtypes: [...p.subtypes],
    supertypes: [...p.supertypes],
    colors: [...p.colors],
    keywords: [...p.keywords],
    protections: [...(p.protections || [])],
    power: p.power,
    toughness: p.toughness,
    lostAbilities: false
  }
}

// Does a set of characteristics have a subtype? Changeling (702.73) is every
// creature type.
export const hasSub = (c, st) => !!c && (!!c.subtypes?.includes(st) || !!c.keywords?.includes('Changeling'))

// Does a static ability's `affects` filter match target `o`, given its source?
// Exported so the engine can reuse the same scope semantics for rule-modifying
// static effects (rule 613.11) — "can't attack/block" restrictions, etc.
export function matchStatic(affects, source, o) {
  if (!affects) return true
  // An Aura/Equipment affects only the permanent it is attached to.
  if (affects.scope === 'attached') return o.oid === source.status?.attachedTo
  if (affects.scope === 'creatures' && !o.chars.types.includes('Creature')) return false
  if (affects.scope === 'permanents' && o.chars.types.length === 0) return false
  if (affects.type && !o.chars.types.includes(affects.type)) return false
  if (affects.nonbasic && o.chars.supertypes.includes('Basic')) return false
  if (affects.self && o.oid !== source.oid) return false
  if (affects.token && !o.token) return false // "creature tokens you control"
  if (affects.another && o.oid === source.oid) return false
  if (affects.controller === 'you' && o.controller !== source.controller) return false
  if (affects.controller === 'opponent' && o.controller === source.controller) return false
  if (affects.subtype && !hasSub(o.chars, affects.subtype)) return false
  // "…of the chosen type" (Adaptive Automaton): match the value chosen as the
  // source entered (source.chosen). Until a value is chosen, nothing matches.
  if (affects.chosenSubtype && !(source.chosen && o.chars.subtypes.includes(source.chosen))) return false
  return true
}

// The game-state quantity a characteristic-defining P/T is equal to (rule 613.7a).
function cdaCount(state, o, name) {
  const bf = state.zones.battlefield.map((oid) => state.objects[oid])
  if (name === 'swampsYouControl')
    return bf.filter((t) => t.controller === o.controller && t.chars.subtypes.includes('Swamp')).length
  if (name === 'cardsInYourHand') return (state.zones[o.controller + ':hand'] || []).length
  if (name === 'cardsInAllGraveyards')
    return Object.keys(state.zones)
      .filter((k) => k.endsWith(':graveyard'))
      .reduce((sum, k) => sum + state.zones[k].length, 0)
  return 0
}

// Whether continuous effect `e` applies to object `o`.
function effTargets(e, o) {
  if (e.floating) return e.floating.targets.includes(o.oid)
  return matchStatic(e.ability.affects, e.source, o)
}
const src3 = (e) => e.ability || e.floating

const snapshotChars = (bf) => bf.map((o) => ({ ...o.chars, types: [...o.chars.types], subtypes: [...o.chars.subtypes], colors: [...o.chars.colors], keywords: [...o.chars.keywords], protections: [...o.chars.protections] }))
const restoreChars = (bf, snap) => bf.forEach((o, i) => (o.chars = snap[i]))

// 613.8 dependency ordering within one layer. `apply(e)` applies one effect to
// the current chars of every object it affects.
function applyLayer(effects, bf, apply) {
  const sorted = [...effects].sort((a, b) => a.timestamp - b.timestamp)
  if (sorted.length < 2) {
    for (const e of sorted) apply(e)
    return
  }
  const affectedKey = (e) => bf.filter((o) => effTargets(e, o)).map((o) => o.oid).join()
  const base = new Map(sorted.map((e) => [e, affectedKey(e)]))
  const dependsOn = new Map(sorted.map((e) => [e, new Set()]))
  for (const a of sorted) {
    const snap = snapshotChars(bf)
    apply(a)
    for (const b of sorted) if (b !== a && affectedKey(b) !== base.get(b)) dependsOn.get(b).add(a)
    restoreChars(bf, snap)
  }
  // Topological order (dependencies first), ties by timestamp; a cycle (613.8b)
  // falls back to timestamp order for what's left.
  const done = new Set()
  const out = []
  while (out.length < sorted.length) {
    const ready = sorted.filter((e) => !done.has(e) && [...dependsOn.get(e)].every((d) => done.has(d)))
    const next = ready[0] || sorted.find((e) => !done.has(e))
    done.add(next)
    out.push(next)
  }
  for (const e of out) apply(e)
}

// Rebuild chars for all battlefield objects. Pure; mutates object.chars only.
export function recompute(state) {
  const bf = state.zones.battlefield.map((oid) => state.objects[oid])
  for (const o of bf) o.chars = baseChars(o)

  // Face-down permanents (morph, rule 707.2) are a 2/2 creature with no name,
  // types beyond Creature, colors, or abilities — their real card is hidden.
  for (const o of bf) {
    if (!o.faceDown) continue
    o.chars = { name: '', types: ['Creature'], subtypes: [], supertypes: [], colors: [], keywords: [], protections: [], power: 2, toughness: 2, lostAbilities: false }
  }

  // A bestowed permanent (Nyxborn Hydra cast for its Bestow cost) is an Aura, not a
  // creature, while it stays attached (702.103e) — it has no P/T of its own.
  for (const o of bf) {
    if (o.bestowed && o.status.attachedTo) {
      o.chars.types = o.chars.types.filter((t) => t !== 'Creature')
      if (!o.chars.types.includes('Enchantment')) o.chars.types.push('Enchantment')
      o.chars.power = null
      o.chars.toughness = null
    }
  }

  // "Loses all abilities" (613.1f): a first pass finds who loses them, so their
  // own static abilities contribute nothing below. (Sources that would lose their
  // ability-removing ability themselves are not handled — Humility is an
  // enchantment.)
  const lost = new Set()
  for (const src of bf)
    for (const ab of src.behavior?.static || [])
      if (ab.removeAbilities) for (const o of bf) if (matchStatic(ab.affects, src, o)) lost.add(o.oid)
  for (const f of state.continuous) if (f.removeAbilities) for (const oid of f.targets) lost.add(oid)

  // Collect continuous effects (from static abilities + floating effects) into
  // their layers.
  const layer3 = [] // text-changing (Spreading Seas: "enchanted land is an Island")
  const layer4 = [] // add types/subtypes (e.g. Kenku Artificer animating an artifact)
  const layer5 = [] // color-changing effects
  const layer6 = [] // grant / remove abilities
  const layer7b = []
  const layer7d = []
  // Static abilities come from battlefield permanents and from emblems (114) in
  // the command zone.
  const emblems = state.zones.command.map((oid) => state.objects[oid]).filter((o) => o?.kind === 'emblem')
  for (const src of [...bf, ...emblems]) {
    if (lost.has(src.oid)) continue
    for (const ab of src.behavior?.static || []) {
      // "As long as …" (a conditional static): skipped while its condition is false.
      if (ab.if && state._condFn && !state._condFn(ab.if, src)) continue
      const e = { source: src, ability: ab, timestamp: src.timestamp || 0 }
      if (ab.setSubtypes) layer3.push(e)
      if (ab.addTypes || ab.addSubtypes) layer4.push(e)
      if (ab.setColors) layer5.push(e)
      if (ab.grantKeywords || ab.removeAbilities) layer6.push(e)
      if (ab.setPT) layer7b.push(e)
      if (ab.modifyPT || ab.modifyPTPerCounter) layer7d.push(e)
    }
  }
  for (const f of state.continuous) {
    const e = { floating: f, timestamp: f.timestamp }
    if (f.setSubtypes) layer3.push(e)
    if (f.addTypes || f.addSubtypes) layer4.push(e)
    if (f.setColors) layer5.push(e)
    if (f.grantKeywords || f.removeAbilities) layer6.push(e)
    if (f.setPT) layer7b.push(e)
    if (f.modifyPT) layer7d.push(e)
  }

  const byTimestamp = (a, b) => a.timestamp - b.timestamp

  // Layer 3 — text-changing. The practical case: a land's basic land type is
  // replaced ("enchanted land is an Island"), which swaps what it taps for since
  // mana abilities read the current subtypes.
  applyLayer(layer3, bf, (e) => {
    for (const o of bf) if (effTargets(e, o)) o.chars.subtypes = [...src3(e).setSubtypes]
  })

  // Layer 4 — add types / subtypes (turning an artifact into a creature, etc.).
  applyLayer(layer4, bf, (e) => {
    const d = src3(e)
    for (const o of bf) {
      if (!effTargets(e, o)) continue
      for (const t of d.addTypes || []) if (!o.chars.types.includes(t)) o.chars.types.push(t)
      for (const t of d.addSubtypes || []) if (!o.chars.subtypes.includes(t)) o.chars.subtypes.push(t)
    }
  })

  // Layer 5 — color-changing effects ("becomes black"): replace the object's colors.
  applyLayer(layer5, bf, (e) => {
    for (const o of bf) if (effTargets(e, o)) o.chars.colors = [...src3(e).setColors]
  })

  // Layer 6 — grant keywords / lose all abilities, in timestamp order: a grant
  // after a removal sticks, one before it is lost.
  applyLayer(layer6, bf, (e) => {
    const d = src3(e)
    for (const o of bf) {
      if (!effTargets(e, o)) continue
      if (d.removeAbilities) {
        o.chars.keywords = []
        o.chars.protections = []
        o.chars.lostAbilities = true
      }
      for (const kw of d.grantKeywords || []) if (!o.chars.keywords.includes(kw)) o.chars.keywords.push(kw)
    }
  })

  // Layer 7a — characteristic-defining P/T (Nightmare, Maro): the base P/T is a
  // count derived from game state. Runs before set/counters/modify so those stack.
  for (const o of bf) {
    const cda = o.behavior?.cda
    if (!cda) continue
    const n = cdaCount(state, o, cda.count)
    o.chars.power = n
    o.chars.toughness = n
  }

  // Layer 7b — set base P/T. A targeted floating effect (an animate) establishes
  // P/T even on a permanent that had none; a static "set" only affects things that
  // already have P/T.
  for (const e of layer7b.sort(byTimestamp)) {
    const pt = e.ability?.setPT || e.floating?.setPT
    for (const o of bf) {
      if (!effTargets(e, o)) continue
      if (o.chars.power == null && !e.floating) continue
      o.chars.power = pt.power
      o.chars.toughness = pt.toughness
    }
  }

  // Layer 7c — counters.
  for (const o of bf) {
    if (o.chars.power == null) continue
    const plus = o.status.counters['+1/+1'] || 0
    const minus = o.status.counters['-1/-1'] || 0
    o.chars.power += plus - minus
    o.chars.toughness += plus - minus
  }

  // Layer 7d — modify P/T (anthems, lords, pumps, per-counter Bestow buffs).
  for (const e of layer7d.sort(byTimestamp)) {
    const m = e.ability?.modifyPT || e.floating?.modifyPT
    // "+1/+1 for each +1/+1 counter on this permanent" (bestowed Nyxborn Hydra):
    // the amount is the source's current counter count.
    const perCounter = e.ability?.modifyPTPerCounter
    const n = perCounter ? e.source.status.counters[perCounter] || 0 : 0
    // "+1/+0 for each other creature you control": a count-based amount.
    const amt = (v) => (v && typeof v === 'object' && v.count ? (state._countFn ? state._countFn(e.source, v) : 0) : v)
    const dp = m ? amt(m.power) : n
    const dt = m ? amt(m.toughness) : n
    for (const o of bf) {
      if (!effTargets(e, o) || o.chars.power == null) continue
      o.chars.power += dp
      o.chars.toughness += dt
    }
  }
}
