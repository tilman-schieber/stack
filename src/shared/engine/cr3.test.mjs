// Headless verification, CR gap analysis batch 3:
//   509.1b evasion — fear, intimidate, skulk, shadow, landwalk, "can't be blocked"
//   508.1d / 509.1c attack and block requirements
//   704.5c poison; 702.90 infect, 702.80 wither, 702.180 toxic; energy; proliferate
// Run: node src/shared/engine/cr3.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, advanceToPriorityAt, combat, inZone, makeAsserter, refresh } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// Can `blocker` (player 1's) block `attacker` (player 0's) — via the engine's own check.
const canBlock = (e, blocker, attacker) => {
  recompute(e.state)
  return e._canBlock(blocker, attacker)
}
const grant = (e, o, kw) => e.state.continuous.push({ timestamp: ++e.state.tsCounter, targets: [o.oid], grantKeywords: [kw], duration: 'permanent' })

section('Fear: only artifact and/or black creatures may block')
{
  const e = makeEngine()
  const atk = put(e, 0, 'Grizzly Bears', 'battlefield')
  grant(e, atk, 'Fear')
  const green = put(e, 1, 'Grizzly Bears', 'battlefield')
  const black = put(e, 1, 'Typhoid Rats', 'battlefield')
  const artifact = put(e, 1, 'Myr Enforcer', 'battlefield')
  assert(!canBlock(e, green, atk), 'a green creature cannot block')
  assert(canBlock(e, black, atk), 'a black creature can')
  assert(canBlock(e, artifact, atk), 'an artifact creature can')
}

section('Intimidate: artifact creatures and creatures sharing a colour')
{
  const e = makeEngine()
  const zealot = put(e, 0, 'Blind Zealot', 'battlefield')
  const green = put(e, 1, 'Grizzly Bears', 'battlefield')
  const black = put(e, 1, 'Typhoid Rats', 'battlefield')
  assert(!canBlock(e, green, zealot) && canBlock(e, black, zealot), 'green no, black yes')
}

section('Skulk, shadow, landwalk, "can\'t be blocked", "can\'t block"')
{
  const e = makeEngine()
  const cut = put(e, 0, 'Vampire Cutthroat', 'battlefield') // 1/1 skulk
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield') // 2/2
  const rats = put(e, 1, 'Typhoid Rats', 'battlefield') // 1/1
  assert(!canBlock(e, bear, cut) && canBlock(e, rats, cut), 'skulk: greater power cannot block, equal can')
  const slayer = put(e, 0, 'Dauthi Slayer', 'battlefield')
  assert(!canBlock(e, bear, slayer), 'shadow: a non-shadow creature cannot block it')
  const wraith = put(e, 0, 'Bog Wraith', 'battlefield')
  assert(canBlock(e, bear, wraith), 'swampwalk: blockable while the defender has no Swamp')
  put(e, 1, 'Swamp', 'battlefield')
  assert(!canBlock(e, bear, wraith), '…unblockable once they control a Swamp')
  const soul = put(e, 0, 'Tormented Soul', 'battlefield')
  assert(!canBlock(e, bear, soul), "Tormented Soul can't be blocked")
  const soul2 = put(e, 1, 'Tormented Soul', 'battlefield')
  assert(!e._eligibleBlockers(1).includes(soul2.oid), "…and can't block")
}

