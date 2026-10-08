// KherveCalc's statistics in the browser: one- and two-variable summaries and
// regressions (linear, polynomial, exponential, logarithmic, power), as on a
// graphing calculator. Pure, so tools/tests can check the numbers.
// Distributions and hypothesis tests run in Python (SciPy).

export interface OneVar {
  n: number
  sum: number
  sum2: number
  mean: number
  /** Sample standard deviation (n − 1). */
  sx: number
  /** Population standard deviation (n). */
  sigma: number
  variance: number
  min: number
  q1: number
  median: number
  q3: number
  max: number
  range: number
  iqr: number
  mode: number[]
  skewness: number
  /** Excess kurtosis (0 for a normal distribution). */
  kurtosis: number
  sem: number
  cv: number
}

export const nums = (xs: (number | null | undefined)[]): number[] => xs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

function medianOf(sorted: number[]): number {
  const n = sorted.length
  if (!n) return NaN
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
}

/** Summary of one list; `freq` repeats each value (frequency list). */
export function oneVar(data: number[], freq?: number[]): OneVar {
  let xs = data
  if (freq) {
    xs = []
    data.forEach((v, i) => {
      const f = Math.round(freq[i] ?? 1)
      for (let k = 0; k < f; k++) xs.push(v)
    })
  }
  const n = xs.length
  if (!n) throw new Error('The list is empty')
  const sorted = [...xs].sort((a, b) => a - b)
  const sum = xs.reduce((a, b) => a + b, 0)
  const mean = sum / n
  const sum2 = xs.reduce((a, b) => a + b * b, 0)
  const m2 = xs.reduce((a, b) => a + (b - mean) ** 2, 0)
  const m3 = xs.reduce((a, b) => a + (b - mean) ** 3, 0)
  const m4 = xs.reduce((a, b) => a + (b - mean) ** 4, 0)
  const variance = n > 1 ? m2 / (n - 1) : NaN
  const sx = Math.sqrt(variance)
  const sigma = Math.sqrt(m2 / n)
  // Quartiles as calculators do: medians of the lower and upper halves (the median left out when n is odd).
  const half = Math.floor(n / 2)
  const q1 = n > 1 ? medianOf(sorted.slice(0, half)) : sorted[0]
  const q3 = n > 1 ? medianOf(sorted.slice(n - half)) : sorted[0]
  const counts = new Map<number, number>()
  for (const v of xs) counts.set(v, (counts.get(v) ?? 0) + 1)
  const top = Math.max(...counts.values())
  const mode = top > 1 ? [...counts].filter(([, c]) => c === top).map(([v]) => v).sort((a, b) => a - b) : []
  const skewness = n > 2 && m2 > 0 ? ((n * Math.sqrt(n - 1)) / (n - 2)) * (m3 / Math.pow(m2, 1.5)) : NaN
  const kurtosis = n > 3 && m2 > 0
    ? ((n + 1) * n * (n - 1)) / ((n - 2) * (n - 3)) * (m4 / (m2 * m2)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
    : NaN
  return {
    n, sum, sum2, mean, sx, sigma, variance, min: sorted[0], q1, median: medianOf(sorted), q3, max: sorted[n - 1],
    range: sorted[n - 1] - sorted[0], iqr: q3 - q1, mode, skewness, kurtosis, sem: sx / Math.sqrt(n), cv: sx / mean,
  }
}

export interface TwoVar {
  n: number
  meanX: number
  meanY: number
  sumX: number
  sumY: number
  sumXY: number
  sumX2: number
  sumY2: number
  sx: number
  sy: number
  cov: number
  r: number
}

/** Pairs where both values are numbers. */
export function pairs(xs: (number | null | undefined)[], ys: (number | null | undefined)[]): [number[], number[]] {
  const X: number[] = []
  const Y: number[] = []
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const a = xs[i]
    const b = ys[i]
    if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) {
      X.push(a)
      Y.push(b)
    }
  }
  return [X, Y]
}

