// Effects methods of GameEngine — split out of engine.mjs for size; mixed into
// GameEngine.prototype by engine.mjs. Same `this`, same rules references.

import { createState, createObject, createAbility, computeChars, zone, zoneKey, moveObject, objectsIn, setFace } from './state.mjs'
import { manaAbilityColors, loadBehavior } from './behaviors.mjs'
import { isPermanent, parseManaCost, manaValue, BASIC_LAND_MANA } from './cards.mjs'
import { recompute, matchStatic, hasSub } from './layers.mjs'
import { DUNGEONS, REGULAR_DUNGEONS, roomOf } from './dungeons.mjs'
import { STEP_ORDER, PRIORITY_STEPS, MAIN_STEPS, tags, addCosts } from './engineShared.mjs'

export const effectsMethods = {
  // ---- effects ---------------------------------------------------------

  // Apply effects from index `start`. Returns true if all ran, or false if an
  // interactive effect paused (this._resume holds the continuation).
  _runEffectsFrom(source, effects, start = 0) {
    const s = this.state
    const list = effects || []
    for (let i = start; i < list.length; i++) {
      const e = list[i]
      // "If [condition], …": an effect may carry its own condition, judged against
      // the source object (a spell's gift/bargain/evidence flags, landfall, …).
      if (e.if && !this._cond(e.if, s.objects[source.oid ?? source.sourceOid] || source)) continue
      if (this._applyEffect(source, e)) {
        this._resume = { source, effects: list, index: i + 1 }
        return false // paused for a decision
      }
    }
    return true
  },

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
      case 'reorderTop': {
        // Ponder: look at the top N, put them back in any order, maybe shuffle.
        // A scry decision without the "bottom" option.
        const pid = source.controller
        const top = zone(s, 'library', pid).slice(0, e.amount)
        if (top.length === 0) return false
        s.pending = { kind: 'scry', player: pid, cards: [...top], surveil: false, noBottom: true, mayShuffle: !!e.mayShuffle }
        return true
      }
      case 'lookAtTop': {
        // "Look at / reveal the top N cards of your library. Put [up to M | any number
        // of | all] [filter] cards from among them into your hand and the rest into
        // your graveyard / on the bottom" (Lead the Stampede, Malevolent Rumble,
        // Winding Way — which first chooses creature or land: `chooseType`).
        const pid = source.controller
        const top = zone(s, 'library', pid).slice(0, e.amount)
        if (top.length === 0) return false
        if (e.reveal) this._log(`${this._nameOf(pid)} reveals ${top.map((c) => this._objName(s.objects[c])).join(', ')}`)
        s.pending = {
          kind: 'lookTop',
          player: pid,
          cards: [...top],
          revealed: !!e.reveal,
          chooseType: e.chooseType || null, // ['Creature', 'Land']: pick a type, all of it goes to hand
          max: e.pick ? e.pick.max ?? top.length : 0, // how many may be taken
          filter: e.pick?.filter || null,
          to: e.pick?.to || 'hand',
          rest: e.rest || 'graveyard' // 'graveyard' | 'bottom' | 'top'
        }
        return true
      }
      case 'putBack': {
        // Brainstorm: "put N cards from your hand on top of your library in any order".
        const pid = source.controller
        const hand = zone(s, 'hand', pid)
        if (hand.length === 0) return false
        s.pending = { kind: 'putBack', player: pid, hand: [...hand], count: Math.min(e.amount || 1, hand.length) }
        return true
      }
      case 'counterUnlessPay': {
        // "Counter target spell unless its controller pays {N}" (Mana Tithe): the
        // spell's controller decides; declining counters it.
        const t = this._resolveTargetRef(source, e.to || 'target0')
        if (t?.kind !== 'object' || t.obj.zoneName !== 'stack') return false
        const payer = t.obj.controller
        s.pending = {
          kind: 'mayPay',
          player: payer,
          cost: e.cost,
          life: null,
          canPay: this._canPay(payer, parseManaCost(e.cost)),
          reason: `or ${this._objName(t.obj)} is countered`,
          _source: source,
          _effect: [],
          _else: [{ op: 'counter', to: e.to || 'target0' }]
        }
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
          reveal: !!e.reveal, // "reveal it": the log names the card
          count: e.count || 1, // "up to three cards named …" — taken together
          // Searching a library means looking through all of it (701.19a), so
          // the whole thing is offered — the interface shows it sorted rather
          // than in library order, which would leak the shuffle.
          library: [...zone(s, 'library', pid)],
          shuffle: true
        }
        return true
      }
      case 'optionalPay': {
        // "You may pay {cost}. If you do, <effect>." (e.g. Nihil Spellbomb.) With
        // `elseEffect`: "…unless you pay" (echo: sacrifice). `life`: pay life instead.
        const pid = source.controller
        s.pending = {
          kind: 'mayPay',
          player: pid,
          cost: e.life ? `${e.life} life` : e.cost,
          life: e.life || null,
          canPay: e.life ? s.players[pid].life > e.life : this._canPay(pid, parseManaCost(e.cost)),
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
        // Extract a Confession: with evidence collected, "a creature with the greatest power".
        const src = s.objects[source.oid ?? source.sourceOid]
        const greatest = !!(e.greatestPowerIfEvidence && src?.evidenceCollected)
        return this._nextSacrificeChoice(queue, e.filter || { types: ['Creature'] }, e.count || 1, greatest ? { greatestPower: true } : null)
      }
      case 'chooseOption': {
        // "…its owner puts it second from the top or on the bottom" (Deem Inferior):
        // the target's owner (or the controller) picks; remembered on the source.
        const t = e.to ? this._resolveTargetRef(source, e.to) : null
        const pid = t?.kind === 'object' ? t.obj.owner : source.controller
        s.pending = { kind: 'chooseValue', player: pid, options: [...e.options], label: e.label || 'Choose', _holder: source }
        return true
      }
      case 'graveyardChoose': {
        // Relic of Progenitus: "target player exiles a card from their graveyard" —
        // that player picks one (a search over their graveyard, to exile).
        const pid = this._resolvePlayerRef(source, e.to || 'target0')
        const cards = [...zone(s, 'graveyard', pid)]
        if (!cards.length) return false
        s.pending = { kind: 'search', player: pid, cards, to: 'exile', tapped: false, optional: false, shuffle: false, revealed: true }
        return true
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
        // With `elseSacrificeSelf`, declining sacrifices the source instead (Glint
        // Hawk: "sacrifice it unless you return an artifact you control").
        const pid = this._resolvePlayerRef(source, e.to || 'controller')
        const opts = { action: 'bounce' }
        if (e.elseSacrificeSelf) {
          opts.elseSacrificeSelf = source.sourceOid
          opts.optional = true
        }
        const started = this._nextSacrificeChoice([pid], e.filter || {}, 1, opts)
        // Nothing to return: the source is sacrificed straight away.
        if (!started && e.elseSacrificeSelf) {
          const self = s.objects[source.sourceOid]
          if (self?.zoneName === 'battlefield') this._sacrifice(self)
        }
        return started
      }
      case 'ringTempt':
        // "The Ring tempts you" (701.54): may pause to choose a Ring-bearer.
        return this._ringTempt(this._resolvePlayerRef(source, e.to || 'controller'))
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
  },

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
          // "Creatures target player controls" (Arms of Hadar): the controller is
          // whichever player a target names.
          const refPid = f.controller?.startsWith?.('target') ? this._resolvePlayerRef(source, f.controller) : null
          const targets = objectsIn(s, 'battlefield')
            .filter(
              (o) =>
                (refPid == null || o.controller === refPid) &&
                (f.controller !== 'you' || o.controller === source.controller) &&
                (f.controller !== 'opponent' || o.controller !== source.controller) &&
                (!f.type || o.chars.types.includes(f.type)) &&
                (!f.subtype || hasSub(o.chars, f.subtype)) &&
                (!f.color || (o.chars.colors || []).includes(f.color)) &&
                (!f.excludeColor || !(o.chars.colors || []).includes(f.excludeColor)) // "nonwhite creatures" (Holy Light)
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
        case 'addMana': {
          // 'chosen': the colour picked when the ability was activated (Chromatic Star).
          const c = e.mana === 'chosen' ? source._color : e.mana
          if (c) s.players[source.controller].manaPool[c]++
          break
        }
        case 'draw':
          this.draw(source.controller, e.amount || 1)
          break
        case 'gainLife':
          // `to` names who gains ("its controller gains 4 life"); default is you.
          this._gainLife(e.to ? this._resolvePlayerRef(source, e.to) : source.controller, this._amount(source, e.amount))
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
          // Damage to each permanent matching a filter (e.g. every creature) — and,
          // with `players: 'opponents'`, to each opponent too (End the Festivities).
          if (e.players === 'opponents') for (const pid of this._opponentsOf(source.controller)) this._dealDamage(source, { player: pid }, this._amount(source, e.amount))
          // "…to each creature and each player" (Pestilence): one event, everyone.
          if (e.players === 'all') for (const p of s.players) if (!p.hasLost) this._dealDamage(source, { player: p.id }, this._amount(source, e.amount))
          for (const oid of [...zone(s, 'battlefield')]) {
            const t = s.objects[oid]
            if (!t) continue
            if (e.filter === 'creature' && !t.chars.types.includes('Creature')) continue
            if (e.filter === 'creatureOrPlaneswalker' && !t.chars.types.includes('Creature') && !t.chars.types.includes('Planeswalker')) continue
            if (e.excludeSubtype && hasSub(t.chars, e.excludeSubtype)) continue // "each non-Dragon creature"
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
          if (e.ifColor && !(t?.obj?.chars?.colors || []).includes(e.ifColor)) break // "if it's blue" (Pyroblast)
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield' && !this._hasKW(t.obj, 'Indestructible'))
            if (e.noRegen || !this._tryRegenerate(t.obj)) this._bury(t.obj) // "It can't be regenerated" (Terminate)
          break
        }
        case 'exile': {
          // Exile the target (a permanent, or a card in a graveyard — Faerie Macabre).
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && (t.obj.zoneName === 'battlefield' || t.obj.zoneName === 'graveyard')) {
            this._log(`${this._objName(t.obj)} is exiled`)
            this._relocate(t.obj, 'exile')
          }
          break
        }
        case 'createTokenForOpponent': {
          // A promised gift (Sazacap's Brew): the opponent gets the token, tapped.
          const opp = this._opponentsOf(source.controller)[0]
          if (opp == null) break
          const before = new Set(zone(s, 'battlefield'))
          this._log(`${this._nameOf(opp)} receives the gift: a ${e.token.name} token`)
          this._createTokens(e.token, opp, 1)
          if (e.tapped) for (const oid of zone(s, 'battlefield')) if (!before.has(oid)) s.objects[oid].status.tapped = true
          break
        }
        case 'exileAllGraveyards':
          for (const p of s.players) for (const oid of [...zone(s, 'graveyard', p.id)]) moveObject(s, oid, 'exile')
          this._log('all graveyards are exiled')
          break
        case 'ruleModUntilEndOfTurn':
          // "Damage can't be prevented this turn" (Flaring Pain): a floating rule modifier.
          s.continuous.push({ timestamp: ++s.tsCounter, ruleMod: e.mod, duration: 'eot', owner: source.controller, controller: source.controller })
          break
        case 'skipNextUntap': {
          // "It doesn't untap during its controller's next untap step" (Sleep of the Dead).
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object') t.obj.status.skipUntap = true
          break
        }
        case 'putIntoLibrary': {
          // Deem Inferior: the owner chose (chooseOption) second from the top or the bottom.
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind !== 'object' || t.obj.zoneName !== 'battlefield') break
          const o = t.obj
          const bottom = source.chosen === 'Bottom of library'
          this._log(`${this._objName(o)} is put into its owner's library (${bottom ? 'on the bottom' : 'second from the top'})`)
          this._relocate(o, 'library')
          const lib = s.zones[zoneKey('library', o.owner)]
          const at = lib.indexOf(o.oid)
          if (at >= 0) lib.splice(at, 1)
          if (bottom) lib.push(o.oid)
          else lib.splice(Math.min(1, lib.length), 0, o.oid)
          break
        }
        case 'revealTopTransform': {
          // Delver of Secrets: look at the top card; if it's an instant or sorcery,
          // reveal it and transform. (Revealing is always the right call.)
          const pid = source.controller
          const top = s.objects[zone(s, 'library', pid)[0]]
          if (!top) break
          const hit = (e.types || ['Instant', 'Sorcery']).some((t) => top.printed.types.includes(t))
          const self = s.objects[source.sourceOid]
          if (hit && self && self.zoneName === 'battlefield' && self.faces?.length > 1) {
            this._log(`${this._nameOf(pid)} reveals ${this._objName(top)}: ${this._objName(self)} transforms`)
            this._runEffects(source, [{ op: 'transform', to: 'self' }])
          }
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
            if (e.ifColor && !(t.obj.printed.colors || []).includes(e.ifColor)) break // "if it's blue" (Pyroblast)
            // "…if its mana value is N or less" (Prohibit: 2, or 4 if kicked).
            const lim = e.ifKicked && source.kicked ? e.ifKicked.maxMv : e.maxMv
            if (typeof lim === 'number' && (t.obj.printed.manaValue || 0) > lim) break
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
              grantKeywords: e.keywords ? [...e.keywords] : [e.keyword],
              duration: e.duration || 'eot',
              owner: source.controller
            })
          break
        }
        case 'returnSelfFromGraveyard': {
          // "{2}{G}: Return this card from your graveyard to your hand."
          const o = s.objects[source.sourceOid]
          if (o?.zoneName === 'graveyard') {
            this._log(`${this._objName(o)} returns to its owner's hand`)
            this._relocate(o, 'hand')
          }
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
          const before = new Set(zone(s, 'battlefield'))
          this._createTokens(def, source.controller, n)
          // Job select (Black Mage's Rod): "…then attach this to it".
          if (e.attachSelf) {
            const made = zone(s, 'battlefield').filter((oid) => !before.has(oid))
            const src = s.objects[source.sourceOid]
            if (src && made.length) src.status.attachedTo = made[0]
          }
          break
        }
        case 'becomeDay':
          this._becomeDayNight('day')
          break
        case 'becomeNight':
          this._becomeDayNight('night')
          break
        case 'levelUp': {
          // A Class gains a level (716.2): its higher-level abilities switch on.
          const o = s.objects[source.sourceOid]
          if (!o || o.zoneName !== 'battlefield') break
          o.status.classLevel = e.level
          this._log(`${this._objName(o)} becomes level ${e.level}`)
          this._fireTriggers('becomesLevel', o, { level: e.level })
          break
        }
        case 'sacrificeAtEndOfCombat': {
          // The Ring, level 3: the creature blocking your Ring-bearer is sacrificed
          // at end of combat (a delayed trigger controlled by its controller).
          const other = source.extra?.other
          if (other?.oid) s.delayedTriggers.push({ event: 'endCombat', controller: other.controller, sourceOid: null, effect: [{ op: 'sacrificeOid', oid: other.oid }] })
          break
        }
        case 'sacrificeOid': {
          const o = s.objects[e.oid]
          if (o?.zoneName === 'battlefield') this._sacrifice(o)
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
            else if (e.until === 'endOfTurn') o.playableUntilTurn = s.turnNumber // Experimental Synthesizer
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
          // `of: 'self'` — the source shuffles itself away; otherwise a target
          // permanent's owner shuffles it into their library (Deglamer).
          let o = null
          if (e.of === 'self') o = s.objects[source.sourceOid]
          else {
            const t = this._resolveTargetRef(source, e.to || 'target0')
            if (t?.kind === 'object') o = t.obj
          }
          if (o) {
            this._log(`${this._objName(o)} is shuffled into its owner's library`)
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
        case 'exileLinked': {
          // Journey to Nowhere: exile the target and remember it on the source
          // permanent, so `returnLinked` can bring it back when the source leaves.
          const t = this._resolveTargetRef(source, e.to)
          const src = s.objects[source.sourceOid]
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield' && src) {
            this._log(`${this._objName(t.obj)} is exiled by ${this._objName(src)}`)
            this._relocate(t.obj, 'exile')
            ;(src.linkedExile ||= []).push(t.obj.oid)
          }
          break
        }
        case 'blink': {
          // "Exile target permanent, then return it to the battlefield" (Ephemerate,
          // Ghostly Flicker): it comes back as a new object, so ETB triggers fire.
          for (const ref of e.each ? source.targets || [] : [source.targets?.[Number((e.to || 'target0').slice(6))]]) {
            if (ref?.kind !== 'object') continue
            const o = s.objects[ref.oid]
            if (!o || o.zoneName !== 'battlefield') continue
            const owner = o.owner
            moveObject(s, o.oid, 'exile')
            moveObject(s, o.oid, 'battlefield')
            this._enterBattlefield(o, owner)
            this._log(`${this._objName(o)} is exiled and returns`)
          }
          break
        }
        case 'returnSelfToBattlefield': {
          // "Return this card from your graveyard to the battlefield" (Cauldron
          // Familiar) — untapped, unlike returnSelfTapped.
          const o = s.objects[source.sourceOid]
          if (o && o.zoneName === 'graveyard') {
            moveObject(s, o.oid, 'battlefield')
            this._enterBattlefield(o, o.owner)
            this._log(`${this._objName(o)} returns to the battlefield`)
          }
          break
        }
        case 'returnGraveyardTarget': {
          // "Return target instant or sorcery card from your graveyard to your
          // hand" (Archaeomancer): a real target, chosen when the ability goes on
          // the stack, so it can fizzle if the card leaves in response.
          const t = source.targets?.[Number((e.to || 'target0').slice(6))]
          const o = t?.oid ? s.objects[t.oid] : null
          if (o && o.zoneName === 'graveyard') {
            this._log(`${this._objName(o)} returns to its owner's hand`)
            this._relocate(o, 'hand')
          }
          break
        }
        case 'graveyardToTop': {
          // "You may put target creature card from your graveyard on top of your
          // library" (Mortuary Mire).
          const t = source.targets?.[0]
          const o = t?.oid ? s.objects[t.oid] : null
          if (o && o.zoneName === 'graveyard') {
            moveObject(s, o.oid, 'library', { toTop: true })
            this._log(`${this._objName(o)} goes on top of its owner's library`)
          }
          break
        }
        case 'skipNextCombat': {
          // "Target opponent skips their next combat phase" (Stonehorn Dignitary).
          const pid = this._resolvePlayerRef(source, e.to || 'target0')
          s.players[pid].skipCombats = (s.players[pid].skipCombats || 0) + 1
          this._log(`${this._nameOf(pid)} will skip their next combat phase`)
          break
        }
        case 'returnSelfTransformed': {
          // Craft (702.171): the exiled artifact returns transformed.
          const o = s.objects[source.sourceOid]
          if (o && o.faces?.length > 1) {
            moveObject(s, o.oid, 'battlefield')
            setFace(o, 1)
            this._enterBattlefield(o, o.owner)
            this._log(`${this._objName(o)} returns transformed`)
          }
          break
        }
        case 'returnLinked': {
          // "…return the exiled card to the battlefield under its owner's control."
          const src = s.objects[source.sourceOid]
          for (const oid of src?.linkedExile || []) {
            const o = s.objects[oid]
            if (!o || o.zoneName !== 'exile') continue
            this._log(`${this._objName(o)} returns to the battlefield`)
            moveObject(s, oid, 'battlefield')
            this._enterBattlefield(o, o.owner)
          }
          if (src) src.linkedExile = []
          break
        }
        case 'untap': {
          const t = this._resolveTargetRef(source, e.to)
          if (t?.kind === 'object' && t.obj.zoneName === 'battlefield') this._setTapped(t.obj, false)
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
        case 'createEmblem':
          this._makeEmblem(source.controller, e)
          break
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
  },

  // Resolve a player reference in an effect: 'controller' or 'target<i>' (the
  // controller of that target).
  _resolvePlayerRef(source, ref) {
    if (ref?.startsWith?.('target')) {
      const t = source.targets?.[Number(ref.slice('target'.length))]
      if (t?.kind === 'player') return t.pid
      if (t?.oid) return this.state.objects[t.oid]?.controller ?? source.controller
    }
    return source.controller
  },

  _matchCardFilter(o, filter) {
    if (!filter) return true
    const p = o.printed
    if (filter.supertype && !p.supertypes.includes(filter.supertype)) return false
    if (filter.type && !p.types.includes(filter.type)) return false
    if (filter.types && !filter.types.some((t) => p.types.includes(t))) return false
    if (filter.subtype && !p.subtypes.includes(filter.subtype)) return false
    if (filter.subtypes && !filter.subtypes.some((t) => p.subtypes.includes(t))) return false
    if (filter.permanent && !isPermanent(p)) return false
    if (filter.maxPower != null && (p.power == null || Number(p.power) > filter.maxPower)) return false // "with power 2 or less"
    if (filter.maxMV != null && p.manaValue > filter.maxMV) return false
    if (filter.nonland && p.types.includes('Land')) return false
    if (filter.noncreature && p.types.includes('Creature')) return false
    return true
  },

  _applyMayPay(pending, answer) {
    if (answer?.pay && pending.canPay) {
      if (pending.life) {
        this.state.players[pending.player].life -= pending.life
        this._log(`${this._nameOf(pending.player)} pays ${pending.life} life`)
      } else this._pay(pending.player, parseManaCost(pending.cost))
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
  },

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
    if (declined && pending.elseSacrificeSelf) {
      const self = s.objects[pending.elseSacrificeSelf]
      if (self?.zoneName === 'battlefield') this._sacrifice(self)
    }
    if (declined && pending.elseLoseLife) {
      this._loseLife(pending.player, pending.elseLoseLife)
      this._log(`${this._nameOf(pending.player)} loses ${pending.elseLoseLife} life (${s.players[pending.player].life})`)
    }
    if (!this._nextSacrificeChoice(pending._queue, pending._filter, pending.count, pending._opts)) this._resumeResolution()
  },

  // Present the next player in `queue` who has something to sacrifice. Returns
  // true if a decision was set up. With `opts.elseLoseLife` the sacrifice is a
  // choice ("unless they sacrifice…"): declining, or having nothing to
  // sacrifice, costs that much life instead.
  _nextSacrificeChoice(queue, filter, count, opts = null) {
    const s = this.state
    while (queue?.length) {
      const pid = queue.shift()
      let choices = objectsIn(s, 'battlefield')
        .filter((o) => o.controller === pid && this._sacMatches(o, filter || {}))
        .map((o) => o.oid)
      if (opts?.greatestPower && choices.length) {
        const top = Math.max(...choices.map((oid) => s.objects[oid].chars.power || 0))
        choices = choices.filter((oid) => (s.objects[oid].chars.power || 0) === top)
      }
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
        optional: !!(opts?.elseLoseLife || opts?.optional),
        elseLoseLife: opts?.elseLoseLife || 0,
        elseSacrificeSelf: opts?.elseSacrificeSelf || null, // declined: sacrifice the source
        action: opts?.action || 'sacrifice', // what happens to the chosen permanent(s)
        _queue: queue,
        _filter: filter,
        _opts: opts
      }
      return true
    }
    return false
  },

  // Players in APNAP order (the active player first, then seat order), skipping
  // anyone who has left the game.
  _apnap() {
    const s = this.state
    const n = s.players.length
    return Array.from({ length: n }, (_, i) => (s.activePlayer + i) % n).filter((pid) => !s.players[pid].hasLost)
  },

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
  },

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
  },

  // Move a searched card to its destination and shuffle the library.
  _applySearch(pending, answer) {
    const s = this.state
    const pid = pending.player
    const pick = answer?.pick
    // "Search your library for up to N cards named X" (Squadron Hawk): the pick
    // brings its namesakes along.
    if (pick && (pending.count || 1) > 1 && pending.cards.includes(pick)) {
      const name = s.objects[pick].printed.name
      const take = pending.cards.filter((oid) => s.objects[oid].printed.name === name).slice(0, pending.count)
      for (const oid of take) moveObject(s, oid, pending.to)
      this._log(`${this._nameOf(pid)} puts ${take.length} ${name} into their hand`)
      if (pending.shuffle) s.zones[zoneKey('library', pid)] = s.rng.shuffle(s.zones[zoneKey('library', pid)])
      this._resumeResolution()
      return
    }
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
      // A revealed search (typecycling: "reveal it") names the card.
      const shown = pending.to !== 'hand' || pending.reveal ? this._objName(o) : 'a card'
      this._log(`${this._nameOf(pid)} puts ${shown} ${pending.to === 'hand' ? 'into their hand' : 'onto the battlefield'}`)
    }
    if (pending.shuffle) s.zones[zoneKey('library', pid)] = s.rng.shuffle(s.zones[zoneKey('library', pid)])
    this._resumeResolution()
  },

  // Look-at-the-top-N: `picks` (up to `max`, matching the filter — or, with
  // `chooseType`, every card of the chosen type) go to `to`; the rest go to the
  // graveyard, the bottom, or back on top in their current order.
  _applyLookTop(pending, answer) {
    const s = this.state
    const pid = pending.player
    const lib = s.zones[zoneKey('library', pid)]
    let picks
    if (pending.chooseType) {
      const type = pending.chooseType.includes(answer?.type) ? answer.type : pending.chooseType[0]
      this._log(`${this._nameOf(pid)} chooses ${type.toLowerCase()}`)
      picks = pending.cards.filter((oid) => s.objects[oid].printed.types.includes(type))
    } else {
      picks = [...new Set((answer?.picks || []).filter((oid) => pending.cards.includes(oid)))]
      if (picks.length > pending.max) throw new Error(`choose at most ${pending.max} card(s)`)
      if (pending.filter && picks.some((oid) => !this._matchCardFilter(s.objects[oid], pending.filter))) throw new Error('that card is not one you may take')
    }
    for (const oid of pending.cards) {
      const i = lib.indexOf(oid)
      if (i >= 0) lib.splice(i, 1)
    }
    for (const oid of picks) {
      moveObject(s, oid, pending.to)
      this._log(`${this._nameOf(pid)} puts ${pending.revealed || pending.to !== 'hand' ? this._objName(s.objects[oid]) : 'a card'} ${pending.to === 'hand' ? 'into their hand' : 'onto the battlefield'}`)
      if (pending.to === 'battlefield') this._enterBattlefield(s.objects[oid], pid)
    }
    const rest = pending.cards.filter((oid) => !picks.includes(oid))
    if (pending.rest === 'graveyard') for (const oid of rest) this._relocate(s.objects[oid], 'graveyard')
    else if (pending.rest === 'bottom') for (const oid of rest) lib.push(oid)
    else for (let i = rest.length - 1; i >= 0; i--) lib.unshift(rest[i])
    if (rest.length) this._log(`${this._nameOf(pid)} puts ${rest.length} card${rest.length === 1 ? '' : 's'} ${pending.rest === 'graveyard' ? 'into their graveyard' : pending.rest === 'bottom' ? 'on the bottom of their library' : 'back on top'}`)
    this._resumeResolution()
  },

  // Brainstorm: `cards` (exactly `count`, from hand) go on top, first one on top.
  _applyPutBack(pending, answer) {
    const s = this.state
    const pid = pending.player
    const cards = Array.isArray(answer?.cards) ? answer.cards : []
    const hand = zone(s, 'hand', pid)
    if (cards.length !== pending.count || new Set(cards).size !== cards.length || cards.some((oid) => !hand.includes(oid)))
      throw new Error(`choose ${pending.count} card(s) from your hand`)
    for (let i = cards.length - 1; i >= 0; i--) {
      moveObject(s, cards[i], 'library')
      const lib = s.zones[zoneKey('library', pid)]
      const at = lib.indexOf(cards[i])
      if (at > 0) {
        lib.splice(at, 1)
        lib.unshift(cards[i])
      }
    }
    this._log(`${this._nameOf(pid)} puts ${cards.length} card${cards.length === 1 ? '' : 's'} from their hand on top of their library`)
    this._resumeResolution()
  },

  _resolveTargetRef(source, ref) {
    // 'self' — the source permanent of an activated/triggered ability.
    if (ref === 'self') {
      const obj = this.state.objects[source.sourceOid]
      return obj ? { kind: 'object', obj } : null
    }
    if (ref === 'activePlayer') return { kind: 'player', pid: this.state.activePlayer }
    // 'subject' — the object a triggered ability triggered on ("whenever a creature
    // you control attacks alone, it gets…").
    if (ref === 'subject') {
      const obj = this.state.objects[source.subjectOid]
      return obj ? { kind: 'object', obj } : null
    }
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
    // A "target card in a graveyard" stays legal in the graveyard (Faerie Macabre).
    const specs = source.kind === 'ability' ? source.targetSpecs || [] : source.printed ? this._spellTargets(source) : []
    const gy = specs.some((sp) => sp.type === 'graveyardCard')
    if (!this._targetStillLegal(source.controller, colors, t, gy)) return null
    if (t.kind === 'player') return { kind: 'player', pid: t.pid }
    return { kind: 'object', obj: this.state.objects[t.oid] }
  },

}
