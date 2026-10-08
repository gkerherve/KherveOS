// Reading arduino-cli's output (pure: no React, no "@/" imports). The server sends the
// same things already parsed (`diagnostics`, `size`); this is the fallback for an older
// server, and what the tests check against canned compiler output.

export interface Diagnostic {
  /** The sketch file ("sketch.ino" is the main one) or, for `external`, the path as printed. */
  file: string
  line: number
  col: number
  severity: 'error' | 'warning' | 'note'
  message: string
  /** From a library or the core: there is no tab to show it in. */
  external?: boolean
}

export interface SizeInfo {
  flash?: number
  flashMax?: number | null
  ram?: number
  ramMax?: number | null
}

export interface CompileResult {
  ok: boolean
  cli: boolean
  output: string
  diagnostics: Diagnostic[]
  size: SizeInfo | null
  uploaded?: boolean
  port?: string
  ports?: { address: string; protocol: string; label: string }[]
}

export const MAIN_FILE = 'sketch.ino'

const DIAG = /^(.+?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.*)$/

function ownName(path: string, names: Set<string>): string | null {
  const p = path.replace(/\\/g, '/')
  if (p.includes('/libraries/') || p.includes('/cores/') || p.includes('/packages/')) return null
  let base = p.slice(p.lastIndexOf('/') + 1)
  if (base.endsWith('.ino.cpp')) base = base.slice(0, -4)
  return names.has(base) ? base : null
}

/** gcc-style `file:line:col: error: message` lines. */
export function parseDiagnostics(output: string, names: string[] = [MAIN_FILE]): Diagnostic[] {
  const own = new Set(names)
  const out: Diagnostic[] = []
  for (const raw of output.split('\n')) {
    const m = DIAG.exec(raw.trim())
    if (!m) continue
    const mine = ownName(m[1], own)
    const d: Diagnostic = {
      file: mine ?? m[1],
      line: Number(m[2]),
      col: m[3] ? Number(m[3]) : 1,
      severity: m[4] === 'warning' ? 'warning' : m[4] === 'note' ? 'note' : 'error',
      message: m[5].trim(),
    }
    if (mine === null) d.external = true
    if (!out.some((o) => o.file === d.file && o.line === d.line && o.col === d.col && o.message === d.message)) out.push(d)
    if (out.length >= 200) break
  }
  return out
}

/** "Sketch uses N bytes (x%) …" and "Global variables use N bytes …". */
export function parseSize(output: string): SizeInfo | null {
  const size: SizeInfo = {}
  const f = /Sketch uses (\d+) bytes(?: \(\d+%\))?(?: of program storage space\.?)?(?: Maximum is (\d+) bytes)?/i.exec(output)
  if (f) {
    size.flash = Number(f[1])
    size.flashMax = f[2] ? Number(f[2]) : null
  }
  const r = /Global variables use (\d+) bytes(?: \(\d+%\))?(?: of dynamic memory)?(?:, leaving \d+ bytes for local variables)?(?:\. Maximum is (\d+) bytes)?/i.exec(output)
  if (r) {
    size.ram = Number(r[1])
    size.ramMax = r[2] ? Number(r[2]) : null
  }
  return size.flash !== undefined || size.ram !== undefined ? size : null
}

export interface SizeBar {
  label: string
  used: number
  max: number | null
  /** 0–100, or null when the maximum is not known. */
  percent: number | null
}

/** The bars to draw for a sketch's size. */
export function sizeBars(size: SizeInfo | null): SizeBar[] {
  if (!size) return []
  const bar = (label: string, used: number | undefined, max: number | null | undefined): SizeBar[] =>
    used === undefined ? [] : [{ label, used, max: max ?? null, percent: max ? Math.min(100, Math.round((used / max) * 1000) / 10) : null }]
  return [...bar('Program storage', size.flash, size.flashMax), ...bar('Dynamic memory (RAM)', size.ram, size.ramMax)]
}

export function formatBytes(n: number): string {
  return n >= 10_000 ? `${(n / 1024).toFixed(1)} kB` : `${n} B`
}

/** What the server answered, completed from the raw output when an older server leaves things out. */
export function normalizeResult(raw: Partial<CompileResult> & { output?: string }, names: string[]): CompileResult {
  const output = String(raw.output ?? '')
  return {
    ...raw,
    ok: !!raw.ok,
    cli: raw.cli !== false,
    output,
    diagnostics: Array.isArray(raw.diagnostics) ? raw.diagnostics : parseDiagnostics(output, names),
    size: raw.size === undefined ? parseSize(output) : raw.size,
  }
}

export const errorCount = (d: Diagnostic[]) => d.filter((x) => x.severity === 'error').length
export const warningCount = (d: Diagnostic[]) => d.filter((x) => x.severity === 'warning').length
