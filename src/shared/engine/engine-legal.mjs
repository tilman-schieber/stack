// Legal methods of GameEngine — split out of engine.mjs for size; mixed into
// GameEngine.prototype by engine.mjs. Same `this`, same rules references.

import { createState, createObject, createAbility, computeChars, zone, zoneKey, moveObject, objectsIn, setFace } from './state.mjs'
import { manaAbilityColors, loadBehavior } from './behaviors.mjs'
import { isPermanent, parseManaCost, manaValue, BASIC_LAND_MANA } from './cards.mjs'
import { recompute, matchStatic, hasSub } from './layers.mjs'
import { DUNGEONS, REGULAR_DUNGEONS, roomOf } from './dungeons.mjs'
import { STEP_ORDER, PRIORITY_STEPS, MAIN_STEPS, tags, addCosts } from './engineShared.mjs'

export const legalMethods = {
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
      // Abilities that work from hand ("Discard this card: …" — Faerie Macabre).
      ;(o.behavior?.activated || []).forEach((ab, i) => {
        if (!ab.fromHand) return
        if (!this._canPayAbilityCost(pid, o, ab)) return
        const targets = ab.targets || []
        const actx = { byPid: pid, sourceColors: tags(p) }
        if (targets.some((t) => !this._legalTargetsExist(t, actx))) return
        actions.push({ type: 'activate', oid, ability: i, targets, needsTargets: targets.filter((t) => !t.optional).length, label: ab.label || this._describeAbility(ab), fromHand: true })
      })
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

    // Rooms: unlock a locked door as a sorcery by paying its mana cost.
    for (const oid of zone(s, 'battlefield')) {
      const o = s.objects[oid]
      if (!o.unlocked || o.controller !== pid || !sorcerySpeed) continue
      o.faces.forEach((f, i) => {
        if (o.unlocked.includes(i) || !this._canPay(pid, f.manaCost, [], null, f)) return
        actions.push({ type: 'unlockDoor', oid, face: i, label: `Unlock ${f.name}` })
      })
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
      if (fb.life && s.players[pid].life < fb.life) continue // "Flashback—{1}{U}, Pay 3 life"
      if (fb.sacrifice && this._sacrificeCandidates(pid, fb.sacrifice).length < (fb.sacrifice.count || 1))
        continue
      if (fb.tapCreatures && this._tapCandidates(pid, fb.tapCreatures).length < (fb.tapCreatures.count || 1)) continue
      const targets = this._spellTargets(o)
      const fctx = { byPid: pid, sourceColors: tags(o.printed) }
      if (targets.length && !targets.every((t) => this._legalTargetsExist(t, fctx))) continue
      actions.push({ type: 'castFlashback', oid, targets, needsTargets: targets.length })
    }
    // Embalm (702.87): exile a creature card from your graveyard for a token copy
    // that's a white Zombie with no mana cost. Sorcery speed.
    for (const oid of zone(s, 'graveyard', pid)) {
      const o = s.objects[oid]
      const emb = o.behavior?.embalm
      if (!emb || !sorcerySpeed || !this._canPay(pid, parseManaCost(emb.cost))) continue
      actions.push({ type: 'embalm', oid, label: `Embalm ${o.printed.name} (${emb.cost})` })
    }
    // Abilities that work from the graveyard ("{2}{G}: Return this card from your
    // graveyard to your hand" — Talons of Wildwood).
    for (const oid of zone(s, 'graveyard', pid)) {
      const o = s.objects[oid]
      ;(o.behavior?.activated || []).forEach((ab, i) => {
        if (!ab.fromGraveyard) return
        if (ab.sorcerySpeed && !sorcerySpeed) return
        if (!this._canPayAbilityCost(pid, o, ab)) return
        const targets = ab.targets || []
        const gctx = { byPid: pid, sourceColors: tags(o.printed) }
        if (targets.some((t) => !this._legalTargetsExist(t, gctx))) return
        actions.push({ type: 'activate', oid, ability: i, targets, needsTargets: targets.filter((t) => !t.optional).length, label: ab.label || this._describeAbility(ab), fromGraveyard: true })
      })
    }
    // Escape (702.138): cast from your graveyard, exiling N other cards from it.
    for (const oid of zone(s, 'graveyard', pid)) {
      const o = s.objects[oid]
      const esc = o.behavior?.escape
      if (!esc) continue
      const instantSpeed = o.printed.types.includes('Instant')
      if (!(instantSpeed || sorcerySpeed)) continue
      if (!this._canPay(pid, parseManaCost(esc.cost))) continue
      if (zone(s, 'graveyard', pid).filter((x) => x !== oid).length < esc.exile) continue
      const targets = this._spellTargets(o)
      const ectx = { byPid: pid, sourceColors: tags(o.printed) }
      if (targets.length && !targets.every((t) => this._legalTargetsExist(t, ectx))) continue
      actions.push({ type: 'castEscape', oid, targets, needsTargets: targets.length, label: `${o.printed.name} (escape)` })
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
        const plainTap = ab.manaAbility && ab.cost?.tap && !ab.cost.mana && !ab.cost.sacrifice && !ab.cost.discard
        if (plainTap) return // {T} mana abilities: see tapForMana above
        if (!this._canActivate(pid, o, ab)) return
        if (ab.manaAbility) {
          // A mana ability with a further cost (Eldrazi Spawn's sacrifice, Prophetic
          // Prism's {1}) is an explicit action so it's never spent automatically; it
          // resolves at once. "Add one mana of any color": one action per colour.
          for (const color of ab.colors || [undefined])
            actions.push({ type: 'activate', oid, ability: i, targets: [], needsTargets: 0, mana: true, color, label: (ab.label || 'Mana ability') + (color ? ` — {${color}}` : '') })
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
          discChoose: ab.cost?.discard || null, // discard N cards from hand as a cost
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
  },

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
    // "Choose a creature you control or reveal a creature card from your hand"
    // (Monstrous Emergence): either source will do.
    const addlRevealOk =
      !addl?.revealOrChooseCreature ||
      objectsIn(s, 'battlefield').some((x) => x.controller === pid && x.chars.types.includes('Creature')) ||
      zone(s, 'hand', pid).some((h) => h !== oid && s.objects[h].printed.types.includes('Creature'))
    if (!targetsOk) return why('no legal target')
    if (!(addlSacOk && addlDiscOk && addlRevealOk)) return why("can't pay the additional cost")
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
    // Bargain (702.166): the same spell, sacrificing an artifact, enchantment or token.
    const BARGAIN = { types: ['Artifact', 'Enchantment'], orToken: true }
    if (b.bargain && this._canPay(pid, base, extra, null, p) && this._sacrificeCandidates(pid, BARGAIN).length)
      actions.push(withFace({ ...castAction(false), bargain: true, sacChoose: BARGAIN, label: `${p.name} (bargain)` }))
    // Gift (702.174): promise an opponent a gift; the spell then has an extra target.
    if (b.gift && this._canPay(pid, base, extra, null, p) && this._opponentsOf(pid).length) {
      const gt = b.gift.targets || []
      if (gt.every((t) => this._legalTargetsExist(t, ctx)))
        actions.push(withFace({ ...castAction(false), gift: true, targets: [...targets, ...gt], needsTargets: targets.length + gt.length, variadic: null, label: `${p.name} (gift)` }))
    }
    // Collect evidence N (702.167): exile cards with total mana value N or more
    // from your graveyard as an optional additional cost.
    const ev = addl?.evidence
    if (ev && this._canPay(pid, base, extra, null, p) && this._evidenceCards(pid, ev).length)
      actions.push(withFace({ ...castAction(false), evidence: true, label: `${p.name} (collect evidence ${ev})` }))
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
      (!alt.payLife || s.players[pid].life > alt.payLife) &&
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
  },

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
  },

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
  },

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
  },

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
  },

  // How many lands `pid` may play this turn: one, plus any "additional land"
  // permissions (305.2 / Exploration).
  _landsAllowed(pid) {
    let n = 1
    for (const { source, mod } of this._ruleMods()) if (mod.extraLands && source.controller === pid) n += mod.extraLands
    return n
  },

  _spellTargets(o, behavior = o.behavior) {
    if (behavior.spell?.targets) return behavior.spell.targets
    // An Aura targets the permanent it will be attached to as it is cast.
    if (behavior.enchant) return [{ ...behavior.enchant }] // keeps `controller` / `subtype` restrictions
    return []
  },

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
  },

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
  },

  // Spread `total` across `n` targets as evenly as possible (remainder to the
  // earlier targets) — the UI's default division when the player doesn't specify.
  _evenDivision(total, n) {
    if (n <= 0) return []
    const base = Math.floor(total / n)
    let rem = total - base * n
    return Array.from({ length: n }, () => base + (rem-- > 0 ? 1 : 0))
  },

  // Shift every `target<n>` reference in an effect list by `offset` (so a mode's
  // effects index into the combined `targets` array at the right slot).
  _offsetTargetRefs(effect, offset) {
    if (!offset) return effect
    return effect.map((e) => {
      if (typeof e.to === 'string' && /^target\d+$/.test(e.to))
        return { ...e, to: 'target' + (Number(e.to.slice(6)) + offset) }
      return e
    })
  },

}
