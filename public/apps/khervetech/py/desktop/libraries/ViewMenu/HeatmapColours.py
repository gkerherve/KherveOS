# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ViewMenu/HeatmapColours.py. Regenerate with tools/export_khervetech.py.
# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
"""The colour ramps KherveFitting offers, everywhere it offers them.

Single source of truth for the Style > HeatMap > Colormap menu, the Style >
3D Waterfall > Colour menu, both of the Preferences dialog's colour combo
boxes, and the AFM channel maps and 3D surfaces. Each of those used to carry
its own hand-written list - the heatmap grouped and named ('Gradient Cyan'),
the waterfall differently grouped and differently named ('Green'), AFM a flat
run of nine raw matplotlib names - so the same ramp had three names and no
two lists offered the same set. There is nothing technique-specific about a
colour ramp, so there is one list.

``Map3DWaterfall`` re-exports these groups and appends the one entry that is
genuinely waterfall-only (its flat CasaXPS grey fill, which is not a ramp).

Entries are validated against matplotlib at import, so a ramp a given version
does not ship never appears rather than failing when it is picked.
"""

import matplotlib

_GROUPS_RAW = (
    ("Gradient", (
        ("Gradient Blue", 'Blues'), ("Gradient Green", 'Greens'),
        ("Gradient Red", 'Reds'), ("Gradient Purple", 'Purples'),
        ("Gradient Pink", 'RdPu'), ("Gradient Orange", 'Oranges'),
        ("Gradient Yellow", 'YlOrBr'), ("Gradient Brown", 'copper'),
        ("Gradient Grey", 'Greys'), ("Gradient Dark Grey", 'gray'),
        ("Gradient Black", 'binary'), ("Gradient Cyan", 'GnBu'),
    )),
    ("Multi Hue", (
        ("Yellow-Green", 'YlGn'), ("Yellow-Green-Blue", 'YlGnBu'),
        ("Yellow-Orange-Red", 'YlOrRd'), ("Blue-Green", 'BuGn'),
        ("Blue-Purple", 'BuPu'), ("Green-Blue", 'GnBu'),
        ("Purple-Blue", 'PuBu'), ("Purple-Blue-Green", 'PuBuGn'),
        ("Purple-Red", 'PuRd'), ("Orange-Red", 'OrRd'),
    )),
    ("Sequential", (
        ("Viridis", 'viridis'), ("Plasma", 'plasma'), ("Inferno", 'inferno'),
        ("Magma", 'magma'), ("Cividis", 'cividis'), ("Twilight", 'twilight'),
        ("Turbo", 'turbo'), ("Cubehelix", 'cubehelix'),
    )),
    ("Diverging", (
        ("Red-Blue", 'RdBu'), ("Red-Yellow-Blue", 'RdYlBu'),
        ("Cool-Warm", 'coolwarm'), ("Blue-White-Red", 'bwr'),
        ("Seismic", 'seismic'), ("Pink-Green", 'PiYG'),
        ("Purple-Green", 'PRGn'), ("Spectral", 'Spectral'),
        ("Brown-Teal", 'BrBG'),
    )),
    # The ramps a scanning-probe or electron micrograph is conventionally
    # rendered with: gold relief for topography, earth tones for a landscape
    # reading of one.
    ("Topography", (
        ("AFM Gold", 'afmhot'), ("Gist Heat", 'gist_heat'),
        ("Earth", 'gist_earth'), ("Terrain", 'terrain'),
        ("Ocean", 'ocean'), ("Sepia", 'pink'),
    )),
    ("Qualitative", (
        ("Tab10", 'tab10'), ("Set1", 'Set1'), ("Set2", 'Set2'),
        ("Set3", 'Set3'), ("Paired", 'Paired'), ("Accent", 'Accent'),
    )),
    ("Other", (
        ("Jet", 'jet'), ("Hot", 'hot'), ("Cool", 'cool'),
        ("Spring", 'spring'), ("Summer", 'summer'), ("Autumn", 'autumn'),
        ("Winter", 'winter'), ("Bone", 'bone'), ("Copper", 'copper'),
        ("Rainbow", 'rainbow'), ("Nipy Spectral", 'nipy_spectral'),
    )),
    # Every matplotlib ramp has a '_r' twin, but listing all of them would
    # double a menu nobody could then read. These are the ones actually asked
    # for - dark-ground topography, and the reversed diverging maps an AFM
    # potential or phase channel defaults to.
    ("Reversed", (
        ("Red-Blue", 'RdBu_r'), ("Cool-Warm", 'coolwarm_r'),
        ("Spectral", 'Spectral_r'), ("AFM Gold", 'afmhot_r'),
        ("Viridis", 'viridis_r'), ("Plasma", 'plasma_r'),
        ("Inferno", 'inferno_r'), ("Magma", 'magma_r'),
        ("Grey", 'Greys_r'), ("Dark Grey", 'gray_r'),
        ("Blue", 'Blues_r'), ("Brown", 'copper_r'),
    )),
)


def _available(name):
    try:
        return name in matplotlib.colormaps
    except Exception:
        return True


CMAP_GROUPS = tuple(
    (group, tuple((label, value) for label, value in entries
                  if _available(value)))
    for group, entries in _GROUPS_RAW)
CMAP_GROUPS = tuple((g, e) for g, e in CMAP_GROUPS if e)

# Flat list of ramp names in menu order, for callers that only need the values.
CMAPS = [value for _g, entries in CMAP_GROUPS for _l, value in entries]


def display_label(group, label):
    """How an entry reads in a flat list, which cannot show the grouping.

    The Gradient labels already carry their group, so only the rest are
    prefixed - 'Gradient Blue', but 'Sequential - Viridis'.
    """
    return label if label.startswith(group) else f"{group} - {label}"


# label shown in a flat combo box <-> matplotlib name. First entry wins, so a
# ramp listed twice (copper is both 'Gradient Brown' and 'Copper') maps back to
# the name it is most likely to have been picked by.
CMAP_LABELS = [display_label(g, l) for g, entries in CMAP_GROUPS
               for l, _v in entries]
CMAP_BY_LABEL = {display_label(g, l): v
                 for g, entries in CMAP_GROUPS for l, v in entries}
CMAP_LABEL_OF = {}
for _g, _entries in CMAP_GROUPS:
    for _l, _v in _entries:
        CMAP_LABEL_OF.setdefault(_v, display_label(_g, _l))
