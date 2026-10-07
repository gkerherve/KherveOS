// KherveMol — draw chemical compounds and crystal structures in 3D and 2D.
// The desktop app (../KherveMol, PyQt5) in KherveOS, 1:1: the same window
// (start screen, then the 3D View | 2D Sketch tabs), the Structure and
// Library | My molecules docks on the left, the AI Chat dock on the right,
// the two icon toolbars, every menu, dialog and shortcut. Its chemistry is
// the desktop's own Python code, running in this window's Pyodide worker.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { fs, HOME, path as vpath } from '@/os'
import type { AppProps } from '@/os/types'
import { useAppTools } from '@/os/ai/appTools'
import { MolApp } from './app'
import { Viewer3D } from './Viewer3D'
import { Editor2D } from './Editor2D'
import { LibraryTree, PeriodicWindow, ShelfPanel, StructureTree } from './panels'
import { Welcome } from './Welcome'
import { AiChat } from './AiChat'
import { Dialogs } from './dialogs'
import { buildMenus, Toolbars } from './menus'
import { khervemolAiTools } from './aiTools'
import './khervemol.css'

const EXAMPLES_DIR = `${HOME}/Documents/KherveMol Examples`
const EXAMPLES_FLAG = 'khervemol.examples'

/** Copy the example files into the drive once (Files then opens them with KherveMol). */
async function seedExamples() {
  try {
    if (localStorage.getItem(EXAMPLES_FLAG)) return
    const base = `${import.meta.env.BASE_URL}examples/khervemol/`
    const r = await fetch(`${base}index.json`, { cache: 'no-cache' })
    if (!r.ok) return
    const index = (await r.json()) as { examples: { file: string }[] }
    for (const { file } of index.examples) {
      const target = vpath.join(EXAMPLES_DIR, file)
      if (fs.exists(target) || file.includes('/') || file.includes('..')) continue
      const f = await fetch(base + encodeURIComponent(file))
      if (f.ok) await fs.writeBytes(target, new Uint8Array(await f.arrayBuffer()), { mkdirs: true })
    }
    localStorage.setItem(EXAMPLES_FLAG, '1')
  } catch {
    /* offline: try again next time */
  }
}

function Dock({ title, onClose, children, className }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <div className={`km-dock${className ? ` ${className}` : ''}`}>
      <div className="km-dock-title">
        <span>{title}</span>
        <button className="km-dock-close" title={`Close ${title}`} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="km-dock-body">{children}</div>
    </div>
  )
}

/** A splitter between two panes (QSplitter / the dock separators). */
function Splitter({ vertical, onDrag }: { vertical?: boolean; onDrag: (d: number) => void }) {
  const last = useRef<number | null>(null)
  return (
    <div
      className={`km-split${vertical ? ' v' : ''}`}
      onPointerDown={(e) => {
        last.current = vertical ? e.clientY : e.clientX
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (last.current === null) return
        const now = vertical ? e.clientY : e.clientX
        onDrag(now - last.current)
        last.current = now
      }}
      onPointerUp={() => (last.current = null)}
    />
  )
}

