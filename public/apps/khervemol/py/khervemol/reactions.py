"""Chemical reactions (Qt-free): parse, balance, and lay out in 3D.

``2 H2 + O2 -> 2 H2O``, ``CH4 + 2 O2 -> CO2 + 2 H2O``,
``N2 + 3 H2 <=> 2 NH3``. Species are library keys or names, formulas
with charges (``NH4+``, ``SO4^2-``), a bare element (``Fe``, ``Na+``) or
``smiles:...``. Arrows: ``->  =>  →  <=>  <->  ⇌  =`` (spaces round the
arrow and round each ``+``); coefficients may be fractions.

* `parse_reaction` reads the equation and resolves every species to a
  `smiles.Compound`.
* `balance` finds the smallest whole coefficients that conserve every
  element and the charge (exact rational row reduction).
* `layout` puts the molecules left to right in one viewer `Molecule` —
  coefficients up to `REPEAT_MAX` draw that many copies — with the
  coefficients, ``+`` signs, the arrow and the formulas under each
  species carried as `notes` the viewer draws over the 3D scene.
* `EXAMPLES` is a small library of classic reactions to start from.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import math
import re
from dataclasses import dataclass
from fractions import Fraction

from . import chem, compounds, elements, rxanim, shelf, smiles
from .crystal import BuildError
from .model import Molecule

#: a coefficient up to this draws that many copies of the molecule side
#: by side; above it (or for a fraction) a numeral is kept
REPEAT_MAX = 8
#: most atoms a reaction scene may hold
MAX_ATOMS = 400


_SUP = str.maketrans("0123456789+-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻")
_FORMULA = re.compile(r"^[A-Z][A-Za-z0-9()\[\]]*(\^?\d*[+-]+)?$")


@dataclass
class Term:
    coef: Fraction | None
    text: str
    compound: smiles.Compound

    @property
    def label(self):
        """How the species is written: the formula as typed (NH3, not the
        Hill H3N; Fe^2+ as Fe²⁺), else the computed formula (ethanol →
        C2H6O)."""
        t = self.text.strip()
        if t.startswith("@"):               # a kept molecule: show its name
            return self.compound.name
        if not _FORMULA.match(t) or t.lower().startswith("smiles:"):
            return self.compound.formula
        body, charge = _charge_of(t)
        if not charge:
            return body
        mag = "" if abs(charge) == 1 else str(abs(charge))
        return body + (mag + ("+" if charge > 0 else "-")).translate(_SUP)


# ------------------------------------------------------------- species
def _charge_of(text):
    """(formula body, charge): a magnitude counts only after ^ or a space
    ("SO4^2-", "Fe^3+"); otherwise the trailing signs do ("NH4+" is +1,
    "SO4--" is -2)."""
    t = text.strip()
    m = re.match(r"^(.*?)(?:\s+|\^)(\d*)([+-])$", t)
    if m:
        mag = int(m.group(2)) if m.group(2) else 1
        return m.group(1), mag * (1 if m.group(3) == "+" else -1)
    m = re.match(r"^(.*?)([+-]+)$", t)
    if m and m.group(1):
        signs = m.group(2)
        return m.group(1), len(signs) * (1 if signs[0] == "+" else -1)
    return t, 0


def by_formula(text):
    """The first library key with this formula and charge, or None."""
    body, charge = _charge_of(text)
    try:
        want = smiles.hill_formula(smiles.formula_counts(body))
    except ValueError:
        return None
    for key, (_n, _s, _c, formula) in compounds.COMPOUNDS.items():
        fbody, fcharge = _charge_of(formula)
        try:
            have = smiles.hill_formula(smiles.formula_counts(fbody))
        except ValueError:
            continue
        if have == want and fcharge == charge:
            return key
    return None


def _ion(text):
    """A lone atom or monatomic ion (Fe, Na+, Cl-, Fe^3+) as a Compound."""
    body, charge = _charge_of(text)
    if body not in elements.NUMBERS:
        return None
    c = smiles.Compound(name=text.strip(), smiles=f"[{body}]",
                        atoms=[[body, 0.0, 0.0, 0.0]], bonds=[],
                        charges=[charge], key=body)
    return c


def resolve(text):
    """A species by library key or name, formula (charge included), a
    bare element / ion, or ``smiles:...``."""
    t = text.strip()
    if not t:
        raise BuildError("An empty species.")
    if t.startswith("@"):
        try:
            return shelf.default().compound(t)
        except KeyError:
            raise BuildError(
                f"'{t}' is not on your shelf of kept molecules "
                f"({', '.join(shelf.token(n) for n in shelf.default().names()) or 'it is empty'}).")
    if t.lower().startswith("smiles:"):
        s = t[7:].strip()
        try:
            return smiles.from_smiles(s, name=s)
        except smiles.SmilesError as exc:
            raise BuildError(f"SMILES '{s}': {exc}")
    try:
        return compounds.get(t)
    except KeyError:
        pass
    key = by_formula(t)
    if key:
        return compounds.get(key)
    ion = _ion(t)
    if ion is not None:
        return ion
    raise BuildError(
        f"'{t}' is not in the compound library (by key, name or formula). "
        "Give its SMILES as smiles:..., e.g. smiles:CCO for ethanol.")


# ------------------------------------------------------------ parsing
def parse_reaction(text):
    """(reactants, products, reversible): lists of `Term`."""
    s = text.strip()
    m = re.search(r"\s*(⇌|→)\s*", s) or \
        re.search(r"\s(<=>|<->|->|=>|=)\s", s)
    if not m:
        raise BuildError("No arrow: write the reaction as 'A + B -> C' "
                         "(or <=>, →, ⇌, =), with spaces round it.")
    reversible = m.group(1) in ("<=>", "<->", "⇌")
    sides = []
    for part in (s[:m.start()], s[m.end():]):
        terms = []
        for chunk in re.split(r"\s\+\s", part.strip()):
            if not chunk.strip():
                raise BuildError("An empty term: every '+' needs a species "
                                 "on both sides.")
            t = re.match(r"^\s*(\d+/\d+|\d+(?:\.\d+)?)?\s*(.+?)\s*$", chunk)
            coef = Fraction(t.group(1)) if t.group(1) else None
            body = t.group(2)
            if re.match(r"^\d", body) and not body.lower().startswith(
                    "smiles:"):
                raise BuildError(f"Put a space after the coefficient in "
                                 f"'{chunk.strip()}'.")
            terms.append(Term(coef, body, resolve(body)))
        sides.append(terms)
    return sides[0], sides[1], reversible


# ---------------------------------------------------------- balancing
def _counts(c):
    return c.composition(), c.charge


def balance_check(left, right, coefs):
    """({element or 'charge': (left, right)}, balanced?)."""
    table = {}
    for side, terms, cs in ((0, left, coefs[:len(left)]),
                            (1, right, coefs[len(left):])):
        for term, c in zip(terms, cs):
            counts, charge = _counts(term.compound)
            for el, k in list(counts.items()) + [("charge", charge)]:
                row = table.setdefault(el, [Fraction(0), Fraction(0)])
                row[side] += c * k
    ok = all(a == b for a, b in table.values())
    return {k: (float(a), float(b)) for k, (a, b) in table.items()}, ok


def balance(left, right):
    """The smallest whole coefficients that balance atoms and charge;
    BuildError when there are none or several independent ways."""
    species = left + right
    els = sorted({el for t in species for el in t.compound.composition()})
    rows = []
    for el in els + ["charge"]:
        row = []
        for idx, t in enumerate(species):
            counts, charge = _counts(t.compound)
            k = charge if el == "charge" else counts.get(el, 0)
            row.append(Fraction(k if idx < len(left) else -k))
        rows.append(row)
    n = len(species)
    pivots, r = [], 0
    for col in range(n):                      # reduced row echelon, exact
        piv = next((i for i in range(r, len(rows)) if rows[i][col] != 0),
                   None)
        if piv is None:
            continue
        rows[r], rows[piv] = rows[piv], rows[r]
        lead = rows[r][col]
        rows[r] = [v / lead for v in rows[r]]
        for i in range(len(rows)):
            if i != r and rows[i][col] != 0:
                f = rows[i][col]
                rows[i] = [a - f * b for a, b in zip(rows[i], rows[r])]
        pivots.append(col)
        r += 1
    free = [c for c in range(n) if c not in pivots]
    if len(free) != 1:
        raise BuildError(
            "That reaction cannot be balanced in one way ("
            + ("no solution" if not free else "several independent ways")
            + ") — give the coefficients yourself.")
    x = [Fraction(0)] * n
    x[free[0]] = Fraction(1)
    for i, col in enumerate(pivots):
        x[col] = -rows[i][free[0]]
    if all(v < 0 for v in x):
        x = [-v for v in x]
    if any(v <= 0 for v in x):
        raise BuildError("No balance with every species present — check "
                         "the species.")
    lcm = 1
    for v in x:
        lcm = lcm * v.denominator // math.gcd(lcm, v.denominator)
    ints = [int(v * lcm) for v in x]
    g = 0
    for v in ints:
        g = math.gcd(g, v)
    return [Fraction(v // g) for v in ints]


def fmt_coef(c):
    return str(c.numerator) if c.denominator == 1 else \
        f"{c.numerator}/{c.denominator}"


def equation_text(left, right, coefs, reversible):
    def side(terms, cs):
        return " + ".join((f"{fmt_coef(c)} " if c != 1 else "")
                          + t.label for t, c in zip(terms, cs))
    arrow = "⇌" if reversible else "→"
    return (f"{side(left, coefs[:len(left)])} {arrow} "
            f"{side(right, coefs[len(left):])}")


@dataclass
class Reaction:
    """A parsed, balanced reaction."""
    left: list
    right: list
    reversible: bool
    coefs: list
    table: dict
    balanced: bool

    @property
    def equation(self):
        return equation_text(self.left, self.right, self.coefs,
                             self.reversible)

    @property
    def source(self):
        """The balanced equation in the ASCII form `parse_reaction` reads,
        species as the user named them."""
        def side(terms, cs):
            return " + ".join((f"{fmt_coef(c)} " if c != 1 else "") + t.text
                              for t, c in zip(terms, cs))
        arrow = "<=>" if self.reversible else "->"
        n = len(self.left)
        return (f"{side(self.left, self.coefs[:n])} {arrow} "
                f"{side(self.right, self.coefs[n:])}")


def solve(text, balance_it=True):
    """Parse *text* and fill in the coefficients."""
    left, right, reversible = parse_reaction(text)
    given = [t.coef for t in left + right]
    if balance_it and any(c is None for c in given):
        coefs = balance(left, right)
        if any(c is not None for c in given):
            # keep the user's ratio when they gave some: only fill gaps
            ratio = next(g / c for g, c in zip(given, coefs) if g)
            coefs = [g if g is not None else c * ratio
                     for g, c in zip(given, coefs)]
    elif balance_it:
        coefs = balance(left, right)
    else:
        coefs = [c if c is not None else Fraction(1) for c in given]
    table, ok = balance_check(left, right, coefs)
    return Reaction(left, right, reversible, coefs, table, ok)


# ------------------------------------------------------------- layout
def _text_width(s, size):
    return 0.6 * size * len(s)


def layout(rx, label=None):
    """A viewer `Molecule` showing the reaction *rx* (a `Reaction`) left to
    right: every species as its own fragment, plus notes (coefficients,
    ``+``, the arrow, formulas)."""
    forms = {}
    for t in rx.left + rx.right:
        forms.setdefault(t.compound.smiles or t.compound.name, t.compound)
    total = 0
    for terms, cs in ((rx.left, rx.coefs[:len(rx.left)]),
                      (rx.right, rx.coefs[len(rx.left):])):
        for t, c in zip(terms, cs):
            copies = int(c) if c.denominator == 1 and 1 <= c <= REPEAT_MAX \
                else 1
            total += len(t.compound.atoms) * copies
    if total > MAX_ATOMS:
        raise BuildError(f"{total} atoms is more than a reaction scene "
                         f"holds ({MAX_ATOMS}): pick smaller species.")
    posed = {}
    for key, c in forms.items():
        posed[key] = chem.orient(c.atoms)
    height = max((max(p[2] for p in pts) - min(p[2] for p in pts)
                  for pts in posed.values()), default=1.0)
    size = max(1.4, min(2.4, 0.45 * height + 0.8))       # text height, Å
    gap = 0.6 * size + 0.6
    low = min((min(p[2] for p in pts) for pts in posed.values()),
              default=0.0) - 1.0

    atoms, bonds, notes = [], [], []
    drawn = []                  # (side, compound, oriented points, kekulé)
    x = 0.0

    def text(s, x0, z, sz, color="#22303c", bold=True):
        notes.append({"kind": "text", "text": s,
                      "pos": (x0 + _text_width(s, sz) / 2, 0.0, z),
                      "size": sz, "color": color, "bold": bold})

    for side_idx, (terms, cs) in enumerate(
            ((rx.left, rx.coefs[:len(rx.left)]),
             (rx.right, rx.coefs[len(rx.left):]))):
        first = True
        for term, c in zip(terms, cs):
            copies = int(c) if c.denominator == 1 and 1 <= c <= REPEAT_MAX \
                else 1
            for i in range(copies):
                if not first:
                    text("+", x, 0.0, size, "#4a5560", False)
                    x += _text_width("+", size) + gap
                first = False
                if copies == 1 and c != 1:
                    s = fmt_coef(c)
                    text(s, x, 0.0, size, "#159c74")
                    x += _text_width(s, size) + gap * 0.6
                comp = term.compound
                key = comp.smiles or comp.name
                pts = posed[key]
                lo = min(p[0] for p in pts)
                hi = max(p[0] for p in pts)
                dx = x - lo
                base = len(atoms)
                kek = chem.kekulize(comp.atoms, comp.bonds, comp.charges)
                for a, p in zip(comp.atoms, pts):
                    atoms.append([a[0], p[0] + dx, p[1], p[2]])
                for bi, bj, bo in kek:
                    bonds.append([bi + base, bj + base, bo])
                drawn.append((side_idx, comp, pts, kek))
                w = hi - lo
                name = term.label
                text(name, x + w / 2 - _text_width(name, size * 0.6) / 2,
                     low - size * 0.5, size * 0.6, "#4a5560", False)
                x = x + w + gap
        if side_idx == 0:
            length = max(4.0, 3.0 * size)
            notes.append({"kind": "arrow", "p1": (x, 0.0, 0.0),
                          "p2": (x + length, 0.0, 0.0), "color": "#22303c",
                          "double": rx.reversible, "size": size})
            x += length + gap
    m = Molecule(atoms, bonds, name="reaction", label=label or rx.equation,
                 az=0.0, el=math.radians(8.0), bond=1.4, rscale=0.8,
                 crystal=True, notes=notes)
    m.reaction = rx.source
    m.anim = _animation(rx, drawn)
    # centre the scene on its middle so it turns about it
    if m.atoms:
        cx = (min(a[1] for a in m.atoms) + max(a[1] for a in m.atoms)) / 2
        cz = (min(a[3] for a in m.atoms) + max(a[3] for a in m.atoms)) / 2
        for a in m.atoms:
            a[1] -= cx
            a[3] -= cz
        for n in m.notes:
            for key in ("pos", "p1", "p2"):
                if key in n:
                    p = n[key]
                    n[key] = (p[0] - cx, p[1], p[2] - cz)
    return m


def _side(copies, gap, shift):
    """A `rxanim.Side` from drawn copies laid in a row *gap* apart, centred
    on x = *shift*; returns it with the row's width."""
    els, bonds, mols, pos = [], [], [], []
    cursor = 0.0
    rows = []
    for k, (_s, comp, pts, kek) in enumerate(copies):
        lo = min(p[0] for p in pts)
        hi = max(p[0] for p in pts)
        base = len(els)
        els += [a[0] for a in comp.atoms]
        mols += [k] * len(comp.atoms)
        bonds += [(i + base, j + base, o) for i, j, o in kek]
        rows.append((cursor - lo, pts))
        cursor += hi - lo + gap
    width = max(0.0, cursor - gap)
    for dx, pts in rows:
        pos += [(p[0] + dx - width / 2 + shift, p[1], p[2]) for p in pts]
    return els, bonds, mols, pos, width


