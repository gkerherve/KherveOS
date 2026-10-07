// The Browser: tabs of web pages in sandboxed iframes. "You do not want to
// leave the OS": every web link in KherveOS opens here (os.openUrl).
//
// A page is shown one of three ways (urls.ts `viaFor`):
//   direct  framed as it is — sites that allow it. A refused frame can't be
//           detected (it stays blank), so these get a dismissible "Blank page?"
//           hint with "Show through KherveOS".
//   fetch   through the KherveOS page fetcher (server/kherveos_server/webfetch.py):
//           sites known to refuse framing, and those the user chose. The page
//           gets an opaque origin (no KherveOS cookies or storage) and tells us
//           where it is, so the address bar follows its links.
//   real    sign-ins and sites that turn programs away: a page offering the
//           real browser, the only way out of KherveOS.

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import {
  ArrowLeft, ArrowRight, Copy, ExternalLink, FileText, Globe, House, Info, LoaderCircle, Lock, Plus, RotateCw, Search,
  ShieldCheck, ShieldOff, X,
} from 'lucide-react'
import { os, fs, HOME, type AppArgs, type AppProps } from '@/os'
import { useSettings } from '@/os/settings'
import { WebView } from '@/os/ui/WebView'
import type { FrameMessage } from '@/os/webfetch'
import { BlockedPage, FileFrame, StartPage } from './pages'
import { useBrowserPrefs } from './prefs'
import { SEARCH_ENGINES, type SearchEngine } from './sites'
import {
  START_PAGE, describe, displayAddress, editAddress, engineById, engineNeedsRealBrowser, fileAddress, isFrameBlocked,
  loadsInFrame, pageFor, realTabUrl, resolveInput, sameAddress, viaFor,
} from './urls'
import './browser.css'

/** Something the page could not do, shown in a bar above it. */
interface Notice {
  message: string
}

interface Tab {
  id: number
  /** The addresses this tab went through; `index` is the current one. */
  history: string[]
  index: number
  /** Bumped by every navigation and reload. It keys the page, so each one gets a fresh frame. */
  nav: number
  /** The address the frame was loaded with (fetched pages move on by themselves and tell us). */
  shown: string
  loading: boolean
  /** Frame loads since the last navigation; a second one means the page moved on by itself. */
  loads: number
  /** The page's own title, when it told us. */
  title?: string
  notice: Notice | null
}

interface TabsState {
  tabs: Tab[]
  active: number
}

const HISTORY_MAX = 100
let lastTabId = 0

const fetchHostsNow = () => useBrowserPrefs.getState().fetchHosts

function makeTab(address: string): Tab {
  return {
    id: ++lastTabId, history: [address], index: 0, nav: 0, shown: address,
    loading: loadsInFrame(address, fetchHostsNow()), loads: 0, notice: null,
  }
}

/** Show history entry `index` (in a fresh frame). */
function visit(t: Tab, index: number, history = t.history): Tab {
  const shown = history[index]
  return {
    ...t, history, index, nav: t.nav + 1, shown, loading: loadsInFrame(shown, fetchHostsNow()), loads: 0,
    title: undefined, notice: null,
  }
}

function resolveText(text: string, engine: SearchEngine): string | null {
  return resolveInput(text, { engine, isFile: (p) => fs.isFile(p), home: HOME })?.address ?? null
}

/** The address to open for `args`: a file from the drive (args.path) or a web address (args.url). */
function argsAddress(args: AppArgs, engine: SearchEngine): string | null {
  if (typeof args.path === 'string' && args.path) return fileAddress(args.path)
  if (typeof args.url === 'string' && args.url) return resolveText(args.url, engine)
  return null
}

