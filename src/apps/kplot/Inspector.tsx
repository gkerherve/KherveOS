// kPlot's options: Plot (title, x column, series and their styles), Axes, Overlays (fits,
// reference lines, notes, shaded regions) and Figure (size, fonts, theme, legend).

import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, Plus, X } from 'lucide-react'
import type { Table } from './data'
import {
  MARKERS, PALETTES, SIZE_PRESETS, newSeriesOpt, seriesColor,
  type AxisOpt, type FitSpec, type LegendPos, type Marker, type Note, type Options, type PaletteName, type RefLine, type Region, type SeriesOpt, type SizePreset,
} from './figure'
import { Check, Field, NumInput, Section, Sel } from './controls'

type Tab = 'plot' | 'axes' | 'overlays' | 'figure'
const TABS: [Tab, string][] = [['plot', 'Plot'], ['axes', 'Axes'], ['overlays', 'Overlays'], ['figure', 'Figure']]

export type SetOpt = (fn: (o: Options) => Options, key?: string) => void

interface Props {
  opt: Options
  table: Table
  setOpt: SetOpt
}

/** Whether the chart type reads the x column. */
export const usesX = (t: Options['type']): boolean => !['histogram', 'box', 'violin', 'matrix'].includes(t)
const lineTypes = (t: Options['type']) => t === 'xy' || t === 'area' || t === 'scatter3d'

