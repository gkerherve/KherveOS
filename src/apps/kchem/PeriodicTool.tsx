// The periodic table: all 118 elements, coloured by category, state or block, with a search box and a
// detail panel; a click can add the element to the formula.

import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import {
  CATEGORIES, CATEGORY_LABEL, ELEMENTS, ISOTOPES, electronConfiguration, gridPosition, searchElements, valenceElectrons, type Category, type Element,
} from './elements'
import { fmt } from './chem'
import type { PeriodicForm } from './forms'
import { Card, Fx, Hint, ResultActions, Select, useKc } from './ui'

const STATES = ['solid', 'liquid', 'gas', 'unknown'] as const
const BLOCKS = ['s', 'p', 'd', 'f'] as const

const colourClass = (e: Element, mode: PeriodicForm['colour']) => `kc-c-${mode === 'category' ? e.category : mode === 'state' ? e.state : `block-${e.block}`}`

const kelvin = (k: number | null) => (k === null ? '—' : `${fmt(k)} K (${fmt(k - 273.15)} °C)`)

function describe(e: Element): string {
  const lines = [
    `${e.name} (${e.symbol}), Z = ${e.z}`,
    `Atomic weight ${fmt(e.weight, 6)}${e.radioactive ? ' (mass number of the longest-lived isotope)' : ''}`,
    `${CATEGORY_LABEL[e.category]}; period ${e.period}, ${e.group === null ? 'f-block series' : `group ${e.group}`}, ${e.block}-block`,
    `Electron configuration ${electronConfiguration(e.z)}`,
    `Electronegativity ${e.en ?? '—'}; melting ${kelvin(e.mp)}; boiling ${kelvin(e.bp)}`,
    `Density ${e.density === null ? '—' : e.state === 'gas' ? `${fmt(e.density * 1000)} g/L` : `${fmt(e.density)} g/cm³`}; state at 25 °C: ${e.state}`,
    `Oxidation states ${e.oxidation.map((o) => (o > 0 ? `+${o}` : String(o))).join(', ') || '—'}`,
    e.year === 'ancient' ? 'Known since antiquity' : `Discovered ${e.year}, ${e.discoverer}`,
  ]
  return lines.join('\n')
}

function Detail({ e, onAdd }: { e: Element; onAdd: () => void }) {
  const iso = ISOTOPES[e.symbol]
  const val = valenceElectrons(e)
  const density = e.density === null ? '—' : e.state === 'gas' ? `${fmt(e.density * 1000)} g/L (0 °C, 1 atm)` : `${fmt(e.density)} g/cm³`
  return (
    <Card
      className="kc-detail"
      actions={
        <>
          <button className="k-btn small primary" onClick={onAdd} title={`Add ${e.symbol} to the formula`}><Plus size={13} /> Add to formula</button>
          <ResultActions tool="periodic" label={e.name} text={describe(e)} />
        </>
      }
    >
      <div className="kc-detail-head">
        <div className={`kc-tile ${colourClass(e, 'category')}`}>
          <span className="kc-tile-z">{e.z}</span>
          <span className="kc-tile-sym">{e.symbol}</span>
          <span className="kc-tile-w">{fmt(e.weight, 5)}</span>
        </div>
        <div>
          <h3 className="kc-detail-name">{e.name}</h3>
          <div className="k-muted">{CATEGORY_LABEL[e.category]}</div>
        </div>
      </div>
      <div className="kc-kv kc-kv-wide">
        <span>Atomic number</span><b>{e.z}</b>
        <span>Standard atomic weight</span><b>{fmt(e.weight, 6)} u{e.radioactive && <span className="k-muted"> (longest-lived isotope)</span>}</b>
        <span>Group · period · block</span><b>{e.group ?? 'f-series'} · {e.period} · {e.block}</b>
        <span>Electron configuration</span><b className="kc-mono">{electronConfiguration(e.z)}</b>
        <span>Full configuration</span><b className="kc-mono kc-small">{electronConfiguration(e.z, false)}</b>
        {val !== null && (<><span>Valence electrons</span><b>{val}</b></>)}
        <span>Electronegativity (Pauling)</span><b>{e.en ?? '—'}</b>
        <span>Melting point</span><b>{kelvin(e.mp)}</b>
        <span>Boiling point</span><b>{kelvin(e.bp)}</b>
        <span>Density</span><b>{density}</b>
        <span>State at 25 °C</span><b>{e.state}</b>
        <span>Common oxidation states</span><b>{e.oxidation.length ? e.oxidation.map((o) => (o > 0 ? `+${o}` : String(o))).join(', ') : '—'}</b>
        <span>Discovered</span><b>{e.year === 'ancient' ? 'Known since antiquity' : `${e.year}${e.discoverer ? ` · ${e.discoverer}` : ''}`}</b>
        {iso && iso.length > 0 && (
          <>
            <span>Natural isotopes</span>
            <b className="kc-small">{iso.filter((i) => i.abundance >= 0.01).map((i) => `${Math.round(i.mass)}${e.symbol} ${fmt(i.abundance, 4)} %`).join(' · ')}</b>
          </>
        )}
      </div>
    </Card>
  )
}

