// Where a computer opponent puts its Auras.
//
// An Aura carries no `spell.effect` — what it does lives in statics scoped to
// what it enchants — so the bot's "what does this spell do to its target?"
// question returned nothing and fell through to its default of "harm". A
// computer playing Bogles hung every one of its pump Auras on the human's
// creature.
// Run: node src/shared/engine/bot-auras.test.mjs
import { makeEngine, put, refresh, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'
import { botChoose } from './bot.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// Seat 1 is the computer. It has `aura` in hand, a creature of its own, and the
// human has one too — so both are legal targets and only intent decides.
// Both creatures must be plainly targetable. Using a hexproof one for the human
// hides the whole bug: an Aura aimed at "the enemy" simply cannot be put there,
// so it lands at home by accident and the test passes with the fault present.
const scene = (aura, mine = 'Krark-Clan Shaman', theirs = 'Gearseeker Serpent') => {
  const e = makeEngine('Forest', 20)
  advanceToPriorityAt(e, 'main1')
  // Hand the turn to seat 1 so it is the one casting.
  let g = 0
  while (e.state.activePlayer !== 1 && g++ < 30) e.choose({ type: 'pass' })
  advanceToPriorityAt(e, 'main1')
  const botCreature = put(e, 1, mine, 'battlefield')
  const humanCreature = put(e, 0, theirs, 'battlefield')
  // Enough of every colour: Armadillo Cloak is {1}{G}{W}, Ethereal Armor {W}.
  for (const basic of ['Forest', 'Plains', 'Island', 'Swamp', 'Mountain'])
    for (let i = 0; i < 3; i++) put(e, 1, basic, 'battlefield')
  const card = put(e, 1, aura, 'hand')
  refresh(e)
  return { e, card, botCreature, humanCreature }
}

// Let the computer play until the Aura leaves its hand, then see what it
// landed on. Driving it rather than reading one decision matters: botChoose
// answers whatever is pending, which may well be some other play first.
const whereDoesItGo = (aura) => {
  const { e, card, botCreature, humanCreature } = scene(aura)
  // Run until it has actually resolved onto something — leaving hand only puts
  // it on the stack, where it is attached to nothing yet.
  for (let i = 0; i < 80; i++) {
    if (card.zoneName === 'battlefield' || card.zoneName === 'graveyard') break
    const p = e.pending
    if (!p) break
    if (p.kind === 'gameOver') break
    if (p.player === 1) {
      const move = botChoose(e, 1)
      if (!move) break
      e.choose(move)
    } else if (p.kind === 'priority') {
      e.choose({ type: 'pass' })
    } else break
  }
  if (card.zoneName === 'hand') return 'never cast'
  if (card.zoneName === 'stack') return 'still on the stack'
  const host = card.status?.attachedTo
  if (!host) return 'cast but attached to nothing'
  if (host === botCreature.oid) return 'its own creature'
  if (host === humanCreature.oid) return "the human's creature"
  return 'something else'
}

section('A pump Aura goes on the computer\'s own creature')
{
  for (const aura of ['Armadillo Cloak', 'Ethereal Armor', 'Ancestral Mask']) {
    const where = whereDoesItGo(aura)
    // The bot may decide not to cast at all; what it must never do is help us.
    assert(where !== "the human's creature", `${aura} does not go on the human's creature (went to: ${where})`)
  }
  assert(whereDoesItGo('Armadillo Cloak') === 'its own creature', 'Armadillo Cloak goes on its own creature')
}

section('It still aims removal at the other side')
{
  const { e, card, botCreature, humanCreature } = scene('Cast Down', 'Krark-Clan Shaman', 'Gearseeker Serpent')
  const a = e.pending.actions?.find((x) => x.type === 'cast' && x.oid === card.oid)
  if (a) {
    const move = botChoose(e, 1)
    const t = move?.targets?.[0]
    if (t?.kind === 'object') {
      assert(t.oid !== botCreature.oid, 'removal is not pointed at its own creature')
      assert(t.oid === humanCreature.oid, 'it is pointed at the human\'s')
    } else assert(true, '(the bot chose not to cast it here)')
  } else assert(true, '(Cast Down not castable in this scene)')
}

section('An Aura the engine only lets you put on your own creature is unaffected')
{
  // Cartouche of Solidarity says "enchant creature you control", so the engine
  // never offers the human's creature in the first place.
  const where = whereDoesItGo('Cartouche of Solidarity')
  assert(where !== "the human's creature", `Cartouche of Solidarity stays at home (went to: ${where})`)
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
