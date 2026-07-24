// Built-in example decks for the rules-engine play mode. Every card here is
// engine-supported: basic lands, vanilla/keyword creatures (derived for free
// from Scryfall data), and spells the engine implements (see
// src/shared/engine/behaviors.mjs). Loading resolves the names against Scryfall
// so real card art appears, while the engine enforces the rules by card name.

export const EXAMPLE_DECKS = [
  // ---- Pauper archetypes ----
  {
    slug: 'pauper-jund-wildfire',
    name: 'Jund Wildfire (Pauper)',
    description: 'Artifact-sacrifice value: Cleansing Wildfire on your own artifact lands, Ichor Wellspring loops, and sac outlets.',
    cards: [
      // Creatures
      [2, 'Nyxborn Hydra'],
      [3, 'Krark-Clan Shaman'],
      [4, 'Refurbished Familiar'],
      [4, 'Writhing Chrysalis'],
      [1, 'Sagu Wildling'],
      // Artifacts
      [2, 'Lembas'],
      [3, 'Nihil Spellbomb'],
      [4, 'Ichor Wellspring'],
      // Instants
      [1, 'Go for the Throat'],
      [2, "Eviscerator's Insight"],
      [4, 'Fanatical Offering'],
      [3, 'Cast Down'],
      [1, 'Pulse of Murasa'],
      [1, 'Toxin Analysis'],
      // Sorcery / enchantment
      [4, 'Cleansing Wildfire'],
      [1, 'Makeshift Munitions'],
      // Lands
      [4, 'Drossforge Bridge'],
      [4, 'Slagwoods Bridge'],
      [4, 'Twisted Landscape'],
      [2, 'Vault of Whispers'],
      [3, 'Swamp'],
      [2, 'Forest'],
      [1, 'Mountain']
    ]
  },
  {
    slug: 'pauper-madness-burn',
    name: 'Mono-Red Madness Burn (Pauper)',
    description: 'Aggressive burn with prowess, madness (Fiery Temper) and flashback loot.',
    cards: [
      [16, 'Mountain'],
      [4, 'Monastery Swiftspear'], // prowess, haste
      [4, 'Mogg Fanatic'], // sacrifice: 1 damage
      [2, 'Goblin Piker'], // vanilla beater
      [4, 'Faithless Looting'], // draw 2 / discard 2 (madness enabler), flashback
      [4, 'Fiery Temper'], // 3 damage, madness {R}
      [2, 'Firebolt'], // 2 damage, flashback
      [4, 'Lightning Bolt']
    ]
  },
  {
    slug: 'pauper-blue-faeries',
    name: 'Mono-Blue Faeries (Pauper)',
    description: 'Blue tempo — evasive fliers, counters and card selection. (Simplified: Ninjutsu / Spellstutter Sprite still to come.)',
    cards: [
      [16, 'Island'],
      [4, 'Faerie Seer'], // flying, ETB scry 2
      [4, 'Wind Drake'], // 2/2 flying
      [2, 'Snapping Drake'], // 3/3 flying
      [4, 'Counterspell'],
      [2, 'Cancel'],
      [3, 'Preordain'],
      [3, 'Serum Visions'],
      [2, 'Divination']
    ]
  },

  // ---- Sample decks (mono-colour, showcase engine mechanics) ----
  {
    slug: 'sample-goblins',
    name: 'Goblins (sample)',
    description: 'Mono-red goblins — a lord, sac-for-damage, firebreathing, a planeswalker and burn.',
    cards: [
      [14, 'Mountain'],
      [2, 'Mogg Fanatic'],
      [1, 'Chandra Nalaar'],
      [3, 'Raging Goblin'],
      [3, 'Goblin Piker'],
      [3, 'Boggart Brute'],
      [2, 'Goblin King'],
      [2, 'Flametongue Kavu'],
      [2, 'Dragon Fodder'],
      [2, 'Shivan Dragon'],
      [1, 'Bonesplitter'],
      [4, 'Lightning Bolt'],
      [1, 'Lightning Strike']
    ]
  },
  {
    slug: 'sample-green-stompy',
    name: 'Green Stompy (sample)',
    description: 'Mono-green fatties with ramp, trample, reach, a combat trick, an aura and Fog.',
    cards: [
      [14, 'Forest'],
      [4, 'Llanowar Elves'],
      [3, 'Grizzly Bears'],
      [3, 'Elvish Visionary'],
      [3, 'Servant of the Scale'],
      [3, 'Rumbling Baloth'],
      [2, 'Giant Spider'],
      [2, 'Craw Wurm'],
      [2, 'Giant Growth'],
      [2, 'Rancor'],
      [2, 'Fog']
    ]
  },
  {
    slug: 'sample-white-skies',
    name: 'White Skies (sample)',
    description: 'Anthem + evasion — Glorious Anthem and Levitation turn the team into buffed fliers.',
    cards: [
      [16, 'Plains'],
      [4, 'Soul Warden'],
      [4, 'White Knight'],
      [3, 'Fencing Ace'],
      [4, 'Serra Angel'],
      [3, 'Raise the Alarm'],
      [3, 'Glorious Anthem'],
      [3, 'Levitation']
    ]
  },
  {
    slug: 'sample-black-midrange',
    name: 'Black Midrange (sample)',
    description: 'Removal-heavy black — deathtouch, lifelink fliers, Blood Artist and card draw.',
    cards: [
      [16, 'Swamp'],
      [4, 'Walking Corpse'],
      [4, 'Typhoid Rats'],
      [4, 'Vampire Nighthawk'],
      [2, 'Blood Artist'],
      [4, 'Doom Blade'],
      [3, 'Murder'],
      [3, 'Sign in Blood']
    ]
  }
]

// Flatten a deck's cards into a de-duplicated list of names for resolution.
export function deckCardNames(deck) {
  return [...new Set(deck.cards.map(([, name]) => name))]
}

// Expand a deck against a name -> Scryfall card lookup into an array of card
// objects (one per copy) suitable for the engine's createState({ deck }).
export function expandExampleDeck(deck, lookup) {
  const out = []
  const missing = []
  for (const [qty, name] of deck.cards) {
    const card = lookup(name)
    if (!card) {
      missing.push(name)
      continue
    }
    for (let i = 0; i < qty; i++) out.push(card)
  }
  return { cards: out, missing }
}
