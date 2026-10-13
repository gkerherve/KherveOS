# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/TEM_Filter.py. Regenerate with tools/export_khervetech.py.
"""
Bragg filtering and lattice mapping for the TEM Analysis window.

Two tabs live here, as mixins on ``TEMAnalysisWindow`` — they need the same
sheet accessors, canvas plumbing and FFT click handling as the rest of the
window, and splitting them out keeps ``TEM_Analysis`` readable rather than
building a second, parallel window:

    Filter    aperture masks over chosen diffraction spots (circle, ellipse
              or polygon), each one labelled, and the inverse transform of
              each mask as its own reconstructed lattice image
    Advanced  the two whole-field methods: a moving-window FFT map of the
              local d-spacing and plane orientation, and geometric-phase
              strain maps from a pair of g-vectors

Nothing here modifies the source image. A mask lives on the TEM~FFT sheet
(``TEM_FFT_Masks``), and every reconstruction is a new sheet, so the original
micrograph, its FFT and each filtered image sit side by side.

Mask coordinates are pixels from the centre of the power spectrum, x right
and y down — the same convention as a measured spot, so a mask dropped on a
spot stays on it through redraws and recalibration.
"""

import numpy as np
import wx

from libraries.FileMenu.TEM_Import import (is_tem_fft, make_tem_filtered_sheet,
                                           make_tem_scalar_sheet,
                                           register_tem_sheet, tem_array)
from libraries.ToolsMenu.TEM_Engine import (build_mask, extract_rotated_region,
                                            gpa_strain, local_fft_map,
                                            masked_inverse_fft)

BRAND_WX = wx.Colour(79, 190, 159)

# Enough distinct outlines that several masks on one pattern stay tellable
# apart; the first is the brand green, which is what a single mask gets.
MASK_COLOURS = ('#4FBE9F', '#E4572E', '#3F88C5', '#F2C14E', '#B565A7',
                '#57C4E5')

_SHAPES = ('Circle', 'Ellipse', 'Polygon')


def _label(parent, text, bold=False):
    ctrl = wx.StaticText(parent, label=text)
    if bold:
        font = ctrl.GetFont()
        font.SetWeight(wx.FONTWEIGHT_BOLD)
        ctrl.SetFont(font)
    return ctrl


