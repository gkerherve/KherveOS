# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/TEM_Plot.py. Regenerate with tools/export_khervetech.py.
"""
Drawing a TEM sheet on KherveFitting's main canvas.

Mirrors the SEM renderer: a TEM sheet holds an image where every other sheet
holds a spectrum, so ``plot_tem_image`` replaces the whole axes content. Two
image kinds share the path:

    TEM~Map   real-space micrograph, extent in nm (µm for wide fields),
              grey colormap, scale bar bottom-left
    TEM~FFT   reciprocal-space power spectrum, extent centred on the
              transmitted beam in 1/nm, log-stretched 'inferno'-free grey
              display, scale bar in 1/nm, plus the measured spot markers
              and d-spacing labels stored on the sheet

The scale bar is drawn in axes-fraction coordinates with its length picked
from a 1/2/5 sequence near a fifth of the visible width, exactly like the
SEM one, so it stays honest through zooming and panning.

``TEM~Plot`` (the extracted line profile) is *not* handled here — it is an
ordinary x/y sheet drawn by the generic spectrum path with its own axis
labels (see ``tem_plot_labels``).
"""

import numpy as np

from libraries.FileMenu.TEM_Import import (is_tem_fft, is_tem_scalar, tem_array,
                                           tem_extent)

BRAND = (79 / 255, 190 / 255, 159 / 255)

_TARGET_BAR_FRACTION = 0.2

# Marks the artists making up the scale bar, so a view change can replace
# just those without disturbing the image or overlays.
_SCALE_BAR_TAG = '_tem_scale_bar'


def render_tem_thumbnail(ax, window, sheet_name):
    """Draw a TEM image sheet (map / FFT / scalar) onto an arbitrary axes.

    A lean cousin of ``plot_tem_image`` for the companion view in the right
    frame: it renders the image and its overlays (scale bar, spots, masks,
    ROI, profile line) but touches no main-canvas furniture and never stores
    ``tem_on_main`` state. Returns True if something was drawn.
    """
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    array = tem_array(sheet)
    ax.clear()
    if array is None:
        ax.text(0.5, 0.5, 'No image to preview', ha='center', va='center',
                transform=ax.transAxes, fontsize=9, color='gray')
        ax.set_xticks([])
        ax.set_yticks([])
        return False

    extent, unit = tem_extent(sheet)
    if is_tem_fft(sheet):
        from libraries.ToolsMenu.TEM_Engine import display_fft
        ax.imshow(display_fft(np.asarray(array)), cmap='gray', aspect='equal',
                  origin='upper', extent=extent, interpolation='nearest')
    elif is_tem_scalar(sheet):
        ax.imshow(np.asarray(array, dtype=float),
                  cmap=sheet.get('TEM_Scalar_CMap') or 'viridis',
                  aspect='equal', origin='upper', extent=extent,
                  interpolation='nearest', vmin=sheet.get('TEM_Scalar_Min'),
                  vmax=sheet.get('TEM_Scalar_Max'))
    else:
        from libraries.ToolsMenu.SEM_Engine import adjust_image
        shown = adjust_image(array, sheet.get('TEM_Brightness', 0.0),
                             sheet.get('TEM_Contrast', 0.0),
                             sheet.get('TEM_AutoContrast', False))
        ax.imshow(shown, cmap='gray', aspect='equal', origin='upper',
                  extent=extent, interpolation='nearest')

    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(True)
    draw_particle_overlay(ax, sheet)
    draw_particle_roi(ax, sheet)
    draw_fft_annotations(ax, sheet)
    draw_fft_masks(ax, sheet)
    draw_profile_line(ax, sheet)
    draw_scale_bar(ax, sheet)
    return True


