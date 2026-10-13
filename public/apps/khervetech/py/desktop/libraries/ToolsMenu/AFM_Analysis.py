# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/AFM_Analysis.py. Regenerate with tools/export_khervetech.py.
"""
AFM Analysis window.

Five tabs over one AFM channel-map sheet:

    Channels    every channel imported from the same file, switchable, the
                scan-size calibration shared by all of them, and the colour
                map the channel is drawn with
    Level       flatten the background first, then align the scan lines by
                one of Gwyddion's "Align Rows" methods, then scar removal and
                the zero reference — stored as a recipe on the sheet and
                applied on the way to every display and measurement, so it
                stays undoable
    Roughness   the statistical quantities of the leveled image: the ISO
                25178 areal parameters (Sa, Sq, Ssk, Sku, Sp, Sv, Sz), the
                order-based values, and the hybrid ones (projected and
                surface area, volume, Sdq, Sdr, variation, inclination)
    3D          the 'AFM~3D' surface sheet: which channel it renders, the
                colour map, the height exaggeration and the view angle —
                every control redraws the sheet on the main canvas, and the
                angle a rotation leaves it at is stored on the sheet
    Particles   count grains by height: set the contrast on the companion
                histogram, take the threshold from it, filter by size, and
                get the count, the size statistics and an outline overlay —
                the same detector the SEM tool uses
    Profile     an editable line on the map — click twice to draw it (with a
                live preview), then drag an end to swing it or the middle to
                move it, scroll to change the averaging width — exportable
                as an 'AFM~Profile' curve sheet that follows the line, and
                measurable: drag across a feature on the companion profile
                and fit it as a step or an edge for its height and width
    Force       force curves of an .ARDF force map: click a pixel to select
                its curve, and publish adhesion / maximum-force maps as new
                AFM sheets

This window deliberately contains no plots: the map lives on the main
canvas, and the derived views (height histogram, PSD, the live profile, the
picked force curve) are drawn by the technique right-frame companion — pick
them from its dropdown. The tabs hold only controls and numbers.

Measurements are stored on the sheets (``AFM_Level``, ``AFM_Roughness``,
``AFM_Profile_Line``, ``AFM_Profile_Width``, ``AFM_Force_Picked``,
``AFM_3D``) so they survive a save/reload.
"""

import os

import numpy as np
import wx

from libraries.FileMenu.AFM_Import import (AFM_3D_DEFAULTS, AFM_3D_SHEET,
                                           afm_array, afm_extent,
                                           make_afm_3d_sheet,
                                           make_afm_scalar_sheet,
                                           make_afm_sheet,
                                           register_afm_sheet)
from libraries.ToolsMenu.AFM_Engine import (CD_FUNCTIONS, CD_LABELS,
                                            FORCE_METRICS,
                                            critical_dimension,
                                            force_curve_analyze,
                                            force_volume_maps, hybrid_stats,
                                            line_profile, profile_roughness,
                                            roi_mask, roughness_stats,
                                            step_height, surface_area_ratio,
                                            volume_channel_index)
from libraries.ToolsMenu.AFM_Plot import (afm_3d_view, draw_profile_artists,
                                          is_afm_3d_sheet, plot_afm_image,
                                          redraw_afm_3d,
                                          refresh_afm_companion)

BRAND = (79 / 255, 190 / 255, 159 / 255)
BRAND_WX = wx.Colour(79, 190, 159)

# The sheet the grain size distribution is published to. '~' is what the
# Sample Manager splits on, so these get a column of their own rather than
# piling in with the channel maps.
AFM_GRAIN_SHEET = 'AFM~Grain'

# Colour maps offered for a channel map and for the 3D surface. The same
# catalogue the heatmap and the 3D waterfall offer - there is nothing about a
# colour ramp that belongs to one technique - with the project-wide default in
# front. That default is set once in Style > AFM (or Preferences > AFM
# Settings) and is the heatmap's own ramp unless it has been untied; picking a
# ramp here overrides it for this sheet alone.
_AUTO_PALETTE = 'Default (Style > AFM)'


def _palette_labels():
    from libraries.ViewMenu.HeatmapColours import CMAP_LABELS
    return [_AUTO_PALETTE] + list(CMAP_LABELS)


def _palette_value(label):
    """Matplotlib name for a picked label, or None for the automatic choice."""
    from libraries.ViewMenu.HeatmapColours import CMAP_BY_LABEL
    return None if label == _AUTO_PALETTE else CMAP_BY_LABEL.get(label)


def _palette_label(value):
    """The label a stored colour map reads as.

    A ramp saved before this catalogue (or by a newer build) still selects
    itself by its raw matplotlib name rather than silently reverting to
    automatic.
    """
    from libraries.ViewMenu.HeatmapColours import CMAP_LABEL_OF
    if not value:
        return _AUTO_PALETTE
    return CMAP_LABEL_OF.get(str(value), str(value))


def _select_palette(choice, value):
    """Point a palette combo at a stored colour map, listing it if it is new."""
    label = _palette_label(value)
    labels = list(choice.GetStrings())
    if label not in labels:
        choice.Append(label)
        labels.append(label)
    choice.SetSelection(labels.index(label))


# Icon buttons for the tool tabs. Same drawing idiom as the toolbar's section
# buttons — a rounded tile with dark strokes on it — so a button that does a
# thing looks like a button that does a thing, wherever it appears. Grey, not
# the brand green: green is what the app reserves for the thing that acts on
# the data (the Apply buttons sit right below these), and a row of green tiles
# that only pick a drawing mode was reading as five Applies.
_TOOL_GLYPHS = ('rect', 'circle', 'freehand', 'include', 'exclude', 'move',
                'delete', 'clear', 'crop', 'compute', 'region', 'plot')


def _tool_icon(name, size=22):
    """A 22 px pictogram on the theme's grey tile, drawn with wx."""
    from libraries.ViewMenu.TechniqueToolbar import BORDER, GREY

    try:
        bmp = wx.Bitmap.FromRGBA(size, size, 0, 0, 0, 0)
    except Exception:
        bmp = wx.Bitmap(size, size)
    dc = wx.MemoryDC(bmp)
    gc = wx.GraphicsContext.Create(dc)
    if gc:
        k = size / 22.0

        def P(x, y):
            return x * k, y * k

        def w(scale):
            return max(1, int(round(scale * k)))

        gc.SetBrush(wx.Brush(GREY))
        gc.SetPen(wx.Pen(BORDER, 1))
        gc.DrawRoundedRectangle(0.5, 0.5, size - 1.0, size - 1.0, 3.5 * k)
        ink = wx.Pen(BORDER, w(2.4))
        ink.SetCap(wx.CAP_ROUND)
        ink.SetJoin(wx.JOIN_ROUND)
        gc.SetPen(ink)
        gc.SetBrush(wx.TRANSPARENT_BRUSH)
        if name == 'rect':
            gc.DrawRectangle(*P(4, 5.5), 14 * k, 11 * k)
        elif name == 'circle':
            gc.DrawEllipse(*P(4, 4), 14 * k, 14 * k)
        elif name == 'freehand':
            path = gc.CreatePath()
            path.MoveToPoint(*P(4, 13))
            path.AddCurveToPoint(*P(4, 5), *P(11, 3), *P(14, 7))
            path.AddCurveToPoint(*P(19, 9), *P(17, 18), *P(10, 17))
            path.AddCurveToPoint(*P(6, 17), *P(4, 16), *P(4, 13))
            gc.StrokePath(path)
        elif name == 'include':
            gc.DrawRectangle(*P(3.5, 3.5), 15 * k, 15 * k)
            gc.SetBrush(wx.Brush(BORDER))
            gc.DrawRectangle(*P(7, 7), 8 * k, 8 * k)
        elif name == 'exclude':
            gc.DrawRectangle(*P(3.5, 3.5), 15 * k, 15 * k)
            gc.StrokeLine(*P(6.5, 6.5), *P(15.5, 15.5))
            gc.StrokeLine(*P(15.5, 6.5), *P(6.5, 15.5))
        elif name == 'move':
            gc.StrokeLine(*P(11, 4), *P(11, 18))
            gc.StrokeLine(*P(4, 11), *P(18, 11))
            for a, b, c in (((11, 3), (8.5, 6), (13.5, 6)),
                            ((11, 19), (8.5, 16), (13.5, 16)),
                            ((3, 11), (6, 8.5), (6, 13.5)),
                            ((19, 11), (16, 8.5), (16, 13.5))):
                gc.StrokeLines([P(*b), P(*a), P(*c)])
        elif name == 'delete':
            gc.StrokeLine(*P(4.5, 6), *P(17.5, 6))
            gc.StrokeLines([P(6, 6), P(7, 18), P(15, 18), P(16, 6)])
            gc.StrokeLine(*P(9, 3.5), *P(13, 3.5))
        elif name == 'clear':
            gc.DrawEllipse(*P(4, 4), 14 * k, 14 * k)
            gc.StrokeLine(*P(6.5, 15.5), *P(15.5, 6.5))
        elif name == 'crop':
            gc.StrokeLine(*P(6, 2.5), *P(6, 16))
            gc.StrokeLine(*P(2.5, 6), *P(16, 6))
            gc.StrokeLine(*P(16, 6), *P(16, 19.5))
            gc.StrokeLine(*P(6, 16), *P(19.5, 16))
        elif name == 'compute':
            gc.StrokeLine(*P(4, 17.5), *P(18, 17.5))
            for x, top in ((6.5, 11), (11, 5), (15.5, 8.5)):
                gc.StrokeLine(*P(x, top), *P(x, 17))
        elif name == 'region':
            gc.DrawRectangle(*P(3.5, 3.5), 15 * k, 15 * k)
            gc.SetPen(wx.Pen(BORDER, w(2.0), wx.PENSTYLE_SHORT_DASH))
            gc.DrawEllipse(*P(7, 7), 9 * k, 9 * k)
        elif name == 'plot':
            gc.DrawRectangle(*P(3.5, 4), 15 * k, 14 * k)
            gc.StrokeLines([P(6, 14), P(9, 9), P(12, 12), P(16, 7)])
        else:
            gc.DrawEllipse(*P(7, 7), 8 * k, 8 * k)
    dc.SelectObject(wx.NullBitmap)
    return bmp


def _icon_button(parent, glyph, tooltip, handler, size=22):
    """A square icon button wired to ``handler``."""
    button = wx.BitmapButton(parent, bitmap=_tool_icon(glyph, size),
                             size=(size + 12, size + 10))
    button.SetToolTip(tooltip)
    if handler is not None:
        button.Bind(wx.EVT_BUTTON, handler)
    return button


def _label(parent, text, bold=False):
    ctrl = wx.StaticText(parent, label=text)
    if bold:
        font = ctrl.GetFont()
        font.SetWeight(wx.FONTWEIGHT_BOLD)
        ctrl.SetFont(font)
    return ctrl


