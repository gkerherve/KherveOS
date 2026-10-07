// The desktop KherveTeX status bar: the document's name and folder on the
// left; on the right, Word-style zoom (−, slider, +, percent) for the Visual
// tab, the separate "| PDF:" zoom with its fit-page-width button while a PDF
// is shown, and the compiler indicator "LaTeX (tectonic): OK".

import { TexIcon } from './TexIcon'

function Zoom({ value, min, max, onChange, onStep, outTip, inTip }: {
  value: number
  min: number
  max: number
  onChange: (pct: number) => void
  onStep: (delta: number) => void
  outTip: string
  inTip: string
}) {
  const pos = ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100
  return (
    <>
      <button className="ktx-sb-btn" title={outTip} onClick={() => onStep(-10)}>
        <TexIcon name="zoom-out" />
      </button>
      <span className="ktx-slider" style={{ ['--ticks' as string]: String((max - min) / 25) }}>
        <input
          type="range"
          min={min}
          max={max}
          step={5}
          value={Math.min(max, Math.max(min, value))}
          style={{ ['--pos' as string]: `${pos}%` }}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </span>
      <button className="ktx-sb-btn" title={inTip} onClick={() => onStep(10)}>
        <TexIcon name="zoom-in" />
      </button>
      <span className="ktx-sb-pct">{Math.round(value)}%</span>
    </>
  )
}

export function StatusBar({
  name, folder, branch, message, editorZoom, showEditorZoom, onEditorZoom, pdfZoom, showPdfZoom, onPdfZoom, fit, onFit,
  compiler, compilerOk, compiling, busy,
}: {
  /** File name, or "Untitled". */
  name: string
  /** The folder it lives in, or null before the first save. */
  folder: string | null
  branch: string | null
  /** A passing message (QStatusBar.showMessage): it stands in for the name. */
  message: string | null
  editorZoom: number
  showEditorZoom: boolean
  onEditorZoom: (pct: number, step?: boolean) => void
  pdfZoom: number
  showPdfZoom: boolean
  onPdfZoom: (pct: number, step?: boolean) => void
  fit: boolean
  onFit: () => void
  compiler: string
  compilerOk: boolean | null
  compiling: boolean
  /** Opening / saving / importing: shown with an indeterminate bar. */
  busy: string | null
}) {
  return (
    <div className="ktx-sb">
      <span className="ktx-sb-path" title={folder ? `${folder}/${name}` : undefined}>
        {message ?? (
          <>
            <b>{name}</b>
            {branch && <span className="ktx-sb-branch">{branch}</span>}
            {'  —  '}
            <span className="ktx-sb-dim">{folder ?? 'not saved yet'}</span>
          </>
        )}
      </span>
      {showEditorZoom && (
        <Zoom
          value={editorZoom}
          min={25}
          max={300}
          onChange={(v) => onEditorZoom(v)}
          onStep={(d) => onEditorZoom(editorZoom + d, true)}
          outTip="Zoom out"
          inTip="Zoom in"
        />
      )}
      {showPdfZoom && (
        <>
          <span className="ktx-sb-sep"> | PDF:</span>
          <Zoom
            value={pdfZoom}
            min={25}
            max={400}
            onChange={(v) => onPdfZoom(v)}
            onStep={(d) => onPdfZoom(pdfZoom + d, true)}
            outTip="PDF zoom out"
            inTip="PDF zoom in"
          />
          <button className={`ktx-sb-btn${fit ? ' on' : ''}`} title="Fit page width (Ctrl+0)" aria-pressed={fit} onClick={onFit}>
            <TexIcon name="fit-width" />
          </button>
        </>
      )}
      <span className={`ktx-sb-compiler${compilerOk === false ? ' bad' : ''}`}>{compiler}</span>
      {busy && (
        <>
          <span className="ktx-sb-io">{busy}</span>
          <span className="ktx-progress" />
        </>
      )}
      {compiling && (
        <>
          <span className="ktx-sb-io">Compiling…</span>
          <span className="ktx-progress" />
        </>
      )}
    </div>
  )
}
