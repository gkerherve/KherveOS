// The desktop's tool windows (dev-AI libraries/ToolsMenu/…) as floating
// windows over the app, laid out as their wx frames: Measure Area
// (AreaFit_Screen), D-Parameter (Dpara_Screen), Survey Identification
// (survey.PeriodicTableWindow), Auto ID (AutoID), Binding Energy Correction
// (BECorrectionWindow), Sample/Experiment Manager (FileManager), NMF Analysis
// (PCA_Analysis), Crop and Join. The work is done by the Python requests of
// kfweb/features.py.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Answer } from './bridge'
import { FloatWin, Notebook } from './FloatWin'
import type { View } from './model'
import type { IdLine } from './Plot'
import { EXAMPLE_SYMBOLS as SYMBOLS, examplePositions, indexExamples } from './examples'

type Call = (op: string, args?: Record<string, unknown>) => Promise<Answer>

const num = (s: string, d = 0) => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : d)

function Btn({ label, onClick, disabled, title }: { label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className="kf-wxbtn" onClick={onClick} disabled={disabled} title={title}>
      {label.split('\n').map((l, i) => (
        <span key={i}>{l.trim()}</span>
      ))}
    </button>
  )
}

function Text({ value, onChange, disabled, onEnter }: { value: string; onChange: (v: string) => void; disabled?: boolean; onEnter?: () => void }) {
  return (
    <input
      className="kf-wxtext"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onEnter?.()
      }}
    />
  )
}

function CheckList({ items, picked, onChange, height = 140 }: { items: string[]; picked: Set<string>; onChange: (s: Set<string>) => void; height?: number }) {
  return (
    <div className="kf-checklist" style={{ height }}>
      {items.map((n) => (
        <label key={n}>
          <input
            type="checkbox"
            checked={picked.has(n)}
            onChange={(e) => {
              const next = new Set(picked)
              if (e.target.checked) next.add(n)
              else next.delete(n)
              onChange(next)
            }}
          />
          {n}
        </label>
      ))}
    </div>
  )
}

// ------------------------------------------------------------ Measure Area

