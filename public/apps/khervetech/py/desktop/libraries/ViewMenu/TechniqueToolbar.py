# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ViewMenu/TechniqueToolbar.py. Regenerate with tools/export_khervetech.py.
"""
Technique-aware main toolbar.

On an XPS sheet the horizontal toolbar is the full XPS instrument: BE
correction, background, peak fitting, D-parameter, thickogram, VB, PCA,
profile tools, element ID, the peak libraries. None of that applies to a TEM
image, so when a TEM-family sheet is on screen those tools are pulled out of
the toolbar and seven small section buttons take their place — Cal, Part,
Prof, FFT, Filt, Meas, Adv — each opening that section of the TEM analysis in
its own window. The common tools (open/save, undo/redo, the sheet selector,
delete/rename/crop, settings, the panel toggles and the technique button)
stay put.

The tools are moved, not rebuilt: ``wx.ToolBar.RemoveTool`` returns the tool
object with its binding intact and ``InsertTool`` puts it back at its old
position, so nothing has to be re-bound and the embedded sheet-selector
combobox is never disturbed. Restoring the XPS tools inserts them in
ascending original-position order so each lands in the right slot.
"""

import wx

BRAND = wx.Colour(79, 190, 159)
GREY = wx.Colour(150, 150, 150)      # darker grey, to read against the toolbar
# Not black: the drawn icons of the toolbar outline in a dark grey (undo and
# redo are exactly this, save-Multi is within a few counts of it), and a true
# black next to them reads as a harder, heavier button.
BORDER = wx.Colour(51, 51, 51)

# (section key, short label drawn on the icon, full name / tooltip)
SECTIONS_TEM = (
    ('calibrate', 'Cal', 'Calibrate'),
    ('particles', 'Part', 'Particles'),
    ('profile', 'Prof', 'Profile'),
    ('fft', 'FFT', 'FFT'),
    ('filter', 'Filt', 'Filter'),
    ('measure', 'Meas', 'Measure'),
    ('advanced', 'Adv', 'Advanced'),
    ('denoise', 'Den', 'Denoise'),
)
SECTIONS_SEM = (
    ('calibrate', 'Cal', 'Calibrate'),
    ('crop', 'Crop', 'Crop'),
    ('detect', 'Det', 'Detect'),
    ('results', 'Res', 'Results'),
)
# One icon per tab of the AFM Analysis window. Lettered tiles, like every
# other technique here: the pictograms these used to carry were legible on
# their own but made AFM the one bar in the app you had to read differently,
# and eight drawings at 25 px are harder to tell apart at a glance than eight
# words. (``_draw_glyph`` still knows them, for anything that wants one.)
SECTIONS_AFM = (
    ('channels', 'Chan', 'Channels'),
    ('level', 'Lvl', 'Level'),
    ('regions', 'ROI', 'Regions & Crop'),
    ('roughness', 'Rough', 'Roughness'),
    ('particles', 'Grain', 'Measure grain size'),
    ('profile', 'Prof', 'Profile'),
    ('force', 'F-d', 'Force Curves'),
    ('view3d', '3D', '3D Surface'),
)
# One icon per tab of the SQUID Analysis window; each opens that tab in its own
# window (see SQUID_Analysis.open_squid_section). Order follows the notebook.
SECTIONS_SQUID = (
    ('susceptibility', 'Susc', 'Susceptibility'),
    ('fit', 'Fit', 'Curie-Weiss Fit'),
    ('stability', 'Stab', 'Stability'),
    ('moment', 'μ', 'Theoretical μ'),
    ('corrections', 'Corr', 'Corrections'),
    ('zfcfc', 'ZFC', 'ZFC–FC'),
    ('hysteresis', 'M-H', 'M–H'),
    ('quality', 'Qual', 'Quality'),
)
# One icon per tab of the TGA / DSC Analysis window.
SECTIONS_TGA = (
    ('range', 'Rng', 'Range'),
    ('mass', 'Mass', 'Mass'),
    ('dtg', 'DTG', 'DTG'),
    ('dsc', 'DSC', 'DSC'),
    ('heatflow', 'Flow', 'Heat Flow'),
    ('events', 'Evt', 'Events'),
    ('chemistry', 'Chem', 'Chemistry'),
    ('cycles', 'Cyc', 'Cycles'),
    ('isothermal', 'Iso', 'Isothermal'),
    ('compare', 'Cmp', 'Compare'),
)
# One icon per tab of the EIS Analysis window.
SECTIONS_EIS = (
    ('intercept', 'Int', 'Intercepts'),
    ('circuit', 'Circ', 'Circuit Fit'),
    ('batch', 'Bat', 'Batch'),
    ('normalise', 'Norm', 'Normalisation'),
    ('sigma', 'Cond', 'Conductivity'),
    ('arrhenius', 'Arr', 'Arrhenius'),
    ('quality', 'Qual', 'Quality'),
    ('drt', 'DRT', 'DRT'),
)
# One icon per tab of the FTIR Analysis window.
SECTIONS_FTIR = (
    ('data', 'Data', 'Data & Metadata'),
    ('processing', 'Proc', 'Processing'),
    ('bands', 'Band', 'Bands'),
    ('library', 'Lib', 'Band Library'),
    ('reference', 'Ref', 'Reference Spectra'),
)
# One icon per tab of the XRD Analysis window.
SECTIONS_XRD = (
    ('phases', 'Phase', 'Phases'),
    ('databases', 'DB', 'Databases'),
    ('background', 'Bkg', 'Background'),
    ('guided', 'Guide', 'Guided fit'),
    ('advanced', 'Adv', 'Advanced'),
    ('display', 'Disp', 'Display'),
    ('structure', 'Cell', 'Unit cell'),
)
# One icon per tab of the UV-Vis Analysis window.
SECTIONS_UVVIS = (
    ('data', 'Data', 'Data & Ordinate'),
    ('tauc', 'Tauc', 'Band Gap (Tauc)'),
    ('peaks', 'Band', 'Band Maxima'),
)
# One icon per tab of the Photoluminescence Analysis window.
SECTIONS_PL = (
    ('peaks', 'Emis', 'Emission'),
    ('energy', 'eV', 'Energy Scale'),
    ('colour', 'CIE', 'CIE Colour'),
)
# One icon per tab of the Ellipsometry Analysis window.
SECTIONS_ELLIPS = (
    ('data', 'Data', 'Data & Geometry'),
    ('fit', 'Fit', 'Film Fit (Cauchy)'),
)
# One icon per tab of the Raman Analysis window.
SECTIONS_RAMAN = (
    ('peaks', 'Peak', 'Peaks & Assignment'),
    ('library', 'Lib', 'Band Library'),
)
# One icon per tab of the Mass Spectrometry Analysis window.
SECTIONS_MS = (
    ('peaks', 'Peak', 'Peaks'),
    ('assign', 'Frag', 'Losses & Adducts'),
    ('library', 'Lib', 'Ion Library'),
    ('online', 'Ref', 'Reference Library & Search-Match (NIST / MassBank)'),
)
# One icon per tab of the Gas Chromatography Analysis window.
SECTIONS_GC = (
    ('peaks', 'Int', 'Peak Integration'),
    ('report', 'Rep', 'Area Report'),
)
# EELS: the map lives on the main plot; the two icons open the toolbox tabs.
SECTIONS_EELS = (
    ('map', 'Map', 'Map & ROI tools (point / area / line, rotate, '
                   'elemental map)'),
    ('spectrum', 'Spec', 'Spectrum analysis (PSR, background, denoise)'),
)
# One icon per tab of the Dilatometry Analysis window.
SECTIONS_DIL = (
    ('data', 'Seg', 'Data & Segments'),
    ('cte', 'CTE', 'Expansion (CTE)'),
    ('sinter', 'Sint', 'Sintering'),
)
# One icon per tab of the BET / Physisorption Analysis window.
SECTIONS_BET = (
    ('bet', 'BET', 'BET Surface Area'),
    ('tplot', 't', 't-Plot'),
    ('bjh', 'BJH', 'Pore Size (BJH)'),
    ('report', 'Rep', 'Report'),
)
# ARPES: the views live in the main-window shell (main plot + right-frame
# companion), so each icon routes there — see ARPES_Analysis.open_arpes_section.
SECTIONS_ARPES = (
    ('dispersion', 'Disp', 'Dispersion (main plot)'),
    ('fs', 'FS', 'Fermi-surface companion'),
    ('stack', 'Stk', 'EDC/MDC stack companion'),
    ('cube', 'Cube', 'ARPES~3D — cut-away cube'),
    ('slices', 'Slc', 'ARPES~3D — stacked slices'),
)
SECTIONS = SECTIONS_TEM          # back-compat alias

