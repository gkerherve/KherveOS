# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/Raman_Assign.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/Raman_Assign.py
"""
Raman peak assignment.

Like the FTIR assigner, this returns a *ranked list of candidates* for every
peak rather than one confident-looking answer: most Raman shifts are
compatible with several phases (anatase Eg at 144 sits on the V2O5 layer mode
at 145; a disulfide S-S stretch sits on the silicon 520.7 line), and several
of the sharp features in a real spectrum belong to the substrate, the air or
a cosmic-ray strike, not the sample.

Sample metadata (material type, expected elements, substrate, whether the
measurement is in air) down-weights implausible candidates without deleting
them, and "Unassigned" / "Possible artifact" are allowed to win outright.
"""

import re

from libraries.ToolsMenu.Raman_Library import RAMAN_BANDS

DEFAULT_SOURCE = ("Raman correlation tables (Ferraro & Nakamoto; Socrates; "
                  "RRUFF; Ferrari & Robertson for carbon)")

UNASSIGNED = "Unassigned"
ARTIFACT = "Possible artifact"


# ---------------------------------------------------------------------------
# Metadata vocabularies (also used to build the UI choices)
# ---------------------------------------------------------------------------

MATERIAL_TYPES = ("Unknown", "Organic molecule", "Polymer",
                  "Carbon material", "Semiconductor",
                  "Metal oxide / ceramic", "Mineral", "Inorganic salt",
                  "Biological", "Thin film", "Catalyst / supported metal")

SUBSTRATES = ("Unknown", "None / bulk", "Si wafer", "Glass", "Quartz",
              "Metal", "Al2O3 / sapphire")

DEFAULT_EXCITATIONS = ("532", "633", "785", "473", "514", "1064")


def default_metadata():
    return {
        'material_type': "Unknown",
        'elements': "",
        'substrate': "Unknown",
        'excitation_nm': "532",
        'in_air': True,
        'notes': "",
    }


# ---------------------------------------------------------------------------
# Artefact regions
# ---------------------------------------------------------------------------
# (low, high, risk 0-1, description)
ARTIFACT_REGIONS = (
    (0, 120, 0.80, "Rayleigh wing / notch-filter cut-off"),
    (2320, 2340, 0.60, "Atmospheric N2 (2331)"),
    (1548, 1562, 0.45, "Atmospheric O2 (1555)"),
)

SUBSTRATE_BANDS = {
    "Si wafer": ((505, 535, 0.85, "Si substrate TO phonon (520.7)"),
                 (290, 315, 0.45, "Si substrate 2TA (~302)"),
                 (930, 990, 0.40, "Si substrate 2TO")),
    "Glass": ((1030, 1120, 0.60, "Glass Si-O background"),
              (530, 590, 0.50, "Glass Si-O bend background")),
    "Quartz": ((455, 470, 0.70, "Quartz substrate 464"),
               (200, 212, 0.45, "Quartz substrate 206")),
    "Al2O3 / sapphire": ((410, 422, 0.70, "Sapphire substrate 418"),
                         (640, 652, 0.50, "Sapphire substrate 645")),
}


def artifact_risk(shift, meta=None, fwhm=None):
    """(risk, reasons) that a band at this shift is not the sample.

    A very narrow line (FWHM below ~4 cm-1) anywhere in the spectrum is also
    flagged as a possible cosmic-ray strike - real condensed-phase bands are
    wider on nearly every spectrometer.
    """
    meta = meta or {}
    regions = list(ARTIFACT_REGIONS)
    regions.extend(SUBSTRATE_BANDS.get(meta.get('substrate') or "", ()))

    risk, reasons = 0.0, []
    for lo, hi, base, text in regions:
        if not (lo <= shift <= hi):
            continue
        weight = base
        if "Atmospheric" in text and meta.get('in_air') is False:
            weight *= 0.25
        if weight > 0:
            risk = max(risk, min(1.0, weight))
            reasons.append(text)

    if fwhm is not None and float(fwhm) < 4.0:
        risk = max(risk, 0.55)
        reasons.append(f"very narrow ({float(fwhm):.1f} cm-1): possible "
                       "cosmic-ray spike - check it repeats between scans")
    return risk, reasons


# ---------------------------------------------------------------------------
# Chemistry from a library row
# ---------------------------------------------------------------------------

_UBIQUITOUS = {"C", "H", "O"}

