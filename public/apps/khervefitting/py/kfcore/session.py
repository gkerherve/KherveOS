# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial

#
# KherveOS port: the state of one KherveFitting window, without wx.
#
# Session stands in for the desktop's main frame (KherveFitting.py MyFrame):
# fit_peaks and the background code take it as `window`. The methods below
# the marked line are copied from MyFrame unchanged.

import re

import numpy as np
import lmfit

from .backgrounds import AtomicConcentrations
from .compat import trapz
from .grid import Grid, SheetBox
from .peak_functions import PeakFunctions


class FittingOptions:
    """The fitting window's choices that fit_peaks reads (Fitting_Screen.py)."""

    def __init__(self, session):
        self.session = session
        # The desktop selects "least_squares" (index 1) and "uniform".
        self.optimization_method = "least_squares"
        self.weights_method = "uniform"

    def get_optimization_method(self):
        return self.optimization_method.split()[0]

    def get_weights_method(self):
        return self.weights_method

    def get_recorded_ranges_from_data(self):
        s = self.session
        name = s.sheet_combobox.GetValue()
        cl = s.Data['Core levels'].get(name, {})
        return cl.get('Background', {}).get('Recorded_Ranges', []) or []

    def get_overall_background_range(self):
        """Lowest and highest energy of all recorded background regions."""
        ranges = self.get_recorded_ranges_from_data()
        if not ranges:
            s = self.session
            if s.vlines is not None:
                return min(s.vlines), max(s.vlines)
            return s.bg_min_energy, s.bg_max_energy
        all_mins = [r[2] for r in ranges]
        all_maxs = [r[3] for r in ranges]
        return min(all_mins), max(all_maxs)


def empty_data():
    """Init_Measurement_Data (ConfigFile.py)."""
    data = {'FilePath': '', 'Number of Core levels': 0, 'Core levels': {}}
    for i in range(10):
        data[f'Results Table{i}'] = {'Peak': {}}
    return data


