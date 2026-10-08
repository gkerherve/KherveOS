"""The main window of a technique app: what the desktop's MyFrame
(KherveFitting.py) is to the technique tools.

The tool windows (TGA_Analysis, BET_Analysis…) and the right-frame overview
(TechniqueOverview) run unchanged and reach into their ``parent`` for the
project (``Data``), the sheet selector, the plot (``ax``, ``canvas``,
``plot_manager``, ``plot_config``), the red range lines (``vline1/2``),
messages (``show_popup_message2``) and undo (``save_state``). This class
provides exactly those, with the desktop's behaviour:

* ``select_sheet`` is Sheet_Operations.on_sheet_selected for a technique
  sheet (undo step, technique button, right frame, replot);
* ``clear_and_replot`` is PlotManager.clear_and_replot's path for the
  forward-axis technique sheets (labels from the sheet, plain y axis,
  scatter or line, legend, Label-Manager labels, then the technique's
  extras such as TGA_Plot.draw_tga_extras);
* the red lines are dragged as On_Mouse_Defs does with a range window open.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0.
"""

from __future__ import annotations

import copy
import importlib

import numpy as np
import wx
from matplotlib._rec import Figure, _CanvasBase

MAX_HISTORY = 50   # MyFrame.max_history

#: Analysis windows that drive the red lines (MyFrame.show_hide_vlines)
RANGE_ATTRS = ('tga_analysis_window', 'squid_analysis_window', 'eis_analysis_window', 'vb_measurements_window')


class PlotConfig:
    """libraries/PlotConfig.PlotConfig: the per-sheet plot limits."""

    def __init__(self):
        self.plot_limits = {}
        self.original_limits = {}
        from libraries import PlotConfig as desk
        self._update = desk.update_plot_limits
        self._reset = desk.reset_plot_limits

    def update_plot_limits(self, window, sheet_name, x_min=None, x_max=None, y_min=None, y_max=None):
        return self._update(self, window, sheet_name, x_min, x_max, y_min, y_max)

    def reset_plot_limits(self, window, sheet_name):
        return self._reset(self, window, sheet_name)

    def get_plot_limits(self, window, sheet_name):
        if sheet_name not in self.plot_limits:
            self.update_plot_limits(window, sheet_name)
        return self.plot_limits.get(sheet_name)

    def forget(self, sheet_name=None):
        if sheet_name is None:
            self.plot_limits.clear()
            self.original_limits.clear()
        else:
            self.plot_limits.pop(sheet_name, None)
            self.original_limits.pop(sheet_name, None)


class _Canvas(_CanvasBase):
    def __init__(self, figure, frame):
        super().__init__(figure)
        self.frame = frame

    def SetFocus(self):
        pass

    def Refresh(self, *a, **kw):
        self.draw_idle()

    def GetSize(self):
        return wx.Size(*self.figure.size_px())


class PlotManager:
    """The parts of Plot_Operations.PlotManager the technique code calls."""

    def __init__(self, window):
        self.window = window

    @property
    def ax(self):
        return self.window.ax

    @property
    def canvas(self):
        return self.window.canvas

    @property
    def figure(self):
        return self.window.figure

    def clear_and_replot(self, window=None):
        self.window.clear_and_replot()

    def plot_data(self, window=None):
        self.window.plot_data()

    def update_legend(self, window=None):
        pass

    def raw_trace_label(self, window, sheet_name=None):
        if sheet_name is None:
            sheet_name = window.sheet_combobox.GetValue()
        sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
        if isinstance(sheet, dict):
            for key in ('SQUID_Trace_Label', 'TGA_Raw_Legend'):   # PlotManager.RAW_LABEL_KEYS
                value = (sheet.get(key) or '').strip()
                if value:
                    return value
        return 'Raw Data'

    def raw_trace_colour(self, window, sheet_name, default):
        sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
        if isinstance(sheet, dict):
            return sheet.get('SQUID_Trace_Colour') or default
        return default


