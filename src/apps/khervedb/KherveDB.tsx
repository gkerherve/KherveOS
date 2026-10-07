// KherveDB: the NIST X-ray Photoelectron Spectroscopy binding-energy database
// (recorded in 2019) with a periodic-table browser. Ported from KherveDB-React
// (its web path) and restyled for KherveOS; a few things come from the Python
// KherveDB: Export Filtered Data, copying a reference, the plot's bin width and
// smooth curve, the Simplified Periodic Table.
//
// Opened with { element: 'Fe' } it starts on that element. Opened with
// { references: true } it is the Other Databases & Properties window (RefBar.tsx),
// which follows the element selected here.

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent,
} from 'react'
import {
  Atom, ChartColumn, ClipboardCopy, Copy, FileDown, FilterX, GraduationCap, Info, PanelRight, PanelRightOpen, Search,
} from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuItem } from '@/os'
import {
  elementInfo, exportName, exportText, lineStats, loadAll, loadedData, referenceText, sortRows,
  type KdbData, type Sort, type SortKey,
} from './data'
import PeriodicTable from './PeriodicTable'
import ResultsTable from './ResultsTable'
import BePlot from './BePlot'
import { FloatingWindow, InfoContent, RowDetails } from './Popups'
import ReferencesWindow, { SOURCE_ICONS } from './RefBar'
import { PROPS_TAB, SOURCES, elementName } from './sources'
import { closeReferences, followElement, openInBrowser, openReferences, useRefs } from './platform'
import { SplashScreen, VERSION, Welcome } from './Startup'
import { loadPrefs, savePrefs, type Prefs } from './prefs'
import { tableLayout } from './layout'
import { useAppTools } from '@/os/ai/appTools'
import './khervedb.css'

const DATA = `${import.meta.env.BASE_URL}apps/khervedb/`
/** Keep the starting screen up for at least this long, so it does not just flash. */
const MIN_SPLASH_MS = 1200

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl+'

type Popup =
  | { kind: 'info'; el: string; x?: number; y?: number }
  | { kind: 'row'; row: number }
  | { kind: 'plot' }
  | { kind: 'welcome' }
  | null

// The welcome window greets the first KherveDB window of a session only.
let welcomed = false

/** An element's size, followed as it changes. */
function useSize(el: HTMLElement | null) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    if (!el) return
    const read = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }))
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return size
}

/** The element to show: the one asked for if the NIST data has it, else carbon. */
function startElement(arg: unknown, d: KdbData | null): string {
  const el = typeof arg === 'string' && /^[A-Z][a-z]?$/.test(arg) ? arg : 'C'
  return !d || (d.meta.elements[el] && d.db.elementsWithData().has(el)) ? el : 'C'
}

export default function KherveDB(props: AppProps) {
  return props.args.references ? <ReferencesWindow {...props} /> : <KherveDBMain {...props} />
}

