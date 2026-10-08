// KherveCAD: the desktop KherveCAD (../KherveCAD, PyQt5 + OpenSCAD) in
// KherveOS. Its own MainWindow runs in this window's Python on a headless Qt
// (public/apps/khervecad/py/kcweb) — every menu, toolbar, panel, dialog and
// slot is the desktop's code — and this component draws it: the toolbars
// (the vertical drawing / solids bar and the horizontal operations bar), the
// Main / Object / Collections / Variables / Code tabs with Properties below,
// the 2D sketch above the 3D view, the docks, the status bar and the menus
// in the KherveOS menu bar. OpenSCAD runs as WebAssembly (openscad.worker.ts),
// three.js draws the 3D view. Documents are the desktop's .kcad.

import './khervecad.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { os, type AppProps, type MenuBarMenu } from '@/os'
import { fs } from '@/os/vfs'
import { HOME } from '@/os/path'
import { extname } from '@/os/path'
import { DRAG_MIME } from '@/os/fileActions'
import { useAppTools } from '@/os/ai/appTools'
import { CadBridge } from './bridge'
import { ScadRunner } from './engine'
import { floatsToBase64, parseStl, toBase64 } from './meshio'
import { resolve, resolveMain, plainText, type NodeCache } from './nodes'
import { qtKey } from './keys'
import { menuItems, menuItemsCached } from './qt/menu'
import { QtContext, type QtApi } from './qt/context'
import { CUSTOM, QtNode, StatusBar, comboPick } from './qt/QtNode'
import { Tips } from './qt/Tips'
import { View3D } from './View3D'
import { Sketch } from './Sketch'
import { AskDialog, WindowFrame, filterExtensions } from './dialogs'
import { createViews, type ViewsStore } from './store'
import { cadTools } from './aiTools'
import type { ActionNode, AskSpec, MainNode, MenuNode, Node, Reply, UiEvent, WindowNode } from './types'

/** The desktop KherveCAD this edition runs (exported by tools/export_khervecad.py). */
export const CORE_SOURCE = 'KherveCAD main @ 2994bd0 (v0.1.544)'
const SETTINGS_KEY = 'khervecad.settings'
const OPENABLE = ['.kcad', '.scad', '.csg', '.stl', '.obj', '.off', '.3mf', '.amf', '.glb', '.svg', '.dxf', '.dat']
const EXAMPLES_DIR = `${HOME}/Documents/KherveCAD Examples`
const SAMPLES = ['Chair.kcad']

/** The desktop's clipboard (copied objects as JSON) shared by every
 *  KherveCAD window: each has its own Python, as each desktop window shares
 *  the system clipboard. */
const sharedClip = { text: '' }

