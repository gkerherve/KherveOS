// The thin menu bar across the top of the screen, macOS-style: the Ꝃ menu,
// the app in front (bold) with its own menus, then status icons and the clock.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Maximize2, Minimize2, Search, Server, ServerOff } from 'lucide-react'
import { useWindows } from '@/os/windows'
import { getApp } from '@/os/registry'
import { useWindowMenus } from '@/os/menus'
import { useAuth, useServer } from '@/os/server'
import { MenuList, type MenuBarMenu, type MenuItem } from '@/os/ui/Menu'
import { dialog } from '@/os/overlays'
import { HOME } from '@/os/path'
import { fs } from '@/os/vfs'
import { KLogo } from './KLogo'
import { openLaunchpad } from './ui'
import { appGroups } from './appsMenu'
import { toggleFullscreen, useFullscreen } from '@/os/fullscreen'

interface TopMenu {
  key: string
  label: ReactNode
  className?: string
  items: MenuItem[]
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(t)
  }, [])
  const day = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return (
    <span className="k-topbar-clock" title={now.toLocaleDateString(undefined, { dateStyle: 'full' })}>
      {day}&nbsp;&nbsp;{time}
    </span>
  )
}

export function TopBar() {
  const windows = useWindows((s) => s.windows)
  const focusedId = useWindows((s) => s.focusedId)
  const wm = useWindows.getState()
  const focused = windows.find((w) => w.id === focusedId && !w.minimized) ?? null
  const app = focused ? getApp(focused.appId) ?? null : null
  const appMenus = useWindowMenus((s) => (focused ? s.menus[focused.id] : undefined))
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const status = useServer((s) => s.status)
  const [open, setOpen] = useState<number | null>(null)
  const [anchor, setAnchor] = useState({ x: 0, y: 0 })
  const fullscreen = useFullscreen()

  const menus: TopMenu[] = useMemo(() => {
    const appWins = app ? windows.filter((w) => w.appId === app.id) : []
    const system: TopMenu = {
      key: 'k',
      label: <KLogo size={13} />,
      className: 'logo',
      items: [
        { label: 'About KherveOS', onClick: () => wm.open('settings', { section: 'about' }) },
        '-',
        // The applications, by group — the same menu as the Dock's KApps button.
        ...appGroups((id) => wm.open(id)),
        '-',
        { label: 'System Settings…', onClick: () => wm.open('settings') },
        { label: 'Launchpad', onClick: openLaunchpad },
        { label: fullscreen ? 'Exit Full Screen' : 'Enter Full Screen', onClick: () => void toggleFullscreen() },
        '-',
        { label: 'Restart KherveOS', onClick: () => location.reload() },
        ...(user ? (['-', { label: `Sign out ${user.display_name}…`, onClick: () => void logout() }] as MenuItem[]) : []),
      ],
    }
    const appMenu: TopMenu = app
      ? {
          key: 'app',
          label: app.name,
          className: 'app',
          items: [
            { label: `About ${app.name}`, onClick: () => void dialog.alert(app.description, { title: app.name }) },
            '-',
            { label: 'Settings…', onClick: () => wm.open('settings') },
            '-',
            { label: `Hide ${app.name}`, onClick: () => appWins.forEach((w) => wm.minimize(w.id)) },
            { label: 'Hide Others', onClick: () => windows.filter((w) => w.appId !== app.id).forEach((w) => wm.minimize(w.id)) },
            { label: 'Show All', onClick: () => windows.forEach((w) => w.minimized && wm.focus(w.id)) },
            '-',
            { label: `Quit ${app.name}`, onClick: () => appWins.forEach((w) => void wm.close(w.id)) },
          ],
        }
      : {
          key: 'app',
          label: 'KherveOS',
          className: 'app',
          items: [
            { label: 'About KherveOS', onClick: () => wm.open('settings', { section: 'about' }) },
            { label: 'Settings…', onClick: () => wm.open('settings') },
          ],
        }

    const defaults: MenuBarMenu[] = app
      ? [
          {
            label: 'File',
            items: [
              { label: 'New Window', disabled: !!app.singleton, onClick: () => wm.open(app.id, { _new: Date.now() }) },
              { label: 'Close Window', onClick: () => focused && void wm.close(focused.id) },
            ],
          },
          {
            label: 'Edit',
            items: [
              { label: 'Undo', shortcut: '⌘Z', onClick: () => document.execCommand('undo') },
              { label: 'Redo', shortcut: '⇧⌘Z', onClick: () => document.execCommand('redo') },
              '-',
              { label: 'Cut', shortcut: '⌘X', onClick: () => document.execCommand('cut') },
              { label: 'Copy', shortcut: '⌘C', onClick: () => document.execCommand('copy') },
              { label: 'Select All', shortcut: '⌘A', onClick: () => document.execCommand('selectAll') },
            ],
          },
        ]
      : [
          {
            label: 'File',
            items: [
              { label: 'New Files Window', onClick: () => wm.open('files', { path: HOME, _new: Date.now() }) },
              { label: 'New Folder on Desktop', onClick: async () => {
                const dir = `${HOME}/Desktop`
                await fs.mkdir(`${dir}/${fs.uniqueName(dir, 'New folder')}`)
              } },
            ],
          },
          { label: 'Go', items: [
            { label: 'Home', onClick: () => wm.open('files', { path: HOME }) },
            { label: 'Documents', onClick: () => wm.open('files', { path: `${HOME}/Documents` }) },
            { label: 'Downloads', onClick: () => wm.open('files', { path: `${HOME}/Downloads` }) },
            { label: 'Notebooks', onClick: () => wm.open('files', { path: `${HOME}/Notebooks` }) },
          ] },
        ]

    const own = appMenus ?? defaults
    const hasWindowMenu = own.some((m) => m.label === 'Window')
    const hasHelpMenu = own.some((m) => m.label === 'Help')
    const windowMenu: MenuBarMenu = {
      label: 'Window',
      items: [
        { label: 'Minimise', disabled: !focused, onClick: () => focused && wm.minimize(focused.id) },
        { label: 'Zoom', disabled: !focused, onClick: () => focused && wm.toggleMaximize(focused.id) },
        { label: 'Tile Left', disabled: !focused, onClick: () => focused && wm.snap(focused.id, 'left') },
        { label: 'Tile Right', disabled: !focused, onClick: () => focused && wm.snap(focused.id, 'right') },
        '-',
        { label: 'Bring All to Front', disabled: !windows.length, onClick: () => windows.forEach((w) => wm.focus(w.id)) },
        ...(windows.length ? (['-'] as MenuItem[]) : []),
        ...windows.map((w) => ({ label: w.title, checked: w.id === focusedId, onClick: () => wm.focus(w.id) })),
      ],
    }
    const helpMenu: MenuBarMenu = {
      label: 'Help',
      items: [
        { label: 'Welcome to KherveOS', onClick: () => {
          const p = `${HOME}/Desktop/Welcome.txt`
          if (fs.exists(p)) wm.open('notepad', { path: p })
          else wm.open('settings', { section: 'about' })
        } },
        { label: 'Ktools website', onClick: () => wm.open('browser', { url: 'https://khervetools.com' }) },
      ],
    }
    // macOS order: the app's menus, then Window, then Help (the app's own Help if it has one).
    const ownMenus = own.filter((m) => m.label !== 'Help')
    const ownHelp = own.find((m) => m.label === 'Help')
    return [
      system,
      appMenu,
      ...ownMenus.map((m) => ({ key: `m-${m.label}`, label: m.label, items: m.items })),
      ...(hasWindowMenu ? [] : [{ key: 'window', label: 'Window', items: windowMenu.items }]),
      ...(ownHelp
        ? [{ key: 'm-Help', label: 'Help', items: ownHelp.items }]
        : hasHelpMenu ? [] : [{ key: 'help', label: 'Help', items: helpMenu.items }]),
    ]
  }, [app, appMenus, focused, focusedId, windows, user, logout, wm, fullscreen])

  // Close the open menu on outside click / Escape / blur.
  useEffect(() => {
    if (open === null) return
    const close = () => setOpen(null)
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.k-menu, .k-topbar-item')) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [open])

  // The menu set changes when another app comes forward; drop a stale open menu.
  useEffect(() => setOpen(null), [focusedId])

  const openAt = (i: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setAnchor({ x: r.left, y: r.bottom + 1 })
    setOpen(i)
  }

  return (
    <>
    <div className="k-topbar" onContextMenu={(e) => e.preventDefault()}>
      <div className="k-topbar-menus">
        {menus.map((m, i) => (
          <button
            key={m.key}
            className={`k-topbar-item ${m.className ?? ''}${open === i ? ' open' : ''}`}
            onPointerDown={(e) => {
              e.preventDefault()
              if (open === i) setOpen(null)
              else openAt(i, e.currentTarget)
            }}
            onMouseEnter={(e) => open !== null && open !== i && openAt(i, e.currentTarget)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="k-topbar-status">
        <button
          className="k-topbar-icon"
          title={
            status === 'online'
              ? `KherveOS server connected${user ? ` — signed in as ${user.display_name}` : ''}`
              : status === 'checking' ? 'Looking for the KherveOS server…' : 'KherveOS server not running (Messages, Email and games need it)'
          }
          onClick={() => void useServer.getState().check()}
        >
          {status === 'online' ? <Server size={14} /> : <ServerOff size={14} className="k-dim" />}
        </button>
        <button
          className="k-topbar-icon"
          title={fullscreen ? 'Exit full screen (hold Esc)' : 'Full screen — hide the browser around KherveOS'}
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button className="k-topbar-icon" title="Search apps and files" onClick={openLaunchpad}>
          <Search size={14} />
        </button>
        <Clock />
      </div>
    </div>
    {open !== null && menus[open] && (
      <MenuList items={menus[open].items} x={anchor.x} y={anchor.y} minWidth={210} onClose={() => setOpen(null)} />
    )}
    </>
  )
}
