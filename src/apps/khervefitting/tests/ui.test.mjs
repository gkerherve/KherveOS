// Node tests for KherveFitting's desktop-faithful UI logic (no browser):
// matplotlib's tick locator / formatter, legend and title rules, the
// toolbars and menus of dev-AI, the grids' columns and the panel themes.
// Run: node --test src/apps/khervefitting/tests/ui.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { autoTicks, compactLabel, defaultLimits, formatSheetName, formatTicks, isDoublet, legendPeaks, mathPieces, maxNLocator, minorTicks, peakColours, tickSpace, PLOT_STYLE } from '../mpl.ts'
import { MAIN_TOOLBAR, PLOT_TOOLBAR, RESULTS_TOOLBAR, TOGGLE_TOOLBAR } from '../toolbarSpec.ts'
import { buildMenus } from '../menus.ts'
import { PEAK_COLUMNS, PEAK_EXTRA_COLUMNS, RESULT_COLUMNS, RESULT_ORDER, RESULT_EXTRA_COLUMNS, GRID_MODELS, BACKGROUND_METHODS } from '../model.ts'
import { GREEN_SHADES, FACTORY_GRID_RGB, panelColour, themeVars } from '../theme.ts'

const ICONS = new URL('../../../../public/apps/khervefitting/icons/', import.meta.url)

// [vmin, vmax, nbins, ticks, labels, order] computed with matplotlib 3.9
// (MaxNLocator(steps=[1, 2, 2.5, 5, 10]), ScalarFormatter(useMathText) sci (0, 0)).
const MPL = [[845, 890, 6, [840.0, 850.0, 860.0, 870.0, 880.0, 890.0], ["8.4", "8.5", "8.6", "8.7", "8.8", "8.9"], 2], [35000.0, 165000.0, 5, [0.0, 50000.0, 100000.0, 150000.0, 200000.0], ["0.0", "0.5", "1.0", "1.5", "2.0"], 5], [-5200.0, 5400.0, 3, [-10000.0, -5000.0, 0.0, 5000.0, 10000.0], ["\u221210", "\u22125", "0", "5", "10"], 3], [280.3, 296.7, 7, [280.0, 282.5, 285.0, 287.5, 290.0, 292.5, 295.0, 297.5], ["2.800", "2.825", "2.850", "2.875", "2.900", "2.925", "2.950", "2.975"], 2], [0, 1, 5, [0.0, 0.2, 0.4, 0.6000000000000001, 0.8, 1.0], ["0.0", "0.2", "0.4", "0.6", "0.8", "1.0"], 0], [1200, 1380, 9, [1200.0, 1220.0, 1240.0, 1260.0, 1280.0, 1300.0, 1320.0, 1340.0, 1360.0, 1380.0], ["1.20", "1.22", "1.24", "1.26", "1.28", "1.30", "1.32", "1.34", "1.36", "1.38"], 3], [0.4, 0.43, 4, [0.4, 0.41000000000000003, 0.42000000000000004, 0.43000000000000005], ["4.0", "4.1", "4.2", "4.3"], -1], [-0.012, 0.03, 3, [-0.02, 0.0, 0.02, 0.039999999999999994], ["\u22122", "0", "2", "4"], -2]]

test('ticks and ×10ⁿ labels are matplotlib’s', () => {
  for (const [a, b, n, ticks, labels, order] of MPL) {
    const t = maxNLocator(a, b, n)
    assert.deepEqual(t.map((v) => +v.toPrecision(12)), ticks.map((v) => +v.toPrecision(12)), `ticks ${a}..${b}`)
    const f = formatTicks(t, a, b, true)
    assert.deepEqual(f.labels, labels, `labels ${a}..${b}`)
    assert.equal(f.order, order)
  }
  // binding-energy axis: plain labels
  assert.deepEqual(formatTicks(maxNLocator(845, 890, 6), 845, 890, false).labels, ['840', '850', '860', '870', '880', '890'])
  // tick space: x labels 3 font sizes apart, y 2
  assert.equal(tickSpace(700, 11, 'x'), Math.floor(700 / (100 / 72) / 33))
  assert.ok(autoTicks(280, 296, 700, 11, 'x').length >= 5)
  // AutoMinorLocator(5): 4 minor ticks between majors
  assert.deepEqual(minorTicks([0, 10], 0, 10, 5).map((v) => +v.toFixed(6)), [2, 4, 6, 8])
})

