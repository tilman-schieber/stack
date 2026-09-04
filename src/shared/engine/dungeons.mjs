// Dungeon cards (rule 309) and the designation helper cards the board shows.
//
// A dungeon is a graph of rooms; each room's ability is "When you move your
// venture marker into this room, [effect]" (309.4c), written here against the
// engine's effect vocabulary. `next` lists the rooms an arrow leads to; a room
// with no `next` is the bottommost room (the dungeon is completed as its ability
// leaves the stack — 309.6). Room texts are Scryfall's oracle text, verbatim.
//
// `scryfallId` is the printing whose art the renderer shows for the card (the
// physical helper card: the Monarch token, the Undercity // The Initiative
// double-faced card, the Adventures in the Forgotten Realms dungeon cards).

const TREASURE = { name: 'Treasure', types: ['Artifact'], subtypes: ['Treasure'], colors: [] }
const SKELETON_4_1 = { name: 'Skeleton', types: ['Creature'], subtypes: ['Skeleton'], colors: ['B'], power: 4, toughness: 1, keywords: ['Menace'] }
const SKELETON_1_1 = { name: 'Skeleton', types: ['Creature'], subtypes: ['Skeleton'], colors: ['B'], power: 1, toughness: 1 }
const GOBLIN = { name: 'Goblin', types: ['Creature'], subtypes: ['Goblin'], colors: ['R'], power: 1, toughness: 1 }
const ATROPAL = {
  name: 'The Atropal',
  supertypes: ['Legendary'],
  types: ['Creature'],
  subtypes: ['God', 'Horror'],
  colors: ['B'],
  power: 4,
  toughness: 4,
  keywords: ['Deathtouch']
}

