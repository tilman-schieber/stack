// Scryfall API client for the main process — the shared client plus the
// User-Agent Scryfall asks for (a browser can't send one; the web build uses the
// shared client directly).
import { createScryfallClient } from '../shared/scryfall.mjs'

const client = createScryfallClient({ headers: { 'User-Agent': 'MtgDeckBuilder/0.1' } })

export const resolveByNames = client.resolveByNames
export const resolveByIds = client.resolveByIds
export const search = client.search
export const getPrints = client.getPrints
