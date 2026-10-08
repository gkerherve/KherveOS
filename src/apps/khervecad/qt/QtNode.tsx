// Draws a desktop widget (a node from kcweb/ui.py) and sends what the user
// does to it back to Python, where the desktop's own slots run. Layouts are
// Qt's box / form / grid; widgets keep the desktop's texts, icons, tooltips,
// checked states, items and enabled states.

import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import DOMPurify from 'dompurify'
import { ChevronDown } from 'lucide-react'
import { MdiIcon } from '../MdiIcon'
import { plainText } from '../nodes'
import type { LayoutNode, Node } from '../types'
import { useQt } from './context'
import { QtTree } from './QtTree'
import { QtTable, QtList } from './QtTable'
import { Toolbar } from './Toolbar'
import { Splitter } from './Splitter'
import { GView, PaintWidget } from './GView'
import { ScadEditor } from './ScadEditor'

/** Renderers for the custom-drawn widgets (the 2D and 3D views). */
export const CUSTOM: Record<string, (n: Node) => ReactNode> = {}

const EXPANDING = new Set(['tree', 'table', 'list', 'text', 'scroll', 'split', 'tabs', 'stack', 'sketch', 'view3d', 'gview', 'paint'])

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_ATTR: ['style', 'href', 'width', 'colspan', 'rowspan', 'align'] })
}

export function tipAttr(tip?: string): Record<string, string> {
  return tip ? { 'data-kc-tip': tip } : {}
}

function sizeStyle(n: Node): CSSProperties {
  const s: CSSProperties = {}
  if (n.fw) s.width = s.minWidth = s.maxWidth = n.fw
  if (n.fh) s.height = s.minHeight = s.maxHeight = n.fh
  if (n.mw) s.minWidth = n.mw
  if (n.mh) s.minHeight = n.mh
  if (n.xw) s.maxWidth = n.xw
  if (n.xh) s.maxHeight = n.xh
  return s
}

const isLayout = (x: unknown): x is LayoutNode => !!x && typeof x === 'object' && 'k' in (x as object) && !('id' in (x as object))

// ------------------------------------------------------------------ layout

function LayoutItem({ item, dir }: { item: Node | LayoutNode | null; dir: 'v' | 'h' | 'cell' }) {
  if (!item) return null
  if (isLayout(item)) {
    if (item.k === 'stretch') return <div className="kc-stretch" style={{ flex: `${item.n ?? 1} 1 0` }} />
    if (item.k === 'space') return <div style={{ flex: `0 0 ${item.n ?? 6}px` }} />
    return <Layout l={item} nested />
  }
  const n = item
  if (n.hid) return null
  const style: CSSProperties = {}
  if (n.str) style.flex = `${n.str} 1 0`
  else if (dir === 'v' && n.t && EXPANDING.has(n.t)) style.flex = '1 1 0'
  else if (dir === 'h' && (n.t === 'line' || n.t === 'tree' || n.t === 'table' || n.t === 'list' || n.t === 'text' || n.t === 'slider' || n.t === 'progress')) style.flex = '1 1 0'
  return (
    <div className={`kc-li kc-li-${dir}`} style={style}>
      <QtNode n={n} />
    </div>
  )
}

