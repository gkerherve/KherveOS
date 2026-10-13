// Guides of the science and engineering apps: Chemistry, Physics, Electricity,
// Mechanicals, Earth. (Materials: materials.ts and techniques.ts.)

import type { AppGuide } from './core.ts'

export const SCIENCE_GUIDES: AppGuide[] = [
  // ------------------------------------------------------------ Chemistry
  {
    app: 'khervedb',
    use: 'Look up XPS binding energies of an element (NIST), to identify a chemical state',
    about:
      'The NIST X-ray Photoelectron Spectroscopy database with a periodic-table browser: for each element and line, the binding energies reported in the literature for many compounds.',
    concepts: [
      'A line is a core level such as 1s or 2p3/2 (spin-orbit components are separate lines).',
      'The answer gives, per line, the median binding energy, the range and the number of NIST entries. The range matters more than the median: it is the chemical-state and charge-referencing spread.',
      'Other Databases & Properties (XPS Fitting, Harwell, Thermo, Scholar) is a second window on the same element.',
    ],
    workflow: [
      '`khervedb_select_element` with the symbol or name ("O", "oxygen"), optionally "line" ("2p3/2"): returns the lines and shows the element.',
      '`khervedb_open_databases` opens the Other Databases window on the shown element for more sources.',
      'To show an element when opening: `open_app` with app "khervedb" and element "O".',
    ],
    pitfalls: ['A median binding energy does not identify a compound: compare the fitted peak with the entries of the right compound and note the charge reference.'],
    with: [
      ['khervefitting', 'compare the fitted peak positions with these references'],
      ['kchem', 'element properties other than XPS (mass, configuration, electronegativity)'],
    ],
  },
  {
    app: 'khervemol',
    use: 'Build, view and edit molecules, crystals, surfaces, polymers and reactions in 3D; export structures',
    about:
      'A molecule and crystal builder with a library of about 700 molecules and 120 crystals, plus surfaces, nanotubes, polymers and reactions, in 3D and as a 2D sketch. Builds from SMILES, balances and animates reactions, exports to chemistry and 3D-print formats.',
    writes: ['.kmol documents', 'structure files .xyz .mol .sdf .pdb .cif, images .png .svg, 3D-print meshes .stl .3mf .obj .ply .glb'],
    concepts: [
      'Coordinates are in ångström; atoms are numbered from the structure (`khervemol_get_structure` gives index, element, x y z, and bonds as i, j, order).',
      'Library entries have a kind and a value: `khervemol_search_library` returns them, `khervemol_load_entry` builds one.',
      '"My molecules" is a shelf: `khervemol_keep_molecule` keeps one so a reaction can use it as @Name.',
    ],
    workflow: [
      'Find or build: `khervemol_search_library` then `khervemol_load_entry`, or `khervemol_build_molecule` (SMILES or a name), or `khervemol_open_document` for a .kmol / .mol / .sdf / .pdb / .xyz / .cif file.',
      'Check: `khervemol_get_structure`, `khervemol_properties` (formula, molecular weight, with RDKit logP, TPSA, InChI; lattice data for a crystal).',
      'Edit: `khervemol_add_atom` (valence-checked, at the real bond length), `khervemol_bond_atoms`, `khervemol_delete_atom`; `khervemol_set_view` for view, style and labels.',
      'Reactions: `khervemol_build_reaction` (balances), `khervemol_play_reaction`.',
      '`khervemol_save_document` (.kmol) or `khervemol_export_file` (format from the extension).',
    ],
    pitfalls: ['Indices in edit tools come from the last `khervemol_get_structure`; they shift after a deletion.', 'delete_atom takes the atom\'s bonds with it (the user is asked first): get the structure again afterwards.'],
    with: [
      ['kreaction', 'mechanisms, kinetics and product prediction for the same reactions'],
      ['kchem', 'molar masses and stoichiometry'],
      ['khervecad', 'molecules and crystals also exist as KherveCAD parts and can be printed'],
    ],
  },
  {
    app: 'kchem',
    use: 'Chemistry calculations: molar mass, balancing, yields, solutions, dilutions, pH, gas law, elements',
    about: 'A chemistry bench: the exact calculators a student or technician needs at the bench, each also shown in the app.',
    concepts: [
      'Formulas accept brackets, hydrate dots (CuSO4·5H2O) and charges (SO4^2-). Masses are in g, volumes in mL or L as named in the argument.',
      'Several reactants: use `kchem_limiting_reagent` (it balances an equation without coefficients, gives theoretical yield, excess and percent yield).',
    ],
    workflow: [
      '`kchem_molar_mass` for a formula; `kchem_balance_equation` for an equation.',
      '`kchem_stoichiometry` (one reactant to a product), `kchem_limiting_reagent` (several reactants).',
      '`kchem_solution` (grams to weigh for a molarity and volume), `kchem_dilution` (C1·V1 = C2·V2, give three of four), `kchem_ph` (acid, base, buffer at 25 °C), `kchem_gas_law` (give three of P, V, n, T), `kchem_element`.',
    ],
    pitfalls: ['Temperatures: kchem_gas_law takes kelvin or Celsius under separate names; dilution units only have to match.'],
    with: [
      ['khervemol', 'the structure of the compound'],
      ['kreaction', 'the mechanism and kinetics behind a balanced equation'],
      ['ktitration', 'pH curves of acids and bases'],
    ],
  },
  {
    app: 'kreaction',
    use: 'Draw and balance reactions, predict products, simulate kinetics, fit rate laws, solve equilibria',
    about:
      'Reaction chemistry: a reaction builder with atom, mass and charge checks, about 50 library reactions with mechanism steps, product prediction with RDKit reaction templates, mass-action kinetics, order and Arrhenius / Eyring fits, equilibrium (ICE) solving.',
    writes: ['.kreact documents', 'a Markdown report (`kreaction_export_report`, asks first)'],
    concepts: [
      'Species are names, SMILES or formulas. Reagents count as reactants for prediction: HBr is "Br", Br2 "BrBr", hydroxide "[OH-]".',
      'Kinetics take a network text or a preset id; data fits take (time, concentration) pairs or (T in K, k) pairs.',
    ],
    workflow: [
      '`kreaction_set_reaction` (no arguments reads the one on screen) or `kreaction_load_example` (no id lists them).',
      '`kreaction_predict_products` for what a set of reactants could give.',
      '`kreaction_simulate_kinetics` for concentrations over time; `kreaction_fit_order` for measured data (mode order, arrhenius, eyring); `kreaction_equilibrium` (ICE table, or ΔG and K from dH, dS, T).',
      '`kreaction_export_report` to keep the result.',
    ],
    pitfalls: ['Predicted products are template matches: say which template, and check the chemistry.', 'Temperatures for the fits are kelvin.'],
    with: [['khervemol', 'structures and the animated reaction'], ['kchem', 'stoichiometry and yields'], ['ktitration', 'acid-base and redox equilibria']],
  },
  {
    app: 'ktitration',
    use: 'Titration curves (acid-base, redox, EDTA, precipitation) and analysis of measured titration data',
    about:
      'A titration lab: exact simulated curves with equivalence points and indicators, and analysis of measured (volume, pH) data by derivatives, Gran plot and a full-model fit giving the analyte concentration and pKa values.',
    concepts: [
      'Acid-base names come from a table of about 130 acids and bases. Volumes in mL, concentrations in mol/L.',
      '`analyse_data` takes volumes V in mL and pH; the aliquot in mL and the titrant concentration.',
    ],
    workflow: ['`ktitration_load_example` (about 34, e.g. HCl/NaOH, EDTA hardness; no id lists them).', '`ktitration_titrate` sets up a titration and returns equivalence volumes, pH at the points and the best indicators.', '`ktitration_analyse_data` on measured data; `ktitration_get_state` to read what is shown.'],
    pitfalls: ['The fit reports standard errors: quote them with the concentration and the pKa values.'],
    with: [['kchem', 'pH and dilution arithmetic'], ['khervesheet', 'measured titration data'], ['kreaction', 'equilibria']],
  },

  // -------------------------------------------------------------- Physics
  {
    app: 'khervecalc',
    use: 'Exact and high-precision maths: equations, calculus, matrices, units, constants',
    about: 'A scientific calculator on SymPy: exact (symbolic) or decimal results up to 1000 digits, calculus, matrices, statistics, unit arithmetic and constants. Every calculation goes into a history.',
    concepts: [
      'Syntax: ^ powers, 2x implicit product, "a = b" equations, "x := 3" and "f(x) := x^2" definitions, 3_m/_s units, #c constants, "expr ▶ _km/_h" converts, [[1,2],[3,4]] matrices, integrate(f, x, a, b).',
      'Modes: number (exact / decimal / fraction), angle unit, digits, complex form, format (`khervecalc_set_mode`).',
    ],
    workflow: ['`khervecalc_evaluate` an expression; `khervecalc_solve` an equation or a system ("[x + y = 3, x - y = 1]"), exactly or numerically from a guess.', '`khervecalc_convert` between units (25 degC to degF, 1 kWh to MJ).', '`khervecalc_get_history` reads back results and the defined variables.'],
    pitfalls: ['Use the calculator syntax above, not Python (^ is a power).', 'For a big dataset use kStats or run_python; this is for expressions.'],
    with: [['kstats', 'statistics of data tables'], ['kplot', 'plot a function from a table']],
  },
  {
    app: 'kstats',
    use: 'Statistics of lab data: describe, curve fits with errors, model comparison, t-tests, ANOVA, correlation',
    about: 'Statistics for lab data on an editable table: descriptive statistics, curve fits with parameter errors and confidence bands, model ranking by AIC, hypothesis tests with a plain-language verdict, correlation matrices.',
    writes: ['.tsv / .dat / .csv tables', 'a Markdown report of everything computed (`kstats_export_report`, asks first)'],
    concepts: [
      'Data are a table with a header row: rows on lines, columns separated by commas, tabs or semicolons.',
      'Fit models: linear, poly2–poly6, exp, power, log, mm (Michaelis-Menten), gauss, lorentz, logistic; `sigma` weights. Results: parameters with standard errors and 95 % CIs, R², adjusted R², RMSE, AIC.',
      'Tests: ttest1, welch, paired, anova (columns are groups), mannwhitney, pearson, spearman, normality.',
    ],
    workflow: ['`kstats_set_data` with the table text (replaces the data).', '`kstats_describe` (one column or all) for n, mean, sd, sem, CI, outliers.', '`kstats_fit` y against x, or `kstats_compare_models` to rank candidate models by AIC; `kstats_test`, `kstats_correlate`.', '`kstats_export_report` to save the lot.'],
    pitfalls: ['A good R² does not pick the model: use AIC from `kstats_compare_models`.', 'Say which test and alpha you used when you quote a p-value.'],
    with: [['kplot', 'plot the data and the fit'], ['khervesheet', 'where the data usually start'], ['khervebook', 'scripted analyses with Python']],
  },
  {
    app: 'kplot',
    use: 'Plots from a table: scatter, bar, histogram, box, heat map, 3D, fits; PNG / SVG export',
    about: 'Interactive (Plotly) and publication-quality (SVG) plots from a table, with axis control, fits and annotations, exported as PNG or SVG.',
    writes: ['.kplot figures', 'SVG / PNG in ~/Documents/kPlot (`kplot_save`, `kplot_export`)'],
    concepts: [
      'The first column is x; y columns are named or numbered from 1. Labels accept H_2O, m^2, \\alpha.',
      'Engines: interactive Plotly, or publication SVG. Axes: linear, log10, ln; `invert` reverses an axis (binding energy, wavenumber); y2 is the right axis.',
      'Overlays (`kplot_add_overlay`): "fit" (returns coefficients and R²), "line", "note", "region", "clear".',
    ],
    workflow: ['`kplot_set_data` with the table text (header row first).', '`kplot_set_options` (x, y columns, title, labels), `kplot_set_figure` (type, engine, palette, size), `kplot_set_axis` (scale, limits, invert, grid).', '`kplot_add_overlay` for a fit or notes, then `kplot_export` (png at 1, 2 or 4 ×, svg) or `kplot_save`.'],
    pitfalls: ['A spectrum in binding energy or wavenumber needs the x axis inverted.', 'set_data replaces the whole table.'],
    with: [['khervesheet', 'data source and charts inside a workbook'], ['kstats', 'fit statistics'], ['khervefitting', 'XPS and the technique apps export CSV to plot here']],
  },
  {
    app: 'kmotion',
    use: 'Classical-mechanics experiments: projectiles, pendulums, oscillators, collisions, orbits, rigid bodies',
    about: 'A mechanics sandbox: scenes you run live or headless, with parameters, integrators, readouts and energy drift.',
    concepts: ['Scenes: projectile, pendulum, oscillator, collision, orbit, sandbox, circular. Parameters have ranges (see `kmotion_get_state`). SI units.', 'Live parameters change while running; the others restart the run.'],
    workflow: ['`kmotion_load_example` (no id lists them) or `kmotion_run` with scene, mode, params and duration to measure a model headless.', '`kmotion_set_param` to vary one parameter of the open scene; `kmotion_get_state` to read values and readouts.'],
    pitfalls: ['Check the energy drift of `kmotion_run` before trusting a long run; try another integrator (the method argument).'],
    with: [['kplot', 'plot sampled results'], ['kstats', 'fit measured motion data'], ['kmech', 'mechanisms rather than free bodies']],
  },

  // ---------------------------------------------------------- Electricity
  {
    app: 'kelec',
    use: 'Draw circuits and simulate them: DC, AC (Bode), transient, scope; SPICE netlists; calculators',
    about: 'An electronics workbench: schematic editor, SPICE-like simulator (DC operating point, DC sweep, AC, transient), waveform viewer, about 22 example circuits and calculators.',
    writes: ['.kelec circuits', 'svg / png images, .cir SPICE netlists, bom, csv data, a knetlist for kPCB (`kelec_export`, asks first)'],
    concepts: [
      'Pins are named like "R1.2"; pins on the same net name are connected; net "0" or "gnd" is ground. Values take SPICE suffixes (4.7k, 1meg, 10u).',
      '`kelec_set_netlist` replaces the circuit with a SPICE netlist (R C L V I D Q M E G K, .model .param .op .dc .ac .tran) drawn as a schematic.',
    ],
    workflow: ['`kelec_load_example` (no id lists them), or `kelec_set_netlist`, or build with `kelec_add_part` and `kelec_connect`.', '`kelec_get_circuit` to check the parts, nets and problems (no ground, floating parts).', '`kelec_simulate` (op, dc, ac, tran) returns key results and waveform samples.', '`kelec_calculate` for Ohm\'s law, colour codes, dividers, filters, 555, op-amp gains…; `kelec_export`.'],
    pitfalls: ['A circuit with no ground does not simulate: look at the problems of `kelec_get_circuit`.', 'set_netlist replaces the circuit and asks the user first.'],
    with: [['kpcb', 'export the netlist and lay out the board'], ['ksignal', 'analyse exported waveforms'], ['karduino', 'the microcontroller side']],
  },
  {
    app: 'kpcb',
    use: 'Design printed circuit boards: place, route (manual / auto), zones, DRC, Gerber export',
    about: 'A PCB editor: footprints, placement, manual and auto routing, copper zones, design-rule checking, and Gerber, SVG / PNG, BOM and pick-and-place export.',
    writes: ['.kpcb boards', 'Gerber zip, svg / png, bom, pnp (`kpcb_export`, asks first)'],
    concepts: ['Millimetres, y down, rotation counter-clockwise in degrees. Footprints like R_0805, C_0805, LED_5mm, SOT-23, DIP-8, SOIC-8, QFP-32, PinHeader_1x04.', 'Netlists come from kElec (knetlist) or text lines "R1 10k R_0805 | VCC:1 GND:2".'],
    workflow: ['`kpcb_load_example` ("555-blinker", "uno-shield", "esp32-breakout") or `kpcb_set_outline` then `kpcb_import_netlist`.', '`kpcb_place` parts, `kpcb_route` (auto for a net or "all", manual points, zone).', '`kpcb_run_drc` and fix; `kpcb_get_board` for the state; `kpcb_export`.'],
    pitfalls: ['load_example replaces the open board.', 'Run DRC after every routing change, not only at the end.'],
    with: [['kelec', 'the schematic and netlist source'], ['khervecad', 'enclosures for the board']],
  },
  {
    app: 'ksignal',
    use: 'Signal processing: FFT spectra and peaks, THD / SNR, spectrograms, digital filter design, audio',
    about: 'A signal lab: spectrum analysis with windows, tone metrics (THD, SNR, SINAD, ENOB), spectrograms, filter design with stability, and audio or live microphone input.',
    writes: ['.ksig documents'],
    concepts: ['A synthetic signal is {fs, duration, components:[{type:"sine", freq, amp}…], noise:{sigma}, bits}; leave it out to analyse the signal loaded in the app.', 'Frequencies in Hz, fs the sample rate; windows change leakage.'],
    workflow: ['`ksignal_load_example` (about 16, no id lists them) or `ksignal_analyze` with a synthetic signal.', '`ksignal_design_filter` returns -3 dB points, group delay, stability, and can apply the filter to the signal.', '`ksignal_get_state` for the peaks and metrics.'],
    pitfalls: ['Mind aliasing: components above fs/2 fold back.', 'Pick the window before comparing amplitudes.'],
    with: [['kelec', 'circuits whose waveforms to analyse'], ['kplot', 'spectra for a report']],
  },
  {
    app: 'kdigital',
    use: 'Digital logic: gate circuits, truth tables, Karnaugh maps, Quine-McCluskey, state machines, timing',
    about: 'A digital-logic lab: gate-level simulator with timing diagrams, Boolean function minimisation (truth table, canonical and minimal SOP / POS, K-map groups), state machines and number systems.',
    writes: ['.kdig circuits'],
    concepts: ['Functions are one per line: "F = A&B | !C", or "F(A,B,C,D) = Σm(…) + d(…)" with don\'t-cares.', 'Stimulus for `kdigital_simulate` is timed input changes; it reports glitches and oscillation warnings.'],
    workflow: ['`kdigital_set_expression` for the truth table and the minimal forms (build_circuit true draws the gates).', '`kdigital_simulate` an example id, the open circuit, or one built from an expression.', '`kdigital_load_example` (adders, multiplexers, latches, counters, FSMs, hazards); `kdigital_get_state` (what = summary, circuit, boolean or fsm).'],
    pitfalls: ['Glitches in the timing view are real hazards of the circuit, not bugs.'],
    with: [['karduino', 'implement the logic on a microcontroller'], ['kelec', 'the analogue side']],
  },
  {
    app: 'karduino',
    use: 'Write, compile and upload Arduino sketches; serial monitor; 25 examples',
    about: 'An Arduino IDE in KherveOS: sketches with several files, boards, 25 examples with wiring notes, compile on the KherveOS server, upload to a board on the server\'s computer, serial monitor and plotter.',
    writes: ['sketch folders in ~/Documents/kArduino (name/name.ino and other files)'],
    concepts: ['The board decides the compiler: "Arduino Uno", "Arduino Mega 2560", "ESP32 Dev Module", or a full name like arduino:avr:nano:cpu=atmega328.', 'Compiling and uploading happen on the KherveOS server; the web page itself cannot flash a board. Serial over USB needs Chrome or Edge.'],
    workflow: ['`karduino_load_example` (no id lists them; the result gives the wiring and libraries) or `karduino_set_sketch`.', '`karduino_set_board`, then `karduino_compile`: it returns problems as {file, line, col, message} and the flash / RAM size.', 'Fix and compile again; `karduino_save`; `karduino_upload` (asks the user) and `karduino_serial_read` / `karduino_serial_send`.'],
    pitfalls: ['Compile before upload, and read the problems list rather than guessing.', 'Upload and serial_send ask the user first.'],
    with: [['kelec', 'check the circuit before wiring'], ['kdigital', 'design the logic first'], ['ksignal', 'analyse sensor data']],
  },

  // ---------------------------------------------------------- Mechanicals
  {
    app: 'khervecad',
    use: 'Parametric 3D CAD with OpenSCAD: object tree, library of ~2,300 parts, STL / 3MF export',
    about:
      'A CAD app whose document is a tree of objects compiled one-to-one to an OpenSCAD program. A library of about 2,300 parts (fasteners, furniture, buildings, molecules, crystals, vehicles) can be inserted and resized.',
    writes: ['.kcad documents', '.scad, .stl, .3mf and other meshes through the app'],
    concepts: [
      'Every tree node has an id; the other tools take ids from `khervecad_list_tree`.',
      '`khervecad_tool` runs any tool of the full desktop KherveCAD MCP (add_node, set_params, wrap_nodes, set_color, mass_properties, check_printability, build_house, build_crystal, save_document…); `khervecad_list_tools` lists them with their arguments.',
    ],
    workflow: ['Check the library first: `khervecad_list_parts` with a search word, then `khervecad_insert_part` (size, colour, position).', 'Otherwise write OpenSCAD and `khervecad_apply_code` (it becomes editable nodes; end statements with "// Label" to name them); `khervecad_get_code` reads it back.', '`khervecad_list_tree` to see the nodes; `khervecad_tool` for everything else (measure, printability, export).'],
    pitfalls: ['Look for a library part before modelling from scratch.', 'Name nodes descriptively; apply_code is one undo step but replaces its scope when mode is replace.'],
    with: [['khervemol', 'molecule structures to print'], ['kfea', 'stress analysis of a design'], ['kmech', 'linkages and gears']],
  },
  {
    app: 'kfea',
    use: 'Finite elements: trusses, beams, frames, plates; stress maps, modes, buckling',
    about: 'A finite-element solver: trusses, beams, frames and plates with a mesh, static, modal and buckling studies, with 17 ready models whose answers are known.',
    writes: ['.kfea models'],
    concepts: ['Inputs are in the model\'s display units. A model is nodes, members, supports, loads (plates: outline, holes, supports, loads).', 'Results: displacements, reactions, member forces, max stress, safety factor.'],
    workflow: ['`kfea_load_example` (no id lists them) or build with `kfea_add`.', '`kfea_get_state` to check the model and its problems.', '`kfea_solve` (study static, modal or buckling), or pass a whole model JSON to solve it without opening it.'],
    pitfalls: ['Check supports: an under-constrained model does not solve.', 'Refine the mesh (divisions) and see that stress converges.'],
    with: [['khervecad', 'geometry to analyse'], ['kmech', 'mechanisms'], ['khervesheet', 'tabulate results']],
  },
  {
    app: 'kmech',
    use: 'Mechanisms: linkage kinematics and dynamics, cams, gears (spur, helical, worm, bevel, trains)',
    about: 'A mechanism workbench: planar linkages (position, velocity, acceleration, transmission angle, Grashof class), cams and gears, with examples and SVG / DXF export.',
    writes: ['.kmech documents', 'SVG / DXF exports'],
    concepts: ['`kmech_analyse` takes four_bar, slider_crank, linkage or an example id; with none it analyses the open linkage.', '`kmech_gear` kinds: spur_pair, train, planetary, helical, belt, chain, rack, worm, bevel; details in params.'],
    workflow: ['`kmech_load_example` (no id lists them; it replaces the open mechanism).', '`kmech_analyse` for kinematics, `kmech_gear` for gear sets.', '`kmech_get_state` for the workbench, model and warnings.'],
    pitfalls: ['load_example is destructive: it asks first.'],
    with: [['khervecad', 'design the parts'], ['kmotion', 'free-body dynamics'], ['kfea', 'stress in the members']],
  },

  // ---------------------------------------------------------------- Earth
  {
    app: 'kclimate',
    use: 'Climate data: CO2, temperature, sea ice, ENSO; trends with confidence intervals; energy-balance model',
    about: 'A climate data explorer with built-in datasets (CO2, temperature, sea ice, sea level, ENSO), trend fits with confidence intervals corrected for autocorrelation, anomalies against a baseline, warming stripes and a simple energy-balance model.',
    writes: ['.kclim documents'],
    concepts: ['Series have ids (see `kclimate_get_state`); datasets load as needed. Trends are per decade with a 95 % CI corrected for AR(1) autocorrelation; the naive CI is shown for comparison.', 'Statistics of `kclimate_query_series`: mean, min, max, first, last, count, trend, anomaly (against baseline years).'],
    workflow: ['`kclimate_get_state` for the series ids; `kclimate_query_series` for a statistic over years.', '`kclimate_fit_trend` over a period (shown in the app).', '`kclimate_load_example` (Keeling curve, warming stripes, ENSO lag, sea ice, energy balance; asks first if there are unsaved changes).'],
    pitfalls: ['Quote the baseline when you quote an anomaly, and the CI with a trend.', 'Do not use the naive CI for autocorrelated series.'],
    with: [['kstats', 'general statistics'], ['kplot', 'figures'], ['khervesheet', 'your own CSV climate data']],
  },
]
