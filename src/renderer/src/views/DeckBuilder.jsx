import React, { useState } from 'react'
import DeckSidebar from '../components/DeckSidebar.jsx'
import CardGrid from '../components/CardGrid.jsx'
import DeckStats from '../components/DeckStats.jsx'
import CardSearch from '../components/CardSearch.jsx'
import DeckImport from '../components/DeckImport.jsx'
import SettingsModal from '../components/SettingsModal.jsx'
import { useDeck } from '../store/deck.js'

export default function DeckBuilder({ onManageDecks }) {
  const [tab, setTab] = useState('import')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const notFound = useDeck((s) => s.notFound)
  const parseErrors = useDeck((s) => s.parseErrors)

  const problems = [
    ...notFound.map((n) => ({ kind: 'Not found', text: n })),
    ...parseErrors.map((n) => ({ kind: 'Unreadable', text: n }))
  ]

  return (
    <div className="app">
      <DeckSidebar onOpenSettings={() => setSettingsOpen(true)} onManageDecks={onManageDecks} />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      <main className="main">
        {problems.length > 0 && (
          <div className="problems">
            <b>{problems.length} card(s) could not be added:</b>{' '}
            {problems.map((p, i) => (
              <span key={i} className="problem-chip" title={p.kind}>
                {p.text}
              </span>
            ))}
          </div>
        )}
        <CardGrid />
      </main>

      <section className="rightpanel">
        <div className="tabs">
          <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>
            Import
          </button>
          <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>
            Add cards
          </button>
          <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
            Stats
          </button>
        </div>
        <div className="tab-body">
          {tab === 'import' && <DeckImport onDone={() => setTab('stats')} />}
          {tab === 'search' && <CardSearch />}
          {tab === 'stats' && <DeckStats />}
        </div>
      </section>
    </div>
  )
}
