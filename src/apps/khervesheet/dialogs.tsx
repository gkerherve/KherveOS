// KherveSheet's own dialogs, over the window (the OS dialogs answer the
// simple questions): Format Cells, colours, the AutoFilter list, Find and
// Replace, a =PY cell's output, equations and drop-down lists.

import katex from 'katex'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import type { Book } from './book'
import { PALETTE } from './colors'
import { NUMBER_FORMATS, a1, key, keyCol, keyRow, patchFmt, type Border, type Fmt, type Sheet } from './model'
import { filterValues, formatCells, formatTargets, setFilterKeep } from './ops'

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  return (
    <div className="ks-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`ks-dialog${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
        }}
      >
        <div className="ks-dialog-head">
          <span>{title}</span>
          <button className="k-icon-btn" title="Close" aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="ks-dialog-body">{children}</div>
        {footer && <div className="ks-dialog-foot">{footer}</div>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- colours

export function Swatches({ value, onPick, allowNone, noneLabel = 'No colour' }: { value?: string | null; onPick: (c: string | null) => void; allowNone?: boolean; noneLabel?: string }) {
  return (
    <div className="ks-swatches">
      {allowNone && (
        <button className="ks-swatch-none" onClick={() => onPick(null)}>
          {noneLabel}
        </button>
      )}
      {PALETTE.map((row, i) => (
        <div key={i} className="ks-swatch-row">
          {row.map((c) => (
            <button key={c} className={`ks-swatch${value?.toLowerCase() === c ? ' on' : ''}`} style={{ background: c }} title={c} aria-label={c} onClick={() => onPick(c)} />
          ))}
        </div>
      ))}
      <label className="ks-swatch-more">
        More colours…
        <input type="color" value={value ?? '#000000'} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  )
}

/** A colour palette dropped from a toolbar button (inside the app, so its styles apply). */
export function ColorPopover({ root, at, value, allowNone, noneLabel, onPick, onClose }: {
  root: HTMLElement
  at: DOMRect
  value?: string | null
  allowNone?: boolean
  noneLabel?: string
  onPick: (c: string | null) => void
  onClose: () => void
}) {
  const box = root.getBoundingClientRect()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [onClose])
  return createPortal(
    <div ref={ref} className="ks-popover" style={{ left: Math.max(4, at.left - box.left), top: at.bottom - box.top + 4 }} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <Swatches
        value={value}
        allowNone={allowNone}
        noneLabel={noneLabel}
        onPick={(c) => {
          onPick(c)
          onClose()
        }}
      />
    </div>,
    root,
  )
}

// --------------------------------------------------------- Format Cells

const CURRENCIES = ['$', '€', '£', '¥', '₹', '₩', 'Fr', 'kr']
const DATES: [string, string][] = [
  ['2025-03-15', '%Y-%m-%d'], ['15/03/2025', '%d/%m/%Y'], ['03/15/2025', '%m/%d/%Y'], ['15 Mar 2025', '%d %b %Y'], ['March 15, 2025', '%B %d, %Y'], ['15-Mar-25', '%d-%b-%y'],
]
const TIMES: [string, string][] = [['13:30:00', '%H:%M:%S'], ['13:30', '%H:%M'], ['1:30 PM', '%I:%M %p'], ['1:30:00 PM', '%I:%M:%S %p']]
const CATEGORIES = ['General', 'Number', 'Currency', 'Percentage', 'Scientific', 'Date', 'Time', 'Text']
export const FONTS = ['Default', 'Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Helvetica', 'Segoe UI', 'Times New Roman', 'Verdana']
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72]

function categoryOf(nf: string | undefined): string {
  if (!nf || nf === 'General') return 'General'
  if (/^0(\.0+)?$/.test(nf)) return 'Number'
  if (nf.startsWith('Currency')) return 'Currency'
  if (nf === 'Percentage') return 'Percentage'
  if (nf.startsWith('Sci')) return 'Scientific'
  if (nf.startsWith('Date')) return 'Date'
  if (nf.startsWith('Time')) return 'Time'
  return nf === 'Text' ? 'Text' : 'General'
}

type Tab = 'Number' | 'Alignment' | 'Font' | 'Border' | 'Fill'

