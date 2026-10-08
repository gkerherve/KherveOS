// The two toolbar rows (desktop mainwindow._build_toolbar and
// celltoolbar.py): the main row (file, snapshot, undo, cells, run, panels,
// page mode, cell type) and a second row whose tools follow the selected
// cell's type. Icons are the desktop's own (qtawesome MDI names); like a
// QToolBar, a button shows its icon only, or its text when it has no icon,
// and drop-down buttons have no arrow (QToolButton::menu-indicator: none).

import { useRef, type ReactNode } from 'react'
import { os, type MenuItem } from '@/os'
import { closeContextMenu, openMenuOwner } from '@/os/overlays'
import { CELL_TYPES, type Cell, type CellType } from './format'
import type { NoteTools, Notebook, SvgTool, SvgTools } from './notebook'
import {
  GREEK, LATEX_ENVS, LATEX_FORMATS, LATEX_SECTIONS, LATEX_SNIPPETS, OPERATORS, PY_SNIPPETS, SVG_SHAPES, dedentLine,
  insertSnippet, perLine, setSvgCanvas, svgViewBox, toggleComment, wrap,
} from './edit'
import { Mdi, hasMdi } from './mdi'

/** The desktop's coloured icons (icon(name, color)). */
export const RUN_GREEN = '#27ae60'
export const STOP_RED = '#c0392b'

export type TbItem =
  | '|'
  | {
      key?: string
      /** qtawesome name, e.g. "mdi.play". */
      icon?: string
      color?: string
      /** The action's text: shown when there is no icon (a⁄b, αβγ…). */
      text?: string
      title: string
      onClick?: () => void
      /** A drop-down: the items are built when it opens. */
      menu?: () => MenuItem[]
      disabled?: boolean
      /** Not in the web version yet: looks muted, says so when clicked. */
      soon?: boolean
      /** A checkable action that is checked. */
      active?: boolean
    }
  | { key: string; node: ReactNode }

let ownerSeq = 0

function TbButton({ item, onSoon }: { item: Exclude<TbItem, '|' | { node: ReactNode }>; onSoon: (what: string) => void }) {
  const owner = useRef(`nb-tb-${++ownerSeq}`).current
  const showIcon = !!item.icon && hasMdi(item.icon)
  const cls = ['nb-tb-btn']
  if (!showIcon) cls.push('text')
  if (item.active) cls.push('active')
  if (item.soon) cls.push('soon')
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
      {showIcon ? <Mdi name={item.icon!} size={24} color={item.color} /> : <span className="nb-tb-text">{item.text ?? item.title}</span>}
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
  explorer: boolean
  ai: boolean
  pageMode: boolean
}

export interface MainRowActions {
  toggleExplorer: () => void
  toggleAi: () => void
  togglePageMode: () => void
  snapshot: () => void
  history: () => void
}