_ORGANIC_WORDS = ("alkane", "alkene", "alkyne", "aromatic", "benzene", "ester",
                  "carbonyl", "nitrile", "polymer", "polyethylene",
                  "polystyrene", "protein", "phenyl", "thiol", "disulfide",
                  "ch2", "ch3", "c-h")
_INORGANIC_WORDS = ("oxide", "carbonate", "nitrate", "sulfate", "phosphate",
                    "silicate", "quartz", "feldspar", "zircon", "olivine",
                    "apatite", "perovskite", "spinel", "hematite", "magnetite",
                    "goethite", "pyrite", "lattice", "phonon", "fluorite",
                    "wurtzite", "rutile", "anatase", "corundum")
_CARBON_WORDS = ("graph", "carbon", "diamond", "cnt", "nanotube", "sp2", "sp3",
                 "boron nitride")
_SEMI_WORDS = ("silicon", "germanium", "gaas", "gan", "mos2", "ws2",
               "selenium", "sulfur")
_BIO_WORDS = ("protein", "tissue", "phenylalanine", "bone")


# Real element symbols a library row can plausibly require. Anything a
# formula token yields outside this set is a symmetry label or an acronym,
# not chemistry.
_ELEMENTS = {
    "H", "Li", "B", "C", "N", "O", "F", "Na", "Mg", "Al", "Si", "P", "S",
    "Cl", "K", "Ca", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
    "Ga", "Ge", "As", "Se", "Br", "Sr", "Y", "Zr", "Nb", "Mo", "Ag", "Cd",
    "In", "Sn", "Sb", "Te", "I", "Ba", "La", "Ce", "Hf", "Ta", "W", "Pt",
    "Au", "Pb", "Bi",
}

# Tokens that look like chemical formulas but are not: mode symmetry labels
# (Eg, A1g, B2g, F2g, 2LA...), polymer acronyms (PE, PET, PAN), and other
# spectroscopy shorthand. Compared case-sensitively against whole tokens.
_NOT_FORMULAS = {
    "Eg", "Ag", "Bg",              # symmetry labels (Ag the mode, not silver)
    "PE", "PET", "PAN", "CNT", "RBM", "DLC", "HA", "TO", "LO", "LA", "TA",
    "S8",                          # elemental sulfur ring - handled as S below
}

_FORMULA_TOKEN = re.compile(r'^(?:[A-Z][a-z]?\d*)+$')
_SYMMETRY_LABEL = re.compile(r'^[ABEFT]\d?[gu]\d?$|^\d?[TL][AO]$')


def band_elements(mode, assignment):
    """Elements a band actually requires, read from formulas in the text.

    Formula-shaped tokens (TiO2, BaTiO3, Fe3O4, W-O-W after splitting) are
    broken into symbols and kept only when they are real elements - so the
    symmetry labels (Eg, B1g, A1g...) and acronyms scattered through the mode
    names cannot masquerade as boron or einsteinium.
    """
    text = f"{mode} {assignment}"
    found = set()
    for token in re.split(r'[\s\-=≡/()~,;:.·]+', text):
        if (not token or token in _NOT_FORMULAS
                or _SYMMETRY_LABEL.match(token)
                or not _FORMULA_TOKEN.match(token)):
            continue
        symbols = re.findall(r'[A-Z][a-z]?', token)
        real = [s for s in symbols if s in _ELEMENTS]
        # Keep the token's elements only if every symbol is real chemistry -
        # 'CNT' (C, N + junk T) says carbon nanotube, not carbon nitride.
        if real and len(real) == len(symbols):
            found.update(real)
    for word, elements in (("carbonate", "CO"), ("nitrate", "NO"),
                           ("sulfate", "SO"), ("phosphate", "PO"),
                           ("silicate", "SiO"), ("quartz", "SiO"),
                           ("glass", "SiO"), ("diamond", "C"),
                           ("graph", "C"), ("carbon", "C"),
                           ("sulfur", "S"), ("selenium", "Se"),
                           ("silicon", "Si"), ("germanium", "Ge"),
                           ("sapphire", "AlO"), ("corundum", "AlO"),
                           ("zircon", "ZrSiO"), ("apatite", "CaPO"),
                           ("gypsum", "CaSO"), ("calcite", "CaCO"),
                           ("aragonite", "CaCO"), ("dolomite", "CaCO"),
                           ("pyrite", "FeS"), ("hematite", "FeO"),
                           ("magnetite", "FeO"), ("goethite", "FeO"),
                           ("anatase", "TiO"), ("rutile", "TiO"),
                           ("cuprite", "CuO"), ("tenorite", "CuO"),
                           ("cassiterite", "SnO"), ("hausmannite", "MnO"),
                           ("boron nitride", "BN")):
        if word in text.lower():
            found.update(re.findall(r'[A-Z][a-z]?', elements))
    return found


