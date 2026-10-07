// The side panel: the core levels of the workbook and the two tabs of the
// desktop's fitting window — Background (method, limits, offsets, Tougaard
// cross-section) and Peak Fitting (peak model, optimiser, Fit / Fit ×N).

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { BACKGROUND_METHODS, MODEL_GROUPS, OPTIMIZATION_METHODS, WEIGHT_METHODS, type View } from './model'

export interface ControlActions {
  selectSheet: (name: string) => void
  setLimits: (low: number, high: number) => void
  background: (opts: { method: string; offsetLow: number; offsetHigh: number; record: 'replace' | 'append' }) => void
  clearBackground: (only: boolean) => void
  settings: (patch: Record<string, unknown>) => void
  addPeak: () => void
  removePeak: () => void
  fit: (iterations: number) => void
  report: () => void
  exportResults: () => void
}

export interface ControlsProps {
  view: View
  limits: [number, number] | null
  selected: number | null
  busy: boolean
  actions: ControlActions
}

const TOUGAARD = new Set(['U4-Tougaard', 'U2-Tougaard', 'Active Tougaard'])

/** A number box that only reports a value when Enter is pressed or it loses focus. */
function NumberBox({ value, onCommit, step, title }: { value: number | string; onCommit: (v: number) => void; step?: number; title?: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value)), [value])
  const commit = () => {
    const v = Number(text)
    if (text.trim() !== '' && Number.isFinite(v)) onCommit(v)
    else setText(String(value))
  }
  return (
    <input
      className="k-input kf-num"
      value={text}
      title={title}
      inputMode="decimal"
      step={step}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const v = (Number(text) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (step ?? 1)
          setText(String(Math.round(v * 100) / 100))
          onCommit(v)
        }
      }}
    />
  )
}

