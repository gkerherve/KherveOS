// The set-up panels of the four kinds of titration: what is in the flask, what is in the burette, the conditions
// and the indicator. Each takes its spec and reports a changed copy.

import { Plus, Trash2 } from 'lucide-react'
import type { AcidBaseSpec, Item, Titrant, WeakItem } from './acidbase'
import { rankIndicators } from './chooser'
import { INDICATORS, METAL_INDICATORS, REDOX_INDICATORS, indicatorById, redoxIndicatorById } from './data/indicators'
import { COUPLES, TITRATION_COUPLES, coupleById } from './data/potentials'
import { METALS, PRECIPITATES, metalById } from './data/metals'
import { findPka, pkaById, type PkaEntry } from './data/pka'
import type { EdtaSpec } from './edta'
import type { ActivityModel } from './equilibria'
import { equivalencePoints } from './acidbase'
import { formLabels, redoxCouple, edtaMetal, strongItem, weakFrom } from './project'
import type { PrecipSpec } from './precip'
import type { RedoxSpec } from './redox'
import { IndicatorBar, NumField, NumListField, PkaPicker, Row, Sel, Section, Seg, Notice } from './ui'

const ACTIVITY: Array<{ id: ActivityModel; label: string }> = [
  { id: 'none', label: 'Ideal (activity = concentration)' },
  { id: 'davies', label: 'Davies equation' },
  { id: 'edh', label: 'Extended Debye–Hückel' },
]

const defaultFormOf = (e: PkaEntry) => (e.category === 'Amines and N-bases' || (e.category === 'Biological buffers' && e.z0 === 1) ? e.pKa.length : 0)

// ---------------------------------------------------------------------------------------------- acid–base

