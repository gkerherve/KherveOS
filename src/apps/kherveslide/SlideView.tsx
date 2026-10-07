// One slide drawn in HTML/SVG, as the PDF will print it: the editing canvas,
// the slide sorter's thumbnails and the slideshow all use this. A slide is laid
// out on a page 720 px high (the desktop's SCENE_H) and scaled to the size
// asked for, so text wraps the same way at every size.

import { memo, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { blendOverWhite, linePath, type BoxFrame, type Deck, type Slide, type SlideLine, type SlideObject, type SlidePicture, type SlideShape, type SlideTable, type SlideText, type SlideVideo } from './model'
import { outline, effectiveShape } from './shapes'
import { inlineHtml, texToHtml } from './texhtml'
import { MONO, SANS, SERIF, TYPEFACES, pageCm, type Look } from './look'
import { effectFilter, useImageUrl, type Media } from './media'
import { BLOCK_ENVS, THEOREM_ENVS } from './serializer'
import 'katex/dist/katex.min.css'

export const PAGE_H = 720

export interface Geometry {
  W: number
  H: number
  /** Pixels per TeX point. */
  pt: number
  /** Pixels per cm. */
  cm: number
  gap: number
  span: number
}

export function geometry(deck: Deck): Geometry {
  const { w, h } = pageCm(deck)
  const H = PAGE_H
  const gap = Math.max(0, Math.min(0.45, deck.gap || 0))
  return { W: (H * w) / h, H, pt: H / ((h * 72.27) / 2.54), cm: H / h, gap, span: 1 - 2 * gap }
}

/** An object's box in page pixels. */
export function boxPx(g: Geometry, o: { x: number; y: number; w: number; h: number }) {
  return { left: (g.gap + o.x * g.span) * g.W, top: (g.gap + o.y * g.span) * g.H, width: o.w * g.span * g.W, height: o.h * g.span * g.H }
}

/** A point given in slide fractions, in page pixels. */
export function ptPx(g: Geometry, x: number, y: number): [number, number] {
  return [(g.gap + x * g.span) * g.W, (g.gap + y * g.span) * g.H]
}

const BLOCK_COLORS: Record<string, string> = {
  block: '#3b5ba9', alertblock: '#b03a3a', exampleblock: '#2e7d4f', theorem: '#3b5ba9', definition: '#3b5ba9', corollary: '#3b5ba9',
  lemma: '#3b5ba9', example: '#2e7d4f', proof: '#6b7280', fact: '#3b5ba9',
}
const THEOREM_LABELS: Record<string, string> = {
  theorem: 'Theorem', definition: 'Definition', corollary: 'Corollary', lemma: 'Lemma', example: 'Example', proof: 'Proof', fact: 'Fact',
}

/** A colour at an opacity (0..1). */
const alpha = (c: string, a: number) => (a >= 1 ? c : `color-mix(in srgb, ${c} ${Math.round(Math.max(0, a) * 100)}%, transparent)`)

function dash(style: string, w: number, pt: number): string | undefined {
  if (style === 'dashed') return `${3 * pt} ${3 * pt}`
  if (style === 'dotted') return `${Math.max(w, 0.4 * pt)} ${2 * pt}`
  return undefined
}

/** A box's fill / border / corners / shadow (text, picture and table frames). */
export function frameStyle(o: BoxFrame, pt: number): CSSProperties {
  const s: CSSProperties = {}
  if (o.fill) {
    const a = o.fill_opacity ?? 1
    s.background = o.fill2
      ? `linear-gradient(${o.gradient === 'horizontal' ? 'to right' : 'to bottom'}, ${alpha(o.fill, a)}, ${alpha(o.fill2, a)})`
      : alpha(o.fill, a)
  }
  if (o.border_color) {
    const w = Math.max(0.2, o.border_width) * pt
    s.outline = `${w}px ${o.border_style === 'dashed' ? 'dashed' : o.border_style === 'dotted' ? 'dotted' : 'solid'} ${o.border_color}`
    s.outlineOffset = -w / 2
  }
  if (o.corner === 'rounded') s.borderRadius = o.corner_radius * pt
  if (o.shadow) s.boxShadow = `${2 * pt}px ${2 * pt}px ${3 * pt}px rgba(0,0,0,.45)`
  return s
}

// ------------------------------------------------------------------ objects

function TextView({ o, g, hidden }: { o: SlideText; g: Geometry; hidden?: boolean }) {
  const html = useMemo(() => texToHtml(o.text), [o.text])
  const fs = o.font_pt * g.pt
  const lead = Math.round(o.font_pt * 1.2) * g.pt
  const framed = !!(o.fill || o.border_color)
  const block = o.block && (BLOCK_ENVS.has(o.block) || THEOREM_ENVS.has(o.block)) ? o.block : ''
  const blockColor = BLOCK_COLORS[block] ?? BLOCK_COLORS.block
  const blockTitle = THEOREM_LABELS[block] ? (o.block_title ? `${THEOREM_LABELS[block]} (${o.block_title})` : THEOREM_LABELS[block]) : o.block_title
  const headH = Math.max(14, fs * 1.45)
  const family = o.font_family === 'rm' ? SERIF : o.font_family === 'tt' ? MONO : o.font_family === 'sf' ? SANS : undefined
  const frame = frameStyle(o, g.pt)
  if (block) frame.background = alpha(blockColor, 0.11)
  return (
    <div className="ks2-obj ks2-text" style={{ ...boxPx(g, o), ...frame }}>
      {block && (
        <div className="ks2-block-head" style={{ background: blockColor, height: headH, fontSize: headH * 0.6 }} dangerouslySetInnerHTML={{ __html: inlineHtml(blockTitle) }} />
      )}
      <div
        className="ks2-body"
        style={{
          fontSize: fs,
          lineHeight: `${lead}px`,
          color: o.color || '#000000',
          fontWeight: o.bold ? 'bold' : undefined,
          fontStyle: o.italic ? 'italic' : undefined,
          textAlign: (o.align as CSSProperties['textAlign']) || 'left',
          fontFamily: family,
          padding: framed && !block ? 3 * g.pt : block ? `${2 * g.pt}px ${4 * g.pt}px` : undefined,
          marginTop: framed || block ? undefined : -(lead - fs) / 2 - 0.05 * fs,
          visibility: hidden ? 'hidden' : undefined,
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

function TableView({ o, g }: { o: SlideTable; g: Geometry }) {
  const rows = o.rows.length ? o.rows : [['']]
  const ncols = Math.max(1, ...rows.map((r) => r.length))
  let grid = o.grid
  if (!o.border && grid === 'all') grid = 'none'
  const rule = `${Math.max(0.1, o.rule_width) * g.pt}px solid ${o.rule_color || '#F4B183'}`
  const cells = useMemo(() => rows.map((r) => [...r, ...Array.from({ length: ncols - r.length }, () => '')].map((c) => inlineHtml(c))), [rows, ncols])
  return (
    <div className="ks2-obj ks2-tablebox" style={{ ...boxPx(g, o), ...frameStyle(o, g.pt) }}>
      <table
        className="ks2-table"
        style={{
          fontSize: o.font_pt * g.pt,
          lineHeight: 1.2,
          color: o.color || '#000',
          borderTop: grid !== 'none' ? rule : undefined,
          borderBottom: grid !== 'none' ? rule : undefined,
          borderLeft: grid === 'all' ? rule : undefined,
          borderRight: grid === 'all' ? rule : undefined,
        }}
      >
        <tbody>
          {cells.map((row, i) => {
            const head = i === 0 && o.header
            const bi = i - (o.header ? 1 : 0)
            const bg = head ? o.header_bg : o.striped && bi % 2 === 1 ? o.stripe_color : undefined
            return (
              <tr key={i} style={{ background: bg, borderTop: i > 0 && (grid === 'all' || grid === 'horizontal') ? rule : undefined }}>
                {row.map((c, j) => (
                  <td
                    key={j}
                    data-ks2-cell={`${i},${j}`}
                    style={{
                      textAlign: (o.align as CSSProperties['textAlign']) || 'left',
                      color: head ? o.header_fg : undefined,
                      fontWeight: head ? 'bold' : undefined,
                      borderLeft: j > 0 && grid === 'all' ? rule : undefined,
                    }}
                    dangerouslySetInnerHTML={{ __html: c || '&nbsp;' }}
                  />
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {o.caption && <div className="ks2-caption" style={{ fontSize: o.font_pt * g.pt * 0.8 }} dangerouslySetInnerHTML={{ __html: inlineHtml(o.caption) }} />}
    </div>
  )
}

let gradientIds = 0

function ShapeView({ o, g }: { o: SlideShape; g: Geometry }) {
  const [gid] = useState(() => `ks2g${++gradientIds}`)
  const b = boxPx(g, o)
  const w = Math.max(1, b.width)
  const h = Math.max(1, b.height)
  const kind = outline(effectiveShape(o))
  const sw = o.border_color && o.border_width > 0 ? o.border_width * g.pt : 0
  const fill = o.fill ? (o.fill2 ? `url(#${gid})` : o.fill) : 'none'
  const common = { fill, stroke: sw ? o.border_color : 'none', strokeWidth: sw, strokeDasharray: sw ? dash(o.style, sw, g.pt) : undefined, strokeLinejoin: 'round' as const }
  let body: ReactNode
  if (kind.kind === 'ellipse') body = <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />
  else if (kind.kind === 'rect') body = <rect x={0} y={0} width={w} height={h} rx={kind.rounded ? 6 * g.pt : 0} {...common} />
  else body = <polygon points={kind.pts.map(([x, y]) => `${x * w},${y * h}`).join(' ')} {...common} />
  return (
    <div className="ks2-obj ks2-shape" style={{ ...b, transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined, opacity: o.opacity < 1 ? o.opacity : undefined }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="visible">
        {o.fill2 && o.fill && (
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2={o.gradient === 'horizontal' ? 1 : 0} y2={o.gradient === 'horizontal' ? 0 : 1}>
              <stop offset="0" stopColor={o.fill} />
              <stop offset="1" stopColor={o.fill2} />
            </linearGradient>
          </defs>
        )}
        {body}
      </svg>
    </div>
  )
}

/** A Stealth arrowhead (TikZ arrows.meta) at `tip`, pointing along (dx, dy). */
function stealth(tip: [number, number], dx: number, dy: number, len: number): string {
  const d = Math.hypot(dx, dy) || 1
  const ux = dx / d
  const uy = dy / d
  const px = -uy
  const py = ux
  const wid = len * 0.45
  const back: [number, number] = [tip[0] - ux * len, tip[1] - uy * len]
  const inset: [number, number] = [tip[0] - ux * len * 0.72, tip[1] - uy * len * 0.72]
  const a: [number, number] = [back[0] + px * wid, back[1] + py * wid]
  const b: [number, number] = [back[0] - px * wid, back[1] - py * wid]
  return [tip, a, inset, b].map(([x, y]) => `${x},${y}`).join(' ')
}

export function linePathD(g: Geometry, o: SlideLine): { d: string; pts: [number, number][] } {
  const pts = linePath(o).map(([x, y]) => ptPx(g, x, y))
  let d = `M${pts[0][0]},${pts[0][1]}`
  if (pts.length > 2) for (let i = 1; i + 2 < pts.length; i += 3) d += ` C${pts[i]} ${pts[i + 1]} ${pts[i + 2]}`
  else d += ` L${pts[1][0]},${pts[1][1]}`
  return { d, pts }
}

function LineView({ o, g, index }: { o: SlideLine; g: Geometry; index?: number }) {
  const { d, pts } = linePathD(g, o)
  const sw = Math.max(0.3, o.width_pt) * g.pt
  const len = 0.24 * Math.max(0.3, o.head_size || 1) * g.cm + sw
  const n = pts.length
  const heads: string[] = []
  if (o.arrow_end) heads.push(stealth(pts[n - 1], pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1], len))
  if (o.arrow_start) heads.push(stealth(pts[0], pts[0][0] - pts[1][0], pts[0][1] - pts[1][1], len))
  return (
    <svg className="ks2-obj ks2-line" width={g.W} height={g.H} style={{ left: 0, top: 0, opacity: o.opacity < 1 ? o.opacity : undefined }} overflow="visible">
      <path d={d} fill="none" stroke={o.color || '#000'} strokeWidth={sw} strokeDasharray={dash(o.style, sw, g.pt)} strokeLinecap="butt" />
      {heads.map((p, i) => (
        <polygon key={i} points={p} fill={o.color || '#000'} />
      ))}
      {index !== undefined && <path className="ks2-hit" d={d} data-ks2-index={index} fill="none" stroke="transparent" strokeWidth={Math.max(sw, 14)} />}
    </svg>
  )
}

function Placeholder({ label, missing }: { label: string; missing?: boolean }) {
  return (
    <div className={`ks2-placeholder${missing ? ' missing' : ''}`}>
      <span>{label}</span>
    </div>
  )
}

function PictureView({ o, g, media }: { o: SlidePicture; g: Geometry; media: Media }) {
  const url = useImageUrl(media, o.path)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const b = boxPx(g, o)
  const cl = Math.max(0, Math.min(0.9, o.crop_l))
  const ct = Math.max(0, Math.min(0.9, o.crop_t))
  const cr = Math.max(0, Math.min(0.9, o.crop_r))
  const cb = Math.max(0, Math.min(0.9, o.crop_b))
  const vw = Math.max(0.05, 1 - cl - cr)
  const vh = Math.max(0.05, 1 - ct - cb)
  let inner: ReactNode
  if (!o.path) inner = <Placeholder label="Double-click to add a picture" />
  else if (!url) inner = <Placeholder label={o.path.split(/[\\/]/).pop() ?? o.path} missing />
  else {
    // The visible (cropped) part fills the box; with keep_aspect it is fitted inside, top-left, as \includegraphics does.
    let w = b.width
    let h = b.height
    if (o.keep_aspect && natural) {
      const ratio = (natural.w * vw) / (natural.h * vh)
      if (w / h > ratio) w = h * ratio
      else h = w / ratio
    }
    const fx: CSSProperties = {}
    const filter = [effectFilter(o, h), o.glow_color && o.glow_size ? `drop-shadow(0 0 ${o.glow_size * Math.min(w, h)}px ${o.glow_color})` : ''].filter(Boolean).join(' ')
    if (filter) fx.filter = filter
    if (o.mask === 'ellipse') fx.clipPath = 'ellipse(50% 50% at 50% 50%)'
    if (o.mask === 'rounded') fx.borderRadius = Math.min(w, h) * 0.12
    if (o.fade) {
      const s = Math.round(o.fade_start * 100)
      const e = Math.round(o.fade_end * 100)
      const dir = { left: 'to right', right: 'to left', top: 'to bottom', bottom: 'to top' }[o.fade]
      const m = dir ? `linear-gradient(${dir}, transparent ${s}%, black ${e}%)` : `radial-gradient(closest-side, black ${100 - e}%, transparent ${100 - s}%)`
      fx.maskImage = m
      fx.WebkitMaskImage = m
    }
    if (o.reflection > 0) (fx as Record<string, unknown>).WebkitBoxReflect = `below 0 linear-gradient(transparent ${Math.round((1 - o.reflection) * 100)}%, rgba(0,0,0,.35))`
    inner = (
      <div className="ks2-crop" style={{ width: w, height: h, ...fx }}>
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
          style={{ width: w / vw, height: h / vh, left: (-cl / vw) * w, top: (-ct / vh) * h }}
        />
      </div>
    )
  }
  return (
    <div
      className="ks2-obj ks2-picture"
      style={{ ...b, ...frameStyle(o, g.pt), transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined, opacity: o.opacity < 1 ? o.opacity : undefined }}
    >
      {inner}
    </div>
  )
}

function VideoView({ o, g, media }: { o: SlideVideo; g: Geometry; media: Media }) {
  const url = useImageUrl(media, o.poster)
  return (
    <div className="ks2-obj ks2-video" style={boxPx(g, o)}>
      {url ? <img src={url} alt="" draggable={false} /> : <div className="ks2-video-face">▶</div>}
      <div className="ks2-video-name">{o.path ? (o.path.split(/[\\/]/).pop() ?? '') : 'No video file'}</div>
    </div>
  )
}

export function ObjectView({ o, g, media, index, hidden }: { o: SlideObject; g: Geometry; media: Media; index?: number; hidden?: boolean }) {
  let el: ReactNode
  switch (o.type) {
    case 'SlideText':
      el = <TextView o={o} g={g} hidden={hidden} />
      break
    case 'SlideTable':
      el = <TableView o={o} g={g} />
      break
    case 'SlideShape':
      el = <ShapeView o={o} g={g} />
      break
    case 'SlideLine':
      return <LineView o={o} g={g} index={index} />
    case 'SlidePicture':
      el = <PictureView o={o} g={g} media={media} />
      break
    case 'SlideVideo':
      el = <VideoView o={o} g={g} media={media} />
      break
  }
  return (
    <div className="ks2-objwrap" data-ks2-index={index}>
      {el}
    </div>
  )
}

// ------------------------------------------------------------------ the theme around the boxes

function fillNumber(s: string, n: number, total: number): string {
  return s.replace('#/N', `${n} / ${total}`).replace('#', String(n))
}

function Furniture({ deck, slide, g, look, number, total, media }: { deck: Deck; slide: Slide; g: Geometry; look: Look; number: number; total: number; media: Media }) {
  const logoUrl = useImageUrl(media, look.logo?.path ?? '')
  const headH = look.head ? look.head.h * g.H : look.header ? 0.035 * g.H : 0
  const sideW = look.side ? look.side.w * g.W : 0
  const left = look.side?.left ? sideW : 0
  const right = look.side && !look.side.left ? sideW : 0
  const titleH = look.titlePt * g.pt * 2.1
  const footH = 0.037 * g.H
  const foot = look.footer
  const tiny = 5.5 * g.pt
  return (
    <>
      {look.head && <div className="ks2-band" style={{ top: 0, left: 0, right: 0, height: headH, background: look.head.bg }} />}
      {look.header && (
        <div className="ks2-band ks2-headtext" style={{ top: 0, left: 0, right: 0, height: 0.035 * g.H, background: look.header.bg, color: look.header.fg, fontSize: tiny }} dangerouslySetInnerHTML={{ __html: inlineHtml(look.header.text) }} />
      )}
      {look.side && (
        <div className="ks2-band ks2-side" style={{ top: 0, bottom: 0, width: sideW, [look.side.left ? 'left' : 'right']: 0, background: look.side.bg, color: look.side.fg, fontSize: 7 * g.pt }}>
          <div dangerouslySetInnerHTML={{ __html: inlineHtml(deck.title) }} />
          <div style={{ opacity: 0.8, fontSize: '0.85em' }} dangerouslySetInnerHTML={{ __html: inlineHtml(deck.author) }} />
        </div>
      )}
      {slide.title && (
        <div
          className="ks2-frametitle"
          style={{
            top: headH,
            left,
            right,
            height: titleH,
            paddingLeft: 0.6 * g.cm,
            background: look.titleBar?.bg,
            color: look.titleBar ? look.titleBar.fg : look.titleFg,
            fontSize: look.titlePt * g.pt,
            fontWeight: look.titleBold ? 'bold' : undefined,
          }}
        >
          <span dangerouslySetInnerHTML={{ __html: inlineHtml(slide.title) }} />
          {look.titleRule && <div className="ks2-titlerule" style={{ left: 0.6 * g.cm, right: 0.6 * g.cm, height: look.titleRule.width * g.pt, background: look.titleRule.color }} />}
        </div>
      )}
      {foot.kind === 'line' && <div className="ks2-band" style={{ left: 0, right: 0, bottom: 0, height: foot.width * g.pt, background: foot.color }} />}
      {foot.kind === 'bar' && (
        <div className="ks2-foot" style={{ height: footH, background: foot.bg, color: foot.fg, fontSize: tiny }}>
          <span dangerouslySetInnerHTML={{ __html: inlineHtml(foot.left) }} />
          <span dangerouslySetInnerHTML={{ __html: inlineHtml(foot.center) }} />
          <span>{fillNumber(foot.right, number, total)}</span>
        </div>
      )}
      {foot.kind === 'three' && (
        <div className="ks2-foot three" style={{ height: footH, fontSize: tiny }}>
          {[foot.left, foot.center, fillNumber(foot.right, number, total)].map((t, i) => (
            <span key={i} style={{ background: foot.bgs[i], color: foot.fgs[i] }} dangerouslySetInnerHTML={{ __html: inlineHtml(t) }} />
          ))}
        </div>
      )}
      {look.pageNumber && (
        <div className="ks2-pagenum" style={{ right: 0.02 * g.W, bottom: 0.012 * g.H, fontSize: 10 * g.pt }}>
          {fillNumber(look.pageNumber, number, total)}
        </div>
      )}
      {look.logo && logoUrl && (
        <img
          className="ks2-logo"
          src={logoUrl}
          alt=""
          style={{
            height: Math.max(0.03, Math.min(0.4, look.logo.size)) * g.H,
            [look.logo.corner[1] === 'r' ? 'right' : 'left']: 0.025 * g.H,
            [look.logo.corner[0] === 't' ? 'top' : 'bottom']: (look.logo.corner[0] === 'b' && look.logo.low ? 0.07 : 0.025) * g.H,
          }}
        />
      )}
    </>
  )
}

// ------------------------------------------------------------------ a slide

export interface SlideViewProps {
  deck: Deck
  slide: Slide
  look: Look
  media: Media
  /** Display width in px. */
  width: number
  /** The compiled theme backdrop of this page, when there is one. */
  backdrop?: string | null
  /** Draw the master slide's objects behind (default true; off while editing the master itself). */
  master?: boolean
  /** Interactive: objects carry data-ks2-index for the editor. */
  interactive?: boolean
  /** Objects whose text is not drawn (being edited in place). */
  hiddenText?: number
  children?: ReactNode
  className?: string
}

/** The slide's number in the PDF (hidden slides are left out). */
export function frameNumber(deck: Deck, slide: Slide): { number: number; total: number } {
  const shown = deck.slides.filter((s) => !s.hidden)
  const i = shown.indexOf(slide)
  return { number: i < 0 ? deck.slides.indexOf(slide) + 1 : i + 1, total: shown.length }
}

function SlideViewImpl({ deck, slide, look, media, width, backdrop, master = true, interactive, hiddenText, children, className }: SlideViewProps) {
  const g = useMemo(() => geometry(deck), [deck])
  const scale = width / g.W
  const { number, total } = frameNumber(deck, slide)
  const bg = slide.bg ? blendOverWhite(slide.bg, slide.bg_alpha) : look.background
  const family = look.typeface && TYPEFACES[look.typeface] ? TYPEFACES[look.typeface] : look.serif ? SERIF : SANS
  const pageStyle = {
    width: g.W,
    height: g.H,
    transform: `scale(${scale})`,
    background: backdrop ? '#fff' : bg,
    fontFamily: family,
    '--ks2-structure': look.structure,
    '--ks2-pt': `${g.pt}px`,
    '--ks2-sf': look.serif ? SERIF : SANS,
  } as CSSProperties
  return (
    <div className={`ks2-slide ${className ?? ''}`} style={{ width, height: g.H * scale }}>
      <div className={`ks2-page${interactive ? ' interactive' : ''}`} data-bullets={look.bullets} style={pageStyle}>
        {backdrop ? (
          <img className="ks2-backdrop" src={backdrop} alt="" draggable={false} />
        ) : (
          <>
            {master && deck.master.objects.map((o, i) => <ObjectView key={`m${i}`} o={o} g={g} media={media} />)}
            <Furniture deck={deck} slide={slide} g={g} look={look} number={number} total={total} media={media} />
          </>
        )}
        {slide.objects.map((o, i) => (
          <ObjectView key={i} o={o} g={g} media={media} index={interactive ? i : undefined} hidden={hiddenText === i} />
        ))}
        {children}
      </div>
    </div>
  )
}

export const SlideView = memo(SlideViewImpl)