section('508.1d: "attacks each combat if able" is enforced; 509.1c block requirements too')
{
  const e = makeEngine()
  const slayer = put(e, 0, 'Dauthi Slayer', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
  let threw = false
  try {
    e.choose({ attackers: [] })
  } catch (err) {
    threw = /must attack/.test(err.message)
  }
  assert(threw, 'declaring no attackers is rejected while Dauthi Slayer can attack')
  e.choose({ attackers: [slayer.oid] })
  assert(slayer.status.attacking, 'it attacks')

  const f = makeEngine()
  const boss = put(f, 0, 'Goblin Rabblemaster', 'battlefield', { summoningSick: false })
  f._createToken({ name: 'Goblin', types: ['Creature'], subtypes: ['Goblin'], colors: ['R'], power: 1, toughness: 1, keywords: ['Haste'] }, 0)
  const tok = zone(f.state, 'battlefield').map((o) => f.state.objects[o]).find((o) => o.token)
  advanceToPriorityAt(f, 'main1')
  g = 0
  while (f.pending.kind !== 'declareAttackers' && g++ < 30) f.choose({ type: 'pass' })
  assert(zone(f.state, 'battlefield').filter((o) => f.state.objects[o].token).length === 2, 'Rabblemaster made a second Goblin at the beginning of combat')
  threw = false
  try {
    f.choose({ attackers: [boss.oid] })
  } catch (err) {
    threw = /must attack/.test(err.message)
  }
  assert(threw, 'the other Goblins must attack (Rabblemaster itself need not)')
  const goblins = f.pending.eligible.filter((o) => o !== boss.oid)
  f.choose({ attackers: goblins })
  assert(goblins.length === 2 && f.state.objects[tok.oid].status.attacking, 'both Goblin tokens attack')
}

section('Infect: poison to players, -1/-1 counters to creatures; ten poison loses')
{
  const e = makeEngine()
  const stinger = put(e, 0, 'Plague Stinger', 'battlefield', { summoningSick: false })
  combat(e, [stinger.oid])
  assert(e.state.players[1].life === 20 && e.state.players[1].counters.poison === 1, '1 poison counter, no life lost')
  const f = makeEngine()
  const stinger2 = put(f, 0, 'Plague Stinger', 'battlefield', { summoningSick: false })
  const angel = put(f, 1, 'Serra Angel', 'battlefield', { summoningSick: false })
  combat(f, [stinger2.oid], { [angel.oid]: stinger2.oid })
  assert(angel.status.counters['-1/-1'] === 1 && angel.chars.power === 3, 'the blocker got a -1/-1 counter')
  assert(inZone(f, 0, 'graveyard', stinger2.oid), 'the Stinger died to normal damage')
  const g = makeEngine()
  const stinger3 = put(g, 0, 'Plague Stinger', 'battlefield', { summoningSick: false })
  g.state.players[1].counters.poison = 9
  combat(g, [stinger3.oid])
  assert(g.pending.kind === 'gameOver' && g.pending.winner === 0, 'the tenth poison counter loses the game (704.5c)')
}

section('Wither and toxic')
{
  const e = makeEngine()
  const gang = put(e, 0, 'Boggart Ram-Gang', 'battlefield', { summoningSick: false }) // 3/3 wither
  const angel = put(e, 1, 'Serra Angel', 'battlefield', { summoningSick: false })
  combat(e, [gang.oid], { [angel.oid]: gang.oid })
  assert(angel.status.counters['-1/-1'] === 3 && angel.chars.power === 1, 'wither: 4/4 Angel is now 1/1 with counters')
  const f = makeEngine()
  const cont = put(f, 0, 'Bloated Contaminator', 'battlefield', { summoningSick: false }) // 4/4 trample toxic 1
  f.state.players[1].counters.poison = 1
  combat(f, [cont.oid])
  assert(f.state.players[1].life === 16, 'toxic still deals its damage')
  assert(f.state.players[1].counters.poison === 3, '1 + toxic 1 + the proliferate trigger')
}

section('Energy: a player counter paid as a cost')
{
  const e = makeEngine()
  const cub = put(e, 0, 'Longtusk Cub', 'battlefield', { summoningSick: false })
  combat(e, [cub.oid])
  assert(e.state.players[0].counters.energy === 2, 'two energy from combat damage')
  refresh(e)
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === cub.oid)
  assert(!!act, 'Pay {E}{E} offered')
  e.choose({ type: 'activate', oid: cub.oid, ability: 0, targets: [] })
  e.choose({ type: 'pass' })
  e.choose({ type: 'pass' })
  assert(e.state.players[0].counters.energy === 0 && cub.status.counters['+1/+1'] === 1, 'energy spent, counter added')
  refresh(e)
  assert(!e.pending.actions.some((a) => a.type === 'activate' && a.oid === cub.oid), 'not offered without energy')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