export function Layout({ l, nested = false }: { l: LayoutNode; nested?: boolean }) {
  const m = l.m ?? (nested ? [0, 0, 0, 0] : [6, 6, 6, 6])
  const pad = `${m[1]}px ${m[2]}px ${m[3]}px ${m[0]}px`
  const gap = l.s ?? 6
  if (l.k === 'form') {
    return (
      <div className="kc-form" style={{ padding: nested ? 0 : pad, rowGap: gap, columnGap: 8 }}>
        {(l.rows ?? []).map(([label, field], i) => {
          const hidden = field && !isLayout(field) && (field as Node).hid
          if (hidden) return null
          if (!label)
            return (
              <div key={i} className="kc-form-span">
                <LayoutItem item={field} dir="cell" />
              </div>
            )
          return [
            <div key={`l${i}`} className="kc-form-label">
              <LayoutItem item={label} dir="cell" />
            </div>,
            <div key={`f${i}`} className="kc-form-field">
              <LayoutItem item={field} dir="h" />
            </div>,
          ]
        })}
      </div>
    )
  }
  if (l.k === 'grid') {
    const cs = l.cs ?? {}
    const ncols = Math.max(1, ...(l.cells ?? []).map(([, c, , span]) => c + span))
    const cols = Array.from({ length: ncols }, (_, c) => (cs[String(c)] ? `${cs[String(c)]}fr` : 'auto')).join(' ')
    return (
      <div className="kc-grid" style={{ padding: nested ? 0 : pad, gap, gridTemplateColumns: cols }}>
        {(l.cells ?? []).map(([r, c, rs, span, item], i) => (
          <div key={i} style={{ gridRow: `${r + 1} / span ${rs}`, gridColumn: `${c + 1} / span ${span}`, display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <LayoutItem item={item} dir="h" />
          </div>
        ))}
      </div>
    )
  }
  const dir = l.k === 'h' ? 'h' : 'v'
  return (
    <div className={`kc-box kc-box-${dir}`} style={{ padding: nested ? (l.m ? pad : 0) : pad, gap }}>
      {(l.items ?? []).map((it, i) => (
        <LayoutItem key={i} item={it} dir={dir} />
      ))}
    </div>
  )
}

// ----------------------------------------------------------------- widgets

function Label({ n }: { n: Node }) {
  const align = n.al ?? 0
  const style: CSSProperties = {
    textAlign: align & 0x4 || align === 0x84 ? 'center' : align & 0x2 ? 'right' : undefined,
    whiteSpace: n.wrap || n.rich ? 'normal' : 'pre',
  }
  if (n.rich) return <div className="kc-label" style={style} dangerouslySetInnerHTML={{ __html: sanitize(n.text ?? '') }} />
  return (
    <div className="kc-label" style={style}>
      {n.text}
    </div>
  )
}

function Button({ n }: { n: Node }) {
  const { send, menu } = useQt()
  return (
    <button
      type="button"
      className={`k-btn kc-button${n.chk ? ' checked' : ''}${n.def ? ' primary' : ''}`}
      disabled={!!n.dis}
      onClick={(e) => {
        if (n.menu) menu(n.menu, e)
        else send({ op: 'click', id: n.id })
      }}
    >
      {n.icon && <MdiIcon name={n.icon} size={16} />}
      {n.text ? <span>{plainText(n.text)}</span> : null}
      {n.menu && <ChevronDown size={12} />}
    </button>
  )
}

export function ToolButton({ n, size = 18 }: { n: Node; size?: number }) {
  const { send, menu } = useQt()
  const split = !!n.menu && n.popup === 1
  const instant = !!n.menu && !split
  const showText = n.style === 2 || n.style === 1 || !n.icon
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const stop = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])
  return (
    <span className={`kc-tbutton-wrap${split ? ' split' : ''}`}>
      <button
        type="button"
        className={`kc-tbutton${n.chk ? ' checked' : ''}`}
        disabled={!!n.dis}
        onPointerDown={(e) => {
          if (!n.rep || e.button !== 0) return
          // hold to repeat (pan / zoom arrows): 350 ms, then every 70 ms
          send({ op: 'click', id: n.id })
          timer.current = setTimeout(() => {
            timer.current = setInterval(() => send({ op: 'click', id: n.id }), 70)
          }, 350) as unknown as ReturnType<typeof setInterval>
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onClick={(e) => {
          if (n.rep) return
          if (instant) menu(n.menu ?? [], e)
          else send({ op: 'click', id: n.id })
        }}
      >
        {n.icon && <MdiIcon name={n.icon} size={size} />}
        {showText && n.text ? <span className="kc-tbutton-text">{plainText(n.text)}</span> : null}
        {instant && <ChevronDown size={10} className="kc-chev" />}
      </button>
      {split && (
        <button
          type="button"
          className="kc-tbutton-arrow"
          disabled={!!n.dis}
          onClick={(e) => {
            const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
            menu(n.menu ?? [], { clientX: r.left, clientY: r.bottom })
          }}
        >
          <ChevronDown size={10} />
        </button>
      )}
    </span>
  )
}

function Check({ n, radio }: { n: Node; radio?: boolean }) {
  const { send } = useQt()
  return (
    <label className={`kc-check${n.dis ? ' disabled' : ''}`}>
      <input type={radio ? 'radio' : 'checkbox'} checked={!!n.chk} disabled={!!n.dis} onChange={() => send({ op: 'click', id: n.id })} />
      {n.text ? <span>{plainText(n.text)}</span> : null}
    </label>
  )
}

function LineEdit({ n }: { n: Node }) {
  const { send } = useQt()
  const [text, setText] = useState(n.text ?? '')
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setText(n.text ?? '')
  }, [n.text])
  const commit = () => {
    editing.current = false
    if (text !== n.text) send({ op: 'text', id: n.id, text })
    else send({ op: 'text', id: n.id, text })
  }
  return (
    <input
      className="k-input kc-line"
      type={n.pw ? 'password' : 'text'}
      value={text}
      placeholder={n.ph}
      readOnly={!!n.ro}
      disabled={!!n.dis}
      onFocus={() => (editing.current = true)}
      onChange={(e) => {
        setText(e.target.value)
        send({ op: 'typing', id: n.id, text: e.target.value })
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          editing.current = false
          send({ op: 'return', id: n.id, text: (e.target as HTMLInputElement).value })
        }
        e.stopPropagation()
      }}
    />
  )
}