export default function Inspector({ opt, table, setOpt }: Props) {
  const [tab, setTab] = useState<Tab>('plot')
  return (
    <div className="kp-inspector">
      <div className="kp-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="kp-tabbody">
        {tab === 'plot' && <PlotTab opt={opt} table={table} setOpt={setOpt} />}
        {tab === 'axes' && <AxesTab opt={opt} setOpt={setOpt} />}
        {tab === 'overlays' && <OverlaysTab opt={opt} setOpt={setOpt} table={table} />}
        {tab === 'figure' && <FigureTab opt={opt} setOpt={setOpt} />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Plot

function PlotTab({ opt, table, setOpt }: Props) {
  const patch = (p: Partial<Options>, key?: string) => setOpt((o) => ({ ...o, ...p }), key)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const colOptions: [string, string][] = table.headers.map((h, i) => [String(i), `${i + 1}. ${h}`])
  const taken = new Set(opt.series.map((s) => s.col))
  const free = table.headers.map((_, i) => i).filter((i) => !taken.has(i) && (i !== opt.xi || !usesX(opt.type)))
  const setSeries = (k: number, p: Partial<SeriesOpt>, key?: string) =>
    setOpt((o) => ({ ...o, series: o.series.map((s, j) => (j === k ? { ...s, ...p } : s)) }), key)
  const move = (k: number, d: number) =>
    setOpt((o) => {
      const s = o.series.slice()
      const j = k + d
      if (j < 0 || j >= s.length) return o
      ;[s[k], s[j]] = [s[j], s[k]]
      // fits follow their series
      const fits = o.fits.map((f) => (f.series === k ? { ...f, series: j } : f.series === j ? { ...f, series: k } : f))
      return { ...o, series: s, fits }
    })
  const remove = (k: number) =>
    setOpt((o) => ({
      ...o,
      series: o.series.filter((_, j) => j !== k),
      fits: o.fits.filter((f) => f.series !== k).map((f) => (f.series > k ? { ...f, series: f.series - 1 } : f)),
    }))
  const toggle = (k: number) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const xLabel = opt.type === 'bar' || opt.type === 'stacked' ? 'Categories' : opt.type === 'heatmap' || opt.type === 'contour' || opt.type === 'surface' ? 'Row labels' : 'x column'

  return (
    <>
      <Section title="Plot">
        <Field label="Title" wide>
          <input className="k-input kp-in" value={opt.title} placeholder="e.g. H_2O uptake" onChange={(e) => patch({ title: e.target.value }, 'title')} />
        </Field>
        {usesX(opt.type) && (
          <Field label={xLabel} wide>
            <Sel label={xLabel} value={String(opt.xi)} options={colOptions} onChange={(v) => setOpt((o) => ({ ...o, xi: Number(v), series: o.series.filter((s) => s.col !== Number(v)) }))} />
          </Field>
        )}
        {lineTypes(opt.type) && opt.type !== 'scatter3d' && (
          <Field label="Style" wide>
            <Sel label="Style" value={opt.style} options={[['both', 'Points and lines'], ['line', 'Lines'], ['points', 'Points']]} onChange={(v) => patch({ style: v })} />
          </Field>
        )}
        {opt.type === 'histogram' && (
          <div className="kp-row">
            <Field label="Bins (0 = auto)"><NumInput label="Bins" value={opt.bins || null} placeholder="auto" onChange={(v) => patch({ bins: v ? Math.round(v) : 0 })} /></Field>
            <Field label="Height"><Sel label="Histogram height" value={opt.histNorm} options={[['count', 'Count'], ['density', 'Density']]} onChange={(v) => patch({ histNorm: v })} /></Field>
          </div>
        )}
      </Section>

      <Section
        title={opt.type === 'scatter3d' ? 'y and z columns' : 'Series'}
        actions={free.length > 0 && (
          <select
            className="k-input kp-in kp-add"
            value=""
            aria-label="Add a series"
            onChange={(e) => e.target.value !== '' && setOpt((o) => ({ ...o, series: [...o.series, newSeriesOpt(Number(e.target.value))] }))}
          >
            <option value="">+ Add column…</option>
            {free.map((i) => <option key={i} value={i}>{table.headers[i]}</option>)}
          </select>
        )}
      >
        {opt.series.length === 0 && <div className="k-muted kp-hint">Add at least one column to plot.</div>}
        {opt.series.map((s, k) => {
          const color = seriesColor(s, k, opt.palette, opt.theme)
          const expanded = open.has(k)
          const t = opt.type
          return (
            <div key={s.col} className={`kp-series${s.hidden ? ' hidden' : ''}`}>
              <div className="kp-series-head">
                <button className="k-icon-btn kp-mini" aria-label={expanded ? 'Collapse' : 'Expand'} onClick={() => toggle(k)}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
                <input
                  type="color"
                  className="kp-color"
                  value={color.length === 7 ? color : '#1f4e9c'}
                  aria-label={`Colour of ${s.name || table.headers[s.col]}`}
                  title="Colour"
                  onChange={(e) => setSeries(k, { color: e.target.value }, `color${k}`)}
                />
                <input
                  className="k-input kp-in kp-sname"
                  value={s.name ?? ''}
                  placeholder={table.headers[s.col]}
                  aria-label="Legend name"
                  title="Legend name (H_2O, m^2, \alpha are formatted)"
                  onChange={(e) => setSeries(k, { name: e.target.value }, `name${k}`)}
                />
                <button className="k-icon-btn kp-mini" aria-label={s.hidden ? 'Show' : 'Hide'} title={s.hidden ? 'Show' : 'Hide'} onClick={() => setSeries(k, { hidden: !s.hidden })}>{s.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                <button className="k-icon-btn kp-mini" aria-label="Move up" disabled={k === 0} onClick={() => move(k, -1)}><ArrowUp size={13} /></button>
                <button className="k-icon-btn kp-mini" aria-label="Move down" disabled={k === opt.series.length - 1} onClick={() => move(k, 1)}><ArrowDown size={13} /></button>
                <button className="k-icon-btn kp-mini" aria-label="Remove" onClick={() => remove(k)}><X size={13} /></button>
              </div>
              {expanded && (
                <div className="kp-series-body">
                  {t === 'xy' && (
                    <>
                      <div className="kp-row">
                        <Field label="Draw"><Sel label="Series style" value={s.style || ''} options={[['', `Default (${opt.style})`], ['both', 'Points and lines'], ['line', 'Lines'], ['points', 'Points']]} onChange={(v) => setSeries(k, { style: v })} /></Field>
                        <Field label="Marker"><Sel label="Marker" value={s.marker || ''} options={[['', 'Automatic'], ...MARKERS.map((m): [Marker | '', string] => [m, m])]} onChange={(v) => setSeries(k, { marker: v })} /></Field>
                      </div>
                      <div className="kp-row">
                        <Field label="Line"><Sel label="Line style" value={s.lineStyle ?? 'solid'} options={[['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]} onChange={(v) => setSeries(k, { lineStyle: v })} /></Field>
                        <Field label="Width (pt)"><NumInput label="Line width" value={s.width || null} placeholder="auto" onChange={(v) => setSeries(k, { width: v ?? 0 })} /></Field>
                        <Field label="Size (pt)"><NumInput label="Marker size" value={s.size || null} placeholder="auto" onChange={(v) => setSeries(k, { size: v ?? 0 })} /></Field>
                      </div>
                    </>
                  )}
                  {(t === 'area' || t === 'box' || t === 'violin') && (
                    <Field label="Line width (pt)"><NumInput label="Line width" value={s.width || null} placeholder="auto" onChange={(v) => setSeries(k, { width: v ?? 0 })} /></Field>
                  )}
                  {t === 'scatter3d' && (
                    <Field label="Marker size (pt)"><NumInput label="Marker size" value={s.size || null} placeholder="auto" onChange={(v) => setSeries(k, { size: v ?? 0 })} /></Field>
                  )}
                  <div className="kp-row">
                    <Field label={t === 'xy' ? 'Marker opacity' : 'Fill opacity'}>
                      <input
                        type="range" min={0.05} max={1} step={0.05} value={s.opacity ?? 1}
                        aria-label="Opacity"
                        onChange={(e) => setSeries(k, { opacity: Number(e.target.value) }, `op${k}`)}
                      />
                    </Field>
                    {(t === 'xy' || t === 'area' || t === 'bar') && (
                      <Field label="y axis"><Sel label="y axis" value={s.axis ?? 'left'} options={[['left', 'Left'], ['right', 'Right']]} onChange={(v) => setSeries(k, { axis: v })} /></Field>
                    )}
                  </div>
                  {(t === 'xy' || t === 'bar') && (
                    <div className="kp-row">
                      <Field label="Error bars">
                        <Sel label="Error bars" value={s.errors} options={[['none', 'None'], ['column', 'From a column'], ['sd', '± standard deviation']]} onChange={(v) => setSeries(k, { errors: v })} />
                      </Field>
                      {s.errors === 'column' && (
                        <Field label="± column">
                          <Sel label="Error column" value={String(s.errCol)} options={[['-1', 'Choose…'], ...colOptions.filter(([v]) => Number(v) !== s.col)]} onChange={(v) => setSeries(k, { errCol: Number(v) })} />
                        </Field>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </Section>
    </>
  )
}

// ------------------------------------------------------------------ Axes

function AxisBox({ title, a, onChange, nolog }: { title: string; a: AxisOpt; onChange(p: Partial<AxisOpt>, key?: string): void; nolog?: boolean }) {
  return (
    <Section title={title}>
      <Field label="Label" wide>
        <input className="k-input kp-in" value={a.label} placeholder="column name" onChange={(e) => onChange({ label: e.target.value }, `label-${title}`)} title="H_2O, m^2, x_{max}, \alpha, \AA are formatted" />
      </Field>
      <div className="kp-row">
        <Field label="Scale">
          <Sel
            label={`${title} scale`} value={a.scale} onChange={(v) => onChange({ scale: v })}
            options={nolog ? [['linear', 'Linear']] : [['linear', 'Linear'], ['log10', 'Log10'], ['ln', 'ln (shows ln values)']]}
          />
        </Field>
        <Field label="Ticks"><NumInput label={`${title} tick count`} value={a.ticks} onChange={(v) => v !== null && onChange({ ticks: v })} /></Field>
      </div>
      <div className="kp-row">
        <Field label="Min"><NumInput label={`${title} minimum`} value={a.min} placeholder="auto" onChange={(v) => onChange({ min: v })} /></Field>
        <Field label="Max"><NumInput label={`${title} maximum`} value={a.max} placeholder="auto" onChange={(v) => onChange({ max: v })} /></Field>
      </div>
      <div className="kp-row">
        <Field label="Numbers">
          <Sel label={`${title} number format`} value={a.format} options={[['auto', 'Automatic'], ['fixed', 'Fixed'], ['sci', 'Scientific']]} onChange={(v) => onChange({ format: v })} />
        </Field>
        {a.format !== 'auto' && <Field label="Decimals"><NumInput label={`${title} decimals`} value={a.decimals} onChange={(v) => v !== null && onChange({ decimals: v })} /></Field>}
      </div>
      <div className="kp-checks">
        <Check label="Grid" checked={a.grid} onChange={(v) => onChange({ grid: v })} />
        <Check label="Minor" checked={a.minorGrid} onChange={(v) => onChange({ minorGrid: v })} title="Minor ticks (and minor grid lines when the grid is on)" />
        <Check label="Reversed" checked={a.invert} onChange={(v) => onChange({ invert: v })} title="Reverse the axis (binding energy, wavenumber…)" />
      </div>
    </Section>
  )
}

function AxesTab({ opt, setOpt }: { opt: Options; setOpt: SetOpt }) {
  const axis = (which: 'x' | 'y' | 'y2') => (p: Partial<AxisOpt>, key?: string) => setOpt((o) => ({ ...o, [which]: { ...o[which], ...p } }), key)
  const hasRight = opt.series.some((s) => s.axis === 'right')
  const t = opt.type
  if (t === 'heatmap' || t === 'contour' || t === 'matrix') {
    return <div className="k-muted kp-hint">This chart type has its own axes: the labels come from the table. Use the Figure tab for fonts and the theme.</div>
  }
  const categorical = t === 'bar' || t === 'stacked' || t === 'box' || t === 'violin'
  return (
    <>
      <AxisBox title="x axis" a={opt.x} onChange={axis('x')} nolog={categorical} />
      <AxisBox title="y axis" a={opt.y} onChange={axis('y')} nolog={t === 'surface' || t === 'scatter3d'} />
      {hasRight && <AxisBox title="Right y axis" a={opt.y2} onChange={axis('y2')} />}
    </>
  )
}

// ------------------------------------------------------------------ Overlays

function OverlaysTab({ opt, table, setOpt }: Props) {
  const seriesOptions: [string, string][] = opt.series.map((s, k) => [String(k), s.name || table.headers[s.col] || `series ${k + 1}`])
  const set = <K extends 'fits' | 'lines' | 'notes' | 'regions'>(key: K, fn: (list: Options[K]) => Options[K], k?: string) =>
    setOpt((o) => ({ ...o, [key]: fn(o[key]) }), k)
  const upd = <K extends 'fits' | 'lines' | 'notes' | 'regions'>(key: K, i: number, p: Partial<Options[K][number]>, undoKey?: string) =>
    set(key, (list) => (list as unknown[]).map((q, j) => (j === i ? { ...(q as object), ...p } : q)) as Options[K], undoKey)
  const del = <K extends 'fits' | 'lines' | 'notes' | 'regions'>(key: K, i: number) => set(key, (list) => (list as unknown[]).filter((_, j) => j !== i) as Options[K])
  const add = (btn: string, onClick: () => void, disabled = false) => (
    <button className="k-icon-btn kp-mini" aria-label={btn} title={btn} onClick={onClick} disabled={disabled}><Plus size={14} /></button>
  )
  const svgOnlyXY = opt.type === 'xy' || opt.type === 'area'
  return (
    <>
      <Section title="Fit lines" actions={add('Add a fit line', () => set('fits', (l) => [...l, { series: 0, degree: 1, label: true } as FitSpec]), !svgOnlyXY || opt.series.length === 0)}>
        {!svgOnlyXY && <div className="k-muted kp-hint">Fits are for scatter / line and area plots.</div>}
        {opt.fits.map((f, i) => (
          <div key={i} className="kp-item">
            <div className="kp-row">
              <Field label="Series"><Sel label="Fit series" value={String(f.series)} options={seriesOptions} onChange={(v) => upd('fits', i, { series: Number(v) })} /></Field>
              <Field label="Degree"><Sel label="Polynomial degree" value={String(f.degree)} options={[['1', '1 (straight line)'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6']]} onChange={(v) => upd('fits', i, { degree: Number(v) })} /></Field>
              <button className="k-icon-btn kp-mini" aria-label="Remove fit" onClick={() => del('fits', i)}><X size={13} /></button>
            </div>
            <Check label="Print equation and R²" checked={f.label} onChange={(v) => upd('fits', i, { label: v })} />
          </div>
        ))}
      </Section>

      <Section title="Reference lines" actions={add('Add a reference line', () => set('lines', (l) => [...l, { axis: 'y', value: 0, lineStyle: 'dashed' } as RefLine]))}>
        {opt.lines.map((r, i) => (
          <div key={i} className="kp-item">
            <div className="kp-row">
              <Field label="Line at"><Sel label="Axis" value={r.axis} options={[['y', 'y ='], ['x', 'x ='], ['y2', 'right y =']]} onChange={(v) => upd('lines', i, { axis: v })} /></Field>
              <Field label="Value"><NumInput label="Value" value={r.value} onChange={(v) => v !== null && upd('lines', i, { value: v }, `line${i}`)} /></Field>
              <button className="k-icon-btn kp-mini" aria-label="Remove line" onClick={() => del('lines', i)}><X size={13} /></button>
            </div>
            <div className="kp-row">
              <Field label="Label"><input className="k-input kp-in" value={r.label ?? ''} onChange={(e) => upd('lines', i, { label: e.target.value }, `linelabel${i}`)} /></Field>
              <Field label="Style"><Sel label="Line style" value={r.lineStyle ?? 'dashed'} options={[['dashed', 'Dashed'], ['dotted', 'Dotted'], ['solid', 'Solid']]} onChange={(v) => upd('lines', i, { lineStyle: v })} /></Field>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Shaded regions" actions={add('Add a shaded region', () => set('regions', (l) => [...l, { axis: 'x', from: 0, to: 1 } as Region]))}>
        {opt.regions.map((r, i) => (
          <div key={i} className="kp-item">
            <div className="kp-row">
              <Field label="Range of"><Sel label="Axis" value={r.axis} options={[['x', 'x'], ['y', 'y']]} onChange={(v) => upd('regions', i, { axis: v })} /></Field>
              <Field label="From"><NumInput label="From" value={r.from} onChange={(v) => v !== null && upd('regions', i, { from: v }, `from${i}`)} /></Field>
              <Field label="To"><NumInput label="To" value={r.to} onChange={(v) => v !== null && upd('regions', i, { to: v }, `to${i}`)} /></Field>
              <button className="k-icon-btn kp-mini" aria-label="Remove region" onClick={() => del('regions', i)}><X size={13} /></button>
            </div>
            <div className="kp-row">
              <Field label="Label"><input className="k-input kp-in" value={r.label ?? ''} onChange={(e) => upd('regions', i, { label: e.target.value }, `rlabel${i}`)} /></Field>
              <Field label="Colour"><input type="color" className="kp-color" value={r.color ?? '#f5b942'} aria-label="Region colour" onChange={(e) => upd('regions', i, { color: e.target.value }, `rcolor${i}`)} /></Field>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Text notes" actions={add('Add a note', () => set('notes', (l) => [...l, { x: 0, y: 0, text: 'note' } as Note]))}>
        <div className="k-muted kp-hint">Placed by data coordinates. H_2O, m^2 and \alpha are formatted.</div>
        {opt.notes.map((nt, i) => (
          <div key={i} className="kp-item">
            <div className="kp-row">
              <Field label="x"><NumInput label="Note x" value={nt.x} onChange={(v) => v !== null && upd('notes', i, { x: v }, `nx${i}`)} /></Field>
              <Field label="y"><NumInput label="Note y" value={nt.y} onChange={(v) => v !== null && upd('notes', i, { y: v }, `ny${i}`)} /></Field>
              <button className="k-icon-btn kp-mini" aria-label="Remove note" onClick={() => del('notes', i)}><X size={13} /></button>
            </div>
            <Field label="Text" wide><input className="k-input kp-in" value={nt.text} onChange={(e) => upd('notes', i, { text: e.target.value }, `nt${i}`)} /></Field>
          </div>
        ))}
      </Section>
    </>
  )
}

// ------------------------------------------------------------------ Figure

function FigureTab({ opt, setOpt }: { opt: Options; setOpt: SetOpt }) {
  const patch = (p: Partial<Options>, key?: string) => setOpt((o) => ({ ...o, ...p }), key)
  const presets: [SizePreset, string][] = [...Object.entries(SIZE_PRESETS).map(([k, v]): [SizePreset, string] => [k as SizePreset, v.label]), ['custom', 'Custom size']]
  const pickPreset = (p: SizePreset) => {
    if (p === 'custom') patch({ sizePreset: p })
    else {
      const s = SIZE_PRESETS[p]
      patch({ sizePreset: p, width: s.w, height: s.h, fontSize: s.font })
    }
  }
  const legends: [LegendPos, string][] = [
    ['auto', 'Automatic'], ['top-right', 'Inside, top right'], ['top-left', 'Inside, top left'], ['bottom-right', 'Inside, bottom right'], ['bottom-left', 'Inside, bottom left'],
    ['outside-right', 'Outside, right'], ['outside-top', 'Outside, top'], ['none', 'None'],
  ]
  return (
    <>
      <Section title="Size">
        <Field label="Preset" wide><Sel label="Size preset" value={opt.sizePreset} options={presets} onChange={pickPreset} /></Field>
        <div className="kp-row">
          <Field label="Width (mm)"><NumInput label="Width in millimetres" value={Math.round(opt.width * 10) / 10} onChange={(v) => v && patch({ width: v, sizePreset: 'custom' })} /></Field>
          <Field label="Height (mm)"><NumInput label="Height in millimetres" value={Math.round(opt.height * 10) / 10} onChange={(v) => v && patch({ height: v, sizePreset: 'custom' })} /></Field>
        </div>
      </Section>
      <Section title="Text and lines">
        <div className="kp-row">
          <Field label="Font"><Sel label="Font family" value={opt.fontFamily} options={[['sans', 'Sans (Helvetica)'], ['serif', 'Serif (Times)'], ['mono', 'Monospace']]} onChange={(v) => patch({ fontFamily: v })} /></Field>
          <Field label="Size (pt)"><NumInput label="Font size" value={opt.fontSize} onChange={(v) => v && patch({ fontSize: v })} /></Field>
        </div>
        <div className="kp-row">
          <Field label="Axis line (pt)"><NumInput label="Axis line width" value={opt.lineWidth || null} placeholder="auto" onChange={(v) => patch({ lineWidth: v ?? 0 })} /></Field>
          <Field label="Ticks"><Sel label="Tick direction" value={opt.ticksDir} options={[['out', 'Outside'], ['in', 'Inside']]} onChange={(v) => patch({ ticksDir: v })} /></Field>
        </div>
        <Field label="Axes" wide><Sel label="Frame" value={opt.frame} options={[['box', 'Box (frame all round)'], ['l', 'L-shaped (left and bottom)']]} onChange={(v) => patch({ frame: v })} /></Field>
      </Section>
      <Section title="Look">
        <Field label="Theme" wide><Sel label="Figure theme" value={opt.theme} options={[['white', 'White (publication)'], ['dark', 'Dark'], ['transparent', 'Transparent background']]} onChange={(v) => patch({ theme: v })} /></Field>
        <Field label="Colours" wide><Sel label="Palette" value={opt.palette} options={Object.entries(PALETTES).map(([k, v]): [PaletteName, string] => [k as PaletteName, v.label])} onChange={(v) => patch({ palette: v })} /></Field>
        <div className="kp-swatches" aria-hidden="true">
          {PALETTES[opt.palette].colors.slice(0, 8).map((c) => <i key={c} style={{ background: c }} />)}
        </div>
        <Field label="Legend" wide><Sel label="Legend position" value={opt.legend} options={legends} onChange={(v) => patch({ legend: v })} /></Field>
      </Section>
      <div className="k-muted kp-hint">The figure keeps its own colours whatever the KherveOS theme is.</div>
    </>
  )
}

