// Constants and helpers shared by engine.mjs and its subsystem files.

// Step order (rules 500–514). First strike is folded into a single combat-damage
// step for M0 (no keywords yet). Priority is granted in PRIORITY_STEPS only.
export const STEP_ORDER = [
  'untap',
  'upkeep',
  'draw',
  'main1',
  'beginCombat',
  'declareAttackers',
  'declareBlockers',
  'combatDamage',
  'endCombat',
  'main2',
  'end',
  'cleanup'
]
export const PRIORITY_STEPS = new Set([
  'upkeep',
  'draw',
  'main1',
  'beginCombat',
  'declareAttackers',
  'declareBlockers',
  'combatDamage',
  'endCombat',
  'main2',
  'end'
])
export const MAIN_STEPS = new Set(['main1', 'main2'])

// What a source "is" for protection purposes (702.16): its colours and its types,
// matched against a permanent's `protections` list ('B', 'Creature', 'everything').
export const tags = (c) => (c ? [...(c.colors || []), ...(c.types || [])] : [])

// Sum two parsed mana costs (a spell's cost plus a kicker cost, …).
export function addCosts(a, b) {
  const out = { ...a }
  for (const k of ['W', 'U', 'B', 'R', 'G', 'C', 'generic', 'X']) if (b[k]) out[k] = (out[k] || 0) + b[k]
  for (const k of ['hybrid', 'phyrexian', 'twobrid']) if (b[k]) out[k] = [...(out[k] || []), ...b[k]]
  return out
}
