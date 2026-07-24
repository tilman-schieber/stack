// The M0 game engine: a deterministic step function. `advance()` runs until it
// needs a choice, at which point it sets state.pending (a PendingDecision) and
// returns; `choose(answer)` feeds the answer and continues. Nothing here touches
// React or Electron — it is driven by scripted choices in headless tests and
// (later) by UI in engine-backed game mode.
//
// Rule references are to MagicCompRules20260619.txt.

import { createState, createObject, createAbility, zone, zoneKey, moveObject, objectsIn } from './state.mjs'
import { manaAbilityColors } from './behaviors.mjs'
import { isPermanent, parseManaCost } from './cards.mjs'
import { recompute } from './layers.mjs'

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
        case 'discardCards':
          this._applyDiscardCards(pending, answer)
          break
        case 'madness':
          this._applyMadness(pending, answer)
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
        break // no priority; _pump advances
      }
      case 'draw': {
        // 103.8a: the starting player skips only the very first draw step of the
        // game (turn 1). Every later turn — including all of theirs — draws.
        if (s.turnNumber !== 1) this.draw(s.activePlayer, 1)
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
    // "Until end of turn" effects and prevention shields wear off (rule 514.2).
    s.continuous = s.continuous.filter((e) => e.duration !== 'eot')
    s.prevent = s.prevent.filter((e) => e.duration !== 'eot')
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
  }

  _applyChooseTargets(pending, answer) {
    this._placeTrigger(pending._trigger, answer?.targets || [])
    this._advanceTriggerPlacement() // continue with the rest of the queue
  }

  // Effect-driven discard (e.g. Faithless Looting). Discards the chosen cards
  // (routing madness cards to exile), then resumes the paused resolution.
  _applyDiscardCards(pending, answer) {
    const discard = (answer?.discard || []).slice(0, pending.count)
    if (discard.length !== Math.min(pending.count, pending.hand.length))
      throw new Error(`must discard ${pending.count} card(s)`)
    for (const oid of discard) this._discardCard(pending.player, oid)
    this._processMadness(() => this._resumeResolution())
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

  // Is there at least one legal target for a target spec of the given type?
  _legalTargetsExist(spec) {
    const s = this.state
    if (spec.type === 'player' || spec.type === 'any') return true
    if (spec.type === 'creature')
      return objectsIn(s, 'battlefield').some((o) => o.chars.types.includes('Creature'))
    if (spec.type === 'spell') return zone(s, 'stack').length > 0
    return true
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
          // the resolution paused for a decision (e.g. scry), which set its own
          // pending. This also runs SBAs and places triggers the resolution made.
          if (!this._resume) this._grantPriorityTo(s.activePlayer)
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

    // A game action was taken; the acting player retains priority afterwards.
    const actor = s.prio.player
    this._performAction(actor, action)
    if (s.winner != null) return
    this._grantPriorityTo(actor)
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
      if (canCastNow && this._canPay(pid, this._effectiveCost(pid, o))) {
        const targets = this._spellTargets(o)
        // A targeted spell needs a legal target to be cast (rule 601.2c). This
        // also gates counters (need a spell on the stack) and Auras (a creature).
        if (targets.length && !targets.every((t) => this._legalTargetsExist(t))) continue
        const addl = o.behavior.spell?.additionalCost
        if (addl?.sacrifice && this._sacrificeCandidates(pid, addl.sacrifice).length === 0) continue
        actions.push({
          type: 'cast',
          oid,
          targets,
          needsTargets: targets.length,
          sacChoose: addl?.sacrifice || null
        })
      }
    }

    // Flashback: cast a spell from your graveyard for its flashback cost.
    for (const oid of zone(s, 'graveyard', pid)) {
      const o = s.objects[oid]
      const fb = o.behavior?.flashback
      if (!fb) continue
      const instantSpeed = o.printed.types.includes('Instant')
      if (!(instantSpeed || sorcerySpeed)) continue
      if (!this._canPay(pid, parseManaCost(fb.cost))) continue
      const targets = this._spellTargets(o)
      if (targets.length && !targets.every((t) => this._legalTargetsExist(t))) continue
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

  // ---- performing actions ---------------------------------------------

  _performAction(pid, action) {
    const s = this.state
    switch (action.type) {
      case 'playLand': {
        moveObject(s, action.oid, 'battlefield')
        this._enterBattlefield(s.objects[action.oid], pid)
        s.players[pid].landsPlayed++
        break
      }
      case 'cast': {
        const o = s.objects[action.oid]
        this._pay(pid, this._effectiveCost(pid, o))
        // Additional cost: sacrifice a permanent (e.g. Fanatical Offering).
        const addl = o.behavior.spell?.additionalCost
        if (addl?.sacrifice && action.sacrifice) {
          const so = s.objects[action.sacrifice]
          if (so && so.controller === pid && so.zoneName === 'battlefield') this._bury(so)
        }
        moveObject(s, action.oid, 'stack') // clears transient status/controller
        o.controller = pid
        o.targets = action.targets || []
        o.spell = o.behavior.spell
        this._fireTriggers('castSpell', o) // prowess etc.
        break
      }
      case 'castFlashback': {
        const o = s.objects[action.oid]
        this._pay(pid, parseManaCost(o.behavior.flashback.cost))
        moveObject(s, action.oid, 'stack')
        o.controller = pid
        o.targets = action.targets || []
        o.spell = o.behavior.spell
        o.flashbackCast = true // exiled instead of the graveyard when it leaves
        this._fireTriggers('castSpell', o)
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
        break
      }
      default:
        throw new Error(`unknown action ${action.type}`)
    }
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
    if (ab.targets?.length && !ab.targets.every((t) => this._legalTargetsExist(t))) return false
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

  // Permanents `pid` controls that match a sacrifice spec ({ types: [...] }).
  _sacrificeCandidates(pid, spec) {
    return objectsIn(this.state, 'battlefield').filter(
      (o) => o.controller === pid && (!spec.types || spec.types.some((t) => o.chars.types.includes(t)))
    )
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
    if (cost.sacrifice === 'self') this._bury(o)
    else if (cost.sacrifice && action.sacrifice) {
      const so = s.objects[action.sacrifice]
      if (so && so.controller === pid && so.zoneName === 'battlefield') this._bury(so)
    }
  }

  _resolveTop() {
    const s = this.state
    const stack = zone(s, 'stack')
    const oid = stack[stack.length - 1]
    const o = s.objects[oid]

    if (o.kind === 'ability') {
      this._resolveObject = { oid, kind: 'ability' }
      this._runResolution(o, o.effect)
      return
    }

    if (o.spell) {
      this._resolveObject = { oid, kind: 'spell' }
      this._runResolution(o, o.spell.effect)
    } else if (isPermanent(o.printed)) {
      moveObject(s, oid, 'battlefield')
      this._enterBattlefield(o, o.controller ?? o.owner)
    } else {
      moveObject(s, oid, 'graveyard')
    }
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
      // The spell may already have been removed (e.g. countered). Flashback and
      // madness spells are exiled instead of going to the graveyard.
      moveObject(s, ctx.oid, o.flashbackCast || o.madnessCast ? 'exile' : 'graveyard')
      o.flashbackCast = false
      o.madnessCast = false
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
    if (ew) o.status.counters[ew.counter] = (o.status.counters[ew.counter] || 0) + ew.amount
    // A planeswalker enters with loyalty counters equal to its printed loyalty.
    if (o.printed.loyalty != null) o.status.counters.loyalty = o.printed.loyalty
    // An Aura enters attached to the permanent it targeted as it was cast.
    if (o.behavior?.enchant && o.targets?.[0]?.oid) o.status.attachedTo = o.targets[0].oid
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
        if (count === 0) return false
        s.pending = { kind: 'discardCards', player: pid, count, hand: [...hand] }
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
          if (t.kind === 'player') this._dealDamage(source, { player: t.pid }, e.amount)
          else if (t.kind === 'object') this._dealDamage(source, { obj: t.obj }, e.amount)
          break
        }
        case 'addMana':
          s.players[source.controller].manaPool[e.mana]++
          break
        case 'draw':
          this.draw(source.controller, e.amount || 1)
          break
        case 'gainLife':
          s.players[source.controller].life += e.amount
          break
        case 'dealDamageEach': {
          // Damage to each permanent matching a filter (e.g. every creature).
          for (const oid of [...zone(s, 'battlefield')]) {
            const t = s.objects[oid]
            if (!t) continue
            if (e.filter === 'creature' && !t.chars.types.includes('Creature')) continue
            this._dealDamage(source, { obj: t }, e.amount)
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
        case 'counter': {
          const t = this._resolveTargetRef(source, e.to)
          // Remove the target spell from the stack to its owner's graveyard.
          if (t?.kind === 'object' && t.obj.zoneName === 'stack')
            moveObject(s, t.obj.oid, 'graveyard')
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
        default:
          throw new Error(`unknown effect op ${e.op}`)
      }
    }
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
    return cost
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
        (o) => o.controller === pid && o.chars.types.includes('Creature') && !o.status.tapped
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
        let remaining = power
        const trample = this._hasKW(atk, 'Trample')
        const deathtouch = this._hasKW(atk, 'Deathtouch')
        for (const blkOid of blockers) {
          const b = s.objects[blkOid]
          const lethal = deathtouch ? 1 : Math.max(1, b.chars.toughness - b.status.damage)
          if (trample) {
            const assign = Math.min(remaining, lethal)
            this._dealDamage(atk, { obj: b }, assign, { combat: true })
            remaining -= assign
          } else {
            this._dealDamage(atk, { obj: b }, remaining, { combat: true }) // dump the rest here
            remaining = 0
            break
          }
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

  // Central damage application: applies prevention, marks deathtouch kills, and
  // grants lifelink.
  _dealDamage(source, target, amount, opts = {}) {
    if (amount <= 0) return
    const s = this.state
    // Prevention (rule 615): "prevent all combat damage this turn" (Fog, etc.).
    if (opts.combat && s.prevent.some((p) => p.type === 'allCombat')) return
    if (target.player != null) {
      s.players[target.player].life -= amount
    } else if (target.obj) {
      // Protection prevents damage from sources of the protected color.
      const prot = target.obj.chars?.protections || []
      if (prot.length && (source?.chars?.colors || []).some((c) => prot.includes(c))) return
      if (target.obj.chars?.types.includes('Planeswalker')) {
        // Damage to a planeswalker removes that many loyalty counters (306.8).
        target.obj.status.counters.loyalty = (target.obj.status.counters.loyalty || 0) - amount
      } else {
        target.obj.status.damage += amount
        if (this._hasKW(source, 'Deathtouch')) target.obj.status.markedDeath = true
      }
    }
    if (this._hasKW(source, 'Lifelink')) s.players[source.controller].life += amount
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
        if (o.behavior?.enchant) {
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
      this._fireTriggers('castSpell', o)
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
    for (const oid of zone(s, 'battlefield')) {
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

  // A permanent leaving the battlefield for the graveyard (death/sacrifice/destroy).
  _bury(o) {
    this._relocate(o, 'graveyard')
  }

  _matchFilter(filter, subject, watcher) {
    if (!filter) return true
    if (filter.another && subject.oid === watcher.oid) return false
    if (filter.type && !subject.chars.types.includes(filter.type)) return false
    if (filter.noncreature && subject.chars.types.includes('Creature')) return false
    if (filter.controller === 'you' && subject.controller !== watcher.controller) return false
    if (filter.controller === 'opponent' && subject.controller === watcher.controller) return false
    return true
  }

  // ---- primitives ------------------------------------------------------

  draw(pid, n = 1) {
    const s = this.state
    for (let i = 0; i < n; i++) {
      const lib = zone(s, 'library', pid)
      if (lib.length === 0) {
        s.players[pid].loses = true // drew from an empty library (SBA, rule 704.5c)
        continue
      }
      moveObject(s, lib[0], 'hand')
    }
  }

  _otherPlayer(pid) {
    return pid === 0 ? 1 : 0
  }
}
