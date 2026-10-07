// The Peak Fitting window (dev-AI libraries/ToolsMenu/Fitting_Screen.py
// FittingWindow): a small always-on-top window with the notebook tabs BKG,
// Fitting, Adv. Fitting and Batch, laid out as the desktop's GridBagSizer
// (label | control, then pairs of two-line buttons) on its light cyan panel.

import { useEffect, useState } from 'react'
import { BACKGROUND_HELP, MODEL_HELP } from './helpText'
import { BACKGROUND_METHODS, MODEL_GROUPS, OPTIMIZATION_METHODS, WEIGHT_METHODS, type View } from './model'
import { FloatWin, Notebook } from './FloatWin'
import { ICONS } from './Toolbars'

export interface FitPass {
  i: number
  chi?: number
  r2: number
  redChi2: number
  nfev: number
}

export interface FittingActions {
  /** Create Region (record 'append') at the red lines, with these offsets. */
  createRegion: (method: string, offsetLeft: number, offsetRight: number) => void
  /** Apply new offsets / range to the active region (record 'replace'). */
  updateRegion: (index: number, method: string, offsetLeft: number, offsetRight: number) => void
  removeRegion: (index: number) => void
  clearAll: () => void
  clearRegions: () => void
  settings: (patch: Record<string, unknown>) => void
  addPeak: () => void
  addDoublet: (name?: string) => void
  removeLast: () => void
  fit: (mode: 'once' | 'stable', stable: number) => void
  report: () => void
  propagate: (kind: 'fit' | 'constraints' | 'row', sheets: string[]) => void
  fitSheets: (sheets: string[], stable: number) => void
  askName: () => Promise<string | null>
  notReady: (what: string) => void
  close: () => void
}

export interface FittingWindowProps {
  view: View
  tab: number
  onTab: (t: number) => void
  vlines: [number, number] | null
  onVlines: (lo: number, hi: number) => void
  activeRegion: number
  onActiveRegion: (i: number) => void
  busy: boolean
  log: FitPass[]
  currentFit: string
  batchProgress: string
  act: FittingActions
  mini?: boolean
}

const num = (s: string, d = 0) => (Number.isFinite(Number(s)) && s.trim() !== '' ? Number(s) : d)

function Btn({ label, onClick, disabled, title }: { label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className="kf-wxbtn" onClick={onClick} disabled={disabled} title={title}>
      {label.split('\n').map((l, i) => (
        <span key={i}>{l.trim()}</span>
      ))}
    </button>
  )
}

function Field({ value, onCommit, disabled }: { value: string; onCommit: (v: string) => void; disabled?: boolean }) {
  const [t, setT] = useState(value)
  useEffect(() => setT(value), [value])
  return (
    <input
      className="kf-wxtext"
      value={t}
      disabled={disabled}
      onChange={(e) => setT(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onCommit(t)
      }}
    />
  )
}

function Spin({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <input
      className="kf-wxtext"
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const v = Math.round(Number(e.target.value))
        if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)))
      }}
      onKeyDown={(e) => e.stopPropagation()}
    />
  )
}

