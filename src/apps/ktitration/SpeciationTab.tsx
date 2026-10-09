// The Speciation tab: the α diagram of one acid/base system against pH, the log C–pH (Sillén) diagram, the
// buffer capacity and the titration of a chosen species, with the pKa values corrected for temperature and
// ionic strength, the isoelectric point and the composition at a chosen pH.

import { useEffect, useMemo, useState, type MutableRefObject } from 'react'
import { Beaker } from 'lucide-react'
import { equivalencePoints, curve } from './acidbase'
import { Chart, usePalette } from './Chart'
import type { ActivityModel } from './equilibria'
import { alphaFigure, betaFigure, sillenFigure, speciesTitrationFigure, type Figure, type Palette } from './figures'
import { fixed, sig } from './format'
import { pkaById, systemOf } from './data/pka'
import { formLabels, type Project, type SpeciationSpec } from './project'
import { diagramData, distributionAt, pKaTable, speciesTitration } from './speciation'
import { Empty, NumField, NumListField, Notice, PkaPicker, Row, Sel, Seg, Section } from './ui'

type Diagram = 'alpha' | 'sillen' | 'beta' | 'titration'

export function SpeciationTab({
  project, update, exportRef, compact, onTitrate,
}: {
  project: Project
  update: (fn: (p: Project) => Project, key?: string) => void
  exportRef: MutableRefObject<null | ((pal: Palette) => Figure | null)>
  compact: boolean
  onTitrate: (s: SpeciationSpec, form: number, direction: 'base' | 'acid') => void
}) {
  const pal = usePalette()
  const sp = project.speciation
  const [diagram, setDiagram] = useState<Diagram>('alpha')
  const [pH, setPH] = useState(7)
  const [form, setForm] = useState(0)
  const [dir, setDir] = useState<'base' | 'acid'>('base')
  const [view, setView] = useState<'setup' | 'chart'>('chart')
  const set = (patch: Partial<SpeciationSpec>) => update((p) => ({ ...p, speciation: { ...p.speciation, ...patch } }), 'sp')
  const n = sp.sys.pKa.length
  const labels = useMemo(() => (sp.forms.length === n + 1 ? sp.forms : formLabels({ lib: sp.lib, pKa: sp.sys.pKa, z0: sp.sys.z0 })), [sp.forms, sp.lib, sp.sys, n])
  useEffect(() => { setForm((f) => Math.min(f, n)) }, [n])
  const opts = useMemo(() => ({ sys: sp.sys, conc: sp.conc, ionic: sp.ionic, activity: sp.activity, T: sp.temperature }), [sp])
  const valid = sp.conc > 0 && n >= 1
  const data = useMemo(() => (valid ? diagramData(opts) : null), [valid, opts])
  const here = useMemo(() => (valid ? distributionAt(opts, pH) : null), [valid, opts, pH])
  const table = useMemo(() => (valid ? pKaTable(opts) : []), [valid, opts])
  const dirOk = dir === 'base' ? form < n : form > 0
  const titration = useMemo(() => {
    if (!valid || !dirOk) return null
    try {
      const spec = speciesTitration(opts, form, dir)
      const c = curve(spec, { n: 300 })
      const Ct = spec.titrant.conc
      const V0 = 25
      const eqs = equivalencePoints(spec)
      return { x: c.V.map((v) => (v * Ct) / (sp.conc * V0)), pH: c.pH, eq: eqs.map((e) => (e.V * Ct) / (sp.conc * V0)) }
    } catch {
      return null
    }
  }, [valid, dirOk, opts, form, dir, sp.conc])

  const figure = useMemo<Figure | null>(() => {
    if (!data) return null
    switch (diagram) {
      case 'alpha': return alphaFigure(data, labels, pal)
      case 'sillen': return sillenFigure(data, labels, pal)
      case 'beta': return betaFigure(data, pal)
      case 'titration': return titration ? speciesTitrationFigure(titration.x, titration.pH, pal, `${labels[form]} with ${dir === 'base' ? 'base' : 'acid'}`, titration.eq) : null
    }
  }, [data, diagram, labels, pal, titration, form, dir])

  useEffect(() => {
    exportRef.current = (p) => {
      if (!data) return null
      switch (diagram) {
        case 'alpha': return alphaFigure(data, labels, p)
        case 'sillen': return sillenFigure(data, labels, p)
        case 'beta': return betaFigure(data, p)
        case 'titration': return titration ? speciesTitrationFigure(titration.x, titration.pH, p, labels[form], titration.eq) : null
      }
    }
    return () => { exportRef.current = null }
  }, [exportRef, data, diagram, labels, titration, form])

  const pick = (id: string) => {
    const e = pkaById(id)
    if (!e) return
    set({ lib: e.id, sys: systemOf(e), forms: [...e.forms] })
    setForm(0)
  }

  return (
    <div className="ti-split" data-compact={compact || undefined}>
      {compact && <div className="ti-viewbar"><Seg label="Panel" value={view} options={[{ id: 'setup', label: 'Set-up' }, { id: 'chart', label: 'Diagram' }]} onChange={setView} /></div>}
      <div className="ti-split-body">
        {(!compact || view === 'setup') && (
          <aside className="ti-setup" aria-label="Speciation set-up">
            <Section title="System" id="sp-system">
              <Row label="Substance"><PkaPicker value={sp.lib} label="Substance from the pKa table" onPick={(e) => pick(e.id)} buttonLabel={sp.lib ? undefined : 'Custom constants'} /></Row>
              <Row label="pKa"><NumListField label="pKa values" value={sp.sys.pKa} width={150} onChange={(pKa) => set({ sys: { ...sp.sys, pKa, dpKadT: undefined }, lib: null, forms: [] })} /></Row>
              <Row label="Charge, fully protonated"><NumField label="Charge of the fully protonated form" value={sp.sys.z0} digits={2} onChange={(z0) => set({ sys: { ...sp.sys, z0: Math.round(z0) }, lib: sp.lib && Math.round(z0) === sp.sys.z0 ? sp.lib : null, forms: Math.round(z0) === sp.sys.z0 ? sp.forms : [] })} /></Row>
              <Row label="Total concentration"><NumField label="Total concentration" value={sp.conc} min={0} onChange={(v) => set({ conc: v })} unit="M" /></Row>
            </Section>
            <Section title="Medium" id="sp-medium">
              <Row label="Temperature"><NumField label="Temperature" value={sp.temperature} min={0} max={100} onChange={(v) => set({ temperature: v })} unit="°C" /></Row>
              <Row label="Ionic strength" hint="With an activity model the constants are corrected to this ionic strength."><NumField label="Ionic strength" value={sp.ionic} min={0} onChange={(v) => set({ ionic: v })} unit="M" /></Row>
              <Row label="Activities"><Sel label="Activity model" width={190} value={sp.activity} options={[{ id: 'none', label: 'Ideal' }, { id: 'davies', label: 'Davies equation' }, { id: 'edh', label: 'Extended Debye–Hückel' }] as Array<{ id: ActivityModel; label: string }>} onChange={(v) => set({ activity: v })} /></Row>
            </Section>
            <Section title="At one pH" id="sp-at">
              <Row label="pH"><NumField label="pH to look at" value={pH} digits={4} onChange={setPH} /></Row>
              <input type="range" className="ti-slider" min={0} max={14} step={0.05} value={Math.min(14, Math.max(0, pH))} aria-label="pH" onChange={(e) => setPH(Number(e.target.value))} />
              {here && (
                <>
                  <div className="ti-stack tall" role="img" aria-label={labels.map((l, j) => `${l} ${fixed(here.alpha[j] * 100, 1)} %`).join(', ')}>
                    {here.alpha.map((a, j) => a > 0.003 && <span key={j} className={`ti-stack-${j % 6}`} style={{ flexGrow: a }} title={`${labels[j]}: ${fixed(a * 100, 1)} %`}>{a > 0.1 ? labels[j] : ''}</span>)}
                  </div>
                  <table className="ti-table compact">
                    <tbody>
                      {here.alpha.map((a, j) => <tr key={j}><th scope="row">{labels[j]}</th><td>{fixed(a * 100, 2)} %</td><td>{sig(here.conc[j], 3)} M</td></tr>)}
                      <tr><th scope="row">Mean charge</th><td colSpan={2}>{fixed(here.meanCharge, 3)}</td></tr>
                    </tbody>
                  </table>
                </>
              )}
            </Section>
            <Section title="Titrate a species" id="sp-titrate">
              <Row label="Species"><Sel label="Species to titrate" width={170} value={String(form)} options={labels.map((l, j) => ({ id: String(j), label: l }))} onChange={(v) => { setForm(Number(v)); setDiagram('titration') }} /></Row>
              <Row label="With"><Seg label="Titrant" value={dir} options={[{ id: 'base', label: 'Strong base' }, { id: 'acid', label: 'Strong acid' }]} onChange={(d) => { setDir(d); setDiagram('titration') }} /></Row>
              {!dirOk && <Notice kind="warn">{dir === 'base' ? 'This species has no proton left to remove.' : 'This species cannot take another proton.'}</Notice>}
              <button type="button" className="k-btn small" disabled={!dirOk || !valid} onClick={() => onTitrate(sp, form, dir)}><Beaker size={12} /> Open in the Titration tab</button>
            </Section>
          </aside>
        )}
        {(!compact || view === 'chart') && (
          <main className="ti-main">
            {!valid ? <Empty>Choose a substance and give a concentration above zero.</Empty> : (
              <>
                <div className="ti-chartbar">
                  <Seg label="Diagram" value={diagram} options={[{ id: 'alpha', label: 'α diagram' }, { id: 'sillen', label: 'log C–pH' }, { id: 'beta', label: 'Buffer capacity' }, { id: 'titration', label: 'Titration' }]} onChange={setDiagram} />
                  {data?.pI !== null && data?.pI !== undefined && <span className="ti-chip" title="pH where the mean charge is zero">pI = {fixed(data.pI, 2)}</span>}
                </div>
                <div className="ti-plot">{figure ? <Chart figure={figure} label={`${diagram} diagram of ${sp.sys.label}`} /> : <Empty>Pick a species that can be titrated in that direction.</Empty>}</div>
                <div className="ti-results">
                  <table className="ti-table">
                    <thead><tr><th>Step</th><th>pKa (25 °C, I = 0)</th><th>at {sp.temperature} °C</th><th>at I = {sig(sp.activity === 'none' ? 0 : sp.ionic, 3)} M</th><th>α crosses at pH</th></tr></thead>
                    <tbody>
                      {table.map((r, i) => <tr key={i}><td>{labels[i]} → {labels[i + 1]}</td><td>{fixed(r.thermodynamic, 2)}</td><td>{fixed(r.atT, 2)}</td><td>{fixed(r.atI, 2)}</td><td>{data ? fixed(data.crossings[i] ?? NaN, 2) : '–'}</td></tr>)}
                    </tbody>
                  </table>
                  {data?.pI !== null && data?.pI !== undefined && n === 2 && <div className="ti-hint">Isoelectric point = ½(pKa₁ + pKa₂) = {fixed((sp.sys.pKa[0] + sp.sys.pKa[1]) / 2, 2)} for a two-step ampholyte; here the exact value is {fixed(data.pI, 3)}.</div>}
                </div>
              </>
            )}
          </main>
        )}
      </div>
    </div>
  )
}
