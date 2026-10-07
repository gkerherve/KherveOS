// The two toolbars of the desktop KherveTeX main window (mainwindow.py
// _build_toolbar), in the desktop's order and with its own icons:
//
//   "Main toolbar" along the top — file, undo/redo, the paragraph-style combo,
//   Numbered, ¶, class / size / paper combos, character formats, alignment,
//   lists, spelling, review, Git, and the compile buttons pushed to the right.
//   What does not fit goes behind a » button, as in a Qt toolbar.
//
//   "Insert" down the left — maths and chemistry, references, figures and
//   drawings, the column count, page break and rule.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { os, type MenuItem } from '@/os'
import type { DocMeta } from '../model'
import { classSupportsChapter } from '../model'
import { PAGE_SIZES } from '../pageSizes'
import { TEMPLATE_CHOICES } from './dialogs'
import { ACTIONS, iconUrl, tipOf, type ActionId } from './actions'

export type StyleCode =
  | 'body' | 'title' | 'author' | 'affiliation' | 'correspondence' | 'abstract' | 'keywords' | 'frame' | 'chapter'
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5'

/** The paragraph-style combo, in the desktop's order (Word's). */
export const STYLES: [StyleCode, string][] = [
  ['body', 'Body text'],
  ['title', 'Title'],
  ['author', 'Author'],
  ['affiliation', 'Affiliation'],
  ['correspondence', 'Correspondence'],
  ['abstract', 'Abstract'],
  ['keywords', 'Keywords'],
  ['frame', 'Frame (slide)'],
  ['chapter', 'Chapter'],
  ['h1', 'Heading 1'],
  ['h2', 'Heading 2'],
  ['h3', 'Heading 3'],
  ['h4', 'Heading 4'],
  ['h5', 'Heading 5'],
]

export interface EditorSnapshot {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  code: boolean
  smallcaps: boolean
  subscript: boolean
  superscript: boolean
  /** The paragraph's alignment ('justify' when unset), or null outside a paragraph. */
  align: string | null
  style: StyleCode | null
  /** For a heading: is it numbered. */
  numbered: boolean | null
  bullet: boolean
  ordered: boolean
  canUndo: boolean
  canRedo: boolean
  inTable: boolean
  hasSelection: boolean
  inComment: boolean
}

export interface ToolbarFlags {
  auto: boolean
  skipImages: boolean
  compileRange: boolean
  marks: boolean
  spell: boolean
  compiling: boolean
}

// ------------------------------------------------------------ the buttons

function ToolButton({ id, on, disabled, run, icon, tip }: {
  id: ActionId
  on?: boolean
  disabled?: boolean
  run: (a: string) => void
  /** Another icon than the action's (auto-compile off). */
  icon?: string
  tip?: string
}) {
  const a = ACTIONS[id] as { icon?: string; label: string }
  return (
    <button
      className={`ktx-tb-btn${on ? ' on' : ''}`}
      title={tip ?? tipOf(id)}
      aria-label={a.label}
      aria-pressed={on === undefined ? undefined : on}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(id)}
    >
      <img src={iconUrl(icon ?? a.icon ?? 'file-new')} alt="" draggable={false} />
    </button>
  )
}

const Sep = () => <span className="ktx-tb-sep" />

/** One toolbar entry: its widget, and what it becomes in the » menu when it does not fit. */
interface Entry {
  key: string
  node: ReactNode
  menu?: MenuItem
  /** A separator (dropped from the » menu when it would start or end it). */
  sep?: boolean
}

/** Which entries are cut off by the end of the toolbar (horizontal or vertical). */
function useOverflow(count: number) {
  const box = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  useLayoutEffect(() => {
    const root = box.current
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => {
        setHidden((old) => {
          const next = new Set(old)
          for (const e of entries) {
            const key = (e.target as HTMLElement).dataset.ov!
            if (e.intersectionRatio > 0.98) next.delete(key)
            else next.add(key)
          }
          return next.size === old.size && [...next].every((k) => old.has(k)) ? old : next
        })
      },
      { root, threshold: [0, 0.98, 1] },
    )
    for (const el of root.querySelectorAll<HTMLElement>('[data-ov]')) io.observe(el)
    return () => io.disconnect()
  }, [count])
  return { box, hidden }
}

function OverflowBar({ entries, className, vertical }: { entries: Entry[]; className: string; vertical?: boolean }) {
  const { box, hidden } = useOverflow(entries.length)
  const extra = entries.filter((e) => hidden.has(e.key) && (e.menu || e.sep))
  const items: MenuItem[] = []
  for (const e of extra) {
    if (e.sep) {
      if (items.length && items.at(-1) !== '-') items.push('-')
    } else if (e.menu) items.push(e.menu)
  }
  if (items.at(-1) === '-') items.pop()
  return (
    <div className={className}>
      <div ref={box} className="ktx-tb-items">
        {entries.map((e) => (
          <span key={e.key} data-ov={e.key} className={`ktx-tb-item${e.sep ? ' sep' : ''}${e.key === 'spacer' ? ' spacer' : ''}${hidden.has(e.key) ? ' clipped' : ''}`}>
            {e.node}
          </span>
        ))}
      </div>
      {items.length > 0 && (
        <button
          className={`ktx-tb-ext${vertical ? ' vertical' : ''}`}
          title="Show more"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(ev) => {
            const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
            os.contextMenu({ clientX: vertical ? r.right : r.left, clientY: vertical ? r.top : r.bottom }, items)
          }}
        >
          »
        </button>
      )}
    </div>
  )
}

