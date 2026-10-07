// Builders for the built-in example schematics.
// Ported from the desktop KhervePaint (example_sketches.py).

import type { Spec } from '../spec'
import { BEAM, COOL, DETC, INK, MUTE, OPTIC, SIGNAL, TINT_BEAM, TINT_BODY, TINT_COOL, TINT_DET, TINT_OPTIC, TINT_SAMP, CATEGORY_COLOR, _aperture, _arrow, _beam, _box, _circle, _legend, _lens, _line, _micrograph, _page, _plot, _poly, _round, _stage, _t, _tc } from './example_kit'

export const SP = CATEGORY_COLOR.Spectroscopy
export const MS = CATEGORY_COLOR['Mass spectrometry']
export const DF = CATEGORY_COLOR.Diffraction
export const MC = CATEGORY_COLOR.Microscopy
export const TH = CATEGORY_COLOR['Thermal & sorption']
export const CH = CATEGORY_COLOR.Chromatography
// n small circles evenly spaced on a ring of radius r about (cx,cy).
function _ring(cx: any, cy: any, r: any, n: any, d: any, color = '#dce8fb', start = 0): Spec[] {
  let a
  const out: Spec[] = []
  for (let i = 0; i < n; i++) {
    a = start + 2 * Math.PI * i / n
    out.push(_circle(cx + r * Math.cos(a) - d / 2, cy + r * Math.sin(a) - d / 2, d, undefined, color, color, 0))
  }
  return out
}

// ===================================================== Microscopy: TEM
export function build_tem(): Spec[] {
  const cx = 330
  let body: Spec[] = [_round(cx - 150, 208, 300, 612, undefined, TINT_BODY, '#c4ccd4')]
  // electron gun
  body.push(_poly('triangle', cx - 20, 224, 40, 32, undefined, TINT_BEAM, BEAM, undefined, 180))
  body.push(..._aperture(cx, 286))
  // beam envelope
  const pts = [[258, 5], [312, 64], [330, 64], [366, 6], [415, 52], [492, 64], [520, 64], [567, 78], [606, 78], [642, 7], [688, 50], [748, 66], [818, 120]]
  body.push(..._beam(cx, pts, SIGNAL, 2))
  // optical column
  body.push(_lens(cx, 330, 150), _lens(cx, 430, 140))
  body.push(..._aperture(cx, 366, 8, 26))
  body.push(..._stage(cx, 498, 130, 'specimen'))
  body.push(_lens(cx, 585, 200, undefined, undefined, 34))
  body.push(..._aperture(cx, 642, 8, 30))
  body.push(_lens(cx, 700, 150), _lens(cx, 760, 160))
  body.push(_box(cx - 120, 822, 240, 70, 'fluorescent screen / CCD', TINT_DET, DETC, 2))
  // callouts
  for (const [cy, txt] of ([[256, 'electron gun'], [330, 'condenser lens 1'], [430, 'condenser lens 2'], [498, 'specimen on grid'], [585, 'objective lens'], [700, 'intermediate lens'], [760, 'projector lens']] as any[][])) {
    body.push(_line(cx + 150, cy, cx + 178, cy, '#aab6c0', 1), _t(cx + 184, cy - 10, txt, 15, INK))
  }
  body.push(_t(cx - 150, 902, 'evacuated electron column', 15, MUTE))
  // right: micrograph + SAED
  body.push(..._micrograph(660, 226, 470, 300, [[120, 88, 74], [255, 150, 52], [330, 78, 38], [180, 214, 46], [388, 198, 30]], 'Bright-field TEM image', '100 nm'))
  body.push(_box(660, 558, 470, 256, undefined, '#0a0c10', INK, 2))
  const sc = [895, 686]
  body.push(_circle(sc[0] - 9, sc[1] - 9, 18, undefined, '#dce8fb', '#dce8fb', 0))
  body.push(..._ring(sc[0], sc[1], 64, 8, 13))
  body.push(..._ring(sc[0], sc[1], 108, 12, 10, undefined, 0.26))
  body.push(_tc(895, 824, 'Selected-area diffraction (SAED)', 15, MUTE))
  // bottom: EDS
  body.push(..._plot(120, 904, 1000, 466, 'X-ray energy (keV)', 'Counts', [[0, 0.08], [0.1, 0.08], [0.108, 0.82], [0.118, 0.08], [0.27, 0.08], [0.278, 0.5], [0.288, 0.08], [0.46, 0.08], [0.468, 0.66], [0.478, 0.08], [0.64, 0.08], [0.648, 0.34], [0.658, 0.08], [0.82, 0.08], [0.828, 0.46], [0.838, 0.08], [1, 0.08]], [[0.108, 'C'], [0.278, 'O'], [0.468, 'Fe'], [0.648, 'Cu'], [0.828, 'Pt']], SIGNAL))
  return _page('Transmission Electron Microscopy (TEM)', 'Nanoscale structure, morphology & crystallography', MC, body, 'A focused electron beam is transmitted through a thin specimen and magnified by a stack of magnetic lenses; imaging, diffraction (SAED) and EDS run on the same column.')
}