class FilterTabMixin:
    """FFT masking and inverse FFT."""

    # -- construction ------------------------------------------------------

    def _build_filter(self):
        panel = wx.Panel(self.notebook)
        sizer = wx.BoxSizer(wx.VERTICAL)

        self.filter_target_text = _label(panel, '', bold=True)
        sizer.Add(self.filter_target_text, 0, wx.ALL, 8)

        sizer.Add(_label(panel,
                         'Select diffraction spots with a mask, then invert\n'
                         'the transform to reconstruct just those lattice\n'
                         'planes. The source image is never modified.'),
                  0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        self.mask_list = wx.ListCtrl(panel, style=wx.LC_REPORT | wx.LC_SINGLE_SEL,
                                     size=(-1, 110))
        self.mask_list.InsertColumn(0, 'Mask', width=130)
        self.mask_list.InsertColumn(1, 'Regions', width=70)
        self.mask_list.InsertColumn(2, 'Shape', width=80)
        self.mask_list.InsertColumn(3, 'Sym.', width=50)
        self.mask_list.Bind(wx.EVT_LIST_ITEM_SELECTED,
                            lambda e: self._on_mask_selected())
        sizer.Add(self.mask_list, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        row = wx.BoxSizer(wx.HORIZONTAL)
        for caption, handler in (('New mask', self.on_new_mask),
                                 ('Rename', self.on_rename_mask),
                                 ('Delete', self.on_delete_mask)):
            button = wx.Button(panel, label=caption)
            button.Bind(wx.EVT_BUTTON, handler)
            row.Add(button, 1, wx.RIGHT, 4)
        sizer.Add(row, 0, wx.EXPAND | wx.ALL, 8)

        shape_row = wx.BoxSizer(wx.HORIZONTAL)
        shape_row.Add(_label(panel, 'Shape:'), 0,
                      wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.mask_shape = wx.Choice(panel, choices=list(_SHAPES))
        self.mask_shape.SetSelection(0)
        shape_row.Add(self.mask_shape, 0, wx.RIGHT, 10)
        shape_row.Add(_label(panel, 'Radius (px):'), 0,
                      wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.mask_radius = wx.SpinCtrl(panel, min=1, max=400, initial=8)
        shape_row.Add(self.mask_radius)
        sizer.Add(shape_row, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        pick_btn = wx.Button(panel, label='Add regions — click spots on the FFT')
        pick_btn.SetToolTip('Click a diffraction spot to add a region snapped '
                            'to it. For a polygon, click each vertex and then '
                            'close it (double-click, or the button below).')
        pick_btn.Bind(wx.EVT_BUTTON, self.on_pick_mask_regions)
        sizer.Add(pick_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        polygon_row = wx.BoxSizer(wx.HORIZONTAL)
        self.close_polygon_btn = wx.Button(panel, label='Close polygon')
        self.close_polygon_btn.Bind(wx.EVT_BUTTON,
                                    lambda e: self._close_polygon())
        polygon_row.Add(self.close_polygon_btn, 1, wx.RIGHT, 4)
        clear_btn = wx.Button(panel, label='Clear this mask’s regions')
        clear_btn.Bind(wx.EVT_BUTTON, self.on_clear_mask_regions)
        polygon_row.Add(clear_btn, 1)
        sizer.Add(polygon_row, 0, wx.EXPAND | wx.ALL, 8)

        self.mask_symmetric = wx.CheckBox(
            panel, label='Include the Friedel mate (−g) of every region')
        self.mask_symmetric.SetValue(True)
        self.mask_symmetric.SetToolTip(
            'A fringe is the sum of +g and −g. Without the mate the '
            'reconstruction is half amplitude and phase-shifted.')
        self.mask_symmetric.Bind(wx.EVT_CHECKBOX,
                                 lambda e: self._store_mask_options())
        sizer.Add(self.mask_symmetric, 0, wx.LEFT | wx.RIGHT, 8)

        self.mask_dc = wx.CheckBox(panel,
                                   label='Keep the central beam (mean brightness)')
        self.mask_dc.Bind(wx.EVT_CHECKBOX, lambda e: self._store_mask_options())
        sizer.Add(self.mask_dc, 0, wx.ALL, 8)

        smooth_row = wx.BoxSizer(wx.HORIZONTAL)
        smooth_row.Add(_label(panel, 'Edge softening (px):'), 0,
                       wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 6)
        self.mask_smooth = wx.SpinCtrlDouble(panel, min=0.0, max=20.0, inc=0.5,
                                             initial=2.0)
        self.mask_smooth.SetDigits(1)
        self.mask_smooth.SetToolTip('A hard-edged aperture rings in real '
                                    'space; softening the edge removes '
                                    'fringes that are not in the lattice.')
        smooth_row.Add(self.mask_smooth)
        sizer.Add(smooth_row, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        run_btn = wx.Button(panel, label='Inverse FFT  →  TEM~IFFT sheet')
        run_btn.SetBackgroundColour(BRAND_WX)
        run_btn.Bind(wx.EVT_BUTTON, lambda e: self.on_inverse_fft(all_masks=False))
        sizer.Add(run_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        all_btn = wx.Button(panel, label='Inverse FFT of every mask')
        all_btn.SetToolTip('One reconstructed image per mask, so different '
                           'lattice planes can be compared side by side.')
        all_btn.Bind(wx.EVT_BUTTON, lambda e: self.on_inverse_fft(all_masks=True))
        sizer.Add(all_btn, 0, wx.EXPAND | wx.ALL, 8)

        self.filter_status = _label(panel, '')
        sizer.Add(self.filter_status, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        panel.SetSizer(sizer)
        return panel

    # -- mask bookkeeping --------------------------------------------------

    def _masks(self):
        sheet = self.fft_sheet
        if not sheet:
            return []
        return sheet.setdefault('TEM_FFT_Masks', [])

    def _selected_mask(self):
        masks = self._masks()
        index = self.mask_list.GetFirstSelected()
        if 0 <= index < len(masks):
            return masks[index]
        return masks[-1] if masks else None

    def refresh_mask_list(self):
        """Repopulate the mask table from the FFT sheet."""
        if not getattr(self, 'mask_list', None):
            return
        selected = self.mask_list.GetFirstSelected()
        self.mask_list.DeleteAllItems()
        masks = self._masks()
        for mask in masks:
            row = self.mask_list.InsertItem(self.mask_list.GetItemCount(),
                                            str(mask.get('label', 'Mask')))
            regions = mask.get('regions') or []
            self.mask_list.SetItem(row, 1, str(len(regions)))
            self.mask_list.SetItem(row, 2, str(regions[0].get('kind', '—')
                                               if regions else '—'))
            self.mask_list.SetItem(row, 3,
                                   'yes' if mask.get('symmetric', True) else 'no')
            colour = mask.get('colour')
            if colour:
                self.mask_list.SetItemTextColour(row, wx.Colour(colour))
        if masks:
            index = selected if 0 <= selected < len(masks) else len(masks) - 1
            self.mask_list.Select(index)
        if getattr(self, 'filter_target_text', None):
            self.filter_target_text.SetLabel(
                f'Masking: {self.fft_sheet_name}' if self.fft_sheet_name
                else 'No FFT sheet yet — create one in the FFT tab.')

    def _on_mask_selected(self):
        """Show the picked mask's own options.

        The *shape* is deliberately left alone: it is a property of the next
        region to be drawn, not of the mask, and one mask may well want a
        polygon added beside the circles it already has. Reading it back off
        the first region would silently undo the choice just made.
        """
        mask = self._selected_mask()
        if not mask:
            return
        self.mask_symmetric.SetValue(bool(mask.get('symmetric', True)))
        self.mask_dc.SetValue(bool(mask.get('include_dc', False)))
        self.mask_smooth.SetValue(float(mask.get('smooth_px', 2.0)))

    def _store_mask_options(self):
        mask = self._selected_mask()
        if not mask:
            return
        mask['symmetric'] = self.mask_symmetric.GetValue()
        mask['include_dc'] = self.mask_dc.GetValue()
        mask['smooth_px'] = float(self.mask_smooth.GetValue())
        self.refresh_mask_list()
        self._redraw_main(self.fft_sheet_name, preserve_view=True)
        self._persist()

    def on_new_mask(self, event):
        if self._require_fft() is None:
            return
        masks = self._masks()
        with wx.TextEntryDialog(self, 'Name for this mask:', 'New mask',
                                f'g{len(masks) + 1}') as dialog:
            if dialog.ShowModal() != wx.ID_OK:
                return
            label = dialog.GetValue().strip() or f'g{len(masks) + 1}'
        masks.append({'label': label, 'regions': [],
                      'colour': MASK_COLOURS[len(masks) % len(MASK_COLOURS)],
                      'symmetric': self.mask_symmetric.GetValue(),
                      'include_dc': self.mask_dc.GetValue(),
                      'smooth_px': float(self.mask_smooth.GetValue()),
                      'visible': True})
        self.refresh_mask_list()
        self.mask_list.Select(len(masks) - 1)
        self.filter_status.SetLabel(
            f"'{label}' created. Press 'Add regions — click spots on the FFT', "
            f"then click each diffraction spot to place a circle.")
        self._persist()

    def on_rename_mask(self, event):
        mask = self._selected_mask()
        if not mask:
            return
        with wx.TextEntryDialog(self, 'Name for this mask:', 'Rename mask',
                                str(mask.get('label', ''))) as dialog:
            if dialog.ShowModal() != wx.ID_OK:
                return
            mask['label'] = dialog.GetValue().strip() or mask.get('label', 'Mask')
        self.refresh_mask_list()
        self._redraw_main(self.fft_sheet_name, preserve_view=True)
        self._persist()

    def on_delete_mask(self, event):
        masks = self._masks()
        index = self.mask_list.GetFirstSelected()
        if not (0 <= index < len(masks)):
            return
        removed = masks.pop(index)
        self.refresh_mask_list()
        self.filter_status.SetLabel(f"Deleted '{removed.get('label', 'mask')}'.")
        self._redraw_main(self.fft_sheet_name, preserve_view=True)
        self._persist()

    def on_clear_mask_regions(self, event):
        mask = self._selected_mask()
        if not mask:
            return
        mask['regions'] = []
        self._polygon_points = []
        self.refresh_mask_list()
        self._redraw_main(self.fft_sheet_name, preserve_view=True)
        self._persist()

    # -- picking regions on the FFT ---------------------------------------

    def on_pick_mask_regions(self, event):
        if self._require_fft() is None:
            return
        if not self._masks():
            self.on_new_mask(None)
            if not self._masks():
                return
        self._show_sheet(self.fft_sheet_name)
        self._clear_interaction(redraw=False)
        self._mode = 'mask'
        self._polygon_points = []
        canvas = self.parent.plot_manager.canvas
        self._cids = [canvas.mpl_connect('button_press_event',
                                         self._on_mask_click)]
        shape = _SHAPES[self.mask_shape.GetSelection()]
        self.filter_status.SetLabel(
            'Click each vertex; double-click to close…' if shape == 'Polygon'
            else 'Click a diffraction spot to add a region…')

    def _on_mask_click(self, event):
        # Button 1 only: the main canvas opens its own modal context menu on
        # a right-click, so no tool here may claim that button.
        ax = self.parent.plot_manager.ax
        if self._mode != 'mask' or event.inaxes is not ax or event.button != 1:
            return
        mask = self._selected_mask()
        if mask is None:
            return
        shape = _SHAPES[self.mask_shape.GetSelection()]
        radius = float(self.mask_radius.GetValue())

        if shape == 'Polygon':
            self._on_polygon_click(event, mask)
            return

        # Snap to the spot under the pointer: a mask centred on the peak
        # rather than on the click passes the whole spot symmetrically.
        spot = self._fft_click_to_spot(event)
        if spot is None:
            return
        if shape == 'Ellipse':
            # Elongate along the radial direction, which is how a spot
            # streaked by a slightly bent lattice actually looks.
            region = {'kind': 'ellipse', 'x': spot['x'], 'y': spot['y'],
                      'rx': radius, 'ry': radius * 0.6,
                      'angle': float(np.degrees(np.arctan2(spot['y'],
                                                           spot['x'])))}
        else:
            region = {'kind': 'circle', 'x': spot['x'], 'y': spot['y'],
                      'r': radius}
        mask.setdefault('regions', []).append(region)
        detail = (f"d = {spot['d_nm']:.4g} nm" if spot.get('d_nm')
                  else f"r = {spot['g_px']:.0f} px")
        self.filter_status.SetLabel(
            f"'{mask['label']}': {len(mask['regions'])} region(s), last at "
            f"{detail}.")
        self.refresh_mask_list()
        self._redraw_main(self.fft_sheet_name, preserve_view=True)
        self._persist()

    def _on_polygon_click(self, event, mask):
        """Each click adds a vertex; a double-click closes the polygon."""
        points = getattr(self, '_polygon_points', None)
        if points is None:
            points = self._polygon_points = []
        scale = self._fft_scale()
        if tem_array(self.fft_sheet) is None or scale is None:
            return

        if event.dblclick:
            self._close_polygon()
            return
        points.append([event.xdata / scale, event.ydata / scale])
        self._draw_polygon_preview(points, mask.get('colour'))
        self.filter_status.SetLabel(
            f'{len(points)} vertices — double-click, or "Close polygon", '
            f'to finish.')

    def _close_polygon(self):
        """Turn the staged vertices into a polygon region on the mask."""
        points = getattr(self, '_polygon_points', None) or []
        mask = self._selected_mask()
        if mask is None:
            return
        if len(points) < 3:
            self.filter_status.SetLabel('A polygon needs at least 3 vertices.')
            return
        mask.setdefault('regions', []).append(
            {'kind': 'polygon', 'points': [[float(px), float(py)]
                                           for px, py in points]})
        self._polygon_points = []
        self._clear_preview()
        self.filter_status.SetLabel(
            f"'{mask['label']}': polygon of {len(mask['regions'][-1]['points'])} "
            f"vertices added.")
        self.refresh_mask_list()
        self._redraw_main(self.fft_sheet_name, preserve_view=True)
        self._persist()

    def _draw_polygon_preview(self, points, colour):
        ax = self.parent.plot_manager.ax
        scale = self._fft_scale()
        if scale is None:
            return
        self._clear_preview()
        xs = [p[0] * scale for p in points]
        ys = [p[1] * scale for p in points]
        line, = ax.plot(xs, ys, '-o', ms=4, lw=1.2,
                        color=colour or '#4FBE9F', zorder=11)
        self._preview_artists = [line]
        self.parent.plot_manager.canvas.draw_idle()

    def _fft_scale(self):
        """Data units per pixel of the FFT sheet on the main axes."""
        from libraries.FileMenu.TEM_Import import tem_extent

        power = tem_array(self.fft_sheet)
        extent, _unit = tem_extent(self.fft_sheet)
        if power is None or extent is None:
            return None
        return abs(extent[1] - extent[0]) / power.shape[1]

    # -- the reconstruction ------------------------------------------------

    def _source_region(self):
        """Re-extract the real-space crop this FFT was computed from.

        The complex spectrum is not stored (the sheet holds the magnitude,
        which cannot be inverted), so the inverse transform is recomputed
        from the source pixels through exactly the same window and padding.
        """
        sheet = self.fft_sheet
        roi = sheet.get('TEM_FFT_ROI')
        source_name = sheet.get('TEM_FFT_Source')
        source = self.parent.Data.get('Core levels', {}).get(source_name, {})
        image = tem_array(source)
        if image is None or not roi or len(roi) < 5:
            return None, None, None
        cx, cy, w_px, h_px, angle = (float(v) for v in roi[:5])
        region = extract_rotated_region(image, (cx, cy), w_px, h_px, angle)
        return region, source.get('TEM_NM_Per_Px'), source_name

    def on_inverse_fft(self, all_masks=False):
        if self._require_fft() is None:
            return
        masks = [m for m in self._masks() if m.get('regions')]
        if not all_masks:
            selected = self._selected_mask()
            masks = ([selected] if selected and selected.get('regions') else [])
        if not masks:
            wx.MessageBox('Add at least one region to a mask first.', 'TEM',
                          wx.OK | wx.ICON_INFORMATION)
            return

        region, nm_per_px, source_name = self._source_region()
        if region is None:
            wx.MessageBox('The source region for this FFT is no longer '
                          'available — recompute the FFT from the map.',
                          'TEM', wx.OK | wx.ICON_WARNING)
            return
        power = tem_array(self.fft_sheet)
        shape = power.shape

        created = []
        wx.BeginBusyCursor()
        try:
            for mask in masks:
                aperture = build_mask(shape, mask.get('regions'),
                                      symmetric=mask.get('symmetric', True),
                                      smooth_px=float(mask.get('smooth_px', 2.0)),
                                      include_dc=mask.get('include_dc', False))
                if not aperture.any():
                    continue
                filtered, _amplitude = masked_inverse_fft(region, aperture,
                                                          nm_per_px)
                label = str(mask.get('label', 'mask'))
                name, sheet = make_tem_filtered_sheet(
                    'TEM~IFFT', filtered, nm_per_px, source_name,
                    mask_label=label,
                    extra_info={'FFT Sheet': self.fft_sheet_name,
                                'Regions': len(mask.get('regions') or []),
                                'Friedel mate': 'yes' if mask.get('symmetric', True)
                                                else 'no'})
                sheet['Name'] = name
                created.append(register_tem_sheet(self.parent, name, sheet))
        except Exception as e:
            import traceback
            traceback.print_exc()
            wx.MessageBox(f'Inverse FFT failed:\n{e}', 'TEM',
                          wx.OK | wx.ICON_ERROR)
            return
        finally:
            wx.EndBusyCursor()

        if not created:
            self.filter_status.SetLabel('The mask is empty — nothing to invert.')
            return
        self._persist()
        self.filter_status.SetLabel(
            f"Added {', '.join(created)} — the source image is unchanged.")
        self._show_sheet(created[-1])


class AdvancedTabMixin:
    """Local FFT mapping and geometric-phase strain analysis."""

    def _build_advanced(self):
        panel = wx.Panel(self.notebook)
        sizer = wx.BoxSizer(wx.VERTICAL)

        sizer.Add(_label(panel, 'Local FFT mapping', bold=True), 0, wx.ALL, 8)
        sizer.Add(_label(panel,
                         'Scans the image with a moving window and maps the\n'
                         'local lattice spacing and plane orientation.'),
                  0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        grid = wx.FlexGridSizer(3, 2, 6, 6)
        grid.Add(_label(panel, 'Window (px):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.map_window = wx.SpinCtrl(panel, min=16, max=1024, initial=128)
        self.map_window.SetToolTip('Bigger windows measure d more precisely '
                                   'and localise it more coarsely.')
        grid.Add(self.map_window)
        grid.Add(_label(panel, 'Step (px):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.map_step = wx.SpinCtrl(panel, min=1, max=512, initial=32)
        grid.Add(self.map_step)
        grid.Add(_label(panel, 'Follow:'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.map_target = wx.Choice(panel, choices=['Brightest spot'])
        self.map_target.SetSelection(0)
        self.map_target.SetToolTip('Pick a measured d-spacing to follow one '
                                   'set of planes across the field.')
        grid.Add(self.map_target)
        sizer.Add(grid, 0, wx.ALL, 8)

        map_btn = wx.Button(panel, label='Map d-spacing and orientation')
        map_btn.SetBackgroundColour(BRAND_WX)
        map_btn.Bind(wx.EVT_BUTTON, self.on_local_map)
        sizer.Add(map_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        self.map_status = _label(panel, '')
        sizer.Add(self.map_status, 0, wx.ALL, 8)

        sizer.Add(wx.StaticLine(panel), 0, wx.EXPAND | wx.ALL, 8)

        sizer.Add(_label(panel, 'Strain mapping (GPA) — advanced', bold=True),
                  0, wx.LEFT | wx.RIGHT, 8)
        sizer.Add(_label(panel,
                         'Geometric phase analysis of the FFT region. Choose\n'
                         'two non-parallel spots as g-vectors; the strain is\n'
                         'referenced to the region’s own average lattice.'),
                  0, wx.ALL, 8)

        g_grid = wx.FlexGridSizer(3, 2, 6, 6)
        g_grid.Add(_label(panel, 'g₁ (spot):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.gpa_g1 = wx.Choice(panel, choices=[])
        g_grid.Add(self.gpa_g1)
        g_grid.Add(_label(panel, 'g₂ (spot):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.gpa_g2 = wx.Choice(panel, choices=[])
        g_grid.Add(self.gpa_g2)
        g_grid.Add(_label(panel, 'Smoothing (px):'), 0, wx.ALIGN_CENTER_VERTICAL)
        self.gpa_smooth = wx.SpinCtrlDouble(panel, min=0.0, max=30.0, inc=1.0,
                                            initial=3.0)
        self.gpa_smooth.SetDigits(1)
        g_grid.Add(self.gpa_smooth)
        sizer.Add(g_grid, 0, wx.ALL, 8)

        gpa_btn = wx.Button(panel, label='Strain maps  →  εxx, εyy, εxy, rotation')
        gpa_btn.Bind(wx.EVT_BUTTON, self.on_gpa)
        sizer.Add(gpa_btn, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        self.gpa_status = _label(panel, '')
        sizer.Add(self.gpa_status, 0, wx.ALL, 8)

        panel.SetSizer(sizer)
        return panel

    # -- spot pickers ------------------------------------------------------

    def _labelled_spots(self):
        """(caption, spot) for every distinct measured spot on the FFT."""
        out = []
        for spot in (self.fft_sheet.get('TEM_FFT_Spots') or []):
            if spot.get('x') is None or spot.get('y') is None:
                continue
            if spot.get('d_nm'):
                caption = (f"{spot['d_nm']:.3f} nm at "
                           f"{spot.get('angle', 0.0):.0f}°")
            else:
                caption = (f"{spot.get('g_px', 0.0):.0f} px at "
                           f"{spot.get('angle', 0.0):.0f}°")
            if spot.get('hkl'):
                caption += f" ({spot['hkl']})"
            out.append((caption, spot))
        return out

    def refresh_advanced_choices(self):
        """Repopulate the spot pickers from the current FFT sheet."""
        if not getattr(self, 'gpa_g1', None):
            return
        spots = self._labelled_spots()
        captions = [caption for caption, _spot in spots]
        self._advanced_spots = [spot for _caption, spot in spots]
        for choice, default in ((self.gpa_g1, 0), (self.gpa_g2, 1)):
            previous = choice.GetSelection()
            choice.Set(captions)
            if captions:
                choice.SetSelection(previous if 0 <= previous < len(captions)
                                    else min(default, len(captions) - 1))
        self.map_target.Set(['Brightest spot'] + captions)
        if self.map_target.GetSelection() == wx.NOT_FOUND:
            self.map_target.SetSelection(0)

    # -- local FFT map -----------------------------------------------------

    def on_local_map(self, event):
        sheet = self.sheet
        image = tem_array(sheet)
        nm_per_px = sheet.get('TEM_NM_Per_Px')
        if image is None:
            return
        if not nm_per_px:
            wx.MessageBox('Calibrate the pixel size first — a d-spacing map '
                          'in pixels means nothing.', 'TEM',
                          wx.OK | wx.ICON_INFORMATION)
            return

        window_px = int(self.map_window.GetValue())
        step_px = int(self.map_step.GetValue())
        target_g = self._map_target_g(window_px)

        dialog = wx.ProgressDialog('Local FFT map', 'Scanning…', maximum=100,
                                   parent=self, style=wx.PD_APP_MODAL
                                   | wx.PD_CAN_ABORT | wx.PD_AUTO_HIDE)

        def progress(fraction):
            keep_going, _skip = dialog.Update(int(fraction * 100))
            return keep_going

        try:
            result = local_fft_map(image, nm_per_px, window_px=window_px,
                                   step_px=step_px, target_g_px=target_g,
                                   progress=progress)
        except Exception as e:
            import traceback
            traceback.print_exc()
            dialog.Destroy()
            wx.MessageBox(f'Mapping failed:\n{e}', 'TEM', wx.OK | wx.ICON_ERROR)
            return
        dialog.Destroy()

        if not result or not np.any(result['valid']):
            self.map_status.SetLabel(
                'No lattice found in any window — try a larger window, or '
                'check that the image resolves fringes.')
            return

        # One scalar pixel per window position: the map's own pixel size is
        # the step, so the scale bar and any profile on it stay honest.
        map_nm_per_px = float(nm_per_px) * result['step_px']
        d_map = result['d_nm']
        finite = d_map[np.isfinite(d_map)]
        lo, hi = (float(np.percentile(finite, 2)),
                  float(np.percentile(finite, 98))) if finite.size else (None, None)

        created = []
        for values, name, label, cmap, limits in (
                (d_map, 'TEM~dMap', 'd (nm)', 'viridis', (lo, hi)),
                (result['angle_rel_deg'], 'TEM~Angle',
                 'Δorientation (°)', 'twilight', (-15.0, 15.0))):
            _n, new_sheet = make_tem_scalar_sheet(
                name, values, map_nm_per_px, self.sheet_name, label,
                cmap=cmap, vmin=limits[0], vmax=limits[1],
                description='Local FFT map',
                extra_info={'Window (px)': window_px, 'Step (px)': step_px})
            created.append(register_tem_sheet(self.parent, name, new_sheet))

        coverage = 100.0 * np.count_nonzero(result['valid']) / result['valid'].size
        self.map_status.SetLabel(
            f"{', '.join(created)} added — {coverage:.0f}% of windows "
            f"resolved a lattice"
            + (f", d = {np.nanmean(d_map):.4g} nm mean." if finite.size else '.'))
        self._persist()
        self._show_sheet(created[0])

    def _map_target_g(self, window_px):
        """|g| in pixels of the *window's* spectrum for the chosen spot.

        The spot was measured on the FFT of the drawn region, whose spectrum
        is a different size, so the radius has to be rescaled — a raw pixel
        radius from one transform is meaningless in another.
        """
        index = self.map_target.GetSelection() - 1
        spots = getattr(self, '_advanced_spots', [])
        if index < 0 or index >= len(spots):
            return None
        spot = spots[index]
        nm_per_px = self.sheet.get('TEM_NM_Per_Px')
        if spot.get('g') and nm_per_px:
            # g [1/nm] -> pixels of a window_px spectrum.
            return float(spot['g']) * window_px * float(nm_per_px)
        power = tem_array(self.fft_sheet)
        if power is None or not spot.get('g_px'):
            return None
        return float(spot['g_px']) * window_px / power.shape[1]

    # -- GPA ---------------------------------------------------------------

    def on_gpa(self, event):
        if self._require_fft() is None:
            return
        spots = getattr(self, '_advanced_spots', [])
        i1, i2 = self.gpa_g1.GetSelection(), self.gpa_g2.GetSelection()
        if not (0 <= i1 < len(spots)) or not (0 <= i2 < len(spots)) or i1 == i2:
            wx.MessageBox('Pick two different measured spots as g-vectors —\n'
                          'run the auto-detection on the Measure tab first.',
                          'TEM', wx.OK | wx.ICON_INFORMATION)
            return

        region, nm_per_px, source_name = self._source_region()
        if region is None:
            wx.MessageBox('The source region for this FFT is no longer '
                          'available — recompute the FFT from the map.',
                          'TEM', wx.OK | wx.ICON_WARNING)
            return

        g1 = (spots[i1]['x'], spots[i1]['y'])
        g2 = (spots[i2]['x'], spots[i2]['y'])
        wx.BeginBusyCursor()
        try:
            result = gpa_strain(region, g1, g2, nm_per_px=nm_per_px,
                                smooth_px=float(self.gpa_smooth.GetValue()))
        except ValueError as e:
            wx.EndBusyCursor()
            wx.MessageBox(str(e), 'TEM', wx.OK | wx.ICON_WARNING)
            return
        except Exception as e:
            import traceback
            traceback.print_exc()
            wx.EndBusyCursor()
            wx.MessageBox(f'Strain mapping failed:\n{e}', 'TEM',
                          wx.OK | wx.ICON_ERROR)
            return
        wx.EndBusyCursor()

        created = []
        for key, name, label in (('exx', 'TEM~Exx', 'εxx (%)'),
                                 ('eyy', 'TEM~Eyy', 'εyy (%)'),
                                 ('exy', 'TEM~Exy', 'εxy (%)'),
                                 ('rotation', 'TEM~Rot', 'rotation (°)')):
            values = np.asarray(result[key], dtype=float)
            if key != 'rotation':
                values = values * 100.0        # strain is read as a percentage
            # Symmetric limits, clipped to the bulk of the distribution: a
            # handful of phase-singularity pixels would otherwise set the
            # scale and flatten everything real to one colour.
            finite = values[np.isfinite(values)]
            span = (float(np.percentile(np.abs(finite), 98))
                    if finite.size else 1.0) or 1.0
            _n, sheet = make_tem_scalar_sheet(
                name, values, nm_per_px, source_name, label, cmap='coolwarm',
                vmin=-span, vmax=span, description='GPA strain map',
                extra_info={'FFT Sheet': self.fft_sheet_name,
                            'g1': self.gpa_g1.GetString(i1),
                            'g2': self.gpa_g2.GetString(i2)})
            created.append(register_tem_sheet(self.parent, name, sheet))

        self.gpa_status.SetLabel(
            f"{', '.join(created)} added. Strain is relative to the region’s "
            f"mean lattice; the outermost ~{int(0.1 * min(result['shape']))} px "
            f"are window artefacts, not strain.")
        self._persist()
        self._show_sheet(created[0])
