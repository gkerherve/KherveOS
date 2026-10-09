// kELN — an electronic lab notebook. One .keln file (JSON) holds projects, dated entries (rich text with structured
// blocks), samples, an inventory and an append-only audit log chained by SHA-256. Entries are drafts until signed
// (then read-only; corrections are addenda). A tamper-evident record in your files, not a certified 21 CFR Part 11 system.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, CalendarDays, FilePlus, FlaskConical, FolderOpen, PanelLeft, PanelRight, Save, Search as SearchIcon, ShieldAlert, ShieldCheck, Beaker, History, FileText,
} from 'lucide-react'
import { os, fs, path as osPath, HOME, type AppProps, type MenuBarMenu } from '@/os'
import type { MenuItem } from '@/os/ui/Menu'
import { useAuth } from '@/os/server'
import { useAppTools } from '@/os/ai/appTools'
import { exampleFolderPath, groupExamples, seedExampleFolder, type ExampleFile } from '@/os/exampleFiles'
import { kelnTools, type Hooks } from './aiTools'
import { verifyNotebook, reportSummary, type VerifyReport } from './audit'
import { AuditView } from './AuditView'
import { CalendarView } from './CalendarView'
import { AmendDialog, LabelDialog, LinkDialog, MathDialog, NewEntryDialog, NewNotebookDialog, ProjectDialog, SettingsDialog, type NewEntryValues, type NewNotebookValues } from './dialogs'
import { markdownToDoc, type PMNode } from './doc'
import type { BlockEnv, ParentEditorEnv } from './env'
import { EntryView, type EntryActions } from './EntryView'
import { attachmentBytes, buildPdf, extractAttachment, isImage, makeAttachment, mimeOf, printHtml, safeName, renderMath } from './files'
import { Home } from './Home'
import { importFile } from './importers'
import { Inspector } from './Inspector'
import {
  getEntry, getSample, nextExperiment, type Attachment, type Entry, type EntryLink, type InventoryItem, type Notebook, type SavedSearch, type SearchFilters, type Sample,
} from './model'
import {
  addEntry, addInstrument, addProject, addSample, amendEntry, createNotebook, deleteEntry, duplicateEntry, logExport, recordEdit, removeInventory, removeSample, removeSavedSearch, saveSearch,
  signEntry, updateEntry, updateSample, upsertInventory, witnessEntry, type EditPatch, type FlagPatch,
} from './notebook'
import { entryToDocument, entryToJson, entryToMarkdown, notebookToDocument, notebookToMarkdown, renderCtx } from './render'
import { labelSheetHtml, type LabelOptions } from './samples'
import { SearchView } from './SearchView'
import { InventoryView, SamplesView } from './SamplesView'
import { Sidebar } from './Sidebar'
import { getTemplate, instantiateTemplate } from './templates'
import { Modal } from './ui'
import { BACKUP_DIR, NOTEBOOK_DIR, freeNotebookPath, loadRecent, useBook } from './useBook'
import { KELN_EXAMPLES_FOLDER } from './exampleFiles'
import './keln.css'

const PREFS_KEY = 'kherveos.keln.prefs'
type View = 'entry' | 'calendar' | 'samples' | 'inventory' | 'search' | 'audit'

interface Prefs { author: string; backup: boolean; sidebar: boolean; inspector: boolean }
const DEFAULT_PREFS: Prefs = { author: '', backup: false, sidebar: true, inspector: true }

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return { ...DEFAULT_PREFS, ...Object.fromEntries(Object.entries(raw).filter(([k, v]) => k in DEFAULT_PREFS && typeof v === typeof DEFAULT_PREFS[k as keyof Prefs])) }
  } catch { return DEFAULT_PREFS }
}

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

type Dlg =
  | { kind: 'newNotebook' }
  | { kind: 'newEntry'; initial: Partial<NewEntryValues> }
  | { kind: 'settings' }
  | { kind: 'project' }
  | { kind: 'amend'; entryId: string }
  | { kind: 'link' }
  | { kind: 'math'; initial: string; display: boolean; resolve(v: string | null): void }
  | { kind: 'labels'; ids: string[] }

const HELP = [
  'kELN keeps one notebook in one .keln file. Entries belong to a project and an experiment number (PROJ-YYYY-NNN).',
  'Write in the editor; insert structured blocks (reaction table with % yield, measurements with mean ± sd, instrument run, timeline, safety, plot, steps).',
  'Type @ to link a sample, $…$ for maths. Attach files from the drive (their SHA-256 is recorded) and drag files in from Files.',
  'Sign an entry to lock it; a second person can witness it; later corrections are addenda. Notebook ▸ Verify recomputes the audit chain.',
  'This is a tamper-evident record, not a certified 21 CFR Part 11 system.',
].join('\n\n')

const SHORTCUTS = ['⌘N  new entry', '⇧⌘N  new notebook', '⌘O  open a notebook', '⌘S  save', '⌘F  search', '⌘P  export the entry as PDF', '↑ ↓  move through entries in the tree', '⌘B ⌘I ⌘U  bold, italic, underline', '@  link a sample', '$x$  inline maths'].join('\n')

