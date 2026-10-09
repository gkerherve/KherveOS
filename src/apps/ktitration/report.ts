// Text exports of kTitration (pure): the curve as CSV, a Markdown report of a titration, and of an analysis of
// measured data.

import type { Item } from './acidbase.ts'
import type { BufferSpec, Recipe } from './buffer.ts'
import type { GranResult, DetectedEquivalence, TitrationData } from './analyse.ts'
import { fixed, sig, plain } from './format.ts'
import type { FitResult, FitSetup } from './fit.ts'
import type { Project } from './project.ts'
import type { TitrationResult } from './result.ts'

/** The curve as CSV: volume, the quantity, its first and second derivative. */
export function curveCsv(r: TitrationResult): string {
  const head = `V_mL,${plain(r.yShort).replace(/,/g, ' ')},d${plain(r.yShort)}/dV,d2${plain(r.yShort)}/dV2`
  const rows = r.V.map((v, i) => [v, r.y[i], r.dy[i], r.d2y[i]].map((x) => (Number.isFinite(x) ? Number(x.toPrecision(8)) : '')).join(','))
  return [head, ...rows].join('\n') + '\n'
}

/** Measured data plus the fitted values and residuals as CSV. */
export function dataCsv(d: TitrationData, fit?: FitResult | null): string {
  const cols = ['V_mL', 'pH', ...(d.T ? ['T_C'] : []), ...(fit?.ok ? ['pH_fit', 'residual'] : [])]
  const rows = d.V.map((v, i) => [v, d.pH[i], ...(d.T ? [d.T[i]] : []), ...(fit?.ok ? [Number(fit.fitted[i].toFixed(5)), Number(fit.residuals[i].toFixed(5))] : [])].join(','))
  return [cols.join(','), ...rows].join('\n') + '\n'
}

function itemLine(i: Item): string {
  if (i.kind === 'weak') return `| ${i.label} | weak, pKa ${i.pKa.join(', ')} | ${sig(i.conc, 4)} M | ${fixed(i.volume, 2)} mL |`
  return `| ${i.label} | ${i.kind === 'strong-acid' ? 'strong acid' : 'strong base'} | ${sig(i.conc, 4)} M | ${fixed(i.volume, 2)} mL |`
}

/** A Markdown report of the titration shown. `date` is passed in so the text stays reproducible. */
export function titrationReport(p: Project, r: TitrationResult, date = ''): string {
  const L: string[] = []
  L.push(`# ${p.name || 'Titration'}`, '')
  if (date) L.push(`_${date}_`, '')
  if (p.description) L.push(p.description, '')
  if (r.invalid) return [...L, `**Not computed:** ${r.invalid}`, ''].join('\n')
  L.push('## Setup', '')
  if (p.mode === 'acidbase') {
    const s = p.acidbase
    L.push('| Flask content | Type | Concentration | Volume |', '|---|---|---|---|', ...s.items.map(itemLine))
    L.push('', `Titrant: ${s.titrant.label}, ${sig(s.titrant.conc, 4)} M. Water added: ${fixed(s.water, 2)} mL. Temperature ${s.temperature} °C. Activity model: ${s.activity === 'none' ? 'ideal (activities = concentrations)' : s.activity === 'davies' ? 'Davies' : 'extended Debye–Hückel'}${s.background > 0 ? `; background electrolyte ${s.background} M` : ''}.`)
  } else if (p.mode === 'redox') {
    const s = p.redox
    L.push(`Analyte: ${s.analyte.couple.label} (${s.analyte.start === 'red' ? 'reduced' : 'oxidised'} form), ${sig(s.analyte.conc, 4)} M, ${fixed(s.analyte.volume, 2)} mL, formal potential ${fixed(s.analyte.couple.E0, 3)} V.`)
    L.push(`Titrant: ${s.titrant.couple.label}, ${sig(s.titrant.conc, 4)} M, formal potential ${fixed(s.titrant.couple.E0, 3)} V. pH ${s.pH}, ${s.temperature} °C.`)
  } else if (p.mode === 'edta') {
    const s = p.edta
    L.push(`Metal: ${s.metal.ion}, ${sig(s.conc, 4)} M, ${fixed(s.volume, 2)} mL. EDTA ${sig(s.titrantConc, 4)} M. Buffered at pH ${s.pH}${s.ammonia > 0 ? ` with ${s.ammonia} M ammonia` : ''}.`)
  } else {
    const s = p.precip
    L.push(s.mode === 'silver-titrant' ? `Anions: ${s.anions.map((a) => `${a.salt} ${sig(a.conc, 3)} M × ${fixed(a.volume, 2)} mL`).join('; ')}. Titrant AgNO₃ ${sig(s.titrantConc, 4)} M.` : `Silver ${sig(s.silver.conc, 4)} M × ${fixed(s.silver.volume, 2)} mL titrated with thiocyanate ${sig(s.titrantConc, 4)} M.`)
  }
  L.push('', '## Results', '', '| Quantity | Value |', '|---|---|', ...r.facts.map(([k, v]) => `| ${k} | ${v} |`))
  if (r.notes.length) L.push('', '## Notes', '', ...r.notes.map((n) => `- ${n}`))
  L.push('', '_Calculated by kTitration from the exact equilibrium conditions (charge balance, mass balance, Nernst equation); real samples differ by electrode calibration, temperature and activity effects._', '')
  return L.join('\n')
}