function TextEdit({ n }: { n: Node }) {
  const { send } = useQt()
  const [text, setText] = useState(n.text ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  const editing = useRef(false)
  const lastCmd = useRef<number | null>(null)
  useEffect(() => {
    if (!editing.current) setText(n.text ?? '')
  }, [n.text])
  useEffect(() => {
    const cmd = n.cmd
    if (!cmd || cmd[1] === lastCmd.current || !ref.current) return
    lastCmd.current = cmd[1]
    ref.current.focus()
    // the code tab's toolbar: editing commands on this editor
    const map: Record<string, string> = { undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste', selectAll: 'selectAll' }
    if (cmd[0] === 'paste') {
      void navigator.clipboard?.readText().then((t) => document.execCommand('insertText', false, t))
    } else document.execCommand(map[cmd[0]] ?? cmd[0])
  }, [n.cmd])
  if (n.html && n.ro) return <div className="kc-textview" dangerouslySetInnerHTML={{ __html: sanitize(n.text ?? '') }} />
  return (
    <textarea
      ref={ref}
      className={`k-input kc-text${n.name === 'code' ? ' code' : ''}`}
      value={text}
      readOnly={!!n.ro}
      placeholder={n.ph}
      wrap={n.nowrap ? 'off' : 'soft'}
      spellCheck={false}
      onFocus={() => (editing.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        editing.current = false
        if (text !== n.text) send({ op: 'text', id: n.id, text })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') {
          // Tab indents (as the desktop's code view does)
          e.preventDefault()
          document.execCommand('insertText', false, '    ')
        }
        e.stopPropagation()
      }}
    />
  )
}

function SpinBox({ n }: { n: Node }) {
  const { send } = useQt()
  const fmt = (v: number | undefined) => (v ?? 0).toFixed(n.dec ?? 0)
  const [text, setText] = useState(fmt(n.value))
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setText(fmt(n.value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.value, n.dec])
  const commit = (v: number) => {
    if (!Number.isFinite(v)) return
    send({ op: 'value', id: n.id, value: v })
  }
  if (n.special && n.value === n.min && !editing.current) {
    // Qt's special value text at the minimum ("Auto", "Off"…)
  }
  return (
    <span className={`kc-spin${n.dis ? ' disabled' : ''}`}>
      {n.pre && <span className="kc-affix">{n.pre}</span>}
      <input
        className="k-input"
        type="number"
        value={n.special && n.value === n.min && !editing.current ? '' : text}
        placeholder={n.special && n.value === n.min ? n.special : undefined}
        min={n.min}
        max={n.max}
        step={n.step}
        disabled={!!n.dis}
        onFocus={() => (editing.current = true)}
        onChange={(e) => {
          setText(e.target.value)
          const native = e.nativeEvent as InputEvent
          // the arrows (no typing): commit at once, like a spin box click
          if (!native.inputType) commit(parseFloat(e.target.value))
        }}
        onBlur={() => {
          editing.current = false
          commit(parseFloat(text))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(parseFloat((e.target as HTMLInputElement).value))
          e.stopPropagation()
        }}
      />
      {n.suf && <span className="kc-affix">{n.suf}</span>}
    </span>
  )
}

function Slider({ n }: { n: Node }) {
  const { send } = useQt()
  const [v, setV] = useState(n.value ?? 0)
  const dragging = useRef(false)
  useEffect(() => {
    if (!dragging.current) setV(n.value ?? 0)
  }, [n.value])
  const vertical = n.o === 2
  return (
    <input
      className={`kc-slider${vertical ? ' vertical' : ''}`}
      type="range"
      min={n.min}
      max={n.max}
      step={n.step || 1}
      value={v}
      disabled={!!n.dis}
      onPointerDown={() => (dragging.current = true)}
      onPointerUp={() => {
        dragging.current = false
        send({ op: 'value', id: n.id, value: v, final: 1 })
      }}
      onChange={(e) => {
        const val = parseInt(e.target.value, 10)
        setV(val)
        send({ op: 'value', id: n.id, value: val })
      }}
    />
  )
}

function Combo({ n }: { n: Node }) {
  const { send, menu } = useQt()
  const items = (n.items ?? []) as [string, string | null, number, number][]
  const [text, setText] = useState(n.etext ?? '')
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setText(n.etext ?? '')
  }, [n.etext])
  if (n.edit) {
    const open = (e: React.MouseEvent) => {
      const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
      send({ op: 'combo_popup', id: n.id })
      // the list as it is now; it refreshes as soon as Python answers
      menu(
        items.map(([label], i) => ({ id: -1 - i, text: label.replace(/&/g, '&&') })),
        { clientX: r.left, clientY: r.bottom },
      )
      pendingCombo = { id: n.id, send }
    }
    return (
      <span className={`kc-combo-edit${n.dis ? ' disabled' : ''}`}>
        <input
          className="k-input"
          value={text}
          placeholder={n.ph}
          disabled={!!n.dis}
          onFocus={() => (editing.current = true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            editing.current = false
            send({ op: 'combo_text', id: n.id, text })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send({ op: 'combo_text', id: n.id, text: (e.target as HTMLInputElement).value })
            e.stopPropagation()
          }}
        />
        <button type="button" className="kc-combo-btn" disabled={!!n.dis} onClick={open}>
          <ChevronDown size={12} />
        </button>
      </span>
    )
  }
  return (
    <select className="k-input kc-combo" value={n.idx ?? -1} disabled={!!n.dis} onChange={(e) => send({ op: 'combo', id: n.id, index: parseInt(e.target.value, 10) })}>
      {n.idx === -1 && <option value={-1} />}
      {items.map(([label, , enabled, sep], i) =>
        sep ? (
          <option key={i} disabled value={-100 - i}>
            ──────
          </option>
        ) : (
          <option key={i} value={i} disabled={enabled === 0}>
            {label}
          </option>
        ),
      )}
    </select>
  )
}

