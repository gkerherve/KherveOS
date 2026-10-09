// The Reference tab: the pKa table, the indicators, the standard potentials, the metal–EDTA constants and the
// solubility products, searchable.

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { INDICATORS, REDOX_INDICATORS } from './data/indicators'
import { METALS, PRECIPITATES } from './data/metals'
import { searchCouples } from './data/potentials'
import { PKA_CATEGORIES, searchPka, type PkaEntry } from './data/pka'
import { KW_TABLE } from './equilibria'
import { fixed, sig } from './format'
import { IndicatorBar, Seg, Swatch } from './ui'

type Table = 'pka' | 'indicators' | 'potentials' | 'metals' | 'ksp' | 'water'

export function ReferenceTab({
  onUsePka, onUseIndicator,
}: {
  onUsePka: (e: PkaEntry, where: 'titration' | 'speciation' | 'buffer') => void
  onUseIndicator: (id: string) => void
}) {
  const [table, setTable] = useState<Table>('pka')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const ql = q.trim().toLowerCase()
  const pka = useMemo(() => searchPka(q, cat as (typeof PKA_CATEGORIES)[number] | ''), [q, cat])
  const inds = useMemo(() => INDICATORS.filter((i) => !ql || `${i.name} ${i.acidName} ${i.baseName} ${i.lo} ${i.hi}`.toLowerCase().includes(ql)), [ql])
  const rinds = useMemo(() => REDOX_INDICATORS.filter((i) => !ql || `${i.name} ${i.E0}`.toLowerCase().includes(ql)), [ql])
  const pots = useMemo(() => searchCouples(q), [q])
  const metals = useMemo(() => METALS.filter((m) => !ql || `${m.symbol} ${m.ion} ${m.logKMY}`.toLowerCase().includes(ql)), [ql])
  const ksp = useMemo(() => PRECIPITATES.filter((p) => !ql || `${p.formula} ${p.cation} ${p.anion} ${p.Ksp}`.toLowerCase().includes(ql)), [ql])
  const water = useMemo(() => KW_TABLE.filter(([t, p]) => !ql || `${t} ${p}`.includes(ql)), [ql])
  const count = table === 'pka' ? pka.length : table === 'indicators' ? inds.length + rinds.length : table === 'potentials' ? pots.length : table === 'metals' ? metals.length : table === 'ksp' ? ksp.length : water.length

  return (
    <div className="ti-reference">
      <div className="ti-refbar">
        <Seg label="Table" value={table} options={[
          { id: 'pka', label: 'pKa' }, { id: 'indicators', label: 'Indicators' }, { id: 'potentials', label: 'Potentials' }, { id: 'metals', label: 'Metal–EDTA' }, { id: 'ksp', label: 'Solubility' }, { id: 'water', label: 'Water (Kw)' },
        ]} onChange={setTable} />
        <label className="ti-search">
          <Search size={13} />
          <input className="k-input" value={q} placeholder="Search…" aria-label="Search the table" onChange={(e) => setQ(e.target.value)} />
        </label>
        {table === 'pka' && (
          <select className="k-input ti-select" value={cat} aria-label="Category" onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            {PKA_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
        <span className="ti-muted">{count} {count === 1 ? 'entry' : 'entries'}</span>
      </div>
      <div className="ti-scroll ti-refbody">
        {table === 'pka' && (
          <table className="ti-table ref">
            <thead><tr><th>Name</th><th>Formula</th><th>pKa (25 °C)</th><th>Charge</th><th>Category</th></tr></thead>
            <tbody>
              {pka.map((e) => (
                <PkaRow key={e.id} e={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} onUse={onUsePka} />
              ))}
              {pka.length === 0 && <tr><td colSpan={5} className="ti-muted">Nothing matches “{q}”.</td></tr>}
            </tbody>
          </table>
        )}
        {table === 'indicators' && (
          <>
            <table className="ti-table ref">
              <thead><tr><th>Acid–base indicator</th><th>Range</th><th>Colour change</th><th>Colours, pH 0–14</th><th /></tr></thead>
              <tbody>
                {inds.map((i) => (
                  <tr key={i.id}>
                    <th scope="row">{i.name}{i.note && <div className="ti-sub">{i.note}</div>}</th>
                    <td>{i.stops ? 'broad' : `${i.lo}–${i.hi}`}</td>
                    <td><Swatch color={i.acid} /> {i.acidName} <span className="ti-muted">→</span> <Swatch color={i.base} /> {i.baseName}</td>
                    <td className="ti-barcell"><IndicatorBar ind={i} compact /></td>
                    <td><button type="button" className="k-btn small" onClick={() => onUseIndicator(i.id)} title="Put it in the flask of the acid–base titration">Use</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rinds.length > 0 && (
              <table className="ti-table ref">
                <thead><tr><th>Redox indicator</th><th>E° (V)</th><th>Electrons</th><th>Colour change (reduced → oxidised)</th></tr></thead>
                <tbody>
                  {rinds.map((i) => <tr key={i.id}><th scope="row">{i.name}{i.note && <div className="ti-sub">{i.note}</div>}</th><td>{fixed(i.E0, 2)}</td><td>{i.n}</td><td><Swatch color={i.red} /> {i.redName} <span className="ti-muted">→</span> <Swatch color={i.ox} /> {i.oxName}</td></tr>)}
                </tbody>
              </table>
            )}
          </>
        )}
        {table === 'potentials' && (
          <table className="ti-table ref">
            <thead><tr><th>Half-reaction</th><th>E° / V vs SHE</th><th>n</th><th>H⁺</th><th>Formal potentials</th></tr></thead>
            <tbody>
              {pots.map((c) => <tr key={c.id}><th scope="row">{c.half}{c.note && <div className="ti-sub">{c.note}</div>}</th><td>{c.E0 > 0 ? '+' : ''}{c.E0.toFixed(3)}</td><td>{c.n}</td><td>{c.m || ''}</td><td>{c.formal?.map((f) => `${f.E} V in ${f.medium}`).join('; ') ?? ''}</td></tr>)}
            </tbody>
          </table>
        )}
        {table === 'metals' && (
          <table className="ti-table ref">
            <thead><tr><th>Metal ion</th><th>log K (M–EDTA)</th><th>log β hydroxo</th><th>log β ammine</th><th>Source</th></tr></thead>
            <tbody>
              {metals.map((m) => <tr key={m.id}><th scope="row">{m.ion}</th><td>{m.logKMY}</td><td>{m.hydroxo.join(', ') || '–'}</td><td>{m.ammine.join(', ') || '–'}</td><td className="ti-sub">{m.source}</td></tr>)}
            </tbody>
          </table>
        )}
        {table === 'ksp' && (
          <table className="ti-table ref">
            <thead><tr><th>Solid</th><th>Dissolves to</th><th>K<sub>sp</sub></th><th>pK<sub>sp</sub></th></tr></thead>
            <tbody>
              {ksp.map((p) => <tr key={p.id}><th scope="row">{p.formula}{p.note && <div className="ti-sub">{p.note}</div>}</th><td>{p.nCat > 1 ? p.nCat : ''}{p.cation} + {p.nAn > 1 ? p.nAn : ''}{p.anion}</td><td>{sig(p.Ksp, 3)}</td><td>{fixed(-Math.log10(p.Ksp), 2)}</td></tr>)}
            </tbody>
          </table>
        )}
        {table === 'water' && (
          <table className="ti-table ref">
            <thead><tr><th>Temperature</th><th>pK<sub>w</sub></th><th>K<sub>w</sub></th><th>Neutral pH</th></tr></thead>
            <tbody>
              {water.map(([t, p]) => <tr key={t}><th scope="row">{t} °C</th><td>{p.toFixed(2)}</td><td>{sig(Math.pow(10, -p), 3)}</td><td>{(p / 2).toFixed(2)}</td></tr>)}
            </tbody>
          </table>
        )}
        <p className="ti-hint">Typical literature values at 25 °C (CRC Handbook, Harris, Lehninger, Good et al.), rounded: real solutions differ with ionic strength, temperature and medium. {table === 'pka' ? 'Open an entry to see its species, its temperature coefficient and its source.' : ''}</p>
      </div>
    </div>
  )
}

function PkaRow({ e, open, onToggle, onUse }: { e: PkaEntry; open: boolean; onToggle: () => void; onUse: (e: PkaEntry, where: 'titration' | 'speciation' | 'buffer') => void }) {
  return (
    <>
      <tr className={open ? 'on' : ''}>
        <th scope="row"><button type="button" className="ti-link" aria-expanded={open} onClick={onToggle}>{e.name}</button></th>
        <td>{e.formula}</td>
        <td>{e.pKa.join(', ')}</td>
        <td>{e.z0 > 0 ? '+' : e.z0 < 0 ? '−' : ''}{Math.abs(e.z0)}</td>
        <td>{e.category}</td>
      </tr>
      {open && (
        <tr className="ti-detail">
          <td colSpan={5}>
            <div className="ti-detail-body">
              <div><b>Species:</b> {e.forms.join('  ⇌  ')}</div>
              {e.note && <div>{e.note}</div>}
              {e.dpKadT && <div>d(pKa)/dT: {e.dpKadT.map((d) => (d > 0 ? '+' : '') + d).join(', ')} per °C.</div>}
              <div className="ti-sub">Source: {e.source}</div>
              <div className="ti-btnrow">
                <button type="button" className="k-btn small" onClick={() => onUse(e, 'titration')}>Titrate it</button>
                <button type="button" className="k-btn small" onClick={() => onUse(e, 'speciation')}>Speciation diagram</button>
                <button type="button" className="k-btn small" onClick={() => onUse(e, 'buffer')}>Design a buffer</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
