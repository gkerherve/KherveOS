# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/AFM_Plot.py. Regenerate with tools/export_khervetech.py.
"""
Drawing an AFM sheet on KherveFitting's main canvas.

An AFM channel map is a *quantitative* image — every pixel is a height in
nm, a phase in degrees, a current in nA — so unlike the SEM/TEM greyscale
micrographs it is drawn with a colour map and a colour key naming the unit,
standing beside the image where it covers no data. Everything else follows
the SEM renderer: the image replaces the whole axes content, the extent is
physical (µm or nm), and a 1/2/5 scale bar in the corner stays true through
zooming.

The colour key is an inset *placed outside* the axes rather than a real
``colorbar()``, for the same reason the TEM scalar maps use one: a colorbar
takes its space out of the parent axes, and on a canvas redrawn per
measurement that walks the image smaller and smaller. An inset costs the
image nothing and still follows the box ``aspect='equal'`` leaves it in.
"""

import numpy as np

from libraries.FileMenu.AFM_Import import (AFM_3D_DEFAULTS, afm_array,
                                           afm_extent)

BRAND = (79 / 255, 190 / 255, 159 / 255)

# Length of the scale bar as a fraction of the visible image width, before
# snapping to the nearest 1/2/5 value.
_TARGET_BAR_FRACTION = 0.2
_SCALE_BAR_TAG = '_afm_scale_bar'

# Default colour map per channel flavour. Copper for topography — the brown
# ramp an SPM height map is conventionally read in, and the one every AFM
# package opens with — diverging for signals that swing about zero,
# sequential otherwise.
_CMAP_BY_UNIT = {'nm': 'copper', 'deg': 'inferno', 'V': 'RdBu_r',
                 'nA': 'viridis', 'nN': 'viridis', 'Hz': 'viridis'}

# How far below the lowest pixel the 3D view's base sits, as a fraction of the
# height range — the depth of the slab the surface stands on.
_PEDESTAL = 0.18


def is_afm_sheet(window, sheet_name):
    """True when the named sheet holds an AFM map (by flag, not by name)."""
    if not sheet_name:
        return False
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    return bool(isinstance(sheet, dict) and sheet.get('_afm'))


def is_afm_3d_sheet(window, sheet_name):
    """True for an 'AFM~3D' surface sheet (drawn on a 3D axes, not imshow)."""
    if not sheet_name:
        return False
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    return bool(isinstance(sheet, dict) and sheet.get('_afm_kind') == '3d')


def afm_cmap(sheet, window=None):
    """The colour map an AFM sheet should be drawn with.

    Four steps, most specific first:

    1. the ramp set on this sheet (AFM Analysis > Channels), which is a
       deliberate per-sheet choice and always wins;
    2. the heatmap's ramp, while Style > AFM > 'Use the HeatMap colour map'
       is ticked - so one setting colours every image in the project;
    3. the AFM ramp set in its place;
    4. the per-channel default - gold for a height map, inferno for phase,
       diverging for a potential - which is what 'auto' means.
    """
    stored = sheet.get('AFM_Scalar_CMap')
    if stored:
        return str(stored)
    if window is not None:
        if getattr(window, 'afm_follow_heatmap', False):
            shared = getattr(window, 'heatmap_colormap', None)
            if shared:
                return str(shared)
        else:
            chosen = getattr(window, 'afm_colormap', 'auto')
            if chosen and chosen != 'auto':
                return str(chosen)
    channel = str(sheet.get('AFM_Channel', '')).lower()
    if 'phase' in channel:
        return 'inferno'
    if 'potential' in channel or 'bias' in channel:
        return 'RdBu_r'
    if 'current' in channel or 'cur' == channel[:3]:
        return 'viridis'
    return _CMAP_BY_UNIT.get(str(sheet.get('AFM_Units', '')), 'copper')


# ---------------------------------------------------------------------------
# Scale bar (same conventions as the SEM/TEM renderers)
# ---------------------------------------------------------------------------

def _nice_bar_length(span):
    """A 1/2/5-sequence length close to ``_TARGET_BAR_FRACTION`` of ``span``."""
    target = span * _TARGET_BAR_FRACTION
    if target <= 0:
        return 0.0
    decade = 10.0 ** np.floor(np.log10(target))
    for step in (1.0, 2.0, 5.0, 10.0):
        if target <= step * decade:
            return step * decade
    return 10.0 * decade


def _format_length(value, unit):
    """Render a bar length with the unit that keeps it readable."""
    if unit == 'px':
        return f'{value:g} px'
    if unit == 'µm' and value < 1.0:
        return f'{value * 1000:g} nm'
    if unit == 'nm' and value >= 1000.0:
        return f'{value / 1000:g} µm'
    return f'{value:g} {unit}'


def scale_bar_position(sheet):
    """Where the scale bar sits, in axes fractions — draggable, so stored."""
    stored = sheet.get('AFM_ScaleBar_Pos')
    if stored and len(stored) == 2:
        return float(stored[0]), float(stored[1])
    return 0.05, 0.055


def draw_scale_bar(ax, sheet, colour='white'):
    """Overlay the scale bar on the visible image.

    Positioned in axes-fraction coordinates so it stays put whatever the zoom;
    only its *length* is derived from the visible width. No backing panel: a
    translucent black slab is a hole in the picture, and the bar reads against
    any colour map with an outline round it instead — which is also what makes
    it printable on a light ramp.
    """
    extent, unit = afm_extent(sheet)
    if extent is None:
        return
    x_lo, x_hi = ax.get_xlim()
    visible = abs(x_hi - x_lo)
    if visible <= 0:
        return
    bar = _nice_bar_length(visible)
    if bar <= 0:
        return
    span = bar / visible
    if not 0 < span <= 0.9:
        return

    from matplotlib import patheffects
    x0, y0 = scale_bar_position(sheet)
    height = 0.016
    outline = [patheffects.withStroke(linewidth=2.6, foreground='black')]
    body = _rect(x0, y0, span, height, facecolor=colour, edgecolor='black',
                 linewidth=0.8, zorder=9, transform=ax.transAxes)
    ax.add_patch(body)
    label = ax.text(x0 + span / 2.0, y0 + height + 0.018,
                    _format_length(bar, unit),
                    color=colour, ha='center', va='bottom',
                    fontsize=float(sheet.get('AFM_ScaleBar_Size') or 10),
                    fontweight='bold', zorder=9, transform=ax.transAxes)
    label.set_path_effects(outline)
    for artist in (body, label):
        setattr(artist, _SCALE_BAR_TAG, True)
    body._afm_bar_span = (span, height)


def clear_scale_bar(ax):
    """Remove a previously drawn scale bar for redrawing on a new view."""
    for artist in list(ax.patches) + list(ax.texts):
        if getattr(artist, _SCALE_BAR_TAG, False):
            try:
                artist.remove()
            except (ValueError, NotImplementedError):
                pass


def _rect(x, y, width, height, **kwargs):
    from matplotlib.patches import Rectangle
    return Rectangle((x, y), width, height, **kwargs)


# ---------------------------------------------------------------------------
# Colour key
# ---------------------------------------------------------------------------

