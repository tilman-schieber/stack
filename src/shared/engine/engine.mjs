// The M0 game engine: a deterministic step function. `advance()` runs until it
// needs a choice, at which point it sets state.pending (a PendingDecision) and
// returns; `choose(answer)` feeds the answer and continues. Nothing here touches
// React or Electron — it is driven by scripted choices in headless tests and
// (later) by UI in engine-backed game mode.
//
// Rule references are to MagicCompRules20260619.txt.

import { createState, createObject, createAbility, computeChars, zone, zoneKey, moveObject, objectsIn } from './state.mjs'
import { manaAbilityColors, loadBehavior } from './behaviors.mjs'
import { isPermanent, parseManaCost } from './cards.mjs'
import { recompute, matchStatic } from './layers.mjs'

// Step order (rules 500–514). First strike is folded into a single combat-damage
// step for M0 (no keywords yet). Priority is granted in PRIORITY_STEPS only.
const STEP_ORDER = [
  'untap',
  'upkeep',
  'draw',
  'main1',
  'beginCombat',
  'declareAttackers',
  'declareBlockers',
  'combatDamage',
  'endCombat',
  'main2',
  'end',
  'cleanup'
]
const PRIORITY_STEPS = new Set([
  'upkeep',
  'draw',
  'main1',
  'beginCombat',
  'declareAttackers',
  'declareBlockers',
  'combatDamage',
  'endCombat',
  'main2',
  'end'
])
const MAIN_STEPS = new Set(['main1', 'main2'])

export class GameEngine {
  constructor(opts) {
    this.state = createState(opts)
  }

  // ---- lifecycle -------------------------------------------------------

  start(handSize = 7) {
    const s = this.state
    this.handSize = handSize
    for (const p of s.players) this.draw(p.id, handSize)
    // London mulligan phase, resolved player by player before turn 1.
    s.step = 'mulligan'
    s.activePlayer = 0
    s.mulliganPlayer = 0
    this._askMulligan()
    return this
  }

  // ---- London mulligan (rule 103.5) -----------------------------------

  _askMulligan() {
    const s = this.state
    const pid = s.mulliganPlayer
    s.pending = {
      kind: 'mulligan',
      player: pid,
      mulligans: s.players[pid].mulligans,
      hand: [...zone(s, 'hand', pid)]
    }
  }

  _applyMulligan(answer) {
    const s = this.state
    const pid = s.mulliganPlayer
    if (answer?.keep) {
      const n = s.players[pid].mulligans
      const handLen = zone(s, 'hand', pid).length
      const count = Math.min(n, handLen)
      if (count > 0) {
        s.pending = {
          kind: 'bottom',
          player: pid,
          count,
          hand: [...zone(s, 'hand', pid)]
        }
      } else {
        this._nextMulliganPlayer()
      }
    } else {
      // Mulligan: shuffle the whole hand back and draw a fresh seven.
      for (const oid of [...zone(s, 'hand', pid)]) moveObject(s, oid, 'library')
      const libKey = zoneKey('library', pid)
      s.zones[libKey] = s.rng.shuffle(s.zones[libKey])
      this.draw(pid, this.handSize || 7)
      s.players[pid].mulligans++
      this._askMulligan()
    }
  }

  _applyBottom(pending, answer) {
    const s = this.state
    const bottom = answer?.bottom || []
    if (bottom.length !== pending.count)
      throw new Error(`must put exactly ${pending.count} card(s) on the bottom`)
    for (const oid of bottom) moveObject(s, oid, 'library') // to the bottom
    this._nextMulliganPlayer()
  }

  _nextMulliganPlayer() {
    const s = this.state
    if (s.mulliganPlayer < s.players.length - 1) {
      s.mulliganPlayer++
      this._askMulligan()
    } else {
      s.mulliganPlayer = null
      s.turnNumber = 1
      s.activePlayer = 0
      this._enterStep('untap') // _pump (in choose) advances into the game
    }
  }

  get pending() {
    return this.state.pending
  }

  // ---- the driver ------------------------------------------------------

  // Run non-interactive transitions until a decision is required. Priority is
  // handled entirely inside choose(); _pump only walks turn-based steps.
  _pump() {
    const s = this.state
    let guard = 0
    while (!s.pending && s.winner == null) {
      if (++guard > 10000) throw new Error('engine pump did not converge')
      this._checkSBA()
      if (s.winner != null) break
      if (s.prio) return // a priority loop is active; wait for choose()
      // Current step's turn-based work is done at entry; if it grants priority
      // that was set up in _enterStep. So an idle _pump advances to next step.
      this._advanceStep()
    }
  }

  choose(answer) {
    const s = this.state
    const pending = s.pending
    if (!pending) throw new Error('no pending decision')
    if (pending.kind === 'gameOver') return this
    s.pending = null
    try {
      switch (pending.kind) {
        case 'mulligan':
          this._applyMulligan(answer)
          break
        case 'bottom':
          this._applyBottom(pending, answer)
          break
        case 'priority':
          this._resolvePriority(pending, answer)
          break
        case 'declareAttackers':
          this._applyAttackers(answer)
          break
        case 'declareBlockers':
          this._applyBlockers(answer)
          break
        case 'discard':
          this._applyDiscard(pending, answer)
          break
        case 'chooseTargets':
          this._applyChooseTargets(pending, answer)
          break
        case 'scry':
          this._applyScry(pending, answer)
          break
        case 'explore':
          this._applyExplore(pending, answer)
          break
        case 'discardCards':
          this._applyDiscardCards(pending, answer)
          break
        case 'madness':
          this._applyMadness(pending, answer)
          break
        case 'search':
          this._applySearch(pending, answer)
          break
        case 'mayPay':
          this._applyMayPay(pending, answer)
          break
        case 'wardPay':
          this._applyWardPay(pending, answer)
          break
        case 'copyEnter':
          this._applyCopyEnter(pending, answer)
          break
        default:
          throw new Error(`unhandled decision ${pending.kind}`)
      }
    } catch (err) {
      // An illegal choice must not corrupt the game: restore the decision so the
      // caller can try again.
      s.pending = pending
      throw err
    }
    this._pump()
    return this
  }

  // ---- steps -----------------------------------------------------------

  _enterStep(step) {
    const s = this.state
    s.step = step
    this._emptyManaPools()

    switch (step) {
      case 'untap': {
        // 502: untap active player's permanents; clear summoning sickness for
        // creatures they control; reset the land-per-turn allowance.
        for (const o of objectsIn(s, 'battlefield')) {
          if (o.controller === s.activePlayer) {
            o.status.tapped = false
            o.status.summoningSick = false
            o.status.loyaltyUsed = false // a planeswalker may act again this turn
            o.status.abilityUsed = [] // once-per-turn abilities reset
          }
        }
        s.players[s.activePlayer].landsPlayed = 0
        for (const p of s.players) p.drewThisTurn = 0 // draw-count triggers are per turn
        s.spellsCastThisTurn = 0 // storm count is per turn
        break // no priority; _pump advances
      }
      case 'upkeep': {
        // 503: "at the beginning of [your] upkeep" abilities (and any delayed
        // triggers scheduled for it) go on the stack before priority.
        this._firePhaseTriggers('upkeep')
        this._grantPriority()
        break
      }
      case 'draw': {
        // 103.8a: the starting player skips only the very first draw step of the
        // game (turn 1). Every later turn — including all of theirs — draws.
        if (s.turnNumber !== 1) this.draw(s.activePlayer, 1)
        this._grantPriority()
        break
      }
      case 'end': {
        // 513: "at the beginning of the end step" abilities and delayed triggers
        // (e.g. Ball Lightning's self-sacrifice, Flickerwisp's return).
        this._firePhaseTriggers('endStep')
        this._grantPriority()
        break
      }
      case 'declareAttackers': {
        const eligible = this._eligibleAttackers()
        if (eligible.length === 0) {
          this._gotoStep('main2') // skip the rest of combat
          return
        }
        s.combat = { attackers: [], blocks: {} }
        s.pending = {
          kind: 'declareAttackers',
          player: s.activePlayer,
          eligible,
          defenders: this._attackDefenders()
        }
        break
      }
      case 'declareBlockers': {
        const def = this._defendingPlayer()
        const eligible = this._eligibleBlockers(def)
        s.pending = {
          kind: 'declareBlockers',
          player: def,
          eligible,
          attackers: s.combat.attackers
        }
        break
      }
      case 'combatDamage': {
        this._combatDamage()
        this._grantPriority()
        break
      }
      case 'endCombat': {
        for (const o of objectsIn(s, 'battlefield')) {
          o.status.attacking = false
          o.status.attackingTarget = null
          o.status.blocked = false
          o.status.blocking = null
        }
        s.combat = null
        this._grantPriority()
        break
      }
      case 'cleanup': {
        // 514: discard to hand size, then remove damage. No priority in M0.
        const ap = s.activePlayer
        const hand = zone(s, 'hand', ap)
        if (hand.length > 7) {
          s.pending = { kind: 'discard', player: ap, count: hand.length - 7, hand: [...hand] }
          return
        }
        this._endCleanup()
        break
      }
      default: {
        if (PRIORITY_STEPS.has(step)) this._grantPriority()
      }
    }
  }

  _endCleanup() {
    const s = this.state
    for (const o of objectsIn(s, 'battlefield')) {
      o.status.damage = 0
      o.status.markedDeath = false
    }
    // Control-changing effects ending: control reverts to the previous controller
    // (rule 613/514.2) before the effect is removed — e.g. Act of Treason.
    for (const e of s.continuous)
      if (e.control != null && e.duration === 'eot') {
        const o = s.objects[e.targets[0]]
        if (o && o.zoneName === 'battlefield' && o.controller === e.control) o.controller = e.prev
      }
    // "Until end of turn" effects and prevention shields wear off (rule 514.2).
    s.continuous = s.continuous.filter((e) => e.duration !== 'eot')
    s.prevent = s.prevent.filter((e) => e.duration !== 'eot')
    s.replacements = s.replacements.filter((e) => e.duration !== 'eot')
    this._emptyManaPools()
    // hand over the turn — each player's turn is numbered sequentially.
    s.activePlayer = this._otherPlayer(s.activePlayer)
    s.turnNumber++
    this._enterStep('untap')
  }

  _advanceStep() {
    const s = this.state
    const i = STEP_ORDER.indexOf(s.step)
    if (s.step === 'cleanup') {
      this._endCleanup()
      return
    }
    this._enterStep(STEP_ORDER[i + 1])
  }

  _gotoStep(step) {
    this._enterStep(step)
  }

  // ---- priority (rule 117) --------------------------------------------

  _grantPriority() {
    this._grantPriorityTo(this.state.activePlayer)
  }

  // Before any player receives priority: perform SBAs, then put waiting triggered
  // abilities on the stack (APNAP order). Then hand priority to `pid`.
  _grantPriorityTo(pid) {
    const s = this.state
    this._checkSBA()
    if (s.winner != null) return // _checkSBA set a gameOver decision
    s.priorityAfter = pid
    this._advanceTriggerPlacement() // may pause for a target choice, else grants
  }

  // Put queued triggered abilities on the stack in APNAP order. Pauses with a
  // `chooseTargets` decision when a trigger needs a target; resumes via
  // _applyChooseTargets. When the queue is empty, grants priority.
  _advanceTriggerPlacement() {
    const s = this.state
    // APNAP: active player's triggers first (they end up lowest on the stack).
    s.pendingTriggers.sort(
      (a, b) => (a.controller === s.activePlayer ? 0 : 1) - (b.controller === s.activePlayer ? 0 : 1)
    )
    while (s.pendingTriggers.length) {
      const t = s.pendingTriggers.shift()
      const spec = t.targetSpec || []
      if (spec.length) {
        if (!spec.every((sp) => this._legalTargetsExist(sp))) continue // fizzles: no legal target
        s.pending = {
          kind: 'chooseTargets',
          player: t.controller,
          sourceOid: t.sourceOid,
          name: s.objects[t.sourceOid]?.printed?.name || 'Ability',
          targets: spec,
          _trigger: t
        }
        return
      }
      this._placeTrigger(t, [])
    }
    const pid = s.priorityAfter ?? s.activePlayer
    s.prio = { player: pid, passCount: 0 }
    s.pending = { kind: 'priority', player: pid, actions: this._legalActions(pid) }
  }