def render_tem_live_fft(ax, window, map_sheet_name):
    """Draw a live FFT of a TEM micrograph onto ``ax``.

    The source is the active real-space image itself (the sheet passed in — the
    one on the main canvas), not always the group's root map: if it is the image
    currently on the main canvas and it is zoomed in, the
    FFT is taken of the *visible region* (so the diffractogram follows what you
    are looking at); otherwise it is the whole micrograph. Either way it is
    downsampled first — fringes and particles are many pixels across, so the
    transform stays fast without losing the lattice. A caption says which.
    """
    from libraries.FileMenu.TEM_Import import make_tem_fft_sheet, tem_extent
    from libraries.ToolsMenu.TEM_Engine import display_fft, region_fft

    levels = window.Data.get('Core levels', {})
    sheet = levels.get(map_sheet_name, {})
    # Follow the active sheet: FFT the real-space image itself. If the active
    # sheet is not one (an FFT, a scalar map, a profile), fall back to the
    # micrograph it came from.
    if not (isinstance(sheet, dict) and sheet.get('_tem_image') is not None
            and not is_tem_fft(sheet) and not is_tem_scalar(sheet)):
        src = (sheet.get('TEM_FFT_Source') or sheet.get('TEM_Derived_From')
               or sheet.get('TEM_Source_Sheet'))
        if src in levels:
            map_sheet_name, sheet = src, levels[src]
    array = tem_array(sheet)
    ax.clear()
    if array is None:
        ax.text(0.5, 0.5, 'No image for a live FFT', ha='center', va='center',
                transform=ax.transAxes, fontsize=9, color='gray')
        ax.set_xticks([])
        ax.set_yticks([])
        return False

    region = array
    caption = 'whole image'
    try:
        main_ax = window.plot_manager.ax
        if getattr(window, 'tem_on_main', None) == map_sheet_name:
            extent, _u = tem_extent(sheet)
            scale = abs(extent[1] - extent[0]) / array.shape[1]
            x_lo, x_hi = sorted(main_ax.get_xlim())
            y_lo, y_hi = sorted(main_ax.get_ylim())
            x0 = max(0, int(x_lo / scale)); x1 = min(array.shape[1], int(x_hi / scale))
            y0 = max(0, int(y_lo / scale)); y1 = min(array.shape[0], int(y_hi / scale))
            if (x1 - x0) >= 16 and (y1 - y0) >= 16 \
                    and (x1 - x0 < array.shape[1] or y1 - y0 < array.shape[0]):
                region = array[y0:y1, x0:x1]
                caption = 'visible region'
    except Exception:
        pass

    step = max(1, int(max(region.shape) / 1024))
    small = np.asarray(region[::step, ::step], dtype=float)
    nm = sheet.get('TEM_NM_Per_Px')
    power, recip = region_fft(small, nm * step if nm else None)
    _name, fake = make_tem_fft_sheet('live', power, recip, map_sheet_name)
    extent, _unit = tem_extent(fake)
    ax.imshow(display_fft(power), cmap='gray', aspect='equal', origin='upper',
              extent=extent, interpolation='nearest')
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(True)
    draw_scale_bar(ax, fake)
    ax.text(0.03, 0.97, f'Live FFT — {caption}', transform=ax.transAxes,
            ha='left', va='top', fontsize=8, color='white', fontweight='bold',
            zorder=11, bbox=dict(facecolor='black', alpha=0.55,
                                 edgecolor='none', pad=2))
    return True


def is_tem_sheet(window, sheet_name):
    """True when the named sheet holds a TEM image (by flag, not by name)."""
    if not sheet_name:
        return False
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    return bool(isinstance(sheet, dict) and sheet.get('_tem'))


def tem_plot_labels(sheet, sheet_name=''):
    """(x label, y label) for a derived TEM curve sheet (profile or histogram)."""
    if isinstance(sheet, dict):
        x_label = sheet.get('TEM_X_Label') or sheet.get('SEM_X_Label')
        y_label = sheet.get('TEM_Y_Label') or sheet.get('SEM_Y_Label')
        if x_label and y_label:
            return x_label, y_label
    name = str(sheet_name)
    if name.startswith('TEM~Count'):
        return 'Particle size (nm)', 'Number of particles'
    if name.startswith('TEM~Freq'):
        return 'Particle size (nm)', 'Frequency of particles (%)'
    return 'Distance (nm)', 'Intensity (a.u.)'


def _nice_bar_length(span):
    """A 1/2/5-sequence length *closest* to ``_TARGET_BAR_FRACTION`` of ``span``.

    The candidate nearest the target in log space is chosen, not the first one
    at or above it: rounding up alone overshoots badly — a target of 2.4 would
    jump to 5, a bar half the frame wide reading '5' where '2' was meant. The
    closest-value rule keeps the bar near a fifth of the width and the number
    sensible.
    """
    target = span * _TARGET_BAR_FRACTION
    if target <= 0:
        return 0.0
    decade = 10.0 ** np.floor(np.log10(target))
    candidates = [1.0 * decade, 2.0 * decade, 5.0 * decade, 10.0 * decade]
    return min(candidates, key=lambda c: abs(np.log(c / target)))


