// The structured blocks inside an entry, as live editors: reaction table, materials, measurements, instrument run,
// observation timeline, safety box, plot, protocol steps, image, attached file. Each is a Tiptap node view whose data
// is the node's `block` attribute; a signed entry shows them read-only.

import { useEffect, useMemo, useState, type ClipboardEvent } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import {
  Beaker, ClipboardList, Clock, FileText, FlaskConical, GripVertical, Image as ImageIcon, LineChart, ListChecks, Microscope, Paperclip, Plus, Ruler, ShieldAlert, Star, Trash2, X,
} from 'lucide-react'
import {
  BLOCK_LABELS, GHS_PICTOGRAMS, PPE_ITEMS, isBlock, newBlock, type Block, type FileData, type ImageData, type InstrumentData, type MaterialsData, type PlotData, type SafetyData, type StepsData, type TimelineData,
} from './blocks'
import { prettyFormula } from './formula'
import { localStamp } from './notebook'
import { columnStats, computeReaction, fmt, fmtPct, meanSd, newReagent, type MeasurementData, type ReactionData, type Reagent, type ReagentRole } from './reaction'
import { reagentFromInventory } from './samples'
import { schemeSvg } from './rdkit'
import { useBlockEnv } from './env'
import { PlotView } from './PlotView'
import { Chip, Html, NumInput, shortTime } from './ui'
import { fileSize } from './blocks'

interface P<D> {
  data: D
  set(d: D): void
  ro: boolean
}

const upd = <T,>(arr: T[], i: number, patch: Partial<T>): T[] => arr.map((x, k) => (k === i ? { ...x, ...patch } : x))
const del = <T,>(arr: T[], i: number): T[] => arr.filter((_, k) => k !== i)
const nowLocal = (): string => localStamp(new Date().toISOString())

function Title({ value, onChange, ro, placeholder = 'Title' }: { value: string; onChange(v: string): void; ro: boolean; placeholder?: string }) {
  return <input className="ln-cell ln-block-title" value={value} placeholder={placeholder} disabled={ro} onChange={(e) => onChange(e.target.value)} aria-label="Block title" />
}

/** Grid paste: "a\tb\nc\td" fills the table from the cell where it lands. */
function pasteGrid(e: ClipboardEvent<HTMLInputElement>, rows: string[][], r: number, c: number, cols: number): string[][] | null {
  const text = e.clipboardData.getData('text/plain')
  if (!/[\t\n]/.test(text.trim())) return null
  e.preventDefault()
  const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((l) => l.split('\t'))
  const out = rows.map((x) => [...x])
  lines.forEach((line, dr) => {
    while (out.length <= r + dr) out.push(Array.from({ length: cols }, () => ''))
    line.forEach((v, dc) => { if (c + dc < cols) out[r + dr][c + dc] = v.trim() })
  })
  return out
}

// ------------------------------------------------------------------ reaction

const ROLES: ReagentRole[] = ['reactant', 'reagent', 'catalyst', 'solvent', 'product']

