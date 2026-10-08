// The side panels of kPCB: the footprint library, layers, nets, properties and the design-rule check.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, CircleAlert, Eye, EyeOff, Lock, Plus, Search, Trash2 } from 'lucide-react'
import { FOOTPRINTS, FOOTPRINT_CATEGORIES, getFootprint, searchFootprints } from './footprints.ts'
import { LAYER_LABELS } from './draw.ts'
import type { Appearance } from './draw.ts'
import { arcPoints } from './geom.ts'
import { OUTLINE_PRESETS, alignParts, assignPad, createNet, deleteNet, distributeParts, renameNet, setNetClass } from './ops.ts'
import type { Item } from './ops.ts'
import { LAYERS, TRACK_WIDTHS, VIA_PRESETS } from './types.ts'
import type { CopperId, Design, Fills, LayerId, Net, Rules, Violation } from './types.ts'
import { fmtLen, mmToUnit } from './ui.ts'
import type { Editor, UIState } from './ui.ts'
import { netOfPad } from './board.ts'
import type { RatLine } from './analysis.ts'

// ------------------------------------------------------------ small controls

/** A number field in the current unit: commits on Enter or when it loses focus. */
export function NumField({ value, unit, onCommit, min, width = 64, title }: { value: number; unit: 'mm' | 'mil'; onCommit: (mm: number) => void; min?: number; width?: number; title?: string }) {
  const show = (v: number) => String(Math.round(mmToUnit(v, unit) * 1000) / 1000)
  const [text, setText] = useState(show(value))
  const focus = useRef(false)
  useEffect(() => {
    if (!focus.current) setText(show(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, unit])
  const commit = () => {
    const n = Number(text.replace(',', '.'))
    if (!Number.isFinite(n) || text.trim() === '') {
      setText(show(value))
      return
    }
    const mm = unit === 'mil' ? n * 0.0254 : n
    if (min !== undefined && mm < min) {
      setText(show(value))
      return
    }
    if (Math.abs(mm - value) > 1e-9) onCommit(mm)
  }
  return (
    <input
      className="k-input kb-num" style={{ width }} value={text} title={title} inputMode="decimal"
      onFocus={() => { focus.current = true }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { focus.current = false; commit() }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(show(value)); (e.target as HTMLInputElement).blur() } }}
    />
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="kb-row">
      <span className="kb-row-label">{label}</span>
      <span className="kb-row-value">{children}</span>
    </label>
  )
}

// ------------------------------------------------------------ footprint preview

export function FootprintPreview({ name }: { name: string }) {
  const fp = getFootprint(name)
  if (!fp) return <div className="kb-preview" />
  const c = fp.court
  const pad = 0.6
  const vb = `${c.x0 - pad} ${c.y0 - pad} ${c.x1 - c.x0 + 2 * pad} ${c.y1 - c.y0 + 2 * pad}`
  return (
    <svg className="kb-preview" viewBox={vb} role="img" aria-label={`Footprint ${fp.name}`}>
      <rect x={c.x0} y={c.y0} width={c.x1 - c.x0} height={c.y1 - c.y0} fill="none" stroke="#ff26e2" strokeWidth="0.08" strokeDasharray="0.3 0.2" />
      {fp.silk.map((s, i) => {
        if (s.t === 'line') return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#f2eda1" strokeWidth="0.15" strokeLinecap="round" />
        if (s.t === 'circle') return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="none" stroke="#f2eda1" strokeWidth="0.15" />
        const pts = arcPoints(s.cx, s.cy, s.r, s.a0, s.a1, 16)
        return <polyline key={i} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#f2eda1" strokeWidth="0.15" />
      })}
      {fp.pads.map((p, i) => {
        const fill = p.plated === false ? 'none' : '#c83434'
        if (p.shape === 'round' && Math.abs(p.w - p.h) < 1e-9) return <circle key={i} cx={p.x} cy={p.y} r={p.w / 2} fill={fill} stroke={p.plated === false ? '#888' : 'none'} strokeWidth="0.1" />
        const rx = p.shape === 'rect' ? 0 : p.shape === 'roundrect' ? Math.min(p.w, p.h) * (p.rr ?? 0.25) : Math.min(p.w, p.h) / 2
        return <rect key={i} x={p.x - p.w / 2} y={p.y - p.h / 2} width={p.w} height={p.h} rx={rx} fill={fill} />
      })}
      {fp.pads.filter((p) => p.drill !== undefined).map((p, i) => <circle key={`d${i}`} cx={p.x} cy={p.y} r={(p.drill ?? 0) / 2} fill="#0b0f14" />)}
    </svg>
  )
}

