import React, { useMemo } from 'react'
import { useDeck } from '../store/deck.js'
import { manaValue, isLand, colorIdentity, primaryType, COLOR_META } from '../lib/cardUtils.js'
import { deckCoverage } from '@engine/classify.mjs'

// Deck statistics: totals, mana curve, color breakdown, type counts.
// Rendered with plain CSS/SVG bars — no chart dependency.
export default function DeckStats() {
  const entries = useDeck((s) => s.entries)
  const stats = useMemo(() => computeStats(entries), [entries])
  const coverage = useMemo(() => deckCoverage(entries), [entries])

  if (entries.length === 0) return <div className="stats-panel muted">No stats yet.</div>

  const maxCurve = Math.max(1, ...stats.curve.map((c) => c.count))

  return (
    <div className="stats-panel">
      <h3>Rules-engine coverage</h3>
      <div className="coverage">
        <div className="coverage-bar-wrap" title={`${coverage.supported}/${coverage.total} cards supported`}>
          <div
            className={'coverage-bar' + (coverage.pct === 100 ? ' full' : '')}
            style={{ width: `${coverage.pct}%` }}
          />
          <span className="coverage-pct">{coverage.pct}%</span>
        </div>
        <p className="muted small">
          {coverage.supported}/{coverage.total} cards play under the rules engine.
          {coverage.pct === 100 && ' Fully playable in engine mode.'}
        </p>
        {coverage.unsupported.length > 0 && (
          <details className="coverage-details">
            <summary>{coverage.unsupported.length} unsupported card type(s)</summary>
            <ul className="coverage-list">
              {dedupe(coverage.unsupported).map((r) => (
                <li key={r.name}>
                  <span className="coverage-name">
                    {r.qty}× {r.name}
                  </span>
                  <span className="muted small">{r.category}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <h3>Overview</h3>
      <div className="stat-row">
        <span>Total cards</span>
        <b>{stats.total}</b>
      </div>
      <div className="stat-row">
        <span>Lands</span>
        <b>{stats.lands}</b>
      </div>
      <div className="stat-row">
        <span>Nonland</span>
        <b>{stats.total - stats.lands}</b>
      </div>
      <div className="stat-row">
        <span>Avg. mana value</span>
        <b>{stats.avgMv.toFixed(2)}</b>
      </div>

      <h3>Mana Curve</h3>
      <div className="curve">
        {stats.curve.map((c) => (
          <div className="curve-col" key={c.label}>
            <div className="curve-bar-wrap">
              <div
                className="curve-bar"
                style={{ height: `${(c.count / maxCurve) * 100}%` }}
                title={`${c.count} card(s)`}
              >
                {c.count > 0 && <span className="curve-count">{c.count}</span>}
              </div>
            </div>
            <div className="curve-label">{c.label}</div>
          </div>
        ))}
      </div>
      <p className="muted small">Mana value (lands excluded)</p>

      <h3>Colors</h3>
      <div className="colors">
        {stats.colors.map((c) => (
          <div className="color-row" key={c.key}>
            <span className="color-dot" style={{ background: COLOR_META[c.key]?.hex }} />
            <span className="color-name">{COLOR_META[c.key]?.name || c.key}</span>
            <div className="color-bar-wrap">
              <div
                className="color-bar"
                style={{
                  width: `${(c.count / stats.colorMax) * 100}%`,
                  background: COLOR_META[c.key]?.hex
                }}
              />
            </div>
            <b>{c.count}</b>
          </div>
        ))}
      </div>

      <h3>Card Types</h3>
      <div className="types">
        {stats.types.map((t) => (
          <div className="stat-row" key={t.type}>
            <span>{t.type}</span>
            <b>{t.count}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

// Merge unsupported rows by name (summing quantities).
function dedupe(rows) {
  const map = new Map()
  for (const r of rows) {
    const cur = map.get(r.name)
    if (cur) cur.qty += r.qty
    else map.set(r.name, { ...r })
  }
  return [...map.values()]
}

function computeStats(entries) {
  let total = 0
  let lands = 0
  let mvSum = 0
  let mvCount = 0
  const curveBuckets = [0, 0, 0, 0, 0, 0, 0] // 0,1,2,3,4,5,6+
  const colorCounts = {}
  const typeCounts = {}

  for (const e of entries) {
    // Only the main deck counts toward stats.
    if (e.section === 'sideboard') continue
    const n = e.qty
    total += n
    const land = isLand(e.card)
    if (land) lands += n

    if (!land) {
      const mv = manaValue(e.card)
      mvSum += mv * n
      mvCount += n
      const idx = Math.min(6, Math.floor(mv))
      curveBuckets[idx] += n
    }

    const ci = colorIdentity(e.card)
    if (ci.length === 0) colorCounts.C = (colorCounts.C || 0) + n
    else for (const c of ci) colorCounts[c] = (colorCounts[c] || 0) + n

    const t = primaryType(e.card)
    typeCounts[t] = (typeCounts[t] || 0) + n
  }

  const curve = curveBuckets.map((count, i) => ({
    label: i === 6 ? '6+' : String(i),
    count
  }))

  const colorOrder = ['W', 'U', 'B', 'R', 'G', 'C']
  const colors = colorOrder
    .filter((k) => colorCounts[k])
    .map((k) => ({ key: k, count: colorCounts[k] }))
  const colorMax = Math.max(1, ...colors.map((c) => c.count))

  const types = Object.entries(typeCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  return {
    total,
    lands,
    avgMv: mvCount ? mvSum / mvCount : 0,
    curve,
    colors,
    colorMax,
    types
  }
}
