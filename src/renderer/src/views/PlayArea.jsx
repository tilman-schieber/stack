import React, { useEffect, useState } from 'react'
import { useGame } from '../store/game.js'
import { useEngineGame } from '../store/engineGame.js'
import { useBoardDrag } from '../lib/useBoardDrag.js'
import { instanceImage } from '../lib/gameCard.js'
import GameSetup from '../components/play/GameSetup.jsx'
import EnginePlayArea from '../components/play/EnginePlayArea.jsx'
import TurnBar from '../components/play/TurnBar.jsx'
import PlayerPanel from '../components/play/PlayerPanel.jsx'
import ZoneRail from '../components/play/ZoneRail.jsx'
import Battlefield from '../components/play/Battlefield.jsx'
import Hand from '../components/play/Hand.jsx'
import CardMenu from '../components/play/CardMenu.jsx'
import ZoneViewer from '../components/play/ZoneViewer.jsx'
import TokenSearch from '../components/play/TokenSearch.jsx'
import '../play.css'

export default function PlayArea() {
  const engineStarted = useEngineGame((s) => s.started)
  const started = useGame((s) => s.started)
  const players = useGame((s) => s.players)
  const activePlayer = useGame((s) => s.activePlayer)
  const cardsById = useGame((s) => s.cardsById)
  const toggleTap = useGame((s) => s.toggleTap)
  const hydrate = useGame((s) => s.hydrate)
  const createToken = useGame((s) => s.createToken)

  const [menu, setMenu] = useState(null) // { instance, playerId, zone, x, y }
  const [viewer, setViewer] = useState(null) // { playerId, zone }
  const [tokenFor, setTokenFor] = useState(null) // playerId

  // Restore an in-progress game once on mount.
  useEffect(() => {
    if (!started) hydrate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tap on click (no drag) for battlefield cards.
  const { start, drag } = useBoardDrag({
    onTap: (d) => {
      if (d.fromZone === 'battlefield') toggleTap(d.fromPlayer, d.instance.iid)
    }
  })

  const onMenu = (e, target) => setMenu({ ...target, x: e.clientX, y: e.clientY })
  const openZone = (playerId) => (zone) => setViewer({ playerId, zone })

  if (engineStarted) return <EnginePlayArea />
  if (!started) return <GameSetup />

  // Fixed seats — player 1 always on top, player 2 always on the bottom. The
  // active player is highlighted, not moved (swapping seats is confusing).
  const top = players[1]
  const bottom = players[0]

  const dragImg = drag?.moved
    ? drag.instance.faceDown
      ? null
      : instanceImage(drag.instance)
    : null

  return (
    <div className="play-area">
      <TurnBar />

      {/* Top seat — player 1 (fixed) */}
      <Hand player={top} cardsById={cardsById} onStart={start} onMenu={onMenu} />
      <PlayerPanel player={top} isActive={activePlayer === top.id} />
      <div className="seat-body">
        <Battlefield player={top} cardsById={cardsById} onStart={start} onMenu={onMenu} />
        <ZoneRail player={top} onOpenZone={openZone(top.id)} />
      </div>

      {/* Bottom seat — player 2 (fixed) */}
      <div className="seat-body">
        <Battlefield player={bottom} cardsById={cardsById} onStart={start} onMenu={onMenu} />
        <ZoneRail player={bottom} onOpenZone={openZone(bottom.id)} />
      </div>
      <PlayerPanel player={bottom} isActive={activePlayer === bottom.id} />
      <Hand player={bottom} cardsById={cardsById} onStart={start} onMenu={onMenu} />

      {/* Floating drag preview */}
      {drag?.moved && (
        <div
          className={'drag-preview' + (drag.instance.tapped ? ' tapped' : '')}
          style={{ left: drag.x, top: drag.y }}
        >
          {dragImg ? <img src={dragImg} alt="" draggable={false} /> : <div className="cardback" />}
        </div>
      )}

      {menu && (
        <CardMenu
          menu={menu}
          card={cardsById[menu.instance.cardId]}
          onClose={() => setMenu(null)}
          onCreateToken={(pid) => setTokenFor(pid)}
        />
      )}
      {viewer && (
        <ZoneViewer viewer={viewer} cardsById={cardsById} onClose={() => setViewer(null)} />
      )}
      {tokenFor !== null && (
        <TokenSearch
          onPick={(card) => {
            createToken(tokenFor, card)
            setTokenFor(null)
          }}
          onClose={() => setTokenFor(null)}
        />
      )}
    </div>
  )
}
