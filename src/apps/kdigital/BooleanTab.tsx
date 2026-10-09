// The Boolean tab: functions typed as expressions or minterm lists, the truth table (click an output to cycle
// 0 → 1 → X), canonical and minimal SOP / POS, NAND-only and NOR-only forms, the Quine–McCluskey tables and prime-implicant
// chart, the Karnaugh map with its groups, the hazard note, equivalence checking, and the links to the circuit.

import { useMemo, useState } from 'react'
import { ArrowRightLeft, Check, CircuitBoard, Copy } from 'lucide-react'
import { os } from '@/os'
import { equivalent, format, gateStats, parse, toNandOnly, toNorOnly, type Node } from './expr'
import { hazardFreeCover, hazardNote, kmapGroups, kmapLayout } from './kmap'
import { circuitFunctions, expressionsToDoc, type LogicStyle } from './layout'
import { implicantBits, termNode, type Implicant } from './qmc'
import { analyse, nextCell, parseFunctions, setFunctionCells, MAX_VARS, type Cell } from './truth'
import { KMap } from './KMapView'
import type { Doc } from './model'
import type { BooleanState } from './file'

interface Props {
  state: BooleanState
  circuit: Doc
  onState(patch: Partial<BooleanState>): void
  onMakeCircuit(doc: Doc, name: string): void
}

const STYLES: [LogicStyle, string][] = [['as-is', 'As typed'], ['sop', 'Minimal SOP (AND-OR)'], ['pos', 'Minimal POS (OR-AND)'], ['nand', 'NAND only'], ['nor', 'NOR only']]

function Copyable({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <span className="dg-copyable">
      <code>{text}</code>
      <button className="k-icon-btn" title={`Copy${label ? ` ${label}` : ''}`} aria-label={`Copy ${label ?? 'expression'}`} onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200) }).catch(() => undefined) }}>
        {done ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  )
}

