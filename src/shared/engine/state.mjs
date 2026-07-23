// The engine object model. Richer than the manual board: every card in play is
// an "object" keyed by oid with printed (Scryfall-derived) + computed chars +
// mutable status. Zones are ordered oid arrays. Shared zones (battlefield, stack)
// use a bare name; personal zones (library/hand/graveyard/exile) are keyed by
// owner as "<pid>:<name>".

import { makeRng } from './rng.mjs'
import { printedFromScryfall, SAMPLE_CARDS } from './cards.mjs'
import { loadBehavior } from './behaviors.mjs'

export const SHARED_ZONES = ['battlefield', 'stack', 'command']
export const PERSONAL_ZONES = ['library', 'hand', 'graveyard', 'exile']

export const zoneKey = (name, pid) => (SHARED_ZONES.includes(name) ? name : `${pid}:${name}`)

let OID = 0
const nextOid = () => `o${++OID}`

// Compute characteristics from printed base. M0 only applies layer 7c (counters)
// on top of printed power/toughness; the full layer system lands in M3.
export function computeChars(obj) {
  const p = obj.printed
  let power = p.power
  let toughness = p.toughness
  const plus = obj.status.counters['+1/+1'] || 0
  const minus = obj.status.counters['-1/-1'] || 0
  if (power != null) power += plus - minus
  if (toughness != null) toughness += plus - minus
  obj.chars = {
    name: p.name,
    types: p.types,
    subtypes: p.subtypes,
    supertypes: p.supertypes,
    colors: p.colors,
    keywords: p.keywords,
    power,
    toughness
  }
  return obj.chars
}

// A triggered/activated ability placed on the stack. Unlike card objects it has
// no printed characteristics and never uses moveObject — it is deleted when it
// resolves (abilities don't go to any zone afterwards).
export function createAbility(state, fields) {
  const oid = nextOid()
  const o = {
    oid,
    kind: 'ability',
    zoneName: 'stack',
    chars: { types: [] },
    status: {},
    controller: 0,
    sourceOid: null,
    effect: [],
    targets: null,
    ...fields
  }
  state.objects[oid] = o
  return o
}

export function createObject(state, sf, owner) {
  const printed = printedFromScryfall(sf)
  const obj = {
    oid: nextOid(),
    owner,
    controller: owner,
    zoneName: null,
    cardId: sf.id || null, // Scryfall print id, for rendering card:// images
    printed,
    behavior: loadBehavior(printed),
    chars: null,
    status: {
      tapped: false,
      summoningSick: false,
      damage: 0,
      counters: {},
      attacking: false,
      attackingTarget: null, // { player: pid } or { planeswalker: oid }
      blocked: false, // an attacker that was blocked (stays blocked if blockers leave)
      blocking: null, // oid of attacker being blocked
      markedDeath: false, // dealt damage by a deathtouch source
      attachedTo: null // oid of the permanent this Aura/Equipment is attached to
    },
    // spell-on-stack extras
    targets: null,
    spell: null
  }
  computeChars(obj)
  state.objects[obj.oid] = obj
  return obj
}

export function zone(state, name, pid) {
  return state.zones[zoneKey(name, pid)]
}

// Remove an oid from whatever zone currently holds it.
function pluck(state, oid) {
  for (const key of Object.keys(state.zones)) {
    const arr = state.zones[key]
    const i = arr.indexOf(oid)
    if (i >= 0) {
      arr.splice(i, 1)
      return
    }
  }
}

// Move an object to a zone. `toName` is a zone name; personal zones use the
// object's owner. Tokens leaving the battlefield cease to exist (deleted).
export function moveObject(state, oid, toName, { toTop = false } = {}) {
  const obj = state.objects[oid]
  const leavingBattlefield = obj.zoneName === 'battlefield' && toName !== 'battlefield'
  pluck(state, oid)

  if (obj.token && leavingBattlefield) {
    delete state.objects[oid]
    return
  }

  // Reset transient status when a permanent changes zones.
  if (toName !== 'battlefield') {
    obj.status.tapped = false
    obj.status.damage = 0
    obj.status.counters = {}
    obj.status.attacking = false
    obj.status.attackingTarget = null
    obj.status.blocked = false
    obj.status.blocking = null
    obj.status.markedDeath = false
    obj.status.attachedTo = null
    obj.controller = obj.owner
  }

  obj.zoneName = toName
  const key = zoneKey(toName, obj.owner)
  if (toTop) state.zones[key].unshift(oid)
  else state.zones[key].push(oid)
  computeChars(obj)
}

// Build a fresh game. players: [{ name, deck: [cardName, …] }].
export function createState({ players, seed = 'stack' }) {
  const rng = makeRng(seed)
  const state = {
    seed,
    rng,
    turnNumber: 0,
    activePlayer: 0,
    step: null,
    prio: null, // { player, passCount } while a priority loop is running
    combat: null, // { attackers:[oid], blocks:{ blockerOid: attackerOid } }
    winner: null,
    pending: null,
    pendingTriggers: [], // triggered abilities waiting to go on the stack
    continuous: [], // floating continuous effects (until-end-of-turn pumps, etc.)
    prevent: [], // active damage-prevention shields (rule 615)
    tsCounter: 0, // monotonic timestamps for layer ordering (rule 613)
    log: [],
    players: [],
    objects: {},
    zones: { battlefield: [], stack: [], command: [] }
  }

  players.forEach((pdef, pid) => {
    state.players.push({
      id: pid,
      name: pdef.name || `Player ${pid + 1}`,
      life: 20,
      landsPlayed: 0,
      mulligans: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      counters: {}
    })
    for (const name of PERSONAL_ZONES) state.zones[zoneKey(name, pid)] = []

    // Deck entries may be card names (resolved from the sample pool, used by
    // tests) or full Scryfall-shaped card objects (used with real decks).
    const cards = pdef.deck.map((entry) => {
      const sf = typeof entry === 'string' ? SAMPLE_CARDS[entry] : entry
      if (!sf) throw new Error(`Unknown card in deck: ${entry}`)
      return createObject(state, sf, pid)
    })
    const libKey = zoneKey('library', pid)
    state.zones[libKey] = rng.shuffle(cards.map((c) => c.oid))
    state.zones[libKey].forEach((oid) => (state.objects[oid].zoneName = 'library'))
  })

  return state
}

// Test/helper accessor: object oids currently in a zone.
export const zoneOids = (state, name, pid) => zone(state, name, pid)
export const objectsIn = (state, name, pid) =>
  zoneOids(state, name, pid).map((oid) => state.objects[oid])
