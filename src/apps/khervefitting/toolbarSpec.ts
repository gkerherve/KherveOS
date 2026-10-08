// GENERATED from KherveFittingPro dev-AI libraries/Widgets_Toolbars.py
// (create_horizontal_toolbar, create_vertical_toolbar, create_results_grid,
// ToggleToolbar): the desktop's toolbars in order, with their icon files
// (public/apps/khervefitting/icons/) and hover help. Regenerate, don't hand-edit.

export interface ToolSpec {
  id?: string
  label?: string
  icon?: string
  iconOn?: string
  help?: string
  sep?: boolean
  stretch?: boolean
  control?: string
}

export const MAIN_TOOLBAR: ToolSpec[] = [
 {
  "id": "open",
  "label": "Open File",
  "icon": "open-folder-3.png",
  "help": "OPEN FILE\n\nOpens a KherveFitting project: an Excel workbook (.xlsx)\nor a KherveFitting HDF5 project (.kfit). All its sheets\n(core levels, surveys, other techniques) are loaded and\nlisted in the sheet selector.\n\nRaw instrument files (VAMAS, Avantage, Kratos, ...) are\nnot opened here: use File > Import for those.\n\nShortcut: Ctrl+O"
 },
 {
  "id": "quickSave",
  "label": "Save Data",
  "icon": "Save_Json-3.png",
  "help": "QUICK SAVE\n\nSaves all your work (backgrounds, peaks, fits, results,\nBE corrections) quickly, without rewriting the Excel\nfile:\n  - .xlsx project: writes the companion .json file\n    next to it (same name).\n  - .kfit project (or .kfit chosen in Preferences >\n    Save): saves the .kfit file.\n  - nothing saved yet: asks where to create the project.\n\nUse it often. To write fits into the Excel sheets\nthemselves, use the Export buttons next to it.\n\nShortcut: Ctrl+S"
 },
 {
  "id": "exportExcel",
  "label": "Export to Excel",
  "icon": "Save-excel-3.png",
  "help": "EXPORT THIS CORE LEVEL\n\nWrites the sheet on screen (data, background, peaks and\nfit) to a spreadsheet you can open outside KherveFitting.\nA dialog asks for the format:\n  - Excel (.xlsx): into the project's workbook (for a\n    .kfit project, into the .xlsx of the same name).\n  - kSheet (.ksheet): into the .ksheet of the same\n    name beside the project; existing sheets are kept.\n\nHow to use:\n1. Select the sheet in the sheet selector.\n2. Click, pick Excel or kSheet, then OK.\n\nFor everyday saving use Quick Save (Ctrl+S) instead."
 },
 {
  "id": "exportAll",
  "label": "Save All Sheets",
  "icon": "save-Multi-3.png",
  "help": "EXPORT ALL CORE LEVELS\n\nSame as Export This Core Level, but for every sheet of\nthe project in one go. A dialog asks for the format:\nExcel (.xlsx) or kSheet (.ksheet).\n\nUse it before sending the fitted data to someone or\nplotting it in another program.\n\nCan take a long time on big projects: not recommended\nfor 50+ core levels (export them one by one instead)."
 },
 {
  "id": "undo",
  "label": "Undo",
  "icon": "undo-3.png",
  "help": "UNDO\n\nSteps back to the previous snapshot of your work: peak\npositions and parameters, the fit, the Results grid and\nthe BE correction. Snapshots are taken as you edit\n(moving or adding peaks, fitting, exporting results...);\nthe last 50 are kept.\n\nMeant for peak / fit edits. File operations such as\ndeleting or renaming sheets are not undone on disk.\n\nShortcut: Ctrl+Z"
 },
 {
  "id": "redo",
  "label": "Redo",
  "icon": "redo-3.png",
  "help": "REDO\n\nRe-applies the step you just undid. Only available right\nafter an Undo: any new edit clears the redo list.\n\nShortcut: Ctrl+Y"
 },
 {
  "id": "sort",
  "label": "Sort Sheets",
  "icon": "Sort-3.png",
  "help": "SORT SHEETS\n\nReorders the sheets of the project, in the file itself,\nso each sample's spectra sit together:\n  - grouped by sample number (the number at the end of\n    the name: C1s, O1s = sample 0; C1s1, O1s1 = 1 ...);\n  - core levels in alphabetical order inside a group,\n    then Fermi, VB / Valence and Survey / Wide last.\n\nUseful after importing files in a random order.\nThe Excel file must not be open in another program."
 },
 {
  "id": "sampleManager",
  "label": "Sample/Experiment Manager",
  "icon": "list-view-3.png",
  "help": "SAMPLE / EXPERIMENT MANAGER\n\nOpens a table of the whole project: one row per sample,\none column per core level, plus each sample's BE\ncorrection. From it you jump between spectra, compare\nseveral on one plot and organise sheets.\n\nHow to use:\n1. Click to open the manager.\n2. Select one or more cells (spectra).\n3. Press a plot key while the manager has focus:\n   F2 / Ctrl+2  overlay (one sheet: normal view\n                with its peak model)\n   F3 / Ctrl+3  stacked with an offset\n   F4 / Ctrl+4  stacked with the fitted peaks\n   F5           heatmap\n\nThe ? button in the manager lists all its shortcuts."
 },
 {
  "control": "sheet"
 },
 {
  "id": "refresh",
  "label": "Refresh Excel File",
  "icon": "Refresh-3.png",
  "help": "REFRESH PROJECT FROM FILE\n\nSaves your current work, then re-reads the project file\n(.xlsx or .kfit) and rebuilds the sheet list and data.\n\nUse it when:\n  - you added, removed or edited sheets in Excel while\n    the project was open here;\n  - the sheet list or plots look out of step with the\n    file.\n\nSheet names are tidied on the way (e.g. 'C 1s Scan'\nbecomes 'C1s', survey scans become 'Survey'). Your BE\ncorrections and sample names are kept."
 },
 {
  "id": "deleteSheet",
  "label": "Delete Core Level/Survey",
  "icon": "delete-3.png",
  "help": "DELETE CURRENT SHEET\n\nPermanently removes the sheet shown in the sheet\nselector (core level, survey...) from the project and\nfrom the project file, then shows the first sheet.\n\nHow to use:\n1. Select the sheet to remove.\n2. Click and answer Yes to the confirmation.\n\nAn automatic backup of the project is made first.\nSeveral sheets at once: use the Sample Manager."
 },
 {
  "id": "renameSheet",
  "label": "Rename Core Level/Survey",
  "icon": "rename-3.png",
  "help": "RENAME CURRENT SHEET\n\nGives the sheet on screen a new name, in the project and\nin the project file. Names drive how KherveFitting reads\nthe sheet: the element + orbital picks the core level\nand the trailing number picks the sample.\n\nHow to use:\n1. Select the sheet, click this button.\n2. Type the new name - one word, no spaces\n   (e.g. Fe2p, O1s3, Survey2) - and press OK.\n\nA backup is made first. An open Sample Manager is\nclosed so it can be refreshed."
 },
 {
  "id": "crop",
  "label": "Crop",
  "icon": "Crop-3.png",
  "help": "CROP TO A NEW SHEET\n\nCuts a binding-energy range out of the current spectrum\nand saves it as a new sheet; the original is untouched.\nUse it to split a wide scan into a core-level region, or\nto separate two regions recorded in one spectrum.\n\nHow to use:\n1. Click: two vertical lines appear on the plot.\n2. Drag the lines, or type Min BE / Max BE.\n3. Set the new sheet name (a free name is suggested).\n4. Tick the same core level of other samples to crop\n   them all at once, then press Crop.\n\nOn an AFM image sheet it crops a rectangle instead."
 },
 {
  "sep": true
 },
 {
  "control": "be"
 },
 {
  "id": "autoBE",
  "label": "Auto BE",
  "icon": "BEcorrect-3.png",
  "help": "AUTOMATIC BE CORRECTION\n\nOpens the Binding Energy Correction window. It finds a\nfitted reference peak in each sample (by default a peak\nwhose label contains 'C1s C-C'), compares its position\nwith the reference BE (default 284.8 eV) and sets the\nsample's BE correction to the difference.\n\nHow to use:\n1. Fit the reference peak (e.g. C 1s adventitious C)\n   in each sample.\n2. Click, check the peak name and reference BE.\n3. 'Correct Current Row' for this sample, or tick\n   samples and 'Correct Selected Rows'.\n'Reset Selected to 0 eV' removes the correction."
 },
 {
  "sep": true
 },
 {
  "id": "measureArea",
  "label": "Background",
  "icon": "BKG-3.png",
  "help": "MEASURE AREA (BACKGROUND + AREA, NO PEAK MODEL)\n\nOpens the Measure Area window: subtract a background and\nmeasure the area under the curve without fitting peaks.\nQuick quantification of surveys or of core levels you do\nnot need to decompose.\n\nHow to use:\n1. Drag the two vertical lines on the plot to the ends\n   of the peak.\n2. Pick a background (Smart, Shirley, Linear, Tougaard,\n   polynomial, ALS).\n3. Type an Area Name (or use Core Level List) and press\n   'Create Background / Area'.\n4. Export the result to the Results grid.\n\nTAB / Q switch between measured regions. The Batching\ntab repeats the area on other samples."
 },
 {
  "id": "fitting",
  "label": "Fitting",
  "icon": "C1s-3.png",
  "help": "PEAK FITTING (FULL)\n\nOpens the Peak Fitting window, the main tool to build a\npeak model: background, peaks, constraints and fit.\n\nTabs:\n  BKG - choose the method (Shirley, Smart,\n    Tougaard, Linear, spline, active...) and its range.\n  Fitting - add peaks, pick the line shape and\n    fitting method, then Fit.\n  Adv. Fitting - fit continuously while the regions\n    change; auto-tune the background offsets.\n  Batch - copy a model to other samples and fit\n    many core levels in one go.\n\nHow to use:\n1. Set the background range with the vertical lines.\n2. Create the background, then add peaks and Fit.\nKeys: TAB switches region (BKG tab); TAB / Q\nselect next / previous peak (Fitting tab).\n\nShortcut: Ctrl+P"
 },
 {
  "id": "miniFitting",
  "label": "Fitting",
  "icon": "C1sMini-3.png",
  "help": "MINI PEAK FITTING (SIMPLIFIED)\n\nOpens a compact version of the Peak Fitting window with\nonly the essential controls: four background methods\n(Smart, U2-Tougaard, Active Shirley, Active Tougaard),\nno offsets, typed ranges or averaging, no Adv. Fitting\nor Batch tab,\nand a small button bar for regions.\n\nGood for a first fit or on a small screen. Switch to the\nfull Peak Fitting button for advanced settings.\n\nSame workflow: set the background range with the lines,\ncreate the background, add peaks, then Fit."
 },
 {
  "id": "monteCarlo",
  "label": "Monte Carlo",
  "icon": "MC-3.png",
  "help": "MONTE CARLO UNCERTAINTIES (±1σ)\n\nError bars for every peak of the current core level:\nPosition, FWHM, Height, L/G and Area (and from them the\natomic %).\n\nThe spectrum is refitted many times. Each time, synthetic\nnoise with the same statistics as the fit residuals is put\non the fitted envelope (weighted residual bootstrap). The\nstandard deviation of each refitted value is its ±1σ.\n\nWorks on any peak table - fitted or not. An unfitted table\nis used as it is: its values are not changed.\n\nThe dialog has a 'How does it work?' button with the full\nmethod, its assumptions and its limits."
 },
 {
  "sep": true
 },
 {
  "id": "dparam",
  "label": "Differentiate",
  "icon": "Dpara-3.png",
  "help": "D-PARAMETER (sp2 / sp3 CARBON)\n\nOpens the D-Parameter Measurement window. It smooths and\ndifferentiates the spectrum, then measures the D-parameter:\nthe energy gap between the maximum and minimum of the\nfirst derivative. On the C KLL Auger peak this estimates\nthe sp2 fraction (diamond ~14 eV, graphite ~22.5 eV); the\nwindow reads off the % sp2 on a reference chart.\n\nHow to use:\n1. Select the C KLL (Auger) sheet.\n2. Click, adjust smoothing / differentiation widths.\n3. Press Calculate. 'Clear D-para' removes it."
 },
 {
  "id": "plotMod",
  "label": "Plot Modifications",
  "icon": "Mod-3.png",
  "help": "PLOT / DATA MODIFICATIONS\n\nOpens a window of operations applied to the spectrum of\nthe current sheet:\n  - Smoothing (Gaussian, Savitzky-Golay, moving average)\n  - Add noise (Gaussian, uniform, Poisson), e.g. to test\n    how robust a fit is\n  - Differentiation and Integration\n  - Constant: multiply, divide, add or subtract a value\n  - BE shift of the energy axis\n  - Create a synthetic Voigt peak (position, FWHM,\n    L/G, height, range)\n\nHow to use: select the sheet, click, set the values in\none box and press its Apply / Create button."
 },
 {
  "id": "thickogram",
  "label": "Thickogram",
  "icon": "Thicko-3.png",
  "help": "THICKNESS ANALYSIS (THICKOGRAM / TOUGAARD)\n\nOpens the XPS Thickness Analysis window, used to estimate\nthe thickness of a thin overlayer on a substrate. Two tabs:\n  Thickogram - Cumpson's thickogram method, from the\n    overlayer / substrate peak intensity ratio.\n  Tougaard Depth Analysis - from the shape of the\n    inelastic background below the peaks.\n\nHow to use: fit or measure the overlayer and substrate\npeaks first, then click, choose a tab and enter the\nvalues it asks for.\n\nExample: 2 nm SiO2 on Si from Si 2p oxide / Si 2p metal."
 },
 {
  "id": "vb",
  "label": "VB",
  "icon": "VBM-3.png",
  "help": "VALENCE BAND / FERMI EDGE MEASUREMENTS\n\nOpens the VB Measurements window for valence band and\nFermi-edge spectra:\n  - Fit a Fermi edge (metal reference) and use it to\n    correct the binding energy scale.\n  - Find the valence band edge (VBM) or a cut-off by\n    linear extrapolation of the leading edge, with an\n    optional background extrapolation.\n\nHow to use:\n1. Select the VB (or Fermi) sheet and click.\n2. Drag the two vertical lines around the edge.\n3. Tick the sample sheets to process in the list.\n4. Press Fit Selected Fermi, or Calculate VBM /\n   Calculate Cut-Off.\n'Show Analysis Results' opens the table of values."
 },
 {
  "id": "pca",
  "label": "PCA",
  "icon": "PCA-3.png",
  "help": "NMF ANALYSIS (NON-NEGATIVE MATRIX FACTORISATION)\n\nOpens the NMF Analysis window. Given a series of spectra\nof the same core level (depth profile, temperature or\ntime series...), it finds a few component spectra and\nhow much of each is in every spectrum - without a peak\nmodel.\n\nHow to use:\n1. Tick the core levels of the series.\n2. Choose offset (min. value / Smart background) and\n   normalisation (none, area, max height).\n3. Press Analyse, set how many components to Use,\n   then Re-Display.\n4. 'Create NMF as Core Levels' saves the components as\n   new sheets; 'Export Results' writes them to Excel or\n   to a SingleEntity .json for the Peaks Library."
 },
 {
  "id": "denoise",
  "label": "Denoise",
  "icon": "Smooth-3.png",
  "help": "SPECTRAL DENOISING (FFT / WAVELET / VMD)\n\nOpens the Spectral Denoising window to reduce noise in a\nspectrum while keeping its peaks. Three methods:\n  FFT - low-pass filter in Fourier space (cut-off, slope)\n  Wavelet - wavelet shrinkage, good for sharp peaks\n  VMD - splits the signal into modes, keeps the lowest\n\nHow to use:\n1. Select the core level and a method.\n2. Press Auto for suggested settings, or tune them and\n   press Apply; compare Raw vs Denoised + residual.\n3. Tick the spectra and press Create: the denoised data\n   go to NEW sheets, the originals are never changed."
 },
 {
  "sep": true
 },
 {
  "id": "profileCreator",
  "label": "Profile Creator",
  "icon": "Profile_Create-3.png",
  "help": "PROFILE CREATOR\n\nBuilds a profile: one quantity plotted against the\nsample number, e.g. atomic % of each element through\na depth profile or a temperature series. The profile is\nsaved as a new 'zzProfile' sheet you can plot and edit.\n\nHow to use:\n1. Fit / export all samples first.\n2. Click, tick the core levels to include.\n3. Pick the Type: Concentration, Area, Position, FWHM,\n   Height, L/G, Corrected Area or Weight (%).\n4. Create from the Peak Fitting grid (each sheet's peaks)\n   or from the Results grid (exported values)."
 },
 {
  "id": "plotCreator",
  "label": "Plot Creator",
  "icon": "Profile_Edit-3.png",
  "help": "PLOT CREATOR\n\nBuilds your own plots in books (zzBook sheets): a\nworkbook whose columns are plotted on the main window.\n\n- Import any core level, survey or data sheet: BE, raw\n  data, background, envelope, residuals and each peak,\n  linked to the sheet (a refit updates the book).\n- Columns X / Y / yErr, formulas (F(x)), show / hide,\n  fill between two curves (Fill to), plot style.\n- Also edits the profiles of the Profile Creator."
 },
 {
  "sep": true
 },
 {
  "id": "autoId",
  "label": "Auto ID",
  "icon": "IDauto-3.png",
  "help": "AUTOMATIC ELEMENT IDENTIFICATION (SURVEY)\n\nFinds the peaks of a survey (wide) scan and proposes the\nelement and core level behind each one, with a\nconfidence score. Saves a lot of time on unknown samples.\n\nHow to use:\n1. Select a sheet whose name contains 'Survey' or 'Wide'\n   (other sheets are refused).\n2. Click to open the Auto ID window and run it.\n3. Check / untick the proposals, then Create Areas (for\n   quantification) or Create Labels (on the plot).\n\nThe window's options help on difficult surveys (small\nor noisy peaks, elements you know are present)."
 },
 {
  "id": "id",
  "label": "ID",
  "icon": "ID-3.png",
  "help": "MANUAL ELEMENT IDENTIFICATION (PERIODIC TABLE)\n\nOpens the Survey Identification / Labelling window: a\nperiodic table that marks where each element's lines\n(core levels, doublets, Auger peaks) fall on your plot.\nUse it to confirm or find elements by eye.\n\nHow to use:\n1. Plot a survey (or any spectrum) and click.\n2. Lines by Element tab: click elements to show their\n   lines; 'Add Labels' writes them on the plot.\n3. Lines by Range tab: list every line in an energy\n   window (drag the lines, mouse wheel to resize).\n\nIts own Auto ID button runs the automatic search."
 },
 {
  "id": "nist",
  "label": "NIST Database",
  "icon": "NIST-3.png",
  "help": "KHERVEDB BINDING ENERGY DATABASE\n\nOpens kDB, a searchable library of reference\nbinding energies (NIST-style) in its own window.\nUse it to check which chemical state a peak position\nmatches.\n\nHow to use:\n1. Click an element in the periodic table and choose the\n   XPS line, or search by formula or compound name.\n2. Read the list of compounds and their BE values.\n3. 'Plot Results' shows how the values are distributed.\n\nExample: compare a fitted Ti 2p peak with the TiO2,\nTiN and Ti metal entries."
 },
 {
  "id": "kherveAI",
  "label": "NIST Database",
  "icon": "KherveAI-3.png",
  "help": "KHERVEAI ASSISTANT\n\nOpens kAI, a chat assistant that knows XPS and\nKherveFitting. Ask questions in plain language (peak\npositions, fitting advice, how to do something) or ask\nit to carry out actions in the program for you.\n\nHow to use:\n1. Click to open the chat (click again to bring it back\n   if it was minimised).\n2. Type your request and send it.\n\nThe AI provider and key are set in AI > AI\nConfiguration."
 },
 {
  "stretch": true
 },
 {
  "id": "libOpen",
  "label": "Open Peaks Library",
  "icon": "LibOpen-3.png",
  "help": "OPEN PEAKS LIBRARY\n\nLoads a peak model saved with Save Peaks Library (a .json\nfile) onto the current core level, so you do not rebuild\nthe same model by hand. The folder also comes with starter\nreference templates.\n\nHow to use:\n1. Select the sheet you want to fit.\n2. Click and pick the .json file.\n3. If the sheet already has peaks, choose Overwrite\n   existing peaks or Add after existing peaks.\n4. Refit so the peaks settle on the new data."
 },
 {
  "id": "libSave",
  "label": "Save Peaks Library",
  "icon": "LibSave-3.png",
  "help": "SAVE PEAKS LIBRARY\n\nSaves the peak model of the current core level to a .json\nfile (default folder: your Peaks Library), so the same\nmodel can be reused on other spectra or other projects.\n\nHow to use:\n1. Build and fit the peak model on the current sheet.\n2. Click and choose what to save:\n   - Individual Peaks: each peak and its constraints.\n   - SingleEntity using Peak Model: all the peaks merged\n     into one envelope shape (needs peaks).\n   - SingleEntity using Raw Data: raw data minus the\n     background as one shape (needs a background).\n3. Pick a file name. Reload it with Open Peaks Library."
 },
 {
  "id": "settings",
  "label": "Load Settings",
  "icon": "Settings-3.png",
  "help": "PREFERENCES\n\nOpens the Preferences window, where the program's\ndefaults are set. Tabs:\n  XPS Plot - colours, line / marker styles of data,\n    background, envelope, residuals and peaks\n  Other Plots - styles for the other techniques\n  Text/Axis - font sizes of axes, legend and labels\n  Save - project file format (.xlsx or .kfit) and the\n    size of the plots written into Excel\n  Instrument - current instrument, ECF method and the\n    sensitivity-factor library used for quantification\n\nChanges are remembered for the next sessions."
 },
 {
  "id": "toggleColumns",
  "label": "Toggle Residuals",
  "icon": "HideColumn-3.png",
  "help": "SHOW / HIDE EXTRA GRID COLUMNS\n\nSwitches both grids between a compact view and the full\nset of columns.\n  Peak Fitting grid: hides / shows Fitting Model and the\n    background columns (type, low / high BE, offsets).\n  Results grid: hides / shows Height, L/G, Fitting\n    Model, widths, background settings, sheet name and\n    the constraint columns.\n\nClick once to hide, again to show. Nothing is deleted:\nonly the display changes."
 },
 {
  "id": "toggleRightPanel",
  "label": "Toggle Right Panel",
  "icon": "left-3.png",
  "help": "COMPACT VIEW (PLOT ONLY)\n\nHides the grids panel (Peak Fitting and Results) and the\nvertical plot toolbar, and shrinks the window to the plot\nalone with a reduced toolbar. Handy on a small screen or\nto keep a spectrum beside another program.\n\nClick the same arrow button in the reduced toolbar to\nbring everything back at the previous window size."
 }
]

