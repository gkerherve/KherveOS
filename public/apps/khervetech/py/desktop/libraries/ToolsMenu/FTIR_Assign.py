# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/FTIR_Assign.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/FTIR_Assign.py
"""
FTIR band assignment.

The old behaviour - one detected peak, one confident-looking assignment -
is wrong for infrared: most wavenumbers are compatible with several
functional groups, and a good fraction of the sharp features in a real
spectrum are not sample bands at all.

This module instead returns, for every detected band, a ranked list of
*candidates*, each with

  * a confidence in 0-1 and the reasons behind it,
  * the wavenumber difference from the library range,
  * the band shape/intensity the library expects,
  * the literature source,
  * an artefact risk,

and it always allows "Unassigned" and "Possible artifact" to win.  Sample
metadata (material type, expected elements, measurement mode, atmosphere)
is used to down-weight chemically implausible candidates rather than to
delete them, so nothing is hidden from the user.
"""

import re

from libraries.ToolsMenu.FTIR_Library import FTIR_BANDS

DEFAULT_SOURCE = ("IR correlation tables (Socrates, 'Infrared and Raman "
                  "Characteristic Group Frequencies', 3rd ed.; Coblentz "
                  "Society reference spectra)")

MINERAL_SOURCE = ("Mineral/inorganic IR tables (Farmer, 'The Infrared "
                  "Spectra of Minerals'; Nakamoto, 'IR and Raman Spectra of "
                  "Inorganic and Coordination Compounds')")

UNASSIGNED = "Unassigned"
ARTIFACT = "Possible artifact"


# ---------------------------------------------------------------------------
# Metadata vocabularies (also used to build the UI choices)
# ---------------------------------------------------------------------------

MATERIAL_TYPES = ("Unknown", "Organic molecule", "Polymer", "Inorganic salt",
                  "Metal oxide / ceramic", "Mineral", "Carbon material",
                  "Biological", "Gas", "Liquid / solvent", "Thin film",
                  "Catalyst / supported metal")

MEASUREMENT_MODES = ("Unknown", "ATR", "Transmission", "DRIFTS",
                     "Specular reflectance", "Gas cell")

PHYSICAL_STATES = ("Unknown", "Solid (powder)", "Solid (film)", "Liquid",
                   "Gas", "Solution", "Slurry")

ATMOSPHERES = ("Unknown", "Air", "Dry N2", "Ar", "Vacuum", "H2", "O2",
               "CO2", "Humid air", "Reaction gas mix")

ATR_CRYSTAL_CHOICES = ("Unknown", "Diamond", "ZnSe", "Ge", "Si", "KRS-5")


def default_metadata():
    return {
        'material_type': "Unknown",
        'elements': "",
        'mode': "Unknown",
        'atmosphere': "Unknown",
        'state': "Unknown",
        'resolution': "",
        'range': "",
        'atr_crystal': "Unknown",
        'atr_angle': "45",
        'temperature': "",
        'time': "",
        'notes': "",
    }


# ---------------------------------------------------------------------------
# Artefact regions
# ---------------------------------------------------------------------------
# (low, high, risk 0-1, description)
ARTIFACT_REGIONS = (
    (2280, 2400, 0.85, "Atmospheric / purge CO2 (asymmetric stretch doublet)"),
    (630, 700, 0.45, "Atmospheric CO2 bending mode"),
    (3500, 3960, 0.55, "Atmospheric water-vapour rotational fine structure"),
    (1300, 2000, 0.40, "Atmospheric water-vapour rotational fine structure"),
    (1900, 2300, 0.60, "Diamond ATR crystal two-phonon absorption"),
    (0, 400, 0.70, "Below the usual detector/beamsplitter cut-off"),
)


