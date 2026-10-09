# App ideas for KherveOS

One list per menu of the Applications menu. ★ marks the ideas that reuse what KherveOS already has (Plotly, RDKit,
three.js, Pyodide with numpy/scipy/pandas/matplotlib, the Kherve table/CSV helpers, the AI tools system), so they are
the quickest to build. Names follow the K-prefix of the Kherve Tools.

Today: **Electricity** kElec, kPCB, kArduino · **Physics** kCalc, kStats, kPlot · **Chemistry** kChem, kReaction, kMol, kDB ·
**Programming** kPY, kBook, kCode · **Materials** KherveFitting, kTGA, kBET, kUVVis, kFTIR, kRaman · **Earth** nothing yet ·
**Mechanicals** KherveCAD · **Management** Calendar, kLab, kRef.

## Electricity

- ★ **kScope**: a logic analyser / oscilloscope viewer for captures from the Arduino serial plotter, CSV or WAV files: FFT,
  triggers, cursors, protocol decoding (UART, I²C, SPI).
- ★ **kSignal**: signal-processing lab: FFT and spectrograms, filter design (FIR/IIR, Bode and pole–zero plots), windowing, audio from the
  microphone, convolution demos. Pyodide + scipy.signal does the heavy lifting.
- **kDigital**: digital logic: gates, truth tables, Karnaugh maps, finite-state-machine designer, timing diagrams, a Verilog-subset simulator.
- **kMCU**: an AVR / RP2040 emulator in the browser with virtual LEDs, buttons, LCD and serial, so a kArduino sketch runs without a board.
- **kRF**: transmission lines, Smith chart, impedance matching, S-parameter (Touchstone) plots, antenna patterns.
- **kPower**: three-phase, transformers, motors, solar PV and battery sizing, load profiles, cable sizing.

## Physics

- ★ **kMotion**: classical mechanics sandbox: projectiles, pendulums, springs, orbits, collisions, N-body, with live plots and energy bars.
- ★ **kWave**: optics and waves: ray-optics bench (lenses, mirrors), interference, diffraction, polarisation, standing waves.
- **kQuantum**: 1-D Schrödinger solver (wells, tunnelling, harmonic oscillator), hydrogen orbitals in 3-D, a qubit/gate simulator with a Bloch sphere.
- ★ **kThermo**: thermodynamics and statistical mechanics: PV diagrams, heat-engine cycles, Maxwell–Boltzmann, a Monte-Carlo Ising model.
- **kField**: electromagnetism: point charges, Biot–Savart, a 2-D FDTD wave solver, capacitor and coil field maps.
- **kAstro**: sky chart, orbit and ephemeris calculator, Hohmann transfers, tidal and Kepler tools.
- ★ **kDecay**: radioactive decay chains, half-life fitting, counting statistics, a detector Monte-Carlo.

## Chemistry

- ★ **kSpectra**: NMR / IR / mass-spectrum helper: peak lists, splitting-pattern simulator, assign peaks to a drawn structure.
- ★ **kTitration**: titration curves, indicator choice, Gran plots, speciation (distribution) diagrams, buffer capacity.
- **kElectrochem**: Nernst and Pourbaix diagrams, a cyclic-voltammetry simulator, Butler–Volmer, EIS Nyquist fitting.
- ★ **kThermoChem**: thermochemical tables, Hess's law, adiabatic flame temperature, equilibrium composition by Gibbs minimisation.
- ★ **kSynth**: a synthesis notebook: reaction schemes (from kReaction), stoichiometry and yields, reagent hazards, characterisation links.
- **kSketch**: a full 2-D structure editor (rings, stereo, reaction arrows, IUPAC name, molfile/SMILES export) shared by kMol and kReaction.
- **kSafety Data**: GHS / hazard lookup, an SDS shelf, waste and incompatibility checks (also useful under Management).
- **kHuckel**: a Hückel / semi-empirical orbital calculator with MO diagrams.

## Programming

- **kWeb**: an HTML / CSS / JavaScript playground with a live, sandboxed preview and a console.
- ★ **kGit**: a visual Git client (branch graph, diff, stage, merge) on top of isomorphic-git, which KherveOS already uses.
- ★ **kSQL**: SQLite in the browser (sql.js): a table browser, a query editor, results as charts, CSV import.
- ★ **kAlgo**: an algorithm visualiser (sorting, graph search, dynamic programming) with complexity plots, linked to kCode lessons.
- ★ **kML**: a machine-learning playground: scikit-learn in Pyodide, decision boundaries, a small neural-network trainer with live loss curves.
- **kDebug**: a step-through Python visualiser (variables, call stack, heap) for teaching.
- **kRegex / kJSON**: a regex tester, a JSON / YAML explorer, hash, base64 and cron helpers.
- **kAPI**: a REST client through the KherveOS server proxy, with saved collections.

## Materials

