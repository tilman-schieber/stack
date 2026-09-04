import React, { useEffect } from 'react'
import { useTokenArt, tokenKey } from '../../../store/tokenArt.js'

// Card-level building blocks of the rules-enforced board.

// A card's image: the back face of a double-faced card when that face is up.
export const cardImg = (c) => (c.cardId ? `card://${c.cardId}${c.face ? '/back' : ''}` : null)
export const isCreature = (c) => c.types?.includes('Creature')
export const isLand = (c) => c.types?.includes('Land')

// One permanent / stack card, styled from play.css .board-card.
// Right-click zooms (via onZoom); left-click acts (via onClick).
export function EngineCard({ card, className = '', onClick, onZoom, onHover, title }) {
  // Tokens have no fixed printing — resolve their art from the token-art store.
  const key = card.token && card.tokenDef ? tokenKey(card.tokenDef) : null
  const artId = useTokenArt((s) => (key ? s.cache[key]?.chosenId : null))
  const ensure = useTokenArt((s) => s.ensure)
  useEffect(() => {
    if (key) ensure(card.tokenDef)
  }, [key, ensure]) // eslint-disable-line react-hooks/exhaustive-deps
  const imgId = card.token ? artId : card.cardId
  const img = imgId ? `card://${imgId}${!card.token && card.face ? '/back' : ''}` : null
  const pt = card.power != null ? `${card.power}/${card.toughness}` : null
  return (
    <div
      className={'board-card ' + (card.tapped ? 'tapped ' : '') + className}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault()
        onZoom?.(card)
      }}
      title={card.faceDown && card.realName ? `Face-down: ${card.realName}` : title || card.name}
      onMouseEnter={onHover ? () => onHover(card) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
    >
      {img ? <img src={img} alt={card.name} draggable={false} /> : <div className="cardback" />}
      {card.faceDown && <span className="eng-facedown">{card.realName ? '?' : ''}</span>}
      {isCreature(card) && pt && <span className="eng-pt">{pt}</span>}
      {card.damage > 0 && <span className="eng-dmg">{card.damage}</span>}
      {card.loyalty != null && <span className="eng-loyalty">◆ {card.loyalty}</span>}
      {card.defense != null && <span className="eng-loyalty" title="Defense">🛡 {card.defense}</span>}
      {card.supported === false && !card.hidden && (
        <span className="eng-badge warn" title="Part of this card's text is not enforced by the rules engine — it plays with its printed characteristics only">
          !
        </span>
      )}
      {card.restrictions?.length > 0 && (
        <span className="eng-badge stop" title={`Can't ${card.restrictions.join(' or ')}`}>
          ⛔
        </span>
      )}
    </div>
  )
}

// A helper card that isn't part of anyone's deck: the Monarch, the Initiative,
// a dungeon card (with the current room), an emblem. Art comes from the real
// Scryfall printing (`def.scryfallId`, else looked up by name); clicking zooms
// it — and, like a token, its art can be cycled there.
export function HelperCard({ def, label, sub, info, dungeon, onZoom, onHover }) {
  const key = tokenKey(def)
  const artId = useTokenArt((s) => s.cache[key]?.chosenId)
  const ensure = useTokenArt((s) => s.ensure)
  useEffect(() => {
    ensure(def)
  }, [key, ensure]) // eslint-disable-line react-hooks/exhaustive-deps
  const img = artId ? `card://${artId}${def.face === 'back' ? '/back' : ''}` : null
  const card = {
    oid: 'helper:' + key,
    name: label || def.name,
    token: true,
    helper: true,
    tokenDef: def,
    dungeon: dungeon || null,
    oracleText: info || '',
    types: [],
    supertypes: [],
    keywords: [],
    printedKeywords: [],
    counters: {},
    supported: true
  }
  return (
    <div className="eng-helper-wrap">
      <div
        className="board-card eng-helper"
        title={sub ? `${card.name} — ${sub}` : card.name}
        onClick={() => onZoom?.(card)}
        onContextMenu={(e) => {
          e.preventDefault()
          onZoom?.(card)
        }}
        onMouseEnter={onHover ? () => onHover(card) : undefined}
        onMouseLeave={onHover ? () => onHover(null) : undefined}
      >
        {img ? <img src={img} alt={card.name} draggable={false} /> : <div className="cardback" />}
        {sub && <span className="eng-helper-sub">{sub}</span>}
      </div>
      <span className="eng-helper-label">{label || def.name}</span>
    </div>
  )
}

export function Pile({ label, count, topCard, faceDown, onOpen }) {
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

export function ManaPool({ pool, restricted = [] }) {
  const COLORS = { W: '#f6f3e0', U: '#b3d5f2', B: '#c9c1cf', R: '#f0b0a0', G: '#a8d6ab', C: '#cfc9c1' }
  const active = Object.entries(pool || {}).filter(([, n]) => n > 0)
  // Restricted mana (106.6: spendable only on certain spells) is shown with a star.
  const byColor = {}
  for (const c of restricted || []) byColor[c] = (byColor[c] || 0) + 1
  for (const [c, n] of Object.entries(byColor)) active.push([c + '*', n])
  if (active.length === 0) return null
  return (
    <span className="eng-mana">
      {active.map(([c, n]) => (
        <span key={c} className="eng-mana-pip" style={{ background: COLORS[c.replace('*', '')] }} title={c.endsWith('*') ? 'Restricted mana' : undefined}>
          {n}
          {c}
        </span>
      ))}
    </span>
  )
}

