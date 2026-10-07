// The tool column (left) and the options bar (top), after the desktop's
// tool toolbar and options toolbar. Shapes sit in four dropdown groups that
// remember the last shape picked.

import type { ReactNode } from 'react'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal,
  AlignStartVertical, AlignVerticalDistributeCenter, ArrowDownToLine, ArrowUpToLine, BringToFront, ChevronDown, Eraser, FlipHorizontal2, FlipVertical2,
  Grid3x3, Group, Hand, Hexagon, Library, Magnet, Maximize, MousePointer2, MoveUpRight, PaintBucket, Paintbrush, PanelRight, Pencil, Pipette, Redo2, Ruler,
  SendToBack, Slash, Trash2, Type, Undo2, Ungroup,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { os, type MenuItem } from '@/os'
import type { DashStyle } from './model'
import type { ChemTool, FillStyle, PaintStore, ShapeTool, Tool } from './store'
import { ATOMS } from './chemistry'
import { ColorButton, NumberField, ShapeIcon } from './ui'
import { FONTS } from './Panels'

export const SHAPE_GROUPS: { id: string; title: string; key?: string; shapes: [ShapeTool, string][] }[] = [
  { id: 'rects', title: 'Rectangles', shapes: [['rect', 'Rectangle'], ['roundrect', 'Rounded rectangle']] },
  { id: 'ellipses', title: 'Ellipses & arcs', shapes: [['circle', 'Circle'], ['ellipse', 'Ellipse'], ['halfcircle', 'Half circle'], ['quartercircle', 'Quarter circle']] },
  {
    id: 'polygons', title: 'Polygons', shapes: [
      ['triangle', 'Triangle'], ['right_triangle', 'Right triangle'], ['diamond', 'Diamond'], ['parallelogram', 'Parallelogram'],
      ['trapezoid', 'Trapezoid'], ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'], ['heptagon', 'Heptagon'], ['octagon', 'Octagon'],
    ],
  },
  {
    id: 'symbols', title: 'Stars & symbols', shapes: [
      ['star', 'Star (5-point)'], ['star6', 'Star (6-point)'], ['plus', 'Cross / plus'], ['chevron', 'Chevron'], ['arrow_right', 'Block arrow'],
      ['lightning', 'Lightning bolt'], ['house', 'House'],
    ],
  },
]

export const SHAPE_NAMES: Record<string, string> = Object.fromEntries(SHAPE_GROUPS.flatMap((g) => g.shapes))

export const CHEM_BONDS: [ChemTool, string][] = [
  ['chem_single', 'Single bond'], ['chem_chain', 'Chain (connected bonds)'], ['chem_double', 'Double bond'], ['chem_triple', 'Triple bond'],
  ['chem_wedge', 'Wedge (up)'], ['chem_hash', 'Hash (down)'], ['chem_hbond', 'Hydrogen bond (dashed)'],
]
export const CHEM_RINGS: [ChemTool, string][] = [['chem_benzene', 'Benzene (aromatic)'], ['chem_cyclohexane', 'Cyclohexane'], ['chem_cyclopentane', 'Cyclopentane']]

/** The Chemistry dropdown's entries (toolbar, Insert menu, canvas menu). */
export function chemMenu(store: PaintStore): MenuItem[] {
  const s = store.settings
  return [
    ...CHEM_BONDS.map(([t, label]) => ({ label, checked: s.tool === t, onClick: () => store.set({ tool: t }) })),
    '-',
    ...CHEM_RINGS.map(([t, label]) => ({ label, checked: s.tool === t, onClick: () => store.set({ tool: t }) })),
    '-',
    {
      label: 'Atom / group label',
      submenu: ATOMS.map((a) => ({ label: a, checked: s.tool === 'chem_atom' && s.chemAtom === a, onClick: () => store.set({ tool: 'chem_atom', chemAtom: a }) })),
    },
    '-',
    { label: 'Fixed bond length, 30° steps', checked: s.chemFixed, onClick: () => store.set({ chemFixed: !s.chemFixed }) },
  ]
}

