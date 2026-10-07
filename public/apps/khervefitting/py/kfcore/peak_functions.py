# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial

#
# KherveOS port: libraries/Peak_Functions.py (KherveFitting, develop),
# the PeakFunctions and OtherCalc classes, unchanged except that np.trapz
# comes from .compat (it is gone in NumPy 2.4, which Pyodide ships).

import numpy as np
import lmfit
from lmfit.models import VoigtModel
from scipy.optimize import minimize_scalar, brentq
from scipy.signal import convolve
from scipy.interpolate import interp1d
from scipy.ndimage import gaussian_filter

from .compat import trapz


class PeakFunctions:

    @staticmethod
    def gaussian_other(x, E, F, m):
        return np.exp(-4 * np.log(2) * ((x - E) / F)**2) * (1 - m / 100)

    @staticmethod
    def gaussian(x, E, F, m):
        return np.exp(-4 * np.log(2) * (1 - m / 100) * ((x - E) / F)**2)

    @staticmethod
    def lorentzian(x, E, F, m):
        return 1 / (1 + 4 * m / 100 * ((x - E) / F)**2)

    @staticmethod
    def gauss_lorentz_OLD(x, center, fwhm, fraction, amplitude):
        return amplitude * (
            PeakFunctions.gaussian(x, center, fwhm, fraction*1) *
            PeakFunctions.lorentzian(x, center, fwhm, fraction*1))

    @staticmethod
    def S_gauss_lorentz(x, center, fwhm, fraction, amplitude):
        return amplitude * (
            (1-fraction/100) * PeakFunctions.gaussian(x, center, fwhm, 0) +
            fraction/100 * PeakFunctions.lorentzian(x, center, fwhm, 100))

    @staticmethod
    def gauss_lorentz(x, center , fwhm, fraction, amplitude):
        peak = amplitude * (
                PeakFunctions.gaussian(x, center, fwhm, fraction * 1) *
                PeakFunctions.lorentzian(x, center, fwhm, fraction * 1))
        return peak


    @staticmethod
    def gauss_lorentz_Area(x, center, area, fwhm, fraction):
        sigma = fwhm / (2 * np.sqrt(2 * np.log(2)))
        height = area / (sigma * np.sqrt(2 * np.pi))
        return height * (
                PeakFunctions.gaussian(x, center, fwhm, fraction * 1) *
                PeakFunctions.lorentzian(x, center, fwhm, fraction * 1))

    @staticmethod
    def S_gauss_lorentz_Area_MISMATCH(x, center, area, fwhm, fraction):
        sigma = fwhm / (2 * np.sqrt(2 * np.log(2)))
        height = area / (sigma * np.sqrt(2 * np.pi))
        Area = height * (
                (1 - fraction / 100) * PeakFunctions.gaussian(x, center, fwhm, 0) +
                fraction / 100 * PeakFunctions.lorentzian(x, center, fwhm, 100))
        # print(f"SGL Area: {Area}")
        return Area

    @staticmethod
    def S_gauss_lorentz_Area(x, center, area, fwhm, fraction):
        sigma = fwhm / (2 * np.sqrt(2 * np.log(2)))
        gamma = fwhm / 2
        height = area / ((1 - fraction / 100) * sigma * np.sqrt(2 * np.pi) + (fraction / 100) * np.pi * gamma)
        return height * (
                (1 - fraction / 100) * PeakFunctions.gaussian(x, center, fwhm, 0) +
                fraction / 100 * PeakFunctions.lorentzian(x, center, fwhm, 100))

    # SHALL NOT BE USEFUL
    @staticmethod
    def tail(x, center, tail_mix, tail_exp, fwhm):

        # Avoid division by zero and negative exponents
        safe_exp = np.maximum(tail_exp, 1e-5)
        safe_mix = np.maximum(tail_mix, 1e-5)
        return np.where(x > center,     np.exp(-safe_exp * np.abs(x - center) ** safe_mix), 0)

    @staticmethod
    def filter_func(x, center):
        return np.where(x <= center, 1, 0)



    @staticmethod
    def S_gauss_lorentz_tail(x, center, fwhm, fraction, amplitude, tail_mix, tail_exp):
        peak = amplitude * (
                (1 - fraction/100) * PeakFunctions.gaussian(x, center, fwhm, 0) +
                fraction/100 * PeakFunctions.lorentzian(x, center, fwhm, 100))
        tail = PeakFunctions.tail(x, center, tail_mix, tail_exp)
        return peak * (1 - tail_mix) + amplitude * tail

    @staticmethod
    def pseudo_voigt(x, center, amplitude, sigma, fraction):
        """
        Custom Pseudo-Voigt function.

        Parameters:
        x : array
            The x values
        center : float
            The peak center
        amplitude : float
            The peak height
        sigma : float
            The peak width (standard deviation for Gaussian component)
        fraction : float
            The fraction of Lorentzian component (0 to 1)

        Returns:
        array : The y values of the Pseudo-Voigt function
        """
        sigma2 = sigma ** 2
        gamma = sigma * np.sqrt(2 * np.log(2))

        gaussian = (1 - fraction/100) * np.exp(-((x - center) ** 2) / (2 * sigma2))
        lorentzian = fraction/100 * (gamma ** 2 / ((x - center) ** 2 + gamma ** 2))

        return amplitude * (gaussian + lorentzian)

    @staticmethod
    def pseudo_voigt_fwhm(x, center, amplitude, fwhm, fraction):
        """
        Custom Pseudo-Voigt function using FWHM.

        Parameters:
        x : array
            The x values
        center : float
            The peak center
        amplitude : float
            The peak height
        fwhm : float
            Full Width at Half Maximum of the peak
        fraction : float
            The fraction of Lorentzian component (0 to 1)

        Returns:
        array : The y values of the Pseudo-Voigt function
        """
        sigma = fwhm / (2 * np.sqrt(2 * np.log(2)))  # Convert FWHM to sigma for Gaussian
        gamma = fwhm / 2  # Convert FWHM to gamma for Lorentzian

        z = (x - center) / sigma

        gaussian = (1 - fraction/100) * np.exp(-z ** 2 / 2) / (sigma * np.sqrt(2 * np.pi))
        lorentzian = fraction/100 * gamma / (np.pi * (gamma ** 2 + (x - center) ** 2))

        return amplitude * (gaussian + lorentzian) * sigma * np.sqrt(2 * np.pi)

    @staticmethod
    def voigt_fwhm(sigma, gamma):
        """
        Approximate the FWHM of a Voigt profile.

        This uses an approximation that is accurate to within a few percent.

        Parameters:
        sigma : float
            The sigma parameter of the Gaussian component
        gamma : float
            The gamma parameter of the Lorentzian component

        Returns:
        float : The approximate FWHM of the Voigt profile
        """
        fg = 2 * sigma * np.sqrt(2 * np.log(2))
        fl = 2 * gamma
        return 0.5346 * fl + np.sqrt(0.2166 * fl ** 2 + fg ** 2)

    @staticmethod
    def skewed_voigt_fwhm(sigma, gamma, skew):
        model = lmfit.models.SkewedVoigtModel()
        x = np.linspace(-20 * sigma, 20 * sigma, 1000)
        y = model.eval(x=x, center=0, amplitude=1.0, sigma=sigma, gamma=gamma, skew=skew)

        max_y = np.max(y)
        half_max = max_y / 2

        # Find points where y crosses half_max
        idx = np.where(y >= half_max)[0]
        if len(idx) >= 2:
            fwhm = abs(x[idx[-1]] - x[idx[0]])
        else:
            fwhm = 2.355 * sigma  # Fallback to Gaussian FWHM

        return fwhm

    @staticmethod
    def pseudo_voigt_amplitude_to_height(amplitude, sigma, fraction):
        """
        Convert amplitude to height for a Pseudo-Voigt profile.

        Parameters:
        amplitude : float
            The amplitude of the Pseudo-Voigt profile
        sigma : float
            The sigma parameter of the profile (related to FWHM)
        fraction : float
            The fraction of Lorentzian component (0 to 1)

        Returns:
        float : The height of the Pseudo-Voigt profile
        """
        sqrt2pi = np.sqrt(2 * np.pi)
        sqrt2ln2 = np.sqrt(2 * np.log(2))

        gaussian_height = amplitude / (sigma * sqrt2pi)
        lorentzian_height = 2 * amplitude / (np.pi * sigma * 2 * sqrt2ln2)

        height = (1 - fraction/100) * gaussian_height + fraction/100 * lorentzian_height

        return height

    @staticmethod
    def pseudo_voigt_height_to_amplitude(height, sigma, fraction):
        """
        Convert height to amplitude for a Pseudo-Voigt profile.

        Parameters:
        height : float
            The height of the Pseudo-Voigt profile
        sigma : float
            The sigma parameter of the profile (related to FWHM)
        fraction : float
            The fraction of Lorentzian component (0 to 1)

        Returns:
        float : The amplitude of the Pseudo-Voigt profile
        """
        sqrt2pi = np.sqrt(2 * np.pi)
        sqrt2ln2 = np.sqrt(2 * np.log(2))

        gaussian_amplitude = height * sigma * sqrt2pi
        lorentzian_amplitude = height * np.pi * sigma * 2 * sqrt2ln2 / 2

        amplitude = (1 - fraction/100) * gaussian_amplitude + fraction/100 * lorentzian_amplitude

        return amplitude

    def voigt_area(height, sigma, gamma):
        from scipy.special import wofz

        # Convert sigma to Gaussian FWHM
        fwhm_g = 2 * sigma * np.sqrt(2 * np.log(2))

        # Convert gamma to Lorentzian FWHM
        fwhm_l = 2 * gamma

        # Calculate the Voigt function at its center
        voigt_max = np.real(wofz((0 + 1j * gamma) / (sigma * np.sqrt(2))))

        # Calculate the area
        area = height * (np.pi * fwhm_l / 2 + np.sqrt(np.pi * np.log(2)) * fwhm_g) / voigt_max

        return area

    @staticmethod
    def get_voigt_height(amplitude, sigma, gamma):
        """
        Calculate the height of a Voigt profile directly using the lmfit model.
        """
        model = lmfit.models.VoigtModel()
        params = model.make_params(amplitude=amplitude, center=0, sigma=sigma, gamma=gamma)
        return model.eval(params, x=0)

    @staticmethod
    def get_skewedvoigt_height(amplitude, sigma, gamma, skew):
        """
        Calculate the height of a Voigt profile directly using the lmfit model.
        """
        model = lmfit.models.SkewedVoigtModel()
        params = model.make_params(amplitude=amplitude, center=0, sigma=sigma, gamma=gamma,skew=skew)
        return model.eval(params, x=0)

    @staticmethod
    def voigt_height_to_area(height, sigma, gamma):
        voigt = VoigtModel()
        x = np.linspace(-10 * sigma, 10 * sigma, 1000)
        params = voigt.make_params(center=0, sigma=sigma, gamma=gamma, amplitude=1)
        y = voigt.eval(params, x=x)
        max_y = np.max(y)
        amplitude = height / max_y
        return amplitude  # For distribution models, amplitude is equivalent to area

    @staticmethod
    def skewedvoigt_height_to_area(height, sigma, gamma, skew):
        if sigma <= 0 or gamma < 0:
            raise ValueError("Invalid sigma/gamma parameters")

        skewedvoigt = lmfit.models.SkewedVoigtModel()
        x_range = max(abs(skew) * sigma * 20, 10 * sigma)  # Wider range for high skew
        x = np.linspace(-x_range, x_range, 1000)

        try:
            params = skewedvoigt.make_params(center=0, sigma=sigma, gamma=gamma, amplitude=1, skew=skew)
            y = skewedvoigt.eval(params, x=x)
            max_y = np.max(y)
            if max_y <= 0:
                raise ValueError("Invalid peak shape")
            amplitude = height / max_y
            return amplitude
        except:
            return height * (sigma * np.sqrt(2 * np.pi))  # Fallback to Gaussian area

    @staticmethod
    def get_pseudo_voigt_height(amplitude, sigma, fraction):
        """
        Calculate the height of a Pseudo-Voigt profile directly using the lmfit model.
        """
        model = lmfit.models.PseudoVoigtModel()
        params = model.make_params(amplitude=amplitude, center=0, sigma=sigma, fraction=fraction/100)
        return model.eval(params, x=0)

    @staticmethod
    def find_lorentzian_fwhm(true_fwhm, center, amplitude, sigma, gamma, max_iterations=50):
        def objective(lorentzian_fwhm):
            return abs(PeakFunctions.calculate_true_fwhm(center, amplitude, lorentzian_fwhm, sigma, gamma) - true_fwhm)

        if not PeakFunctions.is_valid_scalar(true_fwhm):
            raise ValueError(f"Invalid true_fwhm: {true_fwhm}")

        try:
            result = minimize_scalar(objective, bounds=(true_fwhm * 0.1, true_fwhm * 10), method='bounded',
                                     options={'maxiter': max_iterations})
            return result.x
        except Exception as e:
            print(f"Error in minimize_scalar: {e}")
            return true_fwhm  # Return the input FWHM as a fallback

    @staticmethod
    def calculate_true_fwhm(center, amplitude, fwhm, sigma, gamma, tolerance=1e-6, max_iterations=50):
        def la_function(x):
            return PeakFunctions.LA(x, center, amplitude, fwhm, sigma, gamma)

        half_max = la_function(center) / 2

        def find_half_max(x):
            return la_function(x) - half_max

        try:
            left_x = brentq(find_half_max, center - 10 * fwhm, center, maxiter=max_iterations, xtol=tolerance)
            right_x = brentq(find_half_max, center, center + 10 * fwhm, maxiter=max_iterations, xtol=tolerance)
            return right_x - left_x
        except ValueError as e:
            print(f"Error in calculate_true_fwhm: {e}")
            return fwhm  # Return the input FWHM as a fallback

    @staticmethod
    def LA_OTHER(x, center, amplitude, true_fwhm, sigma, gamma):
        true_fwhm = min(true_fwhm, 20)  # Limit true_fwhm to a maximum of 20

        if not PeakFunctions.is_valid_scalar(true_fwhm):
            raise ValueError(f"Invalid true_fwhm value: {true_fwhm}")
        if not PeakFunctions.is_valid_scalar(center):
            raise ValueError(f"Invalid center value: {center}")
        if not PeakFunctions.is_valid_scalar(amplitude):
            raise ValueError(f"Invalid amplitude value: {amplitude}")
        if not PeakFunctions.is_valid_scalar(sigma):
            raise ValueError(f"Invalid sigma value: {sigma}")
        if not PeakFunctions.is_valid_scalar(gamma):
            raise ValueError(f"Invalid gamma value: {gamma}")

        try:
            lorentzian_fwhm = PeakFunctions.estimate_lorentzian_fwhm(true_fwhm, sigma, gamma)
        except Exception as e:
            print(f"Error in estimate_lorentzian_fwhm: {e}")
            lorentzian_fwhm = true_fwhm  # Fallback to true_fwhm if estimation fails

        return amplitude * np.where(
            x <= center,
            1 / (1 + 4 * ((x - center) / lorentzian_fwhm) ** 2) ** gamma,
            1 / (1 + 4 * ((x - center) / lorentzian_fwhm) ** 2) ** sigma
        )

    @staticmethod
    def estimate_lorentzian_fwhm(true_fwhm, sigma, gamma, tolerance=1e-6, max_iterations=50):
        def peak_function(x, fwhm):
            return 1 / (1 + 4 * (x / fwhm) ** 2) ** ((sigma + gamma) / 2)

        def find_half_max(fwhm):
            half_max = peak_function(0, fwhm) / 2
            try:
                x_half = brentq(lambda x: peak_function(x, fwhm) - half_max, 0, fwhm * 10,
                                xtol=tolerance, maxiter=max_iterations)
                return 2 * x_half - true_fwhm
            except ValueError:
                return fwhm - true_fwhm  # Return a value that won't be zero to continue the search

        try:
            print("FWHM = "+str(true_fwhm))
            lorentzian_fwhm = brentq(find_half_max, true_fwhm * 0.1, true_fwhm * 10,
                                     xtol=tolerance, maxiter=max_iterations)
            return lorentzian_fwhm
        except ValueError:
            print(f"Failed to estimate Lorentzian FWHM. Using true FWHM: {true_fwhm}")
            return true_fwhm

    @staticmethod
    def is_valid_scalar(value):
        return value is not None and np.isfinite(value) and value > 0


    @staticmethod
    # @jit(nopython=True, parallel=True)
    def LA(x, center, amplitude, fwhm, sigma, gamma):
        #amplitude here is the area

        # Calculate lorentzian width from the input FWHM
        F = 2 * fwhm / (np.sqrt(2 ** (1 / sigma) - 1) + np.sqrt(2 ** (1 / gamma) - 1))

        # Create the peak shape with unit amplitude
        peak_shape = np.where(
            x <= center,
            1 / (1 + 4 * ((x - center) / F) ** 2) ** gamma,
            1 / (1 + 4 * ((x - center) / F) ** 2) ** sigma
        )

        # Sort x values and corresponding peak shape for correct integration
        sort_idx = np.argsort(x)
        x_sorted = x[sort_idx]
        peak_shape_sorted = peak_shape[sort_idx]

        # Calculate the area of unit amplitude peak
        unit_area = abs(trapz(peak_shape_sorted, x_sorted))

        # Calculate required amplitude to achieve desired area
        height = amplitude / unit_area if unit_area != 0 else 0

        return height * peak_shape

    @staticmethod
    # @jit(nopython=True, parallel=True)
    def LAxG(x, center, amplitude, fwhm, sigma, gamma, fwhm_g):
        # Define the LA function
        # gaussian_fwhm =0.64 # now done through the grid

        # Calculate lorentzian width from the input FWHM
        F = 2 * fwhm / (np.sqrt(2 ** (1 / sigma) - 1) + np.sqrt(2 ** (1 / gamma) - 1))
        def LA_N(x):
            return np.where(
                x <= 0,
                1 / (1 + 4 * ((x ) / F) ** 2) ** gamma,
                1 / (1 + 4 * ((x ) / F) ** 2) ** sigma
            )

        # Define the Gaussian function
        def gaussian(x, fwhm_g):
            return np.exp(-4 * np.log(2) * ((x ) / fwhm_g) ** 2)

        x_range = max(x.max() - x.min(), 4 * fwhm)
        x_high_res = np.linspace(- x_range / 2, + x_range / 2, len(x) * 4)

        la = LA_N(x_high_res)
        gauss = gaussian(x_high_res, fwhm_g)

        convolved = convolve(la, gauss, mode='same') / sum(gauss)

        peak_shape = np.interp(x - center, x_high_res, convolved)

        # Sort x values and corresponding peak shape for correct integration
        sort_idx = np.argsort(x)
        x_sorted = x[sort_idx]
        peak_shape_sorted = peak_shape[sort_idx]

        # Calculate the area of unit amplitude peak
        unit_area = abs(trapz(peak_shape_sorted, x_sorted))

        # Calculate required amplitude to achieve desired area
        height = amplitude / unit_area if unit_area != 0 else 0

        return height * peak_shape


    @staticmethod
    def calculate_rsd_BEF_v1_6(y_experimental, y_fitted):
        residuals = y_experimental - y_fitted
        n = len(residuals)
        denominator = y_experimental
        term = (residuals / np.sqrt(denominator)) ** 2
        sum_term = np.sum(term)
        rsd = np.sqrt(sum_term / n)

        # rsd2 = np.sqrt(np.mean(residuals ** 2)) / np.mean(y_experimental) * 100
        # print(f"RSD: {rsd2}")
        return rsd

    @staticmethod
    def calculate_rsd_BEF_v1_71(y_experimental, y_fitted):
        """
        Calculate weighted RSD for XPS data using Poisson statistics weighting.
        Returns RSD as a percentage.
        """
        residuals = y_experimental - y_fitted

        # Protect against zero/negative values (common in XPS background regions)
        safe_denominator = np.maximum(y_experimental, 1.0)

        # Calculate weighted residuals (Poisson weighting: 1/sqrt(signal))
        weighted_residuals = residuals / np.sqrt(safe_denominator)

        # Calculate weighted RMS error
        weighted_rms = np.sqrt(np.mean(weighted_residuals ** 2))

        # Convert to relative percentage
        mean_signal = np.mean(y_experimental)
        if mean_signal > 0:
            rsd = (weighted_rms / np.sqrt(mean_signal)) * 100.0
        else:
            rsd = 0.0

        return rsd

    @staticmethod
    def calculate_rsd(y_experimental, y_fitted):
        """
        Calculate all three RSD metrics for comparison.
        Returns tuple: (old_rsd, normalized_chi, rsd_percent)
        """
        old_rsd = PeakFunctions.calculate_rsd_old(y_experimental, y_fitted)
        norm_chi = PeakFunctions.calculate_normalized_chi(y_experimental, y_fitted)
        rsd_pct = PeakFunctions.calculate_rsd_percent(y_experimental, y_fitted)
        return old_rsd, norm_chi, rsd_pct

    @staticmethod
    def calculate_rsd_old(y_experimental, y_fitted):
        """
        Original weighted RSD calculation (pre-v1.7).
        """
        residuals = y_experimental - y_fitted
        safe_denominator = np.maximum(y_experimental, 1.0)
        weighted_residuals = residuals / np.sqrt(safe_denominator)
        weighted_rms = np.sqrt(np.mean(weighted_residuals ** 2))
        mean_signal = np.mean(y_experimental)
        if mean_signal > 0:
            return (weighted_rms / np.sqrt(mean_signal)) * 100.0
        return 0.0

    @staticmethod
    def calculate_normalized_chi(y_experimental, y_fitted):
        """
        Normalized chi (sqrt of reduced chi-squared) for XPS data.
        Uses Poisson statistics where variance = signal intensity.
        ~1.0 indicates a statistically good fit.
        """
        residuals = y_experimental - y_fitted
        n = len(residuals)
        variance = np.maximum(y_experimental, 1.0)
        chi_squared = np.sum(residuals ** 2 / variance)
        reduced_chi_sq = chi_squared / n
        return np.sqrt(reduced_chi_sq)

    @staticmethod
    def calculate_rsd_percent(y_experimental, y_fitted):
        """
        Relative Standard Deviation as percentage.
        RSD% = (RMSE / mean_signal) * 100
        """
        residuals = y_experimental - y_fitted
        rmse = np.sqrt(np.mean(residuals ** 2))
        mean_signal = np.mean(y_experimental)
        if mean_signal > 0:
            return (rmse / mean_signal) * 100.0
        return 0.0

    @staticmethod
    def get_doniach_sunjic_height(amplitude, sigma, gamma, skew):
        """
        Calculate the height of a Doniach-Sunjic profile.
        """
        model = lmfit.models.DoniachModel()
        params = model.make_params(amplitude=amplitude, center=0, sigma=sigma, gamma=gamma, asymmetry=skew)
        height = model.eval(params, x=0)
        return height

    @staticmethod
    def doniach_sunjic_height_to_amplitude(height, sigma, gamma, skew):
        """
        Convert height to area for a Doniach-Sunjic profile.
        """
        model = lmfit.models.DoniachModel()
        x = np.linspace(-10 * sigma, 10 * sigma, 1000)
        params = model.make_params(center=0, sigma=sigma, gamma=gamma, asymmetry=skew, amplitude=1)
        y = model.eval(params, x=x)
        max_y = np.max(y)
        amplitude = height / max_y
        return amplitude

    @staticmethod
    def doniach_sunjic_area_to_amplitude(area, sigma, gamma, skew):
        """
        Convert area to amplitude for a Doniach-Sunjic profile.

        Inverse of doniach_sunjic_height_to_area function.
        """
        model = lmfit.models.DoniachModel()

        # Convert area to float to ensure scalar value
        area = float(area)

        # Calculate the area of a unit-amplitude peak
        x_wide = np.linspace(-20 * sigma, 20 * sigma + 40 * sigma * skew, 2000)
        params = model.make_params(center=0, sigma=sigma, asymmetry=skew, gamma=gamma, amplitude=1.0)
        y = model.eval(params, x=x_wide)

        # Calculate area of unit-amplitude peak
        unit_area = float(trapz(y, x_wide))

        # Required amplitude to achieve desired area
        amplitude = area / unit_area if unit_area != 0 else 0

        return amplitude

    @staticmethod
    def doniach_sunjic_height_to_area(height, sigma, gamma, skew):
        model = lmfit.models.DoniachModel()

        # First, find amplitude that gives desired height
        x_test = np.array([0])  # Just evaluate at center
        params = model.make_params(center=0, sigma=sigma, asymmetry=skew, amplitude=1)
        max_y = model.eval(params, x=x_test)[0]
        amplitude = height / max_y

        # Now calculate the area with this amplitude
        x_wide = np.linspace(-20 * sigma, 20 * sigma + 40 * sigma * skew, 2000)
        y = model.eval(params, x=x_wide)
        y = y * amplitude  # Scale by our calculated amplitude

        # Numerical integration to get area
        area = trapz(y, x_wide)

        return area  # Return the actual integrated area

    @staticmethod
    def doniach_sunjic_area_to_height_OLD(area, sigma, gamma, skew):
        model = lmfit.models.DoniachModel()

        # First, create a peak with known amplitude and get its height at center
        test_amplitude = 1.0
        params = model.make_params(center=0, sigma=sigma, asymmetry=skew, gamma=gamma, amplitude=test_amplitude)

        # Get height at center
        center_height = model.eval(params, x=np.array([0]))[0]

        # Get area of this test peak
        x_wide = np.linspace(-20 * sigma, 20 * sigma + 40 * sigma * skew, 2000)
        y_test = model.eval(params, x=x_wide)
        test_area = trapz(y_test, x_wide)

        # Scale factor: area per unit height
        area_per_unit_height = test_area / center_height

        # Calculate required height for desired area
        height = float(area) / float(area_per_unit_height) if area_per_unit_height != 0 else 0

        return height

    @staticmethod
    def doniach_sunjic_area_to_height(area, sigma, gamma, skew):
        """Convert area to height for a Doniach-Sunjic profile using a two-step approach."""
        if sigma <= 0 or area <= 0:
            return 0

        model = lmfit.models.DoniachModel()

        # Step 1: Calculate amplitude that gives desired area
        # Use wider x-range that adapts to skew parameter
        x_range = max(20 * sigma, 5 * sigma * (1 + 5 * abs(skew)))
        x_wide = np.linspace(-x_range, x_range + 2 * x_range * skew, 2000)

        # Get area for a unit amplitude peak
        params = model.make_params(center=0, sigma=sigma, asymmetry=skew, gamma=gamma, amplitude=1.0)
        y_unit = model.eval(params, x=x_wide)
        unit_area = trapz(y_unit, x_wide)

        # Calculate required amplitude
        if abs(unit_area) < 1e-10:
            return 0
        amplitude = area / unit_area

        # Step 2: Calculate height at center with this amplitude
        height = model.eval(params, x=np.array([0]))[0] * amplitude

        return height

    @staticmethod
    def calculate_actual_fwhm(x_values, position, height, grid_fwhm, lg_ratio, area, sigma, gamma, skew, model):
        """Calculate the actual FWHM from the peak shape."""
        # Create a high-resolution x range around the peak for accurate FWHM measurement
        x_range = 10 * grid_fwhm
        x_high_res = np.linspace(position - x_range / 2, position + x_range / 2, 1000)

        # Generate peak shape based on the model
        if model in ["Voigt (Area, L/G, \u03c3)", "Voigt (Area, \u03c3, \u03b3)"]:
            peak_model = lmfit.models.VoigtModel()
            sigma_val = sigma / 2.355
            gamma_val = gamma / 2
            amplitude = height / peak_model.eval(center=0, amplitude=1, sigma=sigma_val, gamma=gamma_val, x=0)
            params = peak_model.make_params(center=position, amplitude=amplitude, sigma=sigma_val, gamma=gamma_val)
            y_values = peak_model.eval(params, x=x_high_res)
        elif model in ["Voigt (Area, L/G, \u03c3, S)"]:
            peak_model = lmfit.models.SkewedVoigtModel()
            params = peak_model.make_params(center=position, amplitude=area, sigma=sigma / 2.355, gamma=gamma / 2,
                                            skew=skew)
            y_values = peak_model.eval(params, x=x_high_res)
        elif model == "DS (A, \u03c3, \u03b3)":
            peak_model = lmfit.models.DoniachModel()
            params = peak_model.make_params(center=position, amplitude=area, sigma=sigma, gamma=gamma, asymmetry=skew)
            y_values = peak_model.eval(params, x=x_high_res)
        elif model == "ExpGauss.(Area, \u03c3, \u03b3)":
            peak_model = lmfit.models.ExponentialGaussianModel()
            params = peak_model.make_params(center=position, amplitude=area, sigma=sigma, gamma=gamma)
            y_values = peak_model.eval(params, x=x_high_res)
        elif model == "Pseudo-Voigt (Area)":
            peak_model = lmfit.models.PseudoVoigtModel()
            amplitude = height / peak_model.eval(center=0, amplitude=1, sigma=grid_fwhm / 2, fraction=lg_ratio / 100,
                                                 x=0)
            params = peak_model.make_params(center=position, amplitude=amplitude, sigma=grid_fwhm / 2,
                                            fraction=lg_ratio / 100)
            y_values = peak_model.eval(params, x=x_high_res)
        elif model in ["LA (Area, \u03c3, \u03b3)", "LA (Area, \u03c3/\u03b3, \u03b3)"]:
            y_values = PeakFunctions.LA(x_high_res, position, area, grid_fwhm, sigma, gamma)
        elif model in ["LA*G (Area, \u03c3/\u03b3, \u03b3)"]:
            y_values = PeakFunctions.LAxG(x_high_res, position, area, grid_fwhm, sigma, gamma, skew)
        elif model == "GL (Height)":
            y_values = PeakFunctions.gauss_lorentz(x_high_res, position, grid_fwhm, lg_ratio, height)
        elif model == "SGL (Height)":
            y_values = PeakFunctions.S_gauss_lorentz(x_high_res, position, grid_fwhm, lg_ratio, height)
        elif model == "GL (Area)":
            y_values = PeakFunctions.gauss_lorentz_Area(x_high_res, position, area, grid_fwhm, lg_ratio)
        elif model == "SGL (Area)":
            y_values = PeakFunctions.S_gauss_lorentz_Area(x_high_res, position, area, grid_fwhm, lg_ratio)
        elif model == "D-parameter":
            return grid_fwhm  # Return grid FWHM for D-parameter
        else:
            return grid_fwhm  # Return grid FWHM for unknown models

        # Calculate the FWHM from the peak shape
        peak_max = np.max(y_values)
        half_max = peak_max / 2

        # Find crossing points
        above_half_max = y_values >= half_max
        crossing_indices = np.where(np.diff(above_half_max))[0]

        if len(crossing_indices) >= 2:
            # Linear interpolation to find more accurate crossing points
            x1, x2 = crossing_indices[0], crossing_indices[-1]

            # Left crossing
            y1, y2 = y_values[x1], y_values[x1 + 1]
            x_left = x_high_res[x1] + (half_max - y1) * (x_high_res[x1 + 1] - x_high_res[x1]) / (y2 - y1)

            # Right crossing
            y1, y2 = y_values[x2], y_values[x2 + 1]
            x_right = x_high_res[x2] + (half_max - y1) * (x_high_res[x2 + 1] - x_high_res[x2]) / (y2 - y1)

            actual_fwhm = x_right - x_left
        else:
            # Fallback to grid FWHM if crossing points can't be found
            actual_fwhm = grid_fwhm

        return actual_fwhm

    # In Peak_Functions.py, add to PeakFunctions class:
    @staticmethod
    def DS_G(x, center, amplitude, gamma, skew, sigma):
        """
        Doniach-Sunjic function convoluted with a Gaussian.

        Parameters:
        x : array - Energy values
        center : float - Peak position
        amplitude : float - Area of the peak
        gamma : float - DS width parameter (Grid 8)
        skew : float - DS asymmetry parameter (Grid 9, alpha in equation)
        sigma : float - Width of the Gaussian function (Grid 7)
        """

        # Define the DS function
        def ds_func(x):
            x = -x
            # Avoid numerical instabilities
            skew_safe = np.clip(skew, 0.001, 0.999)

            denominator = (gamma ** 2 + x ** 2) ** ((1 - skew_safe) / 2)
            arctangent = np.arctan2(x, gamma)
            cosine_term = np.cos(np.pi * skew_safe / 2 + (1 - skew_safe) * arctangent)

            return cosine_term / denominator

        # Define the Gaussian function
        def gaussian(x, fwhm):
            return np.exp(-4 * np.log(2) * (x / fwhm) ** 2)

        # Create high-resolution x array centered at 0
        x_range = max(x.max() - x.min(), 4 * (gamma + sigma))
        x_high_res = np.linspace(-x_range / 2, x_range / 2, len(x) * 4)

        # Calculate DS and Gaussian
        ds = ds_func(x_high_res)
        gauss = gaussian(x_high_res, sigma)
        gauss = gauss / np.sum(gauss)  # Normalize

        # Perform convolution
        convolved = convolve(ds, gauss, mode='same')

        # Interpolate to original x grid
        peak_shape = np.interp(x - center, x_high_res, convolved)

        # Calculate area for normalization
        sort_idx = np.argsort(x)
        x_sorted = x[sort_idx]
        peak_shape_sorted = peak_shape[sort_idx]
        unit_area = abs(trapz(peak_shape_sorted, x_sorted))

        # Scale to achieve the requested amplitude
        height = amplitude / unit_area if unit_area != 0 else 0

        return height * peak_shape

