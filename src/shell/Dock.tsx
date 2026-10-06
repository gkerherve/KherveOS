// The Dock: Launchpad, the kept apps and the running ones. Click to open or
// bring forward, click again to hide; right-click for more.
//
// Magnification works like macOS: icons near the pointer grow smoothly with
// distance, the Dock widens, and the icon under the pointer stays under it.

import { useEffect, useRef, useState } from 'react'
import { LayoutGrid, RotateCw, Settings as SettingsIcon } from 'lucide-react'
import { APPS, GROUPS, getApp } from '@/os/registry'
import { useWindows } from '@/os/windows'
import { useSettings } from '@/os/settings'
import { closeContextMenu, openMenuOwner, showContextMenu } from '@/os/overlays'
import { AppIcon } from '@/os/ui/AppIcon'
import type { AppManifest } from '@/os/types'
import type { MenuItem } from '@/os/ui/Menu'
import { openLaunchpad } from './ui'

const APPLICATIONS: AppManifest = {
  id: 'applications', name: 'Applications', icon: LayoutGrid, color: '#4b5563', category: 'system', group: 'Tools',
  description: 'All apps', load: async () => ({ default: () => null }),
  brand: { label: 'KApps', from: '#7a828e', to: '#2b3038', deep: ['#5f6672', '#272b32'] },
}

/** The Applications menu: one submenu per group (Office, Science, Tools…). */
function applicationsMenu(open: (id: string) => void): MenuItem[] {
  const groups: MenuItem[] = GROUPS.map((g) => {
    const apps = APPS.filter((a) => a.group === g)
    return {
      label: g,
      disabled: apps.length === 0,
      submenu: apps.map((a) => ({ label: a.name, image: <AppIcon app={a} size={18} />, onClick: () => open(a.id) })),
    }
  })
  return [
    ...groups,
    '-',
    { label: 'All Apps…', icon: LayoutGrid, onClick: openLaunchpad },
    { label: 'Settings', icon: SettingsIcon, onClick: () => open('settings') },
    { label: 'Restart KherveOS', icon: RotateCw, onClick: () => location.reload() },
  ]
}

// Geometry of the resting Dock (must match .k-dock in shell.css).
const PAD = 8 // panel padding left/right
const GAP = 4 // between items
const ITEM_EXTRA = 4 // an item is its icon + 4 px
const SEP = 9 // the separator: 1 px line + 4 px margins

/** 1 under the pointer, easing to 0 at `range` away (a smooth bell, like macOS). */
const bell = (d: number, range: number) => (d >= range ? 0 : (Math.cos((Math.PI * d) / range) + 1) / 2)

