import React, { useEffect, useRef, useState } from 'react'
import { useTokenArt, tokenKey } from '../../../store/tokenArt.js'
import { cardImageUrl } from '../../../lib/cardUtils.js'

// Card-level building blocks of the rules-enforced board.

// A card's image: the back face of a double-faced card when that face is up.
export const cardImg = (c) => cardImageUrl(c.cardId, c.face)
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
  const img = cardImageUrl(imgId, !card.token && card.face)
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
      {card.ringBearer && <span className="eng-badge ring" title="Your Ring-bearer: legendary, can't be blocked by creatures with greater power (and more as the Ring tempts you)">💍</span>}
      {card.classLevel != null && <span className="eng-loyalty" title="Class level">Lv {card.classLevel}</span>}
      {card.doors && (
        <span className="eng-loyalty" title={card.doors.map((d) => `${d.name}: ${d.unlocked ? 'unlocked' : 'locked'}`).join('\n')}>
          {card.doors.map((d) => (d.unlocked ? '🚪' : '🔒')).join('')}
        </span>
      )}
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
  const img = cardImageUrl(artId, def.face === 'back')
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

// A zone as a physical pile: the top card (or a card back) with the edges of the
// cards underneath showing behind it, so a full library looks thick and a nearly
// empty one looks thin. Depth saturates around 40 cards.
export function Pile({ label, count, topCard, faceDown, onOpen }) {
  const depth = count === 0 ? 0 : Math.min(1, 0.3 + count / 45)
  const openable = !!onOpen && count > 0
  return (
    <div className="rail-pile">
      <div
        className={'rail-pile-card' + (count === 0 ? ' empty' : '') + (openable ? ' openable' : '')}
        title={count === 0 ? `${label} — empty` : `${label} (${count})${openable ? ' — click to look through it' : ''}`}
        onClick={openable ? onOpen : undefined}
        style={{ '--depth': depth }}
      >
        {count === 0 ? (
          <div className="pile-empty" />
        ) : faceDown || !topCard?.cardId ? (
          <div className="cardback" />
        ) : (
          <img src={cardImg(topCard)} alt="" draggable={false} />
        )}
        {count > 0 && <span className="pile-count">{count}</span>}
      </div>
      <div className="rail-pile-label">{label}</div>
    </div>
  )
}

const MANA_ORDER = ['W', 'U', 'B', 'R', 'G', 'C']
const MANA_NAME = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless' }
const PIP_LIMIT = 12

// Floating mana as one pip per mana, in its own colour, WUBRG then colourless.
// Restricted mana (106.6: spendable only on certain spells) carries a star.
export function ManaPool({ pool, restricted = [] }) {
  const pips = []
  const rest = {}
  for (const c of restricted || []) rest[c] = (rest[c] || 0) + 1
  for (const c of MANA_ORDER) {
    for (let i = 0; i < (pool?.[c] || 0); i++) pips.push({ c, restricted: false })
    for (let i = 0; i < (rest[c] || 0); i++) pips.push({ c, restricted: true })
  }
  if (!pips.length) return null
  const shown = pips.slice(0, PIP_LIMIT)
  const summary = MANA_ORDER.filter((c) => pips.some((p) => p.c === c))
    .map((c) => `${pips.filter((p) => p.c === c).length} ${MANA_NAME[c]}`)
    .join(', ')
  return (
    <span className="eng-mana" title={`Unspent mana: ${summary}`}>
      {shown.map((p, i) => (
        <span
          key={i}
          className={'mana-pip mana-' + p.c.toLowerCase() + (p.restricted ? ' restricted' : '')}
          title={p.restricted ? `Restricted ${MANA_NAME[p.c]} mana` : undefined}
        >
          {p.c}
        </span>
      ))}
      {pips.length > shown.length && <span className="mana-more">+{pips.length - shown.length}</span>}
    </span>
  )
}

// Life as a plate you read across the table. The last change floats off it, so a
// bolt to the face registers without reading the log.
export function LifePlate({ life, onClick, targetable, title }) {
  const [delta, setDelta] = useState(null)
  const prev = useRef(life)
  useEffect(() => {
    if (life === prev.current) return
    const change = life - prev.current
    prev.current = life
    setDelta({ change, at: Date.now() })
    const t = setTimeout(() => setDelta(null), 1200)
    return () => clearTimeout(t)
  }, [life])
  return (
    <div
      className={'eng-life' + (targetable ? ' targetable' : '') + (life <= 5 ? ' low' : '')}
      onClick={onClick}
      title={title}
    >
      <span className="eng-life-n">{life}</span>
      {delta && (
        <span key={delta.at} className={'eng-life-delta ' + (delta.change > 0 ? 'up' : 'down')}>
          {delta.change > 0 ? '+' : ''}
          {delta.change}
        </span>
      )}
    </div>
  )
}

