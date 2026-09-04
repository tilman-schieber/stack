// A simple computer opponent. Given an engine whose pending decision belongs to
// `pid`, `botChoose(engine, pid)` returns an answer for it. Pure heuristics, no
// search: play a land, cast the most expensive useful spell, attack when it is
// safe or lethal, block when it trades well or must, and take the sensible
// default for every other decision. Every answer it produces is something the
// decision offered, so the engine's validation accepts it; `botAnswers` lists a
// fallback per decision kind for the store to try if a heuristic ever misfires.
//
// Reads engine state directly (it runs in the same process as the engine — the
// bot never gets hidden information it shouldn't: it only looks at its own hand,
// the battlefield, graveyards, and the stack).

import { zone, objectsIn } from './state.mjs'
import { recompute } from './layers.mjs'

const HARMFUL = new Set(['destroy', 'dealDamage', 'dealDamageDivided', 'bounce', 'counter', 'tap', 'loseLife', 'exileGraveyard', 'fight', 'mill', 'discard', 'chooseFromHand', 'revealHand', 'discardNamed', 'eachOpponentSacrifices', 'targetPlayerSacrifices', 'gainControl', 'changeTargets', 'restrict', 'goad', 'tapOrUntap'])
const HELPFUL = new Set(['pump', 'grantKeyword', 'addCounter', 'attach', 'regenerate', 'untap', 'returnFromGraveyard', 'returnToBattlefield', 'exileReturnEndStep', 'becomeCreature', 'animate', 'setColors', 'preventNextDamage', 'copySpell', 'createTokenCopy', 'transform'])

const mv = (o) => o?.printed?.manaValue || 0
const isLand = (o) => o?.printed?.types?.includes('Land')
const isCreature = (o) => o?.chars?.types?.includes('Creature') || o?.printed?.types?.includes('Creature')
const power = (o) => o?.chars?.power ?? o?.printed?.power ?? 0
const toughness = (o) => o?.chars?.toughness ?? o?.printed?.toughness ?? 0
// A rough value of a permanent: what we'd hate to lose / love to kill.
const worth = (o) => (isCreature(o) ? power(o) + toughness(o) + mv(o) : mv(o) + 1)

// Does an effect list (a spell's or ability's) hurt whatever it targets?
function intent(effects) {
  const ops = (effects || []).map((e) => e.op)
  if (ops.some((op) => HARMFUL.has(op))) return 'harm'
  if (ops.some((op) => HELPFUL.has(op))) return 'help'
  return 'harm'
}

