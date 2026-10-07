# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial

#
# KherveOS port: libraries/Peak_Functions.py (KherveFitting, develop),
# the BackgroundCalculations and AtomicConcentrations classes, unchanged
# except: np.trapz comes from .compat, and shirley_calculate is the copy
# of lmfitxps's in .shirley (so lmfitxps need not be installed).

import numpy as np
import lmfit
from scipy.signal import savgol_filter

from .compat import trapz
from .shirley import shirley_calculate


class BackgroundCalculations:

    @staticmethod
    def calculate_endpoint_average_OLD(x_values, y_values, point, num_points):
        # Find index closest to the specified point
        idx = np.argmin(np.abs(x_values - point))

        # Get start and end indices for averaging window
        start_idx = max(0, idx - num_points // 2)
        end_idx = min(len(y_values), idx + num_points // 2 + 1)

        # Calculate average
        return np.mean(y_values[start_idx:end_idx])

    @staticmethod
    def calculate_endpoint_average_NEW(x_values, y_values, point, num_points):
        """
        Calculate the average value of y_values around the given point.
        The averaging window is centered on the point, and only valid points are used.
        """
        # Find index closest to the specified point
        idx = np.argmin(np.abs(x_values - point))

        # Calculate half window size for centering
        half_window = num_points // 2

        # Calculate start and end indices centered around the point
        start_idx = idx - half_window
        end_idx = idx + half_window + (1 if num_points % 2 == 1 else 0)

        # Ensure indices are within valid range
        start_idx = max(0, start_idx)
        end_idx = min(len(y_values), end_idx)

        # Extract valid points for averaging
        valid_y_values = y_values[start_idx:end_idx]

        # Only calculate average if we have valid points
        if len(valid_y_values) > 0:
            return float(f"{np.mean(valid_y_values):.2f}")
        else:
            # Fallback to single point if no valid points in window
            return float(f"{y_values[idx]:.2f}")

    @staticmethod
    def calculate_endpoint_average(x_values, y_values, point, num_points):
        """
        Calculate the average value of y_values around the given point.
        The averaging window is centered on the point, with automatic adjustment for edge cases.
        """
        # Ensure num_points is always at least 1
        if num_points <= 0:
            num_points = 1
            print(f"WARNING: Invalid num_points ({num_points}), using 1 instead")

        # Find index closest to the specified point
        idx = np.argmin(np.abs(x_values - point))

        # Calculate half window size for centering
        half_window = num_points // 2

        # Calculate ideal start and end indices centered around the point
        ideal_start = idx - half_window
        ideal_end = idx + half_window + (1 if num_points % 2 == 1 else 0)

        # Check if we need to adjust the window due to array bounds
        total_available = len(y_values)

        # Adjust window if it goes beyond array bounds
        if ideal_start < 0:
            # Shift window to the right if we're too close to the start
            shift = -ideal_start
            start_idx = 0
            end_idx = min(total_available, ideal_end + shift)
        elif ideal_end > total_available:
            # Shift window to the left if we're too close to the end
            shift = ideal_end - total_available
            end_idx = total_available
            start_idx = max(0, ideal_start - shift)
        else:
            # Window fits within bounds
            start_idx = ideal_start
            end_idx = ideal_end

        # Final bounds check and ensure we don't exceed requested points
        start_idx = max(0, start_idx)
        end_idx = min(total_available, end_idx)

        # Ensure we don't use more points than requested
        actual_window_size = end_idx - start_idx
        if actual_window_size > num_points:
            # Trim excess points, preferring to keep the window centered on target
            excess = actual_window_size - num_points
            trim_start = excess // 2
            trim_end = excess - trim_start
            start_idx += trim_start
            end_idx -= trim_end

        # Extract valid points for averaging
        valid_x_values = x_values[start_idx:end_idx]
        valid_y_values = y_values[start_idx:end_idx]

        # # Print detailed information about the averaging calculation
        # print(f"\n=== Averaging Points Calculation ===")
        # print(f"Target point (vLine position): {point:.2f}")
        # print(f"Closest data index: {idx} (x={x_values[idx]:.2f}, y={y_values[idx]:.2f})")
        # print(f"Number of averaging points requested: {num_points}")
        # print(f"Half window size: {half_window}")
        # print(f"Ideal window: indices {ideal_start} to {ideal_end}")
        # print(f"Array bounds: 0 to {total_available}")
        # print(f"Adjusted window: indices {start_idx} to {end_idx}")
        # print(f"Actual points used: {len(valid_y_values)}")

        if len(valid_y_values) > 0:
            # print(f"Points used for averaging:")
            for i, (x_val, y_val) in enumerate(zip(valid_x_values, valid_y_values)):
                actual_idx = start_idx + i
                marker = " ← CENTER" if actual_idx == idx else ""
                # print(f"  Index {actual_idx}: x={x_val:.2f}, y={y_val:.2f}{marker}")

            average_value = np.mean(valid_y_values)
            # print(f"Calculated average: {average_value:.2f}")
            # print(f"=== End Averaging Calculation ===\n")

            return float(f"{average_value:.2f}")
        else:
            # Fallback to single point if no valid points in window
            fallback_value = y_values[idx]
            # print(f"WARNING: No valid points in averaging window!")
            # print(f"Using fallback single point: x={x_values[idx]:.2f}, y={fallback_value:.2f}")
            # print(f"=== End Averaging Calculation ===\n")

            return float(f"{fallback_value:.2f}")

    @staticmethod
    def calculate_linear_background(x, y, start_offset, end_offset, num_points=5):
        """
        Calculate a linear background between the start and end points of the data.

        Args:
            x (array): X-axis values
            y (array): Y-axis values
            start_offset (float): Offset to add to the start point
            end_offset (float): Offset to add to the end point

        Returns:
            array: Linear background
        """
        y_start = BackgroundCalculations.calculate_endpoint_average(x, y, x[0],
                                                                    num_points) + start_offset
        y_end = BackgroundCalculations.calculate_endpoint_average(x, y, x[-1],
                                                                  num_points) + end_offset
        return np.linspace(y_start, y_end, len(y))

    @staticmethod
    def calculate_offset_background(x, y, offset_h, offset_l, num_points=5):
        """
        Calculate an offset background that brings the lowest BE to 0 intensity.
        Uses endpoint averaging at the minimum intensity position.

        Args:
            x (array): X-axis values (Binding Energy)
            y (array): Y-axis values (Intensity)
            offset_h (float): Offset for left side (high BE)
            offset_l (float): Offset for right side (low BE)
            num_points (int): Number of points for endpoint averaging

        Returns:
            array: Offset background (constant value based on averaged minimum intensity)
        """
        min_idx = np.argmin(y)
        min_x_position = x[min_idx]
        min_intensity_avg = BackgroundCalculations.calculate_endpoint_average(x, y, min_x_position, num_points)
        avg_offset = (offset_h + offset_l) / 2.0
        offset_value = min_intensity_avg + avg_offset
        return np.full_like(y, offset_value)

    @staticmethod
    def calculate_arctan_background(x, y, start_offset, end_offset, num_points=5):
        """
        Calculate an arctangent step background for XAS data.

        The arctan function models the absorption edge as a step function:
        y = amplitude * arctan((x - center) / width) + offset

        Args:
            x (array): X-axis values (energy)
            y (array): Y-axis values (intensity)
            start_offset (float): Y-offset to add to the start point (high energy/left side)
            end_offset (float): Y-offset to add to the end point (low energy/right side)
            num_points (int): Number of points to average at endpoints

        Returns:
            array: Calculated arctangent background
        """
        x = np.array(x)
        y = np.array(y)

        # Calculate averaged endpoint Y values and ADD offsets
        y_start = BackgroundCalculations.calculate_endpoint_average(x, y, x[0], num_points) + end_offset
        y_end = BackgroundCalculations.calculate_endpoint_average(x, y, x[-1], num_points) + start_offset

        # Check if high energy part is lower than low energy part
        if y_end <= y_start:
            # Keep background flat at the average value
            background = np.full_like(x, (y_start + y_end) / 2.0)
            return background

        # Calculate arctan step parameters
        center = (x[0] + x[-1]) / 2.0  # Center of the energy range
        amplitude = (y_end - y_start) / np.pi  # Height of step divided by pi (arctan range is pi)
        offset = (y_start + y_end) / 2.0  # Vertical offset (midpoint)
        width = abs(x[-1] - x[0]) / 4.0  # Width parameter (controls steepness of transition)

        # Calculate arctan background
        # arctan goes from -pi/2 to +pi/2, so total range is pi
        background = amplitude * np.arctan((x - center) / width) + offset

        return background

    @staticmethod
    def calculate_adaptive_arctan_background(x, y, x_range, previous_background, offset_h, offset_l, num_points=5):
        """Calculate Arctan background for a selected range."""
        previous_background = np.array(previous_background)
        mask = (x >= x_range[0]) & (x <= x_range[1])
        new_background = np.copy(previous_background)
        x_selected, y_selected = x[mask], y[mask]

        new_background[mask] = BackgroundCalculations.calculate_arctan_background(
            x_selected, y_selected, offset_h, offset_l, num_points)
        return new_background


    @staticmethod
    def validate_background_smoothness(background, data, x, smoothness_threshold=0.1):
        """
        Check if background shows sinusoidal behavior and validate against data average.

        Args:
            background (array): Calculated background
            data (array): Raw data
            x (array): X-axis values
            smoothness_threshold (float): Threshold for detecting oscillation

        Returns:
            bool: True if background is acceptable, False if too oscillatory
        """
        # Calculate second derivative to detect oscillation
        background_smooth = savgol_filter(background, window_length=min(21, len(background) // 3), polyorder=3)
        second_deriv = np.gradient(np.gradient(background_smooth, x), x)

        # Calculate moving average of data for comparison
        window_size = max(5, len(data) // 15)
        data_avg = np.convolve(data, np.ones(window_size) / window_size, mode='same')

        # Check oscillation frequency
        zero_crossings = np.sum(np.diff(np.sign(second_deriv)) != 0)
        oscillation_ratio = zero_crossings / len(background)

        # Check if background stays within reasonable bounds of data average
        deviation = np.abs(background - data_avg)
        max_allowed_dev = np.std(data) * 1.5
        excessive_points = np.sum(deviation > max_allowed_dev) / len(background)

        print(f"Background validation - Oscillation ratio: {oscillation_ratio:.3f}, Excessive points: {excessive_points:.3f}")

        return oscillation_ratio < smoothness_threshold and excessive_points < 0.25

    @staticmethod
    def calculate_active_shirley_background(x, y, offset_h, offset_l, num_points=5):
        """
        Calculate initial Active Shirley background - a flat offset at the low BE endpoint.
        The actual Shirley background will be recalculated after each fitting iteration.

        Args:
            x (array): X-axis values (binding energy)
            y (array): Y-axis values (intensity)
            offset_h (float): High BE offset
            offset_l (float): Low BE offset
            num_points (int): Number of points for endpoint averaging

        Returns:
            array: Initial flat background at low BE level
        """
        x, y = np.asarray(x), np.asarray(y)

        y_start = BackgroundCalculations.calculate_endpoint_average(x, y, x[0], num_points) + offset_h
        y_end = BackgroundCalculations.calculate_endpoint_average(x, y, x[-1], num_points) + offset_l

        if x[0] > x[-1]:  # BE scale
            baseline = y_end
        else:
            baseline = y_start

        return np.full_like(y, baseline, dtype=float)

    @staticmethod
    def calculate_active_shirley_from_peaks_OLD(x, y_raw, y_peaks, k=None, num_points=5, offset_h=0, offset_l=0):
        """
        Calculate Shirley background from fitted peak intensities (Active Shirley method).
        B(E) = const + k * integral from E to E_max of peaks(E') dE'

        Args:
            x (array): X-axis values (binding energy)
            y_raw (array): Raw intensity data
            y_peaks (array): Fitted peak intensities (sum of all peaks)
            k (float): Shirley scaling parameter. If None, auto-calculated.
            num_points (int): Number of points for endpoint averaging
            offset_h (float): High BE offset (left side)
            offset_l (float): Low BE offset (right side)

        Returns:
            tuple: (background array, fitted k value, const value)
        """
        x = np.asarray(x)
        y_raw = np.asarray(y_raw)
        y_peaks = np.maximum(np.asarray(y_peaks), 0)

        if x[0] > x[-1]:  # BE scale (decreasing)
            const = BackgroundCalculations.calculate_endpoint_average(x, y_raw, x[-1], num_points) + offset_l
            dx = np.abs(np.mean(np.diff(x)))
            cumulative_integral = np.zeros_like(y_peaks)
            for i in range(len(x) - 2, -1, -1):
                cumulative_integral[i] = cumulative_integral[i + 1] + y_peaks[i + 1] * dx
            else:  # KE scale
                const = BackgroundCalculations.calculate_endpoint_average(x, y_raw, x[0], num_points) + offset_l
            dx = np.abs(np.mean(np.diff(x)))
            cumulative_integral = np.zeros_like(y_peaks)
            for i in range(1, len(x)):
                cumulative_integral[i] = cumulative_integral[i - 1] + y_peaks[i - 1] * dx

        if k is None:
            if x[0] > x[-1]:
                high_be_raw = BackgroundCalculations.calculate_endpoint_average(x, y_raw, x[0], num_points) + offset_h
                high_be_peaks = np.mean(y_peaks[:num_points])
                total_integral = cumulative_integral[0]
            else:
                high_be_raw = BackgroundCalculations.calculate_endpoint_average(x, y_raw, x[-1], num_points) + offset_h
                high_be_peaks = np.mean(y_peaks[-num_points:])
                total_integral = cumulative_integral[-1]

            if total_integral > 0:
                k = max(0, (high_be_raw - high_be_peaks - const) / total_integral)
            else:
                k = 0.001

        background = const + k * cumulative_integral
        return background, k, const

    @staticmethod
    def calculate_active_shirley_from_peaks(x, y_raw, y_peaks, k=None, num_points=5, offset_h=0, offset_l=0):
        """
        Calculate Shirley background from fitted peak intensities (Active Shirley method).

        The background at low BE equals const (baseline).
        The background rises toward high BE proportionally to cumulative peak area.
        B(E) = const + k * integral from E to low_BE of peaks(E') dE'

        Args:
            x (array): X-axis values (binding energy)
            y_raw (array): Raw intensity data (used for baseline reference)
            y_peaks (array): Fitted peak intensities (sum of all peaks, background-subtracted)
            k (float): Shirley scaling parameter. If None, auto-calculated.
            num_points (int): Number of points for endpoint averaging
            offset_h (float): High BE offset (left side)
            offset_l (float): Low BE offset (right side)

        Returns:
            tuple: (background array, fitted k value, const value)
        """
        x = np.asarray(x)
        y_raw = np.asarray(y_raw)
        y_peaks = np.maximum(np.asarray(y_peaks), 0)

        dx = np.abs(np.mean(np.diff(x))) if len(x) > 1 else 1

        if x[0] > x[-1]:  # BE scale (high BE on left, low BE on right)
            # const is the baseline at low BE (right side)
            const = BackgroundCalculations.calculate_endpoint_average(x, y_raw, x[-1], num_points) + offset_l

            # Cumulative integral from low BE (right) toward high BE (left)
            # cumulative_integral[i] = integral from i to end (low BE)
            cumulative_integral = np.zeros_like(y_peaks, dtype=float)
            for i in range(len(x) - 2, -1, -1):
                cumulative_integral[i] = cumulative_integral[i + 1] + y_peaks[i + 1] * dx

            # Calculate k if not provided
            # k is chosen so that background + peaks ≈ raw at high BE
            if k is None:
                high_be_raw = BackgroundCalculations.calculate_endpoint_average(x, y_raw, x[0], num_points) + offset_h
                high_be_peaks = np.mean(y_peaks[:num_points])
                total_integral = cumulative_integral[0]

                if total_integral > 0:
                    # At high BE: raw ≈ background + peaks
                    # raw ≈ (const + k * total_integral) + peaks
                    # k = (raw - peaks - const) / total_integral
                    k = (high_be_raw - high_be_peaks - const) / total_integral
                    k = max(0, k)  # k must be non-negative
                else:
                    k = 0.0

        else:  # KE scale (low values on left)
            const = BackgroundCalculations.calculate_endpoint_average(x, y_raw, x[0], num_points) + offset_l

            cumulative_integral = np.zeros_like(y_peaks, dtype=float)
            for i in range(1, len(x)):
                cumulative_integral[i] = cumulative_integral[i - 1] + y_peaks[i - 1] * dx

            if k is None:
                high_be_raw = BackgroundCalculations.calculate_endpoint_average(x, y_raw, x[-1], num_points) + offset_h
                high_be_peaks = np.mean(y_peaks[-num_points:])
                total_integral = cumulative_integral[-1]

                if total_integral > 0:
                    k = (high_be_raw - high_be_peaks - const) / total_integral
                    k = max(0, k)
                else:
                    k = 0.0

        # Calculate background: starts at const, rises with cumulative integral
        background = const + k * cumulative_integral

        return background, k, const

    @staticmethod
    def calculate_adaptive_active_shirley_background(x, y, x_range, previous_background, offset_h, offset_l, num_points=5):
        """Calculate initial Active Shirley background for a selected range."""
        previous_background = np.array(previous_background)
        mask = (x >= x_range[0]) & (x <= x_range[1])
        new_background = np.copy(previous_background)
        x_selected, y_selected = x[mask], y[mask]

        active_shirley_bg = BackgroundCalculations.calculate_active_shirley_background(
            x_selected, y_selected, offset_h, offset_l, num_points)
        new_background[mask] = active_shirley_bg

        return new_background

    @staticmethod
    def calculate_active_tougaard_background(x, y, offset_h, offset_l, num_points=5):
        """
        Calculate initial Active Tougaard background - a flat offset at the low BE endpoint.
        This serves as the starting point; the actual Tougaard background will be
        recalculated after each fitting iteration based on the fitted peaks.

        Args:
            x (array): X-axis values (binding energy)
            y (array): Y-axis values (intensity)
            offset_h (float): High BE offset
            offset_l (float): Low BE offset
            num_points (int): Number of points for endpoint averaging

        Returns:
            array: Initial flat background at low BE level
        """
        x, y = np.asarray(x), np.asarray(y)

        y_start = BackgroundCalculations.calculate_endpoint_average(x, y, x[0], num_points) + offset_h
        y_end = BackgroundCalculations.calculate_endpoint_average(x, y, x[-1], num_points) + offset_l

        if x[0] > x[-1]:  # BE scale
            baseline = y_end
        else:
            baseline = y_start

        return np.full_like(y, baseline, dtype=float)

    @staticmethod
    def calculate_active_tougaard_from_peaks(x, y_raw, y_peaks, B=None, C=1643, D=0,
                                             num_points=5, offset_h=0, offset_l=0):
        """
        Calculate Tougaard background from fitted peak intensities (Active Tougaard method).
        """
        from scipy.optimize import minimize_scalar

        x = np.asarray(x)
        y_raw = np.asarray(y_raw)
        y_peaks = np.maximum(np.asarray(y_peaks), 0)

        n = len(x)
        dx = np.abs(np.mean(np.diff(x))) if n > 1 else 1

        # Get baseline at low BE (same as U2-Tougaard)
        baseline = BackgroundCalculations.calculate_endpoint_average(x, y_raw, x[-1], num_points) + offset_l
        print(f"DEBUG Active Tougaard: baseline={baseline:.2f}")

        # High BE position for fitting target
        high_be_position = x[0]

        # Target intensity at high BE
        target_intensity = BackgroundCalculations.calculate_endpoint_average(x, y_raw, high_be_position, num_points) + offset_h
        print(f"DEBUG Active Tougaard: target_intensity at high BE={target_intensity:.2f}")

        def calculate_tougaard_integral(B_val):
            """Calculate Tougaard background using envelope (peaks)

            For BE scale (x[0]=high BE, x[-1]=low BE):
            - At low BE (x[-1]): integral should be 0, background = baseline
            - At high BE (x[0]): integral is max, background = baseline + integral

            We integrate from current position toward LOWER BE (higher indices).
            """
            bg = np.zeros(n, dtype=float)

            for i in range(n):
                integral_sum = 0.0
                # Integrate over all points with LOWER BE (higher indices, j > i)
                for j in range(i + 1, n):
                    T = abs(x[j] - x[i])  # Energy loss T = E' - E
                    if T > 0:
                        # U2-Tougaard kernel: K = B * T / ((C + T²)²)
                        K = B_val * T / ((C + T ** 2) ** 2)
                        integral_sum += K * y_peaks[j] * dx
                bg[i] = integral_sum

            return bg + baseline

        if B is None:
            def objective(B_val):
                try:
                    bg_temp = calculate_tougaard_integral(B_val)
                    bg_at_high_be = BackgroundCalculations.calculate_endpoint_average(x, bg_temp, high_be_position, num_points)
                    peaks_at_high_be = np.mean(y_peaks[:num_points])
                    calculated_total = bg_at_high_be + peaks_at_high_be
                    error = (calculated_total - target_intensity) ** 2
                    return error
                except:
                    return 1e10

            # result = minimize_scalar(objective, bounds=(100, 1000000), method='bounded')
            result = minimize_scalar(objective, bounds=(100, 1000000), method='bounded',
                                     options={'xatol': 1.0, 'maxiter': 10})
            B = result.x

        background = calculate_tougaard_integral(B)

        # Check: at low BE, integral should be ~0, so background should be ~baseline
        integral_at_low_be = background[-1] - baseline
        print(f"DEBUG Active Tougaard: integral at low BE (should be ~0)={integral_at_low_be:.2f}")

        return background, B

    @staticmethod
    def calculate_adaptive_active_tougaard_background(x, y, x_range, previous_background, offset_h, offset_l, num_points=5):
        """Calculate initial Active Tougaard background for a selected range."""
        previous_background = np.array(previous_background)
        mask = (x >= x_range[0]) & (x <= x_range[1])
        new_background = np.copy(previous_background)
        x_selected, y_selected = x[mask], y[mask]

        active_tougaard_bg = BackgroundCalculations.calculate_active_tougaard_background(
            x_selected, y_selected, offset_h, offset_l, num_points)
        new_background[mask] = active_tougaard_bg

        return new_background

    @staticmethod
    def calculate_smart_background(x, y, offset_h, offset_l, num_points=5):
        """
        Calculate a 'smart' background by choosing between Shirley and linear backgrounds.

        Args:
            x (array): X-axis values
            y (array): Y-axis values
            offset_h (float): High offset
            offset_l (float): Low offset

        Returns:
            array: Smart background
        """
        shirley_bg = BackgroundCalculations.calculate_shirley_background(x, y, offset_h, offset_l, num_points=num_points)
        linear_bg = BackgroundCalculations.calculate_linear_background(x, y, offset_h, offset_l, num_points=num_points)

        # Choose background type based on first and last y-values
        background = shirley_bg if y[0] > y[-1] else linear_bg

        # Ensure background does not exceed raw data
        # return np.minimum(background, y)
        return background


    @staticmethod
    def calculate_smart2_background(x, y, threshold=0.01):
        """
        Calculate an improved 'smart' background using derivative analysis.

        Args:
            x (array): X-axis values
            y (array): Y-axis values
            threshold (float): Threshold for determining flat regions

        Returns:
            array: Smart2 background
        """
        dy = np.gradient(y, x)
        threshold = 0.001 * (max(y) - min(y))

        # Smooth the derivative
        dy_smooth = savgol_filter(dy, window_length=30, polyorder=3)

        background = np.zeros_like(y)
        flat_mask = np.abs(dy_smooth) < threshold

        # Set background to raw data in flat regions
        background[flat_mask] = y[flat_mask]

        # For non-flat regions, decide between linear and Shirley
        for i in range(1, len(y)):
            if not flat_mask[i]:
                if y[i] < y[i - 1]:  # Data going down
                    background[i] = background[i - 1] + (y[i] - y[i - 1])
                else:  # Data going up
                    A = trapz(y[:i + 1] - background[:i + 1], x[:i + 1])
                    B = trapz(y[i:] - background[i:], x[i:])
                    background[i] = y[-1] + (y[0] - y[-1]) * B / (A + B)

        return background



    @staticmethod
    def calculate_adaptive_smart_background(x, y, x_range, previous_background, offset_h, offset_l, num_points=5):
        """
        Calculate an Multi-Regions Smart background for a selected range.

        Args:
            x (array): X-axis values (FULL dataset)
            y (array): Y-axis values (FULL dataset)
            x_range (tuple): Range of x values to calculate background for
            previous_background (array): Previous background calculation
            offset_h (float): High offset
            offset_l (float): Low offset
            num_points (int): Number of points for endpoint averaging

        Returns:
            array: Multi-Regions Smart background
        """
        previous_background = np.array(previous_background)
        mask = (x >= x_range[0]) & (x <= x_range[1])
        new_background = np.copy(previous_background)
        x_selected, y_selected = x[mask], y[mask]

        # Determine background type for selected range
        if y_selected[0] > y_selected[-1]:
            # Calculate shirley using FULL x,y for proper endpoint averaging
            # But only take the portion within the mask
            print(f'The number of points used for endpoint averaging is: {num_points}')
            shirley_full = BackgroundCalculations.calculate_shirley_background(x, y, offset_h, offset_l, num_points=num_points)
            new_background[mask] = shirley_full[mask]
        else:
            # Calculate linear using FULL x,y for proper endpoint averaging
            # But only take the portion within the mask
            linear_full = BackgroundCalculations.calculate_linear_background(x, y, offset_h, offset_l, num_points=num_points)
            new_background[mask] = linear_full[mask]

        return new_background


    @staticmethod
    def calculate_shirley_background(x, y, start_offset, end_offset, max_iter=100, tol=1e-2, padding_factor=0.01,
                                     num_points=5):
        """
        Calculate the Shirley background using the lmfitxps package: lmfitxps.backgrounds-> shirley_calculate.
        DOCS: https://lmfitxps.readthedocs.io/en/latest/_modules/lmfitxps/backgrounds.html#shirley_calculate
        """
        x, y = np.asarray(x), np.asarray(y)

        # Pad data with offset values to allow the user to calculate background including offsets.
        # NOTE: Since offsets are applied to the padded array ends (not the original data),
        # the resulting background will only approximate the specified offsets at the original boundaries.
        # but that should be close enough.

        x_delta=x[1]-x[0] # negative or positive, depending on binding/kinetic energy scale

        x_padded = np.concatenate([[x[0] - x_delta], x, [x[-1]+x_delta]])

        # Calculate averaged endpoint values
        y_start = BackgroundCalculations.calculate_endpoint_average(x, y, x[0], num_points) + start_offset
        y_end = BackgroundCalculations.calculate_endpoint_average(x, y, x[-1], num_points) + end_offset

        y_padded = np.concatenate([[y_start], y, [y_end]])

        background=shirley_calculate(x_padded,y_padded,maxit=max_iter, tol=tol)
        return background[1:-1]


    @staticmethod
    def calculate_u2_tougaard_background(x, y, sheet_name, window, vline_range=None):
        """
        Calculate U2-Tougaard background (2 parameters: auto-calculated B, user-defined C)
        D=0, T0=0 are fixed.
        B is fitted so background equals raw data at high BE vLine position.
        C is user-defined (default 1643).
        Uses corrected U2 equation: K = B * E / ((C + E²)²)
        """
        import numpy as np
        from scipy.optimize import minimize_scalar

        print(f"DEBUG: U2-Tougaard called with vline_range={vline_range}")

        bg_data = window.Data['Core levels'][sheet_name]['Background']
        # C_value = bg_data.get('Tougaard_C', 1643.0)  # User-defined C parameter
        # C_value = 1643
        C_value = float(bg_data.get('Tougaard_C', 1643.00))

        # Get averaging points (same as Smart background)
        averaging_points = getattr(window, 'averaging_points', 5)

        # Get baseline value (lowest BE intensity) using endpoint averaging
        baseline = BackgroundCalculations.calculate_endpoint_average(x, y, x[-1], averaging_points)

        # Shift data to zero baseline
        y_shifted = y - baseline

        # Determine fitting target position
        if vline_range is not None:
            # Use vLine range (from AreaFit_Screen)
            vline_min, vline_max = vline_range
            high_be_position = max(vline_min, vline_max)
            print(f"DEBUG: Using vLine range target at BE {high_be_position:.2f}")
        else:
            # Use background range data (from regular background plotting)
            bg_high = bg_data.get('Bkg High')
            bg_low = bg_data.get('Bkg Low')

            if bg_high is not None and bg_low is not None:
                # Use the high BE end of background range
                high_be_position = max(float(bg_high), float(bg_low))
                print(f"DEBUG: Using background range target at BE {high_be_position:.2f}")
            else:
                # Ultimate fallback - use highest BE position in data
                high_be_position = np.max(x)
                print(f"DEBUG: Using data max target at BE {high_be_position:.2f}")

        # Get target intensity using endpoint averaging
        target_intensity = BackgroundCalculations.calculate_endpoint_average(x, y, high_be_position, averaging_points)

        def objective(B_val):
            """Fit B parameter with user-defined C"""
            try:
                # Calculate background with variable B and fixed C
                bg_temp = np.zeros_like(y)
                dx = np.mean(np.diff(x))

                for i in range(len(x)):
                    E_prime_minus_E = x[i:] - x[i]  # This is (E' - E)
                    K = B_val * E_prime_minus_E / ((C_value + E_prime_minus_E ** 2) ** 2)
                    bg_temp[i] = trapz(K * y_shifted[i:], dx=dx)

                # Get calculated background at target position using same averaging method
                calculated_bg_shifted = BackgroundCalculations.calculate_endpoint_average(x, bg_temp, high_be_position, averaging_points)
                calculated_bg = calculated_bg_shifted + baseline

                error = (calculated_bg - target_intensity) ** 2
                return error
            except:
                return 1e10

        # Fit B parameter with user-defined C
        result = minimize_scalar(objective, bounds=(100, 1000000), method='bounded')
        B_fitted = result.x

        print(f"U2-Tougaard fitted: B={B_fitted:.2f}, C={C_value:.2f} (user-defined)")
        print(f"Target={target_intensity:.2f} at BE {high_be_position:.2f} (avg {averaging_points} points)")

        # Calculate final background with fitted parameters
        dx = np.mean(np.diff(x))
        background = np.zeros_like(y)
        for i in range(len(x)):
            E_prime_minus_E = x[i:] - x[i]  # This is (E' - E)
            K = B_fitted * E_prime_minus_E / ((C_value + E_prime_minus_E ** 2) ** 2)
            background[i] = trapz(K * y_shifted[i:], dx=dx)

        background = background + baseline

        # Store fitted values
        if 'Background' not in window.Data['Core levels'][sheet_name]:
            window.Data['Core levels'][sheet_name]['Background'] = {}
        window.Data['Core levels'][sheet_name]['Background']['Fitted_B'] = float(f"{B_fitted:.2f}")
        window.Data['Core levels'][sheet_name]['Background']['Tougaard_B'] = float(f"{B_fitted:.2f}")
        window.Data['Core levels'][sheet_name]['Background']['Tougaard_C'] = float(f"{C_value:.2f}")

        return background

    @staticmethod
    def calculate_tougaard_background_OLD(x, y, sheet_name, window):
        bg_data = window.Data['Core levels'][sheet_name]['Background']
        B = bg_data.get('Tougaard_B', 2866)
        C = bg_data.get('Tougaard_C', 1643)
        D = bg_data.get('Tougaard_D', 1)
        T0 = bg_data.get('Tougaard_T0', 0)

        # Get the baseline value (lowest BE intensity)
        baseline = y[-1]  # Assuming x is in BE, so highest KE/lowest BE is at the end

        # Shift data to zero baseline
        y_shifted = y  - baseline

        dx = np.mean(np.diff(x))
        background = np.zeros_like(y)
        for i in range(len(x)):
            E = x[i:] - x[i]
            K = B * E / ((C - E ** 2) ** 2 + D * E ** 2)
            background[i] = trapz(K * y_shifted[i:], dx=dx) + T0

        background = background + baseline
        return background

    @staticmethod
    def calculate_tougaard_background_NEW(x, y, sheet_name, window):
        bg_data = window.Data['Core levels'][sheet_name]['Background']
        B = float(f"{bg_data.get('Tougaard_B', 2866.00):.2f}")
        C = float(f"{bg_data.get('Tougaard_C', 1643.00):.2f}")
        D = float(f"{bg_data.get('Tougaard_D', 1.00):.2f}")
        T0 = float(f"{bg_data.get('Tougaard_T0', 0.00):.2f}")

        # Get the baseline value (lowest BE intensity)
        baseline = y[-1]  # Assuming x is in BE, so highest KE/lowest BE is at the end

        # Shift data to zero baseline
        y_shifted = y - baseline

        dx = np.mean(np.diff(x))
        background = np.zeros_like(y)
        for i in range(len(x)):
            E_prime_minus_E = x[i:] - x[i]  # This is (E' - E)
            # Corrected U4-Tougaard equation matching Casa format
            K = B * E_prime_minus_E / ((C + E_prime_minus_E ** 2) ** 2 + D * E_prime_minus_E ** 2)
            background[i] = trapz(K * y_shifted[i:], dx=dx) + T0

        background = background + baseline
        return background

    @staticmethod
    def calculate_tougaard_background(x, y, sheet_name, window):
        bg_data = window.Data['Core levels'][sheet_name]['Background']
        B = float(f"{bg_data.get('Tougaard_B', 2866.00):.2f}")
        C = float(f"{bg_data.get('Tougaard_C', 1643.00):.2f}")
        D = float(f"{bg_data.get('Tougaard_D', 1.00):.2f}")
        T0 = float(f"{bg_data.get('Tougaard_T0', 0.00):.2f}")

        # Get the baseline value (lowest BE intensity)
        baseline = y[-1]  # Assuming x is in BE, so highest KE/lowest BE is at the end

        # Shift data to zero baseline
        y_shifted = y - baseline

        dx = np.mean(np.diff(x))
        background = np.zeros_like(y)
        for i in range(len(x)):
            E_prime_minus_E = x[i:] - x[i]  # This is (E' - E) - positive energy loss
            # U4-Tougaard equation - matching documentation format but with positive E
            K = B * E_prime_minus_E / ((C - E_prime_minus_E ** 2) ** 2 + D * E_prime_minus_E ** 2)
            background[i] = trapz(K * y_shifted[i:], dx=dx) + T0

        print("Using Tougaard background with parameters:")
        print(f"  B = {B:.2f}")
        background = background + baseline
        return background

    def calculate_double_tougaard_background(x, y, sheet_name, window):
        bg_data = window.Data['Core levels'][sheet_name]['Background']

        # First Tougaard parameters
        B1 = bg_data.get('Tougaard_B', 2866)
        C1 = bg_data.get('Tougaard_C', 1643)
        D1 = bg_data.get('Tougaard_D', 1)
        T01 = bg_data.get('Tougaard_T0', 0)

        # Second Tougaard parameters
        B2 = bg_data.get('Tougaard_B2', 2866)
        C2 = bg_data.get('Tougaard_C2', 1643)
        D2 = bg_data.get('Tougaard_D2', 1)
        T02 = bg_data.get('Tougaard_T02', 0)

        baseline = y[-1]
        y_shifted = y - baseline

        dx = np.mean(np.diff(x))
        background1 = np.zeros_like(y)
        background2 = np.zeros_like(y)

        for i in range(len(x)):
            E = x[i:] - x[i]
            K1 = B1 * E / ((C1 - E ** 2) ** 2 + D1 * E ** 2)
            K2 = B2 * E / ((C2 - E ** 2) ** 2 + D2 * E ** 2)
            background1[i] = trapz(K1 * y_shifted[i:], dx=dx) + T01
            background2[i] = trapz(K2 * y_shifted[i:], dx=dx) + T02

        background = background1 + background2 + baseline
        return background

    def calculate_triple_tougaard_background(x, y, sheet_name, window):
        bg_data = window.Data['Core levels'][sheet_name]['Background']

        # Parameters for all three Tougaard backgrounds
        B1 = bg_data.get('Tougaard_B', 2866)
        C1 = bg_data.get('Tougaard_C', 1643)
        D1 = bg_data.get('Tougaard_D', 1)
        T01 = bg_data.get('Tougaard_T0', 0)

        B2 = bg_data.get('Tougaard_B2', 2866)
        C2 = bg_data.get('Tougaard_C2', 1643)
        D2 = bg_data.get('Tougaard_D2', 1)
        T02 = bg_data.get('Tougaard_T02', 0)

        B3 = bg_data.get('Tougaard_B3', 2866)
        C3 = bg_data.get('Tougaard_C3', 1643)
        D3 = bg_data.get('Tougaard_D3', 1)
        T03 = bg_data.get('Tougaard_T03', 0)

        baseline = y[-1]
        y_shifted = y - baseline

        dx = np.mean(np.diff(x))
        background1 = np.zeros_like(y)
        background2 = np.zeros_like(y)
        background3 = np.zeros_like(y)

        for i in range(len(x)):
            E = x[i:] - x[i]
            K1 = B1 * E / ((C1 - E ** 2) ** 2 + D1 * E ** 2)
            K2 = B2 * E / ((C2 - E ** 2) ** 2 + D2 * E ** 2)
            K3 = B3 * E / ((C3 - E ** 2) ** 2 + D3 * E ** 2)
            background1[i] = trapz(K1 * y_shifted[i:], dx=dx) + T01
            background2[i] = trapz(K2 * y_shifted[i:], dx=dx) + T02
            background3[i] = trapz(K3 * y_shifted[i:], dx=dx) + T03

        background = background1 + background2 + background3 + baseline
        return background

    @staticmethod
    def calculate_w_tougaard_background(x, y, B=2866, C=1643, T0=0):
        """
        Calculate W Tougaard background with endpoint adjustment.

        Parameters:
        x : array-like
            Energy axis (eV).
        y : array-like
            Intensity axis.
        B : float
            Initial Tougaard parameter, to be adjusted.
        C : float
            Tougaard parameter, controls energy-loss dependence.
        T0 : float
            Offset term for the background.

        Returns:
        background : array-like
            Computed W Tougaard background.
        """
        dx = np.mean(np.diff(x))  # Ensure uniform step size in x
        background = np.zeros_like(y)

        # Adjust B based on endpoint intensities
        I1, I2 = y[0], y[-1]  # Intensities at the endpoints
        B_adjusted = B * (I1 / I2) if I2 != 0 else B

        for i in range(len(x)):
            E = x[i:] - x[i]  # Energy loss
            K = B_adjusted * E / (C + E ** 2)  # Kernel computation
            background[i] = trapz(K * y[i:], dx=dx) + T0

        return background

    @staticmethod
    def calculate_u_poly_tougaard_background(x, y, B=2866, C=1643, D=1, T0=0):
        """
        Calculate U Poly Tougaard background for specific materials.

        Parameters:
        x : array-like
            Energy axis (eV).
        y : array-like
            Intensity axis.
        B : float
            Tougaard parameter related to scattering cross-section.
        C : float
            Tougaard parameter, energy-dependent term.
        D : float
            Tougaard parameter, higher-order correction term.
        T0 : float
            Energy loss threshold.

        Returns:
        background : array-like
            Computed U Poly Tougaard background.
        """
        dx = np.mean(np.diff(x))
        background = np.zeros_like(y)

        for i in range(len(x)):
            E = x[i:] - x[i]  # Energy loss
            K = np.where(
                E > T0,
                B * E / (C + D * E ** 2),
                0  # Zero for energy below threshold
            )
            background[i] = trapz(K * y[i:], dx=dx)

        return background

    @staticmethod
    def calculate_adaptive_shirley_background(x, y, x_range, previous_background, offset_h, offset_l, num_points=5):
        """Calculate Shirley background for a selected range."""
        previous_background = np.array(previous_background)
        mask = (x >= x_range[0]) & (x <= x_range[1])
        new_background = np.copy(previous_background)
        x_selected, y_selected = x[mask], y[mask]

        new_background[mask] = BackgroundCalculations.calculate_shirley_background(
            x_selected, y_selected, offset_h, offset_l, num_points)
        return new_background

    @staticmethod
    def calculate_adaptive_linear_background(x, y, x_range, previous_background, offset_h, offset_l, num_points=5):
        """Calculate Linear background for a selected range."""
        previous_background = np.array(previous_background)
        mask = (x >= x_range[0]) & (x <= x_range[1])
        new_background = np.copy(previous_background)
        x_selected, y_selected = x[mask], y[mask]

        new_background[mask] = BackgroundCalculations.calculate_linear_background(
            x_selected, y_selected, offset_h, offset_l, num_points)
        return new_background

    @staticmethod
    def calculate_adaptive_single_smart_background(x, y, x_range, previous_background, offset_h, offset_l,
                                                   num_points=5):
        """Calculate Smart background for a selected range."""
        previous_background = np.array(previous_background)
        mask = (x >= x_range[0]) & (x <= x_range[1])
        new_background = np.copy(previous_background)
        x_selected, y_selected = x[mask], y[mask]

        new_background[mask] = BackgroundCalculations.calculate_smart_background(
            x_selected, y_selected, offset_h, offset_l, num_points)
        return new_background

    @staticmethod
    def calculate_als_background_lmfit(x, y, lambda_val=1e5, p=0.001, niter=30):
        """
        Calculate Asymmetric Least Squares background using lmfit.
        """
        from scipy import sparse
        from scipy.sparse.linalg import spsolve
        import lmfit

        y = np.array(y, dtype=float)
        m = len(y)

        # Define the baseline model function
        def als_baseline(params, x, y):
            lam = params['lam'].value
            p_val = params['p_val'].value

            # Create second-derivative matrix
            D = sparse.diags([1, -2, 1], [-1, 0, 1], shape=(m - 2, m))

            # Initial estimate
            z = y.copy()

            # ALS algorithm
            for i in range(niter):
                w = p_val * (y > z) + (1 - p_val) * (y <= z)
                W = sparse.spdiags(w, 0, m, m)

                DtD = D.transpose() @ D
                A = W + lam * DtD
                B = W @ y
                z = spsolve(A, B)

            # Return residuals for fitting
            return z - y

        # Create parameter set
        params = lmfit.Parameters()
        params.add('lam', value=lambda_val, min=-1e1, max=-1e7, vary=True)
        params.add('p_val', value=p, min=0.0001, max=0.5, vary=True)

        # Perform the fit
        result = lmfit.minimize(als_baseline, params, args=(x, y), method='least_squares')

        # Get final parameters
        final_lambda = result.params['lam'].value
        final_p = result.params['p_val'].value

        print(f"Final lambda: {final_lambda}, Final p: {final_p}")

        # Calculate final background with optimized parameters
        D = sparse.diags([1, -2, 1], [-1, 0, 1], shape=(m - 2, m))
        z = y.copy()

        for i in range(niter):
            w = final_p * (y > z) + (1 - final_p) * (y <= z)
            W = sparse.spdiags(w, 0, m, m)

            DtD = D.transpose() @ D
            A = W + final_lambda * DtD
            B = W @ y
            z = spsolve(A, B)

        return z

    @staticmethod
    def calculate_als_background(x, y, lambda_val=1e5, p=0.001, niter=10):
        """
        Calculate Asymmetric Least Squares background correction.
        """
        from scipy import sparse
        from scipy.sparse.linalg import spsolve

        y = np.array(y, dtype=float)
        m = len(y)

        # Create second-derivative matrix
        D = sparse.diags([1, -2, 1], [-1, 0, 1], shape=(m - 2, m))

        # Initial estimate
        z = y.copy()

        # Iterative process
        for i in range(niter):
            # Weights based on residuals
            w = p * (y > z) + (1 - p) * (y <= z)
            W = sparse.spdiags(w, 0, m, m)

            # Solve the regularized least squares problem
            DtD = D.transpose() @ D
            A = W + lambda_val * DtD
            B = W @ y
            z = spsolve(A, B)

        return z

    @staticmethod
    def calculate_als_background_spectral(x, y, lambda_val=1e6, p=0.0001, niter=20):
        """
        Calculate Asymmetric Least Squares background optimized for spectroscopic data.
        """
        from scipy import sparse
        from scipy.sparse.linalg import spsolve
        import numpy as np

        y = np.array(y, dtype=float)
        m = len(y)

        # Initial peak identification (rough approach)
        # First do a very rough ALS fit with high lambda to get approximate baseline
        D = sparse.diags([1, -2, 1], [-1, 0, 1], shape=(m - 2, m))
        w = np.ones(m)

        # Rough baseline
        for i in range(5):
            W = sparse.spdiags(w, 0, m, m)
            DtD = D.transpose() @ D
            A = W + 1e8 * DtD  # Very high lambda for initial rough estimate
            B = W @ y
            z_rough = spsolve(A, B)
            w = 0.0001 * (y > z_rough) + 0.9999 * (y <= z_rough)

        # Identify potential peaks as points significantly above rough baseline
        threshold = 1.5 * np.median(y - z_rough)
        peak_mask = (y - z_rough) > threshold

        # Refined ALS with peak awareness
        # Set very low weights for peak regions
        z = z_rough.copy()
        w = np.ones(m)
        w[peak_mask] = 0.0001  # Very low weight for peak regions

        # Main ALS iterations with refined settings
        for i in range(niter):
            # Update weights based on being above/below current baseline
            # But preserve the peak masking
            non_peak_mask = ~peak_mask
            w[non_peak_mask] = p * (y[non_peak_mask] > z[non_peak_mask]) + (1 - p) * (
                        y[non_peak_mask] <= z[non_peak_mask])

            # Solve weighted penalized least squares
            W = sparse.spdiags(w, 0, m, m)
            DtD = D.transpose() @ D
            A = W + lambda_val * DtD
            B = W @ y
            z = spsolve(A, B)

        # Final cleanup - ensure baseline is below data points where appropriate
        # For Raman, baseline should never exceed original signal
        # (uncomment if needed)
        # z = np.minimum(z, y)

        return z


class AtomicConcentrations:
    @staticmethod
    def calculate_imfp_tpp2m_WITHOUT_VALUES_BUT_GOOD(kinetic_energy, z_avg, n_v_avg, molecular_weight, density):
        """
        Calculate IMFP using TPP-2M formula for 50-2000 eV electrons
        """
        E = kinetic_energy

        # Calculate plasmon energy E_p
        E_p = 28.8 * (n_v_avg * density / molecular_weight) ** 0.5

        # Calculate parameters
        U = n_v_avg * density / molecular_weight
        beta = -0.10 + 0.944 * (E_p ** 2) ** (-0.5) + 0.069 * density ** 0.1
        gamma = 0.191 * density ** (-0.5)
        C = 1.97 - 0.91 * U / (z_avg)
        D = 53.4 - 20.8 * U / (z_avg)

        # Calculate IMFP in Angstroms
        # /10 to get it in nm as per plot found advantage
        imfp = E / (E_p ** 2 * (beta * np.log2(gamma * E) - C / E + D / E ** 2)) /10#

        print(f'IMFP: {imfp}, KE: {kinetic_energy}')
        return imfp   # Convert to nanometers

    @staticmethod
    def calculate_imfp_tpp2m(kinetic_energy):
        """
        Calculate IMFP using TPP-2M formula with average matrix parameters from XPS reference data.

        Parameters:
            kinetic_energy: electron energy in eV

        Returns:
            imfp: Inelastic Mean Free Path in nanometers

        Notes:
        Average matrix parameters derived from metals and inorganic compounds:
        - N_v = 4.684 (valence electrons per atom)
        - rho = 6.767 g/cm³ (density)
        - M = 137.51 g/mol (molecular weight)
        - E_g = 0 eV (bandgap energy)

        References:
        1. S.Tanuma, C.J.Powell and D.R.Penn, Surf. Interface Anal., 21, 165-176 (1993)
        2. Briggs & Grant, "Surface Analysis by XPS and AES" 2nd Ed., Wiley (2003), p.84-85
        """
        N_v = 4.684
        rho = 6.767
        M = 137.51
        E_g = 0

        E_p = 28.8 * np.sqrt((N_v * rho) / M)
        U = N_v * rho / M

        beta = -0.10 + 0.944 / (E_p ** 2 + E_g ** 2) ** 0.5 + 0.069 * rho ** 0.1
        gamma = 0.191 * rho ** (-0.5)
        C = 1.97 - 0.91 * U
        D = 53.4 - 20.8 * U

        imfp = kinetic_energy / (E_p ** 2 * (
                beta * np.log(gamma * kinetic_energy) -
                (C / kinetic_energy) +
                (D / kinetic_energy ** 2))) / 10

        # Avantage add a scaling factor so that corrected area matches the one obtained with KE^0.6
        # To compare KherveFitting with Avantage we will also apply this factor
        imfp2 = imfp * 26.2

        # print(f'IMFP: {imfp}, Factored_imfp: {imfp2} KE: {kinetic_energy}')

        return imfp

    @staticmethod
    def calculate_angular_correction(window, peak_name, angle_degrees):
        """
        Calculate angular correction factor for non-magic angle analysis.

        Args:
            angle_degrees (float): Analysis angle in degrees
            orbital_type (str): Orbital type ('s', 'p', 'd', 'f')

        Returns:
            float: Angular correction factor
        """

        orbital_type = AtomicConcentrations.extract_orbital_type(peak_name)

        angle_rad = angle_degrees * np.pi / 180

        # Set beta parameter based on orbital type
        beta_values = {
            's': 0,
            'p': 1,
            'd': 2,
            'f': 2
        }
        beta = beta_values.get(orbital_type, 0)

        correction = 1 + beta * (3 * np.cos(angle_rad) ** 2 - 1) / 4
        # print(f'correction for angle {angle_degrees}: {correction}')
        return correction

    @staticmethod
    def extract_orbital_type_OLD(peak_name):
        """
        Extract orbital type (s, p, d, f) from peak name.
        Examples:
        'Ti2p3/2' -> 'p'
        'C1s' -> 's'
        'Sr3d5/2' -> 'd'
        'Ti 2p3/2' -> 'p'
        'C 1s' -> 's'
        'Sr 3d5/2' -> 'd'
        """
        # Split name and take first part (core level)
        core_level = peak_name.split()[0]

        # Start from second character
        i = 1
        while i < len(core_level):
            # If current char is a letter
            if core_level[i].isalpha():
                # Check if next char exists and is a number
                if i + 1 < len(core_level) and core_level[i + 1].isdigit():
                    print(f'Peak name: {peak_name} Chosen name: {core_level[i+2].lower()}')
                    return core_level[i+2].lower()
            i += 1

        return 's'  # Default to s if no orbital found

    @staticmethod
    def extract_orbital_type(peak_name):
        """
        Extract orbital type (s, p, d, f) from peak name.
        Examples:
        'Ti2p3/2' -> 'p'
        'C1s' -> 's'
        'Sr3d5/2' -> 'd'
        'Ti 2p3/2' -> 'p'
        'C 1s' -> 's'
        'Sr 3d5/2' -> 'd'
        """
        import re

        # First try to match the pattern in the whole string
        match = re.search(r'\d+([spdf])', peak_name.lower())
        if match:
            return match.group(1)

        # If no match, try individual parts
        parts = peak_name.split()
        for part in parts:
            match = re.search(r'\d+([spdf])', part.lower())
            if match:
                return match.group(1)

        # Last resort - just look for any orbital character
        for char in peak_name.lower():
            if char in 'spdf':
                return char

        return 's'  # Default to s if no orbital found


