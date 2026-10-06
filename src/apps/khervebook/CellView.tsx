// One notebook cell: a card with its prompt, the editor or the rendered
// Markdown / LaTeX, and (for code) the outputs.

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, type MouseEvent } from 'react'
import type { EditorView, KeyBinding } from '@codemirror/view'
import { searchPanelOpen } from '@codemirror/search'
import { ArrowDown, ArrowUp, CircleAlert, LoaderCircle, Pencil, Play, Trash2 } from 'lucide-react'
import { os } from '@/os'
import { CodeEditor } from '@/os/ui/CodeEditor'
import { mimeType } from '@/os/fileIcons'
import { resolve } from '@/os/path'
import type { Cell, CellType, Output } from './format'
import type { After, Notebook } from './notebook'
import { cleanText, imageSrc, renderLatex, renderMarkdown } from './render'

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

function cellKeys(nb: Notebook, id: string): KeyBinding[] {
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

const PLACEHOLDER: Record<CellType, string> = {
  code: 'Python code. Shift+Enter runs it',
  markdown: 'Markdown text, with $math$. Shift+Enter shows it',
  latex: 'An equation, e.g. e^{i\\pi} + 1 = 0',
}

function CellEditor({ nb, cell }: { nb: Notebook; cell: Cell }) {
  const { id, type } = cell
  const viewRef = useRef<EditorView | null>(null)
  const keys = useMemo(() => cellKeys(nb, id), [nb, id])
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
      language={type === 'code' ? 'python' : type}
      wrap={type !== 'code'}
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

// ------------------------------------------------------------ text cells

/** A path written in a notebook, relative to the notebook's folder. */
function drivePath(baseDir: string, href: string): string {
  let p = href.split(/[?#]/)[0]
  try {
    p = decodeURI(p)
  } catch {
    /* keep as written */
  }
  return resolve(baseDir, p)
}

function MarkdownView({ source, baseDir, onEdit }: { source: string; baseDir: string; onEdit: () => void }) {
  const html = useMemo(() => (source.trim() ? renderMarkdown(source) : ''), [source])
  const ref = useRef<HTMLDivElement>(null)

  // ![plot](plot.png): images on the drive are read from the file system.
  useEffect(() => {
    const imgs = ref.current?.querySelectorAll<HTMLImageElement>('img[data-nb-src]')
    if (!imgs?.length) return
    let alive = true
    const urls: string[] = []
    imgs.forEach((img) => {
      const p = drivePath(baseDir, img.dataset.nbSrc ?? '')
      const missing = () => {
        img.classList.add('nb-img-missing')
        img.title = `Not found: ${p}`
      }
      if (!os.fs.isFile(p)) return missing()
      os.fs.readBytes(p).then((bytes) => {
        if (!alive) return
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType(p) }))
        urls.push(url)
        img.src = url
      }, missing)
    })
    return () => {
      alive = false
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [html, baseDir])

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    const href = a.getAttribute('href') ?? ''
    e.preventDefault()
    if (/^https?:\/\//i.test(href)) os.open('browser', { url: href })
    else if (href && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      const p = drivePath(baseDir, href)
      if (os.fs.exists(p)) void os.openFile(p)
      else void os.dialog.alert(`"${p}" doesn't exist.`, { title: 'KherveBook' })
    }
  }

  if (!html) {
    return (
      <div className="nb-md nb-placeholder" onDoubleClick={onEdit}>
        Empty Markdown cell. Double-click to write.
      </div>
    )
  }
  return <div ref={ref} className="nb-md" onClick={onClick} onDoubleClick={onEdit} dangerouslySetInnerHTML={{ __html: html }} />
}

function LatexView({ source, preview, onEdit }: { source: string; preview: boolean; onEdit: () => void }) {
  const r = useMemo(() => renderLatex(source), [source])
  if (!source.trim()) {
    return (
      <div className="nb-tex nb-placeholder" onDoubleClick={onEdit}>
        Empty LaTeX cell. Double-click to write an equation.
      </div>
    )
  }
  if (!r.ok) {
    return (
      <div className={`nb-tex-error${preview ? ' preview' : ''}`} onDoubleClick={onEdit}>
        <CircleAlert size={14} />
        <div>
          <div>{r.error}</div>
          {!preview && <pre>{source}</pre>}
        </div>
      </div>
    )
  }
  return <div className={`nb-tex${preview ? ' preview' : ''}`} onDoubleClick={onEdit} dangerouslySetInnerHTML={{ __html: r.html }} />
}

// ----------------------------------------------------------------- outputs

function TextOutput({ text, className }: { text: string; className: string }) {
  const shown = useMemo(() => cleanText(text), [text])
  return <pre className={className}>{shown}</pre>
}

function ErrorOutput({ o }: { o: Extract<Output, { kind: 'error' }> }) {
  const text = useMemo(() => cleanText(o.traceback), [o.traceback])
  const head = o.ename ? `${o.ename}: ${o.evalue}` : o.evalue
  const lines = text.split('\n')
  const isHead = (l: string) => !!o.ename && (l === o.ename || l.startsWith(o.ename + ':'))
  const showHead = !!head && !lines.some(isHead)
  return (
    <pre className="nb-out nb-error">
      {showHead && <span className="nb-ename">{head}</span>}
      {showHead && text && '\n'}
      {text &&
        lines.map((line, i) => (
          <Fragment key={i}>
            {isHead(line) ? <span className="nb-ename">{line}</span> : line.startsWith('Tip:') ? <span className="nb-tip">{line}</span> : line}
            {i < lines.length - 1 && '\n'}
          </Fragment>
        ))}
    </pre>
  )
}

const OutputView = memo(function OutputView({ o }: { o: Output }) {
  switch (o.kind) {
    case 'stream':
      return <TextOutput text={o.text} className={`nb-out nb-stream ${o.name}`} />
    case 'result':
      return <TextOutput text={o.text} className="nb-out nb-result" />
    case 'image':
      return (
        <div className="nb-out nb-image">
          <img src={imageSrc(o)} alt="Figure" draggable={false} />
        </div>
      )
    case 'error':
      return <ErrorOutput o={o} />
  }
})

const OutputArea = memo(function OutputArea({ outputs }: { outputs: Output[] }) {
  return (
    <div className="nb-outputs">
      {outputs.map((o, i) => (
        <div className="nb-row" key={i}>
          <div className="nb-prompt out">{o.kind === 'result' ? `Out[${o.count ?? ' '}]:` : ''}</div>
          <OutputView o={o} />
        </div>
      ))}
    </div>
  )
})

// -------------------------------------------------------------------- cell

interface CellViewProps {
  cell: Cell
  selected: boolean
  nb: Notebook
  /** Folder that relative links and images resolve against. */
  baseDir: string
}

export const CellView = memo(function CellView({ cell, selected, nb, baseDir }: CellViewProps) {
  const { id, type } = cell
  const ref = useCallback((el: HTMLDivElement | null) => nb.registerCellEl(id, el), [nb, id])
  const edit = useCallback(() => nb.focus(id, 'edit'), [nb, id])
  const isCode = type === 'code'
  const busy = cell.state !== 'idle'
  const showEditor = isCode || cell.editing

  const cls = ['nb-cell', `nb-${type}`]
  if (selected) cls.push('selected')
  if (busy) cls.push(cell.state)
  if (!showEditor) cls.push('rendered')

  const prompt = isCode ? `In [${busy ? '*' : (cell.count ?? ' ')}]:` : type === 'markdown' ? 'md' : 'tex'

  return (
    <div ref={ref} className={cls.join(' ')} tabIndex={-1} onMouseDown={() => nb.select(id)}>
      {/* Buttons keep the focus where it is (mousedown is not allowed to move it). */}
      <div className="nb-cell-tools" onMouseDown={(e) => e.preventDefault()}>
        {showEditor ? (
          <button className="k-icon-btn" title={isCode ? 'Run cell' : 'Show the result'} aria-label="Run cell" onClick={() => nb.run(id, 'stay')}>
            <Play size={14} />
          </button>
        ) : (
          <button className="k-icon-btn" title="Edit" aria-label="Edit cell" onClick={edit}>
            <Pencil size={14} />
          </button>
        )}
        <button className="k-icon-btn" title="Move up" aria-label="Move cell up" onClick={() => nb.move(-1, id)}>
          <ArrowUp size={14} />
        </button>
        <button className="k-icon-btn" title="Move down" aria-label="Move cell down" onClick={() => nb.move(1, id)}>
          <ArrowDown size={14} />
        </button>
        <button className="k-icon-btn" title="Delete cell" aria-label="Delete cell" onClick={() => nb.remove(id)}>
          <Trash2 size={14} />
        </button>
      </div>

      <div className="nb-row">
        <div className={`nb-prompt ${isCode ? 'in' : 'kind'}`}>{prompt}</div>
        <div className="nb-main">
          {showEditor && (
            <div className="nb-input">
              <CellEditor key={type} nb={nb} cell={cell} />
            </div>
          )}
          {type === 'markdown' && !cell.editing && <MarkdownView source={cell.source} baseDir={baseDir} onEdit={edit} />}
          {type === 'latex' && (!cell.editing || !!cell.source.trim()) && (
            <LatexView source={cell.source} preview={cell.editing} onEdit={edit} />
          )}
          {cell.note && (
            <div className="nb-note">
              <LoaderCircle size={13} className="k-spin" />
              <span>{cell.note}</span>
            </div>
          )}
        </div>
      </div>

      {isCode && cell.outputs.length > 0 && <OutputArea outputs={cell.outputs} />}
    </div>
  )
})
