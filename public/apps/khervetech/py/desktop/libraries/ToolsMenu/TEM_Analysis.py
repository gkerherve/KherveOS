# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/TEM_Analysis.py. Regenerate with tools/export_khervetech.py.
"""
TEM Analysis window.

Seven tabs over a TEM~Map image sheet, driving the *main* canvas (the image is
already displayed there, so lines, regions and measurements are drawn on the
main axes — same design as the SEM and TGA tools):

    Calibrate   view / set the pixel size in nm (DM files carry it; plain
                TIFF exports do not), plus the acquisition metadata
    Particles   threshold / clean / split settings and particle counting —
                the SEM engine is reused unchanged, with the polarity
                defaulting to dark-on-bright as bright-field TEM needs
    Profile     a two-click line on the image that stays editable — drag it,
                swing either end, change the width — with the profile and
                its fringe spacing recomputed on every change, exported as
                a 'TEM~Plot' sheet
    FFT         a rotatable square/rectangle region (scroll to rotate) and
                the FFT button, which computes the power spectrum and adds
                it as a 'TEM~FFT' sheet calibrated in 1/nm
    Filter      aperture masks over chosen spots and the inverse transform
                of each one (see TEM_Filter)
    Measure     on the FFT: click-to-measure d-spacings and angles, an
                automatic spot finder, d-spacing labels, structure / hkl
                identification against the standard sequences or a lattice
                the user names, and inserting the annotated FFT back onto
                the map as a Labels-Manager image overlay
    Advanced    moving-window d-spacing / orientation mapping and GPA strain
                maps (see TEM_Filter)

Measurements are stored on the sheets (``TEM_Particles``, ``TEM_FFT_Spots``,
``TEM_FFT_Structure``, ``TEM_FFT_Masks``, ``TEM_Profile_*``) so they survive a
save/reload.
"""

import numpy as np
import wx

from libraries.FileMenu.TEM_Import import (is_tem_fft, make_tem_fft_sheet,
                                           promote_named_fft,
                                           register_tem_sheet, tem_array,
                                           tem_extent)
from libraries.ToolsMenu.TEM_Engine import (angles_between_families,
                                            detect_spots, display_fft,
                                            extract_rotated_region,
                                            group_spot_families, hkl_table,
                                            identify_structure, line_profile,
                                            pair_friedel_mates, profile_peaks,
                                            region_fft, spacing_stats,
                                            system_needs_c, LATTICE_SYSTEMS)
from libraries.ToolsMenu.TEM_Denoise import DenoiseTabMixin
from libraries.ToolsMenu.TEM_Filter import AdvancedTabMixin, FilterTabMixin
from libraries.ToolsMenu.TEM_Plot import plot_tem_image

BRAND = (79 / 255, 190 / 255, 159 / 255)
BRAND_WX = wx.Colour(79, 190, 159)

# How the FFT inset is rendered when it is dropped onto the micrograph. The
# defaults are tuned for an inset a third of the image wide: harder contrast
# and bigger labels than the same FFT viewed full size.
INSET_DEFAULTS = {
    'gamma': 0.5,          # log-stretch exponent — lower lifts weak spots
    'clip_low': 1.0,       # display percentiles, so the transmitted beam
    'clip_high': 99.7,     # does not set the whole scale on its own
    'label_size': 11.0,
    'scale_bar': True,
    'border': True,
    'border_colour': 'white',
    'border_width': 1.5,
    'opacity': 1.0,
    'x': 0.63, 'y': 0.63, 'width': 0.33,
}


def _label(parent, text, bold=False):
    ctrl = wx.StaticText(parent, label=text)
    if bold:
        font = ctrl.GetFont()
        font.SetWeight(wx.FONTWEIGHT_BOLD)
        ctrl.SetFont(font)
    return ctrl


def _closest_label(assigned, d, tolerance=0.03):
    """The hkl assigned to the spacing nearest ``d``, within ``tolerance``."""
    for d_ref, label in assigned.items():
        if abs(d - d_ref) <= tolerance * d_ref:
            return label
    return ''


