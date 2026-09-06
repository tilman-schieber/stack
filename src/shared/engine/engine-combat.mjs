// Combat methods of GameEngine — split out of engine.mjs for size; mixed into
// GameEngine.prototype by engine.mjs. Same `this`, same rules references.

import { createState, createObject, createAbility, computeChars, zone, zoneKey, moveObject, objectsIn, setFace } from './state.mjs'
import { manaAbilityColors, loadBehavior } from './behaviors.mjs'
import { isPermanent, parseManaCost, manaValue, BASIC_LAND_MANA } from './cards.mjs'
import { recompute, matchStatic, hasSub } from './layers.mjs'
import { DUNGEONS, REGULAR_DUNGEONS, roomOf } from './dungeons.mjs'
import { STEP_ORDER, PRIORITY_STEPS, MAIN_STEPS, tags, addCosts } from './engineShared.mjs'

export const combatMethods = {
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
  },

  // Summoning sickness prevents attacking / {T} abilities unless the creature has
  // haste (or is not a creature).
  _canTap(o) {
    return !o.status.summoningSick || this._hasKW(o, 'Haste')
  },

  _applyAttackers(answer) {
    const s = this.state
    const def = this._defendingPlayer()
    // Entries may be bare oids (attack the defending player) or { oid, defender }
    // where defender is { player } or { planeswalker }.
    const entries = (answer?.attackers || []).map((a) =>
      typeof a === 'string' ? { oid: a, defender: { player: def } } : a
    )
    s.combat.bands = {}
    s.combat.attackers = entries.map((e) => e.oid) // known before "attacks" triggers ("attacks alone")
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
    if (entries.length) this._firePlayerEvent('youAttack', s.activePlayer) // "whenever you attack" (once per combat)
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
  },

  _defendingPlayer() {
    return this._otherPlayer(this.state.activePlayer)
  },

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
  },

  // The player defending against a given attacker (the attacked player, or the
  // controller of the attacked planeswalker).
  _defenderOfAttacker(a) {
    const t = a.status.attackingTarget
    if (t?.planeswalker) return this.state.objects[t.planeswalker]?.controller
    if (t?.battle) return this.state.objects[t.battle]?.protector
    return t?.player
  },

  // Distinct opponents currently being attacked — each declares its own blockers.
  _blockingPlayers() {
    const s = this.state
    const set = new Set()
    for (const oid of s.combat.attackers) set.add(this._defenderOfAttacker(s.objects[oid]))
    return [...set].filter((pid) => pid != null && !s.players[pid]?.hasLost)
  },

  // Present the next queued defender with the attackers aimed at them.
  _presentBlockers() {
    const s = this.state
    const def = s.combat.blockQueue.shift()
    const attackers = s.combat.attackers.filter((oid) => this._defenderOfAttacker(s.objects[oid]) === def)
    const eligible = this._eligibleBlockers(def)
    // For the UI: blockers that may block additional creatures (Entourage of Trest).
    const extraBlocks = {}
    for (const oid of eligible) {
      const n = this._extraBlocks(s.objects[oid])
      if (n > 0) extraBlocks[oid] = n
    }
    s.pending = { kind: 'declareBlockers', player: def, eligible, attackers, extraBlocks }
  },

  // Resolve an attacker's declared target into a _dealDamage target.
  _attackTargetOf(atk) {
    const t = atk.status.attackingTarget
    if (t?.battle && this.state.objects[t.battle]?.zoneName === 'battlefield') return { obj: this.state.objects[t.battle] }
    if (t?.planeswalker && this.state.objects[t.planeswalker]?.zoneName === 'battlefield')
      return { obj: this.state.objects[t.planeswalker] }
    return { player: t?.player ?? this._defendingPlayer() }
  },

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
  },

  // An ability-derived property of a permanent, unless it has lost all its
  // abilities (613.1f / Dress Down).
  _ability(o, key) {
    return o?.chars?.lostAbilities ? undefined : o?.behavior?.[key]
  },

  // Does an attack/block *requirement* apply to `o` (508.1d / 509.1c) — its own
  // "attacks each combat if able", or a rule-modifying static ("Other Goblins
  // you control attack each combat if able")?
  // How many creatures beyond one this creature may block ("can block an
  // additional creature each combat").
  _extraBlocks(o) {
    let n = 0
    for (const { source, mod } of this._ruleMods()) if (mod.extraBlocks && matchStatic(mod.affects, source, o)) n += mod.extraBlocks
    return n
  },

  _required(o, action) {
    if (action === 'attack' && this._ability(o, 'mustAttack')) return true
    if (action === 'attack' && this._goadedBy(o).length) return true // goaded (701.15b)
    if (action === 'block' && this._ability(o, 'mustBlock')) return true
    for (const { source, mod } of this._ruleMods())
      if (mod.require?.includes(action) && matchStatic(mod.affects, source, o)) return true
    return false
  },

  // Can `blocker` legally block `attacker` (509.1b)? The attacker's evasion
  // (flying, fear, intimidate, skulk, shadow, horsemanship, landwalk, "can't be
  // blocked", protection) and the blocker's own restrictions ("can't block").
  _canBlock(blocker, attacker) {
    const kw = (o, k) => this._hasKW(o, k)
    if (this._ability(blocker, 'cantBlock') || this._ability(attacker, 'cantBeBlocked')) return false
    // The Ring (701.54c): your Ring-bearer can't be blocked by creatures with greater power.
    if (attacker.ringBearer && (blocker.chars.power ?? 0) > (attacker.chars.power ?? 0)) return false
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
  },

  _applyBlockers(answer) {
    const s = this.state
    // A blocker may name one attacker, or several when something lets it block
    // additional creatures (Entourage of Trest); the first is its primary block.
    const blocks = {}
    const multi = {}
    for (const [b, v] of Object.entries(answer?.blocks || {})) {
      const list = Array.isArray(v) ? v : [v]
      if (!list.length) continue
      blocks[b] = list[0]
      if (list.length > 1) multi[b] = list
    }

    // Validate legality before committing (evasion + menace).
    const perAttacker = {}
    for (const [blockerOid, attackerOid] of Object.entries(blocks)) {
      const b = s.objects[blockerOid]
      if (!b) throw new Error('illegal block: no such creature')
      if (this._restricted(b, 'block')) throw new Error(`illegal block: ${b.chars.name} can't block`)
      const list = multi[blockerOid] || [attackerOid]
      if (list.length > 1 + this._extraBlocks(b)) throw new Error(`illegal block: ${b.chars.name} can't block ${list.length} creatures`)
      for (const aOid of list) {
        const a = s.objects[aOid]
        if (!a || !a.status.attacking) throw new Error('illegal block: not an attacker')
        if (!this._canBlock(b, a)) throw new Error(`illegal block: ${b.chars.name} can't block ${a.chars.name}`)
        ;(perAttacker[aOid] ||= []).push(blockerOid)
      }
    }
    for (const atkOid of s.combat.attackers) {
      const n = perAttacker[atkOid]?.length || 0
      const atk = s.objects[atkOid]
      if (n === 1 && this._hasKW(atk, 'Menace'))
        throw new Error('illegal block: menace must be blocked by two or more creatures')
      const max = this._ability(atk, 'maxBlockers')
      if (max != null && n > max) throw new Error(`illegal block: ${atk.chars.name} can't be blocked by more than ${max} creature(s)`)
      // "Can't be blocked except by N or more creatures" (Troll of Khazad-dûm).
      const min = this._ability(atk, 'minBlockers')
      if (min != null && n > 0 && n < min) throw new Error(`illegal block: ${atk.chars.name} can't be blocked except by ${min} or more creatures`)
    }

    // Merge this defender's blocks into the combat (other defenders add theirs).
    const defender = this.state.pending?.player ?? this._defendingPlayer()
    const desc = Object.entries(blocks).map(
      ([b, a]) => `${this._objName(s.objects[b])} blocks ${(multi[b] || [a]).map((x) => this._objName(s.objects[x])).join(' and ')}`
    )
    this._log(desc.length ? `${this._nameOf(defender)}: ${desc.join(', ')}` : `${this._nameOf(defender)} doesn't block`)
    Object.assign((s.combat.blocks ||= {}), blocks)
    Object.assign((s.combat.multiBlocks ||= {}), multi)
    s.combat.bandBlocks ||= {}
    for (const [blockerOid, attackerOid] of Object.entries(blocks)) {
      s.objects[blockerOid].status.blocking = attackerOid
      for (const aOid of multi[blockerOid] || [attackerOid]) s.objects[aOid].status.blocked = true // stays blocked even if blockers leave
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
  },

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
  },

  // Which creatures deal damage in this pass.
  _dealsInPass(o, pass) {
    if (pass === 'all') return true
    const fs = this._hasKW(o, 'First strike')
    const ds = this._hasKW(o, 'Double strike')
    if (pass === 'first') return fs || ds
    return ds || !fs // regular: double strikers again, and non-first-strikers
  },

  _combatDamagePass(pass) {
    this._initiativeHits = new Set()
    this._combatDamagePassInner(pass)
    // 726.2: each player whose creatures dealt combat damage to the player with
    // the initiative takes it (one trigger per such player).
    const s = this.state
    for (const pid of this._initiativeHits)
      s.pendingTriggers.push({ controller: s.initiative, sourceOid: null, subjectOid: null, name: 'The Initiative', effect: [{ op: 'takeInitiative', pid }], targetSpec: [] })
    this._initiativeHits = null
  },

  _combatDamagePassInner(pass) {
    const s = this.state
    const onBf = (oid) => s.objects[oid] && s.objects[oid].zoneName === 'battlefield'

    // Attackers deal damage.
    for (const atkOid of s.combat.attackers) {
      const atk = s.objects[atkOid]
      if (!onBf(atkOid) || !this._dealsInPass(atk, pass)) continue
      const power = atk.chars.power
      // A creature blocking one member of a band blocks the whole band (702.22c).
      const blocksAtk = (b, a) => a === atkOid || !!s.combat.bandBlocks?.[b]?.includes(atkOid) || !!s.combat.multiBlocks?.[b]?.includes(atkOid)
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
      // 510.1d: a creature blocking several attackers divides its damage among
      // them, lethal-first in the order it declared them.
      const multi = s.combat.multiBlocks?.[blkOid]
      if (multi?.length > 1) {
        let remaining = b.chars.power
        const deathtouch = this._hasKW(b, 'Deathtouch')
        const alive = multi.filter((m) => onBf(m) && s.objects[m].status.attacking)
        for (let i = 0; i < alive.length && remaining > 0; i++) {
          const a = s.objects[alive[i]]
          const lethal = deathtouch ? 1 : Math.max(1, a.chars.toughness - a.status.damage)
          const amt = i === alive.length - 1 ? remaining : Math.min(remaining, lethal)
          this._dealDamage(b, { obj: a }, amt, { combat: true })
          remaining -= amt
        }
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
  },

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
  },

  // Life loss (119.3), from damage or an effect.
  _loseLife(pid, amount) {
    if (amount <= 0) return
    const p = this.state.players[pid]
    p.life -= amount
    this._firePlayerEvent('lifeLost', pid, { amount })
  },

  // Counters on a player (122.1: poison, energy, experience, …).
  _addPlayerCounter(pid, kind, n) {
    if (n <= 0) return
    const p = this.state.players[pid]
    p.counters[kind] = (p.counters[kind] || 0) + n
    this._log(`${p.name} gets ${n} ${kind} counter${n > 1 ? 's' : ''} (${p.counters[kind]})`)
  },

  // Combat damage from a commander (903.10a): 21 from one commander loses the game.
  _commanderDamage(source, pid, amount) {
    const p = this.state.players[pid]
    p.commanderDamage ||= {}
    p.commanderDamage[source.oid] = (p.commanderDamage[source.oid] || 0) + amount
  },

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
  },

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
  },

}
