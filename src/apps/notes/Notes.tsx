// Notes: everyday notes, like Apple Notes or Google Keep — folders | the notes
// of a folder | the note. Notes are Markdown files in ~/Notes (format.ts),
// saved as you type; the first line is the title. (KherveNote, the lecture
// notes app, is a different app.)

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import {
  Bold, CheckSquare, ChevronDown, Code, Copy, Download, FileDown, FilePlus, FileText, Folder, FolderInput, FolderOpen, FolderPlus, Hash,
  Inbox, Italic, Link2, List, ListChecks, ListOrdered, Moon, Paperclip, Pencil, Pin, PinOff, Printer, Quote, Redo2, RotateCcw, Search,
  Share, SortDesc, SquarePen, Strikethrough, Sun, Table2, Trash2, Underline, Undo2, X,
} from 'lucide-react'
import { os, fs, path, type AppProps, type MenuItem } from '@/os'
import { useSettings } from '@/os/settings'
import { useAppTools } from '@/os/ai/appTools'
import { useAuth } from '@/os/server'
import { library, notesSync, startLibraryService, NOTES_ROOT } from './store'
import { TRASH, type Note, type NoteSort, type NotesView } from './library'
import { daysLeft, shortDate } from './format'
import { docToMarkdown, markdownToDoc, isImagePath, isLocalHref, type JNode } from './markdown'
import { notesExtensions, type NotesEditorEnv } from './editor'
import { copyText, downloadMarkdown, exportMarkdown, exportPlainText, plainTextOf, printNote } from './export'
import { notesAiTools } from './aiTools'
import { useNotesSync } from './sync'
import './notes.css'

const APP_ID = 'notes'
const UI_KEY = 'kherveos.notes.ui'
const NOTE_DRAG = 'application/x-kherveos-note'
const SAVE_DELAY = 500

interface UiPrefs {
  view: NotesView
  sort: NoteSort
  selected: string | null
}

function loadPrefs(): UiPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(UI_KEY) ?? 'null') as Partial<UiPrefs> | null
    if (v && v.view && typeof v.view === 'object' && 'kind' in v.view) {
      return { view: v.view as NotesView, sort: v.sort === 'created' || v.sort === 'title' ? v.sort : 'modified', selected: typeof v.selected === 'string' ? v.selected : null }
    }
  } catch {
    /* fresh start */
  }
  return { view: { kind: 'folder', folder: '' }, sort: 'modified', selected: null }
}

function savePrefs(p: UiPrefs) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(p))
  } catch {
    /* private window */
  }
}

