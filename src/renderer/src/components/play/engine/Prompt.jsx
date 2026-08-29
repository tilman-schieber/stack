import React, { useState } from 'react'

// Mode selection for a modal spell ("Choose one/two —"). Click modes to select;
// once `count` are chosen it commits (and the parent collects any per-mode targets).
function ModalPicker({ modal, cancelCast }) {
  const [sel, setSel] = useState([])
  const toggle = (i) => {
    const next = sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]
    if (next.length === modal.count) modal.pick(next)
    else setSel(next)
  }
  return (
    <>
      <span>Choose {modal.count === 1 ? 'one' : modal.count === 2 ? 'two' : modal.count} —</span>
      {modal.modes.map((m, i) => (
        <button
          key={i}
          disabled={!m.castable && !sel.includes(i)}
          className={sel.includes(i) ? 'primary' : 'mini'}
          onClick={() => toggle(i)}
        >
          {m.label}
        </button>
      ))}
      <button className="mini" onClick={cancelCast}>
        Cancel
      </button>
    </>
  )
}

// The contextual action bar at the bottom — what the current decision needs.
export default function Prompt({ view, pending, myTurn, targeting, sacrificing, discarding, choosingX, modal, attackers, attackTargetName, blocks, discardSel, bottomSel, ninjutsu, cancelNinjutsu, error, choose, endGame, onMadnessCast, cancelCast }) {
  const kind = pending.kind
  const nameOf = (pid) => view.players[pid]?.name

  let body = null
  if (!myTurn && kind !== 'gameOver') {
    // Online: the other player is deciding — show what we're waiting on, no
    // buttons (they'd be ignored by the host anyway).
    const WAIT = {
      priority: 'has priority',
      declareAttackers: 'is declaring attackers',
      declareBlockers: 'is declaring blockers',
      mulligan: 'is deciding on a mulligan',
      bottom: 'is putting cards on the bottom',
      discard: 'is discarding',
      discardCards: 'is discarding',
      scry: 'is scrying',
      search: 'is searching their library',
      chooseTargets: 'is choosing targets',
      orderTriggers: 'is ordering their triggers',
      playOrDraw: 'is choosing to play or draw',
      sacrificeChoice: 'is choosing what to sacrifice',
      orderBlockers: 'is ordering blockers for damage',
      legendChoice: 'is applying the legend rule',
      optionalTrigger: 'is deciding on an optional ability',
      mayPay: 'is deciding whether to pay',
      wardPay: 'is deciding whether to pay ward',
      madness: 'is deciding on a madness cast',
      chooseValue: 'is choosing',
      copyEnter: 'is choosing what to copy',
      explore: 'is exploring'
    }
    body = (
      <span className="eng-waiting">
        Waiting — <b>{nameOf(pending.player)}</b> {WAIT[kind] || 'is deciding'}…
      </span>
    )
  } else if (modal) {
    body = <ModalPicker modal={modal} cancelCast={cancelCast} />
  } else if (ninjutsu) {
    body = (
      <>
        <span>Ninjutsu — click an unblocked attacker to return to hand.</span>
        <button className="mini" onClick={cancelNinjutsu}>
          Cancel
        </button>
      </>
    )
  } else if (choosingX) {
    body = (
      <>
        <span>Choose X (max {choosingX.max}):</span>
        <button className="mini" onClick={choosingX.dec}>
          −
        </button>
        <b style={{ fontSize: 18, minWidth: 24, textAlign: 'center' }}>{choosingX.value}</b>
        <button className="mini" onClick={choosingX.inc}>
          +
        </button>
        <button className="primary" onClick={choosingX.confirm}>
          OK
        </button>
        <button className="mini" onClick={cancelCast}>
          Cancel
        </button>
      </>
    )
  } else if (sacrificing) {
    body = (
      <>
        <span>Choose {sacrificing.types.join(' or ').toLowerCase()} to sacrifice.</span>
        <button className="mini" onClick={cancelCast}>
          Cancel
        </button>
      </>
    )
  } else if (discarding) {
    body = (
      <>
        <span>Choose a card in hand to discard.</span>
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
    const v = targeting.variadic
    const slot = v || targeting.targets[targeting.chosen.length]
    body = (
      <>
        <span>
          {targeting.name ? <b>{targeting.name}</b> : 'Choose target'} — target{' '}
          {v
            ? `${targeting.chosen.length}/${v.max} chosen (pick ${v.min}–${v.max})`
            : `${targeting.chosen.length + 1}/${targeting.targets.length} (${slot.type})`}
        </span>
        {targeting.confirm && (
          <button className="primary" onClick={targeting.confirm}>
            Confirm
          </button>
        )}
        {targeting.cancelable && (
          <button className="mini" onClick={cancelCast}>
            Cancel
          </button>
        )}
        {targeting.decline && (
          <button className="mini" onClick={targeting.decline}>
            Decline
          </button>
        )}
      </>
    )
  } else if (kind === 'playOrDraw') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> won the die roll — play first, or draw?
        </span>
        <button className="primary" onClick={() => choose({ play: true })}>
          Play
        </button>
        <button className="mini" onClick={() => choose({ play: false })}>
          Draw
        </button>
      </>
    )
  } else if (kind === 'orderTriggers') {
    body = <TriggerOrderer pending={pending} nameOf={nameOf} onDone={(order) => choose({ order })} />
  } else if (kind === 'orderBlockers') {
    body = <BlockerOrderer pending={pending} nameOf={nameOf} onDone={(order) => choose({ order })} />
  } else if (kind === 'optionalTrigger') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — use <b>{pending.name}</b>'s optional ability?
        </span>
        <button className="primary" onClick={() => choose({ yes: true })}>
          Yes
        </button>
        <button className="mini" onClick={() => choose({ yes: false })}>
          No
        </button>
      </>
    )
  } else if (kind === 'priority') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> has priority — click a card to play it, or pass.
        </span>
        <button className="primary" onClick={() => choose({ type: 'pass' })} title="Space / Enter">
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
  } else if (kind === 'explore') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> explored — revealed <b>{pending.card?.name}</b> (nonland). Keep it on
          top of your library or bin it?
        </span>
        <button className="primary" onClick={() => choose({ bin: false })}>
          Keep on top
        </button>
        <button className="mini" onClick={() => choose({ bin: true })}>
          Graveyard
        </button>
      </>
    )
  } else if (kind === 'legendChoice') {
    body = (
      <span>
        <b>{nameOf(pending.player)}</b> — legend rule: click the <b>{pending.name}</b> to keep; the others go to the graveyard.
      </span>
    )
  } else if (kind === 'sacrificeChoice') {
    body = (
      <span>
        <b>{nameOf(pending.player)}</b> — click {pending.count === 1 ? 'a highlighted permanent' : `${pending.count} highlighted permanents`} to sacrifice.
      </span>
    )
  } else if (kind === 'copyEnter') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — click a highlighted creature to enter as a copy of it, or decline.
        </span>
        <button className="mini" onClick={() => choose({ copy: null })}>
          Don’t copy
        </button>
      </>
    )
  } else if (kind === 'chooseValue') {
    body = <ValuePicker label={`${nameOf(pending.player)} — ${pending.label}`} options={pending.options} onPick={(value) => choose({ value })} />
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
  } else if (kind === 'wardPay') {
    const cost = pending.life != null ? `${pending.life} life` : pending.mana
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — {pending.wardName} has ward. Pay {cost} or your spell/ability is countered.
        </span>
        <button className="primary" disabled={!pending.canPay} onClick={() => choose({ pay: true })}>
          Pay {cost}
        </button>
        <button className="mini" onClick={() => choose({ pay: false })}>
          Let it be countered
        </button>
      </>
    )
  } else if (kind === 'discardCards') {
    const need = Math.min(pending.count, pending.hand.length)
    body = pending.optional ? (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — you may discard up to {pending.count} card(s) (
          {discardSel.length}/{pending.count})
          {pending.orSacrificeLand ? ' or click a land to sacrifice' : ''}
          {pending.draw ? `; if you do, draw ${pending.draw}` : ''}.
        </span>
        <button className="primary" onClick={() => choose({ discard: discardSel })}>
          {discardSel.length ? 'Discard' : 'Decline'}
        </button>
      </>
    ) : (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — discard {pending.count} card(s) ({discardSel.length}/
          {pending.count}).
        </span>
        <button
          className="primary"
          disabled={discardSel.length !== need}
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
          <b>{nameOf(pending.player)}</b> —{' '}
          {pending.free ? (
            <>
              cast <b>{pending.name}</b> without paying its mana cost?
            </>
          ) : pending.miracle ? (
            <>
              cast <b>{pending.name}</b> for its miracle cost {pending.cost}?
            </>
          ) : (
            <>
              cast <b>{pending.name}</b> for its madness cost {pending.cost}?
            </>
          )}
        </span>
        <button className="primary" disabled={!pending.canPay} onClick={() => onMadnessCast(pending)}>
          {pending.free ? 'Cast for free' : pending.miracle ? 'Cast (miracle)' : 'Cast (madness)'}
        </button>
        <button className="mini" onClick={() => choose({ cast: false })}>
          Decline
        </button>
      </>
    )
  } else if (kind === 'gameOver') {
    body = (
      <>
        <span className="eng-win">{pending.draw ? '🤝 The game is a draw.' : `🏆 ${nameOf(pending.winner)} wins!`}</span>
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

// 603.3b: order your simultaneous triggers. Click them in the order they go on
// the stack; the last one clicked resolves first.
function TriggerOrderer({ pending, nameOf, onDone }) {
  const [order, setOrder] = useState([])
  const remaining = pending.triggers.filter((t) => !order.includes(t.id))
  const pick = (id) => {
    const next = [...order, id]
    if (next.length === pending.triggers.length) onDone(next)
    else setOrder(next)
  }
  return (
    <>
      <span>
        <b>{nameOf(pending.player)}</b> — order your triggers (click the one to put on the stack first; the last resolves first):
      </span>
      {remaining.map((t) => (
        <button key={t.id} className="mini" onClick={() => pick(t.id)}>
          {t.name}
        </button>
      ))}
      {order.length > 0 && <span className="muted">{order.length}/{pending.triggers.length} placed</span>}
    </>
  )
}

// 509.2: for each attacker blocked by several creatures, click its blockers in
// the order damage is assigned to them.
function BlockerOrderer({ pending, nameOf, onDone }) {
  const [order, setOrder] = useState({}) // attackerOid -> [blockerOids]
  const [idx, setIdx] = useState(0)
  const atk = pending.attackers[idx]
  const done = order[atk.oid] || []
  const pick = (b) => {
    const next = { ...order, [atk.oid]: [...done, b] }
    if (next[atk.oid].length === atk.blockers.length) {
      if (idx + 1 >= pending.attackers.length) onDone(next)
      else {
        setOrder(next)
        setIdx(idx + 1)
      }
    } else setOrder(next)
  }
  return (
    <>
      <span>
        <b>{nameOf(pending.player)}</b> — damage assignment order for <b>{atk.name}</b>: click its blockers first to last.
      </span>
      {atk.blockers
        .filter((b) => !done.includes(b.oid))
        .map((b) => (
          <button key={b.oid} className="mini" onClick={() => pick(b.oid)}>
            {b.name}
          </button>
        ))}
    </>
  )
}

// "As this enters, choose a …": pick from a list, then confirm.
function ValuePicker({ label, options, onPick }) {
  const [value, setValue] = useState(options[0])
  return (
    <>
      <span>{label}:</span>
      <select value={value} onChange={(ev) => setValue(ev.target.value)}>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <button className="primary" onClick={() => onPick(value)}>
        Choose
      </button>
    </>
  )
}

