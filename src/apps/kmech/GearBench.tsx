// The Gears workbench: involute spur pairs with animated meshing, trains, planetary sets, helical gears, belts and chains.
// The mathematics is in gear.ts.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Maximize, PanelRight, Pause, Play, Plus, SkipBack, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { os, type MenuBarMenu } from '@/os'
import type { MenuItem } from '@/os/ui/Menu'
import type { GearDoc, GearView } from './doc'
import { toCsv, shapesToDxf, shapesToSvg, toTsv } from './exportGeom'
import {
  beltDrive, bevelPair, chainDrive, gearGeometry, gearOutline, gearTrain, helicalContact, helicalGear, pairGeometry, placePoints, planetary, planetarySpeeds, planetaryTable,
  planetaryTorques, rackPinion, wormGear, type GearSpec, type Member, type TrainStage,
} from './gear'
import { loadPrefs, safeName, savePrefs } from './io'
import { deg, rad, type Pt } from './math'
import { MechCanvas, type CanvasHandle } from './MechCanvas'
import { gearShapes, pairShapes } from './outlines'
import { beltScene, COLORS, pairScene, planetaryScene, sceneBounds, trainLayout, type Prim } from './scene'
import type { Shell } from './shell'
import { Check, f4, Kv, NumField, Note, Section, Seg } from './ui'

interface Prefs { side: boolean; speed: number; circles: boolean; contact: boolean }
const DEFAULT_PREFS: Prefs = { side: true, speed: 1, circles: true, contact: true }
const PREFS_KEY = 'kherveos.kmech.gear.prefs'

const VIEWS: Array<{ id: GearView; label: string }> = [
  { id: 'pair', label: 'Spur pair' }, { id: 'train', label: 'Gear train' }, { id: 'planetary', label: 'Planetary' }, { id: 'helical', label: 'Helical' }, { id: 'belt', label: 'Belt / chain' },
]

const HELP = [
  'Spur pair: set teeth, module (or diametral pitch = 25.4 / module), pressure angle (14.5°, 20°, 25°), addendum, profile shift and backlash. kMech draws true involute teeth with a root fillet, checks undercut, tip interference and contact ratio, and animates the meshing. Export each gear or the pair as SVG or DXF for laser cutting.',
  'Gear train: list the meshes (driver teeth → driven teeth); compound gears share a shaft, an idler is a gear shared by two meshes. The table gives speed, torque and power of every shaft with the efficiency per mesh.',
  'Planetary: the Willis equation Zs(ωs − ωc) + Zr(ωr − ωc) = 0; choose the fixed and the input member to read the others. Zr = Zs + 2·Zp, and (Zs + Zr)/N must be a whole number for N equally spaced planets.',
  'Helical: the normal module gives the transverse module mn / cos β; the contact ratio adds the face overlap b·sin β / (π·mn). Belt / chain: lengths, wrap angle and speeds.',
].join('\n\n')
const SHORTCUTS = ['P play / pause · ← → step · F fit to window · + / − zoom · space + drag pans · wheel zooms', '⌘Z undo · ⇧⌘Z redo · ⌘S save · ⌘O open · ⌘N new'].join('\n\n')

