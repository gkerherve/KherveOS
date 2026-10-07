// What the beamer theme draws around the boxes — frame title, bars, footers,
// background, bullets, typeface — approximated in HTML for the canvas while
// the exact picture (the compiled theme backdrop, see backdrop.ts) is not
// there: no server, or still compiling. The desktop draws its compiled
// backdrop the same way. No DOM here.

import type { Deck, ThemeSpec } from './model.ts'
import { readableOn } from './serializer.ts'

export interface Look {
  /** Bullets, plain frame titles, enumerate numbers. */
  structure: string
  /** The page background (CSS). */
  background: string
  /** Frame title: on a bar, or coloured text. */
  titleBar: { bg: string; fg: string } | null
  titleFg: string
  titleRule: { color: string; width: number } | null
  /** Frame title size in pt. */
  titlePt: number
  titleBold: boolean
  /** A band across the top (miniframes / tree themes), as a fraction of the height. */
  head: { h: number; bg: string; fg: string } | null
  /** A sidebar (Berkeley, PaloAlto, Goettingen…). */
  side: { left: boolean; w: number; bg: string; fg: string } | null
  footer:
    | { kind: 'none' }
    | { kind: 'line'; color: string; width: number }
    | { kind: 'bar'; bg: string; fg: string; left: string; center: string; right: string }
    | { kind: 'three'; bgs: [string, string, string]; fgs: [string, string, string]; left: string; center: string; right: string }
  header: { text: string; bg: string; fg: string } | null
  /** Page number overlay of plain frames (bottom-right, grey). */
  pageNumber: string
  bullets: string
  serif: boolean
  /** A typeface name the browser may have (theme builder's "font_family"). */
  typeface: string
  logo: { path: string; corner: string; size: number; low: boolean } | null
}

const BLUE = '#3333B3' // beamer's default structure colour (rgb .2,.2,.7)

interface Base {
  structure?: string
  bar?: [string, string] | null
  titleFg?: string
  bold?: boolean
  head?: [number, string, string]
  side?: [boolean, number, string, string]
  footer?: 'none' | 'three' | 'split'
  footerColors?: [string, string, string]
  bullets?: string
  bg?: string
}

const shade = (hex: string, f: number) => {
  // f < 0: darker, f > 0: lighter
  const h = hex.replace('#', '')
  const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  const out = n.map((c) => Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f))
  return '#' + out.map((c) => c.toString(16).padStart(2, '0')).join('')
}

