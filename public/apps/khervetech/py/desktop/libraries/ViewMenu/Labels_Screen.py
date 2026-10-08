# KherveOS: these definitions cut unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ViewMenu/Labels_Screen.py. Regenerate with tools/export_khervetech.py.
import math
from matplotlib.patches import (Rectangle, Circle, FancyArrowPatch, Polygon,
                                Arc, Wedge, Ellipse)
from matplotlib.lines import Line2D
from matplotlib.transforms import Affine2D
import matplotlib.transforms as mtransforms
import numpy as np


ENDPOINT_TYPES = ('line', 'pointer', 'dashed pointer', 'double arrow', 'measure', 'bracket', 'axisline',
                  'step')


SHAPE_TYPES = ('rectangle', 'circle', 'semicircle')


MEASURE_TYPES = ('measure', 'bracket', 'axisline')


DRAWING_TYPES = ENDPOINT_TYPES + SHAPE_TYPES


_DRAWING_TAG = '_labels_screen_drawing'


def _draw_label_data_on_ax(ax, ld, label_font_size=10, window=None):
    """Draw a single label/drawing entry on the given axes.
    Returns a list of artists created. Each is tagged for cleanup.

    ``window`` is only needed by an inset that draws *another sheet* (its
    ``source`` key) rather than mirroring the axes it sits on - a Tauc plot
    inset on the measured UV-Vis spectrum, say. Everything else ignores it.
    """
    artists = []
    ltype = ld.get('type', 'text')

    xlim = ax.get_xlim()
    ylim = ax.get_ylim()
    x_range = xlim[1] - xlim[0]
    y_range = ylim[1] - ylim[0]

    def _tag(artist):
        artist._labels_screen_drawing = True
        artists.append(artist)
        return artist

    def _add_endpoint_label(x1, y1, text, color):
        """Add name at start point, horizontal."""
        if text:
            _tag(ax.text(x1, y1, text, rotation=0,
                         fontsize=label_font_size,
                         va='bottom', ha='left',
                         color=color))

    if ltype == 'image':
        # Drawn as a tagged child axes, so the existing cleanup removes it.
        from libraries.ViewMenu.Label_Images import draw_image_label
        draw_image_label(ax, ld)
        return artists

    if ltype == 'text':
        # va/ha default to the historic bottom/center but can be overridden
        # (FTIR band labels hang below the band, i.e. va='top'). Colour and
        # weight default to plain black, so existing labels are unchanged, but
        # can be set per label (the TEM spacing labels come in coloured).
        _tag(ax.text(ld['x'], ld['y'], ld.get('text', ''),
                     rotation=ld.get('rotation', 90),
                     fontsize=ld.get('fontsize', label_font_size),
                     fontfamily=ld.get('fontfamily', 'Arial'),
                     color=ld.get('color', 'black'),
                     fontweight=ld.get('fontweight', 'normal'),
                     va=ld.get('va', 'bottom'), ha=ld.get('ha', 'center')))

    elif ltype == 'line':
        x1, y1 = ld['x'], ld['y']
        x2, y2 = ld.get('x2', x1), ld.get('y2', y1)
        _tag(Line2D([x1, x2], [y1, y2],
                     color=ld.get('color', 'black'),
                     linewidth=ld.get('linewidth', 1.0),
                     linestyle=ld.get('linestyle', '-')))
        ax.add_line(artists[-1])
        _add_endpoint_label(x1, y1, ld.get('text'), ld.get('color', 'black'))

    elif ltype == 'pointer':
        x1, y1 = ld['x'], ld['y']
        x2, y2 = ld.get('x2', x1), ld.get('y2', y1)
        arrow = FancyArrowPatch(
            (x1, y1), (x2, y2), arrowstyle='-|>',
            color=ld.get('color', 'black'),
            linewidth=ld.get('linewidth', 1.0),
            mutation_scale=ld.get('mutation_scale', 15))
        ax.add_patch(arrow); _tag(arrow)
        _add_endpoint_label(x1, y1, ld.get('text'), ld.get('color', 'black'))

    elif ltype == 'dashed pointer':
        x1, y1 = ld['x'], ld['y']
        x2, y2 = ld.get('x2', x1), ld.get('y2', y1)
        arrow = FancyArrowPatch(
            (x1, y1), (x2, y2), arrowstyle='-|>',
            color=ld.get('color', 'black'),
            linewidth=ld.get('linewidth', 1.0),
            linestyle='--',
            mutation_scale=ld.get('mutation_scale', 15))
        ax.add_patch(arrow); _tag(arrow)
        _add_endpoint_label(x1, y1, ld.get('text'), ld.get('color', 'black'))

    elif ltype == 'double arrow':
        x1, y1 = ld['x'], ld['y']
        x2, y2 = ld.get('x2', x1), ld.get('y2', y1)
        arrow = FancyArrowPatch(
            (x1, y1), (x2, y2), arrowstyle='<|-|>',
            color=ld.get('color', 'black'),
            linewidth=ld.get('linewidth', 1.0),
            mutation_scale=ld.get('mutation_scale', 12))
        ax.add_patch(arrow); _tag(arrow)
        # Label at centre, horizontal
        if ld.get('text'):
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            _tag(ax.text(cx, cy, ld['text'], rotation=0,
                         fontsize=ld.get('fontsize', label_font_size),
                         va='bottom', ha='center',
                         color=ld.get('color', 'black')))

    elif ltype == 'step':
        # Step annotation (TGA mass change): the two levels the step is
        # measured between, drawn as horizontal guides, joined by a vertical
        # double-arrow and labelled with the change. (x, y) is the start
        # corner and (x2, y2) the end one; the arrow stands at x_arrow, which
        # defaults to the end but can be dragged anywhere between them, and
        # each guide runs from its own start to the arrow so the two lengths
        # are adjustable independently.
        x1, y1 = ld['x'], ld['y']
        x2 = ld.get('x2', x1)
        y2 = ld.get('y2', y1)
        x_arrow = ld.get('x_arrow', x2)
        # Per-guide left ends, so one line can be shortened without the other
        left1 = ld.get('x_left', x1)
        left2 = ld.get('x_left2', x1)
        color = ld.get('color', 'black')
        lw = ld.get('linewidth', 1.0)
        for x_left, y in ((left1, y1), (left2, y2)):
            _tag(Line2D([x_left, x_arrow], [y, y], color=color, linewidth=lw,
                        linestyle=ld.get('linestyle', '--')))
            ax.add_line(artists[-1])
        arrow = FancyArrowPatch(
            (x_arrow, y1), (x_arrow, y2), arrowstyle='<|-|>',
            color=color, linewidth=lw,
            mutation_scale=ld.get('mutation_scale', 12))
        ax.add_patch(arrow); _tag(arrow)
        if ld.get('text'):
            # Just inside the arrow, so it stays within the measured range
            _tag(ax.annotate(ld['text'], xy=(x_arrow, (y1 + y2) / 2),
                             xytext=(-5, 0), textcoords='offset points',
                             fontsize=ld.get('fontsize', label_font_size),
                             va='center', ha='right', color=color))

    elif ltype == 'measure':
        # Dimension line between two peaks: a horizontal double-arrow at a fixed
        # bar level, with a dashed vertical guide rising from each arrow end up
        # to an independently draggable top. Label shows the auto-computed
        # X-axis distance (e.g. "ΔE=5.9 eV").
        x1 = ld['x']
        x2 = ld.get('x2', x1)
        bar_y = ld['y']                       # arrow/bar level (horizontal)
        default_top = bar_y + abs(y_range) * 0.25
        top1 = ld.get('y_top', default_top)   # top of left dashed guide
        top2 = ld.get('y_top2', default_top)  # top of right dashed guide
        color = ld.get('color', 'black')
        lw = ld.get('linewidth', 1.0)
        # Vertical dashed guides at each arrow end (bar level -> draggable top)
        for xg, ytop in ((x1, top1), (x2, top2)):
            if abs(ytop - bar_y) > 1e-12:
                _tag(Line2D([xg, xg], [bar_y, ytop], color=color,
                            linewidth=lw, linestyle='--'))
                ax.add_line(artists[-1])
        # Horizontal double-headed arrow along the bar
        arrow = FancyArrowPatch(
            (x1, bar_y), (x2, bar_y), arrowstyle='<|-|>',
            color=color, linewidth=lw,
            mutation_scale=ld.get('mutation_scale', 12))
        ax.add_patch(arrow); _tag(arrow)
        # Auto-computed distance along X (binding energy, eV)
        dist = abs(x2 - x1)
        prefix = ld.get('text', '') or 'ΔE='
        unit = ld.get('unit', 'eV')
        cx = (x1 + x2) / 2
        _tag(ax.text(cx, bar_y, f"{prefix}{dist:.1f} {unit}", rotation=0,
                     fontsize=ld.get('fontsize', label_font_size),
                     va='bottom', ha='center', color=color))

    elif ltype == 'axisline':
        # Line with one endpoint anchored to the x-axis (always at the current
        # axis baseline, slides only in X) and the other endpoint free. The
        # anchor's binding energy (its X position) is read out on the x-axis.
        x1 = ld['x']
        y_base = ylim[0]                      # x-axis baseline (bottom spine)
        x2 = ld.get('x2', x1)
        y2 = ld.get('y2', y_base + abs(y_range) * 0.4)
        color = ld.get('color', 'black')
        lw = ld.get('linewidth', 1.0)
        # The line
        _tag(Line2D([x1, x2], [y_base, y2], color=color, linewidth=lw,
                    linestyle=ld.get('linestyle', '-')))
        ax.add_line(artists[-1])
        # Small tick marking the anchor on the axis
        tick = abs(y_range) * 0.025
        _tag(Line2D([x1, x1], [y_base, y_base + tick], color=color, linewidth=lw))
        ax.add_line(artists[-1])
        # Binding-energy value at the anchor, read out on the x-axis
        _tag(ax.text(x1, y_base + tick * 1.3, f"{x1:.2f}", rotation=0,
                     fontsize=ld.get('fontsize', label_font_size),
                     va='bottom', ha='center', color=color,
                     bbox=dict(boxstyle='round,pad=0.15', facecolor='white',
                               edgecolor='none', alpha=0.6)))
        # Optional name near the free endpoint
        prefix = ld.get('text', '')
        if prefix:
            _tag(ax.text(x2, y2, prefix, rotation=0,
                         fontsize=ld.get('fontsize', label_font_size),
                         va='bottom', ha='left', color=color))

    elif ltype == 'bracket':
        # Bracket drawn ALONG the p1->p2 segment (so it rotates freely as the
        # endpoints move; horizontal by default) with two end-ticks that are
        # visually perpendicular at any angle. Perpendicularity is computed in
        # display space so it looks right despite the eV/counts aspect ratio.
        x1, y1 = ld['x'], ld['y']
        x2, y2 = ld.get('x2', x1), ld.get('y2', y1)
        color = ld.get('color', 'black'); lw = ld.get('linewidth', 1.0)
        trans = ax.transData; inv = trans.inverted()
        p1d = trans.transform((x1, y1)); p2d = trans.transform((x2, y2))
        ddx, ddy = p2d[0] - p1d[0], p2d[1] - p1d[1]
        seg_len = math.hypot(ddx, ddy)
        if seg_len < 1e-9:
            return artists
        ux, uy = ddx / seg_len, ddy / seg_len          # unit along bar (display)
        # Perpendicular (rotate ±90); tick_sign flips which side the ticks face
        sign = ld.get('tick_sign', -1)
        perp_x, perp_y = uy * sign, -ux * sign
        # Tick length: a fraction of the bar, clamped to a sensible pixel range
        tick_len = min(max(seg_len * 0.18, 8.0), 40.0)
        t1d = (p1d[0] + perp_x * tick_len, p1d[1] + perp_y * tick_len)
        t2d = (p2d[0] + perp_x * tick_len, p2d[1] + perp_y * tick_len)
        # Back to data coords
        P1 = inv.transform(p1d); P2 = inv.transform(p2d)
        T1 = inv.transform(t1d); T2 = inv.transform(t2d)
        # Bar + two end ticks
        _tag(Line2D([P1[0], P2[0]], [P1[1], P2[1]], color=color, linewidth=lw))
        ax.add_line(artists[-1])
        _tag(Line2D([P1[0], T1[0]], [P1[1], T1[1]], color=color, linewidth=lw))
        ax.add_line(artists[-1])
        _tag(Line2D([P2[0], T2[0]], [P2[1], T2[1]], color=color, linewidth=lw))
        ax.add_line(artists[-1])
        # Label at bar centre
        if ld.get('text'):
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            _tag(ax.text(cx, cy, ld['text'], rotation=0,
                         fontsize=ld.get('fontsize', label_font_size),
                         va='bottom', ha='center', color=color))

    elif ltype == 'rectangle':
        x1, y1 = ld['x'], ld['y']
        x2 = ld.get('x2', x1); y2 = ld.get('y2', y1)
        w, h = abs(x2 - x1), abs(y2 - y1)
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        rot_deg = ld.get('rotation', 0)
        rect = Rectangle((-w / 2, -h / 2), w, h,
                          linewidth=ld.get('linewidth', 1.0),
                          edgecolor=ld.get('color', 'black'),
                          facecolor=ld.get('facecolor', 'none'),
                          alpha=ld.get('alpha', 0.3))
        tr = Affine2D().rotate_deg(rot_deg).translate(cx, cy) + ax.transData
        rect.set_transform(tr); ax.add_patch(rect); _tag(rect)
        if ld.get('text'):
            _tag(ax.text(cx, cy, ld['text'], rotation=rot_deg,
                         fontsize=ld.get('fontsize', label_font_size),
                         va='center', ha='center',
                         color=ld.get('color', 'black')))

    elif ltype == 'circle':
        x1, y1 = ld['x'], ld['y']
        x2, y2 = ld.get('x2', x1), ld.get('y2', y1)
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        w, h = abs(x2 - x1), abs(y2 - y1)
        rot_deg = ld.get('rotation', 0)
        ellipse = Ellipse((cx, cy), w, h, angle=rot_deg,
                          linewidth=ld.get('linewidth', 1.0),
                          edgecolor=ld.get('color', 'black'),
                          facecolor=ld.get('facecolor', 'none'),
                          alpha=ld.get('alpha', 0.3))
        ax.add_patch(ellipse); _tag(ellipse)
        if ld.get('text'):
            _tag(ax.text(cx, cy, ld['text'], rotation=rot_deg,
                         fontsize=ld.get('fontsize', label_font_size),
                         va='center', ha='center',
                         color=ld.get('color', 'black')))

    elif ltype == 'semicircle':
        x1, y1 = ld['x'], ld['y']
        x2, y2 = ld.get('x2', x1), ld.get('y2', y1)
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        w, h = abs(x2 - x1), abs(y2 - y1)
        rot_deg = ld.get('rotation', 0)
        arc = Arc((cx, cy), w, h, angle=rot_deg, theta1=0, theta2=180,
                  linewidth=ld.get('linewidth', 1.0),
                  edgecolor=ld.get('color', 'black'))
        ax.add_patch(arc); _tag(arc)
        rot_rad = math.radians(rot_deg)
        cos_r, sin_r = math.cos(rot_rad), math.sin(rot_rad)
        p1x = cx + (w / 2) * cos_r; p1y = cy + (w / 2) * sin_r
        p2x = cx - (w / 2) * cos_r; p2y = cy - (w / 2) * sin_r
        bl = Line2D([p1x, p2x], [p1y, p2y], color=ld.get('color', 'black'),
                    linewidth=ld.get('linewidth', 1.0))
        ax.add_line(bl); _tag(bl)
        if ld.get('facecolor', 'none') != 'none':
            angles = np.linspace(0, 180, 60)
            pts_x, pts_y = [], []
            for a in angles:
                ar = math.radians(a)
                lx = (w / 2) * math.cos(ar); ly = (h / 2) * math.sin(ar)
                pts_x.append(cx + lx * cos_r - ly * sin_r)
                pts_y.append(cy + lx * sin_r + ly * cos_r)
            pts_x.append(pts_x[0]); pts_y.append(pts_y[0])
            fp = Polygon(list(zip(pts_x, pts_y)), closed=True,
                         facecolor=ld.get('facecolor', 'none'),
                         edgecolor='none', alpha=ld.get('alpha', 0.3))
            ax.add_patch(fp); _tag(fp)
        if ld.get('text'):
            _tag(ax.text(cx, cy, ld['text'], rotation=rot_deg,
                         fontsize=ld.get('fontsize', label_font_size),
                         va='center', ha='center',
                         color=ld.get('color', 'black')))

    elif ltype == 'inset':
        # Small inset mini-plot; drawn as a tagged child axes (cleaned up by
        # _remove_all_drawing_artists), so nothing is added to `artists`.
        _draw_inset(ax, ld, window)

    return artists


