import React, { useEffect, useState } from 'react'
import DeckBuilder from './views/DeckBuilder.jsx'
import PlayArea from './views/PlayArea.jsx'
import { useSettings } from './store/settings.js'

export default function App() {
  const [view, setView] = useState('build')
  const loadSettings = useSettings((s) => s.load)

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
          <button className={view === 'play' ? 'active' : ''} onClick={() => setView('play')}>
            Play
          </button>
        </nav>
      </header>
      <div className="viewbody">
        {view === 'build' ? <DeckBuilder /> : <PlayArea />}
      </div>
    </div>
  )
}
