// Acids & pH: conversions, strong and weak acids and bases, buffers, a titration curve and a table of pKa values.

import { useMemo } from 'react'
import { TestTube } from 'lucide-react'
import {
  COMMON_ACIDS, COMMON_BASES, bufferPH, bufferRecipe, phFrom, strongAcid, strongBase, titrationCurve, weakAcid, weakBase,
  type Solution, type TitrationCurve,
} from './acids'
import { fmt, molarMass, parseNum } from './chem'
import type { AcidsForm } from './forms'
import { Answer, Card, Err, Field, Fx, Hint, NumInput, ResultActions, Select, Tabs } from './ui'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

type Calc<T> = { ok: true; v: T } | { ok: false; message: string }
function calc<T>(f: () => T): Calc<T> {
  try {
    return { ok: true, v: f() }
  } catch (e) {
    return { ok: false, message: errText(e) }
  }
}

function need(s: string, what: string): number {
  const v = parseNum(s)
  if (v === null || Number.isNaN(v)) throw new Error(`Type ${what} (a number).`)
  return v
}

/** "2.15, 7.20 12.35" → [2.15, 7.2, 12.35] (decimal point, not comma). */
export function parseList(s: string, what: string): number[] {
  const parts = s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)
  if (parts.length === 0) throw new Error(`Type ${what}.`)
  return parts.map((p) => {
    const v = Number(p)
    if (!Number.isFinite(v)) throw new Error(`"${p}" is not a number.`)
    return v
  })
}

// ---------------------------------------------------------------- pieces

function PhConvert({ f, set }: { f: AcidsForm; set: (p: Partial<AcidsForm>) => void }) {
  const p = f.ph
  const r = useMemo(() => calc(() => phFrom(p.kind, need(p.value, 'a value'))), [p])
  const text = r.ok ? `${p.kind} = ${p.value}\npH ${fmt(r.v.pH)}, pOH ${fmt(r.v.pOH)}, [H+] ${fmt(r.v.H)} M, [OH-] ${fmt(r.v.OH)} M` : ''
  return (
    <Card title="pH, pOH, [H⁺], [OH⁻]" icon={<TestTube size={15} />} actions={<ResultActions tool="acids" label="pH conversion" text={text} />}>
      <div className="kc-grid">
        <Field label="I know">
          <Select value={p.kind} onChange={(kind) => set({ ph: { ...p, kind } })} label="Known quantity" options={[{ id: 'pH', label: 'pH' }, { id: 'pOH', label: 'pOH' }, { id: 'H', label: '[H⁺] (mol/L)' }, { id: 'OH', label: '[OH⁻] (mol/L)' }]} />
        </Field>
        <Field label="Value"><NumInput value={p.value} onChange={(value) => set({ ph: { ...p, value } })} label="Value" placeholder={p.kind === 'H' || p.kind === 'OH' ? '1e-3' : '7.4'} /></Field>
      </div>
      {r.ok ? (
        <table className="kc-table">
          <tbody>
            <tr><td>pH</td><td><b>{fmt(r.v.pH)}</b></td></tr>
            <tr><td>pOH</td><td>{fmt(r.v.pOH)}</td></tr>
            <tr><td>[H⁺] (mol/L)</td><td>{fmt(r.v.H)}</td></tr>
            <tr><td>[OH⁻] (mol/L)</td><td>{fmt(r.v.OH)}</td></tr>
            <tr><td>the solution is</td><td>{Math.abs(r.v.pH - 7) < 0.05 ? 'neutral' : r.v.pH < 7 ? 'acidic' : 'basic'}</td></tr>
          </tbody>
        </table>
      ) : <Err>{r.message}</Err>}
      <Hint>At 25 °C: pH + pOH = 14.</Hint>
    </Card>
  )
}

