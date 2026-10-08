// Solutions: what to weigh for a concentration, conversions between concentration units,
// serial dilutions, and mixing two solutions.

import { useMemo } from 'react'
import { Beaker } from 'lucide-react'
import { fmt, molarMass, parseNum } from './chem'
import type { SolutionsForm } from './forms'
import { CONC_UNITS, WEIGH_KINDS, convertConcentration, mixSolutions, serialDilution, weighOut, type ConcUnit, type WeighKind } from './solutions'
import { Answer, Card, Err, Field, Fx, Hint, NumInput, ResultActions, Select, Tabs } from './ui'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A required number from a box. */
function need(s: string, what: string): number {
  const v = parseNum(s)
  if (v === null || Number.isNaN(v)) throw new Error(`Type ${what} (a number).`)
  return v
}

/** Grams with a sensible unit. */
function mass(g: number): string {
  if (g !== 0 && g < 0.1) return `${fmt(g * 1000)} mg`
  if (g >= 1000) return `${fmt(g / 1000)} kg`
  return `${fmt(g)} g`
}

type Calc<T> = { ok: true; v: T } | { ok: false; message: string }
function calc<T>(f: () => T): Calc<T> {
  try {
    return { ok: true, v: f() }
  } catch (e) {
    return { ok: false, message: errText(e) }
  }
}

function Weigh({ f, set }: { f: SolutionsForm; set: (p: Partial<SolutionsForm>) => void }) {
  const w = f.weigh
  const kind = WEIGH_KINDS.find((k) => k.id === w.kind) ?? WEIGH_KINDS[0]
  const upd = (p: Partial<SolutionsForm['weigh']>) => set({ weigh: { ...w, ...p } })
  const r = useMemo(
    () =>
      calc(() => {
        const mm = molarMass(w.formula)
        const g = weighOut(w.kind, need(w.value, 'the concentration'), need(w.size, kind.sizeLabel.toLowerCase()), mm, parseNum(w.purity) ?? 100)
        return { g, mm }
      }),
    [w, kind],
  )
  const how = (g: number): string => {
    const s = `${mass(g)} of ${w.formula.trim()}`
    switch (w.kind) {
      case 'molality': return `Weigh ${s} and dissolve it in ${w.size} g (${fmt(Number(w.size) / 1000)} kg) of solvent.`
      case 'ww': return `Weigh ${s} and ${fmt(Number(w.size) - g)} g of solvent (${w.size} g of solution in all).`
      default: return `Weigh ${s}, dissolve it in some solvent and make up to ${w.size} mL.`
    }
  }
  const text = r.ok ? `${kind.label} ${w.value} ${kind.unit}, ${kind.sizeLabel.toLowerCase()} ${w.size} ${kind.sizeUnit}, ${w.formula.trim()} (M = ${fmt(r.v.mm)} g/mol)\n${how(r.v.g)}` : ''
  return (
    <Card title="What to weigh" icon={<Beaker size={15} />} actions={<ResultActions tool="solutions" label={`Weigh ${w.formula.trim()}`} text={text} />}>
      <div className="kc-grid">
        <Field label="Compound"><input className="k-input kc-mono" value={w.formula} onChange={(e) => upd({ formula: e.target.value })} spellCheck={false} aria-label="Solute formula" /></Field>
        <Field label="Concentration as">
          <Select value={w.kind} onChange={(k: WeighKind) => upd({ kind: k })} options={WEIGH_KINDS.map((k) => ({ id: k.id, label: `${k.label} (${k.unit})` }))} label="Kind of concentration" />
        </Field>
        <Field label={`Concentration (${kind.unit})`}><NumInput value={w.value} onChange={(value) => upd({ value })} label="Concentration" /></Field>
        <Field label={`${kind.sizeLabel} (${kind.sizeUnit})`}><NumInput value={w.size} onChange={(size) => upd({ size })} label={kind.sizeLabel} /></Field>
        <Field label="Purity of the reagent (%)"><NumInput value={w.purity} onChange={(purity) => upd({ purity })} label="Purity" /></Field>
      </div>
      {r.ok ? (
        <>
          <Answer>Weigh <b>{mass(r.v.g)}</b> of <Fx f={w.formula} /> <span className="k-muted">(M = {fmt(r.v.mm)} g/mol)</span></Answer>
          <div className="kc-result">{how(r.v.g)}</div>
        </>
      ) : <Err>{r.message}</Err>}
    </Card>
  )
}

