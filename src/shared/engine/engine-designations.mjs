// Designations methods of GameEngine — split out of engine.mjs for size; mixed into
// GameEngine.prototype by engine.mjs. Same `this`, same rules references.

import { createState, createObject, createAbility, computeChars, zone, zoneKey, moveObject, objectsIn, setFace } from './state.mjs'
import { manaAbilityColors, loadBehavior } from './behaviors.mjs'
import { isPermanent, parseManaCost, manaValue, BASIC_LAND_MANA } from './cards.mjs'
import { recompute, matchStatic, hasSub } from './layers.mjs'
import { DUNGEONS, REGULAR_DUNGEONS, roomOf, RING_EMBLEM } from './dungeons.mjs'
import { combinedPrinted } from './cards.mjs'
import { STEP_ORDER, PRIORITY_STEPS, MAIN_STEPS, tags, addCosts } from './engineShared.mjs'

export const designationsMethods = {
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
  },

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
  },

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
  },

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
  },

  // ---- dungeons (309 / 701.49), the monarch (725) and the initiative (726) --

  _becomeMonarch(pid) {
    const s = this.state
    if (s.players[pid]?.hasLost || s.monarch === pid) return
    s.monarch = pid
    this._log(`${this._nameOf(pid)} becomes the monarch`, { marker: true })
    this._firePlayerEvent('becomesMonarch', pid)
  },

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
  },

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
  },

  _enterDungeon(pid, name) {
    const p = this.state.players[pid]
    const d = DUNGEONS[name]
    p.dungeon = { name, room: null }
    this._log(`${p.name} enters ${name}`)
    return this._moveVenture(pid, d.rooms[0].id)
  },

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
  },

  _completeDungeon(pid) {
    const p = this.state.players[pid]
    if (!p.dungeon) return
    this._log(`${p.name} completes ${p.dungeon.name}`, { marker: true })
    p.dungeon = null
    p.completedDungeons = (p.completedDungeons || 0) + 1
    this._firePlayerEvent('completesDungeon', pid)
  },

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
  },

  _applyChooseRoom(pending, answer) {
    const p = this.state.players[pending.player]
    const opt = pending.options.find((o) => o.id === answer?.room)
    if (!opt) throw new Error('choose one of the rooms')
    this._moveVenture(pending.player, opt.id)
    void p
    this._resumeResolution()
  },

  _applyChooseDungeon(pending, answer) {
    const opt = pending.options.find((o) => o.name === answer?.dungeon)
    if (!opt) throw new Error('choose one of the dungeons')
    this._enterDungeon(pending.player, opt.name)
    this._resumeResolution()
  },

  _applyPlayOrDraw(pending, answer) {
    const s = this.state
    if (answer?.play === false) {
      this._log(`${this._nameOf(pending.player)} chooses to draw`)
      s.startingPlayer = this._nextInSeat(pending.player)
    }
    this._beginMulligans()
  },

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
  },

  // ---- day and night (731) ----------------------------------------------

  _isDaybound(o) {
    return !!o?.faces?.[0]?.keywords?.includes('Daybound') && o.layout === 'transform'
  },

  // It becomes day or night: daybound permanents show their day face, nightbound
  // ones their night face (731.3), and "becomes day/night" abilities trigger.
  _becomeDayNight(which) {
    const s = this.state
    if (s.daytime === which) return
    s.daytime = which
    this._log(`It becomes ${which}`, { marker: true })
    for (const o of objectsIn(s, 'battlefield')) {
      if (!this._isDaybound(o) || !o.faces?.[1]) continue
      const want = which === 'night' ? 1 : 0
      if ((o.face || 0) === want) continue
      setFace(o, want)
      this._log(`${this._objName(o)} transforms`)
      this._fireTriggers('transforms', o)
    }
    recompute(s)
    for (const p of s.players) if (!p.hasLost) this._firePlayerEvent(which === 'day' ? 'becomesDay' : 'becomesNight', p.id)
  },

  // ---- the Ring (701.54) --------------------------------------------------

  // The Ring tempts `pid`: the emblem if they lack it, one more temptation, then
  // a Ring-bearer among their creatures (a choice; auto: the biggest).
  _ringTempt(pid) {
    const s = this.state
    const p = s.players[pid]
    if (p.hasLost) return false
    if (!this._emblems().some((oid) => s.objects[oid].owner === pid && s.objects[oid].printed?.name === 'The Ring')) this._makeEmblem(pid, RING_EMBLEM)
    p.ringTempts = (p.ringTempts || 0) + 1
    this._log(`The Ring tempts ${p.name} (${p.ringTempts})`)
    this._firePlayerEvent('ringTempts', pid)
    const cands = objectsIn(s, 'battlefield').filter((o) => o.controller === pid && o.chars.types.includes('Creature'))
    if (!cands.length) return false
    if (cands.length === 1 || this._autoOrder) {
      this._setRingBearer(pid, cands.sort((a, b) => (b.chars.power || 0) - (a.chars.power || 0))[0])
      return false
    }
    s.pending = { kind: 'chooseRingBearer', player: pid, choices: cands.map((o) => o.oid) }
    return true
  },

  _setRingBearer(pid, o) {
    for (const x of objectsIn(this.state, 'battlefield')) if (x.controller === pid) x.ringBearer = false
    o.ringBearer = true
    this._log(`${this._objName(o)} is ${this._nameOf(pid)}'s Ring-bearer`)
    recompute(this.state)
    this._firePlayerEvent('choosesRingBearer', pid)
  },

  _applyChooseRingBearer(pending, answer) {
    const o = this.state.objects[answer?.oid]
    if (!o || !pending.choices.includes(answer?.oid)) throw new Error('choose one of your creatures as your Ring-bearer')
    this._setRingBearer(pending.player, o)
    this._resumeResolution()
  },

  // An emblem (114): an object in the command zone carrying static (and
  // triggered) abilities for its owner. It can't leave the game.
  _makeEmblem(controller, e) {
    const s = this.state
    const em = createObject(s, { name: e.name || 'Emblem', type_line: 'Emblem', colors: [] }, controller)
    em.kind = 'emblem'
    em.behavior = { ...em.behavior, static: e.static || [], triggered: e.triggered || [], staticRules: e.staticRules || [] }
    em.zoneName = 'command'
    em.timestamp = ++s.tsCounter
    s.zones.command.push(em.oid)
    this._log(`${this._nameOf(controller)} gets an emblem${e.name ? ` (${e.name})` : ''}`)
    return em
  },

  // ---- Rooms (Duskmourn) --------------------------------------------------

  _isRoom(o) {
    return o?.layout === 'split' && !!o.faces?.every((f) => f.subtypes?.includes('Room'))
  },

  // A Room's characteristics and abilities are those of its unlocked doors.
  _refreshRoom(o) {
    const faces = (o.unlocked || []).map((i) => o.faces[i])
    if (!faces.length) return
    o.printed = faces.length === 1 ? faces[0] : combinedPrinted(faces)
    const bs = faces.map((f) => loadBehavior(f))
    const cat = (k) => bs.flatMap((b) => b[k] || [])
    o.behavior = { ...bs[0], triggered: cat('triggered'), activated: cat('activated'), static: cat('static'), staticRules: cat('staticRules'), replacement: cat('replacement') }
    computeChars(o)
  },

  // "When you unlock this door, …" — the door face's authored `unlock` ability.
  _unlockTrigger(o, face) {
    const b = loadBehavior(o.faces[face])
    if (!b.unlock) return
    this.state.pendingTriggers.push({
      controller: o.controller,
      sourceOid: o.oid,
      subjectOid: o.oid,
      name: `${o.faces[face].name} — unlocked`,
      effect: b.unlock.effect,
      targetSpec: b.unlock.targets || []
    })
  },
}
