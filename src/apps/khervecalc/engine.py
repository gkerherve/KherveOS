"""kcalc_engine — KherveCalc's maths engine (SymPy + mpmath + NumPy + SciPy).

Runs in the KherveCalc window's own Pyodide worker (and in plain CPython for
the tests). One entry point:

    call(b64)      base64 of a JSON request {"op": ..., ...}  ->  base64 JSON answer
    emit(b64)      the same, printed between markers (what the browser uses)
    dispatch(req)  the same with dicts (tests)

Expressions are calculator-style: ^ is a power, 2x and sin x multiply/apply,
x := 3 and f(x) := x^2 define, a = b is an equation, 3_m/_s*2_h has units,
#c is a CODATA constant, expr ▶ _km/_h converts, [[1,2],[3,4]] is a matrix.
"""

import base64
import json
import math
import re
import sys

import mpmath
import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    function_exponentiation,
    implicit_application,
    implicit_multiplication,
    parse_expr,
    standard_transformations,
)
from sympy.physics import units as U
from sympy.physics.units import Quantity
from sympy.physics.units.systems.si import SI, dimsys_SI

VERSION = "1.0"
if hasattr(sys, "set_int_max_str_digits"):
    sys.set_int_max_str_digits(0)  # 1000! has 2568 digits; this kernel is the calculator's own
HUGE_BITS = 70000  # integers longer than ~21,000 digits are shown in scientific notation
TRANSFORMS = standard_transformations + (convert_xor, implicit_multiplication, implicit_application, function_exponentiation)

# --------------------------------------------------------------------- state

SETTINGS = {"number": "exact", "digits": 12, "angle": "rad", "complex": "rect"}
VARS: dict = {}          # name -> value (sympy)
FUNCS: dict = {}         # name -> sympy Lambda
DEF_SRC: dict = {}       # name -> the source line that defined it
HIST: dict = {}          # history id -> result value
HIST_ORDER: list = []
LISTS: dict = {}         # L1..L6 from the statistics editor
PROGRAM_NS: dict = {}    # the Python cell's namespace (Programs tab), set by the bridge
MAX_HIST = 500


class CalcError(Exception):
    """A message for the user (no traceback)."""


# --------------------------------------------------------------------- units

def _q(name, abbrev, dim, factor):
    q = Quantity(name, abbrev=abbrev)
    q.kc_name = abbrev
    SI.set_quantity_dimension(q, dim)
    SI.set_quantity_scale_factor(q, factor)
    return q



_EXTRA = {}


def _extra(name, abbrev, dim, factor):
    q = _q(name, abbrev, dim, factor)
    _EXTRA[abbrev] = q
    return q


# Units SymPy lacks (scale factors in SI).
_extra("kilojoule", "kJ", U.energy, 1000 * U.joule)
_extra("calorie", "cal", U.energy, sp.Rational(4184, 1000) * U.joule)
_extra("kilocalorie", "kcal", U.energy, 4184 * U.joule)
_extra("watthour", "Wh", U.energy, 3600 * U.joule)
_extra("kilowatthour", "kWh", U.energy, 3600000 * U.joule)
_extra("british_thermal_unit", "BTU", U.energy, sp.Rational("1055.05585262") * U.joule)
_extra("erg", "erg", U.energy, sp.Rational(1, 10**7) * U.joule)
_extra("hartree_energy", "Eh", U.energy, sp.Rational("4.3597447222060e-18") * U.joule)
_extra("rydberg_energy", "Ry", U.energy, sp.Rational("2.1798723611030e-18") * U.joule)
_extra("ounce", "oz", U.mass, sp.Rational("0.028349523125") * U.kg)
_extra("pound_mass", "lb", U.mass, sp.Rational("0.45359237") * U.kg)
_extra("stone", "st", U.mass, sp.Rational("6.35029318") * U.kg)
_extra("carat", "ct", U.mass, sp.Rational(2, 10000) * U.kg)
_extra("gallon", "gal", U.length**3, sp.Rational("0.003785411784") * U.m**3)
_extra("imperial_gallon", "galUK", U.length**3, sp.Rational("0.00454609") * U.m**3)
_extra("quart", "qt", U.length**3, sp.Rational("0.000946352946") * U.m**3)
_extra("pint", "pt", U.length**3, sp.Rational("0.000473176473") * U.m**3)
_extra("fluid_ounce", "floz", U.length**3, sp.Rational("0.0000295735295625") * U.m**3)
_extra("cup", "cup", U.length**3, sp.Rational("0.0002365882365") * U.m**3)
_extra("parsec", "pc", U.length, sp.Rational("3.0856775814913673e16") * U.m)
_extra("micron", "micron", U.length, sp.Rational(1, 10**6) * U.m)
_extra("fermi", "fm", U.length, sp.Rational(1, 10**15) * U.m)
_extra("bohr", "a0", U.length, sp.Rational("5.29177210544e-11") * U.m)
_extra("knot", "kn", U.velocity, sp.Rational(1852, 3600) * U.m / U.s)
_extra("acre", "acre", U.length**2, sp.Rational("4046.8564224") * U.m**2)
_extra("barn", "barn", U.length**2, sp.Rational(1, 10**28) * U.m**2)
_extra("week", "wk", U.time, 604800 * U.s)
_extra("pound_force", "lbf", U.force, sp.Rational("4.4482216152605") * U.newton)
_extra("kilogram_force", "kgf", U.force, sp.Rational("9.80665") * U.newton)
_extra("dyne", "dyn", U.force, sp.Rational(1, 10**5) * U.newton)
_extra("horsepower", "hp", U.power, sp.Rational("745.69987158227022") * U.watt)
_extra("gauss", "G", U.magnetic_density, sp.Rational(1, 10**4) * U.tesla)
_extra("curie", "Ci", 1 / U.time, 37 * 10**9 / U.s)
_extra("rpm", "rpm", 1 / U.time, sp.Rational(1, 60) / U.s)
_extra("electron_volt_mass", "eVc2", U.mass, sp.Rational("1.78266192162790e-36") * U.kg)
_extra("lumen", "lm", U.luminous_intensity, U.candela * U.steradian)
_extra("sievert", "Sv", U.length**2 / U.time**2, U.joule / U.kg)
_extra("femtosecond", "fs", U.time, sp.Rational(1, 10**15) * U.second)
_extra("molar", "M", U.amount_of_substance / U.length**3, 1000 * U.mol / U.m**3)

PREFIXES = {
    "Q": 30, "R": 27, "Y": 24, "Z": 21, "E": 18, "P": 15, "T": 12, "G": 9, "M": 6, "k": 3, "h": 2, "da": 1,
    "d": -1, "c": -2, "m": -3, "u": -6, "µ": -6, "μ": -6, "n": -9, "p": -12, "f": -15, "a": -18, "z": -21, "y": -24, "r": -27, "q": -30,
}

# Base names a prefix may go on (kPa, MHz, nF, µA…), and every unit by name.
PREFIXABLE = {
    "m": U.meter, "g": U.gram, "s": U.second, "A": U.ampere, "K": U.kelvin, "mol": U.mole, "cd": U.candela,
    "Hz": U.hertz, "N": U.newton, "Pa": U.pascal, "J": U.joule, "W": U.watt, "C": U.coulomb, "V": U.volt,
    "F": U.farad, "ohm": U.ohm, "Ω": U.ohm, "S": U.siemens, "Wb": U.weber, "T": U.tesla, "H": U.henry,
    "L": U.liter, "l": U.liter, "eV": U.electronvolt, "bar": U.bar, "Gy": U.gray, "Bq": U.becquerel,
    "lm": _EXTRA["lm"], "lx": U.lux, "Sv": _EXTRA["Sv"], "kat": U.katal,
}
_prefixed_cache: dict = {}


def _prefixed(prefix, base):
    key = prefix + base
    if key in _prefixed_cache:
        return _prefixed_cache[key]
    unit = PREFIXABLE[base]
    exp = PREFIXES[prefix]
    name = {"µ": "u", "μ": "u"}.get(prefix, prefix) + base
    q = _q(f"kc_{name}", key, SI.get_quantity_dimension(unit), sp.Integer(10) ** exp * unit)
    q.kc_name = key
    _prefixed_cache[key] = q
    return q


UNITS = {
    # length
    "m": U.meter, "km": U.km, "cm": U.cm, "mm": U.mm, "um": U.um, "µm": U.um, "μm": U.um, "nm": U.nm, "pm": U.pm,
    "Å": U.angstrom, "angstrom": U.angstrom, "in": U.inch, "inch": U.inch, "ft": U.foot, "yd": U.yard, "mi": U.mile,
    "mile": U.mile, "nmi": U.nautical_mile, "au": U.astronomical_unit, "AU": U.astronomical_unit, "ly": U.lightyear,
    # mass
    "kg": U.kg, "g": U.gram, "mg": U.mg, "ug": U.ug, "µg": U.ug, "t": U.tonne, "tonne": U.tonne, "Da": U.dalton,
    "amu": U.amu, "u": U.amu,
    # time
    "s": U.second, "ms": U.ms, "us": U.us, "µs": U.us, "ns": U.ns, "ps": U.ps, "fs": _EXTRA["fs"], "min": U.minute,
    "h": U.hour, "hr": U.hour, "d": U.day, "day": U.day, "yr": U.year, "year": U.year, "a": U.year,
    # electric, thermal, amount, light
    "A": U.ampere, "K": U.kelvin, "mol": U.mole, "cd": U.candela, "C": U.coulomb, "V": U.volt, "ohm": U.ohm,
    "Ω": U.ohm, "S": U.siemens, "F": U.farad, "H": U.henry, "T": U.tesla, "Wb": U.weber,
    # derived
    "N": U.newton, "J": U.joule, "W": U.watt, "Pa": U.pascal, "Hz": U.hertz, "eV": U.electronvolt,
    "L": U.liter, "l": U.liter, "mL": U.ml, "ml": U.ml, "bar": U.bar, "atm": U.atmosphere, "psi": U.psi,
    "mmHg": U.mmHg, "Torr": U.torr, "torr": U.torr, "ha": U.hectare, "deg": U.degree, "rad": U.radian,
    "sr": U.steradian, "Gy": U.gray, "Bq": U.becquerel, "Sv": _EXTRA["Sv"], "lm": _EXTRA["lm"], "lx": U.lux,
    "kat": U.katal, "c0": U.speed_of_light,
}
UNITS.update(_EXTRA)

# Short names in the LaTeX output (km/h, not kilometer/hour).
_named = set()
for _k, _u in UNITS.items():
    if isinstance(_u, Quantity) and id(_u) not in _named:
        _named.add(id(_u))
        if _k in ("ohm", "Ω"):
            _u._latex_repr = r"\Omega"
        elif _k in ("um", "µm", "μm"):
            _u._latex_repr = r"\mu\mathrm{m}"
        elif _k == "deg":
            _u._latex_repr = r"^{\circ}"
        else:
            _u._latex_repr = r"\mathrm{" + _k.replace("Å", r"\AA") + "}"
        _u.kc_name = _k

# Temperatures with an offset: only in conversions of a plain value.
TEMPS = {"K": (1, 0), "degC": (1, sp.Rational(27315, 100)), "°C": (1, sp.Rational(27315, 100)),
         "degF": (sp.Rational(5, 9), sp.Rational(45967, 100)), "°F": (sp.Rational(5, 9), sp.Rational(45967, 100)),
         "degR": (sp.Rational(5, 9), 0), "°R": (sp.Rational(5, 9), 0)}


def lookup_unit(name):
    if name in UNITS:
        return UNITS[name]
    if name in ("degC", "degF", "degR"):
        raise CalcError(f"_{name} has an offset: convert temperatures with the Units tab or convert(20, \"degC\", \"K\").")
    for plen in (2, 1):
        p, base = name[:plen], name[plen:]
        if p in PREFIXES and base in PREFIXABLE:
            return _prefixed(p, base)
    raise CalcError(f"Unknown unit _{name}")


def has_units(e):
    return isinstance(e, sp.Basic) and bool(e.atoms(Quantity))


def _dims(q):
    return dimsys_SI.get_dimensional_dependencies(SI.get_quantity_dimension(q))


SI_BASE = [U.meter, U.kilogram, U.second, U.ampere, U.kelvin, U.mole, U.candela]
NAMED_DERIVED = [U.newton, U.joule, U.watt, U.pascal, U.coulomb, U.volt, U.ohm, U.farad, U.henry, U.tesla,
                 U.weber, U.siemens, U.hertz]


def _dim_of(expr):
    try:
        d = U.Dimension(SI.get_dimensional_expr(expr))
        return dimsys_SI.get_dimensional_dependencies(d)
    except Exception:
        return None


def simplify_units(e):
    """3 m/s * 2 h -> 21600 m; 2 kg * 3 m/s^2 -> 6 N; 1 m + 20 cm -> 6/5 m. Keeps 5 km and 90 km/h."""
    if not has_units(e) or not isinstance(e, sp.Expr):
        return e
    qs = list(e.atoms(Quantity))
    if len(qs) <= 1:
        return e
    seen = {}
    clash = False
    for q in qs:
        for base in _dims(q):
            if base in seen and seen[base] != q:
                clash = True
            seen[base] = q
    r = U.convert_to(e, SI_BASE) if clash else e
    if len(r.atoms(Quantity)) > 1:
        want = _dim_of(r)
        for d in NAMED_DERIVED:
            if want and _dims(d) == want:
                return U.convert_to(r, d)
    return r


def convert_units(e, target):
    if isinstance(target, str):
        target = parse_unit_text(target)
    if not has_units(target):
        raise CalcError("Convert to a unit, e.g. ▶ _km/_h")
    if not has_units(e):
        raise CalcError("Nothing to convert: the value has no unit.")
    r = U.convert_to(e, target)
    left = r / target
    left = sp.simplify(left)
    if has_units(left):
        de, dt = _dim_of(e), _dim_of(target)
        raise CalcError(f"Incompatible units ({_dimtext(de)} vs {_dimtext(dt)}).")
    return sp.Mul(left, target, evaluate=False) if left != 1 else target


def _dimtext(d):
    if not d:
        return "dimensionless"
    return " ".join(f"{str(k).replace('Dimension(', '').rstrip(')').split(',')[0]}^{v}" if v != 1 else str(k).replace("Dimension(", "").rstrip(")").split(",")[0] for k, v in d.items())


_UNIT_TOKEN = re.compile(r"([A-Za-zµμΩÅ°][A-Za-z0-9µμΩÅ°]*)(\^(-?\d+))?")


def parse_unit_text(text):
    """'km/h', 'm s^-1', 'J K^-1 mol^-1', '_m/_s' -> a SymPy unit expression."""
    t = text.strip().replace("_", "").replace("·", " ").replace("*", " ").replace("**", "^")
    if not t:
        raise CalcError("Empty unit")
    num, den = (t.split("/", 1) + [""])[:2]
    out = sp.Integer(1)
    for part, sign in ((num, 1), (den, -1)):
        for tok in part.replace("(", " ").replace(")", " ").split():
            m = _UNIT_TOKEN.fullmatch(tok)
            if not m:
                if tok == "1":
                    continue
                raise CalcError(f"Unknown unit '{tok}'")
            power = int(m.group(3)) if m.group(3) else 1
            out *= lookup_unit(m.group(1)) ** (power * sign)
    return out