/** Direct tools: (tool, icon, label, key). */
export const DIRECT_TOOLS: [Tool, LucideIcon, string, string][] = [
  ['pointer', MousePointer2, 'Pointer — select, move, resize, rotate', 'V'],
  ['hand', Hand, 'Hand — move the view (or hold Space)', 'H'],
  ['pencil', Pencil, 'Pencil — freehand vector stroke (paints on a picture’s pixels when started over one)', 'P'],
  ['brush', Paintbrush, 'Brush — paint into the raster layer', 'Y'],
  ['eraser', Eraser, 'Eraser — rub out the raster layer (to white); over a picture, to transparent', 'X'],
  ['picker', Pipette, 'Colour picker — click: stroke, Shift+click: fill', 'K'],
  ['bucket', PaintBucket, 'Bucket — fill an enclosed region', 'B'],
  ['line', Slash, 'Line', 'L'],
  ['arrow', MoveUpRight, 'Arrow', 'A'],
  ['dimension', Ruler, 'Dimension — measure and label a distance', 'M'],
  ['text', Type, 'Text — click to place, then type', 'T'],
]

export function ToolColumn({ store, onLibrary }: { store: PaintStore; onLibrary(): void }) {
  const s = store.settings
  const setTool = (tool: Tool) => store.set({ tool })
  return (
    <div className="kp-toolcol">
      {DIRECT_TOOLS.map(([tool, Icon, label, key]) => (
        <button
          key={tool}
          type="button"
          className={`k-icon-btn${s.tool === tool ? ' active' : ''}`}
          title={`${label} (${key})`}
          onClick={() => setTool(tool)}
        >
          <Icon size={17} />
        </button>
      ))}
      <div className="kp-toolcol-sep" />
      {SHAPE_GROUPS.map((g) => {
        const current = s.lastShape[g.id] ?? g.shapes[0][0]
        const active = g.shapes.some(([t]) => t === s.tool)
        const shown = active ? (s.tool as ShapeTool) : current
        const pick = (t: ShapeTool) => store.set({ tool: t, lastShape: { ...s.lastShape, [g.id]: t } })
        return (
          <button
            key={g.id}
            type="button"
            className={`k-icon-btn kp-drop${active ? ' active' : ''}`}
            title={`${g.title}: ${SHAPE_NAMES[shown]} (click the corner for more)`}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              if (e.clientX > r.right - 9 && e.clientY > r.bottom - 9) openShapes(e, g.shapes, pick)
              else pick(shown)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              openShapes(e, g.shapes, pick)
            }}
          >
            <ShapeIcon kind={shown} size={17} />
            <span className="kp-drop-mark" />
          </button>
        )
      })}
      <button
        type="button"
        className={`k-icon-btn kp-drop${s.tool.startsWith('chem_') ? ' active' : ''}`}
        title="Chemistry: bonds, chains, rings, atom labels"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          os.contextMenu({ clientX: r.right + 2, clientY: r.top }, chemMenu(store))
        }}
      >
        <Hexagon size={17} />
        <span className="kp-drop-mark" />
      </button>
      <div className="kp-toolcol-sep" />
      <button type="button" className={`k-icon-btn${s.tool === 'place' ? ' active' : ''}`} title="Symbol library" onClick={onLibrary}>
        <Library size={17} />
      </button>
    </div>
  )
}

function openShapes(e: React.MouseEvent, shapes: [ShapeTool, string][], pick: (t: ShapeTool) => void) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const items: MenuItem[] = shapes.map(([t, label]) => ({ label, onClick: () => pick(t) }))
  os.contextMenu({ clientX: r.right + 2, clientY: r.top }, items)
}

const WIDTHS = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24]

function Btn({ icon: Icon, title, onClick, active, disabled }: { icon: LucideIcon; title: string; onClick(): void; active?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`k-icon-btn${active ? ' active' : ''}`} title={title} onClick={onClick} disabled={disabled}>
      <Icon size={16} />
    </button>
  )
}

export interface BarActions {
  undo(): void
  redo(): void
  group(): void
  ungroup(): void
  flip(h: boolean): void
  order(where: 'front' | 'forward' | 'backward' | 'back'): void
  align(how: string): void
  remove(): void
  fit(): void
  /** Apply stroke/fill settings to the selection too. */
  applyStroke(patch: { color?: string; width?: number; dash?: DashStyle }): void
  applyFill(): void
  togglePanel(): void
}

