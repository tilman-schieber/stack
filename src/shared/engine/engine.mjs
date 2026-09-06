// The M0 game engine: a deterministic step function. `advance()` runs until it
// needs a choice, at which point it sets state.pending (a PendingDecision) and
// returns; `choose(answer)` feeds the answer and continues. Nothing here touches
// React or Electron — it is driven by scripted choices in headless tests and
// (later) by UI in engine-backed game mode.
//
// Rule references are to MagicCompRules20260619.txt.

import { createState, createObject, createAbility, computeChars, zone, zoneKey, moveObject, objectsIn, setFace } from './state.mjs'
import { manaAbilityColors, loadBehavior } from './behaviors.mjs'
import { isPermanent, parseManaCost, manaValue, BASIC_LAND_MANA } from './cards.mjs'
import { recompute, matchStatic, hasSub } from './layers.mjs'
import { DUNGEONS, REGULAR_DUNGEONS, roomOf } from './dungeons.mjs'

import { STEP_ORDER, PRIORITY_STEPS, MAIN_STEPS, tags, addCosts } from './engineShared.mjs'
import { designationsMethods } from './engine-designations.mjs'
import { legalMethods } from './engine-legal.mjs'
import { actionsMethods } from './engine-actions.mjs'
import { effectsMethods } from './engine-effects.mjs'
import { manaMethods } from './engine-mana.mjs'
import { combatMethods } from './engine-combat.mjs'
import { triggersMethods } from './engine-triggers.mjs'

export class GameEngine {
  constructor(opts) {
    this.state = createState(opts)
    // Who plays first: a seat index, or (default) a seeded random pick (103.1).
    this._startingPlayer = opts.startingPlayer
    // Games 2+ of a match (103.6): the loser of the last game decides who plays
    // first, instead of a die roll.
    this._playDrawChooser = opts.playDrawChooser
    // Tests: never pause to ask a player to order simultaneous triggers (603.3b).
    this._autoOrder = !!opts.autoOrderTriggers
    // Static abilities with an `if` condition ("as long as …") are evaluated by
    // the engine's condition vocabulary from inside the layer system.
    this.state._condFn = (cond, w) => this._cond(cond, w)
    this.state._countFn = (src, v) => this._amount({ controller: src.controller, oid: src.oid }, v)
  }

  // ---- lifecycle -------------------------------------------------------

  start(handSize = 7) {
    const s = this.state
    this.handSize = handSize
    const n = s.players.length
    const chooser = Number.isInteger(this._playDrawChooser) ? this._playDrawChooser : null
    const explicit = chooser == null && Number.isInteger(this._startingPlayer)
    s.startingPlayer = chooser ?? (explicit ? this._startingPlayer : s.rng.int(n))
    // Say who won. The winner is only *asked* whether to play or draw, and a
    // computer or online opponent answers that instantly — so without this the
    // roll is invisible whenever you lose it, and looks like you always win.
    if (!explicit) {
      this._log(
        chooser != null
          ? `${s.players[s.startingPlayer].name} lost the last game and chooses who plays first`
          : `${s.players[s.startingPlayer].name} wins the die roll`
      )
    }
    for (const p of s.players) this.draw(p.id, handSize)
    s.step = 'mulligan'
    if (explicit) return this._beginMulligans()
    // 103.2/103.7a: the player who won the die roll — or, in games after the first,
    // the loser of the previous game (103.6) — chooses to play or draw.
    s.pending = { kind: 'playOrDraw', player: s.startingPlayer, matchLoser: chooser != null }
    return this
  }

  // Damage assignment order (509.2): `order` maps attacker oid -> blocker oids,
  // first to be assigned damage first. Missing/partial orders keep the default.
  _applyOrderBlockers(pending, answer) {
    const s = this.state
    const order = {}
    for (const atk of pending.attackers) {
      const given = Array.isArray(answer?.order?.[atk.oid]) ? answer.order[atk.oid] : []
      const ids = atk.blockers.map((b) => b.oid)
      const chosen = [...new Set(given.filter((b) => ids.includes(b)))]
      for (const b of ids) if (!chosen.includes(b)) chosen.push(b)
      order[atk.oid] = chosen
    }
    s.combat.order = order
    if (this._combatDecisions()) return
    this._combatDamage()
    this._grantPriority()
  }

  // The decisions owed before combat damage is dealt. Returns true if one is
  // now pending (auto-resolved in tests).
  _combatDecisions() {
    const s = this.state
    if (this._autoOrder) return false
    const onBf = (oid) => s.objects[oid]?.zoneName === 'battlefield'
    // 509.2 / 510.1c: an attacker blocked by several creatures has its controller
    // order them for damage assignment.
    const multi = s.combat.attackers
      .map((oid) => ({ oid, blockers: Object.keys(s.combat.blocks).filter((b) => s.combat.blocks[b] === oid && onBf(b)) }))
      .filter((x) => x.blockers.length > 1)
    if (multi.length && !s.combat.order) {
      s.pending = {
        kind: 'orderBlockers',
        player: s.activePlayer,
        attackers: multi.map((x) => ({
          oid: x.oid,
          name: this._objName(s.objects[x.oid]),
          blockers: x.blockers.map((b) => ({ oid: b, name: this._objName(s.objects[b]) }))
        }))
      }
      return true
    }
    // Banding (702.22c): the band's controller divides each blocker's damage.
    s.combat.bandAssign ||= {}
    for (const [b, members] of Object.entries(s.combat.bandBlocks || {})) {
      if (s.combat.bandAssign[b] || !onBf(b)) continue
      const alive = members.filter((m) => onBf(m) && s.objects[m].status.attacking)
      if (alive.length < 2) continue
      const blocker = s.objects[b]
      s.pending = {
        kind: 'bandDamage',
        player: s.objects[alive[0]].controller,
        blocker: { oid: b, name: this._objName(blocker), power: blocker.chars.power || 0 },
        members: alive.map((m) => ({ oid: m, name: this._objName(s.objects[m]), toughness: s.objects[m].chars.toughness, damage: s.objects[m].status.damage }))
      }
      return true
    }
    return false
  }

  _applyBandDamage(pending, answer) {
    const s = this.state
    const total = pending.blocker.power
    const given = answer?.assignment || {}
    const ids = pending.members.map((m) => m.oid)
    const sum = Object.values(given).reduce((a, b) => a + b, 0)
    if (Object.keys(given).some((k) => !ids.includes(k)) || Object.values(given).some((v) => !Number.isInteger(v) || v < 0) || sum !== total)
      throw new Error(`divide exactly ${total} damage among the band`)
    s.combat.bandAssign[pending.blocker.oid] = { ...given }
    if (this._combatDecisions()) return
    this._combatDamage()
    this._grantPriority()
  }

  // Proliferate (701.27): +1 of each counter kind on every chosen permanent/player.
  _applyProliferate(pending, answer) {
    const s = this.state
    const picks = Array.isArray(answer?.picks) ? answer.picks : []
    const chosen = pending.choices.filter((c) => picks.some((p) => (c.kind === 'object' ? p.oid === c.oid : p.pid === c.pid)))
    for (const c of chosen) {
      if (c.kind === 'object') {
        const o = s.objects[c.oid]
        if (o) for (const k of Object.keys(o.status.counters)) if (o.status.counters[k] > 0) this._putCounters(o, k, 1)
        continue
      }
      const counters = s.players[c.pid]?.counters
      if (!counters) continue
      for (const k of Object.keys(counters)) if (counters[k] > 0) counters[k]++
    }
    this._log(`${this._nameOf(pending.player)} proliferates${chosen.length ? ': ' + chosen.map((c) => c.name).join(', ') : ' nothing'}`)
    this._resumeResolution()
  }

