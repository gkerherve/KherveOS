// The desktop's toolbars, item for item (window._build_toolbar,
// _build_slide_toolbar and view_bar.ViewBar): the top bar with the file,
// history, zoom, Box and Font controls and the compile buttons on the right;
// the vertical "Insert & arrange" bar on the left edge; and the bottom bar
// PowerPoint has (slide n of N, Theme, Normal / Overview / Master,
// slideshow, zoom). Icons are the desktop's own (icons.tsx), tooltips its
// tooltips.py text.

import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { os, type MenuItem } from '@/os'
import { Ico, type IconName } from './icons'

export type TBItem =
  | {
      kind: 'btn'
      key: string
      icon: IconName
      label: string
      tip: string
      onClick: () => void
      disabled?: boolean
      checked?: boolean
      /** A ▾ beside the button opening this menu (QToolButton.MenuButtonPopup). */
      menu?: () => MenuItem[]
      menuClass?: string
      /** Keep the keyboard focus where it is (the in-place text editor), as the desktop's NoFocus buttons. */
      keepFocus?: boolean
    }
  | { kind: 'sep'; key: string }
  | { kind: 'spacer'; key: string }
  | { kind: 'widget'; key: string; node: ReactNode }

/** Open a menu under (or above) an element. */
export function menuAt(el: HTMLElement, items: MenuItem[], opts: { above?: boolean; right?: boolean; className?: string } = {}) {
  const r = el.getBoundingClientRect()
  os.contextMenu({ clientX: opts.right ? r.right : r.left, clientY: opts.above ? r.top - 2 : r.bottom + 2 }, items, { above: opts.above, className: opts.className })
}

export function ToolButton({ item, size = 24, vertical = false }: { item: Extract<TBItem, { kind: 'btn' }>; size?: number; vertical?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const btn = (
    <button
      className={`ks2-tb${item.checked ? ' checked' : ''}`}
      title={item.tip}
      aria-label={item.label}
      aria-pressed={item.checked}
      disabled={item.disabled}
      onMouseDown={item.keepFocus ? (e) => e.preventDefault() : undefined}
      onClick={item.onClick}
    >
      <Ico name={item.icon} size={size} />
    </button>
  )
  if (!item.menu) return btn
  return (
    <span className={`ks2-tb-split${vertical ? ' vertical' : ''}`} ref={ref}>
      {btn}
      <button
        className="ks2-tb-arrow"
        title={item.tip}
        disabled={item.disabled}
        onClick={() => ref.current && menuAt(ref.current, item.menu!(), { className: item.menuClass, right: vertical })}
      >
        ▾
      </button>
    </span>
  )
}

/** The top toolbar. Like a QToolBar, what does not fit goes behind a » button at the right end. */
export function TopToolbar({ items }: { items: TBItem[] }) {
  const bar = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const [hidden, setHidden] = useState<string[]>([])
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const measure = () => {
      const limit = el.clientWidth - 26
      const out: string[] = []
      for (const child of el.querySelectorAll<HTMLElement>(':scope > [data-tb]')) {
        child.style.visibility = ''
        if (child.offsetLeft + child.offsetWidth > limit) {
          out.push(child.dataset.tb!)
          child.style.visibility = 'hidden'
        }
      }
      setHidden((h) => (h.join() === out.join() ? h : out))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  })
  const overflow = items.filter((it): it is Extract<TBItem, { kind: 'btn' }> => it.kind === 'btn' && hidden.includes(it.key))
  return (
    <div className="ks2-topbar" ref={bar}>
      {items.map((it) => (
        <Fragment key={it.key}>
          {it.kind === 'sep' ? (
            <span className="ks2-tb-sep" data-tb={it.key} />
          ) : it.kind === 'spacer' ? (
            <span className="ks2-tb-spacer" />
          ) : it.kind === 'widget' ? (
            <span className="ks2-tb-widget" data-tb={it.key}>
              {it.node}
            </span>
          ) : (
            <span className="ks2-tb-wrap" data-tb={it.key}>
              <ToolButton item={it} />
            </span>
          )}
        </Fragment>
      ))}
      {hidden.length > 0 && (
        <button
          ref={more}
          className="ks2-tb-more"
          title="More tools"
          onClick={() =>
            more.current &&
            menuAt(
              more.current,
              overflow.map((it) => ({ label: it.label, image: <Ico name={it.icon} size={16} />, checked: it.checked, disabled: it.disabled, onClick: it.onClick })),
              { right: true },
            )
          }
        >
          »
        </button>
      )}
    </div>
  )
}

