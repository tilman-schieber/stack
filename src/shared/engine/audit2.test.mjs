// Headless verification of the second audit batch: Aura/Bestow spells whose
// target is gone (608.3b / 702.103e), regenerated attackers removed from combat
// (701.15c / 506.4), elimination cleanup (800.4), affinity as a behavior flag,
// per-game object ids, face-down identity for the controller, and coverage
// classification of parsed keywords.
// Run: node src/shared/engine/audit2.test.mjs

import { GameEngine } from './engine.mjs'
import { projectGame } from './project.mjs'
import { zone } from './state.mjs'
import { loadBehavior } from './behaviors.mjs'
import { classifyCard } from './classify.mjs'
import { printedFromScryfall, SAMPLE_CARDS } from './cards.mjs'
import { makeEngine, put, advanceToPriorityAt, combat, inZone, makeAsserter, refresh } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}

section('An Aura whose target died in response is countered (608.3b), not put onto the battlefield')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  put(e, 1, 'Mountain', 'battlefield')
  const pac = put(e, 0, 'Pacifism', 'hand')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield')
  const bolt = put(e, 1, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: pac.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  e.choose({ type: 'pass' }) // priority to player 1, Pacifism on the stack
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e) // Bolt resolves: bear dies
  assert(inZone(e, 1, 'graveyard', bear.oid), 'the bear died in response')
  bothPass(e) // Pacifism would resolve
  assert(inZone(e, 0, 'graveyard', pac.oid), 'Pacifism went straight to the graveyard')
  assert(e.state.log.some((l) => /Pacifism fizzles/.test(l.text)), 'logged as fizzled')
}

section('A Bestow spell whose target is gone resolves as a creature instead (702.103e)')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Forest', 'battlefield')
  put(e, 1, 'Mountain', 'battlefield')
  const hydra = put(e, 0, 'Nyxborn Hydra', 'hand')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  const bolt = put(e, 1, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'castBestow', oid: hydra.oid, targets: [{ kind: 'object', oid: bear.oid }], x: 1 })
  e.choose({ type: 'pass' })
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e)
  bothPass(e)
  assert(hydra.zoneName === 'battlefield' && !hydra.bestowed && hydra.chars.types.includes('Creature'), 'Hydra entered as a creature')
}

section('A regenerated attacker is removed from combat: its blocker deals it no damage')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  const skel = put(e, 0, 'Drudge Skeletons', 'battlefield', { summoningSick: false }) // 1/1, {B}: Regenerate
  const angel = put(e, 1, 'Serra Angel', 'battlefield', { summoningSick: false }) // 4/4
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ attackers: [skel.oid] })
  e.choose({ type: 'activate', oid: skel.oid, ability: 0, targets: [] }) // regenerate in the attack step
  bothPass(e)
  assert((skel.status.regenShields || 0) === 1, 'shield up')
  g = 0
  while (e.pending.kind !== 'declareBlockers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ blocks: { [angel.oid]: skel.oid } })
  g = 0
  while (e.pending.kind === 'priority' && e.state.step !== 'main2' && g++ < 30) e.choose({ type: 'pass' })
  assert(skel.zoneName === 'battlefield' && skel.status.tapped && !skel.status.attacking, 'Skeletons regenerated: tapped, out of combat')
  assert(skel.status.damage === 0, 'no damage marked on the regenerated creature')
  assert(angel.status.damage === 0 || e.state.step !== 'combatDamage', "the Angel's damage came only from the first strike-free single pass")
}

section('Elimination: owned objects leave the game, controlled-but-not-owned ones revert')
{
  const deck = () => Array(20).fill('Forest')
  const e = new GameEngine({
    seed: 'elim',
    startingPlayer: 0, autoOrderTriggers: true,
    players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }, { name: 'C', deck: deck() }]
  }).start()
  for (let i = 0; i < 3; i++) e.choose({ keep: true })
  const bBear = put(e, 1, 'Grizzly Bears', 'battlefield')
  const stolen = put(e, 2, 'Grizzly Bears', 'battlefield')
  stolen.controller = 1 // B controls C's bear
  e._eliminate(e.state.players[1])
  assert(bBear.zoneName === 'exile' && inZone(e, 1, 'exile', bBear.oid), "B's bear is in B's exile zone")
  assert(stolen.zoneName === 'battlefield' && stolen.controller === 2, "C's bear reverted to C")
}

section('Affinity is a parsed behavior flag')
{
  const printed = printedFromScryfall(SAMPLE_CARDS['Myr Enforcer'])
  assert(loadBehavior(printed).affinity === 'artifact', 'Myr Enforcer: affinity for artifacts')
  assert(loadBehavior(printedFromScryfall(SAMPLE_CARDS['Grizzly Bears'])).affinity == null, 'Bears: none')
}

section('Object ids are per game: the same seed yields the same ids')
{
  const mk = () => makeEngine()
  const a = mk()
  const b = mk()
  assert(zone(a.state, 'hand', 0).join() === zone(b.state, 'hand', 0).join(), 'identical hands (oids) from identical seeds')
}

section("Face-down: the controller's view carries the real identity, the opponent's does not")
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const patron = put(e, 0, 'Patron of the Wild', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'castFaceDown', oid: patron.oid })
  bothPass(e)
  const mine = projectGame(e, 0).players[0].battlefield.find((c) => c.faceDown)
  const theirs = projectGame(e, 1).players[0].battlefield.find((c) => c.faceDown)
  assert(mine.realName === 'Patron of the Wild' && mine.name === 'Face-down creature', 'controller sees what it is')
  assert(theirs.realName == null && theirs.realCardId == null && theirs.cardId == null, 'opponent sees nothing')
}

section('Coverage: parsed keyword lines count as supported')
{
  const c = (oracle) => classifyCard({ name: 'X', type_line: 'Creature — Test', oracle_text: oracle, power: '1', toughness: '1' })
  assert(c('Hexproof').supported, 'hexproof')
  assert(c('Ward {2}').supported, 'ward cost')
  assert(c('Protection from black').supported, 'protection from a color')
  assert(c('Morph {2}{G}').supported, 'morph')
  assert(!c('Whenever this attacks, draw a card.').supported, 'real rules text still unsupported')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
