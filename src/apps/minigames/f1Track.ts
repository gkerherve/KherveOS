// Kherve Grand Prix: the two circuits. A circuit is a closed centripetal
// Catmull-Rom spline through control points (x, z, height), resampled every
// ~2 m into flat arrays: centre, tangent, right-hand normal, curvature, the
// run-off to the barriers on each side, kerbs, gravel, the pit lane, a racing
// line (an elastic band pulled tight between the white lines) and the timing
// points. No three.js here: the physics and the tests use it too.

export type TrackId = 'park' | 'lake'

export interface TrackDef {
  id: TrackId
  name: string
  /** The country-side words on the cards. */
  blurb: string
  /** Control points: x, z, height (m). The start line is at point 1; the straight runs from point 0 to point 2. */
  points: [number, number, number][]
  width: number
  /** The time of day it is raced at by default (the menu can make it sunset). */
  sky: 'noon' | 'golden'
  /** The lake (Lac Bleu): an ellipse of water. */
  lake?: { x: number; z: number; rx: number; rz: number }
  /** Grandstands: where (m after the start line) and how long, on which side (+1 right of the cars, -1 left; 0 = away from the pits). */
  stands: { at: number; len: number; side: 1 | -1 | 0 }[]
  /** A footbridge over the track (m after the start line). */
  bridge: number
}

export const TRACKS: TrackDef[] = [
  {
    id: 'park',
    name: 'Kherve Park',
    blurb: 'A flowing country circuit through woods and rolling fields, wind turbines on the ridge. Fast esses, a long back straight and a tight hairpin.',
    width: 14,
    sky: 'noon',
    points: [
      [-400, 0, 0], [0, 0, 0], [400, 0, 0], [570, 18, 0.5], [628, 95, 1.5], [606, 200, 3], [520, 262, 4], [420, 290, 5],
      [335, 345, 6.5], [305, 440, 8], [362, 528, 9], [482, 560, 9.5], [620, 545, 9], [722, 602, 8], [742, 720, 6.5],
      [672, 805, 5], [548, 800, 4], [390, 728, 3], [110, 700, 1], [-150, 690, -1], [-300, 642, -1.5], [-362, 560, -1],
      [-330, 482, -0.5], [-382, 400, 0], [-472, 332, 1], [-560, 222, 1.5], [-566, 100, 1], [-505, 22, 0.4],
    ],
    stands: [
      { at: 0, len: 260, side: 0 },
      { at: 700, len: 120, side: 0 },
      { at: 1830, len: 140, side: 0 },
      { at: 2420, len: 110, side: 0 },
    ],
    bridge: 1240,
  },
  {
    id: 'lake',
    name: 'Lac Bleu',
    blurb: 'A lakeside circuit under snowy mountains at golden hour: a flat-out run along the water, a hairpin, a chicane by the marina and a climb through the village.',
    width: 13,
    sky: 'golden',
    points: [
      [-500, 0, 0], [0, 0, 0], [500, 0, 0], [642, 12, 0.3], [706, 72, 0.8], [668, 136, 1.5], [560, 140, 2.5], [420, 168, 4],
      [330, 236, 6], [318, 334, 8], [398, 402, 10], [500, 424, 11], [565, 484, 12], [545, 584, 12.5], [440, 625, 12],
      [250, 604, 10], [105, 522, 8], [0, 500, 7], [-80, 530, 6.5], [-160, 500, 6], [-300, 498, 5], [-422, 468, 4],
      [-522, 392, 3], [-566, 282, 2], [-622, 182, 1.2], [-642, 82, 0.6], [-592, 16, 0.2],
    ],
    lake: { x: 120, z: -560, rx: 1300, rz: 360 },
    stands: [
      { at: 0, len: 280, side: 0 },
      { at: 900, len: 120, side: 0 },
      { at: 2050, len: 120, side: 0 },
      { at: 3350, len: 130, side: 0 },
    ],
    bridge: 2600,
  },
]

export const trackDef = (id: string): TrackDef => TRACKS.find((t) => t.id === id) ?? TRACKS[0]

