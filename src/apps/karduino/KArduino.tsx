// kArduino — write Arduino sketches (.ino): an editor with C++ highlighting, examples and
// snippets, compile and upload through arduino-cli on the KherveOS server, and a serial
// monitor / plotter for a board plugged in over USB (Chrome or Edge, Web Serial).
// Web Serial cannot flash a board: Upload works when the board is plugged into the computer
// the server runs on.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Cpu, FilePlus, FolderOpen, Play, Plus, Save, Upload, X, Cable } from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu } from '@/os'
import { CodeEditor } from '@/os/ui/CodeEditor'
import { useAppTools } from '@/os/ai/appTools'
import { karduinoTools } from './aiTools'
import { BOARDS, DEFAULT_BOARD, boardByFqbn, boardName, coreOf, familyOf, validFqbn } from './boards'
import { errorCount, type CompileResult, type Diagnostic } from './build'
import { applyMarks, insertAtCursor, installArduinoSupport, jumpTo } from './cpp'
import { EXAMPLES, NEW_SKETCH, SNIPPETS, exampleById, type Example, type Snippet, EXAMPLE_CATEGORIES } from './examples'
import { Problems } from './Problems'
import { PlotBuffer, type Column } from './plotter'
import { detectPins } from './pins'
import { SerialMonitor, serialSupported, type LineEnding } from './serial'
import { SerialPanel, lineText, type LogEntry } from './SerialPanel'
import { Sidebar, type SideTab } from './Sidebar'
import {
  BAUD_RATES, EXTRA_EXTENSIONS, MAX_FILES, MAX_FILE_CHARS, detectBaud, includesOf, BUILTIN_HEADERS, libraryForHeader, safeSketchName, tabNameProblem, tabOf, type SketchFile,
} from './sketch'
import { build, installCore, serverBoards, toolStatus, type ServerBoard, type ToolStatus } from './toolchain'
import { Wiring } from './Wiring'
import './karduino.css'

export const SKETCH_DIR = `${HOME}/Documents/kArduino`
const BOARD_KEY = 'kos.karduino.board'
const MAX_LOG = 2000
const FLUSH_MS = 60

function loadBoard(): string {
  try {
    const v = localStorage.getItem(BOARD_KEY)
    if (v && validFqbn(v)) return v
  } catch { /* storage blocked */ }
  return DEFAULT_BOARD
}

