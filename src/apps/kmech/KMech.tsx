// kMech — mechanisms: three workbenches (linkages, cams, gears) in one window. Files are .kmech
// ({format:"kmech", version:1, workbench, model}). Each workbench keeps its own document, so switching tabs loses nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Cog, FilePlus, FolderOpen, Redo2, Save, Undo2, Waypoints, Disc3, Settings2 } from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu } from '@/os'
import type { MenuItem } from '@/os/ui/Menu'
import { useAppTools } from '@/os/ai/appTools'
import { exampleFolderPath, groupExamples, seedExampleFolder, type ExampleFile } from '@/os/exampleFiles'
import { kmechTools, type Hooks } from './aiTools'
import CamBench from './CamBench'
import { docName, emptyDoc, KMechFileError, parseKMech, serializeKMech, WORKBENCHES, type CamDoc, type GearDoc, type KMechDoc, type LinkageDoc, type Workbench } from './doc'
import { EXAMPLES } from './examples'
import { KMECH_EXAMPLES_FOLDER } from './exampleFiles'
import GearBench from './GearBench'
import { History } from './history'
import { loadRecent, pushRecent, safeName } from './io'
import LinkageBench from './LinkageBench'
import { buildReport } from './report'
import type { Shell } from './shell'
import './kmech.css'

const DIR = `${HOME}/Documents/kMech`
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface Slot {
  history: History<KMechDoc>
  saved: KMechDoc
  path: string | null
}

const slotOf = (doc: KMechDoc, p: string | null = null): Slot => ({ history: new History<KMechDoc>(doc), saved: doc, path: p })

/** The first documents: a worked example in each workbench, so there is something moving on the first screen. */
function starter(w: Workbench): KMechDoc {
  const id = w === 'linkage' ? 'crank-rocker' : w === 'cam' ? 'cam-345' : 'gear-pair'
  const e = EXAMPLES.find((x) => x.id === id)
  return e ? parseKMech(serializeKMech(e.doc)) : emptyDoc(w)
}

const ICONS = { linkage: Waypoints, cam: Disc3, gear: Cog } as const

