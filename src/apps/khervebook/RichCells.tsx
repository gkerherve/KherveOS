// The desktop's Note, File, KFit, KherveTeX-document and Molecule cells
// (notecell.py, filecell.py, kfitcell.py, ktexcell.py, molcell.py). Each
// view keeps its cell's JSON document up to date and registers what the
// toolbar's second row asks of it (desktop CellToolBar → cell methods).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent } from 'react'
import { useStore } from 'zustand'
import DOMPurify from 'dompurify'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { os } from '@/os'
import { basename, extname, join } from '@/os/path'
import { compileLatex } from '@/os/services/latex'
import { openPdf } from '@/os/services/pdf'
import type { Cell } from './format'
import type { Notebook } from './notebook'
import { Mdi } from './mdi'
import {
  FILE_ICONS, IMAGE_EXT, asText, bytesToB64, extOf, filesSource, humanSize, kfReference, kfitSource, ktexSource, molAtoms, molFormula,
  molSketch, molSource, noteBody, noteBodyStyle, noteSource, parseFiles, parseKfit, parseKtex, parseMol, parseNote, snippet, subscriptDigits,
  type Attachment, type Ink, type KfitDoc, type KtexDoc,
} from './cellfiles'

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp' }

/** Read a drive file the user picked into an attachment held in the cell (desktop _Attachment(data=…)). */
async function readAttachment(path: string): Promise<Attachment> {
  const bytes = await os.fs.readBytes(path)
  return { name: basename(path), size: bytes.length, embed: bytesToB64(bytes) }
}

function useHandle(nb: Notebook, id: string, h: Record<string, (...a: never[]) => unknown>) {
  const ref = useRef(h)
  ref.current = h
  useEffect(() => {
    const proxy = new Proxy({}, { get: (_t, k: string) => (ref.current[k] ? (...a: never[]) => ref.current[k](...a) : undefined) })
    return nb.registerHandle(id, proxy)
  }, [nb, id])
}

// ===================================================================== Note

/** Paragraph style → point size (desktop notecell._HEADING_SIZES). */
const HEADING_PT = [11, 22, 17, 14]

