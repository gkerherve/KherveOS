// "Other Databases & Properties": the desktop KherveDB 5.0's tabbed window,
// as a KherveOS window (KherveDB opened with { references: true }). One tab per
// database — XPS Fitting, Harwell XPS Guru, Thermo Knowledge and two Google
// Scholar searches — each an embedded browser that follows the element selected
// in the periodic table, plus the element's General Properties.
//
// The sites are shown through the KherveOS page fetcher (os/ui/WebView), which
// also declines their cookie banners, as the desktop does; links inside them
// stay in the tab, and Back / Forward / Home / Reload work on the tab. "Open in
// KherveOS Browser" takes the page to the Browser.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Atom, BookOpen, ChartSpline, ExternalLink, FlaskConical, Globe, GraduationCap, House, Info, LoaderCircle,
  RotateCw, ScrollText, Search, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { os, type AppProps } from '@/os'
import { WebView } from '@/os/ui/WebView'
import type { FrameMessage } from '@/os/webfetch'
import { loadAll, loadedData, type KdbData } from './data'
import { PropsPage } from './PropsPage'
import { useRefs } from './platform'
import { loadPrefs, savePrefs } from './prefs'
import { busy, follow, go, loaded, located, noticed, reload, step, sync, type Frames } from './refFrames'
import { PROPS_TAB, SOURCES, elementName, sourceUrl } from './sources'

const DATA = `${import.meta.env.BASE_URL}apps/khervedb/`

export const SOURCE_ICONS: Record<string, LucideIcon> = {
  xpsfitting: ChartSpline,
  harwell: BookOpen,
  thermo: FlaskConical,
  sss: ScrollText,
  estr: GraduationCap,
}

const TABS: { id: string; title: string; help: string; icon: LucideIcon }[] = [
  ...SOURCES.map((s) => ({ id: s.id, title: s.title, help: s.help, icon: SOURCE_ICONS[s.id] ?? Globe })),
  { id: PROPS_TAB.id, title: PROPS_TAB.title, help: PROPS_TAB.help, icon: Atom },
]

const FOLLOW_HELP = 'Click another element in the kDB window and every tab follows it.'

function validTab(id: string | null | undefined): string {
  return TABS.some((t) => t.id === id) ? (id as string) : TABS[0].id
}