  // Mutate (702.140): the merged permanent is the target object; the mutating
  // card joins it (on top or under) and no longer exists as a separate object
  // until the pile leaves the battlefield.
  _applyMutateOrder(pending, answer) {
    const s = this.state
    const card = s.objects[pending.oid]
    const target = s.objects[pending.target]
    if (!card || !target || target.zoneName !== 'battlefield') {
      if (card?.zoneName === 'stack') {
        moveObject(s, card.oid, 'battlefield')
        this._enterBattlefield(card, card.controller ?? card.owner)
      }
    } else this._merge(card, target, answer?.onTop !== false)
    if (!this._resume) this._grantPriorityTo(s.activePlayer)
  }

  _merge(card, target, onTop) {
    const s = this.state
    const st = zone(s, 'stack')
    const i = st.indexOf(card.oid)
    if (i >= 0) st.splice(i, 1)
    card.zoneName = 'merged'
    card.mergedInto = target.oid
    target.origPrinted ||= target.printed // restored when the pile leaves (state.moveObject)
    target.mergedCards ||= []
    if (onTop) target.mergedCards.push(card.oid)
    else target.mergedCards.unshift(card.oid)
    // The pile: bottom-most first; the top card gives the characteristics, every
    // card contributes its abilities.
    const pile = onTop ? [...target.mergedCards.slice(0, -1), target.oid, card.oid] : [target.oid, ...target.mergedCards]
    const printedOf = (oid) => (oid === target.oid ? target.origPrinted : s.objects[oid].printed)
    const top = printedOf(pile[pile.length - 1])
    const all = pile.map(printedOf)
    target.printed = {
      ...top,
      keywords: [...new Set(all.flatMap((p) => p.keywords))],
      protections: [...new Set(all.flatMap((p) => p.protections || []))]
    }
    const behaviors = all.map((p) => loadBehavior(p))
    const cat = (k) => behaviors.flatMap((b) => b[k] || [])
    target.behavior = { ...loadBehavior(top), triggered: cat('triggered'), activated: cat('activated'), static: cat('static'), staticRules: cat('staticRules'), replacement: cat('replacement') }
    target.mergeOrder = pile
    computeChars(target)
    this._log(`${this._objName(s.objects[card.oid])} mutates ${onTop ? 'onto' : 'under'} ${this._objName(target)}`)
    this._fireTriggers('mutates', target)
  }

  _applyLookAtHand() {
    this._resumeResolution()
  }

  _applyChooseFromHand(pending, answer) {
    const s = this.state
    if (pending.optional && answer?.decline) return this._resumeResolution()
    if (!pending.cards.includes(answer?.oid)) throw new Error('choose one of the revealed cards')
    const o = s.objects[answer.oid]
    if (pending.then === 'castFree') {
      // "You may cast one of them without paying its mana cost" (Mad Wizard's Lair).
      s.pendingMadness.push({ pid: pending.player, oid: o.oid, cost: null, free: true, keep: true })
      this._processMadness(() => this._resumeResolution())
      return
    }
    if (pending.then === 'exile') {
      this._log(`${this._nameOf(pending.player)} chooses ${this._objName(o)}: exiled`)
      this._relocate(o, 'exile')
    } else {
      this._log(`${this._nameOf(pending.player)} chooses ${this._objName(o)}`)
      this._discardCard(pending.target, answer.oid)
    }
    this._processMadness(() => this._resumeResolution())
  }

  // ---- game log --------------------------------------------------------
  // A public, append-only record of what happened, for the UI (both players see
  // the same log, so never put hidden information — drawn card names, library
  // order — into it).
  _log(text, extra = {}) {
    const s = this.state
    s.log.push({ n: s.log.length + 1, turn: s.turnNumber, step: s.step, text, ...extra })
  }

  _nameOf(pid) {
    return this.state.players[pid]?.name ?? `Player ${pid + 1}`
  }

  // A printable name for an object (card, token, ability) — face-down permanents
  // stay anonymous.
  _objName(o) {
    if (!o) return 'something'
    if (o.faceDown) return 'a face-down creature'
    if (o.kind === 'ability') {
      const src = o.sourceOid != null ? this.state.objects[o.sourceOid] : null
      const srcName = src ? this._objName(src) : o.sourceName
      return srcName ? `${srcName}'s ability` : o.name || 'an ability'
    }
    return o.chars?.name || o.printed?.name || 'a card'
  }

  _describeTargets(refs) {
    const s = this.state
    const parts = (refs || []).map((t) => {
      if (t?.kind === 'player') return this._nameOf(t.pid)
      return this._objName(s.objects[t?.oid])
    })
    return parts.length ? ` targeting ${parts.join(', ')}` : ''
  }

  // ---- London mulligan (rule 103.5) -----------------------------------

  // London mulligan (103.5), in rounds: in turn order each undecided player
  // says keep or mulligan; everyone who mulliganed shuffles and redraws seven,
  // and decides again next round. Once all have kept, each player who took
  // mulligans puts that many cards on the bottom, in turn order.
  _askMulligan() {
    const s = this.state
    if (!s.mulliganDeciding.length) return this._endMulliganRound()
    const pid = (s.mulliganPlayer = s.mulliganDeciding[0])
    s.pending = {
      kind: 'mulligan',
      player: pid,
      mulligans: s.players[pid].mulligans,
      hand: [...zone(s, 'hand', pid)]
    }
  }

  _applyMulligan(answer) {
    const s = this.state
    const pid = s.mulliganDeciding.shift()
    if (answer?.keep) this._log(`${this._nameOf(pid)} keeps`)
    else s.mulliganRound.push(pid)
    this._askMulligan()
  }

  _endMulliganRound() {
    const s = this.state
    if (s.mulliganRound.length) {
      // Everyone who mulliganed this round redraws, then decides again.
      for (const pid of s.mulliganRound) {
        for (const oid of [...zone(s, 'hand', pid)]) moveObject(s, oid, 'library')
        const libKey = zoneKey('library', pid)
        s.zones[libKey] = s.rng.shuffle(s.zones[libKey])
        this.draw(pid, this.handSize || 7)
        s.players[pid].mulligans++
        this._log(`${this._nameOf(pid)} mulligans (${s.players[pid].mulligans})`)
      }
      s.mulliganDeciding = [...s.mulliganRound]
      s.mulliganRound = []
      return this._askMulligan()
    }
    // All kept: bottoming, in turn order.
    s.bottomQueue = s.mulliganOrder.filter((pid) => s.players[pid].mulligans > 0 && zone(s, 'hand', pid).length > 0)
    this._askBottom()
  }

  _askBottom() {
    const s = this.state
    if (!s.bottomQueue.length) {
      s.mulliganPlayer = null
      s.turnNumber = 1
      s.activePlayer = s.startingPlayer
      this._enterStep('untap') // _pump (in choose) advances into the game
      return
    }
    const pid = (s.mulliganPlayer = s.bottomQueue[0])
    const count = Math.min(s.players[pid].mulligans, zone(s, 'hand', pid).length)
    s.pending = { kind: 'bottom', player: pid, count, hand: [...zone(s, 'hand', pid)] }
  }