function Convert({ f, set }: { f: SolutionsForm; set: (p: Partial<SolutionsForm>) => void }) {
  const c = f.conv
  const upd = (p: Partial<SolutionsForm['conv']>) => set({ conv: { ...c, ...p } })
  const r = useMemo(
    () =>
      calc(() => {
        const mm = molarMass(c.formula)
        return { mm, all: convertConcentration(c.unit, need(c.value, 'the concentration'), mm, need(c.density, 'the density')) }
      }),
    [c],
  )
  const text = r.ok
    ? `${c.value} ${CONC_UNITS.find((u) => u.id === c.unit)?.label} of ${c.formula.trim()} (M = ${fmt(r.v.mm)} g/mol, density ${c.density} g/mL)\n` +
      CONC_UNITS.map((u) => `${u.label}: ${fmt(r.v.all[u.id])}`).join('\n')
    : ''
  return (
    <Card title="Convert a concentration" actions={<ResultActions tool="solutions" label={`Concentration of ${c.formula.trim()}`} text={text} />}>
      <div className="kc-grid">
        <Field label="Solute"><input className="k-input kc-mono" value={c.formula} onChange={(e) => upd({ formula: e.target.value })} spellCheck={false} aria-label="Solute formula" /></Field>
        <Field label="Value"><NumInput value={c.value} onChange={(value) => upd({ value })} label="Concentration" /></Field>
        <Field label="Unit"><Select value={c.unit} onChange={(u: ConcUnit) => upd({ unit: u })} options={CONC_UNITS.map((u) => ({ id: u.id, label: u.label }))} label="Unit" /></Field>
        <Field label="Density of the solution (g/mL)" hint="1.00 for a dilute aqueous one"><NumInput value={c.density} onChange={(density) => upd({ density })} label="Density" /></Field>
      </div>
      {r.ok ? (
        <table className="kc-table">
          <thead><tr><th>unit</th><th>value</th></tr></thead>
          <tbody>
            {CONC_UNITS.map((u) => (
              <tr key={u.id} className={u.id === c.unit ? 'kc-limiting' : ''}><td>{u.label}</td><td>{Number.isNaN(r.v.all[u.id]) ? '–' : fmt(r.v.all[u.id])}</td></tr>
            ))}
          </tbody>
        </table>
      ) : <Err>{r.message}</Err>}
      <Hint>Molality and mole fraction need the density; the mole fraction is for an aqueous solution (the solvent is water).</Hint>
    </Card>
  )
}

