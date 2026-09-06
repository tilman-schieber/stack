// Which of the actions the engine is offering apply to a card sitting in a
// graveyard, an exile pile or the command zone.
//
// Most of a card's life it is played from hand, but a good few can be used from
// somewhere else: flashback and escape and disturb from the graveyard, plot and
// foretell from exile, embalm, unearth, and abilities a card only has while it
// is in the graveyard — Cauldron Familiar's "Sacrifice a Food: return this card
// from your graveyard to the battlefield" being the awkward one, because it is
// an activated ability rather than a way of casting the card, and listing only
// the cast-like actions left it with no way to be clicked.

// Action types that mean "you can do something with this card from this zone".
const FROM_ANY_PILE = new Set(['castFlashback', 'castEscape', 'castPlotted', 'castDisturb', 'unearth', 'embalm'])

export function zoneCardAction(actions, zone, oid) {
  if (!oid || !Array.isArray(actions)) return null
  return (
    actions.find((a) => {
      if (!a || a.oid !== oid) return false
      if (FROM_ANY_PILE.has(a.type)) return true
      // An ability the card has from the graveyard itself.
      if (a.type === 'activate' && a.fromGraveyard) return true
      // A commander is cast out of the command zone.
      if (a.type === 'cast' && zone === 'command') return true
      // Foretold and other exile-cast cards say so on the action.
      if ((a.type === 'cast' || a.type === 'playLand') && a.fromExile) return true
      return false
    }) || null
  )
}

// How many distinct cards in `cards` can be acted on right now — what the pile
// shows on its badge, so a usable card is not hidden behind a click.
export function readyCount(actions, zone, cards) {
  const usable = new Set()
  for (const c of cards || []) if (zoneCardAction(actions, zone, c.oid)) usable.add(c.oid)
  return usable.size
}
