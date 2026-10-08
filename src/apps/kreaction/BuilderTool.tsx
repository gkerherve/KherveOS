// Reaction builder: reactants and products typed as names, SMILES or formulas, drawn by RDKit, with the atom /
// mass / charge balance check, the exact auto-balancer and the equation typeset with structures.

import { useMemo, useState } from 'react'
import { ArrowRightLeft, Check, Copy, Eraser, FileText, Image as ImageIcon, Plus, Scale, X } from 'lucide-react'
import { equationText } from './balance'
import { searchCompounds } from './compounds'
import { equationSvg } from './compose'
import { EquationView, type EqItem } from './EquationView'
import { num } from './formula'
import { descriptors } from './rdengine'
import { ARROWS, analyseReaction, parseEquationText, reactionSmiles, type Analysis, type ArrowKind, type Species } from './reaction'
import { printSvg, resolveHooks } from './structures'
import { reactionToNetwork } from './kinetics'
import { Card, Err, Field, Fx, Hint, Mol, PositiveInput, ResultActions, useKr } from './ui'

/** Row index → index among the non-empty rows. */
function rowIndices(rows: string[]): number[] {
  let n = 0
  return rows.map((r) => (r.trim() === '' ? -1 : n++))
}

export function useBuilderAnalysis(): { analysis: Analysis; rowCoeffs: number[]; coeffsForAnalysis: number[] | null } {
  const kr = useKr()
  const b = kr.ws.builder
  const hooks = useMemo(() => resolveHooks(kr.rd), [kr.rd])
  const rows = [...b.reactants, ...b.products]
  const coeffs = b.coeffs && b.coeffs.length === rows.length ? b.coeffs : null
  const forAnalysis = coeffs ? coeffs.filter((_, i) => rows[i].trim() !== '') : null
  const analysis = useMemo(
    () => analyseReaction({ reactants: b.reactants, products: b.products, arrow: b.arrow, above: b.above, below: b.below }, hooks, forAnalysis),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [b.reactants, b.products, b.arrow, b.above, b.below, hooks, b.coeffs],
  )
  // a coefficient typed in front of a species ("2 H2") is shown in its row until the user sets coefficients
  const idx = rowIndices(rows)
  const rowCoeffs = rows.map((_, i) => coeffs?.[i] ?? (idx[i] >= 0 ? analysis.coefficients[idx[i]] ?? 1 : 1))
  return { analysis, rowCoeffs, coeffsForAnalysis: forAnalysis }
}

function SpeciesInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [focus, setFocus] = useState(false)
  const matches = useMemo(() => (focus && value.trim().length >= 1 ? searchCompounds(value, 7) : []), [focus, value])
  const exact = matches.length === 1 && matches[0].name.toLowerCase() === value.trim().toLowerCase()
  return (
    <div className="kr-suggest">
      <input
        className="k-input kr-species-input"
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        aria-label="Species: a name, a SMILES or a formula"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
      />
      {focus && matches.length > 0 && !exact && (
        <ul className="kr-suggest-list" role="listbox">
          {matches.map((c) => (
            <li key={c.name} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); onChange(c.name); setFocus(false) }}>
              <span>{c.name}</span>
              <span className="k-muted kr-small">{c.formula}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SpeciesDetails({ s }: { s: Species }) {
  const kr = useKr()
  const { rd, sig } = kr
  const [open, setOpen] = useState(false)
  const d = useMemo(() => (open && rd && s.smiles ? descriptors(rd, s.smiles) : null), [open, rd, s.smiles])
  if (!s.smiles) return null
  const save = (format: 'svg' | 'png') => {
    const svg = rd && s.smiles ? printSvg(rd, s.smiles, 420, 320) : null
    if (svg) kr.saveImage((s.name ?? s.label).replace(/[^A-Za-z0-9_-]+/g, '-'), svg, format)
  }
  return (
    <details className="kr-details" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="k-muted kr-small">Details and picture</summary>
      <div className="kr-actions">
        <button className="k-btn small" onClick={() => save('svg')} title="Save this structure as an SVG picture"><ImageIcon size={12} /> SVG</button>
        <button className="k-btn small" onClick={() => save('png')} title="Save this structure as a PNG picture"><ImageIcon size={12} /> PNG</button>
      </div>
      {d ? (
        <div className="kr-kv kr-small">
          <span>SMILES</span><b className="kr-mono">{s.smiles}</b>
          {d.exactmw !== undefined && <><span>Exact mass</span><b>{num(d.exactmw, sig + 2)}</b></>}
          {d.logp !== undefined && <><span>logP</span><b>{num(d.logp, sig)}</b></>}
          {d.tpsa !== undefined && <><span>TPSA</span><b>{num(d.tpsa, sig)} Å²</b></>}
          {d.hbd !== undefined && <><span>H-bond donors / acceptors</span><b>{d.hbd} / {d.hba}</b></>}
          {d.rings !== undefined && <><span>Rings</span><b>{d.rings}</b></>}
          {d.inchikey && <><span>InChIKey</span><b className="kr-mono">{d.inchikey}</b></>}
        </div>
      ) : (
        <div className="kr-kv kr-small"><span>SMILES</span><b className="kr-mono">{s.smiles}</b></div>
      )}
    </details>
  )
}

export function BuilderTool() {
  const kr = useKr()
  const { ws, sig } = kr
  const b = ws.builder
  const { analysis: a, rowCoeffs } = useBuilderAnalysis()
  const nR = b.reactants.length
  const rowsAll = [...b.reactants, ...b.products]
  const idxMap = rowIndices(rowsAll)
  const arrow = ARROWS[b.arrow].symbol

  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState('')
  const applyPasted = (text = pasted) => {
    try {
      const eq = parseEquationText(text)
      setBuilder({ reactants: eq.reactants, products: eq.products, arrow: eq.arrow, coeffs: null })
      setPasted('')
      setPasteError('')
    } catch (e) {
      setPasteError(e instanceof Error ? e.message : String(e))
    }
  }

  const setBuilder = (p: Partial<typeof b>) => kr.patch('builder', { ...p, fromId: null })
  const setRow = (side: 'reactants' | 'products', i: number, value: string) => {
    const list = b[side].slice()
    list[i] = value
    setBuilder({ [side]: list })
  }
  const addRow = (side: 'reactants' | 'products') => {
    const coeffs = b.coeffs && b.coeffs.length === rowsAll.length ? b.coeffs.slice() : null
    if (coeffs) coeffs.splice(side === 'reactants' ? nR : coeffs.length, 0, 1)
    setBuilder({ [side]: [...b[side], ''], coeffs })
  }
  const removeRow = (side: 'reactants' | 'products', i: number) => {
    if (b[side].length <= 1) return setRow(side, i, '')
    const coeffs = b.coeffs && b.coeffs.length === rowsAll.length ? b.coeffs.slice() : null
    if (coeffs) coeffs.splice((side === 'reactants' ? 0 : nR) + i, 1)
    setBuilder({ [side]: b[side].filter((_, k) => k !== i), coeffs })
  }
  const setCoeff = (rowIndex: number, v: number) => {
    const coeffs = rowCoeffs.slice()
    coeffs[rowIndex] = v
    kr.patch('builder', { coeffs })
  }
  const swap = () => setBuilder({ reactants: b.products, products: b.reactants, coeffs: b.coeffs ? [...b.coeffs.slice(nR), ...b.coeffs.slice(0, nR)] : null })

  // the balancer's answer, laid back onto the rows
  const applyBalance = () => {
    const res = a.balance
    if (!res || res.coefficients.length === 0) return
    let k = 0
    kr.patch('builder', { coeffs: rowsAll.map((r) => (r.trim() === '' ? 1 : res.coefficients[k++])) })
  }

  const used = a.coefficients
  const items = (list: Species[], offset: number): EqItem[] =>
    list.map((s, i) => ({ smiles: s.smiles, label: s.formula, name: s.name && s.name.toLowerCase() !== s.label.toLowerCase() ? s.name : null, coeff: used[offset + i], charge: s.charge }))
  const eqItemsR = items(a.reactants, 0)
  const eqItemsP = items(a.products, a.reactants.length)

  const text = useMemo(() => {
    if (!a.ready || !a.check) return ''
    const eq = equationText({ reactants: a.reactants.map((s) => s.label), products: a.products.map((s) => s.label) }, used, arrow)
    const lines = [eq, ...a.check.rows.map((r) => `${r.what}: ${r.left} → ${r.right} ${r.ok ? '✓' : '✗'}`), `mass: ${num(a.check.massLeft, sig + 2)} → ${num(a.check.massRight, sig + 2)} g/mol ${a.check.massOk ? '✓' : '✗'}`]
    const smi = reactionSmiles(a)
    if (smi !== '>>') lines.push(`reaction SMILES: ${smi}`)
    return lines.join('\n')
  }, [a, used, arrow, sig])

  const pictureSvg = (print: boolean): string | null => {
    if (!a.ready) return null
    const pic = (s: Species, c: number) => ({ svg: s.smiles && kr.rd ? (print ? printSvg(kr.rd, s.smiles, 260, 180) : null) : null, label: s.label, coeff: c })
    return equationSvg({
      reactants: a.reactants.map((s, i) => pic(s, used[i])), products: a.products.map((s, i) => pic(s, used[a.reactants.length + i])),
      arrow, above: b.above, below: b.below, background: print,
    })
  }
  const svgsForPin = () => {
    const p = pictureSvg(true)
    return p ? [p] : []
  }

  const sendToKinetics = () => {
    if (!a.ready) return
    const net = reactionToNetwork(
      a.reactants.map((s, i) => ({ label: s.label, coeff: used[i] })),
      a.products.map((s, i) => ({ label: s.label, coeff: used[a.reactants.length + i] })),
      b.arrow === 'equilibrium',
    )
    kr.patch('kinetics', { text: net, presetId: '', tab: 'simulate', hidden: [] })
    kr.go('kinetics')
  }

  // what the balancer says in words
  const bal = a.balance
  const needsBalance = a.check && !a.check.balanced
  const canApply = bal && bal.coefficients.length > 0 && bal.status !== 'invalid' && bal.status !== 'impossible'

  return (
    <div className="kr-tool-body">
      <Card
        title="Reaction"
        icon={<ArrowRightLeft size={15} />}
        actions={
          <>
            <button className="k-btn small" onClick={swap} title="Swap reactants and products"><ArrowRightLeft size={13} /> Swap</button>
            <button className="k-btn small" onClick={() => kr.patch('builder', { reactants: [''], products: [''], coeffs: null, above: '', below: '', fromId: null })} title="Start again"><Eraser size={13} /> Clear</button>
          </>
        }
      >
        <div className="kr-builder-eq">
          {(['reactants', 'products'] as const).map((side) => (
            <div className="kr-sidecol" key={side}>
              <div className="kr-sidehead">
                <span className="kr-label">{side === 'reactants' ? 'Reactants' : 'Products'}</span>
                <button className="k-icon-btn" onClick={() => addRow(side)} title={`Add a ${side === 'reactants' ? 'reactant' : 'product'}`} aria-label="Add a species"><Plus size={14} /></button>
              </div>
              <div className="kr-species-list">
                {b[side].map((value, i) => {
                  const row = (side === 'reactants' ? 0 : nR) + i
                  const ai = idxMap[row]
                  const sp: Species | undefined = ai >= 0 ? (side === 'reactants' ? a.reactants[ai] : a.products[ai - a.reactants.length]) : undefined
                  // when some earlier rows are empty the index among non-empty rows still points into the right side
                  return (
                    <div className={`kr-sp ${sp?.kind === 'invalid' ? 'bad' : ''}`} key={`${side}${i}`}>
                      <div className="kr-sp-top">
                        <PositiveInput className="k-input kr-coeff-input" value={rowCoeffs[row] ?? 1} label="Coefficient" title="Coefficient" onValid={(v) => setCoeff(row, v)} />
                        <SpeciesInput value={value} onChange={(v) => setRow(side, i, v)} placeholder={side === 'reactants' ? 'ethanol, CCO, O2…' : 'carbon dioxide, O=C=O…'} />
                        <button className="k-icon-btn" onClick={() => removeRow(side, i)} title="Remove this species" aria-label="Remove"><X size={14} /></button>
                      </div>
                      {sp && sp.kind !== 'invalid' && (
                        <div className="kr-sp-body">
                          <Mol smiles={sp.smiles} width={190} height={130} fallback={<span className="kr-bigf"><Fx f={sp.formula} charge={sp.charge} /></span>} />
                          <div className="kr-sp-info kr-small">
                            <span>{sp.name && <b>{sp.name} </b>}<Fx f={sp.formula} charge={sp.charge} /></span>
                            <span className="k-muted">{num(sp.mass, sig + 1)} g/mol · {sp.charge === 0 ? 'neutral' : `charge ${sp.charge > 0 ? '+' : '−'}${Math.abs(sp.charge)}`} · {sp.kind === 'formula' ? 'formula only' : sp.kind}</span>
                          </div>
                          <SpeciesDetails s={sp} />
                        </div>
                      )}
                      {sp && sp.kind === 'invalid' && <Err>{sp.error}</Err>}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="kr-arrowrow">
          <Field label="Arrow">
            <select className="k-input" value={b.arrow} aria-label="Arrow type" onChange={(e) => setBuilder({ arrow: e.target.value as ArrowKind })}>
              {(Object.keys(ARROWS) as ArrowKind[]).map((k) => <option key={k} value={k}>{ARROWS[k].label}</option>)}
            </select>
          </Field>
          <Field label="Above the arrow" hint="catalyst, reagent, hν">
            <input className="k-input" value={b.above} placeholder="H2SO4, Pd/C, hν…" onChange={(e) => setBuilder({ above: e.target.value })} />
          </Field>
          <Field label="Below the arrow" hint="solvent, temperature">
            <input className="k-input" value={b.below} placeholder="ethanol, 78 °C…" onChange={(e) => setBuilder({ below: e.target.value })} />
          </Field>
        </div>
        <div className="kr-predrow">
          <input
            className="k-input kr-mono"
            value={pasted}
            spellCheck={false}
            placeholder="Or paste a whole equation: 2 H2 + O2 -> 2 H2O"
            aria-label="Paste an equation"
            onChange={(e) => { setPasted(e.target.value); setPasteError('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') applyPasted() }}
            onPaste={(e) => {
              const t = e.clipboardData.getData('text')
              if (/->|=>|→|⇌|<=>/.test(t)) {
                e.preventDefault()
                applyPasted(t)
              }
            }}
          />
          <button className="k-btn small" onClick={() => applyPasted()} disabled={pasted.trim() === ''}>Use</button>
        </div>
        {pasteError && <Err>{pasteError}</Err>}
        <Hint>
          A species can be a name from the built-in table (type a few letters), a SMILES string such as CC(=O)O, or a molecular formula such as Fe2O3 or H2SO4.
          Ions go in brackets: [Na+], [OH-].
        </Hint>
      </Card>

      {a.errors.length > 0 && <Card><Err>{a.errors[0]}</Err></Card>}

      {a.ready && a.check && (
        <Card
          title="Check the reaction"
          icon={<Scale size={15} />}
          actions={<ResultActions tool="builder" label="Reaction check" text={text} svgs={svgsForPin} />}
        >
          <EquationView reactants={eqItemsR} products={eqItemsP} arrow={arrow} above={b.above} below={b.below} />
          <div className="kr-badges">
            <span className={`kr-badge ${a.check.atomsOk ? 'ok' : 'bad'}`}>{a.check.atomsOk ? <Check size={12} /> : <X size={12} />} atoms</span>
            <span className={`kr-badge ${a.check.massOk ? 'ok' : 'bad'}`}>{a.check.massOk ? <Check size={12} /> : <X size={12} />} mass</span>
            <span className={`kr-badge ${a.check.chargeOk ? 'ok' : 'bad'}`}>{a.check.chargeOk ? <Check size={12} /> : <X size={12} />} charge</span>
            <span className="k-muted kr-small">
              {a.check.balanced ? 'The equation is balanced.' : 'The equation is not balanced with these coefficients.'}
            </span>
          </div>
          <table className="kr-table kr-checktable">
            <thead><tr><th></th><th>Reactants</th><th>Products</th><th></th></tr></thead>
            <tbody>
              {a.check.rows.map((r) => (
                <tr key={r.what} className={r.ok ? '' : 'kr-bad'}>
                  <td>{r.what}</td><td>{r.left}</td><td>{r.right}</td><td>{r.ok ? <Check size={13} className="kr-okicon" /> : <X size={13} />}</td>
                </tr>
              ))}
              <tr className={a.check.massOk ? '' : 'kr-bad'}>
                <td>mass (g/mol)</td><td>{num(a.check.massLeft, sig + 2)}</td><td>{num(a.check.massRight, sig + 2)}</td><td>{a.check.massOk ? <Check size={13} className="kr-okicon" /> : <X size={13} />}</td>
              </tr>
            </tbody>
          </table>
          {bal && (
            <div className="kr-balancer">
              <div className="kr-actions">
                <button className="k-btn" onClick={applyBalance} disabled={!canApply || !needsBalance} title="Use the smallest whole-number coefficients"><Scale size={14} /> Balance</button>
                <button className="k-btn" onClick={() => kr.patch('builder', { coeffs: null })} disabled={!b.coeffs} title="Back to 1 for every species"><Eraser size={14} /> Reset coefficients</button>
                <button className="k-btn" onClick={sendToKinetics} title="Use this equation as a kinetic model">Kinetics…</button>
                <button className="k-btn" onClick={() => kr.go('predict')} title="Predict what these reactants can form">Predict…</button>
              </div>
              {bal.status === 'impossible' || bal.status === 'invalid'
                ? <Err>{bal.message}</Err>
                : (
                  <div className={bal.status === 'multiple' ? 'kr-warn' : 'kr-ok'}>
                    {bal.message}{' '}
                    {bal.coefficients.length > 0 && <b className="kr-mono">{equationText({ reactants: a.reactants.map((s) => s.label), products: a.products.map((s) => s.label) }, bal.coefficients, arrow)}</b>}
                  </div>
                )}
            </div>
          )}
          <div className="kr-actions">
            <button className="k-btn small" onClick={kr.exportReport} title="Save a Markdown report with the structures"><FileText size={13} /> Report…</button>
            <button className="k-btn small" onClick={() => { const s = pictureSvg(true); if (s) kr.saveImage('reaction', s, 'svg') }} title="Save the equation as a picture (SVG)"><ImageIcon size={13} /> SVG</button>
            <button className="k-btn small" onClick={() => { const s = pictureSvg(true); if (s) kr.saveImage('reaction', s, 'png') }} title="Save the equation as a picture (PNG)"><ImageIcon size={13} /> PNG</button>
            <button className="k-btn small" onClick={() => kr.copy(reactionSmiles(a))} title="Copy the reaction SMILES"><Copy size={13} /> Reaction SMILES</button>
          </div>
        </Card>
      )}
      {!a.ready && a.errors.length === 0 && <Card><div className="k-muted kr-empty">Type at least one reactant and one product to check the reaction.</div></Card>}
    </div>
  )
}
