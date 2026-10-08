// The ribbon: Home, Insert, Layout, References, Review, View (and Table
// while the cursor is in a table), like Word's.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownToLine, BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, Bold, BookOpen, CalendarDays, Captions,
  CaseSensitive, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Columns3, Copy, Eraser, FileDown, FilePlus, FileText, Footprints,
  Globe, Grid3x3, Hash, Heading, Highlighter, ImagePlus, Italic, Link, List, ListIndentDecrease, ListIndentIncrease, ListOrdered, ListTree,
  MessageSquare, MessageSquarePlus, Minus, Monitor, Omega, PaintBucket, Paintbrush, PanelLeft, PanelRight, Pilcrow, Printer, Rows3, Ruler,
  Scissors, Search, SeparatorHorizontal, Sigma, SpellCheck, Square, Strikethrough, Subscript, Superscript, TableCellsMerge, TableCellsSplit,
  Table as TableIcon, TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart, Trash, Type, Underline, X, ZoomIn, ZoomOut, Replace,
  RectangleHorizontal, RectangleVertical, FileDiff, PencilLine, LayoutTemplate, Save, Undo2, Redo2,
} from 'lucide-react'
import { FONTS, MARGIN_PRESETS, PAGE_SIZES, resolveStyle, type DocSettings, type StyleDef } from '../model'
import {
  FONT_SIZES, applyStyle, changeCase, clearFormatting, growFont, indent, setCellBackground, setColor, setFont, setFontSize, setHighlight, setLineHeight,
  setParagraph, setTableBorders, toggleList, type Snapshot,
} from '../commands'
import type { WordActions } from './types'

export type RibbonTab = 'home' | 'insert' | 'layout' | 'references' | 'review' | 'view' | 'table'