  _placeTrigger(t, chosenTargets) {
    const ao = createAbility(this.state, {
      controller: t.controller,
      sourceOid: t.sourceOid,
      effect: t.effect,
      targets: chosenTargets
    })
    zone(this.state, 'stack').push(ao.oid)
    // A triggered ability that targets a warded permanent triggers its ward too —
    // but a ward's own tax ability (which targets nothing) must not recurse.
    if (!t.effect?.some?.((e) => e.op === 'wardTax')) this._checkWard(ao.oid, t.controller, chosenTargets)
  }

  _applyChooseTargets(pending, answer) {
    const src = this.state.objects[pending.sourceOid]
    this._assertTargetsLegal(answer?.targets, pending.player, src?.chars?.colors || src?.printed?.colors)
    this._placeTrigger(pending._trigger, answer?.targets || [])
    this._advanceTriggerPlacement() // continue with the rest of the queue
  }

  // Effect-driven discard (e.g. Faithless Looting). Discards the chosen cards
  // (routing madness cards to exile), then resumes the paused resolution.
  _applyDiscardCards(pending, answer) {
    // Highway Robbery's alternative: sacrifice a land instead of discarding; either
    // way "you did," so the draw follows.
    if (pending.orSacrificeLand && answer?.sacLand) {
      const land = this.state.objects[answer.sacLand]
      if (land?.controller === pending.player && land.zoneName === 'battlefield' && land.chars.types.includes('Land')) {
        this._sacrifice(land)
        if (pending.draw) this.draw(pending.player, pending.draw)
        this._processMadness(() => this._resumeResolution())
        return
      }
    }
    const max = Math.min(pending.count, pending.hand.length)
    const discard = (answer?.discard || []).slice(0, pending.count)
    if (pending.optional) {
      if (discard.length > max) throw new Error(`discard at most ${pending.count} card(s)`)
    } else if (discard.length !== max) {
      throw new Error(`must discard ${pending.count} card(s)`)
    }
    if (pending.remember && pending._source)
      pending._source._discardedNonland = discard.some(
        (oid) => !this.state.objects[oid].printed.types.includes('Land')
      )
    for (const oid of discard) this._discardCard(pending.player, oid)
    if (pending.draw && discard.length > 0) this.draw(pending.player, pending.draw)
    this._processMadness(() => this._resumeResolution())
  }

  // Finish an explore (nonland branch): `bin` puts the revealed card into the
  // graveyard; otherwise it stays on top of the library. Then resume resolution.
  _applyExplore(pending, answer) {
    if (answer?.bin) moveObject(this.state, pending.card, 'graveyard')
    this._resumeResolution()
  }

  // Resolve a scry/surveil: `toBottom` go to the bottom of the library (or the
  // graveyard, for surveil); the rest go back on top in `toTop` order.
  _applyScry(pending, answer) {
    const s = this.state
    const pid = pending.player
    const lib = s.zones[zoneKey('library', pid)]
    const scried = pending.cards
    for (const oid of scried) {
      const i = lib.indexOf(oid)
      if (i >= 0) lib.splice(i, 1)
    }
    const toBottom = (answer?.toBottom || []).filter((oid) => scried.includes(oid))
    const rest = scried.filter((oid) => !toBottom.includes(oid))
    const topOrder = answer?.toTop?.length === rest.length ? answer.toTop : rest

    if (pending.surveil) {
      for (const oid of toBottom) moveObject(s, oid, 'graveyard')
    } else {
      for (const oid of toBottom) lib.push(oid) // to the bottom
    }
    for (let i = topOrder.length - 1; i >= 0; i--) lib.unshift(topOrder[i]) // back on top

    this._resumeResolution()
  }

  // Does a battlefield object satisfy a target spec (type + exclusions)?
  _specMatches(spec, o) {
    if (spec.type === 'creature' && !o.chars.types.includes('Creature')) return false
    if (spec.type === 'land' && !o.chars.types.includes('Land')) return false
    if (spec.type === 'artifact' && !o.chars.types.includes('Artifact')) return false
    if (spec.noncreature && o.chars.types.includes('Creature')) return false
    if (spec.exclude?.some((t) => o.chars.types.includes(t))) return false
    if (spec.excludeSuper?.some((t) => o.chars.supertypes.includes(t))) return false
    // Color restriction (Doom Blade: "target nonblack creature"). Reads the current
    // characteristics, so a layer-5 color change (Aphotic Wisps) makes a creature
    // an illegal/legal target as expected.
    if (spec.excludeColor && o.chars.colors.includes(spec.excludeColor)) return false
    return true
  }

  // Untargetability (rules 702.11 hexproof, 702.18 shroud, 702.16e protection):
  // can player `byPid`, with a source of colors `sourceColors`, target permanent
  // `o` with a spell or ability? Shroud blocks everyone; hexproof blocks only the
  // controller's opponents; protection from a color blocks a source of that color.
  _targetableBy(o, byPid, sourceColors) {
    const kw = o.chars?.keywords || []
    if (kw.includes('Shroud')) return false
    if (kw.includes('Hexproof') && byPid !== o.controller) return false
    const prot = o.chars?.protections || []
    if (prot.length && (sourceColors || []).some((c) => prot.includes(c))) return false
    return true
  }

  // Is there at least one legal target for a target spec? When `ctx` ({ byPid,
  // sourceColors }) is given, untargetable permanents (hexproof/shroud/protection)
  // are excluded — so a spell whose only would-be targets are untargetable is not
  // castable (rule 601.2c).
  _legalTargetsExist(spec, ctx) {
    const s = this.state
    if (spec.type === 'player' || spec.type === 'any') return true
    if (spec.type === 'spell') return zone(s, 'stack').length > 0
    if (spec.type === 'creature' || spec.type === 'land' || spec.type === 'artifact')
      return objectsIn(s, 'battlefield').some(
        (o) => this._specMatches(spec, o) && (!ctx || this._targetableBy(o, ctx.byPid, ctx.sourceColors))
      )
    return true
  }

  // Reject a target choice that names an untargetable permanent (rule 115.6).
  // Object targets only; players/spells can't have hexproof/shroud in this pool.
  _assertTargetsLegal(chosen, byPid, sourceColors) {
    for (const t of chosen || []) {
      if (t?.kind !== 'object') continue
      const o = this.state.objects[t.oid]
      if (o && !this._targetableBy(o, byPid, sourceColors))
        throw new Error(`illegal target: ${o.chars?.name || o.printed?.name} can't be targeted`)
    }
  }

  // Is a chosen target still legal at resolution? A permanent must still be on the
  // battlefield and targetable (it may have died, been bounced, or gained
  // hexproof/shroud in response); a targeted spell must still be on the stack.
  _targetStillLegal(controllerPid, sourceColors, ref) {
    const s = this.state
    if (!ref) return false
    if (ref.kind === 'player') return s.players[ref.pid] != null
    if (ref.kind === 'spell') return zone(s, 'stack').includes(ref.oid)
    if (ref.kind === 'object') {
      const o = s.objects[ref.oid]
      if (!o || o.zoneName !== 'battlefield') return false
      return this._targetableBy(o, controllerPid, sourceColors)
    }
    return true
  }

  // A spell or ability with one or more targets doesn't resolve — it's removed
  // from the stack with no effect — if ALL of its targets are now illegal (rule
  // 608.2b, "fizzle"). Untargeted objects never fizzle for this reason.
  _fizzles(o) {
    const refs = o.targets || []
    if (refs.length === 0) return false
    const src = o.kind === 'ability' ? this.state.objects[o.sourceOid] : o
    const colors = (o.kind === 'ability' ? src?.chars?.colors : o.printed?.colors) || []
    return refs.every((r) => !this._targetStillLegal(o.controller, colors, r))
  }

  // Ward (702.21): after a spell or ability (`triggererOid`, controlled by
  // `byPid`) has been put on the stack targeting some permanents, each targeted
  // permanent with ward whose controller is an opponent of `byPid` triggers "counter
  // it unless that player pays the ward cost." The trigger is placed on the stack
  // above the triggering object, so it resolves first.
  _checkWard(triggererOid, byPid, targets) {
    const s = this.state
    for (const t of targets || []) {
      if (t?.kind !== 'object') continue
      const o = s.objects[t.oid]
      if (!o || o.zoneName !== 'battlefield') continue
      const ward = o.behavior?.ward
      if (!ward || o.controller === byPid) continue // ward only vs opponents
      s.pendingTriggers.push({
        controller: o.controller, // the warded permanent's controller
        sourceOid: o.oid,
        subjectOid: triggererOid,
        effect: [
          { op: 'wardTax', payer: byPid, targetObj: triggererOid, mana: ward.mana || null, life: ward.life ?? null, wardName: o.printed.name }
        ],
        targetSpec: []
      })
    }
  }

  // Counter an object on the stack (a spell to its owner's graveyard; an ability
  // is simply removed). Used by Ward and by counterspell-style effects.
  _counterObject(oid) {
    const s = this.state
    const o = s.objects[oid]
    if (!o) return
    if (o.kind === 'ability') {
      const st = zone(s, 'stack')
      const i = st.indexOf(oid)
      if (i >= 0) st.splice(i, 1)
      delete s.objects[oid]
    } else if (o.zoneName === 'stack') {
      moveObject(s, oid, 'graveyard')
    }
  }

  _resolvePriority(pending, answer) {
    const s = this.state
    const action = answer || { type: 'pass' }
    if (action.type === 'pass') {
      s.prio.passCount++
      if (s.prio.passCount >= s.players.length) {
        if (zone(s, 'stack').length > 0) {
          this._resolveTop()
          // Active player receives priority after a stack object resolves — unless
          // the resolution paused for a decision (e.g. scry sets _resume, a copy-as-
          // enters choice sets s.pending). This also runs SBAs and places triggers
          // the resolution made.
          if (!this._resume && !s.pending) this._grantPriorityTo(s.activePlayer)
        } else {
          s.prio = null // priority loop ends; _pump advances the step
        }
      } else {
        const next = this._otherPlayer(s.prio.player)
        s.prio.player = next
        s.pending = { kind: 'priority', player: next, actions: this._legalActions(next) }
      }
      return
    }

    // A game action was taken; the acting player retains priority afterwards —
    // unless casting paused for a madness card discarded as an additional cost
    // (the pause sets its own pending and grants priority when it drains).
    const actor = s.prio.player
    this._performAction(actor, action)
    if (s.winner != null) return
    if (!this._castPaused) this._grantPriorityTo(actor)
  }

  // ---- legal actions ---------------------------------------------------

