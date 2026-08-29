// Headless verification, CR gap analysis batch 11:
//   705/706 coin flips and dice; "can't" statics (no life gain, can't be countered,
//   damage can't be prevented, can't cast); 514.3a a repeated cleanup step;
//   704.5j the legend rule as a choice; 702.26 phasing
// Run: node src/shared/engine/cr11.test.mjs

import { GameEngine } from './engine.mjs'
import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, advanceToPriorityAt, keepAll, inZone, makeAsserter, refresh } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
const untilStack = (e) => {
  let g = 0
  while (zone(e.state, 'stack').length && e.pending.kind === 'priority' && g++ < 20) bothPass(e)
}
const drive = (e, pred, max = 150) => {
  let g = 0
  while (!pred() && g++ < max) {
    const k = e.pending.kind
    if (k === 'priority') e.choose({ type: 'pass' })
    else if (k === 'declareAttackers') e.choose({ attackers: [] })
    else if (k === 'declareBlockers') e.choose({ blocks: {} })
    else if (k === 'discard') e.choose({ discard: e.pending.hand.slice(0, e.pending.count) })
    else break
  }
}

section('705/706: coin flips and die rolls are seeded and drive effects')
{
  const e = makeEngine()
  const src = put(e, 0, 'Grizzly Bears', 'battlefield')
  const ab = { controller: 0, sourceOid: src.oid, targets: [] }
  let wins = 0
  for (let i = 0; i < 40; i++) e._runEffects(ab, [{ op: 'flipCoin', win: [{ op: 'gainLife', amount: 1 }], lose: [] }])
  wins = e.state.players[0].life - 20
  assert(wins > 5 && wins < 35, `about half the flips won (${wins}/40)`)
  const f = makeEngine()
  const src2 = put(f, 0, 'Grizzly Bears', 'battlefield')
  const ab2 = { controller: 0, sourceOid: src2.oid, targets: [] }
  f._runEffects(ab2, [{ op: 'rollDie', sides: 6, results: [{ min: 1, max: 6, effect: [{ op: 'gainLife', amount: 1 }] }] }])
  assert(f.state.players[0].life === 21, 'a d6 always lands in 1–6')
  assert(f.state.log.some((l) => /rolls a d6: [1-6]/.test(l.text)), 'the roll is logged')
  const g1 = makeEngine()
  const g2 = makeEngine()
  const rolls = (eng) => {
    const o = put(eng, 0, 'Grizzly Bears', 'battlefield')
    const out = []
    for (let i = 0; i < 5; i++) {
      eng._runEffects({ controller: 0, sourceOid: o.oid, targets: [] }, [{ op: 'rollDie', sides: 20, results: [] }])
      out.push(eng.state.log[eng.state.log.length - 1].text)
    }
    return out.join()
  }
  assert(rolls(g1) === rolls(g2), 'same seed, same rolls (deterministic)')
}