class MainFrame(wx.Frame):
    """The desktop main window, headless; the page draws its chrome."""

    def __init__(self, tech):
        super().__init__(None, title='KherveFitting')
        from libraries.ConfigFile import Init_Measurement_Data
        self.tech = tech
        self.Data = Init_Measurement_Data(self)
        self.sheet_combobox = wx.ComboBox(self, style=wx.CB_READONLY)
        self.figure = Figure(figsize=(8.0, 6.0), dpi=100)
        self.canvas = _Canvas(self.figure, self)
        self.ax = self.figure.add_axes([0.1, 0.1, 0.85, 0.85])
        self.plot_manager = PlotManager(self)
        self.plot_config = PlotConfig()
        self.history, self.redo_stack = [], []
        self.status = ['', '']
        self.popups = []

        # MyFrame defaults (KherveFitting.py __init__ / default_config.json)
        self.vline1 = self.vline2 = self.vline3 = self.vline4 = None
        self.vline1_text = self.vline2_text = None
        self.moving_vline = None
        self.some_threshold = 0.1
        self.background_method = "Multi-Regions Smart"
        self.background_tab_selected = False
        self.peak_fitting_tab_selected = False
        self.energy_scale = 'BE'
        self.photons = 1486.67
        self.label_font_size = 10
        self.legend_visible = 1
        self.legend_font_size = 10
        self.axis_title_size = 11
        self.axis_number_size = 11
        self.plot_style = 'scatter'
        self.scatter_size = 4
        self.scatter_color = '#000000'
        self.scatter_marker = 'o'
        self.line_width = 1
        self.line_alpha = 0.7
        self.line_color = '#000000'
        self.raw_data_linestyle = '-'
        self.background_color = '#808080'
        self.background_alpha = 0.5
        self.background_linestyle = '--'
        self.background_thickness = 1
        self.y_axis_state = 0
        self.legend_frame, self.legend_rounded, self.legend_alpha, self.legend_edge = True, True, 0.1, 'gray'
        self.fitting_window = None
        self.labels_window = None
        self.technique_tool_spec = None
        self.save_file_format = 'kfitting'   # Preferences > project format: KherveOS saves .kfit
        self.zoom_mode = self.drag_mode = False
        self.green_vline_active = False
        for attr in ('tga_analysis_window', 'bet_analysis_window', 'squid_analysis_window', 'eis_analysis_window',
                     'vb_measurements_window', 'ftir_analysis_window', 'xrd_analysis_window', 'uvvis_analysis_window',
                     'raman_analysis_window', 'eels_window'):
            setattr(self, attr, None)

        # The right frame: the grids notebook the technique overview replaces.
        self.grid_notebook = wx.Notebook(self)
        self.peak_params_page = wx.Panel(self.grid_notebook)
        self.results_page = wx.Panel(self.grid_notebook)
        self.sample_manager_page = wx.Panel(self.grid_notebook)
        for page, title in ((self.peak_params_page, 'Peak Parameters'), (self.results_page, 'Results'),
                            (self.sample_manager_page, 'Sample Manager')):
            self.grid_notebook.AddPage(page, title)
        self._build_peak_grid()

    # ------------------------------------------------------------ the Peak Parameters grid
    PEAK_COLUMNS = ["ID", "Peak\nLabel", "Position\n(eV)", "Height\n(CPS)", "FWHM\n(eV)", "\u03c3/\u03b3 (%)\nL/G \n",
                    "Area\n(CPS.eV)", "\u03c3\nW_g", "\u03b3\nW_l", "W_g\nSkew", "Conc.\n(%)", "A/A\u1D00", "Split\n(eV)",
                    "Fitting Model", "Bkg Type", "Bkg Low\n(eV)", "Bkg High\n(eV)", "Bkg Offset Low\n(CPS)",
                    "Bkg Offset High\n(CPS)"]
    PEAK_SIZES = [20, 90, 80, 60, 60, 50, 70, 45, 45, 50, 40, 40, 40, 130, 130, 80, 80, 100, 100]

    def _build_peak_grid(self):
        """Widgets_Toolbars.create_peak_params_grid: the grid the Raman / XRD / EELS overview keeps."""
        import wx.grid
        sizer = wx.BoxSizer(wx.VERTICAL)
        self.peak_params_grid = wx.grid.Grid(self.peak_params_page)
        g = self.peak_params_grid
        g.CreateGrid(0, len(self.PEAK_COLUMNS))
        for i, label in enumerate(self.PEAK_COLUMNS):
            g.SetColLabelValue(i, label)
        g.SetDefaultRowSize(25)
        g.SetColLabelSize(35)
        g.SetDefaultColSize(60)
        g.SetRowLabelSize(17)
        for i, size in enumerate(self.PEAK_SIZES):
            g.SetColSize(i, size)
        # The fitting tools are KherveFitting's: here the grid shows the sheet's peaks.
        g.EnableEditing(False)
        sizer.Add(g, 1, wx.EXPAND)
        self.peak_params_page.SetSizer(sizer)

    def populate_peak_grid(self, sheet_name):
        """Sheet_Operations.on_sheet_selected: the sheet's fitted peaks, two rows each (values, constraints)."""
        from libraries.PeakFittingGrid import format_peak_value
        g = self.peak_params_grid
        if g.GetNumberRows():
            g.DeleteRows(0, g.GetNumberRows())
        cl = self.Data.get('Core levels', {}).get(sheet_name)
        peaks = ((cl or {}).get('Fitting') or {}).get('Peaks') if isinstance(cl, dict) else None
        if not peaks:
            return
        g.AppendRows(len(peaks) * 2)
        bg = cl.get('Background', {}) or {}
        x = cl.get('B.E.') or [0.0]
        defaults = {'Position': f"{min(x):.2f}:{max(x):.2f}", 'Height': '1:1e7', 'FWHM': '0.3:3.7', 'L/G': '5:80',
                    'Area': '1:1e7', 'Sigma': '0.3:3', 'Gamma': '0.3:3', 'Skew': '0.01:2'}
        for i, (label, pk) in enumerate(peaks.items()):
            row = i * 2
            g.SetCellValue(row, 0, chr(65 + i))
            g.SetCellValue(row, 1, str(label))
            for col, key, default in ((2, 'Position', 0.0), (3, 'Height', 1e4), (4, 'FWHM', 1.6), (5, 'L/G', 20),
                                      (6, 'Area', 1e4), (7, 'Sigma', 0.6), (8, 'Gamma', 0.4), (9, 'Skew', 0.1)):
                g.SetCellValue(row, col, format_peak_value(pk.get(key, default)))
            g.SetCellValue(row, 13, f"{pk.get('Fitting Model', 'GL (Area)')}")
            for col, key in ((14, 'Bkg Type'), (15, 'Bkg Low'), (16, 'Bkg High'), (17, 'Bkg Offset Low'),
                             (18, 'Bkg Offset High')):
                v = bg.get(key, '')
                if v in ('', None):
                    v = pk.get(key, '')
                g.SetCellValue(row, col, '' if v in ('', None) else f"{v}")
            cons = pk.get('Constraints') or {}
            for col, key in enumerate(('Position', 'Height', 'FWHM', 'L/G', 'Area', 'Sigma', 'Gamma', 'Skew'), 2):
                g.SetCellValue(row + 1, col, str(cons.get(key) or defaults[key]))

    # ------------------------------------------------------------ messages
    def show_popup_message2(self, title, message):
        """MyFrame.show_popup_message2: a wx.adv.RichToolTip balloon on the main window (title + text)."""
        wx.effect('tip', title=str(title), message=str(message),
                  icon='error' if str(title).lower().startswith('error') else
                  'warning' if str(title).lower().startswith('warning') else 'info')

    show_popup_message = show_popup_message2

    def SetStatusText(self, text, field=0):
        if 0 <= field < 2:
            self.status[field] = str(text)

    # ------------------------------------------------------------ the data
    @property
    def x_values(self):
        sheet = self.Data.get('Core levels', {}).get(self.sheet_combobox.GetValue(), {})
        return np.asarray(sheet.get('B.E.', []) if isinstance(sheet, dict) else [], dtype=float)

    @property
    def y_values(self):
        sheet = self.Data.get('Core levels', {}).get(self.sheet_combobox.GetValue(), {})
        return np.asarray(sheet.get('Raw Data', []) if isinstance(sheet, dict) else [], dtype=float)

    def sheet_names(self):
        return list(self.Data.get('Core levels', {}).keys())

    def convert_energy_from_display(self, x):
        return x

    def convert_energy_for_display(self, x):
        return x

    # ------------------------------------------------------------ undo (Save.save_state / undo / redo)
    def _snapshot(self):
        return {'data': copy.deepcopy(self.Data), 'sheet': self.sheet_combobox.GetValue()}

    def save_state(self):
        self.history.append(self._snapshot())
        del self.history[:-MAX_HISTORY]
        self.redo_stack.clear()

    def _restore(self, snap):
        self.Data = snap['data']
        self.sync_sheet_list(snap['sheet'])
        self.plot_config.forget()
        self.select_sheet(snap['sheet'] if snap['sheet'] in self.Data.get('Core levels', {}) else None,
                          from_user=False)
        self.refresh_tools()

    def undo(self):
        if not self.history:
            return False
        self.redo_stack.append(self._snapshot())
        self._restore(self.history.pop())
        return True

    def redo(self):
        if not self.redo_stack:
            return False
        self.history.append(self._snapshot())
        self._restore(self.redo_stack.pop())
        return True

    # ------------------------------------------------------------ sheets
    def sync_sheet_list(self, keep=None):
        names = self.sheet_names()
        current = keep if keep is not None else self.sheet_combobox.GetValue()
        self.sheet_combobox.Set(names)
        if current in names:
            self.sheet_combobox.SetValue(current)
        elif names:
            self.sheet_combobox.SetValue(names[0])

    def select_sheet(self, name, from_user=True):
        """Sheet_Operations.on_sheet_selected for a technique sheet."""
        names = self.sheet_names()
        if name is None or name not in names:
            name = names[0] if names else ''
        if self.sheet_combobox.FindString(name) == wx.NOT_FOUND and name:
            self.sync_sheet_list(name)
        self.sheet_combobox.SetValue(name)
        if from_user and name:
            self.save_state()
        try:
            from libraries.ToolsMenu.TechniqueTool import technique_of_sheet
            self.technique_tool_spec = technique_of_sheet(self, name)
        except Exception:
            self.technique_tool_spec = None
        try:
            self.populate_peak_grid(name)
        except Exception as e:
            print(f'Peak grid skipped: {e}')
        try:
            from libraries.ViewMenu.TechniqueOverview import set_technique_right_frame
            set_technique_right_frame(self, name)
        except Exception as e:  # never blocks selecting a sheet (as the desktop)
            print(f'Technique shell update skipped: {e}')
        self.plot_data()
        self.show_hide_vlines()

    def refresh_tools(self):
        """Let the open tool windows pick up a new project or an undo."""
        from ktech.techniques import WINDOW_LISTS
        for attr in WINDOW_LISTS:
            for win in list(getattr(self, attr, None) or []):
                for name in ('refresh_sheet_lists', 'refresh_sheet_list'):
                    fn = getattr(win, name, None)
                    if fn and win:
                        try:
                            fn()
                        except Exception as e:
                            print(f'{type(win).__name__}.{name}: {e}')
                        break
                if hasattr(win, 'load_sheet_into_ui'):
                    try:
                        win.load_sheet_into_ui()
                    except Exception as e:
                        print(f'load_sheet_into_ui: {e}')

    # ------------------------------------------------------------ the red lines
    def range_active(self):
        """MyFrame.show_hide_vlines: the tool windows that own the red lines (UV-Vis: on a Tauc sheet)."""
        if any(getattr(self, a, None) is not None for a in RANGE_ATTRS):
            return True
        if getattr(self, 'uvvis_analysis_window', None) is not None:
            try:
                from libraries.ToolsMenu.UVVIS_Analysis import uvvis_range_active
                return bool(uvvis_range_active(self))
            except Exception:
                return False
        return False

    def show_hide_vlines(self):
        visible = self.range_active()
        for line in (self.vline1, self.vline2):
            if line is not None:
                line.set_visible(visible)
        self.canvas.draw_idle()

    def update_vline_text_labels(self):
        pass

    def update_fitting_screen_range_controls(self):
        pass

    def update_area_screen_range_controls(self):
        pass

    def add_averaging_indicator_lines(self):
        pass

    def vline_moved(self, which, x, final=False):
        """On_Mouse_Defs.on_motion / on_release for vline1 / vline2."""
        line = self.vline1 if which == 1 else self.vline2
        sheet_name = self.sheet_combobox.GetValue()
        cl = self.Data.get('Core levels', {}).get(sheet_name)
        if line is None or not isinstance(cl, dict):
            return
        x = float(x)
        line.set_xdata([x])
        bg = cl.setdefault('Background', {})
        bg['Bkg Low' if which == 1 else 'Bkg High'] = x
        try:
            low, high = float(bg['Bkg Low']), float(bg['Bkg High'])
            bg['Bkg Low'], bg['Bkg High'] = min(low, high), max(low, high)
        except (KeyError, TypeError, ValueError):
            pass
        if self.background_method:
            bg['Bkg Type'] = self.background_method
        for attr in ('squid_analysis_window', 'tga_analysis_window', 'eis_analysis_window', 'uvvis_analysis_window'):
            win = getattr(self, attr, None)
            if win is None:
                continue
            for name in ('update_range_from_vlines', 'update_range_controls'):
                fn = getattr(win, name, None)
                if fn:
                    try:
                        fn()
                    except RuntimeError:
                        setattr(self, attr, None)
                    break
        if final:
            self.save_state()
        self.canvas.draw_idle()

    def vline_positions(self):
        out = {}
        for i, line in ((1, self.vline1), (2, self.vline2)):
            if line is not None and line in self.ax.lines and line.get_visible():
                x = line.get_xdata()
                if len(x):
                    out[i] = float(x[0])
        return out

    # ------------------------------------------------------------ the plot
    def plot_data(self):
        """PlotManager.plot_data (a sheet just selected): clear_and_replot plus the FTIR overlays."""
        self.clear_and_replot(initial=True)

    def clear_and_replot(self, initial=False):
        """PlotManager.clear_and_replot, the path a technique sheet takes."""
        from libraries.Plot_Operations import axis_labels_for_sheet, is_optical_sheet
        from libraries.PlotLabelEdit import legend_frame_kwargs
        from libraries.ViewMenu.Labels_Screen import _draw_label_data_on_ax, _remove_all_drawing_artists

        sheet_name = self.sheet_combobox.GetValue()
        ax = self.ax
        for extra in [a for a in self.figure.axes if a is not ax]:
            self.figure.delaxes(extra)
        self.tga_axes = []
        self.ax_dsc = self.ax_dtg = None
        ax.patch.set_visible(True)
        if not sheet_name or sheet_name not in self.Data.get('Core levels', {}):
            ax.clear()
            ax.set_position([0.1, 0.1, 0.85, 0.85])
            self.canvas.draw_idle()
            return
        cl = self.Data['Core levels'][sheet_name]
        limits = self.plot_config.get_plot_limits(self, sheet_name) or {}
        upper = sheet_name.upper()
        is_tga = upper.startswith('TGA')
        is_ftir = upper.startswith('FTIR')
        is_optical = is_optical_sheet(sheet_name)

        ax.clear()
        ax.set_position([0.1, 0.1, 0.85, 0.85])
        x_label, y_label = axis_labels_for_sheet(self, sheet_name)
        if is_tga:
            x_label, y_label = cl.get('TGA_X_Label', "Temperature (°C)"), cl.get('TGA_Y_Label', "Mass (mg)")
        ax.set_xlabel(x_label)
        ax.set_ylabel(y_label)
        if is_ftir or is_tga or upper.startswith(('EIS', 'UVVIS', 'ELLIPS', 'BET')):
            ax.ticklabel_format(style='plain', axis='y')
        else:
            ax.ticklabel_format(style='sci', axis='y', scilimits=(0, 0))

        x_values = np.asarray(cl.get('B.E.', []), dtype=float)
        y_values = np.asarray(cl.get('Raw Data', []), dtype=float)
        if limits:
            if is_ftir:   # FTIR is reversed like XPS (high wavenumber on the left)
                ax.set_xlim(limits['Xmax'], limits['Xmin'])
            else:
                ax.set_xlim(limits['Xmin'], limits['Xmax'])
            ax.set_ylim(limits['Ymin'], limits['Ymax'])

        bg = cl.get('Background') or {}
        if bg.get('Bkg Type') not in ("", "None", None) and bg.get('Bkg Low') != "" and bg.get('Bkg High') != "":
            bg_y = np.asarray(bg.get('Bkg Y', []), dtype=float)
            if bg_y.size == x_values.size and bg_y.size:
                regions = []
                for r in bg.get('Recorded_Ranges') or []:
                    if len(r) >= 4:
                        try:
                            regions.append((min(float(r[2]), float(r[3])), max(float(r[2]), float(r[3]))))
                        except (TypeError, ValueError):
                            pass
                if regions:
                    mask = np.zeros(x_values.size, dtype=bool)
                    for lo, hi in regions:
                        mask |= (x_values >= lo) & (x_values <= hi)
                    bg_y = np.where(mask, bg_y, np.nan)
                ax.plot(x_values, bg_y, color=self.background_color, linestyle=self.background_linestyle,
                        alpha=self.background_alpha, label='Background', linewidth=self.background_thickness)

        label = self.plot_manager.raw_trace_label(self, sheet_name)
        if self.plot_style == "scatter" and not is_ftir and not is_optical:
            colour = self.plot_manager.raw_trace_colour(self, sheet_name, self.scatter_color)
            ax.scatter(x_values, y_values, c=colour, s=self.scatter_size, marker=self.scatter_marker, label=label)
        else:
            colour = self.plot_manager.raw_trace_colour(self, sheet_name, self.line_color)
            ax.plot(x_values, y_values, c=colour, linewidth=self.line_width, alpha=self.line_alpha,
                    linestyle=self.raw_data_linestyle, label=label)
        if is_ftir and initial:
            # PlotManager.plot_data: the FTIR non-destructive layers (raw trace, baseline…)
            from libraries.Plot_Operations import _plot_ftir_overlays
            _plot_ftir_overlays(ax, cl)
        for spine in ax.spines.values():
            spine.set_linewidth(1)

        if self.legend_visible:
            handles, _labels = ax.get_legend_handles_labels()
            if handles:
                ax.legend(loc='upper left', **legend_frame_kwargs(self))
        if 'Labels' in cl:
            _remove_all_drawing_artists(ax)
            for label_data in cl['Labels']:
                if label_data.get('text') == 'Table' and label_data.get('is_table'):
                    continue
                try:
                    _draw_label_data_on_ax(ax, label_data, self.label_font_size, self)
                except Exception as e:
                    print(f'Label skipped: {e}')
        if self.y_axis_state == 1:
            ax.yaxis.set_visible(False)
        elif self.y_axis_state == 2:
            ax.set_ylabel("Intensity (a.u.)")
        ax.set_position([0.1, 0.1, 0.85, 0.85])

        for target in self.tech.get('extras', []):
            module, _, fn = target.partition(':')
            try:
                getattr(importlib.import_module(module), fn)(self, sheet_name)
            except Exception as e:
                print(f'{target} skipped: {e}')
        self.canvas.draw_idle()

    def replot(self):
        self.clear_and_replot()

    # ------------------------------------------------------------ odds the tools call
    def update_checkboxes_from_data(self):
        pass

    def load_be_correction(self):
        pass

    def open_labels_window(self, *a):
        pass

    def SetFocus(self):
        pass