def _format_dspacing(d_nm):
    """Real-space distance for an FFT bar, in the unit that reads cleanly."""
    if d_nm >= 1.0:
        return f'{d_nm:.3g} nm'
    if d_nm >= 0.1:
        return f'{d_nm:.2g} nm'
    return f'{d_nm * 1000:.0f} pm'          # sub-ångström: picometres


def _format_length(value, unit):
    """Render a bar length with the unit that keeps it readable.

    Reciprocal space is labelled '1/nm', not 'nm⁻¹': the superscript minus
    has no glyph in DejaVu Sans and matplotlib draws it as an empty box, so
    the FFT scale bar came out reading '10 nm□¹'. Mathtext ('nm$^{-1}$')
    would render, but it is set in the maths italic face and looks out of
    place beside the plain 'nm' of the companion micrograph.

    The reciprocal-space bar also carries its real-space equivalent (the
    d-spacing 1/g), because '5 1/nm' is the standard label but '= 0.20 nm' is
    the number a microscopist actually reasons about.
    """
    if unit == 'px':
        return f'{value:g} px'
    if unit == '1/nm':
        equiv = f' = {_format_dspacing(1.0 / value)}' if value > 0 else ''
        return f'{value:g} 1/nm{equiv}'
    if unit == 'nm' and value >= 1000:
        return f'{value / 1000:g} µm'
    if unit == 'µm' and value < 1.0:
        return f'{value * 1000:g} nm'
    return f'{value:g} {unit}'


def _rect(x, y, width, height, **kwargs):
    from matplotlib.patches import Rectangle
    return Rectangle((x, y), width, height, **kwargs)


def draw_scale_bar(ax, sheet, colour='white', fontsize=10):
    """Overlay the scale bar in the lower-left corner of the visible image."""
    extent, unit = tem_extent(sheet)
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

    x0, height = 0.05, 0.016
    y0 = 0.055
    backing = _rect(x0 - 0.02, y0 - 0.025, span + 0.04, height + 0.10,
                    facecolor='black', alpha=0.5, edgecolor='none', zorder=8,
                    transform=ax.transAxes)
    body = _rect(x0, y0, span, height, facecolor=colour, edgecolor='none',
                 zorder=9, transform=ax.transAxes)
    ax.add_patch(backing)
    ax.add_patch(body)
    label = ax.text(x0 + span / 2.0, y0 + height + 0.018,
                    _format_length(bar, unit),
                    color=colour, ha='center', va='bottom',
                    fontsize=float(fontsize),
                    fontweight='bold', zorder=9, transform=ax.transAxes)
    for artist in (backing, body, label):
        setattr(artist, _SCALE_BAR_TAG, True)


def clear_scale_bar(ax):
    """Remove a previously drawn scale bar so it can be redrawn."""
    for artist in list(ax.patches) + list(ax.texts):
        if getattr(artist, _SCALE_BAR_TAG, False):
            try:
                artist.remove()
            except (ValueError, NotImplementedError):
                pass


def draw_particle_overlay(ax, sheet):
    """Outline detected particles as one RGBA image (brand green)."""
    overlay = sheet.get('_tem_overlay')
    if overlay is None:
        return
    overlay = np.asarray(overlay, dtype=bool)
    extent, _ = tem_extent(sheet)
    array = tem_array(sheet)
    if extent is None or array is None or overlay.shape != array.shape[:2]:
        return

    rgba = np.zeros(overlay.shape + (4,), dtype=float)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = BRAND
    rgba[..., 3] = overlay.astype(float)
    ax.imshow(rgba, extent=extent, origin='upper', aspect='equal',
              interpolation='nearest', zorder=7)