def draw_afm_colorbar(ax, sheet, image, inside=False):
    """Colour key naming the channel's unit, beside the image.

    An ``inset_axes`` rather than a real ``colorbar()`` for the same reason
    the TEM scalar maps use one: a colorbar takes its space out of the parent
    axes, and on a canvas redrawn per measurement that walks the image smaller
    and smaller. Placed *outside* the axes (x > 1 in axes fractions) it costs
    the image nothing, and because an inset follows the parent's box it stays
    against the image edge that ``aspect='equal'`` leaves it at, whatever the
    scan's shape.

    ``inside`` puts it back over the image, for the small companion preview
    where there is no room beside it.

    Tick decimals follow the *range*, not the values: a height map spanning
    817–916 nm needs no decimals at all, a 0.10–0.14 V potential map needs
    three.
    """
    from matplotlib.ticker import FuncFormatter

    unit = str(sheet.get('AFM_Units', '') or '')
    colour = 'white' if inside else 'black'
    if inside:
        ax.add_patch(_rect(0.74, 0.05, 0.25, 0.40, facecolor='black',
                           alpha=0.5, edgecolor='none', zorder=8,
                           transform=ax.transAxes))
        rect = [0.945, 0.08, 0.028, 0.30]
    else:
        rect = [1.025, 0.10, 0.030, 0.80]
    cax = ax.inset_axes(rect)
    cax._afm_cax = True
    cax.set_zorder(9)
    bar = ax.get_figure().colorbar(image, cax=cax)

    low, high = image.get_clim()
    span = float(high) - float(low)
    decimals = (0 if span <= 0 else
                int(np.clip(np.ceil(-np.log10(span / 4.0)) + 1, 0, 5)))
    bar.ax.yaxis.set_major_formatter(
        FuncFormatter(lambda v, _pos: f'{v:.{decimals}f}'))

    bar.outline.set_edgecolor(colour)
    cax.yaxis.set_ticks_position('left' if inside else 'right')
    cax.tick_params(colors=colour, labelsize=7.5)
    for spine in cax.spines.values():
        spine.set_edgecolor(colour)
    if unit:
        cax.set_title(unit, color=colour, fontsize=8.5, pad=5)
    return bar


def _clear_afm_colorbars(ax):
    """Drop the colour-key inset a previous AFM draw left behind.

    ``ax.clear()`` empties the main axes but leaves its child insets alone,
    so without this every redraw stacks another key in the same spot.
    """
    children = getattr(ax, 'child_axes', None)
    if not children:
        return
    for child in list(children):
        if not getattr(child, '_afm_cax', False):
            continue
        try:
            child.remove()
        except Exception:
            pass
        try:
            children.remove(child)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Overlays
# ---------------------------------------------------------------------------

def draw_profile_artists(ax, p0, p1, x_scale, y_scale, width_px=1,
                         handles=True):
    """Draw one profile line in the shared high-contrast style.

    A single red hairline disappears on the gold height maps, so the line is
    a white stroke over a black casing — readable on any colour map — with
    circular end handles (the grab targets of the editor) and, when the
    averaging width is more than one pixel, a translucent band showing
    exactly which pixels enter the average. Returns the artists so a live
    editor can remove just these.
    """
    x0, y0 = p0[0] * x_scale, p0[1] * y_scale
    x1, y1 = p1[0] * x_scale, p1[1] * y_scale
    artists = []
    if width_px > 1:
        length = np.hypot(p1[0] - p0[0], p1[1] - p0[1])
        if length > 0:
            from matplotlib.patches import Polygon
            nx = -(p1[1] - p0[1]) / length
            ny = (p1[0] - p0[0]) / length
            half = width_px / 2.0
            corners = [((p0[0] + nx * half) * x_scale, (p0[1] + ny * half) * y_scale),
                       ((p1[0] + nx * half) * x_scale, (p1[1] + ny * half) * y_scale),
                       ((p1[0] - nx * half) * x_scale, (p1[1] - ny * half) * y_scale),
                       ((p0[0] - nx * half) * x_scale, (p0[1] - ny * half) * y_scale)]
            band = Polygon(corners, closed=True, facecolor='white',
                           alpha=0.20, edgecolor='none', zorder=9)
            ax.add_patch(band)
            artists.append(band)
    casing, = ax.plot([x0, x1], [y0, y1], '-', color='black', lw=3.2,
                      alpha=0.85, zorder=10, solid_capstyle='round')
    stroke, = ax.plot([x0, x1], [y0, y1], '-', color='white', lw=1.5,
                      zorder=11, solid_capstyle='round')
    artists += [casing, stroke]
    if handles:
        ends, = ax.plot([x0, x1], [y0, y1], 'o', ms=7, zorder=12,
                        markerfacecolor='white', markeredgecolor='black',
                        markeredgewidth=1.2, linestyle='none')
        artists.append(ends)
    return artists


def afm_px_scale(sheet):
    """(x, y) data units per pixel of the *displayed* image, or None.

    Every overlay is stored in pixels of the displayed (cropped) image and
    drawn in the axes' physical units, so this one conversion is what keeps
    the profile line, the regions and the mouse handlers agreeing.
    """
    from libraries.FileMenu.AFM_Import import afm_shape
    shape = afm_shape(sheet)
    extent, _unit = afm_extent(sheet)
    if shape is None or extent is None:
        return None
    return (abs(extent[1] - extent[0]) / shape[1],
            abs(extent[2] - extent[3]) / shape[0])


def draw_afm_rois(ax, sheet):
    """Outline the regions the analyses are restricted to.

    Include regions are filled — that is the part being measured; exclude
    regions are drawn dashed and hollow, because what matters about them is
    their outline, not their contents.
    """
    from matplotlib.patches import Circle, Polygon, Rectangle

    rois = sheet.get('AFM_ROIs') or []
    scale = afm_px_scale(sheet)
    if not rois or scale is None:
        return
    sx, sy = scale
    active = sheet.get('_afm_roi_active')
    for index, roi in enumerate(rois):
        if not isinstance(roi, dict):
            continue
        exclude = roi.get('mode') == 'exclude'
        colour = 'crimson' if exclude else BRAND
        # A light wash, not a coat of paint: the region has to be obvious
        # without hiding the surface it was drawn around. The one selected in
        # the list is drawn heavier, so "which of these am I about to drag"
        # is answered on the map rather than by counting down the list.
        selected = active is not None and index == active
        style = dict(edgecolor='yellow' if selected else colour,
                     linewidth=2.4 if selected else 1.6, zorder=6,
                     linestyle='--' if exclude else '-',
                     facecolor='none' if exclude else colour,
                     alpha=1.0 if exclude else 0.18)
        points = [float(v) for v in (roi.get('points') or [])]
        kind = roi.get('shape')
        if kind == 'rect' and len(points) >= 4:
            x0, y0, x1, y1 = points[:4]
            ax.add_patch(Rectangle((min(x0, x1) * sx, min(y0, y1) * sy),
                                   abs(x1 - x0) * sx, abs(y1 - y0) * sy,
                                   **style))
        elif kind == 'circle' and len(points) >= 3:
            cx, cy, radius = points[:3]
            # Physical pixels are square on every AFM scan this tool reads,
            # so one radius is enough; sx is the one the scale bar uses.
            ax.add_patch(Circle((cx * sx, cy * sy), abs(radius) * sx, **style))
        elif kind == 'polygon' and len(points) >= 6:
            pairs = np.asarray(points, dtype=float).reshape(-1, 2)
            pairs = pairs * np.array([sx, sy])
            ax.add_patch(Polygon(pairs, closed=True, **style))


def draw_profile_line(ax, sheet):
    """Draw the profile lines the tool has set.

    Every line in the list is drawn thin and numbered; the selected one is
    drawn in full, with its averaging band — a map usually carries several
    sections and the one being measured has to be obvious among them.
    """
    line = sheet.get('AFM_Profile_Line')
    if not line or len(line) < 4:
        return
    scale = afm_px_scale(sheet)
    if scale is None:
        return
    x_scale, y_scale = scale

    others = sheet.get('AFM_Profile_Lines') or []
    active = int(sheet.get('AFM_Profile_Active') or 0)
    for index, item in enumerate(others):
        if index == active or not isinstance(item, dict):
            continue
        points = [float(v) for v in (item.get('points') or [])[:4]]
        if len(points) < 4:
            continue
        ax.plot([points[0] * x_scale, points[2] * x_scale],
                [points[1] * y_scale, points[3] * y_scale],
                color='white', lw=1.0, alpha=0.75, zorder=8)
        ax.text((points[0] + points[2]) / 2.0 * x_scale,
                (points[1] + points[3]) / 2.0 * y_scale, str(index + 1),
                color='white', fontsize=7, ha='center', va='center',
                zorder=9,
                bbox=dict(facecolor='black', alpha=0.5, pad=1,
                          edgecolor='none'))

    x0, y0, x1, y1 = (float(v) for v in line[:4])
    width = max(1, int(sheet.get('AFM_Profile_Width') or 1))
    draw_profile_artists(ax, (x0, y0), (x1, y1), x_scale, y_scale, width)


