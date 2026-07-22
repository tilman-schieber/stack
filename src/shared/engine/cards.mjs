// Deriving base ("printed") characteristics from a Scryfall-style card object.
//
// The big lever from the plan: a large fraction of cards need no authoring at
// all — the engine reads mana_cost, type_line, power/toughness, colors and the
// keywords array straight off the cached Scryfall object. A behavior row is only
// needed when rules text implies effects the engine cannot derive.

export const BASIC_LAND_MANA = {
  Plains: 'W',
  Island: 'U',
  Swamp: 'B',
  Mountain: 'R',
  Forest: 'G'
}

// "{1}{G}" → { generic: 1, G: 1 }, "{3}{W}{W}" → { generic: 3, W: 2 }.
export function parseManaCost(str) {
  const cost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 }
  if (!str) return cost
  const syms = str.match(/\{[^}]+\}/g) || []
  for (const raw of syms) {
    const s = raw.slice(1, -1)
    if (/^\d+$/.test(s)) cost.generic += Number(s)
    else if (s === 'X') cost.X = (cost.X || 0) + 1
    else if (cost[s] != null) cost[s] += 1
    // hybrid/Phyrexian left for a later milestone
  }
  return cost
}

export function manaValue(cost) {
  return (cost.generic || 0) + cost.W + cost.U + cost.B + cost.R + cost.G + cost.C
}

// "Basic Land — Forest" → { supertypes:['Basic'], types:['Land'], subtypes:['Forest'] }
export function parseTypeLine(line) {
  const out = { supertypes: [], types: [], subtypes: [] }
  if (!line) return out
  const [left, right] = line.split(/\s+[—-]\s+/)
  out.subtypes = right ? right.trim().split(/\s+/) : []
  const SUPER = new Set(['Basic', 'Legendary', 'Snow', 'World', 'Ongoing', 'Elite', 'Host'])
  for (const w of left.trim().split(/\s+/)) {
    if (SUPER.has(w)) out.supertypes.push(w)
    else out.types.push(w)
  }
  return out
}

// Build the immutable base characteristics used by the engine.
export function printedFromScryfall(sf) {
  const cost = parseManaCost(sf.mana_cost || '')
  const t = parseTypeLine(sf.type_line || '')
  const power = sf.power != null && sf.power !== '' ? Number(sf.power) : null
  const toughness = sf.toughness != null && sf.toughness !== '' ? Number(sf.toughness) : null
  return {
    name: sf.name,
    manaCost: cost,
    manaValue: manaValue(cost),
    supertypes: t.supertypes,
    types: t.types,
    subtypes: t.subtypes,
    colors: sf.colors || [],
    keywords: sf.keywords || [],
    power,
    toughness,
    loyalty: sf.loyalty != null ? Number(sf.loyalty) : null,
    oracleText: sf.oracle_text || ''
  }
}

export const isType = (printed, type) => printed.types.includes(type)
export const isPermanent = (printed) =>
  ['Creature', 'Artifact', 'Enchantment', 'Land', 'Planeswalker', 'Battle'].some((t) =>
    printed.types.includes(t)
  )

