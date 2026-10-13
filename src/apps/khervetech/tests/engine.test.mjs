// The technique engine in the real Pyodide (the version KherveOS loads), the
// page's way: the files of public/apps/khervetech/py/files.json installed with
// engine.core.ts, then the requests the page and the AI tools send. Runs the
// desktop's own TGA_Analysis / BET_Analysis windows headless and presses their
// buttons.
//
//   KHERVEOS_PYODIDE=/path/to/node_modules/pyodide/pyodide.mjs node --test src/apps/khervetech/tests/*.test.mjs
//
// Without Pyodide 314.0.7 installed (npm i pyodide@314.0.7 somewhere, then
// KHERVEOS_PYODIDE pointing at its pyodide.mjs, or resolvable as 'pyodide'),
// the tests are skipped.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byLabel, engine, nodes, skip } from './harness.mjs'

test('KherveTGA: import a NETZSCH STA run, generate the mass sheet, measure it, undo, save', { skip, timeout: 600_000 }, async () => {
  const { call, copyExamples, py } = await engine('TGA')
  const dir = '/home/user/Documents/KherveTGA Examples'
  copyExamples('khervetga', dir)
  let a = await call('init', { tech: 'TGA' })
  assert.equal(a.info.key, 'TGA')
  assert.deepEqual(a.info.sections.map((s) => s.short), ['Rng', 'Mass', 'DTG', 'DSC', 'Flow', 'Evt', 'Chem', 'Cyc', 'Iso', 'Cmp'])
  assert.equal(a.info.icon, 'Tech-TGA-3.png')
  assert.ok(a.info.imports.some((i) => i.id === 'libraries.FileMenu.TGA_Import:import_tga_file'))

  // File > Import > TGA > File(s): the desktop's own function asks for the file (wx.FileDialog), then imports it
  a = await call('menu', { id: 'libraries.FileMenu.TGA_Import:import_tga_file' })
  assert.equal(a.modal.kind, 'file')
  assert.ok(a.modal.multiple)
  a = await call('menu', { id: 'libraries.FileMenu.TGA_Import:import_tga_file', answers: [{ id: 5100, paths: [`${dir}/CaC2O4_H2O_STA_10Kmin.csv`] }] })
  assert.deepEqual(a.state.sheets, ['TGA'])
  assert.equal(a.state.file, `${dir}/CaC2O4_H2O_STA_10Kmin.kfit`)
  assert.ok(py.FS.analyzePath(a.state.file).exists, 'the .kfit project is written next to the file')
  // the time view: temperature on the main axes, mass and DSC on two right-hand axes (TGA_Plot)
  const axes = a.state.main.axes
  assert.equal(axes.length, 3)
  assert.equal(axes[0].xlabel, 'Time (min)')
  assert.deepEqual(axes.slice(1).map((x) => x.ylabel), ['Mass (%)', 'DSC (µV/mg)'])
  assert.equal(axes[2].spines.right.outward, 52)
  assert.equal(a.state.technique.key, 'TGA')
  // the right frame is the TGA overview (TechniqueOverview), no grids
  assert.deepEqual(a.state.right.pages.map((p) => p.title), ['TGA', 'Sample Manager'])

  // the technique button opens the full TGA / DSC Analysis window; the red lines show
  a = await call('tool', {})
  let frame = a.state.frames.find((f) => f.title === 'TGA / DSC Analysis')
  assert.ok(frame)
  assert.ok(a.state.rangeActive)
  assert.deepEqual(Object.keys(a.state.vlines), ['1', '2'])
  const tabs = nodes(frame).find(({ n }) => n.t === 'Notebook').n
  assert.equal(tabs.pages.length, 10)

  // drag a red line (On_Mouse_Defs): the Range tab's boxes follow
  a = await call('vline', { which: 1, x: 0.5, final: false })
  a = await call('vline', { which: 2, x: 97, final: true })
  frame = a.state.frames.find((f) => f.title === 'TGA / DSC Analysis') ?? frame
  const tbox = nodes(frame).filter(({ n, pages }) => n.t === 'TextCtrl' && pages.includes('Range')).map(({ n }) => n.value)
  assert.deepEqual(tbox.slice(0, 2), ['0.5', '97.0'])

  // Generate mass vs temperature
  const gen = byLabel(frame, 'Button', 'Generate mass vs temperature (+ DSC) sheet', 'Range')
  a = await call('event', { msg: { id: gen.id, type: 'button' } })
  assert.deepEqual(a.state.sheets, ['TGA', 'TGA~Mass'])
  assert.equal(a.state.sheet, 'TGA~Mass')
  assert.equal(a.state.main.axes[0].xlabel, 'Temperature (°C)')

  // AI driver: the same handlers, by the window's attribute names
  a = await call('drive', { range: [120, 240], set: { region_name_ctrl: 'water' }, call: 'on_mass_step', read: ['mass_grid'] })
  const row = a.read.mass_grid[0]
  assert.equal(row.Name, 'water')
  assert.ok(Math.abs(Number(row['Δm (%)']) + 12.3) < 0.6, `water step ${row['Δm (%)']}`)
  a = await call('drive', { call: 'on_detect_dtg_peaks', read: ['dtg_grid'] })
  const peaks = a.read.dtg_grid.map((r) => Number(r['Peak T']))
  for (const want of [175, 485, 745]) assert.ok(peaks.some((p) => Math.abs(p - want) < 6), `DTG peak near ${want}: ${peaks}`)
  a = await call('drive', { range: [440, 540], call: 'on_dsc_area', read: ['dsc_results'] })
  assert.match(a.read.dsc_results, /Exothermic peak/)
  a = await call('results', {})
  assert.equal(a.results.TGA_Steps.length, 1)
  assert.equal(a.results.TGA_DSC_Peaks.length, 1)
  // the step is a Label Manager 'step' label: two dashed guides + a double arrow + its text
  const kinds = a.state.main?.axes[0].artists.map((x) => x.k) ?? []
  if (kinds.length) assert.ok(kinds.includes('patch') && kinds.includes('annotation'))

  // undo / redo (Save.save_state, 50 steps)
  a = await call('undo')
  assert.equal(a.state.canRedo, true)
  a = await call('results', {})
  assert.equal(a.results.TGA_DSC_Peaks, undefined)
  a = await call('redo')
  a = await call('results', {})
  assert.equal(a.results.TGA_DSC_Peaks.length, 1)

  // save and open again (KFitting_IO, lossless TGA_ arrays)
  a = await call('save', {})
  a = await call('open', { path: `${dir}/CaC2O4_H2O_STA_10Kmin.kfit` })
  assert.deepEqual(a.state.sheets, ['TGA', 'TGA~Mass'])
  a = await call('results', { sheet: 'TGA~Mass' })
  assert.equal(a.results.TGA_Steps[0].name, 'water')

  // the cycles of the redox example, from the time-view run
  a = await call('open', { path: `${dir}/BSCF_redox_cycles_air.csv` })
  a = await call('drive', { sheet: 'TGA', set: { cycle_tol_ctrl: 5 }, call: 'on_cycle_analysis', read: ['cycles_grid', 'cycles_summary'] })
  assert.ok(a.read.cycles_grid.length >= 2, `cycles: ${JSON.stringify(a.read.cycles_grid)}`)
  assert.match(a.read.cycles_summary, /cycles, mass in/)

  // a bare temperature / mass CSV goes straight to the temperature view
  a = await call('open', { path: `${dir}/PMMA_decomposition_bare.csv` })
  assert.equal(a.state.main.axes.length, 1)
  assert.equal(a.state.main.axes[0].xlabel, 'Temperature (°C)')

  // Edit > Sheet: copy, rename, delete
  a = await call('sheet', { action: 'copy' })
  assert.equal(a.state.sheets.length, 2)
  a = await call('sheet', { action: 'rename', sheet: a.state.sheets[1], name: 'TGA9' })
  assert.ok(a.state.sheets.includes('TGA9'))
  a = await call('sheet', { action: 'delete', sheet: 'TGA9' })
  assert.deepEqual(a.state.sheets, ['TGA'])
  a = await call('table', {})
  assert.equal(a.table.columns[0], 'Temperature (°C)')
})

