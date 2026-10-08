// The desktop's dialogs, as in-window modals: the QFormLayout dialogs of
// mainwindow.py (watermark, export images, encrypt, digital signature…),
// _EditTextDialog, the Git history and remote dialogs, About KhervePDF, Meet the
// Author, and a print preview.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { os } from '@/os'
import type { PdfDocument } from '@/os/services/pdf'
import { Icon, AppMark, type Glyph } from './icons'
import { formatCommitTime } from './logic'

export const VERSION = '0.75'

// ------------------------------------------------------------------ forms

export interface Field {
  key: string
  label: string
  value: string
  type?: 'text' | 'password' | 'number' | 'radio' | 'file'
  placeholder?: string
  /** number: QSpinBox range, step and suffix. */
  min?: number
  max?: number
  step?: number
  suffix?: string
  /** radio: the choices [value, label]. */
  options?: [string, string][]
  /** file: what Browse… does (returns a path or null). */
  browse?: () => Promise<string | null>
}

export interface FormSpec {
  title: string
  message?: string
  fields: Field[]
  /** A grey note under the fields. */
  hint?: string
  ok?: string
  resolve: (values: Record<string, string> | null) => void
}

export function FormDialog({ spec, onClose }: { spec: FormSpec; onClose: () => void }) {
  const [values, setValues] = useState(() => Object.fromEntries(spec.fields.map((f) => [f.key, f.value])))
  const done = (ok: boolean) => {
    onClose()
    spec.resolve(ok ? values : null)
  }
  const set = (k: string, v: string) => setValues((old) => ({ ...old, [k]: v }))
  return (
    <div className="kp-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && done(false)}>
      <form
        className="kp-modal kp-form"
        onSubmit={(e) => {
          e.preventDefault()
          done(true)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') done(false)
        }}
      >
        <div className="kp-modal-title">{spec.title}</div>
        {spec.message && <p className="kp-modal-hint" dangerouslySetInnerHTML={{ __html: spec.message }} />}
        {spec.fields.map((f, i) => (
          <div key={f.key} className="kp-form-row">
            <span>{f.label}</span>
            {f.type === 'radio' ? (
              <div className="kp-radios">
                {f.options!.map(([v, l]) => (
                  <label key={v} className="kp-check">
                    <input type="radio" name={f.key} checked={values[f.key] === v} onChange={() => set(f.key, v)} />
                    <span>{l}</span>
                  </label>
                ))}
              </div>
            ) : f.type === 'number' ? (
              <span className="kp-spin">
                <input
                  className="k-input"
                  type="number"
                  autoFocus={i === 0}
                  min={f.min}
                  max={f.max}
                  step={f.step ?? 1}
                  value={values[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                />
                {f.suffix && <span className="kp-suffix">{f.suffix}</span>}
              </span>
            ) : (
              <span className="kp-file-row">
                <input
                  className="k-input"
                  type={f.type === 'password' ? 'password' : 'text'}
                  autoFocus={i === 0}
                  value={values[f.key]}
                  placeholder={f.placeholder}
                  spellCheck={false}
                  onChange={(e) => set(f.key, e.target.value)}
                />
                {f.type === 'file' && (
                  <button type="button" className="k-btn" onClick={() => void f.browse?.().then((p) => p && set(f.key, p))}>Browse…</button>
                )}
              </span>
            )}
          </div>
        ))}
        {spec.hint && <p className="kp-modal-hint k-muted">{spec.hint}</p>}
        <div className="kp-modal-buttons">
          <span className="k-spacer" />
          <button type="submit" className="k-btn primary">{spec.ok ?? 'OK'}</button>
          <button type="button" className="k-btn" onClick={() => done(false)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

/** A plain modal frame (title, body, button row). */
export function Modal({ title, wide, onClose, children, buttons }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode; buttons: ReactNode }) {
  return (
    <div className="kp-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`kp-modal${wide ? ' wide' : ''}`}
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
        }}
      >
        <div className="kp-modal-title">{title}</div>
        {children}
        <div className="kp-modal-buttons">{buttons}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------- edit text

export interface EditTextResult {
  text: string
  font: string
  size: number
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right' | 'justify'
}

export interface EditTextSpec {
  /** The paragraph with and without its PDF line breaks. */
  joined: string
  broken: string
  font: string
  size: number
  bold: boolean
  italic: boolean
  align: EditTextResult['align']
  resolve: (r: EditTextResult | null) => void
}

const SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48]
const PRESERVE_KEY = 'khervepdf.preserveLineBreaks'

export function preserveLineBreaks(): boolean {
  try {
    return localStorage.getItem(PRESERVE_KEY) === 'true'
  } catch {
    return false
  }
}

/** pdftab._EditTextDialog: a toolbar (font, size, B/I/U, super/sub, alignment, rotation, line breaks) over the text. */
export function EditTextDialog({ spec, onClose }: { spec: EditTextSpec; onClose: () => void }) {
  const [preserve, setPreserve] = useState(preserveLineBreaks)
  const [text, setText] = useState(() => (preserveLineBreaks() ? spec.broken : spec.joined))
  const [font, setFont] = useState(spec.font)
  const [size, setSize] = useState(String(Math.round(spec.size)))
  const [bold, setBold] = useState(spec.bold)
  const [italic, setItalic] = useState(spec.italic)
  const [align, setAlign] = useState(spec.align)
  const done = (ok: boolean) => {
    onClose()
    const s = Number(size)
    spec.resolve(ok ? { text, font, size: s >= 4 && s <= 200 ? s : spec.size, bold, italic, align } : null)
  }
  const tog = (g: Glyph, on: boolean, tip: string, fn?: () => void) => (
    <button type="button" className={`kp-fmt-btn${on ? ' on' : ''}`} title={fn ? tip : `${tip} — not in the web edition yet`} disabled={!fn} onClick={fn}>
      <Icon name={g} size={17} />
    </button>
  )
  return (
    <Modal
      title="Edit text"
      wide
      onClose={() => done(false)}
      buttons={
        <>
          <span className="k-spacer" />
          <button className="k-btn primary" onClick={() => done(true)}>OK</button>
          <button className="k-btn" onClick={() => done(false)}>Cancel</button>
        </>
      }
    >
      <div className="kp-fmt-bar static">
        <span className="kp-fmt-label">Font:</span>
        <select className="kp-fmt-font" value={font} onChange={(e) => setFont(e.target.value)}>
          <option value="Helv">Helvetica</option>
          <option value="TiRo">Times</option>
          <option value="Cour">Courier</option>
        </select>
        <span className="kp-fmt-label">Size:</span>
        <input className="kp-fmt-size" list="kp-edit-sizes" value={size} onChange={(e) => setSize(e.target.value)} />
        <datalist id="kp-edit-sizes">{SIZES.map((n) => <option key={n} value={n} />)}</datalist>
        <span className="kp-fmt-sep" />
        {tog('bold', bold, 'Bold (Ctrl+B)', () => setBold((b) => !b))}
        {tog('italic', italic, 'Italic (Ctrl+I)', () => setItalic((b) => !b))}
        {tog('underline', false, 'Underline (Ctrl+U)')}
        <span className="kp-fmt-sep" />
        {tog('superscript', false, 'Superscript')}
        {tog('subscript', false, 'Subscript')}
        <span className="kp-fmt-sep" />
        {tog('align_left', align === 'left', 'Align left', () => setAlign('left'))}
        {tog('align_center', align === 'center', 'Align center', () => setAlign('center'))}
        {tog('align_right', align === 'right', 'Align right', () => setAlign('right'))}
        {tog('align_justify', align === 'justify', 'Justify', () => setAlign('justify'))}
        <span className="kp-fmt-sep" />
        <span className="kp-fmt-label">Rotation:</span>
        <select disabled title="Not in the web edition yet"><option>0°</option></select>
        <span className="kp-fmt-sep" />
        <label className="kp-check" title='Show the paragraph with the original PDF line breaks (e.g. "flex- ibility" on separate lines).'>
          <input
            type="checkbox"
            checked={preserve}
            onChange={(e) => {
              setPreserve(e.target.checked)
              try {
                localStorage.setItem(PRESERVE_KEY, String(e.target.checked))
              } catch {
                /* not remembered */
              }
              setText(e.target.checked ? spec.broken : spec.joined)
            }}
          />
          <span>Preserve PDF line breaks</span>
        </label>
      </div>
      <textarea
        className="k-input kp-edit-text"
        autoFocus
        value={text}
        spellCheck
        style={{ fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal', textAlign: align, fontFamily: font === 'TiRo' ? 'Times, serif' : font === 'Cour' ? 'Courier, monospace' : 'Helvetica, Arial, sans-serif' }}
        onChange={(e) => setText(e.target.value)}
      />
    </Modal>
  )
}

// ---------------------------------------------------------------- git

export interface HistoryRow {
  oid: string
  short: string
  time: number
  author: string
  subject: string
}

/** history_dialog.HistoryDialog. */
export function HistoryDialog({ name, branch, load, onRestore, onClose }: {
  name: string
  branch: string | null
  load: () => Promise<HistoryRow[]>
  onRestore: (row: HistoryRow) => Promise<boolean>
  onClose: () => void
}) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const reload = () => void load().then(setRows).catch(() => setRows([]))
  useEffect(reload, []) // eslint-disable-line react-hooks/exhaustive-deps
  const restore = async () => {
    const row = rows?.find((r) => r.oid === sel)
    if (row && (await onRestore(row))) reload()
  }
  return (
    <Modal title={`Git history — ${name}`} wide onClose={onClose} buttons={<><span className="k-spacer" /><button className="k-btn" onClick={onClose}>Close</button></>}>
      <div><b>{name}</b> on branch <code>{branch ?? '(no branch)'}</code></div>
      <div className="kp-table-wrap">
        <table className="kp-table">
          <thead><tr><th style={{ width: 80 }}>SHA</th><th style={{ width: 130 }}>Date</th><th style={{ width: 140 }}>Author</th><th>Subject</th></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={4} className="k-muted">Reading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={4} className="k-muted">No commits yet</td></tr>}
            {rows?.map((r) => (
              <tr key={r.oid} className={r.oid === sel ? 'sel' : ''} onClick={() => setSel(r.oid)} onDoubleClick={() => { setSel(r.oid); void onRestore(r).then((ok) => ok && reload()) }}>
                <td><code>{r.short}</code></td>
                <td>{formatCommitTime(r.time)}</td>
                <td>{r.author}</td>
                <td>{r.subject}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="kp-modal-buttons">
        <button className="k-btn" disabled={!sel} onClick={() => void restore()}>Restore to selected</button>
      </div>
    </Modal>
  )
}

/** remote_dialog.RemoteDialog. */
export function RemoteDialog({ name, branch, url, onSave, onPush, onClose }: {
  name: string
  branch: string | null
  url: string
  onSave: (url: string) => Promise<boolean>
  onPush: (url: string) => Promise<void>
  onClose: () => void
}) {
  const [value, setValue] = useState(url)
  const check = () => {
    if (!value.trim()) {
      void os.dialog.alert('Please enter a URL.', { title: 'Remote' })
      return false
    }
    return true
  }
  return (
    <Modal title="Git remote" onClose={onClose} buttons={<><span className="k-spacer" /><button className="k-btn" onClick={onClose}>Close</button></>}>
      <p className="kp-modal-hint">
        <b>{name}</b> &nbsp;·&nbsp; branch <code>{branch ?? '(no branch)'}</code>
        <br />
        Set the remote URL (e.g. <code>https://github.com/&lt;user&gt;/&lt;repo&gt;.git</code>) then click Push.
      </p>
      <div className="kp-form-row">
        <span>Origin URL:</span>
        <input className="k-input" value={value} placeholder="https://github.com/<user>/<repo>.git" spellCheck={false} onChange={(e) => setValue(e.target.value)} />
      </div>
      <div className="kp-modal-buttons">
        <button className="k-btn" onClick={() => check() && void onSave(value.trim())}>Save URL</button>
        <button className="k-btn" onClick={() => check() && void onSave(value.trim()).then((ok) => { if (ok) void onPush(value.trim()) })}>Save &amp; Push</button>
      </div>
    </Modal>
  )
}

// -------------------------------------------------------------- about

const LIBRARIES: [string, string, string][] = [
  ['React', 'The web edition’s interface: tabs, toolbar, options popup, the page view and its editors (the desktop uses PySide6).', 'https://react.dev/'],
  ['MuPDF.js', 'The same MuPDF engine as the desktop’s PyMuPDF, in WebAssembly — rendering pages, reading and writing annotations, page operations, redaction and text editing.', 'https://mupdf.readthedocs.io/'],
  ['isomorphic-git', 'Git in the browser — the per-document history of the Git menu and the branch in the status bar (pygit2 on the desktop).', 'https://isomorphic-git.org/'],
  ['Material Design Icons', 'The same MDI glyphs qtawesome draws on the desktop — every toolbar and menu icon.', 'https://pictogrammers.com/library/mdi/'],
]

/** MainWindow._about. */
export function AboutDialog({ onAuthor, onClose }: { onAuthor: () => void; onClose: () => void }) {
  return (
    <Modal
      title="About KhervePDF"
      wide
      onClose={onClose}
      buttons={
        <>
          <button className="k-btn" onClick={onAuthor}>Meet the Author…</button>
          <span className="k-spacer" />
          <button className="k-btn primary" onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="kp-about">
        <h2>KhervePDF v{VERSION}</h2>
        <p className="k-muted">WYSIWYG PDF viewer &amp; annotation editor with Git history.</p>
        <hr />
        <p>
          Created by <b>Gwilherm Kerhervé</b>, Department of Materials, Imperial College London — part of a small family of open-source tools
          (KherveFitting, KherveTeX, KherveSheet, KhervePlot, KherveCAD, …) that share the same themes, the same icon style and, here, the same
          per-document Git history.
        </p>
        <p>More about the author: <i>Help → Meet the Author…</i></p>
        <hr />
        <h3>Libraries</h3>
        <table className="kp-about-libs">
          <tbody>
            {LIBRARIES.map(([n, role, url]) => (
              <tr key={n}>
                <td><a href={url} onClick={(e) => { e.preventDefault(); os.openUrl(url) }}><b>{n}</b></a></td>
                <td>{role}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="k-muted kp-small">
          Annotations round-trip through real PDF annotation objects (ink, square, circle, line, highlight, text, free-text), so files stay
          editable across save cycles and in other PDF readers.
        </p>
        <p className="k-muted kp-small">© 2026 Gwilherm Kerhervé. Released under the GNU General Public License v3.</p>
      </div>
    </Modal>
  )
}

const AUTHOR_LINKS: [Glyph, string, string][] = [
  ['orcid', 'ORCID', 'https://orcid.org/0000-0002-6449-1828'],
  ['link', 'Imperial College profile', 'https://www.imperial.ac.uk/people/g.kerherve'],
  ['linkedin', 'LinkedIn', 'https://www.linkedin.com/in/gwilherm-kerherve-3588b978/'],
  ['github', 'GitHub', 'https://github.com/gkerherve'],
  ['email', 'Email (Imperial)', 'mailto:g.kerherve@imperial.ac.uk'],
  ['email', 'Email (personal)', 'mailto:gwilherm.kerherve@gmail.com'],
]

const PROJECTS: [string, string][] = [
  ['KherveFitting', 'peak fitting for XPS and Raman spectra'],
  ['spe-xps-reader', 'open reader for PHI Instruments SPE binary files'],
  ['KherveTeX', 'WYSIWYG LaTeX editor'],
  ['KherveSheet', 'Origin-style scientific workbook'],
  ['KhervePlot', 'scientific plotting and figure preparation'],
  ['KherveBook', 'Jupyter-inspired computational notebook'],
  ['KherveSlide', 'WYSIWYG slide designer that writes beamer LaTeX'],
  ['KhervePaint', 'hybrid raster + vector drawing'],
  ['KherveCAD', 'easy CAD with OpenSCAD as the engine'],
  ['KherveHouse', 'houses and buildings in 3D, no modelling tools'],
  ['KherveMol', 'chemical compounds and crystal structures in 2D / 3D'],
  ['KherveDB', 'reference database for the Kherve* suite'],
  ['KherveStats', 'downloads and traffic for every release'],
  ['KhervePDF', 'this app — PDF viewing and annotation'],
]

export const CITATION = `Kerhervé, G. KhervePDF: A PDF viewer and annotation editor with built-in Git version history (v${VERSION}). https://github.com/gkerherve/KhervePDF`

/** about_author.AuthorDialog. */
export function AuthorDialog({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <Modal
      title="About the Author — Gwilherm Kerhervé"
      wide
      onClose={onClose}
      buttons={
        <>
          <button
            className="k-btn"
            title="Copy a citation for KhervePDF to the clipboard"
            onClick={() => void navigator.clipboard.writeText(CITATION).then(() => setCopied(true))}
          >
            <Icon name="copy" size={15} /> {copied ? 'Copied' : 'Copy citation'}
          </button>
          <span className="k-spacer" />
          <button className="k-btn primary" onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="kp-author">
        <div className="kp-author-head">
          <div className="kp-avatar">GK</div>
          <div>
            <div className="kp-author-name">Gwilherm Kerhervé</div>
            <div className="kp-author-role">Research Associate</div>
            <div className="k-muted">Department of Materials, Imperial College London</div>
          </div>
        </div>
        <div className="kp-author-links">
          {AUTHOR_LINKS.map(([g, label, url]) => (
            <button key={label} className="k-btn" title={url} onClick={() => os.openUrl(url)}>
              <Icon name={g} size={15} /> {label}
            </button>
          ))}
        </div>
        <h3>About</h3>
        <p>
          Works on surface analysis and X-ray Photoelectron Spectroscopy (XPS), with a focus on materials for energy storage and catalysis.
          Maintains a small constellation of open-source tools, mostly for the XPS community.
        </p>
        <h3>The Kherve tools</h3>
        <table className="kp-about-libs">
          <tbody>
            {PROJECTS.map(([n, d]) => <tr key={n}><td><b>{n}</b></td><td className="k-muted">{d}</td></tr>)}
          </tbody>
        </table>
        <h3>Publication</h3>
        <p>
          KherveFitting — open-source XPS peak fitting<br />
          <a href="https://doi.org/10.1002/sia.70032" onClick={(e) => { e.preventDefault(); os.openUrl('https://doi.org/10.1002/sia.70032') }}>doi:10.1002/sia.70032</a>
        </p>
        <h3>Cite KhervePDF</h3>
        <p className="k-muted">{CITATION}</p>
        <h3>Licence</h3>
        <p className="k-muted">© 2026 Gwilherm Kerhervé. KhervePDF is free software, released under the GNU General Public License v3.</p>
      </div>
    </Modal>
  )
}

// -------------------------------------------------------- print preview

/** File ▸ Print Preview: the pages as they will print, then the browser's print dialog. */
export function PrintPreview({ pdf, name, onPrint, onClose }: { pdf: PdfDocument; name: string; onPrint: () => void; onClose: () => void }) {
  return (
    <Modal
      title={`Print preview — ${name}`}
      wide
      onClose={onClose}
      buttons={
        <>
          <span className="k-muted">{pdf.pageCount} page{pdf.pageCount === 1 ? '' : 's'}</span>
          <span className="k-spacer" />
          <button className="k-btn primary" onClick={onPrint}><Icon name="print" size={15} /> Print…</button>
          <button className="k-btn" onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="kp-preview">
        {pdf.pages.map((p, i) => <PreviewPage key={i} pdf={pdf} index={i} width={p.width} height={p.height} />)}
      </div>
    </Modal>
  )
}

function PreviewPage({ pdf, index, width, height }: { pdf: PdfDocument; index: number; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const W = 260
  useEffect(() => {
    const ac = new AbortController()
    const dpr = window.devicePixelRatio || 1
    pdf
      .renderPage(index, (W * dpr) / width, { signal: ac.signal, priority: 'low' })
      .then((bmp) => {
        const c = ref.current
        if (!c || ac.signal.aborted) return bmp.close()
        c.width = bmp.width
        c.height = bmp.height
        c.getContext('2d')?.drawImage(bmp, 0, 0)
        bmp.close()
      })
      .catch(() => {})
    return () => ac.abort()
  }, [pdf, index, width])
  return (
    <figure className="kp-preview-page">
      <canvas ref={ref} style={{ width: W, height: (W * height) / width }} />
      <figcaption>{index + 1}</figcaption>
    </figure>
  )
}

export { AppMark }
