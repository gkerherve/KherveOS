// The Units & constants tab: a converter (any unit expression, °C/°F too),
// the unit names by quantity, and the CODATA physical constants with their
// units and uncertainties, insertable into Calculate.

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, ArrowDownToLine } from 'lucide-react'
import { Tex } from './Tex'
import { formatNumber, type NumPayload } from './format'
import { fmtOpts } from './display'
import { engineSettings } from './CalcView'
import type { CalcSettings } from './session'
import type { CalcBridge } from './bridge'

interface Constant {
  name: string
  alias: string | null
  value: string
  unit: string
  uncertainty: string
  exact: boolean
}

interface Props {
  bridge: CalcBridge
  settings: CalcSettings
  insertToCalc: (text: string) => void
}

const CATEGORY_NAMES: Record<string, string> = {
  length: 'Length', mass: 'Mass', time: 'Time', velocity: 'Speed', energy: 'Energy', power: 'Power', pressure: 'Pressure',
  force: 'Force', temperature: 'Temperature', current: 'Current', charge: 'Charge', voltage: 'Voltage', capacitance: 'Capacitance',
  impedance: 'Resistance', conductance: 'Conductance', inductance: 'Inductance', magnetic_density: 'Magnetic field', magnetic_flux: 'Magnetic flux',
  amount_of_substance: 'Amount', luminous_intensity: 'Light', frequency: 'Frequency', acceleration: 'Acceleration', action: 'Action',
}

export function UnitsView({ bridge, settings, insertToCalc }: Props) {
  const [value, setValue] = useState('1')
  const [from, setFrom] = useState('km/h')
  const [to, setTo] = useState('m/s')
  const [out, setOut] = useState<{ latex?: string; text?: string; num?: NumPayload | null; error?: string } | null>(null)
  const [units, setUnits] = useState<Record<string, string[]>>({})
  const [consts, setConsts] = useState<Constant[]>([])
  const [q, setQ] = useState('')

  useEffect(() => {
    bridge.call<{ ok: boolean; units?: Record<string, string[]> }>('units').then((r) => r.ok && r.units && setUnits(r.units)).catch(() => {})
    bridge.call<{ ok: boolean; constants?: Constant[] }>('constants').then((r) => r.ok && r.constants && setConsts(r.constants)).catch(() => {})
  }, [bridge])

  useEffect(() => {
    if (!value.trim() || !from.trim() || !to.trim()) return setOut(null)
    const t = setTimeout(() => {
      bridge
        .call<{ ok: boolean; latex?: string; text?: string; num?: NumPayload | null; error?: string }>('convert', { value, from, to, settings: engineSettings(settings) })
        .then((r) => setOut(r.ok ? r : { error: r.error }))
        .catch(() => {})
    }, 150)
    return () => clearTimeout(t)
  }, [value, from, to, settings, bridge])

  const result = out?.num ? formatNumber(out.num, { ...fmtOpts(settings), digits: Math.min(settings.digits, 30) }, settings.complex, settings.angle) : null
  const allUnits = useMemo(() => [...new Set(Object.values(units).flat()), 'degC', 'degF', 'degR'], [units])
  const shownConsts = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? consts.filter((c) => c.name.toLowerCase().includes(s) || c.alias?.toLowerCase() === s || c.unit.toLowerCase().includes(s)) : consts
  }, [consts, q])
  const temp = (u: string) => /^(deg[CFR]|°[CFR])$/.test(u.trim())

  return (
    <div className="kc-units">
      <div className="kc-units-left">
        <div className="kc-panel">
          <div className="kc-panel-title">Convert</div>
          <div className="kc-convert">
            <input className="k-input kc-mono kc-conv-value" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Value" />
            <input className="k-input kc-mono" list="kc-unit-list" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From unit" placeholder="km/h" />
            <button className="k-icon-btn" title="Swap" onClick={() => { setFrom(to); setTo(from) }}><ArrowLeftRight size={15} /></button>
            <input className="k-input kc-mono" list="kc-unit-list" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To unit" placeholder="m/s" />
            <datalist id="kc-unit-list">
              {allUnits.map((u) => <option key={u} value={u} />)}
            </datalist>
          </div>
          <div className="kc-conv-out">
            {out?.error ? <span className="kc-error">{out.error}</span> : result ? (
              <>
                <span className="kc-big kc-mono">{result.text}</span>
                <span className="k-muted"> {to}</span>
                {out?.latex && !/^-?[\d.]+$/.test(out.text ?? '') && <div className="k-muted kc-conv-exact"><Tex tex={`= ${out.latex}`} /></div>}
              </>
            ) : <span className="k-muted">…</span>}
          </div>
          <div className="kc-btnrow">
            <button className="k-btn small" disabled={temp(from) || temp(to)} title={temp(from) ? 'Temperatures with an offset convert here only' : ''} onClick={() => insertToCalc(`${value}${unitExpr(from)} ▶ ${unitExpr(to)}`)}>
              <ArrowDownToLine size={13} /> Use in Calculate
            </button>
          </div>
          <div className="k-muted kc-hint">
            Units can be combined: <code>kWh</code>, <code>J/(mol*K)</code>, <code>m s^-2</code>, prefixes on any SI unit (<code>µm</code>, <code>MPa</code>, <code>GHz</code>, <code>nF</code>).
            In Calculate, write units with a leading underscore and mix them freely: <code>3_m/_s * 2_h</code>, <code>100_km/_h ▶ _m/_s</code>.
          </div>
        </div>
        <div className="kc-panel kc-unit-ref">
          <div className="kc-panel-title">Units</div>
          {Object.entries(units).map(([cat, list]) => (
            <div key={cat} className="kc-unit-cat">
              <div className="kc-cat-title">{CATEGORY_NAMES[cat] ?? cat.replace(/_/g, ' ')}</div>
              <div className="kc-chips">
                {list.map((u) => (
                  <button key={u} className="kc-chip" title={`Insert _${u}`} onClick={() => insertToCalc(`_${u}`)}>{u}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="kc-units-right">
        <div className="kc-panel-title">
          Physical constants <span className="k-muted">(CODATA, from SciPy) — click one to use it: <code>#c</code>, <code>#hbar</code>, or <code>const("…")</code></span>
        </div>
        <input className="k-input kc-side-search" placeholder="Search: electron, Boltzmann, J K^-1…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="kc-table-scroll">
          <table className="kc-table kc-const-table">
            <thead>
              <tr><th>Symbol</th><th>Name</th><th>Value</th><th>Unit</th><th>Uncertainty</th></tr>
            </thead>
            <tbody>
              {shownConsts.slice(0, 500).map((c) => (
                <tr key={c.name} onClick={() => insertToCalc(c.alias ? `#${c.alias}` : `const("${c.name}")`)} title="Insert in Calculate">
                  <td className="kc-mono">{c.alias ? `#${c.alias}` : ''}</td>
                  <td>{c.name}</td>
                  <td className="kc-mono">{c.value}</td>
                  <td className="kc-mono">{c.unit}</td>
                  <td className="kc-mono">{c.exact ? 'exact' : c.uncertainty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!consts.length && <div className="k-muted kc-pad">Loading the constants…</div>}
        </div>
      </div>
    </div>
  )
}

/** "km/h" -> "_km/_h" (unit names in Calculate take an underscore). */
export function unitExpr(u: string): string {
  return u.trim().replace(/(?<![\w.])([A-Za-zµμΩÅ°][A-Za-z0-9µμΩÅ°]*)/g, '_$1').replace(/__/g, '_')
}
