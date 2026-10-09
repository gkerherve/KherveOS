// The Cams workbench: a follower motion program (dwell / rise / return segments), the cam profile for a knife-edge,
// roller or flat-face follower (translating or swing-arm), checks and exports. The mathematics is in cam.ts.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Maximize, PanelRight, Pause, Play, Plus, SkipBack, Trash2, X, LineChart, ZoomIn, ZoomOut } from 'lucide-react'
import { os, type MenuBarMenu } from '@/os'
import type { MenuItem } from '@/os/ui/Menu'
import {
  camProfile, checkProgram, followerAt, LAWS, optimiseBaseRadius, programLevels, programTable, type CamSegment, type FollowerKind, type LawId,
} from './cam'
import type { CamDoc } from './doc'
import { camChecksFigure, camDiagramFigure, type Figure } from './figures'
import { toCsv, toTsv, shapesToDxf, shapesToSvg } from './exportGeom'
import { loadPrefs, safeName, savePrefs } from './io'
import { fmt } from './math'
import { MechCanvas, type CanvasHandle } from './MechCanvas'
import PlotlyChart, { usePalette, type ChartHandle } from './PlotlyChart'
import { camScene } from './scene'
import { camShapes } from './outlines'
import type { Shell } from './shell'
import { profileTable, programCsvTable } from './tables'
import { f4, Kv, NumField, Note, Section, Seg } from './ui'

interface Prefs { side: boolean; dock: boolean; dockH: number; speed: number; pitch: boolean; circles: boolean; plot: 'diagram' | 'checks' }
const DEFAULT_PREFS: Prefs = { side: true, dock: true, dockH: 270, speed: 1, pitch: false, circles: true, plot: 'diagram' }
const PREFS_KEY = 'kherveos.kmech.cam.prefs'

const HELP = [
  'Build the follower motion as a list of segments that add up to 360°: a rise lifts the follower, a return lowers it by the same amount, a dwell holds it. Choose a law for each: uniform, simple harmonic, cycloidal, modified trapezoid, polynomial 3-4-5 or 4-5-6-7.',
  'The diagrams show displacement, velocity, acceleration and jerk; the checks show the pressure angle (keep it under about 30° for a translating follower) and the radius of curvature (a roller larger than it undercuts the profile).',
  '“Smallest base circle” finds the least base radius that meets the pressure-angle limit without undercutting. Export the outline as SVG or DXF for a laser cutter (millimetres), or its coordinates as CSV.',
  'For a swing-arm follower the lift is the arm rotation in degrees; the arm pivots at the given distance from the cam centre.',
].join('\n\n')
const SHORTCUTS = ['P play / pause · ← → step 1° (Shift 10°) · Home back to 0°', 'F fit to window · + / − zoom · space + drag pans · wheel zooms', '⌘Z undo · ⇧⌘Z redo · ⌘S save · ⌘O open · ⌘N new'].join('\n\n')

