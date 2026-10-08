// Unit converter for the lab: mass, volume, pressure, energy, temperature, amount, concentration, length.

import { useMemo } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { fmt, parseNum } from './chem'
import type { ConverterForm } from './forms'
import { CATEGORIES, convert, convertAll, getCategory } from './units'
import { Answer, Card, Err, Field, Hint, NumInput, ResultActions, Select } from './ui'

export function ConverterTool({ f, set }: { f: ConverterForm; set: (p: Partial<ConverterForm>) => void }) {
  const cat = getCategory(f.category)
  const r = useMemo(() => {
    try {
      const v = parseNum(f.value)
      if (v === null || Number.isNaN(v)) throw new Error('Type a number.')
      return { ok: true as const, to: convert(f.category, v, f.from, f.to), all: convertAll(f.category, v, f.from), v }
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
    }
  }, [f.category, f.value, f.from, f.to])
  const text = r.ok ? `${f.value} ${f.from} = ${fmt(r.to)} ${f.to}` : ''
  const setCategory = (id: string) => {
    const c = getCategory(id)
    set({ category: id, from: c.units[0].id, to: c.units[1]?.id ?? c.units[0].id })
  }
  return (
    <div className="kc-tool-body">
      <Card title="Unit converter" icon={<ArrowRightLeft size={15} />} actions={<ResultActions tool="converter" label="Conversion" text={text} />}>
        <div className="kc-tabs kc-wrap" role="tablist">
          {CATEGORIES.map((c) => (
            <button key={c.id} role="tab" aria-selected={f.category === c.id} className={`kc-tab ${f.category === c.id ? 'on' : ''}`} onClick={() => setCategory(c.id)}>{c.label}</button>
          ))}
        </div>
        <div className="kc-convrow">
          <Field label="Value"><NumInput value={f.value} onChange={(value) => set({ value })} label="Value" /></Field>
          <Field label="From"><Select value={f.from} onChange={(from) => set({ from })} options={cat.units.map((u) => u.id)} label="From unit" /></Field>
          <button className="k-icon-btn kc-swap" aria-label="Swap the units" title="Swap" onClick={() => set({ from: f.to, to: f.from })}><ArrowRightLeft size={15} /></button>
          <Field label="To"><Select value={f.to} onChange={(to) => set({ to })} options={cat.units.map((u) => u.id)} label="To unit" /></Field>
        </div>
        {r.ok ? (
          <>
            <Answer>{f.value} {f.from} = <b>{fmt(r.to)} {f.to}</b></Answer>
            <table className="kc-table">
              <thead><tr><th>unit</th><th>value</th></tr></thead>
              <tbody>
                {r.all.map((a) => <tr key={a.unit} className={a.unit === f.to ? 'kc-limiting' : ''}><td>{a.unit}</td><td>{fmt(a.value)}</td></tr>)}
              </tbody>
            </table>
          </>
        ) : <Err>{r.message}</Err>}
        {f.category === 'energy' && <Hint>Per-mole units relate one molecule to one mole of molecules: 1 eV = 96.485 kJ/mol = 23.06 kcal/mol; 1 cal = 4.184 J.</Hint>}
        {f.category === 'massconc' && <Hint>1 mg/L = 1 ppm and 1 µg/L = 1 ppb for a dilute aqueous solution (by mass/volume).</Hint>}
      </Card>
    </div>
  )
}