export function AcidBaseSetup({ spec, onChange }: { spec: AcidBaseSpec; onChange: (s: AcidBaseSpec) => void }) {
  const setItem = (i: number, patch: Partial<WeakItem> | Partial<Extract<Item, { kind: 'strong-acid' | 'strong-base' }>>) =>
    onChange({ ...spec, items: spec.items.map((it, k) => (k === i ? ({ ...it, ...patch } as Item) : it)) })
  const eqs = equivalencePoints(spec)
  const best = () => {
    const rk = rankIndicators(spec, Math.max(1, eqs.findIndex((e) => !e.strong) + 1 || 1))
    if (rk) onChange({ ...spec, indicator: rk.list[0].ind.id })
  }
  const ind = indicatorById(spec.indicator)
  return (
    <>
      <Section title="In the flask" id="ab-flask" actions={
        <>
          <button type="button" className="k-btn small" title="Add a weak acid or base from the pKa table" onClick={() => onChange({ ...spec, items: [...spec.items, weakFrom(pkaById('acetic') as PkaEntry, 0, 0.1, 25)] })}><Plus size={12} /> Weak</button>
          <button type="button" className="k-btn small" title="Add a strong acid (HCl)" onClick={() => onChange({ ...spec, items: [...spec.items, strongItem('strong-acid', 'HCl', 0.1, 25)] })}><Plus size={12} /> HCl</button>
          <button type="button" className="k-btn small" title="Add a strong base (NaOH)" onClick={() => onChange({ ...spec, items: [...spec.items, strongItem('strong-base', 'NaOH', 0.1, 25)] })}><Plus size={12} /> NaOH</button>
        </>
      }>
        {spec.items.length === 0 && <Notice>The flask is empty. Add a weak acid or base, or a strong one.</Notice>}
        {spec.items.map((it, i) => (
          <div key={i} className="ti-card">
            <div className="ti-card-head">
              <input className="k-input ti-card-title" value={it.label} aria-label={`Name of flask item ${i + 1}`} onChange={(e) => setItem(i, { label: e.target.value })} />
              <button type="button" className="k-icon-btn" title="Remove from the flask" aria-label={`Remove ${it.label}`} onClick={() => onChange({ ...spec, items: spec.items.filter((_, k) => k !== i) })}><Trash2 size={14} /></button>
            </div>
            {it.kind === 'weak' ? <WeakEditor item={it} onChange={(p) => setItem(i, p)} /> : (
              <>
                <Row label={it.kind === 'strong-acid' ? 'Acid, mol H⁺ per L' : 'Base, mol OH⁻ per L'}><NumField label={`Concentration of ${it.label}`} value={it.conc} min={0} onChange={(v) => setItem(i, { conc: v })} unit="M" /></Row>
                <Row label="Volume"><NumField label={`Volume of ${it.label}`} value={it.volume} min={0} onChange={(v) => setItem(i, { volume: v })} unit="mL" /></Row>
              </>
            )}
          </div>
        ))}
      </Section>
      <Section title="In the burette" id="ab-titrant">
        <Row label="Titrant">
          <Sel label="Kind of titrant" value={spec.titrant.kind} width={150} options={[
            { id: 'strong-base', label: 'Strong base (NaOH)' }, { id: 'strong-acid', label: 'Strong acid (HCl)' },
            { id: 'weak-base', label: 'Weak base (ammonia…)' }, { id: 'weak-acid', label: 'Weak acid (acetic…)' },
          ]} onChange={(kind) => {
            const t: Titrant = { ...spec.titrant, kind }
            if (kind === 'strong-base' || kind === 'strong-acid') {
              t.label = kind === 'strong-base' ? 'NaOH' : 'HCl'
              delete t.pKa; delete t.z0; delete t.form; delete t.eq
            } else if (!t.pKa) {
              const e = pkaById(kind === 'weak-base' ? 'ammonia' : 'acetic') as PkaEntry
              Object.assign(t, { label: e.name, pKa: [...e.pKa], z0: e.z0, form: defaultFormOf(e), dpKadT: e.dpKadT ? [...e.dpKadT] : undefined })
            } else if (kind === 'weak-base') t.form = Math.max(t.form ?? 0, 1)
            onChange({ ...spec, titrant: t })
          }} />
        </Row>
        {(spec.titrant.kind === 'weak-base' || spec.titrant.kind === 'weak-acid') && (
          <>
            <Row label="Substance">
              <PkaPicker value={null} label="Weak titrant from the pKa table" buttonLabel={spec.titrant.label} onPick={(e) => onChange({ ...spec, titrant: { ...spec.titrant, label: e.name, pKa: [...e.pKa], z0: e.z0, form: defaultFormOf(e), dpKadT: e.dpKadT ? [...e.dpKadT] : undefined } })} />
            </Row>
            <Row label="Supplied as">
              <Sel label="Form of the weak titrant" value={String(spec.titrant.form ?? 0)} width={150} options={formLabels({ pKa: spec.titrant.pKa ?? [], z0: spec.titrant.z0 ?? 0, lib: pkaIdOf(spec.titrant.label) }).map((l, j) => ({ id: String(j), label: l }))} onChange={(v) => onChange({ ...spec, titrant: { ...spec.titrant, form: Number(v) } })} />
            </Row>
          </>
        )}
        <Row label="Concentration"><NumField label="Titrant concentration" value={spec.titrant.conc} min={0} onChange={(v) => onChange({ ...spec, titrant: { ...spec.titrant, conc: v } })} unit="M" /></Row>
      </Section>
      <Section title="Conditions" id="ab-cond" defaultOpen={false}>
        <Row label="Water added"><NumField label="Water added to the flask" value={spec.water} min={0} onChange={(v) => onChange({ ...spec, water: v })} unit="mL" /></Row>
        <Row label="Temperature"><NumField label="Temperature" value={spec.temperature} min={0} max={100} onChange={(v) => onChange({ ...spec, temperature: v })} unit="°C" /></Row>
        <Row label="Activities"><Sel label="Activity model" value={spec.activity} width={190} options={ACTIVITY} onChange={(v) => onChange({ ...spec, activity: v })} /></Row>
        <Row label="Background salt" hint="An inert 1:1 electrolyte kept at this concentration (0.1 M KCl fixes the ionic strength)."><NumField label="Background electrolyte" value={spec.background} min={0} onChange={(v) => onChange({ ...spec, background: v })} unit="M" /></Row>
        <Row label="Curve to"><NumField label="Last volume of the curve (empty = automatic)" value={spec.vmax} min={0} placeholder="auto" allowEmpty={{ onEmpty: () => onChange({ ...spec, vmax: null }) }} onChange={(v) => onChange({ ...spec, vmax: v > 0 ? v : null })} unit="mL" /></Row>
      </Section>
      <Section title="Indicator" id="ab-ind">
        <Row label="Indicator">
          <Sel label="Indicator" value={spec.indicator ?? ''} width={190} options={[{ id: '', label: 'None' }, ...INDICATORS.map((i) => ({ id: i.id, label: `${i.name} (${i.lo}–${i.hi})` }))]} onChange={(v) => onChange({ ...spec, indicator: v || null })} />
        </Row>
        {ind && <IndicatorBar ind={ind} />}
        {ind?.note && <div className="ti-hint">{ind.note}</div>}
        <button type="button" className="k-btn small" onClick={best} disabled={eqs.length === 0}>Pick the best indicator</button>
      </Section>
    </>
  )
}

