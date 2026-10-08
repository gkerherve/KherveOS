// The desktop's dialogs: the builders (builders_ui.py — Crystal, Surface,
// Add molecule to surface, Graphene/nanotubes/fullerenes, Polymer, Reaction),
// the Molecule Explorer (explorer.py), Properties (properties.py), Stack unit
// cells, Export 3D model (exports_ui.MeshDialog), the User Guide and About
// (help.py) and the AI Chat Settings (ai_assistant.AiSettingsDialog).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { os } from '@/os'
import { mdiRefresh } from '@mdi/js'
import { KMolMark, Mdi } from './icons'
import { paintSpecs, specsBounds, fitTransform, type Spec } from './specs'
import { insertSpecies, type Catalog } from './catalog'
import { loadAiSettings, saveAiSettings, fetchModels, type AiSettings } from './ai'
import type { MolApp } from './app'
import type { Mol } from './types'
import { SpinBox } from './Viewer3D'

// --------------------------------------------------------------- frame

function Frame({ title, children, buttons, minWidth = 460, onClose, wide }: { title: string; children: ReactNode; buttons: ReactNode; minWidth?: number; onClose: () => void; wide?: boolean }) {
  return (
    <div className="km-modal-back" onMouseDown={(e) => e.stopPropagation()}>
      <div
        className={`km-modal${wide ? ' wide' : ''}`}
        style={{ minWidth }}
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
        }}
      >
        <div className="km-modal-title">{title}</div>
        <div className="km-modal-body">{children}</div>
        <div className="km-modal-buttons">{buttons}</div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="km-flabel">{label}</div>
      <div className="km-ffield">{children}</div>
    </>
  )
}

function Num({ value, onChange, min, max, step = 1, decimals = 0, disabled, title, suffix }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; decimals?: number; disabled?: boolean; title?: string; suffix?: string }) {
  return (
    <span className="km-spin" title={title}>
      <input
        className="k-input km-num"
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={Number(value.toFixed(decimals))}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)))
        }}
      />
      {suffix && <span className="km-suffix">{suffix}</span>}
    </span>
  )
}

const qs = (v: number) => {
  // Python's f"{x}" of a float: 3.0 → "3.0", 0.5 → "0.5"
  const s = String(v)
  return Number.isInteger(v) ? `${s}.0` : s
}
const g = (v: number) => String(Number(v.toPrecision(6)))