export const PLOT_TOOLBAR: ToolSpec[] = [
 {
  "id": "toggles",
  "label": "Toggles",
  "icon": "Toggles-3.png",
  "help": "DISPLAY TOGGLES\n\nOpens a small floating bar, to the right of this toolbar,\nwith six buttons that change what the plot shows:\n  - fit on / off (raw data only)\n  - peak fill on / off\n  - Y axis: values / hidden / 'a.u.'\n  - legend: hidden / full / peaks only\n  - fit results box on / off\n  - residuals: off / on plot / separate panel\n\nHover each button for details. Click this button again\nto close the bar."
 },
 {
  "id": "zoomIn",
  "label": "Zoom In",
  "icon": "ZoomIN-3.png",
  "help": "ZOOM IN (BOX)\n\nZooms the plot onto a rectangle you draw, both in energy\nand in intensity.\n\nHow to use:\n1. Click this button.\n2. Left-drag a box on the plot around the region.\n3. Release: the plot zooms and the tool switches off.\nClick the button again before drawing to cancel.\n\nKeyboard: Ctrl+= / Ctrl+- zoom the energy range in / out\nstep by step. Zoom Out (below) resets the view."
 },
 {
  "id": "zoomOut",
  "label": "Zoom Out",
  "icon": "ZoomOUT-3.png",
  "help": "ZOOM OUT (RESET VIEW)\n\nReturns the plot to its full, original range in energy\nand intensity, undoing box zooms, drags and the edge\narrows below. Also cancels a pending Zoom In or Drag.\n\nKeyboard: Ctrl+- zooms out one step at a time instead."
 },
 {
  "id": "drag",
  "label": "Drag",
  "icon": "Drag-25.png",
  "help": "DRAG (PAN) THE PLOT\n\nMoves the visible window over the spectrum without\nchanging the zoom.\n\nHow to use:\n1. Click this button (the cursor becomes a hand).\n2. Left-drag the plot to where you want it.\n3. Release: the new view is kept and the tool switches\n   off. Click again to drag once more.\n\nKeyboard: Ctrl+Left / Ctrl+Right shift the energy range."
 },
 {
  "id": "plotLimits",
  "label": "Plot Limits",
  "icon": "PlotLimits-3.png",
  "help": "PLOT LIMITS\n\nOpens the Plot Limits window to set the exact range shown:\n  Binding Energy (eV): high and low BE\n  Intensity (counts/s): max and min\n\nHow to use: type values or move the sliders; the plot\nfollows as you change them. 'Reset' goes back to the\nfull range.\n\nExample: show exactly 280-295 eV for every C 1s figure\nof a paper."
 },
 {
  "id": "greenLine",
  "label": "Green Line",
  "icon": "GreenLine-25.png",
  "iconOn": "GreenLine-Selected-25.png",
  "help": "GREEN MARKER LINE (ON / OFF)\n\nShows a green vertical line in the middle of the plot,\nwith its energy written at the top. Use it to read a\nposition precisely or to line up features between\nspectra.\n\nHow to use:\n1. Click: the button stays pressed, the line appears.\n2. Left-drag the line; the label updates as it moves.\n3. Click the button again to remove the line.\n\nIt works in every tab and does not change the data."
 },
 {
  "sep": true
 },
 {
  "id": "highBePlus",
  "label": "High BE +",
  "icon": "Right-Red-25g.png",
  "help": "DECREASE HIGH BE (LEFT EDGE ->)\n\nMoves the left (high binding energy) edge of the plot\nto the right, cutting off part of the high-BE side.\nEach click moves one step: 2% of the visible range, at\nleast 0.2 eV.\n\nRed arrows = left edge, blue arrows = right edge; each\narrow moves its edge the way it points.\n\nKeyboard: Shift+Left. Zoom Out resets the range."
 },
 {
  "id": "highBeMinus",
  "label": "High BE -",
  "icon": "Left-Red-25g.png",
  "help": "INCREASE HIGH BE (<- LEFT EDGE)\n\nMoves the left (high binding energy) edge of the plot\nfurther left, showing more of the high-BE side.\nEach click moves one step: 2% of the visible range, at\nleast 0.2 eV.\n\nExample: reveal a satellite just above the main peak.\n\nKeyboard: Shift+Right. Zoom Out resets the range."
 },
 {
  "id": "lowBePlus",
  "label": "Low BE +",
  "icon": "Left-blue-25g.png",
  "help": "INCREASE LOW BE (<- RIGHT EDGE)\n\nMoves the right (low binding energy) edge of the plot\nto the left, cutting off part of the low-BE side.\nEach click moves one step: 2% of the visible range, at\nleast 0.2 eV.\n\nRed arrows = left edge, blue arrows = right edge; each\narrow moves its edge the way it points.\nZoom Out resets the range."
 },
 {
  "id": "lowBeMinus",
  "label": "Low BE -",
  "icon": "Right-blue-25g.png",
  "help": "DECREASE LOW BE (RIGHT EDGE ->)\n\nMoves the right (low binding energy) edge of the plot\nfurther right, showing more of the low-BE side.\nEach click moves one step: 2% of the visible range, at\nleast 0.2 eV.\n\nExample: bring back the tail of a peak that is cut off\non the right. Zoom Out resets the range."
 },
 {
  "id": "highIntPlus",
  "label": "High Int +",
  "icon": "Up-Red-25g.png",
  "help": "RAISE TOP OF Y AXIS\n\nIncreases the maximum intensity shown, so the spectrum\nlooks smaller and leaves room above it (e.g. for the\nlegend or labels). Each click adds about 5% of the\nhighest data point.\n\nOn a heatmap it changes the colour scale instead.\n\nKeyboard: Ctrl+Up. Zoom Out resets the range."
 },
 {
  "id": "highIntMinus",
  "label": "High Int -",
  "icon": "Down-Red-25g.png",
  "help": "LOWER TOP OF Y AXIS\n\nDecreases the maximum intensity shown, so the spectrum\nis stretched vertically and small peaks are easier to\nsee (the top of big peaks may go off the plot). Each\nclick removes about 5% of the highest data point.\n\nOn a heatmap it changes the colour scale instead.\n\nKeyboard: Ctrl+Down. Zoom Out resets the range."
 },
 {
  "id": "lowIntPlus",
  "label": "Low Int +",
  "icon": "Up-Blue-25g.png",
  "help": "RAISE BOTTOM OF Y AXIS\n\nIncreases the minimum intensity shown, cutting off the\nflat bottom of the plot so the peaks fill more of it.\nEach click moves about 2% of the highest data point.\n\nExample: a small peak sitting on a high background.\nZoom Out resets the range."
 },
 {
  "id": "lowIntMinus",
  "label": "Low Int -",
  "icon": "Down-Blue-25g.png",
  "help": "LOWER BOTTOM OF Y AXIS\n\nDecreases the minimum intensity shown, adding empty\nspace below the spectrum (e.g. room for residuals or\nlabels). Each click moves about 2% of the highest data\npoint; it can go below zero.\n\nZoom Out resets the range."
 },
 {
  "sep": true
 },
 {
  "id": "fontUp",
  "label": "Increase Font Size",
  "icon": "A+_25.png",
  "help": "BIGGER TEXT ON THE PLOT (A+)\n\nIncreases by 1 pt every font of the plot at once: axis\ntitles, axis numbers, legend, core-level name and\nlabels (up to 40 pt).\n\nHandy before copying a figure into slides. The new\nsizes are saved as your default and shown in\nPreferences > Text/Axis, where each can be set alone."
 },
 {
  "id": "fontDown",
  "label": "Decrease Font Size",
  "icon": "A-_25.png",
  "help": "SMALLER TEXT ON THE PLOT (A-)\n\nDecreases by 1 pt every font of the plot at once: axis\ntitles, axis numbers, legend, core-level name and\nlabels (down to 6-8 pt).\n\nThe new sizes are saved as your default and shown in\nPreferences > Text/Axis, where each can be set alone."
 },
 {
  "id": "labels",
  "label": "Labels Manager",
  "icon": "ListText2-25.png",
  "help": "LABELS MANAGER (ANNOTATIONS)\n\nOpens the Labels Manager to annotate the plot of the\ncurrent sheet. You can add:\n  - text labels (e.g. 'Ti4+', 'satellite')\n  - drawings: lines, arrows, shapes\n  - inset plots and PNG images\n  - measurements: energy gap (dE), brackets\n\nHow to use:\n1. Click, then use the window's Add buttons.\n2. Select an item in the list to edit its properties,\n   nudge it with the arrow buttons, or remove it."
 }
]

