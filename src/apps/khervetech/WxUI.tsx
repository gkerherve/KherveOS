// The desktop's wx windows, drawn from the tree the headless wx sends
// (shims/wx): panels laid out by their sizers (BoxSizer, StaticBoxSizer as a
// titled box, FlexGridSizer with its growable columns), and the controls —
// StaticText, Button (green when the desktop colours it), TextCtrl, SpinCtrl,
// Choice / ComboBox, CheckBox, RadioButton, CheckListBox, wx.grid.Grid,
// Notebook, and the matplotlib canvases (FigurePlot).
//
// What the user types is kept on the page and sent with the next event
// (`sync`), as wx keeps it in the control until a handler reads GetValue();
// events the desktop code binds (EVT_BUTTON, EVT_CHOICE, EVT_KILL_FOCUS…) are
// sent at once and run its handler.

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { FigurePlot } from './FigurePlot'
import { WX, type Arrays, type WxItem, type WxNode } from './types'

export interface WxMsg {
  id: number
  type: string
  [k: string]: unknown
}

export interface WxCtx {
  arrays: Arrays
  /** Run a user action in Python (with the pending typed values). */
  send: (msg: WxMsg) => void
  /** A typed value not yet sent. */
  pending: Map<number, unknown>
  setPending: (id: number, value: unknown) => void
  disabled?: boolean
}

const Ctx = createContext<WxCtx | null>(null)