test('title, legend and peak colours follow PlotManager', () => {
  assert.equal(formatSheetName('Ni2p'), 'Ni 2p')
  assert.equal(formatSheetName('C1s2'), 'C 1s')
  assert.equal(formatSheetName('Survey2'), 'Survey')
  assert.equal(compactLabel('C1s C-C', 'C1s'), 'C-C')
  assert.equal(compactLabel('Sr3d$_{5/2}$ SrO', 'Sr3d'), 'SrO')
  const leg = legendPeaks(['Ni2p3/2 Ni(0) peak 1', 'A', 'Ni2p1/2 x'], 'Ni2p')
  assert.deepEqual(leg.map((e) => e.text), ['Ni(0) peak 1', 'x'])
  assert.deepEqual(mathPieces('Sr3d$_{5/2}$ p1'), [{ text: 'Sr3d', sub: false }, { text: '5/2', sub: true }, { text: ' p1', sub: false }])
  assert.ok(isDoublet('Ti2p3/2 p1', 'Ti2p1/2_p2'))
  assert.ok(!isDoublet('C1s C-C', 'C1s C-O'))
  const c = peakColours(['Ti2p3/2 p1', 'Ti2p1/2_p2', 'O1s x'], PLOT_STYLE.peakColors, 0.7)
  assert.equal(c[1].colour, c[0].colour)
  assert.equal(c[2].colour, PLOT_STYLE.peakColors[2])
  const l = defaultLimits([280, 290], [100, 1000])
  assert.deepEqual(l, { xmin: 280, xmax: 290, ymin: 100 - 15, ymax: 1200 })
})

test('toolbars: dev-AI order, every icon shipped', () => {
  const ids = MAIN_TOOLBAR.filter((t) => t.id).map((t) => t.id)
  assert.deepEqual(ids.slice(0, 8), ['open', 'quickSave', 'exportExcel', 'exportAll', 'undo', 'redo', 'sort', 'sampleManager'])
  assert.equal(MAIN_TOOLBAR[8].control, 'sheet')
  assert.ok(MAIN_TOOLBAR.some((t) => t.control === 'be'))
  assert.deepEqual(ids.slice(-5), ['libOpen', 'libSave', 'settings', 'toggleColumns', 'toggleRightPanel'])
  assert.equal(PLOT_TOOLBAR.filter((t) => t.id).length, 17)
  assert.equal(RESULTS_TOOLBAR.filter((t) => t.id).length, 6)
  assert.equal(TOGGLE_TOOLBAR.length, 6)
  for (const t of [...MAIN_TOOLBAR, ...PLOT_TOOLBAR, ...RESULTS_TOOLBAR, ...TOGGLE_TOOLBAR]) {
    if (!t.icon) continue
    assert.ok(existsSync(new URL(t.icon, ICONS)), `icon ${t.icon}`)
    assert.ok(t.help && t.help.length > 10, `help of ${t.id}`)
  }
})

