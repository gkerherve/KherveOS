// The section library: cross-section properties for bars and beams, computed from the dimensions (SI: m, m², m⁴, m³).
// A is the area, I the second moment of area about the bending axis, Z = I / c the elastic section modulus and h the
// depth (distance of the extreme fibres: used for the thermal gradient and the stress).
// Standard rolled sizes (IPE, HEA, HEB, UPN, equal angles) carry the catalogue A and I, which include the fillets.

export type SectionShape = 'rect' | 'circle' | 'tube' | 'ibeam' | 'channel' | 'angle' | 'tee' | 'custom'

export interface Section {
  id: string
  name: string
  shape: SectionShape
  /** the dimensions in m (rect: b, h; circle: d; tube: D, t; ibeam/channel: h, b, tw, tf; angle: a, b, t; tee: b, h, tw, tf) */
  params: Record<string, number>
  A: number
  I: number
  Z: number
  h: number
}

export const SHAPE_PARAMS: Record<SectionShape, string[]> = {
  rect: ['b', 'h'], circle: ['d'], tube: ['D', 't'], ibeam: ['h', 'b', 'tw', 'tf'], channel: ['h', 'b', 'tw', 'tf'], angle: ['a', 'b', 't'], tee: ['b', 'h', 'tw', 'tf'], custom: [],
}

export const SHAPE_NAMES: Record<SectionShape, string> = {
  rect: 'Rectangle', circle: 'Circle', tube: 'Tube', ibeam: 'I / H beam', channel: 'Channel', angle: 'Angle', tee: 'T', custom: 'Custom (A, I, Z)',
}

export const PARAM_NAMES: Record<string, string> = {
  b: 'width b', h: 'depth h', d: 'diameter d', D: 'outer diameter D', t: 'wall t', tw: 'web tw', tf: 'flange tf', a: 'leg a',
}

export interface SectionProps { A: number; I: number; Z: number; h: number }

/** Properties of a shape from its dimensions (m). Throws a readable error for impossible dimensions. */
export function sectionProps(shape: SectionShape, p: Record<string, number>): SectionProps {
  const need = (...keys: string[]) => {
    for (const k of keys) if (!(p[k] > 0)) throw new Error(`The section needs a positive ${PARAM_NAMES[k] ?? k}.`)
  }
  switch (shape) {
    case 'rect': {
      need('b', 'h')
      return { A: p.b * p.h, I: (p.b * p.h ** 3) / 12, Z: (p.b * p.h ** 2) / 6, h: p.h }
    }
    case 'circle': {
      need('d')
      return { A: (Math.PI * p.d ** 2) / 4, I: (Math.PI * p.d ** 4) / 64, Z: (Math.PI * p.d ** 3) / 32, h: p.d }
    }
    case 'tube': {
      need('D', 't')
      const d = p.D - 2 * p.t
      if (d < 0) throw new Error('The wall of the tube is thicker than its radius.')
      const I = (Math.PI * (p.D ** 4 - d ** 4)) / 64
      return { A: (Math.PI * (p.D ** 2 - d ** 2)) / 4, I, Z: (2 * I) / p.D, h: p.D }
    }
    case 'ibeam': case 'channel': {
      need('h', 'b', 'tw', 'tf')
      const hw = p.h - 2 * p.tf
      if (hw <= 0 || p.tw >= p.b) throw new Error('The flanges and web do not fit in the section.')
      const I = (p.b * p.h ** 3 - (p.b - p.tw) * hw ** 3) / 12
      return { A: 2 * p.b * p.tf + hw * p.tw, I, Z: (2 * I) / p.h, h: p.h }
    }
    case 'tee': {
      need('b', 'h', 'tw', 'tf')
      const hw = p.h - p.tf
      if (hw <= 0) throw new Error('The flange is deeper than the section.')
      const a1 = p.b * p.tf
      const a2 = p.tw * hw
      const A = a1 + a2
      const yc = (a1 * (p.tf / 2) + a2 * (p.tf + hw / 2)) / A // from the top
      const I = (p.b * p.tf ** 3) / 12 + a1 * (yc - p.tf / 2) ** 2 + (p.tw * hw ** 3) / 12 + a2 * (p.tf + hw / 2 - yc) ** 2
      return { A, I, Z: I / Math.max(yc, p.h - yc), h: p.h }
    }
    case 'angle': {
      need('a', 'b', 't')
      if (p.t >= p.a || p.t >= p.b) throw new Error('The thickness of the angle is larger than its legs.')
      // leg a vertical (depth), leg b horizontal; bending about the horizontal centroidal axis
      const a1 = p.t * p.a
      const a2 = (p.b - p.t) * p.t
      const A = a1 + a2
      const yc = (a1 * (p.a / 2) + a2 * (p.t / 2)) / A // from the bottom
      const I = (p.t * p.a ** 3) / 12 + a1 * (p.a / 2 - yc) ** 2 + ((p.b - p.t) * p.t ** 3) / 12 + a2 * (p.t / 2 - yc) ** 2
      return { A, I, Z: I / Math.max(yc, p.a - yc), h: p.a }
    }
    default: {
      need('A', 'I')
      const h = p.h > 0 ? p.h : Math.sqrt(12 * (p.I / p.A))
      return { A: p.A, I: p.I, Z: p.Z > 0 ? p.Z : (2 * p.I) / h, h }
    }
  }
}