def _draw_sheet_labels(window, sheet, ax):
    """Draw the sheet's Labels Manager entries on the map.

    Image sheets never reach the generic label-drawing loop, so without this
    a text annotation added to an AFM sheet would be stored but never shown.
    """
    labels = sheet.get('Labels')
    if not labels:
        return
    try:
        from libraries.ViewMenu.Labels_Screen import (_draw_label_data_on_ax,
                                                      _remove_all_drawing_artists)
    except Exception:
        return
    _remove_all_drawing_artists(ax)
    for entry in labels:
        if entry.get('text') == 'Table' and entry.get('is_table'):
            continue
        try:
            _draw_label_data_on_ax(ax, entry,
                                   getattr(window, 'label_font_size', 10), window)
        except Exception as e:
            print(f'Label draw skipped: {e}')


def afm_clim(sheet):
    """(vmin, vmax) for the display, from the contrast set on the histogram.

    A height map is quantitative, so "contrast" here is a *display range* in
    the channel's own unit rather than a brightness/gain pair: the black and
    white points dragged on the companion histogram are the two values the
    colour map is stretched between. None means the full range of the data.
    """
    span = sheet.get('AFM_Display_Range')
    if not span or len(span) != 2:
        return None, None
    low, high = float(min(span)), float(max(span))
    return (low, high) if high > low else (None, None)


def draw_afm_particles(ax, sheet):
    """Outline detected particles, when the Particles tab has stored them.

    One RGBA image rather than a contour per particle: a grain field runs to
    thousands, and thousands of line artists make panning unusable — the same
    reason the SEM overlay is drawn this way.
    """
    from libraries.FileMenu.AFM_Import import afm_array, afm_extent

    overlay = sheet.get('_afm_overlay')
    if overlay is None:
        return
    overlay = np.asarray(overlay, dtype=bool)
    array = afm_array(sheet)
    extent, _unit = afm_extent(sheet)
    if array is None or extent is None or overlay.shape != array.shape[:2]:
        return
    rgba = np.zeros(overlay.shape + (4,), dtype=float)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 1.0, 0.15, 0.15
    rgba[..., 3] = overlay.astype(float)
    ax.imshow(rgba, extent=extent, origin='upper', aspect='equal',
              interpolation='nearest', zorder=7)


_ROUGHNESS_TAG = '_afm_roughness_text'


def clear_roughness_overlay(ax):
    """Remove a previously written read-out, so a redraw does not stack them.

    ``draw_afm_extras`` is called on its own for pans and zooms, not only
    after the ``ax.clear()`` in ``plot_afm_image``.
    """
    for artist in list(ax.texts):
        if getattr(artist, _ROUGHNESS_TAG, False):
            try:
                artist.remove()
            except (ValueError, NotImplementedError):
                pass


def draw_roughness_overlay(ax, sheet):
    """Write the roughness numbers on the image they describe.

    Off unless asked for, and only what was ticked — the point of putting
    them on the picture is a figure that needs no caption, which a wall of
    twenty parameters would defeat.
    """
    overlay = sheet.get('AFM_Roughness_Overlay') or {}
    stats = sheet.get('AFM_Roughness') or {}
    if not overlay.get('show') or not stats:
        return
    unit = str(sheet.get('AFM_Units', '') or '')
    lines = []
    for key in (overlay.get('keys') or ('Sa', 'Sq', 'Sz')):
        value = stats.get(key)
        if value is None or not np.isfinite(value):
            continue
        suffix = '' if key in ('Ssk', 'Sku') else (' %' if key == 'Sdr'
                                                  else f' {unit}')
        lines.append(f'{key} = {value:.4g}{suffix}'.rstrip())
    if not lines:
        return
    text = ax.text(0.025, 0.975, '\n'.join(lines), transform=ax.transAxes,
                   ha='left', va='top', zorder=10, linespacing=1.35,
                   fontsize=float(overlay.get('size') or 9),
                   color='black',
                   bbox=dict(facecolor='white', alpha=0.78, edgecolor='black',
                             linewidth=0.6, boxstyle='round,pad=0.35'))
    setattr(text, _ROUGHNESS_TAG, True)


def draw_afm_extras(window, sheet_name):
    """Redraw every overlay that sits on top of the map.

    Safe to call for any sheet — returns immediately for non-AFM ones.
    """
    if not is_afm_sheet(window, sheet_name) or is_afm_3d_sheet(window, sheet_name):
        return
    sheet = window.Data['Core levels'][sheet_name]
    ax = window.plot_manager.ax
    draw_afm_particles(ax, sheet)
    draw_afm_rois(ax, sheet)
    # While any AFM window's line editor is live, that window draws the line
    # (as its editable preview); drawing the stored copy too would leave a
    # stale line behind the one being dragged.
    live = any(getattr(tool, '_line_live', False)
               for tool in getattr(window, '_afm_windows', []))
    if not live:
        draw_profile_line(ax, sheet)
    _draw_sheet_labels(window, sheet, ax)
    clear_roughness_overlay(ax)
    draw_roughness_overlay(ax, sheet)
    clear_scale_bar(ax)
    draw_scale_bar(ax, sheet)


# ---------------------------------------------------------------------------
# The 3D surface ('AFM~3D')
#
# A height map is relief, and relief is what a surface shows: the same array
# the 2D map draws, lifted into z and hill-shaded. The view is stored on the
# sheet (``AFM_3D``) rather than held in the tool window, so the angle a user
# rotates to is the angle the project reopens at.
# ---------------------------------------------------------------------------

def _clean_3d_axes(ax3):
    """Strip the grey panes and gridlines so the box reads like a paper figure.

    Same furniture as ``ARPES_3D._clean_3d_axes`` — the two 3D views on the
    main canvas should not look like they came from different programs.
    """
    try:
        ax3.grid(False)
    except Exception:
        pass
    for axis in (ax3.xaxis, ax3.yaxis, ax3.zaxis):
        try:
            axis.set_pane_color((1.0, 1.0, 1.0, 0.0))
        except Exception:
            pass
        try:
            axis._axinfo['grid']['linewidth'] = 0.0
            axis._axinfo['grid']['color'] = (1, 1, 1, 0)
        except Exception:
            pass


# The four skirt walls, lit as an SPM renderer lights them: the two facing
# along x catch the light, the two facing along y fall into shadow.
_SKIRT_COLOURS = {'x': '0.78', 'y': '0.42'}


def _draw_3d_skirt(ax3, grid_x, grid_y, z, z_base):
    """Close the sides of the surface down to the base plane.

    Without them the surface floats over its own frame with daylight beneath
    it; with them it stands on a slab, which is the whole point of the base
    rectangle and the corner posts.
    """
    walls = (('y', grid_x[0, :], np.full(z.shape[1], grid_y[0, 0]), z[0, :]),
             ('y', grid_x[-1, :], np.full(z.shape[1], grid_y[-1, 0]), z[-1, :]),
             ('x', np.full(z.shape[0], grid_x[0, 0]), grid_y[:, 0], z[:, 0]),
             ('x', np.full(z.shape[0], grid_x[0, -1]), grid_y[:, -1], z[:, -1]))
    for facing, xs, ys, top in walls:
        ax3.plot_surface(np.vstack([xs, xs]), np.vstack([ys, ys]),
                         np.vstack([np.full_like(top, z_base), top]),
                         color=_SKIRT_COLOURS[facing], shade=False,
                         linewidth=0, antialiased=False)


