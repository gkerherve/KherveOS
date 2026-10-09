// The side panels of the circuit tab: properties of the selection, simulation settings with the stimulus, and
// the list of problems.

import { AlertTriangle, CheckCircle2, FlipHorizontal2, Info, Play, RotateCw, Trash2, XCircle } from 'lucide-react'
import { defOf, shapeOf, type Doc, type Part, type PropDef } from './model'
import { gateCount } from './bom'
import type { Problem } from './netlist'
import type { SimSettings, Simulator } from './sim'

// ------------------------------------------------------------------------------ properties

interface InspectorProps {
  doc: Doc
  selection: ReadonlySet<string>
  sim: Simulator | null
  nameRef?: React.Ref<HTMLInputElement>
  onPart(id: string, patch: { props?: Record<string, string> }): void
  onLabel(id: string, name: string): void
  onNote(id: string, text: string): void
  onRotate(): void
  onMirror(): void
  onDelete(): void
}

export function Inspector({ doc, selection, sim, nameRef, onPart, onLabel, onNote, onRotate, onMirror, onDelete }: InspectorProps) {
  const parts = doc.parts.filter((p) => selection.has(p.id))
  const labels = doc.labels.filter((l) => selection.has(l.id))
  const notes = doc.notes.filter((n) => selection.has(n.id))
  const wires = doc.wires.filter((w) => selection.has(w.id))
  const total = parts.length + labels.length + notes.length + wires.length

  if (total === 0) return <Overview doc={doc} />
  if (total > 1) {
    return (
      <div className="dg-panel-body">
        <h3>{total} items selected</h3>
        <p className="k-muted">{[parts.length && `${parts.length} part${parts.length > 1 ? 's' : ''}`, wires.length && `${wires.length} wire${wires.length > 1 ? 's' : ''}`, labels.length && `${labels.length} label${labels.length > 1 ? 's' : ''}`, notes.length && `${notes.length} note${notes.length > 1 ? 's' : ''}`].filter(Boolean).join(', ')}.</p>
        <div className="dg-actions">
          <button className="k-btn" onClick={onRotate}><RotateCw size={13} /> Rotate</button>
          <button className="k-btn" onClick={onMirror}><FlipHorizontal2 size={13} /> Mirror</button>
          <button className="k-btn danger" onClick={onDelete}><Trash2 size={13} /> Delete</button>
        </div>
        <p className="k-muted dg-small">Drag to move them together. ⌘C and ⌘V copy and paste, ⌘D duplicates.</p>
      </div>
    )
  }
  if (labels[0]) {
    const l = labels[0]
    return (
      <div className="dg-panel-body">
        <h3>Net label</h3>
        <Field label="Name"><input className="k-input" value={l.name} onChange={(e) => onLabel(l.id, e.target.value)} /></Field>
        <p className="k-muted dg-small">Labels with the same name are connected, even without a wire.</p>
        <div className="dg-actions"><button className="k-btn danger" onClick={onDelete}><Trash2 size={13} /> Delete</button></div>
      </div>
    )
  }
  if (notes[0]) {
    const n = notes[0]
    return (
      <div className="dg-panel-body">
        <h3>Note</h3>
        <Field label="Text"><textarea className="k-input dg-textarea" rows={4} value={n.text} onChange={(e) => onNote(n.id, e.target.value)} /></Field>
        <div className="dg-actions"><button className="k-btn danger" onClick={onDelete}><Trash2 size={13} /> Delete</button></div>
      </div>
    )
  }
  if (wires[0]) {
    return (
      <div className="dg-panel-body">
        <h3>Wire</h3>
        <p className="k-muted">Wires are joined at pin dots and at junction dots. Press Delete to remove it.</p>
        <div className="dg-actions"><button className="k-btn danger" onClick={onDelete}><Trash2 size={13} /> Delete</button></div>
      </div>
    )
  }
  const part = parts[0]
  return <PartProps part={part} sim={sim} nameRef={nameRef} onChange={(props) => onPart(part.id, { props })} onRotate={onRotate} onMirror={onMirror} onDelete={onDelete} />
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="dg-field">
      <span>{label}</span>
      {children}
      {hint && <small className="k-muted">{hint}</small>}
    </label>
  )
}

