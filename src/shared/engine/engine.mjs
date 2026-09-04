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

// What a source "is" for protection purposes (702.16): its colours and its types,
// matched against a permanent's `protections` list ('B', 'Creature', 'everything').
const tags = (c) => (c ? [...(c.colors || []), ...(c.types || [])] : [])

// Sum two parsed mana costs (a spell's cost plus a kicker cost, …).
function addCosts(a, b) {
  const out = { ...a }
  for (const k of ['W', 'U', 'B', 'R', 'G', 'C', 'generic', 'X']) if (b[k]) out[k] = (out[k] || 0) + b[k]
  for (const k of ['hybrid', 'phyrexian', 'twobrid']) if (b[k]) out[k] = [...(out[k] || []), ...b[k]]
  return out
}

export class GameEngine {
  constructor(opts) {
    this.state = createState(opts)
    // Who plays first: a seat index, or (default) a seeded random pick (103.1).
    this._startingPlayer = opts.startingPlayer
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
    const explicit = Number.isInteger(this._startingPlayer)
    s.startingPlayer = explicit ? this._startingPlayer : s.rng.int(n)
    for (const p of s.players) this.draw(p.id, handSize)
    s.step = 'mulligan'
    if (explicit) return this._beginMulligans()
    // 103.2/103.7a: the player who won the die roll chooses to play or draw.
    s.pending = { kind: 'playOrDraw', player: s.startingPlayer }
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

  // ---- choosing a card name (201.3) ------------------------------------
  // The engine can't know every Magic card name, so any non-empty name is
  // accepted; the only check it can make is against cards it has seen (a
  // "nonland card name" may not name a land that is in the game). Names are
  // compared case-insensitively, and a split card matches either half.

  _nameMatches(o, name) {
    if (!name || !o) return false
    const want = String(name).trim().toLowerCase()
    const names = [o.printed?.name, ...(o.faces || []).map((f) => f.name), o.combined?.name].filter(Boolean)
    return names.some((n) => n.toLowerCase() === want || n.split(' // ').some((h) => h.toLowerCase() === want))
  }

  // Card names the chooser is allowed to know: everything in public zones plus
  // their own hand and decklist (never another player's hidden cards).
  _knownCardNames(pid) {
    const s = this.state
    const names = new Set()
    for (const o of Object.values(s.objects)) {
      if (o.kind === 'ability' || o.kind === 'emblem' || o.token || !o.printed?.name) continue
      const z = o.zoneName
      const publicZone = z === 'battlefield' || z === 'graveyard' || z === 'stack' || z === 'command' || (z === 'exile' && !o.faceDown)
      if (publicZone || o.owner === pid) names.add(o.printed.name)
    }
    return [...names].sort()
  }

  _askCardName(player, holder, opts = {}) {
    this.state.pending = {
      kind: 'chooseName',
      player,
      label: opts.label || (opts.nonland ? 'Choose a nonland card name' : 'Choose a card name'),
      nonland: !!opts.nonland,
      suggestions: this._knownCardNames(player),
      _holder: holder, // the object that remembers the chosen name (a permanent entering, or a resolving spell/ability)
      _enter: !!opts.enter
    }
  }

  _applyChooseName(pending, answer) {
    const s = this.state
    const name = String(answer?.name ?? '').trim()
    if (!name || name.length > 141) throw new Error('choose a card name')
    if (pending.nonland) {
      const known = Object.values(s.objects).find((o) => this._nameMatches(o, name))
      if (known?.printed?.types?.includes('Land') && !known.printed.types.some((t) => t !== 'Land')) throw new Error('choose a nonland card name')
    }
    const holder = pending._holder
    holder.chosen = name
    this._log(`${this._nameOf(pending.player)} names ${name}`)
    if (pending._enter) {
      // "As this enters, choose a card name" (Pithing Needle): now it enters.
      moveObject(s, holder.oid, 'battlefield')
      this._enterBattlefield(holder, holder.controller ?? holder.owner)
      if (!this._resume) this._grantPriorityTo(s.activePlayer)
      return
    }
    this._resumeResolution()
  }

  // ---- dungeons (309 / 701.49), the monarch (725) and the initiative (726) --

  _becomeMonarch(pid) {
    const s = this.state
    if (s.players[pid]?.hasLost || s.monarch === pid) return
    s.monarch = pid
    this._log(`${this._nameOf(pid)} becomes the monarch`, { marker: true })
    this._firePlayerEvent('becomesMonarch', pid)
  }

  _takeInitiative(pid) {
    const s = this.state
    if (s.players[pid]?.hasLost) return
    if (s.initiative !== pid) this._log(`${this._nameOf(pid)} takes the initiative`, { marker: true })
    s.initiative = pid
    // 726.2: "Whenever a player takes the initiative, that player ventures into
    // Undercity" — an inherent trigger of the game, with no source (also 726.5:
    // taking it again still triggers).
    s.pendingTriggers.push({ controller: pid, sourceOid: null, subjectOid: null, name: 'The Initiative', effect: [{ op: 'venture', dungeon: 'Undercity' }], targetSpec: [] })
    this._firePlayerEvent('takesInitiative', pid)
  }

  // Venture into the dungeon (701.49). Pauses for a room or dungeon choice when
  // there is one (auto mode picks the first option); returns true if it paused.
  _venture(pid, dungeonName) {
    const s = this.state
    const p = s.players[pid]
    if (p.hasLost) return false
    if (!p.dungeon) {
      // No dungeon in the command zone: bring one in (309.2a). "Venture into
      // Undercity" names it (701.49d); otherwise the player picks one.
      if (dungeonName && DUNGEONS[dungeonName]) return this._enterDungeon(pid, dungeonName)
      if (this._autoOrder || REGULAR_DUNGEONS.length === 1) return this._enterDungeon(pid, REGULAR_DUNGEONS[0])
      s.pending = { kind: 'chooseDungeon', player: pid, options: REGULAR_DUNGEONS.map((n) => ({ name: n, scryfallId: DUNGEONS[n].scryfallId })) }
      return true
    }
    const room = roomOf(p.dungeon.name, p.dungeon.room)
    const next = room?.next || []
    if (!next.length) {
      // Already in the bottommost room (309.5b): the dungeon leaves the game
      // (completing it) and a fresh one is entered.
      this._completeDungeon(pid)
      return this._venture(pid, dungeonName)
    }
    if (next.length === 1 || this._autoOrder) return this._moveVenture(pid, next[0])
    s.pending = {
      kind: 'chooseRoom',
      player: pid,
      dungeon: p.dungeon.name,
      options: next.map((id) => ({ id, name: roomOf(p.dungeon.name, id).name, text: roomOf(p.dungeon.name, id).text }))
    }
    return true
  }

  _enterDungeon(pid, name) {
    const p = this.state.players[pid]
    const d = DUNGEONS[name]
    p.dungeon = { name, room: null }
    this._log(`${p.name} enters ${name}`)
    return this._moveVenture(pid, d.rooms[0].id)
  }

  // Move the venture marker into a room and trigger its room ability (309.4c).
  _moveVenture(pid, roomId) {
    const s = this.state
    const p = s.players[pid]
    p.dungeon.room = roomId
    const room = roomOf(p.dungeon.name, roomId)
    this._log(`${p.name} ventures into ${room.name} (${p.dungeon.name})`)
    s.pendingTriggers.push({
      controller: pid,
      sourceOid: null,
      subjectOid: null,
      name: `${p.dungeon.name} — ${room.name}`,
      dungeonRoom: { pid, dungeon: p.dungeon.name, room: roomId },
      effect: room.effect,
      targetSpec: room.targets || []
    })
    return false
  }

  _completeDungeon(pid) {
    const p = this.state.players[pid]
    if (!p.dungeon) return
    this._log(`${p.name} completes ${p.dungeon.name}`, { marker: true })
    p.dungeon = null
    p.completedDungeons = (p.completedDungeons || 0) + 1
    this._firePlayerEvent('completesDungeon', pid)
  }

  // 309.6: a dungeon whose marker sits in its bottommost room leaves the game once
  // that room's ability has left the stack.
  _dungeonSBA() {
    const s = this.state
    let acted = false
    for (const p of s.players) {
      if (!p.dungeon || p.hasLost) continue
      const room = roomOf(p.dungeon.name, p.dungeon.room)
      if (!room || room.next?.length) continue
      const busy =
        zone(s, 'stack').some((oid) => s.objects[oid]?.kind === 'ability' && s.objects[oid].dungeonRoom?.pid === p.id) ||
        s.pendingTriggers.some((t) => t.dungeonRoom?.pid === p.id)
      if (busy) continue
      this._completeDungeon(p.id)
      acted = true
    }
    return acted
  }

  _applyChooseRoom(pending, answer) {
    const p = this.state.players[pending.player]
    const opt = pending.options.find((o) => o.id === answer?.room)
    if (!opt) throw new Error('choose one of the rooms')
    this._moveVenture(pending.player, opt.id)
    void p
    this._resumeResolution()
  }

  _applyChooseDungeon(pending, answer) {
    const opt = pending.options.find((o) => o.name === answer?.dungeon)
    if (!opt) throw new Error('choose one of the dungeons')
    this._enterDungeon(pending.player, opt.name)
    this._resumeResolution()
  }

  _applyPlayOrDraw(pending, answer) {
    const s = this.state
    if (answer?.play === false) {
      this._log(`${this._nameOf(pending.player)} chooses to draw`)
      s.startingPlayer = this._nextInSeat(pending.player)
    }
    this._beginMulligans()
  }

  // London mulligan phase, resolved player by player in turn order from the
  // starting player (103.5), before turn 1.
  _beginMulligans() {
    const s = this.state
    const n = s.players.length
    s.activePlayer = s.startingPlayer
    s.mulliganOrder = Array.from({ length: n }, (_, i) => (s.startingPlayer + i) % n)
    s.mulliganDeciding = [...s.mulliganOrder]
    s.mulliganRound = []
    this._log(`${s.players[s.startingPlayer].name} plays first`)
    this._askMulligan()
    return this
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
    if (o.kind === 'ability') return o.sourceOid ? `${this._objName(this.state.objects[o.sourceOid])}'s ability` : o.name || 'an ability'
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
          if (!pending.attackers.includes(atk)) throw new Error('illegal block: not an attacker aimed at you')
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
    if (a.hybrid && (!match.hybrid || a.hybrid.some((c, i) => c != null && !match.hybrid[i]?.includes(c)))) throw new Error('illegal hybrid mana choice')
    if (a.twobrid && (!match.twobrid || a.twobrid.some((c, i) => c != null && c !== '2' && c !== match.twobrid[i]))) throw new Error('illegal two-brid mana choice')
    if (a.hybrid || a.twobrid) {
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
    if (list.length !== need.length) throw new Error(`choose ${need.length} target(s)`)
    list.forEach((ref, i) => {
      if (!this._targetMatches(ref, need[i], ctx)) throw new Error('illegal target')
    })
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
    if (ref.kind === 'spell') return spec.type === 'spell' && zone(s, 'stack').includes(ref.oid)
    if (ref.kind === 'object') {
      if (spec.type === 'player' || spec.type === 'spell') return false
      const o = s.objects[ref.oid]
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
        this._phasing()
        // "Until your next turn" effects created by the active player end now (611.2b).
        this._expireEffects((e) => e.duration === 'untilYourNextTurn' && e.owner === s.activePlayer)
        // 502: untap active player's permanents; clear summoning sickness for
        // creatures they control; reset the land-per-turn allowance.
        for (const o of objectsIn(s, 'battlefield')) {
          o.status.attackedThisTurn = false // reset for every creature each turn
          if (o.controller === s.activePlayer) {
            // "Doesn't untap during its controller's untap step" (Claustrophobia).
            if (!this._restricted(o, 'untap')) this._setTapped(o, false)
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
    // Extra turns (rule 500.7 / 720): a queued extra turn is taken by its owner
    // before the turn would pass to the other player.
    if (s.extraTurns?.length) {
      s.activePlayer = s.extraTurns.shift()
      this._log(`${this._nameOf(s.activePlayer)} takes an extra turn`)
    } else s.activePlayer = this._otherPlayer(s.activePlayer)
    s.extraCombats = 0 // additional-combat phases don't carry across turns
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
    if (spec.nonHuman && hasSub(o.chars, 'Human')) return false
    if (spec.types && !spec.types.some((t) => o.chars.types.includes(t))) return false
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
    if (spec.type === 'spell') return zone(s, 'stack').length > 0
    if (spec.type === 'creature' || spec.type === 'land' || spec.type === 'artifact' || spec.type === 'permanent') {
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
    const colors = tags(o.kind === 'ability' ? src?.chars : o.printed)
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

  // ---- legal actions ---------------------------------------------------

  _legalActions(pid) {
    const s = this.state
    const actions = [{ type: 'pass' }]
    const reasons = {} // oid -> why a hand card can't be played right now (for the UI)
    this._lastReasons = reasons
    const stackEmpty = zone(s, 'stack').length === 0
    const sorcerySpeed = pid === s.activePlayer && MAIN_STEPS.has(s.step) && stackEmpty
    const player = s.players[pid]
    // A split card offers each half (709.3a); a modal DFC either face (712.11b);
    // a transforming DFC only its front. Each variant is evaluated with that
    // face's characteristics and behavior.
    const variantsOf = (o) =>
      o.faces && (o.layout === 'split' || o.layout === 'modal_dfc')
        ? o.faces.map((printed, face) => ({ face, printed, behavior: loadBehavior(printed) }))
        : [{ face: null, printed: o.printed, behavior: o.behavior }]
    // "You can't play lands or cast spells from your hand" (Experimental Frenzy).
    const handLocked = this._ruleMods().find(({ source, mod }) => mod.cantPlayFromHand && source.controller === pid)

    for (const oid of zone(s, 'hand', pid)) {
      const o = s.objects[oid]
      if (handLocked) {
        reasons[oid] = `${this._objName(handLocked.source)}: you can't play cards from your hand`
        continue
      }
      const variants = variantsOf(o)
      for (const v of variants) this._handCastActions(pid, o, v, actions, sorcerySpeed, reasons)
      const p = o.printed
      // Cycling (702.29): from hand, any time you have priority.
      const cyc = o.behavior?.cycling
      if (cyc && (!cyc.cost || this._canPay(pid, parseManaCost(cyc.cost))) && (!cyc.life || player.life >= cyc.life))
        actions.push({ type: 'cycle', oid, label: `Cycle ${p.name}` })
      // Suspend (702.62): a special action, at the card's own timing.
      const sus = o.behavior?.suspend
      if (sus && (p.types.includes('Instant') || sorcerySpeed) && this._canPay(pid, parseManaCost(sus.cost)))
        actions.push({ type: 'suspend', oid, label: `Suspend ${p.name} (${sus.count})` })
      if (p.types.includes('Land')) continue
      // Morph (702.37): cast the card face down as a 2/2 creature for {3}.
      if (o.behavior?.morph && sorcerySpeed && this._canPay(pid, parseManaCost('{3}')))
        actions.push({ type: 'castFaceDown', oid, label: `${p.name} (face down)` })
      // Omen / adventure: the alternate castable half (sorcery speed).
      const om = o.behavior?.omen
      if (om && sorcerySpeed && this._canPay(pid, parseManaCost(om.cost))) {
        const t = om.targets || []
        const octx = { byPid: pid, sourceColors: tags(p) }
        if (!t.length || t.every((x) => this._legalTargetsExist(x, octx)))
          actions.push({ type: 'castOmen', oid, label: om.name, targets: t, needsTargets: t.length })
      }
      // Bestow (702.103): cast the card as an Aura on a creature for its bestow cost.
      const bst = o.behavior?.bestow
      if (bst && sorcerySpeed) {
        const bcost = parseManaCost(bst.cost)
        const fixed = { ...bcost, X: 0 }
        const bx = bcost.X || 0
        if (this._legalTargetsExist({ type: 'creature' }, { byPid: pid, sourceColors: tags(p) }) && this._canPay(pid, fixed)) {
          const sources = this._manaAvailable(pid)
          const fixedMV = manaValue(fixed)
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
      const unblocked = () =>
        s.combat && s.step === 'declareBlockers'
          ? s.combat.attackers.filter((aoid) => {
              const a = s.objects[aoid]
              return a && a.controller === pid && a.status.attacking && !a.status.blocked
            })
          : []
      if (nin && this._canPay(pid, parseManaCost(nin.cost))) {
        const returns = unblocked()
        if (returns.length) actions.push({ type: 'ninjutsu', oid, label: `Ninjutsu ${p.name}`, returns })
      }
      // Sneak (702.176 — Leonardo): cast for its sneak cost, returning an unblocked
      // attacker you control to hand; it enters tapped and attacking.
      const snk = o.behavior?.sneak
      if (snk && this._canPay(pid, parseManaCost(snk.cost))) {
        const returns = unblocked()
        if (returns.length) actions.push({ type: 'cast', oid, sneak: true, label: `Sneak ${p.name} (${snk.cost})`, returns, targets: [], needsTargets: 0 })
      }
      // Web-slinging (Spider-Man): cast for its web-slinging cost by also
      // returning a tapped creature you control to its owner's hand.
      const web = o.behavior?.webSlinging
      if (web && (p.types.includes('Instant') || p.keywords.includes('Flash') || sorcerySpeed) && this._canPay(pid, parseManaCost(web.cost))) {
        const returns = objectsIn(s, 'battlefield')
          .filter((c) => c.controller === pid && c.chars.types.includes('Creature') && c.status.tapped)
          .map((c) => c.oid)
        if (returns.length) actions.push({ type: 'cast', oid, webSlinging: true, label: `Web-slinging ${p.name} (${web.cost})`, returns, targets: [], needsTargets: 0 })
      }
    }

    // Disturb (702.148): cast a double-faced card from your graveyard transformed,
    // for its disturb cost, at the back face's timing (a creature: sorcery speed).
    for (const oid of zone(s, 'graveyard', pid)) {
      const o = s.objects[oid]
      const dis = o.behavior?.disturb
      if (!dis || !o.faces?.[1] || !sorcerySpeed || !this._canPay(pid, parseManaCost(dis.cost))) continue
      actions.push({ type: 'castDisturb', oid, label: `Disturb ${o.faces[1].name} (${dis.cost})`, targets: [], needsTargets: 0 })
    }

    // Prepared (Elite Interceptor): while a permanent is prepared you may cast a
    // copy of its spell half, paying that half's cost; doing so unprepares it.
    for (const oid of zone(s, 'battlefield')) {
      const o = s.objects[oid]
      const pr = o.behavior?.prepared
      if (!pr || !o.prepared || o.controller !== pid) continue
      const inst = (pr.types || []).includes('Instant')
      if (!(inst || sorcerySpeed) || !this._canPay(pid, parseManaCost(pr.cost))) continue
      const targets = pr.spell?.targets || []
      const pctx = { byPid: pid, sourceColors: tags(o.chars || o.printed) }
      if (targets.length && !targets.every((t) => this._legalTargetsExist(t, pctx))) continue
      actions.push({ type: 'castPrepared', oid, label: `Cast ${pr.name} (${pr.cost}, unprepares ${o.printed.name})`, targets, needsTargets: targets.length })
    }

    // Commander (903.6): castable from the command zone, paying the commander tax.
    for (const oid of zone(s, 'command')) {
      const o = s.objects[oid]
      if (!o?.isCommander || o.owner !== pid) continue
      this._handCastActions(pid, o, { face: null, printed: o.printed, behavior: o.behavior }, actions, sorcerySpeed)
    }

    // Playing from the top of the library (Future Sight, Courser of Kruphix, …):
    // a static permission per card type / spell filter. The card is cast or
    // played straight from the library; the action carries `fromTop`.
    const topMods = this._ruleMods().filter(({ source, mod }) => mod.playFromTop && source.controller === pid)
    const topOid = zone(s, 'library', pid)[0]
    if (topMods.length && topOid) {
      const o = s.objects[topOid]
      for (const v of variantsOf(o)) {
        const tmp = []
        this._handCastActions(pid, o, v, tmp, sorcerySpeed)
        const isLand = v.printed.types.includes('Land')
        const allowed = topMods.some(({ source, mod }) => {
          const pf = mod.playFromTop
          if (isLand) return !!pf.lands
          return pf.spells === true || (pf.spells && this._spellMatchesFilter(pid, v.printed, pf.spells, source))
        })
        if (allowed) for (const a of tmp) actions.push({ ...a, fromTop: true, label: `${a.label || v.printed.name} (from the top of your library)` })
      }
    }

    // Cards exiled with "you may play them" (Runestone Caverns): from exile, as
    // if from hand, for as long as they stay there.
    for (const oid of zone(s, 'exile', pid)) {
      const o = s.objects[oid]
      if (o.playableFromExile !== pid) continue
      const tmp = []
      for (const v of variantsOf(o)) this._handCastActions(pid, o, v, tmp, sorcerySpeed)
      for (const a of tmp) actions.push({ ...a, fromExile: true, label: `${a.label || o.printed.name} (from exile)` })
    }

    // Plotted cards: cast from exile for free on a later turn (702.170d).
    for (const oid of zone(s, 'exile', pid)) {
      const o = s.objects[oid]
      if (!o.plotted || o.plottedTurn >= s.turnNumber || !sorcerySpeed) continue
      const targets = this._spellTargets(o)
      const pctx = { byPid: pid, sourceColors: tags(o.printed) }
      if (targets.length && !targets.every((t) => this._legalTargetsExist(t, pctx))) continue
      actions.push({
        type: 'castPlotted',
        oid,
        label: `${o.printed.name} (plotted)`,
        targets,
        needsTargets: targets.length
      })
    }

    // Unearth (702.84): from your graveyard, sorcery speed, for its unearth cost.
    for (const oid of zone(s, 'graveyard', pid)) {
      const o = s.objects[oid]
      const un = o.behavior?.unearth
      if (un && sorcerySpeed && this._canPay(pid, parseManaCost(un.cost)))
        actions.push({ type: 'unearth', oid, label: `Unearth ${o.printed.name}` })
    }

    // Flashback: cast a spell from your graveyard for its flashback cost.
    for (const oid of zone(s, 'graveyard', pid)) {
      const o = s.objects[oid]
      const fb = o.behavior?.flashback
      if (!fb) continue
      const instantSpeed = o.printed.types.includes('Instant')
      if (!(instantSpeed || sorcerySpeed)) continue
      // Flashback cost may be mana, a sacrifice (e.g. Lava Dart), tapping creatures
      // (Prismatic Strands, Battle Screech), or a mix.
      if (fb.cost && !this._canPay(pid, parseManaCost(fb.cost))) continue
      if (fb.sacrifice && this._sacrificeCandidates(pid, fb.sacrifice).length < (fb.sacrifice.count || 1))
        continue
      if (fb.tapCreatures && this._tapCandidates(pid, fb.tapCreatures).length < (fb.tapCreatures.count || 1)) continue
      const targets = this._spellTargets(o)
      const fctx = { byPid: pid, sourceColors: tags(o.printed) }
      if (targets.length && !targets.every((t) => this._legalTargetsExist(t, fctx))) continue
      actions.push({ type: 'castFlashback', oid, targets, needsTargets: targets.length })
    }

    // Manual mana: tap a mana source for one of its colors (605). Auto-payment
    // taps sources too, so this is only needed to float mana deliberately (e.g.
    // to choose which land pays, or to pool mana before a sacrifice outlet).
    for (const o of objectsIn(s, 'battlefield')) {
      if (o.controller !== pid || o.status.tapped) continue
      if (o.printed.types.includes('Creature') && !this._canTap(o)) continue
      this._manaOptionsOf(o).forEach((m, option) => {
        for (const color of m.colors)
          actions.push({
            type: 'tapForMana',
            oid: o.oid,
            color,
            option,
            mana: true,
            label: `Tap for ${Array(m.amount).fill(`{${color}}`).join('')}${m.only ? ' (restricted)' : ''}`
          })
      })
    }

    // Activated abilities of permanents this player controls (instant speed).
    for (const oid of zone(s, 'battlefield')) {
      const o = s.objects[oid]
      if (o.controller !== pid) continue
      // Turn a face-down permanent face up (702.37e) — a special action, any time
      // you have priority, by paying its morph cost.
      if (o.faceDown && o.behavior?.morph && this._canPay(pid, parseManaCost(o.behavior.morph.cost)))
        actions.push({ type: 'turnFaceUp', oid, label: 'Turn face up' })
      if (o.chars?.lostAbilities) continue // "loses all abilities" (613.1f)
      // Crew N (702.122): tap creatures with total power N or more.
      const crew = o.behavior?.crew
      if (crew != null && !o.chars.types.includes('Creature') && this._crewCandidates(pid, crew).length)
        actions.push({ type: 'crew', oid, label: `Crew ${crew}` })
      ;(o.behavior?.activated || []).forEach((ab, i) => {
        if (ab.manaAbility && ab.cost?.tap) return // {T} mana abilities: see tapForMana above
        if (!this._canActivate(pid, o, ab)) return
        if (ab.manaAbility) {
          // A non-tap mana ability (Eldrazi Spawn's sacrifice): offered as an
          // explicit action so it's never spent automatically; resolves at once.
          actions.push({ type: 'activate', oid, ability: i, targets: [], needsTargets: 0, mana: true, label: ab.label || 'Mana ability' })
          return
        }
        const targets = ab.targets || []
        const sac = ab.cost?.sacrifice
        // X in an activation cost ({X}{R}{G}, {T}: …): the largest X payable now.
        const acost = ab.cost?.mana ? parseManaCost(ab.cost.mana) : null
        const xCost = acost?.X || 0
        actions.push({
          type: 'activate',
          oid,
          ability: i,
          label: ab.label || this._describeAbility(ab),
          targets,
          needsTargets: targets.length,
          loyalty: ab.loyalty, // present for planeswalker loyalty abilities
          sacChoose: sac && sac !== 'self' ? sac : null, // { types } to pick a sacrifice
          hasX: xCost > 0,
          maxX:
            xCost > 0
              ? Math.max(
                  0,
                  Math.floor(
                    (this._manaAvailable(pid) - (ab.cost?.tap && manaAbilityColors(o).length ? 1 : 0) - manaValue({ ...acost, X: 0 })) / xCost
                  )
                )
              : 0
        })
      })
    }
    // Split second (702.61): while such a spell is on the stack, only passing and
    // mana abilities are allowed.
    if (zone(s, 'stack').some((oid) => s.objects[oid]?.printed?.keywords?.includes('Split second')))
      return actions.filter((a) => a.type === 'pass' || a.mana)
    return actions
  }

  // The land-play / cast actions one face (`v` = { face, printed, behavior }) of a
  // hand card offers right now. For single-faced cards `v.face` is null.
  _handCastActions(pid, o, v, actions, sorcerySpeed, reasons = {}) {
    const s = this.state
    const { face, printed: p, behavior: b } = v
    const oid = o.oid
    const before = actions.length
    const why = (r) => {
      if (actions.length === before && !reasons[oid]) reasons[oid] = r
    }
    const withFace = (a) => (face == null ? a : { ...a, face })
    if (p.types.includes('Land')) {
      if (sorcerySpeed && s.players[pid].landsPlayed < this._landsAllowed(pid))
        actions.push(withFace({ type: 'playLand', oid, label: face == null ? undefined : `Play ${p.name}` }))
      else why(!sorcerySpeed ? 'lands only in your main phase with an empty stack' : 'no land plays left this turn')
      return
    }
    // Instants and cards with flash can be cast any time you have priority.
    const instantSpeed = p.types.includes('Instant') || p.keywords.includes('Flash')
    // "As though" permission (rule 118 / 601.3e): Vedalken Orrery lets you cast
    // any spell as though it had flash — i.e. any time you have priority.
    const canCastNow = instantSpeed || sorcerySpeed || this._hasPermission(pid, 'castAnySpeed')
    if (!canCastNow) return why('sorcery timing: only in your main phase with an empty stack')
    if (!this._castAllowed(pid, p)) return why("a static effect says you can't cast this now")
    const targets = this._spellTargets(o, b)
    // Untargetability context: this spell's caster + its colors, so hexproof/
    // shroud/protection exclude illegal would-be targets from the gate.
    const ctx = { byPid: pid, sourceColors: tags(p) }
    // A modal spell (rule 700.2) picks `count` of its modes on cast. It's
    // castable when at least `count` modes have a legal (or no) target.
    const modal = b.spell?.modal
    const modes = b.spell?.modes
    const modeCastable = (m) => !m.targets?.length || m.targets.every((t) => this._legalTargetsExist(t, ctx))
    const modalOk = !modal || modes.filter(modeCastable).length >= (modal.count || 1)
    // A targeted spell needs a legal target to be cast (rule 601.2c). This
    // also gates counters (need a spell on the stack) and Auras (a creature).
    const targetsOk = modalOk && (!targets.length || targets.every((t) => this._legalTargetsExist(t, ctx)))
    const addl = b.spell?.additionalCost
    const addlSacOk = !addl?.sacrifice || this._sacrificeCandidates(pid, addl.sacrifice).length > 0
    // A discard additional cost (Grab the Prize) needs that many *other* cards
    // in hand to pay — you can't discard the spell you're casting.
    const addlDiscOk = !addl?.discard || zone(s, 'hand', pid).filter((h) => h !== oid).length >= addl.discard
    if (!targetsOk) return why('no legal target')
    if (!(addlSacOk && addlDiscOk)) return why("can't pay the additional cost")
    const xCost = p.manaCost.X || 0
    // A variadic spell ("N damage divided among one or two targets", "up to
    // N target…") has a single slot carrying min/max (and maybe divide).
    const variadic = targets.length === 1 && targets[0].max != null ? targets[0] : null
    // Delve / convoke (702.66 / 702.51): graveyard cards / untapped creatures
    // that can help pay.
    const extra = this._extraSources(pid, p)
    const base = this._effectiveCost(pid, o, p)
    const paysFor = (cost) => {
      const pl = this._planPayment(cost, [...extra, ...this._manaSources(pid, p)], s.players[pid].manaPool, s.players[pid].life, this._usableRestricted(pid, p))
      return pl ? pl.tap.map((t) => this._objName(s.objects[t])) : []
    }
    const castAction = (kicked) => ({
      type: 'cast',
      oid,
      pays: paysFor(kicked ? addCosts(base, parseManaCost(b.kicker.cost)) : base), // auto-tap preview
      hybrid: base.hybrid?.length ? base.hybrid : null, // [[colours]] per hybrid pip — the caster may pick
      twobrid: base.twobrid?.length ? base.twobrid : null,
      label: (face == null ? p.name : `Cast ${p.name}`) + (kicked ? ' (kicked)' : ''),
      targets,
      needsTargets: variadic ? variadic.min ?? 1 : targets.length,
      variadic,
      sacChoose: addl?.sacrifice || null,
      discChoose: addl?.discard || null,
      hasX: xCost > 0,
      maxX: xCost > 0 ? this._maxX(pid, o, xCost, p, extra.length) : 0,
      kicker: kicked || undefined,
      // Modal: the renderer picks `count` modes, then targets for each.
      modal: modal || null,
      modes: modal ? modes.map((m, i) => ({ index: i, label: m.label, targets: m.targets || [], castable: modeCastable(m) })) : null
    })
    if (this._canPay(pid, base, extra, null, p)) actions.push(withFace(castAction(false)))
    // Kicker (702.33): the same spell with its optional additional cost paid.
    const kicker = b.kicker
    if (kicker && this._canPay(pid, addCosts(base, parseManaCost(kicker.cost)), extra, null, p)) actions.push(withFace(castAction(true)))
    // Evoke (702.74): an alternative cost; the creature is sacrificed as it enters.
    if (b.evoke && p.types.includes('Creature') && this._canPay(pid, parseManaCost(b.evoke.cost), extra))
      actions.push(withFace({ ...castAction(false), evoke: true, label: `${p.name} (evoke)`, hasX: false, maxX: 0 }))
    // Buyback (702.27): the same spell with its buyback cost paid (returns to hand).
    if (b.buyback && this._canPay(pid, addCosts(base, parseManaCost(b.buyback.cost)), extra))
      actions.push(withFace({ ...castAction(false), buyback: true, label: `${p.name} (buyback)` }))
    why('not enough mana')
    // Mutate (702.140): cast for its mutate cost targeting a non-Human creature you own.
    if (b.mutate && p.types.includes('Creature')) {
      const mspec = [{ type: 'creature', nonHuman: true, owner: 'you' }]
      if (mspec.every((t) => this._legalTargetsExist(t, ctx)) && this._canPay(pid, parseManaCost(b.mutate.cost), extra, null, p))
        actions.push(withFace({ ...castAction(false), mutate: true, targets: mspec, needsTargets: 1, variadic: null, hasX: false, maxX: 0, label: `${p.name} (mutate)` }))
    }
    // Overload (702.96): an alternative cost that turns "target" into "each".
    if (b.overload && b.spell?.overloadEffect && this._canPay(pid, parseManaCost(b.overload.cost), extra))
      actions.push(withFace({ ...castAction(false), overload: true, targets: [], needsTargets: 0, variadic: null, label: `${p.name} (overload)` }))
    // Alternative cost (e.g. Fireblast: sacrifice two Mountains instead of mana;
    // Ramosian Rally: tap an untapped creature if you control a Plains).
    const alt = b.spell?.alternativeCost
    const altOk =
      alt &&
      (!alt.if || this._cond(alt.if, { controller: pid, oid })) &&
      (!alt.sacrifice || this._sacrificeCandidates(pid, alt.sacrifice).length >= (alt.sacrifice.count || 1)) &&
      (!alt.tapCreatures || this._tapCandidates(pid, alt.tapCreatures).length >= (alt.tapCreatures.count || 1))
    if (altOk && targetsOk) {
      actions.push(
        withFace({
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
      )
    }
  }

  // A human-readable label for an activated ability without an authored one:
  // its cost, then a summary of its effects.
  _describeAbility(ab) {
    const c = ab.cost || {}
    const cost = []
    if (ab.loyalty != null) cost.push(ab.loyalty > 0 ? `+${ab.loyalty}` : String(ab.loyalty))
    if (c.mana) cost.push(c.mana)
    if (c.tap) cost.push('{T}')
    if (c.untap) cost.push('{Q}')
    if (c.payLife != null) cost.push(`Pay ${c.payLife} life`)
    if (c.energy) cost.push('{E}'.repeat(c.energy))
    if (c.sacrifice === 'self') cost.push('Sacrifice this')
    else if (c.sacrifice) cost.push(`Sacrifice a ${(c.sacrifice.types || [c.sacrifice.type || c.sacrifice.subtype || 'permanent']).join('/').toLowerCase()}`)
    if (c.removeCounters) cost.push(`Remove ${c.removeCounters.amount || 1} ${c.removeCounters.counter} counter`)
    const EFFECT = {
      dealDamage: (e) => `deal ${typeof e.amount === 'number' ? e.amount : 'X'} damage`,
      draw: (e) => `draw ${e.amount || 1}`,
      gainLife: (e) => `gain ${typeof e.amount === 'number' ? e.amount : 'X'} life`,
      loseLife: (e) => `lose ${e.amount} life`,
      destroy: () => 'destroy',
      bounce: () => 'return to hand',
      pump: (e) => `${e.power >= 0 ? '+' : ''}${e.power}/${e.toughness >= 0 ? '+' : ''}${e.toughness}`,
      grantKeyword: (e) => `gains ${e.keyword}`,
      addCounter: (e) => `${e.amount || 1} ${e.counter || '+1/+1'} counter`,
      createToken: (e) => `create ${e.count || 1} ${e.token?.name || 'token'}`,
      regenerate: () => 'regenerate',
      tap: () => 'tap',
      untapLands: (e) => `untap ${e.amount} lands`,
      scry: (e) => `scry ${e.amount}`,
      surveil: (e) => `surveil ${e.amount}`,
      mill: (e) => `mill ${e.amount || 1}`,
      transform: () => 'transform',
      addMana: (e) => `add {${e.mana}}`,
      attach: () => 'equip',
      counter: () => 'counter',
      returnFromGraveyard: () => 'return from graveyard',
      search: () => 'search your library',
      exileGraveyard: () => 'exile a graveyard',
      createEmblem: () => 'get an emblem',
      preventNextDamage: (e) => `prevent the next ${e.amount ?? 1} damage`
    }
    const fx = (ab.effect || []).map((e) => (EFFECT[e.op] ? EFFECT[e.op](e) : e.op)).join(', ')
    return `${cost.join(', ') || 'Activate'}: ${fx || '…'}`
  }

  // Untapped creatures that could crew a vehicle with crew `n` — smallest first —
  // or [] if their total power falls short. Returns the creatures to tap.
  _crewCandidates(pid, n) {
    const cands = objectsIn(this.state, 'battlefield')
      .filter((o) => o.controller === pid && o.chars.types.includes('Creature') && !o.status.tapped)
      .sort((a, b) => (a.chars.power || 0) - (b.chars.power || 0))
    const total = cands.reduce((s, o) => s + (o.chars.power || 0), 0)
    if (total < n) return []
    // Tap the smallest creatures that get there (keeping big attackers free).
    const picked = []
    let sum = 0
    for (const o of cands) {
      if (sum >= n) break
      picked.push(o)
      sum += o.chars.power || 0
    }
    return picked
  }

  // Non-mana ways to pay for a spell: delve exiles cards from your graveyard for
  // generic; convoke taps your untapped creatures for generic or their colour.
  // Returned in the order auto-payment prefers them (before real mana).
  _extraSources(pid, printed) {
    const s = this.state
    const out = []
    const kws = printed.keywords || []
    if (kws.includes('Delve')) for (const oid of zone(s, 'graveyard', pid)) out.push({ oid, colors: [], kind: 'delve' })
    if (kws.includes('Convoke'))
      for (const o of objectsIn(s, 'battlefield'))
        if (o.controller === pid && o.chars.types.includes('Creature') && !o.status.tapped)
          out.push({ oid: o.oid, colors: [...(o.chars.colors || [])], kind: 'convoke' })
    return out
  }

  // Maximum hand size (402.2 / 514.1): seven, modified by statics, or unlimited
  // ("You have no maximum hand size", Reliquary Tower).
  _maxHandSize(pid) {
    let n = 7
    for (const { source, mod } of this._ruleMods()) {
      if (source.controller !== pid) continue
      if (mod.noMaxHandSize) return Infinity
      if (mod.handSizeMod) n += mod.handSizeMod
    }
    return Math.max(0, n)
  }

  // How many lands `pid` may play this turn: one, plus any "additional land"
  // permissions (305.2 / Exploration).
  _landsAllowed(pid) {
    let n = 1
    for (const { source, mod } of this._ruleMods()) if (mod.extraLands && source.controller === pid) n += mod.extraLands
    return n
  }

  _spellTargets(o, behavior = o.behavior) {
    if (behavior.spell?.targets) return behavior.spell.targets
    // An Aura targets the permanent it will be attached to as it is cast.
    if (behavior.enchant) return [{ type: behavior.enchant.type }]
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

  // Validate a variadic target choice ("N damage divided among one or two targets",
  // "up to N target…") and record its division on the object. Throws on an illegal
  // count or division so it's rejected before any cost is paid.
  _applyVariadic(o, action) {
    const specs = o.behavior?.spell?.targets || []
    if (specs.length !== 1 || specs[0].max == null) return // not a variadic spell
    const spec = specs[0]
    const refs = action.targets || []
    const min = spec.min ?? 1
    if (refs.length < min || refs.length > spec.max)
      throw new Error(`choose ${min === spec.max ? min : `${min}–${spec.max}`} target(s)`)
    if (spec.divide != null) {
      const div = action.division || this._evenDivision(spec.divide, refs.length)
      if (div.length !== refs.length || div.some((d) => !(d >= 1)) || div.reduce((a, b) => a + b, 0) !== spec.divide)
        throw new Error(`divide exactly ${spec.divide}, at least 1 to each target`)
      o.division = div
    }
  }

  // Spread `total` across `n` targets as evenly as possible (remainder to the
  // earlier targets) — the UI's default division when the player doesn't specify.
  _evenDivision(total, n) {
    if (n <= 0) return []
    const base = Math.floor(total / n)
    let rem = total - base * n
    return Array.from({ length: n }, () => base + (rem-- > 0 ? 1 : 0))
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
      // Casting one half of a split card / a face of a modal DFC: the object takes
      // on that face's characteristics for the cast (709.3a / 712.11b).
      if (action.face != null && actor.faces) setFace(actor, action.face)
      const chosen = [...(action.targets || []), ...(action.modeTargets || []).flat()]
      const colors = tags(action.type === 'activate' ? actor.chars || actor.printed : actor.printed)
      this._assertTargetsLegal(chosen, pid, colors)
      // Validate a variadic ("divided" / "up to N") target count + division, and
      // record the division — before any cost is paid.
      if (action.type === 'cast' && !actor.behavior?.spell?.modal) this._applyVariadic(actor, action)
    }
    switch (action.type) {
      case 'playLand': {
        this._log(`${this._nameOf(pid)} plays ${this._objName(s.objects[action.oid])}`)
        moveObject(s, action.oid, 'battlefield')
        this._enterBattlefield(s.objects[action.oid], pid)
        s.players[pid].landsPlayed++
        break
      }
      case 'crew': {
        const o = s.objects[action.oid]
        const crew = this._crewCandidates(pid, o.behavior.crew)
        for (const c of crew) this._setTapped(c, true)
        this._log(`${this._nameOf(pid)} crews ${this._objName(o)} with ${crew.map((c) => this._objName(c)).join(', ')}`)
        const aoid = createAbility(s, { controller: pid, sourceOid: o.oid, effect: [{ op: 'becomeCreature', to: 'self' }], targets: [] })
        zone(s, 'stack').push(aoid.oid)
        break
      }
      case 'unearth': {
        const o = s.objects[action.oid]
        this._pay(pid, parseManaCost(o.behavior.unearth.cost))
        this._log(`${this._nameOf(pid)} unearths ${this._objName(o)}`)
        const aoid = createAbility(s, { controller: pid, sourceOid: o.oid, effect: [{ op: 'unearthReturn' }], targets: [] })
        zone(s, 'stack').push(aoid.oid)
        break
      }
      case 'suspend': {
        const o = s.objects[action.oid]
        const sus = o.behavior.suspend
        this._pay(pid, parseManaCost(sus.cost))
        this._log(`${this._nameOf(pid)} suspends ${this._objName(o)} with ${sus.count} time counter${sus.count > 1 ? 's' : ''}`)
        moveObject(s, action.oid, 'exile')
        o.suspended = true
        o.status.counters.time = sus.count
        break
      }
      case 'cycle': {
        // Cycling (702.29): an activated ability from hand — pay, discard the card
        // as the cost, and the "draw a card" ability goes on the stack.
        const o = s.objects[action.oid]
        const cyc = o.behavior.cycling
        if (cyc.life) {
          s.players[pid].life -= cyc.life
          this._log(`${this._nameOf(pid)} pays ${cyc.life} life`)
        }
        if (cyc.cost) this._pay(pid, parseManaCost(cyc.cost))
        this._log(`${this._nameOf(pid)} cycles ${this._objName(o)}`)
        this._discardCard(pid, action.oid)
        const aoid = createAbility(s, { controller: pid, sourceOid: o.oid, effect: [{ op: 'draw', amount: 1 }], targets: [] })
        zone(s, 'stack').push(aoid.oid)
        break
      }
      case 'tapForMana': {
        // A {T} mana ability (605.3): no stack; the mana goes straight into the
        // pool, where _pay spends it before tapping anything else.
        const o = s.objects[action.oid]
        const opts = this._manaOptionsOf(o)
        const m = opts[action.option ?? 0] || opts[0]
        const color = m.colors.length === 1 ? m.colors[0] : action.color
        if (!m || !m.colors.includes(color)) throw new Error('choose a color this permanent can produce')
        this._setTapped(o, true)
        for (let i = 0; i < (m.amount || 1); i++) {
          if (m.only) (s.players[pid].restrictedPool ||= []).push({ color, only: m.only, source: o })
          else s.players[pid].manaPool[color]++
        }
        break
      }
      case 'cast': {
        const o = s.objects[action.oid]
        let sneakTarget = null
        if (action.altCost) {
          // Pay the alternative cost (e.g. Fireblast) instead of mana — auto-pick
          // the required sacrifices / creatures to tap.
          o.xValue = 0
          const alt = o.behavior.spell.alternativeCost
          if (alt.sacrifice)
            for (const so of this._sacrificeCandidates(pid, alt.sacrifice).slice(0, alt.sacrifice.count || 1)) this._sacrifice(so)
          if (alt.tapCreatures) this._payTapCreatures(pid, alt.tapCreatures)
        } else if (action.sneak || action.webSlinging) {
          // Sneak / web-slinging: the alternative mana cost plus returning a creature.
          o.xValue = 0
          const kw = action.sneak ? o.behavior.sneak : o.behavior.webSlinging
          this._pay(pid, parseManaCost(kw.cost))
          const returned = s.objects[action.returned]
          if (action.sneak) {
            sneakTarget = returned.status.attackingTarget
            s.combat.attackers = s.combat.attackers.filter((oid) => oid !== returned.oid)
          }
          this._log(`${this._nameOf(pid)} returns ${this._objName(returned)} to hand`)
          moveObject(s, returned.oid, 'hand')
        } else {
          const xCost = o.printed.manaCost.X || 0
          o.xValue = xCost ? action.x || 0 : 0
          // Evoke (702.74) / overload (702.96) replace the mana cost entirely.
          let cost = action.evoke
            ? parseManaCost(o.behavior.evoke.cost)
            : action.overload
              ? parseManaCost(o.behavior.overload.cost)
              : action.mutate
                ? parseManaCost(o.behavior.mutate.cost)
                : this._effectiveCost(pid, o)
          // Kicker (702.33) / buyback (702.27): optional additional costs.
          if (action.kicker) cost = addCosts(cost, parseManaCost(o.behavior.kicker.cost))
          if (action.buyback) cost = addCosts(cost, parseManaCost(o.behavior.buyback.cost))
          this._pay(pid, { ...cost, generic: (cost.generic || 0) + o.xValue * xCost }, this._extraSources(pid, o.printed), null, o.printed, {
            hybrid: action.hybrid,
            twobrid: action.twobrid
          })
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
        const fromCommand = o.zoneName === 'command'
        const fromHand = o.zoneName === 'hand'
        moveObject(s, action.oid, 'stack') // clears transient status/controller
        o.controller = pid
        o.kicked = !!action.kicker && !action.altCost // after the move (400.7 reset)
        o.evoked = !!action.evoke
        o.buyback = !!action.buyback
        o.castFromHand = fromHand
        o.mutateCast = !!action.mutate
        if (action.sneak) o.sneaked = { target: sneakTarget } // enters tapped and attacking
        if (fromCommand) o.commanderCasts = (o.commanderCasts || 0) + 1
        if (o.behavior.spell?.modal) {
          this._applyModalCast(o, action)
        } else if (action.overload) {
          o.targets = []
          o.spell = { ...o.behavior.spell, targets: [], effect: o.behavior.spell.overloadEffect }
        } else {
          o.targets = action.targets || []
          o.spell = o.behavior.spell
        }
        this._log(`${this._nameOf(pid)} casts ${this._objName(o)}${this._describeTargets(o.targets)}`)
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
      case 'castFaceDown': {
        // Morph (702.37): cast the card face down as a 2/2 for {3}. It's a permanent
        // (creature) spell with no revealed characteristics; it enters face down.
        const o = s.objects[action.oid]
        this._pay(pid, parseManaCost('{3}'))
        o.xValue = 0
        moveObject(s, action.oid, 'stack')
        o.controller = pid
        o.faceDown = true
        o.spell = null // resolves as a permanent
        this._log(`${this._nameOf(pid)} casts a spell face down`)
        this._countSpellCast(o) // it's still a spell cast (storm counts it)
        break
      }
      case 'turnFaceUp': {
        // Special action (702.37e): pay the morph cost to reveal the card.
        const o = s.objects[action.oid]
        this._pay(pid, parseManaCost(o.behavior.morph.cost))
        o.faceDown = false
        this._log(`${this._nameOf(pid)} turns ${this._objName(o)} face up`)
        recompute(s)
        this._fireTriggers('turnedFaceUp', o)
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
        moveObject(s, action.oid, 'stack')
        o.bestowCast = true // after the move: a zone change clears cast flags (400.7)
        o.controller = pid
        o.targets = action.targets || []
        this._log(`${this._nameOf(pid)} bestows ${this._objName(o)}${this._describeTargets(o.targets)}`)
        this._countSpellCast(o)
        this._fireTriggers('castSpell', o)
        this._checkWard(o.oid, o.controller, o.targets)
        break
      }
      case 'castDisturb': {
        // Disturb (702.148): from the graveyard, transformed, for the disturb cost.
        // The back face carries its own "exile instead of the graveyard" clause.
        const o = s.objects[action.oid]
        this._pay(pid, parseManaCost(o.behavior.disturb.cost))
        moveObject(s, action.oid, 'stack')
        setFace(o, 1)
        o.controller = pid
        o.targets = []
        o.spell = null // a permanent spell
        this._log(`${this._nameOf(pid)} casts ${this._objName(o)} with disturb`)
        this._countSpellCast(o)
        this._fireTriggers('castSpell', o)
        break
      }
      case 'castPrepared': {
        // A copy of the permanent's spell half is cast (no card moves); the
        // permanent is unprepared. The copy ceases to exist as it resolves.
        const o = s.objects[action.oid]
        const pr = o.behavior.prepared
        this._pay(pid, parseManaCost(pr.cost))
        o.prepared = false
        const copy = createObject(s, { name: pr.name, type_line: (pr.types || ['Sorcery']).join(' '), colors: o.printed.colors }, pid)
        copy.cardId = o.cardId
        copy.controller = pid
        copy.targets = action.targets || []
        copy.spell = pr.spell
        copy.isCopy = true
        copy.zoneName = 'stack'
        zone(s, 'stack').push(copy.oid)
        this._log(`${this._nameOf(pid)} casts ${pr.name} (${this._objName(o)} is no longer prepared)${this._describeTargets(copy.targets)}`)
        this._countSpellCast(copy)
        this._fireTriggers('castSpell', copy)
        this._checkWard(copy.oid, pid, copy.targets)
        break
      }
      case 'castFlashback': {
        const o = s.objects[action.oid]
        const fb = o.behavior.flashback
        if (fb.cost) this._pay(pid, parseManaCost(fb.cost))
        if (fb.tapCreatures) this._payTapCreatures(pid, fb.tapCreatures)
        if (fb.sacrifice)
          for (const so of this._sacrificeCandidates(pid, fb.sacrifice).slice(0, fb.sacrifice.count || 1))
            this._sacrifice(so)
        moveObject(s, action.oid, 'stack')
        o.controller = pid
        o.targets = action.targets || []
        o.spell = o.behavior.spell
        o.flashbackCast = true // exiled instead of the graveyard when it leaves
        this._log(`${this._nameOf(pid)} flashbacks ${this._objName(o)}${this._describeTargets(o.targets)}`)
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
        this._log(`${this._nameOf(pid)} casts ${o.behavior.omen.name || this._objName(o)}${this._describeTargets(o.targets)}`)
        this._countSpellCast(o)
        this._fireTriggers('castSpell', o)
        this._checkWard(o.oid, o.controller, o.targets)
        break
      }
      case 'activate': {
        const o = s.objects[action.oid]
        const ab = o.behavior.activated[action.ability]
        this._payActivationCost(pid, o, ab, action)
        if (ab.manaAbility) {
          // Mana abilities don't use the stack (605.3b): resolve immediately.
          this._runEffects({ controller: pid, sourceOid: o.oid, targets: [] }, ab.effect)
          break
        }
        this._log(`${this._nameOf(pid)} activates ${this._objName(o)}${this._describeTargets(action.targets)}`)
        // The ability exists on the stack independently of its source.
        const aoid = createAbility(s, {
          controller: pid,
          sourceOid: o.oid,
          effect: ab.effect,
          targets: action.targets || [],
          xValue: action._xValue || 0 // X chosen for an {X} activation cost
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
        this._log(`${this._nameOf(pid)} plots ${this._objName(o)}`)
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
        this._log(`${this._nameOf(pid)} casts plotted ${this._objName(o)}${this._describeTargets(o.targets)}`)
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
        this._log(`${this._nameOf(pid)} ninjutsus ${this._objName(ninja)} in for ${this._objName(returned)}`)
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
    // "Activated abilities of sources with the chosen name can't be activated
    // unless they're mana abilities" (Pithing Needle).
    if (!ab.manaAbility && this._ruleMods().some(({ source, mod }) => mod.cantActivate?.chosenName && this._nameMatches(o, source.chosen))) return false
    // The ability's source (the permanent `o`) supplies the colors for protection;
    // its controller is `pid`, so hexproof only blocks it against opponents.
    const actx = { byPid: pid, sourceColors: tags(o.chars || o.printed) }
    if (ab.targets?.length && !ab.targets.every((t) => this._legalTargetsExist(t, actx))) return false
    const cost = ab.cost || {}
    if (cost.tap) {
      if (o.status.tapped) return false
      if (o.printed.types.includes('Creature') && !this._canTap(o)) return false
    }
    // {Q} (untap symbol, 107.6): the permanent must be tapped, and a creature
    // must not be summoning sick (302.6).
    if (cost.untap) {
      if (!o.status.tapped) return false
      if (o.printed.types.includes('Creature') && !this._canTap(o)) return false
    }
    // A {T} cost means the permanent can't also tap for mana toward this cost.
    if (cost.mana && !this._canPay(pid, { ...parseManaCost(cost.mana), X: 0 }, [], cost.tap ? o.oid : null)) return false
    if (cost.payLife != null && this.state.players[pid].life <= cost.payLife) return false
    if (cost.energy && (this.state.players[pid].counters.energy || 0) < cost.energy) return false
    if (cost.removeCounters && (o.status.counters[cost.removeCounters.counter] || 0) < (cost.removeCounters.amount || 1)) return false
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
    if (spec.subtype && !hasSub(o.chars, spec.subtype)) return false
    return true
  }

  _payActivationCost(pid, o, ab, action = {}) {
    const s = this.state
    if (ab.oncePerTurn) (o.status.abilityUsed ||= []).push(ab)
    if (ab.loyalty != null) {
      if (ab.loyalty > 0) this._putCounters(o, 'loyalty', ab.loyalty) // may be doubled (Doubling Season)
      else o.status.counters.loyalty = (o.status.counters.loyalty || 0) + ab.loyalty
      o.status.loyaltyUsed = true
    }
    const cost = ab.cost || {}
    if (cost.mana) {
      const mc = parseManaCost(cost.mana)
      const x = mc.X ? action.x || 0 : 0
      this._pay(pid, { ...mc, X: 0, generic: (mc.generic || 0) + x * (mc.X || 0) }, [], cost.tap ? o.oid : null)
      action._xValue = x
    }
    if (cost.tap) this._setTapped(o, true)
    if (cost.untap) this._setTapped(o, false)
    if (cost.payLife != null) s.players[pid].life -= cost.payLife
    if (cost.energy) s.players[pid].counters.energy -= cost.energy
    if (cost.removeCounters) {
      const { counter, amount = 1 } = cost.removeCounters
      o.status.counters[counter] -= amount
      if (o.status.counters[counter] <= 0) delete o.status.counters[counter]
    }
    if (cost.sacrifice === 'self') this._sacrifice(o)
    else if (cost.sacrifice && action.sacrifice) {
      const so = s.objects[action.sacrifice]
      if (so && so.controller === pid && so.zoneName === 'battlefield') this._sacrifice(so)
    }
  }

  _resolveTop() {
    const s = this.state
    recompute(s) // legality checks below read current characteristics
    const stack = zone(s, 'stack')
    const oid = stack[stack.length - 1]
    const o = s.objects[oid]

    if (o.kind === 'ability') {
      this._resolveObject = { oid, kind: 'ability' }
      // Countered by game rules if every target is now illegal (608.2b).
      if (this._fizzles(o)) {
        this._log(`${this._objName(o)} fizzles (no legal targets)`)
        return void this._finishResolution()
      }
      // Intervening "if" (603.4): if the condition is no longer true, it does nothing.
      if (o.condition && !this._cond(o.condition, s.objects[o.sourceOid])) {
        this._log(`${this._objName(o)} does nothing (its condition is no longer true)`)
        return void this._finishResolution()
      }
      this._log(`${this._objName(o)} resolves`)
      this._runResolution(o, o.effect)
      return
    }

    if (o.spell) {
      this._resolveObject = { oid, kind: 'spell' }
      if (this._fizzles(o)) {
        this._log(`${this._objName(o)} fizzles (no legal targets)`)
        return void this._finishResolution()
      }
      this._log(`${this._objName(o)} resolves`)
      this._runResolution(o, o.spell.effect)
    } else if (isPermanent(o.printed)) {
      // Mutate (702.140b): onto/under its target if that's still legal, else it
      // simply enters as a creature.
      if (o.mutateCast) {
        const t = o.targets?.[0]
        if (t && this._targetStillLegal(o.controller, tags(o.printed), t)) {
          if (this._autoOrder) {
            this._merge(o, s.objects[t.oid], true)
            return
          }
          s.pending = { kind: 'mutateOrder', player: o.controller, oid, target: t.oid, name: this._objName(o), targetName: this._objName(s.objects[t.oid]) }
          return
        }
        o.targets = []
      }
      // A permanent spell with targets (an Aura, a Bestow spell) whose targets are
      // all illegal on resolution: an Aura is countered by the rules and goes to
      // the graveyard (608.3b); a Bestow spell resolves as a creature instead
      // (702.103e).
      if (o.targets?.length && this._fizzles(o)) {
        if (o.bestowCast) {
          this._log(`${this._objName(o)} loses its target and resolves as a creature`)
          o.bestowCast = false
          o.targets = []
        } else {
          this._log(`${this._objName(o)} fizzles (no legal targets)`)
          moveObject(s, oid, 'graveyard')
          return
        }
      }
      this._log(`${this._objName(o)} enters the battlefield`)
      // "Enter as a copy of…" (rule 614.12): before the permanent is on the
      // battlefield, let its controller pick a permanent to copy. Pausing here
      // means it never briefly exists as its printed 0/0 (no SBA flicker).
      const cp = o.behavior?.copyOnEnter
      const choices = cp ? this._copyChoices(o, cp) : []
      if (cp && choices.length) {
        s.pending = { kind: 'copyEnter', oid, player: o.controller ?? o.owner, choices, optional: true }
        return
      }
      // A Siege chooses an opponent to protect it as it enters (310.11a) — a real
      // choice with several opponents (auto: the next in seat order).
      if (o.printed.defense != null && o.protectorChoice == null && !this._autoOrder && this._opponentsOf(o.controller ?? o.owner).length > 1) {
        const ctrl = o.controller ?? o.owner
        s.pending = { kind: 'chooseProtector', oid, player: ctrl, choices: this._opponentsOf(ctrl).map((pid) => ({ pid, name: this._nameOf(pid) })) }
        return
      }
      // "As this enters, choose a [value]" (rule 614.12b): a remembered value that
      // the permanent's own abilities read (Adaptive Automaton's chosen type).
      const ch = o.behavior?.chooseOnEnter
      if (ch?.kind === 'cardName' && o.chosen == null) {
        // "As this enters, choose a card name" (Pithing Needle, Meddling Mage).
        this._askCardName(o.controller ?? o.owner, o, { nonland: !!ch.nonland, enter: true, label: ch.label })
        return
      }
      if (ch && o.chosen == null) {
        s.pending = {
          kind: 'chooseValue',
          oid,
          player: o.controller ?? o.owner,
          kindOfChoice: ch.kind,
          options: this._chooseOptions(ch),
          label: ch.label || 'Choose a creature type'
        }
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
    o.origPrinted ||= o.printed // restored when it leaves the battlefield (400.7)
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

  // Put a copy of a spell already on the stack (707.10). The copy shares the
  // original's characteristics, targets, and any division; it's marked isCopy so it
  // ceases to exist when it leaves the stack instead of going to a graveyard.
  _copyStackSpell(orig, controller) {
    const s = this.state
    const copy = createObject(s, { name: orig.printed.name }, controller)
    copy.printed = orig.printed
    copy.behavior = orig.behavior
    copy.spell = orig.spell
    copy.chars = orig.chars
    copy.cardId = orig.cardId
    copy.targets = (orig.targets || []).map((t) => ({ ...t }))
    if (orig.division) copy.division = [...orig.division]
    copy.isCopy = true
    copy.chosenModes = orig.chosenModes
    copy.zoneName = 'stack'
    zone(s, 'stack').push(copy.oid)
    return copy
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

  // The options for an "as this enters, choose…" decision. For a creature type,
  // a common list plus every subtype already present in the game.
  _chooseOptions(ch) {
    if (ch.options) return [...ch.options]
    if (ch.kind === 'color') return ['W', 'U', 'B', 'R', 'G']
    const common = ['Goblin', 'Elf', 'Human', 'Zombie', 'Faerie', 'Soldier', 'Wizard', 'Warrior', 'Beast', 'Dragon', 'Angel', 'Vampire', 'Skeleton', 'Knight', 'Cleric']
    const present = new Set(common)
    for (const o of objectsIn(this.state, 'battlefield')) for (const st of o.chars?.subtypes || []) present.add(st)
    return [...present]
  }

  _applyChooseProtector(pending, answer) {
    const s = this.state
    const o = s.objects[pending.oid]
    const pick = pending.choices.find((c) => c.pid === answer?.pid)
    if (!pick) throw new Error('choose an opponent to protect the Siege')
    o.protectorChoice = pick.pid
    moveObject(s, pending.oid, 'battlefield')
    this._enterBattlefield(o, o.controller ?? o.owner)
    if (!this._resume) this._grantPriorityTo(s.activePlayer)
  }

  _applyChooseValue(pending, answer) {
    const s = this.state
    if (pending._holder) {
      // A value chosen mid-resolution (Prismatic Strands' colour).
      pending._holder.chosen = pending.options.includes(answer?.value) ? answer.value : pending.options[0]
      this._log(`${this._nameOf(pending.player)} chooses ${pending._holder.chosen}`)
      this._resumeResolution()
      return
    }
    const o = s.objects[pending.oid]
    o.chosen = pending.options.includes(answer?.value) ? answer.value : pending.options[0]
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
    if (s.endTurnNow) {
      // The spell that ended the turn is already exiled with the rest of the stack.
      s.endTurnNow = false
      s.prio = null
      this._resume = null
      this._enterStep('cleanup')
      return
    }
    if (!ctx) return
    const o = s.objects[ctx.oid]
    if (ctx.kind === 'ability' || o?.isCopy) {
      // Abilities and copies of spells (707.10a) cease to exist on leaving the stack.
      const st = zone(s, 'stack')
      const i = st.indexOf(ctx.oid)
      if (i >= 0) st.splice(i, 1)
      delete s.objects[ctx.oid]
    } else if (o?.zoneName === 'stack') {
      // The spell may already have been removed (e.g. countered). An Omen half is
      // shuffled into its owner's library; flashback/madness spells are exiled.
      // Buyback (702.27) returns it to hand; rebound (702.88) exiles it and casts
      // it again free at the next upkeep.
      if (o.buyback) {
        this._log(`${this._objName(o)} returns to hand (buyback)`)
        moveObject(s, ctx.oid, 'hand')
      } else if (o.castFromHand && o.printed?.keywords?.includes('Rebound')) {
        this._log(`${this._objName(o)} is exiled (rebound)`)
        moveObject(s, ctx.oid, 'exile')
        s.delayedTriggers.push({ event: 'upkeep', yourTurn: true, controller: o.owner, sourceOid: o.oid, effect: [{ op: 'castFree', oid: o.oid }] })
      } else if (o.omenCast) {
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

  _afterDrawStep() {
    this._firePhaseTriggers('drawStep')
    this._grantPriority()
  }

  // Dredge (702.52): graveyard cards whose dredge number the library can cover.
  _dredgeChoices(pid) {
    const s = this.state
    const lib = zone(s, 'library', pid).length
    return zone(s, 'graveyard', pid)
      .map((oid) => s.objects[oid])
      .filter((o) => o.behavior?.dredge && lib >= o.behavior.dredge)
      .map((o) => ({ oid: o.oid, name: o.printed.name, n: o.behavior.dredge }))
  }

  // Draw `n` cards one at a time, offering a dredge replacement before each when
  // one is available. Returns true if all draws happened synchronously (and
  // `after` ran); false if a `dredge` decision is pending and `after` will run
  // once the series completes.
  _drawSeries(pid, n, after) {
    const s = this.state
    while (n > 0) {
      const choices = this._dredgeChoices(pid)
      if (choices.length) {
        s.pending = { kind: 'dredge', player: pid, choices, _remaining: n, _after: after }
        return false
      }
      this.draw(pid, 1)
      n--
    }
    after()
    return true
  }

  _applyDredge(pending, answer) {
    const s = this.state
    const pid = pending.player
    const pick = pending.choices.find((c) => c.oid === answer?.oid)
    if (pick) {
      const lib = zone(s, 'library', pid)
      const milled = lib.slice(0, pick.n)
      for (const oid of milled) this._relocate(s.objects[oid], 'graveyard')
      moveObject(s, pick.oid, 'hand')
      this._log(`${this._nameOf(pid)} dredges ${pick.name} (mills ${pick.n})`)
    } else this.draw(pid, 1)
    this._drawSeries(pid, pending._remaining - 1, pending._after)
  }

  // Saga (714): add a lore counter and trigger the matching chapter.
  _addLore(o) {
    const saga = o.behavior.saga
    const before = o.status.counters.lore || 0
    this._putCounters(o, 'lore', 1) // may be more than one (Doubling Season)
    const n = o.status.counters.lore || 0
    // 714.2c: every chapter whose number is now reached (and wasn't before) triggers.
    for (let k = before + 1; k <= n; k++) {
      const chapter = saga.chapters[k - 1]
      if (!chapter) break
      this._log(`${this._objName(o)} — chapter ${['I', 'II', 'III', 'IV', 'V'][k - 1] || k}`)
      this.state.pendingTriggers.push({
        controller: o.controller,
        sourceOid: o.oid,
        subjectOid: o.oid,
        effect: chapter.effect || chapter,
        targetSpec: chapter.targets || [],
        chapter: k
      })
    }
  }

  // Put counters on a permanent, through the replacement effects that modify
  // how many (Doubling Season doubles; Hardened Scales adds one +1/+1). Each
  // applies once (616.1); additions apply before doublings, which is the order
  // the affected permanent's controller would choose.
  _putCounters(o, kind, n) {
    if (!o || n <= 0) return
    let plus = 0
    let doublings = 0
    for (const { source, mod } of this._ruleMods()) {
      const cm = mod.counterMod
      if (!cm || source.controller !== o.controller) continue
      if (cm.counter && cm.counter !== kind) continue
      if (cm.creaturesOnly && !o.chars?.types?.includes('Creature')) continue
      if (cm.plus) plus += cm.plus
      if (cm.double) doublings++
    }
    const total = (n + plus) * 2 ** doublings
    o.status.counters[kind] = (o.status.counters[kind] || 0) + total
    if (total !== n && o.zoneName === 'battlefield') this._log(`${this._objName(o)} gets ${total} ${kind} counters instead of ${n}`)
  }

  // Create `n` tokens for a player, through "twice that many" replacements
  // (Parallel Lives, Doubling Season — each doubles again).
  _createTokens(def, controller, n = 1) {
    let doublings = 0
    for (const { source, mod } of this._ruleMods()) if (mod.tokenMod?.double && source.controller === controller) doublings++
    const total = n * 2 ** doublings
    if (total !== n) this._log(`${this._nameOf(controller)} creates ${total} tokens instead of ${n}`)
    for (let i = 0; i < total; i++) this._createToken(def, controller)
    return total
  }

  // Create one token from a token definition and put it onto the battlefield.
  // The renderer resolves art from Scryfall by the token's characteristics.
  _createToken(def, controller) {
    const s = this.state
    const types = def.types || ['Creature']
    const sf = {
      name: def.name,
      type_line: `Token ${[...(def.supertypes || []), ...types].join(' ')}${def.subtypes?.length ? ' — ' + def.subtypes.join(' ') : ''}`,
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
    // Prepared (Elite Interceptor): enters prepared.
    if (o.behavior?.prepared) o.prepared = true
    // Sneak: enters tapped and attacking the returned attacker's target.
    if (o.sneaked) {
      const c = this.state.combat
      o.status.tapped = true
      if (c) {
        o.status.attacking = true
        o.status.attackingTarget = o.sneaked.target
        c.attackers.push(o.oid)
      }
      o.sneaked = null
    }
    // "Enters tapped" — possibly "unless …" (Seachrome Coast: unless you control
    // two or fewer other lands).
    const et = o.behavior?.entersTapped
    if (et === true || (et && et.unless && !this._cond(et.unless, o))) o.status.tapped = true
    // Evoke (702.74b): sacrificed on entering (a triggered ability).
    if (o.evoked)
      this.state.pendingTriggers.push({ controller, sourceOid: o.oid, subjectOid: o.oid, effect: [{ op: 'sacrificeSelf' }], targetSpec: [] })
    // Echo (702.30): due at the controller's next upkeep.
    if (o.behavior?.echo) o.echoDue = true
    // Suspend (702.62c): a creature cast this way has haste for as long as it stays.
    if (o.suspendHaste) {
      o.suspendHaste = false
      this.state.continuous.push({ timestamp: ++this.state.tsCounter, targets: [o.oid], grantKeywords: ['Haste'], duration: 'permanent', owner: controller })
    }
    // Saga (714.2a): enters with a lore counter; chapter I triggers.
    if (o.behavior?.saga) this._addLore(o)
    // Replacement effect: "enters with N counters" (applied before SBAs, so a
    // 0/0 that enters with +1/+1 counters survives).
    const ew = o.behavior?.entersWith
    if (ew) this._putCounters(o, ew.counter, this._amount(o, ew.amount))
    // A planeswalker enters with loyalty counters equal to its printed loyalty.
    if (o.printed.loyalty != null) this._putCounters(o, 'loyalty', o.printed.loyalty)
    // A battle enters with defense counters (310.4); a Siege's protector is an
    // opponent of its controller (310.11a — the next one in seat order).
    if (o.printed.defense != null) {
      o.status.counters.defense = o.printed.defense
      o.protector = o.protectorChoice ?? this._opponentsOf(controller)[0] ?? null
      o.protectorChoice = null
    }
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
        // "You may pay {cost}. If you do, <effect>." (e.g. Nihil Spellbomb.) With
        // `elseEffect`: "…unless you pay" (echo: sacrifice).
        const pid = source.controller
        s.pending = {
          kind: 'mayPay',
          player: pid,
          cost: e.cost,
          canPay: this._canPay(pid, parseManaCost(e.cost)),
          _source: source,
          _effect: e.effect || [],
          _else: e.elseEffect || null
        }
        return true
      }
      case 'eachOpponentSacrifices':
      case 'targetPlayerSacrifices': {
        // Edict effects: the affected player(s) choose what to sacrifice.
        const queue =
          e.op === 'eachOpponentSacrifices'
            ? this._opponentsOf(source.controller)
            : [this._resolvePlayerRef(source, e.to || 'target0')]
        return this._nextSacrificeChoice(queue, e.filter || { types: ['Creature'] }, e.count || 1)
      }
      case 'draw': {
        // A draw an effect performs may be replaced by dredge (702.52).
        const pid = this._resolvePlayerRef(source, e.to || 'controller')
        const n = this._amount(source, e.amount ?? 1)
        if (!this._dredgeChoices(pid).length) {
          this.draw(pid, n)
          return false
        }
        return !this._drawSeries(pid, n, () => this._resumeResolution())
      }
      case 'proliferate': {
        // Proliferate (701.27): the controller chooses any number of permanents
        // and players with counters. Auto-resolved in tests (autoOrderTriggers).
        if (this._autoOrder) {
          this._runEffects(source, [{ op: 'proliferateAuto' }])
          return false
        }
        const me = source.controller
        const choices = []
        for (const o of objectsIn(s, 'battlefield'))
          if (Object.values(o.status.counters).some((v) => v > 0)) choices.push({ kind: 'object', oid: o.oid, name: this._objName(o), counters: { ...o.status.counters } })
        for (const p of s.players)
          if (!p.hasLost && Object.values(p.counters).some((v) => v > 0)) choices.push({ kind: 'player', pid: p.id, name: p.name, counters: { ...p.counters } })
        if (!choices.length) return false
        s.pending = { kind: 'proliferate', player: me, choices }
        return true
      }
      case 'revealHand': {
        // "Target player reveals their hand" / "Look at target player's hand": the
        // cards become known (logged); the looking player gets to see them.
        const pid = this._resolvePlayerRef(source, e.to || 'target0')
        const cards = [...zone(s, 'hand', pid)]
        this._log(`${this._nameOf(pid)} reveals their hand: ${cards.map((c) => this._objName(s.objects[c])).join(', ') || '(empty)'}`)
        if (this._autoOrder || source.controller === pid || !cards.length) return false
        s.pending = { kind: 'lookAtHand', player: source.controller, target: pid, cards }
        return true
      }
      case 'chooseFromHand': {
        // Duress / Thoughtseize: reveal, then the controller chooses a card matching
        // a filter and it is discarded (or exiled, per `then`).
        const pid = this._resolvePlayerRef(source, e.to || 'target0')
        const hand = [...zone(s, 'hand', pid)]
        this._log(`${this._nameOf(pid)} reveals their hand: ${hand.map((c) => this._objName(s.objects[c])).join(', ') || '(empty)'}`)
        const cards = hand.filter((oid) => this._matchCardFilter(s.objects[oid], e.filter))
        if (!cards.length) return false
        s.pending = { kind: 'chooseFromHand', player: source.controller, target: pid, cards, hand, then: e.then || 'discard', optional: !!e.optional }
        return true
      }
      case 'venture':
        // Venture into the dungeon (701.49) — pauses for a room/dungeon choice.
        return this._venture(this._resolvePlayerRef(source, e.to || 'controller'), e.dungeon || null)
      case 'chooseName':
        // "Choose a [nonland] card name" as a spell resolves (Cabal Therapy). The
        // name is remembered on the resolving spell/ability for later effects.
        this._askCardName(source.controller, source, { nonland: !!e.nonland, label: e.label })
        return true
      case 'revealTopChoose': {
        // "Reveal the top N cards of your library. Put a [filter] card from among
        // them onto the battlefield [with counters / gaining a keyword]. Then
        // shuffle." (Throne of the Dead Three). Everyone sees the revealed cards.
        const pid = source.controller
        const top = zone(s, 'library', pid).slice(0, e.amount || 1)
        this._log(`${this._nameOf(pid)} reveals ${top.map((c) => this._objName(s.objects[c])).join(', ') || 'nothing'}`)
        const matches = top.filter((oid) => this._matchCardFilter(s.objects[oid], e.filter))
        if (!matches.length) {
          s.zones[zoneKey('library', pid)] = s.rng.shuffle(s.zones[zoneKey('library', pid)])
          return false
        }
        s.pending = {
          kind: 'search',
          player: pid,
          cards: matches,
          to: e.to || 'battlefield',
          tapped: false,
          optional: false,
          shuffle: true,
          revealed: true, // public: other viewers may see the cards
          counters: e.counters || null,
          grant: e.grant ? { keyword: e.grant, duration: e.duration || 'untilYourNextTurn' } : null
        }
        return true
      }
      case 'drawRevealCastOne': {
        // "Draw N cards and reveal them. You may cast one of them without paying
        // its mana cost." (Mad Wizard's Lair.)
        const pid = source.controller
        const before = zone(s, 'hand', pid).length
        this.draw(pid, e.amount || 1)
        const drawn = zone(s, 'hand', pid).slice(before)
        if (!drawn.length) return false
        this._log(`${this._nameOf(pid)} reveals ${drawn.map((c) => this._objName(s.objects[c])).join(', ')}`)
        const castable = drawn.filter((oid) => !s.objects[oid].printed.types.includes('Land'))
        if (!castable.length) return false
        s.pending = { kind: 'chooseFromHand', player: pid, target: pid, cards: castable, hand: drawn, then: 'castFree', optional: true }
        return true
      }
      case 'eachPlayerDiscardsOrLosesLife':
        // "Each player loses N life unless they discard a card" (Veils of Fear), in
        // APNAP order; a player with an empty hand simply loses the life.
        return this._nextDiscardOrLoseLife(this._apnap(), e.life)
      case 'eachPlayerSacrificesOrLosesLife':
        // "…unless they sacrifice a creature, artifact, or land" (Sandfall Cell).
        return this._nextSacrificeChoice(this._apnap(), e.filter, 1, { elseLoseLife: e.life })
      case 'bounceChoose': {
        // "Return a permanent you control to its owner's hand" — chosen on resolution.
        const pid = this._resolvePlayerRef(source, e.to || 'controller')
        return this._nextSacrificeChoice([pid], e.filter || {}, 1, { action: 'bounce' })
      }
      case 'chooseColor':
        // "…of the color of your choice": remembered on the resolving spell.
        s.pending = { kind: 'chooseValue', player: source.controller, options: ['W', 'U', 'B', 'R', 'G'], label: e.label || 'Choose a color', _holder: source }
        return true
      case 'chainCopyOffer': {
        // Chain Lightning: the damaged player (or the damaged permanent's
        // controller) may pay the cost to copy the spell with a new target.
        const t = source.targets?.[0]
        const payer = t?.kind === 'player' ? t.pid : s.objects[t?.oid]?.controller
        if (payer == null || s.players[payer].hasLost) return false
        s.pending = { kind: 'mayPay', player: payer, cost: e.cost, canPay: this._canPay(payer, parseManaCost(e.cost)), name: `${this._objName(source)}: copy it?`, _source: source, _effect: [], _else: null, _chainCopy: true }
        return true
      }
      case 'changeTargets': {
        // 115.7 (Redirect): the controller may choose new targets for target spell.
        const t = this._resolveTargetRef(source, e.to || 'target0')
        const sp = t?.kind === 'object' ? t.obj : null
        if (!sp || sp.zoneName !== 'stack' || !sp.targets?.length || sp.behavior?.spell?.modal) return false
        const specs = this._spellTargets(sp)
        if (!specs.length) return false
        s.pending = {
          kind: 'chooseTargets',
          player: source.controller,
          sourceOid: sp.oid,
          name: `${this._objName(sp)} — new targets`,
          targets: specs,
          optional: true,
          _retarget: sp.oid
        }
        return true
      }
      case 'castFree': {
        // Cast a specific exiled card without paying its mana cost (rebound,
        // suspend). A declined card stays in exile.
        const c = s.objects[e.oid]
        if (!c || c.zoneName !== 'exile') return false
        s.pendingMadness.push({ pid: c.owner, oid: e.oid, cost: null, free: true, keep: true, haste: !!e.haste })
        this._processMadness(() => this._resumeResolution())
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
      case 'cascade': {
        // Cascade (702.85): exile from the top until a nonland card with lesser
        // mana value; offer to cast it free; the rest go to the bottom at random.
        const pid = source.controller
        const spell = s.objects[source.sourceOid]
        const mv = spell?.printed?.manaValue ?? 0
        const lib = zone(s, 'library', pid)
        const exiled = []
        let found = null
        while (lib.length) {
          const oid = lib[0]
          moveObject(s, oid, 'exile')
          const c = s.objects[oid]
          if (!c.printed.types.includes('Land') && c.printed.manaValue < mv) {
            found = oid
            break
          }
          exiled.push(oid)
        }
        this._log(`${this._nameOf(pid)} cascades${found ? ` into ${this._objName(s.objects[found])}` : ' into nothing'}`)
        const toBottom = () => {
          for (const oid of s.rng.shuffle(exiled)) if (s.objects[oid].zoneName === 'exile') moveObject(s, oid, 'library')
        }
        if (!found) {
          toBottom()
          return false
        }
        s.pendingMadness.push({ pid, oid: found, cost: null, free: true, after: toBottom })
        this._processMadness(() => this._resumeResolution())
        return true
      }
      case 'eachOpponentDiscards': {
        // Every opponent discards a card (multiplayer). Opponents with empty hands
        // resolve immediately (drawing for the controller if the card says so); the
        // rest are queued and prompted one at a time.
        const queue = []
        for (const opp of this._opponentsOf(source.controller)) {
          if (zone(s, 'hand', opp).length === 0) {
            if (e.drawIfEmpty) this.draw(source.controller, 1) // "for each who can't, draw"
          } else queue.push(opp)
        }
        if (queue.length === 0) return false
        const first = queue.shift()
        s.pending = {
          kind: 'discardCards',
          player: first,
          count: 1,
          hand: [...zone(s, 'hand', first)],
          _oppQueue: queue,
          _oppDrawIfEmpty: e.drawIfEmpty,
          _oppController: source.controller
        }
        return true
      }
      case 'returnFromGraveyard': {
        // Choose a matching card from any graveyard and return it to its owner's hand.
        const pid = source.controller
        const cards = []
        for (const p of s.players) {
          if (e.own && p.id !== pid) continue // "from your graveyard"
          for (const oid of zone(s, 'graveyard', p.id))
            if (this._matchCardFilter(s.objects[oid], e.filter)) cards.push(oid)
        }
        if (cards.length === 0) return false
        s.pending = { kind: 'search', player: pid, cards, to: e.to || 'hand', tapped: !!e.tapped, optional: e.optional === true, shuffle: false }
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
        if (t?.kind === 'object' && t.obj.zoneName === 'battlefield') this._putCounters(t.obj, '+1/+1', 1)
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
      // A conditional part of an effect ("if this spell was kicked, …").
      if (e.if && !this._cond(e.if, source.kind === 'ability' ? s.objects[source.sourceOid] : source)) continue
      // "If you discarded a nonland card this way, …" (connive, Grab the Prize).
      if (e.condition === 'discardedNonland' && !source._discardedNonland) continue
      switch (e.op) {
        case 'pumpEach': {
          // "Creatures you control get +N/+N [and gain …] until end of turn" — the
          // affected set is locked in as the effect is created (611.2c).
          const f = e.filter || { type: 'Creature', controller: 'you' }
          const targets = objectsIn(s, 'battlefield')
            .filter(
              (o) =>
                (f.controller !== 'you' || o.controller === source.controller) &&
                (f.controller !== 'opponent' || o.controller !== source.controller) &&
                (!f.type || o.chars.types.includes(f.type)) &&
                (!f.subtype || hasSub(o.chars, f.subtype)) &&
                (!f.color || (o.chars.colors || []).includes(f.color))
            )
            .map((o) => o.oid)
          s.continuous.push({
            timestamp: ++s.tsCounter,
            targets,
            modifyPT: e.power || e.toughness ? { power: this._amount(source, e.power) || 0, toughness: this._amount(source, e.toughness) || 0 } : undefined,
            grantKeywords: e.keywords ? [...e.keywords] : undefined,
            duration: e.duration || 'eot',
            owner: source.controller
          })
          break
        }
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
        case 'dealDamageDivided': {
          // Divided damage (601.2d): deal source.division[i] to each chosen target.
          // A target that has left the battlefield since selection is skipped.
          const div = source.division || []
          for (let i = 0; i < (source.targets?.length || 0); i++) {
            const amt = div[i] ?? 0
            if (amt <= 0) continue
            const t = this._resolveTargetRef(source, 'target' + i)
            if (t?.kind === 'player') this._dealDamage(source, { player: t.pid }, amt)
            else if (t?.kind === 'object' && t.obj?.zoneName === 'battlefield')
              this._dealDamage(source, { obj: t.obj }, amt)
          }
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
          if (tref) s.replacements.push({ event: 'damage', target: tref, remaining: n, duration: e.duration || 'eot', owner: source.controller })
          break
        }
        case 'dealDamageEach': {
          // Damage to each permanent matching a filter (e.g. every creature).
          for (const oid of [...zone(s, 'battlefield')]) {
            const t = s.objects[oid]
            if (!t) continue
            if (e.filter === 'creature' && !t.chars.types.includes('Creature')) continue
            if (e.excludeFlying && this._hasKW(t, 'Flying')) continue
            if (e.who === 'opponents' && t.controller === source.controller) continue // "you don't control"
            if (e.who === 'you' && t.controller !== source.controller) continue
            this._dealDamage(source, { obj: t }, this._amount(source, e.amount))
          }
          break
        }
        case 'dealDamageEachOpponent': {
          // Guttersnipe / Voldaren Epicure / Grab the Prize. A condition of
          // 'discardedNonland' gates on what was discarded earlier this resolution.
          if (e.condition === 'discardedNonland' && !source._discardedNonland) break
          const amt = this._amount(source, e.amount)
          for (const p of s.players)
            if (p.id !== source.controller && !p.hasLost) this._dealDamage(source, { player: p.id }, amt)
          break
        }
        case 'returnSelfTapped': {
          // Sneaky Snacker: return the source from its graveyard to the battlefield tapped.
          const o = s.objects[source.sourceOid]
          if (o && o.zoneName === 'graveyard') {
            moveObject(s, o.oid, 'battlefield')
            this._enterBattlefield(o, o.owner)
            this._setTapped(o, true)
          }
          break
        }
        case 'loseLife': {
          const pid = e.to ? this._resolvePlayerRef(source, e.to) : source.controller
          this._loseLife(pid, this._amount(source, e.amount))
          this._log(`${this._nameOf(pid)} loses ${this._amount(source, e.amount)} life (${s.players[pid].life})`)
          break
        }
        case 'eachOpponentLosesLife':
          for (const opp of this._opponentsOf(source.controller)) {
            this._loseLife(opp, e.amount)
            this._log(`${this._nameOf(opp)} loses ${e.amount} life (${s.players[opp].life})`)
          }
          break
        case 'addPlayerCounter': {
          // Counters on players: poison ('eachOpponent'), energy/experience ('controller').
          const kind = e.counter || 'energy'
          const n = this._amount(source, e.amount ?? 1)
          if (e.to === 'eachOpponent') for (const opp of this._opponentsOf(source.controller)) this._addPlayerCounter(opp, kind, n)
          else this._addPlayerCounter(this._resolvePlayerRef(source, e.to || 'controller'), kind, n)
          break
        }
        case 'proliferateAuto': {
          // Proliferate (701.27), resolved the way its controller always wants:
          // one more of each counter on every permanent they control that has
          // any, on themselves, and poison on each opponent who has poison.
          const me = source.controller
          for (const o of objectsIn(s, 'battlefield'))
            if (o.controller === me)
              for (const k of Object.keys(o.status.counters)) if (o.status.counters[k] > 0) this._putCounters(o, k, 1)
          for (const p of s.players) {
            if (p.hasLost) continue
            if (p.id === me) for (const k of Object.keys(p.counters)) if (p.counters[k] > 0 && k !== 'poison') p.counters[k]++
            if (p.id !== me && p.counters.poison > 0) p.counters.poison++
          }
          this._log(`${this._nameOf(me)} proliferates`)
          break
        }
        case 'mill': {
          // Mill (701.13b): the top N cards of a library go to its graveyard.
          const pid = this._resolvePlayerRef(source, e.to || 'controller')
          const n = this._amount(source, e.amount ?? 1)
          const lib = zone(s, 'library', pid)
          const milled = lib.slice(0, n)
          for (const oid of milled) this._relocate(s.objects[oid], 'graveyard')
          this._log(`${this._nameOf(pid)} mills ${milled.length} card${milled.length === 1 ? '' : 's'}`)
          break
        }
        case 'destroy': {
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield' && !this._hasKW(t.obj, 'Indestructible'))
            if (!this._tryRegenerate(t.obj)) this._bury(t.obj) // a regen shield replaces the destruction
          break
        }
        case 'regenerate': {
          // "Regenerate [creature]" sets up a replacement shield (615.4) for the
          // rest of the turn; the shield is consumed the next time it's destroyed.
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield')
            t.obj.status.regenShields = (t.obj.status.regenShields || 0) + 1
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
              this._setTapped(o, false)
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
              duration: e.duration || 'eot',
              owner: source.controller
            })
          break
        }
        case 'tapAll': {
          // Tap every permanent matching a filter (Cryptic Command: "tap all
          // creatures your opponents control").
          for (const o of objectsIn(s, 'battlefield')) {
            if (e.who === 'opponents' && o.controller === source.controller) continue
            if (e.filter?.type === 'creature' && !o.chars.types.includes('Creature')) continue
            this._setTapped(o, true)
          }
          break
        }
        case 'tap': {
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield') this._setTapped(t.obj, true)
          break
        }
        case 'tapOrUntap': {
          // "You may tap or untap target creature" (Rejoinder): your own creature
          // is untapped, anyone else's is tapped — the choice a player always makes.
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield') this._setTapped(t.obj, t.obj.controller !== source.controller)
          break
        }
        case 'addCounter': {
          // Put counters on a permanent (e.g. Writhing Chrysalis growing itself).
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield') this._putCounters(t.obj, e.counter || '+1/+1', e.amount || 1)
          break
        }
        case 'counter': {
          const t = this._resolveTargetRef(source, e.to)
          // Remove the target spell from the stack to its owner's graveyard.
          // Spellstutter Sprite: only if its mana value <= Faeries you control.
          if (t?.kind === 'object' && t.obj.zoneName === 'stack') {
            if (e.maxMv === 'faeries' && (t.obj.printed.manaValue || 0) > this._faerieCount(source.controller))
              break
            if (this._uncounterable(t.obj)) break // "This spell can't be countered."
            this._log(`${this._objName(t.obj)} is countered`)
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
              modifyPT: { power: this._amount(source, e.power) || 0, toughness: this._amount(source, e.toughness) || 0 },
              duration: e.duration || 'eot',
              owner: source.controller
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
              duration: e.duration || 'eot',
              owner: source.controller
            })
          break
        }
        case 'preventAllCombat':
          s.prevent.push({ type: 'allCombat', duration: e.duration || 'eot', owner: source.controller })
          break
        case 'preventColor':
          // Prismatic Strands: sources of the chosen colour deal no damage this turn.
          s.prevent.push({ type: 'color', color: e.color === 'chosen' ? source.chosen : e.color, duration: e.duration || 'eot', owner: source.controller })
          break
        case 'exileGraveyardEach':
          // "Exile any number of target players' graveyards" (a variadic player target).
          for (const t of source.targets || []) if (t?.kind === 'player') for (const oid of [...zone(s, 'graveyard', t.pid)]) moveObject(s, oid, 'exile')
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
              duration: dur,
              owner: source.controller
            })
            o.controller = source.controller
            o.status.summoningSick = true // not under your control since your turn began
            if (e.untap) this._setTapped(o, false)
            if (e.haste)
              s.continuous.push({ timestamp: ++s.tsCounter, grantKeywords: ['Haste'], targets: [o.oid], duration: dur, owner: source.controller })
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
          const n = e.count || 1
          this._log(`${this._nameOf(source.controller)} creates ${n} ${def.name} token${n > 1 ? 's' : ''}`)
          this._createTokens(def, source.controller, n)
          break
        }
        case 'becomeMonarch':
          this._becomeMonarch(e.pid ?? this._resolvePlayerRef(source, e.to || 'controller'))
          break
        case 'takeInitiative':
          this._takeInitiative(e.pid ?? this._resolvePlayerRef(source, e.to || 'controller'))
          break
        case 'goad': {
          // Goad (701.15): until the goader's next turn the creature attacks each
          // combat if able, and a player other than the goader if able.
          const t = this._resolveTargetRef(source, e.to || 'target0')
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield') {
            s.continuous.push({ timestamp: ++s.tsCounter, targets: [t.obj.oid], goad: source.controller, duration: 'untilYourNextTurn', owner: source.controller })
            this._log(`${this._objName(t.obj)} is goaded by ${this._nameOf(source.controller)}`)
          }
          break
        }
        case 'restrict': {
          // "Target creature can't attack/block until your next turn".
          const t = this._resolveTargetRef(source, e.to || 'target0')
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield')
            s.continuous.push({ timestamp: ++s.tsCounter, targets: [t.obj.oid], restrict: e.actions || ['attack'], duration: e.duration || 'untilYourNextTurn', owner: source.controller })
          break
        }
        case 'eachPlayerLosesLife':
          for (const p of s.players) {
            if (p.hasLost) continue
            this._loseLife(p.id, e.amount)
            this._log(`${p.name} loses ${e.amount} life (${p.life})`)
          }
          break
        case 'exileTop': {
          // Exile the top card(s) of your library (Mystic Forge).
          const pid = this._resolvePlayerRef(source, e.to || 'controller')
          for (const oid of zone(s, 'library', pid).slice(0, e.amount || 1)) {
            this._log(`${this._nameOf(pid)} exiles ${this._objName(s.objects[oid])} from the top of their library`)
            moveObject(s, oid, 'exile')
          }
          break
        }
        case 'exileTopPlayable': {
          // "Exile the top N cards of your library. You may play them [until the
          // end of your next turn]." (Runestone Caverns, Reckless Impulse) — face
          // up, playable from exile while the permission lasts.
          const pid = source.controller
          for (const oid of zone(s, 'library', pid).slice(0, e.amount || 1)) {
            const o = s.objects[oid]
            this._log(`${this._nameOf(pid)} exiles ${this._objName(o)} from the top of their library (may play it)`)
            moveObject(s, oid, 'exile')
            o.playableFromExile = pid // after the move (400.7 reset)
            if (e.until === 'endOfNextTurn') o.playableUntilTurn = this._nextOwnTurn(pid)
          }
          break
        }
        case 'discardNamed': {
          // Cabal Therapy: the player reveals their hand and discards every card
          // with the name chosen as the spell resolved.
          const pid = this._resolvePlayerRef(source, e.to || 'target0')
          const hand = [...zone(s, 'hand', pid)]
          this._log(`${this._nameOf(pid)} reveals their hand: ${hand.map((c) => this._objName(s.objects[c])).join(', ') || '(empty)'}`)
          const name = source.chosen
          const hits = hand.filter((oid) => this._nameMatches(s.objects[oid], name))
          for (const oid of hits) this._discardCard(pid, oid)
          this._log(hits.length ? `${this._nameOf(pid)} discards ${hits.length} card${hits.length > 1 ? 's' : ''} named ${name}` : `no card named ${name}`)
          break
        }
        case 'extraTurn': {
          // "Take an extra turn after this one" (rule 720). Queued; taken by its
          // controller before the turn would pass to the opponent.
          ;(s.extraTurns ||= []).push(source.controller)
          break
        }
        case 'additionalCombat': {
          // Relentless Assault: untap all creatures that attacked this turn, then
          // schedule an additional combat + main phase after the current main.
          for (const o of objectsIn(s, 'battlefield'))
            if (o.controller === source.controller && o.status.attackedThisTurn) this._setTapped(o, false)
          s.extraCombats = (s.extraCombats || 0) + 1
          break
        }
        case 'createTokenCopy': {
          // "Create a token that's a copy of [target permanent]" (rule 707.2 / 111.4).
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield') {
            for (let i = 0; i < (e.count || 1); i++) {
              const tok = createObject(s, { name: t.obj.printed.name }, source.controller)
              tok.token = true
              this._applyCopy(tok, t.obj) // copy its copiable characteristics
              tok.tokenDef = {
                name: tok.printed.name,
                types: tok.printed.types,
                subtypes: tok.printed.subtypes,
                colors: tok.printed.colors,
                power: tok.printed.power,
                toughness: tok.printed.toughness
              }
              tok.zoneName = 'battlefield'
              s.zones.battlefield.push(tok.oid)
              this._enterBattlefield(tok, source.controller)
            }
          }
          break
        }
        case 'copySpell': {
          // "Copy target instant or sorcery spell" (rule 707.10). The copy is put
          // on the stack with the same targets; it's not created by casting.
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && t.obj.zoneName === 'stack' && t.obj.spell)
            for (let i = 0; i < (e.count || 1); i++) this._copyStackSpell(t.obj, source.controller)
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
        case 'endTurn': {
          // "End the turn" (724): exile everything on the stack, remove creatures
          // from combat, and skip straight to the cleanup step; "until end of
          // turn" effects still end there.
          for (const oid of [...zone(s, 'stack')]) {
            const x = s.objects[oid]
            if (!x) continue
            if (x.kind === 'ability') {
              s.zones.stack = s.zones.stack.filter((y) => y !== oid)
              delete s.objects[oid]
            } else this._relocate(x, 'exile')
          }
          s.pendingTriggers = []
          s.combat = null
          for (const o of objectsIn(s, 'battlefield')) {
            o.status.attacking = false
            o.status.attackingTarget = null
            o.status.blocked = false
            o.status.blocking = null
          }
          this._log('The turn ends')
          s.endTurnNow = true
          break
        }
        case 'flipCoin': {
          // 705: a coin flip; `win` / `lose` effects run accordingly.
          const won = s.rng() < 0.5
          this._log(`${this._nameOf(source.controller)} flips a coin: ${won ? 'won' : 'lost'}`)
          this._runEffects(source, won ? e.win || [] : e.lose || [])
          break
        }
        case 'rollDie': {
          // 706: roll a die with `sides`; the first result whose [min,max] range
          // matches runs.
          const sides = e.sides || 6
          const r = s.rng.int(sides) + 1
          this._log(`${this._nameOf(source.controller)} rolls a d${sides}: ${r}`)
          const hit = (e.results || []).find((x) => r >= (x.min ?? 1) && r <= (x.max ?? sides))
          if (hit) this._runEffects(source, hit.effect || [])
          break
        }
        case 'becomeCreature': {
          // A crewed Vehicle is an artifact creature until end of turn (702.122).
          const t = this._resolveTargetRef(source, e.to || 'self')
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield')
            s.continuous.push({ timestamp: ++s.tsCounter, targets: [t.obj.oid], addTypes: ['Creature'], duration: e.duration || 'eot', owner: source.controller })
          break
        }
        case 'unearthReturn': {
          // Unearth (702.84): back to the battlefield; exiled at the next end step.
          const o = s.objects[source.sourceOid]
          if (o && o.zoneName === 'graveyard') {
            moveObject(s, o.oid, 'battlefield')
            o.unearthed = true
            this._enterBattlefield(o, source.controller)
            s.continuous.push({ timestamp: ++s.tsCounter, targets: [o.oid], grantKeywords: ['Haste'], duration: 'permanent', owner: source.controller })
            s.delayedTriggers.push({ event: 'endStep', controller: source.controller, effect: [{ op: 'exileIfUnearthed', oid: o.oid }] })
          }
          break
        }
        case 'exileIfUnearthed': {
          const o = s.objects[e.oid]
          if (o && o.zoneName === 'battlefield' && o.unearthed) this._relocate(o, 'exile')
          break
        }
        case 'fight': {
          // Fight (701.12): each deals damage equal to its power to the other —
          // only if both are still creatures on the battlefield.
          const a = this._resolveTargetRef(source, e.a || 'target0')
          const b = this._resolveTargetRef(source, e.b || 'target1')
          const ok = (t) => t?.kind === 'object' && t.obj.zoneName === 'battlefield' && t.obj.chars.types.includes('Creature')
          if (ok(a) && ok(b)) {
            this._log(`${this._objName(a.obj)} fights ${this._objName(b.obj)}`)
            this._dealDamage(a.obj, { obj: b.obj }, a.obj.chars.power || 0)
            this._dealDamage(b.obj, { obj: a.obj }, b.obj.chars.power || 0)
          }
          break
        }
        case 'returnSelfWithCounter': {
          // Undying / persist (702.93 / 702.79): back from the graveyard with a counter.
          const o = s.objects[source.sourceOid]
          if (o && o.zoneName === 'graveyard') {
            moveObject(s, o.oid, 'battlefield')
            this._enterBattlefield(o, o.owner)
            this._putCounters(o, e.counter, 1)
            this._log(`${this._objName(o)} returns to the battlefield with a ${e.counter} counter`)
          }
          break
        }
        case 'createEmblem': {
          // An emblem (114): an object in the command zone carrying static (and
          // triggered) abilities for its owner. It can't leave the game.
          const em = createObject(s, { name: e.name || 'Emblem', type_line: 'Emblem', colors: [] }, source.controller)
          em.kind = 'emblem'
          em.behavior = { ...em.behavior, static: e.static || [], triggered: e.triggered || [], staticRules: e.staticRules || [] }
          em.zoneName = 'command'
          em.timestamp = ++s.tsCounter
          s.zones.command.push(em.oid)
          this._log(`${this._nameOf(source.controller)} gets an emblem`)
          break
        }
        case 'transform': {
          // Transform (701.28): a double-faced permanent turns to its other face.
          const t = this._resolveTargetRef(source, e.to || 'self')
          const o = t?.kind === 'object' ? t.obj : null
          if (o && o.zoneName === 'battlefield' && o.faces && o.layout === 'transform') {
            setFace(o, o.face ? 0 : 1)
            recompute(s)
            this._log(`${this._objName(o)} transforms`)
            this._fireTriggers('transforms', o)
          }
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
    if (filter.maxMV != null && p.manaValue > filter.maxMV) return false
    if (filter.nonland && p.types.includes('Land')) return false
    if (filter.noncreature && p.types.includes('Creature')) return false
    return true
  }

  _applyMayPay(pending, answer) {
    if (answer?.pay && pending.canPay) {
      this._pay(pending.player, parseManaCost(pending.cost))
      if (pending._chainCopy) {
        // Copy the spell under the payer's control; they may choose a new target.
        const copy = this._copyStackSpell(pending._source, pending.player)
        const specs = this._spellTargets(pending._source)
        this._log(`${this._nameOf(pending.player)} copies ${this._objName(pending._source)}`)
        if (specs.length) {
          this.state.pending = { kind: 'chooseTargets', player: pending.player, sourceOid: copy.oid, name: `${this._objName(copy)} (copy) — new target`, targets: specs, optional: true, _retarget: copy.oid }
          return
        }
      } else this._runEffects(pending._source, pending._effect)
    } else if (pending._else) {
      this._runEffects(pending._source, pending._else) // "…unless you pay": the penalty
    }
    this._resumeResolution()
  }

  // A player chooses permanent(s) of theirs to sacrifice (an Edict effect).
  _applySacrificeChoice(pending, answer) {
    const s = this.state
    const picks = Array.isArray(answer?.sacrifice) ? answer.sacrifice : []
    const declined = pending.optional && picks.length === 0
    if (!declined && (picks.length !== pending.count || picks.some((oid) => !pending.choices.includes(oid)) || new Set(picks).size !== picks.length))
      throw new Error(`choose ${pending.count} permanent(s) to sacrifice`)
    for (const oid of picks) {
      const o = s.objects[oid]
      if (o?.zoneName !== 'battlefield') continue
      if (pending._opts?.action === 'bounce') {
        this._log(`${this._objName(o)} returns to its owner's hand`)
        this._relocate(o, 'hand')
      } else this._sacrifice(o)
    }
    if (declined && pending.elseLoseLife) {
      this._loseLife(pending.player, pending.elseLoseLife)
      this._log(`${this._nameOf(pending.player)} loses ${pending.elseLoseLife} life (${s.players[pending.player].life})`)
    }
    if (!this._nextSacrificeChoice(pending._queue, pending._filter, pending.count, pending._opts)) this._resumeResolution()
  }

  // Present the next player in `queue` who has something to sacrifice. Returns
  // true if a decision was set up. With `opts.elseLoseLife` the sacrifice is a
  // choice ("unless they sacrifice…"): declining, or having nothing to
  // sacrifice, costs that much life instead.
  _nextSacrificeChoice(queue, filter, count, opts = null) {
    const s = this.state
    while (queue?.length) {
      const pid = queue.shift()
      const choices = objectsIn(s, 'battlefield')
        .filter((o) => o.controller === pid && this._sacMatches(o, filter || {}))
        .map((o) => o.oid)
      if (!choices.length) {
        if (opts?.elseLoseLife) {
          this._loseLife(pid, opts.elseLoseLife)
          this._log(`${this._nameOf(pid)} loses ${opts.elseLoseLife} life (${s.players[pid].life})`)
        }
        continue
      }
      s.pending = {
        kind: 'sacrificeChoice',
        player: pid,
        choices,
        count: Math.min(count, choices.length),
        optional: !!opts?.elseLoseLife,
        elseLoseLife: opts?.elseLoseLife || 0,
        action: opts?.action || 'sacrifice', // what happens to the chosen permanent(s)
        _queue: queue,
        _filter: filter,
        _opts: opts
      }
      return true
    }
    return false
  }

  // Players in APNAP order (the active player first, then seat order), skipping
  // anyone who has left the game.
  _apnap() {
    const s = this.state
    const n = s.players.length
    return Array.from({ length: n }, (_, i) => (s.activePlayer + i) % n).filter((pid) => !s.players[pid].hasLost)
  }

  // "Each player loses N life unless they discard a card": the next player in
  // `queue` decides (an empty hand just loses the life). True if a decision was set up.
  _nextDiscardOrLoseLife(queue, life) {
    const s = this.state
    while (queue?.length) {
      const pid = queue.shift()
      const hand = zone(s, 'hand', pid)
      if (!hand.length) {
        this._loseLife(pid, life)
        this._log(`${this._nameOf(pid)} loses ${life} life (${s.players[pid].life})`)
        continue
      }
      s.pending = { kind: 'discardCards', player: pid, count: 1, hand: [...hand], optional: true, elseLoseLife: life, _lifeQueue: queue }
      return true
    }
    return false
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
      const o = s.objects[pick]
      if (pending.to === 'battlefield') {
        // From wherever it is (library search, graveyard return) onto the battlefield.
        moveObject(s, pick, 'battlefield')
        this._enterBattlefield(o, pid)
        if (pending.tapped) o.status.tapped = true
        for (const [k, n] of Object.entries(pending.counters || {})) this._putCounters(o, k, n)
        if (pending.grant)
          s.continuous.push({ timestamp: ++s.tsCounter, targets: [o.oid], grantKeywords: [pending.grant.keyword], duration: pending.grant.duration, owner: pid })
      } else {
        moveObject(s, pick, pending.to)
      }
      this._log(`${this._nameOf(pid)} puts ${pending.to === 'hand' ? 'a card' : this._objName(o)} ${pending.to === 'hand' ? 'into their hand' : 'onto the battlefield'}`)
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
    if (ref === 'activePlayer') return { kind: 'player', pid: this.state.activePlayer }
    if (ref === 'controller') return { kind: 'player', pid: source.controller }
    // 'attached' — the permanent the source (an Aura/Equipment) is attached to.
    if (ref === 'attached') {
      const src = this.state.objects[source.sourceOid]
      const obj = src && this.state.objects[src.status?.attachedTo]
      return obj ? { kind: 'object', obj } : null
    }
    if (!ref?.startsWith?.('target')) return null
    const idx = Number(ref.slice('target'.length))
    const t = source.targets?.[idx]
    if (!t) return null
    // 608.2b: a target that became illegal (left the battlefield, gained hexproof
    // in response, …) is not affected, even though the rest of the spell resolves.
    const src = source.kind === 'ability' ? this.state.objects[source.sourceOid] : source
    const colors = tags(source.kind === 'ability' ? src?.chars : source.printed)
    if (!this._targetStillLegal(source.controller, colors, t)) return null
    if (t.kind === 'player') return { kind: 'player', pid: t.pid }
    return { kind: 'object', obj: this.state.objects[t.oid] }
  }

  // ---- mana (rule 605 mana abilities resolve immediately) --------------

  // Untapped sources the player can tap for one mana each, with the colors each
  // can produce (dual/any lands produce more than one).
  // The colours a permanent can tap for. A permanent that has lost all its
  // abilities keeps only the intrinsic mana ability of its basic land types
  // (305.6 — a Blood Moon'd land still taps for {R}).
  _manaColorsOf(o) {
    if (!o.chars?.lostAbilities) return manaAbilityColors(o)
    return [...new Set((o.chars.subtypes || []).map((st) => BASIC_LAND_MANA[st]).filter(Boolean))]
  }

  // Every way a permanent can tap for mana: [{ colors, amount, only }]. Basic
  // land types and authored `mana` colours form one option; `manaOptions` adds
  // multi-mana or restricted ones (Sol Ring: {C}{C}; Eldrazi Temple: {C}{C} to be
  // spent only on colourless Eldrazi — rule 106.6).
  _manaOptionsOf(o) {
    const colors = this._manaColorsOf(o)
    const opts = colors.length ? [{ colors, amount: 1, only: null }] : []
    if (!o.chars?.lostAbilities) for (const m of o.behavior?.manaOptions || []) opts.push({ colors: [...m.colors], amount: m.amount || 1, only: m.only || null })
    return opts
  }

  // Untapped mana sources of `pid`, each reduced to the one option best suited to
  // paying for `printed` (a restricted option is used only if the spell qualifies).
  _manaSources(pid, printed = null) {
    const s = this.state
    const out = []
    for (const o of objectsIn(s, 'battlefield')) {
      if (o.controller !== pid || o.status.tapped) continue
      // creatures with a {T} mana ability need no summoning sickness (haste ok)
      if (o.printed.types.includes('Creature') && !this._canTap(o)) continue
      const usable = this._manaOptionsOf(o).filter((m) => !m.only || (printed && this._spellMatchesFilter(pid, printed, m.only, o)))
      if (!usable.length) continue
      const best = usable.reduce((a, b) => (b.amount > a.amount ? b : a))
      out.push({ oid: o.oid, colors: best.colors, amount: best.amount, only: best.only })
    }
    return out
  }

  // Plan how to pay `cost`: first from mana already floating in `pool` (colored
  // pips, then hybrid, then generic), then by tapping `sources` — colored pips
  // from the most-constrained matching source first, generic from whatever's
  // left. Returns { spend: {W..C}, tap: [oid] }, or null if unpayable.
  _planPayment(cost, sources, pool = null, life = null, restricted = [], picks = null) {
    const COLORS = ['W', 'U', 'B', 'R', 'G', 'C']
    // The caster may say how each hybrid / two-brid pip is paid (picks.hybrid[i] is a
    // colour; picks.twobrid[i] is a colour or '2'); chosen pips become plain pips.
    if (picks) {
      cost = { ...cost, hybrid: [...(cost.hybrid || [])], twobrid: [...(cost.twobrid || [])] }
      ;(picks.hybrid || []).forEach((c, i) => {
        if (cost.hybrid[i]?.includes(c)) {
          cost[c] = (cost[c] || 0) + 1
          cost.hybrid[i] = null
        }
      })
      cost.hybrid = cost.hybrid.filter(Boolean)
      ;(picks.twobrid || []).forEach((c, i) => {
        if (!cost.twobrid[i]) return
        if (c === '2') cost.generic = (cost.generic || 0) + 2
        else if (c === cost.twobrid[i]) cost[c] = (cost[c] || 0) + 1
        else return
        cost.twobrid[i] = null
      })
      cost.twobrid = cost.twobrid.filter(Boolean)
    }
    const spend = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    const spendR = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } // from restricted floating mana
    const have = { ...spend, ...(pool || {}) }
    // Restricted floating mana that may be spent on this cost counts too, and is
    // used before the unrestricted mana of the same colour.
    for (const r of restricted) have[r.color] = (have[r.color] || 0) + 1
    const haveR = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    for (const r of restricted) haveR[r.color]++
    const useHave = (c, k) => {
      const fromR = Math.min(k, haveR[c])
      haveR[c] -= fromR
      spendR[c] += fromR
      spend[c] += k - fromR
      have[c] -= k
    }
    const need = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    for (const c of COLORS) need[c] = cost[c] || 0
    let generic = cost.generic || 0
    let hybrid = [...(cost.hybrid || [])]
    for (const c of COLORS) {
      const k = Math.min(need[c], have[c])
      need[c] -= k
      useHave(c, k)
    }
    hybrid = hybrid.filter((options) => {
      const c = options.find((x) => have[x] > 0)
      if (!c) return true
      useHave(c, 1)
      return false
    })
    for (const c of COLORS) {
      const k = Math.min(generic, have[c])
      generic -= k
      useHave(c, k)
    }

    // A source producing several mana (Sol Ring) is several units sharing one oid.
    const avail = sources.flatMap((s) => Array.from({ length: s.amount || 1 }, () => ({ oid: s.oid, colors: s.colors })))
    const chosen = []
    for (const c of COLORS) {
      let n = need[c]
      while (n-- > 0) {
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
    const takeColor = (c) => {
      const cands = avail.filter((s) => s.colors.includes(c)).sort((a, b) => a.colors.length - b.colors.length)
      if (!cands.length) return false
      avail.splice(avail.indexOf(cands[0]), 1)
      chosen.push(cands[0].oid)
      return true
    }
    for (const options of hybrid) {
      const cands = avail
        .filter((s) => options.some((c) => s.colors.includes(c)))
        .sort((a, b) => a.colors.length - b.colors.length)
      if (!cands.length) return null
      const src = cands[0]
      avail.splice(avail.indexOf(src), 1)
      chosen.push(src.oid)
    }
    // Phyrexian pips (107.4f): the colour's mana if we have it, else 2 life —
    // which needs a life total of at least that much (119.4).
    let lifeCost = 0
    for (const c of cost.phyrexian || []) {
      if (have[c] > 0) useHave(c, 1)
      else if (!takeColor(c)) lifeCost += 2
    }
    if (lifeCost > 0 && (life == null || life < lifeCost)) return null
    // Two-brid pips (107.4e): the colour if available, else two generic.
    for (const c of cost.twobrid || []) {
      if (have[c] > 0) useHave(c, 1)
      else if (!takeColor(c)) generic += 2
    }
    if (avail.length < generic) return null
    for (let i = 0; i < generic; i++) chosen.push(avail[i].oid)
    return { spend, spendR, tap: [...new Set(chosen)], life: lifeCost }
  }

  // Restricted floating mana of `pid` that may be spent on `printed` (106.6).
  _usableRestricted(pid, printed) {
    const p = this.state.players[pid]
    return (p.restrictedPool || []).filter((r) => printed && this._spellMatchesFilter(pid, printed, r.only, r.source))
  }

  // Mana available to `pid` right now for `printed`: floating (incl. usable
  // restricted mana) + what untapped sources produce.
  _manaAvailable(pid, printed = null) {
    const pool = this.state.players[pid].manaPool
    return (
      this._manaSources(pid, printed).reduce((a, s) => a + (s.amount || 1), 0) +
      Object.values(pool).reduce((a, b) => a + b, 0) +
      this._usableRestricted(pid, printed).length
    )
  }

  // The mana cost to cast `o`, after cost reductions (affinity for artifacts).
  _effectiveCost(pid, o, printed = o.printed) {
    const cost = { ...printed.manaCost }
    const behavior = printed === o.printed ? o.behavior : loadBehavior(printed)
    if (behavior?.affinity === 'artifact') {
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
      if (mod.costMod && this._spellMatchesFilter(pid, printed, mod.costMod.spell, source))
        delta += mod.costMod.generic
    }
    if (delta) cost.generic = Math.max(0, (cost.generic || 0) + delta)
    // Commander tax (903.8): {2} more for each previous cast from the command zone.
    if (o.isCommander && o.zoneName === 'command') cost.generic = (cost.generic || 0) + 2 * (o.commanderCasts || 0)
    return cost
  }

  // ---- rule-modifying static effects (rule 613.11) --------------------
  // Permanents can carry `staticRules` that change what players may do rather
  // than any object's characteristics. Collected fresh each query so leaving the
  // battlefield removes the effect automatically.
  _ruleMods() {
    const out = []
    for (const src of [...objectsIn(this.state, 'battlefield'), ...this._emblems().map((oid) => this.state.objects[oid])]) {
      if (src.chars?.lostAbilities) continue
      for (const mod of src.behavior?.staticRules || []) {
        if (mod.if && !this._cond(mod.if, src)) continue // conditional ("as long as you're the monarch")
        out.push({ source: src, mod })
      }
    }
    return out
  }

  // Is the top card of a player's library visible — 'reveal' (to everyone:
  // "play with the top card of your library revealed"), 'look' (to its owner:
  // "you may look at the top card of your library any time"), or null?
  _topCardVisibility(pid) {
    let vis = null
    for (const { source, mod } of this._ruleMods()) {
      if (source.controller !== pid) continue
      if (mod.revealTop) return 'reveal'
      if (mod.lookAtTop) vis = 'look'
    }
    return vis
  }

  // Does a cost-modifier's spell filter match spell `o` cast by `pid`? `o` may be
  // a hand/graveyard card not yet on the stack, so match on printed characteristics.
  _spellMatchesFilter(pid, p, f, source) {
    if (!f) return true
    if (f.anyOf) return f.anyOf.some((g) => this._spellMatchesFilter(pid, p, g, source))
    // "Spells with the chosen name" (Meddling Mage).
    if (f.chosenName) return !!source.chosen && this._nameMatches({ printed: p }, source.chosen)
    if (f.controller === 'you' && pid !== source.controller) return false
    if (f.controller === 'opponent' && pid === source.controller) return false
    if (f.subtype && !hasSub(p, f.subtype)) return false
    if (f.type && !p.types.includes(f.type)) return false
    if (f.noncreature && p.types.includes('Creature')) return false
    if (f.colorless && (p.colors || []).length) return false
    return true
  }

  // Is creature `o` forbidden from attacking / blocking / untapping by an active
  // rule-modifier (Pacifism, Claustrophobia)? `action` is 'attack'|'block'|'untap'.
  _restricted(o, action) {
    for (const { source, mod } of this._ruleMods())
      if (mod.restrict?.includes(action) && matchStatic(mod.affects, source, o)) return true
    // One-shot "can't attack until your next turn" effects.
    for (const e of this.state.continuous) if (e.restrict?.includes(action) && e.targets?.includes(o.oid)) return true
    return false
  }

  // The players who have goaded `o` (701.15c), while the goad lasts.
  _goadedBy(o) {
    return this.state.continuous.filter((e) => e.goad != null && e.targets?.includes(o?.oid)).map((e) => e.goad)
  }

  // A spell can't be countered: its own text, or a static such as "creature
  // spells you control can't be countered".
  _uncounterable(o) {
    if (o.behavior?.uncounterable) return true
    return this._ruleMods().some(
      ({ source, mod }) => mod.spellsCantBeCountered && this._spellMatchesFilter(o.controller, o.printed, mod.spellsCantBeCountered, source)
    )
  }

  // May `pid` cast spell `printed` right now, as far as "can't cast" statics go
  // ("Your opponents can't cast spells during your turn", …)?
  _castAllowed(pid, printed) {
    const s = this.state
    for (const { source, mod } of this._ruleMods()) {
      const c = mod.cantCast
      if (!c) continue
      if (c.who === 'opponents' && pid === source.controller) continue
      if (c.who === 'you' && pid !== source.controller) continue
      if (c.duringYourTurn && s.activePlayer !== source.controller) continue
      if (c.spell && !this._spellMatchesFilter(pid, printed, c.spell, source)) continue
      return false
    }
    return true
  }

  // Does `pid` control a permanent that keeps them from losing (Platinum Angel)?
  _cantLose(pid) {
    return objectsIn(this.state, 'battlefield').some((o) => o.controller === pid && this._ability(o, 'cantLose'))
  }

  // Does `pid` control a permanent granting a named "as though" permission (rule
  // 118 / 609.4) — e.g. Vedalken Orrery's 'castAnySpeed'?
  _hasPermission(pid, key) {
    return objectsIn(this.state, 'battlefield').some(
      (o) => o.controller === pid && this._ability(o, 'permissions')?.includes(key)
    )
  }

  // Largest X affordable for an X spell given current mana (X is generic).
  _maxX(pid, o, xCost, printed = o.printed, extraSources = 0) {
    const base = this._effectiveCost(pid, o, printed)
    const sources = this._manaAvailable(pid, printed) + extraSources
    return Math.max(0, Math.floor((sources - manaValue(base)) / xCost))
  }

  // Resolve a numeric effect value that may be 'X' (the source's chosen X) or
  // 'sacrificedMV' (the mana value of a permanent sacrificed to cast the source).
  _amount(source, v) {
    if (v === 'X') return source?.xValue || 0
    if (v === 'sacrificedMV') return source?._sacrificedMV || 0
    // "for each …": a count of battlefield permanents matching a filter
    // (controlled by you unless `controller: 'any'`; `another` excludes the
    // source; `attacking` only creatures currently attacking).
    if (v && typeof v === 'object' && v.count === 'opponents') return this._opponentsOf(source.controller).length
    if (v && typeof v === 'object' && v.count) {
      const f = v.count
      const selfOid = source?.sourceOid ?? source?.oid
      const n = objectsIn(this.state, 'battlefield').filter(
        (o) =>
          (f.controller === 'any' || o.controller === source.controller) &&
          (!f.another || o.oid !== selfOid) &&
          (!f.attacking || o.status.attacking) &&
          (!f.type || o.chars.types.includes(f.type)) &&
          (!f.subtype || hasSub(o.chars, f.subtype))
      ).length
      return n * (v.times || 1) + (v.plus || 0) // "twice the number of creatures you control"
    }
    return v
  }

  // Untapped creatures `pid` controls that could be tapped to pay a cost
  // ("tap an untapped white creature you control"), least useful first.
  _tapCandidates(pid, spec) {
    return objectsIn(this.state, 'battlefield')
      .filter((o) => o.controller === pid && o.chars.types.includes('Creature') && !o.status.tapped && (!spec.color || (o.chars.colors || []).includes(spec.color)))
      .sort((a, b) => (b.status.summoningSick ? 1 : 0) - (a.status.summoningSick ? 1 : 0) || (a.chars.power || 0) - (b.chars.power || 0))
  }

  _payTapCreatures(pid, spec) {
    const picked = this._tapCandidates(pid, spec).slice(0, spec.count || 1)
    if (picked.length < (spec.count || 1)) throw new Error('not enough untapped creatures to tap')
    for (const o of picked) this._setTapped(o, true)
    this._log(`${this._nameOf(pid)} taps ${picked.map((o) => this._objName(o)).join(', ')} to pay a cost`)
  }

  // The turn number of `pid`'s next turn (for "until the end of your next turn").
  _nextOwnTurn(pid) {
    const s = this.state
    const n = s.players.length
    const dist = (pid - s.activePlayer + n) % n
    return s.turnNumber + (dist === 0 ? n : dist)
  }

  // Condition vocabulary for intervening-if triggers (603.4) and conditional
  // effects. `w` is the source permanent. Ranges are { min, max, eq }.
  _cond(cond, w) {
    if (!cond) return true
    const s = this.state
    const pid = w?.controller ?? 0
    const inRange = (v, r) => (r.min == null || v >= r.min) && (r.max == null || v <= r.max) && (r.eq == null || v === r.eq)
    if (cond.kicked != null) return !!w?.kicked === cond.kicked
    if (cond.controls) {
      const f = cond.controls
      const n = objectsIn(s, 'battlefield').filter(
        (o) =>
          o.controller === pid &&
          (!f.another || o.oid !== w?.oid) &&
          (!f.type || o.chars.types.includes(f.type)) &&
          (!f.subtype || hasSub(o.chars, f.subtype))
      ).length
      return inRange(n, f)
    }
    if (cond.life) return inRange(s.players[pid].life, cond.life)
    if (cond.opponentLife) return this._opponentsOf(pid).some((o) => inRange(s.players[o].life, cond.opponentLife))
    if (cond.handSize) return inRange(zone(s, 'hand', pid).length, cond.handSize)
    if (cond.graveyard) return inRange(zone(s, 'graveyard', pid).length, cond.graveyard)
    if (cond.spellsCastThisTurn) return inRange(s.spellsCastThisTurn || 0, cond.spellsCastThisTurn)
    if (cond.counters) return inRange(w?.status?.counters?.[cond.counters.counter] || 0, cond.counters)
    if (cond.untapped != null) return !w?.status?.tapped === cond.untapped // "when this enters untapped"
    // Designations (725/726) and dungeons (309): "as long as you're the monarch",
    // "if you have the initiative", "as long as you've completed a dungeon",
    // "unless defending player is the monarch" (some opponent is).
    if (cond.monarch != null) return (s.monarch === pid) === cond.monarch
    if (cond.initiative != null) return (s.initiative === pid) === cond.initiative
    if (cond.completedDungeon != null) return (s.players[pid].completedDungeons || 0) > 0 === cond.completedDungeon
    if (cond.opponentMonarch != null) return (s.monarch != null && s.monarch !== pid && !s.players[s.monarch].hasLost) === cond.opponentMonarch
    return true
  }

  // Number of artifacts a player controls (affinity / metalcraft).
  _artifactCount(pid) {
    return objectsIn(this.state, 'battlefield').filter(
      (o) => o.controller === pid && o.chars.types.includes('Artifact')
    ).length
  }

  // `extra`: delve/convoke sources; `exclude`: a source that can't help pay
  // (a permanent tapping itself as part of the same cost).
  _canPay(pid, cost, extra = [], exclude = null, printed = null) {
    const p = this.state.players[pid]
    const sources = this._manaSources(pid, printed).filter((x) => x.oid !== exclude)
    return this._planPayment(cost, [...extra, ...sources], p.manaPool, p.life, this._usableRestricted(pid, printed)) != null
  }

  _pay(pid, cost, extra = [], exclude = null, printed = null, picks = null) {
    const s = this.state
    const p = s.players[pid]
    const sources = this._manaSources(pid, printed).filter((x) => x.oid !== exclude)
    const usableR = this._usableRestricted(pid, printed)
    const plan = this._planPayment(cost, [...extra, ...sources], p.manaPool, p.life, usableR, picks)
    if (!plan) throw new Error('cannot pay cost')
    for (const c of Object.keys(plan.spend)) p.manaPool[c] -= plan.spend[c]
    for (const c of Object.keys(plan.spendR)) {
      let k = plan.spendR[c]
      p.restrictedPool = (p.restrictedPool || []).filter((r) => !(k > 0 && r.color === c && usableR.includes(r) && k-- > 0))
    }
    const kindOf = new Map(extra.map((x) => [x.oid, x.kind]))
    const tapped = []
    for (const oid of plan.tap) {
      const kind = kindOf.get(oid)
      if (kind === 'delve') {
        this._log(`${p.name} exiles ${this._objName(s.objects[oid])} from their graveyard (delve)`)
        moveObject(s, oid, 'exile')
      } else {
        this._setTapped(s.objects[oid], true) // mana sources and convoked creatures
        tapped.push(this._objName(s.objects[oid]))
      }
    }
    if (tapped.length) this._log(`${p.name} taps ${tapped.join(', ')}`)
    if (plan.life) {
      p.life -= plan.life
      this._log(`${p.name} pays ${plan.life} life (${p.life})`)
    }
  }

  _emptyManaPools() {
    for (const p of this.state.players) {
      p.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
      p.restrictedPool = []
    }
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
    s.combat.bands = {}
    for (const { oid, defender, band } of entries) {
      const o = s.objects[oid]
      o.status.band = band || null
      if (band) (s.combat.bands[band] ||= []).push(oid)
      o.status.attacking = true
      o.status.attackedThisTurn = true // for "untap all creatures that attacked"
      o.status.attackingTarget = defender || { player: def }
      if (!this._hasKW(o, 'Vigilance')) this._setTapped(o, true)
      this._fireTriggers('attacks', o)
    }
    s.combat.attackers = entries.map((e) => e.oid)
    if (entries.length === 0) {
      this._log(`${this._nameOf(s.activePlayer)} doesn't attack`)
      this._gotoStep('main2')
      return
    }
    // Exalted (702.83): a creature attacking alone gets +1/+1 for each instance
    // of exalted among permanents its controller controls.
    if (entries.length === 1)
      for (const w of objectsIn(s, 'battlefield'))
        if (w.controller === s.activePlayer && this._hasKW(w, 'Exalted'))
          s.pendingTriggers.push({
            controller: w.controller,
            sourceOid: w.oid,
            subjectOid: entries[0].oid,
            effect: [{ op: 'pump', to: 'target0', power: 1, toughness: 1 }],
            targetSpec: [],
            targets: [{ kind: 'object', oid: entries[0].oid }]
          })
    const who = entries.map(({ oid, defender }) => {
      const name = this._objName(s.objects[oid])
      if (defender?.planeswalker) return `${name} → ${this._objName(s.objects[defender.planeswalker])}`
      return s.players.length > 2 ? `${name} → ${this._nameOf(defender?.player ?? def)}` : name
    })
    this._log(`${this._nameOf(s.activePlayer)} attacks with ${who.join(', ')}`)
    this._grantPriority()
  }

  _defendingPlayer() {
    return this._otherPlayer(this.state.activePlayer)
  }

  // Legal things an attacker may be declared against: each opponent still in the
  // game and each planeswalker they control (multiplayer, rule 506.2).
  _attackDefenders() {
    const s = this.state
    const out = []
    for (const pid of this._opponentsOf(s.activePlayer)) {
      out.push({ kind: 'player', pid, name: s.players[pid].name })
      for (const o of objectsIn(s, 'battlefield')) {
        if (o.controller === pid && o.chars.types.includes('Planeswalker'))
          out.push({ kind: 'planeswalker', oid: o.oid, name: o.chars.name, loyalty: o.status.counters.loyalty })
        // A battle protected by that opponent (310.11c) — whoever controls it.
        if (o.chars.types.includes('Battle') && o.protector === pid)
          out.push({ kind: 'battle', oid: o.oid, name: o.chars.name, defense: o.status.counters.defense || 0 })
      }
    }
    return out
  }

  // The player defending against a given attacker (the attacked player, or the
  // controller of the attacked planeswalker).
  _defenderOfAttacker(a) {
    const t = a.status.attackingTarget
    if (t?.planeswalker) return this.state.objects[t.planeswalker]?.controller
    if (t?.battle) return this.state.objects[t.battle]?.protector
    return t?.player
  }

  // Distinct opponents currently being attacked — each declares its own blockers.
  _blockingPlayers() {
    const s = this.state
    const set = new Set()
    for (const oid of s.combat.attackers) set.add(this._defenderOfAttacker(s.objects[oid]))
    return [...set].filter((pid) => pid != null && !s.players[pid]?.hasLost)
  }

  // Present the next queued defender with the attackers aimed at them.
  _presentBlockers() {
    const s = this.state
    const def = s.combat.blockQueue.shift()
    const attackers = s.combat.attackers.filter((oid) => this._defenderOfAttacker(s.objects[oid]) === def)
    s.pending = { kind: 'declareBlockers', player: def, eligible: this._eligibleBlockers(def), attackers }
  }

  // Resolve an attacker's declared target into a _dealDamage target.
  _attackTargetOf(atk) {
    const t = atk.status.attackingTarget
    if (t?.battle && this.state.objects[t.battle]?.zoneName === 'battlefield') return { obj: this.state.objects[t.battle] }
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
          !this._restricted(o, 'block') && // Pacifism etc.
          !this._ability(o, 'cantBlock')
      )
      .map((o) => o.oid)
  }

  // An ability-derived property of a permanent, unless it has lost all its
  // abilities (613.1f / Dress Down).
  _ability(o, key) {
    return o?.chars?.lostAbilities ? undefined : o?.behavior?.[key]
  }

  // Does an attack/block *requirement* apply to `o` (508.1d / 509.1c) — its own
  // "attacks each combat if able", or a rule-modifying static ("Other Goblins
  // you control attack each combat if able")?
  _required(o, action) {
    if (action === 'attack' && this._ability(o, 'mustAttack')) return true
    if (action === 'attack' && this._goadedBy(o).length) return true // goaded (701.15b)
    if (action === 'block' && this._ability(o, 'mustBlock')) return true
    for (const { source, mod } of this._ruleMods())
      if (mod.require?.includes(action) && matchStatic(mod.affects, source, o)) return true
    return false
  }

  // Can `blocker` legally block `attacker` (509.1b)? The attacker's evasion
  // (flying, fear, intimidate, skulk, shadow, horsemanship, landwalk, "can't be
  // blocked", protection) and the blocker's own restrictions ("can't block").
  _canBlock(blocker, attacker) {
    const kw = (o, k) => this._hasKW(o, k)
    if (this._ability(blocker, 'cantBlock') || this._ability(attacker, 'cantBeBlocked')) return false
    if (kw(attacker, 'Unblockable')) return false // granted "can't be blocked this turn"
    if (kw(attacker, 'Flying') && !kw(blocker, 'Flying') && !kw(blocker, 'Reach')) return false
    const bColors = blocker.chars.colors || []
    const bArtifact = blocker.chars.types.includes('Artifact')
    if (kw(attacker, 'Fear') && !bArtifact && !bColors.includes('B')) return false
    if (kw(attacker, 'Intimidate') && !bArtifact && !bColors.some((c) => (attacker.chars.colors || []).includes(c))) return false
    if (kw(attacker, 'Skulk') && (blocker.chars.power ?? 0) > (attacker.chars.power ?? 0)) return false
    if (kw(attacker, 'Shadow') !== kw(blocker, 'Shadow')) return false
    if (kw(attacker, 'Horsemanship') && !kw(blocker, 'Horsemanship')) return false
    // Landwalk (702.14): unblockable while the defending player controls a land
    // of that type.
    for (const k of attacker.chars.keywords || []) {
      const m = /^(Plains|Island|Swamp|Mountain|Forest)walk$/.exec(k)
      if (
        m &&
        objectsIn(this.state, 'battlefield').some(
          (l) => l.controller === blocker.controller && l.chars.types.includes('Land') && l.chars.subtypes.includes(m[1])
        )
      )
        return false
    }
    const prot = attacker.chars.protections || []
    if (prot.includes('everything') || (prot.length && tags(blocker.chars).some((c) => prot.includes(c)))) return false
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
      if (!this._canBlock(b, a)) throw new Error(`illegal block: ${b.chars.name} can't block ${a.chars.name}`)
      ;(perAttacker[attackerOid] ||= []).push(blockerOid)
    }
    for (const atkOid of s.combat.attackers) {
      const n = perAttacker[atkOid]?.length || 0
      const atk = s.objects[atkOid]
      if (n === 1 && this._hasKW(atk, 'Menace'))
        throw new Error('illegal block: menace must be blocked by two or more creatures')
      const max = this._ability(atk, 'maxBlockers')
      if (max != null && n > max) throw new Error(`illegal block: ${atk.chars.name} can't be blocked by more than ${max} creature(s)`)
    }

    // Merge this defender's blocks into the combat (other defenders add theirs).
    const defender = this.state.pending?.player ?? this._defendingPlayer()
    const desc = Object.entries(blocks).map(
      ([b, a]) => `${this._objName(s.objects[b])} blocks ${this._objName(s.objects[a])}`
    )
    this._log(desc.length ? `${this._nameOf(defender)}: ${desc.join(', ')}` : `${this._nameOf(defender)} doesn't block`)
    Object.assign((s.combat.blocks ||= {}), blocks)
    s.combat.bandBlocks ||= {}
    for (const [blockerOid, attackerOid] of Object.entries(blocks)) {
      s.objects[blockerOid].status.blocking = attackerOid
      s.objects[attackerOid].status.blocked = true // stays blocked even if blockers leave
      // Banding (702.22c): blocking one member of a band blocks all of them.
      const band = s.objects[attackerOid].status.band
      if (band && s.combat.bands?.[band]) {
        s.combat.bandBlocks[blockerOid] = [...s.combat.bands[band]]
        for (const m of s.combat.bands[band]) s.objects[m].status.blocked = true
      }
    }
    // "Whenever this blocks" / "becomes blocked" (509.1h) — one per block, and
    // one per attacker that became blocked.
    for (const [blockerOid, attackerOid] of Object.entries(blocks))
      this._fireTriggers('blocks', s.objects[blockerOid], { other: s.objects[attackerOid] })
    for (const attackerOid of new Set(Object.values(blocks)))
      this._fireTriggers('becomesBlocked', s.objects[attackerOid], {
        other: s.objects[Object.keys(blocks).find((b) => blocks[b] === attackerOid)]
      })
    // Move on to the next attacked opponent, or finish blocking.
    if (s.combat.blockQueue && s.combat.blockQueue.length) this._presentBlockers()
    else this._grantPriority()
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
      s.combat.secondDamageStep = true // regular damage after a round of priority
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
    this._initiativeHits = new Set()
    this._combatDamagePassInner(pass)
    // 726.2: each player whose creatures dealt combat damage to the player with
    // the initiative takes it (one trigger per such player).
    const s = this.state
    for (const pid of this._initiativeHits)
      s.pendingTriggers.push({ controller: s.initiative, sourceOid: null, subjectOid: null, name: 'The Initiative', effect: [{ op: 'takeInitiative', pid }], targetSpec: [] })
    this._initiativeHits = null
  }

  _combatDamagePassInner(pass) {
    const s = this.state
    const onBf = (oid) => s.objects[oid] && s.objects[oid].zoneName === 'battlefield'

    // Attackers deal damage.
    for (const atkOid of s.combat.attackers) {
      const atk = s.objects[atkOid]
      if (!onBf(atkOid) || !this._dealsInPass(atk, pass)) continue
      const power = atk.chars.power
      // A creature blocking one member of a band blocks the whole band (702.22c).
      const blocksAtk = (b, a) => a === atkOid || !!s.combat.bandBlocks?.[b]?.includes(atkOid)
      const blockers = (s.combat.blocks
        ? Object.entries(s.combat.blocks)
            .filter(([b, a]) => blocksAtk(b, a))
            .map(([b]) => b)
        : []
      )
        .filter((b) => onBf(b) && blocksAtk(b, s.objects[b].status.blocking))
        // 509.2 / 510.1c: the attacker's declared damage assignment order.
        .sort((x, y) => {
          const ord = s.combat.order?.[atkOid] || []
          return (ord.indexOf(x) === -1 ? 99 : ord.indexOf(x)) - (ord.indexOf(y) === -1 ? 99 : ord.indexOf(y))
        })

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

    // Blockers deal damage to the attacker they block — unless it has been removed
    // from combat (regenerated, 701.15c), in which case they deal none (506.4).
    for (const [blkOid, atkOid] of Object.entries(s.combat.blocks)) {
      const b = s.objects[blkOid]
      if (!onBf(blkOid) || !this._dealsInPass(b, pass)) continue
      // Banding (702.22c): the band's controller assigns the blocker's damage among
      // the band — to the member most able to absorb it.
      const band = s.combat.bandBlocks?.[blkOid]
      const assign = s.combat.bandAssign?.[blkOid]
      if (assign) {
        // The band controller's chosen split (702.22c).
        for (const [m, amt] of Object.entries(assign))
          if (amt > 0 && onBf(m) && s.objects[m].status.attacking) this._dealDamage(b, { obj: s.objects[m] }, amt, { combat: true })
        continue
      }
      let victim = atkOid
      if (band?.length) {
        // Auto (tests): to the member with the most room.
        const alive = band.filter((m) => onBf(m) && s.objects[m].status.attacking)
        if (alive.length)
          victim = alive.reduce((best, m) => {
            const room = (o) => (o.chars.toughness ?? 0) - o.status.damage
            return room(s.objects[m]) > room(s.objects[best]) ? m : best
          }, alive[0])
      }
      if (onBf(victim) && s.objects[victim].status.attacking)
        this._dealDamage(b, { obj: s.objects[victim] }, b.chars.power, { combat: true })
    }
  }

  // Central damage application: applies prevention/replacements, marks deathtouch
  // kills, and grants lifelink.
  _dealDamage(source, target, amount, opts = {}) {
    if (amount <= 0) return
    const s = this.state
    // Prevention (rule 615): "prevent all combat damage this turn" (Fog, etc.).
    // "Damage can't be prevented" (a rule-modifying static) turns off all prevention.
    const noPrevent = this._ruleMods().some(({ mod }) => mod.damageCantBePrevented)
    if (!noPrevent && opts.combat && s.prevent.some((p) => p.type === 'allCombat')) return
    // "Prevent all damage that sources of the chosen color would deal this turn".
    if (!noPrevent && s.prevent.some((p) => p.type === 'color' && (source?.chars?.colors || source?.printed?.colors || []).includes(p.color))) return
    // Protection is a prevention effect (615) — applied before general replacements.
    if (target.obj && !noPrevent) {
      const prot = target.obj.chars?.protections || []
      if (prot.includes('everything') || (prot.length && tags(source?.chars).some((c) => prot.includes(c)))) return
    }
    // General replacement effects (614/616): damage doubling (Furnace of Rath),
    // prevention shields (Samite Healer), etc. may change the amount or the target.
    const ev = { kind: 'damage', source, target, amount, combat: !!opts.combat, noPrevent }
    this._applyReplacements(ev)
    this._sweepReplacements()
    amount = ev.amount
    target = ev.target
    if (amount <= 0) return
    const tgtName = target.player != null ? this._nameOf(target.player) : this._objName(target.obj)
    this._log(`${this._objName(source)} deals ${amount}${opts.combat ? ' combat' : ''} damage to ${tgtName}`)
    // Infect (702.90) deals damage to players as poison counters and to creatures
    // as -1/-1 counters; wither (702.80) does the latter only.
    const infect = this._hasKW(source, 'Infect')
    const wither = this._hasKW(source, 'Wither')
    if (target.player != null) {
      if (infect) this._addPlayerCounter(target.player, 'poison', amount)
      else this._loseLife(target.player, amount)
      // Toxic N (702.180): combat damage also gives N poison counters.
      const toxic = this._ability(source, 'toxic')
      if (opts.combat && toxic) this._addPlayerCounter(target.player, 'poison', toxic)
      if (opts.combat && source?.isCommander) this._commanderDamage(source, target.player, amount)
      // "Whenever this creature deals combat damage to a player" (Ninja of the Deep Hours).
      if (opts.combat && source?.chars?.types?.includes('Creature')) {
        this._fireTriggers('dealsCombatDamageToPlayer', source)
        const s = this.state
        // 725.2: combat damage to the monarch — its controller becomes the monarch.
        // The trigger has no source and is controlled by the (current) monarch.
        if (s.monarch === target.player && source.controller !== target.player)
          s.pendingTriggers.push({ controller: s.monarch, sourceOid: null, subjectOid: null, name: 'The Monarch', effect: [{ op: 'becomeMonarch', pid: source.controller }], targetSpec: [] })
        // 726.2: "one or more creatures a player controls deal combat damage to
        // the player who has the initiative" — batched per damage step.
        if (s.initiative === target.player && source.controller !== target.player) (this._initiativeHits ||= new Set()).add(source.controller)
      }
    } else if (target.obj) {
      if (target.obj.chars?.types.includes('Planeswalker')) {
        // Damage to a planeswalker removes that many loyalty counters (306.8).
        target.obj.status.counters.loyalty = (target.obj.status.counters.loyalty || 0) - amount
      } else if (target.obj.chars?.types.includes('Battle')) {
        // Damage to a battle removes that many defense counters (310.8).
        target.obj.status.counters.defense = (target.obj.status.counters.defense || 0) - amount
      } else {
        if (infect || wither) target.obj.status.counters['-1/-1'] = (target.obj.status.counters['-1/-1'] || 0) + amount
        else target.obj.status.damage += amount
        if (this._hasKW(source, 'Deathtouch')) target.obj.status.markedDeath = true
      }
    }
    if (source?.oid) this._fireTriggers('dealsDamage', source)
    if (this._hasKW(source, 'Lifelink')) this._gainLife(source.controller, amount)
  }

  // Life loss (119.3), from damage or an effect.
  _loseLife(pid, amount) {
    if (amount <= 0) return
    const p = this.state.players[pid]
    p.life -= amount
    this._firePlayerEvent('lifeLost', pid, { amount })
  }

  // Counters on a player (122.1: poison, energy, experience, …).
  _addPlayerCounter(pid, kind, n) {
    if (n <= 0) return
    const p = this.state.players[pid]
    p.counters[kind] = (p.counters[kind] || 0) + n
    this._log(`${p.name} gets ${n} ${kind} counter${n > 1 ? 's' : ''} (${p.counters[kind]})`)
  }

  // Combat damage from a commander (903.10a): 21 from one commander loses the game.
  _commanderDamage(source, pid, amount) {
    const p = this.state.players[pid]
    p.commanderDamage ||= {}
    p.commanderDamage[source.oid] = (p.commanderDamage[source.oid] || 0) + amount
  }

  // Player-level triggered events ("whenever you draw a card", "whenever an
  // opponent loses life", …): a permanent's trigger with `player: 'you'` (the
  // default) fires when its controller is the player concerned, 'opponent' when
  // an opponent is, 'any' for anyone.
  _firePlayerEvent(event, pid, extra = {}) {
    const s = this.state
    for (const oid of [...zone(s, 'battlefield')]) {
      const w = s.objects[oid]
      if (!w || w.chars?.lostAbilities) continue
      for (const ab of w.behavior?.triggered || []) {
        if (ab.trigger.event !== event) continue
        const who = ab.trigger.player || 'you'
        if (who === 'you' && pid !== w.controller) continue
        if (who === 'opponent' && pid === w.controller) continue
        if (ab.trigger.if && !this._cond(ab.trigger.if, w)) continue
        s.pendingTriggers.push({
          controller: w.controller,
          sourceOid: w.oid,
          subjectOid: null,
          subjectPid: pid,
          effect: ab.effect,
          targetSpec: ab.targets || [],
          optional: !!ab.optional,
          condition: ab.trigger.if || null,
          extra
        })
      }
    }
  }

  // Life gain routed through replacement effects (614) — e.g. Rhox Faithmender
  // ("if you would gain life, gain twice that much instead").
  _gainLife(pid, amount) {
    if (amount <= 0) return
    // "If a player would gain life, that player gains no life instead" (Sulfuric Vortex).
    if (this._ruleMods().some(({ mod }) => mod.noLifeGain)) {
      this._log(`${this._nameOf(pid)} would gain ${amount} life, but can't`)
      return
    }
    const ev = { kind: 'gainLife', player: pid, amount }
    this._applyReplacements(ev)
    this.state.players[pid].life += ev.amount
    this._log(`${this._nameOf(pid)} gains ${ev.amount} life (${this.state.players[pid].life})`)
    this._firePlayerEvent('lifeGained', pid, { amount: ev.amount })
  }

  // ---- replacement effects (rule 614 / 616) ---------------------------
  // A replaceable event is a small mutable record ({ kind, amount, … }). Each
  // applicable replacement modifies it at most once (616.1); the caller then
  // performs the possibly-changed event. Sources: static `replacement` abilities
  // on battlefield permanents, and floating shields in state.replacements.

  _collectReplacements(event) {
    const s = this.state
    const out = []
    for (const o of objectsIn(s, 'battlefield')) {
      if (o.chars?.lostAbilities) continue
      for (const rep of o.behavior?.replacement || [])
        if (this._replacementMatches(rep, event, o)) out.push({ apply: rep.apply, source: o })
    }
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
    // Rule 616.1 lets the affected player (or the affected object's controller)
    // order the effects. For damage they always prefer prevention first (a shield
    // applied before doubling prevents more), so that is the deterministic order.
    list.sort((a, b) => (a.apply?.multiply ? 1 : 0) - (b.apply?.multiply ? 1 : 0))
    for (const r of list) {
      if (event.amount <= 0) break
      if (event.noPrevent && !r.apply?.multiply) continue // prevention switched off
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
    let rounds = 0
    while (repeat) {
      repeat = false
      rounds++
      recompute(s) // fresh characteristics (layers) before checking SBAs
      for (const p of s.players) {
        // "You can't lose the game and your opponents can't win" (Platinum Angel):
        // such a player doesn't lose to SBAs.
        if (p.hasLost || this._cantLose(p.id)) continue
        // 704.5a life, 704.5b drew from an empty library, 704.5c ten poison counters,
        // 704.6c 21 combat damage from a single commander.
        const cmdDmg = Object.values(p.commanderDamage || {}).some((n) => n >= 21)
        if (p.life <= 0 || p.loses || (p.counters.poison || 0) >= 10 || cmdDmg) {
          this._eliminate(p) // leaves the game (rule 800.4); repeats SBAs
          repeat = true
        }
      }
      // The game ends when one player remains (or everyone left is protected).
      // If everyone lost at once, the game is a draw (104.4a) — winner -1.
      if (s.winner == null) {
        const alive = s.players.filter((p) => !p.hasLost)
        if (alive.length === 1 && s.players.length > 1) s.winner = alive[0].id
        else if (alive.length === 0) s.winner = -1
      }
      // Saga (714.4): sacrificed once its last chapter has triggered and none of
      // its chapter abilities are on the stack.
      for (const o of objectsIn(s, 'battlefield')) {
        const saga = this._ability(o, 'saga')
        if (!saga || (o.status.counters.lore || 0) < saga.chapters.length) continue
        const onStack = zone(s, 'stack').some((x) => s.objects[x]?.kind === 'ability' && s.objects[x].sourceOid === o.oid)
        const queued = s.pendingTriggers.some((t) => t.sourceOid === o.oid)
        if (!onStack && !queued) {
          this._sacrifice(o)
          repeat = true
        }
      }
      // 309.6: a completed dungeon leaves the game once its last room ability is done.
      if (this._dungeonSBA()) repeat = true
      // Commander (903.9): a commander in a graveyard or in exile goes back to the
      // command zone (its owner's "may" is always taken).
      for (const o of Object.values(s.objects)) {
        if (o.isCommander && (o.zoneName === 'graveyard' || o.zoneName === 'exile')) {
          this._log(`${this._objName(o)} returns to the command zone`)
          moveObject(s, o.oid, 'command')
          repeat = true
        }
      }
      // A battle with no defense counters is defeated (704.5v / 310.11e): a Siege is
      // exiled and its controller may cast it transformed without paying its cost.
      for (const o of objectsIn(s, 'battlefield')) {
        if (!o.chars.types.includes('Battle') || (o.status.counters.defense || 0) > 0) continue
        this._log(`${this._objName(o)} is defeated`)
        const ctrl = o.controller
        this._relocate(o, 'exile')
        if (o.faces?.length > 1) s.pendingMadness.push({ pid: ctrl, oid: o.oid, cost: null, free: true, keep: true, face: 1 })
        repeat = true
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
        if (tough <= 0) {
          this._bury(o) // 0 toughness: regeneration does not save it
          repeat = true
        } else if (destroyed) {
          // Fire dies triggers while the creature is still on the battlefield
          // (leaves-the-battlefield abilities "look back in time"). A regeneration
          // shield replaces the destruction instead.
          if (!this._tryRegenerate(o)) this._bury(o)
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
        if (!this._autoOrder) {
          // 704.5j: the controller chooses which one to keep.
          s.pending = {
            kind: 'legendChoice',
            player: group[0].controller,
            name: group[0].chars.name,
            choices: group.map((o) => o.oid)
          }
          return true
        }
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
      const draw = s.winner === -1
      this._log(draw ? 'The game is a draw' : `${this._nameOf(s.winner)} wins the game`, { marker: true })
      s.pending = { kind: 'gameOver', winner: draw ? null : s.winner, draw }
    }
    return rounds > 1 // did any state-based action happen?
  }

  // 704.5j: the controller kept one of several same-named legendary permanents.
  _applyLegendChoice(pending, answer) {
    const s = this.state
    const keep = pending.choices.includes(answer?.keep) ? answer.keep : pending.choices[0]
    for (const oid of pending.choices) if (oid !== keep && s.objects[oid]?.zoneName === 'battlefield') this._bury(s.objects[oid])
    this._grantPriorityTo(s.activePlayer)
  }

  // A player concedes (104.3a) — legal at any time, regardless of whose decision
  // is pending. They leave the game; whatever they were deciding is abandoned.
  concede(pid) {
    const s = this.state
    const p = s.players[pid]
    if (!p || p.hasLost || s.winner != null) return this
    this._log(`${p.name} concedes`, { marker: true })
    p.loses = true
    this._checkSBA() // eliminates them; may end the game
    if (s.winner != null) return this
    if (s.pending?.player === pid) {
      // Abandon their pending decision. A paused resolution finishes with no
      // further effect; a blocker declaration moves to the next defender.
      const kind = s.pending.kind
      s.pending = null
      this._resume = null
      this._afterMadness = null
      this._castPaused = false
      if (this._resolveObject) this._finishResolution()
      if (kind === 'declareBlockers' && s.combat?.blockQueue?.length) {
        this._presentBlockers()
        return this
      }
      s.prio = null
      this._grantPriorityTo(s.activePlayer)
      this._pump()
    }
    return this
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
    this._log(`${this._nameOf(pid)} discards ${this._objName(o)}`)
    if (o.behavior?.madness) {
      moveObject(s, oid, 'exile')
      s.pendingMadness.push({ pid, oid, cost: o.behavior.madness.cost })
    } else {
      moveObject(s, oid, 'graveyard')
    }
    this._firePlayerEvent('discard', pid, { card: oid })
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
      cost: m.cost, // null: cast without paying (cascade)
      free: !!m.free,
      canPay: m.free ? true : this._canPay(m.pid, parseManaCost(m.cost)),
      targets: this._spellTargets(o),
      _after: m.after || null,
      _keep: !!m.keep, // declined: stays where it is (rebound/suspend) vs. bottom of library (cascade)
      _haste: !!m.haste, // suspend: a creature cast this way has haste
      _face: m.face ?? null, // a defeated Siege is cast transformed
      miracle: !!m.miracle // cast for its miracle cost as it was drawn
    }
    if (m.face != null) s.pending.targets = this._spellTargets(o, loadBehavior(o.faces[m.face]))
  }

  _applyMadness(pending, answer) {
    const s = this.state
    const o = s.objects[pending.oid]
    if (answer?.cast) {
      if (!pending.free) this._pay(pending.player, parseManaCost(pending.cost))
      moveObject(s, pending.oid, 'stack')
      if (pending._face != null) setFace(o, pending._face) // cast transformed (a defeated Siege)
      o.controller = pending.player
      o.targets = answer.targets || []
      o.spell = o.behavior.spell
      o.madnessCast = !pending.free && !pending.miracle // madness spells are exiled when they leave the stack
      this._assertTargetsLegal(o.targets, o.controller, tags(o.printed))
      this._log(`${this._nameOf(pending.player)} casts ${this._objName(o)}${pending.free ? ' without paying its mana cost' : ' (madness)'}`)
      if (pending._haste) o.suspendHaste = true
      this._countSpellCast(o)
      this._fireTriggers('castSpell', o)
      this._checkWard(o.oid, o.controller, o.targets)
    } else if (pending.free && !pending._keep) {
      moveObject(s, pending.oid, 'library') // declined cascade: to the bottom with the rest
    } else if (pending.free) {
      /* declined rebound/suspend: the card stays in exile */
    } else {
      moveObject(s, pending.oid, 'graveyard')
    }
    if (pending._after) pending._after()
    this._processMadness(this._afterMadness)
  }

  // ---- triggered abilities --------------------------------------------

  // Scan permanents on the battlefield for triggered abilities matching `event`
  // about `subject`, and queue matches. They are put on the stack the next time
  // a player would receive priority (see _putTriggersOnStack).
  _fireTriggers(event, subject, extra = {}) {
    const s = this.state
    const watchers = [...zone(s, 'battlefield'), ...this._emblems()]
    // A spell being cast can carry its own "when you cast this spell" triggers
    // while it is on the stack (not the battlefield).
    if (event === 'castSpell' && !watchers.includes(subject.oid)) watchers.push(subject.oid)
    // Cascade (702.85): a keyword cast trigger of the spell itself.
    if (event === 'castSpell' && subject.printed?.keywords?.includes('Cascade'))
      s.pendingTriggers.push({ controller: subject.controller, sourceOid: subject.oid, subjectOid: subject.oid, effect: [{ op: 'cascade' }], targetSpec: [] })
    for (const oid of watchers) {
      const w = s.objects[oid]
      if (!w || w.chars?.lostAbilities) continue // "loses all abilities" (613.1f)
      for (const ab of w.behavior?.triggered || []) {
        if (ab.trigger.event !== event) continue
        if (ab.trigger.self) {
          if (w.oid !== subject.oid) continue
        } else if (!this._matchFilter(ab.trigger.filter, subject, w)) {
          continue
        }
        // "Whenever this blocks a creature with flying": a filter on the other
        // party to the event (the attacker blocked / the blocker).
        if (ab.trigger.other && !this._matchOther(ab.trigger.other, extra.other)) continue
        // Intervening "if" (603.4): checked now, and again on resolution.
        if (ab.trigger.if && !this._cond(ab.trigger.if, w)) continue
        // A condition that is part of the event itself ("when this enters untapped"):
        // checked only as it triggers, never again.
        if (ab.trigger.ifOnce && !this._cond(ab.trigger.ifOnce, w)) continue
        const trig = () => ({
          controller: w.controller,
          sourceOid: w.oid,
          subjectOid: subject.oid,
          effect: ab.effect,
          targetSpec: ab.targets || [], // targets chosen when placed on the stack
          optional: !!ab.optional, // "you may …"
          condition: ab.trigger.if || null,
          extra
        })
        s.pendingTriggers.push(trig())
        // "…that ability triggers an additional time" (Panharmonicon, Yarok, Teysa
        // Karlov): once more per such permanent its controller has.
        if (w.zoneName === 'battlefield') for (let k = this._extraTriggerCount(w, event, subject); k > 0; k--) s.pendingTriggers.push(trig())
      }
    }
  }

  // How many extra times a permanent's triggered ability triggers because of
  // "triggers an additional time" statics: each one whose event and subject
  // filter match (`triggerTwice: { events, subject }`) adds one.
  _extraTriggerCount(w, event, subject) {
    const ev = event === 'etb' ? 'enters:battlefield' : event
    let n = 0
    for (const { source, mod } of this._ruleMods()) {
      const tt = mod.triggerTwice
      if (!tt || source.controller !== w.controller) continue
      if (!(tt.events || []).includes(ev)) continue
      if (tt.subject && !this._matchFilter(tt.subject, subject, w)) continue
      n++
    }
    return n
  }

  // Emblems in the command zone (114): they carry abilities like permanents do.
  _emblems() {
    return zone(this.state, 'command').filter((oid) => this.state.objects[oid]?.kind === 'emblem')
  }

  _matchOther(f, other) {
    if (!other) return false
    if (f.keyword && !this._hasKW(other, f.keyword)) return false
    if (f.type && !other.chars.types.includes(f.type)) return false
    if (f.subtype && !other.chars.subtypes.includes(f.subtype)) return false
    return true
  }

  // Tap or untap a permanent as a game event, firing "becomes tapped/untapped"
  // triggers (502.3 untap, 701.21). Entering tapped is not "becoming tapped".
  _setTapped(o, tapped) {
    if (!o || o.status.tapped === tapped) return
    o.status.tapped = tapped
    if (o.zoneName === 'battlefield') this._fireTriggers(tapped ? 'tapped' : 'untapped', o)
  }

  // Phase-boundary triggers (rule 503/513): "at the beginning of [your] upkeep /
  // end step" abilities on permanents, plus one-shot delayed triggers (603.7)
  // scheduled for this phase. Queued into pendingTriggers like any other trigger.
  _firePhaseTriggers(event) {
    const s = this.state
    for (const oid of [...zone(s, 'battlefield')]) {
      const w = s.objects[oid]
      if (w.chars?.lostAbilities) continue
      for (const ab of w.behavior?.triggered || []) {
        if (ab.trigger.event !== event) continue
        if (ab.trigger.yourTurn && w.controller !== s.activePlayer) continue
        if (ab.trigger.if && !this._cond(ab.trigger.if, w)) continue
        s.pendingTriggers.push({
          controller: w.controller,
          sourceOid: w.oid,
          subjectOid: w.oid,
          effect: ab.effect,
          targetSpec: ab.targets || [],
          optional: !!ab.optional,
          condition: ab.trigger.if || null
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
    const s = this.state
    const from = o.zoneName
    // Replacement effects on going to the graveyard (614.1): "if it would be put
    // into a graveyard, exile it / shuffle it into its library instead".
    let shuffle = false
    // Unearth (702.84c): if it would leave the battlefield, exile it instead.
    if (o.unearthed && from === 'battlefield' && toZone !== 'exile') toZone = 'exile'
    if (toZone === 'graveyard') {
      const rep = this._graveyardReplacement(o)
      if (rep) {
        this._log(`${this._objName(o)} goes to ${rep.redirect} instead of the graveyard`)
        toZone = rep.redirect
        shuffle = !!rep.shuffle
      }
    }
    // Leave triggers fire before the move — the source and observers look back
    // at the pre-move state (rule 603.6d/e).
    const isCreature = o.chars?.types?.includes('Creature')
    const plus = o.status?.counters?.['+1/+1'] || 0
    const minus = o.status?.counters?.['-1/-1'] || 0
    if (from) {
      if (from === 'battlefield') {
        const verb = toZone === 'graveyard' ? (isCreature ? 'dies' : 'is put into the graveyard') : `goes to ${toZone}`
        this._log(`${this._objName(o)} ${verb}`)
        if (isCreature && toZone === 'graveyard') this._fireTriggers('dies', o)
        if (toZone === 'graveyard') this._fireTriggers('toGraveyard', o)
      }
      this._fireTriggers('leaves:' + from, o)
    }
    moveObject(s, o.oid, toZone, opts)
    if (shuffle) {
      const lk = zoneKey(toZone, o.owner)
      s.zones[lk] = s.rng.shuffle(s.zones[lk])
    }
    // Undying / persist (702.93 / 702.79): a creature dying without the relevant
    // counter comes back with one.
    if (from === 'battlefield' && toZone === 'graveyard' && isCreature) {
      if (o.printed.keywords.includes('Undying') && plus === 0)
        s.pendingTriggers.push({ controller: o.owner, sourceOid: o.oid, subjectOid: o.oid, effect: [{ op: 'returnSelfWithCounter', counter: '+1/+1' }], targetSpec: [] })
      if (o.printed.keywords.includes('Persist') && minus === 0)
        s.pendingTriggers.push({ controller: o.owner, sourceOid: o.oid, subjectOid: o.oid, effect: [{ op: 'returnSelfWithCounter', counter: '-1/-1' }], targetSpec: [] })
    }
    this._fireTriggers('enters:' + toZone, o) // enter triggers see the new zone
  }

  // The first applicable "instead of the graveyard" replacement for `o`: its own
  // (Progenitus), or one from a battlefield permanent with a filter ("if a
  // creature would die, exile it instead"). Returns { redirect, shuffle } or null.
  _graveyardReplacement(o) {
    const s = this.state
    for (const rep of o.behavior?.replacement || [])
      if (rep.event === 'toGraveyard' && rep.self && !o.chars?.lostAbilities) return rep.apply
    for (const w of objectsIn(s, 'battlefield')) {
      if (w.chars?.lostAbilities) continue
      for (const rep of w.behavior?.replacement || [])
        if (rep.event === 'toGraveyard' && !rep.self && this._matchFilter(rep.filter, o, w)) return rep.apply
    }
    return null
  }

  // A permanent leaving the battlefield for the graveyard (death/destroy).
  _bury(o) {
    this._relocate(o, 'graveyard')
  }

  // Regeneration (701.15 / 614.8): if `o` has a regeneration shield, consume it to
  // replace a destruction — remove all damage, tap it, and pull it out of combat —
  // instead of putting it in the graveyard. Returns true if a shield was used.
  _tryRegenerate(o) {
    if ((o.status.regenShields || 0) <= 0) return false
    o.status.regenShields--
    o.status.damage = 0
    o.status.markedDeath = false
    this._setTapped(o, true)
    o.status.attacking = false
    o.status.attackingTarget = null
    o.status.blocked = false
    o.status.blocking = null
    const c = this.state.combat
    if (c) {
      c.attackers = c.attackers.filter((a) => a !== o.oid)
      delete c.blocks[o.oid]
    }
    return true
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
    if (filter.subtype && !hasSub(subject.chars, filter.subtype)) return false
    if (filter.controller === 'you' && subject.controller !== watcher.controller) return false
    if (filter.controller === 'opponent' && subject.controller === watcher.controller) return false
    return true
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