function actionEntry(id: ActionId, run: (a: string) => void, opts: { on?: boolean; disabled?: boolean; icon?: string; tip?: string } = {}): Entry {
  return {
    key: id,
    node: <ToolButton id={id} run={run} {...opts} />,
    menu: { label: ACTIONS[id].label, checked: opts.on, disabled: opts.disabled, onClick: () => run(id) },
  }
}

let sepCount = 0
const sep = (): Entry => ({ key: `sep${sepCount++}`, node: <Sep />, sep: true })

// ------------------------------------------------------------- top toolbar

const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24]

export function TopToolbar({
  st, meta, flags, run, onStyle, onMeta,
}: {
  st: EditorSnapshot
  meta: DocMeta
  flags: ToolbarFlags
  run: (action: string) => void
  onStyle: (code: StyleCode) => void
  onMeta: (patch: Partial<DocMeta>) => void
}) {
  sepCount = 0
  const chapterOk = classSupportsChapter(meta.documentclass)
  const frameOk = meta.documentclass.toLowerCase() === 'beamer'
  const align = st.align ?? 'left'
  const classes = TEMPLATE_CHOICES.includes(meta.documentclass) ? TEMPLATE_CHOICES : [...TEMPLATE_CHOICES, meta.documentclass]
  const isHeading = st.style === 'chapter' || /^h\d$/.test(st.style ?? '')
  const styleTip = (code: StyleCode) =>
    code === 'chapter' && !chapterOk
      ? `Chapter is only available in the book, report and memoir document classes — the current class is '${meta.documentclass}'.`
      : code === 'frame' && !frameOk
        ? `Frame is only available in the beamer document class — the current class is '${meta.documentclass}'.`
        : undefined

  const entries: Entry[] = [
    actionEntry('new', run),
    actionEntry('open', run),
    actionEntry('save', run),
    actionEntry('exportPdf', run),
    actionEntry('print', run),
    actionEntry('openProject', run),
    sep(),
    actionEntry('undo', run, { disabled: !st.canUndo }),
    actionEntry('redo', run, { disabled: !st.canRedo }),
    sep(),
    {
      key: 'style',
      node: (
        <select
          className="ktx-combo ktx-style-combo"
          value={st.style ?? 'body'}
          onChange={(e) => onStyle(e.target.value as StyleCode)}
        >
          {STYLES.map(([code, label]) => (
            <option key={code} value={code} disabled={(code === 'chapter' && !chapterOk) || (code === 'frame' && !frameOk)} title={styleTip(code)}>
              {label}
            </option>
          ))}
        </select>
      ),
      menu: {
        label: 'Paragraph style',
        submenu: STYLES.map(([code, label]) => ({
          label,
          checked: (st.style ?? 'body') === code,
          disabled: (code === 'chapter' && !chapterOk) || (code === 'frame' && !frameOk),
          onClick: () => onStyle(code),
        })),
      },
    },
    {
      key: 'numbered',
      node: (
        <label className={`ktx-tb-check${isHeading ? '' : ' disabled'}`} title="Uncheck to produce \section*{} (unnumbered, hidden from table of contents)">
          <input
            type="checkbox"
            disabled={!isHeading}
            checked={isHeading ? !!st.numbered : true}
            onChange={(e) => run(e.target.checked ? 'numberedOn' : 'numberedOff')}
          />
          Numbered
        </label>
      ),
      menu: { label: 'Numbered', checked: isHeading ? !!st.numbered : true, disabled: !isHeading, onClick: () => run(st.numbered ? 'numberedOff' : 'numberedOn') },
    },
    actionEntry('marks', run, { on: flags.marks }),
    {
      key: 'class',
      node: (
        <select className="ktx-combo ktx-class-combo" title="LaTeX document class" value={meta.documentclass} onChange={(e) => onMeta({ documentclass: e.target.value })}>
          {classes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ),
      menu: { label: `Class: ${meta.documentclass}`, submenu: classes.map((c) => ({ label: c, checked: c === meta.documentclass, onClick: () => onMeta({ documentclass: c }) })) },
    },
    {
      key: 'size',
      node: <FontSizeCombo value={meta.body_font_pt} onChange={(pt) => onMeta({ body_font_pt: pt })} />,
      menu: { label: `Body text size: ${meta.body_font_pt} pt`, submenu: FONT_SIZES.map((s) => ({ label: String(s), checked: s === meta.body_font_pt, onClick: () => onMeta({ body_font_pt: s }) })) },
    },
    {
      key: 'paper',
      node: (
        <select className="ktx-combo ktx-paper-combo" title="Page size" value={meta.page_size} onChange={(e) => onMeta({ page_size: e.target.value })}>
          {PAGE_SIZES.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
        </select>
      ),
      menu: { label: `Page size: ${meta.page_size}`, submenu: PAGE_SIZES.map((p) => ({ label: p.code, checked: p.code === meta.page_size, onClick: () => onMeta({ page_size: p.code }) })) },
    },
    sep(),
    actionEntry('bold', run, { on: st.bold }),
    actionEntry('italic', run, { on: st.italic }),
    actionEntry('underline', run, { on: st.underline }),
    actionEntry('strike', run, { on: st.strike }),
    actionEntry('code', run, { on: st.code }),
    actionEntry('smallcaps', run, { on: st.smallcaps }),
    actionEntry('subscript', run, { on: st.subscript }),
    actionEntry('superscript', run, { on: st.superscript }),
    sep(),
    actionEntry('alignLeft', run, { on: align === 'left' }),
    actionEntry('alignCenter', run, { on: align === 'center' }),
    actionEntry('alignRight', run, { on: align === 'right' }),
    actionEntry('alignJustify', run, { on: align === 'justify' }),
    sep(),
    actionEntry('bullet', run, { on: st.bullet }),
    actionEntry('ordered', run, { on: st.ordered }),
    sep(),
    actionEntry('spell', run, { on: flags.spell }),
    sep(),
    actionEntry('highlight', run),
    actionEntry('comment', run),
    actionEntry('acceptComment', run),
    actionEntry('rejectComment', run),
    sep(),
    actionEntry('commitNow', run),
    actionEntry('history', run),
    sep(),
    { key: 'spacer', node: null },
    actionEntry('compileRange', run, {
      on: flags.compileRange,
      tip: flags.compileRange ? 'Compile range: ON — only compile between markers' : 'Compile range: OFF — compile full document',
    }),
    actionEntry('skipImages', run, {
      on: flags.skipImages,
      tip: flags.skipImages ? 'Skip images: ON — images replaced by placeholders' : 'Skip images: OFF — full compile with images',
    }),
    actionEntry('compile', run, { tip: flags.compiling ? 'Compiling…' : undefined }),
    actionEntry('auto', run, {
      on: flags.auto,
      icon: flags.auto ? 'auto-compile-on' : 'auto-compile-off',
      tip: flags.auto ? 'Auto-compile: ON (click to disable)' : 'Auto-compile: OFF (click to enable)',
    }),
  ]
  return <OverflowBar entries={entries} className="ktx-tb ktx-tb-top" />
}

/** The desktop's editable size combo: pick a size or type one (11.5 → 11). */
function FontSizeCombo({ value, onChange }: { value: number; onChange: (pt: number) => void }) {
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const shown = editing ? text : String(value)
  const commit = () => {
    setEditing(false)
    const pt = Math.trunc(parseFloat(text.replace(/pt$/i, '')))
    if (Number.isFinite(pt) && pt >= 4 && pt <= 96 && pt !== value) onChange(pt)
  }
  return (
    <span className="ktx-combo ktx-size-combo" title="Body text font size (pt)">
      <input
        value={shown}
        onFocus={() => {
          setText(String(value))
          setEditing(true)
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          else if (e.key === 'Escape') {
            setEditing(false)
            ;(e.target as HTMLInputElement).blur()
          }
          e.stopPropagation()
        }}
      />
      <select
        aria-label="Body text font size"
        value={FONT_SIZES.includes(value) ? value : ''}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {!FONT_SIZES.includes(value) && <option value="">{value}</option>}
        {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </span>
  )
}

// ------------------------------------------------------- the Insert column

export function SideToolbar({ meta, run }: { meta: DocMeta; run: (action: string) => void }) {
  sepCount = 100
  const cols = meta.column_count || 1
  const entries: Entry[] = [
    actionEntry('mathInline', run),
    actionEntry('mathBlock', run),
    actionEntry('symbol', run),
    actionEntry('equationBuilder', run),
    actionEntry('chemistry', run),
    actionEntry('chemfig', run),
    sep(),
    actionEntry('link', run),
    actionEntry('footnote', run),
    actionEntry('citation', run),
    actionEntry('crossref', run),
    sep(),
    actionEntry('figure', run),
    actionEntry('table', run),
    actionEntry('drawing', run),
    actionEntry('flowchart', run),
    sep(),
    actionEntry('cols1', run, { on: cols <= 1 }),
    actionEntry('cols2', run, { on: cols === 2 }),
    actionEntry('cols3', run, { on: cols >= 3 }),
    sep(),
    actionEntry('pagebreak', run),
    actionEntry('hrule', run),
  ]
  return <OverflowBar entries={entries} className="ktx-tb ktx-tb-side" vertical />
}