def _remove_all_drawing_artists(ax):
    """Remove all tagged drawing artists from axes."""
    for collection in (ax.patches[:], ax.lines[:], ax.texts[:], ax.collections[:]):
        for artist in collection:
            if getattr(artist, '_labels_screen_drawing', False):
                try: artist.remove()
                except Exception: pass
    # Inset mini-plots are child axes of `ax` (they live in ax.child_axes, not
    # in the collections above nor in figure.axes), so remove them by tag.
    child_axes = getattr(ax, 'child_axes', None)
    if child_axes:
        for child_ax in child_axes[:]:
            if getattr(child_ax, '_labels_screen_inset', False):
                try: child_ax.remove()
                except Exception: pass
                try: child_axes.remove(child_ax)
                except Exception: pass


def _draw_inset(ax, ld, window=None):
    """Create a small inset axes that mirrors the main plot over a chosen
    BE/intensity window. The inset is tagged so _remove_all_drawing_artists
    cleans it up on the next replot.

    An inset with a ``source`` key draws that sheet instead of mirroring this
    one, which is how a derived plot (the UV-Vis Tauc transform) can sit as an
    inset on the spectrum it came from.
    """
    from matplotlib.collections import PolyCollection
    x0 = float(ld.get('x', 0.6)); y0 = float(ld.get('y', 0.55))
    w = max(0.05, min(1.0, float(ld.get('w', 0.35))))
    h = max(0.05, min(1.0, float(ld.get('h', 0.35))))
    x0 = max(0.0, min(1.0 - w, x0)); y0 = max(0.0, min(1.0 - h, y0))
    try:
        ins = ax.inset_axes([x0, y0, w, h])
    except Exception:
        return
    ins._labels_screen_inset = True
    ins._labels_screen_drawing = True

    if ld.get('source'):
        _draw_source_inset(ins, ld, window)
        return ins

    be_min = ld.get('be_min'); be_max = ld.get('be_max')
    if be_min is None or be_max is None:
        xl = ax.get_xlim(); be_min, be_max = min(xl), max(xl)
    be_lo, be_hi = min(be_min, be_max), max(be_min, be_max)

    raw_x = raw_y = None
    # Mirror line artists (raw line, background, envelope, peak outlines)
    for ln in ax.get_lines():
        if getattr(ln, '_labels_screen_drawing', False):
            continue
        try:
            lx = np.asarray(ln.get_xdata(), dtype=float)
            ly = np.asarray(ln.get_ydata(), dtype=float)
        except Exception:
            continue
        if ln.get_label() == 'Raw Data':
            raw_x, raw_y = lx, ly
        try:
            ins.plot(lx, ly, color=ln.get_color(), linewidth=ln.get_linewidth(),
                     linestyle=ln.get_linestyle(),
                     alpha=(ln.get_alpha() if ln.get_alpha() is not None else 1.0),
                     marker=ln.get_marker(), markersize=ln.get_markersize())
        except Exception:
            pass
    # Mirror collections: filled peaks (PolyCollection) and raw scatter
    for coll in list(ax.collections):
        if getattr(coll, '_labels_screen_drawing', False):
            continue
        try:
            if isinstance(coll, PolyCollection):
                verts = [p.vertices for p in coll.get_paths() if len(p.vertices)]
                if not verts:
                    continue
                new = PolyCollection(verts, facecolors=coll.get_facecolor(),
                                     edgecolors=coll.get_edgecolor(),
                                     linewidths=coll.get_linewidths())
                a = coll.get_alpha()
                if a is not None:
                    new.set_alpha(a)
                ins.add_collection(new)
            else:
                offs = np.asarray(coll.get_offsets())
                if offs.ndim != 2 or offs.shape[0] == 0:
                    continue
                if raw_x is None and coll.get_label() == 'Raw Data':
                    raw_x, raw_y = offs[:, 0], offs[:, 1]
                fc = coll.get_facecolor()
                color = fc[0] if len(fc) else (0, 0, 0, 1)
                sx, sy = offs[:, 0], offs[:, 1]
                m = (sx >= be_lo) & (sx <= be_hi)
                sx, sy = sx[m], sy[m]
                if sx.size > 1500:                      # downsample for speed
                    step = int(sx.size // 1500) + 1
                    sx, sy = sx[::step], sy[::step]
                if sx.size:
                    ins.scatter(sx, sy, s=4, c=[color], marker='o')
        except Exception:
            pass

    # X range: match the main axis orientation (BE decreases L->R when inverted)
    if ax.xaxis_inverted():
        ins.set_xlim(be_hi, be_lo)
    else:
        ins.set_xlim(be_lo, be_hi)

    # Y range: explicit if given, else auto-scale to raw data in the BE window
    int_min = ld.get('int_min'); int_max = ld.get('int_max')
    if int_min is None or int_max is None:
        lo_hi = None
        if raw_x is not None and raw_y is not None:
            rx = np.asarray(raw_x); ry = np.asarray(raw_y)
            m = (rx >= be_lo) & (rx <= be_hi)
            yy = ry[m]
            if yy.size:
                lo_hi = (float(np.nanmin(yy)), float(np.nanmax(yy)))
        if lo_hi is None:
            lo_hi = ax.get_ylim()
        pad = (lo_hi[1] - lo_hi[0]) * 0.05 or 1.0
        y_lo = int_min if int_min is not None else lo_hi[0] - pad
        y_hi = int_max if int_max is not None else lo_hi[1] + pad
        ins.set_ylim(y_lo, y_hi)
    else:
        ins.set_ylim(int_min, int_max)

    # Border / ticks
    fontsize = float(ld.get('fontsize', 7))
    if ld.get('show_border', True):
        for s in ins.spines.values():
            s.set_visible(True)
        ins.tick_params(labelsize=max(fontsize - 1, 4), length=2)
    else:
        for s in ins.spines.values():
            s.set_visible(False)
        ins.set_xticks([]); ins.set_yticks([])

    name = ld.get('text', '')
    if name and name != 'Inset':
        ins.set_title(name, fontsize=fontsize)
    return ins


def _draw_source_inset(ins, ld, window):
    """Draw another sheet inside the inset axes.

    The whole of the source curve is shown by default - it is a plot in its
    own right, not a magnified corner of this one - with any stored fit
    overlay (``*_Fit_X`` / ``*_Fit_Y``) on top. Everything is sized from the
    label's ``fontsize``, because at inset scale the shared label size is
    unreadable.
    """
    sheet = {}
    try:
        sheet = window.Data['Core levels'].get(ld['source'], {}) or {}
    except (AttributeError, KeyError, TypeError):
        sheet = {}
    x = np.asarray(sheet.get('B.E.', []), dtype=float)
    y = np.asarray(sheet.get('Raw Data', []), dtype=float)
    if x.size < 2 or x.size != y.size:
        ins.text(0.5, 0.5, f"{ld.get('source', '')}\nnot found",
                 transform=ins.transAxes, ha='center', va='center',
                 fontsize=float(ld.get('fontsize', 8)), color='gray')
        ins.set_xticks([]); ins.set_yticks([])
        return

    fontsize = float(ld.get('fontsize', 8))
    ins.plot(x, y, color=ld.get('color', 'black'),
             linewidth=float(ld.get('linewidth', 1.0)))

    # A stored fit line, whatever technique prefix it carries.
    fit_x = fit_y = None
    for key in sheet:
        if str(key).endswith('_Fit_X') and sheet.get(str(key)[:-2] + '_Y'):
            fit_x = sheet[key]; fit_y = sheet[str(key)[:-2] + '_Y']
            break
    if fit_x and fit_y and len(fit_x) == len(fit_y):
        ins.plot(fit_x, fit_y, color=(0.7, 0.13, 0.13), linestyle=':',
                 linewidth=max(1.0, float(ld.get('linewidth', 1.0)) * 1.4))

    # Axis ranges: the label's own values win, else the whole curve.
    x_lo = ld.get('be_min'); x_hi = ld.get('be_max')
    if x_lo is None or x_hi is None:
        x_lo, x_hi = float(np.nanmin(x)), float(np.nanmax(x))
    if fit_x:
        # Never crop the extrapolated intercept out of the picture.
        x_lo = min(x_lo, float(np.nanmin(fit_x)))
    ins.set_xlim(min(x_lo, x_hi), max(x_lo, x_hi))

    y_lo = ld.get('int_min'); y_hi = ld.get('int_max')
    if y_lo is None or y_hi is None:
        finite = y[np.isfinite(y)]
        data_hi = float(np.nanmax(finite)) if finite.size else 1.0
        data_lo = float(np.nanmin(finite)) if finite.size else 0.0
        y_lo = y_lo if y_lo is not None else min(0.0, data_lo)
        y_hi = y_hi if y_hi is not None else data_hi * 1.05
    ins.set_ylim(y_lo, y_hi)

    if ld.get('xlabel'):
        ins.set_xlabel(ld['xlabel'], fontsize=fontsize)
    if ld.get('ylabel'):
        ins.set_ylabel(ld['ylabel'], fontsize=fontsize)
    ins.tick_params(labelsize=max(fontsize - 1, 4), length=2)

    if ld.get('show_border', True):
        for s in ins.spines.values():
            s.set_visible(True)
    else:
        for s in ins.spines.values():
            s.set_visible(False)
        ins.set_xticks([]); ins.set_yticks([])

    if ld.get('annotation'):
        ins.text(0.04, 0.96, ld['annotation'], transform=ins.transAxes,
                 va='top', ha='left', fontsize=fontsize,
                 color=(0.7, 0.13, 0.13))

    name = ld.get('text', '')
    if name and name != 'Inset':
        ins.set_title(name, fontsize=fontsize)
    ins.patch.set_alpha(float(ld.get('alpha', 0.85)))

