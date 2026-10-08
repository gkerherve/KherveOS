# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/TGA_Chem.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/TGA_Chem.py
"""
Chemistry behind the TGA calculators - no wx, so it can be exercised directly.

Two questions a thermogram is used to answer, both of which need a formula
mass:

*What did the sample lose?*  A measured step is compared with the mass
percentage a candidate species (H2O, CO2, O2, ...) would account for.  The
answer is only as good as the assumed formula unit, so the assumptions are
returned alongside the number rather than buried.

*How far did an oxide reduce?*  For a perovskite-type oxide ABO(3-d) the
oxygen released per formula unit follows directly from the relative mass
change, because oxygen is the only thing leaving:

    dd = (dm/m0) * M(A,B,O_3-d0) / M(O)

which is the standard treatment (see e.g. Mizusaki et al., or any oxygen
non-stoichiometry study on La(1-x)Sr(x)CoO(3-d)).
"""

import re

# Atomic masses (IUPAC 2021 conventional values, g/mol).  Only the elements
# that turn up in thermal analysis of oxides, carbonates and hydrates are
# listed; anything else raises rather than guessing.
ATOMIC_MASSES = {
    'H': 1.008, 'He': 4.0026, 'Li': 6.94, 'Be': 9.0122, 'B': 10.81,
    'C': 12.011, 'N': 14.007, 'O': 15.999, 'F': 18.998, 'Ne': 20.180,
    'Na': 22.990, 'Mg': 24.305, 'Al': 26.982, 'Si': 28.085, 'P': 30.974,
    'S': 32.06, 'Cl': 35.45, 'Ar': 39.948, 'K': 39.098, 'Ca': 40.078,
    'Sc': 44.956, 'Ti': 47.867, 'V': 50.942, 'Cr': 51.996, 'Mn': 54.938,
    'Fe': 55.845, 'Co': 58.933, 'Ni': 58.693, 'Cu': 63.546, 'Zn': 65.38,
    'Ga': 69.723, 'Ge': 72.630, 'As': 74.922, 'Se': 78.971, 'Br': 79.904,
    'Kr': 83.798, 'Rb': 85.468, 'Sr': 87.62, 'Y': 88.906, 'Zr': 91.224,
    'Nb': 92.906, 'Mo': 95.95, 'Tc': 98.0, 'Ru': 101.07, 'Rh': 102.91,
    'Pd': 106.42, 'Ag': 107.87, 'Cd': 112.41, 'In': 114.82, 'Sn': 118.71,
    'Sb': 121.76, 'Te': 127.60, 'I': 126.90, 'Xe': 131.29, 'Cs': 132.91,
    'Ba': 137.33, 'La': 138.91, 'Ce': 140.12, 'Pr': 140.91, 'Nd': 144.24,
    'Pm': 145.0, 'Sm': 150.36, 'Eu': 151.96, 'Gd': 157.25, 'Tb': 158.93,
    'Dy': 162.50, 'Ho': 164.93, 'Er': 167.26, 'Tm': 168.93, 'Yb': 173.05,
    'Lu': 174.97, 'Hf': 178.49, 'Ta': 180.95, 'W': 183.84, 'Re': 186.21,
    'Os': 190.23, 'Ir': 192.22, 'Pt': 195.08, 'Au': 196.97, 'Hg': 200.59,
    'Tl': 204.38, 'Pb': 207.2, 'Bi': 208.98, 'Th': 232.04, 'Pa': 231.04,
    'U': 238.03,
}

# Species commonly evolved in a thermogram, as (label, formula).
COMMON_SPECIES = (
    ('Water, H2O', 'H2O'),
    ('Carbon dioxide, CO2', 'CO2'),
    ('Oxygen, O2', 'O2'),
    ('Oxygen atom, O', 'O'),
    ('Carbon monoxide, CO', 'CO'),
    ('Hydrogen, H2', 'H2'),
    ('Ammonia, NH3', 'NH3'),
    ('Nitrogen dioxide, NO2', 'NO2'),
    ('Sulfur dioxide, SO2', 'SO2'),
)

# Token: an element symbol followed by an optional (possibly decimal) count.
_TOKEN = re.compile(r'([A-Z][a-z]?)(\d*\.?\d*)')


class FormulaError(ValueError):
    """Raised for a formula that cannot be turned into a composition."""