function rememberBoard(b: string) {
  try { localStorage.setItem(BOARD_KEY, b) } catch { /* storage blocked */ }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const starter = (name: string) => (name.endsWith('.h') || name.endsWith('.hpp') ? '#pragma once\n' : name.endsWith('.ino') ? '' : '#include <Arduino.h>\n')

export default function KArduino({ win, args }: AppProps) {
  const first = exampleById('blink')!
  const [name, setName] = useState('blink')
  const [main, setMain] = useState(first.code)
  const [extras, setExtras] = useState<SketchFile[]>([])
  const [active, setActive] = useState(0)
  const [dir, setDir] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [example, setExample] = useState<Example | null>(first)
  const [board, setBoardState] = useState(loadBoard)
  const [customBoard, setCustomBoard] = useState(() => !boardByFqbn(loadBoard()))
  const [serverList, setServerList] = useState<ServerBoard[]>([])
  const [tool, setTool] = useState<ToolStatus | null | undefined>(undefined)
  const [result, setResult] = useState<CompileResult | null>(null)
  const [busy, setBusy] = useState<'compile' | 'upload' | null>(null)
  const [ports, setPorts] = useState<string[]>([])
  const [port, setPort] = useState('')
  const [sideOpen, setSideOpen] = useState(true)
  const [sideTab, setSideTab] = useState<SideTab>('examples')
  const [serialOpen, setSerialOpen] = useState(true)
  const [wiringOpen, setWiringOpen] = useState(false)
  const [libSeed, setLibSeed] = useState({ query: '', n: 0 })
  const [size, setSize] = useState<'s' | 'm' | 'l'>('l')

  // serial
  const [baud, setBaud] = useState(9600)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [view, setView] = useState<'monitor' | 'plotter'>('monitor')
  const [timestamps, setTimestamps] = useState(false)
  const [autoscroll, setAutoscroll] = useState(true)
  const [ending, setEnding] = useState<LineEnding>('nl')
  const [resetDtr, setResetDtr] = useState(true)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [frozen, setFrozen] = useState<{ entries: LogEntry[]; columns: Column[]; total: number } | null>(null)
  const [, setTick] = useState(0)
  const entries = useRef<LogEntry[]>([])
  const plot = useRef(new PlotBuffer())
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const monitor = useRef<SerialMonitor | null>(null)
  const baudManual = useRef(false)

  const root = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const jump = useRef<{ line: number; col: number } | null>(null)

  const stem = name || 'sketch'
  const all: SketchFile[] = useMemo(() => [{ name: `${stem}.ino`, content: main }, ...extras], [stem, main, extras])
  const current = all[Math.min(active, all.length - 1)]
  const family = familyOf(board)
  const report = useMemo(() => detectPins(all.map((f) => f.content).join('\n'), family), [all, family])
  const live = useRef({ dirty, all, board, dir, stem })
  live.current = { dirty, all, board, dir, stem }

  // ------------------------------------------------------------ window, size

  useEffect(() => { win.setTitle(`kArduino — ${stem}.ino${dirty ? ' •' : ''}`) }, [win, stem, dirty])

  useEffect(() => {
    const el = root.current
    if (!el) return
    let firstTime = true
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      setSize(w < 760 ? 's' : w < 1000 ? 'm' : 'l')
      if (firstTime && w > 0) {
        firstTime = false
        setSideOpen(w >= 1000)
        setSerialOpen(w >= 760)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ------------------------------------------------------------ the server

  const refreshTool = useCallback(() => { void toolStatus().then(setTool) }, [])
  useEffect(() => { refreshTool() }, [refreshTool])
  useEffect(() => {
    if (customBoard && !serverList.length) void serverBoards().then(setServerList)
  }, [customBoard, serverList.length])

  const setBoard = useCallback((b: string) => {
    setBoardState(b)
    rememberBoard(b)
    setCustomBoard(!boardByFqbn(b))
  }, [])

  const run = useCallback(async (kind: 'compile' | 'upload'): Promise<CompileResult> => {
    setBusy(kind)
    setResult(null)
    const r = await build(kind, live.current.all, live.current.board, kind === 'upload' && port ? port : undefined)
    setResult(r)
    setBusy(null)
    if (r.ports) setPorts(r.ports.map((p) => p.address))
    if (r.uploaded) os.notify({ title: 'Uploaded', body: `${live.current.stem}.ino to ${r.port ?? 'the board'}` })
    return r
  }, [port])

  const installCoreFor = async (core: string) => {
    if (!(await os.dialog.confirm(`Install the board package “${core}” on the KherveOS server? Downloading it can take a few minutes.`, { title: 'Install board package', okLabel: 'Install' }))) return false
    const r = await installCore(core)
    refreshTool()
    if (!r.ok) await os.dialog.alert(r.output, { title: 'Board package' })
    return r.ok
  }

  // ------------------------------------------------------------ files

  const confirmDiscard = async (): Promise<boolean> => {
    if (!live.current.dirty) return true
    return os.dialog.confirm('This sketch has changes that are not saved. Continue and lose them?', { title: 'Unsaved changes', okLabel: 'Continue', danger: true })
  }

  const fresh = (n: string, code: string, more: SketchFile[], from: string | null, ex: Example | null) => {
    setName(n)
    setMain(code)
    setExtras(more)
    setActive(0)
    setDir(from)
    setDirty(false)
    setExample(ex)
    setResult(null)
    win.setDocumentPath(from ? `${from}/${n}.ino` : null)
  }

  const newSketch = async () => {
    if (!(await confirmDiscard())) return
    fresh('sketch', NEW_SKETCH, [], null, null)
  }

  const loadExample = async (e: Example): Promise<boolean> => {
    if (!(await confirmDiscard())) return false
    fresh(safeSketchName(e.id.replace(/-/g, '_')), e.code, [], null, e)
    setBoard(e.board)
    setWiringOpen(true)
    return true
  }

  /** Load `<folder>/<main>` and the other sketch files next to it. */
  const loadFolder = async (folder: string, mainFile: string) => {
    try {
      const n = safeSketchName(mainFile)
      const code = await fs.readText(`${folder}/${mainFile}`)
      const more: SketchFile[] = []
      for (const s of fs.list(folder)) {
        const ext = path.extname(s.name).toLowerCase()
        if (s.type !== 'file' || s.name === mainFile || !EXTRA_EXTENSIONS.includes(ext) || tabNameProblem(s.name, more.map((f) => f.name), `${n}.ino`)) continue
        if (more.length >= MAX_FILES - 1 || s.size > MAX_FILE_CHARS) continue
        more.push({ name: s.name, content: await fs.readText(s.path) })
      }
      fresh(n, code, more, folder, null)
    } catch (e) {
      await os.dialog.alert(`Could not open the sketch: ${msg(e)}`)
    }
  }

  const openFile = async (p?: string) => {
    if (!p) {
      if (!(await confirmDiscard())) return
      p = (await os.dialog.openFile({ extensions: ['.ino'], startDir: fs.isDir(SKETCH_DIR) ? SKETCH_DIR : undefined })) ?? undefined
    }
    if (!p) return
    const folder = path.dirname(p)
    const file = path.basename(p)
    if (path.basename(folder) === file.replace(/\.ino$/i, '')) await loadFolder(folder, file)
    else {
      try {
        fresh(safeSketchName(file), await fs.readText(p), [], null, null)
      } catch (e) {
        await os.dialog.alert(`Could not open the sketch: ${msg(e)}`)
      }
    }
  }

  const openFolder = async (p?: string) => {
    if (!p) {
      if (!(await confirmDiscard())) return
      p = (await os.dialog.pickFolder({ title: 'Open a sketch folder', startDir: fs.isDir(SKETCH_DIR) ? SKETCH_DIR : undefined })) ?? undefined
    }
    if (!p) return
    const inos = fs.list(p).filter((s) => s.type === 'file' && s.name.toLowerCase().endsWith('.ino')).map((s) => s.name)
    const wanted = `${path.basename(p)}.ino`
    const mainFile = inos.includes(wanted) ? wanted : inos[0]
    if (!mainFile) {
      await os.dialog.alert('There is no .ino file in this folder.')
      return
    }
    await loadFolder(p, mainFile)
  }

  const writeSketch = async (folder: string, n: string): Promise<string> => {
    await fs.mkdir(folder, { recursive: true })
    const files = live.current.all
    await fs.writeText(`${folder}/${n}.ino`, files[0].content)
    for (const f of files.slice(1)) await fs.writeText(`${folder}/${f.name}`, f.content)
    setDir(folder)
    setDirty(false)
    win.setDocumentPath(`${folder}/${n}.ino`)
    os.notify({ title: 'Sketch saved', body: path.pretty(`${folder}/${n}.ino`) })
    return `${folder}/${n}.ino`
  }

  const save = async (): Promise<string> => {
    const { dir: d, stem: s } = live.current
    const folder = d && path.basename(d) === s ? d : `${SKETCH_DIR}/${s}`
    return writeSketch(folder, s)
  }

  const saveAs = async () => {
    const answer = await os.dialog.prompt('Name of the sketch (a folder with this name is made in Documents/kArduino):', { title: 'Save sketch as', defaultValue: live.current.stem, okLabel: 'Save' })
    if (answer === null) return
    const n = safeSketchName(answer)
    const folder = `${SKETCH_DIR}/${n}`
    if (fs.exists(folder) && !(await os.dialog.confirm(`“${n}” already exists. Replace its files?`, { okLabel: 'Replace', danger: true }))) return
    setName(n)
    await writeSketch(folder, n)
  }

  useEffect(() => {
    if (args.path && fs.exists(args.path)) void (fs.isDir(args.path) ? openFolder(args.path) : openFile(args.path))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.path])

  // ------------------------------------------------------------ tabs

  const setContent = (i: number, text: string) => {
    if (i === 0) setMain(text)
    else setExtras((list) => list.map((f, k) => (k === i - 1 ? { ...f, content: text } : f)))
    setDirty(true)
  }

  const addTab = async (preset?: string) => {
    if (all.length >= MAX_FILES) {
      await os.dialog.alert(`A sketch can have ${MAX_FILES} files at most.`)
      return false
    }
    const n = preset ?? (await os.dialog.prompt('Name of the new file (.h, .cpp, .c, .hpp or .ino):', { title: 'New file', defaultValue: 'helpers.h', okLabel: 'Add' }))
    if (n === null || n === undefined) return false
    const bad = tabNameProblem(n.trim(), extras.map((f) => f.name), `${stem}.ino`)
    if (bad) {
      await os.dialog.alert(bad, { title: `“${n}” cannot be used` })
      return false
    }
    setExtras((l) => [...l, { name: n.trim(), content: starter(n.trim()) }])
    setActive(all.length)
    setDirty(true)
    return true
  }

  const renameTab = async (i: number) => {
    if (i === 0) {
      const n = await os.dialog.prompt('Name of the sketch:', { title: 'Rename sketch', defaultValue: stem })
      if (n !== null) { setName(safeSketchName(n)); setDirty(true) }
      return
    }
    const old = all[i].name
    const n = await os.dialog.prompt('New name of the file:', { title: 'Rename file', defaultValue: old })
    if (n === null || n.trim() === old) return
    const bad = tabNameProblem(n.trim(), extras.map((f) => f.name).filter((x) => x !== old), `${stem}.ino`)
    if (bad) {
      await os.dialog.alert(bad, { title: `“${n}” cannot be used` })
      return
    }
    setExtras((l) => l.map((f, k) => (k === i - 1 ? { ...f, name: n.trim() } : f)))
    setDirty(true)
  }

  const deleteTab = async (i: number) => {
    if (i === 0) return
    if (!(await os.dialog.confirm(`Remove “${all[i].name}” from the sketch?`, { okLabel: 'Remove', danger: true }))) return
    setExtras((l) => l.filter((_, k) => k !== i - 1))
    setActive((a) => (a >= i ? Math.max(0, a - 1) : a))
    setDirty(true)
  }

  // ------------------------------------------------------------ editor marks and jumps

  const tabKey = all.map((f) => f.name).join('|')
  useEffect(() => {
    const v = editor.current
    if (!v) return
    const marks = (result?.diagnostics ?? [])
      .filter((d) => !d.external && tabOf(all, d.file) === active)
      .map((d) => ({ line: d.line, severity: d.severity, message: d.message }))
    applyMarks(v, marks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, active, tabKey])

  useEffect(() => {
    const v = editor.current
    if (v && jump.current) {
      jumpTo(v, jump.current.line, jump.current.col)
      jump.current = null
    }
  }, [active])

  const goTo = (d: Diagnostic) => {
    if (d.external) return
    const i = tabOf(all, d.file)
    if (i < 0) return
    if (i === active && editor.current) jumpTo(editor.current, d.line, d.col)
    else {
      jump.current = { line: d.line, col: d.col }
      setActive(i)
    }
  }

  const insertSnippet = (s: Snippet) => {
    const v = editor.current
    if (v) insertAtCursor(v, s.code)
  }

  // ------------------------------------------------------------ serial

  const schedule = () => {
    if (flushTimer.current) return
    flushTimer.current = setTimeout(() => { flushTimer.current = null; setTick((n) => n + 1) }, FLUSH_MS)
  }

  useEffect(() => {
    monitor.current = new SerialMonitor(
      (text, t) => {
        entries.current.push({ t, text })
        if (entries.current.length > MAX_LOG) entries.current.splice(0, entries.current.length - MAX_LOG)
        plot.current.pushLine(text)
        schedule()
      },
      (isOpen, why) => { setOpen(isOpen); setNote(why ?? null) },
    )
    return () => {
      void monitor.current?.close()
      monitor.current = null
      if (flushTimer.current) clearTimeout(flushTimer.current)
    }
  }, [])

  useEffect(() => {
    const b = detectBaud(main)
    if (b && BAUD_RATES.includes(b) && !baudManual.current && !open) setBaud(b)
  }, [main, open])

  const connect = async () => {
    setNote(null)
    try {
      await monitor.current?.open(baud, resetDtr)
    } catch (e) {
      setNote(msg(e))
    }
  }

  const sendLine = async (text: string, end: LineEnding = ending) => {
    try {
      await monitor.current?.send(text, end)
      entries.current.push({ t: Date.now(), text, tx: true })
      schedule()
    } catch (e) {
      setNote(msg(e))
    }
  }

  const clearSerial = () => {
    entries.current = []
    plot.current.clear()
    setFrozen((f) => (f ? { entries: [], columns: [], total: 0 } : f))
    setTick((n) => n + 1)
  }

  const togglePause = () => {
    setFrozen((f) => (f ? null : { entries: [...entries.current], columns: plot.current.columns(), total: plot.current.total }))
  }

  const copyLog = async () => {
    const text = entries.current.map((e) => lineText(e, timestamps)).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      os.notify({ title: 'Serial log copied', body: `${entries.current.length} lines` })
    } catch {
      await os.dialog.alert('The browser would not let kArduino copy: use Save log instead.')
    }
  }

  const saveLog = async () => {
    const p = await os.dialog.saveFile({ defaultName: 'serial-log.txt', extensions: ['.txt', '.log'], startDir: SKETCH_DIR })
    if (!p) return
    await fs.writeText(p, entries.current.map((e) => lineText(e, timestamps)).join('\n') + '\n', { mkdirs: true })
    os.notify({ title: 'Serial log saved', body: path.pretty(p) })
  }

  const saveCsv = async () => {
    const p = await os.dialog.saveFile({ defaultName: 'plot.csv', extensions: ['.csv'], startDir: SKETCH_DIR })
    if (!p) return
    await fs.writeText(p, plot.current.toCsv(), { mkdirs: true })
    os.notify({ title: 'Plot saved', body: path.pretty(p) })
  }

  const showSerial = (v: 'monitor' | 'plotter') => { setView(v); setSerialOpen(true) }

  // ------------------------------------------------------------ AI tools

  useAppTools(win, karduinoTools({
    get: () => ({ name: stem, board, code: main, files: all.map((f) => f.name), lines: entries.current.slice(-50).map((e) => e.text), open, dirty }),
    setCode: (c: string) => { setMain(c); setActive(0); setDirty(true) },
    compile: () => run('compile'),
    save: () => save(),
    send: (text: string) => sendLine(text),
    examples: () => EXAMPLES.map((e) => ({ id: e.id, title: e.title, category: e.category, description: e.description })),
    loadExample: async (id: string) => {
      const e = exampleById(id)
      if (!e) throw new Error(`No example “${id}”: call load_example without an id to list them.`)
      return { loaded: await loadExample(e), title: e.title, board: e.board, libraries: e.libraries, wiring: e.wiring }
    },
    upload: () => run('upload'),
    setBoard: (b: string) => {
      const found = BOARDS.find((x) => x.fqbn === b || x.id === b.toLowerCase() || x.name.toLowerCase() === b.toLowerCase())
      const fqbn = found?.fqbn ?? b
      if (!validFqbn(fqbn)) throw new Error(`“${b}” is not a board: use a name such as “Arduino Uno” or a full name like arduino:avr:uno.`)
      setBoard(fqbn)
      return fqbn
    },
    addFile: async (n: string, content: string) => {
      const bad = tabNameProblem(n, extras.map((f) => f.name), `${stem}.ino`)
      if (bad) throw new Error(`“${n}” cannot be used: ${bad}`)
      if (all.length >= MAX_FILES) throw new Error(`A sketch can have ${MAX_FILES} files at most.`)
      if (content.length > MAX_FILE_CHARS) throw new Error('The file is too big.')
      setExtras((l) => [...l, { name: n, content }])
      setDirty(true)
    },
  }))

  // ------------------------------------------------------------ close guard, keys, menus

  useEffect(() => {
    win.setCloseGuard(async () => {
      if (!live.current.dirty) return true
      const choice = await os.dialog.choose(
        `Save the changes to “${live.current.stem}.ino” before closing?`,
        [
          { label: 'Cancel', value: 'cancel' },
          { label: "Don't save", value: 'discard', danger: true },
          { label: 'Save', value: 'save', primary: true },
        ],
        { title: 'Unsaved changes' },
      )
      if (choice === 'save') {
        try { await save(); return true } catch { return false }
      }
      return choice === 'discard'
    })
    return () => win.setCloseGuard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 'r' && !e.shiftKey) { e.preventDefault(); void run('compile') }
    else if (k === 'u' && !e.shiftKey) { e.preventDefault(); void run('upload') }
    else if (k === 's') { e.preventDefault(); void (e.shiftKey ? saveAs() : save()) }
    else if (k === 'm' && e.shiftKey) { e.preventDefault(); showSerial('monitor') }
  }

  useEffect(() => {
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New', icon: FilePlus, onClick: () => void newSketch() },
          { label: 'Open…', icon: FolderOpen, onClick: () => void openFile() },
          { label: 'Open sketch folder…', onClick: () => void openFolder() },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => void save() },
          { label: 'Save As…', shortcut: '⇧⌘S', onClick: () => void saveAs() },
          '-',
          { label: 'Close', onClick: () => win.close() },
        ],
      },
      {
        label: 'Sketch',
        items: [
          { label: 'Compile', icon: Play, shortcut: '⌘R', disabled: busy !== null, onClick: () => void run('compile') },
          { label: 'Upload', icon: Upload, shortcut: '⌘U', disabled: busy !== null, onClick: () => void run('upload') },
          '-',
          {
            label: 'Examples',
            icon: BookOpen,
            submenu: EXAMPLE_CATEGORIES.map((c) => ({
              label: c,
              submenu: EXAMPLES.filter((e) => e.category === c).map((e) => ({ label: e.title, checked: example?.id === e.id, onClick: () => void loadExample(e) })),
            })),
          },
          { label: 'Insert snippet', submenu: SNIPPETS.map((s) => ({ label: s.title, onClick: () => insertSnippet(s) })) },
          '-',
          { label: 'Add file…', icon: Plus, onClick: () => void addTab() },
        ],
      },
      {
        label: 'Tools',
        items: [
          {
            label: 'Board',
            icon: Cpu,
            submenu: [
              ...BOARDS.map((b) => ({ label: b.name, checked: board === b.fqbn, onClick: () => setBoard(b.fqbn) })),
              '-' as const,
              {
                label: 'Other…',
                checked: customBoard,
                onClick: () => {
                  setCustomBoard(true)
                  void os.dialog.prompt('Full board name (fqbn), e.g. arduino:avr:uno:', { title: 'Board', defaultValue: board }).then((v) => { if (v && validFqbn(v.trim())) setBoard(v.trim()) })
                },
              },
            ],
          },
          '-',
          { label: 'Serial monitor', icon: Cable, shortcut: '⇧⌘M', onClick: () => showSerial('monitor') },
          { label: 'Serial plotter', onClick: () => showSerial('plotter') },
          '-',
          { label: 'Manage libraries…', onClick: () => { setSideOpen(true); setSideTab('libraries') } },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Examples and libraries', checked: sideOpen, onClick: () => setSideOpen((v) => !v) },
          { label: 'Serial panel', checked: serialOpen, onClick: () => setSerialOpen((v) => !v) },
          { label: 'Wiring and pins', checked: wiringOpen, onClick: () => setWiringOpen((v) => !v) },
        ],
      },
    ]
    win.setMenus(menus)
  })

  // ------------------------------------------------------------ render

  const lastError = result && !result.ok && errorCount(result.diagnostics) > 0
  const needed = useMemo(() => {
    const names = [...(example?.libraries ?? [])]
    const mine = new Set(all.map((f) => f.name.replace(/\.\w+$/, '')))
    for (const f of all) {
      for (const inc of includesOf(f.content)) {
        const lib = libraryForHeader(inc)
        if (BUILTIN_HEADERS.includes(inc) || inc.includes('/') || mine.has(inc) || names.some((n) => n.toLowerCase() === lib.toLowerCase())) continue
        names.push(lib)
      }
    }
    return names
  }, [all, example])
  const missingCore = tool?.cli && !tool.cores.some((c) => c.id === coreOf(board))
  const columns: Column[] = frozen ? frozen.columns : plot.current.columns()
  const logEntries = frozen ? frozen.entries : entries.current
  const gridCols = size === 's' ? undefined : [sideOpen ? '210px' : '', 'minmax(0, 1fr)', serialOpen ? '340px' : ''].filter(Boolean).join(' ')

  return (
    <div className="k-app ka-app" ref={root} data-size={size} onKeyDown={onKeyDown}>
      <div className="k-toolbar ka-toolbar">
        <button className="k-icon-btn" aria-label="New sketch" title="New" onClick={() => void newSketch()}><FilePlus size={14} /></button>
        <button className="k-icon-btn" aria-label="Open sketch" title="Open…" onClick={() => void openFile()}><FolderOpen size={14} /></button>
        <button className="k-icon-btn" aria-label="Save sketch" title="Save (⌘S)" onClick={() => void save()}><Save size={14} /></button>
        <span className="k-sep" />
        <label className="ka-field">Sketch
          <input className="k-input ka-name" value={name} onChange={(e) => { setName(e.target.value.replace(/[^A-Za-z0-9_-]/g, '_')); setDirty(true) }} aria-label="Sketch name" />
        </label>
        <label className="ka-field">Board
          <select
            className="k-input ka-boardsel"
            value={customBoard ? '__other' : board}
            onChange={(e) => (e.target.value === '__other' ? setCustomBoard(true) : setBoard(e.target.value))}
            aria-label="Board"
          >
            {BOARDS.map((b) => <option key={b.fqbn} value={b.fqbn}>{b.name}</option>)}
            <option value="__other">Other…</option>
          </select>
        </label>
        {customBoard && (
          <>
            <input
              className="k-input ka-board" value={board} list="ka-boards" spellCheck={false} aria-label="Board (fully qualified name)" placeholder="vendor:arch:board"
              onChange={(e) => { setBoardState(e.target.value); if (validFqbn(e.target.value)) rememberBoard(e.target.value) }}
            />
            <datalist id="ka-boards">{serverList.map((b) => <option key={b.fqbn} value={b.fqbn}>{b.name}</option>)}</datalist>
          </>
        )}
        <span className="k-sep" />
        <button className="k-btn primary" disabled={busy !== null || !validFqbn(board)} onClick={() => void run('compile')} title="Compile (⌘R)"><Play size={13} /> {busy === 'compile' ? 'Compiling…' : 'Compile'}</button>
        <button className="k-btn" disabled={busy !== null || !validFqbn(board)} onClick={() => void run('upload')} title="Upload to a board plugged into the server's computer (⌘U)"><Upload size={13} /> {busy === 'upload' ? 'Uploading…' : 'Upload'}</button>
        {ports.length > 1 && (
          <select className="k-input ka-port" value={port} onChange={(e) => setPort(e.target.value)} aria-label="Port of the board on the server">
            <option value="">Port: automatic</option>
            {ports.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <span className="k-spacer" />
        <button className={`k-icon-btn${sideOpen ? ' active' : ''}`} aria-label="Examples and libraries" title="Examples, snippets and libraries" onClick={() => setSideOpen((v) => !v)}><BookOpen size={14} /></button>
        <button className={`k-icon-btn${serialOpen ? ' active' : ''}`} aria-label="Serial panel" title="Serial monitor and plotter" onClick={() => setSerialOpen((v) => !v)}><Cable size={14} /></button>
      </div>

      {missingCore && (
        <div className="ka-banner">
          The KherveOS server has no board package for <b>{coreOf(board)}</b>: compiling will fail.
          <button className="k-btn small" onClick={() => void installCoreFor(coreOf(board))}>Install {coreOf(board)}</button>
        </div>
      )}

      <div className="ka-body" style={gridCols ? { gridTemplateColumns: gridCols } : undefined}>
        {sideOpen && (
          <Sidebar
            tab={sideTab} onTab={setSideTab} current={example?.id ?? null}
            onExample={(e) => void loadExample(e)} onSnippet={insertSnippet}
            needed={needed} seed={libSeed}
          />
        )}

        <section className="ka-edit">
          <div className="ka-filetabs" role="tablist">
            {all.map((f, i) => (
              <div key={f.name} role="tab" aria-selected={i === active} className={`ka-filetab${i === active ? ' on' : ''}`}>
                <button className="ka-filetab-name" onClick={() => setActive(i)} onDoubleClick={() => void renameTab(i)} title={i === 0 ? 'The main sketch file (double-click to rename the sketch)' : 'Double-click to rename'}>{f.name}</button>
                {i > 0 && <button className="ka-filetab-x" aria-label={`Remove ${f.name}`} onClick={() => void deleteTab(i)}><X size={11} /></button>}
              </div>
            ))}
            <button className="k-icon-btn ka-addtab" aria-label="Add a file" title="Add a file (.h, .cpp…)" onClick={() => void addTab()}><Plus size={13} /></button>
          </div>
          <div className="ka-editor">
            <CodeEditor
              value={current.content}
              language="plain"
              lineNumbers
              fontSize={13}
              onChange={(v) => { if (v !== current.content) setContent(active, v) }}
              onReady={(v) => { editor.current = v; installArduinoSupport(v) }}
            />
          </div>
          <Wiring
            open={wiringOpen} onToggle={() => setWiringOpen((v) => !v)} example={example} report={report} family={family} boardName={boardName(board)}
            onLibrary={(l) => { setSideOpen(true); setSideTab('libraries'); setLibSeed((s) => ({ query: l, n: s.n + 1 })) }}
          />
          <Problems result={result} busy={busy} onJump={goTo} />
        </section>

        {serialOpen && (
          <SerialPanel
            supported={serialSupported()} open={open} baud={baud} onBaud={(n) => { baudManual.current = true; setBaud(n) }}
            resetDtr={resetDtr} onResetDtr={setResetDtr} onConnect={() => void connect()} onDisconnect={() => void monitor.current?.close()} note={note}
            view={view} onView={setView} entries={logEntries} columns={columns} total={frozen ? frozen.total : plot.current.total}
            timestamps={timestamps} onTimestamps={setTimestamps} autoscroll={autoscroll} onAutoscroll={setAutoscroll}
            paused={frozen !== null} onPause={togglePause} ending={ending} onEnding={setEnding}
            onSend={(t) => { if (t.length || ending !== 'none') void sendLine(t) }} onClear={clearSerial} onCopy={() => void copyLog()} onSave={() => void saveLog()} onSaveCsv={() => void saveCsv()}
            hidden={hidden}
            onToggleSeries={(n) => setHidden((h) => { const s = new Set(h); if (s.has(n)) s.delete(n); else s.add(n); return s })}
          />
        )}
      </div>

      <div className="k-statusbar">
        <span>{dir ? path.pretty(dir) : 'Not saved yet'}</span>
        <span>{dirty ? 'Edited' : ''}</span>
        <span style={{ marginLeft: 'auto' }}>{boardName(board)}</span>
        <span title={tool?.cli ? 'arduino-cli on the KherveOS server' : undefined}>
          {tool === undefined ? 'Checking the toolchain…' : tool === null ? 'Server not reachable or not signed in' : tool.cli ? `arduino-cli ${tool.version ?? ''}` : 'arduino-cli is missing on the server'}
        </span>
        {lastError && <span className="ka-status-bad">{errorCount(result.diagnostics)} error{errorCount(result.diagnostics) > 1 ? 's' : ''}</span>}
      </div>
    </div>
  )
}