def artifact_risk(wavenumber, meta=None, fwhm=None):
    """Return ``(risk, reasons)`` for a band position.

    Metadata sharpens this: water-vapour structure is unlikely in a dry-N2
    purged instrument, and the diamond artefact only exists on a diamond ATR.
    Band width matters too - atmospheric rotational lines are a few cm-1
    wide, so a broad condensed-phase band inside the vapour window is almost
    certainly the sample, not the air.
    """
    meta = meta or {}
    atmosphere = (meta.get('atmosphere') or "Unknown")
    crystal = (meta.get('atr_crystal') or "Unknown")
    mode = (meta.get('mode') or "Unknown")

    risk, reasons = 0.0, []
    for lo, hi, base, text in ARTIFACT_REGIONS:
        if not (lo <= wavenumber <= hi):
            continue
        weight = base
        if "CO2" in text or "water-vapour" in text:
            if atmosphere in ("Dry N2", "Vacuum", "Ar"):
                weight *= 0.25
            elif atmosphere in ("Humid air", "Air"):
                weight *= 1.15
            if mode == "Gas cell" or meta.get('material_type') == "Gas":
                weight *= 0.3   # in a gas measurement these may be the sample
            if fwhm:
                # Rotational lines are ~5-10 cm-1 wide; anything much broader
                # is a condensed-phase band that merely overlaps the window.
                weight *= max(0.1, min(1.0, 15.0 / float(fwhm)))
        if "diamond" in text.lower():
            if crystal == "Diamond":
                weight *= 1.0
            elif crystal == "Unknown":
                weight *= 0.5
            else:
                weight = 0.0
        if weight > 0:
            risk = max(risk, min(1.0, weight))
            reasons.append(text)
    return risk, reasons


# ---------------------------------------------------------------------------
# Deriving chemistry from a library row
# ---------------------------------------------------------------------------

# Elements so common they carry no discriminating power
_UBIQUITOUS = {"C", "H", "O"}

_ORGANIC_WORDS = ("alkane", "alkene", "alkyne", "aromatic", "ester", "ketone",
                  "aldehyde", "amide", "amine", "nitrile", "carboxylic",
                  "anhydride", "acyl", "ether", "alcohol", "nitro", "vinyl",
                  "methyl", "methylene", "halide", "chloride", "bromide")
_INORGANIC_WORDS = ("carbonate", "nitrate", "sulfate", "phosphate", "silicate",
                    "lattice", "oxide", "hydroxide", "perovskite", "apatite",
                    "quartz", "glass", "octahedra")
_SURFACE_WORDS = ("surface", "adsorbed", "metal carbonyl", "hydrate")


def band_elements(vibration, assignment):
    """Elements a band actually requires, e.g. 'Si-O-Si' -> {Si, O}."""
    text = f"{vibration} {assignment}"
    found = set()
    for token in re.findall(r'[A-Z][a-z]?', vibration):
        found.add(token)
    # Named species that do not spell out their elements
    for word, elements in (("carbonate", "CO"), ("nitrate", "NO"),
                           ("sulfate", "SO"), ("phosphate", "PO"),
                           ("silicate", "SiO"), ("quartz", "SiO")):
        if word in text.lower():
            found.update(re.findall(r'[A-Z][a-z]?', elements))
    # 'M' is a placeholder for "any metal", not an element
    found.discard("M")
    return found


def band_tags(vibration, assignment):
    """Coarse chemical family tags used for the material-type filter."""
    text = f"{vibration} {assignment}".lower()
    tags = set()
    if any(w in text for w in _ORGANIC_WORDS):
        tags.add("organic")
    if any(w in text for w in _INORGANIC_WORDS):
        tags.add("inorganic")
    if any(w in text for w in _SURFACE_WORDS):
        tags.add("surface")
    if "water" in text or "hydroxyl" in text or "o-h" in text:
        tags.add("hydrous")
    if "atmospheric" in text or "gas" in text:
        tags.add("gas")
    if not tags:
        tags.add("organic")
    return tags