function Strong({ f, set }: { f: AcidsForm; set: (p: Partial<AcidsForm>) => void }) {
  const s = f.strong
  const r = useMemo(
    () => calc((): Solution => {
      const C = need(s.conc, 'the concentration')
      const n = need(s.n, 'how many H⁺ / OH⁻ each gives')
      return s.type === 'acid' ? strongAcid(C, n) : strongBase(C, n)
    }),
    [s],
  )
  const text = r.ok ? `Strong ${s.type} ${s.conc} mol/L (×${s.n})\npH ${fmt(r.v.pH)}, [H+] ${fmt(r.v.H)} M, [OH-] ${fmt(r.v.OH)} M` : ''
  return (
    <Card title="Strong acid or base" actions={<ResultActions tool="acids" label={`pH of ${s.conc} M strong ${s.type}`} text={text} />}>
      <div className="kc-grid">
        <Field label="It is a"><Select value={s.type} onChange={(type) => set({ strong: { ...s, type } })} label="Acid or base" options={[{ id: 'acid', label: 'strong acid (HCl, HNO₃…)' }, { id: 'base', label: 'strong base (NaOH, KOH…)' }]} /></Field>
        <Field label="Concentration (mol/L)"><NumInput value={s.conc} onChange={(conc) => set({ strong: { ...s, conc } })} label="Concentration" /></Field>
        <Field label={s.type === 'acid' ? 'H⁺ given per molecule' : 'OH⁻ given per formula unit'} hint={s.type === 'acid' ? '1 for HCl, 2 for H₂SO₄ (approx.)' : '1 for NaOH, 2 for Ba(OH)₂'}>
          <NumInput value={s.n} onChange={(n) => set({ strong: { ...s, n } })} label="Ions per formula unit" />
        </Field>
      </div>
      {r.ok ? <Answer>pH <b>{fmt(r.v.pH)}</b> <span className="k-muted">· [H⁺] {fmt(r.v.H)} M · [OH⁻] {fmt(r.v.OH)} M</span></Answer> : <Err>{r.message}</Err>}
      <Hint>Complete dissociation, with the water's own H⁺ / OH⁻ included (it matters below about 10⁻⁶ M).</Hint>
    </Card>
  )
}

function distributionLabels(n: number): string[] {
  return Array.from({ length: n + 1 }, (_, j) => (j === 0 ? 'HₙA (fully protonated)' : j === n ? 'fully deprotonated' : `${j} proton${j === 1 ? '' : 's'} lost`))
}

