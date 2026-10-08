// The Graph tab: y = f(x), parametric, polar, implicit curves and ODE
// solutions, sampled by the Python engine for the visible window; zoom, pan,
// trace, roots / extrema / intersections / area, and a table of values.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Eye, EyeOff, Maximize, Minus, Plus, Square, Table2, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { Plot, type Marker, type PlotLayer } from './PlotCanvas'
import { GRAPH_COLORS, STANDARD_VIEW, contour, fitY, linspace, nearestPoint, squareView, traceAt, zoomAt, type View } from './plot'
import { fmt } from './format'
import { newId, type CalcSettings, type GraphItem } from './session'
import { engineSettings } from './CalcView'
import type { CalcBridge } from './bridge'

type Sampled = { ok: true; x?: (number | null)[]; y?: (number | null)[]; z?: (number | null)[][]; nx?: number; ny?: number } | { ok: false; error: string }

interface Props {
  bridge: CalcBridge
  settings: CalcSettings
  graphs: GraphItem[]
  setGraphs: (g: GraphItem[]) => void
  view: View
  setView: (v: View) => void
}

const KINDS: { id: GraphItem['kind']; label: string }[] = [
  { id: 'y', label: 'y = f(x)' },
  { id: 'param', label: 'Parametric' },
  { id: 'polar', label: 'Polar r(θ)' },
  { id: 'implicit', label: 'Implicit F(x,y)' },
  { id: 'ode', label: "ODE y' = f(x,y)" },
]

