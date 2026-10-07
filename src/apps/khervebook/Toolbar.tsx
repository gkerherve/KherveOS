// The two toolbar rows (desktop mainwindow._build_toolbar and
// celltoolbar.py): the main row (file, undo, cells, run, panels, page mode,
// cell type) and a second row whose tools follow the selected cell's type.

import { useRef, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDown, ArrowUp, Baseline, BetweenHorizontalEnd, BetweenVerticalEnd, Bold, BookPlus, Bot, Braces, ChevronDown, ClipboardPaste,
  CloudUpload, Code, Copy, Eye, FastForward, FolderOpen, FolderTree, Heading, Highlighter, History, Italic, Link, List, ListIndentDecrease,
  ListIndentIncrease, ListOrdered, MessageSquareText, Play, Plus, Redo2, Repeat, RotateCw, Rows2, Rows3, Save, Scissors, Shapes, Sheet,
  Square, Strikethrough, TextAlignCenter, TextAlignEnd, TextAlignStart, TextQuote, Undo2, Columns2, MousePointer2, PenLine, Slash,
  RectangleHorizontal, Circle, Type, Palette, Grid3x3, Magnet,
} from 'lucide-react'
import { os, type MenuItem } from '@/os'
import { closeContextMenu, openMenuOwner } from '@/os/overlays'
import { CELL_TYPES, type Cell, type CellType } from './format'
import type { Notebook, SvgTool, SvgTools } from './notebook'
import {
  GREEK, LATEX_ENVS, LATEX_FORMATS, LATEX_SECTIONS, LATEX_SNIPPETS, OPERATORS, PY_SNIPPETS, SVG_SHAPES, dedentLine,
  insertSnippet, perLine, setSvgCanvas, svgViewBox, toggleComment, wrap,
} from './edit'

export type TbItem =
  | '|'
  | {
      key?: string
      icon?: LucideIcon
      /** Text instead of (or after) the icon: "a⁄b", "Section"… */
      text?: string
      title: string
      onClick?: () => void
      /** A drop-down: the items are built when it opens. */
      menu?: () => MenuItem[]
      disabled?: boolean
      /** Not in the web version yet: looks muted, says so when clicked. */
      soon?: boolean
      active?: boolean
      tone?: 'run' | 'stop'
    }
  | { key: string; node: ReactNode }

let ownerSeq = 0

function TbButton({ item, onSoon }: { item: Exclude<TbItem, '|' | { node: ReactNode }>; onSoon: (what: string) => void }) {
  const owner = useRef(`nb-tb-${++ownerSeq}`).current
  const Icon = item.icon
  const cls = ['nb-tb-btn']
  if (item.text) cls.push('text')
  if (item.active) cls.push('active')
  if (item.soon) cls.push('soon')
  if (item.tone) cls.push(item.tone)
  return (
    <button
      className={cls.join(' ')}
      title={item.title}
      aria-label={item.title}
      aria-pressed={item.active}
      disabled={item.disabled}
      data-menu-owner={item.menu ? owner : undefined}
      // Toolbar buttons must not take the focus away from the cell being edited.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        if (item.soon) return onSoon(item.title)
        if (item.menu) {
          if (openMenuOwner() === owner) return closeContextMenu()
          const r = e.currentTarget.getBoundingClientRect()
          os.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, item.menu(), { owner })
          return
        }
        item.onClick?.()
      }}
    >
      {Icon && <Icon size={18} strokeWidth={1.8} />}
      {item.text && <span className="nb-tb-text">{item.text}</span>}
      {item.menu && <ChevronDown size={11} className="nb-tb-caret" />}
    </button>
  )
}

export function ToolRow({ items, className, onSoon, children }: { items: TbItem[]; className?: string; onSoon: (what: string) => void; children?: ReactNode }) {
  return (
    <div className={`k-toolbar nb-toolbar${className ? ` ${className}` : ''}`}>
      {items.map((it, i) =>
        it === '|' ? <span key={`sep${i}`} className="k-sep" /> : 'node' in it ? <span key={it.key} className="nb-tb-node">{it.node}</span> : <TbButton key={it.key ?? `${it.title}${i}`} item={it} onSoon={onSoon} />,
      )}
      {children}
    </div>
  )
}

// -------------------------------------------------------------- main row

export interface MainRowState {
  sel: Cell | undefined
  selIndex: number
  count: number
  busy: boolean
  looping: boolean
  canUndo: boolean
  canRedo: boolean
  explorer: boolean
  ai: boolean
  pageMode: boolean
}