export function Controls({ view, limits, selected, busy, actions }: ControlsProps) {
  const [tab, setTab] = useState<'bkg' | 'fit'>('bkg')
  const s = view.settings
  const bg = view.background
  const [method, setMethod] = useState(s.method || 'Smart')
  const [offH, setOffH] = useState(0)
  const [offL, setOffL] = useState(0)
  const [runs, setRuns] = useState(20)
  useEffect(() => {
    setMethod(bg?.type || s.method || 'Smart')
    setOffH(Number(bg?.offsetHigh) || 0)
    setOffL(Number(bg?.offsetLow) || 0)
    // A new core level: take its stored background settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.sheet])
  const hasPeaks = view.grid.length > 0
  const idx = view.sheets.indexOf(view.sheet)

  return (
    <div className="kf-side">
      <div className="kf-section">
        <div className="kf-section-head">
          <span>Core levels</span>
          <span className="kf-grow" />
          <button className="k-icon-btn" title="Previous core level (Ctrl+[)" disabled={idx <= 0} onClick={() => actions.selectSheet(view.sheets[idx - 1])}>
            <ChevronUp size={14} />
          </button>
          <button className="k-icon-btn" title="Next core level (Ctrl+])" disabled={idx < 0 || idx >= view.sheets.length - 1} onClick={() => actions.selectSheet(view.sheets[idx + 1])}>
            <ChevronDown size={14} />
          </button>
        </div>
        <ul className="kf-sheets" role="listbox" aria-label="Core levels">
          {view.sheets.map((n) => (
            <li key={n} role="option" aria-selected={n === view.sheet} className={n === view.sheet ? 'kf-on' : ''} onClick={() => n !== view.sheet && actions.selectSheet(n)}>
              {n}
            </li>
          ))}
        </ul>
      </div>

      <div className="kf-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'bkg'} className={tab === 'bkg' ? 'kf-on' : ''} onClick={() => setTab('bkg')}>
          Background
        </button>
        <button role="tab" aria-selected={tab === 'fit'} className={tab === 'fit' ? 'kf-on' : ''} onClick={() => setTab('fit')}>
          Peak Fitting
        </button>
      </div>

      {tab === 'bkg' ? (
        <div className="kf-form">
          <label>Method</label>
          <select className="k-input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {BACKGROUND_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <label title="The dashed lines on the plot: drag them, or type here">High BE</label>
          <NumberBox value={limits ? limits[1] : ''} step={0.1} onCommit={(v) => limits && actions.setLimits(Math.min(v, limits[0]), Math.max(v, limits[0]))} />
          <label>Low BE</label>
          <NumberBox value={limits ? limits[0] : ''} step={0.1} onCommit={(v) => limits && actions.setLimits(Math.min(v, limits[1]), Math.max(v, limits[1]))} />
          <label title="Offset added at the high binding energy end (CPS)">Offset (left)</label>
          <NumberBox value={offH} step={10} onCommit={setOffH} />
          <label title="Offset added at the low binding energy end (CPS)">Offset (right)</label>
          <NumberBox value={offL} step={10} onCommit={setOffL} />
          <label title="Points averaged at each end of the background">Averaging</label>
          <NumberBox value={s.averagingPoints} step={1} onCommit={(v) => actions.settings({ averagingPoints: Math.max(1, Math.round(v)) })} />
          {TOUGAARD.has(method) && bg && (
            <>
              <label title="Tougaard cross-section B, C, D, T0 (U4); U2 fits B">Tougaard</label>
              <div className="kf-row4">
                {bg.tougaard.map((v, i) => (
                  <NumberBox key={i} value={v} title={['B', 'C', 'D', 'T0'][i]} onCommit={(nv) => actions.settings({ tougaard: bg.tougaard.map((o, j) => (j === i ? nv : o)) })} />
                ))}
              </div>
            </>
          )}
          <div className="kf-buttons">
            <button className="k-btn primary" disabled={busy || !limits} onClick={() => actions.background({ method, offsetLow: offL, offsetHigh: offH, record: 'replace' })}>
              Background
            </button>
            <button
              className="k-btn"
              disabled={busy || !limits}
              title="Add this region to the background (the desktop's multi-region backgrounds)"
              onClick={() => actions.background({ method, offsetLow: offL, offsetHigh: offH, record: 'append' })}
            >
              Add Region
            </button>
            <button className="k-btn" disabled={busy} title="Background back to the data, peaks removed" onClick={() => actions.clearBackground(false)}>
              Clear All
            </button>
            <button className="k-btn" disabled={busy} title="Remove the background, keep the peaks" onClick={() => actions.clearBackground(true)}>
              Clear Bkg
            </button>
          </div>
          {bg?.type ? (
            <p className="kf-note">
              {bg.type} from {Number(bg.low).toFixed(2)} to {Number(bg.high).toFixed(2)} eV
              {bg.ranges.length > 1 ? ` (${bg.ranges.length} regions)` : ''}
            </p>
          ) : (
            <p className="kf-note">Drag the dashed lines around the peaks, then press Background.</p>
          )}
        </div>
      ) : (
        <div className="kf-form">
          <label>Peak model</label>
          <select className="k-input" value={s.model} onChange={(e) => actions.settings({ model: e.target.value })} title="The shape of the next peak added">
            {MODEL_GROUPS.map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.models.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="kf-buttons">
            <button className="k-btn primary" disabled={busy || !bg?.type} title={bg?.type ? 'Add a peak where the data is highest above the fit' : 'Make a background first'} onClick={actions.addPeak}>
              Add Peak
            </button>
            <button className="k-btn" disabled={busy || !hasPeaks} onClick={actions.removePeak}>
              {selected !== null ? `Remove ${String.fromCharCode(65 + selected)}` : 'Remove Last'}
            </button>
          </div>
          <label>Optimiser</label>
          <select className="k-input" value={s.optimization} onChange={(e) => actions.settings({ optimization: e.target.value })}>
            {OPTIMIZATION_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <label title="Largest number of function evaluations of one fit">Max. iterations</label>
          <NumberBox value={s.maxIterations} step={10} onCommit={(v) => actions.settings({ maxIterations: Math.max(20, Math.min(500, Math.round(v))) })} />
          <label>Weights</label>
          <select className="k-input" value={s.weights} onChange={(e) => actions.settings({ weights: e.target.value })}>
            {WEIGHT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <div className="kf-buttons">
            <button className="k-btn primary" disabled={busy || !hasPeaks} onClick={() => actions.fit(1)}>
              Fit
            </button>
            <button className="k-btn" disabled={busy || !hasPeaks} title="Fit again and again from each result" onClick={() => actions.fit(runs)}>
              Fit ×{runs}
            </button>
            <NumberBox value={runs} step={1} title="Number of successive fits" onCommit={(v) => setRuns(Math.max(2, Math.min(100, Math.round(v))))} />
          </div>
          {view.fit && (
            <div className="kf-stats">
              <span>R²</span>
              <b>{view.fit.r2 !== null ? view.fit.r2.toFixed(5) : '—'}</b>
              <span>Red. χ²</span>
              <b>{view.fit.redChi2.toFixed(2)}</b>
              <span>χ²</span>
              <b>{view.fit.chi2.toFixed(2)}</b>
              <span>Evaluations</span>
              <b>{view.fit.nfev}</b>
            </div>
          )}
          <div className="kf-buttons">
            <button className="k-btn" disabled={!view.fit} onClick={actions.report}>
              Report
            </button>
            <button className="k-btn" disabled={busy || !hasPeaks} onClick={actions.exportResults} title="Add the peaks to the results table">
              Export Results
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
