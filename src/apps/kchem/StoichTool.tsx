// Stoichiometry for a whole balanced equation: amounts of the reactants, the limiting reagent,
// theoretical yields of every product, the excess left over and the percent yield.

import { useMemo } from 'react'
import { Scale } from 'lucide-react'
import { balance } from './balance'
import { fmt, molarMass, parseNum } from './chem'
import { DEFAULT_AMOUNT, type AmountForm, type StoichForm } from './forms'
import { AMOUNT_UNITS, parseBalanced, stoichiometry, type Amount, type AmountKind, type StoichResult } from './stoich'
import { Answer, Card, EquationView, Err, Field, Fx, Hint, NumInput, ResultActions, Select, WithUnit } from './ui'

const KINDS: { id: AmountKind; label: string }[] = [
  { id: 'mass', label: 'mass' },
  { id: 'moles', label: 'moles' },
  { id: 'solution', label: 'solution (mol/L × volume)' },
  { id: 'gas', label: 'gas volume' },
]

const DEFAULT_UNIT: Record<AmountKind, string> = { mass: 'g', moles: 'mol', solution: 'mL', gas: 'L' }

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The amount typed for a reactant, or null when it is left empty. */
function toAmount(a: AmountForm, name: string): Amount | null {
  const v = parseNum(a.value)
  if (v === null) return null
  if (Number.isNaN(v)) throw new Error(`The amount of ${name} must be a number.`)
  const out: Amount = { kind: a.kind, value: v, unit: a.unit }
  if (a.kind === 'solution') {
    const c = parseNum(a.conc)
    if (c === null || Number.isNaN(c)) throw new Error(`Type the concentration of the ${name} solution.`)
    out.conc = c
  }
  if (a.kind === 'mass') {
    const p = parseNum(a.purity)
    if (p !== null) {
      if (Number.isNaN(p) || !(p > 0 && p <= 100)) throw new Error(`The purity of ${name} must be between 0 and 100 %.`)
      out.purity = p
    }
  }
  if (a.kind === 'gas') {
    const mv = parseNum(a.molarVolume)
    if (mv === null || Number.isNaN(mv) || !(mv > 0)) throw new Error('The molar volume must be above zero (22.414 L/mol at 0 °C, 24.465 at 25 °C).')
    out.molarVolume = mv
  }
  return out
}

function describe(r: StoichResult, equation: string, actualText: string): string {
  const lines = [equation.trim()]
  for (const x of r.reactants) {
    lines.push(`${x.formula}${x.limiting ? '  [limiting]' : ''}: ${x.molesGiven === null ? 'not given (excess)' : `${fmt(x.molesGiven)} mol (${fmt(x.massGiven as number)} g)`}${x.molesLeft !== null ? `, left over ${fmt(x.molesLeft)} mol (${fmt(x.massLeft as number)} g)` : ''}`)
  }
  lines.push(`Limiting reagent: ${r.limiting.join(', ')}`)
  for (const p of r.products) lines.push(`${p.formula}: ${fmt(p.molesReacted)} mol = ${fmt(p.massReacted)} g (theoretical)`)
  if (r.percentYield) lines.push(`Actual yield ${actualText} g of ${r.percentYield.formula}: ${fmt(r.percentYield.percent)} % yield`)
  return lines.join('\n')
}

