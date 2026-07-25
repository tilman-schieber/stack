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
    name: 'Mono-Red Madness (Pauper)',
    description:
      'Current Paupergeddon list: Guttersnipe + burn, loot into madness (Fiery Temper), Blood/Grab the Prize/Highway Robbery to draw, Sneaky Snacker recurs on your third draw, Fireblast for the kill.',
    cards: [
      // Creatures
      [4, 'Guttersnipe'], // cast instant/sorcery -> 2 to each opponent
      [4, 'Sneaky Snacker'], // returns from GY tapped on your third draw
      [4, 'Voldaren Epicure'], // ETB 1 to each opponent + Blood token
      // Artifacts
      [4, 'Melded Moxite'], // ETB may discard -> draw 2; sac -> 2/2 Robot
      // Instants & sorceries
      [4, 'Fiery Temper'], // 3 damage, madness {R}
      [4, 'Fireblast'], // 4 damage; sac two Mountains
      [4, 'Lava Dart'], // 1 damage; flashback (sac a Mountain)
      [4, 'Lightning Bolt'], // 3 damage
      [2, 'Faithless Looting'], // draw 2 / discard 2, flashback
      [4, 'Grab the Prize'], // discard 1, draw 2, 2 to each opponent if nonland
      [4, 'Highway Robbery'], // may discard -> draw 2
      // Lands
      [18, 'Mountain']
    ]
  },
  {
    slug: 'pauper-blue-faeries',
    name: 'Mono-Blue Faeries (Pauper)',
    description:
      'Blue tempo — evasive fliers, Spellstutter Sprite (flash-counter by Faerie count), Ninjutsu (swap in Ninja of the Deep Hours for an unblocked attacker), counters and card selection.',
    cards: [
      [20, 'Island'],
      [4, 'Faerie Seer'], // 1/1 flying Faerie, ETB scry 2 — enabler + Spellstutter fuel
      [4, 'Spellstutter Sprite'], // flash 1/1 flying Faerie; ETB counters by Faerie count
      [4, 'Ninja of the Deep Hours'], // Ninjutsu {1}{U}; combat damage -> draw
      [4, 'Wind Drake'], // 2/2 flying
      [4, 'Snapping Drake'], // 3/2 flying
      [4, 'Counterspell'],
      [4, 'Cancel'],
      [4, 'Preordain'],
      [4, 'Serum Visions'],
      [4, 'Divination']
    ]
  },

  // ---- Sample decks (mono-colour, showcase engine mechanics) ----
  {
    slug: 'sample-goblins',
    name: 'Goblins (sample)',
    description: 'Mono-red goblins — a lord, sac-for-damage, firebreathing, Storm (Empty the Warrens), a planeswalker and burn.',
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
      [2, 'Empty the Warrens'], // Storm: two Goblins, plus a copy per earlier spell
      [2, 'Shivan Dragon'],
      [1, 'Bonesplitter'],
      [4, 'Lightning Bolt']
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
