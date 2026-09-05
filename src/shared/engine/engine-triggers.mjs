// Triggers methods of GameEngine — split out of engine.mjs for size; mixed into
// GameEngine.prototype by engine.mjs. Same `this`, same rules references.

import { createState, createObject, createAbility, computeChars, zone, zoneKey, moveObject, objectsIn, setFace } from './state.mjs'
import { manaAbilityColors, loadBehavior } from './behaviors.mjs'
import { isPermanent, parseManaCost, manaValue, BASIC_LAND_MANA } from './cards.mjs'
import { recompute, matchStatic, hasSub } from './layers.mjs'
import { DUNGEONS, REGULAR_DUNGEONS, roomOf } from './dungeons.mjs'
import { STEP_ORDER, PRIORITY_STEPS, MAIN_STEPS, tags, addCosts } from './engineShared.mjs'

export const triggersMethods = {
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
  },

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
  },

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
  },

  _sweepReplacements() {
    this.state.replacements = this.state.replacements.filter((r) => !r._spent)
  },

  _hasKW(o, kw) {
    return !!o?.chars?.keywords?.includes(kw)
  },

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
  },

  // 704.5j: the controller kept one of several same-named legendary permanents.
  _applyLegendChoice(pending, answer) {
    const s = this.state
    const keep = pending.choices.includes(answer?.keep) ? answer.keep : pending.choices[0]
    for (const oid of pending.choices) if (oid !== keep && s.objects[oid]?.zoneName === 'battlefield') this._bury(s.objects[oid])
    this._grantPriorityTo(s.activePlayer)
  },

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
  },

  _applyDiscard(pending, answer) {
    const s = this.state
    const discard = answer?.discard || []
    if (discard.length !== pending.count) throw new Error('must discard exactly ' + pending.count)
    for (const oid of discard) this._discardCard(pending.player, oid)
    // Resolve any madness opportunities, then finish cleanup.
    this._processMadness(() => this._endCleanup())
  },

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
  },

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
  },

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
      this._log(
        `${this._nameOf(pending.player)} casts ${this._objName(o)}${
          pending.free
            ? ' without paying its mana cost'
            : pending.miracle
              ? ` for its miracle cost ${pending.cost}`
              : ` for its madness cost ${pending.cost} (it was discarded)`
        }`
      )
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
  },

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
        if (ab.trigger.level != null && extra.level !== ab.trigger.level) continue // "when this Class becomes level N"
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
  },

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
  },

  // Emblems in the command zone (114): they carry abilities like permanents do.
  _emblems() {
    return zone(this.state, 'command').filter((oid) => this.state.objects[oid]?.kind === 'emblem')
  },

  _matchOther(f, other) {
    if (!other) return false
    if (f.keyword && !this._hasKW(other, f.keyword)) return false
    if (f.type && !other.chars.types.includes(f.type)) return false
    if (f.subtype && !other.chars.subtypes.includes(f.subtype)) return false
    return true
  },

  // Tap or untap a permanent as a game event, firing "becomes tapped/untapped"
  // triggers (502.3 untap, 701.21). Entering tapped is not "becoming tapped".
  _setTapped(o, tapped) {
    if (!o || o.status.tapped === tapped) return
    o.status.tapped = tapped
    if (o.zoneName === 'battlefield') this._fireTriggers(tapped ? 'tapped' : 'untapped', o)
  },

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
  },

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
  },

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
  },

  // A permanent leaving the battlefield for the graveyard (death/destroy).
  _bury(o) {
    this._relocate(o, 'graveyard')
  },

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
  },

  // A permanent sacrificed (as a cost or effect). Distinct from destroy/other
  // deaths: fires the `sacrifice` event first — e.g. Writhing Chrysalis grows
  // "whenever you sacrifice another Eldrazi" — then buries it (dies/toGraveyard).
  _sacrifice(o) {
    this._fireTriggers('sacrifice', o)
    this._bury(o)
  },

  _matchFilter(filter, subject, watcher) {
    if (!filter) return true
    if (filter.another && subject.oid === watcher.oid) return false
    if (filter.type && !subject.chars.types.includes(filter.type)) return false
    if (filter.types && !filter.types.some((t) => subject.chars.types.includes(t))) return false
    if (filter.noncreature && subject.chars.types.includes('Creature')) return false
    if (filter.subtype && !hasSub(subject.chars, filter.subtype)) return false
    if (filter.controller === 'you' && subject.controller !== watcher.controller) return false
    if (filter.controller === 'opponent' && subject.controller === watcher.controller) return false
    if (filter.ringBearer && !subject.ringBearer) return false // "your Ring-bearer"
    if (filter.alone && (this.state.combat?.attackers?.length || 0) !== 1) return false // "attacks alone"
    return true
  },

}