/** An editable combo's drop-down was clicked: its items are actions with
 *  negative ids (−1 − index); the menu host routes them here. */
export let pendingCombo: { id: number; send: (ev: { op: string; id: number; index: number }) => void } | null = null

export function comboPick(actionId: number): boolean {
  if (actionId >= 0 || !pendingCombo) return false
  pendingCombo.send({ op: 'combo', id: pendingCombo.id, index: -1 - actionId })
  pendingCombo = null
  return true
}

function Group({ n }: { n: Node }) {
  const { send } = useQt()
  return (
    <fieldset className="kc-group" disabled={!!n.dis || (!!n.ck && !n.chk)}>
      <legend>
        {n.ck ? (
          <label className="kc-check">
            <input type="checkbox" checked={!!n.chk} onChange={(e) => send({ op: 'group', id: n.id, on: e.target.checked })} />
            <span>{plainText(n.title)}</span>
          </label>
        ) : (
          plainText(n.title)
        )}
      </legend>
      <Container n={n} />
    </fieldset>
  )
}

function Tabs({ n }: { n: Node }) {
  const { send } = useQt()
  return (
    <div className="kc-tabs">
      <div className="kc-tabbar" role="tablist">
        {(n.tabs ?? []).map((t, i) =>
          t.hid ? null : (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === n.idx}
              className={`kc-tab${i === n.idx ? ' active' : ''}`}
              disabled={!!t.dis}
              {...tipAttr(t.tip)}
              onClick={() => i !== n.idx && send({ op: 'tab', id: n.id, index: i })}
            >
              {t.icon && <MdiIcon name={t.icon} size={14} />}
              {plainText(t.label)}
            </button>
          ),
        )}
      </div>
      <div className="kc-tabpage">{n.page && <QtNode n={n.page} />}</div>
    </div>
  )
}

