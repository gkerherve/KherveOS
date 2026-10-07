// Building blocks of layered device schematics (fuel cells, batteries,
// membranes): shaded 3D slabs and a disk, close-packed particle beds and rows
// of lit spheres, translucent glows, active-site dots and an ion trail.
// Ported by hand from the desktop KhervePaint (scheme3d.py, with _mix and
// atom_specs from molecules.py).

import type { Spec } from '../spec'
import { pyRound } from '../spec'

/** CPK body colours (molecules.ATOM_COLORS). */
const ATOM_COLORS: Record<string, string> = {
  H: '#f4f4f4', C: '#3a3a3a', N: '#3050f8', O: '#e01f1f', F: '#77d84a', Cl: '#37c837', Br: '#a1443c', I: '#8f2fbf',
  P: '#ff8000', S: '#e6c72a', B: '#f0a0a0', Si: '#b89078', Na: '#9a54e0', K: '#7d38cc', Mg: '#63d84b', Ca: '#3dc23d',
  Fe: '#e06633', Zn: '#7d80b0', Cu: '#c86a3a', Al: '#b0b0c0', Ti: '#9aa0a6', Cs: '#57178f',
}

const rgb = (hex: string) => {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(-6)
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

/** Blend hex colour `a` toward `b` by fraction `t` (0..1). */
export function _mix(a: string, b: string, t: number): string {
  const ca = rgb(a)
  const cb = rgb(b)
  const c = ca.map((v, i) => pyRound(v + (cb[i] - v) * t))
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** A lit sphere: a circle with a "sun" gradient in the element's colour (molecules.atom_specs). */
export function atom_specs(cx: number, cy: number, r: number, element: string, label = false, color: string | null = null): Spec[] {
  const body = color || ATOM_COLORS[element] || '#c8c8c8'
  const hi = _mix(body, '#ffffff', 0.62)
  const rim = _mix(body, '#000000', 0.4)
  const stroke = _mix(body, '#000000', 0.52)
  const spec: Spec = {
    shape: 'circle', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, stroke, width: Math.max(0.8, r * 0.1),
    fill: { kind: 'sun', c1: rim, c2: hi },
  }
  if (label) spec.label = element
  return [spec]
}

// Sphere/bed palette (light grey, dark grey, blue, green, white).
const SPHERE_COLORS: Record<string, string> = { grey: '#d8dade', dark: '#565a61', blue: '#4046a8', green: '#3faf62', white: '#f4f4f4' }
// Slab palette (electrolyte / substrate blocks).
const SLAB_COLORS: Record<string, string> = { grey: '#b9bdc4', orange: '#d59a6e', blue: '#63b6e0' }

// ------------------------------------------------------------ 3D blocks

// A 3D box: front face + right-shifted top face + right side face,
// shaded lighter on top and darker on the side.
function _slab(w: number, h: number, color: string): Spec[] {
  const skew = w * 0.14 // top-face depth (x offset)
  const depth = h * 0.3 // top-face height (y drop)
  const top = _mix(color, '#ffffff', 0.35)
  const side = _mix(color, '#000000', 0.25)
  const edge = _mix(color, '#000000', 0.55)
  const fw = w - skew // front face width
  return [
    { shape: 'polygon', stroke: edge, width: 1.6, fill: top, points: [[0, depth], [skew, 0], [w, 0], [fw, depth]] },
    { shape: 'rect', x: 0, y: depth, w: fw, h: h - depth, stroke: edge, width: 1.6, fill: color },
    { shape: 'polygon', stroke: edge, width: 1.6, fill: side, points: [[fw, depth], [w, 0], [w, h - depth], [fw, h]] },
  ]
}

// A 3D disc (short cylinder seen slightly from above), like the
// electrolyte pellet in a button-cell schematic.
function build_disk_grey(w: number, h: number): Spec[] {
  const color = SLAB_COLORS.grey
  const top = _mix(color, '#ffffff', 0.35)
  const edge = _mix(color, '#000000', 0.55)
  const cap = h * 0.42 // ellipse height
  return [
    { shape: 'ellipse', x: 0, y: h - cap, w, h: cap, stroke: edge, width: 1.6, fill: color },
    { shape: 'rect', x: 0, y: cap / 2, w, h: h - cap, stroke: 'none', fill: color },
    { shape: 'line', x1: 0, y1: cap / 2, x2: 0, y2: h - cap / 2, stroke: edge, width: 1.6 },
    { shape: 'line', x1: w, y1: cap / 2, x2: w, y2: h - cap / 2, stroke: edge, width: 1.6 },
    { shape: 'ellipse', x: 0, y: 0, w, h: cap, stroke: edge, width: 1.6, fill: top },
  ]
}

// --------------------------------------------------------- particle beds

function _sphere_row(y: number, w: number, r: number, color: string, n: number, offset = 0): Spec[] {
  const specs: Spec[] = []
  for (let i = 0; i < n; i++) {
    const cx = r + offset + i * 2 * r * 0.96 // slight overlap
    if (cx + r * 0.5 > w + r) break
    specs.push(...atom_specs(cx, y, r, '', false, color))
  }
  return specs
}

// Close-packed staggered sphere rows — a porous electrode layer.
// Drawn bottom row first so upper rows overlap like a real pile.
function _bed(w: number, h: number, color: string, rows = 3): Spec[] {
  const r = h / (1 + (rows - 1) * 0.82) / 2
  const specs: Spec[] = []
  for (let k = rows - 1; k > -1; k--) {
    // back/bottom rows first
    const y = h - r - k * 2 * r * 0.82
    specs.push(..._sphere_row(y, w, r, color, Math.trunc(w / (2 * r * 0.96)) + 1, k % 2 ? r * 0.96 : 0))
  }
  return specs
}

function _row(w: number, h: number, color: string): Spec[] {
  const r = h / 2
  return _sphere_row(r, w, r, color, Math.trunc(w / (2 * r * 0.96)) + 1)
}

// ------------------------------------------------------ reaction details

// A soft reaction hot-spot: concentric translucent circles.
function _glow(w: number, h: number, color: string): Spec[] {
  const cx = w / 2
  const cy = h / 2
  const specs: Spec[] = []
  for (const [frac, op] of [[1, 0.22], [0.72, 0.42], [0.45, 0.85]]) {
    const r = (Math.min(w, h) / 2) * frac
    specs.push({ shape: 'circle', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, stroke: 'none', fill: color, opacity: op })
  }
  return specs
}

// A pinch of small gold dots marking a catalytic active site.
function build_active_site(w: number, h: number): Spec[] {
  const dots = [[0.1, 0.55], [0.28, 0.3], [0.46, 0.62], [0.62, 0.25], [0.78, 0.55], [0.92, 0.35]]
  const r = Math.min(w, h) * 0.16
  return dots.map(([fx, fy]) => ({ shape: 'circle', x: fx * w - r, y: fy * h - r, w: 2 * r, h: 2 * r, stroke: '#a67c00', width: 0.8, fill: '#f2c230' }))
}

// A dotted ion-conduction trail (vertical, gently wiggling).
function build_proton_trail(w: number, h: number): Spec[] {
  const n = Math.max(Math.trunc(h / (w * 0.55)), 6)
  const r = w * 0.22
  const specs: Spec[] = []
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(n - 1, 1)
    const fx = 0.5 + 0.3 * (i % 2 ? 1 : -1) * (0.4 + 0.6 * (1 - t))
    const cx = fx * w
    const cy = h - t * h
    specs.push({ shape: 'circle', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, stroke: 'none', fill: '#f2a0c0' })
  }
  return specs
}

// --------------------------------------------------------------- registry

export const BUILDERS: Record<string, (w: number, h: number) => Spec[]> = {
  slab_grey: (w, h) => _slab(w, h, SLAB_COLORS.grey),
  slab_orange: (w, h) => _slab(w, h, SLAB_COLORS.orange),
  slab_blue: (w, h) => _slab(w, h, SLAB_COLORS.blue),
  disk_grey: build_disk_grey,
  glow_blue: (w, h) => _glow(w, h, '#3aa5f0'),
  glow_orange: (w, h) => _glow(w, h, '#f08a1d'),
  glow_yellow: (w, h) => _glow(w, h, '#f4c81f'),
  active_site: build_active_site,
  proton_trail: build_proton_trail,
}

export const REFERENCE_MM = 130
export const SIZES: Record<string, [number, number]> = {
  slab_grey: [100, 30], slab_orange: [100, 30], slab_blue: [100, 30], disk_grey: [100, 26],
  glow_blue: [16, 16], glow_orange: [16, 16], glow_yellow: [16, 16], active_site: [14, 8], proton_trail: [8, 36],
}

const COLOR_LABELS: Record<string, string> = { grey: 'grey', dark: 'dark grey', blue: 'blue', green: 'green', white: 'white' }

export const LABELS: Record<string, string> = {
  slab_grey: 'Slab — grey', slab_orange: 'Slab — orange', slab_blue: 'Slab — blue', disk_grey: 'Disk (3D)',
  glow_blue: 'Glow — blue', glow_orange: 'Glow — orange', glow_yellow: 'Glow — yellow', active_site: 'Active-site dots',
  proton_trail: 'Ion trail (dotted)',
}

for (const key of Object.keys(SPHERE_COLORS)) {
  BUILDERS[`bed_${key}`] = (w, h) => _bed(w, h, SPHERE_COLORS[key])
  BUILDERS[`row_${key}`] = (w, h) => _row(w, h, SPHERE_COLORS[key])
  BUILDERS[`sphere_${key}`] = (w, h) => atom_specs(w / 2, h / 2, Math.min(w, h) / 2, '', false, SPHERE_COLORS[key])
  SIZES[`bed_${key}`] = [96, 26]
  SIZES[`row_${key}`] = [96, 10]
  SIZES[`sphere_${key}`] = [12, 12]
}
for (const [key, lab] of Object.entries(COLOR_LABELS)) {
  LABELS[`bed_${key}`] = `Particle bed — ${lab}`
  LABELS[`row_${key}`] = `Particle row — ${lab}`
  LABELS[`sphere_${key}`] = `Sphere — ${lab}`
}

const keys = Object.keys(SPHERE_COLORS)
export const CATEGORIES: [string, string[]][] = [
  ['3D blocks', ['slab_grey', 'slab_orange', 'slab_blue', 'disk_grey']],
  ['Particle beds', [...keys.map((k) => `bed_${k}`), ...keys.map((k) => `row_${k}`)]],
  ['Spheres', keys.map((k) => `sphere_${k}`)],
  ['Reaction details', ['glow_blue', 'glow_orange', 'glow_yellow', 'active_site', 'proton_trail']],
]