class OtherCalc:
    @staticmethod
    def smooth_and_differentiate(x_values, y_values, smooth_width=2.0, pre_smooth=1, diff_width=1.0, post_smooth=1, algorithm="Gaussian"):
        from scipy.ndimage import gaussian_filter
        from scipy.signal import savgol_filter, wiener
        import numpy as np

        # Smoothing function based on algorithm
        def apply_smooth(data, width, algorithm):
            if algorithm == "Gaussian":
                return gaussian_filter(data, width)
            elif algorithm == "Savitsky-Golay":
                window = int(width * 10) if int(width * 10) % 2 == 1 else int(width * 10) + 1
                return savgol_filter(data, window, 3)
            elif algorithm == "Moving Average":
                window = int(width * 10)
                return np.convolve(data, np.ones(window)/window, mode='same')
            elif algorithm == "Wiener":
                return wiener(data, int(width * 10))
            else:  # "None"
                return data

        # Pre-smoothing passes
        smoothed = y_values.copy()
        for _ in range(int(pre_smooth)):
            smoothed = apply_smooth(smoothed, smooth_width, algorithm)

        # Calculate derivative
        derivative = -1 * np.gradient(smoothed, x_values)

        # Post-smoothing passes
        for _ in range(int(post_smooth)):
            derivative = apply_smooth(derivative, diff_width, algorithm)

        # Normalize derivative to data range
        data_range = np.max(y_values) - np.min(y_values)
        deriv_range = np.max(derivative) - np.min(derivative)
        normalized_deriv = ((derivative - np.min(derivative)) / deriv_range * data_range) + np.min(y_values)

        return normalized_deriv



