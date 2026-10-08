// The desktop 3D view's camera and readouts (view3d.py, viewnav.py,
// scalebar.py, units.py), as pure functions: the orbit camera (yaw, pitch,
// distance, target; focal length 1.2 × the shorter side), the mouse
// mapping, and the scale bar's round length and label.

export type Vec3 = [number, number, number]

/** Camera basis (right, up, forward) from yaw / pitch in degrees. */
export function orientation(yawDeg: number, pitchDeg: number): { right: Vec3; up: Vec3; forward: Vec3 } {
  const yaw = (yawDeg * Math.PI) / 180
  const pitch = (pitchDeg * Math.PI) / 180
  const f: Vec3 = [-Math.cos(pitch) * Math.cos(yaw), -Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch)]
  const r: Vec3 = [-Math.sin(yaw), Math.cos(yaw), 0]
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]
  return { right: r, up: u, forward: f }
}

export function focal(width: number, height: number): number {
  return 1.2 * Math.min(width, height)
}

/** The eye position for a camera. */
export function eyeOf(yaw: number, pitch: number, distance: number, target: number[]): Vec3 {
  const { forward } = orientation(yaw, pitch)
  return [target[0] - forward[0] * distance, target[1] - forward[1] * distance, target[2] - forward[2] * distance]
}

/** Vertical field of view (degrees) giving the desktop's focal length. */
export function fovFor(width: number, height: number): number {
  const f = focal(width, height)
  return (2 * Math.atan(height / 2 / f) * 180) / Math.PI
}

export const MIN_DISTANCE = 2.0
export const MAX_DISTANCE = 1.0e6

/** Left drag: half a degree a pixel; the pitch wraps over the poles. */
export function orbit(yaw: number, pitch: number, dx: number, dy: number): [number, number] {
  const y = (((yaw - dx * 0.5) % 360) + 360) % 360
  const p = ((((pitch + dy * 0.5 + 180) % 360) + 360) % 360) - 180
  return [y, p]
}

/** Right / middle drag: slide the target in the view plane. */
export function pan(yaw: number, pitch: number, distance: number, target: number[], dx: number, dy: number): number[] {
  const { right, up } = orientation(yaw, pitch)
  const s = distance / 600
  return [0, 1, 2].map((i) => target[i] - right[i] * dx * s + up[i] * dy * s)
}

/** Wheel: 0.87 in, 1.15 out, within the desktop's range. */
export function zoom(distance: number, deltaY: number): number {
  const factor = deltaY < 0 ? 0.87 : 1.15
  return Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, distance * factor))
}

// ---------------------------------------------------------------- scale bar

const READABLE: [string, number][] = [['nm', 1e-6], ['µm', 1e-3], ['mm', 1], ['m', 1e3], ['km', 1e6]]
const TABLE: Record<string, [string, number]> = {
  nm: ['nm', 1e-6], um: ['µm', 1e-3], mm: ['mm', 1], cm: ['cm', 10], m: ['m', 1000], in: ['in', 25.4],
}

/** The shortest 1, 2 or 5 × 10^k units whose bar is 60–170 px long. */
export function niceLength(ppu: number, lo = 60, hi = 170): number | null {
  if (!(ppu > 0) || !Number.isFinite(ppu)) return null
  const k = Math.floor(Math.log10(lo / ppu))
  for (let exp = k - 1; exp < k + 3; exp++)
    for (const m of [1, 2, 5]) {
      const length = Number((m * 10 ** exp).toPrecision(12))
      if (lo <= length * ppu && length * ppu <= hi) return length
    }
  return null
}

export function tidy(value: number, digits = 2): string {
  if (value && Math.abs(value) < 0.5 * 10 ** -digits) return Number(value.toPrecision(3)).toString()
  const text = value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')
  return text === '' || text === '-0' ? '0' : text
}

export function grouped(value: number, digits = 2): string {
  let text = Number.isInteger(value) && Math.abs(value) < 1e15 ? String(Math.round(value)) : tidy(value, digits)
  const neg = text.startsWith('-')
  if (neg) text = text.slice(1)
  const [whole, frac] = text.split('.')
  const w = whole.length > 4 && /^\d+$/.test(whole) ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : whole
  return (neg ? '-' : '') + w + (frac ? `.${frac}` : '')
}

/** A length in the largest metric unit that keeps it ≥ 1 (units.readable). */
export function readable(value: number, unit: string): [number, string] {
  const [sym, base] = TABLE[unit] ?? TABLE.mm
  if (unit === 'in') return [value, sym]
  const mm = value * base
  let best: [number, string] = [value, sym]
  for (const [s, size] of READABLE) if (size >= base && Math.abs(mm) / size >= 1 - 1e-9) best = [mm / size, s]
  return best
}

/** [label, pixels] of the 3D scale bar, or null. */
export function scaleBar(ppu: number, unit: string, realScale = 1): [string, number] | null {
  const scale = realScale > 0 ? realScale : 1
  const length = niceLength(ppu / scale)
  if (!length) return null
  const [v, sym] = readable(length, unit)
  return [`${grouped(v, 9)} ${sym}`, (length * ppu) / scale]
}

/** The 2D view's bar: 1, 2, 5 × 10^k between 60 and 170 px (view2d.py). */
export function sketchBar(ppm: number): number | null {
  for (let k = -3; k < 6; k++)
    for (const m of [1, 2, 5]) {
      const length = m * 10 ** k
      if (60 <= length * ppm && length * ppm <= 170) return Number(length.toPrecision(12))
    }
  return null
}

/** The light the faces are shaded from (View3D.light_vector). */
export function lightVector(turn: number, height: number): Vec3 {
  const az = Math.atan2(-0.5, 0.35) + turn * Math.PI
  const base = Math.atan2(0.75, Math.hypot(0.35, -0.5))
  const el = base + height * (height > 0 ? (85 * Math.PI) / 180 - base : base - (5 * Math.PI) / 180)
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]
}