# Hover text for each section icon, keyed (technique, section key): what the
# section does, for a first-time user. A section missing here falls back
# to its short name.
SECTION_HELP = {
    ('tem', 'calibrate'): (
        'CALIBRATE (TEM)\n'
        '\n'
        'Set the pixel size in nm (DM3/4/5 files already carry it;\n'
        'plain TIFF exports do not): type it and click Apply.\n'
        'Also brightness / contrast of the display (never the\n'
        'stored pixels) and the acquisition metadata.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tem', 'particles'): (
        'PARTICLES (TEM)\n'
        '\n'
        'Count and size particles on the image.\n'
        'How to use:\n'
        '  1. Choose dark-on-bright or bright-on-dark and a\n'
        '     detection method (Otsu, top hat, manual, blobs).\n'
        '  2. Optional: Draw ROI and drag it on the image.\n'
        '  3. Detect particles: outlines + statistics table.\n'
        'Count / Freq. sheet publish the size distribution.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tem', 'profile'): (
        'LINE PROFILE (TEM)\n'
        '\n'
        'Draw line, then click a start and an end point on the\n'
        'image to get the intensity profile along it.\n'
        '  Drag the middle  - move the line\n'
        '  Drag an end      - swing / lengthen it\n'
        '  Mouse wheel      - change the averaging width\n'
        'Detect fringe peaks gives the lattice spacing; the\n'
        'profile can be added as a TEM~Plot sheet.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tem', 'fft'): (
        'FFT (TEM)\n'
        '\n'
        'Draw region on the image, click to place it, then\n'
        'compute its FFT (power spectrum) as a TEM~FFT sheet\n'
        'calibrated in 1/nm.\n'
        '  Mouse wheel or round handle - rotate the region\n'
        '  Drag a corner               - resize it\n'
        '\n'
        'Opens this section in its own window.'),
    ('tem', 'filter'): (
        'FFT FILTER (TEM)\n'
        '\n'
        'Works on the FFT: place masks over chosen spots (click\n'
        'a spot to snap a circle/ellipse to it, or click the\n'
        'vertices of a polygon, double-click to close), then\n'
        'Inverse FFT to get a filtered image (TEM~IFFT sheet).\n'
        'Options: include the Friedel mate, keep the central\n'
        'beam, edge softening.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tem', 'measure'): (
        'MEASURE (TEM)\n'
        '\n'
        'On the FFT or a diffraction pattern:\n'
        '  Measure spot  - click a spot: d-spacing, g, azimuth\n'
        '  Measure angle - click two spots: angle between them\n'
        'Auto-detect all spots, identify the structure / hkl,\n'
        'or index against a known lattice. The FFT can also be\n'
        'inserted as an inset on the image.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tem', 'advanced'): (
        'ADVANCED MAPPING (TEM)\n'
        '\n'
        'Local FFT mapping: d-spacing and orientation maps\n'
        '(TEM~dMap, TEM~Angle sheets).\n'
        'Strain mapping (GPA) from two chosen g spots: exx,\n'
        'eyy, exy and rotation maps as new sheets.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tem', 'denoise'): (
        'DENOISE (TEM)\n'
        '\n'
        'PCA denoising of the image, line-wise or patch-based,\n'
        'on the whole image or a drawn region. Analyse shows\n'
        'the variance and loadings; Denoise writes the cleaned\n'
        'copy to a new TEM~Map sheet (the original is kept).\n'
        '\n'
        'Opens this section in its own window.'),
    ('sem', 'calibrate'): (
        'CALIBRATE (SEM)\n'
        '\n'
        'Set the pixel size (nm): type it, or click "Draw line\n'
        'across the scale bar", drag along the bar, enter its\n'
        'known length and apply.\n'
        'Also excludes the instrument databar from analysis\n'
        'and sets display brightness / contrast.\n'
        '\n'
        'Opens this section in its own window.'),
    ('sem', 'crop'): (
        'CROP (SEM)\n'
        '\n'
        'Draw crop region: drag a rectangle on the image to\n'
        'keep only that part for analysis. The pixel size is\n'
        'unchanged. Reset to full image undoes it.\n'
        '\n'
        'Opens this section in its own window.'),
    ('sem', 'detect'): (
        'DETECT PARTICLES (SEM)\n'
        '\n'
        'Choose dark or bright particles, the threshold method\n'
        '(Otsu, top-hat, manual) and min/max size, optionally\n'
        'drag a region to analyse, then Detect particles.\n'
        'Outlines are drawn on the image and the Results\n'
        'section opens.\n'
        '\n'
        'Opens this section in its own window.'),
    ('sem', 'results'): (
        'RESULTS (SEM)\n'
        '\n'
        'Mean size, statistics table and count / frequency\n'
        'histograms of the detected particles.\n'
        'Copy the statistics, add the histogram as a sheet\n'
        '(SEM~Count / SEM~Freq), or place the chart on the\n'
        'SEM image.\n'
        '\n'
        'Opens this section in its own window.'),
    ('afm', 'channels'): (
        'CHANNELS (AFM)\n'
        '\n'
        'Every channel imported from the same file (height,\n'
        'phase...): click one to display it. Choose the colour\n'
        'map, and set the scan width (um) for all channels.\n'
        '\n'
        'Opens this section in its own window.'),
    ('afm', 'level'): (
        'LEVEL (AFM)\n'
        '\n'
        'Flatten the scan in three steps, each with its own\n'
        'Apply:\n'
        '  1. Background: plane or polynomial\n'
        '  2. Align rows (median, matching, polynomial...)\n'
        '  3. Remove scars and set the zero reference\n'
        'Stored as a recipe: the raw data is never modified.\n'
        'Reset (raw data) removes it.\n'
        '\n'
        'Opens this section in its own window.'),
    ('afm', 'regions'): (
        'REGIONS & CROP (AFM)\n'
        '\n'
        'Draw rectangle, circle or freehand regions on the map\n'
        'to include in, or exclude from, the measurements.\n'
        'Move, resize, flip or delete them from the list.\n'
        'Crop: drag a rectangle to make a new AFM sheet of that\n'
        'patch (this one is left alone).\n'
        '\n'
        'Opens this section in its own window.'),
    ('afm', 'roughness'): (
        'ROUGHNESS (AFM)\n'
        '\n'
        'ISO 25178 areal roughness (Sa, Sq, Ssk, Sku, Sp, Sv,\n'
        'Sz...) and hybrid values of the levelled image, over\n'
        'the whole image or a region. Histogram and PSD appear\n'
        'in the side panel; values can be printed on the map.\n'
        '\n'
        'Opens this section in its own window.'),
    ('afm', 'particles'): (
        'GRAIN SIZE (AFM)\n'
        '\n'
        'Find grains by height: threshold (separate particles)\n'
        'or watershed (touching grains), with min/max size.\n'
        'Measure grain size draws them on the map; the size\n'
        'distribution (with Gaussian fit) is in the side panel.\n'
        'Add AFM~Grain sheet puts the per-grain table in a sheet.\n'
        '\n'
        'Opens this section in its own window.'),
    ('afm', 'profile'): (
        'PROFILE (AFM)\n'
        '\n'
        'Draw line on the map: click start and end to get the\n'
        'height profile (shown in the side panel).\n'
        '  Drag an end    - swing it\n'
        '  Drag the middle - move it\n'
        '  Mouse wheel    - change the averaging width\n'
        'Measure a feature (step, width...) on the profile, or\n'
        'add it as an AFM~Profile sheet.\n'
        '\n'
        'Opens this section in its own window.'),
    ('afm', 'force'): (
        'FORCE CURVES (AFM)\n'
        '\n'
        'Pick a pixel on the map to see its force-distance\n'
        'curve and metrics in the side panel.\n'
        'Build maps from all curves (set tip radius and\n'
        'Poisson ratio for the modulus); each becomes a new AFM\n'
        'sheet. Export curves to CSV or Excel.\n'
        '\n'
        'Opens this section in its own window.'),
    ('afm', 'view3d'): (
        '3D SURFACE (AFM)\n'
        '\n'
        'Create the AFM~3D sheet: a 3D rendering of a height\n'
        'channel with colour map, height exaggeration, hill\n'
        'shading and view angle.\n'
        'Select the AFM~3D sheet and drag on it to rotate; the\n'
        'angle is remembered.\n'
        '\n'
        'Opens this section in its own window.'),
    ('squid', 'susceptibility'): (
        'SUSCEPTIBILITY (SQUID)\n'
        '\n'
        'Enter the sample: formula (fills the molar mass), mass,\n'
        'magnetic ions per formula unit, applied field.\n'
        'Choose the normalisation and unit, then generate the\n'
        'chi, 1/chi and chi*T sheets from the M(T) scan.\n'
        '\n'
        'Opens this section in its own window.'),
    ('squid', 'fit'): (
        'CURIE-WEISS FIT (SQUID)\n'
        '\n'
        'Fit the paramagnetic range of the 1/chi sheet.\n'
        '  1. Set T min / T max, or drag the red dashed lines\n'
        '     on the main plot. "Suggest ranges" ranks windows.\n'
        '  2. Pick a model, then Fit (or Compare all models,\n'
        '     ranked by AIC).\n'
        'The fit and a summary label are drawn on the plot.\n'
        '\n'
        'Opens this section in its own window.'),
    ('squid', 'stability'): (
        'STABILITY (SQUID)\n'
        '\n'
        'Repeats the Curie-Weiss fit over a grid of T min x\n'
        'T max values and reports how much theta_CW, C, mu_eff,\n'
        'chi0 or R2 depend on the chosen range (text report).\n'
        '\n'
        'Opens this section in its own window.'),
    ('squid', 'moment'): (
        'THEORETICAL MOMENT (SQUID)\n'
        '\n'
        'Build the magnetic-ion table (element, oxidation and\n'
        'spin state, ions per formula unit), choose spin-only\n'
        'or spin-orbit, and compare the predicted mu_eff with\n'
        'the measured one.\n'
        '\n'
        'Opens this section in its own window.'),
    ('squid', 'corrections'): (
        'CORRECTIONS (SQUID)\n'
        '\n'
        'Subtract the sample-holder signal (scale / offset or\n'
        'fitted), correct core diamagnetism (value or Pascal\n'
        'constants) and demagnetisation (shape). Applied steps\n'
        'are listed in the correction chain.\n'
        '\n'
        'Opens this section in its own window.'),
    ('squid', 'zfcfc'): (
        'ZFC-FC (SQUID)\n'
        '\n'
        'Pair a ZFC and an FC scan (or Auto-pair by field),\n'
        'Analyse to find the cusp / blocking T and the\n'
        'irreversibility T, and mark them on the plot.\n'
        '\n'
        'Opens this section in its own window.'),
    ('squid', 'hysteresis'): (
        'M-H LOOP (SQUID)\n'
        '\n'
        'Analyse an M(H) loop, fit the high-field part (linear,\n'
        'approach to saturation or Langevin) and estimate a\n'
        'magnetic phase fraction from Ms.\n'
        '\n'
        'Opens this section in its own window.'),
    ('squid', 'quality'): (
        'QUALITY (SQUID)\n'
        '\n'
        'Run checks on field, signs, sample parameters, holder\n'
        'subtraction, Curie tail, fit-range dependence, loop\n'
        'closure and saturation; gives a text quality report.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tga', 'range'): (
        'RANGE (TGA)\n'
        '\n'
        'Start here. Bracket one heating ramp of the run with\n'
        'the red dashed lines (drag them on the main plot),\n'
        'optionally subtract a blank run, enter the initial mass,\n'
        'then generate the mass-vs-temperature (+ DSC) sheet\n'
        'the other sections work on.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tga', 'mass'): (
        'MASS (TGA)\n'
        '\n'
        'Set the mass basis, smooth the curve (non-destructive),\n'
        'then bracket each mass-loss step with the red lines\n'
        'and "Add mass-change region". Regions are listed in a\n'
        'table and labelled on the plot.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tga', 'dtg'): (
        'DTG (TGA)\n'
        '\n'
        'Calculate the derivative curve (DTG), detect its\n'
        'peaks (onset, peak, end temperature, mass change),\n'
        'and optionally add it as a TGA~DTG sheet.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tga', 'dsc'): (
        'DSC (TGA)\n'
        '\n'
        'Choose exo up/down and a baseline (previewed on the\n'
        'plot), then bracket a peak with the red lines and\n'
        'Integrate peak. Can add the DSC as a TGA~DSC sheet.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tga', 'heatflow'): (
        'HEAT FLOW (TGA)\n'
        '\n'
        'For DSC-only sheets: set mass and exo direction, pick\n'
        'a segment and baseline, bracket a peak with the red\n'
        'lines and integrate it (enthalpy, optional\n'
        'crystallinity %). Also measures the glass transition.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tga', 'events'): (
        'EVENTS (TGA)\n'
        '\n'
        'Detect events combines mass, DTG and DSC into one\n'
        'table of thermal events (names are editable), with\n'
        'possible readings - suggestions, not conclusions.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tga', 'chemistry'): (
        'CHEMISTRY (TGA)\n'
        '\n'
        'Oxygen non-stoichiometry (delta) from a mass change,\n'
        'and the theoretical mass change of losing a species\n'
        'compared with a measured region.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tga', 'cycles'): (
        'CYCLES (TGA)\n'
        '\n'
        'On the time-view sheet: analyse repeated cycles and\n'
        'report how much of each change is reversible and how\n'
        'much is drift.\n'
        '\n'
        'Opens this section in its own window.'),
    ('tga', 'isothermal'): (
        'ISOTHERMAL (TGA)\n'
        '\n'
        'Bracket a dwell (time range) with the red lines, fit a\n'
        'kinetic model (or try all, ranked by R2), and get an\n'
        'activation energy from all dwells (Arrhenius sheet).\n'
        '\n'
        'Opens this section in its own window.'),
    ('tga', 'compare'): (
        'COMPARE (TGA)\n'
        '\n'
        'Tick runs and overlay their mass, DTG or DSC (view\n'
        'only, data unchanged), optionally aligned on\n'
        'temperature. The difference can be added as a sheet.\n'
        '\n'
        'Opens this section in its own window.'),
    ('eis', 'intercept'): (
        'INTERCEPTS (EIS)\n'
        '\n'
        'Bracket part of the Nyquist arc with the red dashed\n'
        "lines (drag them, or type Z' min/max) and find where\n"
        'it crosses the real axis: ohmic, total and\n'
        'polarisation resistance.\n'
        'Also inspect points and remove outliers.\n'
        '\n'
        'Opens this section in its own window.'),
    ('eis', 'circuit'): (
        'CIRCUIT FIT (EIS)\n'
        '\n'
        'Fit an equivalent circuit (type a code or build one)\n'
        'to the selected range. Guess start values from the\n'
        'data, fix parameters, fit this or all spectra. A\n'
        'schematic can be added to the plot or saved as PNG.\n'
        '\n'
        'Opens this section in its own window.'),
    ('eis', 'batch'): (
        'BATCH (EIS)\n'
        '\n'
        'Fit the same circuit to every ticked sweep in one go,\n'
        'optionally seeding each fit from the previous one.\n'
        'Results table can be exported as CSV.\n'
        '\n'
        'Opens this section in its own window.'),
    ('eis', 'normalise'): (
        'NORMALISATION (EIS)\n'
        '\n'
        'Say what kind of cell it is (full, symmetric, single\n'
        'electrode) and the electrode area, to express the\n'
        'resistances in ohm, ohm.cm2 or per electrode.\n'
        '\n'
        'Opens this section in its own window.'),
    ('eis', 'sigma'): (
        'CONDUCTIVITY (EIS)\n'
        '\n'
        'Enter thickness and area and choose the resistance\n'
        '(intercepts, fit or typed) to calculate conductivity,\n'
        'resistivity and area-specific resistance (ASR).\n'
        '\n'
        'Opens this section in its own window.'),
    ('eis', 'arrhenius'): (
        'ARRHENIUS (EIS)\n'
        '\n'
        'Tick sweeps measured at several temperatures and fit\n'
        'the activation energy; creates an EIS~Arrhenius sheet.\n'
        '\n'
        'Opens this section in its own window.'),
    ('eis', 'quality'): (
        'QUALITY (EIS)\n'
        '\n'
        'Kramers-Kronig consistency test (verdict and residual\n'
        'sheet) and Bode sheet, to check the data is valid\n'
        'before fitting.\n'
        '\n'
        'Opens this section in its own window.'),
    ('eis', 'drt'): (
        'DRT (EIS)\n'
        '\n'
        'Distribution of relaxation times: Run DRT creates an\n'
        'EIS~DRT sheet; detect and integrate its peaks, run it\n'
        'on many spectra, and export the results as CSV.\n'
        '\n'
        'Opens this section in its own window.'),
    ('ftir', 'data'): (
        'DATA & METADATA (FTIR)\n'
        '\n'
        'Say what the Y data are (or Auto-detect), choose the\n'
        'display unit, and fill in the measurement details\n'
        '(mode, atmosphere, ATR crystal...). These feed band\n'
        'assignment, ATR correction and reference matching.\n'
        '\n'
        'Opens this section in its own window.'),
    ('ftir', 'processing'): (
        'PROCESSING (FTIR)\n'
        '\n'
        'Clean the spectrum step by step (spikes, atmosphere,\n'
        'ATR, baseline, smoothing, normalisation): tick steps\n'
        'on or off, double-click to edit, or use Auto Clean.\n'
        'The raw data is never changed; Reset to raw undoes\n'
        'all, Ctrl+Z the last change.\n'
        '\n'
        'Opens this section in its own window.'),
    ('ftir', 'bands'): (
        'BANDS (FTIR)\n'
        '\n'
        'Find Bands detects the bands and proposes ranked\n'
        'assignments with confidence and artefact risk.\n'
        'Double-click a candidate to accept and lock it, then\n'
        'Label Bands on Plot.\n'
        '\n'
        'Opens this section in its own window.'),
    ('ftir', 'library'): (
        'BAND LIBRARY (FTIR)\n'
        '\n'
        'Searchable IR correlation table: wavenumber range,\n'
        'vibration, intensity / shape and assignment.\n'
        '\n'
        'Opens this section in its own window.'),
    ('ftir', 'reference'): (
        'REFERENCE SPECTRA (FTIR)\n'
        '\n'
        'Add reference spectra to the project as FTIR sheets:\n'
        'from the local JCAMP-DX library, fetched from the NIST\n'
        'WebBook by name or CAS, or from online / OMNIC\n'
        'libraries.\n'
        '\n'
        'Opens this section in its own window.'),
    ('xrd', 'phases'): (
        'PHASES (XRD)\n'
        '\n'
        'The crystal phases in the model: import / export CIF,\n'
        'edit space group and unit cell, add or remove atom\n'
        'sites (e.g. a dopant), and set element colours.\n'
        '\n'
        'Opens this section in its own window.'),
    ('xrd', 'databases'): (
        'DATABASES (XRD)\n'
        '\n'
        'Find phases in COD, Materials Project (API key needed)\n'
        'or your CIF folder, filtered by elements or formula.\n'
        'Run Search-Match ranks candidates against the measured\n'
        'pattern; Use as Phase adds one to the model.\n'
        '\n'
        'Opens this section in its own window.'),
    ('xrd', 'background'): (
        'BACKGROUND (XRD)\n'
        '\n'
        'Automatic (Chebyshev, refined) or manual baseline.\n'
        'With "Pick points on main plot" on:\n'
        '  Left-click  - add an anchor point\n'
        '  Right-click - remove the nearest point\n'
        'Auto points seeds points from the pattern valleys.\n'
        '\n'
        'Opens this section in its own window.'),
    ('xrd', 'guided'): (
        'GUIDED FIT (XRD)\n'
        '\n'
        'Refine step by step (instrument, phase, background,\n'
        'peak positions, profile, intensities, validation).\n'
        'Run a step, then Accept or Reject & restore. Every run\n'
        'is a checkpoint you can go back to.\n'
        '\n'
        'Opens this section in its own window.'),
    ('xrd', 'advanced'): (
        'ADVANCED REFINEMENT (XRD)\n'
        '\n'
        'Full control: instrument (Ka1/Ka2), Le Bail or\n'
        'Rietveld, and tick which parameters are refined (cell,\n'
        'scale, profile, displacement, size, strain...).\n'
        'Refine runs the fit; Reset fit returns to raw data.\n'
        '\n'
        'Opens this section in its own window.'),
    ('xrd', 'display'): (
        'DISPLAY (XRD)\n'
        '\n'
        'Choose what is drawn on the main plot (calculated\n'
        'pattern, background, difference, reflection ticks)\n'
        'and their colours, then Apply.\n'
        '\n'
        'Opens this section in its own window.'),
    ('xrd', 'structure'): (
        'UNIT CELL (XRD)\n'
        '\n'
        '3D model of the selected phase: atoms in element\n'
        'colours, cell edges, optional bonds and labels. Stack\n'
        'cells into a supercell and save the picture.\n'
        '\n'
        'Opens this section in its own window.'),
    ('uvvis', 'data'): (
        'DATA & ORDINATE (UV-VIS)\n'
        '\n'
        'Choose the sheet and say what the y-axis holds\n'
        '(absorbance, transmittance or reflectance %). Create\n'
        'absorbance sheet converts T to -log10(T), or R to\n'
        'Kubelka-Munk F(R).\n'
        '\n'
        'Opens this section in its own window.'),
    ('uvvis', 'tauc'): (
        'BAND GAP - TAUC (UV-VIS)\n'
        '\n'
        '  1. Pick the transition type, then create the\n'
        '     UVvis~Tauc sheet (nm to eV).\n'
        '  2. Set the linear window: type From/To, drag the\n'
        '     red lines, or "Suggest window".\n'
        '  3. Fit band gap: Eg and the extrapolation line.\n'
        'The Tauc plot can be inserted as an inset.\n'
        '\n'
        'Opens this section in its own window.'),
    ('uvvis', 'peaks'): (
        'BAND MAXIMA (UV-VIS)\n'
        '\n'
        'Find band maxima lists the absorption peaks with\n'
        'wavelength (nm), energy (eV), value and prominence.\n'
        '\n'
        'Opens this section in its own window.'),
    ('pl', 'peaks'): (
        'EMISSION (PL)\n'
        '\n'
        'Measure emission: peak position (nm and eV),\n'
        'centroid, FWHM and integrated intensity, read off the\n'
        'curve (no model fit). Can label the peak on the plot.\n'
        '\n'
        'Opens this section in its own window.'),
    ('pl', 'energy'): (
        'ENERGY SCALE (PL)\n'
        '\n'
        'Create a PL~eV sheet plotted against photon energy,\n'
        'with the Jacobian correction so peak shape and\n'
        'position stay right.\n'
        '\n'
        'Opens this section in its own window.'),
    ('pl', 'colour'): (
        'CIE COLOUR (PL)\n'
        '\n'
        'Compute the CIE 1931 (x, y) chromaticity of the\n'
        'emission (380-730 nm) with a colour swatch.\n'
        '\n'
        'Opens this section in its own window.'),
    ('ellips', 'data'): (
        'DATA & GEOMETRY (ELLIPSOMETRY)\n'
        '\n'
        'Choose the sheet, the angle of incidence and the\n'
        'substrate (Si, fused silica, BK7 or custom n, k).\n'
        '\n'
        'Opens this section in its own window.'),
    ('ellips', 'fit'): (
        'FILM FIT - CAUCHY (ELLIPSOMETRY)\n'
        '\n'
        'Fits one transparent film to the measured Psi and\n'
        'Delta: set the thickness range and Cauchy start\n'
        'values, then "Scan thickness and fit". Gives thickness,\n'
        'n(632.8 nm) and misfit; writes an Ellips~n sheet.\n'
        '\n'
        'Opens this section in its own window.'),
    ('raman', 'peaks'): (
        'PEAKS & ASSIGNMENT (RAMAN)\n'
        '\n'
        'Find peaks, or use the peaks fitted in the grid, then\n'
        'get ranked assignments from the band database.\n'
        'Select a peak, accept a candidate, and label the plot.\n'
        'Sample details (material, laser...) are entered here.\n'
        '\n'
        'Opens this section in its own window.'),
    ('raman', 'library'): (
        'BAND LIBRARY (RAMAN)\n'
        '\n'
        'Searchable table of Raman bands. Search by text (e.g.\n'
        'anatase, D band) or by a shift in cm-1 (e.g. 520).\n'
        '\n'
        'Opens this section in its own window.'),
    ('ms', 'peaks'): (
        'PEAKS (MS)\n'
        '\n'
        'Find peaks lists m/z, relative intensity and an\n'
        'interpretation (losses, fragments, isotopes,\n'
        'background ions). Optionally give the parent mass.\n'
        'Label plot adds the results on the spectrum.\n'
        '\n'
        'Opens this section in its own window.'),
    ('ms', 'assign'): (
        'LOSSES & ADDUCTS (MS)\n'
        '\n'
        'Look up a mass difference (gap between two peaks) or a\n'
        'peak m/z against neutral losses and adducts, and find\n'
        'loss / adduct series among the detected peaks.\n'
        '\n'
        'Opens this section in its own window.'),
    ('ms', 'library'): (
        'ION LIBRARY (MS)\n'
        '\n'
        'The whole interpretation library in one searchable\n'
        'table: neutral losses, adducts, EI fragments and\n'
        'background ions.\n'
        '\n'
        'Opens this section in its own window.'),
    ('ms', 'online'): (
        'REFERENCE LIBRARY & SEARCH-MATCH (MS)\n'
        '\n'
        'Find reference spectra (NIST WebBook, MassBank or your\n'
        'local library), download them, add one as an MS sheet,\n'
        'and Run Search-Match to rank the local library against\n'
        'the measured spectrum.\n'
        '\n'
        'Opens this section in its own window.'),
    ('gc', 'peaks'): (
        'PEAK INTEGRATION (GC)\n'
        '\n'
        'Integrate peaks valley-to-valley above a straight\n'
        'local baseline: retention time, height, area, area %\n'
        'and FWHM. Label plot marks RT and area % on each peak.\n'
        '\n'
        'Opens this section in its own window.'),
    ('gc', 'report'): (
        'AREA REPORT (GC)\n'
        '\n'
        'Plain-text area-percent report of the integrated\n'
        'peaks; refresh it or copy it to the clipboard.\n'
        '\n'
        'Opens this section in its own window.'),
    ('eels', 'map'): (
        'MAP & ROI TOOLS (EELS)\n'
        '\n'
        'Show the LL, HL or ADF map on the main plot, then pick\n'
        'where spectra come from:\n'
        '  Point - click a pixel (mouse wheel: box size)\n'
        '  Area  - drag a rectangle\n'
        '  Line  - drag a line\n'
        'Pin spectra freezes them as sheets. Map signal draws a\n'
        'background-subtracted elemental map.\n'
        '\n'
        'Opens the EELS toolbox on its Map tab.'),
    ('eels', 'spectrum'): (
        'SPECTRUM ANALYSIS (EELS)\n'
        '\n'
        'Plural-scattering removal (Fourier-log / Fourier-\n'
        'ratio), power-law background subtraction to a new\n'
        'sheet, spectral denoising and peak fitting of the\n'
        'chosen spectrum sheet.\n'
        '\n'
        'Opens the EELS toolbox on its Spectrum tab.'),
    ('dil', 'data'): (
        'DATA & SEGMENTS (DILATOMETRY)\n'
        '\n'
        'Splits the run into heating, cooling and dwell\n'
        'segments and writes any of them (or all) as its own\n'
        'DIL~Heat / DIL~Cool / DIL~Iso sheet.\n'
        '\n'
        'Opens this section in its own window.'),
    ('dil', 'cte'): (
        'EXPANSION - CTE (DILATOMETRY)\n'
        '\n'
        'On a single heating or cooling segment: mean CTE\n'
        'between T1 and T2, and the differential CTE alpha(T)\n'
        'as a DIL~Alpha sheet.\n'
        '\n'
        'Opens this section in its own window.'),
    ('dil', 'sinter'): (
        'SINTERING (DILATOMETRY)\n'
        '\n'
        'Maximum expansion, shrinkage onset, maximum shrinkage\n'
        'rate and total shrinkage; can mark them on the plot.\n'
        '\n'
        'Opens this section in its own window.'),
    ('bet', 'bet'): (
        'BET SURFACE AREA\n'
        '\n'
        'Set the P/P0 window (default 0.05-0.30) and Fit BET:\n'
        'surface area (m2/g), Qm, C, R2 and the Rouquerol\n'
        'limit. Can create a BET~Plot sheet of the transform.\n'
        '\n'
        'Opens this section in its own window.'),
    ('bet', 'tplot'): (
        't-PLOT (BET)\n'
        '\n'
        'Fit the Harkins-Jura t-plot over a thickness window to\n'
        'get the external surface area and micropore volume;\n'
        'can create a BET~tPlot sheet.\n'
        '\n'
        'Opens this section in its own window.'),
    ('bet', 'bjh'): (
        'PORE SIZE - BJH (BET)\n'
        '\n'
        'Run BJH on the desorption (or adsorption) branch for\n'
        'the pore-size distribution; can create a BET~Pore\n'
        'sheet of dV/dlog(D) vs pore diameter.\n'
        '\n'
        'Opens this section in its own window.'),
    ('bet', 'report'): (
        'REPORT (BET)\n'
        '\n'
        'Plain-text summary of the BET, t-plot and BJH results;\n'
        'refresh it or copy it to the clipboard.\n'
        '\n'
        'Opens this section in its own window.'),
    ('arpes', 'dispersion'): (
        'DISPERSION (ARPES)\n'
        '\n'
        'Shows the dispersion map on the main plot, with EDC /\n'
        'MDC profiles and crosshairs.\n'
        '  Left-drag       - move the nearest crosshair\n'
        '  Right-drag      - move crosshair 2 (if shown)\n'
        '  Ctrl+arrows     - nudge crosshair 1\n'
        '  Ctrl+Shift+arrows - nudge crosshair 2\n'
        '\n'
        'Also opens the ARPES control window.'),
    ('arpes', 'fs'): (
        'FERMI SURFACE (ARPES)\n'
        '\n'
        'Switches the right-hand panel to the Fermi surface:\n'
        'the constant-energy cut at crosshair 1 energy.\n'
        'Energy window, k conversion and Brillouin-zone overlay\n'
        'are set in the ARPES control window.'),
    ('arpes', 'stack'): (
        'EDC/MDC STACK (ARPES)\n'
        '\n'
        'Switches the right-hand panel to the EDC or MDC\n'
        'waterfall (stack of curves). Type, number of curves\n'
        'and offset are set in the ARPES control window.'),
    ('arpes', 'cube'): (
        '3D CUT-AWAY CUBE (ARPES)\n'
        '\n'
        'Shows the ARPES~3D sheet as a cut-away cube on the\n'
        'main plot; the cuts follow the crosshair and the polar\n'
        'slider. Drag on the plot to rotate.\n'
        '\n'
        'Needs a 3D dataset (ARPES~3D sheet).'),
    ('arpes', 'slices'): (
        '3D STACKED SLICES (ARPES)\n'
        '\n'
        'Shows the ARPES~3D sheet as stacked constant-energy\n'
        'planes on the main plot. Drag on the plot to rotate.\n'
        '\n'
        'Needs a 3D dataset (ARPES~3D sheet).'),
}