export function BooleanTab({ state, circuit, onState, onMakeCircuit }: Props) {
  const set = useMemo(() => parseFunctions(state.text), [state.text])
  const { vars, outputs } = set.table
  const focusName = outputs.some((o) => o.name === state.focus) ? state.focus! : outputs[0]?.name
  const focusIdx = Math.max(0, outputs.findIndex((o) => o.name === focusName))
  const out = outputs[focusIdx]
  const an = useMemo(() => (out ? analyse(vars, out.name, out.values) : null), [out, vars])
  const [hover, setHover] = useState<number | null>(null)
  const [hazardFree, setHazardFree] = useState(false)
  const [other, setOther] = useState('')
  const [pos, setPos] = useState(false)
  const termText = (i: Implicant) => format(termNode(i, vars), 'prime')
  const n = vars.length

  const cover = an ? (pos ? an.min.pos.cover : hazardFree ? hazardFreeCover(an.min.sop, vars).cover : an.min.sop.cover) : []
  const groups = useMemo(() => (an && n >= 2 && n <= 5 && !pos ? kmapGroups(cover, kmapLayout(vars)) : []), [an, cover, n, vars, pos])
  const kmapValues: Cell[] = out ? out.values : []

  const cycle = (name: string, row: number) => {
    const o = outputs.find((x) => x.name === name)
    if (!o) return
    const values = o.values.slice()
    values[row] = nextCell(values[row])
    onState({ text: setFunctionCells(state.text, name, vars, values) })
  }

  const makeCircuit = () => {
    if (!outputs.length) return
    const defs = outputs.map((o) => {
      const spec = set.specs.find((s) => s.name === o.name && s.node)
      return { name: o.name, expr: spec ? spec.node! : analyse(vars, o.name, o.values).min.sopNode }
    })
    const built = expressionsToDoc(defs, state.style)
    onMakeCircuit(built.doc, outputs[0].name)
  }

  const fromCircuit = async () => {
    try {
      const f = circuitFunctions(circuit)
      if (f.outputs.length === 0) { await os.dialog.alert('The circuit has no LED outputs to read a function from.', { title: 'Circuit → expression' }); return }
      const lines = f.outputs.map((o) => `${o.name}(${f.inputs.join(',')}) = ${o.text.replace(/ ⊕ /g, ' ^ ')}`)
      const text = lines.join('\n')
      onState({ text: `${f.sequential ? '# the circuit has memory elements: this is the combinational behaviour with its current state\n' : ''}${text}` })
    } catch (e) { await os.dialog.alert(e instanceof Error ? e.message : String(e), { title: 'Circuit → expression' }) }
  }

  const newTable = async () => {
    const v = await os.dialog.prompt(`How many variables (2–${MAX_VARS})?`, { title: 'New truth table', defaultValue: '3', okLabel: 'Create' })
    const k = Math.round(Number(v))
    if (!v || !(k >= 2 && k <= MAX_VARS)) return
    onState({ text: `F(${'ABCDEFGH'.slice(0, k).split('').join(',')}) = Σm()` })
  }

  const eq = useMemo(() => {
    if (!other.trim() || !out) return null
    try {
      const spec = set.specs.find((s) => s.name === out.name)
      const a: Node = spec?.node ?? analyse(vars, out.name, out.values).min.sopNode
      const b = parse(other)
      const r = equivalent(a, b)
      return { ok: r.equal, text: r.equal ? 'Equivalent: the two expressions give the same output for every input.' : `Different: for ${Object.entries(r.counterexample!).map(([k, v]) => `${k}=${v}`).join(' ')} they give ${format(a)} → ${evalText(a, r.counterexample!)} and the other gives ${evalText(b, r.counterexample!)}.` }
    } catch (e) { return { ok: false, text: e instanceof Error ? e.message : String(e) } }
  }, [other, out, set, vars])

  const minimalNode = an ? (pos ? an.min.posNode : an.min.sopNode) : null

  return (
    <div className="dg-bool">
      <div className="dg-bool-side">
        <div className="dg-bool-bar">
          <h3>Functions</h3>
          <span className="k-spacer" />
          <button className="k-btn" onClick={() => void newTable()} title="Start from an empty truth table">Truth table…</button>
          <button className="k-btn" onClick={() => void fromCircuit()} title="Read the functions of the LEDs from the circuit"><ArrowRightLeft size={13} /> From circuit</button>
        </div>
        <textarea
          className="k-input dg-textarea dg-mono dg-bool-text" value={state.text} spellCheck={false} aria-label="Boolean functions" rows={8}
          placeholder={'F = A & B | !C\nG(A,B,C,D) = Σm(1,3,5,7) + d(0,2)'} onChange={(e) => onState({ text: e.target.value })}
        />
        {set.errors.map((e, i) => <div key={i} className="dg-error dg-small">{e.line ? `Line ${e.line}: ` : ''}{e.message}</div>)}
        <p className="k-muted dg-small">
          Operators: <code>!</code> <code>~</code> <code>&apos;</code> NOT, <code>&amp;</code> <code>*</code> AND (or just AB), <code>|</code> <code>+</code> OR, <code>^</code> XOR, NAND, NOR, XNOR; constants 0 and 1.
          Up to {MAX_VARS} variables. Minterm lists: <code>F(A,B,C) = Σm(1,2,4) + d(7)</code> or <code>ΠM(0,3)</code>. Uppercase words such as AB mean A·B: write Cin or Sum with a lower-case letter to keep a longer name.
        </p>
        <div className="dg-bool-make">
          <select className="k-input" value={state.style} aria-label="Gate style" onChange={(e) => onState({ style: e.target.value as LogicStyle })}>{STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button className="k-btn primary" disabled={outputs.length === 0} onClick={makeCircuit}><CircuitBoard size={13} /> Expression → circuit</button>
        </div>
        {outputs.length > 0 && (
          <div className="dg-tt-wrap">
            <table className="dg-tt" aria-label="Truth table">
              <thead>
                <tr><th>#</th>{vars.map((v) => <th key={v}>{v}</th>)}{outputs.map((o) => <th key={o.name} className={`out${o.name === out?.name ? ' on' : ''}`}><button onClick={() => onState({ focus: o.name })}>{o.name}</button></th>)}</tr>
              </thead>
              <tbody>
                {Array.from({ length: 1 << n }, (_, r) => (
                  <tr key={r}>
                    <td className="idx">{r}</td>
                    {vars.map((v, k) => <td key={v}>{(r >> (n - 1 - k)) & 1}</td>)}
                    {outputs.map((o) => (
                      <td key={o.name} className={`out v${o.values[r]}${o.name === out?.name ? ' on' : ''}`}>
                        <button onClick={() => cycle(o.name, r)} aria-label={`${o.name} for row ${r}: ${o.values[r] === 2 ? 'don\'t care' : o.values[r]}. Click to change`}>{o.values[r] === 2 ? 'X' : o.values[r]}</button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="k-muted dg-small">Click an output to cycle 0 → 1 → X (don&apos;t care).</p>
          </div>
        )}
      </div>
      <div className="dg-bool-main">
        {!an || !out ? (
          <div className="dg-empty-note"><b>No function yet</b><p>Type an expression such as <code>F = A &amp; B | !C</code> on the left, or open the “Majority voter” example.</p></div>
        ) : (
          <>
            <h3>{out.name}({vars.join(', ')})</h3>
            <section className="dg-card">
              <h4>Forms</h4>
              <dl className="dg-forms">
                <dt>Σ notation</dt><dd><Copyable text={an.sigma} /></dd>
                <dt>Π notation</dt><dd><Copyable text={an.pi} /></dd>
                <dt>Canonical SOP</dt><dd><Copyable text={format(an.canonicalSop)} /></dd>
                <dt>Canonical POS</dt><dd><Copyable text={format(an.canonicalPos)} /></dd>
                <dt>Minimal SOP</dt><dd><Copyable text={format(an.min.sopNode)} label="minimal SOP" /> <span className="k-muted dg-small">{an.min.sop.cover.length} term{an.min.sop.cover.length === 1 ? '' : 's'}, {an.min.sop.cover.reduce((s, c) => s + vars.length - popcount(c.mask), 0)} literals{an.min.sop.heuristic ? ' (best found)' : ''}</span></dd>
                <dt>Minimal POS</dt><dd><Copyable text={format(an.min.posNode)} label="minimal POS" /> <span className="k-muted dg-small">{an.min.pos.cover.length} term{an.min.pos.cover.length === 1 ? '' : 's'}</span></dd>
                <dt>NAND only</dt><dd><Copyable text={format(toNandOnly(an.min.sopNode), 'bang')} /> <span className="k-muted dg-small">{gateStats(toNandOnly(an.min.sopNode)).gates} gates</span></dd>
                <dt>NOR only</dt><dd><Copyable text={format(toNorOnly(an.min.posNode), 'bang')} /> <span className="k-muted dg-small">{gateStats(toNorOnly(an.min.posNode)).gates} gates</span></dd>
                <dt>Verilog</dt><dd><Copyable text={`assign ${out.name} = ${format(minimalNode!, 'verilog')};`} /></dd>
              </dl>
              <div className="dg-seg" role="tablist" aria-label="Which minimal form the map shows">
                <button role="tab" aria-selected={!pos} className={!pos ? 'on' : ''} onClick={() => setPos(false)}>Sum of products</button>
                <button role="tab" aria-selected={pos} className={pos ? 'on' : ''} onClick={() => setPos(true)}>Product of sums</button>
              </div>
            </section>

            {n >= 2 && n <= 5 ? (
              <section className="dg-card">
                <h4>Karnaugh map</h4>
                <div className="dg-km-wrap"><KMap vars={vars} values={kmapValues} groups={groups} hover={hover} onCell={(m) => cycle(out.name, m)} /></div>
                {pos ? <p className="k-muted dg-small">The map is drawn for the sum of products; the product of sums is shown above.</p> : (
                  <>
                    <ul className="dg-terms">
                      {cover.map((c, i) => (
                        <li key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                          <span className={`dg-swatch dg-g${i % 6}`} />
                          <code>{termText(c)}</code> <span className="k-muted dg-small">{implicantBits(c, n)} · {c.minterms.length} cell{c.minterms.length === 1 ? '' : 's'}</span>
                        </li>
                      ))}
                      {cover.length === 0 && <li className="k-muted">The function is constant 0: no groups.</li>}
                    </ul>
                    <p className="dg-hazard">{hazardNote(an.min.sop, vars, termText)}</p>
                    {an.min.sop.cover.length > 0 && <label className="dg-check"><input type="checkbox" checked={hazardFree} onChange={(e) => setHazardFree(e.target.checked)} /> Show the hazard-free cover (adds the redundant consensus terms)</label>}
                  </>
                )}
              </section>
            ) : <section className="dg-card"><h4>Karnaugh map</h4><p className="k-muted">Maps are drawn for 2 to 5 variables (this function has {n}).</p></section>}

            <section className="dg-card">
              <h4>Quine–McCluskey</h4>
              <p className="k-muted dg-small">Minterms grouped by the number of 1s are combined while they differ in one bit; a dash means “either”. Terms that cannot be combined further are the prime implicants.</p>
              <div className="dg-qmc-rounds">
                {an.min.sop.rounds.map((round, ri) => (
                  <table key={ri} className="dg-qmc">
                    <caption>{ri === 0 ? 'Minterms (and don\'t-cares)' : `Combined ${ri}×`}</caption>
                    <tbody>
                      {round.map((i) => (
                        <tr key={`${i.mask}:${i.value}`} className={an.min.sop.primes.includes(i) ? 'prime' : ''}>
                          <td className="dg-mono">{implicantBits(i, n)}</td><td className="k-muted dg-small">{i.minterms.join(',')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </div>
              {an.min.sop.primes.length > 0 ? (
                <div className="dg-chart-wrap">
                  <table className="dg-chart" aria-label="Prime-implicant chart">
                    <thead><tr><th>Prime</th><th>Term</th>{an.min.sop.on.map((m, c) => <th key={m} className={an.min.sop.essentialColumns.includes(c) ? 'ess' : ''}>{m}</th>)}</tr></thead>
                    <tbody>
                      {an.min.sop.primes.map((p, pi) => {
                        const ess = an.min.sop.essential.includes(p)
                        const chosen = an.min.sop.cover.includes(p)
                        return (
                          <tr key={pi} className={chosen ? 'chosen' : ''}>
                            <th className="dg-mono">{implicantBits(p, n)}</th><td><code>{termText(p)}</code>{ess ? ' ★' : chosen ? ' ✓' : ''}</td>
                            {an.min.sop.on.map((m, c) => <td key={m} className={an.min.sop.chart[pi][c] ? (ess && an.min.sop.essentialColumns.includes(c) ? 'x ess' : 'x') : ''}>{an.min.sop.chart[pi][c] ? '×' : ''}</td>)}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p className="k-muted dg-small">★ essential prime (the only one covering some minterm), ✓ chosen to finish the cover.{an.min.sop.coveredByEssentials ? ' The essentials alone cover everything.' : ''}</p>
                </div>
              ) : <p className="k-muted">There are no minterms: the function is 0.</p>}
            </section>

            <section className="dg-card">
              <h4>Equivalence check</h4>
              <input className="k-input" value={other} placeholder={`Another expression to compare with ${out.name}, e.g. A ^ B`} aria-label="Expression to compare" onChange={(e) => setOther(e.target.value)} />
              {eq && <p className={eq.ok ? 'dg-ok-text' : 'dg-error'}>{eq.text}</p>}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function popcount(x: number) { let c = 0; while (x) { c += x & 1; x >>= 1 } return c }

function evalText(n: Node, env: Record<string, number>): string {
  const f = (m: Node): number => {
    switch (m.t) {
      case 'const': return m.v
      case 'var': return env[m.n] ? 1 : 0
      case 'not': return 1 - f(m.a)
      case 'and': return m.a.every(f) ? 1 : 0
      case 'or': return m.a.some(f) ? 1 : 0
      case 'nand': return m.a.every(f) ? 0 : 1
      case 'nor': return m.a.some(f) ? 0 : 1
      case 'xor': return m.a.reduce((s, c) => s ^ f(c), 0)
      case 'xnor': return 1 ^ m.a.reduce((s, c) => s ^ f(c), 0)
    }
  }
  return String(f(n))
}
