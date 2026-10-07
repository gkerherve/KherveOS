// Templates (whole new presentations), slide layouts and theme kits, from the
// desktop's templates.py and theme_kit.py. No DOM: the Node tests load it.

import { makeDeck, makeObject, makeSlide, makeThemeSpec, type Deck, type Slide, type SlideText, type ThemeSpec } from './model.ts'

type TextFields = Partial<Omit<SlideText, 'type'>>

function title(text: string, f: TextFields = {}): SlideText {
  return makeObject('SlideText', { x: 0.1, y: 0.32, w: 0.8, h: 0.18, text, font_pt: 40, align: 'center', bold: true, color: '#1A1A1A', ...f })
}
function body(text: string, f: TextFields = {}): SlideText {
  return makeObject('SlideText', { x: 0.08, y: 0.28, w: 0.84, h: 0.5, text, font_pt: 22, align: 'left', ...f })
}
const text = (f: TextFields) => makeObject('SlideText', f)
const picture = (x: number, y: number, w: number, h: number, locked = false) => makeObject('SlidePicture', { x, y, w, h, path: '', locked })

const POINTS = '\\begin{itemize}\n  \\item First point\n  \\item Second point\n\\end{itemize}'
const PROS_CONS = '\\begin{itemize}\n  \\item Pros\n  \\item Cons\n\\end{itemize}'
const heading = (t = 'Heading') => title(t, { x: 0.06, y: 0.06, w: 0.88, h: 0.12, font_pt: 32, align: 'left' })
const titleBlock = () => [
  title('Presentation Title', { y: 0.36, font_pt: 44 }),
  text({ x: 0.1, y: 0.56, w: 0.8, h: 0.1, text: 'Subtitle', font_pt: 24, align: 'center', color: '#555555' }),
  text({ x: 0.1, y: 0.78, w: 0.8, h: 0.08, text: 'Author \\textbar{} Date', font_pt: 18, align: 'center', color: '#777777' }),
]
const freeHeading = () => text({ x: 0.06, y: 0.05, w: 0.88, h: 0.1, text: 'Heading', font_pt: 30, bold: true, align: 'left', locked: false })

/** New presentation ▸ template name → a fresh deck (the desktop's built-in templates). */
export const TEMPLATES: Record<string, () => Deck> = {
  Blank: () => makeDeck({ slides: [makeSlide()], theme: 'default', aspect: '169', template: 'Blank' }),
  'Title slide': () =>
    makeDeck({
      title: 'Presentation title', author: 'Author', theme: 'Madrid', aspect: '169', template: 'Title slide',
      slides: [makeSlide({ objects: titleBlock() })],
    }),
  'Title + content': () =>
    makeDeck({
      theme: 'Madrid', aspect: '169', template: 'Title + content',
      slides: [
        makeSlide({ objects: [title('Presentation Title', { y: 0.36, font_pt: 44 }), text({ x: 0.1, y: 0.56, w: 0.8, h: 0.1, text: 'Subtitle', font_pt: 24, align: 'center', color: '#555555' })] }),
        makeSlide({ objects: [heading(), body(POINTS, { y: 0.26 })] }),
      ],
    }),
  'Two columns': () =>
    makeDeck({
      theme: 'default', aspect: '169', template: 'Two columns',
      slides: [makeSlide({ objects: [heading('Two columns'), body('Left column text.', { x: 0.06, y: 0.26, w: 0.42, h: 0.6 }), body('Right column text.', { x: 0.52, y: 0.26, w: 0.42, h: 0.6 })] })],
    }),
  'Picture + text': () =>
    makeDeck({
      theme: 'default', aspect: '169', template: 'Picture + text',
      slides: [makeSlide({ objects: [heading('Picture and text'), picture(0.06, 0.26, 0.42, 0.6), body('Describe the picture here.', { x: 0.52, y: 0.26, w: 0.42, h: 0.6 })] })],
    }),
  'Section divider': () =>
    makeDeck({
      theme: 'Madrid', aspect: '169', template: 'Section divider',
      slides: [makeSlide({ bg: '#1F3A5F', objects: [title('Section', { y: 0.42, font_pt: 48, color: '#FFFFFF' })] })],
    }),
}

