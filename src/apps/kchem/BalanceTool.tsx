// Equation balancer: type an equation, get the smallest whole-number coefficients.

import { useMemo } from 'react'
import { ArrowRightLeft, Scale } from 'lucide-react'
import { balance, checkBalance, sideTotals } from './balance'
import { fmt } from './chem'
import type { BalanceForm } from './forms'
import { Answer, Card, EquationView, Err, Fx, Hint, ResultActions } from './ui'

const EXAMPLES = [
  'Fe + O2 -> Fe2O3',
  'C3H8 + O2 -> CO2 + H2O',
  'KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O',
  'Cr2O7^2- + Fe^2+ + H^+ -> Cr^3+ + Fe^3+ + H2O',
  'MnO4^- + H^+ + e^- -> Mn^2+ + H2O',
  'CuSO4·5H2O -> CuSO4 + H2O',
  'Ca(OH)2 + H3PO4 -> Ca3(PO4)2 + H2O',
  'C6H12O6 + O2 -> CO2 + H2O',
]

export function BalanceTool({ f, set, toStoich }: { f: BalanceForm; set: (p: Partial<BalanceForm>) => void; toStoich: (balanced: string) => void }) {
  const result = useMemo(() => (f.equation.trim() ? balance(f.equation) : null), [f.equation])
  const text = result?.ok ? `${f.equation.trim()}\n${result.text}` : ''

  const table = useMemo(() => {
    if (!result?.ok) return null
    const nr = result.equation.reactants.length
    const L = sideTotals(result.equation.reactants, result.coefficients.slice(0, nr))
    const R = sideTotals(result.equation.products, result.coefficients.slice(nr))
    const els = [...new Set([...Object.keys(L.atoms), ...Object.keys(R.atoms)])]
    return { rows: els.map((e) => ({ el: e, left: L.atoms[e] ?? 0, right: R.atoms[e] ?? 0 })), charge: [L.charge, R.charge] as const, ok: checkBalance(result.equation, result.coefficients).balanced }
  }, [result])

  return (
    <div className="kc-tool-body">
      <Card title="Equation balancer" icon={<ArrowRightLeft size={15} />} actions={<ResultActions tool="balance" label="Balanced equation" text={text} />}>
        <textarea
          className="k-input kc-mono kc-eqinput"
          rows={2}
          value={f.equation}
          onChange={(e) => set({ equation: e.target.value })}
          spellCheck={false}
          aria-label="Equation"
          placeholder="Fe + O2 -> Fe2O3"
        />
        <div className="kc-chips">
          {EXAMPLES.map((e) => (
            <button key={e} className="kc-chip" onClick={() => set({ equation: e })} title={e}>{e.length > 30 ? e.slice(0, 28) + '…' : e}</button>
          ))}
        </div>
        {result === null && <Hint>Type an equation with an arrow: Fe + O2 -&gt; Fe2O3.</Hint>}
        {result && !result.ok && (
          <>
            <Err>{result.message}</Err>
            {result.hint && <Hint>{result.hint}</Hint>}
          </>
        )}
        {result?.ok && (
          <>
            <Answer><EquationView eq={result.equation} coeffs={result.coefficients} /></Answer>
            {result.alreadyBalanced && <div className="kc-ok">Already balanced as typed.</div>}
            <div className="kc-actions">
              <button className="k-btn small primary" onClick={() => set({ equation: result.text })} title="Replace the text above with the balanced equation">Use balanced text</button>
              <button className="k-btn small" onClick={() => toStoich(result.text)}><Scale size={13} /> Use in Stoichiometry</button>
            </div>
            {table && (
              <table className="kc-table kc-checktable">
                <thead><tr><th>check</th><th>reactants</th><th>products</th><th /></tr></thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr key={r.el}><td><Fx f={r.el} /></td><td>{fmt(r.left)}</td><td>{fmt(r.right)}</td><td className="kc-ok">{r.left === r.right ? '✓' : '✗'}</td></tr>
                  ))}
                  {(table.charge[0] !== 0 || table.charge[1] !== 0) && (
                    <tr><td>charge</td><td>{table.charge[0]}</td><td>{table.charge[1]}</td><td className="kc-ok">{table.charge[0] === table.charge[1] ? '✓' : '✗'}</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </>
        )}
        <Hint>
          Separate species with + and the sides with -&gt;, → or =. Charges: Fe^3+, SO4^2-, or Fe3+ / Na+ / Cl- (put spaces around the + that separates species when
          charges are present). The electron is e^-. Hydrates (CuSO4·5H2O), brackets and phases like (aq) work. Coefficients you type are ignored: they are found.
        </Hint>
      </Card>
    </div>
  )
}