def _draw_3d_frame(ax3, xlim, ylim, z_lo, corner_z, colour='black', width=1.7):
    """The open box an SPM surface stands in — the ARPES cube without its lid.

    An ARPES cube is a closed volume, so it is framed by all twelve edges. A
    height map has nothing above it: a lid would enclose empty air, and posts
    carried up to it would float past the surface. What is left is the base
    rectangle and four corner posts, each rising only as far as the surface
    does at its corner — so the frame follows the data rather than boxing it
    in, the way an SPM renderer draws its pedestal.

    ``corner_z[i][j]`` is that height at (xlim[i], ylim[j]). Edges are culled
    to the front-facing faces and drawn at the weight of
    ``ARPES_3D._draw_edges``, so the pedestal reads as solid rather than as a
    wireframe.
    """
    limits = (tuple(xlim), tuple(ylim))
    elev, azim = np.radians(ax3.elev), np.radians(ax3.azim)
    camera = np.array([np.cos(elev) * np.cos(azim),
                       np.cos(elev) * np.sin(azim), np.sin(elev)])
    # The base is only ever front-facing when the view is from below.
    base_front = -camera[2] > 0

    def side_front(axis, is_high):
        return (camera[axis] if is_high else -camera[axis]) > 0

    def seg(start, end):
        ax3.plot(*zip(start, end), color=colour, lw=width,
                 solid_capstyle='round', zorder=30)

    for along in (0, 1):                       # the base rectangle
        across = 1 - along
        for j, value in enumerate(limits[across]):
            if not (side_front(across, j) or base_front):
                continue
            start, end = [0.0, 0.0, z_lo], [0.0, 0.0, z_lo]
            start[across] = end[across] = value
            start[along], end[along] = limits[along]
            seg(start, end)

    for i, x in enumerate(limits[0]):          # the corner posts
        for j, y in enumerate(limits[1]):
            if not (side_front(0, i) or side_front(1, j)):
                continue
            seg((x, y, z_lo), (x, y, float(corner_z[i][j])))


def afm_3d_view(sheet):
    """The sheet's stored 3D options, filled out with the defaults."""
    view = dict(AFM_3D_DEFAULTS)
    stored = sheet.get('AFM_3D')
    if isinstance(stored, dict):
        view.update({k: v for k, v in stored.items() if v is not None})
    return view


def afm_3d_source(levels, sheet):
    """(source sheet, leveled array) an 'AFM~3D' sheet should be drawn from.

    The live source channel when it is still in the project — so leveling and
    recalibration reach the surface for free — and the copy carried on the 3D
    sheet itself when it is not.
    """
    name = afm_3d_view(sheet).get('source') or sheet.get('AFM_Source_Sheet')
    source = (levels or {}).get(name)
    if isinstance(source, dict) and source.get('_afm_image') is not None:
        return source, afm_array(source)
    return sheet, afm_array(sheet)


def draw_afm_surface(ax3, levels, sheet_name, window=None):
    """Draw an 'AFM~3D' sheet onto any 3D axes. True when something was drawn.

    Takes the Core-levels mapping rather than the window: the same routine
    draws the main canvas, the right-frame companion, and the throwaway view
    of a channel that has no 3D sheet of its own.
    """
    import matplotlib.pyplot as plt
    from matplotlib.colors import LightSource
    from matplotlib.ticker import MaxNLocator

    sheet = (levels or {}).get(sheet_name, {})
    source, array = afm_3d_source(levels, sheet)
    ax3.clear()
    if array is None or np.asarray(array).ndim != 2:
        ax3.set_axis_off()
        ax3.text2D(0.5, 0.5, 'No height map to render in 3D',
                   ha='center', va='center', transform=ax3.transAxes,
                   fontsize=9, color='gray')
        return False

    array = np.asarray(array, dtype=float)
    view = afm_3d_view(sheet)

    # Decimate before rendering. A 512 x 512 scan is a quarter of a million
    # quads, and matplotlib's 3D renderer depth-sorts every one of them on
    # every rotation; the relief is legible long before that.
    mesh = int(np.clip(view.get('mesh') or 200, 32, 512))
    step_y = max(1, int(np.ceil(array.shape[0] / mesh)))
    step_x = max(1, int(np.ceil(array.shape[1] / mesh)))
    # Image row 0 is the top of the frame (origin='upper'), which is the far
    # edge of the surface — flip so the 3D view and the 2D map agree.
    z = array[::step_y, ::step_x][::-1]

    extent, unit = afm_extent(source)
    if extent is None:
        width, height = float(z.shape[1]), float(z.shape[0])
    else:
        width = abs(extent[1] - extent[0])
        height = abs(extent[2] - extent[3])
    grid_x, grid_y = np.meshgrid(np.linspace(0.0, width, z.shape[1]),
                                 np.linspace(0.0, height, z.shape[0]))

    name = str(view.get('cmap') or 'auto')
    cmap = plt.get_cmap(afm_cmap(source, window) if name == 'auto' else name)
    zscale = float(view.get('zscale') or 1.0)
    filled = np.nan_to_num(z, nan=float(np.nanmin(z)) if np.isfinite(z).any()
                           else 0.0)
    if view.get('shade', True):
        # Hill shading is what makes a height map read as a surface rather
        # than a coloured sheet; vert_exag is in data units, so it has to be
        # derived from the aspect the box is actually drawn at.
        span = float(np.ptp(filled)) or 1.0
        exag = (max(width, height) / span) * 0.12 * zscale
        colours = LightSource(azdeg=315, altdeg=55).shade(
            filled, cmap=cmap, vert_exag=exag, blend_mode='soft')
        ax3.plot_surface(grid_x, grid_y, filled, facecolors=colours,
                         rstride=1, cstride=1, linewidth=0,
                         antialiased=False, shade=False)
    else:
        ax3.plot_surface(grid_x, grid_y, filled, cmap=cmap, rstride=1,
                         cstride=1, linewidth=0, antialiased=False,
                         shade=False)

    ax3.set_box_aspect((1.0, (height / width) if width else 1.0,
                        0.35 * max(zscale, 0.05)))
    ax3.view_init(elev=float(view.get('elev', 45.0)),
                  azim=float(view.get('azim', -60.0)))

    # Same furniture as the ARPES cube: no grey panes, no gridlines, and a
    # crisp black frame in their place. The view has to be set first — the
    # edge culling is done against the camera direction.
    z_lo, z_hi = float(np.nanmin(filled)), float(np.nanmax(filled))
    if z_hi <= z_lo:
        z_hi = z_lo + 1.0
    # The base sits below the lowest pixel so the surface stands on a slab,
    # the way an SPM renderer draws one: with the floor at the minimum the
    # corner posts would have nothing to span and the frame would collapse to
    # an outline on the ground.
    z_base = z_lo - _PEDESTAL * (z_hi - z_lo)
    ax3.set_xlim(0.0, width)
    ax3.set_ylim(0.0, height)
    ax3.set_zlim(z_base, z_hi)
    _clean_3d_axes(ax3)
    _draw_3d_skirt(ax3, grid_x, grid_y, filled, z_base)
    # filled is indexed [row, column] = [y, x], so the corners transpose.
    _draw_3d_frame(ax3, (0.0, width), (0.0, height), z_base,
                   ((filled[0, 0], filled[-1, 0]),
                    (filled[0, -1], filled[-1, -1])))

    channel = str(source.get('AFM_Channel', '') or 'Value')
    z_unit = str(source.get('AFM_Units', '') or '')
    ax3.set_xlabel(f'X ({unit})', fontsize=9)
    ax3.set_ylabel(f'Y ({unit})', fontsize=9)
    ax3.set_zlabel(f'{channel} ({z_unit})' if z_unit else channel, fontsize=9)
    # A 3D box crowds its ticks — the z axis of a height map carries five-digit
    # nanometre values, and matplotlib's default count runs them together.
    for axis in (ax3.xaxis, ax3.yaxis, ax3.zaxis):
        axis.set_major_locator(MaxNLocator(5))
    ax3.tick_params(labelsize=8)
    return True


