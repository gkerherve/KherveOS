// A presentation → beamer LaTeX, ported line by line from the desktop's
// kherveslide/serializer.py: the KherveOS server compiles exactly what the
// desktop would. Absolute placement uses textpos (absolute, overlay) bound to
// \paperwidth / \paperheight, so the 0..1 fractions of the model drop straight
// into \begin{textblock}{w}(x,y).
//
// The only additions are hooks for the browser: `imagePath` maps a picture's
// stored path to the name it has in the compile bundle, and `baked` supplies a
// picture with effects already applied (the desktop bakes them with Pillow).
// Without options the output is the desktop's, byte for byte (tests/).
//
// No DOM here: the Node tests load this file directly.

import {
  blendOverWhite, linePath, makeSlide, TABLE_CAPTION_FG, TABLE_HEADER_BG, TABLE_HEADER_FG, TABLE_RULE,
  type Deck, type Slide, type SlideLine, type SlideObject, type SlidePicture, type SlideShape, type SlideTable, type SlideText,
  type SlideVideo, type ThemeSpec,
} from './model.ts'
import { outline, type Pt } from './shapes.ts'

export interface SerializeOptions {
  /** The path to put in \includegraphics for a stored picture / logo / poster path (default: as stored). */
  imagePath?: (path: string) => string
  /** A picture with effects: its baked PNG (in the bundle) and how far it extends beyond the box (l, t, r, b). */
  baked?: (obj: SlidePicture) => { path: string; pad: [number, number, number, number] } | null
}

let OPTS: SerializeOptions = {}
const imgPath = (p: string) => (OPTS.imagePath ? OPTS.imagePath(p) : p)

// ------------------------------------------------------------------ number / colour formatting

/** Python's f"{v:.4f}" (round half to even on exact ties). */
function fixed4(v: number): string {
  const neg = v < 0 || Object.is(v, -0)
  const a = Math.abs(v)
  let s: string
  const t = a * 32
  if (Number.isInteger(t) && t % 2 === 1 && a < 1e15) {
    // An exact tie at the 5th decimal (odd/32): Python rounds to the even digit.
    const five = a.toFixed(5)
    const lastKept = Number(five[five.length - 2])
    s = lastKept % 2 === 0 ? five.slice(0, -1) : (a + 0.00005).toFixed(4)
  } else s = a.toFixed(4)
  return (neg ? '-' : '') + s
}

/** A fraction to 4 decimals without trailing zeros (the desktop's _fmt). */
export function fmt(v: number): string {
  return fixed4(v).replace(/0+$/, '').replace(/\.$/, '') || '0'
}

