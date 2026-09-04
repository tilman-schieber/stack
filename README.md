# Stack — MTG deck builder + rules-enforced play

A cross-platform (Linux/macOS/Windows) Electron desktop app for building Magic: The
Gathering decks and playing them — locally on one screen, or against a friend over
the internet with no server — with a deterministic rules engine enforcing the game.
Card data and images come from [Scryfall](https://scryfall.com/docs/api) and are cached
locally, so everything works offline after the first load.

## Run

```bash
npm install
npm run dev        # launch with hot reload
npm test           # run every headless engine suite (src/shared/engine/*.test.mjs)
npm run build      # production build into out/
```

Package installers: `npm run pack:linux` (AppImage), `pack:mac` (dmg), `pack:win` (nsis).

## Decks tab (deck manager)

Every saved deck in one list. **Import…** a decklist by pasting Arena/MTGO text or opening
a `.txt` file (it is resolved against Scryfall and saved; *Import & edit* opens it in the
builder). Per deck: **Edit** (open in Build), **Rename**, **Duplicate**, **Copy** (decklist
text to the clipboard), **Export…** (to a `.txt` file, with set codes and collector numbers
so the exact printings round-trip), **Delete**.

## Build tab (deck builder)

1. **Import** → paste an Arena/MTGO decklist (or *Load sample*) → *Import deck*. Lines like
   `4 Lightning Bolt`, `4x Lightning Bolt`, `2 Snapcaster Mage (MM2) 42` all work;
   `Sideboard` / `Commander` headers are honored.
2. **Add cards** → search with [Scryfall syntax](https://scryfall.com/docs/syntax)
   (e.g. `t:goblin cmc<=2`) and click a result to add it.
3. Adjust quantities with `–` / `+`; `✕` removes. Hover a card and click 🖼 to pick a
   printing; ♥ favorites a printing (favorites first, drag to reorder; the first favorite is
   the default for future imports — handy for basic lands).
4. **Stats** shows totals, mana curve, colors, types, and **rules-engine coverage** — which
   cards the engine fully supports.
5. Name the deck and **Save** (or **Copy list** for the text). Saved decks reopen offline with
   their exact printings; **Saved decks →** goes to the Decks tab.
6. **Settings** (⚙) filters which printings the art picker shows.

## Play tab

Pick a mode, pick decks (the built-in example decks or any deck you saved), start.

- **Local hot-seat** — two players on one screen, both hands visible.
- **Host online / Join online** — serverless peer-to-peer over WebRTC. The host creates a
  connection code, the guest pastes it and sends back an answer code, and the game
  starts. The host's app runs the rules engine and pushes each player a view with the
  other's hand hidden; the guest's choices are validated by the host's engine. Needs a
  reachable STUN server (Google's public one) and a NAT that isn't symmetric — no relay.

On the board: click a card in hand to cast it (targets are chosen by clicking), click a
land to tap it for mana (or let the engine auto-tap when you cast), click a permanent to
activate an ability, right-click to zoom. Hovering a card fills the **inspector** in the
sidebar: rules text, current P/T, printed vs. granted keywords, counters, damage, and any
"can't attack/block" restriction; a yellow **!** marks a card whose text the engine does not
fully enforce (it plays with its printed characteristics only). Ability menus show what
auto-payment would tap; hybrid and two-brid pips get a "pay each pip with" picker (or
auto-pay). Unplayable hand cards say why on hover; declaring attackers previews total
power and which attackers have no possible blocker.
**Space / Enter** passes priority, **Escape** cancels. **Stops** sets the Magic Online-style steps at which you receive priority;
everything else auto-passes. A public game log runs down the left.

## Rules engine (`src/shared/engine/`)

Pure, UI-agnostic, deterministic (seeded RNG, per-game object ids) and N-player. The whole
game is driven through one call — `engine.choose(answer)` — against `state.pending`, a
typed decision (priority, targets, attackers, blockers, scry, …), and every answer is
validated against what the decision offered. `projectGame(engine, viewerPid)` produces a
serializable, per-viewer redacted view for the UI.

Implemented: the full turn structure and priority system, the stack, London mulligans, mana
(pool, auto- and manual tapping, multi-mana sources, restricted mana, hybrid, Phyrexian and two-brid symbols, X in spell and
activation costs, delve, convoke, kicker, evoke, cycling, buyback, suspend, unearth, echo, {Q}, counter-removal and energy costs), the play/draw choice, combat with
the evasion keywords (flying/reach, fear, intimidate, skulk, shadow, horsemanship, landwalk,
menace, "can't be blocked", protection from colours/types/everything) and attack/block requirements, multiple blockers, first/double
strike (with the second combat damage step), exalted, fight, undying/persist, cascade, rebound, extort, split second, changeling, Vehicles/crew, overload, miracle, battles (Sieges), the attacker's damage assignment order, changing a spell's targets, phasing, banding, mutate, coin flips and dice, conditional ("as long as") statics, "end the turn", trample, deathtouch, lifelink, infect/wither/toxic and poison, planeswalkers, all
seven continuous-effect layers (copy, control, text, types, color, abilities incl. "loses all
abilities", P/T) with timestamp *and* dependency ordering, triggered/activated/static
abilities (blocks, becomes blocked/tapped, draw, discard, life gain/loss, phase triggers;
optional and intervening-if triggers; the controller orders simultaneous triggers),
replacement and prevention effects, regeneration, ward, hexproof/shroud/protection,
flashback, madness, morph, bestow, ninjutsu, plot, omens, storm, split cards, modal and
transforming double-faced cards, Sagas, emblems, Edict effects (the affected player chooses), extra turns/combats/land drops, hand-size modifiers,
"instead of the graveyard" replacements, "enters tapped unless", "can't gain life / be countered / cast / be prevented" statics, the legend rule as a choice, the repeated cleanup step (514.3a),
targeted modal and divided spells, revealing hands and choosing from them (Duress,
Thoughtseize, Peek), choosing a card name (Cabal Therapy, Meddling Mage, Pithing Needle —
any name, with suggestions), "triggers an additional time" (Panharmonicon, Teysa Karlov),
counter and token doubling (Doubling Season, Hardened Scales, Parallel Lives — Sagas trigger
every chapter reached), playing from the top of the library (Future Sight, Experimental
Frenzy, Courser of Kruphix, Mystic Forge — the top card is shown revealed or to its owner),
the monarch and the initiative with their inherent triggers, dungeons (Undercity and the three
Forgotten Realms dungeons: room choices at forks, completion as a state-based action, goad),
partial target legality on resolution, state-based
actions, draws and concessions, multiplayer elimination, and the Commander format (command
zone, tax, 21-damage rule, 40 life).

Designations show up on the board as the real helper cards — the Monarch token, the
Undercity // The Initiative card (its back for the initiative, its front with the current room
for the dungeon), the Adventures in the Forgotten Realms dungeon cards, and planeswalker
emblems — with art from Scryfall that you can cycle like token art.

The built-in Pauper decks are the top three of Paupergeddon Summer 2026 plus the most-played
archetype — Jund Wildfire, White Weenie, Mono Red Rally, Grixis Affinity — and Mono-Red Madness,
every card enforced (sneak, web-slinging, disturb, prepared, connive, flashback by tapping
creatures, Chain Lightning's copy-back, energy equip, "play it until the end of your next turn").

Card characteristics come straight from Scryfall data; only cards whose text implies effects
get an entry in `behaviors.mjs`, written against a small vocabulary of effect ops. Cards
without an entry play with their printed characteristics. Dredge replaces draws; proliferate, the band controller's damage split, a Siege's protector and London mulligan rounds are all real player decisions. Two-Headed Giant is the one variant not implemented (Baldur's Gate Wilderness, the Commander Legends dungeon, is also left out); no
TURN relay, reconnection or spectators online.

Tests are plain Node scripts (`node src/shared/engine/<name>.test.mjs`, or `npm test`).

## Architecture

- **`src/main/`** — Electron main process; owns all network + disk access.
  `scryfall.js` (rate-limited lookups), `db.js` (SQLite card cache + favorites),
  `imageCache.js` (`card://<id>` protocol, lazily cached images), `deckStore.js`
  (saved decks as JSON), `settings.js`.
- **`src/preload/index.js`** — the minimal typed `window.api` (contextIsolation on).
- **`src/renderer/`** — React UI. `views/DeckBuilder.jsx`, `views/PlayArea.jsx`,
  `components/play/*` (setup, board, networking UI), `store/engineGame.js` (game modes:
  local / host / guest), `net/webrtcTransport.js`.
- **`src/shared/engine/`** — the rules engine, shared by the renderer and the tests.

The renderer never touches the network or filesystem directly — everything goes through
`window.api` IPC. `MagicCompRules20260619.txt` is the comprehensive-rules reference the
engine cites.