def _ensure_3d_rotate_hook(window):
    """Store the angle back on the sheet after an interactive rotation.

    Connected once per session; mplot3d has already redrawn by the time the
    button comes up, so this only records where the user left it.
    """
    if getattr(window, '_afm3d_cid', None) is not None:
        return

    def on_release(_event):
        try:
            name = window.sheet_combobox.GetValue()
            ax3 = getattr(window, '_afm3d_ax', None)
            if not (is_afm_3d_sheet(window, name) and ax3 is not None
                    and ax3 in window.plot_manager.figure.axes):
                return
            sheet = window.Data['Core levels'][name]
            view = afm_3d_view(sheet)
            elev, azim = round(float(ax3.elev), 1), round(float(ax3.azim), 1)
            if (elev, azim) == (view.get('elev'), view.get('azim')):
                return
            view.update({'elev': elev, 'azim': azim})
            sheet['AFM_3D'] = view
            for tool in list(getattr(window, '_afm_windows', [])):
                refresh = getattr(tool, 'refresh_3d_controls', None)
                if refresh is not None:
                    refresh()
        except Exception as e:
            print(f'AFM 3D view not stored: {e}')

    window._afm3d_cid = window.plot_manager.canvas.mpl_connect(
        'button_release_event', on_release)


def plot_afm_surface(window, sheet_name):
    """Render an 'AFM~3D' sheet on the main canvas.

    The main axes is 2D, so the figure is rebuilt with a 3D projection — the
    same trade the ARPES cube makes. ``on_sheet_selected`` puts a flat axes
    back when any other sheet is chosen.
    """
    plot_manager = window.plot_manager
    figure = plot_manager.figure

    ax3 = getattr(window, '_afm3d_ax', None)
    if not (ax3 is not None and ax3 in figure.axes
            and getattr(ax3, 'name', '') == '3d'):
        try:
            _clear_afm_colorbars(plot_manager.ax)
        except Exception:
            pass
        figure.clear()
        ax3 = figure.add_subplot(111, projection='3d')
        window._afm3d_ax = ax3
        plot_manager.ax = ax3
        window.ax = ax3
        plot_manager.residuals_subplot = None
        window.residuals_subplot = None
        window.heatmap_colorbar = None

    # The 3D line waterfall leaves a re-render hook that would repaint its own
    # plot over this one on the next clear_and_replot.
    window._wf = None
    window._wf_render = None
    window.waterfall_on_main = None

    ax3.set_position([0.02, 0.02, 0.96, 0.96])
    draw_afm_surface(ax3, window.Data.get('Core levels', {}), sheet_name,
                     window)
    window.afm_on_main = sheet_name
    _ensure_3d_rotate_hook(window)
    plot_manager.canvas.draw_idle()


def redraw_afm_3d(window, sheet_name=None):
    """Redraw the 3D sheet if it is the one on the main canvas."""
    current = window.sheet_combobox.GetValue()
    if sheet_name is not None and sheet_name != current:
        return
    if is_afm_3d_sheet(window, current):
        plot_afm_surface(window, current)


# ---------------------------------------------------------------------------
# Companion thumbnail
# ---------------------------------------------------------------------------

def _companion_surface(ax, levels, sheet_name, window=None):
    """Draw a 3D surface on the (flat) companion axes.

    The companion figure keeps one 2D axes; a 3D projection has to be a second
    axes laid over it, registered as a companion twin so the panel drops it
    before the next render rather than stacking them up.
    """
    figure = ax.get_figure()
    ax.set_axis_off()
    # Inset from the right: the z tick labels of a height map are five digits
    # wide and a full-bleed axes cuts them off in a panel this narrow.
    ax3 = figure.add_axes([0.0, 0.0, 0.90, 1.0], projection='3d')
    twins = getattr(figure, '_companion_twins', None) or []
    twins.append(ax3)
    figure._companion_twins = twins
    return draw_afm_surface(ax3, levels, sheet_name, window)


def render_afm_surface_companion(ax, window, sheet_name):
    """Companion '3D view': the group's AFM~3D sheet, or the current channel.

    Glancing at the relief of the channel you are working on is the point, so
    a channel with no 3D sheet of its own is rendered with the default view
    rather than showing nothing — from a throwaway sheet, so looking at the
    companion never adds anything to the project.
    """
    from libraries.FileMenu.AFM_Import import make_afm_3d_sheet

    levels = window.Data.get('Core levels', {})
    sheet = levels.get(sheet_name, {})
    ax.clear()
    if not isinstance(sheet, dict):
        return False
    if sheet.get('_afm_kind') != '3d':
        source = sheet.get('AFM_Source_File')
        for name, other in levels.items():
            if (isinstance(other, dict) and other.get('_afm_kind') == '3d'
                    and other.get('AFM_Source_File') == source):
                sheet_name = name
                break
        else:
            if sheet.get('_afm_image') is None:
                return False
            temp_name, temporary = make_afm_3d_sheet(sheet_name, sheet)
            levels = dict(levels)
            levels[temp_name] = temporary
            sheet_name = temp_name
    return _companion_surface(ax, levels, sheet_name, window)


def render_afm_thumbnail(ax, window, sheet_name):
    """Draw an AFM sheet onto any axes (the technique right-frame companion).

    Returns True if something was drawn.
    """
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    ax.clear()
    _clear_afm_colorbars(ax)

    if isinstance(sheet, dict) and sheet.get('_afm_kind') == '3d':
        return _companion_surface(ax, window.Data.get('Core levels', {}),
                                  sheet_name, window)

    if str(sheet_name).startswith('AFM~Profile'):
        x = np.asarray(sheet.get('B.E.') or [], dtype=float)
        y = np.asarray(sheet.get('Raw Data') or [], dtype=float)
        if x.size and x.size == y.size:
            ax.plot(x, y, color=(79 / 255, 190 / 255, 159 / 255), lw=1.0)
            ax.set_xlabel(sheet.get('AFM_X_Label', 'Distance'), fontsize=8)
            ax.set_ylabel(sheet.get('AFM_Y_Label', 'Height'), fontsize=8)
            ax.tick_params(labelsize=7)
            return True
        return False

    array = afm_array(sheet)
    if array is None:
        ax.text(0.5, 0.5, 'No image to preview', ha='center', va='center',
                transform=ax.transAxes, fontsize=9, color='gray')
        ax.set_xticks([])
        ax.set_yticks([])
        return False
    extent, _unit = afm_extent(sheet)
    vmin, vmax = afm_clim(sheet)
    image = ax.imshow(array, cmap=afm_cmap(sheet, window), aspect='equal',
                      origin='upper', extent=extent, interpolation='nearest',
                      vmin=vmin, vmax=vmax)
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(True)
    # The companion axes fills its panel, so the key goes back over the image.
    draw_afm_colorbar(ax, sheet, image, inside=True)
    draw_afm_particles(ax, sheet)
    draw_afm_rois(ax, sheet)
    draw_profile_line(ax, sheet)
    draw_scale_bar(ax, sheet)
    return True


