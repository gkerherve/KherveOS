# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/Raman_Library.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/Raman_Library.py
"""
Raman band-assignment library.

A correlation table of characteristic Raman shifts: carbon materials,
elemental and compound semiconductors, metal oxides and hydroxides, common
inorganic ions and minerals, polymers/organic groups, plus the substrate and
atmospheric lines every practitioner runs into. Sources: Ferraro & Nakamoto,
'Introductory Raman Spectroscopy'; Nakamoto, 'IR and Raman Spectra of
Inorganic and Coordination Compounds'; Socrates, 'IR and Raman Characteristic
Group Frequencies'; the RRUFF mineral database; and the graphitic-carbon
literature (Ferrari & Robertson).

Each entry: (shift_min, shift_max, mode, intensity/shape, assignment)
Shifts in cm-1. Positions can move a few cm-1 with excitation wavelength,
strain, doping, crystallite size and temperature - ranges are drawn wide
enough to catch typical spectra.
"""

RAMAN_BANDS = [
    # --- Carbon materials ---------------------------------------------------
    (1305, 1360, "D band (A1g breathing)", "strong when disordered",
     "Disordered / defective sp2 carbon (graphite, graphene, CNT, carbon black)"),
    (1560, 1600, "G band (E2g stretch)", "strong, sharp",
     "Graphitic sp2 carbon (graphite, graphene, CNT)"),
    (2640, 2720, "2D (G') band", "strong, dispersive",
     "Graphene / graphite second-order D (layer-number sensitive)"),
    (1610, 1625, "D' band", "weak-medium shoulder",
     "Defective graphitic carbon (shoulder on G)"),
    (2900, 2960, "D+G combination", "weak-medium",
     "Defective graphitic carbon"),
    (1325, 1335, "sp3 C-C (diamond)", "very strong, sharp (1332)",
     "Diamond"),
    (1140, 1560, "a-C:H broad bands", "broad, overlapping D/G",
     "Amorphous / diamond-like carbon"),
    (150, 300, "RBM", "sharp, diameter-dependent",
     "Single-wall carbon nanotube radial breathing mode"),
    (1360, 1372, "h-BN E2g", "medium, sharp (~1366)",
     "Hexagonal boron nitride"),

    # --- Elemental & compound semiconductors --------------------------------
    (515, 525, "Si-Si TO phonon", "very strong, sharp (520.7)",
     "Crystalline silicon (wafer / substrate)"),
    (460, 500, "Si-Si TO (amorphous)", "broad (~480)",
     "Amorphous silicon"),
    (290, 310, "Si 2TA", "weak, broad (~302)",
     "Crystalline silicon second order"),
    (930, 990, "Si 2TO", "weak, broad",
     "Crystalline silicon second order"),
    (295, 302, "Ge-Ge TO", "strong, sharp (~300)",
     "Crystalline germanium"),
    (265, 272, "GaAs TO", "medium (~268)",
     "Gallium arsenide"),
    (288, 295, "GaAs LO", "strong (~292)",
     "Gallium arsenide"),
    (563, 572, "GaN E2(high)", "strong (~567)",
     "Gallium nitride (wurtzite)"),
    (730, 740, "GaN A1(LO)", "medium (~734)",
     "Gallium nitride (wurtzite)"),
    (378, 388, "MoS2 E2g(1)", "strong (~383)",
     "MoS2 (few-layer; E2g-A1g gap gives layer number)"),
    (402, 412, "MoS2 A1g", "strong (~408)",
     "MoS2 (few-layer)"),
    (348, 356, "WS2 2LA/E2g", "strong (~351)",
     "WS2"),
    (415, 422, "WS2 A1g", "medium (~417)",
     "WS2"),
    (200, 260, "Se chain / S8 modes", "strong",
     "Elemental selenium (~235) / sulfur S8 (~219)"),
    (468, 478, "S8 bending", "strong (~473)",
     "Elemental sulfur"),

    # --- Titanium / zinc / cerium oxides ------------------------------------
    (138, 152, "Eg(1)", "very strong, sharp (~144)",
     "TiO2 anatase (also B1g rutile ~143, much weaker)"),
    (190, 205, "Eg(2)", "weak (~197)",
     "TiO2 anatase"),
    (390, 405, "B1g", "medium (~399)",
     "TiO2 anatase"),
    (505, 525, "A1g/B1g doublet", "medium (~513/519)",
     "TiO2 anatase"),
    (630, 650, "Eg(3)", "medium-strong (~639)",
     "TiO2 anatase"),
    (440, 455, "Eg", "strong, broad (~447)",
     "TiO2 rutile"),
    (605, 620, "A1g", "strong (~612)",
     "TiO2 rutile"),
    (230, 245, "multi-phonon", "medium, broad (~235)",
     "TiO2 rutile"),
    (95, 102, "E2(low)", "strong, sharp (~99)",
     "ZnO (wurtzite)"),
    (432, 442, "E2(high)", "strong, sharp (~438)",
     "ZnO (wurtzite); crystal quality marker"),
    (325, 335, "E2(high)-E2(low)", "medium (~331)",
     "ZnO second order"),
    (570, 590, "A1(LO)/E1(LO)", "medium, defect-enhanced (~574-584)",
     "ZnO (oxygen vacancies / defects)"),
    (455, 470, "F2g", "very strong, sharp (~464)",
     "CeO2 (fluorite); shifts/broadens with O vacancies"),
    (590, 610, "defect D band", "weak, broad (~600)",
     "CeO2 oxygen-vacancy defect band"),

    # --- Iron / manganese / cobalt / nickel / copper oxides -----------------
    (220, 230, "A1g", "strong (~225)",
     "alpha-Fe2O3 hematite"),
    (240, 250, "Eg", "medium (~245)",
     "alpha-Fe2O3 hematite"),
    (285, 300, "Eg doublet", "strong (~292)",
     "alpha-Fe2O3 hematite"),
    (405, 415, "Eg", "medium (~411)",
     "alpha-Fe2O3 hematite"),
    (495, 505, "A1g", "weak (~500)",
     "alpha-Fe2O3 hematite"),
    (605, 620, "Eg", "medium (~613)",
     "alpha-Fe2O3 hematite"),
    (1300, 1330, "two-magnon", "strong, broad (~1320)",
     "alpha-Fe2O3 hematite"),
    (660, 675, "A1g", "strong, broad (~668)",
     "Fe3O4 magnetite (laser-sensitive: oxidises to hematite)"),
    (295, 310, "Fe-OH modes", "medium (~300, ~385, ~480)",
     "alpha-FeOOH goethite"),
    (650, 660, "Mn-O A1g", "strong (~658)",
     "Mn3O4 hausmannite"),
    (625, 650, "Mn-O stretch", "strong (~630-640)",
     "MnO2 / birnessite-type manganese oxides"),
    (188, 200, "F2g(1)", "medium (~194)",
     "Co3O4 spinel"),
    (475, 490, "Eg", "medium (~482)",
     "Co3O4 spinel"),
    (685, 695, "A1g", "very strong (~691)",
     "Co3O4 spinel"),
    (540, 560, "Ni-O 1LO", "broad (~550)",
     "NiO (defective; strengthens with disorder)"),
    (1080, 1110, "Ni-O 2M/2LO", "broad (~1090)",
     "NiO two-magnon / two-phonon"),
    (210, 225, "Cu2O T2g? (~218)", "medium",
     "Cu2O cuprite"),
    (290, 300, "Ag", "medium (~296)",
     "CuO tenorite"),
    (340, 350, "Bg", "weak (~346)",
     "CuO tenorite"),
    (625, 640, "Bg", "weak (~631)",
     "CuO tenorite"),

    # --- W / Mo / V / Sn / Zr / Al oxides -----------------------------------
    (800, 815, "W-O-W stretch", "very strong (~807)",
     "WO3 (monoclinic)"),
    (710, 725, "W-O-W stretch", "strong (~715)",
     "WO3 (monoclinic)"),
    (265, 280, "W-O-W bend", "medium (~270)",
     "WO3"),
    (950, 970, "W=O terminal", "medium (~960)",
     "Hydrated / amorphous tungsten oxide"),
    (990, 1000, "Mo=O terminal", "strong, sharp (~996)",
     "alpha-MoO3"),
    (815, 825, "Mo-O-Mo stretch", "very strong (~820)",
     "alpha-MoO3"),
    (660, 675, "Mo-O-Mo bridge", "medium (~667)",
     "alpha-MoO3"),
    (990, 1000, "V=O terminal", "very strong (~994)",
     "V2O5"),
    (695, 705, "V-O-V", "medium (~700)",
     "V2O5"),
    (140, 150, "layer bending", "very strong (~145)",
     "V2O5 (also anatase Eg ~144 - check the other anatase bands)"),
    (628, 640, "A1g", "medium (~634)",
     "SnO2 cassiterite"),
    (770, 780, "B2g", "weak (~775)",
     "SnO2 cassiterite"),
    (170, 195, "monoclinic doublet", "medium (~178/190)",
     "ZrO2 monoclinic (baddeleyite)"),
    (455, 480, "tetragonal Eg", "medium (~460-476)",
     "ZrO2 (tetragonal/monoclinic region)"),
    (410, 420, "A1g", "strong (~418)",
     "alpha-Al2O3 corundum (sapphire substrate)"),
    (640, 650, "Eg", "weak (~645)",
     "alpha-Al2O3 corundum"),
    (300, 312, "Bi-O / perovskite mode", "medium",
     "Bi2O3 / Aurivillius oxides (region marker)"),
    (695, 735, "MO6 octahedra stretch", "broad",
     "Perovskite oxide B-site octahedra (BaTiO3 ~720, LaMnO3 ~660)"),
    (515, 525, "BaTiO3 A1(TO)", "medium (~520; overlaps Si!)",
     "BaTiO3 (tetragonal)"),
    (300, 310, "BaTiO3 B1/E", "sharp (~305): tetragonality marker",
     "BaTiO3 (tetragonal)"),

    # --- Inorganic ions & minerals ------------------------------------------
    (1080, 1092, "CO3 2- ν1 sym. stretch", "very strong, sharp (~1086)",
     "Calcite / carbonates (aragonite ~1085, dolomite ~1098)"),
    (705, 717, "CO3 2- ν4 bend", "weak (~712 calcite, ~705 aragonite)",
     "Carbonate in-plane bend"),
    (276, 288, "lattice mode", "medium (~281)",
     "Calcite lattice mode"),
    (1045, 1075, "NO3- ν1 sym. stretch", "very strong (~1050-1068)",
     "Nitrates (NaNO3 ~1068, KNO3 ~1050)"),
    (980, 995, "SO4 2- ν1 sym. stretch", "very strong (~985-990)",
     "Sulfates (barite ~988, anhydrite ~1017)"),
    (1004, 1012, "SO4 2- ν1 (gypsum)", "very strong, sharp (~1008)",
     "Gypsum CaSO4·2H2O"),
    (955, 965, "PO4 3- ν1 sym. stretch", "very strong (~960)",
     "Apatite / calcium phosphates (bone, HA coatings)"),
    (460, 468, "Si-O-Si sym. stretch", "strong, sharp (~464)",
     "alpha-quartz"),
    (200, 212, "quartz lattice", "medium (~206)",
     "alpha-quartz"),
    (505, 515, "ring breathing", "strong (~505-513)",
     "Feldspars"),
    (1005, 1012, "SiO4 ν1", "very strong (~1008)",
     "Zircon ZrSiO4"),
    (815, 860, "SiO4 doublet", "strong (~823 + ~856)",
     "Olivine (forsterite-fayalite)"),
    (340, 385, "FeS2 Ag/Eg", "strong (~343, ~379)",
     "Pyrite"),
    (960, 975, "MoO4/WO4 ν1", "very strong (~965 scheelite-type)",
     "Molybdates / tungstates (CaWO4 ~911, CaMoO4 ~878 region varies)"),

    # --- Hydroxyl / water ----------------------------------------------------
    (3550, 3700, "O-H stretch (free/M-OH)", "medium, sharp",
     "Surface / structural hydroxyl (portlandite ~3620, brucite ~3652)"),
    (3100, 3500, "O-H stretch (H-bonded)", "weak-medium, very broad",
     "Water / hydrated phases (Raman-weak)"),
    (1630, 1650, "H-O-H bend", "very weak (~1640)",
     "Molecular water"),

    # --- Organic / polymer groups -------------------------------------------
    (2840, 2980, "C-H stretch (sp3)", "strong",
     "Alkane CH2/CH3 (polymers, organics)"),
    (3000, 3110, "=C-H / Ar-H stretch", "medium",
     "Alkene / aromatic C-H"),
    (2225, 2260, "C≡N stretch", "strong (~2230 conjugated)",
     "Nitriles (PAN ~2243)"),
    (2100, 2260, "C≡C stretch", "strong",
     "Alkynes / conjugated carbynes"),
    (1655, 1680, "C=C stretch", "strong",
     "Alkenes (trans ~1670, cis ~1657)"),
    (1580, 1615, "ring C=C stretch", "strong (~1600-1614)",
     "Aromatic ring (PET ~1614, polystyrene ~1602)"),
    (1720, 1740, "C=O stretch", "weak-medium (Raman-weak)",
     "Ester / carboxyl carbonyl (PET ~1725)"),
    (995, 1010, "ring breathing", "very strong, sharp (~1001)",
     "Monosubstituted benzene (polystyrene 1001, toluene 1003)"),
    (1430, 1470, "CH2/CH3 bend", "medium (~1440-1460)",
     "Alkane deformation (polyethylene 1440)"),
    (1050, 1135, "C-C skeletal stretch", "medium (PE 1062/1130)",
     "Polymer backbone (all-trans marker in PE)"),
    (1290, 1305, "CH2 twist", "medium (~1296)",
     "Polyethylene / long alkyl chains"),
    (620, 640, "C-S stretch", "medium",
     "Thiols / sulfides (organosulfur)"),
    (505, 525, "S-S stretch", "strong (~510; overlaps Si!)",
     "Disulfide bridge (proteins, vulcanised rubber)"),
    (1000, 1006, "phenylalanine ring", "strong, sharp (~1003)",
     "Proteins / biological tissue"),

    # --- Substrate, filter and atmospheric lines -----------------------------
    (2325, 2335, "N2 stretch", "sharp (~2331)",
     "Nitrogen (air, in the laser path or purge)"),
    (1550, 1560, "O2 stretch", "sharp (~1555)",
     "Oxygen (air, in the laser path)"),
    (1040, 1110, "Si-O stretch (glass)", "very broad, weak",
     "Glass slide / cuvette background"),
    (540, 580, "Si-O bend (glass)", "very broad, weak",
     "Glass slide / cuvette background"),
    (0, 120, "Rayleigh wing / notch edge", "rising edge",
     "Rayleigh line, notch/edge filter cut-off region"),
]


