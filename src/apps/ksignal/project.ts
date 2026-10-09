// The .ksig project file (pure): JSON {format: "ksig", version: 1, name, source, analysis, filter, process, …}.
// A generator source is stored as its spec (not as samples); an imported signal is embedded as base64 Float32
// (little endian) or referenced by its path when it is long.

import { DEFAULT_FILTER, normalizeFilterSpec, type FilterSpec } from './filters.ts'
import { normalizeGenerator, type GeneratorSource } from './generators.ts'
import { WINDOW_NAMES, isWindowName, type WindowName } from './windows.ts'

export type Tab = 'time' | 'spectrum' | 'spectrogram' | 'filter' | 'live'
export const TABS: readonly Tab[] = ['time', 'spectrum', 'spectrogram', 'filter', 'live']
export const TAB_LABELS: Record<Tab, string> = { time: 'Time', spectrum: 'Spectrum', spectrogram: 'Spectrogram', filter: 'Filter', live: 'Live' }

/** An imported signal: from a file, a CSV, or a microphone recording. */
export interface DataSource {
  kind: 'data'
  name: string
  fs: number
  /** Number of samples. */
  count: number
  origin: 'wav' | 'audio' | 'csv' | 'recording'
  /** Base64 of the Float32 samples (little endian) when embedded. */
  data?: string
  /** Where the signal was imported from, when it is not embedded. */
  path?: string
  /** Channel of a multi-channel file: a number or 'mix'. */
  channel?: number | 'mix'
}

export type Source = GeneratorSource | DataSource

export type SpectrumMode = 'fft' | 'welch'
export type AmpScale = 'db' | 'linear' | 'psd'

export interface AnalysisSettings {
  window: WindowName
  beta: number
  /** FFT length of the Spectrum tab (0 = the whole signal, at most 65536 samples). */
  fftSize: number
  /** Start of the analysed segment, seconds. */
  start: number
  mode: SpectrumMode
  scale: AmpScale
  logFreq: boolean
  /** Axis limits: dB floor and ceiling (ceiling null = automatic), highest frequency shown (null = Nyquist). */
  dbMin: number
  dbMax: number | null
  fMax: number | null
  /** Segment length and overlap of the spectrogram and of Welch averaging. */
  stftSize: number
  overlap: number
  /** Windows overlaid in the Spectrum tab for comparison. */
  compare: WindowName[]
  /** Which trace the spectra are computed from. */
  analyse: 'original' | 'processed'
  /** Peak table: range below the highest peak (dB) and number of peaks. */
  peakRangeDb: number
  maxPeaks: number
  /** Fundamental for the THD / SNR metrics in Hz (0 = the strongest peak). */
  fundamental: number
  /** Time-domain peak detection (R peaks). */
  timePeaks: { enabled: boolean; height: number; minDistance: number }
  /** Spectrogram colour range in dB re 1 (min, max null = automatic). */
  specMin: number
  specMax: number | null
}

export const DEFAULT_ANALYSIS: AnalysisSettings = {
  window: 'hann', beta: 8.6, fftSize: 0, start: 0, mode: 'fft', scale: 'db', logFreq: false, dbMin: -120, dbMax: null, fMax: null,
  stftSize: 512, overlap: 0.75, compare: [], analyse: 'original', peakRangeDb: 60, maxPeaks: 10, fundamental: 0,
  timePeaks: { enabled: false, height: 0.5, minDistance: 0.3 }, specMin: -100, specMax: null,
}

export type Process =
  | { type: 'none' }
  | { type: 'filter' }
  | { type: 'smooth'; method: 'ma' | 'median' | 'sg'; width: number; order: number }
  | { type: 'envelope' }
  | { type: 'decimate'; factor: number }

export const NO_PROCESS: Process = { type: 'none' }