/** Debounced engine request for a dialog's live summary. */
function useSummary<T>(app: MolApp, key: string, op: string, args: Record<string, unknown> | null, initial: T): T {
  const [v, setV] = useState<T>(initial)
  const json = JSON.stringify(args)
  useEffect(() => {
    if (args === null) return
    let live = true
    const t = setTimeout(() => {
      void app.bridge.latest(key, op, args).then((a) => {
        if (live && a.ok) setV(a as unknown as T)
      })
    }, 120)
    return () => {
      live = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json])
  return v
}

function crystalItems(c: Catalog) {
  return c.crystals.map((x) => ({ value: x.key, label: `${x.name}   [${x.category}]` }))
}

// ------------------------------------------------------------ doping row

interface Dope {
  host: string
  with: string
  frac: number
  seed: number
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '')
function dopeQuery(d: Dope): string {
  const host = cap(d.host.trim()), dop = cap(d.with.trim())
  if (!(host && dop && d.frac > 0)) return ''
  return `&dope=${host}:${dop}:${g(d.frac)}&seed=${d.seed}`
}
function DopeRow({ d, set }: { d: Dope; set: (d: Dope) => void }) {
  return (
    <Row label="Doping">
      <input className="k-input km-short" placeholder="host, e.g. Nb" value={d.host} onChange={(e) => set({ ...d, host: e.target.value })} />
      <span className="km-label">→</span>
      <input className="k-input km-short" placeholder="dopant, e.g. Mo" value={d.with} onChange={(e) => set({ ...d, with: e.target.value })} />
      <span className="km-label">fraction</span>
      <Num value={d.frac} min={0} max={1} step={0.05} decimals={3} onChange={(v) => set({ ...d, frac: v })} />
      <span className="km-label">seed</span>
      <Num value={d.seed} min={0} max={99999} title="Same seed, same atoms substituted" onChange={(v) => set({ ...d, seed: Math.round(v) })} />
    </Row>
  )
}

// ================================================================ Crystal

function CrystalDialog({ app, done }: { app: MolApp; done: (v: unknown) => void }) {
  const catalog = useStore(app.store, (s) => s.catalog)!
  const [key, setKey] = useState('cu')
  const [n, setN] = useState<[number, number, number]>([1, 1, 1])
  const [faces, setFaces] = useState(true)
  const [dope, setDope] = useState<Dope>({ host: '', with: '', frac: 0, seed: 7 })
  const q = dopeQuery(dope)
  const sum = useSummary(app, 'crystal_summary', 'crystal_summary', { key, nx: n[0], ny: n[1], nz: n[2], dope: q }, { text: '' })
  const ok = () => {
    const c = catalog.crystals.find((x) => x.key === key)!
    let value = `${key}?cells=${n.join(',')}`
    if (!faces) value += '&boundary=0'
    done({ kind: 'crystal', value: value + q, label: c.name })
  }
  return (
    <Frame title="Crystal builder" onClose={() => done(null)} buttons={<Buttons ok="Build in 3D" onOk={ok} onCancel={() => done(null)} />}>
      <div className="km-form">
        <Row label="Crystal">
          <select className="km-combo km-wide" value={key} onChange={(e) => setKey(e.target.value)}>
            {crystalItems(catalog).map((it) => (
              <option key={it.value} value={it.value}>
                {it.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Cells">
          {(['a', 'b', 'c'] as const).map((ax, i) => (
            <span key={ax} className="km-inline">
              <span className="km-label">{ax}</span>
              <Num value={n[i]} min={1} max={12} onChange={(v) => setN(n.map((x, k) => (k === i ? Math.round(v) : x)) as [number, number, number])} />
            </span>
          ))}
        </Row>
        <Row>
          <label className="km-check">
            <input type="checkbox" checked={faces} onChange={(e) => setFaces(e.target.checked)} /> Draw atoms on the cell faces in every cell
          </label>
        </Row>
        <DopeRow d={dope} set={setDope} />
      </div>
      <div className="km-summary">{sum.text}</div>
    </Frame>
  )
}

function Buttons({ ok, onOk, onCancel, okDisabled }: { ok: string; onOk: () => void; onCancel: () => void; okDisabled?: boolean }) {
  return (
    <>
      <button className="k-btn" onClick={onCancel}>
        Cancel
      </button>
      <button className="k-btn primary" disabled={okDisabled} onClick={onOk}>
        {ok}
      </button>
    </>
  )
}

// ---------------------------------------------------- adsorbate rows

interface Ads {
  source: string
  kept: string
  smiles: string
  mode: string
  height: number
  dx: number
  dy: number
  spin: number
  auto: boolean
}

function useAds(app: MolApp, drawn: Mol | null, allowNone: boolean, auto: boolean): [Ads, (a: Ads) => void] {
  const shelf = app.get().shelf
  const kept = shelf.map((s) => s.name)
  const source = drawn ? 'drawn' : allowNone ? 'none' : kept.length ? 'kept' : 'smiles'
  return useState<Ads>({ source, kept: kept[0] ?? '', smiles: '', mode: 'flat', height: 2.4, dx: 0, dy: 0, spin: 0, auto })
}

function AdsorbateRows({ app, drawn, ads, set, allowNone }: { app: MolApp; drawn: Mol | null; ads: Ads; set: (a: Ads) => void; allowNone: boolean }) {
  const shelf = useStore(app.store, (s) => s.shelf)
  const src = ads.source
  const free = src !== 'none' && !ads.auto
  return (
    <>
      <Row label="Add on top">
        <select className="km-combo km-wide" value={src} onChange={(e) => set({ ...ads, source: e.target.value })}>
          {allowNone && <option value="none">None — the bare surface</option>}
          <option value="drawn" disabled={!drawn}>
            The molecule I drew{drawn ? ` (${drawn.label}, ${drawn.formula})` : ' (draw or load a molecule first)'}
          </option>
          <option value="kept" disabled={!shelf.length}>
            A kept molecule (My molecules){shelf.length ? '' : ' — none kept yet'}
          </option>
          <option value="smiles">A molecule from SMILES…</option>
        </select>
      </Row>
      <Row label="Kept molecule">
        <select className="km-combo km-wide" disabled={src !== 'kept'} value={ads.kept} onChange={(e) => set({ ...ads, kept: e.target.value })}>
          {shelf.map((it) => (
            <option key={it.name} value={it.name}>
              {it.name}    {it.formula}
            </option>
          ))}
        </select>
      </Row>
      <Row label="SMILES">
        <input className="k-input" disabled={src !== 'smiles'} placeholder="e.g. c1ccccc1 or CO" value={ads.smiles} onChange={(e) => set({ ...ads, smiles: e.target.value })} />
      </Row>
      <Row label="Orientation">
        <select className="km-combo km-wide" disabled={src === 'none'} value={ads.mode} onChange={(e) => set({ ...ads, mode: e.target.value })}>
          <option value="flat">Lying flat (largest face down)</option>
          <option value="upright">Standing up (longest axis up)</option>
          <option value="as drawn">As it is drawn now</option>
        </select>
      </Row>
      <Row label="Placement">
        <span className="km-label">height Å</span>
        <Num value={ads.height} min={0.5} max={12} step={0.2} decimals={1} disabled={src === 'none'} title="Distance from the top atomic layer to the lowest atom of the molecule (Å)" onChange={(v) => set({ ...ads, height: v })} />
        <span className="km-label">dx</span>
        <Num value={ads.dx} min={-30} max={30} step={0.5} decimals={1} disabled={!free} onChange={(v) => set({ ...ads, dx: v })} />
        <span className="km-label">dy</span>
        <Num value={ads.dy} min={-30} max={30} step={0.5} decimals={1} disabled={!free} onChange={(v) => set({ ...ads, dy: v })} />
        <span className="km-label">turn °</span>
        <Num value={ads.spin} min={0} max={360} step={15} disabled={src === 'none'} onChange={(v) => set({ ...ads, spin: v })} />
      </Row>
      <Row>
        <label className="km-check">
          <input type="checkbox" disabled={src === 'none'} checked={ads.auto} onChange={(e) => set({ ...ads, auto: e.target.checked })} /> At the first free spot, clear of the molecules already there
        </label>
      </Row>
    </>
  )
}

function adsReady(ads: Ads): [boolean, string] {
  if (ads.source === 'smiles' && !ads.smiles.trim()) return [false, 'Type a SMILES to place on it.']
  return [true, '']
}

function adsResult(ads: Ads) {
  return { source: ads.source, kept: ads.kept, smiles: ads.smiles, placement: { height: ads.height, dx: ads.dx, dy: ads.dy, mode: ads.mode, spin: ads.spin, auto: ads.auto } }
}

// ================================================================ Surface

function SurfaceDialog({ app, done, drawn }: { app: MolApp; done: (v: unknown) => void; drawn: Mol | null }) {
  const catalog = useStore(app.store, (s) => s.catalog)!
  const [key, setKey] = useState('cu')
  const [miller, setMiller] = useState('111')
  const [auto, setAuto] = useState(true)
  const [nx, setNx] = useState(4)
  const [ny, setNy] = useState(4)
  const [layers, setLayers] = useState(3)
  const [term, setTerm] = useState<string>('')
  const [whole, setWhole] = useState(false)
  const [dope, setDope] = useState<Dope>({ host: '', with: '', frac: 0, seed: 7 })
  const [ads, setAds] = useAds(app, drawn, true, false)
  const q = dopeQuery(dope)
  const sum = useSummary(app, 'surface_summary', 'surface_summary', { key, miller, dope: q }, { text: '', valid: false, polyhedra: false, hkl: '' } as { text: string; valid: boolean; polyhedra: boolean; hkl: string })
  const [ready, hint] = adsReady(ads)
  let text = sum.text
  if (sum.valid) {
    if (!ready) text += '  ' + hint
    else if (ads.source !== 'none') text += '  The molecule is placed above it, not bonded — move it afterwards with the Molecules on the surface controls.'
  }
  const ok = () => {
    let value = `${key}:${sum.hkl}?layers=${layers}`
    if (!auto) value += `&repeat=${nx},${ny}`
    if (term !== '') value += `&termination=${term}`
    if (sum.polyhedra && whole) value += '&complete=1'
    done({ kind: 'surface', value: value + q, label: `${key} (${sum.hkl})`, ...adsResult(ads) })
  }
  return (
    <Frame title="Surface builder" onClose={() => done(null)} buttons={<Buttons ok="Build in 3D" okDisabled={!(sum.valid && ready)} onOk={ok} onCancel={() => done(null)} />}>
      <div className="km-form">
        <Row label="Crystal">
          <select className="km-combo km-wide" value={key} onChange={(e) => setKey(e.target.value)}>
            {crystalItems(catalog).map((it) => (
              <option key={it.value} value={it.value}>
                {it.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Plane (hkl)">
          <input className="k-input" title="Miller indices: 111, 1 1 0, 1-10 — or four hexagonal indices such as 0001, 10-10" value={miller} onChange={(e) => setMiller(e.target.value)} />
        </Row>
        <Row>
          <label className="km-check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Size the slab automatically (about 15 Å)
          </label>
        </Row>
        <Row label="Surface cells">
          <span className="km-label">u</span>
          <Num value={nx} min={1} max={30} disabled={auto} onChange={(v) => setNx(Math.round(v))} />
          <span className="km-label">v</span>
          <Num value={ny} min={1} max={30} disabled={auto} onChange={(v) => setNy(Math.round(v))} />
        </Row>
        <Row label="Layers deep">
          <Num value={layers} min={1} max={30} onChange={(v) => setLayers(Math.round(v))} />
        </Row>
        <Row label="Termination">
          <select className="km-combo km-wide" value={term} onChange={(e) => setTerm(e.target.value)}>
            <option value="">Automatic (widest gap between planes)</option>
            {[0, 0.25, 0.5, 0.75].map((t) => (
              <option key={t} value={qs(t)}>
                Cut at {t.toFixed(2)} of a layer
              </option>
            ))}
          </select>
        </Row>
        <Row>
          <label className="km-check" title="Keeps every coordination polyhedron whole at the cut, so the slab stays stoichiometric">
            <input type="checkbox" disabled={!sum.polyhedra} checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Whole polyhedra (add the ligands cut off, drop orphan ones)
          </label>
        </Row>
        <DopeRow d={dope} set={setDope} />
        <AdsorbateRows app={app} drawn={drawn} ads={ads} set={setAds} allowNone />
      </div>
      <div className="km-summary">{text}</div>
    </Frame>
  )
}

function AddMoleculeDialog({ app, done, drawn, crowded }: { app: MolApp; done: (v: unknown) => void; drawn: Mol | null; crowded: boolean }) {
  const [ads, setAds] = useAds(app, drawn, false, crowded)
  const [ready, hint] = adsReady(ads)
  return (
    <Frame title="Add a molecule to the surface" onClose={() => done(null)} buttons={<Buttons ok="Add to surface" okDisabled={!ready} onOk={() => done(adsResult(ads))} onCancel={() => done(null)} />}>
      <div className="km-form">
        <AdsorbateRows app={app} drawn={drawn} ads={ads} set={setAds} allowNone={false} />
      </div>
      <div className="km-summary">{hint || 'The molecule is placed above the slab, not bonded; move it afterwards with the buttons or by dragging it.'}</div>
    </Frame>
  )
}

// =================================================================== Nano

const NANO_TYPES: [string, string][] = [
  ['Graphene sheet', 'graphene'],
  ['Graphite (0001) surface', 'graphite'],
  ['Graphene nanoribbon', 'ribbon'],
  ['Graphene quantum dot', 'dot'],
  ['Graphene with a defect', 'defect'],
  ['Carbon nanotube', 'nanotube'],
  ['Fullerene', 'fullerene'],
]
const NANO_SHOWS: Record<string, string[]> = {
  graphene: ['width', 'depth', 'layers', 'stacking', 'twist', 'hydrogen'],
  graphite: ['width', 'depth', 'layers', 'step'],
  ribbon: ['edge', 'width', 'length'],
  dot: ['diameter'],
  defect: ['defect', 'width', 'depth'],
  nanotube: ['n', 'm', 'length', 'walls', 'hydrogen'],
  fullerene: ['fuller'],
}

function NanoDialog({ app, done }: { app: MolApp; done: (v: unknown) => void }) {
  const [type, setType] = useState('graphene')
  const [p, setP] = useState({ width: 3, depth: 3, layers: 1, stacking: 'AB', twist: 0, hydrogen: false, edge: 'armchair', diameter: 2, defect: 'vacancy', step: false, n: 5, m: 5, length: 3, walls: 1, fuller: 'c60' })
  const set = (patch: Partial<typeof p>) => setP({ ...p, ...patch })
  const shows = NANO_SHOWS[type]
  const tube = useSummary(app, 'nano_summary', 'nano_summary', type === 'nanotube' && (p.n > 0 || p.m > 0) ? { n: p.n, m: p.m } : null, { text: '' })
  const summary = type === 'nanotube' && (p.n > 0 || p.m > 0) ? tube.text : ''
  const ok = () => {
    const b = (v: boolean) => (v ? 1 : 0)
    let q: string[]
    if (type === 'graphene') q = [`width=${qs(p.width)}`, `depth=${qs(p.depth)}`, `layers=${p.layers}`, `stacking=${p.stacking}`, `twist=${qs(p.twist)}`, `hydrogen=${b(p.hydrogen)}`]
    else if (type === 'graphite') q = [`width=${qs(p.width)}`, `depth=${qs(p.depth)}`, `layers=${p.layers}`, `step=${b(p.step)}`]
    else if (type === 'ribbon') q = [`edge=${p.edge}`, `width=${qs(p.width)}`, `length=${qs(p.length)}`]
    else if (type === 'dot') q = [`diameter=${qs(p.diameter)}`]
    else if (type === 'defect') q = [`kind=${p.defect}`, `width=${qs(p.width)}`, `depth=${qs(p.depth)}`]
    else if (type === 'nanotube') q = [`n=${p.n}`, `m=${p.m}`, `length=${qs(p.length)}`, `walls=${p.walls}`, `hydrogen=${b(p.hydrogen)}`]
    else q = [`kind=${p.fuller}`]
    done({ kind: 'nano', value: `${type}?${q.join('&')}`, label: NANO_TYPES.find((t) => t[1] === type)![0] })
  }
  const show = (k: string) => shows.includes(k)
  return (
    <Frame title="Graphene, nanotubes & fullerenes" onClose={() => done(null)} buttons={<Buttons ok="Build in 3D" okDisabled={type === 'nanotube' && !(p.n > 0 || p.m > 0)} onOk={ok} onCancel={() => done(null)} />}>
      <div className="km-form">
        <Row label="Structure">
          <select className="km-combo km-wide" value={type} onChange={(e) => setType(e.target.value)}>
            {NANO_TYPES.map(([t, k]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </select>
        </Row>
        {show('width') && <Row label="Width (nm)"><Num value={p.width} min={0.6} max={12} step={0.5} decimals={1} onChange={(v) => set({ width: v })} /></Row>}
        {show('depth') && <Row label="Depth (nm)"><Num value={p.depth} min={0.6} max={12} step={0.5} decimals={1} onChange={(v) => set({ depth: v })} /></Row>}
        {show('layers') && <Row label="Layers"><Num value={p.layers} min={1} max={6} onChange={(v) => set({ layers: Math.round(v) })} /></Row>}
        {show('stacking') && (
          <Row label="Stacking">
            <select className="km-combo" value={p.stacking} onChange={(e) => set({ stacking: e.target.value })}>
              {['AB', 'ABA', 'ABC', 'AA'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Row>
        )}
        {show('twist') && <Row label="Twist of layer 2 (°)"><Num value={p.twist} min={0} max={30} step={1} decimals={1} onChange={(v) => set({ twist: v })} /></Row>}
        {show('hydrogen') && (
          <Row>
            <label className="km-check"><input type="checkbox" checked={p.hydrogen} onChange={(e) => set({ hydrogen: e.target.checked })} /> Cap the edges with hydrogen</label>
          </Row>
        )}
        {show('edge') && (
          <Row label="Edge">
            <select className="km-combo" value={p.edge} onChange={(e) => set({ edge: e.target.value })}>
              {['armchair', 'zigzag'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Row>
        )}
        {show('diameter') && <Row label="Diameter (nm)"><Num value={p.diameter} min={0.6} max={8} step={0.5} decimals={1} onChange={(v) => set({ diameter: v })} /></Row>}
        {show('defect') && (
          <Row label="Defect">
            <select className="km-combo" value={p.defect} onChange={(e) => set({ defect: e.target.value })}>
              {['vacancy', 'nitrogen'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Row>
        )}
        {show('step') && (
          <Row>
            <label className="km-check"><input type="checkbox" checked={p.step} onChange={(e) => set({ step: e.target.checked })} /> A monatomic step on the top sheet</label>
          </Row>
        )}
        {show('n') && <Row label="Chirality n"><Num value={p.n} min={1} max={40} onChange={(v) => set({ n: Math.round(v) })} /></Row>}
        {show('m') && <Row label="Chirality m"><Num value={p.m} min={0} max={40} onChange={(v) => set({ m: Math.round(v) })} /></Row>}
        {show('length') && <Row label="Length (nm)"><Num value={p.length} min={0.6} max={12} step={0.5} decimals={1} onChange={(v) => set({ length: v })} /></Row>}
        {show('walls') && <Row label="Walls"><Num value={p.walls} min={1} max={4} onChange={(v) => set({ walls: Math.round(v) })} /></Row>}
        {show('fuller') && (
          <Row label="Cage">
            <select className="km-combo" value={p.fuller} onChange={(e) => set({ fuller: e.target.value })}>
              {['c20', 'c60', 'c70', 'c80', 'c120', 'c200'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Row>
        )}
      </div>
      <div className="km-summary">{summary}</div>
    </Frame>
  )
}

// ================================================================ Polymer

function PolymerDialog({ app, done }: { app: MolApp; done: (v: unknown) => void }) {
  const catalog = useStore(app.store, (s) => s.catalog)!
  const presets = catalog.polymers
  const first = presets.find((p) => p.key === 'polyethylene') ?? presets[0]
  const [key, setKey] = useState(first.key)
  const [unit, setUnit] = useState(first.unit)
  const [head, setHead] = useState(first.head)
  const [tail, setTail] = useState(first.tail)
  const [n, setN] = useState(first.n)
  const custom = key === 'custom'
  const pick = (k: string) => {
    setKey(k)
    if (k !== 'custom') {
      const p = presets.find((x) => x.key === k)!
      setUnit(p.unit)
      setHead(p.head)
      setTail(p.tail)
      setN(p.n)
    } else if (!unit) setUnit('CC(C)')
  }
  const sum = useSummary(app, 'polymer_summary', 'polymer_summary', { unit, head, tail, n }, { text: '', valid: false })
  const ok = () => {
    if (!custom) done({ kind: 'polymer', value: `${key}?n=${n}`, label: presets.find((x) => x.key === key)!.name })
    else {
      const enc = (s: string) => encodeURIComponent(s.trim())
      done({ kind: 'polymer', value: `custom?unit=${enc(unit)}&n=${n}&head=${enc(head)}&tail=${enc(tail)}`, label: 'Custom polymer' })
    }
  }
  return (
    <Frame title="Polymer builder" minWidth={520} onClose={() => done(null)} buttons={<Buttons ok="Build in 3D" okDisabled={!sum.valid} onOk={ok} onCancel={() => done(null)} />}>
      <div className="km-form">
        <Row label="Polymer">
          <select className="km-combo km-wide" value={key} onChange={(e) => pick(e.target.value)}>
            {presets.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
            <option value="custom">Custom repeat unit…</option>
          </select>
        </Row>
        <Row label="Repeat unit">
          <input
            className="k-input"
            disabled={!custom}
            title="SMILES of one repeat unit: its first atom bonds to the previous unit and its last atom to the next — CC for polyethylene, CC(Cl) for PVC"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </Row>
        <Row label="End groups">
          <span className="km-label">start cap</span>
          <input className="k-input km-short" disabled={!custom} placeholder="H" value={head} onChange={(e) => setHead(e.target.value)} />
          <span className="km-label">end cap</span>
          <input className="k-input km-short" disabled={!custom} placeholder="H" value={tail} onChange={(e) => setTail(e.target.value)} />
        </Row>
        <Row label="Repeat units (n)">
          <Num value={n} min={1} max={200} onChange={(v) => setN(Math.round(v))} />
        </Row>
      </div>
      <div className="km-summary">{sum.text}</div>
    </Frame>
  )
}

// =============================================================== Reaction

function ReactionDialog({ app, done }: { app: MolApp; done: (v: unknown) => void }) {
  const catalog = useStore(app.store, (s) => s.catalog)!
  const shelf = useStore(app.store, (s) => s.shelf)
  const [text, setText] = useState('CH4 + O2 -> CO2 + H2O')
  const [example, setExample] = useState('')
  const [balance, setBalance] = useState(true)
  const [mine, setMine] = useState(shelf[0]?.name ?? '')
  const rep = useSummary(app, 'reaction_report', 'reaction_report', { text, balance }, { text: '', valid: false })
  const ok = async () => {
    const a = await app.bridge.call('reaction_entry', { text, balance })
    const eq = a.ok ? String(a.equation) : text.trim()
    done({ kind: 'reaction', value: eq, label: eq })
  }
  const add = (side: 0 | 1) => {
    const it = shelf.find((s) => s.name === mine)
    if (it) setText(insertSpecies(text, it.token, side))
  }
  return (
    <Frame title="Reaction builder" minWidth={560} onClose={() => done(null)} buttons={<Buttons ok="Show reaction in 3D" okDisabled={!rep.valid} onOk={() => void ok()} onCancel={() => done(null)} />}>
      <div className="km-form">
        <Row label="Examples">
          <select
            className="km-combo km-wide"
            value={example}
            onChange={(e) => {
              setExample(e.target.value)
              if (e.target.value) setText(e.target.value)
            }}
          >
            <option value="">— choose a classic reaction —</option>
            {catalog.reactions.map((r) => (
              <option key={r.name} value={r.equation}>
                {r.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Equation">
          <input
            className="k-input"
            title="Species are compound names or formulas (H2O, NH4+, SO4^2-), an element (Fe), or smiles:CCO. Arrows: ->  <=>  →  ⇌"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Row>
        <Row label="My molecules">
          {shelf.length ? (
            <>
              <select className="km-combo km-grow" value={mine} onChange={(e) => setMine(e.target.value)}>
                {shelf.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}    {s.formula}
                  </option>
                ))}
              </select>
              <button className="k-btn small" title="Add the chosen molecule to the left side of the equation" onClick={() => add(0)}>
                + Reactant
              </button>
              <button className="k-btn small" title="Add the chosen molecule to the right side of the equation" onClick={() => add(1)}>
                + Product
              </button>
              <button className="k-btn small" title="Start an empty equation" onClick={() => setText(' -> ')}>
                New
              </button>
            </>
          ) : (
            <span className="km-hint">Build a molecule in 3D and press Keep (toolbar) to use it here.</span>
          )}
        </Row>
        <Row>
          <label className="km-check">
            <input type="checkbox" checked={balance} onChange={(e) => setBalance(e.target.checked)} /> Balance the coefficients for me
          </label>
        </Row>
        <Row label="Result">
          <textarea className="k-input km-report" readOnly value={rep.text} />
        </Row>
      </div>
    </Frame>
  )
}

// ================================================================ Explorer

function SpecPreview({ specs, text }: { specs: Spec[] | null; text: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const w = cv.clientWidth || 300, h = cv.clientHeight || 260
    const dpr = window.devicePixelRatio || 1
    cv.width = w * dpr
    cv.height = h * dpr
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    if (specs && specs.length) {
      const b = specsBounds(ctx, specs)
      if (b) {
        const box = { x: b.x - 12, y: b.y - 12, w: b.w + 24, h: b.h + 24 }
        const t = fitTransform(box, w, h)
        ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.tx, dpr * t.ty)
        paintSpecs(ctx, specs)
      }
    } else if (text) {
      ctx.fillStyle = '#888'
      ctx.font = '14px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText(text, w / 2, h / 2)
    }
  }, [specs, text])
  return <canvas ref={ref} className="km-preview" />
}

function ExplorerDialog({ app, done }: { app: MolApp; done: (v: unknown) => void }) {
  const catalog = useStore(app.store, (s) => s.catalog)!
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set([catalog.sections[0].title]))
  const [choice, setChoice] = useState<{ kind: string; value: string; name: string } | null>(null)
  const [preview, setPreview] = useState<{ specs: Spec[] | null; html: ReactNode; text: string }>({ specs: null, html: 'Select a compound to preview it.', text: '' })
  const q = search.trim().toLowerCase()

  useEffect(() => {
    if (!choice) {
      setPreview({ specs: null, html: 'Select a structure to preview it.', text: '' })
      return
    }
    let live = true
    void app.bridge.latest('preview', 'preview', choice).then((a) => {
      if (!live || a.superseded) return
      if (!a.ok) {
        setPreview({ specs: null, text: 'Preview unavailable', html: <><b>{choice.name}</b><br /><span className="km-error">{a.error}</span></> })
        return
      }
      const smi = a.smiles as string | null
      const extra = smi ? <><br />SMILES: <code>{smi}</code></> : choice.kind === 'reaction' ? <><br /><code>{choice.value}</code></> : null
      setPreview({
        specs: a.specs as Spec[],
        text: '',
        html: (
          <>
            <b>{choice.name}</b>
            {a.formula ? <> &nbsp; [{String(a.formula)}]</> : null}
            <br />
            {String(a.atoms)} atoms, {String(a.bonds)} bonds{extra}
          </>
        ),
      })
    })
    return () => {
      live = false
    }
  }, [choice, app])

  const match = (label: string, value: string) => !q || label.toLowerCase().includes(q) || value.toLowerCase().includes(q)
  return (
    <Frame title="Molecule Explorer" minWidth={780} wide onClose={() => done(null)} buttons={<Buttons ok="Build in 3D" okDisabled={!choice} onOk={() => choice && done(choice)} onCancel={() => done(null)} />}>
      <div className="km-explorer">
        <div className="km-exleft">
          <input className="k-input" placeholder="Search…  (name, formula or family)" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          <div className="km-tree km-extree">
            {catalog.sections.map((sec) => {
              const groups = sec.groups.map((g) => ({ g, rows: g.rows.filter((r) => match(r.label, r.value)) })).filter((x) => x.rows.length)
              if (!groups.length) return null
              const secOpen = q ? true : open.has(sec.title)
              return (
                <div key={sec.title}>
                  <div className="km-lrow head" onClick={() => setOpen(toggleSet(open, sec.title))}>
                    <span className="km-twisty">{secOpen ? '▾' : '▸'}</span>
                    <b>{sec.title}</b>
                  </div>
                  {secOpen &&
                    groups.map(({ g, rows }) => {
                      const gk = `${sec.title}/${g.title}`
                      const gOpen = q ? true : open.has(gk)
                      return (
                        <div key={gk}>
                          <div className="km-lrow group" onClick={() => setOpen(toggleSet(open, gk))}>
                            <span className="km-twisty">{gOpen ? '▾' : '▸'}</span>
                            {g.title}
                          </div>
                          {gOpen &&
                            rows.map((r, i) => (
                              <div
                                key={i}
                                className={`km-lrow leaf${choice && choice.kind === r.kind && choice.value === r.value ? ' sel' : ''}`}
                                title={r.smiles}
                                onClick={() => setChoice({ kind: r.kind, value: r.value, name: r.label })}
                                onDoubleClick={() => done({ kind: r.kind, value: r.value, name: r.label })}
                              >
                                {r.label}
                              </div>
                            ))}
                        </div>
                      )
                    })}
                </div>
              )
            })}
          </div>
        </div>
        <div className="km-exright">
          <SpecPreview specs={preview.specs} text={preview.text} />
          <div className="km-info">{preview.html}</div>
        </div>
      </div>
    </Frame>
  )
}

function toggleSet(s: Set<string>, k: string): Set<string> {
  const n = new Set(s)
  if (n.has(k)) n.delete(k)
  else n.add(k)
  return n
}

// ============================================================ Properties

function PropertiesDialog({ label, rows, done }: { label: string; rows: [string, string][]; done: (v: unknown) => void }) {
  return (
    <Frame title="Molecule properties" minWidth={460} onClose={() => done(null)} buttons={<button className="k-btn primary" onClick={() => done(null)}>Close</button>}>
      <div className="km-props-title">
        <b>{label}</b>
      </div>
      <div className="km-props">
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v], i) => (
              <tr key={i}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  )
}

// ====================================================== Stack unit cells

function StackDialog({ label, cells, done }: { label: string; cells: [number, number, number]; done: (v: unknown) => void }) {
  const [n, setN] = useState<[number, number, number]>([...cells])
  return (
    <Frame title={`Stack ${label}`} minWidth={380} onClose={() => done(null)} buttons={<Buttons ok="OK" onOk={() => done(n)} onCancel={() => done(null)} />}>
      <p className="km-text">Repeat the unit cell along each lattice vector. Shared corner and face atoms are drawn once.</p>
      <div className="km-row">
        {(['a', 'b', 'c'] as const).map((ax, i) => (
          <span key={ax} className="km-inline">
            <span className="km-label">{ax}:</span>
            <SpinBox value={n[i]} min={1} max={12} onCommit={(v) => setN(n.map((x, k) => (k === i ? v : x)) as [number, number, number])} />
          </span>
        ))}
      </div>
    </Frame>
  )
}

// ======================================================= Export 3D model

const STYLE_TEXT: Record<string, string> = { ball_and_stick: 'Ball and stick', space_filling: 'Space filling', sticks: 'Sticks' }

function MeshDialog({ app, style, done }: { app: MolApp; style: string; done: (v: unknown) => void }) {
  const catalog = useStore(app.store, (s) => s.catalog)!
  const mol = app.get().mol
  const [fmt, setFmt] = useState(catalog.meshFormats[0][0])
  const [st, setSt] = useState(catalog.meshStyles.includes(style) ? style : catalog.meshStyles[0])
  const [scale, setScale] = useState(10)
  const [quality, setQuality] = useState('medium')
  const [stick, setStick] = useState(1.6)
  const [cell, setCell] = useState(!!mol.edges && mol.cell_visible)
  const [ascii, setAscii] = useState(false)
  const ext = useSummary(app, 'mesh_extent', 'mesh_extent', { style: st, scale }, { size: [0, 0, 0], atoms: mol.atoms.length } as { size: number[]; atoms: number })
  const ok = () => done({ fmt, options: { style: st, scale, quality, cell, min_stick_mm: stick, ascii: fmt === 'stl' && ascii } })
  return (
    <Frame title="Export 3D model" minWidth={480} onClose={() => done(null)} buttons={<Buttons ok="Export…" onOk={ok} onCancel={() => done(null)} />}>
      <div className="km-form">
        <Row label="Format">
          <select className="km-combo km-wide" value={fmt} onChange={(e) => setFmt(e.target.value)}>
            {catalog.meshFormats.map(([k, n, t]) => (
              <option key={k} value={k}>
                {n} — {t}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Style">
          <select className="km-combo" value={st} onChange={(e) => setSt(e.target.value)}>
            {catalog.meshStyles.map((k) => (
              <option key={k} value={k}>
                {STYLE_TEXT[k] ?? k}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Size">
          <Num value={scale} min={0.05} max={1000} step={1} decimals={2} suffix=" mm per Å" title="Size of the model: a C–C bond is 1.5 Å, so 10 mm/Å prints it 15 mm long" onChange={setScale} />
        </Row>
        <Row>
          <span className="km-hint">
            About {ext.size.map((v) => Math.round(v)).join(' × ')} mm ({ext.atoms} atoms)
          </span>
        </Row>
        <Row label="Quality">
          <select className="km-combo" value={quality} onChange={(e) => setQuality(e.target.value)}>
            <option value="low">Low (small file)</option>
            <option value="medium">Medium</option>
            <option value="high">High (smooth spheres)</option>
          </select>
        </Row>
        <Row label="Thinnest bond">
          <Num value={stick} min={0.2} max={10} step={0.1} decimals={2} suffix=" mm" title="The thinnest bond, so a print is not made of threads" onChange={setStick} />
        </Row>
        <Row>
          <label className="km-check">
            <input type="checkbox" disabled={!mol.edges} checked={cell} onChange={(e) => setCell(e.target.checked)} /> Include the unit-cell outline
          </label>
        </Row>
        <Row>
          <label className="km-check">
            <input type="checkbox" disabled={fmt !== 'stl'} checked={ascii} onChange={(e) => setAscii(e.target.checked)} /> Write the STL as text (bigger, human-readable)
          </label>
        </Row>
      </div>
      <p className="km-hint">Spheres and bonds overlap where they meet — slicers and viewers merge them. Coordinates are in millimetres, z up, standing on z = 0.</p>
    </Frame>
  )
}

// ================================================================== Help

function GuideDialog({ app, done }: { app: MolApp; done: (v: unknown) => void }) {
  const catalog = useStore(app.store, (s) => s.catalog)
  return (
    <Frame title="kMol — User Guide" minWidth={620} wide onClose={() => done(null)} buttons={<button className="k-btn primary" onClick={() => done(null)}>Close</button>}>
      <div className="km-guide" dangerouslySetInnerHTML={{ __html: catalog?.guide ?? '' }} />
    </Frame>
  )
}

function AboutDialog({ app, done }: { app: MolApp; done: (v: unknown) => void }) {
  const version = useStore(app.store, (s) => s.version)
  return (
    <Frame title="About kMol" minWidth={440} onClose={() => done(null)} buttons={<button className="k-btn primary" onClick={() => done(null)}>OK</button>}>
      <div className="km-about">
        <KMolMark size={72} />
        <div>
          <h2>kMol</h2>
          <p>Version {version}</p>
          <p>Draw chemical compounds and crystal structures in 2D and 3D — a native app in the Kherve family.</p>
          <p>© 2026 Gwilherm Kerherve — GPL-3.0</p>
        </div>
      </div>
    </Frame>
  )
}

// ========================================================= AI settings

function AiSettingsDialog({ app, done }: { app: MolApp; done: (v: unknown) => void }) {
  const catalog = useStore(app.store, (s) => s.catalog)!
  const ai = catalog.ai
  const [st, setSt] = useState<AiSettings>(() => loadAiSettings())
  const provider = st.provider
  const [models, setModels] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const list = useMemo(() => models ?? ai.models[provider] ?? [], [models, ai, provider])
  const set = (patch: Partial<AiSettings>) => setSt({ ...st, ...patch })
  const key = st.keys[provider] ?? ''
  const base = st.bases[provider] ?? ''
  const model = st.models[provider] ?? ''
  const showBase = provider === 'Local' || provider === 'Ollama'
  return (
    <Frame
      title="AI Chat Settings"
      minWidth={440}
      onClose={() => done(null)}
      buttons={
        <Buttons
          ok="OK"
          onOk={() => {
            saveAiSettings(st)
            done(true)
          }}
          onCancel={() => done(null)}
        />
      }
    >
      <div className="km-form">
        <Row label="Provider:">
          <select
            className="km-combo km-wide"
            value={provider}
            onChange={(e) => {
              setModels(null)
              set({ provider: e.target.value })
            }}
          >
            {ai.providers.map((p) => (
              <option key={p} value={p}>
                {ai.names[p] ?? p}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Model:">
          <input className="k-input km-grow" list="km-models" value={model} onChange={(e) => set({ models: { ...st.models, [provider]: e.target.value } })} />
          <datalist id="km-models">
            {list.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button
            className="k-icon-btn"
            title="Refresh the model list from the provider"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void fetchModels(provider, key, base || ai.bases[provider] || '')
                .then((ms) => {
                  if (!ms.length) {
                    void os.dialog.alert('No models returned.', { title: 'AI Chat' })
                    return
                  }
                  setModels(ms)
                  if (ms.length && !ms.includes(model)) set({ models: { ...st.models, [provider]: ms[0] } })
                })
                .catch((e: unknown) => void os.dialog.alert(`Could not list models:\n${e instanceof Error ? e.message : String(e)}`, { title: 'AI Chat' }))
                .finally(() => setBusy(false))
            }}
          >
            <Mdi path={mdiRefresh} size={16} />
          </button>
        </Row>
        <Row label="API Key:">
          <input className="k-input" type="password" disabled={!ai.needsKey.includes(provider)} value={key} onChange={(e) => set({ keys: { ...st.keys, [provider]: e.target.value } })} />
        </Row>
        {showBase && (
          <Row label="Base URL:">
            <input className="k-input" value={base} placeholder={ai.bases[provider]} onChange={(e) => set({ bases: { ...st.bases, [provider]: e.target.value } })} />
          </Row>
        )}
      </div>
      <fieldset className="km-group">
        <legend>How to get an API key</legend>
        <div className="km-pre">{ai.help[provider] ?? ''}</div>
      </fieldset>
    </Frame>
  )
}

// ================================================================= host

export function Dialogs({ app }: { app: MolApp }) {
  const d = useStore(app.store, (s) => s.dialog)
  const catalog = useStore(app.store, (s) => s.catalog)
  if (!d) return null
  const done = (v: unknown) => app.closeDialog(v)
  const p = d.props
  if (!catalog && d.kind !== 'about' && d.kind !== 'properties' && d.kind !== 'stack') return null
  switch (d.kind) {
    case 'crystal':
      return <CrystalDialog app={app} done={done} />
    case 'surface':
      return <SurfaceDialog app={app} done={done} drawn={(p.drawn as Mol | null) ?? null} />
    case 'addmol':
      return <AddMoleculeDialog app={app} done={done} drawn={(p.drawn as Mol | null) ?? null} crowded={!!p.crowded} />
    case 'nano':
      return <NanoDialog app={app} done={done} />
    case 'polymer':
      return <PolymerDialog app={app} done={done} />
    case 'reaction':
      return <ReactionDialog app={app} done={done} />
    case 'explorer':
      return <ExplorerDialog app={app} done={done} />
    case 'properties':
      return <PropertiesDialog label={String(p.label ?? '')} rows={(p.rows as [string, string][]) ?? []} done={done} />
    case 'stack':
      return <StackDialog label={String(p.label ?? '')} cells={p.cells as [number, number, number]} done={done} />
    case 'mesh':
      return <MeshDialog app={app} style={String(p.style ?? 'ball_and_stick')} done={done} />
    case 'guide':
      return <GuideDialog app={app} done={done} />
    case 'about':
      return <AboutDialog app={app} done={done} />
    case 'aisettings':
      return <AiSettingsDialog app={app} done={done} />
  }
}
