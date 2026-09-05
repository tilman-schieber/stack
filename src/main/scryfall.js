// Scryfall API client for the main process — the shared client plus the
// User-Agent Scryfall asks for (a browser can't send one; the web build uses the
// shared client directly).
import { createScryfallClient } from '../shared/scryfall.mjs'

const client = createScryfallClient({ headers: { 'User-Agent': 'Stack/0.2 (github.com/tilman-schieber/stack)' } })

export const resolveByNames = client.resolveByNames
export const resolveByIds = client.resolveByIds
export const search = client.search
export const getPrints = client.getPrints
