// App-wide settings, persisted to userData/settings.json.
import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

const DEFAULTS = {
  // Hide World Championship gold-bordered printings in the art picker.
  ignoreGoldBordered: true,
  // Hide printings that aren't legal in sanctioned paper play (un-sets,
  // oversized, memorabilia, digital-only, etc.).
  ignoreNonTournamentLegal: true,
  // Additional set codes (lowercase) to hide.
  ignoredSets: []
}

let filePath
let settings = null

function file() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'settings.json')
  return filePath
}

async function ensureLoaded() {
  if (settings) return
  try {
    const raw = JSON.parse(await fs.readFile(file(), 'utf8'))
    settings = { ...DEFAULTS, ...raw }
  } catch {
    settings = { ...DEFAULTS }
  }
}

export async function get() {
  await ensureLoaded()
  return { ...settings }
}

export async function set(patch) {
  await ensureLoaded()
  settings = { ...settings, ...patch }
  if (Array.isArray(patch.ignoredSets)) {
    settings.ignoredSets = patch.ignoredSets.map((s) => String(s).toLowerCase().trim()).filter(Boolean)
  }
  const tmp = file() + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2))
  await fs.rename(tmp, file())
  return { ...settings }
}
