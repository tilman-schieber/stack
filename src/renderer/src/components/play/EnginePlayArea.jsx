import React, { useEffect, useState } from 'react'
import { useEngineGame, PRIORITY_STEPS } from '../../store/engineGame.js'
import TokenSearch from './TokenSearch.jsx'
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

// One permanent / stack card, styled from play.css .board-card.
// Right-click zooms (via onZoom); left-click acts (via onClick).
function EngineCard({ card, className = '', onClick, onZoom, title }) {
  const img = cardImg(card)
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
    </div>
  )
}

function Pile({ label, count, topCard, faceDown }) {
  return (
    <div className="rail-pile">
      <div className="rail-pile-card" title={`${label} (${count})`}>
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
  const [tokenFor, setTokenFor] = useState(null) // player id awaiting a token pick
  const createToken = useEngineGame((s) => s.createToken)

  // Transient selection state; reset whenever the engine produces a new view
  // (i.e. a new decision point).
  const [cast, setCast] = useState(null) // { action, chosen: [] }
  const [attackers, setAttackers] = useState([])
  const [blocks, setBlocks] = useState({}) // blockerOid -> attackerOid
  const [pickBlocker, setPickBlocker] = useState(null)
  const [discardSel, setDiscardSel] = useState([])
  const [bottomSel, setBottomSel] = useState([]) // cards to put on the bottom (mulligan)
  const [chooseSel, setChooseSel] = useState([]) // engine-initiated target choice

  useEffect(() => {
    setCast(null)
    setAttackers([])
    setBlocks({})
    setPickBlocker(null)
    setDiscardSel([])
    setBottomSel([])
    setChooseSel([])
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
  const actionFor = (oid) =>
    kind === 'priority' ? pending.actions?.find((a) => a.oid === oid) : null

  // ---- targeting helpers ----
  // Unifies player-initiated targeting (cast/activate) with engine-initiated
  // target choices (a triggered ability's `chooseTargets` decision).
  const engineTargeting = kind === 'chooseTargets'
  const targeting = cast || (engineTargeting ? { targets: pending.targets, chosen: chooseSel } : null)
  const targetSlot = targeting ? targeting.targets[targeting.chosen.length] : null
  const wantsCreature = targetSlot && (targetSlot.type === 'creature' || targetSlot.type === 'any')
  const wantsPlayer = targetSlot && (targetSlot.type === 'player' || targetSlot.type === 'any')
  const wantsSpell = targetSlot && targetSlot.type === 'spell'

  // Submit a player-initiated targeted action once all its targets are chosen.
  function submit(action, chosen) {
    if (action.type === 'activate')
      choose({ type: 'activate', oid: action.oid, ability: action.ability, targets: chosen })
    else choose({ type: 'cast', oid: action.oid, targets: chosen })
  }

  function addTarget(t) {
    const chosen = [...targeting.chosen, t]
    const done = chosen.length >= targeting.targets.length
    if (cast) {
      if (done) submit(cast.action, chosen)
      else setCast({ ...cast, chosen })
    } else {
      // engine chooseTargets
      if (done) choose({ targets: chosen })
      else setChooseSel(chosen)
    }
  }

  // ---- click dispatch ----
  function onHandCard(card, pid) {
    if (kind === 'discard' && pid === pending.player) {
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
    if (targeting) return
    if (kind === 'priority' && pid === pending.player) {
      const a = actionFor(card.oid)
      if (!a) return
      if (a.type === 'playLand') choose(a)
      else if (a.type === 'cast') {
        if (a.needsTargets > 0) setCast({ action: a, chosen: [] })
        else choose({ type: 'cast', oid: a.oid })
      }
    }
  }

  function onBattlefieldCard(card, controllerPid) {
    if (targeting) {
      if (wantsCreature && isCreature(card)) addTarget({ kind: 'object', oid: card.oid })
      return
    }
    // Activate an ability of a permanent you control (instant speed).
    if (kind === 'priority' && controllerPid === pending.player) {
      const a = actionFor(card.oid)
      if (a?.type === 'activate') {
        if (a.needsTargets > 0) setCast({ action: a, chosen: [] })
        else choose({ type: 'activate', oid: a.oid, ability: a.ability, targets: [] })
      }
      return
    }
    if (kind === 'declareAttackers' && controllerPid === view.activePlayer) {
      if (!pending.eligible.includes(card.oid)) return
      setAttackers((a) =>
        a.includes(card.oid) ? a.filter((o) => o !== card.oid) : [...a, card.oid]
      )
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
    if (targeting && wantsPlayer) addTarget({ kind: 'player', pid })
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
    if (!targeting && kind === 'priority' && controllerPid === pending.player && actionFor(card.oid)?.type === 'activate')
      cls.push('activatable')
    if (kind === 'declareAttackers' && controllerPid === view.activePlayer && pending.eligible.includes(card.oid))
      cls.push('selectable', attackers.includes(card.oid) ? 'chosen' : '')
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
            (kind === 'discard' || kind === 'bottom') && p.id === pending.player
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
        <button className="mini eng-token-btn" title="Create a token" onClick={() => setTokenFor(p.id)}>
          ＋ Token
        </button>
      </div>

      <div className="eng-body">
        <div className="battlefield eng-battlefield" data-player={p.id}>
          {p.battlefield.length === 0 && <div className="bf-hint">No permanents</div>}
          {(() => {
            const lands = (
              <div className="eng-lands" key="lands">
                {p.battlefield
                  .filter((c) => !isCreature(c))
                  .map((c) => (
                    <EngineCard
                      key={c.oid}
                      card={c}
                      className={bfClass(c, p.id)}
                      onClick={() => onBattlefieldCard(c, p.id)}
                      onZoom={setZoom}
                    />
                  ))}
              </div>
            )
            const creatures = (
              <div className="eng-creatures" key="creatures">
                {p.battlefield
                  .filter(isCreature)
                  .map((c) => (
                    <EngineCard
                      key={c.oid}
                      card={c}
                      className={bfClass(c, p.id)}
                      onClick={() => onBattlefieldCard(c, p.id)}
                      onZoom={setZoom}
                      title={c.name + (c.keywords?.length ? ' — ' + c.keywords.join(', ') : '')}
                    />
                  ))}
              </div>
            )
            // Lands sit toward each player's outer edge (creatures front the
            // centre line): bottom seat = creatures then lands; top = reversed.
            return place === 'bottom' ? [creatures, lands] : [lands, creatures]
          })()}
        </div>
        <div className="right-rail eng-rail">
          <Pile label="Library" count={p.libraryCount} faceDown />
          <Pile label="Graveyard" count={p.graveyard.length} topCard={p.graveyard[p.graveyard.length - 1]} />
          <Pile label="Exile" count={p.exile.length} topCard={p.exile[p.exile.length - 1]} />
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

      {zoom && zoom.cardId && (
        <div className="eng-zoom" onClick={() => setZoom(null)} title="Click to close">
          <img src={`card://${zoom.cardId}`} alt={zoom.name} />
        </div>
      )}

      {tokenFor !== null && (
        <TokenSearch
          onPick={(card) => {
            createToken(tokenFor, card)
            setTokenFor(null)
          }}
          onClose={() => setTokenFor(null)}
        />
      )}

      <Prompt
        view={view}
        pending={pending}
        targeting={
          targeting
            ? { targets: targeting.targets, chosen: targeting.chosen, name: cast ? null : pending.name, cancelable: !!cast }
            : null
        }
        attackers={attackers}
        blocks={blocks}
        discardSel={discardSel}
        bottomSel={bottomSel}
        error={error}
        choose={choose}
        endGame={endGame}
        cancelCast={() => setCast(null)}
      />
    </div>
  )
}

// The contextual action bar at the bottom — what the current decision needs.
function Prompt({ view, pending, targeting, attackers, blocks, discardSel, bottomSel, error, choose, endGame, cancelCast }) {
  const kind = pending.kind
  const nameOf = (pid) => view.players[pid]?.name

  let body = null
  if (kind === 'mulligan') {
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
          <b>{nameOf(pending.player)}</b> — declare attackers ({attackers.length} selected).
        </span>
        <button className="primary" onClick={() => choose({ attackers })} disabled={attackers.length === 0}>
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
