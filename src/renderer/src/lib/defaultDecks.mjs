// The decks the app starts with (mainboards and sideboards). On first start they are saved into the deck
// store as ordinary decks (src/renderer/src/store/decks.js), so the player can
// edit, rename or delete them; "Restore default decks" brings back any that are
// missing. Every card here is engine-supported: basic lands, vanilla/keyword
// creatures (derived for free from Scryfall data), and spells the engine
// implements (see src/shared/engine/behaviors.mjs). Saving resolves the names
// against Scryfall, so real printings and art are stored.

export const DEFAULT_DECKS = [
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
    ],
    sideboard: [
      [2, 'Faerie Macabre'],
      [2, 'Pyroblast'],
      [3, 'Duress'],
      [3, 'Weather the Storm'],
      [2, 'Troublemaker Ouphe'],
      [1, 'Terminate'],
      [2, 'Breath Weapon']
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
    ],
    sideboard: [
      [1, 'Unexpected Fangs'],
      [2, 'Extract a Confession'],
      [1, 'Krark-Clan Shaman'],
      [1, 'Red Elemental Blast'],
      [4, 'Pyroblast'],
      [4, 'Hydroblast'],
      [2, 'Blue Elemental Blast']
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
    ],
    sideboard: [
      [1, 'Crimson Fleet Commodore'],
      [4, 'Pyroblast'],
      [3, 'Red Elemental Blast'],
      [4, 'Relic of Progenitus'],
      [3, 'Searing Blaze']
    ]
  },

  {
    slug: 'pauper-white-weenie',
    name: 'White Weenie (Pauper)',
    description:
      'Paupergeddon Summer 2026 runner-up (Giovanni Favetta). Cheap white creatures with card advantage attached — Inspectors investigate, Raffine\'s Informant connives, Kor Skyfisher rebuys them — Battle Screech and Prismatic Strands flash back by tapping white creatures, Lunarch Veteran returns from the graveyard with disturb, Leonardo sneaks in for {W}, Elite Interceptor enters prepared with Rejoinder to cast.',
    cards: [
      [4, 'Kor Skyfisher'],
      [4, 'Novice Inspector'],
      [4, "Raffine's Informant"],
      [4, 'Thraben Inspector'],
      [3, 'Leonardo, Big Brother'],
      [1, 'Spider-Man, Web-Slinger'],
      [2, 'Elite Interceptor'],
      [4, 'Lunarch Veteran'],
      [4, 'Prismatic Strands'],
      [4, 'Thraben Charm'],
      [2, "Guardians' Pledge"],
      [1, 'Ramosian Rally'],
      [4, 'Battle Screech'],
      [17, 'Plains'],
      [2, 'Idyllic Grange']
    ],
    sideboard: [
      [4, 'Dust to Dust'],
      [3, 'Journey to Nowhere'],
      [3, 'Standard Bearer'],
      [1, 'Holy Light'],
      [4, 'Martyr of Sands']
    ]
  },
  {
    slug: 'pauper-mono-red-rally',
    name: 'Mono Red Rally (Pauper)',
    description:
      'Paupergeddon Summer 2026 third place (Dario Boniburini). Hasty one-drops and Burning-Tree Emissary into a kicked Goblin Bushwhacker or Rally at the Hornburg, Inventor\'s Axe for energy and +2/+0, Reckless Impulse / Wrenn\'s Resolve for gas, and burn that Chain Lightning lets the victim copy back.',
    cards: [
      [4, 'Burning-Tree Emissary'],
      [4, 'Clockwork Percussionist'],
      [4, 'Goblin Bushwhacker'],
      [4, 'Goblin Tomb Raider'],
      [4, 'Voldaren Epicure'],
      [4, "Inventor's Axe"],
      [4, 'Galvanic Blast'],
      [4, 'Lightning Bolt'],
      [2, 'Chain Lightning'],
      [4, 'Rally at the Hornburg'],
      [3, 'Reckless Impulse'],
      [1, "Wrenn's Resolve"],
      [4, 'Great Furnace'],
      [14, 'Mountain']
    ],
    sideboard: [
      [4, 'Cast into the Fire'],
      [1, 'Flaring Pain'],
      [4, 'Pyroblast'],
      [3, 'Relic of Progenitus'],
      [3, 'Tectonic Hazard']
    ]
  },
  // ---- Sample decks (showcase engine mechanics; not tuned to the metagame) ----
  {
    slug: 'pauper-mono-blue-terror',
    name: 'Mono Blue Terror (Pauper)',
    description:
      'Paupergeddon Summer 2026 Top 64 (Matteo Conte). Fill the graveyard with cantrips (Brainstorm, Ponder, Thought Scour, Mental Note) so Tolarian Terror and Cryptic Serpent cost almost nothing, Delver flips early, and counterspells protect the threats.',
    cards: [
      // Creatures
      [4, 'Tolarian Terror'],
      [4, 'Cryptic Serpent'],
      [1, 'Murmuring Mystic'],
      [4, 'Delver of Secrets'],
      // Instants / sorceries
      [4, 'Brainstorm'],
      [4, 'Thought Scour'],
      [4, 'Mental Note'],
      [4, 'Counterspell'],
      [1, 'Dispel'],
      [3, 'Ponder'],
      [1, 'Deep Analysis'],
      [4, 'Deem Inferior'],
      [2, 'Sleep of the Dead'],
      [4, 'Lórien Revealed'],
      // Lands
      [16, 'Island']
    ],
    sideboard: [
      [4, 'Hydroblast'],
      [3, 'Blue Elemental Blast'],
      [1, 'Envelop'],
      [4, 'Annul'],
      [2, 'Gut Shot'],
      [1, 'Murmuring Mystic']
    ]
  },
  {
    slug: 'pauper-dimir-terror',
    name: 'Dimir Terror (Pauper)',
    description:
      'Paupergeddon Summer 2026 Top 64 (Lorenzo Pucci). Cantrips fill the graveyard so Tolarian Terror and a delved Gurmag Angler come down cheap; Snuff Out kills for free off a Swamp and counterspells hold the rest back.',
    cards: [
      // Creatures
      [4, 'Tolarian Terror'],
      [4, 'Sneaky Snacker'],
      [2, 'Gurmag Angler'],
      [1, 'Murmuring Mystic'],
      // Instants / sorceries
      [4, 'Brainstorm'],
      [4, 'Mental Note'],
      [4, 'Thought Scour'],
      [4, 'Counterspell'],
      [4, 'Snuff Out'],
      [2, 'Cast Down'],
      [2, 'Spell Pierce'],
      [2, 'Abandon Attachments'],
      [2, 'Unexpected Fangs'],
      [4, 'Lórien Revealed'],
      [1, 'Deep Analysis'],
      // Lands
      [4, 'Contaminated Aquifer'],
      [2, 'Ice Tunnel'],
      [10, 'Island']
    ],
    sideboard: [
      [2, 'Annul'],
      [2, 'Arms of Hadar'],
      [3, 'Blue Elemental Blast'],
      [2, 'Hydroblast'],
      [2, 'Nihil Spellbomb'],
      [3, 'Steel Sabotage'],
      [1, 'Thorn of the Black Rose']
    ]
  },
  {
    slug: 'pauper-naya-gates',
    name: 'Naya Gates (Pauper)',
    description:
      'Paupergeddon Summer 2026 Top 64 (Pietro Malevolti). Cheap lifelinkers and recursive threats hold the ground while the Gates pile up, until Basilisk Gate turns one of them into a game-ending attacker.',
    cards: [
      // Creatures
      [4, 'Outlaw Medic'],
      [4, 'Sacred Cat'],
      [4, 'Sneaky Snacker'],
      [4, 'Writhing Chrysalis'],
      // Artifacts / enchantments
      [2, 'Melded Moxite'],
      [2, 'Bitter Reunion'],
      [1, 'Talons of Wildwood'],
      // Instants / sorceries
      [3, 'Lightning Bolt'],
      [4, 'Prismatic Strands'],
      [3, 'Thraben Charm'],
      [4, 'Malevolent Rumble'],
      [4, 'Pursue the Past'],
      // Lands
      [4, 'Basilisk Gate'],
      [4, 'Citadel Gate'],
      [4, 'Cliffgate'],
      [1, 'Heap Gate'],
      [3, 'Manor Gate'],
      [3, 'Mountain'],
      [2, 'Plains']
    ],
    sideboard: [
      [2, 'Ancient Grudge'],
      [1, 'Electrickery'],
      [4, 'Red Elemental Blast'],
      [4, 'Spellstutter Sprite'],
      [4, "Tamiyo's Safekeeping"]
    ]
  },
  {
    slug: 'pauper-boros-synth',
    name: 'Boros Synth (Pauper)',
    description:
      'Paupergeddon Summer 2026 Top 64 (Tom Pařez). Cheap artifacts and creatures that bounce them for value — Kor Skyfisher, Glint Hawk, Melded Moxite — with Galvanic Blast and Lightning Bolt as the reach.',
    cards: [
      // Creatures
      [4, 'Kor Skyfisher'],
      [4, 'Sneaky Snacker'],
      [4, 'Thraben Inspector'],
      [2, 'Glint Hawk'],
      [1, 'Dawnbringer Cleric'],
      // Artifacts / enchantments
      [4, 'Melded Moxite'],
      [3, 'Relic of Progenitus'],
      [2, "Red Mage's Rapier"],
      [2, 'Lembas'],
      [3, 'Journey to Nowhere'],
      // Instants / sorceries
      [4, 'Galvanic Blast'],
      [4, 'Lightning Bolt'],
      [4, 'Pursue the Past'],
      // Lands
      [4, 'Wind-Scarred Crag'],
      [3, 'Dimension X'],
      [2, 'Ancient Den'],
      [2, 'Great Furnace'],
      [1, 'Boros Garrison'],
      [1, 'Forgotten Cave'],
      [1, 'Kabira Crossroads'],
      [3, 'Mountain'],
      [2, 'Plains']
    ],
    sideboard: [
      [2, 'Cast into the Fire'],
      [3, 'Destroy Evil'],
      [3, 'Dust to Dust'],
      [2, 'Electrickery'],
      [3, 'Pyroblast'],
      [2, 'Temple Acolyte']
    ]
  }
]

// Flatten a deck's cards (main and sideboard) into a de-duplicated list of names.
export function deckCardNames(deck) {
  return [...new Set([...deck.cards, ...(deck.sideboard || [])].map(([, name]) => name))]
}