export default function KELN({ win, args }: AppProps) {
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const setPrefs = (patch: Partial<Prefs>) => setPrefsState((p) => {
    const next = { ...p, ...patch }
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)) } catch { /* storage blocked */ }
    return next
  })
  const osUser = useAuth((s) => s.user?.display_name || s.user?.username || '')
  const flushRef = useRef<(() => void) | null>(null)
  const flush = useCallback(() => flushRef.current?.(), [])

  const bk = useBook({ win, user: prefs.author || osUser || 'user', backup: prefs.backup, flush })
  const { book, live, commit, save } = bk
  const nb = book.nb
  const userName = prefs.author.trim() || osUser || nb?.owner || 'user'
  const userRef = useRef(userName)
  userRef.current = userName

  const [view, setView] = useState<View>('entry')
  const [sel, setSel] = useState<string | null>(null)
  const [selSample, setSelSample] = useState<string | null>(null)
  const [selInv, setSelInv] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<SearchFilters>({})
  const [auditEntry, setAuditEntry] = useState<string | null>(null)
  const [dlg, setDlg] = useState<Dlg | null>(null)
  const [report, setReport] = useState<VerifyReport | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [words, setWords] = useState(0)
  const [searchTick, setSearchTick] = useState(0)
  const [width, setWidth] = useState(1200)
  const [exampleFiles, setExampleFiles] = useState<ExampleFile[]>([])
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const root = useRef<HTMLDivElement>(null)
  const compact = width < 900
  const entry = nb && sel ? getEntry(nb, sel) ?? null : null

  // ------------------------------------------------------------ examples

  const refreshExamples = useCallback(async (): Promise<ExampleFile[]> => {
    let files = await seedExampleFolder({ app: 'keln', folderName: KELN_EXAMPLES_FOLDER, fs })
    if (!files.length) {
      // offline or not built: write the examples from the code (only when none could be copied)
      try {
        const { kelnExampleFiles } = await import('./exampleFiles')
        const dir = exampleFolderPath(KELN_EXAMPLES_FOLDER)
        for (const f of kelnExampleFiles()) {
          const target = osPath.join(dir, f.file)
          if (!fs.exists(target)) await fs.writeText(target, f.content, { mkdirs: true })
        }
        files = kelnExampleFiles().map((f) => ({ file: f.file, title: f.title, description: f.description, group: f.group, path: osPath.join(dir, f.file) })).filter((f) => fs.exists(f.path))
      } catch { /* leave the list empty */ }
    }
    setExampleFiles(files)
    return files
  }, [])
  useEffect(() => { void refreshExamples() }, [refreshExamples])

  // ------------------------------------------------------------ window: size, title

  useEffect(() => {
    const el = root.current
    if (!el) return
    let first = true
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      setWidth(w)
      if (first && w > 0) { first = false; if (w < 900) setPrefsState((p) => ({ ...p, sidebar: false, inspector: false })) }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const dirty = !!nb && book.rev !== book.savedRev
  useEffect(() => { win.setTitle(nb ? `kELN — ${nb.title}${dirty ? ' •' : ''}` : 'kELN') }, [win, nb, dirty])

  // ------------------------------------------------------------ opening and creating

  const enterNotebook = useCallback((n: Notebook) => {
    setView('entry')
    setSel(n.entries.length ? [...n.entries].sort((a, b) => b.modified.localeCompare(a.modified))[0].id : null)
    setSelSample(null)
    setSelInv(null)
    setQuery('')
    setFilters({})
    setReport(null)
    setRecent(loadRecent())
  }, [])

  const openPathChecked = useCallback(async (path: string) => {
    if (live.current.nb && !(await bk.confirmLeave())) return
    if (await bk.openPath(path)) {
      if (live.current.nb) enterNotebook(live.current.nb)
    }
  }, [bk, enterNotebook, live])

  const openDialog = useCallback(async () => {
    const p = await os.dialog.openFile({ title: 'Open notebook', extensions: ['.keln'], startDir: fs.isDir(NOTEBOOK_DIR) ? NOTEBOOK_DIR : undefined })
    if (p) await openPathChecked(p)
  }, [openPathChecked])

  useEffect(() => {
    if (args.path && typeof args.path === 'string') void openPathChecked(args.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.path])

  const createNew = useCallback(async (v: NewNotebookValues) => {
    if (live.current.nb && !(await bk.confirmLeave())) return
    const ctx = bk.makeCtx()
    const who = v.owner.trim() || userRef.current
    const made = createNotebook({ ...ctx, user: who }, { title: v.title.trim(), owner: who, projects: [{ code: v.projectCode, name: v.projectName }], samplePrefix: v.samplePrefix.trim() })
    const path = freeNotebookPath(v.folder.trim() || NOTEBOOK_DIR, v.title)
    bk.openNotebook(made, path, true)
    setDlg(null)
    enterNotebook(made)
    if (!prefs.author.trim()) setPrefs({ author: who })
    await save()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bk, enterNotebook, live, save, prefs.author])

  // ------------------------------------------------------------ the entry operations

  const patchEntry = useCallback((id: string, patch: EditPatch & FlagPatch) => {
    commit((n, ctx) => (getEntry(n, id) ? recordEdit(updateEntry(n, id, patch, ctx), id, ctx, { gapMinutes: 10 }) : n))
  }, [commit])

  const newEntry = useCallback((v: NewEntryValues) => {
    const tpl = getTemplate(v.templateId) ?? getTemplate('blank')!
    const inst = instantiateTemplate(tpl)
    const box: { e: Entry | null } = { e: null }
    commit((n, ctx) => {
      const r = addEntry(n, { projectId: v.projectId, title: v.title.trim() || inst.title, content: inst.content, tags: inst.tags, template: inst.template, links: inst.links, experiment: v.experiment || undefined, date: v.date || undefined, author: userRef.current }, ctx)
      box.e = r.entry
      return r.nb
    })
    setDlg(null)
    if (box.e) { setSel(box.e.id); setView('entry') }
  }, [commit])

  const askNewEntry = useCallback((projectId?: string, experiment?: string, date?: string) => {
    const n = live.current.nb
    if (!n) return
    if (!n.projects.length) { setDlg({ kind: 'project' }); return }
    setDlg({ kind: 'newEntry', initial: { projectId: projectId ?? (sel ? getEntry(n, sel)?.projectId : undefined) ?? n.projects[0].id, experiment: experiment ?? '', date: date ? `${date}T09:00:00` : '' } })
  }, [live, sel])

  const sign = useCallback(async () => {
    flush()
    const n = live.current.nb
    const e = n && sel ? getEntry(n, sel) : null
    if (!n || !e) return
    const ok = await os.dialog.confirm(
      `Sign “${e.title}” (${e.experiment}) as ${userRef.current}?\n\nThe entry becomes read-only. Its SHA-256 content hash, your name and the time are recorded in the audit log. Later corrections can only be added as addenda.\n\nThis is a tamper-evident record, not a certified 21 CFR Part 11 signature.`,
      { title: 'Sign entry', okLabel: 'Sign' },
    )
    if (!ok) return
    commit((x, ctx) => signEntry(x, e.id, ctx))
  }, [commit, flush, live, sel])

  const witness = useCallback(async () => {
    const n = live.current.nb
    const e = n && sel ? getEntry(n, sel) : null
    if (!n || !e) return
    const name = await os.dialog.prompt(`Name of the person witnessing ${e.experiment} (must differ from ${e.signature?.user ?? 'the signer'}):`, { title: 'Witness', okLabel: 'Witness' })
    if (name && name.trim()) commit((x, ctx) => witnessEntry(x, e.id, name, ctx))
  }, [commit, live, sel])

  const duplicate = useCallback((id?: string) => {
    const target = id ?? sel
    if (!target) return
    flush()
    const box: { e: Entry | null } = { e: null }
    commit((n, ctx) => { const r = duplicateEntry(n, target, ctx); box.e = r.entry; return r.nb })
    if (box.e) { setSel(box.e.id); setView('entry') }
  }, [commit, flush, sel])

  const removeDraft = useCallback(async (id?: string) => {
    const n = live.current.nb
    const e = n ? getEntry(n, id ?? sel ?? '') : null
    if (!n || !e) return
    if (!(await os.dialog.confirm(`Delete the draft “${e.title}” (${e.experiment})? The deletion is recorded in the audit log.`, { title: 'Delete draft', okLabel: 'Delete', danger: true }))) return
    flush()
    if (commit((x, ctx) => deleteEntry(x, e.id, ctx))) {
      const rest = live.current.nb?.entries ?? []
      setSel(rest.length ? rest[rest.length - 1].id : null)
    }
  }, [commit, flush, live, sel])

  // ------------------------------------------------------------ attachments

  const urls = useRef(new Map<string, string>())
  const [urlVer, setUrlVer] = useState(0)
  useEffect(() => () => { for (const u of urls.current.values()) if (u.startsWith('blob:')) URL.revokeObjectURL(u) }, [])
  useEffect(() => {
    if (!entry) return
    let dead = false
    void (async () => {
      let changed = false
      for (const a of entry.attachments) {
        if (!isImage(a) || urls.current.has(a.id)) continue
        const bytes = await attachmentBytes(a)
        if (dead || !bytes) continue
        urls.current.set(a.id, a.data != null ? `data:${a.mime};base64,${a.data}` : URL.createObjectURL(new Blob([bytes as BlobPart], { type: a.mime })))
        changed = true
      }
      if (changed && !dead) setUrlVer((v) => v + 1)
    })()
    return () => { dead = true }
  }, [entry])

  const addAttachment = useCallback(async (entryId: string, name: string, bytes: Uint8Array, path: string, mime?: string): Promise<Attachment | null> => {
    const image = /^image\//.test(mime ?? mimeOf(name))
    let embed = image && bytes.length <= 1_000_000
    if (!image && bytes.length <= 1_000_000) {
      const c = await os.dialog.choose(`Embed a copy of “${name}” (${(bytes.length / 1024).toFixed(1)} kB) inside the notebook?\n\nEmbedded files travel with the .keln file. A linked file stays where it is and opens in its own app; its SHA-256 is recorded either way.`,
        [{ label: 'Cancel', value: 'cancel' }, { label: 'Link only', value: 'link' }, { label: 'Embed a copy', value: 'embed', primary: true }], { title: 'Attach file' })
      if (c === null || c === 'cancel') return null
      embed = c === 'embed'
    }
    const ctx = bk.makeCtx()
    const att = await makeAttachment({ id: ctx.id('att'), name, bytes, path, user: userRef.current, now: ctx.now(), embed, mime })
    const ok = commit((n, c2) => {
      const e = getEntry(n, entryId)
      if (!e) return n
      return updateEntry(n, entryId, { attachments: [...e.attachments, att] }, c2)
    })
    return ok ? att : null
  }, [bk, commit])

  const attachPath = useCallback(async (path: string): Promise<Attachment | null> => {
    const id = sel
    if (!id) return null
    if (!fs.exists(path) || fs.isDir(path)) { void os.dialog.alert('Only files can be attached; a folder can be added as a link.', { title: 'Attach' }); return null }
    try { return await addAttachment(id, osPath.basename(path), await fs.readBytes(path), path) } catch (e) { void os.dialog.alert(msgOf(e), { title: 'Attach' }); return null }
  }, [addAttachment, sel])

  const attachFileObject = useCallback(async (file: File): Promise<Attachment | null> => {
    const id = sel
    if (!id) return null
    const bytes = new Uint8Array(await file.arrayBuffer())
    const name = file.name && file.name !== 'image.png' ? file.name : `pasted-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`
    // a copy in the drive too, so another app can open it
    const dir = `${HOME}/Documents/kELN Attachments`
    let path = ''
    try { path = osPath.join(dir, fs.uniqueName(dir, name)); await fs.writeBytes(path, bytes, { mkdirs: true }) } catch { path = '' }
    return addAttachment(id, name, bytes, path, file.type || undefined)
  }, [addAttachment, sel])

  const pickFile = useCallback(async (kind: 'any' | 'image'): Promise<string | null> => {
    if (!sel) return null
    const from = await os.dialog.choose('Where is the file?', [{ label: 'Cancel', value: 'cancel' }, { label: 'From this computer…', value: 'computer' }, { label: 'From the drive…', value: 'drive', primary: true }], { title: kind === 'image' ? 'Choose an image' : 'Attach a file' })
    if (!from || from === 'cancel') return null
    if (from === 'drive') {
      const p = await os.dialog.openFile({ title: kind === 'image' ? 'Choose an image' : 'Attach a file', extensions: kind === 'image' ? ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'] : undefined, startDir: `${HOME}/Documents` })
      return p ? (await attachPath(p))?.id ?? null : null
    }
    const file = await new Promise<File | null>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      if (kind === 'image') input.accept = 'image/*'
      input.onchange = () => resolve(input.files?.[0] ?? null)
      input.oncancel = () => resolve(null)
      input.click()
    })
    return file ? (await attachFileObject(file))?.id ?? null : null
  }, [attachFileObject, attachPath, sel])

  /** A path from a link or an instrument block: a clear message when it is not there (an app's example folder is made on first use). */
  const openLinkedPath = useCallback(async (p: string) => {
    if (!fs.exists(p)) {
      await os.dialog.alert(`“${osPath.pretty(p)}” is not in the drive (yet).\n\nIf it is an example folder of another Kherve app, open that app once and use File > Open examples folder: it copies the examples there.`, { title: 'Open link' })
      return
    }
    await os.openFile(p)
  }, [])

  const openAttachment = useCallback(async (a: Attachment) => {
    try {
      const path = await extractAttachment(a, HOME)
      if (!path) { await os.dialog.alert(`“${a.name}” is not available: the linked file was moved or deleted, and no copy is embedded in the notebook.`, { title: 'Open attachment' }); return }
      await os.openFile(path)
    } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Open attachment' }) }
  }, [])

  // ------------------------------------------------------------ environments for the editor and the blocks

  const blockEnv = useMemo<BlockEnv | null>(() => {
    if (!nb || !entry) return null
    return {
      readOnly: entry.status !== 'draft', nb, entry, samples: nb.samples, inventory: nb.inventory, instruments: nb.instruments, user: userName,
      attUrl: (id) => urls.current.get(id) ?? null,
      attachment: (id) => entry.attachments.find((a) => a.id === id),
      openAttachment: (id) => { const a = entry.attachments.find((x) => x.id === id); if (a) void openAttachment(a) },
      pickFile, attachFile: attachFileObject, attachPath,
      openPath: (p) => void openLinkedPath(p),
      rememberInstrument: (name) => commit((n) => addInstrument(n, name)),
      openSample: (id) => { setSelSample(id); setView('samples') },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nb, entry, userName, urlVer, pickFile, attachFileObject, attachPath, openAttachment, openLinkedPath, commit])

  const editorEnv = useMemo<ParentEditorEnv>(() => ({
    sampleExists: (id) => !!live.current.nb && !!getSample(live.current.nb, id),
    sampleLabel: (id) => { const s = live.current.nb ? getSample(live.current.nb, id) : undefined; return s ? `${s.id} · ${s.name}` : `${id} (not in the register)` },
    editMath: (initial, display) => new Promise((resolve) => setDlg({ kind: 'math', initial, display, resolve })),
    pickSample: (at, done) => {
      const samples = live.current.nb?.samples ?? []
      const items: MenuItem[] = samples.slice(0, 40).map((s) => ({ label: `${s.id}  ${s.name}`, onClick: () => done(s.id) }))
      if (!items.length) items.push({ label: 'No samples yet: add one in the Samples view', disabled: true })
      items.push('-', { label: 'Just an @', onClick: () => done('') })
      os.contextMenu(at, items)
    },
    openSample: (id) => { setSelSample(id); setView('samples') },
  }), [live])

  // ------------------------------------------------------------ exports

  const exportEntry = useCallback(async (format: 'pdf' | 'html' | 'md' | 'json', whole: boolean) => {
    flush()
    const n = live.current.nb
    const e = (!whole && n && sel ? getEntry(n, sel) : null) ?? null
    if (!n || (!whole && !e)) return
    const base = whole ? n.title : `${e!.experiment} ${e!.title}`
    const ext = format === 'md' ? '.md' : `.${format}`
    const target = await os.dialog.saveFile({ title: `Export ${whole ? 'notebook' : 'entry'} as ${format.toUpperCase()}`, defaultName: `${safeName(base)}${ext}`, extensions: [ext], startDir: `${HOME}/Documents` })
    if (!target) return
    try {
      const ctx = renderCtx(n, { math: renderMath })
      if (format === 'pdf') {
        const r = await buildPdf(n, e)
        await fs.writeBytes(target, r.pdf, { mkdirs: true })
        os.notify({ title: 'PDF exported', body: `${osPath.pretty(target)} · ${r.pages} page${r.pages === 1 ? '' : 's'}`, onClick: () => os.open('khervepdf', { path: target }) })
      } else {
        const text = format === 'html' ? (e ? entryToDocument(n, e, { mode: 'html', ctx }) : notebookToDocument(n, { mode: 'html', ctx }))
          : format === 'md' ? (e ? entryToMarkdown(n, e, ctx) : notebookToMarkdown(n, ctx))
            : e ? entryToJson(n, e) : JSON.stringify(n, null, 1) + '\n'
        await fs.writeText(target, text, { mkdirs: true })
        os.notify({ title: `${format.toUpperCase()} exported`, body: osPath.pretty(target), onClick: () => void os.openFile(target) })
      }
      commit((x, c) => logExport(x, e?.id ?? null, format.toUpperCase(), c))
    } catch (err) {
      await os.dialog.alert(`Could not export: ${msgOf(err)}`, { title: 'Export' })
    }
  }, [commit, flush, live, sel])

  const importText = useCallback(async () => {
    const n = live.current.nb
    if (!n) return
    if (!n.projects.length) { setDlg({ kind: 'project' }); return }
    const p = await os.dialog.openFile({ title: 'Import Markdown, text or a kNote note', extensions: ['.md', '.markdown', '.txt', '.knote'], startDir: `${HOME}/Documents` })
    if (!p) return
    try {
      const imp = importFile(osPath.basename(p), await fs.readBytes(p))
      const box: { e: Entry | null } = { e: null }
      const project = (sel ? getEntry(n, sel)?.projectId : undefined) ?? n.projects[0].id
      commit((x, ctx) => { const r = addEntry(x, { projectId: project, title: imp.title, content: imp.content, tags: imp.tags, author: userRef.current }, ctx); box.e = r.entry; return r.nb })
      if (box.e) { setSel(box.e.id); setView('entry') }
    } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Import' }) }
  }, [commit, live, sel])

  // ------------------------------------------------------------ labels

  const printLabels = useCallback(async (ids: string[], o: LabelOptions, pdf: boolean) => {
    const n = live.current.nb
    if (!n) return
    const samples = ids.map((id) => getSample(n, id)).filter((s): s is Sample => !!s)
    const html = labelSheetHtml(samples, n, o)
    if (!pdf) { printHtml(html); return }
    const target = await os.dialog.saveFile({ title: 'Save labels as PDF', defaultName: `${safeName(n.title)} labels.pdf`, extensions: ['.pdf'], startDir: `${HOME}/Documents` })
    if (!target) return
    try {
      const { htmlToPdfInWorker } = await import('./pdf')
      const { svgToPng } = await import('./files')
      let h = html
      for (const url of [...new Set(html.match(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+/g) ?? [])]) {
        const svg = atob(url.split(',')[1])
        h = h.split(url).join(await svgToPng(svg, Number(/\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 100), Number(/\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 30), 3))
      }
      const r = await htmlToPdfInWorker(h, 595.28, 841.89)
      await fs.writeBytes(target, r.pdf, { mkdirs: true })
      os.notify({ title: 'Labels saved', body: osPath.pretty(target), onClick: () => os.open('khervepdf', { path: target }) })
    } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Labels' }) }
  }, [live])

  // ------------------------------------------------------------ verify

  const runVerify = useCallback(async (quiet = false) => {
    const n = live.current.nb
    if (!n) return
    setVerifying(true)
    try {
      const r = await verifyNotebook(n)
      setReport(r)
      if (!quiet) os.notify({ title: r.ok ? 'Notebook verified' : 'Verification found problems', body: reportSummary(r) })
      else if (!r.ok) os.notify({ title: 'kELN: this notebook does not verify', body: reportSummary(r) })
    } finally { setVerifying(false) }
  }, [live])
  const signedCount = nb ? nb.entries.filter((e) => e.status !== 'draft').length : 0
  useEffect(() => {
    if (!nb) return
    const t = window.setTimeout(() => { void runVerify(true) }, 400)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nb?.id, nb?.audit.length, signedCount])

  // ------------------------------------------------------------ AI tools

  const hooks: Hooks = {
    state: () => ({ notebook: live.current.nb, path: live.current.path, dirty: live.current.rev !== live.current.savedRev, selected: sel }),
    apply: (n, saved) => bk.replace(n, saved),
    readFile: (p) => fs.readText(p.startsWith('~') ? osPath.resolve(HOME, p) : p),
    writeFile: (p, t) => fs.writeText(p.startsWith('~') ? osPath.resolve(HOME, p) : p, t, { mkdirs: true }),
    user: () => userRef.current,
    examples: () => exampleFiles.map((f) => ({ title: f.title, file: f.file, path: f.path, group: f.group, description: f.description })),
    openExample: async (p) => { await openPathChecked(p) },
  }
  useAppTools(win, kelnTools(hooks))

  // ------------------------------------------------------------ menus

  const entryActions: EntryActions = {
    onPatch: (patch) => sel && patchEntry(sel, patch),
    onContent: (d: PMNode) => sel && patchEntry(sel, { content: d }),
    onProject: (projectId) => sel && commit((n, ctx) => recordEdit(updateEntry(n, sel, { projectId, experiment: nextExperiment(n, projectId, Number((getEntry(n, sel)?.date ?? '').slice(0, 4)) || new Date().getFullYear()) }, ctx), sel, ctx, { force: true })),
    onSign: () => void sign(),
    onWitness: () => void witness(),
    onAmend: () => sel && setDlg({ kind: 'amend', entryId: sel }),
    onDuplicate: () => duplicate(),
    onDelete: () => void removeDraft(),
    registerFlush: (fn) => { flushRef.current = fn },
  }

  useEffect(() => {
    const has = !!nb
    const hasEntry = !!entry
    const draft = entry?.status === 'draft'
    const exampleGroups = groupExamples(exampleFiles)
    const exampleItems: MenuItem[] = exampleGroups.length > 1 || exampleGroups[0]?.group
      ? exampleGroups.map((g) => ({ label: g.group || 'Other', submenu: g.files.map((f) => ({ label: f.title, onClick: () => void openPathChecked(f.path) })) }))
      : exampleFiles.map((f) => ({ label: f.title, onClick: () => void openPathChecked(f.path) }))
    const recentItems: MenuItem[] = recent.slice(0, 10).map((p) => ({ label: osPath.basename(p).replace(/\.keln$/, ''), onClick: () => void openPathChecked(p) }))
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New notebook…', shortcut: '⇧⌘N', icon: FilePlus, onClick: () => setDlg({ kind: 'newNotebook' }) },
          { label: 'Open notebook…', shortcut: '⌘O', icon: FolderOpen, onClick: () => void openDialog() },
          { label: 'Open recent', disabled: recentItems.length === 0, submenu: recentItems },
          '-',
          { label: 'Open example', disabled: exampleItems.length === 0, submenu: exampleItems },
          { label: 'Open examples folder', onClick: () => void refreshExamples().then(() => os.open('files', { path: exampleFolderPath(KELN_EXAMPLES_FOLDER) })) },
          '-',
          { label: 'Save', shortcut: '⌘S', icon: Save, disabled: !has, onClick: () => void save() },
          { label: 'Back up now', disabled: !has, onClick: () => nb && void bk.backupNow(nb, true).then(() => os.notify({ title: 'Backup written', body: osPath.pretty(BACKUP_DIR) })) },
          '-',
          { label: 'Export entry', disabled: !hasEntry, submenu: [
            { label: 'PDF…', shortcut: '⌘P', onClick: () => void exportEntry('pdf', false) }, { label: 'HTML…', onClick: () => void exportEntry('html', false) },
            { label: 'Markdown…', onClick: () => void exportEntry('md', false) }, { label: 'JSON…', onClick: () => void exportEntry('json', false) },
          ] },
          { label: 'Export notebook', disabled: !has, submenu: [
            { label: 'PDF…', onClick: () => void exportEntry('pdf', true) }, { label: 'HTML…', onClick: () => void exportEntry('html', true) },
            { label: 'Markdown…', onClick: () => void exportEntry('md', true) }, { label: 'JSON…', onClick: () => void exportEntry('json', true) },
          ] },
          { label: 'Import Markdown or kNote…', disabled: !has, onClick: () => void importText() },
          '-',
          { label: 'Close notebook', disabled: !has, onClick: () => void bk.confirmLeave().then((ok) => { if (ok) { bk.closeBook(); setSel(null) } }) },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Find…', shortcut: '⌘F', icon: SearchIcon, disabled: !has, onClick: () => { setView('search'); setSearchTick((t) => t + 1) } },
          { label: entry?.favourite ? 'Remove from favourites' : 'Add to favourites', disabled: !hasEntry, onClick: () => sel && patchEntry(sel, { favourite: !entry?.favourite }) },
          '-',
          { label: 'Notebook settings…', disabled: !has, onClick: () => setDlg({ kind: 'settings' }) },
        ],
      },
      {
        label: 'Entry',
        items: [
          { label: 'New entry…', shortcut: '⌘N', icon: FilePlus, disabled: !has, onClick: () => askNewEntry() },
          { label: 'Duplicate as new draft', disabled: !hasEntry, onClick: () => duplicate() },
          '-',
          { label: 'Insert block…', disabled: !draft || view !== 'entry', onClick: () => document.querySelector<HTMLButtonElement>('.ln-toolbar button[data-menu-owner="ln-block"]')?.click() },
          { label: 'Attach file…', disabled: !draft, onClick: () => void pickFile('any') },
          '-',
          { label: 'Sign…', disabled: !draft, onClick: () => void sign() },
          { label: 'Witness…', disabled: entry?.status !== 'signed', onClick: () => void witness() },
          { label: 'Add addendum…', disabled: !entry || entry.status === 'draft', onClick: () => sel && setDlg({ kind: 'amend', entryId: sel }) },
          '-',
          { label: 'Delete draft…', danger: true, disabled: !draft, onClick: () => void removeDraft() },
        ],
      },
      {
        label: 'Notebook',
        items: [
          { label: 'Verify notebook', icon: ShieldCheck, disabled: !has, onClick: () => { setView('audit'); setAuditEntry(null); void runVerify(false) } },
          { label: 'Audit log', icon: History, disabled: !has, onClick: () => { setAuditEntry(null); setView('audit') } },
          '-',
          { label: 'New project…', disabled: !has, onClick: () => setDlg({ kind: 'project' }) },
          { label: 'New sample', disabled: !has, onClick: () => { setView('samples'); addSampleNow({ name: 'New sample' }) } },
          { label: 'Print sample labels…', disabled: !nb?.samples.length, onClick: () => nb && setDlg({ kind: 'labels', ids: nb.samples.map((s) => s.id) }) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Entries', icon: FileText, checked: view === 'entry', disabled: !has, onClick: () => setView('entry') },
          { label: 'Calendar and timeline', icon: CalendarDays, checked: view === 'calendar', disabled: !has, onClick: () => setView('calendar') },
          { label: 'Samples', icon: FlaskConical, checked: view === 'samples', disabled: !has, onClick: () => setView('samples') },
          { label: 'Inventory', icon: Beaker, checked: view === 'inventory', disabled: !has, onClick: () => setView('inventory') },
          { label: 'Search', icon: SearchIcon, checked: view === 'search', disabled: !has, onClick: () => setView('search') },
          { label: 'Audit log', icon: History, checked: view === 'audit', disabled: !has, onClick: () => setView('audit') },
          '-',
          { label: 'Notebook tree', icon: PanelLeft, checked: prefs.sidebar, onClick: () => setPrefs({ sidebar: !prefs.sidebar }) },
          { label: 'Inspector', icon: PanelRight, checked: prefs.inspector, onClick: () => setPrefs({ inspector: !prefs.inspector }) },
        ],
      },
      {
        label: 'Help',
        items: [
          { label: 'How to use kELN', icon: BookOpen, onClick: () => void os.dialog.alert(HELP, { title: 'kELN' }) },
          { label: 'Keyboard shortcuts', onClick: () => void os.dialog.alert(SHORTCUTS, { title: 'kELN shortcuts' }) },
          { label: 'About the audit trail', onClick: () => void os.dialog.alert('Every change to a record appends a line to the notebook’s audit log: who, when, what, and the SHA-256 of the entry. Each line contains the hash of the line before it, so removing or editing one breaks the chain. Verify notebook recomputes everything and tells you exactly which record does not match.\n\nIt is tamper-evident, not tamper-proof, and it is not a certified 21 CFR Part 11 system: someone who rewrites the whole file and every hash cannot be told apart from the original. Keep backups, use Git history, and print signed PDFs for what must be regulated.', { title: 'Audit trail' }) },
        ],
      },
    ]
    win.setMenus(menus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nb, entry, sel, view, prefs, exampleFiles, recent, report])

  // ------------------------------------------------------------ samples and projects

  function addSampleNow(init: Partial<Sample> & { name: string }) {
    const box: { s: Sample | null } = { s: null }
    commit((n, ctx) => { const r = addSample(n, { projectId: sel ? getEntry(n, sel)?.projectId : undefined, ...init }, ctx); box.s = r.sample; return r.nb })
    if (box.s) setSelSample(box.s.id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 's') { e.preventDefault(); void save() }
    else if (k === 'o') { e.preventDefault(); void openDialog() }
    else if (k === 'n') { e.preventDefault(); if (e.shiftKey) setDlg({ kind: 'newNotebook' }); else askNewEntry() }
    else if (k === 'f' && nb) { e.preventDefault(); setView('search'); setSearchTick((t) => t + 1) }
    else if (k === 'p' && entry) { e.preventDefault(); void exportEntry('pdf', false) }
  }

  // ------------------------------------------------------------ render

  const status = !nb ? '' : dirty ? 'Unsaved changes' : 'Saved'
  const modal = dlg && nb ? (() => {
    switch (dlg.kind) {
      case 'newEntry': return <NewEntryDialog nb={nb} initial={dlg.initial} onCreate={newEntry} onClose={() => setDlg(null)} />
      case 'settings': return <SettingsDialog nb={nb} author={prefs.author} backup={prefs.backup} onClose={() => setDlg(null)} onSave={(v) => {
        commit((n) => ({ ...n, title: v.title.trim(), description: v.description, owner: v.owner.trim(), settings: { samplePrefix: v.samplePrefix, sampleDigits: v.sampleDigits } }))
        setPrefs({ author: v.author, backup: v.backup })
        setDlg(null)
      }} />
      case 'project': return <ProjectDialog onClose={() => setDlg(null)} onCreate={(code, name) => { if (commit((n, ctx) => addProject(n, { code, name }, ctx))) setDlg(null) }} />
      case 'amend': return <AmendDialog entryLabel={`${getEntry(nb, dlg.entryId)?.experiment ?? 'This entry'}`} onClose={() => setDlg(null)} onSave={(reason, md) => { if (commit((n, ctx) => amendEntry(n, dlg.entryId, markdownToDoc(md), reason, ctx))) setDlg(null) }} />
      case 'link': return <LinkDialog nb={nb} currentId={sel ?? ''} onClose={() => setDlg(null)} onAdd={(l) => { if (sel) patchEntry(sel, { links: [...(entry?.links ?? []), l] }); setDlg(null) }} />
      case 'labels': return <LabelDialog count={dlg.ids.length} onClose={() => setDlg(null)} onPrint={(o) => { setDlg(null); void printLabels(dlg.ids, o, false) }} onPdf={(o) => { setDlg(null); void printLabels(dlg.ids, o, true) }} />
      default: return null
    }
  })() : null
  const mathModal = dlg?.kind === 'math' ? <MathDialog initial={dlg.initial} display={dlg.display} onClose={() => { dlg.resolve(null); setDlg(null) }} onDone={(v) => { dlg.resolve(v); setDlg(null) }} /> : null
  const newNotebookModal = dlg?.kind === 'newNotebook' ? <NewNotebookDialog owner={userName} onCreate={(v) => void createNew(v)} onClose={() => setDlg(null)} /> : null

  const tab = (id: View, label: string, Icon: typeof FileText) => (
    <button className={`ln-tab${view === id ? ' on' : ''}`} onClick={() => setView(id)} aria-pressed={view === id} title={label}><Icon size={14} /><span className="ln-tab-label">{label}</span></button>
  )

  return (
    <div className={`k-app ln-app${compact ? ' compact' : ''}`} ref={root} onKeyDown={onKeyDown} tabIndex={-1}>
      {!nb ? (
        <Home recent={recent} examples={exampleFiles} onNew={() => setDlg({ kind: 'newNotebook' })} onOpen={() => void openDialog()} onOpenPath={(p) => void openPathChecked(p)} onExamplesFolder={() => void refreshExamples().then(() => os.open('files', { path: exampleFolderPath(KELN_EXAMPLES_FOLDER) }))} />
      ) : (
        <>
          <div className="k-toolbar ln-topbar">
            <button className="k-icon-btn" aria-label="Toggle the notebook tree" aria-pressed={prefs.sidebar} title="Notebook tree" onClick={() => setPrefs({ sidebar: !prefs.sidebar })}><PanelLeft size={16} /></button>
            <button className="k-btn small" onClick={() => askNewEntry()} title="New entry (⌘N)"><FilePlus size={13} /> Entry</button>
            <span className="k-sep" />
            <div className="ln-tabs" role="group" aria-label="Views">
              {tab('entry', 'Entries', FileText)}{tab('calendar', 'Calendar', CalendarDays)}{tab('samples', 'Samples', FlaskConical)}{tab('inventory', 'Inventory', Beaker)}{tab('audit', 'Audit', History)}
            </div>
            <span className="k-spacer" />
            <div className="ln-quicksearch">
              <SearchIcon size={13} />
              <input className="k-input" value={query} placeholder="Search…" aria-label="Search entries" onChange={(e) => { setQuery(e.target.value); if (view !== 'search') setView('search') }} onFocus={() => view !== 'search' && query && setView('search')} />
            </div>
            <button className="k-icon-btn" aria-label="Save" title="Save (⌘S)" disabled={!dirty} onClick={() => void save()}><Save size={15} /></button>
            <button className="k-icon-btn" aria-label="Toggle the inspector" aria-pressed={prefs.inspector} title="Inspector" onClick={() => setPrefs({ inspector: !prefs.inspector })}><PanelRight size={16} /></button>
          </div>
          <div className="ln-body">
            {prefs.sidebar && (
              <Sidebar nb={nb} selected={sel} onSelect={(id) => { setSel(id); setView('entry'); if (compact) setPrefs({ sidebar: false }) }} onNewEntry={askNewEntry} onNewProject={() => setDlg({ kind: 'project' })}
                onSearch={(q) => { setQuery(q); setView('search') }} onSavedSearch={(s) => { setQuery(s.query); setFilters(s.filters); setView('search') }}
                onDeleteSavedSearch={(id) => commit((n) => removeSavedSearch(n, id))}
                onEntryMenu={(ev, e) => os.contextMenu(ev, [
                  { label: 'Open', onClick: () => { setSel(e.id); setView('entry') } },
                  { label: e.favourite ? 'Remove from favourites' : 'Add to favourites', onClick: () => patchEntry(e.id, { favourite: !e.favourite }) },
                  { label: 'Duplicate as new draft', onClick: () => duplicate(e.id) },
                  '-',
                  { label: 'Delete draft…', danger: true, disabled: e.status !== 'draft', onClick: () => void removeDraft(e.id) },
                ])} />
            )}
            <main className="ln-main">
              {view === 'entry' && (entry && blockEnv ? (
                <div className="ln-entry-wrap">
                  <EntryView key={entry.id} nb={nb} entry={entry} blockEnv={blockEnv} editorEnv={editorEnv} {...entryActions} onWords={setWords}
                    onLinkClick={(href, mod) => {
                      if (href.startsWith('keln-att:')) { const a = entry.attachments.find((x) => x.id === href.slice(9)); if (a) void openAttachment(a) } else if (/^https?:|^mailto:/.test(href) && (mod || entry.status !== 'draft')) os.openUrl(href)
                    }} />
                </div>
              ) : (
                <div className="ln-empty big ln-welcome">
                  <h3>{nb.entries.length ? 'Choose an entry' : 'This notebook has no entries yet'}</h3>
                  <p className="k-muted">{nb.entries.length ? 'Pick one in the tree on the left, or start a new one.' : 'Start with a template: organic synthesis, titration, XPS session, calibration log, PCR set-up…'}</p>
                  <button className="k-btn primary" onClick={() => askNewEntry()}><FilePlus size={14} /> New entry</button>
                </div>
              ))}
              {view === 'calendar' && <CalendarView nb={nb} onOpenEntry={(id) => { setSel(id); setView('entry') }} onNewEntry={(d) => askNewEntry(undefined, undefined, d)} />}
              {view === 'samples' && (
                <SamplesView nb={nb} selected={selSample} onSelect={setSelSample} onAdd={addSampleNow}
                  onUpdate={(id, patch) => commit((n) => updateSample(n, id, patch))}
                  onRemove={(id) => { void os.dialog.confirm(`Delete sample ${id}? Samples used in entries cannot be deleted; mark them discarded instead.`, { title: 'Delete sample', okLabel: 'Delete', danger: true }).then((ok) => { if (ok && commit((n) => removeSample(n, id))) setSelSample(null) }) }}
                  onPrint={(ids) => setDlg({ kind: 'labels', ids })} onOpenEntry={(id) => { setSel(id); setView('entry') }} />
              )}
              {view === 'inventory' && (
                <InventoryView nb={nb} selected={selInv} onSelect={setSelInv} onSave={(i: InventoryItem) => commit((n) => upsertInventory(n, i))}
                  onRemove={(id) => { void os.dialog.confirm('Delete this chemical from the inventory? Reaction tables that used it keep their values.', { title: 'Delete chemical', okLabel: 'Delete', danger: true }).then((ok) => { if (ok) { commit((n) => removeInventory(n, id)); setSelInv(null) } }) }} />
              )}
              {view === 'search' && (
                <SearchView nb={nb} focusTick={searchTick} query={query} filters={filters} onQuery={setQuery} onFilters={setFilters} onOpen={(id) => { setSel(id); setView('entry') }}
                  onSave={() => { void os.dialog.prompt('Name for this search:', { title: 'Save search', defaultValue: query || 'My search' }).then((name) => { if (name && name.trim()) commit((n, ctx) => saveSearch(n, { id: ctx.id('srch'), name: name.trim(), query, filters } as SavedSearch)) }) }} />
              )}
              {view === 'audit' && <AuditView nb={nb} report={report} verifying={verifying} onVerify={() => void runVerify(false)} onOpenEntry={(id) => { setSel(id); setView('entry') }} focusEntry={auditEntry} />}
            </main>
            {prefs.inspector && view === 'entry' && entry && (
              <Inspector nb={nb} entry={entry} readOnly={entry.status !== 'draft'} attUrl={(id) => urls.current.get(id) ?? null}
                onOpenSample={(id) => { setSelSample(id); setView('samples') }}
                onLinkSample={(id) => patchEntry(entry.id, { samples: [...entry.samples, id] })} onUnlinkSample={(id) => patchEntry(entry.id, { samples: entry.samples.filter((x) => x !== id) })}
                onOpenAttachment={(a) => void openAttachment(a)}
                onRemoveAttachment={(id) => patchEntry(entry.id, { attachments: entry.attachments.filter((a) => a.id !== id) })}
                onAttach={() => void pickFile('any')} onAddLink={() => setDlg({ kind: 'link' })} onRemoveLink={(i) => patchEntry(entry.id, { links: entry.links.filter((_, k) => k !== i) })}
                onOpenLink={(l: EntryLink) => { if (l.kind === 'entry') { if (getEntry(nb, l.target)) setSel(l.target) } else if (l.kind === 'url') os.openUrl(l.target); else void openLinkedPath(l.target) }}
                onOpenAudit={() => { setAuditEntry(entry.id); setView('audit') }} onOpenEntry={(id) => setSel(id)}
                onDropFiles={(paths, files) => { void (async () => { for (const p of paths) await attachPath(p); for (const f of files) await attachFileObject(f) })() }} />
            )}
          </div>
          <div className="k-statusbar ln-status">
            <span title={book.path ?? ''}>{book.path ? osPath.pretty(book.path) : 'not saved'}</span>
            <span>{nb.entries.length} entries</span>
            {view === 'entry' && entry && <span>{words} words</span>}
            <span className="k-spacer" style={{ flex: 1 }} />
            <button className={`ln-verify ${report ? (report.ok ? 'ok' : 'bad') : ''}`} onClick={() => { setView('audit'); setAuditEntry(null); void runVerify(false) }} title={report ? reportSummary(report) : 'Verify the audit chain'}>
              {report && !report.ok ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />} {verifying ? 'verifying…' : report ? (report.ok ? 'chain verified' : `${report.issues.length} problem${report.issues.length === 1 ? '' : 's'}`) : 'verify'}
            </button>
            <span className={dirty ? 'ln-unsaved' : ''}>{status}</span>
          </div>
        </>
      )}
      {modal}
      {mathModal}
      {newNotebookModal}
      {!nb && dlg?.kind === 'project' && <Modal title="Open a notebook first" onClose={() => setDlg(null)}><p>Create or open a notebook to add projects.</p></Modal>}
    </div>
  )
}

