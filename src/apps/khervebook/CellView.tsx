// One notebook cell, like the desktop's CellWidget: a card with a gutter
// (green run button, red stop while it runs continuously, orange "restart
// this cell", the collapse chevron and the In [n] / md / tex label), an
// optional title, the body for its type, and resize grips (bottom: height,
// right edge: width).

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { EditorSelection } from '@codemirror/state'
import type { EditorView, KeyBinding } from '@codemirror/view'
import { SearchQuery, findNext, findPrevious, searchPanelOpen, setSearchQuery } from '@codemirror/search'
import { redo as cmRedo, selectAll, undo as cmUndo } from '@codemirror/commands'
import { LoaderCircle } from 'lucide-react'
import { os, type MenuItem } from '@/os'
import { CodeEditor, type EditorLanguage } from '@/os/ui/CodeEditor'
import { CELL_TYPES, type Cell, type CellKind } from './format'
import { hasEditor, type After, type Notebook } from './notebook'
import { toggleComment } from './edit'
import { JsView, LatexView, MarkdownView, OtherView, OutputArea, SvgView } from './CellBodies'
import { SheetView } from './SheetView'
import { FileView, KfitView, KtexView, MolView, NoteView } from './RichCells'
import { Mdi } from './mdi'
import { RUN_GREEN, STOP_RED } from './Toolbar'
import { themeNames, themeVars, useHlTheme } from './hltheme'

// ------------------------------------------------------------------ editor

/** The cursor is on the first visual line (wrapped lines count). */
function onFirstLine(v: EditorView): boolean {
  const sel = v.state.selection.main
  if (!sel.empty || v.state.doc.lineAt(sel.head).number !== 1) return false
  const here = v.coordsAtPos(sel.head)
  const top = v.coordsAtPos(0)
  return !here || !top || here.top - top.top < 4
}

function onLastLine(v: EditorView): boolean {
  const sel = v.state.selection.main
  const doc = v.state.doc
  if (!sel.empty || doc.lineAt(sel.head).number !== doc.lines) return false
  const here = v.coordsAtPos(sel.head)
  const end = v.coordsAtPos(doc.length)
  return !here || !end || end.bottom - here.bottom < 4
}

function cellKeys(nb: Notebook, id: string, type: CellKind, openFind: () => void): KeyBinding[] {
  const run = (after: After) => () => {
    nb.run(id, after)
    return true
  }
  return [
    { key: 'Shift-Enter', run: run('advance') },
    { key: 'Mod-Enter', run: run('stay') },
    { key: 'Ctrl-Enter', run: run('stay') },
    { key: 'Alt-Enter', run: run('insert') },
    {
      key: 'Mod-/',
      run: (v) => {
        toggleComment(v, type)
        return true
      },
    },
    {
      key: 'Mod-f',
      run: () => {
        openFind()
        return true
      },
    },
    {
      key: 'Escape',
      run: (v) => {
        if (searchPanelOpen(v.state)) return false
        nb.focus(id, 'command')
        return true
      },
    },
    // Up on the first line / down on the last line moves to the neighbouring cell.
    { key: 'ArrowUp', run: (v) => onFirstLine(v) && nb.focusSibling(id, -1, 'auto') },
    { key: 'ArrowDown', run: (v) => onLastLine(v) && nb.focusSibling(id, 1, 'auto') },
  ]
}

const PLACEHOLDER: Partial<Record<CellKind, string>> = {
  code: 'Python code. Shift+Enter runs it',
  markdown: 'Markdown text, with $math$. Shift+Enter shows it',
  latex: 'An equation, e.g. e^{i\\pi} + 1 = 0 — or a whole document (\\section, \\textbf…)',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 180">…</svg>',
  js: 'JavaScript, or HTML with <script>. Shift+Enter shows the page',
}

const LANGUAGE: Partial<Record<CellKind, EditorLanguage>> = {
  code: 'python',
  markdown: 'markdown',
  latex: 'latex',
  svg: 'javascript', // JSX colouring reads well for SVG tags
  js: 'javascript',
}

