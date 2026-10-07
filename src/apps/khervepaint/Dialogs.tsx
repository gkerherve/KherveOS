// Dialogs drawn inside the window: Drawing Size (canvassize.py, with the
// journal column presets) and the scale bar.

import { useState } from 'react'

/** label → (unit, width, height, dpi); journal widths are official column widths in mm. */
export const PRESETS: [string, [string, number, number, number] | null][] = [
  ['Custom', null],
  ['ACS single column — 82.6 mm @ 300 dpi', ['mm', 82.55, 63.5, 300]],
  ['ACS double column — 177.8 mm @ 300 dpi', ['mm', 177.8, 101.6, 300]],
  ['ACS max — 177.8 × 241.3 mm @ 300 dpi', ['mm', 177.8, 241.3, 300]],
  ['Nature single column — 89 mm @ 300 dpi', ['mm', 89, 120, 300]],
  ['Nature double column — 183 mm @ 300 dpi', ['mm', 183, 120, 300]],
  ['Science 1 column — 55 mm @ 300 dpi', ['mm', 55, 80, 300]],
  ['Science 2 columns — 121 mm @ 300 dpi', ['mm', 121, 100, 300]],
  ['Science 3 columns — 183 mm @ 300 dpi', ['mm', 183, 120, 300]],
  ['Cell 1 column — 85 mm @ 300 dpi', ['mm', 85, 100, 300]],
  ['Cell 1.5 column — 114 mm @ 300 dpi', ['mm', 114, 110, 300]],
  ['Cell 2 columns — 174 mm @ 300 dpi', ['mm', 174, 120, 300]],
  ['RSC single column — 83 mm @ 300 dpi', ['mm', 83, 63, 300]],
  ['RSC double column — 171 mm @ 300 dpi', ['mm', 171, 110, 300]],
  ['Elsevier single column — 90 mm @ 300 dpi', ['mm', 90, 120, 300]],
  ['Elsevier 1.5 column — 140 mm @ 300 dpi', ['mm', 140, 120, 300]],
  ['Elsevier double column — 190 mm @ 300 dpi', ['mm', 190, 130, 300]],
  ['IEEE single column — 88.9 mm @ 300 dpi', ['mm', 88.9, 100, 300]],
  ['IEEE double column — 181 mm @ 300 dpi', ['mm', 181, 120, 300]],
  ['Wiley single column — 80 mm @ 300 dpi', ['mm', 80, 100, 300]],
  ['Wiley double column — 170 mm @ 300 dpi', ['mm', 170, 120, 300]],
  ['PNAS 1 column — 87 mm @ 300 dpi', ['mm', 87, 100, 300]],
  ['PNAS 2 columns — 114 mm @ 300 dpi', ['mm', 114, 110, 300]],
  ['PNAS full width — 178 mm @ 300 dpi', ['mm', 178, 120, 300]],
  ['A4 portrait @ 300 dpi', ['mm', 210, 297, 300]],
  ['A4 landscape @ 300 dpi', ['mm', 297, 210, 300]],
  ['US Letter portrait @ 300 dpi', ['in', 8.5, 11, 300]],
  ['Square — 100 mm @ 300 dpi', ['mm', 100, 100, 300]],
  ['Slide 16:9 — 1920 × 1080 px', ['px', 1920, 1080, 96]],
  ['Slide 4:3 — 1024 × 768 px', ['px', 1024, 768, 96]],
]

type Unit = 'px' | 'in' | 'mm'

const toPx = (v: number, unit: Unit, dpi: number) => (unit === 'in' ? v * dpi : unit === 'mm' ? (v / 25.4) * dpi : v)
const fromPx = (px: number, unit: Unit, dpi: number) => (unit === 'in' ? px / dpi : unit === 'mm' ? (px / dpi) * 25.4 : px)
const digits = (unit: Unit) => (unit === 'px' ? 0 : unit === 'in' ? 2 : 1)

export type SizeResult = { kind: 'size'; w: number; h: number; dpi: number } | { kind: 'fit'; selectionOnly: boolean }

