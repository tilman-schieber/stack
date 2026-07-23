// Built-in example decks for the rules-engine play mode. Every card here is
// engine-supported: basic lands, vanilla/keyword creatures (derived for free
// from Scryfall data), and spells the engine implements (see
// src/shared/engine/behaviors.mjs). Loading resolves the names against Scryfall
// so real card art appears, while the engine enforces the rules by card name.

export const EXAMPLE_DECKS = [
  {
    slug: 'example-red-aggro',
    name: 'Goblins (example)',
    description: 'Mono-red goblin aggro — a lord, sac-for-damage, firebreathing and burn.',
    cards: [
      [14, 'Mountain'],
      [2, 'Mogg Fanatic'], // sacrifice: 1 damage (activated ability)
      [1, 'Chandra Nalaar'], // planeswalker: loyalty abilities
      [3, 'Raging Goblin'], // haste
      [3, 'Goblin Piker'], // vanilla 2/1
      [3, 'Boggart Brute'], // menace 3/2
      [2, 'Goblin King'], // lord: other Goblins get +1/+1 (layer 7d)
      [2, 'Flametongue Kavu'], // ETB: 4 damage to target creature (targeted trigger)
      [2, 'Dragon Fodder'], // create two 1/1 Goblin tokens
      [2, 'Shivan Dragon'], // {R}: +1/+0 firebreathing (activated ability)
      [1, 'Bonesplitter'], // Equipment: +2/+0, Equip {1}
      [4, 'Lightning Bolt'],
      [1, 'Lightning Strike']
    ]
  },
  {
    slug: 'example-green-stompy',
    name: 'Green Stompy (example)',
    description: 'Mono-green fatties with ramp, trample, reach — and a combat trick.',
    cards: [
      [14, 'Forest'],
      [4, 'Llanowar Elves'], // mana dork
      [3, 'Grizzly Bears'], // vanilla 2/2
      [3, 'Elvish Visionary'], // ETB: draw
      [3, 'Servant of the Scale'], // enters with two +1/+1 counters (replacement)
      [3, 'Rumbling Baloth'], // trample 4/4
      [2, 'Giant Spider'], // reach 2/4
      [2, 'Craw Wurm'], // vanilla 6/4
      [2, 'Giant Growth'], // +3/+3 until end of turn
      [2, 'Rancor'], // Aura: +2/+0 and trample
      [2, 'Fog'] // prevent all combat damage this turn
    ]
  },
  {
    slug: 'pauper-red-madness-burn',
    name: 'Red Madness Burn (Pauper)',
    description: 'Mono-red burn with prowess, madness (Fiery Temper) and flashback loot.',
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
    slug: 'example-white-skies',
    name: 'White Skies (example)',
    description: 'Anthem + evasion — Glorious Anthem and Levitation turn the team into fliers.',
    cards: [
      [16, 'Plains'],
      [4, 'Soul Warden'], // ETB lifegain
      [4, 'White Knight'], // first strike, protection from black
      [3, 'Fencing Ace'], // double strike
      [4, 'Serra Angel'], // flying, vigilance
      [3, 'Raise the Alarm'], // create two 1/1 Soldier tokens
      [3, 'Glorious Anthem'], // creatures you control get +1/+1 (layer 7d)
      [3, 'Levitation'] // creatures you control have flying (layer 6)
    ]
  },
  {
    slug: 'example-black-control',
    name: 'Black Midrange (example)',
    description: 'Removal-heavy black — deathtouch, lifelink fliers and card draw.',
    cards: [
      [16, 'Swamp'],
      [4, 'Walking Corpse'], // vanilla 2/2
      [4, 'Typhoid Rats'], // deathtouch 1/1
      [4, 'Vampire Nighthawk'], // flying, deathtouch, lifelink
      [2, 'Blood Artist'], // dies-trigger lifegain
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
