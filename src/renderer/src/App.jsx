import React, { useEffect, useState } from 'react'
import DeckBuilder from './views/DeckBuilder.jsx'
import PlayArea from './views/PlayArea.jsx'
import TokenBrowser from './views/TokenBrowser.jsx'
import { useSettings } from './store/settings.js'
import { useGame } from './store/game.js'

export default function App() {
  const [view, setView] = useState('build')
  const loadSettings = useSettings((s) => s.load)
  const started = useGame((s) => s.started)
  const turn = useGame((s) => s.turn)
  const activePlayer = useGame((s) => s.players[s.activePlayer]?.name)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  return (
    <div className="root">
      <header className="topbar">
        <div className="topbrand">🃏 MTG</div>
        <nav className="viewnav">
          <button className={view === 'build' ? 'active' : ''} onClick={() => setView('build')}>
            Build
          </button>
          <button className={view === 'tokens' ? 'active' : ''} onClick={() => setView('tokens')}>
            Tokens
          </button>
          <button className={view === 'play' ? 'active' : ''} onClick={() => setView('play')}>
            Play
          </button>
        </nav>
        {view === 'play' && started && (
          <div className="topturn">
            Turn {turn} · {activePlayer}
          </div>
        )}
      </header>
      <div className="viewbody">
        {view === 'build' && <DeckBuilder />}
        {view === 'tokens' && <TokenBrowser />}
        {view === 'play' && <PlayArea />}
      </div>
    </div>
  )
}