def _technique_sections(technique):
    """(sections tuple, open-section callback) for a technique key."""
    if technique == 'tem':
        from libraries.ToolsMenu.TEM_Analysis import open_tem_section
        return SECTIONS_TEM, open_tem_section
    if technique == 'sem':
        from libraries.ToolsMenu.SEM_Analysis import open_sem_section
        return SECTIONS_SEM, open_sem_section
    if technique == 'afm':
        from libraries.ToolsMenu.AFM_Analysis import open_afm_section
        return SECTIONS_AFM, open_afm_section
    if technique == 'squid':
        from libraries.ToolsMenu.SQUID_Analysis import open_squid_section
        return SECTIONS_SQUID, open_squid_section
    if technique == 'tga':
        from libraries.ToolsMenu.TGA_Analysis import open_tga_section
        return SECTIONS_TGA, open_tga_section
    if technique == 'eis':
        from libraries.ToolsMenu.EIS_Analysis import open_eis_section
        return SECTIONS_EIS, open_eis_section
    if technique == 'ftir':
        from libraries.ToolsMenu.FTIR_Analysis import open_ftir_section
        return SECTIONS_FTIR, open_ftir_section
    if technique == 'xrd':
        from libraries.ToolsMenu.XRD_Analysis import open_xrd_section
        return SECTIONS_XRD, open_xrd_section
    if technique == 'eels':
        from libraries.ToolsMenu.EELS_Analysis import open_eels_section
        return SECTIONS_EELS, open_eels_section
    if technique == 'arpes':
        from libraries.ToolsMenu.ARPES_Analysis import open_arpes_section
        return SECTIONS_ARPES, open_arpes_section
    if technique == 'uvvis':
        from libraries.ToolsMenu.UVVIS_Analysis import open_uvvis_section
        return SECTIONS_UVVIS, open_uvvis_section
    if technique == 'pl':
        from libraries.ToolsMenu.PL_Analysis import open_pl_section
        return SECTIONS_PL, open_pl_section
    if technique == 'ellips':
        from libraries.ToolsMenu.Ellips_Analysis import open_ellips_section
        return SECTIONS_ELLIPS, open_ellips_section
    if technique == 'raman':
        from libraries.ToolsMenu.Raman_Analysis import open_raman_section
        return SECTIONS_RAMAN, open_raman_section
    if technique == 'ms':
        from libraries.ToolsMenu.MS_Analysis import open_ms_section
        return SECTIONS_MS, open_ms_section
    if technique == 'gc':
        from libraries.ToolsMenu.GC_Analysis import open_gc_section
        return SECTIONS_GC, open_gc_section
    if technique == 'dil':
        from libraries.ToolsMenu.DIL_Analysis import open_dil_section
        return SECTIONS_DIL, open_dil_section
    if technique == 'bet':
        from libraries.ToolsMenu.BET_Analysis import open_bet_section
        return SECTIONS_BET, open_bet_section
    return (), None


