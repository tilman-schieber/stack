import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/main/index.js') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.js') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@engine': resolve(import.meta.dirname, 'src/shared/engine')
      }
    },
    server: {
      // Allow importing the shared engine, which lives outside the renderer root.
      fs: { allow: [resolve(import.meta.dirname)] }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [react()]
  }
})
