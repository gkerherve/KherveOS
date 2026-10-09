// The built-in kSignal examples as projects (pure). tools/export_ksignal_examples.ts writes them to
// public/examples/ksignal/*.ksig; the tests load every one and check the numbers its description quotes.
// All the signals are synthetic (generated from the spec in the file), and the files say so.

import { DEFAULT_FILTER, type FilterSpec } from './filters.ts'
import { defaultComponent, type Component, type ComponentType, type GeneratorSource } from './generators.ts'
import { DEFAULT_ANALYSIS, NO_PROCESS, type AnalysisSettings, type KsigProject, type Process, type Tab } from './project.ts'

export interface Example {
  id: string
  title: string
  group: string
  /** What to look at and the numbers to expect. */
  description: string
  project: KsigProject
}

const comp = (type: ComponentType, over: Partial<Component> = {}): Component => ({ ...defaultComponent(type), ...over })

interface Build {
  id: string
  title: string
  group: string
  description: string
  fs: number
  duration: number
  components: Component[]
  noise?: { sigma: number; seed?: number; color?: 'white' | 'pink' }
  bits?: number
  analysis?: Partial<AnalysisSettings>
  filter?: Partial<FilterSpec>
  compare?: Partial<FilterSpec> | null
  process?: Process
  tab?: Tab
}

function example(b: Build): Example {
  const source: GeneratorSource = {
    kind: 'generator', fs: b.fs, duration: b.duration, components: b.components,
    noise: { sigma: b.noise?.sigma ?? 0, seed: b.noise?.seed ?? 1, color: b.noise?.color ?? 'white' }, bits: b.bits ?? 0, fullScale: 1,
  }
  const project: KsigProject = {
    format: 'ksig', version: 1, name: b.title, description: b.description, synthetic: true, source,
    analysis: { ...DEFAULT_ANALYSIS, timePeaks: { ...DEFAULT_ANALYSIS.timePeaks }, ...b.analysis },
    filter: { ...DEFAULT_FILTER, f1: Math.round(b.fs / 8), f2: Math.round(b.fs / 4), ...b.filter },
    compare: b.compare ? { ...DEFAULT_FILTER, f1: Math.round(b.fs / 8), f2: Math.round(b.fs / 4), ...b.compare } : null,
    process: b.process ?? NO_PROCESS,
    tab: b.tab ?? 'time',
    cursors: { a: null, b: null },
  }
  return { id: b.id, title: b.title, group: b.group, description: b.description, project }
}