function Container({ n }: { n: Node }) {
  if (n.l) return <Layout l={n.l} />
  if (n.kids?.length)
    return (
      <div className="kc-box kc-box-v">
        {n.kids.map((k) => (
          <LayoutItem key={k.id} item={k} dir="v" />
        ))}
      </div>
    )
  return null
}

function ButtonBox({ n }: { n: Node }) {
  return (
    <div className="kc-buttonbox">
      {(n.kids ?? []).map((b) => (b.hid ? null : <Button key={b.id} n={b} />))}
    </div>
  )
}

export function StatusBar({ n }: { n: Node }) {
  const items = (n.items ?? []) as [Node, number][]
  const left = items.filter(([, p]) => !p)
  const right = items.filter(([, p]) => p)
  // a message stays for its timeout (QStatusBar.showMessage), then the widgets return
  const s = n as Node & { msgms?: number; msgrev?: number }
  const [expired, setExpired] = useState<number | null>(null)
  useEffect(() => {
    if (!n.msg || !s.msgms) return
    const rev = s.msgrev ?? 0
    const timer = setTimeout(() => setExpired(rev), s.msgms)
    return () => clearTimeout(timer)
  }, [n.msg, s.msgms, s.msgrev])
  const showMsg = !!n.msg && expired !== (s.msgrev ?? 0)
  return (
    <div className="k-statusbar kc-status">
      <div className="kc-status-left">
        {showMsg ? (
          <span className="kc-status-msg">{n.msg}</span>
        ) : (
          left.map(([w]) => (w.hid ? null : <QtNode key={w.id} n={w} />))
        )}
      </div>
      <div className="kc-status-right">{right.map(([w]) => (w.hid ? null : <QtNode key={w.id} n={w} />))}</div>
    </div>
  )
}

/** Another of the desktop's main windows (the Blueprint), in its frame:
 *  its own menu bar along the top, tool bars, centre, docks, status bar. */