def _animation(rx, drawn):
    """The `rxanim.Animation` of a laid-out reaction, or None when the
    drawn atoms of the two sides differ (a fractional coefficient)."""
    left = [d for d in drawn if d[0] == 0]
    right = [d for d in drawn if d[0] == 1]
    if not left or not right:
        return None
    cr = _side(left, 1.2, 0.0)
    cp = _side(right, 1.2, 0.0)
    if sorted(cr[0]) != sorted(cp[0]):
        return None
    sr = _side(left, 1.8, 0.0)
    sp = _side(right, 1.8, 0.0)
    x0 = max(sr[4], sp[4]) / 2 + max(cr[4], cp[4]) / 2 + 0.5
    ar = _side(left, 1.8, -x0)
    dp = _side(right, 1.8, x0)
    reac = rxanim.Side(cr[0], cr[1], cr[2], ar[3], cr[3])
    prod = rxanim.Side(cp[0], cp[1], cp[2], dp[3], cp[3])
    return rxanim.build(reac, prod, rx.equation)


def attach_animation(mol):
    """Give a reaction scene loaded from a file its animation back (the
    film is regenerated from ``mol.reaction``). Returns True on success."""
    if mol.anim is not None:
        return True
    if not mol.reaction:
        return False
    try:
        rx = solve(mol.reaction, balance_it=False)
        fresh = layout(rx)
    except (BuildError, ValueError, ZeroDivisionError):
        return False
    if fresh.anim is None:
        return False
    fresh.anim.bind(mol)
    mol.anim = fresh.anim
    return True


