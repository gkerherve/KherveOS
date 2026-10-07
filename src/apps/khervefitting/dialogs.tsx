// Windows of KherveFitting shown with the OS dialogs: the fit report,
// quantification settings, help and "about".

import { useState } from 'react'
import { LIBRARY_TYPES, type Settings } from './model'

export function ReportView({ report, log }: { report: string; log: { i: number; r2: number; redChi2: number; nfev: number }[] }) {
  return (
    <div className="kf-doc kf-report">
      {log.length > 1 && (
        <table className="kf-log">
          <thead>
            <tr>
              <th>Fit</th>
              <th>R²</th>
              <th>Red. χ²</th>
              <th>Evaluations</th>
            </tr>
          </thead>
          <tbody>
            {log.map((l) => (
              <tr key={l.i}>
                <td>{l.i}</td>
                <td>{l.r2.toFixed(6)}</td>
                <td>{l.redChi2.toFixed(3)}</td>
                <td>{l.nfev}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <pre>{report || 'No fit report yet: press Fit first.'}</pre>
    </div>
  )
}

/** Quantification settings (the desktop's Preferences › Instrument / Library). */
export function SettingsView({ settings, onChange }: { settings: Settings; onChange: (patch: Record<string, unknown>) => void }) {
  const [s, setS] = useState(settings)
  const change = (patch: Partial<Settings>) => {
    setS({ ...s, ...patch })
    onChange(patch)
  }
  return (
    <div className="kf-doc kf-settings">
      <label>
        Photon energy (eV)
        <input className="k-input" defaultValue={s.photons} onBlur={(e) => Number(e.target.value) > 0 && change({ photons: Number(e.target.value) })} />
      </label>
      <label>
        Sensitivity factors (instrument)
        <select className="k-input" value={s.instrument} onChange={(e) => change({ instrument: e.target.value })}>
          {!s.instruments.includes(s.instrument) && <option>{s.instrument}</option>}
          {s.instruments.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
      </label>
      <label>
        Energy compensation (ECF)
        <select className="k-input" value={s.libraryType} onChange={(e) => change({ libraryType: e.target.value })}>
          {LIBRARY_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        Work function for VAMAS imports (eV)
        <input className="k-input" defaultValue={s.workfunction} onBlur={(e) => Number.isFinite(Number(e.target.value)) && change({ workfunction: Number(e.target.value) })} />
      </label>
      <p className="kf-note">
        Atomic % = area / (RSF × TXFN × ECF), normalised over the ticked rows of the results table. RSFs come from KherveFitting's library
        (KherveFitting_library.parquet); Export picks them for the instrument above.
      </p>
    </div>
  )
}

const MOD = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+'

export function HelpView() {
  const keys: [string, string][] = [
    ['Double-click on the plot', 'Add a peak there'],
    ['Drag a peak top (+)', 'Move the peak (position and height)'],
    ['Drag a dashed line', 'Move a background limit'],
    ['Drag on empty space', 'Zoom into the box'],
    ['Wheel / Shift+wheel', 'Zoom the energy / intensity axis'],
    ['Home or 0', 'Show the whole spectrum'],
    ['Tab / Q', 'Next / previous peak'],
    ['Delete', 'Remove the selected peak'],
    [`${MOD}[ / ${MOD}]`, 'Previous / next core level'],
    [`${MOD}F`, 'Fit'],
    [`${MOD}Z / ${MOD}Y`, 'Undo / redo'],
    [`${MOD}O / ${MOD}S`, 'Open / save'],
  ]
  return (
    <div className="kf-doc">
      <p>
        KherveFitting fits X-ray photoelectron spectra. Each core level of a workbook has a background (Shirley, Smart, Tougaard…) and peaks
        whose shapes and constraints are fitted with lmfit — the desktop KherveFitting's own code, running in Python in this window, so a fit gives
        the same numbers as on the desktop.
      </p>
      <ol>
        <li>Open a workbook (File › Open, or an example), or import a VAMAS / CSV file.</li>
        <li>Pick a core level, drag the dashed lines around its peaks and press <b>Background</b>.</li>
        <li>Choose a peak model and press <b>Add Peak</b> (or double-click on the plot) for each component.</li>
        <li>Type constraints under the values: <code>Fixed</code>, <code>0.5:2</code>, <code>A+1.2#0.2</code> (A plus 1.2 ± 0.2), <code>A*0.5</code>, <code>C1s_A+0.3</code> (another core level).</li>
        <li>Press <b>Fit</b>, then <b>Export Results</b> to add the peaks to the atomic % table.</li>
        <li>Save: the workbook (.xlsx) and its .json are written side by side, as the desktop does.</li>
      </ol>
      <table className="kf-keys">
        <tbody>
          {keys.map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** What the desktop has that this edition does not (yet). */
export const MISSING = [
  'PCA, Thickogram / thickness, AutoID, survey identification',
  'EELS, EDX/SEM, XAS background tools, Raman Tougaard, valence band (VBM, cut-off, Fermi edge), D-parameter',
  'NPL transmission correction, noise analysis, BE correction / C1s auto-calibration',
  'Peak library (save/load peak sets, SingleEntity envelopes from the library), doublet wizard, propagate fits across samples (batch fit)',
  'Imports other than KherveFitting workbooks, VAMAS, CSV and TXT: Avantage, Kratos, PHI, SPECS, Scienta, VG, MRS, ASC, Igor',
  'CasaXPS peak fits inside VAMAS files, profiles and maps (zzProfile, XPS/EDX/EELS maps)',
  'Plot editor (styles, labels, annotations), exports to PNG/PDF/SVG, Word reports, plot scripts, the plot picture inside the saved workbook',
  'File manager, multiple windows per workbook, auto-backup, mini-games',
]

export function AboutView({ source }: { source: string }) {
  return (
    <div className="kf-doc">
      <p>
        <b>KherveFitting</b> — XPS peak fitting. Web edition for KherveOS of the desktop KherveFitting (LG4X-V3) by Gwilherm Kerherve, Imperial
        College London, built on LG4X by Hideki Nakajima and LG4X-V2 by Julian A. Hochhaus.
      </p>
      <p>
        The fitting core ({source}) is the desktop's own code without wxPython; it runs on NumPy, SciPy and lmfit in Pyodide. Free software, GPL-3.0.
      </p>
      <p>Not in this edition yet:</p>
      <ul>
        {MISSING.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  )
}