function pkaIdOf(label: string): string | null {
  return findPka(label)?.id ?? null
}

function WeakEditor({ item, onChange }: { item: WeakItem; onChange: (p: Partial<WeakItem>) => void }) {
  const labels = formLabels(item)
  return (
    <>
      <Row label="Substance">
        <PkaPicker value={item.lib ?? null} label="Substance from the pKa table" buttonLabel={item.lib ? undefined : 'Custom constants'} onPick={(e) => onChange({ label: e.name, pKa: [...e.pKa], z0: e.z0, form: defaultFormOf(e), lib: e.id, dpKadT: e.dpKadT ? [...e.dpKadT] : undefined })} />
      </Row>
      <Row label="Weighed in as" hint="The species put in the flask. Its charge is balanced by an inert ion (Na⁺ or Cl⁻).">
        <Sel label="Form weighed in" value={String(item.form)} width={170} options={labels.map((l, j) => ({ id: String(j), label: l }))} onChange={(v) => onChange({ form: Number(v) })} />
      </Row>
      <Row label="Concentration"><NumField label={`Concentration of ${item.label}`} value={item.conc} min={0} onChange={(v) => onChange({ conc: v })} unit="M" /></Row>
      <Row label="Volume"><NumField label={`Volume of ${item.label}`} value={item.volume} min={0} onChange={(v) => onChange({ volume: v })} unit="mL" /></Row>
      <details className="ti-details">
        <summary>pKa values and charge</summary>
        <Row label="pKa"><NumListField label={`pKa values of ${item.label}`} value={item.pKa} width={150} onChange={(pKa) => onChange({ pKa, form: Math.min(item.form, pKa.length), lib: pKa.length === item.pKa.length && pKa.every((v, k) => v === item.pKa[k]) ? item.lib : undefined, dpKadT: undefined })} /></Row>
        <Row label="Charge, fully protonated"><NumField label="Charge of the fully protonated form" value={item.z0} digits={2} onChange={(z0) => onChange({ z0: Math.round(z0) })} /></Row>
      </details>
    </>
  )
}

// ---------------------------------------------------------------------------------------------- redox