export default function Browser({ win, args }: AppProps) {
  const homeSetting = useSettings((s) => s.browserHome)
  const engine = engineById(useBrowserPrefs((s) => s.engine))
  const setEngine = useBrowserPrefs((s) => s.setEngine)
  const quietHosts = useBrowserPrefs((s) => s.quietHosts)
  const quiet = useBrowserPrefs((s) => s.quiet)
  const fetchHosts = useBrowserPrefs((s) => s.fetchHosts)
  const setFetched = useBrowserPrefs((s) => s.setFetched)

  const home = resolveText(homeSetting || START_PAGE, engine) ?? START_PAGE

  const [state, setState] = useState<TabsState>(() => {
    const first = makeTab(argsAddress(args, engine) ?? home)
    return { tabs: [first], active: first.id }
  })
  const tab = state.tabs.find((t) => t.id === state.active) ?? state.tabs[0]
  const address = tab.history[tab.index]
  const page = pageFor(address, fetchHosts)
  const info = describe(address, tab.title)
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

  /** Typed text (address bar, start page): go there, or search. */
  const submit = useCallback(
    (id: number, text: string): boolean => {
      const to = resolveText(text, engine)
      if (!to) return false
      navigate(id, to)
      return true
    },
    [engine, navigate],
  )
  const openLink = useCallback(
    (id: number, url: string, newTab: boolean) => {
      const to = resolveText(url, engine)
      if (!to) return
      if (newTab) openTab(to, false)
      else navigate(id, to)
    },
    [engine, navigate, openTab],
  )

  /** What a fetched page told us (frame `nav` of tab `id`). */
  const onFrameMessage = useCallback(
    (id: number, nav: number, m: FrameMessage) => {
      switch (m.type) {
        case 'location':
          update(id, (t) => {
            if (t.nav !== nav) return t
            const title = m.title || t.title
            if (sameAddress(t.history[t.index], m.url)) return { ...t, title }
            if (t.loads === 0) {
              // Still the first page of this frame: it was redirected.
              const history = t.history.map((a, i) => (i === t.index ? m.url : a))
              return { ...t, history, title: m.title || undefined }
            }
            // A link followed inside the frame: a new history entry, same frame.
            const history = [...t.history.slice(0, t.index + 1), m.url].slice(-HISTORY_MAX)
            return { ...t, history, index: history.length - 1, title: m.title || undefined, notice: null }
          })
          break
        case 'navigate':
          // Sign-in pages and the like get the "real browser" page instead of a broken copy.
          if (viaFor(new URL(m.url), fetchHostsNow()) === 'real') navigate(id, m.url)
          else update(id, (t) => (t.nav === nav ? { ...t, loading: true } : t))
          break
        case 'open':
          if (/^https?:/i.test(m.url)) openTab(resolveText(m.url, engine) ?? m.url, !m.background)
          else os.openUrl(m.url)
          break
        case 'form':
          update(id, (t) =>
            t.nav === nav
              ? { ...t, notice: { message: 'This form sends information (a sign-in, a comment, an order…): only your real browser can do that.' } }
              : t,
          )
          break
        case 'error':
          update(id, (t) => (t.nav === nav ? { ...t, loading: false, notice: { message: m.message } } : t))
          break
      }
    },
    [update, navigate, openTab, engine],
  )

  const showThrough = (host: string, on: boolean) => {
    setFetched(host, on)
    reload(tab.id) // (visit reads the new choice from the store)
  }

  // ------------------------------------------------------ window and args

  useEffect(() => {
    win.setTitle(`Browser — ${info.name}`)
  }, [win, info.name])

  // Opening a file or address again in this window (os.openUrl): show it in a tab.
  const seenArgs = useRef(args)
  useEffect(() => {
    if (seenArgs.current === args) return
    seenArgs.current = args
    const to = argsAddress(args, engine)
    if (!to) return
    const background = args.background === true
    setState((s) => {
      const open = s.tabs.find((t) => t.history[t.index] === to)
      if (open) return { tabs: s.tabs.map((t) => (t === open ? visit(t, t.index) : t)), active: background ? s.active : open.id }
      const t = makeTab(to)
      return { tabs: [...s.tabs, t], active: background ? s.active : t.id }
    })
  }, [args, engine])

  // ---------------------------------------------------------- address bar

  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<{ tab: number; text: string } | null>(null)
  const editing = draft !== null && draft.tab === tab.id
  const moved = page.kind === 'web' && page.via === 'direct' && tab.loads > 1
  const AddressIcon =
    page.kind === 'start'
      ? Search
      : page.kind === 'file'
        ? FileText
        : page.via === 'real'
          ? ShieldOff
          : page.via === 'fetch'
            ? ShieldCheck
            : page.url.startsWith('https:')
              ? Lock
              : Globe
  const addressTitle =
    page.kind === 'web' && page.via === 'fetch'
      ? 'Shown through KherveOS: this site refuses to be framed, so KherveOS fetches it for you. Its scripts run sealed ' +
        'off from your KherveOS session, and it keeps no cookies (no sign-ins).'
      : moved && !editing
        ? 'The page has moved on since — KherveOS can’t see addresses inside other sites. Reload comes back here.'
        : undefined

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
      { label: 'Open in your real browser', icon: ExternalLink, disabled: !realUrl, onClick: () => realUrl && os.openInRealBrowser(realUrl) },
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
  const webHost = page.kind === 'web' ? page.host : null
  const webVia = page.kind === 'web' ? page.via : null
  const alwaysFetched = page.kind === 'web' && isFrameBlocked(new URL(page.url))
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
          { label: 'Open in Your Real Browser', icon: ExternalLink, disabled: !real, onClick: () => real && os.openInRealBrowser(real) },
          '-',
          { label: tabCount > 1 ? 'Close Tab' : 'Close Window', icon: X, onClick: () => closeTab(tab.id) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Reload', icon: RotateCw, onClick: () => reload(tab.id) },
          {
            label: 'Show Through KherveOS',
            icon: ShieldCheck,
            checked: webVia === 'fetch',
            disabled: !webHost || webVia === 'real' || alwaysFetched,
            onClick: () => webHost && showThrough(webHost, webVia !== 'fetch'),
          },
          '-',
          {
            label: 'Search Engine',
            icon: Search,
            submenu: SEARCH_ENGINES.map((en) => ({
              label: engineNeedsRealBrowser(en) ? `${en.name} — needs your real browser` : en.name,
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
    // (closeTab and showThrough are rebuilt every render; tabCount / webVia refresh them when that matters)
  }, [win, tab.id, canBack, canForward, real, home, engine, tabCount, webHost, webVia, alwaysFetched, openTab, reload, step, navigate, setEngine])
  useEffect(() => () => win.setMenus(null), [win])

  const hintHost = page.kind === 'web' && page.via === 'direct' && tab.loads > 0 && !quietHosts.includes(page.host) ? page.host : null

  return (
    <div className="k-app br-app" onKeyDown={onKeyDown}>
      <div className="br-tabstrip">
        <div className="br-tabs" role="tablist" aria-label="Tabs">
          {state.tabs.map((t) => {
            const at = t.history[t.index]
            const p = pageFor(at, fetchHosts)
            const Icon = p.kind === 'start' ? House : p.kind === 'file' ? FileText : p.via === 'real' ? ShieldOff : Globe
            const label = describe(at, t.title).title
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
        <div className={`br-address${moved && !editing ? ' moved' : ''}`} title={addressTitle}>
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
          title={real ? 'Open in your real browser' : 'Only web pages can open in your real browser'}
          aria-label="Open in your real browser"
          disabled={!real}
          onClick={() => real && os.openInRealBrowser(real)}
        >
          <ExternalLink size={16} />
        </button>
      </div>

      {tab.notice ? (
        <div className="br-hint br-notice" role="status">
          <Info size={14} className="br-hint-icon" />
          <span className="br-hint-text" title={tab.notice.message}>
            {tab.notice.message}
          </span>
          <button className="k-link-btn br-hint-link" onClick={() => real && os.openInRealBrowser(real)}>
            Open in your real browser
          </button>
          <button
            className="k-icon-btn br-hint-close"
            title="Hide"
            aria-label="Hide"
            onClick={() => update(tab.id, (t) => ({ ...t, notice: null }))}
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        hintHost && (
          <div className="br-hint" role="status">
            <Info size={14} className="br-hint-icon" />
            <span className="br-hint-text">Blank page? Some sites refuse to be shown inside other apps —</span>
            <button className="k-link-btn br-hint-link" onClick={() => showThrough(hintHost, true)}>
              Show through KherveOS
            </button>
            <span className="br-hint-text">or</span>
            <button className="k-link-btn br-hint-link" onClick={() => real && os.openInRealBrowser(real)}>
              open in your real browser
            </button>
            <button
              className="k-icon-btn br-hint-close"
              title="Don't show this again for this site"
              aria-label="Don't show this again for this site"
              onClick={() => quiet(hintHost)}
            >
              <X size={13} />
            </button>
          </div>
        )
      )}

      <div className="br-pages">
        {tab.loading && <div className="br-progress" />}
        {state.tabs.map((t) => (
          <TabPage
            key={t.id}
            tab={t}
            active={t.id === tab.id}
            engine={engine}
            fetchHosts={fetchHosts}
            onLoaded={loaded}
            onSubmit={submit}
            onOpen={openLink}
            onEngine={setEngine}
            onStep={step}
            onFrameMessage={onFrameMessage}
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
  fetchHosts: string[]
  onLoaded: (id: number, nav: number) => void
  onSubmit: (id: number, text: string) => boolean
  onOpen: (id: number, url: string, newTab: boolean) => void
  onEngine: (id: string) => void
  onStep: (id: number, delta: number) => void
  onFrameMessage: (id: number, nav: number, m: FrameMessage) => void
}

/** One tab's page. Every tab stays mounted (hidden when inactive) so its page keeps its state. */
const TabPage = memo(function TabPage({
  tab, active, engine, fetchHosts, onLoaded, onSubmit, onOpen, onEngine, onStep, onFrameMessage,
}: TabPageProps) {
  // The frame shows `shown`; a fetched page that followed a link has moved the history on without a new frame.
  const page = pageFor(tab.shown, fetchHosts)
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
  } else if (page.via === 'real') {
    content = (
      <BlockedPage
        key={tab.nav}
        host={page.host}
        onOpenReal={() => os.openInRealBrowser(realTabUrl(tab.shown) ?? page.url)}
        onBack={tab.index > 0 ? () => onStep(tab.id, -1) : undefined}
      />
    )
  } else {
    content = (
      <WebView
        key={`${tab.nav}-${page.via}`}
        url={page.url}
        via={page.via}
        title={page.host}
        onLoad={done}
        onMessage={(m) => onFrameMessage(tab.id, tab.nav, m)}
      />
    )
  }
  return (
    <div className={`br-page${active ? '' : ' br-hidden'}`} aria-hidden={active ? undefined : true}>
      {content}
    </div>
  )
})
