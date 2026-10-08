// Kinetics: a reaction network simulator (text syntax and form), order determination from (t, c) data, Arrhenius /
// Eyring analysis and Michaelis–Menten with Lineweaver–Burk.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Plus, X } from 'lucide-react'
import { arrheniusFigure, kineticsFigure, michaelisFigure, onWhite, orderFigure, PRINT_PALETTE, seriesStyle } from './figures'
import { arrhenius, eyring, fitOrder, orderUnit, parseTable } from './fit'
import {
  PRESETS, consecutiveB, findPreset, firstOrder, formToText, michaelisMenten, networkToForm, parseNetwork, readRateFields, simulate, summarise,
  writeRateFields, type NetworkForm, type RateFields,
} from './kinetics'
import { ChartCard } from './ChartCard'
import { num } from './formula'
import { usePalette } from './PlotlyChart'
import { Card, Err, Field, Hint, ResultActions, Tabs, toNum, useDebounced, useKr } from './ui'
import type { KineticsTab } from './workspace'

const TABS: { id: KineticsTab; label: string }[] = [
  { id: 'simulate', label: 'Simulate' },
  { id: 'order', label: 'Order from data' },
  { id: 'arrhenius', label: 'Arrhenius' },
  { id: 'michaelis', label: 'Michaelis–Menten' },
]

export function KineticsTool() {
  const kr = useKr()
  const k = kr.ws.kinetics
  return (
    <div className="kr-tool-body">
      <Tabs value={k.tab} onChange={(tab) => kr.patch('kinetics', { tab })} tabs={TABS} />
      {k.tab === 'simulate' && <SimulateTab />}
      {k.tab === 'order' && <OrderTab />}
      {k.tab === 'arrhenius' && <ArrheniusTab />}
      {k.tab === 'michaelis' && <MichaelisTab />}
    </div>
  )
}

// ------------------------------------------------------------------ simulate

const SYNTAX = [
  'A = 1                       initial concentration (mol/L)',
  'fixed B = 3                 held constant',
  'A + B -> C ; k = 0.1        irreversible step',
  '2 A <=> B ; kf = 2, kr = 0.5   reversible (or kf = 2, K = 4)',
  'A -> B ; A = 1e8, Ea = 50   Arrhenius, Ea in kJ/mol (needs T = 298)',
  '0 -> A ; k = 0.01           zero-order source',
].join('\n')

/** Analytic curves for the unmodified textbook presets. */
function analyticFor(presetId: string, text: string, t: number[], species: string[]): { name: string; y: number[] }[] {
  const p = findPreset(presetId)
  if (!p || p.text !== text) return []
  if (p.id === 'first-order') return [{ name: 'A (exact)', y: t.map((x) => firstOrder(1, 0.05, x)) }]
  if (p.id === 'consecutive' && species.includes('B')) return [{ name: 'B (exact)', y: t.map((x) => consecutiveB(0.5, 0.2, 1, x)) }]
  return []
}

