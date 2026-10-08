// The options popup of a drawing tool (mainwindow._OptionsPopup), shown under
// the dropdown arrow beside the tool's button: the colour grid, "Custom
// colour…", then Width, Opacity, Fill shape (+ fill colour) and Size rows.
// Every row is always there; the ones that don't apply to the tool are greyed.

import { useEffect, useRef } from 'react'
import { PALETTE, type ToolId, type ToolSetting } from './tools'

interface Props {
  tool: ToolId
  setting: ToolSetting
  /** Where to show it (viewport coordinates under the button). */
  anchor: { left: number; top: number }
  onChange: (s: ToolSetting) => void
  onClose: () => void
}

export function ToolOptions({ tool, setting, anchor, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const custom = useRef<HTMLInputElement>(null)
  const fillPick = useRef<HTMLInputElement>(null)
  const isText = tool === 'text' || tool === 'edit_text'
  const isShape = tool === 'rect' || tool === 'ellipse'
  const set = (patch: Partial<ToolSetting>) => onChange({ ...setting, ...patch })

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.kp-split-arrow')) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 260))
  const width = Math.max(1, Math.min(30, Math.round(setting.width)))
  return (
    <div ref={ref} className="kp-options" style={{ left, top: anchor.top }} role="dialog" aria-label="Tool options" onKeyDown={(e) => e.stopPropagation()}>
      <div className="kp-palette">
        {PALETTE.flat().map((c) => (
          <button
            key={c}
            className={`kp-swatch${c.toLowerCase() === setting.color.toLowerCase() ? ' active' : ''}`}
            style={{ background: c }}
            title={c.toUpperCase()}
            onClick={() => {
              set({ color: c })
              onClose()
            }}
          />
        ))}
      </div>
      <button className="k-btn kp-options-custom" onClick={() => custom.current?.click()}>Custom colour…</button>
      <input
        ref={custom}
        type="color"
        className="kp-hidden-input"
        value={setting.color}
        onChange={(e) => {
          set({ color: e.target.value })
          onClose()
        }}
      />
      <label className={`kp-options-row${isText ? ' disabled' : ''}`}>
        <span>Width:</span>
        <input type="range" min={1} max={30} step={1} disabled={isText} value={width} onChange={(e) => set({ width: Number(e.target.value) })} />
        <span className="kp-options-val">{Math.round(setting.width)} pt</span>
      </label>
      <label className={`kp-options-row${isText ? ' disabled' : ''}`}>
        <span>Opacity:</span>
        <input type="range" min={10} max={100} step={1} disabled={isText} value={setting.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />
        <span className="kp-options-val">{setting.opacity}%</span>
      </label>
      <div className={`kp-options-row${isShape ? '' : ' disabled'}`}>
        <label className="kp-check">
          <input type="checkbox" disabled={!isShape} checked={isShape && !!setting.filled} onChange={(e) => set({ filled: e.target.checked })} />
          <span>Fill shape</span>
        </label>
        <button
          className="kp-fill-swatch"
          disabled={!isShape || !setting.filled}
          title="Fill colour — defaults to stroke colour; click to override"
          style={{ background: isShape ? (setting.fill ?? setting.color) : '#888888' }}
          onClick={() => fillPick.current?.click()}
        />
        <input ref={fillPick} type="color" className="kp-hidden-input" value={setting.fill ?? setting.color} onChange={(e) => set({ fill: e.target.value })} />
      </div>
      <label className={`kp-options-row${isText ? '' : ' disabled'}`}>
        <span>Size:</span>
        <input
          type="number"
          className="k-input kp-options-num"
          min={4}
          max={96}
          step={1}
          disabled={!isText}
          value={setting.width}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (v >= 4 && v <= 96) set({ width: v })
          }}
        />
        <span className="kp-options-val">pt</span>
      </label>
    </div>
  )
}