const members: Member[] = ['sun', 'ring', 'carrier']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function GearBench({ shell }: { shell: Shell<GearDoc> }) {
  const m = shell.model
  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs(DEFAULT_PREFS, PREFS_KEY))
  const setPrefs = (p: Partial<Prefs>) => setPrefsState((old) => { const n = { ...old, ...p }; savePrefs(n, PREFS_KEY); return n })
  const [phase, setPhase] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [bore, setBore] = useState(8)
  const canvas = useRef<CanvasHandle>(null)

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      setPhase((p) => p + rad(45) * prefs.speed * dt)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, prefs.speed])

  // ------------------------------------------------------------ derived
  const view = m.view
  const helicalSpecs = useMemo((): [GearSpec, GearSpec] => {
    const h1 = helicalGear(m.helical.mn, m.helical.z1, m.helical.beta, m.helical.alphaN)
    const base = { ha: 1, x: 0, backlash: 0, fillet: 0.38, module: h1.mt, alpha: deg(h1.alphaT) }
    return [{ ...base, z: Math.max(3, m.helical.z1) }, { ...base, z: Math.max(3, m.helical.z2) }]
  }, [m.helical])
  const pairSpecs: [GearSpec, GearSpec, number | undefined] = view === 'helical' ? [helicalSpecs[0], helicalSpecs[1], undefined] : [m.pair.g1, m.pair.g2, m.pair.centre]
  const pg = useMemo(() => pairGeometry(pairSpecs[0], pairSpecs[1], pairSpecs[2]), [pairSpecs[0], pairSpecs[1], pairSpecs[2]]) // eslint-disable-line react-hooks/exhaustive-deps
  const o1 = useMemo(() => gearOutline(pg.g1), [pg.g1])
  const o2 = useMemo(() => gearOutline(pg.g2), [pg.g2])
  const train = useMemo(() => gearTrain(m.train.stages, m.train.rpm, m.train.torque, m.train.eff), [m.train])
  const pl = useMemo(() => planetary(m.planetary.Zs, m.planetary.Zr, m.planetary.n), [m.planetary])
  const plSpeeds = useMemo(() => planetarySpeeds(m.planetary, m.planetary.fixed, m.planetary.input, m.planetary.speed), [m.planetary])
  const plOutlines = useMemo(() => {
    if (!pl.integerPlanet || pl.Zp < 3 || m.planetary.Zs < 3) return null
    const mod = m.planetary.module
    const g = (z: number) => gearOutline(gearGeometry({ z, module: mod, alpha: 20, ha: 1, x: 0, backlash: 0, fillet: 0.38 }), 10, 4, 3)
    return { sun: g(m.planetary.Zs), planet: g(pl.Zp), ring: g(m.planetary.Zr) }
  }, [pl, m.planetary])
  const layoutCache = useRef(new Map<string, Pt[]>())
  const outlineOf = (z: number, module: number): Pt[] => {
    const key = `${z}|${module}`
    let o = layoutCache.current.get(key)
    if (!o) { o = gearOutline(gearGeometry({ z: Math.max(3, z), module, alpha: 20, ha: 1, x: 0, backlash: 0, fillet: 0.38 }), 8, 3, 3); layoutCache.current.set(key, o) }
    return o
  }

  // ------------------------------------------------------------ the scene
  const prims: Prim[] = useMemo(() => {
    if (view === 'pair' || view === 'helical') return pairScene(pg, { phi: phase, o1, o2, circles: prefs.circles, contact: prefs.contact })
    if (view === 'train') {
      const mod = 2
      const lay = trainLayout(m.train.stages, mod, m.train.rpm)
      const out: Prim[] = []
      lay.gears.forEach((g) => {
        const rot = g.phase + g.ratio * phase
        out.push({ k: 'path', pts: placePoints(outlineOf(g.z, g.module), rot, g.at), closed: true, style: { stroke: g.color, fill: `${g.color}22`, width: 2 } })
        out.push({ k: 'text', at: g.at, text: `${g.z}`, px: 12, color: g.color, anchor: 'middle', dy: 4 })
        out.push({ k: 'circle', c: g.at, rpx: 2.5, style: { fill: COLORS.muted } })
      })
      return out
    }
    if (view === 'planetary') {
      if (!plOutlines || !plSpeeds) return []
      const w0 = m.planetary.speed || 1
      const ts = (plSpeeds.sun / w0) * phase; const tc = (plSpeeds.carrier / w0) * phase
      return planetaryScene(m.planetary.Zs, m.planetary.Zr, m.planetary.n, m.planetary.module, ts, tc, plOutlines)
    }
    return beltScene(m.belt.D, m.belt.d, m.belt.C, m.belt.crossed, phase)
  }, [view, pg, phase, o1, o2, prefs.circles, prefs.contact, m.train, plOutlines, plSpeeds, m.planetary, m.belt])

  const fitTo = useMemo(() => {
    if (view === 'belt') { const R = Math.max(m.belt.D, m.belt.d) / 2; return { minX: -R * 1.1, maxX: m.belt.C + R * 1.1, minY: -R * 1.2, maxY: R * 1.2 } }
    if (view === 'planetary') { const r = (m.planetary.Zr * m.planetary.module) / 2 + 3 * m.planetary.module; return { minX: -r, maxX: r, minY: -r, maxY: r } }
    if (view === 'train') {
      const b = sceneBounds(trainLayout(m.train.stages, 2, m.train.rpm).gears.flatMap((g) => { const r = (g.z * g.module) / 2 + 2; return [{ x: g.at.x - r, y: g.at.y - r }, { x: g.at.x + r, y: g.at.y + r }] }).map((p) => ({ k: 'circle', c: p, r: 0.1, style: {} }) as Prim))
      return b
    }
    const r1 = pg.g1.ra; const r2 = pg.g2.ra
    return { minX: -r1 * 1.2, maxX: pg.aw + r2 * 1.2, minY: -Math.max(r1, r2) * 1.2, maxY: Math.max(r1, r2) * 1.2 }
  }, [view, pg, m.belt, m.planetary, m.train])

  // ------------------------------------------------------------ edits
  const setPair = (g1: Partial<GearSpec>, g2: Partial<GearSpec>, extra: Partial<GearDoc['pair']> = {}) => shell.commit({ ...m, pair: { ...m.pair, g1: { ...m.pair.g1, ...g1 }, g2: { ...m.pair.g2, ...g2 }, ...extra } })
  const both = (patch: Partial<GearSpec>) => setPair(patch, patch)
  const setTrain = (patch: Partial<GearDoc['train']>) => shell.commit({ ...m, train: { ...m.train, ...patch } })
  const setStage = (i: number, patch: Partial<TrainStage>) => setTrain({ stages: m.train.stages.map((s, k) => (k === i ? { ...s, ...patch } : s)) })
  const setPl = (patch: Partial<GearDoc['planetary']>) => shell.commit({ ...m, planetary: { ...m.planetary, ...patch } })
  const setHel = (patch: Partial<GearDoc['helical']>) => shell.commit({ ...m, helical: { ...m.helical, ...patch } })
  const setBelt = (patch: Partial<GearDoc['belt']>) => shell.commit({ ...m, belt: { ...m.belt, ...patch } })
  const setView = (v: GearView) => shell.commit({ ...m, view: v })

  // ------------------------------------------------------------ exports
  const run = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { await os.dialog.alert(e instanceof Error ? e.message : String(e), { title: 'Export' }) } }
  const shapesFor = (which: 'g1' | 'g2' | 'pair') => (which === 'pair' ? pairShapes(pg, bore) : gearShapes(which === 'g1' ? pg.g1 : pg.g2, bore))
  const exportGear = (which: 'g1' | 'g2' | 'pair', ext: '.svg' | '.dxf') => run(() => {
    const sh = shapesFor(which)
    return shell.saveFile(`${safeName(m.name)}-${which === 'pair' ? 'pair' : which === 'g1' ? `gear1-z${pg.g1.z}` : `gear2-z${pg.g2.z}`}${ext}`, ext, ext === '.svg' ? shapesToSvg(sh, { title: m.name }) : shapesToDxf(sh))
  })
  const exportPng = () => run(async () => { if (canvas.current) await shell.saveFile(`${safeName(m.name)}.png`, '.png', await canvas.current.png()) })
  const tableData = (): { header: string[]; rows: Array<Array<string | number>>; name: string } => {
    if (view === 'train') return { header: ['shaft', 'gears', 'rpm', 'torque_Nm', 'power_W'], rows: train.rows.map((r) => [r.shaft, r.teeth, r.rpm, r.torque, r.power]), name: `${m.name} train` }
    if (view === 'planetary') return { header: ['fixed', 'input', 'output', 'ratio'], rows: planetaryTable(m.planetary).map((r) => [r.fixed, r.input, r.output, Number.isFinite(r.ratio) ? r.ratio : '']), name: `${m.name} planetary` }
    return { header: ['quantity', 'gear1', 'gear2'], rows: [['teeth', pg.g1.z, pg.g2.z], ['d_mm', pg.g1.d, pg.g2.d], ['db_mm', pg.g1.db, pg.g2.db], ['da_mm', pg.g1.da, pg.g2.da], ['df_mm', pg.g1.df, pg.g2.df]], name: `${m.name} gears` }
  }
  const exportCsv = () => run(() => { const t = tableData(); return shell.saveFile(`${safeName(t.name)}.csv`, '.csv', toCsv(t.header, t.rows)) })
  const toKplot = () => { const t = tableData(); shell.openInKplot(toTsv(t.header, t.rows), t.name) }

  // ------------------------------------------------------------ menus
  useEffect(() => {
    const viewItems: MenuItem[] = [
      { label: 'Zoom in', icon: ZoomIn, shortcut: '+', onClick: () => canvas.current?.zoomBy(1.25) },
      { label: 'Zoom out', icon: ZoomOut, shortcut: '−', onClick: () => canvas.current?.zoomBy(0.8) },
      { label: 'Fit to window', icon: Maximize, shortcut: 'F', onClick: () => canvas.current?.fit() },
      '-',
      { label: 'Pitch and base circles', checked: prefs.circles, onClick: () => setPrefs({ circles: !prefs.circles }) },
      { label: 'Line of action', checked: prefs.contact, onClick: () => setPrefs({ contact: !prefs.contact }) },
      { label: 'Side panel', checked: prefs.side, onClick: () => setPrefs({ side: !prefs.side }) },
    ]
    const gears: MenuItem[] = [
      { label: playing ? 'Pause' : 'Play', icon: playing ? Pause : Play, shortcut: 'P', onClick: () => setPlaying((p) => !p) },
      '-',
      ...VIEWS.map((v) => ({ label: v.label, checked: view === v.id, onClick: () => setView(v.id) })),
    ]
    const exports: MenuItem[] = [
      { label: 'Gear 1 outline (SVG)…', onClick: () => void exportGear('g1', '.svg') }, { label: 'Gear 1 outline (DXF)…', onClick: () => void exportGear('g1', '.dxf') },
      { label: 'Gear 2 outline (SVG)…', onClick: () => void exportGear('g2', '.svg') }, { label: 'Gear 2 outline (DXF)…', onClick: () => void exportGear('g2', '.dxf') },
      { label: 'Meshing pair (SVG)…', onClick: () => void exportGear('pair', '.svg') }, { label: 'Meshing pair (DXF)…', onClick: () => void exportGear('pair', '.dxf') },
      { label: 'Table (CSV)…', onClick: () => void exportCsv() }, { label: 'Picture of the sheet (PNG)…', onClick: () => void exportPng() }, { label: 'Open the table in kPlot', onClick: toKplot },
    ]
    const menus: MenuBarMenu[] = [shell.fileMenu(exports), shell.editMenu([]), { label: 'Gears', items: gears }, { label: 'View', items: viewItems }, shell.helpMenu(SHORTCUTS, HELP)]
    shell.win.setMenus(menus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.version, prefs, playing, view, bore, m])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 'p') { e.preventDefault(); setPlaying((p) => !p) } else if (k === 'f') canvas.current?.fit()
    else if (k === '+' || k === '=') canvas.current?.zoomBy(1.25)
    else if (k === '-') canvas.current?.zoomBy(0.8)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPlaying(false); setPhase((p) => p + (e.key === 'ArrowRight' ? 1 : -1) * rad(e.shiftKey ? 10 : 1)) }
  }

  // ------------------------------------------------------------ panels
  const gearFields = (title: string, key: 'g1' | 'g2', g: GearSpec) => (
    <Section title={title}>
      <NumField label="Teeth" integer min={3} max={500} value={g.z} onChange={(v) => setPair(key === 'g1' ? { z: v } : {}, key === 'g2' ? { z: v } : {})} />
      <NumField label="Profile shift x" min={-1} max={2} step={0.05} value={g.x} onChange={(v) => setPair(key === 'g1' ? { x: v } : {}, key === 'g2' ? { x: v } : {})} title="Addendum modification coefficient" />
    </Section>
  )
  const pairPanel = (
    <>
      <Section title="Both gears">
        <NumField label="Module" unit="mm" min={0.05} value={m.pair.g1.module} onChange={(v) => both({ module: v })} />
        <NumField label="Diametral pitch" unit="/in" min={1} value={25.4 / m.pair.g1.module} onChange={(v) => both({ module: 25.4 / v })} title="Teeth per inch of pitch diameter" />
        <label className="mc-field"><span>Pressure angle</span>
          <select className="k-input" value={[14.5, 20, 25].includes(m.pair.g1.alpha) ? m.pair.g1.alpha : 'other'} onChange={(e) => e.target.value !== 'other' && both({ alpha: Number(e.target.value) })}>
            <option value={14.5}>14.5°</option><option value={20}>20°</option><option value={25}>25°</option>{![14.5, 20, 25].includes(m.pair.g1.alpha) && <option value="other">{m.pair.g1.alpha}°</option>}
          </select>
        </label>
        <NumField label="Addendum" unit="m" min={0.4} max={1.5} step={0.05} value={m.pair.g1.ha} onChange={(v) => both({ ha: v })} title="In modules (1 = full depth, 0.8 = stub)" />
        <NumField label="Backlash" unit="mm" min={0} step={0.01} value={m.pair.g1.backlash} onChange={(v) => both({ backlash: v })} title="Circumferential, shared by the two gears" />
        <NumField label="Root fillet" unit="m" min={0} max={0.6} step={0.02} value={m.pair.g1.fillet} onChange={(v) => both({ fillet: v })} title="Fillet radius in modules (0.38 is the standard tool)" />
        <NumField label="Centre distance" unit="mm" min={0} value={m.pair.centre ?? pg.aw} onChange={(v) => shell.commit({ ...m, pair: { ...m.pair, centre: v > 0 ? v : undefined } })} title="Leave at the working value, or type another" />
        {m.pair.centre !== undefined && <div className="mc-actions"><button className="k-btn" onClick={() => shell.commit({ ...m, pair: { ...m.pair, centre: undefined } })}>Use the standard centre distance</button></div>}
      </Section>
      {gearFields('Gear 1 (pinion)', 'g1', m.pair.g1)}
      {gearFields('Gear 2', 'g2', m.pair.g2)}
      <Section title="Geometry">
        <table className="mc-table">
          <thead><tr><th></th><th>gear 1</th><th>gear 2</th></tr></thead>
          <tbody>
            {([['d pitch', (g) => g.d], ['db base', (g) => g.db], ['da tip', (g) => g.da], ['df root', (g) => g.df], ['s at pitch', (g) => g.s], ['tip land', (g) => g.sa], ['min teeth', (g) => g.zMin]] as Array<[string, (g: typeof pg.g1) => number]>).map(([k, fn]) => (
              <tr key={k}><td>{k}</td><td>{f4(fn(pg.g1), 5)}</td><td>{f4(fn(pg.g2), 5)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="mc-hint">All in mm. Pitch p = {f4(pg.g1.p, 5)} mm, base pitch {f4(pg.g1.pb, 5)} mm, whole depth {f4(pg.g1.h, 4)} mm.</div>
      </Section>
      <Section title="The pair">
        <Kv rows={[
          ['Ratio z2/z1', f4(pg.ratio, 5)], ['Standard centre distance', `${f4(pg.a0)} mm`], ['Working centre distance', `${f4(pg.aw)} mm`], ['Working pressure angle', `${f4(deg(pg.alphaW), 5)}°`],
          ['Contact ratio ε', <b key="e" className={pg.epsilon < 1.2 ? 'mc-badtxt' : pg.epsilon < 1.4 ? '' : 'mc-good'}>{f4(pg.epsilon, 4)}</b>], ['Path of contact', `${f4(pg.pathOfContact)} mm`], ['Backlash at the working circles', `${f4(pg.backlash, 3)} mm`],
          ['Speed (gear 2)', `${f4(m.pair.rpm / pg.ratio)} rpm`], ['Torque (gear 2)', `${f4(m.pair.torque * pg.ratio * 0.98)} N·m (98 % mesh)`],
        ]} />
        <NumField label="Input speed" unit="rpm" value={m.pair.rpm} onChange={(v) => shell.commit({ ...m, pair: { ...m.pair, rpm: v } })} />
        <NumField label="Input torque" unit="N·m" value={m.pair.torque} onChange={(v) => shell.commit({ ...m, pair: { ...m.pair, torque: v } })} />
        {pg.warnings.map((w, i) => <Note key={i} kind="warn">{w}</Note>)}
        {pg.warnings.length === 0 && <Note kind="ok">The pair meshes: no undercut, interference or pointed tooth, and the contact ratio is {f4(pg.epsilon, 3)}.</Note>}
      </Section>
      <Section title="Export outlines (mm)">
        <NumField label="Bore" unit="mm" min={0} value={bore} onChange={setBore} title="A hole of this diameter in the exported gear" />
        <div className="mc-actions">
          <button className="k-btn" onClick={() => void exportGear('g1', '.svg')}><Download size={13} /> Gear 1 SVG</button><button className="k-btn" onClick={() => void exportGear('g1', '.dxf')}>DXF</button>
          <button className="k-btn" onClick={() => void exportGear('g2', '.svg')}><Download size={13} /> Gear 2 SVG</button><button className="k-btn" onClick={() => void exportGear('g2', '.dxf')}>DXF</button>
          <button className="k-btn" onClick={() => void exportGear('pair', '.svg')}>Pair SVG</button><button className="k-btn" onClick={() => void exportGear('pair', '.dxf')}>DXF</button>
        </div>
      </Section>
    </>
  )

  const trainPanel = (
    <>
      <Section title="Meshes (driver → driven)">
        <table className="mc-table">
          <thead><tr><th>driver</th><th>driven</th><th>mesh</th><th title="The driven gear is also the driver of the next mesh (an idler)">idler</th><th /></tr></thead>
          <tbody>
            {m.train.stages.map((s, i) => (
              <tr key={i}>
                <td><NumField integer min={1} value={s.driver} onChange={(v) => setStage(i, { driver: v })} /></td>
                <td><NumField integer min={1} value={s.driven} onChange={(v) => setStage(i, { driven: v })} /></td>
                <td>
                  <select className="k-input" aria-label={`Mesh ${i + 1} type`} value={s.mesh ?? 'external'} onChange={(e) => setStage(i, { mesh: e.target.value as TrainStage['mesh'] })}>
                    <option value="external">external</option><option value="internal">internal</option><option value="bevel">bevel</option><option value="worm">worm</option>
                  </select>
                </td>
                <td><input type="checkbox" aria-label={`Mesh ${i + 1} driven gear is an idler`} checked={!!s.shared} onChange={(e) => setStage(i, { shared: e.target.checked })} /></td>
                <td><button className="k-icon-btn" aria-label="Remove the mesh" disabled={m.train.stages.length < 2} onClick={() => setTrain({ stages: m.train.stages.filter((_, k) => k !== i) })}><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mc-actions"><button className="k-btn" onClick={() => { const last = m.train.stages[m.train.stages.length - 1]; setTrain({ stages: [...m.train.stages, { driver: 20, driven: last ? last.driven : 40 }] }) }}><Plus size={13} /> Mesh</button></div>
        <NumField label="Input speed" unit="rpm" value={m.train.rpm} onChange={(v) => setTrain({ rpm: v })} />
        <NumField label="Input torque" unit="N·m" value={m.train.torque} onChange={(v) => setTrain({ torque: v })} />
        <NumField label="Mesh efficiency" min={0.5} max={1} step={0.01} value={m.train.eff} onChange={(v) => setTrain({ eff: v })} title="Per mesh" />
      </Section>
      <Section title="Result">
        <Kv rows={[['Overall ratio ω_out/ω_in', <b key="r">{f4(train.ratio, 5)}</b>], ['Reduction', `${f4(train.reduction, 5)} : 1`], ['Efficiency', `${f4(train.efficiency * 100, 4)} %`], ['Meshes', train.meshes]]} />
        <table className="mc-table">
          <thead><tr><th>shaft</th><th>gears</th><th>rpm</th><th>N·m</th><th>W</th></tr></thead>
          <tbody>{train.rows.map((r) => <tr key={r.shaft}><td>{r.shaft}</td><td>{r.teeth}</td><td>{f4(r.rpm, 5)}</td><td>{f4(r.torque, 4)}</td><td>{f4(r.power, 4)}</td></tr>)}</tbody>
        </table>
        <div className="mc-hint">A negative speed turns against the input. An idler changes the sense but not the ratio.</div>
      </Section>
      <OtherRatios />
    </>
  )

  const plRatios = planetaryTable(m.planetary)
  const plT = planetaryTorques(m.planetary, 1)
  const planetaryPanel = (
    <>
      <Section title="Gear set">
        <NumField label="Sun teeth Zs" integer min={6} value={m.planetary.Zs} onChange={(v) => setPl({ Zs: v })} />
        <NumField label="Ring teeth Zr" integer min={12} value={m.planetary.Zr} onChange={(v) => setPl({ Zr: v })} />
        <NumField label="Planets N" integer min={2} max={8} value={m.planetary.n} onChange={(v) => setPl({ n: v })} />
        <NumField label="Module" unit="mm" min={0.1} value={m.planetary.module} onChange={(v) => setPl({ module: v })} />
        <Kv rows={[['Planet teeth Zp = (Zr − Zs)/2', pl.integerPlanet ? pl.Zp : '–'], ['Ratio Zr/Zs', f4(m.planetary.Zr / m.planetary.Zs, 5)]]} />
        {pl.messages.map((x, i) => <Note key={i} kind="warn">{x}</Note>)}
        {pl.messages.length === 0 && <Note kind="ok">The set assembles with {m.planetary.n} planets and the planets do not touch each other.</Note>}
      </Section>
      <Section title="Speeds">
        <label className="mc-field"><span>Fixed member</span><select className="k-input" value={m.planetary.fixed} onChange={(e) => setPl({ fixed: e.target.value as Member, ...(e.target.value === m.planetary.input ? { input: members.find((x) => x !== e.target.value)! } : {}) })}>{members.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select></label>
        <label className="mc-field"><span>Input member</span><select className="k-input" value={m.planetary.input} onChange={(e) => setPl({ input: e.target.value as Member, ...(e.target.value === m.planetary.fixed ? { fixed: members.find((x) => x !== e.target.value)! } : {}) })}>{members.filter((x) => x !== m.planetary.fixed).map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select></label>
        <NumField label="Input speed" unit="rpm" value={m.planetary.speed} onChange={(v) => setPl({ speed: v })} />
        {plSpeeds && <Kv rows={[['Sun', `${f4(plSpeeds.sun, 5)} rpm`], ['Ring', `${f4(plSpeeds.ring, 5)} rpm`], ['Carrier', `${f4(plSpeeds.carrier, 5)} rpm`], ['Planet (own axis, absolute)', `${f4(plSpeeds.planet, 5)} rpm`], ['Planet relative to the carrier', `${f4(plSpeeds.planetRel, 5)} rpm`]]} />}
        <div className="mc-hint">Willis: Zs(ωs − ωc) + Zr(ωr − ωc) = 0. Torque shares sun : ring : carrier = {f4(plT.sun)} : {f4(plT.ring)} : {f4(plT.carrier)}.</div>
      </Section>
      <Section title="Ratios for each member fixed (input / output)">
        <table className="mc-table">
          <thead><tr><th>fixed</th><th>input</th><th>output</th><th>ratio</th></tr></thead>
          <tbody>{plRatios.map((r, i) => <tr key={i}><td>{cap(r.fixed)}</td><td>{cap(r.input)}</td><td>{cap(r.output)}</td><td>{Number.isFinite(r.ratio) ? f4(r.ratio, 5) : '∞'}</td></tr>)}</tbody>
        </table>
        <div className="mc-hint">Ring fixed, sun in, carrier out: 1 + Zr/Zs = {f4(1 + m.planetary.Zr / m.planetary.Zs, 5)}. A negative ratio reverses the sense.</div>
      </Section>
    </>
  )

  const hg1 = helicalGear(m.helical.mn, m.helical.z1, m.helical.beta, m.helical.alphaN)
  const hg2 = helicalGear(m.helical.mn, m.helical.z2, m.helical.beta, m.helical.alphaN)
  const hc = helicalContact(m.helical.z1, m.helical.z2, m.helical.mn, m.helical.beta, m.helical.alphaN, m.helical.width)
  const helicalPanel = (
    <>
      <Section title="Helical pair">
        <NumField label="Normal module" unit="mm" min={0.1} value={m.helical.mn} onChange={(v) => setHel({ mn: v })} />
        <NumField label="Teeth 1" integer min={6} value={m.helical.z1} onChange={(v) => setHel({ z1: v })} />
        <NumField label="Teeth 2" integer min={6} value={m.helical.z2} onChange={(v) => setHel({ z2: v })} />
        <NumField label="Helix angle β" unit="°" min={0} max={45} value={m.helical.beta} onChange={(v) => setHel({ beta: v })} />
        <NumField label="Normal pressure angle" unit="°" min={10} max={30} value={m.helical.alphaN} onChange={(v) => setHel({ alphaN: v })} />
        <NumField label="Face width b" unit="mm" min={1} value={m.helical.width} onChange={(v) => setHel({ width: v })} />
      </Section>
      <Section title="Results">
        <Kv rows={[
          ['Transverse module mt = mn / cos β', `${f4(hg1.mt, 5)} mm`], ['Transverse pressure angle', `${f4(deg(hg1.alphaT), 5)}°`], ['Pitch diameters', `${f4(hg1.d)} / ${f4(hg2.d)} mm`], ['Centre distance', `${f4(hc.centre)} mm`],
          ['Axial pitch', Number.isFinite(hg1.px) ? `${f4(hg1.px)} mm` : '∞'], ['Virtual teeth z / cos³β', `${f4(hg1.zv, 4)} / ${f4(hg2.zv, 4)}`], ['Minimum teeth (no undercut)', f4(hg1.zMin, 4)],
          ['Transverse contact ratio', f4(hc.epsAlpha, 4)], ['Face contact ratio b sin β/(π mn)', f4(hc.epsBeta, 4)], ['Total contact ratio', <b key="t" className="mc-good">{f4(hc.total, 4)}</b>],
        ]} />
        <div className="mc-hint">The sheet shows the transverse section: a spur pair with the transverse module and pressure angle.</div>
        {pg.warnings.map((w, i) => <Note key={i} kind="warn">{w}</Note>)}
        {m.helical.z1 < hg1.zMin && <Note kind="warn">The pinion has fewer teeth than the minimum {f4(hg1.zMin, 3)} for this helix angle: it will be undercut.</Note>}
      </Section>
    </>
  )

  const bd = beltDrive(m.belt.D, m.belt.d, m.belt.C, m.belt.rpm, m.belt.crossed)
  const cd = chainDrive(m.belt.N1, m.belt.N2, m.belt.pitch, m.belt.C, m.belt.rpm)
  const beltPanel = (
    <>
      <Section title="Drive">
        <Seg label="Drive type" value={m.belt.kind} options={[{ id: 'belt', label: 'Belt' }, { id: 'chain', label: 'Chain' }]} onChange={(v) => setBelt({ kind: v })} />
        <NumField label="Centre distance" unit="mm" min={1} value={m.belt.C} onChange={(v) => setBelt({ C: v })} />
        <NumField label="Small shaft speed" unit="rpm" value={m.belt.rpm} onChange={(v) => setBelt({ rpm: v })} />
      </Section>
      <Section title="Belt">
        <NumField label="Large pulley D" unit="mm" min={1} value={m.belt.D} onChange={(v) => setBelt({ D: v })} />
        <NumField label="Small pulley d" unit="mm" min={1} value={m.belt.d} onChange={(v) => setBelt({ d: v })} />
        <Check label="Crossed belt" checked={m.belt.crossed} onChange={(v) => setBelt({ crossed: v })} />
        {bd ? <Kv rows={[['Speed ratio D/d', f4(bd.ratio)], ['Belt length', `${f4(bd.length)} mm`], ['Wrap on the small pulley', `${f4(bd.wrapSmall, 4)}°`], ['Belt speed', `${f4(bd.speed)} m/s`], ['Large pulley speed', `${f4(m.belt.rpm / bd.ratio)} rpm`]]} /> : <Note kind="error">The pulleys are too close together for a belt.</Note>}
        {bd && bd.wrapSmall < 120 && <Note kind="warn">The wrap on the small pulley is below 120°: the belt may slip. Increase the centre distance.</Note>}
        <div className="mc-hint">L = 2C + π(D + d)/2 + (D − d)²/(4C) (open), (D + d)²/(4C) for the crossed belt.</div>
      </Section>
      <Section title="Chain">
        <NumField label="Teeth, small" integer min={6} value={m.belt.N1} onChange={(v) => setBelt({ N1: v })} />
        <NumField label="Teeth, large" integer min={6} value={m.belt.N2} onChange={(v) => setBelt({ N2: v })} />
        <NumField label="Pitch" unit="mm" min={1} value={m.belt.pitch} onChange={(v) => setBelt({ pitch: v })} title="12.7 mm = ½ in (08B), 9.525 = 3/8 in (06B)" />
        {cd ? <Kv rows={[['Speed ratio', f4(cd.ratio)], ['Links (even)', cd.links], ['Centre distance for those links', `${f4(cd.centre)} mm`], ['Chain speed', `${f4(cd.speed)} m/s`]]} /> : <Note kind="error">Check the teeth (at least 6), the pitch and the centre distance.</Note>}
      </Section>
    </>
  )

  return (
    <div className="mc-body">
      <div className="mc-main">
        <div className="mc-stage">
          <MechCanvas ref={canvas} prims={prims} fitTo={fitTo} fitKey={`${view}|${shell.docId}`} grid label="Gears" onKeyDown={onKeyDown}>
            <div className="mc-overlay-info">
              <b>{m.name}</b>
              {(view === 'pair' || view === 'helical') && <> · ratio {f4(pg.ratio, 4)} · ε {f4(pg.epsilon, 3)} · a {f4(pg.aw, 5)} mm</>}
              {view === 'train' && <> · ratio {f4(train.ratio, 5)}</>}
              {view === 'planetary' && <> · Zp {pl.integerPlanet ? pl.Zp : '?'}</>}
              {view === 'belt' && (m.belt.kind === 'belt' ? (bd ? <> · belt {f4(bd.length)} mm</> : null) : null)}
            </div>
            <div className="mc-play">
              <button className="k-icon-btn" aria-label="Back to the start" onClick={() => { setPlaying(false); setPhase(0) }}><SkipBack size={15} /></button>
              <button className={`k-btn${playing ? '' : ' primary'}`} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (P)" onClick={() => setPlaying((p) => !p)}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
              <input type="range" aria-label="Rotation" min={0} max={360} step={0.5} value={(((deg(phase) % 360) + 360) % 360)} onChange={(e) => { setPlaying(false); setPhase(rad(Number(e.target.value))) }} />
              <select className="k-input" aria-label="Playback speed" value={prefs.speed} onChange={(e) => setPrefs({ speed: Number(e.target.value) })}>{[0.25, 0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
              <button className={`k-icon-btn${prefs.side ? ' active' : ''}`} aria-label="Side panel" aria-pressed={prefs.side} onClick={() => setPrefs({ side: !prefs.side })}><PanelRight size={15} /></button>
            </div>
          </MechCanvas>
          {prefs.side && (
            <aside className="mc-side" aria-label="Gear settings">
              <div className="mc-side-tabs" role="tablist">
                {VIEWS.map((v) => <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}>{v.label}</button>)}
                <button className="k-icon-btn" style={{ marginLeft: 'auto', alignSelf: 'center' }} aria-label="Close the side panel" onClick={() => setPrefs({ side: false })}><X size={14} /></button>
              </div>
              <div className="mc-side-body">
                {view === 'pair' && pairPanel}
                {view === 'train' && trainPanel}
                {view === 'planetary' && planetaryPanel}
                {view === 'helical' && helicalPanel}
                {view === 'belt' && beltPanel}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

/** Rack and pinion, bevel and worm calculators (ratio only for bevels). */
function OtherRatios() {
  const [rack, setRack] = useState({ module: 2, z: 20, rpm: 60 })
  const [bev, setBev] = useState({ z1: 20, z2: 40, sigma: 90 })
  const [worm, setWorm] = useState({ starts: 2, wheel: 40, module: 2, dw: 28, mu: 0.05 })
  const rp = rackPinion(rack.module, rack.z, rack.rpm)
  const bv = bevelPair(bev.z1, bev.z2, bev.sigma)
  const wg = wormGear(worm.starts, worm.wheel, worm.module, worm.dw, 20, worm.mu)
  return (
    <>
      <Section title="Rack and pinion">
        <NumField label="Module" unit="mm" min={0.1} value={rack.module} onChange={(v) => setRack({ ...rack, module: v })} /><NumField label="Pinion teeth" integer min={6} value={rack.z} onChange={(v) => setRack({ ...rack, z: v })} /><NumField label="Speed" unit="rpm" value={rack.rpm} onChange={(v) => setRack({ ...rack, rpm: v })} />
        <Kv rows={[['Rack travel per revolution', `${f4(rp.travelPerRev)} mm`], ['Rack speed', `${f4(rp.speed)} mm/s`], ['Pinion pitch radius', `${f4(rp.pitchRadius)} mm`]]} />
      </Section>
      <Section title="Bevel pair (ratio and cone angles)">
        <NumField label="Teeth 1" integer min={6} value={bev.z1} onChange={(v) => setBev({ ...bev, z1: v })} /><NumField label="Teeth 2" integer min={6} value={bev.z2} onChange={(v) => setBev({ ...bev, z2: v })} /><NumField label="Shaft angle" unit="°" min={10} max={170} value={bev.sigma} onChange={(v) => setBev({ ...bev, sigma: v })} />
        <Kv rows={[['Ratio', f4(bv.ratio, 5)], ['Pitch cone angles', `${f4(bv.delta1, 5)}° and ${f4(bv.delta2, 5)}°`]]} />
      </Section>
      <Section title="Worm gear">
        <NumField label="Worm starts" integer min={1} max={8} value={worm.starts} onChange={(v) => setWorm({ ...worm, starts: v })} /><NumField label="Wheel teeth" integer min={10} value={worm.wheel} onChange={(v) => setWorm({ ...worm, wheel: v })} />
        <NumField label="Module" unit="mm" min={0.1} value={worm.module} onChange={(v) => setWorm({ ...worm, module: v })} /><NumField label="Worm diameter" unit="mm" min={1} value={worm.dw} onChange={(v) => setWorm({ ...worm, dw: v })} /><NumField label="Friction μ" min={0.005} max={0.5} step={0.005} value={worm.mu} onChange={(v) => setWorm({ ...worm, mu: v })} />
        <Kv rows={[['Ratio', f4(wg.ratio, 5)], ['Lead angle', `${f4(wg.leadAngle, 4)}°`], ['Efficiency (worm driving)', `${f4(wg.efficiency * 100, 3)} %`], ['Self-locking', wg.selfLocking ? <span key="s" className="mc-good">yes</span> : 'no'], ['Centre distance', `${f4(wg.centre)} mm`]]} />
      </Section>
    </>
  )
}

