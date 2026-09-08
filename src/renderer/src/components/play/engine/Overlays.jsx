import React, { useEffect, useState } from 'react'
import { useTokenArt, tokenKey } from '../../../store/tokenArt.js'
import { cardImageUrl, boardImageSize } from '../../../lib/cardUtils.js'
import { moveKept, canMoveKept, keptOrder } from '../../../lib/scryOrder.js'

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

// Choosing a card in a graveyard as a target (Archaeomancer's "return target
// instant or sorcery card from your graveyard", Mortuary Mire, Faerie Macabre).
//
// Graveyards live on the seat rail as a single stacked pile, which is fine for
// browsing and useless for picking, so the choice gets its own board: every card
// the effect can reach, grouped by whose graveyard it is in, in the order the
// cards were put there (most recent last, as the pile is stacked).
export function GraveyardTargetOverlay({ label, groups, canPick, onPick, onZoom, onDecline }) {
  const total = groups.reduce((n, g) => n + g.cards.length, 0)
  return (
    <div className="eng-scry">
      <div className="eng-scry-panel">
        <div className="eng-scry-title">{label}</div>
        {total === 0 && <p className="muted">No card in any graveyard fits.</p>}
        {groups
          .filter((g) => g.cards.length > 0)
          .map((g) => (
            <div key={g.pid}>
              {groups.length > 1 && <div className="eng-scry-sub">{g.name}</div>}
              <div className="eng-scry-cards eng-search-grid">
                {g.cards.map((c) => {
                  const ok = canPick(c)
                  return (
                    <div
                      className={'eng-scry-card' + (ok ? '' : ' dim')}
                      key={c.oid}
                      onClick={() => ok && onPick(c.oid)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        if (c.cardId) onZoom(c)
                      }}
                      title={ok ? `Target ${c.name}` : `${c.name} — not a legal target`}
                    >
                      {c.cardId ? <img src={cardImageUrl(c.cardId)} alt={c.name} /> : <div className="cardback" />}
                      <div className="eng-scry-dest">{c.name}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        {onDecline && (
          <div className="eng-scry-actions">
            <button className="mini" onClick={onDecline}>
              Choose no card
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Library search: pick one card, or take nothing if optional.
//
// Searching a library means looking through all of it (701.19a), so the whole
// library is available behind a toggle — sorted by name, never in library
// order, which would give away the shuffle. Only the cards the effect can find
// are clickable; the rest are there to be read.
export function SearchOverlay({ pending, onPick, onNone }) {
  const [all, setAll] = useState(false)
  const matches = pending.cards || []
  const library = pending.library || []
  const canPick = new Set(matches.map((c) => c.oid))

  const unique = []
  const seen = new Set()
  for (const c of matches) {
    if (!seen.has(c.name)) {
      seen.add(c.name)
      unique.push(c)
    }
  }
  // The whole library, deduped by name with a count, alphabetical.
  const byName = new Map()
  for (const c of library) {
    const at = byName.get(c.name)
    if (at) at.n++
    else byName.set(c.name, { card: c, n: 1 })
  }
  const whole = [...byName.values()].sort((a, b) => a.card.name.localeCompare(b.card.name))
  const shown = all ? whole : unique.map((c) => ({ card: c, n: 0 }))

  return (
    <div className="eng-scry">
      <div className="eng-scry-panel">
        <div className="eng-scry-title">
          {all
            ? `Your library — ${library.length} cards, ${matches.length} of them findable`
            : `Search your library — choose a card${pending.optional ? ' (or take nothing)' : ''}`}
        </div>
        <div className="eng-scry-cards eng-search-grid">
          {shown.map(({ card, n }) => {
            const pickable = canPick.has(card.oid) || (!all && true)
            return (
              <div
                className={'eng-scry-card' + (pickable ? '' : ' dim')}
                key={card.oid}
                onClick={() => pickable && onPick(card.oid)}
                title={pickable ? card.name : `${card.name} — this search cannot find it`}
              >
                {card.cardId ? <img src={cardImageUrl(card.cardId)} alt={card.name} /> : <div className="cardback" />}
                <div className="eng-scry-dest">
                  {card.name}
                  {n > 1 && <span className="muted"> ×{n}</span>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="eng-scry-actions">
          {library.length > 0 && (
            <button className="mini" onClick={() => setAll((v) => !v)}>
              {all ? 'Show only what this finds' : `Look through the whole library (${library.length})`}
            </button>
          )}
          {pending.optional && (
            <button className="mini" onClick={onNone}>
              Take nothing
            </button>
          )}
        </div>
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
  // The order the kept cards go back on top, first = topmost. Scrying 2 lets you
  // swap them, which is half of what scry does and used to be missing.
  const [order, setOrder] = useState(() => pending.cards.map((c) => c.oid))
  // The view is rebuilt on every render, so this keys on the ids themselves —
  // depending on the array would reset the order forever.
  const ids = pending.cards.map((c) => c.oid).join(',')
  useEffect(() => setOrder(ids.split(',')), [ids])
  const toggle = (oid) => {
    if (reorder) return
    setBottom((b) => (b.includes(oid) ? b.filter((o) => o !== oid) : [...b, oid]))
  }
  const move = (oid, by) => setOrder((o) => moveKept(o, bottom, oid, by))
  const dest = pending.surveil ? 'graveyard' : 'bottom'
  const cardBy = (oid) => pending.cards.find((c) => c.oid === oid)
  const kept = keptOrder(order, bottom)
  const canOrder = kept.length > 1
  return (
    <div className="eng-scry">
      <div className="eng-scry-panel">
        <div className="eng-scry-title">
          {reorder
            ? `Look at the top ${pending.cards.length} — put them back in any order (left is the top card)`
            : `${pending.surveil ? 'Surveil' : 'Scry'} ${pending.cards.length} — click a card to send it to the ${dest}${
                canOrder ? ', arrows to order the ones you keep' : ''
              }`}
        </div>
        <div className="eng-scry-cards">
          {order.map((oid) => {
            const c = cardBy(oid)
            if (!c) return null
            const marked = bottom.includes(oid)
            const nth = kept.indexOf(oid)
            return (
              <div key={oid} className="eng-scry-slot">
                <div
                  className={'eng-scry-card' + (marked ? ' to-bottom' : '')}
                  onClick={() => toggle(oid)}
                  title={reorder ? c.name : marked ? `${c.name} — to the ${dest}` : `${c.name} — click to send it to the ${dest}`}
                >
                  {c.cardId ? <img src={cardImageUrl(c.cardId)} alt={c.name} /> : <div className="cardback" />}
                  <div className="eng-scry-dest">
                    {marked ? dest : nth === 0 ? 'top' : `#${nth + 1} from the top`}
                  </div>
                </div>
                {!marked && canOrder && (
                  <div className="eng-scry-order">
                    <button
                      className="mini"
                      disabled={!canMoveKept(order, bottom, oid, -1)}
                      onClick={() => move(oid, -1)}
                      title="Move nearer the top"
                    >
                      ◀
                    </button>
                    <button
                      className="mini"
                      disabled={!canMoveKept(order, bottom, oid, 1)}
                      onClick={() => move(oid, 1)}
                      title="Move further down"
                    >
                      ▶
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="eng-scry-actions">
          <button className="primary" onClick={() => onConfirm(false, kept)}>
            {reorder ? 'Put back' : 'Confirm'}
          </button>
          {reorder && pending.mayShuffle && (
            <button className="mini" onClick={() => onConfirm(true, kept)} title="Put them back, then shuffle your library">
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