export default function KherveMol({ win, args }: AppProps) {
  const appRef = useRef<MolApp | null>(null)
  appRef.current ??= new MolApp(win)
  const app = appRef.current
  const s = useStore(
    app.store,
    useShallow((st) => ({
      catalog: st.catalog, recent: st.recent, rdkit: st.rdkit, legend: st.legend, renderer: st.renderer, glOk: st.glOk, style: st.style,
      mode: st.mode, docks: st.docks, version: st.version, poly: st.mol.poly, edges: st.mol.edges, cellVisible: st.mol.cell_visible,
      bonds: st.mol.bonds, central: st.central, tab: st.tab, leftTab: st.leftTab, periodic: st.periodic, progress: st.progress,
      ready: st.ready, busy: st.busy, statusBar: st.statusBar, path: st.path, formula: st.mol.formula,
    })),
  )
  const [leftW, setLeftW] = useState(340)
  const [structH, setStructH] = useState(300)
  const [aiW, setAiW] = useState(320)

  useEffect(() => () => app.dispose(), [app])

  // files opened from Files / the desktop, and the examples
  const opened = useRef<string | null>(null)
  useEffect(() => {
    const p = typeof args.path === 'string' ? args.path : null
    if (p && opened.current !== p) {
      opened.current = p
      void app.openAny(p)
    }
  }, [args.path, app])
  useEffect(() => {
    void seedExamples()
  }, [])

  // the menu bar
  // the menus change with these only (not with the status line or the orientation)
  const menuKey = [s.catalog, s.recent, s.rdkit, s.legend, s.renderer, s.glOk, s.style, s.mode, s.docks, s.version, s.poly, s.edges, s.cellVisible, s.bonds]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const menus = useMemo(() => buildMenus(app, app.get(), s.catalog), menuKey)
  useEffect(() => {
    win.setMenus(menus.bar)
  }, [win, menus])
  useEffect(() => () => win.setMenus(null), [win])
  useEffect(() => app.retitle(), [app, s.version, s.path, s.formula])

  useAppTools(win, khervemolAiTools(app))

  // the window's shortcuts (Ctrl on Windows/Linux, ⌘ on a Mac, as Qt does)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'F1') {
      e.preventDefault()
      void app.ask('guide')
      return
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const k = e.key.toLowerCase()
    const shift = e.shiftKey
    const run = (fn: () => unknown) => {
      e.preventDefault()
      e.stopPropagation()
      void fn()
    }
    if (shift && e.code === 'Digit3') return run(() => app.exportMeshDialog())
    if (shift) {
      const map: Record<string, () => unknown> = {
        s: () => app.saveAs(), e: () => app.exportSvg(), x: () => app.exportChemistry(), m: () => app.fromSmiles(),
        c: () => app.openCrystalBuilder(), f: () => app.openSurfaceBuilder(), g: () => app.openNanoBuilder(), a: () => app.addMoleculeToSurface(),
        p: () => app.openPolymerBuilder(),
      }
      if (map[k]) run(map[k])
      return
    }
    const map: Record<string, () => unknown> = {
      n: () => app.newDocument(), o: () => app.openDialog(), s: () => app.save(), e: () => app.exportPng(), q: () => win.close(),
      l: () => app.openExplorer(), i: () => app.showProperties(), u: () => app.stackCells(), r: () => app.openReactionBuilder(),
      b: () => app.build3dFromSketch(), t: () => app.showPeriodicTable(), '/': () => app.toggleDock('ai'),
    }
    if (map[k]) run(map[k])
  }

  const showLib = s.docks.library, showShelf = s.docks.shelf
  const tabbed = showLib && showShelf
  const lower = tabbed ? s.leftTab : showLib ? 'library' : showShelf ? 'shelf' : null
  const anyLeft = s.docks.structure || lower !== null
  const status = s.progress ?? (!s.ready && s.busy ? 'Starting the KherveMol engine (Python)…' : s.statusBar)

  return (
    <div className="k-app km-app" tabIndex={-1} onKeyDown={onKeyDown}>
      <Toolbars app={app} menus={menus} />
      <div className="km-main">
        {anyLeft && (
          <>
            <div className="km-left" style={{ width: leftW }}>
              {s.docks.structure && (
                <Dock title="Structure" onClose={() => app.toggleDock('structure')} className={lower ? '' : 'fill'}>
                  <div style={lower ? { height: structH } : undefined} className="km-dock-fill">
                    <StructureTree app={app} />
                  </div>
                </Dock>
              )}
              {s.docks.structure && lower && <Splitter vertical onDrag={(d) => setStructH((h) => Math.max(80, h + d))} />}
              {lower && (
                <Dock title={lower === 'library' ? 'Library' : 'My molecules'} onClose={() => app.toggleDock(lower === 'library' ? 'library' : 'shelf')} className="fill">
                  <div className="km-dock-fill">{lower === 'library' ? <LibraryTree app={app} /> : <ShelfPanel app={app} />}</div>
                  {tabbed && (
                    <div className="km-docktabs">
                      <button className={s.leftTab === 'library' ? 'on' : ''} onClick={() => app.set({ leftTab: 'library' })}>
                        Library
                      </button>
                      <button className={s.leftTab === 'shelf' ? 'on' : ''} onClick={() => app.set({ leftTab: 'shelf' })}>
                        My molecules
                      </button>
                    </div>
                  )}
                </Dock>
              )}
            </div>
            <Splitter onDrag={(d) => setLeftW((w) => Math.max(180, Math.min(900, w + d)))} />
          </>
        )}
        <div className="km-center">
          {s.central === 'welcome' ? (
            <Welcome app={app} />
          ) : (
            <div className="km-tabs">
              <div className="km-tabbar">
                <button className={s.tab === 0 ? 'on' : ''} onClick={() => app.setTab(0)}>
                  3D View
                </button>
                <button className={s.tab === 1 ? 'on' : ''} onClick={() => app.setTab(1)}>
                  2D Sketch
                </button>
              </div>
              <div className="km-tabpage" style={{ display: s.tab === 0 ? 'flex' : 'none' }}>
                <Viewer3D app={app} />
              </div>
              <div className="km-tabpage" style={{ display: s.tab === 1 ? 'flex' : 'none' }}>
                <Editor2D app={app} />
              </div>
            </div>
          )}
        </div>
        {s.docks.ai && (
          <>
            <Splitter onDrag={(d) => setAiW((w) => Math.max(220, Math.min(800, w - d)))} />
            <div className="km-right" style={{ width: aiW }}>
              <Dock title="AI Chat" onClose={() => app.toggleDock('ai')} className="fill">
                <AiChat app={app} />
              </Dock>
            </div>
          </>
        )}
        {s.periodic && <PeriodicWindow app={app} />}
      </div>
      <div className="k-statusbar km-status">
        <span className="km-status-msg">{status}</span>
      </div>
      <Dialogs app={app} />
    </div>
  )
}