export default function ReferencesWindow({ win, args }: AppProps) {
  const [data, setData] = useState<KdbData | null>(loadedData)
  const [error, setError] = useState<string | null>(null)
  const storeElement = useRefs((s) => s.element)
  const asked = useRefs((s) => s.asked)
  const askedTab = useRefs((s) => s.tab)
  const [active, setActive] = useState(() => validTab(useRefs.getState().tab ?? loadPrefs().refTab))
  const [newestFirst, setNewestFirst] = useState(() => loadPrefs().newestFirst)
  const [frames, setFrames] = useState<Frames>({})
  const [terms, setTerms] = useState('')

  // This window is the one the main windows talk to.
  useEffect(() => {
    useRefs.setState({ win })
    return () => {
      if (useRefs.getState().win === win) useRefs.setState({ win: null })
    }
  }, [win])

  useEffect(() => {
    if (data) return
    let alive = true
    loadAll(DATA).then(
      (d) => alive && setData(d),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      alive = false
    }
  }, [data])

  const meta = data?.meta
  const wanted = storeElement ?? (typeof args.element === 'string' ? args.element : 'C')
  const element = meta?.elements[wanted] ? wanted : 'C'
  const m = meta?.elements[element] ?? null
  const name = m ? elementName(element, m) : element

  // Opened again from the main window (a menu item for one database): show that tab.
  useEffect(() => {
    if (asked && askedTab) setActive(validTab(askedTab))
  }, [asked, askedTab])

  // The element's page in every tab; the visible one loads now, the others when selected.
  const homes = useMemo(() => {
    if (!m) return null
    // (the newest-first choice applies to the searches the user starts, as on the desktop)
    return Object.fromEntries(SOURCES.map((s) => [s.id, sourceUrl(s, element, m)]))
  }, [element, m])
  useEffect(() => {
    if (!homes) return
    setFrames((f) => follow(f, homes, active))
    setTerms('') // a new element: a fresh search box, as on the desktop
  }, [homes]) // (switching tabs is handled below)
  useEffect(() => {
    setFrames((f) => sync(f, active))
    savePrefs({ refTab: active })
  }, [active])

  useEffect(() => {
    win.setTitle(`Other Databases & Properties – ${element}`)
  }, [win, element])

  const source = SOURCES.find((s) => s.id === active) ?? null
  const frame = source ? frames[source.id] : undefined
  const current = frame ? frame.history[frame.index] : null

  const back = useCallback(() => setFrames((f) => step(f, active, -1, active)), [active])
  const forward = useCallback(() => setFrames((f) => step(f, active, 1, active)), [active])
  const home = useCallback(() => homes?.[active] && setFrames((f) => go(f, active, homes[active], active)), [active, homes])
  const reloadTab = useCallback(() => setFrames((f) => reload(f, active)), [active])
  const search = (sort = newestFirst) => {
    if (!source?.search || !m) return
    setFrames((f) => go(f, source.id, source.search!.query(terms.trim() || name, sort), active))
  }

  const onMessage = (id: string, nav: number, msg: FrameMessage) => {
    switch (msg.type) {
      case 'location':
        setFrames((f) => located(f, id, nav, msg.url))
        break
      case 'navigate':
        setFrames((f) => busy(f, id, nav))
        break
      case 'open':
        os.openUrl(msg.url, { background: msg.background })
        break
      case 'form':
        setFrames((f) => noticed(f, id, nav, 'This form sends information (a sign-in, an order…): only your real browser can do that.'))
        break
      case 'error':
        setFrames((f) => noticed(f, id, nav, msg.message))
        break
    }
  }

  // ---------------------------------------------------------------- menus

  useEffect(() => {
    win.setMenus([
      {
        label: 'File',
        items: [
          { label: 'Open in KherveOS Browser', icon: Globe, disabled: !current, onClick: () => current && os.openUrl(current) },
          { label: 'Open in Your Real Browser', icon: ExternalLink, disabled: !current, onClick: () => current && os.openInRealBrowser(current) },
          '-',
          { label: 'Close Window', icon: X, onClick: () => win.close() },
        ],
      },
      {
        label: 'View',
        items: [
          ...TABS.map((t) => ({ label: t.title, icon: t.icon, checked: t.id === active, onClick: () => setActive(t.id) })),
          '-',
          { label: 'Reload', icon: RotateCw, disabled: !source, onClick: reloadTab },
        ],
      },
      {
        label: 'History',
        items: [
          { label: 'Back', icon: ArrowLeft, disabled: !frame || frame.index === 0, onClick: back },
          { label: 'Forward', icon: ArrowRight, disabled: !frame || frame.index >= frame.history.length - 1, onClick: forward },
          '-',
          { label: `${name} Start Page`, icon: House, disabled: !source, onClick: home },
        ],
      },
    ])
  }, [win, active, current, source, frame, name, back, forward, home, reloadTab])
  useEffect(() => () => win.setMenus(null), [win])

  // ---------------------------------------------------------------- page

  if (!meta || !m || !homes) {
    return (
      <div className="k-app kdb-app kdb-refs">
        <div className="k-center k-muted">{error ? `Could not load the kDB data: ${error}` : <LoaderCircle size={22} className="k-spin" />}</div>
      </div>
    )
  }

  const help = TABS.find((t) => t.id === active)?.help ?? ''
  return (
    <div className="k-app kdb-app kdb-refs">
      <div className="kdb-refbar kdb-refs-tabs" role="tablist" aria-label="Other databases and properties">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active}
            className={t.id === active ? 'kdb-on' : ''}
            title={t.help}
            onClick={() => setActive(t.id)}
          >
            <t.icon size={14} /> {t.title}
          </button>
        ))}
      </div>

      <div className="k-toolbar kdb-refs-toolbar">
        <span className={`kdb-info-sym kdb-cat-${m.cat} kdb-refs-el`} title={`${name} – click another element in the kDB window to follow it here`}>
          {element}
        </span>
        <button type="button" className="k-icon-btn" title="Go back to the previous page" aria-label="Back" disabled={!frame || frame.index === 0} onClick={back}>
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          className="k-icon-btn"
          title="Go forward to the next page"
          aria-label="Forward"
          disabled={!frame || frame.index >= frame.history.length - 1}
          onClick={forward}
        >
          <ArrowRight size={16} />
        </button>
        <button type="button" className="k-icon-btn" title={`Return to the ${name} page of this tab`} aria-label="Home" disabled={!source} onClick={home}>
          <House size={16} />
        </button>
        <button type="button" className="k-icon-btn" title="Reload the current page" aria-label="Reload" disabled={!source} onClick={reloadTab}>
          <RotateCw size={15} />
        </button>
        {source?.search ? (
          <form
            className="kdb-refs-search"
            onSubmit={(e) => {
              e.preventDefault()
              search()
            }}
          >
            <input
              className="k-input"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder={source.search.placeholder}
              title={`Type a material and press Enter or Search.\nThe query sent to Google Scholar is:\n${source.search.describe('<your material>')}`}
              spellCheck={false}
              aria-label={source.search.placeholder}
            />
            <button type="submit" className="k-btn primary">
              <Search size={14} /> Search
            </button>
            {source.search.sortable && (
              <label className="kdb-check" title={'Ticked: most relevant / most-cited papers first.\nUnticked: newest papers first.'}>
                <input
                  type="checkbox"
                  checked={!newestFirst}
                  onChange={(e) => {
                    const newest = !e.target.checked
                    setNewestFirst(newest)
                    savePrefs({ newestFirst: newest })
                    search(newest)
                  }}
                />
                High citations
              </label>
            )}
          </form>
        ) : (
          <span className="kdb-refs-address" title={current ?? ''}>
            {source ? (current ?? '').replace(/^https:\/\//, '') : `${name} — physical and atomic properties, main XPS lines`}
          </span>
        )}
        <button
          type="button"
          className="k-btn"
          title="Open this page in the KherveOS Browser"
          disabled={!current}
          onClick={() => current && os.openUrl(current)}
        >
          <Globe size={14} /> <span className="kdb-refs-wide">Open in KherveOS Browser</span>
        </button>
        <button
          type="button"
          className="k-icon-btn"
          title="Open in your real browser"
          aria-label="Open in your real browser"
          disabled={!current}
          onClick={() => current && os.openInRealBrowser(current)}
        >
          <ExternalLink size={15} />
        </button>
      </div>

      {frame?.notice ? (
        <p className="kdb-refs-hint kdb-refs-notice" role="status" title={frame.notice}>
          <Info size={14} /> <span>{frame.notice}</span>
          <button type="button" className="k-link-btn" onClick={() => current && os.openInRealBrowser(current)}>
            Open in your real browser
          </button>
        </p>
      ) : (
        <p className="kdb-refs-hint" title={`${help}\n${FOLLOW_HELP}`}>
          <Info size={14} /> <span>{help}</span>
        </p>
      )}

      <div className="kdb-refs-pages">
        {frame?.loading && <div className="kdb-refs-progress" />}
        {SOURCES.map((s) => {
          const f = frames[s.id]
          if (!f?.shown) return null // never shown yet
          const on = s.id === active
          return (
            <div key={s.id} className={`kdb-refs-page${on ? '' : ' kdb-hidden'}`} aria-hidden={on ? undefined : true}>
              <WebView
                key={f.nav}
                url={f.shown}
                via="fetch"
                directFallback={s.framable}
                title={s.title}
                className="kdb-refs-frame"
                onLoad={() => setFrames((x) => loaded(x, s.id, f.nav))}
                onMessage={(msg) => onMessage(s.id, f.nav, msg)}
              />
            </div>
          )
        })}
        {active === PROPS_TAB.id && (
          <div className="kdb-refs-page kdb-refs-props">
            <PropsPage el={element} meta={meta} />
          </div>
        )}
      </div>
    </div>
  )
}