export function Dock() {
  const windows = useWindows((s) => s.windows)
  const focusedId = useWindows((s) => s.focusedId)
  const dock = useSettings((s) => s.dock)
  const dockZoom = useSettings((s) => s.dockZoom)
  const setSettings = useSettings((s) => s.set)
  const [appsOpen, setAppsOpen] = useState(false)
  const { open, focus, minimize, close } = useWindows.getState()
  const [bouncing, setBouncing] = useState<string | null>(null)

  const running = [...new Set(windows.map((w) => w.appId))]
  const ids = [...dock.filter((id) => getApp(id)), ...running.filter((id) => !dock.includes(id))]

  // Shrink the icons when the screen is too narrow for them all.
  const [vw, setVw] = useState(() => window.innerWidth)
  const [vh, setVh] = useState(() => window.innerHeight)
  useEffect(() => {
    const on = () => {
      setVw(window.innerWidth)
      setVh(window.innerHeight)
    }
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const icon = Math.max(28, Math.min(48, Math.floor((vw - 56) / (ids.length + 1)) - 10))
  // The biggest an icon may grow to: the setting, but no more than a fifth of the
  // screen's height or a quarter of its width (small screens).
  const maxIcon = Math.max(icon, Math.min(dockZoom, Math.round(vh * 0.2), Math.round(vw / 4.2)))

  // ---- magnification
  const [pointer, setPointer] = useState<number | null>(null)
  const lastPointer = useRef(0)
  const [amount, setAmount] = useState(0) // 0 = resting, 1 = fully magnified
  const amountRef = useRef(0)
  useEffect(() => {
    const target = pointer === null ? 0 : 1
    let raf = 0
    const step = () => {
      const a = amountRef.current
      const next = Math.abs(target - a) < 0.02 ? target : a + (target - a) * 0.3
      amountRef.current = next
      setAmount(next)
      if (next !== target) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [pointer])

  // Where everything sits in the resting Dock, so the pointer maps to a stable spot.
  type Slot = { key: string; sep?: boolean; left: number; width: number }
  const slots: Slot[] = []
  let x = PAD
  for (const key of ['applications', '|', ...ids]) {
    const width = key === '|' ? SEP : icon + ITEM_EXTRA
    slots.push({ key, sep: key === '|', left: x, width })
    x += width + GAP
  }
  const restWidth = x - GAP + PAD
  const relX = lastPointer.current - (vw - restWidth) / 2
  const range = 2.6 * (icon + ITEM_EXTRA + GAP)
  const growth = maxIcon / icon - 1
  const scale = (s: Slot) => (s.sep || amount === 0 ? 1 : 1 + growth * amount * bell(Math.abs(relX - (s.left + s.width / 2)), range))

  // Keep the icon under the pointer where it is while the Dock widens around it.
  let leftExtra = 0
  let rightExtra = 0
  for (const s of slots) {
    const extra = (scale(s) - 1) * icon
    if (s.left + s.width <= relX) leftExtra += extra
    else if (s.left >= relX) rightExtra += extra
    else {
      const p = (relX - s.left) / s.width
      leftExtra += extra * p
      rightExtra += extra * (1 - p)
    }
  }
  const shift = (rightExtra - leftExtra) / 2
  const sizeOf = (key: string) => {
    const s = slots.find((sl) => sl.key === key)!
    return Math.round(icon * scale(s) * 10) / 10
  }

  const clickApp = (appId: string) => {
    const wins = windows.filter((w) => w.appId === appId)
    if (!wins.length) {
      setBouncing(appId)
      setTimeout(() => setBouncing((b) => (b === appId ? null : b)), 900)
      open(appId)
      return
    }
    const top = [...wins].sort((a, b) => b.z - a.z)[0]
    if (wins.length === 1) {
      if (focusedId === top.id && !top.minimized) minimize(top.id)
      else focus(top.id)
      return
    }
    // Several windows: bring them all forward, then cycle on further clicks.
    if (focusedId && wins.some((w) => w.id === focusedId)) {
      const byId = [...wins].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      const i = byId.findIndex((w) => w.id === focusedId)
      focus(byId[(i + 1) % byId.length].id)
    } else {
      wins.sort((a, b) => a.z - b.z).forEach((w) => focus(w.id))
    }
  }

  const menuFor = (appId: string): MenuItem[] => {
    const app = getApp(appId)!
    const wins = windows.filter((w) => w.appId === appId)
    const kept = dock.includes(appId)
    return [
      ...wins.map((w) => ({ label: w.title, checked: w.id === focusedId, onClick: () => focus(w.id) })),
      ...(wins.length ? (['-'] as MenuItem[]) : []),
      { label: wins.length ? 'New Window' : 'Open', disabled: !!app.singleton && wins.length > 0, onClick: () => open(appId, wins.length ? { _new: Date.now() } : {}) },
      {
        label: kept ? 'Remove from Dock' : 'Keep in Dock',
        onClick: () => setSettings({ dock: kept ? dock.filter((d) => d !== appId) : [...dock, appId] }),
      },
      ...(wins.length
        ? ([
            '-',
            { label: 'Hide', onClick: () => wins.forEach((w) => minimize(w.id)) },
            { label: 'Quit', onClick: () => wins.forEach((w) => void close(w.id)) },
          ] as MenuItem[])
        : []),
    ]
  }

  const item = (size: number) => ({ width: size + ITEM_EXTRA, height: size + ITEM_EXTRA })
  const lpSize = sizeOf('applications')

  // The Applications menu opens just above its Dock icon; clicking the icon again closes it.
  const toggleApps = (el: HTMLElement) => {
    if (openMenuOwner() === 'applications') {
      closeContextMenu()
      setAppsOpen(false)
      return
    }
    const r = el.getBoundingClientRect()
    showContextMenu({ clientX: r.left, clientY: r.top - 8 }, applicationsMenu((id) => open(id)), {
      above: true,
      owner: 'applications',
      className: 'k-apps-menu',
    })
    setAppsOpen(true)
  }
  useEffect(() => {
    if (!appsOpen) return
    const t = window.setInterval(() => openMenuOwner() !== 'applications' && setAppsOpen(false), 250)
    return () => window.clearInterval(t)
  }, [appsOpen])

  return (
    <div className="k-dock-wrap" onContextMenu={(e) => e.preventDefault()}>
      <nav
        className="k-dock"
        aria-label="Dock"
        style={{ ['--dock-icon' as string]: `${icon}px`, transform: shift ? `translateX(${shift.toFixed(1)}px)` : undefined }}
        onMouseMove={(e) => {
          lastPointer.current = e.clientX
          setPointer(e.clientX)
        }}
        onMouseLeave={() => setPointer(null)}
      >
        <button
          className={`k-dock-item${appsOpen ? ' active' : ''}`}
          style={item(lpSize)}
          aria-label="Applications"
          aria-haspopup="menu"
          data-menu-owner="applications"
          onClick={(e) => toggleApps(e.currentTarget)}
        >
          <AppIcon app={APPLICATIONS} size={lpSize} className="k-dock-tile" />
          {!appsOpen && <span className="k-dock-label">Applications</span>}
        </button>
        <span className="k-dock-sep" />
        {ids.map((id) => {
          const app = getApp(id)!
          const wins = windows.filter((w) => w.appId === id)
          const size = sizeOf(id)
          return (
            <button
              key={id}
              className={`k-dock-item${bouncing === id ? ' bounce' : ''}`}
              style={item(size)}
              aria-label={app.name}
              onClick={() => clickApp(id)}
              onContextMenu={(e) => {
                e.preventDefault()
                showContextMenu(e, menuFor(id))
              }}
            >
              <AppIcon app={app} size={size} className="k-dock-tile" />
              <span className="k-dock-label">{app.name}</span>
              {wins.length > 0 && <span className="k-dock-dot" />}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