function Serial({ f, set }: { f: SolutionsForm; set: (p: Partial<SolutionsForm>) => void }) {
  const s = f.serial
  const upd = (p: Partial<SolutionsForm['serial']>) => set({ serial: { ...s, ...p } })
  const r = useMemo(() => calc(() => serialDilution(need(s.stock, 'the stock concentration'), need(s.factor, 'the dilution factor'), need(s.steps, 'the number of steps'), need(s.volume, 'the volume of each tube'))), [s])
  const text = r.ok
    ? `Serial dilution ×${s.factor} from ${s.stock}, ${s.steps} steps of ${s.volume} mL\n` +
      r.v.map((x) => `${x.step}: ${fmt(x.concentration)}  (take ${fmt(x.transfer)} mL + ${fmt(x.diluent)} mL diluent)`).join('\n')
    : ''
  return (
    <Card title="Serial dilution" actions={<ResultActions tool="solutions" label={`Serial dilution ×${s.factor}`} text={text} />}>
      <div className="kc-grid">
        <Field label="Stock concentration" hint="any unit; the table uses the same"><NumInput value={s.stock} onChange={(stock) => upd({ stock })} label="Stock concentration" /></Field>
        <Field label="Factor per step" hint="10 = 1 in 10"><NumInput value={s.factor} onChange={(factor) => upd({ factor })} label="Dilution factor" /></Field>
        <Field label="Number of steps"><NumInput value={s.steps} onChange={(steps) => upd({ steps })} label="Steps" /></Field>
        <Field label="Volume of each tube (mL)"><NumInput value={s.volume} onChange={(volume) => upd({ volume })} label="Volume of each tube" /></Field>
      </div>
      {r.ok ? (
        <div className="kc-scrollbox">
          <table className="kc-table">
            <thead><tr><th>tube</th><th>concentration</th><th>total dilution</th><th>take from previous (mL)</th><th>add diluent (mL)</th></tr></thead>
            <tbody>
              {r.v.map((x) => (
                <tr key={x.step}><td>{x.step}</td><td><b>{fmt(x.concentration)}</b></td><td>1 : {fmt(x.totalFactor)}</td><td>{fmt(x.transfer)}</td><td>{fmt(x.diluent)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Err>{r.message}</Err>}
      <Hint>Tube 1 is made from the stock; each next tube from the one before. Mix well between steps and change the tip.</Hint>
    </Card>
  )
}

function Mix({ f, set }: { f: SolutionsForm; set: (p: Partial<SolutionsForm>) => void }) {
  const m = f.mix
  const upd = (p: Partial<SolutionsForm['mix']>) => set({ mix: { ...m, ...p } })
  const r = useMemo(() => calc(() => mixSolutions(need(m.c1, 'C₁'), need(m.v1, 'V₁'), need(m.c2, 'C₂'), need(m.v2, 'V₂'))), [m])
  const text = r.ok ? `Mixing ${m.v1} of ${m.c1} with ${m.v2} of ${m.c2}\nFinal concentration ${fmt(r.v.concentration)} in ${fmt(r.v.volume)}` : ''
  return (
    <Card title="Mix two solutions" actions={<ResultActions tool="solutions" label="Mixing two solutions" text={text} />}>
      <div className="kc-grid kc-four">
        <Field label="C₁"><NumInput value={m.c1} onChange={(c1) => upd({ c1 })} label="C1" /></Field>
        <Field label="V₁"><NumInput value={m.v1} onChange={(v1) => upd({ v1 })} label="V1" /></Field>
        <Field label="C₂"><NumInput value={m.c2} onChange={(c2) => upd({ c2 })} label="C2" /></Field>
        <Field label="V₂"><NumInput value={m.v2} onChange={(v2) => upd({ v2 })} label="V2" /></Field>
      </div>
      {r.ok ? (
        <Answer>Final concentration <b>{fmt(r.v.concentration)}</b> in <b>{fmt(r.v.volume)}</b> <span className="k-muted">(amounts {fmt(r.v.amount1)} + {fmt(r.v.amount2)})</span></Answer>
      ) : <Err>{r.message}</Err>}
      <Hint>Concentrations in one unit, volumes in one unit. The volumes are assumed to add up (true for dilute solutions).</Hint>
    </Card>
  )
}

export function SolutionsTool({ f, set }: { f: SolutionsForm; set: (p: Partial<SolutionsForm>) => void }) {
  return (
    <div className="kc-tool-body">
      <Tabs
        value={f.sub}
        onChange={(sub) => set({ sub })}
        tabs={[{ id: 'weigh', label: 'What to weigh' }, { id: 'convert', label: 'Convert units' }, { id: 'serial', label: 'Serial dilution' }, { id: 'mix', label: 'Mix two solutions' }]}
      />
      {f.sub === 'weigh' && <Weigh f={f} set={set} />}
      {f.sub === 'convert' && <Convert f={f} set={set} />}
      {f.sub === 'serial' && <Serial f={f} set={set} />}
      {f.sub === 'mix' && <Mix f={f} set={set} />}
    </div>
  )
}