def draw_fft_annotations(ax, sheet, fontsize=8.5):
    """Mark measured spots and their d-spacing labels on a TEM~FFT sheet.

    Spot positions are stored in pixels-from-centre on the sheet
    (``TEM_FFT_Spots``); they are converted to the current extent's units so
    they survive a recalibration.
    """
    if not is_tem_fft(sheet):
        return
    spots = sheet.get('TEM_FFT_Spots') or []
    if not spots:
        return
    extent, unit = tem_extent(sheet)
    array = tem_array(sheet)
    if extent is None or array is None:
        return
    # Pixels-from-centre -> data units (extent is centred).
    scale = abs(extent[1] - extent[0]) / array.shape[1]
    # A row picked in the Measure table highlights every spot of that family,
    # which is how a d-spacing in the list is tied back to the pattern.
    selected = sheet.get('TEM_FFT_Selected')

    for spot in spots:
        try:
            x = float(spot['x']) * scale
            y = float(spot['y']) * scale
        except (KeyError, TypeError, ValueError):
            continue
        if selected is not None and spot.get('family') == selected:
            ax.plot([x], [y], marker='o', ms=15, mfc='none', mec='red',
                    mew=2.0, zorder=11)
        ax.plot([x], [y], marker='o', ms=9, mfc='none', mec=BRAND,
                mew=1.4, zorder=9)
        label = spot.get('label')
        if label:
            ax.annotate(str(label), xy=(x, y), xytext=(5, 6),
                        textcoords='offset points', color='white',
                        fontsize=float(fontsize), fontweight='bold', zorder=10,
                        bbox=dict(facecolor='black', alpha=0.55,
                                  edgecolor='none', pad=1.5))


def draw_particle_roi(ax, sheet):
    """Outline the particle region of interest on the map.

    Stored in image pixels (``TEM_Particle_ROI``); drawn in the current
    extent's units so it tracks a recalibration. Only the outline is drawn,
    so the particles it selects stay visible inside it.
    """
    roi = sheet.get('TEM_Particle_ROI')
    if not roi or is_tem_fft(sheet):
        return
    extent, _unit = tem_extent(sheet)
    array = tem_array(sheet)
    if extent is None or array is None:
        return
    scale = abs(extent[1] - extent[0]) / array.shape[1]

    if roi.get('kind') == 'ellipse':
        from matplotlib.patches import Ellipse
        ax.add_patch(Ellipse((float(roi['cx']) * scale, float(roi['cy']) * scale),
                             2 * float(roi['rx']) * scale,
                             2 * float(roi['ry']) * scale,
                             facecolor='none', edgecolor=BRAND, lw=1.6,
                             zorder=8))
    else:
        from matplotlib.patches import Rectangle
        x0 = min(float(roi['x0']), float(roi['x1'])) * scale
        y0 = min(float(roi['y0']), float(roi['y1'])) * scale
        width = abs(float(roi['x1']) - float(roi['x0'])) * scale
        height = abs(float(roi['y1']) - float(roi['y0'])) * scale
        ax.add_patch(Rectangle((x0, y0), width, height, facecolor='none',
                               edgecolor=BRAND, lw=1.6, zorder=8))


def draw_fft_masks(ax, sheet):
    """Outline the Bragg-filter masks stored on a TEM~FFT sheet.

    Masks are kept in the same pixels-from-centre coordinates as the spots
    (``TEM_FFT_Masks``), each one a labelled set of regions. Only the outline
    is drawn — a filled aperture would hide the very spots it selects.
    """
    if not is_tem_fft(sheet):
        return
    masks = sheet.get('TEM_FFT_Masks') or []
    if not masks:
        return
    extent, _unit = tem_extent(sheet)
    array = tem_array(sheet)
    if extent is None or array is None:
        return
    scale = abs(extent[1] - extent[0]) / array.shape[1]

    from matplotlib.patches import Circle, Ellipse, Polygon

    for mask in masks:
        if not mask.get('visible', True):
            continue
        colour = mask.get('colour') or BRAND
        label_done = False
        for region in mask.get('regions') or []:
            for variant in ((region, _mirrored(region))
                            if mask.get('symmetric', True) else (region,)):
                patch = _region_patch(variant, scale, colour)
                if patch is None:
                    continue
                ax.add_patch(patch)
                if not label_done and mask.get('label'):
                    anchor = _region_anchor(variant, scale)
                    if anchor is not None:
                        ax.annotate(str(mask['label']), xy=anchor,
                                    xytext=(4, 4), textcoords='offset points',
                                    color=colour, fontsize=8.5,
                                    fontweight='bold', zorder=11)
                        label_done = True


def _mirrored(region):
    from libraries.ToolsMenu.TEM_Engine import _mirror_region
    return _mirror_region(region)


