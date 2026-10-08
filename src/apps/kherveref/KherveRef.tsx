// KherveRef: the reference manager of the Kherve suite, ported from the
// desktop app (../KherveRef, dev). A library is a folder on the KherveOS drive
// in the desktop's own format (library.ts), ~/Documents/KherveRef by default.
// References come in by DOI / arXiv id / ISBN, from PDFs (their DOI read with
// the PDF service) and from BibTeX / CSL-JSON; details are looked up through
// the KherveOS server (Crossref, arXiv, OpenLibrary). PDFs open in KhervePDF.

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  AlertTriangle, BookMarked, Download, FilePlus2, FileUp, FolderOpen, Library as LibraryIcon, Loader2, Plus, RefreshCw, Search, SquarePen, Trash2, X,
} from 'lucide-react'
import { fs, HOME, os, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import * as path from '@/os/path'
import { DRAG_MIME } from '@/os/fileActions'
import { useAppTools } from '@/os/ai/appTools'
import { toBibtex, type Dialect } from './bibtex'
import { DEFAULT_STYLE, formatBibliography, formatCitation, htmlToText, STYLES } from './cite'
import { toCsl } from './csl'
import { Details } from './Details'
import { splitIdentifiers } from './ids'
import { Importer, refreshFromIdentifiers, type Outcome, type Services } from './importer'
import { createLibrary, isLibrary, Library, LibraryError, openLibrary, type Collection } from './library'
import { makeAiTools } from './aiTools'
import { cloneEntry, matchesSearch, newEntry, type Entry } from './model'
import { RefTable, sortEntries, type Sort } from './RefTable'
import { inspectPdf, lookupId, NetworkError, searchTitle } from './services'
import { KEYS_MIME, sameScope, Sidebar, type Scope } from './Sidebar'
import './kherveref.css'

const DEFAULT_ROOT = `${HOME}/Documents/KherveRef`
const LAST_LIBRARY = 'kherveref.library'
const STYLE_PREF = 'kherveref.style'
const BIB_EXT = ['.bib', '.bibtex', '.json']

const SERVICES: Services = { lookupId, searchTitle, inspectPdf, isNetworkError: (e) => e instanceof NetworkError }

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function pref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function setPref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode: not remembered */
  }
}

async function copyToClipboard(text: string, html?: string) {
  if (html && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) }),
    ])
  } else await navigator.clipboard.writeText(text)
}

/** Files from the computer, through the browser's file picker. */
function pickLocalFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = accept
    input.onchange = () => resolve([...(input.files ?? [])])
    input.oncancel = () => resolve([])
    input.click()
  })
}

type Phase = 'loading' | 'ready' | 'start'
type Dialog = { kind: 'add'; text: string } | { kind: 'results'; title: string; outcomes: Outcome[]; headline: string } | null