function loadSettings(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

/** The repository's sample documents, on the drive the first time. */
async function seedSamples() {
  try {
    if (localStorage.getItem('khervecad.samples') === '1') return
    if (!fs.exists(EXAMPLES_DIR)) await fs.mkdir(EXAMPLES_DIR, { recursive: true })
    for (const name of SAMPLES) {
      const path = `${EXAMPLES_DIR}/${name}`
      if (fs.exists(path)) continue
      const r = await fetch(`${import.meta.env.BASE_URL}apps/khervecad/examples/${encodeURIComponent(name)}`)
      if (r.ok) await fs.writeText(path, await r.text(), { mkdirs: true })
    }
    localStorage.setItem('khervecad.samples', '1')
  } catch {
    /* the samples are a convenience */
  }
}

export default function KherveCAD({ win, args }: AppProps) {
  const bridge = useMemo(() => new CadBridge(`khervecad-${win.id}`), [win.id])
  const runner = useMemo(() => new ScadRunner(), [])
  const cache = useRef<NodeCache>(new Map())
  const menuCache = useRef(new Map<number, MenuNode>())
  const root = useRef<HTMLDivElement>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const [progress, setProgress] = useState<string | null>('Starting Python…')
  const [failure, setFailure] = useState<string | null>(null)
  const [main, setMain] = useState<MainNode | null>(null)
  const [menus, setMenusState] = useState<MenuNode[]>([])
  const [windows, setWindows] = useState<WindowNode[]>([])
  const [ask, setAsk] = useState<AskSpec | null>(null)
  const [messages, setMessages] = useState<[string, string, string][]>([])
  const [rendering, setRendering] = useState(false)
  const views = useMemo(() => createViews(), [])
  const dirty = useRef(false)
  const closeWaiter = useRef<((ok: boolean) => void) | null>(null)
  const mcpWaiters = useRef(new Map<number, (r: unknown) => void>())
  const mcpId = useRef(1)
  const askRef = useRef<AskSpec | null>(null)
  askRef.current = ask

  const clipSeen = useRef('')
  const send = useCallback(
    (ev: UiEvent) => {
      // another KherveCAD window copied something: this Python gets it first
      if (sharedClip.text && sharedClip.text !== clipSeen.current) {
        clipSeen.current = sharedClip.text
        bridge.send({ op: 'clipboard', text: sharedClip.text })
      }
      bridge.send(ev)
    },
    [bridge],
  )

  // ------------------------------------------------------------ replies
  const onReply = useCallback(
    (r: Reply) => {
      if (r.fatal) {
        console.error('[khervecad]', r.trace)
        setFailure(r.fatal)
        return
      }
      if (r.errors?.length) console.warn('[khervecad] desktop code raised:', r.errors)
      win.setTitle(r.title)
      dirty.current = r.dirty
      win.setDocumentPath(r.path ?? null)
      if (r.menubar) {
        for (const m of r.menubar.menus) menuCache.current.set(m.id, m)
        setMenusState(r.menubar.order.map((id) => menuCache.current.get(id)).filter((m): m is MenuNode => !!m))
      }
      setMain(resolveMain(r.main, cache.current))
      setWindows(r.windows.map((w) => ({ ...w, node: resolve(w.node, cache.current) })))
      // the same question stays the same object (its dialog must not reopen)
      setAsk((old) => (r.ask ? (old && old.seq === r.ask.seq ? old : r.ask) : null))
      if (r.messages?.length) setMessages((m) => [...m, ...r.messages!])
      if (r.jobs?.length) runner.add(r.jobs)
      if (r.v3) {
        const d = r.v3
        const old = views.getState().v3
        views.setState({
          v3: {
            mesh: d.mesh ?? old.mesh,
            hi: d.hi ?? old.hi,
            cam: d.cam ?? old.cam,
            camRev: d.cam ? old.camRev + 1 : old.camRev,
            look: d.look ?? old.look,
            markers: d.markers ?? old.markers,
          },
        })
      }
      if (r.sketch) {
        const s = r.sketch
        const st = views.getState()
        views.setState({ sketch: { ...st.sketch, ...s, view: undefined } })
        if (s.view) views.setState({ sketchView: { v: { sx: s.view.sx, sy: s.view.sy, cx: s.view.cx, cy: s.view.cy }, rev: st.sketchView.rev + 1 } })
      }
      if (r.settings) {
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(r.settings))
        } catch {
          /* private mode */
        }
      }
      if (typeof r.clipboard === 'string' && r.clipboard) {
        sharedClip.text = r.clipboard
        clipSeen.current = r.clipboard
        void navigator.clipboard?.writeText(r.clipboard).catch(() => {})
      }
      if (r.popups?.length) {
        const p = r.popups[r.popups.length - 1]
        menuAt(p.items, { clientX: pointer.current.x, clientY: pointer.current.y })
      }
      if (r.tick) setTimeout(() => bridge.send({ op: 'tick' }), r.tick)
      for (const req of r.os ?? []) {
        if (req.op === 'new_window') os.open('khervecad')
        else if (req.op === 'close') win.close()
        else if (req.op === 'reveal' && req.path) os.open('files', { path: req.path })
        else if (req.op === 'url' && req.url) {
          if (req.url.startsWith('file://')) os.open('files', { path: decodeURI(req.url.slice(7)) })
          else void os.openUrl(req.url)
        }
      }
      for (const m of r.mcp ?? []) {
        mcpWaiters.current.get(m.req)?.(m.result)
        mcpWaiters.current.delete(m.req)
      }
      const closeOk = r.close_ok
      if (closeOk !== undefined && closeWaiter.current) {
        closeWaiter.current(closeOk)
        closeWaiter.current = null
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bridge, runner, win, views],
  )

  // a menu of desktop actions at a point (context menus, tool buttons)
  const menuAt = useCallback(
    (items: ActionNode[], at: { clientX: number; clientY: number }) => {
      os.contextMenu(
        at,
        menuItems(items, (id) => {
          if (!comboPick(id)) send({ op: 'trigger', id })
        }),
      )
    },
    [send],
  )

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    bridge.onReply = onReply
    bridge.onProgress = (t) => setProgress(t)
    bridge.onFailure = (m) => setFailure(m)
    runner.onBusy = setRendering
    runner.onResult = (job, res) => {
      const tris = res.ok && res.data ? floatsToBase64(parseStl(res.data)) : undefined
      bridge.send({ op: 'engine', job: job.id, ok: res.ok, tris, stderr: res.stderr })
    }
    void seedSamples()
    const settings = loadSettings()
    bridge
      .boot({ settings, language: typeof settings.language === 'string' ? settings.language : 'en' })
      .then(() => {
        setProgress(null)
        if (typeof args.path === 'string' && args.path) bridge.send({ op: 'open_path', path: args.path })
      })
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)))
    return () => {
      bridge.dispose()
      runner.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge])

  // the desktop's menus in the KherveOS menu bar
  const triggerMenu = useCallback((id: number) => send({ op: 'trigger', id }), [send])
  useEffect(() => {
    // unchanged menus (the 2,000-item Library) keep their converted entries
    const bar: MenuBarMenu[] = menus.map((m) => ({
      label: plainText(m.title),
      items: menuItemsCached(m.items, triggerMenu),
    }))
    win.setMenus(bar.length ? bar : null)
  }, [menus, win, triggerMenu])
  useEffect(() => () => win.setMenus(null), [win])

  // closing asks about unsaved changes (the desktop's closeEvent)
  useEffect(() => {
    win.setCloseGuard(() => {
      if (!dirty.current || !bridge.isBooted) return true
      return new Promise<boolean>((resolveClose) => {
        closeWaiter.current = resolveClose
        bridge.send({ op: 'close_window' })
      })
    })
    return () => win.setCloseGuard(null)
  }, [win, bridge])

  // ------------------------------------------------------- the questions
  useEffect(() => {
    if (!ask) return
    const spec = ask
    const reply = (v: unknown) => bridge.answer(v)
    if (spec.kind === 'open' || spec.kind === 'open_many') {
      const exts = filterExtensions(spec.filter)
      void os.dialog.openFile({ title: spec.title || 'Open', extensions: exts.length ? exts : undefined, startDir: spec.start || undefined }).then((p) =>
        reply(spec.kind === 'open' ? { path: p ?? '' } : { paths: p ? [p] : [] }),
      )
    } else if (spec.kind === 'save') {
      const exts = filterExtensions(spec.filter)
      const start = spec.start || ''
      void os.dialog
        .saveFile({ title: spec.title || 'Save', extensions: exts.length ? exts : undefined, defaultName: start || undefined })
        .then((p) => reply({ path: p ?? '' }))
    } else if (spec.kind === 'folder') {
      void os.dialog.pickFolder({ title: spec.title || 'Choose a folder', startDir: spec.start || undefined }).then((p) => reply({ path: p ?? '' }))
    } else if (spec.kind === 'openscad') {
      // an export: OpenSCAD writes the file's bytes, Python saves them
      setProgress('OpenSCAD is rendering the export…')
      void runner.run(spec.code ?? '', spec.format === 'stl' ? 'binstl' : spec.format ?? 'stl', spec.defines).then((res) => {
        setProgress(null)
        reply(res.ok && res.data ? { ok: true, data: toBase64(res.data) } : { ok: false, error: res.stderr || 'OpenSCAD failed.' })
      })
    }
  }, [ask, bridge, runner])

  // --------------------------------------------------------- AI tools
  const mcp = useCallback(
    (name: string, a: Record<string, unknown>) =>
      new Promise<unknown>((res) => {
        const req = mcpId.current++
        mcpWaiters.current.set(req, res)
        bridge.send({ op: 'mcp', name, args: a, req })
      }),
    [bridge],
  )
  const mcpList = useCallback(
    (search: string) =>
      new Promise<unknown>((res) => {
        const req = mcpId.current++
        mcpWaiters.current.set(req, res)
        bridge.send({ op: 'mcp_list', search, req })
      }),
    [bridge],
  )
  useAppTools(win, useMemo(() => cadTools(mcp, mcpList), [mcp, mcpList]))

  // --------------------------------------------------- the two views
  useEffect(() => views.setState({ send }), [views, send])
  CUSTOM.view3d = (n) => <View3DHost store={views} node={n} />
  CUSTOM.sketch = (n) => <SketchHost store={views} node={n} />

  // ---------------------------------------------------------- keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (askRef.current) return
    const t = e.target as HTMLElement
    const k = qtKey(e.nativeEvent)
    if (!k.text) return
    const typing = t.closest('input, textarea, select, [contenteditable="true"]')
    const ctrlOrAlt = (k.mods & (0x04000000 | 0x08000000)) !== 0
    if (typing && (!ctrlOrAlt || /^Ctrl\+[ACVXZY]$/.test(k.text))) return
    if (/^F\d+$/.test(k.text) || ctrlOrAlt || !typing) {
      // a QAction's shortcut, as Qt resolves it (single letters pick tools)
      e.preventDefault()
      send({ op: 'shortcut', keys: [k.text, ...k.alt] })
    }
  }

  // drop a file from Files: open / import it (the desktop's open_any)
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    e.preventDefault()
    try {
      const paths = (JSON.parse(raw) as string[]).filter((p) => OPENABLE.includes(extname(p).toLowerCase()))
      if (paths.length) bridge.send({ op: 'open_path', path: paths[0] })
    } catch {
      /* not paths */
    }
  }

  const api: QtApi = useMemo(() => ({ send, menu: menuAt, pointer: pointer.current }), [send, menuAt])

  const top = main?.toolbars.filter(([area]) => area === 4) ?? []
  const left = main?.toolbars.filter(([area]) => area === 1) ?? []
  const rightDocks = main?.docks.filter(([area, , , shown]) => area === 2 && shown) ?? []
  const message = messages[0]

  return (
    <QtContext.Provider value={api}>
      <div
        ref={root}
        className="kc-app"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPointerDownCapture={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
        onContextMenuCapture={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {main ? (
          <>
            <div className="kc-top">
              {top.map(([, n]) => (
                <QtNode key={n.id} n={n} />
              ))}
            </div>
            <div className="kc-middle">
              {left.length > 0 && (
                <div className="kc-left">
                  {left.map(([, n]) => (
                    <QtNode key={n.id} n={n} />
                  ))}
                </div>
              )}
              <div className="kc-central">
                <QtNode n={main.central} />
              </div>
              {rightDocks.map(([, id, title, , node]) => (
                <div key={id} className="kc-dock">
                  <div className="kc-dock-title">
                    <span>{title}</span>
                    <button type="button" className="kc-window-close" aria-label="Close" onClick={() => send({ op: 'close', id })}>
                      ×
                    </button>
                  </div>
                  <div className="kc-dock-body">{node && <QtNode n={node} />}</div>
                </div>
              ))}
            </div>
            <StatusBar n={main.status} />
            {rendering && <div className="kc-render-badge">OpenSCAD…</div>}
          </>
        ) : null}
        {windows.map((w, i) => (
          <WindowFrame key={w.id} w={w} index={i} onClose={() => send({ op: 'close', id: w.id })} />
        ))}
        {ask && !['open', 'open_many', 'save', 'folder', 'openscad'].includes(ask.kind) && <AskDialog key={ask.seq} spec={ask} answer={(v) => bridge.answer(v)} />}
        {message && (
          <AskDialog
            key={`m${messages.length}${message[2]}`}
            spec={{ kind: 'message', title: message[1] || 'KherveCAD', text: message[2], icon: message[0] === 'warning' ? 2 : message[0] === 'critical' ? 3 : 1, buttons: ['OK'] }}
            answer={() => setMessages((m) => m.slice(1))}
          />
        )}
        {(progress || failure) && (
          <div className={`kc-progress-card${failure ? ' failed' : ''}`}>
            {failure ? (
              <>
                <strong>KherveCAD stopped</strong>
                <span>{failure}</span>
              </>
            ) : (
              <>
                <LoaderCircle size={18} className="kc-spinning" />
                <span>{progress}</span>
              </>
            )}
          </div>
        )}
        <Tips root={root} />
      </div>
    </QtContext.Provider>
  )
}

function View3DHost({ store, node }: { store: ViewsStore; node: Node }) {
  const data = store((s) => s.v3)
  const send = store((s) => s.send)
  return <View3D data={data} node={node} send={send} />
}

function SketchHost({ store, node }: { store: ViewsStore; node: Node }) {
  const state = store((s) => s.sketch)
  const view = store((s) => s.sketchView)
  const send = store((s) => s.send)
  return <Sketch state={state} view={view.v} viewRev={view.rev} node={node} send={send} />
}