def _region_patch(region, scale, colour):
    """A matplotlib outline for one mask region, in data units."""
    from matplotlib.patches import Circle, Ellipse, Polygon

    style = dict(facecolor='none', edgecolor=colour, lw=1.3, zorder=10)
    kind = str(region.get('kind', 'circle'))
    if kind == 'circle':
        return Circle((float(region.get('x', 0)) * scale,
                       float(region.get('y', 0)) * scale),
                      float(region.get('r', 5)) * scale, **style)
    if kind == 'ellipse':
        return Ellipse((float(region.get('x', 0)) * scale,
                        float(region.get('y', 0)) * scale),
                       2 * float(region.get('rx', 5)) * scale,
                       2 * float(region.get('ry', 5)) * scale,
                       angle=-float(region.get('angle', 0.0)), **style)
    if kind == 'polygon':
        points = region.get('points') or []
        if len(points) < 3:
            return None
        return Polygon([(float(px) * scale, float(py) * scale)
                        for px, py in points], closed=True, **style)
    return None


def _region_anchor(region, scale):
    if region.get('kind') == 'polygon':
        points = region.get('points') or []
        if not points:
            return None
        return (float(points[0][0]) * scale, float(points[0][1]) * scale)
    return (float(region.get('x', 0)) * scale, float(region.get('y', 0)) * scale)


def _decode(value, empty):
    """Decode a value stored as a JSON string, tolerating the plain form.

    Fringe positions and their statistics are written as JSON *strings*
    because the project JSON rounds every float it meets to two decimals,
    which would put every peak of a 0.2 nm lattice at the same place and
    flatten a 0.004 nm standard deviation to zero. The plain form is still
    accepted, for sheets written before that and for anything in memory.
    """
    if isinstance(value, str):
        if not value.strip():
            return empty
        import json
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return empty
    return value if isinstance(value, type(empty)) else empty


def profile_stats(sheet):
    """The stored fringe-spacing statistics of a profile sheet, as a dict."""
    return _decode((sheet or {}).get('TEM_Profile_Stats'), {})


def profile_peak_positions(sheet):
    """The stored fringe-peak positions of a profile sheet, as a list."""
    return _decode((sheet or {}).get('TEM_Profile_Peaks'), [])


def draw_profile_line(ax, sheet):
    """Show the line profile's band on the map sheet it was taken from.

    The line is stored on the map (``TEM_Profile_Line``) rather than only on
    the derived TEM~Plot sheet, so re-opening a project shows where the
    profile came from and the line can be picked up and moved again.
    """
    line = sheet.get('TEM_Profile_Line')
    if not line or len(line) < 4:
        return
    extent, _unit = tem_extent(sheet)
    array = tem_array(sheet)
    if extent is None or array is None:
        return
    scale = abs(extent[1] - extent[0]) / array.shape[1]
    x0, y0, x1, y1 = (float(v) for v in line[:4])
    width = float(sheet.get('TEM_Profile_Width') or 1)

    ax.plot([x0 * scale, x1 * scale], [y0 * scale, y1 * scale],
            '-', color='red', lw=1.4, zorder=10)
    if width > 1:
        length = np.hypot(x1 - x0, y1 - y0)
        if length > 0:
            from matplotlib.patches import Polygon
            px, py = -(y1 - y0) / length, (x1 - x0) / length
            half = width / 2.0
            corners = [((x0 + px * half) * scale, (y0 + py * half) * scale),
                       ((x1 + px * half) * scale, (y1 + py * half) * scale),
                       ((x1 - px * half) * scale, (y1 - py * half) * scale),
                       ((x0 - px * half) * scale, (y0 - py * half) * scale)]
            ax.add_patch(Polygon(corners, closed=True, facecolor='red',
                                 alpha=0.18, edgecolor='none', zorder=9))


