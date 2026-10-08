// OpenSCAD compiled to WebAssembly (npm openscad-wasm, OpenSCAD 2025 with the
// Manifold backend), off the main thread. One run = one fresh instance (the
// Emscripten program cannot be called twice); the fonts KherveCAD's text uses
// (Liberation, OpenSCAD's default) are written into each instance.
//
//   → { id, code, format: 'binstl' | 'stl' | 'off' | '3mf' | 'amf' | 'dxf' | 'svg', defines }
//   ← { id, ok, data?: Uint8Array, stderr }

import { createOpenSCAD } from 'openscad-wasm'

interface Job {
  id: number
  code: string
  format: string
  defines?: Record<string, string>
  fontBase: string
}

const FONTS = [
  'LiberationSans-Regular.ttf',
  'LiberationSans-Bold.ttf',
  'LiberationSans-Italic.ttf',
  'LiberationSans-BoldItalic.ttf',
  'LiberationSerif-Regular.ttf',
  'LiberationMono-Regular.ttf',
]

let fonts: Promise<[string, Uint8Array][]> | null = null

function loadFonts(base: string) {
  fonts ??= Promise.all(
    FONTS.map(async (name) => {
      const r = await fetch(base + name)
      return [name, new Uint8Array(r.ok ? await r.arrayBuffer() : new ArrayBuffer(0))] as [string, Uint8Array]
    }),
  ).catch(() => [])
  return fonts
}

const FONTS_CONF = `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/fonts</dir></fontconfig>`

async function run(job: Job) {
  const lines: string[] = []
  const inst = await createOpenSCAD({
    noInitialRun: true,
    print: (s: string) => lines.push(s),
    printErr: (s: string) => lines.push(s),
  })
  const o = inst.getInstance()
  try {
    o.FS.mkdir('/fonts')
    for (const [name, bytes] of await loadFonts(job.fontBase)) if (bytes.length) o.FS.writeFile(`/fonts/${name}`, bytes)
    o.FS.writeFile('/fonts/fonts.conf', FONTS_CONF)
  } catch {
    /* text renders without fonts fail with a message; everything else works */
  }
  o.FS.writeFile('/in.scad', job.code)
  const binary = job.format === 'binstl'
  const ext = binary ? 'stl' : job.format
  const out = `/out.${ext}`
  const args = [
    '/in.scad', '-o', out, '--backend=Manifold',
    ...(binary ? ['--export-format', 'binstl'] : []),
    ...Object.entries(job.defines ?? {}).flatMap(([k, v]) => ['-D', `${k}=${v}`]),
  ]
  let rc = 1
  try {
    rc = o.callMain(args)
  } catch (e) {
    lines.push(String(e instanceof Error ? e.message : e))
  }
  let data: Uint8Array | undefined
  try {
    data = o.FS.readFile(out, { encoding: 'binary' })
  } catch {
    data = undefined
  }
  const stderr = lines.join('\n')
  const ok = rc === 0 && !!data && data.length > 0
  return { id: job.id, ok, data: ok ? data : undefined, stderr }
}

self.onmessage = async (e: MessageEvent<Job>) => {
  const job = e.data
  try {
    const r = await run(job)
    ;(self as unknown as Worker).postMessage(r, r.data ? [r.data.buffer] : [])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id: job.id, ok: false, stderr: String(err instanceof Error ? err.message : err) })
  }
}
