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
    madness: authored.madness || null // { cost } — cast when discarded
  }
}

// A mana ability the engine can tap for a single mana without using the stack.
// Returns the color produced, or null. Covers basic lands (by subtype) and any
// permanent whose behavior declares a manaAbility.
export function manaAbilityColor(obj) {
  const p = obj.printed
  if (p.types.includes('Land') && p.supertypes.includes('Basic')) {
    for (const sub of p.subtypes) {
      const c = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }[sub]
      if (c) return c
    }
  }
  for (const a of obj.behavior?.activated || []) {
    if (a.manaAbility && a.cost?.tap) {
      const add = a.effect.find((e) => e.op === 'addMana')
      if (add) return add.mana
    }
  }
  return null
}
