import React from 'react'
import { useEngineGame } from '../store/engineGame.js'
import GameSetup from '../components/play/GameSetup.jsx'
import EnginePlayArea from '../components/play/EnginePlayArea.jsx'
import Sideboard from '../components/play/Sideboard.jsx'

// Play tab: choose decks (GameSetup), play a rules-enforced game, and — in a
// best-of-three match — sideboard between games.
export default function PlayArea() {
  const started = useEngineGame((s) => s.started)
  const sideboarding = useEngineGame((s) => s.sideboarding)
  if (sideboarding) return <Sideboard />
  return started ? <EnginePlayArea /> : <GameSetup />
}