export function newFromTemplate(name: string): Deck {
  return (TEMPLATES[name] ?? TEMPLATES.Blank)()
}

/** Slide ▸ layouts: a fresh slide whose objects replace a page's content. */
export const SLIDE_LAYOUTS: Record<string, () => Slide> = {
  Blank: () => makeSlide(),
  Title: () => makeSlide({ objects: titleBlock() }),
  'Title only': () => makeSlide({ objects: [heading()] }),
  'Title + content': () => makeSlide({ objects: [heading(), body(POINTS, { y: 0.26 })] }),
  'Two columns': () =>
    makeSlide({ objects: [heading(), body('Left column text.', { x: 0.06, y: 0.26, w: 0.42, h: 0.6 }), body('Right column text.', { x: 0.52, y: 0.26, w: 0.42, h: 0.6 })] }),
  'Three columns': () =>
    makeSlide({
      objects: [
        heading(), body('Column one.', { x: 0.05, y: 0.26, w: 0.28, h: 0.6 }), body('Column two.', { x: 0.36, y: 0.26, w: 0.28, h: 0.6 }),
        body('Column three.', { x: 0.67, y: 0.26, w: 0.28, h: 0.6 }),
      ],
    }),
  Comparison: () =>
    makeSlide({
      objects: [
        title('Comparison', { x: 0.06, y: 0.06, w: 0.88, h: 0.12, font_pt: 32, align: 'left' }),
        text({ x: 0.06, y: 0.24, w: 0.42, h: 0.08, text: 'Option A', font_pt: 22, bold: true }),
        text({ x: 0.52, y: 0.24, w: 0.42, h: 0.08, text: 'Option B', font_pt: 22, bold: true }),
        body(PROS_CONS, { x: 0.06, y: 0.34, w: 0.42, h: 0.5 }), body(PROS_CONS, { x: 0.52, y: 0.34, w: 0.42, h: 0.5 }),
      ],
    }),
  'Picture + text': () => makeSlide({ objects: [heading(), picture(0.06, 0.26, 0.42, 0.6), body('Describe the picture here.', { x: 0.52, y: 0.26, w: 0.42, h: 0.6 })] }),
  'Picture left + bullets': () => makeSlide({ objects: [heading(), picture(0.06, 0.26, 0.42, 0.6), body(POINTS, { x: 0.52, y: 0.26, w: 0.42, h: 0.6 })] }),
  'Two images + text': () =>
    makeSlide({
      objects: [freeHeading(), picture(0.06, 0.2, 0.4, 0.34), picture(0.06, 0.58, 0.4, 0.34), text({ x: 0.52, y: 0.2, w: 0.42, h: 0.72, locked: false, text: 'Describe the pictures here.', font_pt: 20 })],
    }),
  'Text + two images': () =>
    makeSlide({
      objects: [freeHeading(), text({ x: 0.06, y: 0.2, w: 0.42, h: 0.72, locked: false, text: 'Describe the pictures here.', font_pt: 20 }), picture(0.54, 0.2, 0.4, 0.34), picture(0.54, 0.58, 0.4, 0.34)],
    }),
  'Three pictures': () => makeSlide({ objects: [freeHeading(), picture(0.04, 0.24, 0.29, 0.6), picture(0.355, 0.24, 0.29, 0.6), picture(0.67, 0.24, 0.29, 0.6)] }),
  'Full picture': () => makeSlide({ objects: [title('Heading', { x: 0.06, y: 0.04, w: 0.88, h: 0.1, font_pt: 26, align: 'left' }), picture(0.08, 0.2, 0.84, 0.72)] }),
  Quote: () =>
    makeSlide({
      objects: [
        text({ x: 0.12, y: 0.34, w: 0.76, h: 0.3, text: "\\textit{``A memorable quote goes here.''}", font_pt: 30, align: 'center' }),
        text({ x: 0.12, y: 0.66, w: 0.76, h: 0.08, text: '— Attribution', font_pt: 18, align: 'center', color: '#666666' }),
      ],
    }),
  'Section divider': () => makeSlide({ bg: '#1F3A5F', objects: [title('Section', { y: 0.42, font_pt: 48, color: '#FFFFFF' })] }),
}

