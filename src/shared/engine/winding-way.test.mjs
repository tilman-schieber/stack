// Winding Way names its type before anything is revealed.
//
// "Choose creature or land. Reveal the top four cards of your library. Put all
// cards of the chosen type revealed this way into your hand and the rest into
// your graveyard." Choosing after seeing the four is a different and much
// better card, and it is what the engine used to do.
// Run: node src/shared/engine/winding-way.test.mjs
import { makeEngine, put, refresh, advanceToPriorityAt, inZone, makeAsserter } from './_testutil.mjs'
import { zoneKey } from './state.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const logOf = (e) => e.state.log.map((l) => l.text).join('\n')

// A library whose top four are known, so the outcome can be checked exactly.
const scene = (topNames) => {
  const e = makeEngine('Forest', 30)
  advanceToPriorityAt(e, 'main1')
  for (let i = 0; i < 3; i++) put(e, 0, 'Forest', 'battlefield')
  const way = put(e, 0, 'Winding Way', 'hand')
  // Stack the named cards on top, in order.
  const lib = e.state.zones[zoneKey('library', 0)]
  const stacked = topNames.map((n) => put(e, 0, n, 'library'))
  for (const o of stacked) {
    const at = lib.indexOf(o.oid)
    if (at >= 0) lib.splice(at, 1)
  }
  lib.unshift(...stacked.map((o) => o.oid))
  refresh(e)
  return { e, way, stacked }
}

section('The choice comes first, with nothing revealed yet')
{
  const { e, way, stacked } = scene(['Krark-Clan Shaman', 'Forest', 'Forest', 'Krark-Clan Shaman'])
  e.choose({ type: 'cast', oid: way.oid, targets: [] })
  let g = 0
  while (e.pending?.kind === 'priority' && g++ < 8) e.choose({ type: 'pass' })

  assert(e.pending?.kind === 'chooseTopType', 'the type is asked for as its own step')
  assert(e.pending.options.join('/') === 'Creature/Land', 'creature or land')
  assert(!e.pending.cards, 'and no cards come with the question')
  const before = logOf(e)
  assert(!/reveals/.test(before), 'nothing has been revealed yet')
  for (const o of stacked) assert(!new RegExp(o.printed.name).test(before.split('casts Winding Way')[1] || ''), `${o.printed.name} has not been named`)
}

section('Choosing land takes the lands, and the rest go to the graveyard')
{
  const { e, way, stacked } = scene(['Krark-Clan Shaman', 'Forest', 'Forest', 'Krark-Clan Shaman'])
  e.choose({ type: 'cast', oid: way.oid, targets: [] })
  let g = 0
  while (e.pending?.kind === 'priority' && g++ < 8) e.choose({ type: 'pass' })
  e.choose({ type: 'Land' })
  const log = logOf(e)
  assert(/reveals/.test(log), 'the reveal happens after the choice')
  assert(log.indexOf('chooses land') < log.indexOf('reveals'), 'and in that order in the log')
  const [c1, l1, l2, c2] = stacked
  assert(inZone(e, 0, 'hand', l1.oid) && inZone(e, 0, 'hand', l2.oid), 'both lands went to hand')
  assert(inZone(e, 0, 'graveyard', c1.oid) && inZone(e, 0, 'graveyard', c2.oid), 'both creatures went to the graveyard')
}

section('Choosing creature takes the creatures instead')
{
  const { e, way, stacked } = scene(['Krark-Clan Shaman', 'Forest', 'Forest', 'Krark-Clan Shaman'])
  e.choose({ type: 'cast', oid: way.oid, targets: [] })
  let g = 0
  while (e.pending?.kind === 'priority' && g++ < 8) e.choose({ type: 'pass' })
  e.choose({ type: 'Creature' })
  const [c1, l1, l2, c2] = stacked
  assert(inZone(e, 0, 'hand', c1.oid) && inZone(e, 0, 'hand', c2.oid), 'both creatures went to hand')
  assert(inZone(e, 0, 'graveyard', l1.oid) && inZone(e, 0, 'graveyard', l2.oid), 'both lands went to the graveyard')
}

section('A type that is not on offer is refused')
{
  const { e, way } = scene(['Forest', 'Forest', 'Forest', 'Forest'])
  e.choose({ type: 'cast', oid: way.oid, targets: [] })
  let g = 0
  while (e.pending?.kind === 'priority' && g++ < 8) e.choose({ type: 'pass' })
  let err = null
  try {
    e.choose({ type: 'Artifact' })
  } catch (x) {
    err = x.message
  }
  assert(/choose Creature or Land/.test(err || ''), `naming a third type is refused (${err})`)
  assert(e.pending.kind === 'chooseTopType', 'and the question is still standing')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
