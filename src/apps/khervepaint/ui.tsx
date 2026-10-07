// Small controls shared by the bars and panels: a colour button with an
// alpha-aware popover (QColorDialog with alpha in the desktop), number
// fields that commit on Enter or blur, and shape icons.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { alphaOf, colorOf, rgbHex, toArgb, withAlpha } from './model'
import { polygonForKind, rectOf } from './geom'

const SWATCHES = [
  '#000000', '#1a1a1a', '#555555', '#888888', '#bbbbbb', '#ffffff',
  '#d32f2f', '#f57c00', '#fbc02d', '#388e3c', '#0097a7', '#1976d2',
  '#303f9f', '#7b1fa2', '#c2185b', '#5d4037', '#4aa3ff', '#2e9e5b',
  '#fdecea', '#fff3e0', '#fffde7', '#e8f5e9', '#e3f2fd', '#f3e5f5',
]

const checker = 'repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%) 50% / 8px 8px'

export function Swatch({ color, none }: { color: string; none?: boolean }) {
  const c = colorOf(color)
  return (
    <span className="kp-chip" style={{ background: checker }}>
      <span style={{ background: none ? 'transparent' : `rgba(${c.r},${c.g},${c.b},${c.a / 255})` }} />
      {none && <span className="kp-chip-none" />}
    </span>
  )
}

interface ColorProps {
  color: string
  onChange(color: string): void
  /** Offer "no colour" (null). */
  allowNone?: boolean
  none?: boolean
  onNone?(): void
  title?: string
  label?: ReactNode
}

/** A colour swatch button; click opens a popover with swatches, a picker and opacity. */
export function ColorButton({ color, onChange, allowNone, none, onNone, title, label }: ColorProps) {
  const [open, setOpen] = useState<DOMRect | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="kp-color-btn"
        title={title}
        onClick={() => setOpen(open ? null : btn.current!.getBoundingClientRect())}
      >
        <Swatch color={color} none={none} />
        {label}
      </button>
      {open && <ColorPopover at={open} color={color} allowNone={allowNone} onChange={onChange} onNone={onNone} onClose={() => setOpen(null)} />}
    </>
  )
}

function ColorPopover({ at, color, onChange, allowNone, onNone, onClose }: {
  at: DOMRect; color: string; onChange(c: string): void; allowNone?: boolean; onNone?(): void; onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const alpha = alphaOf(color)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  const left = Math.min(at.left, window.innerWidth - 236)
  const top = at.bottom + 260 > window.innerHeight ? Math.max(4, at.top - 256) : at.bottom + 4
  // Rendered at page level, but styled under .kp-paint so the app's rules apply.
  return createPortal(
    <div className="kp-paint kp-popover-host">
      <div ref={ref} className="kp-popover" style={{ left, top }}>
        <div className="kp-palette-grid">
          {SWATCHES.map((s) => (
            <button key={s} type="button" title={s} style={{ background: s }} onClick={() => onChange(withAlpha(toArgb(s), alpha || 1))} />
          ))}
        </div>
        <div className="kp-popover-row">
          <input type="color" value={rgbHex(colorOf(color))} onChange={(e) => onChange(withAlpha(toArgb(e.target.value), alpha || 1))} />
          <input
            className="k-input kp-hex"
            spellCheck={false}
            defaultValue={rgbHex(colorOf(color))}
            key={color}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = (e.target as HTMLInputElement).value.trim()
                const c = toArgb(v.startsWith('#') ? v : '#' + v, '')
                if (c) onChange(withAlpha(c, alpha || 1))
              }
            }}
          />
        </div>
        <label className="kp-popover-row">
          <span>Opacity</span>
          <input type="range" min={0} max={100} value={Math.round(alpha * 100)} onChange={(e) => onChange(withAlpha(color, +e.target.value / 100))} />
          <span className="kp-num-label">{Math.round(alpha * 100)}%</span>
        </label>
        {allowNone && (
          <button type="button" className="k-btn small" onClick={() => { onNone?.(); onClose() }}>
            No colour
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** A number input that commits on Enter or blur (and arrows step it). */
export function NumberField({ value, onChange, step = 1, min, max, digits = 2, width = 64, suffix, title }: {
  value: number; onChange(v: number): void; step?: number; min?: number; max?: number; digits?: number; width?: number; suffix?: string; title?: string
}) {
  const shown = isFinite(value) ? String(+value.toFixed(digits)) : ''
  const [text, setText] = useState(shown)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(shown)
  }, [shown, focused])
  const commit = (t: string) => {
    const v = parseFloat(t.replace(',', '.'))
    if (!isFinite(v)) return setText(shown)
    const c = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v))
    if (c !== value) onChange(c)
    setText(String(+c.toFixed(digits)))
  }
  return (
    <span className="kp-number" title={title}>
      <input
        className="k-input"
        style={{ width }}
        value={text}
        inputMode="decimal"
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          setFocused(false)
          commit(e.target.value)
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
          else if (e.key === 'Escape') setText(shown)
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const v = (parseFloat(text) || 0) + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)
            commit(String(v))
          }
        }}
      />
      {suffix && <span className="kp-suffix">{suffix}</span>}
    </span>
  )
}

/** A little drawing of a shape tool, for buttons and menus. */
export function ShapeIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const s = size
  const r = rectOf(2, 2, s - 4, s - 4)
  let el: ReactNode
  if (kind === 'rect') el = <rect x={2.5} y={4.5} width={s - 5} height={s - 9} />
  else if (kind === 'roundrect') el = <rect x={2.5} y={4.5} width={s - 5} height={s - 9} rx={3} />
  else if (kind === 'circle') el = <circle cx={s / 2} cy={s / 2} r={s / 2 - 2.5} />
  else if (kind === 'ellipse') el = <ellipse cx={s / 2} cy={s / 2} rx={s / 2 - 2} ry={s / 2 - 4.5} />
  else if (kind === 'halfcircle') el = <path d={`M2.5,${s - 4.5} A${s / 2 - 2.5},${s / 2 - 2.5} 0 0 1 ${s - 2.5},${s - 4.5} Z`} />
  else if (kind === 'quartercircle') el = <path d={`M3,${s - 3} L${s - 3},${s - 3} A${s - 6},${s - 6} 0 0 0 3,3 Z`} />
  else el = <polygon points={polygonForKind(kind, r).map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} />
  return (
    <svg className="kp-shape-icon" width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      {el}
    </svg>
  )
}