WHITE = wx.Colour(255, 255, 255)
# Drawn to match the ID / BE / AI buttons, the toolbar's other lettered tiles:
# a green square with a 1 px dark frame and the drawing on it in dark strokes
# 3-4 px wide. Dark on green, not white on green - mapping ID-25 pixel by
# pixel there is no white in it at all.
GLYPH_WIDTH = 3          # the drawing, at the weight the ID glyph is drawn
DETAIL_WIDTH = 2         # secondary strokes, a step lighter
BORDER_WIDTH = 1         # the tile frame, as on ID-25
CORNER = 4.0             # corner radius at 25 px


def _glyph_path(gc, points, close=False):
    path = gc.CreatePath()
    path.MoveToPoint(*points[0])
    for point in points[1:]:
        path.AddLineToPoint(*point)
    if close:
        path.CloseSubpath()
    return path


def _draw_glyph(gc, name, size):
    """Draw one pictogram on the tile, in dark strokes.

    Coordinates are written for a 25 px icon and scaled, so one drawing serves
    any toolbar size. Shapes are few and large: at 25 px with a 3 px stroke
    there is room for three or four strokes, not a diagram.
    """
    k = size / 25.0

    def P(x, y):
        return x * k, y * k

    def width(scale):
        return max(1, int(round(scale * k)))    # wx.Pen takes an int width

    ink = wx.Pen(BORDER, width(GLYPH_WIDTH))
    ink.SetCap(wx.CAP_ROUND)
    ink.SetJoin(wx.JOIN_ROUND)
    detail = wx.Pen(BORDER, width(DETAIL_WIDTH))
    detail.SetCap(wx.CAP_ROUND)
    gc.SetPen(ink)
    gc.SetBrush(wx.TRANSPARENT_BRUSH)

    if name == 'channels':
        # Two channel images, one behind the other.
        gc.SetPen(detail)
        gc.DrawRectangle(*P(10, 4), 11 * k, 11 * k)
        gc.SetPen(ink)
        gc.DrawRectangle(*P(4, 10), 11 * k, 11 * k)
    elif name == 'level':
        # A tilted plane taken down to a flat baseline.
        gc.StrokeLine(*P(3.5, 9), *P(21.5, 4))
        gc.SetPen(detail)
        gc.StrokeLine(*P(3.5, 21), *P(21.5, 21))
        gc.StrokeLine(*P(12.5, 11), *P(12.5, 18))
        gc.StrokeLines([P(9.5, 15), P(12.5, 18.5), P(15.5, 15)])
    elif name == 'rows':
        # Scan lines, one out of step - what row alignment fixes.
        for i, (x0, x1) in enumerate(((4, 21), (8, 21), (4, 21), (4, 17))):
            gc.StrokeLine(*P(x0, 5 + i * 5), *P(x1, 5 + i * 5))
    elif name == 'roughness':
        # A height histogram over its baseline.
        for x, top in ((6, 14), (11, 6), (16, 11), (20, 16)):
            gc.StrokeLine(*P(x, top), *P(x, 19.5))
        gc.SetPen(detail)
        gc.StrokeLine(*P(3.5, 21), *P(21.5, 21))
    elif name == 'grains':
        # Marked grains in a frame.
        gc.SetPen(detail)
        gc.DrawRectangle(*P(3, 3), 19 * k, 19 * k)
        gc.SetPen(ink)
        for x, y, r in ((8.5, 9, 3.2), (16.5, 8.5, 2.6), (12, 17, 3.4)):
            gc.DrawEllipse(*P(x - r, y - r), 2 * r * k, 2 * r * k)
    elif name == 'surface':
        # Relief seen in perspective.
        gc.DrawPath(_glyph_path(gc, [P(3, 15), P(12.5, 10), P(22, 15),
                                     P(12.5, 20.5)], close=True))
        gc.SetPen(detail)
        gc.DrawPath(_glyph_path(gc, [P(5, 11), P(9, 4.5), P(13, 9.5),
                                     P(17, 4.5), P(20.5, 8.5)]))
    elif name == 'profile':
        # A line across an image, and the section it cuts.
        gc.SetPen(detail)
        gc.DrawRectangle(*P(3, 3), 19 * k, 9 * k)
        gc.SetPen(ink)
        gc.StrokeLine(*P(5, 10), *P(20, 5))
        gc.DrawPath(_glyph_path(gc, [P(3.5, 21.5), P(7.5, 21.5), P(10, 15.5),
                                     P(14, 15.5), P(16.5, 21.5),
                                     P(21.5, 21.5)]))
    elif name == 'force':
        # An approach/retract curve with its pull-off hook.
        gc.SetPen(detail)
        gc.StrokeLine(*P(3.5, 3), *P(3.5, 21.5))
        gc.StrokeLine(*P(3.5, 21.5), *P(21.5, 21.5))
        gc.SetPen(ink)
        path = gc.CreatePath()
        path.MoveToPoint(*P(5, 11))
        path.AddLineToPoint(*P(11, 11))
        path.AddCurveToPoint(*P(14, 11), *P(14, 19), *P(16, 19))
        path.AddCurveToPoint(*P(18.5, 19), *P(18, 5), *P(21, 5))
        gc.StrokePath(path)
    elif name == 'roi':
        # Two regions on an image: one kept, one left out.
        gc.SetPen(detail)
        gc.DrawRectangle(*P(3, 3), 19 * k, 19 * k)
        gc.SetPen(ink)
        gc.DrawRectangle(*P(6, 6), 8 * k, 7 * k)
        dashed = wx.Pen(BORDER, width(GLYPH_WIDTH), wx.PENSTYLE_SHORT_DASH)
        gc.SetPen(dashed)
        gc.DrawEllipse(*P(12.5, 13), 7 * k, 7 * k)
    else:
        return False
    return True