function Weak({ f, set, onPick }: { f: AcidsForm; set: (p: Partial<AcidsForm>) => void; onPick: (name: string) => void }) {
  const w = f.weak
  const r = useMemo(
    () =>
      calc(() => {
        const C = need(w.conc, 'the concentration')
        const raw = parseList(w.constants, 'the constant')
        if (w.type === 'base' && raw.length > 1) throw new Error('Give a single pKb (or Kb) for a base.')
        const pK = raw.map((x) => {
          if (w.mode === 'pKa' || w.mode === 'pKb') return x
          if (!(x > 0)) throw new Error('A Ka (or Kb) must be above zero, e.g. 1.8e-5.')
          return -Math.log10(x)
        })
        const sol = w.type === 'acid' ? weakAcid(C, pK) : weakBase(C, pK[0])
        return { sol, pK, C }
      }),
    [w],
  )
  const modes: AcidsForm['weak']['mode'][] = w.type === 'acid' ? ['pKa', 'Ka'] : ['pKb', 'Kb']
  const text = r.ok
    ? `Weak ${w.type} ${w.conc} mol/L, ${w.mode} ${w.constants}\npH ${fmt(r.v.sol.pH)}, [H+] ${fmt(r.v.sol.H)} M${r.v.sol.alpha !== null ? `, ionised ${fmt(r.v.sol.alpha * 100)} %` : ''}`
    : ''
  return (
    <Card title="Weak acid or base" actions={<ResultActions tool="acids" label={`pH of ${w.conc} M weak ${w.type}`} text={text} />}>
      <div className="kc-grid">
        <Field label="Fill in from a common one">
          <select className="k-input kc-select" value="" aria-label="Common acid or base" onChange={(e) => e.target.value && onPick(e.target.value)}>
            <option value="">choose…</option>
            <optgroup label="Acids">{COMMON_ACIDS.filter((a) => a.pKa[0] > 0).map((a) => <option key={a.name} value={`a:${a.name}`}>{a.name} ({a.formula})</option>)}</optgroup>
            <optgroup label="Bases">{COMMON_BASES.map((b) => <option key={b.name} value={`b:${b.name}`}>{b.name} ({b.formula})</option>)}</optgroup>
          </select>
        </Field>
        <Field label="It is a">
          <Select
            value={w.type}
            onChange={(type) => set({ weak: { ...w, type, mode: type === 'acid' ? 'pKa' : 'pKb' } })}
            label="Acid or base"
            options={[{ id: 'acid', label: 'weak acid (HA)' }, { id: 'base', label: 'weak base (B)' }]}
          />
        </Field>
        <Field label="Concentration (mol/L)"><NumInput value={w.conc} onChange={(conc) => set({ weak: { ...w, conc } })} label="Concentration" /></Field>
        <Field label="Constant">
          <Select value={w.mode} onChange={(mode) => set({ weak: { ...w, mode } })} options={modes} label="Kind of constant" />
        </Field>
        <Field label={`${w.mode}${w.type === 'acid' ? ' (one per proton, separated by commas)' : ''}`}>
          <input className="k-input kc-mono" value={w.constants} onChange={(e) => set({ weak: { ...w, constants: e.target.value } })} spellCheck={false} aria-label="Constants" placeholder={w.mode.startsWith('p') ? '4.76' : '1.8e-5'} />
        </Field>
      </div>
      {r.ok ? (
        <>
          <Answer>pH <b>{fmt(r.v.sol.pH)}</b> <span className="k-muted">· [H⁺] {fmt(r.v.sol.H)} M · [OH⁻] {fmt(r.v.sol.OH)} M</span></Answer>
          {r.v.sol.alpha !== null && r.v.sol.alpha < 1 && <div className="kc-result">Ionised: <b>{fmt(r.v.sol.alpha * 100)} %</b></div>}
          {w.type === 'acid' && r.v.sol.distribution && r.v.sol.distribution.length > 2 && (
            <table className="kc-table">
              <thead><tr><th>species</th><th>fraction %</th></tr></thead>
              <tbody>{distributionLabels(r.v.pK.length).map((l, j) => <tr key={l}><td>{l}</td><td>{fmt((r.v.sol.distribution as number[])[j] * 100)}</td></tr>)}</tbody>
            </table>
          )}
        </>
      ) : <Err>{r.message}</Err>}
      <Hint>Solved exactly from the charge balance (the quadratic x² + Ka·x − Ka·C = 0 for one proton, with water and every further step for polyprotic acids). For a base give its pKb (pKb = 14 − pKa of its conjugate acid).</Hint>
    </Card>
  )
}