export const RESULTS_TOOLBAR: ToolSpec[] = [
 {
  "id": "exportCurrent",
  "label": "Export Current Core Level",
  "icon": "Export-25g.png",
  "help": "EXPORT CURRENT CORE LEVEL TO RESULTS GRID\n\nCopies every peak of the core level on screen into the\nResults grid, as new rows added after the existing ones.\nEach row gets its position, height, FWHM, area, RSF and\ncorrected area, and the atomic % of all ticked rows is\nrecalculated straight away.\n\nHow to use:\n1. Fit (or measure) the peaks of the current core level.\n2. Click this button: the peaks appear at the bottom.\n3. Repeat for each core level of the sample.\n\nEach sample has its own Results grid, chosen by the number\nat the end of the sheet name (C1s = sample 0, C1s2 = 2)."
 },
 {
  "id": "exportMultiple",
  "label": "Export Multiple Core Levels",
  "icon": "Export-3.png",
  "help": "EXPORT SEVERAL CORE LEVELS TO RESULTS GRID\n\nOpens the 'Export to Results Grid' window, where you tick\nthe core levels to export in one go instead of clicking\nthe single-export button on each sheet in turn.\n\nHow to use:\n1. Click to open the window.\n2. Tick core levels, or use Select All / Select This Core\n   Level / Select This Row (all sheets of this sample).\n3. 'Export to Results Grid' adds them after existing rows;\n   'Clean and Export' empties the grid first."
 },
 {
  "sep": true
 },
 {
  "id": "delAll",
  "label": "Delete All Results",
  "icon": "DelAll-25.png",
  "help": "DELETE ALL RESULTS\n\nRemoves every row of the Results grid of the current\nsample, both on screen and in the saved results table.\nUse it to start the quantification of a sample again.\n\nNo confirmation is asked: the rows go at once.\nOnly this sample's grid is cleared (the sample is set by\nthe number at the end of the sheet name)."
 },
 {
  "id": "delFirst",
  "label": "Delete First Row",
  "icon": "DelFirst-25.png",
  "help": "DELETE FIRST ROW\n\nRemoves the top row of the Results grid of the current\nsample. The remaining rows move up and are renumbered.\n\nHandy when the oldest exported peak is no longer wanted.\nNo confirmation is asked."
 },
 {
  "id": "delLast",
  "label": "Delete Last Row",
  "icon": "DelLast-25.png",
  "help": "DELETE LAST ROW\n\nRemoves the bottom row of the Results grid of the current\nsample, i.e. the most recently exported peak.\n\nExample: you exported a core level twice by mistake -\nclick this once per duplicated peak.\nNo confirmation is asked."
 },
 {
  "id": "delSelected",
  "label": "Delete Selected Row",
  "icon": "DelSelected-25.png",
  "help": "DELETE SELECTED ROW\n\nRemoves one chosen row of the Results grid of the current\nsample. The rows below move up and are renumbered.\n\nHow to use:\n1. Click a row label (or any cell) in the Results grid.\n2. Click this button.\n\nIf several full rows are selected, only the first one is\ndeleted. No confirmation is asked."
 }
]