function CellEditor({ nb, cell, lineNumbers, onFind }: { nb: Notebook; cell: Cell; lineNumbers: boolean; onFind: () => void }) {
  const { id, type } = cell
  const viewRef = useRef<EditorView | null>(null)
  const findRef = useRef(onFind)
  findRef.current = onFind
  const keys = useMemo(() => cellKeys(nb, id, type, () => findRef.current()), [nb, id, type])
  useEffect(
    () => () => {
      if (viewRef.current) nb.unregisterEditor(id, viewRef.current)
    },
    [nb, id],
  )
  return (
    <CodeEditor
      value={cell.source}
      onChange={(v) => nb.setSource(id, v)}
      language={LANGUAGE[type] ?? 'plain'}
      wrap={type === 'markdown' || type === 'latex'}
      lineNumbers={type === 'code' && lineNumbers}
      autoHeight
      keys={keys}
      placeholder={PLACEHOLDER[type]}
      onFocus={() => nb.select(id)}
      onReady={(v) => {
        viewRef.current = v
        nb.registerEditor(id, v)
      }}
    />
  )
}

// ------------------------------------------------------------ find in cell

/** desktop _FindBar: "Find in cell…", ▲ ▼ ✕, wrap-around, case-insensitive, incremental. */
function FindBar({ getView, onClose }: { getView: () => EditorView | undefined; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(() => {
    const view = getView()
    const sel = view?.state.selection.main
    return view && sel && !sel.empty ? view.state.sliceDoc(sel.from, sel.to) : ''
  })
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const find = (forward: boolean, from?: 'start') => {
    const view = getView()
    if (!view) return
    if (!text) return setMissing(false)
    const q = new SearchQuery({ search: text, caseSensitive: false, literal: true })
    view.dispatch({ effects: setSearchQuery.of(q) })
    if (from === 'start') {
      const sel = view.state.selection.main
      view.dispatch({ selection: EditorSelection.cursor(sel.from) })
    }
    const found = !q.getCursor(view.state).next().done
    setMissing(!found)
    if (found) (forward ? findNext : findPrevious)(view)
  }
  useEffect(() => {
    find(true, 'start')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
  const close = () => {
    onClose()
    getView()?.focus()
  }
  return (
    <div className="nb-findbar" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        className={`k-input${missing ? ' missing' : ''}`}
        placeholder="Find in cell…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            find(!e.shiftKey)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      />
      <button title="Previous" onMouseDown={(e) => e.preventDefault()} onClick={() => find(false)}>
        ▲
      </button>
      <button title="Next" onMouseDown={(e) => e.preventDefault()} onClick={() => find(true)}>
        ▼
      </button>
      <button title="Close (Esc)" onMouseDown={(e) => e.preventDefault()} onClick={close}>
        ✕
      </button>
    </div>
  )
}

// ---------------------------------------------------- editor right-click

const synonymCache = new Map<string, string[]>()

/** desktop thesaurus.synonyms: up to 12 from the free Datamuse API ([] if none / offline). */
async function synonyms(word: string): Promise<string[]> {
  const hit = synonymCache.get(word)
  if (hit) return hit
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 4000)
  try {
    const r = await fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}&max=12`, { signal: ctl.signal })
    const data = (await r.json()) as { word?: string }[]
    const out = data.map((d) => d.word ?? '').filter(Boolean)
    synonymCache.set(word, out)
    return out
  } catch {
    return []
  } finally {
    clearTimeout(t)
  }
}

/** The word under the pointer in an editor (desktop cursorForPosition + WordUnderCursor). */
function wordAt(view: EditorView, x: number, y: number): { from: number; to: number; word: string } | null {
  const pos = view.posAtCoords({ x, y })
  if (pos === null) return null
  const w = view.state.wordAt(pos)
  if (!w) return null
  const word = view.state.sliceDoc(w.from, w.to)
  return /^[\p{L}'-]+$/u.test(word) ? { from: w.from, to: w.to, word } : null
}

/** desktop _GrowingEdit.contextMenuEvent: Run Cell, the standard edit menu, Find…, Synonyms / Highlight Theme. */
async function editorMenu(nb: Notebook, cell: Cell, view: EditorView, e: { clientX: number; clientY: number }, openFind: () => void): Promise<MenuItem[]> {
  const sel = view.state.selection.main
  const text = sel.empty ? '' : view.state.sliceDoc(sel.from, sel.to)
  const ro = view.state.readOnly
  const items: MenuItem[] = [
    { label: 'Run Cell', onClick: () => nb.run(cell.id, 'stay') },
    '-',
    { label: 'Undo', shortcut: 'Ctrl+Z', disabled: ro, onClick: () => cmUndo(view) },
    { label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: ro, onClick: () => cmRedo(view) },
    '-',
    {
      label: 'Cut',
      shortcut: 'Ctrl+X',
      disabled: !text || ro,
      onClick: () => {
        void navigator.clipboard?.writeText(text)
        view.dispatch({ changes: { from: sel.from, to: sel.to, insert: '' }, userEvent: 'delete.cut' })
      },
    },
    { label: 'Copy', shortcut: 'Ctrl+C', disabled: !text, onClick: () => void navigator.clipboard?.writeText(text) },
    {
      label: 'Paste',
      shortcut: 'Ctrl+V',
      disabled: ro,
      onClick: () =>
        void navigator.clipboard?.readText().then((t) => {
          const s = view.state.selection.main
          view.dispatch({ changes: { from: s.from, to: s.to, insert: t }, selection: { anchor: s.from + t.length }, userEvent: 'input.paste' })
          view.focus()
        }),
    },
    { label: 'Delete', disabled: !text || ro, onClick: () => view.dispatch({ changes: { from: sel.from, to: sel.to, insert: '' }, userEvent: 'delete' }) },
    '-',
    { label: 'Select All', shortcut: 'Ctrl+A', onClick: () => selectAll(view) },
    '-',
    { label: 'Find…', shortcut: 'Ctrl+F', onClick: openFind },
  ]
  if (cell.type === 'markdown' || cell.type === 'latex') {
    const w = wordAt(view, e.clientX, e.clientY)
    if (w) {
      // desktop: the submenu fills in when it opens; here the menu waits briefly for the answer.
      const words = await Promise.race([synonyms(w.word), new Promise<null>((r) => setTimeout(() => r(null), 900))])
      items.push({
        label: `Synonyms for “${w.word}”`,
        submenu:
          words === null
            ? [{ label: 'Looking up…', disabled: true }]
            : words.length
              ? words.map((syn) => ({ label: syn, onClick: () => view.dispatch({ changes: { from: w.from, to: w.to, insert: syn }, userEvent: 'input' }) }))
              : [{ label: '(no synonyms found / offline)', disabled: true }],
      })
    }
  }
  if (cell.type === 'code') {
    const cur = useHlTheme.getState().name
    items.push({ label: 'Highlight Theme', submenu: themeNames().map((n) => ({ label: n, checked: n === cur, onClick: () => useHlTheme.getState().set(n) })) })
  }
  return items
}

// -------------------------------------------------------------- the menu

/** The desktop's right-click menu for a cell (plus a sheet's View / Create Plot items). */
export function cellMenu(nb: Notebook, cell: Cell, looping: boolean, extra: MenuItem[] = []): MenuItem[] {
  const { id } = cell
  const i = nb.state.cells.findIndex((c) => c.id === id)
  const isCode = cell.type === 'code'
  const items: MenuItem[] = [
    { label: 'Run Cell', onClick: () => nb.run(id, 'stay') },
    looping ? { label: 'Stop Continuous Run', onClick: () => nb.stopLoop() } : { label: 'Run Continuously', onClick: () => nb.startLoop(id) },
    ...(isCode ? ([{ label: 'Restart This Cell', onClick: () => nb.restartCell(id) }] as MenuItem[]) : []),
    { label: cell.collapsed ? 'Expand Cell' : 'Collapse Cell', onClick: () => nb.setCollapsed(id, !cell.collapsed) },
    {
      label: cell.title ? 'Edit Title…' : 'Set Title…',
      onClick: async () => {
        const t = await os.dialog.prompt('Title (leave empty to remove):', { title: 'Cell title', defaultValue: cell.title })
        if (t !== null) nb.setTitle(id, t)
        nb.refocusSoon()
      },
    },
    ...extra,
    '-',
    { label: 'Cut Cell', onClick: () => nb.cutCell(id) },
    { label: 'Copy Cell', onClick: () => nb.copyCell(id) },
    { label: 'Paste Cell Below', disabled: !nb.canPaste, onClick: () => nb.pasteCell('below') },
    {
      label: 'Convert To',
      submenu: CELL_TYPES.filter((t) => t.type !== cell.type).map((t) => ({ label: t.convert, onClick: () => nb.setType(t.type, id) })),
    },
    '-',
    { label: 'Move Up', disabled: i <= 0, onClick: () => nb.move(-1, id) },
    { label: 'Move Down', disabled: i < 0 || i >= nb.state.cells.length - 1, onClick: () => nb.move(1, id) },
    cell.column
      ? { label: 'Move to Own Row', onClick: () => nb.setColumn(id, false) }
      : { label: 'Place Beside Cell Above', disabled: i <= 0, onClick: () => nb.setColumn(id, true) },
    '-',
    { label: 'Delete Cell', danger: true, onClick: () => nb.remove(id) },
  ]
  return items
}

// -------------------------------------------------------------------- cell

/** The one-line preview of a collapsed cell without a title (desktop set_collapsed). */
function summary(source: string): string {
  const lines = source.trim().split('\n')
  const first = (lines[0] ?? '').slice(0, 90)
  return lines.length > 1 ? `${first}   … ${lines.length} lines` : first || '(empty)'
}

function label(cell: Cell): string {
  switch (cell.type) {
    case 'code':
      return `In [${cell.state !== 'idle' ? '*' : (cell.count ?? ' ')}]:`
    case 'markdown':
      return 'md'
    case 'latex':
      return 'tex'
    case 'other':
      return cell.rawType ?? '?'
    default:
      return cell.type
  }
}

/** Drag from a grip: `apply` gets the distance moved; double-click resets. */
function dragGrip(e: PointerEvent<HTMLDivElement>, axis: 'x' | 'y', start: number, apply: (v: number) => void) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const el = e.currentTarget
  const p0 = axis === 'x' ? e.clientX : e.clientY
  el.setPointerCapture(e.pointerId)
  el.classList.add('dragging')
  document.body.classList.add('k-dragging')
  const move = (ev: globalThis.PointerEvent) => apply(start + (axis === 'x' ? ev.clientX : ev.clientY) - p0)
  const end = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', end)
    el.removeEventListener('pointercancel', end)
    el.classList.remove('dragging')
    document.body.classList.remove('k-dragging')
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
}

interface CellViewProps {
  cell: Cell
  selected: boolean
  /** This cell is the one running continuously. */
  looping: boolean
  nb: Notebook
  /** Folder that relative links and images resolve against. */
  baseDir: string
  lineNumbers: boolean
  /** View > Theme (re-reads light or dark for the code colours). */
  theme: string
}

export const CellView = memo(function CellView({ cell, selected, looping, nb, baseDir, lineNumbers, theme }: CellViewProps) {
  const { id, type } = cell
  const rootRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el
      nb.registerCellEl(id, el)
    },
    [nb, id],
  )
  const edit = useCallback(() => nb.focus(id, 'edit'), [nb, id])
  const busy = cell.state !== 'idle'
  const showEditor = hasEditor(cell)
  const [finding, setFinding] = useState(false)
  const openFind = useCallback(() => {
    const c = nb.cell(id)
    if (c && !hasEditor(c) && (c.type === 'markdown' || c.type === 'latex' || c.type === 'svg')) nb.focus(id, 'edit')
    setFinding(true)
  }, [nb, id])
  useEffect(() => {
    if (cell.type === 'code' || cell.type === 'js' || cell.type === 'markdown' || cell.type === 'latex' || cell.type === 'svg') {
      return nb.registerHandle(id, { find: openFind })
    }
  }, [nb, id, cell.type, openFind])
  const hl = useHlTheme((s) => s.name)
  const [dark, setDark] = useState(true)
  useLayoutEffect(() => {
    setDark(rootRef.current?.closest('[data-dark]')?.getAttribute('data-dark') !== '0')
  }, [theme])
  const editorVars = useMemo(() => (cell.type === 'code' ? (themeVars(hl, dark) as CSSProperties) : undefined), [cell.type, hl, dark])
  const editorEl = <CellEditor key={type} nb={nb} cell={cell} lineNumbers={type === 'code' && lineNumbers} onFind={openFind} />
  const findBar = finding && showEditor ? <FindBar getView={() => nb.editorView(id)} onClose={() => setFinding(false)} /> : null

  const cls = ['nb-cell', `nb-cell-${type}`]
  if (selected) cls.push('selected')
  if (busy) cls.push(cell.state)
  if (looping) cls.push('looping')
  if (cell.collapsed) cls.push('collapsed')

  const openMenu = (e: MouseEvent, extra: MenuItem[] = []) => {
    nb.select(id)
    os.contextMenu(e, cellMenu(nb, cell, looping, extra))
  }

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    // The cell's editor has the desktop's editor menu; form fields, notes and pages keep the browser's.
    if (t.closest('.cm-content')) {
      const view = nb.editorView(id)
      if (!view) return
      e.preventDefault()
      const at = { clientX: e.clientX, clientY: e.clientY }
      nb.select(id)
      void editorMenu(nb, cell, view, at, openFind).then((items) => os.contextMenu(at, items))
      return
    }
    if (t.closest('input, textarea, iframe, select, [contenteditable="true"]')) return
    e.preventDefault()
    openMenu(e)
  }

  /** Buttons keep the focus where it is (mousedown is not allowed to move it). */
  const keep = (e: MouseEvent) => e.preventDefault()

  let body = null
  switch (type) {
    case 'code':
      body = (
        <>
          <div className="nb-input" style={editorVars}>
            {editorEl}
          </div>
          {findBar}
          {cell.note && (
            <div className="nb-note">
              <LoaderCircle size={13} className="k-spin" />
              <span>{cell.note}</span>
            </div>
          )}
          {cell.outputs.length > 0 && <OutputArea outputs={cell.outputs} />}
        </>
      )
      break
    case 'markdown':
      body = showEditor ? (
        <>
          <div className="nb-input">{editorEl}</div>
          {findBar}
        </>
      ) : (
        <MarkdownView source={cell.source} baseDir={baseDir} onEdit={edit} />
      )
      break
    case 'latex':
      body = (
        <>
          {showEditor && <div className="nb-input">{editorEl}</div>}
          {findBar}
          {(!showEditor || !!cell.source.trim()) && <LatexView source={cell.source} preview={showEditor} onEdit={edit} />}
        </>
      )
      break
    case 'svg':
      body = showEditor ? (
        <>
          <div className="nb-input">{editorEl}</div>
          {findBar}
        </>
      ) : (
        <SvgView nb={nb} id={id} source={cell.source} onEdit={edit} />
      )
      break
    case 'js':
      body = (
        <>
          <div className="nb-input">{editorEl}</div>
          {findBar}
          {cell.runs > 0 && <JsView source={cell.source} runs={cell.runs} />}
        </>
      )
      break
    case 'sheet':
      body = <SheetView nb={nb} id={id} source={cell.source} result={cell.sheet} height={cell.height} onMenu={openMenu} />
      break
    case 'note':
      body = <NoteView nb={nb} cell={cell} onFocus={() => nb.select(id)} />
      break
    case 'file':
      body = <FileView nb={nb} cell={cell} />
      break
    case 'kfit':
      body = <KfitView nb={nb} cell={cell} />
      break
    case 'ktex':
      body = <KtexView nb={nb} cell={cell} />
      break
    case 'mol':
      body = <MolView nb={nb} cell={cell} />
      break
    case 'other':
      body = <OtherView cell={cell} />
      break
  }

  // The sheet's own grid takes the height from the grip; other cells cap their body.
  const capBody = type !== 'sheet' && cell.height ? { maxHeight: cell.height } : undefined

  return (
    <div
      ref={ref}
      className={cls.join(' ')}
      tabIndex={-1}
      style={cell.width ? { width: cell.width, flex: 'none' } : undefined}
      onMouseDown={() => nb.select(id)}
      onContextMenu={onContextMenu}
    >
      <div className="nb-gutter">
        <div className="nb-gutter-run" onMouseDown={keep}>
          <button className="nb-g-btn run" title="Run this cell" aria-label="Run this cell" onClick={() => nb.run(id, 'stay')}>
            <Mdi name="mdi.play-circle-outline" size={24} color={RUN_GREEN} />
          </button>
          {looping && (
            <button className="nb-g-btn stop" title="Stop the continuous run" aria-label="Stop the continuous run" onClick={() => nb.stopLoop()}>
              <Mdi name="mdi.stop-circle-outline" size={24} color={STOP_RED} />
            </button>
          )}
        </div>
        {type === 'code' && (
          <button
            className="nb-g-btn reset"
            title="Restart this cell — reset its variables and re-run"
            aria-label="Restart this cell"
            onMouseDown={keep}
            onClick={() => nb.restartCell(id)}
          >
            <Mdi name="mdi.restart" size={20} color="#e07b39" />
          </button>
        )}
        <button
          className="nb-g-btn fold"
          title="Collapse / expand this cell"
          aria-label={cell.collapsed ? 'Expand cell' : 'Collapse cell'}
          onMouseDown={keep}
          onClick={() => nb.setCollapsed(id, !cell.collapsed)}
        >
          <Mdi name={cell.collapsed ? 'mdi.chevron-right' : 'mdi.chevron-down'} size={18} />
        </button>
        <div className="nb-label" title={type === 'other' ? `${cell.rawType} cell` : undefined}>
          {label(cell)}
        </div>
      </div>

      <div className="nb-content">
        {cell.title && <div className="nb-title">{cell.title}</div>}
        {cell.collapsed ? (
          !cell.title && (
            <div className="nb-summary" title="Click to expand" onClick={() => nb.setCollapsed(id, false)}>
              {summary(type === 'sheet' ? 'sheet' : cell.source)}
            </div>
          )
        ) : (
          <>
            <div ref={bodyRef} className={`nb-cellbody${capBody ? ' capped' : ''}`} style={capBody}>
              {body}
            </div>
            <div
              className="nb-grip"
              title="Drag to resize height; double-click to auto-fit"
              onPointerDown={(e) => {
                const start = type === 'sheet' ? (rootRef.current?.querySelector<HTMLElement>('.nb-grid')?.offsetHeight ?? 160) : (bodyRef.current?.offsetHeight ?? 100)
                dragGrip(e, 'y', start, (v) => nb.setSize(id, { height: v }))
              }}
              onDoubleClick={() => nb.setSize(id, { height: null })}
            />
          </>
        )}
      </div>
      <div
        className="nb-wgrip"
        title="Drag to resize width; double-click to auto"
        onPointerDown={(e) => dragGrip(e, 'x', rootRef.current?.offsetWidth ?? 600, (v) => nb.setSize(id, { width: v }))}
        onDoubleClick={() => nb.setSize(id, { width: null })}
      />
    </div>
  )
})