test('menus: File, Edit, View, Tools, AI, Help as on the desktop', () => {
  const m = buildMenus({ open: () => {} }, { mac: false, recent: [], examples: [], sheets: [], theme: 'Simple Darker', layout: 'split', gridColour: 'Green 5', greens: GREEN_SHADES.map((g) => g.label), welcomeLogo: true, kineticEnergy: false, canUndo: false, canRedo: false })
  assert.deepEqual(m.map((x) => x.label), ['File', 'Edit', 'View', 'Tools', 'AI', 'Help'])
  const file = m[0].items.filter((i) => i !== '-').map((i) => i.label)
  assert.deepEqual(file.slice(0, 4), ['New', 'New Instance', 'Open', 'Recent Files'])
  const open = m[0].items.find((i) => i !== '-' && i.label === 'Open')
  assert.equal(open.submenu[1].label, 'Open KFitting file (.xlsx)')
  assert.equal(open.submenu[1].disabled, false)
  assert.equal(open.submenu[0].disabled, true)
  const xps = m[3].items[0]
  assert.equal(xps.label, 'XPS')
  assert.ok(xps.submenu.some((i) => i !== '-' && i.label === 'Create Peak Model'))
  const theme = m[2].items.find((i) => i !== '-' && i.label === 'Theme / Style')
  assert.deepEqual(theme.submenu.map((i) => i.label), ['Panel Theme', 'Grid Layout', 'Grid Colour'])
})

test('grids: the desktop columns, compact view and display order', () => {
  assert.equal(PEAK_COLUMNS.length, 19)
  assert.deepEqual(PEAK_COLUMNS.map((c) => c.width), [20, 90, 80, 60, 60, 50, 70, 45, 45, 50, 40, 40, 40, 130, 130, 80, 80, 100, 100])
  assert.deepEqual(PEAK_EXTRA_COLUMNS, [13, 14, 15, 16, 17, 18])
  assert.equal(RESULT_COLUMNS.length, 38)
  assert.deepEqual(RESULT_ORDER.slice(0, 13), [0, 1, 31, 2, 32, 3, 33, 4, 34, 5, 35, 6, 36])
  assert.equal(RESULT_ORDER[13], 37)
  assert.equal(new Set(RESULT_ORDER).size, 38)
  const visible = RESULT_ORDER.filter((c) => !RESULT_EXTRA_COLUMNS.includes(c)).map((c) => RESULT_COLUMNS[c].label.split('\n')[0])
  assert.deepEqual(visible.slice(0, 10), ['Peak', 'Position', '± Position', 'FWHM', '± FWHM', 'Area', '± Area', 'Atomic', '± Atomic', 'Error'])
  assert.equal(GRID_MODELS.length, 20)
  assert.ok(BACKGROUND_METHODS.includes('Iterated Shirley') && BACKGROUND_METHODS.includes('Active Tougaard'))
})

test('themes: panel colours and the ten greens', () => {
  assert.deepEqual(panelColour('Simple Darker'), [165, 165, 168])
  assert.deepEqual(panelColour('Raised'), [240, 240, 240])
  assert.deepEqual(GREEN_SHADES[0].rgb, [200, 245, 228])
  assert.deepEqual(GREEN_SHADES[9].rgb, [79, 190, 159])
  assert.deepEqual(GREEN_SHADES[4].rgb, FACTORY_GRID_RGB)
  assert.equal(themeVars('Simple Darker', FACTORY_GRID_RGB)['--kf-cons'], 'rgb(146, 221, 197)')
})

test('Open Examples: files by element folder and by category, as the desktop window', async () => {
  const { indexExamples, examplePositions } = await import('../examples.ts')
  const { byElement, byCategory } = indexExamples([
    '2p Al … Zn/28 - Ni - Nickel/Ni(0)-NiO_Kfitting.xlsx',
    '2p Al … Zn/28 - Ni - Nickel/Metal_Ni.xlsx',
    '1s B-C … Mg/06 - C - Carbon/SP2 Carbon.xlsx',
    'zz Metals/Metal Pt/Pt4f.xlsx',
    'zz Other Techniques/Raman/Raman_Data.xlsx',
  ])
  assert.deepEqual(byElement.Ni.map((f) => f.name), ['Metal_Ni', 'Ni(0)-NiO_Kfitting'])
  assert.equal(byElement.C[0].file, '1s B-C … Mg/06 - C - Carbon/SP2 Carbon.xlsx')
  assert.deepEqual(Object.keys(byCategory).sort(), ['Metals', 'Other Techniques'])
  const p = examplePositions()
  assert.deepEqual(p.Ni, [3, 9])
  assert.deepEqual(p.Ce, [8, 3])
})
