import React, { useEffect, useState } from 'react'
import { useEngineGame } from '../../store/engineGame.js'
import { EngineCard, Pile, ManaPool, isCreature, isLand } from './engine/EngineCard.jsx'
import Prompt from './engine/Prompt.jsx'
import { GameLog, StopsPanel } from './engine/Panels.jsx'
import { ZoneViewer, SearchOverlay, ScryOverlay, ZoomOverlay, StackOverlay } from './engine/Overlays.jsx'
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
  const mode = useEngineGame((s) => s.mode)
  const mySeat = useEngineGame((s) => s.netSeat)
  // Online: whether the local player is the one who currently must act.
  const myTurn = mode === 'local' || view?.pending?.player === mySeat
  const [showStops, setShowStops] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false) // "Concede?" two-step confirmation
  const [zoom, setZoom] = useState(null) // card being previewed (right-click)
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
  const [scryBottom, setScryBottom] = useState([]) // scry: oids to put on the bottom
  const [zoneView, setZoneView] = useState(null) // { pid, zone } graveyard/exile viewer
  const [xInput, setXInput] = useState(0) // X value being chosen for an X spell
  const [ninjutsu, setNinjutsu] = useState(null) // pending ninjutsu action awaiting an attacker

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
    setAbilityMenu(null)
    setZoneView(null)
    setXInput(0)
    setNinjutsu(null)
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
  const pendingKind = view?.pending?.kind
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
      if ((e.key === ' ' || e.key === 'Enter') && pendingKind === 'priority' && myTurn && !cast && !abilityMenu && !zoom) {
        e.preventDefault()
        choose({ type: 'pass' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, abilityMenu, cast, pendingKind, myTurn, chooseRaw]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const needSac = !!(cast && cast.action.sacChoose && !cast.sac && !needX)
  // A discard additional cost (Grab the Prize): pick a card from hand to pitch.
  const needDiscard = !!(cast && cast.action.discChoose && !cast.disc && !needX && !needSac)
  // A modal spell (Abrade, Cryptic Command): first pick `count` modes, then collect
  // targets for each selected mode in turn.
  const modalPicking = !!(cast && cast.action.modal && !cast.modes)
  const modalMode = cast && cast.action.modal && cast.modes ? cast.action.modes[cast.modes[cast.mtIdx]] : null
  // Normalise so `targeting.targets` / `.chosen` work for a player cast (specs live
  // on cast.action.targets, or the current modal mode) or an engine target choice.
  const targeting = needX || needSac || needDiscard || modalPicking
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
      choose({ type: 'activate', oid: a.oid, ability: a.ability, targets: chosen, sacrifice: c.sac, x: c.x })
    else if (a.type === 'madness') choose({ cast: true, targets: chosen })
    else if (a.type === 'castFlashback') choose({ type: 'castFlashback', oid: a.oid, targets: chosen })
    else if (a.type === 'castOmen') choose({ type: 'castOmen', oid: a.oid, targets: chosen })
    else if (a.type === 'castPlotted') choose({ type: 'castPlotted', oid: a.oid, targets: chosen })
    else if (a.type === 'castBestow') choose({ type: 'castBestow', oid: a.oid, targets: chosen, x: c.x })
    else
      choose({ type: 'cast', oid: a.oid, altCost: !!a.altCost, kicker: !!a.kicker, evoke: !!a.evoke, buyback: !!a.buyback, overload: !!a.overload, face: a.face, targets: chosen, sacrifice: c.sac, discard: c.disc, x: c.x })
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
      choose({ type: 'tapForMana', oid: a.oid, color: a.color })
      return
    }
    if (a.type === 'playLand' || a.type === 'plot' || a.type === 'cycle' || a.type === 'suspend' || a.type === 'crew' || a.type === 'unearth') {
      choose(a.type === 'playLand' ? a : { type: a.type, oid: a.oid })
      return
    }
    if (a.type === 'ninjutsu') {
      // Return an unblocked attacker; if there's only one choice, act immediately,
      // otherwise let the player click which attacker to return.
      if (a.returns.length === 1) choose({ type: 'ninjutsu', oid: a.oid, returned: a.returns[0] })
      else setNinjutsu(a)
      return
    }
    const needsSetup = a.needsTargets > 0 || a.sacChoose || a.discChoose || a.hasX || a.modal
    if (needsSetup) {
      setCast({ action: a, chosen: [], sac: null, disc: null, x: null })
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
    if ((kind === 'discard' || kind === 'discardCards') && pid === pending.player) {
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
      const acts = pending.actions.filter(
        (a) =>
          a.oid === card.oid &&
          ['cast', 'castBestow', 'castOmen', 'castFlashback', 'castFaceDown', 'playLand', 'plot', 'ninjutsu', 'cycle', 'suspend'].includes(a.type)
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
    // Ninjutsu: click which of your unblocked attackers to return to hand.
    if (ninjutsu) {
      if (ninjutsu.returns.includes(card.oid))
        choose({ type: 'ninjutsu', oid: ninjutsu.oid, returned: card.oid })
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
        (a) => (a.type === 'activate' || a.type === 'turnFaceUp' || a.type === 'tapForMana' || a.type === 'crew') && a.oid === card.oid
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
        setBlocks((b) => ({ ...b, [pickBlocker]: card.oid }))
        setPickBlocker(null)
      }
    }
  }

  function onPlayerTarget(pid) {
    if (!myTurn) return
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
    if (kind === 'copyEnter' && pending.choices.includes(card.oid)) cls.push('targetable')
    if (!targeting && !needSac && kind === 'priority' && controllerPid === pending.player) {
      if (pending.actions.some((a) => a.type === 'activate' && a.oid === card.oid)) cls.push('activatable')
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

  // Player status + zones live in the left sidebar, one block per player.
  const statusColumn = (p) => (
    <div
      className={'eng-status' + (view.activePlayer === p.id ? ' active' : '')}
      key={p.id}
    >
      <div className="eng-status-name">
        {p.name}
        {view.activePlayer === p.id && <span className="pp-active-dot" title="Active player" />}
        {view.priorityPlayer === p.id && <span className="eng-prio-dot" title="Has priority" />}
      </div>
      <div className="eng-status-stats">
        <span
          className={'eng-life ' + (targeting && wantsPlayer ? 'targetable' : '')}
          onClick={() => onPlayerTarget(p.id)}
          title={targeting && wantsPlayer ? 'Target this player' : 'Life'}
        >
          ❤ {p.life}
        </span>
        <span className="eng-count" title="Cards in hand">
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
      <ManaPool pool={p.manaPool} />
      <div className="eng-zones">
        <Pile label="Library" count={p.libraryCount} faceDown />
        <Pile
          label="Graveyard"
          count={p.graveyard.length}
          topCard={p.graveyard[p.graveyard.length - 1]}
          onOpen={() => setZoneView({ pid: p.id, zone: 'graveyard' })}
        />
        <Pile
          label="Exile"
          count={p.exile.length}
          topCard={p.exile[p.exile.length - 1]}
          onOpen={() => setZoneView({ pid: p.id, zone: 'exile' })}
        />
        {view.format === 'commander' && (
          <Pile
            label={`Command${p.command?.[0]?.commanderCasts ? ` (tax ${2 * p.command[0].commanderCasts})` : ''}`}
            count={p.command?.length || 0}
            topCard={p.command?.[0]}
            onOpen={() => setZoneView({ pid: p.id, zone: 'command' })}
          />
        )}
      </div>
      {p.phasedOut?.length > 0 && (
        <div className="eng-count" title="Phased out — treated as though they don't exist until they phase in">
          ◌ phased out: {p.phasedOut.map((c) => c.name).join(', ')}
        </div>
      )}
      {Object.keys(p.commanderDamage || {}).length > 0 && (
        <div className="eng-count" title="Combat damage taken from each commander (21 loses)">
          ⚔ commander damage: {Object.values(p.commanderDamage).join(' / ')}
        </div>
      )}
    </div>
  )

  const handRow = (p) => (
    <div className="eng-hand" data-player={p.id}>
      {p.hand.map((c) => {
        const a = actionFor(c.oid)
        const playable = kind === 'priority' && p.id === pending.player && !!a && a.type !== 'pass'
        const selecting =
          ((kind === 'discard' || kind === 'discardCards' || kind === 'bottom') &&
            p.id === pending.player) ||
          // Picking a card to discard as an additional cost (Grab the Prize).
          (needDiscard && p.id === pending.player && c.oid !== cast.action.oid)
        const chosen = discardSel.includes(c.oid) || bottomSel.includes(c.oid)
        return (
          <EngineCard
            key={c.oid}
            card={c}
            className={
              'eng-hand-card ' +
              (playable ? 'playable ' : '') +
              (selecting ? 'selectable ' : '') +
              (chosen ? 'chosen ' : '')
            }
            onClick={(ev) => onHandCard(c, p.id, ev)}
            onZoom={setZoom}
          />
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
                  className={bfClass(c, p.id)}
                  onClick={(ev) => onBattlefieldCard(c, p.id, ev)}
                  onZoom={setZoom}
                  title={c.name + (c.keywords?.length ? ' — ' + c.keywords.join(', ') : '')}
                />
              ))}
            </div>
          ) : null

        // Lands are rendered individually (not piled) so their tapped state is
        // always visible.
        const landsEl = cardRow(lands, 'eng-lands', 'lands')
        const creaturesEl = cardRow(creatures, 'eng-creatures', 'creatures')
        const othersEl = cardRow(others, 'eng-others', 'others')
        const bands =
          place === 'bottom'
            ? [creaturesEl, othersEl, landsEl]
            : [landsEl, othersEl, creaturesEl]
        return bands.filter(Boolean)
      })()}
    </div>
  )

  // A seat = one player's hand + battlefield. Hands sit at the outer edges
  // (top player's above their board, bottom player's below), battlefields meet
  // in the middle.
  const seat = (p, place) => (
    <div className={'eng-seat ' + place} key={p.id}>
      {place === 'top' && handRow(p)}
      {battlefield(p, place)}
      {place === 'bottom' && handRow(p)}
    </div>
  )

  return (
    <div className="play-area engine">
      <div className="turnbar eng-turnbar">
        {kind === 'mulligan' || kind === 'bottom' ? (
          <span className="phase-pill on">Mulligan</span>
        ) : (
          <>
            <span className="eng-turn">Turn {view.turnNumber}</span>
            <span className="phase-pill on">{STEP_LABEL[view.step] || view.step}</span>
            <span className="eng-active">Active: {view.players[view.activePlayer].name}</span>
          </>
        )}
        {mode !== 'local' && !myTurn && kind !== 'gameOver' && (
          <span className="eng-waiting">Waiting for opponent…</span>
        )}
        <div className="turn-active">
          <button className="mini" onClick={() => setShowStops((s) => !s)}>
            ⏹ Stops
          </button>
          {confirmExit ? (
            <span className="eng-confirm">
              {mode === 'local' ? 'Exit this game?' : 'Concede the game?'}
              <button
                className="mini danger"
                onClick={() => {
                  setConfirmExit(false)
                  if (mode === 'local' || kind === 'gameOver') endGame()
                  else concede()
                }}
              >
                Yes, concede
              </button>
              <button className="mini" onClick={() => setConfirmExit(false)}>
                No
              </button>
            </span>
          ) : (
            <button className="mini" onClick={() => setConfirmExit(true)}>
              Concede / exit
            </button>
          )}
        </div>
        {showStops && (
          <StopsPanel
            stops={stops}
            toggleStop={toggleStop}
            players={view.players}
            canToggle={(pid) => mode === 'local' || pid === mySeat}
            currentStep={view.step}
            onClose={() => setShowStops(false)}
          />
        )}
      </div>

      <div className="eng-table">
        <div className="eng-sidebar">
          {statusColumn(top)}
          {statusColumn(bottom)}
          <GameLog log={view.log || []} />
        </div>
        <div className="eng-center">
          {seat(top, 'top')}
          {seat(bottom, 'bottom')}
        </div>
      </div>

      <StackOverlay
        stack={view.stack}
        targeting={!!(targeting && wantsSpell)}
        onItem={onStackItem}
        onZoom={setZoom}
      />

      {kind === 'search' && (
        <SearchOverlay
          pending={pending}
          onPick={(oid) => choose({ pick: oid })}
          onNone={() => choose({ pick: null })}
        />
      )}

      {kind === 'scry' && (
        <ScryOverlay
          pending={pending}
          bottom={scryBottom}
          setBottom={setScryBottom}
          onConfirm={() => {
            const toTop = pending.cards.map((c) => c.oid).filter((oid) => !scryBottom.includes(oid))
            choose({ toBottom: scryBottom, toTop })
          }}
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
                    (a.type === 'castFlashback' || a.type === 'castPlotted' || a.type === 'unearth' || (a.type === 'cast' && zoneView.zone === 'command')) &&
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
            </button>
          ))}
          <button className="eng-menu-cancel" onClick={() => setAbilityMenu(null)}>
            Cancel
          </button>
        </div>
      )}


      <Prompt
        view={view}
        pending={pending}
        myTurn={myTurn}
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
                confirm: variadicReady ? () => finalizeVariadic(targeting.chosen) : null
              }
            : null
        }
        sacrificing={needSac ? { types: cast.action.sacChoose.types } : null}
        discarding={needDiscard}
        modal={modalPicking ? { count: cast.action.modal.count, modes: cast.action.modes, pick: pickModes } : null}
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
    </div>
  )
}
