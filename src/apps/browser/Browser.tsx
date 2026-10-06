// The Browser: tabs of web pages in sandboxed iframes. There is no proxy, on
// purpose. Sites that refuse to be framed (X-Frame-Options, CSP
// frame-ancestors) can't be shown, and a refused frame can't be detected — it
// just stays blank — so known ones get an "Open in a real tab" page and every
// other page a dismissible hint. Clicks inside a page navigate without telling
// us, so the address bar may lag behind; Reload goes back to what it shows.

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import {
  ArrowLeft, ArrowRight, Copy, ExternalLink, FileText, Globe, House, Info, LoaderCircle, Lock, Plus, RotateCw, Search,
  ShieldOff, X,
} from 'lucide-react'
import { os, fs, HOME, type AppArgs, type AppProps } from '@/os'
import { useSettings } from '@/os/settings'
import { BlockedPage, FileFrame, StartPage, WebFrame } from './pages'
import { useBrowserPrefs } from './prefs'
import { SEARCH_ENGINES, type SearchEngine } from './sites'
import {
  START_PAGE, describe, displayAddress, editAddress, engineById, fileAddress, loadsInFrame, pageFor, realTabUrl,
  resolveInput, type Target,
} from './urls'
import './browser.css'

interface Tab {
  id: number
  /** The addresses we sent this tab to; `index` is the current one. */
  history: string[]
  index: number
  /** Bumped by every navigation and reload. It keys the page, so each one gets a fresh frame. */
  nav: number
  loading: boolean
  /** Frame loads since the last navigation; a second one means the page moved on by itself. */
  loads: number
}

interface TabsState {
  tabs: Tab[]
  active: number
}

const HISTORY_MAX = 100
let lastTabId = 0

function makeTab(address: string): Tab {
  return { id: ++lastTabId, history: [address], index: 0, nav: 0, loading: loadsInFrame(address), loads: 0 }
}

/** Show history entry `index` (in a fresh frame). */
function visit(t: Tab, index: number, history = t.history): Tab {
  return { ...t, history, index, nav: t.nav + 1, loading: loadsInFrame(history[index]), loads: 0 }
}

function openReal(url: string) {
  window.open(url, '_blank', 'noopener')
}

function resolveText(text: string, engine: SearchEngine): Target | null {
  return resolveInput(text, { engine, isFile: (p) => fs.isFile(p), home: HOME })
}

/** The address to open for `args`: a file from the drive (args.path) or a web address (args.url). */
function argsAddress(args: AppArgs, engine: SearchEngine): string | null {
  if (typeof args.path === 'string' && args.path) return fileAddress(args.path)
  if (typeof args.url === 'string' && args.url) {
    const target = resolveText(args.url, engine)
    if (target && 'address' in target) return target.address
  }
  return null
}

