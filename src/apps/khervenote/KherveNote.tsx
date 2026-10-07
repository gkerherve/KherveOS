// KherveNote: live notes for lectures, trainings and talks — the desktop
// KherveNote (../KherveNote, khervenote/) in KherveOS.
//
// The note model (model.ts) is the single source of truth, as on the desktop:
// the page (editor.ts, TipTap) shows its sections, the speech transcript runs
// beside it, serializer.ts writes exactly the LaTeX the desktop writes and the
// KherveOS server typesets it (os/services/latex.ts). Notes are .knote files
// (knote.ts) in ~/Documents/KherveNote, folders are folders (store.ts). They
// save themselves 2 s after a change; the version on the drive is kept before
// it is saved over; deleting moves to a Trash folder. Listening records the
// microphone and transcribes it with Whisper in the browser (listen.ts); the
// AI (ai.ts) uses KherveAI's providers, Ollama by default.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import {
  Bold, FileDown, FilePlus, FileText, Image as ImageIcon, Italic, List, ListOrdered, Loader2, Mic, Redo2, Save, Sparkles, SquarePlus, Star,
  HelpCircle, Underline as UnderlineIcon, Undo2, Square,
} from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { compileLatex } from '@/os/services/latex'
import { clipText, useAppTools } from '@/os/ai/appTools'
import {
  elapsed, isoSeconds, makeBlock, makeMeta, markdownBlocks, newId, newNote, newNoteId, plainText, sectionSpeechRange, speechBetween, timeLabel, toDict, fromDict,
  type Block, type BlockKind, type Note, type Segment,
} from './model'
import { readKnote, writeKnote } from './knote'
import { blocksToNodes, docToNote, noteToDoc, type JNode } from './convert'
import { toLatex, type LatexOptions } from './serializer'
import { allNotes, filterTree, labelOf, safeName, stemOf, type Folder, type NoteInfo } from './library'
import {
  EXAMPLES_FOLDER, installExamples, LIBRARY_ROOT, makeFolder, moveItem, newNotePath, renameItem, scan, snapshot, trashItem, TRASH, uniquePath, versions,
  type Version,
} from './store'
import {
  blockAtCursor, createExtensions, goToTime, insertNodes, newSection, refresh, sectionRanges, setStyle, STYLES, styleAt, type KnEnv, type StyleCode,
} from './editor'
import { DEFAULT_MODEL, LANGUAGES, ListenSession, MODELS, whisper } from './listen'
import * as ai from './ai'
import { merge as mergeWords, suggest as suggestWords } from './vocabulary'
import { NotesPanel, type OutlineItem } from './NotesPanel'
import { SpeechPanel } from './SpeechPanel'
import './khervenote.css'

const MANUAL_URL = 'https://github.com/gkerherve/KherveNote/blob/dev/khervenote/manual.md'
const REPO_URL = 'https://github.com/gkerherve/KherveNote'
const PICTURES = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']
const DOCUMENTS = ['.pdf', '.docx', '.pptx', '.doc', '.ppt', '.txt', '.md', '.odt', '.odp']
/** Where attached documents are put while they are open in another app. */
const OPEN_DIR = `${HOME}/.khervenote/open`

// --------------------------------------------------------------- settings

interface Settings {
  model: string
  language: string
  /** Seconds the speech comes before the notes about it. */
  lead: number
  clockTimes: boolean
  showMath: boolean
  exportTimes: boolean
  exportTranscript: boolean
  notesPanel: boolean
  speechPanel: boolean
  preview: boolean
  directions: string
}

const DEFAULTS: Settings = {
  model: DEFAULT_MODEL,
  language: '',
  lead: 120,
  clockTimes: true,
  showMath: true,
  exportTimes: false,
  exportTranscript: false,
  notesPanel: true,
  speechPanel: true,
  preview: true,
  directions: '',
}
const SETTINGS_KEY = 'khervenote.settings'

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>
    const out = { ...DEFAULTS }
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
      if (typeof raw[k] === typeof DEFAULTS[k]) (out as Record<string, unknown>)[k] = raw[k]
    }
    return out
  } catch {
    return { ...DEFAULTS }
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* storage blocked: keep them for this session */
  }
}

// ----------------------------------------------------------------- helpers

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function isBlank(n: Note): boolean {
  return (
    !n.meta.title.trim() &&
    !n.summary.trim() &&
    !n.recordings.length &&
    !n.transcript.length &&
    n.sections.every((s) => !s.title.trim() && !s.blocks.length)
  )
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
}
const mimeOf = (p: string) => MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream'

/** A picture LaTeX can include: PNG and JPEG as they are, anything else redrawn as PNG. */
async function includablePicture(bytes: Uint8Array, ext: string): Promise<{ bytes: Uint8Array; ext: string }> {
  const e = ext.toLowerCase() === '.jpeg' ? '.jpg' : ext.toLowerCase()
  if (e === '.png' || e === '.jpg') return { bytes, ext: e }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[e] ?? 'image/png' }))
  const img = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('The picture could not be read.'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || 800
  canvas.height = img.naturalHeight || 600
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('The picture could not be converted.')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: '.png' }
}

