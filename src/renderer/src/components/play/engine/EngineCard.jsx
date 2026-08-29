import React, { useEffect } from 'react'
import { useTokenArt, tokenKey } from '../../../store/tokenArt.js'

// Card-level building blocks of the rules-enforced board.

// A card's image: the back face of a double-faced card when that face is up.
export const cardImg = (c) => (c.cardId ? `card://${c.cardId}${c.face ? '/back' : ''}` : null)
export const isCreature = (c) => c.types?.includes('Creature')
export const isLand = (c) => c.types?.includes('Land')

// One permanent / stack card, styled from play.css .board-card.
// Right-click zooms (via onZoom); left-click acts (via onClick).
export function EngineCard({ card, className = '', onClick, onZoom, title }) {
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
    >
      {img ? <img src={img} alt={card.name} draggable={false} /> : <div className="cardback" />}
      {card.faceDown && <span className="eng-facedown">{card.realName ? '?' : ''}</span>}
      {isCreature(card) && pt && <span className="eng-pt">{pt}</span>}
      {card.damage > 0 && <span className="eng-dmg">{card.damage}</span>}
      {card.loyalty != null && <span className="eng-loyalty">◆ {card.loyalty}</span>}
      {card.defense != null && <span className="eng-loyalty" title="Defense">🛡 {card.defense}</span>}
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

export function ManaPool({ pool }) {
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

