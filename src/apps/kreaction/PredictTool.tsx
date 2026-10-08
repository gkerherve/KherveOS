// Predict products: reaction SMARTS templates run by RDKit's reaction engine on the reactants you give.

import { useEffect, useMemo, useState } from 'react'
import { Plus, Sparkles, X } from 'lucide-react'
import { equationText } from './balance'
import { COMPOUNDS, findCompound } from './compounds'
import { equationSvg } from './compose'
import { EquationView } from './EquationView'
import { canonicalSmiles, isValidSmiles, predictAll, type Prediction } from './rdengine'
import { resolveSpecies } from './reaction'
import { printSvg } from './structures'
import { TEMPLATES, type Template } from './templates'
import { Card, Err, Hint, ResultActions, useKr } from './ui'

/** A name from the table, else the text itself (a SMILES). */
function toSmiles(text: string): string {
  return findCompound(text)?.smiles ?? text.trim()
}

function Outcome({ p }: { p: Prediction }) {
  const kr = useKr()
  const t = p.template
  const eq = (s: string) => {
    const r = resolveSpecies(s)
    return { smiles: s, label: r.formula, name: r.name, charge: r.charge, coeff: 1 }
  }
  const text = useMemo(() => {
    const names = (list: string[]) => list.map((s) => resolveSpecies(s).name ?? resolveSpecies(s).label)
    return `${t.name}\n${equationText({ reactants: names(p.reactants), products: names(p.products) }, null)}\nConditions: ${t.conditions}\nAlso formed: ${t.byproducts}\n${t.rule}`
  }, [p, t])
  const svgs = () => {
    const rd = kr.rd
    if (!rd) return []
    const pic = (s: string) => ({ svg: printSvg(rd, s, 260, 180), label: s, coeff: 1 })
    return [equationSvg({ reactants: p.reactants.map(pic), products: p.products.map(pic), arrow: '→', above: t.conditions, below: '', background: true })]
  }
  return (
    <Card title={t.name} actions={<ResultActions tool="predict" label={t.name} text={text} svgs={svgs} />}>
      <EquationView reactants={p.reactants.map(eq)} products={p.products.map(eq)} arrow="→" above={t.conditions} size={130} />
      <p className="kr-explain">{t.rule}</p>
      <div className="kr-kv">
        <span>Also formed / lost</span><b>{t.byproducts}</b>
        <span>Needs</span><b>{t.needs.join(' + ')}</b>
      </div>
      <div className="kr-actions">
        <button className="k-btn small" onClick={() => kr.setReaction({ reactants: p.reactants, products: p.products, above: t.conditions }, true)} title="Open this reaction in the builder to balance it">
          Load in builder
        </button>
      </div>
    </Card>
  )
}

