import React, { useEffect } from 'react'
import { useTokenArt, tokenKey } from '../../../store/tokenArt.js'

// Modal / floating overlays of the rules-enforced board.

// Graveyard / exile viewer. Cards with a castable option (flashback from the
// graveyard, or a plotted card in exile) are highlighted and clickable.
export function ZoneViewer({ title, cards, castableFor, onCast, onZoom, onClose }) {
  const castLabel = (a) => (a.type === 'castPlotted' ? 'Plotted' : a.type === 'cast' ? 'Cast' : a.type === 'unearth' ? 'Unearth' : 'Flashback')
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
                  title={fb ? `${castLabel(fb)}: ${c.name}` : c.name}
                >
                  {c.cardId ? <img src={`card://${c.cardId}`} alt={c.name} /> : <div className="cardback" />}
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
export function ScryOverlay({ pending, bottom, setBottom, onConfirm }) {
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
          <img src={`card://${imgId}${!card.token && card.face ? '/back' : ''}`} alt={card.name} />
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
export function StackOverlay({ stack, targeting, onItem, onZoom }) {
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
            <img src={`card://${item.cardId}${item.face ? '/back' : ''}`} alt="" draggable={false} />
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
  )
}