/** The pit lane: offsets are on the pit side (sign `side`), distances in metres along the centre line. */
export interface PitLane {
  side: 1 | -1
  /** Where the lane leaves the track, reaches full offset, the limiter lines, where it starts back, rejoins (s, m). */
  entry: number
  entryFull: number
  limitIn: number
  limitOut: number
  exitStart: number
  exit: number
  /** The fast lane's offset, the stopping lane's, the garage fronts'. */
  laneOff: number
  boxOff: number
  garageOff: number
  /** The pit wall (between the track and the lane): its offset and range. */
  wallOff: number
  /** Where each team's box is (s). */
  boxes: number[]
  /** 80 km/h. */
  limit: number
}

export interface Track {
  def: TrackDef
  n: number
  len: number
  ds: number
  width: number
  x: Float32Array
  z: Float32Array
  y: Float32Array
  tx: Float32Array
  tz: Float32Array
  nx: Float32Array
  nz: Float32Array
  /** Curvature (1/m), positive turning right. */
  k: Float32Array
  /** Distance from the centre line to the barrier, left (-) and right (+) side, both positive. */
  runL: Float32Array
  runR: Float32Array
  kerbL: Uint8Array
  kerbR: Uint8Array
  gravelL: Uint8Array
  gravelR: Uint8Array
  /** Racing line: offset from the centre (m, + right), its curvature, and its length per sample over ds. */
  line: Float32Array
  lineK: Float32Array
  lineScale: Float32Array
  /** The start line (s) and its sample. */
  start: number
  startIdx: number
  pit: PitLane
  /** Sector ends (s from the start line): sector 1 ends at sectors[0], sector 2 at sectors[1]. */
  sectors: [number, number]
  /** DRS zones: [from, to] in s. */
  drs: [number, number][]
  /** Spatial hash of the samples. */
  grid: Map<number, number[]>
  cell: number
  /** Bounds of the centre line. */
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

// ---------------------------------------------------------------- spline

type P3 = [number, number, number]

function crPoint(p0: P3, p1: P3, p2: P3, p3: P3, t: number): P3 {
  const d = (a: P3, b: P3) => Math.max(1e-4, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5))
  const t0 = 0
  const t1 = t0 + d(p0, p1)
  const t2 = t1 + d(p1, p2)
  const t3 = t2 + d(p2, p3)
  const u = t1 + (t2 - t1) * t
  const out: P3 = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const a1 = ((t1 - u) / (t1 - t0)) * p0[c] + ((u - t0) / (t1 - t0)) * p1[c]
    const a2 = ((t2 - u) / (t2 - t1)) * p1[c] + ((u - t1) / (t2 - t1)) * p2[c]
    const a3 = ((t3 - u) / (t3 - t2)) * p2[c] + ((u - t2) / (t3 - t2)) * p3[c]
    const b1 = ((t2 - u) / (t2 - t0)) * a1 + ((u - t0) / (t2 - t0)) * a2
    const b2 = ((t3 - u) / (t3 - t1)) * a2 + ((u - t1) / (t3 - t1)) * a3
    out[c] = ((t2 - u) / (t2 - t1)) * b1 + ((u - t1) / (t2 - t1)) * b2
  }
  return out
}

export const wrap = (s: number, len: number) => ((s % len) + len) % len
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Smooth a periodic array with a box filter of half-width w, `passes` times. */
function smoothRing(a: Float32Array, w: number, passes = 1) {
  const n = a.length
  const tmp = new Float32Array(n)
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let sum = 0
      for (let j = -w; j <= w; j++) sum += a[(i + j + n) % n]
      tmp[i] = sum / (2 * w + 1)
    }
    a.set(tmp)
  }
}

// ---------------------------------------------------------------- build

