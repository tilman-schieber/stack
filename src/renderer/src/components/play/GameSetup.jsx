import React, { useEffect, useState } from 'react'
import { useEngineGame } from '../../store/engineGame.js'
import { resolveSavedDeck } from '../../lib/resolveDeck.js'
import DeckPicker from './DeckPicker.jsx'
import NetworkSetup from './NetworkSetup.jsx'
import { useNav } from '../../store/nav.js'
import { useDecks } from '../../store/decks.js'

// Choose a play mode and set up a game: local hot-seat, or a serverless online
// game (host or join) over a peer-to-peer WebRTC connection.
export default function GameSetup() {
  const startEngineGame = useEngineGame((s) => s.startEngineGame)
  const notice = useEngineGame((s) => s.notice)
  const clearNotice = useEngineGame((s) => s.clearNotice)
  const decks = useDecks((s) => s.decks)
  const seeding = useDecks((s) => s.seeding)
  // A deck chosen elsewhere ("Play" on a deck) arrives as Player 1's deck.
  const preset = useNav((s) => s.playDeck)
  const [mode, setMode] = useState('local') // 'local' | 'host' | 'join'
  const [e0, setE0] = useState(preset || '')
  const [e1, setE1] = useState('')
  // Default to the first two decks (or whatever exists) once the list is known.
  useEffect(() => {
    if (!decks.length) return
    const has = (slug) => decks.some((d) => d.slug === slug)
    const first = has(e0) ? e0 : decks[0].slug
    if (first !== e0) setE0(first)
    if (!has(e1) || e1 === first) setE1((decks.find((d) => d.slug !== first) || decks[0]).slug)
  }, [decks]) // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [commander, setCommander] = useState(false) // play the Commander format (903)
  const [vsBot, setVsBot] = useState(true) // player 2 is the computer

  async function startLocal() {
    setBusy(true)
    setError('')
    try {
      const [d0, d1] = await Promise.all([resolveSavedDeck(e0), resolveSavedDeck(e1)])
      if (commander && (!d0.commander || !d1.commander))
        throw new Error("Commander needs a commander in each deck (a card in the deck's Commander section).")
      if (vsBot) d1.name = `Computer (${d1.name})`
      startEngineGame({ decks: [d0, d1], format: commander ? 'commander' : null, bots: vsBot ? [1] : [] })
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
            Local / vs. computer
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
              {vsBot
                ? 'You against the computer, with automatic rule enforcement. Its hand is hidden.'
                : 'Two players on this screen, with automatic rule enforcement. Both hands are visible.'}
            </p>
            <DeckPicker label="Player 1 deck" value={e0} onChange={setE0} />
            <DeckPicker label={vsBot ? 'Computer deck' : 'Player 2 deck'} value={e1} onChange={setE1} />
            <label className="setup-check">
              <input type="checkbox" checked={vsBot} onChange={(ev) => setVsBot(ev.target.checked)} />
              Player 2 is the computer (a simple opponent: plays lands and spells, attacks when safe, blocks when it trades)
            </label>
            <label className="setup-check">
              <input type="checkbox" checked={commander} onChange={(ev) => setCommander(ev.target.checked)} />
              Commander — 40 life, commanders start in the command zone (both decks need one)
            </label>
            {decks.length === 0 && (
              <div className="deck-coverage warn">
                {seeding ? 'Setting up the default decks…' : 'No decks yet — add one in Decks (or restore the default decks there).'}
              </div>
            )}
            {error && <div className="search-error">{error}</div>}
            <button className="primary" onClick={startLocal} disabled={busy || !e0 || !e1}>
              {busy ? 'Resolving cards…' : 'Start game'}
            </button>
          </>
        )}

        {mode !== 'local' && <NetworkSetup role={mode} />}
      </div>
    </div>
  )
}
