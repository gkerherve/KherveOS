// Complete elliptic integral K, the Jacobi functions sn, cn, dn and the exact pendulum (pure).

/** Arithmetic-geometric mean. */
export function agm(a: number, b: number): number {
  for (let i = 0; i < 40; i++) {
    const an = 0.5 * (a + b)
    const bn = Math.sqrt(a * b)
    if (Math.abs(an - bn) <= 1e-16 * an) return an
    a = an
    b = bn
  }
  return a
}

/** K(k): the complete elliptic integral of the first kind with modulus k (parameter m = k^2). */
export function ellipticK(k: number): number {
  const kk = Math.min(Math.abs(k), 1 - 1e-15)
  return Math.PI / (2 * agm(1, Math.sqrt(1 - kk * kk)))
}

/** Jacobi elliptic functions for parameter m = k^2 in [0, 1) (descending Landen / AGM, Numerical Recipes). */
export function sncndn(u: number, m: number): { sn: number; cn: number; dn: number } {
  const emmc = 1 - m
  if (emmc <= 1e-14) {
    const c = 1 / Math.cosh(u)
    return { sn: Math.tanh(u), cn: c, dn: c }
  }
  if (m === 0) return { sn: Math.sin(u), cn: Math.cos(u), dn: 1 }
  const em: number[] = []
  const en: number[] = []
  let a = 1
  let dn = 1
  let emc = emmc
  let c = 0
  let l = 0
  for (l = 0; l < 30; l++) {
    em[l] = a
    emc = Math.sqrt(emc)
    en[l] = emc
    c = 0.5 * (a + emc)
    if (Math.abs(a - emc) <= 1e-15 * a) break
    emc *= a
    a = c
  }
  if (l === 30) l = 29
  u *= c
  let sn = Math.sin(u)
  let cn = Math.cos(u)
  if (sn !== 0) {
    a = cn / sn
    c *= a
    for (let ll = l; ll >= 0; ll--) {
      const b = em[ll]
      a *= c
      c *= dn
      dn = (en[ll] + a) / (b + a)
      a = c / b
    }
    a = 1 / Math.sqrt(c * c + 1)
    sn = sn >= 0 ? a : -a
    cn = c * sn
  }
  return { sn, cn, dn }
}

/** Exact period of a simple pendulum released from rest at amplitude theta0 (radians): 4 sqrt(L/g) K(sin(theta0/2)). */
export function pendulumPeriodExact(L: number, g: number, theta0: number): number {
  const w0 = Math.sqrt(g / L)
  const k = Math.sin(Math.min(Math.abs(theta0), Math.PI - 1e-9) / 2)
  return (4 / w0) * ellipticK(k)
}

/** The power series T = T0 (1 + k^2/4 + 9 k^4/64 + 25 k^6/256 + ...), k = sin(theta0/2); `terms` terms in k^2. */
export function pendulumPeriodSeries(L: number, g: number, theta0: number, terms = 8): number {
  const T0 = 2 * Math.PI * Math.sqrt(L / g)
  const k2 = Math.sin(theta0 / 2) ** 2
  let sum = 0
  let coef = 1 // ((2n)! / (2^{2n} n!^2))^2 built up: c_n = c_{n-1} * ((2n-1)/(2n))
  let c = 1
  let pow = 1
  for (let n = 0; n < terms; n++) {
    if (n > 0) {
      c *= (2 * n - 1) / (2 * n)
      pow *= k2
    }
    coef = c * c
    sum += coef * pow
  }
  return T0 * sum
}

/** The first correction series in the amplitude itself: T0 (1 + theta0^2/16 + 11 theta0^4/3072 + 173 theta0^6/737280). */
export function pendulumPeriodAmplitudeSeries(L: number, g: number, theta0: number): number {
  const T0 = 2 * Math.PI * Math.sqrt(L / g)
  const a = theta0 * theta0
  return T0 * (1 + a / 16 + (11 * a * a) / 3072 + (173 * a * a * a) / 737280)
}

/** Exact angle of a simple pendulum released from rest at theta0 (radians), t seconds later. */
export function pendulumAngleExact(L: number, g: number, theta0: number, t: number): number {
  const w0 = Math.sqrt(g / L)
  const th = Math.max(-Math.PI + 1e-6, Math.min(Math.PI - 1e-6, theta0))
  const k = Math.sin(Math.abs(th) / 2)
  if (k < 1e-12) return th * Math.cos(w0 * t)
  const { cn, dn } = sncndn(w0 * t, k * k)
  return Math.sign(th) * 2 * Math.asin(Math.max(-1, Math.min(1, (k * cn) / dn)))
}
