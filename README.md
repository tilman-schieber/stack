# MTG Deck Builder

A cross-platform (Linux/macOS/Windows) Electron desktop app for building Magic: The
Gathering decks from plain-text Arena decklists. Card data and high-res images come
from [Scryfall](https://scryfall.com/docs/api); images are cached locally so decks
render offline after a first load.

This is **phase 1** of a larger goal — a playable MTG game vs. other players / AI. The
deck builder is the foundation; the play area and rules engine come later. The bundled
`MagicCompRules20260619.txt` is the seed reference for that future rules engine.

## Run

```bash
npm install
npm run dev        # launch with hot reload
```

Package installers:

```bash
npm run pack:linux   # AppImage
npm run pack:mac     # dmg
npm run pack:win     # nsis
```

## Usage

1. **Import** tab → paste an Arena/MTGO decklist (or click *Load sample*) → *Import deck*.
   Lines like `4 Lightning Bolt`, `4x Lightning Bolt`, `Lightning Bolt`, and
   `2 Snapcaster Mage (MM2) 42` all work. `Sideboard` / `Commander` headers are honored.
2. **Add cards** tab → search with [Scryfall query syntax](https://scryfall.com/docs/syntax)
   (e.g. `t:goblin cmc<=2`) and click a result to add it.
3. Adjust quantities with the `–` / `+` buttons on each card; `✕` removes it.
4. **Change art** — hover a card and click the 🖼 button to open the printing picker.
   Click any printing to use it for that card. Mark printings ♥ to **favorite** them:
   favorites appear first and can be **dragged to reorder**. The **first favorite is
   the default** printing used on future imports (great for basic lands). Preferences
   persist per card.
5. **Stats** tab shows totals, mana curve, color breakdown, and type counts.
6. Name the deck in the sidebar and **Save**. Saved decks reopen fully offline and
   remember the exact printing chosen for each card.
7. **Settings** (⚙ in the sidebar) controls which printings appear in the art picker:
   ignore gold-bordered (World Championship) sets, ignore non-tournament-legal
   printings (un-sets, silver-bordered, oversized, digital-only Alchemy/MTGO), and
   an optional list of additional set codes to hide. Favorites and a card's current
   printing are always shown even if a filter would otherwise hide them.

## Play (manual two-player hotseat board)

Switch to the **Play** tab in the top bar. Pick two saved decks and **Start game** — each
player draws 7 from a shuffled library. The board is manual (no rules enforcement):

- **Drag** cards between hand, battlefield, graveyard, exile, and library (drop onto the
  piles or the felt). On the battlefield, place cards anywhere; **click** a card to tap
  (rotate 90°).
- **Right-click** a card for actions: tap, ±counters, flip (transform/DFC → back art),
  face-down, duplicate (token), move to any zone, create token (Scryfall search).
- **Player panel**: life (+/- or type), poison/energy counters, and library/graveyard/exile
  piles (click to browse/search; library viewer supports tutoring and scrying).
- **Turn bar** (light assist, no enforcement): untap-all, draw, mulligan, next-phase pills,
  and **Pass turn** (flips the active player, untaps them, draws for turn). Seats swap so the
  active player is always on the bottom with their hand shown.
- The in-progress game **auto-saves** to `localStorage` and restores on reload.

Not yet implemented: networked/AI opponents, rules/mana/combat enforcement, the stack.

## Architecture

- **`src/main/`** — Electron main process. Owns all network + disk access:
  - `scryfall.js` — rate-limited batch card lookup (`POST /cards/collection`) + search.
  - `imageCache.js` — a `card://<scryfallId>` custom protocol that lazily downloads and
    caches card images to `userData/card-cache/`.
  - `deckStore.js` — named decks as JSON in `userData/decks/`.
  - `cardStore.js` — resolved card metadata cache (`userData/cards.json`).
- **`src/preload/index.js`** — exposes a minimal typed `window.api` (contextIsolation on).
- **`src/renderer/`** — React UI (zustand store, deck parser, grid/stats/search/sidebar).

The renderer never touches the network or filesystem directly — everything goes through
`window.api` IPC.
