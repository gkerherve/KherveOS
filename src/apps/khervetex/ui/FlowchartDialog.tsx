// Flowchart builder (Insert ▸ Flowchart builder…, flowchart_builder.py): click a
// shape to add it after the selected box, joined by an arrow; drag boxes to
// move them (they snap to a grid); ⌘/Ctrl-click a box to draw an arrow to it
// from the selected one, or use the Arrow / Curve / Line tools; edit the text
// of a box or the label of an arrow on the right (LaTeX maths welcome). The
// preview is compiled with LaTeX — exactly what lands in the document.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addNode, autoLayout, chartFromJson, chartToJson, colours, connect, HEADS, KINDS, nodeOf, removeNode, SCHEME_NAMES, SIDES, standaloneDoc,
  TEMPLATES, toTikz, type FcEdge, type FcNode, type Flowchart,
} from '../flowchart'
import { compileStandalone, type CompiledPicture } from './standalone'
import type { Done } from './dialogs'

export interface FlowchartResult {
  chart: Flowchart
  pdf: Uint8Array
  png: Uint8Array
  tikz: string
  widthPt: number
}

/** Screen pixels per centimetre of the chart. */
const S = 36
const BOX_W = 2.6 * S
const BOX_H = 0.95 * S

function boxSize(n: FcNode): [number, number] {
  if (n.kind === 'connector') return [0.8 * S, 0.8 * S]
  if (n.kind === 'decision') return [BOX_W * 1.15, BOX_H * 1.6]
  if (n.kind === 'terminal' || n.kind === 'io' || n.kind === 'document' || n.kind === 'database') return [2.4 * S, BOX_H]
  return [BOX_W, BOX_H]
}

/** shape_path: the outline of a box of `kind` centred at (cx, cy). */
function shapePath(kind: string, cx: number, cy: number, w: number, h: number): string {
  const l = cx - w / 2
  const r = cx + w / 2
  const t = cy - h / 2
  const b = cy + h / 2
  switch (kind) {
    case 'terminal': {
      const rr = h / 2
      return `M${l + rr},${t}H${r - rr}A${rr},${rr} 0 0 1 ${r - rr},${b}H${l + rr}A${rr},${rr} 0 0 1 ${l + rr},${t}Z`
    }
    case 'decision':
      return `M${cx},${t}L${r},${cy}L${cx},${b}L${l},${cy}Z`
    case 'io': {
      const k = h * 0.32
      return `M${l + k},${t}H${r}L${r - k},${b}H${l}Z`
    }
    case 'document': {
      const wv = h * 0.18
      return `M${l},${t}H${r}V${b - wv}C${r - w * 0.25},${b - wv * 3} ${l + w * 0.25},${b + wv} ${l},${b - wv}Z`
    }
    case 'database': {
      const e = h * 0.18
      return `M${l},${t + e}A${w / 2},${e} 0 0 1 ${r},${t + e}V${b - e}A${w / 2},${e} 0 0 1 ${l},${b - e}Z M${l},${t + e}A${w / 2},${e} 0 0 0 ${r},${t + e}`
    }
    case 'connector':
      return `M${cx - w / 2},${cy}A${w / 2},${h / 2} 0 1 0 ${cx + w / 2},${cy}A${w / 2},${h / 2} 0 1 0 ${cx - w / 2},${cy}Z`
    default:
      return `M${l},${t}H${r}V${b}H${l}Z`
  }
}

/** Where a ray from a box's centre towards (dx, dy) leaves the box. */
function exitPoint(cx: number, cy: number, w: number, h: number, dx: number, dy: number): [number, number] {
  if (!dx && !dy) return [cx, cy]
  const t = Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity)
  return [cx + dx * t, cy + dy * t]
}

const toD = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('')