def convert_value(value, frm, to):
    """Value in unit `frm` -> unit `to` (handles °C/°F/°R offsets)."""
    v = sp.sympify(value) if not isinstance(value, sp.Basic) else value
    fk, tk = frm.strip().lstrip("_"), to.strip().lstrip("_")
    if fk in TEMPS and tk in TEMPS:
        a, b = TEMPS[fk]
        kelvin = (v + b) * a
        c, d = TEMPS[tk]
        out = kelvin / c - d
        return sp.nsimplify(out) if v.is_Rational else out
    q = v * parse_unit_text(frm)
    r = convert_units(q, parse_unit_text(to))
    return r


def unit_catalog():
    cats = {}
    for name, q in UNITS.items():
        if name in ("c0",):
            continue
        try:
            d = SI.get_quantity_dimension(q)
            key = str(d.name)
        except Exception:
            key = "other"
        cats.setdefault(key, []).append(name)
    return cats


# ---------------------------------------------------------------- constants

ALIASES = {
    "c": "speed of light in vacuum", "h": "Planck constant", "hbar": "reduced Planck constant",
    "e": "elementary charge", "me": "electron mass", "mp": "proton mass", "mn": "neutron mass",
    "mu": "atomic mass constant", "NA": "Avogadro constant", "kB": "Boltzmann constant", "k": "Boltzmann constant",
    "R": "molar gas constant", "F": "Faraday constant", "G": "Newtonian constant of gravitation",
    "g": "standard acceleration of gravity", "g0": "standard acceleration of gravity",
    "eps0": "vacuum electric permittivity", "mu0": "vacuum mag. permeability", "a0": "Bohr radius",
    "Rinf": "Rydberg constant", "alpha": "fine-structure constant", "sigma": "Stefan-Boltzmann constant",
    "muB": "Bohr magneton", "muN": "nuclear magneton", "Eh": "Hartree energy", "Z0": "characteristic impedance of vacuum",
    "Phi0": "mag. flux quantum", "KJ": "Josephson constant", "RK": "von Klitzing constant", "b": "Wien wavelength displacement law constant",
    "atm": "standard atmosphere", "re": "classical electron radius", "lambdaC": "Compton wavelength",
    "md": "deuteron mass", "malpha": "alpha particle mass", "G0": "conductance quantum", "Vm": "molar volume of ideal gas (273.15 K, 100 kPa)",
    "eV": "electron volt", "u": "atomic mass constant", "gamma_e": "electron gyromag. ratio", "mue": "electron mag. mom.",
}
_CONST_CACHE: dict = {}


def _codata():
    try:
        import scipy.constants as sc
        return sc.physical_constants
    except Exception:  # pragma: no cover
        return {}


def _const_unit(text):
    if not text:
        return sp.Integer(1)
    try:
        return parse_unit_text(text.replace("E_h", "Eh").replace("ohm", "ohm"))
    except CalcError:
        return None


def constant(name):
    key = ALIASES.get(name, name)
    if key in _CONST_CACHE:
        return _CONST_CACHE[key]
    table = _codata()
    if key not in table:
        low = {k.lower(): k for k in table}
        if key.lower() in low:
            key = low[key.lower()]
        else:
            raise CalcError(f"Unknown constant #{name} (see the Constants panel)")
    value, unit, unc = table[key]
    num = sp.Integer(int(value)) if float(value).is_integer() and abs(value) < 1e16 and unc == 0 else sp.Float(repr(float(value)), 20)
    u = _const_unit(unit)
    out = num * u if u is not None else num
    _CONST_CACHE[key] = out
    return out


def constants_list():
    table = _codata()
    rev = {}
    for a, k in ALIASES.items():
        rev.setdefault(k, []).append(a)
    out = []
    for k, (v, unit, unc) in table.items():
        out.append({"name": k, "alias": rev.get(k, [None])[0], "value": repr(float(v)), "unit": unit, "uncertainty": repr(float(unc)),
                    "exact": unc == 0})
    out.sort(key=lambda c: (c["alias"] is None, c["name"]))
    return out


# --------------------------------------------------------------- functions

x_, t_ = sp.symbols("x t")


def _angle_factor():
    a = SETTINGS.get("angle", "rad")
    return sp.pi / 180 if a == "deg" else sp.pi / 200 if a == "grad" else sp.Integer(1)


def _to_rad(v):
    f = _angle_factor()
    return v if f == 1 else v * f


def _from_rad(v):
    f = _angle_factor()
    return v if f == 1 else v / f


def _fwd(fn):
    def f(v, **kw):  # parse_expr(evaluate=False) passes evaluate=False
        return fn(_to_rad(v), **kw)
    f.__name__ = fn.__name__
    return f


def _inv(fn):
    def f(v, **kw):
        return _from_rad(fn(v, **kw))
    f.__name__ = fn.__name__
    return f


def _seq(v):
    """A list of values from a matrix, list, tuple or a single value."""
    if isinstance(v, sp.MatrixBase):
        return list(v)
    if isinstance(v, (list, tuple, sp.Tuple)):
        out = []
        for i in v:
            out.extend(_seq(i))
        return out
    return [v]


def _args_seq(args):
    if len(args) == 1:
        return _seq(args[0])
    out = []
    for a in args:
        out.extend(_seq(a))
    return out


def _num(v, what="value"):
    v = sp.sympify(v)
    if not v.is_number:
        raise CalcError(f"The {what} must be a number")
    return v


def _mpf(v):
    return mpmath.mpmathify(sp.N(_num(v), mpmath.mp.dps + 5))


def _float_result(v):
    if isinstance(v, (mpmath.mpc, complex)):
        return sp.Float(mpmath.re(v), mpmath.mp.dps) + sp.I * sp.Float(mpmath.im(v), mpmath.mp.dps) if mpmath.im(v) != 0 else sp.Float(mpmath.re(v), mpmath.mp.dps)
    return sp.Float(v, mpmath.mp.dps)


def _with_dps(fn):
    old = mpmath.mp.dps
    mpmath.mp.dps = max(15, int(SETTINGS.get("digits", 15)) + 5)
    try:
        return fn()
    finally:
        mpmath.mp.dps = old


def f_log(v, b=None, **kw):
    """log(x) is base 10 (calculator style); log(x, b) base b; ln is natural."""
    if b is None:
        return sp.log(v, 10, **kw)
    return sp.log(v, b, **kw)


def f_root(v, n):
    if n == 3 or n == -3 or (getattr(v, "is_real", False) and getattr(n, "is_odd", False)):
        return sp.real_root(v, n)
    return sp.root(v, n)


def f_round(v, n=0):
    if isinstance(v, sp.MatrixBase):
        return v.applyfunc(lambda e: f_round(e, n))
    v = sp.sympify(v)
    if v.is_number and not v.is_real:
        return f_round(sp.re(v), n) + sp.I * f_round(sp.im(v), n)
    n = int(n)
    if v.is_Rational or v.is_Integer:
        q = v * sp.Integer(10) ** n
        r = sp.floor(q + sp.Rational(1, 2)) if q >= 0 else -sp.floor(-q + sp.Rational(1, 2))
        return r / sp.Integer(10) ** n
    q = sp.Rational(str(sp.N(v, max(30, n + 20))))
    return sp.Float(f_round(q, n), max(15, n + 2))


def f_frac(v):
    return v - sp.floor(v) if v.is_real else v - sp.floor(sp.re(v))


def f_trunc(v):
    return sp.sign(v) * sp.floor(sp.Abs(v))


def f_mod(a, b):
    return sp.Mod(a, b)


def f_gcd(*a):
    vals = _args_seq(a)
    out = vals[0]
    for v in vals[1:]:
        out = sp.gcd(out, v)
    return out


def f_lcm(*a):
    vals = _args_seq(a)
    out = vals[0]
    for v in vals[1:]:
        out = sp.lcm(out, v)
    return out


class Factored(sp.Basic):
    """An integer's factorisation, shown as 2^3·3^2·5."""

    def __new__(cls, n, factors):
        obj = sp.Basic.__new__(cls)
        obj._n = n
        obj._f = factors
        return obj

    def _latex(self, printer=None):
        if not self._f:
            return sp.latex(self._n)
        parts = [(f"{p}^{{{k}}}" if k > 1 else f"{p}") for p, k in sorted(self._f.items())]
        sign = "-" if self._n < 0 else ""
        return sign + r" \cdot ".join(parts)

    def _sympystr(self, printer=None):
        parts = [(f"{p}^{k}" if k > 1 else f"{p}") for p, k in sorted(self._f.items())]
        return ("-" if self._n < 0 else "") + "*".join(parts)

    @property
    def value(self):
        return self._n


def f_factor(e, *gens, **kw):
    e = sp.sympify(e)
    if e.is_Integer:
        if e == 0 or abs(e) == 1:
            return e
        return Factored(e, sp.factorint(abs(e)))
    if e.is_Rational:
        return sp.Mul(f_factor(e.p), sp.Pow(f_factor(e.q), -1, evaluate=False), evaluate=False)
    return sp.factor(e, *gens, **kw)


def f_factorint(n):
    return f_factor(sp.Integer(n))


def f_perm(n, k):
    return sp.factorial(n) / sp.factorial(n - k)


def f_isprime(n):
    return sp.Integer(n).is_prime if sp.sympify(n).is_Integer else sp.false


def f_powmod(a, b, m):
    return sp.Integer(pow(int(a), int(b), int(m)))


def f_invmod(a, m):
    return sp.mod_inverse(a, m)


def f_digits(n, b=10):
    return sp.Matrix([sp.digits(int(n), int(b))[1:]])


def f_lambertw(v, k=0):
    return sp.LambertW(v, k)


def f_besselj(n, v):
    return sp.besselj(n, v)


def f_erfinv(v):
    return sp.erfinv(v)


def f_beta(a, b):
    return sp.beta(a, b)


def f_lgamma(v):
    return sp.loggamma(v)


def f_polar(r, theta):
    return r * sp.exp(sp.I * _to_rad(theta))


def f_arg(v):
    return _from_rad(sp.arg(v))


def f_cis(theta):
    return sp.exp(sp.I * _to_rad(theta))


def f_sign(v):
    return sp.sign(v)


def f_max(*a):
    return sp.Max(*_args_seq(a))


def f_min(*a):
    return sp.Min(*_args_seq(a))


def f_atan2(y, xv):
    return _from_rad(sp.atan2(y, xv))


# ---- bitwise (integers, decimal mode; the BASE mode has its own evaluator)

def _ints(*a):
    out = []
    for v in a:
        v = sp.sympify(v)
        if not v.is_Integer:
            raise CalcError("Bitwise operations need integers")
        out.append(int(v))
    return out


def f_band(a, b):
    x, y = _ints(a, b)
    return sp.Integer(x & y)


def f_bor(a, b):
    x, y = _ints(a, b)
    return sp.Integer(x | y)


def f_bxor(a, b):
    x, y = _ints(a, b)
    return sp.Integer(x ^ y)


def f_bnot(a, bits=64):
    x, n = _ints(a, bits)
    return sp.Integer(~x & ((1 << n) - 1))


def f_shl(a, n=1):
    x, k = _ints(a, n)
    return sp.Integer(x << k)


def f_shr(a, n=1):
    x, k = _ints(a, n)
    return sp.Integer(x >> k)


# ---- calculus

def _var_for(e, v=None):
    if v is not None:
        return v
    fs = sorted(sp.sympify(e).free_symbols, key=str) if isinstance(e, sp.Basic) else []
    if not fs:
        return x_
    for pref in ("x", "t", "y", "z"):
        for s in fs:
            if s.name == pref:
                return s
    return fs[0]


def f_diff(e, v=None, n=1, at=None):
    if isinstance(e, sp.Lambda):
        e = e(x_)
    v = _var_for(e, v)
    r = sp.diff(e, v, int(n))
    return r.subs(v, at) if at is not None else r


def f_nderiv(e, v, at, n=1):
    v = _var_for(e, v)
    f = sp.lambdify(v, e, "mpmath")
    return _with_dps(lambda: _float_result(mpmath.diff(f, _mpf(at), int(n))))


def _numeric_mode():
    return SETTINGS.get("number") == "decimal"


def f_nint(e, v=None, a=None, b=None):
    if a is None and b is None and isinstance(v, (sp.Tuple, tuple)):
        v, a, b = v
    v = _var_for(e, v)
    if a is None or b is None:
        raise CalcError("nint(f, x, a, b) needs the limits a and b")
    f = sp.lambdify(v, e, "mpmath")

    def run():
        lo = mpmath.mpf("-inf") if a == -sp.oo else mpmath.mpf("inf") if a == sp.oo else _mpf(a)
        hi = mpmath.mpf("-inf") if b == -sp.oo else mpmath.mpf("inf") if b == sp.oo else _mpf(b)
        return _float_result(mpmath.quad(f, [lo, hi]))
    return _with_dps(run)


def f_integrate(e, v=None, a=None, b=None):
    if isinstance(v, (sp.Tuple, tuple)) and a is None:
        v, a, b = v
    if isinstance(e, sp.Lambda):
        e = e(x_)
    v = _var_for(e, v)
    if a is None and b is None:
        r = sp.integrate(e, v)
        return r
    if _numeric_mode() and not (sp.sympify(e).free_symbols - {v}):
        return f_nint(e, v, a, b)
    r = sp.integrate(e, (v, a, b))
    if isinstance(r, sp.Integral) and not (r.free_symbols):
        return f_nint(e, v, a, b)
    return r


def f_limit(e, v=None, a=0, d="+-"):
    v = _var_for(e, v)
    d = str(d)
    return sp.limit(e, v, a, d if d in ("+", "-", "+-") else "+-")


def f_series(e, v=None, a=0, n=6):
    v = _var_for(e, v)
    return sp.series(e, v, a, int(n))


def f_taylor(e, v=None, a=0, n=6):
    v = _var_for(e, v)
    return sp.series(e, v, a, int(n)).removeO()


def f_sum(*a):
    if len(a) == 1:
        return sp.Add(*_seq(a[0]))
    if len(a) == 4:
        return sp.summation(a[0], (a[1], a[2], a[3]))
    if len(a) == 2 and isinstance(a[1], (sp.Tuple, tuple)):
        return sp.summation(a[0], tuple(a[1]))
    return sp.Add(*_args_seq(a))


def f_product(*a):
    if len(a) == 1:
        return sp.Mul(*_seq(a[0]))
    if len(a) == 4:
        return sp.product(a[0], (a[1], a[2], a[3]))
    return sp.Mul(*_args_seq(a))


def _eqs(e):
    out = []
    for item in _seq(e) if isinstance(e, (list, tuple, sp.MatrixBase, sp.Tuple)) else [e]:
        if isinstance(item, sp.Equality):
            out.append(item.lhs - item.rhs)
        else:
            out.append(sp.sympify(item))
    return out