export function buildTrack(def: TrackDef): Track {
  const P = def.points.map((p) => [p[0], p[1], p[2]] as P3)
  const m = P.length
  // dense samples and their arc length
  const SUB = 120
  const dx: number[] = []
  const dz: number[] = []
  const dy: number[] = []
  const ds: number[] = [0]
  let startDense = 0
  for (let i = 0; i < m; i++) {
    if (i === 1) startDense = dx.length
    const p0 = P[(i - 1 + m) % m]
    const p1 = P[i]
    const p2 = P[(i + 1) % m]
    const p3 = P[(i + 2) % m]
    for (let j = 0; j < SUB; j++) {
      const q = crPoint(p0, p1, p2, p3, j / SUB)
      if (dx.length) {
        const l = dx.length - 1
        ds.push(ds[l] + Math.hypot(q[0] - dx[l], q[1] - dz[l]))
      }
      dx.push(q[0])
      dz.push(q[1])
      dy.push(q[2])
    }
  }
  const last = dx.length - 1
  const len = ds[last] + Math.hypot(dx[0] - dx[last], dz[0] - dz[last])
  const n = Math.round(len / 2)
  const step = len / n
  const x = new Float32Array(n)
  const z = new Float32Array(n)
  const y = new Float32Array(n)
  // resample uniformly, starting at the dense start point (s = 0 at the start line)
  const s0 = ds[startDense]
  let j = 0
  for (let i = 0; i < n; i++) {
    const target = wrap(s0 + i * step, len)
    if (target < ds[j]) j = 0
    while (j < last && ds[j + 1] < target) j++
    const a = j
    const b = j < last ? j + 1 : 0
    const segLen = (j < last ? ds[j + 1] : len) - ds[j]
    const f = segLen > 0 ? (target - ds[j]) / segLen : 0
    x[i] = dx[a] + (dx[b] - dx[a]) * f
    z[i] = dz[a] + (dz[b] - dz[a]) * f
    y[i] = dy[a] + (dy[b] - dy[a]) * f
  }
  smoothRing(y, 6, 3)

  const tx = new Float32Array(n)
  const tz = new Float32Array(n)
  const nx = new Float32Array(n)
  const nz = new Float32Array(n)
  const head = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n
    const b = (i + 1) % n
    const ex = x[b] - x[a]
    const ez = z[b] - z[a]
    const l = Math.hypot(ex, ez) || 1
    tx[i] = ex / l
    tz[i] = ez / l
    nx[i] = -tz[i]
    nz[i] = tx[i]
    head[i] = Math.atan2(tz[i], tx[i])
  }
  const k = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let dh = head[(i + 1) % n] - head[(i - 1 + n) % n]
    while (dh > Math.PI) dh -= Math.PI * 2
    while (dh < -Math.PI) dh += Math.PI * 2
    k[i] = dh / (2 * step)
  }
  smoothRing(k, 3, 2)

  const t: Track = {
    def, n, len, ds: step, width: def.width, x, z, y, tx, tz, nx, nz, k,
    runL: new Float32Array(n), runR: new Float32Array(n),
    kerbL: new Uint8Array(n), kerbR: new Uint8Array(n), gravelL: new Uint8Array(n), gravelR: new Uint8Array(n),
    line: new Float32Array(n), lineK: new Float32Array(n), lineScale: new Float32Array(n),
    start: 0, startIdx: 0,
    pit: undefined as unknown as PitLane,
    sectors: [len / 3, (2 * len) / 3],
    drs: [],
    grid: new Map(), cell: 40,
    minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity,
  }
  for (let i = 0; i < n; i++) {
    t.minX = Math.min(t.minX, x[i])
    t.maxX = Math.max(t.maxX, x[i])
    t.minZ = Math.min(t.minZ, z[i])
    t.maxZ = Math.max(t.maxZ, z[i])
    const key = cellKey(Math.floor(x[i] / t.cell), Math.floor(z[i] / t.cell))
    let b = t.grid.get(key)
    if (!b) t.grid.set(key, (b = []))
    b.push(i)
  }

  // the pit lane: on the side of the start straight away from the middle of the circuit
  let cx = 0
  let cz = 0
  for (let i = 0; i < n; i++) {
    cx += x[i] / n
    cz += z[i] / n
  }
  const side: 1 | -1 = (cx - x[0]) * nx[0] + (cz - z[0]) * nz[0] > 0 ? -1 : 1
  const hw = def.width / 2
  t.pit = {
    side,
    entry: wrap(-340, len),
    entryFull: wrap(-240, len),
    limitIn: wrap(-205, len),
    limitOut: 110,
    exitStart: 130,
    exit: 240,
    laneOff: hw + 9,
    boxOff: hw + 13,
    garageOff: hw + 16.5,
    wallOff: hw + 3.5,
    boxes: [0, 1, 2, 3, 4, 5].map((i) => wrap(-150 + i * 24, len)),
    limit: 80 / 3.6,
  }

  computeRunoff(t)
  computeLine(t)
  // the DRS zones: long, nearly straight stretches (scanned from a corner, so no run is cut in two)
  const straight = (i: number) => Math.abs(k[i % n]) < 1 / 900
  let i0 = 0
  while (i0 < n && straight(i0)) i0++
  let runFrom = -1
  for (let i = i0; i <= i0 + n; i++) {
    const st = i < i0 + n && straight(i)
    if (st && runFrom < 0) runFrom = i
    if (!st && runFrom >= 0) {
      if ((i - runFrom) * step > 420) t.drs.push([wrap(runFrom * step + 90, len), wrap(i * step - 60, len)])
      runFrom = -1
    }
  }
  return t
}