  _legalActions(pid) {
    const s = this.state
    const actions = [{ type: 'pass' }]
    const stackEmpty = zone(s, 'stack').length === 0
    const sorcerySpeed = pid === s.activePlayer && MAIN_STEPS.has(s.step) && stackEmpty
    const player = s.players[pid]

    for (const oid of zone(s, 'hand', pid)) {
      const o = s.objects[oid]
      const p = o.printed
      if (p.types.includes('Land')) {
        if (sorcerySpeed && player.landsPlayed < 1) actions.push({ type: 'playLand', oid })
        continue
      }
      // Instants and cards with flash can be cast any time you have priority.
      const instantSpeed = p.types.includes('Instant') || p.keywords.includes('Flash')
      const canCastNow = instantSpeed || sorcerySpeed
      if (canCastNow) {
        const targets = this._spellTargets(o)
        // Untargetability context: this spell's caster + its colors, so hexproof/
        // shroud/protection exclude illegal would-be targets from the gate.
        const ctx = { byPid: pid, sourceColors: p.colors }
        // A modal spell (rule 700.2) picks `count` of its modes on cast. It's
        // castable when at least `count` modes have a legal (or no) target.
        const modal = o.behavior.spell?.modal
        const modes = o.behavior.spell?.modes
        const modeCastable = (m) => !m.targets?.length || m.targets.every((t) => this._legalTargetsExist(t, ctx))
        const modalOk = !modal || modes.filter(modeCastable).length >= (modal.count || 1)
        // A targeted spell needs a legal target to be cast (rule 601.2c). This
        // also gates counters (need a spell on the stack) and Auras (a creature).
        const targetsOk = modalOk && (!targets.length || targets.every((t) => this._legalTargetsExist(t, ctx)))
        const addl = o.behavior.spell?.additionalCost
        const addlSacOk = !addl?.sacrifice || this._sacrificeCandidates(pid, addl.sacrifice).length > 0
        // A discard additional cost (Grab the Prize) needs that many *other* cards
        // in hand to pay — you can't discard the spell you're casting.
        const addlDiscOk = !addl?.discard || zone(s, 'hand', pid).filter((h) => h !== oid).length >= addl.discard
        if (targetsOk && addlSacOk && addlDiscOk) {
          const xCost = p.manaCost.X || 0
          if (this._canPay(pid, this._effectiveCost(pid, o))) {
            actions.push({
              type: 'cast',
              oid,
              label: p.name,
              targets,
              needsTargets: targets.length,
              sacChoose: addl?.sacrifice || null,
              discChoose: addl?.discard || null,
              hasX: xCost > 0,
              maxX: xCost > 0 ? this._maxX(pid, o, xCost) : 0,
              // Modal: the renderer picks `count` modes, then targets for each.
              modal: modal || null,
              modes: modal ? modes.map((m, i) => ({ index: i, label: m.label, targets: m.targets || [], castable: modeCastable(m) })) : null
            })
          }
          // Alternative cost (e.g. Fireblast: sacrifice two Mountains instead of mana).
          const alt = o.behavior.spell?.alternativeCost
          if (
            alt?.sacrifice &&
            this._sacrificeCandidates(pid, alt.sacrifice).length >= (alt.sacrifice.count || 1)
          ) {
            actions.push({
              type: 'cast',
              oid,
              altCost: true,
              label: `${p.name} (${alt.label || 'alternative cost'})`,
              targets,
              needsTargets: targets.length,
              sacChoose: null,
              hasX: false,
              maxX: 0
            })
          }
        }
      }
      // Omen / adventure: the alternate castable half (sorcery speed).
      const om = o.behavior?.omen
      if (om && sorcerySpeed && this._canPay(pid, parseManaCost(om.cost))) {
        const t = om.targets || []
        const octx = { byPid: pid, sourceColors: p.colors }
        if (!t.length || t.every((x) => this._legalTargetsExist(x, octx)))
          actions.push({ type: 'castOmen', oid, label: om.name, targets: t, needsTargets: t.length })
      }
      // Bestow (702.103): cast the card as an Aura on a creature for its bestow cost.
      const bst = o.behavior?.bestow
      if (bst && sorcerySpeed) {
        const bcost = parseManaCost(bst.cost)
        const fixed = { ...bcost, X: 0 }
        const bx = bcost.X || 0
        if (this._legalTargetsExist({ type: 'creature' }, { byPid: pid, sourceColors: p.colors }) && this._canPay(pid, fixed)) {
          const sources = this._manaSources(pid).length
          const fixedMV =
            (fixed.generic || 0) + fixed.W + fixed.U + fixed.B + fixed.R + fixed.G + fixed.C + (fixed.hybrid?.length || 0)
          actions.push({
            type: 'castBestow',
            oid,
            label: `Bestow ${p.name}`,
            targets: [{ type: 'creature' }],
            needsTargets: 1,
            hasX: bx > 0,
            maxX: bx > 0 ? Math.max(0, sources - fixedMV) : 0
          })
        }
      }
      // Plot (702.170): a special action, sorcery-speed, that exiles the card.
      const plt = o.behavior?.plot
      if (plt && sorcerySpeed && this._canPay(pid, parseManaCost(plt.cost)))
        actions.push({ type: 'plot', oid, label: `Plot ${p.name}` })
      // Ninjutsu (702.49): swap this in for an unblocked attacker you control, in
      // the priority window after blockers are declared.
      const nin = o.behavior?.ninjutsu
      if (nin && s.combat && s.step === 'declareBlockers' && this._canPay(pid, parseManaCost(nin.cost))) {
        const returns = s.combat.attackers.filter((aoid) => {
          const a = s.objects[aoid]
          return a && a.controller === pid && a.status.attacking && !a.status.blocked
        })
        if (returns.length) actions.push({ type: 'ninjutsu', oid, label: `Ninjutsu ${p.name}`, returns })
      }
    }

    // Plotted cards: cast from exile for free on a later turn (702.170d).
    for (const oid of zone(s, 'exile', pid)) {
      const o = s.objects[oid]
      if (!o.plotted || o.plottedTurn >= s.turnNumber || !sorcerySpeed) continue
      const targets = this._spellTargets(o)
      const pctx = { byPid: pid, sourceColors: o.printed.colors }
      if (targets.length && !targets.every((t) => this._legalTargetsExist(t, pctx))) continue
      actions.push({
        type: 'castPlotted',
        oid,
        label: `${o.printed.name} (plotted)`,
        targets,
        needsTargets: targets.length
      })
    }

    // Flashback: cast a spell from your graveyard for its flashback cost.
    for (const oid of zone(s, 'graveyard', pid)) {
      const o = s.objects[oid]
      const fb = o.behavior?.flashback
      if (!fb) continue
      const instantSpeed = o.printed.types.includes('Instant')
      if (!(instantSpeed || sorcerySpeed)) continue
      // Flashback cost may be mana, a sacrifice (e.g. Lava Dart), or both.
      if (fb.cost && !this._canPay(pid, parseManaCost(fb.cost))) continue
      if (fb.sacrifice && this._sacrificeCandidates(pid, fb.sacrifice).length < (fb.sacrifice.count || 1))
        continue
      const targets = this._spellTargets(o)
      const fctx = { byPid: pid, sourceColors: o.printed.colors }
      if (targets.length && !targets.every((t) => this._legalTargetsExist(t, fctx))) continue
      actions.push({ type: 'castFlashback', oid, targets, needsTargets: targets.length })
    }

    // Activated abilities of permanents this player controls (instant speed).
    for (const oid of zone(s, 'battlefield')) {
      const o = s.objects[oid]
      if (o.controller !== pid) continue
      ;(o.behavior?.activated || []).forEach((ab, i) => {
        if (ab.manaAbility) return // mana abilities are paid automatically
        if (!this._canActivate(pid, o, ab)) return
        const targets = ab.targets || []
        const sac = ab.cost?.sacrifice
        actions.push({
          type: 'activate',
          oid,
          ability: i,
          targets,
          needsTargets: targets.length,
          loyalty: ab.loyalty, // present for planeswalker loyalty abilities
          sacChoose: sac && sac !== 'self' ? sac : null // { types } to pick a sacrifice
        })
      })
    }
    return actions
  }

  _spellTargets(o) {
    if (o.behavior.spell?.targets) return o.behavior.spell.targets
    // An Aura targets the permanent it will be attached to as it is cast.
    if (o.behavior.enchant) return [{ type: o.behavior.enchant.type }]
    return []
  }

  // A modal spell (rule 700.2): the caster picked `action.modes` (indices) and,
  // in `action.modeTargets`, the chosen targets per selected mode. Flatten the
  // selected modes into one effect list + one `targets` array so resolution is
  // identical to a normal spell. Each mode's `target0…` refs are shifted by the
  // number of targets contributed by earlier selected modes.
  _applyModalCast(o, action) {
    const modes = o.behavior.spell.modes
    const picked = action.modes || []
    const modeTargets = action.modeTargets || []
    let effect = []
    let targets = []
    picked.forEach((mi, k) => {
      const m = modes[mi]
      effect = effect.concat(this._offsetTargetRefs(m.effect, targets.length))
      targets = targets.concat(modeTargets[k] || [])
    })
    o.chosenModes = picked
    o.targets = targets
    o.spell = { ...o.behavior.spell, effect }
  }

  // Shift every `target<n>` reference in an effect list by `offset` (so a mode's
  // effects index into the combined `targets` array at the right slot).
  _offsetTargetRefs(effect, offset) {
    if (!offset) return effect
    return effect.map((e) => {
      if (typeof e.to === 'string' && /^target\d+$/.test(e.to))
        return { ...e, to: 'target' + (Number(e.to.slice(6)) + offset) }
      return e
    })
  }

  // ---- performing actions ---------------------------------------------

  _performAction(pid, action) {
    const s = this.state
    // Target legality is checked before any cost is paid (rule 601.2c): reject a
    // choice that names an untargetable permanent (hexproof/shroud/protection)
    // before committing mana. Covers every cast variant plus activated abilities;
    // for an ability the source permanent supplies the colors, otherwise the card.
    const actor = s.objects[action.oid]
    if (actor) {
      const chosen = [...(action.targets || []), ...(action.modeTargets || []).flat()]
      const colors = action.type === 'activate' ? actor.chars?.colors || actor.printed.colors : actor.printed.colors
      this._assertTargetsLegal(chosen, pid, colors)
    }
    switch (action.type) {
      case 'playLand': {
        moveObject(s, action.oid, 'battlefield')
        this._enterBattlefield(s.objects[action.oid], pid)
        s.players[pid].landsPlayed++
        break
      }
      case 'cast': {
        const o = s.objects[action.oid]
        if (action.altCost) {
          // Pay the alternative cost (e.g. Fireblast) instead of mana — auto-pick
          // the required sacrifices.
          o.xValue = 0
          const alt = o.behavior.spell.alternativeCost
          for (const so of this._sacrificeCandidates(pid, alt.sacrifice).slice(0, alt.sacrifice.count || 1))
            this._sacrifice(so)
        } else {
          const xCost = o.printed.manaCost.X || 0
          o.xValue = xCost ? action.x || 0 : 0
          const cost = this._effectiveCost(pid, o)
          this._pay(pid, { ...cost, generic: (cost.generic || 0) + o.xValue * xCost })
          // Additional cost: sacrifice a permanent (e.g. Fanatical Offering,
          // Reckoner's Bargain — which then pays off the sacrifice's mana value).
          const addl = o.behavior.spell?.additionalCost
          if (addl?.sacrifice && action.sacrifice) {
            const so = s.objects[action.sacrifice]
            if (so && so.controller === pid && so.zoneName === 'battlefield') {
              o._sacrificedMV = so.printed.manaValue
              this._sacrifice(so)
            }
          }
          // Additional cost: discard card(s) (Grab the Prize). Recorded for a later
          // conditional; a discarded madness card is still offered below.
          if (addl?.discard && action.discard?.length) {
            o._discardedNonland = action.discard.some((d) => !s.objects[d].printed.types.includes('Land'))
            for (const d of action.discard) if (zone(s, 'hand', pid).includes(d)) this._discardCard(pid, d)
          }
        }
        moveObject(s, action.oid, 'stack') // clears transient status/controller
        o.controller = pid
        if (o.behavior.spell?.modal) {
          this._applyModalCast(o, action)
        } else {
          o.targets = action.targets || []
          o.spell = o.behavior.spell
        }
        // Reject an untargetable choice (hexproof/shroud/protection) up front.
        this._countSpellCast(o)
        this._fireTriggers('castSpell', o) // prowess, storm, Guttersnipe etc.
        this._checkWard(o.oid, o.controller, o.targets)
        // A madness card discarded as a cost above is offered now, before priority
        // returns (its madness spell goes on the stack above the spell just cast).
        if (s.pendingMadness.length) {
          this._castPaused = true
          this._processMadness(() => {
            this._castPaused = false
            this._grantPriorityTo(pid)
          })
        }
        break
      }
      case 'castBestow': {
        // Bestow (702.103): cast the card as an Aura on the target creature. It's a
        // permanent spell (no o.spell), so it enters the battlefield on resolution —
        // attached, with X +1/+1 counters — via _enterBattlefield's bestow handling.
        const o = s.objects[action.oid]
        const bcost = parseManaCost(o.behavior.bestow.cost)
        const xc = bcost.X || 0
        o.xValue = xc ? action.x || 0 : 0
        this._pay(pid, { ...bcost, X: 0, generic: (bcost.generic || 0) + o.xValue })
        o.bestowCast = true
        moveObject(s, action.oid, 'stack')
        o.controller = pid
        o.targets = action.targets || []
        this._countSpellCast(o)
        this._fireTriggers('castSpell', o)
        this._checkWard(o.oid, o.controller, o.targets)
        break
      }
      case 'castFlashback': {
        const o = s.objects[action.oid]
        const fb = o.behavior.flashback
        if (fb.cost) this._pay(pid, parseManaCost(fb.cost))
        if (fb.sacrifice)
          for (const so of this._sacrificeCandidates(pid, fb.sacrifice).slice(0, fb.sacrifice.count || 1))
            this._sacrifice(so)
        moveObject(s, action.oid, 'stack')
        o.controller = pid
        o.targets = action.targets || []
        o.spell = o.behavior.spell
        o.flashbackCast = true // exiled instead of the graveyard when it leaves
        this._countSpellCast(o)
        this._fireTriggers('castSpell', o)
        this._checkWard(o.oid, o.controller, o.targets)
        break
      }
      case 'castOmen': {
        const o = s.objects[action.oid]
        this._pay(pid, parseManaCost(o.behavior.omen.cost))
        moveObject(s, action.oid, 'stack')
        o.controller = pid
        o.targets = action.targets || []
        o.spell = o.behavior.omen // the Omen half's effect
        o.omenCast = true // shuffled into the library after resolving
        this._countSpellCast(o)
        this._fireTriggers('castSpell', o)
        this._checkWard(o.oid, o.controller, o.targets)
        break
      }
      case 'activate': {
        const o = s.objects[action.oid]
        const ab = o.behavior.activated[action.ability]
        this._payActivationCost(pid, o, ab, action)
        // The ability exists on the stack independently of its source.
        const aoid = createAbility(s, {
          controller: pid,
          sourceOid: o.oid,
          effect: ab.effect,
          targets: action.targets || []
        })
        zone(s, 'stack').push(aoid.oid)
        this._checkWard(aoid.oid, pid, aoid.targets)
        break
      }
      case 'plot': {
        // Special action (116.2k / 702.170): pay the plot cost, exile the card, and
        // mark it plotted so it can be cast for free on a later turn.
        const o = s.objects[action.oid]
        this._pay(pid, parseManaCost(o.behavior.plot.cost))
        moveObject(s, action.oid, 'exile')
        o.plotted = true
        o.plottedTurn = s.turnNumber
        break
      }
      case 'castPlotted': {
        // Cast a plotted card from exile without paying its mana cost (702.170d).
        const o = s.objects[action.oid]
        o.plotted = false
        o.xValue = 0
        moveObject(s, action.oid, 'stack')
        o.controller = pid
        o.targets = action.targets || []
        o.spell = o.behavior.spell
        this._countSpellCast(o)
        this._fireTriggers('castSpell', o)
        this._checkWard(o.oid, o.controller, o.targets)
        break
      }
      case 'ninjutsu': {
        // 702.49: return an unblocked attacker to hand; put this from hand onto the
        // battlefield tapped and attacking the same defender.
        const ninja = s.objects[action.oid]
        this._pay(pid, parseManaCost(ninja.behavior.ninjutsu.cost))
        const returned = s.objects[action.returned]
        const target = returned.status.attackingTarget
        // Remove the returned creature from combat, then bounce it.
        s.combat.attackers = s.combat.attackers.filter((oid) => oid !== returned.oid)
        moveObject(s, returned.oid, 'hand')
        // The ninja enters from hand tapped and attacking the same target.
        moveObject(s, action.oid, 'battlefield')
        this._enterBattlefield(ninja, pid)
        ninja.status.tapped = true
        ninja.status.attacking = true
        ninja.status.attackingTarget = target
        s.combat.attackers.push(ninja.oid)
        break
      }
      default:
        throw new Error(`unknown action ${action.type}`)
    }
  }