test('KherveBET: import isotherms, fit BET / t-plot / BJH, derived sheets, the overview', { skip, timeout: 600_000 }, async () => {
  const { call, copyExamples } = await engine('BET')
  const dir = '/home/user/Documents/KherveBET Examples'
  copyExamples('khervebet', dir)
  let a = await call('init', { tech: 'BET' })
  assert.deepEqual(a.info.sections.map((s) => s.key), ['bet', 'tplot', 'bjh', 'report'])
  a = await call('open', { path: `${dir}/SBA15_silica_N2_77K.txt` })
  assert.deepEqual(a.state.sheets, ['BET'])
  const main = a.state.main.axes[0]
  assert.equal(main.xlabel, 'Relative pressure (P/P$_0$)')
  assert.equal(main.artists.find((x) => x.label === 'Raw Data').k, 'line', 'an isotherm is drawn as a line (optical sheets)')

  a = await call('tool', { section: 'bet' })
  const sec = a.state.frames.find((f) => f.title === 'BET BET Surface Area')
  assert.ok(sec, a.state.frames.map((f) => f.title).join(', '))
  const fit = byLabel(sec, 'Button', 'Fit BET')
  a = await call('event', { msg: { id: fit.id, type: 'button' } })
  const res = nodes(a.state.frames.find((f) => f.title === 'BET BET Surface Area')).find(({ n }) => n.t === 'Text' && /S\(BET\)/.test(n.label ?? '')).n.label
  const sbet = Number(/S\(BET\) = ([\d.]+)/.exec(res)[1])
  assert.ok(sbet > 600 && sbet < 760, `S(BET) ${sbet}`)

  a = await call('drive', { set: { t_lo_ctrl: 3.5, t_hi_ctrl: 5.0 }, call: 'on_fit_tplot', read: ['tplot_result'] })
  assert.match(a.read.tplot_result, /External area/)
  a = await call('drive', { set: { branch_choice: 0 }, call: 'on_run_bjh', read: ['bjh_grid'] })
  assert.ok(a.read.bjh_grid.length > 5)
  a = await call('drive', { call: '_update_report', read: ['report_ctrl'] })
  assert.match(a.read.report_ctrl, /Physisorption report: BET/)
  assert.match(a.read.report_ctrl, /BJH \(desorption branch\)/)
  a = await call('drive', { call: 'on_bet_plot_sheet', read: [] })
  assert.deepEqual(a.state.sheets, ['BET', 'BET~Plot'])
  assert.equal(a.state.sheet, 'BET~Plot')
  // the overview's companion is the other BET sheet, with its info lines
  const right = a.state.right
  assert.equal(right.pages[0].title, 'BET')
  const canvas = nodes(right).find(({ n }) => n.t === 'Canvas').n
  assert.ok(canvas.fig.axes.length >= 1)

  // a type I isotherm (CSV) and absolute pressures with a P0 header
  a = await call('open', { path: `${dir}/Activated_carbon_typeI.csv` })
  assert.deepEqual(a.state.sheets, ['BET'])
  a = await call('open', { path: `${dir}/Alumina_nonporous_kPa.dat` })
  a = await call('drive', { set: { relp_lo_ctrl: 0.05, relp_hi_ctrl: 0.3 }, call: 'on_fit_bet', read: ['bet_result'] })
  const s2 = Number(/S\(BET\) = ([\d.]+)/.exec(a.read.bet_result)[1])
  assert.ok(Math.abs(s2 - 10.0) < 1.0, `alumina S(BET) ${s2}`)
})

