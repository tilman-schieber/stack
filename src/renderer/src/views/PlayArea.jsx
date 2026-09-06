import React, { useEffect } from 'react'
import { useEngineGame } from '../store/engineGame.js'
import { useUi } from '../store/ui.js'
import GameSetup from '../components/play/GameSetup.jsx'
import EnginePlayArea from '../components/play/EnginePlayArea.jsx'
import Sideboard from '../components/play/Sideboard.jsx'

// Play tab: choose decks (GameSetup), play a rules-enforced game, and — in a
// best-of-three match — sideboard between games.
export default function PlayArea() {
  const started = useEngineGame((s) => s.started)
  const sideboarding = useEngineGame((s) => s.sideboarding)
  // The shell hides its nav bar while a game is on. It learns that from here
  // rather than by reading the engine store, which would pull the engine into
  // the main bundle and undo the code split.
  const setInGame = useUi((s) => s.setInGame)
  useEffect(() => {
    setInGame(started)
    return () => setInGame(false)
  }, [started, setInGame])
  if (sideboarding) return <Sideboard />
  return started ? <EnginePlayArea /> : <GameSetup />
}