export interface KsigProject {
  format: 'ksig'
  version: 1
  name: string
  description?: string
  /** True for the generated examples: the data is synthetic. */
  synthetic?: boolean
  source: Source
  analysis: AnalysisSettings
  filter: FilterSpec
  /** A second filter drawn over the first in the Filter tab. */
  compare: FilterSpec | null
  process: Process
  tab: Tab
  /** Cursors of the Spectrum tab, in hertz (the Time cursors are not saved). */
  cursors: { a: number | null; b: number | null }
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const numOrNull = (v: unknown, d: number | null): number | null => (v === null ? null : typeof v === 'number' && Number.isFinite(v) ? v : d)

export function normalizeAnalysis(raw: unknown): AnalysisSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_ANALYSIS
  const tp = (o.timePeaks && typeof o.timePeaks === 'object' ? o.timePeaks : {}) as Record<string, unknown>
  return {
    window: isWindowName(o.window) ? o.window : d.window,
    beta: num(o.beta, d.beta),
    fftSize: Math.max(0, Math.round(num(o.fftSize, d.fftSize))),
    start: Math.max(0, num(o.start, d.start)),
    mode: o.mode === 'welch' ? 'welch' : 'fft',
    scale: o.scale === 'linear' || o.scale === 'psd' ? o.scale : 'db',
    logFreq: o.logFreq === true,
    dbMin: num(o.dbMin, d.dbMin),
    dbMax: numOrNull(o.dbMax, d.dbMax),
    fMax: numOrNull(o.fMax, d.fMax),
    stftSize: Math.max(16, Math.round(num(o.stftSize, d.stftSize))),
    overlap: Math.min(0.95, Math.max(0, num(o.overlap, d.overlap))),
    compare: Array.isArray(o.compare) ? o.compare.filter((w): w is WindowName => isWindowName(w)).slice(0, WINDOW_NAMES.length) : [],
    analyse: o.analyse === 'processed' ? 'processed' : 'original',
    peakRangeDb: Math.max(6, num(o.peakRangeDb, d.peakRangeDb)),
    maxPeaks: Math.max(1, Math.min(100, Math.round(num(o.maxPeaks, d.maxPeaks)))),
    fundamental: Math.max(0, num(o.fundamental, d.fundamental)),
    timePeaks: { enabled: tp.enabled === true, height: num(tp.height, d.timePeaks.height), minDistance: Math.max(0, num(tp.minDistance, d.timePeaks.minDistance)) },
    specMin: num(o.specMin, d.specMin),
    specMax: numOrNull(o.specMax, d.specMax),
  }
}

export function normalizeProcess(raw: unknown): Process {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  switch (o.type) {
    case 'filter': return { type: 'filter' }
    case 'envelope': return { type: 'envelope' }
    case 'decimate': return { type: 'decimate', factor: Math.max(2, Math.min(64, Math.round(num(o.factor, 2)))) }
    case 'smooth': {
      const method = o.method === 'median' || o.method === 'sg' ? o.method : 'ma'
      return { type: 'smooth', method, width: Math.max(1, Math.min(10001, Math.round(num(o.width, 11)))), order: Math.max(0, Math.min(10, Math.round(num(o.order, 3)))) }
    }
    default: return NO_PROCESS
  }
}

function normalizeData(o: Record<string, unknown>): DataSource {
  return {
    kind: 'data',
    name: typeof o.name === 'string' ? o.name : 'Imported signal',
    fs: num(o.fs, 1000),
    count: Math.max(0, Math.round(num(o.count, 0))),
    origin: o.origin === 'wav' || o.origin === 'audio' || o.origin === 'csv' ? o.origin : 'recording',
    ...(typeof o.data === 'string' ? { data: o.data } : {}),
    ...(typeof o.path === 'string' ? { path: o.path } : {}),
    ...(o.channel === 'mix' || typeof o.channel === 'number' ? { channel: o.channel as number | 'mix' } : {}),
  }
}

