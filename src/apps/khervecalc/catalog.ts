// Every function KherveCalc offers, for the Catalog, completion and help.
// Pure data: tools/tests checks each name exists in the Python engine.

export interface CatalogEntry {
  name: string
  /** How to call it. */
  sig: string
  desc: string
  cat: CatalogCategory
}

export type CatalogCategory =
  | 'Arithmetic'
  | 'Trigonometry'
  | 'Exponential & log'
  | 'Complex'
  | 'Special functions'
  | 'Number theory'
  | 'Algebra'
  | 'Calculus'
  | 'Equations'
  | 'Linear algebra'
  | 'Statistics'
  | 'Distributions'
  | 'Units & constants'
  | 'Bitwise'

const e = (cat: CatalogCategory, list: [string, string, string][]): CatalogEntry[] => list.map(([name, sig, desc]) => ({ name, sig, desc, cat }))

export const CATALOG: CatalogEntry[] = [
  ...e('Arithmetic', [
    ['sqrt', 'sqrt(x)', 'Square root (√)'],
    ['cbrt', 'cbrt(x)', 'Real cube root'],
    ['root', 'root(x, n)', 'n-th root (real for odd n)'],
    ['abs', 'abs(x)', 'Absolute value, modulus'],
    ['sign', 'sign(x)', 'Sign: −1, 0 or 1'],
    ['floor', 'floor(x)', 'Largest integer ≤ x'],
    ['ceil', 'ceil(x)', 'Smallest integer ≥ x'],
    ['round', 'round(x, n)', 'Round to n decimals (half away from zero)'],
    ['trunc', 'trunc(x)', 'Integer part (towards zero)'],
    ['frac', 'frac(x)', 'Fractional part'],
    ['mod', 'mod(a, b)', 'Remainder of a ÷ b'],
    ['max', 'max(a, b, …)', 'Largest value (or of a list)'],
    ['min', 'min(a, b, …)', 'Smallest value (or of a list)'],
    ['approx', 'approx(x, n)', 'Decimal value with n digits'],
    ['exact', 'exact(x)', 'Exact form of a decimal (π, √2, fractions…)'],
    ['tofrac', 'tofrac(x, maxden)', 'Closest fraction'],
  ]),
  ...e('Trigonometry', [
    ['sin', 'sin(x)', 'Sine (in the angle unit)'],
    ['cos', 'cos(x)', 'Cosine'],
    ['tan', 'tan(x)', 'Tangent'],
    ['sec', 'sec(x)', 'Secant'],
    ['csc', 'csc(x)', 'Cosecant'],
    ['cot', 'cot(x)', 'Cotangent'],
    ['asin', 'asin(x)', 'Inverse sine'],
    ['acos', 'acos(x)', 'Inverse cosine'],
    ['atan', 'atan(x)', 'Inverse tangent'],
    ['atan2', 'atan2(y, x)', 'Angle of the point (x, y)'],
    ['sinh', 'sinh(x)', 'Hyperbolic sine'],
    ['cosh', 'cosh(x)', 'Hyperbolic cosine'],
    ['tanh', 'tanh(x)', 'Hyperbolic tangent'],
    ['asinh', 'asinh(x)', 'Inverse hyperbolic sine'],
    ['acosh', 'acosh(x)', 'Inverse hyperbolic cosine'],
    ['atanh', 'atanh(x)', 'Inverse hyperbolic tangent'],
    ['sinc', 'sinc(x)', 'sin(x)/x'],
  ]),
  ...e('Exponential & log', [
    ['exp', 'exp(x)', 'e to the power x'],
    ['ln', 'ln(x)', 'Natural logarithm'],
    ['log', 'log(x, b)', 'Logarithm: base 10, or base b'],
    ['log2', 'log2(x)', 'Base-2 logarithm'],
    ['lambertw', 'lambertw(x, k)', 'Lambert W (branch k)'],
  ]),
  ...e('Complex', [
    ['re', 're(z)', 'Real part'],
    ['im', 'im(z)', 'Imaginary part'],
    ['arg', 'arg(z)', 'Argument (in the angle unit)'],
    ['conj', 'conj(z)', 'Complex conjugate'],
    ['polar', 'polar(r, θ)', 'r∠θ: the number with modulus r and argument θ'],
    ['cis', 'cis(θ)', 'cos θ + i sin θ'],
  ]),
  ...e('Special functions', [
    ['gamma', 'gamma(x)', 'Gamma function Γ'],
    ['lgamma', 'lgamma(x)', 'log Γ(x)'],
    ['digamma', 'digamma(x)', 'ψ(x) = Γ′/Γ'],
    ['polygamma', 'polygamma(n, x)', 'n-th derivative of ψ'],
    ['beta', 'beta(a, b)', 'Beta function B'],
    ['lowergamma', 'lowergamma(s, x)', 'Lower incomplete gamma γ'],
    ['uppergamma', 'uppergamma(s, x)', 'Upper incomplete gamma Γ'],
    ['erf', 'erf(x)', 'Error function'],
    ['erfc', 'erfc(x)', 'Complementary error function'],
    ['erfinv', 'erfinv(x)', 'Inverse error function'],
    ['besselj', 'besselj(n, x)', 'Bessel function Jₙ'],
    ['bessely', 'bessely(n, x)', 'Bessel function Yₙ'],
    ['besseli', 'besseli(n, x)', 'Modified Bessel Iₙ'],
    ['besselk', 'besselk(n, x)', 'Modified Bessel Kₙ'],
    ['jn', 'jn(n, x)', 'Spherical Bessel jₙ'],
    ['yn', 'yn(n, x)', 'Spherical Bessel yₙ'],
    ['airyai', 'airyai(x)', 'Airy Ai'],
    ['airybi', 'airybi(x)', 'Airy Bi'],
    ['zeta', 'zeta(s)', 'Riemann ζ'],
    ['polylog', 'polylog(s, z)', 'Polylogarithm Liₛ'],
    ['legendre', 'legendre(n, x)', 'Legendre polynomial Pₙ'],
    ['assoc_legendre', 'assoc_legendre(n, m, x)', 'Associated Legendre Pₙᵐ'],
    ['hermite', 'hermite(n, x)', 'Hermite polynomial Hₙ'],
    ['laguerre', 'laguerre(n, x)', 'Laguerre polynomial Lₙ'],
    ['chebyshevt', 'chebyshevt(n, x)', 'Chebyshev Tₙ'],
    ['chebyshevu', 'chebyshevu(n, x)', 'Chebyshev Uₙ'],
    ['Ynm', 'Ynm(n, m, θ, φ)', 'Spherical harmonic'],
    ['Ei', 'Ei(x)', 'Exponential integral'],
    ['Si', 'Si(x)', 'Sine integral'],
    ['Ci', 'Ci(x)', 'Cosine integral'],
    ['li', 'li(x)', 'Logarithmic integral'],
    ['fresnels', 'fresnels(x)', 'Fresnel S'],
    ['fresnelc', 'fresnelc(x)', 'Fresnel C'],
    ['ellipk', 'ellipk(m)', 'Complete elliptic integral K'],
    ['ellipe', 'ellipe(m)', 'Complete elliptic integral E'],
    ['hyper', 'hyper([a…], [b…], z)', 'Generalised hypergeometric pFq'],
    ['heaviside', 'heaviside(x)', 'Heaviside step'],
  ]),
  ...e('Number theory', [
    ['factorial', 'factorial(n)', 'n! (also written n!)'],
    ['nCr', 'nCr(n, k)', 'Combinations (binomial coefficient)'],
    ['nPr', 'nPr(n, k)', 'Permutations'],
    ['gcd', 'gcd(a, b, …)', 'Greatest common divisor'],
    ['lcm', 'lcm(a, b, …)', 'Least common multiple'],
    ['isprime', 'isprime(n)', 'Is n prime?'],
    ['nextprime', 'nextprime(n)', 'Next prime after n'],
    ['prevprime', 'prevprime(n)', 'Prime before n'],
    ['prime', 'prime(k)', 'The k-th prime'],
    ['primepi', 'primepi(n)', 'Number of primes ≤ n'],
    ['factor', 'factor(n)', 'Prime factorisation (or factor a polynomial)'],
    ['divisors', 'divisors(n)', 'All divisors'],
    ['totient', 'totient(n)', 'Euler φ'],
    ['powmod', 'powmod(a, b, m)', 'a^b mod m'],
    ['invmod', 'invmod(a, m)', 'Inverse of a modulo m'],
    ['fibonacci', 'fibonacci(n)', 'Fibonacci number'],
    ['bernoulli', 'bernoulli(n)', 'Bernoulli number'],
    ['digits', 'digits(n, b)', 'Digits of n in base b'],
  ]),
  ...e('Algebra', [
    ['simplify', 'simplify(e)', 'Simplify'],
    ['expand', 'expand(e)', 'Expand products and powers'],
    ['factor', 'factor(e)', 'Factor'],
    ['apart', 'apart(e, x)', 'Partial fractions'],
    ['together', 'together(e)', 'One fraction'],
    ['cancel', 'cancel(e)', 'Cancel common factors'],
    ['collect', 'collect(e, x)', 'Collect powers of x'],
    ['trigsimp', 'trigsimp(e)', 'Simplify trigonometry'],
    ['expand_trig', 'expand_trig(e)', 'Expand sin(a+b)…'],
    ['subs', 'subs(e, x = 2)', 'Substitute values'],
    ['numer', 'numer(e)', 'Numerator'],
    ['denom', 'denom(e)', 'Denominator'],
    ['coeffs', 'coeffs(p, x)', 'Polynomial coefficients'],
    ['degree', 'degree(p, x)', 'Polynomial degree'],
  ]),
  ...e('Calculus', [
    ['diff', 'diff(f, x, n)', 'n-th derivative (diff(f, x, 1, a) at x = a)'],
    ['nderiv', 'nderiv(f, x, a)', 'Numeric derivative at a'],
    ['integrate', 'integrate(f, x, a, b)', 'Integral (indefinite without a, b)'],
    ['nint', 'nint(f, x, a, b)', 'Numeric integral (any precision)'],
    ['limit', 'limit(f, x, a, "+")', 'Limit (one-sided with "+" or "-")'],
    ['series', 'series(f, x, a, n)', 'Series with O(…)'],
    ['taylor', 'taylor(f, x, a, n)', 'Taylor polynomial'],
    ['sum', 'sum(f, k, a, b)', 'Sum Σ (sum(list) adds a list)'],
    ['product', 'product(f, k, a, b)', 'Product Π'],
    ['dsolve', "dsolve(y'' + y = 0, y(0) = 1)", 'Solve an ODE exactly'],
    ['odesolve', 'odesolve(f, t, y, t0, y0, t1)', "Numeric ODE y' = f(t, y): y(t1)"],
  ]),
  ...e('Equations', [
    ['solve', 'solve(eq, x)', 'Solve equations (lists for systems)'],
    ['nsolve', 'nsolve(eq, x, x0)', 'Numeric root from a start value'],
    ['roots', 'roots(p, x)', 'All roots of a polynomial'],
    ['proots', 'proots([1, 0, -2])', 'Roots from coefficients'],
  ]),
  ...e('Linear algebra', [
    ['det', 'det(A)', 'Determinant'],
    ['inv', 'inv(A)', 'Inverse (also A^-1)'],
    ['transpose', 'transpose(A)', 'Transpose'],
    ['rank', 'rank(A)', 'Rank'],
    ['rref', 'rref(A)', 'Reduced row echelon form'],
    ['trace', 'trace(A)', 'Trace'],
    ['eigenvals', 'eigenvals(A)', 'Eigenvalues'],
    ['eig', 'eig(A)', 'Eigenvalues and eigenvectors'],
    ['lu', 'lu(A)', 'LU decomposition (P, L, U)'],
    ['qr', 'qr(A)', 'QR decomposition'],
    ['svd', 'svd(A)', 'Singular value decomposition'],
    ['cholesky', 'cholesky(A)', 'Cholesky factor'],
    ['linsolve', 'linsolve(A, b)', 'Solve A·x = b'],
    ['lstsq', 'lstsq(A, b)', 'Least-squares solution'],
    ['norm', 'norm(A, p)', 'Norm (2, 1, oo, "fro")'],
    ['cond', 'cond(A)', 'Condition number'],
    ['cross', 'cross(u, v)', 'Cross product'],
    ['dot', 'dot(u, v)', 'Dot product'],
    ['nullspace', 'nullspace(A)', 'Basis of the null space'],
    ['charpoly', 'charpoly(A)', 'Characteristic polynomial'],
    ['expm', 'expm(A)', 'Matrix exponential'],
    ['adj', 'adj(A)', 'Adjugate'],
    ['eye', 'eye(n)', 'Identity matrix'],
    ['zeros', 'zeros(m, n)', 'Zero matrix'],
    ['ones', 'ones(m, n)', 'Matrix of ones'],
    ['diag', 'diag(a, b, …)', 'Diagonal matrix'],
  ]),
  ...e('Statistics', [
    ['mean', 'mean(list)', 'Mean'],
    ['median', 'median(list)', 'Median'],
    ['mode', 'mode(list)', 'Most frequent values'],
    ['var', 'var(list)', 'Sample variance'],
    ['stdev', 'stdev(list)', 'Sample standard deviation'],
    ['pstdev', 'pstdev(list)', 'Population standard deviation'],
    ['quantile', 'quantile(list, q)', 'Quantile'],
    ['cov', 'cov(x, y)', 'Sample covariance'],
    ['corr', 'corr(x, y)', 'Correlation coefficient'],
  ]),
  ...e('Distributions', [
    ['normpdf', 'normpdf(x, μ, σ)', 'Normal density'],
    ['normcdf', 'normcdf(x, μ, σ)', 'Normal P(X ≤ x)'],
    ['invnorm', 'invnorm(p, μ, σ)', 'Normal quantile'],
    ['tpdf', 'tpdf(x, ν)', 'Student t density'],
    ['tcdf', 'tcdf(x, ν)', 'Student t P(T ≤ x)'],
    ['invt', 'invt(p, ν)', 'Student t quantile'],
    ['chi2pdf', 'chi2pdf(x, k)', 'χ² density'],
    ['chi2cdf', 'chi2cdf(x, k)', 'χ² P(X ≤ x)'],
    ['invchi2', 'invchi2(p, k)', 'χ² quantile'],
    ['fpdf', 'fpdf(x, d1, d2)', 'F density'],
    ['fcdf', 'fcdf(x, d1, d2)', 'F P(X ≤ x)'],
    ['invf', 'invf(p, d1, d2)', 'F quantile'],
    ['binompdf', 'binompdf(k, n, p)', 'Binomial P(X = k)'],
    ['binomcdf', 'binomcdf(k, n, p)', 'Binomial P(X ≤ k)'],
    ['poisspdf', 'poisspdf(k, λ)', 'Poisson P(X = k)'],
    ['poisscdf', 'poisscdf(k, λ)', 'Poisson P(X ≤ k)'],
    ['geompdf', 'geompdf(k, p)', 'Geometric P(X = k)'],
    ['exppdf', 'exppdf(x, λ)', 'Exponential density'],
    ['expcdf', 'expcdf(x, λ)', 'Exponential P(X ≤ x)'],
  ]),
  ...e('Units & constants', [
    ['convert', 'convert(e, _unit)', 'Convert (or write e ▶ _km/_h)'],
    ['const', 'const("electron mass")', 'Any CODATA constant by name (or #me)'],
  ]),
  ...e('Bitwise', [
    ['band', 'band(a, b)', 'Bitwise AND'],
    ['bor', 'bor(a, b)', 'Bitwise OR'],
    ['bxor', 'bxor(a, b)', 'Bitwise XOR'],
    ['bnot', 'bnot(a, bits)', 'Bitwise NOT in a word'],
    ['shl', 'shl(a, n)', 'Shift left'],
    ['shr', 'shr(a, n)', 'Shift right'],
  ]),
]

export const CATEGORIES: CatalogCategory[] = [...new Set(CATALOG.map((c) => c.cat))]

/** Catalog entries starting with a prefix (completion), best first. */
export function complete(prefix: string, limit = 8): CatalogEntry[] {
  if (!prefix) return []
  const p = prefix.toLowerCase()
  const seen = new Set<string>()
  const starts = CATALOG.filter((c) => c.name.toLowerCase().startsWith(p))
  const out: CatalogEntry[] = []
  for (const c of starts.sort((a, b) => a.name.length - b.name.length)) {
    if (seen.has(c.name)) continue
    seen.add(c.name)
    out.push(c)
    if (out.length >= limit) break
  }
  return out
}

/** The identifier being typed just before the cursor (for completion). */
export function wordBefore(text: string, cursor: number): { word: string; start: number } {
  let s = cursor
  while (s > 0 && /[A-Za-z0-9_]/.test(text[s - 1])) s--
  const word = text.slice(s, cursor)
  if (!/^[A-Za-z]/.test(word)) return { word: '', start: cursor }
  // not a unit (_m) or a constant (#c)
  if (s > 0 && (text[s - 1] === '_' || text[s - 1] === '#')) return { word: '', start: cursor }
  return { word, start: s }
}