/** Rough looks of beamer's themes (structure colour, title bar, bands, footer). */
const THEMES: Record<string, Base> = {
  default: {},
  Bergen: { side: [true, 0.24, shade(BLUE, 0.85), BLUE] },
  Boadilla: { footer: 'three', footerColors: [shade(BLUE, 0.7), shade(BLUE, 0.8), shade(BLUE, 0.9)], bullets: 'ball' },
  Madrid: { bar: [BLUE, '#FFFFFF'], footer: 'three', footerColors: [shade(BLUE, -0.5), shade(BLUE, -0.25), BLUE], bullets: 'ball' },
  AnnArbor: { structure: '#003366', bar: ['#003366', '#FFCB05'], head: [0.06, '#003366', '#FFCB05'], footer: 'three', footerColors: ['#00264D', '#003366', '#FFCB05'] },
  CambridgeUS: { structure: '#A3061F', bar: ['#EBEBEB', '#A3061F'], footer: 'three', footerColors: ['#7A0517', '#A3061F', '#EBEBEB'], bullets: 'ball' },
  Pittsburgh: { titleFg: BLUE },
  Rochester: { bar: [BLUE, '#FFFFFF'] },
  Antibes: { bar: [shade(BLUE, -0.2), '#FFFFFF'], head: [0.08, shade(BLUE, -0.4), '#FFFFFF'], bullets: 'ball' },
  JuanLesPins: { bar: [shade(BLUE, -0.1), '#FFFFFF'], head: [0.08, shade(BLUE, -0.3), '#FFFFFF'], bullets: 'ball' },
  Montpellier: { titleFg: BLUE, head: [0.08, shade(BLUE, 0.85), BLUE] },
  Berkeley: { bar: [shade(BLUE, 0.85), BLUE], side: [true, 0.18, shade(BLUE, -0.3), '#FFFFFF'], bullets: 'ball' },
  PaloAlto: { bar: [shade(BLUE, 0.85), BLUE], side: [true, 0.18, shade(BLUE, -0.2), '#FFFFFF'], bullets: 'ball' },
  Goettingen: { bar: [shade(BLUE, 0.85), BLUE], side: [false, 0.18, shade(BLUE, 0.85), BLUE], bullets: 'ball' },
  Marburg: { bar: [BLUE, '#FFFFFF'], side: [false, 0.18, shade(BLUE, -0.3), '#FFFFFF'], bullets: 'ball' },
  Hannover: { side: [true, 0.18, shade(BLUE, 0.85), BLUE], titleFg: BLUE, bullets: 'ball' },
  Berlin: { bar: [shade(BLUE, -0.2), '#FFFFFF'], head: [0.1, '#000033', '#FFFFFF'], footer: 'split', footerColors: [shade(BLUE, -0.6), shade(BLUE, -0.4), ''], bullets: 'ball' },
  Ilmenau: { bar: [shade(BLUE, -0.2), '#FFFFFF'], head: [0.1, '#000033', '#FFFFFF'], footer: 'split', footerColors: [shade(BLUE, -0.6), shade(BLUE, -0.4), ''], bullets: 'ball' },
  Dresden: { titleFg: BLUE, head: [0.1, shade(BLUE, 0.85), BLUE], footer: 'split', footerColors: [shade(BLUE, 0.85), shade(BLUE, 0.9), ''], bullets: 'ball' },
  Darmstadt: { bar: [shade(BLUE, 0.85), BLUE], head: [0.1, '#000000', '#FFFFFF'], bullets: 'ball' },
  Frankfurt: { bar: [shade(BLUE, 0.85), BLUE], head: [0.1, BLUE, '#FFFFFF'], bullets: 'ball' },
  Singapore: { titleFg: BLUE, head: [0.1, shade(BLUE, 0.9), BLUE], bullets: 'ball' },
  Szeged: { titleFg: BLUE, head: [0.1, '#FFFFFF', BLUE], footer: 'split', footerColors: ['#FFFFFF', '#FFFFFF', ''] },
  Copenhagen: { bar: [shade(BLUE, -0.3), '#FFFFFF'], head: [0.06, shade(BLUE, -0.4), '#FFFFFF'], footer: 'split', footerColors: [shade(BLUE, -0.4), shade(BLUE, -0.2), ''], bullets: 'ball' },
  Luebeck: { bar: [shade(BLUE, -0.3), '#FFFFFF'], head: [0.06, shade(BLUE, -0.4), '#FFFFFF'], footer: 'split', footerColors: [shade(BLUE, -0.4), shade(BLUE, -0.2), ''] },
  Malmoe: { bar: [shade(BLUE, -0.3), '#FFFFFF'], head: [0.06, shade(BLUE, -0.4), '#FFFFFF'], footer: 'split', footerColors: [shade(BLUE, -0.4), shade(BLUE, -0.2), ''] },
  Warsaw: { bar: [shade(BLUE, -0.3), '#FFFFFF'], head: [0.06, shade(BLUE, -0.4), '#FFFFFF'], footer: 'split', footerColors: [shade(BLUE, -0.4), shade(BLUE, -0.2), ''], bullets: 'ball' },
  metropolis: { structure: '#23373B', bar: ['#23373B', '#FFFFFF'], bullets: 'triangle' },
  Auriga: { structure: '#000000', titleFg: '#000000', bold: true },
  Trigon: { structure: '#1C3A6B', bar: ['#1C3A6B', '#FFFFFF'] },
  sintef: { structure: '#003C65', titleFg: '#003C65' },
}

