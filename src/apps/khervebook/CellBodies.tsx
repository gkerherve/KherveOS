// What each cell type shows: rendered Markdown and LaTeX, SVG drawings,
// JavaScript pages, desktop-only cells, and code outputs.

import { Fragment, memo, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { useStore } from 'zustand'
import DOMPurify from 'dompurify'
import { CircleAlert, Info } from 'lucide-react'
import { os } from '@/os'
import { mimeType } from '@/os/fileIcons'
import { resolve } from '@/os/path'
import type { Cell, Output } from './format'
import { BLANK_SVG, type Notebook } from './notebook'
import { svgViewBox } from './edit'
import { cleanText, fitInlineColors, imageSrc, renderLatex, renderMarkdown, svgUrl } from './render'

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

/** Links open in the KherveOS Browser (web) or with their app (drive files). */
function followLink(e: MouseEvent, baseDir: string) {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  const href = a.getAttribute('href') ?? ''
  e.preventDefault()
  if (/^(https?:\/\/|mailto:)/i.test(href)) os.openUrl(href, { background: e.metaKey || e.ctrlKey })
  else if (href && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    const p = drivePath(baseDir, href)
    if (os.fs.exists(p)) void os.openFile(p)
    else void os.dialog.alert(`"${p}" doesn't exist.`, { title: 'KherveBook' })
  }
}

export function MarkdownView({ source, baseDir, onEdit }: { source: string; baseDir: string; onEdit: () => void }) {
  const html = useMemo(() => (source.trim() ? renderMarkdown(source) : ''), [source])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    fitInlineColors(root)
    // ![plot](plot.png): images on the drive are read from the file system.
    const imgs = root.querySelectorAll<HTMLImageElement>('img[data-nb-src]')
    if (!imgs.length) return
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

  if (!html) {
    return (
      <div className="nb-md nb-placeholder" onDoubleClick={onEdit}>
        Empty Markdown cell. Double-click to write.
      </div>
    )
  }
  return <div ref={ref} className="nb-md" onClick={(e) => followLink(e, baseDir)} onDoubleClick={onEdit} dangerouslySetInnerHTML={{ __html: html }} />
}

export function LatexView({ source, preview, onEdit }: { source: string; preview: boolean; onEdit: () => void }) {
  const r = useMemo(() => renderLatex(source), [source])
  if (!source.trim()) {
    return (
      <div className="nb-tex nb-placeholder" onDoubleClick={onEdit}>
        Empty LaTeX cell. Double-click to write an equation or a document.
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
  return (
    <div
      className={`${r.document ? 'nb-texdoc-wrap' : 'nb-tex'}${preview ? ' preview' : ''}`}
      onDoubleClick={onEdit}
      dangerouslySetInnerHTML={{ __html: r.html }}
    />
  )
}

// ------------------------------------------------------------- drawings

const MAX_DRAWING_H = 640
const f1 = (v: number) => (Math.round(v * 10) / 10).toString()
const xmlText = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type Draft = { kind: 'pen'; pts: [number, number][] } | { kind: 'line' | 'rect' | 'ellipse'; a: [number, number]; b: [number, number] }

/** The SVG element for a finished shape (desktop _shape_element), or null when it is too small. */
function shapeElement(d: Draft, color: string, width: number): string | null {
  const stroke = `stroke="${color}" stroke-width="${width}"`
  if (d.kind === 'pen') {
    if (d.pts.length < 2) return null
    const path = 'M ' + d.pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join(' L ')
    return `<path d="${path}" fill="none" ${stroke} stroke-linecap="round" stroke-linejoin="round"/>`
  }
  const [x1, y1] = d.a
  const [x2, y2] = d.b
  if (d.kind === 'line') {
    if (Math.hypot(x2 - x1, y2 - y1) < 1) return null
    return `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" ${stroke} stroke-linecap="round"/>`
  }
  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  const w = Math.abs(x2 - x1)
  const h = Math.abs(y2 - y1)
  if (w < 1 && h < 1) return null
  if (d.kind === 'rect') return `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="none" ${stroke}/>`
  return `<ellipse cx="${f1(x + w / 2)}" cy="${f1(y + h / 2)}" rx="${f1(w / 2)}" ry="${f1(h / 2)}" fill="none" ${stroke}/>`
}

/**
 * An SVG cell's drawing, fit to the cell's width (drawn as a picture: its
 * scripts never run). With a drawing tool chosen in the toolbar, shapes are
 * drawn on it and appended to the source as real SVG elements.
 */
export function SvgView({ nb, id, source, onEdit }: { nb: Notebook; id: string; source: string; onEdit: () => void }) {
  const src = source.trim() || BLANK_SVG
  const url = useMemo(() => svgUrl(src), [src])
  const [vx, vy, vw, vh] = useMemo(() => svgViewBox(src), [src])
  const tools = useStore(nb.svg)
  const [bad, setBad] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const drawing = tools.tool !== 'select'

  const toSvg = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = box.current?.getBoundingClientRect()
    if (!r || !r.width || !r.height) return [vx, vy]
    let x = vx + ((e.clientX - r.left) / r.width) * vw
    let y = vy + ((e.clientY - r.top) / r.height) * vh
    if (tools.snap && tools.gridSize > 0) {
      x = Math.round(x / tools.gridSize) * tools.gridSize
      y = Math.round(y / tools.gridSize) * tools.gridSize
    }
    return [x, y]
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!drawing || e.button !== 0) return
    e.preventDefault()
    nb.select(id)
    const p = toSvg(e)
    if (tools.tool === 'text') {
      void os.dialog.prompt('Text:', { title: 'Add text' }).then((t) => {
        if (t) nb.drawShape(id, `<text x="${f1(p[0])}" y="${f1(p[1])}" font-size="${Math.max(8, tools.width * 5)}" fill="${tools.color}">${xmlText(t)}</text>`)
      })
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const t = tools.tool
    if (t === 'pen') setDraft({ kind: 'pen', pts: [p] })
    else if (t === 'line' || t === 'rect' || t === 'ellipse') setDraft({ kind: t, a: p, b: p })
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draft) return
    const p = toSvg(e)
    setDraft(draft.kind === 'pen' ? { kind: 'pen', pts: [...draft.pts, p] } : { ...draft, b: p })
  }
  const onPointerUp = () => {
    if (!draft) return
    const el = shapeElement(draft, tools.color, tools.width)
    setDraft(null)
    if (el) nb.drawShape(id, el)
  }

  if (bad === url) {
    return (
      <div className="nb-drawing-bad" onDoubleClick={onEdit}>
        <CircleAlert size={14} /> Invalid SVG — double-click to edit the source.
      </div>
    )
  }
  const preview = draft ? shapeElement(draft, tools.color, tools.width) : null
  const grid: ReactNode[] = []
  if (tools.grid && tools.gridSize > 0 && (vw / tools.gridSize) * (vh / tools.gridSize) < 40000) {
    const s = tools.gridSize
    for (let i = 0, gx = Math.ceil(vx / s) * s; gx <= vx + vw; gx += s, i++)
      grid.push(<line key={`x${i}`} x1={gx} y1={vy} x2={gx} y2={vy + vh} className={Math.round(gx / s) % 5 ? 'fine' : 'bold'} />)
    for (let i = 0, gy = Math.ceil(vy / s) * s; gy <= vy + vh; gy += s, i++)
      grid.push(<line key={`y${i}`} x1={vx} y1={gy} x2={vx + vw} y2={gy} className={Math.round(gy / s) % 5 ? 'fine' : 'bold'} />)
  }
  return (
    <div className="nb-drawing" onDoubleClick={drawing ? undefined : onEdit} title={drawing ? undefined : 'Double-click to edit the SVG source'}>
      <div
        ref={box}
        className={`nb-drawing-box${drawing ? ' drawing' : ''}`}
        style={{ aspectRatio: `${vw} / ${vh}`, width: `min(100%, ${Math.round((MAX_DRAWING_H * vw) / vh)}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDraft(null)}
      >
        <img src={url} alt="Drawing" draggable={false} onError={() => setBad(url)} />
        {(grid.length > 0 || preview) && (
          <svg className="nb-drawing-overlay" viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="none">
            <g className="nb-drawing-grid">{grid}</g>
            {preview && <g dangerouslySetInnerHTML={{ __html: preview }} />}
          </svg>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ JavaScript

const HTML_HINTS = ['<html', '<body', '<svg', '<canvas', '<div', '<script', '<table', '<h1', '<h2', '<p>', '<style', '<!doctype']

function page(body: string): string {
  return (
    "<!DOCTYPE html><html><head><meta charset='utf-8'>" +
    '<style>body{margin:6px;font-family:system-ui,Arial,sans-serif}#kb_out{white-space:pre-wrap;color:#333}</style>' +
    `</head><body>${body}</body></html>`
  )
}

/**
 * A cell's contents as a page (desktop jscell.js_to_html): an HTML/JS snippet
 * loads as is, a bare JavaScript program is wrapped in a page whose
 * console.log output shows in the cell.
 */
export function jsToHtml(src: string): string {
  const low = src.toLowerCase()
  if (HTML_HINTS.some((h) => low.includes(h))) return low.includes('<html') || low.includes('<!doctype') ? src : page(src)
  return page(
    '<pre id="kb_out"></pre><script>\n' +
      'const _p=(...a)=>{document.getElementById("kb_out").textContent+=a.map(String).join(" ")+"\\n";};\n' +
      'console.log=_p;console.warn=_p;console.error=_p;\n' +
      'try{\n' +
      src +
      '\n}catch(e){_p("Error: "+e.message);}\n</script>',
  )
}

/** Tells the notebook how tall the page is, so the frame fits it. */
function sizeReporter(token: string): string {
  return (
    '<script>(function(){var t=' +
    JSON.stringify(token) +
    ';function s(){var b=document.body;if(!b)return;var r=b.getBoundingClientRect(),m=parseFloat(getComputedStyle(b).marginBottom)||0;' +
    'parent.postMessage({kbookFrame:t,h:Math.ceil(r.bottom+m+window.scrollY)},"*")}' +
    'addEventListener("load",s);if(window.ResizeObserver)new ResizeObserver(s).observe(document.body||document.documentElement);' +
    'setTimeout(s,60);setTimeout(s,600);setTimeout(s,2500)})()</script>'
  )
}

function withReporter(html: string, token: string): string {
  const i = html.toLowerCase().lastIndexOf('</body>')
  const tag = sizeReporter(token)
  return i < 0 ? html + tag : html.slice(0, i) + tag + html.slice(i)
}

/** A JavaScript cell's page, in a sandboxed frame (no access to KherveOS or its files). */
export function JsView({ source, runs }: { source: string; runs: number }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const token = useMemo(() => Math.random().toString(36).slice(2), [])
  const [height, setHeight] = useState(300)
  // The page is built when the cell runs, not on every keystroke.
  const html = useMemo(() => withReporter(jsToHtml(source), token), [runs, token]) // not `source`: only a run reloads
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const d = e.data as { kbookFrame?: string; h?: number } | null
      if (!d || d.kbookFrame !== token || typeof d.h !== 'number' || !Number.isFinite(d.h)) return
      const h = Math.min(1000, Math.max(60, Math.round(d.h)))
      setHeight((old) => (Math.abs(old - h) > 2 ? h : old))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [token])
  return (
    <iframe
      key={runs}
      ref={frame}
      className="nb-js-frame"
      title="JavaScript output"
      sandbox="allow-scripts"
      srcDoc={html}
      style={{ height }}
    />
  )
}

// --------------------------------------------------- desktop-only cells

const OTHER_LABEL: Record<string, string> = {
  note: 'A Note cell (rich text and pen)',
  file: 'A File cell (attached files)',
  kfit: 'A KherveFitting project (KFit cell)',
  ktex: 'A KherveTeX document',
  mol: 'A KherveMol molecule',
}

function otherDetail(type: string, source: string): { html?: string; text?: string } {
  let doc: Record<string, unknown> | null = null
  try {
    const v = JSON.parse(source) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) doc = v as Record<string, unknown>
  } catch {
    doc = null
  }
  if (!doc) return source.trim() ? { text: source.slice(0, 600) } : {}
  const name = (f: unknown) => (f && typeof f === 'object' ? String((f as Record<string, unknown>).name ?? '') : '')
  if (type === 'note' && typeof doc.html === 'string') return { html: DOMPurify.sanitize(doc.html) }
  if (type === 'file' && Array.isArray(doc.files)) return { text: `Attached: ${doc.files.map(name).filter(Boolean).join(', ') || 'no files'}` }
  if (type === 'file' && typeof doc.name === 'string') return { text: `Attached: ${doc.name}` }
  if ((type === 'kfit' || type === 'ktex') && doc.file) return { text: name(doc.file) }
  if (type === 'mol') {
    const mol = (doc.kmol as Record<string, unknown> | undefined)?.mol3d as Record<string, unknown> | undefined
    const label = mol?.label ?? mol?.name ?? doc.query
    return label ? { text: String(label) } : {}
  }
  return {}
}

/** A cell type the web version can't show yet: described, and kept unchanged. */
export function OtherView({ cell }: { cell: Cell }) {
  const type = cell.rawType ?? 'other'
  const detail = useMemo(() => otherDetail(type, cell.source), [type, cell.source])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) fitInlineColors(ref.current)
  }, [detail.html])
  return (
    <div className="nb-other">
      <div className="nb-other-head">
        <Info size={14} />
        <span>
          {OTHER_LABEL[type] ?? `A “${type}” cell`} from the desktop KherveBook. The web version can't edit it yet; it is kept unchanged when you save.
        </span>
      </div>
      {detail.html && <div ref={ref} className="nb-other-html" dangerouslySetInnerHTML={{ __html: detail.html }} />}
      {detail.text && <div className="nb-other-text">{detail.text}</div>}
    </div>
  )
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

export const OutputArea = memo(function OutputArea({ outputs }: { outputs: Output[] }) {
  return (
    <div className="nb-outputs">
      {outputs.map((o, i) => (
        <OutputView key={i} o={o} />
      ))}
    </div>
  )
})