/** The model combo with its green section headers (CustomComboBox). */
function ModelCombo({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <select className="kf-wxcombo" value={value} onChange={(e) => onChange(e.target.value)}>
      {MODEL_GROUPS.map((g) => (
        <optgroup key={g.name} label={`${g.name}-----------------------`}>
          {g.models.map((m) => (
            <option key={g.name + m} value={m}>
              {m}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/** The chi history of "Fit Until Stable" (the small matplotlib canvas beside Report ±). */
function ChiPlot({ log }: { log: FitPass[] }) {
  const w = 86
  const h = 35
  const v = log.map((p) => p.chi ?? p.redChi2).filter((x) => Number.isFinite(x))
  if (v.length < 2) return <svg width={w} height={h} className="kf-chiplot" />
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  const d = v.map((c, i) => `${i ? 'L' : 'M'}${(2 + (i / (v.length - 1)) * (w - 4)).toFixed(1)} ${(h - 3 - ((c - lo) / (hi - lo || 1)) * (h - 6)).toFixed(1)}`).join('')
  return (
    <svg width={w} height={h} className="kf-chiplot">
      <path d={d} fill="none" stroke="#4FBE9F" strokeWidth={1.5} />
    </svg>
  )
}

export function FittingWindow(p: FittingWindowProps) {
  const { view, act } = p
  const bg = view.background
  const regions = bg?.ranges ?? []
  const s = view.settings
  const [method, setMethod] = useState(bg?.type && bg.type !== 'None' ? bg.type : s.method || 'Smart')
  useEffect(() => {
    if (bg?.type) setMethod(bg.type)
  }, [view.sheet, bg?.type])
  const region = regions[p.activeRegion] ?? null
  // Recorded ranges are [offset high, offset low, low BE, high BE]
  const offL = region ? String(region[0] ?? 0) : String(bg?.offsetHigh ?? 0)
  const offR = region ? String(region[1] ?? 0) : String(bg?.offsetLow ?? 0)
  const [smooth, setSmooth] = useState(false)
  const [stable, setStable] = useState(6)
  const [batchStable, setBatchStable] = useState(6)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const lastFit = p.log.at(-1)
  const r2 = view.stats?.R2 ?? lastFit?.r2
  const red = view.stats?.RedChi ?? lastFit?.redChi2
  const tough = (bg?.tougaard ?? [2866, 1643, 1, 0]).join(',')
  const hasLines = !!p.vlines

  const bkgTab = (
    <div className="kf-form">
      <label>Method:</label>
      <span className="kf-row">
        <select
          className="kf-wxcombo"
          value={method}
          onChange={(e) => {
            if (e.target.value.endsWith('-')) return
            setMethod(e.target.value)
            act.settings({ method: e.target.value })
          }}
        >
          {BACKGROUND_METHODS.map((m) => (
            <option key={m} value={m} disabled={m.endsWith('-')} className={m.endsWith('-') ? 'kf-green-item' : ''}>
              {m}
            </option>
          ))}
        </select>
      </span>
      <span />
      <button type="button" className="kf-info" title={BACKGROUND_HELP[method] ?? 'No description available'}>
        ?
      </button>
      <label>Offset (Left):</label>
      <Field value={Number(offL).toFixed(2)} onCommit={(v) => (region ? act.updateRegion(p.activeRegion, method, num(v), num(offR)) : act.notReady('Create a region first'))} />
      <label>Offset (Right):</label>
      <Field value={Number(offR).toFixed(2)} onCommit={(v) => (region ? act.updateRegion(p.activeRegion, method, num(offL), num(v)) : act.notReady('Create a region first'))} />
      <label>Region (Left):</label>
      <Field value={p.vlines ? p.vlines[1].toFixed(2) : '0.00'} onCommit={(v) => p.vlines && p.onVlines(Math.min(p.vlines[0], num(v)), Math.max(p.vlines[0], num(v)))} />
      <label>Region (Right):</label>
      <Field value={p.vlines ? p.vlines[0].toFixed(2) : '0.00'} onCommit={(v) => p.vlines && p.onVlines(Math.min(p.vlines[1], num(v)), Math.max(p.vlines[1], num(v)))} />
      <label>Averaging Points:</label>
      <Field value={String(s.averagingPoints)} onCommit={(v) => act.settings({ averagingPoints: Math.max(1, Math.round(num(v, 5))) })} />
      <label>Smooth noisy data:</label>
      <span>
        <input type="checkbox" checked={smooth} title="Apply Gaussian smoothing (width=2) to data before calculating shirley background" onChange={(e) => setSmooth(e.target.checked)} />
      </span>
      <label>Tougaard1: B,C,D,T0</label>
      <Field value={tough} onCommit={(v) => {
        const parts = v.split(',').map((x) => Number(x))
        if (parts.length === 4 && parts.every(Number.isFinite)) act.settings({ tougaard: parts })
      }} />
      <label>Regions:</label>
      <span className="kf-regions">
        {regions.map((_, i) => (
          <button key={i} type="button" className={i === p.activeRegion ? 'kf-region-on' : ''} onClick={() => p.onActiveRegion(i)}>
            {i + 1}
          </button>
        ))}
      </span>
      <div className="kf-btns">
        <Btn label={'Switch Region\nTAB key'} disabled={!regions.length} onClick={() => p.onActiveRegion(regions.length ? (p.activeRegion + 1) % regions.length : -1)} />
        <Btn label={'Remove\nRegions and Peaks'} onClick={act.clearAll} />
        <Btn label={'Tougaard / Raman\n / XAS Model'} onClick={() => act.notReady('The Tougaard / Raman / XAS model fit window')} />
        <Btn label={'Remove\nAll Regions'} onClick={act.clearRegions} />
        <Btn label={'Create\nRegion'} disabled={!hasLines || p.busy} onClick={() => act.createRegion(method, num(offL), num(offR))} />
        <Btn label={'Remove\nCurrent Region'} disabled={!region} onClick={() => act.removeRegion(p.activeRegion)} />
      </div>
    </div>
  )

  const fitTab = (
    <div className="kf-form">
      <label>Fitting Model:</label>
      <ModelCombo value={s.model} onChange={(m) => act.settings({ model: m })} />
      <span />
      <button type="button" className="kf-info" title={MODEL_HELP[s.model] ?? 'No description available'}>
        ?
      </button>
      <label>Method:</label>
      <select className="kf-wxcombo" value={s.optimization} onChange={(e) => act.settings({ optimization: e.target.value })}>
        {OPTIMIZATION_METHODS.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
      <label>Convergence: </label>
      <Spin value={s.maxIterations} min={20} max={500} onChange={(v) => act.settings({ maxIterations: v })} />
      <label>Stable for:</label>
      <Spin value={stable} min={2} max={100} onChange={setStable} />
      <label>Weights:</label>
      <select className="kf-wxcombo" value={s.weights} onChange={(e) => act.settings({ weights: e.target.value })}>
        {WEIGHT_METHODS.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
      <label>R²:</label>
      <input className="kf-wxtext" readOnly value={r2 !== undefined && r2 !== null ? r2.toFixed(5) : ''} />
      <label>Red. Chi²:</label>
      <input className="kf-wxtext" readOnly value={red !== undefined && red !== null ? red.toFixed(2) : ''} />
      <label>Current Fit:</label>
      <input className="kf-wxtext" readOnly value={p.currentFit} />
      <div className="kf-btns">
        <ChiPlot log={p.log} />
        <Btn
          label="Report ±"
          disabled={!view.fit}
          onClick={act.report}
          title={'FIT REPORT ± UNCERTAINTIES\n\nEvery peak\'s Position, FWHM, Area, Height and L/G with its\nuncertainty (± 1σ) from the last fit, and notes when a value\nis linked to another peak, fixed, or stuck at a constraint limit.\n\nThe full lmfit report is underneath.'}
        />
        <Btn label={'Add 1 Peak\nSinglet'} disabled={!bg?.type || p.busy} onClick={act.addPeak} />
        <Btn label={'Add 2 Peaks\nDoublet'} disabled={!bg?.type || p.busy} onClick={() => act.addDoublet()} />
        <Btn label={'Remove\nLast Peak'} disabled={!view.grid.length || p.busy} onClick={act.removeLast} />
        <Btn
          label={'Add Doublet\nwith Name...'}
          disabled={!bg?.type || p.busy}
          onClick={() => void act.askName().then((n) => n && act.addDoublet(n))}
        />
        <Btn label={'Fit \nOne Time'} disabled={!view.grid.length || p.busy} onClick={() => act.fit('once', stable)} />
        <Btn label={'Fit Until\nStable'} disabled={!view.grid.length || p.busy} onClick={() => act.fit('stable', stable)} />
      </div>
    </div>
  )

  const advTab = (
    <div className="kf-form kf-disabled-form">
      <label>Method:</label>
      <select className="kf-wxcombo" disabled value={s.optimization}>
        <option>{s.optimization}</option>
      </select>
      <label>Weights:</label>
      <select className="kf-wxcombo" disabled value={s.weights}>
        <option>{s.weights}</option>
      </select>
      <label>Convergence:</label>
      <input className="kf-wxtext" disabled value={s.maxIterations} readOnly />
      <label>Region:</label>
      <span className="kf-regions">
        {regions.map((_, i) => (
          <button key={i} type="button" disabled>
            {i + 1}
          </button>
        ))}
      </span>
      <label>Range (eV):</label>
      <input className="kf-wxtext" disabled readOnly value={region ? `${region[2]} – ${region[3]}` : ''} />
      <label>Offset L / R:</label>
      <input className="kf-wxtext" disabled readOnly value={region ? `${region[0]} / ${region[1]}` : ''} />
      <label>Tune / Lock:</label>
      <span>
        <label><input type="checkbox" disabled /> L</label> <label><input type="checkbox" disabled /> R</label> <label><input type="checkbox" disabled /> Lock</label>
      </span>
      <label>Auto-tune:</label>
      <span>
        <label><input type="checkbox" disabled /> on</label>
      </span>
      <label>Minimise:</label>
      <select className="kf-wxcombo" disabled>
        <option>rsd + flat residuals</option>
      </select>
      <label>Max offset (%):</label>
      <input className="kf-wxtext" disabled readOnly value="10.0" />
      <label>Speed:</label>
      <input type="range" min={1} max={10} defaultValue={5} disabled />
      <div className="kf-btns kf-btns-1">
        <Btn label="Sort Regions by BE" disabled onClick={() => {}} />
        <Btn label="▶ Start Continuous Fit" disabled onClick={() => {}} />
      </div>
      <p className="kf-status-text">Stopped. (Continuous fitting is not in the web edition yet.)</p>
    </div>
  )

  const sheets = view.sheets
  const batchTab = (
    <div className="kf-form">
      <label>Stable for:</label>
      <Spin value={batchStable} min={2} max={100} onChange={setBatchStable} />
      <label>Progress:</label>
      <input className="kf-wxtext" readOnly value={p.batchProgress} />
      <div className="kf-btns">
        <Btn label="Select All" onClick={() => setPicked(new Set(sheets))} />
        <Btn label="Unselect All" onClick={() => setPicked(new Set())} />
      </div>
      <div className="kf-checklist">
        {sheets.map((n) => (
          <label key={n}>
            <input
              type="checkbox"
              checked={picked.has(n)}
              onChange={(e) => {
                const next = new Set(picked)
                if (e.target.checked) next.add(n)
                else next.delete(n)
                setPicked(next)
              }}
            />
            {n}
          </label>
        ))}
      </div>
      <div className="kf-btns">
        <Btn label={'Propagate/Prop. Fit\nto Column'} disabled={p.busy} onClick={() => act.propagate('fit', [...picked])} />
        <Btn label={'Prop. Constraints\nto Column'} disabled={p.busy} onClick={() => act.propagate('constraints', [...picked])} />
        <Btn label={'Prop. Row to\nSelected Core Levels'} disabled={p.busy || !picked.size} onClick={() => act.propagate('row', [...picked])} />
        <Btn label={'Fit Selected\nCore Levels'} disabled={p.busy || !picked.size} onClick={() => act.fitSheets(sheets.filter((n) => picked.has(n)), batchStable)} />
      </div>
    </div>
  )

  const tabs = p.mini ? ['BKG', 'Fitting'] : ['BKG', 'Fitting', 'Adv. Fitting', 'Batch']
  const pages = [bkgTab, fitTab, advTab, batchTab]
  return (
    <FloatWin title={p.mini ? 'Mini Peak Fitting' : 'Peak Fitting'} icon={`${ICONS}Icon.png`} initial={{ x: 380, y: 60 }} width={276} onClose={act.close} className="kf-fitwin">
      <Notebook tabs={tabs} active={Math.min(p.tab, tabs.length - 1)} onChange={p.onTab}>
        {pages[Math.min(p.tab, tabs.length - 1)]}
      </Notebook>
      <div className="kf-help-row">
        <button type="button" className="kf-info" title="User Guide for the tab in front" onClick={() => act.notReady('The User Guide')}>
          ?
        </button>
      </div>
    </FloatWin>
  )
}
