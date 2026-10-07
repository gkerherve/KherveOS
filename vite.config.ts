import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// The KherveOS server (server/) answers everything under /api, including the
// /api/ws websocket. In dev, Vite proxies to it so the OS and the server share
// one origin and the session cookie just works.
const SERVER = process.env.KHERVEOS_SERVER ?? 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // xfwd: the server sees the real client address (games may only be started from this machine).
      '/api': { target: SERVER, ws: true, xfwd: true },
    },
  },
  // MuPDF's recommended setup: its wasm loader must not be pre-bundled.
  optimizeDeps: { exclude: ['mupdf'] },
  worker: { format: 'es' },
})
