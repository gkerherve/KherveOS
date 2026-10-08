// kStats — statistics for lab data. An editable table (or raw text; open .csv / .tsv / .txt / .dat),
// column statistics with outlier flags, curve fits with parameter errors and confidence bands,
// a model comparison, hypothesis tests that explain themselves, and a correlation matrix.
// Charts are drawn by Plotly (figures.ts builds them).

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { BarChart3, ClipboardCopy, Eraser, FolderOpen, PanelLeft, Plus, Redo2, Save, Send, Undo2 } from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu } from '@/os'
import { useAppTools } from '@/os/ai/appTools'
import DataGrid from './DataGrid'
import {
  addColumn, addRow, cleanRows, columnAligned, deleteRows, parseData, toCsv, toTsv, usableColumns, xySigma, type Data,
} from './data'
import { compareModels, fitModel, isFit } from './fits'
import { usePalette } from './PlotlyChart'
import { ComparePanel, CorrPanel, DescribePanel, FitPanel, Segmented, TestsPanel, numericColumns } from './Panels'
import { csv, buildReport, compareRows, corrRows, fitSummaryRows, paramRows, statsRows, testRows, tsv, type Rows } from './report'
import { TEST_KINDS, runTest, type TestConfig } from './run'
import { correlationMatrix } from './tests'
import { kstatsTools, type ViewPatch } from './aiTools'
import './kstats.css'

const SAMPLE = [
  'time (s),signal,error,control',
  '0,2.51,0.08,2.40', '0.5,1.79,0.07,1.70', '1,1.22,0.06,1.28', '1.5,0.88,0.05,0.80', '2,0.60,0.05,0.58', '2.5,0.44,0.04,0.45',
  '3,0.31,0.04,0.28', '3.5,0.21,0.03,0.22', '4,0.16,0.03,0.14', '4.5,0.10,0.03,0.12', '5,0.08,0.02,0.06',
].join('\n') + '\n'

type Tab = 'describe' | 'fit' | 'compare' | 'tests' | 'corr'
const TABS: [Tab, string][] = [['describe', 'Describe'], ['fit', 'Fit'], ['compare', 'Compare models'], ['tests', 'Tests'], ['corr', 'Correlation']]
const DATA_EXT = ['.csv', '.tsv', '.txt', '.dat']