/** The quick conversion: grams of one reactant to grams of one product, with the coefficients typed by hand. */
function Quick({ f, set }: { f: StoichForm; set: (p: Partial<StoichForm>) => void }) {
  const q = f.quick
  const upd = (p: Partial<StoichForm['quick']>) => set({ quick: { ...q, ...p } })
  const r = useMemo(() => {
    try {
      const m = parseNum(q.mass)
      const ca = parseNum(q.ca)
      const cb = parseNum(q.cb)
      if (m === null || ca === null || cb === null || Number.isNaN(m) || Number.isNaN(ca) || Number.isNaN(cb) || !(ca > 0) || !(cb > 0)) {
        throw new Error('Check the mass and the coefficients (above zero).')
      }
      const molesA = m / molarMass(q.a)
      const molesB = (molesA * cb) / ca
      return { ok: true as const, molesA, molesB, massB: molesB * molarMass(q.b) }
    } catch (e) {
      return { ok: false as const, message: errText(e) }
    }
  }, [q])
  const text = r.ok ? `${q.mass} g of ${q.a} (×${q.ca}) → ${q.b} (×${q.cb}): ${fmt(r.molesA)} mol → ${fmt(r.molesB)} mol = ${fmt(r.massB)} g` : ''
  return (
    <Card title="Quick: one reactant to one product" actions={<ResultActions tool="stoich" slot="quick" label="Mass of product" text={text} />}>
      <div className="kc-grid">
        <Field label="Reactant"><input className="k-input kc-mono" value={q.a} onChange={(e) => upd({ a: e.target.value })} spellCheck={false} aria-label="Reactant formula" /></Field>
        <Field label="Mass (g)"><NumInput value={q.mass} onChange={(mass) => upd({ mass })} label="Reactant mass" /></Field>
        <Field label="Coefficient"><NumInput value={q.ca} onChange={(ca) => upd({ ca })} label="Reactant coefficient" /></Field>
        <Field label="Product"><input className="k-input kc-mono" value={q.b} onChange={(e) => upd({ b: e.target.value })} spellCheck={false} aria-label="Product formula" /></Field>
        <Field label="Coefficient"><NumInput value={q.cb} onChange={(cb) => upd({ cb })} label="Product coefficient" /></Field>
      </div>
      {r.ok ? (
        <div className="kc-result">{fmt(r.molesA)} mol of <Fx f={q.a} /> → {fmt(r.molesB)} mol of <Fx f={q.b} /> = <b>{fmt(r.massB)} g</b> (theoretical yield)</div>
      ) : <Err>{r.message}</Err>}
      <Hint>For one product when the other reactants are plentiful: the coefficients come from the balanced equation, e.g. 2 H₂ + O₂ → 2 H₂O: H₂ 2, H₂O 2.</Hint>
    </Card>
  )
}

