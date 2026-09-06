import React from 'react'
import { useNav } from '../store/nav.js'
import { useDeck } from '../store/deck.js'
import { useDecks } from '../store/decks.js'
import DeckPlate from '../components/DeckPlate.jsx'
import logoUrl from '../assets/logo.png'

const SHOWN = 6

// Landing page: what the app does, the three places to go, and the quickest
// route into a game — your decks, each with Play and Edit.
export default function Home() {
  const go = useNav((s) => s.go)
  const play = useNav((s) => s.play)
  const newDeck = useDeck((s) => s.newDeck)
  const loadSaved = useDeck((s) => s.loadSaved)
  const decks = useDecks((s) => s.decks)
  const loaded = useDecks((s) => s.loaded)
  const seeding = useDecks((s) => s.seeding)
  const seedError = useDecks((s) => s.seedError)

  async function edit(slug) {
    await loadSaved(await window.api.loadDeck(slug))
    go('build')
  }
  function createNew() {
    newDeck()
    go('build')
  }

  const shown = decks.slice(0, SHOWN)

  return (
    <div className="home">
      <section className="home-hero">
        <h1>
          <img src={logoUrl} alt="" className="hero-logo" />
          Stack
        </h1>
        <p>
          Build Magic: The Gathering decks and play them with the rules enforced for you — against the computer, a
          friend at the same screen, or a friend online with no server in between. Card data and art come from Scryfall.
        </p>
      </section>

      <section className="home-tiles">
        <div className="tile">
          <h3>Play</h3>
          <p className="muted">
            Start a game with any of your decks. The engine handles priority, the stack, combat and triggers; you make
            the decisions.
          </p>
          <div className="tile-actions">
            <button className="primary" onClick={() => play(null)} disabled={decks.length === 0}>
              New game
            </button>
          </div>
        </div>
        <div className="tile">
          <h3>Decks</h3>
          <p className="muted">
            {decks.length ? `${decks.length} deck${decks.length === 1 ? '' : 's'}. ` : ''}
            Import lists, export them, rename, duplicate, delete.
          </p>
          <div className="tile-actions">
            <button className="secondary" onClick={() => go('decks')}>
              All decks
            </button>
            <button className="secondary" onClick={() => go('decks', 'import')}>
              Import a list…
            </button>
          </div>
        </div>
        <div className="tile">
          <h3>Build</h3>
          <p className="muted">
            Search Scryfall, pick printings, watch the curve and see how much of the deck the rules engine fully
            supports.
          </p>
          <div className="tile-actions">
            <button className="secondary" onClick={createNew}>
              New deck
            </button>
          </div>
        </div>
      </section>

      <section className="home-section">
        <h3>Your decks</h3>
        {seeding && <p className="muted small">Setting up the default decks — fetching their cards from Scryfall…</p>}
        {seedError && <p className="deck-coverage warn">Could not set up the default decks: {seedError}</p>}
        {loaded && !seeding && decks.length === 0 && (
          <p className="muted small">No decks yet. Import a list, build one, or restore the default decks in Decks.</p>
        )}
        {shown.length > 0 && (
          <>
            <div className="deck-grid">
              {shown.map((d) => (
                <DeckPlate key={d.slug} deck={d} onPlay={() => play(d.slug)} onEdit={() => edit(d.slug)} />
              ))}
            </div>
            {decks.length > SHOWN && (
              <button className="secondary all-decks" onClick={() => go('decks')}>
                All {decks.length} decks →
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