export function OptionsBar({ store, actions, panelOpen }: { store: PaintStore; actions: BarActions; panelOpen: boolean }) {
  const s = store.settings
  const d = store.doc
  const hasSel = store.sel.length > 0
  const setGrid = (patch: Partial<typeof d.grid>) => store.commit({ ...store.doc, grid: { ...store.doc.grid, ...patch } })
  const fillPatch = (p: Partial<{ fillOn: boolean; fill: string; fill2: string; fillStyle: FillStyle; fillAngle: number }>) => {
    store.set(p)
    if (hasSel) actions.applyFill()
  }
  let extra: ReactNode = null
  if (s.tool === 'text') {
    extra = (
      <>
        <select className="k-input kp-select" value={s.fontFamily} onChange={(e) => store.set({ fontFamily: e.target.value })} title="Font of new text">
          {FONTS.map((f) => <option key={f}>{f}</option>)}
        </select>
        <NumberField value={s.fontSize} min={1} max={400} digits={0} width={44} suffix="pt" onChange={(v) => store.set({ fontSize: Math.round(v) })} title="Size of new text" />
        <button type="button" className={`k-icon-btn kp-mini${s.bold ? ' active' : ''}`} onClick={() => store.set({ bold: !s.bold })} title="Bold"><b>B</b></button>
        <button type="button" className={`k-icon-btn kp-mini${s.italic ? ' active' : ''}`} onClick={() => store.set({ italic: !s.italic })} title="Italic"><i>I</i></button>
      </>
    )
  } else if (s.tool === 'bucket') {
    extra = (
      <select className="k-input kp-select" value={s.bucketVector ? 'vector' : 'raster'} onChange={(e) => store.set({ bucketVector: e.target.value === 'vector' })} title="Where a fill goes">
        <option value="vector">Bucket: Vector (editable)</option>
        <option value="raster">Bucket: Raster</option>
      </select>
    )
  } else if (s.tool.startsWith('chem_')) {
    extra = (
      <>
        {s.tool === 'chem_atom' && (
          <select className="k-input kp-select" value={s.chemAtom} title="Atom or group placed by the atom tool" onChange={(e) => store.set({ chemAtom: e.target.value })}>
            {ATOMS.map((a) => <option key={a}>{a}</option>)}
          </select>
        )}
        <label className="kp-tick kp-inline" title="Bonds at a fixed length, on 30° steps">
          <input type="checkbox" checked={s.chemFixed} onChange={(e) => store.set({ chemFixed: e.target.checked })} /> Fixed
        </label>
        <NumberField value={s.bondLengthMm} min={0.5} max={100} step={0.5} width={44} suffix="mm" title="Bond length" onChange={(v) => store.set({ bondLengthMm: v })} />
      </>
    )
  } else if (s.tool === 'dimension') {
    extra = (
      <>
        <select className="k-input kp-select" value={s.dimOrient} onChange={(e) => store.set({ dimOrient: e.target.value as typeof s.dimOrient })} title="Ruler orientation">
          <option value="aligned">Aligned (free angle)</option>
          <option value="horizontal">Horizontal (Δx)</option>
          <option value="vertical">Vertical (Δy)</option>
        </select>
        <select className="k-input kp-select" value={s.dimCap} onChange={(e) => store.set({ dimCap: e.target.value as typeof s.dimCap })} title="End caps of new rulers">
          <option value="arrows">Arrows</option>
          <option value="ticks">Ticks</option>
          <option value="dots">Dots</option>
          <option value="none">Plain</option>
        </select>
      </>
    )
  }
  return (
    <div className="k-toolbar kp-optbar">
      <Btn icon={Undo2} title="Undo (⌘Z)" onClick={actions.undo} disabled={!store.past.length} />
      <Btn icon={Redo2} title="Redo (⇧⌘Z)" onClick={actions.redo} disabled={!store.future.length} />
      <span className="k-sep" />
      <span className="kp-label">Stroke</span>
      <ColorButton color={s.stroke} title="Stroke colour" onChange={(c) => { store.set({ stroke: c }); actions.applyStroke({ color: c }) }} />
      <select className="k-input kp-select kp-narrow" value={WIDTHS.includes(s.width) ? s.width : 'other'} title="Line width" onChange={(e) => {
        const w = +e.target.value
        store.set({ width: w })
        actions.applyStroke({ width: w })
      }}>
        {WIDTHS.map((w) => <option key={w} value={w}>{w} px</option>)}
        {!WIDTHS.includes(s.width) && <option value="other">{s.width} px</option>}
      </select>
      <select className="k-input kp-select kp-narrow" value={s.dash} title="Dashes" onChange={(e) => {
        const dash = e.target.value as DashStyle
        store.set({ dash })
        actions.applyStroke({ dash })
      }}>
        <option value="solid">———</option>
        <option value="dash">– – –</option>
        <option value="dot">· · · ·</option>
        <option value="dashdot">– · – ·</option>
      </select>
      <span className="k-sep" />
      <label className="kp-tick kp-inline" title="Fill new shapes">
        <input type="checkbox" checked={s.fillOn} onChange={(e) => fillPatch({ fillOn: e.target.checked })} /> Fill
      </label>
      <ColorButton color={s.fill} title="Fill colour" onChange={(c) => fillPatch({ fill: c, fillOn: true })} />
      <select className="k-input kp-select kp-narrow" value={s.fillStyle} title="Fill style" onChange={(e) => fillPatch({ fillStyle: e.target.value as FillStyle, fillOn: true })}>
        <option value="solid">Solid</option>
        <option value="linear">Linear</option>
        <option value="radial">Radial</option>
        <option value="sun">Sun</option>
      </select>
      {s.fillStyle !== 'solid' && <ColorButton color={s.fill2} title="Gradient end colour" onChange={(c) => fillPatch({ fill2: c, fillOn: true })} />}
      {extra && <span className="k-sep" />}
      {extra}
      <span className="k-sep" />
      <Btn icon={Grid3x3} title="Show grid (⌘')" active={d.grid.show} onClick={() => setGrid({ show: !d.grid.show })} />
      <NumberField value={d.grid.mm} min={0.01} step={0.5} width={46} suffix="mm" title="Grid spacing (mm)" onChange={(v) => setGrid({ mm: v })} />
      <Btn icon={Magnet} title="Snap to grid (⇧⌘')" active={d.grid.snap} onClick={() => setGrid({ snap: !d.grid.snap })} />
      <Btn icon={Maximize} title="Infinite paper" active={d.grid.infinite} onClick={() => setGrid({ infinite: !d.grid.infinite })} />
      <span className="k-sep" />
      <Btn icon={Group} title="Group (⌘G)" onClick={actions.group} disabled={store.sel.length < 2} />
      <Btn icon={Ungroup} title="Ungroup (⇧⌘G)" onClick={actions.ungroup} disabled={!store.selected.some((i) => i.type === 'group')} />
      <Btn icon={FlipHorizontal2} title="Flip horizontally (⇧⌘H)" onClick={() => actions.flip(true)} disabled={!hasSel} />
      <Btn icon={FlipVertical2} title="Flip vertically (⇧⌘J)" onClick={() => actions.flip(false)} disabled={!hasSel} />
      <Btn icon={BringToFront} title="Bring to front (⇧⌘])" onClick={() => actions.order('front')} disabled={!hasSel} />
      <Btn icon={ArrowUpToLine} title="Bring forward (⌘])" onClick={() => actions.order('forward')} disabled={!hasSel} />
      <Btn icon={ArrowDownToLine} title="Send backward (⌘[)" onClick={() => actions.order('backward')} disabled={!hasSel} />
      <Btn icon={SendToBack} title="Send to back (⇧⌘[)" onClick={() => actions.order('back')} disabled={!hasSel} />
      <button
        type="button"
        className="k-icon-btn kp-drop"
        title="Align and distribute"
        disabled={!hasSel}
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          os.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, ALIGN_ITEMS.map(([how, label, icon]) => (how === '-' ? '-' : { label, icon, onClick: () => actions.align(how) })))
        }}
      >
        <AlignCenterHorizontal size={16} />
        <ChevronDown size={10} className="kp-chev" />
      </button>
      <Btn icon={Trash2} title="Delete (⌫)" onClick={actions.remove} disabled={!hasSel} />
      <span className="k-spacer" />
      <Btn icon={PanelRight} title="Properties and library panel" active={panelOpen} onClick={actions.togglePanel} />
    </div>
  )
}

export const ALIGN_ITEMS: [string, string, LucideIcon | undefined][] = [
  ['left', 'Align left edges', AlignStartVertical],
  ['center_x', 'Align centres horizontally', AlignCenterVertical],
  ['right', 'Align right edges', AlignEndVertical],
  ['-', '', undefined],
  ['top', 'Align top edges', AlignStartHorizontal],
  ['center_y', 'Align centres vertically', AlignCenterHorizontal],
  ['bottom', 'Align bottom edges', AlignEndHorizontal],
  ['-', '', undefined],
  ['distribute_x', 'Distribute horizontally', AlignHorizontalDistributeCenter],
  ['distribute_y', 'Distribute vertically', AlignVerticalDistributeCenter],
]