const TEXT_COLORS = [
  '#000000', '#404040', '#7f7f7f', '#bfbfbf', '#ffffff', '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0',
  '#002060', '#7030a0', '#2f5496', '#1f3864', '#833c0b', '#538135', '#bf8f00',
]
const HIGHLIGHT_COLORS = ['#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#0000ff', '#ff0000', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0', '#000000']

// ------------------------------------------------------------------ pieces

function Btn({ icon: Icon, label, onClick, active, disabled, big, title, children }: { icon?: LucideIcon; label?: string; onClick?: () => void; active?: boolean; disabled?: boolean; big?: boolean; title?: string; children?: ReactNode }) {
  return (
    <button
      className={`kw-rb${big ? ' big' : ''}${active ? ' active' : ''}`}
      disabled={disabled}
      title={title ?? label}
      aria-label={title ?? label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {Icon && <Icon size={big ? 22 : 15} strokeWidth={big ? 1.6 : 2} />}
      {label && (big || !Icon) && <span>{label}</span>}
      {children}
    </button>
  )
}

/** A button that opens a small panel under it (drawn in the app's root, so the ribbon's scrolling does not clip it). */
function Drop({ icon, label, title, big, children, active, width }: { icon?: LucideIcon; label?: string; title?: string; big?: boolean; active?: boolean; width?: number; children: (close: () => void) => ReactNode }) {
  const [pos, setPos] = useState<{ root: HTMLElement; left: number; top: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const open = !!pos
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !popRef.current?.contains(t)) setPos(null)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  // Keep the panel inside the window.
  useLayoutEffect(() => {
    const el = popRef.current
    if (!pos || !el) return
    const max = pos.root.clientWidth - el.offsetWidth - 4
    if (pos.left > max) setPos({ ...pos, left: Math.max(4, max) })
  }, [pos])
  const toggle = () => {
    if (open) return setPos(null)
    const root = ref.current?.closest('.kw-app') as HTMLElement | null
    if (!root || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const rr = root.getBoundingClientRect()
    setPos({ root, left: r.left - rr.left, top: r.bottom - rr.top + 2 })
  }
  return (
    <span className="kw-drop" ref={ref}>
      <Btn icon={icon} label={label} title={title ?? label} big={big} active={active || open} onClick={toggle}>
        <ChevronDown size={10} className="kw-caret" />
      </Btn>
      {pos &&
        createPortal(
          <div
            ref={popRef}
            className="kw-pop"
            style={{ left: pos.left, top: pos.top, ...(width ? { width } : {}) }}
            onMouseDown={(e) => (e.target as HTMLElement).tagName !== 'INPUT' && e.preventDefault()}
          >
            {children(() => setPos(null))}
          </div>,
          pos.root,
        )}
    </span>
  )
}

function MenuRow({ icon: Icon, label, onClick, checked }: { icon?: LucideIcon; label: string; onClick: () => void; checked?: boolean }) {
  return (
    <button className="kw-pop-row" onClick={onClick}>
      <span className="kw-pop-icon">{checked ? <Check size={14} /> : Icon ? <Icon size={14} /> : null}</span>
      {label}
    </button>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kw-group">
      <div className="kw-group-body">{children}</div>
      <div className="kw-group-label">{label}</div>
    </div>
  )
}

function Palette({ colors, onPick, none, noneLabel }: { colors: string[]; onPick: (c: string | null) => void; none?: boolean; noneLabel?: string }) {
  return (
    <div className="kw-palette">
      {none && (
        <button className="kw-pop-row" onClick={() => onPick(null)}>
          <span className="kw-pop-icon">
            <X size={14} />
          </span>
          {noneLabel ?? 'None'}
        </button>
      )}
      <div className="kw-swatches">
        {colors.map((c) => (
          <button key={c} className="kw-swatch" style={{ background: c }} title={c} onClick={() => onPick(c)} />
        ))}
      </div>
      <label className="kw-pop-row">
        <span className="kw-pop-icon">
          <PaintBucket size={14} />
        </span>
        More colours…
        <input type="color" className="kw-color-input" onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  )
}

function TableGrid({ onPick }: { onPick: (r: number, c: number) => void }) {
  const [hover, setHover] = useState({ r: 0, c: 0 })
  return (
    <div className="kw-tgrid-wrap">
      <div className="kw-tgrid-label">{hover.r ? `${hover.c} × ${hover.r} table` : 'Insert a table'}</div>
      <div className="kw-tgrid" onMouseLeave={() => setHover({ r: 0, c: 0 })}>
        {Array.from({ length: 8 }, (_, r) =>
          Array.from({ length: 10 }, (_, c) => (
            <span key={`${r}-${c}`} className={`kw-tcell${r < hover.r && c < hover.c ? ' on' : ''}`} onMouseEnter={() => setHover({ r: r + 1, c: c + 1 })} onClick={() => onPick(r + 1, c + 1)} />
          )),
        )}
      </div>
    </div>
  )
}

function StylesGallery({ editor, styles, current, actions }: { editor: Editor; styles: Record<string, StyleDef>; current: string; actions: WordActions }) {
  const quick = Object.values(styles).filter((s) => s.quick)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])
  return (
    <div className="kw-gallery">
      {quick.map((s) => {
        const r = resolveStyle(styles, s.id)
        return (
          <button
            key={s.id}
            className={`kw-style-tile${current === s.id ? ' active' : ''}`}
            title={`${s.name} — right-click to modify`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyStyle(editor, s.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ id: s.id, x: e.clientX, y: e.clientY })
            }}
          >
            <span
              className="kw-style-sample"
              style={{ fontWeight: r.bold ? 700 : 400, fontStyle: r.italic ? 'italic' : 'normal', color: r.color && r.color !== '#000000' ? r.color : undefined, fontSize: Math.min(17, Math.max(10, (r.size ?? 11) * 0.9)) }}
            >
              AaBbCc
            </span>
            <span className="kw-style-name">{s.name}</span>
          </button>
        )
      })}
      {menu && (
        <div className="kw-pop kw-ctx" style={{ position: 'fixed', left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <MenuRow label="Update to Match Selection" onClick={() => (actions.updateStyleFromSelection(menu.id), setMenu(null))} />
          <MenuRow icon={PencilLine} label="Modify…" onClick={() => (actions.modifyStyle(menu.id), setMenu(null))} />
          <MenuRow icon={FilePlus} label="New Style from Selection…" onClick={() => (actions.newStyle(), setMenu(null))} />
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ the ribbon

export function Ribbon({ tab, setTab, editor, snap, settings, actions }: { tab: RibbonTab; setTab: (t: RibbonTab) => void; editor: Editor; snap: Snapshot; settings: DocSettings; actions: WordActions }) {
  const [lastColor, setLastColor] = useState('#c00000')
  const [lastHighlight, setLastHighlight] = useState('#ffff00')
  const [sizeText, setSizeText] = useState(String(snap.size))
  useEffect(() => setSizeText(String(snap.size)), [snap.size])
  const tabs: [RibbonTab, string][] = [
    ['home', 'Home'],
    ['insert', 'Insert'],
    ['layout', 'Layout'],
    ['references', 'References'],
    ['review', 'Review'],
    ['view', 'View'],
  ]
  if (snap.inTable) tabs.push(['table', 'Table'])
  const t = tab === 'table' && !snap.inTable ? 'home' : tab
  const chain = () => editor.chain().focus()

  return (
    <div className="kw-ribbon">
      <div className="kw-tabs" role="tablist">
        <Drop label="File" title="File">
          {(close) => (
            <div className="kw-filemenu" onClick={close}>
              <MenuRow icon={FilePlus} label="New blank document" onClick={actions.newDoc} />
              <MenuRow icon={LayoutTemplate} label="New from template…" onClick={() => actions.newFromTemplate()} />
              <MenuRow icon={BookOpen} label="Open…" onClick={actions.open} />
              <MenuRow icon={ArrowDownToLine} label="Save" onClick={() => void actions.save()} />
              <MenuRow label="Save As…" onClick={() => void actions.saveAs()} />
              <MenuRow icon={FileDown} label="Export PDF (print dialog)…" onClick={actions.exportPdf} />
              <MenuRow label="Export PDF to the drive…" onClick={actions.exportPdfToDrive} />
              <MenuRow icon={Printer} label="Print…" onClick={actions.print} />
            </div>
          )}
        </Drop>
        <span className="kw-qat">
          <Btn icon={Save} title="Save (⌘S)" onClick={() => void actions.save()} />
          <Btn icon={Undo2} title="Undo (⌘Z)" disabled={!snap.canUndo} onClick={() => chain().undo().run()} />
          <Btn icon={Redo2} title="Redo (⇧⌘Z)" disabled={!snap.canRedo} onClick={() => chain().redo().run()} />
        </span>
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={t === id} className={`kw-tab${t === id ? ' active' : ''}${id === 'table' ? ' contextual' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="kw-panel">
        {t === 'home' && (
          <>
            <Group label="Clipboard">
              <Btn big icon={ClipboardPaste} label="Paste" onClick={actions.paste} title="Paste (⌘V)" />
              <div className="kw-col">
                <Btn icon={Scissors} title="Cut (⌘X)" onClick={() => actions.copy(true)} />
                <Btn icon={Copy} title="Copy (⌘C)" onClick={() => actions.copy(false)} />
                <span onDoubleClick={() => actions.painter(true)}>
                  <Btn icon={Paintbrush} title="Format Painter (double-click to keep it on)" active={actions.painterOn} onClick={() => actions.painter(false)} />
                </span>
              </div>
            </Group>
            <Group label="Font">
              <div className="kw-col wide">
                <div className="kw-line">
                  <select className="kw-select kw-font" value={snap.font} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => setFont(editor, e.target.value)} title="Font">
                    {[...new Set([snap.font, ...FONTS])].map((f) => (
                      <option key={f} value={f} style={{ fontFamily: f }}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <input
                    className="kw-select kw-size"
                    list="kw-sizes"
                    value={sizeText}
                    title="Font size"
                    onChange={(e) => setSizeText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = parseFloat(sizeText)
                        if (v > 0 && v < 1639) setFontSize(editor, v)
                      }
                    }}
                    onBlur={() => {
                      const v = parseFloat(sizeText)
                      if (v > 0 && v !== snap.size) setFontSize(editor, v)
                    }}
                  />
                  <datalist id="kw-sizes">
                    {FONT_SIZES.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  <Btn icon={Type} title="Grow Font (⌘])" onClick={() => growFont(editor, snap.size, 1)}>
                    <span className="kw-sup">+</span>
                  </Btn>
                  <Btn icon={Type} title="Shrink Font (⌘[)" onClick={() => growFont(editor, snap.size, -1)}>
                    <span className="kw-sup">−</span>
                  </Btn>
                  <Drop icon={CaseSensitive} title="Change Case">
                    {(close) => (
                      <div onClick={close}>
                        <MenuRow label="Sentence case." onClick={() => changeCase(editor, 'sentence')} />
                        <MenuRow label="lowercase" onClick={() => changeCase(editor, 'lower')} />
                        <MenuRow label="UPPERCASE" onClick={() => changeCase(editor, 'upper')} />
                        <MenuRow label="Capitalise Each Word" onClick={() => changeCase(editor, 'title')} />
                        <MenuRow label="tOGGLE cASE" onClick={() => changeCase(editor, 'toggle')} />
                      </div>
                    )}
                  </Drop>
                  <Btn icon={Eraser} title="Clear All Formatting" onClick={() => clearFormatting(editor)} />
                </div>
                <div className="kw-line">
                  <Btn icon={Bold} title="Bold (⌘B)" active={snap.bold} onClick={() => chain().toggleBold().run()} />
                  <Btn icon={Italic} title="Italic (⌘I)" active={snap.italic} onClick={() => chain().toggleItalic().run()} />
                  <Btn icon={Underline} title="Underline (⌘U)" active={snap.underline} onClick={() => chain().toggleUnderline().run()} />
                  <Btn icon={Strikethrough} title="Strikethrough" active={snap.strike} onClick={() => chain().toggleStrike().run()} />
                  <Btn icon={Subscript} title="Subscript (⌘=)" active={snap.sub} onClick={() => chain().unsetSuperscript().toggleSubscript().run()} />
                  <Btn icon={Superscript} title="Superscript (⇧⌘=)" active={snap.sup} onClick={() => chain().unsetSubscript().toggleSuperscript().run()} />
                  <span className="kw-split">
                    <Btn icon={Type} title="Font Colour" onClick={() => setColor(editor, lastColor)}>
                      <span className="kw-colorbar" style={{ background: lastColor }} />
                    </Btn>
                    <Drop title="Font Colour" width={196}>
                      {(close) => (
                        <Palette
                          colors={TEXT_COLORS}
                          none
                          noneLabel="Automatic"
                          onPick={(c) => {
                            if (c) setLastColor(c)
                            setColor(editor, c)
                            close()
                          }}
                        />
                      )}
                    </Drop>
                  </span>
                  <span className="kw-split">
                    <Btn icon={Highlighter} title="Text Highlight Colour" onClick={() => setHighlight(editor, lastHighlight)}>
                      <span className="kw-colorbar" style={{ background: lastHighlight }} />
                    </Btn>
                    <Drop title="Text Highlight Colour" width={196}>
                      {(close) => (
                        <Palette
                          colors={HIGHLIGHT_COLORS}
                          none
                          noneLabel="No Colour"
                          onPick={(c) => {
                            if (c) setLastHighlight(c)
                            setHighlight(editor, c)
                            close()
                          }}
                        />
                      )}
                    </Drop>
                  </span>
                </div>
              </div>
            </Group>
            <Group label="Paragraph">
              <div className="kw-col wide">
                <div className="kw-line">
                  <span className="kw-split">
                    <Btn icon={List} title="Bullets" active={snap.list === 'bullet'} onClick={() => toggleList(editor, 'bullet', undefined, snap)} />
                    <Drop title="Bullet Library">
                      {(close) => (
                        <div onClick={close}>
                          <MenuRow label="•  Disc" checked={snap.list === 'bullet' && !snap.listStyle} onClick={() => toggleList(editor, 'bullet', null, snap)} />
                          <MenuRow label="◦  Circle" checked={snap.listStyle === 'circle'} onClick={() => toggleList(editor, 'bullet', 'circle', snap)} />
                          <MenuRow label="▪  Square" checked={snap.listStyle === 'square'} onClick={() => toggleList(editor, 'bullet', 'square', snap)} />
                          <MenuRow label="–  Dash" checked={snap.listStyle === 'dash'} onClick={() => toggleList(editor, 'bullet', 'dash', snap)} />
                        </div>
                      )}
                    </Drop>
                  </span>
                  <span className="kw-split">
                    <Btn icon={ListOrdered} title="Numbering" active={snap.list === 'ordered'} onClick={() => toggleList(editor, 'ordered', undefined, snap)} />
                    <Drop title="Numbering Library">
                      {(close) => (
                        <div onClick={close}>
                          <MenuRow label="1. 2. 3." checked={snap.list === 'ordered' && !snap.listStyle} onClick={() => toggleList(editor, 'ordered', null, snap)} />
                          <MenuRow label="a) b) c)" checked={snap.listStyle === 'lower-alpha'} onClick={() => toggleList(editor, 'ordered', 'lower-alpha', snap)} />
                          <MenuRow label="A. B. C." checked={snap.listStyle === 'upper-alpha'} onClick={() => toggleList(editor, 'ordered', 'upper-alpha', snap)} />
                          <MenuRow label="i) ii) iii)" checked={snap.listStyle === 'lower-roman'} onClick={() => toggleList(editor, 'ordered', 'lower-roman', snap)} />
                          <MenuRow label="I. II. III." checked={snap.listStyle === 'upper-roman'} onClick={() => toggleList(editor, 'ordered', 'upper-roman', snap)} />
                        </div>
                      )}
                    </Drop>
                  </span>
                  <Btn icon={ListTree} title="Multilevel List (1, 1.1, 1.1.1)" active={snap.listStyle === 'outline'} onClick={() => toggleList(editor, 'ordered', 'outline', snap)} />
                  <Btn icon={ListIndentDecrease} title="Decrease Indent (⇧Tab in lists)" onClick={() => indent(editor, -1, snap)} />
                  <Btn icon={ListIndentIncrease} title="Increase Indent (Tab in lists)" onClick={() => indent(editor, 1, snap)} />
                  <Btn icon={Pilcrow} title="Show/Hide ¶ (⌘8)" active={actions.marks} onClick={actions.toggleMarks} />
                </div>
                <div className="kw-line">
                  <Btn icon={TextAlignStart} title="Align Left (⌘L)" active={snap.align === 'left'} onClick={() => setParagraph(editor, { align: 'left' })} />
                  <Btn icon={TextAlignCenter} title="Centre (⌘E)" active={snap.align === 'center'} onClick={() => setParagraph(editor, { align: 'center' })} />
                  <Btn icon={TextAlignEnd} title="Align Right (⌘R)" active={snap.align === 'right'} onClick={() => setParagraph(editor, { align: 'right' })} />
                  <Btn icon={TextAlignJustify} title="Justify (⌘J)" active={snap.align === 'justify'} onClick={() => setParagraph(editor, { align: 'justify' })} />
                  <Drop icon={Rows3} title="Line and Paragraph Spacing">
                    {(close) => (
                      <div onClick={close}>
                        {[1, 1.15, 1.5, 2, 2.5, 3].map((v) => (
                          <MenuRow key={v} label={v.toFixed(v % 1 ? 2 : 1).replace(/0$/, '')} checked={Math.abs(snap.lineHeight - v) < 0.01} onClick={() => setLineHeight(editor, v)} />
                        ))}
                        <MenuRow label="Add Space Before Paragraph" onClick={() => setParagraph(editor, { spaceBefore: snap.spaceBefore ? 0 : 12 })} />
                        <MenuRow label="Remove Space After Paragraph" onClick={() => setParagraph(editor, { spaceAfter: snap.spaceAfter ? 0 : 8 })} />
                        <MenuRow label="Line Spacing Options…" onClick={() => actions.dialog('paragraph')} />
                      </div>
                    )}
                  </Drop>
                  <Drop icon={PaintBucket} title="Shading" width={196}>
                    {(close) => <Palette colors={TEXT_COLORS} none noneLabel="No Colour" onPick={(c) => (snap.inTable ? setCellBackground(editor, c) : setParagraph(editor, { shading: c }), close())} />}
                  </Drop>
                  <Drop icon={Square} title="Borders">
                    {(close) => (
                      <div onClick={close}>
                        <MenuRow label="Bottom Border" onClick={() => setParagraph(editor, { border: 'bottom' })} />
                        <MenuRow label="Top Border" onClick={() => setParagraph(editor, { border: 'top' })} />
                        <MenuRow label="Top and Bottom" onClick={() => setParagraph(editor, { border: 'topBottom' })} />
                        <MenuRow label="Box" onClick={() => setParagraph(editor, { border: 'box' })} />
                        <MenuRow label="No Border" onClick={() => setParagraph(editor, { border: null })} />
                        <MenuRow icon={Minus} label="Horizontal Line" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
                      </div>
                    )}
                  </Drop>
                  <Btn icon={Columns3} title="Paragraph Settings…" onClick={() => actions.dialog('paragraph')} />
                </div>
              </div>
            </Group>
            <Group label="Styles">
              <StylesGallery editor={editor} styles={settings.styles} current={snap.style} actions={actions} />
              <div className="kw-col">
                <Btn icon={Heading} title="All styles: modify the current paragraph's style" onClick={() => actions.modifyStyle(snap.style)} />
                <Btn icon={FilePlus} title="New Style from Selection…" onClick={actions.newStyle} />
              </div>
            </Group>
            <Group label="Editing">
              <div className="kw-col">
                <Btn icon={Search} label="Find" title="Find (⌘F)" onClick={() => actions.find(false)}>
                  <span>Find</span>
                </Btn>
                <Btn icon={Replace} title="Replace (⌘H)" onClick={() => actions.find(true)}>
                  <span>Replace</span>
                </Btn>
                <Btn icon={Grid3x3} title="Select All (⌘A)" onClick={() => chain().selectAll().run()}>
                  <span>Select All</span>
                </Btn>
              </div>
            </Group>
          </>
        )}
        {t === 'insert' && (
          <>
            <Group label="Pages">
              <Btn big icon={FilePlus} label="Blank Page" onClick={() => chain().insertContent([{ type: 'pageBreak', attrs: { kind: 'page' } }, { type: 'pageBreak', attrs: { kind: 'page' } }]).run()} />
              <Btn big icon={SeparatorHorizontal} label="Page Break" title="Page Break (⌘Enter)" onClick={() => chain().insertContent({ type: 'pageBreak', attrs: { kind: 'page' } }).run()} />
            </Group>
            <Group label="Tables">
              <Drop big icon={TableIcon} label="Table">
                {(close) => <TableGrid onPick={(r, c) => (actions.insertTable(r, c), close())} />}
              </Drop>
            </Group>
            <Group label="Illustrations">
              <Btn big icon={ImagePlus} label="Picture" title="Insert a picture from the drive" onClick={actions.insertPicture} />
            </Group>
            <Group label="Links">
              <Btn big icon={Link} label="Link" title="Hyperlink (⌘K)" onClick={() => actions.dialog('link')} />
            </Group>
            <Group label="Comments">
              <Btn big icon={MessageSquarePlus} label="Comment" onClick={actions.newComment} />
            </Group>
            <Group label="Header & Footer">
              <Btn big icon={PanelLeft} label="Header & Footer" onClick={() => actions.dialog('headerFooter')} />
              <Btn big icon={Hash} label="Page Number" onClick={() => actions.dialog('headerFooter', { pageNumber: true })} />
            </Group>
            <Group label="Text">
              <div className="kw-col">
                <Btn icon={CalendarDays} title="Date" onClick={actions.insertDate}>
                  <span>Date</span>
                </Btn>
                <Btn icon={Minus} title="Horizontal Line" onClick={() => chain().setHorizontalRule().run()}>
                  <span>Line</span>
                </Btn>
                <Btn icon={Captions} title="Caption" onClick={() => actions.insertCaption('Figure')}>
                  <span>Caption</span>
                </Btn>
              </div>
            </Group>
            <Group label="Symbols">
              <Btn big icon={Sigma} label="Equation" onClick={() => actions.dialog('equation')} />
              <Btn big icon={Omega} label="Symbol" onClick={() => actions.dialog('symbol')} />
            </Group>
          </>
        )}
        {t === 'layout' && (
          <>
            <Group label="Page Setup">
              <Drop big icon={Square} label="Margins">
                {(close) => (
                  <div onClick={close}>
                    {Object.entries(MARGIN_PRESETS).map(([k, v]) => (
                      <MenuRow key={k} label={v.label} onClick={() => actions.setMargins(k)} />
                    ))}
                    <MenuRow label="Custom Margins…" onClick={() => actions.dialog('pageSetup')} />
                  </div>
                )}
              </Drop>
              <Drop big icon={settings.page.orientation === 'portrait' ? RectangleVertical : RectangleHorizontal} label="Orientation">
                {(close) => (
                  <div onClick={close}>
                    <MenuRow icon={RectangleVertical} label="Portrait" checked={settings.page.orientation === 'portrait'} onClick={() => actions.setOrientation('portrait')} />
                    <MenuRow icon={RectangleHorizontal} label="Landscape" checked={settings.page.orientation === 'landscape'} onClick={() => actions.setOrientation('landscape')} />
                  </div>
                )}
              </Drop>
              <Drop big icon={FileText} label="Size">
                {(close) => (
                  <div onClick={close}>
                    {Object.entries(PAGE_SIZES).map(([k, v]) => (
                      <MenuRow key={k} label={v.label} checked={settings.page.size === k} onClick={() => actions.setSize(k)} />
                    ))}
                    <MenuRow label="More Paper Sizes…" onClick={() => actions.dialog('pageSetup')} />
                  </div>
                )}
              </Drop>
              <Drop big icon={SeparatorHorizontal} label="Breaks">
                {(close) => (
                  <div onClick={close}>
                    <MenuRow label="Page break" onClick={() => chain().insertContent({ type: 'pageBreak', attrs: { kind: 'page' } }).run()} />
                    <MenuRow label="Section break (next page)" onClick={() => chain().insertContent({ type: 'pageBreak', attrs: { kind: 'section' } }).run()} />
                  </div>
                )}
              </Drop>
              <Btn big icon={Ruler} label="Page Setup…" onClick={() => actions.dialog('pageSetup')} />
            </Group>
            <Group label="Paragraph">
              <div className="kw-col wide">
                <div className="kw-line kw-numline">
                  <span className="kw-numlabel">Indent left</span>
                  <NumBox value={snap.indentLeft / 28.3465} suffix="cm" onSet={(v) => setParagraph(editor, { indentLeft: v * 28.3465 })} />
                  <span className="kw-numlabel">Spacing before</span>
                  <NumBox value={snap.spaceBefore} step={6} suffix="pt" onSet={(v) => setParagraph(editor, { spaceBefore: v })} />
                </div>
                <div className="kw-line kw-numline">
                  <span className="kw-numlabel">Indent right</span>
                  <NumBox value={snap.indentRight / 28.3465} suffix="cm" onSet={(v) => setParagraph(editor, { indentRight: v * 28.3465 })} />
                  <span className="kw-numlabel">Spacing after</span>
                  <NumBox value={snap.spaceAfter} step={6} suffix="pt" onSet={(v) => setParagraph(editor, { spaceAfter: v })} />
                </div>
              </div>
            </Group>
          </>
        )}
        {t === 'references' && (
          <>
            <Group label="Table of Contents">
              <Btn big icon={ListTree} label="Table of Contents" title="Insert a table of contents (it follows the headings by itself)" onClick={actions.insertTOC} />
            </Group>
            <Group label="Footnotes">
              <Btn big icon={Footprints} label="Insert Footnote" onClick={actions.insertFootnote} />
            </Group>
            <Group label="Captions">
              <Btn big icon={Captions} label="Figure Caption" onClick={() => actions.insertCaption('Figure')} />
              <Btn big icon={TableIcon} label="Table Caption" onClick={() => actions.insertCaption('Table')} />
              <Btn big icon={Sigma} label="Equation Caption" onClick={() => actions.insertCaption('Equation')} />
            </Group>
          </>
        )}
        {t === 'review' && (
          <>
            <Group label="Proofing">
              <Btn big icon={SpellCheck} label="Spelling" title="Check spelling as you type (the browser's dictionary)" active={actions.spell} onClick={actions.toggleSpell} />
              <Btn big icon={Hash} label="Word Count" onClick={() => actions.dialog('wordCount')} />
            </Group>
            <Group label="Comments">
              <Btn big icon={MessageSquarePlus} label="New Comment" title="New Comment (⌥⌘M)" onClick={actions.newComment} />
              <div className="kw-col">
                <Btn icon={Trash} title="Delete Comment" onClick={() => actions.deleteComment()}>
                  <span>Delete</span>
                </Btn>
                <Btn icon={ChevronLeft} title="Previous Comment" onClick={() => actions.gotoComment(-1)}>
                  <span>Previous</span>
                </Btn>
                <Btn icon={ChevronRight} title="Next Comment" onClick={() => actions.gotoComment(1)}>
                  <span>Next</span>
                </Btn>
              </div>
              <Btn big icon={MessageSquare} label="Show Comments" active={actions.comments} onClick={actions.toggleComments} />
            </Group>
            <Group label="Tracking">
              <Btn big icon={FileDiff} label="Track Changes" title="Track Changes (⇧⌘E)" active={actions.track} onClick={actions.toggleTrack} />
              <div className="kw-col">
                <Btn icon={PencilLine} title="Change the name shown on your changes and comments" onClick={actions.setAuthor}>
                  <span className="kw-author">{actions.author}</span>
                </Btn>
              </div>
            </Group>
            <Group label="Changes">
              <Drop big icon={Check} label="Accept">
                {(close) => (
                  <div onClick={close}>
                    <MenuRow label="Accept This Change" onClick={() => actions.review(true, 'selection')} />
                    <MenuRow label="Accept All Changes" onClick={() => actions.review(true, 'all')} />
                  </div>
                )}
              </Drop>
              <Drop big icon={X} label="Reject">
                {(close) => (
                  <div onClick={close}>
                    <MenuRow label="Reject This Change" onClick={() => actions.review(false, 'selection')} />
                    <MenuRow label="Reject All Changes" onClick={() => actions.review(false, 'all')} />
                  </div>
                )}
              </Drop>
              <div className="kw-col">
                <Btn icon={ChevronLeft} title="Previous Change" onClick={() => actions.gotoChange(-1)}>
                  <span>Previous</span>
                </Btn>
                <Btn icon={ChevronRight} title="Next Change" onClick={() => actions.gotoChange(1)}>
                  <span>Next</span>
                </Btn>
              </div>
            </Group>
          </>
        )}
        {t === 'view' && (
          <>
            <Group label="Views">
              <Btn big icon={FileText} label="Print Layout" active={actions.view === 'print'} onClick={() => actions.setView('print')} />
              <Btn big icon={Globe} label="Web Layout" active={actions.view === 'web'} onClick={() => actions.setView('web')} />
            </Group>
            <Group label="Show">
              <div className="kw-col">
                <Btn icon={Ruler} title="Ruler" active={actions.ruler} onClick={actions.toggleRuler}>
                  <span>Ruler</span>
                </Btn>
                <Btn icon={PanelLeft} title="Navigation Pane" active={actions.nav} onClick={actions.toggleNav}>
                  <span>Navigation Pane</span>
                </Btn>
                <Btn icon={PanelRight} title="Comments and changes" active={actions.comments} onClick={actions.toggleComments}>
                  <span>Comments</span>
                </Btn>
              </div>
              <Btn big icon={Pilcrow} label="Formatting Marks" active={actions.marks} onClick={actions.toggleMarks} />
            </Group>
            <Group label="Zoom">
              <Btn big icon={ZoomIn} label="Zoom In" onClick={() => actions.setZoom(Math.min(5, actions.zoom + 0.1))} />
              <Btn big icon={ZoomOut} label="Zoom Out" onClick={() => actions.setZoom(Math.max(0.25, actions.zoom - 0.1))} />
              <div className="kw-col">
                <Btn icon={Search} title="100%" onClick={() => actions.setZoom(1)}>
                  <span>100%</span>
                </Btn>
                <Btn icon={Monitor} title="Page Width" onClick={() => actions.setZoom('width')}>
                  <span>Page Width</span>
                </Btn>
                <Btn icon={FileText} title="One Page" onClick={() => actions.setZoom('page')}>
                  <span>One Page</span>
                </Btn>
              </div>
            </Group>
          </>
        )}
        {t === 'table' && (
          <>
            <Group label="Rows & Columns">
              <div className="kw-col">
                <Btn icon={BetweenHorizontalStart} title="Insert Above" onClick={() => chain().addRowBefore().run()}>
                  <span>Insert Above</span>
                </Btn>
                <Btn icon={BetweenHorizontalEnd} title="Insert Below" onClick={() => chain().addRowAfter().run()}>
                  <span>Insert Below</span>
                </Btn>
              </div>
              <div className="kw-col">
                <Btn icon={BetweenVerticalStart} title="Insert Left" onClick={() => chain().addColumnBefore().run()}>
                  <span>Insert Left</span>
                </Btn>
                <Btn icon={BetweenVerticalEnd} title="Insert Right" onClick={() => chain().addColumnAfter().run()}>
                  <span>Insert Right</span>
                </Btn>
              </div>
              <Drop big icon={Trash} label="Delete">
                {(close) => (
                  <div onClick={close}>
                    <MenuRow label="Delete Row" onClick={() => chain().deleteRow().run()} />
                    <MenuRow label="Delete Column" onClick={() => chain().deleteColumn().run()} />
                    <MenuRow label="Delete Table" onClick={() => chain().deleteTable().run()} />
                  </div>
                )}
              </Drop>
            </Group>
            <Group label="Merge">
              <Btn big icon={TableCellsMerge} label="Merge Cells" onClick={() => chain().mergeCells().run()} />
              <Btn big icon={TableCellsSplit} label="Split Cells" onClick={() => chain().splitCell().run()} />
            </Group>
            <Group label="Style">
              <Btn big icon={Heading} label="Header Row" active={snap.headerRow} onClick={() => chain().toggleHeaderRow().run()} />
              <Drop big icon={Grid3x3} label="Borders">
                {(close) => (
                  <div onClick={close}>
                    <MenuRow label="All Borders" checked={snap.tableBorders === 'all'} onClick={() => setTableBorders(editor, 'all')} />
                    <MenuRow label="Outside Borders" checked={snap.tableBorders === 'outer'} onClick={() => setTableBorders(editor, 'outer')} />
                    <MenuRow label="Horizontal Lines" checked={snap.tableBorders === 'horizontal'} onClick={() => setTableBorders(editor, 'horizontal')} />
                    <MenuRow label="No Borders" checked={snap.tableBorders === 'none'} onClick={() => setTableBorders(editor, 'none')} />
                  </div>
                )}
              </Drop>
              <Drop big icon={PaintBucket} label="Shading" width={196}>
                {(close) => <Palette colors={['#f2f2f2', '#d9d9d9', '#deeaf6', '#e2efd9', '#fff2cc', '#fbe4d5', '#ededed', ...TEXT_COLORS]} none noneLabel="No Colour" onPick={(c) => (setCellBackground(editor, c), close())} />}
              </Drop>
            </Group>
            <Group label="Alignment">
              <Btn big icon={Rows3} label="Top" onClick={() => chain().setCellAttribute('valign', null).run()} />
              <Btn big icon={Rows3} label="Middle" onClick={() => chain().setCellAttribute('valign', 'middle').run()} />
              <Btn big icon={Rows3} label="Bottom" onClick={() => chain().setCellAttribute('valign', 'bottom').run()} />
            </Group>
          </>
        )}
      </div>
    </div>
  )
}

function NumBox({ value, onSet, step = 0.25, suffix }: { value: number; onSet: (v: number) => void; step?: number; suffix: string }) {
  const show = (v: number) => String(Math.round(v * 100) / 100)
  const [text, setText] = useState(show(value))
  useEffect(() => setText(show(value)), [value])
  const commit = () => {
    const v = parseFloat(text)
    if (Number.isFinite(v) && Math.abs(v - value) > 0.001) onSet(Math.max(0, v))
  }
  return (
    <span className="kw-numbox">
      <input className="kw-select" type="number" step={step} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      <span>{suffix}</span>
    </span>
  )
}