  _applyBottom(pending, answer) {
    const s = this.state
    const bottom = answer?.bottom || []
    if (bottom.length !== pending.count)
      throw new Error(`must put exactly ${pending.count} card(s) on the bottom`)
    for (const oid of bottom) moveObject(s, oid, 'library') // to the bottom
    this._log(`${this._nameOf(pending.player)} puts ${pending.count} card${pending.count > 1 ? 's' : ''} on the bottom`)
    s.bottomQueue.shift()
    this._askBottom()
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
      // The engine — not the client — is the authority on legality: reject any
      // answer that doesn't correspond to what this decision offered.
      this._validateAnswer(pending, answer)
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
        case 'chooseTopType':
          this._applyChooseTopType(pending, answer)
          break
        case 'lookTop':
          this._applyLookTop(pending, answer)
          break
        case 'putBack':
          this._applyPutBack(pending, answer)
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
        case 'chooseValue':
          this._applyChooseValue(pending, answer)
          break
        case 'dredge':
          this._applyDredge(pending, answer)
          break
        case 'proliferate':
          this._applyProliferate(pending, answer)
          break
        case 'mutateOrder':
          this._applyMutateOrder(pending, answer)
          break
        case 'sacrificeChoice':
          this._applySacrificeChoice(pending, answer)
          break
        case 'orderTriggers':
          this._applyOrderTriggers(pending, answer)
          break
        case 'optionalTrigger':
          this._applyOptionalTrigger(pending, answer)
          break
        case 'playOrDraw':
          this._applyPlayOrDraw(pending, answer)
          break
        case 'orderBlockers':
          this._applyOrderBlockers(pending, answer)
          break
        case 'legendChoice':
          this._applyLegendChoice(pending, answer)
          break
        case 'lookAtHand':
          this._applyLookAtHand(pending, answer)
          break
        case 'chooseFromHand':
          this._applyChooseFromHand(pending, answer)
          break
        case 'bandDamage':
          this._applyBandDamage(pending, answer)
          break
        case 'chooseProtector':
          this._applyChooseProtector(pending, answer)
          break
        case 'chooseName':
          this._applyChooseName(pending, answer)
          break
        case 'chooseRoom':
          this._applyChooseRoom(pending, answer)
          break
        case 'chooseDungeon':
          this._applyChooseDungeon(pending, answer)
          break
        case 'chooseRingBearer':
          this._applyChooseRingBearer(pending, answer)
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

  // ---- answer validation ----------------------------------------------
  // Every answer must name something the pending decision actually offered
  // (an action from `actions`, an eligible attacker/blocker, a card from `hand`,
  // a target that fits its spec, …). The local UI only ever offers legal moves,
  // but a networked guest's answer arrives as raw JSON, and a UI bug must not be
  // able to corrupt the game either. Throws on an illegal answer; choose()
  // restores the decision so the caller can try again.

  _validateAnswer(pending, answer) {
    const a = answer || {}
    switch (pending.kind) {
      case 'priority':
        return this._validateAction(pending, a)
      case 'declareAttackers': {
        const seen = new Set()
        for (const ent of a.attackers || []) {
          const oid = typeof ent === 'string' ? ent : ent?.oid
          if (!pending.eligible.includes(oid)) throw new Error('illegal attacker: not eligible to attack')
          if (seen.has(oid)) throw new Error('illegal attacker: declared twice')
          seen.add(oid)
          const d = typeof ent === 'string' ? null : ent.defender
          if (d && !this._defenderOffered(pending.defenders, d)) throw new Error('illegal attack: no such defender')
        }
        // Banding (702.22b): a band is any number of creatures with banding plus up
        // to one without, all attacking the same defender.
        const bands = {}
        for (const ent of a.attackers || []) {
          if (typeof ent === 'string' || !ent.band) continue
          ;(bands[ent.band] ||= []).push(ent)
        }
        for (const members of Object.values(bands)) {
          const noBanding = members.filter((m) => !this._hasKW(this.state.objects[m.oid], 'Banding'))
          if (noBanding.length > 1) throw new Error('illegal band: at most one creature without banding')
          const key = (d) => JSON.stringify(d || null)
          if (new Set(members.map((m) => key(m.defender))).size > 1) throw new Error('illegal band: all members must attack the same defender')
        }
        // Attack requirements (508.1d): a creature that "attacks each combat if
        // able" and is able must be declared.
        for (const oid of pending.eligible) {
          const o = this.state.objects[oid]
          if (o && !seen.has(oid) && this._required(o, 'attack'))
            throw new Error(`${o.chars.name} must attack this combat if able`)
        }
        // Goad (701.15b): a goaded creature attacks a player other than the one
        // who goaded it if able.
        for (const ent of a.attackers || []) {
          if (typeof ent === 'string' || !ent.defender || ent.defender.player == null) continue
          const o = this.state.objects[ent.oid]
          const goaders = this._goadedBy(o)
          if (!goaders.length) continue
          const others = pending.defenders.filter((d) => d.kind === 'player' && !goaders.includes(d.pid))
          if (goaders.includes(ent.defender.player) && others.length)
            throw new Error(`${o.chars.name} is goaded: it must attack a player other than ${this._nameOf(ent.defender.player)}`)
        }
        return
      }
      case 'declareBlockers': {
        const blocks = a.blocks || {}
        for (const [b, atk] of Object.entries(blocks)) {
          if (!pending.eligible.includes(b)) throw new Error('illegal block: that creature cannot block')
          const list = Array.isArray(atk) ? atk : [atk]
          for (const x of list) if (!pending.attackers.includes(x)) throw new Error('illegal block: not an attacker aimed at you')
          // "Can block an additional creature" (Entourage of Trest): one more per grant.
          if (list.length > 1 + this._extraBlocks(this.state.objects[b])) throw new Error(`illegal block: ${this.state.objects[b].chars.name} can't block that many creatures`)
        }
        // Block requirements (509.1c): a creature that must block if able, and can
        // legally block some attacker, must be assigned.
        for (const oid of pending.eligible) {
          const o = this.state.objects[oid]
          if (!o || blocks[oid] || !this._required(o, 'block')) continue
          if (pending.attackers.some((atk) => this._canBlock(o, this.state.objects[atk])))
            throw new Error(`${o.chars.name} must block if able`)
        }
        return
      }
      case 'discard':
        return this._assertFromHand(pending, a.discard)
      case 'discardCards':
        return this._assertFromHand(pending, a.discard)
      case 'bottom':
        return this._assertFromHand(pending, a.bottom)
      case 'putBack':
        return this._assertFromHand({ hand: pending.hand }, a.cards)
      case 'chooseTopType':
        if (!pending.options.includes(a.type)) throw new Error(`choose ${pending.options.join(' or ')}`)
        return
      case 'lookTop': {
        if (pending.chooseType) {
          if (!pending.chooseType.includes(a.type)) throw new Error(`choose ${pending.chooseType.join(' or ')}`)
          return
        }
        const picks = Array.isArray(a.picks) ? a.picks : []
        if (picks.some((oid) => !pending.cards.includes(oid))) throw new Error('illegal choice: that card was not looked at')
        return
      }
      case 'chooseTargets': {
        if (pending.optional && a.decline) return
        const src = this.state.objects[pending.sourceOid]
        const ctx = { byPid: pending.player, sourceColors: tags(src?.chars || src?.printed) }
        return this._validateTargets(a.targets, pending.targets, ctx)
      }
      case 'madness': {
        if (!a.cast) return
        const o = this.state.objects[pending.oid]
        return this._validateTargets(a.targets, pending.targets, { byPid: pending.player, sourceColors: tags(o.printed) })
      }
      default:
        return // the remaining decisions validate inline (scry/search/copyEnter/…)
    }
  }

  _defenderOffered(defenders, d) {
    if (d.planeswalker != null) return defenders.some((x) => x.kind === 'planeswalker' && x.oid === d.planeswalker)
    if (d.battle != null) return defenders.some((x) => x.kind === 'battle' && x.oid === d.battle)
    return defenders.some((x) => x.kind === 'player' && x.pid === d.player)
  }

  _assertFromHand(pending, oids) {
    const list = Array.isArray(oids) ? oids : []
    if (new Set(list).size !== list.length) throw new Error('illegal choice: same card chosen twice')
    for (const oid of list) if (!pending.hand.includes(oid)) throw new Error('illegal choice: card is not in your hand')
  }

  // A priority answer must match one offered action (same type / card / ability /
  // cost variant), and every parameter it carries (targets, X, sacrifice, discard,
  // modes, ninjutsu return) must be one the action allows.
  _validateAction(pending, a) {
    const s = this.state
    const type = a.type || 'pass'
    if (type === 'pass') return
    const match = pending.actions.find(
      (x) =>
        x.type === type &&
        (x.oid ?? null) === (a.oid ?? null) &&
        (x.ability ?? null) === (a.ability ?? null) &&
        (x.color ?? null) === (a.color ?? null) &&
        (x.option ?? 0) === (a.option ?? 0) &&
        (x.face ?? null) === (a.face ?? null) &&
        !!x.kicker === !!a.kicker &&
        !!x.evoke === !!a.evoke &&
        !!x.buyback === !!a.buyback &&
        !!x.bargain === !!a.bargain &&
        !!x.gift === !!a.gift &&
        !!x.evidence === !!a.evidence &&
        !!x.overload === !!a.overload &&
        !!x.mutate === !!a.mutate &&
        !!x.altCost === !!a.altCost &&
        !!x.sneak === !!a.sneak &&
        !!x.webSlinging === !!a.webSlinging
    )
    if (!match) throw new Error(`illegal action: ${type} is not available`)
    if ((match.sneak || match.webSlinging) && !match.returns.includes(a.returned))
      throw new Error(match.sneak ? 'sneak: choose an unblocked attacker you control to return' : 'web-slinging: choose a tapped creature you control to return')
    const pid = pending.player
    const o = s.objects[a.oid]
    const colors = tags(type === 'activate' ? o?.chars || o?.printed : o?.printed)
    const ctx = { byPid: pid, sourceColors: colors }

    if (match.modal) {
      const count = match.modal.count || 1
      const modes = Array.isArray(a.modes) ? a.modes : []
      if (modes.length !== count || new Set(modes).size !== count) throw new Error(`choose ${count} mode(s)`)
      modes.forEach((mi, k) => {
        const m = match.modes[mi]
        if (!m || !m.castable) throw new Error('illegal mode')
        this._validateTargets(a.modeTargets?.[k], m.targets, ctx)
      })
    } else if (match.variadic) {
      // The count/division is checked by _applyVariadic; each ref must fit the slot.
      for (const ref of a.targets || [])
        if (!this._targetMatches(ref, match.variadic, ctx)) throw new Error('illegal target')
    } else if (match.targets) {
      this._validateTargets(a.targets, match.targets, ctx)
    }
    // Hybrid / two-brid choices must name real options for those pips.
    //
    // Length, not truthiness: the interface sends both lists whenever it shows
    // the pip picker, so a card with only hybrid pips arrives with `twobrid: []`
    // — an empty array, which is truthy. Testing the array itself refused every
    // hybrid card ever cast through the picker, Slippery Bogle included.
    if (a.hybrid?.length && (!match.hybrid || a.hybrid.some((c, i) => c != null && !match.hybrid[i]?.includes(c)))) throw new Error('illegal hybrid mana choice')
    if (a.twobrid?.length && (!match.twobrid || a.twobrid.some((c, i) => c != null && c !== '2' && c !== match.twobrid[i]))) throw new Error('illegal two-brid mana choice')
    if (a.hybrid?.length || a.twobrid?.length) {
      const test = this._canPay(pid, match.hybrid || match.twobrid ? this._effectiveCost(pid, o) : {}, [], null, o.printed)
      void test
    }
    if (match.hasX) {
      const x = a.x ?? 0
      if (!Number.isInteger(x) || x < 0 || x > match.maxX) throw new Error(`X must be between 0 and ${match.maxX}`)
    }
    if (match.sacChoose) {
      const so = s.objects[a.sacrifice]
      if (!so || !this._sacrificeCandidates(pid, match.sacChoose).includes(so))
        throw new Error('illegal cost: choose a permanent you control to sacrifice')
    }
    if (match.discChoose) {
      const d = Array.isArray(a.discard) ? a.discard : []
      const hand = zone(s, 'hand', pid)
      if (d.length !== match.discChoose || new Set(d).size !== d.length || d.some((oid) => oid === a.oid || !hand.includes(oid)))
        throw new Error(`illegal cost: discard ${match.discChoose} other card(s) from your hand`)
    }
    if (type === 'ninjutsu' && !match.returns.includes(a.returned))
      throw new Error('illegal ninjutsu: that creature is not an unblocked attacker you control')
  }

  // Exactly one chosen target per spec, each fitting its spec.
  _validateTargets(refs, specs, ctx) {
    const list = Array.isArray(refs) ? refs : []
    const need = specs || []
    // Trailing optional specs ("up to two target creatures") may be left out.
    const required = need.filter((sp, i) => !sp.optional || i < list.length).length
    if (list.length !== required) throw new Error(`choose ${need.filter((sp) => !sp.optional).length}${need.some((sp) => sp.optional) ? ' or more' : ''} target(s)`)
    list.forEach((ref, i) => {
      if (!this._targetMatches(ref, need[i], ctx)) throw new Error('illegal target')
      // "…creature that player controls" (Searing Blaze): tied to an earlier player target.
      if (need[i].sameControllerAs != null) {
        const p = list[need[i].sameControllerAs]
        const o = this.state.objects[ref.oid]
        if (p?.kind !== 'player' || !o || o.controller !== p.pid) throw new Error('that creature must be controlled by the targeted player')
      }
    })
    this._flagbearerCheck(ctx, list, need)
  }

  // Standard Bearer: while an opponent chooses targets, they must choose at least
  // one Flagbearer on the battlefield if able.
  _flagbearerCheck(ctx, refs, specs) {
    const s = this.state
    if (!specs.some((sp) => ['creature', 'any', 'permanent'].includes(sp.type))) return
    const bearers = objectsIn(s, 'battlefield').filter((o) => hasSub(o.chars, 'Flagbearer') && o.controller !== ctx.byPid && this._targetableBy(o, ctx.byPid, ctx.sourceColors))
    if (!bearers.length) return
    const could = specs.some((sp) => bearers.some((b) => this._specMatches(sp, b) && this._controllerMatches(sp, b, ctx)))
    if (!could) return
    if (!refs.some((r) => r?.kind === 'object' && bearers.some((b) => b.oid === r.oid))) throw new Error('illegal target: a Flagbearer (Standard Bearer) must be targeted if able')
  }

  // Does a target reference ({ kind:'player'|'object'|'spell', … }) satisfy a spec?
  _targetMatches(ref, spec, ctx) {
    const s = this.state
    if (!ref || !spec) return false
    if (ref.kind === 'player') {
      if (spec.type !== 'player' && spec.type !== 'any') return false
      const p = s.players[ref.pid]
      if (!p || p.hasLost) return false
      if (spec.controller === 'opponent' && ref.pid === ctx.byPid) return false // "target opponent"
      if (spec.controller === 'you' && ref.pid !== ctx.byPid) return false
      return true
    }
    if (ref.kind === 'spell') return spec.type === 'spell' && zone(s, 'stack').includes(ref.oid) && this._spellSpecOk(spec, s.objects[ref.oid])
    if (ref.kind === 'object') {
      if (spec.type === 'player' || spec.type === 'spell') return false
      const o = s.objects[ref.oid]
      // "Target card in a graveyard" (Faerie Macabre) — filtered by the spec's
      // card criteria (types, owner) like any other target.
      if (spec.type === 'graveyardCard') {
        if (!o || o.zoneName !== 'graveyard') return false
        if (spec.types && !spec.types.some((t) => o.printed.types.includes(t))) return false
        if (spec.cardType && !o.printed.types.includes(spec.cardType)) return false
        if (spec.controller === 'you' && o.owner !== ctx.byPid) return false
        if (spec.controller === 'opponent' && o.owner === ctx.byPid) return false
        return true
      }
      if (!o || o.zoneName !== 'battlefield') return false
      if (spec.type === 'any' && !o.chars.types.includes('Creature') && !o.chars.types.includes('Planeswalker'))
        return false
      return (
        this._specMatches(spec, o) &&
        this._controllerMatches(spec, o, ctx) &&
        this._targetableBy(o, ctx.byPid, ctx.sourceColors)
      )
    }
    return false
  }

  // ---- steps -----------------------------------------------------------

  _enterStep(step) {
    const s = this.state
    s.step = step
    this._emptyManaPools()

    switch (step) {
      case 'untap': {
        this._log(`— Turn ${s.turnNumber}: ${this._nameOf(s.activePlayer)} —`, { marker: true })
        // Day/night (731.5): as a turn begins, the previous turn's spell count
        // may flip day to night (none cast) or night to day (two or more).
        if (s.daytime === 'day' && s.lastTurnSpells === 0) this._becomeDayNight('night')
        else if (s.daytime === 'night' && s.lastTurnSpells >= 2) this._becomeDayNight('day')
        for (const p of s.players) p.spellsThisTurn = 0
        this._phasing()
        // "Until your next turn" effects created by the active player end now (611.2b).
        this._expireEffects((e) => e.duration === 'untilYourNextTurn' && e.owner === s.activePlayer)
        // 502: untap active player's permanents; clear summoning sickness for
        // creatures they control; reset the land-per-turn allowance.
        for (const o of objectsIn(s, 'battlefield')) {
          o.status.attackedThisTurn = false // reset for every creature each turn
          if (o.controller === s.activePlayer) {
            // "Doesn't untap during its controller's untap step" (Claustrophobia);
            // a stun counter is removed instead of untapping (122.1g, Cryogen Relic);
            // "doesn't untap during its controller's next untap step" (Sleep of the Dead).
            if (o.status.counters?.stun > 0) {
              o.status.counters.stun--
              if (o.status.counters.stun === 0) delete o.status.counters.stun
            } else if (o.status.skipUntap) {
              o.status.skipUntap = false
            } else if (!this._restricted(o, 'untap')) this._setTapped(o, false)
            o.status.summoningSick = false
            o.status.loyaltyUsed = false // a planeswalker may act again this turn
            o.status.abilityUsed = [] // once-per-turn abilities reset
          }
        }
        s.players[s.activePlayer].landsPlayed = 0
        for (const p of s.players) p.landfall = false
        s.creatureDiedThisTurn = false // morbid
        for (const p of s.players) p.drewThisTurn = 0 // draw-count triggers are per turn
        s.spellsCastThisTurn = 0 // storm count is per turn
        break // no priority; _pump advances
      }
      case 'upkeep': {
        // 503: "at the beginning of [your] upkeep" abilities (and any delayed
        // triggers scheduled for it) go on the stack before priority.
        this._firePhaseTriggers('upkeep')
        // 726.2: at the beginning of the upkeep of the player who has the
        // initiative, that player ventures into Undercity.
        if (s.initiative === s.activePlayer)
          s.pendingTriggers.push({ controller: s.activePlayer, sourceOid: null, subjectOid: null, name: 'The Initiative', effect: [{ op: 'venture', dungeon: 'Undercity' }], targetSpec: [] })
        // Echo (702.30): pay it or sacrifice, the first upkeep after it came under
        // your control.
        for (const o of objectsIn(s, 'battlefield')) {
          if (o.controller !== s.activePlayer || !o.echoDue) continue
          o.echoDue = false
          if (this._ability(o, 'echo'))
            s.pendingTriggers.push({
              controller: o.controller,
              sourceOid: o.oid,
              subjectOid: o.oid,
              effect: [{ op: 'optionalPay', cost: o.behavior.echo.cost, effect: [], elseEffect: [{ op: 'sacrificeSelf' }] }],
              targetSpec: []
            })
        }
        // Suspend (702.62): remove a time counter from each of your suspended
        // cards; when the last is removed, cast it free (with haste).
        for (const oid of [...zone(s, 'exile', s.activePlayer)]) {
          const c = s.objects[oid]
          if (!c?.suspended) continue
          c.status.counters.time = (c.status.counters.time || 1) - 1
          this._log(`${this._objName(c)}: a time counter is removed (${c.status.counters.time} left)`)
          if (c.status.counters.time <= 0) {
            c.suspended = false
            s.pendingTriggers.push({ controller: c.owner, sourceOid: c.oid, subjectOid: c.oid, effect: [{ op: 'castFree', oid: c.oid, haste: true }], targetSpec: [] })
          }
        }
        this._grantPriority()
        break
      }
      case 'main1': {
        // 714.2b / 505.4: after the draw step, each Saga gets a lore counter and
        // its next chapter triggers.
        for (const o of objectsIn(s, 'battlefield')) {
          if (o.controller !== s.activePlayer || !this._ability(o, 'saga')) continue
          this._addLore(o)
        }
        this._grantPriority()
        break
      }
      case 'draw': {
        // 103.8a: the starting player skips only the very first draw step of the
        // game (turn 1). Every later turn — including all of theirs — draws.
        if (s.turnNumber !== 1) {
          // The draw may be replaced (dredge): pause for the choice if there is one.
          if (!this._drawSeries(s.activePlayer, 1, () => this._afterDrawStep())) return
        } else this._afterDrawStep()
        break
      }
      case 'beginCombat': {
        // "Skips their next combat phase" (Stonehorn Dignitary): spend one and go
        // straight to the postcombat main phase (506.1 — the phase is skipped whole).
        if (s.players[s.activePlayer].skipCombats > 0) {
          s.players[s.activePlayer].skipCombats--
          this._log(`${this._nameOf(s.activePlayer)} skips their combat phase`)
          this._enterStep('main2')
          break
        }
        // 507.1: "at the beginning of combat" abilities (Goblin Rabblemaster).
        this._firePhaseTriggers('beginCombat')
        this._grantPriority()
        break
      }
      case 'end': {
        // 513: "at the beginning of the end step" abilities and delayed triggers
        // (e.g. Ball Lightning's self-sacrifice, Flickerwisp's return).
        this._firePhaseTriggers('endStep')
        // 725.2: at the beginning of the monarch's end step, that player draws a card.
        if (s.monarch === s.activePlayer)
          s.pendingTriggers.push({ controller: s.activePlayer, sourceOid: null, subjectOid: null, name: 'The Monarch', effect: [{ op: 'draw', amount: 1 }], targetSpec: [] })
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
        // For the attack preview: which untapped enemy creatures could block each attacker.
        const canBeBlockedBy = {}
        for (const oid of eligible) {
          const atk = s.objects[oid]
          canBeBlockedBy[oid] = []
          for (const opp of this._opponentsOf(s.activePlayer))
            for (const b of this._eligibleBlockers(opp)) if (this._canBlock(s.objects[b], atk)) canBeBlockedBy[oid].push(b)
        }
        s.pending = {
          kind: 'declareAttackers',
          player: s.activePlayer,
          eligible,
          defenders: this._attackDefenders(),
          canBeBlockedBy
        }
        break
      }
      case 'declareBlockers': {
        // Each attacked opponent declares blockers in turn (multiplayer).
        s.combat.blocks = s.combat.blocks || {}
        s.combat.blockQueue = this._blockingPlayers()
        if (s.combat.blockQueue.length === 0) {
          this._grantPriority()
          break
        }
        this._presentBlockers()
        break
      }
      case 'combatDamage': {
        // Decisions before damage: blocker order (509.2), band damage splits (702.22c).
        if (this._combatDecisions()) return
        // 510.4: with first/double strike there are two combat damage steps —
        // players get priority after the first-strike damage, then the regular
        // damage is dealt (see _advanceStep).
        this._combatDamage()
        this._grantPriority()
        break
      }
      case 'endCombat': {
        // 511.1: "at end of combat" triggers, then creatures leave combat and
        // "until end of combat" effects end (511.3).
        this._firePhaseTriggers('endCombat')
        for (const o of objectsIn(s, 'battlefield')) {
          o.status.attacking = false
          o.status.attackingTarget = null
          o.status.blocked = false
          o.status.blocking = null
        }
        s.combat = null
        this._expireEffects((e) => e.duration === 'endOfCombat')
        this._grantPriority()
        break
      }
      case 'cleanup': {
        // 514: discard to hand size, then remove damage. No priority in M0.
        const ap = s.activePlayer
        const hand = zone(s, 'hand', ap)
        const max = this._maxHandSize(ap)
        if (hand.length > max) {
          this._log(`${this._nameOf(ap)} discards down to hand size`)
          s.pending = { kind: 'discard', player: ap, count: hand.length - max, hand: [...hand] }
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

  // Phasing (702.26): before the active player untaps, their permanents with
  // phasing phase out and their phased-out permanents phase in. A phased-out
  // permanent is treated as though it doesn't exist — we take it out of the
  // battlefield zone (keeping the object, its counters and attachments intact)
  // into state.phasedOut until it returns.
  _phasing() {
    const s = this.state
    s.phasedOut ||= []
    const ap = s.activePlayer
    // Both directions happen simultaneously (702.26d): decide what phases out
    // from the current battlefield first, so what phases in now stays.
    const out = objectsIn(s, 'battlefield').filter((o) => o.controller === ap && this._hasKW(o, 'Phasing'))
    const back = s.phasedOut.filter((p) => p.controller === ap)
    s.phasedOut = s.phasedOut.filter((p) => p.controller !== ap)
    for (const p of back) {
      for (const oid of p.oids) {
        const o = s.objects[oid]
        if (!o) continue
        o.zoneName = 'battlefield'
        s.zones.battlefield.push(oid)
      }
      this._log(`${this._objName(s.objects[p.oids[0]])} phases in`)
    }
    for (const o of out) {
      // It phases out together with anything attached to it (702.26h).
      const group = [o.oid, ...objectsIn(s, 'battlefield').filter((x) => x.status.attachedTo === o.oid).map((x) => x.oid)]
      for (const oid of group) {
        s.zones.battlefield = s.zones.battlefield.filter((x) => x !== oid)
        s.objects[oid].zoneName = 'phasedOut'
      }
      s.phasedOut.push({ controller: ap, oids: group })
      this._log(`${this._objName(o)} phases out`)
    }
  }

  // Remove floating effects (continuous, prevention, replacement) that `pred`
  // says have expired — the single place durations end (611.2a).
  _expireEffects(pred) {
    const s = this.state
    for (const e of s.continuous)
      if (e.control != null && pred(e)) {
        // A control-changing effect ending: control reverts (613 / 514.2).
        const o = s.objects[e.targets[0]]
        if (o && o.zoneName === 'battlefield' && o.controller === e.control) o.controller = e.prev
      }
    s.continuous = s.continuous.filter((e) => !pred(e))
    s.prevent = s.prevent.filter((e) => !pred(e))
    s.replacements = s.replacements.filter((e) => !pred(e))
  }

  _endCleanup() {
    const s = this.state
    for (const o of objectsIn(s, 'battlefield')) {
      o.status.damage = 0
      o.status.markedDeath = false
      o.status.regenShields = 0 // unused regeneration shields wear off (514.2)
    }
    // "Until end of turn" effects and prevention shields wear off (rule 514.2);
    // control-changing ones revert control first (Act of Treason).
    this._expireEffects((e) => !e.duration || e.duration === 'eot' || e.duration === 'endOfCombat')
    this._emptyManaPools()
    // "You may play them until the end of your next turn" permissions lapse.
    for (const o of Object.values(s.objects))
      if (o.playableUntilTurn != null && s.turnNumber >= o.playableUntilTurn && o.zoneName === 'exile') {
        o.playableFromExile = null
        o.playableUntilTurn = null
      }
    // 514.3a: if state-based actions or triggers happen now, players get priority
    // (still in the cleanup step) and another cleanup step follows.
    const acted = this._checkSBA()
    if (s.winner != null) return
    if (s.pending?.kind === 'legendChoice') return
    if (acted || s.pendingTriggers.length) {
      this._log('Cleanup: something happened — players receive priority, then another cleanup')
      s.cleanupRepeat = true
      this._grantPriority()
      return
    }
    this._lastActive = s.activePlayer // for the day/night check at the next untap
    // Extra turns (rule 500.7 / 720): a queued extra turn is taken by its owner
    // before the turn would pass to the other player.
    if (s.extraTurns?.length) {
      s.activePlayer = s.extraTurns.shift()
      this._log(`${this._nameOf(s.activePlayer)} takes an extra turn`)
    } else s.activePlayer = this._otherPlayer(s.activePlayer)
    s.extraCombats = 0 // additional-combat phases don't carry across turns
    s.lastTurnSpells = s.players[s.turnNumber >= 1 ? this._lastActive ?? s.activePlayer : s.activePlayer]?.spellsThisTurn || 0
    s.turnNumber++
    this._enterStep('untap')
  }

  _advanceStep() {
    const s = this.state
    const i = STEP_ORDER.indexOf(s.step)
    if (s.step === 'cleanup') {
      if (s.cleanupRepeat) {
        s.cleanupRepeat = false
        this._enterStep('cleanup') // another cleanup step (514.3a)
        return
      }
      this._endCleanup()
      return
    }
    // The second combat damage step (510.4): regular damage after first strike.
    if (s.step === 'combatDamage' && s.combat?.secondDamageStep) {
      s.combat.secondDamageStep = false
      recompute(s)
      this._combatDamagePass('regular')
      this._grantPriority()
      return
    }
    // Additional combat phase (Relentless Assault, rule 505/506): after the
    // post-combat main phase, loop back into a fresh combat + main instead of
    // ending the turn.
    if (s.step === 'main2' && s.extraCombats > 0) {
      s.extraCombats--
      this._enterStep('beginCombat')
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
    if (s.pending?.kind === 'legendChoice') return // SBA needs a player's choice first
    // If the active player left the game mid-turn (rule 800.4a), that turn ends and
    // the next remaining player begins theirs.
    if (s.players[s.activePlayer].hasLost) {
      s.combat = null
      this._endCleanup()
      return
    }
    // Cast opportunities queued outside a resolution (a miracle just drawn, a
    // defeated Siege) are offered before priority is handed out.
    if (s.pendingMadness.length && !this._castPaused) {
      this._processMadness(() => this._grantPriorityTo(pid))
      return
    }
    s.priorityAfter = pid
    this._advanceTriggerPlacement() // may pause for a target choice, else grants
  }

  // Put queued triggered abilities on the stack in APNAP order. Pauses with a
  // `chooseTargets` decision when a trigger needs a target; resumes via
  // _applyChooseTargets. When the queue is empty, grants priority.
  _advanceTriggerPlacement() {
    const s = this.state
    // APNAP (rule 603.3b): order triggers by seat starting from the active player,
    // so the active player's go on the stack first (lowest). Stable within a seat.
    const n = s.players.length
    const rank = (pid) => (pid - s.activePlayer + n) % n
    s.pendingTriggers.sort((a, b) => rank(a.controller) - rank(b.controller))
    while (s.pendingTriggers.length) {
      // 603.3b: a player with several triggers going on the stack at once chooses
      // their order. Asked only when the triggers actually differ (identical
      // ones — two Soul Wardens — need no choice) and not in auto mode (tests).
      const first = s.pendingTriggers[0]
      const mine = s.pendingTriggers.filter((t) => t.controller === first.controller && !t._ordered)
      if (mine.length > 1 && !this._autoOrder) {
        const key = (t) => `${s.objects[t.sourceOid]?.printed?.name}|${JSON.stringify(t.effect)}`
        if (new Set(mine.map(key)).size > 1) {
          s.pending = {
            kind: 'orderTriggers',
            player: first.controller,
            triggers: mine.map((t, i) => ({ id: i, name: this._triggerName(t) })),
            _triggers: mine
          }
          return
        }
      }
      const t = s.pendingTriggers.shift()
      // A modal trigger (Dawnbringer Cleric) chooses its mode as it goes on the
      // stack (603.3c); the chosen mode supplies the effect and target spec.
      if (t.modes && t.mode == null) {
        const castable = t.modes.map((m, i) => ({ m, i })).filter(({ m }) => (m.targets || []).every((sp) => this._legalTargetsExist(sp)))
        if (!castable.length) continue
        if (castable.length === 1) {
          const pick = castable[0]
          t.mode = pick.i
          t.effect = pick.m.effect
          t.targetSpec = pick.m.targets || []
        } else {
          s.pending = {
            kind: 'chooseValue',
            player: t.controller,
            options: castable.map(({ m }) => m.label),
            label: `${this._triggerName(t)} — choose one`,
            _triggerModes: { trigger: t, choices: castable }
          }
          s.pendingTriggers.unshift(t)
          return
        }
      }
      const spec = t.targetSpec || []
      // "You may …" with no target: ask before it goes on the stack.
      if (t.optional && !spec.length && !t._accepted) {
        s.pending = { kind: 'optionalTrigger', player: t.controller, name: this._triggerName(t), _trigger: t }
        return
      }
      if (spec.length) {
        if (!spec.every((sp) => this._legalTargetsExist(sp))) continue // fizzles: no legal target
        s.pending = {
          kind: 'chooseTargets',
          player: t.controller,
          sourceOid: t.sourceOid,
          name: this._triggerName(t),
          targets: spec,
          optional: !!t.optional, // may be declined
          _trigger: t
        }
        return
      }
      this._placeTrigger(t, t.targets || []) // preset (non-chosen) targets, e.g. exalted's attacker
    }
    const pid = s.priorityAfter ?? s.activePlayer
    s.prio = { player: pid, passCount: 0 }
    s.pending = { kind: 'priority', player: pid, actions: this._legalActions(pid), reasons: this._lastReasons }
  }

  _triggerName(t) {
    return t.name || this.state.objects[t.sourceOid]?.printed?.name || 'Ability'
  }

  // 603.3b answer: `order` lists trigger ids first-on-the-stack first (so the
  // last listed resolves first). A missing/partial order keeps the default.
  _applyOrderTriggers(pending, answer) {
    const s = this.state
    const mine = pending._triggers
    const ids = Array.isArray(answer?.order) ? answer.order.filter((i) => Number.isInteger(i) && i >= 0 && i < mine.length) : []
    const ordered = [...new Set(ids)].map((i) => mine[i])
    for (const t of mine) if (!ordered.includes(t)) ordered.push(t)
    for (const t of ordered) t._ordered = true
    const rest = s.pendingTriggers.filter((t) => !mine.includes(t))
    s.pendingTriggers = [...ordered, ...rest]
    this._advanceTriggerPlacement()
  }

  _applyOptionalTrigger(pending, answer) {
    const t = pending._trigger
    if (answer?.yes !== false) {
      t._accepted = true
      this.state.pendingTriggers.unshift(t)
    }
    this._advanceTriggerPlacement()
  }

  _placeTrigger(t, chosenTargets) {
    const ao = createAbility(this.state, {
      controller: t.controller,
      sourceOid: t.sourceOid,
      name: t.name || null, // a sourceless trigger of the game (the monarch, a dungeon room)
      dungeonRoom: t.dungeonRoom || null,
      subjectOid: t.subjectOid ?? null, // what the trigger was about ("it gets +1/+0")
      effect: t.effect,
      targets: chosenTargets,
      condition: t.condition || null,
      extra: t.extra || null
    })
    zone(this.state, 'stack').push(ao.oid)
    // A triggered ability that targets a warded permanent triggers its ward too —
    // but a ward's own tax ability (which targets nothing) must not recurse.
    if (!t.effect?.some?.((e) => e.op === 'wardTax')) this._checkWard(ao.oid, t.controller, chosenTargets)
  }

  _applyChooseTargets(pending, answer) {
    if (pending._retarget) {
      // Changing a spell's targets (115.7) mid-resolution of the changing effect.
      const sp = this.state.objects[pending._retarget]
      if (!answer?.decline && sp?.zoneName === 'stack') {
        sp.targets = answer.targets
        this._log(`${this._objName(sp)} now targets${this._describeTargets(sp.targets).replace(' targeting', '')}`)
      }
      this._resumeResolution()
      return
    }
    if (pending.optional && answer?.decline) {
      this._advanceTriggerPlacement() // "you may": declined, the trigger does nothing
      return
    }
    const src = this.state.objects[pending.sourceOid]
    this._assertTargetsLegal(answer?.targets, pending.player, tags(src?.chars || src?.printed))
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
    // "…loses N life unless they discard a card": declined, they lose the life;
    // then the next player in line decides.
    if (pending.elseLoseLife && discard.length === 0) {
      this._loseLife(pending.player, pending.elseLoseLife)
      this._log(`${this._nameOf(pending.player)} loses ${pending.elseLoseLife} life (${this.state.players[pending.player].life})`)
    }
    if (pending._lifeQueue) {
      const q = pending._lifeQueue
      const life = pending.elseLoseLife
      this._processMadness(() => {
        if (!this._nextDiscardOrLoseLife(q, life)) this._resumeResolution()
      })
      return
    }
    // "Each opponent discards": prompt the next opponent before resuming (empties
    // along the way draw for the controller).
    if (pending._oppQueue) {
      const s = this.state
      let next = null
      while (pending._oppQueue.length) {
        const cand = pending._oppQueue.shift()
        if (zone(s, 'hand', cand).length > 0) {
          next = cand
          break
        }
        if (pending._oppDrawIfEmpty) this.draw(pending._oppController, 1)
      }
      if (next != null) {
        this._processMadness(() => {
          s.pending = {
            kind: 'discardCards',
            player: next,
            count: 1,
            hand: [...zone(s, 'hand', next)],
            _oppQueue: pending._oppQueue,
            _oppDrawIfEmpty: pending._oppDrawIfEmpty,
            _oppController: pending._oppController
          }
        })
        return
      }
    }
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
    const toBottom = pending.noBottom ? [] : (answer?.toBottom || []).filter((oid) => scried.includes(oid))
    const rest = scried.filter((oid) => !toBottom.includes(oid))
    const topOrder = answer?.toTop?.length === rest.length && rest.every((oid) => answer.toTop.includes(oid)) ? answer.toTop : rest

    if (pending.surveil) {
      for (const oid of toBottom) moveObject(s, oid, 'graveyard')
    } else {
      for (const oid of toBottom) lib.push(oid) // to the bottom
    }
    for (let i = topOrder.length - 1; i >= 0; i--) lib.unshift(topOrder[i]) // back on top
    if (pending.mayShuffle && answer?.shuffle) {
      s.zones[zoneKey('library', pid)] = s.rng.shuffle(lib)
      this._log(`${this._nameOf(pid)} shuffles`)
    }

    this._resumeResolution()
  }

  // "Target noncreature spell" (Negate), "target instant spell" (Dispel),
  // "target creature spell": a stack object's printed types against the spec.
  _spellSpecOk(spec, o) {
    if (!o) return false
    const types = o.kind === 'ability' ? [] : o.printed?.types || []
    if (spec.noncreature && types.includes('Creature')) return false
    if (spec.spellType && !types.includes(spec.spellType)) return false
    if (spec.spellTypes && !spec.spellTypes.some((t) => types.includes(t))) return false // "artifact or enchantment spell" (Annul)
    if (spec.spellColor && !(o.printed?.colors || []).includes(spec.spellColor)) return false // "target blue spell"
    return true
  }

  // Does a battlefield object satisfy a target spec (type + exclusions)?
  _specMatches(spec, o) {
    if (spec.type === 'creature' && !o.chars.types.includes('Creature')) return false
    if (spec.attacking && !o.status.attacking) return false // "target attacking creature"
    if (spec.type === 'land' && !o.chars.types.includes('Land')) return false
    if (spec.subtype && !hasSub(o.chars, spec.subtype)) return false // "target Forest"
    if (spec.type === 'artifact' && !o.chars.types.includes('Artifact')) return false
    if (spec.noncreature && o.chars.types.includes('Creature')) return false
    if (spec.nonHuman && hasSub(o.chars, 'Human')) return false
    if (spec.types && !spec.types.some((t) => o.chars.types.includes(t))) return false
    if (spec.exclude?.some((t) => o.chars.types.includes(t))) return false
    if (spec.excludeSuper?.some((t) => o.chars.supertypes.includes(t))) return false
    // Color restriction (Doom Blade: "target nonblack creature"). Reads the current
    // characteristics, so a layer-5 color change (Aphotic Wisps) makes a creature
    // an illegal/legal target as expected.
    if (spec.excludeColor && o.chars.colors.includes(spec.excludeColor)) return false
    if (spec.color && !(o.chars.colors || []).includes(spec.color)) return false // "target blue permanent"
    if (spec.nonland && o.chars.types.includes('Land')) return false // "target nonland permanent"
    if (spec.tapped && !o.status.tapped) return false // "target tapped creature"
    if (spec.type === 'enchantment' && !o.chars.types.includes('Enchantment')) return false
    if (spec.minToughness != null && (o.chars.toughness ?? 0) < spec.minToughness) return false // "toughness 4 or greater"
    if (spec.maxPower != null && (o.chars.power ?? 0) > spec.maxPower) return false // "power 2 or less"
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
    if (prot.includes('everything')) return false
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
    if (spec.type === 'spell') return zone(s, 'stack').some((oid) => this._spellSpecOk(spec, s.objects[oid]))
    if (spec.optional) return true // "up to one" — the spell is castable without it
    if (spec.type === 'graveyardCard')
      return s.players.some(
        (p) =>
          (spec.controller !== 'you' || p.id === ctx?.byPid) &&
          (spec.controller !== 'opponent' || p.id !== ctx?.byPid) &&
          zone(s, 'graveyard', p.id).some((oid) => {
            const o = s.objects[oid]
            if (spec.types && !spec.types.some((t) => o.printed.types.includes(t))) return false
            if (spec.cardType && !o.printed.types.includes(spec.cardType)) return false
            return true
          })
      )
    if (spec.type === 'creature' || spec.type === 'land' || spec.type === 'artifact' || spec.type === 'enchantment' || spec.type === 'permanent') {
      // A variadic slot ("N target creatures", "up to N…") needs at least `min`
      // legal targets to be cast (601.2c); a normal slot needs one.
      const min = spec.min ?? 1
      const n = objectsIn(s, 'battlefield').filter(
        (o) =>
          this._specMatches(spec, o) &&
          this._controllerMatches(spec, o, ctx) &&
          (!ctx || this._targetableBy(o, ctx.byPid, ctx.sourceColors))
      ).length
      return n >= min
    }
    return true
  }

  // "target creature you control" / "an opponent controls" — matches the target's
  // controller against the targeting player (from ctx.byPid). No restriction passes.
  _controllerMatches(spec, o, ctx) {
    if (spec.owner === 'you' && ctx && o.owner !== ctx.byPid) return false
    if (!spec.controller || !ctx) return true
    return spec.controller === 'you' ? o.controller === ctx.byPid : o.controller !== ctx.byPid
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
  _targetStillLegal(controllerPid, sourceColors, ref, allowGraveyard = false) {
    const s = this.state
    if (!ref) return false
    if (ref.kind === 'player') return s.players[ref.pid] != null
    if (ref.kind === 'spell') return zone(s, 'stack').includes(ref.oid)
    if (ref.kind === 'object') {
      const o = s.objects[ref.oid]
      if (allowGraveyard && o?.zoneName === 'graveyard') return true // "target card in a graveyard"
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
    const colors = tags(o.kind === 'ability' ? src?.chars : o.printed)
    const specs = o.kind === 'ability' ? o.targetSpecs || [] : this._spellTargets(o)
    const gy = specs.some((sp) => sp.type === 'graveyardCard')
    return refs.every((r) => !this._targetStillLegal(o.controller, colors, r, gy))
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
    if (o.kind !== 'ability' && this._uncounterable(o)) return // "can't be countered"
    this._log(`${this._objName(o)} is countered`)
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
      // The stack resolves (or the step ends) once every player still in the game
      // has passed in succession (rule 117.4).
      if (s.prio.passCount >= this._activeCount()) {
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
        s.pending = { kind: 'priority', player: next, actions: this._legalActions(next), reasons: this._lastReasons }
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

  // ---- primitives ------------------------------------------------------

  draw(pid, n = 1) {
    const s = this.state
    const p = s.players[pid]
    // Card identity is hidden information; the log only records the count.
    if (s.step && s.step !== 'mulligan') this._log(`${p.name} draws ${n === 1 ? 'a card' : `${n} cards`}`)
    for (let i = 0; i < n; i++) {
      const lib = zone(s, 'library', pid)
      if (lib.length === 0) {
        if (this._ruleMods().some(({ source, mod }) => mod.winOnEmptyDraw && source.controller === pid)) {
          this._log(`${p.name} would draw from an empty library and wins the game instead`, { marker: true })
          s.winner = pid
          for (const q of s.players) if (q.id !== pid) q.loses = true
          return
        }
        p.loses = true // drew from an empty library (SBA, rule 704.5c)
        continue
      }
      moveObject(s, lib[0], 'hand')
      // Draw-count triggers (Sneaky Snacker: "when you draw your third card…").
      p.drewThisTurn = (p.drewThisTurn || 0) + 1
      if (p.drewThisTurn === 3) this._onThirdDraw(pid)
      if (s.step && s.step !== 'mulligan') this._firePlayerEvent('draw', pid)
      // Miracle (702.94): the first card drawn this turn may be cast for its
      // miracle cost right away (offered before priority is next granted).
      const drawn = s.objects[zone(s, 'hand', pid)[zone(s, 'hand', pid).length - 1]]
      if (drawn?.behavior?.miracle && p.drewThisTurn === 1 && s.step && s.step !== 'mulligan')
        s.pendingMadness.push({ pid, oid: drawn.oid, cost: drawn.behavior.miracle.cost, miracle: true })
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

  // The next still-in-the-game player in seat order (rule 802). For a two-player
  // game this is simply the opponent; kept named _otherPlayer for its many callers.
  _otherPlayer(pid) {
    return this._nextInSeat(pid)
  }

  _nextInSeat(pid) {
    const n = this.state.players.length
    for (let i = 1; i <= n; i++) {
      const cand = (pid + i) % n
      if (!this.state.players[cand].hasLost) return cand
    }
    return pid
  }

  // All players other than `pid` who are still in the game.
  _opponentsOf(pid) {
    return this.state.players.filter((p) => p.id !== pid && !p.hasLost).map((p) => p.id)
  }

  _activeCount() {
    return this.state.players.filter((p) => !p.hasLost).length
  }

  // A player leaves the game (rule 800.4): mark them out and remove the objects
  // they own from the battlefield and stack. The turn/priority helpers skip them.
  _eliminate(p) {
    const s = this.state
    p.hasLost = true
    this._log(`${p.name} loses the game`, { marker: true })
    // Objects they own leave the game (to their exile zone; tokens cease to
    // exist); anything they merely controlled reverts to its owner (800.4a/c).
    for (const key of ['battlefield', 'stack']) {
      for (const oid of [...s.zones[key]]) {
        const o = s.objects[oid]
        if (!o) continue
        if (o.owner === p.id) {
          if (o.kind === 'ability') {
            s.zones[key] = s.zones[key].filter((x) => x !== oid)
            delete s.objects[oid]
          } else moveObject(s, oid, 'exile')
        } else if (o.controller === p.id) o.controller = o.owner
      }
    }
    s.continuous = s.continuous.filter((e) => e.control !== p.id)
    p.dungeon = null
    // 725.4 / 726.4: the monarch / initiative pass to the active player (or the
    // next player in turn order if the active player is the one leaving).
    const heir = () => (s.players[s.activePlayer].hasLost ? this._nextInSeat(s.activePlayer) : s.activePlayer)
    if (s.monarch === p.id) {
      s.monarch = null
      const h = heir()
      if (!s.players[h].hasLost) this._becomeMonarch(h)
    }
    if (s.initiative === p.id) {
      s.initiative = null
      const h = heir()
      if (!s.players[h].hasLost) this._takeInitiative(h)
    }
  }

  // Number of Faerie creatures a player controls (Spellstutter Sprite's X).
  _faerieCount(pid) {
    return objectsIn(this.state, 'battlefield').filter(
      (o) => o.controller === pid && o.chars.types.includes('Creature') && hasSub(o.chars, 'Faerie')
    ).length
  }
}

// The subsystems split into their own files (same class, same `this`).
Object.assign(GameEngine.prototype, designationsMethods, legalMethods, actionsMethods, effectsMethods, manaMethods, combatMethods, triggersMethods)