def draw_scalar_colorbar(ax, sheet, image):
    """Colour key for a scalar map, drawn inside the image.

    Deliberately an inset rather than a real colour bar: ``colorbar()`` takes
    its space out of the parent axes, and on a canvas that is redrawn on
    every measurement that walks the image smaller and smaller.

    The tick labels carry as many decimals as the *range* needs, not as many
    as the values do. A d-spacing map covers something like 0.2000–0.2020 nm,
    and four ticks all reading '0.2' say nothing at all. They also sit on the
    inside of the bar, because a key this close to the right-hand edge would
    otherwise have its numbers clipped off the figure.
    """
    from matplotlib.ticker import FuncFormatter

    label = sheet.get('TEM_Scalar_Label') or ''
    # Dark backing, as under the scale bar: the key sits over the image and
    # white numbers are illegible wherever the map happens to be pale.
    ax.add_patch(_rect(0.74, 0.05, 0.25, 0.40, facecolor='black', alpha=0.5,
                       edgecolor='none', zorder=8, transform=ax.transAxes))

    cax = ax.inset_axes([0.945, 0.08, 0.028, 0.30])
    cax._tem_scalar_cax = True
    cax.set_zorder(9)
    bar = ax.get_figure().colorbar(image, cax=cax)

    low, high = image.get_clim()
    span = float(high) - float(low)
    decimals = (0 if span <= 0 else
                int(np.clip(np.ceil(-np.log10(span / 4.0)) + 1, 0, 5)))
    bar.ax.yaxis.set_major_formatter(
        FuncFormatter(lambda v, _pos: f'{v:.{decimals}f}'))

    bar.outline.set_edgecolor('white')
    cax.yaxis.set_ticks_position('left')
    cax.tick_params(colors='white', labelsize=7.5)
    for spine in cax.spines.values():
        spine.set_edgecolor('white')
    if label:
        cax.set_title(label, color='white', fontsize=8.5, pad=5)
    return bar


def _clear_scalar_colorbars(ax):
    """Drop the colour-key axes a previous scalar map left behind.

    ``ax.clear()`` empties the main axes but leaves its children alone, so
    without this every redraw stacks another colour bar in the same spot. An
    inset lives in ``ax.child_axes`` and *not* in ``figure.axes``, so it has
    to be removed from both — the same dance the Labels Manager does for its
    inset plots.
    """
    children = getattr(ax, 'child_axes', None)
    if not children:
        return
    for child in list(children):
        if not getattr(child, '_tem_scalar_cax', False):
            continue
        try:
            child.remove()
        except Exception:
            pass
        try:
            children.remove(child)
        except Exception:
            pass


