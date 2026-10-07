// The desktop's small tool windows, as floating windows over the app.

import { useEffect, useState } from 'react'
import { FloatWin } from './FloatWin'
import type { Limits } from './Plot'
import { SpinDouble } from './Toolbars'

/** Plot Limits (PlotConfig.PlotLimitsWindow): Binding Energy and Intensity boxes, Max / Min each with a slider and a spinner, Reset. */
export function PlotLimitsWindow({ limits, onChange, onReset, onClose }: { limits: Limits; onChange: (l: Limits) => void; onReset: () => void; onClose: () => void }) {
  const [base] = useState(limits)
  const [l, setL] = useState(limits)
  useEffect(() => setL(limits), [limits])
  const set = (p: Partial<Limits>) => {
    const n = { ...l, ...p }
    setL(n)
    onChange(n)
  }
  const spanX = Math.max(1, (base.xmax - base.xmin) * 2)
  const spanY = Math.max(1, (base.ymax - base.ymin) * 2)
  const row = (label: string, key: keyof Limits, lo: number, hi: number, step: number) => (
    <div className="kf-limrow">
      <span className="kf-limlabel">{label}</span>
      <input type="range" min={lo} max={hi} step={(hi - lo) / 1000} value={l[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
      <SpinDouble value={l[key]} step={step} width={85} onChange={(v) => set({ [key]: v })} />
    </div>
  )
  return (
    <FloatWin title="Plot Limits" initial={{ x: 120, y: 120 }} width={340} onClose={onClose}>
      <div className="kf-limits">
        <fieldset className="kf-box">
          <legend>Binding Energy (eV)</legend>
          {row('Max:', 'xmax', base.xmin - spanX / 2, base.xmax + spanX / 2, 0.1)}
          {row('Min:', 'xmin', base.xmin - spanX / 2, base.xmax + spanX / 2, 0.1)}
        </fieldset>
        <fieldset className="kf-box">
          <legend>Intensity (counts/s)</legend>
          {row('Max:', 'ymax', base.ymin - spanY / 2, base.ymax + spanY / 2, 100)}
          {row('Min:', 'ymin', base.ymin - spanY / 2, base.ymax + spanY / 2, 100)}
        </fieldset>
        <div className="kf-limbtns">
          <button type="button" className="kf-wxbtn" onClick={onReset}>
            Reset
          </button>
        </div>
      </div>
    </FloatWin>
  )
}