# ---------------------------------------------------------------------------
# Companion computed views (the plots of the AFM Analysis tabs live here, in
# the technique right frame, rather than inside the tool window)
# ---------------------------------------------------------------------------

def _companion_sheet(window, sheet_name):
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    return sheet if isinstance(sheet, dict) else {}


def render_afm_histogram(ax, window, sheet_name):
    """Height histogram of the (leveled) active map, with the contrast on it.

    The two red lines are the display range the map is coloured between —
    drag either one and the image restretches. They live here rather than
    only on the shared 'Histogram (contrast)' view because on a height map
    the histogram *is* the contrast control: the two numbers are heights in
    nm, read off the same axis as the peaks they cut between.
    """
    from libraries.FileMenu.AFM_Import import afm_array
    from libraries.ToolsMenu.AFM_Engine import histogram
    sheet = _companion_sheet(window, sheet_name)
    array = afm_array(sheet)
    ax.clear()
    # The companion axes is full-bleed by default; these plots
    # carry axis labels, so give them margins.
    ax.set_position([0.19, 0.17, 0.77, 0.72])
    if array is None:
        window._afm_hist_state = None
        return False
    centres, counts = histogram(array)
    ax.fill_between(centres, counts, color=(79 / 255, 190 / 255, 159 / 255),
                    alpha=0.85)
    unit = sheet.get('AFM_Units', '')
    ax.set_xlabel(f'Value ({unit})' if unit else 'Value', fontsize=8)
    ax.set_ylabel('Pixels', fontsize=8)
    ax.tick_params(labelsize=7)

    low, high = afm_clim(sheet)
    if low is None:
        low, high = float(np.nanmin(array)), float(np.nanmax(array))
    for value in (low, high):
        ax.axvline(value, color='red', lw=1.4)
    threshold = (sheet.get('AFM_Particles') or {}).get('Threshold')
    if threshold is not None:
        ax.axvline(float(threshold), color='firebrick', lw=1.0, ls='--')
    ax.set_title(f'Contrast: {low:.4g} to {high:.4g} {unit} '
                 '— drag the red lines'.rstrip(), fontsize=7.5)
    # What the mouse hook needs to know to move them.
    window._afm_hist_state = {
        'sheet': sheet_name, 'low': float(low), 'high': float(high),
        'xmin': float(np.nanmin(array)), 'xmax': float(np.nanmax(array))}
    return True


def render_afm_particles(ax, window, sheet_name):
    """Size distribution of the particles counted on the active map."""
    sheet = _companion_sheet(window, sheet_name)
    stats = sheet.get('AFM_Particles') or {}
    diameters = np.asarray(stats.get('Diameters') or [], dtype=float)
    ax.clear()
    # The companion axes is full-bleed by default; these plots
    # carry axis labels, so give them margins.
    ax.set_position([0.19, 0.17, 0.77, 0.72])
    if diameters.size == 0:
        ax.text(0.5, 0.5, 'No particles counted yet\n'
                          '(AFM Analysis > Particles)',
                ha='center', va='center', transform=ax.transAxes,
                fontsize=9, color='gray')
        ax.set_xticks([])
        ax.set_yticks([])
        return False
    from libraries.ToolsMenu.AFM_Engine import gaussian, size_distribution

    unit = stats.get('Size Unit', 'nm')
    watershed = stats.get('Method') == 'watershed'
    centres, counts, _width = size_distribution(diameters)
    ax.bar(centres, counts, width=(centres[1] - centres[0]) if centres.size > 1
           else 1.0, color=BRAND, align='center', edgecolor='black',
           linewidth=0.7)
    ax.axvline(float(np.median(diameters)), color='firebrick', lw=1.0, ls='--')

    title = (f"{stats.get('Count', diameters.size)} grains, "
             f"median {np.median(diameters):.4g} {unit}")
    fit = sheet.get('AFM_Grain_Fit')
    if isinstance(fit, dict) and fit.get('b'):
        # Only over the range it was fitted on: a Gaussian drawn past its
        # fitting range invites reading a number the fit never supported.
        x = np.linspace(float(fit['x_from']), float(fit['x_to']), 200)
        ax.plot(x, gaussian(x, fit['y0'], fit['a'], fit['x0'], fit['b']),
                color='firebrick', lw=1.4)
        ax.axvspan(float(fit['x_from']), float(fit['x_to']),
                   color='mediumorchid', alpha=0.12, zorder=0)
        title = (f"x₀ = {fit['x0']:.4g} {unit}, FWHM {fit['fwhm']:.3g} "
                 f"({stats.get('Count', diameters.size)} grains)")
    ax.set_title(title, fontsize=8)
    ax.set_xlabel(('Equivalent square side' if watershed
                   else 'Equivalent circle diameter') + f' ({unit})',
                  fontsize=8)
    ax.set_ylabel('Grains', fontsize=8)
    ax.tick_params(labelsize=7)
    return True


def render_afm_psd(ax, window, sheet_name):
    """Radially averaged power spectral density of the (leveled) map."""
    from libraries.FileMenu.AFM_Import import afm_array
    from libraries.ToolsMenu.AFM_Engine import psd_radial
    sheet = _companion_sheet(window, sheet_name)
    array = afm_array(sheet)
    ax.clear()
    # The companion axes is full-bleed by default; these plots
    # carry axis labels, so give them margins.
    ax.set_position([0.19, 0.17, 0.77, 0.72])
    if array is None:
        return False
    nm = sheet.get('AFM_NM_Per_Px') or 1.0
    freqs, psd = psd_radial(array, nm)
    ax.loglog(freqs, psd, color=(79 / 255, 190 / 255, 159 / 255), lw=1.0)
    ax.set_xlabel('Spatial frequency (1/nm)', fontsize=8)
    ax.set_ylabel('PSD', fontsize=8)
    ax.tick_params(labelsize=7)
    return True


def render_afm_live_profile(ax, window, sheet_name):
    """The profile under the sheet's current line, live.

    Reads the stored line, so it tracks the editor: every drag rewrites
    ``AFM_Profile_Line`` and refreshes the companion.
    """
    from libraries.FileMenu.AFM_Import import afm_array
    from libraries.ToolsMenu.AFM_Engine import line_profile, profile_roughness
    sheet = _companion_sheet(window, sheet_name)
    line = sheet.get('AFM_Profile_Line')
    array = afm_array(sheet)
    ax.clear()
    # The companion axes is full-bleed by default; these plots
    # carry axis labels, so give them margins.
    ax.set_position([0.19, 0.17, 0.77, 0.72])
    if array is None or not line or len(line) < 4:
        ax.text(0.5, 0.5, 'Draw a profile line on the map\n'
                          '(AFM Analysis > Profile)',
                ha='center', va='center', transform=ax.transAxes,
                fontsize=9, color='gray')
        ax.set_xticks([])
        ax.set_yticks([])
        return False
    width = max(1, int(sheet.get('AFM_Profile_Width') or 1))
    distance_px, values = line_profile(array, line[:2], line[2:4], width)
    nm = sheet.get('AFM_NM_Per_Px')
    if nm:
        distances = distance_px * nm
        x_label = 'Distance (nm)'
        if distances[-1] > 2000.0:
            distances, x_label = distances / 1000.0, 'Distance (µm)'
    else:
        distances, x_label = distance_px, 'Distance (px)'
    unit = sheet.get('AFM_Units', '')
    ax.plot(distances, values, color=(79 / 255, 190 / 255, 159 / 255), lw=1.1)
    stats = profile_roughness(values)
    ax.set_title(f"Ra {stats['Ra']:.3g}  Rq {stats['Rq']:.3g}  "
                 f"Rz {stats['Rz']:.3g} {unit}", fontsize=8)
    ax.set_xlabel(x_label, fontsize=8)
    ax.set_ylabel(f'Value ({unit})' if unit else 'Value', fontsize=8)
    ax.tick_params(labelsize=7)
    draw_cd_overlay(ax, sheet, distances, unit)
    return True