export function mainRow(nb: Notebook, s: MainRowState, ui: MainRowActions, keys: Record<string, string>): TbItem[] {
  const { sel } = s
  return [
    { icon: 'mdi.book-plus-outline', title: `New notebook (${keys.new})`, onClick: () => void nb.newNotebook() },
    { icon: 'mdi.folder-open-outline', title: `Open a notebook (${keys.open})`, onClick: () => void nb.open() },
    { icon: 'mdi.content-save', title: `Save the notebook (${keys.save})`, onClick: () => void nb.save() },
    { icon: 'mdi.cloud-upload-outline', title: 'Save a version snapshot and upload it to the cloud (GitHub, GitLab, …)', onClick: ui.snapshot },
    { icon: 'mdi.history', title: "Browse this notebook's version history", onClick: ui.history },
    '|',
    { icon: 'mdi.undo', title: `Undo (${keys.undo})`, onClick: () => nb.smartUndo() },
    { icon: 'mdi.redo', title: `Redo (${keys.redo})`, onClick: () => nb.smartRedo() },
    '|',
    { icon: 'mdi.plus', title: 'Insert a code cell below', onClick: () => nb.insert('code') },
    { icon: 'mdi.content-cut', title: 'Cut the selected cell', onClick: () => nb.cutCell() },
    { icon: 'mdi.content-copy', title: 'Copy the selected cell', onClick: () => nb.copyCell() },
    { icon: 'mdi.content-paste', title: 'Paste the cell below', onClick: () => nb.pasteCell('below') },
    '|',
    { icon: 'mdi.arrow-up', title: 'Move the cell up', onClick: () => nb.move(-1) },
    { icon: 'mdi.arrow-down', title: 'Move the cell down', onClick: () => nb.move(1) },
    '|',
    { icon: 'mdi.play', color: RUN_GREEN, title: `Run the selected cell (${keys.runNext} runs and advances)`, onClick: () => nb.run(undefined, 'stay') },
    { icon: 'mdi.repeat', title: 'Re-run the selected cell continuously (simulations, animations)', onClick: () => nb.startLoop() },
    {
      icon: 'mdi.stop',
      color: STOP_RED,
      title: s.looping || !s.busy ? 'Stop the continuous run' : 'Stop: cancel the cells waiting to run',
      onClick: () => void nb.stop(),
    },
    { icon: 'mdi.refresh', title: 'Restart the kernel (clears all variables)', onClick: () => void nb.restartKernel() },
    { icon: 'mdi.fast-forward', title: `Restart and run every cell (${keys.runAll})`, onClick: () => nb.runAll() },
    '|',
    { icon: 'mdi.file-tree', title: `Show/hide the file explorer (${keys.explorer})`, active: s.explorer, onClick: ui.toggleExplorer },
    { icon: 'mdi.robot-outline', title: `Show/hide the AI assistant (${keys.ai})`, active: s.ai, onClick: ui.toggleAi },
    '|',
    { icon: 'mdi.view-day', title: `Page Mode: one continuous white page, cell borders hidden (${keys.pageMode})`, active: s.pageMode, onClick: ui.togglePageMode },
    '|',
    {
      key: 'type',
      node: (
        <select
          className="k-input nb-type-select"
          value={sel ? (sel.type === 'other' ? 'other' : sel.type) : 'code'}
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
              {sel.rawType}
            </option>
          )}
        </select>
      ),
    },
  ]
}

// ------------------------------------------------------- the cell's tools

/** A toolbar button that opens the browser's colour picker (desktop QColorDialog). */
function ColorButton({ icon, title, onPick, swatch }: { icon: string; title: string; onPick: (color: string) => void; swatch?: string }) {
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
        <Mdi name={icon} size={24} />
        {swatch && <span className="nb-tb-swatch" style={{ background: swatch }} />}
      </button>
      <input ref={input} type="color" className="nb-hidden-color" tabIndex={-1} aria-hidden value={swatch ?? '#000000'} onChange={(e) => onPick(e.target.value)} />
    </>
  )
}