def make_section_icon(text, green=True, size=25, glyph=None):
    """A section button: the theme's rounded green tile carrying a drawing or
    a short text label.

    The tile is what the ID, BE and AI buttons are - a green square with a
    thin dark frame - so a section button reads as one of the toolbar's own.
    An unknown glyph name falls back to the text, so a typo costs a plain
    button rather than a blank one.
    """
    try:
        bmp = wx.Bitmap.FromRGBA(size, size, 0, 0, 0, 0)   # transparent corners
    except Exception:
        bmp = wx.Bitmap(size, size)
    dc = wx.MemoryDC(bmp)
    gc = wx.GraphicsContext.Create(dc)
    if gc:
        edge = max(1, int(round(BORDER_WIDTH * size / 25.0)))
        # A drawn section is always green; only the lettered fallbacks
        # alternate, which is what kept three-letter tiles apart before there
        # were pictures to tell them apart.
        gc.SetBrush(wx.Brush(BRAND if (glyph or green) else GREY))
        gc.SetPen(wx.Pen(BORDER, edge))
        inset = edge / 2.0 + 0.5
        gc.DrawRoundedRectangle(inset, inset, size - 2 * inset,
                                size - 2 * inset, CORNER * size / 25.0)
        drawn = False
        if glyph:
            try:
                drawn = _draw_glyph(gc, glyph, size)
            except Exception as e:
                print(f'section glyph {glyph!r} skipped: {e}')
        if not drawn:
            # Fit the label to the tile rather than guessing a size from its
            # length: 'Chan' and 'Prof' are both four characters and one of
            # them is a third wider, so a fixed point size clips one label and
            # leaves the other floating. Largest size that fits wins.
            room = size - 4.0 * size / 25.0
            tw = th = 0
            for point in range(8, 4, -1):
                gc.SetFont(wx.Font(point, wx.FONTFAMILY_DEFAULT,
                                   wx.FONTSTYLE_NORMAL, wx.FONTWEIGHT_BOLD),
                           BORDER)
                tw, th = gc.GetTextExtent(text)
                if tw <= room:
                    break
            gc.DrawText(text, (size - tw) / 2.0, (size - th) / 2.0)
    dc.SelectObject(wx.NullBitmap)
    return bmp


