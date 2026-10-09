// The catalog of datasets that ship with kClimate (public/data/kclimate/manifest.json, written by
// tools/fetch_kclimate_data.py) and the library of series a project works with. Pure.

import { monthT, type Kind, type Series, type Step } from './series.ts'

export interface ManifestColumn {
  key: string
  name: string
  unit: string
  kind: Kind
  baseline?: [number, number] | null
}

export interface DatasetEntry {
  id: string
  file: string
  title: string
  description: string
  provider: string
  url: string
  licence: string
  citation: string
  version: string
  retrieved: string
  rows: number
  t_first: number
  t_last: number
  step: Step
  columns: ManifestColumn[]
  missing?: string
  note?: string
}

export interface Manifest {
  datasets: DatasetEntry[]
  not_included: string[]
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const numOr = (v: unknown, d = NaN): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** The manifest, checked field by field (it is fetched from the server). */
export function parseManifest(json: unknown): Manifest {
  const o = (json ?? {}) as Record<string, unknown>
  const list = Array.isArray(o.datasets) ? o.datasets : []
  const datasets: DatasetEntry[] = []
  for (const raw of list) {
    const d = (raw ?? {}) as Record<string, unknown>
    const step = d.step === 'monthly' || d.step === 'annual' || d.step === 'irregular' ? d.step : null
    if (typeof d.id !== 'string' || typeof d.file !== 'string' || !step || !Array.isArray(d.columns)) continue
    const columns: ManifestColumn[] = []
    for (const c of d.columns) {
      const cc = (c ?? {}) as Record<string, unknown>
      if (typeof cc.key !== 'string') continue
      const bl = cc.baseline
      columns.push({
        key: cc.key, name: str(cc.name, cc.key), unit: str(cc.unit), kind: cc.kind === 'anomaly' ? 'anomaly' : 'level',
        ...(Array.isArray(bl) && bl.length === 2 && Number.isFinite(bl[0]) && Number.isFinite(bl[1]) ? { baseline: [bl[0], bl[1]] as [number, number] } : { baseline: null }),
      })
    }
    datasets.push({
      id: d.id, file: d.file, title: str(d.title, d.id), description: str(d.description), provider: str(d.provider), url: str(d.url), licence: str(d.licence),
      citation: str(d.citation), version: str(d.version), retrieved: str(d.retrieved), rows: numOr(d.rows, 0), t_first: numOr(d.t_first), t_last: numOr(d.t_last),
      step, columns, ...(typeof d.missing === 'string' ? { missing: d.missing } : {}), ...(typeof d.note === 'string' && d.note ? { note: d.note } : {}),
    })
  }
  return { datasets, not_included: Array.isArray(o.not_included) ? o.not_included.filter((x): x is string => typeof x === 'string') : [] }
}

/** The series of a dataset file (comma-separated, one header line; `year,month,…`, `year,…` or `time,…`). */
export function seriesFromCsv(entry: DatasetEntry, text: string): Series[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (!lines.length) return []
  const header = lines[0].split(',').map((h) => h.trim())
  const col = (k: string) => header.indexOf(k)
  const iYear = col('year')
  const iMonth = col('month')
  const iTime = col('time')
  const t: number[] = []
  const cols = entry.columns.map((c) => ({ c, i: col(c.key), y: [] as number[] }))
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(',')
    let tt: number
    if (iMonth >= 0 && iYear >= 0) tt = monthT(Number(cells[iYear]), Number(cells[iMonth]))
    else if (iTime >= 0) tt = Number(cells[iTime])
    else if (iYear >= 0) tt = Number(cells[iYear]) + 0.5
    else continue
    if (!Number.isFinite(tt)) continue
    t.push(tt)
    for (const c of cols) {
      const raw = c.i >= 0 ? (cells[c.i] ?? '').trim() : ''
      c.y.push(raw === '' ? NaN : Number(raw))
    }
  }
  return cols
    .filter((c) => c.i >= 0)
    .map(({ c, y }) => ({
      id: `${entry.id}.${c.key}`, name: c.name, unit: c.unit, t: t.slice(), y, step: entry.step, kind: c.kind, baseline: c.baseline ?? null, dataset: entry.id,
    }))
}