export const TOGGLE_TOOLBAR: ToolSpec[] = [
 {
  "id": "plot",
  "label": "Toggle Plot",
  "icon": "scatter-plot-25.png",
  "help": "SHOW / HIDE THE FIT\n\nSwitches the plot between the full view (raw data with\nbackground, peaks and envelope) and the raw data alone.\nClick again to bring the fit back. Nothing is deleted.\n\nExample: show the bare spectrum before presenting the\npeak model."
 },
 {
  "id": "peakFill",
  "label": "Toggle Peak Fill",
  "icon": "STO-25-2.png",
  "help": "PEAK FILL ON / OFF\n\nDraws the fitted peaks as coloured filled areas, or as\noutlines only. Outlines are clearer when many peaks\noverlap; filled peaks read better on slides."
 },
 {
  "id": "yAxis",
  "label": "Toggle Y Axis",
  "icon": "Y-25.png",
  "help": "Y AXIS STYLE (3 STATES)\n\nEach click moves to the next style of the intensity axis:\n  1. 'Intensity (CPS)' with numbers\n  2. Y axis hidden completely\n  3. 'Intensity (a.u.)' without numbers\n\nStyle 3 is the usual choice for publication figures."
 },
 {
  "id": "legend",
  "label": "Toggle Legend",
  "icon": "Legend-25.png",
  "help": "LEGEND STYLE (3 STATES)\n\nEach click moves to the next legend style:\n  - hidden\n  - full (raw data, background, envelope and peaks)\n  - peaks only (named components)\n\nWhen a Fermi-edge fit is on the plot the legend always\nstays visible. The legend can be dragged with the mouse."
 },
 {
  "id": "fitResults",
  "label": "Toggle Fit Results",
  "icon": "ToggleFit-25.png",
  "help": "FIT RESULTS BOX ON / OFF\n\nShows or hides the small box of fit results drawn in\nthe lower-left corner of the plot. Only has an effect\nonce a fit has produced that box."
 },
 {
  "id": "residuals",
  "label": "Toggle Residuals",
  "icon": "Res-25.png",
  "help": "RESIDUALS DISPLAY (3 STATES)\n\nResiduals = data minus fit; a good fit leaves only\nnoise. Each click moves to the next display:\n  - hidden\n  - drawn on the main plot, above the spectrum\n  - in a separate panel under the plot"
 }
]

export const SHEET_HELP = "SHEET SELECTOR\n\nLists every sheet (core level, survey, other technique)\nof the open project. Pick one to plot it and load its\nbackground, peaks and fit into the grids.\n\nShortcuts: Ctrl+[ or Ctrl+9 = previous sheet,\n           Ctrl+] or Ctrl+0 = next sheet."
export const BE_HELP = "BINDING ENERGY CORRECTION (eV)\n\nShift applied to the binding-energy axis of every sheet\nof the current sample (charge correction). The sample\nis set by the number at the end of the sheet name, so\nC1s2, O1s2 and Survey2 all share one value.\n\nHow to use: type a value or use the arrows (0.01 eV\nsteps). Positive values move peaks to higher BE.\n\nExample: C 1s C-C fitted at 285.30 eV, reference\n284.80 eV -> enter -0.50.\nThe Auto BE button next to it computes this for you."