def register_toolbar_tools(window, toolbar, xps_tools, technique_tool):
    """Record which tools the TEM mode hides, and where the sections go.

    ``xps_tools`` is the ordered list of tool objects (and control tools) that
    only make sense for a spectrum; ``technique_tool`` is the shared technique
    button — the section icons are inserted just after it.
    """
    window._toolbar = toolbar
    window._xps_only_tools = [t for t in xps_tools if t is not None]
    window._technique_tool = technique_tool
    window._xps_hidden = []
    window._section_tool_ids = []
    window._tb_technique = None


def _hide_xps(window, toolbar):
    pairs = []
    for tool in getattr(window, '_xps_only_tools', []):
        pos = toolbar.GetToolPos(tool.GetId())
        if pos != wx.NOT_FOUND:
            pairs.append((tool, pos))
    # Remove from the highest position down, so the recorded positions of the
    # tools not yet removed stay valid.
    for tool, _pos in sorted(pairs, key=lambda tp: -tp[1]):
        try:
            # A control tool (the BE-correction spin box) keeps its widget on
            # the bar after RemoveTool — the tool entry goes but the child
            # window lingers, so hide it explicitly.
            if tool.IsControl():
                ctrl = tool.GetControl()
                if ctrl:
                    ctrl.Hide()
            toolbar.RemoveTool(tool.GetId())
        except Exception:
            pass
    window._xps_hidden = pairs


