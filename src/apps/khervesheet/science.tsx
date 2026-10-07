// The Science menu's tools (the desktop's science.py): a non-modal dialog
// per tool with Output ("Add results to:"), Data (X, Y) and Options, the
// Solver-style cell picking (the focused field follows the grid selection),
// and "Compute & Write", which writes the result columns (header, then the
// values as "%.6g") starting at the chosen cell, in one undoable step. The
// numbers come from the desktop's own _compute code, run in this window's
// Python (ksweb.bridge.op_science).

import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { os } from '@/os'
import type { Book } from './book'
import { FloatWin } from './dialogs'
import { colName, key, parseRange, usedExtent, type Range } from './model'
import { fmt6g } from './ops'

/** Tools computed in the web edition (the desktop's science.TOOLS). */
export const WEB_SCIENCE = new Set(['Normalisation', 'Integration', 'Derivative', 'Smooth', 'FFT', 'Interpolation', 'Find Peaks'])

/** "$A$2:$A$500" (solver._selection_ref_str). */
function absRef(g: Range): string {
  const a = (r: number, c: number) => `$${colName(c)}$${r + 1}`
  return g.r1 === g.r2 && g.c1 === g.c2 ? a(g.r1, g.c1) : `${a(g.r1, g.c1)}:${a(g.r2, g.c2)}`
}

function values(book: Book, text: string): (number | null)[] | null {
  const sh = book.active
  const g = parseRange(text.replace(/\$/g, ''), sh.rows, sh.cols)
  if (!g) return null
  const out: (number | null)[] = []
  for (let r = g.r1; r <= g.r2; r++)
    for (let c = g.c1; c <= g.c2; c++) {
      const cell = sh.cells.get(key(r, c))
      const v = cell ? (cell.n ?? (cell.t.trim() ? Number(cell.t) : NaN)) : NaN
      out.push(Number.isFinite(v) ? v : null)
    }
  return out
}

type Field = 'out' | 'x' | 'y'