test('KherveDilatometer: import runs, split the segments, CTE and α(T), sintering, labels, save', { skip, timeout: 600_000 }, async () => {
  const { call, copyExamples } = await engine('DIL')
  const dir = '/home/user/Documents/kDilatometer Examples'
  copyExamples('khervedilatometer', dir)
  let a = await call('init', { tech: 'DIL' })
  assert.equal(a.info.key, 'DIL')
  assert.deepEqual(a.info.sections.map((s) => s.key), ['data', 'cte', 'sinter'])
  assert.ok(a.info.imports.some((i) => i.id === 'libraries.FileMenu.DIL_Import:import_dil_file'))

  // a NETZSCH DIL 402 export (#KEY: metadata, dL/Lo, Segment): a heat / dwell / cool run, the loop of dL/L0 against T
  a = await call('open', { path: `${dir}/Alumina_bar_DIL402_5Kmin.csv` })
  assert.deepEqual(a.state.sheets, ['DIL'])
  const main = a.state.main.axes[0]
  assert.equal(main.xlabel, 'Temperature (°C)')
  assert.equal(main.ylabel, 'dL/L$_0$')

  // the Data tab, pressed as a user does: the window of the technique button
  a = await call('tool', {})
  const win = a.state.frames.find((f) => f.title === 'Dilatometry Analysis')
  assert.ok(win, a.state.frames.map((f) => f.title).join(', '))
  a = await call('drive', { read: ['info_text', 'seg_grid'] })
  assert.match(a.read.info_text, /627 points, 25–1000 °C/)
  assert.match(a.read.info_text, /L0 = 25 mm/)
  assert.deepEqual(a.read.seg_grid.map((r) => r.Kind), ['heating', 'isothermal', 'cooling'])

  // "Sheet from selected segment": the heating ramp becomes DIL~Heat and is shown
  a = await call('drive', { set: { seg_grid: 0 }, call: 'on_segment_sheet', read: ['seg_grid'] })
  assert.deepEqual(a.state.sheets, ['DIL', 'DIL~Heat'])
  assert.equal(a.state.sheet, 'DIL~Heat')
  assert.equal(a.read.seg_grid.length, 1)

  // the mean CTE between 100 and 900 °C (6.5e-6 T + 1.5e-9 T² for this bar: 7.93e-6 /K)
  a = await call('drive', { set: { t1_ctrl: 100, t2_ctrl: 900 }, call: 'on_mean_cte', read: ['cte_result'] })
  assert.match(a.read.cte_result, /α = 7\.9\d\d ×10⁻⁶ K⁻¹/)
  a = await call('results', { sheet: 'DIL~Heat' })
  assert.ok(Math.abs(a.results.DIL_Results.cte.alpha_per_K - 7.93e-6) < 0.1e-6, JSON.stringify(a.results.DIL_Results))
  assert.equal(a.results.DIL_Temperature, undefined, 'per-point copies are not results')

  // α(T) as its own sheet: it rises from 6.5 to 9.5e-6 /K along the ramp
  a = await call('drive', { set: { alpha_window_ctrl: 51 }, call: 'on_alpha_sheet', read: ['cte_result'] })
  assert.deepEqual(a.state.sheets, ['DIL', 'DIL~Heat', 'DIL~Alpha'])
  assert.equal(a.state.main.axes[0].ylabel, 'α (10$^{-6}$ K$^{-1}$)')
  a = await call('table', { sheet: 'DIL~Alpha' })
  const alpha = a.table.data[1]
  assert.ok(alpha[5] > 6.4 && alpha[5] < 7.0 && alpha[alpha.length - 6] > 9.0 && alpha[alpha.length - 6] < 10.0, `α(T) ${alpha[5]} … ${alpha[alpha.length - 6]}`)

  // a CTE window outside the data is refused with a message, not a crash
  a = await call('drive', { sheet: 'DIL~Heat', set: { t1_ctrl: 2000, t2_ctrl: 2200 }, call: 'on_mean_cte', read: [] })
  assert.ok(a.messages.some((m) => /inside the sheet/.test(m)), a.messages.join(' | '))

  // sintering: the zirconia compact shrinks above ~950 °C, fastest at ~1255 °C, by ~19 % in all
  a = await call('open', { path: `${dir}/Zirconia_compact_sintering_1450C.csv` })
  a = await call('drive', { set: { seg_grid: 0 }, call: 'on_segment_sheet', read: [] })
  assert.equal(a.state.sheet, 'DIL~Heat')
  a = await call('drive', { set: { onset_ctrl: 0.1, alpha_window_ctrl: 51 }, call: 'on_sinter', read: ['sinter_report'] })
  assert.match(a.read.sinter_report, /Shrinkage onset \(0\.10% below maximum\): \d+\.\d °C/)
  a = await call('results', { sheet: 'DIL~Heat' })
  const sint = a.results.DIL_Results.sinter
  assert.ok(sint.t_max_expansion > 800 && sint.t_max_expansion < 950, `max expansion at ${sint.t_max_expansion}`)
  assert.ok(sint.t_onset > 900 && sint.t_onset < 1100, `onset ${sint.t_onset}`)
  assert.ok(Math.abs(sint.t_max_rate - 1255) < 40, `max rate at ${sint.t_max_rate}`)
  assert.ok(sint.total_shrinkage < -0.17 && sint.total_shrinkage > -0.21, `shrinkage ${sint.total_shrinkage}`)
  // Label plot puts max / onset / max rate on the plot, Clear labels takes them off
  const drawn = async () => (await call('state', { full: true })).state.main.axes[0].artists.length
  a = await call('drive', { call: 'on_clear_labels', read: [] })
  const bare = await drawn()
  a = await call('drive', { call: 'on_label_plot', read: [] })
  assert.ok((await drawn()) >= bare + 3, `labels drawn on a bare plot of ${bare} artists`)
  a = await call('drive', { call: 'on_clear_labels', read: [] })
  assert.equal(await drawn(), bare)

  // dL in micrometres + the sample length in the header: the importer forms dL/L0 (and finds heat + cool)
  a = await call('open', { path: `${dir}/Steel_phase_transformation_dL_um.txt` })
  assert.equal(a.state.main.axes[0].ylabel, 'dL/L$_0$')
  a = await call('drive', { read: ['seg_grid'] })
  assert.deepEqual(a.read.seg_grid.map((r) => r.Kind), ['heating', 'cooling'])
  // the austenite contraction near 740 °C shows as a dip in α(T) on the heating ramp
  a = await call('drive', { set: { seg_grid: 0 }, call: 'on_segment_sheet', read: [] })
  a = await call('drive', { set: { alpha_window_ctrl: 21 }, call: 'on_alpha_sheet', read: [] })
  a = await call('table', { sheet: 'DIL~Alpha' })
  const [temps, alphas] = a.table.data
  const dip = temps[alphas.indexOf(Math.min(...alphas))]
  assert.ok(dip > 700 && dip < 780, `contraction at ${dip} °C`)

  // a bare temperature / dL/L0 CSV (glass): the CTE below the glass transition
  a = await call('open', { path: `${dir}/Glass_Tg_bare_CSV.csv` })
  assert.deepEqual(a.state.sheets, ['DIL'])
  a = await call('drive', { set: { t1_ctrl: 100, t2_ctrl: 400 }, call: 'on_mean_cte', read: ['cte_result'] })
  assert.match(a.read.cte_result, /α = 8\.[78]\d\d ×10⁻⁶ K⁻¹/)

  // save and open again (KFitting_IO: DIL_ arrays are lossless, dL/L0 is of order 1e-5)
  a = await call('save', {})
  a = await call('open', { path: `${dir}/Glass_Tg_bare_CSV.kfit` })
  assert.deepEqual(a.state.sheets, ['DIL'])
  a = await call('results', { sheet: 'DIL' })
  assert.ok(Math.abs(a.results.DIL_Results?.cte?.alpha_per_K - 8.8e-6) < 0.1e-6, JSON.stringify(a.results))
})

