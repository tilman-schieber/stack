// Headless verification, batch 16:
//   the monarch (725), the initiative + Undercity (726 / 309), regular dungeons
//   with room choices, choosing a card name (Meddling Mage, Pithing Needle,
//   Cabal Therapy), "triggers an additional time" (Panharmonicon, Teysa),
//   counter and token doubling (Hardened Scales, Doubling Season, Parallel
//   Lives), playing from the top of the library (Future Sight, Experimental
//   Frenzy, Courser of Kruphix, Mystic Forge), and "you may play them" exile.
// Run: node src/shared/engine/cr16.test.mjs

import { GameEngine } from './engine.mjs'
import { zone } from './state.mjs'
import { projectGame } from './project.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, refresh, advanceToPriorityAt, keepAll, inZone, combat, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
// Pass until the stack is empty and a priority decision is back (resolving every
// trigger along the way); stops early at any other decision.
const drain = (e) => {
  let g = 0
  while (g++ < 40 && e.pending.kind === 'priority' && zone(e.state, 'stack').length) bothPass(e)
}
const manual = () => {
  const deck = () => Array(20).fill('Forest')
  return keepAll(new GameEngine({ seed: 'h', startingPlayer: 0, players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }] }).start())
}
// Put a card on TOP of a player's library (put() appends to the bottom).
const putTop = (e, pid, name) => {
  const o = put(e, pid, name, 'library')
  const lib = zone(e.state, 'library', pid)
  lib.unshift(lib.pop())
  refresh(e)
  return o
}
// Pass (discarding to hand size at cleanup) until `pid` has priority at `step`
// of their own turn.
const goTo = (e, pid, step) => {
  let g = 0
  while (!(e.state.activePlayer === pid && e.state.step === step && e.pending.kind === 'priority' && e.pending.player === pid) && g++ < 120) {
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
    else if (e.pending.kind === 'discard') e.choose({ discard: e.pending.hand.slice(0, e.pending.count ?? 1) })
    else if (e.pending.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (e.pending.kind === 'declareBlockers') e.choose({ blocks: {} })
    else throw new Error(`unexpected decision ${e.pending.kind}`)
  }
}
const castIt = (e, o, extra = {}) => {
  e.choose({ type: 'cast', oid: o.oid, ...extra })
  bothPass(e)
}

section('The monarch: become it, draw at your end step, lose it to combat damage')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Plains', 'battlefield')
  const sent = put(e, 0, 'Palace Sentinels', 'hand')
  advanceToPriorityAt(e, 'main1')
  castIt(e, sent)
  drain(e)
  assert(e.state.monarch === 0, 'A becomes the monarch when Palace Sentinels enters')
  assert(projectGame(e, 1).players[0].monarch && projectGame(e, 1).monarch === 0, 'the view carries the designation')
  const hand = zone(e.state, 'hand', 0).length
  advanceToPriorityAt(e, 'end')
  assert(zone(e.state, 'stack').length === 1 && e.state.objects[zone(e.state, 'stack')[0]].name === 'The Monarch', 'at the beginning of the end step the monarch\'s draw trigger is on the stack (sourceless)')
  assert(/The Monarch/.test(projectGame(e).stack[0].name), 'the stack view names it')
  drain(e)
  assert(zone(e.state, 'hand', 0).length === hand + 1, 'the monarch drew a card')
  // B's turn: an unblocked creature hits A — B becomes the monarch.
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  goTo(e, 1, 'main1')
  combat(e, [bear.oid])
  drain(e)
  assert(e.state.monarch === 1, 'combat damage to the monarch makes the attacker\'s controller the monarch')
  // Crown-Hunter Hireling can't attack unless defending player is the monarch.
  const hire = put(e, 0, 'Crown-Hunter Hireling', 'battlefield', { summoningSick: false })
  recompute(e.state)
  assert(!e._restricted(hire, 'attack'), 'Hireling may attack while an opponent is the monarch')
  e.state.monarch = 0
  assert(e._restricted(hire, 'attack'), '…and not while you are (or nobody is)')
  e.state.monarch = null
  assert(e._restricted(hire, 'attack'), 'no monarch: still can\'t attack')
}