export const DUNGEONS = {
  Undercity: {
    name: 'Undercity',
    scryfallId: '2c65185b-6cf0-41d9-b4eb-09c605112a13', // Undercity // The Initiative (CLB)
    initiative: true, // reached only through "venture into Undercity" (the initiative)
    rooms: [
      {
        id: 'entrance',
        name: 'Secret Entrance',
        text: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
        effect: [{ op: 'search', filter: { type: 'Land', supertype: 'Basic' }, to: 'hand' }],
        next: ['forge', 'well']
      },
      {
        id: 'forge',
        name: 'Forge',
        text: 'Put two +1/+1 counters on target creature.',
        targets: [{ type: 'creature' }],
        effect: [{ op: 'addCounter', to: 'target0', counter: '+1/+1', amount: 2 }],
        next: ['trap', 'arena']
      },
      { id: 'well', name: 'Lost Well', text: 'Scry 2.', effect: [{ op: 'scry', amount: 2 }], next: ['arena', 'stash'] },
      {
        id: 'trap',
        name: 'Trap!',
        text: 'Target player loses 5 life.',
        targets: [{ type: 'player' }],
        effect: [{ op: 'loseLife', to: 'target0', amount: 5 }],
        next: ['archives']
      },
      {
        id: 'arena',
        name: 'Arena',
        text: 'Goad target creature.',
        targets: [{ type: 'creature' }],
        effect: [{ op: 'goad', to: 'target0' }],
        next: ['archives', 'catacombs']
      },
      { id: 'stash', name: 'Stash', text: 'Create a Treasure token.', effect: [{ op: 'createToken', token: TREASURE }], next: ['catacombs'] },
      { id: 'archives', name: 'Archives', text: 'Draw a card.', effect: [{ op: 'draw', amount: 1 }], next: ['throne'] },
      {
        id: 'catacombs',
        name: 'Catacombs',
        text: 'Create a 4/1 black Skeleton creature token with menace.',
        effect: [{ op: 'createToken', token: SKELETON_4_1 }],
        next: ['throne']
      },
      {
        id: 'throne',
        name: 'Throne of the Dead Three',
        text: 'Reveal the top ten cards of your library. Put a creature card from among them onto the battlefield with three +1/+1 counters on it. It gains hexproof until your next turn. Then shuffle.',
        effect: [{ op: 'revealTopChoose', amount: 10, filter: { type: 'Creature' }, to: 'battlefield', counters: { '+1/+1': 3 }, grant: 'Hexproof', duration: 'untilYourNextTurn' }]
      }
    ]
  },
  'Lost Mine of Phandelver': {
    name: 'Lost Mine of Phandelver',
    scryfallId: '59b11ff8-f118-4978-87dd-509dc0c8c932',
    rooms: [
      { id: 'cave', name: 'Cave Entrance', text: 'Scry 1.', effect: [{ op: 'scry', amount: 1 }], next: ['goblin', 'tunnels'] },
      { id: 'goblin', name: 'Goblin Lair', text: 'Create a 1/1 red Goblin creature token.', effect: [{ op: 'createToken', token: GOBLIN }], next: ['storeroom', 'pool'] },
      { id: 'tunnels', name: 'Mine Tunnels', text: 'Create a Treasure token.', effect: [{ op: 'createToken', token: TREASURE }], next: ['pool', 'fungi'] },
      {
        id: 'storeroom',
        name: 'Storeroom',
        text: 'Put a +1/+1 counter on target creature.',
        targets: [{ type: 'creature' }],
        effect: [{ op: 'addCounter', to: 'target0', counter: '+1/+1', amount: 1 }],
        next: ['temple']
      },
      {
        id: 'pool',
        name: 'Dark Pool',
        text: 'Each opponent loses 1 life and you gain 1 life.',
        effect: [{ op: 'eachOpponentLosesLife', amount: 1 }, { op: 'gainLife', amount: 1 }],
        next: ['temple']
      },
      {
        id: 'fungi',
        name: 'Fungi Cavern',
        text: 'Target creature gets -4/-0 until your next turn.',
        targets: [{ type: 'creature' }],
        effect: [{ op: 'pump', to: 'target0', power: -4, toughness: 0, duration: 'untilYourNextTurn' }],
        next: ['temple']
      },
      { id: 'temple', name: 'Temple of Dumathoin', text: 'Draw a card.', effect: [{ op: 'draw', amount: 1 }] }
    ]
  },
  'Tomb of Annihilation': {
    name: 'Tomb of Annihilation',
    scryfallId: '70b284bd-7a8f-4b60-8238-f746bdc5b236',
    rooms: [
      { id: 'entry', name: 'Trapped Entry', text: 'Each player loses 1 life.', effect: [{ op: 'eachPlayerLosesLife', amount: 1 }], next: ['veils', 'oubliette'] },
      {
        id: 'veils',
        name: 'Veils of Fear',
        text: 'Each player loses 2 life unless they discard a card.',
        effect: [{ op: 'eachPlayerDiscardsOrLosesLife', life: 2 }],
        next: ['sandfall']
      },
      {
        id: 'sandfall',
        name: 'Sandfall Cell',
        text: 'Each player loses 2 life unless they sacrifice a creature, artifact, or land of their choice.',
        effect: [{ op: 'eachPlayerSacrificesOrLosesLife', filter: { types: ['Creature', 'Artifact', 'Land'] }, life: 2 }],
        next: ['cradle']
      },
      {
        id: 'oubliette',
        name: 'Oubliette',
        text: 'Discard a card and sacrifice a creature, an artifact, and a land.',
        effect: [
          { op: 'discard', amount: 1 },
          { op: 'targetPlayerSacrifices', to: 'controller', filter: { types: ['Creature'] } },
          { op: 'targetPlayerSacrifices', to: 'controller', filter: { types: ['Artifact'] } },
          { op: 'targetPlayerSacrifices', to: 'controller', filter: { types: ['Land'] } }
        ],
        next: ['cradle']
      },
      {
        id: 'cradle',
        name: 'Cradle of the Death God',
        text: 'Create The Atropal, a legendary 4/4 black God Horror creature token with deathtouch.',
        effect: [{ op: 'createToken', token: ATROPAL }]
      }
    ]
  },
  'Dungeon of the Mad Mage': {
    name: 'Dungeon of the Mad Mage',
    scryfallId: '6f509dbe-6ec7-4438-ab36-e20be46c9922',
    rooms: [
      { id: 'portal', name: 'Yawning Portal', text: 'You gain 1 life.', effect: [{ op: 'gainLife', amount: 1 }], next: ['level'] },
      { id: 'level', name: 'Dungeon Level', text: 'Scry 1.', effect: [{ op: 'scry', amount: 1 }], next: ['bazaar', 'caverns'] },
      { id: 'bazaar', name: 'Goblin Bazaar', text: 'Create a Treasure token.', effect: [{ op: 'createToken', token: TREASURE }], next: ['lost'] },
      {
        id: 'caverns',
        name: 'Twisted Caverns',
        text: "Target creature can't attack until your next turn.",
        targets: [{ type: 'creature' }],
        effect: [{ op: 'restrict', to: 'target0', actions: ['attack'], duration: 'untilYourNextTurn' }],
        next: ['lost']
      },
      { id: 'lost', name: 'Lost Level', text: 'Scry 2.', effect: [{ op: 'scry', amount: 2 }], next: ['runestone', 'graveyard'] },
      {
        id: 'runestone',
        name: 'Runestone Caverns',
        text: 'Exile the top two cards of your library. You may play them.',
        effect: [{ op: 'exileTopPlayable', amount: 2 }],
        next: ['mines']
      },
      {
        id: 'graveyard',
        name: "Muiral's Graveyard",
        text: 'Create two 1/1 black Skeleton creature tokens.',
        effect: [{ op: 'createToken', count: 2, token: SKELETON_1_1 }],
        next: ['mines']
      },
      { id: 'mines', name: 'Deep Mines', text: 'Scry 3.', effect: [{ op: 'scry', amount: 3 }], next: ['lair'] },
      {
        id: 'lair',
        name: "Mad Wizard's Lair",
        text: 'Draw three cards and reveal them. You may cast one of them without paying its mana cost.',
        effect: [{ op: 'drawRevealCastOne', amount: 3 }]
      }
    ]
  }
}