def parse_formula(formula):
    """Parse a chemical formula into ``{element: count}``.

    Handles nested parentheses with multipliers and fractional subscripts, so
    both ``Ba0.5Sr0.5Co0.8Fe0.2O2.9`` and ``La(NO3)3`` work.
    """
    text = str(formula).strip().replace(' ', '')
    if not text:
        raise FormulaError("The formula is empty.")

    counts, position = _parse_group(text, 0)
    if position != len(text):
        raise FormulaError(f"Unexpected '{text[position]}' at position "
                           f"{position + 1} of '{formula}'.")
    if not counts:
        raise FormulaError(f"No elements found in '{formula}'.")

    unknown = sorted(set(counts) - set(ATOMIC_MASSES))
    if unknown:
        raise FormulaError(f"Unknown element(s): {', '.join(unknown)}.")
    return counts


def _parse_group(text, position):
    """Parse until the end of the string or an unmatched ')'."""
    counts = {}
    while position < len(text):
        char = text[position]

        if char == ')':
            break

        if char == '(':
            inner, position = _parse_group(text, position + 1)
            if position >= len(text) or text[position] != ')':
                raise FormulaError("Unbalanced parenthesis.")
            position += 1  # consume ')'
            multiplier, position = _read_number(text, position)
            for element, count in inner.items():
                counts[element] = counts.get(element, 0.0) + count * multiplier
            continue

        match = _TOKEN.match(text, position)
        if not match or not match.group(1):
            raise FormulaError(f"Cannot read '{text[position:]}'.")
        element = match.group(1)
        count = float(match.group(2)) if match.group(2) else 1.0
        counts[element] = counts.get(element, 0.0) + count
        position = match.end()

    return counts, position


def _read_number(text, position):
    """Read an optional (possibly decimal) multiplier; default 1."""
    match = re.match(r'\d*\.?\d*', text[position:])
    token = match.group(0) if match else ''
    if not token:
        return 1.0, position
    return float(token), position + len(token)


def molar_mass(formula):
    """Molar mass of a formula, in g/mol."""
    counts = parse_formula(formula)
    return sum(ATOMIC_MASSES[element] * count
               for element, count in counts.items())


def format_composition(counts):
    """Render a ``{element: count}`` mapping back as a formula string."""
    parts = []
    for element, count in counts.items():
        if abs(count - round(count)) < 1e-9:
            count = int(round(count))
            parts.append(element if count == 1 else f"{element}{count}")
        else:
            parts.append(f"{element}{count:g}")
    return ''.join(parts)


# ---------------------------------------------------------------------------
# Theoretical mass change
# ---------------------------------------------------------------------------

def theoretical_mass_change(host_formula, species_formula, n_species=1.0,
                            measured_pct=None):
    """Mass percentage lost when ``n_species`` of a species leaves one formula
    unit of the host.

    Returns a dict with the two molar masses, the theoretical percentage, and
    - when ``measured_pct`` is given - the measured value, the difference and
    the number of species the measurement actually corresponds to.
    """
    host_mass = molar_mass(host_formula)
    species_mass = molar_mass(species_formula)
    if host_mass <= 0:
        raise FormulaError("The host formula has zero mass.")
    if n_species <= 0:
        raise FormulaError("The number of species must be greater than zero.")

    theoretical = 100.0 * n_species * species_mass / host_mass

    result = {
        'host_formula': host_formula,
        'host_molar_mass': host_mass,
        'species_formula': species_formula,
        'species_molar_mass': species_mass,
        'n_species': n_species,
        'theoretical_pct': theoretical,
        'measured_pct': None,
        'difference_pct': None,
        'n_species_measured': None,
        'assumptions': [
            f"One formula unit of {host_formula} (M = {host_mass:.3f} g/mol) "
            f"releases {n_species:g} x {species_formula} "
            f"(M = {species_mass:.3f} g/mol).",
            "The mass percentage is referred to the intact host, i.e. to the "
            "mass before the step.",
            "Nothing else leaves or is taken up over the same interval.",
        ],
    }

    if measured_pct is not None:
        measured = abs(float(measured_pct))
        result['measured_pct'] = measured
        result['difference_pct'] = measured - theoretical
        # How many species the measurement actually accounts for
        per_species = theoretical / n_species
        result['n_species_measured'] = measured / per_species if per_species else None

    return result


def format_theoretical(result):
    """Human-readable summary of :func:`theoretical_mass_change`."""
    lines = [
        f"{result['n_species']:g} x {result['species_formula']} from "
        f"{result['host_formula']}",
        f"  M(host)    = {result['host_molar_mass']:.3f} g/mol",
        f"  M(species) = {result['species_molar_mass']:.3f} g/mol",
        f"  Theoretical mass change = {result['theoretical_pct']:.3f} %",
    ]
    if result['measured_pct'] is not None:
        lines.append(f"  Measured                = {result['measured_pct']:.3f} %")
        lines.append(f"  Difference              = {result['difference_pct']:+.3f} %")
        if result['n_species_measured'] is not None:
            lines.append(f"  Corresponds to {result['n_species_measured']:.3f} x "
                         f"{result['species_formula']} per formula unit")
    lines.append("  Assumptions:")
    lines.extend(f"    - {line}" for line in result['assumptions'])
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Oxygen non-stoichiometry
# ---------------------------------------------------------------------------