function SimulateTab() {
  const kr = useKr()
  const pal = usePalette()
  const k = kr.ws.kinetics
  const [mode, setMode] = useState<'text' | 'form'>('text')
  const deb = useDebounced({ text: k.text, tEnd: k.tEnd, logTime: k.logTime, method: k.method }, 350)
  const parsed = useMemo(() => parseNetwork(deb.text), [deb.text])
  const sim = useMemo(() => {
    const tEnd = toNum(deb.tEnd)
    if (!parsed.network || !(tEnd > 0)) return null
    return simulate(parsed.network, { tEnd, points: 300, logTime: deb.logTime, method: deb.method })
  }, [parsed, deb.tEnd, deb.logTime, deb.method])
  const analytic = useMemo(() => (sim ? analyticFor(k.presetId, deb.text, sim.t, sim.species) : []), [sim, k.presetId, deb.text])
  const figure = useMemo(() => (sim ? kineticsFigure({ sim, hidden: k.hidden, logTime: deb.logTime, analytic }, pal) : null), [sim, k.hidden, deb.logTime, analytic, pal])
  const printFigure = useMemo(() => (sim ? onWhite(kineticsFigure({ sim, hidden: k.hidden, logTime: deb.logTime, analytic }, PRINT_PALETTE)) : null), [sim, k.hidden, deb.logTime, analytic])
  const summary = useMemo(() => (sim ? summarise(sim) : []), [sim])
  const preset = findPreset(k.presetId)

  const text = useMemo(() => {
    if (!sim) return ''
    const lines = [deb.text.trim(), '', `t_end = ${deb.tEnd}${deb.logTime ? ' (log time axis)' : ''}; solver ${sim.method.toUpperCase()}, ${sim.steps} steps`]
    for (const s of summary) lines.push(`${s.name}: initial ${num(s.initial, kr.sig)}, final ${num(s.final, kr.sig)}, max ${num(s.max, kr.sig)} at t = ${num(s.tMax, kr.sig)}${s.tHalf !== null ? `, half-life ${num(s.tHalf, kr.sig)}` : ''}`)
    return lines.join('\n')
  }, [sim, summary, deb.text, deb.tEnd, deb.logTime, kr.sig])

  const choosePreset = (id: string) => {
    const p = findPreset(id)
    if (!p) return
    kr.patch('kinetics', { presetId: id, text: p.text, tEnd: String(p.tEnd), logTime: p.logTime, hidden: [] })
  }

  return (
    <>
      <Card
        title="Reaction network"
        actions={<Tabs value={mode} onChange={setMode} tabs={[{ id: 'text', label: 'Text' }, { id: 'form', label: 'Form' }]} />}
      >
        <div className="kr-arrowrow">
          <Field label="Example">
            <select className="k-input" value={k.presetId} aria-label="Example network" onChange={(e) => choosePreset(e.target.value)}>
              <option value="">— custom —</option>
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="End time">
            <input className="k-input kr-num" value={k.tEnd} inputMode="decimal" aria-label="End time" onChange={(e) => kr.patch('kinetics', { tEnd: e.target.value })} />
          </Field>
          <Field label="Solver">
            <select className="k-input" value={k.method} aria-label="Solver" onChange={(e) => kr.patch('kinetics', { method: e.target.value as typeof k.method })}>
              <option value="auto">Auto (RK45, then stiff)</option>
              <option value="rk45">RK45 (adaptive)</option>
              <option value="rk4">RK4 (fixed step)</option>
              <option value="stiff">Stiff (implicit Euler + extrapolation)</option>
            </select>
          </Field>
          <label className="kr-check"><input type="checkbox" checked={k.logTime} onChange={(e) => kr.patch('kinetics', { logTime: e.target.checked })} /> Log time axis</label>
        </div>
        {mode === 'text' ? (
          <textarea
            className="k-input kr-textarea kr-mono"
            value={k.text}
            spellCheck={false}
            aria-label="Reaction network"
            rows={Math.min(14, Math.max(6, k.text.split('\n').length + 1))}
            onChange={(e) => kr.patch('kinetics', { text: e.target.value, presetId: k.presetId && findPreset(k.presetId)?.text === e.target.value ? k.presetId : '' })}
          />
        ) : (
          <NetworkFormView text={k.text} onText={(t) => kr.patch('kinetics', { text: t, presetId: '' })} />
        )}
        {parsed.errors.map((e, i) => <Err key={i}>{e}</Err>)}
        {parsed.warnings.map((w, i) => <div key={i} className="kr-warn">{w}</div>)}
        {mode === 'text' && <details className="kr-details"><summary className="k-muted kr-small">Syntax</summary><pre className="kr-mono kr-small kr-pre">{SYNTAX}</pre></details>}
        {parsed.network && (
          <ul className="kr-steps kr-small">
            {parsed.network.steps.map((s, i) => <li key={i}><span className="kr-mono">{s.text}</span> <span className="k-muted">{s.how}</span></li>)}
          </ul>
        )}
      </Card>

      {sim && !sim.ok && <Err>{sim.message}</Err>}
      <ChartCard
        title="Concentrations"
        figure={sim && sim.ok ? figure : null}
        printFigure={printFigure}
        height={330}
        name="kinetics"
        tool="Kinetics"
        pinText={text}
        empty={parsed.errors.length ? 'Fix the network to see the curves.' : 'Enter a positive end time.'}
      >
        {sim && sim.ok && (
          <>
            <div className="kr-chips">
              {sim.species.map((s, i) => {
                const off = k.hidden.includes(s)
                return (
                  <button
                    key={s}
                    className={`kr-chip ${off ? '' : 'on'}`}
                    aria-pressed={!off}
                    onClick={() => kr.patch('kinetics', { hidden: off ? k.hidden.filter((x) => x !== s) : [...k.hidden, s] })}
                    title={off ? 'Show this species' : 'Hide this species'}
                  >
                    <span className="kr-dot" style={{ background: seriesStyle(i, pal).color }} /> {s}
                  </button>
                )
              })}
            </div>
            <table className="kr-table">
              <thead><tr><th>Species</th><th>initial</th><th>final</th><th>maximum</th><th>at t =</th><th>half-life</th></tr></thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.name}><td>{s.name}</td><td>{num(s.initial, kr.sig)}</td><td>{num(s.final, kr.sig)}</td><td>{num(s.max, kr.sig)}</td><td>{num(s.tMax, kr.sig)}</td><td>{s.tHalf === null ? '—' : num(s.tHalf, kr.sig)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="k-muted kr-small">Solver used: {sim.method === 'stiff' ? 'stiff (implicit Euler + Richardson extrapolation)' : sim.method === 'rk4' ? 'RK4' : 'Dormand–Prince RK45'}, {sim.steps} steps. Copy or pin the numbers with the buttons on the chart.</div>
          </>
        )}
        {preset && preset.text === k.text && <p className="kr-explain">{preset.note}</p>}
      </ChartCard>
      {sim && sim.ok && <Card><ResultActions tool="kinetics" label="Kinetics simulation" text={text} /></Card>}
    </>
  )
}

