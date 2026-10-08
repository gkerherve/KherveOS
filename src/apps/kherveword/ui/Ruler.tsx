// The rulers: centimetres across the page with the margins in grey; the
// paragraph's first-line, hanging and right indents and its tab stops can be
// dragged; a click adds a tab stop, dragging one off the ruler removes it;
// the margins are dragged at their edges. The vertical ruler shows (and
// drags) the top and bottom margins.

import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { PT_PER_CM } from '../model'

const PX_PT = 0.75 // pt per CSS px
const CM_PX = PT_PER_CM / PX_PT

interface HProps {
  pageW: number
  marginL: number
  marginR: number
  zoom: number
  indentLeft: number
  indentRight: number
  indentFirst: number
  tabs: { pos: number; align?: string }[]
  onIndent(v: { indentLeft: number; indentRight: number; indentFirst: number }): void
  onTabs(tabs: { pos: number; align?: string }[]): void
  onMargins(left: number, right: number): void
}

type Drag =
  | { kind: 'first' | 'hanging' | 'left' | 'right'; x0: number; v0: { l: number; r: number; f: number } }
  | { kind: 'tab'; i: number; x0: number; y0: number; pos0: number }
  | { kind: 'ml' | 'mr'; x0: number; m0: number }

const snap = (pt: number) => Math.round(pt / (PT_PER_CM / 4)) * (PT_PER_CM / 4)

export function HRuler(p: HProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [preview, setPreview] = useState<{ l: number; r: number; f: number; tabs: { pos: number; align?: string }[] | null; ml: number; mr: number } | null>(null)
  const z = p.zoom
  const cur = preview ?? { l: p.indentLeft, r: p.indentRight, f: p.indentFirst, tabs: null, ml: p.marginL, mr: p.marginR }
  const tabs = cur.tabs ?? p.tabs
  const mL = cur.ml
  const mR = cur.mr
  const ptToX = (pt: number) => (mL + pt / PX_PT) * z
  const start = (e: RPointerEvent, d: Drag) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDrag(d)
  }
  const move = (e: RPointerEvent) => {
    if (!drag) return
    const dxPt = ((e.clientX - drag.x0) / z) * PX_PT
    if (drag.kind === 'tab') {
      const gone = Math.abs(e.clientY - drag.y0) > 24
      const next = p.tabs.map((t, i) => (i === drag.i ? { ...t, pos: snap(drag.pos0 + dxPt) } : t)).filter((_, i) => !(gone && i === drag.i))
      setPreview({ l: p.indentLeft, r: p.indentRight, f: p.indentFirst, tabs: next, ml: p.marginL, mr: p.marginR })
      return
    }
    if (drag.kind === 'ml' || drag.kind === 'mr') {
      const px = drag.m0 + (drag.kind === 'ml' ? 1 : -1) * ((e.clientX - drag.x0) / z)
      const v = Math.max(0, Math.min(p.pageW / 2 - 20, snap(px * PX_PT) / PX_PT))
      setPreview({ l: p.indentLeft, r: p.indentRight, f: p.indentFirst, tabs: null, ml: drag.kind === 'ml' ? v : p.marginL, mr: drag.kind === 'mr' ? v : p.marginR })
      return
    }
    const dv = drag as Extract<Drag, { v0: unknown }>
    const v = { ...dv.v0 }
    if (drag.kind === 'first') v.f = snap(dv.v0.l + dv.v0.f + dxPt) - dv.v0.l
    else if (drag.kind === 'hanging') {
      // The other lines move; the first line stays where it is.
      v.l = snap(dv.v0.l + dxPt)
      v.f = dv.v0.l + dv.v0.f - v.l
    } else if (drag.kind === 'left') v.l = snap(dv.v0.l + dxPt)
    else v.r = snap(dv.v0.r - dxPt)
    setPreview({ l: v.l, r: v.r, f: v.f, tabs: null, ml: p.marginL, mr: p.marginR })
  }
  const end = () => {
    if (drag && preview) {
      if (drag.kind === 'tab') p.onTabs(preview.tabs ?? p.tabs)
      else if (drag.kind === 'ml' || drag.kind === 'mr') p.onMargins(preview.ml, preview.mr)
      else p.onIndent({ indentLeft: preview.l, indentRight: preview.r, indentFirst: preview.f })
    }
    setDrag(null)
    setPreview(null)
  }
  const addTab = (e: RPointerEvent) => {
    if (drag || e.button !== 0) return
    const r = ref.current!.getBoundingClientRect()
    const pt = snap(((e.clientX - r.left) / z - p.marginL) * PX_PT)
    if (pt <= 0 || pt > (p.pageW - p.marginL - p.marginR) * PX_PT) return
    p.onTabs([...p.tabs, { pos: pt, align: 'left' }].sort((a, b) => a.pos - b.pos))
  }
  const ticks = []
  const widthCm = p.pageW / CM_PX
  for (let c = -Math.floor(mL / CM_PX * 4) / 4; c <= widthCm; c += 0.25) {
    const x = (mL + c * CM_PX) * z
    if (x < 0 || x > p.pageW * z) continue
    const whole = Math.abs(c - Math.round(c)) < 0.01
    const half = Math.abs(c * 2 - Math.round(c * 2)) < 0.01
    ticks.push(
      <span key={c.toFixed(2)} className={`kw-tick${whole ? ' whole' : half ? ' half' : ''}`} style={{ left: x }}>
        {whole && Math.round(c) !== 0 ? Math.abs(Math.round(c)) : ''}
      </span>,
    )
  }
  return (
    <div className="kw-hruler" ref={ref} style={{ width: p.pageW * z }} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerDown={addTab} title="Click to add a tab stop">
      <div className="kw-ruler-margin" style={{ left: 0, width: mL * z }} />
      <div className="kw-ruler-margin" style={{ right: 0, width: mR * z }} />
      <div className="kw-ruler-edge" style={{ left: mL * z - 3 }} title="Left margin" onPointerDown={(e) => start(e, { kind: 'ml', x0: e.clientX, m0: p.marginL })} />
      <div className="kw-ruler-edge" style={{ left: (p.pageW - mR) * z - 3 }} title="Right margin" onPointerDown={(e) => start(e, { kind: 'mr', x0: e.clientX, m0: p.marginR })} />
      {ticks}
      {tabs.map((t, i) => (
        <span
          key={i}
          className={`kw-tabstop ${t.align ?? 'left'}`}
          style={{ left: ptToX(t.pos) }}
          title={`${t.align ?? 'left'} tab at ${(t.pos / PT_PER_CM).toFixed(2)} cm — drag off to remove`}
          onPointerDown={(e) => start(e, { kind: 'tab', i, x0: e.clientX, y0: e.clientY, pos0: t.pos })}
        />
      ))}
      <span className="kw-ind first" style={{ left: ptToX(cur.l + cur.f) }} title="First Line Indent" onPointerDown={(e) => start(e, { kind: 'first', x0: e.clientX, v0: { l: p.indentLeft, r: p.indentRight, f: p.indentFirst } })} />
      <span className="kw-ind hanging" style={{ left: ptToX(cur.l) }} title="Hanging Indent" onPointerDown={(e) => start(e, { kind: 'hanging', x0: e.clientX, v0: { l: p.indentLeft, r: p.indentRight, f: p.indentFirst } })} />
      <span className="kw-ind leftbox" style={{ left: ptToX(cur.l) }} title="Left Indent" onPointerDown={(e) => start(e, { kind: 'left', x0: e.clientX, v0: { l: p.indentLeft, r: p.indentRight, f: p.indentFirst } })} />
      <span className="kw-ind right" style={{ left: (p.pageW - mR - cur.r / PX_PT) * z }} title="Right Indent" onPointerDown={(e) => start(e, { kind: 'right', x0: e.clientX, v0: { l: p.indentLeft, r: p.indentRight, f: p.indentFirst } })} />
    </div>
  )
}

