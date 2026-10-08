// A KherveCalc session: modes, history, variables, lists, graphs and the
// Python cell, saved as a .kcalc file (JSON). Pure, so tools/tests can check
// the file format and the history rules.

import type { AngleUnit, ComplexForm, NumFormat, NumPayload } from './format.ts'
import type { Base, WordSize } from './programmer.ts'
import type { View } from './plot.ts'

export type NumberMode = 'exact' | 'decimal' | 'fraction'

export interface CalcSettings {
  number: NumberMode
  /** Significant digits for decimal results (1–1000). */
  digits: number
  format: NumFormat
  /** Decimals in 'fix', significant digits in 'sci'/'eng' (0 = all). */
  fix: number
  angle: AngleUnit
  complex: ComplexForm
  base: Base
  bits: WordSize
  signed: boolean
}

export const DEFAULT_SETTINGS: CalcSettings = {
  number: 'exact', digits: 12, format: 'normal', fix: 4, angle: 'rad', complex: 'rect', base: 16, bits: 32, signed: true,
}

/** What the engine answered (see dispatch/describe in engine.py). */
export interface Answer {
  ok: boolean
  error?: string
  kind?: 'value' | 'def' | 'list' | 'bool' | 'solutions' | 'labeled' | 'matrix' | 'expr' | 'text' | 'quantity'
  latex?: string
  text?: string
  exact?: boolean
  num?: NumPayload | null
  unit_latex?: string
  unit_text?: string
  approx_latex?: string
  approx_text?: string
  mixed_latex?: string
  show_approx?: boolean
  long?: boolean
  name?: string
  rows?: number
  cols?: number
  cells?: string[][] | null
  values?: string[]
  srepr?: string | null
  /** The input as LaTeX (engine preview of what was typed). */
  input_latex?: string | null
  /** The variables after a definition (VarInfo[] in CalcView). */
  vars?: unknown[]
}

export interface HistoryEntry {
  id: string
  input: string
  /** The input as typed, pretty (from the engine's preview). */
  inputLatex?: string
  answer: Answer
  /** The modes it was computed in (shown when they differ from now). */
  mode: Pick<CalcSettings, 'number' | 'angle' | 'digits'>
  time: number
}

export interface GraphItem {
  id: string
  kind: 'y' | 'param' | 'polar' | 'implicit' | 'ode'
  expr: string
  /** y(t) of a parametric curve. */
  expr2?: string
  tmin?: string
  tmax?: string
  x0?: string
  y0?: string
  color: string
  visible: boolean
}

