import React, { useEffect, useState } from 'react'
import { useEngineGame, PRIORITY_STEPS } from '../../store/engineGame.js'
import { useTokenArt, tokenKey } from '../../store/tokenArt.js'
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

const cardImg = (c) => (c.cardId ? `card://${c.cardId}` : null)
const isCreature = (c) => c.types?.includes('Creature')
const isLand = (c) => c.types?.includes('Land')

// A stack of same-named lands, shown compactly with an untapped/total badge.
function LandPile({ pile, onZoom }) {
  const untapped = pile.cards.filter((c) => !c.tapped).length
  const total = pile.cards.length
  const rep = pile.cards.find((c) => !c.tapped) || pile.cards[0]
  return (
    <div
      className={'eng-land-pile' + (total > 1 ? ' stacked' : '')}
      title={`${pile.name} — ${untapped}/${total} untapped`}
      onContextMenu={(e) => {
        e.preventDefault()
        if (rep.cardId) onZoom(rep)
      }}
    >
      <div className="board-card">
        {rep.cardId ? (
          <img src={cardImg(rep)} alt={pile.name} draggable={false} />
        ) : (
          <div className="cardback" />
        )}
      </div>
      <span className="eng-pile-badge">
        {untapped}/{total}
      </span>
    </div>
  )
}

// One permanent / stack card, styled from play.css .board-card.
// Right-click zooms (via onZoom); left-click acts (via onClick).
function EngineCard({ card, className = '', onClick, onZoom, title }) {
  // Tokens have no fixed printing — resolve their art from the token-art store.
  const key = card.token && card.tokenDef ? tokenKey(card.tokenDef) : null
  const artId = useTokenArt((s) => (key ? s.cache[key]?.chosenId : null))
  const ensure = useTokenArt((s) => s.ensure)
  useEffect(() => {
    if (key) ensure(card.tokenDef)
  }, [key, ensure]) // eslint-disable-line react-hooks/exhaustive-deps
  const imgId = card.token ? artId : card.cardId
  const img = imgId ? `card://${imgId}` : null
  const pt = card.power != null ? `${card.power}/${card.toughness}` : null
  return (
    <div
      className={'board-card ' + (card.tapped ? 'tapped ' : '') + className}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault()
        onZoom?.(card)
      }}
      title={title || card.name}
    >
      {img ? <img src={img} alt={card.name} draggable={false} /> : <div className="cardback" />}
      {isCreature(card) && pt && <span className="eng-pt">{pt}</span>}
      {card.damage > 0 && <span className="eng-dmg">{card.damage}</span>}
      {card.loyalty != null && <span className="eng-loyalty">◆ {card.loyalty}</span>}
    </div>
  )
}

function Pile({ label, count, topCard, faceDown, onOpen }) {
  return (
    <div className="rail-pile">
      <div
        className="rail-pile-card"
        title={`${label} (${count})`}
        onClick={onOpen}
        style={onOpen ? { cursor: 'pointer' } : undefined}
      >
        {count === 0 ? (
          <div className="pile-empty" />
        ) : faceDown || !topCard?.cardId ? (
          <div className="cardback" />
        ) : (
          <img src={cardImg(topCard)} alt="" draggable={false} />
        )}
        <span className="pile-count">{count}</span>
      </div>
      <div className="rail-pile-label">{label}</div>
    </div>
  )
}

function ManaPool({ pool }) {
  const COLORS = { W: '#f6f3e0', U: '#b3d5f2', B: '#c9c1cf', R: '#f0b0a0', G: '#a8d6ab', C: '#cfc9c1' }
  const active = Object.entries(pool || {}).filter(([, n]) => n > 0)
  if (active.length === 0) return null
  return (
    <span className="eng-mana">
      {active.map(([c, n]) => (
        <span key={c} className="eng-mana-pip" style={{ background: COLORS[c] }}>
          {n}
          {c}
        </span>
      ))}
    </span>
  )
}

