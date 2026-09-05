import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// In Electron the preload has already put `window.api` in place. In a plain
// browser (the web build) there is no preload, so install the web backend —
// same surface, backed by Scryfall over CORS and IndexedDB.
async function boot() {
  if (!window.api) {
    const { createWebApi } = await import('./web/api.js')
    window.api = await createWebApi()
  }
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

boot()
