"""Curve fitting without Qt: the trendline models KherveSheet's charts use
(scipy's curve_fit), their goodness of fit, and the fitted curve, for the
desktop Trendline dialog and for KherveCELL's charts in the browser.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import warnings
from typing import Dict

import numpy as np

# ── Fit model definitions ───────────────────────────────────────────
#
# Each model is a dict with:
#   "func"    : callable(x, *params) → y
#   "p0"      : default initial guesses  (or callable(x,y) → list)
#   "eq"      : format string for the equation display
#   "params"  : list of parameter names
#   "extra"   : optional extra widget key (e.g. "order" for polynomial)

def _safe_exp(x):
    return np.exp(np.clip(x, -500, 500))


def _model_linear(x, a, b):
    return a * x + b

def _model_quadratic(x, a, b, c):
    return a * x**2 + b * x + c

def _model_cubic(x, a, b, c, d):
    return a * x**3 + b * x**2 + c * x + d

def _model_exponential(x, a, b):
    return a * _safe_exp(b * x)

def _model_exp_decay(x, a, b, c):
    return a * _safe_exp(-b * x) + c

def _model_logarithmic(x, a, b):
    return a * np.log(np.maximum(x, 1e-300)) + b

def _model_power(x, a, b):
    return a * np.power(np.maximum(x, 1e-300), b)

def _model_sqrt(x, a, b):
    return a * np.sqrt(np.maximum(x, 0)) + b

def _model_inverse(x, a, b):
    return a / np.maximum(np.abs(x), 1e-300) + b

def _model_logistic(x, L, k, x0, b):
    return L / (1 + _safe_exp(-k * (x - x0))) + b

def _model_gaussian(x, a, mu, sigma):
    return a * np.exp(-0.5 * ((x - mu) / np.maximum(np.abs(sigma), 1e-300))**2)

def _model_lorentzian(x, a, x0, gamma):
    return a * gamma**2 / ((x - x0)**2 + gamma**2)

def _model_sine(x, a, omega, phi, c):
    return a * np.sin(omega * x + phi) + c

def _model_hill(x, vmax, kd, n):
    xp = np.maximum(x, 0)
    return vmax * xp**n / (kd**n + xp**n + 1e-300)

def _model_michaelis_menten(x, vmax, km):
    return vmax * x / (km + x + 1e-300)

def _model_boltzmann(x, a1, a2, x0, dx):
    return (a1 - a2) / (1 + _safe_exp((x - x0) / np.maximum(np.abs(dx), 1e-300))) + a2

def _model_double_exp(x, a1, t1, a2, t2, c):
    return a1 * _safe_exp(-x / np.maximum(np.abs(t1), 1e-300)) + \
           a2 * _safe_exp(-x / np.maximum(np.abs(t2), 1e-300)) + c

def _model_stretched_exp(x, a, tau, beta, c):
    return a * np.exp(-(np.maximum(x, 0) / np.maximum(np.abs(tau), 1e-300))**np.clip(beta, 0.01, 10)) + c

def _model_allometric(x, a, b, c):
    return a * np.power(np.maximum(x, 1e-300), b) + c

def _model_reciprocal_quadratic(x, a, b, c):
    denom = a * x**2 + b * x + c
    return 1.0 / np.where(np.abs(denom) < 1e-300, 1e-300, denom)

def _model_hyperbolic(x, a, b):
    return a * x / (b + x + 1e-300)

def _model_error_function(x, a, b, c, d):
    from scipy.special import erf
    return a * erf(b * (x - c)) + d


def _p0_auto(x, y):
    """Fallback initial guess: amplitude ~ range, offset ~ mean."""
    return [np.nanmax(y) - np.nanmin(y), 1.0, np.nanmean(x), np.nanmean(y)]


MODELS: Dict[str, dict] = {
    "Linear": {
        "func": _model_linear,
        "params": ["a", "b"],
        "eq": "y = {a:.6g}·x + {b:.6g}",
    },
    "Quadratic": {
        "func": _model_quadratic,
        "params": ["a", "b", "c"],
        "eq": "y = {a:.6g}·x² + {b:.6g}·x + {c:.6g}",
    },
    "Cubic": {
        "func": _model_cubic,
        "params": ["a", "b", "c", "d"],
        "eq": "y = {a:.6g}·x³ + {b:.6g}·x² + {c:.6g}·x + {d:.6g}",
    },
    "Polynomial": {
        "func": None,  # built dynamically based on order
        "params": [],
        "eq": "",
        "extra": "order",
    },
    "Exponential": {
        "func": _model_exponential,
        "params": ["a", "b"],
        "eq": "y = {a:.6g}·exp({b:.6g}·x)",
    },
    "Exponential Decay": {
        "func": _model_exp_decay,
        "params": ["a", "b", "c"],
        "eq": "y = {a:.6g}·exp(−{b:.6g}·x) + {c:.6g}",
    },
    "Double Exponential": {
        "func": _model_double_exp,
        "params": ["a1", "t1", "a2", "t2", "c"],
        "eq": "y = {a1:.6g}·exp(−x/{t1:.6g}) + {a2:.6g}·exp(−x/{t2:.6g}) + {c:.6g}",
    },
    "Stretched Exponential": {
        "func": _model_stretched_exp,
        "params": ["a", "tau", "beta", "c"],
        "eq": "y = {a:.6g}·exp(−(x/{tau:.6g})^{beta:.6g}) + {c:.6g}",
    },
    "Logarithmic": {
        "func": _model_logarithmic,
        "params": ["a", "b"],
        "eq": "y = {a:.6g}·ln(x) + {b:.6g}",
    },
    "Power": {
        "func": _model_power,
        "params": ["a", "b"],
        "eq": "y = {a:.6g}·x^{b:.6g}",
    },
    "Allometric (Power + c)": {
        "func": _model_allometric,
        "params": ["a", "b", "c"],
        "eq": "y = {a:.6g}·x^{b:.6g} + {c:.6g}",
    },
    "Square Root": {
        "func": _model_sqrt,
        "params": ["a", "b"],
        "eq": "y = {a:.6g}·√x + {b:.6g}",
    },
    "Inverse (1/x)": {
        "func": _model_inverse,
        "params": ["a", "b"],
        "eq": "y = {a:.6g}/x + {b:.6g}",
    },
    "Hyperbolic (ax/(b+x))": {
        "func": _model_hyperbolic,
        "params": ["a", "b"],
        "eq": "y = {a:.6g}·x / ({b:.6g} + x)",
    },
    "Reciprocal Quadratic": {
        "func": _model_reciprocal_quadratic,
        "params": ["a", "b", "c"],
        "eq": "y = 1 / ({a:.6g}·x² + {b:.6g}·x + {c:.6g})",
    },
    "Logistic (Sigmoid)": {
        "func": _model_logistic,
        "params": ["L", "k", "x0", "b"],
        "eq": "y = {L:.6g} / (1 + exp(−{k:.6g}·(x−{x0:.6g}))) + {b:.6g}",
    },
    "Boltzmann Sigmoid": {
        "func": _model_boltzmann,
        "params": ["a1", "a2", "x0", "dx"],
        "eq": "y = ({a1:.6g}−{a2:.6g}) / (1+exp((x−{x0:.6g})/{dx:.6g})) + {a2:.6g}",
    },
    "Gaussian": {
        "func": _model_gaussian,
        "params": ["a", "mu", "sigma"],
        "eq": "y = {a:.6g}·exp(−0.5·((x−{mu:.6g})/{sigma:.6g})²)",
    },
    "Lorentzian": {
        "func": _model_lorentzian,
        "params": ["a", "x0", "gamma"],
        "eq": "y = {a:.6g}·γ² / ((x−{x0:.6g})² + {gamma:.6g}²)",
    },
    "Sine Wave": {
        "func": _model_sine,
        "params": ["a", "omega", "phi", "c"],
        "eq": "y = {a:.6g}·sin({omega:.6g}·x + {phi:.6g}) + {c:.6g}",
    },
    "Hill Equation": {
        "func": _model_hill,
        "params": ["Vmax", "Kd", "n"],
        "eq": "y = {Vmax:.6g}·x^{n:.6g} / ({Kd:.6g}^{n:.6g} + x^{n:.6g})",
    },
    "Michaelis-Menten": {
        "func": _model_michaelis_menten,
        "params": ["Vmax", "Km"],
        "eq": "y = {Vmax:.6g}·x / ({Km:.6g} + x)",
    },
    "Error Function (erf)": {
        "func": _model_error_function,
        "params": ["a", "b", "c", "d"],
        "eq": "y = {a:.6g}·erf({b:.6g}·(x−{c:.6g})) + {d:.6g}",
    },
}

# Moving average is separate (not curve_fit)
MOVING_AVERAGE_KEY = "Moving Average"


# ── Goodness-of-fit helpers ─────────────────────────────────────────

def _compute_gof(y_data, y_fit, n_params):
    """Return dict of goodness-of-fit statistics."""
    residuals = y_data - y_fit
    ss_res = np.sum(residuals**2)
    ss_tot = np.sum((y_data - np.mean(y_data))**2)
    n = len(y_data)
    r_squared = 1 - ss_res / ss_tot if ss_tot > 0 else np.nan
    adj_r2 = (1 - (1 - r_squared) * (n - 1) / (n - n_params - 1)
              if n > n_params + 1 else np.nan)
    rmse = np.sqrt(ss_res / n) if n > 0 else np.nan
    chi2_red = ss_res / (n - n_params) if n > n_params else np.nan
    aic = n * np.log(ss_res / n) + 2 * n_params if n > 0 and ss_res > 0 else np.nan
    bic = (n * np.log(ss_res / n) + n_params * np.log(n)
           if n > 0 and ss_res > 0 else np.nan)
    return {
        "R²": r_squared,
        "Adjusted R²": adj_r2,
        "RMSE": rmse,
        "Reduced χ²": chi2_red,
        "AIC": aic,
        "BIC": bic,
        "SS_res": ss_res,
        "SS_tot": ss_tot,
    }


def _build_poly_func(order):
    """Return (func, params, eq_template) for a polynomial of given order."""
    param_names = [f"a{i}" for i in range(order + 1)]

    def poly(x, *coeffs):
        return np.polyval(coeffs, x)

    terms = []
    for i in range(order + 1):
        exp = order - i
        if exp == 0:
            terms.append("{" + f"a{i}" + ":.6g}")
        elif exp == 1:
            terms.append("{" + f"a{i}" + ":.6g}·x")
        else:
            terms.append("{" + f"a{i}" + f":.6g}}·x^{exp}")
    eq = "y = " + " + ".join(terms)
    return poly, param_names, eq


def _smart_p0(model_name, x, y):
    """Heuristic initial guesses per model."""
    amp = np.nanmax(y) - np.nanmin(y)
    mn_y = np.nanmean(y)
    mn_x = np.nanmean(x)
    std_x = np.nanstd(x) or 1.0
    std_y = np.nanstd(y) or 1.0

    p0_map = {
        "Linear": [std_y / std_x, mn_y],
        "Quadratic": [0.0, std_y / std_x, mn_y],
        "Cubic": [0.0, 0.0, std_y / std_x, mn_y],
        "Exponential": [mn_y or 1.0, 0.01],
        "Exponential Decay": [amp, 1.0 / std_x, np.nanmin(y)],
        "Double Exponential": [amp / 2, std_x, amp / 2, std_x * 2, np.nanmin(y)],
        "Stretched Exponential": [amp, std_x, 1.0, np.nanmin(y)],
        "Logarithmic": [std_y, mn_y],
        "Power": [1.0, 1.0],
        "Allometric (Power + c)": [1.0, 1.0, 0.0],
        "Square Root": [std_y, mn_y],
        "Inverse (1/x)": [std_y * mn_x, mn_y],
        "Hyperbolic (ax/(b+x))": [np.nanmax(y) or 1.0, mn_x or 1.0],
        "Reciprocal Quadratic": [1.0, 0.0, 1.0],
        "Logistic (Sigmoid)": [amp, 1.0 / std_x, mn_x, np.nanmin(y)],
        "Boltzmann Sigmoid": [np.nanmax(y), np.nanmin(y), mn_x, std_x],
        "Gaussian": [amp, mn_x, std_x],
        "Lorentzian": [amp, mn_x, std_x],
        "Sine Wave": [amp / 2, 2 * np.pi / (std_x * 4), 0, mn_y],
        "Hill Equation": [np.nanmax(y) or 1.0, mn_x or 1.0, 1.0],
        "Michaelis-Menten": [np.nanmax(y) or 1.0, mn_x or 1.0],
        "Error Function (erf)": [amp / 2, 1.0 / std_x, mn_x, mn_y],
    }
    return p0_map.get(model_name, [1.0] * len(MODELS.get(model_name, {}).get("params", [])))


def _tidy(equation: str) -> str:
    """"+ -0.5" → "− 0.5", "−-0.5" → "+ 0.5" in a formatted equation."""
    return (equation.replace("+ -", "− ").replace("−-", "+")
            .replace("·x^1 ", "·x "))


def fit_series(x, y, model_name: str, poly_order: int = 4,
               ma_period: int = 2) -> dict:
    """Fit one model to (x, y) and report the result.

    Free of Qt and of the chart, so the same fit can be run from the
    Trendline dialog, a script, or the AI / MCP tool layer.  Returns a
    dict with *params*, *errors*, *gof*, *equation* and a callable
    *predict*; on failure the dict carries only *error*.
    """
    from scipy.optimize import curve_fit

    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    mask = np.isfinite(x) & np.isfinite(y)
    x, y = x[mask], y[mask]
    if len(x) < 2:
        return {"error": "Not enough data points (need at least 2)."}

    # Tool callers write "polynomial" or "linear"; match case-blind.
    known = [MOVING_AVERAGE_KEY, "Polynomial", *MODELS]
    model_name = next((k for k in known
                       if k.lower() == str(model_name).lower()), model_name)

    if model_name == MOVING_AVERAGE_KEY:
        if ma_period > len(y):
            return {"error": f"Period {ma_period} is larger than the "
                             f"data length ({len(y)})."}
        kernel = np.ones(ma_period) / ma_period
        y_ma = np.convolve(y, kernel, mode="valid")
        x_ma = x[ma_period - 1:]
        y_fit = np.interp(x, x_ma, y_ma)
        return {"model": model_name, "params": {"period": ma_period},
                "errors": {}, "gof": _compute_gof(y, y_fit, ma_period),
                "equation": f"Moving Average (period={ma_period})",
                "predict": lambda xs: np.interp(xs, x_ma, y_ma)}

    if model_name == "Polynomial":
        if poly_order >= len(x):
            return {"error": f"Polynomial order {poly_order} needs at "
                             f"least {poly_order + 1} points "
                             f"(have {len(x)})."}
        coeffs = np.polyfit(x, y, poly_order)
        _, names, eq_template = _build_poly_func(poly_order)
        params = dict(zip(names, (float(c) for c in coeffs)))
        return {"model": f"Polynomial (order {poly_order})",
                "params": params, "errors": {},
                "gof": _compute_gof(y, np.polyval(coeffs, x),
                                    poly_order + 1),
                "equation": _tidy(eq_template.format(**params)),
                "predict": lambda xs: np.polyval(coeffs, xs)}

    model = MODELS.get(model_name)
    if model is None:
        return {"error": f"Unknown model {model_name!r}."}
    func = model["func"]
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            popt, pcov = curve_fit(
                func, x, y, p0=_smart_p0(model_name, x, y), maxfev=50000)
        perr = np.sqrt(np.diag(pcov))
    except Exception as exc:
        return {"error": f"Fit failed for {model_name}: {exc}"}

    names = model["params"]
    params = dict(zip(names, (float(v) for v in popt)))
    return {"model": model_name, "params": params,
            "errors": dict(zip(names, (float(e) for e in perr))),
            "gof": _compute_gof(y, func(x, *popt), len(popt)),
            "equation": _tidy(model["eq"].format(**params)),
            "predict": lambda xs: func(xs, *popt)}


# ── Trendline data class ────────────────────────────────────────────

class TrendlineInfo:
    """Stores everything needed to recreate a trendline.

    Trendlines are added as regular chart series (flagged with
    ``is_trendline=True``) so they appear in Plot Details and can
    be removed from there.
    """

    def __init__(self):
        self.series_idx: int = 0       # source series being fitted
        self.model_name: str = "Linear"
        self.poly_order: int = 4
        self.ma_period: int = 2
        self.params: dict = {}         # fitted parameter values
        self.equation: str = ""
        self.gof: dict = {}
        self.eq_artist = None          # text annotation on chart
        self.r2_artist = None          # text annotation on chart
        self.show_equation: bool = False
        self.show_r_squared: bool = False
        self.color: str = "#ff0000"
        self.linestyle: str = "--"
        self.linewidth: float = 1.5
        self.fit_series_idx: int = -1  # index in chart._series

    def to_dict(self):
        d = {
            "series_idx": self.series_idx,
            "model_name": self.model_name,
            "params": self.params,
            "equation": self.equation,
            "gof": {k: (v if np.isfinite(v) else None)
                    for k, v in self.gof.items()},
            "show_equation": self.show_equation,
            "show_r_squared": self.show_r_squared,
            "color": self.color,
            "linestyle": self.linestyle,
            "linewidth": self.linewidth,
        }
        if self.model_name == "Polynomial":
            d["poly_order"] = self.poly_order
        if self.model_name == MOVING_AVERAGE_KEY:
            d["ma_period"] = self.ma_period
        return d

    @classmethod
    def from_dict(cls, d):
        t = cls()
        t.series_idx = d.get("series_idx", 0)
        t.model_name = d.get("model_name", "Linear")
        t.poly_order = d.get("poly_order", 4)
        t.ma_period = d.get("ma_period", 2)
        t.params = d.get("params", {})
        t.equation = d.get("equation", "")
        t.gof = {k: (v if v is not None else np.nan)
                 for k, v in d.get("gof", {}).items()}
        t.show_equation = d.get("show_equation", False)
        t.show_r_squared = d.get("show_r_squared", False)
        t.color = d.get("color", "#ff0000")
        t.linestyle = d.get("linestyle", "--")
        t.linewidth = d.get("linewidth", 1.5)
        return t