export function MeasureAreaWindow({ view, call, vlines, onVlines, onClose, notReady, onAutoId }: {
  view: View
  call: Call
  vlines: [number, number] | null
  onVlines: (lo: number, hi: number) => void
  onClose: () => void
  notReady: (what: string) => void
  onAutoId: () => void
}) {
  const [tab, setTab] = useState(0)
  const [methods, setMethods] = useState<string[]>(['Smart', 'Shirley', 'Linear', 'U4-Tougaard', 'U2-Tougaard', 'Poly-2', 'Poly-3', 'ALS'])
  const [method, setMethod] = useState('U2-Tougaard')
  const [offL, setOffL] = useState('0.00')
  const [offR, setOffR] = useState('0.00')
  const [avg, setAvg] = useState('1')
  const [name, setName] = useState(() => view.sheet.replace(/\d+$/, '') || view.sheet)
  const [progress, setProgress] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useEffect(() => {
    void call('area_methods').then((a) => {
      if (a.ok && Array.isArray(a.methods)) setMethods(a.methods as string[])
      if (a.ok && typeof a.default === 'string') setMethod(a.default)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => setName(view.sheet.replace(/\d+$/, '') || view.sheet), [view.sheet])
  const tough = method.includes('Tougaard')
  const create = () => {
    if (!vlines) return
    void call('area_create', { method, low: vlines[0], high: vlines[1], name, offsetLow: num(offR), offsetHigh: num(offL), averagingPoints: Math.max(1, Math.round(num(avg, 1))) })
  }
  const lastArea = () => {
    const n = view.grid.length / 2
    for (let i = n - 1; i >= 0; i--) if ((view.grid[i * 2][13] ?? '').startsWith('Unfitted')) return i
    return n - 1
  }
  const page0 = (
    <div className="kf-form">
      <label>Method:</label>
      <select className="kf-wxcombo" value={method} onChange={(e) => setMethod(e.target.value)}>
        {methods.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
      <label>Offset (Left):</label>
      <Text value={offL} onChange={setOffL} />
      <label>Offset (Right):</label>
      <Text value={offR} onChange={setOffR} />
      <label>Range (Left):</label>
      <Text value={vlines ? vlines[1].toFixed(2) : '0.00'} onChange={(v) => vlines && onVlines(Math.min(vlines[0], num(v)), Math.max(vlines[0], num(v)))} />
      <label>Range (Right):</label>
      <Text value={vlines ? vlines[0].toFixed(2) : '0.00'} onChange={(v) => vlines && onVlines(Math.min(vlines[1], num(v)), Math.max(vlines[1], num(v)))} />
      <label>Averaging Points:</label>
      <Text value={avg} onChange={setAvg} />
      <label className={tough ? '' : 'kf-greyed'}>Tougaard1: B,C,D,T0</label>
      <Text value="2866,1643,1,0" onChange={() => {}} disabled={!tough} />
      <span />
      <button type="button" className="kf-info" title="Measure the area under the curve above a background, without a peak model.">
        ?
      </button>
      <label>Area Name</label>
      <Text value={name} onChange={setName} />
      <div className="kf-btns">
        <Btn label={'Switch Regions\n TAB key'} onClick={() => vlines && onVlines(vlines[0], vlines[1])} />
        <Btn label={'Automatic\nIdentification'} onClick={onAutoId} />
        <Btn label={'Create Tougaard\nModel'} disabled onClick={() => {}} />
        <Btn label={'Core Level\nList'} onClick={() => notReady('The Core Level List')} />
        <Btn label={'Create\nBackground / Area'} disabled={!vlines} onClick={create} />
        <Btn label={'Remove Last\nBackground / Area'} disabled={!view.grid.length} onClick={() => void call('remove_peak', { index: lastArea() })} />
      </div>
    </div>
  )
  const page1 = (
    <div className="kf-form">
      <label>Progress:</label>
      <input className="kf-wxtext" readOnly value={progress} />
      <div className="kf-btns">
        <Btn label="Select All" onClick={() => setPicked(new Set(view.sheets))} />
        <Btn label="Unselect All" onClick={() => setPicked(new Set())} />
      </div>
      <CheckList items={view.sheets} picked={picked} onChange={setPicked} />
      <div className="kf-btns">
        <Btn
          label={'Propagate/Prop. Area\nto Column'}
          disabled={!picked.size}
          onClick={() =>
            void call('area_batch', { sheets: view.sheets.filter((s) => picked.has(s)), offsetLow: num(offR), offsetHigh: num(offL) }).then((a) => {
              if (a.ok) setProgress(`Done: ${(a.done as unknown[] | undefined)?.length ?? 0}, skipped: ${(a.skipped as unknown[] | undefined)?.length ?? 0}`)
            })
          }
        />
        <Btn label={'Prop. Row to\nSelected Core Levels'} onClick={() => notReady('Prop. Row to Selected Core Levels')} />
        <Btn label={'Create Profile\nAt(%) Results Grid'} onClick={() => notReady('The profile from the Results grid')} />
        <Btn label={'Create Profile\nAt(%) Fitting Grid'} onClick={() => notReady('The profile from the Fitting grid')} />
      </div>
    </div>
  )
  return (
    <FloatWin title="Measure Area" initial={{ x: 400, y: 70 }} width={300} onClose={onClose} className="kf-fitwin">
      <Notebook tabs={['Measure Area', 'Batching']} active={tab} onChange={setTab}>
        {tab === 0 ? page0 : page1}
      </Notebook>
    </FloatWin>
  )
}

// ------------------------------------------------------------ D-parameter

export function DParamWindow({ call, onClose }: { call: Call; onClose: () => void }) {
  const [smooth, setSmooth] = useState('7')
  const [pre, setPre] = useState('2')
  const [diff, setDiff] = useState('1')
  const [post, setPost] = useState('1')
  const [algos, setAlgos] = useState<string[]>(['Gaussian'])
  const [algo, setAlgo] = useState('Gaussian')
  const [d, setD] = useState<number | null>(null)
  const [cal, setCal] = useState<Record<string, unknown> | null>(null)
  const [res, setRes] = useState<Answer | null>(null)
  const [tab, setTab] = useState(0)
  useEffect(() => {
    void call('dparam_calibration').then((a) => {
      if (!a.ok) return
      setCal(a)
      const list = (a.algorithms as string[] | undefined) ?? []
      if (list.length) setAlgos(list)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const calc = () =>
    void call('dparam', { smooth: num(smooth, 7), pre: Math.round(num(pre, 2)), diff: num(diff, 1), post: Math.round(num(post, 1)), algorithm: algo }).then((a) => {
      if (a.ok) {
        setD(typeof a.d === 'number' ? a.d : null)
        setRes(a)
      }
    })
  const refs = (cal?.references ?? cal?.table ?? []) as (Record<string, unknown> | unknown[])[]
  return (
    <FloatWin title="D-Parameter Measurement" initial={{ x: 360, y: 90 }} width={560} onClose={onClose}>
      <div className="kf-dpara">
        <div className="kf-dpara-left">
          <fieldset className="kf-box">
            <legend>Parameters</legend>
            <div className="kf-form">
              <label>Smooth Width</label>
              <Text value={smooth} onChange={setSmooth} />
              <label>Pre-Smooth Passes</label>
              <Text value={pre} onChange={setPre} />
              <label>Differentiation Width (eV)</label>
              <Text value={diff} onChange={setDiff} />
              <label>Post-Smooth Passes</label>
              <Text value={post} onChange={setPost} />
              <label>Smooth Algorithm</label>
              <select className="kf-wxcombo" value={algo} onChange={(e) => setAlgo(e.target.value)}>
                {algos.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
          </fieldset>
          <fieldset className="kf-box">
            <legend>D-Parameter Value (eV)</legend>
            <div className="kf-dvalue">
              <input className="kf-wxtext" readOnly value={d !== null ? d.toFixed(2) : ''} /> eV
            </div>
          </fieldset>
          <div className="kf-btns-row">
            <Btn label="Clear D-para" onClick={() => void call('dparam_clear').then(() => setD(null))} />
            <Btn label="Calculate" onClick={calc} />
          </div>
        </div>
        <div className="kf-dpara-right">
          <Notebook tabs={['Calibration', 'Reference data']} active={tab} onChange={setTab}>
            {tab === 0 ? (
              <div className="kf-note">
                {res && typeof res.sp2 === 'number' ? `sp² fraction ≈ ${(res.sp2 * (res.sp2 <= 1 ? 100 : 1)).toFixed(0)} % (diamond ~14 eV, graphite ~22.5 eV)` : 'Calculate a D-parameter to locate it below.'}
                {res && res.nearest ? <div>Nearest reference: {String(typeof res.nearest === 'object' ? JSON.stringify(res.nearest) : res.nearest)}</div> : null}
              </div>
            ) : (
              <div className="kf-reftable">
                <table>
                  <tbody>
                    {refs.map((r, i) => (
                      <tr key={i}>
                        {(Array.isArray(r) ? r : Object.values(r)).map((c, j) => (
                          <td key={j}>{String(c)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Notebook>
        </div>
      </div>
    </FloatWin>
  )
}

// ------------------------------------------------------ Survey identification

interface ElementLine {
  name: string
  be: number
  kind: string
  rsf?: number
  ke?: number
}
interface ElementInfo {
  symbol: string
  z: number
  name: string
  group: string
  lines: ElementLine[]
  range: ElementLine[]
}
interface ElementsData {
  photons: number
  groups: Record<string, string[]>
  groupOrder: string[]
  groupDefaults: Record<string, boolean>
  usualSuspects: string[]
  elements: ElementInfo[]
}

let elementsPromise: Promise<ElementsData> | null = null
export function loadElements(base: string): Promise<ElementsData> {
  elementsPromise ??= fetch(`${base}apps/khervefitting/py/data/elements.json`).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json() as Promise<ElementsData>
  })
  return elementsPromise
}

/** Periodic-table position (row, column) of an element by Z (lanthanides and actinides below). */
function ptPos(z: number): [number, number] {
  if (z === 1) return [1, 1]
  if (z === 2) return [1, 18]
  const periods = [[3, 10, 2], [11, 18, 3], [19, 36, 4], [37, 54, 5], [55, 86, 6], [87, 118, 7]]
  for (const [a, b, row] of periods) {
    if (z < a || z > b) continue
    if (row <= 3) {
      const i = z - a
      return [row, i < 2 ? i + 1 : i + 11]
    }
    if (row <= 5) return [row, z - a + 1]
    if (z >= a + 3 && z <= a + 16) return [row === 6 ? 9 : 10, z - a + 1]
    return [row, z - a < 3 ? z - a + 1 : z - a - 13]
  }
  return [1, 1]
}

const GROUP_COLOURS: Record<string, string> = {
  'Non-Metals': '#a5d6a7', Halogens: '#fff59d', 'Noble Gases': '#b3e5fc', 'Alkali Metals': '#ffcc80', 'Alkaline Earth Metals': '#ffe0b2',
  'Transition Metals': '#f8bbd0', 'Post-Transition Metals': '#cfd8dc', Metalloids: '#dcedc8', Lanthanides: '#d1c4e9', Actinides: '#e1bee7',
}

export function IdWindow({ base, photons, limits, onLines, onAddLabels, onClear, onAutoId, onClose }: {
  base: string
  photons: number
  limits: { xmin: number; xmax: number }
  onLines: (lines: IdLine[]) => void
  onAddLabels: (labels: { text: string; x: number }[]) => void
  onClear: () => void
  onAutoId: () => void
  onClose: () => void
}) {
  const [data, setData] = useState<ElementsData | null>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState(0)
  const [sel, setSel] = useState<string[]>([])
  const [intensity, setIntensity] = useState(0.6)
  const [center, setCenter] = useState(() => ((limits.xmin + limits.xmax) / 2).toFixed(2))
  const [range, setRange] = useState('10')
  const [kinds, setKinds] = useState({ auger: true, doublets: true, core: true, usual: false })
  const [groups, setGroups] = useState<Record<string, boolean>>({})
  useEffect(() => {
    loadElements(base).then(
      (d) => {
        setData(d)
        setGroups(d.groupDefaults)
      },
      (e: unknown) => setErr(String(e)),
    )
  }, [base])
  const be = (l: ElementLine) => (typeof l.ke === 'number' ? photons - l.ke : l.be)
  const fmt = (sym: string, name: string) => `${sym}${name.replace(/(\d)\/(\d)/, '$_{$1/$2}$')}`

  // Lines by Element: blue lines, height ∝ RSF (Auger 0.3), only those in view
  const lines = useMemo<IdLine[]>(() => {
    if (!data) return []
    const out: IdLine[] = []
    for (const sym of sel) {
      const el = data.elements.find((e) => e.symbol === sym)
      if (!el) continue
      const inView = el.lines.filter((l) => be(l) >= limits.xmin && be(l) <= limits.xmax && be(l) < photons)
      const maxRsf = Math.max(0, ...inView.map((l) => l.rsf ?? 0))
      for (const l of inView) {
        const auger = /kll|lmm|mnn|mvv|mnv/i.test(l.name) || l.kind === 'auger'
        const f = auger ? 0.3 : !l.rsf ? 0.1 : l.rsf / (maxRsf || 1)
        out.push({ x: be(l), frac: f * intensity, text: fmt(sym, l.name) })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sel, intensity, limits.xmin, limits.xmax, photons])
  useEffect(() => onLines(tab === 0 ? lines : []), [lines, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onLines([]), []) // eslint-disable-line react-hooks/exhaustive-deps

  const inRange = useMemo(() => {
    if (!data) return []
    const c = num(center)
    const r = num(range, 10) / 2
    const out: { sym: string; name: string; be: number; kind: string }[] = []
    for (const el of data.elements) {
      if (!groups[el.group]) continue
      if (kinds.usual && !data.usualSuspects.includes(el.symbol)) continue
      for (const l of el.range) {
        const v = be(l)
        if (v < c - r || v > c + r) continue
        const auger = l.kind === 'auger'
        const doublet = /\d\/\d/.test(l.name)
        if (auger ? !kinds.auger : doublet ? !kinds.doublets : !kinds.core) continue
        out.push({ sym: el.symbol, name: l.name, be: v, kind: l.kind })
      }
    }
    return out.sort((a, b) => a.be - b.be)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, center, range, kinds, groups, photons])

  const table: ReactNode = data ? (
    <div className="kf-pt">
      {data.elements
        .filter((e) => e.z <= 103)
        .map((e) => {
          const [r, c] = ptPos(e.z)
          const on = sel.includes(e.symbol)
          return (
            <button
              key={e.symbol}
              type="button"
              title={`${e.name} (${e.z})`}
              className={on ? 'kf-pt-on' : ''}
              style={{ gridRow: r, gridColumn: c, background: on ? '#4FBE9F' : GROUP_COLOURS[e.group] }}
              onClick={() => setSel(on ? sel.filter((s) => s !== e.symbol) : [...sel, e.symbol])}
            >
              {e.symbol}
            </button>
          )
        })}
    </div>
  ) : (
    <p className="kf-note">{err || 'Loading the elements…'}</p>
  )

  const page0 = (
    <div className="kf-id">
      {table}
      <div className="kf-id-side">
        <Btn label="Add Labels" disabled={!lines.length} onClick={() => onAddLabels(lines.map((l) => ({ text: l.text, x: l.x })))} />
        <Btn label="Clear Selected" disabled={!sel.length} onClick={() => setSel([])} />
        <Btn label="Clear All List" onClick={() => {
          setSel([])
          onClear()
        }} />
        <Btn label="Auto ID" onClick={onAutoId} />
        <span>Line Intensity:</span>
        <span className="kf-row">
          <button type="button" className="kf-info" onClick={() => setIntensity((v) => Math.max(0.1, +(v - 0.1).toFixed(1)))}>
            -
          </button>
          <span style={{ width: 30, textAlign: 'center' }}>{intensity.toFixed(1)}</span>
          <button type="button" className="kf-info" onClick={() => setIntensity((v) => Math.min(3, +(v + 0.1).toFixed(1)))}>
            +
          </button>
        </span>
      </div>
    </div>
  )
  const page1 = (
    <div className="kf-idrange">
      <fieldset className="kf-box">
        <legend>Controls</legend>
        <p className="kf-note">Drag vLines | Wheel to resize</p>
        <span>Orbital Types:</span>
        {(['auger', 'doublets', 'core'] as const).map((k) => (
          <label key={k}>
            <input type="checkbox" checked={kinds[k]} onChange={(e) => setKinds({ ...kinds, [k]: e.target.checked })} /> {k === 'auger' ? 'Auger Peaks' : k === 'doublets' ? 'Doublets' : 'Core Levels'}
          </label>
        ))}
        <label>
          <input type="checkbox" checked={kinds.usual} onChange={(e) => setKinds({ ...kinds, usual: e.target.checked })} /> Most common elements Only
        </label>
        <div className="kf-form">
          <label>Center (eV):</label>
          <Text value={center} onChange={setCenter} />
          <label>Range (eV):</label>
          <Text value={range} onChange={setRange} />
        </div>
        <Btn label="Center to Plot" onClick={() => setCenter(((limits.xmin + limits.xmax) / 2).toFixed(2))} />
      </fieldset>
      <fieldset className="kf-box">
        <legend>Element Groups</legend>
        {(data?.groupOrder ?? []).slice().sort().map((g) => (
          <label key={g}>
            <input type="checkbox" checked={!!groups[g]} onChange={(e) => setGroups({ ...groups, [g]: e.target.checked })} /> {g}
          </label>
        ))}
      </fieldset>
      <fieldset className="kf-box">
        <legend>Core Levels</legend>
        <div className="kf-checklist" style={{ height: 220 }}>
          {inRange.map((l, i) => (
            <div key={i} className="kf-rangeline" onDoubleClick={() => onAddLabels([{ text: fmt(l.sym, l.name), x: l.be }])} title="Double-click: add as a label">
              {l.sym}
              {l.name} {l.be.toFixed(1)}
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  )
  return (
    <FloatWin title="Survey Identification / Labelling" initial={{ x: 120, y: 80 }} width={tab === 0 ? 720 : 640} onClose={onClose}>
      <Notebook tabs={['Lines by Element', 'Lines by Range']} active={tab} onChange={setTab}>
        {tab === 0 ? page0 : page1}
      </Notebook>
    </FloatWin>
  )
}

// ----------------------------------------------------------------- Auto ID

interface Proposal {
  element: string
  line: string
  assignment: string
  be: number
  score?: number
  confidence?: string | number
  ticked?: boolean
}

export function AutoIdWindow({ call, onClose }: { call: Call; onClose: () => void }) {
  const [prom, setProm] = useState('0.9')
  const [force, setForce] = useState('')
  const [items, setItems] = useState<(Proposal & { on: boolean })[]>([])
  const [status, setStatus] = useState('Ready to run identification...')
  const run = () => {
    setStatus('Running…')
    void call('auto_id', { prominence: num(prom, 0.9), force }).then((a) => {
      if (!a.ok) return setStatus(a.error ?? 'Failed.')
      const p = ((a.proposals as Proposal[] | undefined) ?? []).map((x) => ({ ...x, on: x.ticked !== false }))
      setItems(p)
      setStatus(`${p.length} peaks identified.`)
    })
  }
  const create = (mode: 'labels' | 'areas') =>
    void call('auto_id_create', { items: items.filter((x) => x.on).map((x) => ({ assignment: x.assignment, be: x.be })), mode, force }).then((a) => {
      if (a.ok) setStatus(mode === 'labels' ? 'Labels created.' : 'Areas created.')
    })
  return (
    <FloatWin title="Auto ID" initial={{ x: 200, y: 90 }} width={520} onClose={onClose}>
      <div className="kf-autoid">
        <fieldset className="kf-box">
          <legend>Peak Finding Parameters</legend>
          <div className="kf-form">
            <label>Prominence (%):</label>
            <Text value={prom} onChange={setProm} />
          </div>
          <p className="kf-note">Percentage of max peak (0.9 = 0.9%)</p>
        </fieldset>
        <fieldset className="kf-box">
          <legend>Parameters / Force Elements</legend>
          <label>Force Elements/Core Levels (Optional):</label>
          <Text value={force} onChange={setForce} />
          <p className="kf-note">Examples: Ni, Br3d, Nakll, -Zn (comma separated, use - to exclude)</p>
        </fieldset>
        <div className="kf-btns-row">
          <Btn label="Run" onClick={run} />
          <Btn label="Delete" onClick={() => void call('auto_id_clear').then(() => setItems([]))} />
        </div>
        <div className="kf-grid" style={{ height: 220 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 24 }} />
                <th style={{ width: 70 }}>BE (eV)</th>
                <th style={{ width: 160 }}>Assignment</th>
                <th style={{ width: 70 }}>Score</th>
                <th style={{ width: 90 }}>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {items.map((x, i) => (
                <tr key={i}>
                  <td className="kf-center">
                    <input type="checkbox" className="kf-check" checked={x.on} onChange={(e) => setItems(items.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} />
                  </td>
                  <td>{x.be.toFixed(2)}</td>
                  <td>{x.assignment || `${x.element}${x.line}`}</td>
                  <td>{x.score !== undefined ? Number(x.score).toFixed(2) : ''}</td>
                  <td>{x.confidence ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="kf-btns-row">
          <Btn label="Select All" onClick={() => setItems(items.map((x) => ({ ...x, on: true })))} />
          <Btn label="Deselect All" onClick={() => setItems(items.map((x) => ({ ...x, on: false })))} />
          <Btn label="Create Areas" disabled={!items.some((x) => x.on)} onClick={() => create('areas')} />
          <Btn label="Create Labels" disabled={!items.some((x) => x.on)} onClick={() => create('labels')} />
        </div>
        <p className="kf-status-text">{status}</p>
      </div>
    </FloatWin>
  )
}

// ---------------------------------------------------------- BE correction

interface SampleRow {
  sample: number | string
  name: string
  be: number
  cells: Record<string, string>
}

export function BeCorrectionWindow({ call, view, onClose }: { call: Call; view: View; onClose: () => void }) {
  const [peak, setPeak] = useState('C1s C-C')
  const [ref, setRef] = useState('284.8')
  const [rows, setRows] = useState<SampleRow[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState('')
  const reload = () => void call('samples').then((a) => a.ok && setRows((a.rows as SampleRow[] | undefined) ?? []))
  useEffect(reload, [view.sheet, view.extra?.beCorrection]) // eslint-disable-line react-hooks/exhaustive-deps
  const label = (r: SampleRow) => `Row ${r.sample}${r.name ? ` (${r.name})` : ''}:  ${Number(r.be).toFixed(2)} eV`
  const chosen = () => rows.filter((r) => picked.has(String(r.sample))).map((r) => Number(r.sample))
  const done = (a: Answer) => {
    if (!a.ok) return setProgress(a.error ?? 'Failed.')
    const miss = (a.missing as unknown[] | undefined) ?? []
    setProgress(miss.length ? `No "${peak}" peak in: ${miss.join(', ')}` : 'Done.')
    reload()
  }
  return (
    <FloatWin title="Binding Energy Correction" initial={{ x: 300, y: 80 }} width={330} onClose={onClose}>
      <div className="kf-becorr">
        <fieldset className="kf-box">
          <legend>Reference Peak Settings</legend>
          <div className="kf-form">
            <label>Peak Name:</label>
            <Text value={peak} onChange={setPeak} />
            <label>Reference BE (eV):</label>
            <Text value={ref} onChange={setRef} />
          </div>
        </fieldset>
        <div className="kf-btns-row">
          <Btn label="Select All" onClick={() => setPicked(new Set(rows.map((r) => String(r.sample))))} />
          <Btn label="Unselect All" onClick={() => setPicked(new Set())} />
        </div>
        <span>Sample Rows:</span>
        <div className="kf-checklist" style={{ height: 150 }}>
          {rows.map((r) => (
            <label key={String(r.sample)}>
              <input
                type="checkbox"
                checked={picked.has(String(r.sample))}
                onChange={(e) => {
                  const n = new Set(picked)
                  if (e.target.checked) n.add(String(r.sample))
                  else n.delete(String(r.sample))
                  setPicked(n)
                }}
              />
              {label(r)}
            </label>
          ))}
        </div>
        <div className="kf-btns-row">
          <Btn label={'Correct\nCurrent Row'} onClick={() => void call('be_auto', { peak, ref: num(ref, 284.8), samples: 'current' }).then(done)} />
          <Btn label={'Correct\nSelected Rows'} disabled={!picked.size} onClick={() => void call('be_auto', { peak, ref: num(ref, 284.8), samples: chosen() }).then(done)} />
        </div>
        <Btn label="Reset Selected to 0 eV" disabled={!picked.size} onClick={() => void call('be_reset', { samples: chosen() }).then(done)} />
        <p className="kf-status-text">{progress}</p>
      </div>
    </FloatWin>
  )
}

// ----------------------------------------------------------- Sample manager

export function SampleManagerWindow({ call, view, onSelect, onClose, rename }: {
  call: Call
  view: View
  onSelect: (sheet: string) => void
  onClose: () => void
  rename: (sample: number | string, current: string) => void
}) {
  const [cols, setCols] = useState<string[]>([])
  const [rows, setRows] = useState<SampleRow[]>([])
  useEffect(() => {
    void call('samples').then((a) => {
      if (!a.ok) return
      setCols((a.columns as string[] | undefined) ?? [])
      setRows((a.rows as SampleRow[] | undefined) ?? [])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.sheets.join('|'), view.extra?.sampleName, view.extra?.beCorrection])
  return (
    <FloatWin title="Sample/Experiment Manager" initial={{ x: 140, y: 60 }} width={Math.min(980, 170 + cols.length * 95 + 160)} onClose={onClose}>
      <div className="kf-grid kf-samples">
        <table>
          <thead>
            <tr>
              <th className="kf-corner" />
              <th style={{ width: 110 }}>Experiment</th>
              {cols.map((c) => (
                <th key={c} style={{ width: 90 }}>
                  {c}
                </th>
              ))}
              <th style={{ width: 70 }}>Xshift</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.sample)}>
                <th className="kf-rowlabel">{String(r.sample)}</th>
                <td className="kf-center" onDoubleClick={() => rename(r.sample, r.name)} title="Double-click to rename">
                  {r.name}
                </td>
                {cols.map((c) => {
                  const s = r.cells?.[c]
                  return (
                    <td
                      key={c}
                      className="kf-center"
                      style={{ background: s ? (s === view.sheet ? 'yellow' : 'var(--kf-cons)') : '#fff', cursor: s ? 'pointer' : 'default' }}
                      onClick={() => s && onSelect(s)}
                    >
                      {s ?? ''}
                    </td>
                  )
                })}
                <td style={{ color: 'rgb(150,150,150)' }}>{Number(r.be ?? 0).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FloatWin>
  )
}

// --------------------------------------------------------------- NMF / PCA

function MiniPlot({ series, title, w = 300, h = 170, xs }: { series: number[][]; title: string; w?: number; h?: number; xs?: number[] }) {
  const colours = ['#0080C0', '#FF0080', '#FF8000', '#8080C0', '#FF0000', '#00A0A0', '#800000', '#008000']
  const all = series.flat().filter(Number.isFinite)
  const lo = Math.min(0, ...all)
  const hi = Math.max(...all, lo + 1e-12)
  const n = Math.max(...series.map((s) => s.length), 2)
  const xr = xs && xs.length ? [Math.max(...xs), Math.min(...xs)] : [0, n - 1]
  const X = (i: number, k: number) => {
    const v = xs && xs.length ? xs[i] : i
    return 30 + ((v - xr[0]) / (xr[1] - xr[0] || 1)) * (w - 40) + 0 * k
  }
  const Y = (v: number) => h - 20 - ((v - lo) / (hi - lo || 1)) * (h - 40)
  return (
    <svg width={w} height={h} className="kf-miniplot">
      <rect x={30} y={20} width={w - 40} height={h - 40} fill="#fff" stroke="#000" />
      <text x={w / 2} y={14} textAnchor="middle" fontSize={11}>
        {title}
      </text>
      {series.map((s, k) => (
        <path key={k} d={s.map((v, i) => `${i ? 'L' : 'M'}${X(i, k).toFixed(1)} ${Y(v).toFixed(1)}`).join('')} fill="none" stroke={colours[k % colours.length]} strokeWidth={1.3} />
      ))}
      {xs && xs.length ? (
        <>
          <text x={30} y={h - 6} fontSize={10}>{xr[0].toFixed(1)}</text>
          <text x={w - 10} y={h - 6} fontSize={10} textAnchor="end">{xr[1].toFixed(1)}</text>
        </>
      ) : null}
    </svg>
  )
}

export function PcaWindow({ call, view, onClose }: { call: Call; view: View; onClose: () => void }) {
  const [cands, setCands] = useState<string[]>(view.sheets)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [offset, setOffset] = useState<'min' | 'smart'>('min')
  const [norm, setNorm] = useState<'none' | 'area' | 'max'>('area')
  const [iters, setIters] = useState('1000')
  const [tol, setTol] = useState('0.0001')
  const [find, setFind] = useState('3')
  const [use, setUse] = useState('2')
  const [res, setRes] = useState<Answer | null>(null)
  const [status, setStatus] = useState('')
  useEffect(() => {
    void call('pca_candidates').then((a) => {
      const c = (a.candidates ?? a.sheets) as string[] | undefined
      if (a.ok && Array.isArray(c)) setCands(c)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const sheets = cands.filter((s) => picked.has(s))
  const args = () => ({ sheets, n: Math.max(1, Math.round(num(find, 3))), nUse: Math.max(1, Math.round(num(use, 2))), offset, norm, iterations: Math.round(num(iters, 1000)), tol: num(tol, 1e-4) })
  const analyse = () => {
    setStatus('Analysing…')
    void call('nmf', args()).then((a) => {
      setRes(a.ok ? a : null)
      setStatus(a.ok ? `Reconstruction error ${Number(a.error ?? 0).toPrecision(3)} (${a.n_iter ?? '?'} iterations)` : (a.error ?? 'Failed.'))
    })
  }
  const comps = (res?.components as number[][] | undefined) ?? []
  const weights = (res?.weights as number[][] | undefined) ?? []
  // weights: one row per spectrum (or per component) → one line per component across spectra
  const profile = weights.length && weights[0].length === comps.length ? comps.map((_, k) => weights.map((r) => r[k])) : weights
  return (
    <FloatWin title="NMF Analysis" initial={{ x: 80, y: 40 }} width={900} onClose={onClose}>
      <div className="kf-pca">
        <div className="kf-pca-left">
          <fieldset className="kf-box">
            <legend>Select Core Levels:</legend>
            <div className="kf-btns-row">
              <Btn label="Select All" onClick={() => setPicked(new Set(cands))} />
              <Btn label="Unselect All" onClick={() => setPicked(new Set())} />
            </div>
            <CheckList items={cands} picked={picked} onChange={setPicked} height={150} />
            <span className="kf-note">{picked.size} core levels selected</span>
          </fieldset>
          <fieldset className="kf-box">
            <legend>Offset</legend>
            <label><input type="radio" checked={offset === 'min'} onChange={() => setOffset('min')} /> Minimum Value</label>
            <label><input type="radio" checked={offset === 'smart'} onChange={() => setOffset('smart')} /> Smart Background</label>
          </fieldset>
          <fieldset className="kf-box">
            <legend>Normalization</legend>
            <label><input type="radio" checked={norm === 'none'} onChange={() => setNorm('none')} /> None</label>
            <label><input type="radio" checked={norm === 'area'} onChange={() => setNorm('area')} /> Area</label>
            <label><input type="radio" checked={norm === 'max'} onChange={() => setNorm('max')} /> Max Height</label>
          </fieldset>
          <fieldset className="kf-box">
            <legend>Non-Negativity Fitting</legend>
            <div className="kf-form">
              <label>Iterations</label>
              <Text value={iters} onChange={setIters} />
              <label>Convergence</label>
              <Text value={tol} onChange={setTol} />
            </div>
          </fieldset>
          <fieldset className="kf-box">
            <legend>Components</legend>
            <div className="kf-form">
              <label>Find</label>
              <span className="kf-row">
                <Text value={find} onChange={setFind} />
                <Btn label="Analyse" disabled={sheets.length < 2} onClick={analyse} />
              </span>
              <label>Use</label>
              <span className="kf-row">
                <Text value={use} onChange={setUse} />
                <Btn label="Re-Display" disabled={!res} onClick={analyse} />
              </span>
            </div>
          </fieldset>
          <div className="kf-btns-row">
            <Btn label={'Create NMF\nas Core Levels'} disabled={!res} onClick={() => void call('nmf_create', { ...args(), kind: 'nmf' }).then((a) => setStatus(a.ok ? 'NMF components created as core levels.' : (a.error ?? '')))} />
            <Btn label={'Add NMFs to\nCore Levels'} disabled={!res} onClick={() => void call('nmf_create', { ...args(), kind: 'fitted' }).then((a) => setStatus(a.ok ? 'NMF components added to the core levels.' : (a.error ?? '')))} />
          </div>
          <p className="kf-status-text">{status}</p>
        </div>
        <div className="kf-pca-right">
          <MiniPlot series={comps} xs={(res?.x as number[] | undefined) ?? undefined} title="NMF components" w={560} h={260} />
          <MiniPlot series={profile} title="Component weights (profile)" w={560} h={220} />
        </div>
      </div>
    </FloatWin>
  )
}

// ------------------------------------------------------------- Crop / Join

export function CropWindow({ call, view, vlines, onVlines, onClose }: { call: Call; view: View; vlines: [number, number] | null; onVlines: (lo: number, hi: number) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [related, setRelated] = useState<string[]>([])
  const [also, setAlso] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState('')
  useEffect(() => {
    void call('sheet_crop_info', { sheet: view.sheet }).then((a) => {
      if (!a.ok) return
      setName(String(a.name ?? ''))
      setRelated(((a.related as string[] | undefined) ?? []).filter((s) => s !== view.sheet))
      if (typeof a.low === 'number' && typeof a.high === 'number') onVlines(a.low, a.high)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.sheet])
  return (
    <FloatWin title="Crop Window" initial={{ x: 380, y: 90 }} width={300} onClose={onClose}>
      <div className="kf-form" style={{ padding: 4 }}>
        <label>Min BE:</label>
        <Text value={vlines ? vlines[0].toFixed(2) : ''} onChange={(v) => vlines && onVlines(Math.min(num(v), vlines[1]), Math.max(num(v), vlines[1]))} />
        <label>Max BE:</label>
        <Text value={vlines ? vlines[1].toFixed(2) : ''} onChange={(v) => vlines && onVlines(Math.min(num(v), vlines[0]), Math.max(num(v), vlines[0]))} />
        <label>New Sheet Name:</label>
        <Text value={name} onChange={setName} />
        <span className="kf-note">Same core level in other samples:</span>
        <CheckList items={related} picked={also} onChange={setAlso} height={100} />
        <div className="kf-btns kf-btns-1">
          <Btn
            label="Crop"
            disabled={!vlines}
            onClick={() =>
              vlines &&
              void call('sheet_crop', { sheet: view.sheet, low: vlines[0], high: vlines[1], name, also: [...also] }).then((a) => {
                setMsg(a.ok ? `Created: ${((a.created as string[] | undefined) ?? []).join(', ')}` : (a.error ?? ''))
              })
            }
          />
        </div>
        <span className="kf-status-text">{msg}</span>
      </div>
    </FloatWin>
  )
}

export function JoinWindow({ call, view, onClose }: { call: Call; view: View; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [name, setName] = useState('Joined_Scan')
  const [msg, setMsg] = useState('')
  return (
    <FloatWin title="Join Core Levels" initial={{ x: 380, y: 90 }} width={280} onClose={onClose}>
      <div className="kf-form" style={{ padding: 4 }}>
        <CheckList items={view.sheets} picked={picked} onChange={setPicked} height={200} />
        <label>New Sheet Name:</label>
        <Text value={name} onChange={setName} />
        <div className="kf-btns kf-btns-1">
          <Btn
            label="Join"
            disabled={picked.size < 2}
            onClick={() => void call('sheet_join', { sheets: view.sheets.filter((s) => picked.has(s)), name }).then((a) => setMsg(a.ok ? 'Joined.' : (a.error ?? '')))}
          />
        </div>
        <span className="kf-status-text">{msg}</span>
      </div>
    </FloatWin>
  )
}

// ------------------------------------------------- Open Examples — Periodic Table

export function ExamplesWindow({ files, onOpen, onRefresh, onClose }: { files: string[]; onOpen: (file: string, name: string) => void; onRefresh: () => void; onClose: () => void }) {
  const { byElement, byCategory } = useMemo(() => indexExamples(files), [files])
  const pos = useMemo(examplePositions, [])
  const [sym, setSym] = useState<string | null>(null)
  const [cat, setCat] = useState<string | null>(null)
  const [pick, setPick] = useState(-1)
  const list = cat ? (byCategory[cat] ?? []) : sym ? (byElement[sym] ?? []) : []
  const label = cat
    ? `${cat}  (${list.length} file${list.length !== 1 ? 's' : ''})`
    : sym
      ? `${SYMBOLS.indexOf(sym) + 1} — ${sym}  (${list.length} file${list.length !== 1 ? 's' : ''})`
      : 'Select an element'
  const STEP = 21
  return (
    <FloatWin title="Open Examples — Periodic Table" initial={{ x: 160, y: 80 }} width={18 * STEP + 12 + 150} onClose={onClose} className="kf-exwin">
      <div className="kf-ex">
        <div className="kf-ex-top">
          <button type="button" className="kf-wxbtn kf-small" onClick={onRefresh}>
            ⟳ Refresh
          </button>
        </div>
        <div className="kf-ex-content">
          <div>
            <div className="kf-ex-pt" style={{ width: 18 * STEP, height: 11 * STEP }}>
              {Object.entries(pos).map(([s, [row, col]]) => {
                const available = !!byElement[s]?.length
                const r = row < 8 ? row : row + 1
                return (
                  <div
                    key={`${s}${row}`}
                    className={`kf-ex-tile${available ? ' kf-ex-on' : ''}${sym === s && !cat ? ' kf-ex-sel' : ''}`}
                    style={{ left: col * STEP, top: r * STEP }}
                    onClick={() => {
                      if (!available) return
                      setSym(s)
                      setCat(null)
                      setPick(-1)
                    }}
                  >
                    {s}
                  </div>
                )
              })}
            </div>
            <div className="kf-ex-cats">
              {['Metals', 'Other Techniques', 'Mixed Materials', 'Raw Data'].map((c) => (
                <button
                  key={c}
                  type="button"
                  className="kf-wxbtn kf-small"
                  disabled={!byCategory[c]?.length}
                  onClick={() => {
                    setCat(c)
                    setSym(null)
                    setPick(-1)
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="kf-ex-right">
            <span>{label}</span>
            <div className="kf-ex-list" style={{ height: 11 * STEP }}>
              {list.map((f, i) => (
                <div key={f.file} className={i === pick ? 'kf-ex-pick' : ''} title={f.file} onClick={() => setPick(i)} onDoubleClick={() => onOpen(f.file, f.name)}>
                  {f.name}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </FloatWin>
  )
}
