// The Markdown report of a reaction: equation, structures (embedded SVG), species table, atom / mass / charge
// balance and optional extra sections. Pure functions; the structures come in as a map SMILES → plain SVG.

import { equationText } from './balance.ts'
import { num } from './formula.ts'
import { ARROWS, type Analysis, type ReactionInput } from './reaction.ts'
import { svgDataUri } from './svgtheme.ts'

export interface ReportOptions {
  title?: string
  analysis: Analysis
  input: Pick<ReactionInput, 'arrow' | 'above' | 'below'>
  /** Coefficients to report (reactants then products); null: the typed ones. */
  coeffs: number[] | null
  svgs?: ReadonlyMap<string, string>
  /** Extra sections: heading and Markdown body. */
  sections?: { heading: string; body: string }[]
  date?: Date
}

export function reportMarkdown(o: ReportOptions): string {
  const a = o.analysis
  const coeffs = o.coeffs ?? a.coefficients
  const all = [...a.reactants, ...a.products]
  const out: string[] = [`# ${o.title ?? 'Reaction report'}`, '']
  const d = o.date ?? new Date()
  out.push(`*kReaction · ${d.toISOString().slice(0, 10)}*`, '')
  const eq = equationText({ reactants: a.reactants.map((s) => s.label), products: a.products.map((s) => s.label) }, coeffs, ARROWS[o.input.arrow].symbol)
  out.push('## Equation', '', `**${eq}**`, '')
  if (o.input.above || o.input.below) out.push(`Conditions: ${[o.input.above, o.input.below].filter(Boolean).join('; ')}`, '')
  if (o.svgs) {
    const row = (list: typeof all, offset: number) =>
      list
        .map((s, i) => {
          const svg = s.smiles ? o.svgs?.get(s.smiles) : undefined
          const c = coeffs[offset + i]
          const label = `${c !== undefined && c !== 1 ? `${c} × ` : ''}${s.name ?? s.label}`
          return svg ? `![${label}](${svgDataUri(svg)})` : `**${label}**`
        })
        .join(' + ')
    out.push('## Structures', '', `${row(a.reactants, 0)} ${ARROWS[o.input.arrow].symbol} ${row(a.products, a.reactants.length)}`, '')
  }
  out.push('## Species', '', '| | Species | SMILES | Formula | M (g/mol) | Charge | Coefficient |', '|---|---|---|---|---|---|---|')
  all.forEach((s, i) => {
    out.push(`| ${i < a.reactants.length ? 'reactant' : 'product'} | ${s.name ?? s.input} | ${s.smiles ? `\`${s.smiles}\`` : '—'} | ${s.label} | ${num(s.mass, 5)} | ${s.charge || 0} | ${coeffs[i] ?? 1} |`)
  })
  out.push('')
  if (a.check) {
    out.push('## Balance', '', '| | Reactants | Products | |', '|---|---|---|---|')
    for (const r of a.check.rows) out.push(`| ${r.what} | ${r.left} | ${r.right} | ${r.ok ? '✓' : '✗'} |`)
    out.push(`| mass (g/mol) | ${num(a.check.massLeft, 6)} | ${num(a.check.massRight, 6)} | ${a.check.massOk ? '✓' : '✗'} |`, '')
    out.push(a.check.balanced ? 'The equation is balanced in atoms, mass and charge.' : 'The equation is **not** balanced with these coefficients.', '')
  }
  if (a.balance && a.balance.coefficients.length && !(a.check?.balanced)) {
    out.push(`Balancer: ${a.balance.message} Coefficients: ${a.balance.coefficients.join(', ')}.`, '')
  }
  for (const s of o.sections ?? []) out.push(`## ${s.heading}`, '', s.body, '')
  return out.join('\n')
}