test('KherveFTIR: import a JCAMP-DX spectrum straight to .kfit, sheet notes, auto clean, bands, labels, reference', { skip, timeout: 600_000 }, async () => {
  const { call, copyExamples, py } = await engine('FTIR')
  const dir = '/home/user/Documents/kFTIR Examples'
  copyExamples('kherveftir', dir)
  let a = await call('init', { tech: 'FTIR' })
  assert.equal(a.info.key, 'FTIR')
  assert.deepEqual(a.info.sections.map((s) => s.key), ['data', 'processing', 'bands', 'library', 'reference'])

  // a JCAMP-DX file: the desktop's importer writes a workbook, but the web edition stores the project as .kfit
  // without asking the "Choose Project Format" question (techniques.py: 'project_format')
  a = await call('open', { path: `${dir}/Polystyrene_synthetic.jdx` })
  assert.equal(a.modal, undefined, 'no question about how to store the project')
  assert.deepEqual(a.state.sheets, ['FTIR'])
  assert.ok(a.state.file.endsWith('.kfit'), a.state.file)
  assert.ok(py.FS.analyzePath(a.state.file).exists)
  assert.equal(a.state.main.axes[0].xlabel, 'Wavenumber (cm$^{-1}$)')
  // what the sheet is, for the sidebar
  assert.match(a.state.notes.FTIR, /^Measured, Transmittance/)

  // the technique button opens the FTIR Analysis window, every tab built
  a = await call('tool', {})
  const win = a.state.frames.find((f) => f.title === 'FTIR Analysis')
  assert.ok(win, a.state.frames.map((f) => f.title).join(', '))
  assert.equal(nodes(win).find(({ n }) => n.t === 'Notebook').n.pages.length, 5)

  // Standard auto clean: the history lists the steps
  a = await call('drive', { call: 'on_auto_clean', args: ['Standard'], read: ['history_text'] })
  assert.match(a.read.history_text, /Baseline/)

  // bands: ranked assignments in the grid; polystyrene has its aromatic C-H and C=C stretches
  a = await call('drive', { call: 'on_find_peaks', read: ['peaks_grid'] })
  const bands = a.read.peaks_grid
  assert.ok(bands.length >= 8, `${bands.length} bands`)
  assert.ok(bands.some((r) => Math.abs(Number(r['Peak (cm-1)']) - 1602) < 6), JSON.stringify(bands.map((r) => r['Peak (cm-1)'])))
  const drawn = async () => (await call('state', { full: true })).state.main.axes[0].artists.length
  const bare = await drawn()
  a = await call('drive', { call: 'on_label_peaks', read: [] })
  assert.ok((await drawn()) > bare, 'band labels are drawn on the plot')
  a = await call('drive', { call: 'on_clear_labels', read: [] })

  // a reference spectrum is a new sheet of the project, noted as one
  a = await call('drive', { call: 'on_load_reference', args: [], set: { ref_listbox: 'PMMA_synthetic.jdx' }, read: [] })
  assert.deepEqual(a.state.sheets, ['FTIR', 'FTIR1'])
  assert.match(a.state.notes.FTIR1, /^Reference: PMMA/)
})