// ===================================================== Microscopy: SEM
export function build_sem(): Spec[] {
  const cx = 330
  let body: Spec[] = [_round(cx - 150, 208, 300, 470, undefined, TINT_BODY, '#c4ccd4')]
  body.push(_poly('triangle', cx - 20, 224, 40, 32, undefined, TINT_BEAM, BEAM, undefined, 180))
  const pts = [[258, 5], [306, 56], [324, 56], [360, 7], [404, 46], [452, 46], [470, 7], [520, 52], [560, 78]]
  body.push(..._beam(cx, pts, SIGNAL, 2))
  body.push(_lens(cx, 322, 140), _lens(cx, 432, 150))
  body.push(..._aperture(cx, 376, 8, 24))
  // scan coils
  body.push(_box(cx - 96, 496, 36, 44, undefined, TINT_OPTIC, OPTIC), _box(cx + 60, 496, 36, 44, undefined, TINT_OPTIC, OPTIC))
  body.push(..._stage(cx, 596, 150, 'sample'))
  // detectors
  body.push(_box(cx + 110, 540, 96, 50, 'SE / BSE\ndetector', TINT_DET, DETC, 2))
  body.push(_arrow(cx + 40, 590, cx + 110, 560, SIGNAL, 2))
  for (const [cy, txt] of ([[256, 'electron gun'], [322, 'condenser lens'], [432, 'objective lens'], [516, 'scan coils'], [596, 'stage / sample']] as any[][])) {
    body.push(_line(cx + 150, cy, cx + 178, cy, '#aab6c0', 1), _t(cx + 184, cy - 10, txt, 15, INK))
  }
  body.push(_t(cx - 150, 700, 'evacuated column', 15, MUTE))
  body.push(..._micrograph(660, 226, 470, 430, [[120, 120, 96], [250, 250, 70], [360, 140, 54], [170, 320, 60], [380, 330, 40], [300, 60, 34]], 'Secondary-electron image', '10 µm'))
  body.push(..._plot(120, 904, 1000, 466, 'X-ray energy (keV)', 'Counts', [[0, 0.08], [0.12, 0.08], [0.128, 0.78], [0.14, 0.08], [0.32, 0.08], [0.328, 0.55], [0.34, 0.08], [0.52, 0.08], [0.528, 0.42], [0.54, 0.08], [0.72, 0.08], [0.728, 0.6], [0.74, 0.08], [1, 0.08]], [[0.128, 'C'], [0.328, 'O'], [0.528, 'Al'], [0.728, 'Si']], SIGNAL))
  return _page('Scanning Electron Microscopy (SEM)', 'Surface topography & composition (with EDS)', MC, body, 'A finely focused electron probe is rastered across the surface; secondary and backscattered electrons build the image while characteristic X-rays give EDS microanalysis.')
}

// ===================================================== Microscopy: AFM
export function build_afm(): Spec[] {
  let body: Spec[] = [_round(150, 470, 760, 250, undefined, TINT_BODY, '#c4ccd4')]
  // laser + photodiode
  body.push(_box(180, 250, 130, 70, 'laser\ndiode', TINT_BEAM, BEAM, 2))
  body.push(_box(560, 230, 150, 90, 'position-sensitive\nphotodiode', TINT_DET, DETC, 2))
  body.push(_arrow(310, 300, 470, 470, BEAM, 2), _arrow(470, 470, 600, 320, BEAM, 2))
  // cantilever + tip
  body.push(_line(330, 470, 470, 470, INK, 5))
  body.push(_poly('triangle', 452, 470, 34, 46, undefined, '#dfe6ec', INK, undefined, 180))
  body.push(_t(300, 426, 'cantilever + tip', 15, INK))
  // sample + piezo
  body.push(_box(360, 560, 360, 70, 'sample', TINT_SAMP, '#9a7b1f', 2))
  body.push(_box(360, 632, 360, 64, 'piezo scanner  (x, y, z)', TINT_OPTIC, OPTIC, 2))
  // feedback loop
  body.push(_box(740, 470, 150, 70, 'feedback\ncontroller', '#eef2f5', INK, 2))
  body.push(_arrow(710, 300, 740, 470, DETC, 2), _arrow(815, 540, 720, 660, OPTIC, 2))
  body.push(..._legend(180, 348, [[BEAM, 'laser deflection'], [DETC, 'feedback signal'], [OPTIC, 'piezo drive']]))
  body.push(..._plot(160, 880, 920, 480, 'tip position (µm)', 'height (nm)', [[0, 0.3], [0.08, 0.55], [0.16, 0.35], [0.24, 0.7], [0.32, 0.5], [0.4, 0.85], [0.48, 0.45], [0.56, 0.6], [0.64, 0.3], [0.72, 0.65], [0.8, 0.4], [0.88, 0.72], [0.96, 0.45], [1, 0.55]], undefined, SIGNAL))
  return _page('Atomic Force Microscopy (AFM)', 'Surface topography at the nanoscale', MC, body, 'A sharp tip on a flexible cantilever rasters the surface; laser-beam deflection feeds a feedback loop that drives the piezo scanner, mapping height with sub-nanometre resolution.')
}

// ===================================================== Microscopy: STM
export function build_stm(): Spec[] {
  let body: Spec[] = [_round(170, 360, 700, 340, undefined, TINT_BODY, '#c4ccd4')]
  // tip approaching surface
  body.push(_box(420, 380, 60, 90, 'W tip', '#cdd6de', MUTE, 2))
  body.push(_poly('triangle', 432, 470, 36, 40, undefined, '#cdd6de', INK, undefined, 180))
  // tunnelling gap
  body.push(_line(450, 512, 450, 540, BEAM, 2))
  body.push(_t(470, 506, 'tunnelling gap (~1 nm)', 15, BEAM))
  body.push(_box(250, 540, 420, 70, 'sample (conductive)', TINT_SAMP, '#9a7b1f', 2))
  body.push(_box(250, 612, 420, 60, 'piezo scanner', TINT_OPTIC, OPTIC, 2))
  // bias + current amp
  body.push(_box(700, 380, 150, 70, 'bias voltage', '#eef2f5', INK, 2))
  body.push(_box(700, 470, 150, 70, 'tunnelling-current\namplifier', TINT_DET, DETC, 2))
  body.push(_arrow(680, 500, 510, 500, SIGNAL, 2))
  body.push(_arrow(775, 540, 670, 645, OPTIC, 2))
  body.push(..._micrograph(160, 800, 460, 470, [[110, 100, 40], [190, 100, 40], [270, 100, 40], [150, 175, 40], [230, 175, 40], [310, 175, 40], [110, 250, 40], [190, 250, 40], [270, 250, 40], [150, 325, 40], [230, 325, 40], [310, 325, 40]], 'Atomic-resolution image', '2 nm'))
  body.push(..._plot(660, 800, 460, 470, 'bias voltage (V)', 'dI/dV', [[0, 0.2], [0.2, 0.25], [0.35, 0.55], [0.45, 0.4], [0.5, 0.45], [0.65, 0.8], [0.8, 0.4], [1, 0.25]], undefined, DETC))
  return _page('Scanning Tunnelling Microscopy (STM)', 'Atomic-scale topography & electronic structure', MC, body, 'A sharp conductive tip is held ~1 nm above a surface; the quantum tunnelling current (kept constant by feedback) maps atoms, while dI/dV spectroscopy probes the local density of states.')
}