class TEMAnalysisWindow(FilterTabMixin, AdvancedTabMixin, DenoiseTabMixin,
                        wx.Frame):
    # Section key -> (tab title, builder-method name). Order is the tab order
    # of the full window.
    SECTIONS = (
        ('calibrate', 'Calibrate', '_build_calibrate'),
        ('particles', 'Particles', '_build_particles'),
        ('profile', 'Profile', '_build_profile'),
        ('fft', 'FFT', '_build_fft'),
        ('filter', 'Filter', '_build_filter'),
        ('measure', 'Measure', '_build_measure'),
        ('advanced', 'Advanced', '_build_advanced'),
        ('denoise', 'Denoise', '_build_denoise'),
    )
    SECTION_TITLES = {k: t for k, t, _b in SECTIONS}

    # Per-section (size, min size) for the single-tab pop-out windows, each
    # sized to its own content (measured from the tab's sizer min) plus a small
    # margin, instead of one tall default. Sections not listed fall back below.
    SINGLE_SIZES = {
        'calibrate': ((450, 540), (430, 500)),
        'particles': ((480, 600), (460, 560)),
        'profile':   ((440, 615), (420, 560)),
        'fft':       ((430, 380), (410, 350)),
        'filter':    ((440, 560), (420, 520)),
        'measure':   ((440, 555), (420, 515)),
        'advanced':  ((440, 540), (420, 500)),
        'denoise':   ((440, 565), (420, 525)),
    }

    def __init__(self, parent, sheet_name, sections=None):
        # ``sections`` = an ordered list of section keys to build, or None for
        # the full seven-tab window. A single-section window is what the
        # toolbar's pop-out icons open.
        keys = [k for k, _t, _b in self.SECTIONS]
        self._section_keys = ([s for s in (sections or keys) if s in keys]
                              or keys)
        single = len(self._section_keys) == 1
        if single:
            key = self._section_keys[0]
            title = f'TEM {self.SECTION_TITLES[key]} — {sheet_name}'
            # Compact pop-outs are sized to their own content instead of one
            # tall default: (size, min-size) per section, falling back to the
            # generic single-tab size.
            size, min_size = self.SINGLE_SIZES.get(
                key, ((460, 640), (440, 520)))
        else:
            title = f'TEM Analysis — {sheet_name}'
            size = (500, 760)
            min_size = (470, 600)
        super().__init__(parent, title=title, size=size,
                         style=wx.DEFAULT_FRAME_STYLE | wx.FRAME_FLOAT_ON_PARENT)
        self.SetMinSize(min_size)
        self.parent = parent
        self.sheet_name = sheet_name       # the TEM~Map sheet this window drives
        self.fft_sheet_name = None         # the TEM~FFT sheet being measured
        self.profile_sheet_name = None     # the TEM~Plot sheet kept in step

        # Interactive state on the main canvas.
        self._mode = None                  # 'line' | 'roi' | 'measure' | 'angle'
                                           # | 'mask' | 'peaks'
        self._cids = []                    # mpl connection ids owned by us
        self._roi = None                   # RotatableRectangle instance
        self._particle_selector = None     # matplotlib ROI selector (Particles)
        self._line_start = None
        self._line = None                  # ((x0,y0),(x1,y1)) in px
        self.line_width_px = 1
        self._line_grab = None             # 'start' | 'end' | 'body' while dragging
        self._angle_first = None
        self._preview_artists = []
        self._polygon_points = []
        self._advanced_spots = []
        self._peak_positions = []          # in the profile's own x units

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
        self.notebook.Bind(wx.EVT_NOTEBOOK_PAGE_CHANGED, self.on_page_changed)
        self.CentreOnParent()
        # Only refresh the sections that were actually built (the FFT-sheet and
        # profile-line restores are already guarded on their own controls).
        if 'calibrate' in self._section_keys:
            self._refresh_calibration()
        self._sync_fft_sheet()
        if 'profile' in self._section_keys:
            self._restore_profile_line()

        # Register in the parent's list of open TEM windows, so that arming a
        # canvas interaction in one clears the others (they all drive the one
        # main canvas — only one tool can be live at a time).
        if not hasattr(parent, '_tem_windows'):
            parent._tem_windows = []
        parent._tem_windows.append(self)

    # -- sheet access ------------------------------------------------------

    @property
    def sheet(self):
        return self.parent.Data.get('Core levels', {}).get(self.sheet_name, {})

    @property
    def fft_sheet(self):
        if not self.fft_sheet_name:
            return {}
        return self.parent.Data.get('Core levels', {}).get(self.fft_sheet_name, {})

    def _redraw_main(self, sheet_name=None, preserve_view=False):
        plot_tem_image(self.parent, sheet_name or self.sheet_name,
                       preserve_view=preserve_view)

    def _persist(self):
        try:
            from libraries.FileMenu.KFitting_IO import persist_project
            persist_project(self.parent)
        except Exception as e:
            print(f'TEM persist skipped: {e}')

    def _show_sheet(self, sheet_name):
        """Select and display a sheet on the main canvas.

        If that sheet is *already* the one on screen, the current zoom and pan
        are kept: starting or continuing an interaction (draw a line, edit it,
        pick a spot, drop an ROI) must never throw away the view the user
        zoomed to. Only a genuine switch to a different sheet gets a fresh,
        full-frame view.
        """
        try:
            current = self.parent.sheet_combobox.GetValue()
        except Exception:
            current = None
        if (sheet_name == current
                and getattr(self.parent, 'tem_on_main', None) == sheet_name):
            self._redraw_main(sheet_name, preserve_view=True)
            return
        try:
            self.parent.sheet_combobox.SetStringSelection(sheet_name)
        except Exception:
            pass
        from libraries.Sheet_Operations import on_sheet_selected
        on_sheet_selected(self.parent, sheet_name)

    def _map_scale(self):
        """(data units per pixel, unit) of the map sheet's current extent."""
        sheet = self.sheet
        extent, unit = tem_extent(sheet)
        array = tem_array(sheet)
        if extent is None or array is None:
            return 1.0, 'px'
        return abs(extent[1] - extent[0]) / array.shape[1], unit

    def _sync_fft_sheet(self):
        """Point the Measure tab at the most relevant TEM~FFT sheet."""
        levels = self.parent.Data.get('Core levels', {})
        selected = None
        try:
            selected = self.parent.sheet_combobox.GetValue()
        except Exception:
            pass
        # A sheet named TEM~FFT is a diffractogram even if it imported as a
        # plain image: adopt the FFT kind so it becomes measurable/filterable.
        if selected and promote_named_fft(levels.get(selected, {}), selected) \
                and getattr(self.parent, 'tem_on_main', None) == selected:
            self._redraw_main(selected, preserve_view=False)
        if selected and is_tem_fft(levels.get(selected, {})):
            self.fft_sheet_name = selected
        elif not (self.fft_sheet_name and self.fft_sheet_name in levels):
            ffts = [n for n, s in levels.items()
                    if is_tem_fft(s) and s.get('TEM_FFT_Source') == self.sheet_name]
            self.fft_sheet_name = ffts[-1] if ffts else None
        if getattr(self, 'fft_target_text', None):
            self.fft_target_text.SetLabel(
                f'Measuring: {self.fft_sheet_name}' if self.fft_sheet_name
                else 'No FFT / diffraction pattern yet — compute one in the FFT '
                     'tab, or use the button below to measure the image on '
                     'screen directly.')
        self.refresh_mask_list()
        self.refresh_advanced_choices()

    def on_use_as_diffraction(self, event):
        """Mark the image on screen as a diffraction pattern so it is measurable.

        An acquired diffraction pattern (SAED) or an FFT saved as a plain image
        imports as a real-space map (``_tem_kind='map'``). The Measure tab keys
        off that flag, not the sheet name, so renaming to TEM~FFT does nothing.
        This flips the flag to 'fft' in place — the pixels are untouched — and
        points the Measure tab at it. Distances stay in pixels until a
        reciprocal scale is set.
        """
        name = getattr(self.parent, 'tem_on_main', None) or self.sheet_name
        levels = self.parent.Data.get('Core levels', {})
        sheet = levels.get(name)
        if not (isinstance(sheet, dict) and tem_array(sheet) is not None):
            wx.MessageBox('Select a TEM image on the main canvas first.', 'TEM',
                          wx.OK | wx.ICON_INFORMATION)
            return
        if is_tem_fft(sheet):
            self.fft_sheet_name = name
            self._sync_fft_sheet()
            self.measure_status.SetLabel(f'{name} is already a diffraction '
                                         f'pattern — measuring it.')
            return
        sheet['_tem_kind'] = 'fft'
        sheet.setdefault('TEM_FFT_Spots', [])
        sheet.setdefault('TEM_FFT_Structure', None)
        sheet.setdefault('TEM_FFT_Source', None)
        sheet.setdefault('TEM_RecipPerPx', sheet.get('TEM_RecipPerPx'))
        self.fft_sheet_name = name
        self._show_sheet(name)
        self._redraw_main(name, preserve_view=False)   # extent becomes centred
        self._sync_fft_sheet()
        self._persist()
        unit = ('calibrated' if sheet.get('TEM_RecipPerPx')
                else 'uncalibrated — distances in pixels until you set the '
                     'reciprocal scale')
        self.measure_status.SetLabel(
            f'Now measuring {name} as a diffraction pattern ({unit}).')

    def on_set_reciprocal_scale(self, event):
        """Set the reciprocal calibration (1/nm per px) of the FFT sheet."""
        if self._require_fft() is None:
            return
        sheet = self.fft_sheet
        dialog = _ReciprocalScaleDialog(self, sheet.get('TEM_RecipPerPx'))
        if dialog.ShowModal() == wx.ID_OK and dialog.result:
            sheet['TEM_RecipPerPx'] = float(dialog.result)
            self._show_sheet(self.fft_sheet_name)
            self._redraw_main(self.fft_sheet_name, preserve_view=False)
            self._persist()
            self.measure_status.SetLabel(
                f'Reciprocal scale set to {dialog.result:.5g} 1/nm per px — '
                f'measurements now read in nm.')
        dialog.Destroy()

    # -- Calibrate ---------------------------------------------------------

    def _build_calibrate(self):
        panel = wx.Panel(self.notebook)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, 'Pixel size', bold=True), 0, wx.ALL, 8)
        self.scale_text = _label(panel, '')
        sizer.Add(self.scale_text, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(_label(panel, 'Pixel size (nm):'), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.nm_ctrl = wx.TextCtrl(panel, size=(120, -1))
        row.Add(self.nm_ctrl)
        apply_btn = wx.Button(panel, label='Apply')
        apply_btn.Bind(wx.EVT_BUTTON, self.on_apply_scale)
        row.Add(apply_btn, 0, wx.LEFT, 8)
        sizer.Add(row, 0, wx.ALL, 8)

        sizer.Add(_label(panel, 'DM3/DM4/DM5 files carry their calibration;\n'
                                'set it here only for plain image exports.'),
                  0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        sizer.Add(self._build_brightness(panel), 0, wx.EXPAND | wx.ALL, 8)

        sizer.Add(_label(panel, 'Acquisition metadata', bold=True),
                  0, wx.LEFT | wx.RIGHT, 8)
        self.meta_grid = wx.ListCtrl(panel, style=wx.LC_REPORT | wx.LC_SINGLE_SEL)
        self.meta_grid.InsertColumn(0, 'Property', width=180)
        self.meta_grid.InsertColumn(1, 'Value', width=210)
        sizer.Add(self.meta_grid, 1, wx.EXPAND | wx.ALL, 8)

        panel.SetSizer(sizer)
        return panel

    def _build_brightness(self, parent):
        """Brightness / contrast for the micrograph, previewed live.

        Only how the map is displayed changes; the stored pixels are never
        touched, so a d-spacing or a particle size is always measured off the
        real data. (An FFT or a scalar map has its own display path and is
        left alone.) The same ``adjust_image`` the SEM tool uses does the
        work — it is technique-agnostic, like the particle counter.
        """
        box = wx.StaticBoxSizer(wx.VERTICAL, parent, 'Brightness / contrast')
        inner = box.GetStaticBox()

        self.auto_contrast = wx.CheckBox(inner, label='Auto contrast (stretch)')
        self.auto_contrast.SetToolTip('Stretch the 1st–99th percentile to the '
                                      'full range — fixes most low-contrast '
                                      'micrographs on its own.')
        self.auto_contrast.Bind(wx.EVT_CHECKBOX, self.on_display_adjust)
        box.Add(self.auto_contrast, 0, wx.ALL, 6)

        grid = wx.FlexGridSizer(2, 3, 4, 8)
        grid.AddGrowableCol(1, 1)
        for label, attr in (('Brightness:', 'brightness'),
                            ('Contrast:', 'contrast')):
            grid.Add(_label(inner, label), 0, wx.ALIGN_CENTER_VERTICAL)
            slider = wx.Slider(inner, value=0, minValue=-100, maxValue=100,
                               style=wx.SL_HORIZONTAL)
            slider.Bind(wx.EVT_SLIDER, self.on_display_adjust)
            setattr(self, f'{attr}_slider', slider)
            grid.Add(slider, 1, wx.EXPAND)
            value = _label(inner, '0')
            setattr(self, f'{attr}_value', value)
            grid.Add(value, 0, wx.ALIGN_CENTER_VERTICAL)
        box.Add(grid, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 6)

        reset = wx.Button(inner, label='Reset')
        reset.Bind(wx.EVT_BUTTON, self.on_reset_adjust)
        box.Add(reset, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 6)

        self._load_adjust_from_sheet()
        return box

    def _adjust_target(self):
        """(name, sheet) the brightness controls act on.

        The image *currently on the main canvas* — so the controls work for
        whatever is shown (a map, an FFT, a reconstruction), not only the map
        this window is bound to. Falls back to the bound map when the canvas
        shows something without an image.
        """
        name = getattr(self.parent, 'tem_on_main', None) or self.sheet_name
        sheet = self.parent.Data.get('Core levels', {}).get(name, {})
        if not (isinstance(sheet, dict) and sheet.get('_tem')
                and sheet.get('_tem_image') is not None):
            name, sheet = self.sheet_name, self.sheet
        return name, sheet

    def _display_input(self, sheet):
        """The array ``adjust_image`` sees for this sheet (FFT: log-stretched)."""
        image = tem_array(sheet)
        if image is None:
            return None
        if is_tem_fft(sheet):
            return display_fft(np.asarray(image))
        return np.asarray(image, dtype=float)

    def _auto_equivalent_bc(self):
        """Brightness/contrast the auto-stretch of the active image amounts to.

        Auto contrast is a 1st–99th-percentile stretch; expressing it as the
        equivalent brightness (offset) and contrast (gain) is what lets the
        readouts show real numbers instead of the sliders' idle zero.
        """
        _name, sheet = self._adjust_target()
        data = self._display_input(sheet)
        if data is None:
            return None, None
        data = np.asarray(data, dtype=float)
        top = float(data.max())
        if top <= 0:
            return 0, 0
        norm = np.clip(data / top, 0.0, 1.0)
        lo, hi = np.percentile(norm, (1.0, 99.0))
        if hi <= lo:
            return 0, 0
        gain = 1.0 / (hi - lo)
        contrast = 100.0 * (gain - 1.0)
        brightness = 100.0 * (gain * (0.5 - lo) - 0.5)
        return int(round(brightness)), int(round(contrast))

    def _load_adjust_from_sheet(self):
        """Seed the controls from the image now on the canvas."""
        _name, sheet = self._adjust_target()
        self.brightness_slider.SetValue(int(sheet.get('TEM_Brightness', 0) or 0))
        self.contrast_slider.SetValue(int(sheet.get('TEM_Contrast', 0) or 0))
        self.auto_contrast.SetValue(bool(sheet.get('TEM_AutoContrast', False)))
        self._sync_manual_adjust()
        self._sync_adjust_labels()

    def _sync_manual_adjust(self):
        """Disable the manual sliders while auto contrast is in charge."""
        on = self.auto_contrast.GetValue()
        self.brightness_slider.Enable(not on)
        self.contrast_slider.Enable(not on)

    def _sync_adjust_labels(self):
        # Under auto contrast the readouts show the *equivalent* brightness and
        # contrast the stretch is applying, not the (idle) slider values.
        if self.auto_contrast.GetValue():
            b, c = self._auto_equivalent_bc()
            self.brightness_value.SetLabel('—' if b is None else f'{b:+d}')
            self.contrast_value.SetLabel('—' if c is None else f'{c:+d}')
        else:
            self.brightness_value.SetLabel(str(self.brightness_slider.GetValue()))
            self.contrast_value.SetLabel(str(self.contrast_slider.GetValue()))

    def on_display_adjust(self, event):
        """Store the current brightness/contrast and preview it live."""
        name, sheet = self._adjust_target()
        sheet['TEM_Brightness'] = float(self.brightness_slider.GetValue())
        sheet['TEM_Contrast'] = float(self.contrast_slider.GetValue())
        sheet['TEM_AutoContrast'] = bool(self.auto_contrast.GetValue())
        self._sync_manual_adjust()
        self._sync_adjust_labels()
        self._show_sheet(name)
        self._redraw_main(name, preserve_view=True)
        self._persist()

    def on_reset_adjust(self, event):
        self.brightness_slider.SetValue(0)
        self.contrast_slider.SetValue(0)
        self.auto_contrast.SetValue(False)
        self.on_display_adjust(event)

    def _refresh_calibration(self):
        sheet = self.sheet
        array = tem_array(sheet)
        # An FFT has no pixel size — it is calibrated in reciprocal space (1/nm
        # per px, set on the Measure tab). Show that instead of a nm/px field
        # so the brightness controls below stay usable on the diffractogram.
        if is_tem_fft(sheet):
            recip = sheet.get('TEM_RecipPerPx')
            self.scale_text.SetLabel(
                f'Reciprocal scale: {recip:.6g} 1/nm per pixel'
                if recip else 'Diffractogram — set the reciprocal scale on the '
                              'Measure tab (Reciprocal scale…).')
            self.scale_text.SetForegroundColour(
                wx.NullColour if recip else wx.Colour(160, 0, 0))
            self.nm_ctrl.SetValue('')
            self.nm_ctrl.Enable(False)
            self.meta_grid.DeleteAllItems()
            for key, value in (sheet.get('ExperimentalInfo') or {}).items():
                row = self.meta_grid.InsertItem(self.meta_grid.GetItemCount(),
                                                str(key))
                text = f'{value:.6g}' if isinstance(value, float) else str(value)
                self.meta_grid.SetItem(row, 1, text)
            return
        self.nm_ctrl.Enable(True)
        nm = sheet.get('TEM_NM_Per_Px')
        if nm:
            fov = ''
            if array is not None:
                width_nm = array.shape[1] * nm
                fov = (f'\nField of view: {width_nm / 1000:.3f} µm wide'
                       if width_nm > 2000 else
                       f'\nField of view: {width_nm:.4g} nm wide')
            self.scale_text.SetLabel(
                f'{nm:.6g} nm/pixel  ({sheet.get("TEM_Scale_Source", "?")}){fov}')
            self.nm_ctrl.SetValue(f'{nm:.6g}')
            self.scale_text.SetForegroundColour(wx.NullColour)
        else:
            self.scale_text.SetLabel('Not calibrated — distances will be in pixels.')
            self.scale_text.SetForegroundColour(wx.Colour(160, 0, 0))

        self.meta_grid.DeleteAllItems()
        for key, value in (sheet.get('ExperimentalInfo') or {}).items():
            row = self.meta_grid.InsertItem(self.meta_grid.GetItemCount(), str(key))
            text = f'{value:.6g}' if isinstance(value, float) else str(value)
            self.meta_grid.SetItem(row, 1, text)

    def on_apply_scale(self, event):
        sheet = self.sheet
        if is_tem_fft(sheet):
            wx.MessageBox('This is a diffractogram — it has no pixel size.\n\n'
                          'Set its reciprocal scale (1/nm per pixel) on the '
                          'Measure tab with "Reciprocal scale…".', 'Calibrate',
                          wx.OK | wx.ICON_INFORMATION)
            return
        try:
            nm = float(self.nm_ctrl.GetValue())
        except ValueError:
            wx.MessageBox('Enter the pixel size in nanometres.', 'Calibrate',
                          wx.OK | wx.ICON_WARNING)
            return
        if nm <= 0:
            wx.MessageBox('The pixel size must be positive.', 'Calibrate',
                          wx.OK | wx.ICON_WARNING)
            return
        sheet['TEM_NM_Per_Px'] = float(nm)
        sheet['TEM_Scale_Source'] = 'manual'
        if sheet.get('TEM_Particles'):
            sheet['TEM_Particles'] = None
            sheet['_tem_overlay'] = None
            self._set_particle_status('Calibration changed — re-run the detection.')
        self._refresh_calibration()
        self._redraw_main()
        self._persist()

    # -- Particles ---------------------------------------------------------

    def _build_particles(self):
        from libraries.ToolsMenu.SEM_Engine import DEFAULTS

        panel = wx.Panel(self.notebook)
        sizer = wx.BoxSizer(wx.VERTICAL)

        # Controls laid out in two side-by-side columns so the window stays
        # short: detection settings on the left, size limits on the right.
        cols = wx.BoxSizer(wx.HORIZONTAL)
        left = wx.FlexGridSizer(3, 2, 6, 6)
        left.AddGrowableCol(1, 1)
        right = wx.FlexGridSizer(3, 2, 6, 6)
        right.AddGrowableCol(1, 1)

        left.Add(_label(panel, 'Particles are:'), 0, wx.ALIGN_CENTER_VERTICAL)
        # The left column's inputs keep a fixed width so the longest dropdown
        # entry cannot stretch the whole window (and its popup) wide.
        left_input = (185, -1)
        self.polarity = wx.Choice(panel, size=left_input,
                                  choices=['Dark on bright', 'Bright on dark'])
        self.polarity.SetSelection(0)   # bright-field TEM: particles are dark
        left.Add(self.polarity, 0)

        left.Add(_label(panel, 'Detection:'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.method = wx.Choice(panel, size=left_input, choices=[
            'Otsu threshold', 'Top hat threshold',
            'Manual threshold', 'Blobs (round particles)'])
        self.method.SetSelection(3)     # TEM particles usually touch/agglomerate
        self.method.SetToolTip(
            'Threshold methods fill in every dark region, so touching '
            'particles merge. "Blobs" finds round particles individually and '
            'is usually the right choice for agglomerated nanoparticles. '
            '"Top hat threshold" handles an uneven background.')
        self.method.Bind(wx.EVT_CHOICE, lambda e: self._sync_manual())
        left.Add(self.method, 0)

        left.Add(_label(panel, 'Manual level:'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.threshold = wx.SpinCtrl(panel, size=left_input,
                                     min=0, max=65535, initial=128)
        left.Add(self.threshold, 0)

        self.sensitivity_label = _label(panel, 'Blob sensitivity:')
        right.Add(self.sensitivity_label, 0, wx.ALIGN_CENTER_VERTICAL)
        self.sensitivity = wx.SpinCtrl(panel, min=1, max=99, initial=50)
        self.sensitivity.SetToolTip('Higher finds more, fainter particles; '
                                    'lower keeps only the clear ones.')
        right.Add(self.sensitivity, 0, wx.EXPAND)

        right.Add(_label(panel, 'Min. size (px):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.min_size = wx.SpinCtrl(panel, min=1, max=1000000,
                                    initial=DEFAULTS['min_size_px'])
        right.Add(self.min_size, 0, wx.EXPAND)

        right.Add(_label(panel, 'Max. size (px):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.max_size = wx.SpinCtrl(panel, min=0, max=100000000, initial=0)
        self.max_size.SetToolTip('0 = no upper limit. Particles larger than '
                                 'this are ignored.')
        right.Add(self.max_size, 0, wx.EXPAND)

        cols.Add(left, 1, wx.EXPAND | wx.RIGHT, 12)
        cols.Add(right, 1, wx.EXPAND)
        sizer.Add(cols, 0, wx.EXPAND | wx.ALL, 8)

        # Options in two columns as well.
        opts = wx.FlexGridSizer(2, 2, 6, 12)
        opts.AddGrowableCol(0, 1)
        opts.AddGrowableCol(1, 1)
        self.fill_holes = wx.CheckBox(panel, label='Fill holes inside particles')
        self.fill_holes.SetValue(True)
        opts.Add(self.fill_holes, 0, wx.ALIGN_CENTER_VERTICAL)

        self.exclude_edge = wx.CheckBox(
            panel, label='Discard particles cut by the edge')
        self.exclude_edge.SetValue(True)
        opts.Add(self.exclude_edge, 0, wx.ALIGN_CENTER_VERTICAL)

        self.split = wx.CheckBox(panel, label='Split touching particles')
        opts.Add(self.split, 0, wx.ALIGN_CENTER_VERTICAL)

        split_row = wx.BoxSizer(wx.HORIZONTAL)
        split_row.Add(_label(panel, 'Split blobs >'), 0,
                      wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.split_multiple = wx.SpinCtrlDouble(panel, min=1.5, max=20.0, inc=0.5,
                                                initial=DEFAULTS['split_min_multiple'])
        self.split_multiple.SetDigits(1)
        split_row.Add(self.split_multiple)
        split_row.Add(_label(panel, '× median'), 0,
                      wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 6)
        opts.Add(split_row, 0, wx.ALIGN_CENTER_VERTICAL)
        sizer.Add(opts, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.TOP, 8)

        sizer.Add(wx.StaticLine(panel), 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)
        sizer.Add(_label(panel, 'Region of interest', bold=True), 0, wx.ALL, 8)
        self.roi_status = _label(panel, '')
        sizer.Add(self.roi_status, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        roi_shape_row = wx.BoxSizer(wx.HORIZONTAL)
        roi_shape_row.Add(_label(panel, 'Shape:'), 0,
                          wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.roi_shape = wx.Choice(panel, choices=['Rectangle', 'Square',
                                                   'Circle', 'Ellipse'])
        self.roi_shape.SetSelection(0)
        roi_shape_row.Add(self.roi_shape)
        sizer.Add(roi_shape_row, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        roi_row = wx.BoxSizer(wx.HORIZONTAL)
        draw_roi = wx.Button(panel, label='Draw ROI')
        draw_roi.SetToolTip('Drag the shape on the image; particles are then '
                            'counted only inside it.')
        draw_roi.Bind(wx.EVT_BUTTON, self.on_draw_roi_particles)
        roi_row.Add(draw_roi, 1, wx.RIGHT, 4)
        clear_roi = wx.Button(panel, label='Use whole image')
        clear_roi.Bind(wx.EVT_BUTTON, self.on_clear_roi_particles)
        roi_row.Add(clear_roi, 1)
        sizer.Add(roi_row, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        run = wx.Button(panel, label='Detect particles')
        run.SetBackgroundColour(BRAND_WX)
        run.Bind(wx.EVT_BUTTON, self.on_detect)
        sizer.Add(run, 0, wx.EXPAND | wx.ALL, 8)

        self.particle_status = _label(panel, '')
        sizer.Add(self.particle_status, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.results_grid = wx.ListCtrl(panel, style=wx.LC_REPORT | wx.LC_SINGLE_SEL,
                                        size=(-1, 160))
        self.results_grid.InsertColumn(0, 'Quantity', width=210)
        self.results_grid.InsertColumn(1, 'Value', width=150)
        sizer.Add(self.results_grid, 1, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        buttons = wx.BoxSizer(wx.HORIZONTAL)
        copy_btn = wx.Button(panel, label='Copy statistics')
        copy_btn.Bind(wx.EVT_BUTTON, self.on_copy_stats)
        buttons.Add(copy_btn, 1, wx.RIGHT, 4)
        count_btn = wx.Button(panel, label='Count sheet')
        count_btn.Bind(wx.EVT_BUTTON, lambda e: self.on_publish('count'))
        buttons.Add(count_btn, 1, wx.RIGHT, 4)
        freq_btn = wx.Button(panel, label='Freq. sheet')
        freq_btn.Bind(wx.EVT_BUTTON, lambda e: self.on_publish('frequency'))
        buttons.Add(freq_btn, 1)
        sizer.Add(buttons, 0, wx.EXPAND | wx.ALL, 8)

        panel.SetSizer(sizer)
        self._sync_manual()
        self._refresh_roi_status()
        return panel

    def _sync_manual(self):
        method = self.method.GetSelection()
        self.threshold.Enable(method == 2)          # Manual threshold
        is_blobs = method == 3
        self.sensitivity.Enable(is_blobs)
        # Splitting and hole-filling are threshold-pipeline notions; the blob
        # detector already isolates each particle, so they do nothing there.
        for ctrl in (self.split, self.split_multiple, self.fill_holes):
            ctrl.Enable(not is_blobs)

    # -- particle ROI ------------------------------------------------------

    def _refresh_roi_status(self):
        """Describe the current ROI, in pixels and physical units."""
        if not getattr(self, 'roi_status', None):
            return
        roi = self.sheet.get('TEM_Particle_ROI')
        if not roi:
            self.roi_status.SetLabel('Whole image.')
            return
        nm = self.sheet.get('TEM_NM_Per_Px')
        if roi.get('kind') == 'ellipse':
            rx, ry = float(roi['rx']), float(roi['ry'])
            shape = 'Circle' if abs(rx - ry) < 0.5 else 'Ellipse'
            if nm:
                extent = (f'{2 * rx * nm:.4g} × {2 * ry * nm:.4g} nm'
                          if 2 * rx * nm < 1000 else
                          f'{2 * rx * nm / 1000:.3g} × {2 * ry * nm / 1000:.3g} µm')
            else:
                extent = f'{2 * rx:.0f} × {2 * ry:.0f} px'
            self.roi_status.SetLabel(f'{shape}, {extent}.')
        else:
            width = abs(float(roi['x1']) - float(roi['x0']))
            height = abs(float(roi['y1']) - float(roi['y0']))
            shape = 'Square' if abs(width - height) < 0.5 else 'Rectangle'
            if nm:
                extent = (f'{width * nm:.4g} × {height * nm:.4g} nm'
                          if width * nm < 1000 else
                          f'{width * nm / 1000:.3g} × {height * nm / 1000:.3g} µm')
            else:
                extent = f'{width:.0f} × {height:.0f} px'
            self.roi_status.SetLabel(f'{shape}, {extent}.')

    def on_draw_roi_particles(self, event):
        """Drag a rectangle/square/circle/ellipse to limit the particle count."""
        from matplotlib.widgets import EllipseSelector, RectangleSelector

        self._show_sheet(self.sheet_name)
        self._clear_interaction()
        ax = self.parent.plot_manager.ax
        scale, _unit = self._map_scale()
        shape = self.roi_shape.GetStringSelection()

        def on_select(press, release):
            if press.xdata is None or release.xdata is None:
                return
            # Axes units -> image pixels, the frame the mask is built in.
            x0, x1 = press.xdata / scale, release.xdata / scale
            y0, y1 = press.ydata / scale, release.ydata / scale
            if abs(x1 - x0) < 4 or abs(y1 - y0) < 4:
                return
            self.sheet['TEM_Particle_ROI'] = self._roi_from_drag(
                shape, x0, y0, x1, y1)
            self._invalidate_particle_roi()
            self._clear_particle_selector()
            self._refresh_roi_status()
            self._redraw_main(preserve_view=True)
            self._persist()

        style = dict(facecolor='none', edgecolor=BRAND, linewidth=1.6)
        if shape in ('Circle', 'Ellipse'):
            selector = EllipseSelector(ax, on_select, useblit=True, button=[1],
                                       interactive=False, props=style)
        else:
            selector = RectangleSelector(ax, on_select, useblit=True, button=[1],
                                         interactive=False, props=style)
        self._particle_selector = selector
        self.roi_status.SetLabel(f'Drag a {shape.lower()} on the image now…')

    def _roi_from_drag(self, shape, x0, y0, x1, y1):
        """Build the stored ROI descriptor from a drag, in image pixels."""
        if shape in ('Circle', 'Ellipse'):
            cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
            rx, ry = abs(x1 - x0) / 2.0, abs(y1 - y0) / 2.0
            if shape == 'Circle':
                rx = ry = min(rx, ry)      # a circle keeps the smaller radius
            return {'kind': 'ellipse', 'cx': float(cx), 'cy': float(cy),
                    'rx': float(rx), 'ry': float(ry)}
        if shape == 'Square':
            # Equal sides, grown from the press corner toward the drag.
            side = min(abs(x1 - x0), abs(y1 - y0))
            x1 = x0 + side * (1 if x1 >= x0 else -1)
            y1 = y0 + side * (1 if y1 >= y0 else -1)
        return {'kind': 'rect', 'x0': float(x0), 'y0': float(y0),
                'x1': float(x1), 'y1': float(y1)}

    def _invalidate_particle_roi(self):
        """A changed ROI makes any existing detection stale."""
        if self.sheet.get('TEM_Particles'):
            self.sheet['TEM_Particles'] = None
            self.sheet['_tem_overlay'] = None
            if getattr(self, 'results_grid', None):
                self.results_grid.DeleteAllItems()

    def _clear_particle_selector(self):
        selector = getattr(self, '_particle_selector', None)
        if selector is not None:
            try:
                selector.set_active(False)
                selector.disconnect_events()
            except Exception:
                pass
            self._particle_selector = None

    def on_clear_roi_particles(self, event):
        self._clear_particle_selector()
        self.sheet['TEM_Particle_ROI'] = None
        self._invalidate_particle_roi()
        self._refresh_roi_status()
        self._redraw_main(preserve_view=True)
        self._persist()

    def _set_particle_status(self, text):
        if getattr(self, 'particle_status', None):
            self.particle_status.SetLabel(text)

    def _params(self):
        method = ('otsu', 'tophat', 'manual', 'blobs')[self.method.GetSelection()]
        return {
            'polarity': 'dark' if self.polarity.GetSelection() == 0 else 'bright',
            'threshold_method': method,
            'threshold_value': self.threshold.GetValue(),
            'blob_sensitivity': self.sensitivity.GetValue(),
            'min_size_px': self.min_size.GetValue(),
            'max_size_px': self.max_size.GetValue(),
            'fill_holes': self.fill_holes.GetValue(),
            'exclude_edge': self.exclude_edge.GetValue(),
            'split_touching': self.split.GetValue(),
            'split_min_multiple': self.split_multiple.GetValue(),
            'shape_metrics': False,
        }

    def on_detect(self, event):
        from libraries.ToolsMenu.SEM_Engine import (analyse, boundary_overlay,
                                                    detect_blobs)
        from libraries.ToolsMenu.TEM_Engine import particle_roi_mask

        sheet = self.sheet
        image = tem_array(sheet)
        if image is None:
            return
        self._clear_particle_selector()
        params = self._params()
        blobs = params['threshold_method'] == 'blobs'
        self._set_particle_status('Finding round particles…' if blobs
                                  else 'Detecting…')
        wx.BeginBusyCursor()
        try:
            # Only the ROI counts; coverage and number density in analyse()
            # already normalise to the mask area, so a circle is honest.
            mask = particle_roi_mask(sheet.get('TEM_Particle_ROI'),
                                     image.shape[:2])
            detector = detect_blobs if blobs else analyse
            result = detector(np.asarray(image), mask,
                              sheet.get('TEM_NM_Per_Px'), params)
            sheet['_tem_overlay'] = boundary_overlay(result['labels'])
            sheet['TEM_Particles'] = self._serialisable_result(result)
            stats = result['stats']
            self._set_particle_status(
                f"{stats['Count']} particles "
                f"({stats['Areal Coverage (%)']:.1f}% coverage)")
            self._fill_particle_results()
            self._show_sheet(self.sheet_name)
            self._redraw_main(preserve_view=True)
            self._persist()
        except Exception as e:
            import traceback
            traceback.print_exc()
            self._set_particle_status(f'Detection failed: {e}')
            wx.MessageBox(f'Detection failed:\n{e}', 'TEM', wx.OK | wx.ICON_ERROR)
        finally:
            wx.EndBusyCursor()

    def _serialisable_result(self, result):
        stats = dict(result['stats'])
        stats['Diameters (nm)'] = [round(float(v), 3) for v in result['diameters']]
        stats['Areas (nm2)'] = [round(float(v), 2) for v in result['areas']]
        stats['Parameters'] = {k: v for k, v in result['params'].items()}
        stats['Warnings'] = list(result['warnings'])
        return stats

    def _fill_particle_results(self):
        from libraries.ToolsMenu.SEM_Engine import lognormal_fit, mean_with_error

        self.results_grid.DeleteAllItems()
        stats = self.sheet.get('TEM_Particles') or {}
        if not stats:
            return
        diameters = np.asarray(stats.get('Diameters (nm)') or [], dtype=float)
        unit = 'nm' if 'ECD Mean (nm)' in stats else 'px'
        summary = mean_with_error(diameters)
        if summary:
            row = self.results_grid.InsertItem(0, f'Mean size ({unit})')
            self.results_grid.SetItem(
                row, 1, f"{summary['mean']:.2f} ± {summary['sd']:.2f} (SD)")
        skip = {'Diameters (nm)', 'Areas (nm2)', 'Parameters', 'Warnings',
                'Median Diameter (px)'}
        for key, value in stats.items():
            if key in skip or value is None:
                continue
            row = self.results_grid.InsertItem(self.results_grid.GetItemCount(), key)
            text = f'{value:.4g}' if isinstance(value, float) else str(value)
            self.results_grid.SetItem(row, 1, text)
        fit = lognormal_fit(diameters)
        if fit:
            for key, value in (('Lognormal median', fit['median']),
                               ('Lognormal mode', fit['mode']),
                               ('Geometric std dev', fit['gsd'])):
                row = self.results_grid.InsertItem(self.results_grid.GetItemCount(), key)
                self.results_grid.SetItem(row, 1, f'{value:.4g}')

    def on_copy_stats(self, event):
        stats = self.sheet.get('TEM_Particles') or {}
        if not stats:
            return
        skip = {'Diameters (nm)', 'Areas (nm2)', 'Parameters', 'Warnings'}
        lines = [f'{k}\t{v}' for k, v in stats.items() if k not in skip]
        if wx.TheClipboard.Open():
            wx.TheClipboard.SetData(wx.TextDataObject('\n'.join(lines)))
            wx.TheClipboard.Close()
            self._set_particle_status('Statistics copied to the clipboard.')

    def on_publish(self, kind):
        """Publish the size distribution as a TEM~Count / TEM~Freq sheet.

        Built through the SEM sheet factory (the distribution machinery —
        bin widths, bar rendering, lognormal overlay — is shared), then
        renamed to the TEM~ prefix so it reads as what it is.
        """
        from libraries.ToolsMenu.SEM_Engine import (default_bin_width,
                                                    lognormal_fit,
                                                    mean_with_error,
                                                    size_distribution)
        from libraries.ToolsMenu.SEM_Sheets import make_distribution_sheet

        stats = self.sheet.get('TEM_Particles') or {}
        diameters = np.asarray(stats.get('Diameters (nm)') or [], dtype=float)
        if diameters.size == 0:
            wx.MessageBox('Run a detection first.', 'TEM',
                          wx.OK | wx.ICON_INFORMATION)
            return
        centres, counts, frequency = size_distribution(
            diameters, bin_width=default_bin_width(diameters))
        values = frequency if kind == 'frequency' else counts

        _, sheet = make_distribution_sheet(kind, centres, values,
                                           self.sheet_name, stats,
                                           fit=lognormal_fit(diameters),
                                           summary=mean_with_error(diameters))
        name = 'TEM~Freq' if kind == 'frequency' else 'TEM~Count'
        sheet['Name'] = name
        sheet['ExperimentalInfo']['Technique'] = 'TEM'
        self.parent.Data['Core levels'][name] = sheet
        self.parent.Data['Number of Core levels'] = len(
            self.parent.Data['Core levels'])
        try:
            if name not in list(self.parent.sheet_combobox.GetStrings()):
                self.parent.sheet_combobox.Append(name)
        except Exception:
            pass
        self._persist()
        self._set_particle_status(f"Added '{name}' as a sheet.")

    # -- Profile -----------------------------------------------------------

    def _build_profile(self):
        panel = wx.Panel(self.notebook)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, 'Line profile', bold=True), 0, wx.ALL, 8)
        sizer.Add(_label(panel,
                         'Click a start and an end point on the image. The\n'
                         'line then stays live: drag its middle to move it,\n'
                         'either end to swing or lengthen it, and the scroll\n'
                         'wheel to change the integration width. The profile\n'
                         'and its spacing follow every change.'),
                  0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(_label(panel, 'Width (px):'), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.width_ctrl = wx.SpinCtrl(panel, min=1, max=500, initial=1)
        self.width_ctrl.Bind(wx.EVT_SPINCTRL, self.on_width_spin)
        row.Add(self.width_ctrl)
        sizer.Add(row, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        buttons = wx.BoxSizer(wx.HORIZONTAL)
        draw_btn = wx.Button(panel, label='Draw line')
        draw_btn.Bind(wx.EVT_BUTTON, self.on_draw_line)
        buttons.Add(draw_btn, 1, wx.RIGHT, 4)
        edit_btn = wx.Button(panel, label='Edit line')
        edit_btn.SetToolTip('Pick the existing line back up to move, swing '
                            'or resize it.')
        edit_btn.Bind(wx.EVT_BUTTON, self.on_edit_line)
        buttons.Add(edit_btn, 1, wx.RIGHT, 4)
        delete_btn = wx.Button(panel, label='Delete line')
        delete_btn.Bind(wx.EVT_BUTTON, self.on_delete_line)
        buttons.Add(delete_btn, 1)
        sizer.Add(buttons, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        export_btn = wx.Button(panel, label='Add profile as TEM~Plot sheet')
        export_btn.SetBackgroundColour(BRAND_WX)
        export_btn.Bind(wx.EVT_BUTTON, self.on_export_profile)
        sizer.Add(export_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        self.profile_status = _label(panel, '')
        sizer.Add(self.profile_status, 0, wx.ALL, 8)

        sizer.Add(wx.StaticLine(panel), 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)
        sizer.Add(_label(panel, 'Lattice spacing from the profile', bold=True),
                  0, wx.ALL, 8)

        grid = wx.FlexGridSizer(2, 2, 6, 6)
        grid.Add(_label(panel, 'Smoothing (pts):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.peak_smooth = wx.SpinCtrl(panel, min=1, max=99, initial=5)
        self.peak_smooth.SetToolTip('Width of the Gaussian used before peak '
                                    'finding. 1 disables it.')
        self.peak_smooth.Bind(wx.EVT_SPINCTRL, lambda e: self.on_detect_peaks(None))
        grid.Add(self.peak_smooth)
        grid.Add(_label(panel, 'Sensitivity (%):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.peak_prominence = wx.SpinCtrl(panel, min=1, max=90, initial=10)
        self.peak_prominence.SetToolTip('Minimum peak prominence as a '
                                        'percentage of the profile’s range. '
                                        'Lower finds more, weaker peaks.')
        self.peak_prominence.Bind(wx.EVT_SPINCTRL,
                                  lambda e: self.on_detect_peaks(None))
        grid.Add(self.peak_prominence)
        sizer.Add(grid, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        detect_btn = wx.Button(panel, label='Detect fringe peaks')
        detect_btn.SetBackgroundColour(BRAND_WX)
        detect_btn.Bind(wx.EVT_BUTTON, self.on_detect_peaks)
        sizer.Add(detect_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        self.peak_edit_btn = wx.Button(panel, label='Edit peaks on the profile')
        self.peak_edit_btn.SetToolTip(
            'Click the profile to add a peak (snapped to the nearest '
            'maximum), drag a marker to move it, Ctrl-click one to remove it.')
        self.peak_edit_btn.Bind(wx.EVT_BUTTON, self.on_edit_peaks)
        sizer.Add(self.peak_edit_btn, 0, wx.EXPAND | wx.ALL, 8)

        self.spacing_text = wx.TextCtrl(
            panel, style=wx.TE_MULTILINE | wx.TE_READONLY, size=(-1, 90))
        sizer.Add(self.spacing_text, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        copy_btn = wx.Button(panel, label='Copy spacing result')
        copy_btn.Bind(wx.EVT_BUTTON, self.on_copy_spacing)
        sizer.Add(copy_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.spacing_label_btn = wx.Button(panel,
                                           label='Spacing labels → editable text')
        self.spacing_label_btn.SetToolTip(
            'Turn the spacing numbers on the plot into Labels Manager text '
            'entries, so you can restyle the font and colour, move them, or '
            'edit the text. Click again to remove them.')
        self.spacing_label_btn.Bind(wx.EVT_BUTTON, self.on_bake_spacing_labels)
        sizer.Add(self.spacing_label_btn, 0,
                  wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        panel.SetSizer(sizer)
        return panel

    def on_bake_spacing_labels(self, event):
        """Convert the inline spacing numbers into editable Labels Manager text.

        A toggle: once the numbers exist as Labels Manager entries the overlay
        stops drawing its own copies (so they cannot double up), and clicking
        again removes them and brings the inline numbers back.
        """
        sheet = self._profile_sheet()
        name = self.profile_sheet_name
        if not sheet:
            wx.MessageBox('Add the profile as a TEM~Plot sheet first.', 'TEM',
                          wx.OK | wx.ICON_INFORMATION)
            return

        labels = sheet.setdefault('Labels', [])
        if sheet.get('TEM_Spacing_Baked'):
            sheet['Labels'] = [lb for lb in labels if not lb.get('_tem_spacing')]
            sheet['TEM_Spacing_Baked'] = False
            self.spacing_label_btn.SetLabel('Spacing labels → editable text')
            self.profile_status.SetLabel('Spacing labels removed.')
        else:
            entries = self._spacing_label_entries(sheet)
            if not entries:
                wx.MessageBox('Detect at least two peaks first.', 'TEM',
                              wx.OK | wx.ICON_INFORMATION)
                return
            labels.extend(entries)
            sheet['TEM_Spacing_Baked'] = True
            self.spacing_label_btn.SetLabel('Remove spacing labels')
            # Surface them in the Labels Manager so the user can restyle.
            manager = getattr(self.parent, 'labels_window', None)
            if manager:
                try:
                    manager.update_list()
                except Exception:
                    pass
            self.profile_status.SetLabel(
                f'{len(entries)} spacing labels added — edit them in the '
                f'Labels Manager (font, colour, position).')
        self._show_sheet(name)
        self._persist()

    def _spacing_label_entries(self, sheet):
        """Build Labels-Manager text entries for each inter-peak spacing."""
        from libraries.ToolsMenu.TEM_Engine import smooth_profile
        from libraries.ToolsMenu.TEM_Plot import profile_peak_positions

        x = np.asarray(sheet.get('B.E.') or [], dtype=float)
        y = np.asarray(sheet.get('Raw Data') or [], dtype=float)
        positions = sorted(float(p) for p in profile_peak_positions(sheet))
        if x.size < 3 or len(positions) < 2:
            return []
        curve = smooth_profile(y, int(sheet.get('TEM_Profile_Smooth') or 5))
        heights = np.interp(positions, x, curve)
        span = float(curve.max() - curve.min()) or 1.0
        unit = 'nm' if 'nm' in str(sheet.get('TEM_X_Label', '')) else 'px'
        fmt = '{:.3f}' if unit == 'nm' else '{:.1f}'

        entries = []
        for i in range(len(positions) - 1):
            mid = 0.5 * (positions[i] + positions[i + 1])
            label_y = max(heights[i], heights[i + 1]) + 0.10 * span
            entries.append({
                'type': 'text', '_tem_spacing': True,
                'text': fmt.format(positions[i + 1] - positions[i]),
                'x': float(mid), 'y': float(label_y),
                'rotation': 0, 'fontsize': 11, 'fontfamily': 'Arial',
                'color': '#2b6cb0', 'fontweight': 'bold',
                'va': 'bottom', 'ha': 'center'})
        return entries

    def on_width_spin(self, event):
        self.line_width_px = max(1, self.width_ctrl.GetValue())
        if self._line is not None:
            self._apply_line_change()

    # -- drawing and editing the line -------------------------------------

    def on_draw_line(self, event):
        self._show_sheet(self.sheet_name)
        self._clear_interaction()
        self._mode = 'line'
        self._line_start = None
        self._line = None
        canvas = self.parent.plot_manager.canvas
        self._cids = [
            canvas.mpl_connect('button_press_event', self._on_line_click),
            canvas.mpl_connect('motion_notify_event', self._on_line_motion),
            canvas.mpl_connect('scroll_event', self._on_line_scroll),
        ]
        self.profile_status.SetLabel('Click the start point on the image…')

    def on_edit_line(self, event):
        if self._line is None:
            self._restore_profile_line()
        if self._line is None:
            wx.MessageBox('Draw a line first.', 'TEM',
                          wx.OK | wx.ICON_INFORMATION)
            return
        self._show_sheet(self.sheet_name)
        self._start_line_editing()

    def on_delete_line(self, event):
        self._clear_interaction()
        self._line = None
        self._peak_positions = []
        sheet = self.sheet
        sheet['TEM_Profile_Line'] = None
        sheet['TEM_Profile_Width'] = None
        self.spacing_text.SetValue('')
        self.profile_status.SetLabel('Line deleted.')
        self._redraw_main(preserve_view=True)
        self._persist()

    def _restore_profile_line(self):
        """Pick up the line, peaks and TEM~Plot sheet of a previous session.

        Without this a reopened window shows the line on the image but has no
        idea it owns it, so the first edit would silently create a second
        profile sheet beside the one already there.
        """
        from libraries.ToolsMenu.TEM_Plot import profile_peak_positions

        for name, sheet in self.parent.Data.get('Core levels', {}).items():
            if (str(name).startswith('TEM~Plot')
                    and sheet.get('TEM_Source_Sheet') == self.sheet_name):
                self.profile_sheet_name = name
                break

        self._peak_positions = [float(p) for p in
                                profile_peak_positions(self.sheet)]
        smooth = self.sheet.get('TEM_Profile_Smooth')
        if smooth and getattr(self, 'peak_smooth', None):
            self.peak_smooth.SetValue(int(smooth))

        line = self.sheet.get('TEM_Profile_Line')
        if not line or len(line) < 4:
            return
        self._line = ((float(line[0]), float(line[1])),
                      (float(line[2]), float(line[3])))
        self.line_width_px = max(1, int(self.sheet.get('TEM_Profile_Width') or 1))
        if getattr(self, 'width_ctrl', None):
            self.width_ctrl.SetValue(self.line_width_px)
        if self._peak_positions:
            self._publish_peaks()

    def _start_line_editing(self):
        """Make the drawn line grabbable: ends to swing, middle to move."""
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
        self.profile_status.SetLabel(
            'Drag an end to swing or resize, the middle to move, the wheel '
            'to change the width.')

    def _line_display_points(self):
        """The line's two ends in display pixels, for hit testing.

        Hit testing in data units cannot work here: the same tolerance is
        several pixels on a 20 nm field and invisible on a 2 µm one.
        """
        ax = self.parent.plot_manager.ax
        scale, _unit = self._map_scale()
        (x0, y0), (x1, y1) = self._line
        return [ax.transData.transform((x0 * scale, y0 * scale)),
                ax.transData.transform((x1 * scale, y1 * scale))]

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
        else:
            # Inside the band? Distance from the click to the segment.
            if self._distance_to_line(event.x, event.y) < 12:
                self._line_grab = 'body'
                scale, _unit = self._map_scale()
                self._grab_anchor = (event.xdata / scale, event.ydata / scale)
            else:
                self._line_grab = None

    def _distance_to_line(self, px, py):
        (sx, sy), (ex, ey) = self._line_display_points()
        vx, vy = ex - sx, ey - sy
        length_sq = vx * vx + vy * vy
        if length_sq <= 0:
            return np.hypot(px - sx, py - sy)
        t = max(0.0, min(1.0, ((px - sx) * vx + (py - sy) * vy) / length_sq))
        return np.hypot(px - (sx + t * vx), py - (sy + t * vy))

    def _on_line_drag(self, event):
        ax = self.parent.plot_manager.ax
        if (self._mode != 'line_edit' or not self._line_grab
                or event.inaxes is not ax or event.xdata is None):
            return
        scale, _unit = self._map_scale()
        point = (event.xdata / scale, event.ydata / scale)
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

    def _on_line_click(self, event):
        ax = self.parent.plot_manager.ax
        if self._mode != 'line' or event.inaxes is not ax or event.button != 1:
            return
        scale, _ = self._map_scale()
        point = (event.xdata / scale, event.ydata / scale)   # px
        if self._line_start is None:
            self._line_start = point
            self.profile_status.SetLabel(
                'Click the end point (scroll to set the width)…')
        else:
            self._line = (self._line_start, point)
            self._line_start = None
            self._apply_line_change()
            # Hand straight over to the editor: a line that can only be
            # redrawn from scratch is the thing this tab used to get wrong.
            self._start_line_editing()

    def _on_line_motion(self, event):
        ax = self.parent.plot_manager.ax
        if (self._mode != 'line' or self._line_start is None
                or event.inaxes is not ax):
            return
        scale, _ = self._map_scale()
        self._draw_line_preview(self._line_start,
                                (event.xdata / scale, event.ydata / scale))

    def _on_line_scroll(self, event):
        if self._mode not in ('line', 'line_edit'):
            return
        if event.button == 'up':
            self.line_width_px = min(500, self.line_width_px + 1)
        elif event.button == 'down':
            self.line_width_px = max(1, self.line_width_px - 1)
        self.width_ctrl.SetValue(self.line_width_px)
        if self._mode == 'line_edit' and self._line is not None:
            self._apply_line_change()
        elif (self._line_start is not None and event.xdata is not None
                and event.ydata is not None):
            scale, _ = self._map_scale()
            self._draw_line_preview(self._line_start,
                                    (event.xdata / scale, event.ydata / scale))

    def _apply_line_change(self):
        """Store the line, redraw it, and recompute everything it feeds.

        This is the single point every edit funnels through, so the drawn
        band, the exported sheet and the spacing statistics can never drift
        apart from the line actually on screen.
        """
        if self._line is None:
            return
        sheet = self.sheet
        (x0, y0), (x1, y1) = self._line
        sheet['TEM_Profile_Line'] = [float(x0), float(y0), float(x1), float(y1)]
        sheet['TEM_Profile_Width'] = int(self.line_width_px)
        self._draw_line_final()

        length_px = float(np.hypot(x1 - x0, y1 - y0))
        nm = sheet.get('TEM_NM_Per_Px')
        length = f'{length_px * nm:.4g} nm' if nm else f'{length_px:.1f} px'
        self.profile_status.SetLabel(
            f'Line: {length}, width {self.line_width_px} px.')

        self._refresh_profile_sheet()
        self._persist()

    # -- the profile and its peaks ----------------------------------------

    def _current_profile(self):
        """(x, y, x_label) of the profile under the current line."""
        sheet = self.sheet
        image = tem_array(sheet)
        if image is None or self._line is None:
            return None, None, ''
        start, end = self._line
        distance_px, values = line_profile(image, start, end,
                                           self.line_width_px)
        if distance_px.size == 0:
            return None, None, ''
        nm = sheet.get('TEM_NM_Per_Px')
        if nm:
            return distance_px * nm, values, 'Distance (nm)'
        return distance_px, values, 'Distance (px)'

    def _refresh_profile_sheet(self):
        """Recompute the linked TEM~Plot sheet after the line moved."""
        if not self.profile_sheet_name:
            return
        sheet = self.parent.Data.get('Core levels', {}).get(
            self.profile_sheet_name)
        if not sheet:
            self.profile_sheet_name = None
            return
        x, y, x_label = self._current_profile()
        if x is None:
            return
        (x0, y0), (x1, y1) = self._line
        sheet['B.E.'] = [float(v) for v in x]
        sheet['Raw Data'] = [float(v) for v in y]
        sheet['TEM_X_Label'] = x_label
        sheet['TEM_Line'] = [float(x0), float(y0), float(x1), float(y1)]
        sheet['TEM_Line_Width'] = int(self.line_width_px)
        sheet['Background']['Bkg Y'] = [float(v) for v in y]
        # Peaks were picked on the old profile and no longer mean anything.
        self._peak_positions = []
        sheet['TEM_Profile_Peaks'] = []
        sheet['TEM_Profile_Stats'] = None
        self.on_detect_peaks(None, quiet=True)
        if self.parent.sheet_combobox.GetValue() == self.profile_sheet_name:
            self._show_sheet(self.profile_sheet_name)

    def on_detect_peaks(self, event, quiet=False):
        x, y, x_label = self._current_profile()
        if x is None:
            if not quiet:
                wx.MessageBox('Draw a line on the image first.', 'TEM',
                              wx.OK | wx.ICON_INFORMATION)
            return
        result = profile_peaks(x, y,
                               smooth=int(self.peak_smooth.GetValue()),
                               prominence_frac=self.peak_prominence.GetValue() / 100.0)
        self._peak_positions = [float(p) for p in result['positions']]
        self._publish_peaks(x_label, changed=True)

    def _publish_peaks(self, x_label=None, changed=False):
        """Write the peak list and its statistics wherever they are shown.

        ``changed`` marks a real edit (detect, add/move/remove a peak, move
        the line) as opposed to a passive redisplay: only then are any baked
        spacing labels cleared, because they were built from the old peaks.
        Reopening a project must not wipe the labels the user styled and saved.
        """
        if changed:
            self._clear_baked_spacing(self._profile_sheet())
        positions = sorted(self._peak_positions)
        stats = spacing_stats(positions)
        unit = 'nm' if 'nm' in (x_label or self._profile_unit_label()) else 'px'

        if stats['n_periods']:
            lines = [
                f"Average spacing: {stats['mean']:.4g} ± {stats['sd']:.2g} {unit}"
                f"  (SD over {stats['n_periods']} periods)",
                f"Standard error of the mean: {stats['sem']:.2g} {unit}",
                f"Peaks found: {len(positions)}",
                f"Range: {min(stats['spacings']):.4g} – "
                f"{max(stats['spacings']):.4g} {unit}",
            ]
        elif positions:
            lines = [f'{len(positions)} peak(s) — at least two are needed for '
                     f'a spacing.']
        else:
            lines = ['No peaks found. Lower the sensitivity, or reduce the '
                     'smoothing if the fringes are fine.']
        self.spacing_text.SetValue('\n'.join(lines))

        # Both are stored as JSON *strings*: the fringes of a 0.2 nm lattice
        # sit 0.2 apart and a standard deviation is a few picometres, and the
        # project JSON rounds every float it finds to two decimals — which
        # would stack every peak on one position and flatten the spread to
        # zero. A string passes through untouched. (Same trick as the EIS
        # results blob; read back through TEM_Plot.profile_stats.)
        import json
        stored = None
        if stats['n_periods']:
            stored = json.dumps({
                'mean': stats['mean'], 'sd': stats['sd'], 'sem': stats['sem'],
                'n_periods': stats['n_periods'], 'unit': unit,
                'spacings': [float(s) for s in stats['spacings']]})
        encoded = json.dumps([float(p) for p in positions])
        for sheet in (self.sheet, self._profile_sheet()):
            if sheet is None:
                continue
            sheet['TEM_Profile_Peaks'] = encoded
            sheet['TEM_Profile_Stats'] = stored
            sheet['TEM_Profile_Smooth'] = int(self.peak_smooth.GetValue())
        if (self.profile_sheet_name
                and self.parent.sheet_combobox.GetValue() == self.profile_sheet_name):
            self._show_sheet(self.profile_sheet_name)
        self._persist()

    def _clear_baked_spacing(self, sheet):
        """Drop any baked spacing labels; the inline preview then returns."""
        if sheet and sheet.get('TEM_Spacing_Baked'):
            sheet['Labels'] = [lb for lb in sheet.get('Labels', [])
                               if not lb.get('_tem_spacing')]
            sheet['TEM_Spacing_Baked'] = False
            self._sync_spacing_button()

    def _profile_sheet(self):
        if not self.profile_sheet_name:
            return None
        return self.parent.Data.get('Core levels', {}).get(
            self.profile_sheet_name)

    def _profile_unit_label(self):
        sheet = self._profile_sheet() or {}
        return sheet.get('TEM_X_Label') or (
            'Distance (nm)' if self.sheet.get('TEM_NM_Per_Px')
            else 'Distance (px)')

    def on_edit_peaks(self, event):
        """Add, move or remove peak markers by clicking the profile plot."""
        if not self.profile_sheet_name:
            wx.MessageBox('Add the profile as a TEM~Plot sheet first — the '
                          'markers are edited on that plot.', 'TEM',
                          wx.OK | wx.ICON_INFORMATION)
            return
        self._show_sheet(self.profile_sheet_name)
        self._clear_interaction(redraw=False)
        self._mode = 'peaks'
        self._peak_grab = None
        canvas = self.parent.plot_manager.canvas
        self._cids = [
            canvas.mpl_connect('button_press_event', self._on_peak_press),
            canvas.mpl_connect('motion_notify_event', self._on_peak_motion),
            canvas.mpl_connect('button_release_event', self._on_peak_release),
        ]
        self.profile_status.SetLabel(
            'Click to add a peak, drag a marker to move it, '
            'Ctrl-click one to remove it.')

    def _nearest_peak(self, event):
        """Index of the marker under the pointer, in display pixels."""
        ax = self.parent.plot_manager.ax
        if not self._peak_positions or event.xdata is None:
            return None
        best, best_distance = None, 1e9
        for index, position in enumerate(self._peak_positions):
            px, _py = ax.transData.transform((position, 0.0))
            distance = abs(event.x - px)
            if distance < best_distance:
                best, best_distance = index, distance
        return best if best_distance < 10 else None

    def _on_peak_press(self, event):
        # Removal is Ctrl-click, not right-click: the main canvas already
        # opens its own context menu on button 3, and that menu is modal.
        ax = self.parent.plot_manager.ax
        if self._mode != 'peaks' or event.inaxes is not ax or event.button != 1:
            return
        index = self._nearest_peak(event)
        if event.key in ('control', 'ctrl+shift', 'shift+control'):
            if index is not None:
                removed = self._peak_positions.pop(index)
                self._publish_peaks(changed=True)
                self.profile_status.SetLabel(f'Peak at {removed:.4g} removed.')
            return
        if index is not None:
            self._peak_grab = index
            return
        # Add one, snapped to the nearest maximum of the smoothed profile so
        # a click near a fringe lands on the fringe.
        self._peak_positions.append(self._snap_to_maximum(event.xdata))
        self._publish_peaks(changed=True)

    def _on_peak_motion(self, event):
        if (self._mode != 'peaks' or self._peak_grab is None
                or event.xdata is None):
            return
        self._peak_positions[self._peak_grab] = float(event.xdata)

    def _on_peak_release(self, event):
        # A dragged marker is left exactly where it was dropped. Snapping it
        # back to the nearest maximum, as a newly added one is, would make
        # the drag a no-op inside a fringe and defeat the whole point of
        # being able to correct the detector by hand.
        if self._mode != 'peaks' or self._peak_grab is None:
            return
        if event.xdata is not None:
            self._peak_positions[self._peak_grab] = float(event.xdata)
        self._peak_grab = None
        self._publish_peaks(changed=True)

    def _snap_to_maximum(self, x_value, window_fraction=0.02):
        """Nearest local maximum of the smoothed profile to ``x_value``."""
        from libraries.ToolsMenu.TEM_Engine import _parabolic_vertex, smooth_profile

        sheet = self._profile_sheet() or {}
        x = np.asarray(sheet.get('B.E.') or [], dtype=float)
        y = np.asarray(sheet.get('Raw Data') or [], dtype=float)
        if x.size < 3 or x.size != y.size:
            return float(x_value)
        curve = smooth_profile(y, int(self.peak_smooth.GetValue()))
        span = float(x.max() - x.min())
        half = max(2, int(round(window_fraction * x.size)))
        centre = int(np.argmin(np.abs(x - x_value)))
        lo, hi = max(0, centre - half), min(x.size, centre + half + 1)
        local = int(np.argmax(curve[lo:hi])) + lo
        return _parabolic_vertex(x, curve, local)

    def on_copy_spacing(self, event):
        text = self.spacing_text.GetValue()
        if text and wx.TheClipboard.Open():
            wx.TheClipboard.SetData(wx.TextDataObject(text))
            wx.TheClipboard.Close()
            self.profile_status.SetLabel('Spacing result copied.')

    def _line_band(self, start, end, width_px):
        """Polygon corners (in data units) of the integration band."""
        scale, _ = self._map_scale()
        x0, y0 = start
        x1, y1 = end
        length = np.hypot(x1 - x0, y1 - y0)
        if length == 0:
            return None
        px = -(y1 - y0) / length
        py = (x1 - x0) / length
        half = width_px / 2.0
        return [((x0 + px * half) * scale, (y0 + py * half) * scale),
                ((x1 + px * half) * scale, (y1 + py * half) * scale),
                ((x1 - px * half) * scale, (y1 - py * half) * scale),
                ((x0 - px * half) * scale, (y0 - py * half) * scale)]

    def _clear_preview(self):
        for artist in self._preview_artists:
            try:
                artist.remove()
            except Exception:
                pass
        self._preview_artists = []

    def _draw_line_preview(self, start, end):
        from matplotlib.patches import Polygon

        ax = self.parent.plot_manager.ax
        scale, _ = self._map_scale()
        self._clear_preview()
        line, = ax.plot([start[0] * scale, end[0] * scale],
                        [start[1] * scale, end[1] * scale],
                        '--', color='red', lw=1.2, zorder=10)
        self._preview_artists = [line]
        if self.line_width_px > 1:
            corners = self._line_band(start, end, self.line_width_px)
            if corners:
                band = Polygon(corners, closed=True, facecolor='red',
                               alpha=0.18, edgecolor='none', zorder=9)
                ax.add_patch(band)
                self._preview_artists.append(band)
        self.parent.plot_manager.canvas.draw_idle()

    def _draw_line_final(self):
        from matplotlib.patches import Polygon

        if self._line is None:
            return
        ax = self.parent.plot_manager.ax
        scale, _ = self._map_scale()
        start, end = self._line
        self._clear_preview()
        line, = ax.plot([start[0] * scale, end[0] * scale],
                        [start[1] * scale, end[1] * scale],
                        '-', color='red', lw=1.4, zorder=10)
        self._preview_artists = [line]
        if self.line_width_px > 1:
            corners = self._line_band(start, end, self.line_width_px)
            if corners:
                band = Polygon(corners, closed=True, facecolor='red',
                               alpha=0.18, edgecolor='none', zorder=9)
                ax.add_patch(band)
                self._preview_artists.append(band)
        self.parent.plot_manager.canvas.draw_idle()

    def on_export_profile(self, event):
        if self._line is None:
            wx.MessageBox('Draw a line on the image first.', 'TEM',
                          wx.OK | wx.ICON_INFORMATION)
            return
        sheet = self.sheet
        image = tem_array(sheet)
        start, end = self._line
        distance_px, values = line_profile(image, start, end,
                                           self.line_width_px)
        if distance_px.size == 0:
            wx.MessageBox('The line is too short.', 'TEM',
                          wx.OK | wx.ICON_WARNING)
            return

        nm = sheet.get('TEM_NM_Per_Px')
        distances = (distance_px * nm) if nm else distance_px
        x_label = 'Distance (nm)' if nm else 'Distance (px)'

        name, profile_sheet = 'TEM~Plot', {
            'Name': 'TEM~Plot',
            'B.E.': [float(v) for v in distances],
            'Raw Data': [float(v) for v in values],
            'TEM_X_Label': x_label,
            'TEM_Y_Label': 'Intensity (a.u.)',
            'TEM_Line': [float(start[0]), float(start[1]),
                         float(end[0]), float(end[1])],
            'TEM_Line_Width': int(self.line_width_px),
            'TEM_Source_Sheet': self.sheet_name,
            'ExperimentalInfo': {'Technique': 'TEM',
                                 'Content': 'Line profile',
                                 'Source Sheet': self.sheet_name,
                                 'Line Width (px)': int(self.line_width_px)},
            'Background': {'Bkg Y': [float(v) for v in values],
                           'Bkg Type': '', 'Bkg Low': '', 'Bkg High': '',
                           'Bkg Offset Low': 0, 'Bkg Offset High': 0},
            'Fitting': {'Peaks': {}},
            'TEM_Profile_Smooth': int(self.peak_smooth.GetValue()),
            'TEM_Profile_Peaks': [],
            'TEM_Profile_Stats': None,
        }
        name = register_tem_profile_sheet(self.parent, name, profile_sheet)
        # From here the sheet is kept in step with the line: moving the line
        # rewrites this sheet rather than leaving a stale copy behind.
        self.profile_sheet_name = name
        self.on_detect_peaks(None, quiet=True)
        self._sync_spacing_button()
        self._persist()
        self.profile_status.SetLabel(f"Added '{name}' — the line now updates "
                                     f"it as you move it.")
        self._show_sheet(name)

    # -- FFT ---------------------------------------------------------------

    def _build_fft(self):
        panel = wx.Panel(self.notebook)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, 'Region FFT', bold=True), 0, wx.ALL, 8)
        sizer.Add(_label(panel,
                         'Draw a square or rectangle on a high-resolution\n'
                         'image, rotate it with the scroll wheel (drag the\n'
                         'round handle to rotate, corners to resize), then\n'
                         'compute the FFT to see the lattice in reciprocal\n'
                         'space.'),
                  0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        draw_btn = wx.Button(panel, label='Draw region on the image')
        draw_btn.Bind(wx.EVT_BUTTON, self.on_draw_roi)
        sizer.Add(draw_btn, 0, wx.EXPAND | wx.ALL, 8)

        self.square_check = wx.CheckBox(panel, label='Force square region')
        self.square_check.SetValue(True)
        sizer.Add(self.square_check, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.roi_text = _label(panel, 'No region yet.')
        sizer.Add(self.roi_text, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        fft_btn = wx.Button(panel, label='FFT  →  TEM~FFT sheet')
        fft_btn.SetBackgroundColour(BRAND_WX)
        fft_btn.Bind(wx.EVT_BUTTON, self.on_compute_fft)
        sizer.Add(fft_btn, 0, wx.EXPAND | wx.ALL, 8)

        clear_btn = wx.Button(panel, label='Clear region')
        clear_btn.Bind(wx.EVT_BUTTON, lambda e: self._clear_interaction(True))
        sizer.Add(clear_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.fft_status = _label(panel, '')
        sizer.Add(self.fft_status, 0, wx.ALL, 8)

        panel.SetSizer(sizer)
        return panel

    def on_draw_roi(self, event):
        self._show_sheet(self.sheet_name)
        self._clear_interaction()
        self._mode = 'roi'
        ax = self.parent.plot_manager.ax
        canvas = self.parent.plot_manager.canvas

        from libraries.ViewMenu.XYMapViewer import _make_grid_rotatable
        self._roi = _make_grid_rotatable(ax, self._on_roi_changed)
        self._cids = [canvas.mpl_connect('button_press_event',
                                         self._on_roi_seed)]
        self.roi_text.SetLabel('Click on the image to place the region…')

    def _on_roi_seed(self, event):
        ax = self.parent.plot_manager.ax
        if (self._roi is None or self._roi.active
                or event.inaxes is not ax or event.button != 1):
            return
        self._roi.start_selection(event)
        # The default 10x10 seed is in data units, which can be invisible on
        # a micrometre-wide field: rescale to a fifth of the visible width.
        x_lo, x_hi = ax.get_xlim()
        span = abs(x_hi - x_lo) * 0.2
        self._roi.width = span
        self._roi.height = span
        self._roi.draw_rectangle()
        self._on_roi_changed(self._roi.center, self._roi.width,
                             self._roi.height, self._roi.angle)

    def _on_roi_changed(self, center, width, height, angle):
        if self.square_check.GetValue() and self._roi is not None:
            side = max(width, height)
            if abs(width - height) > 1e-9:
                self._roi.width = side
                self._roi.height = side
                self._roi.draw_rectangle()
            width = height = side
        scale, unit = self._map_scale()
        w_px = width / scale
        h_px = height / scale
        self.roi_text.SetLabel(
            f'Region: {w_px:.0f} × {h_px:.0f} px at {angle:.0f}°')

    def on_compute_fft(self, event):
        if self._roi is None or not self._roi.active:
            wx.MessageBox('Draw a region on the image first.', 'TEM',
                          wx.OK | wx.ICON_INFORMATION)
            return
        sheet = self.sheet
        image = tem_array(sheet)
        if image is None:
            return

        scale, _ = self._map_scale()
        cx = self._roi.center[0] / scale
        cy = self._roi.center[1] / scale
        w_px = self._roi.width / scale
        h_px = self._roi.height / scale
        angle = float(self._roi.angle)
        if w_px < 8 or h_px < 8:
            wx.MessageBox('The region is too small for a meaningful FFT.',
                          'TEM', wx.OK | wx.ICON_WARNING)
            return

        wx.BeginBusyCursor()
        try:
            region = extract_rotated_region(image, (cx, cy), w_px, h_px, angle)
            power, recip = region_fft(region, sheet.get('TEM_NM_Per_Px'))
        finally:
            wx.EndBusyCursor()

        name, fft_sheet = make_tem_fft_sheet(
            'TEM~FFT', power, recip, self.sheet_name,
            roi=[float(cx), float(cy), float(w_px), float(h_px), angle])
        name = register_tem_sheet(self.parent, name, fft_sheet)
        self.fft_sheet_name = name
        self._clear_interaction(redraw=False)
        self._persist()
        calibration = f'{recip:.5g} 1/nm per px' if recip else 'uncalibrated'
        self.fft_status.SetLabel(
            f"Added '{name}' ({power.shape[1]} px, {calibration}).\n"
            f'Measure d-spacings in the Measure tab.')
        self._sync_fft_sheet()
        self._show_sheet(name)

    # -- Measure -----------------------------------------------------------

    def _build_measure(self):
        panel = wx.Panel(self.notebook)
        sizer = wx.BoxSizer(wx.VERTICAL)

        self.fft_target_text = _label(panel, '', bold=True)
        sizer.Add(self.fft_target_text, 0, wx.ALL, 8)

        # A diffraction pattern imported as an image comes in as a real-space
        # map; these let you tell the tool it is reciprocal space (so spots can
        # be measured) and give it a reciprocal calibration.
        diff_row = wx.BoxSizer(wx.HORIZONTAL)
        self.as_diffraction_btn = wx.Button(
            panel, label='Use image as diffraction pattern')
        self.as_diffraction_btn.SetToolTip(
            'Treat the image currently on screen as a diffraction pattern / FFT '
            '(reciprocal space) so its spots can be measured. Renaming a sheet '
            'to TEM~FFT does not do this — the image kind is a flag, not the '
            'name.')
        self.as_diffraction_btn.Bind(wx.EVT_BUTTON, self.on_use_as_diffraction)
        diff_row.Add(self.as_diffraction_btn, 1, wx.RIGHT, 4)
        recip_btn = wx.Button(panel, label='Reciprocal scale…')
        recip_btn.SetToolTip('Set the reciprocal calibration (1/nm per pixel) '
                             'so d-spacings read in nm instead of pixels.')
        recip_btn.Bind(wx.EVT_BUTTON, self.on_set_reciprocal_scale)
        diff_row.Add(recip_btn, 1)
        sizer.Add(diff_row, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        row1 = wx.BoxSizer(wx.HORIZONTAL)
        spot_btn = wx.Button(panel, label='Measure spot')
        spot_btn.SetToolTip('Click a diffraction spot on the FFT: '
                            'd-spacing and azimuth are read at the nearest peak')
        spot_btn.Bind(wx.EVT_BUTTON, self.on_measure_spot)
        row1.Add(spot_btn, 1, wx.RIGHT, 4)
        angle_btn = wx.Button(panel, label='Measure angle')
        angle_btn.SetToolTip('Click two spots: the angle between them at the '
                             'centre is reported')
        angle_btn.Bind(wx.EVT_BUTTON, self.on_measure_angle)
        row1.Add(angle_btn, 1)
        sizer.Add(row1, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        auto_btn = wx.Button(panel, label='Auto-detect all spots')
        auto_btn.SetBackgroundColour(BRAND_WX)
        auto_btn.Bind(wx.EVT_BUTTON, self.on_auto_detect)
        sizer.Add(auto_btn, 0, wx.EXPAND | wx.ALL, 8)

        self.measure_status = _label(panel, '')
        sizer.Add(self.measure_status, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.spot_grid = wx.ListCtrl(panel, style=wx.LC_REPORT | wx.LC_SINGLE_SEL,
                                     size=(-1, 150))
        self.spot_grid.InsertColumn(0, 'd (nm)', width=80)
        self.spot_grid.InsertColumn(1, 'g (1/nm)', width=80)
        self.spot_grid.InsertColumn(2, 'Angle (°)', width=80)
        self.spot_grid.InsertColumn(3, 'Spots', width=60)
        self.spot_grid.InsertColumn(4, 'hkl', width=80)
        self.spot_grid.SetToolTip('Select a row to highlight that d-spacing '
                                  'on the FFT.')
        self.spot_grid.Bind(wx.EVT_LIST_ITEM_SELECTED, self.on_spot_selected)
        sizer.Add(self.spot_grid, 1, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        row2 = wx.BoxSizer(wx.HORIZONTAL)
        ident_btn = wx.Button(panel, label='Identify structure / hkl')
        ident_btn.SetToolTip('Match the measured d-spacing ratios against the '
                             'standard lattice sequences, with no prior '
                             'assumption about the material.')
        ident_btn.Bind(wx.EVT_BUTTON, self.on_identify)
        row2.Add(ident_btn, 1, wx.RIGHT, 4)
        clear_btn = wx.Button(panel, label='Clear measurements')
        clear_btn.Bind(wx.EVT_BUTTON, self.on_clear_measurements)
        row2.Add(clear_btn, 1)
        sizer.Add(row2, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.TOP, 8)

        known_btn = wx.Button(panel, label='Index against a known lattice…')
        known_btn.SetToolTip('Enter a candidate structure and lattice '
                             'parameter; every measured spacing is matched to '
                             'an hkl with its percentage error.')
        known_btn.Bind(wx.EVT_BUTTON, self.on_index_known)
        sizer.Add(known_btn, 0, wx.EXPAND | wx.ALL, 8)

        self.structure_text = wx.TextCtrl(
            panel, style=wx.TE_MULTILINE | wx.TE_READONLY, size=(-1, 110))
        sizer.Add(self.structure_text, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        insert_row = wx.BoxSizer(wx.HORIZONTAL)
        insert_btn = wx.Button(panel, label='Insert FFT into TEM~Map')
        insert_btn.Bind(wx.EVT_BUTTON, self.on_insert_fft)
        insert_row.Add(insert_btn, 1, wx.RIGHT, 4)
        style_btn = wx.Button(panel, label='Inset options…')
        style_btn.SetToolTip('Contrast, scale bar, label size, border, '
                             'opacity, position and size of the inset.')
        style_btn.Bind(wx.EVT_BUTTON, self.on_inset_options)
        insert_row.Add(style_btn, 1)
        sizer.Add(insert_row, 0, wx.EXPAND | wx.ALL, 8)

        panel.SetSizer(sizer)
        return panel

    def on_spot_selected(self, event):
        """Highlight the picked row's spots on the FFT image."""
        sheet = self.fft_sheet
        if not sheet:
            return
        row = event.GetIndex()
        sheet['TEM_FFT_Selected'] = int(row)
        families = getattr(self, '_families', None)
        if families and 0 <= row < len(families):
            family = families[row]
            detail = (f"d = {family['d_nm']:.4g} nm" if family.get('d_nm')
                      else f"r = {family['g_px']:.0f} px")
            self.measure_status.SetLabel(
                f"{detail} — {family['count']} spot pair(s) highlighted at "
                f"{', '.join(f'{a:.0f}°' for a in family['angles'][:4])}.")
        self._redraw_main(self.fft_sheet_name, preserve_view=True)
        event.Skip()

    def on_index_known(self, event):
        """Match the measured spacings against a lattice the user names."""
        sheet = self._require_fft()
        if sheet is None:
            return
        spacings = self._measured_spacings()
        if not spacings:
            wx.MessageBox('Measure or auto-detect at least one calibrated '
                          'd-spacing first.', 'TEM', wx.OK | wx.ICON_INFORMATION)
            return

        dialog = _KnownLatticeDialog(self, spacings)
        if dialog.ShowModal() != wx.ID_OK:
            dialog.Destroy()
            return
        choice = dialog.result
        dialog.Destroy()
        if not choice:
            return

        rows, summary = hkl_table(spacings, choice['system'], choice['a_nm'],
                                  choice['c_nm'], choice['tolerance'])
        lines = [f"{choice['system']}, a = {choice['a_nm']:.4g} nm"
                 + (f", c = {choice['c_nm']:.4g} nm" if choice['c_nm'] else ''),
                 f"{summary['matched']}/{summary['total']} spacings matched "
                 f"within {choice['tolerance']:.3g} %"]
        if summary['rms_percent'] is not None:
            lines.append(f"RMS error {summary['rms_percent']:.2f} % — the "
                         f"spacings imply a = {summary['a_refined_nm']:.4g} nm")
        lines.append('')
        for row in rows:
            if row['hkl']:
                lines.append(f"  d = {row['d_nm']:.4g} nm  →  ({row['hkl']})  "
                             f"calc {row['d_calc_nm']:.4g} nm, "
                             f"{row['error_percent']:+.2f} %")
            else:
                lines.append(f"  d = {row['d_nm']:.4g} nm  →  no match")
        self.structure_text.SetValue('\n'.join(lines))

        self._apply_hkl({row['d_nm']: row['hkl'] for row in rows if row['hkl']})
        sheet['TEM_FFT_Structure'] = {
            'structure': choice['system'], 'a_nm': choice['a_nm'],
            'c_nm': choice['c_nm'], 'matched': summary['matched'],
            'total': summary['total'], 'source': 'user lattice',
            'rms_percent': summary['rms_percent'],
            'a_refined_nm': summary['a_refined_nm'],
            'assignments': [{'d_nm': r['d_nm'], 'hkl': r['hkl'],
                             'error_percent': r['error_percent']}
                            for r in rows],
        }
        self.measure_status.SetLabel(
            f"{summary['matched']}/{summary['total']} matched against "
            f"{choice['system']}.")
        self._refresh_spot_grid(getattr(self, '_families', None))
        self._show_sheet(self.fft_sheet_name)
        self._redraw_main(self.fft_sheet_name, preserve_view=True)
        self._persist()

    def _measured_spacings(self):
        """Distinct calibrated d-spacings on the FFT sheet, largest first."""
        families = getattr(self, '_families', None)
        if families:
            return [f['d_nm'] for f in families if f.get('d_nm')]
        return sorted({round(s['d_nm'], 5)
                       for s in (self.fft_sheet.get('TEM_FFT_Spots') or [])
                       if s.get('d_nm')}, reverse=True)

    def _apply_hkl(self, assigned):
        """Fold an hkl assignment into the families and the stored spots."""
        families = getattr(self, '_families', None)
        if families:
            for family in families:
                d = family.get('d_nm')
                family['hkl'] = _closest_label(assigned, d) if d else ''
        for spot in (self.fft_sheet.get('TEM_FFT_Spots') or []):
            d = spot.get('d_nm')
            if not d:
                continue
            hkl = _closest_label(assigned, d)
            if hkl:
                spot['hkl'] = hkl
                if spot.get('label'):
                    spot['label'] = f'{d:.3f} nm ({hkl})'

    def _require_fft(self):
        self._sync_fft_sheet()
        if not self.fft_sheet_name:
            wx.MessageBox('Create a TEM~FFT sheet first (FFT tab).', 'TEM',
                          wx.OK | wx.ICON_INFORMATION)
            return None
        return self.fft_sheet

    def _fft_click_to_spot(self, event):
        """Convert a click on the FFT into a refined spot dict, or None."""
        from libraries.ToolsMenu.TEM_Engine import _centroid_refine

        sheet = self.fft_sheet
        power = tem_array(sheet)
        extent, _ = tem_extent(sheet)
        if power is None or extent is None:
            return None
        scale = abs(extent[1] - extent[0]) / power.shape[1]
        # Data units -> pixel offsets from centre -> array indices.
        dx = event.xdata / scale
        dy = event.ydata / scale
        cx, cy = power.shape[1] // 2, power.shape[0] // 2
        x = int(round(cx + dx))
        y = int(round(cy + dy))
        if not (0 <= x < power.shape[1] and 0 <= y < power.shape[0]):
            return None

        # Snap to the brightest pixel nearby, then centroid-refine: nobody
        # clicks a 2-px-wide spot dead centre at screen scale.
        radius = 5
        y0, y1 = max(0, y - radius), min(power.shape[0], y + radius + 1)
        x0, x1 = max(0, x - radius), min(power.shape[1], x + radius + 1)
        patch = np.asarray(power[y0:y1, x0:x1])
        iy, ix = np.unravel_index(np.argmax(patch), patch.shape)
        ry, rx = _centroid_refine(np.asarray(power), y0 + iy, x0 + ix)

        odx, ody = rx - cx, ry - cy
        g_px = float(np.hypot(odx, ody))
        if g_px < 2:
            return None
        recip = sheet.get('TEM_RecipPerPx')
        g = g_px * recip if recip else None
        return {'x': float(odx), 'y': float(ody), 'g_px': g_px,
                'g': float(g) if g else None,
                'd_nm': float(1.0 / g) if g else None,
                'angle': float(np.degrees(np.arctan2(-ody, odx)))}

    def on_measure_spot(self, event):
        if self._require_fft() is None:
            return
        self._show_sheet(self.fft_sheet_name)
        self._clear_interaction(redraw=False)
        self._mode = 'measure'
        canvas = self.parent.plot_manager.canvas
        self._cids = [canvas.mpl_connect('button_press_event',
                                         self._on_measure_click)]
        self.measure_status.SetLabel('Click a diffraction spot on the FFT…')

    def _on_measure_click(self, event):
        ax = self.parent.plot_manager.ax
        # Button 1 only — a right-click belongs to the canvas context menu.
        if self._mode != 'measure' or event.inaxes is not ax or event.button != 1:
            return
        spot = self._fft_click_to_spot(event)
        if spot is None:
            return
        sheet = self.fft_sheet
        if spot.get('d_nm'):
            spot['label'] = f"{spot['d_nm']:.3f} nm"
            self.measure_status.SetLabel(
                f"d = {spot['d_nm']:.4g} nm   "
                f"(g = {spot['g']:.4g} 1/nm, {spot['angle']:.1f}°)\n"
                f"Click another spot, or switch tools.")
        else:
            spot['label'] = f"{spot['g_px']:.1f} px"
            self.measure_status.SetLabel(
                f"r = {spot['g_px']:.1f} px at {spot['angle']:.1f}° "
                f"(uncalibrated)")
        sheet.setdefault('TEM_FFT_Spots', []).append(spot)
        self._redraw_main(self.fft_sheet_name, preserve_view=True)
        self._refresh_spot_grid()
        self._persist()

    def on_measure_angle(self, event):
        if self._require_fft() is None:
            return
        self._show_sheet(self.fft_sheet_name)
        self._clear_interaction(redraw=False)
        self._mode = 'angle'
        self._angle_first = None
        canvas = self.parent.plot_manager.canvas
        self._cids = [canvas.mpl_connect('button_press_event',
                                         self._on_angle_click)]
        self.measure_status.SetLabel('Click the first spot…')

    def _on_angle_click(self, event):
        ax = self.parent.plot_manager.ax
        if self._mode != 'angle' or event.inaxes is not ax or event.button != 1:
            return
        spot = self._fft_click_to_spot(event)
        if spot is None:
            return
        if self._angle_first is None:
            self._angle_first = spot
            self.measure_status.SetLabel('Click the second spot…')
            return
        a = self._angle_first
        diff = abs(a['angle'] - spot['angle']) % 360.0
        if diff > 180.0:
            diff = 360.0 - diff
        d_a = f"{a['d_nm']:.3f} nm" if a.get('d_nm') else f"{a['g_px']:.0f} px"
        d_b = (f"{spot['d_nm']:.3f} nm" if spot.get('d_nm')
               else f"{spot['g_px']:.0f} px")
        self.measure_status.SetLabel(
            f'Angle between {d_a} and {d_b} spots: {diff:.2f}°')
        self._angle_first = None

    def on_auto_detect(self, event):
        sheet = self._require_fft()
        if sheet is None:
            return
        power = tem_array(sheet)
        recip = sheet.get('TEM_RecipPerPx')
        wx.BeginBusyCursor()
        try:
            spots = detect_spots(np.asarray(power), recip)
            pairs = pair_friedel_mates(spots)
            families = group_spot_families(pairs)
            # A computed FFT is centrosymmetric, so Friedel pairing cleans out
            # noise. An imported/acquired diffraction pattern often is not
            # perfectly centred, so pairing can reject every real spot — fall
            # back to the raw detections so they are not lost.
            if not families and spots:
                families = group_spot_families(spots)
        finally:
            wx.EndBusyCursor()

        if not families:
            self.measure_status.SetLabel(
                'No spots found — is this a lattice-resolution image?')
            return

        # One label per family (on its first member); markers on all. Each
        # spot records which family row it belongs to, so selecting a row in
        # the table can light up exactly that ring.
        stored = []
        for index, family in enumerate(families):
            for i, member in enumerate(family['members']):
                entry = {k: member[k] for k in
                         ('x', 'y', 'g_px', 'g', 'd_nm', 'angle')
                         if k in member}
                entry['family'] = index
                if i == 0:
                    entry['label'] = (f"{family['d_nm']:.3f} nm"
                                      if family.get('d_nm')
                                      else f"{family['g_px']:.0f} px")
                stored.append(entry)
                # The Friedel mate gets a marker too.
                mate = dict(entry)
                mate.pop('label', None)
                mate['x'] = -entry['x']
                mate['y'] = -entry['y']
                stored.append(mate)
        sheet['TEM_FFT_Spots'] = stored
        sheet['TEM_FFT_Selected'] = None
        self._families = families
        self.measure_status.SetLabel(
            f"{len(families)} d-spacing families from "
            f"{sum(f['count'] for f in families)} spot pairs.")
        self._refresh_spot_grid(families)
        self._show_sheet(self.fft_sheet_name)
        self._redraw_main(self.fft_sheet_name, preserve_view=True)
        self._persist()

    def _refresh_spot_grid(self, families=None):
        self.spot_grid.DeleteAllItems()
        if families is None:
            # Manual measurements: list the sheet's spots individually.
            for spot in (self.fft_sheet.get('TEM_FFT_Spots') or []):
                if 'label' not in spot:
                    continue
                row = self.spot_grid.InsertItem(
                    self.spot_grid.GetItemCount(),
                    f"{spot['d_nm']:.4g}" if spot.get('d_nm') else '—')
                self.spot_grid.SetItem(row, 1, f"{spot['g']:.4g}"
                                       if spot.get('g') else '—')
                self.spot_grid.SetItem(row, 2, f"{spot.get('angle', 0):.1f}")
                self.spot_grid.SetItem(row, 3, '1')
                self.spot_grid.SetItem(row, 4, str(spot.get('hkl', '')))
            return
        for family in families:
            row = self.spot_grid.InsertItem(
                self.spot_grid.GetItemCount(),
                f"{family['d_nm']:.4g}" if family.get('d_nm') else '—')
            self.spot_grid.SetItem(row, 1, f"{family['g']:.4g}"
                                   if family.get('g') else '—')
            angles = ', '.join(f'{a:.0f}' for a in family['angles'][:3])
            self.spot_grid.SetItem(row, 2, angles)
            self.spot_grid.SetItem(row, 3, str(family['count']))
            self.spot_grid.SetItem(row, 4, str(family.get('hkl', '')))

    def on_identify(self, event):
        sheet = self._require_fft()
        if sheet is None:
            return
        families = getattr(self, '_families', None)
        if not families:
            # Fall back to the manually measured spots.
            ds = sorted({round(s['d_nm'], 4)
                         for s in (sheet.get('TEM_FFT_Spots') or [])
                         if s.get('d_nm')}, reverse=True)
        else:
            ds = [f['d_nm'] for f in families if f.get('d_nm')]
        if len(ds) < 2:
            wx.MessageBox('At least two calibrated d-spacings are needed —\n'
                          'run the auto-detection or measure more spots.',
                          'TEM', wx.OK | wx.ICON_INFORMATION)
            return

        candidates = identify_structure(ds)
        if not candidates:
            self.structure_text.SetValue('No structure matched.')
            return

        lines = []
        best = candidates[0]
        for cand in candidates[:3]:
            a_note = (f"a = {cand['a_nm']:.4g} nm "
                      f"(spread {cand['a_spread'] * 100:.1f}%)")
            lines.append(f"{cand['structure']}: {cand['matched']}/{cand['total']} "
                         f"spacings matched, {a_note}")
        lines.append('')
        lines.append('Best match assignments:')
        for assignment in best['assignments']:
            hkl = assignment['hkl'] or 'unmatched'
            lines.append(f"  d = {assignment['d_nm']:.4g} nm  →  ({hkl})")
        self.structure_text.SetValue('\n'.join(lines))

        # Fold the hkl into the family labels and the stored spots.
        assigned = {round(a['d_nm'], 6): a['hkl']
                    for a in best['assignments'] if a['hkl']}
        if families:
            for family in families:
                if family.get('d_nm'):
                    family['hkl'] = assigned.get(round(family['d_nm'], 6), '')
        for spot in (sheet.get('TEM_FFT_Spots') or []):
            d = spot.get('d_nm')
            if not d:
                continue
            hkl = None
            for d_ref, label in assigned.items():
                if abs(d - d_ref) <= 0.03 * d_ref:
                    hkl = label
                    break
            if hkl:
                spot['hkl'] = hkl
                if spot.get('label'):
                    spot['label'] = f"{d:.3f} nm ({hkl})"

        sheet['TEM_FFT_Structure'] = {
            'structure': best['structure'], 'a_nm': best['a_nm'],
            'a_spread': best['a_spread'], 'matched': best['matched'],
            'total': best['total'],
            'assignments': [dict(a) for a in best['assignments']],
        }
        self._refresh_spot_grid(families)
        self._show_sheet(self.fft_sheet_name)
        self._redraw_main(self.fft_sheet_name, preserve_view=True)
        self._persist()
        self.refresh_advanced_choices()
        self.measure_status.SetLabel(
            f"Best match: {best['structure']}, a = {best['a_nm']:.4g} nm")

    def on_clear_measurements(self, event):
        sheet = self._require_fft()
        if sheet is None:
            return
        sheet['TEM_FFT_Spots'] = []
        sheet['TEM_FFT_Structure'] = None
        self._families = None
        self.spot_grid.DeleteAllItems()
        self.structure_text.SetValue('')
        self.measure_status.SetLabel('Measurements cleared.')
        self._redraw_main(self.fft_sheet_name, preserve_view=True)
        self._persist()

    # -- FFT inset on the map ---------------------------------------------

    def _inset_style(self):
        """The inset's appearance settings, defaulted and stored on the sheet."""
        style = dict(INSET_DEFAULTS)
        style.update(self.fft_sheet.get('TEM_Inset_Style') or {})
        return style

    def _fft_png(self, style=None, dpi=150):
        """Render the FFT sheet (with spots, labels and scale bar) to PNG.

        The contrast, label size, scale bar and border come from the sheet's
        inset style rather than from the main canvas, because an inset a
        third the width of the micrograph needs harder contrast and larger
        labels than the same image shown full size.
        """
        import io
        from matplotlib.backends.backend_agg import FigureCanvasAgg
        from matplotlib.figure import Figure

        from libraries.ToolsMenu.TEM_Plot import (draw_fft_annotations,
                                                  draw_scale_bar)

        style = style or self._inset_style()
        sheet = self.fft_sheet
        power = tem_array(sheet)
        extent, _ = tem_extent(sheet)
        figure = Figure(figsize=(4.0, 4.0), dpi=dpi)
        FigureCanvasAgg(figure)
        ax = figure.add_axes([0, 0, 1, 1])
        shown = display_fft(np.asarray(power), gamma=float(style['gamma']))
        # Clip the display range as a percentile pair: the transmitted beam
        # is orders of magnitude above the spots, so a fixed 0..1 stretch
        # leaves everything worth seeing in the bottom few percent.
        lo, hi = np.percentile(shown, [float(style['clip_low']),
                                       float(style['clip_high'])])
        ax.imshow(shown, cmap='gray', aspect='equal', origin='upper',
                  extent=extent, interpolation='nearest',
                  vmin=lo, vmax=max(hi, lo + 1e-6))
        ax.set_xticks([])
        ax.set_yticks([])
        for spine in ax.spines.values():
            spine.set_visible(bool(style['border']))
            spine.set_color(style.get('border_colour', 'white'))
            spine.set_linewidth(float(style.get('border_width', 1.5)))
        draw_fft_annotations(ax, sheet, fontsize=float(style['label_size']))
        if style['scale_bar']:
            draw_scale_bar(ax, sheet, fontsize=float(style['label_size']))
        buffer = io.BytesIO()
        figure.savefig(buffer, format='png', dpi=dpi, transparent=True)
        return buffer.getvalue()

    def _inset_entry(self):
        """The Labels entry of the FFT already inserted on the map, if any."""
        for entry in (self.sheet.get('Labels') or []):
            if (entry.get('type') == 'image'
                    and entry.get('text') == self.fft_sheet_name):
                return entry
        return None

    def on_insert_fft(self, event):
        """Place the FFT on the TEM~Map as a Labels-Manager image overlay."""
        if self._require_fft() is None:
            return
        style = self._inset_style()
        png_bytes = self._fft_png(style)

        existing = self._inset_entry()
        if existing is not None:
            # Re-rendering in place: the user has already positioned this
            # inset, and replacing it with a fresh one would move it back.
            from libraries.ViewMenu.Label_Images import PAYLOAD_KEY
            existing[PAYLOAD_KEY] = png_bytes
            existing['alpha'] = float(style['opacity'])
            self._show_sheet(self.sheet_name)
            self._redraw_main(preserve_view=True)
            self._persist()
            self.measure_status.SetLabel(
                f'{self.fft_sheet_name} inset redrawn in place.')
            return

        from libraries.ViewMenu.Labels_Screen import LabelWindow
        manager = getattr(self.parent, 'labels_window', None)
        if not manager:
            manager = LabelWindow(self.parent)
            self.parent.labels_window = manager
        manager.Show()
        manager.Raise()
        entry = manager.add_image_from_bytes(
            self.sheet_name, self.fft_sheet_name, png_bytes,
            x=float(style['x']), y=float(style['y']),
            width=float(style['width']))
        if entry is not None:
            entry['alpha'] = float(style['opacity'])
        self._show_sheet(self.sheet_name)
        self._redraw_main(preserve_view=True)
        self._persist()
        self.measure_status.SetLabel(
            f'{self.fft_sheet_name} placed on {self.sheet_name} — drag it on '
            f'the plot, or use Inset options… for exact numbers.')
        self.Raise()

    def on_inset_options(self, event):
        """Contrast, scale bar, label size, border, opacity and placement."""
        if self._require_fft() is None:
            return
        dialog = _InsetStyleDialog(self, self._inset_style())
        if dialog.ShowModal() == wx.ID_OK:
            style = dialog.result
            self.fft_sheet['TEM_Inset_Style'] = style
            entry = self._inset_entry()
            if entry is not None:
                from libraries.ViewMenu.Label_Images import (PAYLOAD_KEY,
                                                             aspect_height,
                                                             png_size)
                entry[PAYLOAD_KEY] = self._fft_png(style)
                entry['x'] = float(style['x'])
                entry['y'] = float(style['y'])
                entry['w'] = float(style['width'])
                entry['h'] = max(0.02, min(0.95, aspect_height(
                    self.parent.plot_manager.ax, entry['w'],
                    png_size(entry[PAYLOAD_KEY]))))
                entry['alpha'] = float(style['opacity'])
                self._show_sheet(self.sheet_name)
                self._redraw_main(preserve_view=True)
                self.measure_status.SetLabel('Inset updated.')
            else:
                self.measure_status.SetLabel(
                    'Saved — press "Insert FFT into TEM~Map" to place it.')
            self._persist()
        dialog.Destroy()

    # -- window plumbing ---------------------------------------------------

    def on_page_changed(self, event):
        # Resolve the page by its section key, not a fixed index — a
        # single-section window has only one page.
        page = event.GetSelection()
        key = (self._section_keys[page] if 0 <= page < len(self._section_keys)
               else None)
        if key == 'calibrate':
            self._refresh_calibration()
            self._load_adjust_from_sheet()
        elif key == 'particles':
            self._fill_particle_results()
            self._refresh_roi_status()
        elif key == 'profile':
            self._sync_spacing_button()
        elif key in ('filter', 'measure', 'advanced'):
            self._sync_fft_sheet()
        event.Skip()

    def _sync_spacing_button(self):
        """Reflect whether spacing labels are currently baked into the plot."""
        if not getattr(self, 'spacing_label_btn', None):
            return
        sheet = self._profile_sheet()
        baked = bool(sheet and sheet.get('TEM_Spacing_Baked'))
        self.spacing_label_btn.SetLabel('Remove spacing labels' if baked
                                        else 'Spacing labels → editable text')

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

    def _release_other_windows(self):
        """Clear any canvas interaction armed by the *other* TEM windows.

        With independent section windows several can be open at once, but they
        all drive the one main canvas, so only one interaction may be armed.
        Arming here first disarms the rest.
        """
        for other in list(getattr(self.parent, '_tem_windows', [])):
            if other is self:
                continue
            try:
                if other._mode is not None or other._cids:
                    other._clear_interaction(cascade=False)
            except Exception:
                pass

    def _clear_interaction(self, redraw=False, cascade=True):
        """Tear down whichever interactive tool is live on the main canvas."""
        if cascade:
            self._release_other_windows()
        self._disconnect_cids()
        self._mode = None
        self._line_start = None
        self._line_grab = None
        self._angle_first = None
        self._peak_grab = None
        self._polygon_points = []
        self._clear_preview()
        self._clear_particle_selector()
        if self._roi is not None:
            try:
                self._roi.disconnect()
            except Exception:
                pass
            try:
                self._roi.clear()
            except Exception:
                pass
            self._roi = None
        if redraw:
            try:
                self._redraw_main(preserve_view=True)
            except Exception:
                pass

    def on_close(self, event):
        self._clear_interaction(cascade=False)
        if getattr(self.parent, 'tem_analysis_window', None) is self:
            self.parent.tem_analysis_window = None
        try:
            windows = getattr(self.parent, '_tem_windows', None)
            if windows and self in windows:
                windows.remove(self)
        except Exception:
            pass
        self.Destroy()


class _ReciprocalScaleDialog(wx.Dialog):
    """Set an FFT / diffraction pattern's reciprocal calibration (1/nm per px).

    Two ways in: the value directly, or a known reflection — a spot measured at
    ``g`` pixels from the centre whose real-space spacing ``d`` you know, from
    which the scale is 1/(d·g).
    """

    def __init__(self, parent, current):
        super().__init__(parent, title='Reciprocal scale', size=(340, 300))
        self.result = None
        panel = wx.Panel(self)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, 'Reciprocal pixel size', bold=True), 0, wx.ALL, 8)
        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(_label(panel, '1/nm per pixel:'), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.direct = wx.TextCtrl(panel, value=(f'{current:.6g}' if current
                                                else ''))
        row.Add(self.direct, 1)
        sizer.Add(row, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        sizer.Add(wx.StaticLine(panel), 0, wx.EXPAND | wx.ALL, 8)
        sizer.Add(_label(panel, 'or from a known reflection', bold=True),
                  0, wx.LEFT | wx.RIGHT, 8)
        grid = wx.FlexGridSizer(2, 2, 6, 6)
        grid.Add(_label(panel, 'Spot distance g (px):'), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.g_px = wx.TextCtrl(panel)
        self.g_px.SetToolTip('The radius of a known spot from the centre, in '
                             'pixels — read it with "Measure spot".')
        grid.Add(self.g_px, 1, wx.EXPAND)
        grid.Add(_label(panel, 'its d-spacing (nm):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.d_nm = wx.TextCtrl(panel)
        grid.Add(self.d_nm, 1, wx.EXPAND)
        grid.AddGrowableCol(1, 1)
        sizer.Add(grid, 0, wx.EXPAND | wx.ALL, 8)

        buttons = wx.StdDialogButtonSizer()
        ok = wx.Button(panel, wx.ID_OK); ok.SetDefault()
        buttons.AddButton(ok)
        buttons.AddButton(wx.Button(panel, wx.ID_CANCEL))
        buttons.Realize()
        sizer.Add(buttons, 0, wx.ALIGN_RIGHT | wx.ALL, 8)
        panel.SetSizer(sizer)
        ok.Bind(wx.EVT_BUTTON, self.on_ok)
        self.CentreOnParent()

    def on_ok(self, event):
        def _f(ctrl):
            try:
                return float(ctrl.GetValue())
            except ValueError:
                return None
        direct = _f(self.direct)
        if direct and direct > 0:
            self.result = direct
            self.EndModal(wx.ID_OK)
            return
        g, d = _f(self.g_px), _f(self.d_nm)
        if g and d and g > 0 and d > 0:
            self.result = 1.0 / (d * g)     # g_px * recip = 1/d
            self.EndModal(wx.ID_OK)
            return
        wx.MessageBox('Enter the 1/nm per pixel directly, or a spot distance '
                      'in pixels and its known d-spacing.', 'Reciprocal scale',
                      wx.OK | wx.ICON_WARNING)


class _KnownLatticeDialog(wx.Dialog):
    """Ask for a candidate structure and lattice parameter.

    The measured spacings are shown alongside so the answer can be sanity
    checked before it is entered — a first guess at ``a`` is offered from the
    largest spacing on the assumption it is the first allowed reflection,
    which is right often enough to save the arithmetic.
    """

    def __init__(self, parent, spacings):
        super().__init__(parent, title='Index against a known lattice',
                         size=(360, 340))
        self.result = None
        panel = wx.Panel(self)
        sizer = wx.BoxSizer(wx.VERTICAL)

        listing = ', '.join(f'{d:.4g}' for d in sorted(spacings, reverse=True)[:6])
        sizer.Add(_label(panel, f'Measured d (nm): {listing}'), 0, wx.ALL, 8)

        grid = wx.FlexGridSizer(4, 2, 6, 6)
        grid.Add(_label(panel, 'Structure:'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.system = wx.Choice(panel, choices=list(LATTICE_SYSTEMS))
        self.system.SetSelection(0)
        self.system.Bind(wx.EVT_CHOICE, lambda e: self._sync_c())
        grid.Add(self.system, 1, wx.EXPAND)

        grid.Add(_label(panel, 'a (nm):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.a_ctrl = wx.TextCtrl(panel, value=f'{max(spacings) * 1.7:.4g}'
                                  if spacings else '0.4')
        grid.Add(self.a_ctrl, 1, wx.EXPAND)

        grid.Add(_label(panel, 'c (nm):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.c_ctrl = wx.TextCtrl(panel, value='')
        grid.Add(self.c_ctrl, 1, wx.EXPAND)

        grid.Add(_label(panel, 'Tolerance (%):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.tolerance = wx.SpinCtrlDouble(panel, min=0.1, max=25.0, inc=0.5,
                                           initial=5.0)
        self.tolerance.SetDigits(1)
        grid.Add(self.tolerance)
        grid.AddGrowableCol(1, 1)
        sizer.Add(grid, 0, wx.EXPAND | wx.ALL, 8)

        sizer.Add(_label(panel,
                         'A spacing further than the tolerance from every\n'
                         'allowed reflection is reported as unmatched rather\n'
                         'than forced onto the nearest one.'),
                  0, wx.ALL, 8)

        buttons = wx.StdDialogButtonSizer()
        ok = wx.Button(panel, wx.ID_OK, 'Match')
        ok.SetDefault()
        buttons.AddButton(ok)
        buttons.AddButton(wx.Button(panel, wx.ID_CANCEL))
        buttons.Realize()
        sizer.Add(buttons, 0, wx.ALIGN_RIGHT | wx.ALL, 8)
        panel.SetSizer(sizer)

        ok.Bind(wx.EVT_BUTTON, self.on_ok)
        self._sync_c()
        self.CentreOnParent()

    def _sync_c(self):
        needs_c = system_needs_c(LATTICE_SYSTEMS[self.system.GetSelection()])
        self.c_ctrl.Enable(needs_c)
        if needs_c and not self.c_ctrl.GetValue().strip():
            try:
                self.c_ctrl.SetValue(f'{float(self.a_ctrl.GetValue()) * 1.633:.4g}')
            except ValueError:
                pass

    def on_ok(self, event):
        system = LATTICE_SYSTEMS[self.system.GetSelection()]
        try:
            a_nm = float(self.a_ctrl.GetValue())
        except ValueError:
            wx.MessageBox('Enter the lattice parameter a in nanometres.',
                          'Index', wx.OK | wx.ICON_WARNING)
            return
        if a_nm <= 0:
            wx.MessageBox('The lattice parameter must be positive.', 'Index',
                          wx.OK | wx.ICON_WARNING)
            return
        c_nm = None
        if system_needs_c(system):
            try:
                c_nm = float(self.c_ctrl.GetValue())
            except ValueError:
                c_nm = None
            if not c_nm or c_nm <= 0:
                wx.MessageBox(f'{system} needs a c axis as well as a.',
                              'Index', wx.OK | wx.ICON_WARNING)
                return
        self.result = {'system': system, 'a_nm': a_nm, 'c_nm': c_nm,
                       'tolerance': float(self.tolerance.GetValue())}
        self.EndModal(wx.ID_OK)


class _InsetStyleDialog(wx.Dialog):
    """How the FFT inset is drawn and where it sits on the micrograph."""

    def __init__(self, parent, style):
        super().__init__(parent, title='FFT inset options', size=(360, 470))
        self.result = None
        panel = wx.Panel(self)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, 'Contrast', bold=True), 0, wx.ALL, 8)
        grid = wx.FlexGridSizer(3, 2, 6, 6)

        def _spin(label, value, lo, hi, inc, digits, tip=''):
            grid.Add(_label(panel, label), 0, wx.ALIGN_CENTER_VERTICAL)
            ctrl = wx.SpinCtrlDouble(panel, min=lo, max=hi, inc=inc,
                                     initial=float(value))
            ctrl.SetDigits(digits)
            if tip:
                ctrl.SetToolTip(tip)
            grid.Add(ctrl)
            return ctrl

        self.gamma = _spin('Stretch (γ):', style['gamma'], 0.1, 2.0, 0.05, 2,
                           'Below 1 lifts the weak high-order spots.')
        self.clip_low = _spin('Black point (%):', style['clip_low'],
                              0.0, 40.0, 0.5, 1)
        self.clip_high = _spin('White point (%):', style['clip_high'],
                               60.0, 100.0, 0.1, 1)
        sizer.Add(grid, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        sizer.Add(_label(panel, 'Annotation', bold=True), 0, wx.ALL, 8)
        grid2 = wx.FlexGridSizer(2, 2, 6, 6)
        grid2.Add(_label(panel, 'Label size (pt):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.label_size = wx.SpinCtrlDouble(panel, min=4.0, max=36.0, inc=0.5,
                                            initial=float(style['label_size']))
        self.label_size.SetDigits(1)
        grid2.Add(self.label_size)
        grid2.Add(_label(panel, 'Border width:'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.border_width = wx.SpinCtrlDouble(
            panel, min=0.5, max=6.0, inc=0.5,
            initial=float(style.get('border_width', 1.5)))
        self.border_width.SetDigits(1)
        grid2.Add(self.border_width)
        sizer.Add(grid2, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.scale_bar = wx.CheckBox(panel, label='Show the 1/nm scale bar')
        self.scale_bar.SetValue(bool(style['scale_bar']))
        sizer.Add(self.scale_bar, 0, wx.LEFT | wx.RIGHT, 8)
        self.border = wx.CheckBox(panel, label='Show a border')
        self.border.SetValue(bool(style['border']))
        sizer.Add(self.border, 0, wx.ALL, 8)

        sizer.Add(_label(panel, 'Placement on the image', bold=True),
                  0, wx.LEFT | wx.RIGHT, 8)
        sizer.Add(_label(panel, 'Axes fractions — the inset can also be '
                                'dragged\nand resized directly on the plot.'),
                  0, wx.ALL, 8)
        grid3 = wx.FlexGridSizer(4, 2, 6, 6)
        for name, caption, lo, hi in (('x', 'X (0–1):', 0.0, 1.0),
                                      ('y', 'Y (0–1):', 0.0, 1.0),
                                      ('width', 'Width (0–1):', 0.05, 1.0),
                                      ('opacity', 'Opacity (0–1):', 0.05, 1.0)):
            grid3.Add(_label(panel, caption), 0, wx.ALIGN_CENTER_VERTICAL)
            ctrl = wx.SpinCtrlDouble(panel, min=lo, max=hi, inc=0.01,
                                     initial=float(style[name]))
            ctrl.SetDigits(2)
            grid3.Add(ctrl)
            setattr(self, name, ctrl)
        sizer.Add(grid3, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        buttons = wx.StdDialogButtonSizer()
        ok = wx.Button(panel, wx.ID_OK, 'Apply')
        ok.SetDefault()
        buttons.AddButton(ok)
        buttons.AddButton(wx.Button(panel, wx.ID_CANCEL))
        buttons.Realize()
        sizer.Add(buttons, 0, wx.ALIGN_RIGHT | wx.ALL, 8)
        panel.SetSizer(sizer)

        ok.Bind(wx.EVT_BUTTON, self.on_ok)
        self.CentreOnParent()

    def on_ok(self, event):
        low, high = self.clip_low.GetValue(), self.clip_high.GetValue()
        if low >= high:
            wx.MessageBox('The black point must be below the white point.',
                          'FFT inset', wx.OK | wx.ICON_WARNING)
            return
        self.result = {
            'gamma': float(self.gamma.GetValue()),
            'clip_low': float(low), 'clip_high': float(high),
            'label_size': float(self.label_size.GetValue()),
            'scale_bar': bool(self.scale_bar.GetValue()),
            'border': bool(self.border.GetValue()),
            'border_colour': 'white',
            'border_width': float(self.border_width.GetValue()),
            'opacity': float(self.opacity.GetValue()),
            'x': float(self.x.GetValue()), 'y': float(self.y.GetValue()),
            'width': float(self.width.GetValue()),
        }
        self.EndModal(wx.ID_OK)


def register_tem_profile_sheet(window, sheet_name, sheet):
    """Insert a TEM~Plot profile sheet, deduplicating the name."""
    if 'Core levels' not in window.Data:
        window.Data['Core levels'] = {}
    base = sheet_name
    counter = 2
    while sheet_name in window.Data['Core levels']:
        sheet_name = f'{base}{counter}'
        counter += 1
    sheet['Name'] = sheet_name
    window.Data['Core levels'][sheet_name] = sheet
    window.Data['Number of Core levels'] = len(window.Data['Core levels'])
    try:
        if sheet_name not in list(window.sheet_combobox.GetStrings()):
            window.sheet_combobox.Append(sheet_name)
    except Exception:
        pass
    return sheet_name


def open_tem_window(window, sheet_name=None):
    """Open (or raise) the TEM analysis window for the selected sheet."""
    if sheet_name is None:
        sheet_name = window.sheet_combobox.GetValue()
    levels = window.Data.get('Core levels', {})
    sheet = levels.get(sheet_name, {})

    # An FFT sheet or a scalar map (d-spacing / strain) is not a micrograph you
    # draw on: bind the window to the map it came from so every tab works, and
    # let the Measure tab find the FFT again. A real-space map — imported OR
    # derived (a Bragg-filtered or PCA-denoised image) — is a proper map in its
    # own right, so it is analysed as itself; you can FFT or profile the derived
    # image rather than being redirected to its parent.
    if not (isinstance(sheet, dict) and sheet.get('_tem')
            and sheet.get('_tem_kind', 'map') == 'map'):
        source = (sheet.get('TEM_FFT_Source') if is_tem_fft(sheet)
                  else sheet.get('TEM_Derived_From'))
        if source in levels:
            sheet_name = source
            sheet = levels[sheet_name]

    if not (isinstance(sheet, dict) and sheet.get('_tem')):
        tem_maps = [n for n, s in levels.items()
                    if isinstance(s, dict) and s.get('_tem')
                    and s.get('_tem_kind', 'map') == 'map']
        if not tem_maps:
            wx.MessageBox('No TEM image is open.\n\n'
                          'Use File > Import > TEM Image to load one.',
                          'TEM Analysis', wx.OK | wx.ICON_INFORMATION)
            return None
        sheet_name = tem_maps[0]
        window.sheet_combobox.SetStringSelection(sheet_name)
        plot_tem_image(window, sheet_name)

    existing = getattr(window, 'tem_analysis_window', None)
    if existing:
        try:
            if existing.sheet_name == sheet_name:
                existing.Raise()
                return existing
            existing.Close()
        except Exception:
            pass

    frame = TEMAnalysisWindow(window, sheet_name)
    window.tem_analysis_window = frame
    frame.Show()
    return frame


def _resolve_tem_map(window, sheet_name=None):
    """The TEM map sheet a section window should bind to, or None."""
    if sheet_name is None:
        sheet_name = window.sheet_combobox.GetValue()
    levels = window.Data.get('Core levels', {})
    sheet = levels.get(sheet_name, {})
    # A real-space map, imported or derived (Bragg-filtered / PCA-denoised), is
    # analysed as itself — so a section drawn on the denoised image acts on it,
    # not on its parent. Only an FFT or scalar sheet falls back to its source.
    if isinstance(sheet, dict) and sheet.get('_tem') \
            and sheet.get('_tem_kind', 'map') == 'map':
        return sheet_name
    source = (sheet.get('TEM_FFT_Source') if is_tem_fft(sheet)
              else (sheet.get('TEM_Derived_From')
                    or sheet.get('TEM_Source_Sheet')))
    if source in levels and levels[source].get('_tem_kind', 'map') == 'map':
        return source
    tem_maps = [n for n, s in levels.items()
                if isinstance(s, dict) and s.get('_tem')
                and s.get('_tem_kind', 'map') == 'map']
    return tem_maps[0] if tem_maps else None


# Sections that operate on a diffractogram, so they may bind to an FFT sheet
# directly rather than being redirected to the source micrograph: Measure and
# Filter read the FFT, Denoise can clean either, and Calibrate carries the
# brightness/contrast controls, which apply to an FFT as much as to a map.
_FFT_CAPABLE_SECTIONS = {'calibrate', 'measure', 'filter', 'denoise'}


def _resolve_image_sheet(window, sheet_name=None):
    """The sheet an FFT-capable section should bind to.

    Measure, Filter and Denoise work on an FFT as well as a map. So a real-space
    map *or* an FFT (including a picture named TEM~FFT, promoted on the way in)
    that is the active sheet is used as itself; anything else falls back to the
    group's source map.
    """
    if sheet_name is None:
        sheet_name = window.sheet_combobox.GetValue()
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    promote_named_fft(sheet, sheet_name)
    if isinstance(sheet, dict) and sheet.get('_tem') \
            and sheet.get('_tem_kind', 'map') in ('map', 'fft'):
        return sheet_name
    return _resolve_tem_map(window, sheet_name)


def open_tem_section(window, key):
    """Open one TEM section (Calibrate, FFT, …) as its own window.

    Independent of the main TEM window and of the other section windows, so
    several can sit open side by side; they all read and write the same
    sheets, and arming a canvas tool in one disarms the rest.
    """
    sheet_name = (_resolve_image_sheet(window) if key in _FFT_CAPABLE_SECTIONS
                  else _resolve_tem_map(window))
    if sheet_name is None:
        wx.MessageBox('No TEM image is open.\n\nUse File > Import > TEM Image '
                      'to load one.', 'TEM Analysis', wx.OK | wx.ICON_INFORMATION)
        return None
    # Raise an existing section window of the same kind for the same map.
    for existing in list(getattr(window, '_tem_windows', [])):
        try:
            if (getattr(existing, '_section_keys', None) == [key]
                    and existing.sheet_name == sheet_name):
                existing.Raise()
                return existing
        except Exception:
            pass
    frame = TEMAnalysisWindow(window, sheet_name, sections=[key])
    frame.Show()
    return frame