def _restore_xps(window, toolbar):
    # Insert lowest position first, so each tool refills its original slot.
    for tool, pos in sorted(getattr(window, '_xps_hidden', []),
                            key=lambda tp: tp[1]):
        try:
            toolbar.InsertTool(min(pos, toolbar.GetToolsCount()), tool)
        except Exception:
            try:
                toolbar.AddTool(tool)
            except Exception:
                pass
        try:
            if tool.IsControl():           # re-show the BE-correction spin box
                ctrl = tool.GetControl()
                if ctrl:
                    ctrl.Show()
        except Exception:
            pass
    window._xps_hidden = []


def _add_sections(window, toolbar, technique):
    sections, opener = _technique_sections(technique)
    if not sections or opener is None:
        window._section_tool_ids = []
        return
    tech = getattr(window, '_technique_tool', None)
    pos = (toolbar.GetToolPos(tech.GetId()) + 1) if tech else toolbar.GetToolsCount()
    label_up = technique.upper()
    ids = []
    for i, section in enumerate(sections):
        # A section may carry a fourth item, the name of a drawn glyph; the
        # ones that do not still get their short text label.
        key, label, full = section[:3]
        glyph = section[3] if len(section) > 3 else None
        bmp = make_section_icon(label, green=(i % 2 == 0), glyph=glyph)
        tip = SECTION_HELP.get((technique, key),
                               f'{full} — open this {label_up} '
                               f'section in its own window')
        tool = toolbar.InsertTool(pos, wx.ID_ANY, full, bmp, shortHelp=tip)
        window.Bind(wx.EVT_TOOL,
                    lambda e, k=key, op=opener: op(window, k), tool)
        ids.append(tool.GetId())
        pos += 1
    window._section_tool_ids = ids


def _remove_sections(window, toolbar):
    for tid in getattr(window, '_section_tool_ids', []):
        try:
            toolbar.DeleteTool(tid)          # recreated fresh next time
        except Exception:
            pass
    window._section_tool_ids = []


def apply_technique_toolbar(window, technique):
    """Switch the toolbar to a technique's slim form, or back to full XPS.

    ``technique`` is None (XPS — the full toolbar), 'tem' or 'sem'. The XPS
    tools are hidden only when leaving XPS and restored only on returning to
    it, so a TEM<->SEM switch just swaps the section icons.
    """
    toolbar = getattr(window, '_toolbar', None) or getattr(window, 'toolbar', None)
    if toolbar is None or not hasattr(window, '_xps_only_tools'):
        return
    current = getattr(window, '_tb_technique', None)
    if technique == current:
        return
    try:
        _remove_sections(window, toolbar)
        if current is None and technique is not None:
            _hide_xps(window, toolbar)
        elif current is not None and technique is None:
            _restore_xps(window, toolbar)
        if technique is not None:
            _add_sections(window, toolbar, technique)
        toolbar.Realize()
        window._tb_technique = technique
    except Exception as e:
        print(f'Technique toolbar switch skipped: {e}')
