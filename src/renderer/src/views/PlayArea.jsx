import React from 'react'
import { useEngineGame } from '../store/engineGame.js'
import GameSetup from '../components/play/GameSetup.jsx'
import EnginePlayArea from '../components/play/EnginePlayArea.jsx'

// Play tab: choose decks (GameSetup) then play a rules-enforced game.
export default function PlayArea() {
  const started = useEngineGame((s) => s.started)
  return started ? <EnginePlayArea /> : <GameSetup />
}