export function mainRow(nb: Notebook, s: MainRowState, ui: { toggleExplorer: () => void; toggleAi: () => void; togglePageMode: () => void }, keys: Record<string, string>): TbItem[] {
  const { sel } = s
  return [
    { icon: BookPlus, title: `New notebook (${keys.new})`, onClick: () => void nb.newNotebook() },
    { icon: FolderOpen, title: `Open a notebook (${keys.open})`, onClick: () => void nb.open() },
    { icon: Save, title: `Save the notebook (${keys.save})`, onClick: () => void nb.save() },
    { icon: CloudUpload, title: 'Save a version snapshot and upload it to the cloud (GitHub, GitLab, …)', soon: true },
    { icon: History, title: "Browse this notebook's version history", soon: true },
    '|',
    { icon: Undo2, title: `Undo (${keys.undo})`, onClick: () => nb.smartUndo() },
    { icon: Redo2, title: `Redo (${keys.redo})`, onClick: () => nb.smartRedo() },
    '|',
    { icon: Plus, title: 'Insert a code cell below', onClick: () => nb.insert('code') },
    { icon: Scissors, title: 'Cut the selected cell', disabled: !sel, onClick: () => nb.cutCell() },
    { icon: Copy, title: 'Copy the selected cell', disabled: !sel, onClick: () => nb.copyCell() },
    { icon: ClipboardPaste, title: 'Paste the cell below', onClick: () => nb.pasteCell('below') },
    '|',
    { icon: ArrowUp, title: 'Move the cell up', disabled: s.selIndex <= 0, onClick: () => nb.move(-1) },
    { icon: ArrowDown, title: 'Move the cell down', disabled: s.selIndex < 0 || s.selIndex >= s.count - 1, onClick: () => nb.move(1) },
    '|',
    { icon: Play, title: `Run the selected cell (${keys.runNext} runs and advances)`, tone: 'run', disabled: !sel, onClick: () => nb.run(undefined, 'stay') },
    { icon: Repeat, title: 'Re-run the selected cell continuously (simulations, animations)', disabled: sel?.type !== 'code', onClick: () => nb.startLoop() },
    { icon: Square, title: s.looping ? 'Stop the continuous run' : 'Stop: cancel the cells waiting to run', tone: 'stop', disabled: !s.looping && !s.busy, onClick: () => void nb.stop() },
    { icon: RotateCw, title: 'Restart the kernel (clears all variables)', onClick: () => void nb.restartKernel() },
    { icon: FastForward, title: `Restart and run every cell (${keys.runAll})`, onClick: () => nb.runAll() },
    '|',
    { icon: FolderTree, title: `Show/hide the file explorer (${keys.explorer})`, active: s.explorer, onClick: ui.toggleExplorer },
    { icon: Bot, title: `Show/hide the AI assistant (${keys.ai})`, active: s.ai, onClick: ui.toggleAi },
    '|',
    { icon: Rows3, title: `Page Mode: one continuous page, cell borders hidden (${keys.pageMode})`, active: s.pageMode, onClick: ui.togglePageMode },
    '|',
    {
      key: 'type',
      node: (
        <select
          className="k-input nb-type-select"
          value={sel ? (sel.type === 'other' ? 'other' : sel.type) : 'code'}
          disabled={!sel}
          title="Change the selected cell's type"
          aria-label="Cell type"
          onChange={(e) => nb.setType(e.target.value as CellType)}
        >
          {CELL_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
          {sel?.type === 'other' && (
            <option value="other" disabled>
              {sel.rawType} (desktop)
            </option>
          )}
        </select>
      ),
    },
  ]
}

// ------------------------------------------------------- the cell's tools

/** A toolbar button that opens the browser's colour picker. */
function ColorButton({ icon: Icon, title, onPick, swatch }: { icon: LucideIcon; title: string; onPick: (color: string) => void; swatch?: string }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        className="nb-tb-btn"
        title={title}
        aria-label={title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const el = input.current
          if (!el) return
          try {
            el.showPicker()
          } catch {
            el.click()
          }
        }}
      >
        <Icon size={18} strokeWidth={1.8} />
        {swatch && <span className="nb-tb-swatch" style={{ background: swatch }} />}
      </button>
      <input ref={input} type="color" className="nb-hidden-color" tabIndex={-1} aria-hidden value={swatch} onChange={(e) => onPick(e.target.value)} />
    </>
  )
}

function NumberField({ label, title, value, min, max, onCommit }: { label: string; title: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  return (
    <label className="nb-tb-field" title={title}>
      <span>{label}</span>
      <input
        key={value}
        type="number"
        className="k-input"
        defaultValue={Math.round(value)}
        min={min}
        max={max}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        onBlur={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v) && v >= min && v <= max && v !== Math.round(value)) onCommit(v)
        }}
      />
    </label>
  )
}