section('The initiative: take it, venture into Undercity, upkeep ventures, damage steals it')
{
  const e = makeEngine()
  for (let i = 0; i < 5; i++) put(e, 0, 'Plains', 'battlefield')
  const pal = put(e, 0, 'Goliath Paladin', 'hand')
  advanceToPriorityAt(e, 'main1')
  castIt(e, pal) // ETB trigger on the stack
  bothPass(e) // ETB resolves: takes the initiative -> "ventures into Undercity" trigger
  assert(e.state.initiative === 0, 'A takes the initiative')
  bothPass(e) // venture resolves: enters Undercity, Secret Entrance triggers
  assert(e.state.players[0].dungeon?.name === 'Undercity' && e.state.players[0].dungeon.room === 'entrance', 'A enters Undercity at the Secret Entrance')
  bothPass(e) // the room ability: search for a basic land
  assert(e.pending.kind === 'search' && e.pending.player === 0, 'Secret Entrance: search your library for a basic land')
  const hand = zone(e.state, 'hand', 0).length
  e.choose({ pick: e.pending.cards[0] })
  assert(zone(e.state, 'hand', 0).length === hand + 1, 'the basic land went to hand')
  const v = projectGame(e, 1)
  assert(v.initiative === 0 && v.players[0].dungeon.roomName === 'Secret Entrance' && v.players[0].dungeon.scryfallId, 'the view shows the dungeon, its room and the card printing')
  // A's next upkeep: venture (auto: the first arrow — Forge) -> two +1/+1 counters on target creature.
  goTo(e, 0, 'upkeep')
  drain(e)
  assert(e.pending.kind === 'chooseTargets' && /Forge/.test(e.pending.name), 'upkeep: A ventured into the Forge, which targets a creature')
  e.choose({ targets: [{ kind: 'object', oid: pal.oid }] })
  drain(e)
  assert(pal.status.counters['+1/+1'] === 2, 'Forge put two +1/+1 counters on the Paladin')
  // B's turn: combat damage to A (who has the initiative) hands it to B, who ventures.
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  goTo(e, 1, 'main1')
  combat(e, [bear.oid])
  drain(e)
  assert(e.state.initiative === 1, 'B takes the initiative by dealing combat damage to A')
  assert(e.pending.kind === 'search' && e.pending.player === 1, 'and ventures into Undercity: Secret Entrance search')
  e.choose({ pick: null })
  assert(e.state.players[1].dungeon?.room === 'entrance' && e.state.players[0].dungeon?.room === 'forge', 'each player owns their own dungeon card')
}