export function slideLayout(name: string): Slide {
  return (SLIDE_LAYOUTS[name] ?? SLIDE_LAYOUTS.Blank)()
}

// ------------------------------------------------------------------ bullets (AI tools)

/** An itemize of plain lines; a line starting with "- " is a sub-item (the desktop examples' _items). */
export function itemize(lines: string[], enumerate = false): string {
  const env = enumerate ? 'enumerate' : 'itemize'
  const out = [`\\begin{${env}}`]
  let sub = false
  for (const line of lines) {
    if (line.startsWith('- ')) {
      if (!sub) out.push('  \\begin{itemize}')
      sub = true
      out.push(`    \\item ${line.slice(2)}`)
    } else {
      if (sub) out.push('  \\end{itemize}')
      sub = false
      out.push(`  \\item ${line}`)
    }
  }
  if (sub) out.push('  \\end{itemize}')
  out.push(`\\end{${env}}`)
  return out.join('\n')
}

/** The bullet lines of a list text ("- " marks sub-items), or null when it is not a list. */
export function listLines(src: string): string[] | null {
  if (!/\\begin\{(itemize|enumerate)\}/.test(src)) return null
  const out: string[] = []
  let depth = 0
  for (const raw of src.split('\n')) {
    const s = raw.trim()
    if (/^\\begin\{(itemize|enumerate)\}/.test(s)) depth++
    else if (/^\\end\{(itemize|enumerate)\}/.test(s)) depth--
    else if (s.startsWith('\\item')) out.push((depth > 1 ? '- ' : '') + s.slice(5).trim())
    else if (s && out.length) out[out.length - 1] += ' ' + s
  }
  return out
}

/** The text box holding a slide's bullet list. */
export function bulletBox(s: Slide): SlideText | undefined {
  return s.objects.find((o): o is SlideText => o.type === 'SlideText' && listLines(o.text) !== null)
}

export function bulletsOf(s: Slide): string[] {
  const box = bulletBox(s)
  return box ? (listLines(box.text) ?? []) : []
}

/** A slide with a frame title and a bullet list (the AI's add_slide), inserted at `at` (default: the end). */
export function addSlideFromBullets(deck: Deck, heading: string, bullets: string[], at = deck.slides.length): Slide {
  const objects = bullets.length ? [makeObject('SlideText', { x: 0.06, y: 0.2, w: 0.88, h: 0.7, text: itemize(bullets), font_pt: 20 })] : []
  const slide = makeSlide({ title: heading, objects })
  deck.slides.splice(Math.max(0, Math.min(at, deck.slides.length)), 0, slide)
  return slide
}

// ------------------------------------------------------------------ theme kits (theme_kit.py)

export interface ThemeKit {
  name: string
  primary: string
  accent: string
  text: string
  background: string
  title_text: string
  title_style: 'bar' | 'plain' | 'underline'
  footer_style: 'bar' | 'line' | 'none'
  logo: string
  logo_corner: string
  logo_size: number
  font: string
  bullets: string
}

export const TITLE_STYLES: Record<string, string> = { bar: 'Coloured bar across the top', plain: 'Coloured title, no bar', underline: 'Title with a line under it' }
export const FOOTER_STYLES: Record<string, string> = { bar: 'Coloured bar: author · title · slide number', line: 'A thin coloured line', none: 'Nothing' }
export const BULLET_STYLES: Record<string, string> = { '': 'Theme default (triangle)', ball: 'Ball', circle: 'Circle', square: 'Square', triangle: 'Triangle' }

