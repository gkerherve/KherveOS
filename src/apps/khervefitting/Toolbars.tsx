// The desktop's toolbars with its own icons and hover help (toolbarSpec.ts,
// generated from dev-AI Widgets_Toolbars.py): the main horizontal toolbar
// (with the sheet selector and the BE-correction spin control), the vertical
// plot-control toolbar, the Results grid's toolbar and the display-toggles
// pop-up.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BE_HELP, MAIN_TOOLBAR, PLOT_TOOLBAR, RESULTS_TOOLBAR, SHEET_HELP, TOGGLE_TOOLBAR, type ToolSpec } from './toolbarSpec'

export const ICONS = `${import.meta.env.BASE_URL}apps/khervefitting/icons/`

export interface ToolState {
  disabled?: boolean
  checked?: boolean
}

function Tool({ spec, state, onClick }: { spec: ToolSpec; state?: ToolState; onClick: (id: string, el: HTMLElement) => void }) {
  const icon = state?.checked && spec.iconOn ? spec.iconOn : spec.icon
  return (
    <button
      type="button"
      className={`kf-tool${state?.checked ? ' kf-checked' : ''}`}
      title={spec.help}
      aria-label={spec.label}
      disabled={state?.disabled}
      onClick={(e) => onClick(spec.id!, e.currentTarget)}
    >
      <img src={ICONS + icon} width={25} height={25} alt="" draggable={false} />
    </button>
  )
}

function Bar({ specs, vertical, states, onTool, controls }: { specs: ToolSpec[]; vertical?: boolean; states: Record<string, ToolState>; onTool: (id: string, el: HTMLElement) => void; controls?: Record<string, ReactNode> }) {
  return (
    <>
      {specs.map((s, k) => {
        if (s.sep) return <span key={k} className={vertical ? 'kf-hsep' : 'kf-vsep'} />
        if (s.stretch) return <span key={k} className="kf-grow" />
        if (s.control) return <span key={k} className="kf-control">{controls?.[s.control]}</span>
        return <Tool key={k} spec={s} state={states[s.id!]} onClick={onTool} />
      })}
    </>
  )
}

/** wx.SpinCtrlDouble: a number box with up/down arrows (0.01 eV steps). */
export function SpinDouble({ value, onChange, step = 0.01, digits = 2, width = 70, title, disabled }: { value: number; onChange: (v: number) => void; step?: number; digits?: number; width?: number; title?: string; disabled?: boolean }) {
  const [text, setText] = useState(value.toFixed(digits))
  useEffect(() => setText(value.toFixed(digits)), [value, digits])
  const commit = (v: number) => {
    if (!Number.isFinite(v)) return setText(value.toFixed(digits))
    const r = Math.round(v / step) * step
    setText(r.toFixed(digits))
    if (Math.abs(r - value) > step / 10) onChange(Number(r.toFixed(digits)))
  }
  return (
    <span className="kf-spin" title={title} style={{ width }}>
      <input
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(Number(text))}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit(Number(text))
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            commit(value + step)
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            commit(value - step)
          }
        }}
      />
      <span className="kf-spin-btns">
        <button type="button" tabIndex={-1} disabled={disabled} onClick={() => commit(value + step)}>
          ▲
        </button>
        <button type="button" tabIndex={-1} disabled={disabled} onClick={() => commit(value - step)}>
          ▼
        </button>
      </span>
    </span>
  )
}

export interface MainToolbarProps {
  sheets: string[]
  sheet: string
  be: number
  states: Record<string, ToolState>
  onSheet: (s: string) => void
  onBe: (v: number) => void
  onTool: (id: string, el: HTMLElement) => void
}

export function MainToolbar({ sheets, sheet, be, states, onSheet, onBe, onTool }: MainToolbarProps) {
  const controls = {
    sheet: (
      <select className="kf-combo" value={sheet} title={SHEET_HELP} onChange={(e) => onSheet(e.target.value)} disabled={!sheets.length} aria-label="Sheet selector">
        {!sheets.length && <option value="" />}
        {sheets.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
    ),
    be: <SpinDouble value={be} onChange={onBe} title={BE_HELP} disabled={!sheets.length} />,
  }
  return (
    <div className="kf-toolbar">
      <Bar specs={MAIN_TOOLBAR} states={states} onTool={onTool} controls={controls} />
    </div>
  )
}

export function PlotToolbar({ states, onTool }: { states: Record<string, ToolState>; onTool: (id: string, el: HTMLElement) => void }) {
  return (
    <div className="kf-vtoolbar">
      <Bar specs={PLOT_TOOLBAR} vertical states={states} onTool={onTool} />
    </div>
  )
}

export function ResultsToolbar({ states, onTool }: { states: Record<string, ToolState>; onTool: (id: string, el: HTMLElement) => void }) {
  return (
    <div className="kf-rtoolbar">
      <Bar specs={RESULTS_TOOLBAR} states={states} onTool={onTool} />
    </div>
  )
}

/** The six display toggles, shown beside the Toggles button (ToggleToolbar). */
export function TogglePopup({ at, onTool, onClose }: { at: { x: number; y: number }; onTool: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [onClose])
  return (
    <div className="kf-toggles" ref={ref} style={{ left: at.x, top: at.y }}>
      <Bar specs={TOGGLE_TOOLBAR} states={{}} onTool={(id) => onTool(id)} />
    </div>
  )
}
