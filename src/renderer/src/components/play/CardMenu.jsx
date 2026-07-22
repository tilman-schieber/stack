import React, { useEffect } from 'react'
import { useGame } from '../../store/game.js'
import { hasBackFace } from '../../lib/gameCard.js'

// Right-click context menu for a card. `menu` = { instance, playerId, zone, x, y }.
export default function CardMenu({ menu, card, onClose, onCreateToken }) {
  const { instance, playerId, zone } = menu
  const g = useGame()

  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  const act = (fn) => (e) => {
    e.stopPropagation()
    fn()
    onClose()
  }

  const move = (toZone, opts) => () => g.moveCard(playerId, instance.iid, toZone, opts)

  const onBattlefield = zone === 'battlefield'
  const inHand = zone === 'hand'

  return (
    <div
      className="card-menu"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {onBattlefield && (
        <>
          <button onMouseDown={act(() => g.toggleTap(playerId, instance.iid))}>
            {instance.tapped ? 'Untap' : 'Tap'}
          </button>
          <button onMouseDown={act(() => g.setCounter(playerId, instance.iid, '+1/+1', 1))}>
            Add +1/+1
          </button>
          <button onMouseDown={act(() => g.setCounter(playerId, instance.iid, '+1/+1', -1))}>
            Remove +1/+1
          </button>
          <button onMouseDown={act(() => g.setCounter(playerId, instance.iid, 'loyalty', 1))}>
            Add loyalty
          </button>
          {hasBackFace(card) && (
            <button onMouseDown={act(() => g.flip(playerId, instance.iid))}>
              {instance.flipped ? 'Show front' : 'Flip (transform)'}
            </button>
          )}
          <button onMouseDown={act(() => g.toggleFaceDown(playerId, instance.iid))}>
            {instance.faceDown ? 'Turn face up' : 'Turn face down'}
          </button>
          <button onMouseDown={act(() => g.duplicate(playerId, instance.iid))}>
            Duplicate (token)
          </button>
          <div className="menu-sep" />
        </>
      )}

      {inHand && (
        <>
          <button onMouseDown={act(move('battlefield', { x: 40, y: 40 }))}>Play</button>
          <button onMouseDown={act(() => g.toggleFaceDown(playerId, instance.iid))}>
            Play face down…
          </button>
          <div className="menu-sep" />
        </>
      )}

      <div className="menu-label">Move to</div>
      {zone !== 'hand' && <button onMouseDown={act(move('hand'))}>Hand</button>}
      {zone !== 'battlefield' && (
        <button onMouseDown={act(move('battlefield', { x: 40, y: 40 }))}>Battlefield</button>
      )}
      {zone !== 'graveyard' && <button onMouseDown={act(move('graveyard'))}>Graveyard</button>}
      {zone !== 'exile' && <button onMouseDown={act(move('exile'))}>Exile</button>}
      <button onMouseDown={act(move('library', { toTop: true }))}>Library (top)</button>
      <button onMouseDown={act(move('library'))}>Library (bottom)</button>

      <div className="menu-sep" />
      <button onMouseDown={act(() => onCreateToken(playerId))}>Create token…</button>
    </div>
  )
}
