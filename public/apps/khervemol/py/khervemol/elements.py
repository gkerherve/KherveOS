"""Element data: CPK colours, display radii, typical valence, names.

The single source of truth for per-element appearance and chemistry used
across the model engine, the 3D viewer and the 2D sketcher. Covers the
whole periodic table (Z = 1..118): full names, atomic numbers and Jmol
CPK colours, plus tuned ball-and-stick radii / valences for the common
elements and sensible defaults for the rest.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from PyQt5.QtGui import QColor

#: Element symbols in atomic-number order (index 0 == Z 1).
SYMBOLS = [
    "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al",
    "Si", "P", "S", "Cl", "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe",
    "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr",
    "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
    "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd", "Pm", "Sm",
    "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta", "W",
    "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn",
    "Fr", "Ra", "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf",
    "Es", "Fm", "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds",
    "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
]

_NAMES = [
    "Hydrogen", "Helium", "Lithium", "Beryllium", "Boron", "Carbon",
    "Nitrogen", "Oxygen", "Fluorine", "Neon", "Sodium", "Magnesium",
    "Aluminium", "Silicon", "Phosphorus", "Sulfur", "Chlorine", "Argon",
    "Potassium", "Calcium", "Scandium", "Titanium", "Vanadium", "Chromium",
    "Manganese", "Iron", "Cobalt", "Nickel", "Copper", "Zinc", "Gallium",
    "Germanium", "Arsenic", "Selenium", "Bromine", "Krypton", "Rubidium",
    "Strontium", "Yttrium", "Zirconium", "Niobium", "Molybdenum",
    "Technetium", "Ruthenium", "Rhodium", "Palladium", "Silver", "Cadmium",
    "Indium", "Tin", "Antimony", "Tellurium", "Iodine", "Xenon", "Caesium",
    "Barium", "Lanthanum", "Cerium", "Praseodymium", "Neodymium",
    "Promethium", "Samarium", "Europium", "Gadolinium", "Terbium",
    "Dysprosium", "Holmium", "Erbium", "Thulium", "Ytterbium", "Lutetium",
    "Hafnium", "Tantalum", "Tungsten", "Rhenium", "Osmium", "Iridium",
    "Platinum", "Gold", "Mercury", "Thallium", "Lead", "Bismuth", "Polonium",
    "Astatine", "Radon", "Francium", "Radium", "Actinium", "Thorium",
    "Protactinium", "Uranium", "Neptunium", "Plutonium", "Americium",
    "Curium", "Berkelium", "Californium", "Einsteinium", "Fermium",
    "Mendelevium", "Nobelium", "Lawrencium", "Rutherfordium", "Dubnium",
    "Seaborgium", "Bohrium", "Hassium", "Meitnerium", "Darmstadtium",
    "Roentgenium", "Copernicium", "Nihonium", "Flerovium", "Moscovium",
    "Livermorium", "Tennessine", "Oganesson",
]

NUMBERS = {sym: i + 1 for i, sym in enumerate(SYMBOLS)}
NAMES = {sym: _NAMES[i] for i, sym in enumerate(SYMBOLS)}

#: Standard (conventional) atomic weights, g/mol, in atomic-number order.
_WEIGHTS = [
    1.008, 4.0026, 6.94, 9.0122, 10.81, 12.011, 14.007, 15.999, 18.998, 20.180,
    22.990, 24.305, 26.982, 28.085, 30.974, 32.06, 35.45, 39.948, 39.098,
    40.078, 44.956, 47.867, 50.942, 51.996, 54.938, 55.845, 58.933, 58.693,
    63.546, 65.38, 69.723, 72.630, 74.922, 78.971, 79.904, 83.798, 85.468,
    87.62, 88.906, 91.224, 92.906, 95.95, 98.0, 101.07, 102.91, 106.42, 107.87,
    112.41, 114.82, 118.71, 121.76, 127.60, 126.90, 131.29, 132.91, 137.33,
    138.91, 140.12, 140.91, 144.24, 145.0, 150.36, 151.96, 157.25, 158.93,
    162.50, 164.93, 167.26, 168.93, 173.05, 174.97, 178.49, 180.95, 183.84,
    186.21, 190.23, 192.22, 195.08, 196.97, 200.59, 204.38, 207.2, 208.98,
    209.0, 210.0, 222.0, 223.0, 226.0, 227.0, 232.04, 231.04, 238.03, 237.0,
    244.0, 243.0, 247.0, 247.0, 251.0, 252.0, 257.0, 258.0, 259.0, 266.0,
    267.0, 268.0, 269.0, 270.0, 269.0, 278.0, 281.0, 282.0, 285.0, 286.0,
    289.0, 290.0, 293.0, 294.0, 294.0,
]
WEIGHTS = {sym: _WEIGHTS[i] for i, sym in enumerate(SYMBOLS)}

#: Standard Jmol CPK colours for every element (fallback appearance).
_JMOL = {
    "H": "#ffffff", "He": "#d9ffff", "Li": "#cc80ff", "Be": "#c2ff00",
    "B": "#ffb5b5", "C": "#909090", "N": "#3050f8", "O": "#ff0d0d",
    "F": "#90e050", "Ne": "#b3e3f5", "Na": "#ab5cf2", "Mg": "#8aff00",
    "Al": "#bfa6a6", "Si": "#f0c8a0", "P": "#ff8000", "S": "#ffff30",
    "Cl": "#1ff01f", "Ar": "#80d1e3", "K": "#8f40d4", "Ca": "#3dff00",
    "Sc": "#e6e6e6", "Ti": "#bfc2c7", "V": "#a6a6ab", "Cr": "#8a99c7",
    "Mn": "#9c7ac7", "Fe": "#e06633", "Co": "#f090a0", "Ni": "#50d050",
    "Cu": "#c88033", "Zn": "#7d80b0", "Ga": "#c28f8f", "Ge": "#668f8f",
    "As": "#bd80e3", "Se": "#ffa100", "Br": "#a62929", "Kr": "#5cb8d1",
    "Rb": "#702eb0", "Sr": "#00ff00", "Y": "#94ffff", "Zr": "#94e0e0",
    "Nb": "#73c2c9", "Mo": "#54b5b5", "Tc": "#3b9e9e", "Ru": "#248f8f",
    "Rh": "#0a7d8c", "Pd": "#006985", "Ag": "#c0c0c0", "Cd": "#ffd98f",
    "In": "#a67573", "Sn": "#668080", "Sb": "#9e63b5", "Te": "#d47a00",
    "I": "#940094", "Xe": "#429eb0", "Cs": "#57178f", "Ba": "#00c900",
    "La": "#70d4ff", "Ce": "#ffffc7", "Pr": "#d9ffc7", "Nd": "#c7ffc7",
    "Pm": "#a3ffc7", "Sm": "#8fffc7", "Eu": "#61ffc7", "Gd": "#45ffc7",
    "Tb": "#30ffc7", "Dy": "#1fffc7", "Ho": "#00ff9c", "Er": "#00e675",
    "Tm": "#00d452", "Yb": "#00bf38", "Lu": "#00ab24", "Hf": "#4dc2ff",
    "Ta": "#4da6ff", "W": "#2194d6", "Re": "#267dab", "Os": "#266696",
    "Ir": "#175487", "Pt": "#d0d0e0", "Au": "#ffd123", "Hg": "#b8b8d0",
    "Tl": "#a6544d", "Pb": "#575961", "Bi": "#9e4fb5", "Po": "#ab5c00",
    "At": "#754f45", "Rn": "#428296", "Fr": "#420066", "Ra": "#007d00",
    "Ac": "#70abfa", "Th": "#00baff", "Pa": "#00a1ff", "U": "#008fff",
    "Np": "#0080ff", "Pu": "#006bff", "Am": "#545cf2", "Cm": "#785ce3",
    "Bk": "#8a4fe3", "Cf": "#a136d4", "Es": "#b31fd4", "Fm": "#b31fba",
    "Md": "#b30da6", "No": "#bd0d87", "Lr": "#c70066", "Rf": "#cc0059",
    "Db": "#d1004f", "Sg": "#d90045", "Bh": "#e00038", "Hs": "#e6002e",
    "Mt": "#eb0026", "Ds": "#c9c9c9", "Rg": "#c9c9c9", "Cn": "#c9c9c9",
    "Nh": "#c9c9c9", "Fl": "#c9c9c9", "Mc": "#c9c9c9", "Lv": "#c9c9c9",
    "Ts": "#c9c9c9", "Og": "#c9c9c9",
}

#: Tuned ball-and-stick body colours for common elements (nicer than raw
#: Jmol for a lit-sphere look); everything else falls back to _JMOL.
COLORS = {
    "H": "#f4f4f4", "C": "#3a3a3a", "N": "#3050f8", "O": "#e01f1f",
    "F": "#77d84a", "Cl": "#37c837", "Br": "#a1443c", "I": "#8f2fbf",
    "P": "#ff8000", "S": "#e6c72a", "B": "#f0a0a0", "Si": "#b89078",
    "Na": "#9a54e0", "K": "#7d38cc", "Mg": "#63d84b", "Ca": "#3dc23d",
    "Fe": "#e06633", "Zn": "#7d80b0", "Cu": "#c86a3a", "Al": "#b0b0c0",
    "Ti": "#9aa0a6", "Cs": "#57178f",
}

#: Relative ball radius per element (ball-and-stick look); default 0.7.
RADII = {
    "H": 0.36, "He": 0.40, "Li": 0.90, "Be": 0.70, "B": 0.62,
    "C": 0.58, "N": 0.56, "O": 0.55, "F": 0.52, "Ne": 0.50,
    "Na": 0.95, "Mg": 0.80, "Al": 0.82, "Si": 0.80, "P": 0.78,
    "S": 0.76, "Cl": 0.74, "Ar": 0.72, "K": 1.05, "Ca": 0.98,
    "Ti": 0.84, "Cr": 0.80, "Mn": 0.80, "Fe": 0.80, "Co": 0.78,
    "Ni": 0.78, "Cu": 0.80, "Zn": 0.80, "Br": 0.82, "I": 0.92,
    "Cs": 1.15, "Au": 0.90, "Ag": 0.92, "Pt": 0.90, "Pb": 1.00,
}
_DEFAULT_RADIUS = 0.72

#: Typical valence (max bonds) — the builder tracks free bonds; default 4.
#: He/Ne/Ar are inert (0 bonds); Kr/Xe do form compounds (KrF2, XeF2/4/6).
VALENCE = {"H": 1, "C": 4, "N": 3, "O": 2, "F": 1, "Cl": 1, "Br": 1,
           "I": 1, "S": 2, "P": 3, "B": 3, "Si": 4, "Na": 1, "Mg": 2,
           "Al": 3, "Ca": 2, "K": 1, "Zn": 2, "He": 0, "Ne": 0, "Ar": 0,
           "Kr": 2, "Xe": 6}

#: Elements offered in the 3D viewer's quick Add-atom palette.
PALETTE = ["H", "C", "N", "O", "F", "P", "S", "Cl", "Br", "I"]

# -------------------------------------------------------------- bond lengths
#: Single-bond covalent radii in ångström (Cordero et al., Dalton Trans.
#: 2008, 2832). Summing two of them approximates any A–B single bond.
COVALENT = {
    "H": 0.31, "He": 0.28, "Li": 1.28, "Be": 0.96, "B": 0.84, "C": 0.76,
    "N": 0.71, "O": 0.66, "F": 0.57, "Ne": 0.58, "Na": 1.66, "Mg": 1.41,
    "Al": 1.21, "Si": 1.11, "P": 1.07, "S": 1.05, "Cl": 1.02, "Ar": 1.06,
    "K": 2.03, "Ca": 1.76, "Sc": 1.70, "Ti": 1.60, "V": 1.53, "Cr": 1.39,
    "Mn": 1.39, "Fe": 1.32, "Co": 1.26, "Ni": 1.24, "Cu": 1.32, "Zn": 1.22,
    "Ga": 1.22, "Ge": 1.20, "As": 1.19, "Se": 1.20, "Br": 1.20, "Kr": 1.16,
    "Rb": 2.20, "Sr": 1.95, "Y": 1.90, "Zr": 1.75, "Nb": 1.64, "Mo": 1.54,
    "Tc": 1.47, "Ru": 1.46, "Rh": 1.42, "Pd": 1.39, "Ag": 1.45, "Cd": 1.44,
    "In": 1.42, "Sn": 1.39, "Sb": 1.39, "Te": 1.38, "I": 1.39, "Xe": 1.40,
    "Cs": 2.44, "Ba": 2.15, "La": 2.07, "Ce": 2.04, "Pr": 2.03, "Nd": 2.01,
    "Pm": 1.99, "Sm": 1.98, "Eu": 1.98, "Gd": 1.96, "Tb": 1.94, "Dy": 1.92,
    "Ho": 1.92, "Er": 1.89, "Tm": 1.90, "Yb": 1.87, "Lu": 1.87, "Hf": 1.75,
    "Ta": 1.70, "W": 1.62, "Re": 1.51, "Os": 1.44, "Ir": 1.41, "Pt": 1.36,
    "Au": 1.36, "Hg": 1.32, "Tl": 1.45, "Pb": 1.46, "Bi": 1.48, "Po": 1.40,
    "At": 1.50, "Rn": 1.50, "Fr": 2.60, "Ra": 2.21, "Ac": 2.15, "Th": 2.06,
    "Pa": 2.00, "U": 1.96, "Np": 1.90, "Pu": 1.87, "Am": 1.80, "Cm": 1.69,
    "Bk": 1.68, "Cf": 1.68, "Es": 1.65, "Fm": 1.67, "Md": 1.73, "No": 1.76,
    "Lr": 1.61, "Rf": 1.57, "Db": 1.49, "Sg": 1.43, "Bh": 1.41, "Hs": 1.34,
    "Mt": 1.29, "Ds": 1.28, "Rg": 1.21, "Cn": 1.22, "Nh": 1.36, "Fl": 1.43,
    "Mc": 1.62, "Lv": 1.75, "Ts": 1.65, "Og": 1.57,
}
_DEFAULT_COVALENT = 1.50

#: Double / triple bonds are shorter than the single-bond radius sum. Tuned
#: so C=C → 1.34 Å and C≡C → 1.19 Å fall out of the generic formula.
_ORDER_SHRINK = {1: 1.00, 2: 0.88, 3: 0.78}

#: Experimental equilibrium lengths (Å) for the pairs a builder actually
#: meets, keyed ``(lighter symbol, heavier symbol, order)``. These win over
#: the radius-sum estimate; everything else falls back to it.
_BOND_LENGTHS = {
    ("C", "C", 1): 1.54, ("C", "C", 2): 1.34, ("C", "C", 3): 1.20,
    ("C", "H", 1): 1.09, ("C", "N", 1): 1.47, ("C", "N", 2): 1.28,
    ("C", "N", 3): 1.16, ("C", "O", 1): 1.43, ("C", "O", 2): 1.23,
    ("C", "S", 1): 1.82, ("C", "S", 2): 1.60, ("C", "F", 1): 1.35,
    ("C", "Cl", 1): 1.77, ("Br", "C", 1): 1.94, ("C", "I", 1): 2.14,
    ("C", "P", 1): 1.84, ("C", "Si", 1): 1.86, ("B", "C", 1): 1.56,
    ("H", "N", 1): 1.01, ("N", "N", 1): 1.45, ("N", "N", 2): 1.25,
    ("N", "N", 3): 1.10, ("N", "O", 1): 1.40, ("N", "O", 2): 1.21,
    ("H", "O", 1): 0.96, ("O", "O", 1): 1.48, ("O", "O", 2): 1.21,
    ("H", "S", 1): 1.34, ("S", "S", 1): 2.05, ("O", "S", 1): 1.57,
    ("O", "S", 2): 1.43, ("H", "P", 1): 1.44, ("O", "P", 1): 1.63,
    ("O", "P", 2): 1.50, ("Cl", "P", 1): 2.04, ("H", "Si", 1): 1.48,
    ("O", "Si", 1): 1.63, ("B", "H", 1): 1.19, ("B", "O", 1): 1.36,
    ("B", "N", 1): 1.42, ("H", "H", 1): 0.74, ("F", "H", 1): 0.92,
    ("Cl", "H", 1): 1.27, ("Br", "H", 1): 1.41, ("H", "I", 1): 1.61,
    ("F", "F", 1): 1.42, ("Cl", "Cl", 1): 1.99, ("Br", "Br", 1): 2.28,
    ("I", "I", 1): 2.67,
}

# ---------------------------------------------------------- table geometry
#: Each period as a row of 18 symbols (None = a gap in that group). Period 6
#: and 7 keep La / Ac in group 3; the f-block (Ce..Lu, Th..Lr) sits below.
_PERIODS = [
    ["H"] + [None] * 16 + ["He"],
    ["Li", "Be"] + [None] * 10 + ["B", "C", "N", "O", "F", "Ne"],
    ["Na", "Mg"] + [None] * 10 + ["Al", "Si", "P", "S", "Cl", "Ar"],
    ["K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
     "Ga", "Ge", "As", "Se", "Br", "Kr"],
    ["Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd",
     "In", "Sn", "Sb", "Te", "I", "Xe"],
    ["Cs", "Ba", "La", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
     "Tl", "Pb", "Bi", "Po", "At", "Rn"],
    ["Fr", "Ra", "Ac", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn",
     "Nh", "Fl", "Mc", "Lv", "Ts", "Og"],
]
_LANTHANIDES = ["Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho",
                "Er", "Tm", "Yb", "Lu"]
_ACTINIDES = ["Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es",
              "Fm", "Md", "No", "Lr"]


def table_cells():
    """Yield ``(symbol, row, col)`` for the whole periodic table.

    Main body occupies rows 1..7, columns 1..18; the two f-block series sit
    in rows 9 and 10 (a blank row 8 leaves a gap), columns 4..17 — the
    classic wide layout."""
    for r, period in enumerate(_PERIODS, start=1):
        for c, sym in enumerate(period, start=1):
            if sym is not None:
                yield sym, r, c
    for c, sym in enumerate(_LANTHANIDES, start=4):
        yield sym, 9, c
    for c, sym in enumerate(_ACTINIDES, start=4):
        yield sym, 10, c


# -------------------------------------------------------------- accessors
def color(element: str) -> str:
    return COLORS.get(element) or _JMOL.get(element, "#c8c8c8")


def radius(element: str) -> float:
    return RADII.get(element, _DEFAULT_RADIUS)


def valence(element: str) -> int:
    return VALENCE.get(element, 4)


def name(element: str) -> str:
    return NAMES.get(element, element)


def number(element: str):
    return NUMBERS.get(element)


def weight(element: str) -> float:
    return WEIGHTS.get(element, 0.0)


def text_color(element: str) -> str:
    """Readable ink colour for a chip filled with the element's colour.

    Judged on **perceived** brightness, not HSL lightness: a saturated blue
    like nitrogen's #3050f8 is "light" by lightness but dark to the eye, so
    lightness alone put black ink on it."""
    c = QColor(color(element))
    luma = (0.299 * c.red() + 0.587 * c.green() + 0.114 * c.blue()) / 255.0
    return "#111" if luma > 0.6 else "#fff"


def covalent_radius(element: str) -> float:
    return COVALENT.get(element, _DEFAULT_COVALENT)


def bond_length(a: str, b: str, order: int = 1) -> float:
    """Equilibrium length in ångström of an *a*–*b* bond of *order*.

    Looks the pair up in the experimental table (C–O 1.43, C=O 1.23, …) and
    otherwise estimates it as the covalent-radius sum, shortened for double
    and triple bonds. Symmetric in *a* and *b*."""
    order = max(1, min(3, int(order)))
    key = (a, b) if a <= b else (b, a)
    exact = _BOND_LENGTHS.get((key[0], key[1], order))
    if exact is not None:
        return exact
    span = covalent_radius(a) + covalent_radius(b)
    return span * _ORDER_SHRINK[order]
