// The layer system (rule 613). Recomputes every battlefield object's `chars`
// from its `printed` base by applying active continuous effects in layer order,
// honoring timestamps. M3 implements the layers that matter for the current card
// pool:
//   layer 6  — ability adding (grant keywords: "creatures you control have …")
//   layer 7b — set power/toughness ("base P/T becomes X/Y")
//   layer 7c — counters (+1/+1, -1/-1)
//   layer 7d — modify power/toughness (anthems, lords, until-EOT pumps)
// Layers 1–5 and 7a (copy/control/text/type/color/CDA) are stubbed for now; the
// framework is ordered so they can be slotted in later.

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
    toughness: p.toughness
  }
}

// Does a static ability's `affects` filter match target `o`, given its source?
function matchStatic(affects, source, o) {
  if (!affects) return true
  // An Aura/Equipment affects only the permanent it is attached to.
  if (affects.scope === 'attached') return o.oid === source.status?.attachedTo
  if (affects.scope === 'creatures' && !o.chars.types.includes('Creature')) return false
  if (affects.scope === 'permanents' && o.chars.types.length === 0) return false
  if (affects.self && o.oid !== source.oid) return false
  if (affects.another && o.oid === source.oid) return false
  if (affects.controller === 'you' && o.controller !== source.controller) return false
  if (affects.controller === 'opponent' && o.controller === source.controller) return false
  if (affects.subtype && !o.chars.subtypes.includes(affects.subtype)) return false
  return true
}

// Whether continuous effect `e` applies to object `o`.
function effTargets(e, o) {
  if (e.floating) return e.floating.targets.includes(o.oid)
  return matchStatic(e.ability.affects, e.source, o)
}

// Rebuild chars for all battlefield objects. Pure; mutates object.chars only.
export function recompute(state) {
  const bf = state.zones.battlefield.map((oid) => state.objects[oid])
  for (const o of bf) o.chars = baseChars(o)

  // Collect continuous effects (from static abilities + floating effects) into
  // their layers.
  const layer4 = [] // add types/subtypes (e.g. Kenku Artificer animating an artifact)
  const layer6 = []
  const layer7b = []
  const layer7d = []
  for (const src of bf) {
    for (const ab of src.behavior?.static || []) {
      const e = { source: src, ability: ab, timestamp: src.timestamp || 0 }
      if (ab.grantKeywords) layer6.push(e)
      if (ab.setPT) layer7b.push(e)
      if (ab.modifyPT) layer7d.push(e)
    }
  }
  for (const f of state.continuous) {
    const e = { floating: f, timestamp: f.timestamp }
    if (f.addTypes || f.addSubtypes) layer4.push(e)
    if (f.grantKeywords) layer6.push(e)
    if (f.setPT) layer7b.push(e)
    if (f.modifyPT) layer7d.push(e)
  }

  const byTimestamp = (a, b) => a.timestamp - b.timestamp

  // Layer 4 — add types / subtypes (turning an artifact into a creature, etc.).
  for (const e of layer4.sort(byTimestamp)) {
    for (const o of bf) {
      if (!effTargets(e, o)) continue
      for (const t of e.floating.addTypes || []) if (!o.chars.types.includes(t)) o.chars.types.push(t)
      for (const t of e.floating.addSubtypes || []) if (!o.chars.subtypes.includes(t)) o.chars.subtypes.push(t)
    }
  }

  // Layer 6 — grant keywords.
  for (const e of layer6.sort(byTimestamp)) {
    const kws = e.ability?.grantKeywords || e.floating?.grantKeywords
    for (const o of bf) {
      if (!effTargets(e, o)) continue
      for (const kw of kws) if (!o.chars.keywords.includes(kw)) o.chars.keywords.push(kw)
    }
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

  // Layer 7d — modify P/T (anthems, lords, pumps).
  for (const e of layer7d.sort(byTimestamp)) {
    const m = e.ability?.modifyPT || e.floating?.modifyPT
    for (const o of bf) {
      if (!effTargets(e, o) || o.chars.power == null) continue
      o.chars.power += m.power
      o.chars.toughness += m.toughness
    }
  }
}