class Solutions(sp.Basic):
    """Solutions of solve(): a list of values, or of {var: value} dicts."""

    def __new__(cls, sols, vars_):
        obj = sp.Basic.__new__(cls)
        obj.sols = sols
        obj.vars = vars_
        return obj

    def rows(self):
        out = []
        for s in self.sols:
            if isinstance(s, dict):
                out.append([(k, v) for k, v in s.items()])
            elif isinstance(s, (tuple, list)):
                out.append(list(zip(self.vars, s)))
            else:
                out.append([(self.vars[0] if self.vars else x_, s)])
        return out

    def _latex(self, printer=None):
        rows = self.rows()
        if not rows:
            return r"\text{no solution}"
        parts = []
        for i, r in enumerate(rows):
            if len(rows) > 1 and len(r) == 1:
                k, v = r[0]
                parts.append(f"{sp.latex(k)}_{{{i + 1}}} = {sp.latex(v)}" if len(rows) > 1 else f"{sp.latex(k)} = {sp.latex(v)}")
            else:
                parts.append(r",\; ".join(f"{sp.latex(k)} = {sp.latex(v)}" for k, v in r))
        return r"\quad\lor\quad ".join(parts) if len(parts) <= 3 else r" \\ ".join(parts)

    def _sympystr(self, printer=None):
        rows = self.rows()
        if not rows:
            return "no solution"
        return " or ".join(", ".join(f"{k} = {v}" for k, v in r) for r in rows)

    def evalf(self, n=15, **kw):
        return Solutions([{k: sp.N(v, n) for k, v in r} for r in self.rows()], self.vars)

    def values(self):
        return [v for r in self.rows() for _, v in r]


def f_solve(eq, *vars_):
    eqs = _eqs(eq)
    vs = []
    for v in vars_:
        vs.extend(_seq(v))
    if not vs:
        fs = set()
        for e in eqs:
            fs |= e.free_symbols
        vs = sorted(fs, key=str)
        if len(eqs) == 1 and len(vs) > 1:
            vs = [_var_for(eqs[0])]
    if _numeric_mode() and len(eqs) == 1 and len(vs) == 1 and _is_poly(eqs[0], vs[0]):
        roots = sp.Poly(eqs[0], vs[0]).nroots(n=int(SETTINGS["digits"]) + 3)
        return Solutions(list(roots), vs)
    if len(eqs) == 1 and len(vs) == 1:
        sols = sp.solve(eqs[0], vs[0], dict=False)
        if not sols:
            ss = sp.solveset(eqs[0], vs[0], domain=sp.S.Complexes)
            if isinstance(ss, sp.FiniteSet):
                sols = list(ss)
            elif ss is not sp.S.EmptySet:
                return ss
        return Solutions(list(sols), vs)
    sols = sp.solve(eqs, vs, dict=True)
    return Solutions(sols, vs)


def _is_poly(e, v):
    try:
        sp.Poly(e, v)
        return True
    except Exception:
        return False


def f_nsolve(eq, v=None, x0=0, *rest):
    eqs = _eqs(eq)
    if len(eqs) == 1:
        v = _var_for(eqs[0], v if not isinstance(v, sp.MatrixBase) else None)
        f = sp.lambdify(v, eqs[0], "mpmath")
        return _with_dps(lambda: Solutions([_float_result(mpmath.findroot(f, _mpf(x0) if sp.sympify(x0).is_real else mpmath.mpc(complex(x0))))], [v]))
    vs = _seq(v)
    guesses = _seq(x0)
    if len(guesses) == 1:
        guesses = guesses * len(vs)

    def run():
        r = sp.nsolve(eqs, vs, guesses, prec=mpmath.mp.dps)
        return Solutions([tuple(r)], vs)
    return _with_dps(run)


def f_roots(p, v=None):
    if isinstance(p, sp.MatrixBase):  # coefficients, highest first
        coeffs = list(p)
        v = x_
        poly = sp.Poly(coeffs, v)
    else:
        if isinstance(p, sp.Equality):
            p = p.lhs - p.rhs
        v = _var_for(p, v)
        poly = sp.Poly(p, v)
    if _numeric_mode():
        return Solutions(poly.nroots(n=int(SETTINGS["digits"]) + 3), [v])
    rs = sp.roots(poly, multiple=True)
    if len(rs) < poly.degree():
        rs = [sp.CRootOf(poly, i) for i in range(poly.degree())]
    return Solutions(rs, [v])


def f_proots(coeffs):
    return f_roots(coeffs if isinstance(coeffs, sp.MatrixBase) else sp.Matrix(_seq(coeffs)))


def f_subs(e, *a):
    pairs = []
    i = 0
    while i < len(a):
        if isinstance(a[i], sp.Equality):
            pairs.append((a[i].lhs, a[i].rhs))
            i += 1
        else:
            pairs.append((a[i], a[i + 1]))
            i += 2
    return e.subs(pairs)


def f_apart(e, v=None):
    return sp.apart(e, _var_for(e, v))


def f_collect(e, v=None):
    return sp.collect(sp.expand(e), _var_for(e, v))


# ---- ODEs

class _Prime(sp.Function):
    """y' placeholders (f, k): replaced by Derivative(f(var), var, k) in dsolve."""
    nargs = 2

    def _latex(self, printer=None):
        return sp.latex(self.args[0]) + "'" * int(self.args[1])


class _PrimeAt(sp.Function):
    """y'(a) placeholders (f, k, a) in initial conditions."""
    nargs = 3

    def _latex(self, printer=None):
        return sp.latex(self.args[0]) + "'" * int(self.args[1]) + r"\left(" + sp.latex(self.args[2]) + r"\right)"


def _ode_var(eq, given):
    if given is not None and isinstance(given, sp.Symbol):
        return given
    fs = {s.name for s in eq.free_symbols}
    if "x" in fs:
        return x_
    if "t" in fs:
        return t_
    return x_


def f_dsolve(eq, *rest):
    eqs = _seq(eq) if isinstance(eq, (sp.MatrixBase, list, tuple)) else [eq]
    funcs, var, ics = [], None, []
    for r in rest:
        if isinstance(r, sp.Equality):
            ics.append(r)
        elif isinstance(r, sp.Symbol) and var is None and funcs:
            var = r
        elif isinstance(r, sp.Symbol):
            funcs.append(r)
        elif isinstance(r, sp.MatrixBase) or isinstance(r, (list, tuple)):
            for i in _seq(r):
                (ics if isinstance(i, sp.Equality) else funcs).append(i)
        elif isinstance(r, AppliedUndefLike()):
            funcs.append(sp.Symbol(r.func.__name__))
            if r.args and isinstance(r.args[0], sp.Symbol):
                var = r.args[0]
    names = set()
    for e in eqs:
        for p in e.atoms(_Prime):
            names.add(str(p.args[0]))
    for f in funcs:
        names.add(str(f))
    if not names:
        raise CalcError("dsolve needs a derivative, e.g. dsolve(y'' + y = 0)")
    probe = sp.Add(*[(e.lhs - e.rhs) if isinstance(e, sp.Equality) else e for e in eqs])
    var = var or _ode_var(probe, None)
    F = {n: sp.Function(n) for n in names}

    def fix(e):
        e = e.replace(lambda a: isinstance(a, _Prime), lambda a: sp.Derivative(F[str(a.args[0])](var), var, int(a.args[1])))
        e = e.subs({sp.Symbol(n): F[n](var) for n in names})
        e = e.replace(lambda a: isinstance(a, sp.Function) and type(a).__name__ in names and a.args != (var,) and len(a.args) == 1, lambda a: F[type(a).__name__](a.args[0]))
        return e
    eqs2 = [fix(e) for e in eqs]
    ic = {}
    for c in ics:
        lhs = c.lhs
        if isinstance(lhs, _PrimeAt):
            n, k, at = str(lhs.args[0]), int(lhs.args[1]), lhs.args[2]
            ic[sp.Derivative(F[n](var), var, k).subs(var, at)] = c.rhs
        else:
            lhs = fix(lhs)
            ic[lhs] = c.rhs
    target = [F[n](var) for n in sorted(names)]
    r = sp.dsolve(eqs2 if len(eqs2) > 1 else eqs2[0], target if len(target) > 1 else target[0], ics=ic or None)
    return r


def AppliedUndefLike():
    from sympy.core.function import AppliedUndef
    return AppliedUndef


def f_odesolve(f, tv, yv, t0, y0, t1):
    """y' = f(t, y), y(t0) = y0: y(t1). Scalar: mpmath (full precision); vector: SciPy."""
    if isinstance(y0, sp.MatrixBase) or isinstance(yv, sp.MatrixBase):
        import numpy as np
        from scipy.integrate import solve_ivp
        ys = _seq(yv)
        fs = _seq(f)
        fn = sp.lambdify([tv, ys], fs, "numpy")
        sol = solve_ivp(lambda t, y: np.asarray(fn(t, list(y)), dtype=float), (float(t0), float(t1)),
                        [float(v) for v in _seq(y0)], rtol=1e-11, atol=1e-13)
        if not sol.success:
            raise CalcError(sol.message)
        return sp.Matrix([sp.Float(v, 15) for v in sol.y[:, -1]])
    fn = sp.lambdify((tv, yv), f, "mpmath")

    def run():
        sol = mpmath.odefun(fn, _mpf(t0), _mpf(y0))
        return _float_result(sol(_mpf(t1)))
    return _with_dps(run)


# ---- linear algebra

def _M(v):
    if isinstance(v, sp.MatrixBase):
        return v
    if isinstance(v, (list, tuple)):
        return to_matrix(list(v))
    raise CalcError("Expected a matrix or vector")


def to_matrix(rows):
    """[[1,2],[3,4]] -> Matrix; [1,2,3] -> a column vector. Lists of equations stay lists."""
    flat = []

    def walk(r):
        for i in r:
            if isinstance(i, (list, tuple)):
                walk(i)
            else:
                flat.append(i)
    walk(rows)
    if any(not isinstance(sp.sympify(i), sp.Expr) for i in flat if not isinstance(i, sp.MatrixBase)):
        return sp.Tuple(*rows) if not any(isinstance(i, list) for i in rows) else rows
    if rows and all(isinstance(r, (list, tuple)) for r in rows):
        n = len(rows[0])
        if any(len(r) != n for r in rows):
            raise CalcError("Every row of a matrix needs the same number of entries")
        return sp.Matrix(rows)
    if rows and all(isinstance(r, sp.MatrixBase) for r in rows):
        return sp.Matrix.hstack(*rows) if all(r.cols == 1 for r in rows) and False else sp.Matrix.vstack(*[r.T if r.cols == 1 else r for r in rows])
    return sp.Matrix(rows)


class Labeled(sp.Basic):
    """Several named results: L, U, P = lu(A)."""

    def __new__(cls, items):
        obj = sp.Basic.__new__(cls)
        obj.items = items
        return obj

    def _latex(self, printer=None):
        return r",\quad ".join(f"{k} = {sp.latex(v)}" for k, v in self.items)

    def _sympystr(self, printer=None):
        return ", ".join(f"{k} = {_text(v)}" for k, v in self.items)

    def evalf(self, n=15, **kw):
        return Labeled([(k, sp.N(v, n) if isinstance(v, sp.Basic) else v) for k, v in self.items])


def _is_float_matrix(A):
    return any(isinstance(e, sp.Float) for e in A)


def f_det(A):
    return _M(A).det()


def f_inv(A):
    A = _M(A)
    if A.det() == 0:
        raise CalcError("The matrix is singular (det = 0)")
    return A.inv()


def f_transpose(A):
    return _M(A).T


def f_rank(A):
    return sp.Integer(_M(A).rank())


def f_rref(A):
    return _M(A).rref()[0]


def f_trace(A):
    return _M(A).trace()


def f_eigenvals(A):
    A = _M(A)
    if _numeric_mode() or _is_float_matrix(A):
        def run():
            ev, _ = mpmath.eig(mpmath.matrix(A.evalf(mpmath.mp.dps).tolist()))
            return sp.Matrix([_float_result(v) for v in ev])
        return _with_dps(run)
    vals = A.eigenvals()
    out = []
    for v, m in vals.items():
        out.extend([v] * m)
    return sp.Matrix(out)


def f_eigenvects(A):
    A = _M(A)
    if _numeric_mode() or _is_float_matrix(A):
        def run():
            ev, er = mpmath.eig(mpmath.matrix(A.evalf(mpmath.mp.dps).tolist()))
            items = []
            for i, v in enumerate(ev):
                vec = sp.Matrix([_float_result(er[j, i]) for j in range(A.rows)])
                items.append((f"\\lambda_{{{i + 1}}} = {sp.latex(_float_result(v))},\\ v_{{{i + 1}}}", vec))
            return Labeled(items)
        return _with_dps(run)
    items = []
    k = 1
    for val, mult, vecs in A.eigenvects():
        for vec in vecs:
            items.append((f"\\lambda_{{{k}}} = {sp.latex(val)},\\ v_{{{k}}}", vec))
            k += 1
    return Labeled(items)


def f_lu(A):
    A = _M(A)
    L, Uu, perm = A.LUdecomposition()
    P = sp.eye(A.rows).permute_rows(perm) if perm else sp.eye(A.rows)
    return Labeled([("P", P), ("L", L), ("U", Uu)])


def f_qr(A):
    A = _M(A)
    if _numeric_mode() or _is_float_matrix(A):
        def run():
            Q, R = mpmath.qr(mpmath.matrix(A.evalf(mpmath.mp.dps).tolist()))
            return Labeled([("Q", _from_mp(Q)), ("R", _from_mp(R))])
        return _with_dps(run)
    Q, R = A.QRdecomposition()
    return Labeled([("Q", Q), ("R", R)])


def _from_mp(M):
    return sp.Matrix(M.rows, M.cols, lambda i, j: _float_result(M[i, j]))


def f_svd(A):
    A = _M(A)

    def run():
        Uu, S, V = mpmath.svd(mpmath.matrix(A.evalf(mpmath.mp.dps).tolist()))
        return Labeled([("U", _from_mp(Uu)), ("\\Sigma", sp.diag(*[_float_result(s) for s in S])), ("V^T", _from_mp(V))])
    if not _numeric_mode() and not _is_float_matrix(A) and A.rows * A.cols <= 9:
        try:
            Uu, S, V = A.singular_value_decomposition()
            return Labeled([("U", sp.simplify(Uu)), ("\\Sigma", sp.simplify(S)), ("V^T", sp.simplify(V.T))])
        except Exception:
            pass
    return _with_dps(run)


def f_cholesky(A):
    return _M(A).cholesky(hermitian=True)


def f_norm(A, p=2):
    A = _M(A)
    if str(p) in ("oo", "inf"):
        p = sp.oo
    return A.norm(p if p != "fro" else None)


def f_cond(A):
    A = _M(A)
    return _with_dps(lambda: _float_result(mpmath.cond(mpmath.matrix(A.evalf(mpmath.mp.dps).tolist()), mpmath.norm)))


def f_cross(a, b):
    return _M(a).cross(_M(b)) if _M(a).shape == _M(b).shape else _M(a).reshape(3, 1).cross(_M(b).reshape(3, 1))


def f_dot(a, b):
    a, b = _M(a), _M(b)
    return sum((x * y for x, y in zip(a, b)), sp.Integer(0))


def f_linsolve(A, b):
    A, b = _M(A), _M(b)
    if b.cols != 1 and b.rows == 1:
        b = b.T
    if A.rows == A.cols and A.det() != 0:
        return A.LUsolve(b)
    sol, params = A.gauss_jordan_solve(b)
    return sol


def f_lstsq(A, b):
    A, b = _M(A), _M(b)
    return (A.T * A).inv() * A.T * b


def f_eye(n, m=None):
    return sp.eye(int(n), int(m) if m is not None else int(n))


def f_zeros(n, m=None):
    return sp.zeros(int(n), int(m) if m is not None else int(n))