export function PeriodicTool({ f, set, formula, setFormula }: { f: PeriodicForm; set: (p: Partial<PeriodicForm>) => void; formula: string; setFormula: (s: string) => void }) {
  const kc = useKc()
  const [hover, setHover] = useState<number | null>(null)
  const matches = useMemo(() => new Set(searchElements(f.query).map((e) => e.z)), [f.query])
  const query = f.query.trim() !== ''
  const shown = ELEMENTS[(hover ?? f.selected ?? 0) - 1] ?? ELEMENTS[25]

  const pick = (e: Element) => {
    set({ selected: e.z })
    if (f.append) kc.insertElement(e.symbol)
  }

  const legend: { id: string; label: string }[] =
    f.colour === 'category'
      ? CATEGORIES.map((c: Category) => ({ id: c, label: CATEGORY_LABEL[c] }))
      : f.colour === 'state'
        ? STATES.map((s) => ({ id: s, label: s === 'unknown' ? 'Unknown / not measured' : `${s[0].toUpperCase()}${s.slice(1)} at 25 °C` }))
        : BLOCKS.map((b) => ({ id: b, label: `${b}-block` }))
  const inFilter = (e: Element): boolean => {
    if (!f.filter) return true
    return (f.colour === 'category' ? e.category : f.colour === 'state' ? e.state : e.block) === f.filter
  }

  return (
    <div className="kc-tool-body">
      <div className="kc-ptoolbar">
        <label className="kc-search">
          <Search size={14} />
          <input
            className="k-input"
            value={f.query}
            placeholder="Search: Fe, iron, 26, halogen…"
            aria-label="Search elements"
            spellCheck={false}
            onChange={(e) => set({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const first = searchElements(f.query)[0]
                if (first) set({ selected: first.z })
              }
            }}
          />
        </label>
        <Select value={f.colour} onChange={(colour) => set({ colour, filter: '' })} label="Colour by" options={[{ id: 'category', label: 'Colour: category' }, { id: 'state', label: 'Colour: state at 25 °C' }, { id: 'block', label: 'Colour: block' }]} />
        <label className="kc-check"><input type="checkbox" checked={f.append} onChange={(e) => set({ append: e.target.checked })} /> Click adds to formula</label>
      </div>

      <div className="kc-ptable-wrap">
        <div className="kc-ptable" role="group" aria-label="Periodic table">
          {ELEMENTS.map((e) => {
            const { row, col } = gridPosition(e)
            const dim = (query && !matches.has(e.z)) || !inFilter(e)
            return (
              <button
                key={e.z}
                className={`kc-el-cell ${colourClass(e, f.colour)} ${f.selected === e.z ? 'sel' : ''} ${dim ? 'dim' : ''} ${query && matches.has(e.z) ? 'hit' : ''}`}
                style={{ gridRow: row, gridColumn: col }}
                onClick={() => pick(e)}
                onMouseEnter={() => setHover(e.z)}
                onMouseLeave={() => setHover((h) => (h === e.z ? null : h))}
                onFocus={() => setHover(e.z)}
                onBlur={() => setHover((h) => (h === e.z ? null : h))}
                title={`${e.name} (${e.z})`}
                aria-label={`${e.name}, atomic number ${e.z}`}
              >
                <span className="kc-el-z">{e.z}</span>
                <span className="kc-el-sym">{e.symbol}</span>
                <span className="kc-el-w">{Number(e.weight.toPrecision(5))}</span>
              </button>
            )
          })}
          <div className="kc-el-note" style={{ gridRow: 9, gridColumn: '1 / 3' }}>La–Yb</div>
          <div className="kc-el-note" style={{ gridRow: 10, gridColumn: '1 / 3' }}>Ac–No</div>
        </div>
      </div>

      <div className="kc-legend">
        {legend.map((l) => (
          <button
            key={l.id}
            className={`kc-legend-item ${f.filter === l.id ? 'on' : ''}`}
            onClick={() => set({ filter: f.filter === l.id ? '' : l.id })}
            title="Click to highlight just these"
          >
            <span className={`kc-swatch kc-c-${f.colour === 'block' ? `block-${l.id}` : l.id}`} />
            {l.label}
          </button>
        ))}
      </div>

      <Card className="kc-formulastrip">
        <div className="kc-formula-row">
          <span className="kc-label">Formula</span>
          <input className="k-input kc-wide kc-mono" value={formula} onChange={(e) => setFormula(e.target.value)} spellCheck={false} aria-label="Formula" placeholder="click elements to build a formula" />
          <button className="k-btn" onClick={() => setFormula('')} disabled={!formula}>Clear</button>
          <button className="k-btn primary" onClick={() => kc.go('formula')}>Molar mass…</button>
        </div>
        {formula.trim() !== '' && <div className="kc-bigformula kc-small"><Fx f={formula} /></div>}
        <Hint>Click elements to build a formula, then type the counts in the field (H2O: click H, type 2, click O).</Hint>
      </Card>

      <Detail e={shown} onAdd={() => kc.insertElement(shown.symbol)} />
    </div>
  )
}
