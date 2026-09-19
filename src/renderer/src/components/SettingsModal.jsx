import React, { useState } from 'react'
import { useSettings } from '../store/settings.js'

// Configuration for which printings appear in the art picker.
export default function SettingsModal({ onClose }) {
  const s = useSettings()
  const [ignoredText, setIgnoredText] = useState(s.ignoredSets.join(', '))

  function parseSets(text) {
    return [...new Set(text.split(/[\s,]+/).map((x) => x.toLowerCase().trim()).filter(Boolean))]
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>Settings</h2>
            <p className="muted small">Which printings show in the art picker, and how a game sounds.</p>
          </div>
          <button className="del" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <div className="settings-body">
          <label className="setting-row">
            <input
              type="checkbox"
              checked={s.ignoreGoldBordered}
              onChange={(e) => s.update({ ignoreGoldBordered: e.target.checked })}
            />
            <span>
              <b>Ignore gold-bordered sets</b>
              <span className="muted small"> — World Championship decks</span>
            </span>
          </label>

          <label className="setting-row">
            <input
              type="checkbox"
              checked={s.ignoreNonTournamentLegal}
              onChange={(e) => s.update({ ignoreNonTournamentLegal: e.target.checked })}
            />
            <span>
              <b>Ignore non-tournament-legal printings</b>
              <span className="muted small">
                {' '}
                — Un-sets, silver-bordered, oversized, and digital-only (Alchemy/MTGO)
              </span>
            </span>
          </label>

          <label className="setting-row">
            <input type="checkbox" checked={!!s.sounds} onChange={(e) => s.update({ sounds: e.target.checked })} />
            <span>
              <b>Table sounds</b>
              <span className="muted small"> — a card landing, a permanent tapping, damage</span>
            </span>
          </label>

          <div className="setting-field">
            <label className="field-label">Table speed</label>
            <select value={s.tableSpeed || 'normal'} onChange={(e) => s.update({ tableSpeed: e.target.value })}>
              <option value="instant">Instant — no pauses at all</option>
              <option value="brisk">Brisk</option>
              <option value="normal">Normal</option>
              <option value="relaxed">Relaxed</option>
            </select>
            <p className="muted small">
              How long the game pauses between the things it does on its own — a spell resolving, the turn
              changing, the computer taking a move. It never delays anything you do.
            </p>
          </div>

          <div className="setting-field">
            <label className="field-label">Additional set codes to ignore</label>
            <input
              type="text"
              value={ignoredText}
              placeholder="e.g. sld, plst, 30a"
              onChange={(e) => setIgnoredText(e.target.value)}
              onBlur={() => s.update({ ignoredSets: parseSets(ignoredText) })}
            />
            <p className="muted small">
              Comma- or space-separated Scryfall set codes. Applied when you click away.
            </p>
          </div>
        </div>

        <footer className="modal-footer">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}
