// Mana methods of GameEngine — split out of engine.mjs for size; mixed into
// GameEngine.prototype by engine.mjs. Same `this`, same rules references.

import { createState, createObject, createAbility, computeChars, zone, zoneKey, moveObject, objectsIn, setFace } from './state.mjs'
import { manaAbilityColors, loadBehavior } from './behaviors.mjs'
import { isPermanent, parseManaCost, manaValue, BASIC_LAND_MANA } from './cards.mjs'
import { recompute, matchStatic, hasSub } from './layers.mjs'
import { DUNGEONS, REGULAR_DUNGEONS, roomOf } from './dungeons.mjs'
import { STEP_ORDER, PRIORITY_STEPS, MAIN_STEPS, tags, addCosts } from './engineShared.mjs'

export const manaMethods = {
  // ---- mana (rule 605 mana abilities resolve immediately) --------------

  // Untapped sources the player can tap for one mana each, with the colors each
  // can produce (dual/any lands produce more than one).
  // The colours a permanent can tap for. A permanent that has lost all its
  // abilities keeps only the intrinsic mana ability of its basic land types
  // (305.6 — a Blood Moon'd land still taps for {R}).
  _manaColorsOf(o) {
    if (!o.chars?.lostAbilities) return manaAbilityColors(o)
    return [...new Set((o.chars.subtypes || []).map((st) => BASIC_LAND_MANA[st]).filter(Boolean))]
  },

  // Every way a permanent can tap for mana: [{ colors, amount, only }]. Basic
  // land types and authored `mana` colours form one option; `manaOptions` adds
  // multi-mana or restricted ones (Sol Ring: {C}{C}; Eldrazi Temple: {C}{C} to be
  // spent only on colourless Eldrazi — rule 106.6).
  // An option may also be a fixed set of pips (`pips: ['R','W']` — a Karoo's
  // {R}{W}) or conditional (`if`, e.g. the Tron lands' extra mana). An Aura with
  // `attachedManaBonus` on the permanent adds one fixed pip to every option
  // (Wild Growth: "adds an additional {G}").
  _manaOptionsOf(o) {
    const colors = this._manaColorsOf(o)
    const opts = colors.length ? [{ colors, amount: 1, only: null }] : []
    if (!o.chars?.lostAbilities)
      for (const m of o.behavior?.manaOptions || []) {
        if (m.if && !this._cond(m.if, o)) continue
        if (m.pips) opts.push({ colors: [...new Set(m.pips)], amount: m.pips.length, only: null, pips: [...m.pips] })
        // `amountCount`: "add {G} for each Elf on the battlefield" (Priest of Titania).
        else opts.push({ colors: [...m.colors], amount: m.amountCount ? this._amount({ controller: o.controller, oid: o.oid }, { count: m.amountCount }) : m.amount || 1, only: m.only || null })
      }
    const bonus = []
    let anyColor = false
    for (const aura of objectsIn(this.state, 'battlefield')) {
      if (aura.status.attachedTo !== o.oid || aura.chars?.lostAbilities) continue
      // "Enchanted land has '{T}: Add one mana of any color'" (Abundant Growth).
      if (aura.behavior?.attachedManaAny) anyColor = true
      const b = aura.behavior?.attachedManaBonus
      if (!b) continue
      const color = b.color === 'chosen' ? aura.chosen : b.color
      if (color) bonus.push(color)
    }
    if (anyColor) opts.push({ colors: ['W', 'U', 'B', 'R', 'G'], amount: 1, only: null })
    if (bonus.length) for (const opt of opts) opt.extra = [...(opt.extra || []), ...bonus]
    return opts
  },

  // Untapped mana sources of `pid`, each reduced to the one option best suited to
  // paying for `printed` (a restricted option is used only if the spell qualifies).
  _manaSources(pid, printed = null) {
    const s = this.state
    const out = []
    for (const o of objectsIn(s, 'battlefield')) {
      if (o.controller !== pid || o.status.tapped) continue
      // creatures with a {T} mana ability need no summoning sickness (haste ok)
      if (o.printed.types.includes('Creature') && !this._canTap(o)) continue
      const usable = this._manaOptionsOf(o).filter((m) => !m.only || (printed && this._spellMatchesFilter(pid, printed, m.only, o)))
      if (!usable.length) continue
      const best = usable.reduce((a, b) => (b.amount + (b.extra?.length || 0) > a.amount + (a.extra?.length || 0) ? b : a))
      out.push({ oid: o.oid, colors: best.colors, amount: best.amount, only: best.only, pips: best.pips || null, extra: best.extra || null })
    }
    // Auto-payment spends generic mana from the sources whose colours the rest
    // of the hand needs least (keep the lone Mountain for the Bolt), and keeps
    // multi-colour sources for last.
    const demand = this._colorDemand(pid)
    const producers = {}
    for (const src of out) for (const c of src.colors) producers[c] = (producers[c] || 0) + (src.amount || 1)
    // Scarcity: a colour many cards want but few sources make is precious.
    const score = (src) => src.colors.reduce((n, c) => n + (demand[c] || 0) / (producers[c] || 1), 0) + src.colors.length * 0.01
    return out.sort((a, b) => score(a) - score(b))
  },

  // Coloured pips the cards in `pid`'s hand ask for, per colour.
  _colorDemand(pid) {
    const demand = {}
    for (const oid of zone(this.state, 'hand', pid)) {
      const o = this.state.objects[oid]
      for (const pr of o?.faces || [o?.printed]) for (const c of ['W', 'U', 'B', 'R', 'G']) if (pr?.manaCost?.[c]) demand[c] = (demand[c] || 0) + pr.manaCost[c]
    }
    return demand
  },

  // Plan how to pay `cost`: first from mana already floating in `pool` (colored
  // pips, then hybrid, then generic), then by tapping `sources` — colored pips
  // from the most-constrained matching source first, generic from whatever's
  // left. Returns { spend: {W..C}, tap: [oid] }, or null if unpayable.
  _planPayment(cost, sources, pool = null, life = null, restricted = [], picks = null) {
    const COLORS = ['W', 'U', 'B', 'R', 'G', 'C']
    // The caster may say how each hybrid / two-brid pip is paid (picks.hybrid[i] is a
    // colour; picks.twobrid[i] is a colour or '2'); chosen pips become plain pips.
    if (picks) {
      cost = { ...cost, hybrid: [...(cost.hybrid || [])], twobrid: [...(cost.twobrid || [])] }
      ;(picks.hybrid || []).forEach((c, i) => {
        if (cost.hybrid[i]?.includes(c)) {
          cost[c] = (cost[c] || 0) + 1
          cost.hybrid[i] = null
        }
      })
      cost.hybrid = cost.hybrid.filter(Boolean)
      ;(picks.twobrid || []).forEach((c, i) => {
        if (!cost.twobrid[i]) return
        if (c === '2') cost.generic = (cost.generic || 0) + 2
        else if (c === cost.twobrid[i]) cost[c] = (cost[c] || 0) + 1
        else return
        cost.twobrid[i] = null
      })
      cost.twobrid = cost.twobrid.filter(Boolean)
    }
    const spend = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    const spendR = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } // from restricted floating mana
    const have = { ...spend, ...(pool || {}) }
    // Restricted floating mana that may be spent on this cost counts too, and is
    // used before the unrestricted mana of the same colour.
    for (const r of restricted) have[r.color] = (have[r.color] || 0) + 1
    const haveR = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    for (const r of restricted) haveR[r.color]++
    const useHave = (c, k) => {
      const fromR = Math.min(k, haveR[c])
      haveR[c] -= fromR
      spendR[c] += fromR
      spend[c] += k - fromR
      have[c] -= k
    }
    const need = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    for (const c of COLORS) need[c] = cost[c] || 0
    let generic = cost.generic || 0
    let hybrid = [...(cost.hybrid || [])]
    for (const c of COLORS) {
      const k = Math.min(need[c], have[c])
      need[c] -= k
      useHave(c, k)
    }
    hybrid = hybrid.filter((options) => {
      const c = options.find((x) => have[x] > 0)
      if (!c) return true
      useHave(c, 1)
      return false
    })
    for (const c of COLORS) {
      const k = Math.min(generic, have[c])
      generic -= k
      useHave(c, k)
    }

    // A source producing several mana (Sol Ring) is several units sharing one oid;
    // fixed pips ({R}{W}) and an Aura's extra pip are units of one colour each.
    // `kind` marks a convoke/delve source, which produces nothing to spill.
    const avail = sources.flatMap((s) => {
      const unit = (colors) => ({ oid: s.oid, colors, only: s.only || null, kind: s.kind || null })
      const units = s.pips ? s.pips.map((c) => unit([c])) : Array.from({ length: s.amount || 1 }, () => unit(s.colors))
      for (const c of s.extra || []) units.push(unit([c]))
      return units
    })
    const all = [...avail] // every unit, to work out later what went unspent
    const chosen = []
    for (const c of COLORS) {
      let n = need[c]
      while (n-- > 0) {
        const cands = avail
          .filter((s) => s.colors.includes(c))
          .sort((a, b) => a.colors.length - b.colors.length)
        if (!cands.length) return null
        const src = cands[0]
        avail.splice(avail.indexOf(src), 1)
        chosen.push(src.oid)
      }
    }
    // Hybrid pips: each payable by a source producing any of its options.
    const takeColor = (c) => {
      const cands = avail.filter((s) => s.colors.includes(c)).sort((a, b) => a.colors.length - b.colors.length)
      if (!cands.length) return false
      avail.splice(avail.indexOf(cands[0]), 1)
      chosen.push(cands[0].oid)
      return true
    }
    for (const options of hybrid) {
      const cands = avail
        .filter((s) => options.some((c) => s.colors.includes(c)))
        .sort((a, b) => a.colors.length - b.colors.length)
      if (!cands.length) return null
      const src = cands[0]
      avail.splice(avail.indexOf(src), 1)
      chosen.push(src.oid)
    }
    // Phyrexian pips (107.4f): the colour's mana if we have it, else 2 life —
    // which needs a life total of at least that much (119.4).
    let lifeCost = 0
    for (const c of cost.phyrexian || []) {
      if (have[c] > 0) useHave(c, 1)
      else if (!takeColor(c)) lifeCost += 2
    }
    if (lifeCost > 0 && (life == null || life < lifeCost)) return null
    // Two-brid pips (107.4e): the colour if available, else two generic.
    for (const c of cost.twobrid || []) {
      if (have[c] > 0) useHave(c, 1)
      else if (!takeColor(c)) generic += 2
    }
    if (avail.length < generic) return null
    for (let i = 0; i < generic; i++) chosen.push(avail.shift().oid)
    // 106.4: a mana ability produces all of its mana. Tapping a Karoo for {W}{U}
    // to pay {W}, or a Sol Ring to pay {1}, leaves the rest floating in the pool
    // rather than throwing it away.
    const tap = [...new Set(chosen)]
    const spent = new Map() // per source, the colours this payment actually used
    for (const u of all) if (!avail.includes(u) && u.colors.length === 1) spent.set(u.oid, u.colors[0])
    const float = avail
      .filter((u) => !u.kind && tap.includes(u.oid))
      // "Add two mana of any one colour": the leftover matches what was spent.
      .map((u) => ({ oid: u.oid, color: u.colors.length === 1 ? u.colors[0] : spent.get(u.oid) || u.colors[0], only: u.only }))
    return { spend, spendR, tap, life: lifeCost, float }
  },

  // Restricted floating mana of `pid` that may be spent on `printed` (106.6).
  _usableRestricted(pid, printed) {
    const p = this.state.players[pid]
    return (p.restrictedPool || []).filter((r) => printed && this._spellMatchesFilter(pid, printed, r.only, r.source))
  },

  // Mana available to `pid` right now for `printed`: floating (incl. usable
  // restricted mana) + what untapped sources produce.
  _manaAvailable(pid, printed = null) {
    const pool = this.state.players[pid].manaPool
    return (
      this._manaSources(pid, printed).reduce((a, s) => a + (s.amount || 1), 0) +
      Object.values(pool).reduce((a, b) => a + b, 0) +
      this._usableRestricted(pid, printed).length
    )
  },

  // The mana cost to cast `o`, after cost reductions (affinity for artifacts).
  _effectiveCost(pid, o, printed = o.printed) {
    const cost = { ...printed.manaCost }
    const behavior = printed === o.printed ? o.behavior : loadBehavior(printed)
    if (behavior?.affinity === 'artifact') {
      const artifacts = objectsIn(this.state, 'battlefield').filter(
        (x) => x.controller === pid && x.chars.types.includes('Artifact')
      ).length
      cost.generic = Math.max(0, (cost.generic || 0) - artifacts)
    }
    // "This spell costs {1} less to cast for each …" (Tolarian Terror: instant and
    // sorcery cards in your graveyard).
    if (behavior?.costReduction?.per) {
      const n = this._amount({ controller: pid, oid: o.oid }, { count: behavior.costReduction.per })
      cost.generic = Math.max(0, (cost.generic || 0) - n)
    }
    // Rule-modifying statics that raise or lower this spell's cost (Thalia, Goblin
    // Warchief, medallions, …). Increases apply before reductions (601.2f order),
    // and generic is clamped at 0 — a reduction never touches colored pips.
    let delta = 0
    for (const { source, mod } of this._ruleMods()) {
      if (mod.costMod && this._spellMatchesFilter(pid, printed, mod.costMod.spell, source))
        delta += mod.costMod.generic
    }
    if (delta) cost.generic = Math.max(0, (cost.generic || 0) + delta)
    // Commander tax (903.8): {2} more for each previous cast from the command zone.
    if (o.isCommander && o.zoneName === 'command') cost.generic = (cost.generic || 0) + 2 * (o.commanderCasts || 0)
    return cost
  },

  // ---- rule-modifying static effects (rule 613.11) --------------------
  // Permanents can carry `staticRules` that change what players may do rather
  // than any object's characteristics. Collected fresh each query so leaving the
  // battlefield removes the effect automatically.
  _ruleMods() {
    const out = []
    for (const src of [...objectsIn(this.state, 'battlefield'), ...this._emblems().map((oid) => this.state.objects[oid])]) {
      if (src.chars?.lostAbilities) continue
      for (const mod of src.behavior?.staticRules || []) {
        if (mod.if && !this._cond(mod.if, src)) continue // conditional ("as long as you're the monarch")
        out.push({ source: src, mod })
      }
    }
    // Floating rule modifiers ("damage can't be prevented this turn" — Flaring Pain).
    for (const e of this.state.continuous) if (e.ruleMod) out.push({ source: { controller: e.controller, oid: null }, mod: e.ruleMod })
    return out
  },

  // Is the top card of a player's library visible — 'reveal' (to everyone:
  // "play with the top card of your library revealed"), 'look' (to its owner:
  // "you may look at the top card of your library any time"), or null?
  _topCardVisibility(pid) {
    let vis = null
    for (const { source, mod } of this._ruleMods()) {
      if (source.controller !== pid) continue
      if (mod.revealTop) return 'reveal'
      if (mod.lookAtTop) vis = 'look'
    }
    return vis
  },

  // Does a cost-modifier's spell filter match spell `o` cast by `pid`? `o` may be
  // a hand/graveyard card not yet on the stack, so match on printed characteristics.
  _spellMatchesFilter(pid, p, f, source) {
    if (!f) return true
    if (f.anyOf) return f.anyOf.some((g) => this._spellMatchesFilter(pid, p, g, source))
    // "Spells with the chosen name" (Meddling Mage).
    if (f.chosenName) return !!source.chosen && this._nameMatches({ printed: p }, source.chosen)
    if (f.controller === 'you' && pid !== source.controller) return false
    if (f.controller === 'opponent' && pid === source.controller) return false
    if (f.subtype && !hasSub(p, f.subtype)) return false
    if (f.type && !p.types.includes(f.type)) return false
    if (f.noncreature && p.types.includes('Creature')) return false
    if (f.colorless && (p.colors || []).length) return false
    if (f.colorsAny && !f.colorsAny.some((c) => (p.colors || []).includes(c))) return false // "green spells and blue spells"
    return true
  },

  // Is creature `o` forbidden from attacking / blocking / untapping by an active
  // rule-modifier (Pacifism, Claustrophobia)? `action` is 'attack'|'block'|'untap'.
  _restricted(o, action) {
    for (const { source, mod } of this._ruleMods())
      if (mod.restrict?.includes(action) && matchStatic(mod.affects, source, o)) return true
    // One-shot "can't attack until your next turn" effects.
    for (const e of this.state.continuous) if (e.restrict?.includes(action) && e.targets?.includes(o.oid)) return true
    return false
  },

  // The players who have goaded `o` (701.15c), while the goad lasts.
  _goadedBy(o) {
    return this.state.continuous.filter((e) => e.goad != null && e.targets?.includes(o?.oid)).map((e) => e.goad)
  },

  // A spell can't be countered: its own text, or a static such as "creature
  // spells you control can't be countered".
  _uncounterable(o) {
    if (o.behavior?.uncounterable) return true
    return this._ruleMods().some(
      ({ source, mod }) => mod.spellsCantBeCountered && this._spellMatchesFilter(o.controller, o.printed, mod.spellsCantBeCountered, source)
    )
  },

  // May `pid` cast spell `printed` right now, as far as "can't cast" statics go
  // ("Your opponents can't cast spells during your turn", …)?
  _castAllowed(pid, printed) {
    const s = this.state
    for (const { source, mod } of this._ruleMods()) {
      const c = mod.cantCast
      if (!c) continue
      if (c.who === 'opponents' && pid === source.controller) continue
      if (c.who === 'you' && pid !== source.controller) continue
      if (c.duringYourTurn && s.activePlayer !== source.controller) continue
      if (c.spell && !this._spellMatchesFilter(pid, printed, c.spell, source)) continue
      return false
    }
    return true
  },

  // Does `pid` control a permanent that keeps them from losing (Platinum Angel)?
  _cantLose(pid) {
    return objectsIn(this.state, 'battlefield').some((o) => o.controller === pid && this._ability(o, 'cantLose'))
  },

  // Does `pid` control a permanent granting a named "as though" permission (rule
  // 118 / 609.4) — e.g. Vedalken Orrery's 'castAnySpeed'?
  _hasPermission(pid, key) {
    return objectsIn(this.state, 'battlefield').some(
      (o) => o.controller === pid && this._ability(o, 'permissions')?.includes(key)
    )
  },

  // Largest X affordable for an X spell given current mana (X is generic).
  _maxX(pid, o, xCost, printed = o.printed, extraSources = 0) {
    const base = this._effectiveCost(pid, o, printed)
    const sources = this._manaAvailable(pid, printed) + extraSources
    return Math.max(0, Math.floor((sources - manaValue(base)) / xCost))
  },

  // Resolve a numeric effect value that may be 'X' (the source's chosen X) or
  // 'sacrificedMV' (the mana value of a permanent sacrificed to cast the source).
  _amount(source, v) {
    if (v === 'X') return source?.xValue || 0
    if (v === 'sacrificedMV') return source?._sacrificedMV || 0
    if (v === 'sacrificedPower') return source?._sacrificedPower || 0
    if (v === 'revealedPower') return source?._revealedPower || 0
    if (v && typeof v === 'object' && v.x) return (source?.xValue || 0) * v.x // "three times X" (Martyr of Sands)
    if (v && typeof v === 'object' && v.if) {
      // "N, or M instead if [condition]" (Searing Blaze's landfall).
      const w = this.state.objects[source?.oid ?? source?.sourceOid] || source
      return this._amount(source, this._cond(v.if, w) ? v.then : v.else)
    }
    if (v && typeof v === 'object' && v.count === 'drewThisTurn') return this.state.players[source.controller]?.drewThisTurn || 0
    // "for each …": a count of battlefield permanents matching a filter
    // (controlled by you unless `controller: 'any'`; `another` excludes the
    // source; `attacking` only creatures currently attacking).
    if (v && typeof v === 'object' && v.count === 'opponents') return this._opponentsOf(source.controller).length
    if (v && typeof v === 'object' && v.count) {
      const f = v.count
      const selfOid = source?.sourceOid ?? source?.oid
      // `zone: 'graveyard'`: cards in your graveyard instead of permanents you control
      // ("for each instant and sorcery card in your graveyard").
      if (f.zone === 'graveyard') {
        const n = zone(this.state, 'graveyard', source.controller)
          .map((oid) => this.state.objects[oid])
          .filter((o) => o && (!f.type || o.printed.types.includes(f.type)) && (!f.types || f.types.some((t) => o.printed.types.includes(t)))).length
        return n * (v.times || 1) + (v.plus || 0)
      }
      const n = objectsIn(this.state, 'battlefield').filter(
        (o) =>
          (f.controller === 'any' || o.controller === source.controller) &&
          (!f.another || o.oid !== selfOid) &&
          (!f.attacking || o.status.attacking) &&
          (!f.type || o.chars.types.includes(f.type)) &&
          (!f.types || f.types.some((t) => o.chars.types.includes(t))) &&
          (!f.subtype || hasSub(o.chars, f.subtype))
      ).length
      return n * (v.times || 1) + (v.plus || 0) // "twice the number of creatures you control"
    }
    return v
  },

  // Untapped creatures `pid` controls that could be tapped to pay a cost
  // ("tap an untapped white creature you control"), least useful first.
  _tapCandidates(pid, spec) {
    return objectsIn(this.state, 'battlefield')
      .filter((o) => o.controller === pid && o.chars.types.includes('Creature') && !o.status.tapped && (!spec.color || (o.chars.colors || []).includes(spec.color)))
      .sort((a, b) => (b.status.summoningSick ? 1 : 0) - (a.status.summoningSick ? 1 : 0) || (a.chars.power || 0) - (b.chars.power || 0))
  },

  _payTapCreatures(pid, spec) {
    const picked = this._tapCandidates(pid, spec).slice(0, spec.count || 1)
    if (picked.length < (spec.count || 1)) throw new Error('not enough untapped creatures to tap')
    for (const o of picked) this._setTapped(o, true)
    this._log(`${this._nameOf(pid)} taps ${picked.map((o) => this._objName(o)).join(', ')} to pay a cost`)
  },

  // The turn number of `pid`'s next turn (for "until the end of your next turn").
  _nextOwnTurn(pid) {
    const s = this.state
    const n = s.players.length
    const dist = (pid - s.activePlayer + n) % n
    return s.turnNumber + (dist === 0 ? n : dist)
  },

  // Condition vocabulary for intervening-if triggers (603.4) and conditional
  // effects. `w` is the source permanent. Ranges are { min, max, eq }.
  _cond(cond, w) {
    if (!cond) return true
    const s = this.state
    const pid = w?.controller ?? 0
    const inRange = (v, r) => (r.min == null || v >= r.min) && (r.max == null || v <= r.max) && (r.eq == null || v === r.eq)
    if (cond.kicked != null) return !!w?.kicked === cond.kicked
    if (cond.controls) {
      const f = cond.controls
      const n = objectsIn(s, 'battlefield').filter(
        (o) =>
          (f.controller === 'any' || o.controller === pid) &&
          (!f.another || o.oid !== w?.oid) &&
          (!f.type || o.chars.types.includes(f.type)) &&
          (!f.subtype || hasSub(o.chars, f.subtype))
      ).length
      return inRange(n, f)
    }
    // "If you control an Urza's Mine and an Urza's Tower": every listed filter matched.
    if (cond.controlsAll)
      return cond.controlsAll.every((f) =>
        objectsIn(s, 'battlefield').some((o) => o.controller === pid && o.oid !== w?.oid && (!f.type || o.chars.types.includes(f.type)) && (!f.subtype || hasSub(o.chars, f.subtype)))
      )
    if (cond.landfall != null) return !!s.players[pid]?.landfall === cond.landfall // a land entered under your control this turn
    if (cond.morbid != null) return !!s.creatureDiedThisTurn === cond.morbid // "if a creature died this turn"
    if (cond.noLandsInHand != null) return zone(s, 'hand', pid).every((h) => !s.objects[h].printed.types.includes('Land')) === cond.noLandsInHand
    if (cond.gifted != null) return !!w?.gifted === cond.gifted // "if the gift was promised"
    if (cond.bargained != null) return !!w?.bargained === cond.bargained // "if it was bargained"
    if (cond.evidence != null) return !!w?.evidenceCollected === cond.evidence
    if (cond.attached != null) return (w?.status?.attachedTo != null) === cond.attached // an Equipment's granted trigger
    if (cond.life) return inRange(s.players[pid].life, cond.life)
    if (cond.opponentLife) return this._opponentsOf(pid).some((o) => inRange(s.players[o].life, cond.opponentLife))
    if (cond.handSize) return inRange(zone(s, 'hand', pid).length, cond.handSize)
    if (cond.graveyard) return inRange(zone(s, 'graveyard', pid).length, cond.graveyard)
    if (cond.spellsCastThisTurn) return inRange(s.spellsCastThisTurn || 0, cond.spellsCastThisTurn)
    if (cond.counters) return inRange(w?.status?.counters?.[cond.counters.counter] || 0, cond.counters)
    if (cond.untapped != null) return !w?.status?.tapped === cond.untapped // "when this enters untapped"
    if (cond.classLevel) return inRange(w?.status?.classLevel || 1, cond.classLevel) // a Class's level (716)
    if (cond.ringTempts) return inRange(s.players[pid].ringTempts || 0, cond.ringTempts) // the Ring's levels (701.54c)
    if (cond.day != null) return (s.daytime === 'day') === cond.day
    if (cond.night != null) return (s.daytime === 'night') === cond.night
    // Designations (725/726) and dungeons (309): "as long as you're the monarch",
    // "if you have the initiative", "as long as you've completed a dungeon",
    // "unless defending player is the monarch" (some opponent is).
    if (cond.monarch != null) return (s.monarch === pid) === cond.monarch
    if (cond.initiative != null) return (s.initiative === pid) === cond.initiative
    if (cond.completedDungeon != null) return (s.players[pid].completedDungeons || 0) > 0 === cond.completedDungeon
    if (cond.opponentMonarch != null) return (s.monarch != null && s.monarch !== pid && !s.players[s.monarch].hasLost) === cond.opponentMonarch
    return true
  },

  // Number of artifacts a player controls (affinity / metalcraft).
  _artifactCount(pid) {
    return objectsIn(this.state, 'battlefield').filter(
      (o) => o.controller === pid && o.chars.types.includes('Artifact')
    ).length
  },

  // `extra`: delve/convoke sources; `exclude`: a source that can't help pay
  // (a permanent tapping itself as part of the same cost).
  _canPay(pid, cost, extra = [], exclude = null, printed = null) {
    const p = this.state.players[pid]
    const sources = this._manaSources(pid, printed).filter((x) => x.oid !== exclude)
    return this._planPayment(cost, [...extra, ...sources], p.manaPool, p.life, this._usableRestricted(pid, printed)) != null
  },

  _pay(pid, cost, extra = [], exclude = null, printed = null, picks = null) {
    const s = this.state
    const p = s.players[pid]
    const sources = this._manaSources(pid, printed).filter((x) => x.oid !== exclude)
    const usableR = this._usableRestricted(pid, printed)
    const plan = this._planPayment(cost, [...extra, ...sources], p.manaPool, p.life, usableR, picks)
    if (!plan) throw new Error('cannot pay cost')
    for (const c of Object.keys(plan.spend)) p.manaPool[c] -= plan.spend[c]
    for (const c of Object.keys(plan.spendR)) {
      let k = plan.spendR[c]
      p.restrictedPool = (p.restrictedPool || []).filter((r) => !(k > 0 && r.color === c && usableR.includes(r) && k-- > 0))
    }
    const kindOf = new Map(extra.map((x) => [x.oid, x.kind]))
    const tapped = []
    for (const oid of plan.tap) {
      const kind = kindOf.get(oid)
      if (kind === 'delve') {
        this._log(`${p.name} exiles ${this._objName(s.objects[oid])} from their graveyard (delve)`)
        moveObject(s, oid, 'exile')
      } else {
        this._setTapped(s.objects[oid], true) // mana sources and convoked creatures
        tapped.push(this._objName(s.objects[oid]))
      }
    }
    if (tapped.length) this._log(`${p.name} taps ${tapped.join(', ')}`)
    // Mana a tapped source produced but this cost didn't need stays in the pool.
    const spilled = []
    for (const f of plan.float || []) {
      if (f.only) (p.restrictedPool ||= []).push({ color: f.color, only: f.only, source: s.objects[f.oid] })
      else p.manaPool[f.color]++
      spilled.push(`{${f.color}}`)
    }
    if (spilled.length) this._log(`${p.name} has ${spilled.join('')} left in their mana pool`)
    if (plan.life) {
      p.life -= plan.life
      this._log(`${p.name} pays ${plan.life} life (${p.life})`)
    }
  },

  _emptyManaPools() {
    for (const p of this.state.players) {
      p.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
      p.restrictedPool = []
    }
  },

}