// ===================================================== Spectroscopy: XPS
// A hemispherical-analyser cross-section: two concentric domes.
function _analyser_dome(cx: any, top: any): Spec[] {
  return [
    _box(cx - 135, top, 270, 135, undefined, '#f3edfa', DETC, 3, 'halfcircle'),
    _box(cx - 86, top + 49, 172, 86, undefined, '#ffffff', DETC, 3, 'halfcircle'),
  ]
}

export function build_xps(): Spec[] {
  const cx = 380
  let body = _analyser_dome(cx, 214)
  body.push(_box(cx + 150, 250, 120, 60, 'detector', TINT_DET, DETC, 2))
  body.push(_arrow(cx + 120, 320, cx + 175, 300, SIGNAL, 2))
  // transfer lens + chamber
  body.push(_box(cx - 50, 352, 100, 44, 'transfer\nlens', TINT_OPTIC, OPTIC, 2))
  body.push(_round(cx - 170, 408, 340, 250, undefined, TINT_BODY, '#c4ccd4'))
  body.push(..._stage(cx, 545, 130, 'sample'))
  // x-ray source
  body.push(_round(120, 470, 180, 120, 'Al / Mg Kα\ntwin anode', TINT_BEAM, BEAM, 2))
  body.push(_arrow(300, 528, cx - 60, 545, BEAM, 3), _t(305, 500, 'X-rays', 15, BEAM))
  body.push(_arrow(cx, 524, cx, 398, SIGNAL, 3), _t(cx + 12, 430, 'photoelectrons', 15, SIGNAL))
  body.push(_line(cx + 135, 280, cx + 250, 280, '#aab6c0', 1), _t(cx + 150, 232, 'hemispherical analyser', 15, INK))
  body.push(_t(cx - 168, 668, 'ultra-high-vacuum chamber', 15, MUTE))
  // principle: photoemission energy diagram
  body.push(..._energy_inset(720, 230))
  body.push(..._plot(120, 904, 1000, 466, 'Binding energy (eV)', 'Intensity (a.u.)', [[1, 0.12], [0.86, 0.14], [0.84, 0.72], [0.82, 0.16], [0.7, 0.18], [0.68, 0.9], [0.66, 0.2], [0.5, 0.22], [0.48, 0.55], [0.46, 0.24], [0.32, 0.26], [0.3, 0.78], [0.28, 0.28], [0.14, 0.32], [0.12, 0.6], [0.1, 0.34], [0, 0.4]], [[0.13, 'Si 2p'], [0.31, 'C 1s'], [0.49, 'N 1s'], [0.69, 'O 1s'], [0.85, 'F 1s']], DETC))
  return _page('X-ray Photoelectron Spectroscopy (XPS)', 'Surface elemental composition & chemical state', SP, body, 'Soft X-rays eject core-level photoelectrons; a hemispherical analyser measures their kinetic energy, giving binding energies that fingerprint each element and its bonding.')
}

// A small photoemission energy-level diagram.
function _energy_inset(x: any, y: any): Spec[] {
  let b: Spec[] = [
    _box(x, y, 400, 300, undefined, '#ffffff', '#c4ccd4', 2),
    _t(x + 16, y + 12, 'Photoemission', 16, MUTE),
  ]
  b.push(_line(x + 40, y + 250, x + 360, y + 250, INK, 2))  // core level
  b.push(_t(x + 12, y + 240, 'core', 13, MUTE))
  b.push(_line(x + 40, y + 120, x + 360, y + 120, INK, 2))  // vacuum
  b.push(_t(x + 12, y + 110, 'Eᵥ', 13, MUTE))
  b.push(_line(x + 40, y + 170, x + 360, y + 170, MUTE, 1))  // fermi
  b.push(_t(x + 12, y + 160, 'E_F', 13, MUTE))
  b.push(_arrow(x + 120, y + 250, x + 120, y + 70, BEAM, 3), _t(x + 128, y + 150, 'hν', 15, BEAM))
  b.push(_circle(x + 250, y + 244, 14, undefined, SIGNAL, SIGNAL), _arrow(x + 257, y + 244, x + 257, y + 60, SIGNAL, 3), _t(x + 266, y + 90, 'e⁻ (KE)', 14, SIGNAL))
  return b
}

function _bigplot(xlabel: any, ylabel: any, curve: any, peaks: any | null = null, color = DETC): Spec[] {
  return _plot(120, 924, 1000, 496, xlabel, ylabel, curve, peaks, color)
}

function _grating(x: any, y: any, w = 70, h = 46, color = OPTIC): Spec[] {
  const out: Spec[] = [_box(x, y, w, h, undefined, TINT_OPTIC, color, 2)]
  for (let i = 1; i < 7; i++) {
    out.push(_line(x + w * i / 7, y, x + w * i / 7, y + h, color, 1))
  }
  return out
}

// ===================================================== Spectroscopy: UPS
export function build_ups(): Spec[] {
  const cx = 380
  let body = _analyser_dome(cx, 214)
  body.push(_box(cx + 150, 250, 120, 60, 'channeltron\ndetector', TINT_DET, DETC, 2), _arrow(cx + 120, 320, cx + 175, 300, SIGNAL, 2))
  body.push(_box(cx - 50, 352, 100, 44, 'lens', TINT_OPTIC, OPTIC, 2))
  body.push(_round(cx - 170, 408, 340, 250, undefined, TINT_BODY, '#c4ccd4'))
  body.push(..._stage(cx, 545, 130, 'sample'))
  body.push(_round(110, 450, 190, 130, 'He I / He II\ndischarge lamp', TINT_BEAM, BEAM, 2), _arrow(300, 520, cx - 60, 545, BEAM, 3), _t(305, 494, 'UV photons (21.2 eV)', 14, BEAM))
  body.push(_arrow(cx, 524, cx, 398, SIGNAL, 3), _t(cx + 12, 430, 'photoelectrons', 15, SIGNAL))
  body.push(_t(cx - 168, 668, 'ultra-high-vacuum chamber', 15, MUTE), _line(cx + 135, 280, cx + 250, 280, '#aab6c0', 1), _t(cx + 150, 232, 'hemispherical analyser', 15, INK))
  body.push(..._energy_inset(720, 230))
  body.push(..._bigplot('Binding energy (eV)', 'Intensity (a.u.)', [[1, 0.15], [0.85, 0.2], [0.7, 0.35], [0.6, 0.7], [0.5, 0.55], [0.42, 0.8], [0.32, 0.5], [0.22, 0.65], [0.12, 0.3], [0.05, 0.5], [0, 0.12]], [[0.45, 'valence band'], [0.12, 'E_F']], DETC))
  return _page('Ultraviolet Photoelectron Spectroscopy (UPS)', 'Valence-band & work-function measurement', SP, body, 'He-discharge UV photons photoemit valence electrons; the spectrum reveals the density of states near the Fermi level and, from the cutoff, the sample work function.')
}

