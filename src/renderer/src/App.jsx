import React, { useEffect, useState } from 'react'
import Home from './views/Home.jsx'
import DeckManager from './views/DeckManager.jsx'
import DeckBuilder from './views/DeckBuilder.jsx'
import PlayArea from './views/PlayArea.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import { useSettings } from './store/settings.js'
import { useNav } from './store/nav.js'
import { useDecks } from './store/decks.js'

// Keeps a render error in one view from white-screening the whole app.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#e07070' }}>
          <h2>Something went wrong rendering this view.</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error?.stack || this.state.error)}</pre>
          <button onClick={() => this.setState({ error: null })}>Dismiss</button>
        </div>
      )
    }
    return this.props.children
  }
}

const VIEWS = [
  ['home', 'Home'],
  ['decks', 'Decks'],
  ['build', 'Build'],
  ['play', 'Play']
]

export default function App() {
  const view = useNav((s) => s.view)
  const go = useNav((s) => s.go)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const loadSettings = useSettings((s) => s.load)
  const initDecks = useDecks((s) => s.init)

  useEffect(() => {
    loadSettings()
    // Loads the deck list and, on first start, saves the default decks into it.
    initDecks().catch((err) => console.warn('deck setup failed:', err))
  }, [loadSettings, initDecks])

  return (
    <div className="root">
      <header className="topbar">
        <button className="topbrand" onClick={() => go('home')} title="Home">
          🃏 Stack
        </button>
        <nav className="viewnav">
          {VIEWS.map(([key, label]) => (
            <button key={key} className={view === key ? 'active' : ''} onClick={() => go(key)}>
              {label}
            </button>
          ))}
        </nav>
        <button className="gear topgear" title="Settings" onClick={() => setSettingsOpen(true)}>
          ⚙
        </button>
      </header>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <div className="viewbody">
        <ErrorBoundary key={view}>
          {view === 'home' ? <Home /> : view === 'decks' ? <DeckManager /> : view === 'build' ? <DeckBuilder /> : <PlayArea />}
        </ErrorBoundary>
      </div>
    </div>
  )
}