export function RedoxSetup({ spec, onChange }: { spec: RedoxSpec; onChange: (s: RedoxSpec) => void }) {
  const couples = TITRATION_COUPLES.map((id) => coupleById(id)).filter((c): c is NonNullable<typeof c> => !!c)
  const pick = (which: 'analyte' | 'titrant', id: string) => {
    const c = coupleById(id)
    if (!c) return
    const formal = c.formal?.[0]?.E
    const rc = redoxCouple(id, formal ?? c.E0)
    if (which === 'analyte') onChange({ ...spec, analyte: { ...spec.analyte, couple: rc } })
    else onChange({ ...spec, titrant: { ...spec.titrant, couple: rc } })
  }
  const idOf = (rc: RedoxSpec['analyte']['couple']) => COUPLES.find((c) => c.ox === rc.ox && c.red === rc.red)?.id ?? ''
  const a = spec.analyte
  const t = spec.titrant
  const ind = redoxIndicatorById(spec.indicator)
  const formalsA = coupleById(idOf(a.couple))?.formal ?? []
  const formalsT = coupleById(idOf(t.couple))?.formal ?? []
  return (
    <>
      <Section title="In the flask" id="rx-flask">
        <Row label="Couple"><Sel label="Analyte couple" value={idOf(a.couple)} width={190} options={couples.map((c) => ({ id: c.id, label: `${c.ox} / ${c.red}` }))} onChange={(v) => pick('analyte', v)} /></Row>
        <Row label="Present as">
          <Seg label="Form of the analyte" value={a.start} options={[{ id: 'red', label: `${a.couple.red} (reductant)` }, { id: 'ox', label: `${a.couple.ox} (oxidant)` }]} onChange={(start) => onChange({ ...spec, analyte: { ...a, start } })} />
        </Row>
        <Row label="Concentration"><NumField label="Analyte concentration" value={a.conc} min={0} onChange={(v) => onChange({ ...spec, analyte: { ...a, conc: v } })} unit="M" /></Row>
        <Row label="Volume"><NumField label="Analyte volume" value={a.volume} min={0} onChange={(v) => onChange({ ...spec, analyte: { ...a, volume: v } })} unit="mL" /></Row>
        <Row label="Formal potential" hint={formalsA.length ? `In ${formalsA.map((f) => `${f.medium}: ${f.E} V`).join('; ')}` : 'The standard potential, or the formal potential in your medium.'}>
          <NumField label="Formal potential of the analyte couple" value={a.couple.E0} digits={4} onChange={(E0) => onChange({ ...spec, analyte: { ...a, couple: { ...a.couple, E0 } } })} unit="V" />
        </Row>
      </Section>
      <Section title="In the burette" id="rx-titrant">
        <Row label={a.start === 'red' ? 'Oxidant' : 'Reductant'}><Sel label="Titrant couple" value={idOf(t.couple)} width={190} options={couples.map((c) => ({ id: c.id, label: `${c.ox} / ${c.red}` }))} onChange={(v) => pick('titrant', v)} /></Row>
        <Row label="Concentration" hint={`Of ${a.start === 'red' ? t.couple.ox : t.couple.red} as supplied.`}><NumField label="Titrant concentration" value={t.conc} min={0} onChange={(v) => onChange({ ...spec, titrant: { ...t, conc: v } })} unit="M" /></Row>
        <Row label="Formal potential" hint={formalsT.length ? `In ${formalsT.map((f) => `${f.medium}: ${f.E} V`).join('; ')}` : undefined}>
          <NumField label="Formal potential of the titrant couple" value={t.couple.E0} digits={4} onChange={(E0) => onChange({ ...spec, titrant: { ...t, couple: { ...t.couple, E0 } } })} unit="V" />
        </Row>
      </Section>
      <Section title="Conditions" id="rx-cond" defaultOpen={false}>
        <Row label="pH" hint="Matters for couples that use H⁺ (MnO₄⁻, Cr₂O₇²⁻): E falls 0.059·m/n V per pH unit."><NumField label="pH of the solution" value={spec.pH} digits={3} onChange={(pH) => onChange({ ...spec, pH })} /></Row>
        <Row label="Water added"><NumField label="Water added" value={spec.water} min={0} onChange={(v) => onChange({ ...spec, water: v })} unit="mL" /></Row>
        <Row label="Temperature"><NumField label="Temperature" value={spec.temperature} min={0} max={100} onChange={(v) => onChange({ ...spec, temperature: v })} unit="°C" /></Row>
        <Row label="Curve to"><NumField label="Last volume (empty = automatic)" value={spec.vmax} min={0} placeholder="auto" allowEmpty={{ onEmpty: () => onChange({ ...spec, vmax: null }) }} onChange={(v) => onChange({ ...spec, vmax: v > 0 ? v : null })} unit="mL" /></Row>
      </Section>
      <Section title="Indicator" id="rx-ind">
        <Row label="Indicator"><Sel label="Redox indicator" value={spec.indicator ?? ''} width={190} options={[{ id: '', label: 'None' }, ...REDOX_INDICATORS.map((i) => ({ id: i.id, label: `${i.name} (${i.E0} V)` }))]} onChange={(v) => onChange({ ...spec, indicator: v || null })} /></Row>
        {ind && <div className="ti-hint">{ind.redName} ({ind.red === '#d9ecf5' ? 'colourless' : 'reduced'}) → {ind.oxName} (oxidised), transition near {ind.E0} V. {ind.note ?? ''}</div>}
      </Section>
    </>
  )
}