def band_tags(mode, assignment):
    """Coarse family tags used by the material-type filter."""
    text = f"{mode} {assignment}".lower()
    tags = set()
    if any(w in text for w in _CARBON_WORDS):
        tags.add("carbon")
    if any(w in text for w in _SEMI_WORDS):
        tags.add("semiconductor")
    if any(w in text for w in _INORGANIC_WORDS):
        tags.add("inorganic")
    if any(w in text for w in _ORGANIC_WORDS):
        tags.add("organic")
    if any(w in text for w in _BIO_WORDS):
        tags.add("biological")
    if "water" in text or "hydroxyl" in text or "o-h" in text:
        tags.add("hydrous")
    if "atmospheric" in text or "air" in text:
        tags.add("gas")
    if "substrate" in text or "background" in text or "filter" in text:
        tags.add("instrument")
    if not tags:
        tags.add("inorganic")
    return tags


# The tag that *defines* each material type: a band carrying it is boosted
# over merely-compatible families, so the graphitic G band beats a generic
# aromatic-ring entry on a carbon sample.
_PRIMARY_MATERIAL_TAG = {
    "Carbon material": "carbon",
    "Semiconductor": "semiconductor",
    "Biological": "biological",
    "Mineral": "inorganic",
    "Metal oxide / ceramic": "inorganic",
}

_MATERIAL_TAGS = {
    "Organic molecule": {"organic", "hydrous"},
    "Polymer": {"organic", "carbon"},
    "Carbon material": {"carbon", "organic"},
    "Semiconductor": {"semiconductor", "inorganic"},
    "Metal oxide / ceramic": {"inorganic", "hydrous"},
    "Mineral": {"inorganic", "hydrous"},
    "Inorganic salt": {"inorganic", "hydrous"},
    "Biological": {"biological", "organic", "hydrous"},
    "Thin film": {"inorganic", "semiconductor", "carbon", "organic"},
    "Catalyst / supported metal": {"inorganic", "carbon", "hydrous"},
}


# ---------------------------------------------------------------------------
# Candidate generation
# ---------------------------------------------------------------------------

def _normalised_bands():
    for row in RAMAN_BANDS:
        wn_a, wn_b, mode, intensity, assignment = row[:5]
        yield (max(wn_a, wn_b), min(wn_a, wn_b), mode, intensity, assignment)


def _parse_elements(text):
    if not text:
        return set()
    tokens = re.split(r'[,;/\s]+', str(text).strip())
    return {t.strip().capitalize() if len(t) > 1 else t.strip().upper()
            for t in tokens if t.strip()}


def _position_score(shift, lo, hi, tolerance):
    if lo <= shift <= hi:
        delta = 0.0
        inside = 1.0
    else:
        delta = lo - shift if shift < lo else shift - hi
        inside = max(0.0, 1.0 - (delta / max(tolerance, 1e-6)) ** 2)
    width = max(hi - lo, 1.0)
    # A 10 cm-1 window scores ~1.0, a 400 cm-1 window ~0.27
    specificity = 1.0 / (1.0 + width / 150.0)
    return inside, specificity, delta


