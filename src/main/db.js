// SQLite-backed card database (main process). Replaces the earlier JSON caches
// (cardStore.js / printPrefs.js). Stores Scryfall printings + oracle-level card
// data, an FTS index for offline search, ordered favorite printings per card,
// and a reserved (empty) behaviors table for future rules automation.
//
// Images are NOT stored here — they remain files under card-cache/<id>.jpg,
// served via the `card://` protocol. This DB records which printing is favored.
import { app } from 'electron'
import path from 'path'
import { existsSync, readFileSync } from 'fs'
import Database from 'better-sqlite3'

const SCHEMA_VERSION = 1

let db = null

export function init() {
  const dbPath = path.join(app.getPath('userData'), 'mtg.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate()
  migrateFromJson()
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE IF NOT EXISTS prints (
      id                TEXT PRIMARY KEY,
      oracle_id         TEXT,
      name              TEXT,
      set_code          TEXT,
      collector_number  TEXT,
      border_color      TEXT,
      set_type          TEXT,
      digital           INTEGER,
      released_at       TEXT,
      prints_search_uri TEXT,
      json              TEXT NOT NULL,
      fetched_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_prints_oracle ON prints(oracle_id);
    CREATE INDEX IF NOT EXISTS idx_prints_set ON prints(set_code);

    CREATE TABLE IF NOT EXISTS cards (
      oracle_id      TEXT PRIMARY KEY,
      name           TEXT,
      mana_cost      TEXT,
      cmc            REAL,
      type_line      TEXT,
      oracle_text    TEXT,
      colors         TEXT,
      color_identity TEXT,
      power          TEXT,
      toughness      TEXT,
      loyalty        TEXT,
      keywords       TEXT,
      layout         TEXT,
      legalities     TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
      name, type_line, oracle_text, oracle_id UNINDEXED
    );

    -- oracle_id here holds the "oracle key" (oracle_id, or lowercased name as a
    -- fallback) so it matches oracleKey() in index.js. position 0 = import default.
    CREATE TABLE IF NOT EXISTS favorites (
      oracle_id TEXT NOT NULL,
      print_id  TEXT NOT NULL,
      position  INTEGER NOT NULL,
      PRIMARY KEY (oracle_id, print_id)
    );

    -- Reserved for future machine-readable card behavior. Empty for now.
    CREATE TABLE IF NOT EXISTS behaviors (
      oracle_id      TEXT PRIMARY KEY,
      schema_version INTEGER,
      json           TEXT,
      updated_at     TEXT
    );
  `)
  setMeta('schema_version', String(SCHEMA_VERSION))
}

// ---------- meta ----------
function setMeta(key, value) {
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  )
}
function getMeta(key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value
}

// ---------- helpers ----------
function oracleKeyOf(card) {
  return card.oracle_id || card.card_faces?.[0]?.oracle_id || String(card.name || '').toLowerCase()
}
function faceJoin(card, field) {
  if (card[field] != null) return card[field]
  const faces = card.card_faces
  if (Array.isArray(faces)) {
    const vals = faces.map((f) => f[field]).filter((v) => v != null)
    if (vals.length) return vals.join(' // ')
  }
  return null
}

// ---------- card upserts ----------
const putPrintStmt = () =>
  db.prepare(`
    INSERT INTO prints (id, oracle_id, name, set_code, collector_number, border_color,
                        set_type, digital, released_at, prints_search_uri, json, fetched_at)
    VALUES (@id, @oracle_id, @name, @set_code, @collector_number, @border_color,
            @set_type, @digital, @released_at, @prints_search_uri, @json, @fetched_at)
    ON CONFLICT(id) DO UPDATE SET
      oracle_id=excluded.oracle_id, name=excluded.name, set_code=excluded.set_code,
      collector_number=excluded.collector_number, border_color=excluded.border_color,
      set_type=excluded.set_type, digital=excluded.digital, released_at=excluded.released_at,
      prints_search_uri=excluded.prints_search_uri, json=excluded.json, fetched_at=excluded.fetched_at
  `)
const putCardStmt = () =>
  db.prepare(`
    INSERT INTO cards (oracle_id, name, mana_cost, cmc, type_line, oracle_text, colors,
                       color_identity, power, toughness, loyalty, keywords, layout, legalities)
    VALUES (@oracle_id, @name, @mana_cost, @cmc, @type_line, @oracle_text, @colors,
            @color_identity, @power, @toughness, @loyalty, @keywords, @layout, @legalities)
    ON CONFLICT(oracle_id) DO UPDATE SET
      name=excluded.name, mana_cost=excluded.mana_cost, cmc=excluded.cmc,
      type_line=excluded.type_line, oracle_text=excluded.oracle_text, colors=excluded.colors,
      color_identity=excluded.color_identity, power=excluded.power, toughness=excluded.toughness,
      loyalty=excluded.loyalty, keywords=excluded.keywords, layout=excluded.layout,
      legalities=excluded.legalities
  `)

// Upsert Scryfall printing objects into prints + cards (+ fts).
export function putCards(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return
  const now = new Date().toISOString()
  const insertPrint = putPrintStmt()
  const insertCard = putCardStmt()
  const delFts = db.prepare('DELETE FROM cards_fts WHERE oracle_id = ?')
  const insFts = db.prepare(
    'INSERT INTO cards_fts (name, type_line, oracle_text, oracle_id) VALUES (?, ?, ?, ?)'
  )

  const tx = db.transaction((list) => {
    for (const c of list) {
      if (!c || !c.id) continue
      const oracleKey = oracleKeyOf(c)
      insertPrint.run({
        id: c.id,
        oracle_id: oracleKey,
        name: c.name ?? null,
        set_code: c.set ?? null,
        collector_number: c.collector_number ?? null,
        border_color: c.border_color ?? null,
        set_type: c.set_type ?? null,
        digital: c.digital ? 1 : 0,
        released_at: c.released_at ?? null,
        prints_search_uri: c.prints_search_uri ?? null,
        json: JSON.stringify(c),
        fetched_at: now
      })

      const typeLine = faceJoin(c, 'type_line')
      const oracleText = faceJoin(c, 'oracle_text')
      insertCard.run({
        oracle_id: oracleKey,
        name: c.name ?? null,
        mana_cost: faceJoin(c, 'mana_cost'),
        cmc: typeof c.cmc === 'number' ? c.cmc : null,
        type_line: typeLine,
        oracle_text: oracleText,
        colors: JSON.stringify(c.colors ?? c.card_faces?.[0]?.colors ?? []),
        color_identity: JSON.stringify(c.color_identity ?? []),
        power: faceJoin(c, 'power'),
        toughness: faceJoin(c, 'toughness'),
        loyalty: faceJoin(c, 'loyalty'),
        keywords: JSON.stringify(c.keywords ?? []),
        layout: c.layout ?? null,
        legalities: JSON.stringify(c.legalities ?? {})
      })

      delFts.run(oracleKey)
      insFts.run(c.name ?? '', typeLine ?? '', oracleText ?? '', oracleKey)
    }
  })
  tx(cards)
}

// Full Scryfall json for a printing id.
export function getCard(id) {
  const row = db.prepare('SELECT json FROM prints WHERE id = ?').get(id)
  return row ? JSON.parse(row.json) : undefined
}

// Which of the given printing ids are not yet cached.
export function missingIds(ids) {
  if (!ids || ids.length === 0) return []
  const have = new Set()
  const stmt = db.prepare('SELECT id FROM prints WHERE id = ?')
  for (const id of ids) if (stmt.get(id)) have.add(id)
  return ids.filter((id) => !have.has(id))
}

// ---------- favorites (ordered; position 0 = import default) ----------
export function getFavorites(key) {
  const rows = db
    .prepare('SELECT print_id FROM favorites WHERE oracle_id = ? ORDER BY position')
    .all(key)
  return { favorites: rows.map((r) => r.print_id) }
}

function writeFavorites(key, ids) {
  const clean = [...new Set((ids || []).filter(Boolean))]
  const del = db.prepare('DELETE FROM favorites WHERE oracle_id = ?')
  const ins = db.prepare('INSERT INTO favorites (oracle_id, print_id, position) VALUES (?, ?, ?)')
  const tx = db.transaction(() => {
    del.run(key)
    clean.forEach((id, i) => ins.run(key, id, i))
  })
  tx()
}

export function toggleFavorite(key, id) {
  const current = getFavorites(key).favorites
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
  writeFavorites(key, next)
  return getFavorites(key)
}

export function setFavorites(key, ids) {
  writeFavorites(key, ids)
  return getFavorites(key)
}

export function getDefaultPrintId(key) {
  return (
    db.prepare('SELECT print_id FROM favorites WHERE oracle_id = ? AND position = 0').get(key)
      ?.print_id ?? null
  )
}

// ---------- offline search (FTS; UI wiring deferred) ----------
export function searchLocal(query, limit = 20) {
  const q = String(query || '').trim()
  if (!q) return []
  // Prefix-match each term for autocomplete-style search.
  const match = q
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, '') + '*')
    .join(' ')
  return db
    .prepare(
      `SELECT c.oracle_id, c.name, c.type_line
       FROM cards_fts f JOIN cards c ON c.oracle_id = f.oracle_id
       WHERE cards_fts MATCH ? ORDER BY rank LIMIT ?`
    )
    .all(match, limit)
}

// ---------- one-time migration from the old JSON caches ----------
function migrateFromJson() {
  if (getMeta('migrated_json') === '1') return
  try {
    const userData = app.getPath('userData')

    const cardsPath = path.join(userData, 'cards.json')
    if (existsSync(cardsPath)) {
      const obj = JSON.parse(readFileSync(cardsPath, 'utf8'))
      putCards(Object.values(obj))
    }

    const prefsPath = path.join(userData, 'print-prefs.json')
    if (existsSync(prefsPath)) {
      const prefs = JSON.parse(readFileSync(prefsPath, 'utf8'))
      for (const [key, entry] of Object.entries(prefs)) {
        const favs = Array.isArray(entry?.favorites) ? entry.favorites : []
        if (entry?.default && !favs.includes(entry.default)) favs.unshift(entry.default)
        if (favs.length) writeFavorites(key, favs)
      }
    }
  } catch (err) {
    console.error('[db] JSON migration failed:', err.message)
  }
  setMeta('migrated_json', '1')
}