test('KherveRaman: import a spectrum straight to .kfit, drawn as a line, peaks with assignments, labels', { skip, timeout: 600_000 }, async () => {
  const { call, copyExamples, py } = await engine('RAMAN')
  const dir = '/home/user/Documents/kRaman Examples'
  copyExamples('kherveraman', dir)
  let a = await call('init', { tech: 'RAMAN' })
  assert.deepEqual(a.info.sections.map((s) => s.key), ['peaks', 'library'])

  // the desktop's importer writes a workbook; the web edition stores the project as .kfit without the format question
  a = await call('open', { path: `${dir}/TiO2_anatase_synthetic.txt` })
  assert.equal(a.modal, undefined, 'no question about how to store the project')
  assert.deepEqual(a.state.sheets, ['Raman_TiO2_anatase_synthetic'])
  assert.ok(a.state.file.endsWith('.kfit'), a.state.file)
  assert.ok(py.FS.analyzePath(a.state.file).exists)
  const main = a.state.main.axes[0]
  assert.equal(main.xlabel, 'Wavenumber (cm$^{-1}$)')
  assert.equal(main.artists.find((x) => x.label === 'Raw Data').k, 'line', 'a Raman spectrum is drawn as a line')

  a = await call('tool', {})
  assert.ok(a.state.frames.some((f) => f.title === 'Raman Analysis'), a.state.frames.map((f) => f.title).join(', '))

  // anatase: the strong Eg mode at 144 cm-1 is found and assigned
  a = await call('drive', { call: 'on_find_peaks', read: ['peaks_grid'] })
  const peaks = a.read.peaks_grid
  assert.ok(peaks.length >= 4, `${peaks.length} peaks`)
  assert.ok(peaks.some((r) => Math.abs(Number(r['Shift (cm⁻¹)'] ?? Object.values(r)[0]) - 144) < 3), JSON.stringify(peaks[0]))
  const drawn = async () => (await call('state', { full: true })).state.main.axes[0].artists.length
  const bare = await drawn()
  a = await call('drive', { call: 'on_label_peaks', read: [] })
  assert.ok((await drawn()) > bare, 'peak labels are drawn on the plot')
  a = await call('drive', { call: 'on_clear_labels', read: [] })
  assert.equal(await drawn(), bare)
})

