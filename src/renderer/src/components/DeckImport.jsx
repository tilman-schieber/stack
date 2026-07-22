import React, { useState } from 'react'
import { parseDecklist } from '../lib/deckParser.js'
import { useDeck } from '../store/deck.js'

const SAMPLE = `4 Monastery Swiftspear
4 Soul-Scar Mage
4 Bomat Courier
4 Lightning Bolt
4 Lava Spike
4 Rift Bolt
4 Boros Charm
4 Skewer the Critics
3 Light Up the Stage
2 Seal of Fire
19 Mountain

Sideboard
3 Smash to Smithereens
2 Skullcrack`

// Panel for pasting an Arena/MTGO decklist and importing it.
export default function DeckImport({ onDone }) {
  const [text, setText] = useState('')
  const importParsed = useDeck((s) => s.importParsed)
  const loading = useDeck((s) => s.loading)

  async function doImport() {
    const parsed = parseDecklist(text)
    await importParsed(parsed)
    onDone?.()
  }

  return (
    <div className="import-panel">
      <p className="muted small">
        Paste a plain-text decklist (Arena export format). Quantities and
        <code> (SET) 123</code> suffixes are optional.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'4 Lightning Bolt\n20 Mountain\n...'}
        rows={16}
        spellCheck={false}
      />
      <div className="import-actions">
        <button className="secondary" onClick={() => setText(SAMPLE)}>
          Load sample
        </button>
        <button className="primary" onClick={doImport} disabled={loading || !text.trim()}>
          {loading ? 'Importing…' : 'Import deck'}
        </button>
      </div>
    </div>
  )
}