const cellKey = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096)

function computeRunoff(t: Track) {
  const { n, k, width } = t
  const hw = width / 2
  const out = (i: number, side: number) => (k[i] > 0 ? side < 0 : side > 0)
  for (const side of [-1, 1]) {
    const run = side < 0 ? t.runL : t.runR
    const kerb = side < 0 ? t.kerbL : t.kerbR
    const gravel = side < 0 ? t.gravelL : t.gravelR
    for (let i = 0; i < n; i++) {
      const ak = Math.abs(k[i])
      let r = hw + 11
      if (out(i, side)) r += 18 * Math.min(1, ak * 90)
      else if (ak > 1e-4) r = Math.min(r, 0.55 / ak)
      run[i] = r
    }
    // the inside of corners: never past the centre of the turn; smooth it out
    smoothRing(run, 10, 2)
    for (let i = 0; i < n; i++) run[i] = Math.max(hw + 4, run[i])
    // kerbs and gravel
    for (let i = 0; i < n; i++) {
      const ak = Math.abs(k[i])
      if (ak > 1 / 320) for (let j = -9; j <= 9; j++) kerb[(i + j + n) % n] = 1
      if (ak > 1 / 170 && out(i, side)) for (let j = -14; j <= 22; j++) gravel[(i + j + n) % n] = 1
    }
  }
  // keep each barrier clear of the other parts of the circuit
  for (let i = 0; i < n; i++) {
    for (const side of [-1, 1]) {
      const run = side < 0 ? t.runL : t.runR
      for (let tries = 0; tries < 12; tries++) {
        const bx = t.x[i] + t.nx[i] * side * run[i]
        const bz = t.z[i] + t.nz[i] * side * run[i]
        const q = nearestSample(t, bx, bz, i, 60)
        if (q.d >= hw + 7 || run[i] <= hw + 4) break
        run[i] = Math.max(hw + 4, run[i] - 3)
      }
    }
  }
  // the pit straight: the pit wall on its side, the main grandstand fence on the other
  const p = t.pit
  for (let i = 0; i < n; i++) {
    const s = i * t.ds
    const inPit = inRange(s, p.entry, p.exit, t.len)
    if (!inPit) continue
    const run = p.side < 0 ? t.runL : t.runR
    const other = p.side < 0 ? t.runR : t.runL
    run[i] = inRange(s, p.entryFull, p.exitStart, t.len) ? p.wallOff - 0.3 : Math.max(run[i], p.laneOff + 4)
    other[i] = Math.min(other[i], hw + 10)
    ;(p.side < 0 ? t.kerbL : t.kerbR)[i] = 0
    ;(p.side < 0 ? t.gravelL : t.gravelR)[i] = 0
  }
}

/** Is s within [a, b] going forwards round a lap of length len? */
export function inRange(s: number, a: number, b: number, len: number): boolean {
  s = wrap(s, len)
  a = wrap(a, len)
  b = wrap(b, len)
  return a <= b ? s >= a && s <= b : s >= a || s <= b
}