const SANITIZE = { ADD_ATTR: ['style', 'align'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed'] }

/** The html head and body tags Qt wrote, kept so a save writes the note back in the same shell. */
function shellOf(html: string): [string, string] {
  const m = /^([\s\S]*?<body[^>]*>)([\s\S]*?)(<\/body>[\s\S]*)$/i.exec(html)
  return m ? [m[1], m[3]] : ['', '']
}

export function NoteView({ nb, cell, onFocus }: { nb: Notebook; cell: Cell; onFocus: () => void }) {
  const { id } = cell
  const pageRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const emitted = useRef<string | null>(null)
  const range = useRef<Range | null>(null)
  const shell = useRef<[string, string]>(['', ''])
  const inkRef = useRef<Ink | null>(null)
  const [ink, setInk] = useState<Ink | null>(null)
  const [width, setWidth] = useState(0)
  const [cur, setCur] = useState<[number, number][] | null>(null)
  const tools = useStore(nb.note)
  const penOn = tools.pen === id

  // Load the document (not while it is our own echo).
  useLayoutEffect(() => {
    if (cell.source === emitted.current) return
    const doc = parseNote(cell.source)
    shell.current = shellOf(doc.html)
    const page = pageRef.current
    if (page) {
      page.innerHTML = DOMPurify.sanitize(noteBody(doc.html), SANITIZE)
      page.setAttribute('style', noteBodyStyle(doc.html))
    }
    inkRef.current = doc.ink
    setInk(doc.ink)
    emitted.current = cell.source
  }, [cell.source])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const save = (undoable = false) => {
    const page = pageRef.current
    if (!page) return
    const [head, tail] = shell.current
    const body = page.innerHTML
    const html = head ? head + body + tail : body
    const src = noteSource({ html, ink: inkRef.current })
    emitted.current = src
    nb.updateCell(id, src, undoable)
  }
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveSoon = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(), 250)
  }
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        save()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // ------------------------------------------------------ formatting
  const remember = () => {
    const sel = window.getSelection()
    const page = pageRef.current
    if (sel && sel.rangeCount && page && page.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange()
  }
  useEffect(() => {
    document.addEventListener('selectionchange', remember)
    return () => document.removeEventListener('selectionchange', remember)
  })
  /** Give the page its selection back, then run a rich-text command on it. */
  const exec = (fn: () => void) => {
    const page = pageRef.current
    if (!page) return
    page.focus({ preventScroll: true })
    const sel = window.getSelection()
    if (range.current && sel) {
      sel.removeAllRanges()
      sel.addRange(range.current)
    }
    document.execCommand('styleWithCSS', false, 'true')
    fn()
    remember()
    save(true)
  }
  const cmd = (name: string, value?: string) => () => exec(() => document.execCommand(name, false, value))
  /** Wrap the selection in a span with `style` (point sizes, which execCommand cannot do). */
  const styleSelection = (style: Partial<CSSStyleDeclaration>) =>
    exec(() => {
      const sel = window.getSelection()
      if (!sel || !sel.rangeCount) return
      const r = sel.getRangeAt(0)
      if (r.collapsed) {
        // desktop _merge: no selection → the word under the cursor
        const node = r.startContainer
        if (node.nodeType === Node.TEXT_NODE) {
          const t = node.textContent ?? ''
          let a = r.startOffset
          let b = r.startOffset
          while (a > 0 && /\w/.test(t[a - 1])) a--
          while (b < t.length && /\w/.test(t[b])) b++
          r.setStart(node, a)
          r.setEnd(node, b)
        }
        if (r.collapsed) return
      }
      const span = document.createElement('span')
      Object.assign(span.style, style)
      span.appendChild(r.extractContents())
      r.insertNode(span)
      sel.removeAllRanges()
      const nr = document.createRange()
      nr.selectNodeContents(span)
      sel.addRange(nr)
    })
  const block = (): HTMLElement | null => {
    const page = pageRef.current
    let n: Node | null = range.current?.startContainer ?? null
    while (n && n !== page) {
      if (n instanceof HTMLElement && /^(P|DIV|LI|H[1-6])$/.test(n.tagName)) return n
      n = n.parentNode
    }
    return null
  }
  const setHeading = (level: number) =>
    exec(() => {
      let b = block()
      if (!b) {
        document.execCommand('formatBlock', false, 'p')
        b = block()
      }
      if (!b) return
      // desktop set_heading: the paragraph's text in that size, bold for headings
      for (const el of [b, ...b.querySelectorAll<HTMLElement>('span')]) {
        el.style.fontSize = ''
        el.style.fontWeight = ''
      }
      b.style.fontSize = `${HEADING_PT[level] ?? 11}pt`
      b.style.fontWeight = level ? 'bold' : 'normal'
    })

  // ------------------------------------------------------------ ink
  const scale = ink?.ref_w && width ? width / ink.ref_w : 1
  const toInk = (e: RPointerEvent<SVGSVGElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect()
    const s = inkRef.current?.ref_w && width ? width / inkRef.current.ref_w : 1
    return [(e.clientX - r.left) / s, (e.clientY - r.top) / s]
  }
  const setInkAndSave = (next: Ink | null) => {
    inkRef.current = next
    setInk(next)
    save(true)
  }

  useHandle(nb, id, {
    toggleBold: cmd('bold'),
    toggleItalic: cmd('italic'),
    toggleUnderline: cmd('underline'),
    toggleStrike: cmd('strikeThrough'),
    bulletList: cmd('insertUnorderedList'),
    numberedList: cmd('insertOrderedList'),
    setAlign: (a: string) => exec(() => document.execCommand(a === 'center' ? 'justifyCenter' : a === 'right' ? 'justifyRight' : 'justifyLeft')),
    setColor: (c: string) => exec(() => document.execCommand('foreColor', false, c)),
    setHighlight: (c: string) => exec(() => document.execCommand('hiliteColor', false, c)),
    setFontFamily: (f: string) => styleSelection({ fontFamily: f }),
    setFontSize: (pt: number) => styleSelection({ fontSize: `${pt}pt` }),
    setHeading: (level: number) => setHeading(level),
    inkUndo: () => {
      const i = inkRef.current
      if (i?.strokes.length) setInkAndSave(i.strokes.length > 1 ? { ...i, strokes: i.strokes.slice(0, -1) } : null)
    },
    inkClear: () => inkRef.current && setInkAndSave(null),
  })

  return (
    <div ref={wrapRef} className="nb-note-wrap">
      <div
        ref={pageRef}
        className="nb-note-page"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onFocus={onFocus}
        onInput={saveSoon}
        onBlur={() => {
          if (saveTimer.current) {
            clearTimeout(saveTimer.current)
            saveTimer.current = null
          }
          save()
        }}
        onKeyDown={(e) => {
          // Shift+Enter runs a cell elsewhere; in a note it is a line break, like the desktop's QTextEdit.
          if (e.key === 'Escape') {
            e.preventDefault()
            nb.focus(id, 'command')
          }
          // Plain typing stays in the page; Ctrl/⌘ shortcuts reach the window (Save, Undo… as on the desktop).
          if (!e.ctrlKey && !e.metaKey) e.stopPropagation()
        }}
        onClick={(e) => {
          const a = (e.target as HTMLElement).closest('a')
          if (a && (e.metaKey || e.ctrlKey)) os.openUrl(a.href)
        }}
      />
      {(ink || cur || penOn) && (
        <svg
          className={`nb-ink${penOn ? ' on' : ''}`}
          onPointerDown={(e) => {
            if (!penOn || e.button !== 0) return
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            if (!inkRef.current?.ref_w) inkRef.current = { ref_w: width || 1, strokes: inkRef.current?.strokes ?? [] }
            setCur([toInk(e)])
          }}
          onPointerMove={(e) => cur && setCur([...cur, toInk(e)])}
          onPointerUp={() => {
            if (cur && cur.length > 1) {
              const base = inkRef.current ?? { ref_w: width || 1, strokes: [] }
              setInkAndSave({ ...base, strokes: [...base.strokes, { color: tools.inkColor, width: tools.inkWidth, pts: cur }] })
            }
            setCur(null)
          }}
        >
          {[...(ink?.strokes ?? []), ...(cur ? [{ color: tools.inkColor, width: tools.inkWidth, pts: cur }] : [])].map((s, i) => (
            <polyline
              key={i}
              points={s.pts.map(([x, y]) => `${x * scale},${y * scale}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={Math.max(1, s.width * scale)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      )}
    </div>
  )
}

// ===================================================================== File

interface Preview {
  kind: 'image' | 'text' | 'note'
  value: string
}

async function previewOf(nb: Notebook, a: Attachment): Promise<Preview> {
  const data = await nb.attachmentBytes(a)
  const ext = extOf(a.name)
  if (!data) return { kind: 'note', value: `(not found — expected ${a.path ?? a.name} beside the notebook)` }
  if (IMAGE_EXT.has(ext)) return { kind: 'image', value: URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[ext] ?? 'image/png' })) }
  const text = asText(data, ext)
  if (text !== null) return { kind: 'text', value: snippet(text) || '(empty file)' }
  return { kind: 'note', value: 'binary file — kept as-is (not previewed)' }
}

function FileRow({ nb, a, stem, onOpen, onSave, onRef, onRemove }: { nb: Notebook; a: Attachment; stem: string; onOpen: () => void; onSave: () => void; onRef: () => void; onRemove: () => void }) {
  const [p, setP] = useState<Preview | null>(null)
  useEffect(() => {
    let alive = true
    let url: string | null = null
    void previewOf(nb, a).then((v) => {
      if (v.kind === 'image') url = v.value
      if (alive) setP(v)
      else if (url) URL.revokeObjectURL(url)
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [nb, a])
  const where = a.path ? `stored in ${stem}_files` : 'kept in memory until the notebook is saved'
  return (
    <div className="nb-file-row">
      <div className="nb-file-top">
        <Mdi name={FILE_ICONS[extOf(a.name)] ?? 'mdi.file-outline'} size={28} />
        <div className="nb-file-meta">
          <b>{a.name}</b>
          <span>
            {humanSize(a.size)} · {where}
          </span>
        </div>
        {(
          [
            ['Open', 'mdi.open-in-new', onOpen],
            ['Save a copy…', 'mdi.content-save-outline', onSave],
            ['Copy kf() reference', 'mdi.code-tags', onRef],
            ['Remove', 'mdi.delete-outline', onRemove],
          ] as const
        ).map(([tip, icon, fn]) => (
          <button key={tip} className="nb-file-tool" title={tip} aria-label={tip} onMouseDown={(e) => e.preventDefault()} onClick={fn}>
            <Mdi name={icon} size={20} />
          </button>
        ))}
      </div>
      {p?.kind === 'image' && <img className="nb-file-thumb" src={p.value} alt={a.name} draggable={false} />}
      {p?.kind === 'text' && <pre className="nb-file-text">{p.value}</pre>}
      {p?.kind === 'note' && <div className="nb-file-note">{p.value}</div>}
    </div>
  )
}

export function FileView({ nb, cell }: { nb: Notebook; cell: Cell }) {
  const { id } = cell
  const files = useMemo(() => parseFiles(cell.source), [cell.source])
  const { stem } = nb.docPlace()
  const setFiles = (next: Attachment[]) => nb.updateCell(id, filesSource(next), true)
  const attach = async (path: string) => {
    try {
      const a = await readAttachment(path)
      const now = parseFiles(nb.cell(id)?.source ?? '')
      setFiles([...now.filter((x) => x.name !== a.name), a])
      return true
    } catch (e) {
      nb.showFlash(`Could not attach ${basename(path)}: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }
  const choose = async () => {
    const p = await os.dialog.openFile({ title: 'Attach files', startDir: nb.baseDir() })
    if (p) await attach(p)
    nb.refocusSoon()
  }
  const open = async (a: Attachment) => {
    const p = await nb.attachmentPath(id, a)
    if (p) void os.openFile(p)
    else nb.showFlash(`${a.name} is missing.`)
  }
  const saveCopy = async (a: Attachment) => {
    const dest = await os.dialog.saveFile({ title: 'Save a copy', defaultName: join(nb.baseDir(), a.name) })
    const data = dest ? await nb.attachmentBytes(a) : null
    if (dest && data) await os.fs.writeBytes(dest, data, { mkdirs: true })
    nb.refocusSoon()
  }
  const copyRef = (a: Attachment) => {
    void navigator.clipboard?.writeText(kfReference(a.name)).then(
      () => nb.showFlash(`Copied ${kfReference(a.name)}`),
      () => nb.showFlash(kfReference(a.name)),
    )
  }
  useHandle(nb, id, {
    chooseFile: () => void choose(),
    attach: (p: string) => attach(p),
    openFile: () => files[0] && void open(files[0]),
    saveCopy: () => files[0] && void saveCopy(files[0]),
    copyReference: () => files[0] && copyRef(files[0]),
  })
  const n = files.length
  return (
    <div className="nb-file">
      <div className="nb-file-head">
        <b>{n === 0 ? 'No files attached' : `${n} attached file${n !== 1 ? 's' : ''}`}</b>
        <button className="k-btn nb-file-add" onMouseDown={(e) => e.preventDefault()} onClick={() => void choose()}>
          <Mdi name="mdi.paperclip" size={16} />
          Add files…
        </button>
      </div>
      {files.map((a) => (
        <FileRow
          key={a.name}
          nb={nb}
          a={a}
          stem={stem}
          onOpen={() => void open(a)}
          onSave={() => void saveCopy(a)}
          onRef={() => copyRef(a)}
          onRemove={() => setFiles(files.filter((x) => x !== a))}
        />
      ))}
      <div className="nb-file-hint">
        {n === 0
          ? `Drag files here, or click “Add files…”. Saving the notebook copies them into its ${stem}_files folder, where a code cell can open them.`
          : 'Use  kf("name")  in a code cell for a file\'s path — e.g.  pd.read_csv(kf("data.csv")).'}
      </div>
    </div>
  )
}

// ===================================================================== KFit

interface KfitResult {
  ok?: boolean
  names?: string[]
  sheet?: string
  info?: string
  hint?: string
  png?: string
  headers?: string[]
  rows?: string[][]
  nrows?: number
}

export function KfitView({ nb, cell }: { nb: Notebook; cell: Cell }) {
  const { id } = cell
  const doc = useMemo(() => parseKfit(cell.source), [cell.source])
  const [res, setRes] = useState<KfitResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState(0)
  const set = (p: Partial<KfitDoc>, undoable = false) => {
    const now = parseKfit(nb.cell(id)?.source ?? '')
    nb.updateCell(id, kfitSource({ ...now, ...p }), undoable)
  }
  const fileKey = doc.file ? `${doc.file.name}|${doc.file.size}|${doc.file.path ?? ''}|${doc.file.embed?.length ?? 0}|${doc.file.embed?.slice(-32) ?? ''}` : ''
  useEffect(() => {
    let alive = true
    const f = doc.file
    if (!f) {
      setRes({ hint: 'No project loaded. Drop a .kfit file here, or click “Load .kfit…”.' })
      return
    }
    setBusy(true)
    void (async () => {
      const path = await nb.attachmentPath(id, f)
      if (!path) return { hint: `(not found — expected ${f.path ?? f.name} beside the notebook)` }
      return (await nb.kfitView(path, doc.sheet, doc.view, f.name)) as KfitResult
    })()
      .then((r) => alive && setRes(r))
      .catch((e) => alive && setRes({ hint: e instanceof Error ? e.message : String(e) }))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nb, id, fileKey, doc.sheet, doc.view, token])
  const attach = async (path: string) => {
    if (extname(path).toLowerCase() !== '.kfit') {
      setRes((r) => ({ ...r, hint: `A KFit cell holds KherveFitting projects only — ${basename(path)} is not a .kfit. Drop it on the notebook background instead.` }))
      return false
    }
    const a = await readAttachment(path)
    set({ file: a, origin: path }, true)
    return true
  }
  const choose = async () => {
    const p = await os.dialog.openFile({ title: 'Open a KherveFitting project', extensions: ['.kfit'], startDir: nb.baseDir() })
    if (p) await attach(p)
    nb.refocusSoon()
  }
  const refresh = async () => {
    // desktop refresh(): re-read the file from where it was loaded (a re-fit done elsewhere)
    if (doc.origin && os.fs.isFile(doc.origin)) {
      const a = await readAttachment(doc.origin)
      set({ file: a })
    }
    setToken((t) => t + 1)
  }
  useHandle(nb, id, {
    chooseFile: () => void choose(),
    attach: (p: string) => attach(p),
    refresh: () => void refresh(),
    showView: (v: 'plot' | 'data') => set({ view: v }),
  })
  const names = res?.names ?? []
  return (
    <div className="nb-kfit">
      <div className="nb-kfit-head">
        <select
          className="k-input nb-kfit-sheet"
          title="Which sheet of the project to show"
          disabled={!names.length}
          value={res?.sheet ?? ''}
          onChange={(e) => set({ sheet: e.target.value })}
        >
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="nb-kfit-info">{res?.info ?? ''}</span>
        <button className="k-btn" title="Re-read the .kfit from disk — after re-fitting it elsewhere" onMouseDown={(e) => e.preventDefault()} onClick={() => void refresh()}>
          <Mdi name="mdi.refresh" size={16} />
          Refresh
        </button>
        <button
          className="k-btn"
          title="Open this project in KherveFitting and reload it on save"
          disabled={!doc.file}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void nb.openInApp(id, 'khervefitting')}
        >
          <Mdi name="mdi.chart-bell-curve" size={16} />
          Open in KherveFitting
        </button>
        <button className="k-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => void choose()}>
          <Mdi name="mdi.folder-open-outline" size={16} />
          Load .kfit…
        </button>
      </div>
      <div className="nb-tabs" role="tablist">
        {(['plot', 'data'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={doc.view === v} className={`nb-tab${doc.view === v ? ' on' : ''}`} onClick={() => set({ view: v })}>
            {v === 'plot' ? 'Plot' : 'Data'}
          </button>
        ))}
        {busy && <span className="nb-kfit-busy">Reading the project…</span>}
      </div>
      <div className="nb-kfit-body">
        {doc.view === 'plot' && res?.png && <img className="nb-kfit-plot" src={`data:image/png;base64,${res.png}`} alt={res.sheet ?? 'plot'} draggable={false} />}
        {doc.view === 'data' && res?.headers && (
          <div className="nb-kfit-table">
            <table>
              <thead>
                <tr>
                  <th />
                  {res.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(res.rows ?? []).map((r, i) => (
                  <tr key={i}>
                    <th>{i + 1}</th>
                    {r.map((v, j) => (
                      <td key={j}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {(res.nrows ?? 0) > (res.rows?.length ?? 0) && <div className="nb-file-note">… {res.nrows} rows in all (use kfit() in a code cell for every value)</div>}
          </div>
        )}
      </div>
      {res?.hint && <div className="nb-file-hint">{res.hint}</div>}
    </div>
  )
}

// ================================================================ KherveTeX

/** desktop ktexdoc._DEFAULT_META */
const KTEX_META = {
  title: 'Untitled', author: '', documentclass: 'article', class_options: '', packages: ['amsmath', 'amssymb', 'graphicx', 'multicol', 'float'],
  page_size: 'A4', margin_top_cm: 2.5, margin_bottom_cm: 2.5, margin_left_cm: 2.5, margin_right_cm: 2.5, body_font_pt: 12, body_font_family: 'default',
  visual_font_family: 'Georgia', line_spacing: 1.0, paragraph_indent: true, column_count: 1, frontmatter_extras: '', preamble_extras: '',
}

/** desktop ktexdoc.new_ktexz: a minimal KherveTeX document. */
export function newKtexz(title = 'Untitled document'): Uint8Array {
  const text = (s: string) => ({ text: s, marks: [], type: 'Text' })
  const doc = {
    children: [
      { level: 1, children: [text('Introduction')], numbered: true, label: null, type: 'Section' },
      {
        children: [text('Start writing here. Open this document in KherveTeX to edit it; the notebook shows the typeset pages.')],
        alignment: 'justify',
        type: 'Paragraph',
      },
    ],
    meta: { ...KTEX_META, title },
    type: 'Document',
  }
  return zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'kdocz', schema_version: 1, app: 'KherveTeX' }, null, 2)),
    'document.json': strToU8(JSON.stringify(doc, null, 2)),
  })
}

/** desktop ktexdoc.title_of */
function ktexTitle(name: string, data: Uint8Array | null): string {
  if (!data) return name
  try {
    if (/\.tex$/i.test(name)) {
      const m = /\\title\{([^}]*)\}/.exec(new TextDecoder().decode(data))
      return m?.[1]?.replace(/\\[a-z]+\s*/gi, '').trim() || name
    }
    const files = unzipSync(data, { filter: (f) => f.name === 'document.json' })
    const doc = JSON.parse(new TextDecoder().decode(files['document.json'])) as { children?: { type?: string; children?: { text?: string }[] }[]; meta?: { title?: string } }
    let title = ''
    for (const b of doc.children ?? []) {
      if (b?.type === 'Title') {
        title = (b.children ?? []).map((n) => n?.text ?? '').join('').trim()
        break
      }
    }
    if (!title) title = String(doc.meta?.title ?? '')
    return title && title !== 'Untitled' ? title : name
  } catch {
    return name
  }
}

async function pdfPages(pdf: Uint8Array): Promise<string[]> {
  const doc = await openPdf(pdf)
  try {
    const out: string[] = []
    for (let i = 0; i < doc.pageCount; i++) {
      const bmp = await doc.renderPage(i, 110 / 72)
      const canvas = document.createElement('canvas')
      canvas.width = bmp.width
      canvas.height = bmp.height
      canvas.getContext('2d')?.drawImage(bmp, 0, 0)
      bmp.close()
      out.push(canvas.toDataURL('image/png'))
    }
    return out
  } finally {
    doc.close()
  }
}

export function KtexView({ nb, cell }: { nb: Notebook; cell: Cell }) {
  const { id } = cell
  const doc = useMemo(() => parseKtex(cell.source), [cell.source])
  const [pages, setPages] = useState<string[]>([])
  const [title, setTitle] = useState('KherveTeX document')
  const [hint, setHint] = useState('')
  const [page, setPage] = useState(doc.page)
  const [token, setToken] = useState(0)
  const deskRef = useRef<HTMLDivElement>(null)
  const set = (p: Partial<KtexDoc>, undoable = false) => {
    const now = parseKtex(nb.cell(id)?.source ?? '')
    nb.updateCell(id, ktexSource({ ...now, ...p }), undoable)
  }
  const f = doc.file
  const fileKey = f ? `${f.name}|${f.size}|${f.path ?? ''}|${f.embed?.length ?? 0}` : ''
  useEffect(() => {
    let alive = true
    if (!f) {
      setPages([])
      setTitle('KherveTeX document')
      setHint('')
      return
    }
    void (async () => {
      const data = await nb.attachmentBytes(f)
      if (!alive) return
      setTitle(ktexTitle(f.name, data))
      if (!data) return setHint(`Not found: ${f.path ?? f.name}`)
      // desktop ktexdoc.pdf_source: a current PDF beside the document, else its .tex to typeset.
      const near = [doc.origin, f.path ? join(nb.docPlace().dir ?? '', f.path) : ''].filter((p) => p && os.fs.isFile(p))
      const sib = (ext: string) => near.map((p) => p.slice(0, -extname(p).length) + ext).find((p) => os.fs.isFile(p))
      const pdf = sib('.pdf')
      const tex = /\.tex$/i.test(f.name) ? null : sib('.tex')
      let bytes: Uint8Array | null = null
      if (pdf) {
        setHint('Loading pages…')
        bytes = await os.fs.readBytes(pdf)
      } else if (/\.tex$/i.test(f.name) || tex) {
        setHint('Typesetting with tectonic…  (the first run downloads LaTeX packages)')
        const src = tex ? await os.fs.readText(tex) : new TextDecoder().decode(data)
        const r = await compileLatex('document.tex', { 'document.tex': src })
        if (!r.pdf) {
          if (alive) setHint('Could not show the pages. ' + r.log.trim().split('\n').slice(-6).join('\n'))
          return
        }
        bytes = r.pdf
      } else {
        setPages([])
        setHint('No typeset pages yet: open the document in KherveTeX and export it as PDF beside the .ktexz (or keep its .tex there) — the web edition cannot typeset a .ktexz by itself.')
        return
      }
      const imgs = await pdfPages(bytes)
      if (!alive) return
      setPages(imgs)
      setHint(`${imgs.length} page${imgs.length !== 1 ? 's' : ''} ${pdf ? 'from the PDF beside the document' : 'typeset with tectonic'}.`)
    })().catch((e) => alive && setHint(`Could not show the pages. ${e instanceof Error ? e.message : String(e)}`))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nb, id, fileKey, doc.origin, token])
  const go = (i: number) => {
    const n = pages.length
    if (!n) return
    const k = Math.max(0, Math.min(n - 1, i))
    setPage(k)
    set({ page: k })
    const el = deskRef.current?.children[k] as HTMLElement | undefined
    if (el && deskRef.current) deskRef.current.scrollTop = el.offsetTop - 8
  }
  const attach = async (path: string) => {
    if (!/\.(ktexz|kdocz|tex)$/i.test(path)) {
      setHint(`${basename(path)} is not a KherveTeX document (.ktexz) or a .tex file.`)
      return false
    }
    set({ file: await readAttachment(path), origin: path, page: 0 }, true)
    return true
  }
  const choose = async () => {
    const p = await os.dialog.openFile({ title: 'Insert a KherveTeX document', extensions: ['.ktexz', '.kdocz', '.tex'], startDir: nb.baseDir() })
    if (p) await attach(p)
    nb.refocusSoon()
  }
  useHandle(nb, id, {
    newDocument: () => {
      const data = newKtexz()
      set({ file: { name: 'document.ktexz', size: data.length, embed: bytesToB64(data) }, origin: '', page: 0 }, true)
    },
    chooseFile: () => void choose(),
    attach: (p: string) => attach(p),
    refresh: () => setToken((t) => t + 1),
  })
  const where = f ? (f.path ? `${nb.docPlace().stem}_files` : 'kept with the notebook until it is saved') : ''
  return (
    <div className="nb-ktex">
      <div className="nb-ktex-bar">
        <Mdi name="mdi.file-document-outline" size={26} color="#2c5d8f" />
        <div className="nb-ktex-names">
          <b>{title}</b>
          <span>{f ? `${f.name}  ·  ${where}` : 'No document yet — create a new one or insert an existing .ktexz / .tex'}</span>
        </div>
        <button className="nb-file-tool" title="Previous page" disabled={!pages.length || page <= 0} onClick={() => go(page - 1)}>
          <Mdi name="mdi.chevron-up" size={20} />
        </button>
        <span className="nb-ktex-page">{pages.length ? `Page ${page + 1} / ${pages.length}` : ''}</span>
        <button className="nb-file-tool" title="Next page" disabled={!pages.length || page >= pages.length - 1} onClick={() => go(page + 1)}>
          <Mdi name="mdi.chevron-down" size={20} />
        </button>
        <span className="nb-ktex-sep" />
        <button className="nb-file-tool" title="New KherveTeX document" onClick={() => nb.callCell(id, 'newDocument')}>
          <Mdi name="mdi.file-plus-outline" size={20} />
        </button>
        <button className="nb-file-tool" title="Insert an existing .ktexz or .tex document" onClick={() => void choose()}>
          <Mdi name="mdi.folder-open-outline" size={20} />
        </button>
        <button className="nb-file-tool" title="Re-read the document and its pages" onClick={() => setToken((t) => t + 1)}>
          <Mdi name="mdi.refresh" size={20} />
        </button>
        <button className="k-btn" title="Open this document in KherveTeX — saving there updates the cell" disabled={!f} onClick={() => void nb.openInApp(id, 'khervetex')}>
          <Mdi name="mdi.pencil-outline" size={16} />
          Edit in KherveTeX
        </button>
      </div>
      <div
        ref={deskRef}
        className="nb-ktex-desk"
        onScroll={(e) => {
          const desk = e.currentTarget
          const kids = [...desk.children] as HTMLElement[]
          const k = kids.findIndex((el) => el.offsetTop + el.offsetHeight / 2 > desk.scrollTop)
          if (k >= 0 && k !== page) setPage(k)
        }}
      >
        {pages.map((src, i) => (
          <img key={i} className="nb-ktex-pg" src={src} alt={`Page ${i + 1}`} draggable={false} />
        ))}
      </div>
      {hint && <div className="nb-file-hint">{hint}</div>}
    </div>
  )
}

// ================================================================= Molecule

/** CPK colours and covalent-ish radii (Å) for the ball-and-stick view. */
const ELEMENT: Record<string, [string, number]> = {
  H: ['#ffffff', 0.31], C: ['#909090', 0.76], N: ['#3050f8', 0.71], O: ['#ff0d0d', 0.66], F: ['#90e050', 0.57], P: ['#ff8000', 1.07],
  S: ['#ffff30', 1.05], Cl: ['#1ff01f', 1.02], Br: ['#a62929', 1.2], I: ['#940094', 1.39], B: ['#ffb5b5', 0.84], Si: ['#f0c8a0', 1.11],
  Na: ['#ab5cf2', 1.66], K: ['#8f40d4', 2.03], Mg: ['#8aff00', 1.41], Ca: ['#3dff00', 1.76], Fe: ['#e06633', 1.32], Cu: ['#c88033', 1.32],
  Zn: ['#7d80b0', 1.22], Ti: ['#bfc2c7', 1.6], Al: ['#bfa6a6', 1.21], Li: ['#cc80ff', 1.28], Ni: ['#50d050', 1.24], Co: ['#f090a0', 1.26],
  Au: ['#ffd123', 1.36], Ag: ['#c0c0c0', 1.45], Pt: ['#d0d0e0', 1.36],
}
const elem = (e: string): [string, number] => ELEMENT[e] ?? ['#ff1493', 1.0]

function Mol3D({ atoms, bonds }: { atoms: { el: string; x: number; y: number; z: number }[]; bonds: [number, number, number][] }) {
  const [rot, setRot] = useState<[number, number]>([0.35, -0.5])
  const [zoom, setZoom] = useState(1)
  const drag = useRef<{ x: number; y: number; r: [number, number] } | null>(null)
  const W = 640
  const H = 400
  const view = useMemo(() => {
    if (!atoms.length) return null
    const cx = atoms.reduce((s, a) => s + a.x, 0) / atoms.length
    const cy = atoms.reduce((s, a) => s + a.y, 0) / atoms.length
    const cz = atoms.reduce((s, a) => s + a.z, 0) / atoms.length
    const [ax, ay] = rot
    const [sa, ca, sb, cb] = [Math.sin(ax), Math.cos(ax), Math.sin(ay), Math.cos(ay)]
    const pts = atoms.map((a) => {
      const x = a.x - cx
      const y = a.y - cy
      const z = a.z - cz
      const x1 = x * cb + z * sb
      const z1 = -x * sb + z * cb
      const y2 = y * ca - z1 * sa
      const z2 = y * sa + z1 * ca
      return { x: x1, y: y2, z: z2 }
    })
    const ext = Math.max(1, ...pts.map((p) => Math.hypot(p.x, p.y)))
    const k = (Math.min(W, H) / 2 / (ext + 1.2)) * zoom
    return { pts, k }
  }, [atoms, rot, zoom])
  if (!view) return <div className="nb-mol-empty">No molecule yet — open KherveMol to build one, or drop a .kmol here.</div>
  const { pts, k } = view
  const order = pts.map((_p, i) => i).sort((a, b) => pts[a].z - pts[b].z)
  const P = (i: number) => [W / 2 + pts[i].x * k, H / 2 - pts[i].y * k] as const
  return (
    <svg
      className="nb-mol-3d"
      viewBox={`0 0 ${W} ${H}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, r: rot }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d) setRot([d.r[0] + (e.clientY - d.y) * 0.01, d.r[1] + (e.clientX - d.x) * 0.01])
      }}
      onPointerUp={() => (drag.current = null)}
      onWheel={(e: WheelEvent) => setZoom((z) => Math.min(6, Math.max(0.3, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))))}
    >
      <defs>
        {[...new Set(atoms.map((a) => a.el))].map((e) => (
          <radialGradient key={e} id={`kbmol-${e}`} cx="35%" cy="35%" r="65%">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="0.35" stopColor={elem(e)[0]} />
            <stop offset="1" stopColor={elem(e)[0]} stopOpacity="0.75" />
          </radialGradient>
        ))}
      </defs>
      {bonds.map(([i, j, o], n) => {
        const [x1, y1] = P(i)
        const [x2, y2] = P(j)
        return <line key={n} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#8a8f96" strokeWidth={Math.max(2, k * (o > 1 ? 0.16 : 0.11))} strokeLinecap="round" />
      })}
      {order.map((i) => {
        const [x, y] = P(i)
        const [, r] = elem(atoms[i].el)
        return <circle key={i} cx={x} cy={y} r={Math.max(3, r * 0.42 * k)} fill={`url(#kbmol-${atoms[i].el})`} stroke="#33373d" strokeWidth={0.6} />
      })}
    </svg>
  )
}

function Mol2D({ sketch }: { sketch: { atoms: { el: string; x: number; y: number }[]; bonds: [number, number, number][] } }) {
  const { atoms, bonds } = sketch
  if (!atoms.length) return <div className="nb-mol-empty">No 2D sketch in this molecule — draw one in KherveMol (2D Sketch).</div>
  const xs = atoms.map((a) => a.x)
  const ys = atoms.map((a) => a.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const pad = 30
  const W = 640
  const H = 400
  const k = Math.min((W - 2 * pad) / Math.max(1e-6, x1 - x0), (H - 2 * pad) / Math.max(1e-6, y1 - y0), 60)
  const P = (i: number) => [W / 2 + (atoms[i].x - (x0 + x1) / 2) * k, H / 2 + (atoms[i].y - (y0 + y1) / 2) * k] as const
  const label = (e: string) => e !== 'C'
  return (
    <svg className="nb-mol-2d" viewBox={`0 0 ${W} ${H}`}>
      {bonds.map(([i, j, o], n) => {
        const [ax, ay] = P(i)
        const [bx, by] = P(j)
        const dx = by - ay
        const dy = ax - bx
        const len = Math.hypot(dx, dy) || 1
        const off = (s: number) => [(dx / len) * s, (dy / len) * s]
        const lines = o >= 3 ? [0, 4, -4] : o === 2 ? [2.5, -2.5] : [0]
        return lines.map((s, m) => {
          const [ox, oy] = off(s)
          return <line key={`${n}-${m}`} x1={ax + ox} y1={ay + oy} x2={bx + ox} y2={by + oy} stroke="#222" strokeWidth={1.6} />
        })
      })}
      {atoms.map((a, i) => {
        if (!label(a.el)) return null
        const [x, y] = P(i)
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={9} fill="#fff" />
            <text x={x} y={y + 5} textAnchor="middle" fontSize="15" fill={a.el === 'H' ? '#222' : elem(a.el)[0] === '#ffffff' ? '#222' : elem(a.el)[0]}>
              {a.el}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function MolView({ nb, cell }: { nb: Notebook; cell: Cell }) {
  const { id } = cell
  const doc = useMemo(() => parseMol(cell.source), [cell.source])
  const mol = useMemo(() => molAtoms(doc.kmol), [doc.kmol])
  const sketch = useMemo(() => molSketch(doc.kmol), [doc.kmol])
  const formula = molFormula(mol.atoms.length ? mol.atoms : sketch.atoms)
  const [query, setQuery] = useState(doc.query)
  const setView = (view: '3d' | '2d') => {
    const now = parseMol(nb.cell(id)?.source ?? '')
    nb.updateCell(id, molSource({ ...now, view }))
  }
  const attach = async (path: string) => {
    if (extname(path).toLowerCase() !== '.kmol') return false
    try {
      const kmol = JSON.parse(await os.fs.readText(path)) as Record<string, never>
      nb.updateCell(id, molSource({ ...parseMol(nb.cell(id)?.source ?? ''), kmol }), true)
      return true
    } catch {
      return false
    }
  }
  useHandle(nb, id, { showView: (v: '3d' | '2d') => setView(v), attach: (p: string) => attach(p), refresh: () => undefined })
  return (
    <div className="nb-mol">
      <div className="nb-mol-bar">
        <div className="nb-mol-head">
          <Mdi name="mdi.molecule" size={26} color="#1f8a78" />
          <div className="nb-ktex-names">
            <b>{mol.name || (mol.atoms.length || sketch.atoms.length ? 'Molecule' : 'No molecule yet')}</b>
            <span>{formula ? subscriptDigits(formula) : 'Type a name, SMILES or formula below'}</span>
          </div>
          {(['3d', '2d'] as const).map((v) => (
            <button
              key={v}
              className={`nb-mol-mode${doc.view === v ? ' on' : ''}`}
              title={v === '3d' ? 'Ball-and-stick 3D view' : 'Skeletal 2D sketch'}
              aria-pressed={doc.view === v}
              onClick={() => setView(v)}
            >
              {v.toUpperCase()}
            </button>
          ))}
          <button className="nb-file-tool" title="Show the 3D building tools (in KherveMol)" disabled>
            <Mdi name="mdi.tools" size={20} />
          </button>
          <button className="k-btn" title="Edit in KherveMol; saving there updates this cell" onClick={() => void nb.openInApp(id, 'khervemol')}>
            <Mdi name="mdi.open-in-new" size={16} />
            Open in KherveMol
          </button>
        </div>
        <div className="nb-mol-entry">
          <input
            className="k-input"
            placeholder="Name, SMILES or formula — e.g. caffeine, c1ccccc1, C2H6O"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button
            className="k-btn"
            title="Building from a name, SMILES or formula needs KherveMol's engine: open the cell in KherveMol and use its Build box"
            onClick={() => nb.showFlash('Build is done in KherveMol in the web edition: click “Open in KherveMol”.')}
          >
            <Mdi name="mdi.hammer-wrench" size={16} />
            Build
          </button>
        </div>
      </div>
      <div className="nb-mol-stage">{doc.view === '3d' ? <Mol3D atoms={mol.atoms} bonds={mol.bonds} /> : <Mol2D sketch={sketch} />}</div>
    </div>
  )
}

// ============================================================ shared bits

/** A file dropped on one of these cells goes into it (desktop dropEvent of File / KFit / KherveTeX / Molecule cells). */
export const DROPS_INTO: Record<string, (path: string) => boolean> = {
  file: () => true,
  kfit: (p) => /\.kfit$/i.test(p),
  ktex: (p) => /\.(ktexz|kdocz|tex)$/i.test(p),
  mol: (p) => /\.kmol$/i.test(p),
}