def draw_cd_overlay(ax, sheet, distances, unit=''):
    """Show the critical-dimension measurement on the profile.

    The picked range is shaded, the fitted step drawn over it, and the height
    marked with an arrow between the two levels — the profile is where the
    measurement is read, so it is where the answer belongs.
    """
    from libraries.ToolsMenu.AFM_Engine import cd_model_curve

    picked = sheet.get('AFM_Profile_CD_Range')
    if picked and len(picked) == 2:
        ax.axvspan(min(picked), max(picked), color='mediumorchid', alpha=0.15,
                   zorder=0)
    result = sheet.get('AFM_Profile_CD')
    if not isinstance(result, dict):
        return
    model = cd_model_curve(distances, result)
    if model is None:
        return
    inside = ((distances >= float(result.get('x_from', distances[0])))
              & (distances <= float(result.get('x_to', distances[-1]))))
    ax.plot(distances[inside], model[inside], color='firebrick', lw=1.1,
            zorder=3)
    x1, x2 = result.get('x1'), result.get('x2')
    marker = float(x1) if x2 is None else 0.5 * (float(x1) + float(x2))
    ax.annotate('', xy=(marker, result['y2']), xytext=(marker, result['y1']),
                arrowprops=dict(arrowstyle='<->', color='firebrick', lw=1.0))
    # Beside the middle of the arrow, not above it: at the top of the feature
    # the label would run into the axes edge on a tall step.
    ax.text(marker, 0.5 * (result['y1'] + result['y2']),
            f" h = {result['h']:.4g} {unit}".rstrip(),
            color='firebrick', fontsize=7.5, ha='left', va='center')
    for edge in (x1, x2):
        if edge is not None:
            ax.axvline(float(edge), color='firebrick', lw=0.7, ls=':',
                       zorder=2)


def _afm_histogram_mouse(window, event, kind):
    """Drag the red contrast lines on the height histogram."""
    from libraries.FileMenu.AFM_Import import afm_array

    state = getattr(window, '_afm_hist_state', None)
    if not state:
        return False
    if kind == 'press':
        if event.button != 1 or event.xdata is None:
            return False
        # Grab whichever line the click is nearer, in data units — the axes
        # is redrawn constantly, so pixel positions of old artists are stale.
        span = max(state['xmax'] - state['xmin'], 1e-12)
        near = min(('low', 'high'),
                   key=lambda k: abs(state[k] - float(event.xdata)))
        if abs(state[near] - float(event.xdata)) > 0.12 * span:
            return False
        window._afm_hist_grab = near
        return False
    grab = getattr(window, '_afm_hist_grab', None)
    if grab is None or event.xdata is None:
        return False
    value = float(np.clip(event.xdata, state['xmin'], state['xmax']))
    low, high = state['low'], state['high']
    if grab == 'low':
        low = min(value, high - 1e-9)
    else:
        high = max(value, low + 1e-9)
    sheet = window.Data.get('Core levels', {}).get(state['sheet'], {})
    array = afm_array(sheet)
    full = (array is not None
            and abs(low - np.nanmin(array)) < 1e-12
            and abs(high - np.nanmax(array)) < 1e-12)
    # Dragging back to the ends means "no clipping", which is the absence of
    # a range rather than a range equal to the data.
    sheet['AFM_Display_Range'] = None if full else [low, high]
    if kind == 'release':
        window._afm_hist_grab = None
        if getattr(window, 'afm_on_main', None) == state['sheet']:
            plot_afm_image(window, state['sheet'], preserve_view=True)
            window.plot_manager.canvas.draw_idle()
    return True


def afm_companion_mouse(window, mode, sheet_name, event, kind):
    """Make the companion an input, not just a read-out.

    Two interactions live here: dragging the red contrast lines on the
    height histogram, and dragging a range on the live profile to pick the
    feature the Profile tab measures. The profile one is armed by its button
    ("Pick range on the profile"), so an ordinary click there does nothing.
    Returns True when the companion must be redrawn.
    """
    if mode == 'Histogram':
        return _afm_histogram_mouse(window, event, kind)
    tool = getattr(window, '_afm_cd_pick', None)
    if tool is None or mode != 'Live profile':
        return False
    if kind == 'press':
        if event.button != 1 or event.xdata is None:
            return False
        window._afm_cd_drag = float(event.xdata)
        return False
    start = getattr(window, '_afm_cd_drag', None)
    if start is None or event.xdata is None:
        return False
    if kind == 'motion':
        return bool(tool.on_cd_range_drag(start, float(event.xdata), False))
    window._afm_cd_drag = None
    window._afm_cd_pick = None
    return bool(tool.on_cd_range_drag(start, float(event.xdata), True))


def render_afm_force_curve(ax, window, sheet_name):
    """The force curve of the last-picked pixel of the group's force map."""
    from libraries.ToolsMenu.AFM_Engine import (force_curve_analyze,
                                                volume_channel_index)
    levels = window.Data.get('Core levels', {})
    sheet = _companion_sheet(window, sheet_name)
    source = sheet.get('AFM_Source_File')
    volume = None
    vol_sheet = None
    for name, other in levels.items():
        if isinstance(other, dict) and other.get('_afm_volume') \
                and (other.get('AFM_Source_File') == source
                     or name == sheet_name):
            volume = other['_afm_volume']
            vol_sheet = other
            break
    ax.clear()
    # The companion axes is full-bleed by default; these plots
    # carry axis labels, so give them margins.
    ax.set_position([0.19, 0.17, 0.77, 0.72])
    if not volume:
        ax.text(0.5, 0.5, 'No force curves in this file', ha='center',
                va='center', transform=ax.transAxes, fontsize=9, color='gray')
        ax.set_xticks([])
        ax.set_yticks([])
        return False
    picked = vol_sheet.get('AFM_Force_Picked') or [0, 0]
    curve = None
    for c in volume.get('curves') or []:
        if [c['line'], c['point']] == list(picked):
            curve = c
            break
    if curve is None and volume.get('curves'):
        curve = volume['curves'][0]
    if curve is None:
        return False
    iz = volume_channel_index(volume, 'ZSnsr', 'Raw', 'ZSensor')
    idefl = volume_channel_index(volume, 'Defl', 'Deflection')
    if iz is None or idefl is None or iz >= len(curve['data']) \
            or idefl >= len(curve['data']):
        return False
    try:
        k = float(volume.get('meta', {}).get('SpringConstant', 1.0))
    except (TypeError, ValueError):
        k = 1.0
    result = force_curve_analyze(curve['data'][iz], curve['data'][idefl], k,
                                 curve['seg'])
    for label, (zs, fs), colour in (('approach', result['approach'], '#3070b0'),
                                    ('retract', result['retract'], '#c04030')):
        if len(zs):
            ax.plot(zs * 1e6, fs * 1e9, lw=0.7, color=colour, label=label)
    ax.set_title(f"pt ({curve['line']},{curve['point']}) — "
                 f"max {result['max_force'] * 1e9:.3g} nN, "
                 f"adhesion {result['adhesion'] * 1e9:.3g} nN", fontsize=8)
    ax.set_xlabel('Z sensor (µm)', fontsize=8)
    ax.set_ylabel('Force (nN)', fontsize=8)
    ax.legend(fontsize=7, loc='best')
    ax.tick_params(labelsize=7)
    return True


def refresh_afm_companion(window):
    """Ask the technique right frame to redraw its companion view.

    Called after anything that changes what the companion shows — a moved
    profile line, a new leveling, a picked force pixel.
    """
    try:
        from libraries.ViewMenu.TechniqueOverview import refresh_technique_panel
        refresh_technique_panel(window)
    except Exception as e:
        print(f'AFM companion refresh skipped: {e}')