# Which tags are plausible for each material type.  Nothing is forbidden -
# a tag outside the set is merely down-weighted.
_MATERIAL_TAGS = {
    "Organic molecule": {"organic", "hydrous"},
    "Polymer": {"organic", "hydrous"},
    "Inorganic salt": {"inorganic", "hydrous"},
    "Metal oxide / ceramic": {"inorganic", "hydrous", "surface"},
    "Mineral": {"inorganic", "hydrous"},
    "Carbon material": {"organic", "inorganic", "surface"},
    "Biological": {"organic", "hydrous"},
    "Gas": {"gas", "organic"},
    "Liquid / solvent": {"organic", "hydrous"},
    "Thin film": {"organic", "inorganic", "surface"},
    "Catalyst / supported metal": {"inorganic", "surface", "hydrous",
                                   "organic"},
}


def band_source(vibration, assignment):
    tags = band_tags(vibration, assignment)
    return MINERAL_SOURCE if "inorganic" in tags else DEFAULT_SOURCE


# ---------------------------------------------------------------------------
# Candidate generation
# ---------------------------------------------------------------------------

def _normalised_bands():
    for row in FTIR_BANDS:
        wn_a, wn_b, vibration, intensity, assignment = row[:5]
        yield (max(wn_a, wn_b), min(wn_a, wn_b), vibration, intensity,
               assignment)


def _parse_elements(text):
    if not text:
        return set()
    tokens = re.split(r'[,;/\s]+', str(text).strip())
    return {t.strip().capitalize() if len(t) > 1 else t.strip().upper()
            for t in tokens if t.strip()}


def _position_score(wavenumber, wn_lo, wn_hi, tolerance):
    """1.0 inside the library range, decaying outside it, plus a specificity
    weight so a 30 cm-1 entry beats an 800 cm-1 catch-all."""
    if wn_lo <= wavenumber <= wn_hi:
        delta = 0.0
        inside = 1.0
    else:
        delta = wn_lo - wavenumber if wavenumber < wn_lo else wavenumber - wn_hi
        inside = max(0.0, 1.0 - (delta / max(tolerance, 1e-6)) ** 2)
    width = max(wn_hi - wn_lo, 1.0)
    # A 20 cm-1 window scores ~1.0, a 400 cm-1 window ~0.45
    specificity = 1.0 / (1.0 + width / 250.0)
    return inside, specificity, delta