export function ScienceDialog({ book, tool, root, onClose }: { book: Book; tool: string; root: HTMLElement | null; onClose: () => void }) {
  const sel = useStore(book.store, (s) => s.sel)
  const [out, setOut] = useState('')
  const [x, setX] = useState('')
  const [y, setY] = useState(() => {
    const g = book.active.sel.ranges[0]
    return g.r1 === g.r2 && g.c1 === g.c2 ? '' : absRef(g)
  })
  const [active, setActive] = useState<Field>('y')
  const [opts, setOpts] = useState<Record<string, string | number>>({
    lo: 0, hi: 1, mode: 0, order: 0, method: 0, window: 5, poly: 2, kind: tool === 'Interpolation' ? 'linear' : 'Magnitude', points: 200, height: '', prominence: '', distance: 1,
  })
  const [busy, setBusy] = useState(false)
  const first = useRef(true)

  // The focused reference field follows the grid selection (_on_sheet_selection).
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const g = sel.ranges[sel.ranges.length - 1]
    const ref = absRef(g)
    if (active === 'out') setOut(ref)
    else if (active === 'x') setX(ref)
    else setY(ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  const start = (): { r: number; c: number } => {
    const g = out.trim() ? parseRange(out.replace(/\$/g, '').split(',')[0], book.active.rows, book.active.cols) : null
    if (g) return { r: g.r1, c: g.c1 }
    return { r: 0, c: usedExtent(book.active).cols + 1 }
  }
  const s0 = start()
  const set = (k: string, v: string | number) => setOpts({ ...opts, [k]: v })
  const num = (v: string | number) => Number(String(v).replace(',', '.'))

  const apply = async () => {
    const yv = values(book, y)
    if (!yv || !yv.length) return void os.dialog.alert('Select a Y range first.', { title: tool })
    const xv = x.trim() ? values(book, x) : null
    if (x.trim() && !xv) return void os.dialog.alert(`"${x}" is not a range.`, { title: tool })
    const o: Record<string, unknown> = {
      lo: num(opts.lo), hi: num(opts.hi), mode: Number(opts.mode), order: Number(opts.order), method: Number(opts.method), window: Number(opts.window),
      poly: Number(opts.poly), kind: opts.kind, points: Number(opts.points), distance: Number(opts.distance),
      height: String(opts.height).trim() && Number.isFinite(num(opts.height)) ? num(opts.height) : null,
      prominence: String(opts.prominence).trim() && Number.isFinite(num(opts.prominence)) ? num(opts.prominence) : null,
    }
    const needsScipy = (tool === 'Integration' && o.mode === 0) || (tool === 'Smooth' && o.method === 1) || tool === 'Interpolation' || tool === 'Find Peaks'
    setBusy(true)
    try {
      const a = await book.bridge.call('science', { tool, x: xv, y: yv, opts: o }, needsScipy ? ['scipy'] : ['numpy'])
      if (!a.ok) return void os.dialog.alert(`Computation failed:\n${a.error ?? ''}`, { title: tool })
      const cols = (a.columns as [string, (number | null)[]][]) ?? []
      if (a.message) await os.dialog.alert(String(a.message), { title: tool })
      if (!cols.length) return
      const sh = book.active
      const { r, c } = start()
      const cells: [number, number, string][] = []
      cols.forEach(([header, vals], j) => {
        cells.push([r, c + j, header])
        vals.forEach((v, k) => {
          if (v !== null && Number.isFinite(v)) cells.push([r + 1 + k, c + j, fmt6g(v)])
        })
      })
      await book.setCells(sh, cells, tool)
      await os.dialog.alert(`Wrote ${cols.length} column(s) starting at ${colName(c)}${r + 1}.`, { title: tool })
    } finally {
      setBusy(false)
    }
  }

  const ref = (f: Field, value: string, setter: (v: string) => void, placeholder: string) => (
    <input
      className={`k-input ks-sci-ref${active === f ? ' picking' : ''}`}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onFocus={() => setActive(f)}
      onChange={(e) => setter(e.target.value)}
    />
  )
  const select = (k: string, items: string[], byIndex = true) => (
    <select className="k-input" value={byIndex ? Number(opts[k]) : String(opts[k])} onChange={(e) => set(k, byIndex ? Number(e.target.value) : e.target.value)}>
      {items.map((it, i) => (
        <option key={it} value={byIndex ? i : it}>{it}</option>
      ))}
    </select>
  )
  const field = (k: string, extra?: { min?: number; max?: number; step?: number; placeholder?: string; text?: boolean }) => (
    <input
      className="k-input"
      type={extra?.text ? 'text' : 'number'}
      value={opts[k]}
      min={extra?.min}
      max={extra?.max}
      step={extra?.step}
      placeholder={extra?.placeholder}
      onChange={(e) => set(k, e.target.value)}
    />
  )

  return (
    <FloatWin title={tool} root={root} width={440} height={430} className="ks-sci" onClose={onClose}>
      <div className="ks-sci-body">
        <fieldset>
          <legend>Output</legend>
          <label>Add results to: {ref('out', out, setOut, 'Top-left cell, e.g. $D$1  (blank = next free column)')}</label>
          <div className="ks-sci-hint">→ writing to column {colName(s0.c)} (row {s0.r + 1} onward)</div>
        </fieldset>
        <fieldset>
          <legend>Data</legend>
          <label>X: {ref('x', x, setX, 'X range, e.g. $A$2:$A$500  (blank = sample index)')}</label>
          <label>Y: {ref('y', y, setY, 'Y range, e.g. $B$2:$B$500')}</label>
        </fieldset>
        <fieldset>
          <legend>Options</legend>
          {tool === 'Normalisation' && (
            <label>Scale to: <span className="ks-sci-row">min {field('lo', { step: 0.1 })} max {field('hi', { step: 0.1 })}</span></label>
          )}
          {tool === 'Integration' && <label>Mode: {select('mode', ['Cumulative', 'Definite (total only)'])}</label>}
          {tool === 'Derivative' && <label>Order: {select('order', ['1st order', '2nd order'])}</label>}
          {tool === 'Smooth' && (
            <>
              <label>Method: {select('method', ['Moving average', 'Savitzky-Golay'])}</label>
              <label>Window: {field('window', { min: 2, max: 999 })}</label>
              <label className={Number(opts.method) === 1 ? '' : 'disabled'}>Poly order: {field('poly', { min: 1, max: 10 })}</label>
            </>
          )}
          {tool === 'FFT' && <label>Spectrum: {select('kind', ['Magnitude', 'Power', 'Amplitude'], false)}</label>}
          {tool === 'Interpolation' && (
            <>
              <label>Points: {field('points', { min: 2, max: 1_000_000 })}</label>
              <label>Method: {select('kind', ['linear', 'cubic', 'quadratic', 'nearest'], false)}</label>
            </>
          )}
          {tool === 'Find Peaks' && (
            <>
              <label>Height: {field('height', { text: true, placeholder: 'min height (blank = none)' })}</label>
              <label>Prominence: {field('prominence', { text: true, placeholder: 'min prominence (blank = none)' })}</label>
              <label>Distance (pts): {field('distance', { min: 1, max: 1_000_000 })}</label>
            </>
          )}
        </fieldset>
        <div className="ks-sci-foot">
          <button className="k-btn primary" disabled={busy} onClick={() => void apply()}>Compute &amp; Write</button>
          <button className="k-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </FloatWin>
  )
}