// ------------------------------------------------------------ library

export function LibraryPanel({ current, onPick, searchRef }: { current: string; onPick: (fp: string) => void; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [hover, setHover] = useState('')
  const list = useMemo(() => searchFootprints(q).filter((f) => !cat || f.cat === cat), [q, cat])
  const shown = hover || current
  return (
    <div className="kb-panel">
      <div className="kb-search">
        <Search size={13} />
        <input ref={searchRef} className="k-input" placeholder="Search footprints…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search footprints" />
      </div>
      <select className="k-input kb-cat" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
        <option value="">All categories ({FOOTPRINTS.length})</option>
        {FOOTPRINT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <div className="kb-list" onMouseLeave={() => setHover('')}>
        {list.map((f) => (
          <button key={f.name} className={`kb-item${f.name === current ? ' on' : ''}`} onClick={() => onPick(f.name)} onMouseEnter={() => setHover(f.name)} title={f.desc}>
            <span className="kb-item-name">{f.name}</span>
            <span className="k-muted kb-item-desc">{f.desc}</span>
          </button>
        ))}
        {!list.length && <div className="kb-pad k-muted">No footprint matches “{q}”.</div>}
      </div>
      <div className="kb-preview-box">
        <FootprintPreview name={shown} />
        <div className="kb-preview-info">
          <b>{shown}</b>
          <span className="k-muted">{getFootprint(shown)?.pads.length} pads · {getFootprint(shown)?.smd ? 'surface mount' : 'through hole'}</span>
        </div>
      </div>
      <div className="kb-hint k-muted">Click a footprint, then click on the board. R rotates, F flips to the other side, Esc stops.</div>
    </div>
  )
}

// ------------------------------------------------------------ layers

export function LayersPanel({ ui, patchAp, patchUI }: { ui: UIState; patchAp: (p: Partial<Appearance>) => void; patchUI: (p: Partial<UIState>) => void }) {
  const ap = ui.ap
  const setVis = (l: LayerId, v: boolean) => patchAp({ visible: { ...ap.visible, [l]: v } })
  const setColor = (l: LayerId, c: string) => patchAp({ colors: { ...ap.colors, [l]: c } })
  return (
    <div className="kb-panel">
      <div className="kb-layers">
        {LAYERS.map((l) => {
          const copper = l === 'F.Cu' || l === 'B.Cu'
          return (
            <div key={l} className={`kb-layer${ui.active === l ? ' on' : ''}`}>
              <button className="k-icon-btn" aria-label={`${ap.visible[l] ? 'Hide' : 'Show'} ${l}`} title={ap.visible[l] ? 'Hide' : 'Show'} onClick={() => setVis(l, !ap.visible[l])}>
                {ap.visible[l] ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <input type="color" className="kb-color" value={ap.colors[l]} onChange={(e) => setColor(l, e.target.value)} aria-label={`Colour of ${l}`} />
              <button className="kb-layer-name" disabled={!copper} title={copper ? 'Make this the active layer for routing' : LAYER_LABELS[l]} onClick={() => copper && patchUI({ active: l as CopperId })}>
                {LAYER_LABELS[l]}
              </button>
              {ui.active === l && <Check size={13} />}
            </div>
          )
        })}
      </div>
      <label className="kb-check"><input type="checkbox" checked={ap.dim} onChange={(e) => patchAp({ dim: e.target.checked })} /> Show only the active layer (dim the others)</label>
      <label className="kb-check"><input type="checkbox" checked={ap.ratsnest} onChange={(e) => patchAp({ ratsnest: e.target.checked })} /> Ratsnest (missing connections)</label>
      <label className="kb-check"><input type="checkbox" checked={ap.padNumbers} onChange={(e) => patchAp({ padNumbers: e.target.checked })} /> Pad numbers and nets (zoomed in)</label>
      <label className="kb-check"><input type="checkbox" checked={ap.markers} onChange={(e) => patchAp({ markers: e.target.checked })} /> Design-rule markers</label>
      <label className="kb-check"><input type="checkbox" checked={ap.grid} onChange={(e) => patchAp({ grid: e.target.checked })} /> Grid</label>
      <label className="kb-check"><input type="checkbox" checked={ui.flipView} onChange={(e) => patchUI({ flipView: e.target.checked })} /> View from the bottom (mirrored)</label>
      <div className="kb-hint k-muted">1 = F.Cu, 2 = B.Cu (or PageUp / PageDown). Hover a pad or track to highlight its net.</div>
    </div>
  )
}

// ------------------------------------------------------------ nets

export function NetsPanel(props: {
  design: Design
  rats: readonly RatLine[]
  ui: UIState
  hover: string
  edit: (fn: (d: Design) => Design) => void
  ed: Editor
  onNetlistText: () => void
  onUpdateNetlist: () => void
}) {
  const { design, rats, ui, ed } = props
  const missing = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rats) m.set(r.net, (m.get(r.net) ?? 0) + 1)
    return m
  }, [rats])
  const net = ui.assignNet
  const classes = Object.keys(design.classes)
  const selected = design.nets.find((n) => n.name === net)
  const ask = async (msg: string, def = '') => ed.ask(msg, def)
  return (
    <div className="kb-panel">
      <div className="kb-btnrow">
        <button className="k-btn small" onClick={async () => {
          const n = (await ask('Name of the new net:'))?.trim()
          if (!n) return
          if (!design.nets.some((x) => x.name === n)) props.edit((d) => createNet(d, n))
          ed.patchUI({ assignNet: n })
        }}><Plus size={12} /> New net</button>
        <button className={`k-btn small${ui.tool === 'assign' ? ' primary' : ''}`} disabled={!net} title="Click pads on the board to put them on the selected net (⇧ click removes)" onClick={() => ed.patchUI({ tool: ui.tool === 'assign' ? 'select' : 'assign' })}>Assign pads</button>
        <button className="k-btn small" disabled={!selected} onClick={async () => {
          const n = (await ask(`Rename ${net} to:`, net))?.trim()
          if (n && n !== net) {
            props.edit((d) => renameNet(d, net, n))
            ed.patchUI({ assignNet: n })
          }
        }}>Rename</button>
        <button className="k-btn small" disabled={!selected} onClick={() => { props.edit((d) => deleteNet(d, net)); ed.patchUI({ assignNet: '' }) }}><Trash2 size={12} /> Delete</button>
        <button className="k-btn small" disabled={!selected} title="Run the auto-router on this net only" onClick={() => ed.act('route-net')}>Route this net</button>
      </div>
      <div className="kb-list kb-nets">
        {design.nets.map((n: Net) => (
          <div key={n.name} className={`kb-net${n.name === net ? ' on' : ''}`} onClick={() => ed.patchUI({ assignNet: n.name })} onMouseEnter={() => ed.setHover(n.name)} onMouseLeave={() => ed.setHover('')}>
            <span className="kb-net-name">{n.name}</span>
            <span className="k-muted kb-net-n">{n.pins.length}</span>
            {missing.get(n.name) ? <span className="kb-bad" title="Connections still missing">{missing.get(n.name)} open</span> : n.pins.length > 1 ? <Check size={12} className="kb-good" /> : null}
            <select className="k-input kb-net-class" value={n.cls} onClick={(e) => e.stopPropagation()} onChange={(e) => props.edit((d) => setNetClass(d, n.name, e.target.value))} aria-label={`Class of ${n.name}`}>
              {classes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        ))}
        {!design.nets.length && <div className="kb-pad k-muted">No nets yet. Import a netlist (from kElec or text), or create nets and click pads to assign them.</div>}
      </div>
      <div className="kb-btnrow">
        <button className="k-btn small" onClick={props.onNetlistText}>Import netlist…</button>
        <button className="k-btn small" onClick={props.onUpdateNetlist} title="Add the new parts of a netlist, flag the removed ones">Update from netlist…</button>
      </div>
      <div className="kb-subtitle">Net classes</div>
      <table className="kb-classes">
        <thead><tr><th>Class</th><th>Track</th><th>Via</th><th>Drill</th><th>Clr</th></tr></thead>
        <tbody>
          {classes.map((c) => {
            const k = design.classes[c]
            const set = (patch: Partial<typeof k>) => props.edit((d) => ({ ...d, classes: { ...d.classes, [c]: { ...d.classes[c], ...patch } } }))
            return (
              <tr key={c}>
                <td>{c}</td>
                <td><NumField value={k.track} unit={ui.unit} min={0.05} width={50} onCommit={(v) => set({ track: v })} /></td>
                <td><NumField value={k.via} unit={ui.unit} min={0.2} width={50} onCommit={(v) => set({ via: v })} /></td>
                <td><NumField value={k.drill} unit={ui.unit} min={0.1} width={50} onCommit={(v) => set({ drill: v })} /></td>
                <td><NumField value={k.clearance} unit={ui.unit} min={0.05} width={50} onCommit={(v) => set({ clearance: v })} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="kb-hint k-muted">Routing uses the track width and via of the net's class ("Auto" in the toolbar).</div>
    </div>
  )
}

// ------------------------------------------------------------ properties

export function PropsPanel(props: {
  design: Design
  fills: Fills
  sel: readonly Item[]
  ui: UIState
  edit: (fn: (d: Design) => Design) => void
  ed: Editor
}) {
  const { design: d, sel, ui, ed } = props
  const u = ui.unit
  const nets = d.nets.map((n) => n.name)
  const netSelect = (value: string, onChange: (v: string) => void) => (
    <select className="k-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Net">
      <option value="">(none)</option>
      {nets.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  )
  if (sel.length === 0) return <BoardProps {...props} />
  const kinds = new Set(sel.map((i) => i.kind))
  if (sel.length > 1) {
    const parts = sel.filter((i) => i.kind === 'part').map((i) => i.id)
    return (
      <div className="kb-panel">
        <div className="kb-subtitle">{sel.length} items selected</div>
        {parts.length > 1 && (
          <>
            <div className="kb-subtitle">Align {parts.length} parts</div>
            <div className="kb-btnrow">
              {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((m) => (
                <button key={m} className="k-btn small" onClick={() => props.edit((x) => alignParts(x, parts, m))}>{{ left: 'Left', hcenter: 'Centre', right: 'Right', top: 'Top', vcenter: 'Middle', bottom: 'Bottom' }[m]}</button>
              ))}
            </div>
            <div className="kb-btnrow">
              <button className="k-btn small" disabled={parts.length < 3} onClick={() => props.edit((x) => distributeParts(x, parts, 'h'))}>Distribute across</button>
              <button className="k-btn small" disabled={parts.length < 3} onClick={() => props.edit((x) => distributeParts(x, parts, 'v'))}>Distribute down</button>
            </div>
          </>
        )}
        <div className="kb-btnrow">
          <button className="k-btn small" onClick={() => ed.act('rotate')}>Rotate</button>
          <button className="k-btn small" onClick={() => ed.act('flip')}>Flip</button>
          <button className="k-btn small" onClick={() => ed.act('duplicate')}>Duplicate</button>
          <button className="k-btn small danger" onClick={() => ed.act('delete')}>Delete</button>
        </div>
      </div>
    )
  }
  const item = sel[0]
  if (kinds.has('part')) {
    const p = d.parts.find((q) => q.id === item.id)
    if (!p) return null
    const fp = getFootprint(p.fp)
    const patch = (x: Partial<typeof p>) => props.edit((dd) => ({ ...dd, parts: dd.parts.map((q) => (q.id === p.id ? { ...q, ...x } : q)) }))
    return (
      <div className="kb-panel">
        <div className="kb-subtitle">Part {p.ref} {p.locked && <Lock size={11} />} {p.stale && <span className="kb-bad">not in the netlist</span>}</div>
        <Row label="Reference"><input className="k-input" defaultValue={p.ref} key={p.id + p.ref} onBlur={(e) => { if (e.target.value !== p.ref) ed.act(`ref:${e.target.value}`) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></Row>
        <Row label="Value"><input className="k-input" value={p.value} onChange={(e) => patch({ value: e.target.value })} /></Row>
        <Row label="Footprint">
          <input className="k-input" list="kb-fp-list" value={p.fp} onChange={(e) => { if (getFootprint(e.target.value)) ed.act(`fp:${getFootprint(e.target.value)!.name}`); else patch({ fp: e.target.value }) }} />
          <datalist id="kb-fp-list">{FOOTPRINTS.map((f) => <option key={f.name} value={f.name} />)}</datalist>
        </Row>
        <Row label="Side">
          <select className="k-input" value={p.side} onChange={(e) => ed.act(`side:${e.target.value}`)}><option value="F">Top (F)</option><option value="B">Bottom (B)</option></select>
        </Row>
        <Row label="Rotation"><NumField value={p.rot} unit="mm" width={70} title="degrees" onCommit={(v) => ed.act(`rot:${v}`)} /> °</Row>
        <Row label={`X (${u})`}><NumField value={p.x} unit={u} onCommit={(v) => patch({ x: v })} /></Row>
        <Row label={`Y (${u})`}><NumField value={p.y} unit={u} onCommit={(v) => patch({ y: v })} /></Row>
        <label className="kb-check"><input type="checkbox" checked={!!p.locked} onChange={(e) => patch({ locked: e.target.checked })} /> Locked in place</label>
        <label className="kb-check"><input type="checkbox" checked={!p.hideRef} onChange={(e) => patch({ hideRef: !e.target.checked })} /> Show the reference on the silkscreen</label>
        <div className="kb-subtitle">Pads and nets</div>
        <div className="kb-pads">
          {fp?.pads.map((pad, i) => (
            i > 0 && fp.pads.slice(0, i).some((q) => q.n === pad.n) ? null : (
              <div key={`${pad.n}-${i}`} className="kb-padrow">
                <span className="kb-padnum">{pad.n || '–'}</span>
                {pad.plated === false ? <span className="k-muted">no copper</span> : netSelect(netOfPad(d, p.ref, pad.n), (v) => props.edit((x) => assignPad(x, v, p.ref, pad.n)))}
              </div>
            )
          ))}
        </div>
      </div>
    )
  }
  if (item.kind === 'track') {
    const t = d.tracks.find((q) => q.id === item.id)
    if (!t) return null
    const patch = (x: Partial<typeof t>) => props.edit((dd) => ({ ...dd, tracks: dd.tracks.map((q) => (q.id === t.id ? { ...q, ...x } : q)) }))
    return (
      <div className="kb-panel">
        <div className="kb-subtitle">Track segment</div>
        <Row label={`Width (${u})`}><NumField value={t.w} unit={u} min={0.05} onCommit={(v) => patch({ w: v })} /></Row>
        <Row label="Layer"><select className="k-input" value={t.layer} onChange={(e) => patch({ layer: e.target.value as CopperId })}><option>F.Cu</option><option>B.Cu</option></select></Row>
        <Row label="Net">{netSelect(t.net, (v) => patch({ net: v }))}</Row>
        <Row label="Length">{fmtLen(Math.hypot(t.x2 - t.x1, t.y2 - t.y1), u)}</Row>
        <div className="kb-btnrow">
          <button className="k-btn small" onClick={() => ed.act('select-run')}>Select the run</button>
          <button className="k-btn small" onClick={() => ed.act('delete-run')}>Delete the run</button>
          <button className="k-btn small danger" onClick={() => ed.act('delete-net-copper')}>Delete the net's tracks</button>
        </div>
      </div>
    )
  }
  if (item.kind === 'via') {
    const v = d.vias.find((q) => q.id === item.id)
    if (!v) return null
    const patch = (x: Partial<typeof v>) => props.edit((dd) => ({ ...dd, vias: dd.vias.map((q) => (q.id === v.id ? { ...q, ...x } : q)) }))
    return (
      <div className="kb-panel">
        <div className="kb-subtitle">Via</div>
        <Row label={`Diameter (${u})`}><NumField value={v.d} unit={u} min={0.2} onCommit={(x) => patch({ d: x })} /></Row>
        <Row label={`Drill (${u})`}><NumField value={v.drill} unit={u} min={0.1} onCommit={(x) => patch({ drill: x })} /></Row>
        <Row label="Net">{netSelect(v.net, (x) => patch({ net: x }))}</Row>
        <Row label={`X / Y (${u})`}><NumField value={v.x} unit={u} onCommit={(x) => patch({ x })} /> <NumField value={v.y} unit={u} onCommit={(y) => patch({ y })} /></Row>
      </div>
    )
  }
  if (item.kind === 'zone') {
    const z = d.zones.find((q) => q.id === item.id)
    if (!z) return null
    const patch = (x: Partial<typeof z>) => { props.edit((dd) => ({ ...dd, zones: dd.zones.map((q) => (q.id === z.id ? { ...q, ...x } : q)) })); ed.refill() }
    return (
      <div className="kb-panel">
        <div className="kb-subtitle">Copper zone</div>
        <Row label="Net">{netSelect(z.net, (x) => patch({ net: x }))}</Row>
        <Row label="Layer"><select className="k-input" value={z.layer} onChange={(e) => patch({ layer: e.target.value as CopperId })}><option>F.Cu</option><option>B.Cu</option></select></Row>
        <Row label={`Clearance (${u})`}><NumField value={z.clearance} unit={u} min={0.05} onCommit={(x) => patch({ clearance: x })} /></Row>
        <label className="kb-check"><input type="checkbox" checked={!!z.thermal} onChange={(e) => patch({ thermal: e.target.checked })} /> Thermal reliefs on through-hole pads</label>
        <div className="kb-btnrow"><button className="k-btn small" onClick={() => ed.act('fill')}>Fill zones</button><button className="k-btn small danger" onClick={() => ed.act('delete')}>Delete</button></div>
        <div className="kb-hint k-muted">The zone is filled with copper that keeps its clearance to other nets. Drag the corners to reshape it.</div>
      </div>
    )
  }
  if (item.kind === 'hole') {
    const h = d.holes.find((q) => q.id === item.id)
    if (!h) return null
    const patch = (x: Partial<typeof h>) => props.edit((dd) => ({ ...dd, holes: dd.holes.map((q) => (q.id === h.id ? { ...q, ...x } : q)) }))
    return (
      <div className="kb-panel">
        <div className="kb-subtitle">Mounting hole</div>
        <Row label={`Diameter (${u})`}><NumField value={h.d} unit={u} min={0.3} onCommit={(x) => patch({ d: x })} /></Row>
        <Row label={`X (${u})`}><NumField value={h.x} unit={u} onCommit={(x) => patch({ x })} /></Row>
        <Row label={`Y (${u})`}><NumField value={h.y} unit={u} onCommit={(y) => patch({ y })} /></Row>
        <div className="kb-btnrow">{[2.2, 2.7, 3.2, 4.2].map((x) => <button key={x} className="k-btn small" onClick={() => patch({ d: x })}>M{Math.round(x - 0.2)} · {x}</button>)}</div>
      </div>
    )
  }
  return <BoardProps {...props} />
}

function BoardProps({ design: d, ui, edit, ed }: { design: Design; ui: UIState; edit: (fn: (d: Design) => Design) => void; ed: Editor }) {
  const u = ui.unit
  const r = d.outline.rect
  const setRect = (x: Partial<NonNullable<typeof r>>) => ed.act(`outline:${JSON.stringify({ ...(r ?? { x: 0, y: 0, w: 50, h: 50, r: 0 }), ...x })}`)
  return (
    <div className="kb-panel">
      <div className="kb-subtitle">Board</div>
      <Row label="Name"><input className="k-input" value={d.name} onChange={(e) => edit((x) => ({ ...x, name: e.target.value.replace(/[^\w.-]+/g, '_') || 'board' }))} /></Row>
      {r ? (
        <>
          <Row label={`Width (${u})`}><NumField value={r.w} unit={u} min={2} onCommit={(v) => setRect({ w: v })} /></Row>
          <Row label={`Height (${u})`}><NumField value={r.h} unit={u} min={2} onCommit={(v) => setRect({ h: v })} /></Row>
          <Row label={`Corner radius (${u})`}><NumField value={r.r} unit={u} min={0} onCommit={(v) => setRect({ r: v })} /></Row>
        </>
      ) : d.outline.pts.length >= 3 ? (
        <div className="kb-hint k-muted">Polygon outline with {d.outline.pts.length} corners. Select it (click its edge) and drag the corners.</div>
      ) : (
        <div className="kb-hint kb-bad">No board outline yet. Choose a preset below or draw one (Place › Board outline).</div>
      )}
      <Row label="Preset">
        <select className="k-input" value="" onChange={(e) => e.target.value && ed.act(`preset:${e.target.value}`)} aria-label="Outline preset">
          <option value="">Choose…</option>
          {OUTLINE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Row>
      <div className="kb-btnrow">
        <button className="k-btn small" onClick={() => ed.patchUI({ tool: 'outline' })}>Draw a rectangle</button>
        <button className="k-btn small" onClick={() => ed.patchUI({ tool: 'outline-poly' })}>Draw a polygon</button>
        <button className="k-btn small" onClick={() => ed.patchUI({ tool: 'hole' })}>Mounting holes</button>
      </div>
      <div className="kb-subtitle">Copper pours</div>
      <div className="kb-btnrow">
        <button className="k-btn small" onClick={() => ed.act('ground-plane')} title="A GND zone over the whole bottom layer">Ground plane on B.Cu</button>
        <button className="k-btn small" onClick={() => ed.act('fill')}>Fill zones</button>
      </div>
      <div className="kb-subtitle">Summary</div>
      <div className="kb-hint k-muted">{d.parts.length} parts · {d.nets.length} nets · {d.tracks.length} tracks · {d.vias.length} vias · {d.zones.length} zones · {d.holes.length} holes</div>
    </div>
  )
}

// ------------------------------------------------------------ DRC

const RULE_FIELDS: Array<[keyof Rules, string]> = [
  ['clearance', 'Clearance'],
  ['minTrack', 'Minimum track width'],
  ['minViaDrill', 'Minimum via drill'],
  ['annular', 'Minimum annular ring'],
  ['holeToHole', 'Hole to hole'],
  ['edgeClearance', 'Copper to board edge'],
  ['minDrill', 'Minimum drill'],
]
const RULE_CHECKS: Array<[keyof Rules, string]> = [
  ['shorts', 'Short circuits'],
  ['unconnected', 'Unconnected pads'],
  ['silkPad', 'Silkscreen over pads (warning)'],
  ['courtyard', 'Courtyard overlap'],
  ['dangling', 'Dangling track ends (warning)'],
]

export function DrcPanel(props: {
  design: Design
  violations: readonly Violation[]
  ran: boolean
  ui: UIState
  selected: string | null
  onRun: () => void
  onPick: (v: Violation) => void
  edit: (fn: (d: Design) => Design) => void
  ed: Editor
}) {
  const { design: d, violations: v, ui } = props
  const errors = v.filter((x) => x.severity === 'error').length
  const warnings = v.length - errors
  const rules = d.rules
  const setRule = (k: keyof Rules, val: number | boolean) => props.edit((x) => ({ ...x, rules: { ...x.rules, [k]: val } }))
  return (
    <div className="kb-panel">
      <div className="kb-btnrow">
        <button className="k-btn small primary" onClick={props.onRun}>Run the check</button>
        <label className="kb-check"><input type="checkbox" checked={ui.liveDrc} onChange={(e) => props.ed.patchUI({ liveDrc: e.target.checked })} /> Live (quick)</label>
      </div>
      <div className={`kb-verdict ${!props.ran ? '' : errors ? 'bad' : 'ok'}`}>
        {!props.ran ? 'Not run yet.' : errors === 0 && warnings === 0 ? 'No violations. The board is clean.' : `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`}
      </div>
      <div className="kb-list kb-drc">
        {v.map((x) => (
          <button key={x.id} className={`kb-viol ${x.severity}${props.selected === x.id ? ' on' : ''}`} onClick={() => props.onPick(x)}>
            {x.severity === 'error' ? <CircleAlert size={13} /> : <AlertTriangle size={13} />}
            <span>{x.message}</span>
          </button>
        ))}
      </div>
      <details className="kb-rules">
        <summary>Rules</summary>
        {RULE_FIELDS.map(([k, label]) => (
          <Row key={k} label={label}><NumField value={rules[k] as number} unit={ui.unit} min={0} onCommit={(x) => setRule(k, x)} /></Row>
        ))}
        {RULE_CHECKS.map(([k, label]) => (
          <label key={k} className="kb-check"><input type="checkbox" checked={rules[k] as boolean} onChange={(e) => setRule(k, e.target.checked)} /> {label}</label>
        ))}
      </details>
    </div>
  )
}

export const widthOptions = (unit: 'mm' | 'mil'): Array<[number, string]> => [[0, 'Auto'], ...TRACK_WIDTHS.map((w): [number, string] => [w, fmtLen(w, unit)])]
export const viaOptions = (unit: 'mm' | 'mil'): Array<[number, string]> => [[-1, 'Auto'], ...VIA_PRESETS.map((p, i): [number, string] => [i, `${fmtLen(p.d, unit)} / ${fmtLen(p.drill, unit)}`])]