export function GraphView({ bridge, settings, graphs, setGraphs, view, setView }: Props) {
  const [data, setData] = useState<Record<string, Sampled>>({})
  const [size, setSize] = useState({ w: 800, h: 500 })
  const [sel, setSel] = useState<string | null>(graphs[0]?.id ?? null)
  const [traceOn, setTraceOn] = useState(false)
  const [trace, setTrace] = useState<{ x: number; y: number } | null>(null)
  const [found, setFound] = useState<{ title: string; points: Marker[]; value?: string } | null>(null)
  const [other, setOther] = useState<string>('')
  const [table, setTable] = useState<{ start: string; step: string; rows: { x: number[]; cols: ((number | null)[] | { error: string })[]; names: string[] } | null } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const req = useRef(0)

  const selected = graphs.find((g) => g.id === sel) ?? null
  const visible = useMemo(() => graphs.filter((g) => g.visible && g.expr.trim() && (g.kind !== 'param' || g.expr2?.trim())), [graphs])
  const sampleKey = JSON.stringify([visible.map((g) => [g.id, g.kind, g.expr, g.expr2, g.tmin, g.tmax, g.x0, g.y0]), view, size, settings.angle])

  useEffect(() => {
    if (!visible.length) {
      setData({})
      return
    }
    const n = ++req.current
    const t = setTimeout(() => {
      const items = visible.map((g) => ({
        kind: g.kind, expr: g.expr, expr2: g.expr2, tmin: g.tmin || '0', tmax: g.tmax || (g.kind === 'polar' ? '2*pi' : '2*pi'),
        x0: g.x0 || '0', y0: g.y0 || '1', nx: Math.min(220, Math.round(size.w / 5)), ny: Math.min(170, Math.round(size.h / 5)),
      }))
      bridge
        .call<{ ok: boolean; series?: Sampled[]; error?: string }>('sample', {
          items, xmin: view.xmin, xmax: view.xmax, ymin: view.ymin, ymax: view.ymax, n: Math.min(1400, Math.max(200, size.w)), settings: engineSettings(settings),
        })
        .then((r) => {
          if (n !== req.current) return
          if (!r.ok || !r.series) {
            setErr(r.error ?? 'Could not draw')
            return
          }
          setErr(null)
          const out: Record<string, Sampled> = {}
          visible.forEach((g, i) => (out[g.id] = r.series![i]))
          setData(out)
        })
        .catch(() => {})
    }, 60)
    return () => clearTimeout(t)
  }, [sampleKey, bridge])

  const layers = useMemo(() => {
    const out: PlotLayer[] = []
    for (const g of visible) {
      const d = data[g.id]
      if (!d || !d.ok) continue
      const width = g.id === sel ? 2.6 : 2
      if (g.kind === 'implicit' && d.z && d.nx && d.ny) {
        out.push({ kind: 'segments', segs: contour(d.z, linspace(view.xmin, view.xmax, d.nx), linspace(view.ymin, view.ymax, d.ny)), color: g.color, width })
      } else if (d.x && d.y) out.push({ kind: 'line', xs: d.x, ys: d.y, color: g.color, width })
    }
    return out
  }, [visible, data, sel, view])

  const update = (id: string, patch: Partial<GraphItem>) => setGraphs(graphs.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  const add = (kind: GraphItem['kind'] = 'y') => {
    const used = new Set(graphs.map((g) => g.color))
    const color = GRAPH_COLORS.find((c) => !used.has(c)) ?? GRAPH_COLORS[graphs.length % GRAPH_COLORS.length]
    const g: GraphItem = {
      id: newId(), kind, color, visible: true,
      expr: kind === 'y' ? '' : kind === 'param' ? 'cos(3t)' : kind === 'polar' ? '1 + cos(theta)' : kind === 'implicit' ? 'x^2 + y^2 = 16' : 'x - y',
      expr2: kind === 'param' ? 'sin(2t)' : undefined,
      tmin: kind === 'param' || kind === 'polar' ? '0' : undefined,
      tmax: kind === 'param' || kind === 'polar' ? '2*pi' : undefined,
      x0: kind === 'ode' ? '0' : undefined,
      y0: kind === 'ode' ? '1' : undefined,
    }
    setGraphs([...graphs, g])
    setSel(g.id)
  }

  const traceFor = (x: number, y: number) => {
    if (!selected) return null
    const d = data[selected.id]
    if (!d || !d.ok || !d.x || !d.y) return null
    if (selected.kind === 'y') return traceAt(d.x, d.y, x)
    const sx = size.w / (view.xmax - view.xmin)
    const sy = size.h / (view.ymax - view.ymin)
    return nearestPoint(d.x, d.y, x, y, sx, sy)
  }

  const analyze = async (what: 'roots' | 'extrema' | 'intersect' | 'integral') => {
    if (!selected || selected.kind !== 'y') {
      setFound({ title: 'Pick a y = f(x) graph first', points: [] })
      return
    }
    const second = graphs.find((g) => g.id === other)
    if (what === 'intersect' && (!second || second.kind !== 'y')) {
      setFound({ title: 'Choose the second y = f(x) graph to intersect with', points: [] })
      return
    }
    try {
      const r = await bridge.call<{ ok: boolean; points?: { x: number; y: number; type?: string }[]; value?: number; text?: string; error?: string }>('analyze', {
        what, expr: selected.expr, expr2: second?.expr, xmin: view.xmin, xmax: view.xmax, settings: engineSettings(settings),
      })
      if (!r.ok) return setFound({ title: r.error ?? 'Failed', points: [] })
      if (what === 'integral') {
        setFound({ title: `∫ from ${fmt(view.xmin, 6)} to ${fmt(view.xmax, 6)}`, points: [], value: r.text ?? fmt(r.value ?? NaN) })
        return
      }
      const title = { roots: 'Roots', extrema: 'Extrema', intersect: 'Intersections' }[what]
      const pts = (r.points ?? []).map((p) => ({ x: p.x, y: p.y, color: selected.color, label: p.type ?? undefined }))
      setFound({ title: `${title} in view (${pts.length})`, points: pts })
    } catch (e) {
      setFound({ title: e instanceof Error ? e.message : String(e), points: [] })
    }
  }

  const loadTable = async (start: string, step: string) => {
    const ys = graphs.filter((g) => g.kind === 'y' && g.expr.trim())
    if (!ys.length) return setTable({ start, step, rows: null })
    const r = await bridge.call<{ ok: boolean; x?: number[]; cols?: ((number | null)[] | { error: string })[]; error?: string }>('table', {
      exprs: ys.map((g) => g.expr), start: Number(start) || 0, step: Number(step) || 1, count: 40, settings: engineSettings(settings),
    })
    if (r.ok && r.x && r.cols) setTable({ start, step, rows: { x: r.x, cols: r.cols, names: ys.map((g) => g.expr) } })
  }

  const markers = useMemo(() => found?.points ?? [], [found])
  const traceShown = traceOn && trace && selected ? { ...trace, color: selected.color } : null

  return (
    <div className="kc-graph">
      <div className="kc-graph-side">
        <div className="kc-graph-list">
          {graphs.map((g, i) => (
            <div key={g.id} className={`kc-gitem${g.id === sel ? ' sel' : ''}`} onClick={() => setSel(g.id)}>
              <div className="kc-gitem-head">
                <input type="color" className="kc-swatch" value={g.color} onChange={(e) => update(g.id, { color: e.target.value })} title="Colour" />
                <select className="k-input kc-gkind" value={g.kind} onChange={(e) => update(g.id, { kind: e.target.value as GraphItem['kind'] })}>
                  {KINDS.map((k) => (
                    <option key={k.id} value={k.id}>{k.label}</option>
                  ))}
                </select>
                <button className="k-icon-btn" title={g.visible ? 'Hide' : 'Show'} onClick={() => update(g.id, { visible: !g.visible })}>
                  {g.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button className="k-icon-btn" title="Remove" onClick={() => setGraphs(graphs.filter((x) => x.id !== g.id))}>
                  <Trash2 size={14} />
                </button>
              </div>
              <GraphFields g={g} n={i + 1} onChange={(patch) => update(g.id, patch)} />
              {data[g.id] && !data[g.id].ok && <div className="kc-error small">{(data[g.id] as { error: string }).error}</div>}
            </div>
          ))}
          <div className="kc-gadd">
            <button className="k-btn small" onClick={() => add('y')}><Plus size={13} /> y = f(x)</button>
            <select className="k-input kc-gkind" value="" onChange={(e) => e.target.value && add(e.target.value as GraphItem['kind'])}>
              <option value="">More…</option>
              {KINDS.slice(1).map((k) => (
                <option key={k.id} value={k.id}>{k.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="kc-panel">
          <div className="kc-panel-title">Analyse {selected ? <span className="kc-dot" style={{ background: selected.color }} /> : null}</div>
          <div className="kc-btnrow">
            <button className="k-btn small" onClick={() => void analyze('roots')}>Roots</button>
            <button className="k-btn small" onClick={() => void analyze('extrema')}>Extrema</button>
            <button className="k-btn small" onClick={() => void analyze('integral')}>∫ area</button>
          </div>
          <div className="kc-btnrow">
            <button className="k-btn small" onClick={() => void analyze('intersect')}>Intersect with</button>
            <select className="k-input kc-gkind" value={other} onChange={(e) => setOther(e.target.value)}>
              <option value="">…</option>
              {graphs.filter((g) => g.kind === 'y' && g.id !== sel).map((g) => (
                <option key={g.id} value={g.id}>{g.expr || '(empty)'}</option>
              ))}
            </select>
          </div>
          {found && (
            <div className="kc-found">
              <div className="k-muted">{found.title}</div>
              {found.value && <div className="kc-mono kc-found-value">{found.value}</div>}
              {found.points.map((pt, i) => (
                <button key={i} className="kc-found-row" onClick={() => { setTraceOn(true); setTrace({ x: pt.x, y: pt.y }) }}>
                  <span className="kc-mono">x = {fmt(pt.x, 10)}</span>
                  <span className="kc-mono">y = {fmt(pt.y, 10)}</span>
                  {pt.label && <span className="k-muted">{pt.label}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="kc-panel">
          <div className="kc-panel-title">Window</div>
          <div className="kc-window-grid">
            {(['xmin', 'xmax', 'ymin', 'ymax'] as const).map((k) => (
              <label key={k}>
                <span>{k}</span>
                <NumField value={view[k]} onCommit={(v) => {
                  const nv = { ...view, [k]: v }
                  if (nv.xmax > nv.xmin && nv.ymax > nv.ymin) setView(nv)
                }} />
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="kc-graph-main">
        <div className="k-toolbar kc-graph-bar">
          <button className="k-icon-btn" title="Zoom in" onClick={() => setView(zoomAt(view, (view.xmin + view.xmax) / 2, (view.ymin + view.ymax) / 2, 0.5))}><ZoomIn size={16} /></button>
          <button className="k-icon-btn" title="Zoom out" onClick={() => setView(zoomAt(view, (view.xmin + view.xmax) / 2, (view.ymin + view.ymax) / 2, 2))}><ZoomOut size={16} /></button>
          <button className="k-btn small" title="Standard window" onClick={() => setView(STANDARD_VIEW)}>Std</button>
          <button className="k-btn small" title="Trigonometric window" onClick={() => setView({ xmin: -2 * Math.PI, xmax: 2 * Math.PI, ymin: -4, ymax: 4 })}>Trig</button>
          <button className="k-icon-btn" title="Equal scales (square)" onClick={() => setView(squareView(view, size.w, size.h))}><Square size={15} /></button>
          <button className="k-icon-btn" title="Fit y to the curves" onClick={() => {
            const ys = Object.values(data).flatMap((d) => (d.ok && d.y ? [d.y] : []))
            setView({ ...view, ...fitY(ys, view) })
          }}><Maximize size={15} /></button>
          <span className="k-sep" />
          <button className={`k-icon-btn${traceOn ? ' active' : ''}`} title="Trace the selected graph (← → move)" onClick={() => setTraceOn(!traceOn)}><Crosshair size={16} /></button>
          <button className={`k-icon-btn${table ? ' active' : ''}`} title="Table of values" onClick={() => (table ? setTable(null) : void loadTable('0', '1'))}><Table2 size={16} /></button>
          <span className="k-spacer" />
          {err && <span className="kc-error small">{err}</span>}
          {settings.angle !== 'rad' && <span className="k-muted small">trig in {settings.angle.toUpperCase()}</span>}
        </div>
        <div className="kc-graph-canvas">
          <Plot
            view={view}
            onView={setView}
            layers={layers}
            markers={markers}
            trace={traceShown}
            onSize={(w, h) => setSize({ w, h })}
            onPointer={(pt) => {
              if (!traceOn || !pt) return
              const t = traceFor(pt.x, pt.y)
              if (t) setTrace({ x: t.x, y: t.y })
            }}
            onKeyDown={(e) => {
              if (!traceOn || !trace) return
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              const dx = ((view.xmax - view.xmin) / 200) * (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)
              const t = traceFor(trace.x + dx, trace.y)
              if (t) setTrace({ x: t.x, y: t.y })
            }}
          />
          {!graphs.length && (
            <div className="kc-graph-empty">
              <button className="k-btn primary" onClick={() => add('y')}><Plus size={14} /> Add a function</button>
            </div>
          )}
        </div>
        {table && (
          <div className="kc-table-pane">
            <div className="kc-table-bar">
              <label>start <NumField value={Number(table.start) || 0} onCommit={(v) => void loadTable(String(v), table.step)} /></label>
              <label>step <NumField value={Number(table.step) || 1} onCommit={(v) => void loadTable(table.start, String(v))} /></label>
              <button className="k-icon-btn" title="Close" onClick={() => setTable(null)}><Minus size={14} /></button>
            </div>
            {table.rows ? (
              <div className="kc-table-scroll">
                <table className="kc-table">
                  <thead>
                    <tr>
                      <th>x</th>
                      {table.rows.names.map((n, i) => <th key={i}>{n}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.x.map((x, r) => (
                      <tr key={r}>
                        <td>{fmt(x, 10)}</td>
                        {table.rows!.cols.map((c, i) => <td key={i}>{Array.isArray(c) ? fmt(c[r], 10) : 'error'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="k-muted kc-pad">Add a y = f(x) graph to see its values.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function GraphFields({ g, n, onChange }: { g: GraphItem; n: number; onChange: (p: Partial<GraphItem>) => void }) {
  const field = (label: string, value: string | undefined, key: keyof GraphItem, placeholder = '') => (
    <label className="kc-gfield">
      <span className="kc-glabel">{label}</span>
      <input className="k-input kc-mono" value={value ?? ''} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange({ [key]: e.target.value } as Partial<GraphItem>)} />
    </label>
  )
  switch (g.kind) {
    case 'y':
      return field(`y${n} =`, g.expr, 'expr', 'sin(x)/x')
    case 'param':
      return (
        <>
          {field('x(t) =', g.expr, 'expr')}
          {field('y(t) =', g.expr2, 'expr2')}
          <div className="kc-grange">{field('t from', g.tmin, 'tmin')}{field('to', g.tmax, 'tmax')}</div>
        </>
      )
    case 'polar':
      return (
        <>
          {field('r(θ) =', g.expr, 'expr', '1 + cos(theta)')}
          <div className="kc-grange">{field('θ from', g.tmin, 'tmin')}{field('to', g.tmax, 'tmax')}</div>
        </>
      )
    case 'implicit':
      return field('', g.expr, 'expr', 'x^2 + y^2 = 16')
    case 'ode':
      return (
        <>
          {field("y' =", g.expr, 'expr', 'x - y')}
          <div className="kc-grange">{field('x₀', g.x0, 'x0')}{field('y(x₀)', g.y0, 'y0')}</div>
        </>
      )
  }
}

/** A number box that applies its value on Enter or when it loses focus. */
export function NumField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(fmt(value, 8))
  useEffect(() => setText(fmt(value, 8)), [value])
  const commit = () => {
    const v = Number(text.replace(/π|pi/g, String(Math.PI)))
    if (Number.isFinite(v)) onCommit(v)
    else setText(fmt(value, 8))
  }
  return (
    <input className="k-input kc-num" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
  )
}
