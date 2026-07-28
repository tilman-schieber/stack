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
    else if (s.includes('/')) {
      // Hybrid mana {B/R}: payable with either color. (Phyrexian / 2-hybrid not
      // yet modelled — those symbols are ignored.)
      const parts = s.split('/')
      if (parts.every((p) => cost[p] != null)) (cost.hybrid ||= []).push(parts)
    } else if (cost[s] != null) cost[s] += 1
  }
  return cost
}

export function manaValue(cost) {
  return (cost.generic || 0) + cost.W + cost.U + cost.B + cost.R + cost.G + cost.C + (cost.hybrid?.length || 0)
}

const COLOR_WORD = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }

// Parse "protection from <color>" out of oracle text → ['B', …].
export function parseProtections(text) {
  const out = []
  const re = /protection from (white|blue|black|red|green)/gi
  let m
  while ((m = re.exec(text || ''))) out.push(COLOR_WORD[m[1].toLowerCase()])
  return out
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

// Build the immutable base characteristics used by the engine. For adventure /
// double-faced cards the "printed" permanent is the front face, so behaviors key
// off the front-face name (e.g. "Sagu Wildling", not "Sagu Wildling // Roost Seek").
export function printedFromScryfall(sf) {
  const f = sf.card_faces?.[0] || sf
  const cost = parseManaCost(f.mana_cost || '')
  const t = parseTypeLine(f.type_line || '')
  // A "*" (or other non-numeric) power/toughness is characteristic-defining (rule
  // 613 layer 7a): the printed value is null and a CDA sets the base P/T later.
  const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  const power = num(f.power)
  const toughness = num(f.toughness)
  return {
    name: f.name || sf.name,
    manaCost: cost,
    manaValue: manaValue(cost),
    supertypes: t.supertypes,
    types: t.types,
    subtypes: t.subtypes,
    colors: sf.colors || f.colors || [],
    keywords: sf.keywords || [],
    power,
    toughness,
    loyalty: f.loyalty != null ? Number(f.loyalty) : null,
    protections: parseProtections(f.oracle_text || sf.oracle_text),
    oracleText: f.oracle_text || sf.oracle_text || ''
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
    keywords: ['First strike'],
    oracle_text: 'First strike, protection from black'
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
  Snap: {
    name: 'Snap',
    mana_cost: '{1}{U}',
    type_line: 'Instant',
    colors: ['U'],
    oracle_text: 'Return target creature to its owner’s hand. Untap up to two lands.'
  },
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
  // Control-changing cards (rule 613 layer 2).
  'Act of Treason': {
    name: 'Act of Treason',
    mana_cost: '{2}{R}',
    type_line: 'Sorcery',
    colors: ['R'],
    oracle_text: 'Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn.'
  },
  'Ray of Command': {
    name: 'Ray of Command',
    mana_cost: '{3}{U}',
    type_line: 'Instant',
    colors: ['U'],
    oracle_text:
      'Untap target creature an opponent controls and gain control of it until end of turn. That creature gains haste until end of turn. When you lose control of the creature, tap it.'
  },
  // Characteristic-defining P/T (rule 613 layer 7a).
  Nightmare: {
    name: 'Nightmare',
    mana_cost: '{5}{B}',
    type_line: 'Creature — Nightmare Horse',
    power: '*',
    toughness: '*',
    colors: ['B'],
    keywords: ['Flying'],
    oracle_text: "Flying\nNightmare's power and toughness are each equal to the number of Swamps you control."
  },
  // Modal spells (rule 700.2).
  Abrade: {
    name: 'Abrade',
    mana_cost: '{1}{R}',
    type_line: 'Instant',
    colors: ['R'],
    oracle_text: 'Choose one —\n• Abrade deals 3 damage to target creature.\n• Destroy target artifact.'
  },
  'Cryptic Command': {
    name: 'Cryptic Command',
    mana_cost: '{1}{U}{U}{U}',
    type_line: 'Instant',
    colors: ['U'],
    oracle_text:
      "Choose two —\n• Counter target spell.\n• Return target permanent to its owner's hand.\n• Tap all creatures your opponents control.\n• Draw a card."
  },
  // Copy-effect cards (rule 706 / 613 layer 1).
  Clone: {
    name: 'Clone',
    mana_cost: '{3}{U}',
    type_line: 'Creature — Shapeshifter',
    power: '0',
    toughness: '0',
    colors: ['U'],
    oracle_text: 'You may have this creature enter as a copy of any creature on the battlefield.'
  },
  // Delayed / phase-boundary trigger cards (rule 503/513/603.7).
  'Ball Lightning': {
    name: 'Ball Lightning',
    mana_cost: '{R}{R}{R}',
    type_line: 'Creature — Elemental',
    power: '6',
    toughness: '1',
    colors: ['R'],
    keywords: ['Haste', 'Trample'],
    oracle_text: 'Trample\nHaste\nAt the beginning of the end step, sacrifice this creature.'
  },
  Flickerwisp: {
    name: 'Flickerwisp',
    mana_cost: '{1}{W}{W}',
    type_line: 'Creature — Elemental',
    power: '3',
    toughness: '1',
    colors: ['W'],
    keywords: ['Flying'],
    oracle_text:
      'Flying\nWhen this creature enters, exile another target permanent. Return that card to the battlefield under its owner’s control at the beginning of the next end step.'
  },
  'Phyrexian Arena': {
    name: 'Phyrexian Arena',
    mana_cost: '{1}{B}{B}',
    type_line: 'Enchantment',
    colors: ['B'],
    oracle_text: 'At the beginning of your upkeep, you draw a card and you lose 1 life.'
  },
  // Replacement-effect cards (rule 614), showcased in the sample decks.
  'Furnace of Rath': {
    name: 'Furnace of Rath',
    mana_cost: '{1}{R}{R}{R}',
    type_line: 'Enchantment',
    colors: ['R'],
    oracle_text:
      'If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.'
  },
  'Rhox Faithmender': {
    name: 'Rhox Faithmender',
    mana_cost: '{3}{W}',
    type_line: 'Creature — Rhino Monk',
    power: '1',
    toughness: '5',
    colors: ['W'],
    keywords: ['Lifelink'],
    oracle_text: 'Lifelink\nIf you would gain life, you gain twice that much life instead.'
  },
  'Samite Healer': {
    name: 'Samite Healer',
    mana_cost: '{1}{W}',
    type_line: 'Creature — Human Cleric',
    power: '1',
    toughness: '1',
    colors: ['W'],
    oracle_text: '{T}: Prevent the next 1 damage that would be dealt to any target this turn.'
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
  },
  // Replacement / prevention cards.
  'Servant of the Scale': {
    name: 'Servant of the Scale',
    mana_cost: '{1}{G}',
    type_line: 'Creature — Elemental',
    power: '0',
    toughness: '0',
    colors: ['G'],
    oracle_text: 'Servant of the Scale enters the battlefield with two +1/+1 counters on it.'
  },
  Fog: {
    name: 'Fog',
    mana_cost: '{G}',
    type_line: 'Instant',
    colors: ['G'],
    oracle_text: 'Prevent all combat damage that would be dealt this turn.'
  },
  // Attachments: an Aura and an Equipment.
  Rancor: {
    name: 'Rancor',
    mana_cost: '{G}',
    type_line: 'Enchantment — Aura',
    colors: ['G'],
    oracle_text: 'Enchant creature. Enchanted creature gets +2/+0 and has trample.'
  },
  Bonesplitter: {
    name: 'Bonesplitter',
    mana_cost: '{1}',
    type_line: 'Artifact — Equipment',
    colors: [],
    oracle_text: 'Equipped creature gets +2/+0. Equip {1}.'
  },
  'Isamaru, Hound of Konda': {
    name: 'Isamaru, Hound of Konda',
    mana_cost: '{W}',
    type_line: 'Legendary Creature — Hound Dog',
    power: '2',
    toughness: '2',
    colors: ['W']
  },
  // Token makers.
  'Dragon Fodder': {
    name: 'Dragon Fodder',
    mana_cost: '{1}{R}',
    type_line: 'Sorcery',
    colors: ['R'],
    oracle_text: 'Create two 1/1 red Goblin creature tokens.'
  },
  'Raise the Alarm': {
    name: 'Raise the Alarm',
    mana_cost: '{1}{W}',
    type_line: 'Instant',
    colors: ['W'],
    oracle_text: 'Create two 1/1 white Soldier creature tokens.'
  },
  'Chandra Nalaar': {
    name: 'Chandra Nalaar',
    mana_cost: '{3}{R}{R}',
    type_line: 'Legendary Planeswalker — Chandra',
    loyalty: '6',
    colors: ['R'],
    oracle_text:
      '+1: Chandra Nalaar deals 1 damage to any target. −3: Chandra Nalaar deals 4 damage to target creature.'
  },
  'Darksteel Myr': {
    name: 'Darksteel Myr',
    mana_cost: '{2}',
    type_line: 'Artifact Creature — Myr',
    power: '0',
    toughness: '1',
    colors: [],
    keywords: ['Indestructible']
  },
  'Ambush Viper': {
    name: 'Ambush Viper',
    mana_cost: '{1}{G}',
    type_line: 'Creature — Snake',
    power: '2',
    toughness: '1',
    colors: ['G'],
    keywords: ['Flash', 'Deathtouch']
  },
  Preordain: {
    name: 'Preordain',
    mana_cost: '{U}',
    type_line: 'Sorcery',
    colors: ['U'],
    oracle_text: 'Scry 2, then draw a card.'
  },
  'Serum Visions': {
    name: 'Serum Visions',
    mana_cost: '{U}',
    type_line: 'Sorcery',
    colors: ['U'],
    oracle_text: 'Draw a card, then scry 2.'
  },
  'Monastery Swiftspear': {
    name: 'Monastery Swiftspear',
    mana_cost: '{R}',
    type_line: 'Creature — Human Monk',
    power: '1',
    toughness: '2',
    colors: ['R'],
    keywords: ['Haste', 'Prowess']
  },
  Frogmite: {
    name: 'Frogmite',
    mana_cost: '{4}',
    type_line: 'Artifact Creature — Frog',
    power: '2',
    toughness: '2',
    colors: [],
    oracle_text: 'Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)'
  },
  Firebolt: {
    name: 'Firebolt',
    mana_cost: '{R}',
    type_line: 'Sorcery',
    colors: ['R'],
    oracle_text: 'Firebolt deals 2 damage to any target. Flashback {4}{R}'
  },
  'Faithless Looting': {
    name: 'Faithless Looting',
    mana_cost: '{R}',
    type_line: 'Sorcery',
    colors: ['R'],
    oracle_text: 'Draw two cards, then discard two cards. Flashback {2}{R}'
  },
  'Fiery Temper': {
    name: 'Fiery Temper',
    mana_cost: '{1}{R}{R}',
    type_line: 'Instant',
    colors: ['R'],
    oracle_text: 'Fiery Temper deals 3 damage to any target. Madness {R}'
  },
  'Basking Rootwalla': {
    name: 'Basking Rootwalla',
    mana_cost: '{G}',
    type_line: 'Creature — Lizard',
    power: '1',
    toughness: '1',
    colors: ['G'],
    oracle_text: '{1}{G}: Basking Rootwalla gets +2/+2 until end of turn. Activate only once each turn. Madness {0}'
  },
  'Faerie Seer': {
    name: 'Faerie Seer',
    mana_cost: '{U}',
    type_line: 'Creature — Faerie',
    power: '1',
    toughness: '1',
    colors: ['U'],
    keywords: ['Flying'],
    oracle_text: 'When Faerie Seer enters the battlefield, scry 2.'
  },
  'Ichor Wellspring': {
    name: 'Ichor Wellspring',
    mana_cost: '{2}',
    type_line: 'Artifact',
    colors: [],
    oracle_text: 'When Ichor Wellspring enters the battlefield or is put into a graveyard, draw a card.'
  },
  'Writhing Chrysalis': {
    name: 'Writhing Chrysalis',
    mana_cost: '{2}{R}{G}',
    type_line: 'Creature — Eldrazi Drone',
    power: '2',
    toughness: '3',
    colors: [], // Devoid
    keywords: ['Reach'],
    oracle_text:
      'Devoid. When you cast this spell, create two 0/1 colorless Eldrazi Spawn creature tokens. Reach. Whenever you sacrifice another Eldrazi, put a +1/+1 counter on this creature.'
  },
  'Sagu Wildling': {
    name: 'Sagu Wildling',
    mana_cost: '{4}{G}',
    type_line: 'Creature — Dragon',
    power: '3',
    toughness: '3',
    colors: ['G'],
    keywords: ['Flying'],
    oracle_text:
      'Flying. When this creature enters, you gain 3 life. // Roost Seek {G} Sorcery — Omen: Search your library for a basic land card, put it into your hand, then shuffle.'
  },
  'Nyxborn Hydra': {
    name: 'Nyxborn Hydra',
    mana_cost: '{X}{G}',
    type_line: 'Enchantment Creature — Hydra',
    power: '0',
    toughness: '1',
    colors: ['G'],
    keywords: ['Reach', 'Trample'],
    oracle_text:
      'Bestow {X}{G}{G}. Reach, trample. This permanent enters with X +1/+1 counters on it.'
  },
  'Nihil Spellbomb': {
    name: 'Nihil Spellbomb',
    mana_cost: '{1}',
    type_line: 'Artifact',
    colors: [],
    oracle_text:
      "{T}, Sacrifice this artifact: Exile target player's graveyard. When this artifact is put into a graveyard from the battlefield, you may pay {B}. If you do, draw a card."
  },
  Lembas: {
    name: 'Lembas',
    mana_cost: '{2}',
    type_line: 'Artifact — Food',
    colors: [],
    oracle_text:
      'When this artifact enters, scry 1, then draw a card. {2}, {T}, Sacrifice this artifact: You gain 3 life. When this artifact is put into a graveyard from the battlefield, its owner shuffles it into their library.'
  },
  'Krark-Clan Shaman': {
    name: 'Krark-Clan Shaman',
    mana_cost: '{R}',
    type_line: 'Creature — Goblin Shaman',
    power: '1',
    toughness: '1',
    colors: ['R'],
    oracle_text: 'Sacrifice an artifact: This creature deals 1 damage to each creature without flying.'
  },
  'Makeshift Munitions': {
    name: 'Makeshift Munitions',
    mana_cost: '{1}{R}',
    type_line: 'Enchantment',
    colors: ['R'],
    oracle_text: '{1}, Sacrifice an artifact or creature: This enchantment deals 1 damage to any target.'
  },
  'Fanatical Offering': {
    name: 'Fanatical Offering',
    mana_cost: '{1}{B}',
    type_line: 'Instant',
    colors: ['B'],
    oracle_text:
      'As an additional cost to cast this spell, sacrifice an artifact or creature. Draw two cards and create a Map token.'
  },
  'Refurbished Familiar': {
    name: 'Refurbished Familiar',
    mana_cost: '{3}{B}',
    type_line: 'Artifact Creature — Zombie Rat',
    power: '2',
    toughness: '1',
    colors: ['B'],
    keywords: ['Flying', 'Affinity'],
    oracle_text:
      "Affinity for artifacts. Flying. When this creature enters, each opponent discards a card. For each opponent who can't, you draw a card."
  },
  'Cleansing Wildfire': {
    name: 'Cleansing Wildfire',
    mana_cost: '{1}{R}',
    type_line: 'Sorcery',
    colors: ['R'],
    oracle_text:
      'Destroy target land. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle. Draw a card.'
  },
  'Go for the Throat': {
    name: 'Go for the Throat',
    mana_cost: '{1}{B}',
    type_line: 'Instant',
    colors: ['B'],
    oracle_text: 'Destroy target nonartifact creature.'
  },
  'Cast Down': {
    name: 'Cast Down',
    mana_cost: '{1}{B}',
    type_line: 'Instant',
    colors: ['B'],
    oracle_text: 'Destroy target nonlegendary creature.'
  },
  'Toxin Analysis': {
    name: 'Toxin Analysis',
    mana_cost: '{B}',
    type_line: 'Instant',
    colors: ['B'],
    oracle_text: 'Target creature gains deathtouch and lifelink until end of turn. Investigate.'
  },
  "Eviscerator's Insight": {
    name: "Eviscerator's Insight",
    mana_cost: '{1}{B}',
    type_line: 'Instant',
    colors: ['B'],
    oracle_text:
      'As an additional cost to cast this spell, sacrifice an artifact or creature. Draw two cards. Flashback {4}{B}'
  },
  'Pulse of Murasa': {
    name: 'Pulse of Murasa',
    mana_cost: '{2}{G}',
    type_line: 'Instant',
    colors: ['G'],
    oracle_text: "Return target creature or land card from a graveyard to its owner's hand. You gain 6 life."
  },
  // ---- Mono-Red Madness (Pauper) ----
  Guttersnipe: {
    name: 'Guttersnipe',
    mana_cost: '{2}{R}',
    type_line: 'Creature — Goblin Shaman',
    power: '2',
    toughness: '2',
    colors: ['R'],
    oracle_text: 'Whenever you cast an instant or sorcery spell, this creature deals 2 damage to each opponent.'
  },
  'Sneaky Snacker': {
    name: 'Sneaky Snacker',
    mana_cost: '{U}{B}',
    type_line: 'Creature — Faerie Rogue',
    power: '2',
    toughness: '1',
    colors: ['U', 'B'],
    keywords: ['Flying'],
    oracle_text:
      'Flying\nWhen you draw your third card in a turn, return this card from your graveyard to the battlefield tapped.'
  },
  'Voldaren Epicure': {
    name: 'Voldaren Epicure',
    mana_cost: '{R}',
    type_line: 'Creature — Vampire',
    power: '1',
    toughness: '1',
    colors: ['R'],
    oracle_text: 'When this creature enters, it deals 1 damage to each opponent. Create a Blood token.'
  },
  'Melded Moxite': {
    name: 'Melded Moxite',
    mana_cost: '{1}{R}',
    type_line: 'Artifact',
    colors: ['R'],
    oracle_text:
      'When this artifact enters, you may discard a card. If you do, draw two cards.\n{3}, Sacrifice this artifact: Create a tapped 2/2 colorless Robot artifact creature token.'
  },
  Fireblast: {
    name: 'Fireblast',
    mana_cost: '{4}{R}{R}',
    type_line: 'Instant',
    colors: ['R'],
    oracle_text: "You may sacrifice two Mountains rather than pay this spell's mana cost.\nFireblast deals 4 damage to any target."
  },
  'Lava Dart': {
    name: 'Lava Dart',
    mana_cost: '{R}',
    type_line: 'Instant',
    colors: ['R'],
    keywords: ['Flashback'],
    oracle_text: 'Lava Dart deals 1 damage to any target.\nFlashback—Sacrifice a Mountain.'
  },
  'Grab the Prize': {
    name: 'Grab the Prize',
    mana_cost: '{1}{R}',
    type_line: 'Sorcery',
    colors: ['R'],
    oracle_text:
      "As an additional cost to cast this spell, discard a card.\nDraw two cards. If the discarded card wasn't a land card, Grab the Prize deals 2 damage to each opponent."
  },
  'Highway Robbery': {
    name: 'Highway Robbery',
    mana_cost: '{1}{R}',
    type_line: 'Sorcery',
    colors: ['R'],
    keywords: ['Plot'],
    oracle_text: 'You may discard a card or sacrifice a land. If you do, draw two cards.\nPlot {1}{R}'
  },

  // Storm / Ninjutsu / Plot demos.
  Grapeshot: {
    name: 'Grapeshot',
    mana_cost: '{1}{R}',
    type_line: 'Sorcery',
    colors: ['R'],
    keywords: ['Storm'],
    oracle_text: 'Grapeshot deals 1 damage to any target.\nStorm'
  },
  'Empty the Warrens': {
    name: 'Empty the Warrens',
    mana_cost: '{3}{R}',
    type_line: 'Sorcery',
    colors: ['R'],
    keywords: ['Storm'],
    oracle_text: 'Create two 1/1 red Goblin creature tokens.\nStorm'
  },
  'Weather the Storm': {
    name: 'Weather the Storm',
    mana_cost: '{1}{G}',
    type_line: 'Instant',
    colors: ['G'],
    keywords: ['Storm'],
    oracle_text: 'You gain 3 life.\nStorm'
  },
  'Spellstutter Sprite': {
    name: 'Spellstutter Sprite',
    mana_cost: '{1}{U}',
    type_line: 'Creature — Faerie Wizard',
    power: '1',
    toughness: '1',
    colors: ['U'],
    keywords: ['Flying', 'Flash'],
    oracle_text:
      'Flash\nFlying\nWhen this creature enters, counter target spell with mana value X or less, where X is the number of Faeries you control.'
  },
  'Ninja of the Deep Hours': {
    name: 'Ninja of the Deep Hours',
    mana_cost: '{3}{U}',
    type_line: 'Creature — Human Ninja',
    power: '2',
    toughness: '2',
    colors: ['U'],
    keywords: ['Ninjutsu'],
    oracle_text:
      'Ninjutsu {1}{U}\nWhenever this creature deals combat damage to a player, you may draw a card.'
  },

  // ---- Grixis Affinity ----
  'Blood Fountain': {
    name: 'Blood Fountain',
    mana_cost: '{B}',
    type_line: 'Artifact',
    colors: ['B'],
    oracle_text:
      'When this artifact enters, create a Blood token.\n{3}{B}, {T}, Sacrifice this artifact: Return up to two target creature cards from your graveyard to your hand.'
  },
  'Myr Enforcer': {
    name: 'Myr Enforcer',
    mana_cost: '{7}',
    type_line: 'Artifact Creature — Myr',
    power: '4',
    toughness: '4',
    colors: [],
    keywords: ['Affinity'],
    oracle_text: 'Affinity for artifacts'
  },
  'Utrom Monitor': {
    name: 'Utrom Monitor',
    mana_cost: '{4}{U}',
    type_line: 'Artifact Creature — Utrom Scientist',
    power: '3',
    toughness: '3',
    colors: ['U'],
    keywords: ['Flying', 'Affinity'],
    oracle_text: 'Affinity for artifacts\nFlying'
  },
  'Kenku Artificer': {
    name: 'Kenku Artificer',
    mana_cost: '{2}{U}',
    type_line: 'Creature — Bird Artificer',
    power: '1',
    toughness: '1',
    colors: ['U'],
    oracle_text:
      'When this creature enters, put three +1/+1 counters on up to one target noncreature artifact. That artifact becomes a 0/0 Homunculus artifact creature with flying.'
  },
  Thoughtcast: {
    name: 'Thoughtcast',
    mana_cost: '{4}{U}',
    type_line: 'Sorcery',
    colors: ['U'],
    keywords: ['Affinity'],
    oracle_text: 'Affinity for artifacts\nDraw two cards.'
  },
  'Galvanic Blast': {
    name: 'Galvanic Blast',
    mana_cost: '{R}',
    type_line: 'Instant',
    colors: ['R'],
    keywords: ['Metalcraft'],
    oracle_text:
      'Galvanic Blast deals 2 damage to any target.\nMetalcraft — Galvanic Blast deals 4 damage instead if you control three or more artifacts.'
  },
  "Reckoner's Bargain": {
    name: "Reckoner's Bargain",
    mana_cost: '{1}{B}',
    type_line: 'Instant',
    colors: ['B'],
    oracle_text:
      "As an additional cost to cast this spell, sacrifice an artifact or creature.\nYou gain life equal to the sacrificed permanent's mana value. Draw two cards."
  },

  // Nonbasic / artifact lands.
  'Vault of Whispers': { name: 'Vault of Whispers', mana_cost: '', type_line: 'Artifact Land', colors: [] },
  'Seat of the Synod': { name: 'Seat of the Synod', mana_cost: '', type_line: 'Artifact Land', colors: [] },
  'Great Furnace': { name: 'Great Furnace', mana_cost: '', type_line: 'Artifact Land', colors: [] },
  'Drossforge Bridge': { name: 'Drossforge Bridge', mana_cost: '', type_line: 'Artifact Land', colors: [] },
  'Slagwoods Bridge': { name: 'Slagwoods Bridge', mana_cost: '', type_line: 'Artifact Land', colors: [] },
  'Silverbluff Bridge': { name: 'Silverbluff Bridge', mana_cost: '', type_line: 'Artifact Land', colors: [] },
  'Mistvault Bridge': { name: 'Mistvault Bridge', mana_cost: '', type_line: 'Artifact Land', colors: [] },
  'Twisted Landscape': { name: 'Twisted Landscape', mana_cost: '', type_line: 'Land', colors: [] }
}
