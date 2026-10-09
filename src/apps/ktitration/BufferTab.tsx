// The Buffer designer: target pH, total concentration, ionic strength and temperature → the exact amounts of
// each component (charge balance at the target pH), the volumes of stock solutions for a final volume, the
// buffer capacity and what temperature does to the pH of the recipe.

import { useEffect, useMemo, type MutableRefObject } from 'react'
import { Copy, Download, Wand2 } from 'lucide-react'
import { bestPair, designBuffer, hendersonRatio, type BufferMode, type BufferSpec } from './buffer'
import { Chart, usePalette } from './Chart'
import { pkaById, systemOf } from './data/pka'
import { bufferCapacity } from './equilibria'
import { betaFigure, type Figure, type Palette } from './figures'
import { fixed, sig } from './format'
import { formLabels, type Project } from './project'
import { bufferReport } from './report'
import { diagramData } from './speciation'
import { Empty, Notice, NumField, NumListField, PkaPicker, Row, Sel, Section } from './ui'

export function BufferTab({
  project, update, exportRef, compact, onCopy, onSaveText,
}: {
  project: Project
  update: (fn: (p: Project) => Project, key?: string) => void
  exportRef: MutableRefObject<null | ((pal: Palette) => Figure | null)>
  compact: boolean
  onCopy: (text: string, what: string) => void
  onSaveText: (defaultName: string, ext: string, text: string) => void
}) {
  const pal = usePalette()
  const b = project.buffer
  const set = (patch: Partial<BufferSpec>) => update((p) => ({ ...p, buffer: { ...p.buffer, ...patch } }), 'bf')
  const n = b.sys.pKa.length
  const labels = b.forms.length === n + 1 ? b.forms : formLabels({ lib: b.lib, pKa: b.sys.pKa, z0: b.sys.z0 })
  const recipe = useMemo(() => designBuffer(b), [b])
  const med = useMemo(() => ({ T: b.temperature, activity: b.activity }), [b.temperature, b.activity])
  const curve = useMemo(() => {
    if (!recipe.parts.length) return null
    const dis = recipe.parts.map((p) => ({ sys: b.sys, form: p.form, conc: p.conc }))
    const I = recipe.I
    const pH: number[] = []
    const beta: number[] = []
    for (let v = 0; v <= 14.0001; v += 0.05) {
      pH.push(v)
      beta.push(bufferCapacity(dis, v, I, med))
    }
    return { pH, beta }
  }, [recipe, b.sys, med])
  const figure = useMemo<Figure | null>(() => {
    if (!curve) return null
    const d = diagramData({ sys: b.sys, conc: b.conc, ionic: 0, activity: 'none', T: b.temperature })
    const f = betaFigure({ ...d, pH: curve.pH, beta: curve.beta }, pal)
    f.layout.shapes = [...((f.layout.shapes as Record<string, unknown>[]) ?? []), { type: 'line', xref: 'x', x0: b.pH, x1: b.pH, yref: 'paper', y0: 0, y1: 1, line: { color: pal.danger, width: 1.5, dash: 'dash' } }]
    f.layout.annotations = [{ x: b.pH, xref: 'x', y: 1, yref: 'paper', yanchor: 'bottom', text: `target pH ${b.pH}`, showarrow: false, font: { size: 10, color: pal.danger } }]
    return f
  }, [curve, b.sys, b.conc, b.temperature, b.pH, pal])
  useEffect(() => {
    exportRef.current = (p) => (curve ? (() => { const d = diagramData({ sys: b.sys, conc: b.conc, ionic: 0, activity: 'none', T: b.temperature }); return betaFigure({ ...d, pH: curve.pH, beta: curve.beta }, p) })() : null)
    return () => { exportRef.current = null }
  }, [exportRef, curve, b.sys, b.conc, b.temperature])

  const pick = (id: string) => {
    const e = pkaById(id)
    if (!e) return
    const sys = systemOf(e)
    const bp = bestPair(sys, b.pH)
    const baseLike = e.category === 'Amines and N-bases' || (e.category === 'Biological buffers' && e.z0 === 1)
    set({ lib: e.id, sys, forms: [...e.forms], formA: bp.formA, formB: bp.formB, mode: baseLike ? 'base-acid' : 'acid-base' })
  }
  const suggest = () => {
    const bp = bestPair(b.sys, b.pH)
    set({ formA: bp.formA, formB: bp.formB })
  }
  const text = bufferReport(b, recipe)
  const hh = b.mode === 'salts' && recipe.parts.length === 2 ? { ratio: recipe.parts[1].conc / recipe.parts[0].conc, ideal: hendersonRatio(b.pH, b.sys.pKa[Math.min(b.formA, b.formB)]) } : null
  const forms = Array.from({ length: n + 1 }, (_, j) => ({ id: String(j), label: labels[j] ?? `species ${j}` }))

  return (
    <div className="ti-split" data-compact={compact || undefined}>
      <div className="ti-split-body">
        <aside className="ti-setup" aria-label="Buffer set-up">
          <Section title="Buffer system" id="bf-system">
            <Row label="Substance"><PkaPicker value={b.lib} label="Buffer substance from the pKa table" onPick={(e) => pick(e.id)} buttonLabel={b.lib ? undefined : 'Custom constants'} /></Row>
            <Row label="pKa"><NumListField label="pKa values of the buffer system" value={b.sys.pKa} width={150} onChange={(pKa) => set({ sys: { ...b.sys, pKa, dpKadT: undefined }, lib: null, forms: [], formA: Math.min(b.formA, pKa.length), formB: Math.min(b.formB, pKa.length) })} /></Row>
            <Row label="Made from">
              <Sel label="How the buffer is made" value={b.mode} width={200} options={[
                { id: 'salts', label: 'Two salts (acid form + base form)' }, { id: 'acid-base', label: 'Acid form + strong base' }, { id: 'base-acid', label: 'Base form + strong acid' },
              ]} onChange={(mode) => set({ mode: mode as BufferMode })} />
            </Row>
            <Row label={b.mode === 'salts' ? 'Acid form' : b.mode === 'acid-base' ? 'Acid form' : 'Base form'}>
              <Sel label="First form" value={String(b.formA)} width={170} options={forms} onChange={(v) => set({ formA: Number(v) })} />
            </Row>
            {b.mode === 'salts' && <Row label="Base form"><Sel label="Second form" value={String(b.formB)} width={170} options={forms} onChange={(v) => set({ formB: Number(v) })} /></Row>}
            <button type="button" className="k-btn small" onClick={suggest} title="Pick the two forms whose pKa is nearest the target pH"><Wand2 size={12} /> Choose the forms for this pH</button>
          </Section>
          <Section title="Target" id="bf-target">
            <Row label="pH"><NumField label="Target pH" value={b.pH} digits={4} min={0} max={14} onChange={(v) => set({ pH: v })} /></Row>
            <Row label="Total concentration" hint="Of the buffer system (all its forms)."><NumField label="Total concentration of the buffer" value={b.conc} min={0} onChange={(v) => set({ conc: v })} unit="M" /></Row>
            <Row label="Final volume"><NumField label="Final volume" value={b.volume} min={0} onChange={(v) => set({ volume: v })} unit="mL" /></Row>
            <Row label="At temperature"><NumField label="Temperature at which the pH is wanted" value={b.temperature} min={0} max={100} onChange={(v) => set({ temperature: v })} unit="°C" /></Row>
          </Section>
          <Section title="Ionic strength" id="bf-ionic">
            <Row label="Activities"><Sel label="Activity model" value={b.activity} width={190} options={[{ id: 'none', label: 'Ideal' }, { id: 'davies', label: 'Davies equation' }, { id: 'edh', label: 'Extended Debye–Hückel' }]} onChange={(v) => set({ activity: v })} /></Row>
            <Row label="Ionic strength" hint="Made up with a neutral salt. Empty = as it comes."><NumField label="Target ionic strength (empty = none)" value={b.ionicStrength} min={0} placeholder="none" allowEmpty={{ onEmpty: () => set({ ionicStrength: null }) }} onChange={(v) => set({ ionicStrength: v > 0 ? v : null })} unit="M" /></Row>
            <Row label="Salt ions"><input className="k-input ti-input" style={{ width: 46 }} value={b.cation} aria-label="Cation of the salts" onChange={(e) => set({ cation: e.target.value })} /><input className="k-input ti-input" style={{ width: 46 }} value={b.anion} aria-label="Anion of the strong acid and background salt" onChange={(e) => set({ anion: e.target.value })} /></Row>
          </Section>
          <Section title="Stock solutions" id="bf-stocks">
            <Row label={b.mode === 'salts' ? 'Stock, acid form' : 'Stock, buffer'}><NumField label="Concentration of the first stock solution" value={b.stockA} min={0} onChange={(v) => set({ stockA: v })} unit="M" /></Row>
            <Row label={b.mode === 'salts' ? 'Stock, base form' : b.mode === 'acid-base' ? 'Stock, NaOH' : 'Stock, HCl'}><NumField label="Concentration of the second stock solution" value={b.stockB} min={0} onChange={(v) => set({ stockB: v })} unit="M" /></Row>
          </Section>
        </aside>
        <main className="ti-main">
          {!recipe.parts.length ? <Empty>{recipe.message}</Empty> : (
            <>
              <div className="ti-chartbar">
                <strong className="ti-bigline">pH {fixed(recipe.pH, 3)}</strong>
                <span className="ti-chip">I = {sig(recipe.I, 3)} M</span>
                <span className="ti-chip" title="mol of strong base per litre per pH unit">β = {sig(recipe.beta, 3)} M/pH</span>
                <span className="ti-spacer" />
                <button type="button" className="k-btn small" onClick={() => onCopy(text, 'Recipe')}><Copy size={12} /> Copy recipe</button>
                <button type="button" className="k-btn small" onClick={() => onSaveText(`buffer ${b.sys.label} pH ${b.pH}`, '.md', text)}><Download size={12} /> Save…</button>
              </div>
              {recipe.message && <Notice kind={recipe.ok ? 'info' : 'warn'}>{recipe.message}</Notice>}
              <div className="ti-results">
                <table className="ti-table">
                  <caption>Recipe for {fixed(b.volume, 0)} mL</caption>
                  <thead><tr><th>Component</th><th>Amount</th><th>In the buffer</th><th>Stock volume</th></tr></thead>
                  <tbody>
                    {recipe.items.map((i, k) => <tr key={k}><th scope="row">{i.label}</th><td>{sig(i.mmol, 4)} mmol</td><td>{sig(i.conc, 4)} M</td><td>{i.stockVolume === null ? 'weigh dry' : `${fixed(i.stockVolume, 2)} mL`}</td></tr>)}
                    <tr className={recipe.water < 0 ? 'ti-bad' : ''}><th scope="row">Water</th><td /><td /><td>{fixed(recipe.water, 2)} mL, up to {fixed(b.volume, 0)} mL</td></tr>
                  </tbody>
                </table>
                {hh && (
                  <div className="ti-hint">
                    Base/acid ratio: exact {fixed(hh.ratio, 3)}, Henderson–Hasselbalch {fixed(hh.ideal, 3)}
                    {Math.abs(Math.log10(hh.ratio / hh.ideal)) > 0.03 ? ` — they differ by ${fixed(Math.abs(Math.log10(hh.ratio / hh.ideal)), 2)} pH units because of ${b.activity === 'none' ? 'the buffer\'s own H⁺ and OH⁻' : 'activity coefficients'}.` : '.'}
                  </div>
                )}
                <table className="ti-table compact">
                  <caption>The same recipe at other temperatures</caption>
                  <thead><tr>{recipe.byTemperature.map((t) => <th key={t.T}>{t.T} °C</th>)}</tr></thead>
                  <tbody><tr>{recipe.byTemperature.map((t) => <td key={t.T} className={Math.abs(t.pH - b.pH) > 0.1 ? 'ti-warn' : ''}>{fixed(t.pH, 2)}</td>)}</tr></tbody>
                </table>
                {recipe.byTemperature.some((t) => Math.abs(t.pH - b.pH) > 0.1) && <div className="ti-hint">The pKa of this buffer depends on temperature: make it at the temperature where it will be used, or correct the pH before use.</div>}
              </div>
              <div className="ti-plot">{figure && <Chart figure={figure} label="Buffer capacity of the recipe against pH" />}</div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
