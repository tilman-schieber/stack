import React, { useState } from 'react'
import { imageSrc } from '../lib/cardUtils.js'
import { useDeck } from '../store/deck.js'
import PrintPicker from './PrintPicker.jsx'

// A single card image with quantity controls. Hover enlarges the card.
export default function CardTile({ entry }) {
  const setQty = useDeck((s) => s.setQty)
  const removeCard = useDeck((s) => s.removeCard)
  const [pickerOpen, setPickerOpen] = useState(false)
  const { card, qty, section, id } = entry

  return (
    <div className="card-tile">
      <div className="card-img-wrap">
        <img
          className="card-img"
          src={imageSrc(card)}
          alt={card.name}
          loading="lazy"
          draggable={false}
        />
        <span className="qty-badge">{qty}</span>
        <button
          className="art-btn"
          title="Change art / printing"
          onClick={() => setPickerOpen(true)}
        >
          🖼
        </button>
      </div>
      {pickerOpen && <PrintPicker entry={entry} onClose={() => setPickerOpen(false)} />}
      <div className="card-controls">
        <button title="Remove one" onClick={() => setQty(id, section, qty - 1)}>
          –
        </button>
        <span className="card-name" title={card.name}>
          {card.name}
        </span>
        <button title="Add one" onClick={() => setQty(id, section, qty + 1)}>
          +
        </button>
        <button className="del" title="Remove card" onClick={() => removeCard(id, section)}>
          ✕
        </button>
      </div>
    </div>
  )
}
