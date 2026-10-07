// The desktop's menu bar (dev-AI Widgets_Toolbars.create_menu, paid edition
// "KherveFitting-AI"): File, Edit, View, Tools, AI, Help with the same items,
// headers (▬▬▬ … ▬▬▬, greyed) and order. Items run the handler of the same id
// in `h`; an item without one (a tool not in the web edition yet) is shown
// greyed out, as the desktop shows a feature it cannot run.

import type { MenuBarMenu, MenuItem } from '@/os'

export type Handlers = Partial<Record<string, () => void>>

export interface MenuState {
  mac: boolean
  recent: { label: string; path: string; ok: boolean }[]
  examples: MenuItem[]
  sheets: string[]
  theme: string
  layout: 'split' | 'tabbed'
  gridColour: string
  greens: string[]
  welcomeLogo: boolean
  kineticEnergy: boolean
  canUndo: boolean
  canRedo: boolean
}

const header = (label: string): MenuItem => ({ label, disabled: true })

export function buildMenus(h: Handlers, s: MenuState): MenuBarMenu[] {
  const ctrl = (k: string) => (s.mac ? `⌘${k}` : `Ctrl+${k}`)
  const it = (label: string, id?: string, extra: Partial<Exclude<MenuItem, '-'>> = {}): MenuItem => {
    const fn = id ? h[id] : undefined
    return { label, onClick: fn, disabled: !fn, ...extra }
  }
  const off = (label: string): MenuItem => ({ label, disabled: true })
  const sub = (label: string, items: MenuItem[]): MenuItem => ({ label, submenu: items })

  const recent: MenuItem[] = s.recent.length
    ? [...s.recent.map((r) => ({ label: r.label, disabled: !r.ok, onClick: () => h[`recent:${r.path}`]?.() })), '-', it('Clear Recent Files', 'clearRecent')]
    : [off('(no recent files)')]

  const xpsImport: MenuItem[] = [
    sub('Thermo', [off('Avantage Data file (.xlsx or .xls)'), off('Avantage Multiple xlsx files (folder)'), off('VGD file (.vgd)'), off('VGD Multiple files (folder)'), off('AVG file (.avg)'), off('AVG Multiple files (folder)')]),
    sub('Scienta Omicron', [off('Map file (.txt)'), off('Plot file (.txt)'), off('Scienta HDF5 Map (.h5)')]),
    sub('MRS', [off('Data file (.mrs)'), off('Multiple files (folder)')]),
    sub('VG-Microtech', [off('File (.1)'), off('Multiple files (folder)')]),
    sub('Igor', [off('ITX file (*.itx)'), off('Data file (*.dat)'), off('Multiple files (folder)')]),
    sub('Kratos', [off('Data file (.kal)')]),
    sub('Phi', [off('Data file (.spe)'), off('Depth Profile (.pro)'), off('SXI Image (.sxi)')]),
    sub('Diamond Light Source', [off('NeXus (I09 / B07 / I10) (.nxs)'), off('NeXus - all .nxs in a folder'), off('B07 XPS (.dat) - one or more files'), off('B07 XPS (.dat) - all files in a folder')]),
    header('▬▬▬▬▬▬▬▬ Generic XPS ▬▬▬▬▬▬▬▬▬▬▬▬'),
    it('Vamas file (.vms)', 'importVamas'),
    sub('ASCII (.asc) - Surface Science Spectra', [off('File (.asc)'), off('Multiple files (folder)')]),
    sub('CSV (.csv)', [it('File (.csv)', 'importCsv'), off('Multiple files (folder)')]),
  ]
  const tech = (label: string, items: string[]) => sub(label, items.map(off))
  const importMenu: MenuItem[] = [
    it('Generic Excel (any layout)…', 'importGeneric'),
    sub('XPS', xpsImport),
    '-',
    tech('AFM', ['AFM / SPM file(s) (.ibw/.spm/.ardf/.gwy)']),
    tech('ARPES', ['Scienta SES (.txt/.zip)', 'NeXus / HDF5 / NetCDF (.nxs/.h5/.nc)']),
    tech('BET', ['Isotherm file(s) (.csv/.txt/.dat)', 'Multiple files (folder)']),
    tech('Dilatometry', ['File(s) (.csv/.txt/.dat)', 'Multiple files (folder)']),
    tech('EDX', ['Map (.hdf5/.bcf/.emd)']),
    tech('EELS', ['Map (.dm3/.dm4/.hdf5)']),
    tech('EIS', ['File(s) (.csv/.txt/.dat)', 'Multiple files (folder)']),
    tech('Ellipsometry', ['File(s) (.csv/.txt/.dat)']),
    tech('FTIR', ['File(s) (.txt) - Agilent Cary 630 / generic', 'Multiple files (folder)', 'CSV file(s) (.csv)', 'Multiple CSV files (folder)', 'JCAMP-DX file(s) (.jdx/.dx)', 'Nicolet library']),
    tech('GC', ['Chromatogram file(s) (.csv/.txt)']),
    tech('MS', ['Mass spectrum file(s) (.csv/.txt/.msp)']),
    tech('Photoluminescence', ['File(s) (.csv/.txt)']),
    tech('Raman', ['File (.txt)', 'Multiple files (folder)']),
    tech('SEM', ['Image (.tif/.png/...)']),
    tech('SQUID', ['File(s) (.dat) - Quantum Design MPMS', 'Multiple files (folder)', 'CSV file(s) (.csv/.txt)', 'Multiple CSV files (folder)']),
    tech('TEM', ['Image (.dm3/.dm4/.dm5)']),
    tech('TGA', ['File(s) (.csv/.txt/.dat)', 'Multiple files (folder)', 'TA TRIOS DSC file(s) (.tri)', 'TA TRIOS DSC multiple files (folder)']),
    tech('UV-Vis', ['File(s) (.csv/.txt)']),
    tech('XAS', ['Diamond-B07 file (.txt/.dat)', 'Diamond-B07 multiple files (folder)', 'Diamond I09 / B07 NeXus (.nxs)', 'Diamond NeXus - all .nxs in a folder']),
    tech('XRD', ['File(s) (.xrdml/.raw/.asc/.csv)', 'Multiple files (folder)']),
  ]
  const exportMenu: MenuItem[] = [
    it('Export plot as SVG [Best]', 'exportSvg'),
    it('Export plot as PNG', 'exportPng'),
    it('Export plot as PDF', 'exportPdf'),
    it('Export data as TXT', 'exportTxt'),
    it('Export data as CSV', 'exportCsv'),
    it('Export data as DAT', 'exportDat'),
    it('Python Plot', 'pythonPlot'),
    it('Export as VAMAS (.vms)', 'exportVamas'),
    it('Export as KherveFitting HDF5 (.kfit)', 'exportKfit'),
    it('Export as KherveSheet (.ksheet)', 'exportKsheet'),
    '-',
    it('Create Report (.docx)', 'report'),
  ]

  const file: MenuItem[] = [
    it('New', 'new', { shortcut: ctrl('N') }),
    it('New Instance', 'newInstance'),
    sub('Open', [
      it('Open KherveFitting HDF5 (.kfit)', 'openKfit'),
      it('Open KFitting file (.xlsx)', 'open', { shortcut: ctrl('O') }),
      it('Open Multiple KFitting files (folder)', 'openFolder'),
      it('Open KherveSheet file (.ksheet)', 'openKsheet'),
      '-',
      // KherveOS: the drive is the app's file system; this brings files in from the computer.
      it('Open from This Computer…', 'openComputer'),
    ]),
    sub('Recent Files', recent),
    sub('Save', [
      it('Save Data (.json)', 'quickSave', { shortcut: ctrl('S') }),
      it('Export/Save to KherveFitting HDF5 (.kfit)', 'exportKfit'),
      it('Export this Core Level as KherveSheet (.ksheet)', 'ksheetOne'),
      it('Export all Core Levels as KherveSheet (.ksheet)', 'exportKsheet'),
      it('Export/Save this Core Level to Excel', 'exportExcel'),
      it('Export/Save all Core Levels to Excel', 'exportAll'),
      it('Save Plot Only in Excel', 'plotOnlyExcel'),
    ]),
    it('Save As...', 'saveAs'),
    it('Switch Format (.kfit ↔ .xlsx)', 'switchFormat'),
    it('Create Backup', 'backup'),
    header('▬▬▬▬▬▬▬▬▬▬▬▬▬'),
    it('Open File Location', 'openLocation'),
    it('Open Examples', 'openExamples'),
    header('▬▬▬▬▬▬▬▬▬▬▬▬▬'),
    sub('Import', importMenu),
    sub('Export', exportMenu),
    header('▬▬▬▬▬▬▬▬▬▬▬▬▬'),
    it('Exit', 'exit', { shortcut: ctrl('Q') }),
  ]

  const edit: MenuItem[] = [
    { label: 'Undo', shortcut: ctrl('Z'), disabled: !s.canUndo || !h.undo, onClick: h.undo },
    { label: 'Redo', shortcut: ctrl('Y'), disabled: !s.canRedo || !h.redo, onClick: h.redo },
    header('▬▬▬ Results Grid ▬▬▬▬'),
    it('Export Fitting Grid', 'exportCurrent'),
    it('Remove All Lines', 'delAll'),
    it('Remove First Line', 'delFirst'),
    it('Remove Last Line', 'delLast'),
    header('▬▬▬ Core Level ▬▬▬▬'),
    it('Copy Core Level', 'copyCore'),
    it('Paste Core Level', 'pasteCore'),
    it('Delete Core Level', 'deleteSheet'),
    it('Join Core Levels', 'joinCores'),
    it('Crop Core Levels', 'crop'),
    it('Rename Core Level', 'renameSheet'),
    header('▬▬▬▬▬▬▬▬▬▬▬▬▬'),
    it('Preferences', 'settings'),
  ]

  const radio = (label: string, checked: boolean, id: string): MenuItem => ({ label, checked, onClick: h[id], disabled: !h[id] })
  const themeMenu: MenuItem[] = [
    sub('Panel Theme', [
      ...['None', 'Simple', 'Simple Dark', 'Simple Darker', 'Simple Very Dark', 'Raised', 'Sunken'].map((t) => radio(t, s.theme === t, `theme:${t}`)),
      '-',
      radio('Auto (follow system light / dark)', s.theme === 'Auto', 'theme:Auto'),
    ]),
    sub('Grid Layout', [radio('Side by Side', s.layout === 'split', 'layout:split'), radio('Tabbed', s.layout === 'tabbed', 'layout:tabbed')]),
    sub('Grid Colour', s.greens.map((g, i) => radio(g, s.gridColour === g, `green:${i}`))),
  ]
  const view: MenuItem[] = [
    it('Overview', 'overview'),
    it('Sample Manager', 'sampleManager'),
    it('Labels Manager', 'labels'),
    header('▬▬▬ Toggles ▬▬▬▬▬▬'),
    it('Toggle Peak Fitting', 'toggle:plot'),
    it('Toggle Legend', 'toggle:legend'),
    it('Toggle Fit Results', 'toggle:fitResults'),
    it('Toggle Residuals', 'toggle:residuals'),
    { label: 'Show Welcome Logo', checked: s.welcomeLogo, onClick: h.welcomeLogo, disabled: !h.welcomeLogo },
    header('▬▬▬Style▬▬▬▬▬▬▬▬'),
    sub('Theme / Style', themeMenu),
    header('▬▬▬ Beta ▬▬▬▬▬▬▬▬'),
    { label: 'Show Kinetic Energy (Beta)', shortcut: ctrl('B'), checked: s.kineticEnergy, onClick: h.kineticEnergy, disabled: !h.kineticEnergy },
  ]

  const techTool = (label: string) => sub(label, [off('Full Window (all tabs)')])
  const tools: MenuItem[] = [
    sub('XPS', [
      it('Calculate Area Under Curve', 'measureArea'),
      it('Create Peak Model', 'fitting', { shortcut: ctrl('P') }),
      it('Mini Peak Fitting', 'miniFitting'),
      it('BE Correction Window', 'autoBE'),
      header('▬▬▬ Others ▬▬▬▬▬▬▬▬'),
      it('PCA Analysis (NMF)', 'pca'),
      it('PCA Analysis (Noise)', 'pcaNoise'),
      it('Spectral denoising', 'denoise'),
      it('Plot Modifications', 'plotMod'),
      header('▬▬▬ XPS Specific ▬▬▬▬▬▬'),
      it('D-parameter', 'dparam'),
      it('Multiplet Envelope Fit (Cr, Mn, Fe, Co, Ni 2p)', 'multiplet'),
      it('Wagner Plot / Auger Parameter', 'wagner'),
      it('VBM / Fermi / Cut-Off', 'vb'),
      it('AR-XPS Depth Profiling', 'arxps'),
      it('Thickness analysis - beta', 'thickogram'),
      header('▬▬▬ Profiling ▬▬▬▬▬▬▬▬'),
      it('Create Profiling', 'profileCreator'),
      it('Plot Creator (Books)', 'plotCreator'),
      header('▬▬▬ Peak ID ▬▬▬▬▬▬▬▬'),
      it('Auto Peak ID -- (Beta)', 'autoId'),
      it('Manual Peak ID / Labels', 'id'),
    ]),
    it('EDX HeatMap'),
    it('EELS Analysis'),
    it('ARPES Analysis'),
    ...['FTIR', 'Raman', 'SQUID', 'TGA / DSC', 'EIS', 'XRD', 'SEM', 'TEM', 'AFM', 'UV-Vis', 'Photoluminescence', 'Ellipsometry', 'Mass Spectrometry', 'Gas Chromatography', 'Dilatometry', 'BET / Physisorption'].map(techTool),
    header('▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬'),
    it('Labels Manager', 'labels'),
  ]

  const ai: MenuItem[] = [
    it('KherveAI', 'kherveAI'),
    '-',
    it('AI Configuration...', 'aiConfig'),
    '-',
    sub('MCP for Claude & other assistants', [
      it('MCP Server...', 'mcp'),
      '-',
      ...['Claude Desktop', 'Claude Code', 'Cursor', 'Windsurf', 'VS Code (Copilot)', 'Cline (VS Code)', 'LM Studio'].map((l) => it(`Connect ${l}`, 'mcp')),
    ]),
  ]

  const help: MenuItem[] = [
    it('User Guide', 'help', { shortcut: ctrl('H') }),
    '-',
    it("What's New", 'whatsNew'),
    it('List of Shortcuts', 'shortcuts', { shortcut: ctrl('K') }),
    it('KherveFitting Paper', 'paper'),
    it('Open Full Manual ', 'manual', { shortcut: ctrl('M') }),
    it('KherveFitting Videos', 'videos'),
    it('KherveTools Website', 'website'),
    it('Workshops & Announcements', 'workshops'),
    it('Check for Updates'),
    sub('Knowledge', [
      sub('Useful papers', [
        it('Explanation of the Multiplet splitting', 'paper:multiplet'),
        it('Explanation of the Coster-Kronig effect', 'paper:ck'),
        it('Strategies for Obtaining Peak Shapes', 'paper:shapes'),
        it('Measuring the D-parameter', 'paper:dparam'),
        it('Fitting of the C1s Peak', 'paper:c1s'),
        it('Fitting Transition Metal Cr/Mn/Fe/Co/Ni', 'paper:tm1'),
        it('Fitting Transition Metal Cu/Ti/V/Sc/Zn', 'paper:tm2'),
      ]),
      it('KherveDB', 'nist'),
      it('XPSfitting by M. Biesinger', 'link:biesinger'),
      it('HarwellXPS Guru', 'link:harwell'),
      it('Thermo Knowledge', 'link:thermo'),
      it('NIST XPS', 'link:nist'),
      it('XPSOasis', 'link:oasis'),
      it('Guide to XPS', 'link:guide'),
      header('▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬'),
      it('KherveFitting Videos', 'videos'),
      it('M. Biesinger Videos', 'link:biesingerVideos'),
      it('HarwellXPS Guru Videos', 'link:harwellVideos'),
      it('Casa XPS Videos', 'link:casaVideos'),
    ]),
    it('Registration Form'),
    it('Report Bug', 'reportBug'),
    it('Version Log', 'versionLog'),
    it('Download Stats'),
    it('Buy Me a Coffee', 'coffee'),
    it('About', 'about'),
  ]

  return [
    { label: 'File', items: file },
    { label: 'Edit', items: edit },
    { label: 'View', items: view },
    { label: 'Tools', items: tools },
    { label: 'AI', items: ai },
    { label: 'Help', items: help },
  ]
}