export default function KStats({ win, args }: AppProps) {
  const [data, setData] = useState<Data>(() => parseData(SAMPLE))
  const dataRef = useRef(data)
  dataRef.current = data
  const hist = useRef<{ past: Data[]; future: Data[] }>({ past: [], future: [] })
  const [, bump] = useState(0)
  const [fileName, setFileName] = useState<string | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [view, setViewMode] = useState<'grid' | 'text'>('grid')
  const [raw, setRaw] = useState('')
  const rawEdited = useRef(false)
  const [showData, setShowData] = useState(true)
  const [narrow, setNarrow] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('')
  const statusTimer = useRef<number | undefined>(undefined)

  const [tab, setTab] = useState<Tab>('describe')
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(['describe']))
  const [xi, setXi] = useState(0)
  const [yi, setYi] = useState(1)
  const [si, setSi] = useState(2)
  const [weighted, setWeighted] = useState(false)
  const [modelId, setModelId] = useState('poly1')
  const [selCol, setSelCol] = useState(0)
  const [descChart, setDescChart] = useState<'hist' | 'box'>('hist')
  const [standardise, setStandardise] = useState(false)
  const [fitChart, setFitChart] = useState<'fit' | 'resid'>('fit')
  const [predAt, setPredAt] = useState('')
  const [testCfg, setTestCfg] = useState<TestConfig>({ kind: 'welch', cols: [1, 3], mu: 0, alpha: 0.05 })
  const [method, setMethod] = useState<'pearson' | 'spearman'>('pearson')
  const [corrView, setCorrView] = useState<'table' | 'chart'>('table')
  const pal = usePalette()

  const flash = useCallback((msg: string) => {
    setStatus(msg)
    window.clearTimeout(statusTimer.current)
    statusTimer.current = window.setTimeout(() => setStatus(''), 4000)
  }, [])
  useEffect(() => () => window.clearTimeout(statusTimer.current), [])

  // ------------------------------------------------------------ data + undo

  /** Replace the data as one undoable step. */
  const commit = useCallback((next: Data) => {
    const h = hist.current
    h.past.push(dataRef.current)
    if (h.past.length > 80) h.past.shift()
    h.future = []
    dataRef.current = next
    setData(next)
  }, [])
  const undo = useCallback(() => {
    const h = hist.current
    const prev = h.past.pop()
    if (!prev) return
    h.future.push(dataRef.current)
    dataRef.current = prev
    setData(prev)
    setRaw(toCsv(prev.table))
    bump((n) => n + 1)
  }, [])
  const redo = useCallback(() => {
    const h = hist.current
    const next = h.future.pop()
    if (!next) return
    h.past.push(dataRef.current)
    dataRef.current = next
    setData(next)
    setRaw(toCsv(next.table))
    bump((n) => n + 1)
  }, [])

  const setText = useCallback((text: string, name: string | null = null, filePathValue: string | null = null) => {
    commit(parseData(text))
    setFileName(name)
    setFilePath(filePathValue)
    setRaw(text)
    setXi(0)
    setYi(1)
    win.setDocumentPath(filePathValue)
  }, [commit, win])

  const loadPath = useCallback(async (p: string) => {
    try {
      const text = await fs.readText(p)
      setText(text, path.basename(p), p)
    } catch (err) {
      await os.dialog.alert(`Could not open ${path.basename(p)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [setText])

  useEffect(() => {
    if (typeof args.path === 'string') void loadPath(args.path)
    else if (typeof args.text === 'string') setText(args.text, typeof args.name === 'string' ? args.name : null)
    // opened once with these arguments
  }, [])

  useEffect(() => {
    win.setTitle(`kStats${fileName ? ` — ${fileName}` : ''}`)
  }, [win, fileName])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 820))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---------------------------------------------------------------- derived

  const { table } = data
  const headers = table.headers
  const nums = useMemo(() => numericColumns(data), [data])
  const x = nums.includes(xi) ? xi : (nums[0] ?? 0)
  const y = nums.includes(yi) && (yi !== x || nums.length < 2) ? yi : (nums.find((i) => i !== x) ?? x)
  const s = weighted && nums.includes(si) && si !== x && si !== y ? si : -1

  const xy = useMemo(() => xySigma(table, x, y, s), [table, x, y, s])
  const fitRes = useMemo(
    () => (xy.x.length ? fitModel(modelId, xy.x, xy.y, { sigma: xy.sigma }) : { error: 'No rows have numbers in both x and y.' }),
    [xy, modelId],
  )
  const fit = isFit(fitRes) ? fitRes : null
  const fitError = isFit(fitRes) ? null : fitRes.error
  const compare = useMemo(
    () => (tab === 'compare' && xy.x.length ? compareModels(xy.x, xy.y, { sigma: xy.sigma }) : null),
    [tab, xy],
  )

  const testNorm = useMemo<TestConfig>(() => {
    const info = TEST_KINDS.find((k) => k.id === testCfg.kind)!
    let cols = testCfg.cols.filter((c) => c < headers.length)
    if (info.columns !== 'many') {
      const base = cols.filter((c) => nums.includes(c))
      for (const c of nums) if (base.length < info.columns && !base.includes(c)) base.push(c)
      cols = base.slice(0, info.columns)
    }
    return { ...testCfg, cols }
  }, [testCfg, headers.length, nums])
  const testResult = useMemo(() => (tab === 'tests' ? runTest(table, testNorm) : 'Open the Tests tab.'), [tab, table, testNorm])

  const corrCols = useMemo(() => usableColumns(data), [data])
  const corrMatrix = useMemo(
    () => (tab === 'corr' && corrCols.length >= 2
      ? correlationMatrix(corrCols.map((c) => headers[c]), corrCols.map((c) => columnAligned(table, c)), method === 'spearman')
      : null),
    [tab, corrCols, headers, table, method],
  )

  const goTab = useCallback((t: Tab) => {
    setTab(t)
    setVisited((v) => (v.has(t) ? v : new Set(v).add(t)))
  }, [])

  const ignoredCount = data.ignored.filter(Boolean).length

  // ------------------------------------------------------- results as text

  /** The rows of the table on show, for Copy Results and the CSV export. */
  const currentRows = useCallback((): Rows | null => {
    if (tab === 'describe') return statsRows(data)
    if (tab === 'fit') return fit ? [['model', fit.label], ['equation', fit.equation], ...paramRows(fit), [], ...fitSummaryRows(fit)] : null
    if (tab === 'compare') return compare ? compareRows(compare) : null
    if (tab === 'tests') return typeof testResult === 'string' ? null : testRows(testResult)
    return corrMatrix ? corrRows(corrMatrix) : null
  }, [tab, data, fit, compare, testResult, corrMatrix])

  const copyResults = useCallback(async () => {
    const rows = currentRows()
    if (!rows) return flash('There are no results to copy yet.')
    try {
      await navigator.clipboard.writeText(tsv(rows))
      flash('Results copied: paste them into a spreadsheet or a document.')
    } catch {
      flash('Could not copy: the browser refused clipboard access.')
    }
  }, [currentRows, flash])

  const makeReport = useCallback((): string => {
    const d = dataRef.current
    const cmp = visited.has('compare') && xy.x.length ? compareModels(xy.x, xy.y, { sigma: xy.sigma }) : null
    const tr = visited.has('tests') ? runTest(d.table, testNorm) : null
    const cm = visited.has('corr') && corrCols.length >= 2
      ? correlationMatrix(corrCols.map((c) => d.table.headers[c]), corrCols.map((c) => columnAligned(d.table, c)), method === 'spearman')
      : null
    return buildReport({
      title: `kStats report${fileName ? ` — ${fileName}` : ''}`,
      data: d,
      fit: fit && visited.has('fit') ? { fit, x: headers[x], y: headers[y], used: xy.x.length, total: xy.total } : null,
      compare: cmp,
      tests: tr && typeof tr !== 'string' ? [tr] : [],
      correlation: cm,
    })
  }, [visited, xy, testNorm, corrCols, method, fileName, fit, headers, x, y])

  // ------------------------------------------------------------- file actions

  const baseName = (fileName ?? 'data').replace(/\.[^.]+$/, '')

  const openFile = useCallback(async () => {
    const p = await os.dialog.openFile({ extensions: DATA_EXT })
    if (p) await loadPath(p)
  }, [loadPath])

  const writeData = useCallback(async (p: string) => {
    const ext = path.extname(p).toLowerCase()
    await fs.writeText(p, toCsv(dataRef.current.table, ext === '.tsv' ? '\t' : ','))
    setFilePath(p)
    setFileName(path.basename(p))
    win.setDocumentPath(p)
    flash(`Saved ${path.basename(p)}`)
  }, [win, flash])

  const saveAs = useCallback(async () => {
    const p = await os.dialog.saveFile({ extensions: ['.csv', '.tsv', '.txt'], defaultName: `${baseName}.csv` })
    if (p) await writeData(p)
  }, [baseName, writeData])

  const save = useCallback(async () => {
    if (filePath && ['.csv', '.tsv'].includes(path.extname(filePath).toLowerCase())) await writeData(filePath)
    else await saveAs()
  }, [filePath, writeData, saveAs])

  const exportReport = useCallback(async () => {
    const p = await os.dialog.saveFile({ extensions: ['.md', '.txt'], defaultName: `${baseName}-report.md`, startDir: `${HOME}/Documents` })
    if (!p) return
    await fs.writeText(p, makeReport())
    flash(`Report saved to ${path.basename(p)}`)
  }, [baseName, makeReport, flash])

  const exportCsv = useCallback(async () => {
    const rows = currentRows()
    if (!rows) return flash('There are no results to export yet.')
    const p = await os.dialog.saveFile({ extensions: ['.csv'], defaultName: `${baseName}-${tab}.csv`, startDir: `${HOME}/Documents` })
    if (!p) return
    await fs.writeText(p, csv(rows))
    flash(`Results saved to ${path.basename(p)}`)
  }, [currentRows, baseName, tab, flash])

  const sendToKPlot = useCallback(() => {
    try {
      os.open('kplot', { text: toTsv(dataRef.current.table, dataRef.current.ignored), name: fileName ?? 'kStats data' })
    } catch {
      flash('Could not open kPlot.')
    }
  }, [fileName, flash])

  const cleanIncomplete = useCallback(async () => {
    const d = dataRef.current
    const cols = usableColumns(d)
    const { kept, dropped } = cleanRows(d.table, cols)
    if (dropped === 0) return flash('Every row already has numbers in all the columns in use.')
    const names = cols.map((c) => d.table.headers[c]).join(', ')
    const ok = await os.dialog.confirm(`Remove ${dropped} of ${d.table.rows.length} rows that have a missing or non-numeric value in ${names}? You can undo this.`, {
      title: 'Remove incomplete rows', okLabel: 'Remove rows',
    })
    if (!ok) return
    const keep = new Set(kept)
    commit(deleteRows(d, d.table.rows.map((_, i) => i).filter((i) => !keep.has(i))))
    flash(`Removed ${dropped} rows.`)
  }, [commit, flash])

  const clearAll = useCallback(async () => {
    const ok = await os.dialog.confirm('Clear the whole table? You can undo this.', { title: 'Clear data', okLabel: 'Clear' })
    if (ok) {
      commit({ table: { headers: ['x', 'y'], rows: Array.from({ length: 5 }, () => ['', '']) }, ignored: [false, false] })
      setFileName(null)
      setFilePath(null)
      win.setDocumentPath(null)
    }
  }, [commit, win])

  const showText = (v: 'grid' | 'text') => {
    if (v === 'text') {
      setRaw(toCsv(dataRef.current.table))
      rawEdited.current = false
    }
    setViewMode(v)
  }

  const editRaw = (text: string) => {
    setRaw(text)
    const parsed = parseData(text)
    const cur = dataRef.current
    const next: Data = { table: parsed.table, ignored: parsed.table.headers.map((_, i) => cur.ignored[i] ?? false) }
    if (!rawEdited.current) {
      hist.current.past.push(cur)
      hist.current.future = []
      rawEdited.current = true
    }
    dataRef.current = next
    setData(next)
  }

  // ------------------------------------------------------------------ tools

  useAppTools(win, kstatsTools({
    setText: (t: string) => setText(t),
    get: () => ({ data: dataRef.current }),
    show: (p: ViewPatch) => {
      if (p.xi !== undefined) setXi(p.xi)
      if (p.yi !== undefined) setYi(p.yi)
      if (p.si !== undefined && p.si >= 0) setSi(p.si)
      if (p.weighted !== undefined) setWeighted(p.weighted)
      if (p.modelId) setModelId(p.modelId)
      if (p.test) setTestCfg(p.test)
      if (p.method) setMethod(p.method)
      if (p.tab) goTab(p.tab)
    },
    report: makeReport,
  }))

  // ------------------------------------------------------------------ menus

  const menus = useMemo<MenuBarMenu[]>(() => [
    {
      label: 'File',
      items: [
        { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void openFile() },
        { label: 'Open Example', onClick: () => setText(SAMPLE) },
        '-',
        { label: 'Save Data', icon: Save, shortcut: '⌘S', onClick: () => void save() },
        { label: 'Save Data As…', shortcut: '⇧⌘S', onClick: () => void saveAs() },
        '-',
        { label: 'Export Report…', shortcut: '⌘E', onClick: () => void exportReport() },
        { label: 'Export Results as CSV…', onClick: () => void exportCsv() },
        '-',
        { label: 'Send to kPlot', icon: Send, onClick: sendToKPlot },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: hist.current.past.length === 0, onClick: undo },
        { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: hist.current.future.length === 0, onClick: redo },
        '-',
        { label: 'Copy Results', icon: ClipboardCopy, shortcut: '⇧⌘C', onClick: () => void copyResults() },
        '-',
        { label: 'Remove Incomplete Rows…', icon: Eraser, onClick: () => void cleanIncomplete() },
        { label: 'Clear Data…', onClick: () => void clearAll() },
      ],
    },
    {
      label: 'Data',
      items: [
        { label: 'Add Row', onClick: () => commit(addRow(dataRef.current)) },
        { label: 'Add Column', onClick: () => commit(addColumn(dataRef.current)) },
        '-',
        { label: 'Edit as Text', checked: view === 'text', onClick: () => showText(view === 'text' ? 'grid' : 'text') },
        { label: 'Show Data Panel', checked: showData, onClick: () => setShowData((v) => !v) },
      ],
    },
    {
      label: 'Analysis',
      items: [
        { label: 'Describe', shortcut: '⌘1', checked: tab === 'describe', onClick: () => goTab('describe') },
        { label: 'Fit…', shortcut: '⌘2', checked: tab === 'fit', onClick: () => goTab('fit') },
        { label: 'Compare Models', shortcut: '⌘3', checked: tab === 'compare', onClick: () => goTab('compare') },
        { label: 'Tests…', shortcut: '⌘4', checked: tab === 'tests', onClick: () => goTab('tests') },
        { label: 'Correlation', shortcut: '⌘5', checked: tab === 'corr', onClick: () => goTab('corr') },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Histogram', checked: tab === 'describe' && descChart === 'hist', onClick: () => { goTab('describe'); setDescChart('hist') } },
        { label: 'Box Plot', checked: tab === 'describe' && descChart === 'box', onClick: () => { goTab('describe'); setDescChart('box') } },
        { label: 'Fit and Residuals', checked: tab === 'fit' && fitChart === 'fit', onClick: () => { goTab('fit'); setFitChart('fit') } },
        { label: 'Residual Plot', checked: tab === 'fit' && fitChart === 'resid', onClick: () => { goTab('fit'); setFitChart('resid') } },
        '-',
        { label: 'Data Panel', checked: showData, onClick: () => setShowData((v) => !v) },
      ],
    },
  ], [view, showData, tab, descChart, fitChart, data, openFile, save, saveAs, exportReport, exportCsv, sendToKPlot, copyResults, cleanIncomplete, clearAll, commit, undo, redo, goTab, setText])

  useEffect(() => {
    win.setMenus(menus)
  }, [menus, win])
  useEffect(() => () => win.setMenus(null), [win])

  // --------------------------------------------------------------- keyboard

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey) return
    const k = e.key.toLowerCase()
    const t = e.target as HTMLElement
    const inField = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
    const run = (fn: () => void) => {
      e.preventDefault()
      fn()
    }
    if (k === 'o') return run(() => void openFile())
    if (k === 's') return run(() => void (e.shiftKey ? saveAs() : save()))
    if (k === 'e') return run(() => void exportReport())
    if (k === 'c' && e.shiftKey) return run(() => void copyResults())
    if (k === 'z' && !inField) return run(e.shiftKey ? redo : undo)
    const n = Number(k)
    if (n >= 1 && n <= 5) return run(() => goTab(TABS[n - 1][0]))
  }

  // ------------------------------------------------------------------ render

  const tabPanel = (() => {
    switch (tab) {
      case 'describe':
        return <DescribePanel data={data} selCol={selCol} setSelCol={setSelCol} chart={descChart} setChart={setDescChart} standardise={standardise} setStandardise={setStandardise} pal={pal} />
      case 'fit':
        return (
          <FitPanel
            data={data} xi={x} yi={y} si={s >= 0 ? s : (nums.find((i) => i !== x && i !== y) ?? -1)} setXi={setXi} setYi={setYi} setSi={setSi}
            weighted={s >= 0} setWeighted={setWeighted} modelId={modelId} setModelId={setModelId} fit={fit} error={fitError}
            used={xy.x.length} total={xy.total} x={xy.x} y={xy.y} sigma={xy.sigma} chart={fitChart} setChart={setFitChart} band="conf"
            predAt={predAt} setPredAt={setPredAt} pal={pal}
          />
        )
      case 'compare':
        return <ComparePanel rows={compare} used={xy.x.length} total={xy.total} current={modelId} onPick={(m) => { setModelId(m); goTab('fit') }} />
      case 'tests':
        return <TestsPanel data={data} cfg={testNorm} setCfg={setTestCfg} result={testResult} />
      default:
        return (
          <CorrPanel
            matrix={corrMatrix} method={method} setMethod={setMethod} view={corrView} setView={setCorrView} pal={pal}
            onPick={(i, j) => { setXi(corrCols[i]); setYi(corrCols[j]); goTab('fit') }}
          />
        )
    }
  })()

  return (
    <div ref={root} className={`k-app ks-app${narrow ? ' narrow' : ''}`} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="k-toolbar ks-toolbar">
        <button className="k-btn small" onClick={() => void openFile()} title="Open a .csv, .tsv, .txt or .dat file (⌘O)"><FolderOpen size={14} /><span className="ks-lbl">Open</span></button>
        <button className="k-btn small" onClick={() => void save()} title="Save the data as a .csv or .tsv file (⌘S)"><Save size={14} /><span className="ks-lbl">Save</span></button>
        <span className="k-sep" />
        <button className="k-icon-btn" onClick={undo} disabled={hist.current.past.length === 0} title="Undo (⌘Z)" aria-label="Undo"><Undo2 size={15} /></button>
        <button className="k-icon-btn" onClick={redo} disabled={hist.current.future.length === 0} title="Redo (⇧⌘Z)" aria-label="Redo"><Redo2 size={15} /></button>
        <button className="k-btn small" onClick={() => void cleanIncomplete()} title="Remove the rows with a missing or non-numeric value"><Eraser size={14} /><span className="ks-lbl">Clean</span></button>
        <span className="k-spacer" />
        <button className="k-btn small" onClick={() => void copyResults()} title="Copy the table of results (⇧⌘C)"><ClipboardCopy size={14} /><span className="ks-lbl">Copy results</span></button>
        <button className="k-btn small" onClick={() => void exportReport()} title="Save a Markdown report (⌘E)"><Save size={14} /><span className="ks-lbl">Report</span></button>
        <button className="k-btn small primary" onClick={sendToKPlot} title="Open this table in kPlot"><Send size={14} /><span className="ks-lbl">Send to kPlot</span></button>
        <button className={`k-icon-btn${showData ? ' active' : ''}`} onClick={() => setShowData((v) => !v)} title="Show or hide the data" aria-label="Show or hide the data"><PanelLeft size={15} /></button>
      </div>

      <div className="ks-main">
        {showData && (
          <section className="ks-data">
            <div className="ks-data-head">
              <b>Data</b>
              {fileName && <span className="k-muted ks-file" title={filePath ?? undefined}>{fileName}</span>}
              <span className="k-spacer" />
              <Segmented value={view} options={[['grid', 'Grid'], ['text', 'Text']]} onChange={showText} />
              <button className="k-btn small" onClick={() => commit(addRow(dataRef.current))} title="Add a row at the end"><Plus size={12} /> Row</button>
              <button className="k-btn small" onClick={() => commit(addColumn(dataRef.current))} title="Add a column at the end"><Plus size={12} /> Column</button>
            </div>
            {view === 'grid' ? (
              <DataGrid data={data} commit={commit} xCol={tab === 'fit' || tab === 'compare' ? x : -1} yCol={tab === 'fit' || tab === 'compare' ? y : -1} />
            ) : (
              <textarea
                className="k-input ks-text"
                value={raw}
                spellCheck={false}
                onChange={(e) => editRaw(e.target.value)}
                aria-label="The data as text: one row per line, columns separated by commas, tabs or semicolons"
              />
            )}
            <div className="k-muted ks-hint">
              Paste from a spreadsheet into any cell. The first row is the header if it has words in it. Right-click a column name to sort, ignore or delete it.
            </div>
          </section>
        )}

        <section className="ks-results">
          <div className="ks-tabs" role="tablist">
            {TABS.map(([id, label], i) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => goTab(id)} title={`${label} (⌘${i + 1})`}>{label}</button>
            ))}
          </div>
          <div className="ks-tabbody">{tabPanel}</div>
        </section>
      </div>

      <div className="k-statusbar ks-status">
        <BarChart3 size={12} /> {table.rows.length} rows · {headers.length} columns{ignoredCount ? ` · ${ignoredCount} ignored` : ''}
        {status && <span className="ks-flash">{status}</span>}
      </div>
    </div>
  )
}
