// Pure helpers behind the Python editor and the statistics (no React, no
// OS imports, so tools/tests can run them in Node).

const KEYWORDS = (
  'def class return if elif else for while in is and or not import ' +
  'from as with try except finally raise lambda yield global nonlocal ' +
  'pass break continue None True False assert del'
).split(' ')

/** 0 plain, 1 keyword, 2 number, 3 string, 4 comment. */
export type TokKind = 0 | 1 | 2 | 3 | 4
const RULES: [RegExp, TokKind][] = [
  [new RegExp(`\\b(?:${KEYWORDS.join('|')})\\b`, 'g'), 1],
  [/\b\d+(\.\d+)?\b/g, 2],
  [/'[^']*'|"[^"]*"/g, 3],
  [/#.*$/g, 4],
]

/** One line split as the desktop's PythonHighlighter colours it (rules in order, later ones win). */
export function pyTokens(line: string): { kind: TokKind; text: string }[] {
  const kinds = new Uint8Array(line.length)
  for (const [re, kind] of RULES) {
    re.lastIndex = 0
    for (let m = re.exec(line); m; m = re.exec(line)) {
      kinds.fill(kind, m.index, m.index + m[0].length)
      if (!m[0].length) re.lastIndex++
    }
  }
  const out: { kind: TokKind; text: string }[] = []
  let i = 0
  while (i < line.length) {
    let j = i
    while (j < line.length && kinds[j] === kinds[i]) j++
    out.push({ kind: kinds[i] as TokKind, text: line.slice(i, j) })
    i = j
  }
  return out
}

/** The line number of the cell's code in a traceback ("<py-cell>", line N), the last one. */
export function errorLineFrom(tb: string | null | undefined): number | null {
  let ln: number | null = null
  for (const m of (tb ?? '').matchAll(/"<py-cell>", line (\d+)/g)) ln = Number(m[1])
  return ln
}

/** Compact label for a loop interval, e.g. 5 -> '5s', 90 -> '1m' (python_engine.fmt_loop_period). */
export function fmtLoopPeriod(secs: number): string {
  if (secs < 1) return `${+secs.toPrecision(6)}s`
  const s = Math.round(secs)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

/** Python's "%.6g". */
export function fmt6g(v: number): string {
  if (!Number.isFinite(v)) return v !== v ? 'nan' : v > 0 ? 'inf' : '-inf'
  if (v === 0) return '0'
  const e = Number(v.toExponential(5).split('e')[1])
  if (e < -4 || e >= 6) {
    const [m, x] = v.toExponential(5).split('e')
    const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m
    const n = Number(x)
    return `${mant}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`
  }
  const s = v.toFixed(Math.max(0, 5 - e))
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** Count, Sum, Mean, Std Dev, Min, Max, Median (mainwindow._show_statistics), or null without numbers. */
export function statisticsText(values: number[]): string | null {
  const v = values.filter(Number.isFinite)
  if (!v.length) return null
  const n = v.length
  const sum = v.reduce((a, b) => a + b, 0)
  const mean = sum / n
  const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
  const s = [...v].sort((a, b) => a - b)
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
  return [
    `Count: ${n}`, `Sum: ${fmt6g(sum)}`, `Mean: ${fmt6g(mean)}`, `Std Dev: ${fmt6g(std)}`, `Min: ${fmt6g(s[0])}`, `Max: ${fmt6g(s[n - 1])}`,
    `Median: ${fmt6g(median)}`,
  ].join('\n')
}