def candidates(wavenumber, meta=None, tolerance=15.0, max_candidates=5,
               observed_intensity=None, fwhm=None):
    """Ranked candidate assignments for one detected band.

    Each candidate is a dict with: ``assignment``, ``vibration``,
    ``range``, ``delta``, ``expected_shape``, ``confidence``, ``source``,
    ``artifact_risk``, ``reasons``.
    """
    meta = meta or {}
    expected = _parse_elements(meta.get('elements'))
    discriminating = expected - _UBIQUITOUS
    material = meta.get('material_type') or "Unknown"
    allowed_tags = _MATERIAL_TAGS.get(material)

    risk, risk_reasons = artifact_risk(wavenumber, meta, fwhm)

    out = []
    for wn_hi, wn_lo, vibration, intensity, assignment in _normalised_bands():
        inside, specificity, delta = _position_score(wavenumber, wn_lo, wn_hi,
                                                     tolerance)
        if inside <= 0:
            continue

        reasons = []
        confidence = inside * (0.55 + 0.45 * specificity)
        if delta > 0:
            reasons.append(f"{delta:.0f} cm-1 outside the library range")

        tags = band_tags(vibration, assignment)
        if allowed_tags is not None:
            if tags & allowed_tags:
                confidence *= 1.0
            else:
                confidence *= 0.35
                reasons.append(f"chemical family does not match a "
                               f"{material.lower()} sample")

        if discriminating:
            needed = band_elements(vibration, assignment) - _UBIQUITOUS
            missing = needed - expected
            if missing:
                confidence *= 0.30
                reasons.append("requires " + ", ".join(sorted(missing))
                               + " which is not in the expected elements")
            elif needed:
                confidence *= 1.15
                reasons.append("matches the expected elements")

        # Atmosphere plausibility
        atmosphere = meta.get('atmosphere') or "Unknown"
        if "hydrous" in tags and atmosphere in ("Dry N2", "Vacuum"):
            confidence *= 0.7
            reasons.append("hydrous species are less likely under "
                           + atmosphere)
        if "gas" in tags and meta.get('state') not in ("Gas", None, "",
                                                       "Unknown"):
            confidence *= 0.6
            reasons.append("gas-phase band in a condensed-phase sample")

        # An assignment sitting on top of a known artefact window is worth
        # less, no matter how good the position match is.
        confidence *= (1.0 - 0.6 * risk)

        if observed_intensity is not None and intensity:
            hint = _intensity_agreement(observed_intensity, intensity)
            if hint is not None:
                confidence *= hint[0]
                if hint[1]:
                    reasons.append(hint[1])

        out.append({
            'assignment': assignment,
            'vibration': vibration,
            'range': (wn_hi, wn_lo),
            'range_text': (f"{wn_hi:.0f}" if wn_hi == wn_lo
                           else f"{wn_hi:.0f}-{wn_lo:.0f}"),
            'delta': delta,
            'expected_shape': intensity,
            'confidence': min(1.0, confidence),
            'source': band_source(vibration, assignment),
            'artifact_risk': risk,
            'reasons': reasons,
        })

    out.sort(key=lambda c: -c['confidence'])
    out = out[:max_candidates]

    # Artefact and "no idea" are first-class answers, not fallbacks.
    if risk >= 0.4:
        out.insert(0 if (not out or risk > out[0]['confidence']) else 1, {
            'assignment': ARTIFACT,
            'vibration': "; ".join(risk_reasons) or "known artefact window",
            'range': (wavenumber, wavenumber),
            'range_text': f"{wavenumber:.0f}",
            'delta': 0.0,
            'expected_shape': "sharp, instrument-dependent",
            'confidence': risk,
            'source': "Instrument / purge artefact windows",
            'artifact_risk': risk,
            'reasons': risk_reasons,
        })

    best = out[0]['confidence'] if out else 0.0
    if best < 0.45:
        out.append({
            'assignment': UNASSIGNED,
            'vibration': "no confident library match",
            'range': (wavenumber, wavenumber),
            'range_text': f"{wavenumber:.0f}",
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
    """Compare a band's relative height with the library's expected strength.

    ``observed_fraction`` is the band height as a fraction of the strongest
    band in the spectrum.  Returns ``(multiplier, reason)`` or None.
    """
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
                     f"strongest band) disagrees with the expected "
                     f"'{expected_text}'")
    return 0.9, ""


def summarise(candidate):
    """One-line text for the peak table / plot label."""
    if candidate['assignment'] in (UNASSIGNED, ARTIFACT):
        return candidate['assignment']
    return f"{candidate['vibration']} ({candidate['assignment']})"


def assign_bands(bands, meta=None, tolerance=15.0, max_candidates=5):
    """Assign a whole list of detected bands.

    ``bands`` is a list of dicts with at least ``wavenumber``; an optional
    ``relative_height`` (0-1) sharpens the confidence.  Each band gets a
    ``candidates`` list and the top candidate copied out for the table.
    Bands already marked ``locked`` keep their manual assignment.
    """
    for band in bands:
        if band.get('locked'):
            continue
        cands = candidates(band['wavenumber'], meta, tolerance,
                           max_candidates,
                           observed_intensity=band.get('relative_height'),
                           fwhm=band.get('fwhm'))
        band['candidates'] = cands
        top = cands[0] if cands else None
        band['assignment'] = summarise(top) if top else UNASSIGNED
        band['confidence'] = top['confidence'] if top else 0.0
        band['artifact_risk'] = top['artifact_risk'] if top else 0.0
        band['delta'] = top['delta'] if top else 0.0
        band['expected_shape'] = top['expected_shape'] if top else ""
        band['source'] = top['source'] if top else ""
    return bands
