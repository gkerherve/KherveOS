// Guides of the technique apps (src/apps/khervetech: kTGA, kBET, kUVVis, kFTIR,
// kRaman, kDilatometer, and kAFM / kTEM / kEDX when they come).
//
// ADDING A TECHNIQUE'S GUIDE IS ONE ENTRY IN THE LIST BELOW: copy a neighbour,
// change the words. What every technique app has in common (the .kfit project
// written next to the imported file, examples copied to
// ~/Documents/<name> Examples, the Analysis window whose tabs `<app>_run`
// presses, get_results, export) is added for you, so write only what is
// particular: its sheets and units, the analyses in the order to use them, the
// pitfalls. tools/tests/app-guides.test.ts checks that each `run` action of the
// app's manifest (src/os/ai/manifests/<app>.ts) is mentioned.

import type { AppGuide } from './core.ts'

interface TechniqueGuide {
  /** The registry id, e.g. "kherveftir". */
  app: string
  /** As people write it, e.g. "kFTIR": the examples folder is "~/Documents/<name> Examples". */
  name: string
  use: string
  about: string
  /** The sheets (measured and derived), the units and axes, where results are stored. */
  concepts: string[]
  /** The analyses in the order to use them: the `run` actions with their ranges. The open / list / results / export steps are added around it. */
  analyses: string[]
  pitfalls?: string[]
  with?: [app: string, how: string][]
}

function technique(t: TechniqueGuide): AppGuide {
  const a = t.app
  return {
    app: a,
    use: t.use,
    about: t.about,
    writes: ['a .kfit project next to the imported file (File > Import does the same)', 'CSV / TXT / DAT columns of one sheet, PNG / SVG of the plot (`' + a + '_export`)'],
    concepts: [
      ...t.concepts,
      `Analyses are the tabs of the Analysis window docked on the right; \`${a}_run\` with an "action" presses that tab's button (one undo step) and returns the window's messages and result boxes. \`${a}_get_results\` returns the numbers stored on a sheet.`,
    ],
    workflow: [
      `\`${a}_open_example\` (no name lists the examples; they are copied to ~/Documents/${t.name} Examples) or \`${a}_open_file\` with the user's file (~/…): a raw file is imported and a .kfit project written next to it.`,
      `\`${a}_list_sheets\` shows the sheets and the one on the plot; \`${a}_select_sheet\` changes it (or pass "sheet" to \`${a}_run\`).`,
      ...t.analyses,
      `\`${a}_get_results\` for the numbers (read them, do not copy them from a screenshot), then \`${a}_export\` (format kfit to save the project; csv / txt / dat with "sheet" for the columns) or hand the CSV to kPlot / kSheet.`,
    ],
    pitfalls: [
      ...(t.pitfalls ?? []),
      'A .kfit that holds another technique\'s sheets is handed on to that technique\'s app.',
      'Raw .csv / .txt files double-click into kSheet / kText: use this app\'s open_file to import them as spectra.',
    ],
    with: t.with,
  }
}