export function FormatCellsDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const sh = book.active
  const { r, c } = sh.sel.active
  const f0 = sh.formats.get(key(r, c)) ?? {}
  const [tab, setTab] = useState<Tab>('Number')
  const nf0 = f0.number_format
  const [cat, setCat] = useState(categoryOf(nf0))
  const [places, setPlaces] = useState(nf0 && /^0(\.0+)?$/.test(nf0) ? (nf0.split('.')[1] ?? '').length : nf0?.startsWith('Sci:') ? Number(nf0.slice(4)) || 4 : 2)
  const [sym, setSym] = useState(nf0?.startsWith('Currency:') ? nf0.slice(9) : '$')
  const [date, setDate] = useState(nf0?.startsWith('Date:') ? nf0.slice(5) : '%Y-%m-%d')
  const [time, setTime] = useState(nf0?.startsWith('Time:') ? nf0.slice(5) : '%H:%M:%S')
  const h0 = (f0.alignment ?? 0) & 0x0f
  const v0 = (f0.alignment ?? 0) & 0xe0
  const [halign, setHalign] = useState(h0 === 0x1 ? 'Left' : h0 === 0x2 ? 'Right' : h0 === 0x4 ? 'Center' : 'General')
  const [valign, setValign] = useState(v0 === 0x20 ? 'Top' : v0 === 0x40 ? 'Bottom' : 'Center')
  const [wrap, setWrap] = useState(!!f0.wrap_text)
  const [family, setFamily] = useState(f0.font_family ?? 'Default')
  const [size, setSize] = useState(f0.font_size ?? 9)
  const [bold, setBold] = useState(!!f0.bold)
  const [italic, setItalic] = useState(!!f0.italic)
  const [underline, setUnderline] = useState(!!f0.underline)
  const [color, setColor] = useState<string | null>(f0.font_color ?? null)
  const [fill, setFill] = useState<string | null>(f0.bg ?? null)
  const [borderPreset, setBorderPreset] = useState<'keep' | 'none' | 'outside' | 'all' | 'inside'>('keep')
  const [borderColor, setBorderColor] = useState('#000000')
  const [borderWidth, setBorderWidth] = useState(1)
  const [borderStyle, setBorderStyle] = useState(1)
  const touched = useRef(new Set<Tab>())
  const touch = (t: Tab) => touched.current.add(t)

  const numberFormat = (): string | undefined => {
    switch (cat) {
      case 'Number':
        return places ? `0.${'0'.repeat(places)}` : '0'
      case 'Currency':
        return `Currency:${sym}`
      case 'Percentage':
        return 'Percentage'
      case 'Scientific':
        return `Sci:${places}`
      case 'Date':
        return `Date:${date}`
      case 'Time':
        return `Time:${time}`
      case 'Text':
        return 'Text'
      default:
        return undefined
    }
  }

  const apply = () => {
    const t = touched.current
    const ranges = sh.sel.ranges
    const edgeOf = (rr: number, cc: number) => {
      const g = ranges.find((x) => rr >= x.r1 && rr <= x.r2 && cc >= x.c1 && cc <= x.c2)!
      return { top: rr === g.r1, bottom: rr === g.r2, left: cc === g.c1, right: cc === g.c2 }
    }
    const b: Border = { style: borderStyle, color: borderColor, width: borderWidth }
    void formatCells(
      book,
      (f, rr, cc) => {
        const p: Partial<Fmt> = {}
        if (t.has('Number')) p.number_format = numberFormat()
        if (t.has('Alignment')) {
          const hf = halign === 'Left' ? 0x1 : halign === 'Right' ? 0x2 : halign === 'Center' ? 0x4 : 0
          const vf = valign === 'Top' ? 0x20 : valign === 'Bottom' ? 0x40 : 0x80
          p.alignment = hf || vf !== 0x80 ? (hf || 0x1) | vf : undefined
          p.wrap_text = wrap || undefined
        }
        if (t.has('Font')) {
          p.font_family = family === 'Default' ? undefined : family
          p.font_size = size === 9 ? undefined : size
          p.bold = bold || undefined
          p.italic = italic || undefined
          p.underline = underline || undefined
          p.font_color = color ?? undefined
        }
        if (t.has('Fill')) p.bg = fill ?? undefined
        if (t.has('Border') && borderPreset !== 'keep') {
          const e = edgeOf(rr, cc)
          const none = { b_top: undefined, b_bottom: undefined, b_left: undefined, b_right: undefined }
          if (borderPreset === 'none') Object.assign(p, none)
          else if (borderPreset === 'all') Object.assign(p, { b_top: b, b_bottom: b, b_left: b, b_right: b })
          else if (borderPreset === 'outside') {
            if (e.top) p.b_top = b
            if (e.bottom) p.b_bottom = b
            if (e.left) p.b_left = b
            if (e.right) p.b_right = b
          } else {
            if (!e.top) p.b_top = b
            if (!e.bottom) p.b_bottom = b
            if (!e.left) p.b_left = b
            if (!e.right) p.b_right = b
          }
        }
        return patchFmt(f, p)
      },
      'Format Cells',
      formatTargets(sh),
    )
    onClose()
  }

  const preview = useMemo(() => {
    const cell = sh.cells.get(key(r, c))
    const v = cell?.n ?? 1234.5678
    const nf = numberFormat()
    if (!nf) return String(cell?.t || v)
    if (/^0(\.0+)?$/.test(nf)) return v.toFixed(places)
    if (nf.startsWith('Currency')) return `${sym}${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    if (nf === 'Percentage') return `${(v * 100).toFixed(2)}%`
    if (nf.startsWith('Sci')) return v.toExponential(places)
    if (nf === 'Text') return cell?.s || String(v)
    return '(shown by Python when applied)'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, places, sym, date, time])

  const tabs: Tab[] = ['Number', 'Alignment', 'Font', 'Border', 'Fill']
  return (
    <Modal
      title="Format Cells"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="k-btn" onClick={onClose}>Cancel</button>
          <button className="k-btn primary" onClick={apply}>OK</button>
        </>
      }
    >
      <div className="ks-tabs-row" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`ks-tabbtn${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Number' && (
        <div className="ks-form two" onChange={() => touch('Number')} onClick={() => touch('Number')}>
          <select className="k-input ks-list" size={8} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            {CATEGORIES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <div className="ks-form">
            <div className="ks-preview">
              <span className="k-muted">Sample</span> {preview}
            </div>
            {(cat === 'Number' || cat === 'Scientific') && (
              <label className="ks-field">
                Decimal places
                <input className="k-input" type="number" min={0} max={cat === 'Number' ? 4 : 12} value={places} onChange={(e) => setPlaces(Math.max(0, Math.min(cat === 'Number' ? 4 : 12, Number(e.target.value) || 0)))} />
              </label>
            )}
            {cat === 'Currency' && (
              <label className="ks-field">
                Symbol
                <select className="k-input" value={sym} onChange={(e) => setSym(e.target.value)}>
                  {CURRENCIES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            )}
            {cat === 'Date' && (
              <label className="ks-field">
                Type
                <select className="k-input" value={date} onChange={(e) => setDate(e.target.value)}>
                  {DATES.map(([label, p]) => (
                    <option key={p} value={p}>{label}</option>
                  ))}
                </select>
              </label>
            )}
            {cat === 'Time' && (
              <label className="ks-field">
                Type
                <select className="k-input" value={time} onChange={(e) => setTime(e.target.value)}>
                  {TIMES.map(([label, p]) => (
                    <option key={p} value={p}>{label}</option>
                  ))}
                </select>
              </label>
            )}
            <p className="ks-note">
              {cat === 'General'
                ? 'Numbers show two decimals, as on the desktop.'
                : cat === 'Text'
                  ? 'The cell shows what was typed, even a number.'
                  : cat === 'Date' || cat === 'Time'
                    ? 'The cell holds a serial number (days since 1899-12-30), shown as a date or time.'
                    : 'How numbers are shown; formulas keep the full value.'}
            </p>
          </div>
        </div>
      )}
      {tab === 'Alignment' && (
        <div className="ks-form" onChange={() => touch('Alignment')}>
          <label className="ks-field">
            Horizontal
            <select className="k-input" value={halign} onChange={(e) => setHalign(e.target.value)}>
              {['General', 'Left', 'Center', 'Right'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="ks-field">
            Vertical
            <select className="k-input" value={valign} onChange={(e) => setValign(e.target.value)}>
              {['Top', 'Center', 'Bottom'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="ks-check">
            <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> Wrap text
          </label>
        </div>
      )}
      {tab === 'Font' && (
        <div className="ks-form" onChange={() => touch('Font')} onClick={() => touch('Font')}>
          <div className="ks-form two">
            <label className="ks-field">
              Font
              <select className="k-input" value={family} onChange={(e) => setFamily(e.target.value)}>
                {FONTS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="ks-field">
              Size (pt)
              <select className="k-input" value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {SIZES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="ks-row">
            <label className="ks-check">
              <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /> Bold
            </label>
            <label className="ks-check">
              <input type="checkbox" checked={italic} onChange={(e) => setItalic(e.target.checked)} /> Italic
            </label>
            <label className="ks-check">
              <input type="checkbox" checked={underline} onChange={(e) => setUnderline(e.target.checked)} /> Underline
            </label>
          </div>
          <div className="ks-field">
            Colour
            <Swatches value={color} allowNone noneLabel="Automatic" onPick={(c2) => setColor(c2)} />
          </div>
        </div>
      )}
      {tab === 'Border' && (
        <div className="ks-form" onChange={() => touch('Border')} onClick={() => touch('Border')}>
          <div className="ks-row">
            {(['none', 'outside', 'inside', 'all'] as const).map((p) => (
              <button key={p} className={`k-btn small${borderPreset === p ? ' primary' : ''}`} onClick={() => setBorderPreset(p)}>
                {p === 'none' ? 'None' : p === 'outside' ? 'Outline' : p === 'inside' ? 'Inside' : 'All'}
              </button>
            ))}
          </div>
          <div className="ks-form two">
            <label className="ks-field">
              Line
              <select className="k-input" value={borderStyle} onChange={(e) => setBorderStyle(Number(e.target.value))}>
                <option value={1}>Solid</option>
                <option value={2}>Dashed</option>
                <option value={3}>Dotted</option>
                <option value={4}>Dash-dot</option>
              </select>
            </label>
            <label className="ks-field">
              Width
              <select className="k-input" value={borderWidth} onChange={(e) => setBorderWidth(Number(e.target.value))}>
                <option value={0.5}>Hairline</option>
                <option value={1}>Thin</option>
                <option value={2}>Medium</option>
                <option value={3}>Thick</option>
              </select>
            </label>
          </div>
          <div className="ks-field">
            Colour
            <Swatches value={borderColor} onPick={(c2) => setBorderColor(c2 ?? '#000000')} />
          </div>
        </div>
      )}
      {tab === 'Fill' && (
        <div className="ks-form" onClick={() => touch('Fill')}>
          <Swatches value={fill} allowNone onPick={(c2) => setFill(c2)} />
          <p className="ks-note">The grid is dark: pale fills are shown deep, with the same hue. The file keeps your colour.</p>
        </div>
      )}
    </Modal>
  )
}

// ----------------------------------------------------------- AutoFilter

export function FilterPopover({ book, root, col, at, onClose, onSort }: {
  book: Book
  root: HTMLElement
  col: number
  at: { clientX: number; clientY: number }
  onClose: () => void
  onSort: (ascending: boolean) => void
}) {
  const sh = book.active
  const values = useMemo(() => filterValues(sh, col), [sh, col])
  const current = sh.filter?.keep[col]
  const [keep, setKeep] = useState<Set<string>>(new Set(current ?? values.map((v) => v.text)))
  const [q, setQ] = useState('')
  const box = root.getBoundingClientRect()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [onClose])
  const shown = values.filter((v) => v.text.toLowerCase().includes(q.toLowerCase()))
  const all = shown.every((v) => keep.has(v.text))
  return createPortal(
    <div ref={ref} className="ks-popover ks-filter" style={{ left: Math.max(4, Math.min(at.clientX - box.left, box.width - 260)), top: Math.min(at.clientY - box.top + 6, box.height - 360) }} onKeyDown={(e) => {
      e.stopPropagation()
      if (e.key === 'Escape') onClose()
    }}>
      <button className="ks-menu-btn" onClick={() => onSort(true)}>Sort A → Z</button>
      <button className="ks-menu-btn" onClick={() => onSort(false)}>Sort Z → A</button>
      <div className="ks-sep" />
      <div className="ks-search">
        <Search size={13} />
        <input value={q} placeholder="Search" onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <label className="ks-check">
        <input
          type="checkbox"
          checked={all}
          onChange={() => {
            const next = new Set(keep)
            for (const v of shown) {
              if (all) next.delete(v.text)
              else next.add(v.text)
            }
            setKeep(next)
          }}
        />
        (Select all)
      </label>
      <div className="ks-filter-list">
        {shown.map((v) => (
          <label key={v.text} className="ks-check">
            <input
              type="checkbox"
              checked={keep.has(v.text)}
              onChange={() => {
                const next = new Set(keep)
                if (next.has(v.text)) next.delete(v.text)
                else next.add(v.text)
                setKeep(next)
              }}
            />
            <span className="ks-filter-text">{v.text || '(Blanks)'}</span>
            <span className="k-muted">{v.count}</span>
          </label>
        ))}
      </div>
      <div className="ks-dialog-foot">
        <button className="k-btn small" onClick={() => {
          setFilterKeep(book, col, null)
          onClose()
        }}>Clear</button>
        <button className="k-btn small primary" onClick={() => {
          setFilterKeep(book, col, keep.size === values.length ? null : [...keep])
          onClose()
        }}>OK</button>
      </div>
    </div>,
    root,
  )
}

// --------------------------------------------------------- Find & Replace

export function FindDialog({ book, replace, onClose }: { book: Book; replace: boolean; onClose: () => void }) {
  const [what, setWhat] = useState('')
  const [withText, setWithText] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [whole, setWhole] = useState(false)
  const [inFormulas, setInFormulas] = useState(true)
  const [all, setAll] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const test = (s: string) => {
    if (!what) return false
    const a = matchCase ? s : s.toLowerCase()
    const b = matchCase ? what : what.toLowerCase()
    return whole ? a === b : a.includes(b)
  }
  const sheets = (): Sheet[] => (all ? book.sheets : [book.active])
  const hits = (sh: Sheet) =>
    [...sh.cells]
      .filter(([, cell]) => test(inFormulas && cell.s ? cell.s : cell.t))
      .map(([k]) => k)
      .sort((x, y) => keyRow(x) - keyRow(y) || keyCol(x) - keyCol(y))

  const next = (back = false) => {
    const order = sheets()
    const list: { sh: Sheet; k: number }[] = []
    for (const sh of order) for (const k of hits(sh)) list.push({ sh, k })
    if (!list.length) {
      setNote(`"${what}" was not found.`)
      return
    }
    const here = [Math.max(0, order.indexOf(book.active)), book.active.sel.active.r, book.active.sel.active.c]
    const pos = (x: { sh: Sheet; k: number }) => [order.indexOf(x.sh), keyRow(x.k), keyCol(x.k)]
    const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
    const pick = back
      ? ([...list].reverse().find((x) => cmp(pos(x), here) < 0) ?? list[list.length - 1])
      : (list.find((x) => cmp(pos(x), here) > 0) ?? list[0])
    if (pick.sh.id !== book.state.active) book.activate(pick.sh.id)
    book.selectCell(keyRow(pick.k), keyCol(pick.k))
    setNote(null)
  }

  const swap = (s: string) => {
    if (whole) return withText
    const flags = matchCase ? 'g' : 'gi'
    return s.replace(new RegExp(what.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags), withText)
  }

  const replaceOne = async () => {
    const sh = book.active
    const { r, c } = sh.sel.active
    const cell = sh.cells.get(key(r, c))
    if (cell && test(cell.s || cell.t)) await book.setCells(sh, [[r, c, swap(cell.s || cell.t)]], 'Replace')
    next()
  }

  const replaceAll = async () => {
    let n = 0
    for (const sh of sheets()) {
      const cells: [number, number, string][] = []
      for (const k of hits(sh)) {
        const cell = sh.cells.get(k)!
        const src = cell.s || cell.t
        if (!test(src)) continue
        cells.push([keyRow(k), keyCol(k), swap(src)])
      }
      n += cells.length
      if (cells.length) await book.setCells(sh, cells, 'Replace All')
    }
    setNote(n ? `${n} replacement${n === 1 ? '' : 's'} made.` : `"${what}" was not found.`)
  }

  return (
    <Modal title={replace ? 'Find and Replace' : 'Find'} onClose={onClose}>
      <form className="ks-form" onSubmit={(e) => {
        e.preventDefault()
        next()
      }}>
        <label className="ks-field">
          Find what
          <input className="k-input" value={what} autoFocus onChange={(e) => setWhat(e.target.value)} />
        </label>
        {replace && (
          <label className="ks-field">
            Replace with
            <input className="k-input" value={withText} onChange={(e) => setWithText(e.target.value)} />
          </label>
        )}
        <div className="ks-row">
          <label className="ks-check"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
          <label className="ks-check"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Entire cell</label>
          <label className="ks-check"><input type="checkbox" checked={inFormulas} onChange={(e) => setInFormulas(e.target.checked)} /> Look in formulas</label>
          <label className="ks-check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All sheets</label>
        </div>
        {note && <p className="ks-note">{note}</p>}
        <div className="ks-dialog-foot inline">
          {replace && <button type="button" className="k-btn" disabled={!what} onClick={() => void replaceAll()}>Replace All</button>}
          {replace && <button type="button" className="k-btn" disabled={!what} onClick={() => void replaceOne()}>Replace</button>}
          <button type="button" className="k-btn" disabled={!what} onClick={() => next(true)}>Previous</button>
          <button type="submit" className="k-btn primary" disabled={!what}>Find Next</button>
        </div>
      </form>
    </Modal>
  )
}

// ----------------------------------------------------- =PY output, equations

export function PythonOutputDialog({ book, r, c, onClose }: { book: Book; r: number; c: number; onClose: () => void }) {
  const out = book.active.py.get(key(r, c))
  return (
    <Modal title={`Python output — ${a1(r, c)}`} wide onClose={onClose}>
      {out?.out && (
        <>
          <h4 className="ks-h4">Printed</h4>
          <pre className="ks-pre">{out.out}</pre>
        </>
      )}
      {out?.err && (
        <>
          <h4 className="ks-h4 err">Error</h4>
          <pre className="ks-pre err">{out.err}</pre>
        </>
      )}
      {!out?.out && !out?.err && <p className="ks-note">This cell printed nothing and ran without errors.</p>}
    </Modal>
  )
}

export function EquationDialog({ initial, onDone, onClose }: { initial: string; onDone: (latex: string) => void; onClose: () => void }) {
  const [latex, setLatex] = useState(initial)
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex || '\\;', { throwOnError: false, displayMode: true })
    } catch {
      return ''
    }
  }, [latex])
  return (
    <Modal
      title="Equation"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="k-btn" onClick={onClose}>Cancel</button>
          <button className="k-btn primary" disabled={!latex.trim()} onClick={() => {
            onDone(latex.trim())
            onClose()
          }}>OK</button>
        </>
      }
    >
      <label className="ks-field">
        LaTeX
        <textarea className="k-input ks-mono" rows={4} value={latex} autoFocus spellCheck={false} onChange={(e) => setLatex(e.target.value)} placeholder="E = mc^2" />
      </label>
      <div className="ks-eq-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </Modal>
  )
}

export function ListDialog({ title, label, initial, onDone, onClose }: { title: string; label: string; initial: string[]; onDone: (items: string[] | null) => void; onClose: () => void }) {
  const [text, setText] = useState(initial.join('\n'))
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {initial.length > 0 && <button className="k-btn danger" onClick={() => {
            onDone(null)
            onClose()
          }}>Remove</button>}
          <button className="k-btn" onClick={onClose}>Cancel</button>
          <button className="k-btn primary" onClick={() => {
            const items = text.split('\n').map((s) => s.trim()).filter(Boolean)
            onDone(items.length ? items : null)
            onClose()
          }}>OK</button>
        </>
      }
    >
      <label className="ks-field">
        {label}
        <textarea className="k-input" rows={8} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
      </label>
    </Modal>
  )
}

/** Number formats for the toolbar's list. */
export const FORMAT_OPTIONS = NUMBER_FORMATS

/** A note, a link, a size: one value to type. */
export function TextDialog({ title, label, initial, multiline, okLabel = 'OK', removable, onDone, onClose }: {
  title: string
  label: string
  initial: string
  multiline?: boolean
  okLabel?: string
  /** Offer "Remove" (it answers null). */
  removable?: boolean
  onDone: (value: string | null) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const ok = () => {
    onDone(value)
    onClose()
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {removable && <button className="k-btn danger" onClick={() => {
            onDone(null)
            onClose()
          }}>Remove</button>}
          <button className="k-btn" onClick={onClose}>Cancel</button>
          <button className="k-btn primary" onClick={ok}>{okLabel}</button>
        </>
      }
    >
      <label className="ks-field">
        {label}
        {multiline ? (
          <textarea className="k-input" rows={6} value={value} autoFocus onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ok()
          }} />
        ) : (
          <input className="k-input" value={value} autoFocus onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
        )}
      </label>
    </Modal>
  )
}
