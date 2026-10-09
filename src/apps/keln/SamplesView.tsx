// The samples & materials register: sample IDs (prefix + counter), composition, batch, location, parents (lineage
// tree), status, label printing; and the chemical inventory that feeds the reaction table.

import { useMemo, useState } from 'react'
import { GitBranch, List, Plus, Printer, Trash2 } from 'lucide-react'
import { code128Svg } from './code128'
import { Field, Html } from './ui'
import { molarMass } from './formula'
import type { InventoryItem, Notebook, Sample, SampleStatus } from './model'
import { ancestors, descendants, entriesUsing, inventoryMatches, lineageForest, lineageText, type LineageNode } from './samples'

const STATUSES: SampleStatus[] = ['in use', 'consumed', 'discarded']

interface SamplesProps {
  nb: Notebook
  selected: string | null
  onSelect(id: string | null): void
  onAdd(init: Partial<Sample> & { name: string }): void
  onUpdate(id: string, patch: Partial<Omit<Sample, 'id'>>): void
  onRemove(id: string): void
  onPrint(ids: string[]): void
  onOpenEntry(id: string): void
}

function Tree({ nodes, selected, onSelect, depth = 0 }: { nodes: LineageNode[]; selected: string | null; onSelect(id: string): void; depth?: number }) {
  return (
    <ul className="ln-lineage" role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map((n) => (
        <li key={n.sample.id} role="treeitem" aria-selected={selected === n.sample.id}>
          <button className={`ln-linkbtn${selected === n.sample.id ? ' on' : ''}`} onClick={() => onSelect(n.sample.id)}>
            <b>{n.sample.id}</b> {n.sample.name} <span className={`ln-st ${n.sample.status.replace(' ', '-')}`}>{n.sample.status}</span>
          </button>
          {n.children.length > 0 && <Tree nodes={n.children} selected={selected} onSelect={onSelect} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  )
}

export function SamplesView(p: SamplesProps) {
  const { nb } = p
  const [mode, setMode] = useState<'table' | 'tree'>('table')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'' | SampleStatus>('')
  const list = useMemo(() => nb.samples.filter((s) => (!status || s.status === status) && (!q.trim() || [s.id, s.name, s.composition, s.batch, s.location, s.notes].some((f) => f.toLowerCase().includes(q.trim().toLowerCase())))), [nb.samples, q, status])
  const forest = useMemo(() => lineageForest(nb.samples), [nb.samples])
  const sel = nb.samples.find((s) => s.id === p.selected) ?? null
  const used = sel ? entriesUsing(nb, sel.id) : []
  const parentsOptions = sel ? nb.samples.filter((s) => s.id !== sel.id && !descendants(nb.samples, sel.id).some((d) => d.id === s.id) && !sel.parents.includes(s.id)) : []

  return (
    <div className="ln-split">
      <div className="ln-pane-list">
        <div className="ln-toolbar tight">
          <button className="k-btn small primary" onClick={() => p.onAdd({ name: 'New sample' })}><Plus size={13} /> Sample</button>
          <button className="k-btn small" disabled={!sel} onClick={() => sel && p.onAdd({ name: `${sel.name} (child)`, parents: [sel.id], composition: sel.composition, batch: sel.batch, location: sel.location, projectId: sel.projectId })}><GitBranch size={13} /> Child</button>
          <button className="k-btn small" disabled={list.length === 0} onClick={() => p.onPrint(sel ? [sel.id] : list.map((s) => s.id))}><Printer size={13} /> {sel ? 'Label' : 'Labels'}</button>
          <span className="k-spacer" />
          <div className="ln-seg" role="group" aria-label="View">
            <button className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')} aria-pressed={mode === 'table'}><List size={13} /> Table</button>
            <button className={mode === 'tree' ? 'on' : ''} onClick={() => setMode('tree')} aria-pressed={mode === 'tree'}><GitBranch size={13} /> Lineage</button>
          </div>
        </div>
        <div className="ln-filterbar">
          <input className="k-input" placeholder="Filter samples…" value={q} aria-label="Filter samples" onChange={(e) => setQ(e.target.value)} />
          <select className="k-input" value={status} aria-label="Status" onChange={(e) => setStatus(e.target.value as '' | SampleStatus)}><option value="">any status</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        </div>
        {nb.samples.length === 0 ? (
          <div className="ln-empty big">No samples yet. Add one: its ID is made from the prefix ({nb.settings.samplePrefix}-{'0'.repeat(nb.settings.sampleDigits - 1)}1…), and you can link it from entries with @.</div>
        ) : mode === 'tree' ? (
          <div className="ln-scroll-y"><Tree nodes={forest.filter((t) => list.some((s) => s.id === t.sample.id) || !q.trim() && !status)} selected={p.selected} onSelect={(id) => p.onSelect(id)} /></div>
        ) : (
          <div className="ln-scroll-y">
            <table className="ln-grid ln-list-table">
              <thead><tr><th>ID</th><th>Name</th><th>Composition</th><th>Location</th><th>Made</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className={p.selected === s.id ? 'on' : ''} onClick={() => p.onSelect(s.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onSelect(s.id) } }}>
                    <td><b>{s.id}</b></td><td>{s.name}</td><td>{s.composition}</td><td>{s.location}</td><td>{s.made}</td><td><span className={`ln-st ${s.status.replace(' ', '-')}`}>{s.status}</span></td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={6} className="ln-empty">No sample matches.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ln-pane-detail">
        {!sel ? <div className="ln-empty big">Select a sample to see its record, lineage, barcode label and the entries that use it.</div> : (
          <div className="ln-form">
            <h3>{sel.id}</h3>
            <Field label="Name"><input className="k-input" value={sel.name} onChange={(e) => p.onUpdate(sel.id, { name: e.target.value })} /></Field>
            <Field label="Composition"><input className="k-input" value={sel.composition} onChange={(e) => p.onUpdate(sel.id, { composition: e.target.value })} /></Field>
            <div className="ln-two">
              <Field label="Batch"><input className="k-input" value={sel.batch} onChange={(e) => p.onUpdate(sel.id, { batch: e.target.value })} /></Field>
              <Field label="Location"><input className="k-input" value={sel.location} onChange={(e) => p.onUpdate(sel.id, { location: e.target.value })} /></Field>
            </div>
            <div className="ln-two">
              <Field label="Date made"><input className="k-input" type="date" value={sel.made} onChange={(e) => p.onUpdate(sel.id, { made: e.target.value })} /></Field>
              <Field label="Status"><select className="k-input" value={sel.status} onChange={(e) => p.onUpdate(sel.id, { status: e.target.value as SampleStatus })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></Field>
            </div>
            <Field label="Project">
              <select className="k-input" value={sel.projectId} onChange={(e) => p.onUpdate(sel.id, { projectId: e.target.value })}><option value="">none</option>{nb.projects.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select>
            </Field>
            <Field label="Made from (parents)">
              <div className="ln-chips">
                {sel.parents.map((id) => <span key={id} className="ln-tagchip">{id}<button aria-label={`Remove parent ${id}`} onClick={() => p.onUpdate(sel.id, { parents: sel.parents.filter((x) => x !== id) })}>×</button></span>)}
                {sel.parents.length === 0 && <span className="k-muted">none (a starting material)</span>}
              </div>
              {parentsOptions.length > 0 && (
                <select className="k-input" value="" aria-label="Add a parent" onChange={(e) => e.target.value && p.onUpdate(sel.id, { parents: [...sel.parents, e.target.value] })}>
                  <option value="">Add a parent…</option>{parentsOptions.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
                </select>
              )}
            </Field>
            <Field label="Notes"><textarea className="k-input" rows={3} value={sel.notes} onChange={(e) => p.onUpdate(sel.id, { notes: e.target.value })} /></Field>

            <div className="ln-card">
              <h4>Lineage</h4>
              <pre className="ln-pre">{lineageText(nb.samples, sel.id)}</pre>
              <small className="k-muted">{ancestors(nb.samples, sel.id).length} ancestor(s), {descendants(nb.samples, sel.id).length} descendant(s)</small>
            </div>
            <div className="ln-card">
              <h4>Label</h4>
              <Html html={code128Svg(sel.id, { module: 1.6, height: 38 })} className="ln-barcode" />
              <button className="k-btn small" onClick={() => p.onPrint([sel.id])}><Printer size={13} /> Print label…</button>
            </div>
            <div className="ln-card">
              <h4>Used in {used.length} entr{used.length === 1 ? 'y' : 'ies'}</h4>
              <ul className="ln-list">{used.map((id) => { const e = nb.entries.find((x) => x.id === id)!; return <li key={id}><button className="ln-linkbtn" onClick={() => p.onOpenEntry(id)}>{e.experiment} · {e.title}</button></li> })}</ul>
            </div>
            <button className="k-btn danger" onClick={() => p.onRemove(sel.id)}><Trash2 size={13} /> Delete sample</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ inventory

interface InvProps {
  nb: Notebook
  selected: string | null
  onSelect(id: string | null): void
  onSave(item: InventoryItem): void
  onRemove(id: string): void
}

export function InventoryView(p: InvProps) {
  const { nb } = p
  const [q, setQ] = useState('')
  const list = useMemo(() => inventoryMatches(nb.inventory, q), [nb.inventory, q])
  const sel = nb.inventory.find((i) => i.id === p.selected) ?? null
  const add = () => {
    const id = `inv-${String(nb.inventory.reduce((m, i) => Math.max(m, Number(i.id.replace(/\D/g, '')) || 0), 0) + 1).padStart(3, '0')}`
    p.onSave({ id, name: 'New chemical', formula: '', cas: '', mw: null, density: null, supplier: '', lot: '', amount: '', hazard: '', location: '' })
    p.onSelect(id)
  }
  const set = (patch: Partial<InventoryItem>) => sel && p.onSave({ ...sel, ...patch })
  return (
    <div className="ln-split">
      <div className="ln-pane-list">
        <div className="ln-toolbar tight">
          <button className="k-btn small primary" onClick={add}><Plus size={13} /> Chemical</button>
          <span className="k-spacer" />
          <span className="k-muted ln-hint">Lines here fill the reaction and materials tables.</span>
        </div>
        <div className="ln-filterbar"><input className="k-input" placeholder="Filter by name, CAS, supplier, hazard…" value={q} aria-label="Filter inventory" onChange={(e) => setQ(e.target.value)} /></div>
        {nb.inventory.length === 0 ? <div className="ln-empty big">The inventory is empty. Add the chemicals you use: name, CAS, supplier, amount and hazard.</div> : (
          <div className="ln-scroll-y">
            <table className="ln-grid ln-list-table">
              <thead><tr><th>Name</th><th>Formula</th><th>CAS</th><th>Supplier</th><th>Amount</th><th>Hazard</th></tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className={p.selected === i.id ? 'on' : ''} onClick={() => p.onSelect(i.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onSelect(i.id) } }}>
                    <td><b>{i.name}</b></td><td>{i.formula}</td><td>{i.cas}</td><td>{i.supplier}</td><td>{i.amount}</td><td>{i.hazard}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="ln-pane-detail">
        {!sel ? <div className="ln-empty big">Select a chemical to edit it.</div> : (
          <div className="ln-form">
            <h3>{sel.name || 'Chemical'}</h3>
            <Field label="Name"><input className="k-input" value={sel.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <div className="ln-two">
              <Field label="Formula" hint={sel.formula ? (molarMass(sel.formula) ? `${molarMass(sel.formula)!.toFixed(3)} g/mol` : 'cannot read this formula') : ''}><input className="k-input" value={sel.formula} onChange={(e) => set({ formula: e.target.value })} /></Field>
              <Field label="CAS number"><input className="k-input" value={sel.cas} onChange={(e) => set({ cas: e.target.value })} /></Field>
            </div>
            <div className="ln-two">
              <Field label="Molar mass (g/mol)" hint="empty = from the formula"><input className="k-input" inputMode="decimal" value={sel.mw ?? ''} onChange={(e) => set({ mw: e.target.value.trim() === '' ? null : Number(e.target.value) || null })} /></Field>
              <Field label="Density (g/mL)"><input className="k-input" inputMode="decimal" value={sel.density ?? ''} onChange={(e) => set({ density: e.target.value.trim() === '' ? null : Number(e.target.value) || null })} /></Field>
            </div>
            <div className="ln-two">
              <Field label="Supplier"><input className="k-input" value={sel.supplier} onChange={(e) => set({ supplier: e.target.value })} /></Field>
              <Field label="Lot"><input className="k-input" value={sel.lot} onChange={(e) => set({ lot: e.target.value })} /></Field>
            </div>
            <div className="ln-two">
              <Field label="Amount"><input className="k-input" value={sel.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
              <Field label="Location"><input className="k-input" value={sel.location} onChange={(e) => set({ location: e.target.value })} /></Field>
            </div>
            <Field label="Hazard"><input className="k-input" value={sel.hazard} onChange={(e) => set({ hazard: e.target.value })} /></Field>
            <button className="k-btn danger" onClick={() => p.onRemove(sel.id)}><Trash2 size={13} /> Delete chemical</button>
          </div>
        )}
      </div>
    </div>
  )
}
