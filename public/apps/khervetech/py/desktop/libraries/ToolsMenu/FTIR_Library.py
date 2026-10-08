# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/FTIR_Library.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/FTIR_Library.py
"""
FTIR band-assignment library.

A standard infrared correlation table (organic functional groups plus common
inorganic ions, adsorbed species and metal-oxide lattice modes) used by the
FTIR Analysis tool to assign detected bands.

Each entry: (wn_min, wn_max, vibration, intensity/shape, assignment)
Wavenumbers in cm-1.
"""

# ---------------------------------------------------------------------------
# Band table
# ---------------------------------------------------------------------------
FTIR_BANDS = [
    # --- O-H / N-H / C-H stretching region (4000-2500) ---------------------
    (3700, 3584, "O-H stretch (free)", "medium, sharp", "Free hydroxyl / alcohol (non-bonded)"),
    (3650, 3580, "O-H stretch (M-OH)", "sharp", "Surface hydroxyl on oxides / hydroxides"),
    (3550, 3200, "O-H stretch (H-bonded)", "strong, broad", "Alcohols, hydroxides, hydrated species"),
    (3500, 3300, "N-H stretch", "medium", "Primary amines (doublet) / secondary amines (single)"),
    (3400, 3100, "O-H stretch (water)", "strong, very broad", "Adsorbed / lattice water"),
    (3333, 3267, "≡C-H stretch", "strong, sharp", "Terminal alkyne"),
    (3300, 2500, "O-H stretch (acid)", "strong, very broad", "Carboxylic acid dimer"),
    (3100, 3000, "=C-H / Ar-H stretch", "medium", "Alkene / aromatic C-H"),
    (3000, 2840, "C-H stretch (sp3)", "medium-strong", "Alkane CH3/CH2 (2960, 2925, 2870, 2850)"),
    (2830, 2695, "C-H stretch (aldehyde)", "medium, doublet", "Aldehyde (Fermi doublet ~2820/2720)"),

    # --- Triple bond / cumulated region (2500-2000) -------------------------
    (2400, 2320, "CO2 asym. stretch", "sharp doublet ~2360/2340", "Atmospheric CO2 (artifact) or gaseous CO2"),
    (2349, 2349, "CO2 (gas)", "sharp", "CO2 asymmetric stretch"),
    (2270, 2100, "Si-H stretch", "medium", "Silanes"),
    (2260, 2222, "C≡N stretch", "medium", "Nitriles"),
    (2260, 2100, "C≡C stretch", "weak-medium", "Alkynes"),
    (2200, 1900, "M-CO stretch", "strong", "Metal carbonyls"),
    (2160, 2120, "N=N=N stretch", "strong", "Azides"),

    # --- Carbonyl region (1900-1600) ----------------------------------------
    (1870, 1790, "C=O stretch", "strong (two bands)", "Acid anhydride"),
    (1815, 1785, "C=O stretch", "strong", "Acyl chloride"),
    (1750, 1735, "C=O stretch", "strong", "Ester"),
    (1740, 1720, "C=O stretch", "strong", "Aldehyde"),
    (1725, 1705, "C=O stretch", "strong", "Ketone"),
    (1720, 1706, "C=O stretch", "strong", "Carboxylic acid"),
    (1690, 1630, "C=O stretch (amide I)", "strong", "Amide"),
    (1680, 1600, "C=C stretch", "weak-medium", "Alkene"),
    (1690, 1620, "H-O-H bend", "medium", "Molecular water (adsorbed / hydrate)"),
    (1650, 1580, "N-H bend", "medium", "Primary amine"),

    # --- Fingerprint 1600-1300 ----------------------------------------------
    (1600, 1585, "C=C ring stretch", "medium", "Aromatic ring"),
    (1550, 1500, "N-O asym. stretch", "strong", "Nitro compound"),
    (1500, 1400, "C=C ring stretch", "medium", "Aromatic ring"),
    (1480, 1410, "CO3 2- ν3 stretch", "strong, broad", "Carbonate (e.g. BaCO3, SrCO3, CaCO3)"),
    (1465, 1440, "CH2 bend", "medium", "Alkane methylene scissoring"),
    (1390, 1380, "NO3- ν3 stretch", "strong, sharp (~1384)", "Nitrate"),
    (1385, 1365, "CH3 bend", "medium", "Alkane methyl (gem-dimethyl doublet)"),
    (1372, 1290, "N-O sym. stretch", "strong", "Nitro compound"),

    # --- Fingerprint 1300-1000 ----------------------------------------------
    (1310, 1250, "C-O stretch", "strong", "Aromatic ester"),
    (1300, 1150, "C-H bend / wag", "medium", "Alkyl halide CH2-X wag"),
    (1250, 1020, "C-N stretch", "medium", "Amines"),
    (1210, 1163, "C-O stretch", "strong", "Ester / ether"),
    (1150, 1085, "C-O-C asym. stretch", "strong", "Aliphatic ether"),
    (1130, 1080, "SO4 2- ν3 stretch", "strong, broad", "Sulfate"),
    (1100, 1000, "Si-O-Si / SiO4 stretch", "very strong, broad", "Silicates, glass"),
    (1090, 1040, "CO3 2- ν1 stretch", "weak", "Carbonate (symmetric stretch)"),
    (1085, 1050, "C-O stretch", "strong", "Primary alcohol"),
    (1120, 1030, "PO4 3- ν3 stretch", "very strong, broad", "Phosphates, apatites"),

    # --- Below 1000: bending / out-of-plane / lattice ------------------------
    (995, 985, "=C-H oop bend", "strong", "Vinyl (monosubstituted alkene)"),
    (980, 960, "trans =C-H oop bend", "strong", "Trans-disubstituted alkene"),
    (900, 875, "CO3 2- ν2 bend", "medium-sharp (~860-880)", "Carbonate out-of-plane bend"),
    (890, 790, "Ar-H oop bend", "strong", "Aromatic substitution pattern"),
    (880, 850, "CO3 2- ν2 bend", "sharp", "Carbonate (BaCO3 ~858, CaCO3 ~875)"),
    (850, 550, "C-Cl stretch", "strong", "Alkyl chloride"),
    (800, 780, "Si-O stretch", "medium", "Quartz doublet"),
    (730, 665, "cis =C-H oop bend", "strong", "Cis-disubstituted alkene"),
    (720, 700, "CO3 2- ν4 bend", "weak-medium", "Carbonate in-plane bend (calcite ~712)"),
    (700, 600, "C-Br stretch", "strong", "Alkyl bromide"),
    (700, 500, "M-O stretch", "strong, broad", "Metal-oxygen lattice (perovskite B-site octahedra)"),
    (600, 400, "M-O bend / lattice", "strong, broad", "Metal-oxide lattice modes"),
]


