// The desktop's other windows: the Welcome page (welcome.py), the User guide
// and keyboard shortcuts (mainwindow.py), About, Manage styles
// (style_dialog.py), Version history with branches (history_dialog.py) and
// Connect to cloud (remote_dialog.py).

import { useEffect, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import { os, fs, path } from '@/os'
import * as git from '@/os/services/git'
import { EXAMPLES } from '../examples/index'
import { HELP_TABS } from '../helpGuide'
import { readBundle } from '../ktex'
import { serializeDocument } from '../serializer'
import type { Layout } from '../KherveTeX'
import { Modal, type Done } from './dialogs'

export const DESKTOP_VERSION = '0.218'

// --------------------------------------------------------------- welcome

export type WelcomeChoice =
  | { kind: 'continue' } | { kind: 'new' } | { kind: 'open' } | { kind: 'project' }
  | { kind: 'example'; file: string } | { kind: 'recent'; path: string }

export interface WelcomeResult {
  choice: WelcomeChoice
  layout: Layout
  showAtStart: boolean
}

const LAYOUTS: [Layout, string, string][] = [
  ['side', 'Visual + PDF side by side', 'Edit on the left and watch the compiled LaTeX PDF on the right, updated as you type.'],
  ['window', 'Visual + PDF in its own window', 'The PDF in a separate window you can put on a second screen; close it to dock it back.'],
  ['visual', 'Visual only', 'The page with the Documents list beside it. The PDF is hidden and nothing compiles while you write.'],
  ['page', 'Page only — like Word', 'Just the page: the Documents list is hidden too. Bring anything back from the View menu.'],
]

export function WelcomeDialog({ recent, layout, showAtStart, done }: {
  recent: string[]
  layout: Layout
  showAtStart: boolean
  done: (r: WelcomeResult) => void
}) {
  const [mode, setMode] = useState<Layout>(layout)
  const [again, setAgain] = useState(showAtStart)
  const [exSel, setExSel] = useState<string | null>(null)
  const [recSel, setRecSel] = useState<string | null>(null)
  const finish = (choice: WelcomeChoice) => done({ choice, layout: mode, showAtStart: again })
  return (
    <div className="ktx-modal" onPointerDown={(e) => e.target === e.currentTarget && finish({ kind: 'continue' })}>
      <div
        className="k-dialog ktx-dialog ktx-welcome"
        role="dialog"
        aria-label="Welcome to KherveTeX"
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') finish({ kind: 'continue' })
        }}
      >
        <div className="k-dialog-title">Welcome to KherveTeX</div>
        <div className="k-dialog-body">
          <div className="ktx-welcome-head">
            <img src={`${import.meta.env.BASE_URL}icons/apps/khervetex.png`} alt="" width={64} height={64} />
            <div>
              <div className="ktx-welcome-name">KherveTeX</div>
              <div>Write like in Word, publish in LaTeX — version {DESKTOP_VERSION}</div>
            </div>
          </div>
          <div className="ktx-welcome-cols">
            <div className="ktx-welcome-col start">
              <div className="ktx-welcome-h">Start</div>
              <button className="ktx-pbtn big" title="A blank page" onClick={() => finish({ kind: 'new' })}>📄  New document</button>
              <button className="ktx-pbtn big" title="Open or import a document (.ktex, .tex, .docx, .md, .pdf)" onClick={() => finish({ kind: 'open' })}>📂  Open…</button>
              <button className="ktx-pbtn big" title="Several documents compiled into one PDF" onClick={() => finish({ kind: 'project' })}>📚  New project (thesis, book)…</button>
              <button className="ktx-pbtn big" title="The guided tour already open behind this page" onClick={() => finish({ kind: 'continue' })}>→  Continue with the tour</button>
            </div>
            <div className="ktx-welcome-col">
              <div className="ktx-welcome-h">Examples & templates</div>
              <div className="ktx-list">
                {EXAMPLES.filter((x) => x.group === 'main').map((x) => (
                  <div
                    key={x.file}
                    className={`ktx-list-item${exSel === x.file ? ' on' : ''}`}
                    onClick={() => setExSel(x.file)}
                    onDoubleClick={() => finish({ kind: 'example', file: x.file })}
                  >
                    {x.label}
                  </div>
                ))}
              </div>
            </div>
            <div className="ktx-welcome-col wide">
              <div className="ktx-welcome-h">Recent</div>
              <div className="ktx-list">
                {recent.length === 0 && <div className="ktx-list-item off">No recent documents yet</div>}
                {recent.map((p) => (
                  <div
                    key={p}
                    title={p}
                    className={`ktx-list-item${recSel === p ? ' on' : ''}`}
                    onClick={() => setRecSel(p)}
                    onDoubleClick={() => finish({ kind: 'recent', path: p })}
                  >
                    {path.basename(p)}
                    <div className="ktx-list-sub">   {path.pretty(path.dirname(p))}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <hr className="ktx-hr" />
          <div className="ktx-welcome-h">How do you want to work?</div>
          <div className="ktx-welcome-modes">
            {LAYOUTS.map(([m, title, text]) => (
              <label key={m} className="ktx-welcome-mode">
                <span>
                  <input type="radio" name="ktx-layout" checked={mode === m} onChange={() => setMode(m)} /> <b>{title}</b>
                </span>
                <span className="ktx-welcome-desc">{text}</span>
              </label>
            ))}
          </div>
          <div className="k-dialog-buttons">
            <label className="ktx-check">
              <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} /> Show this page when KherveTeX starts
            </label>
            <span style={{ flex: 1 }} />
            <button
              className="k-btn primary"
              style={{ minWidth: 140 }}
              autoFocus
              onClick={() =>
                finish(exSel ? { kind: 'example', file: exSel } : recSel ? { kind: 'recent', path: recSel } : { kind: 'continue' })
              }
            >
              Start writing
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ help pages

export function HelpGuideDialog({ done }: { done: () => void }) {
  const [tab, setTab] = useState(0)
  const html = useMemo(() => DOMPurify.sanitize(HELP_TABS[tab][1]), [tab])
  return (
    <Modal title="KherveTeX User Guide" width={720} onCancel={done} onOk={done} okLabel="Close">
      <div className="ktx-dtabs">
        {HELP_TABS.map(([t], i) => (
          <button key={t} className={`ktx-tab${i === tab ? ' active' : ''}`} onClick={() => setTab(i)}>
            {t}
          </button>
        ))}
      </div>
      <div className="ktx-help" dangerouslySetInnerHTML={{ __html: html }} />
    </Modal>
  )
}

const SHORTCUTS: [string, [string, string][]][] = [
  ['File', [['⌘N', 'New document'], ['⇧⌘N', 'New window'], ['⌘O', 'Open'], ['⌘S', 'Save'], ['⇧⌘S', 'Save as'], ['⌘P', 'Print'], ['⇧⌘P', 'Print preview']]],
  ['Edit', [['⌘Z', 'Undo'], ['⇧⌘Z', 'Redo'], ['⌘X / C / V', 'Cut / Copy / Paste'], ['⌘A', 'Select all']]],
  ['Formatting', [['⌘B', 'Bold'], ['⌘I', 'Italic'], ['⌘U', 'Underline']]],
  ['Insert', [
    ['⌘M', 'Inline math'], ['⇧⌘M', 'Math block'], ['⌘K', 'Hyperlink'], ['⇧⌘G', 'Symbol picker'], ['⇧⌘E', 'Equation builder'],
    ['⇧⌘R', 'Chemical reaction'], ['⇧⌘T', 'Chemical structure'], ['⇧⌘F', 'Flowchart builder'],
  ]],
  ['View', [
    ['⌘1', 'Visual tab'], ['⌘2', 'Code tab'], ['⌘3', 'PDF tab'], ['⌘4', 'PDF side panel'], ['⌘5', 'Project panel'], ['⌘6', 'Console tab'],
    ['⌘F', 'Find (text or PDF search)'], ['⌃H', 'Find & Replace'],
  ]],
]

export function ShortcutsDialog({ done }: { done: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" width={460} onCancel={done} onOk={done} okLabel="OK">
      <div className="ktx-help">
        <h3>Keyboard shortcuts</h3>
        {SHORTCUTS.map(([group, rows]) => (
          <div key={group}>
            <h4>{group}</h4>
            <table className="ktx-shortcuts">
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k}>
                    <td><code>{k}</code></td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <p className="ktx-dim">In KherveOS the browser keeps a few of these for itself (⌘N, ⇧⌘N, ⇧⌘R, ⇧⌘T): use the menus for those.</p>
      </div>
    </Modal>
  )
}

const LIBRARIES: [string, string, string][] = [
  ['React + TipTap (ProseMirror)', 'The Visual tab: the page you type on, its toolbars and dialogs.', 'https://tiptap.dev/'],
  ['KaTeX + mhchem', 'Draws the equations and chemical reactions on the page and in the equation editors.', 'https://katex.org/'],
  ['MuPDF', 'The KherveOS PDF service: draws the PDF window\'s pages, searches them, imports PDFs.', 'https://mupdf.com/'],
  ['CodeMirror', 'The Code tab: the LaTeX source with highlighting.', 'https://codemirror.net/'],
  ['isomorphic-git', 'The KherveOS Git service: a snapshot on every save, the version history and the upload to GitHub.', 'https://isomorphic-git.org/'],
  ['fflate', 'Reads and writes .ktex archives and Word files.', 'https://github.com/101arrowz/fflate'],
  ['tectonic', 'The LaTeX engine, on the KherveOS server: makes the PDF shown in the PDF window and exported by File ▸ Export.', 'https://tectonic-typesetting.github.io/'],
]

export function AboutDialog({ done }: { done: () => void }) {
  return (
    <Modal title="About KherveTeX" width={680} onCancel={done} onOk={done} okLabel="Close">
      <div className="ktx-about-head">
        <img src={`${import.meta.env.BASE_URL}icons/apps/khervetex.png`} alt="" width={96} height={96} />
        <div>
          <h2>KherveTeX</h2>
          <p className="ktx-dim">v{DESKTOP_VERSION} · KherveOS edition</p>
          <p>A WYSIWYG LaTeX document editor with built-in Git version history.</p>
          <p>Press <b>F1</b> for the User Guide.</p>
          <p>© 2026 Gwilherm Kerhervé · GPL-3.0<br />github.com/gkerherve/kherveTeX</p>
        </div>
      </div>
      <div className="ktx-help">
        <h3>About the author</h3>
        <p><b>Gwilherm Kerhervé</b>  —  Research Associate, Department of Materials, Imperial College London.</p>
        <p>
          Works on surface analysis and X-ray Photoelectron Spectroscopy (XPS), with a focus on materials for energy storage and catalysis.
          Maintains a small constellation of open-source tools for the XPS community, including KherveFitting (peak fitting for XPS spectra)
          and spe-xps-reader (an open reader for PHI Instruments SPE binary files). KherveTeX grew out of the same workflow — writing papers
          and reports in LaTeX without leaving the WYSIWYG comfort zone of Word.
        </p>
        <hr className="ktx-hr" />
        <h3>Libraries</h3>
        <table className="ktx-libs">
          <tbody>
            {LIBRARIES.map(([name, role, url]) => (
              <tr key={name}>
                <td><b>{name}</b></td>
                <td>
                  {role}
                  <br />
                  <a href={url} onClick={(e) => {
                    e.preventDefault()
                    os.openUrl(url)
                  }}>{url}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ktx-dim">Every toolbar icon is the desktop's own, drawn by its icons.py.</p>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------- manage styles

export const BUNDLED_STYLES = ['resume.cls']
const STYLE_EXTS = ['.cls', '.sty', '.bst']

export function userStylesDir(home: string): string {
  return `${home}/.khervetex/styles`
}

export function StylesDialog({ dir, done }: { dir: string; done: () => void }) {
  const [rev, setRev] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const rows = useMemo(() => {
    const out: { name: string; type: string; where: string; path: string; user: boolean }[] = BUNDLED_STYLES.map((n) => ({
      name: n, type: kindOf(n), where: 'Bundled', path: `KherveTeX/styles/${n}`, user: false,
    }))
    if (fs.isDir(dir)) {
      for (const s of fs.list(dir)) {
        if (s.type === 'file' && STYLE_EXTS.includes(path.extname(s.name))) out.push({ name: s.name, type: kindOf(s.name), where: 'User', path: s.path, user: true })
      }
    }
    return out
  }, [dir, rev])
  const importStyle = async () => {
    const p = await os.dialog.openFile({ title: 'Import style files', extensions: STYLE_EXTS })
    if (!p) return
    if (!fs.isDir(dir)) await fs.mkdir(dir, { recursive: true })
    await fs.writeBytes(path.join(dir, path.basename(p)), await fs.readBytes(p))
    setRev((r) => r + 1)
  }
  const remove = async () => {
    const row = rows.find((r) => r.path === sel)
    if (!row?.user) return
    if (!(await os.dialog.confirm(`Remove ${row.name} from your styles?`, { title: 'Remove style', okLabel: 'Remove' }))) return
    await fs.remove(row.path)
    setSel(null)
    setRev((r) => r + 1)
  }
  return (
    <Modal title="Manage LaTeX styles" width={700} onCancel={done} onOk={done} okLabel="Close">
      <p className="ktx-help-p">
        <b>Bundled styles</b> ship with KherveTeX and are always available. <b>User styles</b> are files you imported — they live in a
        personal folder and survive app updates.
        <br />
        <br />
        Any <code>.cls</code> (document class), <code>.sty</code> (package) or <code>.bst</code> (bibliography style) file placed here is
        found automatically by the LaTeX compiler.
      </p>
      <div className="ktx-table-wrap">
        <table className="ktx-grid">
          <thead>
            <tr><th>File</th><th>Type</th><th>Location</th><th>Path</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.path} className={sel === r.path ? 'on' : ''} onClick={() => setSel(r.path)}>
                <td>{r.name}</td><td>{r.type}</td><td>{r.where}</td><td className="ktx-dim">{r.user ? path.pretty(r.path) : r.path}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ktx-row">
        <button className="ktx-pbtn" onClick={() => void importStyle()}>Import…</button>
        <button className="ktx-pbtn" disabled={!rows.find((r) => r.path === sel)?.user} onClick={() => void remove()}>Remove</button>
        <button className="ktx-pbtn" onClick={() => os.open('files', { path: dir })} disabled={!fs.isDir(dir)}>Open folder</button>
      </div>
    </Modal>
  )
}

function kindOf(name: string): string {
  const e = path.extname(name)
  return e === '.cls' ? 'Document class' : e === '.sty' ? 'Package' : 'Bibliography style'
}

// ----------------------------------------------------- version history

interface Snapshot {
  oid: string
  short: string
  when: string
  subject: string
  message: string
  author: string
  refs: string[]
}

/** The LaTeX of the document as it was in a commit (document.tex inside its .ktex). */
async function texAt(root: string, oid: string, rel: string): Promise<string | null> {
  const bytes = await git.readFileAtCommit(root, oid, rel)
  if (!bytes) return null
  try {
    return serializeDocument(readBundle(bytes).doc)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

export function HistoryDialog({ root, file, onRestore, done }: {
  /** The repository. */
  root: string
  /** The document, or null (Branches…: every commit). */
  file: string | null
  onRestore: (bytes: Uint8Array) => void
  done: () => void
}) {
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null)
  const [sel, setSel] = useState(0)
  const [diff, setDiff] = useState('')
  const [branches, setBranches] = useState<git.Branches | null>(null)
  const [pick, setPick] = useState('')
  const [rev, setRev] = useState(0)
  const rel = file ? file.slice(root.length).replace(/^\/+/, '') : null

  useEffect(() => {
    let gone = false
    void (async () => {
      try {
        const [log, br] = await Promise.all([git.log(root, { depth: 300 }), git.branches(root)])
        if (gone) return
        setBranches(br)
        setPick(br.current ?? '')
        const list: Snapshot[] = []
        let prev: Uint8Array | null | undefined
        for (const c of log) {
          if (rel) {
            // Only the snapshots that changed this document.
            const now = await git.readFileAtCommit(root, c.oid, rel).catch(() => null)
            if (!now) continue
            const parent = c.parents[0] ? await git.readFileAtCommit(root, c.parents[0], rel).catch(() => null) : null
            if (parent && parent.length === now.length && parent.every((b, i) => b === now[i])) continue
            prev = now
          }
          list.push({
            oid: c.oid, short: c.short, subject: c.subject, message: c.message, author: c.author.name,
            when: new Date(c.author.time * 1000).toLocaleString(), refs: c.refs.map((r) => r.name),
          })
        }
        void prev
        if (!gone) setSnaps(list)
      } catch (e) {
        if (!gone) {
          setSnaps([])
          setDiff(git.describeGitError(e))
        }
      }
    })()
    return () => {
      gone = true
    }
  }, [root, rel, rev])

  useEffect(() => {
    const c = snaps?.[sel]
    if (!c) return
    let gone = false
    void (async () => {
      const full = await git.log(root, { ref: c.oid, depth: 2 }).catch(() => [])
      const parent = full[1]?.oid ?? null
      if (rel) {
        const after = (await texAt(root, c.oid, rel)) ?? ''
        const before = parent ? (await texAt(root, parent, rel)) ?? '' : ''
        if (!gone) setDiff(git.unifiedDiff(before, after, { oldPath: 'before', newPath: 'after' }) || '(no change in the LaTeX)')
      } else {
        const files = await git.changesBetween(root, parent, c.oid).catch(() => [])
        if (!gone) setDiff(files.map((f) => `${f.status}  ${f.path}`).join('\n') || '(no files changed)')
      }
    })()
    return () => {
      gone = true
    }
  }, [snaps, sel, root, rel])

  const c = snaps?.[sel]
  const restore = async () => {
    if (!c || !rel) return
    const ok = await os.dialog.confirm(
      `Roll the document back to this version?\n\n${c.short} · ${c.when}\n${c.subject}\n\nYour current document state isn't lost — every saved version is still in the history. The next ⌘S will record the restored contents as a new snapshot on top.`,
      { title: 'Restore this version', okLabel: 'Restore' },
    )
    if (!ok) return
    const bytes = await git.readFileAtCommit(root, c.oid, rel)
    if (!bytes) return
    onRestore(bytes)
    done()
  }
  const switchBranch = async () => {
    if (!pick || pick === branches?.current) return
    try {
      await git.checkout(root, pick)
      setRev((r) => r + 1)
    } catch (e) {
      await os.dialog.alert(git.describeGitError(e), { title: 'Switch branch' })
    }
  }
  const newBranch = async () => {
    const name = await os.dialog.prompt('Name of the new branch:', { title: 'New branch' })
    if (!name?.trim()) return
    try {
      await git.createBranch(root, name.trim(), { checkout: true })
      setRev((r) => r + 1)
    } catch (e) {
      await os.dialog.alert(git.describeGitError(e), { title: 'New branch' })
    }
  }
  const deleteBranch = async () => {
    if (!pick || pick === branches?.current) return
    if (!(await os.dialog.confirm(`Delete the branch "${pick}"?`, { title: 'Delete branch', okLabel: 'Delete' }))) return
    try {
      await git.deleteBranch(root, pick)
      setRev((r) => r + 1)
    } catch (e) {
      await os.dialog.alert(git.describeGitError(e), { title: 'Delete branch' })
    }
  }
  return (
    <Modal title={`Version history — ${file ? path.basename(file) : path.basename(root)}`} width={1100} onCancel={done} onOk={done} okLabel="Close">
      <div className="ktx-row">
        <b>Branch: {branches?.current ?? '—'}</b>
        <select className="ktx-combo" style={{ minWidth: 150 }} title="Switch to another branch" value={pick} onChange={(e) => setPick(e.target.value)}>
          {branches?.local.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <button className="ktx-pbtn" title="Switch working tree to the selected branch" onClick={() => void switchBranch()}>Switch</button>
        <button className="ktx-pbtn" title="Create a new branch from HEAD" onClick={() => void newBranch()}>+ New branch</button>
        <button className="ktx-pbtn" title="Delete the selected branch" onClick={() => void deleteBranch()}>Delete</button>
      </div>
      <div className="ktx-history">
        <div className="ktx-table-wrap">
          <table className="ktx-grid">
            <thead>
              <tr><th /><th>When</th><th>Message</th><th>Author</th></tr>
            </thead>
            <tbody>
              {snaps === null && <tr><td colSpan={4} className="ktx-dim">Reading the history…</td></tr>}
              {snaps?.length === 0 && <tr><td colSpan={4} className="ktx-dim">No snapshots yet. Every time you save, KherveTeX creates a snapshot.</td></tr>}
              {snaps?.map((s, i) => (
                <tr key={s.oid} className={i === sel ? 'on' : ''} onClick={() => setSel(i)}>
                  <td className="ktx-rail"><span /></td>
                  <td className="ktx-small">{s.when}</td>
                  <td title={s.subject}>{s.subject}</td>
                  <td>{s.author}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ktx-history-right">
          <div className="ktx-history-meta">
            {c ? (
              <>
                <b>{c.subject}</b>
                {c.refs.length > 0 && <div>{c.refs.map((r) => <span key={r} className="ktx-sb-branch">{r}</span>)}</div>}
                <div className="ktx-dim">{c.short} · {c.author} · {c.when}</div>
              </>
            ) : (
              'Select a commit to see its diff.'
            )}
          </div>
          <pre className="ktx-diff">
            {diff.split('\n').map((l, i) => (
              <span key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>
                {l}
                {'\n'}
              </span>
            ))}
          </pre>
          {rel && (
            <button
              className="ktx-pbtn"
              disabled={!c}
              title="Roll the document back to the selected snapshot. Your current state stays in the history — restoring just creates a new snapshot on top with the older contents."
              onClick={() => void restore()}
            >
              ↩ Restore this version
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------- connect to cloud

export function RemoteDialog({ root, done }: { root: string; done: () => void }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  const [rev, setRev] = useState(0)
  useEffect(() => {
    void git.getRemoteUrl(root).then(setUrl).catch(() => setUrl(null))
  }, [root, rev])
  const edit = async () => {
    const v = await os.dialog.prompt('The address of the repository (e.g. https://github.com/me/thesis):', {
      title: url ? 'Edit URL' : 'Add connection',
      defaultValue: url ?? '',
    })
    if (!v?.trim()) return
    await git.setRemoteUrl(root, git.normalizeRepoUrl(v.trim()))
    setRev((r) => r + 1)
  }
  const remove = async () => {
    if (!url) return
    if (!(await os.dialog.confirm('Remove the connection? The online copy is not deleted.', { title: 'Remove', okLabel: 'Remove' }))) return
    await git.setRemoteUrl(root, '')
    setRev((r) => r + 1)
  }
  const signedIn = !!git.getGithubToken()
  return (
    <Modal title="Connect to cloud" width={620} onCancel={done} onOk={done} okLabel="Close">
      <p className="ktx-help-p">
        Connect this document's folder to <b>GitHub</b>, <b>GitLab</b>, Bitbucket or Codeberg: every snapshot you save is then uploaded
        there, backed up online and shareable with your collaborators. Create an empty repository on the website first, then add its address
        here.
      </p>
      <table className="ktx-grid">
        <thead>
          <tr><th>Name</th><th>URL</th></tr>
        </thead>
        <tbody>
          {url ? (
            <tr className="on"><td>origin</td><td>{url}</td></tr>
          ) : (
            <tr><td colSpan={2} className="ktx-dim">{url === undefined ? 'Reading…' : 'Not connected yet.'}</td></tr>
          )}
        </tbody>
      </table>
      <div className="ktx-row">
        <button className="ktx-pbtn" onClick={() => void edit()}>{url ? '✏ Edit URL' : '➕ Add connection'}</button>
        <button className="ktx-pbtn" disabled={!url} onClick={() => void remove()}>✖ Remove</button>
      </div>
      <p className="ktx-help-p ktx-dim">
        {signedIn
          ? 'Uploads to GitHub use the token saved in KherveOS.'
          : 'To upload to GitHub, sign in with a token first (KhervePY ▸ Git ▸ GitHub account, or Settings).'}
      </p>
    </Modal>
  )
}

export type { Done }
