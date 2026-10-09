// The dialog that imports a CSV time series: it guesses the time column (a year, a decimal year, dates, or a year and a
// month) and the value columns, shows a preview, and lets the user change the mapping.

import { useEffect, useMemo, useRef, useState } from 'react'
import { buildImport, inferMapping, parseCsv, type ImportedDataset, type ImportMapping, type TimeMode } from './importCsv'
import { sampleCsv } from './synthetic'
import { Check, Field, Notice, NumInput } from './ui'

interface Props {
  /** The text of the file, or '' to paste. */
  initialText: string
  initialName: string
  /** Asks for another file; resolves to its name and text. */
  chooseFile(): Promise<{ name: string; text: string } | null>
  onImport(d: ImportedDataset): void
  onCancel(): void
}

const TIME_LABELS: Array<[TimeMode, string]> = [
  ['year', 'A year per row (2020)'], ['decimal', 'A decimal year (2020.54)'], ['date', 'A date (2020-07-15, 2020-07, 15/07/2020, Jul 2020)'],
  ['year-month', 'A year column and a month column'], ['row', 'No time column: consecutive years'],
]

export default function ImportDialog({ initialText, initialName, chooseFile, onImport, onCancel }: Props) {
  const [text, setText] = useState(initialText)
  const [name, setName] = useState(initialName)
  const [delimiter, setDelimiter] = useState('auto')
  const [header, setHeader] = useState<'auto' | 'yes' | 'no'>('auto')
  const [synthetic, setSynthetic] = useState(false)
  const table = useMemo(() => parseCsv(text, delimiter === 'auto' ? undefined : delimiter === 'tab' ? '\t' : delimiter === 'space' ? ' ' : delimiter, header === 'auto' ? undefined : header === 'yes'), [text, delimiter, header])
  const [mapping, setMapping] = useState<ImportMapping>(() => inferMapping(table, initialName))
  const first = useRef(true)
  // a new text or delimiter is guessed again; the user's name stays
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setMapping((old) => ({ ...inferMapping(table, name), unit: old.unit, kind: old.kind, datasetName: name }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table])
  const set = (patch: Partial<ImportMapping>) => setMapping((m) => ({ ...m, ...patch }))
  const result = useMemo(() => (table.rows.length ? buildImport(table, { ...mapping, datasetName: name }, { synthetic }) : { error: 'Paste or choose a CSV text first.' }), [table, mapping, name, synthetic])
  const cols = table.headers
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => { dialog.current?.querySelector<HTMLElement>('textarea, input, select')?.focus() }, [])

  const toggleValue = (c: number, on: boolean) => {
    const idx = mapping.valueCols.indexOf(c)
    if (on && idx < 0) {
      const order = [...mapping.valueCols, c].sort((a, b) => a - b)
      const names = order.map((col) => (col === c ? cols[c] : mapping.names[mapping.valueCols.indexOf(col)]))
      set({ valueCols: order, names })
    } else if (!on && idx >= 0) set({ valueCols: mapping.valueCols.filter((x) => x !== c), names: mapping.names.filter((_, i) => i !== idx) })
  }

  const loadSample = () => {
    setText(sampleCsv())
    setName('Synthetic weather station')
    setSynthetic(true)
    setDelimiter('auto')
    setHeader('auto')
  }
  const choose = async () => {
    const f = await chooseFile()
    if (!f) return
    setText(f.text)
    setName(f.name)
    setSynthetic(false)
  }

  return (
    <div className="cl-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="cl-modal" role="dialog" aria-modal="true" aria-label="Import a CSV time series" ref={dialog} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}>
        <header><h2>Import a CSV time series</h2></header>
        <div className="cl-modal-body">
          <div className="cl-row">
            <button type="button" className="k-btn small" onClick={() => void choose()}>Choose a file…</button>
            <button type="button" className="k-btn small" onClick={loadSample} title="Fills in a made-up weather station so that you can see the layout">Use the sample (synthetic)</button>
            <span className="k-muted cl-small">or paste the text below</span>
          </div>
          <textarea className="k-input cl-paste" aria-label="CSV text" spellCheck={false} placeholder={'year,value\n2000,1.2\n2001,1.4'} value={text} onChange={(e) => setText(e.target.value)} rows={6} />
          <div className="cl-form">
            <Field label="Name of the dataset"><input className="k-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name of the dataset" /></Field>
            <Field label="Separator">
              <select className="k-input" aria-label="Separator" value={delimiter} onChange={(e) => setDelimiter(e.target.value)}>
                <option value="auto">guess</option><option value=",">comma</option><option value=";">semicolon</option><option value="tab">tab</option><option value="space">spaces</option>
              </select>
            </Field>
            <Field label="First row">
              <select className="k-input" aria-label="First row" value={header} onChange={(e) => setHeader(e.target.value as typeof header)}>
                <option value="auto">guess</option><option value="yes">is a header</option><option value="no">is data</option>
              </select>
            </Field>
            <Field label="Time is">
              <select className="k-input" aria-label="Time format" value={mapping.timeMode} onChange={(e) => {
                const timeMode = e.target.value as TimeMode
                const named = cols.findIndex((c) => /^(month|mon|mo|mois|monat)$/i.test(c))
                set({ timeMode, ...(timeMode === 'year-month' && mapping.monthCol < 0 ? { monthCol: named >= 0 ? named : Math.min(cols.length - 1, mapping.timeCol + 1) } : {}) })
              }}>
                {TIME_LABELS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </Field>
            {mapping.timeMode !== 'row' ? (
              <Field label={mapping.timeMode === 'year-month' ? 'Year column' : 'Time column'}>
                <select className="k-input" aria-label="Time column" value={mapping.timeCol} onChange={(e) => set({ timeCol: Number(e.target.value), valueCols: mapping.valueCols.filter((c) => c !== Number(e.target.value)), names: mapping.names.filter((_, i) => mapping.valueCols[i] !== Number(e.target.value)) })}>
                  {cols.map((c, i) => <option key={i} value={i}>{c}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="First year"><NumInput label="First year" value={mapping.startYear} min={-5000} max={3000} onChange={(v) => set({ startYear: Math.round(v) })} /></Field>
            )}
            {mapping.timeMode === 'year-month' && (
              <Field label="Month column">
                <select className="k-input" aria-label="Month column" value={Math.max(0, mapping.monthCol)} onChange={(e) => set({ monthCol: Number(e.target.value) })}>
                  {cols.map((c, i) => <option key={i} value={i}>{c}</option>)}
                </select>
              </Field>
            )}
            <Field label="Unit (optional)"><input className="k-input" value={mapping.unit} onChange={(e) => set({ unit: e.target.value })} aria-label="Unit" placeholder="°C, ppm, mm…" /></Field>
            <Field label="Values are">
              <select className="k-input" aria-label="Kind of values" value={mapping.kind} onChange={(e) => set({ kind: e.target.value as 'level' | 'anomaly' })}>
                <option value="level">quantities (a seasonal cycle is removed by month when changing baseline)</option>
                <option value="anomaly">anomalies (already differences from a baseline)</option>
              </select>
            </Field>
            <Field label="Missing-value codes" hint="Cells equal to one of these (comma-separated) are empty. Blank cells always are.">
              <input className="k-input" aria-label="Missing-value codes" value={mapping.missing.join(', ')} onChange={(e) => set({ missing: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
            </Field>
          </div>
          <fieldset className="cl-valuecols">
            <legend>Columns of values</legend>
            {cols.map((c, i) => {
              if ((mapping.timeMode !== 'row' && i === mapping.timeCol) || (mapping.timeMode === 'year-month' && i === mapping.monthCol)) return null
              const k = mapping.valueCols.indexOf(i)
              return (
                <div key={i} className="cl-row">
                  <Check checked={k >= 0} onChange={(on) => toggleValue(i, on)} label={c} />
                  {k >= 0 && <input className="k-input cl-name" aria-label={`Name of ${c}`} value={mapping.names[k] ?? c} onChange={(e) => set({ names: mapping.names.map((n, j) => (j === k ? e.target.value : n)) })} />}
                </div>
              )
            })}
          </fieldset>
          <Check checked={synthetic} onChange={setSynthetic} label="These data are synthetic (made up): label them so" />
          {table.rows.length > 0 && (
            <div className="cl-tablewrap cl-preview">
              <table className="cl-table">
                <thead><tr>{cols.map((c, i) => <th key={i} className={i === mapping.timeCol && mapping.timeMode !== 'row' ? 'time' : mapping.valueCols.includes(i) ? 'val' : ''}>{c}</th>)}</tr></thead>
                <tbody>{table.rows.slice(0, 6).map((r, j) => <tr key={j}>{r.map((x, i) => <td key={i}>{x}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          {'error' in result ? <Notice kind="warn">{result.error}</Notice> : (
            <>
              <Notice>{result.dataset.t.length} rows, {result.dataset.step}, {Math.floor(result.dataset.t[0])}–{Math.floor(result.dataset.t[result.dataset.t.length - 1])}, {result.dataset.columns.length} series.</Notice>
              {result.warnings.map((w) => <Notice key={w} kind="warn">{w}</Notice>)}
            </>
          )}
        </div>
        <footer>
          <button type="button" className="k-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="k-btn primary" disabled={'error' in result} onClick={() => !('error' in result) && onImport(result.dataset)}>Import</button>
        </footer>
      </div>
    </div>
  )
}