def find_assignments(wavenumber, tolerance=10.0):
    """Return all library bands whose range (± tolerance) contains the given
    wavenumber, most specific assignment first.

    Ranking by centrality alone is wrong: a very broad entry (the 3300-2500
    carboxylic-acid O-H, say) is "central" almost everywhere and would beat
    the narrow, chemically meaningful 3000-2840 C-H entry for a sharp 2916
    band. Narrower ranges carry more information, so width is the primary
    key and centrality only breaks ties.
    """
    matches = []
    for wn_hi, wn_lo, vibration, intensity, assignment in _normalised_bands():
        if (wn_lo - tolerance) <= wavenumber <= (wn_hi + tolerance):
            width = wn_hi - wn_lo
            centre = 0.5 * (wn_hi + wn_lo)
            matches.append((width, abs(wavenumber - centre),
                            wn_hi, wn_lo, vibration, intensity, assignment))
    matches.sort(key=lambda m: (m[0], m[1]))
    return [{'range': (m[2], m[3]), 'vibration': m[4],
             'intensity': m[5], 'assignment': m[6]} for m in matches]


def best_assignment_text(wavenumber, tolerance=10.0, max_matches=2):
    """Compact one-line assignment string for a detected band."""
    matches = find_assignments(wavenumber, tolerance)
    if not matches:
        return "Unassigned"
    parts = []
    for m in matches[:max_matches]:
        parts.append(f"{m['vibration']} ({m['assignment']})")
    return "; ".join(parts)


def _normalised_bands():
    """Yield bands as (wn_hi, wn_lo, vibration, intensity, assignment) with
    wn_hi >= wn_lo regardless of how the table row was written."""
    for wn_a, wn_b, vibration, intensity, assignment in FTIR_BANDS:
        yield (max(wn_a, wn_b), min(wn_a, wn_b), vibration, intensity, assignment)