/** Makes a section from a shape and dimensions in metres. */
export function makeSection(id: string, name: string, shape: SectionShape, params: Record<string, number>): Section {
  const pr = sectionProps(shape, params)
  return { id, name, shape, params: { ...params }, ...pr }
}

/** A section given by its properties alone (A in m², I in m⁴; Z and h optional). */
export function customSection(id: string, name: string, A: number, I: number, Z?: number, h?: number): Section {
  const pr = sectionProps('custom', { A, I, Z: Z ?? 0, h: h ?? 0 })
  return { id, name, shape: 'custom', params: { A, I, Z: pr.Z, h: pr.h }, ...pr }
}

const mm = 1e-3
const cm2 = 1e-4
const cm4 = 1e-8

interface Catalogue { name: string; shape: SectionShape; dims: number[]; A: number; I: number }

// h, b, tw, tf (mm), catalogue A (cm²) and Iy (cm⁴)
const IPE: Array<[string, number, number, number, number, number, number]> = [
  ['IPE 100', 100, 55, 4.1, 5.7, 10.3, 171], ['IPE 160', 160, 82, 5, 7.4, 20.1, 869], ['IPE 200', 200, 100, 5.6, 8.5, 28.5, 1943],
  ['IPE 240', 240, 120, 6.2, 9.8, 39.1, 3892], ['IPE 300', 300, 150, 7.1, 10.7, 53.8, 8356], ['IPE 400', 400, 180, 8.6, 13.5, 84.5, 23130],
]
const HEA: Array<[string, number, number, number, number, number, number]> = [
  ['HEA 100', 96, 100, 5, 8, 21.2, 349], ['HEA 160', 152, 160, 6, 9, 38.8, 1673], ['HEA 200', 190, 200, 6.5, 10, 53.8, 3692],
  ['HEA 240', 230, 240, 7.5, 12, 76.8, 7763], ['HEA 300', 290, 300, 8.5, 14, 112.5, 18260],
]
const HEB: Array<[string, number, number, number, number, number, number]> = [
  ['HEB 100', 100, 100, 6, 10, 26.0, 450], ['HEB 160', 160, 160, 8, 13, 54.3, 2492], ['HEB 200', 200, 200, 9, 15, 78.1, 5696],
  ['HEB 300', 300, 300, 11, 19, 149.1, 25170],
]
const UPN: Array<[string, number, number, number, number, number, number]> = [
  ['UPN 100', 100, 50, 6, 8.5, 13.5, 206], ['UPN 160', 160, 65, 7.5, 10.5, 24.0, 925], ['UPN 200', 200, 75, 8.5, 11.5, 32.2, 1910],
]
const ANGLES: Array<[string, number, number, number, number, number]> = [
  ['L 60×60×6', 60, 60, 6, 6.91, 22.8], ['L 80×80×8', 80, 80, 8, 12.3, 72.3], ['L 100×100×10', 100, 100, 10, 19.2, 177],
]

