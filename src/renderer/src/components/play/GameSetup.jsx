import React, { useState } from 'react'
import { useEngineGame } from '../../store/engineGame.js'
import { EXAMPLE_DECKS } from '../../lib/exampleDecks.js'
import { resolvePlayableDeck } from '../../lib/resolveDeck.js'
import DeckPicker from './DeckPicker.jsx'
import NetworkSetup from './NetworkSetup.jsx'

// Choose a play mode and set up a game: local hot-seat, or a serverless online
// game (host or join) over a peer-to-peer WebRTC connection.
export default function GameSetup() {
  const startEngineGame = useEngineGame((s) => s.startEngineGame)
  const notice = useEngineGame((s) => s.notice)
  const clearNotice = useEngineGame((s) => s.clearNotice)
  const [mode, setMode] = useState('local') // 'local' | 'host' | 'join'
  const [e0, setE0] = useState(`example:${EXAMPLE_DECKS[0].slug}`)
  const [e1, setE1] = useState(`example:${EXAMPLE_DECKS[1].slug}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function startLocal() {
    setBusy(true)
    setError('')
    try {
      const [d0, d1] = await Promise.all([resolvePlayableDeck(e0), resolvePlayableDeck(e1)])
      startEngineGame({ decks: [d0, d1] })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="game-setup">
      <div className="setup-card">
        <h2>New game</h2>
        {notice && mode === 'local' && (
          <div className="search-error setup-notice">
            {notice}{' '}
            <button className="mini" onClick={clearNotice}>
              OK
            </button>
          </div>
        )}
        <div className="mode-tabs">
          <button className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>
            Local hot-seat
          </button>
          <button className={mode === 'host' ? 'active' : ''} onClick={() => setMode('host')}>
            Host online
          </button>
          <button className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>
            Join online
          </button>
        </div>

        {mode === 'local' && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Two players on this screen, with automatic rule enforcement. Both hands are visible.
            </p>
            <DeckPicker label="Player 1 deck" value={e0} onChange={setE0} />
            <DeckPicker label="Player 2 deck" value={e1} onChange={setE1} />
            {error && <div className="search-error">{error}</div>}
            <button className="primary" onClick={startLocal} disabled={busy}>
              {busy ? 'Resolving cards…' : 'Start game'}
            </button>
          </>
        )}

        {mode !== 'local' && <NetworkSetup role={mode} />}
      </div>
    </div>
  )
}
