// App-wide settings, persisted to userData/settings.json.
import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { SETTINGS_DEFAULTS, mergeSettings } from '../shared/backend.mjs'

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
    settings = { ...SETTINGS_DEFAULTS, ...raw }
  } catch {
    settings = { ...SETTINGS_DEFAULTS }
  }
}

export async function get() {
  await ensureLoaded()
  return { ...settings }
}

export async function set(patch) {
  await ensureLoaded()
  settings = mergeSettings(settings, patch)
  const tmp = file() + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2))
  await fs.rename(tmp, file())
  return { ...settings }
}