export function botChoose(engine, pid) {
  const s = engine.state
  const p = s.pending
  if (!p || p.player !== pid) return null
  recompute(s)
  const me = s.players[pid]
  const opps = s.players.filter((q) => q.id !== pid && !q.hasLost)
  const opp = opps.sort((a, b) => a.life - b.life)[0] || null
  const bf = objectsIn(s, 'battlefield')
  const mine = bf.filter((o) => o.controller === pid)
  const theirs = bf.filter((o) => o.controller !== pid)
  const hand = zone(s, 'hand', pid).map((oid) => s.objects[oid])
  const landsInPlay = mine.filter(isLand).length

  // Fixed damage an effect deals to its first target (to prefer kills), or 0.
  const damageOf = (effects) => {
    const d = (effects || []).find((e) => e.op === 'dealDamage' && typeof e.amount === 'number')
    return d ? d.amount : 0
  }
  // Choose a target for one spec, given what the effect does to it.
  const pickTarget = (spec, how, ctxColors, dmg = 0) => {
    const legal = (o) => engine._targetMatches({ kind: 'object', oid: o.oid }, spec, { byPid: pid, sourceColors: ctxColors })
    if (spec.type === 'player') {
      if (spec.controller === 'you') return { kind: 'player', pid }
      if (how === 'help' && spec.controller !== 'opponent') return { kind: 'player', pid }
      return opp ? { kind: 'player', pid: opp.id } : { kind: 'player', pid }
    }
    if (spec.type === 'spell') {
      const top = zone(s, 'stack').map((oid) => s.objects[oid]).reverse().find((o) => o.controller !== pid && !o.isCopy)
      return top ? { kind: 'spell', oid: top.oid } : null
    }
    const pool = spec.controller === 'you' ? mine : spec.controller === 'opponent' ? theirs : how === 'harm' ? [...theirs, ...mine] : [...mine, ...theirs]
    const cands = pool.filter(legal)
    if (!cands.length) {
      if (spec.type === 'any' && how === 'harm' && opp) return { kind: 'player', pid: opp.id }
      return null
    }
    const own = (o) => o.controller === pid
    let best
    if (how === 'harm') {
      // Hurt the opponent's most valuable thing; never our own if there's a choice.
      // Damage goes to something it kills — else to the face when that's allowed.
      let enemy = cands.filter((o) => !own(o))
      if (dmg > 0) {
        const kills = enemy.filter((o) => !isCreature(o) || toughness(o) - (o.status?.damage || 0) <= dmg)
        if (!kills.length && spec.type === 'any' && opp) return { kind: 'player', pid: opp.id }
        if (kills.length) enemy = kills
      }
      if (!enemy.length && spec.controller !== 'you') return spec.type === 'any' && opp ? { kind: 'player', pid: opp.id } : null
      best = (enemy.length ? enemy : cands).sort((a, b) => worth(b) - worth(a))[0]
    } else {
      const own = cands.filter((o) => o.controller === pid)
      best = (own.length ? own : cands).sort((a, b) => worth(b) - worth(a))[0]
    }
    return best ? { kind: 'object', oid: best.oid } : null
  }
  const pickTargets = (specs, how, ctxColors, dmg = 0) => {
    const out = []
    for (const spec of specs || []) {
      const t = pickTarget(spec, how, ctxColors, dmg)
      if (!t) return null
      out.push(t)
    }
    return out
  }
  const colorsOf = (o) => [...(o?.printed?.colors || []), ...(o?.printed?.types || [])]

  switch (p.kind) {
    case 'playOrDraw':
      return { play: true }
    case 'mulligan': {
      const lands = hand.filter(isLand).length
      const keep = p.mulligans >= 2 || (lands >= 2 && lands <= 5)
      return { keep }
    }
    case 'bottom': {
      // Bottom the clunkiest spells (or spare lands when flooded).
      const lands = hand.filter(isLand)
      const spells = hand.filter((o) => !isLand(o)).sort((a, b) => mv(b) - mv(a))
      const order = lands.length > 4 ? [...lands.slice(4), ...spells] : [...spells, ...lands]
      return { bottom: order.slice(0, p.count).map((o) => o.oid) }
    }
    case 'discard':
    case 'discardCards': {
      const n = p.kind === 'discard' ? p.count : Math.min(p.count, p.hand.length)
      if (p.kind === 'discardCards' && p.optional && !p.elseLoseLife) return { discard: [] }
      const cards = p.hand.map((oid) => s.objects[oid])
      const lands = cards.filter(isLand)
      const spells = cards.filter((o) => !isLand(o)).sort((a, b) => mv(b) - mv(a))
      const order = landsInPlay + lands.length > 6 ? [...lands, ...spells] : [...spells, ...lands]
      const want = p.kind === 'discardCards' && p.optional ? 1 : n
      return { discard: order.slice(0, want).map((o) => o.oid) }
    }
    case 'priority':
      return priorityAnswer()
    case 'declareAttackers':
      return attackers()
    case 'declareBlockers':
      return blockers()
    case 'chooseTargets': {
      const src = s.objects[p.sourceOid]
      const eff = p._trigger?.effect || src?.spell?.effect || []
      const how = p._retarget ? 'harm' : intent(eff)
      const t = pickTargets(p.targets, how, colorsOf(src))
      if (!t) return p.optional ? { decline: true } : { targets: fallbackTargets(p.targets, colorsOf(src)) }
      return { targets: t }
    }
    case 'scry': {
      const toBottom = []
      for (const oid of p.cards) {
        const o = s.objects[oid]
        if (isLand(o) ? landsInPlay + hand.filter(isLand).length >= 5 : mv(o) > landsInPlay + 2) toBottom.push(oid)
      }
      return { toBottom, toTop: p.cards.filter((oid) => !toBottom.includes(oid)) }
    }
    case 'search': {
      const cards = p.cards.map((oid) => s.objects[oid])
      const pick = (cards.find((o) => isCreature(o)) || cards.find((o) => isLand(o)) || cards[0])?.oid || null
      return { pick }
    }
    case 'explore':
      return { bin: !isLand(s.objects[p.card]) && mv(s.objects[p.card]) > landsInPlay + 2 }
    case 'mayPay':
      return { pay: !!p.canPay }
    case 'wardPay':
      return { pay: !!p.canPay }
    case 'optionalTrigger':
      return { yes: true }
    case 'orderTriggers':
      return { order: [] }
    case 'madness': {
      if (!p.canPay) return { cast: false }
      const o = s.objects[p.oid]
      if (p.targets?.length) {
        const t = pickTargets(p.targets, intent(o?.behavior?.spell?.effect), colorsOf(o))
        return t ? { cast: true, targets: t } : { cast: false }
      }
      return { cast: true }
    }
    case 'copyEnter': {
      const best = p.choices.map((oid) => s.objects[oid]).sort((a, b) => worth(b) - worth(a))[0]
      return { copy: best ? best.oid : null }
    }
    case 'chooseValue':
      return { value: p.options?.[0] }
    case 'chooseName': {
      const names = (p.suggestions || []).filter((n) => {
        const o = Object.values(s.objects).find((x) => x.printed?.name === n)
        return o && !isLand(o)
      })
      return { name: names[0] || 'Lightning Bolt' }
    }
    case 'dredge':
      return {}
    case 'proliferate':
      return { picks: p.choices.filter((c) => (c.kind === 'object' ? s.objects[c.oid]?.controller === pid : c.pid === pid || c.counters?.poison)).map((c) => (c.kind === 'object' ? { oid: c.oid } : { pid: c.pid })) }
    case 'mutateOrder':
      return { onTop: true }
    case 'legendChoice':
      return { keep: p.choices[0] }
    case 'chooseProtector':
      return { pid: p.choices[0]?.pid }
    case 'orderBlockers':
      return { order: {} }
    case 'bandDamage':
      return { assignment: Object.fromEntries(p.members.map((m, i) => [m.oid, i === 0 ? p.blocker.power : 0])) }
    case 'sacrificeChoice': {
      if (p.optional && p.elseLoseLife && me.life > 6) return { sacrifice: [] }
      const cheapest = p.choices.map((oid) => s.objects[oid]).sort((a, b) => worth(a) - worth(b))
      return { sacrifice: cheapest.slice(0, p.count).map((o) => o.oid) }
    }
    case 'lookAtHand':
      return {}
    case 'chooseFromHand': {
      const cards = p.cards.map((oid) => s.objects[oid])
      if (p.then === 'castFree') {
        const best = cards.filter((o) => !o.behavior?.spell?.targets?.length || pickTargets(o.behavior.spell.targets, intent(o.behavior.spell.effect), colorsOf(o))).sort((a, b) => mv(b) - mv(a))[0]
        return best ? { oid: best.oid } : { decline: true }
      }
      const best = cards.sort((a, b) => mv(b) - mv(a))[0]
      return best ? { oid: best.oid } : { decline: true }
    }
    case 'chooseRoom':
      return { room: p.options[0]?.id }
    case 'chooseDungeon':
      return { dungeon: p.options[0]?.name }
    default:
      return null
  }

  // Something legal for every slot when heuristics found nothing.
  function fallbackTargets(specs, ctxColors) {
    return (specs || []).map((spec) => {
      if (spec.type === 'player') return { kind: 'player', pid: spec.controller === 'opponent' ? opp?.id ?? pid : pid }
      const o = bf.find((x) => engine._targetMatches({ kind: 'object', oid: x.oid }, spec, { byPid: pid, sourceColors: ctxColors }))
      return o ? { kind: 'object', oid: o.oid } : { kind: 'player', pid: opp?.id ?? pid }
    })
  }

  function priorityAnswer() {
    const actions = p.actions || []
    const stackTop = zone(s, 'stack').length ? s.objects[zone(s, 'stack')[zone(s, 'stack').length - 1]] : null
    const mainPhase = s.step === 'main1' || s.step === 'main2'
    const sorcery = mainPhase && !stackTop && s.activePlayer === pid

    // Respond to an opponent's spell with a counter if we have one.
    if (stackTop && stackTop.controller !== pid) {
      for (const a of actions) {
        if (a.type !== 'cast' || !a.targets?.length || a.targets[0].type !== 'spell') continue
        const t = pickTargets(a.targets, 'harm', colorsOf(s.objects[a.oid]))
        if (t) return { ...castAnswer(a), targets: t }
      }
      return { type: 'pass' }
    }
    if (!sorcery) return { type: 'pass' }

    // A land first.
    const land = actions.find((a) => a.type === 'playLand')
    if (land) return land

    // Score every castable spell / ability with heuristic targets.
    let best = null
    for (const a of actions) {
      if (a.type === 'pass' || a.mana) continue
      const scored = scoreAction(a)
      if (scored && (!best || scored.score > best.score)) best = scored
    }
    return best ? best.answer : { type: 'pass' }
  }

  function castAnswer(a) {
    const base = { type: a.type, oid: a.oid }
    for (const k of ['ability', 'face', 'kicker', 'evoke', 'buyback', 'overload', 'mutate', 'altCost', 'sneak', 'webSlinging', 'option', 'color']) if (a[k] != null) base[k] = a[k]
    return base
  }

  function scoreAction(a) {
    const o = s.objects[a.oid]
    if (!o) return null
    const kinds = ['cast', 'castFlashback', 'castPlotted', 'castOmen', 'castDisturb', 'castPrepared', 'castFaceDown', 'castBestow', 'activate', 'crew', 'unearth', 'cycle']
    if (!kinds.includes(a.type)) return null
    if (a.type === 'activate' && a.loyalty == null) {
      // Abilities: only ones that draw / make tokens / pump at a fair price, once per priority.
      const ab = o.behavior?.activated?.[a.ability]
      const ops = (ab?.effect || []).map((e) => e.op)
      const useful = ops.some((op) => ['draw', 'createToken', 'attach', 'addCounter', 'dealDamage', 'destroy'].includes(op))
      if (!useful || ab?.cost?.sacrifice === 'self' && !ops.includes('draw') && !ops.includes('dealDamage')) return null
      if (o.status?.abilityUsed?.includes(ab)) return null
    }
    if (a.type === 'cycle' && landsInPlay >= 3) return null
    if (a.mutate || a.sneak || a.webSlinging || a.modal || a.variadic) return null // variants the bot doesn't plan
    if (a.hasX) return null
    const printed = a.face != null && o.faces ? o.faces[a.face] : o.printed
    const eff = a.type === 'activate' ? o.behavior?.activated?.[a.ability]?.effect : a.type === 'castPrepared' ? o.behavior?.prepared?.spell?.effect : o.behavior?.spell?.effect
    const how = intent(eff)
    let targets = []
    if (a.needsTargets > 0) {
      targets = pickTargets(a.targets, how, colorsOf(o), damageOf(eff))
      if (!targets) return null
      // Don't burn a creature-only removal spell on nothing worth it.
      if (how === 'harm' && targets.some((t) => t.kind === 'object' && s.objects[t.oid]?.controller === pid)) return null
    }
    let score = mv(o) + 1
    if (printed?.types?.includes('Creature')) score += 3 + power(o)
    if (how === 'harm' && targets.length) {
      const t = targets[0]
      if (t.kind === 'player') score += opp && (eff || []).some((e) => e.op === 'dealDamage' && e.amount >= opp.life) ? 100 : 1
      else score += worth(s.objects[t.oid])
    }
    if (a.type === 'activate') score = 1 + (a.loyalty != null ? 4 : 0)
    if (a.type === 'cycle') score = 0.5
    const answer = { ...castAnswer(a), targets }
    if (a.sacChoose) {
      const cands = engine._sacrificeCandidates(pid, a.sacChoose).sort((x, y) => worth(x) - worth(y))
      if (!cands.length) return null
      answer.sacrifice = cands[0].oid
      score -= worth(cands[0])
    }
    if (a.discChoose) {
      const others = hand.filter((h) => h.oid !== a.oid).sort((x, y) => mv(x) - mv(y))
      if (others.length < a.discChoose) return null
      answer.discard = others.slice(0, a.discChoose).map((h) => h.oid)
    }
    return { score, answer }
  }

  function attackers() {
    const defender = p.defenders.find((d) => d.kind === 'player')
    if (!defender) return { attackers: [] }
    const life = s.players[defender.pid].life
    const blockersOf = (oid) => (p.canBeBlockedBy?.[oid] || []).map((b) => s.objects[b])
    const eligible = p.eligible.map((oid) => s.objects[oid])
    const totalPower = eligible.reduce((n, o) => n + power(o), 0)
    const allBlockers = new Set(eligible.flatMap((o) => (p.canBeBlockedBy?.[o.oid] || [])))
    const alpha = totalPower >= life + allBlockers.size * Math.max(0, ...eligible.map(power)) // they can't block enough to survive
    const picked = []
    for (const o of eligible) {
      const bl = blockersOf(o.oid)
      const required = engine._required(o, 'attack')
      const safe = bl.every((b) => power(b) < toughness(o) || (engine._hasKW(o, 'First strike') && power(o) >= toughness(b)))
      const evasive = bl.length === 0
      if (required || evasive || safe || alpha) picked.push({ oid: o.oid, defender: { player: defender.pid } })
    }
    return { attackers: picked }
  }

  function blockers() {
    const attackers = p.attackers.map((oid) => s.objects[oid]).sort((a, b) => power(b) - power(a))
    const free = p.eligible.map((oid) => s.objects[oid])
    const blocks = {}
    const incoming = attackers.reduce((n, o) => n + power(o), 0)
    let unblockedPower = incoming
    const canBlock = (b, a) => engine._canBlock(b, a)
    for (const a of attackers) {
      // A block that kills the attacker and survives; else one that at least survives.
      const good = free.filter((b) => canBlock(b, a) && power(b) >= toughness(a) && toughness(b) > power(a))
      const wall = free.filter((b) => canBlock(b, a) && toughness(b) > power(a))
      const trade = free.filter((b) => canBlock(b, a) && power(b) >= toughness(a) && worth(b) <= worth(a))
      const pick = (good[0] || wall[0] || trade[0]) ?? null
      if (pick) {
        blocks[pick.oid] = a.oid
        free.splice(free.indexOf(pick), 1)
        unblockedPower -= power(a)
      }
    }
    // Chump-block to stay alive.
    if (unblockedPower >= me.life) {
      for (const a of attackers) {
        if (Object.values(blocks).includes(a.oid)) continue
        const chump = free.filter((b) => canBlock(b, a)).sort((x, y) => worth(x) - worth(y))[0]
        if (!chump) continue
        blocks[chump.oid] = a.oid
        free.splice(free.indexOf(chump), 1)
        unblockedPower -= power(a)
        if (unblockedPower < me.life) break
      }
    }
    // Block requirements (509.1c): a creature that must block, and can, blocks something.
    for (const b of [...free]) {
      if (!engine._required(b, 'block')) continue
      const a = attackers.find((x) => canBlock(b, x))
      if (a) blocks[b.oid] = a.oid
    }
    return { blocks }
  }
}

