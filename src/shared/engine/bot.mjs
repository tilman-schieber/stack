// The computer opponent. Given an engine whose pending decision belongs to
// `pid`, `botChoose(engine, pid)` returns an answer for it. No search — a
// situation analysis (who is the beatdown, what is lethal, what each creature
// and spell is worth) drives a set of plays:
//
//   - lands and mana: the land that unlocks the most spells; mana held open for
//     an instant when one is worth holding;
//   - sorcery speed: creatures on curve (haste first), removal only on targets
//     worth a card, burn to the face only when it is lethal or we are racing;
//   - instant speed, in every priority window: counter a spell worth countering,
//     kill a creature in response to its pump/aura, cast flash creatures and
//     removal at the opponent's end step, combat tricks after blocks (pump the
//     creature that wins the fight, remove the blocker that would kill ours),
//     Fog-style effects when lethal is coming;
//   - combat: attacks that are safe, that trade acceptably for the beatdown, or
//     that are lethal as an alpha strike, keeping a blocker home when the
//     counterattack would be lethal; blocks that kill and survive, then double
//     blocks, then trades (as the control deck), then chump blocks to stay alive.
//
// Every answer names something the decision offered, so the engine accepts it;
// `botFallback` gives a safe answer per decision kind if a heuristic ever
// misfires. The bot reads engine state in-process but only looks at what its
// player may know (its hand, public zones, the stack).

import { zone, objectsIn } from './state.mjs'
import { recompute } from './layers.mjs'

const HARMFUL = new Set(['destroy', 'dealDamage', 'dealDamageDivided', 'bounce', 'counter', 'tap', 'loseLife', 'exileGraveyard', 'fight', 'mill', 'discard', 'chooseFromHand', 'revealHand', 'discardNamed', 'eachOpponentSacrifices', 'targetPlayerSacrifices', 'gainControl', 'changeTargets', 'restrict', 'goad', 'tapOrUntap'])
const HELPFUL = new Set(['pump', 'grantKeyword', 'addCounter', 'attach', 'regenerate', 'untap', 'returnFromGraveyard', 'returnToBattlefield', 'exileReturnEndStep', 'becomeCreature', 'animate', 'setColors', 'preventNextDamage', 'copySpell', 'createTokenCopy', 'transform'])

const mv = (o) => o?.printed?.manaValue || 0
const isLand = (o) => o?.printed?.types?.includes('Land')
const isCreature = (o) => o?.chars?.types?.includes('Creature') || o?.printed?.types?.includes('Creature')
const isInstantSpeed = (o) => o?.printed?.types?.includes('Instant') || o?.printed?.keywords?.includes('Flash')
const power = (o) => o?.chars?.power ?? o?.printed?.power ?? 0
const toughness = (o) => o?.chars?.toughness ?? o?.printed?.toughness ?? 0
const kw = (o, k) => !!o?.chars?.keywords?.includes(k) || !!o?.printed?.keywords?.includes(k)
// A rough value of a permanent: what we'd hate to lose / love to kill.
const worth = (o) => (isCreature(o) ? power(o) * 2 + toughness(o) + mv(o) + (kw(o, 'Flying') ? 2 : 0) + (kw(o, 'Deathtouch') || kw(o, 'Lifelink') ? 2 : 0) : mv(o) + 2)
const ops = (effects) => (effects || []).map((e) => e.op)

