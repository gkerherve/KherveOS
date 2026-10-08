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