class Session:
    """One open workbook: the Data dictionary plus the window's settings."""

    def __init__(self):
        self.Data = empty_data()
        self.sheet_combobox = SheetBox()
        self.peak_params_grid = Grid()
        self.fitting_window = FittingOptions(self)
        # Defaults from KherveFitting.py / Fitting_Screen.py
        self.photons = 1486.67
        self.workfunction = 0
        self.max_iterations = 200
        self.selected_fitting_method = "SGL (Area)"
        self.background_method = "Smart"
        self.offset_h = 0
        self.offset_l = 0
        self.averaging_points = 5
        self.current_instrument = "A-ALTHERMO1"
        self.library_type = "TPP-2M"
        self.use_angular_correction = False
        self.analysis_angle = 54.7
        self.library_data = {}
        # Per-sheet view state
        self.bg_min_energy = None
        self.bg_max_energy = None
        self.vlines = None          # (low, high) background limits being edited
        self.peak_count = 0
        self.selected_peak_index = None
        self.fit_results = None
        self.r_squared = None
        self.x_values = np.array([])
        self.y_values = np.array([])
        self.background = np.array([])
        self.actual_fwhms = {}

    # Small pieces of MyFrame that only touch state.
    def show_hide_vlines(self):
        pass

    def clear_and_replot(self):
        pass

    def load_view(self):
        """x, y and background arrays of the current sheet."""
        name = self.sheet_combobox.GetValue()
        cl = self.Data['Core levels'].get(name)
        if not cl or 'B.E.' not in cl:
            self.x_values = self.y_values = self.background = np.array([])
            return
        self.x_values = np.array(cl['B.E.'], dtype=float)
        self.y_values = np.array(cl['Raw Data'], dtype=float)
        bkg = cl.get('Background', {}).get('Bkg Y') or cl['Raw Data']
        self.background = np.array(bkg, dtype=float)

    # ------------------------------------------------------------------
    # Copied from KherveFitting.py (MyFrame), unchanged below this line.
    # ------------------------------------------------------------------

    def get_linked_peaks(self, peak_index):
        linked_peaks = []
        row = peak_index * 2
        for i in range(self.peak_params_grid.GetNumberRows() // 2):
            constraint_row = i * 2 + 1
            position_constraint = self.peak_params_grid.GetCellValue(constraint_row, 2)
            if position_constraint.startswith(chr(65 + peak_index)):
                linked_peaks.append(i)
        return linked_peaks


    def update_linked_peak(self, peak_index, new_x, new_height, area=None, original_peak_index=None):
        row = peak_index * 2
        constraint_row = row + 1
        position_constraint = self.peak_params_grid.GetCellValue(constraint_row, 2)
        height_constraint = self.peak_params_grid.GetCellValue(constraint_row, 3)
        area_constraint = self.peak_params_grid.GetCellValue(constraint_row, 6)

        sheet_name = self.sheet_combobox.GetValue()
        peak_label = self.peak_params_grid.GetCellValue(row, 1)
        peaks = self.Data['Core levels'][sheet_name]['Fitting']['Peaks']
        fitting_model = self.peak_params_grid.GetCellValue(row, 13)

        original_peak_letter = chr(65 + original_peak_index)

        # EXISTING CODE - Update position if constrained (same as original)
        if position_constraint.startswith(original_peak_letter):
            if '+' in position_constraint:
                offset = float(position_constraint.split('+')[1].split('#')[0])
                new_position = new_x + offset
            elif '-' in position_constraint:
                offset = float(position_constraint.split('-')[1].split('#')[0])
                new_position = new_x - offset
            elif '*' in position_constraint:
                factor = float(position_constraint.split('*')[1].split('#')[0])
                new_position = new_x * factor
            elif '/' in position_constraint:
                factor = float(position_constraint.split('/')[1].split('#')[0])
                new_position = new_x / factor
            else:
                new_position = new_x

            self.peak_params_grid.SetCellValue(row, 2, f"{new_position:.2f}")
            if peak_label in peaks:
                peaks[peak_label]['Position'] = new_position

        # NEW CODE - Handle cross-core-level position constraints
        elif '_' in position_constraint:
            new_position = self.evaluate_cross_core_constraint(position_constraint, 'Position')
            if new_position is not None:
                self.peak_params_grid.SetCellValue(row, 2, f"{new_position:.2f}")
                if peak_label in peaks:
                    peaks[peak_label]['Position'] = new_position

        # EXISTING CODE - Area constraints
        if (("LA" in fitting_model or "GL (Area)" in fitting_model or "Voigt" in fitting_model or "ExpGauss" in
             fitting_model) or "DS" in fitting_model) and area_constraint.startswith(
            original_peak_letter):
            current_area = float(self.peak_params_grid.GetCellValue(original_peak_index * 2, 6))
            if '*' in area_constraint:
                factor = float(area_constraint.split('*')[1].split('#')[0])
                new_linked_area = current_area * factor
            elif '/' in area_constraint:
                factor = float(area_constraint.split('/')[1].split('#')[0])
                new_linked_area = current_area / factor
            elif '+' in area_constraint:
                offset = float(area_constraint.split('+')[1].split('#')[0])
                new_linked_area = current_area + offset
            elif '-' in area_constraint:
                offset = float(area_constraint.split('-')[1].split('#')[0])
                new_linked_area = current_area - offset
            else:
                new_linked_area = current_area

            self.peak_params_grid.SetCellValue(row, 6, f"{new_linked_area:.2f}")

            # Recalculate height from area
            fwhm = float(self.peak_params_grid.GetCellValue(row, 4))
            new_linked_height = self.calculate_height_from_area(new_linked_area, fwhm, fitting_model, row)
            self.peak_params_grid.SetCellValue(row, 3, f"{new_linked_height:.2f}")

            if peak_label in peaks:
                peaks[peak_label]['Area'] = new_linked_area
                peaks[peak_label]['Height'] = new_linked_height

        # NEW CODE - Handle cross-core-level area constraints
        elif (("LA" in fitting_model or "GL (Area)" in fitting_model or "Voigt" in fitting_model or "ExpGauss" in
               fitting_model) or "DS" in fitting_model) and '_' in area_constraint:
            new_linked_area = self.evaluate_cross_core_constraint(area_constraint, 'Area')
            if new_linked_area is not None:
                self.peak_params_grid.SetCellValue(row, 6, f"{new_linked_area:.2f}")

                # Recalculate height from area
                fwhm = float(self.peak_params_grid.GetCellValue(row, 4))
                new_linked_height = self.calculate_height_from_area(new_linked_area, fwhm, fitting_model, row)
                self.peak_params_grid.SetCellValue(row, 3, f"{new_linked_height:.2f}")

                if peak_label in peaks:
                    peaks[peak_label]['Area'] = new_linked_area
                    peaks[peak_label]['Height'] = new_linked_height

        # EXISTING CODE - Height constraints
        elif height_constraint.startswith(original_peak_letter):
            # Check if model uses height as primary parameter
            height_based_models = ["GL (Height)", "SGL (Height)", "D-parameter", "Fermi"]

            if fitting_model in height_based_models:
                # Only update height for height-based models
                if '*' in height_constraint:
                    factor = float(height_constraint.split('*')[1].split('#')[0])
                    new_linked_height = new_height * factor
                elif '/' in height_constraint:
                    factor = float(height_constraint.split('/')[1].split('#')[0])
                    new_linked_height = new_height / factor
                elif '+' in height_constraint:
                    offset = float(height_constraint.split('+')[1].split('#')[0])
                    new_linked_height = new_height + offset
                elif '-' in height_constraint:
                    offset = float(height_constraint.split('-')[1].split('#')[0])
                    new_linked_height = new_height - offset
                else:
                    new_linked_height = new_height

                self.peak_params_grid.SetCellValue(row, 3, f"{new_linked_height:.2f}")
                if peak_label in peaks:
                    peaks[peak_label]['Height'] = new_linked_height

        # NEW CODE - Handle cross-core-level height constraints
        elif '_' in height_constraint:
            height_based_models = ["GL (Height)", "SGL (Height)", "D-parameter", "Fermi"]
            if fitting_model in height_based_models:
                new_linked_height = self.evaluate_cross_core_constraint(height_constraint, 'Height')
                if new_linked_height is not None:
                    self.peak_params_grid.SetCellValue(row, 3, f"{new_linked_height:.2f}")
                    if peak_label in peaks:
                        peaks[peak_label]['Height'] = new_linked_height

        # EXISTING CODE - Recalculate area if not LA model
        # if not "LA" in fitting_model:
        if not (
                "LA" in fitting_model or "GL (Area)" in fitting_model or "Voigt" in fitting_model or "ExpGauss" in fitting_model) and area_constraint.startswith(
                original_peak_letter):
            self.recalculate_peak_area(peak_index)

        # NEW CODE - Recalculate area for cross-core-level constraints
        elif not (
                "LA" in fitting_model or "GL (Area)" in fitting_model or "Voigt" in fitting_model or "ExpGauss" in fitting_model) and '_' in area_constraint:
            self.recalculate_peak_area(peak_index)


    def get_cross_core_level_value(self, core_level_ref, param_type):
        """Get parameter value from another core level"""
        try:
            if '_' not in core_level_ref:
                return None

            core_level_name, peak_letter = core_level_ref.split('_', 1)
            peak_index = ord(peak_letter) - ord('A')

            if core_level_name not in self.Data['Core levels']:
                return None

            core_level_data = self.Data['Core levels'][core_level_name]

            if 'Fitting' not in core_level_data or 'Peaks' not in core_level_data['Fitting']:
                return None

            peaks = core_level_data['Fitting']['Peaks']
            peak_keys = list(peaks.keys())

            if peak_index >= len(peak_keys):
                return None

            peak_key = peak_keys[peak_index]
            peak_data = peaks[peak_key]

            # ADD THIS MAPPING - same as Functions.py version
            param_map = {
                'center': 'Position', 'Position': 'Position',
                'height': 'Height', 'Height': 'Height',
                'area': 'Area', 'Area': 'Area',
                'fwhm': 'FWHM', 'FWHM': 'FWHM',
                'sigma': 'Sigma', 'Sigma': 'Sigma',
                'gamma': 'Gamma', 'Gamma': 'Gamma',
                'skew': 'Skew', 'Skew': 'Skew'
            }

            actual_param = param_map.get(param_type, param_type)
            if actual_param in peak_data:
                return float(peak_data[actual_param])

            return None

        except (ValueError, IndexError, KeyError):
            return None

    def evaluate_cross_core_constraint(self, constraint_str, param_type):
        """Evaluate constraints that reference other core levels"""
        import re

        pattern = r'^([^_]+_[A-Z])([+\-*/])([0-9]*\.?[0-9]+)(?:#([0-9]*\.?[0-9]+))?$'
        match = re.match(pattern, constraint_str)

        if not match:
            return None

        core_level_ref, operator, value_str, error_str = match.groups()
        value = float(value_str)

        ref_value = self.get_cross_core_level_value(core_level_ref, param_type)
        if ref_value is None:
            return None

        if operator == '*':
            return ref_value * value
        elif operator == '/':
            return ref_value / value if value != 0 else ref_value
        elif operator == '+':
            return ref_value + value
        elif operator == '-':
            return ref_value - value

        return None


    def calculate_height_from_area(self, area, fwhm, model, row=None):
        if model in ["Voigt (Area, L/G, \u03c3)", "Voigt (Area, \u03c3, \u03b3)"]:
            # For Voigt, this is an approximation
            return area / (fwhm * np.sqrt(np.pi / (4 * np.log(2))))
        elif model in ["Voigt (Area, L/G, \u03c3, S)"]:
            if row is None:
                raise ValueError("Row must be provided for Skewed Voigt model")
            center = float(self.peak_params_grid.GetCellValue(row, 2))
            sigma = float(self.peak_params_grid.GetCellValue(row, 7)) / 2.355
            gamma = float(self.peak_params_grid.GetCellValue(row, 8)) / 2
            skew = float(self.peak_params_grid.GetCellValue(row, 9))

            height = PeakFunctions.get_skewedvoigt_height(area, sigma, gamma, skew)
            return height
        elif model == "DS*G (A, \u03c3, \u03b3, S)":
            if row is None:
                raise ValueError("Row must be provided for DS*G model")
            center = float(self.peak_params_grid.GetCellValue(row, 2))
            sigma = float(self.peak_params_grid.GetCellValue(row, 7))
            gamma = float(self.peak_params_grid.GetCellValue(row, 8))
            skew = float(self.peak_params_grid.GetCellValue(row, 9))

            # Calculate height numerically for DS*G model
            x_range = np.linspace(center - 5 * fwhm, center + 5 * fwhm, 1000)
            y_values = PeakFunctions.DS_G(x_range, center, area, gamma, skew, sigma)
            height = np.max(y_values)
            return height
        elif model == "DS (A, \u03c3, \u03b3)":
            if row is None:
                raise ValueError("Row must be provided for DS model")
            center = float(self.peak_params_grid.GetCellValue(row, 2))
            sigma = float(self.peak_params_grid.GetCellValue(row, 7))
            gamma = float(self.peak_params_grid.GetCellValue(row, 8))
            skew = float(self.peak_params_grid.GetCellValue(row, 9))

            # Create DS model instance
            model = lmfit.models.DoniachModel()

            # Calculate amplitude from area for DS model
            amplitude = PeakFunctions.doniach_sunjic_area_to_amplitude(area, sigma, gamma, skew)

            # Calculate height numerically for DS model
            x_range = np.linspace(center - 5 * fwhm, center + 5 * fwhm, 1000)
            y_values = model.eval(x=x_range, amplitude=amplitude, center=center,
                                  sigma=sigma, gamma=gamma, asymmetry=skew)
            height = np.max(y_values)
            return height
        elif model == "ExpGauss.(Area, \u03c3, \u03b3)":
            if row is None:
                raise ValueError("Row must be provided for ExpGauss model")
            center = float(self.peak_params_grid.GetCellValue(row, 2))
            sigma = float(self.peak_params_grid.GetCellValue(row, 7))
            gamma = float(self.peak_params_grid.GetCellValue(row, 8))

            # Create model instance first
            exp_gauss_model = lmfit.models.ExponentialGaussianModel()

            # Then evaluate with parameters
            x_range = np.linspace(center - 10 * sigma, center + 10 * sigma, 1000)
            y_values = exp_gauss_model.eval(x=x_range, amplitude=area, center=center, sigma=sigma, gamma=gamma)
            height = np.max(y_values)
            return height

        elif model == "Pseudo-Voigt (Area)":
            # For Pseudo-Voigt, use the linked peak's parameters
            if row is None:
                return area / (fwhm * np.pi / 2)  # Default approximation
            sigma = fwhm / 2
            fraction = float(self.peak_params_grid.GetCellValue(row, 5)) / 100  # Get L/G ratio of linked peak

            # Calculate proper height using pseudo-voigt formula with correct parameters
            return PeakFunctions.get_pseudo_voigt_height(area, sigma, fraction)

        elif model in ["LA (Area, \u03c3, \u03b3)", "LA (Area, \u03c3/\u03b3, \u03b3)"]:
            if row is None:
                raise ValueError("Row must be provided for LA model")
            center = float(self.peak_params_grid.GetCellValue(row, 2))
            sigma = float(self.peak_params_grid.GetCellValue(row, 7))
            gamma = float(self.peak_params_grid.GetCellValue(row, 8))

            # Calculate height numerically
            x_range = np.linspace(center - 5 * fwhm, center + 5 * fwhm, 1000)
            y_values = PeakFunctions.LA(x_range, center, area, fwhm, sigma, gamma)
            height = np.max(y_values)
            return height
        elif model in ["LA*G (Area, \u03c3/\u03b3, \u03b3)"]:
            if row is None:
                raise ValueError("Row must be provided for LA model")
            center = float(self.peak_params_grid.GetCellValue(row, 2))
            sigma = float(self.peak_params_grid.GetCellValue(row, 7))
            gamma = float(self.peak_params_grid.GetCellValue(row, 8))
            skew = float(self.peak_params_grid.GetCellValue(row, 9))

            # Calculate height numerically
            x_range = np.linspace(center - 5 * fwhm, center + 5 * fwhm, 1000)
            y_values = PeakFunctions.LAxG(x_range, center, area, fwhm, sigma, gamma, skew)
            height = np.max(y_values)
            return height

        elif model in ["GL (Area)", "GL (Height)", "SGL (Height)"]:
            return area / (fwhm * np.sqrt(np.pi / (4 * np.log(2))))
        elif model in ["SGL (Area)"]:
            if row is None:
                raise ValueError("Row must be provided for SGL model")
            fraction = float(self.peak_params_grid.GetCellValue(row, 5))
            sigma = fwhm / (2 * np.sqrt(2 * np.log(2)))
            gamma = fwhm / 2
            return area / ((1 - fraction / 100) * sigma * np.sqrt(2 * np.pi) + (fraction / 100) * np.pi * gamma)
        elif model in ["D-parameter", "Fermi"]:
            # D-parameter doesn't have an area
            return 0.0

        else:  # GL, SGL, or other models
            return area / (fwhm * np.sqrt(np.pi / (4 * np.log(2))))





    def update_linked_peaks_recursive(self, original_peak_index, new_x, new_height, area=None, visited=None):
        if visited is None:
            visited = set()

        if original_peak_index in visited:
            return

        visited.add(original_peak_index)

        linked_peaks = self.get_linked_peaks(original_peak_index)
        for linked_peak in linked_peaks:
            if linked_peak not in visited:
                if area is not None:
                    self.update_linked_peak(linked_peak, new_x, new_height, area, original_peak_index)
                else:
                    self.update_linked_peak(linked_peak, new_x, new_height, None, original_peak_index)

                linked_x = float(self.peak_params_grid.GetCellValue(linked_peak * 2, 2))
                linked_height = float(self.peak_params_grid.GetCellValue(linked_peak * 2, 3))
                linked_area = float(
                    self.peak_params_grid.GetCellValue(linked_peak * 2, 6)) if area is not None else None

                self.update_linked_peaks_recursive(linked_peak, linked_x, linked_height, linked_area, visited)


    def recalculate_peak_area(self, peak_index):
        row = peak_index * 2
        sheet_name = self.sheet_combobox.GetValue()
        peak_label = self.peak_params_grid.GetCellValue(row, 1)

        height = float(self.peak_params_grid.GetCellValue(row, 3))
        fwhm = float(self.peak_params_grid.GetCellValue(row, 4))
        fraction = float(self.peak_params_grid.GetCellValue(row, 5))
        model = self.peak_params_grid.GetCellValue(row, 13)

        if model == "SingleEntity":
            # For SingleEntity: Area = Original_Area * scale_factor (Gamma)
            scale_factor = float(self.peak_params_grid.GetCellValue(row, 8))  # Gamma = scale

            # Get original area from peak data
            if sheet_name in self.Data['Core levels'] and 'Fitting' in self.Data['Core levels'][sheet_name]:
                peaks_dict = self.Data['Core levels'][sheet_name]['Fitting']['Peaks']
                if peak_label in peaks_dict:
                    peak_data = peaks_dict[peak_label]
                    original_area = peak_data.get('Original_Area', peak_data.get('Area', 0))
                    area = original_area * scale_factor
                else:
                    area = 0
            else:
                area = 0
        elif model in ["Voigt (Area, L/G, σ)", "Voigt (Area, σ, γ)", "ExpGauss.(Area, σ, γ)",
                       "LA (Area, σ, γ)", "LA (Area, σ/γ, γ)", "LA*G (Area, σ/γ, "
                                                               "γ)", "Voigt (Area, L/G, σ, S)", "DS (A, σ, γ)", "DS*G (A, σ, "
                                                                                                                "γ, S)"]:
            sigma = float(self.peak_params_grid.GetCellValue(row, 7))
            gamma = float(self.peak_params_grid.GetCellValue(row, 8))
            skew = float(self.peak_params_grid.GetCellValue(row, 9))
            area = self.calculate_peak_area(model, height, fwhm, fraction, sigma, gamma, skew)
        elif model in ["D-parameter", " Fermi"]:
            return
        else:
            area = self.calculate_peak_area(model, height, fwhm, fraction)

        self.peak_params_grid.SetCellValue(row, 6, f"{area:.2f}")

        # Update area in self.Data
        if sheet_name in self.Data['Core levels'] and 'Fitting' in self.Data['Core levels'][sheet_name] and 'Peaks' in \
                self.Data['Core levels'][sheet_name]['Fitting']:
            if peak_label in self.Data['Core levels'][sheet_name]['Fitting']['Peaks']:
                self.Data['Core levels'][sheet_name]['Fitting']['Peaks'][peak_label]['Area'] = area

        return area



    def calculate_peak_area(self, model, height, fwhm, fraction, sigma=None, gamma=None, skew=None):
        if model in ["Voigt (Area, L/G, \u03c3)", "Voigt (Area, \u03c3, \u03b3)"]:#, "Voigt (Area, L/G, \u03c3, S)"]:
            if sigma is None or gamma is None:
                raise ValueError("Sigma and gamma are required for Voigt models")
            area = PeakFunctions.voigt_height_to_area(height, sigma / 2.355, gamma / 2)
        elif model == "Voigt (Area, L/G, \u03c3, S)":
            # Set default values if parameters are missing
            sigma = sigma or 0.5
            gamma = gamma or 0.5
            skew = skew or 0.1
            if sigma is None or gamma is None:
                raise ValueError("Sigma and gamma are required for Voigt models")
            area = PeakFunctions.skewedvoigt_height_to_area(height, sigma / 2.355, gamma / 2, skew)
        elif model == "DS (A, \u03c3, \u03b3)":
            # Set default values if parameters are missing
            sigma = sigma or 1.0
            gamma = gamma or 0.0
            skew = skew or 0.0
            if sigma is None or gamma is None:
                raise ValueError("Sigma and gamma are required for DS models")
            # height_test = PeakFunctions.get_doniach_sunjic_height(area, sigma,gamma,skew)
            area = PeakFunctions.doniach_sunjic_height_to_area(height, sigma, gamma, skew)
        elif model == "DS*G (A, \u03c3, \u03b3, S)":
            # Create x_range centered around 0 for area calculation
            x_range = np.linspace(-10 * fwhm, 10 * fwhm, 1000)
            # Use position=0 since we only need the shape
            y_values = PeakFunctions.DS_G(x_range, 0, 1.0, gamma, skew, sigma)
            max_height = np.max(y_values)
            area = height / max_height if max_height > 0 else 0
            return area
        elif model in ["Pseudo-Voigt (Area)"]:#, "SGL (Area)"]:
            sigma = fwhm / 2
            amplitude = height / PeakFunctions.get_pseudo_voigt_height(1, sigma, fraction)
            area = amplitude
        elif model in ["GL (Height)", "SGL (Height)", "Unfitted"]:
            area = height * fwhm * np.sqrt(np.pi / (4 * np.log(2)))
        elif model in ["GL (Area)"]: #, "SGL (Area)"]:
            area = height * fwhm * np.sqrt(np.pi / (4 * np.log(2)))
        elif model in ["SGL (Area)"]:
            sigma = fwhm / (2 * np.sqrt(2 * np.log(2)))
            gamma = fwhm / 2
            area = height * ((1 - fraction / 100) * sigma * np.sqrt(2 * np.pi) + (fraction / 100) * np.pi * gamma)
        elif model == "ExpGauss.(Area, \u03c3, \u03b3)":
            area = height * sigma * np.sqrt(2 * np.pi) * np.exp(gamma ** 2 * sigma ** 2 / 4)
        elif model in ["LA (Area, \u03c3, \u03b3)", "LA (Area, \u03c3/\u03b3, \u03b3)"]:
            if sigma is None or gamma is None:
                raise ValueError("Sigma and gamma are required for LA model")

            x_range = np.linspace(-10 * fwhm, 10 * fwhm, 1000)
            y_temp = PeakFunctions.LA(x_range, 0, 1.0, fwhm, sigma, gamma)  # Use unit amplitude
            max_height = np.max(y_temp)
            y_values = PeakFunctions.LA(x_range, 0, height / max_height, fwhm, sigma, gamma)
            area = trapz(y_values, x_range)
            return round(area, 2)
        elif model in ["LA*G (Area, \u03c3/\u03b3, \u03b3)"]:
            if sigma is None or gamma is None or skew is None:
                raise ValueError("Sigma, gamma and skew are required for LA*G model")

            x_range = np.linspace(-10 * fwhm, 10 * fwhm, 1000)
            y_temp = PeakFunctions.LAxG(x_range, 0, 1.0, fwhm, sigma, gamma, skew)  # Use unit amplitude
            max_height = np.max(y_temp)
            y_values = PeakFunctions.LAxG(x_range, 0, height / max_height, fwhm, sigma, gamma, skew)
            area = trapz(y_values, x_range)
            return round(area, 2)
        elif model =="D-parameter":
            return
        elif model =="Fermi":
            return
        else:
            raise ValueError(f"Unknown fitting model: {model}")
        return round(area, 2)


    def update_ratios(self):
        # Check if library data is available
        if not hasattr(self, 'library_data') or not self.library_data:
            self._update_ratios_simple()
            return

        num_peaks = self.peak_params_grid.GetNumberRows() // 2
        if num_peaks < 1:
            return

        # Calculate normalized areas using same method as results grid
        total_normalized_area = 0
        normalized_areas = []

        for i in range(num_peaks):
            row = i * 2
            try:
                peak_name = self.peak_params_grid.GetCellValue(row, 1)
                position = float(self.peak_params_grid.GetCellValue(row, 2))
                area = float(self.peak_params_grid.GetCellValue(row, 6))

                # Get RSF value for this peak
                rsf = self.get_rsf_for_peak(peak_name)

                # Calculate kinetic energy
                kinetic_energy = self.photons - position

                # Calculate TXFN (transmission function)
                txfn = self.calculate_transmission_function(kinetic_energy)

                # Calculate ECF based on method selected
                ecf = 1.0  # Default
                if self.library_type == "Scofield":
                    ecf = kinetic_energy ** 0.6
                elif self.library_type == "Wagner":
                    ecf = kinetic_energy ** 1.0
                elif self.library_type == "TPP-2M":
                    imfp = AtomicConcentrations.calculate_imfp_tpp2m(kinetic_energy)
                    ecf = imfp * 26.2
                elif self.library_type == "EAL":
                    z_avg = 50
                    eal = (0.65 + 0.007 * kinetic_energy ** 0.93) / (z_avg ** 0.38)
                    ecf = eal
                elif self.library_type == "None":
                    ecf = 1.0

                # Angular correction
                angular_correction = 1.0
                if self.use_angular_correction:
                    angular_correction = AtomicConcentrations.calculate_angular_correction(
                        self, peak_name, self.analysis_angle
                    )

                # Calculate normalized area with all corrections (RSF, TXFN, ECF, ACF)
                normalized_area = area / (rsf * txfn * ecf * angular_correction)

                total_normalized_area += normalized_area
                normalized_areas.append((i, normalized_area))

            except ValueError:
                normalized_areas.append((i, 0))
                continue

        # Get first peak area for A/Aa ratio calculation
        try:
            first_position = float(self.peak_params_grid.GetCellValue(0, 2))
            first_area = float(self.peak_params_grid.GetCellValue(0, 6))
        except ValueError:
            first_position = 0
            first_area = 1

        # Calculate atomic concentrations and update grid
        for i, normalized_area in normalized_areas:
            row = i * 2
            try:
                position = float(self.peak_params_grid.GetCellValue(row, 2))
                area = float(self.peak_params_grid.GetCellValue(row, 6))

                # Calculate atomic concentration from normalized area
                atomic_concentration = (normalized_area / total_normalized_area * 100) if total_normalized_area > 0 else 0

                # Calculate A/Aa ratio
                a_ratio = area / first_area if first_area != 0 else 0

                # Calculate split
                split = position - first_position

                # Update grid with .2f formatting
                self.peak_params_grid.SetCellValue(row, 10, f"{atomic_concentration:.1f}")
                self.peak_params_grid.SetCellValue(row, 11, f"{a_ratio * 100:.2f}")
                self.peak_params_grid.SetCellValue(row, 12, f"{split:.2f}")

            except ValueError:
                continue



    def get_rsf_for_peak(self, peak_name):
        """Get RSF value for a peak - handles spin-orbit coupling like Sr3d5/2, Sr3d3/2"""
        import re

        # Parse peak name to get element, orbital, and suborbital (e.g., Sr3d5/2)
        match = re.match(r'([A-Z][a-z]*)(\d+[spdf])(?:(\d+/\d+))?(?:\s+.*)?', peak_name)
        if match:
            element, orbital, suborbital = match.groups()

            # If suborbital exists (like 5/2, 3/2), include it in the key
            if suborbital:
                key = (element, orbital + suborbital)  # e.g., ('Sr', '3d5/2')
            else:
                key = (element, orbital)  # e.g., ('C', '1s')

            if key in self.library_data:
                if self.current_instrument in self.library_data[key]:
                    return float(self.library_data[key][self.current_instrument]['rsf'])
                else:
                    # Fallback to first available instrument
                    instruments = list(self.library_data[key].keys())
                    if instruments:
                        return float(self.library_data[key][instruments[0]]['rsf'])
            else:
                # If suborbital search failed, try without suborbital as fallback
                if suborbital:
                    fallback_key = (element, orbital)
                    if fallback_key in self.library_data:
                        if self.current_instrument in self.library_data[fallback_key]:
                            return float(self.library_data[fallback_key][self.current_instrument]['rsf'])
                        else:
                            instruments = list(self.library_data[fallback_key].keys())
                            if instruments:
                                return float(self.library_data[fallback_key][instruments[0]]['rsf'])

        return 1.0  # Default RSF



    def _update_ratios_simple(self):
        """Fallback method using simple area calculation"""
        num_peaks = self.peak_params_grid.GetNumberRows() // 2
        if num_peaks < 1:
            return

        # Calculate total area for concentrations
        total_area = 0
        for i in range(num_peaks):
            row = i * 2
            try:
                area = float(self.peak_params_grid.GetCellValue(row, 6))
                total_area += area
            except ValueError:
                continue

        # Get first peak area for A/Aa ratio calculation
        try:
            first_position = float(self.peak_params_grid.GetCellValue(0, 2))
            first_area = float(self.peak_params_grid.GetCellValue(0, 6))
        except ValueError:
            return

        for i in range(num_peaks):
            row = i * 2
            try:
                position = float(self.peak_params_grid.GetCellValue(row, 2))
                area = float(self.peak_params_grid.GetCellValue(row, 6))

                # Calculate concentration from area (simple method)
                concentration = (area / total_area * 100) if total_area > 0 else 0

                # Calculate A/Aa ratio
                a_ratio = area / first_area if first_area != 0 else 0

                split = position - first_position

                # Update grid
                self.peak_params_grid.SetCellValue(row, 10, f"{concentration:.2f}")
                self.peak_params_grid.SetCellValue(row, 11, f"{a_ratio * 100:.2f}")
                self.peak_params_grid.SetCellValue(row, 12, f"{split:.2f}")

            except ValueError:
                continue


    def calculate_transmission_function(self, kinetic_energy):
        """Calculate transmission function from kinetic energy"""
        # Standard transmission function calculation for XPS
        a, b, c = 31.826, 0.229, 0.5  # Default coefficients

        if kinetic_energy > 0:
            txfn = a + b * (kinetic_energy ** -c)
            # return max(txfn, 0.1)  # Ensure positive value
            return 1.0
        else:
            return 1.0



    def try_float(self, value, default=0.0):
        try:
            return float(value)
        except ValueError:
            return default



