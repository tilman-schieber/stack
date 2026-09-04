import React, { useEffect, useState } from 'react'

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
export default function Prompt({ view, pending, myTurn, targeting, sacrificing, discarding, choosingX, choosingPips, attackPreview, modal, attackers, band, proliferate, attackTargetName, blocks, discardSel, bottomSel, ninjutsu, cancelNinjutsu, error, choose, endGame, onMadnessCast, cancelCast }) {
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
      dredge: 'is deciding whether to dredge',
      proliferate: 'is proliferating',
      mutateOrder: 'is choosing how to mutate',
      bandDamage: 'is dividing damage among their band',
      lookAtHand: 'is looking at a revealed hand',
      chooseFromHand: 'is choosing a card from a revealed hand',
      chooseProtector: 'is choosing a protector for their Siege',
      optionalTrigger: 'is deciding on an optional ability',
      mayPay: 'is deciding whether to pay',
      wardPay: 'is deciding whether to pay ward',
      madness: 'is deciding on a madness cast',
      chooseValue: 'is choosing',
      copyEnter: 'is choosing what to copy',
      explore: 'is exploring',
      chooseName: 'is choosing a card name',
      chooseRingBearer: 'is choosing a Ring-bearer',
      chooseRoom: 'is choosing a dungeon room',
      chooseDungeon: 'is choosing a dungeon'
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
        <span>{ninjutsu.webSlinging ? 'Web-slinging — click a tapped creature to return to hand.' : `${ninjutsu.sneak ? 'Sneak' : 'Ninjutsu'} — click an unblocked attacker to return to hand.`}</span>
        <button className="mini" onClick={cancelNinjutsu}>
          Cancel
        </button>
      </>
    )
  } else if (choosingPips) {
    body = <PipPicker pips={choosingPips} cancelCast={cancelCast} />
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
          <b>{nameOf(pending.player)}</b> — declare attackers ({Object.keys(attackers).length} selected
          {attackPreview?.length ? `, ${attackPreview.reduce((a, x) => a + x.power, 0)} power` : ''})
          {attackPreview?.length > 0 && (
            <span className="muted small" title={attackPreview.map((x) => `${x.name}: ${x.blockers.length ? 'blockable by ' + x.blockers.join(', ') : 'no possible blocker'}`).join('\n')}>
              {' '}· {attackPreview.filter((x) => !x.blockers.length).length} unblockable now (hover)
            </span>
          )}
          {pending.defenders?.length > 1 && (
            <>
              {' '}
              · attacking <b>{attackTargetName}</b> (click a planeswalker or the player to retarget)
            </>
          )}
          .
          {band?.possible && (
            <label className="eng-band" title="Banding: attack as one band (blocked as a group; you assign damage dealt to the band)">
              <input type="checkbox" checked={band.on} onChange={band.toggle} /> band
            </label>
          )}
        </span>
        <button
          className="primary"
          onClick={() =>
            choose({
              attackers: Object.entries(attackers).map(([oid, defender]) => ({ oid, defender, band: band?.on ? 'A' : undefined }))
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
  } else if (kind === 'bandDamage') {
    body = <BandDamage pending={pending} nameOf={nameOf} onDone={(assignment) => choose({ assignment })} />
  } else if (kind === 'chooseProtector') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — choose an opponent to protect the Siege:
        </span>
        {pending.choices.map((c) => (
          <button key={c.pid} className="mini" onClick={() => choose({ pid: c.pid })}>
            {c.name}
          </button>
        ))}
      </>
    )
  } else if (kind === 'dredge') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — draw a card, or dredge instead?
        </span>
        <button className="primary" onClick={() => choose({})}>
          Draw
        </button>
        {pending.choices.map((c) => (
          <button key={c.oid} className="mini" onClick={() => choose({ oid: c.oid })}>
            Dredge {c.n}: {c.name}
          </button>
        ))}
      </>
    )
  } else if (kind === 'proliferate') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — proliferate: click permanents and players with counters ({proliferate?.count || 0} chosen), then confirm.
        </span>
        <button className="primary" onClick={proliferate?.confirm}>
          Confirm
        </button>
      </>
    )
  } else if (kind === 'mutateOrder') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — mutate <b>{pending.name}</b> onto <b>{pending.targetName}</b>: on top (its characteristics) or under (keep the target's)?
        </span>
        <button className="primary" onClick={() => choose({ onTop: true })}>
          On top
        </button>
        <button className="mini" onClick={() => choose({ onTop: false })}>
          Under
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
    const verb = pending.action === 'bounce' ? 'return to hand' : 'sacrifice'
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — click {pending.count === 1 ? 'a highlighted permanent' : `${pending.count} highlighted permanents`} to {verb}
          {pending.optional && pending.elseLoseLife ? `, or lose ${pending.elseLoseLife} life` : ''}.
        </span>
        {pending.optional && (
          <button className="mini" onClick={() => choose({ sacrifice: [] })}>
            {pending.elseLoseLife ? `Lose ${pending.elseLoseLife} life instead` : 'Decline'}
          </button>
        )}
      </>
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
  } else if (kind === 'chooseRingBearer') {
    body = (
      <span>
        <b>{nameOf(pending.player)}</b> — the Ring tempts you: click a creature you control to make it your Ring-bearer.
      </span>
    )
  } else if (kind === 'chooseName') {
    body = <NamePicker pending={pending} nameOf={nameOf} onPick={(name) => choose({ name })} />
  } else if (kind === 'chooseRoom') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — venture into {pending.dungeon}: choose the next room.
        </span>
        {pending.options.map((o) => (
          <button key={o.id} className="mini" title={o.text} onClick={() => choose({ room: o.id })}>
            {o.name} — <span className="muted">{o.text}</span>
          </button>
        ))}
      </>
    )
  } else if (kind === 'chooseDungeon') {
    body = (
      <span>
        <b>{nameOf(pending.player)}</b> — venture into the dungeon: click a dungeon to enter.
      </span>
    )
  } else if (kind === 'mayPay') {
    body = (
      <>
        <span>
          <b>{nameOf(pending.player)}</b> — {pending.name ? `${pending.name} ` : ''}pay {pending.cost}?
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
          {pending.draw ? `; if you do, draw ${pending.draw}` : ''}
          {pending.elseLoseLife ? `; otherwise lose ${pending.elseLoseLife} life` : ''}.
        </span>
        <button className="primary" onClick={() => choose({ discard: discardSel })}>
          {discardSel.length ? 'Discard' : pending.elseLoseLife ? `Lose ${pending.elseLoseLife} life` : 'Decline'}
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

// Hybrid / two-brid pips: pick how each is paid, or let auto-payment decide.
function PipPicker({ pips, cancelCast }) {
  const slots = [...pips.hybrid.map((opts) => ({ kind: 'hybrid', opts })), ...pips.twobrid.map((c) => ({ kind: 'twobrid', opts: [c, '2'] }))]
  const [picks, setPicks] = useState(() => slots.map(() => null))
  const done = () =>
    pips.pick({
      hybrid: picks.slice(0, pips.hybrid.length),
      twobrid: picks.slice(pips.hybrid.length)
    })
  return (
    <>
      <span>Pay each pip with:</span>
      {slots.map((sl, i) => (
        <span key={i} className="eng-confirm">
          {'{' + (sl.kind === 'hybrid' ? sl.opts.join('/') : '2/' + sl.opts[0]) + '}'}
          {sl.opts.map((c) => (
            <button key={c} className={picks[i] === c ? 'primary' : 'mini'} onClick={() => setPicks((p) => p.map((x, j) => (j === i ? c : x)))}>
              {c === '2' ? '{2}' : '{' + c + '}'}
            </button>
          ))}
        </span>
      ))}
      <button className="primary" onClick={done}>
        {picks.every((p) => p) ? 'Pay' : 'Auto-pay the rest'}
      </button>
      <button className="mini" onClick={cancelCast}>
        Cancel
      </button>
    </>
  )
}

// 702.22c: divide a blocker's damage among the band it is blocking.
function BandDamage({ pending, nameOf, onDone }) {
  const [amounts, setAmounts] = useState(() => Object.fromEntries(pending.members.map((m) => [m.oid, 0])))
  const total = Object.values(amounts).reduce((a, b) => a + b, 0)
  const left = pending.blocker.power - total
  const bump = (oid, d) => setAmounts((a) => ({ ...a, [oid]: Math.max(0, a[oid] + d) }))
  return (
    <>
      <span>
        <b>{nameOf(pending.player)}</b> — divide <b>{pending.blocker.name}</b>'s {pending.blocker.power} damage among the band ({left} left):
      </span>
      {pending.members.map((m) => (
        <span key={m.oid} className="eng-confirm">
          {m.name} ({m.toughness - m.damage} to lethal)
          <button className="mini" onClick={() => bump(m.oid, -1)}>
            −
          </button>
          <b>{amounts[m.oid]}</b>
          <button className="mini" disabled={left <= 0} onClick={() => bump(m.oid, 1)}>
            +
          </button>
        </span>
      ))}
      <button className="primary" disabled={left !== 0} onClick={() => onDone(amounts)}>
        Confirm
      </button>
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

// "Choose a card name" (201.3): free text with suggestions — the names the
// engine knows are in this game, plus live Scryfall name matches as you type.
function NamePicker({ pending, nameOf, onPick }) {
  const [text, setText] = useState('')
  const [remote, setRemote] = useState([])
  useEffect(() => {
    const q = text.trim()
    if (q.length < 3) return
    let alive = true
    const t = setTimeout(async () => {
      try {
        const cards = await window.api.searchCards(`name:${JSON.stringify(q)}${pending.nonland ? ' -t:land' : ''}`)
        if (alive) setRemote([...new Set(cards.map((c) => c.name))].slice(0, 30))
      } catch {
        /* offline: local suggestions only */
      }
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [text, pending.nonland])
  const options = [...new Set([...(pending.suggestions || []), ...remote])].sort()
  const submit = () => text.trim() && onPick(text.trim())
  return (
    <>
      <span>
        <b>{nameOf(pending.player)}</b> — {pending.label}:
      </span>
      <input
        className="eng-name-input"
        list="eng-card-names"
        value={text}
        autoFocus
        placeholder="Type a card name…"
        onChange={(ev) => setText(ev.target.value)}
        onKeyDown={(ev) => ev.key === 'Enter' && submit()}
      />
      <datalist id="eng-card-names">
        {options.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <button className="primary" disabled={!text.trim()} onClick={submit}>
        Name it
      </button>
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