export default function CamBench({ shell }: { shell: Shell<CamDoc> }) {
  const m = shell.model
  const pal = usePalette()
  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs(DEFAULT_PREFS, PREFS_KEY))
  const setPrefs = (p: Partial<Prefs>) => setPrefsState((old) => { const n = { ...old, ...p }; savePrefs(n, PREFS_KEY); return n })
  const [theta, setTheta] = useState(0)
  const [playing, setPlaying] = useState(false)
  const canvas = useRef<CanvasHandle>(null)
  const chart = useRef<ChartHandle>(null)

  const profile = useMemo(() => camProfile(m, 720), [m])
  const ghost = useMemo(() => (m.compare ? camProfile({ ...m, program: m.compare.program }, 720) : null), [m])
  const table = useMemo(() => programTable(m.program, 720), [m.program])
  const cmpTable = useMemo(() => (m.compare ? programTable(m.compare.program, 720) : null), [m.compare])
  const problems = useMemo(() => checkProgram(m.program), [m.program])
  const total = programLevels(m.program).total

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      setTheta((t) => (t + 60 * prefs.speed * dt) % 360)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, prefs.speed])

  const errors = profile.warnings.filter((w) => w.level === 'error')
  const prims = useMemo(() => camScene(m, { theta, profile, ghost, showPitch: prefs.pitch && m.follower === 'roller', showCircles: prefs.circles, warn: errors.length > 0 }), [m, theta, profile, ghost, prefs.pitch, prefs.circles, errors.length])
  const R = Math.max(profile.stats.outerRadius, m.baseRadius, 10)
  const fitTo = useMemo(() => {
    const ext = m.motion === 'swing' && m.follower !== 'flat' ? Math.max(m.pivotDistance + 20, R) : R
    return { minX: -R * 1.25, maxX: Math.max(R, ext) * 1.3, minY: -R * 1.25, maxY: R * 1.9 }
  }, [R, m.motion, m.follower, m.pivotDistance])
  const f = followerAt(m, theta)
  const here = useMemo(() => { const i = Math.round((theta / 360) * 720) % 721; return { phi: profile.phi[i], rho: profile.rho[i] } }, [theta, profile])

  // ------------------------------------------------------------ edits
  const setProgram = (segments: CamSegment[]) => shell.commit({ ...m, program: { segments } })
  const seg = (i: number, patch: Partial<CamSegment>) => setProgram(m.program.segments.map((s, k) => (k === i ? { ...s, ...patch } : s)))
  const move = (i: number, d: number) => {
    const a = [...m.program.segments]
    const j = i + d
    if (j < 0 || j >= a.length) return
    ;[a[i], a[j]] = [a[j], a[i]]
    setProgram(a)
  }
  const complete = () => {
    const rest = 360 - total
    if (rest > 1e-9) setProgram([...m.program.segments, { kind: 'dwell', beta: rest, lift: 0, law: 'cycloidal' }])
    else if (rest < -1e-9) shell.say('The segments already add up to more than 360°: shorten one.')
  }
  const optimise = () => {
    const o = optimiseBaseRadius(m)
    const r = Math.ceil(o.baseRadius * 10) / 10
    shell.commit({ ...m, baseRadius: r })
    shell.say(`Smallest base circle ${fmt(o.baseRadius, 4)} mm (limited by ${o.limitedBy === 'none' ? 'the minimum size' : o.limitedBy === 'pressure' ? 'the pressure angle' : 'the curvature'}); set to ${r} mm.`)
  }
  const setCompare = (law: LawId | '') => {
    if (!law) { const { compare: _c, ...rest } = m; void _c; shell.commit(rest as CamDoc); return }
    shell.commit({ ...m, compare: { label: LAWS.find((l) => l.id === law)!.name, program: { segments: m.program.segments.map((s) => (s.kind === 'dwell' ? s : { ...s, law })) } } })
  }

  // ------------------------------------------------------------ exports
  const run = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { await os.dialog.alert(e instanceof Error ? e.message : String(e), { title: 'Export' }) } }
  const exportSvg = () => run(() => shell.saveFile(`${safeName(m.name)}.svg`, '.svg', shapesToSvg(camShapes(m, profile), { title: m.name })))
  const exportDxf = () => run(() => shell.saveFile(`${safeName(m.name)}.dxf`, '.dxf', shapesToDxf(camShapes(m, profile))))
  const exportCsv = () => run(() => { const t = profileTable(profile); return shell.saveFile(`${safeName(m.name)}-profile.csv`, '.csv', toCsv(t.header, t.rows)) })
  const exportOutlineCsv = () => run(() => shell.saveFile(`${safeName(m.name)}-outline.csv`, '.csv', toCsv(['x_mm', 'y_mm'], profile.profile.map((p) => [p.x, p.y]))))
  const exportDiagramCsv = () => run(() => { const t = programCsvTable(table, m.motion === 'swing' ? 'deg' : 'mm'); return shell.saveFile(`${safeName(m.name)}-motion.csv`, '.csv', toCsv(t.header, t.rows)) })
  const toKplot = () => { const t = programCsvTable(table, m.motion === 'swing' ? 'deg' : 'mm'); shell.openInKplot(toTsv(t.header, t.rows), `${m.name} motion`) }
  const exportPng = () => run(async () => { if (canvas.current) await shell.saveFile(`${safeName(m.name)}.png`, '.png', await canvas.current.png()) })

  const figure: Figure | null = useMemo(
    () => (prefs.plot === 'diagram' ? camDiagramFigure(table, pal, cmpTable && m.compare ? { label: m.compare.label, table: cmpTable } : undefined, m.motion === 'swing' ? '°' : 'mm') : camChecksFigure(profile, m.maxPressure, pal)),
    [prefs.plot, table, pal, cmpTable, m.compare, m.motion, profile, m.maxPressure],
  )

  // ------------------------------------------------------------ menus
  useEffect(() => {
    const view: MenuItem[] = [
      { label: 'Zoom in', icon: ZoomIn, shortcut: '+', onClick: () => canvas.current?.zoomBy(1.25) },
      { label: 'Zoom out', icon: ZoomOut, shortcut: '−', onClick: () => canvas.current?.zoomBy(0.8) },
      { label: 'Fit to window', icon: Maximize, shortcut: 'F', onClick: () => canvas.current?.fit() },
      '-',
      { label: 'Base and prime circles', checked: prefs.circles, onClick: () => setPrefs({ circles: !prefs.circles }) },
      { label: 'Pitch curve', checked: prefs.pitch, onClick: () => setPrefs({ pitch: !prefs.pitch }) },
      { label: 'Side panel', checked: prefs.side, onClick: () => setPrefs({ side: !prefs.side }) },
      { label: 'Diagrams', checked: prefs.dock, onClick: () => setPrefs({ dock: !prefs.dock }) },
    ]
    const cam: MenuItem[] = [
      { label: playing ? 'Pause' : 'Play', icon: playing ? Pause : Play, shortcut: 'P', onClick: () => setPlaying((p) => !p) },
      { label: 'Back to 0°', shortcut: 'Home', onClick: () => { setPlaying(false); setTheta(0) } },
      '-',
      { label: 'Smallest base circle', onClick: optimise },
      { label: 'Add a segment', onClick: () => setProgram([...m.program.segments, { kind: 'dwell', beta: 30, lift: 0, law: 'cycloidal' }]) },
      { label: 'Complete to 360° with a dwell', onClick: complete },
      '-',
      { label: 'Motion diagrams', checked: prefs.plot === 'diagram' && prefs.dock, onClick: () => setPrefs({ plot: 'diagram', dock: true }) },
      { label: 'Pressure angle and curvature', checked: prefs.plot === 'checks' && prefs.dock, onClick: () => setPrefs({ plot: 'checks', dock: true }) },
    ]
    const exports: MenuItem[] = [
      { label: 'Cam outline (SVG, mm)…', onClick: () => void exportSvg() },
      { label: 'Cam outline (DXF, mm)…', onClick: () => void exportDxf() },
      { label: 'Cam outline coordinates (CSV)…', onClick: () => void exportOutlineCsv() },
      { label: 'Profile table with pressure angle (CSV)…', onClick: () => void exportCsv() },
      { label: 'Motion diagram data (CSV)…', onClick: () => void exportDiagramCsv() },
      { label: 'Picture of the sheet (PNG)…', onClick: () => void exportPng() },
      { label: 'Open the motion data in kPlot', onClick: toKplot },
    ]
    const menus: MenuBarMenu[] = [shell.fileMenu(exports), shell.editMenu([]), { label: 'Cam', items: cam }, { label: 'View', items: view }, shell.helpMenu(SHORTCUTS, HELP)]
    shell.win.setMenus(menus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.version, prefs, playing, m])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 'p') { e.preventDefault(); setPlaying((p) => !p) } else if (k === 'f') canvas.current?.fit()
    else if (k === '+' || k === '=') canvas.current?.zoomBy(1.25)
    else if (k === '-') canvas.current?.zoomBy(0.8)
    else if (e.key === 'Home') { setPlaying(false); setTheta(0) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPlaying(false); setTheta((t) => (((t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1)) % 360) + 360) % 360) }
  }

  const dragDock = (e: React.PointerEvent) => {
    const startY = e.clientY; const start = prefs.dockH
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => setPrefsState((p) => ({ ...p, dockH: Math.min(620, Math.max(150, start + startY - ev.clientY)) }))
    const up = () => { el.removeEventListener('pointermove', move as EventListener); el.removeEventListener('pointerup', up); setPrefsState((p) => { savePrefs(p, PREFS_KEY); return p }) }
    el.addEventListener('pointermove', move as EventListener); el.addEventListener('pointerup', up)
  }

  const flat = m.follower === 'flat'
  const swing = m.motion === 'swing' && !flat
  const liftUnit = swing ? '°' : 'mm'
  return (
    <div className="mc-body">
      <div className="mc-main">
        <div className="mc-stage">
          <MechCanvas ref={canvas} prims={prims} fitTo={fitTo} fitKey={shell.docId} grid label="Cam and follower" onKeyDown={onKeyDown}>
            <div className="mc-overlay-info">
              <b>{m.name}</b> · cam {fmt(theta, 4)}° · lift {fmt(f.s, 4)} {liftUnit}
              {!flat && here.phi !== undefined ? <> · pressure angle <b style={{ color: Math.abs(here.phi) > m.maxPressure ? '#f87171' : undefined }}>{fmt(here.phi, 3)}°</b></> : null}
              {Number.isFinite(here.rho) && here.rho < 1e4 ? <> · ρ {fmt(here.rho, 4)} mm</> : null}
              {errors.length > 0 ? <><br /><span style={{ color: '#f87171' }}>{errors[0].message}</span></> : null}
            </div>
            <div className="mc-play">
              <button className="k-icon-btn" aria-label="Back to 0°" title="Back to 0° (Home)" onClick={() => { setPlaying(false); setTheta(0) }}><SkipBack size={15} /></button>
              <button className={`k-btn${playing ? '' : ' primary'}`} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (P)" onClick={() => setPlaying((p) => !p)}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
              <input type="range" aria-label="Cam angle" min={0} max={360} step={0.5} value={theta} onChange={(e) => { setPlaying(false); setTheta(Number(e.target.value)) }} />
              <span className="mc-readout">{fmt(theta, 4)}°</span>
              <select className="k-input" aria-label="Playback speed" value={prefs.speed} onChange={(e) => setPrefs({ speed: Number(e.target.value) })}>{[0.25, 0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
              <button className={`k-icon-btn${prefs.dock ? ' active' : ''}`} aria-label="Diagrams" aria-pressed={prefs.dock} title="Diagrams" onClick={() => setPrefs({ dock: !prefs.dock })}><LineChart size={15} /></button>
              <button className={`k-icon-btn${prefs.side ? ' active' : ''}`} aria-label="Side panel" aria-pressed={prefs.side} title="Side panel" onClick={() => setPrefs({ side: !prefs.side })}><PanelRight size={15} /></button>
            </div>
          </MechCanvas>
          {prefs.side && (
            <aside className="mc-side" aria-label="Cam settings">
              <div className="mc-side-tabs"><button className="on">Cam</button><button className="k-icon-btn" style={{ marginLeft: 'auto', alignSelf: 'center' }} aria-label="Close the side panel" onClick={() => setPrefs({ side: false })}><X size={14} /></button></div>
              <div className="mc-side-body">
                <Section title="Follower motion" right={<span className={Math.abs(total - 360) > 1e-6 ? 'mc-badtxt' : 'k-muted'} style={{ textTransform: 'none' }}>{fmt(total, 5)}° of 360°</span>}>
                  <div className="mc-seglist">
                    {m.program.segments.map((s, i) => (
                      <div key={i} className="mc-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3 }}>
                        <select className="k-input" aria-label={`Segment ${i + 1} kind`} value={s.kind} onChange={(e) => seg(i, { kind: e.target.value as CamSegment['kind'], ...(e.target.value !== 'dwell' && !(s.lift > 0) ? { lift: 10 } : {}) })}>
                          <option value="rise">Rise</option><option value="dwell">Dwell</option><option value="return">Return</option>
                        </select>
                        <NumField value={s.beta} min={0.01} unit="°" onChange={(v) => seg(i, { beta: v })} title="Angle of the segment" />
                        <NumField value={s.kind === 'dwell' ? 0 : s.lift} disabled={s.kind === 'dwell'} min={0.001} unit={liftUnit} onChange={(v) => seg(i, { lift: v })} title="Lift" />
                        <select className="k-input" style={{ gridColumn: '1 / 3' }} aria-label={`Segment ${i + 1} law`} disabled={s.kind === 'dwell'} value={s.law} onChange={(e) => seg(i, { law: e.target.value as LawId })}>
                          {LAWS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                        <span style={{ display: 'flex', gap: 2 }}>
                          <button className="k-icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={12} /></button>
                          <button className="k-icon-btn" aria-label="Move down" disabled={i === m.program.segments.length - 1} onClick={() => move(i, 1)}><ArrowDown size={12} /></button>
                          <button className="k-icon-btn" aria-label="Delete the segment" onClick={() => setProgram(m.program.segments.filter((_, k) => k !== i))}><Trash2 size={12} /></button>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mc-actions">
                    <button className="k-btn" onClick={() => setProgram([...m.program.segments, { kind: 'rise', beta: 60, lift: 10, law: 'cycloidal' }])}><Plus size={13} /> Segment</button>
                    <button className="k-btn" onClick={complete}>Complete to 360°</button>
                  </div>
                  {problems.map((p, i) => <Note key={i} kind="error">{p}</Note>)}
                  <div className="mc-hint">{LAWS.find((l) => l.id === m.program.segments.find((s) => s.kind !== 'dwell')?.law)?.note}</div>
                  <label className="mc-field"><span>Compare with</span>
                    <select className="k-input" value={m.compare ? (LAWS.find((l) => l.name === m.compare!.label)?.id ?? '') : ''} onChange={(e) => setCompare(e.target.value as LawId | '')}>
                      <option value="">Nothing</option>
                      {LAWS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </label>
                </Section>
                <Section title="Follower">
                  <Seg label="Follower type" value={m.follower} options={[{ id: 'knife', label: 'Knife-edge' }, { id: 'roller', label: 'Roller' }, { id: 'flat', label: 'Flat face' }]} onChange={(v: FollowerKind) => shell.commit({ ...m, follower: v, ...(v === 'flat' ? { motion: 'translating' as const } : {}) })} />
                  <Seg label="Follower motion" value={flat ? 'translating' : m.motion} options={[{ id: 'translating', label: 'Translating' }, { id: 'swing', label: 'Swing arm', title: 'Not for a flat-face follower' }]} onChange={(v) => !(flat && v === 'swing') && shell.commit({ ...m, motion: v })} />
                  <Seg label="Cam rotation" value={m.direction} options={[{ id: 'ccw', label: 'Counter-clockwise' }, { id: 'cw', label: 'Clockwise' }]} onChange={(v) => shell.commit({ ...m, direction: v })} />
                  <NumField label="Base circle" unit="mm" min={1} value={m.baseRadius} onChange={(v) => shell.commit({ ...m, baseRadius: v })} title="Radius of the smallest circle of the cam" />
                  {m.follower === 'roller' && <NumField label="Roller radius" unit="mm" min={0.5} value={m.rollerRadius} onChange={(v) => shell.commit({ ...m, rollerRadius: v })} />}
                  {!flat && !swing && <NumField label="Offset" unit="mm" value={m.offset} onChange={(v) => shell.commit({ ...m, offset: v })} title="Follower axis to the right of the cam centre" />}
                  {swing && <><NumField label="Pivot distance" unit="mm" min={1} value={m.pivotDistance} onChange={(v) => shell.commit({ ...m, pivotDistance: v })} /><NumField label="Arm length" unit="mm" min={1} value={m.armLength} onChange={(v) => shell.commit({ ...m, armLength: v })} /></>}
                  {!flat && <NumField label="Pressure limit" unit="°" min={5} max={80} value={m.maxPressure} onChange={(v) => shell.commit({ ...m, maxPressure: v })} />}
                  <NumField label="Bore (export)" unit="mm" min={0} value={m.bore} onChange={(v) => shell.commit({ ...m, bore: v })} />
                  <div className="mc-actions"><button className="k-btn" onClick={optimise}>Smallest base circle</button></div>
                </Section>
                <Section title="Checks">
                  <Kv rows={[
                    ['Prime circle', `${f4(profile.stats.primeRadius)} mm`], ['Largest radius', `${f4(profile.stats.outerRadius)} mm`],
                    ...(flat ? [['Flat face half-width ≥', `${f4(profile.stats.faceHalfWidth)} mm`] as [string, React.ReactNode]] : [['Max pressure angle', <span key="p" className={profile.stats.maxPressure > m.maxPressure ? 'mc-badtxt' : 'mc-good'}>{f4(profile.stats.maxPressure, 3)}° at {f4(profile.stats.maxPressureAt, 4)}°</span>] as [string, React.ReactNode]]),
                    ['Min radius of curvature', Number.isFinite(profile.stats.minRho) ? `${f4(profile.stats.minRho)} mm at ${f4(profile.stats.minRhoAt, 4)}°` : '–'],
                    ['Peak velocity', `${f4(table.peakV)} ${liftUnit}/rad`], ['Peak acceleration', `${f4(table.peakA)} ${liftUnit}/rad²`], ['Peak jerk', `${f4(table.peakJ)} ${liftUnit}/rad³`],
                  ]} />
                  {profile.warnings.filter((w) => w.code !== 'program').map((w, i) => <Note key={i} kind={w.level === 'error' ? 'error' : 'warn'}>{w.message}</Note>)}
                  {profile.warnings.length === 0 && <Note kind="ok">No problems found: the pressure angle is within the limit and the profile is not undercut.</Note>}
                </Section>
                <Section title="Export">
                  <div className="mc-actions">
                    <button className="k-btn" onClick={() => void exportSvg()}><Download size={13} /> SVG</button>
                    <button className="k-btn" onClick={() => void exportDxf()}><Download size={13} /> DXF</button>
                    <button className="k-btn" onClick={() => void exportOutlineCsv()}>CSV</button>
                  </div>
                  <div className="mc-hint">SVG and DXF are in millimetres, ready for a laser cutter: the cut line is the outline (layer “cut”), the bore a circle; the base circle and pitch curve are on layer “construction”.</div>
                </Section>
              </div>
            </aside>
          )}
        </div>
        {prefs.dock && (
          <>
            <div className="mc-splitter" onPointerDown={dragDock} role="separator" aria-orientation="horizontal" aria-label="Resize the diagrams" />
            <div className="mc-dock" style={{ height: prefs.dockH }}>
              <div className="mc-dock-bar">
                <Seg label="Diagram" value={prefs.plot} options={[{ id: 'diagram', label: 'Motion' }, { id: 'checks', label: 'Pressure angle and curvature' }]} onChange={(v) => setPrefs({ plot: v })} />
                <span className="k-spacer" />
                <button className="k-btn" onClick={() => void chart.current?.png().then((b) => shell.saveFile(`${safeName(m.name)}-${prefs.plot}.png`, '.png', b)).catch((e) => os.dialog.alert(String(e.message ?? e)))}><Download size={13} /> PNG</button>
                <button className="k-btn" onClick={() => void chart.current?.svg().then((s) => shell.saveFile(`${safeName(m.name)}-${prefs.plot}.svg`, '.svg', s)).catch((e) => os.dialog.alert(String(e.message ?? e)))}>SVG</button>
                <button className="k-btn" onClick={toKplot}>Open in kPlot</button>
                <button className="k-icon-btn" aria-label="Close the diagrams" onClick={() => setPrefs({ dock: false })}><X size={14} /></button>
              </div>
              <div className="mc-dock-body"><PlotlyChart figure={figure} handle={chart} /></div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