section('"Players can\'t gain life" (Sulfuric Vortex) and its each-upkeep damage')
{
  const e = makeEngine()
  put(e, 0, 'Sulfuric Vortex', 'battlefield')
  put(e, 0, 'Soul Warden', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e._createToken({ name: 'Goblin', types: ['Creature'], colors: ['R'], power: 1, toughness: 1 }, 0)
  e._grantPriorityTo(0)
  untilStack(e)
  assert(e.state.players[0].life === 20, "Soul Warden's gain was replaced by nothing")
  drive(e, () => e.state.activePlayer === 1 && e.state.step === 'main1' && e.pending.kind === 'priority')
  assert(e.state.players[1].life === 18, "Vortex hit B at B's upkeep")
}

section('"Creature spells you control can\'t be countered" / "damage can\'t be prevented" / "can\'t cast" statics')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  put(e, 1, 'Island', 'battlefield')
  put(e, 1, 'Island', 'battlefield')
  const cave = put(e, 0, 'Glorious Anthem', 'battlefield')
  cave.behavior = { ...cave.behavior, static: [], staticRules: [{ spellsCantBeCountered: { type: 'Creature', controller: 'you' } }] }
  const bear = put(e, 0, 'Grizzly Bears', 'hand')
  const cs = put(e, 1, 'Counterspell', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bear.oid })
  e.choose({ type: 'pass' })
  e.choose({ type: 'cast', oid: cs.oid, targets: [{ kind: 'spell', oid: bear.oid }] })
  untilStack(e)
  assert(bear.zoneName === 'battlefield', 'the creature spell could not be countered')

  const f = makeEngine()
  const src = put(f, 0, 'Glorious Anthem', 'battlefield')
  src.behavior = { ...src.behavior, static: [], staticRules: [{ damageCantBePrevented: true }] }
  const knight = put(f, 1, 'White Knight', 'battlefield') // pro black
  const rats = put(f, 0, 'Typhoid Rats', 'battlefield') // black source
  recompute(f.state)
  f._dealDamage(rats, { obj: knight }, 1)
  assert(knight.status.damage === 1, 'protection could not prevent the damage')

  const g = makeEngine()
  put(g, 1, 'Mountain', 'battlefield')
  const lock = put(g, 0, 'Glorious Anthem', 'battlefield')
  lock.behavior = { ...lock.behavior, static: [], staticRules: [{ cantCast: { who: 'opponents', duringYourTurn: true } }] }
  const bolt = put(g, 1, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(g, 'main1')
  g.choose({ type: 'pass' })
  assert(g.pending.player === 1 && !g.pending.actions.some((a) => a.type === 'cast' && a.oid === bolt.oid), "B can't cast on A's turn")
  drive(g, () => g.state.activePlayer === 1 && g.state.step === 'main1' && g.pending.kind === 'priority')
  assert(g.pending.actions.some((a) => a.type === 'cast' && a.oid === bolt.oid), '…but can on their own')
}

section('514.3a: an SBA during cleanup gives priority, then another cleanup')
{
  const e = makeEngine()
  const ball = put(e, 0, 'Walking Ballista', 'battlefield') // 0/0
  e.state.continuous.push({ timestamp: ++e.state.tsCounter, targets: [ball.oid], modifyPT: { power: 1, toughness: 1 }, duration: 'eot', owner: 0 })
  advanceToPriorityAt(e, 'main1')
  recompute(e.state)
  assert(ball.chars.toughness === 1, 'kept alive by an until-end-of-turn pump')
  drive(e, () => e.state.step === 'cleanup' && e.pending.kind === 'priority')
  assert(e.state.step === 'cleanup' && e.pending.kind === 'priority', 'players receive priority during cleanup')
  assert(inZone(e, 0, 'graveyard', ball.oid), '…because the pump wore off and the 0/0 died')
  drive(e, () => e.state.turnNumber === 2 && e.pending.kind === 'priority')
  assert(e.state.turnNumber === 2 && e.state.activePlayer === 1, 'the turn then ended normally')
}

section('704.5j: the legend rule lets the controller choose which to keep')
{
  const deck = () => Array(20).fill('Forest')
  const e = keepAll(new GameEngine({ seed: 'leg', startingPlayer: 0, players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }] }).start())
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  const t1 = put(e, 0, 'Thalia, Guardian of Thraben', 'battlefield')
  const t2 = put(e, 0, 'Thalia, Guardian of Thraben', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: t2.oid })
  bothPass(e)
  assert(e.pending.kind === 'legendChoice' && e.pending.choices.length === 2, 'asked which Thalia to keep')
  e.choose({ keep: t2.oid })
  assert(inZone(e, 0, 'graveyard', t1.oid) && t2.zoneName === 'battlefield', 'kept the new one')
}

section('702.26 phasing: out on your untap step, back the next one, counters intact')
{
  const e = makeEngine()
  const djinn = put(e, 0, 'Breezekeeper', 'battlefield', { counters: { '+1/+1': 1 } })
  advanceToPriorityAt(e, 'main1')
  drive(e, () => e.state.turnNumber === 3 && e.state.activePlayer === 0 && e.pending.kind === 'priority')
  assert(!zone(e.state, 'battlefield').includes(djinn.oid) && djinn.zoneName === 'phasedOut', 'phased out at the start of my next turn')
  assert(e.state.phasedOut.length === 1, 'tracked in state.phasedOut')
  drive(e, () => e.state.turnNumber === 5 && e.state.activePlayer === 0 && e.pending.kind === 'priority')
  assert(zone(e.state, 'battlefield').includes(djinn.oid) && djinn.status.counters['+1/+1'] === 1, 'phased back in with its counter')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