export function twoVar(X: number[], Y: number[]): TwoVar {
  const n = X.length
  if (n < 2) throw new Error('Two pairs of values or more are needed')
  const sumX = X.reduce((a, b) => a + b, 0)
  const sumY = Y.reduce((a, b) => a + b, 0)
  const meanX = sumX / n
  const meanY = sumY / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sxx += (X[i] - meanX) ** 2
    syy += (Y[i] - meanY) ** 2
    sxy += (X[i] - meanX) * (Y[i] - meanY)
  }
  return {
    n, meanX, meanY, sumX, sumY, sumXY: X.reduce((a, x, i) => a + x * Y[i], 0), sumX2: X.reduce((a, x) => a + x * x, 0),
    sumY2: Y.reduce((a, y) => a + y * y, 0), sx: Math.sqrt(sxx / (n - 1)), sy: Math.sqrt(syy / (n - 1)), cov: sxy / (n - 1),
    r: sxy / Math.sqrt(sxx * syy),
  }
}

export type Model = 'linear' | 'quadratic' | 'cubic' | 'quartic' | 'exponential' | 'logarithmic' | 'power'

export const MODELS: { id: Model; label: string; form: string }[] = [
  { id: 'linear', label: 'Linear', form: 'y = a + b·x' },
  { id: 'quadratic', label: 'Quadratic', form: 'y = a + b·x + c·x²' },
  { id: 'cubic', label: 'Cubic', form: 'y = a + b·x + c·x² + d·x³' },
  { id: 'quartic', label: 'Quartic', form: 'y = a + … + e·x⁴' },
  { id: 'exponential', label: 'Exponential', form: 'y = a·e^(b·x)' },
  { id: 'logarithmic', label: 'Logarithmic', form: 'y = a + b·ln x' },
  { id: 'power', label: 'Power', form: 'y = a·x^b' },
]

export interface Fit {
  model: Model
  /** Polynomial: a0, a1, a2…; others: a, b. */
  coeffs: number[]
  /** Coefficient of determination on the data as given. */
  r2: number
  /** Correlation coefficient of the linear(ised) fit. */
  r: number | null
  residuals: number[]
  /** Text the calculator can read back, in x. */
  expr: string
  latex: string
  predict: (x: number) => number
}

