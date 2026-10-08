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
  // Help › List of Shortcuts (HelpMenu/Help.show_shortcuts); Ctrl is ⌘ on a Mac
  const keys: [string, string][] = [
    ['Tab', 'Select next peak'],
    ['Q', 'Select previous peak'],
    [`${MOD}Minus (-)`, 'Zoom out'],
    [`${MOD}Equal (=)`, 'Zoom in'],
    [`${MOD}Left bracket [`, 'Select previous core level'],
    [`${MOD}Right bracket ]`, 'Select next core level'],
    [`${MOD}Up`, 'Increase plot intensity'],
    [`${MOD}Down`, 'Decrease plot intensity'],
    [`${MOD}Left`, 'Move plot to High BE'],
    [`${MOD}Right`, 'Move plot to Low BE'],
    ['SHIFT+Left', 'Decrease High BE'],
    ['SHIFT+Right', 'Increase High BE'],
    [`${MOD}Z`, 'Undo up to 50 events'],
    [`${MOD}Y`, 'Redo'],
    [`${MOD}S`, 'Save. Only works on the grid and not on the figure canvas'],
    [`${MOD}P`, 'Open peak fitting window'],
    [`${MOD}K`, 'Show Keyboard shortcut'],
    ['Alt+Up', 'Increase peak intensity'],
    ['Alt+Down', 'Decrease peak intensity'],
    ['Alt+Left', 'Move peak to High BE'],
    ['Alt+Right', 'Move peak to Low BE'],
    ['Alt+SHIFT+Left', 'Decrease FWHM'],
    ['Alt+SHIFT+Right', 'Increase FWHM'],
    ['SHIFT+Mouse Left button', 'increase/decrease FWHM in Peak Fitting Tab'],
    ['SHIFT+Mouse Left button', 'increase/decrease Offset Low or High in the BKG Tab'],
  ]
  return (
    <div className="kf-doc">
      <p>
        KherveFitting fits X-ray photoelectron spectra with the desktop KherveFitting-AI's own code, running in Python in this window, so a fit gives
        the same numbers as on the desktop. The toolbar buttons are the desktop's: hover one for its help.
      </p>
      <ol>
        <li>Open a workbook (File › Open, or File › Open Examples), or import a VAMAS / CSV file (File › Import › XPS).</li>
        <li>Pick the core level in the sheet selector; open the Peak Fitting window (the C1s button, {MOD}P).</li>
        <li>BKG tab: drag the red lines around the peaks (Ctrl+drag moves both, Shift+click sets the offset), choose the method, press <b>Create Region</b>; dragging a line afterwards redraws the active region.</li>
        <li>Fitting tab: choose the model, <b>Add 1 Peak</b> / <b>Add 2 Peaks Doublet</b>; select a peak (Tab / Q or its row) and drag its ×, scroll to change its width; then <b>Fit Until Stable</b>.</li>
        <li>Type constraints in the green rows: <code>Fixed</code>, <code>0.5:2</code>, <code>A+1.2#0.2</code>, <code>A*0.5</code>, <code>C1s_A+0.3</code>.</li>
        <li>Export the peaks to the Results grid (its first button) to get the atomic %.</li>
        <li>Save: the workbook (.xlsx) and its .json are written side by side, as the desktop does.</li>
      </ol>
      <table className="kf-keys">
        <tbody>
          {keys.map(([k, v], i) => (
            <tr key={`${k}${i}`}>
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
  'Adv. Fitting (continuous fit, auto-tune of the background offsets), Tougaard / Raman / XAS model window, Mini fitting toolbar',
  'Plot Modifications, Thickness analysis, VB / Fermi / Cut-Off, Spectral denoising, PCA (noise), Multiplet envelope fit, Wagner plot, AR-XPS',
  'Profile Creator, Plot Creator (books), Overview, Labels Manager, Preferences other than the instrument / library',
  'kAI chat and MCP inside the app (KherveOS has its own AI tools for KherveFitting), kDB opens as its own app',
  'Imports other than KherveFitting workbooks, VAMAS, CSV and TXT (Avantage, Kratos, PHI, Scienta, VG, MRS, ASC, Igor, other techniques)',
  'The .kfit (HDF5) and .ksheet formats, Word reports, PDF export, Excel plot pictures, auto-backup',
]

export function AboutView({ source }: { source: string }) {
  return (
    <div className="kf-doc">
      <p>
        <b>KherveFitting</b> — XPS peak fitting. Web edition for KherveOS of the desktop KherveFitting-AI v1.93 (LG4X-V3) by Gwilherm Kerherve, Imperial
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