export default function EnginePlayArea() {
  const view = useEngineGame((s) => s.view)
  const error = useEngineGame((s) => s.error)
  const choose = useEngineGame((s) => s.choose)
  const endGame = useEngineGame((s) => s.endGame)
  const stops = useEngineGame((s) => s.stops)
  const toggleStop = useEngineGame((s) => s.toggleStop)
  const [showStops, setShowStops] = useState(false)
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

  useEffect(() => {
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
  }, [view])

  useEffect(() => {
    if (!zoom) return
    const onKey = (e) => e.key === 'Escape' && setZoom(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  if (!view) return null
  const pending = view.pending || {}
  const kind = pending.kind
  const defenderPid = view.activePlayer === 0 ? 1 : 0
  const actionFor = (oid) =>
    kind === 'priority' ? pending.actions?.find((a) => a.oid === oid) : null

  // Human-readable name of what new attackers will be sent at.
  const attackTargetName =
    kind === 'declareAttackers'
      ? !attackTarget || attackTarget.player != null
        ? view.players[defenderPid]?.name
        : pending.defenders?.find((d) => d.oid === attackTarget.planeswalker)?.name || 'planeswalker'
      : null

  // ---- targeting helpers ----
  // Unifies player-initiated targeting (cast/activate) with engine-initiated
  // target choices (a triggered ability's `chooseTargets` decision).
  const engineTargeting = kind === 'chooseTargets'
  // A cast/activate can require choosing a permanent to sacrifice (a cost) before
  // its targets. While that's pending we're in "sacrifice" mode, not targeting.
  const needSac = !!(cast && cast.action.sacChoose && !cast.sac)
  // Normalise so `targeting.targets` / `.chosen` work for both a player cast
  // (specs live on cast.action.targets) and an engine-initiated target choice.
  const targeting = needSac
    ? null
    : cast
      ? { targets: cast.action.targets, chosen: cast.chosen }
      : engineTargeting
        ? { targets: pending.targets, chosen: chooseSel }
        : null
  const targetSlot = targeting ? targeting.targets[targeting.chosen.length] : null
  const wantsCreature = targetSlot && (targetSlot.type === 'creature' || targetSlot.type === 'any')
  const wantsPlayer = targetSlot && (targetSlot.type === 'player' || targetSlot.type === 'any')
  const wantsSpell = targetSlot && targetSlot.type === 'spell'
  const wantsLand = targetSlot && targetSlot.type === 'land'

  // Fire the assembled cast/activate (with its chosen targets and sacrifice).
  function finalizeCast(c, chosen) {
    const a = c.action
    if (a.type === 'activate')
      choose({ type: 'activate', oid: a.oid, ability: a.ability, targets: chosen, sacrifice: c.sac })
    else if (a.type === 'madness') choose({ cast: true, targets: chosen })
    else if (a.type === 'castFlashback') choose({ type: 'castFlashback', oid: a.oid, targets: chosen })
    else choose({ type: 'cast', oid: a.oid, targets: chosen, sacrifice: c.sac })
  }

  function addTarget(t) {
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

  // Pick a permanent to sacrifice as part of a cost; then continue to targets.
  function chooseSacrifice(card) {
    const next = { ...cast, sac: card.oid }
    if (next.action.targets.length === 0) finalizeCast(next, [])
    else setCast(next)
  }

  // Begin an activated ability: enter targeting if it needs a target, else fire.
  function startActivate(a) {
    setAbilityMenu(null)
    if (a.needsTargets > 0 || a.sacChoose) setCast({ action: a, chosen: [], sac: null })
    else choose({ type: 'activate', oid: a.oid, ability: a.ability, targets: [] })
  }

  // Cast a madness card: target if needed, else fire immediately.
  function onMadnessCast(m) {
    if (m.targets?.length > 0) setCast({ action: { type: 'madness', targets: m.targets }, chosen: [] })
    else choose({ cast: true })
  }

  // ---- click dispatch ----
  function onHandCard(card, pid) {
    if ((kind === 'discard' || kind === 'discardCards') && pid === pending.player) {
      setDiscardSel((sel) =>
        sel.includes(card.oid) ? sel.filter((o) => o !== card.oid) : [...sel, card.oid]
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
    if (targeting || needSac) return
    if (kind === 'priority' && pid === pending.player) {
      const a = actionFor(card.oid)
      if (!a) return
      if (a.type === 'playLand') choose(a)
      else if (a.type === 'cast') {
        if (a.needsTargets > 0 || a.sacChoose) setCast({ action: a, chosen: [], sac: null })
        else choose({ type: 'cast', oid: a.oid })
      }
    }
  }

  function onBattlefieldCard(card, controllerPid, ev) {
    // Choosing a permanent to sacrifice (a cost) — click one you control that matches.
    if (needSac) {
      if (controllerPid === pending.player && (cast.action.sacChoose.types || []).some((t) => card.types.includes(t)))
        chooseSacrifice(card)
      return
    }
    if (targeting) {
      if (wantsCreature && isCreature(card)) addTarget({ kind: 'object', oid: card.oid })
      else if (wantsLand && isLand(card)) addTarget({ kind: 'object', oid: card.oid })
      return
    }
    // Activate an ability of a permanent you control. If it has more than one
    // activatable ability (e.g. a planeswalker), pop a picker.
    if (kind === 'priority' && controllerPid === pending.player) {
      const acts = pending.actions.filter((a) => a.type === 'activate' && a.oid === card.oid)
      if (acts.length === 1) startActivate(acts[0])
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
    if (targeting && wantsPlayer) {
      addTarget({ kind: 'player', pid })
      return
    }
    // During attacker declaration, clicking the defending player targets them.
    if (kind === 'declareAttackers' && pid !== view.activePlayer) setAttackTarget({ player: pid })
  }

  function onStackItem(item) {
    if (targeting && wantsSpell) addTarget({ kind: 'spell', oid: item.oid })
  }

  // Class flags for a battlefield card given the current mode.
  function bfClass(card, controllerPid) {
    const cls = []
    if (card.attacking) cls.push('atk')
    if (card.blocking) cls.push('blk')
    if (isCreature(card) && card.summoningSick && controllerPid === view.activePlayer) cls.push('sick')
    if (targeting && wantsCreature && isCreature(card)) cls.push('targetable')
    if (targeting && wantsLand && isLand(card)) cls.push('targetable')
    if (needSac && controllerPid === pending.player && (cast.action.sacChoose.types || []).some((t) => card.types.includes(t)))
      cls.push('targetable')
    if (!targeting && !needSac && kind === 'priority' && controllerPid === pending.player && actionFor(card.oid)?.type === 'activate')
      cls.push('activatable')
    if (kind === 'declareAttackers') {
      if (controllerPid === view.activePlayer && pending.eligible.includes(card.oid))
        cls.push('selectable', attackers[card.oid] ? 'chosen' : '')
      if (controllerPid !== view.activePlayer && card.loyalty != null)
        cls.push('selectable', attackTarget?.planeswalker === card.oid ? 'assigned' : '')
    }
    if (kind === 'declareBlockers') {
      if (controllerPid === pending.player && pending.eligible.includes(card.oid))
        cls.push('selectable', pickBlocker === card.oid ? 'chosen' : '', blocks[card.oid] ? 'assigned' : '')
      if (card.attacking && pickBlocker != null) cls.push('targetable')
    }
    return cls.join(' ')
  }

  const top = view.players[1]
  const bottom = view.players[0]

  const seat = (p, place) => (
    <div className={'eng-seat ' + place} key={p.id}>
      <div className="eng-hand" data-player={p.id}>
        {p.hand.map((c) => {
          const a = actionFor(c.oid)
          const playable = kind === 'priority' && p.id === pending.player && !!a && a.type !== 'pass'
          const selecting =
            (kind === 'discard' || kind === 'discardCards' || kind === 'bottom') &&
            p.id === pending.player
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
              onClick={() => onHandCard(c, p.id)}
              onZoom={setZoom}
            />
          )
        })}
      </div>

      <div className="eng-panel">
        <span className="pp-name">
          {p.name}
          {view.activePlayer === p.id && <span className="pp-active-dot" title="Active player" />}
          {view.priorityPlayer === p.id && <span className="eng-prio-dot" title="Has priority" />}
        </span>
        <span
          className={'eng-life ' + (targeting && wantsPlayer ? 'targetable' : '')}
          onClick={() => onPlayerTarget(p.id)}
          title={targeting && wantsPlayer ? 'Target this player' : 'Life'}
        >
          ❤ {p.life}
        </span>
        <ManaPool pool={p.manaPool} />
        <span className="eng-count" title="Cards in hand">
          ✋ {p.handCount}
        </span>
      </div>

      <div className="eng-body">
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

            // Lands stacked into per-name piles.
            const piles = []
            for (const c of lands) {
              const p0 = piles.find((x) => x.name === c.name)
              if (p0) p0.cards.push(c)
              else piles.push({ name: c.name, cards: [c] })
            }
            // While targeting a land, show lands individually so each is clickable.
            const landsEl = lands.length
              ? targeting && wantsLand
                ? cardRow(lands, 'eng-lands', 'lands')
                : (
                    <div className="eng-lands" key="lands">
                      {piles.map((pile) => (
                        <LandPile key={pile.name} pile={pile} onZoom={setZoom} />
                      ))}
                    </div>
                  )
              : null

            const creaturesEl = cardRow(creatures, 'eng-creatures', 'creatures')
            const othersEl = cardRow(others, 'eng-others', 'others')
            // Creatures front the centre line; other permanents behind them;
            // lands at the player's outer edge.
            const bands =
              place === 'bottom'
                ? [creaturesEl, othersEl, landsEl]
                : [landsEl, othersEl, creaturesEl]
            return bands.filter(Boolean)
          })()}
        </div>
        <div className="right-rail eng-rail">
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
        </div>
      </div>
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
        <div className="turn-active">
          <button className="mini" onClick={() => setShowStops((s) => !s)}>
            ⏹ Stops
          </button>
          <button className="mini" onClick={endGame}>
            Concede / exit
          </button>
        </div>
        {showStops && (
          <StopsPanel
            stops={stops}
            toggleStop={toggleStop}
            players={view.players}
            currentStep={view.step}
            onClose={() => setShowStops(false)}
          />
        )}
      </div>

      {seat(top, 'top')}
      {seat(bottom, 'bottom')}

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
          flashbackFor={(oid) =>
            kind === 'priority' && zoneView.pid === pending.player
              ? pending.actions?.find((a) => a.type === 'castFlashback' && a.oid === oid)
              : null
          }
          onFlashback={(a) => {
            setZoneView(null)
            if (a.needsTargets > 0) setCast({ action: a, chosen: [] })
            else choose({ type: 'castFlashback', oid: a.oid, targets: [] })
          }}
          onZoom={setZoom}
          onClose={() => setZoneView(null)}
        />
      )}

      {zoom && (zoom.cardId || zoom.token) && <ZoomOverlay card={zoom} onClose={() => setZoom(null)} />}

      {abilityMenu && (
        <div className="card-menu eng-ability-menu" style={{ left: abilityMenu.x, top: abilityMenu.y }}>
          <div className="menu-label">Choose ability</div>
          {abilityMenu.actions.map((a, i) => (
            <button key={i} onClick={() => startActivate(a)}>
              {a.loyalty != null ? (a.loyalty > 0 ? `+${a.loyalty}` : `${a.loyalty}`) + ' loyalty' : 'Activate'}
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
        targeting={
          targeting
            ? { targets: targeting.targets, chosen: targeting.chosen, name: cast ? null : pending.name, cancelable: !!cast }
            : null
        }
        sacrificing={needSac ? { types: cast.action.sacChoose.types } : null}
        attackers={attackers}
        attackTargetName={attackTargetName}
        blocks={blocks}
        discardSel={discardSel}
        bottomSel={bottomSel}
        error={error}
        choose={choose}
        endGame={endGame}
        onMadnessCast={onMadnessCast}
        cancelCast={() => setCast(null)}
      />
    </div>
  )
}

// The contextual action bar at the bottom — what the current decision needs.
function Prompt({ view, pending, targeting, sacrificing, attackers, attackTargetName, blocks, discardSel, bottomSel, error, choose, endGame, onMadnessCast, cancelCast }) {
  const kind = pending.kind
  const nameOf = (pid) => view.players[pid]?.name

  let body = null
  if (sacrificing) {
    body = (
      <>
        <span>Choose {sacrificing.types.join(' or ').toLowerCase()} to sacrifice.</span>
        <button className="mini" onClick={cancelCast}>
          Cancel
        </button>
      </>
    )
  } else if (kind === 'mulligan') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — keep this hand{pending.mulligans > 0 ? ` (mulligans taken: ${pending.mulligans}, would bottom ${pending.mulligans})` : ''}?
        </span>
        <button className="primary" onClick={() => choose({ keep: true })}>
          Keep
        </button>
        <button className="mini" onClick={() => choose({ keep: false })}>
          Mulligan
        </button>
      </>
    )
  } else if (kind === 'bottom') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — put {pending.count} card(s) on the bottom (
          {bottomSel.length}/{pending.count}).
        </span>
        <button
          className="primary"
          disabled={bottomSel.length !== pending.count}
          onClick={() => choose({ bottom: bottomSel })}
        >
          Confirm
        </button>
      </>
    )
  } else if (targeting) {
    const slot = targeting.targets[targeting.chosen.length]
    body = (
      <>
        <span>
          {targeting.name ? <b>{targeting.name}</b> : 'Choose target'} — target{' '}
          {targeting.chosen.length + 1}/{targeting.targets.length} ({slot.type})
        </span>
        {targeting.cancelable && (
          <button className="mini" onClick={cancelCast}>
            Cancel
          </button>
        )}
      </>
    )
  } else if (kind === 'priority') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> has priority — click a card to play it, or pass.
        </span>
        <button className="primary" onClick={() => choose({ type: 'pass' })}>
          Pass priority
        </button>
      </>
    )
  } else if (kind === 'declareAttackers') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — declare attackers ({Object.keys(attackers).length} selected)
          {pending.defenders?.length > 1 && (
            <>
              {' '}
              · attacking <b>{attackTargetName}</b> (click a planeswalker or the player to retarget)
            </>
          )}
          .
        </span>
        <button
          className="primary"
          onClick={() =>
            choose({
              attackers: Object.entries(attackers).map(([oid, defender]) => ({ oid, defender }))
            })
          }
          disabled={Object.keys(attackers).length === 0}
        >
          Attack
        </button>
        <button className="mini" onClick={() => choose({ attackers: [] })}>
          No attacks
        </button>
      </>
    )
  } else if (kind === 'declareBlockers') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — click a blocker, then the attacker it blocks (
          {Object.keys(blocks).length} assigned).
        </span>
        <button className="primary" onClick={() => choose({ blocks })}>
          Confirm blocks
        </button>
        <button className="mini" onClick={() => choose({ blocks: {} })}>
          No blocks
        </button>
      </>
    )
  } else if (kind === 'discard') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — discard {pending.count} card(s) ({discardSel.length}/
          {pending.count}).
        </span>
        <button
          className="primary"
          disabled={discardSel.length !== pending.count}
          onClick={() => choose({ discard: discardSel })}
        >
          Discard
        </button>
      </>
    )
  } else if (kind === 'mayPay') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — pay {pending.cost}?
        </span>
        <button className="primary" disabled={!pending.canPay} onClick={() => choose({ pay: true })}>
          Pay {pending.cost}
        </button>
        <button className="mini" onClick={() => choose({ pay: false })}>
          Decline
        </button>
      </>
    )
  } else if (kind === 'discardCards') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — discard {pending.count} card(s) ({discardSel.length}/
          {pending.count}).
        </span>
        <button
          className="primary"
          disabled={discardSel.length !== Math.min(pending.count, pending.hand.length)}
          onClick={() => choose({ discard: discardSel })}
        >
          Discard
        </button>
      </>
    )
  } else if (kind === 'madness') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — cast <b>{pending.name}</b> for its madness cost{' '}
          {pending.cost}?
        </span>
        <button className="primary" disabled={!pending.canPay} onClick={() => onMadnessCast(pending)}>
          Cast (madness)
        </button>
        <button className="mini" onClick={() => choose({ cast: false })}>
          Decline
        </button>
      </>
    )
  } else if (kind === 'gameOver') {
    body = (
      <>
        <span className="eng-win">🏆 {nameOf(pending.winner)} wins!</span>
        <button className="primary" onClick={endGame}>
          New game
        </button>
      </>
    )
  }

  return (
    <div className="eng-prompt">
      {error && <span className="eng-error">{error}</span>}
      {body}
    </div>
  )
}