function Buffer({ f, set }: { f: AcidsForm; set: (p: Partial<AcidsForm>) => void }) {
  const b = f.buffer
  const pick = (v: string) => {
    const a = COMMON_ACIDS.find((x) => `a:${x.name}` === v)
    if (a) set({ buffer: { ...b, pKa: String(a.pKa.find((p) => p > 1) ?? a.pKa[0]) } })
  }
  const hh = useMemo(() => calc(() => bufferPH(need(b.pKa, 'the pKa'), need(b.acid, 'the acid concentration'), need(b.base, 'the base concentration'))), [b.pKa, b.acid, b.base])
  const rec = useMemo(
    () =>
      calc(() => {
        const pKa = need(b.pKa, 'the pKa')
        const r = bufferRecipe(pKa, need(b.target, 'the target pH'), need(b.total, 'the total concentration'), need(b.volume, 'the volume'))
        const grams = (formula: string, mol: number): number | null => {
          try {
            return formula.trim() ? mol * molarMass(formula) : null
          } catch {
            return null
          }
        }
        return { r, gAcid: grams(b.acidF, r.molesAcid), gBase: grams(b.baseF, r.molesBase) }
      }),
    [b],
  )
  const text1 = hh.ok ? `Buffer pKa ${b.pKa}, [HA] ${b.acid}, [A-] ${b.base}\npH = ${fmt(hh.v)}` : ''
  const text2 = rec.ok
    ? `Buffer pH ${b.target}, ${b.total} mol/L, ${b.volume} L, pKa ${b.pKa}\nacid form ${fmt(rec.v.r.molesAcid)} mol${rec.v.gAcid !== null ? ` (${fmt(rec.v.gAcid)} g ${b.acidF})` : ''}, base form ${fmt(rec.v.r.molesBase)} mol${rec.v.gBase !== null ? ` (${fmt(rec.v.gBase)} g ${b.baseF})` : ''}`
    : ''
  return (
    <>
      <Card title="Buffer pH (Henderson–Hasselbalch)" actions={<ResultActions tool="acids" label="Buffer pH" text={text1} />}>
        <div className="kc-grid">
          <Field label="Take the pKa of">
            <select className="k-input kc-select" value="" aria-label="Common acid" onChange={(e) => pick(e.target.value)}>
              <option value="">choose…</option>
              {COMMON_ACIDS.filter((a) => a.pKa[0] > 0).map((a) => <option key={a.name} value={`a:${a.name}`}>{a.name} ({a.pKa.join(' / ')})</option>)}
            </select>
          </Field>
          <Field label="pKa"><NumInput value={b.pKa} onChange={(pKa) => set({ buffer: { ...b, pKa } })} label="pKa" /></Field>
          <Field label="[acid HA] (mol/L)"><NumInput value={b.acid} onChange={(acid) => set({ buffer: { ...b, acid } })} label="Acid concentration" /></Field>
          <Field label="[base A⁻] (mol/L)"><NumInput value={b.base} onChange={(base) => set({ buffer: { ...b, base } })} label="Base concentration" /></Field>
        </div>
        {hh.ok ? (
          <>
            <Answer>Buffer pH <b>{fmt(hh.v)}</b></Answer>
            {Math.abs(hh.v - Number(b.pKa)) > 1 && <div className="kc-warn">The ratio is outside 0.1–10: the buffering is weak and the formula less accurate.</div>}
          </>
        ) : <Err>{hh.message}</Err>}
      </Card>
      <Card title="Make a buffer of a given pH" actions={<ResultActions tool="acids" slot="recipe" label="Buffer recipe" text={text2} />}>
        <div className="kc-grid">
          <Field label="Target pH"><NumInput value={b.target} onChange={(target) => set({ buffer: { ...b, target } })} label="Target pH" /></Field>
          <Field label="Total buffer (mol/L)" hint="acid + base"><NumInput value={b.total} onChange={(total) => set({ buffer: { ...b, total } })} label="Total concentration" /></Field>
          <Field label="Volume (L)"><NumInput value={b.volume} onChange={(volume) => set({ buffer: { ...b, volume } })} label="Volume" /></Field>
          <Field label="Acid form (for grams)"><input className="k-input kc-mono" value={b.acidF} onChange={(e) => set({ buffer: { ...b, acidF: e.target.value } })} spellCheck={false} aria-label="Acid formula" /></Field>
          <Field label="Base form (for grams)"><input className="k-input kc-mono" value={b.baseF} onChange={(e) => set({ buffer: { ...b, baseF: e.target.value } })} spellCheck={false} aria-label="Base formula" /></Field>
        </div>
        {rec.ok ? (
          <>
            <table className="kc-table">
              <thead><tr><th /><th>moles</th><th>grams</th><th>mol/L</th></tr></thead>
              <tbody>
                <tr><td>acid form HA {b.acidF.trim() && <Fx f={b.acidF} />}</td><td>{fmt(rec.v.r.molesAcid)}</td><td>{rec.v.gAcid === null ? '–' : fmt(rec.v.gAcid)}</td><td>{fmt(rec.v.r.molesAcid / Number(b.volume))}</td></tr>
                <tr><td>base form A⁻ {b.baseF.trim() && <Fx f={b.baseF} />}</td><td>{fmt(rec.v.r.molesBase)}</td><td>{rec.v.gBase === null ? '–' : fmt(rec.v.gBase)}</td><td>{fmt(rec.v.r.molesBase / Number(b.volume))}</td></tr>
              </tbody>
            </table>
            <div className="kc-result">
              Ratio [A⁻]/[HA] = <b>{fmt(rec.v.r.ratio)}</b>. Or start from <b>{fmt(rec.v.r.molesAcid + rec.v.r.molesBase)} mol</b> of the acid form and add <b>{fmt(rec.v.r.molesStrongBase)} mol</b> of strong base (NaOH);
              or from the base form and add <b>{fmt(rec.v.r.molesStrongAcid)} mol</b> of strong acid (HCl). Then make up to the volume and check with a pH meter.
            </div>
            {rec.v.r.weak && <div className="kc-warn">The target is more than one pH unit from the pKa: choose an acid whose pKa is closer.</div>}
          </>
        ) : <Err>{rec.message}</Err>}
      </Card>
    </>
  )
}