  // Storm counting (702.40): record how many spells were cast before this one
  // this turn, then count this cast.
  _countSpellCast(o) {
    const s = this.state
    s.spellsCastThisTurn = (s.spellsCastThisTurn || 0) + 1
    o._stormCount = s.spellsCastThisTurn - 1
  }

  // Can `pid` currently pay ability `ab`'s activation cost with source `o`?
  _canActivate(pid, o, ab) {
    const s = this.state
    // Loyalty abilities: sorcery speed, one per planeswalker per turn, and you
    // must have enough loyalty to pay an activation that removes loyalty.
    if (ab.loyalty != null) {
      if (pid !== s.activePlayer || !MAIN_STEPS.has(s.step) || zone(s, 'stack').length > 0)
        return false
      if (o.status.loyaltyUsed) return false
      if (ab.loyalty < 0 && (o.status.counters.loyalty || 0) < -ab.loyalty) return false
    }
    // Sorcery-speed abilities (e.g. Equip) only when you'd be able to cast a sorcery.
    if (ab.sorcerySpeed) {
      if (pid !== s.activePlayer || !MAIN_STEPS.has(s.step) || zone(s, 'stack').length > 0)
        return false
    }
    if (ab.oncePerTurn && (o.status.abilityUsed || []).includes(ab)) return false
    // The ability's source (the permanent `o`) supplies the colors for protection;
    // its controller is `pid`, so hexproof only blocks it against opponents.
    const actx = { byPid: pid, sourceColors: o.chars?.colors || o.printed.colors }
    if (ab.targets?.length && !ab.targets.every((t) => this._legalTargetsExist(t, actx))) return false
    const cost = ab.cost || {}
    if (cost.tap) {
      if (o.status.tapped) return false
      if (o.printed.types.includes('Creature') && !this._canTap(o)) return false
    }
    if (cost.mana && !this._canPay(pid, parseManaCost(cost.mana))) return false
    if (cost.payLife != null && this.state.players[pid].life <= cost.payLife) return false
    // A sacrifice cost that isn't 'self' needs a permanent to sacrifice.
    if (cost.sacrifice && cost.sacrifice !== 'self' && this._sacrificeCandidates(pid, cost.sacrifice).length === 0)
      return false
    return true
  }

  // Permanents `pid` controls that match a sacrifice spec. A spec may use
  // { types: [...] }, { type }, and/or { subtype } (e.g. { subtype: 'Mountain' }).
  _sacrificeCandidates(pid, spec) {
    return objectsIn(this.state, 'battlefield').filter(
      (o) => o.controller === pid && this._sacMatches(o, spec)
    )
  }

  _sacMatches(o, spec) {
    if (spec.types && !spec.types.some((t) => o.chars.types.includes(t))) return false
    if (spec.type && !o.chars.types.includes(spec.type)) return false
    if (spec.subtype && !o.chars.subtypes.includes(spec.subtype)) return false
    return true
  }

  _payActivationCost(pid, o, ab, action = {}) {
    const s = this.state
    if (ab.oncePerTurn) (o.status.abilityUsed ||= []).push(ab)
    if (ab.loyalty != null) {
      o.status.counters.loyalty = (o.status.counters.loyalty || 0) + ab.loyalty
      o.status.loyaltyUsed = true
    }
    const cost = ab.cost || {}
    if (cost.mana) this._pay(pid, parseManaCost(cost.mana))
    if (cost.tap) o.status.tapped = true
    if (cost.payLife != null) s.players[pid].life -= cost.payLife
    if (cost.sacrifice === 'self') this._sacrifice(o)
    else if (cost.sacrifice && action.sacrifice) {
      const so = s.objects[action.sacrifice]
      if (so && so.controller === pid && so.zoneName === 'battlefield') this._sacrifice(so)
    }
  }

  _resolveTop() {
    const s = this.state
    const stack = zone(s, 'stack')
    const oid = stack[stack.length - 1]
    const o = s.objects[oid]

    if (o.kind === 'ability') {
      this._resolveObject = { oid, kind: 'ability' }
      // Countered by game rules if every target is now illegal (608.2b).
      if (this._fizzles(o)) return void this._finishResolution()
      this._runResolution(o, o.effect)
      return
    }

    if (o.spell) {
      this._resolveObject = { oid, kind: 'spell' }
      if (this._fizzles(o)) return void this._finishResolution()
      this._runResolution(o, o.spell.effect)
    } else if (isPermanent(o.printed)) {
      // "Enter as a copy of…" (rule 614.12): before the permanent is on the
      // battlefield, let its controller pick a permanent to copy. Pausing here
      // means it never briefly exists as its printed 0/0 (no SBA flicker).
      const cp = o.behavior?.copyOnEnter
      const choices = cp ? this._copyChoices(o, cp) : []
      if (cp && choices.length) {
        s.pending = { kind: 'copyEnter', oid, player: o.controller ?? o.owner, choices, optional: true }
        return
      }
      moveObject(s, oid, 'battlefield')
      this._enterBattlefield(o, o.controller ?? o.owner)
    } else {
      moveObject(s, oid, 'graveyard')
    }
  }

  // Permanents a "copy as it enters" effect may copy. Clone copies any creature;
  // the `except` clause could widen this (e.g. Phyrexian Metamorph adds artifacts).
  _copyChoices(o, cp) {
    const s = this.state
    return objectsIn(s, 'battlefield')
      .filter((t) => t.oid !== o.oid && this._copyable(t, cp))
      .map((t) => t.oid)
  }

  _copyable(t, cp) {
    if (cp.artifactOrCreature) return t.chars.types.includes('Creature') || t.chars.types.includes('Artifact')
    return t.chars.types.includes('Creature')
  }

  // Make `o` a copy of `src`'s copiable characteristics (rule 707.2 / 613 layer 1):
  // name, types, subtypes, colors, keywords, mana cost, P/T, loyalty, and printed
  // rules text (so it gains the copied card's abilities). Counters, damage, control
  // and other continuous effects are NOT copied.
  _applyCopy(o, src) {
    const p = src.printed
    o.copyOf = src.printed.name
    o.printed = {
      ...o.printed,
      name: p.name,
      manaCost: { ...p.manaCost },
      manaValue: p.manaValue,
      supertypes: [...p.supertypes],
      types: [...p.types],
      subtypes: [...p.subtypes],
      colors: [...p.colors],
      keywords: [...p.keywords],
      power: p.power,
      toughness: p.toughness,
      loyalty: p.loyalty,
      protections: [...(p.protections || [])],
      oracleText: p.oracleText
    }
    o.behavior = loadBehavior(o.printed)
    computeChars(o)
  }

  _applyCopyEnter(pending, answer) {
    const s = this.state
    const o = s.objects[pending.oid]
    if (answer?.copy != null) {
      const src = s.objects[answer.copy]
      if (src && pending.choices.includes(answer.copy)) this._applyCopy(o, src)
    }
    moveObject(s, pending.oid, 'battlefield')
    this._enterBattlefield(o, o.controller ?? o.owner)
    if (!this._resume) this._grantPriorityTo(s.activePlayer)
  }

  // Run a resolution's effects; if an interactive effect (e.g. scry) pauses it,
  // this._resume holds the continuation and _finishResolution runs after the
  // player's choice (see _applyScry). Returns true if it paused.
  _runResolution(source, effects) {
    const done = this._runEffectsFrom(source, effects, 0)
    if (done) this._finishResolution()
    return !done
  }

  _finishResolution() {
    const s = this.state
    const ctx = this._resolveObject
    this._resolveObject = null
    if (!ctx) return
    const o = s.objects[ctx.oid]
    if (ctx.kind === 'ability') {
      const st = zone(s, 'stack')
      const i = st.indexOf(ctx.oid)
      if (i >= 0) st.splice(i, 1)
      delete s.objects[ctx.oid]
    } else if (o?.zoneName === 'stack') {
      // The spell may already have been removed (e.g. countered). An Omen half is
      // shuffled into its owner's library; flashback/madness spells are exiled.
      if (o.omenCast) {
        moveObject(s, ctx.oid, 'library')
        const lk = zoneKey('library', o.owner)
        s.zones[lk] = s.rng.shuffle(s.zones[lk])
      } else {
        moveObject(s, ctx.oid, o.flashbackCast || o.madnessCast ? 'exile' : 'graveyard')
      }
      o.flashbackCast = false
      o.madnessCast = false
      o.omenCast = false
    }
  }

  // Resume a paused resolution after an interactive effect's decision.
  _resumeResolution() {
    if (!this._resume) return
    const { source, effects, index } = this._resume
    this._resume = null
    const done = this._runEffectsFrom(source, effects, index)
    if (done) this._finishResolution()
    if (!this._resume) this._grantPriorityTo(this.state.activePlayer)
  }

  // Create one token from a token definition and put it onto the battlefield.
  // The renderer resolves art from Scryfall by the token's characteristics.
  _createToken(def, controller) {
    const s = this.state
    const types = def.types || ['Creature']
    const sf = {
      name: def.name,
      type_line: `Token ${types.join(' ')}${def.subtypes?.length ? ' — ' + def.subtypes.join(' ') : ''}`,
      power: def.power != null ? String(def.power) : undefined,
      toughness: def.toughness != null ? String(def.toughness) : undefined,
      colors: def.colors || [],
      keywords: def.keywords || []
    }
    const o = createObject(s, sf, controller)
    o.token = true
    o.tokenDef = def
    o.zoneName = 'battlefield'
    s.zones.battlefield.push(o.oid)
    this._enterBattlefield(o, controller)
    if (def.tapped) o.status.tapped = true
  }

