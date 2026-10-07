// The formatting toolbar along the top and the Insert toolbar down the left,
// as in the desktop KherveTeX. Every button runs a named action of the window.

import type { LucideIcon } from 'lucide-react'
import {
  Asterisk, Bold, CaseSensitive, CircleCheck, CircleX, Code, Columns2, Columns3, Crop, Hash, Highlighter, Image, ImageOff,
  Italic, Link, List, ListOrdered, MessageSquarePlus, Minus, Omega, PanelRight, Pilcrow, Play, Quote, Redo2, RefreshCw,
  RectangleVertical, SeparatorHorizontal, Sigma, SquareFunction, Strikethrough, Subscript, Superscript, Table,
  TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart, Underline, Undo2,
} from 'lucide-react'
import type { DocMeta } from '../model'
import { classSupportsChapter } from '../model'
import { PAGE_SIZES } from '../pageSizes'
import { TEMPLATE_CHOICES } from './dialogs'

export type StyleCode =
  | 'body' | 'title' | 'author' | 'affiliation' | 'correspondence' | 'abstract' | 'keywords' | 'frame' | 'chapter'
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5'

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
  pdf: boolean
  marks: boolean
  compiling: boolean
}

function Btn({ icon: Icon, title, on, disabled, action, run }: { icon: LucideIcon; title: string; on?: boolean; disabled?: boolean; action: string; run: (a: string) => void }) {
  return (
    <button
      className={`k-icon-btn${on ? ' active' : ''}`}
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(action)}
    >
      <Icon size={16} />
    </button>
  )
}

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
  const chapterOk = classSupportsChapter(meta.documentclass)
  const frameOk = meta.documentclass.toLowerCase() === 'beamer'
  const align = st.align ?? ''
  const classes = TEMPLATE_CHOICES.includes(meta.documentclass) ? TEMPLATE_CHOICES : [meta.documentclass, ...TEMPLATE_CHOICES]
  const sizes = FONT_SIZES.includes(meta.body_font_pt) ? FONT_SIZES : [...FONT_SIZES, meta.body_font_pt].sort((a, b) => a - b)
  return (
    <div className="k-toolbar ktx-toolbar">
      <Btn icon={Undo2} title="Undo (⌘Z)" action="undo" disabled={!st.canUndo} run={run} />
      <Btn icon={Redo2} title="Redo (⇧⌘Z)" action="redo" disabled={!st.canRedo} run={run} />
      <span className="k-sep" />
      <select
        className="k-input ktx-select ktx-style-select"
        title="Paragraph style"
        value={st.style ?? ''}
        disabled={st.style === null}
        onChange={(e) => onStyle(e.target.value as StyleCode)}
      >
        {st.style === null && <option value="">—</option>}
        {STYLES.map(([code, label]) => (
          <option
            key={code}
            value={code}
            disabled={(code === 'chapter' && !chapterOk) || (code === 'frame' && !frameOk)}
            title={code === 'chapter' && !chapterOk ? 'Chapters need a class like book, report or memoir' : code === 'frame' && !frameOk ? 'Frames need the beamer class' : undefined}
          >
            {label}
          </option>
        ))}
      </select>
      <label className="ktx-check small" title="Unnumbered headings are written \section*{} and left out of the contents">
        <input type="checkbox" disabled={st.numbered === null} checked={st.numbered ?? true} onChange={(e) => run(e.target.checked ? 'numberedOn' : 'numberedOff')} />
        Numbered
      </label>
      <Btn icon={Pilcrow} title="Show formatting marks" action="marks" on={flags.marks} run={run} />
      <span className="k-sep" />
      <input
        className="k-input ktx-select ktx-class"
        title="LaTeX document class"
        list="ktx-toolbar-classes"
        value={meta.documentclass}
        onChange={(e) => onMeta({ documentclass: e.target.value })}
        onBlur={(e) => !e.target.value.trim() && onMeta({ documentclass: 'article' })}
      />
      <datalist id="ktx-toolbar-classes">
        {classes.map((c) => <option key={c} value={c} />)}
      </datalist>
      <select className="k-input ktx-select ktx-size" title="Body text size (pt)" value={meta.body_font_pt} onChange={(e) => onMeta({ body_font_pt: Number(e.target.value) })}>
        {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select className="k-input ktx-select ktx-paper" title="Paper size" value={meta.page_size} onChange={(e) => onMeta({ page_size: e.target.value })}>
        {PAGE_SIZES.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
      </select>
      <span className="k-sep" />
      <Btn icon={Bold} title="Bold (⌘B)" action="bold" on={st.bold} run={run} />
      <Btn icon={Italic} title="Italic (⌘I)" action="italic" on={st.italic} run={run} />
      <Btn icon={Underline} title="Underline (⌘U)" action="underline" on={st.underline} run={run} />
      <Btn icon={Strikethrough} title="Strikethrough (⇧⌘X)" action="strike" on={st.strike} run={run} />
      <Btn icon={Code} title="Code — monospace (⌘E)" action="code" on={st.code} run={run} />
      <Btn icon={CaseSensitive} title="Small caps" action="smallcaps" on={st.smallcaps} run={run} />
      <Btn icon={Subscript} title="Subscript (⌘,)" action="subscript" on={st.subscript} run={run} />
      <Btn icon={Superscript} title="Superscript (⌘.)" action="superscript" on={st.superscript} run={run} />
      <span className="k-sep" />
      <Btn icon={TextAlignStart} title="Align left (\begin{flushleft})" action="alignLeft" on={align === 'left'} disabled={st.align === null} run={run} />
      <Btn icon={TextAlignCenter} title="Centre" action="alignCenter" on={align === 'center'} disabled={st.align === null} run={run} />
      <Btn icon={TextAlignEnd} title="Align right" action="alignRight" on={align === 'right'} disabled={st.align === null} run={run} />
      <Btn icon={TextAlignJustify} title="Justify (LaTeX's default)" action="alignJustify" on={align === 'justify'} disabled={st.align === null} run={run} />
      <span className="k-sep" />
      <Btn icon={List} title="Bullet list" action="bullet" on={st.bullet} run={run} />
      <Btn icon={ListOrdered} title="Numbered list" action="ordered" on={st.ordered} run={run} />
      <span className="k-sep" />
      <Btn icon={Highlighter} title="Highlight (⇧⌘H)" action="highlight" disabled={!st.hasSelection} run={run} />
      <Btn icon={MessageSquarePlus} title="New comment on the selection (⌥⌘M)" action="comment" disabled={!st.hasSelection} run={run} />
      <Btn icon={CircleCheck} title="Accept the comment (keep the text)" action="acceptComment" disabled={!st.inComment} run={run} />
      <Btn icon={CircleX} title="Reject the comment (delete the text)" action="rejectComment" disabled={!st.inComment} run={run} />
      <span className="k-spacer" />
      <Btn icon={Crop} title="Compile range: only compile between the compile markers" action="compileRange" on={flags.compileRange} run={run} />
      <Btn icon={ImageOff} title="Skip images for a faster preview" action="skipImages" on={flags.skipImages} run={run} />
      <button className={`k-btn small ktx-compile${flags.compiling ? ' busy' : ''}`} title="Compile the PDF now (⌘↩)" onMouseDown={(e) => e.preventDefault()} onClick={() => run('compile')}>
        <Play size={13} /> Compile
      </button>
      <Btn icon={RefreshCw} title={flags.auto ? 'Auto-compile is on (click to turn off)' : 'Auto-compile is off (click to turn on)'} action="auto" on={flags.auto} run={run} />
      <Btn icon={PanelRight} title="PDF side panel (⌘4)" action="pdf" on={flags.pdf} run={run} />
    </div>
  )
}

export function SideToolbar({ meta, run }: { meta: DocMeta; run: (action: string) => void }) {
  const cols = meta.column_count
  return (
    <div className="ktx-side">
      <Btn icon={Sigma} title="Inline maths (⌘M)" action="mathInline" run={run} />
      <Btn icon={SquareFunction} title="Display equation (⇧⌘M)" action="mathBlock" run={run} />
      <Btn icon={Omega} title="Symbol (⇧⌘G)" action="symbol" run={run} />
      <span className="ktx-side-sep" />
      <Btn icon={Link} title="Hyperlink (⌘K)" action="link" run={run} />
      <Btn icon={Asterisk} title="Footnote" action="footnote" run={run} />
      <Btn icon={Quote} title="Citation" action="citation" run={run} />
      <Btn icon={Hash} title="Cross-reference" action="crossref" run={run} />
      <span className="ktx-side-sep" />
      <Btn icon={Image} title="Figure" action="figure" run={run} />
      <Btn icon={Table} title="Table" action="table" run={run} />
      <span className="ktx-side-sep" />
      <Btn icon={RectangleVertical} title="One column" action="cols1" on={cols <= 1} run={run} />
      <Btn icon={Columns2} title="Two columns" action="cols2" on={cols === 2} run={run} />
      <Btn icon={Columns3} title="Three columns" action="cols3" on={cols >= 3} run={run} />
      <span className="ktx-side-sep" />
      <Btn icon={SeparatorHorizontal} title="Page break" action="pagebreak" run={run} />
      <Btn icon={Minus} title="Horizontal rule" action="hrule" run={run} />
    </div>
  )
}