def _normalised_bands():
    """Yield bands as (hi, lo, mode, intensity, assignment), hi >= lo."""
    for wn_a, wn_b, mode, intensity, assignment in RAMAN_BANDS:
        yield (max(wn_a, wn_b), min(wn_a, wn_b), mode, intensity, assignment)


def find_assignments(shift, tolerance=10.0):
    """All library bands whose range (± tolerance) contains the given shift,
    most specific (narrowest range) first; centrality breaks ties."""
    matches = []
    for hi, lo, mode, intensity, assignment in _normalised_bands():
        if (lo - tolerance) <= shift <= (hi + tolerance):
            width = hi - lo
            centre = 0.5 * (hi + lo)
            matches.append((width, abs(shift - centre),
                            hi, lo, mode, intensity, assignment))
    matches.sort(key=lambda m: (m[0], m[1]))
    return [{'range': (m[2], m[3]), 'mode': m[4],
             'intensity': m[5], 'assignment': m[6]} for m in matches]


def best_assignment_text(shift, tolerance=10.0, max_matches=2):
    """Compact one-line assignment string for a detected band."""
    matches = find_assignments(shift, tolerance)
    if not matches:
        return "Unassigned"
    return "; ".join(f"{m['mode']} ({m['assignment']})"
                     for m in matches[:max_matches])
