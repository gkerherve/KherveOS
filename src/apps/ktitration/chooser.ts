// Which indicator for which curve (pure): every indicator's end point against an equivalence point of an
// acid–base titration, its titration error and a verdict.

import { endpointError, equivalencePoints, prepare, suitability, type AcidBaseSpec, type Suitability } from './acidbase.ts'
import { INDICATORS, type Indicator } from './data/indicators.ts'

export interface Ranked {
  ind: Indicator
  /** Volume at which the indicator changes (mL) and the error against the equivalence point, percent. */
  V: number | null
  errorPercent: number | null
  verdict: Suitability
  /** The colour range [lo, hi] overlaps the pH jump around the equivalence point. */
  inJump: boolean
}

export interface Ranking {
  eqIndex: number
  Veq: number
  /** pH 0.1 % before and after the equivalence point: the jump the indicator has to fall into. */
  jump: [number, number]
  list: Ranked[]
}

/** All two-colour indicators sorted by the size of their error at equivalence point `eqIndex` (1-based). */
export function rankIndicators(spec: AcidBaseSpec, eqIndex = 1): Ranking | null {
  const eq = equivalencePoints(spec)
  const e = eq[eqIndex - 1]
  if (!e) return null
  const p = prepare(spec)
  const a = p.ph(e.V * 0.999)
  const b = p.ph(e.V * 1.001)
  const jump: [number, number] = [Math.min(a, b), Math.max(a, b)]
  const list = INDICATORS.filter((i) => !i.stops).map((ind): Ranked => {
    const r = endpointError(spec, ind.pKin, eqIndex)
    return { ind, V: r.V, errorPercent: r.errorPercent, verdict: suitability(r.errorPercent), inJump: ind.lo <= jump[1] && ind.hi >= jump[0] }
  })
  list.sort((x, y) => Math.abs(x.errorPercent ?? 1e9) - Math.abs(y.errorPercent ?? 1e9))
  return { eqIndex, Veq: e.V, jump, list }
}
