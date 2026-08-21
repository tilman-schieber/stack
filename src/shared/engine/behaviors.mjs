// Card behavior registry (schema v1) for the M0 tiny pool.
//
// Most cards need no entry — vanilla creatures and keyword-only cards are derived
// from Scryfall (see cards.mjs). A behavior is only authored when rules text
// implies effects the engine cannot derive. Each behavior is an ability list;
// abilities are composed from a small, tested vocabulary of primitives:
//   spell     — what an instant/sorcery does on resolution
//   activated — { cost, effect, manaAbility? }
//   triggered — { trigger, condition?, effect }  (M1)
//   static    — continuous effect feeding the layer system  (M2/M3)
//
// Effects are { op, ... } records applied by the engine's effect runner.
// Targets chosen at cast time are referenced as 'target0', 'target1', …

export const BEHAVIORS = {
  'Lightning Bolt': {
    spell: {
      targets: [{ type: 'any' }], // creature | player | planeswalker
      effect: [{ op: 'dealDamage', amount: 3, to: 'target0' }]
    }
  },
  'Llanowar Elves': {
    activated: [
      {
        manaAbility: true,
        cost: { tap: true },
        effect: [{ op: 'addMana', mana: 'G' }]
      }
    ]
  },
  'Elvish Visionary': {
    triggered: [
      { trigger: { event: 'etb', self: true }, effect: [{ op: 'draw', amount: 1 }] }
    ]
  },
  'Soul Warden': {
    triggered: [
      {
        trigger: { event: 'etb', filter: { type: 'Creature', another: true } },
        effect: [{ op: 'gainLife', amount: 1 }]
      }
    ]
  },
  Divination: {
    spell: { effect: [{ op: 'draw', amount: 2 }] }
  },
  'Sign in Blood': {
    // Real card targets a player; M-scope authors the common self-cast.
    spell: { effect: [{ op: 'draw', amount: 2 }, { op: 'loseLife', amount: 2 }] }
  },
  Shock: {
    spell: { targets: [{ type: 'any' }], effect: [{ op: 'dealDamage', amount: 2, to: 'target0' }] }
  },
  'Lightning Strike': {
    spell: { targets: [{ type: 'any' }], effect: [{ op: 'dealDamage', amount: 3, to: 'target0' }] }
  },
  Murder: {
    spell: { targets: [{ type: 'creature' }], effect: [{ op: 'destroy', to: 'target0' }] }
  },
  Cancel: {
    spell: { targets: [{ type: 'spell' }], effect: [{ op: 'counter', to: 'target0' }] }
  },
  'Doom Blade': {
    spell: { targets: [{ type: 'creature', excludeColor: 'B' }], effect: [{ op: 'destroy', to: 'target0' }] }
  },
  Counterspell: {
    spell: { targets: [{ type: 'spell' }], effect: [{ op: 'counter', to: 'target0' }] }
  },
  // The real card also drains a target; M1 authors the untargeted lifegain half.
  // No `another` flag, so it triggers on its own death too.
  'Blood Artist': {
    triggered: [
      { trigger: { event: 'dies', filter: { type: 'Creature' } }, effect: [{ op: 'gainLife', amount: 1 }] }
    ]
  },
  // Static continuous effects, applied via the layer system (layers.mjs).
  'Glorious Anthem': {
    static: [{ affects: { scope: 'creatures', controller: 'you' }, modifyPT: { power: 1, toughness: 1 } }]
  },
  'Goblin King': {
    static: [
      {
        affects: { scope: 'creatures', controller: 'you', subtype: 'Goblin', another: true },
        modifyPT: { power: 1, toughness: 1 }
      }
    ]
  },
  Levitation: {
    static: [{ affects: { scope: 'creatures', controller: 'you' }, grantKeywords: ['Flying'] }]
  },
  // ---- Rule-modifying static effects (rule 613.11 / 603.10) ----
  // These don't change characteristics (that's layers 1–7); they change what
  // players are allowed to do. The engine collects `staticRules` from every
  // battlefield permanent and consults them at the relevant decision points:
  // combat legality (restrict) and cost computation (costMod).
  //
  // Pacifism — Aura: "Enchanted creature can't attack or block."
  Pacifism: {
    enchant: { type: 'creature' },
    staticRules: [{ affects: { scope: 'attached' }, restrict: ['attack', 'block'] }]
  },
  // Goblin Warchief — "Goblin spells you cast cost {1} less. Goblins you control
  // have haste." The cost reduction is a rule-modifier; the haste grant is a
  // normal layer-6 static.
  'Goblin Warchief': {
    static: [
      { affects: { scope: 'creatures', controller: 'you', subtype: 'Goblin' }, grantKeywords: ['Haste'] }
    ],
    staticRules: [{ costMod: { spell: { subtype: 'Goblin', controller: 'you' }, generic: -1 } }]
  },
  // Thalia, Guardian of Thraben — "Noncreature spells cost {1} more to cast."
  // Symmetric: it affects every player, so no controller restriction. First
  // strike is a printed keyword (derived for free).
  'Thalia, Guardian of Thraben': {
    staticRules: [{ costMod: { spell: { noncreature: true }, generic: 1 } }]
  },
  // ---- Control-changing effects (rule 613 layer 2), sample decks ----
  // "Gain control of target creature until end of turn. Untap it. It gains haste."
  'Act of Treason': {
    spell: {
      targets: [{ type: 'creature' }],
      effect: [{ op: 'gainControl', to: 'target0', untap: true, haste: true }]
    }
  },
  // "Untap target creature an opponent controls and gain control of it until end of
  // turn. It gains haste until end of turn." (The "tap it when you lose control"
  // clause is not modelled.)
  'Ray of Command': {
    spell: {
      targets: [{ type: 'creature' }],
      effect: [{ op: 'gainControl', to: 'target0', untap: true, haste: true }]
    }
  },
  // ---- Color-changing effects (rule 613 layer 5), sample decks ----
  // "Target creature becomes black and gains fear until end of turn. Draw a card."
  // The color change is a layer-5 effect; making a creature black changes whether
  // "nonblack"-restricted spells (Doom Blade) can target it. (Fear is granted as a
  // keyword; its unblockable-except clause is not yet enforced.)
  'Aphotic Wisps': {
    spell: {
      targets: [{ type: 'creature' }],
      effect: [
        { op: 'setColors', to: 'target0', colors: ['B'], keywords: ['Fear'], duration: 'eot' },
        { op: 'draw', amount: 1 }
      ]
    }
  },
  // ---- Characteristic-defining P/T (rule 613 layer 7a), sample decks ----
  // "Nightmare's power and toughness are each equal to the number of Swamps you
  // control." (Flying is derived from the keyword line.) A CDA sets the base P/T
  // from game state, so counters/anthems still stack on top of it.
  Nightmare: {
    cda: { count: 'swampsYouControl' }
  },
  // ---- Modal spells (rule 700.2), sample decks ----
  // "Choose one — Abrade deals 3 damage to target creature; or Destroy target artifact."
  Abrade: {
    spell: {
      modal: { count: 1 },
      modes: [
        {
          label: 'Abrade deals 3 damage to target creature',
          targets: [{ type: 'creature' }],
          effect: [{ op: 'dealDamage', to: 'target0', amount: 3 }]
        },
        {
          label: 'Destroy target artifact',
          targets: [{ type: 'artifact' }],
          effect: [{ op: 'destroy', to: 'target0' }]
        }
      ]
    }
  },
  // "Choose two — Counter target spell; or Return target permanent to its owner's
  // hand; or Tap all creatures your opponents control; or Draw a card." (Choose two
  // demonstrates count>1: each selected mode carries its own targets.)
  'Cryptic Command': {
    spell: {
      modal: { count: 2 },
      modes: [
        { label: 'Counter target spell', targets: [{ type: 'spell' }], effect: [{ op: 'counter', to: 'target0' }] },
        { label: "Return target creature to its owner's hand", targets: [{ type: 'creature' }], effect: [{ op: 'bounce', to: 'target0' }] },
        { label: 'Tap all creatures your opponents control', effect: [{ op: 'tapAll', who: 'opponents', filter: { type: 'creature' } }] },
        { label: 'Draw a card', effect: [{ op: 'draw', amount: 1 }] }
      ]
    }
  },
  // ---- Copy effects (rule 706 / 613 layer 1), sample decks ----
  // "You may have this creature enter as a copy of any creature on the battlefield."
  // The copy replaces this permanent's copiable characteristics (name, types, P/T,
  // abilities) as it enters, so it never briefly exists as a 0/0.
  Clone: {
    copyOnEnter: {}
  },
  // ---- Delayed / phase-boundary triggers (rule 503/513/603.7), sample decks ----
  // "At the beginning of the end step, sacrifice this creature." (Haste/trample derived.)
  'Ball Lightning': {
    triggered: [{ trigger: { event: 'endStep' }, effect: [{ op: 'sacrificeSelf' }] }]
  },
  // ETB: exile a target creature, then return it at the next end step (a delayed
  // trigger). Real card targets any "another permanent"; scoped to a creature here.
  Flickerwisp: {
    triggered: [
      {
        trigger: { event: 'etb', self: true },
        targets: [{ type: 'creature' }],
        effect: [{ op: 'exileReturnEndStep', to: 'target0' }]
      }
    ]
  },
  // "At the beginning of your upkeep, you draw a card and you lose 1 life."
  'Phyrexian Arena': {
    triggered: [
      {
        trigger: { event: 'upkeep', yourTurn: true },
        effect: [{ op: 'draw', amount: 1 }, { op: 'loseLife', amount: 1 }]
      }
    ]
  },
  // ---- Replacement effects (rule 614), showcased in the sample decks ----
  // "If a source would deal damage …, it deals double that damage instead."
  'Furnace of Rath': {
    replacement: [{ event: 'damage', apply: { multiply: 2 } }]
  },
  // "If you would gain life, you gain twice that much life instead."
  'Rhox Faithmender': {
    replacement: [{ event: 'gainLife', filter: { player: 'you' }, apply: { multiply: 2 } }]
  },
  // "{T}: Prevent the next 1 damage that would be dealt to any target this turn."
  'Samite Healer': {
    activated: [
      {
        cost: { tap: true },
        targets: [{ type: 'any' }],
        effect: [{ op: 'preventNextDamage', amount: 1, to: 'target0' }]
      }
    ]
  },
  'Giant Growth': {
    spell: {
      targets: [{ type: 'creature' }],
      effect: [{ op: 'pump', to: 'target0', power: 3, toughness: 3, duration: 'eot' }]
    }
  },
  // Activated abilities (non-mana): go on the stack, may target, pay costs.
  'Prodigal Sorcerer': {
    activated: [
      {
        cost: { tap: true },
        targets: [{ type: 'any' }],
        effect: [{ op: 'dealDamage', amount: 1, to: 'target0' }]
      }
    ]
  },
  'Shivan Dragon': {
    activated: [
      {
        cost: { mana: '{R}' },
        effect: [{ op: 'pump', to: 'self', power: 1, toughness: 0, duration: 'eot' }]
      }
    ]
  },
  'Mogg Fanatic': {
    activated: [
      {
        cost: { sacrifice: 'self' },
        targets: [{ type: 'any' }],
        effect: [{ op: 'dealDamage', amount: 1, to: 'target0' }]
      }
    ]
  },
  'Flametongue Kavu': {
    // A targeted triggered ability — the target is chosen as it goes on the stack.
    triggered: [
      {
        trigger: { event: 'etb', self: true },
        targets: [{ type: 'creature' }],
        effect: [{ op: 'dealDamage', amount: 4, to: 'target0' }]
      }
    ]
  },
  // Replacement: a 0/0 that enters with two +1/+1 counters (so it's a 2/2).
  'Servant of the Scale': {
    entersWith: { counter: '+1/+1', amount: 2 }
  },
  // Prevention shield until end of turn.
  Fog: {
    spell: { effect: [{ op: 'preventAllCombat', duration: 'eot' }] }
  },
  // Aura: cast targeting a creature; enters attached; static via 'attached' scope.
  Rancor: {
    enchant: { type: 'creature' },
    static: [
      {
        affects: { scope: 'attached' },
        modifyPT: { power: 2, toughness: 0 },
        grantKeywords: ['Trample']
      }
    ]
  },
  // Equipment: enters free; sorcery-speed Equip ability attaches it.
  Bonesplitter: {
    static: [{ affects: { scope: 'attached' }, modifyPT: { power: 2, toughness: 0 } }],
    activated: [
      {
        equip: true,
        sorcerySpeed: true,
        cost: { mana: '{1}' },
        targets: [{ type: 'creature' }],
        effect: [{ op: 'attach', to: 'target0' }]
      }
    ]
  },
  // Equipment that grants shroud (702.18): the equipped creature can't be targeted
  // by ANY spell or ability — including its controller's. A layer-6 keyword grant.
  'Lightning Greaves': {
    static: [{ affects: { scope: 'attached' }, grantKeywords: ['Haste', 'Shroud'] }],
    activated: [
      {
        equip: true,
        sorcerySpeed: true,
        cost: {},
        targets: [{ type: 'creature' }],
        effect: [{ op: 'attach', to: 'target0' }]
      }
    ]
  },
  // Token makers — art is resolved from Scryfall by the token's characteristics.
  'Dragon Fodder': {
    spell: {
      effect: [
        {
          op: 'createToken',
          count: 2,
          token: { name: 'Goblin', types: ['Creature'], subtypes: ['Goblin'], colors: ['R'], power: 1, toughness: 1 }
        }
      ]
    }
  },
  'Raise the Alarm': {
    spell: {
      effect: [
        {
          op: 'createToken',
          count: 2,
          token: { name: 'Soldier', types: ['Creature'], subtypes: ['Soldier'], colors: ['W'], power: 1, toughness: 1 }
        }
      ]
    }
  },
  Preordain: {
    spell: { effect: [{ op: 'scry', amount: 2 }, { op: 'draw', amount: 1 }] }
  },
  Firebolt: {
    spell: { targets: [{ type: 'any' }], effect: [{ op: 'dealDamage', amount: 2, to: 'target0' }] },
    flashback: { cost: '{4}{R}' }
  },
  'Faithless Looting': {
    spell: { effect: [{ op: 'draw', amount: 2 }, { op: 'discard', amount: 2 }] },
    flashback: { cost: '{2}{R}' }
  },
  'Fiery Temper': {
    spell: { targets: [{ type: 'any' }], effect: [{ op: 'dealDamage', amount: 3, to: 'target0' }] },
    madness: { cost: '{R}' }
  },
  'Basking Rootwalla': {
    madness: { cost: '{0}' },
    activated: [
      {
        cost: { mana: '{1}{G}' },
        oncePerTurn: true,
        effect: [{ op: 'pump', to: 'self', power: 2, toughness: 2, duration: 'eot' }]
      }
    ]
  },
  'Serum Visions': {
    spell: { effect: [{ op: 'draw', amount: 1 }, { op: 'scry', amount: 2 }] }
  },
  'Faerie Seer': {
    triggered: [{ trigger: { event: 'etb', self: true }, effect: [{ op: 'scry', amount: 2 }] }]
  },
  'Ichor Wellspring': {
    triggered: [
      { trigger: { event: 'etb', self: true }, effect: [{ op: 'draw', amount: 1 }] },
      { trigger: { event: 'toGraveyard', self: true }, effect: [{ op: 'draw', amount: 1 }] }
    ]
  },
  'Writhing Chrysalis': {
    // Cast trigger makes two 0/1 Eldrazi Spawn (each sacrifices for {C} — that mana
    // ability is authored on the token by name). Sacrificing another Eldrazi (e.g.
    // a Spawn for mana) grows this creature with a +1/+1 counter.
    triggered: [
      {
        trigger: { event: 'castSpell', self: true },
        effect: [
          {
            op: 'createToken',
            count: 2,
            token: { name: 'Eldrazi Spawn', types: ['Creature'], subtypes: ['Eldrazi', 'Spawn'], colors: [], power: 0, toughness: 1 }
          }
        ]
      },
      {
        trigger: { event: 'sacrifice', filter: { controller: 'you', subtype: 'Eldrazi', another: true } },
        effect: [{ op: 'addCounter', counter: '+1/+1', amount: 1, to: 'self' }]
      }
    ]
  },
  'Sagu Wildling': {
    triggered: [{ trigger: { event: 'etb', self: true }, effect: [{ op: 'gainLife', amount: 3 }] }],
    omen: {
      name: 'Roost Seek',
      cost: '{G}',
      effect: [{ op: 'search', filter: { supertype: 'Basic', type: 'Land' }, to: 'hand' }]
    }
  },
  // Cast as a creature ({X}{G}) that enters with X +1/+1 counters, or for its Bestow
  // cost ({X}{G}{G}) as an Aura on a creature. While bestowed it's not a creature and
  // the enchanted creature gets +1/+1 per +1/+1 counter on the Hydra (i.e. +X/+X) plus
  // reach & trample; it becomes a creature again if it comes unattached.
  'Nyxborn Hydra': {
    entersWith: { counter: '+1/+1', amount: 'X' },
    bestow: { cost: '{X}{G}{G}' },
    static: [
      {
        affects: { scope: 'attached' },
        modifyPTPerCounter: '+1/+1',
        grantKeywords: ['Reach', 'Trample']
      }
    ]
  },
  'Nihil Spellbomb': {
    activated: [
      {
        cost: { tap: true, sacrifice: 'self' },
        targets: [{ type: 'player' }],
        effect: [{ op: 'exileGraveyard', to: 'target0' }]
      }
    ],
    triggered: [
      {
        trigger: { event: 'toGraveyard', self: true },
        effect: [{ op: 'optionalPay', cost: '{B}', effect: [{ op: 'draw', amount: 1 }] }]
      }
    ]
  },
  Lembas: {
    triggered: [
      { trigger: { event: 'etb', self: true }, effect: [{ op: 'scry', amount: 1 }, { op: 'draw', amount: 1 }] },
      { trigger: { event: 'toGraveyard', self: true }, effect: [{ op: 'shuffleIntoLibrary', of: 'self' }] }
    ],
    activated: [
      { cost: { mana: '{2}', tap: true, sacrifice: 'self' }, effect: [{ op: 'gainLife', amount: 3 }] }
    ]
  },
  'Refurbished Familiar': {
    triggered: [
      {
        trigger: { event: 'etb', self: true },
        effect: [{ op: 'eachOpponentDiscards', drawIfEmpty: true }]
      }
    ]
  },
  'Krark-Clan Shaman': {
    activated: [
      {
        cost: { sacrifice: { types: ['Artifact'] } },
        effect: [{ op: 'dealDamageEach', amount: 1, filter: 'creature', excludeFlying: true }]
      }
    ]
  },
  // ---- Grixis Affinity + Jund Wildfire staples ----
  // Blood Fountain: ETB make a Blood token; sac to return up to two creature cards.
  'Blood Fountain': {
    triggered: [
      {
        trigger: { event: 'etb', self: true },
        effect: [{ op: 'createToken', count: 1, token: { name: 'Blood', types: ['Artifact'], colors: [] } }]
      }
    ],
    activated: [
      {
        cost: { mana: '{3}{B}', tap: true, sacrifice: 'self' },
        effect: [
          { op: 'returnFromGraveyard', filter: { types: ['Creature'] }, optional: true },
          { op: 'returnFromGraveyard', filter: { types: ['Creature'] }, optional: true }
        ]
      }
    ]
  },
  // Affinity spells (cost reduction derived from the "affinity for artifacts" text).
  Thoughtcast: { spell: { effect: [{ op: 'draw', amount: 2 }] } },
  // Metalcraft: 2 damage, or 4 if you control 3+ artifacts.
  'Galvanic Blast': {
    spell: { targets: [{ type: 'any' }], effect: [{ op: 'dealDamage', amount: 2, metalcraft: 4, to: 'target0' }] }
  },
  // Sacrifice an artifact/creature: gain life = its mana value, draw two.
  "Reckoner's Bargain": {
    spell: {
      additionalCost: { sacrifice: { types: ['Artifact', 'Creature'] } },
      effect: [{ op: 'gainLife', amount: 'sacrificedMV' }, { op: 'draw', amount: 2 }]
    }
  },
  // Kenku Artificer: animate a noncreature artifact you control into a 3/3 flyer
  // (base 0/0 + three +1/+1 counters), via a layer-4/6/7b continuous effect.
  'Kenku Artificer': {
    triggered: [
      {
        trigger: { event: 'etb', self: true },
        targets: [{ type: 'artifact', noncreature: true }],
        effect: [
          {
            op: 'animate',
            to: 'target0',
            addTypes: ['Creature'],
            addSubtypes: ['Homunculus'],
            basePower: 0,
            baseToughness: 0,
            keywords: ['Flying'],
            counters: 3
          }
        ]
      }
    ]
  },
  // Eldrazi Spawn token (from Writhing Chrysalis): sacrifice for {C}. Modelled as a
  // manually-activated ability (so it isn't auto-sacrificed to pay for other spells).
  'Eldrazi Spawn': {
    activated: [{ cost: { sacrifice: 'self' }, effect: [{ op: 'addMana', mana: 'C' }] }]
  },
  // Investigate produces a Clue token; its sacrifice-to-draw ability is authored
  // on the token by name.
  Clue: {
    activated: [{ cost: { mana: '{2}', sacrifice: 'self' }, effect: [{ op: 'draw', amount: 1 }] }]
  },
  'Makeshift Munitions': {
    activated: [
      {
        cost: { mana: '{1}', sacrifice: { types: ['Artifact', 'Creature'] } },
        targets: [{ type: 'any' }],
        effect: [{ op: 'dealDamage', amount: 1, to: 'target0' }]
      }
    ]
  },
  'Fanatical Offering': {
    spell: {
      additionalCost: { sacrifice: { types: ['Artifact', 'Creature'] } },
      effect: [
        { op: 'draw', amount: 2 },
        { op: 'createToken', count: 1, token: { name: 'Map', types: ['Artifact'], colors: [] } }
      ]
    }
  },
  // Map token (from Fanatical Offering): {1}, {T}, Sacrifice: target creature you
  // control explores. Sorcery-speed. Its explore ability is authored on the token.
  Map: {
    activated: [
      {
        cost: { mana: '{1}', tap: true, sacrifice: 'self' },
        sorcerySpeed: true,
        targets: [{ type: 'creature' }],
        effect: [{ op: 'explore', to: 'target0' }]
      }
    ]
  },
  'Cleansing Wildfire': {
    spell: {
      targets: [{ type: 'land' }],
      effect: [
        { op: 'search', by: 'target0', filter: { supertype: 'Basic', type: 'Land' }, to: 'battlefield', tapped: true },
        { op: 'destroy', to: 'target0' },
        { op: 'draw', amount: 1 }
      ]
    }
  },
  'Go for the Throat': {
    spell: { targets: [{ type: 'creature', exclude: ['Artifact'] }], effect: [{ op: 'destroy', to: 'target0' }] }
  },
  'Cast Down': {
    spell: { targets: [{ type: 'creature', excludeSuper: ['Legendary'] }], effect: [{ op: 'destroy', to: 'target0' }] }
  },
  'Toxin Analysis': {
    spell: {
      targets: [{ type: 'creature' }],
      effect: [
        { op: 'grantKeyword', to: 'target0', keyword: 'Deathtouch', duration: 'eot' },
        { op: 'grantKeyword', to: 'target0', keyword: 'Lifelink', duration: 'eot' },
        { op: 'createToken', count: 1, token: { name: 'Clue', types: ['Artifact'], colors: [] } } // Investigate
      ]
    }
  },
  "Eviscerator's Insight": {
    spell: { additionalCost: { sacrifice: { types: ['Artifact', 'Creature'] } }, effect: [{ op: 'draw', amount: 2 }] },
    flashback: { cost: '{4}{B}' }
  },
  'Pulse of Murasa': {
    spell: {
      effect: [
        { op: 'returnFromGraveyard', filter: { types: ['Creature', 'Land'] } },
        { op: 'gainLife', amount: 6 }
      ]
    }
  },
  // Nonbasic lands: colors they tap for (+ enters-tapped for the bridges/filter).
  'Vault of Whispers': { mana: ['B'] },
  'Seat of the Synod': { mana: ['U'] },
  'Great Furnace': { mana: ['R'] },
  'Drossforge Bridge': { mana: ['B', 'R'], entersTapped: true },
  'Slagwoods Bridge': { mana: ['R', 'G'], entersTapped: true },
  'Silverbluff Bridge': { mana: ['U', 'R'], entersTapped: true },
  'Mistvault Bridge': { mana: ['U', 'B'], entersTapped: true },
  'Twisted Landscape': { mana: ['C'], entersTapped: true },
  // Planeswalker: loyalty abilities are activated abilities with a loyalty cost.
  'Chandra Nalaar': {
    activated: [
      {
        loyalty: 1,
        targets: [{ type: 'any' }],
        effect: [{ op: 'dealDamage', amount: 1, to: 'target0' }]
      },
      {
        loyalty: -3,
        targets: [{ type: 'creature' }],
        effect: [{ op: 'dealDamage', amount: 4, to: 'target0' }]
      }
    ]
  },

  // ---- Mono-Red Madness (Pauper) ----
  // "Whenever you cast an instant or sorcery, deal 2 to each opponent."
  Guttersnipe: {
    triggered: [
      {
        trigger: { event: 'castSpell', filter: { controller: 'you', types: ['Instant', 'Sorcery'] } },
        effect: [{ op: 'dealDamageEachOpponent', amount: 2 }]
      }
    ]
  },
  // ETB: 1 damage to each opponent + a Blood token.
  'Voldaren Epicure': {
    triggered: [
      {
        trigger: { event: 'etb', self: true },
        effect: [
          { op: 'dealDamageEachOpponent', amount: 1 },
          { op: 'createToken', count: 1, token: { name: 'Blood', types: ['Artifact'], colors: [] } }
        ]
      }
    ]
  },
  // ETB: may discard a card; if you do, draw two. {3}, Sac: make a tapped 2/2 Robot.
  'Melded Moxite': {
    triggered: [
      {
        trigger: { event: 'etb', self: true },
        effect: [{ op: 'discard', amount: 1, optional: true, draw: 2 }]
      }
    ],
    activated: [
      {
        cost: { mana: '{3}', sacrifice: 'self' },
        effect: [
          {
            op: 'createToken',
            count: 1,
            token: { name: 'Robot', types: ['Creature'], subtypes: ['Robot'], colors: [], power: 2, toughness: 2, tapped: true }
          }
        ]
      }
    ]
  },
  // Alternative cost: sacrifice two Mountains instead of paying mana. 4 to any target.
  Fireblast: {
    spell: {
      targets: [{ type: 'any' }],
      alternativeCost: { sacrifice: { subtype: 'Mountain', count: 2 }, label: 'sac 2 Mountains' },
      effect: [{ op: 'dealDamage', amount: 4, to: 'target0' }]
    }
  },
  // 1 to any target; Flashback—Sacrifice a Mountain.
  'Lava Dart': {
    spell: { targets: [{ type: 'any' }], effect: [{ op: 'dealDamage', amount: 1, to: 'target0' }] },
    flashback: { sacrifice: { subtype: 'Mountain', count: 1 }, label: 'sac a Mountain' }
  },
  // Additional cost: discard a card (paid at cast time — a discarded madness card
  // is still offered). Draw two; if the discard wasn't a land, 2 to each opponent.
  'Grab the Prize': {
    spell: {
      additionalCost: { discard: 1 },
      effect: [
        { op: 'draw', amount: 2 },
        { op: 'dealDamageEachOpponent', amount: 2, condition: 'discardedNonland' }
      ]
    }
  },
  // "You may discard a card or sacrifice a land. If you do, draw two." Plot {1}{R}.
  'Highway Robbery': {
    spell: { effect: [{ op: 'discard', amount: 1, optional: true, draw: 2, orSacrificeLand: true }] },
    plot: { cost: '{1}{R}' }
  },
  // ---- Storm (702.40): copy the spell for each other spell cast before it this turn ----
  Grapeshot: {
    spell: { targets: [{ type: 'any' }], effect: [{ op: 'dealDamage', amount: 1, to: 'target0' }] },
    triggered: [{ trigger: { event: 'castSpell', self: true }, effect: [{ op: 'stormCopy' }] }]
  },
  'Empty the Warrens': {
    spell: {
      effect: [
        {
          op: 'createToken',
          count: 2,
          token: { name: 'Goblin', types: ['Creature'], subtypes: ['Goblin'], colors: ['R'], power: 1, toughness: 1 }
        }
      ]
    },
    triggered: [{ trigger: { event: 'castSpell', self: true }, effect: [{ op: 'stormCopy' }] }]
  },
  'Weather the Storm': {
    spell: { effect: [{ op: 'gainLife', amount: 3 }] },
    triggered: [{ trigger: { event: 'castSpell', self: true }, effect: [{ op: 'stormCopy' }] }]
  },
  // Tempo bounce: return target creature to its owner's hand, then untap up to two
  // lands you control (a free spell if the untap pays for itself).
  Snap: {
    spell: {
      targets: [{ type: 'creature' }],
      effect: [
        { op: 'bounce', to: 'target0' },
        { op: 'untapLands', amount: 2 }
      ]
    }
  },
  // Flash flyer; ETB counters a spell with mana value <= the number of Faeries
  // you control (counted on resolution; fizzles if the target's MV is too high).
  'Spellstutter Sprite': {
    triggered: [
      {
        trigger: { event: 'etb', self: true },
        targets: [{ type: 'spell' }],
        effect: [{ op: 'counter', to: 'target0', maxMv: 'faeries' }]
      }
    ]
  },
  // ---- Ninjutsu (702.49): swap an unblocked attacker for this from hand ----
  'Ninja of the Deep Hours': {
    ninjutsu: { cost: '{1}{U}' },
    triggered: [
      { trigger: { event: 'dealsCombatDamageToPlayer', self: true }, effect: [{ op: 'draw', amount: 1 }] }
    ]
  },
  // Regeneration: "{B}: Regenerate this creature." Sets up a shield (615.4) that
  // replaces the next destruction this turn.
  'Drudge Skeletons': {
    activated: [{ cost: { mana: '{B}' }, effect: [{ op: 'regenerate', to: 'self' }] }]
  },
  // Copy a spell on the stack (707.10): the copy shares targets and ceases to exist.
  Twincast: {
    spell: { targets: [{ type: 'spell' }], effect: [{ op: 'copySpell', to: 'target0' }] }
  },
  // Token that's a copy of a permanent (707.2): "a copy of target creature you control."
  'Cackling Counterpart': {
    spell: { targets: [{ type: 'creature', controller: 'you' }], effect: [{ op: 'createTokenCopy', to: 'target0' }] },
    flashback: { cost: '{5}{U}{U}' }
  },
  // Divided / variable-count targeting (601.2c-d): "2 damage divided as you choose
  // among one or two targets." One variadic slot (min/max) carries the division.
  'Forked Bolt': {
    spell: {
      targets: [{ type: 'any', min: 1, max: 2, divide: 2 }],
      effect: [{ op: 'dealDamageDivided' }]
    }
  },
  // Recursion: when you draw your third card in a turn, return this from your
  // graveyard to the battlefield tapped. (It's never hard-cast in mono-red.)
  'Sneaky Snacker': { returnOnThirdDraw: true },
  // Blood token: {1}, {T}, Discard a card, Sacrifice: draw a card. (Discard modelled
  // as part of the effect, so it still enables madness.)
  Blood: {
    activated: [
      {
        cost: { mana: '{1}', tap: true, sacrifice: 'self' },
        effect: [{ op: 'discard', amount: 1 }, { op: 'draw', amount: 1 }]
      }
    ]
  }
}

