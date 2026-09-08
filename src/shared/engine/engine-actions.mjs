// Actions methods of GameEngine — split out of engine.mjs for size; mixed into
// GameEngine.prototype by engine.mjs. Same `this`, same rules references.

import { createState, createObject, createAbility, computeChars, zone, zoneKey, moveObject, objectsIn, setFace } from './state.mjs'
import { manaAbilityColors, loadBehavior } from './behaviors.mjs'
import { isPermanent, parseManaCost, manaValue, BASIC_LAND_MANA } from './cards.mjs'
import { recompute, matchStatic, hasSub } from './layers.mjs'
import { DUNGEONS, REGULAR_DUNGEONS, roomOf } from './dungeons.mjs'
import { STEP_ORDER, PRIORITY_STEPS, MAIN_STEPS, tags, addCosts } from './engineShared.mjs'

export const actionsMethods = {
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
        const land = s.objects[action.oid]
        this._log(`${this._nameOf(pid)} plays ${this._objName(land)}`)
        s.players[pid].landsPlayed++
        // "As this land enters, choose a color" (the Gates): ask first; the land
        // enters when the choice is made (_applyChooseValue), and priority waits.
        const ch = land.behavior?.chooseOnEnter
        if (ch && ch.kind !== 'cardName' && land.chosen == null) {
          this._castPaused = true
          s.pending = { kind: 'chooseValue', player: pid, oid: land.oid, options: this._chooseOptions(ch), label: ch.label || this._chooseValueLabel(land, ch) }
          break
        }
        moveObject(s, action.oid, 'battlefield')
        this._enterBattlefield(land, pid)
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
        // Typecycling (702.29c): search for a card of the type instead of drawing.
        const effect = cyc.search ? [{ op: 'search', filter: cyc.search, to: 'hand', reveal: true }] : [{ op: 'draw', amount: 1 }]
        const aoid = createAbility(s, { controller: pid, sourceOid: o.oid, effect, targets: [] })
        zone(s, 'stack').push(aoid.oid)
        break
      }
      case 'tapForMana': {
        // A {T} mana ability (605.3): no stack; the mana goes straight into the
        // pool, where _pay spends it before tapping anything else.
        const o = s.objects[action.oid]
        const opts = this._manaOptionsOf(o)
        const m = opts[action.option ?? 0] || opts[0]
        if (!m) throw new Error('this permanent has no mana ability')
        this._setTapped(o, true)
        if (m.pips) {
          for (const c of m.pips) s.players[pid].manaPool[c]++ // a fixed set ({R}{W})
        } else {
          const color = m.colors.length === 1 ? m.colors[0] : action.color
          if (!m.colors.includes(color)) throw new Error('choose a color this permanent can produce')
          for (let i = 0; i < (m.amount || 1); i++) {
            if (m.only) (s.players[pid].restrictedPool ||= []).push({ color, only: m.only, source: o })
            else s.players[pid].manaPool[color]++
          }
        }
        for (const c of m.extra || []) s.players[pid].manaPool[c]++ // an attached Aura's bonus
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
          if (alt.payLife) {
            s.players[pid].life -= alt.payLife
            this._log(`${this._nameOf(pid)} pays ${alt.payLife} life`)
          }
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
          // Evoke (702.74) / overload (702.96) / mutate (702.140) replace the
          // mana cost entirely — but cost reductions still apply to what is left.
          const alt = action.evoke
            ? o.behavior.evoke.cost
            : action.overload
              ? o.behavior.overload.cost
              : action.mutate
                ? o.behavior.mutate.cost
                : null
          let cost = this._effectiveCost(pid, o, o.printed, alt ? parseManaCost(alt) : null)
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
          if ((addl?.sacrifice || action.bargain) && action.sacrifice) {
            const so = s.objects[action.sacrifice]
            if (so && so.controller === pid && so.zoneName === 'battlefield') {
              o._sacrificedMV = so.printed.manaValue
              o._sacrificedPower = so.chars?.power ?? so.printed.power ?? 0
              this._sacrifice(so)
            }
          }
          // "Choose a creature you control or reveal a creature card from your hand":
          // neither leaves its zone; the biggest power is what the spell uses.
          if (addl?.revealOrChooseCreature) {
            const onBoard = objectsIn(s, 'battlefield').filter((x) => x.controller === pid && x.chars.types.includes('Creature'))
            const inHand = zone(s, 'hand', pid)
              .map((h) => s.objects[h])
              .filter((x) => x.oid !== o.oid && x.printed.types.includes('Creature'))
            const best = [...onBoard, ...inHand].sort((a, b) => (b.chars?.power ?? b.printed.power ?? 0) - (a.chars?.power ?? a.printed.power ?? 0))[0]
            if (best) {
              o._revealedPower = best.chars?.power ?? best.printed.power ?? 0
              this._log(`${this._nameOf(pid)} ${onBoard.includes(best) ? 'chooses' : 'reveals'} ${this._objName(best)} (power ${o._revealedPower})`)
            }
          }
          // Collect evidence N (702.167): exile graveyard cards totalling N+ mana value.
          if (action.evidence && addl?.evidence) {
            const picked = this._evidenceCards(pid, addl.evidence)
            for (const eo of picked) this._relocate(eo, 'exile')
            this._log(`${this._nameOf(pid)} collects evidence: exiles ${picked.map((eo) => this._objName(eo)).join(', ')}`)
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
        o.bargained = !!(action.bargain && action.sacrifice) // "if it was bargained"
        o.gifted = !!action.gift // "if the gift was promised"
        o.evidenceCollected = !!action.evidence
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
      case 'unlockDoor': {
        // A Room's locked door: pay its mana cost as a sorcery to unlock it.
        const o = s.objects[action.oid]
        this._pay(pid, o.faces[action.face].manaCost, [], null, o.faces[action.face])
        o.unlocked = [...(o.unlocked || []), action.face]
        this._refreshRoom(o)
        this._log(`${this._nameOf(pid)} unlocks ${o.faces[action.face].name}`)
        this._unlockTrigger(o, action.face)
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
      case 'embalm': {
        // Embalm (702.87): exile the card, create a token copy that's a white
        // Zombie of its creature types with no mana cost.
        const o = s.objects[action.oid]
        this._pay(pid, parseManaCost(o.behavior.embalm.cost))
        this._log(`${this._nameOf(pid)} embalms ${this._objName(o)}`)
        const p = o.printed
        this._createTokens(
          {
            name: p.name,
            types: [...p.types],
            subtypes: [...new Set(['Zombie', ...p.subtypes])],
            colors: ['W'],
            power: p.power,
            toughness: p.toughness,
            keywords: [...(p.keywords || [])]
          },
          pid,
          1
        )
        this._relocate(o, 'exile')
        break
      }
      case 'castEscape': {
        // Escape (702.138): pay the escape cost and exile N other graveyard cards
        // (the least valuable first); the spell is cast from the graveyard.
        const o = s.objects[action.oid]
        const esc = o.behavior.escape
        this._pay(pid, parseManaCost(esc.cost))
        const others = zone(s, 'graveyard', pid)
          .filter((x) => x !== o.oid)
          .map((x) => s.objects[x])
          .sort((a, b) => (a.printed.manaValue || 0) - (b.printed.manaValue || 0))
          .slice(0, esc.exile)
        for (const eo of others) this._relocate(eo, 'exile')
        moveObject(s, action.oid, 'stack')
        o.controller = pid
        o.targets = action.targets || []
        o.spell = o.behavior.spell
        this._log(`${this._nameOf(pid)} casts ${this._objName(o)} with escape${this._describeTargets(o.targets)} (exiling ${others.map((eo) => this._objName(eo)).join(', ')})`)
        this._countSpellCast(o)
        this._fireTriggers('castSpell', o)
        this._checkWard(o.oid, o.controller, o.targets)
        break
      }
      case 'castFlashback': {
        const o = s.objects[action.oid]
        const fb = o.behavior.flashback
        if (fb.cost) this._pay(pid, parseManaCost(fb.cost))
        if (fb.life) {
          s.players[pid].life -= fb.life
          this._log(`${this._nameOf(pid)} pays ${fb.life} life`)
        }
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
        const sourceName = this._objName(o) // before costs: a sacrificed token is gone afterwards
        this._payActivationCost(pid, o, ab, action)
        if (ab.manaAbility) {
          // Mana abilities don't use the stack (605.3b): resolve immediately.
          this._runEffects({ controller: pid, sourceOid: o.oid, targets: [], _color: action.color || null }, ab.effect)
          break
        }
        this._log(`${this._nameOf(pid)} activates ${this._objName(o)}${this._describeTargets(action.targets)}`)
        // The ability exists on the stack independently of its source.
        const aoid = createAbility(s, {
          controller: pid,
          sourceOid: o.oid,
          sourceName,
          effect: ab.effect,
          targets: action.targets || [],
          targetSpecs: ab.targets || [], // for the fizzle re-check (graveyard-card targets stay legal there)
          xValue: action._xValue || 0 // X chosen for an {X} activation cost
        })
        zone(s, 'stack').push(aoid.oid)
        this._checkWard(aoid.oid, pid, aoid.targets)
        // A madness card discarded as a cost is offered now, above the ability.
        if (s.pendingMadness.length) {
          this._castPaused = true
          this._processMadness(() => {
            this._castPaused = false
            this._grantPriorityTo(pid)
          })
        }
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
  },

  // Storm counting (702.40): record how many spells were cast before this one
  // this turn, then count this cast.
  _countSpellCast(o) {
    const s = this.state
    s.spellsCastThisTurn = (s.spellsCastThisTurn || 0) + 1
    o._stormCount = s.spellsCastThisTurn - 1
    const p = s.players[o.controller]
    if (p) p.spellsThisTurn = (p.spellsThisTurn || 0) + 1 // day/night (731.5)
  },

  // Can `pid` currently pay ability `ab`'s activation cost with source `o`?
  // Can `pid` pay an ability's costs? Used for abilities whose source is not on
  // the battlefield (hand / graveyard), where the battlefield checks don't apply.
  _canPayAbilityCost(pid, o, ab) {
    const s = this.state
    const cost = ab.cost || {}
    if (cost.mana && !this._canPay(pid, parseManaCost(cost.mana))) return false
    if (cost.payLife != null && s.players[pid].life <= cost.payLife) return false
    if (cost.discard && zone(s, 'hand', pid).filter((h) => h !== o.oid).length < cost.discard) return false
    if (cost.sacrificeOther && !objectsIn(s, 'battlefield').some((x) => x.controller === pid && x.oid !== o.oid && this._sacMatches(x, cost.sacrificeOther))) return false
    if (cost.bounceOwn && !objectsIn(s, 'battlefield').some((x) => x.controller === pid && x.oid !== o.oid && this._sacMatches(x, cost.bounceOwn))) return false
    if (cost.tapOther && !objectsIn(s, 'battlefield').some((x) => x.controller === pid && x.oid !== o.oid && !x.status.tapped && this._sacMatches(x, cost.tapOther))) return false
    return true
  },

  _canActivate(pid, o, ab) {
    const s = this.state
    if (ab.fromGraveyard || ab.fromHand) return true // legality checked where they're offered
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
    if (ab.if && !this._cond(ab.if, o)) return false // a Class level's ability, "as long as…"
    // "Activated abilities of sources with the chosen name can't be activated
    // unless they're mana abilities" (Pithing Needle).
    if (!ab.manaAbility && this._ruleMods().some(({ source, mod }) => mod.cantActivate?.chosenName && this._nameMatches(o, source.chosen))) return false
    // The ability's source (the permanent `o`) supplies the colors for protection;
    // its controller is `pid`, so hexproof only blocks it against opponents.
    const actx = { byPid: pid, sourceColors: tags(o.chars || o.printed) }
    if (ab.targets?.length && !ab.targets.every((t) => this._legalTargetsExist(t, actx))) return false
    const cost = ab.cost || {}
    // Discard N as a cost needs that many cards in hand.
    if (cost.discard && zone(s, 'hand', pid).length < cost.discard) return false
    // "Tap an untapped Gate you control": one must be available.
    if (cost.tapOther && !objectsIn(s, 'battlefield').some((x) => x.controller === pid && x.oid !== o.oid && !x.status.tapped && this._sacMatches(x, cost.tapOther))) return false
    if (cost.bounceOwn && !objectsIn(s, 'battlefield').some((x) => x.controller === pid && x.oid !== o.oid && this._sacMatches(x, cost.bounceOwn))) return false
    if (cost.sacrificeOther && !objectsIn(s, 'battlefield').some((x) => x.controller === pid && x.oid !== o.oid && this._sacMatches(x, cost.sacrificeOther))) return false
    if (cost.exileCreature && !objectsIn(s, 'battlefield').some((x) => x.controller === pid && x.chars.types.includes('Creature')) && !zone(s, 'graveyard', pid).some((x) => s.objects[x].printed.types.includes('Creature'))) return false
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
  },

  // Permanents `pid` controls that match a sacrifice spec. A spec may use
  // { types: [...] }, { type }, and/or { subtype } (e.g. { subtype: 'Mountain' }).
  _sacrificeCandidates(pid, spec) {
    return objectsIn(this.state, 'battlefield').filter(
      (o) => o.controller === pid && this._sacMatches(o, spec)
    )
  },

  _sacMatches(o, spec) {
    if (spec.orToken && o.token) return true // "an artifact, enchantment, or token" (bargain)
    if (spec.types && !spec.types.some((t) => o.chars.types.includes(t))) return false
    if (spec.type && !o.chars.types.includes(spec.type)) return false
    if (spec.subtype && !hasSub(o.chars, spec.subtype)) return false
    return true
  },

  // Graveyard cards to exile for "collect evidence N": the biggest mana values
  // first, until the total reaches N; empty if the graveyard can't reach it.
  _evidenceCards(pid, n) {
    const cards = zone(this.state, 'graveyard', pid)
      .map((oid) => this.state.objects[oid])
      .sort((a, b) => (b.printed.manaValue || 0) - (a.printed.manaValue || 0))
    const out = []
    let total = 0
    for (const c of cards) {
      if (total >= n) break
      out.push(c)
      total += c.printed.manaValue || 0
    }
    return total >= n ? out : []
  },

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
    // "Return a Forest you control to its owner's hand" (Quirion Ranger).
    if (cost.bounceOwn) {
      const cand = objectsIn(s, 'battlefield').find((x) => x.controller === pid && x.oid !== o.oid && this._sacMatches(x, cost.bounceOwn))
      if (cand) {
        this._log(`${this._objName(cand)} returns to its owner's hand`)
        this._relocate(cand, 'hand')
      }
    }
    // "Sacrifice a Food" (Cauldron Familiar): another permanent pays.
    if (cost.sacrificeOther) {
      const cand = objectsIn(s, 'battlefield').find((x) => x.controller === pid && x.oid !== o.oid && this._sacMatches(x, cost.sacrificeOther))
      if (cand) this._sacrifice(cand)
    }
    // "Exile this artifact" as a cost (craft).
    if (cost.exileSelf) this._relocate(o, 'exile')
    // Craft also exiles a creature you control or one from your graveyard.
    if (cost.exileCreature) {
      const bf = objectsIn(s, 'battlefield').filter((x) => x.controller === pid && x.chars.types.includes('Creature'))
      const gy = zone(s, 'graveyard', pid).map((x) => s.objects[x]).filter((x) => x.printed.types.includes('Creature'))
      const cand = gy[0] || bf.sort((a, b) => (a.chars.power || 0) - (b.chars.power || 0))[0]
      if (cand) {
        this._log(`${this._nameOf(pid)} exiles ${this._objName(cand)}`)
        this._relocate(cand, 'exile')
      }
    }
    // "Tap an untapped Gate you control" (Heap Gate): another permanent pays.
    if (cost.tapOther) {
      const cand = objectsIn(s, 'battlefield').find(
        (x) => x.controller === pid && x.oid !== o.oid && !x.status.tapped && this._sacMatches(x, cost.tapOther)
      )
      if (cand) {
        this._setTapped(cand, true)
        this._log(`${this._nameOf(pid)} taps ${this._objName(cand)} to pay a cost`)
      }
    }
    if (cost.payLife != null) s.players[pid].life -= cost.payLife
    if (cost.energy) s.players[pid].counters.energy -= cost.energy
    if (cost.removeCounters) {
      const { counter, amount = 1 } = cost.removeCounters
      o.status.counters[counter] -= amount
      if (o.status.counters[counter] <= 0) delete o.status.counters[counter]
    }
    // "Discard this card:" — an ability activated from hand (Faerie Macabre).
    if (cost.discardSelf && o.zoneName === 'hand') this._discardCard(pid, o.oid)
    // "Reveal X white cards from your hand" (Martyr of Sands): X is however many there are.
    if (cost.revealX) {
      const n = zone(s, 'hand', pid).filter((h) => (s.objects[h].printed.colors || []).includes(cost.revealX.color)).length
      action._xValue = n
      this._log(`${this._nameOf(pid)} reveals ${n} ${cost.revealX.color === 'W' ? 'white' : cost.revealX.color} card${n === 1 ? '' : 's'}`)
    }
    // Discard as a cost (a Blood token): a discarded madness card is queued and
    // offered once the ability is on the stack.
    if (cost.discard && action.discard?.length) {
      for (const d of action.discard) if (zone(s, 'hand', pid).includes(d)) this._discardCard(pid, d)
    }
    if (cost.sacrifice === 'self') this._sacrifice(o)
    else if (cost.sacrifice && action.sacrifice) {
      const so = s.objects[action.sacrifice]
      if (so && so.controller === pid && so.zoneName === 'battlefield') this._sacrifice(so)
    }
  },

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
      // 731.7: a daybound permanent entering at night enters transformed.
      if (s.daytime === 'night' && this._isDaybound(o) && o.faces?.[1] && !o.face) setFace(o, 1)
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
          label: ch.label || this._chooseValueLabel(o, ch)
        }
        return
      }
      moveObject(s, oid, 'battlefield')
      this._enterBattlefield(o, o.controller ?? o.owner)
    } else {
      moveObject(s, oid, 'graveyard')
    }
  },

  // Permanents a "copy as it enters" effect may copy. Clone copies any creature;
  // the `except` clause could widen this (e.g. Phyrexian Metamorph adds artifacts).
  _copyChoices(o, cp) {
    const s = this.state
    return objectsIn(s, 'battlefield')
      .filter((t) => t.oid !== o.oid && this._copyable(t, cp))
      .map((t) => t.oid)
  },

  _copyable(t, cp) {
    if (cp.artifactOrCreature) return t.chars.types.includes('Creature') || t.chars.types.includes('Artifact')
    return t.chars.types.includes('Creature')
  },

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
  },

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
  },

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
  },

  // The options for an "as this enters, choose…" decision. For a creature type,
  // What an "as this enters, choose a…" prompt should say. The default used to
  // be "Choose a creature type" whatever the choice actually was, so Utopia
  // Sprawl — which chooses a colour — asked for a creature type while offering
  // the five colours.
  _chooseValueLabel(o, ch) {
    const what = ch.kind === 'color' ? 'color' : ch.kind === 'creatureType' ? 'creature type' : 'value'
    return `${this._objName(o)} — choose a ${what}`
  },

  // a common list plus every subtype already present in the game.
  _chooseOptions(ch) {
    if (ch.options) return [...ch.options]
    if (ch.kind === 'color') return ['W', 'U', 'B', 'R', 'G']
    const common = ['Goblin', 'Elf', 'Human', 'Zombie', 'Faerie', 'Soldier', 'Wizard', 'Warrior', 'Beast', 'Dragon', 'Angel', 'Vampire', 'Skeleton', 'Knight', 'Cleric']
    const present = new Set(common)
    for (const o of objectsIn(this.state, 'battlefield')) for (const st of o.chars?.subtypes || []) present.add(st)
    return [...present]
  },

  _applyChooseProtector(pending, answer) {
    const s = this.state
    const o = s.objects[pending.oid]
    const pick = pending.choices.find((c) => c.pid === answer?.pid)
    if (!pick) throw new Error('choose an opponent to protect the Siege')
    o.protectorChoice = pick.pid
    moveObject(s, pending.oid, 'battlefield')
    this._enterBattlefield(o, o.controller ?? o.owner)
    if (!this._resume) this._grantPriorityTo(s.activePlayer)
  },

  _applyChooseValue(pending, answer) {
    const s = this.state
    if (pending._triggerModes) {
      // A modal triggered ability's mode, chosen as it goes on the stack.
      const { trigger, choices } = pending._triggerModes
      const idx = Math.max(0, pending.options.indexOf(answer?.value))
      const pick = choices[idx] || choices[0]
      trigger.mode = pick.i
      trigger.effect = pick.m.effect
      trigger.targetSpec = pick.m.targets || []
      this._log(`${this._nameOf(pending.player)} chooses ${pick.m.label}`)
      s.pending = null
      this._advanceTriggerPlacement()
      return
    }
    if (pending._holder) {
      // A value chosen mid-resolution (Prismatic Strands' colour).
      pending._holder.chosen = pending.options.includes(answer?.value) ? answer.value : pending.options[0]
      this._log(`${this._nameOf(pending.player)} chooses ${pending._holder.chosen}`)
      this._resumeResolution()
      return
    }
    const o = s.objects[pending.oid]
    o.chosen = pending.options.includes(answer?.value) ? answer.value : pending.options[0]
    this._log(`${this._nameOf(pending.player)} chooses ${o.chosen}`)
    moveObject(s, pending.oid, 'battlefield')
    this._enterBattlefield(o, o.controller ?? o.owner)
    this._castPaused = false // a land played with a choice (the Gates) held priority back
    if (!this._resume) this._grantPriorityTo(s.activePlayer)
  },

  // Run a resolution's effects; if an interactive effect (e.g. scry) pauses it,
  // this._resume holds the continuation and _finishResolution runs after the
  // player's choice (see _applyScry). Returns true if it paused.
  _runResolution(source, effects) {
    const done = this._runEffectsFrom(source, effects, 0)
    if (done) this._finishResolution()
    return !done
  },

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
        // The card goes back rather than to the graveyard, which is the whole
        // point of an Omen — and the log said nothing about it, so the card
        // simply vanished off the stack.
        this._log(`${this._objName(o)} is shuffled into its owner's library (omen)`)
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
  },

  // Resume a paused resolution after an interactive effect's decision.
  _resumeResolution() {
    if (!this._resume) return
    const { source, effects, index } = this._resume
    this._resume = null
    const done = this._runEffectsFrom(source, effects, index)
    if (done) this._finishResolution()
    if (!this._resume) this._grantPriorityTo(this.state.activePlayer)
  },

  _afterDrawStep() {
    this._firePhaseTriggers('drawStep')
    this._grantPriority()
  },

  // Dredge (702.52): graveyard cards whose dredge number the library can cover.
  _dredgeChoices(pid) {
    const s = this.state
    const lib = zone(s, 'library', pid).length
    return zone(s, 'graveyard', pid)
      .map((oid) => s.objects[oid])
      .filter((o) => o.behavior?.dredge && lib >= o.behavior.dredge)
      .map((o) => ({ oid: o.oid, name: o.printed.name, n: o.behavior.dredge }))
  },

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
  },

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
  },

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
  },

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
  },

  // Create `n` tokens for a player, through "twice that many" replacements
  // (Parallel Lives, Doubling Season — each doubles again).
  _createTokens(def, controller, n = 1) {
    let doublings = 0
    for (const { source, mod } of this._ruleMods()) if (mod.tokenMod?.double && source.controller === controller) doublings++
    const total = n * 2 ** doublings
    if (total !== n) this._log(`${this._nameOf(controller)} creates ${total} tokens instead of ${n}`)
    for (let i = 0; i < total; i++) this._createToken(def, controller)
    return total
  },

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
  },

  // Shared entry point for a permanent arriving on the battlefield: fix control,
  // apply summoning sickness to creatures, and fire enters-the-battlefield
  // triggers (both the object's own and other permanents watching).
  _enterBattlefield(o, controller) {
    o.controller = controller
    o.timestamp = ++this.state.tsCounter // for layer ordering (rule 613.7)
    if (o.printed.types.includes('Creature')) o.status.summoningSick = true
    if (o.printed.types.includes('Land')) this.state.players[controller].landfall = true // for "landfall" this turn
    // Prepared (Elite Interceptor): enters prepared.
    if (o.behavior?.prepared) o.prepared = true
    // Daybound (731.4): as a daybound permanent enters, if it's neither day nor
    // night, it becomes day.
    if (this._isDaybound(o) && !this.state.daytime) this._becomeDayNight('day')
    // A Room (DSK): the door it was cast as is unlocked; "when you unlock this door" triggers.
    if (this._isRoom(o)) {
      o.unlocked = [o.face || 0]
      this._refreshRoom(o)
      this._unlockTrigger(o, o.face || 0)
    }
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
  },

}
