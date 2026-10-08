// Gases: ideal gas law, combined gas law, density and molar mass, Dalton's partial pressures, van der Waals.

import { useMemo } from 'react'
import { Plus, Wind, X } from 'lucide-react'
import { fmt, molarMass, parseNum } from './chem'
import type { GasesForm } from './forms'
import {
  PRESSURE_UNITS, R_LBAR, TEMPERATURE_UNITS, VDW_GASES, VOLUME_UNITS, combinedGas, fromKelvin, gasDensity, idealGas, molarMassFromDensity,
  partialPressures, toKelvin, vdwMoles, vdwPressure, vdwTemperature, vdwVolume,
} from './gases'
import { Answer, Card, Err, Field, Fx, Hint, NumInput, ResultActions, Select, Tabs, WithUnit } from './ui'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
type Calc<T> = { ok: true; v: T } | { ok: false; message: string }
function calc<T>(f: () => T): Calc<T> {
  try {
    return { ok: true, v: f() }
  } catch (e) {
    return { ok: false, message: errText(e) }
  }
}

/** A number from a box: null when empty, throws when it is not a number. */
function opt(s: string, name: string): number | null {
  const v = parseNum(s)
  if (v !== null && Number.isNaN(v)) throw new Error(`${name} must be a number.`)
  return v
}

const PU = Object.keys(PRESSURE_UNITS)
const VU = Object.keys(VOLUME_UNITS)
const TU = [...TEMPERATURE_UNITS]

function Ideal({ f, set }: { f: GasesForm; set: (p: Partial<GasesForm>) => void }) {
  const g = f.ideal
  const upd = (p: Partial<GasesForm['ideal']>) => set({ ideal: { ...g, ...p } })
  const r = useMemo(
    () =>
      calc(() => {
        const P = opt(g.P, 'Pressure')
        const V = opt(g.V, 'Volume')
        const n = opt(g.n, 'Amount')
        const T = opt(g.T, 'Temperature')
        const res = idealGas({
          P: P === null ? null : P * PRESSURE_UNITS[g.Pu],
          V: V === null ? null : V * VOLUME_UNITS[g.Vu],
          n: n === null ? null : n,
          T: T === null ? null : toKelvin(T, g.Tu),
        })
        return {
          solved: res.solved,
          P: res.P / PRESSURE_UNITS[g.Pu],
          V: res.V / VOLUME_UNITS[g.Vu],
          n: res.n,
          T: fromKelvin(res.T, g.Tu),
          // the usual alternatives
          atm: res.P / 101325,
          litres: res.V * 1000,
          kelvin: res.T,
        }
      }),
    [g],
  )
  const text = r.ok ? `P = ${fmt(r.v.P)} ${g.Pu}, V = ${fmt(r.v.V)} ${g.Vu}, n = ${fmt(r.v.n)} mol, T = ${fmt(r.v.T)} ${g.Tu}  (solved ${r.v.solved})` : ''
  const names = { P: 'pressure', V: 'volume', n: 'amount', T: 'temperature' } as const
  return (
    <Card title="Ideal gas law: PV = nRT" icon={<Wind size={15} />} actions={<ResultActions tool="gases" label="Ideal gas" text={text} />}>
      <div className="kc-grid">
        <Field label="Pressure P"><WithUnit unit={<Select value={g.Pu} onChange={(Pu) => upd({ Pu })} options={PU} label="Pressure unit" />}><NumInput value={g.P} onChange={(P) => upd({ P })} placeholder="empty = find" label="Pressure" /></WithUnit></Field>
        <Field label="Volume V"><WithUnit unit={<Select value={g.Vu} onChange={(Vu) => upd({ Vu })} options={VU} label="Volume unit" />}><NumInput value={g.V} onChange={(V) => upd({ V })} placeholder="empty = find" label="Volume" /></WithUnit></Field>
        <Field label="Amount n"><WithUnit unit={<span className="kc-unit-fixed">mol</span>}><NumInput value={g.n} onChange={(n) => upd({ n })} placeholder="empty = find" label="Amount" /></WithUnit></Field>
        <Field label="Temperature T"><WithUnit unit={<Select value={g.Tu} onChange={(Tu) => upd({ Tu })} options={TU} label="Temperature unit" />}><NumInput value={g.T} onChange={(T) => upd({ T })} placeholder="empty = find" label="Temperature" /></WithUnit></Field>
      </div>
      {r.ok ? (
        <>
          <Answer>
            {names[r.v.solved].replace(/^./, (c) => c.toUpperCase())} ={' '}
            <b>{fmt(r.v[r.v.solved])} {r.v.solved === 'P' ? g.Pu : r.v.solved === 'V' ? g.Vu : r.v.solved === 'n' ? 'mol' : g.Tu}</b>
          </Answer>
          <div className="kc-kv">
            <span>P</span><b>{fmt(r.v.P)} {g.Pu} <span className="k-muted">({fmt(r.v.atm)} atm)</span></b>
            <span>V</span><b>{fmt(r.v.V)} {g.Vu} <span className="k-muted">({fmt(r.v.litres)} L)</span></b>
            <span>n</span><b>{fmt(r.v.n)} mol</b>
            <span>T</span><b>{fmt(r.v.T)} {g.Tu} <span className="k-muted">({fmt(r.v.kelvin)} K)</span></b>
          </div>
          <div className="kc-actions"><button className="k-btn small" onClick={() => upd({ [r.v.solved]: String(Number(r.v[r.v.solved].toPrecision(8))) })}>Put the result in its box</button></div>
        </>
      ) : <Err>{r.message}</Err>}
      <Hint>Leave exactly one box empty. R = 8.314 462 618 J/(mol·K). 1 mol at 273.15 K and 1 atm takes 22.414 L.</Hint>
    </Card>
  )
}