// ===================================================== Spectroscopy: AES
export function build_aes(): Spec[] {
  const cx = 360
  let body: Spec[] = [_round(cx - 150, 360, 300, 300, undefined, TINT_BODY, '#c4ccd4')]
  body.push(_box(cx - 40, 224, 80, 60, 'electron\ngun', TINT_BEAM, BEAM, 2), _arrow(cx, 286, cx, 560, BEAM, 3))
  // cylindrical mirror analyser: two nested cylinders
  body.push(_box(cx - 140, 300, 280, 250, undefined, null, DETC, 3, 'rounded_rect'), _box(cx - 95, 330, 190, 190, undefined, null, DETC, 2, 'rounded_rect'))
  body.push(..._stage(cx, 588, 120, 'sample'))
  body.push(_arrow(cx + 30, 560, cx + 120, 400, SIGNAL, 2), _t(cx + 90, 470, 'Auger e⁻', 14, SIGNAL))
  body.push(_box(cx + 150, 320, 110, 56, 'detector', TINT_DET, DETC, 2))
  body.push(_line(cx + 140, 300, cx + 250, 300, '#aab6c0', 1), _t(cx + 150, 252, 'cylindrical mirror analyser (CMA)', 14, INK))
  body.push(..._bigplot('Kinetic energy (eV)', 'dN/dE (derivative)', [[0, 0.5], [0.15, 0.5], [0.18, 0.8], [0.21, 0.2], [0.24, 0.5], [0.45, 0.5], [0.48, 0.78], [0.51, 0.22], [0.54, 0.5], [0.7, 0.5], [0.73, 0.7], [0.76, 0.3], [0.79, 0.5], [1, 0.5]], [[0.19, 'C KLL'], [0.49, 'O KLL'], [0.74, 'N KLL']], SIGNAL))
  return _page('Auger Electron Spectroscopy (AES)', 'Surface composition with high spatial resolution', SP, body, 'A focused electron beam excites core holes that relax by emitting Auger electrons of element-specific energy; the differentiated spectrum identifies surface species.')
}

// ===================================================== Spectroscopy: FTIR
export function build_ftir(): Spec[] {
  let body: Spec[] = [_box(120, 392, 120, 70, 'IR\nsource', TINT_BEAM, BEAM, 2)]
  body.push(_arrow(240, 427, 430, 427, BEAM, 3))
  // beam splitter (45°)
  body.push(_line(395, 387, 465, 467, OPTIC, 4), _t(360, 478, 'beam splitter', 14, OPTIC))
  body.push(_box(400, 230, 130, 22, 'fixed mirror', TINT_OPTIC, OPTIC, 2), _arrow(430, 410, 460, 256, OPTIC, 2))
  body.push(_box(690, 392, 22, 110, undefined, TINT_OPTIC, OPTIC, 2), _arrow(720, 460, 760, 460, OPTIC, 2), _t(640, 516, 'moving mirror →', 14, OPTIC), _arrow(465, 427, 685, 447, OPTIC, 2))
  body.push(_arrow(430, 467, 430, 560, BEAM, 3))
  body.push(_box(350, 560, 160, 70, 'sample', TINT_SAMP, '#9a7b1f', 2))
  body.push(_arrow(430, 630, 430, 700, SIGNAL, 3), _box(350, 700, 160, 70, 'detector (DTGS)', TINT_DET, DETC, 2))
  body.push(_t(560, 410, 'Michelson interferometer', 15, MUTE))
  body.push(..._bigplot('Wavenumber (cm⁻¹)', 'Transmittance (%)', [[0, 0.92], [0.08, 0.9], [0.12, 0.5], [0.16, 0.9], [0.3, 0.88], [0.34, 0.28], [0.38, 0.86], [0.52, 0.82], [0.58, 0.4], [0.63, 0.84], [0.78, 0.8], [0.85, 0.45], [0.9, 0.82], [1, 0.86]], [[0.14, 'O–H'], [0.36, 'C=O'], [0.6, 'C–H'], [0.86, 'C–O']], DETC))
  return _page('Fourier-Transform Infrared Spectroscopy (FTIR)', 'Molecular bonds & functional groups', SP, body, 'A Michelson interferometer modulates broadband IR light; the Fourier transform of the interferogram yields an absorption spectrum that fingerprints chemical bonds.')
}

// ===================================================== Spectroscopy: Raman
export function build_raman(): Spec[] {
  let body: Spec[] = [_box(120, 300, 120, 64, 'laser', TINT_BEAM, BEAM, 2)]
  body.push(_arrow(240, 332, 430, 332, BEAM, 3))
  body.push(_line(410, 312, 460, 362, OPTIC, 3), _t(380, 372, 'dichroic / notch', 13, OPTIC))
  body.push(_box(400, 470, 80, 30, 'objective', TINT_OPTIC, OPTIC, 2), _poly('triangle', 412, 500, 56, 36, undefined, TINT_OPTIC, OPTIC, undefined, 180), _arrow(435, 360, 435, 470, BEAM, 2))
  body.push(_box(360, 560, 160, 64, 'sample', TINT_SAMP, '#9a7b1f', 2))
  body.push(_arrow(435, 540, 435, 372, SIGNAL, 2), _arrow(460, 337, 640, 337, SIGNAL, 2), _t(520, 312, 'scattered light', 13, SIGNAL))
  body.push(..._grating(650, 308, 70, 56))
  body.push(_t(648, 372, 'grating', 13, OPTIC))
  body.push(_arrow(722, 320, 800, 320, SIGNAL, 2), _box(800, 290, 120, 64, 'CCD', TINT_DET, DETC, 2))
  body.push(..._bigplot('Raman shift (cm⁻¹)', 'Intensity (a.u.)', [[0, 0.1], [0.28, 0.1], [0.32, 0.72], [0.36, 0.12], [0.5, 0.12], [0.54, 0.9], [0.58, 0.12], [0.74, 0.12], [0.78, 0.4], [0.82, 0.1], [1, 0.1]], [[0.34, 'D band'], [0.56, 'G band'], [0.8, '2D']], DETC))
  return _page('Raman Spectroscopy', 'Vibrational fingerprint & disorder', SP, body, 'Monochromatic laser light is inelastically scattered by molecular vibrations; the Raman shift spectrum is sensitive to bonding, strain, crystallinity and disorder.')
}

