// Energy & equilibrium: the energy-profile designer (catalysed overlay, Hammond), a thermodynamics calculator
// (ΔG, K, van 't Hoff, Kp/Kc) and an ICE-table equilibrium solver with Le Chatelier disturbances.

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { ChartCard } from './ChartCard'
import {
  dGFromK, kcToKp, kpToKc, leChatelier, parseEquilibrium, solveIce, thermo, vantHoffK2, type Disturbance, type IceResult, type ParsedEquilibrium, type Shift,
} from './equilibrium'
import { gibbsFigure, iceFigure, onWhite, PRINT_PALETTE, profileFigure } from './figures'
import { num } from './formula'
import { LIBRARY } from './library'
import { usePalette } from './PlotlyChart'
import { analyse, catalysed, normalise, profileFromMechanism, rateEnhancement, simpleProfile, type Profile } from './profile'
import { Card, Err, Field, Hint, ResultActions, Tabs, toNum, useKr } from './ui'
import type { EnergyTab } from './workspace'

const TABS: { id: EnergyTab; label: string }[] = [
  { id: 'profile', label: 'Energy profile' },
  { id: 'thermo', label: 'Thermodynamics' },
  { id: 'equilibrium', label: 'Equilibrium (ICE)' },
]

export function EnergyTool() {
  const kr = useKr()
  const e = kr.ws.energy
  return (
    <div className="kr-tool-body">
      <Tabs value={e.tab} onChange={(tab) => kr.patch('energy', { tab })} tabs={TABS} />
      {e.tab === 'profile' && <ProfileTab />}
      {e.tab === 'thermo' && <ThermoTab />}
      {e.tab === 'equilibrium' && <EquilibriumTab />}
    </div>
  )
}

// ------------------------------------------------------------------ profile

const PROFILE_SOURCES = LIBRARY.filter((r) => r.mechanism || (r.dH !== undefined && r.ea !== undefined))

/** The energy profile of a library reaction: its mechanism, or one barrier from ΔH and Ea. */
export function profileOfReaction(id: string): Profile | null {
  const r = LIBRARY.find((x) => x.id === id)
  if (!r) return null
  if (r.mechanism) return profileFromMechanism(r.mechanism)
  if (r.dH !== undefined && r.ea !== undefined) return simpleProfile(r.dH, r.ea)
  return null
}