export const TECHNIQUE_GUIDES: AppGuide[] = [
  technique({
    app: 'khervetga',
    name: 'kTGA',
    use: 'Thermogravimetry / DSC / STA curves: mass-loss steps, DTG, DSC enthalpies, cycles, kinetics, Tg',
    about:
      'TGA / DSC / STA analysis (the TGA technique of KherveFitting-AI): mass steps, DTG peaks, DSC enthalpy, events, redox cycles, isothermal kinetics with Arrhenius, oxygen non-stoichiometry, and heat-flow DSC (melting, glass transition) from TA TRIOS .tri files.',
    concepts: [
      'Sheets: measured runs are TGA, TGA1, …; derived sheets TGA~Mass (from `generate`), TGA~DTG, TGA~DSC, TGA~Kinetics, TGA~Arrhenius, TGA~Diff.',
      'Axes and units: temperature in °C, time in min, mass in mg or as a % after normalisation. low / high are °C in the temperature view, minutes for `generate` and `isothermal`.',
      'Mass basis (options.normalisation / options.basis): "% of mass at range start", "% of initial mass", "Raw mass (mg)", "% of dry mass"…; give options.initial_mass in mg.',
      'DSC baselines (options.baseline): "Straight", "Tangential", "Sigmoidal", "Polynomial", "Manual anchors", "Blank subtracted". Heat-flow DSC (.tri) gives J/g enthalpies; options.mass is the sample mass in mg.',
    ],
    analyses: [
      '`khervetga_run` action `generate` first: low / high = the time range (min) of one ramp, options.initial_mass, options.normalisation. It makes TGA~Mass, which the other analyses use.',
      'Each mass loss: action `mass_step` with low / high = its temperature range (°C) and options.name; it adds a region (table row and plot label). `smooth` (Savitzky-Golay, width in points) if the curve is noisy, `normalise` to change the basis (dry mass, molar mass), `theoretical` to compare with an expected mass change (options.host formula, options.species such as H2O, options.n).',
      'Derivative: action `dtg` (options.mode "dm/dT"), then `dtg_peaks` (options.sensitivity, % of the largest peak). Heat: `dsc_area` with low / high around the DSC peak and options.baseline gives the enthalpy; `events` detects events from mass, DTG and DSC together.',
      'Special runs: `cycles` (reversible / irreversible split over repeated cycles, on a time-view run); `isothermal` on one dwell (options.model, or "all" to rank the models) and `arrhenius` over the dwells of a stepped-isothermal run (activation energy); `oxygen` for oxygen non-stoichiometry δ of an oxide (options.formula, options.sites = 3 for ABO3, options.delta_initial, options.mass_change %).',
      'Heat-flow DSC sheets (.tri): `heatflow_peak` (melting / crystallisation enthalpy, options.dh_ref for crystallinity) and `glass_transition` (onset, midpoint, endset, ΔCp).',
    ],
    pitfalls: [
      'Run `generate` before the others: they read TGA~Mass. Mass steps are measured on it, not on the raw sheet.',
      'The unit of low / high depends on the action (°C for steps and DSC, minutes for `generate` and `isothermal`): say which in your answer.',
      '`cycles` needs a time-view run, `heatflow_peak` / `glass_transition` only work on a heat-flow DSC sheet; the error says so.',
      'Baseline, model and mode names must be given exactly as listed.',
    ],
    with: [
      ['kplot', 'publication plot from the exported CSV (mass vs temperature, DTG)'],
      ['khervesheet', 'tabulate the mass steps of several runs and compute differences'],
      ['keln', 'record the run in a lab-notebook entry (there is a TGA example)'],
      ['khervedilatometer', 'the other thermal technique (expansion, sintering)'],
    ],
  }),
  technique({
    app: 'khervebet',
    name: 'kBET',
    use: 'N2 physisorption isotherms: BET surface area, t-plot micropores, BJH pore-size distribution',
    about:
      'Nitrogen physisorption (the BET technique of KherveFitting-AI): BET surface area with its C constant and Rouquerol check, t-plot external area and micropore volume, BJH pore-size distribution, and a plain-text report.',
    concepts: [
      'Sheets: isotherms are BET, BET1, …; derived sheets BET~Plot (BET transform with the fitted line), BET~tPlot (quantity vs thickness t in Å), BET~Pore (dV/dlogD vs D in nm).',
      'Axes: relative pressure P/P0 forward, quantity adsorbed in cm³/g STP. Imports handle Micromeritics-style exports, plain CSV, and kPa with a P0.',
      'Windows: low / high of `bet` is the P/P0 range (default 0.05–0.30); of `tplot` the Harkins-Jura thickness range in Å (default 3.5–5.0); `bjh` uses options.branch, "desorption" (the standard) or "adsorption".',
      'Reading the BET result: S(BET) m²/g, Qm, C (a negative C warns that the window is wrong), R², number of points, the Rouquerol limit, total pore volume.',
    ],
    analyses: [
      '`khervebet_run` action `bet` with low / high (P/P0): check C > 0, R² close to 1 and that the window stays inside the Rouquerol limit; narrow it (lower P/P0 for microporous, type I samples) and run again if not.',
      'Micropores: action `tplot` (low / high in Å) gives external area, micropore volume and micropore area. Mesopores: action `bjh` (desorption branch by default).',
      'Derived sheets for plotting: `bet_plot_sheet` (after `bet`), `tplot_sheet` (after `tplot`), `pore_sheet` (after `bjh`). Action `report` returns the physisorption report as text.',
    ],
    pitfalls: [
      'The sheet-making actions need their fit first (`bet` before `bet_plot_sheet`…).',
      'The fits run on the measured isotherm: pass its name as "sheet" when a derived sheet is on the plot.',
      'Report S(BET) with the window used; a different window gives a different area.',
    ],
    with: [
      ['kplot', 'isotherm and pore-size plots from the exported CSV'],
      ['khervesheet', 'compare several samples\' areas side by side'],
      ['khervetga', 'thermal stability of the same material'],
    ],
  }),
  technique({
    app: 'kherveafm',
    name: 'kAFM',
    use: 'AFM / SPM scans: levelling, roughness (Sq, Sa, Sz), line profiles and step heights, grain statistics',
    about:
      'Atomic-force and scanning-probe microscopy (the AFM technique of KherveFitting-AI): every channel of a scan as a map, levelling, roughness, line profiles with step heights, grain and particle analysis, and a 3D surface sheet.',
    concepts: [
      'Sheets: the height map is AFM, the other channels AFM~Phase…, the 3D surface AFM~3D, line profiles AFM~Profile. A scan is an image: each pixel is one height; lengths are in nm (or µm) when the file carries a scan size, otherwise in pixels (use `scan_size`).',
      'Levelling is applied to the display and to every measurement, the stored data is never changed: `level` with options.background (plane or polynomial), options.rows (align rows: median, median of differences, modus…), options.zero. Level before measuring roughness, steps or grains.',
      'Roughness (`roughness`): Sq = RMS, Sa = mean, Ssk skew, Sku kurtosis, Sp / Sv / Sz extremes, Sdr area ratio, in the unit of the channel (nm for height). It covers the whole image.',
      'Profiles (`profile_line`): the end points are in image PIXELS, (column, row), row 0 at the top; options.width averages across the line. It returns the length, Ra / Rq / Rz and the step height (mean of the upper half minus the lower half), so put the line across the step.',
      'Grains (`grains`): "Watershed" separates touching grains, "Threshold" does not; "Otsu" picks the height threshold automatically. Sizes are in nm across. Result: count, mean / median diameter, D10 / D50 / D90, coverage.',
    ],
    analyses: [
      '`kherveafm_open_example` (or `open_file`), then check the scale: if distances are in pixels call `scan_size` with the scan width in µm.',
      '`kherveafm_run` action `level` (e.g. background "Plane", rows "Median of differences", zero "Minimum to zero"), then `roughness`. For a step or terrace sample draw a `profile_line` across the edge and read the step height; `profile_sheet` keeps the profile as a sheet.',
      '`level_default` returns to the recipe a channel opens with, `level_reset` to the raw data; `colour_map` (options.name) changes the colour map of the channel.',
      'Particles: `grains` (method "Watershed", threshold "Otsu"), then `grain_fit` with low / high to fit the size distribution, `grain_sheet` to keep the statistics as a sheet. `build_3d` makes the 3D surface sheet.',
    ],
    pitfalls: [
      'Measuring on unlevelled data: a tilted plane makes Sq and step heights meaningless. Level first and say which recipe was used when reporting.',
      'Profile coordinates are pixels, not nm: pixel size = scan width / image width (see the acquisition info in the sheet); `list_sheets` and `get_results` show it.',
      'Every channel is its own sheet: pass "sheet" to `run` for a channel other than the one on the plot. Roughness and steps only mean something for a height channel (nm).',
      'The 3D surface (AFM~3D) is a view, not a measurement.',
    ],
    with: [
      ['kplot', 'profile and distribution plots from the exported CSV'],
      ['khervesheet', 'compare roughness of several samples'],
      ['kherveraman', 'the same sample, chemical information to go with the topography'],
    ],
  }),
  technique({
    app: 'khervetem',
    name: 'kTEM',
    use: 'TEM micrographs: nanoparticle size distributions, lattice-fringe spacing, FFT d-spacings, denoising',
    about:
      'Transmission electron microscopy images (the TEM technique of KherveFitting-AI): pixel-size calibration, nanoparticle detection with size statistics, line profiles across lattice fringes, FFT of a region with d-spacing families, and PCA denoising.',
    concepts: [
      'Sheets: the micrograph is TEM~Map; derived sheets TEM~FFT (diffractogram of a region), TEM~Plot (line profile), TEM~Count / TEM~Freq (size distribution), denoised and filtered images. A Gatan .dm3 / .dm4 / .dm5 carries its pixel size; a TIFF or PNG does not.',
      'Calibration decides the units: until `calibrate` gives the pixel size (nm) every length, size and d-spacing is in pixels. The FFT reciprocal scale follows from it.',
      'Particles (`particles`): "Dark on bright" is bright-field contrast; "Blobs" finds round, touching particles individually (the default), the threshold methods merge touching ones. Sizes are equivalent circle diameters (ECD) in nm: mean, median, SD, density per µm², coverage.',
      'Lattice fringes: `profile_line` across the fringes (image PIXELS, column / row), then `fringe_spacing` gives the mean period in nm with its scatter. The FFT route: `fft` then `fft_spots` lists d-spacing families (d in nm, g in 1/nm, angle).',
    ],
    analyses: [
      '`khervetem_open_file` (or `open_example`); if the image is uncalibrated call `calibrate` with options.pixel_size (nm per pixel) before anything is measured.',
      'Sizes: `khervetem_run` action `particles` (options.method, polarity, min_size…), then `particle_sheet` for the distribution as a sheet. Check the count against the picture: change sensitivity / min_size and repeat if particles are missed or split.',
      'Crystal planes: `fft` (region in pixels, or the whole image) then `fft_spots` for d-spacings to compare with a crystal structure; or `profile_line` + `fringe_spacing` for a direct real-space period. `denoise` makes a PCA-cleaned copy.',
    ],
    pitfalls: [
      'Measuring on an uncalibrated image: sizes and d-spacings come back in pixels. Calibrate first, and say where the pixel size came from.',
      'Region and profile coordinates are image pixels, not nm.',
      'The FFT of a small or noisy region gives few spots: use a region of several hundred pixels across well-ordered lattice.',
      'Particle statistics depend on the detection settings: report the method and the size limits with the numbers.',
    ],
    with: [
      ['kherveafm', 'topography of the same sample'],
      ['kplot', 'size distributions and profiles for a paper'],
      ['khervesheet', 'compare particle statistics between samples'],
    ],
  }),
  technique({
    app: 'kherveedx',
    name: 'kEDX',
    use: 'SEM-EDX maps: elements in a spectrum image, point / area / line spectra, element maps, atomic %',
    about:
      'SEM-EDX (energy-dispersive X-ray) spectrum images (the EDX technique of KherveFitting-AI): the sum spectrum with its elements labelled, spectra of a pixel, an area or a line on the map, element maps, and standardless quantification.',
    concepts: [
      'The data are a cube: one spectrum (counts against energy in keV) for every pixel of the map. Sheets: EDX~Plot is the sum spectrum, EDX~Map the intensity map, EDX~Plot1, EDX~Plot2… are spectra of selections you saved (`select` with options.save). The raw file is copied next to the project; the cube is reloaded from it.',
      'Peaks are named by element and line: Ka (K-alpha), Kb, La…; energies in keV. Light elements (C, O, N) sit below 1 keV, transition metals K lines at 5-9 keV. Identification can include look-alikes (an F peak next to O, Sr near Si): confirm with a second line of the same element before reporting it.',
      'Pixels are (column, row) with 0 at the top left. A point is one pixel (options.size makes it a square), an area is a rectangle between two pixels, a line runs between two pixels with options.width averaging across it.',
      'Quantification (`quantify`) is standardless: relative atomic % from the identified K lines, not k-factor calibrated. Use it to compare regions, not as absolute composition.',
    ],
    analyses: [
      'After opening, the sum spectrum is shown with its elements labelled; `kherveedx_run` action `peaks` lists them.',
      'Where is an element? `element_maps` (options.elements, up to seven) shows their distribution; then `select` a pixel or an area inside a feature of interest and read the identified peaks and counts there. Compare an area on the matrix with one on a precipitate.',
      '`quantify` with the elements found gives relative atomic % of the sum spectrum; run it again after `select` of an area saved as a sheet to compare regions.',
    ],
    pitfalls: [
      'Reporting an element from a single weak peak: check a second line of the same element, and the peak labelled next to it.',
      'Quantification is relative and standardless. Say so, and do not quote it as absolute composition.',
      'Map coordinates are pixels, not micrometres: the pixel size is in the acquisition information of the file.',
      'A selection\'s spectrum is shown on the plot but only kept when it is saved as a sheet (options.save).',
    ],
    with: [
      ['khervetem', 'electron micrograph of the same sample'],
      ['kherveafm', 'topography of the same area'],
      ['khervedb', 'binding energies for the same elements in XPS'],
    ],
  }),
  technique({
    app: 'kherveuvvis',
    name: 'kUVVis',
    use: 'UV-Vis spectra: absorbance conversion, Tauc band gap, absorption maxima',
    about:
      'UV-Vis spectroscopy (the UV-Vis technique of KherveFitting-AI): convert transmittance or reflectance to absorbance (or Kubelka-Munk), build the Tauc plot, fit the optical band gap Eg, list absorption maxima.',
    concepts: [
      'Sheets: spectra are UVvis, UVvis1, …; the Tauc plot is UVvis~Tauc ((αhν)^n against energy in eV). Imports read Cary, Shimadzu and generic CSV / TXT / DAT / ASC files; the x axis is the wavelength in nm.',
      'What the y data are matters: "Absorbance", "Transmittance (%)" or "Reflectance (%)" (options.ordinate of `absorbance`). Transmittance becomes -log10 T, reflectance becomes Kubelka-Munk F(R).',
      'Tauc transition (options.transition of `tauc_sheet`): "Direct allowed", "Indirect allowed", "Direct forbidden", "Indirect forbidden". It sets the exponent n; the right one is the one with the long straight edge.',
      'Band gap: the straight part of the Tauc edge is fitted over low / high in eV; result Eg, R², number of points.',
    ],
    analyses: [
      'If the data are not absorbance: `kherveuvvis_run` action `absorbance` (options.ordinate) makes a new absorbance sheet; use it from here on.',
      'Action `tauc_sheet` (options.transition) makes UVvis~Tauc. Then `suggest_window` proposes the linear window on the steepest edge, and `fit_band_gap` with low / high in eV fits it and returns Eg. Try the direct and the indirect transition and compare R².',
      'Action `insert_inset` puts the fitted Tauc plot on the measured spectrum (options.font_size), `remove_inset` removes it. Action `band_maxima` lists absorption maxima (nm, eV, value, prominence).',
    ],
    pitfalls: [
      '`suggest_window` and `fit_band_gap` work on the Tauc sheet: make it (or select it) first.',
      'Give the window in eV, not nm.',
      'A band gap quoted without the transition type and the window is not reproducible: report both.',
    ],
    with: [
      ['kplot', 'Tauc plots for a paper'],
      ['kherveftir', 'complementary vibrational spectroscopy'],
      ['kherveraman', 'complementary vibrational spectroscopy'],
    ],
  }),
  technique({
    app: 'kherveftir',
    name: 'kFTIR',
    use: 'Infrared spectra: unit conversion, auto clean, band detection and functional-group assignment',
    about:
      'FTIR spectroscopy (the FTIR technique of KherveFitting-AI): set what the ordinate is, clean the spectrum (spikes, atmosphere, baseline, smoothing), detect bands and rank assignments from the IR correlation table, compare with reference spectra.',
    concepts: [
      'Sheets: FTIR, FTIR1, …; reference spectra added with `add_reference` become further FTIR sheets of the project. Axis: wavenumber in cm⁻¹, reversed.',
      'Ordinate units (options.unit): "Transmittance (%)", "Transmittance (fraction)", "Absorbance", "Reflectance (%)", "Kubelka-Munk", "Intensity (a.u.)". The input unit says what the file holds, the display unit how to show it.',
      'Processing is non-destructive: `auto_clean` presets "Gentle", "Standard", "Strong"; `reset` goes back to the raw spectrum.',
      'Bands: options.method "Intensity (prominence)" or "2nd derivative", options.prominence (%), options.min_distance and options.tolerance (cm⁻¹). Each band gets ranked candidate assignments.',
      'Formats: .txt / .csv / .dat, JCAMP-DX (.jdx / .dx) and Nicolet libraries.',
    ],
    analyses: [
      '`kherveftir_run` action `detect_unit`; if it is wrong set `input_unit` (options.unit), then `display_unit`.',
      'Action `auto_clean` (options.preset "Standard" to start), then `find_bands` (try the defaults first); `reassign` after changing options.tolerance.',
      'Action `label_bands` writes the assignments on the plot, `clear_labels` removes them. Action `band_library` (options.search, e.g. "C=O" or "1720") looks a band or group up in the IR correlation table.',
      'Action `add_reference` (options.name, e.g. "Polystyrene_synthetic.jdx") adds a reference spectrum to overlay and compare.',
    ],
    pitfalls: [
      'Set the input unit before cleaning and finding bands: bands point up in absorbance and down in transmittance.',
      'Assignments are ranked candidates, not identifications: confirm with `band_library` and the sample\'s chemistry.',
      'Ask for the preset by its exact name ("Standard").',
    ],
    with: [
      ['kherveraman', 'Raman gives the complementary vibrations of the same sample'],
      ['kplot', 'publication spectrum with an inverted wavenumber axis'],
      ['khervesheet', 'band tables'],
    ],
  }),
  technique({
    app: 'kherveraman',
    name: 'kRaman',
    use: 'Raman spectra: peak detection, database assignment of bands, plot labels, band library',
    about:
      'Raman spectroscopy (the Raman technique of KherveFitting-AI): detect peaks, rank assignments from the Raman band database steered by the sample metadata (material, substrate, elements, laser), label the plot, search the band library.',
    concepts: [
      'Sheets are named Raman_<file>; the spectrum is drawn as a line. Axis: Raman shift in cm⁻¹. Results are stored per sheet (peaks and metadata).',
      'Metadata steers the assignment (options of `metadata`): material, substrate, elements (e.g. "Ti O"), laser wavelength in nm, in_air (true / false).',
      '`use_fitted` takes the peaks already fitted in the Peak Parameters grid instead of detecting new ones.',
    ],
    analyses: [
      'Set what is known with `kherveraman_run` action `metadata` (material, substrate, elements, laser, in_air), then `find_peaks` (detects peaks and ranks assignments). If you change the metadata afterwards, run `reassign`.',
      'Action `label_plot` writes the assignments on the plot, `clear_labels` removes them. Action `band_library` (options.search, e.g. "TiO2" or "D band") searches the band library to check a candidate.',
      'Action `use_fitted` assigns peaks fitted by hand instead.',
    ],
    pitfalls: [
      'Give the substrate: its own bands (e.g. a silicon wafer) can otherwise be assigned to the sample.',
      'Assignments are database candidates: confirm with `band_library`, and with the laser line for resonance effects.',
    ],
    with: [
      ['kherveftir', 'complementary vibrational spectroscopy'],
      ['kherveuvvis', 'band gap of the same material'],
      ['kplot', 'publication spectrum'],
    ],
  }),
  technique({
    app: 'khervedilatometer',
    name: 'kDilatometer',
    use: 'Dilatometry: heating / cooling segments, thermal-expansion coefficient (CTE), sintering shrinkage',
    about:
      'Dilatometry (the DIL technique of KherveFitting-AI): split a programme into its segments, mean and differential thermal-expansion coefficient, and sintering analysis (maximum expansion, shrinkage onset, maximum shrinkage rate, total shrinkage).',
    concepts: [
      'Sheets: DIL, DIL1, … (one per file, with Segment and Time columns); derived DIL~Heat, DIL~Cool, DIL~Iso (one segment each) and DIL~Alpha (α(T)).',
      'Data: temperature in °C and dL/L0 (as given, or converted from % or from dL in µm / mm divided by the sample length found in the file header; without a length the sheet stays in µm and the CTE is refused).',
      'The programme is made of segments S1, S2, …: heating, cooling, isothermal. A whole heat / cool run is a loop, so a CTE over it is meaningless.',
      'CTE in 10⁻⁶ K⁻¹: mean (technical) α = (dL/L0(T2) − dL/L0(T1)) / (T2 − T1); differential α(T) = d(dL/L0)/dT (Savitzky-Golay, options.window in points, default 51).',
      'Sintering: options.onset is the % of dL/L0 below the maximum that defines the shrinkage onset (default 0.1).',
    ],
    analyses: [
      '`khervedilatometer_run` action `segments` lists the segments (type, T start / end, points) and the sheet summary.',
      'Make a sheet of the ramp you want: `segment_sheet` (options.segment = 1 for S1) or `all_segment_sheets`; select it.',
      'On a single ramp: `mean_cte` with low / high = T1 / T2 in °C, both inside the sheet; `alpha` makes DIL~Alpha.',
      'On a heating segment: `sintering` (options.onset, options.window); `label_plot` puts max, onset and max rate on the plot (`clear_labels` removes them).',
    ],
    pitfalls: [
      'Do `segment_sheet` before the CTE: the whole run goes up and down.',
      'T1 and T2 must lie inside the sheet; a sintering analysis wants a heating segment of a compact that shrinks.',
    ],
    with: [
      ['khervetga', 'thermal decomposition of the same sample'],
      ['kplot', 'expansion curve and α(T) for a paper'],
      ['khervesheet', 'compare CTE of several samples'],
    ],
  }),
]