const folderLabel = (f: string) => (f === '' ? 'Notes' : f === TRASH ? 'Recently Deleted' : f.slice(f.lastIndexOf('/') + 1))
const folderPath = (f: string) => (f === '' ? 'Notes' : f === TRASH ? 'Recently Deleted' : f.replace(/\//g, ' › '))

function longDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

export default function Notes({ win, args }: AppProps) {
  useEffect(() => startLibraryService(), [])
  const version = useSyncExternalStore(library.subscribe, library.getVersion)
  const loaded = library.loaded
  const sync = useNotesSync()
  const signedIn = useAuth((s) => !!s.user)
  const light = useSettings((s) => s.lightApps.includes(APP_ID))

  const initial = useMemo(loadPrefs, [])
  const [view, setView] = useState<NotesView>(initial.view)
  const [sort, setSort] = useState<NoteSort>(initial.sort)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(initial.selected)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropFolder, setDropFolder] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // The view must still exist (a folder renamed or deleted elsewhere).
  useEffect(() => {
    if (!loaded) return
    if (view.kind === 'folder' && view.folder && !library.folders().includes(view.folder)) setView({ kind: 'folder', folder: '' })
    if (view.kind === 'tag' && !library.tags().some(([t]) => t === view.tag)) setView({ kind: 'all' })
  }, [loaded, version, view])

  const notes = useMemo(() => (loaded ? library.list(view, sort, query) : []), [loaded, version, view, sort, query]) // eslint-disable-line react-hooks/exhaustive-deps
  const selected = selectedId ? library.get(selectedId) ?? null : null
  const selRef = useRef(selectedId)
  selRef.current = selectedId
  const inTrash = !!selected?.deleted

  useEffect(() => savePrefs({ view, sort, selected: selectedId }), [view, sort, selectedId])

  // ------------------------------------------------------------ the editor

  /** The open note's id, its last saved Markdown, and whether typing is waiting to be saved. */
  const open = useRef<{ id: string | null; path: string | null; body: string; pending: boolean; timer: number | null }>({ id: null, path: null, body: '', pending: false, timer: null })
  const urls = useRef(new Map<string, string>())
  const edRef = useRef<Editor | null>(null)

  const env = useMemo<NotesEditorEnv>(
    () => ({
      fileUrl: async (src) => {
        const id = open.current.id
        const note = id ? library.get(id) : undefined
        if (!note) return null
        const abs = library.resolve(note, src)
        const hit = urls.current.get(abs)
        if (hit) return hit
        if (!fs.exists(abs)) return null
        const data = await fs.readBytes(abs)
        const ext = path.extname(abs)
        const type = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`
        const url = URL.createObjectURL(new Blob([data as BlobPart], { type }))
        urls.current.set(abs, url)
        return url
      },
      openAttachment: (src) => {
        const note = open.current.id ? library.get(open.current.id) : undefined
        if (note && isLocalHref(src)) void os.openFile(library.resolve(note, src))
      },
      openLink: (href) => {
        const note = open.current.id ? library.get(open.current.id) : undefined
        if (isLocalHref(href) && note) void os.openFile(library.resolve(note, decodeSafe(href)))
        else os.openUrl(href)
      },
      dropPaths: (paths, pos) => void h.current.attachPaths(paths, pos),
      dropFiles: (files, pos) => void h.current.attachFiles(files, pos),
    }),
    [],
  )
  const extensions = useMemo(() => notesExtensions(env), [env])
  const editor = useEditor({
    extensions,
    content: '',
    editable: false,
    editorProps: { attributes: { class: 'nt-prose', spellcheck: 'true' } },
    onUpdate: () => h.current.changed(),
  })
  edRef.current = editor

  const fmt = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            underline: e.isActive('underline'),
            strike: e.isActive('strike'),
            code: e.isActive('code'),
            bullet: e.isActive('bulletList'),
            ordered: e.isActive('orderedList'),
            task: e.isActive('taskList'),
            quote: e.isActive('blockquote'),
            link: e.isActive('link'),
            table: e.isActive('table'),
            style: e.isActive('heading', { level: 1 }) ? 'Title' : e.isActive('heading', { level: 2 }) ? 'Heading' : e.isActive('heading', { level: 3 }) ? 'Subheading' : e.isActive('codeBlock') ? 'Code' : 'Body',
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  })

  function forgetUrls() {
    for (const u of urls.current.values()) URL.revokeObjectURL(u)
    urls.current.clear()
  }

  /** Write what is typed in the open note now. */
  const flush = useCallback(async () => {
    const o = open.current
    if (o.timer) {
      clearTimeout(o.timer)
      o.timer = null
    }
    const ed = edRef.current
    if (!o.pending || !o.id || !ed || ed.isDestroyed) return
    o.pending = false
    const md = docToMarkdown(ed.getJSON() as JNode)
    if (md === o.body) return
    o.body = md
    try {
      const saved = await library.save(o.id, md)
      // The file follows the title; a file from another app gets an id of its own on its first save.
      if (open.current === o) {
        o.path = saved.path
        if (saved.id !== o.id) {
          o.id = saved.id
          setSelectedId(saved.id)
        }
      }
    } catch (e) {
      os.notify({ title: 'Notes could not save', body: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  /** Show a note in the editor (after saving the one that was open). */
  const load = useCallback((note: Note | null) => {
    const ed = edRef.current
    if (!ed) return
    forgetUrls()
    open.current = { id: note?.id ?? null, path: note?.path ?? null, body: note?.body ?? '', pending: false, timer: null }
    ed.commands.setContent(note ? (markdownToDoc(note.body) as never) : '', { emitUpdate: false })
    ed.setEditable(!!note && !note.deleted)
  }, [])

  // Handlers that read the latest state (registered once by the editor).
  const h = useRef({
    changed() {},
    async attachPaths(_paths: string[], _pos: number) {},
    async attachFiles(_files: File[], _pos: number | null) {},
  })
  h.current.changed = () => {
    const o = open.current
    if (!o.id) return
    o.pending = true
    if (o.timer) clearTimeout(o.timer)
    o.timer = window.setTimeout(() => void flush(), SAVE_DELAY)
  }
  h.current.attachPaths = async (paths, pos) => {
    const id = await ensureNote()
    if (!id) return
    for (const p of paths) {
      if (!fs.isFile(p)) continue
      await insertAttachment(id, path.basename(p), await fs.readBytes(p), pos)
    }
  }
  h.current.attachFiles = async (files, pos) => {
    const id = await ensureNote()
    if (!id) return
    for (const f of files) await insertAttachment(id, f.name || 'pasted.png', new Uint8Array(await f.arrayBuffer()), pos)
  }

  async function insertAttachment(id: string, name: string, data: Uint8Array, pos: number | null) {
    const ed = edRef.current
    if (!ed || open.current.id !== id) return
    try {
      const rel = await library.addAttachment(id, name, data)
      const node = isImagePath(rel) ? { type: 'image', attrs: { src: rel, alt: name.replace(/\.[^.]+$/, '') } } : { type: 'attachment', attrs: { src: rel, name } }
      const at = pos ?? ed.state.selection.to
      ed.chain().focus().insertContentAt(Math.min(at, ed.state.doc.content.size), node).run()
    } catch (e) {
      await os.dialog.alert(`Could not attach ${name}: ${e instanceof Error ? e.message : e}`)
    }
  }

  /** The note to attach to: the open one, or a new one. */
  async function ensureNote(): Promise<string | null> {
    if (open.current.id && !inTrashNow()) return open.current.id
    if (inTrashNow()) {
      await os.dialog.alert('Restore the note from Recently Deleted to change it.')
      return null
    }
    const n = await newNote()
    if (!n) return null
    // Wait until the editor shows it.
    for (let i = 0; i < 50 && open.current.id !== n.id; i++) await new Promise((r) => setTimeout(r, 20))
    return open.current.id === n.id ? n.id : null
  }
  const inTrashNow = () => !!(open.current.id && library.get(open.current.id)?.deleted)

  // Open the selected note; a note left empty goes away.
  useEffect(() => {
    if (!editor || !loaded) return
    const prev = open.current.id
    if (prev === selectedId) return
    void (async () => {
      await flush()
      if (prev && prev !== selectedId) await library.discardIfEmpty(prev)
      load(selectedId ? library.get(selectedId) ?? null : null)
    })()
  }, [editor, loaded, selectedId, flush, load])

  // Someone else changed the open note (another app, a sync, an AI tool): show their version.
  useEffect(() => {
    const o = open.current
    if (!o.id || o.pending) return
    const n = library.get(o.id)
    if (!n) {
      // Only while it is still the selected note (not one being switched away from).
      if (selRef.current !== o.id) return
      // Gone, or saved under a new id (an imported file's first save).
      const same = o.path ? library.byPath(o.path) : undefined
      if (same) {
        o.id = same.id
        setSelectedId(same.id)
      } else setSelectedId(null)
      return
    }
    o.path = n.path
    if (n.body !== o.body) {
      const ed = edRef.current
      const sel = ed?.state.selection
      load(n)
      if (ed && sel && sel.to <= ed.state.doc.content.size) ed.commands.setTextSelection({ from: sel.from, to: sel.to })
    }
    if (edRef.current && edRef.current.isEditable === !!n.deleted) edRef.current.setEditable(!n.deleted)
  }, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a selection in the list.
  useEffect(() => {
    if (!loaded) return
    if (selectedId && notes.some((n) => n.id === selectedId)) return
    if (selectedId && library.get(selectedId) && query) return
    setSelectedId(notes[0]?.id ?? null)
  }, [loaded, notes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save before the window closes.
  useEffect(() => {
    win.setCloseGuard(async () => {
      await flush()
      if (open.current.id) await library.discardIfEmpty(open.current.id)
      return true
    })
    return () => win.setCloseGuard(null)
  }, [win, flush])
  useEffect(() => () => {
    try {
      void flush()
    } catch {
      /* the editor is already gone; the close guard saved */
    }
    forgetUrls()
  }, [flush])

  useEffect(() => {
    win.setTitle(selected ? `${selected.title || 'New Note'} — Notes` : 'Notes')
  }, [win, selected?.title, selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // Quick Note (the Ꝃ menu): a new note in Notes.
  const quickDone = useRef<unknown>(null)
  useEffect(() => {
    if (!loaded || !editor || !args.quickNote || quickDone.current === args.quickNote) return
    quickDone.current = args.quickNote
    void newNote('', '')
  }, [loaded, editor, args.quickNote]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ actions

  const currentFolder = (): string => (view.kind === 'folder' ? view.folder : '')

  async function newNote(body = '', inFolder?: string): Promise<Note | null> {
    await flush()
    const folder = inFolder ?? currentFolder()
    if (view.kind !== 'folder' || view.folder !== folder) setView({ kind: 'folder', folder })
    setQuery('')
    try {
      const n = await library.create(folder, body)
      setSelectedId(n.id)
      setTimeout(() => edRef.current?.commands.focus('end'), 30)
      return n
    } catch (e) {
      await os.dialog.alert(e instanceof Error ? e.message : String(e))
      return null
    }
  }

  async function newFolder(parent = view.kind === 'folder' ? view.folder : '') {
    const name = await os.dialog.prompt(parent ? `A new folder in "${folderPath(parent)}":` : 'Name of the new folder:', { title: 'New Folder', defaultValue: 'New Folder', okLabel: 'Create', selectStem: true })
    if (!name) return
    try {
      const rel = await library.createFolder(parent, name)
      setView({ kind: 'folder', folder: rel })
    } catch (e) {
      await os.dialog.alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function renameFolder(folder: string, name: string) {
    setRenaming(null)
    if (!name.trim() || name.trim() === folderLabel(folder)) return
    await flush()
    try {
      const rel = await library.renameFolder(folder, name)
      setView({ kind: 'folder', folder: rel })
    } catch (e) {
      await os.dialog.alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function deleteFolder(folder: string) {
    const c = library.folderContents(folder)
    const parts = [
      c.notes ? `${c.notes} note${c.notes === 1 ? '' : 's'} will move to Recently Deleted` : 'It has no notes',
      c.folders ? `${c.folders} subfolder${c.folders === 1 ? '' : 's'} will be deleted` : '',
      c.otherFiles ? `${c.otherFiles} other file${c.otherFiles === 1 ? '' : 's'} in it will be deleted for good` : '',
    ].filter(Boolean)
    const ok = await os.dialog.confirm(`${parts.join('; ')}.`, { title: `Delete the folder "${folderLabel(folder)}"?`, okLabel: 'Delete Folder', danger: true })
    if (!ok) return
    await flush()
    try {
      await library.deleteFolder(folder)
      if (view.kind === 'folder' && (view.folder === folder || view.folder.startsWith(`${folder}/`))) setView({ kind: 'folder', folder: '' })
    } catch (e) {
      await os.dialog.alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function act<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      await flush()
      return await fn()
    } catch (e) {
      await os.dialog.alert(e instanceof Error ? e.message : String(e))
      return undefined
    }
  }

  /** The note after `id` in the list (to select once it is gone). */
  const neighbour = (id: string) => {
    const i = notes.findIndex((n) => n.id === id)
    return notes[i + 1]?.id ?? notes[i - 1]?.id ?? null
  }

  async function trashNote(note: Note) {
    if (note.deleted) {
      const ok = await os.dialog.confirm(`"${note.title || 'New Note'}" will be deleted for good, with its attachments.`, { title: 'Delete Immediately?', okLabel: 'Delete', danger: true })
      if (!ok) return
      const next = neighbour(note.id)
      await act(() => library.destroy(note.id))
      if (!library.get(note.id)) setSelectedId(next)
      return
    }
    const next = neighbour(note.id)
    if (note.id === open.current.id && !note.body.trim() && !(edRef.current?.getText().trim())) {
      open.current.pending = false
      await library.discardIfEmpty(note.id)
      setSelectedId(next)
      return
    }
    const done = await act(() => library.trash(note.id))
    if (done) {
      setSelectedId(next)
      os.notify({ title: 'Moved to Recently Deleted', body: `"${note.title || 'New Note'}" is kept there for 30 days.` })
    }
  }

  async function restoreNote(note: Note) {
    const n = await act(() => library.restore(note.id))
    if (n) os.notify({ title: `Restored to ${folderPath(n.folder)}`, body: n.title })
  }

  async function emptyTrash() {
    const count = library.counts().get(TRASH) ?? 0
    if (!count) return
    const ok = await os.dialog.confirm(`${count} note${count === 1 ? '' : 's'} will be deleted for good, with their attachments.`, { title: 'Empty Recently Deleted?', okLabel: 'Delete All', danger: true })
    if (ok) await act(() => library.emptyTrash())
  }

  async function duplicate(note: Note) {
    const n = await act(() => library.duplicate(note.id))
    if (n) setSelectedId(n.id)
  }

  async function moveNote(note: Note, folder: string) {
    if (note.deleted) await act(() => library.restore(note.id, folder))
    else await act(() => library.move(note.id, folder))
  }

  async function togglePin(note: Note) {
    await act(() => library.setPinned(note.id, !note.pinned))
  }

  function setLight(on: boolean) {
    const s = useSettings.getState()
    const others = s.lightApps.filter((a) => a !== APP_ID)
    s.set({ lightApps: on ? [...others, APP_ID] : others })
  }

  // ------------------------------------------------------------ formatting

  const chain = () => edRef.current?.chain().focus()
  const canEdit = !!selected && !inTrash

  function setStyle(style: 'Title' | 'Heading' | 'Subheading' | 'Body' | 'Code') {
    const c = chain()
    if (!c) return
    if (style === 'Body') c.setParagraph().run()
    else if (style === 'Code') c.toggleCodeBlock().run()
    else c.toggleHeading({ level: style === 'Title' ? 1 : style === 'Heading' ? 2 : 3 }).run()
  }

  async function editLink() {
    const ed = edRef.current
    if (!ed) return
    const current = String(ed.getAttributes('link').href ?? '')
    const url = await os.dialog.prompt('Web address (empty to remove the link):', { title: 'Link', defaultValue: current || 'https://', okLabel: 'OK' })
    if (url === null) return
    const href = url.trim()
    if (!href || href === 'https://') {
      ed.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    if (ed.state.selection.empty && !ed.isActive('link')) {
      ed.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).insertContent(' ').run()
    } else ed.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  async function attachFromDrive() {
    if (!canEdit && selected) return
    const p = await os.dialog.openFile({ title: 'Attach a file or picture', startDir: `${path.HOME}/Pictures` })
    if (p) await h.current.attachPaths([p], edRef.current?.state.selection.to ?? 0)
  }

  const styleItems = (): MenuItem[] => [
    { label: 'Title', checked: fmt?.style === 'Title', onClick: () => setStyle('Title') },
    { label: 'Heading', checked: fmt?.style === 'Heading', onClick: () => setStyle('Heading') },
    { label: 'Subheading', checked: fmt?.style === 'Subheading', onClick: () => setStyle('Subheading') },
    { label: 'Body', checked: fmt?.style === 'Body', onClick: () => setStyle('Body') },
    { label: 'Monospaced', checked: fmt?.style === 'Code', onClick: () => setStyle('Code') },
  ]

  const tableItems = (): MenuItem[] => [
    { label: 'Insert Table', icon: Table2, disabled: !canEdit || fmt?.table, onClick: () => chain()?.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    '-',
    { label: 'Add Row Above', disabled: !fmt?.table, onClick: () => chain()?.addRowBefore().run() },
    { label: 'Add Row Below', disabled: !fmt?.table, onClick: () => chain()?.addRowAfter().run() },
    { label: 'Add Column Before', disabled: !fmt?.table, onClick: () => chain()?.addColumnBefore().run() },
    { label: 'Add Column After', disabled: !fmt?.table, onClick: () => chain()?.addColumnAfter().run() },
    '-',
    { label: 'Delete Row', disabled: !fmt?.table, onClick: () => chain()?.deleteRow().run() },
    { label: 'Delete Column', disabled: !fmt?.table, onClick: () => chain()?.deleteColumn().run() },
    { label: 'Delete Table', disabled: !fmt?.table, danger: true, onClick: () => chain()?.deleteTable().run() },
  ]

  const folderTargets = (note: Note | null): MenuItem[] =>
    ['', ...library.folders()].map((f) => ({
      label: folderPath(f),
      icon: Folder,
      disabled: !note || (!note.deleted && note.folder === f),
      onClick: () => note && void moveNote(note, f),
    }))

  const shareItems = (note: Note | null): MenuItem[] => [
    { label: 'Copy as Markdown', icon: Copy, disabled: !note, onClick: () => note && void copyText(note.body, 'the note as Markdown') },
    { label: 'Copy as Plain Text', disabled: !note, onClick: () => note && void copyText(plainTextOf(note), 'the note as plain text') },
    '-',
    { label: 'Export as Markdown…', icon: FileDown, disabled: !note, onClick: () => note && void act(() => exportMarkdown(note)) },
    { label: 'Export as Plain Text…', icon: FileText, disabled: !note, onClick: () => note && void act(() => exportPlainText(note)) },
    { label: 'Export as PDF…', icon: FileDown, disabled: !note, onClick: () => note && void print(note) },
    { label: 'Download Markdown to Computer', icon: Download, disabled: !note, onClick: () => note && downloadMarkdown(note) },
    '-',
    { label: 'Show in Files', icon: FolderOpen, disabled: !note, onClick: () => note && os.open('files', { path: path.dirname(note.path) }) },
    { label: 'Open in Notepad', icon: FileText, disabled: !note, onClick: () => note && os.open('notepad', { path: note.path }) },
  ]

  async function print(note: Note) {
    await flush()
    const html = note.id === open.current.id && edRef.current ? edRef.current.getHTML() : ''
    if (!html) {
      os.notify({ title: 'Open the note to print it' })
      return
    }
    await printNote(note, html)
    os.notify({ title: 'Print', body: 'Choose "Save as PDF" in the print dialog for a PDF.' })
  }

  const noteMenu = (note: Note): MenuItem[] =>
    note.deleted
      ? [
          { label: `Restore to ${folderPath(note.from ?? '')}`, icon: RotateCcw, onClick: () => void restoreNote(note) },
          { label: 'Move to', icon: FolderInput, submenu: folderTargets(note) },
          '-',
          { label: 'Delete Immediately…', icon: Trash2, danger: true, onClick: () => void trashNote(note) },
        ]
      : [
          { label: note.pinned ? 'Unpin Note' : 'Pin Note', icon: note.pinned ? PinOff : Pin, onClick: () => void togglePin(note) },
          { label: 'Duplicate', icon: Copy, onClick: () => void duplicate(note) },
          { label: 'Move to', icon: FolderInput, submenu: folderTargets(note) },
          { label: 'Share', icon: Share, submenu: shareItems(note) },
          { label: 'Print…', icon: Printer, disabled: note.id !== selectedId, onClick: () => void print(note) },
          '-',
          { label: 'Delete', icon: Trash2, danger: true, onClick: () => void trashNote(note) },
        ]

  const folderMenu = (folder: string): MenuItem[] => [
    { label: 'New Note', icon: SquarePen, onClick: () => { setView({ kind: 'folder', folder }); setTimeout(() => void newNote(), 0) } },
    { label: 'New Subfolder…', icon: FolderPlus, onClick: () => void newFolder(folder) },
    ...(folder
      ? ([
          '-',
          { label: 'Rename Folder', icon: Pencil, onClick: () => setRenaming(folder) },
          { label: 'Delete Folder…', icon: Trash2, danger: true, onClick: () => void deleteFolder(folder) },
        ] as MenuItem[])
      : []),
    '-',
    { label: 'Show in Files', icon: FolderOpen, onClick: () => os.open('files', { path: library.dirOf(folder) }) },
  ]

  // ------------------------------------------------------------ menus, keys, AI

  const sortItems: MenuItem[] = [
    { label: 'Date Edited', checked: sort === 'modified', onClick: () => setSort('modified') },
    { label: 'Date Created', checked: sort === 'created', onClick: () => setSort('created') },
    { label: 'Title', checked: sort === 'title', onClick: () => setSort('title') },
  ]

  useEffect(() => {
    const note = selected
    win.setMenus([
      {
        label: 'File',
        items: [
          { label: 'New Note', icon: SquarePen, shortcut: '⌘N', onClick: () => void newNote() },
          { label: 'New Folder…', icon: FolderPlus, shortcut: '⇧⌘N', onClick: () => void newFolder() },
          '-',
          { label: note?.pinned ? 'Unpin Note' : 'Pin Note', icon: Pin, disabled: !note || inTrash, onClick: () => note && void togglePin(note) },
          { label: 'Duplicate Note', icon: Copy, disabled: !note || inTrash, onClick: () => note && void duplicate(note) },
          { label: 'Move to', icon: FolderInput, disabled: !note, submenu: folderTargets(note) },
          ...(inTrash && note ? ([{ label: 'Restore Note', icon: RotateCcw, onClick: () => void restoreNote(note) }] as MenuItem[]) : []),
          '-',
          { label: 'Share', icon: Share, disabled: !note, submenu: shareItems(note) },
          { label: 'Print…', icon: Printer, shortcut: '⌘P', disabled: !note, onClick: () => note && void print(note) },
          '-',
          { label: inTrash ? 'Delete Immediately…' : 'Delete Note', icon: Trash2, shortcut: '⌫', disabled: !note, danger: true, onClick: () => note && void trashNote(note) },
          { label: 'Empty Recently Deleted…', disabled: !(library.counts().get(TRASH) ?? 0), onClick: () => void emptyTrash() },
          '-',
          { label: 'Close', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: !fmt?.canUndo, onClick: () => chain()?.undo().run() },
          { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: !fmt?.canRedo, onClick: () => chain()?.redo().run() },
          '-',
          { label: 'Search Notes', icon: Search, shortcut: '⌘F', onClick: () => searchRef.current?.focus() },
          { label: 'Attach File or Picture…', icon: Paperclip, disabled: !canEdit, onClick: () => void attachFromDrive() },
        ],
      },
      {
        label: 'Format',
        items: [
          ...styleItems().map((i) => (i === '-' ? i : { ...i, disabled: !canEdit })),
          '-',
          { label: 'Bold', icon: Bold, shortcut: '⌘B', checked: fmt?.bold, disabled: !canEdit, onClick: () => chain()?.toggleBold().run() },
          { label: 'Italic', icon: Italic, shortcut: '⌘I', checked: fmt?.italic, disabled: !canEdit, onClick: () => chain()?.toggleItalic().run() },
          { label: 'Underline', icon: Underline, shortcut: '⌘U', checked: fmt?.underline, disabled: !canEdit, onClick: () => chain()?.toggleUnderline().run() },
          { label: 'Strikethrough', icon: Strikethrough, shortcut: '⇧⌘S', checked: fmt?.strike, disabled: !canEdit, onClick: () => chain()?.toggleStrike().run() },
          { label: 'Code', icon: Code, shortcut: '⌘E', checked: fmt?.code, disabled: !canEdit, onClick: () => chain()?.toggleCode().run() },
          '-',
          { label: 'Checklist', icon: ListChecks, shortcut: '⇧⌘L', checked: fmt?.task, disabled: !canEdit, onClick: () => chain()?.toggleTaskList().run() },
          { label: 'Bulleted List', icon: List, shortcut: '⇧⌘8', checked: fmt?.bullet, disabled: !canEdit, onClick: () => chain()?.toggleBulletList().run() },
          { label: 'Numbered List', icon: ListOrdered, shortcut: '⇧⌘7', checked: fmt?.ordered, disabled: !canEdit, onClick: () => chain()?.toggleOrderedList().run() },
          { label: 'Quote', icon: Quote, shortcut: '⇧⌘B', checked: fmt?.quote, disabled: !canEdit, onClick: () => chain()?.toggleBlockquote().run() },
          { label: 'Table', icon: Table2, disabled: !canEdit, submenu: tableItems() },
          { label: 'Link…', icon: Link2, shortcut: '⌘K', checked: fmt?.link, disabled: !canEdit, onClick: () => void editLink() },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Sort Notes By', icon: SortDesc, submenu: sortItems },
          '-',
          { label: 'All Notes', checked: view.kind === 'all', onClick: () => setView({ kind: 'all' }) },
          { label: 'Recently Deleted', checked: view.kind === 'trash', onClick: () => setView({ kind: 'trash' }) },
          '-',
          { label: 'Dark', icon: Moon, checked: !light, onClick: () => setLight(false) },
          { label: 'Light', icon: Sun, checked: light, onClick: () => setLight(true) },
          ...(signedIn ? (['-', { label: 'Sync Now', onClick: () => void notesSync.syncNow() }] as MenuItem[]) : []),
        ],
      },
    ])
  })
  useEffect(() => () => win.setMenus(null), [win])

  useAppTools(
    win,
    useMemo(
      () =>
        notesAiTools({
          show: (id) => {
            const n = library.get(id)
            if (!n) return
            setQuery('')
            setView(n.deleted ? { kind: 'trash' } : { kind: 'folder', folder: n.folder })
            setSelectedId(id)
          },
          flush,
        }),
      [flush],
    ),
  )

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (mod && k === 'n') {
      e.preventDefault()
      if (e.shiftKey) void newFolder()
      else void newNote()
    } else if (mod && k === 'f' && !e.shiftKey) {
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    } else if (mod && k === 'p') {
      e.preventDefault()
      if (selected) void print(selected)
    } else if (mod && k === 'l' && e.shiftKey && canEdit && !edRef.current?.isFocused) {
      e.preventDefault()
      chain()?.toggleTaskList().run()
    } else if (mod && k === 'k' && canEdit && edRef.current?.isFocused) {
      e.preventDefault()
      void editLink()
    }
  }

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const i = notes.findIndex((n) => n.id === selectedId)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = notes[Math.max(0, Math.min(notes.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) setSelectedId(next.id)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault()
      void trashNote(selected)
    } else if (e.key === 'Enter' && selected && !selected.deleted) {
      e.preventDefault()
      edRef.current?.commands.focus('end')
    }
  }

  // ------------------------------------------------------------ drag & drop of notes onto folders

  const onNoteDragStart = (e: DragEvent, note: Note) => {
    e.dataTransfer.setData(NOTE_DRAG, note.id)
    e.dataTransfer.setData('text/plain', note.title)
    e.dataTransfer.effectAllowed = 'copyMove'
  }
  const folderDropProps = (folder: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(NOTE_DRAG)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropFolder(folder)
    },
    onDragLeave: () => setDropFolder((f) => (f === folder ? null : f)),
    onDrop: (e: DragEvent) => {
      setDropFolder(null)
      const id = e.dataTransfer.getData(NOTE_DRAG)
      const note = id ? library.get(id) : undefined
      if (!note) return
      e.preventDefault()
      if (folder === TRASH) void trashNote(note)
      else void moveNote(note, folder)
    },
  })

  // ------------------------------------------------------------ drawing

  const counts = useMemo(() => library.counts(), [version]) // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useMemo(() => library.tags(), [version]) // eslint-disable-line react-hooks/exhaustive-deps
  const folders = useMemo(() => library.folders(), [version]) // eslint-disable-line react-hooks/exhaustive-deps
  const liveCount = useMemo(() => library.all().filter((n) => !n.deleted).length, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  const viewTitle = query.trim()
    ? `Results for “${query.trim()}”`
    : view.kind === 'all'
      ? 'All Notes'
      : view.kind === 'trash'
        ? 'Recently Deleted'
        : view.kind === 'tag'
          ? `#${view.tag}`
          : folderLabel(view.folder)
  const showFolderInRow = !!query.trim() || view.kind === 'all' || view.kind === 'tag'
  const pinnedCount = view.kind === 'trash' ? 0 : notes.filter((n) => n.pinned).length

  const menuAt = (e: MouseEvent, items: MenuItem[]) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    os.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, items)
  }

  const syncLabel = !signedIn
    ? 'On this computer only'
    : sync.status === 'syncing'
      ? 'Syncing…'
      : sync.status === 'error'
        ? `Sync problem: ${sync.error ?? ''}`
        : sync.last
          ? `Synced ${new Date(sync.last).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
          : 'Sync on'

  const sideRow = (key: string, label: string, icon: ReactNode, count: number | null, active: boolean, onClick: () => void, extra: Record<string, unknown> = {}, depth = 0) => (
    <div
      key={key}
      className={`nt-side-row${active ? ' active' : ''}${dropFolder === key ? ' drop' : ''}`}
      style={{ paddingLeft: 10 + depth * 14 }}
      onClick={onClick}
      role="button"
      tabIndex={-1}
      {...extra}
    >
      {icon}
      <span className="nt-side-label">{label}</span>
      {count !== null && <span className="nt-count">{count}</span>}
    </div>
  )

  return (
    <div className="k-app nt-app" onKeyDown={onKeyDown}>
      <div className="nt-panes">
        {/* ---------------------------------------------------------- folders */}
        <aside
          className="nt-sidebar"
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('.nt-side-row, .nt-tag-chip, button')) return
            e.preventDefault()
            os.contextMenu(e, [{ label: 'New Folder…', icon: FolderPlus, onClick: () => void newFolder('') }])
          }}
        >
          <div className="nt-side-scroll">
            <div className="nt-side-head">Folders</div>
            {sideRow('*all', 'All Notes', <Inbox size={15} />, liveCount, view.kind === 'all' && !query, () => { setQuery(''); setView({ kind: 'all' }) })}
            {sideRow('', 'Notes', <Folder size={15} />, counts.get('') ?? 0, view.kind === 'folder' && view.folder === '' && !query, () => { setQuery(''); setView({ kind: 'folder', folder: '' }) }, {
              onContextMenu: (e: MouseEvent) => { e.preventDefault(); os.contextMenu(e, folderMenu('')) },
              ...folderDropProps(''),
            })}
            {folders.map((f) => {
              const depth = f.split('/').length - 1
              if (renaming === f) {
                return (
                  <div key={f} className="nt-side-row active" style={{ paddingLeft: 10 + (depth + 1) * 14 }}>
                    <Folder size={15} />
                    <input
                      className="nt-rename"
                      autoFocus
                      defaultValue={folderLabel(f)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => void renameFolder(f, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                    />
                  </div>
                )
              }
              return sideRow(f, folderLabel(f), <Folder size={15} />, counts.get(f) ?? 0, view.kind === 'folder' && view.folder === f && !query, () => { setQuery(''); setView({ kind: 'folder', folder: f }) }, {
                onContextMenu: (e: MouseEvent) => { e.preventDefault(); os.contextMenu(e, folderMenu(f)) },
                onDoubleClick: () => setRenaming(f),
                title: folderPath(f),
                ...folderDropProps(f),
              }, depth + 1)
            })}
            {sideRow(TRASH, 'Recently Deleted', <Trash2 size={15} />, counts.get(TRASH) ?? 0, view.kind === 'trash' && !query, () => { setQuery(''); setView({ kind: 'trash' }) }, {
              onContextMenu: (e: MouseEvent) => { e.preventDefault(); os.contextMenu(e, [{ label: 'Empty Recently Deleted…', icon: Trash2, danger: true, disabled: !(counts.get(TRASH) ?? 0), onClick: () => void emptyTrash() }]) },
              ...folderDropProps(TRASH),
            })}
            {tags.length > 0 && <div className="nt-side-head">Tags</div>}
            {tags.length > 0 && (
              <div className="nt-tags">
                {tags.map(([t, n]) => (
                  <button
                    key={t}
                    className={`nt-tag-chip${view.kind === 'tag' && view.tag === t && !query ? ' active' : ''}`}
                    title={`${n} note${n === 1 ? '' : 's'}`}
                    onClick={() => { setQuery(''); setView({ kind: 'tag', tag: t }) }}
                  >
                    <Hash size={11} />
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="nt-side-foot">
            <button className="k-btn small" onClick={() => void newFolder('')} title="New Folder (⇧⌘N)">
              <FolderPlus size={14} /> New Folder
            </button>
            <div className={`nt-sync${sync.status === 'error' ? ' error' : ''}`} title={signedIn ? `~/Notes is synced with your KherveOS account. ${syncLabel}` : 'Sign in to the KherveOS server (Settings) to sync notes between computers.'}>
              {syncLabel}
            </div>
          </div>
        </aside>

        {/* ---------------------------------------------------------- note list */}
        <section className="nt-list">
          <div className="nt-list-head">
            <div className="nt-search">
              <Search size={14} />
              <input
                ref={searchRef}
                placeholder="Search all notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setQuery('')
                    e.currentTarget.blur()
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    listRef.current?.focus()
                  }
                }}
              />
              {query && (
                <button className="nt-clear" onClick={() => setQuery('')} title="Clear search">
                  <X size={13} />
                </button>
              )}
            </div>
            <button className="k-icon-btn" title="Sort notes" onClick={(e) => menuAt(e, sortItems)}>
              <SortDesc size={16} />
            </button>
            <button className="k-icon-btn" title="New Note (⌘N)" disabled={view.kind === 'trash' && !query} onClick={() => void newNote()}>
              <SquarePen size={16} />
            </button>
          </div>
          <div className="nt-list-title">
            <span>{viewTitle}</span>
            <span className="k-muted">{notes.length} note{notes.length === 1 ? '' : 's'}</span>
          </div>
          {view.kind === 'trash' && !query && (
            <div className="nt-trash-note">
              Notes stay here for 30 days, then they are deleted.
              {notes.length > 0 && (
                <button className="k-link-btn" onClick={() => void emptyTrash()}>
                  Empty
                </button>
              )}
            </div>
          )}
          <div className="nt-rows" ref={listRef} tabIndex={0} onKeyDown={onListKey}>
            {!loaded && <div className="k-empty">Opening ~/Notes…</div>}
            {loaded && notes.length === 0 && (
              <div className="k-empty">{query ? 'No notes match.' : view.kind === 'trash' ? 'Nothing was deleted.' : 'No notes yet. ⌘N makes one.'}</div>
            )}
            {notes.map((n, i) => (
              <div key={n.id}>
                {pinnedCount > 0 && i === 0 && <div className="nt-group">Pinned</div>}
                {pinnedCount > 0 && i === pinnedCount && <div className="nt-group">Notes</div>}
                <div
                  className={`nt-row${n.id === selectedId ? ' active' : ''}`}
                  onClick={() => {
                    setSelectedId(n.id)
                    listRef.current?.focus()
                  }}
                  onDoubleClick={() => !n.deleted && edRef.current?.commands.focus('end')}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setSelectedId(n.id)
                    os.contextMenu(e, noteMenu(n))
                  }}
                  draggable
                  onDragStart={(e) => onNoteDragStart(e, n)}
                >
                  <div className="nt-row-title">
                    {n.pinned && !n.deleted && <Pin size={12} className="nt-pin" />}
                    <span>{n.title || 'New Note'}</span>
                  </div>
                  <div className="nt-row-sub">
                    <span className="nt-row-date">{shortDate(sort === 'created' ? n.created : n.modified)}</span>
                    <span className="nt-row-preview">{n.preview || (n.body.includes('](') ? 'Attachment' : 'No additional text')}</span>
                  </div>
                  {(showFolderInRow || n.deleted) && (
                    <div className="nt-row-folder">
                      <Folder size={11} />
                      {n.deleted ? `${folderPath(n.from ?? '')} · ${daysLeft(n.deleted)} day${daysLeft(n.deleted) === 1 ? '' : 's'} left` : folderPath(n.folder)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- the note */}
        <section className="nt-editor">
          <div className="k-toolbar nt-toolbar">
            <button className="nt-style-btn" disabled={!canEdit} onClick={(e) => menuAt(e, styleItems())} title="Paragraph style">
              Aa <ChevronDown size={12} />
            </button>
            <span className="k-sep" />
            <TB icon={Bold} title="Bold (⌘B)" on={fmt?.bold} disabled={!canEdit} onClick={() => chain()?.toggleBold().run()} />
            <TB icon={Italic} title="Italic (⌘I)" on={fmt?.italic} disabled={!canEdit} onClick={() => chain()?.toggleItalic().run()} />
            <TB icon={Underline} title="Underline (⌘U)" on={fmt?.underline} disabled={!canEdit} onClick={() => chain()?.toggleUnderline().run()} />
            <TB icon={Strikethrough} title="Strikethrough (⇧⌘S)" on={fmt?.strike} disabled={!canEdit} onClick={() => chain()?.toggleStrike().run()} />
            <span className="k-sep" />
            <TB icon={ListChecks} title="Checklist (⇧⌘L)" on={fmt?.task} disabled={!canEdit} onClick={() => chain()?.toggleTaskList().run()} />
            <TB icon={List} title="Bulleted list" on={fmt?.bullet} disabled={!canEdit} onClick={() => chain()?.toggleBulletList().run()} />
            <TB icon={ListOrdered} title="Numbered list" on={fmt?.ordered} disabled={!canEdit} onClick={() => chain()?.toggleOrderedList().run()} />
            <span className="k-sep" />
            <TB icon={Table2} title="Table" on={fmt?.table} disabled={!canEdit} onClick={(e) => (fmt?.table ? menuAt(e, tableItems()) : chain()?.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())} />
            <TB icon={Quote} title="Quote" on={fmt?.quote} disabled={!canEdit} onClick={() => chain()?.toggleBlockquote().run()} />
            <TB icon={Code} title="Code" on={fmt?.code} disabled={!canEdit} onClick={() => chain()?.toggleCode().run()} />
            <TB icon={Link2} title="Link (⌘K)" on={fmt?.link} disabled={!canEdit} onClick={() => void editLink()} />
            <TB icon={Paperclip} title="Attach a file or picture from the drive (or drag one in)" disabled={!canEdit} onClick={() => void attachFromDrive()} />
            <span className="k-spacer" />
            {inTrash && selected ? (
              <button className="k-btn small" onClick={() => void restoreNote(selected)}>
                <RotateCcw size={14} /> Restore
              </button>
            ) : (
              <TB icon={selected?.pinned ? PinOff : Pin} title={selected?.pinned ? 'Unpin' : 'Pin to the top'} on={selected?.pinned} disabled={!selected} onClick={() => selected && void togglePin(selected)} />
            )}
            <TB icon={Share} title="Share and export" disabled={!selected} onClick={(e) => menuAt(e, shareItems(selected))} />
            <TB icon={Trash2} title={inTrash ? 'Delete immediately' : 'Delete (moves to Recently Deleted)'} disabled={!selected} onClick={() => selected && void trashNote(selected)} />
            <TB icon={FilePlus} title="New Note (⌘N)" onClick={() => void newNote()} />
          </div>
          <div className={`nt-page${selected ? '' : ' empty'}`} onClick={(e) => { if (e.target === e.currentTarget && canEdit) edRef.current?.commands.focus('end') }}>
            {selected && (
              <div className="nt-date">
                {inTrash
                  ? `Deleted ${longDate(selected.deleted!)} from ${folderPath(selected.from ?? '')} — restore it to edit.`
                  : longDate(selected.modified)}
              </div>
            )}
            <EditorContent editor={editor} className="nt-content" style={{ display: selected ? undefined : 'none' }} />
            {!selected && loaded && (
              <div className="k-center k-muted nt-blank">
                <CheckSquare size={36} strokeWidth={1.3} />
                <div>{notes.length ? 'Select a note' : 'No note open'}</div>
                <button className="k-btn" onClick={() => void newNote()}>
                  <SquarePen size={14} /> New Note
                </button>
                <div className="nt-where">Notes are Markdown files in {path.pretty(NOTES_ROOT)}</div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function TB({ icon: Icon, title, on, disabled, onClick }: { icon: typeof Bold; title: string; on?: boolean; disabled?: boolean; onClick: (e: MouseEvent) => void }) {
  return (
    <button className={`k-icon-btn${on ? ' active' : ''}`} title={title} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      <Icon size={16} />
    </button>
  )
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