export function newProject(source?: Source): KsigProject {
  return {
    format: 'ksig', version: 1, name: 'Untitled', source: source ?? normalizeGenerator(undefined), analysis: { ...DEFAULT_ANALYSIS, timePeaks: { ...DEFAULT_ANALYSIS.timePeaks } },
    filter: { ...DEFAULT_FILTER }, compare: null, process: NO_PROCESS, tab: 'time', cursors: { a: null, b: null },
  }
}

// ------------------------------------------------------------------------------------------------- base64 floats

export function encodeFloat32(x: ArrayLike<number>): string {
  const f = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) f[i] = x[i]
  const bytes = new Uint8Array(f.buffer)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function decodeFloat32(b64: string): Float64Array {
  const s = atob(b64)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  const f = new Float32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
  return Float64Array.from(f)
}

// ------------------------------------------------------------------------------------------------- file

/** Longer than this (samples) an imported signal is referenced by its path instead of being embedded, when it has one. */
export const EMBED_LIMIT = 400_000

export function serializeKsig(p: KsigProject, samples?: ArrayLike<number> | null, opts: { embedLimit?: number } = {}): string {
  let source: Source = p.source
  if (source.kind === 'data') {
    const limit = opts.embedLimit ?? EMBED_LIMIT
    const { data: _data, ...rest } = source
    if (samples && (samples.length <= limit || !source.path)) source = { ...rest, count: samples.length, data: encodeFloat32(samples) }
    else if (source.path) source = { ...rest }
    else source = { ...rest, ...(source.data ? { data: source.data } : {}) }
  }
  const file = {
    format: p.format, version: p.version, name: p.name,
    ...(p.description ? { description: p.description } : {}),
    ...(p.synthetic ? { synthetic: true } : {}),
    source, analysis: p.analysis, filter: p.filter, ...(p.compare ? { compare: p.compare } : {}),
    process: p.process, tab: p.tab, cursors: p.cursors,
  }
  return JSON.stringify(file, null, 2) + '\n'
}

export interface ParsedKsig { project: KsigProject; samples: Float64Array | null; warnings: string[] }

/** Reads a .ksig file; throws a readable error when it is not one. Unknown fields are ignored, bad ones replaced by defaults. */
export function parseKsig(text: string): ParsedKsig {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('This is not a kSignal file (it is not valid JSON).') }
  const o = raw as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || o.format !== 'ksig') throw new Error('This is not a kSignal file (the format field should be “ksig”).')
  if (typeof o.version === 'number' && o.version > 1) throw new Error(`This file was made by a newer kSignal (version ${o.version}).`)
  const warnings: string[] = []
  const s = (o.source && typeof o.source === 'object' ? o.source : {}) as Record<string, unknown>
  let source: Source
  let samples: Float64Array | null = null
  if (s.kind === 'data') {
    source = normalizeData(s)
    if (source.data) {
      try { samples = decodeFloat32(source.data) } catch { warnings.push('The embedded samples could not be decoded.') }
      if (samples && source.count && samples.length !== source.count) warnings.push(`The file says ${source.count} samples but holds ${samples.length}.`)
    } else if (!source.path) warnings.push('This signal has neither samples nor a path to import them from.')
  } else source = normalizeGenerator(s)
  const tab = TABS.includes(o.tab as Tab) ? (o.tab as Tab) : 'time'
  const cur = (o.cursors && typeof o.cursors === 'object' ? o.cursors : {}) as Record<string, unknown>
  const project: KsigProject = {
    format: 'ksig', version: 1,
    name: typeof o.name === 'string' && o.name ? o.name : 'Untitled',
    ...(typeof o.description === 'string' && o.description ? { description: o.description } : {}),
    ...(o.synthetic === true ? { synthetic: true } : {}),
    source,
    analysis: normalizeAnalysis(o.analysis),
    filter: normalizeFilterSpec(o.filter),
    compare: o.compare && typeof o.compare === 'object' ? normalizeFilterSpec(o.compare) : null,
    process: normalizeProcess(o.process),
    tab,
    cursors: { a: numOrNull(cur.a, null), b: numOrNull(cur.b, null) },
  }
  return { project, samples, warnings }
}