class AFMAnalysisWindow(wx.Frame):
    # Section key -> (tab title, builder-method name), in tab order.
    SECTIONS = (
        ('channels', 'Channels', '_build_channels'),
        ('level', 'Level', '_build_level'),
        ('regions', 'Regions', '_build_regions'),
        ('roughness', 'Roughness', '_build_roughness'),
        ('profile', 'Profile', '_build_profile'),
        ('particles', 'Grains', '_build_particles'),
        ('force', 'Force Curves', '_build_force'),
        # Last: the 3D view is a way of looking at the scan, not a step in
        # working on it, and it is the one tab that renders a sheet of its own.
        ('view3d', '3D', '_build_3d'),
    )
    SECTION_TITLES = {k: t for k, t, _b in SECTIONS}

    def __init__(self, parent, sheet_name, sections=None):
        keys = [k for k, _t, _b in self.SECTIONS]
        self._section_keys = ([s for s in (sections or keys) if s in keys]
                              or keys)
        single = len(self._section_keys) == 1
        if single:
            title = f'AFM {self.SECTION_TITLES[self._section_keys[0]]} — {sheet_name}'
        else:
            title = f'AFM Analysis — {sheet_name}'
        super().__init__(parent, title=title, size=(460, 620),
                         style=wx.DEFAULT_FRAME_STYLE | wx.FRAME_FLOAT_ON_PARENT)
        self.SetMinSize((460, 420))
        self.parent = parent
        self.sheet_name = sheet_name

        # Interactive state on the main canvas.
        self._mode = None                  # 'line'|'line_edit'|'force_pick'|'roi'
        self._cids = []
        self._roi_selector = None          # a live RectangleSelector
        self._roi_pending = None           # {'shape', 'mode'} while drawing
        self._roi_points = []
        self._new_line = False             # the next commit adds a line
        self._wrap_labels = []             # descriptions that rewrap on resize
        self._roi_scale_base = None        # geometry the size slider started from
        self._roi_edit_index = -1          # region being moved / resized
        self._roi_grab = None              # 'move' | 'resize'
        self._roi_anchor = None
        self._line = None                  # ((x0,y0),(x1,y1)) in image px
        self._line_start = None
        self._line_grab = None             # 'start' | 'end' | 'body'
        self._grab_anchor = None
        self._preview_artists = []
        self.line_width_px = 1
        self.profile_sheet_name = None

        panel = wx.Panel(self)
        self.notebook = wx.Notebook(panel)
        builders = {k: b for k, _t, b in self.SECTIONS}
        for key in self._section_keys:
            self.notebook.AddPage(getattr(self, builders[key])(),
                                  self.SECTION_TITLES[key])

        sizer = wx.BoxSizer(wx.VERTICAL)
        sizer.Add(self.notebook, 1, wx.EXPAND | wx.ALL, 5)
        panel.SetSizer(sizer)

        self.Bind(wx.EVT_CLOSE, self.on_close)
        self.CentreOnParent()

        if 'channels' in self._section_keys:
            self._refresh_channels()
        if 'regions' in self._section_keys:
            self._refresh_regions()
        if 'roughness' in self._section_keys:
            # Not computed on open: a number appears when Compute is pressed.
            self._refresh_roughness_regions()
            self._restore_roughness_overlay()
        if 'level' in self._section_keys:
            self._refresh_level_controls()
        if 'view3d' in self._section_keys:
            self.refresh_3d_controls()
        if 'profile' in self._section_keys:
            self._restore_profile_line()
        if 'particles' in self._section_keys:
            self._refresh_particle_controls()
        if 'force' in self._section_keys:
            self._refresh_force()

        # Register so arming a canvas interaction in one AFM window clears
        # the others — they all drive the single main canvas.
        if not hasattr(parent, '_afm_windows'):
            parent._afm_windows = []
        parent._afm_windows.append(self)

    # -- sheet access --------------------------------------------------------

    @property
    def sheet(self):
        return self.parent.Data.get('Core levels', {}).get(self.sheet_name, {})

    def _group_sheets(self):
        """Every AFM sheet imported from the same source file, in sheet order."""
        source = self.sheet.get('AFM_Source_File')
        levels = self.parent.Data.get('Core levels', {})
        return [(n, s) for n, s in levels.items()
                if isinstance(s, dict) and s.get('_afm')
                and (s.get('AFM_Source_File') == source or n == self.sheet_name)]

    def _map_sheets(self):
        """The group's measured channels — the 3D surface sheet is not one."""
        return [(n, s) for n, s in self._group_sheets()
                if s.get('_afm_kind') != '3d']

    def _sheet_3d(self):
        """(name, sheet) of the group's 3D surface sheet, or (None, None)."""
        for name, sheet in self._group_sheets():
            if sheet.get('_afm_kind') == '3d':
                return name, sheet
        return None, None

    def _volume_sheet(self):
        """(name, sheet) of the group member carrying the force volume."""
        for name, sheet in self._group_sheets():
            if sheet.get('_afm_volume'):
                return name, sheet
        return None, None

    def _leveled(self):
        return afm_array(self.sheet)

    def _redraw_main(self, preserve_view=False):
        plot_afm_image(self.parent, self.sheet_name,
                       preserve_view=preserve_view)

    def _persist(self):
        try:
            from libraries.FileMenu.KFitting_IO import persist_project
            persist_project(self.parent)
        except Exception as e:
            print(f'AFM persist skipped: {e}')

    def _px_scale(self):
        """(x, y) data-units per pixel of the displayed (cropped) image."""
        from libraries.ToolsMenu.AFM_Plot import afm_px_scale
        return afm_px_scale(self.sheet) or (1.0, 1.0)

    # -- canvas interaction plumbing ----------------------------------------

    @property
    def _line_live(self):
        """True while this window owns the profile line on the canvas."""
        return self._mode in ('line', 'line_edit')

    def _disconnect_cids(self):
        canvas = self.parent.plot_manager.canvas
        for cid in self._cids:
            try:
                canvas.mpl_disconnect(cid)
            except Exception:
                pass
        self._cids = []

    def _clear_preview(self):
        for artist in self._preview_artists:
            try:
                artist.remove()
            except Exception:
                pass
        self._preview_artists = []

    def _release_other_windows(self):
        for other in list(getattr(self.parent, '_afm_windows', [])):
            if other is self:
                continue
            try:
                if other._mode is not None or other._cids:
                    other._clear_interaction(cascade=False)
            except Exception:
                pass

    def _clear_selector(self):
        """Drop a live RectangleSelector (region or crop)."""
        selector = getattr(self, '_roi_selector', None)
        if selector is None:
            return
        try:
            selector.set_active(False)
            selector.disconnect_events()
        except Exception:
            pass
        self._roi_selector = None

    def _clear_interaction(self, redraw=False, cascade=True):
        if cascade:
            self._release_other_windows()
        self._disconnect_cids()
        self._clear_selector()
        self._mode = None
        self._line_start = None
        self._line_grab = None
        self._roi_points = []
        self._clear_preview()
        if redraw:
            try:
                self._redraw_main(preserve_view=True)
            except Exception:
                pass

    def on_close(self, event):
        self._clear_interaction(cascade=False)
        if getattr(self.parent, '_afm_cd_pick', None) is self:
            self.parent._afm_cd_pick = None
        try:
            self.parent._afm_windows.remove(self)
        except (AttributeError, ValueError):
            pass
        if getattr(self.parent, 'afm_analysis_window', None) is self:
            self.parent.afm_analysis_window = None
        event.Skip()

    # -- Channels ------------------------------------------------------------

    def _build_channels(self):
        panel = wx.Panel(self.notebook)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, 'Channels in this file', bold=True), 0, wx.ALL, 8)
        self.channel_list = wx.ListBox(panel, size=(-1, 130))
        self.channel_list.Bind(wx.EVT_LISTBOX, self.on_pick_channel)
        sizer.Add(self.channel_list, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(_label(panel, 'Colour map:'), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.palette_choice = wx.Choice(panel, choices=_palette_labels())
        self.palette_choice.Bind(wx.EVT_CHOICE, self.on_palette)
        row.Add(self.palette_choice, 1)
        sizer.Add(row, 0, wx.EXPAND | wx.ALL, 8)

        sizer.Add(wx.StaticLine(panel), 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)
        sizer.Add(_label(panel, 'Scan size', bold=True), 0, wx.ALL, 8)
        self.scale_text = _label(panel, '')
        sizer.Add(self.scale_text, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        grid = wx.FlexGridSizer(1, 2, 6, 6)
        grid.Add(_label(panel, 'Scan width (µm):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.scan_ctrl = wx.TextCtrl(panel, size=(120, -1))
        grid.Add(self.scan_ctrl)
        sizer.Add(grid, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        apply_btn = wx.Button(panel, label='Apply scan size to all channels')
        apply_btn.Bind(wx.EVT_BUTTON, self.on_apply_scan_size)
        sizer.Add(apply_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        sizer.Add(wx.StaticLine(panel), 0, wx.EXPAND | wx.ALL, 8)
        sizer.Add(_label(panel, 'Acquisition', bold=True), 0, wx.LEFT | wx.RIGHT, 8)
        self.info_text = wx.TextCtrl(panel, style=wx.TE_MULTILINE | wx.TE_READONLY,
                                     size=(-1, 140))
        sizer.Add(self.info_text, 1, wx.EXPAND | wx.ALL, 8)

        panel.SetSizer(sizer)
        return panel

    def _refresh_channels(self):
        sheets = self._map_sheets()
        self.channel_list.Set([n for n, _s in sheets])
        try:
            names = [n for n, _s in sheets]
            self.channel_list.SetSelection(names.index(self.sheet_name))
        except (ValueError, IndexError):
            pass

        sheet = self.sheet
        _select_palette(self.palette_choice, sheet.get('AFM_Scalar_CMap'))

        nm = sheet.get('AFM_NM_Per_Px')
        array = sheet.get('_afm_image')
        if nm and array is not None:
            array = np.asarray(array)
            self.scale_text.SetLabel(
                f'{nm:.5g} nm/pixel ({sheet.get("AFM_Scale_Source", "?")})\n'
                f'Field: {array.shape[1] * nm / 1000:.3g} µm wide')
            self.scan_ctrl.SetValue(f'{array.shape[1] * nm / 1000:.6g}')
            self.scale_text.SetForegroundColour(wx.NullColour)
        else:
            self.scale_text.SetLabel('Not calibrated — sizes are in pixels.')
            self.scale_text.SetForegroundColour(wx.Colour(160, 0, 0))

        info = sheet.get('ExperimentalInfo') or {}
        lines = [f'{k}: {v}' for k, v in info.items()]
        units = sheet.get('AFM_Units')
        if units:
            lines.insert(0, f'Channel: {sheet.get("AFM_Channel", "?")} ({units})')
        self.info_text.SetValue('\n'.join(lines))

    def refresh_palette_controls(self):
        """Re-read both palette combos after the project-wide AFM colour moved.

        Called from the main window when Style > AFM or Preferences changes
        it: the per-sheet entries still read 'Default', but what that default
        resolves to has changed, and the 3D tab may be showing it.
        """
        try:
            if 'channels' in self._section_keys:
                _select_palette(self.palette_choice,
                                self.sheet.get('AFM_Scalar_CMap'))
            if 'view3d' in self._section_keys:
                self.refresh_3d_controls()
        except Exception as e:
            print(f'AFM palette refresh skipped: {e}')

    def on_pick_channel(self, event):
        name = event.GetString()
        if not name or name == self.sheet_name:
            return
        self._clear_interaction()
        self.sheet_name = name
        try:
            self.parent.sheet_combobox.SetStringSelection(name)
        except Exception:
            pass
        from libraries.Sheet_Operations import on_sheet_selected
        on_sheet_selected(self.parent, name)
        self._refresh_channels()
        if 'level' in self._section_keys:
            self._refresh_level_controls()
        if 'view3d' in self._section_keys:
            self.refresh_3d_controls()
        if 'profile' in self._section_keys:
            self._restore_profile_line()

    def on_palette(self, event):
        value = _palette_value(self.palette_choice.GetStringSelection())
        if value:
            self.sheet['AFM_Scalar_CMap'] = value
        else:
            self.sheet.pop('AFM_Scalar_CMap', None)
        self._redraw_main(preserve_view=True)
        refresh_afm_companion(self.parent)
        self._persist()

    def on_apply_scan_size(self, event):
        try:
            width_um = float(self.scan_ctrl.GetValue())
        except ValueError:
            wx.MessageBox('Enter the scan width in micrometres.', 'AFM',
                          wx.OK | wx.ICON_WARNING)
            return
        if width_um <= 0:
            return
        for _name, sheet in self._group_sheets():
            array = sheet.get('_afm_image')
            if array is None:
                continue
            array = np.asarray(array)
            nm = width_um * 1000.0 / array.shape[1]
            sheet['AFM_NM_Per_Px'] = nm
            sheet['AFM_NM_Per_Px_Y'] = nm * array.shape[0] / array.shape[1] \
                if array.shape[0] != array.shape[1] else nm
            sheet['AFM_Scale_Source'] = 'manual'
        self._refresh_channels()
        self._redraw_main()
        refresh_afm_companion(self.parent)
        self._persist()

    # -- Level ---------------------------------------------------------------

    # Step 1, the 2-D background: flatten the image as a whole.
    _PLANE_CHOICES = (('none', 'None'), ('plane', 'Plane (1st order)'),
                      ('poly2', 'Polynomial, 2nd order'),
                      ('poly3', 'Polynomial, 3rd order'))
    # Step 2, the scan lines: Gwyddion's "Align Rows" methods, in its order.
    # Each is an estimate of a row's own offset; which one is right depends on
    # what the surface looks like, so they are laid out as a list to pick from
    # rather than buried in a dropdown.
    _LINE_CHOICES = (
        ('none', 'None'),
        ('median', 'Median'),
        ('median_diff', 'Median of differences'),
        ('modus', 'Modus'),
        ('matching', 'Matching'),
        ('facet', 'Facet-level tilt'),
        ('poly', 'Polynomial'),
        ('trimmed', 'Trimmed mean'),
        ('trimmed_diff', 'Trimmed mean of differences'))
    _LINE_HINTS = {
        'none': 'The scan lines are left as they were acquired.',
        'median': 'Subtract each line\'s median — the safe default.',
        'median_diff': 'Match each line to the previous one; keeps real\n'
                       'slow-axis shape on stepped samples.',
        'modus': 'Subtract each line\'s most common height: the\n'
                 'substrate level of a surface covered in features.',
        'matching': 'Robustly match neighbouring lines, ignoring where\n'
                    'they genuinely differ — for terraces and steps.',
        'facet': 'Remove each line\'s dominant local slope, then\n'
                 'match the offsets.',
        'poly': 'Subtract a polynomial of the degree below from\n'
                'each line.',
        'trimmed': 'Subtract each line\'s trimmed mean, dropping the\n'
                   'trim fraction from each tail.',
        'trimmed_diff': 'Trimmed mean of the difference to the previous\n'
                        'line.'}
    _DIRECTION_CHOICES = (('horizontal', 'Horizontal'),
                          ('vertical', 'Vertical'))
    _ZERO_CHOICES = (('min', 'Minimum to zero'), ('mean', 'Mean to zero'),
                     ('none', 'None'))

    def _build_level(self):
        panel = wx.ScrolledWindow(self.notebook)
        panel.SetScrollRate(0, 10)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, 'Flatten', bold=True), 0, wx.ALL, 8)
        sizer.Add(_label(panel,
                         'Remove the overall background first, then align the\n'
                         'scan lines. Everything here is applied to the display\n'
                         'and to every measurement; the stored data is never\n'
                         'modified.'),
                  0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        flat = wx.BoxSizer(wx.HORIZONTAL)
        flat.Add(_label(panel, 'Background:'), 0,
                 wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.plane_choice = wx.Choice(
            panel, choices=[t for _k, t in self._PLANE_CHOICES])
        flat.Add(self.plane_choice, 1, wx.RIGHT, 6)
        flat.Add(self._apply_button(panel, 'flatten'), 0)
        sizer.Add(flat, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        # A drop-down, not a column of nine radio buttons: the methods are
        # mutually exclusive either way, and the list costs one row instead of
        # nine on a tab that already has to scroll.
        rows = wx.BoxSizer(wx.HORIZONTAL)
        rows.Add(_label(panel, 'Align rows:'), 0,
                 wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.lines_choice = wx.Choice(
            panel, choices=[t for _k, t in self._LINE_CHOICES])
        self.lines_choice.Bind(wx.EVT_CHOICE,
                               lambda e: self._sync_level_enable())
        rows.Add(self.lines_choice, 1)
        sizer.Add(rows, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        grid = wx.FlexGridSizer(3, 2, 6, 6)
        grid.AddGrowableCol(1)
        grid.Add(_label(panel, 'Polynomial degree:'), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.degree_spin = wx.SpinCtrl(panel, min=1, max=5, initial=3)
        grid.Add(self.degree_spin, 0)
        grid.Add(_label(panel, 'Trim fraction (%):'), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.trim_spin = wx.SpinCtrlDouble(panel, min=0.0, max=49.0, inc=1.0,
                                           initial=5.0)
        self.trim_spin.SetDigits(2)
        grid.Add(self.trim_spin, 0)
        grid.Add(_label(panel, 'Direction:'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.direction_choice = wx.Choice(
            panel, choices=[t for _k, t in self._DIRECTION_CHOICES])
        grid.Add(self.direction_choice, 0)
        sizer.Add(grid, 0, wx.EXPAND | wx.ALL, 8)

        sizer.Add(self._apply_button(self.notebook and panel, 'rows',
                                     'Apply the row alignment'),
                  0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.line_hint = _label(panel, '')
        self.line_hint.SetForegroundColour(wx.Colour(90, 90, 90))
        sizer.Add(self.line_hint, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        sizer.Add(_label(panel, 'Then', bold=True), 0,
                  wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)
        self.scars_check = wx.CheckBox(
            panel, label='Remove scars (streaks from tip events)')
        sizer.Add(self.scars_check, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        zero = wx.BoxSizer(wx.HORIZONTAL)
        zero.Add(_label(panel, 'Zero reference:'), 0,
                 wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.zero_choice = wx.Choice(
            panel, choices=[t for _k, t in self._ZERO_CHOICES])
        zero.Add(self.zero_choice, 1, wx.RIGHT, 6)
        zero.Add(self._apply_button(panel, 'finish'), 0)
        sizer.Add(zero, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        buttons = wx.BoxSizer(wx.HORIZONTAL)
        default_btn = wx.Button(panel, label='Apply all three')
        default_btn.SetBackgroundColour(BRAND_WX)
        default_btn.Bind(wx.EVT_BUTTON, self.on_level_default)
        buttons.Add(default_btn, 1, wx.RIGHT, 6)
        reset_btn = wx.Button(panel, label='Reset (raw data)')
        reset_btn.Bind(wx.EVT_BUTTON, self.on_level_reset)
        buttons.Add(reset_btn, 1)
        sizer.Add(buttons, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        apply_all = wx.Button(panel,
                              label='Apply this leveling to every height channel')
        apply_all.Bind(wx.EVT_BUTTON, self.on_level_all)
        sizer.Add(apply_all, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        self.level_status = _label(panel, '')
        sizer.Add(self.level_status, 0, wx.ALL, 8)

        panel.SetSizer(sizer)
        return panel

    # Nothing on this tab touches the image until it is applied. A scan opens
    # as the instrument recorded it; the usual recipe is *selected* here, but
    # a correction the user did not ask for is not a correction, it is a
    # surprise — so each step has its own Apply and commits only its own keys.
    _LEVEL_STEPS = {'flatten': ('plane',),
                    'rows': ('lines', 'direction', 'degree', 'trim'),
                    'finish': ('scars', 'zero')}

    def _apply_button(self, panel, step, tip='Apply this step'):
        button = wx.Button(panel, label='Apply', size=(62, -1))
        button.SetBackgroundColour(BRAND_WX)
        button.SetToolTip(tip)
        button.Bind(wx.EVT_BUTTON, lambda e, s=step: self.on_apply_level(s))
        return button

    def _stored_level(self):
        """The recipe actually in force on the sheet — nothing, by default."""
        from libraries.ToolsMenu.AFM_Engine import DEFAULT_LEVEL
        level = self.sheet.get('AFM_Level')
        blank = dict(DEFAULT_LEVEL, plane='none', lines='none', scars=False,
                     zero='none')
        return dict(blank, **level) if isinstance(level, dict) else blank

    def on_apply_level(self, step):
        """Commit one step of the recipe and redraw."""
        wanted = self._level_from_controls()
        level = self._stored_level()
        for key in self._LEVEL_STEPS.get(step, ()):
            level[key] = wanted[key]
        self.sheet['AFM_Level'] = level
        self._after_level_change()
        names = {'flatten': 'Background', 'rows': 'Row alignment',
                 'finish': 'Scars and zero reference'}
        self.level_status.SetLabel(f'{names.get(step, "Leveling")} applied.')

    def _after_level_change(self):
        self._sync_level_enable()
        self._redraw_main(preserve_view=True)
        refresh_afm_companion(self.parent)
        self._persist()

    def _level_from_controls(self):
        return {'plane': self._PLANE_CHOICES[self.plane_choice.GetSelection()][0],
                'lines': self._LINE_CHOICES[self.lines_choice.GetSelection()][0],
                'direction':
                    self._DIRECTION_CHOICES[
                        self.direction_choice.GetSelection()][0],
                'degree': int(self.degree_spin.GetValue()),
                'trim': float(self.trim_spin.GetValue()),
                'scars': bool(self.scars_check.GetValue()),
                'zero': self._ZERO_CHOICES[self.zero_choice.GetSelection()][0]}

    def _refresh_level_controls(self):
        from libraries.ToolsMenu.AFM_Engine import DEFAULT_LEVEL

        # An untouched sheet shows the recipe it *would* get, so Apply is one
        # click away; the image itself is still raw until one is pressed.
        level = self.sheet.get('AFM_Level')
        if level is None:
            level = dict(DEFAULT_LEVEL)
        lines = level.get('lines', 'none')
        # A recipe written before the Gwyddion method set carried the degree
        # in the method name ('poly2'); split it back out.
        if lines in ('poly1', 'poly2', 'poly3'):
            level = dict(level, lines='poly', degree=int(lines[-1]))
        for choices, control, key, fallback in (
                (self._PLANE_CHOICES, self.plane_choice, 'plane', 'none'),
                (self._LINE_CHOICES, self.lines_choice, 'lines', 'none'),
                (self._DIRECTION_CHOICES, self.direction_choice, 'direction',
                 'horizontal'),
                (self._ZERO_CHOICES, self.zero_choice, 'zero', 'none')):
            keys = [k for k, _t in choices]
            value = level.get(key, fallback)
            control.SetSelection(keys.index(value)
                                 if value in keys else keys.index(fallback))
        self.degree_spin.SetValue(int(level.get('degree', 3) or 3))
        self.trim_spin.SetValue(float(level.get('trim', 5.0) or 0.0))
        self.scars_check.SetValue(bool(level.get('scars')))
        self._sync_level_enable()

    def _sync_level_enable(self):
        """Grey the controls the picked method does not use, as Gwyddion does."""
        method = self._LINE_CHOICES[self.lines_choice.GetSelection()][0]
        self.degree_spin.Enable(method == 'poly')
        self.trim_spin.Enable(method in ('trimmed', 'trimmed_diff'))
        self.direction_choice.Enable(method != 'none')
        self.line_hint.SetLabel(self._LINE_HINTS.get(method, ''))

    def on_level_changed(self, event):
        """Apply every step at once — the 'Apply all three' button."""
        self.sheet['AFM_Level'] = self._level_from_controls()
        self._after_level_change()
        self.level_status.SetLabel('Leveling applied.')

    def _select_level(self, choices, control, key):
        control.SetSelection([k for k, _t in choices].index(key))

    def on_level_default(self, event):
        """Back to the recipe a channel opens with (AFM_Engine.DEFAULT_LEVEL)."""
        from libraries.ToolsMenu.AFM_Engine import DEFAULT_LEVEL
        self._select_level(self._PLANE_CHOICES, self.plane_choice,
                           DEFAULT_LEVEL['plane'])
        self._select_level(self._LINE_CHOICES, self.lines_choice,
                           DEFAULT_LEVEL['lines'])
        self._select_level(self._ZERO_CHOICES, self.zero_choice,
                           DEFAULT_LEVEL['zero'])
        self._select_level(self._DIRECTION_CHOICES, self.direction_choice,
                           DEFAULT_LEVEL['direction'])
        self.scars_check.SetValue(bool(DEFAULT_LEVEL['scars']))
        self.on_level_changed(None)

    def on_level_reset(self, event):
        self._select_level(self._PLANE_CHOICES, self.plane_choice, 'none')
        self._select_level(self._LINE_CHOICES, self.lines_choice, 'none')
        self._select_level(self._ZERO_CHOICES, self.zero_choice, 'none')
        self._select_level(self._DIRECTION_CHOICES, self.direction_choice,
                           'horizontal')
        self.scars_check.SetValue(False)
        self.on_level_changed(None)

    def on_level_all(self, event):
        """Copy the current recipe to every length-unit channel of the group.

        Height and Z-sensor maps level meaningfully; a phase or potential map
        does not (its 'background' is signal), so only nm channels take it.
        """
        level = self.sheet.get('AFM_Level') or self._level_from_controls()
        count = 0
        for _name, sheet in self._group_sheets():
            if sheet.get('AFM_Units') == 'nm':
                sheet['AFM_Level'] = dict(level)
                count += 1
        self._redraw_main(preserve_view=True)
        refresh_afm_companion(self.parent)
        self._persist()
        self.level_status.SetLabel(f'Applied to {count} channel(s).')

    # -- Roughness -----------------------------------------------------------

    def _build_roughness(self):
        panel = wx.ScrolledWindow(self.notebook)
        panel.SetScrollRate(0, 10)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, 'Statistical quantities (ISO 25178)', bold=True),
                  0, wx.ALL, 8)
        blurb = _label(panel,
                       'Computed on the leveled image when you press Compute — '
                       'never on its own, so a number on screen is always one '
                       'you asked for. The height histogram and the PSD are in '
                       'the companion panel on the right.')
        self._wrap_labels.append(blurb)
        sizer.Add(blurb, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        # Which region, chosen from the ones the Regions tab defines rather
        # than drawn again here: a roughness quoted without saying where it
        # was measured is a roughness of something unknown.
        region_row = wx.BoxSizer(wx.HORIZONTAL)
        region_row.Add(_label(panel, 'Measure in:'), 0,
                       wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.roughness_choice = wx.Choice(panel, choices=['Whole image'])
        self.roughness_choice.SetSelection(0)
        self.roughness_choice.Bind(wx.EVT_CHOICE,
                                   lambda e: self.on_compute_roughness(None))
        region_row.Add(self.roughness_choice, 1, wx.RIGHT, 6)
        region_row.Add(_icon_button(panel, 'region',
                                    'DRAW A MEASUREMENT REGION\n\n'
                                    'Restrict the roughness to part of the '
                                    'scan.\n'
                                    'Asks for a shape (rectangle, circle or '
                                    'freehand),\n'
                                    'then draw it on the map:\n'
                                    '  rectangle - drag a box\n'
                                    '  circle    - drag from the centre '
                                    'outwards\n'
                                    '  freehand  - press, draw around, let '
                                    'go\n\n'
                                    'It is added to the Regions list as an '
                                    'include region.',
                                    self.on_roughness_region), 0,
                       wx.RIGHT, 4)
        region_row.Add(_icon_button(panel, 'compute',
                                    'COMPUTE ROUGHNESS\n\n'
                                    'Calculates the roughness statistics '
                                    '(Sa, Sq, Ssk,\n'
                                    'Sku, Sp, Sv, Sz...) of the levelled '
                                    'image, over the\n'
                                    'area chosen in "Measure in".\n\n'
                                    'Surface area, volume and slope values '
                                    'need a\n'
                                    'height channel in nm on a calibrated '
                                    'scan.',
                                    self.on_compute_roughness), 0)
        sizer.Add(region_row, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.roughness_region = _label(panel, '')
        self._wrap_labels.append(self.roughness_region)
        sizer.Add(self.roughness_region, 0,
                  wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.roughness_text = wx.TextCtrl(
            panel, style=wx.TE_MULTILINE | wx.TE_READONLY, size=(-1, 320))
        self.roughness_text.SetFont(wx.Font(9, wx.FONTFAMILY_TELETYPE,
                                            wx.FONTSTYLE_NORMAL,
                                            wx.FONTWEIGHT_NORMAL))
        sizer.Add(self.roughness_text, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        # The numbers belong on the picture they describe, at a size that
        # survives whatever the figure is exported at.
        on_image = wx.BoxSizer(wx.HORIZONTAL)
        self.roughness_on_map = wx.CheckBox(panel, label='Show on the image')
        self.roughness_on_map.Bind(wx.EVT_CHECKBOX, self.on_roughness_overlay)
        on_image.Add(self.roughness_on_map, 0,
                     wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 10)
        on_image.Add(_label(panel, 'Text size:'), 0,
                     wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.roughness_font = wx.SpinCtrl(panel, min=5, max=30, initial=9,
                                          size=(60, -1))
        self.roughness_font.Bind(wx.EVT_SPINCTRL, self.on_roughness_overlay)
        on_image.Add(self.roughness_font, 0, wx.RIGHT, 6)
        on_image.Add(_icon_button(panel, 'plot',
                                  'CHOOSE NUMBERS ON THE IMAGE\n\n'
                                  'Opens a list of the roughness values; '
                                  'tick the\n'
                                  'ones to print on the map when "Show on '
                                  'the\n'
                                  'image" is on.',
                                  self.on_pick_overlay_stats), 0)
        sizer.Add(on_image, 0, wx.EXPAND | wx.ALL, 8)

        panel.SetSizer(sizer)
        panel.Bind(wx.EVT_SIZE, self._on_panel_resize)
        return panel

    # -- what the roughness is measured over ---------------------------------

    _OVERLAY_KEYS = ('Sa', 'Sq', 'Sz', 'Ssk', 'Sku', 'Sdr')

    def _restore_roughness_overlay(self):
        """Put a stored on-image read-out back on its controls."""
        overlay = self.sheet.get('AFM_Roughness_Overlay') or {}
        if hasattr(self, 'roughness_on_map'):
            self.roughness_on_map.SetValue(bool(overlay.get('show')))
            self.roughness_font.SetValue(int(overlay.get('size') or 9))

    def _refresh_roughness_regions(self):
        """Fill the region menu from the regions the Regions tab defines."""
        if not hasattr(self, 'roughness_choice'):
            return
        rois = self.sheet.get('AFM_ROIs') or []
        labels = {k: t for k, t in self._ROI_SHAPES}
        items = ['Whole image']
        if rois:
            items.append('All regions')
        for i, roi in enumerate(rois):
            sense = 'exclude' if roi.get('mode') == 'exclude' else 'include'
            items.append(f"{i + 1}. {labels.get(roi.get('shape'), '?')}"
                         f' — {sense}')
        previous = self.roughness_choice.GetSelection()
        self.roughness_choice.Set(items)
        if rois and previous <= 0:
            # Drawing a region means wanting to measure in it; the menu is
            # for choosing *which*, not for turning them on. 'Whole image' is
            # still one pick away.
            self.roughness_choice.SetSelection(1)
        else:
            self.roughness_choice.SetSelection(
                previous if 0 <= previous < len(items) else 0)

    def _roughness_mask(self, array):
        """The mask the Roughness tab's region menu asks for."""
        if not hasattr(self, 'roughness_choice'):
            return self._analysis_mask(array)
        rois = self.sheet.get('AFM_ROIs') or []
        index = self.roughness_choice.GetSelection()
        if index <= 0 or array is None:
            return None
        if not rois:
            return None
        if index == 1:
            return self._analysis_mask(array)      # every region, as drawn
        roi = rois[index - 2] if index - 2 < len(rois) else None
        if roi is None:
            return None
        if roi.get('mode') == 'exclude':
            # One exclude, on its own, means "all of it except this".
            mask = ~roi_mask(array.shape, [dict(roi, mode='include')])
        else:
            # This include, minus every exclude — an exclude drawn inside an
            # include is a hole in the region (a scratch, a speck of dust),
            # and measuring "in that region" has to skip it whether the menu
            # is pointed at the one region or at all of them.
            excludes = [r for r in rois if r.get('mode') == 'exclude']
            mask = roi_mask(array.shape, [roi] + excludes)
        return None if mask.all() else mask

    def _ensure_region_controls(self):
        """Build the Regions tab's controls if this window has no such tab.

        A section opened on its own (the toolbar's ROI button) has one tab,
        and the roughness region has to work there too.
        """
        if not hasattr(self, 'roi_shape'):
            self._build_regions()

    def on_roughness_overlay(self, event):
        """Redraw the map with (or without) the numbers written on it."""
        self.sheet['AFM_Roughness_Overlay'] = {
            'show': bool(self.roughness_on_map.GetValue()),
            'size': int(self.roughness_font.GetValue()),
            'keys': list(self.sheet.get('AFM_Roughness_Overlay', {})
                         .get('keys') or self._OVERLAY_KEYS)}
        self._redraw_main(preserve_view=True)
        self._persist()

    def on_pick_overlay_stats(self, event):
        """Choose which numbers the image carries."""
        stats = self.sheet.get('AFM_Roughness') or {}
        available = [k for k in self._OVERLAY_KEYS if k in stats] or \
            list(self._OVERLAY_KEYS)
        current = (self.sheet.get('AFM_Roughness_Overlay') or {}).get(
            'keys') or self._OVERLAY_KEYS
        with wx.MultiChoiceDialog(self, 'Show on the image:',
                                  'Roughness overlay', available) as dialog:
            dialog.SetSelections([i for i, k in enumerate(available)
                                  if k in current])
            if dialog.ShowModal() != wx.ID_OK:
                return
            chosen = [available[i] for i in dialog.GetSelections()]
        overlay = dict(self.sheet.get('AFM_Roughness_Overlay') or {})
        overlay['keys'] = chosen
        overlay.setdefault('size', int(self.roughness_font.GetValue()))
        overlay['show'] = bool(self.roughness_on_map.GetValue())
        self.sheet['AFM_Roughness_Overlay'] = overlay
        self._redraw_main(preserve_view=True)
        self._persist()

    @staticmethod
    def _stat_row(label, value, unit, decimals=4):
        return f'{label:<26s}{value:>12.{decimals}g} {unit}'.rstrip()

    def on_roughness_region(self, event):
        """Draw a region to measure the roughness in, from the Roughness tab.

        The same regions the Regions tab manages — drawn from here because
        this is where the wish to restrict a measurement arises, and the
        answer has to say what it was measured over.
        """
        shape = ['Rectangle', 'Circle', 'Freehand']
        with wx.SingleChoiceDialog(self, 'Draw the region as a…',
                                   'Roughness region', shape) as dialog:
            if dialog.ShowModal() != wx.ID_OK:
                return
            picked = dialog.GetSelection()
        self._ensure_region_controls()
        self.roi_shape.SetSelection(picked)
        self.roi_mode.SetSelection(0)              # include
        self.on_draw_roi(None)
        self.roughness_region.SetLabel('Draw the region on the map…')

    def _show_roughness_region(self, mask):
        if not hasattr(self, 'roughness_region'):
            return
        rois = self.sheet.get('AFM_ROIs') or []
        if mask is None:
            self.roughness_region.SetLabel('Measured over the whole image.')
            return
        includes = sum(1 for r in rois if r.get('mode') != 'exclude')
        excludes = len(rois) - includes
        parts = []
        if includes:
            parts.append(f'{includes} include')
        if excludes:
            parts.append(f'{excludes} exclude')
        self.roughness_region.SetLabel(
            f"Measured over {' + '.join(parts)} region(s): "
            f"{mask.sum():,} px ({100.0 * mask.sum() / mask.size:.1f}% of "
            f"the image).")

    def on_compute_roughness(self, event, quiet=False):
        array = self._leveled()
        if array is None:
            if not quiet:
                wx.MessageBox('No image data.', 'AFM', wx.OK | wx.ICON_WARNING)
            return
        unit = self.sheet.get('AFM_Units', '')
        mask = self._roughness_mask(array)
        # The grain marking, when there is one, gives the grain-wise RMS.
        labels = self.sheet.get('_afm_labels')
        if labels is not None and np.shape(labels) != array.shape:
            labels = None
        stats = roughness_stats(array, mask, labels)
        nm = self.sheet.get('AFM_NM_Per_Px')
        # The hybrid quantities mix heights with lateral distances, so they
        # exist only for a length-unit channel on a calibrated scan.
        hybrid = {}
        if nm and unit == 'nm':
            nm_y = self.sheet.get('AFM_NM_Per_Px_Y') or nm
            stats['Sdr'] = surface_area_ratio(array, nm, nm_y, mask)
            hybrid = hybrid_stats(array, nm, nm_y, mask)
            stats.update(hybrid)
        if mask is not None:
            stats['Region Pixels'] = int(mask.sum())
        self.sheet['AFM_Roughness'] = stats
        self._show_roughness_region(mask)

        lines = ['Moment-based']
        for label, key, suffix in (
                ('  Average value', 'mean', unit),
                ('  RMS roughness (Sq)', 'Sq', unit),
                ('  RMS (grain-wise)', 'Sq_grainwise', unit),
                ('  Mean roughness (Sa)', 'Sa', unit),
                ('  Skew (Ssk)', 'Ssk', ''),
                ('  Excess kurtosis', 'Sku_excess', ''),
                ('  Kurtosis (Sku)', 'Sku', '')):
            lines.append(self._stat_row(label, stats.get(key, float('nan')),
                                        suffix))

        lines += ['', 'Order-based']
        for label, key in (('  Minimum', 'min'), ('  Maximum', 'max'),
                           ('  Median', 'median'),
                           ('  Max peak height (Sp)', 'Sp'),
                           ('  Max pit depth (Sv)', 'Sv'),
                           ('  Max height (Sz)', 'Sz')):
            lines.append(self._stat_row(label, stats.get(key, float('nan')),
                                        unit))

        if hybrid:
            # Areas and volumes are quoted in µm, the scale an AFM scan is
            # read at — nm² and nm³ run to eight and twelve digits.
            area = 1e-6
            lines += ['', 'Hybrid']
            lines.append(self._stat_row('  Projected area',
                                        hybrid['projected_area'] * area, 'µm²'))
            lines.append(self._stat_row('  Surface area',
                                        hybrid['surface_area'] * area, 'µm²'))
            lines.append(self._stat_row('  Volume',
                                        hybrid['volume'] * 1e-9, 'µm³'))
            lines.append(self._stat_row('  Surface slope (Sdq)',
                                        hybrid['Sdq'], ''))
            lines.append(self._stat_row('  Variation',
                                        hybrid['variation'] * area, 'µm²'))
            lines.append(self._stat_row('  Developed area (Sdr)',
                                        stats['Sdr'], '%'))
            lines.append(self._stat_row('  Inclination θ', hybrid['theta'],
                                        'deg'))
            lines.append(self._stat_row('  Inclination φ', hybrid['phi'],
                                        'deg'))

        lines += ['', 'Other']
        lines.append(self._stat_row('  Scan line discrepancy',
                                    stats.get('discrepancy', 0.0), ''))
        if mask is not None:
            lines.append(f'  Measured over {mask.sum():,} of {mask.size:,} '
                         f'pixels ({100.0 * mask.sum() / mask.size:.1f}%)')
        self.roughness_text.SetValue('\n'.join(lines))
        if not quiet:
            refresh_afm_companion(self.parent)
            self._persist()

    # -- 3D surface ----------------------------------------------------------

    # (label, mesh cap) — the largest surface grid the renderer builds. A 3D
    # axes depth-sorts every quad on every rotation, so a full 512 x 512 scan
    # would drag; the relief is legible well below that.
    _MESH_CHOICES = (('Coarse (fast)', 100), ('Normal', 200),
                     ('Fine (slow)', 400))

    def _build_3d(self):
        panel = wx.Panel(self.notebook)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, f"'{AFM_3D_SHEET}' surface", bold=True),
                  0, wx.ALL, 8)
        sizer.Add(_label(panel,
                         'The surface is a sheet of its own — select it to put\n'
                         'it on the main canvas, then drag to rotate. Every\n'
                         'control here redraws it, and the angle is remembered.'),
                  0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        grid = wx.FlexGridSizer(3, 2, 6, 6)
        grid.AddGrowableCol(1)
        grid.Add(_label(panel, 'Height channel:'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.source_choice = wx.Choice(panel, choices=[])
        self.source_choice.Bind(wx.EVT_CHOICE, self.on_3d_changed)
        grid.Add(self.source_choice, 1, wx.EXPAND)
        grid.Add(_label(panel, 'Colour map:'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.cmap_3d_choice = wx.Choice(panel, choices=_palette_labels())
        self.cmap_3d_choice.Bind(wx.EVT_CHOICE, self.on_3d_changed)
        grid.Add(self.cmap_3d_choice, 1, wx.EXPAND)
        grid.Add(_label(panel, 'Mesh detail:'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.mesh_choice = wx.Choice(
            panel, choices=[t for t, _v in self._MESH_CHOICES])
        self.mesh_choice.Bind(wx.EVT_CHOICE, self.on_3d_changed)
        grid.Add(self.mesh_choice, 1, wx.EXPAND)
        sizer.Add(grid, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.shade_check = wx.CheckBox(panel, label='Hill shading (lit surface)')
        self.shade_check.Bind(wx.EVT_CHECKBOX, self.on_3d_changed)
        sizer.Add(self.shade_check, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        # Sliders carry integers, so the exaggeration runs 10..400 for 0.1..4.0.
        self.zscale_slider = self._slider_row(panel, sizer, 'Height exaggeration',
                                              10, 400, 100)
        self.elev_slider = self._slider_row(panel, sizer, 'Elevation (°)',
                                            0, 90, 45)
        self.azim_slider = self._slider_row(panel, sizer, 'Rotation (°)',
                                            -180, 180, -60)

        self.build_3d_btn = wx.Button(panel, label=f"Create the {AFM_3D_SHEET} sheet")
        self.build_3d_btn.SetBackgroundColour(BRAND_WX)
        self.build_3d_btn.Bind(wx.EVT_BUTTON, self.on_build_3d)
        sizer.Add(self.build_3d_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.TOP, 8)

        reset_btn = wx.Button(panel, label='Reset the view')
        reset_btn.Bind(wx.EVT_BUTTON, self.on_reset_3d)
        sizer.Add(reset_btn, 0, wx.EXPAND | wx.ALL, 8)

        self.status_3d = _label(panel, '')
        sizer.Add(self.status_3d, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        panel.SetSizer(sizer)
        return panel

    def _slider_row(self, panel, sizer, label, low, high, value):
        """A labelled slider whose current value is shown beside it."""
        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(_label(panel, f'{label}:'), 0, wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        slider = wx.Slider(panel, value=value, minValue=low, maxValue=high)
        readout = _label(panel, '')
        slider._readout = readout
        slider.Bind(wx.EVT_SLIDER, self.on_3d_changed)
        row.Add(slider, 1, wx.ALIGN_CENTER_VERTICAL)
        row.Add(readout, 0, wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 6)
        sizer.Add(row, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)
        return slider

    def _view_3d_from_controls(self):
        names = [n for n, _s in self._map_sheets()]
        index = max(0, self.source_choice.GetSelection())
        mesh = self._MESH_CHOICES[max(0, self.mesh_choice.GetSelection())][1]
        return {'source': names[index] if index < len(names) else self.sheet_name,
                'cmap': _palette_value(self.cmap_3d_choice.GetStringSelection())
                        or 'auto',
                'mesh': int(mesh),
                'shade': bool(self.shade_check.GetValue()),
                'zscale': self.zscale_slider.GetValue() / 100.0,
                'elev': float(self.elev_slider.GetValue()),
                'azim': float(self.azim_slider.GetValue())}

    def refresh_3d_controls(self):
        """Put the stored view back on the controls.

        Also called from the canvas rotate hook, so dragging the surface moves
        the elevation and rotation sliders with it.
        """
        if 'view3d' not in self._section_keys:
            return
        name_3d, sheet_3d = self._sheet_3d()
        view = afm_3d_view(sheet_3d or {})

        names = [n for n, _s in self._map_sheets()]
        self.source_choice.Set(names)
        source = view.get('source') if name_3d else self.sheet_name
        self.source_choice.SetSelection(
            names.index(source) if source in names else 0)

        cmap = str(view.get('cmap') or 'auto')
        _select_palette(self.cmap_3d_choice, None if cmap == 'auto' else cmap)
        meshes = [v for _t, v in self._MESH_CHOICES]
        mesh = int(view.get('mesh') or AFM_3D_DEFAULTS['mesh'])
        self.mesh_choice.SetSelection(
            meshes.index(mesh) if mesh in meshes else 1)
        self.shade_check.SetValue(bool(view.get('shade', True)))
        self.zscale_slider.SetValue(int(round(float(view.get('zscale', 1.0)) * 100)))
        self.elev_slider.SetValue(int(round(float(view.get('elev', 45.0)))))
        self.azim_slider.SetValue(int(round(float(view.get('azim', -60.0)))))
        self._update_3d_readouts()

        self.build_3d_btn.SetLabel(f"Show the {name_3d} sheet" if name_3d
                                   else f"Create the {AFM_3D_SHEET} sheet")
        self.status_3d.SetLabel(
            f"'{name_3d}' renders {view.get('source')}." if name_3d
            else 'No 3D sheet in this group yet.')

    def _update_3d_readouts(self):
        self.zscale_slider._readout.SetLabel(
            f'{self.zscale_slider.GetValue() / 100.0:.2f}×')
        self.elev_slider._readout.SetLabel(f'{self.elev_slider.GetValue()}°')
        self.azim_slider._readout.SetLabel(f'{self.azim_slider.GetValue()}°')

    def on_3d_changed(self, event):
        self._update_3d_readouts()
        name_3d, sheet_3d = self._sheet_3d()
        if sheet_3d is None:
            return                      # nothing to restyle until it exists
        sheet_3d['AFM_3D'] = self._view_3d_from_controls()
        redraw_afm_3d(self.parent, name_3d)
        refresh_afm_companion(self.parent)
        self._persist()

    def on_build_3d(self, event):
        """Create the group's 3D sheet, or select it when it is already there."""
        from libraries.Sheet_Operations import on_sheet_selected

        name_3d, sheet_3d = self._sheet_3d()
        if sheet_3d is None:
            view = self._view_3d_from_controls()
            source = self.parent.Data.get('Core levels', {}).get(view['source'])
            if not isinstance(source, dict) or source.get('_afm_image') is None:
                wx.MessageBox('Pick a channel with an image to render.', 'AFM',
                              wx.OK | wx.ICON_WARNING)
                return
            name_3d, sheet_3d = make_afm_3d_sheet(view['source'], source, view)
            name_3d = register_afm_sheet(self.parent, name_3d, sheet_3d)
            self._persist()
        try:
            self.parent.sheet_combobox.SetStringSelection(name_3d)
        except Exception:
            pass
        on_sheet_selected(self.parent, name_3d)
        self.refresh_3d_controls()

    def on_reset_3d(self, event):
        self.zscale_slider.SetValue(int(AFM_3D_DEFAULTS['zscale'] * 100))
        self.elev_slider.SetValue(int(AFM_3D_DEFAULTS['elev']))
        self.azim_slider.SetValue(int(AFM_3D_DEFAULTS['azim']))
        self.cmap_3d_choice.SetSelection(0)
        self.shade_check.SetValue(bool(AFM_3D_DEFAULTS['shade']))
        self.mesh_choice.SetSelection(1)
        self.on_3d_changed(None)

    # -- Profile -------------------------------------------------------------

    def _build_profile(self):
        panel = wx.ScrolledWindow(self.notebook)
        panel.SetScrollRate(0, 10)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, 'Line profile', bold=True), 0, wx.ALL, 8)
        sizer.Add(self._blurb(panel,
                              'Click a start and an end point on the map. The '
                              'line stays editable: drag an end to swing it, '
                              'the middle to move it, scroll to change the '
                              'averaging width. The profile itself is drawn in '
                              'the companion panel.'),
                  0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        draw_btn = wx.Button(panel, label='Draw line on the map')
        draw_btn.SetBackgroundColour(BRAND_WX)
        draw_btn.Bind(wx.EVT_BUTTON, self.on_draw_line)
        sizer.Add(draw_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        self.line_list = wx.ListBox(panel, size=(-1, 90))
        self.line_list.SetToolTip('Every line drawn on this map. The selected '
                                  'one is the one profiled, measured and '
                                  'exported.')
        self.line_list.Bind(wx.EVT_LISTBOX, self.on_select_line)
        sizer.Add(self.line_list, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.TOP, 8)

        buttons = wx.BoxSizer(wx.HORIZONTAL)
        edit_btn = wx.Button(panel, label='Edit line')
        edit_btn.Bind(wx.EVT_BUTTON, self.on_edit_line)
        buttons.Add(edit_btn, 1, wx.RIGHT, 6)
        delete_btn = wx.Button(panel, label='Delete line')
        delete_btn.Bind(wx.EVT_BUTTON, self.on_delete_line)
        buttons.Add(delete_btn, 1, wx.RIGHT, 6)
        clear_btn = wx.Button(panel, label='Delete all')
        clear_btn.Bind(wx.EVT_BUTTON, self.on_delete_all_lines)
        buttons.Add(clear_btn, 1)
        sizer.Add(buttons, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.TOP, 8)

        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(_label(panel, 'Averaging width (px):'), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.width_ctrl = wx.SpinCtrl(panel, min=1, max=200, initial=1)
        self.width_ctrl.Bind(wx.EVT_SPINCTRL, self.on_width_changed)
        row.Add(self.width_ctrl)
        sizer.Add(row, 0, wx.ALL, 8)

        self.profile_hint = _label(panel, 'No line yet.')
        sizer.Add(self.profile_hint, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.profile_stats = _label(panel, '')
        sizer.Add(self.profile_stats, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        export_btn = wx.Button(panel, label='Add profile as AFM~Profile sheet')
        export_btn.Bind(wx.EVT_BUTTON, self.on_export_profile)
        sizer.Add(export_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        sizer.Add(wx.StaticLine(panel), 0, wx.EXPAND | wx.ALL, 4)
        sizer.Add(_label(panel, 'Measure a feature', bold=True), 0,
                  wx.LEFT | wx.RIGHT | wx.TOP, 8)
        sizer.Add(self._blurb(panel,
                              'Pick the feature on the profile, then measure '
                              'it: a hill is a positive step, a valley a '
                              'negative one, and a single transition an edge '
                              'read from the left or the right side.'),
                  0, wx.EXPAND | wx.ALL, 8)

        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(_label(panel, 'Feature:'), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.cd_choice = wx.Choice(
            panel, choices=[CD_LABELS[k] for k in CD_FUNCTIONS])
        self.cd_choice.SetSelection(0)
        self.cd_choice.Bind(wx.EVT_CHOICE, self.on_measure_feature)
        row.Add(self.cd_choice, 1)
        sizer.Add(row, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        cd_buttons = wx.BoxSizer(wx.HORIZONTAL)
        self.cd_pick_btn = wx.Button(panel, label='Pick range on the profile')
        self.cd_pick_btn.Bind(wx.EVT_BUTTON, self.on_pick_cd_range)
        cd_buttons.Add(self.cd_pick_btn, 1, wx.RIGHT, 6)
        whole_btn = wx.Button(panel, label='Whole profile')
        whole_btn.Bind(wx.EVT_BUTTON, self.on_cd_whole_profile)
        cd_buttons.Add(whole_btn, 1)
        sizer.Add(cd_buttons, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        measure_btn = wx.Button(panel, label='Measure')
        measure_btn.SetBackgroundColour(BRAND_WX)
        measure_btn.Bind(wx.EVT_BUTTON, self.on_measure_feature)
        sizer.Add(measure_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.cd_text = wx.TextCtrl(panel, style=wx.TE_MULTILINE | wx.TE_READONLY,
                                   size=(-1, 130))
        self.cd_text.SetFont(wx.Font(9, wx.FONTFAMILY_TELETYPE,
                                     wx.FONTSTYLE_NORMAL, wx.FONTWEIGHT_NORMAL))
        sizer.Add(self.cd_text, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        panel.SetSizer(sizer)
        panel.Bind(wx.EVT_SIZE, self._on_panel_resize)
        return panel

    # -- the lines drawn on this map -----------------------------------------
    #
    # A map usually needs more than one section, and losing the last one every
    # time a new one is drawn makes comparing two features impossible. So the
    # sheet keeps a list, and 'AFM_Profile_Line' is the selected one of that
    # list — the plotting, the companion and the exported AFM~Profile sheet
    # all still read that single key, so nothing else had to learn about the
    # list, and a project saved before it opens with its one line intact.

    def _lines(self):
        stored = self.sheet.get('AFM_Profile_Lines')
        if isinstance(stored, list) and stored:
            return [dict(item) for item in stored if isinstance(item, dict)]
        single = self.sheet.get('AFM_Profile_Line')
        if single and len(single) >= 4:
            return [{'points': [float(v) for v in single[:4]],
                     'width': max(1, int(self.sheet.get('AFM_Profile_Width')
                                         or 1))}]
        return []

    def _active_line_index(self):
        index = int(self.sheet.get('AFM_Profile_Active') or 0)
        return max(0, min(index, max(len(self._lines()) - 1, 0)))

    def _store_lines(self, lines, active=None):
        """Write the list back and re-point the single-line keys at the active one."""
        self.sheet['AFM_Profile_Lines'] = [dict(item) for item in lines] or None
        if not lines:
            self.sheet['AFM_Profile_Line'] = None
            self.sheet['AFM_Profile_Width'] = None
            self.sheet['AFM_Profile_Active'] = 0
            self._line = None
            return
        index = self._active_line_index() if active is None else active
        index = max(0, min(index, len(lines) - 1))
        self.sheet['AFM_Profile_Active'] = index
        points = [float(v) for v in lines[index]['points'][:4]]
        self.sheet['AFM_Profile_Line'] = points
        self.sheet['AFM_Profile_Width'] = int(lines[index].get('width') or 1)
        self._line = ((points[0], points[1]), (points[2], points[3]))
        self.line_width_px = int(lines[index].get('width') or 1)

    def _refresh_line_list(self):
        if not hasattr(self, 'line_list'):
            return
        lines = self._lines()
        scale = self.sheet.get('AFM_NM_Per_Px') or 1.0
        unit = 'nm' if self.sheet.get('AFM_NM_Per_Px') else 'px'
        labels = []
        for i, item in enumerate(lines):
            x0, y0, x1, y1 = [float(v) for v in item['points'][:4]]
            length = float(np.hypot(x1 - x0, y1 - y0)) * scale
            if unit == 'nm' and length > 2000:
                text = f'{length / 1000:.3g} µm'
            else:
                text = f'{length:.4g} {unit}'
            labels.append(f"{i + 1}. {text}, width {item.get('width', 1)} px")
        self.line_list.Set(labels)
        if lines:
            self.line_list.SetSelection(self._active_line_index())
        self.width_ctrl.SetValue(max(1, int(self.line_width_px)))

    def on_select_line(self, event):
        """Make the picked line the one everything works on."""
        lines = self._lines()
        index = self.line_list.GetSelection()
        if not lines or index < 0:
            return
        self._clear_interaction()
        self._store_lines(lines, index)
        self._update_profile_stats()
        self._refresh_cd()
        self._refresh_profile_sheet()
        self._redraw_main(preserve_view=True)
        refresh_afm_companion(self.parent)
        self._persist()

    def on_delete_all_lines(self, event):
        self._clear_interaction()
        self._store_lines([])
        self.sheet['AFM_Profile_CD'] = None
        self.sheet['AFM_Profile_CD_Range'] = None
        self._refresh_line_list()
        self.profile_hint.SetLabel('No line yet.')
        self.profile_stats.SetLabel('')
        self.cd_text.SetValue('')
        self._redraw_main(preserve_view=True)
        refresh_afm_companion(self.parent)
        self._persist()

    def _restore_profile_line(self):
        """Pick up the lines, widths and AFM~Profile sheet of a prior session."""
        for name, sheet in self.parent.Data.get('Core levels', {}).items():
            if (str(name).startswith('AFM~Profile')
                    and sheet.get('AFM_Source_Sheet') == self.sheet_name):
                self.profile_sheet_name = name
                break
        lines = self._lines()
        if lines:
            self._store_lines(lines)
            self._refresh_line_list()
            self._update_profile_stats()
            self._restore_cd()
        else:
            self._line = None
            self._refresh_line_list()
            self.profile_hint.SetLabel('No line yet.')
            self.profile_stats.SetLabel('')

    # drawing --------------------------------------------------------------

    def on_draw_line(self, event):
        self._clear_interaction()
        self._mode = 'line'
        self._new_line = True          # commit it as a new entry in the list
        self._line_start = None
        canvas = self.parent.plot_manager.canvas
        self._cids = [
            canvas.mpl_connect('button_press_event', self._on_line_click),
            canvas.mpl_connect('motion_notify_event', self._on_line_motion),
            canvas.mpl_connect('scroll_event', self._on_line_scroll),
        ]
        self.profile_hint.SetLabel('Click the start point on the map…')

    def on_edit_line(self, event):
        if self._line is None:
            self._restore_profile_line()
        if self._line is None:
            wx.MessageBox('Draw a line first.', 'AFM',
                          wx.OK | wx.ICON_INFORMATION)
            return
        self._start_line_editing()

    def on_delete_line(self, event):
        self._clear_interaction()
        lines = self._lines()
        index = self.line_list.GetSelection()
        if index < 0:
            index = self._active_line_index()
        if lines and 0 <= index < len(lines):
            lines.pop(index)
        self._store_lines(lines, min(index, len(lines) - 1) if lines else 0)
        self._refresh_line_list()
        # The feature measurement belonged to that profile, not to the map.
        self.sheet['AFM_Profile_CD'] = None
        self.sheet['AFM_Profile_CD_Range'] = None
        self.parent._afm_cd_pick = None
        self.profile_hint.SetLabel('Line deleted.' if lines else 'No line yet.')
        self.profile_stats.SetLabel('')
        self.cd_text.SetValue('')
        if lines:
            self._update_profile_stats()
        self._redraw_main(preserve_view=True)
        refresh_afm_companion(self.parent)
        self._persist()

    def on_width_changed(self, event):
        self.line_width_px = max(1, int(self.width_ctrl.GetValue()))
        if self._line is not None:
            self._apply_line_change()

    def _on_line_click(self, event):
        ax = self.parent.plot_manager.ax
        if self._mode != 'line' or event.inaxes is not ax \
                or event.button != 1 or event.xdata is None:
            return
        x_scale, y_scale = self._px_scale()
        point = (event.xdata / x_scale, event.ydata / y_scale)
        if self._line_start is None:
            self._line_start = point
            self.profile_hint.SetLabel(
                'Click the end point (scroll to set the width)…')
        else:
            self._line = (self._line_start, point)
            self._line_start = None
            self._apply_line_change()
            # Hand straight over to the editor: a line that can only be
            # redrawn from scratch is what made the first version unusable.
            self._start_line_editing()

    def _on_line_motion(self, event):
        ax = self.parent.plot_manager.ax
        if (self._mode != 'line' or self._line_start is None
                or event.inaxes is not ax or event.xdata is None):
            return
        x_scale, y_scale = self._px_scale()
        self._draw_line_preview(self._line_start,
                                (event.xdata / x_scale, event.ydata / y_scale))

    def _on_line_scroll(self, event):
        if self._mode not in ('line', 'line_edit'):
            return
        if event.button == 'up':
            self.line_width_px = min(200, self.line_width_px + 1)
        elif event.button == 'down':
            self.line_width_px = max(1, self.line_width_px - 1)
        self.width_ctrl.SetValue(self.line_width_px)
        if self._mode == 'line_edit' and self._line is not None:
            self._apply_line_change()
        elif (self._line_start is not None and event.xdata is not None
                and event.ydata is not None):
            x_scale, y_scale = self._px_scale()
            self._draw_line_preview(
                self._line_start,
                (event.xdata / x_scale, event.ydata / y_scale))

    # editing --------------------------------------------------------------

    def _start_line_editing(self):
        self._disconnect_cids()
        self._mode = 'line_edit'
        self._line_grab = None
        canvas = self.parent.plot_manager.canvas
        self._cids = [
            canvas.mpl_connect('button_press_event', self._on_line_grab),
            canvas.mpl_connect('motion_notify_event', self._on_line_drag),
            canvas.mpl_connect('button_release_event', self._on_line_drop),
            canvas.mpl_connect('scroll_event', self._on_line_scroll),
        ]
        self._draw_line_final()
        self.profile_hint.SetLabel(
            'Drag an end to swing, the middle to move, scroll for width.')

    def _line_display_points(self):
        """The line's two ends in display pixels, for hit testing.

        Hit testing in data units cannot work: the same tolerance is several
        pixels on a 500 nm scan and invisible on an 80 µm one.
        """
        ax = self.parent.plot_manager.ax
        x_scale, y_scale = self._px_scale()
        (x0, y0), (x1, y1) = self._line
        return [ax.transData.transform((x0 * x_scale, y0 * y_scale)),
                ax.transData.transform((x1 * x_scale, y1 * y_scale))]

    def _distance_to_line(self, px, py):
        (sx, sy), (ex, ey) = self._line_display_points()
        vx, vy = ex - sx, ey - sy
        length_sq = vx * vx + vy * vy
        if length_sq <= 0:
            return np.hypot(px - sx, py - sy)
        t = max(0.0, min(1.0, ((px - sx) * vx + (py - sy) * vy) / length_sq))
        return np.hypot(px - (sx + t * vx), py - (sy + t * vy))

    def _on_line_grab(self, event):
        ax = self.parent.plot_manager.ax
        if (self._mode != 'line_edit' or self._line is None
                or event.inaxes is not ax or event.button != 1):
            return
        (sx, sy), (ex, ey) = self._line_display_points()
        near_start = np.hypot(event.x - sx, event.y - sy)
        near_end = np.hypot(event.x - ex, event.y - ey)
        if near_start < 12 and near_start <= near_end:
            self._line_grab = 'start'
        elif near_end < 12:
            self._line_grab = 'end'
        elif self._distance_to_line(event.x, event.y) < 12:
            self._line_grab = 'body'
            x_scale, y_scale = self._px_scale()
            self._grab_anchor = (event.xdata / x_scale, event.ydata / y_scale)
        else:
            self._line_grab = None

    def _on_line_drag(self, event):
        ax = self.parent.plot_manager.ax
        if (self._mode != 'line_edit' or not self._line_grab
                or event.inaxes is not ax or event.xdata is None):
            return
        x_scale, y_scale = self._px_scale()
        point = (event.xdata / x_scale, event.ydata / y_scale)
        start, end = self._line
        if self._line_grab == 'start':
            self._line = (point, end)
        elif self._line_grab == 'end':
            self._line = (start, point)
        else:
            dx = point[0] - self._grab_anchor[0]
            dy = point[1] - self._grab_anchor[1]
            self._line = ((start[0] + dx, start[1] + dy),
                          (end[0] + dx, end[1] + dy))
            self._grab_anchor = point
        self._draw_line_final()

    def _on_line_drop(self, event):
        if self._mode != 'line_edit' or not self._line_grab:
            return
        self._line_grab = None
        self._apply_line_change()

    # rendering + the single change funnel ---------------------------------

    def _draw_line_preview(self, p0, p1):
        ax = self.parent.plot_manager.ax
        self._clear_preview()
        x_scale, y_scale = self._px_scale()
        self._preview_artists = draw_profile_artists(
            ax, p0, p1, x_scale, y_scale, self.line_width_px)
        self.parent.plot_manager.canvas.draw_idle()

    def _draw_line_final(self):
        if self._line is not None:
            self._draw_line_preview(self._line[0], self._line[1])

    def _apply_line_change(self):
        """Store the line, redraw it, and recompute everything it feeds.

        Every edit funnels through here, so the drawn line, the exported
        sheet, the stats and the companion view can never drift apart.
        """
        if self._line is None:
            return
        (x0, y0), (x1, y1) = self._line
        points = [float(x0), float(y0), float(x1), float(y1)]
        lines = self._lines()
        index = self._active_line_index()
        entry = {'points': points, 'width': int(self.line_width_px)}
        if self._new_line or not lines:
            lines.append(entry)
            index = len(lines) - 1
            self._new_line = False
        else:
            lines[index] = entry
        self._store_lines(lines, index)
        self._refresh_line_list()
        self._draw_line_final()
        self._update_profile_stats()
        self._refresh_cd()
        self._refresh_profile_sheet()
        refresh_afm_companion(self.parent)
        self._persist()

    def _profile_data(self):
        """(distances in physical units, values, x label) or None."""
        if self._line is None:
            return None
        array = self._leveled()
        if array is None:
            return None
        distance_px, values = line_profile(array, self._line[0], self._line[1],
                                           self.line_width_px)
        if distance_px.size == 0:
            return None
        nm = self.sheet.get('AFM_NM_Per_Px')
        if nm:
            distances = distance_px * nm
            x_label = 'Distance (nm)'
            if distances[-1] > 2000.0:
                distances = distances / 1000.0
                x_label = 'Distance (µm)'
        else:
            distances = distance_px
            x_label = 'Distance (px)'
        return distances, values, x_label

    def _update_profile_stats(self):
        data = self._profile_data()
        if data is None:
            return
        distances, values, x_label = data
        unit = self.sheet.get('AFM_Units', '')
        stats = profile_roughness(values)
        step = step_height(distances, values)
        length_unit = x_label.split('(')[1].rstrip(')')
        self.profile_hint.SetLabel(
            f'Line: {distances[-1]:.4g} {length_unit} long, '
            f'averaging width {self.line_width_px} px.')
        self.profile_stats.SetLabel(
            f"Ra {stats['Ra']:.4g}  Rq {stats['Rq']:.4g}  "
            f"Rz {stats['Rz']:.4g} {unit}\n"
            f"Step height (half vs half): {step:.4g} {unit}")

    def _refresh_profile_sheet(self):
        """Recompute the linked AFM~Profile sheet after the line moved."""
        if not self.profile_sheet_name:
            return
        sheet = self.parent.Data.get('Core levels', {}).get(
            self.profile_sheet_name)
        if not sheet:
            self.profile_sheet_name = None
            return
        data = self._profile_data()
        if data is None:
            return
        distances, values, x_label = data
        stats = profile_roughness(values)
        sheet['B.E.'] = [float(v) for v in distances]
        sheet['Raw Data'] = [float(v) for v in values]
        sheet['AFM_X_Label'] = x_label
        sheet['AFM_Profile_Stats'] = stats
        if isinstance(sheet.get('Background'), dict):
            sheet['Background']['Bkg Y'] = [float(v) for v in values]
        if self.parent.sheet_combobox.GetValue() == self.profile_sheet_name:
            try:
                self.parent.plot_manager.clear_and_replot(self.parent)
            except Exception:
                pass

    def on_export_profile(self, event):
        data = self._profile_data()
        if data is None:
            wx.MessageBox('Draw a line on the map first.', 'AFM',
                          wx.OK | wx.ICON_INFORMATION)
            return
        distances, values, x_label = data
        unit = self.sheet.get('AFM_Units', '')
        stats = profile_roughness(values)

        name = 'AFM~Profile'
        profile_sheet = {
            'Name': name,
            'B.E.': [float(v) for v in distances],
            'Raw Data': [float(v) for v in values],
            'AFM_X_Label': x_label,
            'AFM_Y_Label': f'{self.sheet.get("AFM_Channel", "Value")} ({unit})',
            'AFM_Source_Sheet': self.sheet_name,
            'ExperimentalInfo': {'Technique': 'AFM',
                                 'Content': 'Line profile',
                                 'Source Sheet': self.sheet_name,
                                 'Averaging Width (px)': int(self.line_width_px)},
            'Background': {'Bkg Y': [float(v) for v in values],
                           'Bkg Type': '', 'Bkg Low': '', 'Bkg High': '',
                           'Bkg Offset Low': 0, 'Bkg Offset High': 0},
            'Fitting': {'Peaks': {}},
            'AFM_Profile_Stats': stats,
        }
        if 'Core levels' not in self.parent.Data:
            self.parent.Data['Core levels'] = {}
        base, counter = name, 2
        while name in self.parent.Data['Core levels']:
            name = f'{base}{counter}'
            counter += 1
        profile_sheet['Name'] = name
        self.parent.Data['Core levels'][name] = profile_sheet
        self.parent.Data['Number of Core levels'] = \
            len(self.parent.Data['Core levels'])
        try:
            if name not in list(self.parent.sheet_combobox.GetStrings()):
                self.parent.sheet_combobox.Append(name)
        except Exception:
            pass
        self.profile_sheet_name = name
        refresh_afm_companion(self.parent)
        self._persist()
        self.profile_hint.SetLabel(
            f"Added '{name}' — the line now updates it as you move it.")

    # critical dimensions ----------------------------------------------------

    def _cd_kind(self):
        return CD_FUNCTIONS[max(self.cd_choice.GetSelection(), 0)]

    def _cd_length_unit(self):
        data = self._profile_data()
        return data[2].split('(')[1].rstrip(')') if data else ''

    def on_pick_cd_range(self, event):
        """Arm a drag on the companion profile to select the feature."""
        if self._profile_data() is None:
            wx.MessageBox('Draw a line on the map first.', 'AFM',
                          wx.OK | wx.ICON_INFORMATION)
            return
        self.parent._afm_cd_pick = self
        self.parent._afm_cd_drag = None
        self.cd_text.SetValue('Drag across the feature on the profile in the\n'
                              'companion panel on the right.')

    def on_cd_range_drag(self, start, end, done):
        """Called back by the companion while a range is being dragged."""
        if abs(end - start) <= 0:
            return False
        self.sheet['AFM_Profile_CD_Range'] = [float(min(start, end)),
                                              float(max(start, end))]
        if done:
            self.on_measure_feature(None)
        return True

    def on_cd_whole_profile(self, event):
        self.parent._afm_cd_pick = None
        self.sheet['AFM_Profile_CD_Range'] = None
        self.on_measure_feature(None)

    def on_measure_feature(self, event):
        data = self._profile_data()
        if data is None:
            self.cd_text.SetValue('Draw a line on the map first.')
            return
        distances, values, _x_label = data
        picked = self.sheet.get('AFM_Profile_CD_Range')
        x_from, x_to = (picked if picked and len(picked) == 2 else (None, None))
        kind = self._cd_kind()
        result = critical_dimension(distances, values, kind, x_from, x_to)
        self.sheet['AFM_Profile_CD'] = result
        self._show_cd_result(result)
        refresh_afm_companion(self.parent)
        self._persist()

    def _show_cd_result(self, result):
        unit = self.sheet.get('AFM_Units', '')
        length = self._cd_length_unit()
        if not result:
            self.cd_text.SetValue(
                'No feature of that shape in the selection —\n'
                'try the other sign, or pick a tighter range.')
            return
        if result.get('radius'):
            self.cd_text.SetValue('\n'.join([
                CD_LABELS[result['kind']],
                f"r  = {result['radius']:.5g} {length}",
                f"centre ({result['cx']:.4g} {length}, "
                f"{result['cy']:.4g} {unit})",
                f"rise {result['h']:.4g} {unit} over "
                f"{result['width']:.4g} {length}",
                f"residual RMS {result['rms']:.3g} "
                f"({result['n']} points)"]))
            return
        lines = [CD_LABELS[result['kind']],
                 f"h  = {result['h']:.5g} ± {result['h_err']:.3g} {unit}",
                 f"y1 = {result['y1']:.5g} ± {result['y1_err']:.3g} {unit}",
                 f"y2 = {result['y2']:.5g} ± {result['y2_err']:.3g} {unit}",
                 f"x1 = {result['x1']:.5g} {length}"]
        if result['x2'] is not None:
            lines.append(f"x2 = {result['x2']:.5g} {length}")
            lines.append(f"w  = {result['width']:.5g} {length}")
        lines.append(f"over {result['x_from']:.4g} to {result['x_to']:.4g} "
                     f"{length} ({result['n']} points)")
        self.cd_text.SetValue('\n'.join(lines))

    def _restore_cd(self):
        """Put a stored measurement back on the tab and its range on the plot."""
        result = self.sheet.get('AFM_Profile_CD')
        if isinstance(result, dict) and result.get('kind') in CD_FUNCTIONS:
            self.cd_choice.SetSelection(CD_FUNCTIONS.index(result['kind']))
            self._show_cd_result(result)

    def _refresh_cd(self):
        """Re-measure after the line moved, so the number follows the feature."""
        if not isinstance(self.sheet.get('AFM_Profile_CD'), dict):
            return
        data = self._profile_data()
        if data is None:
            return
        distances, values, _x_label = data
        picked = self.sheet.get('AFM_Profile_CD_Range')
        x_from, x_to = (picked if picked and len(picked) == 2 else (None, None))
        result = critical_dimension(distances, values, self._cd_kind(),
                                    x_from, x_to)
        self.sheet['AFM_Profile_CD'] = result
        self._show_cd_result(result)

    # -- Regions & crop ------------------------------------------------------

    _ROI_SHAPES = (('rect', 'Rectangle'), ('circle', 'Circle'),
                   ('polygon', 'Freehand'))

    def _build_regions(self):
        panel = wx.ScrolledWindow(self.notebook)
        panel.SetScrollRate(0, 10)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, 'Regions of interest', bold=True), 0, wx.ALL, 8)
        # Wrapped to the panel rather than hand-broken: the tab is resizable
        # and hard line breaks leave half the width empty at any other size.
        blurb = _label(panel,
                       'Restrict the roughness and the grain count to the part '
                       'of the scan you mean. Include regions are the only ones '
                       'measured; exclude regions are dropped from whatever is '
                       'left, so one exclude alone means "all of it except '
                       'this".')
        self._wrap_labels.append(blurb)
        sizer.Add(blurb, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        shapes = wx.BoxSizer(wx.HORIZONTAL)
        shapes.Add(_label(panel, 'Draw:'), 0,
                   wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.roi_shape = wx.Choice(
            panel, choices=[t for _k, t in self._ROI_SHAPES])
        self.roi_shape.SetSelection(0)
        self.roi_shape.Hide()          # the icon buttons drive it now
        self.roi_mode = wx.Choice(panel, choices=['Include', 'Exclude'])
        self.roi_mode.SetSelection(0)
        self.roi_mode.Hide()
        self._shape_buttons = {}
        for key, tip in (('rect', 'RECTANGLE REGION\n\n'
                                  'Click, then drag a box on the map to add '
                                  'a\n'
                                  'rectangular region. Include or exclude '
                                  'follows\n'
                                  'the two buttons to the right.'),
                         ('circle', 'CIRCLE REGION\n\n'
                                    'Click, then drag on the map from the '
                                    'centre\n'
                                    'outwards to add a circular region.'),
                         ('freehand', 'FREEHAND REGION\n\n'
                                      'Click, then press on the map, draw '
                                      'around the\n'
                                      'area you want and let go to close '
                                      'it.')):
            button = _icon_button(panel, key, tip,
                                  lambda e, k=key: self.on_pick_shape(k))
            self._shape_buttons[key] = button
            shapes.Add(button, 0, wx.RIGHT, 4)
        shapes.AddSpacer(10)
        self._mode_buttons = {}
        for key, tip in (('include', 'INCLUDE MODE\n\n'
                                     'The next region you draw is measured '
                                     'in: only\n'
                                     'the include regions are analysed.'),
                         ('exclude', 'EXCLUDE MODE\n\n'
                                     'The next region you draw is left out '
                                     'of the\n'
                                     'analysis (e.g. dust or a scar). One '
                                     'exclude\n'
                                     'alone means all the image except '
                                     'it.')):
            button = _icon_button(panel, key, tip,
                                  lambda e, k=key: self.on_pick_mode(k))
            self._mode_buttons[key] = button
            shapes.Add(button, 0, wx.RIGHT, 4)
        sizer.Add(shapes, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.roi_list = wx.ListBox(panel, size=(-1, 110))
        self.roi_list.Bind(wx.EVT_LISTBOX, self.on_select_roi)
        sizer.Add(self.roi_list, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        actions = wx.BoxSizer(wx.HORIZONTAL)
        for glyph, tip, handler in (
                ('move', 'MOVE / RESIZE REGION\n\n'
                         'Select a region in the list, click this, then '
                         'on\n'
                         'the map:\n'
                         '  drag inside it     - move it\n'
                         '  drag near an edge  - resize it',
                 self.on_edit_roi),
                ('crop', 'CROP TO REGION\n\n'
                         'Makes a new AFM sheet holding only the box '
                         'around\n'
                         'the selected region. This sheet is left as it '
                         'is.', self.on_crop_to_region),
                ('exclude', 'SWITCH INCLUDE / EXCLUDE\n\n'
                            'Turns the selected region from include to '
                            'exclude,\n'
                            'or back.', self.on_flip_roi),
                ('delete', 'DELETE REGION\n\n'
                           'Removes the region selected in the list.',
                 self.on_delete_roi),
                ('clear', 'DELETE ALL REGIONS\n\n'
                          'Removes every region from this map (no '
                          'confirmation).', self.on_clear_rois)):
            actions.Add(_icon_button(panel, glyph, tip, handler), 0, wx.RIGHT, 4)
        sizer.Add(actions, 0, wx.ALL, 8)

        size_row = wx.BoxSizer(wx.HORIZONTAL)
        size_row.Add(_label(panel, 'Size:'), 0,
                     wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        # A freehand blob is drawn by hand and never quite the right size;
        # this scales the selected region about its own centre, which works
        # for any shape and is the only way to resize a blob precisely.
        self.roi_scale = wx.Slider(panel, value=100, minValue=20, maxValue=300,
                                   style=wx.SL_HORIZONTAL)
        self.roi_scale.SetToolTip('Grow or shrink the selected region about '
                                  'its centre.')
        self.roi_scale.Bind(wx.EVT_SLIDER, self.on_scale_roi)
        self.roi_scale.Bind(wx.EVT_SCROLL_CHANGED, self.on_scale_roi_done)
        size_row.Add(self.roi_scale, 1)
        sizer.Add(size_row, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.roi_status = _label(panel, '')
        self._wrap_labels.append(self.roi_status)
        sizer.Add(self.roi_status, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM,
                  8)

        sizer.Add(wx.StaticLine(panel), 0, wx.EXPAND | wx.ALL, 4)
        sizer.Add(_label(panel, 'Crop', bold=True), 0, wx.ALL, 8)
        crop_blurb = _label(panel,
                            'Drag a rectangle and it becomes an AFM sheet of '
                            'its own — this one is left alone. The pixel size '
                            'is unchanged, so sizes and roughness stay valid, '
                            'and the levelling is refitted to the patch you '
                            'kept.')
        self._wrap_labels.append(crop_blurb)
        sizer.Add(crop_blurb, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.crop_text = _label(panel, '')
        self._wrap_labels.append(self.crop_text)
        sizer.Add(self.crop_text, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM,
                  8)

        crop_buttons = wx.BoxSizer(wx.HORIZONTAL)
        crop_buttons.Add(_icon_button(panel, 'crop',
                                      'CROP\n\n'
                                      'Click, then drag a rectangle on the '
                                      'map. The patch\n'
                                      'becomes a new AFM sheet; this one '
                                      'is unchanged.\n'
                                      'The pixel size is kept, so sizes and '
                                      'roughness\n'
                                      'stay valid.', self.on_draw_crop),
                         0, wx.RIGHT, 4)
        crop_buttons.Add(_icon_button(panel, 'clear',
                                      'UNDO IN-PLACE CROP\n\n'
                                      'Restores the full image on a sheet '
                                      'that older\n'
                                      'projects cropped in place. Regions, '
                                      'the profile\n'
                                      'line and grain overlay are cleared, '
                                      'as their\n'
                                      'pixel positions no longer match.',
                                      self.on_reset_crop), 0)
        sizer.Add(crop_buttons, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        panel.SetSizer(sizer)
        panel.Bind(wx.EVT_SIZE, self._on_panel_resize)
        self._sync_roi_buttons()
        return panel

    def _blurb(self, panel, text):
        """A description that rewraps to the tab's width.

        Written as one string, never hand-broken: the window is resizable and
        a line break chosen for a 460 px tab leaves half the width empty at
        any other size, or overflows when the user narrows it.
        """
        label = _label(panel, text)
        self._wrap_labels.append(label)
        return label

    def _rewrap(self, width):
        for label in self._wrap_labels:
            try:
                label.SetLabel(label.GetLabel().replace('\n', ' '))
                label.Wrap(width)
            except Exception:
                pass

    def _on_panel_resize(self, event):
        """Rewrap the descriptions to whatever width the tab now has."""
        self._rewrap(max(event.GetSize().width - 24, 120))
        event.Skip()

    def _on_panel_resize_now(self):
        """Rewrap after a status line has been rewritten, not resized.

        A label given new text keeps the old wrap and runs off the edge, so
        anything that calls SetLabel on a wrapped label has to follow it here.
        """
        page = self.notebook.GetCurrentPage() if self.notebook else None
        if page is None:
            return
        self._rewrap(max(page.GetSize().width - 24, 120))
        page.Layout()

    def on_pick_shape(self, key):
        """Pick the shape and arm the drawing in one click."""
        index = [k for k, _t in self._ROI_SHAPES].index(
            {'rect': 'rect', 'circle': 'circle', 'freehand': 'polygon'}[key])
        self.roi_shape.SetSelection(index)
        self._sync_roi_buttons()
        self.on_draw_roi(None)

    def on_pick_mode(self, key):
        self.roi_mode.SetSelection(1 if key == 'exclude' else 0)
        self._sync_roi_buttons()
        self.roi_status.SetLabel(
            f"The next region will be {'left out' if key == 'exclude' else 'measured in'}.")

    def _sync_roi_buttons(self):
        """Show which shape and which sense the next region will have."""
        shape = self._ROI_SHAPES[self.roi_shape.GetSelection()][0]
        active = {'rect': 'rect', 'circle': 'circle', 'polygon': 'freehand'}
        for key, button in self._shape_buttons.items():
            on = key == active.get(shape)
            button.SetWindowStyleFlag(button.GetWindowStyleFlag())
            button.SetBackgroundColour(BRAND_WX if on else wx.NullColour)
            button.Refresh()
        mode = 'exclude' if self.roi_mode.GetSelection() == 1 else 'include'
        for key, button in self._mode_buttons.items():
            button.SetBackgroundColour(BRAND_WX if key == mode
                                       else wx.NullColour)
            button.Refresh()

    def on_crop_to_region(self, event):
        """Crop the image to the bounding box of the selected region."""
        rois = self.sheet.get('AFM_ROIs') or []
        index = self.roi_list.GetSelection()
        if index < 0 or index >= len(rois):
            self.roi_status.SetLabel('Pick a region in the list first.')
            return
        from libraries.ToolsMenu.AFM_Engine import _roi_shape_mask
        array = self._leveled()
        if array is None:
            return
        mask = _roi_shape_mask(array.shape, rois[index])
        if not mask.any():
            self.roi_status.SetLabel('That region covers no pixels.')
            return
        rows = np.flatnonzero(mask.any(axis=1))
        cols = np.flatnonzero(mask.any(axis=0))
        offset = self.sheet.get('AFM_Crop') or [0, 0, 0, 0]
        box = [int(cols[0]) + int(offset[0]), int(rows[0]) + int(offset[1]),
               int(cols[-1]) + 1 + int(offset[0]),
               int(rows[-1]) + 1 + int(offset[1])]
        if box[2] - box[0] < 8 or box[3] - box[1] < 8:
            self.roi_status.SetLabel('That region is too small to crop to.')
            return
        self._make_crop_sheet(box)

    def on_scale_roi(self, event):
        """Preview the selected region grown or shrunk about its centre."""
        rois = self.sheet.get('AFM_ROIs') or []
        index = self.roi_list.GetSelection()
        if index < 0 or index >= len(rois):
            return
        if self._roi_scale_base is None:
            self._roi_scale_base = [float(v)
                                    for v in rois[index].get('points') or []]
        factor = max(self.roi_scale.GetValue(), 1) / 100.0
        points = np.asarray(self._roi_scale_base, dtype=float)
        roi = dict(rois[index])
        if roi.get('shape') == 'circle' and points.size >= 3:
            points[2] = max(points[2] * factor, 1.0)
        else:
            (cx, cy), _size = self._roi_geometry(
                {'shape': roi.get('shape'), 'points': self._roi_scale_base})
            points[0::2] = cx + (points[0::2] - cx) * factor
            points[1::2] = cy + (points[1::2] - cy) * factor
        roi['points'] = [float(v) for v in points]
        rois = list(rois)
        rois[index] = roi
        self.sheet['AFM_ROIs'] = rois
        self._preview_edited_roi(roi)

    def on_scale_roi_done(self, event):
        """Commit the scaling when the slider is let go."""
        if self._roi_scale_base is None:
            return
        self._roi_scale_base = None
        self._clear_preview()
        index = self.roi_list.GetSelection()
        self.roi_scale.SetValue(100)
        self._roi_changed('Region resized.')
        if index >= 0:
            self.roi_list.SetSelection(index)

    # -- the mask every measurement goes through -----------------------------

    def _analysis_mask(self, array=None):
        """Boolean mask of the pixels the measurements should use, or None."""
        if array is None:
            array = self._leveled()
        rois = self.sheet.get('AFM_ROIs')
        if array is None or not rois:
            return None
        mask = roi_mask(array.shape, rois)
        return None if mask.all() else mask

    def _refresh_regions(self):
        if not hasattr(self, 'roi_list') or not self.roi_list:
            return
        rois = self.sheet.get('AFM_ROIs') or []
        labels = {k: t for k, t in self._ROI_SHAPES}
        self.roi_list.Set([
            f"{i + 1}. {labels.get(r.get('shape'), r.get('shape'))} — "
            f"{'exclude' if r.get('mode') == 'exclude' else 'include'}"
            f"{self._roi_extent_text(r)}"
            for i, r in enumerate(rois) if isinstance(r, dict)])
        array = self._leveled()
        mask = self._analysis_mask(array)
        if array is None:
            self.roi_status.SetLabel('')
        elif mask is None:
            self.roi_status.SetLabel('Measuring the whole image.')
        else:
            share = 100.0 * mask.sum() / mask.size
            self.roi_status.SetLabel(
                f'Measuring {mask.sum():,} of {mask.size:,} pixels '
                f'({share:.1f}%).')
        self._refresh_crop()

    @staticmethod
    def _roi_extent_text(roi):
        points = [float(v) for v in (roi.get('points') or [])]
        if roi.get('shape') == 'rect' and len(points) >= 4:
            return (f'  {abs(points[2] - points[0]):.0f}'
                    f'×{abs(points[3] - points[1]):.0f} px')
        if roi.get('shape') == 'circle' and len(points) >= 3:
            return f'  r {points[2]:.0f} px'
        if roi.get('shape') == 'polygon':
            return f'  {len(points) // 2} points'
        return ''

    def _refresh_crop(self):
        if not hasattr(self, 'crop_text'):
            return
        from libraries.FileMenu.AFM_Import import afm_shape
        full = self.sheet.get('_afm_image')
        shape = afm_shape(self.sheet)
        if full is None or shape is None:
            self.crop_text.SetLabel('')
            return
        full = np.asarray(full)
        if self.sheet.get('AFM_Crop'):
            self.crop_text.SetLabel(
                f'Cropped to {shape[1]} × {shape[0]} px '
                f'(from {full.shape[1]} × {full.shape[0]} px)')
        else:
            self.crop_text.SetLabel(
                f'Full image: {full.shape[1]} × {full.shape[0]} px')

    def _roi_changed(self, message=''):
        self._refresh_regions()
        self._redraw_main(preserve_view=True)
        refresh_afm_companion(self.parent)
        # The region list feeds the Roughness tab's menu, but nothing is
        # recomputed here: the numbers change only when Compute is pressed.
        self._refresh_roughness_regions()
        self._persist()
        if message and hasattr(self, 'roi_status'):
            self.roi_status.SetLabel(message)

    def on_draw_roi(self, event):
        """Arm drawing one region on the main canvas."""
        shape = self._ROI_SHAPES[self.roi_shape.GetSelection()][0]
        mode = 'exclude' if self.roi_mode.GetSelection() == 1 else 'include'
        self._clear_interaction()
        self._roi_pending = {'shape': shape, 'mode': mode}
        self._roi_points = []
        canvas = self.parent.plot_manager.canvas
        if shape == 'rect':
            from matplotlib.widgets import RectangleSelector
            ax = self.parent.plot_manager.ax
            self._roi_selector = RectangleSelector(
                ax, self._on_roi_rect, useblit=True, button=[1],
                interactive=False,
                props=dict(facecolor='none', edgecolor=BRAND, linewidth=1.5))
            self.roi_status.SetLabel('Drag a rectangle on the map…')
            return
        self._mode = 'roi'
        self._cids = [
            canvas.mpl_connect('button_press_event', self._on_roi_press),
            canvas.mpl_connect('motion_notify_event', self._on_roi_motion),
            canvas.mpl_connect('button_release_event', self._on_roi_release),
        ]
        self.roi_status.SetLabel(
            'Drag from the centre outwards on the map…' if shape == 'circle'
            else 'Press and draw around the region, then let go…')

    def _roi_point(self, event):
        """Event position in pixels of the displayed image, or None."""
        ax = self.parent.plot_manager.ax
        if event.inaxes is not ax or event.xdata is None or event.ydata is None:
            return None
        x_scale, y_scale = self._px_scale()
        return event.xdata / x_scale, event.ydata / y_scale

    def _add_roi(self, shape, points):
        rois = list(self.sheet.get('AFM_ROIs') or [])
        rois.append({'shape': shape, 'mode': self._roi_pending['mode'],
                     'points': [float(v) for v in points]})
        self.sheet['AFM_ROIs'] = rois
        self._clear_interaction()
        self._roi_pending = None
        self._roi_changed(f'{len(rois)} region(s).')

    def _on_roi_rect(self, press, release):
        p0, p1 = self._roi_point(press), self._roi_point(release)
        if p0 is None or p1 is None:
            return
        if abs(p1[0] - p0[0]) < 2 or abs(p1[1] - p0[1]) < 2:
            return
        self._add_roi('rect', [p0[0], p0[1], p1[0], p1[1]])

    def _on_roi_press(self, event):
        if self._mode != 'roi' or event.button != 1:
            return
        point = self._roi_point(event)
        if point is None:
            return
        self._roi_points = [point]

    def _on_roi_motion(self, event):
        if self._mode != 'roi' or not self._roi_points:
            return
        point = self._roi_point(event)
        if point is None:
            return
        if self._roi_pending['shape'] == 'circle':
            self._roi_points = [self._roi_points[0], point]
        else:
            # One sample per pixel of travel is plenty for an outline and
            # keeps a slow, careful drag from storing thousands of points.
            last = self._roi_points[-1]
            if abs(point[0] - last[0]) + abs(point[1] - last[1]) >= 1.0:
                self._roi_points.append(point)
        self._preview_roi()

    def _on_roi_release(self, event):
        if self._mode != 'roi' or not self._roi_points:
            return
        point = self._roi_point(event)
        if point is not None:
            self._on_roi_motion(event)
        self._clear_preview()
        if self._roi_pending['shape'] == 'circle':
            if len(self._roi_points) < 2:
                return
            (cx, cy), (px, py) = self._roi_points[0], self._roi_points[-1]
            radius = float(np.hypot(px - cx, py - cy))
            if radius < 2:
                return
            self._add_roi('circle', [cx, cy, radius])
            return
        if len(self._roi_points) < 3:
            return
        flat = [v for point in self._roi_points for v in point]
        self._add_roi('polygon', flat)

    def _preview_roi(self):
        """Show the region being drawn, before it is committed."""
        from matplotlib.patches import Circle, Polygon
        self._clear_preview()
        ax = self.parent.plot_manager.ax
        x_scale, y_scale = self._px_scale()
        points = np.asarray(self._roi_points, dtype=float)
        if points.size < 4:
            return
        if self._roi_pending['shape'] == 'circle':
            (cx, cy), (px, py) = points[0], points[-1]
            patch = Circle((cx * x_scale, cy * y_scale),
                           float(np.hypot(px - cx, py - cy)) * x_scale,
                           facecolor='none', edgecolor=BRAND, lw=1.5,
                           zorder=9)
        else:
            patch = Polygon(points * np.array([x_scale, y_scale]),
                            closed=False, facecolor='none', edgecolor=BRAND,
                            lw=1.5, zorder=9)
        ax.add_patch(patch)
        self._preview_artists.append(patch)
        self.parent.plot_manager.canvas.draw_idle()

    # editing a region ------------------------------------------------------

    def on_select_roi(self, event):
        """Highlight the picked region on the map."""
        self.sheet['_afm_roi_active'] = self.roi_list.GetSelection()
        self._redraw_main(preserve_view=True)

    def on_flip_roi(self, event):
        rois = list(self.sheet.get('AFM_ROIs') or [])
        index = self.roi_list.GetSelection()
        if index < 0 or index >= len(rois):
            return
        roi = dict(rois[index])
        roi['mode'] = ('include' if roi.get('mode') == 'exclude'
                       else 'exclude')
        rois[index] = roi
        self.sheet['AFM_ROIs'] = rois
        self._roi_changed(f"Region {index + 1} is now "
                          f"{'an exclude' if roi['mode'] == 'exclude' else 'an include'}.")
        self.roi_list.SetSelection(index)

    def on_edit_roi(self, event):
        """Arm dragging the selected region on the map."""
        rois = self.sheet.get('AFM_ROIs') or []
        index = self.roi_list.GetSelection()
        if index < 0 or index >= len(rois):
            self.roi_status.SetLabel('Pick a region in the list first.')
            return
        self._clear_interaction()
        self._mode = 'roi_edit'
        self._roi_edit_index = index
        self._roi_grab = None
        self.sheet['_afm_roi_active'] = index
        canvas = self.parent.plot_manager.canvas
        self._cids = [
            canvas.mpl_connect('button_press_event', self._on_roi_edit_press),
            canvas.mpl_connect('motion_notify_event', self._on_roi_edit_drag),
            canvas.mpl_connect('button_release_event', self._on_roi_edit_drop),
        ]
        self._redraw_main(preserve_view=True)
        self.roi_status.SetLabel('Drag inside the region to move it, near an '
                                 'edge to resize it.')

    def _roi_geometry(self, roi):
        """(centre, size) of a region in image pixels, whatever its shape."""
        points = np.asarray([float(v) for v in (roi.get('points') or [])],
                            dtype=float)
        kind = roi.get('shape')
        if kind == 'rect' and points.size >= 4:
            x0, y0, x1, y1 = points[:4]
            return ((x0 + x1) / 2.0, (y0 + y1) / 2.0), \
                   (abs(x1 - x0) / 2.0, abs(y1 - y0) / 2.0)
        if kind == 'circle' and points.size >= 3:
            return (points[0], points[1]), (points[2], points[2])
        pairs = points.reshape(-1, 2)
        if pairs.size == 0:
            return (0.0, 0.0), (1.0, 1.0)
        centre = pairs.mean(axis=0)
        reach = np.abs(pairs - centre).max(axis=0)
        return tuple(centre), tuple(np.maximum(reach, 1e-6))

    def _on_roi_edit_press(self, event):
        if self._mode != 'roi_edit' or event.button != 1:
            return
        point = self._roi_point(event)
        if point is None:
            return
        rois = self.sheet.get('AFM_ROIs') or []
        if not 0 <= self._roi_edit_index < len(rois):
            return
        roi = rois[self._roi_edit_index]
        (cx, cy), (rx, ry) = self._roi_geometry(roi)
        # Inside the middle 70% is a move; the outer band is a resize. One
        # gesture, no handles to hit — a handle at 25 px on a zoomed-out scan
        # is smaller than the mouse.
        fx = abs(point[0] - cx) / max(rx, 1e-6)
        fy = abs(point[1] - cy) / max(ry, 1e-6)
        reach = max(fx, fy)
        self._roi_grab = ('move' if reach < 0.7 else
                          'resize' if reach < 1.6 else None)
        self._roi_anchor = (point, [float(v) for v in roi.get('points') or []])

    def _on_roi_edit_drag(self, event):
        if self._mode != 'roi_edit' or not self._roi_grab:
            return
        point = self._roi_point(event)
        if point is None:
            return
        rois = list(self.sheet.get('AFM_ROIs') or [])
        roi = dict(rois[self._roi_edit_index])
        start, original = self._roi_anchor
        points = np.asarray(original, dtype=float)
        kind = roi.get('shape')
        dx, dy = point[0] - start[0], point[1] - start[1]
        if self._roi_grab == 'move':
            if kind == 'circle':
                points[0] += dx
                points[1] += dy
            else:
                points[0::2] += dx
                points[1::2] += dy
        else:
            (cx, cy), (rx, ry) = self._roi_geometry({'shape': kind,
                                                     'points': original})
            if kind == 'circle':
                points[2] = max(float(np.hypot(point[0] - points[0],
                                               point[1] - points[1])), 1.0)
            elif kind == 'rect':
                # Drag the corner nearest where the grab started.
                i = 0 if abs(start[0] - points[0]) < abs(start[0] - points[2]) else 2
                j = 1 if abs(start[1] - points[1]) < abs(start[1] - points[3]) else 3
                points[i], points[j] = point[0], point[1]
            else:
                scale = max(abs(point[0] - cx) / max(rx, 1e-6),
                            abs(point[1] - cy) / max(ry, 1e-6))
                scale = float(np.clip(scale, 0.05, 20.0))
                points[0::2] = cx + (points[0::2] - cx) * scale
                points[1::2] = cy + (points[1::2] - cy) * scale
        roi['points'] = [float(v) for v in points]
        rois[self._roi_edit_index] = roi
        self.sheet['AFM_ROIs'] = rois
        self._preview_edited_roi(roi)

    def _preview_edited_roi(self, roi):
        """Outline the region being dragged, without redrawing the image."""
        from matplotlib.patches import Circle, Polygon, Rectangle
        self._clear_preview()
        ax = self.parent.plot_manager.ax
        sx, sy = self._px_scale()
        points = [float(v) for v in roi.get('points') or []]
        style = dict(facecolor='none', edgecolor='yellow', lw=1.8, zorder=10)
        kind = roi.get('shape')
        if kind == 'rect' and len(points) >= 4:
            x0, y0, x1, y1 = points[:4]
            patch = Rectangle((min(x0, x1) * sx, min(y0, y1) * sy),
                              abs(x1 - x0) * sx, abs(y1 - y0) * sy, **style)
        elif kind == 'circle' and len(points) >= 3:
            patch = Circle((points[0] * sx, points[1] * sy),
                           abs(points[2]) * sx, **style)
        elif len(points) >= 6:
            pairs = np.asarray(points).reshape(-1, 2) * np.array([sx, sy])
            patch = Polygon(pairs, closed=True, **style)
        else:
            return
        ax.add_patch(patch)
        self._preview_artists.append(patch)
        self.parent.plot_manager.canvas.draw_idle()

    def _on_roi_edit_drop(self, event):
        if self._mode != 'roi_edit' or not self._roi_grab:
            return
        self._roi_grab = None
        self._clear_preview()
        index = self._roi_edit_index
        self._roi_changed('Region updated.')
        # Stay armed: moving a region is usually several nudges, not one.
        self.roi_list.SetSelection(index)
        self.on_edit_roi(None)

    def on_delete_roi(self, event):
        index = self.roi_list.GetSelection()
        rois = list(self.sheet.get('AFM_ROIs') or [])
        if index < 0 or index >= len(rois):
            return
        rois.pop(index)
        self.sheet['AFM_ROIs'] = rois or None
        self._roi_changed('Region deleted.')

    def on_clear_rois(self, event):
        self.sheet['AFM_ROIs'] = None
        self._roi_changed('Regions cleared.')

    def on_draw_crop(self, event):
        from matplotlib.widgets import RectangleSelector

        self._clear_interaction()
        ax = self.parent.plot_manager.ax
        offset = self.sheet.get('AFM_Crop') or [0, 0, 0, 0]

        def on_select(press, release):
            p0, p1 = self._roi_point(press), self._roi_point(release)
            if p0 is None or p1 is None:
                return
            full = np.asarray(self.sheet['_afm_image'])
            # Pixels of the *original* image, so repeated crops compose.
            x0 = int(round(min(p0[0], p1[0]))) + int(offset[0])
            x1 = int(round(max(p0[0], p1[0]))) + int(offset[0])
            y0 = int(round(min(p0[1], p1[1]))) + int(offset[1])
            y1 = int(round(max(p0[1], p1[1]))) + int(offset[1])
            x0, x1 = max(0, x0), min(full.shape[1], x1)
            y0, y1 = max(0, y0), min(full.shape[0], y1)
            if x1 - x0 < 8 or y1 - y0 < 8:
                return
            self._clear_interaction()
            self._make_crop_sheet([x0, y0, x1, y1])

        self._roi_selector = RectangleSelector(
            ax, on_select, useblit=True, button=[1], interactive=False,
            props=dict(facecolor='none', edgecolor='red', linewidth=1.5))
        self.crop_text.SetLabel('Drag the crop rectangle on the map…')

    def _make_crop_sheet(self, box):
        """Put the cropped rectangle on a new sheet of its own.

        Cropping in place would throw away pixels that are still wanted: the
        crop is usually one clean patch of a scan that has several. As a sheet
        the crop levels, profiles and counts grains on its own, sits beside
        the original in the list, and the original is untouched.
        """
        x0, y0, x1, y1 = [int(v) for v in box]
        source = self.sheet
        array = np.asarray(source.get('_afm_image'))[y0:y1, x0:x1]
        channel = source.get('AFM_Channel', 'Height')
        # 'AFM~Crop', then Crop2, Crop3 …: a sheet name with a space in it
        # reads badly in the selector and the Sample Manager column.
        name, sheet = make_afm_sheet(
            'Crop', array, source.get('AFM_Units', ''),
            source.get('AFM_NM_Per_Px'), source.get('AFM_NM_Per_Px_Y'),
            dict(source.get('ExperimentalInfo') or {}),
            source.get('AFM_Source_Path', ''), channel,
            source.get('AFM_Mode', ''))
        sheet['ExperimentalInfo'].update({
            'Content': 'Cropped region',
            'Cropped From': self.sheet_name,
            'Crop (px)': f'x {x0}–{x1}, y {y0}–{y1}'})
        # The crop inherits how the source is being levelled and shown, since
        # it is the same surface — but not its regions, profile or grains,
        # which were drawn in the old pixel grid.
        for key in ('AFM_Level', 'AFM_Scalar_CMap', 'AFM_Display_Range'):
            if source.get(key) is not None:
                sheet[key] = (dict(source[key])
                              if isinstance(source[key], dict)
                              else list(source[key])
                              if isinstance(source[key], list)
                              else source[key])
        name = register_afm_sheet(self.parent, name, sheet)
        from libraries.Sheet_Operations import on_sheet_selected
        on_sheet_selected(self.parent, name)
        self._persist()
        self.crop_text.SetLabel(
            f"Cropped {x1 - x0} × {y1 - y0} px into '{name}'.")

    def on_reset_crop(self, event):
        """Drop a crop stored on this sheet (older projects cropped in place)."""
        self.sheet['AFM_Crop'] = None
        self._invalidate_for_crop()
        self._clear_interaction()
        self._refresh_regions()
        self._redraw_main()
        refresh_afm_companion(self.parent)
        self._persist()

    def _invalidate_for_crop(self):
        """Drop everything stored in pixels of the old image.

        Regions, the profile line and a particle overlay are all in image
        pixels; after a crop those coordinates point somewhere else. Silently
        keeping them would move a measured feature, so they go.
        """
        sheet = self.sheet
        dropped = any(sheet.get(key) is not None for key in
                      ('AFM_ROIs', 'AFM_Profile_Line', 'AFM_Particles'))
        for key in ('AFM_ROIs', 'AFM_Profile_Line', 'AFM_Profile_Width',
                    'AFM_Profile_CD', 'AFM_Profile_CD_Range', 'AFM_Particles',
                    '_afm_overlay'):
            sheet[key] = None
        self._line = None
        if dropped and hasattr(self, 'roi_status'):
            self.roi_status.SetLabel('Regions, profile and grains cleared — '
                                     'they were in the old pixel grid.')

    # -- Particles -----------------------------------------------------------

    _PARTICLE_METHODS = (('otsu', 'Otsu (automatic)'),
                         ('tophat', 'Top-hat (uneven background)'),
                         ('manual', 'Manual height level'))

    def _build_particles(self):
        panel = wx.ScrolledWindow(self.notebook)
        panel.SetScrollRate(0, 10)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, 'Measure grain size', bold=True), 0, wx.ALL, 8)
        sizer.Add(self._blurb(panel,
                              'Grains are found by height: everything above '
                              'the threshold is a grain. Set the contrast '
                              "first — pick 'Histogram (contrast)' in the "
                              'companion panel and drag the black point to '
                              'where the grains start, then take the level '
                              'from it below.'),
                  0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        engine_row = wx.BoxSizer(wx.HORIZONTAL)
        engine_row.Add(_label(panel, 'Method:'), 0,
                       wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.p_engine = wx.Choice(
            panel, choices=['Threshold (separated particles)',
                            'Watershed (touching grains)'])
        # Watershed by default: a real AFM scan is a dense field of grains
        # that touch, and thresholding merges every touching pair into one
        # blob — so the count starts right rather than starting low.
        self.p_engine.SetSelection(1)
        self.p_engine.Bind(wx.EVT_CHOICE, lambda e: self._sync_particle_enable())
        engine_row.Add(self.p_engine, 1)
        sizer.Add(engine_row, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        grid = wx.FlexGridSizer(5, 2, 6, 6)
        grid.AddGrowableCol(1)
        grid.Add(_label(panel, 'Particles are:'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.p_polarity = wx.Choice(panel, choices=['Above the threshold '
                                                    '(grains)',
                                                    'Below it (pits, holes)'])
        self.p_polarity.SetSelection(0)
        grid.Add(self.p_polarity, 1, wx.EXPAND)

        grid.Add(_label(panel, 'Threshold:'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.p_method = wx.Choice(
            panel, choices=[t for _k, t in self._PARTICLE_METHODS])
        self.p_method.SetSelection(0)
        self.p_method.Bind(wx.EVT_CHOICE, lambda e: self._sync_particle_enable())
        grid.Add(self.p_method, 1, wx.EXPAND)

        grid.Add(_label(panel, 'Level:'), 0, wx.ALIGN_CENTER_VERTICAL)
        level_row = wx.BoxSizer(wx.HORIZONTAL)
        self.p_level = wx.SpinCtrlDouble(panel, min=-1e6, max=1e6, inc=1.0,
                                         initial=0.0)
        self.p_level.SetDigits(3)
        level_row.Add(self.p_level, 1)
        self.p_level_unit = _label(panel, '')
        level_row.Add(self.p_level_unit, 0,
                      wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 4)
        grid.Add(level_row, 1, wx.EXPAND)

        grid.Add(_label(panel, 'Min. size:'), 0, wx.ALIGN_CENTER_VERTICAL)
        min_row = wx.BoxSizer(wx.HORIZONTAL)
        self.p_min_size = wx.SpinCtrlDouble(panel, min=0.0, max=1e6, inc=1.0,
                                            initial=0.0)
        self.p_min_size.SetDigits(2)
        self.p_min_size.SetToolTip('Reject anything smaller than this across. '
                                   '0 keeps everything above 6 pixels.')
        min_row.Add(self.p_min_size, 1)
        self.p_min_unit = _label(panel, '')
        min_row.Add(self.p_min_unit, 0, wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 4)
        grid.Add(min_row, 1, wx.EXPAND)

        grid.Add(_label(panel, 'Max. size:'), 0, wx.ALIGN_CENTER_VERTICAL)
        max_row = wx.BoxSizer(wx.HORIZONTAL)
        self.p_max_size = wx.SpinCtrlDouble(panel, min=0.0, max=1e6, inc=1.0,
                                            initial=0.0)
        self.p_max_size.SetDigits(2)
        self.p_max_size.SetToolTip('Reject anything larger than this across. '
                                   '0 means no upper limit.')
        max_row.Add(self.p_max_size, 1)
        self.p_max_unit = _label(panel, '')
        max_row.Add(self.p_max_unit, 0, wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 4)
        grid.Add(max_row, 1, wx.EXPAND)
        sizer.Add(grid, 0, wx.EXPAND | wx.ALL, 8)

        take = wx.Button(panel, label='Take the level from the contrast')
        take.SetToolTip('Use the black point dragged on the companion '
                        'histogram as the threshold.')
        take.Bind(wx.EVT_BUTTON, self.on_level_from_contrast)
        sizer.Add(take, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.p_fill = wx.CheckBox(panel, label='Fill holes inside particles')
        self.p_fill.SetValue(True)
        sizer.Add(self.p_fill, 0, wx.LEFT | wx.RIGHT, 8)
        self.p_edge = wx.CheckBox(panel,
                                  label='Discard particles cut by the edge')
        self.p_edge.SetValue(True)
        sizer.Add(self.p_edge, 0, wx.LEFT | wx.RIGHT | wx.TOP, 8)
        self.p_split = wx.CheckBox(panel, label='Split touching particles')
        self.p_split.SetToolTip('Watershed, applied only to blobs bigger than '
                                'three times the median — on a dense field it '
                                'otherwise splits single grains in two.')
        sizer.Add(self.p_split, 0, wx.LEFT | wx.RIGHT | wx.TOP, 8)

        # -- watershed marking, Gwyddion's parameters ------------------------
        self.ws_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                        'Watershed grain marking')
        ws_panel = self.ws_box.GetStaticBox()
        ws_grid = wx.FlexGridSizer(6, 2, 5, 6)
        ws_grid.AddGrowableCol(1)

        def _ws_row(label, ctrl, tip=''):
            ws_grid.Add(_label(ws_panel, label), 0, wx.ALIGN_CENTER_VERTICAL)
            if tip:
                ctrl.SetToolTip(tip)
            ws_grid.Add(ctrl, 0)
            return ctrl

        self.ws_locate_steps = _ws_row(
            'Location — steps:', wx.SpinCtrl(ws_panel, min=1, max=10000,
                                             initial=4),
            'How many times the water is poured on to find where the grains '
            'are. More water finds fewer, larger grains.')
        self.ws_locate_drop = _ws_row(
            'Location — drop size (%):',
            wx.SpinCtrlDouble(ws_panel, min=0.001, max=100.0, inc=0.1,
                              initial=1.69),
            'One drop raises the local minimum by this percent of the height '
            "range, divided by 5000 — Gwyddion's definition.")
        self.ws_locate_drop.SetDigits(3)
        self.ws_threshold = _ws_row(
            'Location — threshold (px²):',
            wx.SpinCtrl(ws_panel, min=0, max=100000, initial=4),
            'Lakes smaller than this are noise, not grains.')
        self.ws_seg_steps = _ws_row(
            'Segmentation — steps:', wx.SpinCtrl(ws_panel, min=1, max=100000,
                                                 initial=283),
            'How far the grains are allowed to grow from their summits. '
            'Raise it until the marked grains tile the surface.')
        self.ws_seg_drop = _ws_row(
            'Segmentation — drop size (%):',
            wx.SpinCtrlDouble(ws_panel, min=0.001, max=100.0, inc=0.1,
                              initial=1.0))
        self.ws_seg_drop.SetDigits(3)
        self.ws_smoothing = _ws_row(
            'Seed smoothing (px):',
            wx.SpinCtrlDouble(ws_panel, min=0.0, max=20.0, inc=0.5,
                              initial=1.5),
            'Blur used only to find the seeds. Pixel noise puts a local '
            'minimum almost everywhere; without this every pixel is a grain.')
        self.ws_smoothing.SetDigits(1)
        self.ws_box.Add(ws_grid, 0, wx.EXPAND | wx.ALL, 6)

        self.ws_invert = wx.CheckBox(ws_panel,
                                     label='Invert height (mark pits)')
        self.ws_box.Add(self.ws_invert, 0, wx.LEFT | wx.BOTTOM, 6)

        # Six numbers nobody can set from cold. 'Auto' measures them off this
        # scan — the feature size, the noise floor and the depth at which the
        # grain count stops depending on the depth — and writes them into the
        # boxes above, so they stay visible and stay editable.
        ws_buttons = wx.BoxSizer(wx.HORIZONTAL)
        auto_btn = wx.Button(ws_panel, label='Auto from this image')
        auto_btn.SetBackgroundColour(BRAND_WX)
        auto_btn.SetToolTip('Measure the settings off the scan: blur from the '
                            'feature size, seed depth from where the grain '
                            'count is least sensitive to it, flood from the '
                            'roughness.')
        auto_btn.Bind(wx.EVT_BUTTON, self.on_auto_watershed)
        ws_buttons.Add(auto_btn, 1, wx.RIGHT, 6)
        gwy_btn = wx.Button(ws_panel, label='Gwyddion defaults')
        gwy_btn.Bind(wx.EVT_BUTTON, self.on_default_watershed)
        ws_buttons.Add(gwy_btn, 1)
        self.ws_box.Add(ws_buttons, 0, wx.EXPAND | wx.ALL, 6)

        self.ws_status = _label(ws_panel, '')
        self.ws_status.SetForegroundColour(wx.Colour(90, 90, 90))
        self._wrap_labels.append(self.ws_status)
        self.ws_box.Add(self.ws_status, 0,
                        wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 6)
        sizer.Add(self.ws_box, 0, wx.EXPAND | wx.ALL, 8)

        run = wx.Button(panel, label='Measure grain size')
        run.SetBackgroundColour(BRAND_WX)
        run.Bind(wx.EVT_BUTTON, self.on_count_particles)
        sizer.Add(run, 0, wx.EXPAND | wx.ALL, 8)

        after = wx.BoxSizer(wx.HORIZONTAL)
        clear = wx.Button(panel, label='Clear the overlay')
        clear.Bind(wx.EVT_BUTTON, self.on_clear_particles)
        after.Add(clear, 1, wx.RIGHT, 6)
        grain_sheet = wx.Button(panel, label=f'Add {AFM_GRAIN_SHEET} sheet')
        grain_sheet.SetToolTip('Put the per-grain table on a sheet of its own '
                               '— one row per grain, so it sorts, plots and '
                               'exports like any other KherveFitting sheet.')
        grain_sheet.Bind(wx.EVT_BUTTON, self.on_publish_grain_sheet)
        after.Add(grain_sheet, 1)
        sizer.Add(after, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.particle_text = wx.TextCtrl(
            panel, style=wx.TE_MULTILINE | wx.TE_READONLY, size=(-1, 190))
        self.particle_text.SetFont(wx.Font(9, wx.FONTFAMILY_TELETYPE,
                                           wx.FONTSTYLE_NORMAL,
                                           wx.FONTWEIGHT_NORMAL))
        # Fixed height, not proportion 1: a growable child inside a
        # ScrolledWindow re-triggers the layout that sized it, and wx sits
        # there swapping scrollbars in and out forever.
        sizer.Add(self.particle_text, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        sizer.Add(wx.StaticLine(panel), 0, wx.EXPAND | wx.ALL, 4)
        sizer.Add(_label(panel, 'Size distribution', bold=True), 0,
                  wx.LEFT | wx.RIGHT | wx.TOP, 8)
        sizer.Add(self._blurb(panel,
                              'Drawn in the companion panel, which switches to '
                              'it as soon as the grains are measured. Fit a '
                              'Gaussian to it over a range, so the spike of '
                              'single-pixel fragments at the left is left out '
                              'of the mean.'),
                  0, wx.EXPAND | wx.ALL, 8)

        fit_row = wx.BoxSizer(wx.HORIZONTAL)
        fit_row.Add(_label(panel, 'Fit from'), 0,
                    wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 4)
        self.fit_from = wx.SpinCtrlDouble(panel, min=0.0, max=1e6, inc=1.0,
                                          initial=0.0, size=(80, -1))
        self.fit_from.SetDigits(2)
        fit_row.Add(self.fit_from, 0, wx.RIGHT, 4)
        fit_row.Add(_label(panel, 'to'), 0,
                    wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 4)
        self.fit_to = wx.SpinCtrlDouble(panel, min=0.0, max=1e6, inc=1.0,
                                        initial=0.0, size=(80, -1))
        self.fit_to.SetDigits(2)
        fit_row.Add(self.fit_to, 0, wx.RIGHT, 4)
        self.fit_unit = _label(panel, '')
        fit_row.Add(self.fit_unit, 0, wx.ALIGN_CENTER_VERTICAL)
        sizer.Add(fit_row, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        fit_buttons = wx.BoxSizer(wx.HORIZONTAL)
        fit_btn = wx.Button(panel, label='Fit Gaussian')
        fit_btn.SetBackgroundColour(BRAND_WX)
        fit_btn.Bind(wx.EVT_BUTTON, self.on_fit_distribution)
        fit_buttons.Add(fit_btn, 1, wx.RIGHT, 6)
        whole_btn = wx.Button(panel, label='Whole range')
        whole_btn.Bind(wx.EVT_BUTTON, self.on_fit_whole_range)
        fit_buttons.Add(whole_btn, 1)
        sizer.Add(fit_buttons, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.fit_text = wx.TextCtrl(panel, style=wx.TE_MULTILINE | wx.TE_READONLY,
                                    size=(-1, 110))
        self.fit_text.SetFont(wx.Font(9, wx.FONTFAMILY_TELETYPE,
                                      wx.FONTSTYLE_NORMAL, wx.FONTWEIGHT_NORMAL))
        sizer.Add(self.fit_text, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        panel.SetSizer(sizer)
        panel.Bind(wx.EVT_SIZE, self._on_panel_resize)
        return panel

    # -- the size distribution and its Gaussian --------------------------------

    def _grain_sizes(self):
        """(sizes, unit) the distribution is built from, or (None, unit)."""
        stats = self.sheet.get('AFM_Particles') or {}
        sizes = np.asarray(stats.get('Diameters') or [], dtype=float)
        return (sizes if sizes.size else None), stats.get('Size Unit', 'nm')

    def on_fit_whole_range(self, event):
        sizes, _unit = self._grain_sizes()
        if sizes is None:
            self.fit_text.SetValue('Count some grains first.')
            return
        self.fit_from.SetValue(float(sizes.min()))
        self.fit_to.SetValue(float(sizes.max()))
        self.on_fit_distribution(None)

    def on_fit_distribution(self, event):
        from libraries.ToolsMenu.AFM_Engine import gaussian_fit, size_distribution

        sizes, unit = self._grain_sizes()
        if sizes is None:
            self.fit_text.SetValue('Count some grains first.')
            return
        centres, counts, width = size_distribution(sizes)
        lo, hi = float(self.fit_from.GetValue()), float(self.fit_to.GetValue())
        if hi <= lo:
            lo, hi = float(centres.min()), float(centres.max())
            self.fit_from.SetValue(lo)
            self.fit_to.SetValue(hi)
        fit = gaussian_fit(centres, counts, lo, hi)
        self.sheet['AFM_Grain_Fit'] = fit
        if fit is None:
            self.fit_text.SetValue('The fit did not converge — widen the '
                                   'range,\nor check the distribution has a '
                                   'peak in it.')
        else:
            self._show_fit(fit, unit)
        refresh_afm_companion(self.parent)
        self._persist()

    def _show_fit(self, fit, unit=''):
        if not fit:
            self.fit_text.SetValue('')
            return
        self.fit_text.SetValue('\n'.join([
            'y = y0 + a exp[-(x - x0)² / b²]',
            f"x0 = {fit['x0']:.5g} {unit}   (centre)",
            f"b  = {fit['b']:.5g} {unit}   sigma {fit['sigma']:.4g}, "
            f"FWHM {fit['fwhm']:.4g}",
            f"a  = {fit['a']:.5g}   y0 = {fit['y0']:.4g}",
            f"R² = {fit['r2']:.4f} over {fit['x_from']:.4g} to "
            f"{fit['x_to']:.4g} {unit} ({fit['n']} bins)"]))

    def _size_unit(self):
        """(unit label, unit per pixel) for the lateral size controls."""
        nm = self.sheet.get('AFM_NM_Per_Px')
        if not nm:
            return 'px', 1.0
        array = self._leveled()
        # A 10 µm scan in nm gives four-digit sizes; switch at the same
        # threshold the extent and the scale bar use.
        if array is not None and array.shape[1] * float(nm) > 2000.0:
            return 'µm', float(nm) / 1000.0
        return 'nm', float(nm)

    def _refresh_particle_controls(self):
        unit, _per_px = self._size_unit()
        height_unit = self.sheet.get('AFM_Units', '')
        self.p_level_unit.SetLabel(height_unit)
        self.p_min_unit.SetLabel(unit)
        self.p_max_unit.SetLabel(unit)
        array = self._leveled()
        if array is not None:
            low, high = float(np.nanmin(array)), float(np.nanmax(array))
            self.p_level.SetRange(low, high)
            if not (low <= self.p_level.GetValue() <= high):
                self.p_level.SetValue(0.5 * (low + high))
        self.fit_unit.SetLabel(unit)
        self._sync_particle_enable()
        self._show_particles(self.sheet.get('AFM_Particles'))
        self._show_fit(self.sheet.get('AFM_Grain_Fit'), unit)

    def _watershed(self):
        return self.p_engine.GetSelection() == 1

    def _sync_particle_enable(self):
        watershed = self._watershed()
        method = self._PARTICLE_METHODS[self.p_method.GetSelection()][0]
        self.p_level.Enable(not watershed and method == 'manual')
        for control in (self.p_method, self.p_polarity, self.p_fill,
                        self.p_split):
            control.Enable(not watershed)
        for control in (self.ws_locate_steps, self.ws_locate_drop,
                        self.ws_threshold, self.ws_seg_steps, self.ws_seg_drop,
                        self.ws_smoothing, self.ws_invert):
            control.Enable(watershed)

    def on_level_from_contrast(self, event):
        """Copy the histogram's black point into the manual level."""
        span = self.sheet.get('AFM_Display_Range')
        if not span or len(span) != 2:
            wx.MessageBox('Set the contrast first: pick '
                          "'Histogram (contrast)' in the companion panel and\n"
                          'drag the black point to where the grains start.',
                          'AFM', wx.OK | wx.ICON_INFORMATION)
            return
        self.p_method.SetSelection(2)          # manual
        self.p_level.SetValue(float(min(span)))
        self._sync_particle_enable()

    def _particle_params(self):
        """Tool settings translated into the shared detector's parameters.

        Sizes are entered as a diameter, which is how a grain is described,
        and the detector filters on pixel area — so they are converted through
        the equivalent-circle relation the diameters are reported with.
        """
        _unit, per_px = self._size_unit()
        method = self._PARTICLE_METHODS[self.p_method.GetSelection()][0]

        def area_px(size):
            if not size or per_px <= 0:
                return 0
            return int(round(np.pi / 4.0 * (float(size) / per_px) ** 2))

        return {
            'polarity': 'bright' if self.p_polarity.GetSelection() == 0
                        else 'dark',
            'threshold_method': method,
            'threshold_value': (float(self.p_level.GetValue())
                                if method == 'manual' else None),
            'min_size_px': area_px(self.p_min_size.GetValue()) or 6,
            'max_size_px': area_px(self.p_max_size.GetValue()),
            'fill_holes': bool(self.p_fill.GetValue()),
            'exclude_edge': bool(self.p_edge.GetValue()),
            'split_touching': bool(self.p_split.GetValue()),
            'shape_metrics': False,
        }

    def _watershed_params(self):
        return {'invert': bool(self.ws_invert.GetValue()),
                'locate_steps': int(self.ws_locate_steps.GetValue()),
                'locate_dropsize': float(self.ws_locate_drop.GetValue()),
                'locate_threshold': int(self.ws_threshold.GetValue()),
                'seg_steps': int(self.ws_seg_steps.GetValue()),
                'seg_dropsize': float(self.ws_seg_drop.GetValue()),
                'smoothing': float(self.ws_smoothing.GetValue())}

    def _set_watershed_params(self, params):
        """Write a parameter set into the six boxes."""
        for control, key in ((self.ws_locate_steps, 'locate_steps'),
                             (self.ws_locate_drop, 'locate_dropsize'),
                             (self.ws_threshold, 'locate_threshold'),
                             (self.ws_seg_steps, 'seg_steps'),
                             (self.ws_seg_drop, 'seg_dropsize'),
                             (self.ws_smoothing, 'smoothing')):
            if key in params:
                control.SetValue(params[key])
        if 'invert' in params:
            self.ws_invert.SetValue(bool(params['invert']))

    def on_auto_watershed(self, event):
        """Measure the watershed settings off this scan and fill them in."""
        from libraries.ToolsMenu.AFM_Engine import auto_watershed_params

        array = self._leveled()
        if array is None:
            self.ws_status.SetLabel('No image data.')
            return
        wx.BeginBusyCursor()
        try:
            params = auto_watershed_params(array, self._analysis_mask(array),
                                           bool(self.ws_invert.GetValue()))
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.ws_status.SetLabel(f'Could not measure the settings: {e}')
            return
        finally:
            wx.EndBusyCursor()
        self._set_watershed_params(params)
        self.ws_status.SetLabel(params.get('_report', ''))
        self._on_panel_resize_now()

    def on_default_watershed(self, event):
        """Back to the numbers Gwyddion's dialog opens with."""
        from libraries.ToolsMenu.AFM_Engine import WATERSHED_DEFAULTS
        self._set_watershed_params(dict(WATERSHED_DEFAULTS))
        self.ws_status.SetLabel("Gwyddion's defaults. 'Auto from this image' "
                                'measures them off the scan instead.')
        self._on_panel_resize_now()

    def _count_by_watershed(self, array, unit, per_px):
        """Mark touching grains and measure them, Gwyddion-style."""
        from libraries.ToolsMenu.AFM_Engine import (grain_stats,
                                                    mark_grains_watershed)
        from libraries.ToolsMenu.SEM_Engine import boundary_overlay

        params = self._watershed_params()
        labels = mark_grains_watershed(array, self._analysis_mask(array),
                                       params)
        grains = grain_stats(labels, per_px, per_px, unit)
        if not grains['count']:
            return None, None, None
        # Filter by the size boxes, which are in the same units as the
        # equivalent-square side the distribution is plotted against.
        low = float(self.p_min_size.GetValue())
        high = float(self.p_max_size.GetValue())
        keep = np.ones(grains['count'], bool)
        if low > 0:
            keep &= grains['a_eq'] >= low
        if high > 0:
            keep &= grains['a_eq'] <= high
        if not keep.all():
            drop = np.flatnonzero(~keep) + 1
            labels = np.where(np.isin(labels, drop), 0, labels)
            for key in ('area', 'a_eq', 'ecd', 'disc_radius'):
                grains[key] = grains[key][keep]
            grains['count'] = int(keep.sum())
        if not grains['count']:
            return None, None, None

        a_eq = grains['a_eq']
        stats = {
            'Count': int(grains['count']),
            'Size Unit': unit,
            'Method': 'watershed',
            'Diameters': [round(float(v), 4) for v in a_eq],
            f'ECD Mean ({unit})': float(grains['ecd'].mean()),
            f'ECD Median ({unit})': float(np.median(grains['ecd'])),
            f'ECD Std ({unit})': float(grains['ecd'].std(ddof=1))
                                 if grains['count'] > 1 else 0.0,
            f'ECD Min ({unit})': float(grains['ecd'].min()),
            f'ECD Max ({unit})': float(grains['ecd'].max()),
            f'D10 ({unit})': float(np.percentile(a_eq, 10)),
            f'D50 ({unit})': float(np.percentile(a_eq, 50)),
            f'D90 ({unit})': float(np.percentile(a_eq, 90)),
            f'Equivalent square side mean ({unit})': float(a_eq.mean()),
            f'Equivalent disc radius mean ({unit})':
                float(grains['disc_radius'].mean()),
            f'Grain area mean ({unit}²)': float(grains['area'].mean()),
            'Areal Coverage (%)': float(100.0 * (labels > 0).sum()
                                        / labels.size),
            'Parameters': dict(params, min_size=low, max_size=high,
                               size_unit=unit),
            'Warnings': [],
        }
        return stats, boundary_overlay(labels), labels

    def on_count_particles(self, event):
        from libraries.ToolsMenu.SEM_Engine import analyse, boundary_overlay

        array = self._leveled()
        if array is None:
            wx.MessageBox('No image data.', 'AFM', wx.OK | wx.ICON_WARNING)
            return
        unit, per_px = self._size_unit()
        if self._watershed():
            wx.BeginBusyCursor()
            try:
                stats, overlay, labels = self._count_by_watershed(
                    array, unit, per_px)
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.particle_text.SetValue(f'Grain marking failed: {e}')
                return
            finally:
                wx.EndBusyCursor()
            self.sheet['AFM_Particles'] = stats
            self.sheet['_afm_overlay'] = overlay
            self.sheet['_afm_labels'] = labels
            self.sheet['AFM_Grain_Fit'] = None
            self._show_particles(stats)
            self._redraw_main(preserve_view=True)
            refresh_afm_companion(self.parent)
            self._show_size_distribution()
            self._persist()
            return
        params = self._particle_params()
        wx.BeginBusyCursor()
        try:
            # nm_per_px is passed in the *display* unit so every diameter the
            # tool reports and filters on is in the unit shown beside the
            # boxes; a µm scan reads in µm, not four-digit nm. The mask is the
            # drawn regions — the detector already knows how to count inside
            # one, and corrects the density for the area it really had.
            result = analyse(array, self._analysis_mask(array), per_px, params)
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.particle_text.SetValue(f'Counting failed: {e}')
            return
        finally:
            wx.EndBusyCursor()

        stats = dict(result['stats'])
        stats['Size Unit'] = unit
        stats['Diameters'] = [round(float(v), 4) for v in result['diameters']]
        stats['Parameters'] = {'threshold_method': params['threshold_method'],
                               'threshold_value': params['threshold_value'],
                               'polarity': params['polarity'],
                               'min_size': float(self.p_min_size.GetValue()),
                               'max_size': float(self.p_max_size.GetValue()),
                               'size_unit': unit,
                               'split_touching': params['split_touching']}
        stats['Warnings'] = list(result['warnings'])
        self.sheet['AFM_Particles'] = stats
        self.sheet['_afm_overlay'] = boundary_overlay(result['labels'])
        # Kept for the grain-wise RMS on the Roughness tab. Runtime only:
        # the '_' prefix keeps it out of the project file.
        self.sheet['_afm_labels'] = result['labels']
        self._show_particles(stats)
        self._redraw_main(preserve_view=True)
        refresh_afm_companion(self.parent)
        self._show_size_distribution()
        self._persist()

    def _show_size_distribution(self):
        """Put the companion on the size distribution the measurement made.

        Measuring grain size and then having to hunt for the histogram in a
        dropdown is a step that never has a different answer.
        """
        try:
            from libraries.ViewMenu.TechniqueOverview import \
                select_companion_view
            select_companion_view(self.parent, 'Particle sizes')
        except Exception as e:
            print(f'AFM companion switch skipped: {e}')

    def on_publish_grain_sheet(self, event):
        """Put the grain size distribution on an 'AFM~Grain' sheet.

        The histogram, not the raw list: a sheet is a curve here, and the
        distribution is what a grain measurement is quoted from. Every
        diameter is kept alongside it, so nothing is lost to the binning.
        """
        from libraries.ToolsMenu.AFM_Engine import size_distribution

        sizes, unit = self._grain_sizes()
        if sizes is None:
            wx.MessageBox('Measure the grain size first.', 'AFM',
                          wx.OK | wx.ICON_INFORMATION)
            return
        centres, counts, width = size_distribution(sizes)
        stats = self.sheet.get('AFM_Particles') or {}

        name, base, counter = AFM_GRAIN_SHEET, AFM_GRAIN_SHEET, 2
        levels = self.parent.Data.setdefault('Core levels', {})
        while name in levels:
            name = f'{base}{counter}'
            counter += 1
        levels[name] = {
            'Name': name,
            'B.E.': [float(v) for v in centres],
            'Raw Data': [float(v) for v in counts],
            'AFM_X_Label': f'Grain diameter ({unit})',
            'AFM_Y_Label': 'Grains',
            'AFM_Source_Sheet': self.sheet_name,
            'AFM_Grain_Sizes': [float(v) for v in sizes],
            'AFM_Grain_Stats': dict(stats),
            'ExperimentalInfo': {
                'Technique': 'AFM',
                'Content': 'Grain size distribution',
                'Source Sheet': self.sheet_name,
                'Grains': int(stats.get('Count', len(sizes))),
                'Bin Width': f'{width:.4g} {unit}',
                'Method': stats.get('Method', 'threshold')},
            'Background': {'Bkg Y': [float(v) for v in counts],
                           'Bkg Type': '', 'Bkg Low': '', 'Bkg High': '',
                           'Bkg Offset Low': 0, 'Bkg Offset High': 0},
            'Fitting': {'Peaks': {}},
        }
        self.parent.Data['Number of Core levels'] = len(levels)
        try:
            if name not in list(self.parent.sheet_combobox.GetStrings()):
                self.parent.sheet_combobox.Append(name)
        except Exception:
            pass
        refresh_afm_companion(self.parent)
        self._persist()
        self.particle_text.SetValue(
            f"Added '{name}' — {len(sizes):,} grains in "
            f'{len(centres)} bins of {width:.4g} {unit}.\n\n'
            + self.particle_text.GetValue())

    def on_clear_particles(self, event):
        self.sheet['AFM_Particles'] = None
        self.sheet['_afm_overlay'] = None
        self.sheet['_afm_labels'] = None
        self.particle_text.SetValue('')
        self._redraw_main(preserve_view=True)
        refresh_afm_companion(self.parent)
        self._persist()

    def _show_particles(self, stats):
        if not isinstance(stats, dict) or not stats.get('Count'):
            if isinstance(stats, dict):
                self.particle_text.SetValue(
                    'No particles matched. Try a different threshold, or\n'
                    'widen the size limits.')
            return
        unit = stats.get('Size Unit', 'nm')
        lines = [f"Count                {stats['Count']}"]
        for label, key in (
                ('Equivalent square side',
                 f'Equivalent square side mean ({unit})'),
                ('Equivalent disc radius',
                 f'Equivalent disc radius mean ({unit})'),
                ('Mean diameter', f'ECD Mean ({unit})'),
                           ('Median diameter', f'ECD Median ({unit})'),
                           ('Std deviation', f'ECD Std ({unit})'),
                           ('Smallest', f'ECD Min ({unit})'),
                           ('Largest', f'ECD Max ({unit})'),
                           ('D10', f'D10 ({unit})'),
                           ('D50', f'D50 ({unit})'),
                           ('D90', f'D90 ({unit})')):
            if key in stats and stats[key] is not None:
                lines.append(f'{label:<20s} {stats[key]:.4g} {unit}')
        lines.append(f"{'Coverage':<20s} "
                     f"{stats.get('Areal Coverage (%)', 0):.2f} %")
        if stats.get('Threshold') is not None:
            lines.append(f"{'Threshold':<20s} {stats['Threshold']:.4g} "
                         f"{self.sheet.get('AFM_Units', '')}")
        edge = stats.get('Edge-truncated (excluded)')
        if edge:
            lines.append(f"{'Edge-truncated':<20s} {edge} excluded")
        for warning in stats.get('Warnings') or []:
            lines.append(f'! {warning}')
        self.particle_text.SetValue('\n'.join(lines))

    # -- Force curves ----------------------------------------------------------

    def _build_force(self):
        panel = wx.ScrolledWindow(self.notebook)
        panel.SetScrollRate(0, 10)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, 'Force curves', bold=True), 0, wx.ALL, 8)
        self.force_status = _label(panel, '')
        sizer.Add(self.force_status, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        pick_btn = wx.Button(panel, label='Pick a pixel on the map')
        pick_btn.SetBackgroundColour(BRAND_WX)
        pick_btn.Bind(wx.EVT_BUTTON, self.on_pick_pixel)
        sizer.Add(pick_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        sizer.Add(self._blurb(panel,
                              'The curve is drawn in the companion panel on '
                              "the right — pick 'Force curve' from its "
                              'dropdown.'),
                  0, wx.EXPAND | wx.ALL, 8)

        self.force_metrics = wx.TextCtrl(
            panel, style=wx.TE_MULTILINE | wx.TE_READONLY, size=(-1, 190))
        self.force_metrics.SetFont(wx.Font(9, wx.FONTFAMILY_TELETYPE,
                                           wx.FONTSTYLE_NORMAL,
                                           wx.FONTWEIGHT_NORMAL))
        sizer.Add(self.force_metrics, 0,
                  wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        sizer.Add(wx.StaticLine(panel), 0, wx.EXPAND | wx.ALL, 4)
        sizer.Add(_label(panel, 'Maps from the curves', bold=True), 0,
                  wx.LEFT | wx.RIGHT | wx.TOP, 8)
        sizer.Add(self._blurb(panel,
                              'Every pixel of the force map, measured from its '
                              'own curve. Each becomes an AFM sheet of its own, '
                              'so it levels, profiles and counts like any other '
                              'channel.'),
                  0, wx.EXPAND | wx.ALL, 8)

        self.map_list = wx.CheckListBox(panel, choices=[], size=(-1, 150))
        self._refresh_map_list()
        sizer.Add(self.map_list, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        tip_row = wx.BoxSizer(wx.HORIZONTAL)
        tip_row.Add(_label(panel, 'Tip radius (nm):'), 0,
                    wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.tip_radius = wx.SpinCtrlDouble(panel, min=0.5, max=10000.0,
                                            inc=1.0, initial=10.0,
                                            size=(80, -1))
        self.tip_radius.SetDigits(2)
        self.tip_radius.SetToolTip('Only the DMT modulus uses this. A modulus '
                                   'from an assumed tip radius is indicative, '
                                   'not metrology — the contact stiffness '
                                   'beside it needs no such assumption.')
        tip_row.Add(self.tip_radius, 0, wx.RIGHT, 10)
        tip_row.Add(_label(panel, "Poisson's ratio:"), 0,
                    wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.poisson = wx.SpinCtrlDouble(panel, min=0.0, max=0.5, inc=0.05,
                                         initial=0.5, size=(70, -1))
        self.poisson.SetDigits(2)
        tip_row.Add(self.poisson, 0)
        sizer.Add(tip_row, 0, wx.ALL, 8)

        buttons = wx.BoxSizer(wx.HORIZONTAL)
        add_btn = wx.Button(panel, label='Add the ticked maps')
        add_btn.SetBackgroundColour(BRAND_WX)
        add_btn.Bind(wx.EVT_BUTTON, self.on_publish_ticked_maps)
        buttons.Add(add_btn, 1, wx.RIGHT, 6)
        all_btn = wx.Button(panel, label='Tick all')
        all_btn.Bind(wx.EVT_BUTTON, lambda e: [
            self.map_list.Check(i, True)
            for i in range(self.map_list.GetCount())])
        buttons.Add(all_btn, 0)
        sizer.Add(buttons, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        sizer.Add(wx.StaticLine(panel), 0, wx.EXPAND | wx.ALL, 4)
        sizer.Add(_label(panel, 'Export', bold=True), 0,
                  wx.LEFT | wx.RIGHT | wx.TOP, 8)
        sizer.Add(self._blurb(panel,
                              'Every curve of the map, one row per sample, '
                              'with the per-pixel metrics alongside. A full map '
                              'runs to millions of rows — keep every n-th '
                              'sample to fit it in a spreadsheet.'),
                  0, wx.EXPAND | wx.ALL, 8)

        stride_row = wx.BoxSizer(wx.HORIZONTAL)
        stride_row.Add(_label(panel, 'Keep every'), 0,
                       wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.export_stride = wx.SpinCtrl(panel, min=1, max=1000, initial=1,
                                         size=(70, -1))
        stride_row.Add(self.export_stride, 0, wx.RIGHT, 6)
        stride_row.Add(_label(panel, 'th sample'), 0, wx.ALIGN_CENTER_VERTICAL)
        sizer.Add(stride_row, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        export_buttons = wx.BoxSizer(wx.HORIZONTAL)
        csv_btn = wx.Button(panel, label='Export curves to CSV…')
        csv_btn.Bind(wx.EVT_BUTTON, lambda e: self.on_export_curves('csv'))
        export_buttons.Add(csv_btn, 1, wx.RIGHT, 6)
        xlsx_btn = wx.Button(panel, label='…to Excel')
        xlsx_btn.Bind(wx.EVT_BUTTON, lambda e: self.on_export_curves('xlsx'))
        export_buttons.Add(xlsx_btn, 1)
        sizer.Add(export_buttons, 0,
                  wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.export_status = _label(panel, '')
        self._wrap_labels.append(self.export_status)
        sizer.Add(self.export_status, 0, wx.EXPAND | wx.ALL, 8)

        panel.SetSizer(sizer)
        panel.Bind(wx.EVT_SIZE, self._on_panel_resize)
        return panel

    def _refresh_force(self):
        _name, vol_sheet = self._volume_sheet()
        volume = vol_sheet.get('_afm_volume') if vol_sheet else None
        if not volume:
            self.force_status.SetLabel(
                'No force curves in this file.\n'
                'Force maps come from Asylum .ARDF files.')
            return
        self.force_status.SetLabel(
            f"{len(volume.get('curves') or [])} curves on a "
            f"{volume['points']} x {volume['lines']} grid — "
            f"channels: {', '.join(volume['channels'])}")
        self._refresh_map_list()      # the volume's own channels join the list
        self._show_picked_metrics()

    def _show_picked_metrics(self):
        _name, vol_sheet = self._volume_sheet()
        volume = vol_sheet.get('_afm_volume') if vol_sheet else None
        if not volume:
            return
        picked = vol_sheet.get('AFM_Force_Picked') or [0, 0]
        curve = None
        for c in volume.get('curves') or []:
            if [c['line'], c['point']] == list(picked):
                curve = c
                break
        if curve is None:
            return
        iz = volume_channel_index(volume, 'ZSnsr', 'Raw', 'ZSensor')
        idefl = volume_channel_index(volume, 'Defl', 'Deflection')
        if iz is None or idefl is None:
            return
        try:
            k = float(volume.get('meta', {}).get('SpringConstant', 1.0))
        except (TypeError, ValueError):
            k = 1.0
        from libraries.ToolsMenu.AFM_Engine import (FORCE_METRICS,
                                                    force_curve_metrics)
        metrics = force_curve_metrics(
            curve['data'][iz], curve['data'][idefl], k, curve['seg'],
            float(self.tip_radius.GetValue()) * 1e-9,
            float(self.poisson.GetValue()))
        lines = [f"Line {curve['line']}, point {curve['point']}"
                 f"   (k = {k:.4g} N/m)", '']
        for key, label, unit, scale in FORCE_METRICS:
            value = metrics.get(key)
            if value is None or not np.isfinite(value):
                lines.append(f'{label:<22s}        —')
            else:
                lines.append(f'{label:<22s} {value * scale:9.4g} {unit}')
        self.force_metrics.SetValue('\n'.join(lines))

    def on_pick_pixel(self, event):
        vol_name, vol_sheet = self._volume_sheet()
        volume = vol_sheet.get('_afm_volume') if vol_sheet else None
        if not volume:
            wx.MessageBox('This file has no force curves.', 'AFM',
                          wx.OK | wx.ICON_INFORMATION)
            return
        self._clear_interaction()
        self._mode = 'force_pick'
        ax = self.parent.plot_manager.ax
        array = self.sheet.get('_afm_image')
        if array is None:
            return
        array = np.asarray(array)
        x_scale, y_scale = self._px_scale()

        def on_click(mpl_event):
            if mpl_event.inaxes is not ax or mpl_event.xdata is None:
                return
            col_px = mpl_event.xdata / x_scale
            row_px = mpl_event.ydata / y_scale
            # Map image pixels to the volume grid; volume line 0 is the
            # bottom scan line while image row 0 is the top of the frame.
            col = int(np.clip(col_px * volume['points'] / array.shape[1],
                              0, volume['points'] - 1))
            row_img = int(np.clip(row_px * volume['lines'] / array.shape[0],
                                  0, volume['lines'] - 1))
            line = volume['lines'] - 1 - row_img
            vol_sheet['AFM_Force_Picked'] = [int(line), int(col)]
            self._clear_interaction()
            # Mark the picked pixel on the map.
            marker, = ax.plot([mpl_event.xdata], [mpl_event.ydata],
                              marker='+', color='white', ms=14, mew=3,
                              zorder=12)
            casing, = ax.plot([mpl_event.xdata], [mpl_event.ydata],
                              marker='+', color='black', ms=18, mew=5,
                              zorder=11)
            self._preview_artists = [casing, marker]
            self.parent.plot_manager.canvas.draw_idle()
            self._show_picked_metrics()
            refresh_afm_companion(self.parent)
            self._persist()

        canvas = self.parent.plot_manager.canvas
        self._cids = [canvas.mpl_connect('button_press_event', on_click)]
        self.force_status.SetLabel('Click a pixel on the map…')

    def _map_entries(self):
        """(key, label, unit, scale) for every map this volume can produce.

        The computed metrics, plus one 'value at max force' entry per other
        channel the instrument recorded along the curve — which is what the
        instrument's own extra tabs (amplitude at force, the drive voltages)
        are.
        """
        from libraries.ToolsMenu.AFM_Engine import volume_extra_channels
        entries = list(FORCE_METRICS)
        _name, vol_sheet = self._volume_sheet()
        volume = vol_sheet.get('_afm_volume') if vol_sheet else None
        if volume:
            for _i, channel in volume_extra_channels(volume):
                entries.append((f'at:{channel}', f'{channel} at force', '',
                                1.0))
        return entries

    def _refresh_map_list(self):
        entries = self._map_entries()
        self.map_list.Set([f'{label} ({unit})' if unit else label
                           for _k, label, unit, _s in entries])
        for i in range(min(2, self.map_list.GetCount())):
            self.map_list.Check(i, True)     # adhesion and max force

    def _volume_px_size(self, volume):
        """nm per pixel of a force map, from the image it was taken over."""
        array = self.sheet.get('_afm_image')
        if not self.sheet.get('AFM_NM_Per_Px') or array is None:
            return None
        return (self.sheet['AFM_NM_Per_Px'] * np.asarray(array).shape[1]
                / max(volume['points'], 1))

    def on_publish_ticked_maps(self, event):
        """Publish every ticked metric as an AFM sheet of its own."""
        _vol_name, vol_sheet = self._volume_sheet()
        volume = vol_sheet.get('_afm_volume') if vol_sheet else None
        if not volume:
            wx.MessageBox('This file has no force curves.', 'AFM',
                          wx.OK | wx.ICON_INFORMATION)
            return
        entries = self._map_entries()
        wanted = [entries[i] for i in range(min(self.map_list.GetCount(),
                                                len(entries)))
                  if self.map_list.IsChecked(i)]
        if not wanted:
            self.force_status.SetLabel('Tick at least one map first.')
            return
        wx.BeginBusyCursor()
        try:
            maps = force_volume_maps(volume,
                                     float(self.tip_radius.GetValue()) * 1e-9,
                                     float(self.poisson.GetValue()))
        finally:
            wx.EndBusyCursor()
        if not maps:
            wx.MessageBox('The volume is missing the deflection or Z-sensor '
                          'channel these maps are computed from.', 'AFM',
                          wx.OK | wx.ICON_WARNING)
            return
        nm = self._volume_px_size(volume)
        added = []
        for key, label, unit, _scale in wanted:
            values = maps.get(key)
            if values is None or not np.isfinite(values).any():
                continue
            name, sheet = make_afm_scalar_sheet(
                label.replace(' ', '').replace(':', ''), values, unit, nm,
                self.sheet_name,
                f'{label} map computed from the force curves',
                cmap='viridis',
                exp_info={'Spring Constant (N/m)':
                          volume.get('meta', {}).get('SpringConstant', '?'),
                          'Tip Radius (nm)': float(self.tip_radius.GetValue()),
                          "Poisson's Ratio": float(self.poisson.GetValue())})
            added.append(register_afm_sheet(self.parent, name, sheet))
        if not added:
            self.force_status.SetLabel('None of the ticked maps could be '
                                       'computed from these curves.')
            return
        from libraries.Sheet_Operations import on_sheet_selected
        on_sheet_selected(self.parent, added[0])
        self._persist()
        self.force_status.SetLabel(
            f"Added {len(added)} map(s): {', '.join(added)}")

    def on_publish_map(self, which):
        """Publish one named metric map (kept for the older callers)."""
        index = [k for k, _l, _u, _s in FORCE_METRICS]
        if which in index:
            for i in range(self.map_list.GetCount()):
                self.map_list.Check(i, index[i] == which)
            self.on_publish_ticked_maps(None)

    # -- exporting the curves -------------------------------------------------

    def on_export_curves(self, fmt):
        """Write every force curve of the map to CSV or Excel."""
        from libraries.ToolsMenu.AFM_Engine import (FORCE_METRICS,
                                                    force_curve_rows,
                                                    force_metric_rows,
                                                    spring_constant)

        _vol_name, vol_sheet = self._volume_sheet()
        volume = vol_sheet.get('_afm_volume') if vol_sheet else None
        if not volume:
            wx.MessageBox('This file has no force curves.', 'AFM',
                          wx.OK | wx.ICON_INFORMATION)
            return
        curves = len(volume.get('curves') or [])
        stride = int(self.export_stride.GetValue())
        wildcard = ('CSV files (*.csv)|*.csv' if fmt == 'csv'
                    else 'Excel files (*.xlsx)|*.xlsx')
        default = f"{os.path.splitext(self.sheet.get('AFM_Source_File') or 'force')[0]}_curves.{fmt}"
        with wx.FileDialog(self, 'Export force curves', wildcard=wildcard,
                           defaultFile=default,
                           style=wx.FD_SAVE | wx.FD_OVERWRITE_PROMPT) as dlg:
            if dlg.ShowModal() != wx.ID_OK:
                return
            path = dlg.GetPath()

        header = ['line', 'point', 'segment', 'sample', 'z (nm)',
                  'deflection (nm)', 'force (nN)']
        metric_header = ['line', 'point'] + [f'{label} ({unit})'
                                             for _k, label, unit, _s
                                             in FORCE_METRICS]
        tip = float(self.tip_radius.GetValue()) * 1e-9
        poisson = float(self.poisson.GetValue())
        wx.BeginBusyCursor()
        try:
            if fmt == 'csv':
                written = self._export_csv(path, volume, header, metric_header,
                                           stride, tip, poisson)
            else:
                written = self._export_xlsx(path, volume, header,
                                            metric_header, stride, tip,
                                            poisson)
        except Exception as e:
            import traceback
            traceback.print_exc()
            wx.MessageBox(f'Export failed:\n{e}', 'AFM', wx.OK | wx.ICON_ERROR)
            return
        finally:
            wx.EndBusyCursor()
        self.export_status.SetLabel(
            f'{curves} curves, {written:,} rows written to\n'
            f'{os.path.basename(path)}')

    def _export_csv(self, path, volume, header, metric_header, stride, tip,
                    poisson):
        """Curves to <name>.csv, metrics beside it as <name>_metrics.csv.

        Two files rather than two blocks in one: a single CSV holding both
        needs a reader that knows where one table ends, and the point of CSV
        is that anything can read it.
        """
        import csv
        from libraries.ToolsMenu.AFM_Engine import (force_curve_rows,
                                                    force_metric_rows)

        rows = 0
        with open(path, 'w', newline='', encoding='utf-8') as handle:
            writer = csv.writer(handle)
            writer.writerow(header)
            for row in force_curve_rows(volume, stride):
                writer.writerow([f'{v:.6g}' if isinstance(v, float) else v
                                 for v in row])
                rows += 1
        metrics_path = f'{os.path.splitext(path)[0]}_metrics.csv'
        with open(metrics_path, 'w', newline='', encoding='utf-8') as handle:
            writer = csv.writer(handle)
            writer.writerow(metric_header)
            for row in force_metric_rows(volume, tip, poisson):
                writer.writerow([f'{v:.6g}' if isinstance(v, float) else v
                                 for v in row])
        return rows

    def _export_xlsx(self, path, volume, header, metric_header, stride, tip,
                     poisson):
        """Curves and metrics as two sheets of one workbook.

        Written in openpyxl's write-only mode: a force map is millions of
        rows and a normal workbook builds every cell as an object first.
        Excel stops at 1,048,576 rows, so the export says so and stops there
        rather than writing a file that will not open.
        """
        from openpyxl import Workbook
        from libraries.ToolsMenu.AFM_Engine import (force_curve_rows,
                                                    force_metric_rows)

        limit = 1048575                       # minus the header row
        book = Workbook(write_only=True)
        sheet = book.create_sheet('Curves')
        sheet.append(header)
        rows = 0
        truncated = False
        for row in force_curve_rows(volume, stride):
            if rows >= limit:
                truncated = True
                break
            sheet.append(list(row))
            rows += 1
        metrics = book.create_sheet('Metrics')
        metrics.append(metric_header)
        for row in force_metric_rows(volume, tip, poisson):
            metrics.append(row)
        book.save(path)
        if truncated:
            wx.MessageBox(
                f"Excel holds {limit:,} rows and this map has more.\n"
                f"{rows:,} were written; raise 'keep every n-th sample' or "
                'export to CSV for the lot.', 'AFM', wx.OK | wx.ICON_WARNING)
        return rows


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------

def _resolve_afm_map(window, sheet_name=None):
    """The AFM map sheet a window should bind to, or None."""
    if sheet_name is None:
        sheet_name = window.sheet_combobox.GetValue()
    levels = window.Data.get('Core levels', {})
    sheet = levels.get(sheet_name, {})
    source = sheet.get('AFM_Source_Sheet') if isinstance(sheet, dict) else None
    # A 3D surface (or a line profile) is a view of a channel, not a channel:
    # leveling, roughness and the profile editor all need the map it came from.
    if is_afm_3d_sheet(window, sheet_name) and source in levels:
        return source
    if isinstance(sheet, dict) and sheet.get('_afm'):
        return sheet_name
    if source in levels:
        return source
    afm_maps = [n for n, s in levels.items()
                if isinstance(s, dict) and s.get('_afm')
                and s.get('_afm_kind') != '3d']
    return afm_maps[0] if afm_maps else None


def open_afm_window(window, sheet_name=None):
    """Open (or raise) the AFM analysis window for the selected sheet."""
    sheet_name = _resolve_afm_map(window, sheet_name)
    if sheet_name is None:
        wx.MessageBox('No AFM map is open.\n\n'
                      'Use File > Import > AFM to load one.',
                      'AFM Analysis', wx.OK | wx.ICON_INFORMATION)
        return None

    existing = getattr(window, 'afm_analysis_window', None)
    if existing:
        try:
            if existing.sheet_name == sheet_name:
                existing.Raise()
                return existing
            existing.Close()
        except Exception:
            pass

    frame = AFMAnalysisWindow(window, sheet_name)
    window.afm_analysis_window = frame
    frame.Show()
    return frame


def open_afm_section(window, key):
    """Open one AFM section (Channels, Level, …) as its own window."""
    sheet_name = _resolve_afm_map(window)
    if sheet_name is None:
        wx.MessageBox('No AFM map is open.\n\nUse File > Import > AFM '
                      'to load one.', 'AFM Analysis',
                      wx.OK | wx.ICON_INFORMATION)
        return None
    for existing in list(getattr(window, '_afm_windows', [])):
        try:
            if (getattr(existing, '_section_keys', None) == [key]
                    and existing.sheet_name == sheet_name):
                existing.Raise()
                return existing
        except Exception:
            pass
    frame = AFMAnalysisWindow(window, sheet_name, sections=[key])
    frame.Show()
    return frame