/** A Markdown report of an analysis of measured data. */
export function analysisReport(name: string, d: TitrationData, eq: DetectedEquivalence[], setup: FitSetup, gran: GranResult | null, fit: FitResult | null, source = ''): string {
  const L: string[] = [`# ${name || 'Titration data'}: analysis`, '']
  if (source) L.push(`Data: ${source}`, '')
  L.push(`${d.V.length} points, V ${fixed(d.V[0], 2)}–${fixed(d.V[d.V.length - 1], 2)} mL, pH ${fixed(Math.min(...d.pH), 2)}–${fixed(Math.max(...d.pH), 2)}.`, '')
  L.push('## Equivalence points (derivative)', '')
  if (eq.length === 0) L.push('None found: the curve has no clear steepest region.')
  else {
    L.push('| # | V (1st derivative) | V (2nd derivative zero) | pH | Concentration if k protons |', '|---|---|---|---|---|')
    eq.forEach((e, i) => L.push(`| ${i + 1} | ${fixed(e.V1, 3)} mL | ${e.V2 === null ? '–' : `${fixed(e.V2, 3)} mL`} | ${fixed(e.pH, 2)} | ${sig((setup.Ct * e.V) / (setup.aliquot * (i + 1)), 4)} M |`))
  }
  if (gran) {
    L.push('', '## Gran plot', '', `Equivalence volume ${gran.Ve === null ? '–' : `${fixed(gran.Ve, 3)} mL`} (before: ${gran.before.Ve === null ? '–' : fixed(gran.before.Ve, 3)}, after: ${gran.after.Ve === null ? '–' : fixed(gran.after.Ve, 3)}).`)
    if (gran.conc !== null) L.push(`Analyte concentration ${sig(gran.conc, 4)} M.`)
    if (gran.pKa !== null) L.push(`pKa from the slope: ${fixed(gran.pKa, 2)} (uncorrected for activities).`)
  }
  if (fit?.ok) {
    L.push('', '## Fit of the full titration model', '', `Levenberg–Marquardt, ${fit.iterations} iterations, ${fit.converged ? 'converged' : 'not converged'}; RMSE ${sig(fit.rmse, 3)} pH units, R² ${fit.r2.toFixed(5)}, ${fit.dof} degrees of freedom.`, '')
    L.push('| Parameter | Value | Std. error | 95 % interval |', '|---|---|---|---|')
    for (const p of fit.params) L.push(`| ${p.name}${p.fixed ? ' (fixed)' : ''} | ${sig(p.value, 5)} | ${p.fixed ? '–' : sig(p.se, 2)} | ${p.fixed ? '–' : `± ${sig(p.ci95, 2)}`} |`)
    if (fit.eq.length) L.push('', `Equivalence volumes of the fitted model: ${fit.eq.map((v) => `${fixed(v, 3)} mL`).join(', ')}.`)
  } else if (fit) L.push('', '## Fit', '', fit.message)
  L.push('')
  return L.join('\n')
}

/** The recipe of a designed buffer as Markdown. */
export function bufferReport(b: BufferSpec, r: Recipe): string {
  const L: string[] = [`# Buffer: ${b.sys.label}, pH ${b.pH}`, '']
  if (!r.ok && r.parts.length === 0) return [...L, r.message, ''].join('\n')
  L.push(`${sig(b.conc, 4)} M total, ${sig(b.volume, 4)} mL, ${b.temperature} °C${b.ionicStrength ? `, ionic strength ${b.ionicStrength} M` : ''}${b.activity === 'none' ? ' (ideal)' : b.activity === 'davies' ? ' (Davies activities)' : ' (extended Debye–Hückel activities)'}.`, '')
  L.push('| Component | Amount | In the buffer | Stock volume |', '|---|---|---|---|')
  for (const i of r.items) L.push(`| ${i.label} | ${sig(i.mmol, 4)} mmol | ${sig(i.conc, 4)} M | ${i.stockVolume === null ? 'weigh dry' : `${fixed(i.stockVolume, 2)} mL`} |`)
  L.push(`| Water | | | ${fixed(r.water, 2)} mL (to the final volume) |`, '')
  L.push(`Check: pH ${fixed(r.pH, 3)}, ionic strength ${sig(r.I, 3)} M, buffer capacity ${sig(r.beta, 3)} mol/L per pH unit.`, '')
  L.push('pH of this recipe at other temperatures:', '', '| T / °C | pH |', '|---|---|', ...r.byTemperature.map((t) => `| ${t.T} | ${fixed(t.pH, 2)} |`), '')
  if (r.message) L.push(`_${r.message}_`, '')
  return L.join('\n')
}