/** One section as the AI reads it (plain_text without the note's header). */
function sectionText(note: Note, index: number): string {
  const sec = note.sections[index]
  if (!sec) return ''
  const one: Note = { ...note, meta: makeMeta({ ...note.meta, title: '', speaker: '', date: '', place: '' }), sections: [sec], transcript: [], attachments: [] }
  return plainText(one).replace(/^# Notes\n?/, '').trim()
}

interface AiRun {
  step: string
  text: string
  started: number
  model: string
}

interface Playing {
  index: number
  paused: boolean
}

// ================================================================ the app

export default function KherveNote({ win, args }: AppProps) {
  const [settings, setSettingsState] = useState(loadSettings)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const setSetting = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setSettingsState((s) => {
      const n = { ...s, [k]: v }
      saveSettings(n)
      return n
    })

  // The note: meta, summary, speech and recordings here; its sections live in the page.
  const noteRef = useRef<Note>(newNote())
  const [, setVersion] = useState(0)
  const rerender = () => setVersion((v) => v + 1)
  const assets = useRef(new Map<string, Uint8Array>())
  const urls = useRef(new Map<string, string>())
  const fileRef = useRef<string | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const knownMtime = useRef<number | null>(null)
  const targetFolder = useRef(LIBRARY_ROOT)
  const [selectedFolder, setSelectedFolder] = useState(LIBRARY_ROOT)
  const dirtyRef = useRef(false)
  const [dirty, setDirty] = useState(false)
  const saveTimer = useRef<number | null>(null)
  const saving = useRef<Promise<boolean> | null>(null)
  const [showSummary, setShowSummary] = useState(false)
  const [session, setSession] = useState(() => ({ key: 1, doc: noteToDoc(noteRef.current) }))
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [words, setWords] = useState(0)
  const outlineTimer = useRef<number | null>(null)

  // Library
  const [tree, setTree] = useState<Folder | null>(null)
  const [query, setQuery] = useState('')

  // Speech
  const listenRef = useRef<ListenSession | null>(null)
  const [listening, setListening] = useState(false)
  const [listenStatus, setListenStatus] = useState('')
  const [partial, setPartial] = useState('')
  const [level, setLevel] = useState(0)
  const levelFrame = useRef(0)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const lastClicked = useRef<number | null>(null)
  const [highlight, setHighlight] = useState<{ from: number; to: number } | null>(null)
  const speechUndo = useRef<Segment[][]>([])
  const playCtx = useRef<AudioContext | null>(null)
  const playSrc = useRef<AudioBufferSourceNode | null>(null)
  const decoded = useRef(new Map<string, AudioBuffer>())
  const [playing, setPlaying] = useState<Playing | null>(null)
  const [listenStart, setListenStart] = useState<number | null>(null)
  const [, setTick] = useState(0)

  // AI and export
  const aiRef = useRef<AbortController | null>(null)
  const [aiRun, setAiRun] = useState<AiRun | null>(null)
  const [busy, setBusy] = useState('')
  const [versionList, setVersionList] = useState<Version[] | null>(null)
  const opened = useRef(new Map<string, { asset: string; noteId: string }>())

  // ------------------------------------------------------------ the page

  const h = useRef<Handlers | null>(null)

  const env = useMemo<KnEnv>(
    () => ({
      timeLabel: (t) => timeLabel(noteRef.current, t, settingsRef.current.clockTimes),
      elapsed: () => elapsed(noteRef.current),
      showMath: () => settingsRef.current.showMath,
      assetUrl: (p) => assetUrl(p),
      editCaption: (pos) => h.current?.editCaption(pos),
      openAttachment: (p, n) => h.current?.openAttachment(p, n),
      attachmentMenu: (e, pos, p, n) => h.current?.attachmentMenu(e, pos, p, n),
      addPicture: (f) => h.current?.addPicture(f) ?? Promise.resolve(null),
      dropPaths: (ps, pos) => h.current?.dropPaths(ps, pos),
    }),
    [],
  )
  const extensions = useMemo(() => createExtensions(env), [env])
  const editorOptions = useMemo(
    () => ({
      extensions,
      content: session.doc,
      editorProps: { attributes: { class: 'kn-prose', spellcheck: 'true' } },
      onUpdate: () => h.current?.changed(),
      onSelectionUpdate: () => h.current?.selectionChanged(),
      onCreate: () => h.current?.changed(false),
    }),
    [extensions, session],
  )
  const editor = useEditor(editorOptions, [session.key])
  const edRef = useRef<Editor | null>(editor)
  edRef.current = editor

  const st = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            style: styleAt(e),
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            underline: e.isActive('underline'),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  })

  function assetUrl(p: string): string | null {
    const hit = urls.current.get(p)
    if (hit) return hit
    const data = assets.current.get(p)
    if (!data) return null
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeOf(p) }))
    urls.current.set(p, url)
    return url
  }

  function forgetUrls() {
    for (const u of urls.current.values()) URL.revokeObjectURL(u)
    urls.current.clear()
  }

  /** The note as it is now: the page read back into the model. */
  function sync(): Note {
    const ed = edRef.current
    if (ed && !ed.isDestroyed) noteRef.current = docToNote(ed.getJSON() as JNode, noteRef.current)
    return noteRef.current
  }

  function markDirty() {
    dirtyRef.current = true
    setDirty(true)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void save()
    }, 2000)
  }

  function changed(edit = true) {
    if (edit) markDirty()
    if (outlineTimer.current) window.clearTimeout(outlineTimer.current)
    outlineTimer.current = window.setTimeout(() => {
      const ed = edRef.current
      if (!ed || ed.isDestroyed) return
      const items: OutlineItem[] = []
      ed.state.doc.forEach((node, pos) => {
        if (node.type.name === 'heading' && Number(node.attrs.level) <= 1) items.push({ title: node.textContent.trim(), pos })
      })
      setOutline(items)
      setWords(ed.state.doc.textBetween(0, ed.state.doc.content.size, ' ', ' ').split(/\s+/).filter(Boolean).length)
    }, edit ? 400 : 0)
  }

  function selectionChanged() {
    const ed = edRef.current
    if (!ed) return
    const b = blockAtCursor(ed.state)
    const t = b?.node.attrs.t
    if (typeof t === 'number' && noteRef.current.transcript.length) {
      setHighlight({ from: t - Math.max(60, settingsRef.current.lead), to: t + 5 })
    }
  }

  function updateNote(mut: (n: Note) => void, dirtyToo = true) {
    mut(noteRef.current)
    rerender()
    if (dirtyToo) markDirty()
  }

  // ---------------------------------------------------------- library

  async function rescan() {
    try {
      setTree(await scan(LIBRARY_ROOT))
    } catch {
      /* the drive is not ready yet */
    }
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!fs.exists(LIBRARY_ROOT)) {
        // First start: the examples go into the library, as Help ▸ Example notes does.
        try {
          await installExamples()
        } catch {
          /* offline: the menu can do it later */
        }
      }
      if (alive) await rescan()
    })()
    let timer = 0
    const off = fs.watch((ev) => {
      const p = ev.path
      const att = opened.current.get(p)
      if (att && ev.type === 'change') void h.current?.attachmentChanged(p)
      if ((p === LIBRARY_ROOT || path.isInside(p, LIBRARY_ROOT)) && !p.includes('/.history/')) {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => void rescan(), 250)
      }
    })
    return () => {
      alive = false
      off()
      window.clearTimeout(timer)
    }
  }, [])

  // ------------------------------------------------------------ files

  function loadInto(note: Note, a: Map<string, Uint8Array>, p: string | null) {
    forgetUrls()
    decoded.current.clear()
    noteRef.current = note
    assets.current = a
    fileRef.current = p
    setFilePath(p)
    knownMtime.current = p ? (fs.stat(p)?.mtime ?? null) : null
    if (p) {
      targetFolder.current = path.dirname(p)
      setSelectedFolder(path.dirname(p))
    }
    dirtyRef.current = false
    setDirty(false)
    setSelected(new Set())
    setPartial('')
    setHighlight(null)
    setShowSummary(!!note.summary.trim())
    speechUndo.current = []
    setSession((s) => ({ key: s.key + 1, doc: noteToDoc(note) }))
    win.setDocumentPath(p)
  }

  async function save(): Promise<boolean> {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    while (saving.current) await saving.current
    const run = (async () => {
      const n = sync()
      let p = fileRef.current
      try {
        if (!p) {
          if (isBlank(n)) {
            dirtyRef.current = false
            setDirty(false)
            return true
          }
          const folder = fs.isDir(targetFolder.current) ? targetFolder.current : LIBRARY_ROOT
          if (!fs.exists(folder)) await fs.mkdir(folder, { recursive: true })
          p = newNotePath(folder, n.meta.title)
        } else {
          const st = fs.stat(p)
          if (st && knownMtime.current != null && st.mtime !== knownMtime.current) {
            // Changed elsewhere since this window read or wrote it: never saved over.
            const copy = uniquePath(path.dirname(p), `${stemOf(p)} (my version)`)
            os.notify({ title: 'Saved as a copy', body: `${path.basename(p)} was changed elsewhere, so it was not saved over. Your version is ${path.basename(copy)}.` })
            p = copy
          } else if (st) {
            try {
              await snapshot(n.meta.id, p)
            } catch {
              /* an earlier version could not be kept; saving still goes on */
            }
          }
        }
        await fs.writeBytes(p, writeKnote(n, assets.current), { mkdirs: true })
        knownMtime.current = fs.stat(p)?.mtime ?? null
        if (fileRef.current !== p) {
          fileRef.current = p
          setFilePath(p)
          win.setDocumentPath(p)
        }
        dirtyRef.current = false
        setDirty(false)
        return true
      } catch (e) {
        await os.dialog.alert(`The note could not be saved: ${errorText(e)}`, { title: 'KherveNote' })
        return false
      }
    })()
    saving.current = run
    try {
      return await run
    } finally {
      saving.current = null
    }
  }

  /** Before another note opens: finish listening (its last words stay here), stop the AI, save. */
  async function leaveNote(): Promise<boolean> {
    await stopListening()
    aiRef.current?.abort()
    stopPlaying()
    return save()
  }

  async function openNote(p: string) {
    if (p === fileRef.current) return
    if (!(await leaveNote())) return
    try {
      const { note, assets: a } = readKnote(await fs.readBytes(p))
      loadInto(note, a, p)
    } catch (e) {
      await os.dialog.alert(`Could not open ${path.basename(p)}: ${errorText(e)}`, { title: 'KherveNote' })
    }
  }

  async function startNewNote(folder = targetFolder.current) {
    if (!(await leaveNote())) return
    targetFolder.current = fs.isDir(folder) ? folder : LIBRARY_ROOT
    setSelectedFolder(targetFolder.current)
    loadInto(newNote(), new Map(), null)
    window.setTimeout(() => edRef.current?.commands.focus('start'), 50)
  }

  async function openDialog() {
    const p = await os.dialog.openFile({ title: 'Open a note', extensions: ['.knote'], startDir: LIBRARY_ROOT })
    if (p) await openNote(p)
  }

  async function saveCopyAs() {
    const n = sync()
    const target = await os.dialog.saveFile({ title: 'Save a copy as', defaultName: path.join(path.dirname(fileRef.current ?? `${LIBRARY_ROOT}/x`), `${safeName(n.meta.title || 'Note')} copy.knote`), extensions: ['.knote'] })
    if (!target) return
    const copy = fromDict(toDict(n))
    copy.meta.id = newNoteId()
    await fs.writeBytes(target, writeKnote(copy, assets.current), { mkdirs: true })
    os.notify({ title: 'Copy saved', body: path.pretty(target) })
  }

  async function newFolder(parent: string) {
    const name = await os.dialog.prompt('Name of the new folder:', { title: 'New folder', defaultValue: 'New folder' })
    if (!name) return
    const p = await makeFolder(fs.isDir(parent) ? parent : LIBRARY_ROOT, name)
    setSelectedFolder(p)
    targetFolder.current = p
    await rescan()
  }

  async function renameNoteOrFolder(src: string) {
    const isDir = fs.isDir(src)
    const name = await os.dialog.prompt(isDir ? 'New name of the folder:' : 'New name of the note file:', {
      title: 'Rename',
      defaultValue: isDir ? path.basename(src) : stemOf(src),
    })
    if (!name) return
    try {
      const dest = await renameItem(src, name)
      followMove(src, dest)
    } catch (e) {
      await os.dialog.alert(errorText(e), { title: 'Rename' })
    }
  }

  /** The open note's file moved (renamed, or its folder did). */
  function followMove(src: string, dest: string) {
    const cur = fileRef.current
    if (!cur) return
    if (cur === src) fileRef.current = dest
    else if (path.isInside(cur, src)) fileRef.current = dest + cur.slice(src.length)
    else return
    setFilePath(fileRef.current)
    knownMtime.current = fs.stat(fileRef.current!)?.mtime ?? null
    win.setDocumentPath(fileRef.current)
  }

  async function moveTo(src: string, destFolder: string) {
    try {
      if (src === fileRef.current) await save()
      const dest = await moveItem(src, destFolder)
      followMove(src, dest)
    } catch (e) {
      await os.dialog.alert(errorText(e), { title: 'Move' })
    }
  }

  async function trash(src: string) {
    const isDir = fs.isDir(src)
    const ok = await os.dialog.confirm(`Move ${isDir ? 'the folder ' : ''}“${isDir ? path.basename(src) : stemOf(src)}” to the Trash? It can be taken back from File ▸ Deleted notes.`, {
      title: 'Move to Trash',
      okLabel: 'Move to Trash',
    })
    if (!ok) return
    const cur = fileRef.current
    if (cur && (cur === src || path.isInside(cur, src))) {
      // The open note goes with it: leave it without saving it back.
      await stopListening()
      aiRef.current?.abort()
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      loadInto(newNote(), new Map(), null)
    }
    try {
      await trashItem(src)
    } catch (e) {
      await os.dialog.alert(errorText(e), { title: 'Move to Trash' })
    }
  }

  async function showDeleted() {
    const dir = path.join(LIBRARY_ROOT, TRASH)
    if (!fs.exists(dir)) await fs.mkdir(dir, { recursive: true })
    os.open('files', { path: dir })
  }

  async function examples() {
    try {
      const files = await installExamples()
      await rescan()
      const folder = path.join(LIBRARY_ROOT, EXAMPLES_FOLDER)
      setSelectedFolder(folder)
      os.notify({ title: 'Example notes', body: `${files.length} worked lectures are in the Examples folder of the Notes panel.` })
      if (files[0] && !fileRef.current && isBlank(sync())) await openNote(files[0])
    } catch (e) {
      await os.dialog.alert(errorText(e), { title: 'Example notes' })
    }
  }

  async function showVersions() {
    const n = sync()
    const list = await versions(n.meta.id)
    if (!list.length) {
      await os.dialog.alert('There is no earlier version of this note yet. A version is kept before the note is saved over (one every few minutes).', { title: 'Earlier versions' })
      return
    }
    setVersionList(list)
  }

  async function restoreVersion(v: Version) {
    setVersionList(null)
    const folder = fileRef.current ? path.dirname(fileRef.current) : LIBRARY_ROOT
    const dest = uniquePath(folder, `${stemOf(fileRef.current ?? v.title ?? 'Note')} (version ${stemOf(v.path)})`)
    await fs.copy(v.path, dest)
    // A copy is a note of its own.
    const { note, assets: a } = readKnote(await fs.readBytes(dest))
    note.meta.id = newNoteId()
    await fs.writeBytes(dest, writeKnote(note, a))
    await openNote(dest)
  }

  // ------------------------------------------------------- pictures, documents

  async function addPicture(file: File): Promise<string | null> {
    try {
      const ext = '.' + (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
      const pic = await includablePicture(new Uint8Array(await file.arrayBuffer()), ext)
      const rel = `assets/${newId()}${pic.ext}`
      assets.current.set(rel, pic.bytes)
      markDirty()
      return rel
    } catch (e) {
      os.notify({ title: 'Picture not added', body: errorText(e) })
      return null
    }
  }

  function insertBlockNodes(nodes: JNode[], at?: number) {
    const ed = edRef.current
    if (!ed) return
    const pos = at ?? (blockAtCursor(ed.state) ? blockAtCursor(ed.state)!.pos + blockAtCursor(ed.state)!.node.nodeSize : ed.state.doc.content.size)
    insertNodes(ed, pos, nodes)
  }

  async function pictureFromDrive(p: string, at?: number) {
    const ext = path.extname(p).toLowerCase()
    const pic = await includablePicture(await fs.readBytes(p), ext)
    const rel = `assets/${newId()}${pic.ext}`
    assets.current.set(rel, pic.bytes)
    insertBlockNodes([{ type: 'knImage', attrs: { path: rel, caption: '', t: elapsed(noteRef.current) } }], at)
  }

  async function documentFromDrive(p: string, at?: number) {
    const ext = path.extname(p)
    const name = path.basename(p)
    const rel = `assets/att-${newId()}/${safeName(stemOf(p))}${ext}`
    assets.current.set(rel, await fs.readBytes(p))
    insertBlockNodes([{ type: 'knAttachment', attrs: { path: rel, name, t: elapsed(noteRef.current) } }], at)
  }

  async function insertPicture() {
    const p = await os.dialog.openFile({ title: 'Insert a picture', extensions: PICTURES, startDir: `${HOME}/Pictures` })
    if (!p) return
    try {
      await pictureFromDrive(p)
    } catch (e) {
      await os.dialog.alert(errorText(e), { title: 'Picture' })
    }
  }

  async function insertDocument() {
    const p = await os.dialog.openFile({ title: 'Attach a PDF, Word or PowerPoint document', extensions: DOCUMENTS, startDir: `${HOME}/Documents` })
    if (p) await documentFromDrive(p)
  }

  function dropPaths(paths: string[], pos: number) {
    void (async () => {
      const ed = edRef.current
      if (!ed) return
      const $p = ed.state.doc.resolve(Math.min(pos, ed.state.doc.content.size))
      const at = $p.depth >= 1 ? $p.after(1) : pos
      for (const p of [...paths].reverse()) {
        const ext = path.extname(p).toLowerCase()
        try {
          if (PICTURES.includes(ext)) await pictureFromDrive(p, at)
          else if (ext === '.knote') await openNote(p)
          else if (fs.isFile(p)) await documentFromDrive(p, at)
        } catch (e) {
          os.notify({ title: `${path.basename(p)} was not added`, body: errorText(e) })
        }
      }
    })()
  }

  async function editCaption(pos: number) {
    const ed = edRef.current
    const node = ed?.state.doc.nodeAt(pos)
    if (!ed || !node) return
    const caption = await os.dialog.prompt('Caption of the picture:', { title: 'Caption', defaultValue: String(node.attrs.caption ?? '') })
    if (caption === null) return
    ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, caption: caption.trim() }))
  }

  /** Open an attached document in its app (PDFs in KhervePDF); annotations saved there come back into the note. */
  async function openAttachment(asset: string, name: string) {
    const data = assets.current.get(asset)
    if (!data) {
      await os.dialog.alert(`${name} is not in this note's file any more.`, { title: 'KherveNote' })
      return
    }
    const n = noteRef.current
    const target = path.join(OPEN_DIR, n.meta.id, safeName(name, 'document'))
    await fs.writeBytes(target, data, { mkdirs: true })
    opened.current.set(target, { asset, noteId: n.meta.id })
    if (/\.pdf$/i.test(name)) os.open('khervepdf', { path: target })
    else await os.openFile(target)
  }

  async function attachmentChanged(p: string) {
    const o = opened.current.get(p)
    if (!o || o.noteId !== noteRef.current.meta.id || !fs.isFile(p)) return
    const data = await fs.readBytes(p)
    const old = assets.current.get(o.asset)
    if (old && old.length === data.length && old.every((b, i) => b === data[i])) return
    assets.current.set(o.asset, data)
    markDirty()
    os.notify({ title: 'Document updated in the note', body: path.basename(p) })
  }

  function attachmentMenu(e: MouseEvent, pos: number, asset: string, name: string) {
    os.contextMenu(e, [
      { label: /\.pdf$/i.test(name) ? 'Open in KhervePDF' : 'Open', onClick: () => void openAttachment(asset, name) },
      {
        label: 'Save a copy to the drive…',
        onClick: async () => {
          const target = await os.dialog.saveFile({ title: 'Save a copy', defaultName: name })
          const data = assets.current.get(asset)
          if (target && data) await fs.writeBytes(target, data, { mkdirs: true })
        },
      },
      '-',
      {
        label: 'Remove from the note',
        danger: true,
        onClick: () => {
          const ed = edRef.current
          const node = ed?.state.doc.nodeAt(pos)
          if (ed && node) ed.view.dispatch(ed.state.tr.delete(pos, pos + node.nodeSize))
        },
      },
    ])
  }

  // ------------------------------------------------------------ listening

  async function toggleListen() {
    if (listenRef.current) {
      await stopListening()
      return
    }
    const n = noteRef.current
    if (!n.meta.started) updateNote((x) => (x.meta.started = isoSeconds()))
    const noteId = n.meta.id
    const t0 = elapsed(noteRef.current) ?? 0
    const s = new ListenSession(
      t0,
      settingsRef.current.model,
      settingsRef.current.language,
      {
        text: (text, t) => addSegment(noteId, text, t),
        partial: (text) => {
          if (noteRef.current.meta.id === noteId) setPartial(text)
        },
        level: (v) => {
          if (levelFrame.current) return
          levelFrame.current = requestAnimationFrame(() => {
            levelFrame.current = 0
            setLevel(v)
          })
        },
        status: setListenStatus,
        error: (m) => os.notify({ title: 'Listening', body: m, timeout: 10000 }),
      },
      settingsRef.current.preview,
    )
    whisper.onProgress = (loaded, total) => {
      if (total > 0) setListenStatus(`Downloading the speech model (${settingsRef.current.model}) — once only: ${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6)} MB. Keep talking: it is being recorded.`)
    }
    try {
      await s.start()
    } catch (e) {
      await os.dialog.alert(errorText(e), { title: 'Listen' })
      return
    }
    listenRef.current = s
    setListening(true)
    setListenStart(Date.now())
  }

  async function stopListening() {
    const s = listenRef.current
    if (!s) return
    listenRef.current = null
    setListening(false)
    setListenStart(null)
    setLevel(0)
    const noteId = noteRef.current.meta.id
    const rec = await s.stop()
    // The last words are still being written: they stay with this note.
    await whisper.idle()
    setListenStatus('')
    if (rec && noteRef.current.meta.id === noteId) {
      const rel = `assets/rec-${newId()}${rec.ext}`
      assets.current.set(rel, rec.bytes)
      updateNote((n) => n.recordings.push({ path: rel, t0: rec.t0, duration: rec.duration }))
    }
  }

  function addSegment(noteId: string, text: string, t: number) {
    // Speech for a note that is no longer open is dropped, never written into another.
    if (noteRef.current.meta.id !== noteId) return
    updateNote((n) => {
      n.transcript.push({ t, text })
      n.transcript.sort((a, b) => a.t - b.t)
    })
  }

  function changeSpeech(mut: (segs: Segment[]) => void) {
    speechUndo.current.push(noteRef.current.transcript.map((g) => ({ ...g })))
    if (speechUndo.current.length > 50) speechUndo.current.shift()
    updateNote((n) => mut(n.transcript))
    setSelected(new Set())
  }

  async function correctLine(i: number) {
    const g = noteRef.current.transcript[i]
    if (!g) return
    const text = await os.dialog.prompt(`What was said at ${timeLabel(noteRef.current, g.t, settingsRef.current.clockTimes)}:`, { title: 'Correct this line', defaultValue: g.text })
    if (text === null || text.trim() === g.text) return
    changeSpeech((segs) => (segs[i] = { ...segs[i], text: text.trim() }))
    // A new technical term in the correction is listened for from then on.
    const fresh = suggestWords([text], 10, noteRef.current.meta.vocabulary).filter((w) => !g.text.includes(w))
    if (fresh.length) updateNote((n) => (n.meta.vocabulary = mergeWords(n.meta.vocabulary, fresh)))
  }

  function selectLine(i: number, e: ReactMouseEvent) {
    setSelected((s) => {
      if (e.shiftKey && lastClicked.current != null) {
        const n = new Set(s)
        const [a, b] = [Math.min(lastClicked.current, i), Math.max(lastClicked.current, i)]
        for (let k = a; k <= b; k++) n.add(k)
        return n
      }
      if (e.metaKey || e.ctrlKey) {
        const n = new Set(s)
        if (n.has(i)) n.delete(i)
        else n.add(i)
        lastClicked.current = i
        return n
      }
      lastClicked.current = i
      return s.size === 1 && s.has(i) ? new Set() : new Set([i])
    })
  }

  function selectedSegments(): Segment[] {
    const segs = noteRef.current.transcript
    return [...selected].sort((a, b) => a - b).map((i) => segs[i]).filter(Boolean)
  }

  function speechText(segs: Segment[]): string {
    const n = noteRef.current
    const lines = segs.map((g) => `[${timeLabel(n, g.t, settingsRef.current.clockTimes)}] ${g.text}`).join('\n')
    const wordsOfTalk = n.meta.vocabulary.trim()
    return wordsOfTalk ? `(Terms used in this talk: ${wordsOfTalk})\n${lines}` : lines
  }

  function insertSpeech(segs: Segment[]) {
    if (!segs.length) return
    const nodes: JNode[] = segs.map((g) => ({ type: 'paragraph', attrs: { kind: 'transcript', t: g.t }, content: [{ type: 'text', text: g.text }] }))
    insertBlockNodes(nodes)
  }

  function speechMenu(e: ReactMouseEvent, i: number) {
    if (!selected.has(i)) setSelected(new Set([i]))
    const segs = selected.has(i) ? selectedSegments() : [noteRef.current.transcript[i]]
    os.contextMenu(e, [
      { label: 'Insert into my notes', onClick: () => insertSpeech(segs) },
      { label: 'Show my notes at this time', onClick: () => edRef.current && goToTime(edRef.current, noteRef.current.transcript[i].t) },
      { label: 'Make notes from the selection', disabled: !!aiRun, onClick: () => void makeNotes(segs) },
      '-',
      { label: 'Hear this line', disabled: !playable(i), onClick: () => void play(i, false) },
      { label: 'Play from here', disabled: !playable(i), onClick: () => void play(i, true) },
      '-',
      { label: 'Correct this line…', onClick: () => void correctLine(i) },
      {
        label: segs.length > 1 ? `Delete these ${segs.length} lines` : 'Delete this line',
        danger: true,
        onClick: () => {
          const drop = new Set(segs)
          changeSpeech((list) => list.splice(0, list.length, ...list.filter((g) => !drop.has(g))))
        },
      },
      {
        label: 'Undo the last change to the speech',
        disabled: !speechUndo.current.length,
        onClick: () => {
          const prev = speechUndo.current.pop()
          if (prev) updateNote((n) => (n.transcript = prev))
        },
      },
    ])
  }

  // ------------------------------------------------------------ playback

  function recordingAt(t: number) {
    for (const r of noteRef.current.recordings) {
      if (r.t0 - 1 <= t && t <= r.t0 + r.duration + 1 && assets.current.has(r.path)) return r
    }
    return null
  }

  function playable(i: number): boolean {
    const g = noteRef.current.transcript[i]
    return !!g && !!recordingAt(g.t)
  }

  /** Hear a line again: the recording holding it, decoded once, played from just before it. */
  async function play(i: number, carryOn: boolean) {
    const segs = noteRef.current.transcript
    const g = segs[i]
    const rec = g && recordingAt(g.t)
    const data = rec && assets.current.get(rec.path)
    if (!g || !rec || !data) {
      os.notify({ title: 'Not in the note', body: 'The recording of this line is not in the note.' })
      return
    }
    stopPlaying()
    try {
      const ctx = (playCtx.current ??= new AudioContext())
      if (ctx.state === 'suspended') await ctx.resume()
      let buf = decoded.current.get(rec.path)
      if (!buf) {
        buf = await ctx.decodeAudioData(data.slice().buffer)
        decoded.current.set(rec.path, buf)
      }
      const start = Math.min(Math.max(0, g.t - rec.t0 - 0.4), buf.duration)
      const next = segs[i + 1]?.t
      const until = carryOn ? null : next != null && next - g.t < 30 ? next - rec.t0 + 0.2 : start + 15
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.onended = () => {
        if (playSrc.current === src) {
          playSrc.current = null
          setPlaying(null)
        }
      }
      if (until != null) src.start(0, start, Math.max(0.2, until - start))
      else src.start(0, start)
      playSrc.current = src
      setPlaying({ index: i, paused: false })
    } catch (e) {
      os.notify({ title: 'Could not play the recording', body: errorText(e) })
    }
  }

  function stopPlaying() {
    const src = playSrc.current
    playSrc.current = null
    try {
      src?.stop()
    } catch {
      /* already stopped */
    }
    if (playCtx.current?.state === 'suspended') void playCtx.current.resume()
    setPlaying(null)
  }

  function pausePlaying() {
    const ctx = playCtx.current
    if (!ctx || !playSrc.current) return
    if (ctx.state === 'running') void ctx.suspend()
    else void ctx.resume()
    setPlaying((p) => (p ? { ...p, paused: ctx.state === 'running' } : p))
  }

  // ------------------------------------------------------------------ AI

  async function runAi(step: string, job: (opts: ai.AskOptions & { onStep: (s: string) => void }) => Promise<string>, apply: (answer: string) => void) {
    if (aiRef.current) {
      os.notify({ title: 'The AI is busy', body: 'Wait for it to finish, or press Cancel.' })
      return
    }
    const ctrl = new AbortController()
    aiRef.current = ctrl
    const noteId = noteRef.current.meta.id
    setAiRun({ step, text: '', started: Date.now(), model: '' })
    try {
      const choice = await ai.chooseModel()
      setAiRun((r) => (r ? { ...r, model: choice.label } : r))
      const answer = await job({
        signal: ctrl.signal,
        choice,
        onText: (piece) => setAiRun((r) => (r ? { ...r, text: (r.text + piece).slice(-600) } : r)),
        onStep: (s) => setAiRun((r) => (r ? { ...r, step: s } : r)),
      })
      // An answer for a note that is no longer open is dropped.
      if (ctrl.signal.aborted || noteRef.current.meta.id !== noteId) return
      apply(answer)
    } catch (e) {
      if (!ctrl.signal.aborted) await os.dialog.alert(errorText(e), { title: 'AI' })
    } finally {
      aiRef.current = null
      setAiRun(null)
    }
  }

  /** The section index (as the model numbers them) and the page ranges. */
  function sectionsHere() {
    const ed = edRef.current!
    const n = sync()
    let headings = 0
    ed.state.doc.forEach((node) => {
      if (node.type.name === 'heading' && Number(node.attrs.level) <= 1) headings++
    })
    const ranges = sectionRanges(ed.state.doc, n.sections.length > headings)
    const pos = ed.state.selection.from
    let index = 0
    ranges.forEach((r, i) => {
      if (r.start <= pos) index = i
    })
    return { note: n, ranges, index }
  }

  /** The selection's whole blocks: [from, to) and their text. */
  function selectedBlocks(): { from: number; to: number; text: string; t: number | null } | null {
    const ed = edRef.current
    if (!ed) return null
    const { $from, $to } = ed.state.selection
    if ($from.depth < 1) return null
    const from = $from.before(1)
    const to = $to.depth >= 1 ? $to.after(1) : $from.after(1)
    const text = ed.state.doc.textBetween(from, to, '\n\n', '\n').trim()
    const first = ed.state.doc.nodeAt(from)
    return { from, to, text, t: typeof first?.attrs.t === 'number' ? (first.attrs.t as number) : null }
  }

  function replaceRange(from: number, to: number, nodes: JNode[]) {
    const ed = edRef.current
    if (!ed || !nodes.length) return
    const pm = nodes.map((x) => ed.schema.nodeFromJSON(x))
    ed.view.dispatch(ed.state.tr.replaceWith(from, to, pm).scrollIntoView())
  }

  function rephrase() {
    const ed = edRef.current
    if (!ed) return
    const { from, to, empty } = ed.state.selection
    const sameBlock = ed.state.selection.$from.parent === ed.state.selection.$to.parent
    if (!empty && sameBlock && ed.state.selection.$from.parent.isTextblock) {
      const text = ed.state.doc.textBetween(from, to, '\n')
      void runAi('Rephrasing the selection', (o) => ai.ask(ai.REPHRASE, text, o), (answer) => {
        ed.view.dispatch(ed.state.tr.insertText(answer.replace(/\s*\n+\s*/g, ' '), from, to))
      })
      return
    }
    const sel = selectedBlocks()
    if (!sel?.text) return
    void runAi('Rephrasing', (o) => ai.ask(ai.REPHRASE, sel.text, o), (answer) => {
      const blocks = markdownBlocks(answer).map((b, i) => ({ ...b, t: i === 0 ? sel.t : null }))
      replaceRange(sel.from, sel.to, blocksToNodes(blocks))
    })
  }

  function summariseSection() {
    const ed = edRef.current
    if (!ed) return
    const { empty } = ed.state.selection
    const { note, ranges, index } = sectionsHere()
    const sel = !empty ? selectedBlocks() : null
    const text = sel?.text || sectionText(note, index)
    if (!text.trim()) return
    const at = sel ? sel.to : ranges[index]?.end ?? ed.state.doc.content.size
    void runAi('Summarising', (o) => ai.ask(ai.SUMMARISE, text, o), (answer) => {
      insertNodes(ed, Math.min(at, ed.state.doc.content.size), blocksToNodes([makeBlock({ kind: 'important', text: answer.trim() })]))
    })
  }

  function summariseNote() {
    const text = plainText(sync())
    void runAi('Summarising the whole note', (o) => ai.ask(ai.SUMMARISE_NOTE, text, o), (answer) => {
      updateNote((n) => (n.summary = answer.trim()))
      setShowSummary(true)
    })
  }

  async function reviseWithDirections() {
    const ed = edRef.current
    if (!ed) return
    const directions = await os.dialog.prompt('How should the AI revise the selected text (or this section)? E.g. “shorter, as bullet points”, “in French”, “explain the terms”.', {
      title: 'Revise with directions',
      defaultValue: settingsRef.current.directions,
    })
    if (!directions?.trim()) return
    setSetting('directions', directions.trim())
    let range: { from: number; to: number; t: number | null } | null = null
    let text = ''
    if (!ed.state.selection.empty) {
      const sel = selectedBlocks()
      if (sel) ((range = sel), (text = sel.text))
    } else {
      const { note, ranges, index } = sectionsHere()
      const r = ranges[index]
      if (r) {
        const from = r.heading != null ? r.heading + ed.state.doc.nodeAt(r.heading)!.nodeSize : r.start
        range = { from, to: r.end, t: null }
        text = sectionText(note, index)
      }
    }
    if (!range || !text.trim()) return
    const target = range
    void runAi('Revising', (o) => ai.revise(text, directions, o), (answer) => {
      replaceRange(target.from, target.to, blocksToNodes(markdownBlocks(answer)))
    })
  }

  function fillSection() {
    const ed = edRef.current
    if (!ed) return
    const { note, ranges, index } = sectionsHere()
    const picked = selectedSegments()
    let segs = picked
    if (!segs.length) {
      const r = sectionSpeechRange(note, index, settingsRef.current.lead)
      segs = speechBetween(note, r.start, r.end)
    }
    if (!segs.length) {
      void os.dialog.alert('No speech goes with this section (by the times it was written). Select lines in the Speech panel first, then press Fill in my section.', { title: 'Fill in my section' })
      return
    }
    const label = (t: number) => timeLabel(note, t, settingsRef.current.clockTimes)
    const title = `From the speech (${label(segs[0].t)}–${label(segs[segs.length - 1].t)})`
    const notes = sectionText(note, index)
    const end = ranges[index]?.end ?? ed.state.doc.content.size
    void runAi('Comparing your notes with what was said', (o) => ai.fillFromSpeech(notes, speechText(segs), o), (answer) => {
      if (/^nothing to add\.?$/i.test(answer.trim())) {
        os.notify({ title: 'Nothing to add', body: 'Your notes already cover what was said in this section.' })
        return
      }
      const blocks: Block[] = [makeBlock({ kind: 'heading', text: title, level: 2 }), ...markdownBlocks(answer)]
      insertNodes(ed, Math.min(end, ed.state.doc.content.size), blocksToNodes(blocks))
    })
  }

  async function makeNotes(segs?: Segment[]) {
    const ed = edRef.current
    if (!ed) return
    const list = segs?.length ? segs : selectedSegments().length ? selectedSegments() : noteRef.current.transcript
    if (!list.length) return
    const text = speechText(list)
    void runAi('Writing notes from the speech', (o) => ai.notesFromSpeech(text, o), (answer) => {
      const nodes: JNode[] = [{ type: 'heading', attrs: { level: 1, t: null }, content: [{ type: 'text', text: 'Notes from the speech' }] }, ...blocksToNodes(markdownBlocks(answer))]
      insertNodes(ed, ed.state.doc.content.size, nodes)
    })
  }

  // -------------------------------------------------------------- export

  function latexOptions(extra: Partial<LatexOptions> = {}): LatexOptions {
    return {
      showTimes: settingsRef.current.exportTimes,
      transcript: settingsRef.current.exportTranscript,
      hasAsset: (p) => assets.current.has(p),
      ...extra,
    }
  }

  async function compile(opts: LatexOptions): Promise<{ pdf?: Uint8Array; error?: string }> {
    const n = sync()
    const tex = toLatex(n, opts)
    const files: Record<string, string | Uint8Array> = { 'note.tex': tex }
    for (const s of n.sections) {
      for (const b of s.blocks) {
        const data = b.kind === 'image' ? assets.current.get(b.path) : undefined
        if (data) files[b.path] = data
      }
    }
    const r = await compileLatex('note.tex', files)
    if (r.pdf) return { pdf: r.pdf }
    return { error: r.errors[0]?.message || 'The note did not typeset.' }
  }

  function exportName(ext: string): string {
    const n = noteRef.current
    const dir = fileRef.current ? path.dirname(fileRef.current) : `${HOME}/Documents`
    const stem = safeName(n.meta.title || (fileRef.current ? stemOf(fileRef.current) : 'Notes'))
    return path.join(dir, stem + ext)
  }

  async function exportPdf(layout?: 'continuous' | 'paged') {
    const target = await os.dialog.saveFile({ title: layout === 'paged' ? 'Export PDF — A4 pages' : 'Export PDF', defaultName: exportName('.pdf'), extensions: ['.pdf'] })
    if (!target) return
    setBusy('Typesetting the PDF…')
    try {
      const r = await compile(latexOptions(layout ? { layout } : {}))
      if (!r.pdf) {
        await os.dialog.alert(r.error ?? 'The note did not typeset.', { title: 'Export PDF' })
        return
      }
      await fs.writeBytes(target, r.pdf, { mkdirs: true })
      os.notify({ title: 'PDF exported', body: path.pretty(target), onClick: () => os.open('khervepdf', { path: target }) })
      os.open('khervepdf', { path: target })
    } finally {
      setBusy('')
    }
  }

  async function exportLatex() {
    const target = await os.dialog.saveFile({ title: 'Export LaTeX', defaultName: exportName('.tex'), extensions: ['.tex'] })
    if (!target) return
    const n = sync()
    await fs.writeText(target, toLatex(n, latexOptions()), { mkdirs: true })
    let pictures = 0
    for (const s of n.sections) {
      for (const b of s.blocks) {
        const data = b.kind === 'image' ? assets.current.get(b.path) : undefined
        if (data) {
          await fs.writeBytes(path.join(path.dirname(target), b.path), data, { mkdirs: true })
          pictures++
        }
      }
    }
    os.notify({ title: 'LaTeX exported', body: `${path.pretty(target)}${pictures ? ` and its assets/ folder (${pictures} picture${pictures > 1 ? 's' : ''})` : ''}` })
  }

  // ---------------------------------------------------------- AI tools

  function describe(n: Note, p: string | null, open: boolean, maxChars: number) {
    const clock = settingsRef.current.clockTimes
    return {
      path: p ? path.pretty(p) : null,
      open,
      unsaved: open ? dirtyRef.current || !p : false,
      title: n.meta.title,
      speaker: n.meta.speaker,
      date: n.meta.date,
      place: n.meta.place,
      summary: n.summary,
      words_of_the_talk: n.meta.vocabulary,
      sections: n.sections.map((s, i) => ({
        index: i,
        title: s.title,
        started: s.t != null ? timeLabel(n, s.t, clock) : undefined,
        paragraphs: s.blocks.map((b, j) => ({
          index: j,
          kind: b.kind === 'typed' ? 'text' : b.kind,
          ...(b.kind === 'item' ? { level: b.level, numbered: b.numbered } : b.kind === 'heading' ? { level: b.level } : {}),
          ...(b.t != null ? { time: timeLabel(n, b.t, clock) } : {}),
          text: clipText(b.text, 2000),
        })),
      })),
      speech_lines: n.transcript.length,
      speech: n.transcript.length ? clipText(n.transcript.map((g) => `[${timeLabel(n, g.t, clock)}] ${g.text}`).join('\n'), maxChars) : '',
    }
  }

  useAppTools(win, {
    list_notes: async (a) => {
      const t = await scan(LIBRARY_ROOT)
      const q = typeof a.query === 'string' ? a.query : ''
      const shown = q.trim() ? filterTree(t, q) : t
      const notes: NoteInfo[] = shown ? allNotes(shown) : []
      return {
        library: path.pretty(LIBRARY_ROOT),
        open: fileRef.current ? path.pretty(fileRef.current) : null,
        count: notes.length,
        notes: notes.slice(0, 200).map((n) => ({ path: path.pretty(n.path), title: labelOf(n), speaker: n.speaker, date: n.date, folder: path.pretty(path.dirname(n.path)) })),
      }
    },
    read_note: async (a) => {
      const max = typeof a.max_chars === 'number' && a.max_chars > 500 ? a.max_chars : 12000
      const wanted = typeof a.path === 'string' && a.path.trim() ? path.resolve(HOME, a.path.trim()) : null
      if (wanted && wanted !== fileRef.current) {
        if (!fs.isFile(wanted)) throw new Error(`There is no note at ${a.path}. khervenote_list_notes lists them.`)
        return describe(readKnote(await fs.readBytes(wanted)).note, wanted, false, max)
      }
      return describe(sync(), fileRef.current, true, max)
    },
    add_text: async (a) => {
      const ed = edRef.current
      if (!ed) throw new Error('KherveNote is not ready yet.')
      const text = String(a.text ?? '')
      if (!text.trim()) throw new Error('"text" is empty.')
      const kindArg = typeof a.kind === 'string' ? a.kind : 'text'
      const kind: BlockKind | null = kindArg === 'important' || kindArg === 'question' || kindArg === 'transcript' ? kindArg : null
      const blocks = markdownBlocks(text).map((b) => (kind && b.kind === 'typed' ? { ...b, kind } : b))
      const title = typeof a.title === 'string' ? a.title.trim() : ''
      const { ranges } = sectionsHere()
      if (title) {
        const nodes: JNode[] = [{ type: 'heading', attrs: { level: 1, t: null }, content: [{ type: 'text', text: title }] }, ...blocksToNodes(blocks)]
        insertNodes(ed, ed.state.doc.content.size, nodes)
        return { added: blocks.length, new_section: title, section: sectionsHere().ranges.length - 1 }
      }
      let index = ranges.length - 1
      if (typeof a.section === 'number') {
        if (a.section < 0 || a.section >= ranges.length) throw new Error(`There is no section ${a.section}: the note has ${ranges.length} (0 to ${ranges.length - 1}).`)
        index = a.section
      }
      insertNodes(ed, ranges[index]?.end ?? ed.state.doc.content.size, blocksToNodes(blocks))
      return { added: blocks.length, section: index, section_title: ranges[index]?.title ?? '' }
    },
    export_pdf: async (a, ctx) => {
      const layout = a.layout === 'paged' || a.layout === 'continuous' ? a.layout : undefined
      const target = typeof a.path === 'string' && a.path.trim() ? path.resolve(HOME, a.path.trim()) : exportName('.pdf')
      const finalTarget = target.toLowerCase().endsWith('.pdf') ? target : `${target}.pdf`
      if (fs.exists(finalTarget) && !(await ctx.confirm(`replace ${path.pretty(finalTarget)}`))) throw new Error('The user did not allow replacing the file.')
      const r = await compile(latexOptions({ ...(layout ? { layout } : {}), showTimes: !!a.show_times, transcript: !!a.transcript }))
      if (!r.pdf) throw new Error(`The note did not typeset: ${r.error}`)
      await fs.writeBytes(finalTarget, r.pdf, { mkdirs: true })
      return { path: path.pretty(finalTarget), bytes: r.pdf.length, layout: layout ?? noteRef.current.meta.layout }
    },
  })

  // ------------------------------------------------------ handlers ref

  h.current = {
    changed,
    selectionChanged,
    editCaption: (pos) => void editCaption(pos),
    openAttachment: (p, n) => void openAttachment(p, n),
    attachmentMenu,
    addPicture,
    dropPaths,
    attachmentChanged,
    leaveNote,
  }

  // --------------------------------------------------------- lifecycle

  const lastArgs = useRef('')
  useEffect(() => {
    const key = JSON.stringify(args ?? {})
    if (key === lastArgs.current) return
    lastArgs.current = key
    if (typeof args.path === 'string' && args.path.toLowerCase().endsWith('.knote')) void openNote(args.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args])

  useEffect(() => {
    win.setCloseGuard(async () => {
      if (!h.current || (await h.current.leaveNote())) return true
      return os.dialog.confirm('The note could not be saved. Close KherveNote anyway?', { title: 'KherveNote', okLabel: 'Close', danger: true })
    })
    return () => win.setCloseGuard(null)
  }, [win])

  useEffect(
    () => () => {
      void listenRef.current?.stop()
      aiRef.current?.abort()
      playSrc.current?.stop()
      void playCtx.current?.close()
      forgetUrls()
    },
    [],
  )

  // Times of day or since the start; maths on or off: redraw the page.
  useEffect(() => {
    if (editor && !editor.isDestroyed) refresh(editor)
  }, [editor, settings.clockTimes, settings.showMath])

  // The listening clock in the status bar.
  useEffect(() => {
    if (!listenStart) return
    const id = window.setInterval(() => setTick((x) => x + 1), 1000)
    return () => window.clearInterval(id)
  }, [listenStart])

  const note = noteRef.current
  const label = note.meta.title.trim() || (filePath ? stemOf(filePath) : 'New note')
  useEffect(() => {
    win.setTitle(`${dirty ? '• ' : ''}${label} — KherveNote`)
  }, [win, dirty, label])

  // ------------------------------------------------------------- menus

  const style = st?.style ?? null
  const ed = editor
  const styleItem = (code: StyleCode): MenuItem => {
    const s = STYLES.find((x) => x.code === code)!
    return { label: s.label, shortcut: s.shortcut, checked: style === code, onClick: () => ed && setStyle(ed, code) }
  }

  const menus: MenuBarMenu[] = [
    {
      label: 'File',
      items: [
        { label: 'New note', icon: FilePlus, shortcut: 'Ctrl+N', onClick: () => void startNewNote() },
        { label: 'New folder…', onClick: () => void newFolder(selectedFolder) },
        { label: 'Open…', shortcut: 'Ctrl+O', onClick: () => void openDialog() },
        '-',
        { label: 'Save', icon: Save, shortcut: 'Ctrl+S', onClick: () => void save() },
        { label: 'Save a copy as…', onClick: () => void saveCopyAs() },
        '-',
        { label: 'Export PDF', icon: FileDown, shortcut: 'Ctrl+E', onClick: () => void exportPdf() },
        { label: 'Export PDF — A4 pages', onClick: () => void exportPdf('paged') },
        { label: 'Export LaTeX…', onClick: () => void exportLatex() },
        '-',
        { label: 'Earlier versions of this note…', onClick: () => void showVersions() },
        { label: 'Deleted notes', onClick: () => void showDeleted() },
        { label: 'Show in Files', disabled: !filePath, onClick: () => filePath && os.open('files', { path: path.dirname(filePath) }) },
        '-',
        { label: 'Close', onClick: () => win.close() },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', icon: Undo2, shortcut: 'Ctrl+Z', disabled: !st?.canUndo, onClick: () => ed?.chain().focus().undo().run() },
        { label: 'Redo', icon: Redo2, shortcut: 'Ctrl+Shift+Z', disabled: !st?.canRedo, onClick: () => ed?.chain().focus().redo().run() },
        '-',
        { label: 'Select all', shortcut: 'Ctrl+A', onClick: () => ed?.chain().focus().selectAll().run() },
      ],
    },
    {
      label: 'Insert',
      items: [
        { label: 'New section', icon: SquarePlus, shortcut: 'Ctrl+Return', onClick: () => ed && newSection(ed) },
        { label: 'Image…', icon: ImageIcon, onClick: () => void insertPicture() },
        { label: 'PDF, Word or PowerPoint document…', icon: FileText, shortcut: 'Ctrl+Shift+A', onClick: () => void insertDocument() },
        '-',
        { label: 'The selected speech, into my notes', disabled: !selected.size, onClick: () => insertSpeech(selectedSegments()) },
      ],
    },
    {
      label: 'Format',
      items: [
        ...(['typed', 'h1', 'h2', 'h3', 'important', 'question', 'transcript'] as StyleCode[]).map(styleItem),
        '-',
        styleItem('bullet'),
        styleItem('numbered'),
        '-',
        { label: 'Bold', icon: Bold, shortcut: 'Ctrl+B', checked: !!st?.bold, onClick: () => ed?.chain().focus().toggleBold().run() },
        { label: 'Italic', icon: Italic, shortcut: 'Ctrl+I', checked: !!st?.italic, onClick: () => ed?.chain().focus().toggleItalic().run() },
        { label: 'Underline', icon: UnderlineIcon, shortcut: 'Ctrl+U', checked: !!st?.underline, onClick: () => ed?.chain().focus().toggleUnderline().run() },
      ],
    },
    {
      label: 'Speech',
      items: [
        { label: listening ? 'Stop listening' : 'Listen', icon: Mic, shortcut: 'Ctrl+L', onClick: () => void toggleListen() },
        '-',
        { label: 'Model', submenu: MODELS.map((m) => ({ label: m.label, checked: settings.model === m.id, onClick: () => setSetting('model', m.id) })) },
        { label: 'Language', submenu: LANGUAGES.map(([code, name]) => ({ label: name, checked: settings.language === code, onClick: () => setSetting('language', code) })) },
        {
          label: 'The speech comes before my notes by…',
          submenu: ([[0, 'None'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes']] as [number, string][]).map(([secs, l]) => ({
            label: l,
            checked: settings.lead === secs,
            onClick: () => setSetting('lead', secs),
          })),
        },
        { label: 'Show the words as they are spoken', checked: settings.preview, onClick: () => setSetting('preview', !settings.preview) },
        '-',
        { label: 'Suggest the words of this talk', onClick: () => suggestVocabulary() },
      ],
    },
    {
      label: 'AI',
      items: [
        { label: 'Rephrase', shortcut: 'Ctrl+Shift+R', disabled: !!aiRun, onClick: rephrase },
        { label: 'Summarise this section', shortcut: 'Ctrl+Alt+S', disabled: !!aiRun, onClick: summariseSection },
        { label: 'Summarise the whole note', disabled: !!aiRun, onClick: summariseNote },
        { label: 'Revise with directions…', shortcut: 'Ctrl+Shift+D', disabled: !!aiRun, onClick: () => void reviseWithDirections() },
        '-',
        { label: 'Fill in my section from the speech', disabled: !!aiRun || !note.transcript.length, onClick: fillSection },
        { label: 'Make notes from the speech', disabled: !!aiRun || !note.transcript.length, onClick: () => void makeNotes() },
        '-',
        { label: 'Choose the model in KherveAI…', onClick: () => os.open('kherveai') },
      ],
    },
    {
      label: 'Export',
      items: [
        { label: 'Continuous page', checked: note.meta.layout === 'continuous', onClick: () => updateNote((n) => (n.meta.layout = 'continuous')) },
        { label: 'A4 pages', checked: note.meta.layout === 'paged', onClick: () => updateNote((n) => (n.meta.layout = 'paged')) },
        '-',
        { label: 'Show times in export', checked: settings.exportTimes, onClick: () => setSetting('exportTimes', !settings.exportTimes) },
        { label: 'Add what was said (transcript) at the end', checked: settings.exportTranscript, onClick: () => setSetting('exportTranscript', !settings.exportTranscript) },
        '-',
        { label: 'Export PDF', shortcut: 'Ctrl+E', onClick: () => void exportPdf() },
        { label: 'Export LaTeX…', onClick: () => void exportLatex() },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Notes panel', checked: settings.notesPanel, onClick: () => setSetting('notesPanel', !settings.notesPanel) },
        { label: 'Speech panel', checked: settings.speechPanel, onClick: () => setSetting('speechPanel', !settings.speechPanel) },
        { label: 'Summary box', checked: showSummary, onClick: () => setShowSummary((v) => !v) },
        '-',
        { label: 'Show times as the time of day', checked: settings.clockTimes, onClick: () => setSetting('clockTimes', !settings.clockTimes) },
        { label: 'Draw the maths', checked: settings.showMath, onClick: () => setSetting('showMath', !settings.showMath) },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Example notes', onClick: () => void examples() },
        { label: 'User manual', icon: HelpCircle, shortcut: 'F1', onClick: () => os.openUrl(MANUAL_URL) },
        { label: 'KherveNote on GitHub', onClick: () => os.openUrl(REPO_URL) },
      ],
    },
  ]
  useEffect(() => {
    win.setMenus(menus)
  })
  useEffect(() => () => win.setMenus(null), [win])

  function suggestVocabulary() {
    const n = sync()
    const extra = suggestWords([plainText({ ...n, transcript: [] })], 30, n.meta.vocabulary)
    if (!extra.length) {
      os.notify({ title: 'No new words', body: 'No acronyms, formulas or names were found in your notes that are not in the list already.' })
      return
    }
    updateNote((x) => (x.meta.vocabulary = mergeWords(x.meta.vocabulary, extra)))
  }

  // ---------------------------------------------------------- shortcuts

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.defaultPrevented) return
    if (e.key === 'F1') {
      e.preventDefault()
      os.openUrl(MANUAL_URL)
      return
    }
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const k = e.key.toLowerCase()
    let handled = true
    if (k === 's' && !e.shiftKey) void save()
    else if (k === 'o' && !e.shiftKey) void openDialog()
    else if (k === 'n' && !e.shiftKey) void startNewNote()
    else if (k === 'e' && !e.shiftKey) void exportPdf()
    else if (k === 'l' && !e.shiftKey) void toggleListen()
    else if (k === 'r' && e.shiftKey) rephrase()
    else if (k === 's' && e.altKey) summariseSection()
    else if (k === 'd' && e.shiftKey) void reviseWithDirections()
    else if (k === 'a' && e.shiftKey) void insertDocument()
    else handled = false
    if (handled) e.preventDefault()
  }

  // ------------------------------------------------------------- render

  const pendingLabel = filePath ? null : note.meta.title.trim() || 'New note — start writing to keep it'
  const listenClock = listenStart ? Math.floor((Date.now() - listenStart) / 1000) : 0
  const aiSeconds = aiRun ? Math.floor((Date.now() - aiRun.started) / 1000) : 0

  return (
    <div className="k-app kn-app" onKeyDown={onKeyDown}>
      <div className="k-toolbar kn-toolbar">
        <button className="k-icon-btn" title="New note (Ctrl+N)" onClick={() => void startNewNote()}>
          <FilePlus size={16} />
        </button>
        <button className="k-icon-btn" title="Save (Ctrl+S) — notes also save themselves" onClick={() => void save()}>
          <Save size={16} />
        </button>
        <span className="k-sep" />
        <button className="k-icon-btn" title="Undo (Ctrl+Z)" disabled={!st?.canUndo} onClick={() => ed?.chain().focus().undo().run()}>
          <Undo2 size={16} />
        </button>
        <button className="k-icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!st?.canRedo} onClick={() => ed?.chain().focus().redo().run()}>
          <Redo2 size={16} />
        </button>
        <span className="k-sep" />
        <select
          className="k-input kn-style"
          value={style ?? ''}
          onChange={(e) => ed && setStyle(ed, e.target.value as StyleCode)}
          title="The style of the paragraph"
        >
          {style === null && <option value="">—</option>}
          {STYLES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
            </option>
          ))}
        </select>
        <button className={`k-icon-btn${st?.bold ? ' active' : ''}`} title="Bold (Ctrl+B)" onClick={() => ed?.chain().focus().toggleBold().run()}>
          <Bold size={16} />
        </button>
        <button className={`k-icon-btn${st?.italic ? ' active' : ''}`} title="Italic (Ctrl+I)" onClick={() => ed?.chain().focus().toggleItalic().run()}>
          <Italic size={16} />
        </button>
        <button className={`k-icon-btn${st?.underline ? ' active' : ''}`} title="Underline (Ctrl+U)" onClick={() => ed?.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon size={16} />
        </button>
        <button className={`k-icon-btn${style === 'bullet' ? ' active' : ''}`} title="Bullets (Ctrl+Shift+8)" onClick={() => ed && setStyle(ed, style === 'bullet' ? 'typed' : 'bullet')}>
          <List size={16} />
        </button>
        <button className={`k-icon-btn${style === 'numbered' ? ' active' : ''}`} title="Numbering (Ctrl+Shift+7)" onClick={() => ed && setStyle(ed, style === 'numbered' ? 'typed' : 'numbered')}>
          <ListOrdered size={16} />
        </button>
        <span className="k-sep" />
        <button className="k-btn small" title="New section (Ctrl+Return)" onClick={() => ed && newSection(ed)}>
          <SquarePlus size={14} /> Section
        </button>
        <button className={`k-icon-btn${style === 'important' ? ' active' : ''}`} title="Key point (Ctrl+Shift+K)" onClick={() => ed && setStyle(ed, style === 'important' ? 'typed' : 'important')}>
          <Star size={16} />
        </button>
        <button className={`k-icon-btn kn-q${style === 'question' ? ' active' : ''}`} title="Question (Ctrl+Shift+Q)" onClick={() => ed && setStyle(ed, style === 'question' ? 'typed' : 'question')}>
          ?
        </button>
        <span className="k-sep" />
        <button className="k-icon-btn" title="Insert an image" onClick={() => void insertPicture()}>
          <ImageIcon size={16} />
        </button>
        <button className="k-icon-btn" title="Attach a PDF, Word or PowerPoint document (Ctrl+Shift+A)" onClick={() => void insertDocument()}>
          <FileText size={16} />
        </button>
        <span className="k-sep" />
        <button className={`k-btn small kn-listen${listening ? ' on' : ''}`} title="Listen on / off (Ctrl+L)" onClick={() => void toggleListen()}>
          {listening ? <Square size={12} /> : <Mic size={14} />} {listening ? 'Stop' : 'Listen'}
        </button>
        <button
          className="k-btn small"
          title="The AI: rephrase, summarise, fill in from the speech"
          disabled={!!aiRun}
          onClick={(e) => os.contextMenu(e, menus.find((m) => m.label === 'AI')!.items)}
        >
          <Sparkles size={14} /> AI
        </button>
        <span className="k-spacer" />
        <button className="k-btn small primary" title="Export PDF (Ctrl+E)" disabled={!!busy} onClick={() => void exportPdf()}>
          {busy ? <Loader2 size={14} className="k-spin" /> : <FileDown size={14} />} PDF
        </button>
      </div>

      <div className="kn-main">
        {settings.notesPanel && (
          <NotesPanel
            tree={tree}
            root={LIBRARY_ROOT}
            openPath={filePath}
            pendingLabel={pendingLabel}
            outline={outline}
            selectedFolder={selectedFolder}
            query={query}
            onQuery={setQuery}
            onOpen={(p) => void openNote(p)}
            onSelectFolder={(p) => {
              setSelectedFolder(p)
              if (!fileRef.current) targetFolder.current = p
            }}
            onNewNote={(f) => void startNewNote(f)}
            onNewFolder={(f) => void newFolder(f)}
            onMove={(src, dest) => void moveTo(src, dest)}
            onGoto={(pos) => {
              if (!ed) return
              const node = ed.state.doc.nodeAt(pos)
              if (!node) return
              ed.chain().focus().setTextSelection(pos + 1).run()
              const dom = ed.view.nodeDOM(pos)
              if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' })
            }}
            onNoteMenu={(e, info) =>
              os.contextMenu(e, [
                { label: 'Open', onClick: () => void openNote(info.path) },
                { label: 'Rename…', onClick: () => void renameNoteOrFolder(info.path) },
                { label: 'Show in Files', onClick: () => os.open('files', { path: path.dirname(info.path) }) },
                '-',
                { label: 'Move to Trash', danger: true, onClick: () => void trash(info.path) },
              ])
            }
            onFolderMenu={(e, f) => {
              const isRoot = f.path === LIBRARY_ROOT
              os.contextMenu(e, [
                { label: 'New note here', onClick: () => void startNewNote(f.path) },
                { label: 'New folder here…', onClick: () => void newFolder(f.path) },
                ...(isRoot
                  ? ([
                      '-',
                      { label: 'Example notes', onClick: () => void examples() },
                      { label: 'Deleted notes', onClick: () => void showDeleted() },
                    ] as MenuItem[])
                  : ([{ label: 'Rename…', onClick: () => void renameNoteOrFolder(f.path) }] as MenuItem[])),
                { label: 'Show in Files', onClick: () => os.open('files', { path: f.path }) },
                ...(isRoot ? [] : (['-', { label: 'Move to Trash', danger: true, onClick: () => void trash(f.path) }] as MenuItem[])),
              ])
            }}
          />
        )}

        <div className="kn-center">
          {aiRun && (
            <div className="kn-aibar">
              <Loader2 size={14} className="k-spin" />
              <span className="kn-aibar-step">
                {aiRun.step}
                {aiRun.model ? ` · ${aiRun.model}` : ''} · {aiSeconds} s
              </span>
              <span className="kn-aibar-text">{aiRun.text.replace(/\s+/g, ' ').slice(-160)}</span>
              <button className="k-btn small" onClick={() => aiRef.current?.abort()}>
                Cancel
              </button>
            </div>
          )}
          <div
            className="kn-scroll"
            onMouseDown={(e) => {
              if (e.target !== e.currentTarget || !ed) return
              e.preventDefault()
              ed.commands.focus('end')
            }}
          >
            <div className="kn-sheet">
              <div className="kn-header">
                <input
                  className="kn-title"
                  placeholder="Title of the talk"
                  value={note.meta.title}
                  onChange={(e) => updateNote((n) => (n.meta.title = e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      ed?.commands.focus('start')
                    }
                  }}
                  spellCheck
                />
                <div className="kn-header-row">
                  <input className="kn-field" placeholder="Speaker" value={note.meta.speaker} onChange={(e) => updateNote((n) => (n.meta.speaker = e.target.value))} />
                  <input className="kn-field kn-date" placeholder="Date" value={note.meta.date} onChange={(e) => updateNote((n) => (n.meta.date = e.target.value))} />
                  <input className="kn-field" placeholder="Place" value={note.meta.place} onChange={(e) => updateNote((n) => (n.meta.place = e.target.value))} />
                </div>
                {(showSummary || note.summary.trim()) && (
                  <div className="kn-summary">
                    <div className="kn-summary-label">Summary</div>
                    <textarea
                      className="kn-summary-text"
                      placeholder="A summary of the talk (AI ▸ Summarise the whole note writes one)"
                      value={note.summary}
                      rows={Math.min(10, Math.max(2, note.summary.split('\n').length + Math.floor(note.summary.length / 90)))}
                      onChange={(e) => updateNote((n) => (n.summary = e.target.value))}
                    />
                  </div>
                )}
              </div>
              <EditorContent editor={editor} className="kn-page" />
            </div>
          </div>
        </div>

        {settings.speechPanel && (
          <SpeechPanel
            segments={note.transcript}
            partial={partial}
            listening={listening}
            status={listenStatus}
            level={level}
            vocabulary={note.meta.vocabulary}
            selected={selected}
            highlight={highlight}
            playable={playable}
            playing={playing}
            timeLabel={(t) => timeLabel(note, t, settings.clockTimes)}
            onListen={() => void toggleListen()}
            onVocabulary={(v) => updateNote((n) => (n.meta.vocabulary = v))}
            onSuggest={suggestVocabulary}
            onSelect={selectLine}
            onTime={(t) => ed && goToTime(ed, t)}
            onCorrect={(i) => void correctLine(i)}
            onMenu={speechMenu}
            onPlay={(i) => void play(i, false)}
            onPause={pausePlaying}
            onStop={stopPlaying}
            onFill={fillSection}
            onNotes={() => void makeNotes()}
            aiBusy={!!aiRun}
          />
        )}
      </div>

      <div className="k-statusbar">
        <span className="kn-status-path">{filePath ? path.pretty(filePath) : 'New note — start writing to keep it'}</span>
        <span>{filePath ? (dirty ? 'Unsaved changes' : 'Saved') : ''}</span>
        <span>
          {words} word{words === 1 ? '' : 's'}
        </span>
        {note.transcript.length > 0 && <span>{note.transcript.length} lines of speech</span>}
        {listening && (
          <span className="kn-rec">
            ● {Math.floor(listenClock / 60)}:{String(listenClock % 60).padStart(2, '0')}
          </span>
        )}
        {busy && <span>{busy}</span>}
      </div>

      {versionList && (
        <div className="kn-modal" onMouseDown={(e) => e.target === e.currentTarget && setVersionList(null)}>
          <div className="kn-modal-card">
            <div className="kn-modal-title">Earlier versions of this note</div>
            <div className="kn-modal-help">A version opens as a copy: the note you have is never changed by it.</div>
            <div className="kn-versions">
              {versionList.map((v) => (
                <div key={v.path} className="kn-version">
                  <div>
                    <div>{v.when.toLocaleString()}</div>
                    <div className="k-muted">{v.title || v.firstLine || 'Untitled'}</div>
                  </div>
                  <button className="k-btn small" onClick={() => void restoreVersion(v)}>
                    Open as a copy
                  </button>
                </div>
              ))}
            </div>
            <div className="kn-modal-buttons">
              <button className="k-btn" onClick={() => setVersionList(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface Handlers {
  changed(edit?: boolean): void
  selectionChanged(): void
  editCaption(pos: number): void
  openAttachment(path: string, name: string): void
  attachmentMenu(e: MouseEvent, pos: number, path: string, name: string): void
  addPicture(file: File): Promise<string | null>
  dropPaths(paths: string[], pos: number): void
  attachmentChanged(p: string): Promise<void>
  leaveNote(): Promise<boolean>
}