export default function Browser({ win, args }: AppProps) {
  const homeSetting = useSettings((s) => s.browserHome)
  const engine = engineById(useBrowserPrefs((s) => s.engine))
  const setEngine = useBrowserPrefs((s) => s.setEngine)
  const quietHosts = useBrowserPrefs((s) => s.quietHosts)
  const quiet = useBrowserPrefs((s) => s.quiet)

  const homeTarget = resolveText(homeSetting || START_PAGE, engine)
  const home = homeTarget && 'address' in homeTarget ? homeTarget.address : START_PAGE

  const [state, setState] = useState<TabsState>(() => {
    const first = makeTab(argsAddress(args, engine) ?? home)
    return { tabs: [first], active: first.id }
  })
  const tab = state.tabs.find((t) => t.id === state.active) ?? state.tabs[0]
  const address = tab.history[tab.index]
  const page = pageFor(address)
  const info = describe(address)
  const real = realTabUrl(address)

  // ------------------------------------------------------------- actions

  const update = useCallback(
    (id: number, fn: (t: Tab) => Tab) => setState((s) => ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? fn(t) : t)) })),
    [],
  )
  const navigate = useCallback(
    (id: number, to: string) =>
      update(id, (t) => {
        const history = [...t.history.slice(0, t.index + 1), to].slice(-HISTORY_MAX)
        return visit(t, history.length - 1, history)
      }),
    [update],
  )
  const step = useCallback(
    (id: number, delta: number) => update(id, (t) => (t.history[t.index + delta] === undefined ? t : visit(t, t.index + delta))),
    [update],
  )
  const reload = useCallback((id: number) => update(id, (t) => visit(t, t.index)), [update])
  const loaded = useCallback(
    (id: number, nav: number) => update(id, (t) => (t.nav === nav ? { ...t, loading: false, loads: t.loads + 1 } : t)),
    [update],
  )
  const openTab = useCallback((to: string, activate = true) => {
    setState((s) => {
      const t = makeTab(to)
      return { tabs: [...s.tabs, t], active: activate ? t.id : s.active }
    })
  }, [])
  const closeTab = (id: number) => {
    if (state.tabs.length <= 1) {
      win.close()
      return
    }
    setState((s) => {
      const i = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      if (i < 0 || !tabs.length) return s
      return { tabs, active: s.active === id ? tabs[Math.min(i, tabs.length - 1)].id : s.active }
    })
  }

  /** Typed text (address bar, start page): go there, search, or open a real tab for engines that can't be framed. */
  const submit = useCallback(
    (id: number, text: string): boolean => {
      const target = resolveText(text, engine)
      if (!target) return false
      if ('external' in target) openReal(target.external)
      else navigate(id, target.address)
      return true
    },
    [engine, navigate],
  )
  const openLink = useCallback(
    (id: number, url: string, newTab: boolean) => {
      const target = resolveText(url, engine)
      if (!target) return
      if ('external' in target) openReal(target.external)
      else if (newTab) openTab(target.address, false)
      else navigate(id, target.address)
    },
    [engine, navigate, openTab],
  )

  // ------------------------------------------------------ window and args

  useEffect(() => {
    win.setTitle(`Browser — ${info.name}`)
  }, [win, info.name])

  // Opening a file or address again in this window: show it in a tab (reloading one that already has it).
  const seenArgs = useRef(args)
  useEffect(() => {
    if (seenArgs.current === args) return
    seenArgs.current = args
    const to = argsAddress(args, engine)
    if (!to) return
    setState((s) => {
      const open = s.tabs.find((t) => t.history[t.index] === to)
      if (open) return { tabs: s.tabs.map((t) => (t === open ? visit(t, t.index) : t)), active: open.id }
      const t = makeTab(to)
      return { tabs: [...s.tabs, t], active: t.id }
    })
  }, [args, engine])

  // ---------------------------------------------------------- address bar

  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<{ tab: number; text: string } | null>(null)
  const editing = draft !== null && draft.tab === tab.id
  const moved = page.kind === 'web' && tab.loads > 1
  const AddressIcon =
    page.kind === 'start' ? Search : page.kind === 'file' ? FileText : page.blocked ? ShieldOff : page.url.startsWith('https:') ? Lock : Globe

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')
    if (mod && key === 'l') {
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    } else if (e.key === 'F5' || (mod && key === 'r')) {
      e.preventDefault() // reload the tab, not KherveOS
      reload(tab.id)
    } else if (!typing && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      step(tab.id, e.key === 'ArrowLeft' ? -1 : 1)
    }
  }

  const tabMenu = (e: MouseEvent, t: Tab) => {
    e.preventDefault()
    const at = t.history[t.index]
    const realUrl = realTabUrl(at)
    os.contextMenu(e, [
      { label: 'New tab', icon: Plus, onClick: () => openTab(home) },
      { label: 'Reload', icon: RotateCw, onClick: () => reload(t.id) },
      { label: 'Duplicate', icon: Copy, onClick: () => openTab(at) },
      { label: 'Open in a real tab', icon: ExternalLink, disabled: !realUrl, onClick: () => realUrl && openReal(realUrl) },
      '-',
      { label: 'Close tab', icon: X, onClick: () => closeTab(t.id) },
      {
        label: 'Close other tabs',
        disabled: state.tabs.length < 2,
        onClick: () => setState((s) => ({ tabs: s.tabs.filter((x) => x.id === t.id), active: t.id })),
      },
    ])
  }

  // ------------------------------------------- menus in the top menu bar

  const canBack = tab.index > 0
  const canForward = tab.index < tab.history.length - 1
  const tabCount = state.tabs.length
  useEffect(() => {
    win.setMenus([
      {
        label: 'File',
        items: [
          { label: 'New Tab', icon: Plus, onClick: () => openTab(home) },
          {
            label: 'Open Location…',
            onClick: () => {
              inputRef.current?.focus()
              inputRef.current?.select()
            },
          },
          '-',
          { label: 'Open in Real Browser Tab', icon: ExternalLink, disabled: !real, onClick: () => real && openReal(real) },
          '-',
          { label: tabCount > 1 ? 'Close Tab' : 'Close Window', icon: X, onClick: () => closeTab(tab.id) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Reload', icon: RotateCw, onClick: () => reload(tab.id) },
          '-',
          {
            label: 'Search Engine',
            icon: Search,
            submenu: SEARCH_ENGINES.map((en) => ({
              label: en.framable ? en.name : `${en.name} — opens a real tab`,
              checked: en.id === engine.id,
              onClick: () => setEngine(en.id),
            })),
          },
        ],
      },
      {
        label: 'History',
        items: [
          { label: 'Back', icon: ArrowLeft, disabled: !canBack, onClick: () => step(tab.id, -1) },
          { label: 'Forward', icon: ArrowRight, disabled: !canForward, onClick: () => step(tab.id, 1) },
          '-',
          { label: 'Home', icon: House, onClick: () => navigate(tab.id, home) },
        ],
      },
    ])
    // (closeTab is rebuilt every render; tabCount refreshes it when that matters)
  }, [win, tab.id, canBack, canForward, real, home, engine, tabCount, openTab, reload, step, navigate, setEngine])
  useEffect(() => () => win.setMenus(null), [win])

  const showHint = page.kind === 'web' && !page.blocked && tab.loads > 0 && !quietHosts.includes(page.host)

  return (
    <div className="k-app br-app" onKeyDown={onKeyDown}>
      <div className="br-tabstrip">
        <div className="br-tabs" role="tablist" aria-label="Tabs">
          {state.tabs.map((t) => {
            const at = t.history[t.index]
            const p = pageFor(at)
            const Icon = p.kind === 'start' ? House : p.kind === 'file' ? FileText : p.blocked ? ShieldOff : Globe
            const label = describe(at).title
            const selected = t.id === tab.id
            return (
              <div
                key={t.id}
                role="tab"
                aria-selected={selected}
                className={`br-tab${selected ? ' active' : ''}`}
                title={label}
                onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                onClick={() => setState((s) => ({ ...s, active: t.id }))}
                onAuxClick={(e) => {
                  if (e.button !== 1) return
                  e.preventDefault()
                  closeTab(t.id)
                }}
                onContextMenu={(e) => tabMenu(e, t)}
              >
                <span className="br-tab-icon">{t.loading ? <LoaderCircle size={13} className="k-spin" /> : <Icon size={13} />}</span>
                <span className="br-tab-title">{label}</span>
                <button
                  className="br-tab-close"
                  aria-label={`Close ${label}`}
                  title="Close tab"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(t.id)
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>
        <button className="k-icon-btn br-newtab" title="New tab" aria-label="New tab" onClick={() => openTab(home)}>
          <Plus size={16} />
        </button>
      </div>

      <div className="k-toolbar br-toolbar">
        <button className="k-icon-btn" title="Back" aria-label="Back" disabled={tab.index === 0} onClick={() => step(tab.id, -1)}>
          <ArrowLeft size={16} />
        </button>
        <button
          className="k-icon-btn"
          title="Forward"
          aria-label="Forward"
          disabled={tab.index >= tab.history.length - 1}
          onClick={() => step(tab.id, 1)}
        >
          <ArrowRight size={16} />
        </button>
        <button className="k-icon-btn" title="Reload" aria-label="Reload" onClick={() => reload(tab.id)}>
          <RotateCw size={15} />
        </button>
        <button className="k-icon-btn" title="Home" aria-label="Home" onClick={() => navigate(tab.id, home)}>
          <House size={16} />
        </button>
        <div
          className={`br-address${moved && !editing ? ' moved' : ''}`}
          title={moved && !editing ? 'The page has moved on since — KherveOS can’t see addresses inside other sites. Reload comes back here.' : undefined}
        >
          <AddressIcon size={14} className="br-address-icon" />
          <input
            ref={inputRef}
            className="br-address-input"
            value={editing ? draft.text : displayAddress(address)}
            placeholder={`Search with ${engine.name} or type an address`}
            aria-label="Address"
            spellCheck={false}
            autoComplete="off"
            onFocus={(e) => {
              const el = e.currentTarget
              setDraft({ tab: tab.id, text: editAddress(address) })
              requestAnimationFrame(() => el.select())
            }}
            onChange={(e) => setDraft({ tab: tab.id, text: e.target.value })}
            onBlur={() => setDraft(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (submit(tab.id, e.currentTarget.value)) e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                setDraft(null)
                e.currentTarget.blur()
              }
            }}
          />
        </div>
        <button
          className="k-icon-btn"
          title={real ? 'Open in a real browser tab' : 'Only web pages can open in a real browser tab'}
          aria-label="Open in a real browser tab"
          disabled={!real}
          onClick={() => real && openReal(real)}
        >
          <ExternalLink size={16} />
        </button>
      </div>

      {showHint && (
        <div className="br-hint" role="status">
          <Info size={14} className="br-hint-icon" />
          <span className="br-hint-text">Blank page? Some sites block being shown inside other apps —</span>
          <button className="k-link-btn br-hint-link" onClick={() => real && openReal(real)}>
            Open in a real tab
          </button>
          <button
            className="k-icon-btn br-hint-close"
            title="Don't show this again for this site"
            aria-label="Don't show this again for this site"
            onClick={() => quiet(page.host)}
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div className="br-pages">
        {tab.loading && <div className="br-progress" />}
        {state.tabs.map((t) => (
          <TabPage
            key={t.id}
            tab={t}
            active={t.id === tab.id}
            engine={engine}
            onLoaded={loaded}
            onSubmit={submit}
            onOpen={openLink}
            onEngine={setEngine}
            onStep={step}
          />
        ))}
      </div>
    </div>
  )
}

interface TabPageProps {
  tab: Tab
  active: boolean
  engine: SearchEngine
  onLoaded: (id: number, nav: number) => void
  onSubmit: (id: number, text: string) => boolean
  onOpen: (id: number, url: string, newTab: boolean) => void
  onEngine: (id: string) => void
  onStep: (id: number, delta: number) => void
}

/** One tab's page. Every tab stays mounted (hidden when inactive) so its page keeps its state. */
const TabPage = memo(function TabPage({ tab, active, engine, onLoaded, onSubmit, onOpen, onEngine, onStep }: TabPageProps) {
  const address = tab.history[tab.index]
  const page = pageFor(address)
  const done = () => onLoaded(tab.id, tab.nav)
  let content
  if (page.kind === 'start') {
    content = (
      <StartPage
        key={tab.nav}
        active={active}
        engine={engine}
        onEngine={onEngine}
        onSubmit={(text) => onSubmit(tab.id, text)}
        onOpen={(url, newTab) => onOpen(tab.id, url, newTab)}
      />
    )
  } else if (page.kind === 'file') {
    content = <FileFrame key={tab.nav} path={page.path} onLoad={done} />
  } else if (page.blocked) {
    content = (
      <BlockedPage
        key={tab.nav}
        host={page.host}
        onOpenReal={() => openReal(realTabUrl(address) ?? page.url)}
        onBack={tab.index > 0 ? () => onStep(tab.id, -1) : undefined}
      />
    )
  } else {
    content = <WebFrame key={tab.nav} url={page.url} title={page.host} onLoad={done} />
  }
  return (
    <div className={`br-page${active ? '' : ' br-hidden'}`} aria-hidden={active ? undefined : true}>
      {content}
    </div>
  )
})
