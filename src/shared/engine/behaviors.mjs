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
    spell: { targets: [{ type: 'creature' }], effect: [{ op: 'destroy', to: 'target0' }] }
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
  // Cast as a creature that enters with X +1/+1 counters. (Bestow — casting it as
  // an Aura for {X}{G}{G} — is not yet modelled; it's played as a creature.)
  'Nyxborn Hydra': {
    entersWith: { counter: '+1/+1', amount: 'X' }
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
        { op: 'createToken', count: 1, token: { name: 'Map', types: ['Artifact'], colors: [] } } // explore ability not modelled
      ]
    }
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
  // Additional cost: discard a card. Draw two; if the discard wasn't a land, 2 to each opponent.
  // (The discard is modelled on resolution rather than as a literal cast cost.)
  'Grab the Prize': {
    spell: {
      effect: [
        { op: 'discard', amount: 1, remember: true },
        { op: 'draw', amount: 2 },
        { op: 'dealDamageEachOpponent', amount: 2, condition: 'discardedNonland' }
      ]
    }
  },
  // "You may discard a card or sacrifice a land. If you do, draw two." Plot {1}{R}.
  // (The sacrifice-a-land alternative is not modelled — played as an optional discard-draw.)
  'Highway Robbery': {
    spell: { effect: [{ op: 'discard', amount: 1, optional: true, draw: 2 }] },
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

  return {
    spell: authored.spell || null,
    activated: authored.activated || [],
    triggered,
    static: authored.static || [],
    entersWith: authored.entersWith || null,
    enchant: authored.enchant || null, // Aura: what it can be attached to
    flashback: authored.flashback || null, // { cost } — cast from the graveyard
    madness: authored.madness || null, // { cost } — cast when discarded
    mana: authored.mana || null, // colors a land can tap for, e.g. ['B','R']
    entersTapped: authored.entersTapped || false,
    omen: authored.omen || null, // alternate castable half (Omen/adventure) -> shuffles back
    returnOnThirdDraw: authored.returnOnThirdDraw || false, // Sneaky Snacker-style recursion
    ninjutsu: authored.ninjutsu || null, // { cost } — swap in for an unblocked attacker
    plot: authored.plot || null // { cost } — exile from hand, cast free on a later turn
  }
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