// The dungeons a plain "venture into the dungeon" may start (701.49a): any the
// player owns other than Undercity, which only the initiative leads into.
export const REGULAR_DUNGEONS = Object.keys(DUNGEONS).filter((k) => !DUNGEONS[k].initiative)

export const roomOf = (dungeonName, roomId) => DUNGEONS[dungeonName]?.rooms.find((r) => r.id === roomId) || null

// Helper cards for designations (725/726) — the physical cards players use.
export const HELPER_CARDS = {
  monarch: { name: 'The Monarch', scryfallId: '40b79918-22a7-4fff-82a6-8ebfe6e87185' }, // Conspiracy: Take the Crown
  initiative: { name: 'Undercity // The Initiative', scryfallId: '2c65185b-6cf0-41d9-b4eb-09c605112a13', face: 'back' },
  ring: { name: 'The Ring // The Ring Tempts You', scryfallId: '7215460e-8c06-47d0-94e5-d1832d0218af' }, // Tales of Middle-earth (front: the emblem)
  day: { name: 'Day // Night', scryfallId: '9c0f7843-4cbb-4d0f-8887-ec823a9238da' }, // Innistrad: Midnight Hunt
  night: { name: 'Day // Night', scryfallId: '9c0f7843-4cbb-4d0f-8887-ec823a9238da', face: 'back' }
}

// The Ring emblem (701.54c): one static and three triggered abilities that
// switch on as the Ring tempts its owner more times.
export const RING_EMBLEM = {
  name: 'The Ring',
  static: [{ affects: { ringBearer: true, controller: 'you' }, addSupertypes: ['Legendary'] }],
  triggered: [
    {
      trigger: { event: 'attacks', filter: { ringBearer: true, controller: 'you' }, if: { ringTempts: { min: 2 } } },
      effect: [{ op: 'draw', amount: 1 }, { op: 'discard', amount: 1 }]
    },
    {
      trigger: { event: 'becomesBlocked', filter: { ringBearer: true, controller: 'you' }, if: { ringTempts: { min: 3 } } },
      effect: [{ op: 'sacrificeAtEndOfCombat', of: 'other' }]
    },
    {
      trigger: { event: 'dealsCombatDamageToPlayer', filter: { ringBearer: true, controller: 'you' }, if: { ringTempts: { min: 4 } } },
      effect: [{ op: 'eachOpponentLosesLife', amount: 3 }]
    }
  ]
}