// The loader merges layers of authority for one card, in the plan's order:
//   Scryfall-derived defaults → keyword expansion → behaviors row → code impl.
// M0 only has the declarative layer; keyword expansion and the JS escape hatch
// (impl:"oracle:<id>") arrive with later milestones.
export function loadBehavior(printed) {
  const authored = BEHAVIORS[printed.name] || {}
  const triggered = [...(authored.triggered || [])]

  // Keyword expansion: Prowess is derived from the keyword line.
  if ((printed.keywords || []).includes('Prowess')) {
    triggered.push({
      trigger: { event: 'castSpell', filter: { controller: 'you', noncreature: true } },
      effect: [{ op: 'pump', to: 'self', power: 1, toughness: 1, duration: 'eot' }]
    })
  }

  // Ward (702.21): parse its cost from the oracle text, since Scryfall's keyword
  // list carries only "Ward", not the cost. Supports "Ward {N}" (a mana cost) and
  // "Ward—Pay N life". The engine fires it in _checkWard when an opponent targets
  // this permanent.
  const ward = authored.ward || parseWard(printed.oracleText || '')

  return {
    spell: authored.spell || null,
    activated: authored.activated || [],
    triggered,
    static: authored.static || [],
    replacement: authored.replacement || [], // replacement effects (rule 614): { event, filter?, apply }
    entersWith: authored.entersWith || null,
    enchant: authored.enchant || null, // Aura: what it can be attached to
    flashback: authored.flashback || null, // { cost } — cast from the graveyard
    madness: authored.madness || null, // { cost } — cast when discarded
    mana: authored.mana || null, // colors a land can tap for, e.g. ['B','R']
    entersTapped: authored.entersTapped || false,
    omen: authored.omen || null, // alternate castable half (Omen/adventure) -> shuffles back
    returnOnThirdDraw: authored.returnOnThirdDraw || false, // Sneaky Snacker-style recursion
    ninjutsu: authored.ninjutsu || null, // { cost } — swap in for an unblocked attacker
    plot: authored.plot || null, // { cost } — exile from hand, cast free on a later turn
    bestow: authored.bestow || null, // { cost } — alternate cast as an Aura (702.103)
    copyOnEnter: authored.copyOnEnter || null, // { except? } — "enter as a copy of…" (rule 614.12, layer 1)
    cda: authored.cda || null, // { count } — characteristic-defining P/T (rule 613 layer 7a)
    staticRules: authored.staticRules || [], // rule-modifying statics (613.11): restrict / costMod
    ward: ward // { mana } or { life } — counter an opponent's spell/ability unless paid (702.21)
  }
}

