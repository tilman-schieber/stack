// Web build: the same renderer as the Electron app, served as a static site.
// `npm run dev:web` / `npm run build:web` (output in dist/web, relative asset
// paths so it can live under any path). No main process: the renderer talks to
// Scryfall directly and keeps its data in IndexedDB (src/renderer/src/web/).
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, 'src/renderer')

// The Electron page's CSP confines all network access to the main process; the
// web page must be allowed to reach Scryfall's API and image host instead.
const WEB_CSP = [
  "default-src 'self'",
  "img-src 'self' data: https://cards.scryfall.io https://api.scryfall.com",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self' https://api.scryfall.com stun: turn: turns:"
].join('; ')

function webCsp() {
  return {
    name: 'stack:web-csp',
    transformIndexHtml(html) {
      const re = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/
      if (!re.test(html)) throw new Error('index.html has no Content-Security-Policy meta tag to rewrite')
      return html.replace(re, `$1${WEB_CSP}$2`)
    }
  }
}

export default defineConfig({
  root,
  base: './',
  resolve: {
    alias: { '@engine': resolve(import.meta.dirname, 'src/shared/engine') }
  },
  server: {
    // Allow importing the shared engine, which lives outside the renderer root.
    fs: { allow: [resolve(import.meta.dirname)] }
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true
  },
  plugins: [react(), webCsp()]
})