section('Completing a dungeon (309.6) and "as long as you\'ve completed a dungeon"')
{
  const e = makeEngine()
  const stalker = put(e, 0, 'Gloom Stalker', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  recompute(e.state)
  assert(!stalker.chars.keywords.includes('Double strike'), 'no double strike before completing a dungeon')
  e.state.players[0].dungeon = { name: 'Undercity', room: 'archives' }
  e._venture(0, 'Undercity') // -> Throne of the Dead Three (the bottommost room)
  e._grantPriorityTo(0)
  assert(e.state.players[0].dungeon.room === 'throne' && zone(e.state, 'stack').length === 1, 'the Throne\'s ability is on the stack; the dungeon stays until it resolves')
  drain(e) // library is all Forests: nothing to put onto the battlefield; shuffle
  assert(e.state.players[0].dungeon === null && e.state.players[0].completedDungeons === 1, 'once the last room\'s ability resolved, the dungeon is completed (SBA)')
  recompute(e.state)
  assert(stalker.chars.keywords.includes('Double strike'), 'Gloom Stalker now has double strike')
  assert(e.state.log.some((l) => /completes Undercity/.test(l.text)), 'logged')
}

section('A regular dungeon: choose which one, then choose the room at a fork')
{
  const e = manual()
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  const nadaar = put(e, 0, 'Nadaar, Selfless Paladin', 'hand')
  advanceToPriorityAt(e, 'main1')
  castIt(e, nadaar)
  bothPass(e) // Nadaar's ETB: venture into the dungeon
  assert(e.pending.kind === 'chooseDungeon' && e.pending.options.length === 3, 'no dungeon yet: choose one of the three')
  let threw = false
  try {
    e.choose({ dungeon: 'Undercity' })
  } catch {
    threw = true
  }
  assert(threw, 'Undercity is not an option for a plain venture')
  e.choose({ dungeon: 'Lost Mine of Phandelver' })
  assert(e.state.players[0].dungeon.room === 'cave', 'entered the Cave Entrance')
  bothPass(e)
  assert(e.pending.kind === 'scry' && e.pending.cards.length === 1, 'Cave Entrance: scry 1')
  e.choose({ toBottom: [], toTop: e.pending.cards })
  // Nadaar attacks next turn: venture again — a fork.
  e._venture(0)
  assert(e.pending.kind === 'chooseRoom' && e.pending.options.map((o) => o.id).join() === 'goblin,tunnels', 'two arrows lead out of the Cave Entrance')
  e.choose({ room: 'tunnels' })
  e._grantPriorityTo(0)
  drain(e)
  const treasure = zone(e.state, 'battlefield').map((oid) => e.state.objects[oid]).find((o) => o.token && o.printed.name === 'Treasure')
  assert(treasure && treasure.controller === 0, 'Mine Tunnels: a Treasure token')
  refresh(e)
  assert(e.pending.actions.some((a) => a.type === 'activate' && a.oid === treasure.oid && a.mana), 'the Treasure can be sacrificed for mana')
}

section('Tomb of Annihilation: "each player loses 2 life unless they discard a card"')
{
  const e = makeEngine()
  put(e, 0, 'Grizzly Bears', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.state.players[0].dungeon = { name: 'Tomb of Annihilation', room: 'entry' }
  e._venture(0) // auto: Veils of Fear
  e._grantPriorityTo(0)
  drain(e)
  assert(e.pending.kind === 'discardCards' && e.pending.player === 0 && e.pending.optional, 'A (active player first) may discard a card')
  e.choose({ discard: [e.pending.hand[0]] })
  assert(e.pending.kind === 'discardCards' && e.pending.player === 1, 'then B')
  e.choose({ discard: [] })
  assert(e.state.players[0].life === 20 && e.state.players[1].life === 18, 'A discarded; B declined and lost 2')
}

section('Dungeon of the Mad Mage: "you may play them" from exile, and cast one of three free')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.state.players[0].dungeon = { name: 'Dungeon of the Mad Mage', room: 'lost' }
  e._venture(0) // auto: Runestone Caverns
  e._grantPriorityTo(0)
  drain(e)
  const exiled = zone(e.state, 'exile', 0).filter((oid) => e.state.objects[oid].playableFromExile === 0)
  assert(exiled.length === 2, 'two cards exiled face up, playable')
  refresh(e)
  const play = e.pending.actions.find((a) => a.type === 'playLand' && a.fromExile)
  assert(play, 'a land among them can be played from exile')
  e.choose(play)
  assert(inZone(e, 0, 'battlefield', play.oid), 'played from exile')
  // Mad Wizard's Lair: draw three, reveal, cast one free.
  putTop(e, 0, 'Lightning Bolt')
  e.state.players[0].dungeon = { name: 'Dungeon of the Mad Mage', room: 'mines' }
  e._venture(0)
  e._grantPriorityTo(0)
  drain(e)
  assert(e.pending.kind === 'chooseFromHand' && e.pending.then === 'castFree' && e.pending.cards.length === 1, 'drew three; only the Bolt is castable')
  e.choose({ oid: e.pending.cards[0] })
  assert(e.pending.kind === 'madness' && e.pending.free, 'offered to cast it without paying')
  e.choose({ cast: true, targets: [{ kind: 'player', pid: 1 }] })
  drain(e)
  assert(e.state.players[1].life === 17, 'the free Bolt resolved')
}

section('Choose a card name: Meddling Mage forbids casting it; Pithing Needle stops activations')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const mage = put(e, 0, 'Meddling Mage', 'hand')
  const bolt = put(e, 1, 'Lightning Bolt', 'hand')
  const bear = put(e, 1, 'Grizzly Bears', 'hand')
  put(e, 1, 'Mountain', 'battlefield')
  put(e, 1, 'Forest', 'battlefield')
  put(e, 1, 'Forest', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  castIt(e, mage)
  assert(e.pending.kind === 'chooseName' && e.pending.player === 0 && e.pending.nonland, 'as it enters, its controller names a nonland card')
  assert(e.pending.suggestions.includes('Meddling Mage') && !e.pending.suggestions.includes('Lightning Bolt'), 'suggestions: known cards only — not the opponent\'s hidden hand')
  for (const bad of [{ name: '' }, { name: 'Plains' }]) {
    let threw = false
    try {
      e.choose(bad)
    } catch {
      threw = true
    }
    assert(threw, `rejected: ${JSON.stringify(bad)}`)
  }
  e.choose({ name: 'lightning bolt' })
  assert(inZone(e, 0, 'battlefield', mage.oid) && mage.chosen === 'lightning bolt', 'Mage entered with the name remembered')
  e.choose({ type: 'pass' }) // B gets priority
  assert(e.pending.player === 1, 'B has priority')
  assert(!e.pending.actions.some((a) => a.type === 'cast' && a.oid === bolt.oid), 'B can\'t cast Lightning Bolt')
  assert(/static/.test(e.pending.reasons[bolt.oid]), 'and is told why')
  assert(!/static/.test(e.pending.reasons[bear.oid] || ''), 'other spells are not forbidden by the Mage (the Bears merely waits for B\'s turn)')

  const f = makeEngine()
  put(f, 0, 'Plains', 'battlefield')
  const needle = put(f, 0, 'Pithing Needle', 'hand')
  const fan = put(f, 1, 'Mogg Fanatic', 'battlefield', { summoningSick: false })
  const elf = put(f, 1, 'Llanowar Elves', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(f, 'main1')
  castIt(f, needle)
  f.choose({ name: 'Mogg Fanatic' })
  f.choose({ type: 'pass' })
  assert(f.pending.player === 1 && !f.pending.actions.some((a) => a.type === 'activate' && a.oid === fan.oid), 'Mogg Fanatic\'s ability can\'t be activated')
  assert(f.pending.actions.some((a) => a.type === 'tapForMana' && a.oid === elf.oid), 'mana abilities are unaffected')
}

section('Cabal Therapy: name a card as it resolves; discard every copy; flashback by sacrificing')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  const th = put(e, 0, 'Cabal Therapy', 'hand')
  const b1 = put(e, 1, 'Lightning Bolt', 'hand')
  const b2 = put(e, 1, 'Lightning Bolt', 'hand')
  const bear = put(e, 1, 'Grizzly Bears', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: th.oid, targets: [{ kind: 'player', pid: 1 }] })
  bothPass(e)
  assert(e.pending.kind === 'chooseName' && !e.pending._enter, 'the name is chosen on resolution')
  e.choose({ name: 'Lightning Bolt' })
  assert(inZone(e, 1, 'graveyard', b1.oid) && inZone(e, 1, 'graveyard', b2.oid) && inZone(e, 1, 'hand', bear.oid), 'both Bolts discarded, the Bears kept')
  assert(inZone(e, 0, 'graveyard', th.oid), 'Therapy in the graveyard')
  put(e, 0, 'Grizzly Bears', 'battlefield')
  assert(e.pending.actions.some((a) => a.type === 'castFlashback' && a.oid === th.oid), 'flashback available with a creature to sacrifice')
}

