// Window chrome: title bar with traffic lights, move, resize, snap,
// minimise/zoom/close, and the app inside. Windows are rendered in creation
// order and stacked with z-index — never re-ordered in the DOM, because moving
// an <iframe> in the DOM reloads it (Browser tabs and games would restart).

import { Component, Suspense, lazy, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import { useWindows, setCloseGuard, isSmallScreen, desktopSize, type WinState } from '@/os/windows'
import { getApp } from '@/os/registry'
import { setWindowMenus } from '@/os/menus'
import { useWindowTheme } from '@/os/themes'
import { Spinner } from '@/os/ui/ServerGate'
import { os } from '@/os'
import { reportCrash } from '@/os/crash'
import { HOME, extname } from '@/os/path'
import type { AppArgs, AppManifest, AppProps, WindowApi } from '@/os/types'
import { animateMinimize, animateRestore, captureWindow, forgetWindow, tileFor, tileRects } from './minimize'

const lazyApps = new Map<string, ComponentType<AppProps>>()
function appComponent(app: AppManifest) {
  let C = lazyApps.get(app.id)
  if (!C) lazyApps.set(app.id, (C = lazy(app.load)))
  return C
}

class AppErrorBoundary extends Component<{ name: string; onClose: () => void; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}] crashed`, error)
    reportCrash(this.props.name, error, info.componentStack ?? '')
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="k-center">
        <div className="k-gate-card">
          <h2>{this.props.name} stopped working</h2>
          <pre className="k-code-block k-crash">{this.state.error.message}</pre>
          <div className="k-dialog-buttons">
            <button className="k-btn" onClick={this.props.onClose}>Close</button>
            <button className="k-btn primary" onClick={() => this.setState({ error: null })}>Try again</button>
          </div>
        </div>
      </div>
    )
  }
}

const AppHost = memo(function AppHost({ app, api, args }: { app: AppManifest; api: WindowApi; args: AppArgs }) {
  const C = appComponent(app)
  return (
    <AppErrorBoundary name={app.name} onClose={() => api.close(true)}>
      <Suspense fallback={<Spinner label={`Opening ${app.name}…`} />}>
        <C win={api} args={args} />
      </Suspense>
    </AppErrorBoundary>
  )
})

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function boundsFor(w: WinState) {
  const { w: deskW, h: deskH } = desktopSize()
  // Narrow screens (phones, a squeezed browser pane): every window fills the screen.
  if (w.maximized || isSmallScreen()) return { x: 0, y: 0, w: deskW, h: deskH }
  if (w.snapped === 'left') return { x: 0, y: 0, w: Math.round(deskW / 2), h: deskH }
  if (w.snapped === 'right') return { x: Math.round(deskW / 2), y: 0, w: deskW - Math.round(deskW / 2), h: deskH }
  // Keep the window reachable if the browser got smaller since it was placed.
  const ww = Math.min(w.w, deskW)
  const hh = Math.min(w.h, deskH)
  return {
    x: Math.min(Math.max(w.x, -(ww - 120)), deskW - Math.min(ww, 120)),
    y: Math.min(Math.max(w.y, 0), deskH - 40),
    w: ww,
    h: hh,
  }
}

function useViewportVersion() {
  const [v, setV] = useState(0)
  useEffect(() => {
    const on = () => setV((n) => n + 1)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return v
}

function WindowFrame({ win, focused }: { win: WinState; focused: boolean }) {
  const app = getApp(win.appId)!
  const ref = useRef<HTMLDivElement>(null)
  const [snapHint, setSnapHint] = useState<'left' | 'right' | 'max' | null>(null)
  const [fileOver, setFileOver] = useState(false)
  useViewportVersion()
  const light = useWindowTheme(win.appId)
  const { focus, minimize, toggleMaximize, setBounds, snap, close } = useWindows.getState()
  const minW = app.minSize?.w ?? 320
  const minH = app.minSize?.h ?? 200

  const api: WindowApi = useMemo(
    () => ({
      id: win.id,
      setTitle: (t: string) => useWindows.getState().setTitle(win.id, t),
      close: (force?: boolean) => void useWindows.getState().close(win.id, force),
      setCloseGuard: (g) => setCloseGuard(win.id, g),
      setMenus: (m) => setWindowMenus(win.id, m),
      setDocumentPath: (p) => useWindows.getState().setDocPath(win.id, p),
      focus: () => useWindows.getState().focus(win.id),
    }),
    [win.id],
  )
  useEffect(() => () => setWindowMenus(win.id, null), [win.id])

  // ---- minimising, like macOS: the window flies into its own Dock tile (which shows a
  // picture of it) and back out. 'hiding' and 'showing' are the flights.
  const [phase, setPhase] = useState<'shown' | 'hiding' | 'hidden' | 'showing'>(win.minimized ? 'hidden' : 'shown')
  const wasMinimized = useRef(win.minimized)
  useLayoutEffect(() => {
    if (win.minimized === wasMinimized.current) return
    wasMinimized.current = win.minimized
    const el = ref.current
    if (!win.minimized) {
      setPhase('showing')
      return
    }
    if (!el) return
    let cancelled = false
    setPhase('hiding')
    // The picture is taken during the flight; the window stays laid out until then.
    const { flying, done } = animateMinimize(el, tileFor(win.id))
    const picture = flying.then(() => captureWindow(win.id, el))
    void Promise.all([done, picture]).then(() => !cancelled && setPhase('hidden'))
    return () => {
      cancelled = true
    }
  }, [win.minimized, win.id])
  useLayoutEffect(() => {
    const el = ref.current
    if (phase !== 'showing' || !el) return
    let cancelled = false
    const tile = tileRects.get(win.id) ?? tileFor(win.id)
    forgetWindow(win.id)
    void animateRestore(el, tile).then(() => !cancelled && setPhase('shown'))
    return () => {
      cancelled = true
    }
  }, [phase, win.id])
  useEffect(() => () => forgetWindow(win.id), [win.id])

  const b = boundsFor(win)

  // ---- moving
  const startMove = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button') || isSmallScreen()) return
    const el = ref.current!
    const start = { px: e.clientX, py: e.clientY, ...b }
    let pos = { x: b.x, y: b.y }
    let detached = !(win.maximized || win.snapped)
    let hint: typeof snapHint = null
    let moved = false
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    document.body.classList.add('k-dragging')

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px
      const dy = ev.clientY - start.py
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return
      moved = true
      if (!detached) {
        // Pull a zoomed/snapped window off the edge, keeping the grab point under the pointer.
        const r = win.restore ?? { w: win.w, h: win.h }
        const ratio = (start.px - start.x) / start.w
        start.x = ev.clientX - r.w * ratio
        start.y = 0
        start.px = ev.clientX
        start.py = ev.clientY
        start.w = r.w
        start.h = r.h
        el.style.width = `${r.w}px`
        el.style.height = `${r.h}px`
        detached = true
      }
      const desk = desktopSize()
      pos = {
        x: Math.round(Math.min(Math.max(start.x + (ev.clientX - start.px), -start.w + 80), desk.w - 80)),
        y: Math.round(Math.min(Math.max(start.y + (ev.clientY - start.py), 0), desk.h + 30)),
      }
      el.style.left = `${pos.x}px`
      el.style.top = `${pos.y}px`
      const top = ref.current?.parentElement?.getBoundingClientRect().top ?? 0
      hint = app.fixedSize ? null : ev.clientX <= 4 ? 'left' : ev.clientX >= window.innerWidth - 5 ? 'right' : ev.clientY <= top + 2 ? 'max' : null
      setSnapHint(hint)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('k-dragging')
      setSnapHint(null)
      if (!moved) return
      if (hint) {
        if (win.maximized || win.snapped) setBounds(win.id, { x: pos.x, y: pos.y })
        snap(win.id, hint)
      } else if (win.maximized || win.snapped) {
        snap(win.id, null)
        setBounds(win.id, { x: pos.x, y: pos.y, w: start.w, h: start.h })
      } else setBounds(win.id, pos)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---- resizing
  const startResize = (edge: Edge) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    focus(win.id)
    const el = ref.current!
    const s = { px: e.clientX, py: e.clientY, ...b }
    let nb = { ...b }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    document.body.classList.add('k-dragging')
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - s.px
      const dy = ev.clientY - s.py
      const desk = desktopSize()
      nb = { ...s }
      if (edge.includes('e')) nb.w = Math.max(minW, s.w + dx)
      if (edge.includes('s')) nb.h = Math.max(minH, Math.min(s.h + dy, desk.h + 60 - s.y))
      if (edge.includes('w')) {
        nb.w = Math.max(minW, s.w - dx)
        nb.x = s.x + s.w - nb.w
      }
      if (edge.includes('n')) {
        nb.h = Math.max(minH, s.h - dy)
        nb.y = Math.max(0, s.y + s.h - nb.h)
        nb.h = s.y + s.h - nb.y
      }
      Object.assign(el.style, { left: `${nb.x}px`, top: `${nb.y}px`, width: `${nb.w}px`, height: `${nb.h}px` })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('k-dragging')
      if (win.maximized || win.snapped) snap(win.id, null)
      setBounds(win.id, { x: nb.x, y: nb.y, w: nb.w, h: nb.h })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const maxed = win.maximized || !!win.snapped || isSmallScreen()
  return (
    <>
      {snapHint && <div className={`k-snap-hint ${snapHint}`} style={{ zIndex: win.z - 1 }} />}
      <div
        ref={ref}
        className={`k-window${focused ? ' focused' : ''}${maxed ? ' maximized' : ''}${fileOver ? ' file-over' : ''}${app.translucent ? ' translucent' : ''}${phase === 'hiding' || phase === 'showing' ? ' flying' : ''}`}
        data-window-id={win.id}
        data-dark={light?.dark}
        style={{
          ...light?.style,
          left: b.x, top: b.y, width: b.w, height: b.h, zIndex: win.z,
          display: phase === 'hidden' ? 'none' : undefined,
        }}
        onPointerDownCapture={() => !focused && focus(win.id)}
        // Files dropped from the computer onto a window: copy them to ~/Downloads and open
        // them here (or in the app that handles them). Apps that handle drops themselves
        // (Files, editors) call preventDefault, and this steps aside.
        onDragOver={(e) => {
          if (e.defaultPrevented || !e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!fileOver) setFileOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileOver(false)
        }}
        onDrop={(e) => {
          setFileOver(false)
          if (e.defaultPrevented || !e.dataTransfer.files.length) return
          e.preventDefault()
          focus(win.id)
          void os.importFiles(`${HOME}/Downloads`, e.dataTransfer.files).then((paths) => {
            for (const p of paths) {
              if (app.fileTypes?.includes(extname(p))) os.open(app.id, { path: p })
              else void os.openFile(p)
            }
          })
        }}
        role="dialog"
        aria-label={win.title}
      >
        <div
          className="k-titlebar"
          onPointerDown={startMove}
          onDoubleClick={(e) => !app.fixedSize && !(e.target as HTMLElement).closest('button') && toggleMaximize(win.id)}
        >
          <div className="k-traffic">
            <button className="k-light close" aria-label="Close" title="Close" onClick={() => void close(win.id)}>
              <svg viewBox="0 0 10 10"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" /></svg>
            </button>
            <button className="k-light min" aria-label="Minimise" title="Minimise" onClick={() => minimize(win.id)}>
              <svg viewBox="0 0 10 10"><path d="M2 5h6" /></svg>
            </button>
            <button
              className="k-light zoom"
              aria-label={maxed ? 'Restore' : 'Zoom'}
              title={app.fixedSize ? undefined : maxed ? 'Restore' : 'Zoom'}
              disabled={app.fixedSize}
              onClick={() => toggleMaximize(win.id)}
            >
              <svg viewBox="0 0 10 10">
                {maxed ? <path className="fill" d="M5.6 1.8v2.6h2.6zM4.4 8.2V5.6H1.8z" /> : <path className="fill" d="M2.2 2.2h4.2L2.2 6.4zM7.8 7.8H3.6l4.2-4.2z" />}
              </svg>
            </button>
          </div>
          <span className="k-title-text">{win.title}</span>
          <span className="k-traffic-spacer" />
        </div>
        <div className="k-window-body">
          <AppHost app={app} api={api} args={win.args} />
        </div>
        {!maxed && !app.fixedSize && EDGES.map((edge) => <div key={edge} className={`k-resize k-resize-${edge}`} onPointerDown={startResize(edge)} />)}
      </div>
    </>
  )
}

export function WindowLayer() {
  const windows = useWindows((s) => s.windows)
  const focusedId = useWindows((s) => s.focusedId)

  // Clicks inside an <iframe> never reach us, so watch for focus moving into one.
  useEffect(() => {
    const onBlur = () =>
      setTimeout(() => {
        const el = document.activeElement
        if (el?.tagName === 'IFRAME') {
          const id = (el.closest('[data-window-id]') as HTMLElement | null)?.dataset.windowId
          if (id) useWindows.getState().focus(id)
        }
      }, 0)
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  return (
    <div className="k-window-layer">
      {windows.map((w) => (
        <WindowFrame key={w.id} win={w} focused={w.id === focusedId} />
      ))}
    </div>
  )
}
