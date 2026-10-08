// The right-hand panels: Properties (the selected part), Simulate (analysis settings) and Results
// (node voltages, currents, power table and warnings).

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Info, Play, Square, Trash2, FlipHorizontal2, RotateCw, XCircle } from 'lucide-react'
import { PartIcon } from './Glyph'
import { defOf, type Doc, type Part } from './model'
import type { BuildResult } from './netlist'
import type { AnalysisKind, SimSettings } from './settings'
import type { Problem } from './sim/diagnose'
import type { OpResult, SimResult } from './sim/engine'
import { cornerFrequency, resonance, stats } from './sim/measure'
import { formatValue } from './sim/units'
import { acTrace, defaultTraces, powerTable, seriesOf, traceData } from './session'

// ------------------------------------------------------------------------------ small inputs

/** A text input that commits on Enter or blur (so one edit is one undo step). */
export function Draft({ value, onCommit, label, className, placeholder, inputRef, list }: {
  value: string
  onCommit(v: string): void
  label: string
  className?: string
  placeholder?: string
  inputRef?: React.Ref<HTMLInputElement>
  list?: string
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => { if (text !== value) onCommit(text) }
  return (
    <input
      ref={inputRef} className={`k-input ${className ?? ''}`} value={text} aria-label={label} placeholder={placeholder} list={list} spellCheck={false}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() } if (e.key === 'Escape') { setText(value); (e.target as HTMLInputElement).blur() } }}
    />
  )
}

const unitOf = (x: number, u: string) => formatValue(Math.abs(x) < 1e-15 ? 0 : x, 4, u)

// ------------------------------------------------------------------------------ properties

export interface InspectorProps {
  doc: Doc
  selection: ReadonlySet<string>
  built: BuildResult
  op: OpResult | null
  valueRef: React.Ref<HTMLInputElement>
  onPart(id: string, patch: Partial<Pick<Part, 'ref' | 'value' | 'rot' | 'mirror'>> & { props?: Record<string, string> }): void
  onLabel(id: string, name: string): void
  onNote(id: string, text: string): void
  onRotate(): void
  onMirror(): void
  onDelete(): void
}

