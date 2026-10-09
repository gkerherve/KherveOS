// The Titration tab: the set-up of the four kinds of titration, the curve with its marks and derivatives, the
// virtual burette and flask (step, drop, play), the manual practice and the quiz.

import { useEffect, useMemo, useState, type MutableRefObject } from 'react'
import { Beaker, ChevronsRight, Droplet, FlaskConical, GraduationCap, HelpCircle, Pause, Play, RotateCcw, SkipBack, Copy } from 'lucide-react'
import { Chart } from './Chart'
import { Burette, buretteCapacity } from './Burette'
import { derivativeFigure, titrationFigure, type Figure, type Palette } from './figures'
import { fixed } from './format'
import { MODES, formLabels, type Mode, type Project } from './project'
import { PracticePanel, QuizPanel, usePractice, useQuiz } from './PracticePanels'
import { phaseAt, speciesAt, factsText, type TitrationResult } from './result'
import { AcidBaseSetup, EdtaSetup, PrecipSetup, RedoxSetup } from './Setups'
import { usePalette } from './Chart'
import { Check, Empty, Notice, NumField, Sel, Seg } from './ui'
import { Section } from './ui'

export interface TitrationPrefs {
  derivs: boolean
  marks: boolean
  buffers: boolean
  band: boolean
}

export const DEFAULT_TITRATION_PREFS: TitrationPrefs = { derivs: false, marks: true, buffers: true, band: true }

type Lab = 'burette' | 'practice' | 'quiz'

const STEPS = [
  { id: '0.05', label: '0.05 mL (a drop)' }, { id: '0.1', label: '0.1 mL' }, { id: '0.5', label: '0.5 mL' }, { id: '1', label: '1 mL' }, { id: '2', label: '2 mL' }, { id: '5', label: '5 mL' },
]

const UNITS: Record<Mode, string> = { acidbase: 'pH', redox: 'V', edta: 'pM', precip: 'pAg' }