/** A QSpinBox: prefix, value, suffix; commits on Enter, blur or the arrows. */
function SpinBox({ prefix, suffix, title, value, min, max, onCommit }: { prefix?: string; suffix?: string; title: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const commit = (raw: string, current: number) => {
    const v = Math.round(Number(raw))
    if (Number.isFinite(v) && v >= min && v <= max && v !== current) onCommit(v)
  }
  return (
    <label className="nb-tb-field" title={title}>
      {prefix && <span>{prefix}</span>}
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
        onChange={(e) => {
          // the spin arrows (not typing) commit at once, like valueChanged
          const ne = e.nativeEvent as InputEvent
          if (!ne.inputType) commit(e.target.value, Math.round(value))
        }}
        onBlur={(e) => commit(e.target.value, Math.round(value))}
      />
      {suffix && <span>{suffix}</span>}
    </label>
  )
}

/** Web-safe font families for the Note cell's QFontComboBox. */
const NOTE_FONTS = ['Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Helvetica', 'Liberation Sans', 'Liberation Serif', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana']

export interface CellRowExtras {
  svg: SvgTools
  note: NoteTools
  /** KhervePaint's library objects (label, path), read when the menu opens. */
  paintLibrary: () => [string, string][]
}

export function cellRow(nb: Notebook, sel: Cell | undefined, keys: Record<string, string>, x: CellRowExtras): TbItem[] {
  // The desktop toolbar always shows the code tools when nothing is focused.
  const type = sel?.type ?? 'code'
  const id = sel?.id ?? null
  const ed = (fn: Parameters<Notebook['editorCommand']>[0]) => () => id && nb.editorCommand(fn, id)
  const call = (method: string, ...args: unknown[]) => () => id && nb.callCell(id, method, ...args)
  const runRender = () => id && nb.run(id, 'stay')
  const editorComment = (title: string): TbItem => ({ icon: 'mdi.comment-text-outline', title, onClick: ed((v) => toggleComment(v, type)) })
  const render = (title: string): TbItem => ({ icon: 'mdi.eye-outline', title, onClick: runRender })
  switch (type) {
    case 'code':
    case 'js':
    case 'other':
      return [
        { icon: 'mdi.play', color: RUN_GREEN, title: `Run the cell (${keys.runNext})`, onClick: runRender },
        '|',
        { icon: 'mdi.comment-text-outline', title: 'Toggle line comments', onClick: ed((v) => toggleComment(v, type === 'js' ? 'js' : 'code')) },
        { icon: 'mdi.format-indent-increase', title: 'Indent selected lines', onClick: ed((v) => perLine(v, (ln) => '    ' + ln)) },
        { icon: 'mdi.format-indent-decrease', title: 'Dedent selected lines', onClick: ed((v) => perLine(v, dedentLine)) },
        '|',
        { icon: 'mdi.code-braces', title: 'Insert a code snippet', menu: () => PY_SNIPPETS.map(([label, body]) => ({ label, onClick: ed((v) => insertSnippet(v, body)) })) },
        '|',
        { icon: 'mdi.language-python', title: 'Edit this code in the full kPY editor and reload on save', onClick: call('openInApp', 'khervepy') },
      ]
    case 'markdown':
      return [
        {
          icon: 'mdi.format-header-pound',
          title: 'Heading level',
          menu: () =>
            [1, 2, 3].map((n) => ({
              label: `H${n}  ${'#'.repeat(n)} heading`,
              onClick: ed((v) => perLine(v, (ln) => '#'.repeat(n) + ' ' + ln.replace(/^[#\s]+/, ''))),
            })),
        },
        { icon: 'mdi.format-bold', title: 'Bold (**text**)', onClick: ed((v) => wrap(v, '**', '**')) },
        { icon: 'mdi.format-italic', title: 'Italic (*text*)', onClick: ed((v) => wrap(v, '*', '*')) },
        { icon: 'mdi.format-strikethrough-variant', title: 'Strikethrough (~~text~~)', onClick: ed((v) => wrap(v, '~~', '~~')) },
        { icon: 'mdi.code-tags', title: 'Inline code (`text`)', onClick: ed((v) => wrap(v, '`', '`', 'code')) },
        '|',
        { icon: 'mdi.format-list-bulleted', title: 'Bulleted list', onClick: ed((v) => perLine(v, (ln) => '- ' + ln)) },
        { icon: 'mdi.format-list-numbered', title: 'Numbered list', onClick: ed((v) => perLine(v, (ln) => '1. ' + ln)) },
        { icon: 'mdi.format-quote-close', title: 'Block quote', onClick: ed((v) => perLine(v, (ln) => '> ' + ln)) },
        { icon: 'mdi.link-variant', title: 'Insert a link', onClick: ed((v) => insertSnippet(v, '[text](|https://)')) },
        '|',
        { icon: 'mdi.format-align-left', title: 'Align left', onClick: ed((v) => wrap(v, '<p align="left">', '</p>')) },
        { icon: 'mdi.format-align-center', title: 'Align center', onClick: ed((v) => wrap(v, '<p align="center">', '</p>')) },
        { icon: 'mdi.format-align-right', title: 'Align right', onClick: ed((v) => wrap(v, '<p align="right">', '</p>')) },
        '|',
        { key: 'color', node: <ColorButton icon="mdi.format-color-text" title="Text colour…" onPick={(c) => id && nb.editorCommand((v) => wrap(v, `<span style="color:${c}">`, '</span>'), id)} /> },
        {
          key: 'highlight',
          node: <ColorButton icon="mdi.format-color-highlight" title="Highlight…" onPick={(c) => id && nb.editorCommand((v) => wrap(v, `<span style="background-color:${c}">`, '</span>'), id)} />,
        },
        editorComment(`Comment out — <!-- … --> (${keys.comment})`),
        '|',
        render(`Render the cell (${keys.runNext})`),
      ]
    case 'latex':
      return [
        ...LATEX_SNIPPETS.map(([text, title, snippet]): TbItem => ({ text, title, onClick: ed((v) => insertSnippet(v, snippet)) })),
        '|',
        { icon: 'mdi.format-header-pound', title: 'Title and sections', menu: () => LATEX_SECTIONS.map(([label, s]) => ({ label, onClick: ed((v) => insertSnippet(v, s)) })) },
        { icon: 'mdi.format-bold', title: 'Text formatting', menu: () => LATEX_FORMATS.map(([label, open]) => ({ label, onClick: ed((v) => wrap(v, open, '}')) })) },
        { icon: 'mdi.format-list-numbered', title: 'Lists, equations, tables', menu: () => LATEX_ENVS.map(([label, s]) => ({ label, onClick: ed((v) => insertSnippet(v, s)) })) },
        '|',
        { text: 'αβγ', title: 'Greek letters', menu: () => GREEK.map((name) => ({ label: `${name}  (\\${name})`, onClick: ed((v) => insertSnippet(v, `\\${name} `)) })) },
        { text: '±≤∞', title: 'Operators and symbols', menu: () => OPERATORS.map(([sym, cmd]) => ({ label: `${sym}  (${cmd})`, onClick: ed((v) => insertSnippet(v, cmd + ' ')) })) },
        '|',
        editorComment(`Comment out — % (${keys.comment})`),
        render(`Render / compile (${keys.runNext})`),
      ]
    case 'sheet':
      return [
        { icon: 'mdi.play', color: RUN_GREEN, title: `Recompute all =formulas (${keys.runNext})`, onClick: runRender },
        '|',
        { icon: 'mdi.table-row-plus-after', title: 'Add a row', onClick: () => id && nb.sheetOp('addRow', id) },
        { icon: 'mdi.table-column-plus-after', title: 'Add a column', onClick: () => id && nb.sheetOp('addCol', id) },
        { icon: 'mdi.table-row-remove', title: 'Delete the selected row', onClick: () => id && nb.sheetOp('delRow', id) },
        { icon: 'mdi.table-column-remove', title: 'Delete the selected column', onClick: () => id && nb.sheetOp('delCol', id) },
        '|',
        { icon: 'mdi.table-plus', title: 'Add another sheet to this workbook cell', onClick: () => id && nb.sheetOp('addSheet', id) },
        '|',
        { icon: 'mdi.google-spreadsheet', title: 'Edit this workbook in the full kSheet app and reload on save', onClick: call('openInApp', 'khervesheet') },
      ]
    case 'svg': {
      if (!sel) return []
      const svg = x.svg
      const [, , w, h] = svgViewBox(sel.source)
      const sid = sel.id
      const setSource = (src: string) => nb.replaceSource(sid, src)
      const setTools = (p: Partial<SvgTools>) => nb.svg.setState(p)
      const tool = (t: SvgTool, icon: string, title: string): TbItem => ({
        icon,
        title,
        active: svg.tool === t,
        onClick: () => {
          setTools({ tool: t })
          if (sel.editing) nb.run(sid, 'stay') // back to the drawing
        },
      })
      return [
        tool('select', 'mdi.cursor-default-outline', 'Select / double-click the drawing to edit its source'),
        tool('pen', 'mdi.draw', 'Freehand pen'),
        tool('line', 'mdi.vector-line', 'Line'),
        tool('rect', 'mdi.rectangle-outline', 'Rectangle'),
        tool('ellipse', 'mdi.ellipse-outline', 'Ellipse'),
        tool('text', 'mdi.format-text', 'Text'),
        '|',
        { key: 'color', node: <ColorButton icon="mdi.palette" title="Stroke / text colour…" swatch={svg.color} onPick={(c) => setTools({ color: c })} /> },
        { key: 'width', node: <SpinBox title="Stroke / line width" value={svg.width} min={1} max={40} onCommit={(v) => setTools({ width: v })} /> },
        { icon: 'mdi.undo', title: 'Undo the last drawn shape', onClick: () => nb.undoShape(sid) },
        '|',
        { icon: 'mdi.grid', title: 'Show a grid over the canvas', active: svg.grid, onClick: () => setTools({ grid: !svg.grid }) },
        { icon: 'mdi.magnet', title: 'Snap drawing to the grid', active: svg.snap, onClick: () => setTools({ snap: !svg.snap }) },
        { key: 'grid', node: <SpinBox prefix="grid" suffix="px" title="Grid spacing (the snap unit), in px" value={svg.gridSize} min={2} max={500} onCommit={(v) => setTools({ gridSize: v })} /> },
        '|',
        { key: 'w', node: <SpinBox prefix="W" title="Canvas width (px)" value={w} min={20} max={10000} onCommit={(v) => setSource(setSvgCanvas(nb.cell(sid)?.source ?? '', v, null))} /> },
        { key: 'h', node: <SpinBox prefix="H" title="Canvas height (px)" value={h} min={20} max={10000} onCommit={(v) => setSource(setSvgCanvas(nb.cell(sid)?.source ?? '', null, v))} /> },
        '|',
        { icon: 'mdi.shape-outline', title: 'Insert a ready-made SVG shape', menu: () => SVG_SHAPES.map(([label, el]) => ({ label, onClick: () => nb.drawShape(sid, el) })) },
        {
          icon: 'mdi.shape-plus',
          title: "Insert a kPaint library object (reads kPaint's saved objects)",
          menu: () => {
            const objects = x.paintLibrary()
            if (!objects.length) return [{ label: '(no kPaint objects yet)', disabled: true }, { label: 'Save objects in kPaint to see them', disabled: true }]
            return objects.map(([label, p]) => ({ label, onClick: () => void nb.insertSvgObject(sid, p) }))
          },
        },
        { icon: 'mdi.code-tags', title: 'Edit the raw SVG source', active: sel.editing, onClick: () => nb.focus(sid, 'edit') },
        { icon: 'mdi.eye-outline', color: RUN_GREEN, title: `Render / show the drawing (${keys.runNext})`, onClick: () => nb.run(sid, 'stay') },
        '|',
        // mdi.draw-pen is not in qtawesome's MDI 5.9 set, so the desktop shows the text.
        { icon: 'mdi.draw-pen', text: 'Open in kPaint', title: 'Draw in the full kPaint app and reload on save', onClick: call('openInApp', 'khervepaint') },
      ]
    }
    case 'note': {
      const n = x.note
      const penOn = !!id && n.pen === id
      return [
        {
          key: 'font',
          node: (
            <select className="k-input nb-tb-combo nb-font-combo" title="Font family" value={n.font} onChange={(e) => nb.setNoteTools({ font: e.target.value }, id, 'fontFamily')}>
              {NOTE_FONTS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f}
                </option>
              ))}
            </select>
          ),
        },
        { key: 'size', node: <SpinBox title="Font size" value={n.size} min={6} max={96} onCommit={(v) => nb.setNoteTools({ size: v }, id, 'fontSize')} /> },
        {
          key: 'heading',
          node: (
            <select className="k-input nb-tb-combo" title="Paragraph style" value="" onChange={(e) => id && nb.callCell(id, 'setHeading', Number(e.target.value))}>
              <option value="" disabled hidden>
                Body
              </option>
              {['Body', 'Heading 1', 'Heading 2', 'Heading 3'].map((label, i) => (
                <option key={label} value={i}>
                  {label}
                </option>
              ))}
            </select>
          ),
        },
        '|',
        { icon: 'mdi.format-bold', title: 'Bold', onClick: call('toggleBold') },
        { icon: 'mdi.format-italic', title: 'Italic', onClick: call('toggleItalic') },
        { icon: 'mdi.format-underline', title: 'Underline', onClick: call('toggleUnderline') },
        { icon: 'mdi.format-strikethrough-variant', title: 'Strikethrough', onClick: call('toggleStrike') },
        '|',
        { icon: 'mdi.format-list-bulleted', title: 'Bulleted list', onClick: call('bulletList') },
        { icon: 'mdi.format-list-numbered', title: 'Numbered list', onClick: call('numberedList') },
        { icon: 'mdi.format-align-left', title: 'Align left', onClick: call('setAlign', 'left') },
        { icon: 'mdi.format-align-center', title: 'Align center', onClick: call('setAlign', 'center') },
        { icon: 'mdi.format-align-right', title: 'Align right', onClick: call('setAlign', 'right') },
        '|',
        { key: 'ncolor', node: <ColorButton icon="mdi.format-color-text" title="Text colour…" onPick={(c) => id && nb.callCell(id, 'setColor', c)} /> },
        { key: 'nhigh', node: <ColorButton icon="mdi.format-color-highlight" title="Highlight colour…" onPick={(c) => id && nb.callCell(id, 'setHighlight', c)} /> },
        '|',
        { icon: 'mdi.draw', title: 'Pen — write / annotate over the text', active: penOn, onClick: () => nb.setNoteTools({ pen: penOn ? null : id }) },
        { key: 'inkc', node: <ColorButton icon="mdi.format-color-fill" title="Pen colour…" swatch={n.inkColor} onPick={(c) => nb.setNoteTools({ inkColor: c })} /> },
        { key: 'inkw', node: <SpinBox title="Pen width" value={n.inkWidth} min={1} max={40} onCommit={(v) => nb.setNoteTools({ inkWidth: v })} /> },
        { icon: 'mdi.undo', title: 'Undo the last pen stroke', onClick: call('inkUndo') },
        { icon: 'mdi.eraser', title: 'Clear all pen strokes', onClick: call('inkClear') },
      ]
    }
    case 'file':
      return [
        { icon: 'mdi.paperclip', title: 'Choose the file to hold in the cell', onClick: call('chooseFile') },
        '|',
        { icon: 'mdi.open-in-new', title: 'Open the attached file', onClick: call('openFile') },
        { icon: 'mdi.content-save-outline', title: 'Save the attached file elsewhere', onClick: call('saveCopy') },
        { icon: 'mdi.code-tags', title: 'Copy the kf("name") code reference', onClick: call('copyReference') },
      ]
    case 'kfit':
      return [
        { icon: 'mdi.folder-open-outline', title: 'Open a KherveFitting project into this cell', onClick: call('chooseFile') },
        { icon: 'mdi.refresh', title: 'Re-read the .kfit from disk — after re-fitting it in KherveFitting', onClick: call('refresh') },
        '|',
        { icon: 'mdi.chart-bell-curve', title: 'Show the selected sheet as a plot', onClick: call('showView', 'plot') },
        { icon: 'mdi.table', title: 'Show the selected sheet as a table of numbers', onClick: call('showView', 'data') },
        '|',
        { icon: 'mdi.open-in-new', title: 'Edit this project in KherveFitting and reload on save', onClick: call('openInApp', 'khervefitting') },
      ]
    case 'ktex':
      return [
        { icon: 'mdi.file-plus-outline', title: 'Create a new kTeX document in this cell', onClick: call('newDocument') },
        { icon: 'mdi.folder-open-outline', title: 'Show an existing kTeX document or .tex file in this cell', onClick: call('chooseFile') },
        { icon: 'mdi.refresh', title: 'Re-read the document and its pages', onClick: call('refresh') },
        '|',
        { icon: 'mdi.open-in-new', title: 'Open the document in kTeX; saving there updates the cell', onClick: call('openInApp', 'khervetex') },
        { icon: 'mdi.magnify', title: 'Choose which kTeX to launch', soon: true },
      ]
    case 'mol':
      return [
        { icon: 'mdi.cube-outline', title: 'Ball-and-stick 3D view', onClick: call('showView', '3d') },
        { icon: 'mdi.vector-polyline', title: 'Skeletal 2D sketch', onClick: call('showView', '2d') },
        { icon: 'mdi.rotate-3d-variant', title: 'Turn the 2D sketch into a 3D model (needs RDKit)', soon: true },
        '|',
        { icon: 'mdi.open-in-new', title: 'Edit in kMol and reload on save', onClick: call('openInApp', 'khervemol') },
      ]
  }
}