section('"Triggers an additional time": Panharmonicon (enters), Teysa Karlov (dies)')
{
  const e = makeEngine()
  put(e, 0, 'Panharmonicon', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const vis = put(e, 0, 'Elvish Visionary', 'hand')
  advanceToPriorityAt(e, 'main1')
  const hand = zone(e.state, 'hand', 0).length - 1
  castIt(e, vis)
  assert(zone(e.state, 'stack').length === 2, 'the ETB trigger went on the stack twice')
  drain(e)
  assert(zone(e.state, 'hand', 0).length === hand + 2, 'drew two cards')

  const f = makeEngine()
  put(f, 0, 'Teysa Karlov', 'battlefield')
  put(f, 0, 'Blood Artist', 'battlefield')
  const mwm = put(f, 0, 'Mogg War Marshal', 'battlefield')
  advanceToPriorityAt(f, 'main1')
  f._bury(mwm)
  f._grantPriorityTo(0)
  assert(zone(f.state, 'stack').length === 4, 'Blood Artist and the Marshal\'s own dies trigger each triggered twice')
  drain(f)
  assert(f.state.players[0].life === 22, 'gained 2 from Blood Artist')
  const goblins = zone(f.state, 'battlefield').filter((oid) => f.state.objects[oid].token)
  assert(goblins.length === 2, 'two Goblin tokens')
  recompute(f.state)
  assert(goblins.every((oid) => f.state.objects[oid].chars.keywords.includes('Lifelink')), 'Teysa: creature tokens have lifelink')
}

section('Counter and token doubling: Hardened Scales, Doubling Season, Parallel Lives')
{
  const e = makeEngine()
  put(e, 0, 'Hardened Scales', 'battlefield')
  for (let i = 0; i < 6; i++) put(e, 0, 'Forest', 'battlefield')
  const b1 = put(e, 0, 'Walking Ballista', 'hand')
  advanceToPriorityAt(e, 'main1')
  castIt(e, b1, { x: 1 })
  assert(b1.status.counters['+1/+1'] === 2, 'Ballista X=1 enters with 1+1 counters')
  put(e, 0, 'Doubling Season', 'battlefield')
  const b2 = put(e, 0, 'Walking Ballista', 'hand')
  castIt(e, b2, { x: 1 })
  assert(b2.status.counters['+1/+1'] === 4, 'with both: (1+1)×2 = 4')
  for (let i = 0; i < 4; i++) put(e, 0, 'Forest', 'battlefield')
  e.choose({ type: 'activate', oid: b2.oid, ability: 0 }) // {4}: put a +1/+1 counter
  bothPass(e)
  assert(b2.status.counters['+1/+1'] === 8, 'an added counter becomes (1+1)×2 more')

  const f = makeEngine()
  put(f, 0, 'Parallel Lives', 'battlefield')
  put(f, 0, 'Plains', 'battlefield')
  put(f, 0, 'Plains', 'battlefield')
  const raise = put(f, 0, 'Raise the Alarm', 'hand')
  advanceToPriorityAt(f, 'main1')
  castIt(f, raise)
  const tokens = () => zone(f.state, 'battlefield').filter((oid) => f.state.objects[oid].token).length
  assert(tokens() === 4, 'Raise the Alarm makes four Soldiers under Parallel Lives')
  put(f, 0, 'Doubling Season', 'battlefield')
  put(f, 0, 'Plains', 'battlefield')
  put(f, 0, 'Plains', 'battlefield')
  const raise2 = put(f, 0, 'Raise the Alarm', 'hand')
  castIt(f, raise2)
  assert(tokens() === 12, 'and eight more with Doubling Season as well')

  const g = makeEngine()
  put(g, 0, 'Doubling Season', 'battlefield')
  for (let i = 0; i < 5; i++) put(g, 0, 'Swamp', 'battlefield')
  const saga = put(g, 0, 'The Eldest Reborn', 'hand')
  advanceToPriorityAt(g, 'main1')
  castIt(g, saga)
  assert(saga.status.counters.lore === 2 && zone(g.state, 'stack').length === 2, 'a Saga enters with two lore counters: chapters I and II both trigger (714.2c)')
}

section('Playing from the top of the library: Future Sight, Frenzy, Courser, Mystic Forge')
{
  const e = makeEngine()
  put(e, 0, 'Future Sight', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const bolt = putTop(e, 0, 'Lightning Bolt')
  advanceToPriorityAt(e, 'main1')
  assert(projectGame(e, 1).players[0].libraryTop?.name === 'Lightning Bolt', 'the top card is revealed to everyone')
  const act = e.pending.actions.find((a) => a.type === 'cast' && a.oid === bolt.oid)
  assert(act?.fromTop, 'the Bolt can be cast from the top of the library')
  e.choose({ ...act, targets: [{ kind: 'player', pid: 1 }] })
  bothPass(e)
  assert(e.state.players[1].life === 17 && inZone(e, 0, 'graveyard', bolt.oid), 'it resolved')
  const land = putTop(e, 0, 'Forest')
  const pl = e.pending.actions.find((a) => a.type === 'playLand' && a.oid === land.oid)
  assert(pl?.fromTop, 'a land on top can be played')
  e.choose(pl)
  assert(inZone(e, 0, 'battlefield', land.oid), 'played from the top')

  const f = makeEngine()
  put(f, 0, 'Experimental Frenzy', 'battlefield')
  put(f, 0, 'Mountain', 'battlefield')
  const inHand = put(f, 0, 'Lightning Bolt', 'hand')
  const top = putTop(f, 0, 'Lightning Bolt')
  advanceToPriorityAt(f, 'main1')
  assert(!f.pending.actions.some((a) => a.oid === inHand.oid) && /from your hand/.test(f.pending.reasons[inHand.oid]), 'Frenzy: nothing from hand, with the reason')
  assert(f.pending.actions.some((a) => a.type === 'cast' && a.oid === top.oid), 'but the top card is castable')
  assert(projectGame(f, 0).players[0].libraryTop && !projectGame(f, 1).players[0].libraryTop, '"look at the top card": visible to its owner only')

  const g = makeEngine()
  put(g, 0, 'Courser of Kruphix', 'battlefield')
  put(g, 0, 'Mountain', 'battlefield')
  const gb = putTop(g, 0, 'Lightning Bolt')
  advanceToPriorityAt(g, 'main1')
  assert(!g.pending.actions.some((a) => a.oid === gb.oid), 'Courser: no spells from the top')
  const gl = putTop(g, 0, 'Forest')
  const gpl = g.pending.actions.find((a) => a.type === 'playLand' && a.oid === gl.oid)
  assert(gpl, 'lands, yes')
  g.choose(gpl)
  drain(g)
  assert(g.state.players[0].life === 21, 'landfall: gained 1 life')

  const h = makeEngine()
  const forge = put(h, 0, 'Mystic Forge', 'battlefield')
  put(h, 0, 'Mountain', 'battlefield')
  const hb = putTop(h, 0, 'Lightning Bolt')
  advanceToPriorityAt(h, 'main1')
  assert(!h.pending.actions.some((a) => a.type === 'cast' && a.oid === hb.oid), 'Mystic Forge: a red instant is not castable from the top')
  const ring = putTop(h, 0, 'Sol Ring')
  assert(h.pending.actions.some((a) => a.type === 'cast' && a.oid === ring.oid && a.fromTop), 'an artifact is')
  h.choose({ type: 'activate', oid: forge.oid, ability: 0 })
  bothPass(h)
  assert(inZone(h, 0, 'exile', ring.oid) && h.state.players[0].life === 19, '{T}, pay 1 life: the top card is exiled')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