function hexArg(hex: string | undefined): string {
  const h = (hex || '').replace(/^#/, '').trim()
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return ''
  return h.toUpperCase()
}

const pyRound = (v: number) => {
  const f = Math.floor(v)
  const d = v - f
  return d > 0.5 || (d === 0.5 && f % 2 === 1) ? f + 1 : f
}

const ASPECT_OPTS: Record<string, string> = {
  '169': 'aspectratio=169',
  '1610': 'aspectratio=1610',
  '43': '',
  '32': 'aspectratio=32',
  '54': 'aspectratio=54',
  '141': 'aspectratio=141',
}

// ------------------------------------------------------------------ text

function isStructLine(line: string): boolean {
  const s = line.replace(/^\s+/, '')
  return s.startsWith('\\begin{') || s.startsWith('\\end{') || s.startsWith('\\item')
}

/** A user line break → \\ ; an empty line between text lines → a visible blank line (\mbox{}). */
export function applyLinebreaks(body: string): string {
  const lines = body.split('\n')
  if (lines.length <= 1) return body
  const plain = (ln: string) => !!ln.trim() && !isStructLine(ln)
  const filled = [...lines]
  lines.forEach((ln, i) => {
    if (ln.trim()) return
    const before = [...lines.slice(0, i)].reverse().find((x) => x.trim()) ?? ''
    const after = lines.slice(i + 1).find((x) => x.trim()) ?? ''
    if (plain(before) && plain(after)) filled[i] = '\\mbox{}'
  })
  const out = [filled[0]]
  for (let i = 1; i < filled.length; i++) out.push((plain(filled[i - 1]) && plain(filled[i]) ? ' \\\\\n' : '\n') + filled[i])
  return out.join('')
}

function styledText(obj: SlideText): string {
  let body = applyLinebreaks(obj.text || '')
  if (obj.bold) body = `\\textbf{${body}}`
  if (obj.italic) body = `\\textit{${body}}`
  const color = hexArg(obj.color)
  if (color && color !== '000000') body = `\\textcolor[HTML]{${color}}{${body}}`
  const fam = ({ rm: '\\rmfamily', sf: '\\sffamily', tt: '\\ttfamily' } as Record<string, string>)[obj.font_family ?? ''] ?? ''
  const align = ({ center: '\\centering', right: '\\raggedleft', left: '\\raggedright' } as Record<string, string>)[obj.align] ?? '\\raggedright'
  const lead = pyRound(obj.font_pt * 1.2)
  return `${align}${fam}\\fontsize{${obj.font_pt}}{${lead}}\\selectfont ${body}`
}

export const BLOCK_ENVS = new Set(['block', 'alertblock', 'exampleblock'])
export const THEOREM_ENVS = new Set(['theorem', 'definition', 'corollary', 'lemma', 'example', 'proof', 'fact'])
const ALL_BLOCK_ENVS = new Set([...BLOCK_ENVS, ...THEOREM_ENVS])

function textInner(obj: SlideText): string {
  let content = styledText(obj)
  const block = obj.block ?? ''
  const title = obj.block_title || ''
  if (BLOCK_ENVS.has(block)) content = `\\begin{${block}}{${title}}${content}\\end{${block}}`
  else if (THEOREM_ENVS.has(block)) content = `\\begin{${block}}${title ? `[${title}]` : ''}${content}\\end{${block}}`
  if (hasFrame(obj)) return frameWrap(`${content}\\par`, obj, '\\linewidth')
  return `{${content}\\par}`
}

const tb = (o: { w: number; x: number; y: number }) => `\\begin{textblock}{${fmt(o.w)}}(${fmt(o.x)},${fmt(o.y)})\n`

function serializeText(obj: SlideText): string {
  return `${tb(obj)}${textInner(obj)}\n\\end{textblock}`
}

// ------------------------------------------------------------------ frames

const hasCrop = (o: SlidePicture) => o.crop_l > 0 || o.crop_t > 0 || o.crop_r > 0 || o.crop_b > 0

function hasFrame(obj: object): boolean {
  const o = obj as { border_color?: string; fill?: string }
  return !!(hexArg(o.border_color) || hexArg(o.fill))
}

const FRAME_PAD_PT = 3

type Framed = Partial<{
  border_color: string
  fill: string
  fill2: string
  gradient: string
  border_width: number
  border_style: string
  fill_opacity: number
  corner: string
  corner_radius: number
  shadow: boolean
}>

/** Wrap `inner` in a TikZ node giving the box its fill and/or border (unchanged when it has neither). */
function frameWrap(inner: string, obj: Framed, textWidth: string | null = null): string {
  const bc = hexArg(obj.border_color)
  const fc = hexArg(obj.fill)
  if (!bc && !fc) return inner
  const pad = textWidth ? FRAME_PAD_PT : 0
  const pre: string[] = []
  const opts = [`inner sep=${fmt(pad)}pt`, 'outer sep=0pt']
  if (bc) {
    pre.push(`\\definecolor{ksBorder}{HTML}{${bc}}`)
    opts.push('draw=ksBorder', `line width=${fmt(Math.max(0.2, obj.border_width ?? 1.0))}pt`)
    const st = ({ dashed: 'dashed', dotted: 'dotted' } as Record<string, string>)[obj.border_style ?? 'solid']
    if (st) opts.push(st)
  }
  if (fc) {
    pre.push(`\\definecolor{ksBoxFill}{HTML}{${fc}}`)
    const fc2 = hexArg(obj.fill2)
    if (fc2) {
      pre.push(`\\definecolor{ksBoxFillB}{HTML}{${fc2}}`)
      if ((obj.gradient ?? 'vertical') === 'horizontal') opts.push('left color=ksBoxFill', 'right color=ksBoxFillB')
      else opts.push('top color=ksBoxFill', 'bottom color=ksBoxFillB')
    } else opts.push('fill=ksBoxFill')
    const fo = obj.fill_opacity ?? 1.0
    if (fo < 1.0) opts.push(`fill opacity=${fmt(fo)}`)
  }
  if ((obj.corner ?? 'sharp') === 'rounded') opts.push(`rounded corners=${fmt(obj.corner_radius ?? 4.0)}pt`)
  if (obj.shadow) opts.push('drop shadow')
  if (textWidth) opts.push(`text width=${textWidth}-${fmt(2 * FRAME_PAD_PT)}pt`)
  return (
    pre.join('') +
    '\\begin{tikzpicture}\n' +
    `\\node[${opts.join(',')}] (ksframe) {${inner}};\n` +
    '\\pgfresetboundingbox\n' +
    '\\path[use as bounding box] (ksframe.south west) rectangle (ksframe.north east);\n\\end{tikzpicture}'
  )
}

// ------------------------------------------------------------------ pictures

function pictureGraphic(obj: SlidePicture, rel = '\\paperwidth', relH = '\\paperheight', widthExpr: string | null = null): string {
  const path = imgPath(obj.path).replace(/\\/g, '/')
  const baked = OPTS.baked ? OPTS.baked(obj) : null
  if (baked) {
    const [pl, pt, pr, pb] = baked.pad
    const bw = widthExpr || `${fmt(obj.w)}${rel}`
    let opts = `width=${fmt(1 + pl + pr)}\\dimexpr ${bw}\\relax,height=${fmt(obj.h * (1 + pt + pb))}${relH}`
    if (obj.keep_aspect) opts += ',keepaspectratio'
    let out = pictureFinish(obj, `\\includegraphics[${opts}]{${baked.path.replace(/\\/g, '/')}}`)
    if (pl || pt) out = `\\vspace*{-${fmt(obj.h * pt)}${relH}}\\noindent\\hspace*{-${fmt(pl)}\\dimexpr ${bw}\\relax}${out}`
    return out
  }
  const w = widthExpr || `${fmt(obj.w)}${rel}`
  let opts = `width=${w},height=${fmt(obj.h)}${relH}`
  if (obj.keep_aspect) opts += ',keepaspectratio'
  let graphic: string
  if (hasCrop(obj)) {
    const trim =
      `trim={${fmt(obj.crop_l)}\\width} {${fmt(obj.crop_b)}\\height} ` + `{${fmt(obj.crop_r)}\\width} {${fmt(obj.crop_t)}\\height}`
    graphic = `\\adjincludegraphics[${trim},clip,${opts}]{${path}}`
  } else graphic = `\\includegraphics[${opts}]{${path}}`
  return pictureFinish(obj, graphic)
}

function pictureFinish(obj: SlidePicture, graphic: string): string {
  if (obj.rotation) graphic = `\\rotatebox[origin=c]{${fmt(obj.rotation)}}{${graphic}}`
  if (obj.opacity < 1.0) {
    graphic = `\\begin{tikzpicture}\\node[opacity=${fmt(Math.max(0.0, obj.opacity))},inner sep=0]{${graphic}};\\end{tikzpicture}`
  }
  return graphic
}

function placeholderBox(widthExpr: string, heightExpr: string): string {
  return '{\\setlength{\\fboxsep}{0pt}\\framebox[' + widthExpr + ']{\\rule{0pt}{' + heightExpr + '}}}'
}

function picturePlaceholder(obj: SlidePicture): string {
  return `${tb(obj)}${placeholderBox(`${fmt(obj.w)}\\paperwidth`, `${fmt(obj.h)}\\paperheight`)}\n\\end{textblock}`
}

export const TEX_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.pdf', '.eps'])

/** ".png" for "a/b.PNG" (Path.suffix.lower()). */
export function suffix(p: string): string {
  const base = p.replace(/\\/g, '/').split('/').pop() ?? ''
  const i = base.lastIndexOf('.')
  return i > 0 && i < base.length - 1 ? base.slice(i).toLowerCase() : ''
}

function serializePicture(obj: SlidePicture): string {
  if (!obj.path || !TEX_IMAGE_EXTS.has(suffix(imgPath(obj.path)))) return picturePlaceholder(obj)
  return `${tb(obj)}${frameWrap(pictureGraphic(obj), obj)}\n\\end{textblock}`
}

function videoFace(obj: SlideVideo): string {
  const h = `${fmt(obj.h)}\\TPVertModule`
  const poster = obj.poster ? imgPath(obj.poster) : ''
  if (poster) return `\\includegraphics[width=\\linewidth,height=${h}]{${poster.replace(/\\/g, '/')}}`
  return (
    '{\\setlength{\\fboxsep}{0pt}\\colorbox[HTML]{262626}' +
    `{\\parbox[b][${h}][c]{\\linewidth}` +
    '{\\centering\\textcolor{white}' +
    '{\\Huge$\\blacktriangleright$}}}}'
  )
}

function serializeVideo(obj: SlideVideo): string {
  let face = videoFace(obj)
  const path = (obj.path || '').replace(/\\/g, '/')
  if (path) face = `\\href{file:${path}}{${face}}`
  return `${tb(obj)}${face}\n\\end{textblock}`
}

// ------------------------------------------------------------------ tables

const ALIGN_COL: Record<string, string> = { left: 'l', center: 'c', right: 'r' }

function tableInner(obj: SlideTable): string {
  const rows = obj.rows.length ? obj.rows : [['']]
  const ncols = Math.max(1, ...rows.map((r) => r.length))
  let grid = obj.grid ?? 'all'
  if (!(obj.border ?? true) && grid === 'all') grid = 'none'
  const a = ALIGN_COL[obj.align ?? 'left'] ?? 'l'
  const vbar = grid === 'all' ? '|' : ''
  const colspec = vbar + Array.from({ length: ncols }, () => a).join(vbar) + vbar
  const fullHline = grid === 'all' || grid === 'horizontal'
  const outerHline = fullHline || grid === 'outer'
  const hrule = fullHline ? '\\hline\n' : ''
  const edge = outerHline ? '\\hline\n' : ''
  const cname = (prefix: string, hexv: string | undefined, fallback: string): [string, string] => {
    const h = hexArg(hexv) || fallback
    return [`ks${prefix}${h}`, `\\definecolor{ks${prefix}${h}}{HTML}{${h}}`]
  }
  const [headN, headD] = cname('TH', obj.header_bg ?? '#FCE4D6', 'FCE4D6')
  const [hfgN, hfgD] = cname('TF', obj.header_fg ?? '#C55A11', 'C55A11')
  const [ruleN, ruleD] = cname('TR', obj.rule_color ?? '#F4B183', 'F4B183')
  const [stripeN, stripeD] = cname('TS', obj.stripe_color ?? '#F5F5F5', 'F5F5F5')
  const defs = headD + hfgD + ruleD + stripeD
  const body = rows.map((row, i) => {
    let cells = [...row, ...Array.from({ length: ncols - row.length }, () => '')]
    if (i === 0 && obj.header) {
      cells = cells.map((c) => `\\textcolor{${hfgN}}{\\textbf{${c}}}`)
      return `  \\rowcolor{${headN}}` + cells.join(' & ') + ' \\\\'
    }
    let prefix = '  '
    if (obj.striped) {
      const bi = i - (obj.header ? 1 : 0)
      if (((bi % 2) + 2) % 2 === 1) prefix = `  \\rowcolor{${stripeN}}`
    }
    return prefix + cells.join(' & ') + ' \\\\'
  })
  const joiner = fullHline ? '\n' + hrule : '\n'
  let table = `\\begin{tabular}{${colspec}}\n${edge}` + body.join(joiner) + `\n${edge}\\end{tabular}`
  const color = hexArg(obj.color)
  if (color && color !== '000000') table = `\\textcolor[HTML]{${color}}{${table}}`
  if (obj.caption) table += `\\\\[2pt]{\\footnotesize\\itshape\\textcolor{ksTblCap}{${obj.caption}}}`
  const lead = pyRound(obj.font_pt * 1.2)
  const sized = `\\fontsize{${obj.font_pt}}{${lead}}\\selectfont`
  const ruleW = `\\setlength{\\arrayrulewidth}{${fmt(obj.rule_width)}pt}`
  return frameWrap(`{${defs}${ruleW}\\arrayrulecolor{${ruleN}} ${sized} ${table}}`, obj)
}

function serializeTable(obj: SlideTable): string {
  return `${tb(obj)}${tableInner(obj)}\n\\end{textblock}`
}

// ------------------------------------------------------------------ beamer-placed (locked) flow

function flowObject(obj: SlideObject): string | null {
  if (obj.type === 'SlideText') {
    if (ALL_BLOCK_ENVS.has(obj.block ?? '')) {
      const w = Math.max(0.15, Math.min(1.0, obj.w))
      if (w < 0.97) {
        return '\\par\\begin{center}\n' + `\\begin{minipage}{${fmt(w)}\\textwidth}\n` + `${textInner(obj)}\n` + '\\end{minipage}\n\\end{center}\\medskip'
      }
    }
    return '\\par ' + textInner(obj) + '\\medskip'
  }
  if (obj.type === 'SlideTable') return '\\begin{center}' + tableInner(obj) + '\\end{center}'
  if (obj.type === 'SlidePicture') {
    const inner = obj.path
      ? frameWrap(pictureGraphic(obj, '\\textwidth', '\\textheight'), obj)
      : placeholderBox(`${fmt(obj.w)}\\textwidth`, `${fmt(obj.h)}\\textheight`)
    return '\\begin{center}' + inner + '\\end{center}'
  }
  return null
}

function columnContent(obj: SlideObject): string | null {
  if (obj.type === 'SlideText') return textInner(obj)
  if (obj.type === 'SlideTable') return tableInner(obj)
  if (obj.type === 'SlidePicture') {
    if (obj.path) return frameWrap(pictureGraphic(obj, '\\paperwidth', '\\textheight', '\\linewidth'), obj)
    return placeholderBox('\\linewidth', `${fmt(obj.h)}\\textheight`)
  }
  return null
}

const hDisjoint = (a: SlideObject, b: SlideObject) => a.x + a.w <= b.x + 1e-6 || b.x + b.w <= a.x + 1e-6

/** Python's round(v, 3) for sorting (close enough: only used as a sort key). */
const round3 = (v: number) => Math.round(v * 1000) / 1000

function groupRows(objs: SlideObject[]): SlideObject[][] {
  const rows: SlideObject[][] = []
  const sorted = [...objs].sort((a, b) => round3(a.y) - round3(b.y) || a.x - b.x)
  for (const o of sorted) {
    let placed = false
    for (const row of rows) {
      const top = Math.min(...row.map((m) => m.y))
      const bot = Math.max(...row.map((m) => m.y + m.h))
      const vOverlap = o.y < bot - 0.02 && o.y + o.h > top + 0.02
      if (vOverlap && row.every((m) => hDisjoint(o, m))) {
        row.push(o)
        placed = true
        break
      }
    }
    if (!placed) rows.push([o])
  }
  rows.sort((a, b) => Math.min(...a.map((m) => m.y)) - Math.min(...b.map((m) => m.y)))
  return rows
}

function serializeFlow(objs: SlideObject[]): string[] {
  const parts: string[] = []
  for (let row of groupRows(objs)) {
    if (row.length === 1) {
      const block = flowObject(row[0])
      if (block) parts.push(`  % ${objLabel(row[0])}`, block)
      continue
    }
    row = [...row].sort((a, b) => a.x - b.x)
    parts.push(`  % ${row.length} columns`, '\\begin{columns}[t]')
    for (const o of row) {
      const content = columnContent(o)
      if (content === null) continue
      const w = Math.max(0.1, Math.min(0.92, o.w))
      parts.push(`  \\begin{column}{${fmt(w)}\\textwidth}  % ${objLabel(o)}`, content, '  \\end{column}')
    }
    parts.push('\\end{columns}')
  }
  return parts
}

// ------------------------------------------------------------------ theme

const SIZE_MACRO: Record<string, string> = { small: '\\small', normal: '\\normalsize', large: '\\large', Large: '\\Large', huge: '\\huge' }

/** Theme typefaces: key → [display name, preamble lines]. */
export const FONT_FAMILIES: Record<string, [string, string[]]> = {
  helvetica: ['Helvetica / Arial-like', ['\\usepackage[scaled=0.95]{helvet}', '\\renewcommand{\\familydefault}{\\sfdefault}']],
  fira: ['Fira Sans', ['\\usepackage[sfdefault]{FiraSans}']],
  sourcesans: ['Source Sans Pro', ['\\usepackage[default]{sourcesanspro}']],
  lato: ['Lato', ['\\usepackage[default]{lato}']],
  opensans: ['Open Sans', ['\\usepackage[default]{opensans}']],
  roboto: ['Roboto', ['\\usepackage[sfdefault]{roboto}']],
  carlito: ['Carlito (Calibri-like)', ['\\usepackage[sfdefault,lf]{carlito}']],
  times: ['Times (serif)', ['\\usepackage{newtxtext}', '\\usefonttheme{serif}']],
  palatino: ['Palatino (serif)', ['\\usepackage{newpxtext}', '\\usefonttheme{serif}']],
  charter: ['Charter (serif)', ['\\usepackage{XCharter}', '\\usefonttheme{serif}']],
}

export const BEAMER_THEMES = [
  'default', 'AnnArbor', 'Antibes', 'Bergen', 'Berkeley', 'Berlin', 'Boadilla', 'CambridgeUS', 'Copenhagen', 'Darmstadt', 'Dresden',
  'Frankfurt', 'Goettingen', 'Hannover', 'Ilmenau', 'JuanLesPins', 'Luebeck', 'Madrid', 'Malmoe', 'Marburg', 'Montpellier', 'PaloAlto',
  'Pittsburgh', 'Rochester', 'Singapore', 'Szeged', 'Warsaw', 'metropolis', 'Auriga', 'Trigon', 'sintef',
]
export const BEAMER_COLOR_THEMES = [
  'default', 'albatross', 'beaver', 'beetle', 'crane', 'dolphin', 'dove', 'fly', 'lily', 'monarca', 'orchid', 'rose', 'seagull', 'seahorse',
  'spruce', 'structure', 'whale', 'wolverine',
]

function fontFamilyLines(spec: ThemeSpec | undefined): string[] {
  if (!spec?.enabled) return []
  const entry = FONT_FAMILIES[spec.font_family || '']
  return entry ? [...entry[1]] : []
}

/** Black or white, whichever reads better on `hex`. */
export function readableOn(hex: string): string {
  const h = hexArg(hex)
  if (!h) return '#FFFFFF'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#000000' : '#FFFFFF'
}

function themeSpecLines(spec: ThemeSpec | undefined): string[] {
  if (!spec?.enabled) return []
  const lines: string[] = []
  if (spec.inner) lines.push(`\\useinnertheme{${spec.inner}}`)
  if (spec.outer) lines.push(`\\useoutertheme{${spec.outer}}`)
  if (spec.fonts) lines.push(`\\usefonttheme{${spec.fonts}}`)
  if (spec.bullets === 'dot') {
    lines.push(
      '\\setbeamertemplate{itemize items}{\\textbullet}',
      '\\setbeamercolor{itemize item}{use=normal text,fg=normal text.fg}',
      '\\setbeamercolor{itemize subitem}{use=normal text,fg=normal text.fg}',
    )
  } else if (spec.bullets) lines.push(`\\setbeamertemplate{itemize items}[${spec.bullets}]`)

  let counter = 0
  const cname = (hex: string): string | null => {
    const h = hexArg(hex)
    if (!h) return null
    const n = `ksth${counter++}`
    lines.push(`\\definecolor{${n}}{HTML}{${h}}`)
    return n
  }
  const setColor = (element: string, fg?: string, bg?: string) => {
    const keys: string[] = []
    if (fg) {
      const c = cname(fg)
      if (c) keys.push(`fg=${c}`)
    }
    if (bg) {
      const c = cname(bg)
      if (c) keys.push(`bg=${c}`)
    }
    if (keys.length) lines.push(`\\setbeamercolor{${element}}{${keys.join(',')}}`)
  }
  setColor('structure', spec.structure)
  setColor('normal text', spec.text_fg)
  const bg1 = hexArg(spec.canvas_bg || '')
  const bg2 = hexArg(spec.canvas_bg2 || '')
  if (bg1 && bg2) {
    lines.push(
      `\\definecolor{ksBgTop}{HTML}{${bg1}}`,
      `\\definecolor{ksBgBot}{HTML}{${bg2}}`,
      '\\setbeamertemplate{background canvas}[vertical shading][top=ksBgTop,bottom=ksBgBot]',
    )
  } else setColor('background canvas', undefined, spec.canvas_bg)
  setColor('frametitle', spec.title_fg, spec.title_bg)
  setColor('title', spec.title_fg)
  setColor('block title', undefined, spec.block_bg)
  if (spec.frametitle_size in SIZE_MACRO) lines.push(`\\setbeamerfont{frametitle}{size=${SIZE_MACRO[spec.frametitle_size]}}`)

  if (spec.title_rule || spec.footline_rule) {
    const rc = hexArg(spec.rule_color || '')
    let ruleColor = 'structure'
    if (rc) {
      lines.push(`\\definecolor{ksRule}{HTML}{${rc}}`)
      ruleColor = 'ksRule'
    }
    const w = fmt(Math.max(0.2, spec.rule_width ?? 1.5))
    if (spec.title_rule) lines.push('\\addtobeamertemplate{frametitle}{}{%\n' + `\\vskip2pt{\\color{${ruleColor}}\\hrule height ${w}pt}}`)
    if (spec.footline_rule) lines.push('\\setbeamertemplate{footline}{%\n' + `\\hbox{\\color{${ruleColor}}\\rule{\\paperwidth}{${w}pt}}` + '\\vskip0pt}')
  }
  if (spec.footer_bar) {
    const bar = spec.title_bg || spec.structure || '#1F4E79'
    const fg = cname(spec.title_bg ? spec.title_fg : readableOn(bar))
    const bg = cname(bar)
    lines.push(
      `\\setbeamercolor{ks footer bar}{fg=${fg},bg=${bg}}`,
      '\\setbeamertemplate{footline}{%',
      '\\leavevmode\\hbox{\\begin{beamercolorbox}[wd=\\paperwidth,ht=2.6ex,dp=1.1ex,leftskip=1.5ex,rightskip=1.5ex]{ks footer bar}%',
      '\\usebeamerfont{author in head/foot}\\insertshortauthor\\hfill\\insertshorttitle\\hfill\\insertframenumber\\,/\\,\\inserttotalframenumber',
      '\\end{beamercolorbox}}\\vskip0pt}',
    )
  }
  return lines
}

function logoLines(spec: ThemeSpec | undefined): string[] {
  if (!spec?.enabled) return []
  const path = imgPath(spec.logo || '').replace(/\\/g, '/')
  if (!spec.logo || !path) return []
  const corner = ['tr', 'tl', 'br', 'bl'].includes(spec.logo_corner) ? spec.logo_corner : 'tr'
  const v = corner[0] === 't' ? 'north' : 'south'
  const h = corner[1] === 'r' ? 'east' : 'west'
  const size = fmt(Math.max(0.03, Math.min(0.4, spec.logo_size ?? 0.12)))
  const dx = h === 'east' ? '-0.025' : '0.025'
  const low = spec.footer_bar || spec.footline_rule
  const dy = v === 'north' ? '-0.025' : low ? '0.07' : '0.025'
  return [
    '\\addtobeamertemplate{footline}{%',
    '\\begin{tikzpicture}[remember picture,overlay]' +
      `\\node[anchor=${v} ${h},inner sep=0pt] at ` +
      `([xshift=${dx}\\paperheight,yshift=${dy}\\paperheight]` +
      `current page.${v} ${h})` +
      `{\\includegraphics[height=${size}\\paperheight]{${path}}};` +
      '\\end{tikzpicture}}{}',
  ]
}

// ------------------------------------------------------------------ lines and shapes

const DASH_TIKZ: Record<string, string> = { dashed: ', dashed', dotted: ', dotted' }

function arrowOpts(obj: SlideLine): string {
  const hs = Math.max(0.3, obj.head_size ?? 1.0)
  const head = `{Stealth[length=${fmt(2.4 * hs)}mm]}`
  if (obj.arrow_start && obj.arrow_end) return `, ${head}-${head}`
  if (obj.arrow_end) return `, -${head}`
  if (obj.arrow_start) return `, ${head}-`
  return ''
}

function serializeLine(obj: SlideLine, idx: number): string {
  const colour = hexArg(obj.color) || '000000'
  const arrow = arrowOpts(obj)
  const dash = DASH_TIKZ[obj.style ?? 'solid'] ?? ''
  const op = obj.opacity ?? 1.0
  const opacity = op < 1.0 ? `, draw opacity=${fmt(op)}` : ''
  const left = Math.min(obj.x, obj.x + obj.w)
  const top = Math.min(obj.y, obj.y + obj.h)
  const bw = Math.abs(obj.w)
  const bh = Math.abs(obj.h)
  const f1x = bw === 0 ? 0.0 : (obj.x - left) / bw
  const f2x = bw === 0 ? 0.0 : (obj.x + obj.w - left) / bw
  const f1y = bh === 0 ? 0.0 : (obj.y - top) / bh
  const f2y = bh === 0 ? 0.0 : (obj.y + obj.h - top) / bh
  const wlen = '\\linewidth'
  const hlen = `${fmt(bh)}\\TPVertModule`
  const loc = (fx: number, fy: number) => `(${fmt(fx)}\\linewidth,-${fmt(fy * bh)}\\TPVertModule)`
  let path = `${loc(f1x, f1y)} -- ${loc(f2x, f2y)}`
  const pts = linePath(obj)
  if (pts.length > 2) {
    const at = (px: number, py: number) => `(${fmt(px - left)}\\TPHorizModule,-${fmt(py - top)}\\TPVertModule)`
    path = at(...pts[0])
    for (let i = 1; i < pts.length - 2; i += 3) path += ` .. controls ${at(...pts[i])} and ${at(...pts[i + 1])} .. ${at(...pts[i + 2])}`
  }
  const pic =
    '\\begin{tikzpicture}\n' +
    `\\useasboundingbox (0,0) rectangle (${wlen},-${hlen});\n` +
    `\\draw[line width=${fmt(obj.width_pt)}pt,color=ksline${idx}${arrow}${dash}${opacity}] ${path};\n` +
    '\\end{tikzpicture}'
  return `\\definecolor{ksline${idx}}{HTML}{${colour}}\n` + `\\begin{textblock}{${fmt(bw)}}(${fmt(left)},${fmt(top)})\n` + `${pic}\n\\end{textblock}`
}

const effShape = (obj: SlideShape) => (obj.shape === 'rect' && (obj.corner ?? 'sharp') === 'rounded' ? 'rounded_rect' : obj.shape)

function shapeTikz(obj: SlideShape, idx: number, pt: (nx: number, ny: number) => string, center: string, xr: string, yr: string): [string, string, string] {
  const kind = outline(effShape(obj))
  let defs = ''
  const opts: string[] = []
  if (obj.fill) {
    defs += `\\definecolor{ksfill${idx}}{HTML}{${hexArg(obj.fill) || 'ffffff'}}%\n`
    if (obj.fill2) {
      defs += `\\definecolor{ksfillb${idx}}{HTML}{${hexArg(obj.fill2) || 'ffffff'}}%\n`
      if ((obj.gradient ?? 'vertical') === 'horizontal') opts.push(`left color=ksfill${idx}`, `right color=ksfillb${idx}`)
      else opts.push(`top color=ksfill${idx}`, `bottom color=ksfillb${idx}`)
    } else opts.push(`fill=ksfill${idx}`)
  }
  if (obj.border_color && obj.border_width > 0) {
    defs += `\\definecolor{ksshape${idx}}{HTML}{${hexArg(obj.border_color) || '000000'}}%\n`
    opts.push(`draw=ksshape${idx}`, `line width=${fmt(obj.border_width)}pt`)
    const st = ({ dashed: 'dashed', dotted: 'dotted' } as Record<string, string>)[obj.style ?? 'solid']
    if (st) opts.push(st)
  }
  if (obj.opacity < 1.0) opts.push(`opacity=${fmt(obj.opacity)}`)
  if (kind.kind === 'rect' && kind.rounded) opts.push('rounded corners=6pt')
  if (obj.rotation) opts.push(`rotate around={${fmt(-obj.rotation)}:${center}}`)
  let body: string
  if (kind.kind === 'ellipse') body = `${center} ellipse [x radius=${xr}, y radius=${yr}]`
  else if (kind.kind === 'rect') body = `${pt(0, 0)} rectangle ${pt(1, 1)}`
  else body = kind.pts.map(([nx, ny]: Pt) => pt(nx, ny)).join(' -- ') + ' -- cycle'
  return [defs, opts.join(', '), body]
}

function serializeShape(obj: SlideShape, idx: number): string {
  const wlen = '\\linewidth'
  const hlen = `${fmt(obj.h)}\\TPVertModule`
  const pt = (nx: number, ny: number) => `(${fmt(nx)}\\linewidth,-${fmt(ny * obj.h)}\\TPVertModule)`
  const center = pt(0.5, 0.5)
  const [defs, opts, body] = shapeTikz(obj, idx, pt, center, '0.5\\linewidth', `${fmt(0.5 * obj.h)}\\TPVertModule`)
  const pic = '\\begin{tikzpicture}\n' + `\\useasboundingbox (0,0) rectangle (${wlen},-${hlen});\n` + `\\path[${opts}] ${body};\n` + '\\end{tikzpicture}'
  return defs + `${tb(obj)}${pic}\n\\end{textblock}`
}

function serializeLineBg(obj: SlideLine, gap: number, idx: number): string {
  const span = 1 - 2 * gap
  const px1 = gap + obj.x * span
  const py1 = gap + obj.y * span
  const px2 = gap + (obj.x + obj.w) * span
  const py2 = gap + (obj.y + obj.h) * span
  const colour = hexArg(obj.color) || '000000'
  const dash = DASH_TIKZ[obj.style ?? 'solid'] ?? ''
  const op = obj.opacity ?? 1.0
  const opacity = op < 1.0 ? `, draw opacity=${fmt(op)}` : ''
  const nw = 'current page.north west'
  return (
    `\\definecolor{ksline${idx}}{HTML}{${colour}}%\n` +
    '\\begin{tikzpicture}[remember picture,overlay]\n' +
    `\\draw[line width=${fmt(obj.width_pt)}pt,color=ksline${idx}${arrowOpts(obj)}${dash}${opacity}] ` +
    `([xshift=${fmt(px1)}\\paperwidth,yshift=-${fmt(py1)}\\paperheight]${nw}) -- ` +
    `([xshift=${fmt(px2)}\\paperwidth,yshift=-${fmt(py2)}\\paperheight]${nw});\n` +
    '\\end{tikzpicture}'
  )
}

function serializeShapeBg(obj: SlideShape, gap: number, idx: number): string {
  const span = 1 - 2 * gap
  const nw = 'current page.north west'
  const pt = (nx: number, ny: number) => {
    const x = gap + (obj.x + nx * obj.w) * span
    const y = gap + (obj.y + ny * obj.h) * span
    return `([xshift=${fmt(x)}\\paperwidth,yshift=-${fmt(y)}\\paperheight]${nw})`
  }
  const center = pt(0.5, 0.5)
  const xr = `${fmt(0.5 * obj.w * span)}\\paperwidth`
  const yr = `${fmt(0.5 * obj.h * span)}\\paperheight`
  const [defs, opts, body] = shapeTikz(obj, idx, pt, center, xr, yr)
  return defs + '\\begin{tikzpicture}[remember picture,overlay]\n' + `\\path[${opts}] ${body};\n` + '\\end{tikzpicture}'
}

function overlayBehind(obj: SlideObject, gap: number, counter: { n: number }): string | null {
  if (obj.type === 'SlideLine') return serializeLineBg(obj, gap, counter.n++)
  if (obj.type === 'SlideShape') return serializeShapeBg(obj, gap, counter.n++)
  return null
}

function masterBackgroundBlock(master: Slide, gap: number, counter: { n: number }): string[] {
  const blocks: string[] = []
  for (const o of master.objects) {
    if (o.type === 'SlideLine') blocks.push(serializeLineBg(o, gap, counter.n++))
    else if (o.type === 'SlideShape') blocks.push(serializeShapeBg(o, gap, counter.n++))
    else if (o.type === 'SlideText') blocks.push(serializeText(o))
    else if (o.type === 'SlideTable') blocks.push(serializeTable(o))
    else if (o.type === 'SlidePicture') blocks.push(serializePicture(o))
  }
  return blocks.filter(Boolean)
}

function overlayObject(obj: SlideObject, counter: { n: number }): string | null {
  switch (obj.type) {
    case 'SlideText':
      return serializeText(obj)
    case 'SlideTable':
      return serializeTable(obj)
    case 'SlideLine':
      return serializeLine(obj, counter.n++)
    case 'SlideShape':
      return serializeShape(obj, counter.n++)
    case 'SlidePicture':
      return serializePicture(obj) || null
    case 'SlideVideo':
      return serializeVideo(obj)
  }
}

function pageNumberMacro(mode: string): string {
  if (mode === 'number') return '\\insertframenumber'
  if (mode === 'of_total') return '\\insertframenumber\\,/\\,\\inserttotalframenumber'
  return ''
}

function pageNumberBlock(mode: string, gap: number): string {
  const inner = pageNumberMacro(mode) || '\\insertframenumber'
  const span = gap < 0.5 ? 1 / (1 - 2 * gap) : 1.0
  const off = gap < 0.5 ? -gap / (1 - 2 * gap) : 0.0
  const x = off + 0.78 * span
  const y = off + 0.955 * span
  const w = 0.2 * span
  return `\\begin{textblock}{${fmt(w)}}(${fmt(x)},${fmt(y)})\n` + `\\raggedleft{\\small\\color{black!55}${inner}}\n` + '\\end{textblock}'
}

const NAV_SYMBOLS =
  '\\insertslidenavigationsymbol\\insertframenavigationsymbol' +
  '\\insertsubsectionnavigationsymbol\\insertsectionnavigationsymbol' +
  '\\insertdocnavigationsymbol\\insertbackfindforwardnavigationsymbol'

function navSymbolsBlock(gap: number): string {
  const span = gap < 0.5 ? 1 / (1 - 2 * gap) : 1.0
  const off = gap < 0.5 ? -gap / (1 - 2 * gap) : 0.0
  const x = off + 0.5 * span
  const y = off + 0.93 * span
  const w = 0.48 * span
  return `\\begin{textblock}{${fmt(w)}}(${fmt(x)},${fmt(y)})\n` + `\\raggedleft{${NAV_SYMBOLS}}\n` + '\\end{textblock}'
}

const OBJ_LABEL: Record<SlideObject['type'], string> = {
  SlideText: 'text box',
  SlidePicture: 'picture',
  SlideTable: 'table',
  SlideLine: 'line / arrow',
  SlideShape: 'shape',
  SlideVideo: 'video',
}
const objLabel = (o: SlideObject) => OBJ_LABEL[o.type] ?? 'object'

// ------------------------------------------------------------------ slides

function serializeSlide(
  slide: Slide, plain: boolean, gap: number, counter: { n: number }, pageNumber: string, navSymbols: boolean, index: number, master: Slide | null,
): string {
  const opts = (plain ? 'plain,' : '') + 't'
  const bar = '% ' + '='.repeat(70)
  const head = `% Slide ${index + 1}` + (slide.title ? ` - ${slide.title}` : '')
  const isFlow = (o: SlideObject) => (o.locked ?? true) && o.type !== 'SlideLine' && o.type !== 'SlideShape' && o.type !== 'SlideVideo'
  const objs = slide.objects
  const firstFlow = objs.findIndex(isFlow)
  const behind = firstFlow >= 0 ? objs.filter((o, k) => k < firstFlow && (o.type === 'SlideLine' || o.type === 'SlideShape')) : []
  const behindSet = new Set(behind)

  const bg = hexArg(blendOverWhite(slide.bg, slide.bg_alpha))
  let bgCanvas: string[] = []
  if (bg) {
    const cname = `ksbg${index}`
    bgCanvas = [`\\definecolor{${cname}}{HTML}{${bg}}`, `\\setbeamercolor{background canvas}{bg=${cname}}`, '\\setbeamertemplate{background canvas}[default]']
  }
  const masterBlocks = master ? masterBackgroundBlock(master, gap, counter) : []
  const parts = [bar, head, bar]
  const tmplParts = [...masterBlocks]
  for (const o of behind) {
    const blk = overlayBehind(o, gap, counter)
    if (blk) tmplParts.push(blk)
  }
  const scoped = !!(bgCanvas.length || tmplParts.length)
  if (scoped) {
    parts.push('{%  scoped: slide background colour + behind-content layer', ...bgCanvas)
    if (tmplParts.length) parts.push('\\setbeamertemplate{background}{%', ...tmplParts, '}')
  }
  parts.push(`\\begin{frame}[${opts}]`)
  if (slide.title) parts.push(`  \\frametitle{${slide.title}}`)
  let i = 0
  while (i < objs.length) {
    if (behindSet.has(objs[i])) {
      i++
      continue
    }
    if (isFlow(objs[i])) {
      const run: SlideObject[] = []
      while (i < objs.length && isFlow(objs[i])) run.push(objs[i++])
      const flow = serializeFlow(run)
      if (flow.length) parts.push('\n  % beamer-placed content (flows in the frame body)', ...flow)
    } else {
      const block = overlayObject(objs[i], counter)
      if (block) parts.push(`\n  % ${objLabel(objs[i])} (free-positioned)`, block)
      i++
    }
  }
  if (navSymbols && plain) parts.push('\n  % navigation symbols (bottom-right)', navSymbolsBlock(gap))
  if (pageNumber && pageNumber !== 'none' && plain) parts.push('\n  % slide number (plain frame — no footline)', pageNumberBlock(pageNumber, gap))
  parts.push('\\end{frame}')
  if (scoped) parts.push('}')
  return parts.join('\n')
}

function headerFooterLines(deck: Deck): string[] {
  const lines: string[] = []
  const { header } = deck
  const fl = deck.foot_left
  const fc = deck.foot_center
  let fr = deck.foot_right
  let num = pageNumberMacro(deck.page_number ?? 'none')
  if (deck.theme_spec?.enabled && deck.theme_spec.footer_bar) num = ''
  if (num && !deck.plain_frames) fr = fr ? `${fr}\\quad ${num}` : num
  if (header) {
    lines.push(
      '\\setbeamertemplate{headline}{%',
      '\\begin{beamercolorbox}[wd=\\paperwidth,ht=2.6ex,dp=1.2ex,leftskip=1.5ex,rightskip=1.5ex]{section in head/foot}%',
      `${header}\\hfill\\end{beamercolorbox}}`,
    )
  }
  if (fl || fc || fr) {
    lines.push(
      '\\setbeamertemplate{footline}{%',
      '\\leavevmode\\hbox{%',
      `\\begin{beamercolorbox}[wd=.333\\paperwidth,ht=2.5ex,dp=1.2ex,leftskip=1.5ex]{author in head/foot}${fl}\\end{beamercolorbox}%`,
      `\\begin{beamercolorbox}[wd=.334\\paperwidth,ht=2.5ex,dp=1.2ex,center]{title in head/foot}${fc}\\end{beamercolorbox}%`,
      `\\begin{beamercolorbox}[wd=.333\\paperwidth,ht=2.5ex,dp=1.2ex,rightskip=1.5ex]{date in head/foot}\\hfill ${fr}\\end{beamercolorbox}}%`,
      '\\vskip0pt}',
    )
  }
  return lines
}

/** The beamer LaTeX for a presentation (the desktop's serialize_deck). */
export function serializeDeck(deck: Deck, options: SerializeOptions = {}): string {
  const saved = OPTS
  OPTS = options
  try {
    return serializeDeckInner(deck)
  } finally {
    OPTS = saved
  }
}

function serializeDeckInner(deck: Deck): string {
  const aspect = deck.aspect in ASPECT_OPTS ? ASPECT_OPTS[deck.aspect] : 'aspectratio=169'
  const classOpts = aspect ? `[${aspect}]` : ''
  const customSize = deck.page_w_cm > 0 && deck.page_h_cm > 0
  const bar = '% ' + '='.repeat(70)
  const lines = [
    bar,
    '% Beamer presentation - generated by KherveSlide.',
    '% Edit freely; the source is regenerated when you change a slide.',
    bar,
    `\\documentclass${classOpts}{beamer}`,
    '',
    '% --- theme & packages ---',
  ]
  if (customSize) lines.push('\\usepackage{geometry}', `\\geometry{papersize={${fmt(deck.page_w_cm)}cm,${fmt(deck.page_h_cm)}cm}}`)
  lines.push(`\\usetheme{${deck.theme || 'default'}}`)
  if (deck.color_theme) lines.push(`\\usecolortheme{${deck.color_theme}}`)
  lines.push(...themeSpecLines(deck.theme_spec))
  lines.push('\\usepackage{lmodern}')
  lines.push(...fontFamilyLines(deck.theme_spec))
  const all = [...deck.slides.flatMap((s) => s.objects), ...(deck.master?.objects ?? [])]
  const texts = [
    ...all.map((o) => (o.type === 'SlideText' ? o.text || '' : '')),
    ...all.flatMap((o) => (o.type === 'SlideTable' ? o.rows.flat() : [])),
  ].join(' ')
  if (texts.includes('\\ce{') || texts.includes('\\pu{')) lines.push('\\usepackage[version=4]{mhchem}')
  if (texts.includes('\\chemfig')) lines.push('\\usepackage{chemfig}')
  if (all.some((o) => o.type === 'SlideVideo' && !o.poster)) lines.push('\\usepackage{amssymb}')
  const needsTikz = all.some((o) => o.type === 'SlideLine' || o.type === 'SlideShape' || hasFrame(o))
  const needsOpacity = all.some((o) => o.type === 'SlidePicture' && o.opacity < 1.0)
  const needsShadow = all.some((o) => !!(o as { shadow?: boolean }).shadow)
  const logo = logoLines(deck.theme_spec)
  if (needsTikz || needsOpacity || logo.length) lines.push('\\usepackage{tikz}')
  if (needsTikz) {
    lines.push('\\usetikzlibrary{arrows.meta}')
    if (needsShadow) lines.push('\\usetikzlibrary{shadows}')
  }
  if (all.some((o) => o.type === 'SlidePicture' && hasCrop(o))) lines.push('\\usepackage{adjustbox}')
  if (all.some((o) => o.type === 'SlideTable')) {
    lines.push('\\usepackage{colortbl}')
    for (const [name, hexv] of [
      ['ksTblHead', TABLE_HEADER_BG], ['ksTblHeadFg', TABLE_HEADER_FG], ['ksTblRule', TABLE_RULE], ['ksTblCap', TABLE_CAPTION_FG],
    ] as const) {
      lines.push(`\\definecolor{${name}}{HTML}{${hexArg(hexv)}}`)
    }
  }
  lines.push('\\usepackage[absolute,overlay]{textpos}', '\\usepackage{graphicx}')
  const g = Math.max(0.0, Math.min(0.45, deck.gap))
  const span = fmt(1 - 2 * g)
  lines.push(
    `\\setlength{\\TPHorizModule}{${span}\\paperwidth}`,
    `\\setlength{\\TPVertModule}{${span}\\paperheight}`,
    `\\textblockorigin{${fmt(g)}\\paperwidth}{${fmt(g)}\\paperheight}`,
  )
  lines.push('\\setbeamerfont{itemize/enumerate subbody}{size=\\relax}', '\\setbeamerfont{itemize/enumerate subsubbody}{size=\\relax}')
  if (!(deck.nav_symbols && !deck.plain_frames)) lines.push('\\setbeamertemplate{navigation symbols}{}')
  lines.push(...headerFooterLines(deck))
  lines.push(...logo)
  if (deck.title) lines.push(`\\title{${deck.title}}`)
  if (deck.author) lines.push(`\\author{${deck.author}}`)
  lines.push('', '\\begin{document}')
  const counter = { n: 0 }
  deck.slides.forEach((slide, i) => {
    if (slide.hidden) return
    lines.push('')
    lines.push(serializeSlide(slide, deck.plain_frames, g, counter, deck.page_number ?? 'none', deck.nav_symbols, i, deck.master ?? null))
  })
  lines.push('', '\\end{document}')
  return lines.join('\n') + '\n'
}

/**
 * The presentation with every slide's own objects removed (the desktop's
 * serialize_backdrop without its bullet probes): what the beamer theme draws
 * around the boxes — title bars, head/foot lines, numbers, background and the
 * master. Page i of its PDF is the empty themed slide i, hidden slides included.
 */
export function serializeBackdrop(deck: Deck, options: SerializeOptions = {}): string {
  const slides = deck.slides.map((s) => makeSlide({ title: s.title, bg: s.bg, bg_alpha: s.bg_alpha, free: s.free }))
  const tex = serializeDeck({ ...deck, slides }, options)
  return tex.replace(/\\end\{frame\}/g, '  \\mbox{}\n\\end{frame}')
}