def f_ones(n, m=None):
    return sp.ones(int(n), int(m) if m is not None else int(n))


def f_diag(*a):
    return sp.diag(*_args_seq(a))


def f_adj(A):
    return _M(A).adjugate()


def f_charpoly(A, lam=None):
    lam = lam or sp.Symbol("lamda")
    return _M(A).charpoly(lam).as_expr()


def f_expm(A):
    return _M(A).exp()


def f_kron(a, b):
    from sympy.physics.quantum import TensorProduct
    return TensorProduct(_M(a), _M(b))


def f_nullspace(A):
    ns = _M(A).nullspace()
    return sp.Matrix.hstack(*ns) if ns else sp.zeros(_M(A).cols, 1)


def f_dim(A):
    A = _M(A)
    return sp.Matrix([[A.rows, A.cols]])


# ---- statistics on lists

def _vals(*a):
    vs = [sp.sympify(v) for v in _args_seq(a)]
    if not vs:
        raise CalcError("Empty list")
    return vs


def f_mean(*a):
    vs = _vals(*a)
    return sp.Add(*vs) / len(vs)


def f_median(*a):
    vs = sorted(_vals(*a), key=lambda v: float(sp.N(v)))
    n = len(vs)
    return vs[n // 2] if n % 2 else (vs[n // 2 - 1] + vs[n // 2]) / 2


def f_var(*a):
    vs = _vals(*a)
    if len(vs) < 2:
        raise CalcError("The sample variance needs two values or more")
    m = sp.Add(*vs) / len(vs)
    return sp.Add(*[(v - m) ** 2 for v in vs]) / (len(vs) - 1)


def f_pvar(*a):
    vs = _vals(*a)
    m = sp.Add(*vs) / len(vs)
    return sp.Add(*[(v - m) ** 2 for v in vs]) / len(vs)


def f_stdev(*a):
    return sp.sqrt(f_var(*a))


def f_pstdev(*a):
    return sp.sqrt(f_pvar(*a))


def f_mode(*a):
    vs = _vals(*a)
    counts = {}
    for v in vs:
        counts[v] = counts.get(v, 0) + 1
    top = max(counts.values())
    return sp.Matrix([v for v, c in counts.items() if c == top])


def f_quantile(data, q):
    import numpy as np
    vs = [float(sp.N(v)) for v in _seq(data)]
    return sp.Float(float(np.quantile(vs, float(q))), 15)


def f_cov(a, b):
    xs, ys = _vals(a), _vals(b)
    mx, my = sp.Add(*xs) / len(xs), sp.Add(*ys) / len(ys)
    return sp.Add(*[(x - mx) * (y - my) for x, y in zip(xs, ys)]) / (len(xs) - 1)


def f_corr(a, b):
    return f_cov(a, b) / (f_stdev(a) * f_stdev(b))


# ---- distributions (exact where SymPy can, SciPy otherwise)

def _sp_float(v):
    return sp.Float(float(v), 15)


def _scipy_stats():
    import scipy.stats as st
    return st


def normpdf(xv, mu=0, s=1):
    return sp.exp(-((xv - mu) ** 2) / (2 * s**2)) / (s * sp.sqrt(2 * sp.pi))


def normcdf(xv, mu=0, s=1, upper=None):
    """normcdf(x) = P(X <= x); normcdf(a, b, mu, s) = P(a <= X <= b) when given 4 values."""
    if upper is not None:  # (a, b, mu, s)
        a, b, m, sd = xv, mu, s, upper
        return normcdf(b, m, sd) - normcdf(a, m, sd)
    return (1 + sp.erf((xv - mu) / (s * sp.sqrt(2)))) / 2


def invnorm(p, mu=0, s=1):
    return mu + s * sp.sqrt(2) * sp.erfinv(2 * p - 1)


def tpdf(xv, df):
    return _sp_float(_scipy_stats().t.pdf(float(xv), float(df)))


def tcdf(xv, df):
    return _sp_float(_scipy_stats().t.cdf(float(xv), float(df)))


def invt(p, df):
    return _sp_float(_scipy_stats().t.ppf(float(p), float(df)))


def chi2pdf(xv, k):
    return _sp_float(_scipy_stats().chi2.pdf(float(xv), float(k)))


def chi2cdf(xv, k):
    return _sp_float(_scipy_stats().chi2.cdf(float(xv), float(k)))


def invchi2(p, k):
    return _sp_float(_scipy_stats().chi2.ppf(float(p), float(k)))


def fpdf(xv, d1, d2):
    return _sp_float(_scipy_stats().f.pdf(float(xv), float(d1), float(d2)))


def fcdf(xv, d1, d2):
    return _sp_float(_scipy_stats().f.cdf(float(xv), float(d1), float(d2)))


def invf(p, d1, d2):
    return _sp_float(_scipy_stats().f.ppf(float(p), float(d1), float(d2)))


def binompdf(k, n, p):
    return sp.binomial(n, k) * p**k * (1 - p) ** (n - k)


def binomcdf(k, n, p):
    k = int(sp.floor(k))
    return sp.Add(*[binompdf(sp.Integer(i), n, p) for i in range(0, k + 1)])


def poisspdf(k, lam):
    return lam**k * sp.exp(-lam) / sp.factorial(k)


def poisscdf(k, lam):
    k = int(sp.floor(k))
    return sp.Add(*[poisspdf(sp.Integer(i), lam) for i in range(0, k + 1)])


def geompdf(k, p):
    return (1 - p) ** (k - 1) * p


def geomcdf(k, p):
    return 1 - (1 - p) ** sp.floor(k)


def exppdf(xv, lam):
    return lam * sp.exp(-lam * xv) if xv >= 0 else sp.Integer(0)


def expcdf(xv, lam):
    return 1 - sp.exp(-lam * xv) if xv >= 0 else sp.Integer(0)


def unifpdf(xv, a, b):
    return 1 / (b - a) if a <= xv <= b else sp.Integer(0)


def unifcdf(xv, a, b):
    return sp.Integer(0) if xv < a else sp.Integer(1) if xv > b else (xv - a) / (b - a)


# ---- misc

def f_convert(e, target, to=None):
    if to is not None:  # convert(20, "degC", "K") / convert(3, km, mi)
        return convert_value(e, str(target).strip('"'), str(to).strip('"'))
    return convert_units(e, target)


def f_const(name):
    return constant(str(name))


def f_approx(e, n=None):
    return sp.N(e, int(n) if n is not None else int(SETTINGS["digits"]))


def f_exact(e):
    return sp.nsimplify(e, rational=False)


def f_tofrac(e, maxden=10**6):
    v = sp.N(e, 30)
    from fractions import Fraction
    return sp.Rational(Fraction(str(v)).limit_denominator(int(maxden)))


# ------------------------------------------------------------- namespace

def _trig_ns():
    ns = {}
    for n, f in (("sin", sp.sin), ("cos", sp.cos), ("tan", sp.tan), ("sec", sp.sec), ("csc", sp.csc), ("cot", sp.cot)):
        ns[n] = _fwd(f) if SETTINGS["angle"] != "rad" else f
    for n, f in (("asin", sp.asin), ("acos", sp.acos), ("atan", sp.atan), ("asec", sp.asec), ("acsc", sp.acsc), ("acot", sp.acot)):
        g = _inv(f) if SETTINGS["angle"] != "rad" else f
        ns[n] = g
        ns["arc" + n[1:]] = g
    ns["atan2"] = f_atan2
    ns["_DEG_"] = 1 / _angle_factor() * sp.pi / 180 if SETTINGS["angle"] != "deg" else sp.Integer(1)
    if SETTINGS["angle"] == "rad":
        ns["_DEG_"] = sp.pi / 180
    elif SETTINGS["angle"] == "grad":
        ns["_DEG_"] = sp.Rational(10, 9)
    return ns


BASE_NS = {
    # constants
    "pi": sp.pi, "e": sp.E, "E": sp.E, "i": sp.I, "I": sp.I, "oo": sp.oo, "inf": sp.oo, "infinity": sp.oo,
    "phi": sp.GoldenRatio, "euler_gamma": sp.EulerGamma, "catalan": sp.Catalan, "true": sp.true, "false": sp.false,
    # elementary
    "sqrt": sp.sqrt, "cbrt": lambda v: sp.real_root(v, 3), "root": f_root, "nthroot": f_root, "exp": sp.exp, "ln": sp.log,
    "log": f_log, "log10": lambda v: sp.log(v, 10), "log2": lambda v: sp.log(v, 2), "lg": lambda v: sp.log(v, 10),
    "abs": sp.Abs, "sign": f_sign, "sgn": f_sign, "floor": sp.floor, "ceil": sp.ceiling, "ceiling": sp.ceiling,
    "round": f_round, "trunc": f_trunc, "ipart": f_trunc, "frac": f_frac, "fpart": f_frac, "mod": f_mod,
    "max": f_max, "min": f_min,
    "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh, "sech": sp.sech, "csch": sp.csch, "coth": sp.coth,
    "asinh": sp.asinh, "acosh": sp.acosh, "atanh": sp.atanh, "asech": sp.asech, "acsch": sp.acsch, "acoth": sp.acoth,
    "arcsinh": sp.asinh, "arccosh": sp.acosh, "arctanh": sp.atanh, "sinc": sp.sinc,
    # complex
    "re": sp.re, "im": sp.im, "arg": f_arg, "angle": f_arg, "conj": sp.conjugate, "conjugate": sp.conjugate,
    "polar": f_polar, "cis": f_cis,
    # special functions
    "gamma": sp.gamma, "lgamma": f_lgamma, "loggamma": sp.loggamma, "digamma": sp.digamma, "polygamma": sp.polygamma,
    "beta": f_beta, "lowergamma": sp.lowergamma, "uppergamma": sp.uppergamma, "erf": sp.erf, "erfc": sp.erfc,
    "erfi": sp.erfi, "erfinv": f_erfinv, "erfcinv": sp.erfcinv, "besselj": f_besselj, "bessely": sp.bessely,
    "besseli": sp.besseli, "besselk": sp.besselk, "jn": sp.jn, "yn": sp.yn, "hankel1": sp.hankel1, "hankel2": sp.hankel2,
    "airyai": sp.airyai, "airybi": sp.airybi, "airyaiprime": sp.airyaiprime, "airybiprime": sp.airybiprime,
    "zeta": sp.zeta, "eta": sp.dirichlet_eta, "polylog": sp.polylog, "lambertw": f_lambertw, "LambertW": f_lambertw, "W": f_lambertw,
    "legendre": sp.legendre, "assoc_legendre": sp.assoc_legendre, "hermite": sp.hermite, "laguerre": sp.laguerre,
    "assoc_laguerre": sp.assoc_laguerre, "chebyshevt": sp.chebyshevt, "chebyshevu": sp.chebyshevu, "jacobi": sp.jacobi,
    "gegenbauer": sp.gegenbauer, "Ynm": sp.Ynm, "Ei": sp.Ei, "li": sp.li, "Si": sp.Si, "Ci": sp.Ci, "Shi": sp.Shi,
    "Chi": sp.Chi, "fresnels": sp.fresnels, "fresnelc": sp.fresnelc, "ellipk": sp.elliptic_k, "ellipe": sp.elliptic_e,
    "ellipf": sp.elliptic_f, "ellippi": sp.elliptic_pi, "hyper": sp.hyper, "heaviside": sp.Heaviside,
    "dirac": sp.DiracDelta, "kronecker": sp.KroneckerDelta,
    # combinatorics & number theory
    "factorial": sp.factorial, "factorial2": sp.factorial2, "binomial": sp.binomial, "nCr": sp.binomial, "comb": sp.binomial,
    "nPr": f_perm, "perm": f_perm, "gcd": f_gcd, "lcm": f_lcm, "isprime": f_isprime, "nextprime": sp.nextprime,
    "prevprime": sp.prevprime, "prime": sp.prime, "primepi": sp.primepi, "factorint": f_factorint, "divisors": lambda n: sp.Matrix([sp.divisors(n)]),
    "totient": sp.totient, "phi_euler": sp.totient, "mobius": sp.mobius, "powmod": f_powmod, "invmod": f_invmod,
    "fibonacci": sp.fibonacci, "lucas": sp.lucas, "catalan_number": sp.catalan, "bernoulli": sp.bernoulli,
    "euler_number": sp.euler, "bell": sp.bell, "partition": sp.partition, "stirling": lambda n, k: sp.functions.combinatorial.numbers.stirling(n, k),
    "digits": f_digits,
    "band": f_band, "bor": f_bor, "bxor": f_bxor, "bnot": f_bnot, "shl": f_shl, "shr": f_shr,
    # algebra & calculus
    "simplify": sp.simplify, "expand": sp.expand, "factor": f_factor, "apart": f_apart, "together": sp.together,
    "cancel": sp.cancel, "collect": f_collect, "trigsimp": sp.trigsimp, "expand_trig": sp.expand_trig,
    "expand_log": lambda e: sp.expand_log(e, force=True), "logcombine": lambda e: sp.logcombine(e, force=True),
    "powsimp": sp.powsimp, "radsimp": sp.radsimp, "nsimplify": sp.nsimplify, "rewrite": lambda e, f: e.rewrite(f),
    "numer": sp.numer, "denom": sp.denom, "degree": sp.degree, "coeffs": lambda p, v=None: sp.Matrix([sp.Poly(p, _var_for(p, v)).all_coeffs()]),
    "quo": lambda a, b: sp.quo(a, b), "rem": lambda a, b: sp.rem(a, b), "subs": f_subs,
    "diff": f_diff, "derivative": f_diff, "nderiv": f_nderiv, "integrate": f_integrate, "int": f_integrate,
    "integral": f_integrate, "nint": f_nint, "quad": f_nint, "limit": f_limit, "lim": f_limit, "series": f_series,
    "taylor": f_taylor, "sum": f_sum, "summation": f_sum, "product": f_product, "prod": f_product,
    "solve": f_solve, "nsolve": f_nsolve, "fsolve": f_nsolve, "roots": f_roots, "proots": f_proots, "dsolve": f_dsolve,
    "odesolve": f_odesolve, "Eq": sp.Eq,
    # linear algebra
    "det": f_det, "inv": f_inv, "inverse": f_inv, "transpose": f_transpose, "trn": f_transpose, "rank": f_rank,
    "rref": f_rref, "trace": f_trace, "tr": f_trace, "eigenvals": f_eigenvals, "eigvals": f_eigenvals, "eig": f_eigenvects,
    "eigenvects": f_eigenvects, "lu": f_lu, "qr": f_qr, "svd": f_svd, "cholesky": f_cholesky, "norm": f_norm,
    "cond": f_cond, "cross": f_cross, "dot": f_dot, "linsolve": f_linsolve, "lstsq": f_lstsq, "eye": f_eye,
    "identity": f_eye, "zeros": f_zeros, "ones": f_ones, "diag": f_diag, "adj": f_adj, "charpoly": f_charpoly,
    "expm": f_expm, "kron": f_kron, "nullspace": f_nullspace, "kernel": f_nullspace, "dim": f_dim, "Matrix": sp.Matrix,
    # statistics
    "mean": f_mean, "median": f_median, "var": f_var, "pvar": f_pvar, "stdev": f_stdev, "std": f_stdev,
    "pstdev": f_pstdev, "mode": f_mode, "quantile": f_quantile, "cov": f_cov, "corr": f_corr,
    "normpdf": normpdf, "normcdf": normcdf, "invnorm": invnorm, "tpdf": tpdf, "tcdf": tcdf, "invt": invt,
    "chi2pdf": chi2pdf, "chi2cdf": chi2cdf, "invchi2": invchi2, "fpdf": fpdf, "fcdf": fcdf, "invf": invf,
    "binompdf": binompdf, "binomcdf": binomcdf, "poisspdf": poisspdf, "poisscdf": poisscdf, "geompdf": geompdf,
    "geomcdf": geomcdf, "exppdf": exppdf, "expcdf": expcdf, "unifpdf": unifpdf, "unifcdf": unifcdf,
    # units, constants, numbers
    "convert": f_convert, "const": f_const, "approx": f_approx, "N": f_approx, "exact": f_exact, "tofrac": f_tofrac,
    # internals used by the preprocessor
    "_M_": lambda rows: to_matrix(rows), "_polar_": f_polar, "_DER_": _Prime, "_DAT_": _PrimeAt,
}


def function_names():
    return sorted(k for k in {**BASE_NS, **_trig_ns()} if not k.startswith("_"))


# ------------------------------------------------------------ preprocessing

_IDENT = re.compile(r"[A-Za-z_À-ɏͰ-Ͽ][A-Za-z0-9_À-ɏͰ-Ͽ]*")
_SIMPLE = {
    "×": "*", "·": "*", "÷": "/", "−": "-", "–": "-", "π": "pi", "∞": "oo", "≤": "<=", "≥": ">=", "≠": "!=",
    "²": "**2", "³": "**3", "⁻¹": "**(-1)", "ℯ": "E", "ⅈ": "I", "λ": "lamda", "→": "▶", "⇒": "▶",
}


def _match_paren(s, i):
    """Index of the bracket closing the one at s[i]."""
    pairs = {"(": ")", "[": "]", "{": "}"}
    open_, close = s[i], pairs[s[i]]
    depth = 0
    j = i
    while j < len(s):
        c = s[j]
        if c == open_:
            depth += 1
        elif c == close:
            depth -= 1
            if depth == 0:
                return j
        j += 1
    raise CalcError(f"Missing '{close}'")


def _operand_right(s, i):
    """The operand starting at s[i]: a signed number, a name with its call, or a bracketed group (with ° kept)."""
    j = i
    while j < len(s) and s[j] == " ":
        j += 1
    k = j
    if k < len(s) and s[k] in "+-":
        k += 1
    if k < len(s) and s[k] == "(":
        k = _match_paren(s, k) + 1
    else:
        m = re.match(r"[0-9.]+(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*", s[k:])
        if not m:
            raise CalcError("∠ needs an angle after it")
        k += m.end()
        if k < len(s) and s[k] == "(":
            k = _match_paren(s, k) + 1
    if k < len(s) and s[k] == "°":
        k += 1
    return j, k


def _operand_left(s, i):
    """The operand ending just before s[i]."""
    k = i
    while k > 0 and s[k - 1] == " ":
        k -= 1
    end = k
    if k > 0 and s[k - 1] == ")":
        depth = 0
        j = k - 1
        while j >= 0:
            if s[j] == ")":
                depth += 1
            elif s[j] == "(":
                depth -= 1
                if depth == 0:
                    break
            j -= 1
        k = j
        while k > 0 and (s[k - 1].isalnum() or s[k - 1] == "_"):
            k -= 1
    else:
        while k > 0 and (s[k - 1].isalnum() or s[k - 1] in "._"):
            k -= 1
    if k == end:
        raise CalcError("∠ needs a modulus before it")
    return k, end


def _polar_pass(s):
    while "∠" in s:
        i = s.index("∠")
        a, b = _operand_left(s, i)
        c, d = _operand_right(s, i + 1)
        s = s[:a] + f"_polar_({s[a:b]}, {s[c:d]})" + s[d:]
    return s


def _fix_equals(s):
    """a = b -> Eq(a, b), argument by argument, at every bracket level."""
    out, i = _eq_level(s, 0, None)
    return out


def _eq_level(s, i, closer):
    args, cur = [], []
    while i < len(s):
        c = s[i]
        if c in "([{":
            inner, i = _eq_level(s, i + 1, {"(": ")", "[": "]", "{": "}"}[c])
            cur.append(c + inner + {"(": ")", "[": "]", "{": "}"}[c])
            continue
        if c == closer:
            args.append("".join(cur))
            return ",".join(_eq_arg(a) for a in args), i + 1
        if c == "," and closer is not None:
            args.append("".join(cur))
            cur = []
            i += 1
            continue
        if c in "\"'":
            j = s.index(c, i + 1) if c in s[i + 1:] else len(s) - 1
            cur.append(s[i:j + 1])
            i = j + 1
            continue
        cur.append(c)
        i += 1
    args.append("".join(cur))
    return ",".join(_eq_arg(a) for a in args), i


_EQ = re.compile(r"(?<![=<>!:])=(?!=)")


def _eq_arg(a):
    parts = _EQ.split(a)
    if len(parts) == 2:
        return f"Eq({parts[0]}, {parts[1]})"
    if len(parts) > 2:
        raise CalcError("Only one '=' per equation")
    return a


INTERNAL = {"_M_", "_polar_", "_DER_", "_DAT_", "_DEG_"}


def preprocess(src, ctx):
    s = src
    for k, v in _SIMPLE.items():
        s = s.replace(k, v)
    s = s.replace("°C", " _degC").replace("°F", " _degF")
    s = _polar_pass(s)
    out = []
    i, n = 0, len(s)
    brackets = []
    prime_names = set(re.findall(r"([A-Za-z]\w*)'", s))
    while i < n:
        c = s[i]
        prev = out[-1][-1] if out and out[-1] else ""
        # strings
        if c in "\"'" and not (prev and (prev.isalnum() or prev == "_" or prev == "'")):
            j = s.find(c, i + 1)
            if j < 0:
                raise CalcError("Missing closing quote")
            out.append(s[i:j + 1])
            i = j + 1
            continue
        # √x, ∛x
        if c in "√∛":
            fn = "sqrt" if c == "√" else "cbrt"
            j = i + 1
            if j < n and s[j] == "(":
                out.append(fn)
                i = j
                continue
            m = re.match(r"[0-9.]+|[A-Za-z_]\w*", s[j:])
            if not m:
                raise CalcError(f"{c} needs a value")
            out.append(f"{fn}({m.group(0)})")
            i = j + m.end()
            continue
        if c == "°":
            out.append("*_DEG_")
            i += 1
            continue
        # constants #c, #hbar
        if c == "#":
            m = _IDENT.match(s, i + 1)
            if not m:
                raise CalcError("# needs a constant name, e.g. #c")
            name = m.group(0)
            ctx.setdefault("consts", set()).add(name)
            out.append(("*" if prev.isdigit() or prev == ")" else "") + f"_K_{name}")
            i = m.end()
            continue
        # numbers (0x, 0b, 0o literals)
        if c.isdigit() and not (prev and (prev.isalnum() or prev == "_")):
            m = re.match(r"0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+", s[i:])
            if m:
                out.append(str(int(m.group(0).replace("_", ""), 0)))
                i += m.end()
                continue
            m = re.match(r"\d(?:_?\d)*(\.\d*)?([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?", s[i:])
            tok = m.group(0)
            out.append(tok)
            i += m.end()
            if i < n and s[i] == "_" and i + 1 < n and not s[i + 1].isdigit():
                out.append(" ")
            continue
        # identifiers: units (_m), primes (y''), function applications of ODE unknowns
        m = _IDENT.match(s, i)
        if m:
            name = m.group(0)
            j = m.end()
            if name.startswith("_") and name not in INTERNAL and not name.startswith(("_K_", "_F_", "_U_")):
                if name[1:] in ("degC", "degF", "degR"):
                    out.append(f"_U_{name[1:]}")
                else:
                    lookup_unit(name[1:])  # unknown units fail early with a clear message
                    ctx.setdefault("units", set()).add(name[1:])
                    out.append(f"_U_{name[1:]}")
                i = j
                continue
            k = j
            while k < n and s[k] == "'":
                k += 1
            if k > j:
                order = k - j
                if k < n and s[k] == "(":
                    e = _match_paren(s, k)
                    out.append(f"_DAT_({name}, {order}, ({s[k + 1:e]}))")
                    i = e + 1
                else:
                    out.append(f"_DER_({name}, {order})")
                    i = k
                continue
            if name in prime_names and j < n and s[j] == "(":
                ctx.setdefault("odefuncs", set()).add(name)
                out.append(f"_F_{name}")
                i = j
                continue
            out.append(name)
            i = j
            continue
        if c == "[":
            p = "".join(out).rstrip()[-1:] if out else ""
            if p and (p.isalnum() or p in "_)]"):
                brackets.append("idx")
                out.append("[")
            elif brackets and brackets[-1] in ("mat", "row"):
                brackets.append("row")
                out.append("[")
            else:
                brackets.append("mat")
                out.append("_M_([")
            i += 1
            continue
        if c == "]":
            kind = brackets.pop() if brackets else "idx"
            out.append("])" if kind == "mat" else "]")
            i += 1
            continue
        out.append(c)
        i += 1
    s = "".join(out)
    _check_brackets(s)
    s = _fix_equals(s)
    return s


def _check_brackets(s):
    stack = []
    quote = None
    for c in s:
        if quote:
            if c == quote:
                quote = None
            continue
        if c in "\"'" and False:
            quote = c
        if c in "([{":
            stack.append(c)
        elif c in ")]}":
            if not stack or {"(": ")", "[": "]", "{": "}"}[stack.pop()] != c:
                raise CalcError(f"'{c}' has no opening bracket")
    if stack:
        raise CalcError("Missing '" + {"(": ")", "[": "]", "{": "}"}[stack[-1]] + "'")


# ------------------------------------------------------------------ parsing

def _local_dict(ctx, ans_ids, preview=False):
    ld = dict(BASE_NS)
    ld.update(_trig_ns())
    if preview:
        # Show what was typed: no heavy work, names stay names.
        for name in ("integrate", "int", "integral", "nint", "quad"):
            ld[name] = _show_integral
        for name in ("diff", "derivative"):
            ld[name] = _show_diff
        for name in ("sum", "summation"):
            ld[name] = _show_sum
        for name in ("product", "prod"):
            ld[name] = _show_product
        for name in ("limit", "lim"):
            ld[name] = _show_limit
        for name in ("sin", "cos", "tan", "sec", "csc", "cot"):
            ld[name] = getattr(sp, name)
        for name in ("asin", "acos", "atan", "asec", "acsc", "acot"):
            ld[name] = getattr(sp, name)
            ld["arc" + name[1:]] = getattr(sp, name)
        heavy = ("solve", "nsolve", "fsolve", "roots", "proots", "dsolve", "odesolve", "simplify", "expand", "factor",
                 "apart", "together", "cancel", "collect", "trigsimp", "expand_trig", "series", "taylor", "det", "inv",
                 "inverse", "rref", "rank", "eigenvals", "eigvals", "eig", "eigenvects", "lu", "qr", "svd", "cholesky",
                 "norm", "cond", "linsolve", "lstsq", "expm", "nullspace", "kernel", "charpoly", "adj", "factorint",
                 "divisors", "convert", "subs", "nderiv", "mean", "median", "var", "stdev", "mode", "quantile",
                 "cov", "corr", "binomcdf", "poisscdf", "prime", "nextprime", "prevprime", "isprime", "totient",
                 "transpose", "trn", "trace", "tr", "cross", "dot", "dim", "approx", "N", "exact", "tofrac",
                 "factorial2", "lowergamma", "uppergamma", "ln", "log10", "log2", "lg", "nCr", "nPr", "perm", "comb", "mod",
                 "gcd", "lcm", "powmod", "invmod", "polar", "cis", "arg", "angle", "max", "min", "round", "trunc", "ipart",
                 "frac", "fpart", "ceil", "sign", "sgn", "cbrt", "root", "nthroot", "lgamma", "erfinv", "lambertw", "W",
                 "fibonacci", "band", "bor", "bxor", "bnot", "shl", "shr", "digits")
        for name in heavy:
            ld[name] = sp.Function(name)
        ld["log"] = lambda v, b=None, **kw: sp.Function("log")(v) if b is None else sp.log(v, b, **kw)
    for name in ctx.get("units", ()):
        ld[f"_U_{name}"] = lookup_unit(name)
    for name in ("degC", "degF", "degR"):
        ld[f"_U_{name}"] = sp.Symbol({"degC": "°C", "degF": "°F", "degR": "°R"}[name])
    for name in ctx.get("consts", ()):
        ld[f"_K_{name}"] = sp.Symbol(name) if preview else constant(name)
    for name in ctx.get("odefuncs", ()):
        ld[f"_F_{name}"] = sp.Function(name)
    for k, v in LISTS.items():
        ld[k] = sp.Symbol(k) if preview else v
    for k, v in PROGRAM_NS.items():
        if callable(v) and not k.startswith("_") and k not in ld and not isinstance(v, type):
            ld[k] = v
    if preview:
        for k in VARS:
            ld[k] = sp.Symbol(k)
        for k, f in FUNCS.items():
            ld[k] = sp.Function(k)
        ld["ans"] = sp.Symbol("ans")
        for n in range(1, 21):
            ld[f"ans{n}"] = sp.Symbol(f"ans{n}")
    else:
        ld.update(VARS)
        ld.update(FUNCS)
        ids = ans_ids or []
        for n, hid in enumerate(ids[:50], start=1):
            if hid in HIST:
                ld[f"ans{n}"] = HIST[hid]
        if ids and ids[0] in HIST:
            ld["ans"] = HIST[ids[0]]
        for n in range(1, 51):
            ld.setdefault(f"ans{n}", _MissingAns(n))
        ld.setdefault("ans", _MissingAns(0))
    return ld


class _MissingAns:
    def __init__(self, n):
        self.n = n

    def _sympy_(self):
        raise CalcError("There is no previous answer yet" if self.n <= 1 else f"There is no ans{self.n} (only {len(HIST)} results)")


def _show_integral(e, v=None, a=None, b=None):
    v = v if v is not None else _var_for(e)
    if isinstance(v, (sp.Tuple, tuple)):
        return sp.Integral(e, tuple(v))
    return sp.Integral(e, (v, a, b)) if a is not None else sp.Integral(e, v)


def _show_diff(e, v=None, n=1, at=None):
    v = v if v is not None else _var_for(e)
    d = sp.Derivative(e, (v, n))
    return sp.Subs(d, v, at) if at is not None else d


def _show_sum(*a):
    if len(a) == 4:
        return sp.Sum(a[0], (a[1], a[2], a[3]))
    return sp.Function("sum")(*a)


def _show_product(*a):
    if len(a) == 4:
        return sp.Product(a[0], (a[1], a[2], a[3]))
    return sp.Function("product")(*a)


def _show_limit(e, v=None, a=0, d="+-"):
    v = v if v is not None else _var_for(e)
    return sp.Limit(e, v, a, str(d) if str(d) in ("+", "-") else "+-")


def parse(src, ans_ids=None, preview=False, extra=None):
    ctx = {}
    code = preprocess(src, ctx)
    ld = _local_dict(ctx, ans_ids, preview)
    if extra:
        ld.update(extra)
    try:
        if preview:
            with sp.evaluate(False):
                return parse_expr(code, local_dict=ld, transformations=TRANSFORMS, evaluate=False)
        return parse_expr(code, local_dict=ld, transformations=TRANSFORMS)
    except CalcError:
        raise
    except SyntaxError as exc:
        raise CalcError(_syntax_message(src, exc)) from None
    except TokenErrorLike() as exc:
        raise CalcError("Incomplete expression (a bracket is not closed?)") from None


def TokenErrorLike():
    try:
        from tokenize import TokenError
        return TokenError
    except Exception:  # pragma: no cover
        return SyntaxError


def _syntax_message(src, exc):
    msg = str(getattr(exc, "msg", exc))
    if "was never closed" in msg or "unexpected EOF" in msg:
        return "Incomplete expression (a bracket is not closed?)"
    if "unmatched" in msg:
        return "A closing bracket has no opening one"
    return "Syntax error: " + msg.split("(")[0].strip()


# ------------------------------------------------------------------ results

def _sci(v, digits):
    """A real number -> {sign, digits, exp}: value = sign 0.d1d2… × 10^(exp+1), i.e. d1.d2… × 10^exp."""
    mp = mpmath.mpmathify(v)
    if mp == 0:
        return {"sign": "", "digits": "0", "exp": 0}
    if mpmath.isinf(mp):
        return {"sign": "-" if mp < 0 else "", "digits": "inf", "exp": 0}
    if mpmath.isnan(mp):
        return {"sign": "", "digits": "nan", "exp": 0}
    sign, ds, exp = mpmath.libmp.to_digits_exp(mp._mpf_, digits + 3)
    ds, exp = round_digits(ds, int(exp), digits)
    return {"sign": "-" if sign == "-" else "", "digits": ds, "exp": exp}


def round_digits(ds, exp, n):
    """Round the significant digits ds (value d.ddd × 10^exp) to n digits; strip trailing zeros."""
    if len(ds) > n:
        head = [int(c) for c in ds[:n]]
        if int(ds[n]) >= 5:
            k = n - 1
            while k >= 0:
                head[k] += 1
                if head[k] < 10:
                    break
                head[k] = 0
                k -= 1
            if k < 0:
                head = [1] + head[:-1]
                exp += 1
        ds = "".join(map(str, head))
    return ds.rstrip("0") or "0", exp


def numeric(r, digits):
    """{re, im, abs, arg} as scientific digit strings, or None if r is not a plain number."""
    if not isinstance(r, sp.Expr) or not r.is_number or has_units(r):
        return None
    try:
        old = mpmath.mp.dps
        mpmath.mp.dps = digits + 10
        try:
            v = sp.N(r, digits + 5)
            re_, im_ = v.as_real_imag()
            re_m = mpmath.mpmathify(sp.N(re_, digits + 5))
            im_m = mpmath.mpmathify(sp.N(im_, digits + 5))
            out = {"re": _sci(re_m, digits), "im": _sci(im_m, digits) if im_m != 0 else None}
            if im_m != 0:
                z = mpmath.mpc(re_m, im_m)
                ang = mpmath.arg(z)
                f = _angle_factor()
                if f != 1:
                    ang = ang / mpmath.mpmathify(sp.N(f, digits + 10))
                out["abs"] = _sci(abs(z), digits)
                out["arg"] = _sci(ang, digits)
            return out
        finally:
            mpmath.mp.dps = old
    except (TypeError, ValueError, AttributeError):
        return None


def _latex(r):
    if isinstance(r, bool):
        return r"\text{true}" if r else r"\text{false}"
    if r is sp.true or r is True:
        return r"\text{true}"
    if r is sp.false or r is False:
        return r"\text{false}"
    if isinstance(r, str):
        return r"\text{" + r.replace("\\", "") + "}"
    return sp.latex(r, mul_symbol=r"\," if has_units(r) else None, ln_notation=True)


def _text(r):
    if isinstance(r, str):
        return r
    if isinstance(r, sp.MatrixBase):
        return "[" + ", ".join("[" + ", ".join(_text(r[i, j]) for j in range(r.cols)) + "]" for i in range(r.rows)) + "]"
    try:
        if isinstance(r, sp.Basic) and has_units(r):
            r = r.subs({q: sp.Symbol("_" + str(getattr(q, "kc_name", None) or q.abbrev)) for q in r.atoms(Quantity)})
        return sp.sstr(r)
    except Exception:
        return str(r)


def _is_exact(r):
    if not isinstance(r, sp.Basic):
        return True
    return not any(isinstance(a, sp.Float) for a in r.atoms(sp.Float))


def _unit_split(r):
    """5 km -> (5, km)."""
    if not has_units(r) or not isinstance(r, sp.Expr):
        return None
    mag, unit = sp.Integer(1), sp.Integer(1)
    for f in sp.Mul.make_args(r):
        if f.atoms(Quantity) and not (f.free_symbols - f.atoms(Quantity)):
            unit *= f
        else:
            mag *= f
    if mag.free_symbols:
        return None
    return mag, unit


def describe(r, digits):
    """The answer payload for a value."""
    mode = SETTINGS["number"]
    out = {"kind": "value"}
    if isinstance(r, Factored):
        out.update(latex=r._latex(), text=r._sympystr(), exact=True, num=numeric(r.value, digits))
        return out
    if isinstance(r, sp.Tuple):
        r = list(r)
    if isinstance(r, (list, tuple)):
        out.update(kind="list", latex=r"\left[" + ",\\ ".join(_latex(v) for v in r) + r"\right]", text=str([_text(v) for v in r]), exact=True)
        return out
    if isinstance(r, (bool,)) or r in (sp.true, sp.false):
        out.update(kind="bool", latex=_latex(r), text=str(bool(r)).lower(), exact=True)
        return out
    if isinstance(r, Solutions):
        rr = r
        if mode == "decimal" or any(isinstance(v, sp.Basic) and v.atoms(sp.Float) for v in r.values()):
            rr = r.evalf(digits)
        out.update(kind="solutions", latex=rr._latex(), text=rr._sympystr(), exact=_is_exact(rr),
                   values=[_text(v) for v in r.values()][:50])
        if mode == "exact" and _is_exact(rr) and any(not (v.is_Rational) for v in r.values() if isinstance(v, sp.Expr) and v.is_number):
            ap = r.evalf(digits)
            out["approx_latex"] = ap._latex()
            out["approx_text"] = ap._sympystr()
        return out
    if isinstance(r, Labeled):
        rr = r.evalf(digits) if mode == "decimal" else r
        out.update(kind="labeled", latex=rr._latex(), text=rr._sympystr(), exact=_is_exact(rr))
        return out
    if isinstance(r, sp.MatrixBase):
        rr = r.evalf(digits) if mode == "decimal" else r
        out.update(kind="matrix", latex=_latex(rr), text=_text(rr), exact=_is_exact(rr), rows=rr.rows, cols=rr.cols,
                   cells=[[_text(rr[i, j]) for j in range(rr.cols)] for i in range(rr.rows)] if rr.rows * rr.cols <= 400 else None)
        if mode == "exact" and not all(e.is_Rational for e in r if isinstance(e, sp.Expr)) and all(getattr(e, "is_number", False) for e in r):
            ap = r.evalf(digits)
            out["approx_latex"] = _latex(ap)
        if mode == "fraction":
            fr = r.applyfunc(lambda e: f_tofrac(e) if getattr(e, "is_real", False) and e.is_number else e)
            out["latex"] = _latex(fr)
            out["text"] = _text(fr)
        return out
    if isinstance(r, sp.Set) or isinstance(r, sp.Equality) or isinstance(r, sp.Rel) or isinstance(r, sp.Order):
        out.update(kind="expr", latex=_latex(r), text=_text(r), exact=True)
        return out
    if not isinstance(r, sp.Basic):
        try:
            r = sp.sympify(r)
        except Exception:
            out.update(kind="text", latex=_latex(str(r)), text=str(r), exact=True)
            return out
    if isinstance(r, sp.Basic) and not isinstance(r, sp.Expr):
        out.update(kind="expr", latex=_latex(r), text=_text(r), exact=True)
        return out
    # units
    us = _unit_split(r)
    if us is not None:
        mag, unit = us
        if mode == "decimal" or not _is_exact(mag):
            magv = sp.N(mag, digits)
        else:
            magv = mag
        out.update(kind="quantity", latex=(_latex(magv) + r"\, " + _latex(unit)) if magv != 1 else _latex(unit), text=_text(magv * unit),
                   unit_latex=_latex(unit), unit_text=_text(unit), exact=_is_exact(magv), num=numeric(mag, digits))
        return out
    if r.is_Integer and int(r).bit_length() > HUGE_BITS:
        v = sp.N(r, digits)
        out.update(latex=_latex(v), text=_text(v), exact=False, num=numeric(r, digits), huge=True)
        return out
    exact = _is_exact(r)
    out["exact"] = exact
    out["num"] = numeric(r, digits) if r.is_number else None
    if mode == "decimal" and r.is_number:
        v = sp.N(r, digits)
        out.update(latex=_latex(v), text=_text(v))
    elif mode == "fraction" and r.is_number and r.is_real:
        fr = r if r.is_Rational else f_tofrac(r)
        out.update(latex=_latex(fr), text=_text(fr), approximate=not r.is_Rational)
        if fr.is_Rational and not fr.is_Integer and abs(fr) > 1:
            whole = int(abs(fr.p) // fr.q)
            rest = sp.Rational(abs(fr.p) % fr.q, fr.q)
            sign = "-" if fr < 0 else ""
            out["mixed_latex"] = f"{sign}{whole}\\,\\tfrac{{{rest.p}}}{{{rest.q}}}"
    else:
        text = _text(r)
        out.update(latex=_latex(r), text=text)
        if r.is_number and not r.is_Integer and not (r.is_Rational and mode == "exact" and False):
            out["show_approx"] = not r.is_Float and not (r.is_Integer)
        if r.is_Integer and len(text) > 40:
            out["long"] = True
    if not r.is_number and r.free_symbols and mode != "decimal":
        try:
            if r.atoms(sp.Float) or not r.free_symbols:
                pass
        except Exception:
            pass
    return out


# ------------------------------------------------------------------- eval

_DEF_FUNC = re.compile(r"^\s*([A-Za-zͰ-Ͽ]\w*)\s*\(([^()]*)\)\s*:=\s*(.+)$", re.S)
_DEF_VAR = re.compile(r"^\s*([A-Za-zͰ-Ͽ]\w*)\s*:=\s*(.+)$", re.S)
RESERVED = {"pi", "e", "E", "i", "I", "oo", "ans"}


def _split_arrow(src):
    """'expr ▶ target' / 'expr -> target' at the top level."""
    s = src.replace("→", "▶").replace("⇒", "▶")
    depth = 0
    i = 0
    while i < len(s):
        c = s[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif depth == 0 and (c == "▶" or s.startswith("->", i)):
            w = 1 if c == "▶" else 2
            return s[:i], s[i + w:]
        i += 1
    return s, None


def _check_name(name):
    if name in RESERVED or name.startswith("ans"):
        raise CalcError(f"'{name}' is reserved")
    if name in BASE_NS:
        raise CalcError(f"'{name}' is a built-in function; choose another name")


def evaluate(src, ans_ids=None):
    src = src.strip()
    if not src:
        raise CalcError("Nothing to calculate")
    m = _DEF_FUNC.match(src)
    if m and ":=" in src:
        name, params, body = m.group(1), m.group(2), m.group(3)
        _check_name(name)
        ps = [sp.Symbol(p.strip()) for p in params.split(",") if p.strip()]
        if not ps:
            raise CalcError("A function needs parameters: f(x) := …")
        shadow = {k: sp.Symbol(k) for k in VARS}
        shadow.update({p.name: p for p in ps})
        expr = parse(body, ans_ids, extra=shadow)
        lam = sp.Lambda(tuple(ps), expr)
        FUNCS[name] = lam
        VARS.pop(name, None)
        DEF_SRC[name] = src
        return {"kind": "def", "name": name, "latex": f"{sp.latex(sp.Function(name)(*ps))} := {_latex(expr)}",
                "text": f"{name}({', '.join(p.name for p in ps)}) := {_text(expr)}", "exact": True}, lam
    m = _DEF_VAR.match(src)
    if m and ":=" in src:
        name, body = m.group(1), m.group(2)
        _check_name(name)
        value = _finish(parse(body, ans_ids))
        VARS[name] = value
        FUNCS.pop(name, None)
        DEF_SRC[name] = src
        d = describe(value, int(SETTINGS["digits"]))
        d["kind_value"] = d.get("kind")
        d.update(kind="def", name=name, latex=f"{sp.latex(sp.Symbol(name))} := {d['latex']}", text=f"{name} := {d['text']}")
        return d, value
    left, target = _split_arrow(src)
    if target is not None:
        t = target.strip()
        if re.fullmatch(r"[A-Za-zͰ-Ͽ]\w*", t) and not _is_unit_target(t, left, ans_ids):  # store: expr -> a
            _check_name(t)
            value = _finish(parse(left, ans_ids))
            VARS[t] = value
            FUNCS.pop(t, None)
            DEF_SRC[t] = f"{t} := {left.strip()}"
            d = describe(value, int(SETTINGS["digits"]))
            d.update(kind="def", name=t, latex=f"{d['latex']} \\to {sp.latex(sp.Symbol(t))}", text=f"{t} := {d['text']}")
            return d, value
        value = parse(left, ans_ids)
        tl = t.lstrip("_")
        tl = {"°C": "degC", "°F": "degF", "°R": "degR"}.get(tl, tl)
        if tl in TEMPS and len(value.atoms(Quantity)) == 0 and value.atoms(sp.Symbol):
            syms = [s for s in value.atoms(sp.Symbol) if s.name in ("°C", "°F", "°R")]
            if syms:
                frm = {"°C": "degC", "°F": "degF", "°R": "degR"}[syms[0].name]
                mag = value.subs(syms[0], 1)
                r = convert_value(mag, frm, tl)
                unit_sym = sp.Symbol({"degC": "°C", "degF": "°F", "degR": "°R", "K": "K"}.get(tl, tl))
                d = describe(r, int(SETTINGS["digits"]))
                d["latex"] = d["latex"] + r"\,\mathrm{" + ("K" if tl == "K" else "{}^{\\circ}" + tl[-1]) + "}"
                return d, r * unit_sym
        if tl in ("degC", "degF", "degR") or value.atoms(sp.Symbol) & {sp.Symbol("°C"), sp.Symbol("°F"), sp.Symbol("°R")}:
            if has_units(value):
                kelvin = U.convert_to(value, U.kelvin) / U.kelvin
                r = convert_value(kelvin, "K", tl)
                d = describe(r, int(SETTINGS["digits"]))
                d["latex"] = d["latex"] + r"\,{}^{\circ}\mathrm{" + tl[-1] + "}"
                return d, r
        tv = parse(t if t.startswith("_") or not re.match(r"[A-Za-z]", t) else _underscore_units(t), ans_ids)
        r = convert_units(value, tv)
        return describe(r, int(SETTINGS["digits"])), r
    value = _finish(parse(src, ans_ids))
    return describe(value, int(SETTINGS["digits"])), value


def _is_unit_target(t, left, ans_ids):
    """'x -> km' converts when x has a unit and km is one; otherwise it stores into a variable."""
    if t in TEMPS:
        return True
    try:
        lookup_unit(t)
    except CalcError:
        return False
    try:
        v = parse(left, ans_ids)
    except CalcError:
        return False
    return has_units(v) or bool(v.atoms(sp.Symbol) & {sp.Symbol("°C"), sp.Symbol("°F"), sp.Symbol("°R")}) if isinstance(v, sp.Basic) else False


def _underscore_units(t):
    """'km/h' -> '_km/_h' (conversion targets may skip the underscores)."""
    return re.sub(r"(?<![\w.])([A-Za-zµμΩÅ][A-Za-z0-9µμΩÅ]*)", r"_\1", t)


def _bind_vars(v):
    """Function bodies keep variable names (late binding): put the values in."""
    for _ in range(5):
        if not isinstance(v, sp.Basic) or isinstance(v, (Solutions, Labeled, Factored)):
            return v
        names = {s.name for s in v.free_symbols} & set(VARS)
        if not names:
            return v
        v = v.subs({sp.Symbol(n): VARS[n] for n in names})
    return v


def _finish(v):
    if isinstance(v, _MissingAns):
        v._sympy_()
    v = _bind_vars(v)
    if isinstance(v, (int, float, complex)) and not isinstance(v, bool):
        v = sp.sympify(v)
    if isinstance(v, list):
        v = to_matrix(v)
    if isinstance(v, sp.Basic) and not isinstance(v, (Solutions, Labeled, Factored)):
        if isinstance(v, (sp.Integral, sp.Derivative, sp.Limit, sp.Sum, sp.Product)):
            v = v.doit()
        v = simplify_units(v)
    if isinstance(v, sp.Expr) and v.is_number and not has_units(v):
        if v.atoms(sp.Float) and SETTINGS["number"] != "decimal":
            v = v.evalf(int(SETTINGS["digits"]) + 3)
        if v.has(sp.I) and not v.is_Float:
            try:
                v = sp.expand_complex(v)
            except Exception:
                pass
    if SETTINGS["number"] == "decimal" and isinstance(v, sp.Basic) and not isinstance(v, (Solutions, Labeled, Factored)):
        try:
            if isinstance(v, sp.MatrixBase) or (isinstance(v, sp.Expr) and v.is_number):
                v = v.evalf(int(SETTINGS["digits"]) + 3)
        except Exception:
            pass
    return v


def _store(hid, value):
    if hid is None:
        return
    HIST[hid] = value
    if hid in HIST_ORDER:
        HIST_ORDER.remove(hid)
    HIST_ORDER.append(hid)
    while len(HIST_ORDER) > MAX_HIST:
        HIST.pop(HIST_ORDER.pop(0), None)


# Cheap functions whose value the live preview may compute (the heavy ones stay inert).
PREVIEW_SAFE = ("ln", "log", "log10", "log2", "lg", "sign", "sgn", "arg", "angle", "cbrt", "root", "nthroot", "max", "min",
                "round", "trunc", "ipart", "frac", "fpart", "ceil", "mod", "nCr", "nPr", "comb", "perm", "polar", "cis",
                "lgamma", "erfinv", "lambertw", "W", "gcd", "lcm")


def _tidy(e):
    """Drop the 1·… factors that unevaluated parsing leaves (1/3 -> Mul(1, 1/3))."""
    if not isinstance(e, sp.Basic) or not e.args or isinstance(e, sp.MatrixBase):
        return e
    try:
        args = [_tidy(a) for a in e.args]
        if isinstance(e, sp.Mul):
            keep = [a for a in args if a != 1]
            if not keep:
                return sp.Integer(1)
            if len(keep) == 1:
                return keep[0]
            return sp.Mul(*keep, evaluate=False)
        if args == list(e.args):
            return e
        return e.func(*args, evaluate=False) if isinstance(e, (sp.Add, sp.Pow)) else e.func(*args)
    except Exception:
        return e


def preview(src, ans_ids=None, approx=True):
    """While typing: the input as LaTeX and, when cheap, a numeric value."""
    s = src.strip()
    out = {"latex": "", "approx": None}
    if not s:
        return out
    m = _DEF_FUNC.match(s) or _DEF_VAR.match(s)
    body = s
    head = ""
    if m and ":=" in s:
        if len(m.groups()) == 3:
            head = f"{m.group(1)}\\left({m.group(2)}\\right) := "
            body = m.group(3)
        else:
            head = f"{sp.latex(sp.Symbol(m.group(1)))} := "
            body = m.group(2)
    left, target = _split_arrow(body)
    e = _tidy(parse(left, ans_ids, preview=True))
    tex = head + _latex(e)
    if target is not None:
        t = target.strip()
        try:
            tt = parse(t if t.startswith("_") or not re.match(r"[A-Za-z]", t) else _underscore_units(t), ans_ids, preview=True)
            tex += r" \;\blacktriangleright\; " + _latex(_tidy(tt))
        except CalcError:
            tex += r" \;\blacktriangleright\; \text{" + t.replace("_", "") + "}"
    out["latex"] = tex
    # A cheap numeric value: only numbers with elementary/special functions (heavy ones stay inert
    # in preview mode), with the angle unit, the variables and earlier answers put in.
    if not approx or head or target is not None:
        return out
    try:
        extra = {k: v for k, v in _trig_ns().items() if k != "_DEG_"}
        for name in PREVIEW_SAFE:
            extra[name] = (lambda f: (lambda *a, **kw: f(*a)))(BASE_NS[name])
        extra.update(VARS)
        extra.update(FUNCS)
        ids = ans_ids or []
        for n, hid in enumerate(ids[:50], start=1):
            if hid in HIST:
                extra[f"ans{n}"] = HIST[hid]
        if ids and ids[0] in HIST:
            extra["ans"] = HIST[ids[0]]
        e2 = parse(left, ans_ids, preview=True, extra=extra)
        if isinstance(e2, sp.Expr) and not e2.atoms(sp.Symbol) and not has_units(e2) \
                and not any(isinstance(f, sp.core.function.AppliedUndef) for f in e2.atoms(sp.Function)):
            old = mpmath.mp.dps
            mpmath.mp.dps = 20
            try:
                v = sp.lambdify([], e2, modules=["mpmath"])()
                if isinstance(v, (mpmath.mpf, mpmath.mpc, int, float, complex)):
                    z = mpmath.mpmathify(v)
                    out["approx"] = {"re": _sci(mpmath.re(z), 15), "im": _sci(mpmath.im(z), 15) if mpmath.im(z) != 0 else None}
            finally:
                mpmath.mp.dps = old
    except Exception:
        pass
    return out
    try:
        if not head and target is None and isinstance(e, sp.Expr) and not e.free_symbols - {sp.Symbol("ans")} and not e.atoms(sp.Symbol) \
                and not any(isinstance(f, sp.core.function.AppliedUndef) for f in e.atoms(sp.Function)) \
                and not has_units(e) and not isinstance(e, sp.MatrixBase):
            old = mpmath.mp.dps
            mpmath.mp.dps = 20
            try:
                fn = sp.lambdify([], e, modules=["mpmath"])
                v = fn()
                if isinstance(v, (mpmath.mpf, mpmath.mpc, int, float, complex)):
                    z = mpmath.mpmathify(v)
                    out["approx"] = {"re": _sci(mpmath.re(z), 15), "im": _sci(mpmath.im(z), 15) if mpmath.im(z) != 0 else None}
            finally:
                mpmath.mp.dps = old
    except Exception:
        pass
    return out


# ---------------------------------------------------------------- graphing

def _lambdify(vars_, e):
    import numpy as np  # noqa: F401
    return sp.lambdify(vars_, e, modules=["numpy", "scipy"])


def _clean(arr):
    import numpy as np
    a = np.array(arr)
    if np.iscomplexobj(a):
        ok = np.abs(a.imag) <= 1e-9 * np.maximum(1, np.abs(a.real))
        a = np.where(ok, a.real, np.nan)
    a = np.asarray(a, dtype=float)
    a[~np.isfinite(a)] = np.nan
    return [None if v != v else round(float(v), 12) for v in a]


def _graph_expr(src, names=("x",)):
    syms = {n: sp.Symbol(n) for n in names}
    e = parse(src, None, extra=syms)
    if isinstance(e, sp.Equality):
        return e
    e = _finish(e) if not isinstance(e, sp.Expr) else e
    return e


def sample(items, xmin, xmax, ymin, ymax, n=600):
    import numpy as np
    out = []
    for it in items:
        kind = it.get("kind", "y")
        try:
            if kind == "y":
                e = _graph_expr(it["expr"], ("x",))
                if isinstance(e, sp.Equality):
                    e = e.rhs if e.lhs == sp.Symbol("y") else e.lhs - e.rhs
                xs = np.linspace(xmin, xmax, int(n))
                f = _lambdify([sp.Symbol("x")], e)
                with np.errstate(all="ignore"):
                    ys = f(xs)
                if np.isscalar(ys) or np.ndim(ys) == 0:
                    ys = np.full_like(xs, complex(ys) if np.iscomplexobj(ys) else float(ys), dtype=complex if np.iscomplexobj(ys) else float)
                out.append({"ok": True, "x": _clean(xs), "y": _clean(ys)})
            elif kind in ("param", "polar"):
                tn = "t" if kind == "param" else "theta"
                t0, t1 = float(sp.N(parse(str(it.get("tmin", 0))))), float(sp.N(parse(str(it.get("tmax", "2*pi")))))
                ts = np.linspace(t0, t1, int(n) * 2)
                if kind == "param":
                    ex = _graph_expr(it["expr"], (tn,))
                    ey = _graph_expr(it["expr2"], (tn,))
                    with np.errstate(all="ignore"):
                        X = _lambdify([sp.Symbol(tn)], ex)(ts)
                        Y = _lambdify([sp.Symbol(tn)], ey)(ts)
                else:
                    er = _graph_expr(it["expr"], ("theta", "θ"))
                    er = er.subs(sp.Symbol("θ"), sp.Symbol("theta"))
                    with np.errstate(all="ignore"):
                        R = _lambdify([sp.Symbol("theta")], er)(ts)
                        R = np.broadcast_to(R, ts.shape)
                        X = R * np.cos(ts)
                        Y = R * np.sin(ts)
                X = np.broadcast_to(X, ts.shape)
                Y = np.broadcast_to(Y, ts.shape)
                out.append({"ok": True, "x": _clean(X), "y": _clean(Y)})
            elif kind == "implicit":
                e = _graph_expr(it["expr"], ("x", "y"))
                if isinstance(e, sp.Equality):
                    e = e.lhs - e.rhs
                nx = int(it.get("nx", 160))
                ny = int(it.get("ny", 120))
                xs = np.linspace(xmin, xmax, nx)
                ys = np.linspace(ymin, ymax, ny)
                X, Y = np.meshgrid(xs, ys)
                with np.errstate(all="ignore"):
                    Z = _lambdify([sp.Symbol("x"), sp.Symbol("y")], e)(X, Y)
                Z = np.broadcast_to(Z, X.shape)
                out.append({"ok": True, "nx": nx, "ny": ny, "z": [_clean(row) for row in np.asarray(Z)]})
            elif kind == "ode":
                from scipy.integrate import solve_ivp
                e = _graph_expr(it["expr"], ("x", "y"))
                f = _lambdify([sp.Symbol("x"), sp.Symbol("y")], e)
                x0 = float(sp.N(parse(str(it.get("x0", 0)))))
                y0 = float(sp.N(parse(str(it.get("y0", 1)))))
                pts_x, pts_y = [], []
                for lo, hi in ((x0, xmin), (x0, xmax)):
                    if lo == hi:
                        continue
                    sol = solve_ivp(lambda xx, yy: [float(f(xx, yy[0]))], (lo, hi), [y0], dense_output=True, rtol=1e-8, atol=1e-10,
                                    max_step=abs(hi - lo) / 200)
                    xs = np.linspace(lo, sol.t[-1], int(n) // 2)
                    ys = sol.sol(xs)[0]
                    if hi < lo:
                        xs, ys = xs[::-1], ys[::-1]
                        pts_x = list(xs) + pts_x
                        pts_y = list(ys) + pts_y
                    else:
                        pts_x += list(xs)
                        pts_y += list(ys)
                out.append({"ok": True, "x": _clean(pts_x), "y": _clean(pts_y)})
            else:
                out.append({"ok": False, "error": f"Unknown graph kind {kind}"})
        except CalcError as exc:
            out.append({"ok": False, "error": str(exc)})
        except Exception as exc:
            out.append({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
    return out


def _fn_of_x(src):
    e = _graph_expr(src, ("x",))
    if isinstance(e, sp.Equality):
        e = e.rhs if e.lhs == sp.Symbol("y") else e.lhs - e.rhs
    return e


def analyze(what, expr, xmin, xmax, expr2=None):
    """Roots, extrema, intersections, integral of y=f(x) in [xmin, xmax]."""
    import numpy as np
    from scipy.optimize import brentq
    x = sp.Symbol("x")
    e = _fn_of_x(expr)
    if what == "integral":
        v = _with_dps(lambda: _float_result(mpmath.quad(sp.lambdify(x, e, "mpmath"), [mpmath.mpf(xmin), mpmath.mpf(xmax)])))
        return {"value": float(sp.re(v)), "text": _text(sp.N(v, int(SETTINGS["digits"])))}
    if what == "intersect":
        if not expr2:
            raise CalcError("Pick a second function")
        g = e - _fn_of_x(expr2)
    elif what == "extrema":
        g = sp.diff(e, x)
    else:
        g = e
    fg = _lambdify([x], g)
    fe = _lambdify([x], e)
    xs = np.linspace(xmin, xmax, 4001)
    with np.errstate(all="ignore"):
        ys = np.asarray(fg(xs), dtype=complex) * np.ones_like(xs)
    ys = np.where(np.abs(ys.imag) < 1e-12, ys.real, np.nan).astype(float)
    pts = []

    def real_f(v):
        r = complex(fg(v))
        return r.real
    for k in range(len(xs) - 1):
        a, b = ys[k], ys[k + 1]
        if not (np.isfinite(a) and np.isfinite(b)):
            continue
        if a == 0:
            r = xs[k]
        elif a * b < 0:
            try:
                r = brentq(real_f, xs[k], xs[k + 1], xtol=1e-14, maxiter=200)
            except Exception:
                continue
            # a sign change across a pole is not a root
            if abs(real_f(r)) > 1e-6 * (1 + abs(a) + abs(b)):
                continue
        else:
            continue
        with np.errstate(all="ignore"):
            yv = complex(fe(r)).real
        p = {"x": float(r), "y": float(yv)}
        if what == "extrema":
            d2 = sp.diff(g, x)
            try:
                c = float(sp.N(d2.subs(x, r)))
                p["type"] = "min" if c > 0 else "max" if c < 0 else "inflection"
            except Exception:
                p["type"] = "extremum"
        if not pts or abs(pts[-1]["x"] - p["x"]) > 1e-9 * (1 + abs(p["x"])):
            pts.append(p)
        if len(pts) >= 60:
            break
    return {"points": pts}


def table(exprs, start, step, count):
    import numpy as np
    x = sp.Symbol("x")
    xs = [float(start) + k * float(step) for k in range(int(count))]
    cols = []
    for src in exprs:
        try:
            f = _lambdify([x], _fn_of_x(src))
            with np.errstate(all="ignore"):
                cols.append(_clean(np.asarray(f(np.asarray(xs)), dtype=complex) * np.ones(len(xs))))
        except Exception as exc:
            cols.append({"error": str(exc)})
    return {"x": xs, "cols": cols}


# ------------------------------------------------------------- statistics

def dist(name, fn, x, params):
    import scipy.stats as st
    p = [float(v) for v in params]
    table_ = {
        "normal": lambda: st.norm(p[0] if p else 0, p[1] if len(p) > 1 else 1),
        "t": lambda: st.t(p[0]),
        "chi2": lambda: st.chi2(p[0]),
        "f": lambda: st.f(p[0], p[1]),
        "exponential": lambda: st.expon(scale=1 / p[0]),
        "uniform": lambda: st.uniform(p[0], p[1] - p[0]),
        "gamma": lambda: st.gamma(p[0], scale=p[1] if len(p) > 1 else 1),
        "beta": lambda: st.beta(p[0], p[1]),
        "lognormal": lambda: st.lognorm(p[1], scale=math.exp(p[0])),
        "weibull": lambda: st.weibull_min(p[0], scale=p[1] if len(p) > 1 else 1),
        "cauchy": lambda: st.cauchy(p[0] if p else 0, p[1] if len(p) > 1 else 1),
        "binomial": lambda: st.binom(int(p[0]), p[1]),
        "poisson": lambda: st.poisson(p[0]),
        "geometric": lambda: st.geom(p[0]),
        "hypergeometric": lambda: st.hypergeom(int(p[0]), int(p[1]), int(p[2])),
        "negbinomial": lambda: st.nbinom(p[0], p[1]),
    }
    if name not in table_:
        raise CalcError(f"Unknown distribution {name}")
    d = table_[name]()
    discrete = name in ("binomial", "poisson", "geometric", "hypergeometric", "negbinomial")
    xv = float(x)
    if fn == "pdf":
        v = d.pmf(xv) if discrete else d.pdf(xv)
    elif fn == "cdf":
        v = d.cdf(xv)
    elif fn == "sf":
        v = d.sf(xv)
    elif fn == "inv":
        v = d.ppf(xv)
    else:
        raise CalcError(f"Unknown function {fn}")
    stats = {}
    try:
        m, var_ = d.stats(moments="mv")
        stats = {"mean": float(m), "var": float(var_)}
    except Exception:
        pass
    # a curve for the plot
    lo, hi = d.ppf(0.0005), d.ppf(0.9995)
    if not math.isfinite(lo):
        lo = -10
    if not math.isfinite(hi):
        hi = 10
    if discrete:
        ks = list(range(int(math.floor(lo)), int(math.ceil(hi)) + 1))[:400]
        curve = {"x": ks, "y": [float(d.pmf(k)) for k in ks], "discrete": True}
    else:
        import numpy as np
        xs = np.linspace(lo, hi, 300)
        curve = {"x": [float(v) for v in xs], "y": _clean(d.pdf(xs)), "discrete": False}
    return {"value": float(v), **stats, "curve": curve}


def hypothesis(kind, data, opts):
    import numpy as np
    import scipy.stats as st
    alt = opts.get("alternative", "two-sided")
    mu0 = float(opts.get("mu0", 0))
    a = np.asarray([float(v) for v in data.get("a", []) if v is not None], dtype=float)
    b = np.asarray([float(v) for v in data.get("b", []) if v is not None], dtype=float)
    res = {}
    if kind == "t1":
        r = st.ttest_1samp(a, mu0, alternative=alt)
        ci = r.confidence_interval(float(opts.get("level", 0.95)))
        res = {"statistic": float(r.statistic), "df": float(r.df), "p": float(r.pvalue), "ci": [float(ci.low), float(ci.high)],
               "mean": float(a.mean()), "sd": float(a.std(ddof=1)), "n": int(a.size)}
    elif kind == "t2":
        eqv = bool(opts.get("pooled", False))
        r = st.ttest_ind(a, b, equal_var=eqv, alternative=alt)
        res = {"statistic": float(r.statistic), "df": float(getattr(r, "df", float("nan"))), "p": float(r.pvalue),
               "mean_a": float(a.mean()), "mean_b": float(b.mean())}
        try:
            ci = r.confidence_interval(float(opts.get("level", 0.95)))
            res["ci"] = [float(ci.low), float(ci.high)]
        except Exception:
            pass
    elif kind == "paired":
        r = st.ttest_rel(a, b, alternative=alt)
        res = {"statistic": float(r.statistic), "df": float(r.df), "p": float(r.pvalue), "mean_diff": float((a - b).mean())}
    elif kind == "z1":
        sigma = float(opts.get("sigma", 1))
        z = (a.mean() - mu0) / (sigma / math.sqrt(a.size))
        p = 2 * st.norm.sf(abs(z)) if alt == "two-sided" else st.norm.sf(z) if alt == "greater" else st.norm.cdf(z)
        lvl = float(opts.get("level", 0.95))
        h = st.norm.ppf(0.5 + lvl / 2) * sigma / math.sqrt(a.size)
        res = {"statistic": float(z), "p": float(p), "mean": float(a.mean()), "n": int(a.size), "ci": [float(a.mean() - h), float(a.mean() + h)]}
    elif kind == "prop1":
        xk, n, p0 = float(opts.get("successes", 0)), float(opts.get("n", 1)), float(opts.get("p0", 0.5))
        ph = xk / n
        z = (ph - p0) / math.sqrt(p0 * (1 - p0) / n)
        p = 2 * st.norm.sf(abs(z)) if alt == "two-sided" else st.norm.sf(z) if alt == "greater" else st.norm.cdf(z)
        res = {"statistic": float(z), "p": float(p), "phat": ph}
    elif kind == "chi2gof":
        exp_ = b if b.size else None
        r = st.chisquare(a, exp_ * a.sum() / exp_.sum() if exp_ is not None else None)
        res = {"statistic": float(r.statistic), "df": int(a.size - 1), "p": float(r.pvalue)}
    elif kind == "chi2ind":
        cols = [np.asarray([float(v) for v in c if v is not None]) for c in data.get("table", [])]
        m = np.vstack(cols).T
        chi2, p, dof, expected = st.chi2_contingency(m)
        res = {"statistic": float(chi2), "df": int(dof), "p": float(p)}
    elif kind == "anova":
        groups = [np.asarray([float(v) for v in c if v is not None]) for c in data.get("table", [])]
        r = st.f_oneway(*groups)
        res = {"statistic": float(r.statistic), "p": float(r.pvalue), "df": [len(groups) - 1, int(sum(g.size for g in groups) - len(groups))]}
    elif kind == "linreg":
        r = st.linregress(a, b, alternative=alt)
        res = {"statistic": float(r.slope / r.stderr) if r.stderr else float("nan"), "p": float(r.pvalue), "slope": float(r.slope),
               "intercept": float(r.intercept), "r": float(r.rvalue), "df": int(a.size - 2), "stderr": float(r.stderr)}
    elif kind == "normality":
        r = st.shapiro(a)
        res = {"statistic": float(r.statistic), "p": float(r.pvalue)}
    else:
        raise CalcError(f"Unknown test {kind}")
    return {k: (None if isinstance(v, float) and not math.isfinite(v) else v) for k, v in res.items()}


def fill(expr, var=None, start=None, stop=None, step=1):
    """A list from a formula of the other lists (row by row), or a sequence in var."""
    used = [n for n in LISTS if re.search(rf"\b{n}\b", expr)]
    syms = {n: sp.Symbol(n) for n in used}
    extra = dict(syms)
    ks = []
    if var:
        extra[var] = sp.Symbol(var)
        if step == 0:
            raise CalcError("The step cannot be 0")
        count = int(math.floor((float(stop) - float(start)) / float(step) + 1e-9)) + 1
        if count > 10000:
            raise CalcError("At most 10,000 values")
        ks = [sp.nsimplify(start) + i * sp.nsimplify(step) for i in range(max(0, count))]
    e = _bind_vars(parse(expr, None, extra=extra))
    rows = max([len(LISTS[n]) for n in used], default=0) if used else len(ks)
    if var and used:
        rows = min(rows, len(ks)) if ks else rows
    out = []
    for i in range(rows):
        sub = {syms[n]: (LISTS[n][i] if i < len(LISTS[n]) else sp.nan) for n in used}
        if var:
            sub[sp.Symbol(var)] = ks[i]
        try:
            f = float(sp.N(e.subs(sub)))
            out.append(f if math.isfinite(f) else None)
        except Exception:
            out.append(None)
    return out


# ------------------------------------------------------------------ session

def variables():
    out = []
    for k, v in VARS.items():
        try:
            tex = _latex(v)
        except Exception:
            tex = _text(v)
        out.append({"name": k, "kind": "var", "latex": f"{sp.latex(sp.Symbol(k))} = {tex}", "text": f"{k} = {_text(v)}", "src": DEF_SRC.get(k)})
    for k, f in FUNCS.items():
        args = f.args[0] if isinstance(f.args[0], tuple) else (f.args[0],)
        try:
            ps = tuple(f.variables)
        except Exception:
            ps = args
        out.append({"name": k, "kind": "func", "latex": f"{sp.latex(sp.Function(k)(*ps))} = {_latex(f.expr)}",
                    "text": f"{k}({', '.join(map(str, ps))}) = {_text(f.expr)}", "src": DEF_SRC.get(k)})
    out.sort(key=lambda d: d["name"].lower())
    return out


def set_settings(s):
    if not s:
        return
    for k in ("number", "angle", "complex"):
        if k in s and s[k]:
            SETTINGS[k] = str(s[k])
    if "digits" in s and s["digits"]:
        SETTINGS["digits"] = max(1, min(1000, int(s["digits"])))


def _restore_value(text):
    try:
        ns = {}
        ns.update({k: getattr(sp, k) for k in dir(sp) if not k.startswith("_")})
        ns.update(UNITS)
        return eval(text, ns)
    except Exception:
        return None


# ------------------------------------------------------------------ dispatch

def dispatch(req):
    op = req.get("op")
    set_settings(req.get("settings"))
    try:
        if op == "init":
            return {"ok": True, "version": VERSION, "sympy": sp.__version__, "mpmath": mpmath.__version__, "functions": function_names()}
        if op == "eval":
            payload, value = evaluate(req.get("src", ""), req.get("ans"))
            _store(req.get("id"), value)
            payload["ok"] = True
            try:
                payload["input_latex"] = preview(req.get("src", ""), req.get("ans"), approx=False)["latex"]
            except Exception:
                payload["input_latex"] = None
            try:
                payload["srepr"] = sp.srepr(value) if isinstance(value, sp.Basic) and not isinstance(value, (Solutions, Labeled, Factored)) else None
                if payload["srepr"] and len(payload["srepr"]) > 200000:
                    payload["srepr"] = None
            except Exception:
                payload["srepr"] = None
            if payload.get("kind") == "def":
                payload["vars"] = variables()
            return payload
        if op == "preview":
            r = preview(req.get("src", ""), req.get("ans"))
            r["ok"] = True
            return r
        if op == "vars":
            return {"ok": True, "vars": variables()}
        if op == "delvar":
            name = req.get("name")
            VARS.pop(name, None)
            FUNCS.pop(name, None)
            DEF_SRC.pop(name, None)
            return {"ok": True, "vars": variables()}
        if op == "clearvars":
            VARS.clear()
            FUNCS.clear()
            DEF_SRC.clear()
            return {"ok": True, "vars": []}
        if op == "forget":
            for hid in req.get("ids", []):
                HIST.pop(hid, None)
                if hid in HIST_ORDER:
                    HIST_ORDER.remove(hid)
            return {"ok": True}
        if op == "restore":
            errors = []
            for src in req.get("defs", []):
                try:
                    evaluate(src)
                except Exception as exc:
                    errors.append(f"{src}: {exc}")
            for item in req.get("results", []):
                v = _restore_value(item.get("srepr") or "")
                if v is not None:
                    _store(item.get("id"), v)
            LISTS.clear()
            for k, vals in (req.get("lists") or {}).items():
                LISTS[k] = sp.Matrix([sp.nsimplify(v) if isinstance(v, int) else sp.Float(v, 15) for v in vals if v is not None]) if vals else sp.Matrix([])
            return {"ok": True, "errors": errors, "vars": variables()}
        if op == "lists":
            LISTS.clear()
            for k, vals in (req.get("lists") or {}).items():
                clean = [v for v in vals if v is not None]
                LISTS[k] = sp.Matrix([sp.Integer(v) if float(v).is_integer() and abs(v) < 1e15 else sp.Float(v, 15) for v in clean]) if clean else sp.Matrix([])
            return {"ok": True}
        if op == "fill":
            return {"ok": True, "values": fill(req["expr"], req.get("var"), req.get("start"), req.get("stop"), req.get("step", 1))}
        if op == "sample":
            return {"ok": True, "series": sample(req["items"], float(req["xmin"]), float(req["xmax"]), float(req.get("ymin", -10)),
                                                  float(req.get("ymax", 10)), int(req.get("n", 600)))}
        if op == "analyze":
            r = analyze(req["what"], req["expr"], float(req["xmin"]), float(req["xmax"]), req.get("expr2"))
            r["ok"] = True
            return r
        if op == "table":
            r = table(req["exprs"], req.get("start", 0), req.get("step", 1), req.get("count", 20))
            r["ok"] = True
            return r
        if op == "convert":
            v = parse(str(req.get("value", "1")))
            r = convert_value(v, req["from"], req["to"])
            d = describe(r, int(SETTINGS["digits"]))
            d["ok"] = True
            return d
        if op == "units":
            return {"ok": True, "units": unit_catalog(), "prefixes": list(PREFIXES), "prefixable": list(PREFIXABLE)}
        if op == "constants":
            return {"ok": True, "constants": constants_list()}
        if op == "dist":
            r = dist(req["name"], req["fn"], req["x"], req.get("params", []))
            r["ok"] = True
            return r
        if op == "test":
            r = hypothesis(req["kind"], req.get("data", {}), req.get("opts", {}))
            r["ok"] = True
            return r
        return {"ok": False, "error": f"Unknown request {op}"}
    except CalcError as exc:
        return {"ok": False, "error": str(exc)}
    except RecursionError:
        return {"ok": False, "error": "Too deeply nested"}
    except ZeroDivisionError:
        return {"ok": False, "error": "Division by zero"}
    except Exception as exc:  # SymPy's own errors: keep the message short
        msg = str(exc).strip().split("\n")[0][:400]
        return {"ok": False, "error": f"{type(exc).__name__}: {msg}" if msg else type(exc).__name__}


def call(b64):
    req = json.loads(base64.b64decode(b64).decode("utf-8"))
    res = dispatch(req)
    return base64.b64encode(json.dumps(res, default=_json_default, allow_nan=False).encode("utf-8")).decode("ascii")


def emit(b64):
    """call() for the KherveOS bridge: the answer goes to stdout between markers (cell results are cut at 20,000 characters)."""
    out = call(b64)
    sys.stdout.write("\x1eKC>" + out + "<KC\x1e\n")
    sys.stdout.flush()


def _json_default(o):
    if isinstance(o, sp.Basic):
        return str(o)
    if isinstance(o, set):
        return sorted(o)
    return str(o)


if __name__ == "__main__":  # quick manual check
    for line in sys.argv[1:]:
        print(json.dumps(dispatch({"op": "eval", "src": line}), indent=1, default=_json_default))
