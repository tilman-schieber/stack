import React, { useEffect } from 'react'
import { useTokenArt, tokenKey } from '../../../store/tokenArt.js'
import { cardImageUrl, boardImageSize } from '../../../lib/cardUtils.js'

// Modal / floating overlays of the rules-enforced board.

// Graveyard / exile viewer. Cards with a castable option (flashback from the
// graveyard, or a plotted card in exile) are highlighted and clickable.
export function ZoneViewer({ title, cards, castableFor, onCast, onZoom, onClose }) {
  const LABELS = {
    castPlotted: 'Plotted',
    castEscape: 'Escape',
    playLand: 'Play',
    cast: 'Cast',
    unearth: 'Unearth',
    castDisturb: 'Disturb',
    embalm: 'Embalm',
    // An ability the card has while it is in the graveyard, such as Cauldron
    // Familiar's "Sacrifice a Food: return this card from your graveyard".
    activate: 'Activate'
  }
  const castLabel = (a) => LABELS[a?.type] || 'Flashback'
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
              const fb = castableFor(c.oid)
              return (
                <div
                  key={c.oid}
                  className={'eng-zoneviewer-card' + (fb ? ' castable' : '')}
                  onClick={() => fb && onCast(fb)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (c.cardId) onZoom(c)
                  }}
                  title={fb ? fb.label || `${castLabel(fb)}: ${c.name}` : c.name}
                >
                  {c.cardId ? <img src={cardImageUrl(c.cardId, false, boardImageSize())} alt={c.name} /> : <div className="cardback" />}
                  {fb && <span className="eng-zoneviewer-fb">{castLabel(fb)}</span>}
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
export function SearchOverlay({ pending, onPick, onNone }) {
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
              {c.cardId ? <img src={cardImageUrl(c.cardId)} alt={c.name} /> : <div className="cardback" />}
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

// A revealed hand (Duress, Peek): show every card; if choosing, only the
// matching ones are clickable.
export function HandRevealOverlay({ pending, targetName, onPick, onDecline, onOk }) {
  const choosing = pending.kind === 'chooseFromHand'
  const pickable = new Set((pending.cards || []).map((c) => c.oid))
  const cards = pending.hand || pending.cards || []
  return (
    <div className="eng-scry">
      <div className="eng-scry-panel">
        <div className="eng-scry-title">
          {pending.then === 'castFree'
            ? 'Cards drawn — you may cast one without paying its mana cost'
            : `${targetName}'s hand${choosing ? ` — choose a card to ${pending.then === 'exile' ? 'exile' : 'discard'}` : ''}`}
        </div>
        <div className="eng-scry-cards">
          {cards.map((c) => (
            <div
              className={'eng-scry-card' + (choosing && !pickable.has(c.oid) ? ' dim' : '')}
              key={c.oid}
              onClick={() => choosing && pickable.has(c.oid) && onPick(c.oid)}
              title={c.name}
            >
              {c.cardId ? <img src={cardImageUrl(c.cardId)} alt={c.name} /> : <div className="cardback" />}
              <div className="eng-scry-dest">{c.name}</div>
            </div>
          ))}
          {cards.length === 0 && <p className="muted">Empty hand.</p>}
        </div>
        {choosing && pending.optional && (
          <button className="mini" onClick={onDecline}>
            Choose nothing
          </button>
        )}
        {!choosing && (
          <button className="primary" onClick={onOk}>
            OK
          </button>
        )}
      </div>
    </div>
  )
}

// Scry / Surveil: look at the top cards and send some to the bottom (or the
// graveyard, for surveil). The rest stay on top in shown order.
// Scry / surveil: click a card to send it to the bottom (or graveyard). In
// reorder mode (Ponder — `pending.noBottom`) clicks instead number the cards in
// the order they'll go back on top; unclicked ones follow in their current order.
export function ScryOverlay({ pending, bottom, setBottom, onConfirm }) {
  const reorder = !!pending.noBottom
  const toggle = (oid) =>
    setBottom((b) => (b.includes(oid) ? b.filter((o) => o !== oid) : [...b, oid]))
  const dest = pending.surveil ? 'graveyard' : 'bottom'
  return (
    <div className="eng-scry">
      <div className="eng-scry-panel">
        <div className="eng-scry-title">
          {reorder
            ? `Look at the top ${pending.cards.length} — click cards in the order they should go back on top (first click = top)`
            : `${pending.surveil ? 'Surveil' : 'Scry'} ${pending.cards.length} — click a card to send it to the ${dest}`}
        </div>
        <div className="eng-scry-cards">
          {pending.cards.map((c) => {
            const marked = bottom.includes(c.oid)
            const nth = bottom.indexOf(c.oid)
            return (
              <div
                key={c.oid}
                className={'eng-scry-card' + (marked && !reorder ? ' to-bottom' : '')}
                onClick={() => toggle(c.oid)}
                title={c.name}
              >
                {c.cardId ? <img src={cardImageUrl(c.cardId)} alt={c.name} /> : <div className="cardback" />}
                <div className="eng-scry-dest">{reorder ? (nth >= 0 ? `#${nth + 1}` : 'as is') : marked ? dest : 'top'}</div>
              </div>
            )
          })}
        </div>
        <div className="eng-scry-actions">
          <button className="primary" onClick={() => onConfirm(false)}>
            {reorder ? 'Put back' : 'Confirm'}
          </button>
          {reorder && pending.mayShuffle && (
            <button className="mini" onClick={() => onConfirm(true)} title="Put them back, then shuffle your library">
              Shuffle instead
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// "Look at the top N": pick up to `max` cards matching the filter (Lead the
// Stampede, Malevolent Rumble), or choose a type and take all of it (Winding Way).
export function LookTopOverlay({ pending, picks, setPicks, onConfirm, onType }) {
  const toggle = (oid) => setPicks((p) => (p.includes(oid) ? p.filter((o) => o !== oid) : p.length < pending.max ? [...p, oid] : p))
  const restWord = pending.rest === 'graveyard' ? 'go to your graveyard' : pending.rest === 'bottom' ? 'go to the bottom of your library' : 'stay on top'
  return (
    <div className="eng-scry">
      <div className="eng-scry-panel">
        <div className="eng-scry-title">
          {pending.chooseType
            ? `${pending.revealed ? 'Revealed' : 'Looking at'} the top ${pending.cards.length} — choose a type: every card of it goes to your hand, the rest ${restWord}`
            : `${pending.revealed ? 'Revealed' : 'Looking at'} the top ${pending.cards.length} — take up to ${pending.max} card${pending.max === 1 ? '' : 's'} (${picks.length}/${pending.max}); the rest ${restWord}`}
        </div>
        <div className="eng-scry-cards">
          {pending.cards.map((c) => {
            const taken = picks.includes(c.oid)
            return (
              <div key={c.oid} className={'eng-scry-card' + (taken ? ' chosen' : '')} onClick={() => !pending.chooseType && toggle(c.oid)} title={c.name}>
                {c.cardId ? <img src={cardImageUrl(c.cardId)} alt={c.name} /> : <div className="cardback" />}
                <div className="eng-scry-dest">{pending.chooseType ? c.name : taken ? 'to hand' : ''}</div>
              </div>
            )
          })}
        </div>
        <div className="eng-scry-actions">
          {pending.chooseType ? (
            pending.chooseType.map((t) => (
              <button key={t} className="primary" onClick={() => onType(t)}>
                {t}s
              </button>
            ))
          ) : (
            <button className="primary" onClick={onConfirm}>
              {picks.length ? `Take ${picks.length}` : 'Take nothing'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Zoom preview. For tokens, arrows cycle through Scryfall art variants and the
// choice is remembered for future tokens of the same type.
export function ZoomOverlay({ card, onClose }) {
  const key = card.token && card.tokenDef ? tokenKey(card.tokenDef) : null
  const entry = useTokenArt((s) => (key ? s.cache[key] : null))
  const ensure = useTokenArt((s) => s.ensure)
  const cycle = useTokenArt((s) => s.cycle)
  useEffect(() => {
    if (key) ensure(card.tokenDef)
  }, [key, ensure]) // eslint-disable-line react-hooks/exhaustive-deps

  // A face-down permanent zooms to its real card for whoever is allowed to know it.
  const imgId = card.token ? entry?.chosenId : card.cardId || card.realCardId
  const prints = entry?.prints || []
  const canCycle = card.token && prints.length > 1
  const idx = imgId ? prints.findIndex((p) => p.id === imgId) : -1
  // The back face: a transformed card, or a helper shown by its back (the Initiative).
  const back = card.token ? card.tokenDef?.face === 'back' : !!card.face
  const what = card.helper ? card.name : `${card.name} token`

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
          <img src={cardImageUrl(imgId, back, 'large')} alt={card.name} />
        ) : (
          <div className="eng-zoom-placeholder">
            {card.token ? (entry?.loading ? 'Finding card art…' : 'No art found') : ''}
          </div>
        )}
        {card.token && (
          <div className="eng-zoom-hint">
            {prints.length > 1 ? `${what} — art ${idx + 1}/${prints.length} (use ‹ ›, remembered)` : what}
          </div>
        )}
      </div>
      {card.dungeon && (
        <div className="eng-zoom-rooms" onClick={(e) => e.stopPropagation()}>
          <div className="eng-zoom-rooms-title">{card.dungeon.name}</div>
          {card.dungeon.rooms.map((r) => (
            <div key={r.id} className={'eng-zoom-room' + (r.current ? ' cur' : '')}>
              <b>{r.current ? '▶ ' : ''}{r.name}</b> — {r.text}
            </div>
          ))}
          <div className="muted small">Venture: move to a room an arrow leads to; the bottom room completes the dungeon.</div>
        </div>
      )}
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

// The stack as a physical pile at the centre line: the object that resolves next
// lies on top and in full, the ones under it peek out below in the order they
// will resolve. Hidden when empty.
export function StackOverlay({ stack, targeting, onItem, onZoom }) {
  if (!stack.length) return null
  const topFirst = [...stack].reverse()
  return (
    <div className="eng-stack">
      <div className="eng-stack-title">
        The stack <span className="eng-stack-n">{stack.length}</span>
      </div>
      <div className="eng-stack-fan">
        {topFirst.map((item, i) => (
          <div
            key={item.oid}
            className={'eng-stack-card' + (targeting ? ' targetable' : '') + (i === 0 ? ' top' : '')}
            data-oid={item.oid}
            data-zone="stack"
            data-player={item.controller}
            style={{ '--i': i, zIndex: topFirst.length - i }}
            onClick={() => onItem(item)}
            onContextMenu={(e) => {
              e.preventDefault()
              if (item.cardId) onZoom?.(item)
            }}
            title={item.name}
          >
            {item.cardId ? (
              <img src={cardImageUrl(item.cardId, item.face, boardImageSize())} alt="" draggable={false} />
            ) : (
              <div className="eng-stack-ability">✦</div>
            )}
            <div className="eng-stack-info">
              <div className="eng-stack-cardname">{item.name}</div>
              {item.targetNames?.length > 0 && <div className="eng-stack-targets">→ {item.targetNames.join(', ')}</div>}
              {i === 0 && <div className="eng-stack-next">resolves next</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