/** The titration curve, drawn with the theme colours. */
function TitrationChart({ curve }: { curve: TitrationCurve }) {
  const W = 540
  const H = 300
  const L = 40
  const R = 14
  const T = 12
  const B = 36
  const maxV = curve.points[curve.points.length - 1].volume
  const x = (v: number) => L + (v / maxV) * (W - L - R)
  const y = (p: number) => T + (1 - Math.max(0, Math.min(14, p)) / 14) * (H - T - B)
  const d = curve.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.volume).toFixed(1)},${y(p.pH).toFixed(1)}`).join(' ')
  const step = maxV > 100 ? 20 : maxV > 50 ? 10 : maxV > 20 ? 5 : maxV > 10 ? 2 : 1
  const xt: number[] = []
  for (let v = 0; v <= maxV + 1e-9; v += step) xt.push(v)
  return (
    <svg className="kc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Titration curve">
      {[0, 2, 4, 6, 8, 10, 12, 14].map((p) => (
        <g key={p}>
          <line x1={L} x2={W - R} y1={y(p)} y2={y(p)} className={p === 7 ? 'kc-neutral-line' : 'kc-grid-line'} />
          <text x={L - 6} y={y(p) + 3.5} textAnchor="end" className="kc-axis-text">{p}</text>
        </g>
      ))}
      {xt.map((v) => (
        <text key={v} x={x(v)} y={H - B + 14} textAnchor="middle" className="kc-axis-text">{v}</text>
      ))}
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="kc-axis-text">titrant added (mL)</text>
      <text x={11} y={(T + H - B) / 2} textAnchor="middle" className="kc-axis-text" transform={`rotate(-90 11 ${(T + H - B) / 2})`}>pH</text>
      {curve.equivalence.map((v, i) => (
        <g key={v}>
          <line x1={x(v)} x2={x(v)} y1={T} y2={H - B} className="kc-eq-line" />
          <circle cx={x(v)} cy={y(curve.equivalencePH[i])} r={4} className="kc-eq-dot"><title>{`equivalence ${fmt(v)} mL, pH ${fmt(curve.equivalencePH[i])}`}</title></circle>
        </g>
      ))}
      <circle cx={x(curve.equivalence[0] / 2)} cy={y(curve.halfPH)} r={4} className="kc-half-dot"><title>{`half-equivalence, pH ${fmt(curve.halfPH)}`}</title></circle>
      <path d={d} className="kc-curve" />
    </svg>
  )
}

function Titration({ f, set }: { f: AcidsForm; set: (p: Partial<AcidsForm>) => void }) {
  const t = f.titr
  const pick = (v: string) => {
    const a = COMMON_ACIDS.find((x) => `a:${x.name}` === v)
    if (a) set({ titr: { ...t, analyte: 'acid', constants: a.pKa.join(', ') } })
    const b = COMMON_BASES.find((x) => `b:${x.name}` === v)
    if (b) set({ titr: { ...t, analyte: 'base', constants: String(b.pKb) } })
  }
  const r = useMemo(
    () =>
      calc(() => {
        const mx = parseNum(t.max)
        return titrationCurve({
          analyte: t.analyte,
          concentration: need(t.conc, 'the analyte concentration'),
          volume: need(t.volume, 'the analyte volume'),
          titrant: need(t.titrant, 'the titrant concentration'),
          pKs: parseList(t.constants, 'the pKa values'),
          maxVolume: mx !== null && !Number.isNaN(mx) ? mx : undefined,
        })
      }),
    [t],
  )
  const text = r.ok
    ? `Titration of ${t.volume} mL of ${t.conc} M ${t.analyte} (${t.analyte === 'acid' ? 'pKa' : 'pKb'} ${t.constants}) with ${t.titrant} M strong ${t.analyte === 'acid' ? 'base' : 'acid'}\n` +
      `start pH ${fmt(r.v.start)}; half-equivalence pH ${fmt(r.v.halfPH)}; ` +
      r.v.equivalence.map((v, i) => `equivalence ${i + 1}: ${fmt(v)} mL, pH ${fmt(r.v.equivalencePH[i])}`).join('; ')
    : ''
  return (
    <Card title="Titration curve" actions={<ResultActions tool="acids" slot="titration" label="Titration" text={text} />}>
      <div className="kc-grid">
        <Field label="Fill in from a common one">
          <select className="k-input kc-select" value="" aria-label="Common acid or base" onChange={(e) => pick(e.target.value)}>
            <option value="">choose…</option>
            <optgroup label="Acids">{COMMON_ACIDS.map((a) => <option key={a.name} value={`a:${a.name}`}>{a.name}</option>)}</optgroup>
            <optgroup label="Bases">{COMMON_BASES.map((b) => <option key={b.name} value={`b:${b.name}`}>{b.name}</option>)}</optgroup>
          </select>
        </Field>
        <Field label="Analyte">
          <Select value={t.analyte} onChange={(analyte) => set({ titr: { ...t, analyte } })} label="Analyte" options={[{ id: 'acid', label: 'acid, titrated with NaOH' }, { id: 'base', label: 'base, titrated with HCl' }]} />
        </Field>
        <Field label={t.analyte === 'acid' ? 'pKa (one per proton; −3 = strong)' : 'pKb (one per protonation step)'}>
          <input className="k-input kc-mono" value={t.constants} onChange={(e) => set({ titr: { ...t, constants: e.target.value } })} spellCheck={false} aria-label="Constants" />
        </Field>
        <Field label="Analyte concentration (mol/L)"><NumInput value={t.conc} onChange={(conc) => set({ titr: { ...t, conc } })} label="Analyte concentration" /></Field>
        <Field label="Analyte volume (mL)"><NumInput value={t.volume} onChange={(volume) => set({ titr: { ...t, volume } })} label="Analyte volume" /></Field>
        <Field label="Titrant concentration (mol/L)"><NumInput value={t.titrant} onChange={(titrant) => set({ titr: { ...t, titrant } })} label="Titrant concentration" /></Field>
        <Field label="Up to (mL, optional)"><NumInput value={t.max} onChange={(max) => set({ titr: { ...t, max } })} label="Maximum volume" placeholder="auto" /></Field>
      </div>
      {r.ok ? (
        <>
          <TitrationChart curve={r.v} />
          <table className="kc-table">
            <thead><tr><th>point</th><th>volume (mL)</th><th>pH</th></tr></thead>
            <tbody>
              <tr><td>start</td><td>0</td><td>{fmt(r.v.start)}</td></tr>
              <tr><td>half-equivalence</td><td>{fmt(r.v.equivalence[0] / 2)}</td><td>{fmt(r.v.halfPH)}</td></tr>
              {r.v.equivalence.map((v, i) => <tr key={v}><td>equivalence {r.v.equivalence.length > 1 ? i + 1 : ''}</td><td>{fmt(v)}</td><td><b>{fmt(r.v.equivalencePH[i])}</b></td></tr>)}
            </tbody>
          </table>
        </>
      ) : <Err>{r.message}</Err>}
      <Hint>Exact charge balance at every point (water, every dissociation step, dilution by the titrant). Pick an indicator whose colour change brackets the pH at equivalence.</Hint>
    </Card>
  )
}

function Table({ use }: { use: (name: string) => void }) {
  return (
    <Card title="pKa values of common acids">
      <div className="kc-scrollbox">
        <table className="kc-table kc-pka">
          <thead><tr><th>acid</th><th>formula</th><th>pKa</th><th>note</th><th /></tr></thead>
          <tbody>
            {COMMON_ACIDS.map((a) => (
              <tr key={a.name}>
                <td>{a.name}</td><td><Fx f={a.formula} /></td><td>{a.pKa.join(' · ')}</td><td className="k-muted">{a.note ?? ''}</td>
                <td><button className="k-btn small" onClick={() => use(`a:${a.name}`)}>Use</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="kc-table kc-pka">
          <thead><tr><th>base</th><th>formula</th><th>pKb</th><th>pKa (conj. acid)</th><th /></tr></thead>
          <tbody>
            {COMMON_BASES.map((b) => (
              <tr key={b.name}><td>{b.name}</td><td><Fx f={b.formula} /></td><td>{b.pKb}</td><td>{fmt(14 - b.pKb)}</td><td><button className="k-btn small" onClick={() => use(`b:${b.name}`)}>Use</button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <Hint>Values at 25 °C in water (rounded). “Use” fills the weak acid / base calculator.</Hint>
    </Card>
  )
}

export function AcidsTool({ f, set }: { f: AcidsForm; set: (p: Partial<AcidsForm>) => void }) {
  const pickWeak = (v: string) => {
    const a = COMMON_ACIDS.find((x) => `a:${x.name}` === v)
    if (a) set({ sub: 'weak', weak: { ...f.weak, type: 'acid', mode: 'pKa', constants: a.pKa.join(', ') } })
    const b = COMMON_BASES.find((x) => `b:${x.name}` === v)
    if (b) set({ sub: 'weak', weak: { ...f.weak, type: 'base', mode: 'pKb', constants: String(b.pKb) } })
  }
  return (
    <div className="kc-tool-body">
      <Tabs
        value={f.sub}
        onChange={(sub) => set({ sub })}
        tabs={[
          { id: 'ph', label: 'pH ⇄ [H⁺]' }, { id: 'strong', label: 'Strong' }, { id: 'weak', label: 'Weak' },
          { id: 'buffer', label: 'Buffers' }, { id: 'titration', label: 'Titration' }, { id: 'table', label: 'pKa table' },
        ]}
      />
      {f.sub === 'ph' && <PhConvert f={f} set={set} />}
      {f.sub === 'strong' && <Strong f={f} set={set} />}
      {f.sub === 'weak' && <Weak f={f} set={set} onPick={pickWeak} />}
      {f.sub === 'buffer' && <Buffer f={f} set={set} />}
      {f.sub === 'titration' && <Titration f={f} set={set} />}
      {f.sub === 'table' && <Table use={pickWeak} />}
    </div>
  )
}
