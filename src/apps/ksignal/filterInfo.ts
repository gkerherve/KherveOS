// What a filter design does, in numbers (pure): cutoffs, gains, group delay, stability.

import { cabs, frequencyGrid, frequencyResponse, isStable, type FilterDesign } from './filters.ts'

export interface FilterMetrics {
  kind: 'FIR' | 'IIR'
  /** Taps (FIR) or poles (IIR). */
  size: number
  stable: boolean
  dcGainDb: number
  nyquistGainDb: number
  peakGainDb: number
  /** Frequencies where the gain crosses 3.01 dB below its peak, Hz. */
  cutoffs3dB: number[]
  /** Group delay at DC and its mean over the frequencies within 3 dB of the peak, in samples. */
  groupDelayDc: number
  groupDelayPass: number
  /** Largest minus smallest group delay within the passband, samples (0 = linear phase). */
  groupDelaySpread: number
  zeroPhase: boolean
}

export function filterMetrics(d: FilterDesign): FilterMetrics {
  const n = d.b.length > 300 && !d.sos.length ? 1201 : 4001
  const f = frequencyGrid(0, d.fs / 2, n)
  const r = frequencyResponse(d, f)
  let peak = -Infinity
  for (let i = 0; i < n; i++) if (r.magDb[i] > peak) peak = r.magDb[i]
  const level = peak - 3.0103
  const cut: number[] = []
  for (let i = 1; i < n; i++) {
    const a = r.magDb[i - 1] - level
    const b = r.magDb[i] - level
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) cut.push(f[i - 1] + ((f[i] - f[i - 1]) * a) / (a - b))
  }
  let sum = 0
  let cnt = 0
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < n; i++) {
    if (r.magDb[i] >= level) { sum += r.groupDelay[i]; cnt++; lo = Math.min(lo, r.groupDelay[i]); hi = Math.max(hi, r.groupDelay[i]) }
  }
  return {
    kind: d.kind === 'fir' ? 'FIR' : 'IIR',
    size: d.kind === 'fir' ? d.b.length : d.poles.length,
    stable: isStable(d),
    dcGainDb: r.magDb[0],
    nyquistGainDb: r.magDb[n - 1],
    peakGainDb: peak,
    cutoffs3dB: cut,
    groupDelayDc: r.groupDelay[0],
    groupDelayPass: cnt ? sum / cnt : 0,
    groupDelaySpread: cnt ? hi - lo : 0,
    zeroPhase: d.spec.zeroPhase,
  }
}

/** The largest pole radius (stability margin = 1 − this). */
export function maxPoleRadius(d: FilterDesign): number {
  return d.poles.reduce((m, p) => Math.max(m, cabs(p)), 0)
}