// ----------------------------------------------------------------------------------------------- library

/** Series by id. A reference "id@9" is the values of month 9 (September) of a monthly series, as an annual series. */
export class Library {
  private map = new Map<string, Series>()
  private owners = new Map<string, string[]>()

  /** Adds the series of a dataset (replacing earlier ones with the same id). */
  addDataset(datasetId: string, list: Series[]): void {
    for (const s of list) this.map.set(s.id, s)
    this.owners.set(datasetId, list.map((s) => s.id))
  }

  removeDataset(datasetId: string): void {
    for (const id of this.owners.get(datasetId) ?? []) this.map.delete(id)
    this.owners.delete(datasetId)
  }

  has(ref: string): boolean {
    return this.get(ref) !== null
  }

  get(ref: string): Series | null {
    const direct = this.map.get(ref)
    if (direct) return direct
    const m = /^(.*)@(\d{1,2})$/.exec(ref)
    if (!m) return null
    const base = this.map.get(m[1])
    const month = Number(m[2])
    if (!base || base.step !== 'monthly' || month < 1 || month > 12) return null
    const t: number[] = []
    const y: number[] = []
    for (let i = 0; i < base.t.length; i++) {
      const yr = Math.floor(base.t[i] + 1e-9)
      if (Math.floor((base.t[i] - yr) * 12 + 1e-6) + 1 === month) { t.push(yr + 0.5); y.push(base.y[i]) }
    }
    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    return { ...base, id: ref, name: `${base.name}, ${MONTH_NAMES[month - 1]}`, t, y, step: 'annual' }
  }

  all(): Series[] {
    return [...this.map.values()]
  }

  datasets(): string[] {
    return [...this.owners.keys()]
  }

  seriesOf(datasetId: string): Series[] {
    return (this.owners.get(datasetId) ?? []).map((id) => this.map.get(id)!).filter(Boolean)
  }
}

// ----------------------------------------------------------------------------------- finding a series by name

export interface RefInfo {
  ref: string
  name: string
  dataset: string
  unit: string
  step: Step
  kind: Kind
}

/** Every series the shipped datasets offer. */
export function catalogRefs(m: Manifest): RefInfo[] {
  return m.datasets.flatMap((d) => d.columns.map((c) => ({ ref: `${d.id}.${c.key}`, name: c.name, dataset: d.id, unit: c.unit, step: d.step, kind: c.kind })))
}

/**
 * A series id from what a person (or an AI) writes: an exact id ("gistemp.global"), a dataset id ("gistemp": its first
 * series), or words of the name ("mauna loa co2"). "id@9" keeps the month. Returns null when nothing fits.
 */
export function matchRef(refs: RefInfo[], text: string): RefInfo | null {
  const raw = text.trim()
  if (!raw) return null
  const at = /^(.*?)(@\d{1,2})?$/.exec(raw)!
  const word = at[1].trim().toLowerCase()
  const suffix = at[2] ?? ''
  const withSuffix = (r: RefInfo): RefInfo => (suffix ? { ...r, ref: r.ref + suffix } : r)
  const exact = refs.find((r) => r.ref.toLowerCase() === word)
  if (exact) return withSuffix(exact)
  const ds = refs.find((r) => r.dataset.toLowerCase() === word)
  if (ds) return withSuffix(ds)
  const tokens = word.split(/[\s_.,:-]+/).filter(Boolean)
  const hay = (r: RefInfo) => `${r.ref} ${r.name} ${r.dataset}`.toLowerCase().replace(/[_.]/g, ' ')
  const hits = refs.filter((r) => tokens.every((t) => hay(r).includes(t)))
  if (!hits.length) return null
  return withSuffix(hits[0])
}
