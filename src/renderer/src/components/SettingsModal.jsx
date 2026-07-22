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
            <p className="muted small">Control which printings show in the art picker.</p>
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