/** The arrow as the canvas draws it (TikZ's routes, approximately), from box outline to box outline. */
function edgePath(fc: Flowchart, e: FcEdge, pos: (n: FcNode) => [number, number]): string {
  const a = nodeOf(fc, e.src)
  const b = nodeOf(fc, e.dst)
  if (!a || !b) return ''
  const [ax, ay] = pos(a)
  const [bx, by] = pos(b)
  const [aw, ah] = boxSize(a)
  const [bw, bh] = boxSize(b)
  const side = (x: number, y: number, w: number, h: number, s: string): [number, number] | null =>
    s === 'north' ? [x, y - h / 2] : s === 'south' ? [x, y + h / 2] : s === 'east' ? [x + w / 2, y] : s === 'west' ? [x - w / 2, y] : null
  if (e.route === 'curve') {
    const [sx, sy] = side(ax, ay, aw, ah, e.src_side) ?? exitPoint(ax, ay, aw, ah, bx - ax, by - ay)
    const [tx, ty] = side(bx, by, bw, bh, e.dst_side) ?? exitPoint(bx, by, bw, bh, ax - bx, ay - by)
    const k = Math.tan(((e.bend || 30) * Math.PI) / 180) / 2
    const cx = (sx + tx) / 2 - (ty - sy) * k
    const cy = (sy + ty) / 2 + (tx - sx) * k
    return `M${sx},${sy}Q${cx},${cy} ${tx},${ty}`
  }
  // Loops back along the same line go round the side, as in the TikZ.
  if (fc.direction === 'TB' && b.y < a.y && Math.abs(a.x - b.x) < 0.01) {
    const x0 = ax - aw / 2
    return toD([[x0, ay], [ax - 1.9 * S, ay], [ax - 1.9 * S, by], [bx - bw / 2, by]])
  }
  if (fc.direction === 'LR' && b.x < a.x && Math.abs(a.y - b.y) < 0.01) {
    const y0 = ay + ah / 2
    return toD([[ax, y0], [ax, ay + 1.3 * S], [bx, ay + 1.3 * S], [bx, by + bh / 2]])
  }
  const aligned = Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01
  let pts: [number, number][]
  if (e.route === 'straight' || aligned) pts = [[ax, ay], [bx, by]]
  else {
    const firstAcross = fc.direction === 'TB' ? a.x !== b.x : a.y !== b.y
    const decision = a.kind === 'decision'
    const vertFirst = fc.direction === 'TB' ? !(decision && firstAcross) : decision && firstAcross
    pts = vertFirst ? [[ax, ay], [ax, by], [bx, by]] : [[ax, ay], [bx, ay], [bx, by]]
  }
  const [p1, p2] = [pts[0], pts[1]]
  pts[0] = side(ax, ay, aw, ah, e.src_side) ?? exitPoint(ax, ay, aw, ah, p2[0] - p1[0], p2[1] - p1[1])
  const n = pts.length
  const [q1, q2] = [pts[n - 2], pts[n - 1]]
  pts[n - 1] = side(bx, by, bw, bh, e.dst_side) ?? exitPoint(bx, by, bw, bh, q1[0] - q2[0], q1[1] - q2[1])
  return toD(pts)
}

/** A box's text as the canvas shows it: LaTeX maths reduced to plain characters. */
function plainText(s: string): string {
  return s.replace(/\\\\/g, ' ').replace(/\$([^$]*)\$/g, '$1').replace(/\\leftarrow/g, '←').replace(/\\le\b/g, '≤').replace(/\\ge\b/g, '≥').replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '')
}