function ReactionEditor({ data, set, ro }: P<ReactionData>) {
  const env = useBlockEnv()
  const res = useMemo(() => computeReaction(data), [data])
  const [svg, setSvg] = useState<string | null>(null)
  const listId = useMemo(() => `inv-${Math.random().toString(36).slice(2, 7)}`, [])
  useEffect(() => {
    let dead = false
    if (!data.smiles.trim()) { setSvg(null); return }
    const t = setTimeout(() => { void schemeSvg(data.smiles).then((s) => { if (!dead) setSvg(s) }) }, 450)
    return () => { dead = true; clearTimeout(t) }
  }, [data.smiles])
  const setR = (i: number, patch: Partial<Reagent>) => set({ ...data, reagents: upd(data.reagents, i, patch) })
  const nameChanged = (i: number, name: string) => {
    const hit = env.inventory.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())
    if (hit) {
      const from = reagentFromInventory(hit, data.reagents[i].role)
      const r = data.reagents[i]
      setR(i, { name, formula: r.formula || from.formula, mw: r.mw ?? from.mw, density: r.density ?? from.density, cas: r.cas || from.cas })
    } else setR(i, { name })
  }
  const limiting = res.limitingIndex != null ? data.reagents[res.limitingIndex] : null
  const products = res.rows.filter((r) => data.reagents[r.index].role === 'product' && r.theoretical != null)
  return (
    <div className="ln-reaction">
      <Title value={data.title} onChange={(title) => set({ ...data, title })} ro={ro} placeholder="Reaction title" />
      {svg && <Html html={svg} className="ln-scheme" />}
      <div className="ln-scroll">
        <table className="ln-grid ln-rtable">
          <thead>
            <tr>
              <th title="Limiting reagent (click to force)" aria-label="Limiting" />
              <th>Role</th><th>Compound</th><th>Formula</th><th title="g/mol">MW</th><th title="Coefficient in the equation">n</th><th>Mass (g)</th><th>Vol (mL)</th><th title="g/mL">ρ</th><th>mmol</th><th>Equiv</th><th>Theor. (g)</th><th>Actual (g)</th><th>Yield</th><th />
            </tr>
          </thead>
          <tbody>
            {data.reagents.map((r, i) => {
              const row = res.rows[i]
              const prod = r.role === 'product'
              return (
                <tr key={i} className={row.limiting ? 'ln-limiting' : ''}>
                  <td>
                    {!prod && (
                      <button className={`k-icon-btn ln-star${row.limiting ? ' active' : ''}`} disabled={ro} aria-label={row.limiting ? 'Limiting reagent' : 'Make limiting reagent'} aria-pressed={row.limiting} title={r.limiting ? 'Forced as limiting: click to go back to automatic' : row.limiting ? 'Limiting reagent (found automatically); click to force' : 'Make this the limiting reagent'}
                        onClick={() => set({ ...data, reagents: data.reagents.map((x, k) => ({ ...x, limiting: k === i ? !r.limiting : false })) })}>
                        <Star size={13} fill={row.limiting ? 'currentColor' : 'none'} />
                      </button>
                    )}
                  </td>
                  <td><select className="ln-cell" value={r.role} disabled={ro} aria-label="Role" onChange={(e) => setR(i, { role: e.target.value as ReagentRole })}>{ROLES.map((x) => <option key={x}>{x}</option>)}</select></td>
                  <td><input className="ln-cell wide" list={listId} value={r.name} disabled={ro} aria-label="Compound" onChange={(e) => nameChanged(i, e.target.value)} /></td>
                  <td><input className="ln-cell" value={r.formula} disabled={ro} aria-label="Formula" title={row.problem ?? (r.formula ? prettyFormula(r.formula) : '')} style={row.problem && /formula/i.test(row.problem) ? { borderColor: 'var(--k-danger)' } : undefined} onChange={(e) => setR(i, { formula: e.target.value })} /></td>
                  <td><NumInput value={r.mw} onChange={(mw) => setR(i, { mw })} disabled={ro} placeholder={fmt(row.mw, 5)} title="Molar mass; empty = from the formula" /></td>
                  <td><NumInput value={r.coef === 1 ? null : r.coef} onChange={(c) => setR(i, { coef: c && c > 0 ? c : 1 })} disabled={ro} placeholder="1" width={42} /></td>
                  <td><NumInput value={r.mass} onChange={(mass) => setR(i, { mass })} disabled={ro || prod} placeholder={prod ? '' : fmt(row.mass)} /></td>
                  <td><NumInput value={r.volume} onChange={(volume) => setR(i, { volume })} disabled={ro || prod} placeholder={prod ? '' : fmt(row.volume)} /></td>
                  <td><NumInput value={r.density} onChange={(density) => setR(i, { density })} disabled={ro || prod} /></td>
                  <td><NumInput value={prod ? null : r.mmol} onChange={(mmol) => setR(i, { mmol })} disabled={ro || prod} placeholder={prod ? fmt(row.theoreticalMmol) : fmt(row.mmol)} /></td>
                  <td className="num">{prod ? '' : fmt(row.equiv)}</td>
                  <td className="num">{prod ? fmt(row.theoretical) : ''}</td>
                  <td>{prod ? <NumInput value={r.actual} onChange={(actual) => setR(i, { actual })} disabled={ro} /> : null}</td>
                  <td className="num ln-yield">{prod ? fmtPct(row.yieldPct) : ''}</td>
                  <td>{!ro && <button className="k-icon-btn" aria-label="Remove row" onClick={() => set({ ...data, reagents: del(data.reagents, i) })}><X size={13} /></button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <datalist id={listId}>{env.inventory.map((x) => <option key={x.id} value={x.name} />)}</datalist>
      </div>
      {res.rows.some((r) => r.problem) && (
        <ul className="ln-hints">{res.rows.flatMap((r, i) => (r.problem ? [<li key={i}>{data.reagents[i].name || `Row ${i + 1}`}: {r.problem}</li>] : []))}</ul>
      )}
      <div className="ln-summary">
        {limiting ? <>Limiting reagent: <b>{limiting.name || limiting.formula || 'row ' + (res.limitingIndex! + 1)}</b></> : <span className="k-muted">Enter an amount for the reactants to find the limiting reagent.</span>}
        {products.map((r) => <span key={r.index}> · {data.reagents[r.index].name || 'product'}: theoretical <b>{fmt(r.theoretical)} g</b>{r.yieldPct != null && <> · yield <b>{r.yieldPct.toFixed(1)} %</b></>}</span>)}
      </div>
      {!ro && (
        <div className="ln-row-actions">
          {(['reactant', 'reagent', 'solvent', 'product'] as ReagentRole[]).map((role) => (
            <button key={role} className="k-btn small" onClick={() => set({ ...data, reagents: [...data.reagents, newReagent(role)] })}><Plus size={12} /> {role}</button>
          ))}
          {env.inventory.length > 0 && (
            <select className="k-input ln-sel" value="" aria-label="Add from the inventory" onChange={(e) => {
              const item = env.inventory.find((x) => x.id === e.target.value)
              if (item) set({ ...data, reagents: [...data.reagents.filter((r) => r.name || r.formula || r.mass || r.volume), reagentFromInventory(item)] })
            }}>
              <option value="">Add from inventory…</option>
              {env.inventory.map((x) => <option key={x.id} value={x.id}>{x.name}{x.cas ? ` (${x.cas})` : ''}</option>)}
            </select>
          )}
        </div>
      )}
      <details className="ln-smiles" open={!!data.smiles}>
        <summary>Reaction scheme picture (RDKit)</summary>
        <input className="k-input" placeholder="Reaction SMILES, e.g. OC(=O)c1ccccc1O.CC(=O)OC(C)=O>>CC(=O)Oc1ccccc1C(O)=O.CC(O)=O" value={data.smiles} disabled={ro} aria-label="Reaction SMILES" onChange={(e) => set({ ...data, smiles: e.target.value })} />
        {data.smiles && !svg && <small className="k-muted">Drawing the scheme… (if nothing appears, RDKit could not read the SMILES)</small>}
      </details>
      <textarea className="k-input ln-notes" rows={1} placeholder="Notes on the reaction" value={data.notes} disabled={ro} onChange={(e) => set({ ...data, notes: e.target.value })} />
    </div>
  )
}

// ------------------------------------------------------------------ materials

function MaterialsEditor({ data, set, ro }: P<MaterialsData>) {
  const env = useBlockEnv()
  const setI = (i: number, patch: Partial<MaterialsData['items'][number]>) => set({ ...data, items: upd(data.items, i, patch) })
  const listId = useMemo(() => `mat-${Math.random().toString(36).slice(2, 7)}`, [])
  return (
    <div>
      <Title value={data.title} onChange={(title) => set({ ...data, title })} ro={ro} />
      <div className="ln-scroll">
        <table className="ln-grid">
          <thead><tr><th>Name</th><th>CAS</th><th>Supplier</th><th>Lot</th><th>Amount</th><th>Hazard</th><th /></tr></thead>
          <tbody>
            {data.items.map((m, i) => (
              <tr key={i}>
                <td><input className="ln-cell wide" list={listId} value={m.name} disabled={ro} aria-label="Name" onChange={(e) => {
                  const hit = env.inventory.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase())
                  setI(i, hit ? { name: e.target.value, cas: m.cas || hit.cas, supplier: m.supplier || hit.supplier, lot: m.lot || hit.lot, hazard: m.hazard || hit.hazard, inventoryId: hit.id } : { name: e.target.value })
                }} /></td>
                {(['cas', 'supplier', 'lot', 'amount', 'hazard'] as const).map((k) => <td key={k}><input className="ln-cell" value={m[k]} disabled={ro} aria-label={k} onChange={(e) => setI(i, { [k]: e.target.value })} /></td>)}
                <td>{!ro && <button className="k-icon-btn" aria-label="Remove row" onClick={() => set({ ...data, items: del(data.items, i) })}><X size={13} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id={listId}>{env.inventory.map((x) => <option key={x.id} value={x.name} />)}</datalist>
      </div>
      {!ro && <div className="ln-row-actions"><button className="k-btn small" onClick={() => set({ ...data, items: [...data.items, { name: '', cas: '', supplier: '', lot: '', amount: '', hazard: '' }] })}><Plus size={12} /> Row</button></div>}
    </div>
  )
}

// ------------------------------------------------------------------ measurements and plot data

function GridEditor({ columns, rows, onChange, ro, firstColumnLabel }: {
  columns: Array<{ name: string; unit: string }>; rows: string[][]; ro: boolean
  onChange(columns: Array<{ name: string; unit: string }>, rows: string[][]): void; firstColumnLabel?: string
}) {
  return (
    <>
      <div className="ln-scroll">
        <table className="ln-grid ln-measure">
          <thead>
            <tr>
              {columns.map((c, ci) => (
                <th key={ci}>
                  <input className="ln-cell head" value={c.name} disabled={ro} aria-label={`Column ${ci + 1} name`} placeholder={firstColumnLabel ?? 'Name'} onChange={(e) => onChange(columns.map((x, k) => (k === ci ? { ...x, name: e.target.value } : x)), rows)} />
                  <input className="ln-cell unit" value={c.unit} disabled={ro} aria-label={`Column ${ci + 1} unit`} placeholder="unit" onChange={(e) => onChange(columns.map((x, k) => (k === ci ? { ...x, unit: e.target.value } : x)), rows)} />
                  {!ro && columns.length > 1 && <button className="k-icon-btn ln-colx" aria-label="Remove column" onClick={() => onChange(del(columns, ci), rows.map((r) => del(r, ci)))}><X size={11} /></button>}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {columns.map((_, ci) => (
                  <td key={ci}><input className="ln-cell" value={r[ci] ?? ''} disabled={ro} aria-label={`Row ${ri + 1}, ${columns[ci].name || 'column ' + (ci + 1)}`}
                    onPaste={(e) => { const next = pasteGrid(e, rows, ri, ci, columns.length); if (next) onChange(columns, next) }}
                    onChange={(e) => onChange(columns, rows.map((x, k) => (k === ri ? columns.map((_, j) => (j === ci ? e.target.value : x[j] ?? '')) : x)))} /></td>
                ))}
                <td>{!ro && <button className="k-icon-btn" aria-label="Remove row" onClick={() => onChange(columns, del(rows, ri))}><X size={13} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ro && (
        <div className="ln-row-actions">
          <button className="k-btn small" onClick={() => onChange(columns, [...rows, columns.map(() => '')])}><Plus size={12} /> Row</button>
          <button className="k-btn small" onClick={() => onChange([...columns, { name: '', unit: '' }], rows.map((r) => [...r, '']))}><Plus size={12} /> Column</button>
          <span className="k-muted ln-hint">Paste cells from a spreadsheet into any cell.</span>
        </div>
      )}
    </>
  )
}

function MeasurementEditor({ data, set, ro }: P<MeasurementData>) {
  return (
    <div>
      <Title value={data.title} onChange={(title) => set({ ...data, title })} ro={ro} />
      <GridStats data={data} set={set} ro={ro} />
    </div>
  )
}

function GridStats({ data, set, ro }: P<MeasurementData>) {
  const stats = data.columns.map((_, i) => columnStats(data.rows, i))
  return (
    <>
      <GridEditor columns={data.columns} rows={data.rows} ro={ro} onChange={(columns, rows) => set({ ...data, columns, rows })} />
      {stats.some((s) => s.n > 1) && (
        <div className="ln-summary ln-statline">
          {data.columns.map((c, i) => (stats[i].n > 1 ? <span key={i}><b>{c.name || `Column ${i + 1}`}</b> {meanSd(stats[i])}{c.unit ? ` ${c.unit}` : ''} <span className="k-muted">(n = {stats[i].n})</span></span> : null))}
        </div>
      )}
    </>
  )
}

// ------------------------------------------------------------------ instrument

function InstrumentEditor({ data, set, ro }: P<InstrumentData>) {
  const env = useBlockEnv()
  const att = data.file ? env.attachment(data.file) : undefined
  const listId = useMemo(() => `ins-${Math.random().toString(36).slice(2, 7)}`, [])
  const f = (k: keyof InstrumentData, label: string, wide = false) => (
    <label className={`ln-kv${wide ? ' wide' : ''}`}><span>{label}</span>
      <input className="k-input" value={data[k]} disabled={ro} list={k === 'instrument' ? listId : undefined} onChange={(e) => set({ ...data, [k]: e.target.value })} onBlur={() => k === 'instrument' && data.instrument.trim() && env.rememberInstrument(data.instrument)} /></label>
  )
  return (
    <div className="ln-instrument">
      <div className="ln-kvgrid">
        {f('instrument', 'Instrument')}{f('method', 'Method')}
        <label className="ln-kv"><span>Operator</span><input className="k-input" value={data.operator} disabled={ro} placeholder={env.user} onChange={(e) => set({ ...data, operator: e.target.value })} /></label>
        <label className="ln-kv"><span>Started</span><input className="k-input" type="datetime-local" value={data.started.slice(0, 16)} disabled={ro} onChange={(e) => set({ ...data, started: e.target.value ? `${e.target.value}:00` : '' })} /></label>
        {f('parameters', 'Parameters', true)}
        <label className="ln-kv wide"><span>Data file</span>
          <span className="ln-filepick">
            {att ? <button className="ln-filechip" onClick={() => env.openAttachment(att.id)} title={`SHA-256 ${att.sha256}`}><Paperclip size={12} /> {att.name} <small>{fileSize(att.size)}</small></button>
              : data.path ? <button className="ln-filechip" onClick={() => env.openPath(data.path)}><Paperclip size={12} /> {data.path.split('/').pop()}</button> : <span className="k-muted">none</span>}
            {!ro && <button className="k-btn small" onClick={() => void env.pickFile('any').then((id) => id && set({ ...data, file: id, path: '' }))}>Attach file…</button>}
            {!ro && (att || data.path) && <button className="k-icon-btn" aria-label="Detach" onClick={() => set({ ...data, file: '', path: '' })}><X size={13} /></button>}
          </span>
        </label>
        {f('notes', 'Notes', true)}
      </div>
      <datalist id={listId}>{env.instruments.map((x) => <option key={x} value={x} />)}</datalist>
    </div>
  )
}

// ------------------------------------------------------------------ timeline

function TimelineEditor({ data, set, ro }: P<TimelineData>) {
  const [draft, setDraft] = useState('')
  const add = () => {
    if (!draft.trim()) return
    set({ ...data, items: [...data.items, { time: nowLocal(), text: draft.trim() }] })
    setDraft('')
  }
  return (
    <div>
      <Title value={data.title} onChange={(title) => set({ ...data, title })} ro={ro} />
      {data.items.length === 0 && <div className="ln-empty">No observations yet. Type a quick note below and press Enter: it is time-stamped.</div>}
      <ul className="ln-timeline">
        {data.items.map((it, i) => (
          <li key={i}>
            <input className="ln-cell ln-when" type="datetime-local" value={it.time.slice(0, 16)} disabled={ro} aria-label="Time" onChange={(e) => set({ ...data, items: upd(data.items, i, { time: e.target.value ? `${e.target.value}:00` : it.time }) })} />
            <input className="ln-cell wide" value={it.text} disabled={ro} aria-label="Observation" onChange={(e) => set({ ...data, items: upd(data.items, i, { text: e.target.value }) })} />
            {!ro && <button className="k-icon-btn" aria-label="Remove observation" onClick={() => set({ ...data, items: del(data.items, i) })}><X size={13} /></button>}
          </li>
        ))}
      </ul>
      {!ro && (
        <div className="ln-quick">
          <Clock size={14} />
          <input className="k-input" placeholder="Quick note: press Enter to stamp the time" value={draft} aria-label="Quick note" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
          <button className="k-btn small" onClick={add} disabled={!draft.trim()}>Add</button>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ safety

function SafetyEditor({ data, set, ro }: P<SafetyData>) {
  const toggle = (key: 'pictograms' | 'ppe', v: string) => set({ ...data, [key]: data[key].includes(v) ? data[key].filter((x) => x !== v) : [...data[key], v] })
  return (
    <div className={`ln-safety ln-risk-${data.risk}`}>
      <div className="ln-row-actions">
        <label className="ln-kv inline"><span>Risk</span>
          <select className="k-input ln-sel" value={data.risk} disabled={ro} onChange={(e) => set({ ...data, risk: e.target.value as SafetyData['risk'] })}><option>low</option><option>medium</option><option>high</option></select></label>
      </div>
      <div className="ln-chips" role="group" aria-label="GHS pictograms">{GHS_PICTOGRAMS.map((g) => <Chip key={g} on={data.pictograms.includes(g)} onClick={ro ? undefined : () => toggle('pictograms', g)}>{g}</Chip>)}</div>
      <div className="ln-chips" role="group" aria-label="Protective equipment">{PPE_ITEMS.map((g) => <Chip key={g} on={data.ppe.includes(g)} onClick={ro ? undefined : () => toggle('ppe', g)}>{g}</Chip>)}</div>
      <label className="ln-kv wide"><span>Hazards (one per line)</span><textarea className="k-input" rows={2} value={data.hazards.join('\n')} disabled={ro} onChange={(e) => set({ ...data, hazards: e.target.value.split('\n').filter((l, i, a) => l.trim() || i < a.length - 1) })} /></label>
      <label className="ln-kv wide"><span>Controls</span><input className="k-input" value={data.controls} disabled={ro} onChange={(e) => set({ ...data, controls: e.target.value })} /></label>
      <label className="ln-kv wide"><span>Waste</span><input className="k-input" value={data.waste} disabled={ro} onChange={(e) => set({ ...data, waste: e.target.value })} /></label>
    </div>
  )
}

// ------------------------------------------------------------------ plot

function PlotEditor({ data, set, ro }: P<PlotData>) {
  const columns = [{ name: data.xLabel, unit: '' }, ...data.series.map((s) => ({ name: s, unit: '' }))]
  return (
    <div>
      <Title value={data.title} onChange={(title) => set({ ...data, title })} ro={ro} />
      <PlotView data={data} />
      <div className="ln-row-actions">
        <label className="ln-kv inline"><span>Type</span>
          <select className="k-input ln-sel" value={data.kind} disabled={ro} onChange={(e) => set({ ...data, kind: e.target.value as PlotData['kind'] })}><option value="line">line</option><option value="scatter">scatter</option><option value="bar">bar</option></select></label>
        <label className="ln-kv inline"><span>x axis</span><input className="k-input" value={data.xLabel} disabled={ro} onChange={(e) => set({ ...data, xLabel: e.target.value })} /></label>
        <label className="ln-kv inline"><span>y axis</span><input className="k-input" value={data.yLabel} disabled={ro} onChange={(e) => set({ ...data, yLabel: e.target.value })} /></label>
      </div>
      <details className="ln-data">
        <summary>Data table</summary>
        <GridEditor columns={columns} rows={data.rows} ro={ro} firstColumnLabel="x"
          onChange={(cols, rows) => set({ ...data, xLabel: cols[0]?.name ?? 'x', series: cols.slice(1).map((c) => c.name), rows })} />
      </details>
    </div>
  )
}

// ------------------------------------------------------------------ steps

function StepsEditor({ data, set, ro }: P<StepsData>) {
  const env = useBlockEnv()
  const done = data.items.filter((s) => s.doneAt).length
  return (
    <div>
      <Title value={data.title} onChange={(title) => set({ ...data, title })} ro={ro} />
      <ol className="ln-steps">
        {data.items.map((s, i) => (
          <li key={i} className={s.doneAt ? 'done' : ''}>
            <input type="checkbox" checked={!!s.doneAt} disabled={ro} aria-label={`Step ${i + 1} done`}
              onChange={(e) => set({ ...data, items: upd(data.items, i, e.target.checked ? { doneBy: env.user, doneAt: nowLocal() } : { doneBy: '', doneAt: '' }) })} />
            <input className="ln-cell wide" value={s.text} disabled={ro} aria-label={`Step ${i + 1}`} placeholder="Step" onChange={(e) => set({ ...data, items: upd(data.items, i, { text: e.target.value }) })} />
            {s.doneAt && <span className="ln-who" title={`${s.doneBy}, ${s.doneAt}`}>{s.doneBy} {shortTime(s.doneAt)}</span>}
            {!ro && <button className="k-icon-btn" aria-label="Remove step" onClick={() => set({ ...data, items: del(data.items, i) })}><X size={13} /></button>}
          </li>
        ))}
      </ol>
      <div className="ln-row-actions">
        {!ro && <button className="k-btn small" onClick={() => set({ ...data, items: [...data.items, { text: '', doneBy: '', doneAt: '' }] })}><Plus size={12} /> Step</button>}
        <span className="k-muted ln-hint">{done} of {data.items.length} done. Ticking a step records who and when.</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ image and file

function ImageEditor({ data, set, ro }: P<ImageData>) {
  const env = useBlockEnv()
  const att = data.att ? env.attachment(data.att) : undefined
  const url = data.att ? env.attUrl(data.att) : null
  if (!data.att) {
    return <div className="ln-empty">{ro ? 'No image.' : <button className="k-btn" onClick={() => void env.pickFile('image').then((id) => id && set({ ...data, att: id }))}><ImageIcon size={14} /> Choose an image…</button>}</div>
  }
  return (
    <figure className="ln-figure">
      {url ? <img src={url} alt={data.caption || att?.name || 'image'} style={{ width: `${data.width}%` }} draggable={false} /> : <div className="ln-empty">{att ? `${att.name} could not be loaded (moved or deleted?).` : 'The attachment is missing.'}</div>}
      <figcaption>
        <input className="ln-cell wide" value={data.caption} disabled={ro} placeholder="Caption" aria-label="Caption" onChange={(e) => set({ ...data, caption: e.target.value })} />
        {!ro && <input type="range" min={10} max={100} value={data.width} aria-label="Width" onChange={(e) => set({ ...data, width: Number(e.target.value) })} />}
        {att && <small className="k-muted">{att.name} · {fileSize(att.size)} · SHA-256 {att.sha256.slice(0, 12)}…</small>}
      </figcaption>
    </figure>
  )
}

function FileEditor({ data, set, ro }: P<FileData>) {
  const env = useBlockEnv()
  const att = data.att ? env.attachment(data.att) : undefined
  return (
    <div className="ln-filerow">
      {att ? <button className="ln-filechip" onClick={() => env.openAttachment(att.id)} title={`Open in the right app. SHA-256 ${att.sha256}`}><Paperclip size={13} /> {att.name} <small>{fileSize(att.size)}</small></button>
        : ro ? <span className="k-muted">No file.</span> : <button className="k-btn" onClick={() => void env.pickFile('any').then((id) => id && set({ ...data, att: id }))}><Paperclip size={14} /> Choose a file…</button>}
      <input className="ln-cell wide" value={data.note} disabled={ro} placeholder="Note" aria-label="Note" onChange={(e) => set({ ...data, note: e.target.value })} />
    </div>
  )
}

// ------------------------------------------------------------------ the node view

const ICONS: Record<Block['kind'], typeof Beaker> = {
  reaction: FlaskConical, materials: Beaker, measurements: Ruler, instrument: Microscope, timeline: Clock, safety: ShieldAlert, plot: LineChart, steps: ListChecks, image: ImageIcon, file: FileText,
}

export function BlockView(props: ReactNodeViewProps) {
  const env = useBlockEnv()
  const raw = props.node.attrs.block as unknown
  const block: Block = isBlock(raw) ? raw : newBlock('timeline')
  const ro = env.readOnly || !props.editor.isEditable
  const setData = (data: Block['data']) => props.updateAttributes({ block: { kind: block.kind, data } })
  const Icon = ICONS[block.kind] ?? ClipboardList
  const body = (() => {
    switch (block.kind) {
      case 'reaction': return <ReactionEditor data={block.data} set={setData} ro={ro} />
      case 'materials': return <MaterialsEditor data={block.data} set={setData} ro={ro} />
      case 'measurements': return <MeasurementEditor data={block.data} set={setData} ro={ro} />
      case 'instrument': return <InstrumentEditor data={block.data} set={setData} ro={ro} />
      case 'timeline': return <TimelineEditor data={block.data} set={setData} ro={ro} />
      case 'safety': return <SafetyEditor data={block.data} set={setData} ro={ro} />
      case 'plot': return <PlotEditor data={block.data} set={setData} ro={ro} />
      case 'steps': return <StepsEditor data={block.data} set={setData} ro={ro} />
      case 'image': return <ImageEditor data={block.data} set={setData} ro={ro} />
      case 'file': return <FileEditor data={block.data} set={setData} ro={ro} />
    }
  })()
  return (
    <NodeViewWrapper className={`ln-block ln-b-${block.kind}${props.selected ? ' selected' : ''}`} data-kind={block.kind} contentEditable={false}>
      <div className="ln-block-head" data-drag-handle contentEditable={false}>
        <GripVertical size={13} className="ln-grip" />
        <Icon size={14} />
        <span className="ln-block-kind">{BLOCK_LABELS[block.kind]}</span>
        <span className="k-spacer" style={{ flex: 1 }} />
        {!ro && <button className="k-icon-btn" aria-label={`Delete ${BLOCK_LABELS[block.kind]}`} title="Delete this block" onClick={() => props.deleteNode()}><Trash2 size={13} /></button>}
      </div>
      <div className="ln-block-body" contentEditable={false}>{body}</div>
    </NodeViewWrapper>
  )
}