export default function KMech({ win, args }: AppProps) {
  const slotsRef = useRef<Record<Workbench, Slot> | null>(null)
  if (!slotsRef.current) slotsRef.current = { linkage: slotOf(starter('linkage')), cam: slotOf(starter('cam')), gear: slotOf(starter('gear')) }
  const slots = slotsRef as { current: Record<Workbench, Slot> }
  const [active, setActive] = useState<Workbench>('linkage')
  const [, bump] = useState(0)
  const rerender = useCallback(() => bump((n) => n + 1), [])
  const [docSeq, setDocSeq] = useState(0)
  const [status, setStatus] = useState('')
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [exampleFiles, setExampleFiles] = useState<ExampleFile[]>([])
  const [width, setWidth] = useState(1100)
  const root = useRef<HTMLDivElement>(null)

  const slot = slots.current[active]
  const doc = slot.history.value
  const dirty = (w: Workbench) => slots.current[w].history.value !== slots.current[w].saved
  const anyDirty = () => (['linkage', 'cam', 'gear'] as Workbench[]).some(dirty)
  const live = useRef({ active, status })
  live.current = { active, status }

  useEffect(() => {
    let alive = true
    void seedExampleFolder({ app: 'kmech', folderName: KMECH_EXAMPLES_FOLDER, fs }).then((files) => alive && setExampleFiles(files))
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ------------------------------------------------------------ document

  const cur = () => slots.current[live.current.active]
  const commit = useCallback((model: unknown) => {
    const s = cur()
    s.history.commit({ workbench: s.history.value.workbench, model } as KMechDoc)
    rerender()
  }, [rerender])
  const begin = useCallback(() => { cur().history.begin() }, [])
  const preview = useCallback((model: unknown) => {
    const s = cur()
    s.history.preview({ workbench: s.history.value.workbench, model } as KMechDoc)
    rerender()
  }, [rerender])
  const end = useCallback(() => { cur().history.end(); rerender() }, [rerender])

  const undo = () => { if (cur().history.undo()) rerender() }
  const redo = () => { if (cur().history.redo()) rerender() }

  const confirmDiscard = async (w: Workbench): Promise<boolean> => {
    if (!dirty(w)) return true
    return os.dialog.confirm(`The ${WORKBENCHES.find((x) => x.id === w)!.name.toLowerCase()} document has changes that are not saved. Continue and lose them?`, { title: 'Unsaved changes', okLabel: 'Continue', danger: true })
  }

  const place = useCallback((next: KMechDoc, p: string | null) => {
    const s = slots.current[next.workbench]
    s.history.reset(next)
    s.saved = next
    s.path = p
    setActive(next.workbench)
    live.current.active = next.workbench
    win.setDocumentPath(p)
    setDocSeq((n) => n + 1)
    rerender()
  }, [rerender, win])

  const replace = useCallback(async (next: KMechDoc): Promise<void> => {
    if (!(await confirmDiscard(next.workbench))) return
    place(next, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place])

  const openPath = useCallback(async (p: string) => {
    try {
      const d = parseKMech(await fs.readText(p))
      if (!(await confirmDiscard(d.workbench))) return
      place(d, /\.kmech$/i.test(p) ? p : null)
      setRecent(pushRecent(p))
    } catch (e) {
      await os.dialog.alert(`Could not open “${path.basename(p)}”: ${e instanceof KMechFileError ? e.message : msgOf(e)}`, { title: 'Open' })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place])

  useEffect(() => {
    if (typeof args.path === 'string' && fs.exists(args.path)) void openPath(args.path)
    else if (typeof args.text === 'string' && args.text.trim()) {
      try { place(parseKMech(args.text), null) } catch (e) { void os.dialog.alert(msgOf(e), { title: 'Open' }) }
    } else if (args.workbench === 'cam' || args.workbench === 'gear' || args.workbench === 'linkage') setActive(args.workbench)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.path, args.text, args.workbench])

  const newDoc = async (w: Workbench) => {
    if (!(await confirmDiscard(w))) return
    place(emptyDoc(w), null)
  }

  const openDialog = async () => {
    const p = await os.dialog.openFile({ extensions: ['.kmech'], startDir: fs.isDir(DIR) ? DIR : undefined })
    if (p) await openPath(p)
  }

  const write = async (p: string, d: KMechDoc) => {
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeText(p, serializeKMech(d))
    const s = slots.current[d.workbench]
    s.path = p
    s.saved = d
    if (live.current.active === d.workbench) win.setDocumentPath(p)
    setRecent(pushRecent(p))
    rerender()
  }

  const saveAs = async (): Promise<boolean> => {
    const d = cur().history.value
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName: `${safeName(docName(d))}.kmech`, extensions: ['.kmech'], startDir: DIR })
    if (!p) return false
    const target = /\.kmech$/i.test(p) ? p : `${p}.kmech`
    // the name inside the file follows the file name, like the other apps
    const name = path.basename(target).replace(/\.kmech$/i, '')
    const renamed = { workbench: d.workbench, model: { ...d.model, name } } as KMechDoc
    cur().history.commit(renamed)
    await write(target, renamed)
    os.notify({ title: 'Saved', body: path.pretty(target) })
    return true
  }

  const save = async (): Promise<boolean> => {
    const s = cur()
    if (!s.path) return saveAs()
    await write(s.path, s.history.value)
    os.notify({ title: 'Saved', body: path.pretty(s.path) })
    return true
  }

  const saveFile = async (defaultName: string, ext: string, data: string | Uint8Array): Promise<string | null> => {
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName, extensions: [ext], startDir: DIR })
    if (!p) return null
    const target = p.toLowerCase().endsWith(ext) ? p : `${p}${ext}`
    await fs.mkdir(path.dirname(target), { recursive: true })
    if (typeof data === 'string') await fs.writeText(target, data)
    else await fs.writeBytes(target, data)
    os.notify({ title: 'Saved', body: path.pretty(target) })
    return target
  }

  const openInKplot = (text: string, name: string) => {
    try { os.open('kplot', { text, name }) } catch (e) { void os.dialog.alert(`kPlot could not be opened: ${msgOf(e)}`, { title: 'kPlot' }) }
  }

  const report = async () => {
    try { await saveFile(`${safeName(docName(cur().history.value))}-report.md`, '.md', buildReport(cur().history.value)) } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Report' }) }
  }

  const copyReport = async () => {
    try { await navigator.clipboard.writeText(buildReport(cur().history.value)); os.notify({ title: 'Report copied', body: 'The Markdown report is on the clipboard.' }) } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Report' }) }
  }

  // ------------------------------------------------------------ window

  const title = `kMech — ${docName(doc)}${dirty(active) ? ' •' : ''}`
  const docPath = slots.current[active].path
  useEffect(() => { win.setTitle(title) }, [win, title])
  useEffect(() => { win.setDocumentPath(docPath) }, [win, docPath, active])

  useEffect(() => {
    win.setCloseGuard(async () => {
      for (const w of ['linkage', 'cam', 'gear'] as Workbench[]) {
        if (!dirty(w)) continue
        const d = slots.current[w].history.value
        const choice = await os.dialog.choose(
          `Save the changes to “${docName(d)}” (${WORKBENCHES.find((x) => x.id === w)!.name.toLowerCase()}) before closing?`,
          [{ label: 'Cancel', value: 'cancel' }, { label: "Don't save", value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }],
          { title: 'Unsaved changes' },
        )
        if (choice === 'cancel' || choice === undefined) return false
        if (choice === 'save') {
          setActive(w)
          live.current.active = w
          try { if (!(await save())) return false } catch { return false }
        }
      }
      return true
    })
    return () => win.setCloseGuard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win])

  // ------------------------------------------------------------ menus the workbenches share

  const openExampleFile = (f: ExampleFile) => void (async () => {
    try {
      const d = parseKMech(await fs.readText(f.path))
      if (!(await confirmDiscard(d.workbench))) return
      place(d, null)
    } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Open example' }) }
  })()

  const shellVersion = `${anyDirty()}|${cur().history.canUndo}|${cur().history.canRedo}|${exampleFiles.length}|${recent.join(',')}|${slot.path}|${active}`
  const versionNum = useMemo(() => shellVersion.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7), [shellVersion])

  const fileMenu = (exports: MenuItem[]): MenuBarMenu => {
    const groups = groupExamples(exampleFiles)
    const exampleItems: MenuItem[] = groups.length > 1 || groups[0]?.group
      ? groups.map((g) => ({ label: g.group || 'Other', submenu: g.files.map((f) => ({ label: f.title, onClick: () => openExampleFile(f) })) }))
      : exampleFiles.map((f) => ({ label: f.title, onClick: () => openExampleFile(f) }))
    return {
      label: 'File',
      items: [
        { label: 'New linkage', icon: FilePlus, shortcut: '⌘N', onClick: () => void newDoc('linkage') },
        { label: 'New cam', onClick: () => void newDoc('cam') },
        { label: 'New gears', onClick: () => void newDoc('gear') },
        { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void openDialog() },
        { label: 'Open Recent', disabled: recent.length === 0, submenu: recent.map((p) => ({ label: path.basename(p), onClick: () => void openPath(p) })) },
        { label: 'Open Example', icon: BookOpen, disabled: exampleFiles.length === 0, submenu: exampleItems },
        { label: 'Open Examples Folder', onClick: () => void seedExampleFolder({ app: 'kmech', folderName: KMECH_EXAMPLES_FOLDER, fs }).then((files) => { setExampleFiles(files); os.open('files', { path: exampleFolderPath(KMECH_EXAMPLES_FOLDER) }) }) },
        '-',
        { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => void save().catch((e) => os.dialog.alert(msgOf(e))) },
        { label: 'Save As…', shortcut: '⇧⌘S', onClick: () => void saveAs().catch((e) => os.dialog.alert(msgOf(e))) },
        '-',
        { label: 'Export', submenu: [...exports, ...(exports.length ? ['-' as const] : []), { label: 'Report (Markdown)…', onClick: () => void report() }, { label: 'Copy report', onClick: () => void copyReport() }] },
        '-',
        { label: 'Close', shortcut: '⌘W', onClick: () => win.close() },
      ],
    }
  }
  const editMenu = (extra: MenuItem[]): MenuBarMenu => ({
    label: 'Edit',
    items: [
      { label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: !cur().history.canUndo, onClick: undo },
      { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: !cur().history.canRedo, onClick: redo },
      ...(extra.length ? ['-' as const, ...extra] : []),
    ],
  })
  const helpMenu = (shortcuts: string, how: string): MenuBarMenu => ({
    label: 'Help',
    items: [
      { label: 'Keyboard shortcuts', icon: Settings2, onClick: () => void os.dialog.alert(shortcuts, { title: 'kMech shortcuts' }) },
      { label: 'How to use this workbench', onClick: () => void os.dialog.alert(how, { title: 'kMech' }) },
      { label: 'About kMech', onClick: () => void os.dialog.alert(ABOUT, { title: 'kMech' }) },
    ],
  })

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement
    const typing = !!target.closest('input, textarea, select')
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (!mod || e.altKey) return
    if (k === 's') { e.preventDefault(); void (e.shiftKey ? saveAs() : save()).catch((x) => os.dialog.alert(msgOf(x))); return }
    if (k === 'o') { e.preventDefault(); void openDialog(); return }
    if (k === 'n') { e.preventDefault(); void newDoc(active); return }
    if (typing) return
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() } else if (k === 'y') { e.preventDefault(); redo() }
  }

  // ------------------------------------------------------------ AI tools

  const hooks: Hooks = {
    state: () => ({ doc: cur().history.value, dirty: dirty(live.current.active), path: cur().path }),
    load: (d, p) => { place(d, p ?? null) },
  }
  useAppTools(win, kmechTools(hooks))

  // ------------------------------------------------------------ render

  const size = width < 900 ? 's' : width < 1150 ? 'm' : 'l'
  const shellFor = <M,>(): Shell<M> => ({
    win,
    model: doc.model as unknown as M,
    name: docName(doc),
    path: slot.path,
    dirty: dirty(active),
    commit: commit as (m: M) => void,
    begin,
    preview: preview as (m: M) => void,
    end,
    replace,
    say: setStatus,
    version: versionNum,
    docId: docSeq,
    fileMenu,
    editMenu,
    helpMenu,
    saveFile,
    openInKplot,
    compact: size === 's',
  })

  return (
    <div className="k-app mc-app" ref={root} tabIndex={-1} data-size={size} onKeyDown={onKeyDown}>
      <div className="mc-tabs" role="tablist" aria-label="Workbench">
        {WORKBENCHES.map((w) => {
          const Icon = ICONS[w.id]
          return (
            <button key={w.id} role="tab" aria-selected={active === w.id} className={active === w.id ? 'on' : ''} onClick={() => { setActive(w.id); setStatus('') }}>
              <Icon size={14} /> {w.name}{dirty(w.id) ? ' •' : ''}
            </button>
          )
        })}
        <span className="mc-doc">{docName(doc)}{slot.path ? ` — ${path.pretty(slot.path)}` : ''}</span>
      </div>
      {doc.workbench === 'linkage' && <LinkageBench key="linkage" shell={shellFor<LinkageDoc>()} />}
      {doc.workbench === 'cam' && <CamBench key="cam" shell={shellFor<CamDoc>()} />}
      {doc.workbench === 'gear' && <GearBench key="gear" shell={shellFor<GearDoc>()} />}
      <div className="k-statusbar">
        <span className="mc-status-mid">{status || 'Ready'}</span>
        <span className="k-spacer" />
        <span>{WORKBENCHES.find((w) => w.id === active)!.name}</span>
      </div>
    </div>
  )
}

const ABOUT = [
  'kMech designs mechanisms: planar linkages (an exact constraint solver for positions, velocities and accelerations; Grashof classes, coupler curves, transmission angle, quick-return ratio, an engine mode with gas pressure and flywheel, static forces and a rigid-body dynamic model), cams (motion programs, profiles for knife-edge, roller and flat followers, pressure angle and curvature checks, base-circle optimisation) and gears (involute spur geometry, meshing, trains, planetary sets, helical, belts and chains).',
  'Files are .kmech (JSON). The examples are copied once into ~/Documents/kMech Examples.',
].join('\n\n')