export type ListName = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6'
export const LIST_NAMES: ListName[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']

export interface Session {
  format: 'kcalc'
  version: 1
  settings: CalcSettings
  history: HistoryEntry[]
  /** Definitions in the order they were made ("a := 5", "f(x) := x^2"), replayed on open. */
  defs: string[]
  lists: Record<ListName, (number | null)[]>
  graphs: GraphItem[]
  view: View
  program: string
}

export const MAX_HISTORY = 400

export function emptyLists(): Record<ListName, (number | null)[]> {
  return { L1: [], L2: [], L3: [], L4: [], L5: [], L6: [] }
}

export function newSession(): Session {
  return {
    format: 'kcalc', version: 1, settings: { ...DEFAULT_SETTINGS }, history: [], defs: [], lists: emptyLists(),
    graphs: [], view: { xmin: -10, xmax: 10, ymin: -7, ymax: 7 },
    program: '# Python with SymPy, mpmath, NumPy and SciPy.\n# Functions defined here can be used in the calculator.\nimport sympy as sp\n\ndef f(x):\n    return x**2 + 1\n\nprint(f(3))\n',
  }
}

let counter = 0
/** A unique id for a history entry. */
export function newId(): string {
  counter = (counter + 1) % 1e6
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** ans, ans1, ans2…: the ids of the results before `index` (or the end), newest first, skipping errors. */
export function ansIds(history: HistoryEntry[], index = history.length): string[] {
  const out: string[] = []
  for (let i = Math.min(index, history.length) - 1; i >= 0 && out.length < 50; i--) if (history[i].answer.ok) out.push(history[i].id)
  return out
}

/** Keep a definition list in order: a redefinition moves to the end, replacing the old one. */
export function upsertDef(defs: string[], name: string, src: string): string[] {
  return [...defs.filter((d) => defName(d) !== name), src]
}

/** The name a definition line defines: "f(x) := …" -> "f", "a := 3" -> "a", "5 -> b" -> "b". */
export function defName(src: string): string | null {
  const m = /^\s*([A-Za-zͰ-Ͽ]\w*)\s*(\([^()]*\))?\s*:=/.exec(src)
  if (m) return m[1]
  const s = /(?:->|→|▶)\s*([A-Za-zͰ-Ͽ]\w*)\s*$/.exec(src)
  return s ? s[1] : null
}

/** Input history for ↑/↓: the distinct inputs, oldest first. */
export function inputHistory(history: HistoryEntry[]): string[] {
  const out: string[] = []
  for (const h of history) if (out[out.length - 1] !== h.input) out.push(h.input)
  return out
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Read a .kcalc file; anything missing or malformed takes its default. */
export function parseSession(text: string): Session {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This is not a KherveCalc session (.kcalc) file.')
  }
  if (!isObj(raw) || raw.format !== 'kcalc') throw new Error('This is not a KherveCalc session (.kcalc) file.')
  if (typeof raw.version === 'number' && raw.version > 1) throw new Error('This session was saved by a newer KherveCalc.')
  const base = newSession()
  const st = isObj(raw.settings) ? raw.settings : {}
  const pick = <T>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d)
  const settings: CalcSettings = {
    number: pick(st.number, ['exact', 'decimal', 'fraction'] as const, base.settings.number),
    digits: typeof st.digits === 'number' ? Math.max(1, Math.min(1000, Math.round(st.digits))) : base.settings.digits,
    format: pick(st.format, ['normal', 'sci', 'eng', 'fix'] as const, base.settings.format),
    fix: typeof st.fix === 'number' ? Math.max(0, Math.min(100, Math.round(st.fix))) : base.settings.fix,
    angle: pick(st.angle, ['deg', 'rad', 'grad'] as const, base.settings.angle),
    complex: pick(st.complex, ['rect', 'polar'] as const, base.settings.complex),
    base: pick(st.base, [2, 8, 10, 16] as const, base.settings.base),
    bits: pick(st.bits, [8, 16, 32, 64] as const, base.settings.bits),
    signed: typeof st.signed === 'boolean' ? st.signed : base.settings.signed,
  }
  const history = Array.isArray(raw.history)
    ? raw.history
        .filter((h): h is Record<string, unknown> => isObj(h) && typeof h.input === 'string' && isObj(h.answer))
        .slice(-MAX_HISTORY)
        .map((h) => ({
          id: typeof h.id === 'string' ? h.id : newId(),
          input: h.input as string,
          inputLatex: typeof h.inputLatex === 'string' ? h.inputLatex : undefined,
          answer: h.answer as unknown as Answer,
          mode: isObj(h.mode) ? (h.mode as unknown as HistoryEntry['mode']) : { number: settings.number, angle: settings.angle, digits: settings.digits },
          time: typeof h.time === 'number' ? h.time : 0,
        }))
    : []
  const lists = emptyLists()
  if (isObj(raw.lists)) {
    for (const n of LIST_NAMES) {
      const l = raw.lists[n]
      if (Array.isArray(l)) lists[n] = l.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
    }
  }
  const graphs = Array.isArray(raw.graphs)
    ? raw.graphs.filter((g): g is Record<string, unknown> => isObj(g) && typeof g.expr === 'string').map((g) => ({
        ...(g as unknown as GraphItem),
        id: typeof g.id === 'string' ? g.id : newId(),
        kind: pick(g.kind, ['y', 'param', 'polar', 'implicit', 'ode'] as const, 'y'),
        visible: g.visible !== false,
        color: typeof g.color === 'string' ? g.color : '#22b357',
      }))
    : []
  const v = isObj(raw.view) ? raw.view : {}
  const view = ['xmin', 'xmax', 'ymin', 'ymax'].every((k) => typeof v[k] === 'number' && Number.isFinite(v[k]))
    && (v.xmax as number) > (v.xmin as number) && (v.ymax as number) > (v.ymin as number)
    ? (v as unknown as View)
    : base.view
  return {
    format: 'kcalc', version: 1, settings, history,
    defs: Array.isArray(raw.defs) ? raw.defs.filter((d): d is string => typeof d === 'string') : [],
    lists, graphs, view, program: typeof raw.program === 'string' ? raw.program : base.program,
  }
}

export function serializeSession(s: Session): string {
  return JSON.stringify({ ...s, history: s.history.slice(-MAX_HISTORY) }, null, 1)
}

/** The plain-text transcript of the history (File › Export). */
export function historyText(history: HistoryEntry[]): string {
  return history
    .map((h) => (h.answer.ok ? `${h.input}\n  = ${h.answer.text ?? ''}` : `${h.input}\n  ! ${h.answer.error ?? 'error'}`))
    .join('\n\n')
}