export const EXAMPLES: Example[] = [
  example({
    id: 'two-tones', title: 'Two tones: leakage and windows', group: 'Spectrum basics', fs: 8192, duration: 1, tab: 'spectrum',
    description: 'Synthetic: 1000 Hz (amplitude 1.0, exactly on a bin) plus 1234.5 Hz (amplitude 0.5, half a bin off). Flat-top reads both amplitudes within 0.01 dB; a rectangular window loses 3.9 dB on the second tone and smears both into sidelobes; Hann loses 1.4 dB before the peak finder interpolates. Switch the window or tick "Compare windows".',
    components: [comp('sine', { freq: 1000, amp: 1 }), comp('sine', { freq: 1234.5, amp: 0.5 })],
    analysis: { window: 'flattop', compare: ['rectangular', 'hann'], fMax: 2000, dbMin: -140 },
  }),
  example({
    id: 'leakage-windows', title: 'Spectral leakage versus window', group: 'Spectrum basics', fs: 8192, duration: 1, tab: 'spectrum',
    description: 'Synthetic: one sine of amplitude 1 at 100.5 Hz, exactly between two bins (the worst case). The highest bin reads 0.637 (-3.92 dB) with a rectangular window, 0.849 (-1.42 dB) with Hann and 1.000 (-0.01 dB) with flat-top (the peak table interpolates between bins and reports 1.00 for all of them); the price of flat-top is a wide main lobe. Look at the skirts: Hann and Blackman-Harris fall off much faster than rectangular.',
    components: [comp('sine', { freq: 100.5, amp: 1 })],
    analysis: { window: 'rectangular', compare: ['hann', 'flattop', 'blackmanharris'], fMax: 400, dbMin: -160 },
  }),
  example({
    id: 'square-harmonics', title: 'Square wave: odd harmonics', group: 'Spectrum basics', fs: 8192, duration: 1, tab: 'spectrum',
    description: 'Synthetic: a 100 Hz square wave of amplitude 1. Fourier says it holds only odd harmonics with amplitude 4/(pi k): 1.273 at 100 Hz, 0.424 at 300 Hz, 0.255 at 500 Hz, 0.182 at 700 Hz. The metrics panel shows the THD of the square wave against its fundamental.',
    components: [comp('square', { freq: 100, amp: 1 })],
    analysis: { window: 'hann', fMax: 2000, peakRangeDb: 40, maxPeaks: 12 },
  }),
  example({
    id: 'chirp', title: 'Chirp spectrogram', group: 'Time-frequency', fs: 8000, duration: 2, tab: 'spectrogram',
    description: 'Synthetic: a linear sweep from 100 Hz to 3000 Hz in 2 s (amplitude 1). The spectrogram shows the straight ridge f(t) = 100 + 1450 t. Try a longer or shorter segment: a long window sharpens the frequency but blurs the time.',
    components: [comp('chirp', { f0: 100, f1: 3000, amp: 1 })],
    analysis: { window: 'hann', stftSize: 512, overlap: 0.75, specMin: -80 },
  }),
  example({
    id: 'guitar-string', title: 'Guitar string: harmonic series', group: 'Time-frequency', fs: 11025, duration: 2, tab: 'spectrum',
    description: 'Synthetic (not a recording): a plucked A2 string at 110 Hz with 12 harmonics of amplitude 1/k, the higher ones dying faster (decay time 1 s / k). The peaks sit at 110, 220, 330 Hz... and the harmonic table of the Spectrum tab shows the series. The estimated fundamental is 110 Hz.',
    components: [comp('harmonics', { freq: 110, count: 12, rolloff: 1, tau: 1, attack: 0.005, amp: 0.5 })],
    analysis: { window: 'blackmanharris', fMax: 1500, peakRangeDb: 50, maxPeaks: 12, fundamental: 110 },
  }),
  example({
    id: 'chime', title: 'Audio chime (press play)', group: 'Time-frequency', fs: 44100, duration: 2.5, tab: 'time',
    description: 'Synthetic: a bell made of four inharmonic partials at 880, 1760, 2429 and 4752 Hz (ratios 1, 2, 2.76, 5.4), each fading with its own time constant. Press Play in the Time tab, then look at the Spectrum and Spectrogram tabs: the partials are the lines, and the high ones vanish first.',
    components: [comp('partials', { amp: 0.4, attack: 0.002, partials: [{ freq: 880, amp: 1, tau: 1.2 }, { freq: 1760, amp: 0.55, tau: 0.9 }, { freq: 2428.8, amp: 0.4, tau: 0.6 }, { freq: 4752, amp: 0.25, tau: 0.3 }] })],
    analysis: { window: 'blackmanharris', fMax: 6000, peakRangeDb: 50, stftSize: 2048, overlap: 0.75, specMin: -90 },
  }),
  example({
    id: 'am', title: 'AM modulation spectrum', group: 'Modulation', fs: 8192, duration: 1, tab: 'spectrum',
    description: 'Synthetic: a 1000 Hz carrier of amplitude 1, amplitude-modulated at 100 Hz with depth 0.5. The spectrum has the carrier (1.000) and two sidebands at 900 and 1100 Hz of amplitude m/2 = 0.250 each (-12 dB below the carrier).',
    components: [comp('am', { carrier: 1000, mod: 100, depth: 0.5, amp: 1 })],
    analysis: { window: 'flattop', fMax: 1600, peakRangeDb: 40 },
  }),
  example({
    id: 'fm', title: 'FM modulation spectrum', group: 'Modulation', fs: 16384, duration: 1, tab: 'spectrum',
    description: 'Synthetic: a 2000 Hz carrier frequency-modulated by 200 Hz with a 400 Hz deviation, so the modulation index is beta = 2. The lines at 2000 +/- n x 200 Hz have the Bessel amplitudes J0(2) = 0.224 at the carrier, J1(2) = 0.577, J2(2) = 0.353, J3(2) = 0.129, J4(2) = 0.034.',
    components: [comp('fm', { carrier: 2000, mod: 200, deviation: 400, amp: 1 })],
    analysis: { window: 'flattop', fMax: 3600, peakRangeDb: 40, maxPeaks: 12 },
  }),
  example({
    id: 'aliasing', title: 'Aliasing: 9 kHz sampled at 8 kHz', group: 'Sampling and converters', fs: 8000, duration: 1, tab: 'spectrum',
    description: 'Synthetic: a 9000 Hz sine sampled at only 8000 Hz. It is above the Nyquist frequency (4000 Hz), so it folds back to |9000 - 8000| = 1000 Hz: the spectrum shows a perfectly clean tone at 1000 Hz, and nothing in the samples can tell the two apart. Raise the sample rate in the Source panel to 32000 Hz and the peak moves to the real 9000 Hz.',
    components: [comp('sine', { freq: 9000, amp: 1 })],
    analysis: { window: 'hann', peakRangeDb: 60 },
  }),
  example({
    id: 'adc-quantisation', title: 'ADC quantisation noise', group: 'Sampling and converters', fs: 8192, duration: 1, tab: 'spectrum', bits: 10,
    description: 'Synthetic: a 1031 Hz sine at 99% of full scale, rounded to 10 bits. The ideal converter gives SNR = 6.02 N + 1.76 = 61.96 dB for a full-scale sine (61.9 dB here with the 1 % headroom) and ENOB = 10. Change the bit depth in the Source panel: every bit adds 6.02 dB.',
    components: [comp('sine', { freq: 1031, amp: 0.99 })],
    analysis: { window: 'rectangular', dbMin: -140, fundamental: 1031 },
  }),
  example({
    id: 'butterworth-noisy-sine', title: 'Noisy sine and a Butterworth low-pass', group: 'Filtering', fs: 2000, duration: 2, tab: 'time',
    description: 'Synthetic: a 50 Hz sine (amplitude 1) buried in white noise (sigma 0.5, SNR 3 dB). A 4th-order Butterworth low-pass at 100 Hz (-3.01 dB at the cutoff, 24 dB/octave beyond) removes most of the noise and passes the sine: the SNR rises from 3 dB to about 13 dB. It is applied forwards and backwards (zero phase), so the clean trace lines up with the noisy one; untick "Zero phase" in the Filter tab to see the delay a single pass adds.',
    components: [comp('sine', { freq: 50, amp: 1 })], noise: { sigma: 0.5, seed: 7 },
    analysis: { window: 'hann', fMax: 500, analyse: 'processed' },
    filter: { family: 'butter', type: 'lowpass', order: 4, f1: 100, zeroPhase: true }, process: { type: 'filter' },
  }),
  example({
    id: 'ecg-notch', title: '50 Hz mains hum on an ECG', group: 'Filtering', fs: 500, duration: 10, tab: 'spectrum',
    description: 'Synthetic ECG (72 bpm) with 50 Hz mains interference of amplitude 0.3 and a little noise. A notch (Q = 30) applied forwards and backwards removes the hum by more than 40 dB without distorting the QRS complexes. The Spectrum tab draws the filtered spectrum over the original (grey): the 50 Hz line is gone.',
    components: [comp('ecg', { bpm: 72, amp: 1, variability: 0.03, seed: 3 }), comp('sine', { freq: 50, amp: 0.3 })], noise: { sigma: 0.02, seed: 5 },
    analysis: { window: 'hann', fMax: 125, peakRangeDb: 50, analyse: 'processed' },
    filter: { family: 'notch', type: 'bandstop', order: 2, f1: 50, q: 30, zeroPhase: true }, process: { type: 'filter' },
  }),
  example({
    id: 'fir-vs-iir', title: 'FIR versus IIR: linear phase', group: 'Filtering', fs: 8000, duration: 0.5, tab: 'filter',
    description: 'Synthetic square wave through two low-pass filters: a 51-tap Hamming FIR and a 4th-order Butterworth, both at 1000 Hz at fs 8000 Hz. The FIR has exactly linear phase: a constant group delay of (51 - 1)/2 = 25 samples (3.125 ms). The Butterworth needs only 4 poles and has the -3 dB point at 1000 Hz (the Hamming FIR is already 6 dB down there), but its group delay changes by about 2 samples across the passband, which distorts the shape of a square wave (the source here).',
    components: [comp('square', { freq: 250, amp: 1 })],
    analysis: { window: 'hann', fMax: 4000 },
    filter: { family: 'fir', type: 'lowpass', order: 51, f1: 1000, window: 'hamming' }, compare: { family: 'butter', type: 'lowpass', order: 4, f1: 1000 }, process: { type: 'filter' },
  }),
  example({
    id: 'savgol-vs-ma', title: 'Savitzky-Golay versus moving average', group: 'Filtering', fs: 1000, duration: 2, tab: 'time',
    description: 'Synthetic: a Gaussian peak (height 1, sigma 8 ms) with noise (sigma 0.05). A 21-point moving average flattens the peak to about 0.78 of its height and widens it (SNR 12 dB); a Savitzky-Golay filter of the same width (cubic fit) keeps about 0.95 of the height (SNR 14 dB). Switch the Process control in the Time tab between the two.',
    components: [comp('gaussian', { amp: 1, center: 1, width: 0.008 })], noise: { sigma: 0.05, seed: 11 },
    analysis: { window: 'hann', fMax: 500 }, process: { type: 'smooth', method: 'sg', width: 21, order: 3 },
  }),
  example({
    id: 'heart-rate', title: 'Heart rate from R peaks', group: 'Biomedical', fs: 250, duration: 15, tab: 'time',
    description: 'Synthetic ECG at 72 bpm with a little beat-to-beat variability and noise. Peak detection (height 0.5, at least 0.3 s apart) finds the 18 R peaks; the mean R-R interval is 0.83 s, which gives 72 bpm. The Time tab lists the intervals.',
    components: [comp('ecg', { bpm: 72, amp: 1, variability: 0.03, seed: 4 })], noise: { sigma: 0.02, seed: 9 },
    analysis: { window: 'hann', fMax: 60, timePeaks: { enabled: true, height: 0.5, minDistance: 0.3 } },
  }),
  example({
    id: 'white-noise-psd', title: 'White noise: power spectral density', group: 'Noise', fs: 10000, duration: 10, tab: 'spectrum',
    description: 'Synthetic: white noise of standard deviation 0.1 plus a 1000 Hz sine of amplitude 0.5. Welch averaging (Hann, 50 % overlap) shows a flat floor at sigma^2 / (fs/2) = 2e-6 V^2/Hz = -57 dB/Hz, with the sine a narrow line about 35 dB above it. Averaging more segments (a shorter segment length) smooths the floor but widens the bins.',
    components: [comp('sine', { freq: 1000, amp: 0.5 })], noise: { sigma: 0.1, seed: 21 },
    analysis: { window: 'hann', mode: 'welch', scale: 'psd', fftSize: 1024, overlap: 0.5, dbMin: -100 },
  }),
]

export function exampleById(id: string): Example | undefined {
  const t = id.trim().toLowerCase()
  return EXAMPLES.find((e) => e.id === t) ?? EXAMPLES.find((e) => e.title.toLowerCase().includes(t))
}

/** A fresh copy of an example's project (so editing it never changes the built-in one). */
export function exampleProject(e: Example): KsigProject {
  return JSON.parse(JSON.stringify(e.project)) as KsigProject
}