- ★ **kXRD**: powder diffraction: peak search, Scherrer and Williamson–Hall, phase matching against a bundled CIF library, simple Rietveld-lite.
- ★ **kImage**: microscopy image analysis (ImageJ-lite): scale bar, thresholding, particle and grain size distributions, line profiles.
- ★ **kTensile**: stress–strain curves: Young's modulus, yield, UTS, toughness, hardening-law fits, DMA curves.
- ★ **kCrystal**: crystal structures: unit cells and supercells, Miller planes, stereographic projections, CIF import, a three.js view.
- **kEIS**: impedance spectroscopy: Nyquist / Bode plots and equivalent-circuit fitting (reusing kElec's complex solver).
- ★ **kBattery**: battery cycling data: charge–discharge curves, dQ/dV, capacity fade, Coulombic efficiency.
- **kPhase**: binary phase diagrams, the lever rule, ternary plots, a CALPHAD-lite explorer.
- **kXAS / kEELS**: the next techniques in the KherveFitting-AI roadmap (see CLAUDE.md, "Technique apps").
- **kBand**: band-structure and density-of-states plotting, semiconductor calculators (doping, Fermi level, p–n junction).
- **kSurface**: contact-angle and surface-energy (Owens–Wendt) analysis from drop images.

## Earth

- ★ **kSeis**: seismic waveform viewer, magnitude and distance calculators, an earthquake map from the USGS feed.
- **kMap**: a map viewer for GeoJSON / GPX / KML, measuring, projections and coordinate conversion.
- ★ **kWeather**: weather data and station logs, charts, psychrometrics, skew-T diagrams.
- ★ **kClimate**: a climate data explorer (CO₂, temperature anomalies, ENSO), trend fitting, a toy energy-balance model.
- ★ **kStereonet**: structural geology: stereonets, strike and dip, rose diagrams, cross-section sketching.
- **kHydro**: hydrology: rainfall–runoff, unit hydrographs, flood-frequency (Gumbel / log-Pearson), well hydraulics.
- **kMineral**: a mineral and rock identification key and database, with a geological time scale.
- **kCarbon**: carbon-footprint and life-cycle calculators (also under Management).
- **kTide**: tide prediction from harmonic constants, wave calculators.

## Mechanicals

- ★ **kBeam**: beam and frame calculator: shear and moment diagrams, section properties, deflection, buckling.
- **kFEA**: a lite finite-element solver: trusses, beams, plane stress on a mesh drawn in KherveCAD, with stress colour maps.
- ★ **kMech**: mechanism and linkage designer (four-bar, cams, gear trains) with kinematics plots.
- **kFluid**: pipe flow (Darcy–Weisbach, Reynolds), pump curves, Bernoulli, and a lattice-Boltzmann flow toy.
- ★ **kHeat**: heat transfer: 1-D and 2-D conduction by finite differences, fins, heat-exchanger LMTD / NTU.
- ★ **kVibe**: vibration: spring–mass–damper, modal analysis, FFT of a measured signal.
- **kDraw**: 2-D engineering drawings (dimensions, tolerances, title block), DXF import and export, PDF output.
- **kSlice**: a 3-D-print slicer preview and G-code viewer, laser-cut layout, STL repair.
- **kCycle**: Rankine, Otto, Diesel, Brayton and refrigeration cycles with steam tables.
- **kRobot**: robot-arm kinematics, PID tuning simulator, path planning (pairs with kArduino).
- **kSelect**: an Ashby-chart material selector, tolerance stack-up, bolt and fastener calculators.

## Management

- ★ **kTasks**: tasks, Kanban boards and a Gantt chart with dependencies, tied to Calendar.
- **kInventory**: lab inventory of chemicals and parts with QR codes, locations, stock and expiry, linked to kChem hazards and kPCB BOMs.
- **kELN**: an electronic lab notebook: dated entries, sample tracking, attachments (spectra from the technique apps), signatures, PDF export.
- ★ **kBudget**: grants, budgets, orders and quotes, with spend tracking and currency conversion.
- **kBooking+**: extends kLab: usage logs, billing, induction and training checklists.
- **kRisk**: risk assessments (COSHH-style), SOP templates, incident log, hazard-label printing.
- ★ **kPapers**: a manuscript tracker: submissions, reviewer comments, co-author roles (CRediT), citation counts from kRef.
- **kData**: data-management plans, a dataset registry with DOIs and metadata, a FAIR checklist.
- **kMeeting**: minutes and action items, with speech-to-text from kNote's Whisper pipeline.
- **kTime**: time tracking and timesheet reports.

## Suggested first picks

1. **kXRD** and **kImage** (Materials): the most-wanted next steps beside the existing spectroscopy apps.
2. **kSignal** with **kScope** (Electricity): turn kArduino's serial data into real analysis.
3. **kBeam** then **kFEA** (Mechanicals): gives KherveCAD companions, and the Mechanicals menu a second app.
4. **kSeis** or **kWeather** (Earth): the Earth menu is empty today; both are mostly charts on public data.
5. **kTasks** and **kELN** (Management): useful to every lab group.
6. **kSketch**: one structure editor shared by kMol and kReaction.
