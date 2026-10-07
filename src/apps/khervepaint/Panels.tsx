// The side panel: Properties (the desktop's PropertiesDialog, live) and the
// Library (the symbol palettes and the user's saved objects, with previews).

import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FolderOpen, Plus, Search } from 'lucide-react'
import { os, fs, useFsVersion } from '@/os'
import type { Brush, DashStyle, Doc, Item, LineItem, Pen, ShapeItem } from './model'
import { DEFAULT_FONT, describe, hasBrush, hasLabel, hasPen, isNoPen, NO_PEN_COLOR } from './model'
import { boundsIn, rectOf } from './geom'
import { headsOf, keepPlace, mapDeep, posOf, reverseLine, rotationOf, setHeads, setRotation, translateItem, ungroupItems, type Heads } from './ops'
import { ColorButton, NumberField } from './ui'
import { ItemView } from './Canvas'
import type { PaintStore } from './store'
import { PALETTES, paletteById } from './palettes'
import { buildSymbol } from './spec'
import { deleteObject, LIBRARY_DIR, listObjects, loadObject, renameObject, type LibraryObject } from './library'

export const FONTS = [DEFAULT_FONT, 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana', 'Calibri', 'Cambria', 'Consolas']

const DASHES: [DashStyle, string][] = [['solid', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted'], ['dashdot', 'Dash-dot']]

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="kp-row">
      <span className="kp-row-label">{label}</span>
      <span className="kp-row-field">{children}</span>
    </label>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="kp-section">
      <h4>{title}</h4>
      {children}
    </section>
  )
}

/** Every item inside (groups opened up), for styling a selection. */
const leaves = (items: Item[]): Item[] => items.flatMap((it) => (it.type === 'group' ? leaves(it.children) : [it]))

// ------------------------------------------------------------ properties

export function Inspector({ store, onDrawingSize }: { store: PaintStore; onDrawingSize(): void }) {
  const sel = store.selected
  const it = sel.length === 1 ? sel[0] : null

  const commit = (fn: (it: Item) => Item, ids = new Set(store.sel)) => {
    const items = store.doc.items.map((x) => (ids.has(x._id) ? fn(x) : x))
    store.commit({ ...store.doc, items })
  }
  const styleAll = (fn: (leaf: Item) => Item) => commit((x) => mapDeep(x, fn))

  if (!sel.length) return <DocumentPanel store={store} onDrawingSize={onDrawingSize} />

  const all = leaves(sel)
  const penItems = all.filter(hasPen)
  const brushItems = all.filter(hasBrush)
  const firstPen = penItems[0]?.pen
  const firstBrush = brushItems.find((b) => b.brush)?.brush ?? null

  const setPen = (patch: Partial<Pen> | 'none') =>
    styleAll((x) => {
      if (!hasPen(x)) return x
      let pen: Pen
      if (patch === 'none') pen = { ...x.pen, color: NO_PEN_COLOR }
      else {
        pen = { ...x.pen, ...patch }
        // A colour given to an item without a stroke also gives it a visible width.
        if (patch.color !== undefined && isNoPen(x.pen) && !x.pen.width) pen.width = 2
      }
      if (pen.dash === 'solid') delete pen.dash
      return keepPlace(x, { ...x, pen } as Item)
    })
  const setBrush = (b: Brush) => styleAll((x) => (hasBrush(x) ? ({ ...x, brush: b } as Item) : x))

  return (
    <div className="kp-inspector">
      <div className="kp-inspector-title">
        {it ? describe(it) : `${sel.length} items`}
        {it?.type === 'group' && <span className="k-muted"> · {it.children.length} parts</span>}
      </div>

      {it && <PlacementSection store={store} it={it} />}

      {sel.length > 1 && (
        <Section title="Layer">
          <Row label="Opacity">
            <NumberField value={Math.round((sel[0].opacity ?? 1) * 100)} min={0} max={100} digits={0} suffix="%" onChange={(v) => commit((x) => ({ ...x, opacity: v / 100 }))} />
          </Row>
        </Section>
      )}

      {firstPen && (
        <Section title="Stroke">
          <Row label="Colour">
            <ColorButton
              color={isNoPen(firstPen) ? '#ff000000' : firstPen.color}
              none={isNoPen(firstPen)}
              allowNone
              onNone={() => setPen('none')}
              onChange={(c) => setPen({ color: c })}
            />
          </Row>
          <Row label="Width">
            <NumberField value={firstPen.width} min={0} step={0.5} onChange={(w) => setPen({ width: w })} suffix="px" />
          </Row>
          {!(it?.type === 'dimension') && (
            <Row label="Dash">
              <select className="k-input kp-select" value={firstPen.dash ?? 'solid'} onChange={(e) => setPen({ dash: e.target.value as DashStyle })}>
                {DASHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Row>
          )}
        </Section>
      )}

      {brushItems.length > 0 && <FillSection brush={firstBrush} onChange={setBrush} />}

      {it && (it.type === 'line' || it.type === 'arrow') && <LineSection store={store} it={it} commit={commit} />}
      {it?.type === 'dimension' && <DimensionSection it={it} commit={commit} />}
      {it && (it.type === 'rect' || it.type === 'ellipse' || it.type === 'roundrect' || it.type === 'arc') && <BoxSection it={it} commit={commit} />}
      {it?.type === 'text' && <TextSection it={it} commit={commit} />}
      {it && hasLabel(it) && <LabelSection it={it} commit={commit} />}
      {it?.type === 'group' && (
        <Section title="Group">
          <div className="kp-inspector-actions">
            <button className="k-btn small" onClick={() => {
              const { doc, freed } = ungroupItems(store.doc, new Set([it._id]))
              store.commit(doc, freed)
            }}>Ungroup</button>
          </div>
          <p className="k-muted kp-note">Double-click a text inside the group to edit it.</p>
        </Section>
      )}
      {it?.type === 'image' && (
        <Section title="Picture">
          <Row label="Pixels">
            <span className="k-muted">{it.iw} × {it.ih}</span>
          </Row>
        </Section>
      )}
    </div>
  )
}

function PlacementSection({ store, it }: { store: PaintStore; it: Item }) {
  const b = boundsIn(it)
  const commitOne = (fn: (x: Item) => Item) => store.commit({ ...store.doc, items: store.doc.items.map((x) => (x._id === it._id ? fn(x) : x)) })
  if (!b) return null
  const pos = posOf(it)
  return (
    <Section title="Placement">
      <div className="kp-grid2">
        <Row label="X">
          <NumberField value={b.x} onChange={(v) => commitOne((x) => translateItem(x, v - b.x, 0))} />
        </Row>
        <Row label="Y">
          <NumberField value={b.y} onChange={(v) => commitOne((x) => translateItem(x, 0, v - b.y))} />
        </Row>
        <Row label="W">
          <span className="kp-readout">{b.w.toFixed(1)}</span>
        </Row>
        <Row label="H">
          <span className="kp-readout">{b.h.toFixed(1)}</span>
        </Row>
        <Row label="Turn">
          <NumberField value={rotationOf(it)} digits={1} suffix="°" onChange={(v) => commitOne((x) => setRotation(x, v))} />
        </Row>
        <Row label="Opacity">
          <NumberField value={Math.round(it.opacity * 100)} min={0} max={100} digits={0} suffix="%" onChange={(v) => commitOne((x) => ({ ...x, opacity: v / 100 }))} />
        </Row>
      </div>
      {it.type !== 'image' && (it.scale !== 1 || pos.x || pos.y) ? (
        <div className="k-muted kp-note">
          {it.scale !== 1 ? `Scaled ×${+it.scale.toFixed(3)} · ` : ''}offset {+pos.x.toFixed(1)}, {+pos.y.toFixed(1)}
        </div>
      ) : null}
    </Section>
  )
}

function FillSection({ brush, onChange }: { brush: Brush; onChange(b: Brush): void }) {
  const style = !brush ? 'none' : 'gradient' in brush ? brush.gradient.kind : 'solid'
  const c1 = !brush ? '#ff4aa3ff' : 'gradient' in brush ? brush.gradient.c1 : brush.color
  const c2 = brush && 'gradient' in brush ? brush.gradient.c2 : '#ffffffff'
  const angle = brush && 'gradient' in brush ? brush.gradient.angle : 90
  const make = (s: string, a = c1, b = c2, ang = angle): Brush =>
    s === 'none' ? null : s === 'solid' ? { color: a } : { gradient: { kind: s as 'linear', c1: a, c2: b, angle: ang } }
  return (
    <Section title="Fill">
      <Row label="Style">
        <select className="k-input kp-select" value={style} onChange={(e) => onChange(make(e.target.value))}>
          <option value="none">None</option>
          <option value="solid">Solid</option>
          <option value="linear">Linear gradient</option>
          <option value="radial">Radial gradient</option>
          <option value="sun">Sun (lit sphere)</option>
        </select>
      </Row>
      {style !== 'none' && (
        <Row label={style === 'solid' ? 'Colour' : 'Colours'}>
          <ColorButton color={c1} onChange={(c) => onChange(make(style, c))} />
          {style !== 'solid' && <ColorButton color={c2} onChange={(c) => onChange(make(style, c1, c))} title="End colour" />}
        </Row>
      )}
      {style === 'linear' && (
        <Row label="Angle">
          <NumberField value={angle} digits={1} suffix="°" onChange={(v) => onChange(make(style, c1, c2, v))} />
        </Row>
      )}
    </Section>
  )
}

function LineSection({ it, commit }: { store: PaintStore; it: LineItem; commit(fn: (x: Item) => Item): void }) {
  const set = (patch: Partial<LineItem>) => commit((x) => keepPlace(x, { ...(x as LineItem), ...patch }))
  return (
    <Section title="Line">
      <Row label="Heads">
        <select className="k-input kp-select" value={headsOf(it)} onChange={(e) => commit((x) => setHeads(x as LineItem, e.target.value as Heads))}>
          <option value="none">None</option>
          <option value="end">Arrow at the end</option>
          <option value="both">Arrows at both ends</option>
        </select>
      </Row>
      <div className="kp-grid2">
        <Row label="X1"><NumberField value={it.x1} onChange={(v) => set({ x1: v })} /></Row>
        <Row label="Y1"><NumberField value={it.y1} onChange={(v) => set({ y1: v })} /></Row>
        <Row label="X2"><NumberField value={it.x2} onChange={(v) => set({ x2: v })} /></Row>
        <Row label="Y2"><NumberField value={it.y2} onChange={(v) => set({ y2: v })} /></Row>
      </div>
      <div className="kp-inspector-actions">
        <button className="k-btn small" onClick={() => commit((x) => reverseLine(x as LineItem))}>Reverse</button>
        {it.bend && (
          <button className="k-btn small" onClick={() => commit((x) => { const n = { ...(x as LineItem) }; delete n.bend; return keepPlace(x, n) })}>
            Straighten
          </button>
        )}
      </div>
    </Section>
  )
}

function DimensionSection({ it, commit }: { it: Extract<Item, { type: 'dimension' }>; commit(fn: (x: Item) => Item): void }) {
  const set = (patch: Partial<typeof it>) => commit((x) => ({ ...(x as typeof it), ...patch }))
  return (
    <Section title="Dimension">
      <Row label="End caps">
        <select className="k-input kp-select" value={it.capStyle} onChange={(e) => set({ capStyle: e.target.value as typeof it.capStyle })}>
          <option value="arrows">Arrows</option>
          <option value="ticks">Ticks</option>
          <option value="dots">Dots</option>
          <option value="none">Plain</option>
        </select>
      </Row>
      <Row label="Unit">
        <select className="k-input kp-select" value={it.unit} onChange={(e) => set({ unit: e.target.value as typeof it.unit })}>
          <option value="mm">mm</option>
          <option value="cm">cm</option>
          <option value="in">in</option>
        </select>
      </Row>
      <Row label="Decimals"><NumberField value={it.decimals} min={0} max={6} digits={0} onChange={(v) => set({ decimals: Math.round(v) })} /></Row>
      <Row label="Prefix"><input className="k-input" value={it.prefix} onChange={(e) => set({ prefix: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></Row>
      <Row label="Suffix"><input className="k-input" value={it.suffix} onChange={(e) => set({ suffix: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></Row>
      <label className="kp-tick"><input type="checkbox" checked={it.extension} onChange={(e) => set({ extension: e.target.checked })} /> Extension lines</label>
      <label className="kp-tick"><input type="checkbox" checked={it.dash} onChange={(e) => set({ dash: e.target.checked })} /> Dashed</label>
    </Section>
  )
}

function BoxSection({ it, commit }: { it: Extract<Item, { type: 'rect' | 'ellipse' | 'roundrect' | 'arc' }>; commit(fn: (x: Item) => Item): void }) {
  const set = (patch: Partial<typeof it>) => commit((x) => keepPlace(x, { ...(x as typeof it), ...patch } as Item))
  return (
    <Section title="Shape">
      <div className="kp-grid2">
        <Row label="X"><NumberField value={it.x} onChange={(v) => set({ x: v })} /></Row>
        <Row label="Y"><NumberField value={it.y} onChange={(v) => set({ y: v })} /></Row>
        <Row label="W"><NumberField value={it.w} min={0} onChange={(v) => set({ w: v })} /></Row>
        <Row label="H"><NumberField value={it.h} min={0} onChange={(v) => set({ h: v })} /></Row>
      </div>
      {it.type === 'roundrect' && (
        <Row label="Corners"><NumberField value={it.radius} min={0} onChange={(v) => set({ radius: v } as Partial<typeof it>)} suffix="px" /></Row>
      )}
      {it.type === 'arc' && (
        <>
          <Row label="Kind">
            <select className="k-input kp-select" value={it.kind} onChange={(e) => set({ kind: e.target.value } as Partial<typeof it>)}>
              <option value="halfcircle">Half circle</option>
              <option value="quartercircle">Quarter circle</option>
            </select>
          </Row>
          <label className="kp-tick"><input type="checkbox" checked={it.flipH} onChange={(e) => set({ flipH: e.target.checked } as Partial<typeof it>)} /> Flipped horizontally</label>
          <label className="kp-tick"><input type="checkbox" checked={it.flipV} onChange={(e) => set({ flipV: e.target.checked } as Partial<typeof it>)} /> Flipped vertically</label>
        </>
      )}
    </Section>
  )
}

function FontRows({ family, size, bold, italic, color, onChange }: {
  family: string; size: number; bold: boolean; italic: boolean; color: string
  onChange(p: { family?: string; size?: number; bold?: boolean; italic?: boolean; color?: string }): void
}) {
  return (
    <>
      <Row label="Font">
        <select className="k-input kp-select" value={FONTS.includes(family) ? family : '__other'} onChange={(e) => e.target.value !== '__other' && onChange({ family: e.target.value })}>
          {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          {!FONTS.includes(family) && <option value="__other">{family}</option>}
        </select>
      </Row>
      <Row label="Size">
        <NumberField value={size} min={1} max={400} digits={0} suffix="pt" onChange={(v) => onChange({ size: Math.round(v) })} />
        <button type="button" className={`k-icon-btn kp-mini${bold ? ' active' : ''}`} title="Bold" onClick={() => onChange({ bold: !bold })}><b>B</b></button>
        <button type="button" className={`k-icon-btn kp-mini${italic ? ' active' : ''}`} title="Italic" onClick={() => onChange({ italic: !italic })}><i>I</i></button>
      </Row>
      <Row label="Colour"><ColorButton color={color} onChange={(c) => onChange({ color: c })} /></Row>
    </>
  )
}

function TextSection({ it, commit }: { it: Extract<Item, { type: 'text' }>; commit(fn: (x: Item) => Item): void }) {
  const set = (patch: Partial<typeof it>) => commit((x) => keepPlace(x, { ...(x as typeof it), ...patch }))
  const [text, setText] = useState(it.text)
  useEffect(() => setText(it.text), [it.text])
  return (
    <Section title="Text">
      <textarea
        className="k-input kp-textarea"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== it.text && set({ text })}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) set({ text })
        }}
      />
      <FontRows family={it.family} size={it.size} bold={it.bold} italic={it.italic} color={it.color} onChange={(p) => set(p)} />
    </Section>
  )
}

function LabelSection({ it, commit }: { it: ShapeItem; commit(fn: (x: Item) => Item): void }) {
  const set = (patch: Partial<ShapeItem>) => commit((x) => ({ ...(x as ShapeItem), ...patch } as Item))
  const [text, setText] = useState(it.label ?? '')
  useEffect(() => setText(it.label ?? ''), [it.label])
  return (
    <Section title="Label">
      <input
        className="k-input"
        value={text}
        placeholder="Text inside the shape"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== (it.label ?? '') && set({ label: text })}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') set({ label: text })
        }}
      />
      {it.label && (
        <FontRows
          family={it.labelFamily ?? DEFAULT_FONT}
          size={it.labelSize ?? 14}
          bold={!!it.labelBold}
          italic={!!it.labelItalic}
          color={it.labelColor ?? '#ff1a1a1a'}
          onChange={(p) => set({
            ...(p.family !== undefined ? { labelFamily: p.family } : {}),
            ...(p.size !== undefined ? { labelSize: p.size } : {}),
            ...(p.bold !== undefined ? { labelBold: p.bold } : {}),
            ...(p.italic !== undefined ? { labelItalic: p.italic } : {}),
            ...(p.color !== undefined ? { labelColor: p.color } : {}),
          })}
        />
      )}
    </Section>
  )
}

function DocumentPanel({ store, onDrawingSize }: { store: PaintStore; onDrawingSize(): void }) {
  const d = store.doc
  const setGrid = (patch: Partial<Doc['grid']>) => store.commit({ ...store.doc, grid: { ...store.doc.grid, ...patch } })
  const mm = (px: number) => ((px / d.dpi) * 25.4).toFixed(1)
  return (
    <div className="kp-inspector">
      <div className="kp-inspector-title">Drawing</div>
      <Section title="Page">
        <Row label="Size"><span className="kp-readout">{d.width} × {d.height} px</span></Row>
        <Row label=""><span className="kp-readout">{mm(d.width)} × {mm(d.height)} mm at {d.dpi} dpi</span></Row>
        <div className="kp-inspector-actions">
          <button className="k-btn small" onClick={onDrawingSize}>Drawing size…</button>
        </div>
      </Section>
      <Section title="Grid">
        <Row label="Spacing"><NumberField value={d.grid.mm} min={0.01} step={0.5} suffix="mm" onChange={(v) => setGrid({ mm: v })} /></Row>
        <label className="kp-tick"><input type="checkbox" checked={d.grid.show} onChange={(e) => setGrid({ show: e.target.checked })} /> Show grid</label>
        <label className="kp-tick"><input type="checkbox" checked={d.grid.snap} onChange={(e) => setGrid({ snap: e.target.checked })} /> Snap to grid</label>
        <label className="kp-tick"><input type="checkbox" checked={d.grid.infinite} onChange={(e) => setGrid({ infinite: e.target.checked })} /> Infinite paper</label>
      </Section>
      <p className="k-muted kp-note">{d.items.length} item{d.items.length === 1 ? '' : 's'}. Select something to edit its properties.</p>
    </div>
  )
}

// --------------------------------------------------------------- library

const thumbCache = new Map<string, Item | null>()

function symbolItem(key: string): Item | null {
  if (thumbCache.has(key)) return thumbCache.get(key)!
  const [pid, name] = key.split(':')
  const p = paletteById(pid)
  // Built on a page as wide as the palette's reference: symbols come out at their real proportions.
  const it = p ? buildSymbol(p, name, { x: 0, y: 0 }, p.reference) : null
  thumbCache.set(key, it)
  return it
}

export const Thumb = memo(function Thumb({ items, size = 44 }: { items: Item[]; size?: number }) {
  let r = null as ReturnType<typeof boundsIn>
  for (const it of items) {
    const b = boundsIn(it)
    if (b) r = r ? { x: Math.min(r.x, b.x), y: Math.min(r.y, b.y), w: Math.max(r.x + r.w, b.x + b.w) - Math.min(r.x, b.x), h: Math.max(r.y + r.h, b.y + b.h) - Math.min(r.y, b.y) } : b
  }
  const v = r ?? rectOf(0, 0, 1, 1)
  const pad = Math.max(v.w, v.h) * 0.06 + 0.5
  return (
    <svg className="kp-preview" width={size} height={size} viewBox={`${v.x - pad} ${v.y - pad} ${v.w + 2 * pad} ${v.h + 2 * pad}`}>
      {items.map((it) => <ItemView key={it._id} item={it} prefix="kpthumb-" dpi={96} />)}
    </svg>
  )
})

function ObjectThumb({ obj }: { obj: LibraryObject }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const st = fs.stat(obj.path)
  useEffect(() => {
    let alive = true
    loadObject(obj.path).then((x) => alive && setItems(x), () => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [obj.path, st?.mtime])
  return items ? <Thumb items={items} /> : <span className="kp-preview" />
}

export function LibraryPanel({ store, onInsertObject, onSaveObject }: {
  store: PaintStore
  onInsertObject(path: string): void
  onSaveObject(): void
}) {
  useFsVersion()
  const [pid, setPid] = useState(() => localStorage.getItem('khervepaint.palette') ?? 'flowchart')
  const [query, setQuery] = useState('')
  const choose = (id: string) => {
    setPid(id)
    try {
      localStorage.setItem('khervepaint.palette', id)
    } catch {
      // private mode
    }
  }
  const palette = paletteById(pid)
  const objects = pid === 'objects' ? listObjects() : []
  const q = query.trim().toLowerCase()
  const armed = store.settings.tool === 'place' ? store.settings.place : null

  const sections = useMemo(() => {
    if (q) {
      // Search every palette.
      const hits: [string, string, string][] = []
      for (const p of PALETTES) for (const [name, label] of Object.entries(p.labels)) if (label.toLowerCase().includes(q)) hits.push([p.id, name, label])
      return [{ title: `${hits.length} match${hits.length === 1 ? '' : 'es'}`, entries: hits }]
    }
    if (!palette) return []
    return palette.categories.map(([title, names]) => ({ title, entries: names.map((n) => [palette.id, n, palette.labels[n] ?? n] as [string, string, string]) }))
  }, [q, palette])

  const arm = (key: string) => {
    store.set({ tool: 'place', place: key })
    store.say(`Click on the drawing to place “${symbolLabel(key)}”`)
  }

  return (
    <div className="kp-library">
      <div className="kp-library-bar">
        <select className="k-input kp-select" value={pid} onChange={(e) => choose(e.target.value)}>
          <option value="objects">My objects</option>
          {PALETTES.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </div>
      <div className="kp-search">
        <Search size={13} />
        <input className="k-input" placeholder="Search symbols" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="kp-library-list">
        {pid === 'objects' && !q ? (
          <>
            <div className="kp-inspector-actions">
              <button className="k-btn small" onClick={onSaveObject} disabled={!store.sel.length}><Plus size={13} /> Save selection…</button>
              <button className="k-btn small" title="Show the library folder in Files" onClick={async () => {
                await fs.mkdir(LIBRARY_DIR, { recursive: true })
                os.open('files', { path: LIBRARY_DIR })
              }}><FolderOpen size={13} /></button>
            </div>
            {!objects.length && <p className="k-muted kp-note">No saved objects yet. Select items and choose “Save selection…”: they are kept as SVG files in ~/Documents/KhervePaint Library.</p>}
            {groupByFolder(objects).map(([folder, list]) => (
              <div key={folder}>
                {folder && <div className="kp-library-cat">{folder}</div>}
                <div className="kp-tiles">
                  {list.map((o) => (
                    <div
                      key={o.path}
                      className="kp-tile"
                      title={`${o.name} — click to insert, drag onto the drawing`}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('application/x-khervepaint-symbol', `object:${o.path}`)}
                      onClick={() => onInsertObject(o.path)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        os.contextMenu(e, [
                          { label: 'Insert', onClick: () => onInsertObject(o.path) },
                          { label: 'Rename…', onClick: async () => {
                            const name = await os.dialog.prompt('New name for this object:', { title: 'Rename object', defaultValue: o.name })
                            if (name?.trim()) await renameObject(o.path, name)
                          } },
                          '-',
                          { label: 'Delete', danger: true, onClick: async () => {
                            if (await os.dialog.confirm(`Delete the object “${o.name}”?`, { title: 'Delete object', okLabel: 'Delete', danger: true })) await deleteObject(o.path)
                          } },
                        ])
                      }}
                    >
                      <ObjectThumb obj={o} />
                      <span className="kp-tile-label">{o.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
          {pid === 'floorplan' && !q && (
            <div className="kp-inspector-actions">
              <button
                className={`k-btn small${store.settings.tool === 'room' ? ' primary' : ''}`}
                title="Drag out a room on the drawing: solid walls with open corners"
                onClick={() => {
                  store.set({ tool: 'room' })
                  store.say('Drag out the room: it is drawn with solid walls and open corners')
                }}
              >
                Room — drag to size
              </button>
            </div>
          )}
          {sections.map((s) => (
            <div key={s.title}>
              <div className="kp-library-cat">{s.title}</div>
              <div className="kp-tiles">
                {s.entries.map(([p, name, label]) => {
                  const key = `${p}:${name}`
                  const item = symbolItem(key)
                  return (
                    <div
                      key={key}
                      className={`kp-tile${armed === key ? ' active' : ''}`}
                      title={`${label} — click, then click on the drawing; or drag it there`}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('application/x-khervepaint-symbol', key)}
                      onClick={() => arm(key)}
                    >
                      {item ? <Thumb items={[item]} /> : <span className="kp-preview" />}
                      <span className="kp-tile-label">{label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          </>
        )}
      </div>
    </div>
  )
}

function groupByFolder(objs: LibraryObject[]): [string, LibraryObject[]][] {
  const map = new Map<string, LibraryObject[]>()
  for (const o of objs) {
    const k = o.folder.join(' / ')
    map.set(k, [...(map.get(k) ?? []), o])
  }
  return [...map.entries()]
}

export function symbolLabel(key: string): string {
  const [pid, name] = key.split(':')
  return paletteById(pid)?.labels[name] ?? name
}