function Combined({ f, set }: { f: GasesForm; set: (p: Partial<GasesForm>) => void }) {
  const g = f.combined
  const upd = (p: Partial<GasesForm['combined']>) => set({ combined: { ...g, ...p } })
  const r = useMemo(
    () =>
      calc(() => {
        const T1 = opt(g.T1, 'T1')
        const T2 = opt(g.T2, 'T2')
        const res = combinedGas({
          P1: opt(g.P1, 'P1'), V1: opt(g.V1, 'V1'), T1: T1 === null ? null : toKelvin(T1, g.Tu),
          P2: opt(g.P2, 'P2'), V2: opt(g.V2, 'V2'), T2: T2 === null ? null : toKelvin(T2, g.Tu),
        })
        return { ...res, T1: fromKelvin(res.T1 as number, g.Tu), T2: fromKelvin(res.T2 as number, g.Tu) }
      }),
    [g],
  )
  const text = r.ok ? `P1 ${fmt(r.v.P1 as number)} ${g.Pu}, V1 ${fmt(r.v.V1 as number)} ${g.Vu}, T1 ${fmt(r.v.T1)} ${g.Tu} → P2 ${fmt(r.v.P2 as number)}, V2 ${fmt(r.v.V2 as number)}, T2 ${fmt(r.v.T2)}` : ''
  const key = (k: 'P1' | 'V1' | 'T1' | 'P2' | 'V2' | 'T2') => (
    <NumInput value={g[k]} onChange={(v) => upd({ [k]: v })} placeholder="empty = find" label={k} />
  )
  return (
    <Card title="Combined gas law: P₁V₁/T₁ = P₂V₂/T₂" actions={<ResultActions tool="gases" slot="combined" label="Combined gas law" text={text} />}>
      <div className="kc-grid kc-three">
        <Field label="Pressure unit"><Select value={g.Pu} onChange={(Pu) => upd({ Pu })} options={PU} label="Pressure unit" /></Field>
        <Field label="Volume unit"><Select value={g.Vu} onChange={(Vu) => upd({ Vu })} options={VU} label="Volume unit" /></Field>
        <Field label="Temperature unit"><Select value={g.Tu} onChange={(Tu) => upd({ Tu })} options={TU} label="Temperature unit" /></Field>
      </div>
      <div className="kc-grid kc-three">
        <Field label="P₁">{key('P1')}</Field><Field label="V₁">{key('V1')}</Field><Field label="T₁">{key('T1')}</Field>
        <Field label="P₂">{key('P2')}</Field><Field label="V₂">{key('V2')}</Field><Field label="T₂">{key('T2')}</Field>
      </div>
      {r.ok ? (
        <Answer>
          {r.v.solved} = <b>{fmt(r.v[r.v.solved] as number)} {r.v.solved.startsWith('P') ? g.Pu : r.v.solved.startsWith('V') ? g.Vu : g.Tu}</b>
        </Answer>
      ) : <Err>{r.message}</Err>}
      <Hint>Same amount of gas in both states. Temperatures are converted to kelvin for you; pressure and volume only need the same unit on both sides.</Hint>
    </Card>
  )
}

