// The state-machine designer: a diagram (add and drag states, curved transition arrows with condition / output
// labels), Moore and Mealy, the state table, state assignment (binary / Gray / one-hot), next-state and output
// equations, simulation of an input sequence with the state trace and a timing diagram, warnings, a sequence-detector
// generator and the D-flip-flop implementation drawn into the circuit editor.

import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleDot, CircuitBoard, MousePointer2, Plus, Spline, Trash2, Wand2 } from 'lucide-react'
import { os } from '@/os'
import {
  analyseFsm, assignStates, checkCondition, deriveEquations, fsmBounds, fsmId, fsmToCircuit, fsmWave, initialState, MAX_FSM_INPUTS, MAX_STATES, sequenceDetector, simulateFsm, STATE_R,
  transitionGeometry, transitionLabel, type Encoding, type Fsm, type FsmState, type FsmTransition,
} from './fsm'
import { renderWave } from './waveDom'
import { snap, type Doc } from './model'
import type { Probe } from './wave'

interface Props {
  fsm: Fsm
  sequence: string
  onChange(f: Fsm, what: string): void
  onSequence(s: string): void
  onImplement(doc: Doc, probes: Probe[], name: string, fsm: Fsm): void
  canUndo: boolean
  canRedo: boolean
  onUndo(): void
  onRedo(): void
}

type Tool = 'select' | 'state' | 'trans'
type Sel = { kind: 'state' | 'trans'; id: string } | null
type Sub = 'table' | 'equations' | 'simulate'

const splitList = (text: string): string[] => text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)