// ------------------------------------------------------------------ the form

function RateRow({ eq, params, onChange }: { eq: string; params: string; onChange: (p: string) => void }) {
  const reversible = /<|⇌|⇄/.test(eq)
  const f = readRateFields(params)
  const set = (p: Partial<RateFields>) => onChange(writeRateFields({ ...f, ...p }, reversible))
  const input = (key: keyof RateFields, label: string) => (
    <label className="kr-mini">
      <span className="kr-label">{label}</span>
      <input className="k-input kr-num" value={String(f[key])} inputMode="decimal" aria-label={label} onChange={(e) => set({ [key]: e.target.value } as Partial<RateFields>)} />
    </label>
  )
  return (
    <div className="kr-rate">
      {f.arrhenius ? (
        <>
          {input('A', reversible ? 'A forward' : 'A')}
          {input('Ea', reversible ? 'Ea forward (kJ/mol)' : 'Ea (kJ/mol)')}
          {reversible && input('Ar', 'A reverse')}
          {reversible && input('Ear', 'Ea reverse (kJ/mol)')}
        </>
      ) : (
        <>
          {input('k', reversible ? 'k forward' : 'k')}
          {reversible && input('kr', 'k reverse')}
        </>
      )}
      <label className="kr-check"><input type="checkbox" checked={f.arrhenius} onChange={(e) => set({ arrhenius: e.target.checked })} /> Arrhenius</label>
    </div>
  )
}

function formFromText(text: string): NetworkForm | null {
  const net = parseNetwork(text).network
  return net ? networkToForm(net) : null
}

