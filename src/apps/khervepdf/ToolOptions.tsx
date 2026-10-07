// The options popover of a drawing tool (the desktop's dropdown beside each
// tool button): colour grid, custom colour, width, opacity, fill, text size.

import { useEffect, useRef } from 'react'
import { PALETTE, TOOL_BY_ID, type ToolId, type ToolSetting } from './tools'

interface Props {
  tool: ToolId
  setting: ToolSetting
  /** Where to show it (viewport coordinates of the button). */
  anchor: { left: number; top: number }
  onChange: (s: ToolSetting) => void
  onClose: () => void
}

export function ToolOptions({ tool, setting, anchor, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const def = TOOL_BY_ID[tool]
  const o = def.options ?? {}
  const set = (patch: Partial<ToolSetting>) => onChange({ ...setting, ...patch })

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.kp-options-btn')) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 268))
  return (
    <div ref={ref} className="kp-options" style={{ left, top: anchor.top }} role="dialog" aria-label={`${def.label} options`}>
      <div className="kp-options-title">{def.label}</div>
      {o.color !== false && (
        <>
          <div className="kp-palette">
            {PALETTE.flat().map((c) => (
              <button
                key={c}
                className={`kp-swatch${c.toLowerCase() === setting.color.toLowerCase() ? ' active' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => set({ color: c })}
              />
            ))}
          </div>
          <label className="kp-options-row">
            <span>Custom colour</span>
            <input type="color" value={setting.color} onChange={(e) => set({ color: e.target.value })} />
          </label>
        </>
      )}
      {o.width && (
        <label className="kp-options-row">
          <span>Width</span>
          <input type="range" min={1} max={30} step={1} value={Math.round(setting.width)} onChange={(e) => set({ width: Number(e.target.value) })} />
          <span className="kp-options-val">{Math.round(setting.width)} pt</span>
        </label>
      )}
      {o.size && (
        <label className="kp-options-row">
          <span>Size</span>
          <input
            type="number"
            className="k-input kp-options-num"
            min={4}
            max={96}
            step={1}
            value={setting.width}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (v >= 4 && v <= 96) set({ width: v })
            }}
          />
          <span className="kp-options-val">pt</span>
        </label>
      )}
      {o.opacity && (
        <label className="kp-options-row">
          <span>Opacity</span>
          <input type="range" min={10} max={100} step={5} value={setting.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />
          <span className="kp-options-val">{setting.opacity}%</span>
        </label>
      )}
      {o.fill && (
        <div className="kp-options-row">
          <label className="kp-check">
            <input type="checkbox" checked={!!setting.filled} onChange={(e) => set({ filled: e.target.checked })} />
            <span>Fill shape</span>
          </label>
          <input
            type="color"
            disabled={!setting.filled}
            title="Fill colour (the line colour if not set)"
            value={setting.fill ?? setting.color}
            onChange={(e) => set({ fill: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}
