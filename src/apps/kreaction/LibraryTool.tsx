// Reaction library: ~50 curated reactions with conditions, an explanation and (for many) a step-by-step mechanism.

import { useMemo } from 'react'
import { Activity, BookOpen, Search, Workflow } from 'lucide-react'
import { EquationView, type EqItem } from './EquationView'
import { LIBRARY, REACTION_CLASSES, findReaction, searchLibrary, type LibReaction, type ReactionClass } from './library'
import { equationText } from './balance'
import { ARROWS, resolveSpecies } from './reaction'
import { printSvg } from './structures'
import { equationSvg } from './compose'
import { Card, Hint, ResultActions, useKr } from './ui'

/** The species of a library reaction as picture items. */
export function libraryItems(r: LibReaction): { reactants: EqItem[]; products: EqItem[] } {
  const item = (smiles: string, coeff: number): EqItem => {
    const s = resolveSpecies(smiles)
    return { smiles, label: s.formula, name: s.name, coeff, charge: s.charge }
  }
  return {
    reactants: r.reactants.map((s, i) => item(s, r.coeffs[i])),
    products: r.products.map((s, i) => item(s, r.coeffs[r.reactants.length + i])),
  }
}

export function libraryText(r: LibReaction): string {
  const it = libraryItems(r)
  const eq = equationText({ reactants: it.reactants.map((x) => x.name ?? x.label), products: it.products.map((x) => x.name ?? x.label) }, r.coeffs, ARROWS[r.arrow].symbol)
  const lines = [`${r.name} (${r.cls})`, eq, `Reagents: ${r.above || '—'}; conditions: ${r.below || '—'}`]
  if (r.dH !== undefined) lines.push(`ΔH = ${r.dH} kJ per equation as written`)
  if (r.ea !== undefined) lines.push(`Ea (uncatalysed) ≈ ${r.ea} kJ/mol`)
  lines.push('', r.explanation)
  return lines.join('\n')
}

export function LibraryTool() {
  const kr = useKr()
  const lib = kr.ws.library
  const list = useMemo(() => searchLibrary(lib.query, lib.cls as ReactionClass | ''), [lib.query, lib.cls])
  const selected = (lib.selected ? findReaction(lib.selected) : null) ?? list[0] ?? null
  const items = useMemo(() => (selected ? libraryItems(selected) : null), [selected])
  const pinSvgs = () => {
    if (!selected || !items || !kr.rd) return []
    const rd = kr.rd
    const pic = (x: EqItem) => ({ svg: x.smiles ? printSvg(rd, x.smiles, 260, 180) : null, label: x.label, coeff: x.coeff ?? 1 })
    return [equationSvg({ reactants: items.reactants.map(pic), products: items.products.map(pic), arrow: ARROWS[selected.arrow].symbol, above: selected.above, below: selected.below, background: true })]
  }

  return (
    <div className="kr-split">
      <aside className="kr-list">
        <div className="kr-search">
          <Search size={14} />
          <input className="k-input" value={lib.query} placeholder="Search reactions…" aria-label="Search reactions" onChange={(e) => kr.patch('library', { query: e.target.value })} />
        </div>
        <select className="k-input" value={lib.cls} aria-label="Reaction class" onChange={(e) => kr.patch('library', { cls: e.target.value })}>
          <option value="">All classes ({LIBRARY.length})</option>
          {REACTION_CLASSES.map((c) => <option key={c} value={c}>{c} ({LIBRARY.filter((r) => r.cls === c).length})</option>)}
        </select>
        <ul className="kr-rlist">
          {list.map((r) => (
            <li key={r.id}>
              <button className={`kr-ritem ${selected?.id === r.id ? 'on' : ''}`} onClick={() => kr.patch('library', { selected: r.id })}>
                <span className="kr-rname">{r.name}</span>
                <span className="kr-rmeta k-muted">
                  {r.cls}{r.mechanism ? ' · mechanism' : ''}
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="k-muted kr-empty">No reaction matches.</li>}
        </ul>
      </aside>
      <div className="kr-detail">
        {selected && items ? (
          <Card
            title={selected.name}
            icon={<BookOpen size={15} />}
            actions={<ResultActions tool="library" label={selected.name} text={libraryText(selected)} svgs={pinSvgs} />}
          >
            <div className="kr-chips">
              <span className="kr-chip on">{selected.cls}</span>
              {selected.mechanism && <span className="kr-chip">{selected.mechanism.length - 1} step{selected.mechanism.length === 2 ? '' : 's'}</span>}
              <span className="kr-chip">{selected.arrow === 'equilibrium' ? 'equilibrium' : 'one direction'}</span>
            </div>
            <EquationView reactants={items.reactants} products={items.products} arrow={ARROWS[selected.arrow].symbol} above={selected.above} below={selected.below} />
            <p className="kr-explain">{selected.explanation}</p>
            <div className="kr-kv">
              <span>Reagents</span><b>{selected.above || '—'}</b>
              <span>Conditions</span><b>{selected.below || '—'}</b>
              {selected.dH !== undefined && <><span>ΔH (equation as written)</span><b>{selected.dH} kJ</b></>}
              {selected.ea !== undefined && <><span>Activation energy (uncatalysed)</span><b>≈ {selected.ea} kJ/mol</b></>}
            </div>
            <div className="kr-actions">
              <button className="k-btn" onClick={() => kr.loadReaction(selected.id, 'builder')} title="Open this reaction in the reaction builder to check and edit it"><BookOpen size={14} /> Load in builder</button>
              <button className="k-btn" disabled={!selected.mechanism} onClick={() => kr.loadReaction(selected.id, 'mechanism')} title={selected.mechanism ? 'Step through the mechanism' : 'No mechanism for this reaction'}><Workflow size={14} /> Mechanism</button>
              <button className="k-btn" onClick={() => kr.loadReaction(selected.id, 'energy')} title="Open its energy profile"><Activity size={14} /> Energy profile</button>
            </div>
          </Card>
        ) : (
          <Card><Hint>Pick a reaction from the list.</Hint></Card>
        )}
      </div>
    </div>
  )
}