/** Forward distance from a to b round the lap. */
export const ahead = (a: number, b: number, len: number) => wrap(b - a, len)

function computeLine(t: Track) {
  const { n, x, z, nx, nz } = t
  const lim = t.width / 2 - 1.25
  const o = t.line
  const px = new Float32Array(n)
  const pz = new Float32Array(n)
  const update = () => {
    for (let i = 0; i < n; i++) {
      px[i] = x[i] + nx[i] * o[i]
      pz[i] = z[i] + nz[i] * o[i]
    }
  }
  const schedule = [[24, 60], [14, 80], [8, 120], [4, 160], [2, 120]]
  for (const [w, iters] of schedule) {
    for (let it = 0; it < iters; it++) {
      update()
      for (let i = 0; i < n; i++) {
        const a = (i - w + n) % n
        const b = (i + w) % n
        const mx = (px[a] + px[b]) / 2
        const mz = (pz[a] + pz[b]) / 2
        const target = (mx - x[i]) * nx[i] + (mz - z[i]) * nz[i]
        o[i] = clamp(o[i] + (target - o[i]) * 0.6, -lim, lim)
      }
    }
  }
  // the pit straight: keep off the pit-lane exit and entry a little
  smoothRing(o, 2, 2)
  update()
  const head = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const b = (i + 1) % n
    const a = (i - 1 + n) % n
    head[i] = Math.atan2(pz[b] - pz[a], px[b] - px[a])
    t.lineScale[i] = Math.hypot(px[b] - px[i], pz[b] - pz[i]) / t.ds
  }
  for (let i = 0; i < n; i++) {
    let dh = head[(i + 2) % n] - head[(i - 2 + n) % n]
    while (dh > Math.PI) dh -= Math.PI * 2
    while (dh < -Math.PI) dh += Math.PI * 2
    t.lineK[i] = dh / (4 * t.ds * Math.max(0.5, t.lineScale[i]))
  }
  smoothRing(t.lineK, 2, 2)
}

// ---------------------------------------------------------------- queries

export interface Near {
  i: number
  /** Distance along the centre line (m). */
  s: number
  /** Signed lateral offset (m, + right). */
  d: number
  /** |d|, from the sample: distance to the centre line. */
  dist: number
  /** Height of the track there. */
  y: number
}

/** The nearest centre-line point to (x, z), excluding samples within `skip` of `not` (for barrier checks). */
export function nearestSample(t: Track, px: number, pz: number, not = -1, skip = 0): { i: number; d: number } {
  const cx = Math.floor(px / t.cell)
  const cz = Math.floor(pz / t.cell)
  let best = -1
  let bd = Infinity
  for (let r = 1; r <= 4 && best < 0; r++) {
    for (let a = cx - r; a <= cx + r; a++) {
      for (let b = cz - r; b <= cz + r; b++) {
        const bucket = t.grid.get(cellKey(a, b))
        if (!bucket) continue
        for (const i of bucket) {
          if (not >= 0) {
            const di = Math.abs(i - not)
            if (Math.min(di, t.n - di) < skip) continue
          }
          const d = (t.x[i] - px) ** 2 + (t.z[i] - pz) ** 2
          if (d < bd) {
            bd = d
            best = i
          }
        }
      }
    }
  }
  if (best < 0) return { i: -1, d: Infinity }
  return { i: best, d: Math.sqrt(bd) }
}

