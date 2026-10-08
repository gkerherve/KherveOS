// The desktop's three toolbars, in its order and with its own icons
// (mainwindow._build_toolbars), side by side as on the desktop:
//   Standard: New, Open, Save, Print | Undo, Redo | Solver, Curve Fitting,
//             Science ▾ | AI chat
//   Font:     font, size | Bold, Italic, Underline | Align left, centre,
//             right | Fill colour ▾, Font colour ▾, Borders ▾, Merge/Unmerge
//   Plot:     Insert Chart (last type) ▾, Table Design ▾, Image, Shapes ▾,
//             Sparklines ▾, Equation ▾, Symbol ▾, Insert ▾

import { useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { ChevronDown } from 'lucide-react'
import { os, type MenuItem } from '@/os'
import type { Book } from './book'
import { ColorPopover, FONTS, Popover, SIZES } from './dialogs'
import { ColorGlyph, Ico, PLOT_ICONS, menuIcon, type IconName } from './icons'
import { key } from './model'
import { CHART_TYPES, insertChart } from './objects'
import { BORDER_PRESETS, align, formatCells, insertCharacters, setBorders, toggleFlag, toggleMerge } from './ops'
import { TABLE_STYLES, applyTableStyle, type TableStyle } from './tableStyles'

export interface ToolbarActions {
  newBook: () => void
  open: () => void
  save: () => void
  print: () => void
  solver: () => void
  fitting: () => void
  science: (tool: string) => void
  aiChat: () => void
  image: () => void
  equation: (latex: string | null) => void
  comment: () => void
  note: () => void
  dropdown: () => void
  checkbox: () => void
  sparklines: () => void
  sparkline: () => void
  removeSparklines: () => void
}

/** The desktop's Science menu (science.TOOLS + science_extra.EXTRA_TOOLS); null = separator. */
export const SCIENCE_TOOLS: (string | null)[] = [
  'Normalisation…', 'Integration…', 'Derivative…', 'Smooth…', 'FFT…', 'Interpolation…', 'Find Peaks…', null,
  'Baseline Subtraction…', 'Crop…', 'Band-pass Filter…', 'Calibration…', 'Resampling…', 'Cross-Correlation…', 'Signal-to-Noise…', 'Envelope…',
  'Kramers-Kronig…', 'Deconvolution…',
]

/** The desktop's preset equations (equation.EQUATION_PRESETS). */
export const EQUATION_PRESETS: [string, string][] = [
  ['Area of Circle', 'A = \\pi r^2'],
  ['Binomial Theorem', '(x+a)^n = \\sum_{k=0}^{n} \\binom{n}{k} x^k a^{n-k}'],
  ['Expansion of a Sum', '(1+x)^n = 1 + \\frac{nx}{1!} + \\frac{n(n-1)x^2}{2!} + \\cdots'],
  ['Fourier Series', 'f(x) = a_0 + \\sum_{n=1}^{\\infty}\\left(a_n\\cos\\frac{n\\pi x}{L} + b_n\\sin\\frac{n\\pi x}{L}\\right)'],
  ['Pythagorean Theorem', 'a^2 + b^2 = c^2'],
  ['Quadratic Formula', 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'],
  ['Taylor Expansion', 'e^x = 1 + \\frac{x}{1!} + \\frac{x^2}{2!} + \\frac{x^3}{3!} + \\cdots, \\quad -\\infty < x < \\infty'],
  ['Trig Identity 1', '\\sin\\alpha \\pm \\sin\\beta = 2\\sin\\frac{1}{2}(\\alpha\\pm\\beta)\\cos\\frac{1}{2}(\\alpha\\mp\\beta)'],
  ['Trig Identity 2', '\\cos\\alpha + \\cos\\beta = 2\\cos\\frac{1}{2}(\\alpha+\\beta)\\cos\\frac{1}{2}(\\alpha-\\beta)'],
]

/** The Symbol button's grid (mainwindow._build_symbol_grid). */
export const SYMBOLS = [...'αβγδεζηθικλμνξπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΠΡΣΤΥΦΧΨΩ', ...'±×÷√∞≠≤≥≈∑∏∫∂∇°′″', ...'←→↑↓↔⇐⇒⇑⇓⇔']

/** The Emoji picker (insert_ops._EMOJI_GROUPS). */
export const EMOJI_GROUPS: [string, string[]][] = [
  ['Smileys', [...'😀😃😄😁😆😅🤣😂🙂😉😊😇🥰😍🤩😘😗😋😛😜🤪😝🤑🤗']],
  ['Gestures', [...'👍👎👏🙌🤝🤲👐✌🤞🤟🤘🤙👈👉👆👇☝✋🤚🖐🖖👋🤏']],
  ['Objects', [...'⭐🌟💡🔥❤💎🏆🎯📌📎✏📝💰📊📈📉🔬🔭🧪🧮💻📱']],
  ['Symbols', ['✅', '❌', '⚠️', 'ℹ', '❓', '❗', '✔', '➕', '➖', '➗', '💲', '©', '®', '™', '🔴', '🟢', '🔵', '⚫', '⚪', '🟡', '🟠', '🟣']],
]

/** Toolbar buttons keep the keyboard focus where it was (the grid or the editor). */
const keep = (e: { preventDefault: () => void }) => e.preventDefault()

function Btn({ title, onClick, children, on, disabled }: { title: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode; on?: boolean; disabled?: boolean }) {
  return (
    <button className={`ks-tb${on ? ' on' : ''}`} title={title} aria-label={title} aria-pressed={on} disabled={disabled} onMouseDown={keep} onClick={onClick}>
      {children}
    </button>
  )
}

/** QToolButton MenuButtonPopup: the button acts, the arrow opens the menu. */
function Split({ title, onClick, onMenu, children }: { title: string; onClick: () => void; onMenu: (r: DOMRect) => void; children: ReactNode }) {
  return (
    <span className="ks-split">
      <button className="ks-tb" title={title} aria-label={title} onMouseDown={keep} onClick={onClick}>
        {children}
      </button>
      <button className="ks-tb ks-tb-arrow" title={title} aria-label={`${title} options`} onMouseDown={keep} onClick={(e) => onMenu(e.currentTarget.parentElement!.getBoundingClientRect())}>
        <ChevronDown size={10} />
      </button>
    </span>
  )
}

/** QToolButton InstantPopup: the whole button opens the menu (a small arrow in its corner). */
function Drop({ title, icon, onMenu }: { title: string; icon: IconName; onMenu: (r: DOMRect) => void }) {
  return (
    <button className="ks-tb ks-tb-drop" title={title} aria-label={title} aria-haspopup="menu" onMouseDown={keep} onClick={(e) => onMenu(e.currentTarget.getBoundingClientRect())}>
      <Ico name={icon} />
      <i className="ks-tb-corner" />
    </button>
  )
}

const Sep = () => <span className="ks-tb-sep" />

/** Excel's AutoSum: =SUM over the numbers just above (or left of) the active cell. */
export function autoSum(book: Book) {
  const sh = book.active
  const { r, c } = sh.sel.active
  const isNum = (rr: number, cc: number) => {
    const cell = sh.cells.get(key(rr, cc))
    return !!cell && cell.n !== null && !cell.s.startsWith('=SUM')
  }
  let top = r
  while (top > 0 && isNum(top - 1, c)) top--
  if (top < r) return book.startEdit(`=SUM(${a1Of(top, c)}:${a1Of(r - 1, c)})`)
  let left = c
  while (left > 0 && isNum(r, left - 1)) left--
  if (left < c) return book.startEdit(`=SUM(${a1Of(r, left)}:${a1Of(r, c - 1)})`)
  book.startEdit('=SUM(')
}
const a1Of = (r: number, c: number) => {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return `${s}${r + 1}`
}

/** The border presets as menu items with the desktop's icons. */
export function borderMenu(book: Book): MenuItem[] {
  return BORDER_PRESETS.map((p): MenuItem => (p ? { label: p[0], image: menuIcon(`border_${p[1]}` as IconName), onClick: () => setBorders(book, p[1]) } : '-'))
}

/** The equation gallery: presets (with a preview) and Insert New Equation…. */
export function equationMenu(onPick: (latex: string | null) => void): MenuItem[] {
  return [
    ...EQUATION_PRESETS.map(([label, latex]): MenuItem => ({ label, onClick: () => onPick(latex) })),
    '-',
    { label: 'Insert New Equation…', onClick: () => onPick(null) },
  ]
}

function TableDesign({ book, onDone }: { book: Book; onDone: () => void }) {
  const [header, setHeader] = useState(true)
  const [banded, setBanded] = useState(true)
  const thumb = (st: TableStyle) => (
    <svg width="72" height="52" viewBox="0 0 72 52">
      <rect width="72" height="52" fill="#fff" />
      {Array.from({ length: 5 }, (_, row) => (
        <rect key={row} x="0" y={row * 10} width="72" height="10" fill={row === 0 ? st.header_bg : row % 2 === 0 ? st.even_bg : st.odd_bg} />
      ))}
      {st.border_color && st.border_outer && <rect x="0.5" y="0.5" width="71" height="51" fill="none" stroke={st.border_color} />}
      {st.border_color && st.border_inner && (
        <g stroke={st.border_color}>
          {[18, 36, 54].map((x) => <line key={x} x1={x + 0.5} y1="0" x2={x + 0.5} y2="52" />)}
          {[10, 20, 30, 40].map((y) => <line key={y} x1="0" y1={y + 0.5} x2="72" y2={y + 0.5} />)}
        </g>
      )}
      {st.border_header_bottom && <line x1="0" y1="10" x2="72" y2="10" stroke={st.border_color ?? st.header_bg} strokeWidth="2" />}
      <g stroke={st.header_fg}>{[0, 1, 2, 3].map((c) => <line key={c} x1={c * 18 + 3} y1="5.5" x2={c * 18 + 15} y2="5.5" />)}</g>
      <g stroke="#888">
        {[1, 2, 3, 4].map((r) => [0, 1, 2, 3].map((c) => <line key={`${r}-${c}`} x1={c * 18 + 4} y1={r * 10 + 5.5} x2={c * 18 + 14} y2={r * 10 + 5.5} />))}
      </g>
    </svg>
  )
  return (
    <div className="ks-tabledesign">
      <div className="ks-td-opts">
        <label><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Header Row</label>
        <label><input type="checkbox" checked={banded} onChange={(e) => setBanded(e.target.checked)} /> Banded Rows</label>
      </div>
      {(['Plain', 'Grid', 'List'] as const).map((cat) => (
        <div key={cat}>
          <b className="ks-td-cat">{cat} Tables</b>
          <div className="ks-td-grid">
            {TABLE_STYLES.filter((s) => s.category === cat).map((st) => (
              <button
                key={st.name}
                className="ks-td-btn"
                title={st.name}
                onClick={() => {
                  applyTableStyle(book, st, header, banded)
                  onDone()
                }}
              >
                {thumb(st)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function Toolbar({ book, root, actions }: { book: Book; root: HTMLElement | null; actions: ToolbarActions }) {
  const sel = useStore(book.store, (s) => s.sel)
  useStore(book.store, (s) => s.version)
  const canUndo = useStore(book.store, (s) => s.canUndo)
  const canRedo = useStore(book.store, (s) => s.canRedo)
  const active = useStore(book.store, (s) => s.active)
  const sh = book.sheet(active)
  const f = sh.formats.get(key(sel.active.r, sel.active.c)) ?? {}
  const [fill, setFill] = useState('#ffff00')
  const [ink, setInk] = useState('#ff0000')
  const [chartType, setChartType] = useState('Line')
  const [popover, setPopover] = useState<{ kind: 'fill' | 'ink' | 'symbol' | 'emoji' | 'table'; at: DOMRect } | null>(null)
  const h = (f.alignment ?? 0) & 0x0f

  const menuAt = (r: DOMRect, items: MenuItem[]) => os.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, items)
  const close = () => setPopover(null)

  return (
    <div className="ks-toolbars" onMouseDown={(e) => (e.target as HTMLElement).closest('button') && e.preventDefault()}>
      <div className="ks-toolbar" role="toolbar" aria-label="Standard">
        <Btn title="New" onClick={actions.newBook}><Ico name="new_file" /></Btn>
        <Btn title="Open" onClick={actions.open}><Ico name="open_file" /></Btn>
        <Btn title="Save" onClick={actions.save}><Ico name="save_file" /></Btn>
        <Btn title="Print (Ctrl+P)" onClick={actions.print}><Ico name="print" /></Btn>
        <Sep />
        <Btn title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => void book.undo()}><Ico name="undo" /></Btn>
        <Btn title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => void book.redo()}><Ico name="redo" /></Btn>
        <Sep />
        <Btn title="Solver" onClick={actions.solver}><Ico name="solver" /></Btn>
        <Btn title="Curve Fitting" onClick={actions.fitting}><Ico name="fitting" /></Btn>
        <Drop
          title="Science Tools"
          icon="science"
          onMenu={(r) => menuAt(r, SCIENCE_TOOLS.map((t): MenuItem => (t ? { label: t, onClick: () => actions.science(t) } : '-')))}
        />
        <Sep />
        <Btn title="A chat box with kAI (Ctrl+Shift+A)" onClick={actions.aiChat}><Ico name="robot" /></Btn>
      </div>
      <div className="ks-toolbar" role="toolbar" aria-label="Font">
        <select
          className="ks-tb-select font"
          title="Font"
          value={f.font_family ?? 'Default'}
          onChange={(e) => void formatCells(book, { font_family: e.target.value === 'Default' ? undefined : e.target.value }, 'Font')}
        >
          {FONTS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          className="ks-tb-select size"
          title="Font size"
          value={f.font_size ?? 9}
          onChange={(e) => void formatCells(book, { font_size: Number(e.target.value) === 9 ? undefined : Number(e.target.value) }, 'Font Size')}
        >
          {[...new Set([...SIZES, f.font_size ?? 9])].sort((a, b) => a - b).map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
        <Sep />
        <Btn title="Bold (Ctrl+B)" on={!!f.bold} onClick={() => toggleFlag(book, 'bold', 'Bold')}><Ico name="bold" /></Btn>
        <Btn title="Italic (Ctrl+I)" on={!!f.italic} onClick={() => toggleFlag(book, 'italic', 'Italic')}><Ico name="italic" /></Btn>
        <Btn title="Underline (Ctrl+U)" on={!!f.underline} onClick={() => toggleFlag(book, 'underline', 'Underline')}><Ico name="underline" /></Btn>
        <Sep />
        <Btn title="Align Left" on={h === 0x1} onClick={() => align(book, 'left')}><Ico name="align_left" /></Btn>
        <Btn title="Align Center" on={h === 0x4} onClick={() => align(book, 'center')}><Ico name="align_center" /></Btn>
        <Btn title="Align Right" on={h === 0x2} onClick={() => align(book, 'right')}><Ico name="align_right" /></Btn>
        <Sep />
        <Split title="Fill Color" onClick={() => void formatCells(book, { bg: fill }, 'Fill Colour')} onMenu={(r) => setPopover({ kind: 'fill', at: r })}>
          <ColorGlyph kind="fill" color={fill} />
        </Split>
        <Split title="Font Color" onClick={() => void formatCells(book, { font_color: ink }, 'Font Colour')} onMenu={(r) => setPopover({ kind: 'ink', at: r })}>
          <ColorGlyph kind="font" color={ink} />
        </Split>
        <Drop title="Borders" icon="border" onMenu={(r) => menuAt(r, borderMenu(book))} />
        <Btn title="Merge / Unmerge Cells" onClick={() => toggleMerge(book)}><Ico name="merge_cells" /></Btn>
      </div>
      <div className="ks-toolbar" role="toolbar" aria-label="Plot">
        <Split
          title="Insert Chart"
          onClick={() => insertChart(book, chartType)}
          onMenu={(r) =>
            menuAt(
              r,
              CHART_TYPES.map((t) => ({
                label: t,
                image: menuIcon(PLOT_ICONS[t] ?? 'plot_line'),
                onClick: () => {
                  setChartType(t)
                  insertChart(book, t)
                },
              })),
            )
          }
        >
          <Ico name={PLOT_ICONS[chartType] ?? 'plot_line'} />
        </Split>
        <Drop title="Table Design" icon="table_design" onMenu={(r) => setPopover({ kind: 'table', at: r })} />
        <Btn title="Insert Image" onClick={actions.image}><Ico name="image" /></Btn>
        <Drop title="Insert Shape" icon="shapes" onMenu={(r) => menuAt(r, [{ label: 'Shapes are not in the web edition yet', disabled: true }])} />
        <Split
          title="Insert Sparklines"
          onClick={actions.sparklines}
          onMenu={(r) =>
            menuAt(r, [
              { label: 'Sparklines from Selection…', onClick: actions.sparklines },
              { label: 'Single Sparkline…', onClick: actions.sparkline },
              '-',
              { label: 'Remove Sparklines', onClick: actions.removeSparklines },
            ])
          }
        >
          <Ico name="sparkline" />
        </Split>
        <Drop title="Insert Equation" icon="equation" onMenu={(r) => menuAt(r, equationMenu(actions.equation))} />
        <Drop title="Insert Symbol" icon="omega" onMenu={(r) => setPopover({ kind: 'symbol', at: r })} />
        <Drop
          title="Insert"
          icon="symbol"
          onMenu={(r) =>
            menuAt(r, [
              { label: 'Checkbox', image: menuIcon('checkbox'), onClick: actions.checkbox },
              { label: 'Button…', image: menuIcon('checkbox'), disabled: true },
              { label: 'Dropdown…', image: menuIcon('dropdown'), onClick: actions.dropdown },
              { label: 'Emoji…', image: menuIcon('emoji'), onClick: () => setPopover({ kind: 'emoji', at: r }) },
              '-',
              { label: 'Comment', shortcut: 'Ctrl+Alt+M', image: menuIcon('comment'), onClick: actions.comment },
              { label: 'Note', shortcut: 'Shift+F2', image: menuIcon('note'), onClick: actions.note },
            ])
          }
        />
      </div>
      {popover && root && (popover.kind === 'fill' || popover.kind === 'ink') && (
        <ColorPopover
          root={root}
          at={popover.at}
          value={popover.kind === 'fill' ? fill : ink}
          allowNone
          noneLabel={popover.kind === 'fill' ? 'No Fill' : 'Automatic'}
          onPick={(c) => {
            if (popover.kind === 'fill') {
              if (c) setFill(c)
              void formatCells(book, { bg: c ?? undefined }, 'Fill Colour')
            } else {
              if (c) setInk(c)
              void formatCells(book, { font_color: c ?? undefined }, 'Font Colour')
            }
            book.refocus()
          }}
          onClose={close}
        />
      )}
      {popover && root && popover.kind === 'symbol' && (
        <Popover root={root} at={popover.at} className="ks-symbols" onClose={close}>
          {SYMBOLS.map((s) => (
            <button key={s} onMouseDown={keep} onClick={() => {
              insertCharacters(book, s)
              close()
            }}>
              {s}
            </button>
          ))}
        </Popover>
      )}
      {popover && root && popover.kind === 'emoji' && (
        <Popover root={root} at={popover.at} className="ks-emoji" onClose={close}>
          {EMOJI_GROUPS.map(([group, list]) => (
            <div key={group}>
              <b>{group}</b>
              <div className="ks-emoji-grid">
                {list.map((s) => (
                  <button key={s} onMouseDown={keep} onClick={() => {
                    insertCharacters(book, s)
                    close()
                  }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Popover>
      )}
      {popover && root && popover.kind === 'table' && (
        <Popover root={root} at={popover.at} onClose={close}>
          <TableDesign book={book} onDone={close} />
        </Popover>
      )}
    </div>
  )
}