// ---------------------------------------------------------------------------------------------- EDTA

export function EdtaSetup({ spec, onChange }: { spec: EdtaSpec; onChange: (s: EdtaSpec) => void }) {
  const ind = METAL_INDICATORS.find((i) => i.id === spec.indicator)
  const known = ind ? ind.logK[spec.metal.symbol] !== undefined : false
  return (
    <>
      <Section title="In the flask" id="ed-flask">
        <Row label="Metal ion"><Sel label="Metal ion" value={metalById(spec.metal.symbol)?.id ?? 'ca'} width={150} options={METALS.map((m) => ({ id: m.id, label: `${m.ion} (log K ${m.logKMY})` }))} onChange={(v) => {
          const m = edtaMetal(v)
          onChange({ ...spec, metal: m, indicator: spec.indicator === 'ebt' && METAL_INDICATORS[0].logK[m.symbol] === undefined ? 'custom' : spec.indicator })
        }} /></Row>
        <Row label="Concentration"><NumField label="Metal ion concentration" value={spec.conc} min={0} onChange={(v) => onChange({ ...spec, conc: v })} unit="M" /></Row>
        <Row label="Sample volume"><NumField label="Sample volume" value={spec.volume} min={0} onChange={(v) => onChange({ ...spec, volume: v })} unit="mL" /></Row>
        <Row label="Water added"><NumField label="Water added" value={spec.water} min={0} onChange={(v) => onChange({ ...spec, water: v })} unit="mL" /></Row>
      </Section>
      <Section title="In the burette" id="ed-titrant">
        <Row label="EDTA"><NumField label="EDTA concentration" value={spec.titrantConc} min={0} onChange={(v) => onChange({ ...spec, titrantConc: v })} unit="M" /></Row>
      </Section>
      <Section title="Buffer" id="ed-buffer">
        <Row label="pH" hint="EDTA titrations need a buffer: α(Y⁴⁻) rises tenfold per pH unit between 6 and 10."><NumField label="Buffered pH" value={spec.pH} digits={3} min={0} max={14} onChange={(pH) => onChange({ ...spec, pH })} /></Row>
        <Row label="Ammonia" hint="Total NH₃ + NH₄⁺ of the buffer. Complexes Zn, Cu, Ni, Cd, Co and lowers K′."><NumField label="Total ammonia in the buffer" value={spec.ammonia} min={0} onChange={(v) => onChange({ ...spec, ammonia: v })} unit="M" /></Row>
      </Section>
      <Section title="Indicator" id="ed-ind">
        <Row label="Indicator"><Sel label="Metal indicator" value={spec.indicator ?? ''} width={190} options={[{ id: '', label: 'None' }, ...METAL_INDICATORS.map((i) => ({ id: i.id, label: i.name })), { id: 'custom', label: 'Custom (give log K′)' }]} onChange={(v) => onChange({ ...spec, indicator: v || null })} /></Row>
        {spec.indicator === 'custom' && <Row label="log K′ (M–In)" hint="The indicator changes colour at pM = log K′ of its metal complex."><NumField label="Conditional log K of the metal–indicator complex" value={spec.customLogK} digits={3} onChange={(v) => onChange({ ...spec, customLogK: v })} /></Row>}
        {ind && !known && <Notice kind="warn">{ind.name} has no data for {spec.metal.ion}: choose “custom” and give log K′.</Notice>}
        {ind?.note && <div className="ti-hint">{ind.note}</div>}
      </Section>
    </>
  )
}

// ---------------------------------------------------------------------------------------------- precipitation

const SILVER_SALTS = PRECIPITATES.filter((p) => p.cation === 'Ag⁺' && p.nAn === 1 && p.id !== 'ag2cro4' && p.id !== 'ag2so4' && p.id !== 'ag3po4')