/** Colour themes that change the structure colour (or the background). */
const COLOR_THEMES: Record<string, { structure?: string; bg?: string; text?: string }> = {
  albatross: { structure: '#C8C8FF', bg: '#000033', text: '#FFFFFF' },
  beaver: { structure: '#8A1F1F' },
  beetle: { structure: '#2E2E54', bg: '#E3E3E3' },
  crane: { structure: '#B37400' },
  dolphin: { structure: '#333399' },
  fly: { bg: '#666666', text: '#FFFFFF', structure: '#FFFFFF' },
  seagull: { structure: '#666666' },
  wolverine: { structure: '#003366' },
  spruce: { structure: '#335233' },
  rose: { structure: BLUE },
  orchid: { structure: BLUE },
  whale: { structure: BLUE },
  seahorse: { structure: '#6666B3' },
  lily: { structure: BLUE },
  monarca: { structure: '#7A2828' },
}

const SIZE_PT: Record<string, number> = { small: 10, normal: 11, large: 12, Large: 14.4, huge: 20.74 }

function swapStructure(c: string, from: string, to: string): string {
  return c === from ? to : c
}

export function deckLook(deck: Deck): Look {
  const base = THEMES[deck.theme] ?? THEMES.default
  const ct = COLOR_THEMES[deck.color_theme] ?? {}
  const spec: ThemeSpec | null = deck.theme_spec?.enabled ? deck.theme_spec : null
  const baseStructure = base.structure ?? BLUE
  let structure = ct.structure ?? baseStructure
  if (spec?.structure) structure = spec.structure
  // Theme colours derived from the default blue follow the structure colour.
  const re = (c: string) => (structure !== baseStructure && c ? swapStructure(c, baseStructure, structure) : c)

  let background = ct.bg ?? '#FFFFFF'
  if (spec?.canvas_bg && spec.canvas_bg2) background = `linear-gradient(${spec.canvas_bg}, ${spec.canvas_bg2})`
  else if (spec?.canvas_bg) background = spec.canvas_bg

  let titleBar = base.bar ? { bg: re(base.bar[0]), fg: base.bar[1] } : null
  let titleFg = re(base.titleFg ?? structure)
  if (spec) {
    if (spec.title_bg) titleBar = { bg: spec.title_bg, fg: spec.title_fg || readableOn(spec.title_bg) }
    else if (spec.title_fg) {
      titleFg = spec.title_fg
      if (titleBar) titleBar = { ...titleBar, fg: spec.title_fg }
    } else if (spec.structure && !titleBar) titleFg = spec.structure
  }
  const ruleColor = spec?.rule_color || structure
  const ruleW = Math.max(0.2, spec?.rule_width ?? 1.5)
  const plain = deck.plain_frames

  // Footline: the deck's own slots win, then the theme builder's, then the theme's.
  const numMacro = deck.page_number === 'number' ? '#' : deck.page_number === 'of_total' ? '#/N' : ''
  const num = spec?.footer_bar ? '' : numMacro
  const fr = num && !plain ? (deck.foot_right ? `${deck.foot_right} ${num}` : num) : deck.foot_right
  let footer: Look['footer'] = { kind: 'none' }
  const three = base.footer === 'three' || base.footer === 'split'
  const fc = base.footerColors ?? [shade(structure, -0.5), shade(structure, -0.25), structure]
  if (three) {
    const bgs = fc.map((c) => re(c) || 'transparent') as [string, string, string]
    footer = { kind: 'three', bgs, fgs: bgs.map((c) => (c === 'transparent' ? structure : readableOn(c))) as [string, string, string], left: deck.author, center: deck.title, right: '#/N' }
  }
  if (spec?.footline_rule) footer = { kind: 'line', color: ruleColor, width: ruleW }
  if (spec?.footer_bar) {
    const bar = spec.title_bg || spec.structure || '#1F4E79'
    footer = { kind: 'bar', bg: bar, fg: spec.title_bg ? spec.title_fg || '#FFFFFF' : readableOn(bar), left: deck.author, center: deck.title, right: '#/N' }
  }
  if (deck.foot_left || deck.foot_center || fr) {
    footer = {
      kind: 'three', bgs: three ? (footer.kind === 'three' ? footer.bgs : ['transparent', 'transparent', 'transparent']) : ['transparent', 'transparent', 'transparent'],
      fgs: three && footer.kind === 'three' ? footer.fgs : ['#666666', '#666666', '#666666'], left: deck.foot_left, center: deck.foot_center, right: fr,
    }
  }
  if (plain) footer = { kind: 'none' }

  const typeface = spec?.font_family ?? ''
  const serif = !!spec && (spec.fonts === 'serif' || ['times', 'palatino', 'charter'].includes(typeface))
  return {
    structure,
    background,
    titleBar,
    titleFg,
    titleRule: spec?.title_rule ? { color: ruleColor, width: ruleW } : null,
    titlePt: SIZE_PT[spec?.frametitle_size ?? ''] ?? 14.4,
    titleBold: !!base.bold,
    head: plain || !base.head ? null : { h: base.head[0], bg: re(base.head[1]), fg: base.head[2] },
    side: plain || !base.side ? null : { left: base.side[0], w: base.side[1], bg: re(base.side[2]), fg: re(base.side[3]) },
    footer,
    header: deck.header && !plain ? { text: deck.header, bg: shade(structure, 0.85), fg: structure } : null,
    pageNumber: plain && deck.page_number !== 'none' ? numMacro : '',
    bullets: spec?.bullets || base.bullets || 'triangle',
    serif,
    typeface,
    logo: spec?.logo ? { path: spec.logo, corner: spec.logo_corner, size: spec.logo_size, low: spec.footer_bar || spec.footline_rule } : null,
  }
}

