# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/TEM_Denoise.py. Regenerate with tools/export_khervetech.py.
"""
PCA denoising for the TEM Analysis window.

A single ``Denoise`` tab, added as a mixin on ``TEMAnalysisWindow`` — it shares
the same sheet accessors, canvas plumbing and ROI drawing as the FFT/Filter
tabs, so it slots in beside them rather than opening a second window.

The image (or a rectangle drawn on it) is turned into an observations-by-
features matrix, PCA is fitted, and the image is rebuilt from only the leading
components — the small components hold the variance uncorrelated between
observations, i.e. the noise. Two ways to build the matrix (see
``TEM_Engine``):

    Line-wise    each row or column is an observation. Best where the
                 structure repeats along one axis (lattice fringes).
    Patch-based  small overlapping tiles are the observations, averaged back
                 into place. The stronger, general-purpose image denoiser.

Nothing here modifies the source image: the denoised result is always a new
``TEM~Map`` sheet (``TEM_Derived_From`` set), so the original and the cleaned
copy sit side by side and both survive a save/reload.
"""

import numpy as np
import wx

from libraries.FileMenu.TEM_Import import (is_tem_fft, make_tem_filtered_sheet,
                                           register_tem_sheet, tem_array)
from libraries.ToolsMenu.TEM_Engine import (extract_rotated_region,
                                            pca_denoise_lines,
                                            pca_denoise_patches,
                                            pca_variance_ratio)

BRAND_WX = wx.Colour(79, 190, 159)


def _dlabel(parent, text, bold=False):
    ctrl = wx.StaticText(parent, label=text)
    if bold:
        font = ctrl.GetFont()
        font.SetWeight(wx.FONTWEIGHT_BOLD)
        ctrl.SetFont(font)
    return ctrl