// ==================================================== Spectroscopy: UV-Vis
export function build_uvvis(): Spec[] {
  let body: Spec[] = [_box(110, 392, 110, 70, 'lamp\n(D₂ / W)', TINT_BEAM, BEAM, 2)]
  body.push(_arrow(220, 427, 300, 427, BEAM, 3))
  body.push(..._grating(300, 400, 70, 56))
  body.push(_t(298, 466, 'monochromator', 13, OPTIC), _arrow(372, 427, 470, 427, BEAM, 3))
  body.push(_box(470, 392, 90, 90, 'cuvette\n(sample)', TINT_SAMP, '#9a7b1f', 2))
  body.push(_arrow(560, 427, 660, 427, SIGNAL, 3), _box(660, 392, 120, 70, 'photodiode\ndetector', TINT_DET, DETC, 2))
  body.push(_box(800, 392, 130, 70, 'absorbance\nA = log(I₀/I)', '#eef2f5', INK, 2))
  body.push(..._bigplot('Wavelength (nm)', 'Absorbance', [[0, 0.12], [0.15, 0.2], [0.3, 0.45], [0.4, 0.78], [0.46, 0.6], [0.5, 0.66], [0.62, 0.3], [0.78, 0.16], [1, 0.1]], [[0.43, 'λ_max']], DETC))
  return _page('UV-Visible Spectroscopy (UV-Vis)', 'Electronic transitions & concentration', SP, body, 'Light is split by wavelength and passed through the sample; the absorbance spectrum gives band gaps, chromophores and, via Beer–Lambert, concentration.')
}

// ===================================================== Spectroscopy: XRF
export function build_xrf(): Spec[] {
  let body: Spec[] = [_round(110, 470, 180, 120, 'X-ray tube', TINT_BEAM, BEAM, 2)]
  body.push(_arrow(290, 528, 470, 600, BEAM, 3), _t(300, 512, 'primary X-rays', 14, BEAM))
  body.push(_box(440, 590, 210, 110, 'sample', TINT_SAMP, '#9a7b1f', 2))
  body.push(_arrow(545, 590, 740, 470, SIGNAL, 3), _t(640, 470, 'fluorescent X-rays', 14, SIGNAL))
  body.push(_box(740, 410, 180, 120, 'energy-dispersive\ndetector (SDD)', TINT_DET, DETC, 2))
  body.push(_arrow(830, 530, 830, 600, DETC, 2), _box(740, 600, 180, 90, 'multichannel\nanalyser', '#eef2f5', INK, 2))
  body.push(..._bigplot('X-ray energy (keV)', 'Counts', [[0, 0.08], [0.1, 0.08], [0.108, 0.82], [0.12, 0.08], [0.27, 0.08], [0.278, 0.55], [0.29, 0.08], [0.44, 0.08], [0.448, 0.66], [0.46, 0.08], [0.6, 0.08], [0.608, 0.35], [0.62, 0.08], [0.76, 0.08], [0.768, 0.48], [0.78, 0.08], [1, 0.08]], [[0.108, 'K'], [0.278, 'Ca'], [0.448, 'Fe'], [0.608, 'Cu'], [0.768, 'Zn']], DETC))
  return _page('X-ray Fluorescence (XRF)', 'Elemental composition (bulk, non-destructive)', SP, body, 'Primary X-rays ionise inner-shell electrons; the atoms relax by emitting characteristic fluorescent X-rays whose energies and intensities give elemental identity and amount.')
}

// ===================================================== Spectroscopy: NMR
export function build_nmr(): Spec[] {
  const cx = 360
  // superconducting magnet cryostat (nested rings) with vertical bore
  let body: Spec[] = [
    _circle(cx - 180, 250, 360, undefined, '#eaf1f8', '#9bb6d2', 3),
    _circle(cx - 140, 290, 280, undefined, '#dfeaf5', COOL, 2),
    _circle(cx - 55, 375, 110, undefined, '#ffffff', '#9bb6d2', 2),
  ]
  body.push(_box(cx - 14, 250, 28, 380, undefined, '#ffffff', '#c4ccd4', 2))  // bore
  body.push(_box(cx - 9, 360, 18, 150, '', TINT_SAMP, '#9a7b1f', 1))  // sample tube
  body.push(_box(cx - 28, 410, 56, 50, undefined, null, OPTIC, 3), _t(cx + 40, 420, 'RF coil', 14, OPTIC))
  body.push(_t(cx - 150, 612, 'superconducting magnet (liquid He)', 14, COOL))
  body.push(_box(700, 360, 180, 70, 'RF transmitter\n/ receiver', TINT_DET, DETC, 2), _box(700, 450, 180, 70, 'console / FT', '#eef2f5', INK, 2), _arrow(700, 430, cx + 30, 435, SIGNAL, 2))
  body.push(..._bigplot('Chemical shift δ (ppm)', 'Intensity', [[1, 0.08], [0.22, 0.08], [0.235, 0.6], [0.25, 0.08], [0.45, 0.08], [0.46, 0.9], [0.475, 0.08], [0.475, 0.08], [0.66, 0.08], [0.675, 0.45], [0.69, 0.08], [0.95, 0.08], [0.96, 0.3], [0.975, 0.08], [0, 0.08]], [[0.235, 'aromatic'], [0.46, 'CH₂'], [0.675, 'CH₃'], [0.96, 'TMS']], DETC))
  return _page('Nuclear Magnetic Resonance (NMR)', 'Molecular structure & connectivity', SP, body, 'Nuclei in a strong magnetic field absorb radio-frequency pulses; the Fourier-transformed free-induction decay gives chemical shifts and couplings that map molecular structure.')
}