export function WxProvider({ value, children }: { value: WxCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

const useWx = () => useContext(Ctx)!

/** Inside a sizer item that grows (proportion or wxEXPAND): a set size is only the minimum, as in wx. */
const FillCtx = createContext(false)

const bound = (n: WxNode, ev: string) => !!n.ev?.includes(ev)

function look(n: WxNode): CSSProperties {
  const s: CSSProperties = {}
  if (n.fg) s.color = n.fg
  if (n.font?.mono) s.fontFamily = 'Consolas, Menlo, "DejaVu Sans Mono", monospace'
  if (n.font?.bold) s.fontWeight = 'bold'
  if (n.font?.italic) s.fontStyle = 'italic'
  if (n.font?.size) s.fontSize = `${Math.round(n.font.size * 1.33)}px`
  return s
}

function sizeStyle(n: WxNode, fill = false): CSSProperties {
  const s: CSSProperties = {}
  if (n.w && n.w > 0) s[fill ? 'minWidth' : 'width'] = n.w
  if (n.h && n.h > 0) s[fill ? 'minHeight' : 'height'] = n.h
  if (n.minw && n.minw > 0) s.minWidth = n.minw
  if (n.minh && n.minh > 0) s.minHeight = n.minh
  return s
}

/** The CSS of one sizer item: border on the flagged sides, grow, expand, align. */
function itemStyle(it: WxItem, orient: 'h' | 'v' | 'g'): CSSProperties {
  const f = it.f ?? 0
  const b = it.b ?? 0
  const s: CSSProperties = {
    marginTop: f & WX.TOP ? b : 0,
    marginBottom: f & WX.BOTTOM ? b : 0,
    marginLeft: f & WX.LEFT ? b : 0,
    marginRight: f & WX.RIGHT ? b : 0,
    minWidth: 0,
    minHeight: 0,
  }
  if (orient === 'g') {
    s.justifySelf = f & WX.EXPAND ? 'stretch' : f & WX.ALIGN_RIGHT ? 'end' : f & WX.ALIGN_CENTER_HORIZONTAL ? 'center' : 'start'
    s.alignSelf = f & WX.EXPAND ? 'stretch' : f & WX.ALIGN_CENTER_VERTICAL ? 'center' : f & WX.ALIGN_BOTTOM ? 'end' : 'start'
    if (it.pos) {
      s.gridRow = `${it.pos[0] + 1} / span ${it.span?.[0] ?? 1}`
      s.gridColumn = `${it.pos[1] + 1} / span ${it.span?.[1] ?? 1}`
    }
    return s
  }
  const p = it.p ?? 0
  s.flex = p ? `${p} 1 0` : '0 0 auto'
  if (orient === 'v') s.alignSelf = f & WX.EXPAND ? 'stretch' : f & WX.ALIGN_RIGHT ? 'flex-end' : f & WX.ALIGN_CENTER_HORIZONTAL ? 'center' : 'flex-start'
  else s.alignSelf = f & WX.EXPAND ? 'stretch' : f & WX.ALIGN_CENTER_VERTICAL ? 'center' : f & WX.ALIGN_BOTTOM ? 'flex-end' : 'flex-start'
  return s
}

function SizerView({ node }: { node: WxNode }) {
  const o = (node.o ?? 'v') as 'h' | 'v' | 'g'
  const items = node.items ?? []
  const inner =
    o === 'g' ? (
      <div
        className="kt-grid"
        style={{
          gridTemplateColumns: Array.from({ length: Number(node.cols) || 1 }, (_, c) => (node.growCols?.[String(c)] ? `minmax(0, ${node.growCols[String(c)]}fr)` : node.uniform ? 'minmax(0, 1fr)' : 'auto')).join(' '),
          rowGap: node.vgap ?? 0,
          columnGap: node.hgap ?? 0,
        }}
      >
        {items.map((it, i) => (
          <ItemView key={i} it={it} orient="g" />
        ))}
      </div>
    ) : (
      <div className={`kt-box kt-${o}${node.wrap ? ' kt-wrap' : ''}`}>
        {items.map((it, i) => (
          <ItemView key={i} it={it} orient={o} />
        ))}
      </div>
    )
  if (node.box !== undefined)
    return (
      <fieldset className={`kt-staticbox kt-${o === 'g' ? 'v' : o}`} disabled={node.en === false}>
        <legend>{node.box}</legend>
        {inner}
      </fieldset>
    )
  return inner
}

function ItemView({ it, orient }: { it: WxItem; orient: 'h' | 'v' | 'g' }) {
  const style = itemStyle(it, orient)
  if (!it.n) {
    const sz: CSSProperties = { ...style, width: Math.max(0, it.sw ?? 0), height: Math.max(0, it.sh ?? 0) }
    return <div className="kt-spacer" style={sz} />
  }
  const grow = (it.p ?? 0) > 0 || ((it.f ?? 0) & WX.EXPAND) !== 0
  return (
    <div className={`kt-item${grow ? ' kt-fill' : ''}`} style={style}>
      <FillCtx.Provider value={grow}>
        <WxView node={it.n} />
      </FillCtx.Provider>
    </div>
  )
}

/** One node of the tree. */
export function WxView({ node }: { node: WxNode }) {
  const fill = useContext(FillCtx)
  switch (node.t) {
    case 'Sizer':
      return <SizerView node={node} />
    case 'Panel':
    case 'Frame':
    case 'Dialog':
    case 'Window':
    case 'Control':
      return (
        <div className={`kt-panel${node.scroll ? ' kt-scroll' : ''}`} style={{ ...sizeStyle(node, fill), background: node.bg }}>
          {node.sizer && <SizerView node={node.sizer} />}
        </div>
      )
    case 'Text':
      return (
        <span className="kt-text" style={{ ...look(node), ...sizeStyle(node, fill), textAlign: (node.align as 'right') ?? undefined, maxWidth: typeof node.wrap === 'number' ? node.wrap : undefined }} title={node.tip}>
          {node.label}
        </span>
      )
    case 'Link':
      return (
        <a className="kt-link" href={node.url} target="_blank" rel="noreferrer">
          {node.label}
        </a>
      )
    case 'Line':
      return <div className={node.vertical ? 'kt-vline' : 'kt-hline'} />
    case 'Button':
    case 'Toggle':
      return <ButtonView node={node} />
    case 'TextCtrl':
      return <TextView node={node} />
    case 'Spin':
      return <SpinView node={node} />
    case 'Choice':
    case 'Combo':
      return <ChoiceView node={node} />
    case 'CheckBox':
      return <CheckView node={node} />
    case 'Radio':
      return <RadioView node={node} />
    case 'RadioBox':
      return <RadioBoxView node={node} />
    case 'CheckList':
    case 'List':
      return <ListView node={node} />
    case 'Grid':
      return <GridView node={node} />
    case 'ListCtrl':
      return <ListCtrlView node={node} />
    case 'Notebook':
      return <NotebookView node={node} />
    case 'Canvas':
      return <CanvasView node={node} />
    case 'Gauge':
      return <progress className="kt-gauge" max={node.range ?? 100} value={Number(node.value ?? 0)} />
    case 'Slider':
      return <SliderView node={node} />
    case 'Bitmap':
      return node.src ? <img src={`${import.meta.env.BASE_URL}apps/khervetech/icons/${node.src}`} alt="" /> : null
    case 'Splitter':
      return (
        <div className={`kt-box kt-${node.vertical ? 'h' : 'v'} kt-splitterwin`}>
          {node.a && (
            <div className="kt-item kt-fill" style={{ flex: '1 1 0' }}>
              <WxView node={node.a} />
            </div>
          )}
          {node.b && (
            <div className="kt-item kt-fill" style={{ flex: '1 1 0' }}>
              <WxView node={node.b} />
            </div>
          )}
        </div>
      )
    case 'StaticBox':
      return null
    default:
      return node.sizer ? <SizerView node={node.sizer} /> : null
  }
}

function ButtonView({ node }: { node: WxNode }) {
  const { send, disabled } = useWx()
  const green = node.bg && node.bg.toLowerCase() === '#4fbe9f'
  return (
    <button
      type="button"
      className={`kt-btn${green ? ' kt-green' : ''}${node.t === 'Toggle' && node.value ? ' kt-on' : ''}`}
      style={{ ...look(node), ...sizeStyle(node, useContext(FillCtx)), background: node.bg && !green ? node.bg : undefined }}
      disabled={node.en === false || disabled}
      title={node.tip}
      onClick={() => send({ id: node.id!, type: 'button', value: node.t === 'Toggle' ? !node.value : undefined })}
    >
      {node.icon && <img src={`${import.meta.env.BASE_URL}apps/khervetech/icons/${node.icon}`} alt="" width={20} height={20} />}
      {node.label}
    </button>
  )
}

function useValue<T>(node: WxNode, server: T): [T, (v: T) => void] {
  const { pending, setPending } = useWx()
  const has = pending.has(node.id!)
  const value = (has ? pending.get(node.id!) : server) as T
  return [value, (v: T) => setPending(node.id!, v)]
}

function TextView({ node }: { node: WxNode }) {
  const { send, disabled } = useWx()
  const [value, setValue] = useValue<string>(node, String(node.value ?? ''))
  const ro = node.ro === true
  const props = {
    className: `kt-input${node.multi ? ' kt-multi' : ''}${ro ? ' kt-ro' : ''}`,
    style: { ...look(node), ...sizeStyle(node, useContext(FillCtx)), whiteSpace: node.nowrap ? ('pre' as const) : undefined },
    value,
    readOnly: ro,
    disabled: node.en === false || disabled,
    placeholder: node.hint,
    title: node.tip,
    spellCheck: false,
    onChange: (e: { target: { value: string } }) => {
      setValue(e.target.value)
    },
    onBlur: () => {
      if (bound(node, 'EVT_KILL_FOCUS')) send({ id: node.id!, type: 'blur', value })
      else if (bound(node, 'EVT_TEXT')) send({ id: node.id!, type: 'text', value })
    },
    onKeyDown: (e: { key: string; stopPropagation: () => void }) => {
      e.stopPropagation()
      if (e.key === 'Enter' && !node.multi && bound(node, 'EVT_TEXT_ENTER')) send({ id: node.id!, type: 'enter', value })
    },
  }
  return node.multi ? <textarea {...props} wrap={node.nowrap ? 'off' : 'soft'} /> : <input {...props} type={node.password ? 'password' : 'text'} />
}

function SpinView({ node }: { node: WxNode }) {
  const { send, disabled } = useWx()
  const digits = node.float ? node.digits ?? 2 : 0
  const [value, setValue] = useValue<number>(node, Number(node.value ?? 0))
  const [text, setText] = useState(Number(value).toFixed(digits))
  useEffect(() => setText(Number(value).toFixed(digits)), [value, digits])
  const clamp = (v: number) => Math.min(node.max ?? Infinity, Math.max(node.min ?? -Infinity, v))
  const commit = (v: number) => {
    if (!Number.isFinite(v)) return setText(Number(value).toFixed(digits))
    const c = clamp(node.float ? v : Math.round(v))
    setText(c.toFixed(digits))
    setValue(c)
    if (bound(node, node.float ? 'EVT_SPINCTRLDOUBLE' : 'EVT_SPINCTRL') || bound(node, 'EVT_TEXT')) send({ id: node.id!, type: 'spin', value: c })
  }
  const inc = node.inc ?? 1
  return (
    <span className="kt-spin" style={sizeStyle(node, useContext(FillCtx))} title={node.tip}>
      <input
        value={text}
        disabled={node.en === false || disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(Number(text))}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit(Number(text))
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            commit(Number(value) + inc)
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            commit(Number(value) - inc)
          }
        }}
      />
      <span className="kt-spin-btns">
        <button type="button" tabIndex={-1} disabled={node.en === false || disabled} onClick={() => commit(Number(value) + inc)}>
          ▲
        </button>
        <button type="button" tabIndex={-1} disabled={node.en === false || disabled} onClick={() => commit(Number(value) - inc)}>
          ▼
        </button>
      </span>
    </span>
  )
}