function MainWin({ n }: { n: Node }) {
  const { menu, send } = useQt()
  const m = n as Node & { menus: { id: number; title: string; items: import('../types').ActionNode[] }[]; toolbars: [number, Node][]; central?: Node; status?: Node | null; docks: [number, number, string, Node][] }
  return (
    <div className="kc-mainwin">
      <div className="kc-mainwin-menus">
        {m.menus.map((mm) => (
          <button
            key={mm.id}
            type="button"
            className="kc-mainwin-menu"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              menu(mm.items, { clientX: r.left, clientY: r.bottom })
            }}
          >
            {plainText(mm.title)}
          </button>
        ))}
      </div>
      <div className="kc-top">
        {m.toolbars.filter(([a]) => a === 4).map(([, t]) => (
          <QtNode key={t.id} n={t} />
        ))}
      </div>
      <div className="kc-middle">
        {m.toolbars.some(([a]) => a === 1) && (
          <div className="kc-left">
            {m.toolbars.filter(([a]) => a === 1).map(([, t]) => (
              <QtNode key={t.id} n={t} />
            ))}
          </div>
        )}
        <div className="kc-central">{m.central && <QtNode n={m.central} />}</div>
        {m.docks.map(([, id, title, d]) => (
          <div key={id} className="kc-dock">
            <div className="kc-dock-title">
              <span>{title}</span>
              <button type="button" className="kc-window-close" aria-label="Close" onClick={() => send({ op: 'close', id })}>
                ×
              </button>
            </div>
            <div className="kc-dock-body">
              <QtNode n={d} />
            </div>
          </div>
        ))}
      </div>
      {m.status && <StatusBar n={m.status} />}
    </div>
  )
}

// --------------------------------------------------------------- dispatch

export const QtNode = memo(function QtNode({ n }: { n: Node }) {
  if (n.hid) return null
  const style = sizeStyle(n)
  const tip = tipAttr(n.t === 'tbutton' ? undefined : n.tip)
  let body: ReactNode
  switch (n.t) {
    case 'label':
      body = <Label n={n} />
      break
    case 'button':
      body = <Button n={n} />
      break
    case 'tbutton':
      return (
        <span style={style} {...tipAttr(n.tip)}>
          <ToolButton n={n} />
        </span>
      )
    case 'check':
      body = <Check n={n} />
      break
    case 'radio':
      body = <Check n={n} radio />
      break
    case 'line':
      body = <LineEdit n={n} />
      break
    case 'text':
      body = (n as Node & { mono?: 1 }).mono && !n.html ? <ScadEditor n={n} /> : <TextEdit n={n} />
      break
    case 'spin':
      body = <SpinBox n={n} />
      break
    case 'slider':
      body = <Slider n={n} />
      break
    case 'progress':
      body = <progress className="kc-progress" value={(n.value ?? 0) - (n.min ?? 0)} max={(n.max ?? 100) - (n.min ?? 0)} />
      break
    case 'combo':
      body = <Combo n={n} />
      break
    case 'group':
      body = <Group n={n} />
      break
    case 'tabs':
      body = <Tabs n={n} />
      break
    case 'stack':
      body = n.page ? <QtNode n={n.page} /> : null
      break
    case 'scroll':
      body = <div className="kc-scroll">{n.w && <QtNode n={n.w} />}</div>
      break
    case 'split':
      body = <Splitter n={n} />
      break
    case 'tree':
      body = <QtTree n={n} />
      break
    case 'table':
      body = <QtTable n={n} />
      break
    case 'list':
      body = <QtList n={n} />
      break
    case 'toolbar':
      body = <Toolbar n={n} />
      break
    case 'buttons':
      body = <ButtonBox n={n} />
      break
    case 'sep':
      body = <div className={`kc-sep kc-sep-${n.o}`} />
      break
    case 'status':
      body = <StatusBar n={n} />
      break
    case 'gview':
      body = <GView n={n} />
      break
    case 'mainwin':
      body = <MainWin n={n} />
      break
    case 'paint':
      body = <PaintWidget n={n} />
      break
    default:
      if (n.t && CUSTOM[n.t]) body = CUSTOM[n.t](n)
      else body = <Container n={n} />
  }
  return (
    <div className={`kc-w kc-w-${n.t ?? 'w'}`} style={style} {...tip} data-kc-name={n.name}>
      {body}
    </div>
  )
})