/** The vertical toolbar on the left edge ("Insert & arrange"). */
export function SideToolbar({ items }: { items: TBItem[] }) {
  return (
    <div className="ks2-sidebar">
      {items.map((it) =>
        it.kind === 'sep' ? <span key={it.key} className="ks2-tb-hsep" /> : it.kind === 'btn' ? <ToolButton key={it.key} item={it} vertical /> : null,
      )}
    </div>
  )
}

// ------------------------------------------------------------------ the bottom bar (view_bar.py)

export type ViewMode = 'normal' | 'overview' | 'master'

export interface ViewBarProps {
  counter: string
  view: ViewMode
  tips: Record<'theme' | 'normal' | 'overview' | 'master' | 'slideshow' | 'zoom_out' | 'fit' | 'zoom_in', string>
  themeMenu: () => MenuItem[]
  showMenu: () => MenuItem[]
  onView: (v: ViewMode) => void
  onSlideshow: () => void
  onZoomOut: () => void
  onFit: () => void
  onZoomIn: () => void
}

export function ViewBar(p: ViewBarProps) {
  const themeRef = useRef<HTMLButtonElement>(null)
  const showRef = useRef<HTMLSpanElement>(null)
  const views: [ViewMode, IconName, string][] = [
    ['normal', 'view_normal', 'Normal'],
    ['overview', 'view_overview', 'Overview'],
    ['master', 'view_master', 'Master'],
  ]
  return (
    <div className="ks2-viewbar">
      <span className="ks2-vb-counter">{p.counter}</span>
      <span className="ks2-vb-sep" />
      <button ref={themeRef} className="ks2-vb-btn text" title={p.tips.theme} onClick={() => themeRef.current && menuAt(themeRef.current, p.themeMenu(), { above: true })}>
        <Ico name="theme_palette" size={18} />
        Theme
        <span className="ks2-vb-caret">▾</span>
      </button>
      <span className="ks2-vb-sep" />
      {views.map(([k, icon, label]) => (
        <button key={k} className={`ks2-vb-btn${p.view === k ? ' checked' : ''}`} title={p.tips[k]} aria-label={label} aria-pressed={p.view === k} onClick={() => p.onView(k)}>
          <Ico name={icon} size={18} />
        </button>
      ))}
      <span className="ks2-tb-split small" ref={showRef}>
        <button className="ks2-vb-btn" title={p.tips.slideshow} aria-label="Slideshow" onClick={p.onSlideshow}>
          <Ico name="slideshow" size={18} />
        </button>
        <button className="ks2-tb-arrow" title={p.tips.slideshow} onClick={() => showRef.current && menuAt(showRef.current, p.showMenu(), { above: true })}>
          ▾
        </button>
      </span>
      <span className="ks2-vb-sep" />
      <button className="ks2-vb-btn" title={p.tips.zoom_out} aria-label="Zoom out" onClick={p.onZoomOut}>
        <Ico name="zoom_out" size={18} />
      </button>
      <button className="ks2-vb-btn" title={p.tips.fit} aria-label="Fit slide to window" onClick={p.onFit}>
        <Ico name="fit_width" size={18} />
      </button>
      <button className="ks2-vb-btn" title={p.tips.zoom_in} aria-label="Zoom in" onClick={p.onZoomIn}>
        <Ico name="zoom_in" size={18} />
      </button>
    </div>
  )
}

/** The Font size spin box (QSpinBox 6–160): typing is free, a valid size applies at once, Enter / leaving it settles it. */
export function FontSpin({ value, disabled, title, onChange }: { value: number | null; disabled: boolean; title: string; onChange: (pt: number) => void }) {
  const [text, setText] = useState(value === null ? '6' : String(value))
  const focused = useRef(false)
  useLayoutEffect(() => {
    if (!focused.current) setText(value === null ? '6' : String(value))
  }, [value])
  const valid = (s: string) => {
    const n = Math.round(Number(s))
    return Number.isFinite(n) && n >= 6 && n <= 160 ? n : null
  }
  return (
    <input
      className="ks2-spin"
      type="number"
      min={6}
      max={160}
      title={title}
      disabled={disabled}
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        setText(value === null ? '6' : String(value))
      }}
      onChange={(e) => {
        setText(e.target.value)
        const n = valid(e.target.value)
        if (n !== null && n !== value) onChange(n)
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}