export function PrecipSetup({ spec, onChange }: { spec: PrecipSpec; onChange: (s: PrecipSpec) => void }) {
  const set = (patch: Partial<PrecipSpec>) => onChange({ ...spec, ...patch })
  const silver = spec.mode === 'silver-titrant'
  return (
    <>
      <Section title="Method" id="pr-mode">
        <Seg label="Titration method" value={spec.mode} options={[{ id: 'silver-titrant', label: 'Silver nitrate into anions' }, { id: 'thiocyanate-titrant', label: 'Thiocyanate into silver' }]} onChange={(mode) => set({ mode, indicator: mode === 'silver-titrant' ? 'mohr' : 'volhard' })} />
      </Section>
      <Section title="In the flask" id="pr-flask" actions={silver ? <button type="button" className="k-btn small" onClick={() => set({ anions: [...spec.anions, { salt: 'agbr', conc: 0.05, volume: 12.5 }] })}><Plus size={12} /> Anion</button> : undefined}>
        {silver ? spec.anions.map((a, i) => (
          <div key={i} className="ti-card">
            <div className="ti-card-head">
              <Sel label={`Anion ${i + 1}`} value={a.salt} width={200} options={SILVER_SALTS.map((p) => ({ id: p.id, label: `${p.anion} → ${p.formula} (Ksp ${p.Ksp.toExponential(2)})` }))} onChange={(salt) => set({ anions: spec.anions.map((x, k) => (k === i ? { ...x, salt } : x)) })} />
              {spec.anions.length > 1 && <button type="button" className="k-icon-btn" aria-label={`Remove anion ${i + 1}`} title="Remove" onClick={() => set({ anions: spec.anions.filter((_, k) => k !== i) })}><Trash2 size={14} /></button>}
            </div>
            <Row label="Concentration"><NumField label={`Concentration of anion ${i + 1}`} value={a.conc} min={0} onChange={(v) => set({ anions: spec.anions.map((x, k) => (k === i ? { ...x, conc: v } : x)) })} unit="M" /></Row>
            <Row label="Volume"><NumField label={`Volume of anion ${i + 1}`} value={a.volume} min={0} onChange={(v) => set({ anions: spec.anions.map((x, k) => (k === i ? { ...x, volume: v } : x)) })} unit="mL" /></Row>
          </div>
        )) : (
          <>
            <Row label="Silver ion"><NumField label="Silver concentration" value={spec.silver.conc} min={0} onChange={(v) => set({ silver: { ...spec.silver, conc: v } })} unit="M" /></Row>
            <Row label="Volume"><NumField label="Silver solution volume" value={spec.silver.volume} min={0} onChange={(v) => set({ silver: { ...spec.silver, volume: v } })} unit="mL" /></Row>
          </>
        )}
        <Row label="Water added"><NumField label="Water added" value={spec.water} min={0} onChange={(v) => set({ water: v })} unit="mL" /></Row>
      </Section>
      <Section title="In the burette" id="pr-titrant">
        <Row label={silver ? 'AgNO₃' : 'KSCN'}><NumField label="Titrant concentration" value={spec.titrantConc} min={0} onChange={(v) => set({ titrantConc: v })} unit="M" /></Row>
      </Section>
      <Section title="End point" id="pr-ind">
        <Row label="Indicator"><Sel label="End point indicator" value={spec.indicator ?? ''} width={190} options={[{ id: '', label: 'None' }, ...(silver ? [{ id: 'mohr', label: 'Mohr: chromate' }] : [{ id: 'volhard', label: 'Volhard: iron(III)' }])]} onChange={(v) => set({ indicator: (v || null) as PrecipSpec['indicator'] })} /></Row>
        {spec.indicator === 'mohr' && <Row label="Chromate" hint="Concentration in the flask at the start. Too much and the end point is early, too little and it is late."><NumField label="Chromate concentration" value={spec.chromate} min={0} onChange={(v) => set({ chromate: v })} unit="M" /></Row>}
        {spec.indicator === 'volhard' && <Row label="Iron(III)"><NumField label="Iron(III) concentration" value={spec.iron} min={0} onChange={(v) => set({ iron: v })} unit="M" /></Row>}
      </Section>
    </>
  )
}