function ProfileTab() {
  const kr = useKr()
  const pal = usePalette()
  const e = kr.ws.energy
  const p = e.profile
  const info = useMemo(() => analyse(p), [p])
  const lower = toNum(e.lower)
  const cat = useMemo(() => (e.showCatalysed && lower > 0 ? catalysed(p, lower) : null), [p, e.showCatalysed, lower])
  const catInfo = useMemo(() => (cat ? analyse(cat) : null), [cat])
  const fig = useMemo(() => profileFigure({ profile: p, overlay: cat }, pal), [p, cat, pal])
  const print = useMemo(() => onWhite(profileFigure({ profile: p, overlay: cat }, PRINT_PALETTE)), [p, cat])
  const speedup = info.valid && catInfo ? rateEnhancement(info.eaOverall, catInfo.eaOverall, 298.15) : null

  const setPoints = (pts: { label: string; energy: number }[]) => kr.patch('energy', { profile: normalise(pts), source: '' })
  const setPoint = (i: number, patch: Partial<{ label: string; energy: number }>) => setPoints(p.points.map((q, k) => (k === i ? { ...q, ...patch } : q)))
  const addStep = () => {
    // [R, TS, P] → [R, TS, intermediate, TS, P]
    const pts = p.points.map((q) => ({ label: q.label, energy: q.energy }))
    const last = pts.pop()!
    const ts = pts[pts.length - 1]
    const before = pts[pts.length - 2]
    const inter = Math.min(ts.energy - 20, (before.energy + last.energy) / 2)
    setPoints([...pts, { label: 'Intermediate', energy: inter }, { label: 'TS', energy: Math.max(inter, last.energy) + 40 }, last])
  }
  const removeStep = () => {
    if (p.points.length <= 3) return
    const pts = p.points.map((q) => ({ label: q.label, energy: q.energy }))
    const last = pts.pop()!
    pts.pop()
    pts.pop()
    setPoints([...pts, last])
  }

  const text = useMemo(() => {
    if (!info.valid) return ''
    const lines = [
      `Energy profile (kJ/mol): ${p.points.map((q) => `${q.label} ${q.energy}`).join(' → ')}`,
      `ΔH = ${num(info.dH, kr.sig)}; Ea (forward) = ${num(info.eaOverall, kr.sig)}; Ea (reverse) = ${num(info.eaReverse, kr.sig)}; rate-determining step: ${info.steps[info.rds].from} → ${info.steps[info.rds].to}`,
    ]
    if (catInfo && speedup !== null) lines.push(`Catalysed: Ea = ${num(catInfo.eaOverall, kr.sig)}; rate ×${num(speedup, 3)} at 298 K; ΔH unchanged`)
    return lines.join('\n')
  }, [info, p, catInfo, speedup, kr.sig])

  return (
    <>
      <Card title="Design a profile" actions={text ? <ResultActions tool="energy" label="Energy profile" text={text} /> : undefined}>
        <div className="kr-arrowrow">
          <Field label="Start from a library reaction">
            <select
              className="k-input"
              value={e.source}
              aria-label="Library reaction"
              onChange={(ev) => {
                const prof = profileOfReaction(ev.target.value)
                if (prof) kr.patch('energy', { profile: prof, source: ev.target.value })
              }}
            >
              <option value="">— custom —</option>
              {PROFILE_SOURCES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <label className="kr-check"><input type="checkbox" checked={e.showCatalysed} onChange={(ev) => kr.patch('energy', { showCatalysed: ev.target.checked })} /> Show a catalysed pathway</label>
          <Field label="Barrier lowered by (kJ/mol)">
            <input className="k-input kr-num" value={e.lower} inputMode="decimal" aria-label="Barrier lowered by" onChange={(ev) => kr.patch('energy', { lower: ev.target.value })} />
          </Field>
        </div>
        <table className="kr-table kr-points">
          <thead><tr><th>Point</th><th>Name</th><th>Energy (kJ/mol)</th></tr></thead>
          <tbody>
            {p.points.map((q, i) => (
              <tr key={i}>
                <td className="k-muted">{q.kind === 'ts' ? 'transition state' : q.kind === 'reactant' ? 'reactants' : q.kind === 'product' ? 'products' : 'intermediate'}</td>
                <td><input className="k-input" value={q.label} aria-label={`Name of point ${i + 1}`} onChange={(ev) => setPoint(i, { label: ev.target.value })} /></td>
                <td><input className="k-input kr-num" type="number" step="5" value={q.energy} aria-label={`Energy of point ${i + 1}`} onChange={(ev) => Number.isFinite(ev.target.valueAsNumber) && setPoint(i, { energy: ev.target.valueAsNumber })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="kr-actions">
          <button className="k-btn small" onClick={addStep}><Plus size={13} /> Add a step</button>
          <button className="k-btn small" onClick={removeStep} disabled={p.points.length <= 3}><Trash2 size={13} /> Remove last step</button>
        </div>
        {!info.valid && <Err>{info.message}</Err>}
      </Card>

      <ChartCard title="Energy profile" figure={fig} printFigure={print} height={320} name="energy-profile" tool="Energy" pinText={text}>
        {info.valid && (
          <div className="kr-kv kr-kv-wide">
            <span>Reaction enthalpy ΔH</span><b>{num(info.dH, kr.sig)} kJ/mol ({info.dH < 0 ? 'exothermic' : info.dH > 0 ? 'endothermic' : 'thermoneutral'})</b>
            <span>Activation energy, forward / reverse</span><b>{num(info.eaOverall, kr.sig)} / {num(info.eaReverse, kr.sig)} kJ/mol</b>
            <span>Rate-determining step</span><b>{info.steps[info.rds].from} → {info.steps[info.rds].to}</b>
            {info.steps.length > 1 && <><span>Energetic span</span><b>{num(info.span, kr.sig)} kJ/mol</b></>}
            {catInfo && speedup !== null && <><span>With the catalyst</span><b>Ea {num(catInfo.eaOverall, kr.sig)} kJ/mol, about ×{num(speedup, 3)} faster at 298 K; ΔH and K are unchanged</b></>}
          </div>
        )}
      </ChartCard>

      {info.valid && (
        <Card title="Step by step">
          <table className="kr-table">
            <thead><tr><th>Step</th><th>Ea forward</th><th>Ea reverse</th><th>ΔE</th></tr></thead>
            <tbody>
              {info.steps.map((s, i) => (
                <tr key={i} className={i === info.rds ? 'kr-best' : ''}>
                  <td>{s.from} → {s.to}</td><td>{num(s.eaF, kr.sig)}</td><td>{num(s.eaR, kr.sig)}</td><td>{num(s.dE, kr.sig)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="kr-small k-muted">
            {info.steps.map((s, i) => <div key={i}>{info.steps.length > 1 ? `Step ${i + 1}: ` : ''}{s.hammond}</div>)}
          </div>
        </Card>
      )}
    </>
  )
}

// ------------------------------------------------------------------ thermodynamics

function ThermoTab() {
  const kr = useKr()
  const pal = usePalette()
  const t = kr.ws.energy.thermo
  const set = (p: Partial<typeof t>) => kr.patch('energy', { thermo: { ...t, ...p } })
  const dH = toNum(t.dH), dS = toNum(t.dS), T = toNum(t.T)
  const th = useMemo(() => (Number.isFinite(dH) && Number.isFinite(dS) && T > 0 ? thermo(dH, dS, T) : null), [dH, dS, T])
  const T2 = toNum(t.T2)
  const dHvh = toNum(t.dHvh)
  const K1 = toNum(t.K1)
  const vh = useMemo(() => (K1 > 0 && T > 0 && T2 > 0 && Number.isFinite(dHvh) ? vantHoffK2(K1, T, T2, dHvh) : null), [K1, T, T2, dHvh])
  const fig = useMemo(() => (th ? gibbsFigure(dH, dS, T, pal) : null), [th, dH, dS, T, pal])
  const print = useMemo(() => (th ? onWhite(gibbsFigure(dH, dS, T, PRINT_PALETTE)) : null), [th, dH, dS, T])
  const text = th ? `ΔH = ${dH} kJ/mol, ΔS = ${dS} J/(mol K), T = ${T} K\nΔG = ${num(th.dG, kr.sig)} kJ/mol, K = ${num(th.K, kr.sig)}\n${th.verdict}` : ''

  // Kp ⇄ Kc
  const [kcText, setKcText] = useState('0.0059')
  const [dn, setDn] = useState('1')
  const [unit, setUnit] = useState<'atm' | 'bar'>('atm')
  const [from, setFrom] = useState<'Kc' | 'Kp'>('Kc')
  const kIn = toNum(kcText), dnN = toNum(dn)
  const conv = kIn > 0 && T > 0 && Number.isFinite(dnN) ? (from === 'Kc' ? kcToKp(kIn, T, dnN, unit) : kpToKc(kIn, T, dnN, unit)) : null

  return (
    <>
      <Card title="ΔG = ΔH − TΔS" actions={text ? <ResultActions tool="energy" label="Thermodynamics" text={text} /> : undefined}>
        <div className="kr-grid">
          <Field label="ΔH° (kJ/mol)"><input className="k-input kr-num" value={t.dH} inputMode="decimal" onChange={(e) => set({ dH: e.target.value })} /></Field>
          <Field label="ΔS° (J/(mol K))"><input className="k-input kr-num" value={t.dS} inputMode="decimal" onChange={(e) => set({ dS: e.target.value })} /></Field>
          <Field label="T (K)"><input className="k-input kr-num" value={t.T} inputMode="decimal" onChange={(e) => set({ T: e.target.value })} /></Field>
        </div>
        {!th && <Err>Enter ΔH, ΔS and a temperature above 0 K.</Err>}
        {th && (
          <div className="kr-answer">
            ΔG° = <b>{num(th.dG, kr.sig)} kJ/mol</b> · K = <b>{num(th.K, kr.sig)}</b> · ln K = {num(th.lnK, kr.sig)}
            <div className="kr-small">{th.verdict}</div>
          </div>
        )}
        <div className="kr-small k-muted">K = exp(−ΔG°/RT). At K = 1, ΔG° = {num(dGFromK(1, T > 0 ? T : 298), 3)}; K = 10 at {T > 0 ? T : 298} K corresponds to ΔG° = {num(dGFromK(10, T > 0 ? T : 298), 4)} kJ/mol.</div>
      </Card>
      <ChartCard title="ΔG° against temperature" figure={fig} printFigure={print} height={250} name="gibbs" tool="Energy" pinText={text} empty="Enter ΔH, ΔS and T first." />
      <Card title="van 't Hoff: K at another temperature">
        <div className="kr-grid">
          <Field label="K at T (above)"><input className="k-input kr-num" value={t.K1} inputMode="decimal" onChange={(e) => set({ K1: e.target.value })} /></Field>
          <Field label="ΔH° (kJ/mol, taken constant)"><input className="k-input kr-num" value={t.dHvh} inputMode="decimal" onChange={(e) => set({ dHvh: e.target.value })} /></Field>
          <Field label="New temperature (K)"><input className="k-input kr-num" value={t.T2} inputMode="decimal" onChange={(e) => set({ T2: e.target.value })} /></Field>
        </div>
        {vh !== null ? (
          <div className="kr-answer">
            K({T2} K) = <b>{num(vh, kr.sig)}</b> · ΔG° = {num(dGFromK(vh, T2), kr.sig)} kJ/mol
            <div className="kr-small">{dHvh < 0 ? 'Exothermic: K falls as the temperature rises.' : dHvh > 0 ? 'Endothermic: K rises with the temperature.' : 'ΔH = 0: K does not depend on temperature.'}</div>
          </div>
        ) : <Err>Enter K, ΔH, and both temperatures.</Err>}
        <Hint>ln(K₂/K₁) = −(ΔH°/R)(1/T₂ − 1/T₁)</Hint>
      </Card>
      <Card title="Kp ⇄ Kc">
        <div className="kr-grid">
          <Field label="Convert from">
            <select className="k-input" value={from} onChange={(e) => setFrom(e.target.value as 'Kc' | 'Kp')}><option value="Kc">Kc (mol/L) to Kp</option><option value="Kp">Kp to Kc</option></select>
          </Field>
          <Field label={from}><input className="k-input kr-num" value={kcText} inputMode="decimal" onChange={(e) => setKcText(e.target.value)} /></Field>
          <Field label="Δn (gas moles, products − reactants)"><input className="k-input kr-num" value={dn} inputMode="decimal" onChange={(e) => setDn(e.target.value)} /></Field>
          <Field label="Pressure unit">
            <select className="k-input" value={unit} onChange={(e) => setUnit(e.target.value as 'atm' | 'bar')}><option value="atm">atm</option><option value="bar">bar</option></select>
          </Field>
        </div>
        {conv !== null ? <div className="kr-answer">{from === 'Kc' ? 'Kp' : 'Kc'} = <b>{num(conv, kr.sig)}</b> at {T} K <span className="k-muted kr-small">(Kp = Kc (RT)^Δn, R in L {unit} mol⁻¹ K⁻¹)</span></div> : <Err>Enter K, Δn and the temperature above.</Err>}
      </Card>
    </>
  )
}

// ------------------------------------------------------------------ equilibrium

function IceTable({ r, sig }: { r: IceResult; sig: number }) {
  return (
    <table className="kr-table kr-ice">
      <thead><tr><th></th>{r.rows.map((x) => <th key={x.name}>{x.name}{!x.active ? ' (pure)' : ''}</th>)}</tr></thead>
      <tbody>
        <tr><th>Initial</th>{r.rows.map((x) => <td key={x.name}>{num(x.initial, sig)}</td>)}</tr>
        <tr><th>Change</th>{r.rows.map((x) => <td key={x.name}>{x.change >= 0 ? '+' : '−'}{num(Math.abs(x.change), sig)}</td>)}</tr>
        <tr className="kr-best"><th>Equilibrium</th>{r.rows.map((x) => <td key={x.name}>{num(x.equilibrium, sig)}</td>)}</tr>
      </tbody>
    </table>
  )
}

function EquilibriumTab() {
  const kr = useKr()
  const pal = usePalette()
  const ic = kr.ws.energy.ice
  const set = (p: Partial<typeof ic>) => kr.patch('energy', { ice: { ...ic, ...p } })
  const K = toNum(ic.K)
  const T = toNum(ic.T)
  const parsed = useMemo((): { p: ParsedEquilibrium | null; error: string } => {
    try {
      return { p: parseEquilibrium(ic.equation, ic.initial), error: '' }
    } catch (e) {
      return { p: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [ic.equation, ic.initial])
  const res = useMemo(() => (parsed.p && K > 0 ? solveIce(parsed.p.species, K) : null), [parsed, K])
  const [shift, setShift] = useState<{ label: string; s: Shift } | null>(null)
  const names = parsed.p?.species.map((s) => s.name) ?? []

  const disturb = (label: string, d: Disturbance) => {
    if (!parsed.p || !res || !res.ok) return
    try {
      setShift({ label, s: leChatelier(parsed.p.species, K, res, d) })
    } catch (e) {
      kr.say(e instanceof Error ? e.message : String(e))
    }
  }

  const fig = useMemo(() => (res?.ok ? iceFigure(res.rows, pal) : null), [res, pal])
  const print = useMemo(() => (res?.ok ? onWhite(iceFigure(res.rows, PRINT_PALETTE)) : null), [res])
  const dn = parsed.p?.dnGas ?? 0
  const text = res?.ok && parsed.p
    ? [
      `${parsed.p.text}   ${ic.mode} = ${ic.K}`,
      ...res.rows.map((r) => `${r.name}: ${num(r.initial, kr.sig)} → ${num(r.equilibrium, kr.sig)}`),
      `Q₀ = ${num(res.Q0, kr.sig)} ${res.Q0 < K ? '<' : res.Q0 > K ? '>' : '='} K: the reaction goes ${res.direction === 'equilibrium' ? 'nowhere (at equilibrium)' : res.direction === 'forward' ? 'forward' : 'in reverse'}`,
      ...(res.conversion !== null ? [`conversion of the limiting reactant: ${num(res.conversion * 100, 3)} %`] : []),
    ].join('\n')
    : ''

  return (
    <>
      <Card title="ICE table" actions={text ? <ResultActions tool="energy" label="Equilibrium" text={text} /> : undefined}>
        <div className="kr-arrowrow">
          <Field label="Reaction" hint="(s) and (l) species are left out of Q">
            <input className="k-input kr-mono" value={ic.equation} spellCheck={false} aria-label="Reaction" onChange={(e) => set({ equation: e.target.value })} />
          </Field>
          <Field label="Initial amounts" hint="concentrations (mol/L) or partial pressures; missing = 0">
            <input className="k-input kr-mono" value={ic.initial} spellCheck={false} aria-label="Initial amounts" onChange={(e) => set({ initial: e.target.value })} />
          </Field>
        </div>
        <div className="kr-arrowrow">
          <Field label="Equilibrium constant">
            <input className="k-input kr-num" value={ic.K} inputMode="decimal" aria-label="K" onChange={(e) => set({ K: e.target.value })} />
          </Field>
          <Field label="K is">
            <select className="k-input" value={ic.mode} onChange={(e) => set({ mode: e.target.value as 'Kc' | 'Kp' })}><option value="Kc">Kc (concentrations)</option><option value="Kp">Kp (partial pressures)</option></select>
          </Field>
          <Field label="T (K, for Kp ⇄ Kc)">
            <input className="k-input kr-num" value={ic.T} inputMode="decimal" onChange={(e) => set({ T: e.target.value })} />
          </Field>
        </div>
        {parsed.error && <Err>{parsed.error}</Err>}
        {!parsed.error && !(K > 0) && <Err>K must be a positive number.</Err>}
        {res && !res.ok && <Err>{res.message}</Err>}
        {res?.ok && (
          <>
            <IceTable r={res} sig={kr.sig} />
            <div className="kr-answer">
              Q₀ = <b>{num(res.Q0, kr.sig)}</b> {res.Q0 < K ? '<' : res.Q0 > K ? '>' : '='} K = {num(K, kr.sig)}:{' '}
              {res.direction === 'equilibrium' ? 'the mixture is already at equilibrium.' : res.direction === 'forward' ? 'the reaction proceeds forward (towards the products).' : 'the reaction proceeds in reverse (towards the reactants).'}
              <div className="kr-small">
                Extent ξ = {num(res.extent, kr.sig)}; Q at equilibrium = {num(res.Q, kr.sig)}.
                {res.conversion !== null && ` The limiting species is ${num(res.conversion * 100, 3)} % converted.`}
                {Number.isFinite(T) && T > 0 && dn !== 0 && K > 0 && ` With Δn(gas) = ${dn}: ${ic.mode === 'Kc' ? `Kp = ${num(kcToKp(K, T, dn), kr.sig)} atm^${dn}` : `Kc = ${num(kpToKc(K, T, dn), kr.sig)}`} at ${T} K.`}
              </div>
            </div>
          </>
        )}
      </Card>
      {res?.ok && <ChartCard title="Initial and equilibrium amounts" figure={fig} printFigure={print} height={240} name="ice" tool="Energy" pinText={text} />}
      {res?.ok && parsed.p && (
        <Card title="Le Chatelier: disturb the equilibrium">
          <div className="kr-arrowrow">
            <Field label="Add (or remove with −) an amount of">
              <div className="kr-withunit">
                <select className="k-input" value={ic.addSpecies} onChange={(e) => set({ addSpecies: e.target.value })}>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select>
                <input className="k-input kr-num" value={ic.add} inputMode="decimal" aria-label="Amount" onChange={(e) => set({ add: e.target.value })} />
                <button className="k-btn small" onClick={() => disturb(`Add ${ic.add} ${ic.addSpecies}`, { kind: 'add', species: names.includes(ic.addSpecies) ? ic.addSpecies : names[0], amount: toNum(ic.add) })}>Apply</button>
              </div>
            </Field>
            <Field label="Change the volume to this fraction">
              <div className="kr-withunit">
                <input className="k-input kr-num" value={ic.volume} inputMode="decimal" aria-label="Volume factor" onChange={(e) => set({ volume: e.target.value })} />
                <button className="k-btn small" onClick={() => disturb(`Volume ×${ic.volume}`, { kind: 'volume', factor: toNum(ic.volume) })}>Apply</button>
              </div>
            </Field>
            <Field label="Heat or cool to (K), with ΔH (kJ/mol)">
              <div className="kr-withunit">
                <input className="k-input kr-num" value={ic.T2} inputMode="decimal" aria-label="New temperature" onChange={(e) => set({ T2: e.target.value })} />
                <input className="k-input kr-num" value={ic.dH} inputMode="decimal" aria-label="Reaction enthalpy" onChange={(e) => set({ dH: e.target.value })} />
                <button className="k-btn small" onClick={() => disturb(`T = ${ic.T2} K`, { kind: 'temperature', T1: T, T2: toNum(ic.T2), dH: toNum(ic.dH) })}>Apply</button>
              </div>
            </Field>
          </div>
          {shift && (
            <div className="kr-answer">
              <b>{shift.label}.</b> {shift.s.explanation}
              {shift.s.result.ok && <IceTable r={shift.s.result} sig={kr.sig} />}
            </div>
          )}
        </Card>
      )}
    </>
  )
}