/** CSS font stacks: beamer's Latin Modern ≈ KaTeX's Computer Modern faces. */
export const TYPEFACES: Record<string, string> = {
  helvetica: "Helvetica, Arial, 'TeX Gyre Heros', sans-serif",
  fira: "'Fira Sans', 'Segoe UI', sans-serif",
  sourcesans: "'Source Sans Pro', 'Source Sans 3', sans-serif",
  lato: "Lato, 'Segoe UI', sans-serif",
  opensans: "'Open Sans', 'Segoe UI', sans-serif",
  roboto: 'Roboto, Arial, sans-serif',
  carlito: "Carlito, Calibri, 'Segoe UI', sans-serif",
  times: "'Times New Roman', Times, 'TeX Gyre Termes', serif",
  palatino: "'Palatino Linotype', Palatino, 'Book Antiqua', serif",
  charter: "Charter, 'Bitstream Charter', XCharter, serif",
}
export const SANS = "KaTeX_SansSerif, 'Latin Modern Sans', 'CMU Sans Serif', Helvetica, Arial, sans-serif"
export const SERIF = "KaTeX_Main, 'Latin Modern Roman', 'CMU Serif', 'Times New Roman', serif"
export const MONO = "KaTeX_Typewriter, 'Latin Modern Mono', 'CMU Typewriter Text', Menlo, monospace"

/** Page size in cm (beamer's paper per aspect preset, or the custom size). */
export function pageCm(deck: Deck): { w: number; h: number } {
  if (deck.page_w_cm > 0 && deck.page_h_cm > 0) return { w: deck.page_w_cm, h: deck.page_h_cm }
  const sizes: Record<string, [number, number]> = { '169': [16, 9], '1610': [16, 10], '43': [12.8, 9.6], '32': [13.5, 9], '54': [12.5, 10], '141': [14.85, 10.5] }
  const [w, h] = sizes[deck.aspect] ?? sizes['169']
  return { w, h }
}

export const ASPECTS: [string, string][] = [['169', '16:9'], ['1610', '16:10'], ['43', '4:3'], ['32', '3:2'], ['54', '5:4'], ['141', '√2:1 (A4)']]
