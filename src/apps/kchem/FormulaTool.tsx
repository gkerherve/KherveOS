// Formula tool: molar mass, composition, charge, average and monoisotopic mass, the isotope pattern
// (mass-spec peaks), and the empirical formula from a composition.

import { useMemo } from 'react'
import { FlaskConical, Plus, X } from 'lucide-react'
import {
  composition, empiricalFormula, fmt, hillFormula, massInfo, parseNum, parseSpecies, unsaturation, type IsotopePeak,
} from './chem'
import type { FormulaForm } from './forms'
import { Answer, Card, Err, Field, Fx, Hint, NumInput, ResultActions, Select } from './ui'

const EXAMPLES = ['H2O', 'CuSO4·5H2O', 'C6H12O6', 'Ca(OH)2', 'K4[Fe(CN)6]', 'SO4^2-', 'Fe^3+', 'NH4+', 'C8H10N4O2', 'C60']

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A stick spectrum: one bar per nominal mass. */
function IsotopeChart({ peaks, ion }: { peaks: IsotopePeak[]; ion: boolean }) {
  if (peaks.length === 0) return null
  const W = 520
  const H = 170
  const L = 38
  const R = 10
  const T = 12
  const B = 28
  const lo = peaks[0].nominal - 1
  const hi = peaks[peaks.length - 1].nominal + 1
  const span = Math.max(3, hi - lo)
  const x = (n: number) => L + ((n - lo) / span) * (W - L - R)
  const y = (a: number) => T + (1 - a / 100) * (H - T - B)
  const barW = Math.max(2, Math.min(14, ((W - L - R) / span) * 0.6))
  const step = span > 40 ? 10 : span > 20 ? 5 : span > 10 ? 2 : 1
  const ticks: number[] = []
  for (let n = Math.ceil(lo / step) * step; n <= hi; n += step) ticks.push(n)
  return (
    <svg className="kc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Isotope pattern">
      {[0, 25, 50, 75, 100].map((a) => (
        <g key={a}>
          <line x1={L} x2={W - R} y1={y(a)} y2={y(a)} className="kc-grid-line" />
          <text x={L - 5} y={y(a) + 3.5} textAnchor="end" className="kc-axis-text">{a}</text>
        </g>
      ))}
      {ticks.map((n) => (
        <text key={n} x={x(n)} y={H - B + 14} textAnchor="middle" className="kc-axis-text">{n}</text>
      ))}
      <text x={(L + W - R) / 2} y={H - 2} textAnchor="middle" className="kc-axis-text">{ion ? 'm/z' : 'mass (u)'}</text>
      <text x={10} y={(T + H - B) / 2} textAnchor="middle" className="kc-axis-text" transform={`rotate(-90 10 ${(T + H - B) / 2})`}>relative %</text>
      {peaks.map((p) => (
        <g key={p.nominal}>
          <rect x={x(p.nominal) - barW / 2} y={y(p.abundance)} width={barW} height={Math.max(1, H - B - y(p.abundance))} className="kc-bar">
            <title>{`${p.mass.toFixed(4)}  ·  ${fmt(p.abundance)} %`}</title>
          </rect>
          {p.abundance >= 8 && (
            <text x={x(p.nominal)} y={y(p.abundance) - 3} textAnchor="middle" className="kc-bar-label">{p.abundance >= 99.95 ? '100' : p.abundance.toFixed(1)}</text>
          )}
        </g>
      ))}
    </svg>
  )
}