function KherveDBMain({ win, args }: AppProps) {
  const [data, setData] = useState<KdbData | null>(loadedData)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [element, setElement] = useState(() => startElement(args.element, loadedData()))
  const [line, setLine] = useState('')
  const [formula, setFormula] = useState('')
  const [name, setName] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'be', dir: 1 })
  const [popup, setPopup] = useState<Popup>(null)
  const refsOpen = useRefs((s) => s.win !== null)
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [flash, setFlash] = useState<string | null>(null)
  const [main, setMain] = useState<HTMLElement | null>(null)
  const formulaRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const mainSize = useSize(main)

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((p) => ({ ...p, ...patch }))
    savePrefs(patch)
  }, [])

  // ------------------------------------------------------------- loading

  useEffect(() => {
    if (data) return
    let alive = true
    const minimum = new Promise((r) => setTimeout(r, MIN_SPLASH_MS))
    Promise.all([loadAll(DATA), minimum]).then(
      ([d]) => {
        if (!alive) return
        setElement((el) => startElement(el, d))
        setData(d)
      },
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      alive = false
    }
  }, [data, attempt])

  const db = data?.db
  const meta = data?.meta
  const withData = useMemo(() => db?.elementsWithData() ?? new Set<string>(), [db])
  const stats = useMemo(() => (db ? lineStats(db) : []), [db])
  const lines = useMemo(() => (db ? db.linesFor(element) : []), [db, element])
  const rows = useMemo(() => (db ? db.filter(element, line, formula, name) : []), [db, element, line, formula, name])
  const sorted = useMemo(() => (db ? sortRows(db, rows, sort) : []), [db, rows, sort])

  // The welcome window, once the data is there (once per session).
  useEffect(() => {
    if (!data || welcomed) return
    welcomed = true
    if (!prefs.hideWelcome) setPopup((p) => p ?? { kind: 'welcome' })
  }, [data]) // prefs.hideWelcome is only read when the data arrives

  const m = meta?.elements[element] ?? null
  const elName = m ? elementName(element, m) : ''

  useEffect(() => {
    win.setTitle(elName ? `${elName} — KherveDB` : 'KherveDB')
  }, [win, elName])

  // A short message in the results status bar (copied, exported…).
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 3500)
    return () => clearTimeout(t)
  }, [flash])

  // ------------------------------------------------------------- actions

  const select = useCallback((el: string) => {
    setElement(el)
    setLine('')
  }, [])
  // The Other Databases & Properties window follows the element selected here.
  useEffect(() => {
    if (data) followElement(element)
  }, [data, element])
  const open = useCallback(
    (el: string) => {
      select(el)
      openReferences(el)
    },
    [select],
  )
  const toggleReferences = () => (refsOpen ? closeReferences() : openReferences(element))

  // What KherveAI and MCP clients can do here (declared in src/os/ai/appManifest.ts).
  useAppTools(
    win,
    useMemo(
      () => ({
        select_element: async (a: Record<string, unknown>) => {
          const d = data ?? loadedData()
          if (!d) throw new Error('KherveDB is still loading its data: try again in a moment.')
          const wanted = String(a.element ?? '').trim().toLowerCase()
          const sym = Object.keys(d.meta.elements).find(
            (s) => s.toLowerCase() === wanted || elementName(s, d.meta.elements[s]).toLowerCase() === wanted,
          )
          if (!sym) throw new Error(`"${String(a.element)}" is not an element: use a symbol like "O" or a name like "oxygen".`)
          if (!d.db.elementsWithData().has(sym)) throw new Error(`The NIST database has no XPS entries for ${sym}.`)
          select(sym)
          const wantedLine = typeof a.line === 'string' ? a.line.trim() : ''
          if (wantedLine) setLine(wantedLine)
          const lines = lineStats(d.db)
            .filter((s) => s.el === sym)
            .sort((x, y) => y.count - x.count)
            .slice(0, 12)
            .map((s) => ({ line: s.line, median_eV: +s.median.toFixed(2), range_eV: [+s.lo.toFixed(1), +s.hi.toFixed(1)], entries: s.count }))
          return { shown: sym, name: elementName(sym, d.meta.elements[sym]), lines }
        },
        open_databases: async () => {
          openReferences(element)
          return { opened: 'Other Databases & Properties', element }
        },
      }),
      [data, select, element],
    ),
  )
  const showInfo = useCallback((el: string, x?: number, y?: number) => setPopup({ kind: 'info', el, x, y }), [])
  const sortBy = useCallback(
    (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 })),
    [],
  )
  const clearFilters = () => {
    setLine('')
    setFormula('')
    setName('')
  }
  const focusInput = (el: HTMLInputElement | null) => {
    el?.focus()
    el?.select()
  }

  const copy = (text: string, done: string) => {
    if (!navigator.clipboard) {
      setFlash('Could not copy: no clipboard here')
      return
    }
    navigator.clipboard.writeText(text).then(
      () => setFlash(done),
      () => setFlash('Could not copy: the browser did not allow the clipboard'),
    )
  }

  const rowMenu = (r: number, e: MouseEvent) => {
    if (!db) return
    const journal = db.journal[r].trim()
    const firstAuthor = db.author[r].split(/[\s,]/)[0] ?? ''
    os.contextMenu(e, [
      { label: 'Copy Full Reference', icon: Copy, onClick: () => copy(referenceText(db, r), 'Reference copied to the clipboard') },
      { label: 'Copy Journal Only', icon: ClipboardCopy, disabled: !journal, onClick: () => copy(journal, 'Journal copied to the clipboard') },
      {
        label: 'Search in Google Scholar',
        icon: GraduationCap,
        disabled: !journal,
        onClick: () => openInBrowser(`https://scholar.google.com/scholar?q=${encodeURIComponent(`${firstAuthor} ${journal}`.trim())}`),
      },
      '-',
      { label: 'Show Full Information', icon: Info, onClick: () => setPopup({ kind: 'row', row: r }) },
    ])
  }

  // The Python app's File › Export Filtered Data: every column, tab-separated (or CSV for a .csv name).
  const exportData = async () => {
    if (!db) return
    if (!sorted.length) {
      await os.dialog.alert('No data to export (the current filter returns 0 rows).', { title: 'Export' })
      return
    }
    const target = await os.dialog.saveFile({
      title: 'Export Filtered Data',
      defaultName: `${HOME}/Documents/${exportName(element, line)}`,
    })
    if (!target) return
    try {
      await fs.writeText(target, exportText(db, sorted, path.extname(target) === '.csv' ? ',' : '\t'))
      setFlash(`Exported ${sorted.length.toLocaleString()} rows to ${path.basename(target)}`)
      os.notify({
        title: `Exported ${sorted.length.toLocaleString()} NIST entries`,
        body: path.pretty(target),
        onClick: () => os.open('files', { path: path.dirname(target) }),
      })
    } catch (e) {
      await os.dialog.alert(`Export failed: ${e instanceof Error ? e.message : e}`, { title: 'Export' })
    }
  }

  const about = () =>
    void os.dialog.alert(
      `KherveDB ${VERSION} — XPS Binding Energy Database\n\n` +
        `The NIST X-ray Photoelectron Spectroscopy database, recorded in 2019, with a periodic-table browser: ` +
        `${db ? db.n.toLocaleString() : 'about 56,000'} binding energies.\n\n` +
        `Click an element for its NIST entries, right-click it for its electronic structure, XPS peaks and overlaps, ` +
        `double-click it for XPS Fitting (M. Biesinger), Harwell XPS Guru, Thermo Knowledge and Google Scholar, ` +
        `shown inside KherveOS in the Other Databases & Properties window.\n\n` +
        `Developer: Gwilherm Kerherve`,
      { title: 'About KherveDB' },
    )

  // ---------------------------------------------------------------- menus

  useEffect(() => {
    const el = m ? element : null
    // Each site opens on the selected element, in its tab of the Other Databases & Properties window.
    const sourceItems: MenuItem[] = SOURCES.map((s) => ({
      label: el ? `${s.title} — ${elName}` : s.title,
      icon: SOURCE_ICONS[s.id],
      disabled: !el,
      onClick: () => el && openReferences(el, s.id),
    }))
    win.setMenus([
      {
        label: 'File',
        items: [
          { label: 'New Window', onClick: () => os.open('khervedb', { _new: Date.now(), element }) },
          '-',
          { label: 'Export Filtered Data…', icon: FileDown, shortcut: `${MOD}E`, disabled: !sorted.length, onClick: () => void exportData() },
          '-',
          { label: 'Close Window', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Copy', shortcut: `${MOD}C`, onClick: () => document.execCommand('copy') },
          { label: 'Select All', shortcut: `${MOD}A`, onClick: () => document.execCommand('selectAll') },
          '-',
          { label: 'Filter by Formula', icon: Search, shortcut: `${MOD}F`, disabled: !data, onClick: () => focusInput(formulaRef.current) },
          { label: 'Filter by Name', disabled: !data, onClick: () => focusInput(nameRef.current) },
          { label: 'Clear Filters', icon: FilterX, disabled: !line && !formula && !name, onClick: clearFilters },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Other Databases & Properties', icon: PanelRight, checked: refsOpen, disabled: !data, onClick: toggleReferences },
          { label: 'Plot Results…', icon: ChartColumn, disabled: !rows.length, onClick: () => setPopup({ kind: 'plot' }) },
          '-',
          { label: 'Simplified Periodic Table', checked: prefs.simplified, onClick: () => setPrefs({ simplified: !prefs.simplified }) },
        ],
      },
      {
        label: 'Databases',
        items: [
          { label: el ? `XPS Information for ${el}…` : 'XPS Information…', icon: Atom, shortcut: `${MOD}I`, disabled: !el, onClick: () => el && showInfo(el) },
          { label: el ? `General Properties of ${elName}` : 'General Properties', icon: Info, disabled: !el, onClick: () => el && openReferences(el, PROPS_TAB.id) },
          '-',
          ...sourceItems,
        ],
      },
      {
        label: 'Help',
        items: [
          { label: 'Welcome to KherveDB', disabled: !data, onClick: () => setPopup({ kind: 'welcome' }) },
          { label: 'About KherveDB', icon: Info, onClick: about },
        ],
      },
    ])
  })
  useEffect(() => () => win.setMenus(null), [win])

  // ------------------------------------------------------------- keyboard

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (popup) {
        e.preventDefault()
        setPopup(null)
      }
      return
    }
    if (!(e.metaKey || e.ctrlKey) || e.altKey || !data) return
    const k = e.key.toLowerCase()
    if (k === 'e') {
      e.preventDefault()
      void exportData()
    } else if (k === 'f') {
      e.preventDefault()
      focusInput(formulaRef.current)
    } else if (k === 'i' && m) {
      e.preventDefault()
      showInfo(element)
    }
  }

  // --------------------------------------------------------------- layout

  const layout = tableLayout(mainSize.w, mainSize.h)
  const plotValues = useMemo(() => {
    if (popup?.kind !== 'plot' || !db) return []
    const out: number[] = []
    for (const r of rows) if (!Number.isNaN(db.be[r])) out.push(db.be[r])
    return out
  }, [popup?.kind, db, rows])
  const plotTitle = [
    `${element} ${line || 'all lines'}`,
    formula.trim() && `formula “${formula.trim()}”`,
    name.trim() && `name “${name.trim()}”`,
  ]
    .filter(Boolean)
    .join(', ')

  if (!db || !meta) {
    return (
      <div className="k-app kdb-app">
        <SplashScreen
          error={error}
          onRetry={() => {
            setError(null)
            setAttempt((a) => a + 1)
          }}
        />
      </div>
    )
  }

  const status = flash ?? `${rows.length.toLocaleString()} ${rows.length === 1 ? 'result' : 'results'} found`

  return (
    // Focusable, so clicks anywhere keep the keyboard here (Escape, shortcuts).
    <div className="k-app kdb-app" onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="kdb-body">
        <main
          className="kdb-main"
          ref={setMain}
          style={{ '--kdb-tw': `${layout.tw}px`, '--kdb-th': `${layout.th}px` } as CSSProperties}
        >
          <div className="kdb-ptable-wrap">
            <PeriodicTable
              meta={meta}
              withData={withData}
              selected={element}
              simplified={prefs.simplified}
              dense={layout.dense}
              onSelect={select}
              onOpen={open}
              onInfo={showInfo}
            />
          </div>

          <section className={`kdb-searchbar${layout.short ? ' kdb-short' : ''}`}>
            <label title={'Element currently shown in the results table.\nClick a tile in the periodic table to change it.'}>
              <span>Element</span>
              <output className={`kdb-el-box${m ? ` kdb-cat-${m.cat}` : ''}`}>{element}</output>
            </label>
            <label title={"Restrict the results to one core level (e.g. 2p3/2).\n'All lines' shows every line recorded for the element."}>
              <span>XPS line</span>
              <select className="k-input" value={line} onChange={(e) => setLine(e.target.value)} aria-label="XPS line">
                <option value="">All lines</option>
                {lines.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className="kdb-grow" title={'Filter by chemical formula, e.g. Fe2O3 or TiO2.\nMatches any part of the formula.'}>
              <span>Formula</span>
              <input
                ref={formulaRef}
                className="k-input"
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                placeholder={layout.short ? 'Formula, e.g. Fe2O3' : 'e.g. Fe2O3'}
                aria-label="Formula"
                spellCheck={false}
              />
            </label>
            <label className="kdb-grow" title={'Filter by compound name, e.g. oxide, carbide, polymer.\nMatches any part of the name.'}>
              <span>Name</span>
              <input
                ref={nameRef}
                className="k-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={layout.short ? 'Name, e.g. oxide' : 'e.g. oxide'}
                aria-label="Name"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              className="k-btn"
              onClick={() => setPopup({ kind: 'plot' })}
              disabled={!rows.length}
              title="Plot the binding energies of the results currently in the table"
            >
              <ChartColumn size={15} />
              <span>{layout.narrow ? 'Plot' : 'Plot results'}</span>
            </button>
            <button
              type="button"
              className="k-btn primary kdb-big"
              onClick={() => openReferences(element)}
              aria-pressed={refsOpen}
              title={
                'Open the reference window for the selected element (it follows the element you click):\n' +
                '  • XPS Fitting (Biesinger), Harwell XPS Guru, Thermo Knowledge\n' +
                '  • Surface Science Spectra and electronic-structure papers on Google Scholar\n' +
                '  • General physical and atomic properties\n' +
                'Tip: double-clicking an element also opens it.'
              }
            >
              <span>{layout.narrow ? 'Databases' : 'Other Databases & Properties'}</span>
              <PanelRightOpen size={15} />
            </button>
          </section>

          <ResultsTable
            db={db}
            rows={sorted}
            sort={sort}
            onSort={sortBy}
            onRowClick={(row) => setPopup({ kind: 'row', row })}
            onRowMenu={rowMenu}
            active={popup?.kind === 'row' ? popup.row : null}
            status={status}
          />
        </main>

      </div>

      {popup?.kind === 'welcome' && (
        <Welcome
          onClose={(dontShow) => {
            if (dontShow) setPrefs({ hideWelcome: true })
            setPopup(null)
          }}
        />
      )}
      {popup?.kind === 'info' && (
        <FloatingWindow title={`${popup.el} – XPS information`} x={popup.x} y={popup.y} onClose={() => setPopup(null)}>
          <InfoContent el={popup.el} meta={meta} info={elementInfo(popup.el, meta, stats)} />
        </FloatingWindow>
      )}
      {popup?.kind === 'row' && popup.row < db.n && (
        <FloatingWindow
          title={`${db.element[popup.row]} ${db.line[popup.row]} – ${db.formula[popup.row]}`}
          onClose={() => setPopup(null)}
          wide
        >
          <RowDetails db={db} row={popup.row} />
        </FloatingWindow>
      )}
      {popup?.kind === 'plot' && (
        <FloatingWindow title="Binding energy distribution" onClose={() => setPopup(null)} wide className="kdb-plot-window">
          {plotValues.length ? (
            <BePlot
              values={plotValues}
              title={plotTitle}
              bin={prefs.plotBin}
              smooth={prefs.plotSmooth}
              onBin={(b) => setPrefs({ plotBin: b })}
              onSmooth={(on) => setPrefs({ plotSmooth: on })}
            />
          ) : (
            <p className="kdb-muted">No binding energies to plot: the results table is empty.</p>
          )}
        </FloatingWindow>
      )}
    </div>
  )
}
