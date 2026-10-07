# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port: the Sample Manager grid (ViewMenu/FileManager.py
# populate_grid): one column per core level, one row per sample (the number
# at the end of the sheet name), the sample's name (Data['SampleNames']) and
# its BE correction (Data['BEcorrections'], the "Xshift" column).

import re


def parse_base_and_row(sheet_name):
    """FileManager.parse_base_and_row: 'C1s'->('C1s', 0), 'C1s2'->('C1s', 2), 'Ra_xx_2'->('Ra_xx', 2)."""
    if "Raman_" in sheet_name or "Ra_" in sheet_name:
        parts = sheet_name.split('_')
        base = parts[0] + "_" + parts[1] if len(parts) > 1 else sheet_name
        row = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
        return base, row
    m = re.match(r'([\w\-~.]+?)(\d*)$', sheet_name)
    if m:
        return m.group(1), (int(m.group(2)) if m.group(2) else 0)
    return sheet_name, 0


def compose_sheet_name(base, row, is_raman=False):
    """FileManager.compose_sheet_name (the inverse)."""
    if is_raman:
        return f"{base}_{row}" if row > 0 else base
    if base.endswith('_'):
        return f"{base}{row}"
    return f"{base}{row}" if row > 0 else base


def sample_grid(w, sheets=None):
    """populate_grid. sheets limits it to the sheets the page lists (default: all of Data)."""
    names = [s for s in (sheets if sheets is not None else w.Data['Core levels'].keys())
             if s in w.Data['Core levels']]
    cmap = {}
    for s in names:
        base, row = parse_base_and_row(s)
        cmap.setdefault(base, {})[row] = s
    columns = sorted(cmap)
    max_row = max((r for m in cmap.values() for r in m), default=-1)
    sample_names = w.Data.get('SampleNames') or {}
    be = w.Data.get('BEcorrections') or {}
    rows = []
    for r in range(max_row + 1):
        try:
            corr = float(be.get(str(r), 0.0))
        except (TypeError, ValueError):
            corr = 0.0
        rows.append({
            'sample': r,
            'name': str(sample_names.get(str(r), '') or ''),
            'be': corr,
            'cells': {c: cmap[c][r] for c in columns if r in cmap[c]},
        })
    return {'columns': columns, 'rows': rows}


def rename_sample(w, sample, name):
    """FileManager.save_sample_names for one row (an empty name removes it)."""
    names = w.Data.setdefault('SampleNames', {})
    key = str(int(sample))
    name = (name or '').strip()
    if name:
        names[key] = name
    else:
        names.pop(key, None)
    return names