function PartProps({ part, sim, nameRef, onChange, onRotate, onMirror, onDelete }: { part: Part; sim: Simulator | null; nameRef?: React.Ref<HTMLInputElement>; onChange(props: Record<string, string>): void; onRotate(): void; onMirror(): void; onDelete(): void }) {
  const def = defOf(part)
  const set = (key: string, value: string) => onChange({ ...part.props, [key]: value })
  const field = (d: PropDef) => {
    const v = part.props[d.key] ?? d.default
    if (d.options) {
      return (
        <Field key={d.key} label={d.label} hint={d.hint}>
          <select className="k-input" value={v} onChange={(e) => set(d.key, e.target.value)}>{d.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        </Field>
      )
    }
    if (d.multiline) return <Field key={d.key} label={d.label} hint={d.hint}><textarea className="k-input dg-textarea dg-mono" rows={4} value={v} spellCheck={false} onChange={(e) => set(d.key, e.target.value)} /></Field>
    const isName = d.key === 'name'
    return <Field key={d.key} label={d.label} hint={d.hint}><input ref={isName ? nameRef : undefined} className="k-input" value={v} placeholder={d.default} onChange={(e) => set(d.key, e.target.value)} /></Field>
  }
  const pins = shapeOf(part).pins
  const stored = sim ? sim.stored(part.ref) : undefined
  const memory = sim && (part.kind === 'ram' || part.kind === 'rom') ? sim.memory(part.ref) : undefined
  return (
    <div className="dg-panel-body">
      <div className="dg-prop-head">
        <h3>{def.name}</h3>
        <span className="k-muted">{part.ref}</span>
      </div>
      <div className="dg-actions">
        <button className="k-btn" onClick={onRotate}><RotateCw size={13} /> Rotate</button>
        <button className="k-btn" onClick={onMirror}><FlipHorizontal2 size={13} /> Mirror</button>
        <button className="k-btn danger" onClick={onDelete}><Trash2 size={13} /> Delete</button>
      </div>
      {def.props.map(field)}
      {stored !== undefined && <p className="dg-live">Stored value now: <b>{stored === null ? 'unknown (X)' : stored}</b></p>}
      {memory && (
        <details className="dg-mem">
          <summary>Contents now ({memory.length} words)</summary>
          <p className="dg-mono dg-small">{memory.map((w, i) => `${i.toString(16)}: ${w === null ? 'X' : w.toString(16).toUpperCase()}`).join('   ')}</p>
        </details>
      )}
      <h4>Pins</h4>
      <div className="dg-pins-table">
        <table>
          <tbody>
            {pins.map((p) => (
              <tr key={p.name}>
                <th>{p.name}</th>
                <td>{p.dir === 'out' ? 'output' : p.dir === 'pull' ? 'pull' : 'input'}{p.def !== undefined ? ` (${p.def} if open)` : ''}</td>
                <td className="dg-mono">{sim ? ['0', '1', 'X', 'Z'][sim.pinValue(part.ref, p.name)] : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Overview({ doc }: { doc: Doc }) {
  const c = gateCount(doc)
  return (
    <div className="dg-panel-body">
      <h3>Circuit</h3>
      {doc.parts.length === 0 ? <p className="k-muted">Nothing here yet. Place parts from the palette; select one to edit its properties.</p> : (
        <>
          <p>{c.total} part{c.total === 1 ? '' : 's'}: {c.gates} gate{c.gates === 1 ? '' : 's'}, {c.sequential} memory element{c.sequential === 1 ? '' : 's'}, {c.inputs} input{c.inputs === 1 ? '' : 's'}, {c.outputs} output{c.outputs === 1 ? '' : 's'}.</p>
          <h4>Bill of parts</h4>
          <div className="dg-pins-table">
            <table>
              <tbody>
                {c.rows.map((r) => <tr key={r.name}><th>{r.name}</th><td className="dg-mono">{r.count}</td></tr>)}
              </tbody>
            </table>
          </div>
          {c.gateInputs > 0 && <p className="k-muted dg-small">{c.gateInputs} gate inputs in total — a common measure of the cost of a two-level circuit.</p>}
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------ simulation settings

interface SimPanelProps {
  settings: SimSettings
  stimulus: string
  stimulusErrors: string[]
  until: number
  running: boolean
  onSettings(patch: Partial<SimSettings>): void
  onStimulus(text: string): void
  onUntil(n: number): void
  onRunStimulus(): void
}

export function SimPanel({ settings, stimulus, stimulusErrors, until, running, onSettings, onStimulus, onUntil, onRunStimulus }: SimPanelProps) {
  return (
    <div className="dg-panel-body">
      <h3>Simulation</h3>
      <Field label="Delays" hint={settings.delayMode === 'unit' ? 'Every gate takes the same time: glitches and hazards show.' : settings.delayMode === 'gate' ? 'Each part uses its own “Delay” property.' : 'Nothing takes time: results appear in the same instant (in delta cycles).'}>
        <select className="k-input" value={settings.delayMode} onChange={(e) => onSettings({ delayMode: e.target.value as SimSettings['delayMode'] })}>
          <option value="unit">Unit delay (1 for every gate)</option>
          <option value="gate">Per-gate delays</option>
          <option value="zero">Zero delay</option>
        </select>
      </Field>
      {settings.delayMode === 'unit' && <Field label="Unit delay"><input className="k-input" type="number" min={1} max={1000} value={settings.unitDelay} onChange={(e) => onSettings({ unitDelay: Math.max(1, Math.min(1000, Math.round(Number(e.target.value) || 1))) })} /></Field>}
      <label className="dg-check"><input type="checkbox" checked={settings.inertial} onChange={(e) => onSettings({ inertial: e.target.checked })} /> Inertial delay: pulses shorter than a gate's delay are swallowed (off: they pass, like a transport delay)</label>
      <Field label="Time unit">
        <select className="k-input" value={settings.unit} onChange={(e) => onSettings({ unit: e.target.value })}>{['ps', 'ns', 'µs', 'ms', 's'].map((u) => <option key={u}>{u}</option>)}</select>
      </Field>
      <h4>Stimulus</h4>
      <p className="k-muted dg-small">Timed input changes, one line each: time, then NAME=value. Clocks run by themselves.</p>
      <textarea className="k-input dg-textarea dg-mono" rows={7} value={stimulus} spellCheck={false} placeholder={'0 A=0 B=0\n20 A=1\n40 B=1'} aria-label="Stimulus" onChange={(e) => onStimulus(e.target.value)} />
      {stimulusErrors.map((e, i) => <div key={i} className="dg-error dg-small">{e}</div>)}
      <Field label="Run until"><input className="k-input" type="number" min={1} max={100000} value={until} onChange={(e) => onUntil(Math.max(1, Math.min(100000, Math.round(Number(e.target.value) || 1))))} /></Field>
      <div className="dg-actions"><button className="k-btn primary" disabled={running} onClick={onRunStimulus}><Play size={13} /> Run the stimulus</button></div>
    </div>
  )
}

// ------------------------------------------------------------------------------ problems

export function ProblemsPanel({ problems, onPick }: { problems: Problem[]; onPick(refs: string[]): void }) {
  const real = problems.filter((p) => p.level !== 'info')
  return (
    <div className="dg-panel-body">
      <h3>Problems</h3>
      {real.length === 0 ? (
        <div className="dg-ok"><CheckCircle2 size={14} /> No problems found.</div>
      ) : (
        <ul className="dg-problems">
          {real.map((p, i) => (
            <li key={i} className={p.level}>
              <button disabled={p.refs.length === 0} onClick={() => onPick(p.refs)}>
                {p.level === 'error' ? <XCircle size={14} /> : p.level === 'warn' ? <AlertTriangle size={14} /> : <Info size={14} />}
                <span>{p.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {problems.filter((p) => p.level === 'info').map((p, i) => <p key={i} className="k-muted dg-small">{p.message}</p>)}
    </div>
  )
}