export function StoichTool({ f, set }: { f: StoichForm; set: (p: Partial<StoichForm>) => void }) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, ...parseBalanced(f.equation) }
    } catch (e) {
      return { ok: false as const, message: errText(e) }
    }
  }, [f.equation])

  const fix = useMemo(() => {
    if (parsed.ok || !f.equation.trim()) return null
    const b = balance(f.equation)
    return b.ok ? b.text : null
  }, [parsed, f.equation])

  const calc = useMemo(() => {
    if (!parsed.ok) return null
    try {
      const names = parsed.eq.reactants.map((s) => s.formula)
      const amounts = parsed.eq.reactants.map((_, i) => toAmount(f.amounts[i] ?? DEFAULT_AMOUNT, names[i]))
      const actual = parseNum(f.actual)
      if (actual !== null && Number.isNaN(actual)) throw new Error('The actual yield must be a number (grams).')
      const r = stoichiometry({
        equation: f.equation,
        amounts,
        actual: actual === null ? null : { product: Math.min(f.actualProduct, parsed.eq.products.length - 1), grams: actual },
      })
      return { ok: true as const, r }
    } catch (e) {
      return { ok: false as const, message: errText(e) }
    }
  }, [parsed, f.equation, f.amounts, f.actual, f.actualProduct])

  const text = calc?.ok ? describe(calc.r, f.equation, f.actual) : ''

  const setAmount = (i: number, p: Partial<AmountForm>) => {
    const cur = f.amounts[i] ?? DEFAULT_AMOUNT
    const next = { ...cur, ...p }
    if (p.kind && p.kind !== cur.kind) next.unit = DEFAULT_UNIT[p.kind]
    set({ amounts: { ...f.amounts, [i]: next } })
  }

  return (
    <div className="kc-tool-body">
      <Card title="Stoichiometry" icon={<Scale size={15} />} actions={<ResultActions tool="stoich" label="Limiting reagent and yield" text={text} />}>
        <Field label="Balanced equation (with coefficients)">
          <textarea
            className="k-input kc-mono kc-eqinput"
            rows={2}
            value={f.equation}
            onChange={(e) => set({ equation: e.target.value })}
            spellCheck={false}
            aria-label="Balanced equation"
            placeholder="2 H2 + O2 -> 2 H2O"
          />
        </Field>
        {parsed.ok ? (
          <EquationView eq={parsed.eq} coeffs={parsed.coeffs} />
        ) : (
          <>
            <Err>{parsed.message}</Err>
            {fix && (
              <div className="kc-actions">
                <button className="k-btn small primary" onClick={() => set({ equation: fix })}><Scale size={13} /> Balance it: {fix}</button>
              </div>
            )}
          </>
        )}
      </Card>

      {parsed.ok && (
        <Card title="Amounts of the reactants">
          <Hint>Leave a reactant empty when it is in large excess; the others decide how far the reaction goes.</Hint>
          {parsed.eq.reactants.map((s, i) => {
            const a = f.amounts[i] ?? DEFAULT_AMOUNT
            return (
              <div key={i} className="kc-amount">
                <div className="kc-amount-name"><b>{parsed.coeffs[i] !== 1 ? parsed.coeffs[i] : ''}</b> <Fx f={s.formula + (s.phase ? `(${s.phase})` : '')} /></div>
                <Select value={a.kind} onChange={(kind) => setAmount(i, { kind })} options={KINDS} label={`Kind of amount for ${s.formula}`} />
                <WithUnit unit={<Select value={a.unit} onChange={(unit) => setAmount(i, { unit })} options={AMOUNT_UNITS[a.kind]} label={`Unit for ${s.formula}`} />}>
                  <NumInput value={a.value} onChange={(value) => setAmount(i, { value })} label={`Amount of ${s.formula}`} placeholder="in excess" />
                </WithUnit>
                {a.kind === 'solution' && (
                  <Field label="mol/L" className="kc-inline"><NumInput value={a.conc} onChange={(conc) => setAmount(i, { conc })} label={`Concentration of ${s.formula}`} /></Field>
                )}
                {a.kind === 'mass' && (
                  <Field label="purity %" className="kc-inline"><NumInput value={a.purity} onChange={(purity) => setAmount(i, { purity })} label={`Purity of ${s.formula}`} /></Field>
                )}
                {a.kind === 'gas' && (
                  <Field label="L/mol" className="kc-inline"><NumInput value={a.molarVolume} onChange={(molarVolume) => setAmount(i, { molarVolume })} label="Molar volume" /></Field>
                )}
              </div>
            )
          })}
        </Card>
      )}

      {calc && (
        <Card title="Result">
          {!calc.ok ? (
            <Err>{calc.message}</Err>
          ) : (
            <>
              <Answer>
                Limiting reagent: <b>{calc.r.limiting.map((x, i) => <span key={x}>{i > 0 && ' and '}<Fx f={x} /></span>)}</b>
                <span className="k-muted"> · reaction extent {fmt(calc.r.extent)} mol</span>
              </Answer>
              <div className="kc-scrollbox">
                <table className="kc-table kc-stoich">
                  <thead>
                    <tr><th>reactant</th><th>given (mol)</th><th>given (g)</th><th>used (mol)</th><th>used (g)</th><th>left (mol)</th><th>left (g)</th></tr>
                  </thead>
                  <tbody>
                    {calc.r.reactants.map((x) => (
                      <tr key={x.formula} className={x.limiting ? 'kc-limiting' : ''}>
                        <td><Fx f={x.formula} />{x.limiting && <span className="kc-badge">limiting</span>}</td>
                        <td>{x.molesGiven === null ? '—' : fmt(x.molesGiven)}</td>
                        <td>{x.massGiven === null ? '—' : fmt(x.massGiven)}</td>
                        <td>{fmt(x.molesReacted)}</td>
                        <td>{fmt(x.massReacted)}</td>
                        <td>{x.molesLeft === null ? 'excess' : fmt(x.molesLeft)}</td>
                        <td>{x.massLeft === null ? 'excess' : fmt(x.massLeft)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table className="kc-table kc-stoich">
                  <thead><tr><th>product</th><th>made (mol)</th><th>theoretical yield (g)</th></tr></thead>
                  <tbody>
                    {calc.r.products.map((x) => (
                      <tr key={x.formula}><td><Fx f={x.formula} /></td><td>{fmt(x.molesReacted)}</td><td><b>{fmt(x.massReacted)}</b></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="kc-grid">
                <Field label="Percent yield: product">
                  <Select
                    value={String(Math.min(f.actualProduct, calc.r.products.length - 1))}
                    onChange={(v) => set({ actualProduct: Number(v) })}
                    options={calc.r.products.map((p, i) => ({ id: String(i), label: p.formula }))}
                    label="Product for the percent yield"
                  />
                </Field>
                <Field label="Actual yield (g)">
                  <NumInput value={f.actual} onChange={(actual) => set({ actual })} label="Actual yield" placeholder="weighed" />
                </Field>
              </div>
              {calc.r.percentYield && (
                <Answer>
                  Percent yield of <Fx f={calc.r.percentYield.formula} />: <b>{fmt(calc.r.percentYield.percent)} %</b>
                  <span className="k-muted"> ({fmt(calc.r.percentYield.actual)} g of {fmt(calc.r.percentYield.theoretical)} g)</span>
                </Answer>
              )}
            </>
          )}
        </Card>
      )}
      <Quick f={f} set={set} />
    </div>
  )
}