/** Solve the linear system A·x = b (Gaussian elimination, partial pivoting). */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    if (Math.abs(M[piv][c]) < 1e-300) throw new Error('The fit is singular (too few distinct x values?)')
    ;[M[c], M[piv]] = [M[piv], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

/** Least-squares polynomial of a degree (x scaled for stability). */
export function polyFit(X: number[], Y: number[], degree: number): number[] {
  if (X.length <= degree) throw new Error(`A degree-${degree} fit needs ${degree + 1} points or more`)
  const mx = X.reduce((a, b) => a + b, 0) / X.length
  const sc = Math.max(...X.map((x) => Math.abs(x - mx))) || 1
  const T = X.map((x) => (x - mx) / sc)
  const m = degree + 1
  const A = Array.from({ length: m }, () => new Array<number>(m).fill(0))
  const b = new Array<number>(m).fill(0)
  for (let i = 0; i < T.length; i++) {
    const pw = [1]
    for (let k = 1; k < 2 * m; k++) pw.push(pw[k - 1] * T[i])
    for (let r = 0; r < m; r++) {
      b[r] += pw[r] * Y[i]
      for (let c = 0; c < m; c++) A[r][c] += pw[r + c]
    }
  }
  const t = solveLinear(A, b) // coefficients in t = (x - mx)/sc
  // back to powers of x: Σ t_k ((x - mx)/sc)^k
  const out = new Array<number>(m).fill(0)
  for (let k = 0; k < m; k++) {
    const ck = t[k] / sc ** k
    // (x - mx)^k = Σ C(k,j) x^j (-mx)^(k-j)
    let binom = 1
    for (let j = 0; j <= k; j++) {
      out[j] += ck * binom * (-mx) ** (k - j)
      binom = (binom * (k - j)) / (j + 1)
    }
  }
  return out
}

const num = (v: number) => {
  if (!Number.isFinite(v)) return String(v)
  const s = Math.abs(v) >= 1e-4 && Math.abs(v) < 1e10 ? String(Number(v.toPrecision(12))) : v.toExponential(11).replace(/\.?0+e/, 'e')
  return s
}
const texNum = (v: number) => num(v).replace(/e([+-]?)(\d+)/, (_m, s, d) => `\\times 10^{${s === '-' ? '-' : ''}${Number(d)}}`)

export function regression(X: number[], Y: number[], model: Model): Fit {
  if (X.length < 2) throw new Error('Two pairs of values or more are needed')
  const deg = { linear: 1, quadratic: 2, cubic: 3, quartic: 4 }[model as 'linear']
  let coeffs: number[]
  let predict: (x: number) => number
  let expr: string
  let latex: string
  let r: number | null = null
  if (deg) {
    coeffs = polyFit(X, Y, deg)
    predict = (x) => coeffs.reduce((s, c, k) => s + c * x ** k, 0)
    const terms = coeffs.map((c, k) => ({ c, k })).reverse()
    expr = terms.map(({ c, k }) => `(${num(c)})${k === 0 ? '' : k === 1 ? '*x' : `*x^${k}`}`).join(' + ')
    latex = terms
      .map(({ c, k }, i) => {
        const sign = c < 0 ? '-' : i ? '+' : ''
        const body = texNum(Math.abs(c)) + (k === 0 ? '' : k === 1 ? 'x' : `x^{${k}}`)
        return `${sign} ${body}`
      })
      .join(' ')
    if (deg === 1) r = twoVar(X, Y).r
  } else if (model === 'exponential') {
    const idx = Y.map((y, i) => (y > 0 ? i : -1)).filter((i) => i >= 0)
    if (idx.length < 2) throw new Error('An exponential fit needs positive y values')
    const lx = idx.map((i) => X[i])
    const ly = idx.map((i) => Math.log(Y[i]))
    const [a0, b] = polyFit(lx, ly, 1)
    coeffs = [Math.exp(a0), b]
    predict = (x) => coeffs[0] * Math.exp(coeffs[1] * x)
    expr = `(${num(coeffs[0])})*exp((${num(b)})*x)`
    latex = `${texNum(coeffs[0])}\\,e^{${texNum(b)}x}`
    r = twoVar(lx, ly).r
  } else if (model === 'logarithmic') {
    const idx = X.map((x, i) => (x > 0 ? i : -1)).filter((i) => i >= 0)
    if (idx.length < 2) throw new Error('A logarithmic fit needs positive x values')
    const lx = idx.map((i) => Math.log(X[i]))
    const ly = idx.map((i) => Y[i])
    coeffs = polyFit(lx, ly, 1)
    predict = (x) => coeffs[0] + coeffs[1] * Math.log(x)
    expr = `(${num(coeffs[0])}) + (${num(coeffs[1])})*ln(x)`
    latex = `${texNum(coeffs[0])} ${coeffs[1] < 0 ? '-' : '+'} ${texNum(Math.abs(coeffs[1]))}\\ln x`
    r = twoVar(lx, ly).r
  } else {
    const idx = X.map((x, i) => (x > 0 && Y[i] > 0 ? i : -1)).filter((i) => i >= 0)
    if (idx.length < 2) throw new Error('A power fit needs positive x and y values')
    const lx = idx.map((i) => Math.log(X[i]))
    const ly = idx.map((i) => Math.log(Y[i]))
    const [a0, b] = polyFit(lx, ly, 1)
    coeffs = [Math.exp(a0), b]
    predict = (x) => coeffs[0] * x ** coeffs[1]
    expr = `(${num(coeffs[0])})*x^(${num(b)})`
    latex = `${texNum(coeffs[0])}\\,x^{${texNum(b)}}`
    r = twoVar(lx, ly).r
  }
  const meanY = Y.reduce((a, b) => a + b, 0) / Y.length
  const residuals = X.map((x, i) => Y[i] - predict(x))
  const ssRes = residuals.reduce((a, e) => a + e * e, 0)
  const ssTot = Y.reduce((a, y) => a + (y - meanY) ** 2, 0)
  return { model, coeffs, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, r, residuals, expr, latex: `y = ${latex}`, predict }
}

/** Bins for a histogram (Sturges' rule unless a count is given). */
export function histogram(xs: number[], bins?: number): { edges: number[]; counts: number[] } {
  if (!xs.length) return { edges: [], counts: [] }
  const k = bins ?? Math.max(1, Math.ceil(Math.log2(xs.length) + 1))
  let lo = Math.min(...xs)
  let hi = Math.max(...xs)
  if (lo === hi) {
    lo -= 0.5
    hi += 0.5
  }
  const w = (hi - lo) / k
  const edges = Array.from({ length: k + 1 }, (_, i) => lo + i * w)
  const counts = new Array<number>(k).fill(0)
  for (const x of xs) counts[Math.min(k - 1, Math.floor((x - lo) / w))]++
  return { edges, counts }
}