export function TitrationTab({
  project, result, update, docKey, prefs, setPrefs, exportRef, copy, compact,
}: {
  project: Project
  result: TitrationResult
  update: (fn: (p: Project) => Project, key?: string) => void
  docKey: number
  prefs: TitrationPrefs
  setPrefs: (p: Partial<TitrationPrefs>) => void
  exportRef: MutableRefObject<null | ((pal: Palette) => Figure | null)>
  copy: (text: string, what: string) => void
  compact: boolean
}) {
  const pal = usePalette()
  const [lab, setLab] = useState<Lab>('burette')
  const [view, setView] = useState<'setup' | 'chart' | 'lab'>('chart')
  const [V, setV] = useState(0)
  const [step, setStep] = useState('0.5')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState('1')
  const [dropKey, setDropKey] = useState(0)
  const [dropping, setDropping] = useState(false)
  const practice = usePractice()
  const quiz = useQuiz()

  const inPractice = lab === 'practice'
  const active = inPractice ? practice.result : result
  const activeV = inPractice ? practice.V : V
  const mode = inPractice ? 'acidbase' : project.mode

  // a new document starts at zero
  useEffect(() => { setV(0); setPlaying(false) }, [docKey])
  useEffect(() => { setV((v) => Math.min(v, result.vmax)) }, [result.vmax])

  const drop = () => {
    setDropKey((k) => k + 1)
    setDropping(true)
    window.setTimeout(() => setDropping(false), 520)
  }
  const add = (dv: number) => {
    if (inPractice) { practice.add(dv); drop(); return }
    setV((v) => Math.max(0, Math.min(result.vmax, Math.round((v + dv) * 1000) / 1000)))
    if (dv > 0) drop()
  }
  const reset = () => { setV(0); setPlaying(false) }

  // play: a steady pour, slower near an equivalence point so the colour change can be watched
  useEffect(() => {
    if (!playing || inPractice) return
    const id = window.setInterval(() => {
      setV((v) => {
        const near = result.eq.some((e) => Math.abs(v - e.V) < result.vmax * 0.03)
        const dv = (result.vmax / 160) * Number(speed) * (near ? 0.25 : 1)
        const next = v + dv
        if (next >= result.vmax) { setPlaying(false); return result.vmax }
        return next
      })
    }, 60)
    return () => window.clearInterval(id)
  }, [playing, speed, result, inPractice])

  // keyboard: D adds a drop, A adds a step, R resets, Space plays (not while typing in a field)
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable="true"], .ti-setup') || e.metaKey || e.ctrlKey || e.altKey) return
    if (lab === 'quiz') {
      const n = Number(e.key)
      if (n >= 1 && n <= 4) { e.preventDefault(); quiz.choose(n - 1) }
      else if (e.key === 'Enter') { e.preventDefault(); quiz.next() }
      return
    }
    const k = e.key.toLowerCase()
    if (k === 'd') { e.preventDefault(); add(0.05) }
    else if (k === 'a' || k === '+' || k === '=') { e.preventDefault(); add(Number(step)) }
    else if (k === '-') { e.preventDefault(); add(-Number(step)) }
    else if (k === 'r' && !inPractice) { e.preventDefault(); reset() }
    else if (e.key === ' ' && t.tagName !== 'BUTTON' && !inPractice) { e.preventDefault(); setPlaying((p) => !p) }
  }

  // ------------------------------------------------------------ figures

  const figure = useMemo<Figure | null>(() => {
    if (active.invalid) return null
    if (inPractice && !practice.revealed) return titrationFigure(active, pal, { points: practice.readings, band: false })
    const f = titrationFigure(active, pal, { marks: prefs.marks, buffers: prefs.buffers, band: prefs.band, current: inPractice ? null : activeV })
    if (inPractice && practice.readings.length) f.data.push({ type: 'scatter', mode: 'markers', x: practice.readings.map((r) => r.V), y: practice.readings.map((r) => r.y), name: 'your readings', marker: { color: pal.text, size: 6 } })
    return f
  }, [active, pal, prefs.marks, prefs.buffers, prefs.band, activeV, inPractice, practice.revealed, practice.readings])
  const derivFigure = useMemo(() => (prefs.derivs && !active.invalid && !(inPractice && !practice.revealed) ? derivativeFigure(active, pal) : null), [prefs.derivs, active, pal, inPractice, practice.revealed])

  useEffect(() => {
    exportRef.current = (p) => (result.invalid ? null : titrationFigure(result, p, { marks: prefs.marks, buffers: prefs.buffers, band: prefs.band, current: null }))
    return () => { exportRef.current = null }
  }, [exportRef, result, prefs.marks, prefs.buffers, prefs.band])

  const look = active.invalid ? null : active.at(activeV)
  const speciesBars = useMemo(() => (!inPractice && mode === 'acidbase' && !result.invalid ? speciesAt(project, V, (it) => (it.kind === 'weak' ? formLabels(it) : [])) : []), [inPractice, mode, project, result.invalid, V])
  const sample = project.mode === 'acidbase' ? project.acidbase : null
  const flaskV = inPractice ? practice.task.aliquot : sample ? sample.items.reduce((s, i) => s + i.volume, 0) + sample.water : project.mode === 'redox' ? project.redox.analyte.volume + project.redox.water : project.mode === 'edta' ? project.edta.volume + project.edta.water : project.precip.mode === 'silver-titrant' ? project.precip.anions.reduce((s, a) => s + a.volume, 0) + project.precip.water : project.precip.silver.volume + project.precip.water
  const cap = buretteCapacity(active.vmax)
  const unit = UNITS[mode]
  const readout = look && Number.isFinite(look.y) ? (mode === 'redox' ? `${fixed(look.y, 3)} V` : `${active.yShort} ${fixed(look.y, 2)}`) : '–'
  const showSetup = !compact || view === 'setup'
  const showMain = !compact || view === 'chart'
  const showLab = !compact || view === 'lab'

  const jumps = useMemo(
    () => (result.invalid ? [] : [{ V: 0, label: 'Start' }, ...result.half.map((h) => ({ V: h.V, label: h.label })), ...result.eq.map((e, i) => ({ V: e.V, label: `Equivalence ${i + 1}` })), ...(result.eq.length ? [{ V: Math.min(result.vmax, result.eq[result.eq.length - 1].V * 1.1), label: '10 % past the end' }] : [])].sort((a, b) => a.V - b.V)),
    [result],
  )
  const setMode = (m: Mode) => update((p) => ({ ...p, mode: m }))
  const spec = project.mode

  return (
    <div className="ti-titration" data-compact={compact || undefined} tabIndex={-1} onKeyDown={onKeyDown}>
      {compact && (
        <div className="ti-viewbar">
          <Seg label="Panel" value={view} options={[{ id: 'setup', label: 'Set-up' }, { id: 'chart', label: 'Curve' }, { id: 'lab', label: 'Burette' }]} onChange={setView} />
        </div>
      )}
      <div className="ti-titration-body">
        {showSetup && (
          <aside className="ti-setup" aria-label="Set-up of the titration">
            {inPractice ? <PracticePanel p={practice} /> : (
              <>
                <div className="ti-modebar">
                  <Sel label="Kind of titration" value={project.mode} options={MODES.map((m) => ({ id: m.id, label: m.label }))} onChange={setMode} />
                </div>
                {spec === 'acidbase' && <AcidBaseSetup spec={project.acidbase} onChange={(s) => update((p) => ({ ...p, acidbase: s }), 'ab')} />}
                {spec === 'redox' && <RedoxSetup spec={project.redox} onChange={(s) => update((p) => ({ ...p, redox: s }), 'rx')} />}
                {spec === 'edta' && <EdtaSetup spec={project.edta} onChange={(s) => update((p) => ({ ...p, edta: s }), 'ed')} />}
                {spec === 'precip' && <PrecipSetup spec={project.precip} onChange={(s) => update((p) => ({ ...p, precip: s }), 'pr')} />}
              </>
            )}
          </aside>
        )}
        {showMain && (
          <main className="ti-main">
            <div className="ti-chartbar" role="toolbar" aria-label="Chart options">
              <Check checked={prefs.marks} onChange={(v) => setPrefs({ marks: v })} title="Equivalence and half-equivalence points">Marks</Check>
              <Check checked={prefs.buffers} onChange={(v) => setPrefs({ buffers: v })} title="Buffer regions (pH within pKa ± 1)">Buffer regions</Check>
              <Check checked={prefs.band} onChange={(v) => setPrefs({ band: v })} title="The colour range of the indicator">Indicator band</Check>
              <Check checked={prefs.derivs} onChange={(v) => setPrefs({ derivs: v })} title="First and second derivative">Derivatives</Check>
              <span className="ti-spacer" />
              <button type="button" className="k-btn small" onClick={() => copy(factsText(active), 'Results')} disabled={!!active.invalid}><Copy size={12} /> Copy results</button>
            </div>
            {active.invalid ? (
              <Empty icon={<FlaskConical size={28} />}>{active.invalid}</Empty>
            ) : (
              <>
                <div className={`ti-plot${derivFigure ? ' split' : ''}`}><Chart figure={figure} label={`${active.title}: ${active.yLabel} against titrant volume`} /></div>
                {derivFigure && <div className="ti-plot deriv"><Chart figure={derivFigure} label="Derivatives of the titration curve" /></div>}
                {!(inPractice && !practice.revealed) && <Results r={active} />}
              </>
            )}
          </main>
        )}
        {showLab && (
          <aside className="ti-lab" aria-label="Virtual burette and flask">
            <div className="ti-labbar">
              <Seg label="Lab mode" value={lab} options={[
                { id: 'burette', label: <><Beaker size={12} /> Burette</>, title: 'Pour titrant and watch the flask' },
                { id: 'practice', label: <><GraduationCap size={12} /> Practice</>, title: 'Titrate an unknown by hand' },
                { id: 'quiz', label: <><HelpCircle size={12} /> Quiz</>, title: 'Questions computed from the model' },
              ]} onChange={(l) => { setLab(l); setPlaying(false); if (compact && l === 'practice') setView('setup') }} />
            </div>
            {lab === 'quiz' ? <QuizPanel q={quiz} /> : (
              <>
                <div className="ti-stage">
                  <Burette
                    V={activeV} capacity={cap} flaskV={flaskV} maxV={active.vmax} color={look?.color ?? '#d9ecf5'} cloud={look?.cloud ?? 0} dropKey={dropKey} dropping={dropping}
                    description={`Burette at ${fixed(activeV, 2)} mL; the solution in the flask reads ${readout}.`}
                  />
                  <div className="ti-meter" aria-live="polite">
                    <div className="ti-meter-label">{inPractice ? 'pH meter' : mode === 'redox' ? 'Electrode' : mode === 'acidbase' ? 'pH meter' : `${unit} reading`}</div>
                    <div className="ti-meter-value">{readout}</div>
                    <div className="ti-meter-vol">{fixed(activeV, 2)} mL added</div>
                  </div>
                </div>
                <div className="ti-controls">
                  {!inPractice && (
                    <input
                      type="range" className="ti-slider" min={0} max={result.vmax} step={result.vmax / 2000} value={V} aria-label="Titrant added"
                      onChange={(e) => { setPlaying(false); setV(Number(e.target.value)) }}
                    />
                  )}
                  <div className="ti-btnrow">
                    {!inPractice && <button type="button" className="k-icon-btn" aria-label="Back to zero (R)" title="Back to zero (R)" onClick={reset}><SkipBack size={15} /></button>}
                    {!inPractice && <button type="button" className="k-icon-btn" aria-label={playing ? 'Pause' : 'Pour continuously (Space)'} title={playing ? 'Pause' : 'Pour continuously (Space)'} aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>}
                    <button type="button" className="k-btn small" title="Add one drop, 0.05 mL (D)" onClick={() => add(0.05)}><Droplet size={12} /> Drop</button>
                    <button type="button" className="k-btn small" title="Add 0.1 mL" onClick={() => add(0.1)}>+0.1</button>
                    <button type="button" className="k-btn small" title="Add 1 mL" onClick={() => add(1)}>+1</button>
                    <button type="button" className="k-btn primary small" title="Add the chosen step (A)" onClick={() => add(Number(step))}><ChevronsRight size={13} /> Add {step} mL</button>
                    {!inPractice && <button type="button" className="k-btn small" title="Take back a step (−)" onClick={() => add(-Number(step))} disabled={V <= 0}>− Step</button>}
                    {inPractice && <button type="button" className="k-icon-btn" aria-label="Start again" title="Start this unknown again" onClick={() => practice.restart(practice.seed)}><RotateCcw size={14} /></button>}
                  </div>
                  <div className="ti-ctlrow">
                    <label className="ti-ctl"><span>Step</span><Sel label="Step size" value={step} width={130} options={STEPS} onChange={setStep} /></label>
                    {!inPractice && <label className="ti-ctl"><span>Pour speed</span><Sel label="Pouring speed" value={speed} width={70} options={[{ id: '0.5', label: '½×' }, { id: '1', label: '1×' }, { id: '2', label: '2×' }, { id: '4', label: '4×' }]} onChange={setSpeed} /></label>}
                    {!inPractice && jumps.length > 0 && (
                      <label className="ti-ctl"><span>Jump to</span>
                        <Sel label="Jump to a point of the titration" value="" width={150} options={[{ id: '', label: 'a mark…' }, ...jumps.map((j, i) => ({ id: String(i), label: `${j.label} (${fixed(j.V, 2)} mL)` }))]} onChange={(v) => { if (v !== '') { setPlaying(false); setV(jumps[Number(v)].V) } }} />
                      </label>
                    )}
                    {!inPractice && <label className="ti-ctl"><span>Go to</span><NumField label="Volume added in mL" value={Number(V.toFixed(3))} min={0} max={result.vmax} unit="mL" width={70} onChange={(v) => { setPlaying(false); setV(v) }} /></label>}
                  </div>
                </div>
                {!inPractice && !result.invalid && <div className="ti-phase" aria-live="polite">{phaseAt(result, V)}</div>}
                {speciesBars.length > 0 && (
                  <Section title="Species in the flask" id="ti-species" defaultOpen>
                    {speciesBars.map((bar, i) => (
                      <div key={i} className="ti-species">
                        <div className="ti-species-name">{bar.label}</div>
                        <div className="ti-stack" role="img" aria-label={bar.parts.map((p) => `${p.name} ${fixed(p.fraction * 100, 0)} %`).join(', ')}>
                          {bar.parts.map((p, j) => p.fraction > 0.003 && <span key={j} className={`ti-stack-${j % 6}`} style={{ flexGrow: p.fraction }} title={`${p.name}: ${fixed(p.fraction * 100, 1)} %`}>{p.fraction > 0.12 ? p.name : ''}</span>)}
                        </div>
                      </div>
                    ))}
                  </Section>
                )}
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

function Results({ r }: { r: TitrationResult }) {
  return (
    <div className="ti-results" aria-label="Results">
      <table className="ti-table facts">
        <tbody>
          {r.facts.map(([k, v], i) => <tr key={i}><th scope="row">{k}</th><td>{v}</td></tr>)}
        </tbody>
      </table>
      {r.notes.map((n, i) => <Notice key={i}>{n}</Notice>)}
      {r.band?.note && <div className="ti-hint">{r.band.note}</div>}
    </div>
  )
}