export function FlowchartDialog({ initial, done }: { initial: Flowchart | null; done: Done<FlowchartResult> }) {
  const [fc, setFc] = useState<Flowchart>(() => initial ?? TEMPLATES['Simple process']())
  const [hist, setHist] = useState<{ list: string[]; i: number }>(() => ({ list: [chartToJson(initial ?? TEMPLATES['Simple process']())], i: 0 }))
  const [sel, setSel] = useState<{ node?: string; edge?: number } | null>(null)
  const [tool, setTool] = useState<{ head: 'end' | 'none'; curve: boolean; from: string | null } | null>(null)
  const [showTex, setShowTex] = useState(false)
  const [preview, setPreview] = useState<{ pic: CompiledPicture | null; status: string; tex: string }>({ pic: null, status: '', tex: '' })
  const [busy, setBusy] = useState(false)
  const drag = useRef<{ id: string; x0: number; y0: number; nx: number; ny: number; moved: boolean } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const textRef = useRef<HTMLInputElement>(null)

  /** Every change goes through here: a copy of the chart, and an undo step. */
  const change = (fn: (c: Flowchart) => void) => {
    const next = chartFromJson(chartToJson(fc))
    fn(next)
    setFc(next)
    const json = chartToJson(next)
    setHist((h) => (h.list[h.i] === json ? h : { list: [...h.list.slice(0, h.i + 1), json], i: h.i + 1 }))
  }
  const step = (d: number) => {
    const i = hist.i + d
    if (i < 0 || i >= hist.list.length) return
    setHist({ ...hist, i })
    setFc(chartFromJson(hist.list[i]))
    setSel(null)
  }

  // The preview, compiled half a second after the last change.
  const tex = useMemo(() => standaloneDoc(fc), [fc])
  useEffect(() => {
    let gone = false
    const t = window.setTimeout(async () => {
      setPreview((p) => ({ ...p, status: 'Compiling…' }))
      try {
        const pic = await compileStandalone(tex, 150)
        if (gone) return URL.revokeObjectURL(pic.url)
        setPreview((p) => {
          if (p.pic) URL.revokeObjectURL(p.pic.url)
          return { pic, status: '', tex }
        })
      } catch (e) {
        if (!gone) setPreview((p) => ({ ...p, status: `Not compiled: ${e instanceof Error ? e.message : String(e)}` }))
      }
    }, 500)
    return () => {
      gone = true
      window.clearTimeout(t)
    }
  }, [tex])
  useEffect(() => () => {
    setPreview((p) => {
      if (p.pic) URL.revokeObjectURL(p.pic.url)
      return p
    })
  }, [])

  // Layout of the canvas.
  const cols = colours(fc)
  const pos = (n: FcNode): [number, number] => [n.x * fc.col_cm * S, n.y * fc.row_cm * S]
  const xs = fc.nodes.map((n) => pos(n)[0])
  const ys = fc.nodes.map((n) => pos(n)[1])
  const pad = 2.2 * S
  const minX = Math.min(0, ...xs) - pad - 1.9 * S
  const minY = Math.min(0, ...ys) - pad
  const maxX = Math.max(0, ...xs) + pad
  const maxY = Math.max(0, ...ys) + pad
  const selNode = sel?.node ? nodeOf(fc, sel.node) : null
  const selEdge = sel?.edge !== undefined ? fc.edges[sel.edge] : null

  const toChart = (ev: { clientX: number; clientY: number }) => {
    const el = svg.current!
    const pt = el.createSVGPoint()
    pt.x = ev.clientX
    pt.y = ev.clientY
    const p = pt.matrixTransform(el.getScreenCTM()!.inverse())
    return { x: p.x / (fc.col_cm * S), y: p.y / (fc.row_cm * S) }
  }

  const nodeDown = (e: React.PointerEvent, n: FcNode) => {
    e.stopPropagation()
    if (tool) {
      if (!tool.from) setTool({ ...tool, from: n.id })
      else {
        const from = tool.from
        change((c) => {
          const ed = connect(c, from, n.id)
          if (ed) {
            ed.head = tool.head
            if (tool.curve) ed.route = 'curve'
          }
        })
        setTool({ ...tool, from: null })
      }
      return
    }
    if ((e.metaKey || e.ctrlKey) && selNode && selNode.id !== n.id) {
      const from = selNode.id
      change((c) => {
        connect(c, from, n.id)
      })
      setSel({ node: n.id })
      return
    }
    setSel({ node: n.id })
    const p = toChart(e)
    drag.current = { id: n.id, x0: p.x, y0: p.y, nx: n.x, ny: n.y, moved: false }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const nodeMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toChart(e)
    const snap = (v: number) => Math.round(v * 10) / 10
    const nx = snap(d.nx + p.x - d.x0)
    const ny = snap(d.ny + p.y - d.y0)
    const n = nodeOf(fc, d.id)
    if (!n || (n.x === nx && n.y === ny)) return
    d.moved = true
    setFc((c) => ({ ...c, nodes: c.nodes.map((m) => (m.id === d.id ? { ...m, x: nx, y: ny } : m)) }))
  }
  const nodeUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.moved) {
      const json = chartToJson(fc)
      setHist((h) => ({ list: [...h.list.slice(0, h.i + 1), json], i: h.i + 1 }))
    }
  }

  const deleteSelected = () => {
    if (selNode) change((c) => removeNode(c, selNode.id))
    else if (sel?.edge !== undefined) {
      const i = sel.edge
      change((c) => c.edges.splice(i, 1))
    }
    setSel(null)
  }

  const insert = async () => {
    setBusy(true)
    try {
      const full = await compileStandalone(tex, 200)
      URL.revokeObjectURL(full.url)
      done({ chart: fc, pdf: full.pdf, png: full.png, tikz: toTikz(fc), widthPt: full.widthPt })
    } catch (e) {
      setPreview((p) => ({ ...p, status: `Not compiled: ${e instanceof Error ? e.message : String(e)}` }))
    } finally {
      setBusy(false)
    }
  }

  const kindIcon = (kind: string) => {
    const [w, h] = kind === 'decision' ? [34, 26] : kind === 'connector' ? [20, 20] : [34, 18]
    return (
      <svg width="40" height="30" viewBox="0 0 40 30">
        <path d={shapePath(kind, 20, 15, w, h)} fill={cols[kind][0]} stroke="#404040" strokeWidth="1.2" strokeDasharray={kind === 'note' ? '3 2' : undefined} />
      </svg>
    )
  }

  return (
    <div className="ktx-modal" onPointerDown={(e) => e.target === e.currentTarget && done(null)}>
      <div
        className="k-dialog ktx-dialog ktx-flow"
        role="dialog"
        aria-label="Flowchart builder"
        onKeyDown={(e) => {
          e.stopPropagation()
          const typing = (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'SELECT'
          if (e.key === 'Escape') done(null)
          else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) deleteSelected()
          else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
            e.preventDefault()
            step(e.shiftKey ? 1 : -1)
          } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y' && !typing) step(1)
        }}
        tabIndex={-1}
      >
        <div className="k-dialog-title">Flowchart builder</div>
        <div className="k-dialog-body">
          <div className="ktx-row center">
            <span>Start from:</span>
            <select
              className="ktx-combo"
              value=""
              onChange={(e) => {
                const make = TEMPLATES[e.target.value]
                if (!make) return
                const next = make()
                setFc(next)
                setSel(null)
                const json = chartToJson(next)
                setHist((h) => ({ list: [...h.list.slice(0, h.i + 1), json], i: h.i + 1 }))
              }}
            >
              <option value="">—</option>
              {Object.keys(TEMPLATES).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <span>Direction:</span>
            <select className="ktx-combo" value={fc.direction} onChange={(e) => change((c) => (c.direction = e.target.value as 'TB' | 'LR'))}>
              <option value="TB">Top to bottom</option>
              <option value="LR">Left to right</option>
            </select>
            <span>Colours:</span>
            <select className="ktx-combo" value={fc.scheme} onChange={(e) => change((c) => (c.scheme = e.target.value))}>
              {SCHEME_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span>Text:</span>
            <input
              className="ktx-combo"
              style={{ width: 64 }}
              type="number"
              min={6}
              max={24}
              value={fc.font_pt}
              onChange={(e) => change((c) => (c.font_pt = Math.max(6, Math.min(24, Number(e.target.value) || 11))))}
            />
            <span>pt</span>
            <button className="ktx-pbtn" title="Lay the chart out automatically" onClick={() => change((c) => autoLayout(c))}>✨ Tidy up</button>
            <span style={{ flex: 1 }} />
            <button className="ktx-pbtn" title="Undo (⌘Z)" disabled={hist.i === 0} onClick={() => step(-1)}>↶</button>
            <button className="ktx-pbtn" title="Redo (⌘Y)" disabled={hist.i >= hist.list.length - 1} onClick={() => step(1)}>↷</button>
          </div>
          <div className="ktx-flow-palette">
            {Object.entries(KINDS).map(([kind, [label]]) => (
              <button
                key={kind}
                className="ktx-flow-shape"
                title={`Add a “${label}” box after the selected one, joined by an arrow`}
                onClick={() => {
                  let added = ''
                  change((c) => {
                    added = addNode(c, kind, '', selNode?.id ?? (c.nodes.length ? c.nodes[c.nodes.length - 1].id : null)).id
                  })
                  window.setTimeout(() => {
                    setSel({ node: added })
                    textRef.current?.select()
                  }, 0)
                }}
              >
                {kindIcon(kind)}
                <span>{label}</span>
              </button>
            ))}
            <span className="ktx-flow-gap" />
            {([
              ['end', false, 'Arrow', 'Draw an arrow: click the box it starts from, then the box it goes to'],
              ['end', true, 'Curve', 'Draw a curved arrow: click the box it starts from, then the box it goes to'],
              ['none', false, 'Line', 'Draw a plain line between two boxes: click one, then the other'],
            ] as const).map(([head, curve, label, tip]) => {
              const on = tool && tool.head === head && tool.curve === curve
              return (
                <button
                  key={label}
                  className={`ktx-flow-shape${on ? ' on' : ''}`}
                  title={tip}
                  onClick={() => setTool(on ? null : { head, curve, from: null })}
                >
                  <svg width="40" height="30" viewBox="0 0 40 30">
                    <path d={curve ? 'M6,24Q20,0 34,20' : 'M6,15H34'} fill="none" stroke="#404040" strokeWidth="1.6" />
                    {head === 'end' && <path d={curve ? 'M34,20l-7,-1l3,-5z' : 'M34,15l-7,-4v8z'} fill="#404040" />}
                  </svg>
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
          <div className="ktx-flow-main">
            <div className="ktx-flow-canvas" onPointerDown={() => setSel(null)}>
              <svg
                ref={svg}
                viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
                width={maxX - minX}
                height={maxY - minY}
                onPointerMove={nodeMove}
                onPointerUp={nodeUp}
              >
                <defs>
                  <pattern id="ktx-grid" width={fc.col_cm * S * 0.5} height={fc.row_cm * S * 0.5} patternUnits="userSpaceOnUse" x={0} y={0}>
                    <circle cx="0" cy="0" r="1" fill="#d0d4da" />
                  </pattern>
                  <marker id="ktx-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0L10,5L0,10z" fill={cols.line[0]} />
                  </marker>
                </defs>
                <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} fill="url(#ktx-grid)" />
                {fc.edges.map((e, i) => {
                  const d = edgePath(fc, e, pos)
                  const on = sel?.edge === i
                  return (
                    <g key={i} onPointerDown={(ev) => {
                      ev.stopPropagation()
                      setSel({ edge: i })
                    }}>
                      <path d={d} fill="none" stroke="transparent" strokeWidth="10" />
                      <path
                        d={d}
                        fill="none"
                        stroke={on ? 'var(--k-accent)' : cols.line[0]}
                        strokeWidth={on ? 2.4 : 1.6}
                        strokeDasharray={e.dashed ? '5 4' : undefined}
                        markerEnd={e.head === 'end' || e.head === 'both' ? 'url(#ktx-arrow)' : undefined}
                        markerStart={e.head === 'start' || e.head === 'both' ? 'url(#ktx-arrow)' : undefined}
                      />
                    </g>
                  )
                })}
                {fc.nodes.map((n) => {
                  const [cx, cy] = pos(n)
                  const [w, h] = boxSize(n)
                  const [fill, txt] = cols[n.kind] ?? cols.process
                  const on = sel?.node === n.id || tool?.from === n.id
                  return (
                    <g key={n.id} className="ktx-flow-node" onPointerDown={(e) => nodeDown(e, n)} onDoubleClick={() => textRef.current?.select()}>
                      <path
                        d={shapePath(n.kind, cx, cy, w, h)}
                        fill={n.fill || fill}
                        stroke={on ? 'var(--k-accent)' : cols.line[0]}
                        strokeWidth={on ? 2.6 : 1.4}
                        strokeDasharray={n.kind === 'note' ? '5 3' : undefined}
                      />
                      {n.kind === 'subprocess' && <path d={shapePath('process', cx, cy, w - 7, h)} fill="none" stroke={cols.line[0]} strokeWidth="1" />}
                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill={txt} fontSize={fc.font_pt * 1.15} fontFamily="Latin Modern Sans, Helvetica, Arial, sans-serif">
                        {plainText(n.text).slice(0, 28)}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
            <div className="ktx-flow-side">
              {selNode ? (
                <div className="ktx-form">
                  <label>Text</label>
                  <input
                    ref={textRef}
                    className="k-input"
                    placeholder="Text (LaTeX allowed)"
                    value={selNode.text}
                    onChange={(e) => {
                      const v = e.target.value
                      setFc((c) => ({ ...c, nodes: c.nodes.map((m) => (m.id === selNode.id ? { ...m, text: v } : m)) }))
                    }}
                    onBlur={() => change(() => {})}
                  />
                  <label>Shape</label>
                  <select className="ktx-combo" value={selNode.kind} onChange={(e) => change((c) => (nodeOf(c, selNode.id)!.kind = e.target.value))}>
                    {Object.entries(KINDS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <label>Fill</label>
                  <span className="ktx-row">
                    <input type="color" value={selNode.fill || (cols[selNode.kind] ?? cols.process)[0]} onChange={(e) => change((c) => (nodeOf(c, selNode.id)!.fill = e.target.value.toUpperCase()))} />
                    <button className="ktx-pbtn" disabled={!selNode.fill} onClick={() => change((c) => (nodeOf(c, selNode.id)!.fill = ''))}>From the colours</button>
                  </span>
                  <span />
                  <button className="ktx-pbtn" onClick={deleteSelected}>Delete box</button>
                </div>
              ) : selEdge ? (
                <div className="ktx-form">
                  <label>Label</label>
                  <input
                    className="k-input"
                    placeholder="e.g. Yes"
                    value={selEdge.label}
                    onChange={(e) => {
                      const v = e.target.value
                      const i = sel!.edge!
                      setFc((c) => ({ ...c, edges: c.edges.map((x, k) => (k === i ? { ...x, label: v } : x)) }))
                    }}
                    onBlur={() => change(() => {})}
                  />
                  <label>Line</label>
                  <select className="ktx-combo" value={selEdge.route} onChange={(e) => change((c) => (c.edges[sel!.edge!].route = e.target.value as FcEdge['route']))}>
                    <option value="auto">Automatic</option>
                    <option value="straight">Straight</option>
                    <option value="elbow">Elbow</option>
                    <option value="curve">Curve</option>
                  </select>
                  <label>Arrowheads</label>
                  <select className="ktx-combo" value={selEdge.head} onChange={(e) => change((c) => (c.edges[sel!.edge!].head = e.target.value as FcEdge['head']))}>
                    {Object.entries(HEADS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <label>Dashed</label>
                  <input type="checkbox" checked={selEdge.dashed} onChange={(e) => change((c) => (c.edges[sel!.edge!].dashed = e.target.checked))} />
                  <label>Leaves from</label>
                  <select className="ktx-combo" value={selEdge.src_side} onChange={(e) => change((c) => (c.edges[sel!.edge!].src_side = e.target.value))}>
                    {Object.entries(SIDES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <label>Arrives at</label>
                  <select className="ktx-combo" value={selEdge.dst_side} onChange={(e) => change((c) => (c.edges[sel!.edge!].dst_side = e.target.value))}>
                    {Object.entries(SIDES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  {selEdge.route === 'curve' && (
                    <>
                      <label>Bend</label>
                      <input
                        className="ktx-combo"
                        type="number"
                        min={-90}
                        max={90}
                        value={selEdge.bend}
                        onChange={(e) => change((c) => (c.edges[sel!.edge!].bend = Math.max(-90, Math.min(90, Number(e.target.value) || 0))))}
                      />
                    </>
                  )}
                  <span />
                  <button className="ktx-pbtn" onClick={deleteSelected}>Delete arrow</button>
                </div>
              ) : (
                <div className="ktx-dim ktx-flow-hint">
                  Select a box or an arrow to edit it.
                  <br />
                  <br />
                  Text may contain LaTeX maths, e.g. $x &gt; 0$; \\ starts a new line.
                </div>
              )}
              <div><b>Preview</b> — compiled with LaTeX</div>
              <div className="ktx-flow-preview">{preview.pic ? <img src={preview.pic.url} alt="" /> : null}</div>
              <div className="ktx-dim">{preview.status}</div>
            </div>
          </div>
          {showTex && <textarea className="k-input ktx-textarea mono" readOnly rows={8} value={toTikz(fc)} />}
          <div className="k-dialog-buttons">
            <button className={`ktx-pbtn${showTex ? ' default' : ''}`} onClick={() => setShowTex((v) => !v)}>Show LaTeX</button>
            <span className="ktx-dim" style={{ flex: 1 }}>
              {tool
                ? tool.from ? 'Now click the box the line goes to.' : 'Click the box the line starts from.'
                : 'Click a shape to add it after the selected box · drag to move · Ctrl/⌘-click a box to draw an arrow to it · Delete removes'}
            </span>
            <button className="k-btn" onClick={() => done(null)}>Cancel</button>
            <button className="k-btn primary" disabled={busy || !fc.nodes.length} onClick={() => void insert()}>
              {busy ? 'Compiling…' : 'Insert'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