// Graveyard / exile viewer. Cards with a flashback cast available are highlighted
// and clickable.
function ZoneViewer({ title, cards, flashbackFor, onFlashback, onZoom, onClose }) {
  return (
    <div className="eng-zoneviewer" onClick={onClose}>
      <div className="eng-zoneviewer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="eng-zoneviewer-head">
          <span style={{ textTransform: 'capitalize' }}>{title}</span>
          <button className="mini" onClick={onClose}>
            ✕
          </button>
        </div>
        {cards.length === 0 ? (
          <p className="muted">Empty.</p>
        ) : (
          <div className="eng-zoneviewer-grid">
            {cards.map((c) => {
              const fb = flashbackFor(c.oid)
              return (
                <div
                  key={c.oid}
                  className={'eng-zoneviewer-card' + (fb ? ' castable' : '')}
                  onClick={() => fb && onFlashback(fb)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (c.cardId) onZoom(c)
                  }}
                  title={fb ? `Flashback: ${c.name}` : c.name}
                >
                  {c.cardId ? <img src={`card://${c.cardId}`} alt={c.name} /> : <div className="cardback" />}
                  {fb && <span className="eng-zoneviewer-fb">Flashback</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// Library search: pick one card (deduped by name), or take nothing if optional.
function SearchOverlay({ pending, onPick, onNone }) {
  const unique = []
  const seen = new Set()
  for (const c of pending.cards) {
    if (!seen.has(c.name)) {
      seen.add(c.name)
      unique.push(c)
    }
  }
  return (
    <div className="eng-scry">
      <div className="eng-scry-panel">
        <div className="eng-scry-title">
          Search your library — choose a card{pending.optional ? ' (or take nothing)' : ''}
        </div>
        <div className="eng-scry-cards">
          {unique.map((c) => (
            <div className="eng-scry-card" key={c.oid} onClick={() => onPick(c.oid)} title={c.name}>
              {c.cardId ? <img src={`card://${c.cardId}`} alt={c.name} /> : <div className="cardback" />}
              <div className="eng-scry-dest">{c.name}</div>
            </div>
          ))}
        </div>
        {pending.optional && (
          <button className="mini" onClick={onNone}>
            Take nothing
          </button>
        )}
      </div>
    </div>
  )
}

// Scry / Surveil: look at the top cards and send some to the bottom (or the
// graveyard, for surveil). The rest stay on top in shown order.
function ScryOverlay({ pending, bottom, setBottom, onConfirm }) {
  const toggle = (oid) =>
    setBottom((b) => (b.includes(oid) ? b.filter((o) => o !== oid) : [...b, oid]))
  const dest = pending.surveil ? 'graveyard' : 'bottom'
  return (
    <div className="eng-scry">
      <div className="eng-scry-panel">
        <div className="eng-scry-title">
          {pending.surveil ? 'Surveil' : 'Scry'} {pending.cards.length} — click a card to send it to
          the {dest}
        </div>
        <div className="eng-scry-cards">
          {pending.cards.map((c) => {
            const toBottom = bottom.includes(c.oid)
            return (
              <div
                key={c.oid}
                className={'eng-scry-card' + (toBottom ? ' to-bottom' : '')}
                onClick={() => toggle(c.oid)}
                title={c.name}
              >
                {c.cardId ? <img src={`card://${c.cardId}`} alt={c.name} /> : <div className="cardback" />}
                <div className="eng-scry-dest">{toBottom ? dest : 'top'}</div>
              </div>
            )
          })}
        </div>
        <button className="primary" onClick={onConfirm}>
          Confirm
        </button>
      </div>
    </div>
  )
}

// Zoom preview. For tokens, arrows cycle through Scryfall art variants and the
// choice is remembered for future tokens of the same type.
function ZoomOverlay({ card, onClose }) {
  const key = card.token && card.tokenDef ? tokenKey(card.tokenDef) : null
  const entry = useTokenArt((s) => (key ? s.cache[key] : null))
  const ensure = useTokenArt((s) => s.ensure)
  const cycle = useTokenArt((s) => s.cycle)
  useEffect(() => {
    if (key) ensure(card.tokenDef)
  }, [key, ensure]) // eslint-disable-line react-hooks/exhaustive-deps

  const imgId = card.token ? entry?.chosenId : card.cardId
  const prints = entry?.prints || []
  const canCycle = card.token && prints.length > 1
  const idx = imgId ? prints.findIndex((p) => p.id === imgId) : -1

  return (
    <div className="eng-zoom" onClick={onClose} title="Click to close">
      {canCycle && (
        <button
          className="eng-zoom-arrow"
          onClick={(e) => {
            e.stopPropagation()
            cycle(key, -1)
          }}
        >
          ‹
        </button>
      )}
      <div className="eng-zoom-body" onClick={(e) => card.token && e.stopPropagation()}>
        {imgId ? (
          <img src={`card://${imgId}`} alt={card.name} />
        ) : (
          <div className="eng-zoom-placeholder">
            {card.token ? (entry?.loading ? 'Finding token art…' : 'No art found') : ''}
          </div>
        )}
        {card.token && (
          <div className="eng-zoom-hint">
            {prints.length > 1
              ? `${card.name} token — art ${idx + 1}/${prints.length} (use ‹ ›, remembered)`
              : `${card.name} token`}
          </div>
        )}
      </div>
      {canCycle && (
        <button
          className="eng-zoom-arrow"
          onClick={(e) => {
            e.stopPropagation()
            cycle(key, 1)
          }}
        >
          ›
        </button>
      )}
    </div>
  )
}

// Floating stack, top-of-stack first ("resolves next"). Hidden when empty.
function StackOverlay({ stack, targeting, onItem, onZoom }) {
  if (!stack.length) return null
  const topFirst = [...stack].reverse()
  return (
    <div className="eng-stack-overlay">
      <div className="eng-stack-title">Stack ({stack.length})</div>
      {topFirst.map((item, i) => (
        <div
          key={item.oid}
          className={'eng-stack-card ' + (targeting ? 'targetable ' : '') + (i === 0 ? 'top' : '')}
          onClick={() => onItem(item)}
          onContextMenu={(e) => {
            e.preventDefault()
            if (item.cardId) onZoom?.(item)
          }}
          title={item.name}
        >
          {item.cardId ? (
            <img src={`card://${item.cardId}`} alt="" draggable={false} />
          ) : (
            <div className="eng-stack-ability">✦</div>
          )}
          <div className="eng-stack-info">
            <div className="eng-stack-cardname">{item.name}</div>
            {i === 0 && <div className="eng-stack-next">resolves next</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

const STOP_STEP_LABEL = {
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main 1',
  beginCombat: 'Begin combat',
  declareAttackers: 'Declare attackers',
  declareBlockers: 'Declare blockers',
  combatDamage: 'Combat damage',
  endCombat: 'End of combat',
  main2: 'Main 2',
  end: 'End step'
}

// Magic Online-style stop matrix: each player picks the steps they want priority
// at. Unstopped steps auto-pass (see settle() in the store).
function StopsPanel({ stops, toggleStop, players, currentStep, onClose }) {
  return (
    <div className="eng-stops-panel" onMouseLeave={onClose}>
      <div className="eng-stops-head">
        <span>Priority stops</span>
        <button className="mini" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="eng-stops-hint">Steps without a stop pass priority automatically.</div>
      <table className="eng-stops-table">
        <thead>
          <tr>
            <th>Step</th>
            <th>{players[0].name}</th>
            <th>{players[1].name}</th>
          </tr>
        </thead>
        <tbody>
          {PRIORITY_STEPS.map((step) => (
            <tr key={step} className={step === currentStep ? 'now' : ''}>
              <td>{STOP_STEP_LABEL[step] || step}</td>
              {[0, 1].map((pid) => (
                <td key={pid}>
                  <input
                    type="checkbox"
                    checked={stops[pid]?.has(step) || false}
                    onChange={() => toggleStop(pid, step)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