export function PredictTool() {
  const kr = useKr()
  const rows = kr.ws.predict.reactants
  const [only, setOnly] = useState('')
  const [shown, setShown] = useState<string[]>(rows)
  const [showTemplates, setShowTemplates] = useState(false)

  // run a moment after typing stops
  useEffect(() => {
    const id = window.setTimeout(() => setShown(rows), 250)
    return () => window.clearTimeout(id)
  }, [rows])

  const setRows = (r: string[]) => kr.patch('predict', { reactants: r })
  const smiles = useMemo(() => shown.map((r) => r.trim()).filter(Boolean).map(toSmiles), [shown])
  const bad = useMemo(() => (kr.rd ? smiles.filter((s) => !isValidSmiles(kr.rd!, s)) : []), [kr.rd, smiles])
  const result = useMemo(() => {
    if (!kr.rd || smiles.length === 0 || bad.length) return null
    const templates: readonly Template[] = only ? TEMPLATES.filter((t) => t.id === only) : TEMPLATES
    return predictAll(kr.rd, templates, smiles)
  }, [kr.rd, smiles, bad, only])
  // distinct outcomes by their products, grouped by template for the summary line
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of result ?? []) m.set(p.template.name, (m.get(p.template.name) ?? 0) + 1)
    return [...m.entries()]
  }, [result])

  const fromBuilder = () => {
    const b = kr.ws.builder
    const list = b.reactants.map((r) => r.trim()).filter(Boolean)
    if (list.length) setRows(list)
  }

  return (
    <div className="kr-tool-body">
      <Card
        title="Reactants"
        icon={<Sparkles size={15} />}
        actions={
          <>
            <button className="k-btn small" onClick={fromBuilder} title="Take the reactants of the reaction builder">From builder</button>
            <button className="k-icon-btn" onClick={() => setRows([...rows, ''])} aria-label="Add a reactant" title="Add a reactant"><Plus size={14} /></button>
          </>
        }
      >
        <div className="kr-predrows">
          {rows.map((r, i) => (
            <div className="kr-predrow" key={i}>
              <input
                className="k-input"
                value={r}
                spellCheck={false}
                list="kr-compound-names"
                placeholder="a name (ethanol) or a SMILES (CCO)"
                aria-label={`Reactant ${i + 1}`}
                onChange={(e) => setRows(rows.map((x, k) => (k === i ? e.target.value : x)))}
              />
              <button className="k-icon-btn" onClick={() => setRows(rows.length > 1 ? rows.filter((_, k) => k !== i) : [''])} aria-label="Remove" title="Remove"><X size={14} /></button>
            </div>
          ))}
          <datalist id="kr-compound-names">
            {COMPOUNDS.map((c) => <option key={c.name} value={c.name} />)}
          </datalist>
        </div>
        <div className="kr-arrowrow">
          <label className="kr-stack">
            <span className="kr-label">Only this reaction type</span>
            <select className="k-input" value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Reaction type">
              <option value="">All {TEMPLATES.length} reaction types</option>
              {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
        <Hint>
          One reactant for a two-reactant template reacts with itself (ethanal gives the aldol product). Enter reagents too: Br for HBr, BrBr for bromine, [OH-] for hydroxide, C[Mg]Br for a Grignard reagent.
        </Hint>
      </Card>

      {!kr.rd && <Card><div className="k-muted kr-empty">{kr.rdStatus === 'failed' ? 'The reaction engine (RDKit) could not be loaded here. The Reaction library has the common reactions.' : 'Loading the reaction engine (RDKit)…'}</div></Card>}
      {bad.length > 0 && <Card><Err>RDKit cannot read {bad.map((b) => `"${b}"`).join(', ')}. Check the SMILES (valences, brackets) or use a name from the table.</Err></Card>}
      {result && result.length === 0 && (
        <Card>
          <div className="k-muted kr-empty">
            None of the {only ? 'selected template' : `${TEMPLATES.length} templates`} applies to {smiles.map((s) => canonicalSmiles(kr.rd!, s) ?? s).join(' + ')}. Check that the functional groups are there (and add the second reagent when the reaction needs one), or look in the Reaction library.
          </div>
        </Card>
      )}
      {result && result.length > 0 && (
        <>
          <Card>
            <div className="kr-small">
              <b>{result.length}</b> possible outcome{result.length === 1 ? '' : 's'}: {counts.map(([n, c]) => `${n}${c > 1 ? ` (×${c})` : ''}`).join(', ')}.
              <span className="k-muted"> Templates show what can happen, not what will: competing pathways (substitution vs elimination, regiochemistry) are for you to judge.</span>
            </div>
          </Card>
          {result.map((p, i) => <Outcome key={`${p.template.id}${i}${p.products.join('.')}`} p={p} />)}
        </>
      )}

      <Card
        title={`Reaction templates (${TEMPLATES.length})`}
        actions={<button className="k-btn small" onClick={() => setShowTemplates(!showTemplates)}>{showTemplates ? 'Hide' : 'Show'}</button>}
      >
        {showTemplates ? (
          <table className="kr-table kr-tpl">
            <thead><tr><th>Name</th><th>Reactants</th><th>Conditions</th><th>Reaction SMARTS</th></tr></thead>
            <tbody>
              {TEMPLATES.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td><td>{t.needs.join(' + ')}</td><td>{t.conditions}</td><td className="kr-mono kr-small">{t.smarts.join('\n')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Hint>Each template is a reaction SMARTS (a pattern for the reactive groups and what they become), applied to the molecules by RDKit&apos;s reaction engine.</Hint>
        )}
      </Card>
    </div>
  )
}
