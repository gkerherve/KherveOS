import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { networkInterfaces } from 'node:os'
import type { Plugin } from 'vite'

// The KherveOS server (server/) answers everything under /api, including the
// /api/ws websocket. In dev, Vite proxies to it so the OS and the server share
// one origin and the session cookie just works.
const SERVER = process.env.KHERVEOS_SERVER ?? 'http://127.0.0.1:8787'

// This computer's network addresses, for games played across devices (Kherve Grand Prix
// multiplayer shows them: "tell your friend to open http://192.168.1.20:5173"), and
// whether other devices can reach this dev server at all (only with `vite --host`).
function lanInfo(): Plugin {
  return {
    name: 'kherveos-lan-info',
    configureServer(server) {
      server.middlewares.use('/__kherveos/lan', (_req, res) => {
        const addresses = Object.values(networkInterfaces())
          .flat()
          .filter((a) => a && a.family === 'IPv4' && !a.internal)
          .map((a) => a!.address)
        const host = server.config.server.host
        const reachable = host === true || (typeof host === 'string' && host !== 'localhost' && !host.startsWith('127.'))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ addresses, port: server.config.server.port ?? 5173, reachable }))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), lanInfo()],
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
  // Pre-bundle every package the apps load on demand, so the dev server never has to
  // re-optimise (and reload the page) the first time Terminal, KherveWord, Plotly… open.
  optimizeDeps: {
    exclude: ['mupdf'],
    include: [
      'lucide-react',
      'zustand',
      '@codemirror/view',
      'fflate',
      '@tiptap/core',
      '@tiptap/pm/state',
      '@tiptap/pm/model',
      'katex',
      '@tiptap/pm/view',
      '@codemirror/state',
      'dompurify',
      '@rdkit/rdkit',
      'marked',
      '@mdi/js',
      '@codemirror/commands',
      'plotly.js-dist-min',
      '@codemirror/language',
      'zustand/react/shallow',
      '@tiptap/starter-kit',
      '@tiptap/react',
      '@tiptap/extension-placeholder',
      '@lezer/highlight',
      '@codemirror/search',
      'zustand/middleware',
      '@tiptap/extension-table',
      '@tiptap/extension-list',
      'three',
      'modern-screenshot',
      'isomorphic-git',
      '@xterm/xterm',
      '@tiptap/pm/transform',
      '@tiptap/extension-superscript',
      '@tiptap/extension-subscript',
      '@codemirror/lang-python',
      '@codemirror/lang-json',
      '@codemirror/lang-javascript',
      'zustand/vanilla',
      'three/examples/jsm/utils/BufferGeometryUtils.js',
      'three/examples/jsm/controls/OrbitControls.js',
      'three/examples/jsm/postprocessing/EffectComposer.js',
      'three/examples/jsm/postprocessing/RenderPass.js',
      'three/examples/jsm/postprocessing/UnrealBloomPass.js',
      'three/examples/jsm/postprocessing/OutputPass.js',
      'three/examples/jsm/environments/RoomEnvironment.js',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/utils/SkeletonUtils.js',
      'openscad-wasm',
      'isomorphic-git/http/web',
      'buffer',
      '@xterm/addon-fit',
      '@tiptap/extension-text-style',
      '@tiptap/extension-text-align',
      '@tiptap/extension-strike',
      '@tiptap/extension-paragraph',
      '@tiptap/extension-image',
      '@tiptap/extension-highlight',
      '@tiptap/extension-heading',
      '@tiptap/extension-code',
      '@codemirror/lang-markdown',
      '@codemirror/autocomplete',
      'planck',
      'delaunator',
      'wavedrom',
    ],
  },
  worker: { format: 'es' },
})
