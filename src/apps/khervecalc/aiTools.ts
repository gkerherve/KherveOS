// KherveCalc's AI tools (khervecalc_evaluate, _solve, _convert, _get_history,
// _set_mode). Names and arguments are in src/os/ai/manifests/khervecalc.ts.

import type { AppTools } from '@/os/ai/appTools'
import { shown } from './display'
import type { Answer, CalcSettings, HistoryEntry } from './session'
import type { VarInfo } from './CalcView'

export interface CalcToolApi {
  settings: () => CalcSettings
  evaluate: (src: string, override?: Partial<CalcSettings>) => Promise<HistoryEntry | null>
  convert: (value: string, from: string, to: string) => Promise<Answer>
  history: () => HistoryEntry[]
  vars: () => VarInfo[]
  setSettings: (p: Partial<CalcSettings>) => void
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** A result as the AI sees it. */
export function describeEntry(h: HistoryEntry, s: CalcSettings) {
  if (!h.answer.ok) return { input: h.input, error: h.answer.error }
  const sh = shown(h.answer, s)
  return {
    input: h.input,
    result: h.answer.text,
    ...(sh.approxText && sh.approxText !== h.answer.text ? { decimal: sh.approxText } : {}),
    ...(sh.text && sh.text !== h.answer.text ? { shown: sh.text } : {}),
    latex: h.answer.latex,
  }
}

export function calcTools(api: CalcToolApi): AppTools {
  const run = async (src: string, override?: Partial<CalcSettings>) => {
    const h = await api.evaluate(src, override)
    if (!h) throw new Error('The calculation was cancelled.')
    const d = describeEntry(h, { ...api.settings(), ...override })
    if ('error' in d && d.error) throw new Error(`${src}: ${d.error}`)
    return d
  }
  return {
    evaluate: async (a) => {
      const expr = text(a.expression)
      if (!expr) throw new Error('Pass what to calculate as "expression".')
      const override: Partial<CalcSettings> = {}
      if (a.mode === 'exact' || a.mode === 'decimal' || a.mode === 'fraction') override.number = a.mode
      if (typeof a.digits === 'number' && a.digits >= 1) override.digits = Math.min(1000, Math.round(a.digits))
      return run(expr, override)
    },
    solve: async (a) => {
      const eq = text(a.equation)
      if (!eq) throw new Error('Pass the equation as "equation", e.g. "x^2 = 2".')
      const v = text(a.variable)
      if (a.numeric === true) {
        const g = text(a.guess) ?? '0'
        return run(`nsolve(${eq}, ${v ?? 'x'}, ${g})`)
      }
      return run(v ? `solve(${eq}, ${v})` : `solve(${eq})`)
    },
    convert: async (a) => {
      const value = text(a.value) ?? (typeof a.value === 'number' ? String(a.value) : undefined)
      const from = text(a.from)
      const to = text(a.to)
      if (!value || !from || !to) throw new Error('Pass "value", "from" and "to", e.g. 100, "km/h", "m/s".')
      const r = await api.convert(value, from.replace(/^_/, ''), to.replace(/^_/, ''))
      if (!r.ok) throw new Error(r.error ?? 'Could not convert')
      const sh = shown(r, api.settings())
      return { value, from, to, result: r.text, ...(sh.approxText ? { decimal: sh.approxText } : sh.text !== r.text ? { decimal: sh.text } : {}) }
    },
    get_history: async (a) => {
      const n = typeof a.limit === 'number' && a.limit > 0 ? Math.min(200, Math.round(a.limit)) : 20
      const s = api.settings()
      return {
        entries: api.history().slice(-n).map((h) => describeEntry(h, s)),
        variables: api.vars().map((v) => v.text),
        modes: { number: s.number, angle: s.angle, digits: s.digits, complex: s.complex, format: s.format },
      }
    },
    set_mode: async (a) => {
      const p: Partial<CalcSettings> = {}
      if (a.number === 'exact' || a.number === 'decimal' || a.number === 'fraction') p.number = a.number
      if (a.angle === 'deg' || a.angle === 'rad' || a.angle === 'grad') p.angle = a.angle
      if (typeof a.digits === 'number' && a.digits >= 1) p.digits = Math.min(1000, Math.round(a.digits))
      if (a.complex === 'rect' || a.complex === 'polar') p.complex = a.complex
      if (a.format === 'normal' || a.format === 'sci' || a.format === 'eng' || a.format === 'fix') p.format = a.format
      if (!Object.keys(p).length) throw new Error('Pass at least one of number, angle, digits, complex, format.')
      api.setSettings(p)
      const s = { ...api.settings(), ...p }
      return { number: s.number, angle: s.angle, digits: s.digits, complex: s.complex, format: s.format }
    },
  }
}
