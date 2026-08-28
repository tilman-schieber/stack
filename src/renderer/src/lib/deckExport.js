// Serialize a saved deck record to Arena-style plain text, the same format the
// importer reads:
//
//   Deck
//   4 Lightning Bolt (STA) 42
//   ...
//
//   Sideboard
//   2 Skullcrack (GTC) 105
//
// `cardsById` supplies set codes / collector numbers; entries whose card isn't
// available are written by name alone (still importable).

const SECTIONS = [
  ['commander', 'Commander'],
  ['main', 'Deck'],
  ['sideboard', 'Sideboard']
]

export function formatDecklist(record, cardsById = new Map()) {
  const blocks = []
  for (const [section, header] of SECTIONS) {
    const entries = (record.entries || []).filter((e) => (e.section || 'main') === section)
    if (!entries.length) continue
    const lines = entries.map((e) => {
      const card = cardsById.get(e.scryfallId)
      const suffix = card?.set && card?.collector_number ? ` (${card.set.toUpperCase()}) ${card.collector_number}` : ''
      return `${e.qty} ${e.name}${suffix}`
    })
    blocks.push([header, ...lines].join('\n'))
  }
  return blocks.join('\n\n') + '\n'
}

// Fetch the cards a record references (from the local cache) and format it.
export async function exportDeckText(record) {
  const ids = (record.entries || []).map((e) => e.scryfallId).filter(Boolean)
  let cardsById = new Map()
  try {
    const { cards } = await window.api.ensureCards(ids)
    cardsById = new Map(cards.map((c) => [c.id, c]))
  } catch {
    /* offline and uncached: export by name only */
  }
  return formatDecklist(record, cardsById)
}