function kit(name: string, f: Partial<ThemeKit> = {}): ThemeKit {
  return {
    name, primary: '#1F4E79', accent: '', text: '#212121', background: '#FFFFFF', title_text: '#FFFFFF', title_style: 'bar', footer_style: 'bar',
    logo: '', logo_corner: 'tr', logo_size: 0.12, font: '', bullets: '', ...f,
  }
}

/** Ready-made starting points (the university ones only borrow the institution's main colour). */
export const THEME_PRESETS: ThemeKit[] = [
  kit('Clean blue', { primary: '#1F4E79' }),
  kit('Imperial-style navy', { primary: '#003E74', accent: '#0091D4', footer_style: 'line', logo_corner: 'tr' }),
  kit('UCL-style purple', { primary: '#500778', accent: '#AC145A', title_style: 'underline', footer_style: 'line', logo_corner: 'tr' }),
  kit('Oxford-style blue', { primary: '#002147', accent: '#A79D96', logo_corner: 'tr' }),
  kit('Cambridge-style teal', { primary: '#0E7D7D', accent: '#85B09A', title_style: 'plain' }),
  kit('Edinburgh-style', { primary: '#041E42', accent: '#C8102E', footer_style: 'line' }),
  kit('Forest green', { primary: '#2E6B30', footer_style: 'line' }),
  kit('Crimson', { primary: '#9E1B32' }),
  kit('Minimal black & white', { primary: '#000000', title_style: 'underline', footer_style: 'none' }),
  kit('Dark', { primary: '#7FB2FF', text: '#E6EAF2', background: '#1B2233', title_text: '#0B1020', footer_style: 'line' }),
]

/** Mix `hex` with white (0 = the colour, 1 = white). */
export function tint(hex: string, amount: number): string {
  const h = (hex || '').replace(/^#/, '')
  if (h.length !== 6) return ''
  const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  if (n.some(Number.isNaN)) return ''
  return '#' + n.map((c) => Math.round(c + (255 - c) * amount).toString(16).toUpperCase().padStart(2, '0')).join('')
}

export function kitToSpec(k: ThemeKit): ThemeSpec {
  const accent = k.accent || k.primary
  const bar = k.title_style === 'bar'
  return makeThemeSpec({
    enabled: true,
    structure: k.primary,
    text_fg: k.text,
    canvas_bg: k.background.toUpperCase() !== '#FFFFFF' ? k.background : '',
    title_fg: bar ? k.title_text : k.primary,
    title_bg: bar ? k.primary : '',
    block_bg: tint(k.primary, 0.82),
    font_family: k.font,
    bullets: k.bullets,
    title_rule: k.title_style === 'underline',
    footline_rule: k.footer_style === 'line',
    rule_color: accent,
    rule_width: 1.5,
    footer_bar: k.footer_style === 'bar',
    logo: k.logo,
    logo_corner: k.logo_corner,
    logo_size: k.logo_size,
  })
}

/** Apply a kit to the deck: the default beamer theme with the kit's spec on top. */
export function applyKit(deck: Deck, k: ThemeKit) {
  deck.theme = 'default'
  deck.color_theme = ''
  deck.theme_spec = kitToSpec(k)
}

/** Best-effort reverse of kitToSpec, so the theme dialog opens on the current custom theme. */
export function kitFromSpec(spec: ThemeSpec, name = 'My theme'): ThemeKit {
  const k = kit(name)
  if (!spec?.enabled) return k
  k.primary = spec.title_bg || spec.structure || k.primary
  k.accent = spec.rule_color !== k.primary ? spec.rule_color : ''
  k.text = spec.text_fg || k.text
  k.background = spec.canvas_bg || '#FFFFFF'
  if (spec.title_bg) {
    k.title_style = 'bar'
    k.title_text = spec.title_fg || '#FFFFFF'
  } else k.title_style = spec.title_rule ? 'underline' : 'plain'
  k.footer_style = spec.footer_bar ? 'bar' : spec.footline_rule ? 'line' : 'none'
  k.font = spec.font_family
  k.bullets = spec.bullets
  k.logo = spec.logo
  k.logo_corner = spec.logo_corner || 'tr'
  k.logo_size = spec.logo_size || 0.12
  return k
}