# ---------------------------------------------------------------------------
# Main-canvas renderer
# ---------------------------------------------------------------------------

def attach_scale_bar_drag(window, sheet_name, ax):
    """Let the scale bar be dragged anywhere on the image.

    Only picks up a press that lands on the bar itself, and only while no AFM
    tool has armed the canvas for something else — so drawing a profile line
    or a region across the corner still does what it was asked to.
    """
    previous = getattr(ax, '_afm_bar_cids', None)
    canvas = window.plot_manager.canvas
    if previous:
        for cid in previous:
            try:
                canvas.mpl_disconnect(cid)
            except Exception:
                pass

    state = {'grab': None}

    def _sheet():
        return window.Data.get('Core levels', {}).get(sheet_name, {})

    def _busy():
        return any(getattr(tool, '_mode', None) is not None
                   for tool in getattr(window, '_afm_windows', []))

    def on_press(event):
        if (event.inaxes is not ax or event.button != 1 or _busy()
                or getattr(window, 'afm_on_main', None) != sheet_name):
            return
        x, y = ax.transAxes.inverted().transform((event.x, event.y))
        bx, by = scale_bar_position(_sheet())
        span = 0.2
        for artist in ax.patches:
            if getattr(artist, _SCALE_BAR_TAG, False):
                span = getattr(artist, '_afm_bar_span', (0.2, 0.016))[0]
        if bx - 0.02 <= x <= bx + span + 0.02 and by - 0.02 <= y <= by + 0.07:
            state['grab'] = (x - bx, y - by)

    def on_motion(event):
        if state['grab'] is None or event.inaxes is not ax:
            return
        x, y = ax.transAxes.inverted().transform((event.x, event.y))
        dx, dy = state['grab']
        sheet = _sheet()
        sheet['AFM_ScaleBar_Pos'] = [float(np.clip(x - dx, 0.01, 0.97)),
                                     float(np.clip(y - dy, 0.01, 0.93))]
        clear_scale_bar(ax)
        draw_scale_bar(ax, sheet)
        canvas.draw_idle()

    def on_release(_event):
        if state['grab'] is None:
            return
        state['grab'] = None
        try:
            from libraries.FileMenu.KFitting_IO import persist_project
            persist_project(window)
        except Exception:
            pass

    ax._afm_bar_cids = (canvas.mpl_connect('button_press_event', on_press),
                        canvas.mpl_connect('motion_notify_event', on_motion),
                        canvas.mpl_connect('button_release_event', on_release))


def _attach_view_hook(window, sheet_name, ax):
    """Redraw the scale bar whenever the view changes (zoom, pan, home)."""
    previous = getattr(ax, '_afm_view_cids', None)
    if previous:
        for cid in previous:
            try:
                ax.callbacks.disconnect(cid)
            except Exception:
                pass

    def on_view_changed(_axes):
        if getattr(window, 'afm_on_main', None) != sheet_name:
            return
        if getattr(ax, '_afm_bar_busy', False):
            return
        ax._afm_bar_busy = True
        try:
            clear_scale_bar(ax)
            draw_scale_bar(ax, window.Data['Core levels'][sheet_name])
        except Exception as e:
            print(f'AFM scale bar redraw skipped: {e}')
        finally:
            ax._afm_bar_busy = False

    ax._afm_view_cids = (ax.callbacks.connect('xlim_changed', on_view_changed),
                         ax.callbacks.connect('ylim_changed', on_view_changed))


def plot_afm_image(window, sheet_name, preserve_view=False):
    """Render an AFM channel map on the main canvas in place of a spectrum.

    Pass ``preserve_view`` for redraws that leave the image geometry alone
    (a new leveling, a profile line) so the current zoom survives; a
    recalibration must leave it False.
    """
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    # The 3D surface sheets need a 3D axes, so they take a route of their own
    # — handled here rather than at every call site.
    if isinstance(sheet, dict) and sheet.get('_afm_kind') == '3d':
        plot_afm_surface(window, sheet_name)
        return

    plot_manager = window.plot_manager
    # A map needs a flat axes, and the canvas may still be holding the 3D one
    # from a surface sheet. on_sheet_selected rebuilds it when the *selection*
    # changes, but a tool redraw does not go through there — changing the
    # colour map on the Channels tab with the surface on screen arrives here
    # with an Axes3D, where imshow and the scale bar both break.
    if getattr(plot_manager.ax, 'name', '') == '3d':
        plot_manager.figure.clear()
        plot_manager.ax = plot_manager.figure.add_subplot(111)
        window.ax = plot_manager.ax
        plot_manager.residuals_subplot = None
        window.residuals_subplot = None
        window._afm3d_ax = None
    ax = plot_manager.ax

    previous_view = None
    if preserve_view and getattr(window, 'afm_on_main', None) == sheet_name:
        x_lo, x_hi = ax.get_xlim()
        y_lo, y_hi = ax.get_ylim()
        if (x_lo, x_hi) != (0.0, 1.0) or (y_lo, y_hi) != (0.0, 1.0):
            previous_view = ((x_lo, x_hi), (y_lo, y_hi))

    _clear_afm_colorbars(ax)
    ax.clear()

    # Tear down the spectral furniture the previous sheet may have left.
    try:
        from libraries.ToolsMenu.TGA_Plot import remove_dsc_axis
        remove_dsc_axis(window)
    except Exception:
        pass
    if getattr(window, 'heatmap_colorbar', None) is not None:
        try:
            window.figure.delaxes(window.heatmap_colorbar.ax)
        except Exception:
            pass
        window.heatmap_colorbar = None
    if getattr(plot_manager, 'residuals_subplot', None):
        try:
            window.figure.delaxes(plot_manager.residuals_subplot)
        except Exception:
            pass
        plot_manager.residuals_subplot = None
        window.residuals_subplot = None
        ax.get_xaxis().set_visible(True)

    array = afm_array(sheet)
    if array is None:
        ax.text(0.5, 0.5, f'{sheet_name}\n\nNo image data available',
                ha='center', va='center', transform=ax.transAxes,
                fontsize=12, color='gray')
        ax.set_xticks([])
        ax.set_yticks([])
        plot_manager.canvas.draw_idle()
        return

    extent, unit = afm_extent(sheet)
    # With no ticks, labels or title the only thing to leave room for is the
    # colour key beside the image.
    ax.set_position([0.02, 0.02, 0.90, 0.96])
    vmin, vmax = afm_clim(sheet)
    image = ax.imshow(array, cmap=afm_cmap(sheet, window), aspect='equal',
                      origin='upper', extent=extent, interpolation='nearest',
                      vmin=vmin, vmax=vmax)

    if previous_view is not None:
        ax.set_xlim(*previous_view[0])
        ax.set_ylim(*previous_view[1])

    # Maps are shown bare — scale bar and colour key only, no ruled axes and
    # no title; the channel name is already in the sheet list.
    ax.set_xlabel('')
    ax.set_ylabel('')
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_title('')
    for spine in ax.spines.values():
        spine.set_visible(True)

    if unit == 'px':
        ax.text(0.5, 0.985, 'uncalibrated — sizes are in pixels',
                transform=ax.transAxes, ha='center', va='top',
                fontsize=9, fontweight='bold', color='white', zorder=10,
                bbox=dict(facecolor='firebrick', alpha=0.75,
                          edgecolor='none', pad=2))

    draw_afm_colorbar(ax, sheet, image)
    draw_afm_extras(window, sheet_name)

    window.afm_on_main = sheet_name
    _attach_view_hook(window, sheet_name, ax)
    attach_scale_bar_drag(window, sheet_name, ax)
    plot_manager.canvas.draw_idle()
