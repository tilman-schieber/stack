import React, { useEffect, useState } from 'react'
import DeckManager from './views/DeckManager.jsx'
import DeckBuilder from './views/DeckBuilder.jsx'
import PlayArea from './views/PlayArea.jsx'
import { useSettings } from './store/settings.js'

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
  ['decks', 'Decks'],
  ['build', 'Build'],
  ['play', 'Play']
]

export default function App() {
  const [view, setView] = useState('decks')
  const loadSettings = useSettings((s) => s.load)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  return (
    <div className="root">
      <header className="topbar">
        <div className="topbrand">🃏 MTG</div>
        <nav className="viewnav">
          {VIEWS.map(([key, label]) => (
            <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div className="viewbody">
        <ErrorBoundary key={view}>
          {view === 'decks' ? (
            <DeckManager onEdit={() => setView('build')} />
          ) : view === 'build' ? (
            <DeckBuilder onManageDecks={() => setView('decks')} />
          ) : (
            <PlayArea />
          )}
        </ErrorBoundary>
      </div>
    </div>
  )
}