test('KherveUVVis: import straight to .kfit, Tauc sheet, band gap, inset, band maxima', { skip, timeout: 600_000 }, async () => {
  const { call, copyExamples, py } = await engine('UVVIS')
  const dir = '/home/user/Documents/kUVVis Examples'
  copyExamples('kherveuvvis', dir)
  let a = await call('init', { tech: 'UVVIS' })
  assert.deepEqual(a.info.sections.map((s) => s.key), ['data', 'tauc', 'peaks'])

  a = await call('open', { path: `${dir}/TiO2_anatase_absorbance.csv` })
  assert.equal(a.modal, undefined, 'no question about how to store the project')
  assert.deepEqual(a.state.sheets, ['UVvis'])
  assert.ok(a.state.file.endsWith('.kfit'), a.state.file)
  assert.ok(py.FS.analyzePath(a.state.file).exists)
  assert.equal(a.state.main.axes[0].xlabel, 'Wavelength (nm)')

  // the Tauc plot of anatase TiO2 (direct allowed): Eg ≈ 3.2 eV
  a = await call('tool', {})
  assert.ok(a.state.frames.some((f) => f.title === 'UV-Vis Analysis'), a.state.frames.map((f) => f.title).join(', '))
  a = await call('drive', { call: 'on_make_tauc', read: [] })
  assert.deepEqual(a.state.sheets, ['UVvis', 'UVvis~Tauc'])
  a = await call('drive', { call: 'on_suggest_window', read: ['e_lo_ctrl', 'e_hi_ctrl'] })
  a = await call('drive', { call: 'on_fit_tauc', read: ['tauc_result'] })
  const eg = Number(/Eg = ([\d.]+) eV/.exec(a.read.tauc_result)?.[1])
  assert.ok(eg > 3.0 && eg < 3.4, `Eg ${eg}: ${a.read.tauc_result}`)

  // the fitted Tauc plot as an inset on the measured spectrum, and off again
  a = await call('select', { sheet: 'UVvis' })
  const insets = async () => (await call('state', { full: true })).state.main.axes[0].children?.length ?? 0
  assert.equal(await insets(), 0)
  a = await call('drive', { call: 'on_insert_inset', read: [] })
  assert.equal(await insets(), 1, 'the inset is drawn')
  a = await call('drive', { call: 'on_remove_inset', read: [] })
  assert.equal(await insets(), 0)

  // band maxima: the list answers (the example is a steep edge, so it may be short)
  a = await call('drive', { call: 'on_find_peaks', read: ['peaks_list'] })
  assert.ok('peaks_list' in a.read)
})