function catalogueSection(c: Catalogue, id: string): Section {
  const p: Record<string, number> = {}
  const names = SHAPE_PARAMS[c.shape]
  names.forEach((n, i) => { p[n] = c.dims[i] * mm })
  const geo = sectionProps(c.shape, p)
  // bending about the strong axis; the extreme fibre at h/2 (an angle: at its larger distance, from the geometry)
  const Z = c.shape === 'angle' ? (geo.Z * c.I * cm4) / geo.I : (c.I * cm4) / (geo.h / 2)
  return { id, name: c.name, shape: c.shape, params: p, A: c.A * cm2, I: c.I * cm4, Z, h: geo.h }
}

/** The standard sizes (rolled steel sections of the European catalogue). */
export const STANDARD_SECTIONS: readonly Section[] = [
  ...IPE.map(([n, h, b, tw, tf, A, I]) => catalogueSection({ name: n, shape: 'ibeam', dims: [h, b, tw, tf], A, I }, n.replace(/\s/g, ''))),
  ...HEA.map(([n, h, b, tw, tf, A, I]) => catalogueSection({ name: n, shape: 'ibeam', dims: [h, b, tw, tf], A, I }, n.replace(/\s/g, ''))),
  ...HEB.map(([n, h, b, tw, tf, A, I]) => catalogueSection({ name: n, shape: 'ibeam', dims: [h, b, tw, tf], A, I }, n.replace(/\s/g, ''))),
  ...UPN.map(([n, h, b, tw, tf, A, I]) => catalogueSection({ name: n, shape: 'channel', dims: [h, b, tw, tf], A, I }, n.replace(/\s/g, ''))),
  ...ANGLES.map(([n, a, b, t, A, I]) => catalogueSection({ name: n, shape: 'angle', dims: [a, b, t], A, I }, n.replace(/[\s×]/g, ''))),
]

/** Some ready-to-use plain shapes. */
export const COMMON_SECTIONS: readonly Section[] = [
  makeSection('RECT50x100', 'Rectangle 50×100 mm', 'rect', { b: 50 * mm, h: 100 * mm }),
  makeSection('RECT100x200', 'Rectangle 100×200 mm', 'rect', { b: 100 * mm, h: 200 * mm }),
  makeSection('RECT300x500', 'Rectangle 300×500 mm', 'rect', { b: 300 * mm, h: 500 * mm }),
  makeSection('CIRC20', 'Round bar Ø20 mm', 'circle', { d: 20 * mm }),
  makeSection('CIRC50', 'Round bar Ø50 mm', 'circle', { d: 50 * mm }),
  makeSection('TUBE60x4', 'Tube Ø60.3×4 mm', 'tube', { D: 60.3 * mm, t: 4 * mm }),
  makeSection('TUBE114x6', 'Tube Ø114.3×6 mm', 'tube', { D: 114.3 * mm, t: 6 * mm }),
  makeSection('TEE100', 'T 100×100×10', 'tee', { b: 100 * mm, h: 100 * mm, tw: 10 * mm, tf: 10 * mm }),
]

export const SECTION_LIBRARY: readonly Section[] = [...COMMON_SECTIONS, ...STANDARD_SECTIONS]

export function librarySection(id: string): Section | undefined {
  const key = id.replace(/\s/g, '').toLowerCase()
  return SECTION_LIBRARY.find((s) => s.id.toLowerCase() === key || s.name.replace(/\s/g, '').toLowerCase() === key)
}

/** A section read from a file: the stored dimensions are trusted when the shape is known, else A, I are kept. */
export function cleanSection(s: Partial<Section> & { id: string }): Section {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const shape = (s.shape && s.shape in SHAPE_PARAMS ? s.shape : 'custom') as SectionShape
  const params = Object.fromEntries(Object.entries(s.params ?? {}).map(([k, v]) => [k, num(v)]))
  const A = num(s.A)
  const I = num(s.I)
  if (A > 0 && I > 0) return { id: s.id, name: s.name || s.id, shape, params, A, I, Z: num(s.Z) > 0 ? num(s.Z) : (2 * I) / Math.max(num(s.h), 1e-9), h: num(s.h) > 0 ? num(s.h) : Math.sqrt(12 * (I / A)) }
  try { return makeSection(s.id, s.name || s.id, shape, params) } catch { return customSection(s.id, s.name || s.id, 1e-4, 1e-8) }
}