export default function KherveRef({ win, args }: AppProps) {
  const [lib, setLib] = useState<Library | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [rev, bump] = useReducer((n: number) => n + 1, 0)
  const [scope, setScope] = useState<Scope>({ kind: 'all' })
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>({ col: 'key', desc: false })
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [style, setStyle] = useState(() => (STYLES[pref(STYLE_PREF) ?? ''] ? pref(STYLE_PREF)! : DEFAULT_STYLE))
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dropping, setDropping] = useState(false)
  const libRef = useRef<Library | null>(null)
  libRef.current = lib
  const writing = useRef(0)
  const lastWrite = useRef(0)
  const searchBox = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // ------------------------------------------------------------ the library

  const show = (l: Library) => {
    setLib(l)
    setScope({ kind: 'all' })
    setSelected([])
    setPhase('ready')
    setPref(LAST_LIBRARY, l.root)
    win.setTitle(`${l.name} — kRef`)
    win.setDocumentPath(l.manifest)
    bump()
  }

  const openAt = async (p: string): Promise<Library | null> => {
    try {
      const l = await openLibrary(fs, p)
      show(l)
      return l
    } catch (e) {
      await os.dialog.alert(errText(e), { title: 'kRef' })
      return null
    }
  }

  /** ~/Documents/KherveRef: made the first time. */
  const openDefault = async (): Promise<Library | null> => {
    if (isLibrary(fs, DEFAULT_ROOT)) return openAt(DEFAULT_ROOT)
    if (!fs.exists(DEFAULT_ROOT) || (fs.isDir(DEFAULT_ROOT) && !fs.list(DEFAULT_ROOT).length)) {
      try {
        const l = await createLibrary(fs, DEFAULT_ROOT)
        show(l)
        return l
      } catch (e) {
        await os.dialog.alert(errText(e), { title: 'kRef' })
      }
    }
    setPhase('start')
    return null
  }

  // Open the library (or file) the window was started with.
  useEffect(() => {
    void (async () => {
      const p = typeof args.path === 'string' ? args.path : ''
      const ext = path.extname(p).toLowerCase()
      let l = libRef.current
      if (p && (ext === '.kref' || fs.isDir(p))) l = await openAt(p)
      else if (!l) {
        const last = pref(LAST_LIBRARY)
        l = last && isLibrary(fs, last) ? await openAt(last) : await openDefault()
      }
      if (!l) return
      // A .bib (or PDF) opened with KherveRef, or args.add from another app (a PDF to file).
      const files: string[] = []
      if (p && fs.isFile(p) && [...BIB_EXT, '.pdf'].includes(ext)) {
        const ok = await os.dialog.confirm(`Add the references in ${path.basename(p)} to the library “${l.name}”?`, { title: 'kRef', okLabel: 'Add' })
        if (ok) files.push(p)
      }
      if (typeof args.add === 'string' && fs.isFile(args.add)) files.push(args.add)
      if (files.length) await importDrivePaths(files, '', l)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args])

  // On close, keep a field still being edited (details commit on blur) and let writes finish.
  useEffect(() => {
    win.setCloseGuard(async () => {
      const el = document.activeElement
      if (el instanceof HTMLElement && rootRef.current?.contains(el)) el.blur()
      while (writing.current > 0) await new Promise((r) => setTimeout(r, 50))
      return true
    })
    return () => win.setCloseGuard(null)
  }, [win])

  // Changes made elsewhere (another window, a sync) show up here.
  useEffect(() => {
    if (!lib) return
    let timer = 0
    const off = fs.watch((ev) => {
      const inside = path.isInside(ev.path, lib.root) || (ev.type === 'rename' && path.isInside(ev.oldPath, lib.root))
      if (!inside || writing.current > 0 || Date.now() - lastWrite.current < 1000) return
      clearTimeout(timer)
      timer = window.setTimeout(() => void lib.load().then(bump), 500)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [lib])

  /** Run a change to the library: busy message, errors shown, the window refreshed. */
  const run = async <T,>(label: string | null, fn: (l: Library) => Promise<T>): Promise<T | undefined> => {
    const l = libRef.current
    if (!l) return undefined
    writing.current++
    if (label) setBusy(label)
    try {
      return await fn(l)
    } catch (e) {
      await os.dialog.alert(errText(e), { title: 'kRef' })
      return undefined
    } finally {
      writing.current--
      lastWrite.current = Date.now()
      if (label) setBusy(null)
      bump()
    }
  }

  // ------------------------------------------------------------ what's shown

  const entries = useMemo(() => (lib ? [...lib.entries.values()] : []), [lib, rev])
  const scoped = useMemo(() => {
    if (!lib) return []
    switch (scope.kind) {
      case 'all':
        return entries
      case 'unfiled':
        return entries.filter((e) => !e.collections.length)
      case 'review':
        return entries.filter((e) => e.needs_review)
      case 'tag':
        return entries.filter((e) => e.keywords.includes(scope.tag))
      case 'collection': {
        const ids = lib.descendants(scope.id)
        return entries.filter((e) => e.collections.some((c) => ids.has(c)))
      }
    }
  }, [lib, entries, scope])
  const rows = useMemo(() => sortEntries(scoped.filter((e) => matchesSearch(e, search)), sort), [scoped, search, sort])
  const selectedSet = useMemo(() => new Set(selected.filter((k) => lib?.entries.has(k))), [selected, lib, rev])
  const selectedEntries = () => [...selectedSet].map((k) => lib!.entries.get(k)!).filter(Boolean)
  const current = selectedSet.size === 1 ? (lib?.entries.get([...selectedSet][0]) ?? null) : null
  const scopeCollection = scope.kind === 'collection' ? scope.id : ''

  // A collection or tag that no longer exists falls back to the whole library.
  useEffect(() => {
    if (scope.kind === 'collection' && lib && !lib.collections.some((c) => c.id === scope.id)) setScope({ kind: 'all' })
  }, [lib, rev, scope])

  // -------------------------------------------------------------- adding

  const showResults = (title: string, imp: Importer) => {
    const quiet = imp.outcomes.length === 1 && imp.outcomes[0].status === 'added'
    if (imp.keys.length) setSelected(imp.keys)
    setStatus(imp.headline())
    if (!quiet && imp.outcomes.length) setDialog({ kind: 'results', title, outcomes: imp.outcomes, headline: imp.headline() })
  }

  const addFromText = async (text: string, collection = scopeCollection) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const looksBib = /^\s*@\w+\s*[{(]/m.test(trimmed) || /^[[{]/.test(trimmed)
    await run(looksBib ? 'Importing…' : 'Looking up…', async (l) => {
      const imp = new Importer(l, SERVICES, { collection })
      if (looksBib) await imp.importText(trimmed)
      else {
        const { ids, unknown } = splitIdentifiers(trimmed)
        for (const [i, [kind, id]] of ids.entries()) {
          setBusy(`Looking up ${id} (${i + 1} of ${ids.length})…`)
          await imp.addIdentifier(kind, id)
        }
        for (const u of unknown) imp.outcomes.push({ source: u, status: 'failed', key: '', message: 'not a DOI, arXiv id or ISBN' })
      }
      await imp.finish()
      showResults('Add references', imp)
    })
  }

  /** PDFs and .bib / CSL-JSON files: [name, read bytes] pairs. */
  const importFiles = async (files: { name: string; read: () => Promise<Uint8Array> }[], collection = scopeCollection, l0?: Library) => {
    const l = l0 ?? libRef.current
    if (!l || !files.length) return
    libRef.current = l
    await run('Adding…', async (lib) => {
      const imp = new Importer(lib, SERVICES, { collection })
      for (const [i, f] of files.entries()) {
        setBusy(`Adding ${f.name} (${i + 1} of ${files.length})…`)
        const ext = path.extname(f.name).toLowerCase()
        try {
          const data = await f.read()
          if (ext === '.pdf') await imp.addPdf(data, f.name)
          else await imp.importText(new TextDecoder().decode(data), f.name)
        } catch (e) {
          imp.outcomes.push({ source: f.name, status: 'failed', key: '', message: errText(e) })
        }
      }
      await imp.finish()
      showResults('Add files', imp)
    })
  }

  const importDrivePaths = async (paths: string[], collection = scopeCollection, l?: Library) => {
    const files: string[] = []
    for (const p of paths) {
      if (fs.isDir(p)) {
        for (const s of fs.walk(p)) {
          const rel = s.path.slice(p.length + 1)
          if (s.type === 'file' && !rel.split('/').some((part) => part.startsWith('.')) && [...BIB_EXT, '.pdf'].includes(path.extname(s.name).toLowerCase())) files.push(s.path)
        }
      } else if (fs.isFile(p)) files.push(p)
    }
    const lr = l ?? libRef.current
    // Not the library's own PDFs.
    const outside = lr ? files.filter((f) => !path.isInside(f, lr.root)) : files
    await importFiles(outside.map((p) => ({ name: path.basename(p), read: () => fs.readBytes(p) })), collection, l)
  }

  const importLocalFiles = (files: File[], collection = scopeCollection) =>
    importFiles(
      files.filter((f) => [...BIB_EXT, '.pdf', '.txt'].includes(path.extname(f.name).toLowerCase())).map((f) => ({ name: f.name, read: async () => new Uint8Array(await f.arrayBuffer()) })),
      collection,
    )

  const addPdfsFromDrive = async () => {
    const p = await os.dialog.openFile({ title: 'Add a PDF', startDir: `${HOME}/Documents`, extensions: ['.pdf'] })
    if (p) await importDrivePaths([p])
  }
  const addPdfsFromComputer = async () => importLocalFiles(await pickLocalFiles('.pdf,application/pdf'))
  const importBibFromDrive = async () => {
    const p = await os.dialog.openFile({ title: 'Import BibTeX / BibLaTeX / CSL-JSON', startDir: `${HOME}/Documents`, extensions: BIB_EXT })
    if (p) await importDrivePaths([p])
  }
  const importBibFromComputer = async () => importLocalFiles(await pickLocalFiles('.bib,.bibtex,.json,.txt'))

  const newReference = async () => {
    const title = await os.dialog.prompt('The title of the new reference (fill in the rest in the details):', { title: 'New reference', okLabel: 'Create' })
    if (title === null) return
    await run(null, async (l) => {
      const e = newEntry({ type: 'article', title: title.trim(), date: String(new Date().getFullYear()) })
      if (scopeCollection) e.collections = [scopeCollection]
      await l.addEntry(e)
      await l.writeLibraryBib()
      setSelected([e.key])
    })
  }

  // ------------------------------------------------------------- editing

  const saveEntry = (d: Entry) =>
    run(null, async (l) => {
      await l.saveEntry(d)
      await l.writeLibraryBib()
    })

  const deleteSelected = async () => {
    const sel = selectedEntries()
    if (!sel.length) return
    const what = sel.length === 1 ? `“${sel[0].title || sel[0].key}”` : `${sel.length} references`
    const pdfs = sel.some((e) => e.files.length) ? ' Their PDFs in the library are deleted too.' : ''
    if (!(await os.dialog.confirm(`Delete ${what}?${pdfs} Documents citing them will no longer find them.`, { title: 'Delete', okLabel: 'Delete', danger: true })))
      return
    await run(null, async (l) => {
      for (const e of sel) await l.deleteEntry(e)
      await l.writeLibraryBib()
      setSelected([])
      setStatus(`Deleted ${what}`)
    })
  }

  const openFile = async (e: Entry, index = 0) => {
    const l = libRef.current
    const a = e.files[index]
    if (!l || !a) {
      setStatus('No PDF attached: Attach PDF… in the details')
      return
    }
    const p = l.filePath(a)
    if (!fs.exists(p)) {
      await os.dialog.alert(`${path.pretty(p)} is missing from the library folder.`, { title: 'kRef' })
      return
    }
    if (path.extname(p).toLowerCase() === '.pdf') os.open('khervepdf', { path: p })
    else await os.openFile(p)
  }

  const attachTo = async (e: Entry) => {
    const where = await os.dialog.choose(
      `Attach a PDF to “${e.title || e.key}”. It is copied into the library as PDFs/${e.key}.pdf.`,
      [
        { label: 'Cancel', value: '' },
        { label: 'From this computer…', value: 'computer' },
        { label: 'From the KherveOS drive…', value: 'drive', primary: true },
      ],
      { title: 'Attach PDF' },
    )
    let file: { name: string; data: Uint8Array } | null = null
    if (where === 'drive') {
      const p = await os.dialog.openFile({ title: 'Attach a PDF', startDir: `${HOME}/Documents`, extensions: ['.pdf'] })
      if (p) file = { name: p, data: await fs.readBytes(p) }
    } else if (where === 'computer') {
      const [f] = await pickLocalFiles('.pdf,application/pdf')
      if (f) file = { name: f.name, data: new Uint8Array(await f.arrayBuffer()) }
    }
    if (!file) return
    const f = file
    await run(null, async (l) => {
      const d = cloneEntry(l.entries.get(e.key) ?? e)
      await l.attachFile(d, f.data, path.extname(f.name) || '.pdf')
      await l.saveEntry(d)
      setStatus(`Attached ${path.basename(f.name)}`)
    })
  }

  const removeFile = async (e: Entry, index: number) => {
    const a = e.files[index]
    if (!a) return
    const inLib = a.path.startsWith('PDFs/')
    if (!(await os.dialog.confirm(`Remove ${a.path.split('/').pop()} from this reference?${inLib ? ' The file is deleted from the library folder.' : ''}`, { title: 'Remove PDF', okLabel: 'Remove', danger: true })))
      return
    await run(null, (l) => l.removeAttachment(cloneEntry(l.entries.get(e.key) ?? e), index))
  }

  const renameKey = async (e: Entry) => {
    const next = await os.dialog.prompt(`Documents that already cite “${e.key}” will need updating. New citation key:`, {
      title: 'Rename key',
      defaultValue: e.key,
      okLabel: 'Rename',
    })
    if (!next || next.trim() === e.key) return
    await run(null, async (l) => {
      const r = await l.renameKey(e.key, next.trim())
      await l.writeLibraryBib()
      setSelected([r.key])
    })
  }

  const lookup = async (keys: string[]) => {
    if (!keys.length) {
      setStatus('No reference needs checking')
      return
    }
    await run(keys.length === 1 ? 'Looking up…' : `Looking up ${keys.length} references…`, async (l) => {
      const outcomes: Outcome[] = []
      for (const [i, k] of keys.entries()) {
        const e = l.entries.get(k)
        if (!e) continue
        if (keys.length > 1) setBusy(`Looking up ${k} (${i + 1} of ${keys.length})…`)
        const d = cloneEntry(e)
        try {
          const msg = await refreshFromIdentifiers(d, SERVICES)
          await l.saveEntry(d)
          outcomes.push({ source: k, status: 'added', key: k, message: msg })
        } catch (err) {
          outcomes.push({ source: k, status: 'failed', key: k, message: errText(err) })
        }
      }
      await l.writeLibraryBib()
      const ok = outcomes.filter((o) => o.status === 'added').length
      const headline = `${ok} updated${outcomes.length - ok ? `, ${outcomes.length - ok} not found` : ''}`
      setStatus(headline)
      if (keys.length === 1 && outcomes[0]?.status === 'failed') await os.dialog.alert(outcomes[0].message, { title: 'Look up' })
      else if (keys.length > 1) setDialog({ kind: 'results', title: 'Look up details', outcomes, headline })
    })
  }

  // -------------------------------------------------------------- copying

  const copy = async (kind: 'citation' | 'reference' | 'cite' | 'bibtex', list = selectedEntries()) => {
    if (!list.length) return
    try {
      if (kind === 'cite') await copyToClipboard(`\\cite{${list.map((e) => e.key).join(',')}}`)
      else if (kind === 'bibtex') await copyToClipboard(toBibtex(list, 'biblatex'))
      else if (kind === 'citation') await copyToClipboard(formatCitation(list, style))
      else {
        const refs = formatBibliography(list, style)
        await copyToClipboard(refs.map(htmlToText).join('\n'), refs.map((r) => `<p>${r}</p>`).join(''))
      }
      setStatus(`Copied ${kind === 'cite' ? '\\cite{…}' : kind === 'bibtex' ? 'BibLaTeX' : `the ${kind}`}`)
    } catch {
      await os.dialog.alert('The clipboard could not be reached. Allow clipboard access for KherveOS in the browser.', { title: 'Copy' })
    }
  }

  const dragRows = (ev: React.DragEvent, keys: string[]) => {
    const list = keys.map((k) => lib?.entries.get(k)).filter((e): e is Entry => !!e)
    ev.dataTransfer.setData(KEYS_MIME, keys.join('\n'))
    // Plain-text editors (LaTeX) get \cite; rich-text ones the formatted citation.
    ev.dataTransfer.setData('text/plain', `\\cite{${keys.join(',')}}`)
    ev.dataTransfer.setData('text/html', formatCitation(list, style))
    ev.dataTransfer.effectAllowed = 'copy'
  }

  // ------------------------------------------------------------ exporting

  const exportBib = async (dialect: Dialect | 'csl', list?: Entry[], stemName?: string) => {
    const l = libRef.current
    if (!l) return
    const sel = selectedEntries()
    const out = list ?? (sel.length > 1 ? sel : rows)
    if (!out.length) {
      await os.dialog.alert('No references to export.', { title: 'Export' })
      return
    }
    const ext = dialect === 'csl' ? '.json' : '.bib'
    const colName = scope.kind === 'collection' ? l.collections.find((c) => c.id === scope.id)?.name : undefined
    // BibTeX can't read file names with spaces in \bibliography{}.
    const stem = (stemName ?? colName ?? l.name).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'references'
    const label = { biblatex: 'BibLaTeX', bibtex: 'BibTeX', csl: 'CSL-JSON' }[dialect]
    const p = await os.dialog.saveFile({ title: `Export ${out.length} references as ${label}`, startDir: `${HOME}/Documents`, defaultName: stem + ext, extensions: [ext] })
    if (!p) return
    const text =
      dialect === 'csl'
        ? JSON.stringify(
            [...out].sort((a, b) => (a.key.toLowerCase() < b.key.toLowerCase() ? -1 : 1)).map(toCsl),
            null,
            2,
          ) + '\n'
        : toBibtex(out, dialect)
    await run(null, async () => {
      await fs.writeText(p, text, { mkdirs: true })
      setStatus(`Exported ${out.length} references to ${path.pretty(p)}`)
    })
  }

  // ---------------------------------------------------------- collections

  const newCollection = async (parent: string) => {
    const name = await os.dialog.prompt(parent ? 'Name of the new subcollection:' : 'Name of the new collection:', { title: 'New collection', okLabel: 'Create' })
    if (!name?.trim()) return
    await run(null, async (l) => {
      const id = l.newCollectionId()
      l.collections.push({ id, name: name.trim(), parent })
      await l.saveCollections()
      setScope({ kind: 'collection', id })
    })
  }

  const renameCollection = async (c: Collection) => {
    const name = await os.dialog.prompt('New name:', { title: 'Rename collection', defaultValue: c.name, okLabel: 'Rename' })
    if (!name?.trim() || name.trim() === c.name) return
    await run(null, async (l) => {
      const col = l.collections.find((x) => x.id === c.id)
      if (col) col.name = name.trim()
      await l.saveCollections()
    })
  }

  const deleteCollection = async (c: Collection) => {
    const l = libRef.current
    if (!l) return
    const ids = l.descendants(c.id)
    const sub = ids.size > 1 ? ` and its ${ids.size - 1} subcollection${ids.size > 2 ? 's' : ''}` : ''
    if (!(await os.dialog.confirm(`Delete the collection “${c.name}”${sub}? The references in it stay in the library.`, { title: 'Delete collection', okLabel: 'Delete', danger: true })))
      return
    await run(null, async (l) => {
      l.collections = l.collections.filter((x) => !ids.has(x.id))
      await l.saveCollections()
      for (const e of [...l.entries.values()]) {
        if (!e.collections.some((x) => ids.has(x))) continue
        const d = cloneEntry(e)
        d.collections = d.collections.filter((x) => !ids.has(x))
        await l.saveEntry(d)
      }
      if (scope.kind === 'collection' && ids.has(scope.id)) setScope({ kind: 'all' })
    })
  }

  const fileInCollection = (keys: string[], id: string) =>
    run(null, async (l) => {
      let n = 0
      for (const k of keys) {
        const e = l.entries.get(k)
        if (!e || e.collections.includes(id)) continue
        const d = cloneEntry(e)
        d.collections.push(id)
        await l.saveEntry(d)
        n++
      }
      const name = l.collections.find((c) => c.id === id)?.name
      setStatus(n ? `Filed ${n} reference${n > 1 ? 's' : ''} in ${name}` : `Already in ${name}`)
    })

  const removeFromCollection = (keys: string[], id: string) =>
    run(null, async (l) => {
      for (const k of keys) {
        const e = l.entries.get(k)
        if (!e?.collections.includes(id)) continue
        const d = cloneEntry(e)
        d.collections = d.collections.filter((x) => x !== id)
        await l.saveEntry(d)
      }
    })

  const collectionMenu = (ev: React.MouseEvent, c: Collection) => {
    const l = libRef.current
    if (!l) return
    os.contextMenu(ev, [
      { label: 'New subcollection…', onClick: () => void newCollection(c.id) },
      { label: 'Rename…', onClick: () => void renameCollection(c) },
      {
        label: 'Export as .bib for LaTeX…',
        onClick: () => {
          const ids = l.descendants(c.id)
          void exportBib('biblatex', [...l.entries.values()].filter((e) => e.collections.some((x) => ids.has(x))), c.name)
        },
      },
      '-',
      { label: 'Delete collection…', danger: true, onClick: () => void deleteCollection(c) },
    ])
  }

  const dropOnCollection = (id: string, ev: React.DragEvent) => {
    const keys = ev.dataTransfer.getData(KEYS_MIME)
    if (keys) return void fileInCollection(keys.split('\n').filter(Boolean), id)
    void handleDrop(ev.dataTransfer, id)
  }

  // -------------------------------------------------------- drag and drop

  const handleDrop = async (dt: DataTransfer, collection = scopeCollection) => {
    const raw = dt.getData(DRAG_MIME)
    if (raw) {
      try {
        return void (await importDrivePaths(JSON.parse(raw) as string[], collection))
      } catch {
        /* not ours */
      }
    }
    if (dt.files.length) return void (await importLocalFiles([...dt.files], collection))
    const text = dt.getData('text/plain')
    if (text) await addFromText(text, collection)
  }

  const rowMenu = (ev: React.MouseEvent, e: Entry) => {
    const l = libRef.current
    if (!l) return
    const keys = selectedSet.has(e.key) ? [...selectedSet] : [e.key]
    const list = keys.map((k) => l.entries.get(k)!).filter(Boolean)
    const items: MenuItem[] = [
      { label: 'Open PDF', disabled: !e.files.length, onClick: () => void openFile(e) },
      { label: 'Attach PDF…', onClick: () => void attachTo(e) },
      '-',
      { label: 'Copy citation', onClick: () => void copy('citation', list) },
      { label: 'Copy reference', onClick: () => void copy('reference', list) },
      { label: 'Copy \\cite{…}', onClick: () => void copy('cite', list) },
      { label: 'Copy BibLaTeX', onClick: () => void copy('bibtex', list) },
      '-',
      {
        label: 'Add to collection',
        disabled: !l.collections.length,
        submenu: l.collections.map((c): MenuItem => ({ label: c.name, onClick: () => void fileInCollection(keys, c.id) })),
      },
      ...(scope.kind === 'collection' ? [{ label: 'Remove from this collection', onClick: () => void removeFromCollection(keys, scope.id) }] : []),
      '-',
      { label: 'Look up details online', onClick: () => void lookup(keys) },
      { label: 'Rename key…', disabled: keys.length !== 1, onClick: () => void renameKey(e) },
      {
        label: 'Export selected',
        submenu: [
          { label: 'BibLaTeX…', onClick: () => void exportBib('biblatex', list) },
          { label: 'BibTeX…', onClick: () => void exportBib('bibtex', list) },
          { label: 'CSL-JSON…', onClick: () => void exportBib('csl', list) },
        ],
      },
      '-',
      { label: keys.length > 1 ? `Delete ${keys.length} references…` : 'Delete…', danger: true, onClick: () => void deleteSelected() },
    ]
    os.contextMenu(ev, items)
  }

  // ------------------------------------------------- opening other libraries

  const openOther = async () => {
    const p = await os.dialog.pickFolder({ title: 'Open a kRef library (its folder)', startDir: `${HOME}/Documents` })
    if (p) await openAt(p)
  }
  const createOther = async () => {
    const p = await os.dialog.saveFile({ title: 'New library: a new folder', startDir: `${HOME}/Documents`, defaultName: 'My References' })
    if (!p) return
    try {
      show(await createLibrary(fs, p))
    } catch (e) {
      await os.dialog.alert(e instanceof LibraryError ? e.message : errText(e), { title: 'New library' })
    }
  }

  // ------------------------------------------------------------- AI tools

  useAppTools(
    win,
    useMemo(
      () =>
        makeAiTools({
          lib: () => libRef.current,
          services: SERVICES,
          changed: (keys) => {
            lastWrite.current = Date.now()
            if (keys?.length) setSelected(keys)
            bump()
          },
        }),
      [],
    ),
  )

  // ---------------------------------------------------------------- menus

  const one = current
  useEffect(() => {
    const ready = !!lib
    const has = selectedSet.size > 0
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New Reference…', icon: SquarePen, disabled: !ready, onClick: () => void newReference() },
          { label: 'Add by DOI, arXiv id or ISBN…', icon: Plus, disabled: !ready, onClick: () => setDialog({ kind: 'add', text: '' }) },
          { label: 'Add PDF from the Drive…', icon: FilePlus2, disabled: !ready, onClick: () => void addPdfsFromDrive() },
          { label: 'Add PDFs from this Computer…', disabled: !ready, onClick: () => void addPdfsFromComputer() },
          { label: 'Import BibTeX / CSL-JSON from the Drive…', icon: FileUp, disabled: !ready, onClick: () => void importBibFromDrive() },
          { label: 'Import BibTeX / CSL-JSON from this Computer…', disabled: !ready, onClick: () => void importBibFromComputer() },
          '-',
          { label: 'Export BibLaTeX…', icon: Download, disabled: !ready, onClick: () => void exportBib('biblatex') },
          { label: 'Export BibTeX (natbib)…', disabled: !ready, onClick: () => void exportBib('bibtex') },
          { label: 'Export CSL-JSON…', disabled: !ready, onClick: () => void exportBib('csl') },
          '-',
          { label: 'New Library…', onClick: () => void createOther() },
          { label: 'Open Library…', icon: FolderOpen, onClick: () => void openOther() },
          { label: 'Show Library in Files', disabled: !ready, onClick: () => lib && os.open('files', { path: lib.root }) },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Copy Citation', disabled: !has, onClick: () => void copy('citation') },
          { label: 'Copy Reference', disabled: !has, onClick: () => void copy('reference') },
          { label: 'Copy \\cite{key}', disabled: !has, onClick: () => void copy('cite') },
          { label: 'Copy BibLaTeX', disabled: !has, onClick: () => void copy('bibtex') },
          '-',
          { label: 'Select All', disabled: !rows.length, onClick: () => setSelected(rows.map((e) => e.key)) },
          { label: 'Find', shortcut: '⌘F', onClick: () => searchBox.current?.focus() },
          '-',
          { label: 'Delete…', icon: Trash2, danger: true, disabled: !has, onClick: () => void deleteSelected() },
        ],
      },
      {
        label: 'Reference',
        items: [
          { label: 'Open PDF in kPDF', disabled: !one?.files.length, onClick: () => one && void openFile(one) },
          { label: 'Attach PDF…', disabled: !one, onClick: () => one && void attachTo(one) },
          '-',
          { label: 'Look Up Details Online', icon: RefreshCw, disabled: !has, onClick: () => void lookup([...selectedSet]) },
          {
            label: 'Look Up All That Need Checking',
            disabled: !entries.some((e) => e.needs_review),
            onClick: () => void lookup(entries.filter((e) => e.needs_review).map((e) => e.key)),
          },
          '-',
          { label: 'Rename Key…', disabled: !one, onClick: () => one && void renameKey(one) },
        ],
      },
      {
        label: 'Collection',
        items: [
          { label: 'New Collection…', disabled: !ready, onClick: () => void newCollection('') },
          {
            label: 'Add Selected to',
            disabled: !has || !lib?.collections.length,
            submenu: (lib?.collections ?? []).map((c): MenuItem => ({ label: c.name, onClick: () => void fileInCollection([...selectedSet], c.id) })),
          },
        ],
      },
      {
        label: 'View',
        items: [
          {
            label: 'Citation Style',
            submenu: Object.entries(STYLES).map(([id, label]): MenuItem => ({ label, checked: style === id, onClick: () => chooseStyle(id) })),
          },
        ],
      },
    ]
    win.setMenus(menus)
  })
  useEffect(() => () => win.setMenus(null), [win])

  const chooseStyle = (id: string) => {
    setStyle(id)
    setPref(STYLE_PREF, id)
  }

  // ------------------------------------------------------------- render

  if (phase === 'loading') {
    return (
      <div className="k-center kr-app">
        <Loader2 className="k-spin" size={22} />
      </div>
    )
  }

  if (phase === 'start' || !lib) {
    return (
      <div className="k-center kr-app kr-start">
        <BookMarked size={40} className="kr-accent" />
        <h2>kRef</h2>
        <p className="k-muted">Open a reference library, or start a new one.</p>
        <div className="kr-row-buttons">
          <button className="k-btn primary" onClick={() => void createOther()}>
            New library…
          </button>
          <button className="k-btn" onClick={() => void openOther()}>
            Open library…
          </button>
        </div>
      </div>
    )
  }

  const scopeName =
    scope.kind === 'all'
      ? 'All references'
      : scope.kind === 'unfiled'
        ? 'Unfiled'
        : scope.kind === 'review'
          ? 'Needs checking'
          : scope.kind === 'tag'
            ? `Tag: ${scope.tag}`
            : (lib.collections.find((c) => c.id === scope.id)?.name ?? '')

  return (
    <div
      ref={rootRef}
      className={`k-app kr-app${dropping ? ' kr-dropping' : ''}`}
      onKeyDown={(ev) => {
        if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'f') {
          ev.preventDefault()
          searchBox.current?.focus()
        }
      }}
      onDragOver={(ev) => {
        const t = ev.dataTransfer.types
        if (t.includes(KEYS_MIME)) return
        if (t.includes('Files') || t.includes(DRAG_MIME) || t.includes('text/plain')) {
          ev.preventDefault()
          ev.dataTransfer.dropEffect = 'copy'
          if (!dropping) setDropping(true)
        }
      }}
      onDragLeave={(ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setDropping(false)
      }}
      onDrop={(ev) => {
        setDropping(false)
        if (ev.dataTransfer.types.includes(KEYS_MIME)) return
        ev.preventDefault()
        void handleDrop(ev.dataTransfer)
      }}
    >
      <div className="k-toolbar kr-toolbar">
        <button className="k-btn small" title="Add references by DOI, arXiv id or ISBN, or paste BibTeX" onClick={() => setDialog({ kind: 'add', text: '' })}>
          <Plus size={14} /> Add
        </button>
        <button className="k-icon-btn" title="Add a PDF from the drive (its DOI is read and looked up)" onClick={() => void addPdfsFromDrive()}>
          <FilePlus2 size={16} />
        </button>
        <button className="k-icon-btn" title="Import a .bib or CSL-JSON file" onClick={() => void importBibFromDrive()}>
          <FileUp size={16} />
        </button>
        <button className="k-icon-btn" title="New reference…" onClick={() => void newReference()}>
          <SquarePen size={16} />
        </button>
        <span className="k-sep" />
        <button className="k-icon-btn" title="Look up the selected references' details online" disabled={!selectedSet.size} onClick={() => void lookup([...selectedSet])}>
          <RefreshCw size={16} />
        </button>
        <button className="k-icon-btn" title="Delete the selected references…" disabled={!selectedSet.size} onClick={() => void deleteSelected()}>
          <Trash2 size={16} />
        </button>
        <span className="k-sep" />
        <button className="k-icon-btn" title="Export as BibLaTeX…" onClick={() => void exportBib('biblatex')}>
          <Download size={16} />
        </button>
        <span className="k-spacer" />
        <div className="kr-search">
          <Search size={14} />
          <input
            ref={searchBox}
            className="k-input"
            placeholder="Search title, author, journal, DOI, tag…"
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
            onKeyDown={(ev) => ev.key === 'Escape' && setSearch('')}
          />
          {search && (
            <button className="k-icon-btn" title="Clear" onClick={() => setSearch('')}>
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="kr-main">
        <Sidebar
          entries={entries}
          collections={lib.collections}
          scope={scope}
          onScope={(s) => {
            if (!sameScope(s, scope)) setScope(s)
          }}
          onNewCollection={(p) => void newCollection(p)}
          onCollectionMenu={collectionMenu}
          onDropOnCollection={dropOnCollection}
        />
        <RefTable
          rows={rows}
          selected={selectedSet}
          sort={sort}
          onSort={setSort}
          onSelect={setSelected}
          onOpen={(e) => void openFile(e)}
          onDelete={() => void deleteSelected()}
          onContextMenu={rowMenu}
          onDragStart={dragRows}
          empty={
            entries.length ? (
              <span>Nothing matches{search ? ` “${search}”` : ''} in {scopeName}.</span>
            ) : (
              <div className="kr-welcome">
                <LibraryIcon size={30} className="kr-accent" />
                <p>
                  <b>Your library is empty.</b>
                </p>
                <p className="k-muted">Drop PDFs or .bib files here, or add references by DOI, arXiv id or ISBN.</p>
                <button className="k-btn primary" onClick={() => setDialog({ kind: 'add', text: '' })}>
                  <Plus size={14} /> Add by identifier
                </button>
              </div>
            )
          }
        />
        <Details
          entry={current}
          selectedCount={selectedSet.size}
          collections={lib.collections}
          style={style}
          onSave={(d) => void saveEntry(d)}
          onLookup={(e) => void lookup([e.key])}
          onOpenFile={(e, i) => void openFile(e, i)}
          onAttach={(e) => void attachTo(e)}
          onRemoveFile={(e, i) => void removeFile(e, i)}
          onRenameKey={(e) => void renameKey(e)}
          onCopy={(k) => void copy(k)}
          onSetStyle={chooseStyle}
          onDeleteSelected={() => void deleteSelected()}
        />
      </div>

      <div className="k-statusbar kr-status">
        {busy ? (
          <span className="kr-busy">
            <Loader2 size={12} className="k-spin" /> {busy}
          </span>
        ) : (
          <span>{status || `${scopeName}: ${rows.length} of ${entries.length} references`}</span>
        )}
        <span className="k-spacer" style={{ flex: 1 }} />
        <span title={lib.root}>{path.pretty(lib.root)}</span>
      </div>

      {dropping && (
        <div className="kr-dropzone">
          <FilePlus2 size={30} />
          <span>Drop PDFs, .bib files, DOIs or BibTeX to add them{scopeCollection ? ` to ${scopeName}` : ''}</span>
        </div>
      )}

      {dialog?.kind === 'add' && (
        <AddDialog
          initial={dialog.text}
          onCancel={() => setDialog(null)}
          onAdd={(text) => {
            setDialog(null)
            void addFromText(text)
          }}
        />
      )}
      {dialog?.kind === 'results' && (
        <ResultsDialog
          title={dialog.title}
          headline={dialog.headline}
          outcomes={dialog.outcomes}
          onClose={() => setDialog(null)}
          onShow={(key) => {
            setDialog(null)
            setScope({ kind: 'all' })
            setSearch('')
            setSelected([key])
          }}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ dialogs

function AddDialog({ initial, onAdd, onCancel }: { initial: string; onAdd(text: string): void; onCancel(): void }) {
  const [text, setText] = useState(initial)
  const { ids } = useMemo(() => splitIdentifiers(text), [text])
  const bib = /^\s*@\w+\s*[{(]/m.test(text) || /^\s*[[{]/.test(text)
  return (
    <div className="kr-modal-backdrop" onMouseDown={(ev) => ev.target === ev.currentTarget && onCancel()}>
      <div className="kr-modal" role="dialog" aria-label="Add references" onKeyDown={(ev) => ev.key === 'Escape' && onCancel()}>
        <h3>Add references</h3>
        <p className="k-muted">
          DOIs, arXiv ids or ISBNs, one per line — or paste BibTeX / BibLaTeX / CSL-JSON. Details are looked up on Crossref, arXiv and OpenLibrary.
        </p>
        <textarea
          className="k-input"
          rows={8}
          autoFocus
          placeholder={'10.1038/nphys1170\narXiv:2101.00001\n978-0-262-03384-8'}
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && text.trim()) onAdd(text)
          }}
        />
        <div className="kr-modal-buttons">
          <span className="k-muted kr-small">{bib ? 'BibTeX / CSL-JSON' : ids.length ? `${ids.length} identifier${ids.length > 1 ? 's' : ''}` : ''}</span>
          <span className="kr-spacer" />
          <button className="k-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="k-btn primary" disabled={!text.trim()} onClick={() => onAdd(text)}>
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

const STATUS_LABEL: Record<Outcome['status'], string> = {
  added: 'Added',
  review: 'Needs checking',
  attached: 'PDF attached',
  duplicate: 'Already there',
  failed: 'Failed',
}
const ORDER: Outcome['status'][] = ['failed', 'review', 'added', 'attached', 'duplicate']

function ResultsDialog(props: { title: string; headline: string; outcomes: Outcome[]; onClose(): void; onShow(key: string): void }) {
  const list = [...props.outcomes].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))
  return (
    <div className="kr-modal-backdrop" onMouseDown={(ev) => ev.target === ev.currentTarget && props.onClose()}>
      <div className="kr-modal kr-results" role="dialog" aria-label={props.title} onKeyDown={(ev) => ev.key === 'Escape' && props.onClose()}>
        <h3>{props.title}</h3>
        <p>
          <b>{props.headline}</b>
        </p>
        <div className="kr-results-list">
          {list.map((o, i) => (
            <div key={i} className={`kr-result kr-result-${o.status}`}>
              <span className="kr-result-status">
                {o.status === 'failed' || o.status === 'review' ? <AlertTriangle size={12} /> : null}
                {STATUS_LABEL[o.status]}
              </span>
              {o.key ? (
                <button className="k-link-btn kr-mono" onClick={() => props.onShow(o.key)}>
                  {o.key}
                </button>
              ) : (
                <span />
              )}
              <span className="kr-result-source" title={o.source}>
                {o.source}
              </span>
              <span className="k-muted" title={o.message}>
                {o.message}
              </span>
            </div>
          ))}
        </div>
        <div className="kr-modal-buttons">
          <span className="kr-spacer" />
          <button className="k-btn primary" autoFocus onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