class DenoiseTabMixin:
    """The Denoise tab and its handlers. Mixed into ``TEMAnalysisWindow``."""

    # -- tab -----------------------------------------------------------------

    def _build_denoise(self):
        panel = wx.Panel(self.notebook)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_dlabel(panel, 'PCA denoise', bold=True), 0, wx.ALL, 8)
        sizer.Add(_dlabel(panel,
                          'Rebuild the image from only its leading principal\n'
                          'components. The dropped components carry the noise,\n'
                          'so the result is a cleaned copy on a new sheet.'),
                  0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.denoise_mode = wx.RadioBox(
            panel, label='Method',
            choices=['Line-wise', 'Patch-based (local PCA)'],
            majorDimension=1, style=wx.RA_SPECIFY_COLS)
        self.denoise_mode.SetSelection(1)
        self.denoise_mode.Bind(wx.EVT_RADIOBOX, self._on_denoise_mode)
        sizer.Add(self.denoise_mode, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        # -- region --------------------------------------------------------
        self.denoise_whole = wx.CheckBox(panel, label='Whole image')
        self.denoise_whole.SetValue(True)
        self.denoise_whole.Bind(wx.EVT_CHECKBOX, self._on_denoise_whole)
        sizer.Add(self.denoise_whole, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.denoise_roi_btn = wx.Button(panel, label='Draw region on the image')
        self.denoise_roi_btn.Bind(wx.EVT_BUTTON, self.on_draw_denoise_roi)
        self.denoise_roi_btn.Enable(False)
        sizer.Add(self.denoise_roi_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.denoise_roi_text = _dlabel(panel, 'Denoising the whole image.')
        sizer.Add(self.denoise_roi_text, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        # -- line-wise parameters ------------------------------------------
        self.line_box = wx.StaticBoxSizer(wx.VERTICAL, panel, 'Line-wise')
        line_row = wx.BoxSizer(wx.HORIZONTAL)
        line_row.Add(_dlabel(panel, 'Lines are:'), 0,
                     wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.line_axis = wx.Choice(panel, choices=['Rows', 'Columns'])
        self.line_axis.SetSelection(0)
        line_row.Add(self.line_axis, 0, wx.RIGHT, 12)
        line_row.Add(_dlabel(panel, 'Components:'), 0,
                     wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.line_comp = wx.SpinCtrl(panel, min=1, max=200, initial=8,
                                     size=(70, -1))
        line_row.Add(self.line_comp, 0)
        self.line_box.Add(line_row, 0, wx.ALL, 6)
        sizer.Add(self.line_box, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        # -- patch parameters ----------------------------------------------
        self.patch_box = wx.StaticBoxSizer(wx.VERTICAL, panel, 'Patch-based')
        prow1 = wx.BoxSizer(wx.HORIZONTAL)
        prow1.Add(_dlabel(panel, 'Patch (px):'), 0,
                  wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.patch_size = wx.SpinCtrl(panel, min=3, max=32, initial=8,
                                      size=(60, -1))
        prow1.Add(self.patch_size, 0, wx.RIGHT, 12)
        prow1.Add(_dlabel(panel, 'Stride (px):'), 0,
                  wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.patch_stride = wx.SpinCtrl(panel, min=1, max=16, initial=4,
                                        size=(60, -1))
        prow1.Add(self.patch_stride, 0)
        self.patch_box.Add(prow1, 0, wx.ALL, 6)
        prow2 = wx.BoxSizer(wx.HORIZONTAL)
        prow2.Add(_dlabel(panel, 'Components:'), 0,
                  wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.patch_comp = wx.SpinCtrl(panel, min=1, max=200, initial=8,
                                      size=(70, -1))
        prow2.Add(self.patch_comp, 0)
        self.patch_box.Add(prow2, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 6)
        sizer.Add(self.patch_box, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        # -- scree / apply --------------------------------------------------
        est_btn = wx.Button(panel, label='Analyse  (variance & loadings)')
        est_btn.SetToolTip('Plot the explained-variance ratio and the '
                           'principal-component loadings to guide the '
                           'component count')
        est_btn.Bind(wx.EVT_BUTTON, self.on_estimate_components)
        sizer.Add(est_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        apply_btn = wx.Button(panel, label='Denoise  →  new TEM~Map sheet')
        apply_btn.SetBackgroundColour(BRAND_WX)
        apply_btn.Bind(wx.EVT_BUTTON, self.on_apply_denoise)
        sizer.Add(apply_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.denoise_status = _dlabel(panel, '')
        sizer.Add(self.denoise_status, 0, wx.ALL, 8)

        panel.SetSizer(sizer)
        self._on_denoise_mode(None)
        return panel

    # -- mode / region toggles ----------------------------------------------

    def _on_denoise_mode(self, event):
        line = (self.denoise_mode.GetSelection() == 0)
        self.line_box.GetStaticBox().Enable(line)
        self.line_axis.Enable(line)
        self.line_comp.Enable(line)
        for c in (self.patch_size, self.patch_stride, self.patch_comp):
            c.Enable(not line)
        self.patch_box.GetStaticBox().Enable(not line)

    def _on_denoise_whole(self, event):
        whole = self.denoise_whole.GetValue()
        self.denoise_roi_btn.Enable(not whole)
        if whole:
            self._clear_interaction(redraw=True)
            self.denoise_roi_text.SetLabel('Denoising the whole image.')
        else:
            self.denoise_roi_text.SetLabel('Draw a region on the image.')

    # -- region drawing (rectangle, not forced square) ----------------------

    def on_draw_denoise_roi(self, event):
        self._show_sheet(self.sheet_name)
        self._clear_interaction()
        self._mode = 'roi'
        ax = self.parent.plot_manager.ax
        canvas = self.parent.plot_manager.canvas

        from libraries.ViewMenu.XYMapViewer import _make_grid_rotatable
        self._roi = _make_grid_rotatable(ax, self._on_denoise_roi_changed)
        self._cids = [canvas.mpl_connect('button_press_event',
                                         self._on_denoise_roi_seed)]
        self.denoise_roi_text.SetLabel('Click on the image to place the region…')

    def _on_denoise_roi_seed(self, event):
        ax = self.parent.plot_manager.ax
        if (self._roi is None or self._roi.active
                or event.inaxes is not ax or event.button != 1):
            return
        self._roi.start_selection(event)
        x_lo, x_hi = ax.get_xlim()
        span = abs(x_hi - x_lo) * 0.3
        self._roi.width = span
        self._roi.height = span
        self._roi.draw_rectangle()
        self._on_denoise_roi_changed(self._roi.center, self._roi.width,
                                     self._roi.height, self._roi.angle)

    def _on_denoise_roi_changed(self, center, width, height, angle):
        scale, unit = self._map_scale()
        w_px = width / scale
        h_px = height / scale
        self.denoise_roi_text.SetLabel(
            f'Region: {w_px:.0f} x {h_px:.0f} px at {angle:.0f}°')

    # -- the ROI (or whole image) as a pixel array --------------------------

    def _denoise_region(self):
        """(image array, nm_per_px, description-suffix) to denoise, or None."""
        sheet = self.sheet
        image = tem_array(sheet)
        if image is None:
            return None
        nm = sheet.get('TEM_NM_Per_Px')
        if self.denoise_whole.GetValue():
            return np.asarray(image, dtype=float), nm, ''
        if self._roi is None or not self._roi.active:
            wx.MessageBox('Draw a region on the image, or tick "Whole image".',
                          'TEM', wx.OK | wx.ICON_INFORMATION)
            return None
        scale, _ = self._map_scale()
        cx = self._roi.center[0] / scale
        cy = self._roi.center[1] / scale
        w_px = self._roi.width / scale
        h_px = self._roi.height / scale
        angle = float(self._roi.angle)
        if w_px < 4 or h_px < 4:
            wx.MessageBox('The region is too small to denoise.', 'TEM',
                          wx.OK | wx.ICON_WARNING)
            return None
        region = extract_rotated_region(image, (cx, cy), w_px, h_px, angle)
        return region, nm, ' (region)'

    # -- scree read-out -----------------------------------------------------

    def on_estimate_components(self, event):
        picked = self._denoise_region()
        if picked is None:
            return
        image, _nm, suffix = picked
        line = (self.denoise_mode.GetSelection() == 0)
        axis = self.line_axis.GetSelection()
        patch = self.patch_size.GetValue()
        stride = self.patch_stride.GetValue()

        wx.BeginBusyCursor()
        try:
            if line:
                ratio = pca_variance_ratio(image, mode='line', axis=axis,
                                           max_components=25)
            else:
                ratio = pca_variance_ratio(image, mode='patch', patch=patch,
                                           stride=stride, max_components=25)
        except Exception as exc:
            wx.EndBusyCursor()
            wx.MessageBox(f'Could not analyse:\n{exc}', 'TEM',
                          wx.OK | wx.ICON_ERROR)
            return
        wx.EndBusyCursor()

        cum = np.cumsum(ratio)
        # First component count that reaches 90 / 95 / 99 % of the variance.
        def _reach(frac):
            hit = np.searchsorted(cum, frac) + 1
            return min(hit, len(cum))
        self.denoise_status.SetLabel(
            f'Variance reached by the leading components:\n'
            f'  90%: {_reach(0.90)}   95%: {_reach(0.95)}   '
            f'99%: {_reach(0.99)} components\n'
            f'(first PC alone: {ratio[0] * 100:.1f}%). '
            f'Keep enough to hold the signal, drop the flat tail.')

        # ...and the same pair of plots the XPS PCA window shows.
        from libraries.ToolsMenu.TEM_DenoisePlots import TEMDenoisePlotsWindow
        suffix_txt = ('whole image' if self.denoise_whole.GetValue()
                      else 'region')
        win = TEMDenoisePlotsWindow(
            self.parent, image, 'line' if line else 'patch', axis=axis,
            patch=patch, stride=stride, title_suffix=suffix_txt)
        win.Show()

    # -- apply --------------------------------------------------------------

    def on_apply_denoise(self, event):
        picked = self._denoise_region()
        if picked is None:
            return
        image, nm, suffix = picked
        line = (self.denoise_mode.GetSelection() == 0)

        # Remember the zoom on the source map: a whole-image denoise has the
        # same geometry, so the cleaned copy should open at the same view
        # rather than snapping back to the full frame. A region crop has a
        # different extent, so it is left to open full-frame.
        carry_view = self._current_map_view() if self.denoise_whole.GetValue() \
            else None

        wx.BeginBusyCursor()
        try:
            if line:
                axis = self.line_axis.GetSelection()
                k = self.line_comp.GetValue()
                cleaned = pca_denoise_lines(image, k, axis=axis)
                axis_name = 'rows' if axis == 0 else 'columns'
                desc = (f'PCA denoised (line-wise, {axis_name}, '
                        f'{k} components){suffix}')
            else:
                k = self.patch_comp.GetValue()
                p = self.patch_size.GetValue()
                s = self.patch_stride.GetValue()
                cleaned = pca_denoise_patches(image, k, patch=p, stride=s)
                desc = (f'PCA denoised (patch {p}px/stride {s}px, '
                        f'{k} components){suffix}')
        except Exception as exc:
            wx.EndBusyCursor()
            wx.MessageBox(f'Denoising failed:\n{exc}', 'TEM',
                          wx.OK | wx.ICON_ERROR)
            return
        wx.EndBusyCursor()

        # Denoising an FFT stays an FFT (keeps its reciprocal calibration and
        # spots); denoising a real-space image makes another map.
        if is_tem_fft(self.sheet):
            from libraries.FileMenu.TEM_Import import make_tem_denoised_fft_sheet
            name, sheet = make_tem_denoised_fft_sheet(
                cleaned, self.sheet, self.sheet_name, description=desc)
        else:
            name, sheet = make_tem_filtered_sheet(
                'TEM~Map', cleaned, nm, self.sheet_name,
                description=desc,
                extra_info={'Denoise': 'PCA'})
        name = register_tem_sheet(self.parent, name, sheet)
        self._clear_interaction(redraw=False)
        self._persist()
        self.denoise_status.SetLabel(
            f"Added '{name}'  ({cleaned.shape[1]} x {cleaned.shape[0]} px).\n"
            f'{desc}.')
        self._show_sheet(name)
        self._restore_map_view(carry_view)

    def _current_map_view(self):
        """The source map's current (xlim, ylim), or None if it is full-frame
        or not the sheet currently on the main canvas."""
        if getattr(self.parent, 'tem_on_main', None) != self.sheet_name:
            return None
        ax = self.parent.plot_manager.ax
        xlim = ax.get_xlim()
        ylim = ax.get_ylim()
        if xlim == (0.0, 1.0) and ylim == (0.0, 1.0):
            return None
        return xlim, ylim

    def _restore_map_view(self, view):
        """Re-apply a captured (xlim, ylim) onto the newly shown sheet."""
        if not view:
            return
        ax = self.parent.plot_manager.ax
        ax.set_xlim(*view[0])
        ax.set_ylim(*view[1])
        self.parent.plot_manager.canvas.draw_idle()