/** Where (x, z) is on the track; `hint` is the last sample (a local search), or -1 for a full one. */
export function locate(t: Track, px: number, pz: number, hint = -1): Near {
  let best = -1
  let bd = Infinity
  if (hint >= 0) {
    for (let j = -24; j <= 24; j++) {
      const i = (hint + j + t.n) % t.n
      const d = (t.x[i] - px) ** 2 + (t.z[i] - pz) ** 2
      if (d < bd) {
        bd = d
        best = i
      }
    }
    if (bd > 70 * 70) best = -1
  }
  if (best < 0) {
    best = nearestSample(t, px, pz).i
    if (best < 0) {
      for (let i = 0; i < t.n; i++) {
        const d = (t.x[i] - px) ** 2 + (t.z[i] - pz) ** 2
        if (d < bd) {
          bd = d
          best = i
        }
      }
    }
  }
  const i = best
  const ex = px - t.x[i]
  const ez = pz - t.z[i]
  const along = ex * t.tx[i] + ez * t.tz[i]
  const d = ex * t.nx[i] + ez * t.nz[i]
  const s = wrap(i * t.ds + along, t.len)
  const f = along / t.ds
  const i2 = f >= 0 ? (i + 1) % t.n : (i - 1 + t.n) % t.n
  const y = t.y[i] + (t.y[i2] - t.y[i]) * Math.min(1, Math.abs(f))
  return { i, s, d, dist: Math.abs(d), y }
}

/** A point on the centre line at distance s, `off` metres to the right; its heading too. */
export function pointAt(t: Track, s: number, off = 0): { x: number; z: number; y: number; tx: number; tz: number; i: number; f: number } {
  s = wrap(s, t.len)
  const fi = s / t.ds
  const i = Math.floor(fi) % t.n
  const b = (i + 1) % t.n
  const f = fi - Math.floor(fi)
  const lerp = (a: Float32Array) => a[i] + (a[b] - a[i]) * f
  let txx = lerp(t.tx)
  let tzz = lerp(t.tz)
  const l = Math.hypot(txx, tzz) || 1
  txx /= l
  tzz /= l
  return { x: lerp(t.x) - tzz * off, z: lerp(t.z) + txx * off, y: lerp(t.y), tx: txx, tz: tzz, i, f }
}

/** Interpolated value of a per-sample array at s. */
export function sampleAt(t: Track, a: Float32Array, s: number): number {
  const fi = wrap(s, t.len) / t.ds
  const i = Math.floor(fi) % t.n
  const f = fi - Math.floor(fi)
  return a[i] + (a[(i + 1) % t.n] - a[i]) * f
}

/** The pit lane's fast-lane offset (signed, from the centre line) at s; 0 outside the pit zone. */
export function pitOffset(t: Track, s: number): number {
  const p = t.pit
  if (!inRange(s, p.entry, p.exit, t.len)) return 0
  let off: number
  if (inRange(s, p.entry, p.entryFull, t.len)) off = smooth(0, 1, ahead(p.entry, s, t.len) / ahead(p.entry, p.entryFull, t.len)) * p.laneOff
  else if (inRange(s, p.exitStart, p.exit, t.len)) off = (1 - smooth(0, 1, ahead(p.exitStart, s, t.len) / ahead(p.exitStart, p.exit, t.len))) * p.laneOff
  else off = p.laneOff
  return off * p.side
}

/** How far from the centre a car can go on each side at s before it hits the barrier. */
export function barrierAt(t: Track, s: number): { l: number; r: number } {
  return { l: sampleAt(t, t.runL, s), r: sampleAt(t, t.runR, s) }
}

export type Surface = 'asphalt' | 'kerb' | 'grass' | 'gravel'

export function surfaceAt(t: Track, i: number, d: number): Surface {
  const hw = t.width / 2
  const ad = Math.abs(d)
  if (ad <= hw) return 'asphalt'
  const right = d > 0
  if (ad <= hw + 1.5 && (right ? t.kerbR[i] : t.kerbL[i])) return 'kerb'
  // the pit straight: asphalt run-off
  const s = i * t.ds
  if (inRange(s, t.pit.entry, t.pit.exit, t.len) && right === t.pit.side > 0) return 'asphalt'
  if (ad <= hw + 2.5) return 'asphalt' // the strip of tarmac beyond the white line
  if (right ? t.gravelR[i] : t.gravelL[i]) return 'gravel'
  return 'grass'
}

/** The line where `s` falls among the 3 sectors (0, 1, 2). */
export function sectorOf(t: Track, s: number): number {
  const r = wrap(s - t.start, t.len)
  return r < t.sectors[0] ? 0 : r < t.sectors[1] ? 1 : 2
}