def oxygen_nonstoichiometry(formula, delta_initial, mass_change_pct,
                            reference_mass_mg=None, oxygen_site_total=3.0):
    """Change in oxygen content of an oxide from a relative mass change.

    ``formula`` is the oxide as measured at the start of the step, e.g.
    ``BaCo0.4Fe0.4Zr0.1Y0.1O2.9``.  Oxygen being the only species leaving,

        dd = -(dm/m0) * M_oxide / M_O

    with dm/m0 the relative mass change (negative for a loss, which gives a
    positive dd, i.e. more vacancies).

    ``oxygen_site_total`` is the full oxygen stoichiometry of the ideal
    lattice (3 for a perovskite ABO3), used only to report the site fraction.
    """
    counts = parse_formula(formula)
    oxide_mass = sum(ATOMIC_MASSES[element] * count
                     for element, count in counts.items())
    if oxide_mass <= 0:
        raise FormulaError("The oxide formula has zero mass.")
    if 'O' not in counts:
        raise FormulaError(f"'{formula}' contains no oxygen.")

    oxygen_mass = ATOMIC_MASSES['O']
    relative_change = float(mass_change_pct) / 100.0

    # A mass loss (negative) means oxygen left, i.e. delta increases.
    delta_change = -relative_change * oxide_mass / oxygen_mass
    delta_final = float(delta_initial) + delta_change

    oxygen_initial = oxygen_site_total - float(delta_initial)
    oxygen_final = oxygen_site_total - delta_final

    result = {
        'formula': formula,
        'oxide_molar_mass': oxide_mass,
        'delta_initial': float(delta_initial),
        'delta_change': delta_change,
        'delta_final': delta_final,
        'oxygen_initial': oxygen_initial,
        'oxygen_final': oxygen_final,
        'mass_change_pct': float(mass_change_pct),
        # Moles of O per mole of oxide; O2 is half that
        'moles_o_per_mole': -delta_change,
        'moles_o2_per_mole': -delta_change / 2.0,
        'oxygen_storage_capacity_wt_pct': abs(relative_change) * 100.0,
        'oxygen_storage_capacity_umol_g': (abs(delta_change) / oxide_mass) * 1e6,
        'assumptions': [
            "Oxygen is the only species exchanged over the selected range - "
            "no carbonate, hydroxide or adsorbed water contributes.",
            f"The molar mass is taken from the formula as written "
            f"({formula}, M = {oxide_mass:.3f} g/mol), i.e. from the state at "
            f"the start of the range.",
            "The cation stoichiometry does not change.",
            "The relative mass change is referred to the mass at the start of "
            "the selected range.",
        ],
    }
    if reference_mass_mg:
        result['reference_mass_mg'] = float(reference_mass_mg)
        result['mass_change_mg'] = float(reference_mass_mg) * relative_change
    return result


def format_nonstoichiometry(result):
    """Human-readable summary of :func:`oxygen_nonstoichiometry`."""
    sign = "released" if result['delta_change'] > 0 else "taken up"
    lines = [
        f"Oxygen non-stoichiometry of {result['formula']}",
        f"  M(oxide)   = {result['oxide_molar_mass']:.3f} g/mol",
        f"  Mass change = {result['mass_change_pct']:+.4f} %",
        f"  delta:  {result['delta_initial']:.4f} -> {result['delta_final']:.4f} "
        f"({result['delta_change']:+.4f})",
        f"  Oxygen content: {result['oxygen_initial']:.4f} -> "
        f"{result['oxygen_final']:.4f} per formula unit",
        f"  Oxygen {sign}: {abs(result['moles_o_per_mole']):.4f} mol O "
        f"({abs(result['moles_o2_per_mole']):.4f} mol O2) per mol oxide",
        f"  Oxygen-storage capacity: "
        f"{result['oxygen_storage_capacity_wt_pct']:.4f} wt %, "
        f"{result['oxygen_storage_capacity_umol_g']:.1f} umol O/g",
    ]
    if 'mass_change_mg' in result:
        lines.append(f"  Mass change: {result['mass_change_mg']:+.5f} mg of "
                     f"{result['reference_mass_mg']:g} mg")
    lines.append("  Assumptions:")
    lines.extend(f"    - {line}" for line in result['assumptions'])
    return "\n".join(lines)
