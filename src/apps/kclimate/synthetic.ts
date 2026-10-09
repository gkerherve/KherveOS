// Made-up ("synthetic") data for the import starter and for tests. Everything here is deterministic and labelled
// synthetic in the interface: it is never presented as an observation.

import { buildImport, inferMapping, parseCsv, type ImportedDataset } from './importCsv.ts'

/** mulberry32: a small seeded generator, so the same text comes out every time. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A standard normal from the generator (Box–Muller). */
export function gaussian(rand: () => number): () => number {
  return () => {
    const u = Math.max(1e-12, rand())
    const v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}

/** AR(1) noise with lag-1 autocorrelation phi and standard deviation sd. */
export function ar1Noise(n: number, phi: number, sdev: number, seed: number): number[] {
  const g = gaussian(rng(seed))
  const out: number[] = []
  let x = 0
  const innov = sdev * Math.sqrt(1 - phi * phi)
  for (let i = 0; i < n; i++) { x = phi * x + innov * g(); out.push(x) }
  return out
}

/**
 * The text of a sample CSV: monthly values 1995–2024 of an invented weather station (temperature with a seasonal cycle and
 * a warming trend of 0.4 °C per decade, and rainfall). Rounded to 0.1.
 */
export function sampleCsv(): string {
  const years = 30
  const noiseT = ar1Noise(years * 12, 0.5, 0.8, 7)
  const g = gaussian(rng(11))
  const lines = ['date,temperature_c,rainfall_mm']
  for (let i = 0; i < years * 12; i++) {
    const y = 1995 + Math.floor(i / 12)
    const m = (i % 12) + 1
    const x = i / 12
    const temp = 11 + 0.04 * x + 8.5 * Math.cos((2 * Math.PI * (m - 0.5 - 6.5)) / 12) + noiseT[i]
    const rain = Math.max(0, 60 + 18 * Math.cos((2 * Math.PI * (m - 0.5 - 11)) / 12) + 14 * g())
    lines.push(`${y}-${String(m).padStart(2, '0')},${temp.toFixed(1)},${rain.toFixed(1)}`)
  }
  return lines.join('\n') + '\n'
}

/** The sample as an imported dataset (the way the import dialog would make it), marked synthetic. */
export function sampleDataset(): ImportedDataset {
  const table = parseCsv(sampleCsv())
  const mp = inferMapping(table, 'Synthetic weather station')
  mp.names = ['Temperature (synthetic)', 'Rainfall (synthetic)']
  const r = buildImport(table, { ...mp, names: ['Temperature', 'Rainfall'] }, { synthetic: true })
  if ('error' in r) throw new Error(r.error)
  r.dataset.columns[0].unit = '°C'
  r.dataset.columns[1].unit = 'mm'
  r.dataset.id = 'user:synthetic_station'
  return r.dataset
}
