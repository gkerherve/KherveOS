// The calculators tab: a list of calculators (grouped) and, for the chosen one, its form, the results
// (each can be copied) and, where it helps, a drawing (resistor bands, phasors).

import { useMemo } from 'react'
import { Copy } from 'lucide-react'
import { os } from '@/os'
import { CALCULATORS, COLOR_HEX, defaultInputs, resultText, type CalcDraw, type Calculator, type CalcOutput } from './calc'

interface Props {
  id: string
  inputs: Record<string, Record<string, string>>
  onSelect(id: string): void
  onInputs(id: string, v: Record<string, string>): void
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    os.notify({ title: 'Copied', body: what })
  } catch {
    await os.dialog.alert(`The browser would not let kElec copy. Here is the text:\n\n${text}`, { title: 'Copy' })
  }
}

export function Calculators({ id, inputs, onSelect, onInputs }: Props) {
  const calc = CALCULATORS.find((c) => c.id === id) ?? CALCULATORS[0]
  const values = useMemo(() => ({ ...defaultInputs(calc), ...(inputs[calc.id] ?? {}) }), [calc, inputs])
  const out = useMemo<{ ok: CalcOutput } | { err: string }>(() => {
    try { return { ok: calc.compute(values) } } catch (e) { return { err: e instanceof Error ? e.message : String(e) } }
  }, [calc, values])
  const groups = useMemo(() => {
    const m = new Map<string, Calculator[]>()
    for (const c of CALCULATORS) m.set(c.group, [...(m.get(c.group) ?? []), c])
    return [...m.entries()]
  }, [])
  const set = (key: string, v: string) => onInputs(calc.id, { ...values, [key]: v })
  return (
    <div className="ke-calc">
      <nav className="ke-calc-nav" aria-label="Calculators">
        {groups.map(([g, list]) => (
          <section key={g}>
            <h4>{g}</h4>
            {list.map((c) => <button key={c.id} className={c.id === calc.id ? 'on' : ''} onClick={() => onSelect(c.id)}>{c.name}</button>)}
          </section>
        ))}
      </nav>
      <div className="ke-calc-main">
        <h2>{calc.name}</h2>
        <p className="k-muted">{calc.description}</p>
        <div className="ke-calc-form">
          {calc.fields.map((fl) => {
            if (fl.showWhen && !fl.showWhen.values.includes(values[fl.showWhen.key])) return null
            return (
              <label key={fl.key} className="ke-field">
                <span>{fl.label}</span>
                <span className="ke-field-in">
                  {fl.options ? (
                    <select className="k-input" value={values[fl.key]} onChange={(e) => set(fl.key, e.target.value)}>
                      {fl.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input className="k-input" value={values[fl.key]} spellCheck={false} placeholder={fl.optional ? 'leave empty' : ''} onChange={(e) => set(fl.key, e.target.value)} />
                  )}
                  {fl.unit && <em>{fl.unit}</em>}
                </span>
                {fl.hint && <small className="k-muted">{fl.hint}</small>}
              </label>
            )
          })}
        </div>
        {'err' in out ? (
          <div className="ke-calc-err" role="alert">{out.err}</div>
        ) : (
          <div className="ke-calc-out">
            {out.ok.draw && <Drawing d={out.ok.draw} />}
            <table>
              <tbody>
                {out.ok.rows.map((r, i) => (
                  <tr key={i} className={r.main ? 'main' : ''}>
                    <th>{r.label}</th>
                    <td>{r.value}</td>
                    <td><button className="k-icon-btn" title="Copy this value" aria-label={`Copy ${r.label}`} onClick={() => void copy(r.value, `${r.label}: ${r.value}`)}><Copy size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {out.ok.notes?.map((n, i) => <p key={i} className="k-muted ke-note-line">{n}</p>)}
            <button className="k-btn small" onClick={() => void copy(resultText(out.ok), 'All results')}><Copy size={12} /> Copy all</button>
          </div>
        )}
      </div>
    </div>
  )
}

function Drawing({ d }: { d: CalcDraw }) {
  if (d.kind === 'bands') {
    const n = d.colors.length
    const xs = n === 4 ? [48, 76, 104, 190] : n === 5 ? [46, 70, 94, 118, 190] : [44, 66, 88, 110, 170, 200]
    return (
      <svg className="ke-draw" width={260} height={70} viewBox="0 0 260 70" role="img" aria-label="Resistor colour bands">
        <path d="M0 35 L30 35 M230 35 L260 35" className="ke-draw-lead" />
        <rect x={30} y={12} width={200} height={46} rx={14} className="ke-resbody" />
        {d.colors.map((c, i) => <rect key={i} x={xs[i] ?? 190} y={12} width={12} height={46} fill={COLOR_HEX[c] ?? '#888'} className="ke-band" />)}
      </svg>
    )
  }
  const vs = d.vectors
  const maxv = Math.max(1e-12, ...vs.map((v) => Math.hypot(v.re, v.im)))
  const S = 100 / maxv
  const X = (v: number) => 130 + v * S
  const Y = (v: number) => 110 - v * S
  return (
    <svg className="ke-draw" width={260} height={220} viewBox="0 0 260 220" role="img" aria-label="Phasor diagram">
      <defs><marker id="ke-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="currentColor" /></marker></defs>
      <line x1={10} y1={110} x2={250} y2={110} className="ke-axis" /><line x1={130} y1={10} x2={130} y2={210} className="ke-axis" />
      {vs.map((v, i) => (
        <g key={v.label} className={`ke-vec ke-vec-${i % 4}`}>
          <line x1={130} y1={110} x2={X(v.re)} y2={Y(v.im)} markerEnd="url(#ke-arrow)" />
          <text x={X(v.re) + (v.re >= 0 ? 4 : -4)} y={Y(v.im) + (v.im >= 0 ? -4 : 12)} textAnchor={v.re >= 0 ? 'start' : 'end'}>{v.label}</text>
        </g>
      ))}
    </svg>
  )
}
