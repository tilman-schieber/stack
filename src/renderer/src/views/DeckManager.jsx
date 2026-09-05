import React, { useEffect, useRef, useState } from 'react'
import { useDeck } from '../store/deck.js'
import { useNav } from '../store/nav.js'
import { useDecks, missingDefaults } from '../store/decks.js'
import { parseDecklist } from '../lib/deckParser.js'
import { exportDeckText } from '../lib/deckExport.js'

// A "⋯" button with a small popover of secondary actions.
function RowMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <span className="row-menu" ref={ref}>
      <button className="mini" onClick={() => setOpen((v) => !v)} title="More actions" aria-haspopup="menu" aria-expanded={open}>
        ⋯
      </button>
      {open && (
        <div className="row-menu-pop" role="menu">
          {items.map(({ label, onClick, danger, title }) => (
            <button
              key={label}
              role="menuitem"
              className={danger ? 'danger' : ''}
              title={title}
              onClick={() => {
                setOpen(false)
                onClick()
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

// Deck manager: every deck in one list — play or edit any of them; import (paste
// or file), export (clipboard or file), rename, duplicate, delete. The default
// decks the app started with are ordinary decks here; "Restore default decks"
// brings back any that were deleted.
export default function DeckManager() {
  const go = useNav((s) => s.go)
  const play = useNav((s) => s.play)
  const intent = useNav((s) => s.intent)
  const consumeIntent = useNav((s) => s.consumeIntent)
  const decks = useDecks((s) => s.decks)
  const refresh = useDecks((s) => s.refresh)
  const seeding = useDecks((s) => s.seeding)
  const seedError = useDecks((s) => s.seedError)
  const restoreDefaults = useDecks((s) => s.restoreDefaults)
  const loadSaved = useDeck((s) => s.loadSaved)
  const importParsed = useDeck((s) => s.importParsed)
  const serialize = useDeck((s) => s.serialize)
  const newDeck = useDeck((s) => s.newDeck)

  const [status, setStatus] = useState('') // transient feedback line
  const [renaming, setRenaming] = useState(null) // { slug, name }
  const [confirmDelete, setConfirmDelete] = useState(null) // slug
  const [importing, setImporting] = useState(intent === 'import')
  const [impName, setImpName] = useState('')
  const [impText, setImpText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    refresh()
    if (intent) consumeIntent()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (msg) => {
    setStatus(msg)
    setTimeout(() => setStatus(''), 3000)
  }

  async function edit(slug) {
    await loadSaved(await window.api.loadDeck(slug))
    go('build')
  }

  function createNew() {
    newDeck()
    go('build')
  }

  async function exportClipboard(d) {
    const text = await exportDeckText(await window.api.loadDeck(d.slug))
    await navigator.clipboard.writeText(text)
    flash(`Copied “${d.name}” to the clipboard.`)
  }

  async function exportFile(d) {
    const text = await exportDeckText(await window.api.loadDeck(d.slug))
    const file = await window.api.exportDeckFile(d.name, text)
    if (file) flash(`Exported to ${file}.`)
  }

  async function duplicate(d) {
    const copy = await window.api.duplicateDeck(d.slug)
    await refresh()
    flash(`Duplicated as “${copy.name}”.`)
  }

  async function commitRename() {
    const { slug, name } = renaming
    setRenaming(null)
    if (!name.trim()) return
    try {
      await window.api.renameDeck(slug, name.trim())
      await refresh()
    } catch (err) {
      flash(err.message)
    }
  }

  async function remove(slug) {
    setConfirmDelete(null)
    await window.api.deleteDeck(slug)
    await refresh()
  }

  async function pickFile() {
    const picked = await window.api.importDeckFile()
    if (!picked) return
    setImpText(picked.text)
    if (!impName.trim()) setImpName(picked.name)
  }

  // Import: parse -> resolve via Scryfall (into the builder store) -> save.
  async function doImport(thenEdit) {
    setBusy(true)
    try {
      const parsed = parseDecklist(impText)
      const total = parsed.main.length + parsed.sideboard.length + parsed.commander.length
      if (total === 0) {
        flash(parsed.errors.length ? `Nothing importable — ${parsed.errors.length} unreadable line(s).` : 'Paste a decklist first.')
        return
      }
      newDeck()
      await importParsed(parsed, impName.trim() || 'Imported deck')
      const { entries, notFound } = useDeck.getState()
      if (entries.length === 0) {
        flash(`No cards could be resolved (${notFound.join(', ')}).`)
        return
      }
      const saved = await window.api.saveDeck(serialize())
      await refresh()
      setImporting(false)
      setImpText('')
      setImpName('')
      const problems = notFound.length ? ` ${notFound.length} card(s) not found: ${notFound.join(', ')}.` : ''
      flash(`Imported “${saved.name}” (${entries.reduce((s, e) => s + e.qty, 0)} cards).${problems}`)
      if (thenEdit) go('build')
    } catch (err) {
      flash(err.message)
    } finally {
      setBusy(false)
    }
  }

  const when = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
  }

  const missing = missingDefaults(decks)

  return (
    <div className="deck-manager">
      <div className="dm-head">
        <h2>Decks</h2>
        <div className="dm-actions">
          <button className="primary" onClick={createNew}>
            New deck
          </button>
          <button className="secondary" onClick={() => setImporting((v) => !v)}>
            {importing ? 'Close import' : 'Import…'}
          </button>
          {missing.length > 0 && (
            <button
              className="secondary"
              onClick={restoreDefaults}
              disabled={seeding}
              title={'Adds back: ' + missing.map((d) => d.name).join(', ')}
            >
              {seeding ? 'Restoring…' : `Restore default decks (${missing.length})`}
            </button>
          )}
        </div>
      </div>
      {status && <div className="status-msg">{status}</div>}
      {seedError && <div className="deck-coverage warn">Could not set up the default decks: {seedError}</div>}

      {importing && (
        <div className="dm-import">
          <div className="dm-import-row">
            <label className="field-label">Deck name</label>
            <input value={impName} onChange={(e) => setImpName(e.target.value)} placeholder="Imported deck" />
            <button className="secondary" onClick={pickFile}>
              Open file…
            </button>
          </div>
          <textarea
            value={impText}
            onChange={(e) => setImpText(e.target.value)}
            placeholder={'Paste an Arena / MTGO decklist:\n4 Lightning Bolt\n20 Mountain\n\nSideboard\n2 Skullcrack'}
            rows={12}
            spellCheck={false}
          />
          <div className="dm-import-row">
            <button className="primary" onClick={() => doImport(false)} disabled={busy || !impText.trim()}>
              {busy ? 'Importing…' : 'Import & save'}
            </button>
            <button className="secondary" onClick={() => doImport(true)} disabled={busy || !impText.trim()}>
              Import & edit
            </button>
          </div>
        </div>
      )}

      {decks.length === 0 ? (
        <p className="muted">
          {seeding
            ? 'Setting up the default decks — fetching their cards from Scryfall…'
            : 'No decks. Import a decklist, build one from scratch, or restore the default decks.'}
        </p>
      ) : (
        <div className="dm-scroll">
          <table className="dm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Cards</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {decks.map((d) => (
                <tr key={d.slug}>
                  <td className="dm-name">
                    {renaming?.slug === d.slug ? (
                      <input
                        autoFocus
                        value={renaming.name}
                        onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename()
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        onBlur={commitRename}
                      />
                    ) : (
                      <>
                        <span className="dm-link" onClick={() => edit(d.slug)} title="Open in the builder">
                          {d.name}
                        </span>
                        {d.description && (
                          <div className="dm-desc" title={d.description}>
                            {d.description}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="num">{d.count}</td>
                  <td className="muted small">{when(d.updatedAt)}</td>
                  <td className="dm-row-actions">
                    {confirmDelete === d.slug ? (
                      <>
                        <span className="muted small">Delete “{d.name}”?</span>
                        <button className="mini danger" onClick={() => remove(d.slug)}>
                          Delete
                        </button>
                        <button className="mini" onClick={() => setConfirmDelete(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="mini primary" onClick={() => play(d.slug)} title="Start a game with this deck">
                          Play
                        </button>
                        <button className="mini" onClick={() => edit(d.slug)}>
                          Edit
                        </button>
                        <RowMenu
                          items={[
                            { label: 'Rename', onClick: () => setRenaming({ slug: d.slug, name: d.name }) },
                            { label: 'Duplicate', onClick: () => duplicate(d) },
                            { label: 'Copy list', onClick: () => exportClipboard(d), title: 'Copy the decklist as text' },
                            { label: 'Export file…', onClick: () => exportFile(d), title: 'Save the decklist as a .txt file' },
                            { label: 'Delete', onClick: () => setConfirmDelete(d.slug), danger: true }
                          ]}
                        />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