export function VRuler({ pageH, marginT, marginB, zoom, top, onMargins }: { pageH: number; marginT: number; marginB: number; zoom: number; top: number; onMargins(t: number, b: number): void }) {
  const [drag, setDrag] = useState<{ kind: 't' | 'b'; y0: number; m0: number } | null>(null)
  const [preview, setPreview] = useState<{ t: number; b: number } | null>(null)
  const t = preview?.t ?? marginT
  const b = preview?.b ?? marginB
  const ticks = []
  for (let c = -Math.floor((t / CM_PX) * 2) / 2; c <= pageH / CM_PX; c += 0.5) {
    const y = (t + c * CM_PX) * zoom
    if (y < 0 || y > pageH * zoom) continue
    const whole = Math.abs(c - Math.round(c)) < 0.01
    ticks.push(
      <span key={c.toFixed(1)} className={`kw-vtick${whole ? ' whole' : ''}`} style={{ top: y }}>
        {whole && Math.round(c) !== 0 ? Math.abs(Math.round(c)) : ''}
      </span>,
    )
  }
  return (
    <div
      className="kw-vruler"
      style={{ top, height: pageH * zoom }}
      onPointerMove={(e) => {
        if (!drag) return
        const v = Math.max(0, Math.min(pageH / 2 - 20, drag.m0 + (drag.kind === 't' ? 1 : -1) * ((e.clientY - drag.y0) / zoom)))
        const s = snap(v * PX_PT) / PX_PT
        setPreview({ t: drag.kind === 't' ? s : marginT, b: drag.kind === 'b' ? s : marginB })
      }}
      onPointerUp={() => {
        if (preview) onMargins(preview.t, preview.b)
        setDrag(null)
        setPreview(null)
      }}
    >
      <div className="kw-ruler-margin v" style={{ top: 0, height: t * zoom }} />
      <div className="kw-ruler-margin v" style={{ bottom: 0, height: b * zoom }} />
      <div
        className="kw-ruler-edge v"
        style={{ top: t * zoom - 3 }}
        title="Top margin"
        onPointerDown={(e) => {
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          setDrag({ kind: 't', y0: e.clientY, m0: marginT })
        }}
      />
      <div
        className="kw-ruler-edge v"
        style={{ top: (pageH - b) * zoom - 3 }}
        title="Bottom margin"
        onPointerDown={(e) => {
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          setDrag({ kind: 'b', y0: e.clientY, m0: marginB })
        }}
      />
      {ticks}
    </div>
  )
}
