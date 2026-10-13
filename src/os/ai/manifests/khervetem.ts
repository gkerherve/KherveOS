// AI tools of kTEM (the TEM technique of KherveFitting-AI as an app).
// The `run` actions are src/apps/khervetem/actions.ts.

import { techniqueToolSet } from './technique.ts'

export const KHERVETEM_TOOL_SET = techniqueToolSet({
  app: 'khervetem',
  name: 'kTEM',
  summary: 'TEM images: pixel-size calibration, nanoparticle sizes, lattice-fringe spacing, FFT d-spacings, PCA denoising.',
  keywords: ['khervetem', 'tem', 'transmission electron microscopy', 'electron micrograph', 'hrtem', 'nanoparticle', 'particle size', 'lattice fringes', 'd-spacing', 'fft', 'diffractogram', 'digitalmicrograph', 'dm3', 'dm4', 'bragg filter'],
  files: 'TEM image (.dm3, .dm4, .dm5, .tif, .tiff, .png)',
  actions: {
    calibrate: 'options.pixel_size: the pixel size in nm (a .dm3 file carries it; a TIFF / PNG does not, and every length is in pixels until it is set). Do this first on an uncalibrated image.',
    particles: 'Detects nanoparticles: options.polarity ("Dark on bright" for bright-field, "Bright on dark"), options.method ("Otsu", "Top hat", "Manual", "Blobs" = round particles, the default), options.level (Manual), options.sensitivity (Blobs, 1-99), options.min_size / max_size (px), options.fill_holes, options.exclude_edge, options.split, options.split_multiple. Returns count, mean / median diameter, density, coverage.',
    particle_sheet: 'options.kind ("count" or "frequency"): makes the size distribution a sheet (TEM~Count / TEM~Freq).',
    profile_line: 'A line profile: options.x0, y0, x1, y1 = the end points in image PIXELS (column, row), options.width = averaging width in px. Draw it across lattice fringes, then run fringe_spacing.',
    fringe_spacing: 'Finds the fringe peaks of the current profile and the mean spacing in nm: options.smooth, options.prominence (%).',
    fft: 'FFT of a region of the image (a sheet TEM~FFT): options.x, y, width, height = the rectangle in image pixels (centre and size), options.angle; with none given, the middle square of the whole image. Needs a calibrated image for d-spacings in nm.',
    fft_spots: 'On the FFT sheet: detects the diffraction spots, pairs and groups them: one row per d-spacing family (d in nm, g in 1/nm, angle, number of spots).',
    denoise: 'PCA denoising of the whole image into a new sheet: options.mode ("Line-wise" or "Patch-based"), options.components (kept), options.patch / options.stride (patch-based).',
  },
})