def candidates(shift, meta=None, tolerance=12.0, max_candidates=5,
               observed_intensity=None, fwhm=None):
    """Ranked candidate assignments for one Raman peak.

    Each candidate: ``assignment``, ``mode``, ``range``, ``range_text``,
    ``delta``, ``expected_shape``, ``confidence``, ``source``,
    ``artifact_risk``, ``reasons``.
    """
    meta = meta or {}
    expected = _parse_elements(meta.get('elements'))
    discriminating = expected - _UBIQUITOUS
    material = meta.get('material_type') or "Unknown"
    allowed_tags = _MATERIAL_TAGS.get(material)

    risk, risk_reasons = artifact_risk(shift, meta, fwhm)

    out = []
    for hi, lo, mode, intensity, assignment in _normalised_bands():
        inside, specificity, delta = _position_score(shift, lo, hi, tolerance)
        if inside <= 0:
            continue

        reasons = []
        confidence = inside * (0.55 + 0.45 * specificity)
        if delta > 0:
            reasons.append(f"{delta:.0f} cm-1 outside the library range")

        tags = band_tags(mode, assignment)
        if "instrument" in tags:
            # Substrate / background rows compete as artefact candidates, not
            # as sample assignments.
            confidence *= 0.5
            reasons.append("substrate / instrument background band")
        elif allowed_tags is not None:
            if not (tags & allowed_tags):
                confidence *= 0.35
                reasons.append(f"family does not match a "
                               f"{material.lower()} sample")
            elif _PRIMARY_MATERIAL_TAG.get(material) in tags:
                confidence *= 1.2
                reasons.append(f"characteristic of a "
                               f"{material.lower()} sample")

        if discriminating:
            needed = band_elements(mode, assignment) - _UBIQUITOUS
            missing = needed - expected
            if missing:
                confidence *= 0.30
                reasons.append("requires " + ", ".join(sorted(missing))
                               + " which is not in the expected elements")
            elif needed:
                confidence *= 1.15
                reasons.append("matches the expected elements")

        confidence *= (1.0 - 0.6 * risk)

        if observed_intensity is not None and intensity:
            hint = _intensity_agreement(observed_intensity, intensity)
            if hint is not None:
                confidence *= hint[0]
                if hint[1]:
                    reasons.append(hint[1])

        out.append({
            'assignment': assignment,
            'mode': mode,
            'range': (hi, lo),
            'range_text': (f"{hi:.0f}" if hi == lo else f"{lo:.0f}-{hi:.0f}"),
            'delta': delta,
            'expected_shape': intensity,
            'confidence': min(1.0, confidence),
            'source': DEFAULT_SOURCE,
            'artifact_risk': risk,
            'reasons': reasons,
        })

    out.sort(key=lambda c: -c['confidence'])
    out = out[:max_candidates]

    if risk >= 0.4:
        out.insert(0 if (not out or risk > out[0]['confidence']) else 1, {
            'assignment': ARTIFACT,
            'mode': "; ".join(risk_reasons) or "known artefact window",
            'range': (shift, shift),
            'range_text': f"{shift:.0f}",
            'delta': 0.0,
            'expected_shape': "instrument-dependent",
            'confidence': risk,
            'source': "Substrate / atmospheric / filter windows",
            'artifact_risk': risk,
            'reasons': risk_reasons,
        })

    best = out[0]['confidence'] if out else 0.0
    if best < 0.45:
        out.append({
            'assignment': UNASSIGNED,
            'mode': "no confident library match",
            'range': (shift, shift),
            'range_text': f"{shift:.0f}",
            'delta': 0.0,
            'expected_shape': "",
            'confidence': max(0.0, 1.0 - best),
            'source': "",
            'artifact_risk': risk,
            'reasons': ["every candidate is weak, ambiguous or filtered out "
                        "by the sample metadata"],
        })
        out.sort(key=lambda c: -c['confidence'])

    return out


_INTENSITY_WORDS = (("very strong", 1.0), ("strong", 0.8), ("medium", 0.5),
                    ("weak", 0.25))


def _intensity_agreement(observed_fraction, expected_text):
    text = (expected_text or "").lower()
    expected = None
    for word, value in _INTENSITY_WORDS:
        if word in text:
            expected = value
            break
    if expected is None:
        return None
    diff = abs(float(observed_fraction) - expected)
    if diff < 0.25:
        return 1.1, ""
    if diff > 0.6:
        return 0.7, (f"observed intensity ({observed_fraction:.0%} of the "
                     f"strongest peak) disagrees with the expected "
                     f"'{expected_text}'")
    return 0.9, ""


def summarise(candidate):
    """One-line text for the peak table / plot label."""
    if candidate['assignment'] in (UNASSIGNED, ARTIFACT):
        return candidate['assignment']
    return f"{candidate['mode']} ({candidate['assignment']})"


def assign_peaks(peaks, meta=None, tolerance=12.0, max_candidates=5):
    """Assign a list of detected peaks (dicts with at least ``shift``).

    Optional ``relative_height`` (0-1) and ``fwhm`` sharpen the ranking.
    Peaks marked ``locked`` keep their manual assignment.
    """
    for peak in peaks:
        if peak.get('locked'):
            continue
        cands = candidates(peak['shift'], meta, tolerance, max_candidates,
                           observed_intensity=peak.get('relative_height'),
                           fwhm=peak.get('fwhm'))
        peak['candidates'] = cands
        top = cands[0] if cands else None
        peak['assignment'] = summarise(top) if top else UNASSIGNED
        peak['confidence'] = top['confidence'] if top else 0.0
        peak['artifact_risk'] = top['artifact_risk'] if top else 0.0
    return peaks
