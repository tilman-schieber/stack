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
  },
  {
    slug: 'pauper-elves',
    name: 'Elves (Pauper)',
    description:
      'Paupergeddon Summer 2026 Top 16 (Andrea Mattei). Mana elves into a wide board: Priest of Titania and Timberwatch Elf scale with the tribe, Quirion Ranger untaps them again, and Lead the Stampede refills.',
    cards: [
      [4, 'Avenging Hunter'],
      [4, 'Fyndhorn Elves'],
      [4, 'Generous Ent'],
      [4, 'Masked Vandal'],
      [4, 'Nyxborn Hydra'],
      [4, 'Priest of Titania'],
      [4, 'Quirion Ranger'],
      [2, 'Llanowar Elves'],
      [2, 'Elvish Mystic'],
      [4, 'Timberwatch Elf'],
      [3, 'Sagu Wildling'],
      [1, 'Land Grant'],
      [4, 'Winding Way'],
      [4, 'Lead the Stampede'],
      [1, 'Gingerbread Cabin'],
      [11, 'Forest']
    ],
    sideboard: [
      [2, 'Lignify'],
      [4, 'Faerie Macabre'],
      [4, 'Monstrous Emergence'],
      [3, 'Primordial Pachyderm'],
      [2, 'Rooftop Percher']
    ]
  },
  {
    slug: 'pauper-gruul-monsters',
    name: 'Gruul Monsters (Pauper)',
    description:
      'Paupergeddon Summer 2026 Top 64 (Francesco Zibella). Wild Growth and Utopia Sprawl on turn one power out fat green threats a turn early, with Molten Gatekeeper and Eldrazi Spawn for reach.',
    cards: [
      [2, 'Annoyed Altisaur'],
      [4, 'Arbor Elf'],
      [4, 'Avenging Hunter'],
      [4, 'Boarding Party'],
      [4, 'Eldrazi Repurposer'],
      [4, 'Jewel Thief'],
      [2, 'Molten Gatekeeper'],
      [4, 'Writhing Chrysalis'],
      [2, 'Sagu Wildling'],
      [4, 'Utopia Sprawl'],
      [4, 'Wild Growth'],
      [4, 'Malevolent Rumble'],
      [2, 'You Meet in a Tavern'],
      [14, 'Forest'],
      [2, 'Mountain']
    ],
    sideboard: [
      [3, 'Breath Weapon'],
      [4, 'Deglamer'],
      [4, 'Weather the Storm'],
      [2, 'Relic of Progenitus'],
      [2, 'Faerie Macabre']
    ]
  },
  {
    slug: 'pauper-dimir-affinity',
    name: 'Dimir Affinity (Pauper)',
    description:
      'Paupergeddon Summer 2026 Top 64 (Scott Emery). The affinity shell in blue-black: artifact lands power out Myr Enforcer and Utrom Monitor, Cryogen Relic and Blood Fountain turn the spare artifacts into cards.',
    cards: [
      [2, 'Gearseeker Serpent'],
      [4, 'Myr Enforcer'],
      [4, 'Refurbished Familiar'],
      [4, 'Utrom Monitor'],
      [4, 'Blood Fountain'],
      [4, 'Cryogen Relic'],
      [2, "Executioner's Capsule"],
      [3, 'Nihil Spellbomb'],
      [1, 'Agony Warp'],
      [4, 'Cast Down'],
      [1, "Eviscerator's Insight"],
      [4, "Reckoner's Bargain"],
      [4, 'Thoughtcast'],
      [1, 'Bojuka Bog'],
      [2, 'Island'],
      [4, 'Mistvault Bridge'],
      [4, 'Seat of the Synod'],
      [2, "Serpent's Pass"],
      [2, 'Swamp'],
      [4, 'Vault of Whispers']
    ],
    sideboard: [
      [2, 'Blue Elemental Blast'],
      [2, 'Dispel'],
      [3, 'Drown in Sorrow'],
      [2, 'Extract a Confession'],
      [2, 'Hydroblast'],
      [1, 'Nihil Spellbomb'],
      [2, 'Steel Sabotage'],
      [1, 'Unexpected Fangs']
    ]
  },
  {
    slug: 'pauper-bogles',
    name: 'Bogles (Pauper)',
    description:
      'Paupergeddon Summer 2026 Top 16 (Michele Signoracci). One hexproof creature, then pile Auras on it: Ethereal Armor and Ancestral Mask grow with every enchantment, Armadillo Cloak makes the race unloseable.',
    cards: [
      [4, 'Gladecover Scout'],
      [2, 'Silhana Ledgewalker'],
      [4, 'Slippery Bogle'],
      [4, 'Abundant Growth'],
      [4, 'Ancestral Mask'],
      [4, 'Armadillo Cloak'],
      [1, 'Cartouche of Solidarity'],
      [4, 'Ethereal Armor'],
      [1, 'Lifelink'],
      [4, 'Rancor'],
      [2, "Sentinel's Eyes"],
      [1, 'Spirit Link'],
      [2, 'Utopia Sprawl'],
      [2, 'Commune with Spirits'],
      [4, 'Malevolent Rumble'],
      [9, 'Forest'],
      [2, 'Khalni Garden'],
      [4, 'Plains'],
      [2, 'Shattered Landscape']
    ],
    sideboard: [
      [1, 'Faerie Macabre'],
      [2, 'Flaring Pain'],
      [2, 'Fling'],
      [1, 'Hyena Umbra'],
      [1, 'Lifelink'],
      [2, 'Mask of Law and Grace'],
      [2, 'Standard Bearer'],
      [2, "Tamiyo's Safekeeping"],
      [2, 'Thraben Charm']
    ]
  },
  {
    slug: 'pauper-black-turbofog',
    name: 'Black Turbofog (Pauper)',
    description:
      'Paupergeddon Summer 2026 Top 64 (Daniel Pellitteri). Mono-black attrition: Pestilence sweeps the board, Cauldron Familiar and Food drain and gain, and the removal suite answers whatever survives.',
    cards: [
      [3, 'Cauldron Familiar'],
      [3, 'Troll of Khazad-dûm'],
      [4, 'Nutrient Block'],
      [4, 'Lembas'],
      [2, 'Ichor Wellspring'],
      [1, "Bonder's Ornament"],
      [3, 'Campfire'],
      [2, 'Nihil Spellbomb'],
      [2, 'Tithing Blade'],
      [3, 'Pestilence'],
      [4, 'Cast Down'],
      [1, 'Tragic Slip'],
      [1, 'Snuff Out'],
      [4, 'Fanatical Offering'],
      [3, "Eviscerator's Insight"],
      [1, 'Heritage Reclamation'],
      [1, 'Grapple with Death'],
      [9, 'Swamp'],
      [2, 'Golgari Rot Farm'],
      [2, 'Bojuka Bog'],
      [1, 'Haunted Mire'],
      [4, 'Khalni Garden']
    ],
    sideboard: [
      [4, 'Weather the Storm'],
      [1, 'Diabolic Edict'],
      [1, 'Snuff Out'],
      [1, 'Tragic Slip'],
      [1, "Moment's Peace"],
      [2, 'Drown in Sorrow'],
      [1, 'Suffocating Fumes'],
      [2, 'Faerie Macabre'],
      [2, 'Troublemaker Ouphe']
    ]
  },
  {
    slug: 'pauper-azorius-familiars',
    name: 'Azorius Familiars (Pauper)',
    description:
      'Paupergeddon Summer 2026 Top 32 (Tommaso Loss). Sunscape Familiar makes everything cheap, then Ghostly Flicker and Ephemerate blink Mulldrifter and Archaeomancer for value until the opponent runs out.',
    cards: [
      [3, 'Archaeomancer'],
      [4, "God-Pharaoh's Faithful"],
      [4, 'Mulldrifter'],
      [1, 'Murmuring Mystic'],
      [4, 'Sunscape Familiar'],
      [3, 'Abandon Attachments'],
      [2, 'Ephemerate'],
      [1, 'Ghostly Flicker'],
      [2, 'Negate'],
      [2, 'Prismatic Strands'],
      [2, 'Prohibit'],
      [4, 'Snap'],
      [1, 'Deep Analysis'],
      [4, 'Preordain'],
      [4, 'Lórien Revealed'],
      [4, 'Azorius Chancery'],
      [3, 'Contaminated Landscape'],
      [1, 'Idyllic Beachfront'],
      [8, 'Island'],
      [1, 'Mortuary Mire'],
      [2, 'Plains']
    ],
    sideboard: [
      [1, 'Deep Analysis'],
      [2, 'Dust to Dust'],
      [2, 'Glorious Gale'],
      [4, 'Hydroblast'],
      [2, 'Last Breath'],
      [1, 'Murmuring Mystic'],
      [2, 'Stonehorn Dignitary'],
      [1, 'Thraben Charm']
    ]
  }
]

// Flatten a deck's cards (main and sideboard) into a de-duplicated list of names.
export function deckCardNames(deck) {
  return [...new Set([...deck.cards, ...(deck.sideboard || [])].map(([, name]) => name))]
}
