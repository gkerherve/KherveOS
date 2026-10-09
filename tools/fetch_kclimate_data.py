#!/usr/bin/env python3
"""Fetch the open climate datasets of kClimate and convert them to compact CSV.

    python3 tools/fetch_kclimate_data.py                 download everything, write public/data/kclimate/
    python3 tools/fetch_kclimate_data.py --raw DIR       keep the downloads in DIR and reuse files already there
    python3 tools/fetch_kclimate_data.py --only co2_mlo,oni

Python standard library only. Nothing is typed in by hand: every number in public/data/kclimate/*.csv is
parsed from the provider's own file (the URLs are in SOURCES below). The script also writes

    public/data/kclimate/manifest.json   what the app and the tests read: provider, URL, licence, version,
                                         retrieval date, row count, time range and columns of every file
    public/data/kclimate/README.md       the same, for people

Time columns: monthly files have `year,month`; annual and irregular files have `time` (decimal year, the
middle of the period). Missing values are empty cells. A dataset that cannot be downloaded or fails its
checks is left out (and reported); the app then offers to import it from a CSV the user supplies.

Re-running fetches the providers' latest versions, so the numbers (and the retrieval date) change over time;
the tests only check that each file agrees with the manifest written next to it.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import re
import ssl
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

UA = "Mozilla/5.0 (kClimate data fetch; KherveOS)"
ROOT = Path(__file__).resolve().parent.parent

NSIDC_BASE = "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/"

# --------------------------------------------------------------------------------------------- sources
# id -> metadata shown in the app ("Data sources") and in the README. `files` are the downloads.
SOURCES = {
    "co2_mlo": {
        "title": "Atmospheric CO2 at Mauna Loa, monthly",
        "provider": "NOAA Global Monitoring Laboratory (GML), with the 1958-1974 record of C. D. Keeling, Scripps Institution of Oceanography",
        "url": "https://gml.noaa.gov/ccgg/trends/data.html",
        "licence": "US Government work, public domain; NOAA asks for credit and a citation (Lan et al., NOAA GML)",
        "files": {"co2_mm_mlo.csv": "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv"},
        "citation": "Lan, X., Tans, P. and Thoning, K.W.: Trends in globally-averaged CO2 determined from NOAA Global Monitoring Laboratory measurements.",
        "description": "Monthly mean dry-air CO2 mole fraction at Mauna Loa (ppm) and the same with the seasonal cycle removed.",
    },
    "gistemp": {
        "title": "GISTEMP v4 surface temperature anomaly: global, northern and southern hemisphere, monthly",
        "provider": "NASA Goddard Institute for Space Studies (GISS)",
        "url": "https://data.giss.nasa.gov/gistemp/",
        "licence": "NASA data, public domain; GISS asks to cite GISTEMP Team and Lenssen et al. (2024)",
        "files": {
            "gistemp_glb.csv": "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv",
            "gistemp_nh.csv": "https://data.giss.nasa.gov/gistemp/tabledata_v4/NH.Ts+dSST.csv",
            "gistemp_sh.csv": "https://data.giss.nasa.gov/gistemp/tabledata_v4/SH.Ts+dSST.csv",
        },
        "citation": "GISTEMP Team: GISS Surface Temperature Analysis (GISTEMP), version 4. NASA GISS. Lenssen, N. et al. (2024), J. Geophys. Res. Atmos., doi:10.1029/2023JD040179.",
        "description": "Land-ocean temperature index (LOTI), anomalies in degrees C relative to 1951-1980.",
        "version": "GISTEMP v4 (LOTI, ERSSTv5 ocean)",
    },
    "hadcrut5": {
        "title": "HadCRUT5 global temperature anomaly, monthly, with 95 % uncertainty range",
        "provider": "Met Office Hadley Centre / Climatic Research Unit, University of East Anglia",
        "url": "https://www.metoffice.gov.uk/hadobs/hadcrut5/",
        "licence": "Open Government Licence v3.0 (contains public sector information); cite Morice et al. (2021)",
        "files": {
            "hadcrut5_monthly.csv": "https://www.metoffice.gov.uk/hadobs/hadcrut5/data/HadCRUT.5.2.0.0/analysis/diagnostics/HadCRUT.5.2.0.0.analysis.summary_series.global.monthly.csv"
        },
        "citation": "Morice, C.P. et al. (2021), An updated assessment of near-surface temperature change from 1850: the HadCRUT5 data set, J. Geophys. Res. Atmos., 126, e2019JD032361.",
        "description": "Global mean near-surface temperature anomaly (degrees C) relative to 1961-1990, 1850 to now, with the lower and upper 95 % limits.",
        "version": "HadCRUT.5.2.0.0, analysis, global monthly summary series",
    },
    "oni": {
        "title": "Oceanic Nino Index (ONI), ENSO",
        "provider": "NOAA Climate Prediction Center (CPC)",
        "url": "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php",
        "licence": "US Government work, public domain",
        "files": {"oni.ascii.txt": "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"},
        "citation": "NOAA CPC: Oceanic Nino Index (ONI), ERSSTv5 Nino 3.4 region, 3-month running mean.",
        "description": "3-month running mean of the Nino 3.4 sea-surface temperature anomaly (degrees C, ERSSTv5, centred 30-year base periods). Each value is placed on the middle month of its 3-month season (DJF = January).",
        "version": "ONI based on ERSSTv5",
    },
    "arctic_ice": {
        "title": "Arctic sea-ice extent, monthly (Sea Ice Index)",
        "provider": "NOAA@NSIDC, National Snow and Ice Data Center",
        "url": "https://nsidc.org/data/g02135/versions/4",
        "licence": "Free and open access; citation required as a condition of use (Fetterer et al., doi:10.7265/a98x-0f50)",
        "files": {f"N_{m:02d}_extent_v4.0.csv": f"{NSIDC_BASE}N_{m:02d}_extent_v4.0.csv" for m in range(1, 13)},
        "citation": "Fetterer, F., Knowles, K., Meier, W. N., Savoie, M., Windnagel, A. K. & Stafford, T. Sea Ice Index, Version 4 (G02135). NSIDC. doi:10.7265/a98x-0f50.",
        "description": "Monthly mean Northern Hemisphere sea-ice extent and area, millions of km2, from passive-microwave satellites, November 1978 onwards (two months, December 1987 and January 1988, have no data).",
        "version": "Sea Ice Index v4.0 (monthly extent files)",
    },
    "owid_co2": {
        "title": "World CO2 emissions per year (fossil fuels, cement, land use)",
        "provider": "Our World in Data, from the Global Carbon Project (Global Carbon Budget) and others",
        "url": "https://github.com/owid/co2-data",
        "licence": "Creative Commons Attribution 4.0 (CC BY 4.0); credit Our World in Data and the Global Carbon Project",
        "files": {"owid-co2-data.csv": "https://raw.githubusercontent.com/owid/co2-data/master/owid-co2-data.csv"},
        "citation": "Our World in Data CO2 and Greenhouse Gas Emissions dataset, based on the Global Carbon Budget (Friedlingstein et al.), World rows.",
        "description": "Annual emissions of the world, million tonnes of CO2 (fossil fuels and cement; including land-use change from 1850), and cumulative totals.",
    },
    "sealevel_csiro": {
        "title": "Global mean sea level, tide-gauge reconstruction 1880-2013",
        "provider": "CSIRO (Church and White 2011, updated 2015)",
        "url": "https://research.csiro.au/slrwavescoast/sea-level/",
        "licence": "Free to use; the provider asks that the source is acknowledged. The data page states no formal licence",
        "files": {"church_white_gmsl_2011_up.zip": "https://www.cmar.csiro.au/sealevel/downloads/church_white_gmsl_2011_up.zip"},
        "citation": "Church, J.A. and White, N.J. (2011), Sea-level rise from the late 19th to the early 21st century, Surveys in Geophysics, 32, 585-602.",
        "description": "Annual global mean sea level in mm (arbitrary zero), with its uncertainty, reconstructed from tide gauges.",
        "version": "Church and White 2011, update to 2013 (files dated June 2015)",
    },
    "sealevel_noaa": {
        "title": "Global mean sea level from satellite altimetry, 1993-now",
        "provider": "NOAA Laboratory for Satellite Altimetry (STAR)",
        "url": "https://www.star.nesdis.noaa.gov/socd/lsa/SeaLevelRise/",
        "licence": "US Government work, public domain; acknowledgment requested: 'Altimetry data are provided by NOAA Laboratory for Satellite Altimetry.'",
        "files": {"slr_sla_gbl_free_all_66.csv": "https://www.star.nesdis.noaa.gov/socd/lsa/SeaLevelRise/slr/slr_sla_gbl_free_all_66.csv"},
        "citation": "NOAA Laboratory for Satellite Altimetry: Sea level rise (TOPEX/Poseidon, Jason-1/2/3, Sentinel-6MF), global ocean 66S to 66N, annual signals removed, no glacial isostatic adjustment.",
        "description": "Global mean sea level anomaly in mm from successive altimetry missions, about every 10 days, annual cycle removed.",
        "version": "slr_sla_gbl_free_all_66",
    },
    "giss_aod": {
        "title": "Stratospheric aerosol optical depth (volcanic forcing) 1850-2012",
        "provider": "NASA Goddard Institute for Space Studies (Sato, Lacis, Hansen)",
        "url": "https://data.giss.nasa.gov/modelforce/strataer/",
        "licence": "NASA data, public domain; cite Sato et al. (1993) and the GISS forcing page",
        "files": {"tau.line_2012.12.txt": "https://data.giss.nasa.gov/modelforce/strataer/original_GISS_data/tau.line_2012.12.txt"},
        "citation": "Sato, M., Hansen, J.E., McCormick, M.P. and Pollack, J.B. (1993), Stratospheric aerosol optical depths 1850-1990, J. Geophys. Res., 98, 22987-22994 (extended by GISS to 2012).",
        "description": "Monthly global and hemispheric mean stratospheric aerosol optical depth at 550 nm (dimensionless), a measure of volcanic eruptions.",
        "version": "tau.line_2012.12",
    },
}

# What was looked for and is not in the app (see the README).
NOT_INCLUDED = [
    "Solar activity (sunspot number): the SILSO series is licensed CC BY-NC (non-commercial), so it is not shipped. The NOAA SWPC F10.7 table starts only in 2004. Import one with File > Import CSV.",
    "Ice-core CO2 before 1958: not downloaded; the model builds the earlier path from cumulative emissions and says so.",
]


# ------------------------------------------------------------------------------------------ helpers
def fetch(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
    except urllib.error.URLError as e:
        # Python from python.org on macOS has no CA bundle until "Install Certificates.command" is run:
        # curl (which uses the system store) does the same download.
        if not isinstance(getattr(e, "reason", None), ssl.SSLError):
            raise
        data = subprocess.run(["curl", "-fsSL", "-m", "120", "-A", UA, url], check=True, capture_output=True).stdout
    head = data[:200].lstrip().lower()
    if head.startswith(b"<!doctype html") or head.startswith(b"<html") or b"<title>404" in data[:400].lower():
        raise ValueError(f"{url} returned an HTML page, not data")
    dest.write_bytes(data)


def num(cell: str, missing=()) -> float | None:
    s = cell.strip().strip('"')
    if s == "" or s in missing or s.startswith("*"):
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v


def fmt(v: float | None, digits: int) -> str:
    if v is None:
        return ""
    s = f"{v:.{digits}f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def write_csv(path: Path, header: list[str], rows: list[list[str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ---------------------------------------------------------------------------------------- converters
# Each returns (header, rows, extra) where extra updates the manifest entry (columns, step, version, note).
def conv_co2_mlo(raw: Path):
    text = (raw / "co2_mm_mlo.csv").read_text(encoding="utf-8")
    created = re.search(r"File Creation:\s*(.+)", text)
    rows = []
    for line in text.splitlines():
        if not line or line.startswith("#") or line.startswith("year"):
            continue
        p = line.split(",")
        y, m = int(p[0]), int(p[1])
        co2, det = num(p[3], ("-99.99", "-9.99")), num(p[4], ("-99.99", "-9.99"))
        if co2 is not None and co2 < -90:
            co2 = None
        if det is not None and det < -90:
            det = None
        rows.append([str(y), str(m), fmt(co2, 2), fmt(det, 2)])
    extra = {
        "step": "monthly",
        "version": "NOAA GML co2_mm_mlo.csv" + (f", file created {created.group(1).strip()}" if created else ""),
        "columns": [
            {"key": "co2", "name": "CO2 (Mauna Loa)", "unit": "ppm", "kind": "level"},
            {"key": "co2_deseasonalized", "name": "CO2 (Mauna Loa), seasonal cycle removed", "unit": "ppm", "kind": "level"},
        ],
        "missing": "No month is empty: NOAA fills the few months without measurements by interpolation (ndays = -1 in its file) and says so in the file header. The deseasonalized column is the provider's own.",
    }
    return ["year", "month", "co2", "co2_deseasonalized"], rows, extra


def conv_gistemp(raw: Path):
    series = {}
    for key, fname in (("global", "gistemp_glb.csv"), ("nh", "gistemp_nh.csv"), ("sh", "gistemp_sh.csv")):
        out = {}
        for line in (raw / fname).read_text(encoding="utf-8").splitlines():
            p = line.split(",")
            if not p or not re.fullmatch(r"\d{4}", p[0].strip()):
                continue
            for m in range(1, 13):
                v = num(p[m], ("***",))
                if v is not None:
                    out[(int(p[0]), m)] = v
        series[key] = out
    keys = sorted(set().union(*[set(s) for s in series.values()]))
    rows = [[str(y), str(m)] + [fmt(series[k].get((y, m)), 2) for k in ("global", "nh", "sh")] for y, m in keys]
    extra = {
        "step": "monthly",
        "columns": [
            {"key": "global", "name": "GISTEMP global", "unit": "°C", "kind": "anomaly", "baseline": [1951, 1980]},
            {"key": "nh", "name": "GISTEMP northern hemisphere", "unit": "°C", "kind": "anomaly", "baseline": [1951, 1980]},
            {"key": "sh", "name": "GISTEMP southern hemisphere", "unit": "°C", "kind": "anomaly", "baseline": [1951, 1980]},
        ],
        "missing": "The provider publishes values to 0.01 °C; months not yet analysed are left empty.",
    }
    return ["year", "month", "global", "nh", "sh"], rows, extra


def conv_hadcrut5(raw: Path):
    rows = []
    with (raw / "hadcrut5_monthly.csv").open(encoding="utf-8") as f:
        r = csv.reader(f)
        next(r)
        for p in r:
            m = re.fullmatch(r"(\d{4})-(\d{2})", p[0])
            if not m:
                continue
            rows.append([str(int(m.group(1))), str(int(m.group(2)))] + [fmt(num(p[i]), 3) for i in (1, 2, 3)])
    extra = {
        "step": "monthly",
        "columns": [
            {"key": "anomaly", "name": "HadCRUT5 global", "unit": "°C", "kind": "anomaly", "baseline": [1961, 1990]},
            {"key": "lower", "name": "HadCRUT5 lower 95 % limit", "unit": "°C", "kind": "anomaly", "baseline": [1961, 1990]},
            {"key": "upper", "name": "HadCRUT5 upper 95 % limit", "unit": "°C", "kind": "anomaly", "baseline": [1961, 1990]},
        ],
    }
    return ["year", "month", "anomaly", "lower", "upper"], rows, extra


SEASON_CENTRE = {"DJF": 1, "JFM": 2, "FMA": 3, "MAM": 4, "AMJ": 5, "MJJ": 6, "JJA": 7, "JAS": 8, "ASO": 9, "SON": 10, "OND": 11, "NDJ": 12}


def conv_oni(raw: Path):
    rows = []
    for line in (raw / "oni.ascii.txt").read_text(encoding="utf-8").splitlines():
        p = line.split()
        if len(p) != 4 or p[0] not in SEASON_CENTRE:
            continue
        rows.append([p[1], str(SEASON_CENTRE[p[0]]), fmt(num(p[3]), 2), fmt(num(p[2]), 2)])
    extra = {
        "step": "monthly",
        "columns": [
            {"key": "oni", "name": "Oceanic Niño Index", "unit": "°C", "kind": "anomaly", "baseline": None},
            {"key": "nino34_sst", "name": "Niño 3.4 SST (3-month mean)", "unit": "°C", "kind": "level"},
        ],
        "missing": "Each 3-month season is placed on its middle month, so the record ends one month before the latest month observed.",
    }
    return ["year", "month", "oni", "nino34_sst"], rows, extra


def conv_arctic_ice(raw: Path):
    rec = {}
    for m in range(1, 13):
        for line in (raw / f"N_{m:02d}_extent_v4.0.csv").read_text(encoding="utf-8").splitlines()[1:]:
            p = [c.strip() for c in line.split(",")]
            if len(p) < 6 or not p[0].isdigit():
                continue
            ext, area = num(p[4], ("-9999", "-9999.0")), num(p[5], ("-9999", "-9999.0"))
            if ext is not None and ext < 0:
                ext = None
            if area is not None and area < 0:
                area = None
            rec[(int(p[0]), int(p[1]))] = (ext, area)
    rows = [[str(y), str(m), fmt(v[0], 3), fmt(v[1], 3)] for (y, m), v in sorted(rec.items())]
    extra = {
        "step": "monthly",
        "columns": [
            {"key": "extent", "name": "Arctic sea-ice extent", "unit": "million km²", "kind": "level"},
            {"key": "area", "name": "Arctic sea-ice area", "unit": "million km²", "kind": "level"},
        ],
    }
    return ["year", "month", "extent", "area"], rows, extra


def conv_owid(raw: Path):
    cols = ["co2", "co2_including_luc", "cumulative_co2", "cumulative_co2_including_luc", "coal_co2", "oil_co2", "gas_co2", "cement_co2", "land_use_change_co2"]
    rows = []
    with (raw / "owid-co2-data.csv").open(encoding="utf-8", newline="") as f:
        for rec in csv.DictReader(f):
            if rec["country"] != "World":
                continue
            rows.append([rec["year"]] + [fmt(num(rec[c]), 3) for c in cols])
    names = {
        "co2": "CO2 emissions (fossil fuels and cement)",
        "co2_including_luc": "CO2 emissions including land-use change",
        "cumulative_co2": "Cumulative CO2 emissions (fossil fuels and cement)",
        "cumulative_co2_including_luc": "Cumulative CO2 emissions including land-use change",
        "coal_co2": "CO2 from coal", "oil_co2": "CO2 from oil", "gas_co2": "CO2 from gas", "cement_co2": "CO2 from cement",
        "land_use_change_co2": "CO2 from land-use change",
    }
    extra = {
        "step": "annual",
        "columns": [{"key": c, "name": names[c], "unit": "Mt CO₂" if not c.startswith("cumulative") else "Mt CO₂ (cumulative)", "kind": "level"} for c in cols],
        "missing": "Series start when the provider's estimates start (fossil CO2 1750, oil 1855, gas 1882, cement 1880, land use 1850).",
    }
    return ["year"] + cols, rows, extra


def conv_sealevel_csiro(raw: Path):
    with zipfile.ZipFile(raw / "church_white_gmsl_2011_up.zip") as z:
        name = next(n for n in z.namelist() if n.endswith("CSIRO_Recons_gmsl_yr_2015.csv"))
        text = z.read(name).decode("utf-8")
    rows = []
    for line in text.splitlines()[1:]:
        p = line.split(",")
        if len(p) < 3 or num(p[0]) is None:
            continue
        rows.append([fmt(num(p[0]), 1), fmt(num(p[1]), 1), fmt(num(p[2]), 1)])
    extra = {
        "step": "annual",
        "columns": [
            {"key": "gmsl_mm", "name": "Global mean sea level (tide-gauge reconstruction)", "unit": "mm", "kind": "level"},
            {"key": "uncertainty_mm", "name": "Sea level uncertainty", "unit": "mm", "kind": "level"},
        ],
    }
    return ["time", "gmsl_mm", "uncertainty_mm"], rows, extra


def conv_sealevel_noaa(raw: Path):
    rows = []
    trend = None
    for line in (raw / "slr_sla_gbl_free_all_66.csv").read_text(encoding="utf-8").splitlines():
        if line.startswith("#trend"):
            trend = line.split("=", 1)[1].strip()
        if line.startswith("#") or line.startswith("year"):
            continue
        p = line.split(",")
        vals = [num(c) for c in p[1:]]
        v = next((x for x in vals if x is not None), None)
        if num(p[0]) is None or v is None:
            continue
        rows.append([fmt(num(p[0]), 4), fmt(v, 2)])
    extra = {
        "step": "irregular",
        "columns": [{"key": "gmsl_mm", "name": "Global mean sea level (satellite altimetry)", "unit": "mm", "kind": "level"}],
        "note": f"Provider's own trend of the whole record: {trend}." if trend else "",
        "provider_trend": trend,
    }
    return ["time", "gmsl_mm"], rows, extra


def conv_giss_aod(raw: Path):
    rows = []
    for line in (raw / "tau.line_2012.12.txt").read_text(encoding="utf-8").splitlines():
        p = line.split()
        if len(p) != 4 or not re.fullmatch(r"\d{4}\.\d+", p[0]):
            continue
        t = float(p[0])
        year = int(t)
        month = int(round((t - year) * 12 - 0.5)) + 1
        rows.append([str(year), str(month)] + [fmt(num(c), 4) for c in p[1:]])
    extra = {
        "step": "monthly",
        "columns": [
            {"key": "global", "name": "Stratospheric aerosol optical depth (global)", "unit": "", "kind": "level"},
            {"key": "nh", "name": "Stratospheric aerosol optical depth (N hemisphere)", "unit": "", "kind": "level"},
            {"key": "sh", "name": "Stratospheric aerosol optical depth (S hemisphere)", "unit": "", "kind": "level"},
        ],
    }
    return ["year", "month", "global", "nh", "sh"], rows, extra


CONVERTERS = {
    "co2_mlo": (conv_co2_mlo, "co2_mlo.csv"),
    "gistemp": (conv_gistemp, "gistemp.csv"),
    "hadcrut5": (conv_hadcrut5, "hadcrut5.csv"),
    "oni": (conv_oni, "oni.csv"),
    "arctic_ice": (conv_arctic_ice, "arctic_sea_ice.csv"),
    "owid_co2": (conv_owid, "owid_world_co2.csv"),
    "sealevel_csiro": (conv_sealevel_csiro, "sealevel_csiro.csv"),
    "sealevel_noaa": (conv_sealevel_noaa, "sealevel_noaa_altimetry.csv"),
    "giss_aod": (conv_giss_aod, "giss_aod.csv"),
}


def time_of(header: list[str], row: list[str]) -> float:
    if "month" in header:
        return int(row[0]) + (int(row[1]) - 0.5) / 12
    if header[0] == "year":  # an annual value sits in the middle of its year
        return int(row[0]) + 0.5
    return float(row[0])


def check(ds: str, header: list[str], rows: list[list[str]]) -> None:
    if len(rows) < 20:
        raise ValueError(f"{ds}: only {len(rows)} rows")
    ts = [time_of(header, r) for r in rows]
    if any(b <= a for a, b in zip(ts, ts[1:])):
        raise ValueError(f"{ds}: time is not strictly increasing")
    first_value_col = 2 if "month" in header else 1
    if all(all(c == "" for c in r[first_value_col:]) for r in rows):
        raise ValueError(f"{ds}: no values")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", help="folder for the downloaded files (reused when a file is already there)")
    ap.add_argument("--out", default=str(ROOT / "public" / "data" / "kclimate"))
    ap.add_argument("--only", help="comma-separated dataset ids")
    ap.add_argument("--date", help="retrieval date to record (default: today)")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    raw = Path(args.raw) if args.raw else Path(tempfile.mkdtemp(prefix="kclimate-raw-"))
    raw.mkdir(parents=True, exist_ok=True)
    today = args.date or dt.date.today().isoformat()
    only = set(args.only.split(",")) if args.only else None
    old = {}
    if (out / "manifest.json").exists():
        try:
            old = {d["id"]: d for d in json.loads((out / "manifest.json").read_text(encoding="utf-8"))["datasets"]}
        except Exception:
            old = {}

    entries, failed = [], []
    for ds, (conv, fname) in CONVERTERS.items():
        src = SOURCES[ds]
        if only and ds not in only:
            if ds in old:
                entries.append(old[ds])
            continue
        try:
            for name, url in src["files"].items():
                if not (raw / name).exists():
                    print(f"fetch {url}")
                    fetch(url, raw / name)
            header, rows, extra = conv(raw)
            check(ds, header, rows)
        except Exception as e:  # a dataset that fails is left out, and said so
            print(f"FAILED {ds}: {e}", file=sys.stderr)
            failed.append((ds, str(e)))
            continue
        write_csv(out / fname, header, rows)
        ts = [time_of(header, r) for r in rows]
        version = extra.pop("version", None) or src.get("version", "")
        if ds == "owid_co2":
            try:
                req = urllib.request.Request("https://api.github.com/repos/owid/co2-data/commits?path=owid-co2-data.csv&per_page=1", headers={"User-Agent": UA})
                c = json.loads(urllib.request.urlopen(req, timeout=60).read())[0]
                version = f"commit {c['sha'][:10]} of {c['commit']['committer']['date'][:10]}"
            except Exception:
                version = "master branch as retrieved"
        entry = {
            "id": ds,
            "file": fname,
            "title": src["title"],
            "description": src["description"],
            "provider": src["provider"],
            "url": src["url"],
            "download_urls": list(src["files"].values()) if len(src["files"]) <= 3 else [NSIDC_BASE + "N_MM_extent_v4.0.csv (MM = 01 to 12)"],
            "licence": src["licence"],
            "citation": src["citation"],
            "version": version,
            "retrieved": today,
            "rows": len(rows),
            "t_first": round(ts[0], 4),
            "t_last": round(ts[-1], 4),
            "raw_sha256": {n: sha256(raw / n) for n in src["files"]},
        }
        entry.update(extra)
        entries.append(entry)
        print(f"ok {ds}: {len(rows)} rows, {ts[0]:.2f} to {ts[-1]:.2f}")

    manifest = {
        "format": "kclimate-data",
        "version": 1,
        "generated_by": "tools/fetch_kclimate_data.py",
        "datasets": entries,
        "not_included": NOT_INCLUDED + [f"{ds}: download failed ({why})" for ds, why in failed],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_readme(out / "README.md", manifest)
    print(f"{len(entries)} datasets in {out}" + (f", {len(failed)} failed" if failed else ""))
    return 1 if failed and not only else 0


def span(e: dict) -> str:
    def y(t: float) -> str:
        return str(int(t)) if e["step"] != "monthly" else f"{int(t)}-{int(round((t - int(t)) * 12 + 0.5)):02d}"
    return f"{y(e['t_first'])} to {y(e['t_last'])}"


def write_readme(path: Path, manifest: dict) -> None:
    L = [
        "# kClimate data",
        "",
        "Open climate datasets used by kClimate, as compact CSV. They are fetched and converted by",
        "`tools/fetch_kclimate_data.py` (Python standard library only): every value is parsed from the provider's own file,",
        "none is typed in or estimated. Run `python3 tools/fetch_kclimate_data.py` to refresh them. `manifest.json` holds the",
        "same information for the app (Data sources panel) and the tests (row counts and time ranges).",
        "",
        "Monthly files have `year,month` columns; annual and irregular ones a `time` column (decimal year, the middle of",
        "the period). Empty cells are missing values.",
        "",
    ]
    for e in manifest["datasets"]:
        L += [
            f"## {e['title']}",
            "",
            f"- File: `{e['file']}` ({e['rows']} rows, {span(e)}, {e['step']})",
            f"- Provider: {e['provider']}",
            f"- URL: {e['url']}",
            f"- Licence / terms: {e['licence']}",
            f"- Version: {e['version']}",
            f"- Retrieved: {e['retrieved']}",
            f"- Cite as: {e['citation']}",
            f"- Columns: " + "; ".join(f"`{c['key']}` ({c['unit'] or 'no unit'})" for c in e["columns"]),
            f"- {e['description']}",
        ]
        if e.get("missing"):
            L.append(f"- Missing values: {e['missing']}")
        if e.get("note"):
            L.append(f"- Note: {e['note']}")
        L.append("")
    L += ["## Not included", ""] + [f"- {n}" for n in manifest["not_included"]] + [""]
    path.write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