test('KherveAFM: import a scan, the map with its scale bar and colour key, level, roughness, profile step, grains', { skip, timeout: 600_000 }, async () => {
  const { call, copyExamples, py } = await engine('AFM')
  const dir = '/home/user/Documents/kAFM Examples'
  copyExamples('kherveafm', dir)
  let a = await call('init', { tech: 'AFM' })
  assert.equal(a.info.key, 'AFM')
  assert.deepEqual(a.info.sections.map((s) => s.key), ['channels', 'level', 'regions', 'roughness', 'particles', 'profile', 'force', 'view3d'])

  // a Gwyddion .gsf height map: sheets AFM and AFM~3D, a .kfit next to the file (no question about the format)
  a = await call('open', { path: `${dir}/Gold_terraces_5um.gsf` })
  assert.equal(a.modal, undefined)
  assert.deepEqual(a.state.sheets, ['AFM', 'AFM~3D'])
  assert.ok(a.state.file.endsWith('.kfit') && py.FS.analyzePath(a.state.file).exists, a.state.file)
  const ax = a.state.main.axes[0]
  const image = ax.artists.find((x) => x.k === 'image')
  assert.ok(image && image.src.startsWith('data:image/png;base64,'), 'the scan is an image')
  assert.deepEqual(image.shape, [256, 256])
  assert.equal(ax.aspect, 'equal')
  assert.deepEqual(ax.xlim, [0, 5], 'a 5 um scan is in um')
  assert.ok(ax.artists.some((x) => x.k === 'text' && /µm|nm/.test(x.text)), 'the scale bar is labelled')
  assert.equal(ax.children.length, 1, 'the colour key')
  assert.ok(ax.children[0].artists.some((x) => x.k === 'image'), 'drawn as a gradient')

  // the window, with all its tabs
  a = await call('tool', {})
  assert.ok(a.state.frames.some((f) => f.title === 'AFM Analysis — AFM'), a.state.frames.map((f) => f.title).join(', '))

  // level: a plane removes the mean slope of the staircase, what is left is a sawtooth of 2.4 nm steps: Sq = step / sqrt(12) = 0.69 nm
  a = await call('drive', { set: { plane_choice: 'Plane (1st order)', lines_choice: 'Median of differences', zero_choice: 'Minimum to zero' }, call: 'on_level_changed', args: [null], read: ['level_status'] })
  assert.match(a.read.level_status, /Leveling applied/)
  a = await call('drive', { call: 'on_compute_roughness', args: [null], read: ['roughness_text'] })
  const sq = Number(/RMS roughness \(Sq\)\s+([\d.]+) nm/.exec(a.read.roughness_text)?.[1])
  assert.ok(sq > 0.5 && sq < 0.9, `Sq ${sq}: ${a.read.roughness_text.slice(0, 200)}`)

  // a profile line across the steps (image pixels), on the raw data: the half-vs-half step is the staircase's rise
  a = await call('drive', { call: 'on_level_reset', read: ['level_status'] })
  a = await call('drive', { attrs: { _line: [[20, 128], [236, 128]], _new_line: true, line_width_px: 5 }, call: '_apply_line_change', args: [], read: ['profile_hint', 'profile_stats'] })
  assert.match(a.read.profile_hint, /4\.2\d+ µm long/)
  const step = Number(/Step height \(half vs half\): ([\d.]+) nm/.exec(a.read.profile_stats)?.[1])
  assert.ok(step > 2 && step < 5, `step ${step}`)
  a = await call('drive', { call: 'on_export_profile', read: [] })
  assert.ok(a.state.sheets.includes('AFM~Profile'))

  // grains on the nanoparticle scan (needs scikit-image for the watershed)
  a = await call('open', { path: `${dir}/Nanoparticles_on_silicon_2um.gsf` })
  a = await call('drive', { before: ['on_auto_watershed'], call: 'on_count_particles', args: [null], read: ['particle_text'] })
  const count = Number(/Count\s+(\d+)/.exec(a.read.particle_text)?.[1])
  assert.ok(count >= 15 && count <= 60, `${count} grains: ${a.read.particle_text}`)
})

test('KherveTEM: import an image, calibrate, particles, fringe spacing, FFT d-spacings', { skip, timeout: 600_000 }, async () => {
  const { call, copyExamples, py } = await engine('TEM')
  const dir = '/home/user/Documents/kTEM Examples'
  copyExamples('khervetem', dir)
  let a = await call('init', { tech: 'TEM' })
  assert.deepEqual(a.info.sections.map((s) => s.key), ['calibrate', 'particles', 'profile', 'fft', 'filter', 'measure', 'advanced', 'denoise'])

  // a PNG has no pixel size: the sheet says so and the scale bar is in pixels
  a = await call('open', { path: `${dir}/Gold_lattice_fringes_HRTEM.png` })
  assert.deepEqual(a.state.sheets, ['TEM~Map'])
  assert.ok(a.state.file.endsWith('.kfit') && py.FS.analyzePath(a.state.file).exists)
  let ax = a.state.main.axes[0]
  assert.ok(ax.artists.some((x) => x.k === 'image'))
  assert.ok(ax.artists.some((x) => x.k === 'text' && /uncalibrated/.test(x.text)))

  // calibrate (0.0235 nm per pixel), then a fringe profile across ~19 periods of the 0.235 nm family
  a = await call('tool', {})
  assert.ok(a.state.frames.some((f) => f.title === 'TEM Analysis — TEM~Map'), a.state.frames.map((f) => f.title).join(', '))
  a = await call('drive', { set: { nm_ctrl: '0.0235' }, call: 'on_apply_scale', args: [null], read: ['nm_ctrl'] })
  a = await call('drive', { attrs: { _line: [[100, 256], [300, 256]], line_width_px: 9 }, call: '_apply_line_change', args: [], read: [] })
  a = await call('drive', { call: 'on_detect_peaks', args: [null], read: ['spacing_text'] })
  const spacing = Number(/Average spacing: ([\d.]+)/.exec(a.read.spacing_text)?.[1])
  assert.ok(Math.abs(spacing - 0.235) < 0.01, `fringe spacing ${spacing}`)

  // FFT of the middle of the image: the two families sit at d = 0.235 and 0.204 nm
  a = await call('drive', { attrs: { _roi: { region_px: [null, null, null, null, 0] } }, call: 'on_compute_fft', args: [null], read: ['fft_status'] })
  assert.ok(a.state.sheets.includes('TEM~FFT'))
  a = await call('drive', { call: 'on_auto_detect', args: [null], read: ['spot_grid'] })
  const d = a.read.spot_grid.map((r) => Number(r['d (nm)'])).sort()
  assert.ok(d.some((v) => Math.abs(v - 0.2346) < 0.004) && d.some((v) => Math.abs(v - 0.2041) < 0.004), `d-spacings ${d}`)

  // nanoparticles: calibrate at 0.5 nm per pixel, detect the discs (radius 9-26 px, i.e. 9-26 nm across)
  a = await call('open', { path: `${dir}/Gold_nanoparticles_bright_field.png` })
  a = await call('drive', { set: { nm_ctrl: '0.5' }, call: 'on_apply_scale', args: [null], read: [] })
  a = await call('drive', { call: 'on_detect', args: [null], read: ['particle_status', 'results_grid'] })
  assert.match(a.read.particle_status, /\d+ particles/)
  const mean = Number(a.read.results_grid.find((r) => r.Quantity === 'ECD Mean (nm)')?.Value)
  assert.ok(mean > 10 && mean < 25, `mean diameter ${mean}`)
})

