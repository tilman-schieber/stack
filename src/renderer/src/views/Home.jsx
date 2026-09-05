import React, { useEffect, useState } from 'react'
import { useNav } from '../store/nav.js'
import { useDeck } from '../store/deck.js'
import { EXAMPLE_DECKS } from '../lib/exampleDecks.js'

const deckSize = (d) => d.cards.reduce((s, [qty]) => s + qty, 0)

// Landing page: what the app does, the three places to go, and the quickest
// routes into a game — your recent decks and the built-in ones.
export default function Home() {
  const go = useNav((s) => s.go)
  const play = useNav((s) => s.play)
  const newDeck = useDeck((s) => s.newDeck)
  const loadSaved = useDeck((s) => s.loadSaved)
  const loadExample = useDeck((s) => s.loadExample)
  const [saved, setSaved] = useState([])

  useEffect(() => {
    let alive = true
    window.api.listDecks().then((list) => alive && setSaved(list))
    return () => {
      alive = false
    }
  }, [])

  async function editSaved(slug) {
    await loadSaved(await window.api.loadDeck(slug))
    go('build')
  }
  async function editExample(deck) {
    await loadExample(deck)
    go('build')
  }
  function createNew() {
    newDeck()
    go('build')
  }

  const recent = saved.slice(0, 5)
  const featured = EXAMPLE_DECKS.filter((d) => /Pauper/.test(d.name))

  return (
    <div className="home">
      <section className="home-hero">
        <h1>🃏 Stack</h1>
        <p>
          Build Magic: The Gathering decks and play them with the rules enforced for you — against the computer, a
          friend at the same screen, or a friend online with no server in between. Card data and art come from Scryfall.
        </p>
      </section>

      <section className="home-tiles">
        <div className="tile">
          <h3>Play</h3>
          <p className="muted">
            Start a game with any built-in or saved deck. The engine handles priority, the stack, combat and triggers;
            you make the decisions.
          </p>
          <div className="tile-actions">
            <button className="primary" onClick={() => play(null)}>
              New game
            </button>
          </div>
        </div>
        <div className="tile">
          <h3>Decks</h3>
          <p className="muted">
            {saved.length
              ? `${saved.length} saved deck${saved.length === 1 ? '' : 's'} plus ${EXAMPLE_DECKS.length} built-in ones.`
              : `No saved decks yet — ${EXAMPLE_DECKS.length} built-in decks are ready to play or copy.`}{' '}
            Import lists, export them, rename, duplicate.
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

      {recent.length > 0 && (
        <section className="home-section">
          <h3>Your recent decks</h3>
          <div className="home-list">
            {recent.map((d) => (
              <div key={d.slug} className="home-row">
                <span className="home-row-name">{d.name}</span>
                <span className="muted small">{d.count} cards</span>
                <span className="home-row-actions">
                  <button className="mini primary" onClick={() => play(`saved:${d.slug}`)}>
                    Play
                  </button>
                  <button className="mini" onClick={() => editSaved(d.slug)}>
                    Edit
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="home-section">
        <h3>Built-in decks</h3>
        <p className="muted small">
          Real tournament lists, every card fully supported by the rules engine. Play them as they are, or open one
          and save your own version.
        </p>
        <div className="home-list">
          {featured.map((d) => (
            <div key={d.slug} className="home-row">
              <span className="home-row-name" title={d.description}>
                {d.name}
              </span>
              <span className="muted small">{deckSize(d)} cards</span>
              <span className="home-row-actions">
                <button className="mini primary" onClick={() => play(`example:${d.slug}`)}>
                  Play
                </button>
                <button className="mini" onClick={() => editExample(d)}>
                  Open
                </button>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
