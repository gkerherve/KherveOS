// The exact theme under the canvas, as on the desktop: the presentation with
// every slide's own objects removed is compiled by the LaTeX service, and page
// i of that PDF (title bar, head/foot lines, numbers, background, master) is
// drawn under slide i's boxes. Recompiled a moment after the theme, a title,
// a background or the master changes; while there is none (no server, not
// signed in, still compiling) the canvas draws its HTML approximation (look.ts).

import { useEffect, useRef, useState } from 'react'
import { compileLatex } from '@/os/services/latex'
import { openPdf } from '@/os/services/pdf'
import type { Deck } from './model'
import { backdropBundle, type Media } from './media'

export type BackdropState = 'off' | 'waiting' | 'compiling' | 'ready' | 'failed'

export interface Backdrop {
  /** Page pictures (object URLs), page i = slide i; null until compiled. */
  pages: (string | null)[] | null
  state: BackdropState
  error: string
}

const WIDTH = 1280
const DEBOUNCE_MS = 1200

async function render(pdfBytes: Uint8Array): Promise<string[]> {
  const pdf = await openPdf(pdfBytes)
  try {
    const out: string[] = []
    for (let i = 0; i < pdf.pageCount; i++) {
      const info = pdf.pages[i]
      const bmp = await pdf.renderPage(i, WIDTH / info.width, { annotations: false, priority: 'low' })
      const c = document.createElement('canvas')
      c.width = bmp.width
      c.height = bmp.height
      c.getContext('2d')!.drawImage(bmp, 0, 0)
      bmp.close()
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
      out.push(blob ? URL.createObjectURL(blob) : '')
    }
    return out
  } finally {
    pdf.close()
  }
}

export function useBackdrop(deck: Deck, media: Media, enabled: boolean): Backdrop {
  const [state, setState] = useState<Backdrop>({ pages: null, state: enabled ? 'waiting' : 'off', error: '' })
  const lastTex = useRef('')
  const lastKey = useRef('')
  const pagesRef = useRef<string[]>([])
  const run = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unavailable = useRef(false)

  useEffect(() => {
    if (!enabled) {
      setState({ pages: null, state: 'off', error: '' })
      lastTex.current = ''
      lastKey.current = ''
      unavailable.current = false
      return
    }
    // Only what the backdrop shows matters: moving a box must not recompile it.
    const key = JSON.stringify({ ...deck, slides: deck.slides.map((s) => [s.title, s.bg, s.bg_alpha, s.free]) })
    if (key === lastKey.current || unavailable.current) return
    lastKey.current = key
    const id = ++run.current
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const b = await backdropBundle(deck, media)
      if (id !== run.current) return
      if (b.tex === lastTex.current) {
        setState((s) => (s.state === 'compiling' ? { ...s, state: s.pages ? 'ready' : 'failed' } : s))
        return
      }
      setState((s) => ({ ...s, state: 'compiling' }))
      const r = await compileLatex('presentation.tex', b.files)
      if (id !== run.current) return
      if (!r.ok || !r.pdf) {
        lastTex.current = b.tex
        // No server or not signed in: stop asking until the exact theme is switched on again.
        if (r.log.includes('not reachable') || r.log.includes('Sign in')) unavailable.current = true
        setState((s) => ({ ...s, state: 'failed', error: r.errors[0]?.message ?? 'The theme could not be compiled.' }))
        return
      }
      try {
        const pages = await render(r.pdf)
        if (id !== run.current) {
          pages.forEach((u) => u && URL.revokeObjectURL(u))
          return
        }
        pagesRef.current.forEach((u) => u && URL.revokeObjectURL(u))
        pagesRef.current = pages
        lastTex.current = b.tex
        setState({ pages: deck.slides.map((_, i) => pages[i] || null), state: 'ready', error: '' })
      } catch (e) {
        setState((s) => ({ ...s, state: 'failed', error: e instanceof Error ? e.message : String(e) }))
      }
    }, lastTex.current ? DEBOUNCE_MS : 200)
  }, [deck, media, enabled])

  useEffect(
    () => () => {
      run.current++
      if (timer.current) clearTimeout(timer.current)
      pagesRef.current.forEach((u) => u && URL.revokeObjectURL(u))
    },
    [],
  )
  return state
}
