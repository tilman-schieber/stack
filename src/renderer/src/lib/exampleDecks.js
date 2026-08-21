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
    description:
      'Paupergeddon Summer 2026 winner (Jan Plachý). Artifact-sacrifice value: Cleansing Wildfire on your own artifact lands, Ichor Wellspring loops, Writhing Chrysalis for Eldrazi Spawn mana, and sac outlets.',
    cards: [
      // Creatures
      [4, 'Writhing Chrysalis'],
      [3, 'Krark-Clan Shaman'],
      [4, 'Refurbished Familiar'],
      [2, 'Nyxborn Hydra'],
      // Artifacts
      [3, 'Ichor Wellspring'],
      [3, 'Lembas'],
      [3, 'Nihil Spellbomb'],
      [1, 'Blood Fountain'],
      // Instants
      [2, 'Toxin Analysis'],
      [4, 'Cast Down'],
      [4, 'Fanatical Offering'],
      [2, "Eviscerator's Insight"],
      [1, 'Pulse of Murasa'],
      // Sorcery
      [4, 'Cleansing Wildfire'],
      // Lands
      [4, 'Twisted Landscape'],
      [4, 'Drossforge Bridge'],
      [4, 'Slagwoods Bridge'],
      [2, 'Vault of Whispers'],
      [3, 'Swamp'],
      [1, 'Mountain'],
      [2, 'Forest']
    ]
  },
  {
    slug: 'pauper-grixis-affinity',
    name: 'Grixis Affinity (Pauper)',
    description:
      'The most-played archetype at Paupergeddon Summer 2026 (list: Antonio Picardi). Cheap artifacts power out Myr Enforcer / Utrom Monitor via affinity, Kenku Artificer animates a spare artifact, Galvanic Blast + metalcraft and Reckoner’s Bargain close.',
    cards: [
      // Creatures
      [4, 'Refurbished Familiar'],
      [4, 'Myr Enforcer'],
      [3, 'Krark-Clan Shaman'],
      [2, 'Kenku Artificer'],
      [3, 'Utrom Monitor'],
      // Artifacts / enchantment
      [4, 'Ichor Wellspring'],
      [3, 'Nihil Spellbomb'],
      [2, 'Blood Fountain'],
      [1, 'Makeshift Munitions'],
      // Instants / sorceries
      [4, 'Galvanic Blast'],
      [4, "Reckoner's Bargain"],
      [3, 'Toxin Analysis'],
      [4, 'Thoughtcast'],
      // Lands
      [2, 'Silverbluff Bridge'],
      [4, 'Mistvault Bridge'],
      [4, 'Vault of Whispers'],
      [2, 'Great Furnace'],
      [2, 'Seat of the Synod'],
      [4, 'Drossforge Bridge'],
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

  // ---- Sample decks (showcase engine mechanics; not tuned to the metagame) ----
  {
    slug: 'sample-faeries',
    name: 'Mono-Blue Faeries (sample)',
    description:
      'Not a current metagame deck — a showcase for Spellstutter Sprite (flash-counter by Faerie count), Ninjutsu, Snap (tempo bounce), Ray of Command (a layer-2 control steal), Clone (enter as a copy — a layer-1 copy effect), Cryptic Command (a choose-two modal), and two more copy effects (rule 707): Twincast (copy a spell on the stack) and Cackling Counterpart (make a token copy of your creature).',
    cards: [
      [20, 'Island'],
      [4, 'Faerie Seer'], // 1/1 flying Faerie, ETB scry 2 — enabler + Spellstutter fuel
      [4, 'Spellstutter Sprite'], // flash 1/1 flying Faerie; ETB counters by Faerie count
      [4, 'Ninja of the Deep Hours'], // Ninjutsu {1}{U}; combat damage -> draw
      [3, 'Wind Drake'], // 2/2 flying
      [2, 'Snapping Drake'], // 3/2 flying
      [4, 'Counterspell'],
      [4, 'Snap'], // bounce a creature, untap two lands — tempo
      [3, 'Ray of Command'], // layer 2: gain control of a creature until end of turn
      [2, 'Clone'], // layer 1: enter as a copy of any creature on the battlefield
      [2, 'Cryptic Command'], // modal: choose two of counter / bounce / tap-all / draw
      [2, 'Twincast'], // 707.10: copy target instant or sorcery spell on the stack
      [2, 'Cackling Counterpart'], // 707.2: create a token that's a copy of your creature
      [1, 'Time Walk'], // 720: take an extra turn after this one
      [2, 'Preordain'],
      [1, 'Serum Visions']
    ]
  },
  {
    slug: 'sample-goblins',
    name: 'Goblins (sample)',
    description:
      'Mono-red goblins — a lord, sac-for-damage, firebreathing, Storm (Empty the Warrens), a planeswalker, burn, Furnace of Rath to double every point of damage (a replacement effect), Ball Lightning (an end-step self-sacrifice — a phase-boundary trigger), Abrade (a choose-one modal spell), Goblin Warchief, whose "Goblin spells cost {1} less" is a rule-modifying static, Lightning Greaves, which grants shroud (nothing can target the equipped creature — not even you) and haste for equip {0}, and Adaptive Automaton, which remembers a creature type chosen as it enters and pumps that type.',
    cards: [
      [14, 'Mountain'],
      [2, 'Mogg Fanatic'],
      [1, 'Chandra Nalaar'],
      [2, 'Goblin Warchief'], // static rule-modifier: Goblin spells cost {1} less; grants haste
      [2, 'Lightning Greaves'], // grants shroud (untargetable by anyone) + haste; equip {0}
      [2, 'Adaptive Automaton'], // as it enters, choose a type (Goblin) -> that type gets +1/+1
      [2, 'Raging Goblin'],
      [2, 'Goblin Piker'],
      [3, 'Boggart Brute'],
      [2, 'Goblin King'],
      [2, 'Flametongue Kavu'],
      [2, 'Ball Lightning'], // end-step trigger: sacrifice itself
      [2, 'Dragon Fodder'],
      [2, 'Empty the Warrens'], // Storm: two Goblins, plus a copy per earlier spell
      [1, 'Bonesplitter'],
      [2, 'Act of Treason'], // layer 2: steal a creature until end of turn
      [2, 'Furnace of Rath'], // replacement: doubles all damage
      [2, 'Abrade'], // modal: 3 damage to a creature, or destroy an artifact
      [2, 'Forked Bolt'], // divided: 2 damage split among one or two targets
      [1, 'Relentless Assault'], // 505/506: an additional combat phase this turn
      [3, 'Lightning Bolt']
    ]
  },
  {
    slug: 'sample-green-stompy',
    name: 'Green Stompy (sample)',
    description:
      'Mono-green fatties with ramp, trample, reach, a combat trick, an aura and Fog — plus Gladecover Scout (hexproof: opponents can\'t target it) and Tomakul Honor Guard, whose Ward {2} forces an opponent to pay {2} or have their removal countered.',
    cards: [
      [14, 'Forest'],
      [4, 'Llanowar Elves'],
      [2, 'Gladecover Scout'], // hexproof: can't be targeted by opponents (Bogles-style aura carrier)
      [2, 'Tomakul Honor Guard'], // ward {2}: opponents pay {2} or their spell/ability is countered
      [2, 'Grizzly Bears'],
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
    description:
      'Anthem + evasion — Glorious Anthem and Levitation turn the team into buffed fliers, with two replacement effects (Rhox Faithmender doubles life gained, Samite Healer prevents damage), Flickerwisp (a delayed-trigger blink), two rule-modifying statics — Pacifism ("enchanted creature can\'t attack or block") and Thalia, Guardian of Thraben (noncreature spells cost {1} more) — and White Knight, whose protection from black now also stops black removal (Doom Blade, Murder) from even targeting it, not just from blocking/damage.',
    cards: [
      [15, 'Plains'],
      [4, 'Soul Warden'],
      [2, 'Samite Healer'], // replacement: prevent the next 1 damage to any target
      [3, 'Flickerwisp'], // delayed trigger: exile a creature, return it at end step
      [3, 'White Knight'],
      [2, 'Rhox Faithmender'], // replacement: doubles life you gain
      [4, 'Serra Angel'],
      [2, 'Thalia, Guardian of Thraben'], // static rule-modifier: noncreature spells cost {1} more
      [3, 'Pacifism'], // static rule-modifier: enchanted creature can't attack or block
      [2, 'Raise the Alarm'],
      [3, 'Glorious Anthem'],
      [2, 'Levitation']
    ]
  },
  {
    slug: 'sample-black-midrange',
    name: 'Black Midrange (sample)',
    description:
      'Removal-heavy black — deathtouch, lifelink fliers, Blood Artist, and card draw, with Phyrexian Arena (an upkeep trigger), Nightmare (a */* whose P/T equals the Swamps you control — a characteristic-defining P/T, layer 7a), Aphotic Wisps (turn a creature black — a layer-5 color change that also dodges Doom Blade’s “nonblack”), and Drudge Skeletons, whose "{B}: Regenerate" sets up a shield that replaces the next destruction (a replacement effect).',
    cards: [
      [16, 'Swamp'],
      [2, 'Walking Corpse'],
      [2, 'Drudge Skeletons'], // {B}: Regenerate — a regeneration replacement shield
      [4, 'Typhoid Rats'],
      [4, 'Vampire Nighthawk'],
      [2, 'Blood Artist'],
      [2, 'Nightmare'], // layer 7a: P/T each equal to the number of Swamps you control
      [2, 'Aphotic Wisps'], // layer 5: target creature becomes black, gains fear, draw
      [2, 'Phyrexian Arena'], // upkeep trigger: draw a card, lose 1 life
      [3, 'Doom Blade'],
      [2, 'Murder'],
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