export function DrawingSizeDialog({ width, height, dpi, hasSelection, onDone }: {
  width: number; height: number; dpi: number; hasSelection: boolean; onDone(r: SizeResult | null): void
}) {
  const [preset, setPreset] = useState(0)
  const [unit, setUnit] = useState<Unit>('px')
  const [res, setRes] = useState(Math.round(dpi) || 96)
  const [w, setW] = useState(String(width))
  const [h, setH] = useState(String(height))
  const [fit, setFit] = useState(false)
  const [selOnly, setSelOnly] = useState(hasSelection)
  const pw = Math.max(1, Math.round(toPx(parseFloat(w) || 0, unit, res)))
  const ph = Math.max(1, Math.round(toPx(parseFloat(h) || 0, unit, res)))

  const applyPreset = (i: number) => {
    setPreset(i)
    const p = PRESETS[i][1]
    if (!p) return
    const [u, pw2, ph2, d] = p
    setUnit(u as Unit)
    setRes(d)
    setW(String(pw2))
    setH(String(ph2))
  }
  const changeUnit = (u: Unit) => {
    const fmt = (v: number) => String(+v.toFixed(digits(u)))
    setW(fmt(fromPx(toPx(parseFloat(w) || 0, unit, res), u, res)))
    setH(fmt(fromPx(toPx(parseFloat(h) || 0, unit, res), u, res)))
    setUnit(u)
    setPreset(0)
  }
  const done = (ok: boolean) => onDone(ok ? (fit ? { kind: 'fit', selectionOnly: selOnly } : { kind: 'size', w: pw, h: ph, dpi: res }) : null)

  return (
    <div className="kp-modal-back" onPointerDown={(e) => e.target === e.currentTarget && done(false)}>
      <form
        className="kp-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          done(true)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') done(false)
        }}
      >
        <div className="kp-dialog-title">Drawing size</div>
        <label className="kp-row">
          <span className="kp-row-label">Preset</span>
          <select className="k-input" value={preset} disabled={fit} onChange={(e) => applyPreset(+e.target.value)}>
            {PRESETS.map(([label], i) => <option key={label} value={i}>{label}</option>)}
          </select>
        </label>
        <label className="kp-row">
          <span className="kp-row-label">Units</span>
          <select className="k-input" value={unit} disabled={fit} onChange={(e) => changeUnit(e.target.value as Unit)}>
            <option value="px">px</option>
            <option value="in">in</option>
            <option value="mm">mm</option>
          </select>
        </label>
        <label className="kp-row">
          <span className="kp-row-label">Resolution</span>
          <span className="kp-row-field">
            <input className="k-input" type="number" min={36} max={2400} value={res} disabled={fit} onChange={(e) => { setRes(Math.max(1, +e.target.value || 96)); setPreset(0) }} />
            <span className="kp-suffix">dpi</span>
          </span>
        </label>
        <div className="kp-row">
          <span className="kp-row-label">Width × Height</span>
          <span className="kp-row-field">
            <input className="k-input" autoFocus value={w} disabled={fit} onChange={(e) => { setW(e.target.value); setPreset(0) }} />
            <span>×</span>
            <input className="k-input" value={h} disabled={fit} onChange={(e) => { setH(e.target.value); setPreset(0) }} />
            <span className="kp-suffix">{unit}</span>
          </span>
        </div>
        <div className="kp-row">
          <span className="kp-row-label" />
          <span className="k-muted">= {pw} × {ph} px</span>
        </div>
        <label className="kp-tick"><input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} /> Fit canvas to the drawing instead</label>
        <label className="kp-tick"><input type="checkbox" checked={selOnly} disabled={!hasSelection || !fit} onChange={(e) => setSelOnly(e.target.checked)} /> Use selection only</label>
        <div className="kp-dialog-buttons">
          <button type="button" className="k-btn" onClick={() => done(false)}>Cancel</button>
          <button type="submit" className="k-btn primary">OK</button>
        </div>
      </form>
    </div>
  )
}

export interface ScaleBarSpec {
  length: number
  unit: 'nm' | 'µm' | 'mm' | 'cm'
}

/** Ask for a scale bar's real length (Measure ▸ Scale bar…). */
export function ScaleBarDialog({ onDone }: { onDone(r: ScaleBarSpec | null): void }) {
  const [length, setLength] = useState('10')
  const [unit, setUnit] = useState<ScaleBarSpec['unit']>('mm')
  const done = (ok: boolean) => onDone(ok && parseFloat(length) > 0 ? { length: parseFloat(length), unit } : null)
  return (
    <div className="kp-modal-back" onPointerDown={(e) => e.target === e.currentTarget && done(false)}>
      <form className="kp-dialog" onSubmit={(e) => { e.preventDefault(); done(true) }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') done(false) }}>
        <div className="kp-dialog-title">Scale bar</div>
        <p className="k-muted kp-note">The bar is drawn at this real length on paper, from the drawing’s dpi. For a micrograph, type what the bar stands for and set its length after.</p>
        <div className="kp-row">
          <span className="kp-row-label">Length</span>
          <span className="kp-row-field">
            <input className="k-input" autoFocus value={length} onChange={(e) => setLength(e.target.value)} />
            <select className="k-input" value={unit} onChange={(e) => setUnit(e.target.value as ScaleBarSpec['unit'])}>
              <option value="nm">nm</option>
              <option value="µm">µm</option>
              <option value="mm">mm</option>
              <option value="cm">cm</option>
            </select>
          </span>
        </div>
        <div className="kp-dialog-buttons">
          <button type="button" className="k-btn" onClick={() => done(false)}>Cancel</button>
          <button type="submit" className="k-btn primary">Insert</button>
        </div>
      </form>
    </div>
  )
}