// ==================================================== Mass spec: SIMS
export function build_sims(): Spec[] {
  let body: Spec[] = [_round(110, 300, 170, 90, 'primary\nion gun', TINT_BEAM, BEAM, 2)]
  body.push(_arrow(280, 360, 470, 560, BEAM, 3), _t(300, 420, 'primary ions (O⁻, Cs⁺)', 14, BEAM))
  body.push(_box(430, 560, 200, 90, 'sample', TINT_SAMP, '#9a7b1f', 2))
  body.push(_arrow(520, 560, 700, 380, SIGNAL, 3), _t(610, 360, 'secondary ions', 14, SIGNAL))
  body.push(_box(700, 300, 220, 110, 'mass analyser\n(ToF / quadrupole)', TINT_OPTIC, OPTIC, 2))
  body.push(_arrow(810, 410, 810, 480, SIGNAL, 2), _box(720, 480, 180, 80, 'ion detector', TINT_DET, DETC, 2))
  body.push(..._bigplot('Sputter depth (nm)', 'Secondary-ion intensity', [[0, 0.85], [0.12, 0.82], [0.28, 0.6], [0.4, 0.3], [0.5, 0.18], [0.62, 0.14], [0.8, 0.12], [1, 0.1]], [[0.05, 'surface']], SIGNAL))
  return _page('Secondary-Ion Mass Spectrometry (SIMS)', 'Trace analysis & depth profiling', MS, body, 'A focused primary-ion beam sputters the surface; ejected secondary ions are mass-analysed, giving ppb-level sensitivity and nanometre depth profiles.')
}

// ==================================================== Mass spec: ICP-MS
export function build_icpms(): Spec[] {
  let body: Spec[] = [_box(110, 400, 130, 70, 'nebuliser\n(sample)', TINT_SAMP, '#9a7b1f', 2)]
  body.push(_arrow(240, 435, 320, 435, COOL, 3))
  // plasma torch
  body.push(_poly('triangle', 320, 390, 150, 90, undefined, '#ffe2b0', '#e08a1e', undefined, 90), _t(330, 488, 'Ar plasma (~7000 K)', 13, '#e08a1e'))
  body.push(_arrow(470, 435, 540, 435, BEAM, 3))
  body.push(_poly('triangle', 540, 405, 50, 60, undefined, '#cdd6de', MUTE, undefined, 90), _poly('triangle', 590, 408, 44, 54, undefined, '#cdd6de', MUTE, undefined, 90), _t(536, 474, 'sampler / skimmer cones', 12, MUTE))
  body.push(_arrow(636, 435, 700, 435, SIGNAL, 3), _box(700, 400, 150, 70, 'quadrupole\nmass filter', TINT_OPTIC, OPTIC, 2), _arrow(850, 435, 910, 435, SIGNAL, 3), _box(910, 400, 110, 70, 'detector', TINT_DET, DETC, 2))
  body.push(..._bigplot('m/z', 'Counts per second', [[0, 0.06], [0.14, 0.06], [0.148, 0.85], [0.16, 0.06], [0.34, 0.06], [0.348, 0.5], [0.36, 0.06], [0.52, 0.06], [0.528, 0.7], [0.54, 0.06], [0.72, 0.06], [0.728, 0.4], [0.74, 0.06], [0.88, 0.06], [0.888, 0.6], [0.9, 0.06], [1, 0.06]], [[0.148, '²⁴Mg'], [0.348, '⁵⁶Fe'], [0.528, '⁶³Cu'], [0.728, '⁹⁵Mo'], [0.888, '²⁰⁸Pb']], DETC))
  return _page('Inductively-Coupled-Plasma Mass Spectrometry (ICP-MS)', 'Ultra-trace multi-element analysis', MS, body, 'Sample aerosol is ionised in an argon plasma; ions pass through sampling cones into a quadrupole mass filter, giving part-per-trillion elemental and isotopic quantification.')
}

// ==================================================== Mass spec: GC-MS
export function build_gcms(): Spec[] {
  let body: Spec[] = [_box(110, 320, 110, 64, 'injector', TINT_SAMP, '#9a7b1f', 2)]
  // oven with coiled column
  body.push(_round(110, 430, 360, 260, undefined, TINT_BODY, '#c4ccd4'))
  body.push(_circle(170, 470, 180, undefined, null, SIGNAL, 3), _circle(200, 500, 120, undefined, null, SIGNAL, 3), _circle(225, 525, 70, undefined, null, SIGNAL, 3), _t(150, 700, 'GC column (in oven)', 14, MUTE))
  body.push(_arrow(165, 384, 165, 430, SIGNAL, 2))
  body.push(_arrow(470, 520, 540, 520, SIGNAL, 3))
  body.push(_box(540, 440, 150, 80, 'ion source\n(EI 70 eV)', TINT_BEAM, BEAM, 2), _box(700, 440, 150, 80, 'quadrupole', TINT_OPTIC, OPTIC, 2), _box(860, 440, 110, 80, 'detector', TINT_DET, DETC, 2), _arrow(690, 480, 700, 480, SIGNAL, 2), _arrow(850, 480, 860, 480, SIGNAL, 2))
  body.push(..._bigplot('Retention time (min)', 'Total-ion current', [[0, 0.08], [0.12, 0.08], [0.14, 0.7], [0.16, 0.08], [0.3, 0.08], [0.32, 0.9], [0.34, 0.08], [0.48, 0.08], [0.5, 0.45], [0.52, 0.08], [0.66, 0.08], [0.68, 0.6], [0.7, 0.08], [0.84, 0.08], [0.86, 0.35], [0.88, 0.08], [1, 0.08]], undefined, SIGNAL))
  return _page('Gas Chromatography–Mass Spectrometry (GC-MS)', 'Separation & identification of volatiles', MS, body, 'Volatile analytes are separated on a capillary column in a temperature-programmed oven, then ionised and mass-analysed — each chromatographic peak carries an identifying spectrum.')
}