  // Shared entry point for a permanent arriving on the battlefield: fix control,
  // apply summoning sickness to creatures, and fire enters-the-battlefield
  // triggers (both the object's own and other permanents watching).
  _enterBattlefield(o, controller) {
    o.controller = controller
    o.timestamp = ++this.state.tsCounter // for layer ordering (rule 613.7)
    if (o.printed.types.includes('Creature')) o.status.summoningSick = true
    if (o.behavior?.entersTapped) o.status.tapped = true
    // Replacement effect: "enters with N counters" (applied before SBAs, so a
    // 0/0 that enters with +1/+1 counters survives).
    const ew = o.behavior?.entersWith
    if (ew) o.status.counters[ew.counter] = (o.status.counters[ew.counter] || 0) + this._amount(o, ew.amount)
    // A planeswalker enters with loyalty counters equal to its printed loyalty.
    if (o.printed.loyalty != null) o.status.counters.loyalty = o.printed.loyalty
    // An Aura enters attached to the permanent it targeted as it was cast.
    if (o.behavior?.enchant && o.targets?.[0]?.oid) o.status.attachedTo = o.targets[0].oid
    // A Bestow spell enters attached as an Aura (it's not a creature while attached).
    if (o.bestowCast && o.targets?.[0]?.oid) {
      o.status.attachedTo = o.targets[0].oid
      o.bestowed = true
    }
    this._fireTriggers('etb', o) // alias of enters:battlefield
    this._fireTriggers('enters:battlefield', o)
  }

  // ---- effects ---------------------------------------------------------

  // Apply effects from index `start`. Returns true if all ran, or false if an
  // interactive effect paused (this._resume holds the continuation).
  _runEffectsFrom(source, effects, start = 0) {
    const s = this.state
    const list = effects || []
    for (let i = start; i < list.length; i++) {
      const e = list[i]
      if (this._applyEffect(source, e)) {
        this._resume = { source, effects: list, index: i + 1 }
        return false // paused for a decision
      }
    }
    return true
  }

  // Apply one effect. Returns true if it paused for an interactive decision.
  _applyEffect(source, e) {
    const s = this.state
    switch (e.op) {
      case 'scry': {
        const pid = source.controller
        const top = zone(s, 'library', pid).slice(0, e.amount)
        if (top.length === 0) return false
        s.pending = { kind: 'scry', player: pid, cards: [...top], surveil: false }
        return true
      }
      case 'surveil': {
        const pid = source.controller
        const top = zone(s, 'library', pid).slice(0, e.amount)
        if (top.length === 0) return false
        s.pending = { kind: 'scry', player: pid, cards: [...top], surveil: true }
        return true
      }
      case 'discard': {
        const pid = source.controller
        const hand = zone(s, 'hand', pid)
        const count = Math.min(e.amount, hand.length)
        // "…or sacrifice a land" (Highway Robbery): the option stays open even with
        // an empty hand, as long as the player controls a land to sacrifice.
        const canSacLand =
          !!e.orSacrificeLand &&
          objectsIn(s, 'battlefield').some((o) => o.controller === pid && o.chars.types.includes('Land'))
        if (count === 0 && !canSacLand) return false
        s.pending = {
          kind: 'discardCards',
          player: pid,
          count,
          hand: [...hand],
          optional: !!e.optional, // "you may discard…"
          draw: e.draw || 0, // draw this many if you discarded ("if you do, draw…")
          remember: !!e.remember, // record non-land-ness for a later conditional
          orSacrificeLand: canSacLand, // may sacrifice a land instead of discarding
          _source: source
        }
        return true
      }
      case 'search': {
        // A player searches their library for a card matching a filter.
        const pid = this._resolvePlayerRef(source, e.by || 'controller')
        const matches = zone(s, 'library', pid).filter((oid) =>
          this._matchCardFilter(s.objects[oid], e.filter)
        )
        if (matches.length === 0) return false // nothing to find
        s.pending = {
          kind: 'search',
          player: pid,
          cards: [...matches],
          to: e.to || 'hand',
          tapped: !!e.tapped,
          optional: e.optional !== false,
          shuffle: true
        }
        return true
      }
      case 'optionalPay': {
        // "You may pay {cost}. If you do, <effect>." (e.g. Nihil Spellbomb.)
        const pid = source.controller
        s.pending = {
          kind: 'mayPay',
          player: pid,
          cost: e.cost,
          canPay: this._canPay(pid, parseManaCost(e.cost)),
          _source: source,
          _effect: e.effect
        }
        return true
      }
      case 'wardTax': {
        // Ward (702.21): the player who targeted the warded permanent must pay the
        // ward cost or their spell/ability is countered. If the triggering object
        // is already gone (countered/fizzled otherwise), nothing to do.
        const tgt = s.objects[e.targetObj]
        const onStack = tgt && (tgt.kind === 'ability' ? zone(s, 'stack').includes(e.targetObj) : tgt.zoneName === 'stack')
        if (!onStack) return false
        const canPay = e.life != null ? s.players[e.payer].life >= e.life : this._canPay(e.payer, parseManaCost(e.mana))
        s.pending = {
          kind: 'wardPay',
          player: e.payer,
          mana: e.mana || null,
          life: e.life ?? null,
          canPay,
          wardName: e.wardName,
          _targetObj: e.targetObj
        }
        return true
      }
      case 'eachOpponentDiscards': {
        const opp = this._otherPlayer(source.controller)
        const hand = zone(s, 'hand', opp)
        if (hand.length === 0) {
          if (e.drawIfEmpty) this.draw(source.controller, 1) // "for each who can't, draw"
          return false
        }
        s.pending = { kind: 'discardCards', player: opp, count: 1, hand: [...hand] }
        return true
      }
      case 'returnFromGraveyard': {
        // Choose a matching card from any graveyard and return it to its owner's hand.
        const pid = source.controller
        const cards = []
        for (const p of s.players)
          for (const oid of zone(s, 'graveyard', p.id))
            if (this._matchCardFilter(s.objects[oid], e.filter)) cards.push(oid)
        if (cards.length === 0) return false
        s.pending = { kind: 'search', player: pid, cards, to: 'hand', tapped: false, optional: e.optional === true, shuffle: false }
        return true
      }
      case 'explore': {
        // 701.40: reveal the top card of your library. A land goes to your hand;
        // otherwise the exploring creature gets a +1/+1 counter and you choose to
        // leave the card on top or put it in your graveyard (a paused decision).
        const t = this._resolveTargetRef(source, e.to)
        const pid = source.controller
        const lib = zone(s, 'library', pid)
        if (lib.length === 0) return false
        const topOid = lib[0]
        if (s.objects[topOid].printed.types.includes('Land')) {
          moveObject(s, topOid, 'hand')
          return false
        }
        if (t?.kind === 'object' && t.obj.zoneName === 'battlefield')
          t.obj.status.counters['+1/+1'] = (t.obj.status.counters['+1/+1'] || 0) + 1
        s.pending = { kind: 'explore', player: pid, card: topOid }
        return true
      }
      default:
        this._runEffects(source, [e])
        return false
    }
  }