function Density({ f, set }: { f: GasesForm; set: (p: Partial<GasesForm>) => void }) {
  const g = f.density
  const upd = (p: Partial<GasesForm['density']>) => set({ density: { ...g, ...p } })
  const r = useMemo(
    () =>
      calc(() => {
        const P = opt(g.P, 'Pressure')
        const T = opt(g.T, 'Temperature')
        if (P === null || T === null) throw new Error('Type the pressure and the temperature.')
        const Pa = P * PRESSURE_UNITS[g.Pu]
        const K = toKelvin(T, g.Tu)
        const d = opt(g.density, 'Density')
        if (d !== null) return { mode: 'M' as const, M: molarMassFromDensity(Pa, K, d), d }
        const M = molarMass(g.formula)
        return { mode: 'd' as const, M, d: gasDensity(Pa, K, M) }
      }),
    [g],
  )
  const text = r.ok ? `${r.v.mode === 'd' ? g.formula.trim() : 'gas'}: M = ${fmt(r.v.M)} g/mol, density ${fmt(r.v.d)} g/L at ${g.P} ${g.Pu}, ${g.T} ${g.Tu}` : ''
  return (
    <Card title="Gas density and molar mass" actions={<ResultActions tool="gases" slot="density" label="Gas density" text={text} />}>
      <div className="kc-grid">
        <Field label="Gas (formula)"><input className="k-input kc-mono" value={g.formula} onChange={(e) => upd({ formula: e.target.value })} spellCheck={false} aria-label="Gas formula" /></Field>
        <Field label="Pressure"><WithUnit unit={<Select value={g.Pu} onChange={(Pu) => upd({ Pu })} options={PU} label="Pressure unit" />}><NumInput value={g.P} onChange={(P) => upd({ P })} label="Pressure" /></WithUnit></Field>
        <Field label="Temperature"><WithUnit unit={<Select value={g.Tu} onChange={(Tu) => upd({ Tu })} options={TU} label="Temperature unit" />}><NumInput value={g.T} onChange={(T) => upd({ T })} label="Temperature" /></WithUnit></Field>
        <Field label="Density (g/L)" hint="fill it to find the molar mass instead"><NumInput value={g.density} onChange={(density) => upd({ density })} placeholder="empty = find" label="Density" /></Field>
      </div>
      {r.ok ? (
        r.v.mode === 'd' ? (
          <Answer>Density of <Fx f={g.formula} /> = <b>{fmt(r.v.d)} g/L</b> <span className="k-muted">(M = {fmt(r.v.M)} g/mol)</span></Answer>
        ) : (
          <Answer>Molar mass = <b>{fmt(r.v.M)} g/mol</b> <span className="k-muted">(from {fmt(r.v.d)} g/L)</span></Answer>
        )
      ) : <Err>{r.message}</Err>}
      <Hint>ρ = P·M / (R·T), for an ideal gas.</Hint>
    </Card>
  )
}

