import React, { useEffect, useState } from 'react'
import { useEngineGame } from '../../store/engineGame.js'
import { EngineCard, Pile, ManaPool, LifePlate, HelperCard, isCreature, isLand } from './engine/EngineCard.jsx'
import Prompt from './engine/Prompt.jsx'
import MotionLayer from './engine/Motion.jsx'
import { useBoardMotion } from '../../lib/boardMotion.js'
import { play as playSound, setSoundEnabled } from '../../lib/sound.js'
import { useSettings } from '../../store/settings.js'
import { GameLog, StopsPanel, PhaseBar, Inspector } from './engine/Panels.jsx'
import { ZoneViewer, SearchOverlay, ScryOverlay, LookTopOverlay, ZoomOverlay, StackOverlay, HandRevealOverlay } from './engine/Overlays.jsx'
import '../../play.css'
import './engine.css'

const STEP_LABEL = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main 1',
  beginCombat: 'Begin combat',
  declareAttackers: 'Declare attackers',
  declareBlockers: 'Declare blockers',
  combatDamage: 'Combat damage',
  endCombat: 'End of combat',
  main2: 'Main 2',
  end: 'End step',
  cleanup: 'Cleanup'
}

export default function EnginePlayArea() {
  const view = useEngineGame((s) => s.view)
  const error = useEngineGame((s) => s.error)
  const chooseRaw = useEngineGame((s) => s.choose)
  const endGame = useEngineGame((s) => s.endGame)
  const concede = useEngineGame((s) => s.concede)
  const stops = useEngineGame((s) => s.stops)
  const toggleStop = useEngineGame((s) => s.toggleStop)
  const yields = useEngineGame((s) => s.yields)
  const setYield = useEngineGame((s) => s.setYield)
  const holds = useEngineGame((s) => s.holds)
  const setHold = useEngineGame((s) => s.setHold)
  const match = useEngineGame((s) => s.match)
  const openSideboard = useEngineGame((s) => s.openSideboard)
  const mode = useEngineGame((s) => s.mode)
  const mySeat = useEngineGame((s) => s.netSeat)
  const botSeats = useEngineGame((s) => s.botSeats)
  // Online / vs. the computer: whether the local player is the one who must act.
  const myTurn = (mode === 'local' && !botSeats.includes(view?.pending?.player)) || view?.pending?.player === mySeat
  const [showStops, setShowStops] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false) // "Concede?" two-step confirmation
  const [zoom, setZoom] = useState(null) // card being previewed (right-click)
  const [hover, setHover] = useState(null) // card under the mouse (inspector)
  const [abilityMenu, setAbilityMenu] = useState(null) // { actions, x, y } picker

  // Transient selection state; reset whenever the engine produces a new view
  // (i.e. a new decision point).
  const [cast, setCast] = useState(null) // { action, chosen: [] }
  const [attackers, setAttackers] = useState({}) // attackerOid -> defender descriptor
  const [attackTarget, setAttackTarget] = useState(null) // current defender for new attackers
  const [blocks, setBlocks] = useState({}) // blockerOid -> attackerOid
  const [pickBlocker, setPickBlocker] = useState(null)
  const [discardSel, setDiscardSel] = useState([])
  const [bottomSel, setBottomSel] = useState([]) // cards to put on the bottom (mulligan)
  const [chooseSel, setChooseSel] = useState([]) // engine-initiated target choice
  const [scryBottom, setScryBottom] = useState([]) // scry: oids to put on the bottom (reorder: the chosen top order)
  const [topSel, setTopSel] = useState([]) // look-at-the-top: cards to take
  const [zoneView, setZoneView] = useState(null) // { pid, zone } graveyard/exile viewer
  const [xInput, setXInput] = useState(0) // X value being chosen for an X spell
  const [ninjutsu, setNinjutsu] = useState(null) // pending ninjutsu action awaiting an attacker
  const [prolifSel, setProlifSel] = useState([]) // proliferate: chosen permanents (oids) and players ('p<pid>')
  const [bandAttack, setBandAttack] = useState(false) // declare the selected attackers as one band

  const resetSelections = () => {
    setCast(null)
    setAttackers({})
    setAttackTarget(null)
    setBlocks({})
    setPickBlocker(null)
    setDiscardSel([])
    setBottomSel([])
    setChooseSel([])
    setScryBottom([])
    setTopSel([])
    setAbilityMenu(null)
    setZoneView(null)
    setXInput(0)
    setNinjutsu(null)
    setProlifSel([])
    setBandAttack(false)
  }
  // Reset when the *decision* changes — not on every view push. Online, the host
  // re-sends the view for things like a stop toggle; that must not wipe the
  // attackers you were halfway through picking. Our own choices reset explicitly.
  const p0 = view?.pending || {}
  const decisionKey = view
    ? [p0.kind, p0.player, view.turnNumber, view.step, view.stack.length, (p0.eligible || []).join(), (p0.hand || []).length].join('|')
    : ''
  useEffect(resetSelections, [decisionKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (answer) => {
    resetSelections()
    chooseRaw(answer)
  }

  // Keyboard: Escape closes the zoom / cancels an in-progress cast; Space or
  // Enter passes priority when it's yours and nothing else is being chosen.
  // Magic Online's yields: F4 passes the rest of the turn (but stops when an
  // opponent does something you can respond to), F6 passes everything this
  // turn, F3 cancels a yield.
  const pendingKind = view?.pending?.kind
  const gameOn = !!view && pendingKind !== 'gameOver' && pendingKind !== 'mulligan' && pendingKind !== 'bottom'
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape') {
        if (zoom) setZoom(null)
        else if (abilityMenu) setAbilityMenu(null)
        else if (cast) setCast(null)
        return
      }
      if (gameOn && (e.key === 'F4' || e.key === 'F6' || e.key === 'F3')) {
        e.preventDefault()
        setYield(e.key === 'F4' ? 'turn' : e.key === 'F6' ? 'all' : null)
        return
      }
      if ((e.key === ' ' || e.key === 'Enter') && pendingKind === 'priority' && myTurn && !cast && !abilityMenu && !zoom) {
        e.preventDefault()
        choose({ type: 'pass' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, abilityMenu, cast, pendingKind, myTurn, chooseRaw, gameOn, setYield]) // eslint-disable-line react-hooks/exhaustive-deps

  // Table sounds follow the setting; the module itself stays silent until it is
  // switched on, so nothing tries to start an AudioContext unasked.
  const soundsOn = useSettings((st) => st.sounds)
  useEffect(() => setSoundEnabled(!!soundsOn), [soundsOn])

  // Watches for cards that changed zone between this view and the last one, and
  // for damage newly marked, so the board can show the move instead of just the
  // result. Called before the early return: hooks must run on every render.
  const { flights, hits } = useBoardMotion(view)

  if (!view) return null
  const pending = view.pending || {}
  const kind = pending.kind
  // Default defending player: the first opponent the engine offers, else whoever
  // isn't the active player.
  const defenderPid =
    pending.defenders?.find((d) => d.kind === 'player')?.pid ??
    view.players.find((p) => p.id !== view.activePlayer)?.id
  const actionFor = (oid) =>
    kind === 'priority' ? pending.actions?.find((a) => a.oid === oid) : null
  // Find any card view by oid across every zone (used to read a casting spell's
  // colors for protection-from-color targeting checks).
  const cardByOid = (oid) =>
    view.players
      .flatMap((p) => [...p.hand, ...p.battlefield, ...p.graveyard, ...p.exile, ...(p.command || [])])
      .find((c) => c.oid === oid)

  // Human-readable name of what new attackers will be sent at.
  const attackTargetName =
    kind === 'declareAttackers'
      ? !attackTarget || attackTarget.player != null
        ? view.players[defenderPid]?.name
        : pending.defenders?.find((d) => d.oid === (attackTarget.planeswalker ?? attackTarget.battle))?.name || 'planeswalker'
      : null

  // ---- targeting helpers ----
  // Unifies player-initiated targeting (cast/activate) with engine-initiated
  // target choices (a triggered ability's `chooseTargets` decision).
  const engineTargeting = kind === 'chooseTargets'
  // A cast can require choosing X, then a permanent to sacrifice (a cost), before
  // its targets. While either is pending we're not yet in targeting mode.
  const needX = !!(cast && cast.action.hasX && cast.x == null)
  // Hybrid / two-brid pips: the caster may say how each is paid (or leave it to auto-pay).
  const needPips = !!(cast && (cast.action.hybrid || cast.action.twobrid) && !cast.pips && !needX)
  const needSac = !!(cast && cast.action.sacChoose && !cast.sac && !needX && !needPips)
  // A discard additional cost (Grab the Prize): pick a card from hand to pitch.
  const needDiscard = !!(cast && cast.action.discChoose && !cast.disc && !needX && !needPips && !needSac)
  // A modal spell (Abrade, Cryptic Command): first pick `count` modes, then collect
  // targets for each selected mode in turn.
  const modalPicking = !!(cast && cast.action.modal && !cast.modes)
  const modalMode = cast && cast.action.modal && cast.modes ? cast.action.modes[cast.modes[cast.mtIdx]] : null
  // Normalise so `targeting.targets` / `.chosen` work for a player cast (specs live
  // on cast.action.targets, or the current modal mode) or an engine target choice.
  const targeting = needX || needPips || needSac || needDiscard || modalPicking
    ? null
    : cast
      ? cast.action.modal
        ? modalMode?.targets?.length
          ? { targets: modalMode.targets, chosen: cast.curTargets || [] }
          : null
        : { targets: cast.action.targets, chosen: cast.chosen }
      : engineTargeting
        ? { targets: pending.targets, chosen: chooseSel }
        : null
  // A variadic cast ("N damage divided among one or two targets", "up to N…"):
  // one slot is reused until `max` targets are chosen; a Confirm button finalizes
  // once at least `min` are picked, and the total is auto-divided evenly.
  const variadic = cast && !cast.action.modal ? cast.action.variadic : null
  const targetSlot = variadic
    ? targeting && targeting.chosen.length < variadic.max
      ? variadic
      : null
    : targeting
      ? targeting.targets[targeting.chosen.length]
      : null
  const variadicReady = !!(variadic && targeting && targeting.chosen.length >= (variadic.min ?? 1))
  const wantsPlayer = targetSlot && (targetSlot.type === 'player' || targetSlot.type === 'any')
  const wantsSpell = targetSlot && targetSlot.type === 'spell'
  const wantsLand = targetSlot && targetSlot.type === 'land'
  const wantsArtifact = targetSlot && targetSlot.type === 'artifact'
  const wantsPermanent = targetSlot && targetSlot.type === 'permanent'
  // A creature target may carry a color restriction (Doom Blade: "nonblack").
  const colorOk = (c) => !targetSlot?.excludeColor || !c.colors?.includes(targetSlot.excludeColor)
  const wantsCreature = !!(targetSlot && (targetSlot.type === 'creature' || targetSlot.type === 'any'))
  // Untargetability (hexproof/shroud/protection): who is choosing, and the colors
  // of the spell/ability doing the targeting, decide which permanents are illegal.
  const casterPid = pending?.player
  const sourceOid = cast ? cast.action.oid : engineTargeting ? pending.sourceOid : null
  const sourceColors = (sourceOid != null ? cardByOid(sourceOid)?.colors : null) || []
  const untargetable = (c, controllerPid) => {
    const kw = c.keywords || []
    if (kw.includes('Shroud')) return true
    if (kw.includes('Hexproof') && controllerPid !== casterPid) return true
    const prot = c.protections || []
    return prot.length > 0 && sourceColors.some((col) => prot.includes(col))
  }
  // "target creature you control / an opponent controls" restricts by controller.
  const controllerOk = (controllerPid) =>
    !targetSlot?.controller ||
    (targetSlot.controller === 'you' ? controllerPid === casterPid : controllerPid !== casterPid)
  const matchesCreature = (c, controllerPid) =>
    wantsCreature && isCreature(c) && colorOk(c) && controllerOk(controllerPid) && !untargetable(c, controllerPid)
  const matchesArtifact = (c, controllerPid) =>
    wantsArtifact &&
    c.types?.includes('Artifact') &&
    !(targetSlot.noncreature && c.types?.includes('Creature')) &&
    !untargetable(c, controllerPid)
  const matchesLand = (c, controllerPid) => wantsLand && isLand(c) && !untargetable(c, controllerPid)
  const matchesPermanent = (c, controllerPid) =>
    wantsPermanent && controllerOk(controllerPid) && !untargetable(c, controllerPid)
  // Any battlefield card that fits the current target slot.
  const matchesTarget = (c, controllerPid) =>
    matchesCreature(c, controllerPid) || matchesLand(c, controllerPid) || matchesArtifact(c, controllerPid) || matchesPermanent(c, controllerPid)

  // Fire the assembled cast/activate (with its chosen targets and sacrifice).
  function finalizeCast(c, chosen) {
    const a = c.action
    if (a.type === 'activate')
      choose({ type: 'activate', oid: a.oid, ability: a.ability, targets: chosen, sacrifice: c.sac, discard: c.disc, x: c.x })
    else if (a.type === 'madness') choose({ cast: true, targets: chosen })
    else if (a.type === 'castFlashback') choose({ type: 'castFlashback', oid: a.oid, targets: chosen })
    else if (a.type === 'castOmen') choose({ type: 'castOmen', oid: a.oid, targets: chosen })
    else if (a.type === 'castPlotted') choose({ type: 'castPlotted', oid: a.oid, targets: chosen })
    else if (a.type === 'castPrepared') choose({ type: 'castPrepared', oid: a.oid, targets: chosen })
    else if (a.type === 'castBestow') choose({ type: 'castBestow', oid: a.oid, targets: chosen, x: c.x })
    else
      choose({ type: 'cast', oid: a.oid, altCost: !!a.altCost, kicker: !!a.kicker, evoke: !!a.evoke, buyback: !!a.buyback, overload: !!a.overload, face: a.face, targets: chosen, sacrifice: c.sac, discard: c.disc, x: c.x, hybrid: c.pips?.hybrid, twobrid: c.pips?.twobrid })
  }

  // Finalize a modal cast once every selected mode has its targets.
  function finalizeModal(c) {
    choose({ type: 'cast', oid: c.action.oid, modes: c.modes, modeTargets: c.modeTargets })
  }

  // Advance modal target collection: record []-targets for no-target modes, and
  // finalize once all selected modes are covered.
  function advanceModal(c) {
    let mtIdx = c.mtIdx
    const modeTargets = [...c.modeTargets]
    while (mtIdx < c.modes.length) {
      const mode = c.action.modes[c.modes[mtIdx]]
      if (mode.targets?.length) break // this mode needs targeting; stop
      modeTargets[mtIdx] = []
      mtIdx++
    }
    if (mtIdx >= c.modes.length) finalizeModal({ ...c, modeTargets })
    else setCast({ ...c, modeTargets, mtIdx, curTargets: [] })
  }

  // The player has chosen which `count` modes to use (indices into action.modes).
  function pickModes(indices) {
    advanceModal({ ...cast, modes: indices, modeTargets: [], mtIdx: 0, curTargets: [] })
  }

  function addTarget(t) {
    // Modal: accumulate targets for the current mode, then advance to the next.
    if (cast && cast.action.modal) {
      const spec = cast.action.modes[cast.modes[cast.mtIdx]].targets
      const chosen = [...(cast.curTargets || []), t]
      if (chosen.length >= spec.length) {
        const modeTargets = [...cast.modeTargets]
        modeTargets[cast.mtIdx] = chosen
        advanceModal({ ...cast, modeTargets, mtIdx: cast.mtIdx + 1, curTargets: [] })
      } else setCast({ ...cast, curTargets: chosen })
      return
    }
    // Variadic: keep collecting up to max; finalize immediately at max, else wait
    // for the Confirm button.
    if (variadic) {
      const chosen = [...targeting.chosen, t]
      if (chosen.length >= variadic.max) finalizeVariadic(chosen)
      else setCast({ ...cast, chosen })
      return
    }
    const chosen = [...targeting.chosen, t]
    const done = chosen.length >= targeting.targets.length
    if (cast) {
      if (done) finalizeCast(cast, chosen)
      else setCast({ ...cast, chosen })
    } else {
      // engine chooseTargets
      if (done) choose({ targets: chosen })
      else setChooseSel(chosen)
    }
  }

  // Finalize a variadic cast: auto-divide the total evenly across the chosen
  // targets (remainder to the earlier ones) and send it.
  // "Up to N target creatures": once every remaining target slot is optional the
  // caster may stop here (a mode of Cast into the Fire, Cryogen Relic's stun).
  const optionalReady = !!(
    targeting &&
    !variadic &&
    targeting.chosen.length < targeting.targets.length &&
    targeting.targets.slice(targeting.chosen.length).every((sp) => sp.optional)
  )
  function finalizeOptional() {
    const chosen = targeting.chosen
    if (cast && cast.action.modal) {
      const modeTargets = [...cast.modeTargets]
      modeTargets[cast.mtIdx] = chosen
      advanceModal({ ...cast, modeTargets, mtIdx: cast.mtIdx + 1, curTargets: [] })
    } else if (cast) finalizeCast(cast, chosen)
    else choose({ targets: chosen })
  }

  function finalizeVariadic(chosen) {
    const v = cast.action.variadic
    let division
    if (v.divide != null) {
      const n = chosen.length
      const base = Math.floor(v.divide / n)
      let rem = v.divide - base * n
      division = chosen.map(() => base + (rem-- > 0 ? 1 : 0))
    }
    choose({ type: 'cast', oid: cast.action.oid, face: cast.action.face, kicker: !!cast.action.kicker, targets: chosen, division })
    setCast(null)
  }

  // Pick a permanent to sacrifice as part of a cost; then continue to targets.
  function chooseSacrifice(card) {
    const next = { ...cast, sac: card.oid }
    if (next.action.targets.length === 0) finalizeCast(next, [])
    else setCast(next)
  }

  // Pick a card from hand to discard as an additional cost; then continue.
  function chooseDiscardCost(card) {
    const next = { ...cast, disc: [card.oid] }
    if (next.action.targets.length === 0) finalizeCast(next, [])
    else setCast(next)
  }

  // Begin any player action; open targeting/sacrifice/X sub-steps as needed.
  function startAction(a) {
    setAbilityMenu(null)
    if (a.type === 'tapForMana') {
      playSound('tap')
      choose({ type: 'tapForMana', oid: a.oid, color: a.color })
      return
    }
    if (a.type === 'playLand' || a.type === 'plot' || a.type === 'cycle' || a.type === 'suspend' || a.type === 'crew' || a.type === 'unearth') {
      choose(a.type === 'playLand' ? a : { type: a.type, oid: a.oid })
      return
    }
    if (a.type === 'ninjutsu' || a.sneak || a.webSlinging) {
      // Return a creature (ninjutsu / sneak: an unblocked attacker; web-slinging: a
      // tapped creature). One choice acts immediately, else click which one.
      if (a.returns.length === 1) choose(returnAnswer(a, a.returns[0]))
      else setNinjutsu(a)
      return
    }
    if (a.type === 'castDisturb') {
      choose({ type: 'castDisturb', oid: a.oid })
      return
    }
    if (a.type === 'unlockDoor') {
      choose({ type: 'unlockDoor', oid: a.oid, face: a.face })
      return
    }
    const needsSetup = a.needsTargets > 0 || a.sacChoose || a.discChoose || a.hasX || a.modal || a.hybrid || a.twobrid
    if (needsSetup) {
      setCast({ action: a, chosen: [], sac: null, disc: null, x: null, pips: null })
      return
    }
    if (a.type === 'activate') choose({ type: 'activate', oid: a.oid, ability: a.ability, targets: [] })
    else if (a.type === 'castOmen') choose({ type: 'castOmen', oid: a.oid, targets: [] })
    else if (a.type === 'castFlashback') choose({ type: 'castFlashback', oid: a.oid, targets: [] })
    else if (a.type === 'castPlotted') choose({ type: 'castPlotted', oid: a.oid, targets: [] })
    else if (a.type === 'castFaceDown') choose({ type: 'castFaceDown', oid: a.oid })
    else if (a.type === 'turnFaceUp') choose({ type: 'turnFaceUp', oid: a.oid })
    else choose({ type: 'cast', oid: a.oid, altCost: !!a.altCost, kicker: !!a.kicker, evoke: !!a.evoke, buyback: !!a.buyback, overload: !!a.overload, face: a.face })
  }
  const startActivate = startAction
  // The answer for an action that returns one of your creatures to hand.
  const returnAnswer = (a, returned) =>
    a.type === 'ninjutsu' ? { type: 'ninjutsu', oid: a.oid, returned } : { type: 'cast', oid: a.oid, sneak: !!a.sneak, webSlinging: !!a.webSlinging, returned }

  // Cast a madness card: target if needed, else fire immediately.
  function onMadnessCast(m) {
    if (m.targets?.length > 0) setCast({ action: { type: 'madness', targets: m.targets }, chosen: [] })
    else choose({ cast: true })
  }

  // ---- click dispatch ----
  // Online, only the player whose decision it is may interact; the other side
  // just watches (the host/store would ignore the choice anyway).
  function onHandCard(card, pid, ev) {
    if (!myTurn) return
    if ((kind === 'discard' || kind === 'discardCards' || kind === 'putBack') && pid === pending.player) {
      setDiscardSel((sel) =>
        sel.includes(card.oid)
          ? sel.filter((o) => o !== card.oid)
          : sel.length < pending.count
            ? [...sel, card.oid]
            : sel
      )
      return
    }
    if (kind === 'bottom' && pid === pending.player) {
      setBottomSel((sel) =>
        sel.includes(card.oid)
          ? sel.filter((o) => o !== card.oid)
          : sel.length < pending.count
            ? [...sel, card.oid]
            : sel
      )
      return
    }
    // Discarding a card as an additional cost (Grab the Prize) — click one in your
    // hand other than the spell being cast.
    if (needDiscard) {
      if (pid === pending.player && card.oid !== cast.action.oid) chooseDiscardCost(card)
      return
    }
    if (targeting || needSac || needX) return
    if (kind === 'priority' && pid === pending.player) {
      // Shift-click: keep priority after this spell (to respond to it yourself).
      if (ev?.shiftKey && !holds[mySeat]) setHold(true)
      const acts = pending.actions.filter(
        (a) =>
          a.oid === card.oid &&
          ['cast', 'castBestow', 'castOmen', 'castFlashback', 'castFaceDown', 'playLand', 'plot', 'ninjutsu', 'cycle', 'suspend', 'activate'].includes(a.type)
      )
      if (acts.length === 1) startAction(acts[0])
      else if (acts.length > 1) setAbilityMenu({ actions: acts, x: ev?.clientX ?? 200, y: ev?.clientY ?? 200 })
    }
  }

  function onBattlefieldCard(card, controllerPid, ev) {
    if (!myTurn) return
    // Clone: "enter as a copy of…" — click a creature on the battlefield to copy it.
    if (kind === 'copyEnter' && pending.choices.includes(card.oid)) {
      choose({ copy: card.oid })
      return
    }
    // Proliferate: toggle a permanent with counters.
    if (kind === 'proliferate') {
      if (pending.choices.some((c) => c.kind === 'object' && c.oid === card.oid))
        setProlifSel((sel) => (sel.includes(card.oid) ? sel.filter((x) => x !== card.oid) : [...sel, card.oid]))
      return
    }
    // The Ring tempts you: click the creature to become your Ring-bearer.
    if (kind === 'chooseRingBearer' && pending.choices.includes(card.oid)) {
      choose({ oid: card.oid })
      return
    }
    // Legend rule: click the one to keep.
    if (kind === 'legendChoice' && pending.choices.includes(card.oid)) {
      choose({ keep: card.oid })
      return
    }
    // An Edict: click one of your highlighted permanents to sacrifice it.
    if (kind === 'sacrificeChoice' && controllerPid === pending.player && pending.choices.includes(card.oid)) {
      choose({ sacrifice: [card.oid] })
      return
    }
    // Highway Robbery: sacrifice a land instead of discarding (click your land).
    if (kind === 'discardCards' && pending.orSacrificeLand && controllerPid === pending.player && isLand(card)) {
      choose({ sacLand: card.oid })
      return
    }
    // Ninjutsu / sneak / web-slinging: click which of your creatures to return to hand.
    if (ninjutsu) {
      if (ninjutsu.returns.includes(card.oid)) choose(returnAnswer(ninjutsu, card.oid))
      return
    }
    // Choosing a permanent to sacrifice (a cost) — click one you control that matches.
    if (needSac) {
      if (controllerPid === pending.player && (cast.action.sacChoose.types || []).some((t) => card.types.includes(t)))
        chooseSacrifice(card)
      return
    }
    if (targeting) {
      if (matchesTarget(card, controllerPid)) addTarget({ kind: 'object', oid: card.oid })
      return
    }
    // Activate an ability of a permanent you control — including tapping it for
    // mana. If it has more than one option (a planeswalker, a dual land), pop a
    // picker.
    if (kind === 'priority' && controllerPid === pending.player) {
      const acts = pending.actions.filter(
        (a) => (a.type === 'activate' || a.type === 'turnFaceUp' || a.type === 'tapForMana' || a.type === 'crew' || a.type === 'castPrepared' || a.type === 'unlockDoor') && a.oid === card.oid
      )
      if (acts.length === 1) startAction(acts[0])
      else if (acts.length > 1) setAbilityMenu({ actions: acts, x: ev?.clientX ?? 200, y: ev?.clientY ?? 200 })
      return
    }
    if (kind === 'declareAttackers') {
      // Click your eligible creature to send it at the current target; click an
      // enemy planeswalker to make it the target for subsequent attackers.
      if (controllerPid === view.activePlayer && pending.eligible.includes(card.oid)) {
        setAttackers((a) => {
          const next = { ...a }
          if (next[card.oid]) delete next[card.oid]
          else next[card.oid] = attackTarget || { player: defenderPid }
          return next
        })
      } else if (controllerPid !== view.activePlayer && card.loyalty != null) {
        setAttackTarget({ planeswalker: card.oid })
      } else if (card.defense != null && card.protector != null && card.protector !== view.activePlayer) {
        setAttackTarget({ battle: card.oid }) // a battle protected by an opponent (310.11c)
      }
    } else if (kind === 'declareBlockers') {
      if (controllerPid === pending.player && pending.eligible.includes(card.oid)) {
        setPickBlocker(card.oid) // choose a blocker, then click the attacker
      } else if (card.attacking && pickBlocker != null) {
        // A blocker that may block additional creatures keeps a list of attackers.
        const extra = pending.extraBlocks?.[pickBlocker] || 0
        setBlocks((b) => {
          const cur = b[pickBlocker]
          const list = cur == null ? [] : Array.isArray(cur) ? cur : [cur]
          if (list.includes(card.oid)) return b
          const next = extra > 0 && list.length ? [...list, card.oid].slice(0, 1 + extra) : card.oid
          return { ...b, [pickBlocker]: next }
        })
        setPickBlocker(null)
      }
    }
  }

  function onPlayerTarget(pid) {
    if (!myTurn) return
    if (kind === 'proliferate') {
      if (pending.choices.some((c) => c.kind === 'player' && c.pid === pid))
        setProlifSel((sel) => (sel.includes('p' + pid) ? sel.filter((x) => x !== 'p' + pid) : [...sel, 'p' + pid]))
      return
    }
    if (targeting && wantsPlayer) {
      addTarget({ kind: 'player', pid })
      return
    }
    // During attacker declaration, clicking the defending player targets them.
    if (kind === 'declareAttackers' && pid !== view.activePlayer) setAttackTarget({ player: pid })
  }

  function onStackItem(item) {
    if (myTurn && targeting && wantsSpell) addTarget({ kind: 'spell', oid: item.oid })
  }

  // Class flags for a battlefield card given the current mode.
  function bfClass(card, controllerPid) {
    const cls = []
    if (card.attacking) cls.push('atk')
    if (card.blocking) cls.push('blk')
    if (isCreature(card) && card.summoningSick && controllerPid === view.activePlayer) cls.push('sick')
    if (!myTurn) return cls.join(' ') // spectating the other player's decision: no affordances
    if (ninjutsu && ninjutsu.returns.includes(card.oid)) cls.push('targetable')
    if (targeting && matchesTarget(card, controllerPid)) cls.push('targetable')
    if (needSac && controllerPid === pending.player && (cast.action.sacChoose.types || []).some((t) => card.types.includes(t)))
      cls.push('targetable')
    if (kind === 'discardCards' && pending.orSacrificeLand && controllerPid === pending.player && isLand(card))
      cls.push('targetable')
    if (kind === 'sacrificeChoice' && controllerPid === pending.player && pending.choices.includes(card.oid)) cls.push('targetable')
    if (kind === 'legendChoice' && pending.choices.includes(card.oid)) cls.push('targetable')
    if (kind === 'chooseRingBearer' && pending.choices.includes(card.oid)) cls.push('targetable')
    if (kind === 'proliferate' && pending.choices.some((c) => c.kind === 'object' && c.oid === card.oid))
      cls.push('selectable', prolifSel.includes(card.oid) ? 'chosen' : '')
    if (kind === 'copyEnter' && pending.choices.includes(card.oid)) cls.push('targetable')
    if (!targeting && !needSac && kind === 'priority' && controllerPid === pending.player) {
      if (pending.actions.some((a) => (a.type === 'activate' || a.type === 'castPrepared' || a.type === 'unlockDoor') && a.oid === card.oid)) cls.push('activatable')
      else if (pending.actions.some((a) => a.type === 'tapForMana' && a.oid === card.oid)) cls.push('tappable')
    }
    if (kind === 'declareAttackers') {
      if (controllerPid === view.activePlayer && pending.eligible.includes(card.oid))
        cls.push('selectable', attackers[card.oid] ? 'chosen' : '')
      if (controllerPid !== view.activePlayer && card.loyalty != null)
        cls.push('selectable', attackTarget?.planeswalker === card.oid ? 'assigned' : '')
      if (card.defense != null && card.protector != null && card.protector !== view.activePlayer)
        cls.push('selectable', attackTarget?.battle === card.oid ? 'assigned' : '')
    }
    if (kind === 'declareBlockers') {
      if (controllerPid === pending.player && pending.eligible.includes(card.oid))
        cls.push('selectable', pickBlocker === card.oid ? 'chosen' : '', blocks[card.oid] ? 'assigned' : '')
      if (card.attacking && pickBlocker != null) cls.push('targetable')
    }
    return cls.join(' ')
  }

  // Orient the board so the local player sits at the bottom. In local hot-seat
  // that's seat 0; online, it's whichever seat this client controls (netSeat).
  const bottom = view.players[mySeat]
  const top = view.players[mySeat === 0 ? 1 : 0]

  // A player's own end of the table: who they are, their life, their unspent
  // mana and their three piles, in a rail down the outer edge of their half.
  const seatRail = (p) => {
    // Seat names carry the deck in brackets ("Computer (Mono Red Rally)"). The
    // rail is narrow, so the placard gives each its own line instead of cutting
    // the whole thing off mid-word.
    const parts = /^(.*?)\s*\((.+)\)\s*$/.exec(p.name)
    const who = parts ? parts[1] : p.name
    const deck = parts ? parts[2] : null
    return (
    <div
      className={'eng-rail' + (view.activePlayer === p.id ? ' active' : '') + (p.id === mySeat ? ' mine' : '')}
      key={p.id}
    >
      <div className="eng-rail-placard" title={p.name}>
        <div className="eng-rail-name">
          <span className="eng-rail-who">{who}</span>
          {view.activePlayer === p.id && <span className="pp-active-dot" title="Active player" />}
          {view.priorityPlayer === p.id && <span className="eng-prio-dot" title="Has priority" />}
        </div>
        {deck && <div className="eng-rail-deck">{deck}</div>}
      </div>
      <LifePlate
        life={p.life}
        targetable={targeting && wantsPlayer}
        onClick={() => onPlayerTarget(p.id)}
        title={targeting && wantsPlayer ? `Target ${p.name}` : `${p.name}'s life total`}
      />
      <div className="eng-rail-counts">
        <span className="eng-count" title={`${p.handCount} card${p.handCount === 1 ? '' : 's'} in hand`}>
          ✋ {p.handCount}
        </span>
        {Object.entries(p.counters || {})
          .filter(([, n]) => n > 0)
          .map(([k, n]) => (
            <span key={k} className="eng-count" title={`${k} counters`}>
              {k === 'poison' ? '☠' : k === 'energy' ? '⚡' : k} {n}
            </span>
          ))}
      </div>
      <ManaPool pool={p.manaPool} restricted={p.restrictedMana} />
      <div className="eng-zones">
        <Pile label="Library" count={p.libraryCount} faceDown zone="library" player={p.id} />
        <Pile
          label="Graveyard"
          count={p.graveyard.length}
          topCard={p.graveyard[p.graveyard.length - 1]}
          zone="graveyard"
          player={p.id}
          onOpen={() => setZoneView({ pid: p.id, zone: 'graveyard' })}
        />
        <Pile
          label="Exile"
          count={p.exile.length}
          topCard={p.exile[p.exile.length - 1]}
          zone="exile"
          player={p.id}
          onOpen={() => setZoneView({ pid: p.id, zone: 'exile' })}
        />
      </div>
      {(p.libraryTop || p.monarch || p.initiative || p.dungeon || p.emblems?.length > 0) && (
        <div className="eng-designations">
          {p.libraryTop && (
            <div className="eng-helper-wrap eng-libtop">
              <EngineCard
                card={p.libraryTop}
                className={kind === 'priority' && p.id === pending.player && actionFor(p.libraryTop.oid) ? 'playable' : ''}
                onClick={(ev) => onHandCard(p.libraryTop, p.id, ev)}
                onZoom={setZoom}
                onHover={setHover}
                title={`Top of ${p.name}'s library (${p.libraryTop.visibility === 'reveal' ? 'revealed' : 'you may look at it'})${
                  kind === 'priority' && p.id === pending.player && actionFor(p.libraryTop.oid) ? ' — click to play it' : ''
                }`}
              />
              <span className="eng-helper-label">top of library</span>
            </div>
          )}
          {p.monarch && (
            <HelperCard
              def={view.helperCards.monarch}
              label="The Monarch"
              info="At the beginning of your end step, draw a card.\nWhenever a creature deals combat damage to you, its controller becomes the monarch."
              onZoom={setZoom}
              onHover={setHover}
            />
          )}
          {p.initiative && (
            <HelperCard
              def={view.helperCards.initiative}
              label="The Initiative"
              info="At the beginning of your upkeep, venture into Undercity.\nWhenever one or more creatures a player controls deal combat damage to you, that player takes the initiative.\nWhenever a player takes the initiative, they venture into Undercity."
              onZoom={setZoom}
              onHover={setHover}
            />
          )}
          {p.dungeon && (
            <HelperCard
              def={{ name: p.dungeon.name, helper: true, scryfallId: p.dungeon.scryfallId }}
              label={p.dungeon.name}
              sub={p.dungeon.roomName}
              dungeon={p.dungeon}
              info={p.dungeon.rooms.map((r) => `${r.current ? '▶ ' : ''}${r.name} — ${r.text}`).join('\n')}
              onZoom={setZoom}
              onHover={setHover}
            />
          )}
          {(p.emblems || []).map((em) =>
            em.name === 'The Ring' ? (
              <HelperCard
                key={em.oid}
                def={view.helperCards.ring}
                label="The Ring"
                sub={`tempted ×${p.ringTempts}`}
                info={`The Ring has tempted you ${p.ringTempts} time${p.ringTempts === 1 ? '' : 's'}.\nYour Ring-bearer is legendary and can't be blocked by creatures with greater power.\n(2+) Whenever your Ring-bearer attacks, draw a card, then discard a card.\n(3+) Whenever your Ring-bearer becomes blocked by a creature, that creature's controller sacrifices it at end of combat.\n(4+) Whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life.`}
                onZoom={setZoom}
                onHover={setHover}
              />
            ) : (
              <HelperCard
                key={em.oid}
                def={{ name: em.name.replace(/\s*emblem$/i, '') + ' Emblem', helper: true }}
                label={em.name}
                info="An emblem: it stays in the command zone and can't be removed."
                onZoom={setZoom}
                onHover={setHover}
              />
            )
          )}
        </div>
      )}
      {p.completedDungeons > 0 && (
        <div className="eng-count" title="Dungeons completed (some abilities check this)">
          🏰 completed dungeons: {p.completedDungeons}
        </div>
      )}
      {p.phasedOut?.length > 0 && (
        <div className="eng-count" title="Phased out — treated as though they don't exist until they phase in">
          ◌ phased out: {p.phasedOut.map((c) => c.name).join(', ')}
        </div>
      )}
    </div>
    )
  }

  // A hand whose cards are all hidden from this viewer (the computer's, an online
  // opponent's) isn't drawn at all — the count is on their rail and the space is
  // better spent on the battlefield. Visible hands are a compact fan: card tops
  // showing, a card rising on hover; right-click still zooms.
  // An empty hand is drawn as nothing rather than as an empty 84px strip: the
  // count is on the player's rail, and the row comes back with the next draw.
  const handHidden = (p) => p.hand.length === 0 || p.hand.every((c) => c.hidden)
  const handRow = (p) => (
    <div className={'eng-hand' + (handHidden(p) ? ' hidden' : '')} data-player={p.id}>
      {!handHidden(p) && p.hand.map((c) => {
        const a = actionFor(c.oid)
        const playable = kind === 'priority' && p.id === pending.player && !!a && a.type !== 'pass'
        const selecting =
          ((kind === 'discard' || kind === 'discardCards' || kind === 'bottom' || kind === 'putBack') &&
            p.id === pending.player) ||
          // Picking a card to discard as an additional cost (Grab the Prize).
          (needDiscard && p.id === pending.player && c.oid !== cast.action.oid)
        const chosen = discardSel.includes(c.oid) || bottomSel.includes(c.oid)
        return (
          <div className="eng-hand-slot" key={c.oid}>
            <EngineCard
              card={c}
              zone="hand"
              className={
                'eng-hand-card ' +
                (playable ? 'playable ' : '') +
                (selecting ? 'selectable ' : '') +
                (chosen ? 'chosen ' : '')
              }
              onClick={(ev) => onHandCard(c, p.id, ev)}
              onZoom={setZoom}
              onHover={setHover}
              title={
                kind === 'priority' && p.id === pending.player && !playable && pending.reasons?.[c.oid]
                  ? `${c.name} — can't play: ${pending.reasons[c.oid]}`
                  : undefined
              }
            />
          </div>
        )
      })}
    </div>
  )

  // A player's battlefield: creatures / other permanents / lands in bands, with
  // creatures fronting the centre line and lands at the player's outer edge.
  const battlefield = (p, place) => (
    <div className="battlefield eng-battlefield" data-player={p.id}>
      {p.battlefield.length === 0 && <div className="bf-hint">No permanents</div>}
      {(() => {
        const byName = (a, b) => a.name.localeCompare(b.name)
        const creatures = p.battlefield.filter(isCreature).sort(byName)
        const lands = p.battlefield.filter(isLand).sort(byName)
        const others = p.battlefield.filter((c) => !isCreature(c) && !isLand(c)).sort(byName)

        const cardRow = (list, cls, key) =>
          list.length ? (
            <div className={cls} key={key}>
              {list.map((c) => (
                <EngineCard
                  key={c.oid}
                  card={c}
                  zone="bf"
                  className={bfClass(c, p.id)}
                  onClick={(ev) => onBattlefieldCard(c, p.id, ev)}
                  onZoom={setZoom}
                  onHover={setHover}
                  title={c.name + (c.keywords?.length ? ' — ' + c.keywords.join(', ') : '')}
                />
              ))}
            </div>
          ) : null

        // Lands are rendered individually (not piled) so their tapped state is
        // always visible. The creature row is drawn even when empty: it is the
        // row that grows, and it is what holds the lands against the player's
        // own edge instead of letting them drift to the centre line.
        const landsEl = cardRow(lands, 'eng-lands', 'lands')
        const creaturesEl = cardRow(creatures, 'eng-creatures', 'creatures') || (
          <div className="eng-creatures" key="creatures" />
        )
        const othersEl = cardRow(others, 'eng-others', 'others')
        const bands =
          place === 'bottom'
            ? [creaturesEl, othersEl, landsEl]
            : [landsEl, othersEl, creaturesEl]
        return bands.filter(Boolean)
      })()}
    </div>
  )

  // A seat = one player's own end of the table: their rail down the outer edge,
  // their hand at the far edge, their battlefield facing the centre line.
  const seat = (p, place) => (
    <div className={'eng-seat ' + place} key={p.id}>
      {seatRail(p)}
      <div className="eng-seat-stack">
        {place === 'top' && handRow(p)}
        {battlefield(p, place)}
        {place === 'bottom' && handRow(p)}
      </div>
    </div>
  )

  // Whose stops the phase ladder shows: in a two-human hot-seat game, the player
  // who is deciding; otherwise the local seat.
  const stopSeat = mode === 'local' && !botSeats.length ? (pending.player ?? view.activePlayer) : mySeat
  const activeYield = yields[stopSeat]?.turn === view.turnNumber ? yields[stopSeat].kind : null
  const canYield = gameOn && !botSeats.includes(stopSeat)
  const inSetup = kind === 'mulligan' || kind === 'bottom' || kind === 'playOrDraw'

  return (
    <div className="play-area engine">
      <div className="eng-table">
        <div className="eng-center">
          {seat(top, 'top')}
          <div className="eng-seam" />
          {seat(bottom, 'bottom')}
          <StackOverlay
            stack={view.stack}
            targeting={!!(targeting && wantsSpell)}
            onItem={onStackItem}
            onZoom={setZoom}
          />
        </div>
        {/* The reference column: the turn's steps as a ladder, the card you are
            hovering, and the log. The ladder lives here rather than in a strip
            across the board, where it would cost every row of cards its height. */}
        <div className="eng-side">
          <div className="eng-side-turn">
            <span className="eng-turn" title={`Active player: ${view.players[view.activePlayer].name}`}>
              {inSetup ? (kind === 'playOrDraw' ? 'Play or draw' : 'Mulligan') : `Turn ${view.turnNumber}`}
            </span>
            {match && (
              <span className="eng-match" title={`Best of ${match.bestOf}`}>
                G{match.game} · {match.wins.join('–')}
              </span>
            )}
            {view.daytime && (
              <span
                className="eng-daynight"
                title={
                  view.daytime === 'day'
                    ? 'It is day: if the active player casts no spells this turn, it becomes night next turn.'
                    : 'It is night: if the active player casts two or more spells this turn, it becomes day next turn.'
                }
              >
                <HelperCard
                  def={view.helperCards[view.daytime]}
                  label={view.daytime === 'day' ? 'Day' : 'Night'}
                  onZoom={setZoom}
                  onHover={setHover}
                />
              </span>
            )}
          </div>
          {!inSetup && (
            <PhaseBar
              vertical
              step={view.step}
              oppTurn={view.activePlayer !== stopSeat}
              seat={stopSeat}
              stops={stops}
              toggleStop={toggleStop}
              canToggle={(mode === 'local' && !botSeats.includes(stopSeat)) || stopSeat === mySeat}
            />
          )}
          <Inspector card={hover || zoom} />
          <GameLog log={view.log || []} />
        </div>
      </div>

      {(kind === 'lookAtHand' || kind === 'chooseFromHand') && (
        <HandRevealOverlay
          pending={pending}
          targetName={view.players[pending.target]?.name}
          onPick={(oid) => choose({ oid })}
          onDecline={() => choose({ decline: true })}
          onOk={() => choose({})}
        />
      )}
      {kind === 'search' && (
        <SearchOverlay
          pending={pending}
          onPick={(oid) => choose({ pick: oid })}
          onNone={() => choose({ pick: null })}
        />
      )}

      {kind === 'scry' && myTurn && (
        <ScryOverlay
          pending={pending}
          bottom={scryBottom}
          setBottom={setScryBottom}
          onConfirm={(shuffle) => {
            if (pending.noBottom) {
              // Reorder: clicked cards first (in click order), the rest as they were.
              const all = pending.cards.map((c) => c.oid)
              choose({ toTop: [...scryBottom, ...all.filter((oid) => !scryBottom.includes(oid))], toBottom: [], shuffle: !!shuffle })
              return
            }
            const toTop = pending.cards.map((c) => c.oid).filter((oid) => !scryBottom.includes(oid))
            choose({ toBottom: scryBottom, toTop })
          }}
        />
      )}
      {kind === 'lookTop' && myTurn && (
        <LookTopOverlay
          pending={pending}
          picks={topSel}
          setPicks={setTopSel}
          onConfirm={() => choose({ picks: topSel })}
          onType={(type) => choose({ type })}
        />
      )}

      {zoneView && (
        <ZoneViewer
          title={`${view.players[zoneView.pid].name}'s ${zoneView.zone}`}
          cards={view.players[zoneView.pid][zoneView.zone]}
          castableFor={(oid) =>
            kind === 'priority' && zoneView.pid === pending.player
              ? pending.actions?.find(
                  (a) =>
                    (a.type === 'castFlashback' ||
                      a.type === 'castEscape' ||
                      a.type === 'castPlotted' ||
                      a.type === 'castDisturb' ||
                      a.type === 'unearth' ||
                      (a.type === 'cast' && zoneView.zone === 'command') ||
                      ((a.type === 'cast' || a.type === 'playLand') && a.fromExile)) &&
                    a.oid === oid
                )
              : null
          }
          onCast={(a) => {
            setZoneView(null)
            startAction(a)
          }}
          onZoom={setZoom}
          onClose={() => setZoneView(null)}
        />
      )}

      {zoom && (zoom.cardId || zoom.realCardId || zoom.token) && <ZoomOverlay card={zoom} onClose={() => setZoom(null)} />}
      {kind === 'chooseDungeon' && myTurn && (
        <div className="eng-scry">
          <div className="eng-scry-panel">
            <div className="eng-scry-title">Venture into the dungeon — choose a dungeon</div>
            <div className="eng-scry-cards">
              {pending.options.map((o) => (
                <div className="eng-scry-card" key={o.name} onClick={() => choose({ dungeon: o.name })} title={o.name}>
                  <HelperCard def={{ name: o.name, helper: true, scryfallId: o.scryfallId }} label={o.name} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {abilityMenu && (
        <div className="card-menu eng-ability-menu" style={{ left: abilityMenu.x, top: abilityMenu.y }}>
          <div className="menu-label">Choose ability</div>
          {abilityMenu.actions.map((a, i) => (
            <button key={i} onClick={() => startAction(a)}>
              {a.label
                ? a.label
                : a.loyalty != null
                  ? (a.loyalty > 0 ? `+${a.loyalty}` : `${a.loyalty}`) + ' loyalty'
                  : 'Activate'}
              {a.pays?.length > 0 && <span className="muted small"> — taps {a.pays.join(', ')}</span>}
            </button>
          ))}
          <button className="eng-menu-cancel" onClick={() => setAbilityMenu(null)}>
            Cancel
          </button>
        </div>
      )}


      <MotionLayer flights={flights} hits={hits} />

      {/* One strip at your end of the table: what the game is asking, and every
          control for answering it. It replaces the old turn bar and prompt bar,
          which cost the board two rows of height between them. */}
      <div className="eng-controls">
      <Prompt
        view={view}
        pending={pending}
        myTurn={myTurn}
        match={match}
        openSideboard={openSideboard}
        targeting={
          targeting
            ? {
                targets: targeting.targets,
                chosen: targeting.chosen,
                name: cast ? null : pending.name,
                cancelable: !!cast,
                // A "you may" trigger's target choice can be declined.
                decline: !cast && engineTargeting && pending.optional ? () => choose({ decline: true }) : null,
                variadic: variadic ? { min: variadic.min ?? 1, max: variadic.max } : null,
                confirm: variadicReady ? () => finalizeVariadic(targeting.chosen) : optionalReady ? finalizeOptional : null
              }
            : null
        }
        sacrificing={needSac ? { types: cast.action.sacChoose.types } : null}
        discarding={needDiscard}
        modal={modalPicking ? { count: cast.action.modal.count, modes: cast.action.modes, pick: pickModes } : null}
        choosingPips={
          needPips
            ? {
                hybrid: cast.action.hybrid || [],
                twobrid: cast.action.twobrid || [],
                pick: (pips) => {
                  const next = { ...cast, pips }
                  const a = cast.action
                  const more = a.sacChoose || a.discChoose || a.modal || (a.targets?.length || 0) > 0
                  if (more) setCast(next)
                  else finalizeCast(next, [])
                }
              }
            : null
        }
        attackPreview={
          kind === 'declareAttackers'
            ? Object.keys(attackers).map((oid) => {
                const c = cardByOid(oid)
                const blockers = (pending.canBeBlockedBy?.[oid] || []).map((b) => cardByOid(b)?.name || '?')
                return { name: c?.name || '?', power: c?.power || 0, blockers }
              })
            : null
        }
        choosingX={
          needX
            ? {
                value: xInput,
                max: cast.action.maxX,
                dec: () => setXInput((v) => Math.max(0, v - 1)),
                inc: () => setXInput((v) => Math.min(cast.action.maxX, v + 1)),
                confirm: () => setCast({ ...cast, x: xInput })
              }
            : null
        }
        attackers={attackers}
        band={{ on: bandAttack, toggle: () => setBandAttack((v) => !v), possible: Object.keys(attackers).length > 1 && Object.keys(attackers).some((oid) => cardByOid(oid)?.keywords?.includes('Banding')) }}
        proliferate={
          kind === 'proliferate'
            ? {
                count: prolifSel.length,
                confirm: () =>
                  choose({ picks: prolifSel.map((x) => (x.startsWith('p') ? { pid: Number(x.slice(1)) } : { oid: x })) })
              }
            : null
        }
        attackTargetName={attackTargetName}
        blocks={blocks}
        discardSel={discardSel}
        bottomSel={bottomSel}
        ninjutsu={ninjutsu}
        cancelNinjutsu={() => setNinjutsu(null)}
        error={error}
        choose={choose}
        endGame={() => endGame()}
        onMadnessCast={onMadnessCast}
        cancelCast={() => setCast(null)}
      />

        <div className="eng-controls-acts">
          {!myTurn && kind !== 'gameOver' && (
            <span className="eng-waiting">{botSeats.length ? 'Computer thinking…' : 'Waiting…'}</span>
          )}
          {!inSetup && (
            <span className="eng-yield">
              <button
                className={'mini' + (holds[stopSeat] ? ' on' : '')}
                disabled={!canYield}
                onClick={() => setHold(!holds[stopSeat])}
                title="Keep priority after your next spell or ability so you can respond to it yourself (or shift-click a card to cast). Used once."
              >
                {holds[stopSeat] ? 'Holding ✕' : 'Hold'}
              </button>
              {activeYield ? (
                <button className="mini on" onClick={() => setYield(null)} title="Cancel the yield (F3)">
                  {activeYield === 'all' ? 'Yielding all' : 'Passing turn'} ✕
                </button>
              ) : (
                <>
                  <button
                    className="mini"
                    disabled={!canYield}
                    onClick={() => setYield('turn')}
                    title="Pass the rest of this turn, but stop if the opponent does something you can respond to (F4)"
                  >
                    Pass turn
                  </button>
                  <button
                    className="mini"
                    disabled={!canYield}
                    onClick={() => setYield('all')}
                    title="Pass everything for the rest of this turn, responses included (F6)"
                  >
                    Yield all
                  </button>
                </>
              )}
            </span>
          )}
          <button className="mini" onClick={() => setShowStops((s) => !s)} title="Every stop, for your turn and the opponent's">
            Stops…
          </button>
          {confirmExit ? (
            <span className="eng-confirm">
              {mode === 'local' && !botSeats.length ? 'Exit this game?' : 'Concede?'}
              <button
                className="mini danger"
                onClick={() => {
                  setConfirmExit(false)
                  if ((mode === 'local' && !botSeats.length) || kind === 'gameOver') endGame()
                  else concede()
                }}
              >
                Yes
              </button>
              <button className="mini" onClick={() => setConfirmExit(false)}>
                No
              </button>
            </span>
          ) : (
            <button className="mini" onClick={() => setConfirmExit(true)} title="Concede the game and go back to deck selection">
              Concede
            </button>
          )}
          {showStops && (
            <StopsPanel
              stops={stops}
              toggleStop={toggleStop}
              players={view.players}
              canToggle={(pid) => (mode === 'local' && !botSeats.includes(pid)) || pid === mySeat}
              currentStep={view.step}
              onClose={() => setShowStops(false)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