export function FormulaTool({ f, set }: { f: FormulaForm; set: (p: Partial<FormulaForm>) => void }) {
  const data = useMemo(() => {
    try {
      const sp = parseSpecies(f.formula)
      const comp = composition(f.formula)
      const info = massInfo(f.formula)
      return { ok: true as const, sp, comp, info }
    } catch (e) {
      return { ok: false as const, message: errText(e) }
    }
  }, [f.formula])

  let text = ''
  if (data.ok) {
    const { sp, comp, info } = data
    const atoms = Object.values(sp.atoms).reduce((s, n) => s + n, 0)
    text = [
      `Formula: ${f.formula.trim()}`,
      `Molar mass (average): ${fmt(info.average)} g/mol`,
      `Monoisotopic mass: ${fmt(info.monoisotopic, 8)} u`,
      ...(sp.charge ? [`Charge: ${sp.charge > 0 ? '+' : ''}${sp.charge}`, `Monoisotopic m/z: ${fmt(info.mz as number, 8)}`] : []),
      `Atoms per formula unit: ${fmt(atoms)}`,
      `Composition: ${comp.map((c) => `${c.element} ${fmt(c.percent)} %`).join(', ')}`,
    ].join('\n')
  }

  // empirical formula
  const emp = useMemo(() => {
    try {
      const rows = f.emp.rows.filter((r) => r.el.trim() !== '' || r.amount.trim() !== '')
      const input = rows.map((r) => {
        const v = parseNum(r.amount)
        if (v === null || Number.isNaN(v)) throw new Error(`Type the amount of ${r.el || 'each element'}.`)
        return { element: r.el.trim().replace(/^./, (c) => c.toUpperCase()), amount: v }
      })
      const M = parseNum(f.emp.molarMass)
      if (M !== null && Number.isNaN(M)) throw new Error('The molar mass must be a number.')
      const r = empiricalFormula(input, f.emp.mode, M)
      const sum = f.emp.mode === 'percent' ? input.reduce((s, x) => s + x.amount, 0) : null
      return { ok: true as const, r, sum }
    } catch (e) {
      return { ok: false as const, message: errText(e) }
    }
  }, [f.emp])
  const empText = emp.ok
    ? [
        `Empirical formula from ${f.emp.mode === 'percent' ? 'percent' : f.emp.mode === 'mass' ? 'masses (g)' : 'moles'}: ${f.emp.rows.map((r) => `${r.el} ${r.amount}`).join(', ')}`,
        `Empirical formula: ${emp.r.empirical} (${fmt(emp.r.empiricalMass)} g/mol)`,
        ...(emp.r.molecular ? [`Molecular formula: ${emp.r.molecular} (×${emp.r.multiple})`] : []),
      ].join('\n')
    : ''

  const setRow = (i: number, p: Partial<{ el: string; amount: string }>) =>
    set({ emp: { ...f.emp, rows: f.emp.rows.map((r, j) => (j === i ? { ...r, ...p } : r)) } })

  return (
    <div className="kc-tool-body">
      <Card
        title="Formula"
        icon={<FlaskConical size={15} />}
        actions={<ResultActions tool="formula" label={`Molar mass of ${f.formula.trim()}`} text={text} />}
      >
        <div className="kc-formula-row">
          <input
            className="k-input kc-wide kc-mono"
            value={f.formula}
            onChange={(e) => set({ formula: e.target.value })}
            spellCheck={false}
            aria-label="Formula"
            placeholder="H2O, CuSO4·5H2O, SO4^2-, Fe3+ …"
          />
          <button className="k-btn" onClick={() => set({ formula: '' })} disabled={!f.formula}>Clear</button>
        </div>
        <div className="kc-chips">
          {EXAMPLES.map((e) => (
            <button key={e} className="kc-chip" onClick={() => set({ formula: e })} title={`Use ${e}`}><Fx f={e} /></button>
          ))}
        </div>
        {!data.ok ? (
          f.formula.trim() ? <Err>{data.message}</Err> : <Hint>Type a formula or click an element in the Periodic table.</Hint>
        ) : (
          <>
            <div className="kc-bigformula"><Fx f={f.formula} /></div>
            <Answer>
              Molar mass <b>{fmt(data.info.average)}</b> g/mol
              {data.sp.charge !== 0 && <span className="k-muted"> · charge {data.sp.charge > 0 ? '+' : ''}{data.sp.charge}</span>}
            </Answer>
            <div className="kc-kv">
              <span>Monoisotopic mass</span><b>{fmt(data.info.monoisotopic, 8)} u</b>
              {data.info.mz !== null && (<><span>Monoisotopic m/z</span><b>{fmt(data.info.mz, 8)}</b></>)}
              <span>Atoms per formula unit</span><b>{fmt(Object.values(data.sp.atoms).reduce((s, n) => s + n, 0))}</b>
              <span>Hill formula</span><b><Fx f={hillFormula(data.sp.atoms)} /></b>
              {unsaturation(data.sp.atoms, data.sp.charge) !== null && (<><span>Degrees of unsaturation</span><b>{unsaturation(data.sp.atoms, data.sp.charge)}</b></>)}
            </div>
            <table className="kc-table">
              <thead><tr><th>element</th><th>atoms</th><th>mass %</th><th aria-hidden="true" /></tr></thead>
              <tbody>
                {data.comp.map((c) => (
                  <tr key={c.element}>
                    <td>{c.element}</td>
                    <td>{fmt(c.count)}</td>
                    <td>{fmt(c.percent)}</td>
                    <td className="kc-barcell"><span className="kc-pct" style={{ width: `${Math.min(100, c.percent)}%` }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Hint>Brackets, hydrate dots (CuSO4·5H2O) and subscripts (Fe₂O₃) work. A charge: SO4^2-, Fe3+, NH4+. The mass of electrons is neglected in the molar mass.</Hint>
          </>
        )}
      </Card>

      {data.ok && (
        <Card title="Mass spectrum (isotope pattern)">
          {data.info.tooBig && <Hint>This formula is too large for an isotope pattern (the peaks would spread over hundreds of mass units).</Hint>}
          <IsotopeChart peaks={data.info.peaks} ion={data.sp.charge !== 0} />
          {data.info.approximate.length > 0 && (
            <Hint>No natural isotope table for {data.info.approximate.join(', ')}: a single peak at the atomic weight is used for it.</Hint>
          )}
          <div className="kc-scrollbox">
            <table className="kc-table">
              <thead><tr><th>{data.sp.charge ? 'm/z' : 'mass (u)'}</th><th>nominal</th><th>relative %</th><th>probability %</th></tr></thead>
              <tbody>
                {data.info.peaks.map((p) => (
                  <tr key={p.nominal}><td>{p.mass.toFixed(4)}</td><td>{p.nominal}</td><td>{fmt(p.abundance)}</td><td>{fmt(p.fraction * 100)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <Hint>Peaks are grouped by nominal mass (natural abundances), so the exact mass shown is the abundance-weighted centre of each group. Peaks under 0.01 % are not listed.</Hint>
        </Card>
      )}

      <Card title="Find the empirical formula" actions={<ResultActions tool="formula" slot="emp" label="Empirical formula" text={empText} />}>
        <div className="kc-grid">
          <Field label="Amounts are">
            <Select value={f.emp.mode} onChange={(mode) => set({ emp: { ...f.emp, mode } })} label="Kind of amounts" options={[{ id: 'percent', label: 'mass percent (%)' }, { id: 'mass', label: 'masses (g)' }, { id: 'moles', label: 'moles' }]} />
          </Field>
          <Field label="Molar mass (g/mol, optional)" hint="gives the molecular formula">
            <NumInput value={f.emp.molarMass} onChange={(molarMass) => set({ emp: { ...f.emp, molarMass } })} label="Molar mass" placeholder="e.g. 180.16" />
          </Field>
        </div>
        <div className="kc-emprows">
          {f.emp.rows.map((r, i) => (
            <div key={i} className="kc-emprow">
              <input className="k-input kc-el" value={r.el} onChange={(e) => setRow(i, { el: e.target.value })} aria-label={`Element ${i + 1}`} placeholder="C" spellCheck={false} />
              <NumInput value={r.amount} onChange={(amount) => setRow(i, { amount })} label={`Amount of element ${i + 1}`} placeholder={f.emp.mode === 'percent' ? '%' : f.emp.mode === 'mass' ? 'g' : 'mol'} />
              <button className="k-icon-btn" aria-label="Remove this element" onClick={() => set({ emp: { ...f.emp, rows: f.emp.rows.filter((_, j) => j !== i) } })}><X size={14} /></button>
            </div>
          ))}
          <button className="k-btn small kc-addrow" onClick={() => set({ emp: { ...f.emp, rows: [...f.emp.rows, { el: '', amount: '' }] } })}><Plus size={13} /> Element</button>
        </div>
        {emp.ok ? (
          <>
            <Answer>
              Empirical formula <b><Fx f={emp.r.empirical} /></b> <span className="k-muted">({fmt(emp.r.empiricalMass)} g/mol)</span>
              {emp.r.molecular && <> · molecular formula <b><Fx f={emp.r.molecular} /></b> <span className="k-muted">(× {emp.r.multiple})</span></>}
            </Answer>
            <div className="k-muted kc-hint">
              Mole ratios: {Object.entries(emp.r.ratios).map(([e, r]) => `${e} ${fmt(r, 3)}`).join(' : ')}
              {emp.r.factor > 1 ? ` (× ${emp.r.factor} for whole numbers)` : ''}
              {emp.sum !== null && Math.abs(emp.sum - 100) > 1 ? ` · the percentages add up to ${fmt(emp.sum)} %` : ''}
            </div>
            <div className="kc-actions">
              <button className="k-btn small" onClick={() => set({ formula: emp.r.empirical })}>Use the empirical formula above</button>
              {emp.r.molecular && <button className="k-btn small" onClick={() => set({ formula: emp.r.molecular as string })}>Use the molecular formula above</button>}
            </div>
          </>
        ) : (
          <Err>{emp.message}</Err>
        )}
      </Card>
    </div>
  )
}