export function FsmTab({ fsm, sequence, onChange, onSequence, onImplement, canUndo, canRedo, onUndo, onRedo }: Props) {
  const [tool, setTool] = useState<Tool>('select')
  const [sel, setSel] = useState<Sel>(null)
  const [from, setFrom] = useState<string | null>(null)
  const [sub, setSub] = useState<Sub>('table')
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; moved: boolean; ox: number; oy: number } | null>(null)
  const svg = useRef<SVGSVGElement>(null)

  const analysis = useMemo(() => analyseFsm(fsm), [fsm])
  const shown: Fsm = drag?.moved ? { ...fsm, states: fsm.states.map((s) => (s.id === drag.id ? { ...s, x: drag.x, y: drag.y } : s)) } : fsm
  const b = fsmBounds(shown)
  const vb = { x: Math.min(b.x1, 0), y: Math.min(b.y1, 0), w: Math.max(b.x2, 640) - Math.min(b.x1, 0), h: Math.max(b.y2, 420) - Math.min(b.y1, 0) }
  const init = initialState(fsm)

  const point = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const el = svg.current!
    const ctm = el.getScreenCTM()
    if (!ctm) return [0, 0]
    const p = el.createSVGPoint()
    p.x = e.clientX; p.y = e.clientY
    const q = p.matrixTransform(ctm.inverse())
    return [q.x, q.y]
  }

  const nextName = (): string => {
    const used = new Set(fsm.states.map((s) => s.name))
    for (let i = 0; i < 100; i++) if (!used.has(`S${i}`)) return `S${i}`
    return 'S'
  }

  const addState = (x: number, y: number) => {
    if (fsm.states.length >= MAX_STATES) { void os.dialog.alert(`At most ${MAX_STATES} states are supported.`, { title: 'State machine' }); return }
    const s: FsmState = { id: fsmId('s'), name: nextName(), x: snap(x, 10), y: snap(y, 10), out: '0'.repeat(fsm.outputs.length), ...(fsm.states.length === 0 ? { initial: true } : {}) }
    onChange({ ...fsm, states: [...fsm.states, s] }, 'Add state')
    setSel({ kind: 'state', id: s.id })
  }

  const addTransition = (a: string, c: string) => {
    const same = fsm.transitions.filter((t) => t.from === a && t.to === c).length
    const t: FsmTransition = { id: fsmId('t'), from: a, to: c, cond: fsm.inputs.length ? '1'.padEnd(fsm.inputs.length, '-') : '', out: '0'.repeat(fsm.type === 'mealy' ? fsm.outputs.length : 0), bend: a === c ? 0 : fsm.transitions.some((u) => u.from === c && u.to === a) ? 0.3 : 0 }
    void same
    onChange({ ...fsm, transitions: [...fsm.transitions, t] }, 'Add transition')
    setSel({ kind: 'trans', id: t.id })
    setFrom(null)
  }

  const removeSel = () => {
    if (!sel) return
    if (sel.kind === 'state') {
      const states = fsm.states.filter((s) => s.id !== sel.id)
      if (states.length && !states.some((s) => s.initial)) states[0] = { ...states[0], initial: true }
      onChange({ ...fsm, states, transitions: fsm.transitions.filter((t) => t.from !== sel.id && t.to !== sel.id) }, 'Delete state')
    } else onChange({ ...fsm, transitions: fsm.transitions.filter((t) => t.id !== sel.id) }, 'Delete transition')
    setSel(null)
  }

  const onSvgDown = (e: React.PointerEvent) => {
    const [x, y] = point(e)
    if (tool === 'state') { addState(x, y); setTool('select'); return }
    setSel(null)
    setFrom(null)
  }

  const onStateDown = (e: React.PointerEvent, s: FsmState) => {
    e.stopPropagation()
    if (tool === 'trans') {
      if (!from) { setFrom(s.id); setSel({ kind: 'state', id: s.id }) } else addTransition(from, s.id)
      return
    }
    setSel({ kind: 'state', id: s.id })
    const [x, y] = point(e)
    svg.current?.setPointerCapture(e.pointerId)
    setDrag({ id: s.id, x: s.x, y: s.y, moved: false, ox: x - s.x, oy: y - s.y })
  }

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return
    const [x, y] = point(e)
    setDrag({ ...drag, x: snap(x - drag.ox, 10), y: snap(y - drag.oy, 10), moved: true })
  }

  const onUp = (e: React.PointerEvent) => {
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId)
    if (drag?.moved) onChange({ ...fsm, states: fsm.states.map((s) => (s.id === drag.id ? { ...s, x: drag.x, y: drag.y } : s)) }, 'Move state')
    setDrag(null)
  }

  const onKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select')) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSel() }
    else if (e.key === 'Escape') { setTool('select'); setFrom(null) }
    else if (e.key === 's') setTool('state')
    else if (e.key === 't') setTool('trans')
    else if (e.key === 'v') setTool('select')
  }

  const setInputs = (text: string) => {
    const inputs = splitList(text).slice(0, MAX_FSM_INPUTS)
    onChange({ ...fsm, inputs }, 'Inputs')
  }
  const setOutputs = (text: string) => {
    const outputs = splitList(text)
    const fix = (s: string) => s.padEnd(outputs.length, '0').slice(0, outputs.length)
    onChange({ ...fsm, outputs, states: fsm.states.map((s) => ({ ...s, out: fix(s.out) })), transitions: fsm.transitions.map((t) => ({ ...t, out: fsm.type === 'mealy' ? fix(t.out) : t.out })) }, 'Outputs')
  }
  const setType = (type: 'moore' | 'mealy') => {
    const fix = (s: string) => s.padEnd(fsm.outputs.length, '0').slice(0, fsm.outputs.length)
    onChange({ ...fsm, type, transitions: fsm.transitions.map((t) => ({ ...t, out: type === 'mealy' ? fix(t.out) : t.out })), states: fsm.states.map((s) => ({ ...s, out: fix(s.out) })) }, 'Machine type')
  }
  const patchState = (id: string, p: Partial<FsmState>) => onChange({ ...fsm, states: fsm.states.map((s) => (s.id === id ? { ...s, ...p } : p.initial ? { ...s, initial: false } : s)) }, 'Edit state')
  const patchTrans = (id: string, p: Partial<FsmTransition>) => onChange({ ...fsm, transitions: fsm.transitions.map((t) => (t.id === id ? { ...t, ...p } : t)) }, 'Edit transition')

  const detector = async () => {
    const pat = await os.dialog.prompt('Bit pattern to detect (2–8 bits, e.g. 1011):', { title: 'Sequence detector', defaultValue: '1011', okLabel: 'Next' })
    if (!pat) return
    const type = await os.dialog.choose('Which kind of machine?', [{ label: 'Cancel', value: 'cancel' }, { label: 'Moore', value: 'moore' }, { label: 'Mealy', value: 'mealy', primary: true }], { title: 'Sequence detector' })
    if (type !== 'moore' && type !== 'mealy') return
    const overlap = await os.dialog.choose('May matches overlap (1011011 contains two)?', [{ label: 'No overlap', value: 'no' }, { label: 'Overlap', value: 'yes', primary: true }], { title: 'Sequence detector' })
    if (!overlap) return
    try {
      const f = sequenceDetector(pat, { overlap: overlap === 'yes', type })
      onChange({ ...f, encoding: fsm.encoding }, 'Sequence detector')
      setSel(null)
      onSequence(`${pat.replace(/[^01]/g, '')}0${pat.replace(/[^01]/g, '')}`.split('').join(' '))
    } catch (e) { await os.dialog.alert(e instanceof Error ? e.message : String(e), { title: 'Sequence detector' }) }
  }

  const implement = async () => {
    if (fsm.states.length === 0) { await os.dialog.alert('Add some states first.', { title: 'State machine' }); return }
    if (fsm.states.length > MAX_STATES || fsm.inputs.length > MAX_FSM_INPUTS) { await os.dialog.alert('This machine is too big to implement as a circuit.', { title: 'State machine' }); return }
    try {
      const c = fsmToCircuit(fsm)
      onImplement(c.doc, c.probes, fsm.name, fsm)
    } catch (e) { await os.dialog.alert(e instanceof Error ? e.message : String(e), { title: 'State machine' }) }
  }

  const selectedState = sel?.kind === 'state' ? fsm.states.find((s) => s.id === sel.id) : undefined
  const selectedTrans = sel?.kind === 'trans' ? fsm.transitions.find((t) => t.id === sel.id) : undefined
  const parallel = (t: FsmTransition) => fsm.transitions.filter((u) => u.from === t.from && u.to === t.to)

  return (
    <div className="dg-fsm" tabIndex={-1} onKeyDown={onKey}>
      <div className="dg-fsm-left">
        <div className="k-toolbar dg-fsm-bar">
          <button className={`k-icon-btn${tool === 'select' ? ' active' : ''}`} title="Select and move (V)" aria-label="Select" aria-pressed={tool === 'select'} onClick={() => setTool('select')}><MousePointer2 size={15} /></button>
          <button className={`k-icon-btn${tool === 'state' ? ' active' : ''}`} title="Add a state: click on the diagram (S)" aria-label="Add a state" aria-pressed={tool === 'state'} onClick={() => setTool('state')}><CircleDot size={15} /></button>
          <button className={`k-icon-btn${tool === 'trans' ? ' active' : ''}`} title="Add a transition: click the source, then the target (T)" aria-label="Add a transition" aria-pressed={tool === 'trans'} onClick={() => setTool('trans')}><Spline size={15} /></button>
          <button className="k-icon-btn" title="Delete the selection" aria-label="Delete" disabled={!sel} onClick={removeSel}><Trash2 size={15} /></button>
          <span className="k-sep" />
          <button className="k-icon-btn" title="Undo" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>↶</button>
          <button className="k-icon-btn" title="Redo" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>↷</button>
          <span className="k-sep" />
          <button className="k-btn" onClick={() => void detector()}><Wand2 size={13} /> Sequence detector…</button>
          <span className="k-spacer" />
          <button className="k-btn primary" onClick={() => void implement()} title="Draw D flip-flops and gates for this machine in the circuit tab"><CircuitBoard size={13} /> Implement as circuit</button>
        </div>
        <div className="dg-fsm-meta">
          <label>Name <input className="k-input" value={fsm.name} onChange={(e) => onChange({ ...fsm, name: e.target.value }, 'Name')} /></label>
          <label>Type <select className="k-input" value={fsm.type} onChange={(e) => setType(e.target.value as 'moore' | 'mealy')}><option value="moore">Moore (output of the state)</option><option value="mealy">Mealy (output of state and input)</option></select></label>
          <label>Inputs <input className="k-input" defaultValue={fsm.inputs.join(', ')} key={`in-${fsm.inputs.join()}`} onBlur={(e) => setInputs(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /></label>
          <label>Outputs <input className="k-input" defaultValue={fsm.outputs.join(', ')} key={`out-${fsm.outputs.join()}`} onBlur={(e) => setOutputs(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /></label>
        </div>
        <div className="dg-fsm-canvas">
          <svg
            ref={svg} className="dg-fsm-svg" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" role="application" aria-label="State diagram"
            onPointerDown={onSvgDown} onPointerMove={onMove} onPointerUp={onUp} style={{ cursor: tool === 'select' ? undefined : 'crosshair' }}
          >
            <defs>
              <marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" className="dg-arrowhead" /></marker>
            </defs>
            {shown.transitions.map((t) => {
              const a = shown.states.find((s) => s.id === t.from)
              const c = shown.states.find((s) => s.id === t.to)
              if (!a || !c) return null
              const idx = parallel(t).indexOf(t)
              const g = transitionGeometry(a, c, t.bend, idx)
              const on = sel?.kind === 'trans' && sel.id === t.id
              const bad = checkCondition(t.cond, fsm.inputs) !== null
              return (
                <g key={t.id} className={`dg-tr${on ? ' on' : ''}${bad ? ' bad' : ''}`} onPointerDown={(e) => { e.stopPropagation(); if (tool === 'select') setSel({ kind: 'trans', id: t.id }) }}>
                  <path d={g.d} className="dg-tr-hit" />
                  <path d={g.d} className="dg-tr-line" markerEnd="url(#dg-arrow)" />
                  <text x={g.lx} y={g.ly} textAnchor="middle" className="dg-tr-label">{transitionLabel(t, fsm) || '·'}</text>
                </g>
              )
            })}
            {shown.states.map((s) => {
              const on = sel?.kind === 'state' && sel.id === s.id
              return (
                <g key={s.id} className={`dg-st${on ? ' on' : ''}${from === s.id ? ' from' : ''}`} onPointerDown={(e) => onStateDown(e, s)} onDoubleClick={() => { setSel({ kind: 'state', id: s.id }) }}>
                  {s.initial && <path d={`M${s.x - STATE_R - 34} ${s.y} L${s.x - STATE_R - 2} ${s.y}`} className="dg-tr-line" markerEnd="url(#dg-arrow)" />}
                  <circle cx={s.x} cy={s.y} r={STATE_R} className="dg-st-circle" />
                  {fsm.type === 'moore' && fsm.outputs.length > 0 && <circle cx={s.x} cy={s.y} r={STATE_R - 4} className="dg-st-inner" />}
                  <text x={s.x} y={s.y + (fsm.type === 'moore' && fsm.outputs.length ? -2 : 4)} textAnchor="middle" className="dg-st-name">{s.name}</text>
                  {fsm.type === 'moore' && fsm.outputs.length > 0 && <text x={s.x} y={s.y + 12} textAnchor="middle" className="dg-st-out">{s.out}</text>}
                </g>
              )
            })}
          </svg>
          {fsm.states.length === 0 && (
            <div className="dg-empty">
              <div className="dg-empty-card"><b>No states yet</b><p>Choose the state tool (S) and click here, or generate a sequence detector, or open the traffic-light example.</p></div>
            </div>
          )}
          <div className="dg-fsm-hint k-muted">{tool === 'state' ? 'Click to place a state.' : tool === 'trans' ? (from ? 'Now click the target state (the same state makes a loop).' : 'Click the source state.') : 'Drag states; select a state or arrow to edit it.'}</div>
        </div>
      </div>
      <div className="dg-fsm-right">
        {selectedState && (
          <div className="dg-card">
            <h4>State {selectedState.name}</h4>
            <label className="dg-field"><span>Name</span><input className="k-input" value={selectedState.name} onChange={(e) => patchState(selectedState.id, { name: e.target.value })} /></label>
            {fsm.type === 'moore' && <label className="dg-field"><span>Outputs ({fsm.outputs.join(' ') || 'none'})</span><input className="k-input dg-mono" value={selectedState.out} onChange={(e) => patchState(selectedState.id, { out: e.target.value.replace(/[^01]/g, '').slice(0, fsm.outputs.length) })} /></label>}
            <label className="dg-check"><input type="checkbox" checked={!!selectedState.initial} onChange={(e) => e.target.checked && patchState(selectedState.id, { initial: true })} /> Initial state (reset goes here)</label>
          </div>
        )}
        {selectedTrans && (
          <div className="dg-card">
            <h4>Transition</h4>
            <label className="dg-field"><span>Condition</span><input className="k-input dg-mono" value={selectedTrans.cond} placeholder={fsm.inputs.length ? `${'1'.padEnd(fsm.inputs.length, '-')} or ${fsm.inputs[0]} & !${fsm.inputs[1] ?? fsm.inputs[0]}` : 'always'} onChange={(e) => patchTrans(selectedTrans.id, { cond: e.target.value })} />
              <small className="k-muted">{fsm.inputs.length ? `A pattern over (${fsm.inputs.join(', ')}) of 0, 1 and - , or an expression. Empty = always.` : 'This machine has no inputs: leave it empty.'}</small></label>
            {checkCondition(selectedTrans.cond, fsm.inputs) && <div className="dg-error dg-small">{checkCondition(selectedTrans.cond, fsm.inputs)}</div>}
            {fsm.type === 'mealy' && <label className="dg-field"><span>Outputs ({fsm.outputs.join(' ') || 'none'})</span><input className="k-input dg-mono" value={selectedTrans.out} onChange={(e) => patchTrans(selectedTrans.id, { out: e.target.value.replace(/[^01]/g, '').slice(0, fsm.outputs.length) })} /></label>}
            {selectedTrans.from !== selectedTrans.to && <label className="dg-field"><span>Curvature</span><input type="range" min={-1} max={1} step={0.1} value={selectedTrans.bend} onChange={(e) => patchTrans(selectedTrans.id, { bend: Number(e.target.value) })} /></label>}
            {selectedTrans.from === selectedTrans.to && <label className="dg-check"><input type="checkbox" checked={selectedTrans.bend < 0} onChange={(e) => patchTrans(selectedTrans.id, { bend: e.target.checked ? -1 : 0 })} /> Loop below the state</label>}
          </div>
        )}
        {analysis.warnings.length > 0 && (
          <div className="dg-card dg-warns">
            <h4>Check</h4>
            <ul>{analysis.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
        <div className="dg-seg" role="tablist">
          {([['table', 'State table'], ['equations', 'Equations'], ['simulate', 'Simulate']] as [Sub, string][]).map(([id, label]) => <button key={id} role="tab" aria-selected={sub === id} className={sub === id ? 'on' : ''} onClick={() => setSub(id)}>{label}</button>)}
        </div>
        {sub === 'table' && <TableView fsm={fsm} analysis={analysis} />}
        {sub === 'equations' && <EquationsView fsm={fsm} onEncoding={(encoding) => onChange({ ...fsm, encoding }, 'State assignment')} />}
        {sub === 'simulate' && <SimView fsm={fsm} sequence={sequence} onSequence={onSequence} initialName={init?.name ?? ''} />}
        <p className="k-muted dg-small"><Plus size={11} /> Up to {MAX_STATES} states and {MAX_FSM_INPUTS} inputs.</p>
      </div>
    </div>
  )
}

function TableView({ fsm, analysis }: { fsm: Fsm; analysis: ReturnType<typeof analyseFsm> }) {
  if (analysis.table.length === 0) return <p className="k-muted">The state table appears when there are states.</p>
  const n = fsm.inputs.length
  return (
    <div className="dg-table-wrap">
      <table className="dg-fsm-table" aria-label="State table">
        <thead><tr><th>State</th>{n > 0 && <th>{fsm.inputs.join(' ')}</th>}<th>Next</th>{fsm.outputs.length > 0 && <th>{fsm.outputs.join(' ')}</th>}</tr></thead>
        <tbody>
          {analysis.table.map((r, i) => (
            <tr key={i} className={r.matched.length === 0 ? 'missing' : r.matched.length > 1 ? 'clash' : ''}>
              <td>{r.state}</td>{n > 0 && <td className="dg-mono">{r.inputBits}</td>}<td>{r.next}</td>{fsm.outputs.length > 0 && <td className="dg-mono">{r.out}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="k-muted dg-small">{fsm.type === 'moore' ? 'Moore: the output belongs to the current state.' : 'Mealy: the output belongs to the state and the input.'} Highlighted rows have no transition (the machine stays) or two.</p>
    </div>
  )
}

function EquationsView({ fsm, onEncoding }: { fsm: Fsm; onEncoding(e: Encoding): void }) {
  const result = useMemo(() => {
    try { return { eq: deriveEquations(fsm), error: null as string | null } } catch (e) { return { eq: null, error: e instanceof Error ? e.message : String(e) } }
  }, [fsm])
  const a = useMemo(() => assignStates(fsm), [fsm])
  return (
    <div>
      <label className="dg-field"><span>State assignment</span>
        <select className="k-input" value={fsm.encoding} onChange={(e) => onEncoding(e.target.value as Encoding)}>
          <option value="binary">Binary</option><option value="gray">Gray</option><option value="onehot">One-hot</option>
        </select>
      </label>
      <table className="dg-fsm-table">
        <thead><tr><th>State</th><th>{a.bits.join('')}</th></tr></thead>
        <tbody>{Object.entries(a.codes).map(([name, code]) => <tr key={name}><td>{name}</td><td className="dg-mono">{code}</td></tr>)}</tbody>
      </table>
      {a.unused.length > 0 && <p className="k-muted dg-small">Unused codes ({a.unused.map((u) => u.toString(2).padStart(a.bits.length, '0')).join(', ')}) are don&apos;t-cares in the equations.</p>}
      {result.error && <div className="dg-error">{result.error}</div>}
      {result.eq && (
        <dl className="dg-forms">
          {result.eq.next.map((e) => [<dt key={`${e.name}t`}>{e.name}</dt>, <dd key={`${e.name}d`}><code>{e.text}</code></dd>])}
          {result.eq.outputs.map((e) => [<dt key={`${e.name}t`}>{e.name}</dt>, <dd key={`${e.name}d`}><code>{e.text}</code></dd>])}
        </dl>
      )}
      <p className="k-muted dg-small">D inputs of the flip-flops and the outputs, minimised with Quine–McCluskey over the state bits ({a.bits.join(', ')}) and the inputs.</p>
    </div>
  )
}

function SimView({ fsm, sequence, onSequence, initialName }: { fsm: Fsm; sequence: string; onSequence(s: string): void; initialName: string }) {
  const host = useRef<HTMLDivElement>(null)
  const seq = splitList(sequence.replace(/[^01\s,]/g, ''))
  const trace = useMemo(() => simulateFsm(fsm, seq), [fsm, sequence]) // eslint-disable-line react-hooks/exhaustive-deps
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (trace.length === 0) { host.current?.replaceChildren(); return }
    const w = fsmWave(fsm, trace)
    void renderWave({ signal: w.signal, config: w.config, head: { tick: 0 } }).then(({ svg }) => { if (alive) { host.current?.replaceChildren(svg); setError(null) } }).catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => { alive = false }
  }, [fsm, trace])
  return (
    <div>
      <label className="dg-field"><span>Input sequence (one value per clock edge{fsm.inputs.length > 1 ? `, ${fsm.inputs.length} bits each, ${fsm.inputs.join('')}` : ''})</span>
        <input className="k-input dg-mono" value={sequence} placeholder="0 1 1 0 1 …" onChange={(e) => onSequence(e.target.value)} />
      </label>
      {trace.length === 0 ? <p className="k-muted">Type a sequence of 0s and 1s to run the machine from {initialName || 'its initial state'}.</p> : (
        <>
          <div className="dg-table-wrap">
            <table className="dg-fsm-table" aria-label="State trace">
              <thead><tr><th>#</th><th>{fsm.inputs.join(' ') || 'in'}</th><th>State</th><th>Next</th><th>{fsm.outputs.join(' ') || 'out'}</th></tr></thead>
              <tbody>{trace.map((r) => <tr key={r.step}><td>{r.step}</td><td className="dg-mono">{r.input}</td><td>{r.state}</td><td>{r.next}</td><td className="dg-mono">{r.out}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="dg-wave-scroll dg-fsm-wave"><div ref={host} className="dg-wave-host" /></div>
          {error && <div className="dg-error dg-small">{error}</div>}
        </>
      )}
    </div>
  )
}
