// An ability a card only has while it is in the graveyard, driven end to end.
// Cauldron Familiar is the one that prompted this: it is an activated ability
// rather than a way of casting the card, so it needs its own path through both
// the engine and the interface.
// Run: node src/shared/engine/graveyard-abilities.test.mjs
import { makeEngine, put, refresh, inZone } from './_testutil.mjs'
import { makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

const grave = (e) => e.pending.actions?.filter((a) => a.type === 'activate' && a.fromGraveyard) || []

section('Cauldron Familiar returns itself by eating a Food')
{
  const e = makeEngine()
  const cat = put(e, 0, 'Cauldron Familiar', 'graveyard')
  assert(grave(e).length === 0, 'with no Food, the ability is not offered')

  const food = put(e, 0, 'Nutrient Block', 'battlefield')
  refresh(e)
  const [act] = grave(e)
  assert(!!act, 'with a Food on the battlefield, it is')
  assert(act.oid === cat.oid, 'and it belongs to the card in the graveyard')

  const lifeBefore = e.state.players[0].life
  const oppBefore = e.state.players[1].life
  e.choose(act)
  let guard = 0
  while (e.pending?.kind === 'priority' && guard++ < 20) e.choose({ type: 'pass' })

  assert(inZone(e, 0, 'battlefield', cat.oid), 'the cat comes back to the battlefield')
  assert(!inZone(e, 0, 'graveyard', cat.oid), 'and is no longer in the graveyard')
  assert(!inZone(e, 0, 'battlefield', food.oid), 'the Food was sacrificed')
  assert(e.state.players[0].life === lifeBefore + 1, 'its enter trigger gained you a life')
  assert(e.state.players[1].life === oppBefore - 1, 'and cost the opponent one')
}

section('Someone else\'s graveyard is not yours to use')
{
  const e = makeEngine()
  put(e, 1, 'Cauldron Familiar', 'graveyard')
  put(e, 0, 'Nutrient Block', 'battlefield')
  refresh(e)
  assert(grave(e).length === 0, 'the opponent\'s cat is not offered to you')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