/** The form keeps its own rows, so half-typed values survive; the text follows every edit. */
function NetworkFormView({ text, onText }: { text: string; onText: (t: string) => void }) {
  const [newName, setNewName] = useState('')
  const [form, setForm] = useState<NetworkForm | null>(() => formFromText(text))
  const emitted = useRef(text)
  useEffect(() => {
    // the text was changed from outside (an example, the text view, the AI): read it again
    if (text !== emitted.current) {
      emitted.current = text
      setForm(formFromText(text))
    }
  }, [text])
  if (!form) return <div className="k-muted kr-empty">Fix the errors in the Text view first, then come back to the form.</div>
  const commit = (f: NetworkForm) => {
    const t = formToText(f)
    emitted.current = t
    setForm(f)
    onText(t)
  }
  return (
    <div className="kr-form">
      <div className="kr-form-col">
        <div className="kr-label">Species</div>
        <table className="kr-table kr-formtable">
          <thead><tr><th>Name</th><th>Initial (mol/L)</th><th>Fixed</th></tr></thead>
          <tbody>
            {form.species.map((s, i) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td><input className="k-input kr-num" value={s.init} aria-label={`Initial concentration of ${s.name}`} onChange={(e) => commit({ ...form, species: form.species.map((x, k) => (k === i ? { ...x, init: e.target.value } : x)) })} /></td>
                <td><input type="checkbox" checked={s.fixed} aria-label={`${s.name} held constant`} onChange={(e) => commit({ ...form, species: form.species.map((x, k) => (k === i ? { ...x, fixed: e.target.checked } : x)) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="kr-predrow">
          <input className="k-input" value={newName} placeholder="new species" aria-label="New species" onChange={(e) => setNewName(e.target.value)} />
          <button className="k-btn small" disabled={!/^[A-Za-z_][A-Za-z0-9_*']*$/.test(newName) || form.species.some((s) => s.name === newName)} onClick={() => { commit({ ...form, species: [...form.species, { name: newName, init: '0', fixed: false }] }); setNewName('') }}><Plus size={13} /> Add</button>
        </div>
        <label className="kr-stack">
          <span className="kr-label">Temperature T (K, for Arrhenius steps)</span>
          <input className="k-input kr-num" value={form.T} inputMode="decimal" aria-label="Temperature" onChange={(e) => commit({ ...form, T: e.target.value })} />
        </label>
      </div>
      <div className="kr-form-col kr-form-wide">
        <div className="kr-label">Steps</div>
        {form.steps.map((s, i) => (
          <div className="kr-formstep" key={i}>
            <div className="kr-predrow">
              <input className="k-input kr-mono" value={s.eq} aria-label={`Step ${i + 1}`} spellCheck={false} onChange={(e) => commit({ ...form, steps: form.steps.map((x, k) => (k === i ? { ...x, eq: e.target.value } : x)) })} />
              <button className="k-icon-btn" aria-label="Remove step" title="Remove step" onClick={() => commit({ ...form, steps: form.steps.filter((_, k) => k !== i) })}><X size={14} /></button>
            </div>
            <RateRow eq={s.eq} params={s.params} onChange={(p) => commit({ ...form, steps: form.steps.map((x, k) => (k === i ? { ...x, params: p } : x)) })} />
          </div>
        ))}
        <button className="k-btn small" onClick={() => commit({ ...form, steps: [...form.steps, { eq: `${form.species[0]?.name ?? 'A'} -> ${form.species[1]?.name ?? 'B'}`, params: 'k = 0.1' }] })}><Plus size={13} /> Add a step</button>
        <Hint>Use -&gt; for an irreversible step and &lt;=&gt; for a reversible one. Comments of the text view are dropped when you edit here.</Hint>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ order from data

function OrderTab() {
  const kr = useKr()
  const pal = usePalette()
  const k = kr.ws.kinetics
  const [noise, setNoise] = useState('1')
  const table = useMemo(() => parseTable(k.orderData), [k.orderData])
  const res = useMemo(() => fitOrder(table.x, table.y), [table])
  const names = ['Zero', 'First', 'Second']

  const fromSimulation = () => {
    const parsed = parseNetwork(k.text)
    const tEnd = toNum(k.tEnd)
    if (!parsed.network || !(tEnd > 0)) return kr.say('The Simulate tab needs a valid network and end time first.')
    const sim = simulate(parsed.network, { tEnd, points: 12 })
    const idx = sim.species.findIndex((_, i) => !parsed.network!.fixed[i] && sim.c[0][i] > 0 && sim.c[sim.c.length - 1][i] < sim.c[0][i])
    if (idx < 0) return kr.say('No species in the network decays.')
    const sd = Number(noise) / 100
    const rows = sim.t.map((t, j) => `${num(t, 6)}\t${num(Math.max(1e-12, sim.c[j][idx] * (1 + sd * (Math.random() - 0.5) * 2)), 5)}`)
    kr.patch('kinetics', { orderData: `# t\t[${sim.species[idx]}]\n${rows.join('\n')}` })
  }

  const text = useMemo(() => {
    const lines = ['Order from concentration–time data', res.message]
    for (const f of res.fits) lines.push(`${names[f.order]} order: k = ${num(f.k, kr.sig)} ± ${num(f.kSE, 2)} ${orderUnit(f.order)}, R² = ${f.fit.r2.toFixed(5)}, [A]0 = ${num(f.c0, kr.sig)}, t½ = ${num(f.halfLife, kr.sig)}`)
    return lines.join('\n')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, kr.sig])

  return (
    <>
      <Card title="Concentration against time" actions={<ResultActions tool="kinetics" label="Reaction order" text={text} />}>
        <div className="kr-arrowrow">
          <Field label="Paste data (t, concentration)">
            <textarea className="k-input kr-textarea kr-mono" rows={9} value={k.orderData} spellCheck={false} aria-label="Concentration data" onChange={(e) => kr.patch('kinetics', { orderData: e.target.value })} />
          </Field>
          <div className="kr-stack">
            <Field label="Or take the data from the simulation">
              <select className="k-input" value={noise} aria-label="Noise" onChange={(e) => setNoise(e.target.value)}>
                <option value="0">no noise</option><option value="1">1 % noise</option><option value="3">3 % noise</option><option value="8">8 % noise</option>
              </select>
            </Field>
            <button className="k-btn" onClick={fromSimulation}><Play size={13} /> Use simulated data</button>
            <Hint>{table.x.length} points read{table.skipped ? `, ${table.skipped} line${table.skipped === 1 ? '' : 's'} skipped` : ''}. Separate columns with spaces, tabs, commas or semicolons.</Hint>
          </div>
        </div>
      </Card>
      <Card title="Which order fits?">
        {res.best ? <div className={res.ambiguous ? 'kr-warn' : 'kr-ok'}>{res.message}</div> : <Err>{res.message}</Err>}
        <table className="kr-table">
          <thead><tr><th>Order</th><th>k ± SE</th><th>unit</th><th>R²</th><th>[A]₀ (fit)</th><th>half-life</th><th>RMSE</th></tr></thead>
          <tbody>
            {res.fits.map((f) => (
              <tr key={f.order} className={res.best?.order === f.order ? 'kr-best' : ''}>
                <td>{names[f.order]}</td>
                <td>{f.valid && Number.isFinite(f.k) ? `${num(f.k, kr.sig)} ± ${num(f.kSE, 2)}` : '—'}</td>
                <td className="k-muted">{orderUnit(f.order)}</td>
                <td>{f.valid ? f.fit.r2.toFixed(5) : '—'}</td>
                <td>{f.valid ? num(f.c0, kr.sig) : '—'}</td>
                <td>{f.valid && Number.isFinite(f.halfLife) ? num(f.halfLife, kr.sig) : '—'}</td>
                <td>{f.valid ? num(f.rmse, 2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Hint>The straight line wins: [A] against t for zero order, ln [A] for first order, 1/[A] for second order. With data over less than one half-life the choice can be ambiguous.</Hint>
      </Card>
      <div className="kr-three">
        {res.fits.map((f) => {
          const ok = f.valid && Number.isFinite(f.fit.r2)
          const fig = ok ? orderFigure(table.x, f, pal) : null
          const print = ok ? onWhite(orderFigure(table.x, f, PRINT_PALETTE)) : null
          return (
            <ChartCard key={f.order} title={`${names[f.order]} order: ${f.yLabel} against t`} figure={fig} printFigure={print} height={230} name={`order-${f.order}`} tool="Kinetics" pinText={text} empty="No data for this plot.">
              {ok && <div className="k-muted kr-small">R² = {f.fit.r2.toFixed(4)}</div>}
            </ChartCard>
          )
        })}
      </div>
    </>
  )
}

// ------------------------------------------------------------------ Arrhenius

function ArrheniusTab() {
  const kr = useKr()
  const pal = usePalette()
  const k = kr.ws.kinetics
  const table = useMemo(() => parseTable(k.arrData), [k.arrData])
  const valid = table.x.length >= 3 && table.x.every((t) => t > 0) && table.y.every((v) => v > 0)
  const ar = useMemo(() => (valid ? arrhenius(table.x, table.y) : null), [valid, table])
  const ey = useMemo(() => (valid ? eyring(table.x, table.y) : null), [valid, table])
  const eyr = k.arrKind === 'eyring'
  const fig = useMemo(() => {
    if (!ar || !ey) return null
    const x = table.x.map((t) => 1 / t)
    const y = eyr ? table.y.map((v, i) => Math.log(v / table.x[i])) : ar.y
    return arrheniusFigure(eyr ? ey : ar, x, y, eyr, pal)
  }, [ar, ey, table, eyr, pal])
  const print = useMemo(() => {
    if (!ar || !ey) return null
    const x = table.x.map((t) => 1 / t)
    const y = eyr ? table.y.map((v, i) => Math.log(v / table.x[i])) : ar.y
    return onWhite(arrheniusFigure(eyr ? ey : ar, x, y, eyr, PRINT_PALETTE))
  }, [ar, ey, table, eyr])
  const text = ar && ey
    ? eyr
      ? `Eyring: ΔH‡ = ${num(ey.dH, kr.sig)} ± ${num(ey.dHSE, 2)} kJ/mol, ΔS‡ = ${num(ey.dS, kr.sig)} ± ${num(ey.dSSE, 2)} J/(mol K), ΔG‡(298 K) = ${num(ey.dG298, kr.sig)} kJ/mol, R² = ${ey.fit.r2.toFixed(5)}`
      : `Arrhenius: Ea = ${num(ar.Ea, kr.sig)} ± ${num(ar.EaSE, 2)} kJ/mol, A = ${num(ar.A, kr.sig)} (ln A = ${num(ar.lnA, kr.sig)} ± ${num(ar.lnASE, 2)}), k(298 K) = ${num(ar.k298, kr.sig)}, R² = ${ar.fit.r2.toFixed(5)}`
    : ''
  return (
    <>
      <Card title="Rate constants against temperature" actions={text ? <ResultActions tool="kinetics" label={eyr ? 'Eyring analysis' : 'Arrhenius analysis'} text={text} /> : undefined}>
        <div className="kr-arrowrow">
          <Field label="Paste data (T in K, k)">
            <textarea className="k-input kr-textarea kr-mono" rows={8} value={k.arrData} spellCheck={false} aria-label="Rate constants" onChange={(e) => kr.patch('kinetics', { arrData: e.target.value })} />
          </Field>
          <div className="kr-stack">
            <Field label="Plot">
              <select className="k-input" value={k.arrKind} aria-label="Plot" onChange={(e) => kr.patch('kinetics', { arrKind: e.target.value as 'arrhenius' | 'eyring' })}>
                <option value="arrhenius">Arrhenius: ln k against 1/T</option>
                <option value="eyring">Eyring: ln(k/T) against 1/T</option>
              </select>
            </Field>
            <Hint>{table.x.length} points read. At least three, with positive T and k.</Hint>
          </div>
        </div>
        {!valid && <Err>Enter at least three pairs (T, k) with T in kelvin and k above zero.</Err>}
        {ar && ey && !eyr && (
          <div className="kr-kv kr-kv-wide">
            <span>Activation energy Ea</span><b>{num(ar.Ea, kr.sig)} ± {num(ar.EaSE, 2)} kJ/mol</b>
            <span>Pre-exponential factor A</span><b>{num(ar.A, kr.sig)} (ln A = {num(ar.lnA, kr.sig)} ± {num(ar.lnASE, 2)})</b>
            <span>k at 298.15 K</span><b>{num(ar.k298, kr.sig)}</b>
            <span>R²</span><b>{ar.fit.r2.toFixed(5)}</b>
          </div>
        )}
        {ar && ey && eyr && (
          <div className="kr-kv kr-kv-wide">
            <span>Enthalpy of activation ΔH‡</span><b>{num(ey.dH, kr.sig)} ± {num(ey.dHSE, 2)} kJ/mol</b>
            <span>Entropy of activation ΔS‡</span><b>{num(ey.dS, kr.sig)} ± {num(ey.dSSE, 2)} J/(mol K)</b>
            <span>ΔG‡ at 298.15 K</span><b>{num(ey.dG298, kr.sig)} kJ/mol</b>
            <span>R²</span><b>{ey.fit.r2.toFixed(5)}</b>
          </div>
        )}
      </Card>
      <ChartCard title={eyr ? 'Eyring plot' : 'Arrhenius plot'} figure={fig} printFigure={print} height={300} name={eyr ? 'eyring' : 'arrhenius'} tool="Kinetics" pinText={text} empty="Enter the data first." />
    </>
  )
}

// ------------------------------------------------------------------ Michaelis–Menten

function MichaelisTab() {
  const kr = useKr()
  const pal = usePalette()
  const m = kr.ws.kinetics.mm
  const set = (p: Partial<typeof m>) => kr.patch('kinetics', { mm: { ...m, ...p } })
  const deb = useDebounced(m, 300)
  const parsed = useMemo(() => {
    const k1 = toNum(deb.k1), km1 = toNum(deb.km1), kcat = toNum(deb.kcat), e0 = toNum(deb.e0)
    const s0 = deb.s0.split(/[\s,;]+/).filter(Boolean).map(Number)
    if (![k1, km1, kcat, e0].every((x) => x > 0) || s0.length < 3 || !s0.every((x) => x > 0)) return null
    return { k1, km1, kcat, e0, s0 }
  }, [deb])
  const res = useMemo(() => (parsed ? michaelisMenten(parsed) : null), [parsed])
  const figs = useMemo(() => (res ? michaelisFigure(res, pal) : null), [res, pal])
  const printFigs = useMemo(() => (res ? michaelisFigure(res, PRINT_PALETTE) : null), [res])
  const text = res
    ? `Michaelis–Menten: KM = ${num(res.km, kr.sig)} mol/L, Vmax = ${num(res.vmax, kr.sig)} mol/(L s). Lineweaver–Burk fit: KM = ${num(res.lb.km, kr.sig)}, Vmax = ${num(res.lb.vmax, kr.sig)}, R² = ${res.lb.r2.toFixed(5)}`
    : ''
  return (
    <>
      <Card title="Enzyme E + S ⇌ ES → E + P" actions={text ? <ResultActions tool="kinetics" label="Michaelis–Menten" text={text} /> : undefined}>
        <div className="kr-grid">
          <Field label="k₁ (L mol⁻¹ s⁻¹)"><input className="k-input kr-num" value={m.k1} inputMode="decimal" onChange={(e) => set({ k1: e.target.value })} /></Field>
          <Field label="k₋₁ (s⁻¹)"><input className="k-input kr-num" value={m.km1} inputMode="decimal" onChange={(e) => set({ km1: e.target.value })} /></Field>
          <Field label="kcat (s⁻¹)"><input className="k-input kr-num" value={m.kcat} inputMode="decimal" onChange={(e) => set({ kcat: e.target.value })} /></Field>
          <Field label="[E]₀ (mol/L)"><input className="k-input kr-num" value={m.e0} inputMode="decimal" onChange={(e) => set({ e0: e.target.value })} /></Field>
        </div>
        <Field label="Substrate concentrations [S]₀ (mol/L)" hint="at least three, separated by commas">
          <input className="k-input kr-num" value={m.s0} onChange={(e) => set({ s0: e.target.value })} />
        </Field>
        {!res && <Err>All constants must be above zero and at least three substrate concentrations are needed.</Err>}
        {res && (
          <>
            <div className="kr-kv kr-kv-wide">
              <span>True KM = (k₋₁ + kcat)/k₁</span><b>{num(res.km, kr.sig)} mol/L</b>
              <span>True Vmax = kcat [E]₀</span><b>{num(res.vmax, kr.sig)} mol L⁻¹ s⁻¹</b>
              <span>Lineweaver–Burk: KM, Vmax</span><b>{num(res.lb.km, kr.sig)} mol/L, {num(res.lb.vmax, kr.sig)} mol L⁻¹ s⁻¹ (R² = {res.lb.r2.toFixed(5)})</b>
            </div>
            <table className="kr-table">
              <thead><tr><th>[S]₀</th><th>v₀ simulated</th><th>v₀ Michaelis–Menten</th></tr></thead>
              <tbody>{res.points.map((p) => <tr key={p.s0}><td>{num(p.s0, kr.sig)}</td><td>{num(p.v, kr.sig)}</td><td>{num(p.vTheory, kr.sig)}</td></tr>)}</tbody>
            </table>
            <Hint>Each velocity is the steady-state rate kcat[ES] of a simulation with the substrate held constant (initial-rate conditions).</Hint>
          </>
        )}
      </Card>
      {figs && printFigs && (
        <div className="kr-two">
          <ChartCard title="Saturation curve" figure={figs.saturation} printFigure={onWhite(printFigs.saturation)} height={260} name="michaelis-menten" tool="Kinetics" pinText={text} />
          <ChartCard title="Lineweaver–Burk plot" figure={figs.lineweaver} printFigure={onWhite(printFigs.lineweaver)} height={260} name="lineweaver-burk" tool="Kinetics" pinText={text} />
        </div>
      )}
    </>
  )
}
