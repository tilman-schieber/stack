// Headless verification, CR gap analysis batch 2: split cards (709), modal
// double-faced cards (712.11), and transforming double-faced cards (712 / 701.28).
// Run: node src/shared/engine/cr2.test.mjs

import { zone } from './state.mjs'
import { projectGame } from './project.mjs'
import { classifyCard } from './classify.mjs'
import { SAMPLE_CARDS } from './cards.mjs'
import { makeEngine, put, advanceToPriorityAt, inZone, makeAsserter, refresh } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
const castsFor = (e, oid) => e.pending.actions.filter((a) => a.oid === oid && (a.type === 'cast' || a.type === 'playLand'))

section('709: a split card is both halves in hand, one half on the stack, both again in the graveyard')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const fi = put(e, 0, 'Fire // Ice', 'hand')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield')
  assert(fi.printed.name === 'Fire // Ice' && fi.printed.manaValue === 4, 'in hand: combined name, mana value 4')
  assert(fi.printed.colors.join('') === 'RU' && fi.printed.types.join('') === 'Instant', 'combined colours and types')
  advanceToPriorityAt(e, 'main1')
  const casts = castsFor(e, fi.oid)
  assert(casts.length === 2 && casts.map((a) => a.label).join('|') === 'Cast Fire|Cast Ice', 'both halves offered')
  const ice = casts.find((a) => a.face === 1)
  assert(ice.targets[0].type === 'permanent', 'Ice targets a permanent')
  const handBefore = zone(e.state, 'hand', 0).length
  e.choose({ type: 'cast', oid: fi.oid, face: 1, targets: [{ kind: 'object', oid: bear.oid }] })
  assert(fi.printed.name === 'Ice' && fi.printed.colors.join('') === 'U', 'on the stack it is Ice, blue')
  bothPass(e)
  assert(bear.status.tapped, 'Ice tapped the bear')
  assert(zone(e.state, 'hand', 0).length === handBefore, 'and drew a card (net hand size unchanged)')
  assert(inZone(e, 0, 'graveyard', fi.oid) && fi.printed.name === 'Fire // Ice', 'in the graveyard it is Fire // Ice again')
}

section('709: casting the other half (Fire, divided damage)')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const fi = put(e, 0, 'Fire // Ice', 'hand')
  const a = put(e, 1, 'Grizzly Bears', 'battlefield')
  const b = put(e, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const ice = castsFor(e, fi.oid).find((x) => x.face === 1)
  assert(!ice, 'Ice not castable without blue mana')
  e.choose({ type: 'cast', oid: fi.oid, face: 0, targets: [{ kind: 'object', oid: a.oid }, { kind: 'object', oid: b.oid }], division: [1, 1] })
  bothPass(e)
  assert(a.status.damage === 1 && b.status.damage === 1, 'Fire dealt 1 to each')
}

section('712.11: a modal DFC can be cast as its front or played as its back-face land')
{
  const e = makeEngine()
  const bgr = put(e, 0, 'Bala Ged Recovery // Bala Ged Sanctuary', 'hand')
  assert(bgr.printed.name === 'Bala Ged Recovery' && bgr.printed.types.includes('Sorcery'), 'in hand: the front face')
  advanceToPriorityAt(e, 'main1')
  const opts = castsFor(e, bgr.oid)
  assert(opts.some((a) => a.type === 'playLand' && a.face === 1), 'back face offered as a land play')
  assert(!opts.some((a) => a.type === 'cast'), 'front not castable without mana')
  e.choose({ type: 'playLand', oid: bgr.oid, face: 1 })
  assert(bgr.zoneName === 'battlefield' && bgr.printed.name === 'Bala Ged Sanctuary' && bgr.chars.types.includes('Land'), 'entered as the land')
  assert(bgr.status.tapped, 'it entered tapped')
  assert(projectGame(e).players[0].battlefield.find((c) => c.oid === bgr.oid).face === 1, 'view shows the back face')
  e._relocate(bgr, 'hand')
  assert(bgr.printed.name === 'Bala Ged Recovery', 'bounced: front face again')

  const f = makeEngine()
  for (let i = 0; i < 3; i++) put(f, 0, 'Forest', 'battlefield')
  const bgr2 = put(f, 0, 'Bala Ged Recovery // Bala Ged Sanctuary', 'hand')
  const dead = put(f, 0, 'Grizzly Bears', 'graveyard')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'cast', oid: bgr2.oid, face: 0 })
  bothPass(f)
  assert(f.pending.kind === 'search' && f.pending.cards.includes(dead.oid), 'front face: choose a card from your graveyard')
  f.choose({ pick: dead.oid })
  assert(inZone(f, 0, 'hand', dead.oid), 'returned to hand')
  assert(inZone(f, 0, 'graveyard', bgr2.oid) && bgr2.printed.name === 'Bala Ged Recovery', 'the DFC sits in the graveyard as its front')
}

section('701.28: transform flips a double-faced permanent; it reverts when it leaves')
{
  const e = makeEngine()
  for (let i = 0; i < 6; i++) put(e, 0, 'Plains', 'battlefield')
  const garg = put(e, 0, 'Thraben Gargoyle // Stonewing Antagonizer', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  refresh(e)
  assert(garg.chars.name === 'Thraben Gargoyle' && garg.chars.keywords.includes('Defender') && garg.chars.power === 2, 'front: 2/2 defender')
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === garg.oid)
  assert(!!act, '{6}: Transform is offered')
  e.choose({ type: 'activate', oid: garg.oid, ability: 0, targets: [] })
  bothPass(e)
  assert(garg.face === 1 && garg.chars.name === 'Stonewing Antagonizer', 'transformed')
  assert(garg.chars.power === 4 && garg.chars.toughness === 2 && garg.chars.keywords.includes('Flying') && !garg.chars.keywords.includes('Defender'), '4/2 flyer, no defender')
  assert(e._eligibleAttackers().includes(garg.oid) || garg.status.tapped, 'it may attack now (no defender)')
  assert(projectGame(e, 1).players[0].battlefield.find((c) => c.oid === garg.oid).face === 1, 'opponent sees the back face')
  e._relocate(garg, 'hand')
  assert(garg.face === 0 && garg.printed.name === 'Thraben Gargoyle', 'in hand it is the front face again')
}

section('Coverage classification of multi-faced cards')
{
  assert(classifyCard(SAMPLE_CARDS['Fire // Ice']).supported, 'Fire // Ice: both halves authored')
  assert(classifyCard(SAMPLE_CARDS['Thraben Gargoyle // Stonewing Antagonizer']).supported, 'Gargoyle: authored front + keyword back')
  assert(classifyCard(SAMPLE_CARDS['Delver of Secrets // Insectile Aberration']).supported, 'Delver: both faces supported (upkeep trigger authored, back face keyword-only)')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