// A tiny curated pool for M0 (Scryfall-shaped). Real games load these from the
// SQLite cache; tests build decks from this map by name.
export const SAMPLE_CARDS = {
  Plains: { name: 'Plains', mana_cost: '', type_line: 'Basic Land — Plains', colors: [] },
  Island: { name: 'Island', mana_cost: '', type_line: 'Basic Land — Island', colors: [] },
  Swamp: { name: 'Swamp', mana_cost: '', type_line: 'Basic Land — Swamp', colors: [] },
  Mountain: { name: 'Mountain', mana_cost: '', type_line: 'Basic Land — Mountain', colors: [] },
  Forest: { name: 'Forest', mana_cost: '', type_line: 'Basic Land — Forest', colors: [] },
  'Grizzly Bears': {
    name: 'Grizzly Bears',
    mana_cost: '{1}{G}',
    type_line: 'Creature — Bear',
    power: '2',
    toughness: '2',
    colors: ['G']
  },
  'Llanowar Elves': {
    name: 'Llanowar Elves',
    mana_cost: '{G}',
    type_line: 'Creature — Elf Druid',
    power: '1',
    toughness: '1',
    colors: ['G'],
    oracle_text: '{T}: Add {G}.'
  },
  'Lightning Bolt': {
    name: 'Lightning Bolt',
    mana_cost: '{R}',
    type_line: 'Instant',
    colors: ['R'],
    oracle_text: 'Lightning Bolt deals 3 damage to any target.'
  },
  'Serra Angel': {
    name: 'Serra Angel',
    mana_cost: '{3}{W}{W}',
    type_line: 'Creature — Angel',
    power: '4',
    toughness: '4',
    colors: ['W'],
    keywords: ['Flying', 'Vigilance']
  },
  'Elvish Visionary': {
    name: 'Elvish Visionary',
    mana_cost: '{1}{G}',
    type_line: 'Creature — Elf Shaman',
    power: '1',
    toughness: '1',
    colors: ['G'],
    oracle_text: 'When Elvish Visionary enters the battlefield, draw a card.'
  },
  'Soul Warden': {
    name: 'Soul Warden',
    mana_cost: '{W}',
    type_line: 'Creature — Human Cleric',
    power: '1',
    toughness: '1',
    colors: ['W'],
    oracle_text: 'Whenever another creature enters the battlefield, you gain 1 life.'
  },
  Divination: {
    name: 'Divination',
    mana_cost: '{2}{U}',
    type_line: 'Sorcery',
    colors: ['U'],
    oracle_text: 'Draw two cards.'
  },
  'Doom Blade': {
    name: 'Doom Blade',
    mana_cost: '{1}{B}',
    type_line: 'Instant',
    colors: ['B'],
    oracle_text: 'Destroy target nonblack creature.'
  },
  Counterspell: {
    name: 'Counterspell',
    mana_cost: '{U}{U}',
    type_line: 'Instant',
    colors: ['U'],
    oracle_text: 'Counter target spell.'
  },
  'Blood Artist': {
    name: 'Blood Artist',
    mana_cost: '{1}{B}',
    type_line: 'Creature — Vampire',
    power: '0',
    toughness: '1',
    colors: ['B'],
    oracle_text: 'Whenever Blood Artist or another creature dies, you gain 1 life.'
  },
  // Keyword creatures — all supported for free from the Scryfall keywords array.
  'White Knight': {
    name: 'White Knight',
    mana_cost: '{W}{W}',
    type_line: 'Creature — Human Knight',
    power: '2',
    toughness: '2',
    colors: ['W'],
    keywords: ['First strike']
  },
  'Fencing Ace': {
    name: 'Fencing Ace',
    mana_cost: '{1}{W}',
    type_line: 'Creature — Human Soldier',
    power: '1',
    toughness: '1',
    colors: ['W'],
    keywords: ['Double strike']
  },
  'Rumbling Baloth': {
    name: 'Rumbling Baloth',
    mana_cost: '{2}{G}{G}',
    type_line: 'Creature — Beast',
    power: '4',
    toughness: '4',
    colors: ['G'],
    keywords: ['Trample']
  },
  'Typhoid Rats': {
    name: 'Typhoid Rats',
    mana_cost: '{B}',
    type_line: 'Creature — Rat',
    power: '1',
    toughness: '1',
    colors: ['B'],
    keywords: ['Deathtouch']
  },
  'Vampire Nighthawk': {
    name: 'Vampire Nighthawk',
    mana_cost: '{1}{B}{B}',
    type_line: 'Creature — Vampire Shaman',
    power: '2',
    toughness: '3',
    colors: ['B'],
    keywords: ['Flying', 'Deathtouch', 'Lifelink']
  },
  'Giant Spider': {
    name: 'Giant Spider',
    mana_cost: '{3}{G}',
    type_line: 'Creature — Spider',
    power: '2',
    toughness: '4',
    colors: ['G'],
    keywords: ['Reach']
  },
  'Raging Goblin': {
    name: 'Raging Goblin',
    mana_cost: '{R}',
    type_line: 'Creature — Goblin Berserker',
    power: '1',
    toughness: '1',
    colors: ['R'],
    keywords: ['Haste']
  },
  'Boggart Brute': {
    name: 'Boggart Brute',
    mana_cost: '{2}{R}',
    type_line: 'Creature — Goblin Warrior',
    power: '3',
    toughness: '2',
    colors: ['R'],
    keywords: ['Menace']
  },
  // Vanilla beaters (no keywords, no text) — supported for free.
  'Hill Giant': {
    name: 'Hill Giant',
    mana_cost: '{3}{R}',
    type_line: 'Creature — Giant',
    power: '3',
    toughness: '3',
    colors: ['R']
  },
  'Goblin Piker': {
    name: 'Goblin Piker',
    mana_cost: '{1}{R}',
    type_line: 'Creature — Goblin',
    power: '2',
    toughness: '1',
    colors: ['R']
  },
  'Craw Wurm': {
    name: 'Craw Wurm',
    mana_cost: '{4}{G}{G}',
    type_line: 'Creature — Wurm',
    power: '6',
    toughness: '4',
    colors: ['G']
  },
  Shock: { name: 'Shock', mana_cost: '{R}', type_line: 'Instant', colors: ['R'] },
  'Lightning Strike': {
    name: 'Lightning Strike',
    mana_cost: '{1}{R}',
    type_line: 'Instant',
    colors: ['R']
  },
  Murder: { name: 'Murder', mana_cost: '{1}{B}{B}', type_line: 'Instant', colors: ['B'] },
  Cancel: { name: 'Cancel', mana_cost: '{1}{U}{U}', type_line: 'Instant', colors: ['U'] },
  'Sign in Blood': {
    name: 'Sign in Blood',
    mana_cost: '{B}{B}',
    type_line: 'Sorcery',
    colors: ['B']
  },
  // Static / continuous-effect cards (exercise the layer system).
  'Glorious Anthem': {
    name: 'Glorious Anthem',
    mana_cost: '{1}{W}{W}',
    type_line: 'Enchantment',
    colors: ['W'],
    oracle_text: 'Creatures you control get +1/+1.'
  },
  'Goblin King': {
    name: 'Goblin King',
    mana_cost: '{1}{R}{R}',
    type_line: 'Creature — Goblin',
    power: '2',
    toughness: '2',
    colors: ['R'],
    oracle_text: 'Other Goblins you control get +1/+1 and have mountainwalk.'
  },
  Levitation: {
    name: 'Levitation',
    mana_cost: '{2}{U}',
    type_line: 'Enchantment',
    colors: ['U'],
    oracle_text: 'Creatures you control have flying.'
  },
  'Giant Growth': {
    name: 'Giant Growth',
    mana_cost: '{G}',
    type_line: 'Instant',
    colors: ['G'],
    oracle_text: 'Target creature gets +3/+3 until end of turn.'
  },
  // Activated-ability creatures.
  'Prodigal Sorcerer': {
    name: 'Prodigal Sorcerer',
    mana_cost: '{2}{U}',
    type_line: 'Creature — Human Wizard',
    power: '1',
    toughness: '1',
    colors: ['U'],
    oracle_text: '{T}: Prodigal Sorcerer deals 1 damage to any target.'
  },
  'Shivan Dragon': {
    name: 'Shivan Dragon',
    mana_cost: '{4}{R}{R}',
    type_line: 'Creature — Dragon',
    power: '5',
    toughness: '5',
    colors: ['R'],
    keywords: ['Flying'],
    oracle_text: '{R}: Shivan Dragon gets +1/+0 until end of turn.'
  },
  'Mogg Fanatic': {
    name: 'Mogg Fanatic',
    mana_cost: '{R}',
    type_line: 'Creature — Goblin',
    power: '1',
    toughness: '1',
    colors: ['R'],
    oracle_text: 'Sacrifice Mogg Fanatic: It deals 1 damage to any target.'
  },
  'Flametongue Kavu': {
    name: 'Flametongue Kavu',
    mana_cost: '{2}{R}{R}',
    type_line: 'Creature — Kavu',
    power: '4',
    toughness: '2',
    colors: ['R'],
    oracle_text:
      'When Flametongue Kavu enters the battlefield, it deals 4 damage to target creature.'
  }
}