export function Inspector(p: InspectorProps) {
  const sel = [...p.selection]
  if (sel.length === 0) return <Summary doc={p.doc} built={p.built} />
  if (sel.length > 1) {
    return (
      <div className="ke-panel-body">
        <h3>{sel.length} items selected</h3>
        <p className="k-muted">Drag to move them together. R rotates, F mirrors, Delete removes, ⌘C / ⌘V copy and paste.</p>
        <Actions {...p} />
      </div>
    )
  }
  const id = sel[0]
  const part = p.doc.parts.find((x) => x.id === id)
  if (part) {
    const def = defOf(part)
    return (
      <div className="ke-panel-body">
        <div className="ke-prop-head">
          <PartIcon part={part} size={52} />
          <div><h3>{def.name}</h3><span className="k-muted">{def.category}</span></div>
        </div>
        {part.kind !== 'ground' && (
          <label className="ke-field"><span>Reference</span><Draft value={part.ref} label="Reference" onCommit={(v) => p.onPart(id, { ref: v.trim() })} /></label>
        )}
        {def.value && (
          <label className="ke-field">
            <span>{def.value.label}</span>
            <span className="ke-field-in">
              {def.value.options ? (
                <select className="k-input" value={part.value} aria-label={def.value.label} onChange={(e) => p.onPart(id, { value: e.target.value })}>
                  {def.value.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  {!def.value.options.includes(part.value) && <option value={part.value}>{part.value}</option>}
                </select>
              ) : (
                <Draft value={part.value} label={def.value.label} inputRef={p.valueRef} onCommit={(v) => p.onPart(id, { value: v.trim() })} />
              )}
              {def.value.unit && <em>{def.value.unit}</em>}
            </span>
          </label>
        )}
        {def.props.map((pr) => (
          <label key={pr.key} className="ke-field">
            <span>{pr.label}</span>
            <Draft value={part.props[pr.key] ?? pr.default} label={pr.label} placeholder={pr.hint} onCommit={(v) => p.onPart(id, { props: { ...part.props, [pr.key]: v.trim() } })} />
          </label>
        ))}
        <Actions {...p} />
        {part.kind !== 'ground' && (
          <section className="ke-pins-table">
            <h4>Pins</h4>
            <table>
              <tbody>
                {def.pins.map((d) => {
                  const net = p.built.pinNet.get(`${part.ref}.${d.name}`)
                  const v = net !== undefined && p.op ? p.op.nodes[net] : undefined
                  return <tr key={d.name}><th>{d.label ?? d.name}</th><td>{net ?? '–'}</td><td>{v === undefined ? '' : unitOf(v, 'V')}</td></tr>
                })}
              </tbody>
            </table>
          </section>
        )}
        {p.op && part.kind !== 'ground' && (() => {
          const els = p.built.elementsOf.get(part.ref) ?? []
          const rows = els.filter((e) => p.op!.currents[e] !== undefined && !e.includes('#'))
          if (!rows.length) return null
          return (
            <section className="ke-pins-table">
              <h4>Last DC run</h4>
              <table><tbody>{rows.map((e) => <tr key={e}><th>I({e})</th><td>{unitOf(p.op!.currents[e], 'A')}</td><td>{unitOf(p.op!.power[e] ?? 0, 'W')}</td></tr>)}{p.op.devices[els[0]] && <tr><th>State</th><td colSpan={2}>{p.op.devices[els[0]]}</td></tr>}</tbody></table>
            </section>
          )
        })()}
      </div>
    )
  }
  const label = p.doc.labels.find((x) => x.id === id)
  if (label) {
    return (
      <div className="ke-panel-body">
        <h3>Net label</h3>
        <p className="k-muted">Nets with the same label name are connected, wherever they are on the sheet. “0” or “GND” is ground.</p>
        <label className="ke-field"><span>Name</span><Draft value={label.name} label="Net name" onCommit={(v) => p.onLabel(id, v.trim())} /></label>
        <Actions {...p} />
      </div>
    )
  }
  const note = p.doc.notes.find((x) => x.id === id)
  if (note) {
    return (
      <div className="ke-panel-body">
        <h3>Note</h3>
        <label className="ke-field"><span>Text</span><textarea className="k-input" rows={4} value={note.text} aria-label="Note text" onChange={(e) => p.onNote(id, e.target.value)} /></label>
        <Actions {...p} />
      </div>
    )
  }
  return (
    <div className="ke-panel-body">
      <h3>Wire</h3>
      <p className="k-muted">A wire joins whatever it touches. Where three or more meet, a dot is drawn. Delete removes it; drag to move.</p>
      <Actions {...p} />
    </div>
  )
}

function Actions(p: Pick<InspectorProps, 'onRotate' | 'onMirror' | 'onDelete'>) {
  return (
    <div className="ke-actions">
      <button className="k-btn small" onClick={p.onRotate} title="Rotate (R)"><RotateCw size={12} /> Rotate</button>
      <button className="k-btn small" onClick={p.onMirror} title="Mirror (F)"><FlipHorizontal2 size={12} /> Mirror</button>
      <button className="k-btn small danger" onClick={p.onDelete} title="Delete"><Trash2 size={12} /> Delete</button>
    </div>
  )
}

function Summary({ doc, built }: { doc: Doc; built: BuildResult }) {
  const parts = doc.parts.filter((x) => x.kind !== 'ground').length
  const nets = built.nets.filter((n) => n.pins.length > 0).length
  return (
    <div className="ke-panel-body">
      <h3>Circuit</h3>
      <table className="ke-kv"><tbody>
        <tr><th>Parts</th><td>{parts}</td></tr><tr><th>Nets</th><td>{nets}</td></tr><tr><th>Wires</th><td>{doc.wires.length}</td></tr>
      </tbody></table>
      <p className="k-muted">Select a part to edit its value. Double-click a part to jump to its value, a label to rename it.</p>
      <ProblemList problems={built.problems} onPick={undefined} />
    </div>
  )
}

export function ProblemList({ problems, onPick }: { problems: Problem[]; onPick?: (refs: string[]) => void }) {
  const shown = problems.filter((p) => p.level !== 'info' || problems.length === 1)
  if (shown.length === 0) return <p className="ke-ok"><Check size={13} /> No problems found.</p>
  return (
    <ul className="ke-problems">
      {shown.map((p, i) => (
        <li key={i} className={p.level}>
          <button disabled={!onPick || p.refs.length === 0} onClick={() => onPick?.(p.refs)}>
            {p.level === 'error' ? <XCircle size={14} /> : p.level === 'warning' ? <AlertTriangle size={14} /> : <Info size={14} />}
            <span>{p.message}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// ------------------------------------------------------------------------------ simulate

const KINDS: { id: AnalysisKind; label: string; tip: string }[] = [
  { id: 'op', label: 'DC op', tip: 'DC operating point' },
  { id: 'dc', label: 'DC sweep', tip: 'Sweep a source and watch the circuit follow' },
  { id: 'ac', label: 'AC', tip: 'Frequency response (Bode plot)' },
  { id: 'tran', label: 'Transient', tip: 'Time response (scope)' },
]

export function SimPanel({ s, sources, running, message, onChange, onRun, onStop }: {
  s: SimSettings
  sources: string[]
  running: boolean
  message: string | null
  onChange(patch: Partial<SimSettings>): void
  onRun(kind: AnalysisKind): void
  onStop(): void
}) {
  const row = (label: string, key: keyof SimSettings, unit?: string, hint?: string) => (
    <label className="ke-field" key={key}>
      <span>{label}</span>
      <span className="ke-field-in"><Draft value={String(s[key])} label={label} placeholder={hint} onCommit={(v) => onChange({ [key]: v } as Partial<SimSettings>)} />{unit && <em>{unit}</em>}</span>
    </label>
  )
  return (
    <div className="ke-panel-body">
      <div className="ke-seg" role="tablist" aria-label="Analysis">
        {KINDS.map((k) => <button key={k.id} role="tab" aria-selected={s.analysis === k.id} className={s.analysis === k.id ? 'on' : ''} title={k.tip} onClick={() => onChange({ analysis: k.id })}>{k.label}</button>)}
      </div>
      {s.analysis === 'op' && <p className="k-muted">Finds the steady DC state: capacitors open, inductors shorted. Node voltages and currents appear on the schematic.</p>}
      {s.analysis === 'dc' && (
        <>
          <label className="ke-field">
            <span>Sweep source</span>
            <Draft value={s.dcSource} label="Sweep source" list="ke-dc-sources" onCommit={(v) => onChange({ dcSource: v })} />
            <datalist id="ke-dc-sources">{sources.map((x) => <option key={x} value={x} />)}</datalist>
          </label>
          {row('From', 'dcStart', 'V / A')}{row('To', 'dcStop', 'V / A')}{row('Step', 'dcStep', 'V / A')}
        </>
      )}
      {s.analysis === 'ac' && (<>{row('Start frequency', 'acStart', 'Hz')}{row('Stop frequency', 'acStop', 'Hz')}{row('Points per decade', 'acPoints')}<p className="k-muted">A source needs an AC amplitude (the sine source has 1 by default).</p></>)}
      {s.analysis === 'tran' && (
        <>
          {row('Stop time', 'tranStop', 's')}{row('Time step (optional)', 'tranStep', 's', 'auto')}{row('Max step (optional)', 'tranMax', 's', 'auto')}
          <label className="ke-check"><input type="checkbox" checked={s.uic} onChange={(e) => onChange({ uic: e.target.checked })} /> Start from initial conditions (capacitors at their IC, else 0 V)</label>
        </>
      )}
      <div className="ke-actions">
        {running ? <button className="k-btn danger" onClick={onStop}><Square size={13} /> Stop</button> : <button className="k-btn primary" onClick={() => onRun(s.analysis)}><Play size={13} /> Run {KINDS.find((k) => k.id === s.analysis)!.label}</button>}
      </div>
      {message && <p className="ke-run-msg" role="status">{message}</p>}
    </div>
  )
}

// ------------------------------------------------------------------------------ results

export function ResultsPanel({ result, built, problems, error, stale, running, onPick }: {
  result: SimResult | null
  built: BuildResult | null
  problems: Problem[]
  error: { message: string; refs: string[] } | null
  stale: boolean
  running: boolean
  onPick(refs: string[]): void
}) {
  return (
    <div className="ke-panel-body">
      {running && <p className="k-muted">Simulating…</p>}
      {error && (
        <div className="ke-run-error" role="alert">
          <XCircle size={14} /> <span>{error.message}</span>
          {error.refs.length > 0 && <button className="k-link-btn" onClick={() => onPick(error.refs)}>Show {error.refs.join(', ')}</button>}
        </div>
      )}
      {problems.length > 0 && <><h4>Checks</h4><ProblemList problems={problems} onPick={onPick} /></>}
      {!result && !error && !running && <p className="k-muted">Nothing has been simulated yet. Choose an analysis in “Simulate” and run it (⌘R).</p>}
      {result && stale && <p className="ke-stale-note">The circuit changed after this run: run it again to update.</p>}
      {result?.type === 'tran' && result.tran.notes.map((n, i) => <p key={i} className="ke-stale-note">{n}</p>)}
      {result?.type === 'op' && <OpTables op={result.op} refOf={built?.refOf} />}
      {result && result.type !== 'op' && <WaveTable result={result} />}
    </div>
  )
}

function OpTables({ op, refOf }: { op: OpResult; refOf?: Map<string, string> }) {
  const pt = powerTable(op, refOf)
  const nodes = Object.entries(op.nodes).filter(([k]) => !k.includes('#'))
  const bal = Math.abs(pt.imbalance) <= 1e-6 * Math.max(pt.supplied, pt.dissipated, 1e-12) + 1e-12
  return (
    <>
      <h4>Node voltages</h4>
      <table className="ke-kv">
        <tbody>{nodes.map(([k, v]) => <tr key={k}><th>{k}</th><td>{unitOf(v, 'V')}</td></tr>)}</tbody>
      </table>
      <h4>Currents and power</h4>
      <table className="ke-kv">
        <thead><tr><th>Part</th><td>Current</td><td>Power</td></tr></thead>
        <tbody>{pt.rows.map((r) => <tr key={r.name}><th>{r.ref}</th><td>{unitOf(r.current, 'A')}</td><td className={r.power < 0 ? 'ke-supply' : ''}>{unitOf(r.power, 'W')}</td></tr>)}</tbody>
      </table>
      <p className={bal ? 'ke-ok' : 'ke-bad'}>
        {bal ? <Check size={13} /> : <AlertTriangle size={13} />} Supplied {unitOf(pt.supplied, 'W')} · dissipated {unitOf(pt.dissipated, 'W')}
        {bal ? ' — the books balance.' : ' — the difference is not zero: the solution may be inaccurate.'}
      </p>
      {Object.keys(op.devices).length > 0 && (
        <>
          <h4>Devices</h4>
          <table className="ke-kv"><tbody>{Object.entries(op.devices).map(([k, v]) => <tr key={k}><th>{refOf?.get(k) ?? k}</th><td colSpan={2}>{v}</td></tr>)}</tbody></table>
        </>
      )}
      <p className="k-muted">{op.method === 'newton' ? `Solved in ${op.iterations} iterations.` : `Solved with ${op.method} (${op.iterations} iterations).`}</p>
    </>
  )
}

function WaveTable({ result }: { result: Exclude<SimResult, { type: 'op' }> }) {
  const names = defaultTraces(result).length ? Object.keys(result.type === 'ac' ? result.ac.mag : seriesOf(result)!.signals).filter((n) => n.startsWith('V(') && !n.includes('#')) : []
  if (result.type === 'ac') {
    return (
      <>
        <h4>Frequency response</h4>
        <table className="ke-kv">
          <thead><tr><th>Node</th><td>DC gain</td><td>−3 dB</td><td>Peak</td></tr></thead>
          <tbody>
            {names.slice(0, 14).map((n) => {
              const t = acTrace(result.ac, n)
              const r = resonance(result.ac.freq, t.mag)
              return <tr key={n}><th>{n}</th><td>{(20 * Math.log10(Math.max(t.mag[0], 1e-300))).toFixed(1)} dB</td><td>{unitOf(cornerFrequency(result.ac.freq, t.mag) ?? NaN, 'Hz')}</td><td>{unitOf(r.f0, 'Hz')}</td></tr>
            })}
          </tbody>
        </table>
      </>
    )
  }
  const s = seriesOf(result)!
  return (
    <>
      <h4>{result.type === 'tran' ? 'Waveform statistics' : 'Sweep ranges'}</h4>
      <table className="ke-kv">
        <thead><tr><th>Node</th><td>Min</td><td>Max</td><td>Final</td></tr></thead>
        <tbody>
          {names.slice(0, 14).map((n) => {
            const st = stats(s.x, traceData(result, n))
            return <tr key={n}><th>{n}</th><td>{unitOf(st.min, 'V')}</td><td>{unitOf(st.max, 'V')}</td><td>{unitOf(st.last, 'V')}</td></tr>
          })}
        </tbody>
      </table>
      <p className="k-muted">{s.x.length} points{result.type === 'tran' ? ` (${result.tran.rejected} steps retried)` : ''}.</p>
    </>
  )
}