// ==================================================== Diffraction: XRD
export function build_xrd(): Spec[] {
  const [cx, cy] = [540, 540]
  let body: Spec[] = [_circle(cx - 300, cy - 300, 600, undefined, null, '#cdd6de', 2)]
  body.push(_round(cx - 470, cy - 55, 160, 110, 'X-ray tube', TINT_BEAM, BEAM, 2))
  body.push(_arrow(cx - 300, cy, cx - 80, cy, BEAM, 3))
  body.push(..._aperture(cx - 150, cy, 10, 26))
  body.push(_box(cx - 80, cy - 46, 160, 92, 'sample (θ)', TINT_SAMP, '#9a7b1f', 2))
  body.push(_arrow(cx + 70, cy, cx + 285, cy - 165, SIGNAL, 3), _t(cx + 150, cy - 190, '2θ', 22, SIGNAL))
  body.push(_box(cx + 250, cy - 240, 160, 96, 'detector', TINT_DET, DETC, 2))
  body.push(_line(cx, cy, cx + 300, cy, '#cdd6de', 1), _t(cx - 70, cy + 320, 'goniometer circle', 14, MUTE))
  body.push(..._bigplot('2θ (degrees)', 'Intensity (counts)', [[0, 0.06], [0.14, 0.06], [0.146, 0.92], [0.155, 0.06], [0.3, 0.06], [0.306, 0.5], [0.315, 0.06], [0.46, 0.06], [0.466, 0.72], [0.475, 0.06], [0.6, 0.06], [0.606, 0.38], [0.615, 0.06], [0.74, 0.06], [0.746, 0.55], [0.755, 0.06], [0.88, 0.06], [0.886, 0.3], [0.895, 0.06], [1, 0.06]], [[0.15, '(111)'], [0.31, '(200)'], [0.47, '(220)'], [0.61, '(311)'], [0.75, '(222)']], DETC))
  return _page('X-ray Diffraction (XRD)', 'Crystal structure & phase identification', DF, body, 'A monochromatic X-ray beam is scanned in angle; Bragg reflection (nλ = 2d·sinθ) from lattice planes produces a diffractogram that fingerprints crystalline phases.')
}

// ==================================================== Diffraction: LEED
export function build_leed(): Spec[] {
  const cx = 380
  let body: Spec[] = [_box(cx - 200, 300, 400, 300, undefined, '#eafaf0', SIGNAL, 3, 'halfcircle')]
  body.push(_box(cx - 150, 350, 300, 250, undefined, null, SIGNAL, 2, 'halfcircle'))
  body.push(_t(cx + 60, 300, 'fluorescent screen + grids', 13, SIGNAL))
  body.push(_box(cx - 30, 560, 60, 90, 'e⁻ gun', TINT_BEAM, BEAM, 2))
  body.push(_arrow(cx, 560, cx, 470, BEAM, 3))
  body.push(..._stage(cx, 470, 110, 'crystal'))
  body.push(_arrow(cx, 462, cx - 120, 360, SIGNAL, 2), _arrow(cx, 462, cx + 120, 360, SIGNAL, 2))
  // LEED pattern panel (hexagonal spots)
  body.push(_box(700, 300, 420, 420, undefined, '#0a0c10', INK, 2))
  const [pcx, pcy] = [910, 510]
  body.push(_circle(pcx - 11, pcy - 11, 22, undefined, '#eafaf0', '#eafaf0'))
  body.push(..._ring(pcx, pcy, 90, 6, 18, '#bfe9cf', Math.PI / 6))
  body.push(..._ring(pcx, pcy, 160, 6, 14, '#bfe9cf', Math.PI / 6))
  body.push(..._ring(pcx, pcy, 175, 6, 12, '#bfe9cf'))
  body.push(_tc(910, 730, 'LEED pattern (hexagonal surface)', 14, MUTE))
  return _page('Low-Energy Electron Diffraction (LEED)', 'Surface crystallography & ordering', DF, body, 'Low-energy electrons (20–200 eV) back-diffract from the topmost atomic layers; the symmetry and spacing of the spot pattern reveal the surface lattice and any reconstruction or adsorbate superstructure.')
}

// ==================================================== Thermal: TGA
export function build_tga(): Spec[] {
  const cx = 420
  let body: Spec[] = [_box(cx - 70, 250, 140, 46, 'microbalance', '#eef2f5', INK, 2)]
  body.push(_line(cx, 296, cx, 430, MUTE, 2))
  body.push(_round(cx - 150, 430, 300, 320, undefined, TINT_BEAM, BEAM, 2))
  body.push(_box(cx - 48, 470, 96, 70, 'crucible\n(sample)', TINT_SAMP, '#9a7b1f', 2))
  for (const yy of [470, 540, 610]) {
    body.push(_line(cx - 135, yy, cx - 60, yy, BEAM, 3), _line(cx + 60, yy, cx + 135, yy, BEAM, 3))
  }
  body.push(_t(cx - 140, 762, 'furnace (heating elements)', 14, BEAM))
  body.push(_arrow(cx + 210, 700, cx + 130, 640, COOL, 3), _t(cx + 150, 716, 'purge gas', 13, COOL))
  body.push(_box(720, 300, 200, 80, 'thermocouple\n+ controller', '#eef2f5', INK, 2), _arrow(720, 360, cx + 140, 540, MUTE, 1))
  body.push(..._bigplot('Temperature (°C)', 'Mass (%)', [[0, 0.97], [0.16, 0.95], [0.2, 0.8], [0.3, 0.76], [0.44, 0.74], [0.5, 0.46], [0.6, 0.42], [0.78, 0.4], [1, 0.38]], undefined, DETC))
  return _page('Thermogravimetric Analysis (TGA)', 'Mass change with temperature', TH, body, 'A sample on a microbalance is heated under a controlled atmosphere; the mass-loss curve reveals moisture, decomposition steps, oxidation and residual ash.')
}

// ==================================================== Thermal: DSC
export function build_dsc(): Spec[] {
  const cx = 420
  let body: Spec[] = [_round(cx - 200, 360, 400, 280, undefined, TINT_BEAM, BEAM, 2)]
  body.push(_box(cx - 150, 470, 110, 60, 'sample\npan', TINT_SAMP, '#9a7b1f', 2), _box(cx + 40, 470, 110, 60, 'reference\npan', TINT_OPTIC, OPTIC, 2))
  body.push(_box(cx - 150, 540, 110, 26, undefined, '#cdd6de', MUTE, 1), _box(cx + 40, 540, 110, 26, undefined, '#cdd6de', MUTE, 1), _t(cx - 165, 580, 'heat-flow sensors / thermocouples', 13, MUTE))
  for (const yy of [590, 620]) {
    body.push(_line(cx - 180, yy, cx + 180, yy, BEAM, 3))
  }
  body.push(_t(cx - 150, 350, 'furnace block', 14, BEAM))
  body.push(..._bigplot('Temperature (°C)', 'Heat flow (endo →)', [[0, 0.5], [0.18, 0.5], [0.26, 0.28], [0.34, 0.5], [0.5, 0.5], [0.56, 0.78], [0.64, 0.5], [0.78, 0.5], [0.84, 0.34], [0.9, 0.5], [1, 0.5]], [[0.3, 'T_g / melt'], [0.6, 'crystallisation'], [0.86, 'decomp.']], DETC))
  return _page('Differential Scanning Calorimetry (DSC)', 'Thermal transitions & heat flow', TH, body, 'Sample and reference pans are heated together; the differential heat flow needed to keep them at the same temperature reveals melting, crystallisation and glass transitions.')
}