function ChoiceView({ node }: { node: WxNode }) {
  const { send, disabled } = useWx()
  const items = node.items as unknown as string[]
  const evName = node.t === 'Combo' ? 'EVT_COMBOBOX' : 'EVT_CHOICE'
  const [sel, setSel] = useValue<number>(node, node.sel ?? -1)
  const value = node.t === 'Combo' && sel < 0 ? String(node.value ?? '') : items[sel] ?? ''
  return (
    <select
      className="kt-choice"
      style={{ ...look(node), ...sizeStyle(node, useContext(FillCtx)) }}
      value={sel >= 0 ? String(sel) : ''}
      disabled={node.en === false || disabled}
      title={node.tip ?? value}
      onChange={(e) => {
        const i = Number(e.target.value)
        if (bound(node, evName)) send({ id: node.id!, type: 'choice', sel: i })
        else setSel(i)
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {sel < 0 && <option value="">{value}</option>}
      {items.map((s, i) => (
        <option key={i} value={String(i)}>
          {s}
        </option>
      ))}
    </select>
  )
}

function CheckView({ node }: { node: WxNode }) {
  const { send, disabled } = useWx()
  const [value, setValue] = useValue<boolean>(node, !!node.value)
  return (
    <label className="kt-check" title={node.tip} style={look(node)}>
      <input
        type="checkbox"
        checked={value}
        disabled={node.en === false || disabled}
        onChange={(e) => {
          if (bound(node, 'EVT_CHECKBOX')) send({ id: node.id!, type: 'check', value: e.target.checked })
          else setValue(e.target.checked)
        }}
      />
      {node.label}
    </label>
  )
}

function RadioView({ node }: { node: WxNode }) {
  const { send, disabled } = useWx()
  return (
    <label className="kt-check" title={node.tip} style={look(node)}>
      <input type="radio" checked={!!node.value} disabled={node.en === false || disabled} onChange={() => send({ id: node.id!, type: 'radio', value: true })} />
      {node.label}
    </label>
  )
}

function RadioBoxView({ node }: { node: WxNode }) {
  const { send, disabled } = useWx()
  const items = node.items as unknown as string[]
  return (
    <fieldset className="kt-staticbox">
      <legend>{node.label}</legend>
      <div className="kt-grid" style={{ gridTemplateColumns: `repeat(${Number(node.cols) || 1}, auto)` }}>
        {items.map((s, i) => (
          <label key={i} className="kt-check">
            <input type="radio" checked={node.sel === i} disabled={node.en === false || disabled} onChange={() => send({ id: node.id!, type: 'radiobox', sel: i })} />
            {s}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function ListView({ node }: { node: WxNode }) {
  const { send, disabled, pending, setPending } = useWx()
  const items = node.items as unknown as string[]
  const isCheck = node.t === 'CheckList'
  const local = pending.get(node.id!) as { checked: number[]; sel: number } | undefined
  const checked = local?.checked ?? node.checked ?? []
  const sel = local?.sel ?? node.sel ?? -1
  return (
    <div className="kt-listbox" style={sizeStyle(node, useContext(FillCtx))} title={node.tip}>
      {items.map((s, i) => (
        <div
          key={i}
          className={`kt-listitem${i === sel ? ' kt-sel' : ''}`}
          onClick={() => {
            if (disabled) return
            if (!isCheck && bound(node, 'EVT_LISTBOX')) send({ id: node.id!, type: 'select', sel: i })
            else setPending(node.id!, isCheck ? { checked, sel: i } : i)
          }}
          onDoubleClick={() => bound(node, 'EVT_LISTBOX_DCLICK') && send({ id: node.id!, type: 'dclick', sel: i })}
        >
          {isCheck && (
            <input
              type="checkbox"
              checked={checked.includes(i)}
              disabled={disabled}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const next = e.target.checked ? [...new Set([...checked, i])] : checked.filter((c) => c !== i)
                if (bound(node, 'EVT_CHECKLISTBOX')) send({ id: node.id!, type: 'check', index: i, value: e.target.checked })
                else setPending(node.id!, { checked: next, sel })
              }}
            />
          )}
          {s}
        </div>
      ))}
    </div>
  )
}

function GridView({ node }: { node: WxNode }) {
  const { send, disabled, pending, setPending } = useWx()
  const cols = (node.cols as string[]) ?? []
  const widths = node.widths ?? []
  const rows = node.rows ?? []
  const local = pending.get(node.id!) as [number, number] | undefined
  const cursor = local ?? node.cursor ?? [-1, -1]
  const [edit, setEdit] = useState<{ r: number; c: number; v: string } | null>(null)
  const ro = new Set((Array.isArray(node.ro) ? node.ro : []).map(([r, c]) => `${r},${c}`))
  const select = (r: number, c: number) => {
    if (disabled) return
    if (bound(node, 'EVT_GRID_SELECT_CELL') || bound(node, 'EVT_GRID_CELL_LEFT_CLICK')) send({ id: node.id!, type: 'select', row: r, col: c })
    else setPending(node.id!, [r, c])
  }
  const commit = () => {
    if (!edit) return
    send({ id: node.id!, type: 'edit', row: edit.r, col: edit.c, value: edit.v })
    setEdit(null)
  }
  const bgs = new Map((node.bgs ?? []).map(([r, c, v]) => [`${r},${c}`, v]))
  return (
    <div className="kt-wxgrid" style={sizeStyle(node, useContext(FillCtx))} title={node.tip}>
      <table style={look(node)}>
        <thead>
          <tr>
            <th className="kt-corner" style={{ width: node.rowLabelW ?? 30, height: node.colLabelH ?? 24 }} />
            {cols.map((c, i) => (
              <th key={i} style={{ width: widths[i] ?? 80, minWidth: widths[i] ?? 80 }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={node.selRows?.includes(r) ? 'kt-sel' : ''}>
              <th className="kt-rowlabel" onClick={() => !disabled && send({ id: node.id!, type: 'label', row: r, col: -1 })}>
                {node.rowLabels?.[String(r)] ?? r + 1}
              </th>
              {row.map((v, c) =>
                edit && edit.r === r && edit.c === c ? (
                  <td key={c} className="kt-editing">
                    <input
                      autoFocus
                      value={edit.v}
                      onChange={(e) => setEdit({ ...edit, v: e.target.value })}
                      onBlur={commit}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') commit()
                        if (e.key === 'Escape') setEdit(null)
                      }}
                    />
                  </td>
                ) : (
                  <td
                    key={c}
                    className={cursor[0] === r && cursor[1] === c ? 'kt-cursor' : ''}
                    style={{ background: bgs.get(`${r},${c}`) }}
                    onClick={() => select(r, c)}
                    onDoubleClick={() => {
                      if (!disabled && node.editable && !ro.has(`${r},${c}`)) setEdit({ r, c, v })
                    }}
                  >
                    {v}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ListCtrlView({ node }: { node: WxNode }) {
  const { send, disabled } = useWx()
  const cols = (node.cols as string[]) ?? []
  return (
    <div className="kt-wxgrid" style={sizeStyle(node, useContext(FillCtx))}>
      <table>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={i} style={{ width: node.widths?.[i] && node.widths[i] > 0 ? node.widths[i] : undefined }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(node.rows ?? []).map((row, r) => (
            <tr key={r} className={node.sel === r ? 'kt-sel' : ''} onClick={() => !disabled && send({ id: node.id!, type: 'select', index: r })} onDoubleClick={() => !disabled && send({ id: node.id!, type: 'activate', index: r })}>
              {row.map((v, c) => (
                <td key={c}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NotebookView({ node }: { node: WxNode }) {
  const { send } = useWx()
  const pages = node.pages ?? []
  const sel = node.sel ?? 0
  const page = pages[sel]
  return (
    <div className="kf-notebook kt-notebook" style={sizeStyle(node, useContext(FillCtx))}>
      <div className="kf-tabs" role="tablist">
        {pages.map((p, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === sel} className={i === sel ? 'kf-tab-on' : ''} onClick={() => i !== sel && send({ id: node.id!, type: 'tab', sel: i })}>
            {p.title}
          </button>
        ))}
      </div>
      <div className="kf-page kt-pagebody">{page?.n && <WxView node={page.n} />}</div>
    </div>
  )
}

function CanvasView({ node }: { node: WxNode }) {
  const { arrays, send } = useWx()
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div className="kt-canvas" ref={ref} style={sizeStyle(node, useContext(FillCtx))}>
      <FigurePlot fig={node.fig ?? null} arrays={arrays} still onDoubleClick={() => bound(node, 'EVT_LEFT_DCLICK') && send({ id: node.id!, type: 'dclick' })} />
    </div>
  )
}

function SliderView({ node }: { node: WxNode }) {
  const { send, disabled } = useWx()
  const [value, setValue] = useValue<number>(node, Number(node.value ?? 0))
  return (
    <input
      type="range"
      className="kt-slider"
      min={node.min}
      max={node.max}
      value={value}
      disabled={node.en === false || disabled}
      onChange={(e) => setValue(Number(e.target.value))}
      onPointerUp={() => send({ id: node.id!, type: 'slider', value })}
    />
  )
}