export function cellRow(nb: Notebook, sel: Cell | undefined, keys: Record<string, string>, svg: SvgTools): TbItem[] {
  if (!sel) return []
  const id = sel.id
  const ed = (fn: Parameters<Notebook['editorCommand']>[0]) => () => nb.editorCommand(fn, id)
  const run: TbItem = { icon: Play, title: `Run the cell (${keys.runNext})`, tone: 'run', onClick: () => nb.run(id, 'stay') }
  const comment = (title: string): TbItem => ({ icon: MessageSquareText, title, onClick: ed((v) => toggleComment(v, sel.type)) })
  const render: TbItem = { icon: Eye, title: `Render the cell (${keys.runNext})`, tone: 'run', onClick: () => nb.run(id, 'stay') }
  const indent: TbItem[] = [
    { icon: ListIndentIncrease, title: 'Indent selected lines', onClick: ed((v) => perLine(v, (ln) => '    ' + ln)) },
    { icon: ListIndentDecrease, title: 'Dedent selected lines', onClick: ed((v) => perLine(v, dedentLine)) },
  ]
  switch (sel.type) {
    case 'code':
      return [
        run,
        '|',
        comment(`Toggle line comments (${keys.comment})`),
        ...indent,
        '|',
        {
          icon: Braces,
          text: 'Snippets',
          title: 'Insert a code snippet',
          menu: () => PY_SNIPPETS.map(([label, body]) => ({ label, onClick: ed((v) => insertSnippet(v, body)) })),
        },
      ]
    case 'js':
      return [run, '|', comment(`Toggle line comments (${keys.comment})`), ...indent]
    case 'markdown':
      return [
        {
          icon: Heading,
          title: 'Heading level',
          menu: () =>
            [1, 2, 3].map((n) => ({
              label: `H${n}  ${'#'.repeat(n)} heading`,
              onClick: ed((v) => perLine(v, (ln) => '#'.repeat(n) + ' ' + ln.replace(/^[#\s]+/, ''))),
            })),
        },
        { icon: Bold, title: 'Bold (**text**)', onClick: ed((v) => wrap(v, '**', '**')) },
        { icon: Italic, title: 'Italic (*text*)', onClick: ed((v) => wrap(v, '*', '*')) },
        { icon: Strikethrough, title: 'Strikethrough (~~text~~)', onClick: ed((v) => wrap(v, '~~', '~~')) },
        { icon: Code, title: 'Inline code (`text`)', onClick: ed((v) => wrap(v, '`', '`', 'code')) },
        '|',
        { icon: List, title: 'Bulleted list', onClick: ed((v) => perLine(v, (ln) => '- ' + ln)) },
        { icon: ListOrdered, title: 'Numbered list', onClick: ed((v) => perLine(v, (ln) => '1. ' + ln)) },
        { icon: TextQuote, title: 'Block quote', onClick: ed((v) => perLine(v, (ln) => '> ' + ln)) },
        { icon: Link, title: 'Insert a link', onClick: ed((v) => insertSnippet(v, '[text](|https://)')) },
        '|',
        { icon: TextAlignStart, title: 'Align left', onClick: ed((v) => wrap(v, '<p align="left">', '</p>')) },
        { icon: TextAlignCenter, title: 'Align center', onClick: ed((v) => wrap(v, '<p align="center">', '</p>')) },
        { icon: TextAlignEnd, title: 'Align right', onClick: ed((v) => wrap(v, '<p align="right">', '</p>')) },
        '|',
        { key: 'color', node: <ColorButton icon={Baseline} title="Text colour…" onPick={(c) => nb.editorCommand((v) => wrap(v, `<span style="color:${c}">`, '</span>'), id)} /> },
        {
          key: 'highlight',
          node: <ColorButton icon={Highlighter} title="Highlight…" onPick={(c) => nb.editorCommand((v) => wrap(v, `<span style="background-color:${c}">`, '</span>'), id)} />,
        },
        comment(`Comment out — <!-- … --> (${keys.comment})`),
        '|',
        render,
      ]
    case 'latex':
      return [
        ...LATEX_SNIPPETS.map(([text, title, snippet]): TbItem => ({ text, title, onClick: ed((v) => insertSnippet(v, snippet)) })),
        '|',
        { icon: Heading, text: 'Section', title: 'Title and sections', menu: () => LATEX_SECTIONS.map(([label, s]) => ({ label, onClick: ed((v) => insertSnippet(v, s)) })) },
        { icon: Bold, text: 'Format', title: 'Text formatting', menu: () => LATEX_FORMATS.map(([label, open]) => ({ label, onClick: ed((v) => wrap(v, open, '}')) })) },
        { icon: ListOrdered, text: 'List / Env', title: 'Lists, equations, tables', menu: () => LATEX_ENVS.map(([label, s]) => ({ label, onClick: ed((v) => insertSnippet(v, s)) })) },
        '|',
        { text: 'αβγ', title: 'Greek letters', menu: () => GREEK.map((name) => ({ label: `${name}  (\\${name})`, onClick: ed((v) => insertSnippet(v, `\\${name} `)) })) },
        { text: '±≤∞', title: 'Operators and symbols', menu: () => OPERATORS.map(([sym, cmd]) => ({ label: `${sym}  (${cmd})`, onClick: ed((v) => insertSnippet(v, cmd + ' ')) })) },
        '|',
        comment(`Comment out — % (${keys.comment})`),
        render,
      ]
    case 'sheet':
      return [
        { icon: Play, title: `Recompute all =formulas (${keys.runNext})`, tone: 'run', onClick: () => nb.run(id, 'stay') },
        '|',
        { icon: BetweenHorizontalEnd, title: 'Add a row', onClick: () => nb.sheetOp('addRow', id) },
        { icon: BetweenVerticalEnd, title: 'Add a column', onClick: () => nb.sheetOp('addCol', id) },
        { icon: Rows2, title: 'Delete the selected row', onClick: () => nb.sheetOp('delRow', id) },
        { icon: Columns2, title: 'Delete the selected column', onClick: () => nb.sheetOp('delCol', id) },
        '|',
        { icon: Sheet, title: 'Add another sheet to this workbook cell', onClick: () => nb.sheetOp('addSheet', id) },
      ]
    case 'svg': {
      const [, , w, h] = svgViewBox(sel.source)
      const setSource = (src: string) => nb.replaceSource(id, src)
      const setTools = (p: Partial<SvgTools>) => nb.svg.setState(p)
      const tool = (t: SvgTool, icon: LucideIcon, title: string): TbItem => ({
        icon,
        title,
        active: svg.tool === t,
        onClick: () => {
          setTools({ tool: t })
          if (sel.editing) nb.run(id, 'stay') // back to the drawing
        },
      })
      return [
        tool('select', MousePointer2, 'Select / double-click the drawing to edit its source'),
        tool('pen', PenLine, 'Freehand pen'),
        tool('line', Slash, 'Line'),
        tool('rect', RectangleHorizontal, 'Rectangle'),
        tool('ellipse', Circle, 'Ellipse'),
        tool('text', Type, 'Text'),
        '|',
        { key: 'color', node: <ColorButton icon={Palette} title="Stroke / text colour…" swatch={svg.color} onPick={(c) => setTools({ color: c })} /> },
        { key: 'width', node: <NumberField label="" title="Stroke / line width" value={svg.width} min={1} max={40} onCommit={(v) => setTools({ width: v })} /> },
        { icon: Undo2, title: 'Undo the last drawn shape', onClick: () => nb.undoShape(id) },
        '|',
        { icon: Grid3x3, title: 'Show a grid over the canvas', active: svg.grid, onClick: () => setTools({ grid: !svg.grid }) },
        { icon: Magnet, title: 'Snap drawing to the grid', active: svg.snap, onClick: () => setTools({ snap: !svg.snap }) },
        { key: 'grid', node: <NumberField label="grid" title="Grid spacing (the snap unit), in px" value={svg.gridSize} min={2} max={500} onCommit={(v) => setTools({ gridSize: v })} /> },
        '|',
        {
          icon: Shapes,
          text: 'Shape',
          title: 'Insert a ready-made SVG shape',
          menu: () => SVG_SHAPES.map(([label, el]) => ({ label, onClick: () => nb.drawShape(id, el) })),
        },
        '|',
        { key: 'w', node: <NumberField label="W" title="Canvas width (px)" value={w} min={20} max={10000} onCommit={(v) => setSource(setSvgCanvas(nb.cell(id)?.source ?? '', v, null))} /> },
        { key: 'h', node: <NumberField label="H" title="Canvas height (px)" value={h} min={20} max={10000} onCommit={(v) => setSource(setSvgCanvas(nb.cell(id)?.source ?? '', null, v))} /> },
        '|',
        { icon: Code, title: 'Edit the raw SVG source', active: sel.editing, onClick: () => nb.focus(id, 'edit') },
        { icon: Eye, title: `Render / show the drawing (${keys.runNext})`, tone: 'run', onClick: () => nb.run(id, 'stay') },
      ]
    }
    case 'other':
      return []
  }
}