// The safest possible answer for a decision, used if the heuristic answer is
// rejected by the engine (it never should be, but a bot must not wedge a game).
export function botFallback(engine, pid) {
  const p = engine.state.pending
  if (!p || p.player !== pid) return null
  const s = engine.state
  switch (p.kind) {
    case 'priority':
      return { type: 'pass' }
    case 'declareAttackers':
      return { attackers: p.eligible.filter((oid) => engine._required(s.objects[oid], 'attack')).map((oid) => ({ oid, defender: { player: p.defenders.find((d) => d.kind === 'player')?.pid } })) }
    case 'declareBlockers':
      return { blocks: {} }
    case 'mulligan':
      return { keep: true }
    case 'bottom':
      return { bottom: p.hand.slice(0, p.count) }
    case 'discard':
      return { discard: p.hand.slice(0, p.count) }
    case 'discardCards':
      return { discard: p.optional ? [] : p.hand.slice(0, Math.min(p.count, p.hand.length)) }
    case 'chooseTargets':
      return p.optional ? { decline: true } : null
    case 'scry':
      return { toBottom: [], toTop: p.cards }
    case 'search':
      return { pick: p.optional ? null : p.cards[0] }
    case 'madness':
      return { cast: false }
    case 'mayPay':
    case 'wardPay':
      return { pay: false }
    case 'sacrificeChoice':
      return { sacrifice: p.optional ? [] : p.choices.slice(0, p.count) }
    case 'chooseFromHand':
      return p.optional ? { decline: true } : { oid: p.cards[0] }
    case 'playOrDraw':
      return { play: true }
    default:
      return {}
  }
}