def reaction_model(text, balance_it=True):
    """(Molecule, Reaction) for an equation string."""
    rx = solve(text, balance_it)
    return layout(rx), rx


# ----------------------------------------------------------- examples
#: name -> equation; every species is in the built-in library
EXAMPLES = {
    "Water formation": "2 H2 + O2 -> 2 H2O",
    "Methane combustion": "CH4 + O2 -> CO2 + H2O",
    "Ethane combustion": "C2H6 + O2 -> CO2 + H2O",
    "Propane combustion": "C3H8 + O2 -> CO2 + H2O",
    "Ethanol combustion": "ethanol + O2 -> CO2 + H2O",
    "Glucose combustion (respiration)": "glucose + O2 -> CO2 + H2O",
    "Photosynthesis": "CO2 + H2O -> glucose + O2",
    "Haber process (ammonia)": "N2 + 3 H2 <=> 2 NH3",
    "Contact process (SO3)": "SO2 + O2 <=> SO3",
    "Ammonia oxidation (Ostwald)": "NH3 + O2 -> NO + H2O",
    "Hydrogen chloride synthesis": "H2 + Cl2 -> HCl",
    "Hydrogen peroxide decomposition": "H2O2 -> H2O + O2",
    "Ethene hydrogenation": "ethene + H2 -> ethane",
    "Ethyne hydrogenation": "ethyne + H2 -> ethene",
    "Ethene hydration": "ethene + H2O -> ethanol",
    "Esterification": "acetic_acid + ethanol <=> ethyl_acetate + H2O",
    "Neutralisation (HCl + NaOH)": "HCl + NaOH -> NaCl + H2O",
    "Acid + carbonate": "HCl + CaCO3 -> CaCl2 + H2O + CO2",
    "Limestone decomposition": "CaCO3 -> CaO + CO2",
    "Quicklime slaking": "CaO + H2O -> Ca(OH)2",
    "Ammonia + HCl": "NH3 + HCl -> NH4Cl",
    "Thermite": "Fe2O3 + Al -> Al2O3 + Fe",
    "Rusting": "Fe + O2 -> Fe2O3",
    "Magnesium burning": "Mg + O2 -> MgO",
    "Sodium + water": "Na + H2O -> NaOH + H2",
    "Silver chloride precipitation": "AgNO3 + NaCl -> AgCl + NaNO3",
    "Ozone formation": "O2 -> O3",
    "Nitrogen dioxide dimerisation": "NO2 <=> N2O4",
    "Carbon monoxide oxidation": "CO + O2 -> CO2",
    "Water-gas shift": "CO + H2O <=> CO2 + H2",
    "Steam reforming": "CH4 + H2O <=> CO + H2",
    "Sulfuric acid + NaOH": "H2SO4 + NaOH -> Na2SO4 + H2O",
    "Ammonium ion formation": "NH3 + H+ -> NH4+",
    "Benzene hydrogenation": "benzene + H2 -> cyclohexane",
    "Methane chlorination": "CH4 + Cl2 -> CH3Cl + HCl",
    "Methanol synthesis": "CO + H2 -> methanol",
}
