// LaTeX to PDF, compiled by the KherveOS server with tectonic
// (server/kherveos_server/latex.py). Used by KherveTeX, and by KherveSlide
// and KherveNote.
//
//   const r = await compileLatex('document.tex', {
//     'document.tex': source,              // text files as strings
//     'figures/figure_001.png': pngBytes,  // anything else as bytes
//   })
//   if (r.pdf) show(r.pdf)    // ok is true even with recoverable TeX errors,
//   r.errors                  // which are listed here ({line, file, message})
//   r.log                     // the full compile log, for a console
//
// It never throws: a server that is down, a missing sign-in or a request the
// server refuses come back as ok: false with the reason in `log` and `errors`.

import { ApiError, api } from '../server'

export interface LatexError {
  /** Line in `file` (the main file when absent). */
  line?: number
  file?: string
  message: string
}

export interface LatexResult {
  ok: boolean
  pdf?: Uint8Array
  log: string
  errors: LatexError[]
}

export interface LatexStatus {
  available: boolean
  engine: string | null
  sandbox: string | null
}

type FileSpec = { text: string } | { base64: string }

export async function compileLatex(main: string, files: Record<string, string | Uint8Array>): Promise<LatexResult> {
  const payload: Record<string, FileSpec> = {}
  for (const [name, content] of Object.entries(files)) {
    payload[name] = typeof content === 'string' ? { text: content } : { base64: bytesToBase64(content) }
  }
  try {
    const r = await api<{ ok: boolean; pdf?: string; log?: string; errors?: LatexError[] }>('/latex/compile', {
      body: { main, files: payload },
    })
    return {
      ok: !!r.ok,
      pdf: r.ok && r.pdf ? base64ToBytes(r.pdf) : undefined,
      log: r.log ?? '',
      errors: Array.isArray(r.errors) ? r.errors : [],
    }
  } catch (e) {
    const message = describe(e)
    return { ok: false, log: message, errors: [{ message }] }
  }
}

/** Is LaTeX available on the server (null when the server can't be asked)? */
export async function latexStatus(): Promise<LatexStatus | null> {
  try {
    return await api<LatexStatus>('/latex/status')
  } catch {
    return null
  }
}

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'The KherveOS server is not reachable, so LaTeX cannot be compiled.'
    if (e.status === 401) return 'Sign in to KherveOS to compile LaTeX: the server typesets it.'
    return e.message
  }
  return e instanceof Error ? e.message : String(e)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