def _draw_sheet_labels(window, sheet, ax):
    """Draw the sheet's Labels Manager entries (text, insets, image overlays).

    Image sheets never reach the generic label-drawing loop, so without this
    an FFT inset placed on the map would be stored but never shown.
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


def draw_tem_extras(window, sheet_name):
    """Redraw every overlay that sits on top of the image.

    Safe to call for any sheet — returns immediately for non-TEM ones.
    """
    if not is_tem_sheet(window, sheet_name):
        return
    sheet = window.Data['Core levels'][sheet_name]
    ax = window.plot_manager.ax
    draw_particle_overlay(ax, sheet)
    draw_particle_roi(ax, sheet)
    draw_fft_annotations(ax, sheet)
    draw_fft_masks(ax, sheet)
    # While the analysis window is holding the line, that window draws it —
    # drawing the stored copy too would leave a stale line behind the one
    # being dragged.
    tool = getattr(window, 'tem_analysis_window', None)
    if not (tool is not None and getattr(tool, '_line_live', False)):
        draw_profile_line(ax, sheet)
    _draw_sheet_labels(window, sheet, ax)
    clear_scale_bar(ax)
    draw_scale_bar(ax, sheet)


def _attach_view_hook(window, sheet_name, ax):
    """Redraw the scale bar whenever the view changes (zoom, pan, home)."""
    previous = getattr(ax, '_tem_view_cids', None)
    if previous:
        for cid in previous:
            try:
                ax.callbacks.disconnect(cid)
            except Exception:
                pass

    def on_view_changed(_axes):
        if getattr(window, 'tem_on_main', None) != sheet_name:
            return
        if getattr(ax, '_tem_bar_busy', False):
            return
        ax._tem_bar_busy = True
        try:
            clear_scale_bar(ax)
            draw_scale_bar(ax, window.Data['Core levels'][sheet_name])
        except Exception as e:
            print(f'TEM scale bar redraw skipped: {e}')
        finally:
            ax._tem_bar_busy = False

    ax._tem_view_cids = (ax.callbacks.connect('xlim_changed', on_view_changed),
                         ax.callbacks.connect('ylim_changed', on_view_changed))


def plot_tem_image(window, sheet_name, preserve_view=False):
    """Render a TEM sheet (map or FFT) on the main canvas.

    Pass ``preserve_view`` for redraws that leave the image geometry alone
    (a new overlay, a fresh measurement) so the current zoom survives.
    Recalibration must leave it False.
    """
    plot_manager = window.plot_manager
    ax = plot_manager.ax
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})

    # A picture named TEM~FFT is a diffractogram whatever it imported as: adopt
    # the FFT kind (and its centred extent) before measuring the geometry.
    from libraries.FileMenu.TEM_Import import promote_named_fft
    if promote_named_fft(sheet, sheet_name):
        preserve_view = False

    previous_view = None
    if preserve_view and getattr(window, 'tem_on_main', None) == sheet_name:
        x_lo, x_hi = ax.get_xlim()
        y_lo, y_hi = ax.get_ylim()
        if (x_lo, x_hi) != (0.0, 1.0) or (y_lo, y_hi) != (0.0, 1.0):
            previous_view = ((x_lo, x_hi), (y_lo, y_hi))

    ax.clear()
    _clear_scalar_colorbars(ax)

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

    array = tem_array(sheet)
    if array is None:
        ax.text(0.5, 0.5, f'{sheet_name}\n\nNo image data available',
                ha='center', va='center', transform=ax.transAxes,
                fontsize=12, color='gray')
        ax.set_xticks([])
        ax.set_yticks([])
        plot_manager.canvas.draw_idle()
        return

    extent, unit = tem_extent(sheet)
    ax.set_position([0.02, 0.02, 0.96, 0.96])

    if is_tem_fft(sheet):
        from libraries.ToolsMenu.SEM_Engine import adjust_image
        from libraries.ToolsMenu.TEM_Engine import display_fft
        # Brightness/contrast apply to the log-stretched diffractogram too, so
        # the Calibrate controls work on an FFT sheet as they do on a map.
        shown = adjust_image(display_fft(array),
                             sheet.get('TEM_Brightness', 0.0),
                             sheet.get('TEM_Contrast', 0.0),
                             sheet.get('TEM_AutoContrast', False))
        ax.imshow(shown, cmap='gray', aspect='equal', origin='upper',
                  extent=extent, interpolation='nearest')
    elif is_tem_scalar(sheet):
        # A d-spacing, orientation or strain map is a physical quantity, not
        # a micrograph: it gets a colour scale and a key, and its limits are
        # symmetric for the signed quantities so zero sits mid-scale.
        image = ax.imshow(np.asarray(array, dtype=float),
                          cmap=sheet.get('TEM_Scalar_CMap') or 'viridis',
                          aspect='equal', origin='upper', extent=extent,
                          interpolation='nearest',
                          vmin=sheet.get('TEM_Scalar_Min'),
                          vmax=sheet.get('TEM_Scalar_Max'))
        draw_scalar_colorbar(ax, sheet, image)
    else:
        # Brightness/contrast change only how the micrograph is shown — the
        # stored pixels stay intact, so profiles, FFTs and particle sizes
        # always work off the real data. The SEM engine's adjust_image does
        # the work (it is technique-agnostic).
        from libraries.ToolsMenu.SEM_Engine import adjust_image
        display = adjust_image(array, sheet.get('TEM_Brightness', 0.0),
                               sheet.get('TEM_Contrast', 0.0),
                               sheet.get('TEM_AutoContrast', False))
        ax.imshow(display, cmap='gray', aspect='equal', origin='upper',
                  extent=extent, interpolation='nearest')

    if previous_view is not None:
        ax.set_xlim(*previous_view[0])
        ax.set_ylim(*previous_view[1])

    # Micrographs and diffractograms are shown bare — scale bar only.
    ax.set_xlabel('')
    ax.set_ylabel('')
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_title('')
    for spine in ax.spines.values():
        spine.set_visible(True)

    if unit == 'px':
        ax.text(0.5, 0.985, 'uncalibrated — distances are in pixels',
                transform=ax.transAxes, ha='center', va='top',
                fontsize=9, fontweight='bold', color='white', zorder=10,
                bbox=dict(facecolor='firebrick', alpha=0.75,
                          edgecolor='none', pad=2))

    draw_tem_extras(window, sheet_name)

    window.tem_on_main = sheet_name
    _attach_view_hook(window, sheet_name, ax)
    plot_manager.canvas.draw_idle()
