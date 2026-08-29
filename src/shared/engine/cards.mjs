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
      const parts = s.split('/')
      // Phyrexian mana {U/P} (107.4f): the colour, or 2 life.
      if (parts.length === 2 && parts[1] === 'P' && cost[parts[0]] != null) (cost.phyrexian ||= []).push(parts[0])
      // Two-brid {2/W} (107.4e): the colour, or two generic.
      else if (parts.length === 2 && parts[0] === '2' && cost[parts[1]] != null) (cost.twobrid ||= []).push(parts[1])
      // Hybrid {B/R}: payable with either colour.
      else if (parts.every((p) => cost[p] != null)) (cost.hybrid ||= []).push(parts)
    } else if (cost[s] != null) cost[s] += 1
  }
  return cost
}

// Mana value (202.3): X counts as 0; a Phyrexian pip is 1, a two-brid pip is 2.
export function manaValue(cost) {
  return (
    (cost.generic || 0) +
    cost.W +
    cost.U +
    cost.B +
    cost.R +
    cost.G +
    cost.C +
    (cost.hybrid?.length || 0) +
    (cost.phyrexian?.length || 0) +
    2 * (cost.twobrid?.length || 0)
  )
}

const COLOR_WORD = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }

// Parse "protection from <quality>" out of oracle text → ['B', 'Creature',
// 'everything', …]. Colours become colour letters; card types their type word.
const PROT_TYPE = { creatures: 'Creature', artifacts: 'Artifact', enchantments: 'Enchantment', instants: 'Instant', sorceries: 'Sorcery', planeswalkers: 'Planeswalker', lands: 'Land' }
export function parseProtections(text) {
  const out = []
  const re = /protection from (white|blue|black|red|green|everything|creatures|artifacts|enchantments|instants|sorceries|planeswalkers|lands)/gi
  let m
  while ((m = re.exec(text || ''))) {
    const w = m[1].toLowerCase()
    out.push(COLOR_WORD[w] || PROT_TYPE[w] || w)
  }
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

// Colours implied by a mana cost (for card faces Scryfall gives no colours for).
function colorsFromCost(str) {
  const out = []
  for (const c of ['W', 'U', 'B', 'R', 'G']) if (new RegExp(`\\{[^}]*${c}[^}]*\\}`).test(str || '')) out.push(c)
  return out
}

// Layouts whose faces are separately meaningful to the engine (709 split, 712
// double-faced). Adventures/omens are handled through behaviors on the front face.
export const MULTI_FACE_LAYOUTS = new Set(['split', 'transform', 'modal_dfc'])

// Base characteristics of one face. `sf` is the whole card, `f` the face (or the
// card itself for single-faced cards). Face keywords are narrowed from the card's
// keyword list by which ones the face's own text mentions.
function printedFromFace(sf, f, multi) {
  const cost = parseManaCost(f.mana_cost || '')
  const t = parseTypeLine(f.type_line || '')
  // A "*" (or other non-numeric) power/toughness is characteristic-defining (rule
  // 613 layer 7a): the printed value is null and a CDA sets the base P/T later.
  const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  const oracle = f.oracle_text || (multi ? '' : sf.oracle_text) || ''
  const allKw = sf.keywords || []
  const keywords = multi
    ? allKw.filter((k) => k !== 'Transform' && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(oracle))
    : allKw
  return {
    name: f.name || sf.name,
    manaCost: cost,
    manaValue: manaValue(cost),
    supertypes: t.supertypes,
    types: t.types,
    subtypes: t.subtypes,
    colors: f.colors || (multi ? colorsFromCost(f.mana_cost) : sf.colors) || sf.colors || [],
    keywords,
    power: num(f.power),
    toughness: num(f.toughness),
    loyalty: f.loyalty != null ? Number(f.loyalty) : null,
    protections: parseProtections(oracle),
    oracleText: oracle
  }
}

// Build the immutable base characteristics used by the engine — the front face
// for multi-faced cards, so behaviors key off the front-face name (e.g. "Fire",
// "Delver of Secrets"). See facesFromScryfall for the other faces.
export function printedFromScryfall(sf) {
  const multi = MULTI_FACE_LAYOUTS.has(sf.layout) && Array.isArray(sf.card_faces) && sf.card_faces.length > 1
  return printedFromFace(sf, sf.card_faces?.[0] || sf, multi)
}

// Every face of a split / double-faced card as printed characteristics, or null
// for a single-faced card (including adventures, which the engine models as a
// behavior on the front face).
export function facesFromScryfall(sf) {
  if (!MULTI_FACE_LAYOUTS.has(sf.layout) || !Array.isArray(sf.card_faces) || sf.card_faces.length < 2) return null
  return sf.card_faces.map((f) => printedFromFace(sf, f, true))
}

// A split card's characteristics anywhere but the stack (709.3): the union of
// both halves — combined name, both costs (mana value is the sum), all types
// and colours.
export function combinedPrinted(faces) {
  const [a, b] = faces
  const cost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 }
  for (const f of faces) {
    for (const k of Object.keys(cost)) cost[k] += f.manaCost[k] || 0
    if (f.manaCost.X) cost.X = (cost.X || 0) + f.manaCost.X
    for (const k of ['hybrid', 'phyrexian', 'twobrid']) if (f.manaCost[k]) cost[k] = [...(cost[k] || []), ...f.manaCost[k]]
  }
  const union = (k) => [...new Set(faces.flatMap((f) => f[k]))]
  return {
    name: `${a.name} // ${b.name}`,
    manaCost: cost,
    manaValue: manaValue(cost),
    supertypes: union('supertypes'),
    types: union('types'),
    subtypes: union('subtypes'),
    colors: union('colors'),
    keywords: union('keywords'),
    power: null,
    toughness: null,
    loyalty: null,
    protections: union('protections'),
    oracleText: faces.map((f) => f.oracleText).join('\n//\n')
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
  // Color-changing effect (rule 613 layer 5).
  'Aphotic Wisps': {
    name: 'Aphotic Wisps',
    mana_cost: '{B}',
    type_line: 'Instant',
    colors: ['B'],
    oracle_text: 'Target creature becomes black and gains fear until end of turn.\nDraw a card.'
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
  // Rule-modifying static effects (rule 613.11): restrictions + cost changes.
  Pacifism: {
    name: 'Pacifism',
    mana_cost: '{1}{W}',
    type_line: 'Enchantment — Aura',
    colors: ['W'],
    oracle_text: "Enchant creature\nEnchanted creature can't attack or block."
  },
  'Goblin Warchief': {
    name: 'Goblin Warchief',
    mana_cost: '{1}{R}{R}',
    type_line: 'Creature — Goblin Warrior',
    power: '2',
    toughness: '2',
    colors: ['R'],
    oracle_text: 'Goblin spells you cast cost {1} less to cast.\nGoblins you control have haste.'
  },
  'Thalia, Guardian of Thraben': {
    name: 'Thalia, Guardian of Thraben',
    mana_cost: '{1}{W}',
    type_line: 'Legendary Creature — Human Soldier',
    power: '2',
    toughness: '1',
    colors: ['W'],
    keywords: ['First strike'],
    oracle_text: 'First strike\nNoncreature spells cost {1} more to cast.'
  },
  // Untargetability (rule 702.11 hexproof / 702.18 shroud).
  'Gladecover Scout': {
    name: 'Gladecover Scout',
    mana_cost: '{G}',
    type_line: 'Creature — Elf Scout',
    power: '1',
    toughness: '1',
    colors: ['G'],
    keywords: ['Hexproof'],
    oracle_text: 'Hexproof'
  },
  'Lightning Greaves': {
    name: 'Lightning Greaves',
    mana_cost: '{2}',
    type_line: 'Artifact — Equipment',
    colors: [],
    keywords: ['Equip'],
    oracle_text: 'Equipped creature has haste and shroud.\nEquip {0}'
  },
  // Layer 3 text-changing (rule 613): a land's basic type is replaced.
  'Spreading Seas': {
    name: 'Spreading Seas',
    mana_cost: '{1}{U}',
    type_line: 'Enchantment — Aura',
    colors: ['U'],
    oracle_text: 'Enchant land\nWhen this Aura enters, draw a card.\nEnchanted land is an Island.'
  },
  // Morph / face-down permanents (rule 702.37).
  'Patron of the Wild': {
    name: 'Patron of the Wild',
    mana_cost: '{G}',
    type_line: 'Creature — Elf',
    power: '1',
    toughness: '1',
    colors: ['G'],
    oracle_text: 'Morph {2}{G} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)'
  },
  // "As though" permission (rule 118): cast any spell at instant speed.
  'Vedalken Orrery': {
    name: 'Vedalken Orrery',
    mana_cost: '{4}',
    type_line: 'Artifact',
    colors: [],
    oracle_text: 'You may cast spells as though they had flash.'
  },
  // More rule modifiers: can't-be-countered, can't-untap, can't-lose.
  'Great Sable Stag': {
    name: 'Great Sable Stag',
    mana_cost: '{1}{G}{G}',
    type_line: 'Creature — Elk',
    power: '3',
    toughness: '3',
    colors: ['G'],
    oracle_text: "This spell can't be countered.\nProtection from blue and from black"
  },
  Claustrophobia: {
    name: 'Claustrophobia',
    mana_cost: '{1}{U}{U}',
    type_line: 'Enchantment — Aura',
    colors: ['U'],
    oracle_text:
      "Enchant creature\nWhen this Aura enters, tap enchanted creature.\nEnchanted creature doesn't untap during its controller's untap step."
  },
  'Platinum Angel': {
    name: 'Platinum Angel',
    mana_cost: '{7}',
    type_line: 'Artifact Creature — Angel',
    power: '4',
    toughness: '4',
    colors: [],
    keywords: ['Flying'],
    oracle_text: "Flying\nYou can't lose the game and your opponents can't win the game."
  },
  // Extra turns / additional combat (rule 720 / 500-506): extensible turn structure.
  'Time Walk': {
    name: 'Time Walk',
    mana_cost: '{1}{U}',
    type_line: 'Sorcery',
    colors: ['U'],
    oracle_text: 'Take an extra turn after this one.'
  },
  'Relentless Assault': {
    name: 'Relentless Assault',
    mana_cost: '{2}{R}{R}',
    type_line: 'Sorcery',
    colors: ['R'],
    oracle_text:
      'Untap all creatures that attacked this turn. After this main phase, there is an additional combat phase followed by an additional main phase.'
  },
  // Choose-and-remember on entry (rule 614.12b): a value chosen as it enters.
  'Adaptive Automaton': {
    name: 'Adaptive Automaton',
    mana_cost: '{3}',
    type_line: 'Artifact Creature — Construct',
    power: '2',
    toughness: '2',
    colors: [],
    oracle_text:
      'As this creature enters, choose a creature type.\nThis creature is the chosen type in addition to its other types.\nOther creatures you control of the chosen type get +1/+1.'
  },
  // Copy effects (rule 707): copy a spell on the stack; token that's a copy.
  Twincast: {
    name: 'Twincast',
    mana_cost: '{U}{U}',
    type_line: 'Instant',
    colors: ['U'],
    oracle_text: 'Copy target instant or sorcery spell. You may choose new targets for the copy.'
  },
  'Cackling Counterpart': {
    name: 'Cackling Counterpart',
    mana_cost: '{1}{U}{U}',
    type_line: 'Instant',
    colors: ['U'],
    oracle_text: "Create a token that's a copy of target creature you control.\nFlashback {5}{U}{U}"
  },
  // Divided damage / variable target count (rule 601.2c-d).
  'Forked Bolt': {
    name: 'Forked Bolt',
    mana_cost: '{R}',
    type_line: 'Sorcery',
    colors: ['R'],
    oracle_text: 'Forked Bolt deals 2 damage divided as you choose among one or two targets.'
  },
  // Regeneration (701.15): {cost}: set up a shield that replaces the next destroy.
  'Drudge Skeletons': {
    name: 'Drudge Skeletons',
    mana_cost: '{1}{B}',
    type_line: 'Creature — Skeleton',
    power: '1',
    toughness: '1',
    colors: ['B'],
    oracle_text: '{B}: Regenerate this creature.'
  },
  // Ward (702.21): counter an opponent's spell/ability targeting this unless paid.
  'Tomakul Honor Guard': {
    name: 'Tomakul Honor Guard',
    mana_cost: '{1}{G}',
    type_line: 'Creature — Human Soldier',
    power: '3',
    toughness: '1',
    colors: ['G'],
    keywords: ['Ward'],
    oracle_text: 'Ward {2} (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays {2}.)'
  },
  'Dwarven Forge-Chanter': {
    name: 'Dwarven Forge-Chanter',
    mana_cost: '{1}{R}',
    type_line: 'Creature — Dwarf Wizard',
    power: '1',
    toughness: '3',
    colors: ['R'],
    keywords: ['Ward', 'Prowess'],
    oracle_text: 'Ward—Pay 2 life. (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays 2 life.)\nProwess'
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
  'Twisted Landscape': { name: 'Twisted Landscape', mana_cost: '', type_line: 'Land', colors: [] },
  // ---- CR gap-analysis test pool (added 2026-08-29; exact Scryfall data) ----
  "Gitaxian Probe": {"name":"Gitaxian Probe","mana_cost":"{U/P}","type_line":"Sorcery","oracle_text":"({U/P} can be paid with either {U} or 2 life.)\nLook at target player's hand.\nDraw a card.","colors":["U"],"keywords":[],"layout":"normal"},
  "Spectral Procession": {"name":"Spectral Procession","mana_cost":"{2/W}{2/W}{2/W}","type_line":"Sorcery","oracle_text":"Create three 1/1 white Spirit creature tokens with flying.","colors":["W"],"keywords":[],"layout":"normal"},
  "Thraben Gargoyle // Stonewing Antagonizer": {"name":"Thraben Gargoyle // Stonewing Antagonizer","type_line":"Artifact Creature — Gargoyle // Artifact Creature — Gargoyle Horror","keywords":["Flying","Transform","Defender"],"layout":"transform","card_faces":[{"name":"Thraben Gargoyle","mana_cost":"{1}","type_line":"Artifact Creature — Gargoyle","oracle_text":"Defender\n{6}: Transform this creature.","power":"2","toughness":"2","colors":[]},{"name":"Stonewing Antagonizer","mana_cost":"","type_line":"Artifact Creature — Gargoyle Horror","oracle_text":"Flying","power":"4","toughness":"2","colors":[]}]},
  "Bala Ged Recovery // Bala Ged Sanctuary": {"name":"Bala Ged Recovery // Bala Ged Sanctuary","type_line":"Sorcery // Land","keywords":[],"layout":"modal_dfc","card_faces":[{"name":"Bala Ged Recovery","mana_cost":"{2}{G}","type_line":"Sorcery","oracle_text":"Return target card from your graveyard to your hand.","colors":["G"]},{"name":"Bala Ged Sanctuary","mana_cost":"","type_line":"Land","oracle_text":"This land enters tapped.\n{T}: Add {G}.","colors":[]}]},
  "Plague Stinger": {"name":"Plague Stinger","mana_cost":"{1}{B}","type_line":"Creature — Phyrexian Insect Horror","oracle_text":"Flying\nInfect (This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)","power":"1","toughness":"1","colors":["B"],"keywords":["Flying","Infect"],"layout":"normal"},
  "Boggart Ram-Gang": {"name":"Boggart Ram-Gang","mana_cost":"{R/G}{R/G}{R/G}","type_line":"Creature — Goblin Warrior","oracle_text":"Haste\nWither (This deals damage to creatures in the form of -1/-1 counters.)","power":"3","toughness":"3","colors":["G","R"],"keywords":["Haste","Wither"],"layout":"normal"},
  "Bloated Contaminator": {"name":"Bloated Contaminator","mana_cost":"{2}{G}","type_line":"Creature — Phyrexian Beast","oracle_text":"Trample\nToxic 1 (Players dealt combat damage by this creature also get a poison counter.)\nWhenever this creature deals combat damage to a player, proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)","power":"4","toughness":"4","colors":["G"],"keywords":["Toxic","Trample","Proliferate"],"layout":"normal"},
  "Bog Wraith": {"name":"Bog Wraith","mana_cost":"{3}{B}","type_line":"Creature — Wraith","oracle_text":"Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)","power":"3","toughness":"3","colors":["B"],"keywords":["Landwalk","Swampwalk"],"layout":"normal"},
  "Vampire Cutthroat": {"name":"Vampire Cutthroat","mana_cost":"{B}","type_line":"Creature — Vampire Rogue","oracle_text":"Skulk (This creature can't be blocked by creatures with greater power.)\nLifelink (Damage dealt by this creature also causes you to gain that much life.)","power":"1","toughness":"1","colors":["B"],"keywords":["Lifelink","Skulk"],"layout":"normal"},
  "Tormented Soul": {"name":"Tormented Soul","mana_cost":"{B}","type_line":"Creature — Spirit","oracle_text":"This creature can't block and can't be blocked.","power":"1","toughness":"1","colors":["B"],"keywords":[],"layout":"normal"},
  "Blind Zealot": {"name":"Blind Zealot","mana_cost":"{1}{B}{B}","type_line":"Creature — Phyrexian Human Cleric","oracle_text":"Intimidate (This creature can't be blocked except by artifact creatures and/or creatures that share a color with it.)\nWhenever this creature deals combat damage to a player, you may sacrifice it. If you do, destroy target creature that player controls.","power":"2","toughness":"2","colors":["B"],"keywords":["Intimidate"],"layout":"normal"},
  "Dauthi Slayer": {"name":"Dauthi Slayer","mana_cost":"{B}{B}","type_line":"Creature — Dauthi Soldier","oracle_text":"Shadow (This creature can block or be blocked by only creatures with shadow.)\nThis creature attacks each combat if able.","power":"2","toughness":"2","colors":["B"],"keywords":["Shadow"],"layout":"normal"},
  "Goblin Bushwhacker": {"name":"Goblin Bushwhacker","mana_cost":"{R}","type_line":"Creature — Goblin Warrior","oracle_text":"Kicker {R} (You may pay an additional {R} as you cast this spell.)\nWhen this creature enters, if it was kicked, creatures you control get +1/+0 and gain haste until end of turn.","power":"1","toughness":"1","colors":["R"],"keywords":["Kicker"],"layout":"normal"},
  "Gurmag Angler": {"name":"Gurmag Angler","mana_cost":"{6}{B}","type_line":"Creature — Zombie Fish","oracle_text":"Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)","power":"5","toughness":"5","colors":["B"],"keywords":["Delve"],"layout":"normal"},
  "Siege Wurm": {"name":"Siege Wurm","mana_cost":"{5}{G}{G}","type_line":"Creature — Wurm","oracle_text":"Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\nTrample","power":"5","toughness":"5","colors":["G"],"keywords":["Trample","Convoke"],"layout":"normal"},
  "Order of Whiteclay": {"name":"Order of Whiteclay","mana_cost":"{1}{W}{W}","type_line":"Creature — Kithkin Cleric","oracle_text":"{1}{W}{W}, {Q}: Return target creature card with mana value 3 or less from your graveyard to the battlefield. ({Q} is the untap symbol.)","power":"1","toughness":"4","colors":["W"],"keywords":[],"layout":"normal"},
  "Walking Ballista": {"name":"Walking Ballista","mana_cost":"{X}{X}","type_line":"Artifact Creature — Construct","oracle_text":"This creature enters with X +1/+1 counters on it.\n{4}: Put a +1/+1 counter on this creature.\nRemove a +1/+1 counter from this creature: It deals 1 damage to any target.","power":"0","toughness":"0","colors":[],"keywords":[],"layout":"normal"},
  "Longtusk Cub": {"name":"Longtusk Cub","mana_cost":"{1}{G}","type_line":"Creature — Cat","oracle_text":"Whenever this creature deals combat damage to a player, you get {E}{E} (two energy counters).\nPay {E}{E}: Put a +1/+1 counter on this creature.","power":"2","toughness":"2","colors":["G"],"keywords":[],"layout":"normal"},
  "Exploration": {"name":"Exploration","mana_cost":"{G}","type_line":"Enchantment","oracle_text":"You may play an additional land on each of your turns.","colors":["G"],"keywords":[],"layout":"normal"},
  "Reliquary Tower": {"name":"Reliquary Tower","mana_cost":"","type_line":"Land","oracle_text":"You have no maximum hand size.\n{T}: Add {C}.","colors":[],"keywords":[],"layout":"normal"},
  "Jace's Erasure": {"name":"Jace's Erasure","mana_cost":"{1}{U}","type_line":"Enchantment","oracle_text":"Whenever you draw a card, you may have target player mill a card.","colors":["U"],"keywords":["Mill"],"layout":"normal"},
  "Dress Down": {"name":"Dress Down","mana_cost":"{1}{U}","type_line":"Enchantment","oracle_text":"Flash\nWhen this enchantment enters, draw a card.\nCreatures lose all abilities.\nAt the beginning of the end step, sacrifice this enchantment.","colors":["U"],"keywords":["Flash"],"layout":"normal"},
  "Blood Moon": {"name":"Blood Moon","mana_cost":"{2}{R}","type_line":"Enchantment","oracle_text":"Nonbasic lands are Mountains.","colors":["R"],"keywords":[],"layout":"normal"},
  "Kessig Wolf Run": {"name":"Kessig Wolf Run","mana_cost":"","type_line":"Land","oracle_text":"{T}: Add {C}.\n{X}{R}{G}, {T}: Target creature gets +X/+0 and gains trample until end of turn.","colors":[],"keywords":[],"layout":"normal"},
  "Goblin Rabblemaster": {"name":"Goblin Rabblemaster","mana_cost":"{2}{R}","type_line":"Creature — Goblin Warrior","oracle_text":"Other Goblin creatures you control attack each combat if able.\nAt the beginning of combat on your turn, create a 1/1 red Goblin creature token with haste.\nWhenever this creature attacks, it gets +1/+0 until end of turn for each other attacking Goblin.","power":"2","toughness":"2","colors":["R"],"keywords":[],"layout":"normal"},
  "Delver of Secrets // Insectile Aberration": {"name":"Delver of Secrets // Insectile Aberration","type_line":"Creature — Human Wizard // Creature — Human Insect","keywords":["Flying","Transform"],"layout":"transform","card_faces":[{"name":"Delver of Secrets","mana_cost":"{U}","type_line":"Creature — Human Wizard","oracle_text":"At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform this creature.","power":"1","toughness":"1","colors":["U"]},{"name":"Insectile Aberration","mana_cost":"","type_line":"Creature — Human Insect","oracle_text":"Flying","power":"3","toughness":"2","colors":["U"]}]},
  "Dismember": {"name":"Dismember","mana_cost":"{1}{B/P}{B/P}","type_line":"Instant","oracle_text":"({B/P} can be paid with either {B} or 2 life.)\nTarget creature gets -5/-5 until end of turn.","colors":["B"],"keywords":[],"layout":"normal"},
  "Mulldrifter": {"name":"Mulldrifter","mana_cost":"{4}{U}","type_line":"Creature — Elemental","oracle_text":"Flying\nWhen this creature enters, draw two cards.\nEvoke {2}{U} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)","power":"2","toughness":"2","colors":["U"],"keywords":["Flying","Evoke"],"layout":"normal"},
  "Ghostly Flicker": {"name":"Ghostly Flicker","mana_cost":"{2}{U}","type_line":"Instant","oracle_text":"Exile two target artifacts, creatures, and/or lands you control, then return those cards to the battlefield under your control.","colors":["U"],"keywords":[],"layout":"normal"},
  "Vindictive Vampire": {"name":"Vindictive Vampire","mana_cost":"{3}{B}","type_line":"Creature — Vampire","oracle_text":"Whenever another creature you control dies, this creature deals 1 damage to each opponent and you gain 1 life.","power":"2","toughness":"3","colors":["B"],"keywords":[],"layout":"normal"},
  "Chainer's Edict": {"name":"Chainer's Edict","mana_cost":"{1}{B}","type_line":"Sorcery","oracle_text":"Target player sacrifices a creature of their choice.\nFlashback {5}{B}{B} (You may cast this card from your graveyard for its flashback cost. Then exile it.)","colors":["B"],"keywords":["Flashback"],"layout":"normal"},
  "Mesa Enchantress": {"name":"Mesa Enchantress","mana_cost":"{1}{W}{W}","type_line":"Creature — Human Druid","oracle_text":"Whenever you cast an enchantment spell, you may draw a card.","power":"0","toughness":"2","colors":["W"],"keywords":[],"layout":"normal"},
  "Fire // Ice": {"name":"Fire // Ice","mana_cost":"{1}{R} // {1}{U}","type_line":"Instant // Instant","colors":["R","U"],"keywords":[],"layout":"split","card_faces":[{"name":"Fire","mana_cost":"{1}{R}","type_line":"Instant","oracle_text":"Fire deals 2 damage divided as you choose among one or two targets."},{"name":"Ice","mana_cost":"{1}{U}","type_line":"Instant","oracle_text":"Tap target permanent.\nDraw a card."}]},
  "Deepwood Wolverine": {"name":"Deepwood Wolverine","mana_cost":"{G}","type_line":"Creature — Wolverine","oracle_text":"Whenever this creature becomes blocked, it gets +2/+0 until end of turn.","power":"1","toughness":"1","colors":["G"],"keywords":[],"layout":"normal"},
  "Ezuri's Archers": {"name":"Ezuri's Archers","mana_cost":"{G}","type_line":"Creature — Elf Archer","oracle_text":"Reach (This creature can block creatures with flying.)\nWhenever this creature blocks a creature with flying, this creature gets +3/+0 until end of turn.","power":"1","toughness":"2","colors":["G"],"keywords":["Reach"],"layout":"normal"},
  "Night Market Lookout": {"name":"Night Market Lookout","mana_cost":"{B}","type_line":"Creature — Human Rogue","oracle_text":"Whenever this creature becomes tapped, each opponent loses 1 life and you gain 1 life.","power":"1","toughness":"1","colors":["B"],"keywords":[],"layout":"normal"},
  "Celestial Unicorn": {"name":"Celestial Unicorn","mana_cost":"{2}{W}","type_line":"Creature — Unicorn","oracle_text":"Whenever you gain life, put a +1/+1 counter on this creature.","power":"3","toughness":"2","colors":["W"],"keywords":[],"layout":"normal"},
  // ---- CR gap-analysis test pool, batch 2 (2026-08-29) ----
  "Prey Upon": {"name":"Prey Upon","mana_cost":"{G}","type_line":"Sorcery","oracle_text":"Target creature you control fights target creature you don't control. (Each deals damage equal to its power to the other.)","colors":["G"],"keywords":["Fight"],"layout":"normal"},
  "Lonely Sandbar": {"name":"Lonely Sandbar","mana_cost":"","type_line":"Land","oracle_text":"This land enters tapped.\n{T}: Add {U}.\nCycling {U} ({U}, Discard this card: Draw a card.)","colors":[],"keywords":["Cycling"],"layout":"normal"},
  "Young Wolf": {"name":"Young Wolf","mana_cost":"{G}","type_line":"Creature — Wolf","oracle_text":"Undying (When this creature dies, if it had no +1/+1 counters on it, return it to the battlefield under its owner's control with a +1/+1 counter on it.)","power":"1","toughness":"1","colors":["G"],"keywords":["Undying"],"layout":"normal"},
  "Safehold Elite": {"name":"Safehold Elite","mana_cost":"{1}{G/W}","type_line":"Creature — Elf Scout","oracle_text":"Persist (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner's control with a -1/-1 counter on it.)","power":"2","toughness":"2","colors":["G","W"],"keywords":["Persist"],"layout":"normal"},
  "Akrasan Squire": {"name":"Akrasan Squire","mana_cost":"{W}","type_line":"Creature — Human Soldier","oracle_text":"Exalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)","power":"1","toughness":"1","colors":["W"],"keywords":["Exalted"],"layout":"normal"},
  "Bloodbraid Elf": {"name":"Bloodbraid Elf","mana_cost":"{2}{R}{G}","type_line":"Creature — Elf Berserker","oracle_text":"Haste (This creature can attack and {T} as soon as it comes under your control.)\nCascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)","power":"3","toughness":"2","colors":["G","R"],"keywords":["Haste","Cascade"],"layout":"normal"},
  "Progenitus": {"name":"Progenitus","mana_cost":"{W}{W}{U}{U}{B}{B}{R}{R}{G}{G}","type_line":"Legendary Creature — Hydra Avatar","oracle_text":"Protection from everything\nIf Progenitus would be put into a graveyard from anywhere, reveal Progenitus and shuffle it into its owner's library instead.","power":"10","toughness":"10","colors":["B","G","R","U","W"],"keywords":["Protection"],"layout":"normal"},
  "Street Wraith": {"name":"Street Wraith","mana_cost":"{3}{B}{B}","type_line":"Creature — Wraith","oracle_text":"Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)\nCycling—Pay 2 life. (Pay 2 life, Discard this card: Draw a card.)","power":"3","toughness":"4","colors":["B"],"keywords":["Landwalk","Swampwalk","Cycling"],"layout":"normal"},
  "Seachrome Coast": {"name":"Seachrome Coast","mana_cost":"","type_line":"Land","oracle_text":"This land enters tapped unless you control two or fewer other lands.\n{T}: Add {W} or {U}.","colors":[],"keywords":[],"layout":"normal"},
  "Jace, Vryn's Prodigy // Jace, Telepath Unbound": {"name":"Jace, Vryn's Prodigy // Jace, Telepath Unbound","type_line":"Legendary Creature — Human Wizard // Legendary Planeswalker — Jace","keywords":["Transform","Mill"],"layout":"transform","card_faces":[{"name":"Jace, Vryn's Prodigy","mana_cost":"{1}{U}","type_line":"Legendary Creature — Human Wizard","oracle_text":"{T}: Draw a card, then discard a card. If there are five or more cards in your graveyard, exile Jace, then return him to the battlefield transformed under his owner's control.","power":"0","toughness":"2","colors":["U"]},{"name":"Jace, Telepath Unbound","mana_cost":"","type_line":"Legendary Planeswalker — Jace","oracle_text":"+1: Up to one target creature gets -2/-0 until your next turn.\n−3: You may cast target instant or sorcery card from your graveyard this turn. If that spell would be put into your graveyard, exile it instead.\n−9: You get an emblem with \"Whenever you cast a spell, target opponent mills five cards.\"","colors":["U"],"loyalty":"5"}]},
  "Elspeth, Knight-Errant": {"name":"Elspeth, Knight-Errant","mana_cost":"{2}{W}{W}","type_line":"Legendary Planeswalker — Elspeth","oracle_text":"+1: Create a 1/1 white Soldier creature token.\n+1: Target creature gets +3/+3 and gains flying until end of turn.\n−8: You get an emblem with \"Artifacts, creatures, enchantments, and lands you control have indestructible.\"","colors":["W"],"keywords":[],"layout":"normal","loyalty":"4"},
  "Beloved Chaplain": {"name":"Beloved Chaplain","mana_cost":"{1}{W}","type_line":"Creature — Human Cleric","oracle_text":"Protection from creatures","power":"1","toughness":"1","colors":["W"],"keywords":["Protection"],"layout":"normal"},
  // ---- CR gap-analysis test pool, batch 3 (2026-08-29) ----
  "Renegade Freighter": {"name":"Renegade Freighter","mana_cost":"{3}","type_line":"Artifact — Vehicle","oracle_text":"Whenever this Vehicle attacks, it gets +1/+1 and gains trample until end of turn.\nCrew 2 (Tap any number of creatures you control with total power 2 or more: This Vehicle becomes an artifact creature until end of turn.)","power":"4","toughness":"3","colors":[],"keywords":["Crew"],"layout":"normal"},
  "The Eldest Reborn": {"name":"The Eldest Reborn","mana_cost":"{4}{B}","type_line":"Enchantment — Saga","oracle_text":"(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Each opponent sacrifices a creature or planeswalker of their choice.\nII — Each opponent discards a card.\nIII — Put target creature or planeswalker card from a graveyard onto the battlefield under your control.","colors":["B"],"keywords":[],"layout":"saga"},
  "Capsize": {"name":"Capsize","mana_cost":"{1}{U}{U}","type_line":"Instant","oracle_text":"Buyback {3} (You may pay an additional {3} as you cast this spell. If you do, put this card into your hand as it resolves.)\nReturn target permanent to its owner's hand.","colors":["U"],"keywords":["Buyback"],"layout":"normal"},
  "Dregscape Zombie": {"name":"Dregscape Zombie","mana_cost":"{1}{B}","type_line":"Creature — Zombie","oracle_text":"Unearth {B} ({B}: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)","power":"2","toughness":"1","colors":["B"],"keywords":["Unearth"],"layout":"normal"},
  "Mogg War Marshal": {"name":"Mogg War Marshal","mana_cost":"{1}{R}","type_line":"Creature — Goblin Warrior","oracle_text":"Echo {1}{R} (At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)\nWhen this creature enters or dies, create a 1/1 red Goblin creature token.","power":"1","toughness":"1","colors":["R"],"keywords":["Echo"],"layout":"normal"},
  "Sudden Shock": {"name":"Sudden Shock","mana_cost":"{1}{R}","type_line":"Instant","oracle_text":"Split second (As long as this spell is on the stack, players can't cast spells or activate abilities that aren't mana abilities.)\nSudden Shock deals 2 damage to any target.","colors":["R"],"keywords":["Split second"],"layout":"normal"},
  "Avian Changeling": {"name":"Avian Changeling","mana_cost":"{2}{W}","type_line":"Creature — Shapeshifter","oracle_text":"Changeling (This card is every creature type.)\nFlying","power":"2","toughness":"2","colors":["W"],"keywords":["Changeling","Flying"],"layout":"normal"},
  "Distortion Strike": {"name":"Distortion Strike","mana_cost":"{U}","type_line":"Sorcery","oracle_text":"Target creature gets +1/+0 until end of turn and can't be blocked this turn.\nRebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)","colors":["U"],"keywords":["Rebound"],"layout":"normal"},
  "Basilica Screecher": {"name":"Basilica Screecher","mana_cost":"{1}{B}","type_line":"Creature — Bat","oracle_text":"Flying\nExtort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)","power":"1","toughness":"2","colors":["B"],"keywords":["Flying","Extort"],"layout":"normal"},
  "Rift Bolt": {"name":"Rift Bolt","mana_cost":"{2}{R}","type_line":"Sorcery","oracle_text":"Rift Bolt deals 3 damage to any target.\nSuspend 1—{R} (Rather than cast this card from your hand, you may pay {R} and exile it with a time counter on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)","colors":["R"],"keywords":["Suspend"],"layout":"normal"}
}