// Parse a Ward cost out of oracle text: "Ward {2}" -> { mana: '{2}' }, and
// "Ward—Pay 2 life." -> { life: 2 }. Returns null when the card has no ward.
function parseWard(text) {
  const life = text.match(/ward\s*[—-]\s*pay (\d+) life/i)
  if (life) return { life: Number(life[1]) }
  const mana = text.match(/ward\s*(\{[^}]+\})/i)
  if (mana) return { mana: mana[1].replace(/\s+/g, '') }
  return null
}

const BASIC_MANA = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }

// The colors a permanent can tap for as a mana ability (no stack). An array so
// dual/any lands work. Covers basic lands (by subtype), authored land mana
// (behavior.mana), and creature {T} mana abilities. Empty if none.
export function manaAbilityColors(obj) {
  const p = obj.printed
  const out = []
  if (p.types.includes('Land')) {
    for (const sub of p.subtypes) if (BASIC_MANA[sub]) out.push(BASIC_MANA[sub]) // basic land types
    for (const c of obj.behavior?.mana || []) out.push(c) // authored nonbasic mana
  }
  for (const a of obj.behavior?.activated || []) {
    if (a.manaAbility && a.cost?.tap) {
      const add = a.effect.find((e) => e.op === 'addMana')
      if (add) out.push(add.mana)
    }
  }
  return [...new Set(out)]
}