// ==================================================== Thermal: BET
export function build_bet(): Spec[] {
  const cx = 430
  let body: Spec[] = [_box(cx - 60, 250, 250, 70, 'N₂ dosing\nmanifold', TINT_OPTIC, OPTIC, 2)]
  body.push(_box(cx + 210, 250, 150, 70, 'pressure\ntransducer', TINT_DET, DETC, 2), _line(cx + 60, 285, cx + 210, 285, MUTE, 2))
  body.push(_arrow(cx + 60, 320, cx + 60, 440, COOL, 3))
  body.push(_round(cx, 440, 120, 360, undefined, TINT_COOL, COOL, 2))
  body.push(_box(cx + 30, 480, 60, 130, 'sample', TINT_SAMP, '#9a7b1f', 2))
  body.push(_t(cx - 30, 818, 'liquid-N₂ dewar (77 K)', 14, COOL))
  body.push(..._bigplot('Relative pressure  p/p₀', 'Quantity adsorbed (cm³/g)', [[0, 0.1], [0.08, 0.26], [0.18, 0.33], [0.35, 0.4], [0.55, 0.48], [0.72, 0.58], [0.86, 0.74], [0.95, 0.9], [1, 0.98]], [[0.2, 'monolayer (BET)']], DETC))
  return _page('Gas Sorption — BET Surface Area', 'Specific surface area & porosity', TH, body, 'Nitrogen is dosed onto a degassed sample at 77 K; the adsorption isotherm, fitted with the BET equation, gives the specific surface area, while hysteresis reveals porosity.')
}

// ==================================================== Chromatography: HPLC
export function build_hplc(): Spec[] {
  let body: Spec[] = [
    _box(110, 280, 90, 70, 'solvent\nA', TINT_COOL, COOL, 2),
    _box(210, 280, 90, 70, 'solvent\nB', TINT_COOL, COOL, 2),
  ]
  body.push(_arrow(155, 350, 230, 430, COOL, 2), _arrow(255, 350, 250, 430, COOL, 2))
  body.push(_box(200, 430, 110, 64, 'pump', TINT_OPTIC, OPTIC, 2), _arrow(310, 462, 380, 462, COOL, 3))
  body.push(_box(380, 430, 100, 64, 'injector', TINT_SAMP, '#9a7b1f', 2), _arrow(480, 462, 540, 462, COOL, 3))
  body.push(_box(540, 422, 220, 80, 'separation column', TINT_BODY, MUTE, 2), _arrow(760, 462, 820, 462, SIGNAL, 3))
  body.push(_box(820, 430, 120, 64, 'UV / DAD\ndetector', TINT_DET, DETC, 2))
  body.push(_box(820, 540, 120, 56, 'waste', '#eef2f5', INK, 2), _arrow(880, 494, 880, 540, COOL, 2))
  body.push(..._bigplot('Retention time (min)', 'Absorbance (mAU)', [[0, 0.08], [0.12, 0.08], [0.14, 0.55], [0.16, 0.08], [0.3, 0.08], [0.33, 0.9], [0.36, 0.08], [0.5, 0.08], [0.52, 0.4], [0.54, 0.08], [0.64, 0.08], [0.67, 0.7], [0.7, 0.08], [0.84, 0.08], [0.87, 0.3], [0.89, 0.08], [1, 0.08]], [[0.14, 't₀'], [0.33, 'analyte 1'], [0.67, 'analyte 2']], DETC))
  return _page('High-Performance Liquid Chromatography (HPLC)', 'Separation & quantification in solution', CH, body, 'A high-pressure pump drives a solvent gradient carrying the injected sample through a packed column; analytes separate by affinity and are quantified as detector peaks.')
}

// (further builders appended below)
export const SKETCHES = [['Spectroscopy', 'XPS — X-ray Photoelectron Spectroscopy', build_xps], ['Spectroscopy', 'UPS — Ultraviolet Photoelectron Spectroscopy', build_ups], ['Spectroscopy', 'AES — Auger Electron Spectroscopy', build_aes], ['Spectroscopy', 'FTIR — Fourier-Transform Infrared', build_ftir], ['Spectroscopy', 'Raman Spectroscopy', build_raman], ['Spectroscopy', 'UV-Vis Spectroscopy', build_uvvis], ['Spectroscopy', 'XRF — X-ray Fluorescence', build_xrf], ['Spectroscopy', 'NMR — Nuclear Magnetic Resonance', build_nmr], ['Mass spectrometry', 'SIMS — Secondary-Ion Mass Spectrometry', build_sims], ['Mass spectrometry', 'ICP-MS — Inductively-Coupled-Plasma MS', build_icpms], ['Mass spectrometry', 'GC-MS — Gas Chromatography–Mass Spec', build_gcms], ['Diffraction', 'XRD — X-ray Diffraction', build_xrd], ['Diffraction', 'LEED — Low-Energy Electron Diffraction', build_leed], ['Microscopy', 'TEM — Transmission Electron Microscopy', build_tem], ['Microscopy', 'SEM — Scanning Electron Microscopy', build_sem], ['Microscopy', 'AFM — Atomic Force Microscopy', build_afm], ['Microscopy', 'STM — Scanning Tunnelling Microscopy', build_stm], ['Thermal & sorption', 'TGA — Thermogravimetric Analysis', build_tga], ['Thermal & sorption', 'DSC — Differential Scanning Calorimetry', build_dsc], ['Thermal & sorption', 'BET — Gas Sorption (surface area)', build_bet], ['Chromatography', 'HPLC — High-Performance Liquid Chromatography', build_hplc]]