// What an effect list does to its target.
function intent(effects) {
  const o = ops(effects)
  if (o.some((op) => HARMFUL.has(op))) return 'harm'
  if (o.some((op) => HELPFUL.has(op))) return 'help'
  return 'harm'
}
const damageOf = (effects) => {
  const d = (effects || []).find((e) => e.op === 'dealDamage' && typeof e.amount === 'number')
  return d ? d.amount : 0
}
const pumpOf = (effects) => {
  const p = (effects || []).find((e) => e.op === 'pump' && typeof e.power === 'number')
  return p ? { power: p.power, toughness: p.toughness || 0 } : null
}
const isRemoval = (effects) => ops(effects).some((op) => op === 'destroy' || op === 'bounce' || op === 'dealDamage')
const isCounter = (effects) => ops(effects).includes('counter')
const isFog = (effects) => ops(effects).includes('preventAllCombat')
const spellEffects = (o) => o?.behavior?.spell?.effect || []
const spellTargets = (o) => o?.behavior?.spell?.targets || []

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
  const myCreatures = mine.filter(isCreature)
  const theirCreatures = theirs.filter(isCreature)
  const hand = zone(s, 'hand', pid).map((oid) => s.objects[oid])
  const landsInPlay = mine.filter(isLand).length
  const stack = zone(s, 'stack').map((oid) => s.objects[oid])
  const stackTop = stack[stack.length - 1] || null
  const myTurn = s.activePlayer === pid

  // ---- situation ---------------------------------------------------------
  // Clocks: turns each side needs to kill the other with its creatures if
  // nothing changes. The side with the shorter clock is the beatdown and should
  // trade aggressively; the other side plays control and preserves life.
  const clock = (attackers, life) => {
    const pw = attackers.reduce((n, o) => n + power(o), 0)
    return pw > 0 ? Math.ceil(life / pw) : 99
  }
  const myClock = clock(myCreatures, opp?.life ?? 20)
  const theirClock = clock(theirCreatures, me.life)
  const beatdown = myClock <= theirClock
  // The opponent's potential counterattack next turn, if we tapped out.
  const theirSwing = theirCreatures.reduce((n, o) => n + power(o), 0)
  // Burn in hand we could point at a face, if we spent everything on it.
  const burnReach = hand.filter((o) => isRemoval(spellEffects(o)) && spellTargets(o)[0]?.type === 'any').reduce((n, o) => n + damageOf(spellEffects(o)), 0)

  // A creature worth a removal spell: a real threat, or the only clock they have.
  const threatScore = (o) => worth(o) + (theirCreatures.length <= 2 ? 3 : 0) + (kw(o, 'Flying') && !myCreatures.some((m) => kw(m, 'Flying') || kw(m, 'Reach')) ? 3 : 0)
  const worthKilling = (o, spell) => threatScore(o) >= 8 + (mv(spell) > 2 ? 2 : 0) || (theirCreatures.length === 1 && !beatdown && power(o) >= 2)
  // Too many spells in hand: stop holding cards and use them.
  const flooded = hand.filter((o) => !isLand(o)).length >= 5

  const colorsOf = (o) => [...(o?.printed?.colors || []), ...(o?.printed?.types || [])]
  const legal = (o, spec, ctxColors) => engine._targetMatches({ kind: 'object', oid: o.oid }, spec, { byPid: pid, sourceColors: ctxColors })

  // Choose a target for one spec, given what the effect does to it (and the
  // damage it deals, to prefer kills).
  const pickTarget = (spec, how, ctxColors, dmg = 0, prefer = null) => {
    if (spec.type === 'player') {
      if (spec.controller === 'you') return { kind: 'player', pid }
      if (how === 'help' && spec.controller !== 'opponent') return { kind: 'player', pid }
      return opp ? { kind: 'player', pid: opp.id } : { kind: 'player', pid }
    }
    if (spec.type === 'spell') {
      const top = [...stack].reverse().find((o) => o.controller !== pid && !o.isCopy)
      return top ? { kind: 'spell', oid: top.oid } : null
    }
    if (prefer && legal(prefer, spec, ctxColors)) return { kind: 'object', oid: prefer.oid }
    const pool = spec.controller === 'you' ? mine : spec.controller === 'opponent' ? theirs : how === 'harm' ? [...theirs, ...mine] : [...mine, ...theirs]
    const cands = pool.filter((o) => legal(o, spec, ctxColors))
    if (!cands.length) return spec.type === 'any' && how === 'harm' && opp ? { kind: 'player', pid: opp.id } : null
    const own = (o) => o.controller === pid
    let best
    if (how === 'harm') {
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
  const pickTargets = (specs, how, ctxColors, dmg = 0, prefer = null) => {
    const out = []
    for (const spec of specs || []) {
      const t = pickTarget(spec, how, ctxColors, dmg, prefer)
      if (!t) return null
      out.push(t)
    }
    return out
  }
  const fallbackTargets = (specs, ctxColors) =>
    (specs || []).map((spec) => {
      if (spec.type === 'player') return { kind: 'player', pid: spec.controller === 'opponent' ? (opp?.id ?? pid) : pid }
      const o = bf.find((x) => legal(x, spec, ctxColors))
      return o ? { kind: 'object', oid: o.oid } : { kind: 'player', pid: opp?.id ?? pid }
    })

  // ---- priority ------------------------------------------------------------

  function castAnswer(a) {
    const base = { type: a.type, oid: a.oid }
    for (const k of ['ability', 'face', 'kicker', 'evoke', 'buyback', 'overload', 'mutate', 'altCost', 'sneak', 'webSlinging', 'option', 'color']) if (a[k] != null) base[k] = a[k]
    return base
  }
  const castTypes = new Set(['cast', 'castFlashback', 'castPlotted', 'castOmen', 'castDisturb', 'castPrepared', 'castFaceDown', 'castBestow'])
  // The spell object and effects behind an action.
  const spellOf = (a) => {
    const o = s.objects[a.oid]
    const printed = a.face != null && o?.faces ? o.faces[a.face] : o?.printed
    const eff = a.type === 'activate' ? o?.behavior?.activated?.[a.ability]?.effect : a.type === 'castPrepared' ? o?.behavior?.prepared?.spell?.effect : spellEffects(o)
    return { o, printed, eff }
  }
  // Finish a cast answer with chosen targets and cost choices, or null.
  const build = (a, targets) => {
    const answer = { ...castAnswer(a), targets: targets || [] }
    const o = s.objects[a.oid]
    if (a.sacChoose) {
      const cands = engine._sacrificeCandidates(pid, a.sacChoose).sort((x, y) => worth(x) - worth(y))
      if (!cands.length) return null
      answer.sacrifice = cands[0].oid
    }
    if (a.discChoose) {
      const others = hand.filter((h) => h.oid !== a.oid).sort((x, y) => mv(x) - mv(y))
      if (others.length < a.discChoose) return null
      answer.discard = others.slice(0, a.discChoose).map((h) => h.oid)
    }
    void o
    return answer
  }
  const plain = (a) => !(a.mutate || a.sneak || a.webSlinging || a.modal || a.variadic || a.hasX)

  switch (p.kind) {
    case 'playOrDraw':
      return { play: true }
    case 'mulligan': {
      const lands = hand.filter(isLand).length
      return { keep: p.mulligans >= 2 || (lands >= 2 && lands <= 5) }
    }
    case 'bottom': {
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
      const t = pickTargets(p.targets, how, colorsOf(src), damageOf(eff))
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
      return { pay: !!p.canPay && (!p.life || me.life > p.life + 4) }
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
        const t = pickTargets(p.targets, intent(spellEffects(o)), colorsOf(o), damageOf(spellEffects(o)))
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
        return o && !isLand(o) && o.owner !== pid
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
      if (p.optional && p.elseLoseLife && me.life > 6 && p.choices.every((oid) => worth(s.objects[oid]) > p.elseLoseLife)) return { sacrifice: [] }
      const cheapest = p.choices.map((oid) => s.objects[oid]).sort((a, b) => worth(a) - worth(b))
      return { sacrifice: cheapest.slice(0, p.count).map((o) => o.oid) }
    }
    case 'lookAtHand':
      return {}
    case 'chooseFromHand': {
      const cards = p.cards.map((oid) => s.objects[oid])
      if (p.then === 'castFree') {
        const best = cards.filter((o) => !spellTargets(o).length || pickTargets(spellTargets(o), intent(spellEffects(o)), colorsOf(o), damageOf(spellEffects(o)))).sort((a, b) => mv(b) - mv(a))[0]
        return best ? { oid: best.oid } : { decline: true }
      }
      const best = cards.sort((a, b) => mv(b) - mv(a))[0]
      return best ? { oid: best.oid } : { decline: true }
    }
    case 'chooseRingBearer': {
      const best = p.choices.map((oid) => s.objects[oid]).sort((a, b) => worth(b) - worth(a))[0]
      return { oid: best.oid }
    }
    case 'chooseRoom':
      return { room: p.options[0]?.id }
    case 'chooseDungeon':
      return { dungeon: p.options[0]?.name }
    default:
      return null
  }

  function priorityAnswer() {
    const actions = (p.actions || []).filter((a) => a.type !== 'pass' && !a.mana)
    if (!actions.length) return { type: 'pass' }
    const empty = !stackTop

    // 1. Something is on the stack.
    if (!empty) {
      if (stackTop.controller === pid) return { type: 'pass' } // let ours resolve
      return respond(actions) || { type: 'pass' }
    }
    // 2. Combat: after blockers are declared, tricks and removal.
    if (s.step === 'declareBlockers' && s.combat) return combatTrick(actions) || { type: 'pass' }
    // Attackers declared against us: a Fog if lethal is coming.
    if (s.step === 'declareAttackers' && s.combat && !myTurn) return fogIfNeeded(actions) || { type: 'pass' }
    // 3. The opponent's end step: spend what would go unused.
    if (!myTurn && s.step === 'end') return endStepPlays(actions) || { type: 'pass' }
    // 4. Our main phases.
    if (myTurn && (s.step === 'main1' || s.step === 'main2')) return mainPhase(actions) || { type: 'pass' }
    // 5. Anywhere else: only a lethal burn spell.
    return lethalBurn(actions) || { type: 'pass' }
  }

  // A spell of the opponent's is on the stack: counter it if it's worth a card,
  // or kill the creature it's about to pump / enchant.
  function respond(actions) {
    const sp = stackTop
    const spellIsThreat = mv(sp) >= 2 || isCreature(sp) || isRemoval(spellEffects(sp)) || (sp.targets || []).some((t) => t.kind === 'object' && s.objects[t.oid]?.controller === pid)
    for (const a of actions) {
      if (!castTypes.has(a.type) || !plain(a)) continue
      const { eff, o } = spellOf(a)
      if (isCounter(eff) && spellIsThreat) {
        const t = pickTargets(a.targets, 'harm', colorsOf(o))
        if (t) return build(a, t)
      }
    }
    // Their pump/aura on a creature: removal in response wastes their spell.
    const pumped = sp.controller !== pid && intent(spellEffects(sp)) === 'help' ? (sp.targets || []).map((t) => s.objects[t?.oid]).find((o) => o && o.controller !== pid) : null
    if (pumped) {
      const r = removalFor(actions, pumped, true)
      if (r) return r
    }
    return null
  }

  // The cheapest removal action in `actions` that kills / answers `target`.
  function removalFor(actions, target, force = false) {
    let best = null
    for (const a of actions) {
      if (!castTypes.has(a.type) || !plain(a) || !a.targets?.length) continue
      const { eff, o } = spellOf(a)
      if (!isRemoval(eff)) continue
      const dmg = damageOf(eff)
      if (dmg && isCreature(target) && toughness(target) - (target.status?.damage || 0) > dmg) continue
      if (!force && !worthKilling(target, o)) continue
      const t = pickTargets(a.targets, 'harm', colorsOf(o), dmg, target)
      if (!t || !t.some((x) => x.oid === target.oid)) continue
      const ans = build(a, t)
      if (ans && (!best || mv(o) < best.cost)) best = { ans, cost: mv(o) }
    }
    return best?.ans || null
  }

  function fogIfNeeded(actions) {
    const incoming = s.combat.attackers.map((oid) => s.objects[oid]).filter((o) => o && o.status.attacking && !o.status.blocked)
    const dmg = incoming.reduce((n, o) => n + power(o), 0)
    if (dmg < me.life && !(dmg >= me.life * 0.4 && !beatdown && dmg >= 5)) return null
    for (const a of actions) {
      if (!castTypes.has(a.type) || !plain(a)) continue
      if (isFog(spellOf(a).eff)) return build(a, [])
    }
    return null
  }

  // After blockers: pump the creature that then wins its fight, or kill the
  // creature that would kill ours. Only when the fight is actually decided by it.
  function combatTrick(actions) {
    const c = s.combat
    if (!c?.blocks) return fogIfNeeded(actions)
    const pairs = Object.entries(c.blocks).map(([b, a]) => ({ blocker: s.objects[b], attacker: s.objects[a] })).filter((x) => x.blocker && x.attacker)
    // Our creature in each fight, and the enemy it fights.
    const fights = pairs.map(({ blocker, attacker }) => (attacker.controller === pid ? { ours: attacker, enemy: blocker } : blocker.controller === pid ? { ours: blocker, enemy: attacker } : null)).filter(Boolean)
    // Also our unblocked attackers: pump them if that's lethal.
    if (myTurn) {
      const unblocked = c.attackers.map((oid) => s.objects[oid]).filter((o) => o && o.controller === pid && o.status.attacking && !o.status.blocked)
      const dmg = unblocked.reduce((n, o) => n + power(o), 0)
      if (opp && dmg < opp.life) {
        for (const a of actions) {
          if (!castTypes.has(a.type) || !plain(a) || !a.targets?.length) continue
          const { eff, o } = spellOf(a)
          const pump = pumpOf(eff)
          if (pump && dmg + pump.power >= opp.life && unblocked.length) {
            const t = pickTargets(a.targets, 'help', colorsOf(o), 0, unblocked[0])
            if (t) return build(a, t)
          }
        }
      }
    }
    for (const { ours, enemy } of fights.sort((x, y) => worth(y.ours) - worth(x.ours))) {
      const dies = power(enemy) >= toughness(ours) - (ours.status.damage || 0) && !kw(ours, 'Indestructible')
      const kills = power(ours) >= toughness(enemy) - (enemy.status.damage || 0) || kw(ours, 'Deathtouch')
      if (!dies && kills) continue // already winning
      // A pump that flips the fight (survive, and ideally kill).
      for (const a of actions) {
        if (!castTypes.has(a.type) || !plain(a) || !a.targets?.length) continue
        const { eff, o } = spellOf(a)
        const pump = pumpOf(eff)
        if (!pump) continue
        const survives = power(enemy) < toughness(ours) + pump.toughness - (ours.status.damage || 0)
        const killsNow = power(ours) + pump.power >= toughness(enemy) - (enemy.status.damage || 0)
        if ((dies && survives) || (!dies && !kills && killsNow && worth(enemy) >= 6)) {
          const t = pickTargets(a.targets, 'help', colorsOf(o), 0, ours)
          if (t) return build(a, t)
        }
      }
      // Removal on the enemy that would kill our better creature.
      if (dies && worth(ours) >= worth(enemy) - 2) {
        const r = removalFor(actions, enemy, true)
        if (r) return r
      }
    }
    return null
  }

  // The opponent's end step: flash creatures, removal on a worthwhile creature,
  // instants that draw, and burn to the face when it is lethal or we're racing.
  function endStepPlays(actions) {
    const lethal = lethalBurn(actions)
    if (lethal) return lethal
    let best = null
    for (const a of actions) {
      if (!castTypes.has(a.type) || !plain(a)) continue
      const { o, printed, eff } = spellOf(a)
      if (!isInstantSpeed(o) && !printed?.keywords?.includes('Flash')) continue
      let score = 0
      let targets = []
      if (printed?.types?.includes('Creature')) score = 5 + worth(o)
      else if (isRemoval(eff) && a.targets?.length) {
        const dmg = damageOf(eff)
        const victim = theirCreatures.filter((t) => worthKilling(t, o) && (!dmg || toughness(t) - (t.status.damage || 0) <= dmg)).sort((x, y) => threatScore(y) - threatScore(x))[0]
        if (victim) {
          targets = pickTargets(a.targets, 'harm', colorsOf(o), dmg, victim)
          score = victim && targets ? 4 + threatScore(victim) : 0
        } else if (dmg && a.targets[0]?.type === 'any' && opp && (beatdown || flooded)) {
          targets = [{ kind: 'player', pid: opp.id }]
          score = 2
        }
        if (!targets?.length) continue
      } else if (ops(eff).includes('draw')) score = 3 + mv(o)
      else continue
      if (a.needsTargets > 0 && !targets.length) continue
      const ans = build(a, targets)
      if (ans && (!best || score > best.score)) best = { ans, score }
    }
    return best?.ans || null
  }

  function lethalBurn(actions) {
    if (!opp) return null
    for (const a of actions) {
      if (!castTypes.has(a.type) || !plain(a) || !a.targets?.length || a.targets[0].type !== 'any') continue
      const { eff } = spellOf(a)
      if (damageOf(eff) >= opp.life) return build(a, [{ kind: 'player', pid: opp.id }])
    }
    return null
  }

  // Our main phase: land, then the best play. Mana is held for an instant we
  // would want to cast on their turn (a counter, removal, a trick) when the
  // sorcery-speed alternative isn't clearly better.
  function mainPhase(actions) {
    const land = bestLand(actions)
    if (land) return land
    const lethal = lethalBurn(actions)
    if (lethal) return lethal
    const main1 = s.step === 'main1'
    const available = engine._manaAvailable(pid)
    // An instant worth keeping mana for on their turn.
    const heldInstant = hand.filter((o) => isInstantSpeed(o) && (isCounter(spellEffects(o)) || isRemoval(spellEffects(o)) || pumpOf(spellEffects(o)) || isFog(spellEffects(o)))).sort((a, b) => mv(a) - mv(b))[0]
    const holdMana = heldInstant && (opp ? zone(s, 'hand', opp.id).length > 0 : false) ? mv(heldInstant) : 0

    let best = null
    const consider = (a, score, targets) => {
      const ans = build(a, targets)
      if (ans && (!best || score > best.score)) best = { ans, score, cost: mv(spellOf(a).o) }
    }
    for (const a of actions) {
      const { o, printed, eff } = spellOf(a)
      if (a.type === 'activate' && a.loyalty == null) {
        const ab = o?.behavior?.activated?.[a.ability]
        const ab_ops = ops(ab?.effect)
        if (o.status?.abilityUsed?.includes(ab)) continue
        const useful = ab_ops.some((op) => ['draw', 'createToken', 'attach', 'addCounter', 'levelUp', 'dealDamage', 'destroy'].includes(op))
        if (!useful) continue
        if (ab?.cost?.sacrifice === 'self' && !ab_ops.includes('draw') && !ab_ops.includes('dealDamage')) continue
        let targets = []
        if (a.needsTargets > 0) {
          targets = pickTargets(a.targets, intent(ab?.effect), colorsOf(o), damageOf(ab?.effect))
          if (!targets) continue
        }
        consider(a, 2 + (ab_ops.includes('levelUp') ? 3 : 0), targets)
        continue
      }
      if (a.type === 'activate' && a.loyalty != null) {
        let targets = []
        if (a.needsTargets > 0) {
          targets = pickTargets(a.targets, intent(o?.behavior?.activated?.[a.ability]?.effect), colorsOf(o), damageOf(o?.behavior?.activated?.[a.ability]?.effect))
          if (!targets) continue
        }
        consider(a, 6 + a.loyalty, targets)
        continue
      }
      if (a.type === 'unlockDoor') {
        consider(a, 3 + mv(o), [])
        continue
      }
      if (a.type === 'cycle') {
        if (landsInPlay < 3) consider(a, 0.5, [])
        continue
      }
      if (!castTypes.has(a.type) || !plain(a)) continue
      const creature = printed?.types?.includes('Creature')
      const instant = isInstantSpeed(o)
      if (creature) {
        // Haste creatures before combat; the rest after it (holding mana until we know the combat).
        const haste = printed.keywords?.includes('Haste') || kw(o, 'Haste')
        if (main1 && !haste && myCreatures.length && !beatdown) continue
        let score = 4 + worth(o) + mv(o)
        if (main1 && haste) score += 3
        consider(a, score, a.needsTargets > 0 ? pickTargets(a.targets, intent(eff), colorsOf(o)) || [] : [])
        continue
      }
      if (isRemoval(eff) && a.targets?.length) {
        // Instant-speed removal waits for their turn unless it clears a blocker for a big attack.
        const dmg = damageOf(eff)
        const victim = theirCreatures.filter((t) => worthKilling(t, o) && (!dmg || toughness(t) - (t.status.damage || 0) <= dmg)).sort((x, y) => threatScore(y) - threatScore(x))[0]
        if (victim) {
          const clearsBlocker = main1 && myCreatures.some((m) => !m.status.summoningSick || kw(m, 'Haste')) && victim.status.tapped === false
          if (instant && !clearsBlocker && !flooded) continue // hold it
          const targets = pickTargets(a.targets, 'harm', colorsOf(o), dmg, victim)
          if (targets) consider(a, 3 + threatScore(victim) + (clearsBlocker ? 2 : 0), targets)
        } else if (dmg && a.targets[0]?.type === 'any' && opp && !instant && (beatdown || opp.life <= burnReach + theirSwing)) {
          consider(a, 2 + dmg, [{ kind: 'player', pid: opp.id }])
        }
        continue
      }
      if (isCounter(eff) || pumpOf(eff) || isFog(eff)) continue // instants for later
      if (a.needsTargets > 0) {
        const targets = pickTargets(a.targets, intent(eff), colorsOf(o), damageOf(eff))
        if (!targets) continue
        if (intent(eff) === 'harm' && targets.some((t) => t.kind === 'object' && s.objects[t.oid]?.controller === pid)) continue
        consider(a, 2 + mv(o), targets)
      } else consider(a, 2 + mv(o) + (ops(eff).includes('createToken') ? 3 : 0) + (ops(eff).includes('draw') ? 2 : 0), [])
    }
    if (!best) return null
    // Hold mana for the instant unless the play is clearly better than the option.
    if (holdMana && available - best.cost < holdMana && best.score < 9 + holdMana) return null
    return best.ans
  }

  // The land that unlocks the most (or the most expensive) spells in hand.
  function bestLand(actions) {
    const lands = actions.filter((a) => a.type === 'playLand')
    if (!lands.length) return null
    if (lands.length === 1) return lands[0]
    const need = {}
    for (const o of hand) if (!isLand(o)) for (const c of ['W', 'U', 'B', 'R', 'G']) if (o.printed?.manaCost?.[c]) need[c] = (need[c] || 0) + o.printed.manaCost[c]
    const have = {}
    for (const l of mine.filter(isLand)) for (const c of engine._manaColorsOf(l)) have[c] = (have[c] || 0) + 1
    const score = (a) => {
      const o = s.objects[a.oid]
      const cols = engine._manaColorsOf(o)
      return cols.reduce((n, c) => n + Math.max(0, (need[c] || 0) - (have[c] || 0)), 0) + cols.length * 0.1 - (o.behavior?.entersTapped ? 0.5 : 0)
    }
    return lands.sort((a, b) => score(b) - score(a))[0]
  }

  // ---- combat --------------------------------------------------------------

  function attackers() {
    const defender = p.defenders.find((d) => d.kind === 'player')
    if (!defender) return { attackers: [] }
    const life = s.players[defender.pid].life
    const blockersOf = (oid) => (p.canBeBlockedBy?.[oid] || []).map((b) => s.objects[b])
    const eligible = p.eligible.map((oid) => s.objects[oid])
    // Alpha strike: they can block at most one attacker per untapped creature;
    // lethal if what gets through after their best blocks still kills.
    const allBlockers = [...new Set(eligible.flatMap((o) => p.canBeBlockedBy?.[o.oid] || []))]
    const sortedPower = eligible.map(power).sort((a, b) => b - a)
    const through = sortedPower.slice(allBlockers.length).reduce((n, x) => n + x, 0)
    const alpha = through >= life
    // Their counterattack next turn if every creature of ours taps: keep the
    // best blocker home when that would be lethal (vigilance creatures are free).
    const mustKeepHome = !alpha && theirSwing >= me.life
    let keeper = null
    if (mustKeepHome) keeper = [...eligible].filter((o) => !kw(o, 'Vigilance')).sort((a, b) => toughness(b) - toughness(a))[0] || null
    const picked = []
    for (const o of eligible) {
      const bl = blockersOf(o.oid)
      const required = engine._required(o, 'attack')
      const evasive = bl.length === 0
      const firstStrikeWins = (b) => kw(o, 'First strike') && !kw(b, 'First strike') && power(o) >= toughness(b)
      const killers = bl.filter((b) => (power(b) >= toughness(o) || kw(b, 'Deathtouch')) && !firstStrikeWins(b) && !kw(o, 'Indestructible'))
      const safe = killers.length === 0
      // A trade: every killer would die too — fine for the beatdown, or when we come out ahead.
      const tradeOk = killers.every((b) => power(o) >= toughness(b) || kw(o, 'Deathtouch')) && (beatdown || killers.every((b) => worth(b) >= worth(o)))
      if (required || alpha || ((evasive || safe || tradeOk) && o !== keeper)) picked.push({ oid: o.oid, defender: { player: defender.pid } })
    }
    return { attackers: picked }
  }

  function blockers() {
    const attackers = p.attackers.map((oid) => s.objects[oid]).sort((a, b) => power(b) - power(a))
    const free = p.eligible.map((oid) => s.objects[oid])
    const blocks = {}
    const canBlock = (b, a) => engine._canBlock(b, a)
    let unblocked = attackers.reduce((n, o) => n + power(o), 0)
    const use = (b, a) => {
      blocks[b.oid] = a.oid
      free.splice(free.indexOf(b), 1)
      unblocked -= power(a)
    }
    const lethalComing = () => unblocked >= me.life
    for (const a of attackers) {
      const survives = (b) => toughness(b) > power(a) && !kw(a, 'Deathtouch')
      const killsIt = (b) => power(b) >= toughness(a) || kw(b, 'Deathtouch')
      const good = free.filter((b) => canBlock(b, a) && killsIt(b) && survives(b))
      if (good[0]) {
        use(good.sort((x, y) => worth(x) - worth(y))[0], a)
        continue
      }
      // Double block: two creatures that together kill it while it kills at most one.
      const pair = free.filter((b) => canBlock(b, a)).sort((x, y) => power(y) - power(x)).slice(0, 2)
      if (pair.length === 2 && power(pair[0]) + power(pair[1]) >= toughness(a) && !kw(a, 'Trample') && (!beatdown || worth(a) > worth(pair[0]) + worth(pair[1]) / 2)) {
        use(pair[0], a)
        blocks[pair[1].oid] = a.oid
        free.splice(free.indexOf(pair[1]), 1)
        continue
      }
      const wall = free.filter((b) => canBlock(b, a) && survives(b))
      if (wall[0]) {
        use(wall.sort((x, y) => worth(x) - worth(y))[0], a)
        continue
      }
      // A trade: the control deck takes it; the beatdown only when it comes out ahead.
      const trade = free.filter((b) => canBlock(b, a) && killsIt(b) && (!beatdown || worth(b) < worth(a)))
      if (trade[0]) use(trade.sort((x, y) => worth(x) - worth(y))[0], a)
    }
    // Chump-block to stay alive (also at a dangerously low life as the control deck).
    if (lethalComing() || (!beatdown && unblocked >= me.life * 0.5 && me.life <= 8)) {
      for (const a of attackers) {
        if (Object.values(blocks).includes(a.oid)) continue
        const chump = free.filter((b) => canBlock(b, a)).sort((x, y) => worth(x) - worth(y))[0]
        if (!chump) continue
        use(chump, a)
        if (!lethalComing() && unblocked < me.life * 0.5) break
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
    case 'chooseRingBearer':
      return { oid: p.choices[0] }
    case 'playOrDraw':
      return { play: true }
    default:
      return {}
  }
}

// Priority windows the bot wants to see: every step, both turns. It passes
// instantly when it has nothing to do (see the store), so this costs nothing.
export const BOT_STOPS = ['upkeep', 'draw', 'main1', 'beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat', 'main2', 'end'].flatMap((st) => [st, 'opp:' + st])