test('KherveEDX: import a spectrum image, the labelled sum spectrum, area / point spectra, element maps, quantification', { skip, timeout: 600_000 }, async () => {
  const { call, copyExamples, py } = await engine('EDX')
  const dir = '/home/user/Documents/kEDX Examples'
  copyExamples('kherveedx', dir)
  let a = await call('init', { tech: 'EDX' })
  assert.equal(a.info.key, 'EDX')

  // an HDF5 cube: the sum spectrum is EDX~Plot, the intensity map EDX~Map, a .kfit and a copy of the raw file next to it
  a = await call('open', { path: `${dir}/Steel_Cr_carbides_SEM_EDX.hdf5` })
  assert.deepEqual(a.state.sheets, ['EDX~Plot', 'EDX~Map'])
  assert.ok(a.state.file.endsWith('_EDX.kfit') && py.FS.analyzePath(a.state.file).exists, a.state.file)
  assert.ok(py.FS.analyzePath(`${dir}/Steel_Cr_carbides_SEM_EDX_EDX.hdf5`).exists, 'the raw map is copied beside the project')
  const ax = a.state.main.axes[0]
  assert.equal(ax.xlabel, 'Energy (keV)')
  const labels = ax.artists.filter((x) => x.k === 'text').map((x) => x.text.replace('\n', ' '))
  for (const want of ['Fe Kα', 'Cr Kα', 'Ni Kα']) assert.ok(labels.includes(want), `${want} labelled: ${labels.join(', ')}`)

  // the EDX HeatMap window holds the map (an image with a colour key)
  assert.equal(a.state.frames.length, 1)
  const frame = a.state.frames[0]
  assert.equal(frame.title, 'EDX HeatMap')
  const canvas = nodes(frame).find(({ n }) => n.t === 'Canvas').n
  assert.ok(canvas.fig.axes[0].artists.some((x) => x.k === 'image'), 'the map is an image')

  // an area on a Cr-rich carbide (disc at pixel 14,16): chromium is its strongest line; saved as a sheet
  a = await call('drive', { call: 'ktech.edx_tools:select', args: ['area', 11, 13, 17, 19, 1, 1, true], read: [] })
  assert.ok(a.state.sheets.includes('EDX~Plot1'), a.state.sheets.join(', '))
  assert.ok(a.returned.peaks.some((p) => p.element === 'Cr' && p.line === 'Ka'), JSON.stringify(a.returned.peaks))
  assert.ok(Math.abs(a.returned.energy_of_max_keV - 5.41) < 0.1, `strongest line at ${a.returned.energy_of_max_keV} keV`)

  // quantification of the sum spectrum (the steel matrix: Fe is the main element)
  a = await call('drive', { call: 'ktech.edx_tools:quantify', args: [['Fe', 'Cr', 'Ni', 'Si', 'O']], read: [] })
  const fe = a.returned.find((r) => r.element === 'Fe')
  assert.ok(fe && fe.atomic_percent > 35 && fe.atomic_percent < 65, JSON.stringify(a.returned))
  assert.ok(Math.abs(a.returned.reduce((s, r) => s + r.atomic_percent, 0) - 100) < 1, 'relative atomic % add up to 100')

  // element maps
  a = await call('drive', { call: 'ktech.edx_tools:element_maps', args: [['Fe', 'Cr', 'Si']], read: [] })
  assert.deepEqual(a.returned.elements, ['Fe', 'Cr', 'Si'])
})