  _runEffects(source, effects) {
    const s = this.state
    for (const e of effects || []) {
      switch (e.op) {
        case 'dealDamage': {
          const t = this._resolveTargetRef(source, e.to)
          if (!t) break
          // Metalcraft (Galvanic Blast): a higher amount if you control 3+ artifacts.
          let amt = this._amount(source, e.amount)
          if (e.metalcraft && this._artifactCount(source.controller) >= 3) amt = e.metalcraft
          if (t.kind === 'player') this._dealDamage(source, { player: t.pid }, amt)
          else if (t.kind === 'object') this._dealDamage(source, { obj: t.obj }, amt)
          break
        }
        case 'addMana':
          s.players[source.controller].manaPool[e.mana]++
          break
        case 'draw':
          this.draw(source.controller, e.amount || 1)
          break
        case 'gainLife':
          this._gainLife(source.controller, this._amount(source, e.amount))
          break
        case 'preventNextDamage': {
          // Create a floating shield: "prevent the next N damage that would be dealt
          // to [target] this turn" (Samite Healer). Cleared at end of turn.
          const t = this._resolveTargetRef(source, e.to)
          const n = this._amount(source, e.amount ?? 1)
          let tref = null
          if (t?.kind === 'player') tref = { player: t.pid }
          else if (t?.kind === 'object') tref = { oid: t.obj.oid }
          if (tref) s.replacements.push({ event: 'damage', target: tref, remaining: n, duration: 'eot' })
          break
        }
        case 'dealDamageEach': {
          // Damage to each permanent matching a filter (e.g. every creature).
          for (const oid of [...zone(s, 'battlefield')]) {
            const t = s.objects[oid]
            if (!t) continue
            if (e.filter === 'creature' && !t.chars.types.includes('Creature')) continue
            if (e.excludeFlying && this._hasKW(t, 'Flying')) continue
            this._dealDamage(source, { obj: t }, e.amount)
          }
          break
        }
        case 'dealDamageEachOpponent': {
          // Guttersnipe / Voldaren Epicure / Grab the Prize. A condition of
          // 'discardedNonland' gates on what was discarded earlier this resolution.
          if (e.condition === 'discardedNonland' && !source._discardedNonland) break
          const amt = this._amount(source, e.amount)
          for (const p of s.players)
            if (p.id !== source.controller) this._dealDamage(source, { player: p.id }, amt)
          break
        }
        case 'returnSelfTapped': {
          // Sneaky Snacker: return the source from its graveyard to the battlefield tapped.
          const o = s.objects[source.sourceOid]
          if (o && o.zoneName === 'graveyard') {
            moveObject(s, o.oid, 'battlefield')
            this._enterBattlefield(o, o.owner)
            o.status.tapped = true
          }
          break
        }
        case 'loseLife':
          s.players[source.controller].life -= e.amount
          break
        case 'destroy': {
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield' && !this._hasKW(t.obj, 'Indestructible'))
            this._bury(t.obj)
          break
        }
        case 'bounce': {
          // Return a permanent to its owner's hand (Snap, and general bounce).
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield') this._relocate(t.obj, 'hand')
          break
        }
        case 'untapLands': {
          // Untap up to N lands the controller controls (Snap's "untap two lands").
          let n = e.amount || 0
          for (const o of objectsIn(s, 'battlefield')) {
            if (n <= 0) break
            if (o.controller === source.controller && o.chars.types.includes('Land') && o.status.tapped) {
              o.status.tapped = false
              n--
            }
          }
          break
        }
        case 'setColors': {
          // "Target creature becomes [color]…" (Aphotic Wisps) — a layer-5 color
          // change, optionally granting a keyword, until end of turn.
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object')
            s.continuous.push({
              timestamp: ++s.tsCounter,
              targets: [t.obj.oid],
              setColors: [...e.colors],
              grantKeywords: e.keywords ? [...e.keywords] : undefined,
              duration: e.duration || 'eot'
            })
          break
        }
        case 'tapAll': {
          // Tap every permanent matching a filter (Cryptic Command: "tap all
          // creatures your opponents control").
          for (const o of objectsIn(s, 'battlefield')) {
            if (e.who === 'opponents' && o.controller === source.controller) continue
            if (e.filter?.type === 'creature' && !o.chars.types.includes('Creature')) continue
            o.status.tapped = true
          }
          break
        }
        case 'addCounter': {
          // Put counters on a permanent (e.g. Writhing Chrysalis growing itself).
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield') {
            const kind = e.counter || '+1/+1'
            t.obj.status.counters[kind] = (t.obj.status.counters[kind] || 0) + (e.amount || 1)
          }
          break
        }
        case 'counter': {
          const t = this._resolveTargetRef(source, e.to)
          // Remove the target spell from the stack to its owner's graveyard.
          // Spellstutter Sprite: only if its mana value <= Faeries you control.
          if (t?.kind === 'object' && t.obj.zoneName === 'stack') {
            if (e.maxMv === 'faeries' && (t.obj.printed.manaValue || 0) > this._faerieCount(source.controller))
              break
            moveObject(s, t.obj.oid, 'graveyard')
          }
          break
        }
        case 'pump': {
          // A one-shot continuous P/T modification (rule 613.7d), usually EOT.
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object')
            s.continuous.push({
              timestamp: ++s.tsCounter,
              targets: [t.obj.oid],
              modifyPT: { power: e.power || 0, toughness: e.toughness || 0 },
              duration: e.duration || 'eot'
            })
          break
        }
        case 'grantKeyword': {
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object')
            s.continuous.push({
              timestamp: ++s.tsCounter,
              targets: [t.obj.oid],
              grantKeywords: [e.keyword],
              duration: e.duration || 'eot'
            })
          break
        }
        case 'preventAllCombat':
          s.prevent.push({ type: 'allCombat', duration: e.duration || 'eot' })
          break
        case 'sacrificeSelf': {
          // The source permanent sacrifices itself (Ball Lightning's end-step trigger).
          const o = s.objects[source.sourceOid]
          if (o && o.zoneName === 'battlefield') this._sacrifice(o)
          break
        }
        case 'gainControl': {
          // Layer-2 control-changing effect (rule 613.1b). Records the previous
          // controller so control reverts when the effect ends (Act of Treason).
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield' && t.obj.controller !== source.controller) {
            const o = t.obj
            const dur = e.duration || 'eot'
            s.continuous.push({
              timestamp: ++s.tsCounter,
              control: source.controller,
              prev: o.controller,
              targets: [o.oid],
              duration: dur
            })
            o.controller = source.controller
            o.status.summoningSick = true // not under your control since your turn began
            if (e.untap) o.status.tapped = false
            if (e.haste)
              s.continuous.push({ timestamp: ++s.tsCounter, grantKeywords: ['Haste'], targets: [o.oid], duration: dur })
          }
          break
        }
        case 'exileReturnEndStep': {
          // Flickerwisp: exile the target and schedule a delayed trigger (603.7) to
          // return it under its owner's control at the beginning of the next end step.
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield') {
            const oid = t.obj.oid
            moveObject(s, oid, 'exile')
            s.delayedTriggers.push({
              event: 'endStep',
              controller: source.controller,
              effect: [{ op: 'returnToBattlefield', oid }]
            })
          }
          break
        }
        case 'returnToBattlefield': {
          // Return a specific exiled card to the battlefield under its owner's control.
          const o = s.objects[e.oid]
          if (o && o.zoneName === 'exile') {
            moveObject(s, o.oid, 'battlefield')
            this._enterBattlefield(o, o.owner)
          }
          break
        }
        case 'attach': {
          // Move the ability's source (an Equipment) onto the target creature.
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && s.objects[source.sourceOid])
            s.objects[source.sourceOid].status.attachedTo = t.obj.oid
          break
        }
        case 'createToken': {
          const def = e.token
          for (let i = 0; i < (e.count || 1); i++) this._createToken(def, source.controller)
          break
        }
        case 'animate': {
          // Kenku Artificer: put +1/+1 counters on a noncreature artifact and turn
          // it into a creature (a floating layer-4/6/7b effect + real counters).
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object') {
            const o = t.obj
            s.continuous.push({
              timestamp: ++s.tsCounter,
              targets: [o.oid],
              addTypes: e.addTypes || [],
              addSubtypes: e.addSubtypes || [],
              setPT: e.basePower != null ? { power: e.basePower, toughness: e.baseToughness } : null,
              grantKeywords: e.keywords || [],
              duration: e.duration || 'permanent'
            })
            if (e.counters) o.status.counters['+1/+1'] = (o.status.counters['+1/+1'] || 0) + e.counters
          }
          break
        }
        case 'stormCopy': {
          // Storm (702.40): put a copy of the storm spell on the stack for each
          // other spell cast before it this turn. Copies keep the original's
          // targets (retargeting the copies is not offered) and cease to exist
          // after resolving (they resolve as effect-only abilities).
          const spell = s.objects[source.sourceOid]
          if (!spell || !spell.spell) break
          const n = spell._stormCount || 0
          for (let i = 0; i < n; i++) {
            const copy = createAbility(s, {
              controller: source.controller,
              sourceOid: source.sourceOid,
              effect: spell.spell.effect,
              targets: spell.targets || []
            })
            zone(s, 'stack').push(copy.oid)
          }
          break
        }
        case 'shuffleIntoLibrary': {
          const o = e.of === 'self' ? s.objects[source.sourceOid] : null
          if (o) {
            moveObject(s, o.oid, 'library')
            const lk = zoneKey('library', o.owner)
            s.zones[lk] = s.rng.shuffle(s.zones[lk])
          }
          break
        }
        case 'exileGraveyard': {
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'player') for (const oid of [...zone(s, 'graveyard', t.pid)]) moveObject(s, oid, 'exile')
          break
        }
        default:
          throw new Error(`unknown effect op ${e.op}`)
      }
    }
  }

  // Resolve a player reference in an effect: 'controller' or 'target<i>' (the
  // controller of that target).
  _resolvePlayerRef(source, ref) {
    if (ref?.startsWith?.('target')) {
      const t = source.targets?.[Number(ref.slice('target'.length))]
      if (t?.kind === 'player') return t.pid
      if (t?.oid) return this.state.objects[t.oid]?.controller ?? source.controller
    }
    return source.controller
  }

  _matchCardFilter(o, filter) {
    if (!filter) return true
    const p = o.printed
    if (filter.supertype && !p.supertypes.includes(filter.supertype)) return false
    if (filter.type && !p.types.includes(filter.type)) return false
    if (filter.types && !filter.types.some((t) => p.types.includes(t))) return false
    if (filter.subtype && !p.subtypes.includes(filter.subtype)) return false
    return true
  }

  _applyMayPay(pending, answer) {
    if (answer?.pay && pending.canPay) {
      this._pay(pending.player, parseManaCost(pending.cost))
      this._runEffects(pending._source, pending._effect)
    }
    this._resumeResolution()
  }

  // Ward: the targeter either pays the cost (and their spell/ability survives) or
  // it is countered (702.21c). Paying is only possible if they can afford it.
  _applyWardPay(pending, answer) {
    const s = this.state
    if (answer?.pay && pending.canPay) {
      if (pending.life != null) s.players[pending.player].life -= pending.life
      else this._pay(pending.player, parseManaCost(pending.mana))
    } else {
      this._counterObject(pending._targetObj)
    }
    this._resumeResolution()
  }

  // Move a searched card to its destination and shuffle the library.
  _applySearch(pending, answer) {
    const s = this.state
    const pid = pending.player
    const pick = answer?.pick
    if (pick && pending.cards.includes(pick)) {
      if (pending.to === 'battlefield') {
        const lib = s.zones[zoneKey('library', pid)]
        const i = lib.indexOf(pick)
        if (i >= 0) lib.splice(i, 1)
        const o = s.objects[pick]
        o.zoneName = 'battlefield'
        s.zones.battlefield.push(o.oid)
        this._enterBattlefield(o, pid)
        if (pending.tapped) o.status.tapped = true
      } else {
        moveObject(s, pick, pending.to)
      }
    }
    if (pending.shuffle) s.zones[zoneKey('library', pid)] = s.rng.shuffle(s.zones[zoneKey('library', pid)])
    this._resumeResolution()
  }

  _resolveTargetRef(source, ref) {
    // 'self' — the source permanent of an activated/triggered ability.
    if (ref === 'self') {
      const obj = this.state.objects[source.sourceOid]
      return obj ? { kind: 'object', obj } : null
    }
    if (!ref?.startsWith?.('target')) return null
    const idx = Number(ref.slice('target'.length))
    const t = source.targets?.[idx]
    if (!t) return null
    if (t.kind === 'player') return { kind: 'player', pid: t.pid }
    return { kind: 'object', obj: this.state.objects[t.oid] }
  }

  // ---- mana (rule 605 mana abilities resolve immediately) --------------

  // Untapped sources the player can tap for one mana each, with the colors each
  // can produce (dual/any lands produce more than one).
  _manaSources(pid) {
    const s = this.state
    const out = []
    for (const o of objectsIn(s, 'battlefield')) {
      if (o.controller !== pid || o.status.tapped) continue
      const colors = manaAbilityColors(o)
      if (!colors.length) continue
      // creatures with a {T} mana ability need no summoning sickness (haste ok)
      if (o.printed.types.includes('Creature') && !this._canTap(o)) continue
      out.push({ oid: o.oid, colors })
    }
    return out
  }

  // Assign colored pips to matching sources (most-constrained first), then pay
  // generic from anything left. Returns source oids to tap, or null if unpayable.
  _planPayment(cost, sources) {
    const avail = sources.map((s) => ({ oid: s.oid, colors: s.colors }))
    const chosen = []
    for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) {
      let need = cost[c] || 0
      while (need-- > 0) {
        const cands = avail
          .filter((s) => s.colors.includes(c))
          .sort((a, b) => a.colors.length - b.colors.length)
        if (!cands.length) return null
        const src = cands[0]
        avail.splice(avail.indexOf(src), 1)
        chosen.push(src.oid)
      }
    }
    // Hybrid pips: each payable by a source producing any of its options.
    for (const options of cost.hybrid || []) {
      const cands = avail
        .filter((s) => options.some((c) => s.colors.includes(c)))
        .sort((a, b) => a.colors.length - b.colors.length)
      if (!cands.length) return null
      const src = cands[0]
      avail.splice(avail.indexOf(src), 1)
      chosen.push(src.oid)
    }
    let generic = cost.generic || 0
    if (avail.length < generic) return null
    for (let i = 0; i < generic; i++) chosen.push(avail[i].oid)
    return chosen
  }

  // The mana cost to cast `o`, after cost reductions (affinity for artifacts).
  _effectiveCost(pid, o) {
    const cost = { ...o.printed.manaCost }
    if (/affinity for artifacts/i.test(o.printed.oracleText || '')) {
      const artifacts = objectsIn(this.state, 'battlefield').filter(
        (x) => x.controller === pid && x.chars.types.includes('Artifact')
      ).length
      cost.generic = Math.max(0, (cost.generic || 0) - artifacts)
    }
    // Rule-modifying statics that raise or lower this spell's cost (Thalia, Goblin
    // Warchief, medallions, …). Increases apply before reductions (601.2f order),
    // and generic is clamped at 0 — a reduction never touches colored pips.
    let delta = 0
    for (const { source, mod } of this._ruleMods()) {
      if (mod.costMod && this._spellMatchesFilter(pid, o, mod.costMod.spell, source))
        delta += mod.costMod.generic
    }
    if (delta) cost.generic = Math.max(0, (cost.generic || 0) + delta)
    return cost
  }

  // ---- rule-modifying static effects (rule 613.11) --------------------
  // Permanents can carry `staticRules` that change what players may do rather
  // than any object's characteristics. Collected fresh each query so leaving the
  // battlefield removes the effect automatically.
  _ruleMods() {
    const out = []
    for (const src of objectsIn(this.state, 'battlefield'))
      for (const mod of src.behavior?.staticRules || []) out.push({ source: src, mod })
    return out
  }

  // Does a cost-modifier's spell filter match spell `o` cast by `pid`? `o` may be
  // a hand/graveyard card not yet on the stack, so match on printed characteristics.
  _spellMatchesFilter(pid, o, f, source) {
    if (!f) return true
    const p = o.printed
    if (f.controller === 'you' && pid !== source.controller) return false
    if (f.controller === 'opponent' && pid === source.controller) return false
    if (f.subtype && !p.subtypes.includes(f.subtype)) return false
    if (f.type && !p.types.includes(f.type)) return false
    if (f.noncreature && p.types.includes('Creature')) return false
    return true
  }

  // Is creature `o` forbidden from attacking / blocking by an active rule-modifier
  // (Pacifism, etc.)? `action` is 'attack' or 'block'.
  _restricted(o, action) {
    for (const { source, mod } of this._ruleMods())
      if (mod.restrict?.includes(action) && matchStatic(mod.affects, source, o)) return true
    return false
  }

  // Largest X affordable for an X spell given current mana (X is generic).
  _maxX(pid, o, xCost) {
    const base = this._effectiveCost(pid, o)
    const sources = this._manaSources(pid).length
    const baseMv =
      (base.generic || 0) + base.W + base.U + base.B + base.R + base.G + base.C + (base.hybrid?.length || 0)
    return Math.max(0, Math.floor((sources - baseMv) / xCost))
  }

  // Resolve a numeric effect value that may be 'X' (the source's chosen X) or
  // 'sacrificedMV' (the mana value of a permanent sacrificed to cast the source).
  _amount(source, v) {
    if (v === 'X') return source?.xValue || 0
    if (v === 'sacrificedMV') return source?._sacrificedMV || 0
    return v
  }

  // Number of artifacts a player controls (affinity / metalcraft).
  _artifactCount(pid) {
    return objectsIn(this.state, 'battlefield').filter(
      (o) => o.controller === pid && o.chars.types.includes('Artifact')
    ).length
  }

  _canPay(pid, cost) {
    return this._planPayment(cost, this._manaSources(pid)) != null
  }

  _pay(pid, cost) {
    const plan = this._planPayment(cost, this._manaSources(pid))
    if (!plan) throw new Error('cannot pay cost')
    for (const oid of plan) this.state.objects[oid].status.tapped = true
  }

  _emptyManaPools() {
    for (const p of this.state.players)
      p.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  }

  // ---- combat (rules 508–510) -----------------------------------------

  _eligibleAttackers() {
    const s = this.state
    return objectsIn(s, 'battlefield')
      .filter(
        (o) =>
          o.controller === s.activePlayer &&
          o.chars.types.includes('Creature') &&
          !o.status.tapped &&
          !this._hasKW(o, 'Defender') && // creatures with defender can't attack
          !this._restricted(o, 'attack') && // Pacifism etc.
          this._canTap(o) // haste overrides summoning sickness
      )
      .map((o) => o.oid)
  }

  // Summoning sickness prevents attacking / {T} abilities unless the creature has
  // haste (or is not a creature).
  _canTap(o) {
    return !o.status.summoningSick || this._hasKW(o, 'Haste')
  }

  _applyAttackers(answer) {
    const s = this.state
    const def = this._defendingPlayer()
    // Entries may be bare oids (attack the defending player) or { oid, defender }
    // where defender is { player } or { planeswalker }.
    const entries = (answer?.attackers || []).map((a) =>
      typeof a === 'string' ? { oid: a, defender: { player: def } } : a
    )
    for (const { oid, defender } of entries) {
      const o = s.objects[oid]
      o.status.attacking = true
      o.status.attackingTarget = defender || { player: def }
      if (!this._hasKW(o, 'Vigilance')) o.status.tapped = true
      this._fireTriggers('attacks', o)
    }
    s.combat.attackers = entries.map((e) => e.oid)
    if (entries.length === 0) {
      this._gotoStep('main2')
      return
    }
    this._grantPriority()
  }

  _defendingPlayer() {
    return this._otherPlayer(this.state.activePlayer)
  }

  // Legal things an attacker may be declared against: the defending player and
  // each planeswalker they control.
  _attackDefenders() {
    const s = this.state
    const def = this._defendingPlayer()
    const out = [{ kind: 'player', pid: def, name: s.players[def].name }]
    for (const o of objectsIn(s, 'battlefield')) {
      if (o.controller === def && o.chars.types.includes('Planeswalker'))
        out.push({ kind: 'planeswalker', oid: o.oid, name: o.chars.name, loyalty: o.status.counters.loyalty })
    }
    return out
  }

  // Resolve an attacker's declared target into a _dealDamage target.
  _attackTargetOf(atk) {
    const t = atk.status.attackingTarget
    if (t?.planeswalker && this.state.objects[t.planeswalker]?.zoneName === 'battlefield')
      return { obj: this.state.objects[t.planeswalker] }
    return { player: t?.player ?? this._defendingPlayer() }
  }

  _eligibleBlockers(pid) {
    const s = this.state
    return objectsIn(s, 'battlefield')
      .filter(
        (o) =>
          o.controller === pid &&
          o.chars.types.includes('Creature') &&
          !o.status.tapped &&
          !this._restricted(o, 'block') // Pacifism etc.
      )
      .map((o) => o.oid)
  }

  // Can `blocker` legally block `attacker`? Evasion (flyers need flying/reach)
  // and protection (a creature can't be blocked by the colors it's protected from).
  _canBlock(blocker, attacker) {
    if (this._hasKW(attacker, 'Flying') && !this._hasKW(blocker, 'Flying') && !this._hasKW(blocker, 'Reach'))
      return false
    const prot = attacker.chars.protections || []
    if (prot.length && (blocker.chars.colors || []).some((c) => prot.includes(c))) return false
    return true
  }

  _applyBlockers(answer) {
    const s = this.state
    const blocks = answer?.blocks || {}

    // Validate legality before committing (evasion + menace).
    const perAttacker = {}
    for (const [blockerOid, attackerOid] of Object.entries(blocks)) {
      const b = s.objects[blockerOid]
      const a = s.objects[attackerOid]
      if (!b || !a || !a.status.attacking) throw new Error('illegal block: not an attacker')
      if (this._restricted(b, 'block')) throw new Error(`illegal block: ${b.chars.name} can't block`)
      if (!this._canBlock(b, a)) throw new Error(`illegal block: ${b.chars.name} cannot block a flyer`)
      ;(perAttacker[attackerOid] ||= []).push(blockerOid)
    }
    for (const atkOid of s.combat.attackers) {
      const n = perAttacker[atkOid]?.length || 0
      if (n === 1 && this._hasKW(s.objects[atkOid], 'Menace'))
        throw new Error('illegal block: menace must be blocked by two or more creatures')
    }

    s.combat.blocks = blocks
    for (const [blockerOid, attackerOid] of Object.entries(blocks)) {
      s.objects[blockerOid].status.blocking = attackerOid
      s.objects[attackerOid].status.blocked = true // stays blocked even if blockers leave
    }
    this._grantPriority()
  }

  // Combat damage. If any combatant has first/double strike we run two passes
  // (first-strike, then regular) with SBAs between, so first strikers can kill a
  // blocker before it hits back. (M2 grants priority once, after both passes.)
  _combatDamage() {
    const s = this.state
    recompute(s) // fresh P/T (anthems, pumps) before assigning damage
    const combatants = [
      ...s.combat.attackers.map((oid) => s.objects[oid]),
      ...Object.keys(s.combat.blocks).map((oid) => s.objects[oid])
    ].filter(Boolean)
    const anyFS = combatants.some(
      (o) => this._hasKW(o, 'First strike') || this._hasKW(o, 'Double strike')
    )
    if (anyFS) {
      this._combatDamagePass('first')
      this._checkSBA()
      this._combatDamagePass('regular')
    } else {
      this._combatDamagePass('all')
    }
  }

  // Which creatures deal damage in this pass.
  _dealsInPass(o, pass) {
    if (pass === 'all') return true
    const fs = this._hasKW(o, 'First strike')
    const ds = this._hasKW(o, 'Double strike')
    if (pass === 'first') return fs || ds
    return ds || !fs // regular: double strikers again, and non-first-strikers
  }

  _combatDamagePass(pass) {
    const s = this.state
    const def = this._defendingPlayer()
    const onBf = (oid) => s.objects[oid] && s.objects[oid].zoneName === 'battlefield'

    // Attackers deal damage.
    for (const atkOid of s.combat.attackers) {
      const atk = s.objects[atkOid]
      if (!onBf(atkOid) || !this._dealsInPass(atk, pass)) continue
      const power = atk.chars.power
      const blockers = (s.combat.blocks
        ? Object.entries(s.combat.blocks)
            .filter(([, a]) => a === atkOid)
            .map(([b]) => b)
        : []
      ).filter((b) => onBf(b) && s.objects[b].status.blocking === atkOid)

      const tgt = this._attackTargetOf(atk)
      if (!atk.status.blocked) {
        this._dealDamage(atk, tgt, power, { combat: true }) // unblocked → its target
      } else if (blockers.length === 0) {
        // Blocked but all blockers gone: only trample leaks through.
        if (this._hasKW(atk, 'Trample')) this._dealDamage(atk, tgt, power, { combat: true })
      } else {
        // Multiple blockers (509.2 / 510.1c): assign damage down the blocker
        // order, at least lethal to each before moving on. Any leftover goes to
        // the last blocker (or, with trample, over the top to the target).
        let remaining = power
        const trample = this._hasKW(atk, 'Trample')
        const deathtouch = this._hasKW(atk, 'Deathtouch')
        for (let i = 0; i < blockers.length; i++) {
          const b = s.objects[blockers[i]]
          const lethal = deathtouch ? 1 : Math.max(1, b.chars.toughness - b.status.damage)
          const isLast = i === blockers.length - 1
          // Trample assigns only lethal per blocker; without trample the last
          // blocker soaks the remainder (damage can't be sent to the player).
          const assign = trample || !isLast ? Math.min(remaining, lethal) : remaining
          this._dealDamage(atk, { obj: b }, assign, { combat: true })
          remaining -= assign
          if (remaining <= 0) break
        }
        if (trample && remaining > 0) this._dealDamage(atk, tgt, remaining, { combat: true })
      }
    }

    // Blockers deal damage to the attacker they block.
    for (const [blkOid, atkOid] of Object.entries(s.combat.blocks)) {
      const b = s.objects[blkOid]
      if (!onBf(blkOid) || !this._dealsInPass(b, pass)) continue
      if (onBf(atkOid)) this._dealDamage(b, { obj: s.objects[atkOid] }, b.chars.power, { combat: true })
    }
  }

  // Central damage application: applies prevention/replacements, marks deathtouch
  // kills, and grants lifelink.
  _dealDamage(source, target, amount, opts = {}) {
    if (amount <= 0) return
    const s = this.state
    // Prevention (rule 615): "prevent all combat damage this turn" (Fog, etc.).
    if (opts.combat && s.prevent.some((p) => p.type === 'allCombat')) return
    // Protection is a prevention effect (615) — applied before general replacements.
    if (target.obj) {
      const prot = target.obj.chars?.protections || []
      if (prot.length && (source?.chars?.colors || []).some((c) => prot.includes(c))) return
    }
    // General replacement effects (614/616): damage doubling (Furnace of Rath),
    // prevention shields (Samite Healer), etc. may change the amount or the target.
    const ev = { kind: 'damage', source, target, amount, combat: !!opts.combat }
    this._applyReplacements(ev)
    this._sweepReplacements()
    amount = ev.amount
    target = ev.target
    if (amount <= 0) return
    if (target.player != null) {
      s.players[target.player].life -= amount
      // "Whenever this creature deals combat damage to a player" (Ninja of the Deep Hours).
      if (opts.combat && source?.chars?.types?.includes('Creature'))
        this._fireTriggers('dealsCombatDamageToPlayer', source)
    } else if (target.obj) {
      if (target.obj.chars?.types.includes('Planeswalker')) {
        // Damage to a planeswalker removes that many loyalty counters (306.8).
        target.obj.status.counters.loyalty = (target.obj.status.counters.loyalty || 0) - amount
      } else {
        target.obj.status.damage += amount
        if (this._hasKW(source, 'Deathtouch')) target.obj.status.markedDeath = true
      }
    }
    if (this._hasKW(source, 'Lifelink')) this._gainLife(source.controller, amount)
  }

  // Life gain routed through replacement effects (614) — e.g. Rhox Faithmender
  // ("if you would gain life, gain twice that much instead").
  _gainLife(pid, amount) {
    if (amount <= 0) return
    const ev = { kind: 'gainLife', player: pid, amount }
    this._applyReplacements(ev)
    this.state.players[pid].life += ev.amount
  }

  // ---- replacement effects (rule 614 / 616) ---------------------------
  // A replaceable event is a small mutable record ({ kind, amount, … }). Each
  // applicable replacement modifies it at most once (616.1); the caller then
  // performs the possibly-changed event. Sources: static `replacement` abilities
  // on battlefield permanents, and floating shields in state.replacements.

  _collectReplacements(event) {
    const s = this.state
    const out = []
    for (const o of objectsIn(s, 'battlefield'))
      for (const rep of o.behavior?.replacement || [])
        if (this._replacementMatches(rep, event, o)) out.push({ apply: rep.apply, source: o })
    for (const rep of s.replacements)
      if (this._replacementMatches(rep, event, null)) out.push({ floating: rep })
    return out
  }

  _replacementMatches(rep, event, src) {
    if (rep.event !== event.kind) return false
    if (event.kind === 'damage') {
      if (rep.filter?.combatOnly && !event.combat) return false
      // A floating shield remembers the one target it protects.
      if (rep.target) {
        if (rep.target.player != null) return event.target.player === rep.target.player
        if (rep.target.oid != null) return !!event.target.obj && event.target.obj.oid === rep.target.oid
      }
      return true
    }
    if (event.kind === 'gainLife') {
      if (rep.filter?.player === 'you' && (!src || event.player !== src.controller)) return false
      return true
    }
    return false
  }

  _applyReplacements(event) {
    const list = this._collectReplacements(event)
    // Rule 616 lets the affected player order the effects; we apply amount
    // modifiers (doubling) before prevention, which is a sensible deterministic
    // default for the current pool.
    list.sort((a, b) => (a.apply?.multiply ? 0 : 1) - (b.apply?.multiply ? 0 : 1))
    for (const r of list) {
      if (event.amount <= 0) break
      if (r.apply?.multiply) {
        event.amount *= r.apply.multiply
      } else if (r.apply?.prevent === 'all') {
        event.amount = 0
      } else if (r.floating) {
        // "Prevent the next N damage": a shield that absorbs up to its remaining N.
        const prevented = Math.min(r.floating.remaining, event.amount)
        r.floating.remaining -= prevented
        event.amount -= prevented
        if (r.floating.remaining <= 0) r.floating._spent = true
      }
    }
  }

  _sweepReplacements() {
    this.state.replacements = this.state.replacements.filter((r) => !r._spent)
  }

  _hasKW(o, kw) {
    return !!o?.chars?.keywords?.includes(kw)
  }

  // ---- state-based actions (rule 704) ---------------------------------

  _checkSBA() {
    const s = this.state
    let repeat = true
    while (repeat) {
      repeat = false
      recompute(s) // fresh characteristics (layers) before checking SBAs
      for (const p of s.players) {
        if ((p.life <= 0 || p.loses) && s.winner == null) {
          s.winner = this._otherPlayer(p.id)
        }
      }
      // A planeswalker with no loyalty is put into its owner's graveyard (704.5i).
      for (const o of objectsIn(s, 'battlefield')) {
        if (o.chars.types.includes('Planeswalker') && (o.status.counters.loyalty || 0) <= 0) {
          moveObject(s, o.oid, 'graveyard')
          repeat = true
        }
      }
      for (const o of objectsIn(s, 'battlefield')) {
        if (!o.chars.types.includes('Creature')) continue
        const tough = o.chars.toughness
        if (tough == null) continue
        // 0 toughness is put into the graveyard (not destruction — indestructible
        // does not save it); lethal/deathtouch damage is destruction (it does).
        const destroyed =
          (o.status.damage >= tough || o.status.markedDeath) && !this._hasKW(o, 'Indestructible')
        if (tough <= 0 || destroyed) {
          // Fire dies triggers while the creature is still on the battlefield
          // (leaves-the-battlefield abilities "look back in time").
          this._bury(o)
          repeat = true
        }
      }
      // Attachment SBAs (704.5m/n): an Aura not on a legal permanent goes to the
      // graveyard; Equipment whose creature is gone simply unattaches.
      for (const o of objectsIn(s, 'battlefield')) {
        const gone = o.status.attachedTo && !s.zones.battlefield.includes(o.status.attachedTo)
        if (o.bestowed) {
          // 702.103e: a bestowed permanent whose creature is gone comes unattached
          // and becomes a creature again (it does not go to the graveyard).
          if (!o.status.attachedTo || gone) {
            o.status.attachedTo = null
            o.bestowed = false
            repeat = true
          }
        } else if (o.behavior?.enchant) {
          if (!o.status.attachedTo || gone) {
            moveObject(s, o.oid, 'graveyard')
            repeat = true
          }
        } else if (gone && o.behavior?.activated?.some((a) => a.equip)) {
          o.status.attachedTo = null
        }
      }
      // Legend rule (704.5j): keep only the newest of same-named legendary
      // permanents a player controls.
      const legends = {}
      for (const o of objectsIn(s, 'battlefield')) {
        if (!o.chars.supertypes.includes('Legendary')) continue
        ;(legends[o.controller + '|' + o.chars.name] ||= []).push(o)
      }
      for (const group of Object.values(legends)) {
        if (group.length < 2) continue
        group.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        for (const o of group.slice(1)) {
          this._bury(o)
          repeat = true
        }
      }
      // +1/+1 and -1/-1 counters annihilate in pairs (704.5q).
      for (const o of objectsIn(s, 'battlefield')) {
        const plus = o.status.counters['+1/+1'] || 0
        const minus = o.status.counters['-1/-1'] || 0
        const k = Math.min(plus, minus)
        if (k > 0) {
          if (plus - k > 0) o.status.counters['+1/+1'] = plus - k
          else delete o.status.counters['+1/+1']
          if (minus - k > 0) o.status.counters['-1/-1'] = minus - k
          else delete o.status.counters['-1/-1']
          repeat = true
        }
      }
    }
    if (s.winner != null && (!s.pending || s.pending.kind !== 'gameOver')) {
      s.prio = null
      s.pending = { kind: 'gameOver', winner: s.winner }
    }
  }

  _applyDiscard(pending, answer) {
    const s = this.state
    const discard = answer?.discard || []
    if (discard.length !== pending.count) throw new Error('must discard exactly ' + pending.count)
    for (const oid of discard) this._discardCard(pending.player, oid)
    // Resolve any madness opportunities, then finish cleanup.
    this._processMadness(() => this._endCleanup())
  }

  // Discard one card. Madness: exile it instead and queue a cast opportunity.
  _discardCard(pid, oid) {
    const s = this.state
    const o = s.objects[oid]
    if (o.behavior?.madness) {
      moveObject(s, oid, 'exile')
      s.pendingMadness.push({ pid, oid, cost: o.behavior.madness.cost })
    } else {
      moveObject(s, oid, 'graveyard')
    }
  }

  // Present queued madness cards one at a time; run `after` when the queue drains.
  _processMadness(after) {
    const s = this.state
    if (s.pendingMadness.length === 0) {
      after()
      return
    }
    const m = s.pendingMadness.shift()
    this._afterMadness = after
    const o = s.objects[m.oid]
    s.pending = {
      kind: 'madness',
      player: m.pid,
      oid: m.oid,
      name: o.printed.name,
      cost: m.cost,
      canPay: this._canPay(m.pid, parseManaCost(m.cost)),
      targets: this._spellTargets(o)
    }
  }

  _applyMadness(pending, answer) {
    const s = this.state
    const o = s.objects[pending.oid]
    if (answer?.cast) {
      this._pay(pending.player, parseManaCost(pending.cost))
      moveObject(s, pending.oid, 'stack')
      o.controller = pending.player
      o.targets = answer.targets || []
      o.spell = o.behavior.spell
      o.madnessCast = true // exiled when it leaves the stack
      this._assertTargetsLegal(o.targets, o.controller, o.printed.colors)
      this._fireTriggers('castSpell', o)
      this._checkWard(o.oid, o.controller, o.targets)
    } else {
      moveObject(s, pending.oid, 'graveyard')
    }
    this._processMadness(this._afterMadness)
  }

  // ---- triggered abilities --------------------------------------------

  // Scan permanents on the battlefield for triggered abilities matching `event`
  // about `subject`, and queue matches. They are put on the stack the next time
  // a player would receive priority (see _putTriggersOnStack).
  _fireTriggers(event, subject) {
    const s = this.state
    const watchers = [...zone(s, 'battlefield')]
    // A spell being cast can carry its own "when you cast this spell" triggers
    // while it is on the stack (not the battlefield).
    if (event === 'castSpell' && !watchers.includes(subject.oid)) watchers.push(subject.oid)
    for (const oid of watchers) {
      const w = s.objects[oid]
      for (const ab of w.behavior?.triggered || []) {
        if (ab.trigger.event !== event) continue
        if (ab.trigger.self) {
          if (w.oid !== subject.oid) continue
        } else if (!this._matchFilter(ab.trigger.filter, subject, w)) {
          continue
        }
        s.pendingTriggers.push({
          controller: w.controller,
          sourceOid: w.oid,
          subjectOid: subject.oid,
          effect: ab.effect,
          targetSpec: ab.targets || [] // targets chosen when placed on the stack
        })
      }
    }
  }

  // Phase-boundary triggers (rule 503/513): "at the beginning of [your] upkeep /
  // end step" abilities on permanents, plus one-shot delayed triggers (603.7)
  // scheduled for this phase. Queued into pendingTriggers like any other trigger.
  _firePhaseTriggers(event) {
    const s = this.state
    for (const oid of [...zone(s, 'battlefield')]) {
      const w = s.objects[oid]
      for (const ab of w.behavior?.triggered || []) {
        if (ab.trigger.event !== event) continue
        if (ab.trigger.yourTurn && w.controller !== s.activePlayer) continue
        s.pendingTriggers.push({
          controller: w.controller,
          sourceOid: w.oid,
          subjectOid: w.oid,
          effect: ab.effect,
          targetSpec: ab.targets || []
        })
      }
    }
    // Delayed triggered abilities fire once, then are discarded.
    const fired = new Set()
    for (const d of s.delayedTriggers) {
      if (d.event !== event) continue
      if (d.yourTurn && d.controller !== s.activePlayer) continue
      s.pendingTriggers.push({
        controller: d.controller,
        sourceOid: d.sourceOid ?? null,
        subjectOid: d.subjectOid ?? null,
        effect: d.effect,
        targetSpec: []
      })
      fired.add(d)
    }
    if (fired.size) s.delayedTriggers = s.delayedTriggers.filter((d) => !fired.has(d))
  }

  // The single place a card changes zones. Fires general zone-change triggers —
  // `leaves:<from>` before the move (so leave triggers "look back in time") and
  // `enters:<to>` after — plus back-compat aliases (dies, toGraveyard, etb).
  // Author new cards against enters:/leaves:<zone>; the aliases just map common
  // cases so existing behaviors keep working.
  _relocate(o, toZone, opts = {}) {
    const from = o.zoneName
    // Leave triggers fire before the move — the source and observers look back
    // at the pre-move state (rule 603.6d/e).
    if (from) {
      if (from === 'battlefield') {
        if (o.chars?.types?.includes('Creature') && toZone === 'graveyard') this._fireTriggers('dies', o)
        if (toZone === 'graveyard') this._fireTriggers('toGraveyard', o)
      }
      this._fireTriggers('leaves:' + from, o)
    }
    moveObject(this.state, o.oid, toZone, opts)
    this._fireTriggers('enters:' + toZone, o) // enter triggers see the new zone
  }

  // A permanent leaving the battlefield for the graveyard (death/destroy).
  _bury(o) {
    this._relocate(o, 'graveyard')
  }

  // A permanent sacrificed (as a cost or effect). Distinct from destroy/other
  // deaths: fires the `sacrifice` event first — e.g. Writhing Chrysalis grows
  // "whenever you sacrifice another Eldrazi" — then buries it (dies/toGraveyard).
  _sacrifice(o) {
    this._fireTriggers('sacrifice', o)
    this._bury(o)
  }

  _matchFilter(filter, subject, watcher) {
    if (!filter) return true
    if (filter.another && subject.oid === watcher.oid) return false
    if (filter.type && !subject.chars.types.includes(filter.type)) return false
    if (filter.types && !filter.types.some((t) => subject.chars.types.includes(t))) return false
    if (filter.noncreature && subject.chars.types.includes('Creature')) return false
    if (filter.subtype && !subject.chars.subtypes.includes(filter.subtype)) return false
    if (filter.controller === 'you' && subject.controller !== watcher.controller) return false
    if (filter.controller === 'opponent' && subject.controller === watcher.controller) return false
    return true
  }

  // ---- primitives ------------------------------------------------------

  draw(pid, n = 1) {
    const s = this.state
    const p = s.players[pid]
    for (let i = 0; i < n; i++) {
      const lib = zone(s, 'library', pid)
      if (lib.length === 0) {
        p.loses = true // drew from an empty library (SBA, rule 704.5c)
        continue
      }
      moveObject(s, lib[0], 'hand')
      // Draw-count triggers (Sneaky Snacker: "when you draw your third card…").
      p.drewThisTurn = (p.drewThisTurn || 0) + 1
      if (p.drewThisTurn === 3) this._onThirdDraw(pid)
    }
  }

  // Return graveyard cards with the returnOnThirdDraw ability to the battlefield
  // tapped (queued as triggers, placed on the stack at the next priority).
  _onThirdDraw(pid) {
    const s = this.state
    for (const oid of [...zone(s, 'graveyard', pid)]) {
      if (s.objects[oid].behavior?.returnOnThirdDraw)
        s.pendingTriggers.push({
          controller: pid,
          sourceOid: oid,
          subjectOid: oid,
          effect: [{ op: 'returnSelfTapped' }],
          targetSpec: []
        })
    }
  }

  _otherPlayer(pid) {
    return pid === 0 ? 1 : 0
  }

  // Number of Faerie creatures a player controls (Spellstutter Sprite's X).
  _faerieCount(pid) {
    return objectsIn(this.state, 'battlefield').filter(
      (o) => o.controller === pid && o.chars.types.includes('Creature') && o.chars.subtypes.includes('Faerie')
    ).length
  }
}