function Dalton({ f, set }: { f: GasesForm; set: (p: Partial<GasesForm>) => void }) {
  const g = f.dalton
  const upd = (p: Partial<GasesForm['dalton']>) => set({ dalton: { ...g, ...p } })
  const r = useMemo(
    () =>
      calc(() => {
        const total = opt(g.total, 'The total pressure')
        if (total === null) throw new Error('Type the total pressure.')
        const rows = g.rows.filter((x) => x.label.trim() !== '' || x.moles.trim() !== '').map((x) => {
          const n = opt(x.moles, `The amount of ${x.label || 'each gas'}`)
          if (n === null || n < 0) throw new Error(`Type the amount of ${x.label || 'each gas'} (moles, zero or more).`)
          return { label: x.label.trim() || '?', moles: n }
        })
        return partialPressures(rows, total * PRESSURE_UNITS[g.Pu])
      }),
    [g],
  )
  const text = r.ok ? `Total ${g.total} ${g.Pu}\n` + r.v.map((p) => `${p.label}: x = ${fmt(p.fraction)}, P = ${fmt(p.pressure / PRESSURE_UNITS[g.Pu])} ${g.Pu}`).join('\n') : ''
  return (
    <Card title="Partial pressures (Dalton)" actions={<ResultActions tool="gases" slot="dalton" label="Partial pressures" text={text} />}>
      <div className="kc-grid">
        <Field label="Total pressure"><WithUnit unit={<Select value={g.Pu} onChange={(Pu) => upd({ Pu })} options={PU} label="Pressure unit" />}><NumInput value={g.total} onChange={(total) => upd({ total })} label="Total pressure" /></WithUnit></Field>
      </div>
      <div className="kc-emprows">
        {g.rows.map((row, i) => (
          <div key={i} className="kc-emprow">
            <input className="k-input kc-el kc-mono" value={row.label} aria-label={`Gas ${i + 1}`} spellCheck={false} placeholder="N2" onChange={(e) => upd({ rows: g.rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            <NumInput value={row.moles} onChange={(moles) => upd({ rows: g.rows.map((x, j) => (j === i ? { ...x, moles } : x)) })} label={`Moles of gas ${i + 1}`} placeholder="mol" />
            <button className="k-icon-btn" aria-label="Remove this gas" onClick={() => upd({ rows: g.rows.filter((_, j) => j !== i) })}><X size={14} /></button>
          </div>
        ))}
        <button className="k-btn small kc-addrow" onClick={() => upd({ rows: [...g.rows, { label: '', moles: '' }] })}><Plus size={13} /> Gas</button>
      </div>
      {r.ok ? (
        <table className="kc-table">
          <thead><tr><th>gas</th><th>moles</th><th>mole fraction</th><th>partial pressure ({g.Pu})</th></tr></thead>
          <tbody>
            {r.v.map((p, i) => <tr key={i}><td><Fx f={p.label} /></td><td>{fmt(p.moles)}</td><td>{fmt(p.fraction)}</td><td><b>{fmt(p.pressure / PRESSURE_UNITS[g.Pu])}</b></td></tr>)}
          </tbody>
        </table>
      ) : <Err>{r.message}</Err>}
      <Hint>Pᵢ = xᵢ · P_total, with xᵢ the mole fraction of gas i. The amounts can be in any common unit as long as it is the same for all gases.</Hint>
    </Card>
  )
}

function Vdw({ f, set }: { f: GasesForm; set: (p: Partial<GasesForm>) => void }) {
  const g = f.vdw
  const upd = (p: Partial<GasesForm['vdw']>) => set({ vdw: { ...g, ...p } })
  const gas = VDW_GASES.find((x) => x.formula === g.gas) ?? VDW_GASES[0]
  const r = useMemo(
    () =>
      calc(() => {
        const P = opt(g.P, 'P')
        const V = opt(g.V, 'V')
        const n = opt(g.n, 'n')
        const T = opt(g.T, 'T')
        const empty = [P, V, n, T].filter((x) => x === null).length
        if (empty !== 1) throw new Error('Leave exactly one of P, V, n, T empty: that is the one to find.')
        if ([P, V, n, T].some((x) => x !== null && !(x > 0))) throw new Error('Values must be above zero.')
        let solved: 'P' | 'V' | 'n' | 'T'
        let real: number
        let ideal: number
        if (P === null) {
          solved = 'P'; real = vdwPressure(gas, n as number, V as number, T as number); ideal = ((n as number) * R_LBAR * (T as number)) / (V as number)
        } else if (V === null) {
          solved = 'V'; real = vdwVolume(gas, n as number, P, T as number); ideal = ((n as number) * R_LBAR * (T as number)) / P
        } else if (n === null) {
          solved = 'n'; real = vdwMoles(gas, P, V, T as number); ideal = (P * V) / (R_LBAR * (T as number))
        } else {
          solved = 'T'; real = vdwTemperature(gas, n, V, P); ideal = (P * V) / (n * R_LBAR)
        }
        return { solved, real, ideal }
      }),
    [g, gas],
  )
  const unit = { P: 'bar', V: 'L', n: 'mol', T: 'K' } as const
  const text = r.ok ? `${gas.name} (van der Waals): ${r.v.solved} = ${fmt(r.v.real)} ${unit[r.v.solved]} (ideal gas: ${fmt(r.v.ideal)})` : ''
  return (
    <Card title="Real gas: van der Waals" actions={<ResultActions tool="gases" slot="vdw" label="van der Waals" text={text} />}>
      <div className="kc-grid">
        <Field label="Gas"><Select value={g.gas} onChange={(gasId) => upd({ gas: gasId })} label="Gas" options={VDW_GASES.map((x) => ({ id: x.formula, label: `${x.name} (${x.formula})` }))} /></Field>
        <Field label="P (bar)"><NumInput value={g.P} onChange={(P) => upd({ P })} placeholder="empty = find" label="Pressure" /></Field>
        <Field label="V (L)"><NumInput value={g.V} onChange={(V) => upd({ V })} placeholder="empty = find" label="Volume" /></Field>
        <Field label="n (mol)"><NumInput value={g.n} onChange={(n) => upd({ n })} placeholder="empty = find" label="Amount" /></Field>
        <Field label="T (K)"><NumInput value={g.T} onChange={(T) => upd({ T })} placeholder="empty = find" label="Temperature" /></Field>
      </div>
      {r.ok ? (
        <>
          <Answer>{r.v.solved} = <b>{fmt(r.v.real)} {unit[r.v.solved]}</b> <span className="k-muted">· ideal gas {fmt(r.v.ideal)} ({fmt((100 * (r.v.real - r.v.ideal)) / r.v.ideal)} %)</span></Answer>
        </>
      ) : <Err>{r.message}</Err>}
      <Hint>(P + a·n²/V²)(V − n·b) = n·R·T with a = {gas.a} L²·bar/mol² and b = {gas.b} L/mol. Units here are bar, litre and kelvin. Expect deviations at high pressure and low temperature.</Hint>
    </Card>
  )
}

export function GasesTool({ f, set }: { f: GasesForm; set: (p: Partial<GasesForm>) => void }) {
  return (
    <div className="kc-tool-body">
      <Tabs
        value={f.sub}
        onChange={(sub) => set({ sub })}
        tabs={[{ id: 'ideal', label: 'Ideal gas' }, { id: 'combined', label: 'Combined law' }, { id: 'density', label: 'Density / molar mass' }, { id: 'dalton', label: 'Partial pressures' }, { id: 'vdw', label: 'van der Waals' }]}
      />
      {f.sub === 'ideal' && <Ideal f={f} set={set} />}
      {f.sub === 'combined' && <Combined f={f} set={set} />}
      {f.sub === 'density' && <Density f={f} set={set} />}
      {f.sub === 'dalton' && <Dalton f={f} set={set} />}
      {f.sub === 'vdw' && <Vdw f={f} set={set} />}
    </div>
  )
}
