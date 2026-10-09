// kSignal: FFT, windows, spectra and peak finding, tone metrics, filter design (against scipy), filtering, smoothing,
// generators, WAV / CSV / .ksig files, the 16 examples with the numbers their descriptions quote, the scipy bridge and
// the AI tools. No browser, no Python (the scipy values are in tools/tests/fixtures/ksignal-scipy.json).
//   node --test tools/tests/ksignal.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { convolveFft, fft, irfft, isPow2, nextPow2, rfft } from '../../src/apps/ksignal/fft.ts'
import { besselI0, makeWindow, windowGains, WINDOW_NAMES, type WindowName } from '../../src/apps/ksignal/windows.ts'
import {
  ampSpectrum, findSpectrumPeaks, peakPhase, refinePeak, spectrumPeaks, stft, toDb, toneMetrics, welch,
} from '../../src/apps/ksignal/spectrum.ts'
import {
  applyFilter, butterAnalog, cheby1Analog, cheby2Analog, designFilter, filtfilt, firWindow, frequencyGrid, frequencyResponse, gainDbAt, iirZpk, impulseResponse, isStable,
  kaiserOrder, lfilter, lfilterZi, normalizeFilterSpec, notchSos, polyFromRoots, polyRoots, sosfilt, sosfiltfilt, stepResponse, unwrapPhase, zpkToSos, sosToTf, DEFAULT_FILTER,
  type FilterSpec,
} from '../../src/apps/ksignal/filters.ts'
import { filterMetrics } from '../../src/apps/ksignal/filterInfo.ts'
import {
  autoCorrelation, crossCorrelation, decimate, estimatePeriod, findTimePeaks, heartRate, hilbertEnvelope, idealSnrDb, instantaneousFrequency, mean, medianFilter,
  minMaxDecimate, movingAverage, quantize, reduceMatrix, resample, rms, savgol, savgolCoeffs, signalStats, snrAgainst, stdDev,
} from '../../src/apps/ksignal/dsp.ts'
import {
  COMPONENT_TYPES, defaultComponent, ecgBeatTimes, generate, gaussian, normalizeComponent, normalizeGenerator, noise, partialsFromText, partialsToText, rng, sourceProblems, MAX_SAMPLES,
  type Component, type GeneratorSource,
} from '../../src/apps/ksignal/generators.ts'
import { looksLikeWav, mixToMono, readWav, writeWav, type WavFormat } from '../../src/apps/ksignal/wav.ts'
import { parseCsv, toCsv } from '../../src/apps/ksignal/csv.ts'
import { decodeFloat32, encodeFloat32, newProject, normalizeAnalysis, normalizeProcess, parseKsig, serializeKsig, DEFAULT_ANALYSIS } from '../../src/apps/ksignal/project.ts'
import { analyzeProject, floorPow2, processTrace, resolveFftSize, runProject, summarizeTrace, traceSpectrum, traceWelch } from '../../src/apps/ksignal/analysis.ts'
import { EXAMPLES, exampleById, exampleProject } from '../../src/apps/ksignal/examples.ts'
import { ksignalExampleFiles, KSIGNAL_EXAMPLES_FOLDER } from '../../src/apps/ksignal/exampleFiles.ts'
import { crossCheck, parsePythonOutput, pythonDesignCode, remezBands, specFromPython } from '../../src/apps/ksignal/pyfilters.ts'
import { buildReport } from '../../src/apps/ksignal/report.ts'
import { compactSummary, ksignalTools, type Hooks } from '../../src/apps/ksignal/aiTools.ts'
import { KSIGNAL_TOOL_SET } from '../../src/os/ai/manifests/ksignal.ts'
import { stepFigure, magnitudeFigure, phaseFigure, groupDelayFigure, poleZeroFigure, spectrumFigure, psdFigure, spectrogramFigure, timeFigure, DEFAULT_PALETTE, forExport, LIGHT_PALETTE } from '../../src/apps/ksignal/figures.ts'
import { fmtHz, fmtNum, fmtTime, median, parseEng } from '../../src/apps/ksignal/stats.ts'
import { amplitudeAtFreq, spectrumReadout, timeReadout, valueAtTime } from '../../src/apps/ksignal/readouts.ts'
import { exampleFileName, readExampleIndex } from '../../src/os/exampleFiles.ts'
import { ksignalOutputs } from '../export_ksignal_examples.ts'

const near = (a: number, b: number, rel = 1e-6, abs = 0) => assert.ok(Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel), `${a} ≈ ${b} (rel ${rel}, abs ${abs})`)
const sine = (n: number, f: number, fs: number, a = 1, ph = 0) => Float64Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / fs + ph))
const cosine = (n: number, f: number, fs: number, a = 1, ph = 0) => Float64Array.from({ length: n }, (_, i) => a * Math.cos((2 * Math.PI * f * i) / fs + ph))
const fixture = JSON.parse(readFileSync(new URL('./fixtures/ksignal-scipy.json', import.meta.url), 'utf8')) as {
  requests: Array<{ request: { method: 'remez' | 'ellip' | 'bessel' | 'check'; spec: FilterSpec; fs: number; transition: number }; output: Record<string, unknown> }>
  iir: Array<{ family: 'butter' | 'cheby1' | 'cheby2'; type: FilterSpec['type']; order: number; edges: number | number[]; rp: number; rs: number; fs: number; f: number[]; mag: number[]; phase: number[] }>
  signals: Record<string, number[]> & { x: number[]; sos: number[][]; filtfilt_b: number[]; filtfilt_a: number[] }
}
const maxAbs = (a: ArrayLike<number>, b: ArrayLike<number>, from = 0, to = Math.min(a.length, b.length)) => {
  let m = 0
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}

// ============================================================================================ FFT

test('FFT matches the DFT for powers of two, composites and primes; inverse and real helpers round-trip', () => {
  for (const n of [1, 2, 8, 12, 17, 64, 100, 127, 210]) {
    const x = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.01 * i + (i % 3))
    const re = Float64Array.from(x)
    const im = new Float64Array(n)
    fft(re, im)
    for (let k = 0; k < n; k++) {
      let r = 0
      let q = 0
      for (let j = 0; j < n; j++) { r += x[j] * Math.cos((2 * Math.PI * j * k) / n); q -= x[j] * Math.sin((2 * Math.PI * j * k) / n) }
      assert.ok(Math.hypot(r - re[k], q - im[k]) < 1e-9 * Math.max(1, n), `n=${n} bin ${k}`)
    }
    fft(re, im, true)
    assert.ok(maxAbs(re, x) < 1e-10, `inverse n=${n}`)
    const half = rfft(x)
    assert.equal(half.re.length, Math.floor(n / 2) + 1)
    assert.ok(maxAbs(irfft(half.re, half.im, n), x) < 1e-10, `irfft n=${n}`)
  }
  assert.ok(isPow2(1024) && !isPow2(1000))
  assert.equal(nextPow2(1000), 1024)
  assert.equal(nextPow2(1024), 1024)
  assert.throws(() => fft(new Float64Array(4), new Float64Array(3)))
})

test('Parseval and convolution theorem', () => {
  const x = Float64Array.from({ length: 1000 }, (_, i) => Math.cos(i * 0.31) + Math.sin(i * i * 0.001))
  const re = Float64Array.from(x)
  const im = new Float64Array(1000)
  fft(re, im)
  let e1 = 0
  let e2 = 0
  for (let i = 0; i < 1000; i++) { e1 += x[i] * x[i]; e2 += re[i] * re[i] + im[i] * im[i] }
  near(e2 / 1000, e1, 1e-10)
  const a = [1, 2, 3]
  const b = [0, 1, 0.5, 4]
  const c = convolveFft(a, b)
  const direct = [0, 1, 2.5, 8, 9.5, 12]
  assert.ok(maxAbs(c, direct) < 1e-12)
})

// ============================================================================================ windows

test('window gains: Hann, Hamming, Blackman-Harris, flat-top, Kaiser', () => {
  const n = 4096
  const hann = windowGains(makeWindow('hann', n))
  near(hann.cg, 0.5, 1e-12); near(hann.pg, 0.375, 1e-12); near(hann.enbw, 1.5, 1e-12)
  const hamming = windowGains(makeWindow('hamming', n))
  near(hamming.cg, 0.54, 1e-12); near(hamming.enbw, 1.3628, 1e-4)
  near(windowGains(makeWindow('rectangular', n)).enbw, 1, 1e-12)
  near(windowGains(makeWindow('blackman', n)).enbw, 1.7268, 1e-3)
  near(windowGains(makeWindow('blackmanharris', n)).enbw, 2.0044, 1e-3)
  const flat = windowGains(makeWindow('flattop', n))
  near(flat.cg, 0.2156, 1e-3); near(flat.enbw, 3.77, 5e-3)
  near(besselI0(1), 1.2660658777520082, 1e-12)
  near(besselI0(5), 27.239871823604442, 1e-12)
  const k = makeWindow('kaiser', 101, { beta: 8.6, periodic: false })
  near(k[50], 1, 1e-12)
  near(k[0], 1 / besselI0(8.6), 1e-12)
  for (let i = 0; i < 101; i++) near(k[i], k[100 - i], 1e-12)
  for (const name of WINDOW_NAMES) assert.equal(makeWindow(name as WindowName, 1)[0], 1)
  const sym = makeWindow('hann', 5, { periodic: false })
  assert.deepEqual(Array.from(sym).map((v) => Number(v.toFixed(6))), [0, 0.5, 1, 0.5, 0])
})

// ============================================================================================ spectra

test('amplitude calibration: a sine of amplitude A on a bin reads A with every window; DC reads its value', () => {
  const fs = 4096
  const n = 4096
  for (const w of WINDOW_NAMES) {
    const s = ampSpectrum(sine(n, 440, fs, 0.7), fs, { window: w as WindowName })
    near(s.amp[440], 0.7, 1e-3, 0)
    near(s.df, 1, 1e-12)
  }
  const dc = ampSpectrum(new Float64Array(n).fill(0.25), fs, { window: 'hann' })
  near(dc.amp[0], 0.25, 1e-12)
  // zero padding keeps the calibration
  const padded = ampSpectrum(sine(1000, 125, 1000, 1), 1000, { window: 'rectangular', nfft: 4000 })
  near(padded.amp[500], 1, 1e-9)
  assert.equal(padded.freq.length, 2001)
})

test('scalloping: the highest bin of a tone half a bin off', () => {
  const fs = 8192
  const x = sine(8192, 1000.5, fs)
  near(ampSpectrum(x, fs, { window: 'rectangular' }).amp[1000], 0.6366, 1e-3)
  near(ampSpectrum(x, fs, { window: 'hann' }).amp[1000], 0.8488, 1e-3)
  assert.ok(ampSpectrum(x, fs, { window: 'flattop' }).amp[1000] > 0.9988)
  near(toDb(ampSpectrum(x, fs, { window: 'rectangular' }).amp[1000]), -3.92, 1e-2)
  near(toDb(ampSpectrum(x, fs, { window: 'hann' }).amp[1000]), -1.42, 1e-2)
})

test('peak finder: frequency, amplitude and phase of off-bin tones for every window', () => {
  const N = 4096
  const limits: Record<string, [number, number, number]> = {
    // window: [frequency error (bins), amplitude error (relative), phase error (rad)]
    rectangular: [0.002, 0.002, 0.01], hann: [0.02, 0.01, 0.06], hamming: [0.02, 0.012, 0.06], blackman: [0.01, 0.005, 0.03],
    blackmanharris: [0.005, 0.002, 0.015], flattop: [0.005, 0.002, 0.01],
  }
  for (const [w, [fe, ae, pe]] of Object.entries(limits)) {
    for (let d = -0.5; d <= 0.5001; d += 0.125) {
      const f = 500 + d
      const s = ampSpectrum(cosine(N, f, N, 0.8, 0.3), N, { window: w as WindowName })
      const p = spectrumPeaks(s, { maxPeaks: 1 })[0]
      assert.ok(Math.abs(p.freq - f) <= fe, `${w} d=${d}: frequency ${p.freq} vs ${f}`)
      assert.ok(Math.abs(p.amp / 0.8 - 1) <= ae, `${w} d=${d}: amplitude ${p.amp}`)
      assert.ok(Math.abs(p.phase! - 0.3) <= pe, `${w} d=${d}: phase ${p.phase}`)
    }
  }
})

test('peak finder: strongest first, separation, range, interpolation can be switched off', () => {
  const fs = 8192
  const x = new Float64Array(8192)
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 1000 * i) / fs) + 0.5 * Math.sin((2 * Math.PI * 1234.5 * i) / fs) + 0.001 * Math.sin((2 * Math.PI * 3000 * i) / fs)
  const s = ampSpectrum(x, fs, { window: 'hann' })
  const peaks = spectrumPeaks(s, { rangeDb: 80 })
  assert.deepEqual(peaks.map((p) => Math.round(p.freq)), [1000, 1235, 3000])
  assert.ok(peaks[0].amp > peaks[1].amp && peaks[1].amp > peaks[2].amp)
  assert.equal(spectrumPeaks(s, { rangeDb: 20 }).length, 2)
  assert.equal(spectrumPeaks(s, { maxPeaks: 1 }).length, 1)
  const raw = findSpectrumPeaks(s.amp, s.df, { interpolate: false })
  assert.equal(raw[0].freq, 1000)
  assert.deepEqual(findSpectrumPeaks(new Float64Array(10), 1), [])
  // two lines closer than the separation are one peak
  const a = new Float64Array(20)
  a[8] = 1; a[10] = 0.9
  assert.equal(findSpectrumPeaks(a, 1, { minSepBins: 3 }).length, 1)
  assert.equal(findSpectrumPeaks(a, 1, { minSepBins: 2, rangeDb: 20 }).length, 2)
  near(peakPhase(ampSpectrum(cosine(1024, 100, 1024, 1, 1.0), 1024, { window: 'hann' }), 100), 1.0, 1e-6)
  near(refinePeak(s, 1000).freq, 1000, 1e-9)
})

test('Welch: the white-noise level, Parseval, and the line height of a sine', () => {
  const fs = 10000
  const n = 200000
  const sigma = 0.1
  const x = noise(n, sigma, 5)
  near(stdDev(x), sigma, 0.01)
  near(mean(x), 0, 0, 2e-3)
  const w = welch(x, fs, { nperseg: 1024, overlap: 0.5 })
  let s = 0
  for (let k = 5; k < w.psd.length - 5; k++) s += w.psd[k]
  near(s / (w.psd.length - 10), sigma ** 2 / (fs / 2), 0.03)
  // the integral of the density over frequency is the variance
  let total = 0
  for (let k = 0; k < w.psd.length; k++) total += w.psd[k] * (fs / 1024)
  near(total, sigma ** 2, 0.03)
  assert.ok(w.segments > 300)
  // power spectrum: a coherent sine of amplitude 0.5 puts 0.125 in its bin with a rectangular window
  const p = welch(sine(8192, 1000, 8192, 0.5), 8192, { nperseg: 8192, window: 'rectangular', scaling: 'spectrum', overlap: 0 })
  near(p.psd[1000], 0.125, 1e-9)
})

test('STFT: the ridge of a linear chirp follows f0 + k t', () => {
  const fs = 8000
  const T = 2
  const x = generate({ kind: 'generator', fs, duration: T, components: [{ ...defaultComponent('chirp'), f0: 100, f1: 3000, amp: 1 }], noise: { sigma: 0, seed: 1, color: 'white' }, bits: 0, fullScale: 1 })
  const st = stft(x, fs, { nperseg: 512, overlap: 0.75 })
  assert.equal(st.frames.length, st.time.length)
  assert.ok(st.frames.length > 100)
  for (let t = 3; t < st.frames.length - 3; t += 7) {
    let best = 0
    for (let k = 1; k < st.frames[t].length; k++) if (st.frames[t][k] > st.frames[t][best]) best = k
    const expected = 100 + ((3000 - 100) / T) * st.time[t]
    assert.ok(Math.abs(st.freq[best] - expected) < 2 * (fs / 512), `t=${st.time[t]}: ${st.freq[best]} vs ${expected}`)
  }
  // a stationary sine has the same amplitude in every frame
  const s2 = stft(sine(8000, 1000, 8000, 0.6), 8000, { nperseg: 400, overlap: 0.5, window: 'hann' })
  for (const f of s2.frames) near(f[50], 0.6, 1e-3)
})

// ============================================================================================ tone metrics

test('THD of a sine with a 1 % third harmonic, coherent and with Hann', () => {
  const fs = 8192
  const n = 8192
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 500 * i) / fs) + 0.01 * Math.sin((2 * Math.PI * 1500 * i) / fs)
  for (const w of ['rectangular', 'hann', 'blackmanharris'] as WindowName[]) {
    const m = toneMetrics(ampSpectrum(x, fs, { window: w }))!
    near(m.fundamental, 500, 1e-6)
    near(m.thdPercent, 1, 0.01)
    near(m.thdDb, -40, 0.01)
    const h3 = m.harmonics.find((h) => h.order === 3)!
    near(h3.freq, 1500, 1e-6)
    near(h3.amp, 0.01, 0.02)
    assert.ok(m.harmonics.find((h) => h.order === 2)!.amp < 1e-4)
  }
  assert.equal(toneMetrics(ampSpectrum(new Float64Array(1024), 1024)), null)
})

test('SNR of a quantised sine follows 6.02 N + 1.76 dB (spectrum and time domain)', () => {
  const fs = 8192
  const n = 8192
  const clean = sine(n, 1031, fs, 0.995)
  for (const bits of [8, 10, 12, 14, 16]) {
    const q = quantize(clean, bits, 1)
    const ideal = idealSnrDb(bits) + 20 * Math.log10(0.995)
    const td = snrAgainst(clean, q)
    // the full-scale sine just touches the top code: allow a little for clipping and for the sample set
    assert.ok(Math.abs(td - ideal) < 0.8, `${bits} bits: time-domain SNR ${td.toFixed(2)} vs ${ideal.toFixed(2)}`)
    const m = toneMetrics(ampSpectrum(q, fs, { window: 'rectangular' }), { fundamental: 1031 })!
    assert.ok(Math.abs(m.snrDb - ideal) < 1.5 || Math.abs(m.sinadDb - ideal) < 1.5, `${bits} bits: spectral SNR ${m.snrDb.toFixed(2)} / SINAD ${m.sinadDb.toFixed(2)} vs ${ideal.toFixed(2)}`)
    assert.ok(Math.abs(m.enob - bits) < 0.3, `${bits} bits: ENOB ${m.enob.toFixed(2)}`)
  }
  // every extra bit is worth 6 dB
  const a = snrAgainst(clean, quantize(clean, 8, 1))
  const b = snrAgainst(clean, quantize(clean, 9, 1))
  assert.ok(Math.abs(b - a - 6.02) < 0.6)
  // quantiser levels and saturation
  assert.deepEqual(Array.from(quantize([0, 0.3, -0.3, 2, -2], 2, 1)), [0, 0.5, -0.5, 0.5, -1])
})

// ============================================================================================ filter design

test('analog prototypes: Butterworth poles on the unit circle; Chebyshev gains', () => {
  const b = butterAnalog(4)
  assert.equal(b.p.length, 4)
  for (const p of b.p) { near(Math.hypot(p.re, p.im), 1, 1e-12); assert.ok(p.re < 0) }
  assert.equal(cheby1Analog(5, 1).p.length, 5)
  assert.equal(cheby2Analog(5, 40).z.length, 4)
  assert.equal(cheby2Analog(4, 40).z.length, 4)
})

test('Butterworth is -3.01 dB at the cutoff, every type; 20 dB/decade per order', () => {
  const fs = 8000
  for (const order of [1, 2, 3, 4, 5, 8]) {
    const lp = designFilter({ family: 'butter', type: 'lowpass', order, f1: 1000 }, fs)
    near(gainDbAt(lp, 1000), -3.0103, 1e-4)
    near(gainDbAt(lp, 1), 0, 0, 1e-4)
    const hp = designFilter({ family: 'butter', type: 'highpass', order, f1: 1000 }, fs)
    near(gainDbAt(hp, 1000), -3.0103, 1e-4)
    const bp = designFilter({ family: 'butter', type: 'bandpass', order, f1: 800, f2: 1500 }, fs)
    near(gainDbAt(bp, 800), -3.0103, 1e-4)
    near(gainDbAt(bp, 1500), -3.0103, 1e-4)
    assert.equal(bp.poles.length, 2 * order)
    const bs = designFilter({ family: 'butter', type: 'bandstop', order, f1: 800, f2: 1500 }, fs)
    near(gainDbAt(bs, 800), -3.0103, 1e-4)
    near(gainDbAt(bs, 1500), -3.0103, 1e-4)
    // the null sits at the bilinear image of the geometric centre of the warped edges
    const centre = (fs / Math.PI) * Math.atan(Math.sqrt(Math.tan((Math.PI * 800) / fs) * Math.tan((Math.PI * 1500) / fs)))
    if (order >= 2) assert.ok(gainDbAt(bs, centre) < -100, `order ${order}: ${gainDbAt(bs, centre)} dB`)
  }
  const d = designFilter({ family: 'butter', type: 'lowpass', order: 4, f1: 100 }, 20000)
  // the slope far above the corner: 24 dB per octave (the bilinear transform bends it slightly)
  assert.ok(Math.abs(gainDbAt(d, 800) - gainDbAt(d, 1600) - 24.08) < 0.8)
})

test('Chebyshev I: ripple at the edge; Chebyshev II: attenuation at the edge', () => {
  const fs = 8000
  for (const order of [3, 4, 5, 6]) {
    const c1 = designFilter({ family: 'cheby1', type: 'lowpass', order, f1: 1000, rp: 1 }, fs)
    near(gainDbAt(c1, 1000), -1, 1e-4)
    near(gainDbAt(c1, 1), order % 2 ? 0 : -1, 0, 1e-4)
    const r = frequencyResponse(c1, frequencyGrid(0, 990, 400))
    assert.ok(Math.min(...r.magDb) >= -1 - 1e-6 && Math.max(...r.magDb) <= 1e-6, 'ripple stays within 1 dB')
    const c2 = designFilter({ family: 'cheby2', type: 'lowpass', order, f1: 1000, rs: 40 }, fs)
    near(gainDbAt(c2, 1000), -40, 1e-4)
    near(gainDbAt(c2, 1), 0, 0, 1e-4)
    assert.ok(gainDbAt(c2, 3000) <= -40 + 1e-6)
    const bp = designFilter({ family: 'cheby2', type: 'bandpass', order, f1: 800, f2: 1500, rs: 50 }, fs)
    near(gainDbAt(bp, 800), -50, 1e-3)
    near(gainDbAt(bp, 1500), -50, 1e-3)
  }
})

test('IIR designs match scipy.signal (magnitude and phase, all families and types)', () => {
  for (const c of fixture.iir) {
    const edges = Array.isArray(c.edges) ? c.edges : [c.edges]
    const d = designFilter({ family: c.family, type: c.type, order: c.order, f1: edges[0], f2: edges[1] ?? edges[0], rp: c.rp, rs: c.rs }, c.fs)
    const r = frequencyResponse(d, c.f)
    for (let i = 0; i < c.f.length; i++) {
      near(r.mag[i], c.mag[i], 1e-9, 1e-12)
      if (c.mag[i] > 1e-6) {
        const dp = Math.atan2(Math.sin(r.phase[i] - c.phase[i]), Math.cos(r.phase[i] - c.phase[i]))
        assert.ok(Math.abs(dp) < 1e-7, `${c.family} ${c.type} ${c.order} f=${c.f[i]}: phase ${r.phase[i]} vs ${c.phase[i]}`)
      }
    }
  }
})

test('second-order sections: a transfer function, stability up to order 12, errors', () => {
  const zpk = iirZpk('butter', 'lowpass', 4, 1000, 8000)
  const sos = zpkToSos(zpk)
  assert.equal(sos.length, 2)
  const tf = sosToTf(sos)
  near(tf.b.reduce((a, v) => a + v, 0) / tf.a.reduce((a, v) => a + v, 0), 1, 1e-12) // unit DC gain
  const sc = polyFromRoots([{ re: 1, im: 0 }, { re: 2, im: 0 }])
  assert.deepEqual(sc, [1, -3, 2])
  for (const family of ['butter', 'cheby1', 'cheby2'] as const) {
    for (const type of ['lowpass', 'highpass', 'bandpass', 'bandstop'] as const) {
      for (const order of [1, 2, 5, 8, 12]) {
        const d = designFilter({ family, type, order, f1: type.startsWith('band') ? 300 : 700, f2: 1100, rp: 0.5, rs: 60 }, 4000)
        assert.ok(isStable(d), `${family} ${type} ${order} is stable`)
        assert.equal(d.sos.length, Math.ceil(d.poles.length / 2))
      }
    }
  }
  assert.throws(() => designFilter({ ...DEFAULT_FILTER, f1: 5000 }, 8000), /Nyquist/)
  assert.throws(() => designFilter({ ...DEFAULT_FILTER, f1: 0 }, 8000), /between 0/)
  assert.throws(() => designFilter({ ...DEFAULT_FILTER, type: 'bandpass', f1: 2000, f2: 1000 }, 8000), /lower edge/)
  assert.throws(() => designFilter({ ...DEFAULT_FILTER, order: 0 }, 8000), /order/)
  assert.throws(() => designFilter({ ...DEFAULT_FILTER, family: 'cheby1', rp: 0 }, 8000), /ripple/)
  assert.throws(() => designFilter({ ...DEFAULT_FILTER, family: 'scipy' }, 8000), /scipy/)
  assert.throws(() => designFilter(DEFAULT_FILTER, 0), /sample rate/)
})

test('notch: a deep null at f0, flat elsewhere, bandwidth f0/Q (matches scipy.signal.iirnotch)', () => {
  const d = designFilter({ ...DEFAULT_FILTER, family: 'notch', f1: 50, q: 30 }, 500)
  assert.ok(gainDbAt(d, 50) < -100)
  near(gainDbAt(d, 5), 0, 0, 0.01)
  near(gainDbAt(d, 200), 0, 0, 0.01)
  const m = filterMetrics(d)
  assert.equal(m.cutoffs3dB.length, 2)
  near(m.cutoffs3dB[1] - m.cutoffs3dB[0], 50 / 30, 0.02)
  assert.throws(() => notchSos(300, 30, 500), /between/)
  const x = generate({ kind: 'generator', fs: 500, duration: 4, components: [{ ...defaultComponent('sine'), freq: 50, amp: 0.3 }, { ...defaultComponent('sine'), freq: 7, amp: 1 }], noise: { sigma: 0, seed: 1, color: 'white' }, bits: 0, fullScale: 1 })
  const y = applyFilter(d, x, true)
  const sp = ampSpectrum(y, 500, { window: 'rectangular', start: 500, length: 1000 })
  assert.ok(sp.amp[100] < 0.3 / 100, 'hum down by more than 40 dB')
  near(sp.amp[14], 1, 1e-3)
})

test('FIR window design: linear phase, constant group delay, unit gain, symmetric', () => {
  const fs = 8000
  const d = designFilter({ ...DEFAULT_FILTER, family: 'fir', type: 'lowpass', order: 51, f1: 1000, window: 'hamming' }, fs)
  assert.equal(d.kind, 'fir')
  assert.equal(d.b.length, 51)
  for (let i = 0; i < 51; i++) near(d.b[i], d.b[50 - i], 1e-12)
  near(gainDbAt(d, 0.001), 0, 0, 1e-9)
  assert.ok(gainDbAt(d, 2000) < -50)
  const r = frequencyResponse(d, frequencyGrid(0, 900, 100))
  for (const g of r.groupDelay) near(g, 25, 1e-9)
  // linear phase: phase = -25 ω
  const w = (2 * Math.PI * 500) / fs
  const dphi = frequencyResponse(d, [500]).phase[0] + 25 * w
  assert.ok(Math.abs(Math.sin(dphi / 2)) < 1e-9, 'phase = -25 w (mod 2 pi)')
  // high-pass: odd number of taps, unit gain at Nyquist
  const hp = designFilter({ ...DEFAULT_FILTER, family: 'fir', type: 'highpass', order: 50, f1: 1000 }, fs)
  assert.equal(hp.b.length, 51)
  assert.ok(hp.notes[0].includes('odd'))
  near(gainDbAt(hp, 4000), 0, 0, 1e-9)
  assert.ok(gainDbAt(hp, 100) < -40)
  const bp = designFilter({ ...DEFAULT_FILTER, family: 'fir', type: 'bandpass', order: 101, f1: 1000, f2: 2000, window: 'blackman' }, fs)
  near(gainDbAt(bp, 1500), 0, 0, 1e-9)
  assert.ok(gainDbAt(bp, 200) < -50 && gainDbAt(bp, 3500) < -50)
  const bs = designFilter({ ...DEFAULT_FILTER, family: 'fir', type: 'bandstop', order: 101, f1: 1000, f2: 2000 }, fs)
  near(gainDbAt(bs, 0.001), 0, 0, 1e-9)
  assert.ok(gainDbAt(bs, 1500) < -40)
  assert.throws(() => firWindow('lowpass', 2, 1000, 8000), /taps/)
  // Kaiser sizing: 60 dB over a 100 Hz transition at 8 kHz
  const k = kaiserOrder(60, 100, 8000)
  assert.equal(k.taps, 293) // scipy.signal.kaiserord says 292; an odd length keeps all four filter types possible
  near(k.beta, 5.6533, 1e-4)
  const kd = designFilter({ ...DEFAULT_FILTER, family: 'fir', order: k.taps, f1: 1000, window: 'kaiser', beta: k.beta }, fs)
  assert.ok(gainDbAt(kd, 1100) <= -58, 'the Kaiser design meets its attenuation past the transition')
})

test('FIR designs and the notch match scipy.signal (firwin, iirnotch) and scipy results are read back', () => {
  for (const item of fixture.requests) {
    const out = item.output
    const r = parsePythonOutput('noise\nKSIG_RESULT ' + JSON.stringify(out) + '\n')
    assert.equal(r.freqs.length, r.magDb.length)
    if (item.request.method === 'check') {
      const cc = crossCheck(item.request.spec, item.request.fs, r)
      assert.ok(cc.maxDiffDb < 1e-6, `${item.request.spec.family}: pure and scipy differ by ${cc.maxDiffDb} dB at ${cc.at} Hz`)
      assert.ok(cc.points > 100, `${item.request.spec.family}: ${cc.points} points compared`)
    } else {
      // a scipy design (remez / ellip / bessel) becomes a "scipy" spec whose response is the one scipy printed
      const spec = specFromPython(item.request.spec, r, `${item.request.method} test`)
      assert.equal(spec.family, 'scipy')
      const d = designFilter(spec, item.request.fs)
      const mine = frequencyResponse(d, r.freqs)
      let worst = 0
      for (let i = 0; i < r.freqs.length; i++) if (r.magDb[i] > -100) worst = Math.max(worst, Math.abs(mine.magDb[i] - r.magDb[i]))
      assert.ok(worst < 1e-6, `${item.request.method}: coefficients reproduce the response (${worst} dB)`)
      assert.ok(isStable(d))
      // the spec survives a JSON round trip
      assert.deepEqual(normalizeFilterSpec(JSON.parse(JSON.stringify(spec))), spec)
    }
  }
  const remez = fixture.requests[0]
  const rm = designFilter(specFromPython(remez.request.spec, parsePythonOutput('KSIG_RESULT ' + JSON.stringify(remez.output)), 'Remez'), 8000)
  assert.equal(rm.kind, 'fir')
  assert.equal(rm.b.length, 61)
  for (let i = 0; i < 61; i++) near(rm.b[i], rm.b[60 - i], 1e-9, 1e-12) // equiripple FIR: symmetric
})

// ============================================================================================ filtering

test('lfilter, lfilter_zi, filtfilt and sosfiltfilt match scipy', () => {
  const s = fixture.signals
  const b = s.filtfilt_b
  const a = s.filtfilt_a
  assert.ok(maxAbs(lfilter(b, a, s.x), s.lfilter) < 1e-12)
  assert.ok(maxAbs(lfilterZi(b, a), s.zi) < 1e-12)
  assert.ok(maxAbs(filtfilt(b, a, s.x), s.filtfilt) < 1e-9)
  assert.ok(maxAbs(sosfiltfilt(s.sos, s.x), s.sosfiltfilt) < 1e-9)
  // an FIR through lfilter is a convolution
  const h = [0.25, 0.5, 0.25]
  assert.ok(maxAbs(lfilter(h, [1], [1, 0, 0, 0, 2]), [0.25, 0.5, 0.25, 0, 0.5]) < 1e-15)
  assert.throws(() => lfilter([1], [0], [1, 2]))
  // an IIR with sections equals its transfer function
  const d = designFilter({ ...DEFAULT_FILTER, order: 2, f1: 1000 }, 8000)
  const x = sine(200, 300, 8000)
  assert.ok(maxAbs(sosfilt(d.sos, x), lfilter(d.b, d.a, x)) < 1e-12)
})

test('filtfilt has zero phase and the squared magnitude; one pass delays', () => {
  const fs = 2000
  const d = designFilter({ ...DEFAULT_FILTER, family: 'butter', order: 4, f1: 100 }, fs)
  const f = 60
  const n = 4000
  const x = sine(n, f, fs)
  const once = applyFilter(d, x, false)
  const twice = applyFilter(d, x, true)
  const h = frequencyResponse(d, [f])
  // in the middle of the record, away from the transients
  const from = 1000
  const to = 3000
  let e1 = 0
  let e2 = 0
  for (let i = from; i < to; i++) {
    e1 = Math.max(e1, Math.abs(once[i] - h.mag[0] * Math.sin((2 * Math.PI * f * i) / fs + h.phase[0])))
    e2 = Math.max(e2, Math.abs(twice[i] - h.mag[0] ** 2 * Math.sin((2 * Math.PI * f * i) / fs)))
  }
  assert.ok(e1 < 1e-6, `single pass follows H(f): ${e1}`)
  assert.ok(e2 < 1e-6, `zero-phase pass follows |H|²: ${e2}`)
  assert.ok(h.phase[0] < -0.1, 'one pass lags')
  // the zero-phase response is |H|² with no phase
  const zp = designFilter({ ...DEFAULT_FILTER, family: 'butter', order: 4, f1: 100, zeroPhase: true }, fs)
  const rz = frequencyResponse(zp, [60, 100])
  near(rz.mag[1], 0.5, 1e-9)
  assert.equal(rz.phase[0], 0)
  // FIR zero-phase: no delay either
  const fir = designFilter({ ...DEFAULT_FILTER, family: 'fir', order: 41, f1: 100, window: 'hamming' }, fs)
  const yf = applyFilter(fir, x, true)
  for (let i = from; i < to; i += 37) near(yf[i], frequencyResponse(fir, [f]).mag[0] ** 2 * Math.sin((2 * Math.PI * f * i) / fs), 1e-6, 1e-7)
  // short signals do not throw
  assert.equal(applyFilter(d, [1], true).length, 1)
  assert.equal(applyFilter(d, [], true).length, 0)
})

test('long FIR filters take the FFT path and give the same samples as the direct form', () => {
  const x = Float64Array.from({ length: 20000 }, (_, i) => Math.sin(i * 0.05) + 0.3 * Math.sin(i * 0.9) + (i % 7) * 0.01)
  const d = designFilter({ ...DEFAULT_FILTER, family: 'fir', order: 301, f1: 800, window: 'hamming' }, 8000) // 301 x 20000 = 6e6 > the direct-form limit
  assert.ok(d.b.length * x.length > 4e6)
  const fast = applyFilter(d, x, false)
  assert.ok(maxAbs(fast, lfilter(d.b, [1], x)) < 1e-10)
  const fastZp = applyFilter(d, x, true)
  assert.ok(maxAbs(fastZp, filtfilt(d.b, [1], x)) < 1e-9)
  // a short signal: the direct form is used and nothing breaks on tiny input
  assert.equal(applyFilter(d, [1, 2, 3], true).length, 3)
  assert.equal(applyFilter(d, [], false).length, 0)
})

test('step and impulse responses: the step settles at the DC gain; the FIR impulse response is its taps', () => {
  const d = designFilter({ ...DEFAULT_FILTER, family: 'cheby1', order: 4, f1: 500, rp: 1 }, 4000)
  const s = stepResponse(d, 2000)
  near(s[1999], 10 ** (-1 / 20), 1e-6) // even order: DC gain = -rp
  const fir = designFilter({ ...DEFAULT_FILTER, family: 'fir', order: 11, f1: 500 }, 4000)
  assert.ok(maxAbs(impulseResponse(fir, 11), fir.b) < 1e-15)
  const lp = designFilter({ ...DEFAULT_FILTER, order: 2, f1: 500 }, 4000)
  near(stepResponse(lp, 500)[499], 1, 1e-9)
  // the sum of the impulse response is the DC gain
  near(impulseResponse(lp, 2000).reduce((a, v) => a + v, 0), 1, 1e-9)
})

test('group delay: FIR constant, Butterworth varies; metrics', () => {
  const fir = filterMetrics(designFilter({ ...DEFAULT_FILTER, family: 'fir', order: 51, f1: 1000, window: 'hamming' }, 8000))
  near(fir.groupDelayDc, 25, 1e-9)
  assert.ok(fir.groupDelaySpread < 1e-9)
  assert.equal(fir.kind, 'FIR'); assert.equal(fir.size, 51)
  const iir = filterMetrics(designFilter({ ...DEFAULT_FILTER, order: 4, f1: 1000 }, 8000))
  assert.ok(iir.groupDelaySpread > 1.5)
  assert.equal(iir.kind, 'IIR'); assert.equal(iir.size, 4)
  near(iir.cutoffs3dB[0], 1000, 1e-4)
  near(iir.dcGainDb, 0, 0, 1e-9)
  assert.ok(iir.stable)
})

test('polynomial roots', () => {
  const r = polyRoots([1, -6, 11, -6]) // (z-1)(z-2)(z-3)
  assert.deepEqual(r.map((v) => Math.round(v.re * 1e6) / 1e6).sort(), [1, 2, 3])
  const c = polyRoots([1, 0, 1])
  assert.ok(c.every((v) => Math.abs(v.re) < 1e-9 && Math.abs(Math.abs(v.im) - 1) < 1e-9))
  assert.equal(polyRoots([2, 0, 0]).length, 2) // roots at zero
  assert.equal(polyRoots([5]).length, 0)
  // the zeros of a symmetric FIR lie on the unit circle or in reciprocal pairs
  const d = designFilter({ ...DEFAULT_FILTER, family: 'fir', order: 21, f1: 1000 }, 8000)
  assert.equal(d.zeros.length, 20)
  const radii = d.zeros.map((z) => Math.hypot(z.re, z.im))
  for (const rad of radii) assert.ok(radii.some((o) => Math.abs(o * rad - 1) < 1e-6), 'reciprocal pair')
})

test('phase unwrapping', () => {
  const p = unwrapPhase([0, 3, -3, 0, 3, -3])
  for (let i = 1; i < p.length; i++) assert.ok(Math.abs(p[i] - p[i - 1]) < Math.PI)
})

// ============================================================================================ dsp

test('Savitzky-Golay: coefficients, exact for polynomials (edges too), matches scipy', () => {
  assert.ok(maxAbs(savgolCoeffs(5, 2), [-3 / 35, 12 / 35, 17 / 35, 12 / 35, -3 / 35]) < 1e-12)
  assert.ok(maxAbs(savgolCoeffs(5, 2), fixture.signals.savgol_5_2) < 1e-12)
  assert.ok(maxAbs(savgolCoeffs(5, 2, 1), [-0.2, -0.1, 0, 0.1, 0.2]) < 1e-12) // first derivative
  const poly = Float64Array.from({ length: 50 }, (_, i) => 1 + 0.5 * i - 0.02 * i * i + 0.001 * i ** 3)
  assert.ok(maxAbs(savgol(poly, 11, 3), poly) < 1e-8, 'a cubic passes through unchanged, ends included')
  assert.ok(maxAbs(savgol(fixture.signals.x, 11, 3), fixture.signals.savgol) < 1e-10, 'the same as scipy.signal.savgol_filter (interp mode)')
  assert.equal(savgol([1, 2], 11, 3).length, 2)
})

test('moving average and median: peak flattening and spike removal', () => {
  assert.deepEqual(Array.from(movingAverage([1, 2, 3, 4, 5], 3)), [1.5, 2, 3, 4, 4.5])
  assert.deepEqual(Array.from(movingAverage([1, 2, 3], 1)), [1, 2, 3])
  const spiky = [1, 1, 1, 100, 1, 1, 1]
  assert.deepEqual(Array.from(medianFilter(spiky, 3)), [1, 1, 1, 1, 1, 1, 1])
  assert.deepEqual(Array.from(medianFilter([5, 1, 4], 3)), [3, 4, 2.5])
})

test('Savitzky-Golay keeps a noisy peak better than a moving average (the example)', () => {
  const e = exampleById('savgol-vs-ma')!
  const r = runProject(e.project)
  const x = r.original.x
  const clean = Float64Array.from({ length: x.length }, (_, i) => Math.exp(-0.5 * ((i / 1000 - 1) / 0.008) ** 2))
  const max = (a: ArrayLike<number>) => Math.max(...Array.from(a))
  const sg = savgol(x, 21, 3)
  const ma = movingAverage(x, 21)
  assert.ok(max(sg) > 0.93 && max(sg) < 1.0, `SG peak ${max(sg)}`)
  assert.ok(max(ma) > 0.74 && max(ma) < 0.82, `MA peak ${max(ma)}`)
  assert.ok(snrAgainst(clean, sg) > snrAgainst(clean, ma) + 1, 'SG is closer to the truth')
  assert.ok(snrAgainst(clean, sg) > snrAgainst(clean, x) + 8)
})

test('decimation and resampling keep a tone and reject aliases', () => {
  const fs = 8000
  const x = new Float64Array(8000)
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 300 * i) / fs) + Math.sin((2 * Math.PI * 3500 * i) / fs)
  const d = decimate(x, 4, fs)
  assert.equal(d.fs, 2000)
  assert.equal(d.x.length, 2000)
  const sp = ampSpectrum(d.x, d.fs, { window: 'hann' })
  const peaks = spectrumPeaks(sp, { rangeDb: 40 })
  assert.equal(peaks.length, 1, 'the 3500 Hz tone is filtered out before it can alias')
  near(peaks[0].freq, 300, 1e-3)
  near(peaks[0].amp, 1, 0.03)
  assert.equal(decimate(x, 1, fs).x.length, 8000)
  // resample 8 kHz -> 12 kHz and back: the tone keeps its frequency
  const y = resample(sine(4000, 440, 8000, 0.8), 8000, 12000)
  assert.equal(y.length, 6000)
  const sp2 = ampSpectrum(y.subarray(500, 5500), 12000, { window: 'hann', nfft: 8192 })
  const p2 = spectrumPeaks(sp2, { maxPeaks: 1 })[0]
  near(p2.freq, 440, 1e-3)
  near(p2.amp, 0.8, 0.02)
  assert.equal(resample([1, 2, 3], 100, 100).length, 3)
  const down = resample(sine(8000, 100, 8000), 8000, 2000)
  near(spectrumPeaks(ampSpectrum(down.subarray(50, 1950), 2000, { window: 'hann' }), { maxPeaks: 1 })[0].freq, 100, 2e-3)
})

test('correlation: lag of a delayed copy, period of a periodic signal', () => {
  const x = Float64Array.from({ length: 400 }, (_, i) => Math.sin(i * 0.3) * Math.exp(-((i - 150) ** 2) / 800))
  const y = new Float64Array(400)
  for (let i = 7; i < 400; i++) y[i] = x[i - 7]
  const c = crossCorrelation(y, x, 30)
  let best = 0
  for (let i = 0; i < c.r.length; i++) if (c.r[i] > c.r[best]) best = i
  assert.equal(c.lags[best], 7)
  const ac = autoCorrelation(x, 50, true)
  near(ac.r[50], 1, 1e-9)
  assert.equal(ac.lags[0], -50)
  // the period of 200 Hz at 8 kHz is 5 ms
  near(estimatePeriod(sine(4000, 200, 8000), 8000), 0.005, 1e-3)
  assert.equal(estimatePeriod(noise(4000, 1, 3), 8000), 0)
})

test('Hilbert: the envelope of an AM signal and the instantaneous frequency of a tone', () => {
  const fs = 8000
  const n = 8000
  const x = Float64Array.from({ length: n }, (_, i) => (1 + 0.5 * Math.cos((2 * Math.PI * 5 * i) / fs)) * Math.cos((2 * Math.PI * 500 * i) / fs))
  const env = hilbertEnvelope(x)
  for (let i = 200; i < n - 200; i += 53) near(env[i], 1 + 0.5 * Math.cos((2 * Math.PI * 5 * i) / fs), 1e-3, 1e-3)
  const f = instantaneousFrequency(sine(2000, 300, 8000), 8000)
  near(f[1000], 300, 1e-3)
})

test('time-domain peaks and heart rate', () => {
  const fs = 100
  const x = new Float64Array(1000)
  const at = [50, 130, 205, 290, 370, 450, 540]
  for (const p of at) for (let k = -3; k <= 3; k++) x[p + k] = 1 - 0.1 * k * k
  const peaks = findTimePeaks(x, fs, 0.5, 0.4)
  assert.deepEqual(peaks.map((p) => p.index), at)
  assert.equal(findTimePeaks(x, fs, 2).length, 0)
  const hr = heartRate(peaks)!
  near(hr.meanRR, (540 - 50) / 6 / 100, 1e-9)
  near(hr.bpm, 60 / hr.meanRR, 1e-9)
  assert.equal(hr.beats, 7)
  assert.equal(heartRate([]), null)
  // a smaller neighbour inside the minimum distance is dropped
  const y = new Float64Array(100); y[20] = 1; y[24] = 0.9
  assert.equal(findTimePeaks(y, 100, 0.5, 0.1).length, 1)
  assert.equal(findTimePeaks(y, 100, 0.5, 0.01).length, 2)
})

test('plot decimation keeps the extremes; matrices shrink to a limit', () => {
  const y = new Float64Array(100000)
  y[54321] = 5
  y[77777] = -3
  const d = minMaxDecimate((i) => i / 1000, y, 0, y.length, 2000)
  assert.ok(d.x.length <= 2000 && d.x.length > 1000)
  assert.equal(Math.max(...d.y), 5)
  assert.equal(Math.min(...d.y), -3)
  const small = minMaxDecimate([0, 1, 2], [4, 5, 6], 0, 3, 100)
  assert.deepEqual(small, { x: [0, 1, 2], y: [4, 5, 6] })
  const frames = Array.from({ length: 1000 }, (_, t) => Float32Array.from({ length: 800 }, (_, f) => (t === 500 && f === 400 ? 9 : 1)))
  const r = reduceMatrix(frames, 300, 200)
  assert.ok(r.z.length <= 200 && r.z[0].length <= 300)
  assert.equal(Math.max(...r.z.flat()), 9, 'the maximum of each block is kept')
  assert.equal(signalStats([1, -3, 2]).peak, 3)
  near(signalStats([3, 4]).rms, Math.sqrt(12.5), 1e-12)
  near(rms([1, -1, 1, -1]), 1, 1e-12)
})

// ============================================================================================ generators

test('generators are deterministic and have the documented spectra', () => {
  const g = (components: Component[], extra: Partial<GeneratorSource> = {}): GeneratorSource => ({
    kind: 'generator', fs: 8192, duration: 1, components, noise: { sigma: 0, seed: 1, color: 'white' }, bits: 0, fullScale: 1, ...extra,
  })
  const c = (type: Component['type'], over: Partial<Component> = {}): Component => ({ ...defaultComponent(type), ...over })
  // determinism
  const noisy = g([c('sine', { freq: 100 })], { noise: { sigma: 0.2, seed: 9, color: 'white' } })
  assert.deepEqual(generate(noisy), generate(noisy))
  assert.notDeepEqual(generate(noisy), generate({ ...noisy, noise: { sigma: 0.2, seed: 10, color: 'white' } }))
  // AM: carrier 1, sidebands depth/2
  const am = ampSpectrum(generate(g([c('am', { carrier: 1000, mod: 100, depth: 0.5, amp: 1 })])), 8192, { window: 'flattop' })
  near(am.amp[1000], 1, 1e-3); near(am.amp[900], 0.25, 2e-3); near(am.amp[1100], 0.25, 2e-3)
  // FM: Bessel sidebands for beta = 2
  const fm = ampSpectrum(generate(g([c('fm', { carrier: 2000, mod: 200, deviation: 400, amp: 1 })], { fs: 16384 })), 16384, { window: 'flattop' })
  const J = [0.22389, 0.57672, 0.35283, 0.12894, 0.03400]
  J.forEach((v, n) => { near(fm.amp[2000 + 200 * n], v, 0.01, 2e-4); if (n) near(fm.amp[2000 - 200 * n], v, 0.01, 2e-4) })
  // square wave: odd harmonics 4/(pi k)
  const sq = ampSpectrum(generate(g([c('square', { freq: 100, amp: 1 })])), 8192, { window: 'hann' })
  const pk = spectrumPeaks(sq, { rangeDb: 30 })
  ;[1, 3, 5, 7].forEach((k, i) => { near(pk[i].freq, 100 * k, 1e-3); near(pk[i].amp, 4 / (Math.PI * k), 0.01) })
  // triangle: odd harmonics 8/(pi k)^2
  const tri = spectrumPeaks(ampSpectrum(generate(g([c('triangle', { freq: 100, amp: 1 })])), 8192, { window: 'hann' }), { rangeDb: 40 })
  near(tri[0].amp, 8 / Math.PI ** 2, 0.01); near(tri[1].amp, 8 / (9 * Math.PI ** 2), 0.02)
  // saw: harmonics 2/(pi k)
  const saw = spectrumPeaks(ampSpectrum(generate(g([c('saw', { freq: 100, amp: 1 })])), 8192, { window: 'hann' }), { rangeDb: 30 })
  near(saw[0].amp, 2 / Math.PI, 0.02); near(saw[1].amp, 1 / Math.PI, 0.02)
  // pulse train: mean = amp * duty
  near(mean(generate(g([c('pulse', { freq: 10, duty: 0.2, amp: 2 })]))), 0.4, 0.01)
  // chirp: instantaneous frequency
  const ch = generate(g([c('chirp', { f0: 500, f1: 1500, amp: 1 })], { fs: 8000 }))
  const inst = instantaneousFrequency(ch, 8000)
  near(inst[4000], 1000, 0.01); near(inst[2000], 750, 0.02)
  const lg = generate(g([c('chirp', { f0: 100, f1: 1600, sweep: 'log' })], { fs: 8000 }))
  near(instantaneousFrequency(lg, 8000)[4000], 400, 0.03) // geometric middle
  // harmonics and partials
  const h = spectrumPeaks(ampSpectrum(generate(g([c('harmonics', { freq: 110, count: 6, rolloff: 1, tau: 0, attack: 0, amp: 1 })])), 8192, { window: 'blackmanharris' }), { rangeDb: 40, maxPeaks: 6 })
  assert.deepEqual(h.map((p) => Math.round(p.freq)).sort((a, b) => a - b), [110, 220, 330, 440, 550, 660])
  near(h.find((p) => Math.round(p.freq) === 330)!.amp, 1 / 3, 0.01)
  assert.deepEqual(partialsFromText(partialsToText([{ freq: 523.25, amp: 1, tau: 1.2 }, { freq: 880, amp: 0.5, tau: 0 }])), [{ freq: 523.25, amp: 1, tau: 1.2 }, { freq: 880, amp: 0.5, tau: 0 }])
  assert.deepEqual(partialsFromText('x, -3, 100'), [{ freq: 100, amp: 1, tau: 0 }])
  assert.deepEqual(partialsFromText('x, -3, 0'), [])
  // gaussian peak, dc, quantiser
  const gp = generate(g([c('gaussian', { amp: 2, center: 0.5, width: 0.01 })]))
  near(Math.max(...gp), 2, 1e-4); near(gp.indexOf(Math.max(...gp)), 4096, 0, 1)
  near(mean(generate(g([c('dc', { amp: 0.3 })]))), 0.3, 1e-12)
  const q = generate(g([c('sine', { freq: 100, amp: 0.9 })], { bits: 3 }))
  assert.ok(new Set(Array.from(q)).size <= 8)
})

test('seeded noise: statistics, repeatability, pink slope', () => {
  const r = rng(42)
  const a = [r(), r(), r()]
  const r2 = rng(42)
  assert.deepEqual(a, [r2(), r2(), r2()])
  assert.ok(a.every((v) => v >= 0 && v < 1))
  const g = gaussian(rng(3))
  const v = Float64Array.from({ length: 100000 }, () => g())
  near(mean(v), 0, 0, 0.02); near(stdDev(v), 1, 0.01)
  const w = noise(1000, 0.3, 1)
  near(stdDev(w), 0.3, 0.06)
  const pink = noise(200000, 1, 4, 'pink')
  near(stdDev(pink), 1, 1e-4)
  const p = welch(pink, 1000, { nperseg: 2048 })
  // 1/f power: -3 dB per octave
  const band = (f0: number, f1: number) => { let s = 0; let n = 0; for (let k = 0; k < p.freq.length; k++) if (p.freq[k] >= f0 && p.freq[k] < f1) { s += p.psd[k]; n++ } return s / n }
  const slope = 10 * Math.log10(band(160, 320) / band(10, 20)) / 4 // four octaves apart
  assert.ok(Math.abs(slope + 3) < 0.6, `pink slope ${slope} dB per octave`)
})

test('generator specs are normalised and limited', () => {
  assert.equal(normalizeComponent({ type: 'nope' }), null)
  assert.equal(normalizeComponent(null), null)
  const c = normalizeComponent({ type: 'sine', freq: 'x', amp: 3, evil: 1 })!
  assert.equal(c.freq, 440); assert.equal(c.amp, 3)
  assert.ok(!('evil' in c))
  for (const t of COMPONENT_TYPES) assert.equal(defaultComponent(t).type, t)
  const g = normalizeGenerator({ fs: 4000, duration: 'x', components: [{ type: 'sine' }, 5, { type: 'zzz' }], noise: { sigma: -1, color: 'pink' }, bits: 99 })
  assert.equal(g.components.length, 1)
  assert.equal(g.duration, 1); assert.equal(g.noise.sigma, 0); assert.equal(g.noise.color, 'pink'); assert.equal(g.bits, 24)
  assert.match(sourceProblems({ ...g, fs: 192000, duration: 100 })[0], /limit/)
  assert.match(sourceProblems({ ...g, duration: 0 })[0], /duration/)
  assert.match(sourceProblems({ ...g, fs: 0 })[0], /sample rate/)
  assert.throws(() => generate({ ...g, fs: 192000, duration: 100 }), /limit/)
  assert.equal(MAX_SAMPLES, 2097152)
  assert.equal(generate({ ...g, components: [] }).every((v) => v === 0), true)
  // the ECG: R peaks where ecgBeatTimes says
  const ecg = generate({ ...g, fs: 500, duration: 5, components: [{ ...defaultComponent('ecg'), bpm: 60, amp: 1 }] })
  const times = ecgBeatTimes(60, 5, 0, 1).filter((t) => t < 5)
  const found = findTimePeaks(ecg, 500, 0.5, 0.3)
  assert.equal(found.length, times.length)
  found.forEach((p, i) => near(p.time, times[i], 0, 0.004))
})

// ============================================================================================ files

test('WAV: every format round-trips; stereo; extensible headers; errors', () => {
  const x = Float64Array.from({ length: 500 }, (_, i) => 0.8 * Math.sin(i * 0.1))
  const tol: Record<WavFormat, number> = { pcm8: 1 / 250, pcm16: 1.6e-5, pcm24: 1e-7, pcm32: 1e-9, float32: 1e-7 }
  for (const f of Object.keys(tol) as WavFormat[]) {
    const bytes = writeWav([x], 22050, f)
    assert.ok(looksLikeWav(bytes))
    const w = readWav(bytes)
    assert.equal(w.fs, 22050); assert.equal(w.channels.length, 1); assert.equal(w.channels[0].length, 500)
    assert.ok(maxAbs(w.channels[0], x) <= tol[f], `${f}: ${maxAbs(w.channels[0], x)}`)
    assert.equal(w.float, f === 'float32')
  }
  const st = readWav(writeWav([x, x.map((v) => -v)], 8000, 'pcm16'))
  assert.equal(st.channels.length, 2)
  assert.ok(maxAbs(mixToMono(st.channels), new Float64Array(500)) < 1e-4)
  assert.equal(mixToMono([x]), x)
  // clipping instead of wrapping
  assert.ok(readWav(writeWav([[2, -2]], 8000, 'pcm16')).channels[0][0] > 0.99)
  // WAVE_FORMAT_EXTENSIBLE with a float sub-format
  const base = writeWav([[0.5, -0.25]], 8000, 'float32')
  const ext = new Uint8Array(base.length + 24)
  ext.set(base.subarray(0, 36), 0)
  const v = new DataView(ext.buffer)
  v.setUint32(16, 40, true); v.setUint16(20, 0xfffe, true); v.setUint16(36, 22, true); v.setUint16(38, 32, true); v.setUint16(44, 3, true)
  ext.set(base.subarray(36), 60)
  const e = readWav(ext)
  assert.deepEqual(Array.from(e.channels[0]), [0.5, -0.25])
  // odd-sized chunks before the data are skipped
  assert.throws(() => readWav(new Uint8Array([1, 2, 3])), /not a WAV/)
  assert.throws(() => readWav(Uint8Array.from('RIFF\0\0\0\0WAVE'.split('').map((c) => c.charCodeAt(0)))), /fmt/)
  const adpcm = writeWav([x], 8000, 'pcm16')
  new DataView(adpcm.buffer).setUint16(20, 2, true)
  assert.throws(() => readWav(adpcm), /compressed/)
  const truncated = writeWav([x], 8000, 'pcm16').subarray(0, 44 + 100)
  assert.equal(readWav(truncated).channels[0].length, 50)
})

test('CSV: time + value, value only, header, delimiters, uneven time stamps, errors', () => {
  const a = parseCsv('time,value\n0,1\n0.001,2\n0.002,3\n0.003,2\n')
  assert.deepEqual(Array.from(a.samples), [1, 2, 3, 2])
  near(a.fs, 1000, 1e-9); assert.ok(a.fsFromData && a.hasTime); assert.deepEqual(a.header, ['time', 'value'])
  const b = parseCsv('1\n2\n3\n', { fs: 250 })
  assert.equal(b.fs, 250); assert.ok(!b.hasTime); assert.equal(b.warnings.length, 0)
  assert.match(parseCsv('1\n2\n3\n').warnings[0], /sample rate/)
  const c = parseCsv('t;a;b\n0;1;10\n1;2;20\n2;3;30', { column: 1 })
  assert.deepEqual(Array.from(c.samples), [10, 20, 30]); near(c.fs, 1, 1e-9); assert.equal(c.columns, 2)
  const d = parseCsv('# comment\n0\t5\n0.5\t6\n1.0\t7\n')
  assert.deepEqual(Array.from(d.samples), [5, 6, 7]); near(d.fs, 2, 1e-9)
  const e = parseCsv('0,1\n1,2\n2,x\n3,4\n')
  assert.equal(e.samples.length, 3); assert.match(e.warnings[0], /skipped/)
  const f = parseCsv('0,0\n1,1\n2,4\n4,8\n5,10\n')
  assert.match(f.warnings.join(' '), /evenly/)
  assert.equal(f.samples.length, 6)
  near(f.samples[3], 6, 1e-9) // t = 3 is between (2,4) and (4,8)
  assert.deepEqual(Array.from(parseCsv('1,5\n2,6\n', { fs: 10 }).samples), [5, 6])
  assert.deepEqual(Array.from(parseCsv('1,5\n2,6\n3,7').samples), [5, 6, 7])
  assert.throws(() => parseCsv(''), /empty/)
  assert.throws(() => parseCsv('a,b\n'), /no numbers/)
  assert.throws(() => parseCsv('1\n'), /fewer than two/)
  const text = toCsv([{ name: 'original', x: [1, 2, 3] }, { name: 'processed', x: [4, 5] }], 100)
  assert.equal(text, 'time_s,original,processed\n0,1,4\n0.01,2,5\n0.02,3,\n')
})

test('.ksig: generator specs stay specs; imported signals are embedded or referenced; garbage is repaired', () => {
  const ex = exampleProject(exampleById('aliasing')!)
  const text = serializeKsig(ex)
  const back = parseKsig(text)
  assert.deepEqual(back.project, ex)
  assert.equal(back.samples, null)
  assert.ok(!text.includes('"data"'), 'no samples in a generator file')
  assert.ok(text.length < 4000)
  // an imported signal
  const x = sine(300, 50, 1000, 0.5)
  const imp = { ...newProject(), name: 'rec', source: { kind: 'data' as const, name: 'rec.wav', fs: 1000, count: 300, origin: 'wav' as const, path: '/home/user/rec.wav' } }
  const emb = parseKsig(serializeKsig(imp, x))
  assert.equal(emb.samples!.length, 300)
  assert.ok(maxAbs(emb.samples!, x) < 1e-6, 'float32 precision')
  assert.equal(emb.project.source.kind, 'data')
  // long: reference by path only
  const ref = JSON.parse(serializeKsig(imp, x, { embedLimit: 100 })) as { source: Record<string, unknown> }
  assert.equal(ref.source.data, undefined); assert.equal(ref.source.path, '/home/user/rec.wav')
  // without a path it is embedded whatever its size
  const nopath = { ...imp, source: { ...imp.source, path: undefined } }
  assert.ok(JSON.parse(serializeKsig(nopath, x, { embedLimit: 100 })).source.data)
  assert.deepEqual(Array.from(decodeFloat32(encodeFloat32([1.5, -2.25, 0]))), [1.5, -2.25, 0])
  // errors and repairs
  assert.throws(() => parseKsig('{nope'), /valid JSON/)
  assert.throws(() => parseKsig('{"format":"kelec"}'), /ksig/)
  assert.throws(() => parseKsig('{"format":"ksig","version":9}'), /newer/)
  const junk = parseKsig('{"format":"ksig","source":{"kind":"generator","fs":"x","components":[{"type":"zzz"}]},"analysis":{"window":"bad","fftSize":-5,"overlap":7,"compare":["hann","nope"]},"filter":{"family":"??","f1":"a"},"process":{"type":"smooth","width":-3},"tab":"nope"}')
  assert.equal(junk.project.analysis.window, 'hann'); assert.equal(junk.project.analysis.fftSize, 0); assert.equal(junk.project.analysis.overlap, 0.95)
  assert.deepEqual(junk.project.analysis.compare, ['hann'])
  assert.equal(junk.project.filter.family, 'butter'); assert.equal(junk.project.tab, 'time')
  assert.equal(junk.project.process.type === 'smooth' && junk.project.process.width, 1)
  assert.equal(parseKsig('{"format":"ksig","source":{"kind":"data"}}').warnings.length, 1)
  assert.deepEqual(normalizeProcess(undefined), { type: 'none' })
  assert.equal(normalizeAnalysis(null).window, DEFAULT_ANALYSIS.window)
})

// ============================================================================================ analysis

test('analysis helpers: sizes, processing, summaries', () => {
  assert.equal(floorPow2(1000), 512)
  assert.equal(resolveFftSize({ ...DEFAULT_ANALYSIS }, 100000), 65536)
  assert.equal(resolveFftSize({ ...DEFAULT_ANALYSIS, fftSize: 2048 }, 100000), 2048)
  const e = exampleProject(exampleById('two-tones')!)
  const r = runProject(e)
  assert.equal(r.processed, null)
  const t = r.original
  assert.equal(t.x.length, 8192)
  assert.throws(() => runProject({ ...e, source: { kind: 'data', name: 'x', fs: 10, count: 5, origin: 'wav' } }), /import/)
  const half = traceSpectrum(t, { ...e.analysis, fftSize: 1024 })
  assert.equal(half.nfft, 1024); near(half.df, 8, 1e-12)
  const tw = traceWelch(t, { ...e.analysis, fftSize: 0 })
  assert.equal(tw.nperseg, 1024)
  assert.throws(() => processTrace(t, { type: 'filter' }, null), /no filter/)
  const dec = processTrace(t, { type: 'decimate', factor: 4 }, null)
  assert.equal(dec.fs, 2048); assert.equal(dec.x.length, 2048)
  const sm = summarizeTrace('x', t, e.analysis)
  assert.equal(sm.peaks.length, 2)
  assert.equal(compactSummary(sm).sampleRate, 8192)
})

// ============================================================================================ the examples

const ex = (id: string) => {
  const e = exampleById(id)
  assert.ok(e, `example ${id}`)
  return { e: e!, p: exampleProject(e!), r: runProject(exampleProject(e!)) }
}
const peak = (list: ReturnType<typeof spectrumPeaks>, f: number, tol = 1.5) => list.find((p) => Math.abs(p.freq - f) <= tol)

test('there are at least 12 examples; each file loads and regenerates identically', () => {
  assert.ok(EXAMPLES.length >= 12)
  assert.equal(new Set(EXAMPLES.map((e) => e.id)).size, EXAMPLES.length)
  const files = ksignalExampleFiles()
  assert.equal(files.length, EXAMPLES.length)
  assert.equal(new Set(files.map((f) => f.file)).size, files.length)
  assert.equal(KSIGNAL_EXAMPLES_FOLDER, 'kSignal Examples')
  const groups = new Set<string>()
  for (const [i, f] of files.entries()) {
    assert.match(f.file, /^\d\d [\x20-\x7e]+\.ksig$/)
    assert.equal(f.file, exampleFileName(i + 1, EXAMPLES[i].title, 'ksig'))
    assert.ok(f.description!.length > 80, `${f.title} has a real description`)
    groups.add(f.group!)
    const parsed = parseKsig(f.content)
    assert.equal(parsed.project.name, EXAMPLES[i].title)
    assert.equal(parsed.project.synthetic, true)
    assert.match(parsed.project.description ?? '', /ynthetic/, `${f.title} is labelled synthetic`)
    assert.equal(serializeKsig(parsed.project), f.content, 'round trip')
    // the loader produces samples, and the analysis runs
    const run = runProject(parsed.project)
    assert.ok(run.original.x.length > 100 && run.original.x.every(Number.isFinite), f.title)
    assert.deepEqual(run.original.x, generate(EXAMPLES[i].project.source as GeneratorSource), 'deterministic')
    assert.ok(analyzeProject(parsed.project).peaks.length >= 0)
    assert.equal(run.filterError, null, f.title)
    if (parsed.project.process.type !== 'none') assert.ok(run.processed && run.processed.x.length > 0)
  }
  assert.ok(groups.size >= 5)
  // the sizes stay small: the files hold specs, not samples
  for (const f of files) assert.ok(f.content.length < 6000, `${f.file}: ${f.content.length} bytes`)
})

test('the committed example files are what the generator writes', () => {
  const root = new URL('../../', import.meta.url)
  for (const o of ksignalOutputs()) {
    const url = new URL(o.path, root)
    assert.ok(existsSync(url), `${o.path} exists (run: node tools/export_ksignal_examples.ts)`)
    assert.equal(readFileSync(url, 'utf8'), o.content, `${o.path} is up to date`)
  }
  const index = readExampleIndex(JSON.parse(ksignalOutputs().find((o) => o.path.endsWith('index.json'))!.content))
  assert.equal(index.length, EXAMPLES.length)
  assert.ok(index.every((e) => e.group && e.title && e.file.endsWith('.ksig')))
})

test('example: two tones with leakage and windows compared', () => {
  const { p, r } = ex('two-tones')
  const flat = spectrumPeaks(traceSpectrum(r.original, p.analysis))
  near(peak(flat, 1000, 0.01)!.amp, 1, 1e-3)
  near(peak(flat, 1234.5, 0.01)!.amp, 0.5, 1e-3)
  const raw = (w: WindowName) => ampSpectrum(r.original.x, 8192, { window: w })
  near(toDb(raw('rectangular').amp[1235] / 0.5), -3.92, 0.01) // half a bin off: the highest of the two bins
  near(toDb(raw('hann').amp[1235] / 0.5), -1.42, 0.01)
  assert.ok(Math.abs(toDb(raw('flattop').amp[1235] / 0.5)) < 0.01)
  near(raw('rectangular').amp[1000], 1, 1e-5)
  assert.deepEqual(p.analysis.compare, ['rectangular', 'hann'])
})

test('example: spectral leakage versus window', () => {
  const { r } = ex('leakage-windows')
  const x = r.original.x
  // the tone is at 100.5 Hz, close to DC: its mirror image changes the bin heights by about 0.2 %
  near(ampSpectrum(x, 8192, { window: 'rectangular' }).amp[100], 0.6366, 5e-3)
  near(ampSpectrum(x, 8192, { window: 'hann' }).amp[100], 0.8488, 5e-3)
  assert.ok(ampSpectrum(x, 8192, { window: 'flattop' }).amp[100] > 0.995)
  near(spectrumPeaks(ampSpectrum(x, 8192, { window: 'hann' }))[0].amp, 1, 0.01)
  // leakage far from the tone: Blackman-Harris is far below rectangular
  const at = (w: WindowName, k: number) => ampSpectrum(x, 8192, { window: w }).amp[k]
  assert.ok(at('rectangular', 150) > 100 * at('hann', 150) && at('rectangular', 150) > 100 * at('blackmanharris', 150), 'far skirts')
  assert.ok(at('rectangular', 110) > 10 * at('hann', 110) && at('hann', 110) > 10 * at('blackmanharris', 110), 'near skirts')
})

test('example: square wave odd harmonics', () => {
  const { p, r } = ex('square-harmonics')
  const pk = spectrumPeaks(traceSpectrum(r.original, p.analysis), { rangeDb: 30 })
  ;[1, 3, 5, 7].forEach((k) => near(peak(pk, 100 * k, 0.5)!.amp, 4 / (Math.PI * k), 0.01))
  assert.equal(peak(pk, 200, 0.5), undefined, 'no even harmonics')
  const tone = toneMetrics(traceSpectrum(r.original, p.analysis))!
  near(tone.fundamental, 100, 1e-3)
  near(tone.thdPercent, 48.3, 0.2, 1) // sqrt(pi^2/8 - 1) = 48.3 %, here with the harmonics up to the 5th: ~ 42 %
})

test('example: chirp spectrogram', () => {
  const { p, r } = ex('chirp')
  const st = stft(r.original.x, 8000, { nperseg: p.analysis.stftSize, overlap: p.analysis.overlap, window: p.analysis.window })
  const mid = Math.floor(st.frames.length / 2)
  let best = 0
  for (let k = 0; k < st.frames[mid].length; k++) if (st.frames[mid][k] > st.frames[mid][best]) best = k
  near(st.freq[best], 100 + 1450 * st.time[mid], 0.02)
  assert.equal(p.tab, 'spectrogram')
})

test('example: guitar string harmonic series', () => {
  const { p, r } = ex('guitar-string')
  const pk = spectrumPeaks(traceSpectrum(r.original, p.analysis), { rangeDb: 70, maxPeaks: 12 })
  for (let k = 1; k <= 8; k++) assert.ok(peak(pk, 110 * k, 0.6), `harmonic ${k}`)
  assert.ok(peak(pk, 110, 0.6)!.amp > peak(pk, 220, 0.6)!.amp && peak(pk, 220, 0.6)!.amp > peak(pk, 330, 0.6)!.amp)
  near(toneMetrics(traceSpectrum(r.original, p.analysis), { fundamental: 110 })!.fundamental, 110, 1e-3)
  near(estimatePeriod(r.original.x.subarray(0, 4000), r.original.fs, 50, 1000), 1 / 110, 0.01)
})

test('example: audio chime', () => {
  const { p, r } = ex('chime')
  assert.equal(r.original.fs, 44100)
  const pk = spectrumPeaks(traceSpectrum(r.original, p.analysis), { rangeDb: 50 })
  for (const f of [880, 1760, 2428.8, 4752]) assert.ok(peak(pk, f, 1.5), `partial ${f}`)
  assert.ok(signalStats(r.original.x).peak <= 1, 'does not clip when played')
  assert.ok(rms(r.original.x.subarray(0, 4410)) > 5 * rms(r.original.x.subarray(88200)), 'it rings out')
})

test('example: AM and FM spectra', () => {
  const am = ex('am')
  const a = spectrumPeaks(traceSpectrum(am.r.original, am.p.analysis), { rangeDb: 40 })
  near(peak(a, 1000, 0.1)!.amp, 1, 2e-3); near(peak(a, 900, 0.1)!.amp, 0.25, 5e-3); near(peak(a, 1100, 0.1)!.amp, 0.25, 5e-3)
  const fm = ex('fm')
  const f = spectrumPeaks(traceSpectrum(fm.r.original, fm.p.analysis), { rangeDb: 40, maxPeaks: 12 })
  ;[0.22389, 0.57672, 0.35283, 0.12894, 0.034].forEach((v, n) => { near(peak(f, 2000 + 200 * n, 0.1)!.amp, v, 0.02, 1e-3); near(peak(f, 2000 - 200 * n, 0.1)!.amp, v, 0.02, 1e-3) })
})

test('example: aliasing', () => {
  const { p, r } = ex('aliasing')
  const pk = spectrumPeaks(traceSpectrum(r.original, p.analysis))
  assert.equal(pk.length, 1)
  near(pk[0].freq, 1000, 1e-6); near(pk[0].amp, 1, 1e-3)
  // at 32 kHz the same tone is where it really is
  const g = p.source as GeneratorSource
  const fast = generate({ ...g, fs: 32000 })
  near(spectrumPeaks(ampSpectrum(fast, 32000, { window: 'hann' }), { maxPeaks: 1 })[0].freq, 9000, 1e-6)
})

test('example: ADC quantisation noise', () => {
  const { p, r } = ex('adc-quantisation')
  const m = toneMetrics(traceSpectrum(r.original, p.analysis), { fundamental: 1031 })!
  // 99 % of full scale: 61.96 + 20 log10(0.99) = 61.87 dB
  near(m.snrDb, 61.87, 0.005, 1.0)
  near(m.enob, 10, 0.02, 0.1)
  const clean = generate({ ...(p.source as GeneratorSource), bits: 0 })
  near(snrAgainst(clean, r.original.x), 61.87, 0.01, 0.5)
  // 12 bits is 12.04 dB better
  const g12 = generate({ ...(p.source as GeneratorSource), bits: 12 })
  near(snrAgainst(clean, g12) - snrAgainst(clean, r.original.x), 12.04, 0.05, 0.8)
})

test('example: noisy sine and a Butterworth low-pass', () => {
  const { p, r } = ex('butterworth-noisy-sine')
  const clean = sine(r.original.x.length, 50, 2000)
  const before = snrAgainst(clean, r.original.x)
  const after = snrAgainst(clean, r.processed!.x)
  near(before, 3.0, 0, 0.5)
  assert.ok(after > before + 8, `SNR ${before.toFixed(1)} -> ${after.toFixed(1)} dB`)
  const d = r.filter!
  near(gainDbAt(d, 100), -3.01 * 2, 1e-3, 0.02) // zero phase: twice the dB
  assert.equal(p.process.type, 'filter')
  const pk = spectrumPeaks(traceSpectrum(r.processed!, p.analysis))
  near(pk[0].freq, 50, 1e-3); near(pk[0].amp, 1, 0.02)
  // one pass only: the delay of a single filter
  const single = applyFilter(d, r.original.x, false)
  assert.ok(snrAgainst(clean, single) < after - 5, 'the single pass is delayed')
  near(gainDbAt({ ...d, spec: { ...d.spec, zeroPhase: false } }, 100), -3.0103, 1e-4)
})

test('example: 50 Hz mains hum on an ECG', () => {
  const { p, r } = ex('ecg-notch')
  const before = spectrumPeaks(traceSpectrum(r.original, p.analysis))
  const hum = peak(before, 50, 0.3)!
  near(hum.amp, 0.3, 0.01)
  const after = traceSpectrum(r.processed!, p.analysis)
  const humAfter = Math.max(...Array.from(after.amp.subarray(495, 505)))
  assert.ok(20 * Math.log10(hum.amp / humAfter) > 40, `hum reduced by ${(20 * Math.log10(hum.amp / humAfter)).toFixed(1)} dB`)
  // the QRS survives: the R peaks keep their height within 5 %
  const r1 = Math.max(...Array.from(r.original.x))
  const r2 = Math.max(...Array.from(r.processed!.x))
  assert.ok(Math.abs(r2 / r1) > 0.8 && r2 / r1 < 1.2)
  assert.equal(p.filter.family, 'notch'); assert.equal(p.filter.zeroPhase, true)
})

test('example: FIR versus IIR', () => {
  const { p } = ex('fir-vs-iir')
  const fir = designFilter(p.filter, 8000)
  const iir = designFilter(p.compare!, 8000)
  near(filterMetrics(fir).groupDelayPass, 25, 1e-9)
  near(filterMetrics(fir).groupDelaySpread, 0, 0, 1e-9)
  assert.ok(filterMetrics(iir).groupDelaySpread > 1.5)
  near(25 / 8000, 0.003125, 1e-12)
  assert.equal(fir.b.length, 51); assert.equal(iir.poles.length, 4)
  near(gainDbAt(iir, 1000), -3.0103, 1e-4)
  assert.ok(gainDbAt(fir, 1000) < -5.5 && gainDbAt(fir, 1000) > -6.5, 'Hamming FIR is about 6 dB down at the cutoff')
  assert.equal(p.tab, 'filter')
})

test('example: Savitzky-Golay versus moving average', () => {
  const { p, r } = ex('savgol-vs-ma')
  assert.deepEqual(p.process, { type: 'smooth', method: 'sg', width: 21, order: 3 })
  const peakOf = (x: ArrayLike<number>) => Math.max(...Array.from(x))
  assert.ok(peakOf(r.processed!.x) > 0.93)
  assert.ok(peakOf(processTrace(r.original, { type: 'smooth', method: 'ma', width: 21, order: 0 }, null).x) < 0.82)
  assert.ok(peakOf(processTrace(r.original, { type: 'smooth', method: 'median', width: 21, order: 0 }, null).x) < 0.95)
})

test('example: heart rate from R peaks', () => {
  const { p, r } = ex('heart-rate')
  const a = analyzeProject(p)
  assert.equal(a.timePeaks!.count, 18)
  const hr = a.timePeaks!.heartRate!
  near(hr.bpm, 72, 0.02)
  assert.ok(hr.sdnn > 0.005 && hr.sdnn < 0.06)
  const truth = ecgBeatTimes(72, 15, 0.03, 4).filter((t) => t < 15)
  assert.equal(truth.length, 18)
  a.timePeaks!.peaks.forEach((q, i) => near(q.time, truth[i], 0, 0.01))
  assert.equal(r.original.fs, 250)
})

test('example: white noise power spectral density', () => {
  const { p, r } = ex('white-noise-psd')
  const w = traceWelch(r.original, p.analysis)
  let s = 0
  let n = 0
  for (let k = 0; k < w.freq.length; k++) if (w.freq[k] > 1500) { s += w.psd[k]; n++ }
  near(10 * Math.log10(s / n), -57, 0, 0.3)
  near(s / n, 2e-6, 0.03)
  const top = Math.max(...Array.from(w.psd))
  const line = 10 * Math.log10(top / (s / n))
  assert.ok(line > 33 && line < 38, `the sine stands ${line.toFixed(1)} dB above the floor`)
  assert.ok(w.segments > 150)
  assert.equal(p.analysis.mode, 'welch')
})

// ============================================================================================ python bridge

test('scipy bridge: the code is built from a validated spec, the answer is parsed strictly', () => {
  const spec = normalizeFilterSpec({ family: 'butter', type: 'lowpass', order: 5, f1: 1000, rp: 1, rs: 60 })
  const code = pythonDesignCode({ method: 'ellip', spec, fs: 8000, transition: 300 })
  assert.match(code, /signal\.ellip/)
  assert.match(code, /KSIG_RESULT/)
  assert.match(code, /json\.loads\("/)
  // an injected window name is replaced, not pasted
  const evil = pythonDesignCode({ method: 'check', spec: { ...spec, family: 'fir', window: 'hann"); import os #' as never }, fs: 8000, transition: 300 })
  assert.ok(!evil.includes('import os'))
  assert.match(pythonDesignCode({ method: 'remez', spec: { ...spec, order: 61 }, fs: 8000, transition: 300 }), /signal\.remez/)
  assert.match(pythonDesignCode({ method: 'bessel', spec, fs: 8000, transition: 300 }), /signal\.bessel/)
  assert.throws(() => pythonDesignCode({ method: 'remez', spec: { ...spec, order: 3 }, fs: 8000, transition: 300 }), /taps/)
  assert.throws(() => pythonDesignCode({ method: 'remez', spec: { ...spec, f1: 3900 }, fs: 8000, transition: 300 }), /transition bands/)
  assert.throws(() => pythonDesignCode({ method: 'ellip', spec: { ...spec, rs: 0.5 }, fs: 8000, transition: 300 }), /Elliptic/)
  assert.throws(() => pythonDesignCode({ method: 'ellip', spec: { ...spec, f1: 5000 }, fs: 8000, transition: 300 }), /cutoff/)
  assert.deepEqual(remezBands({ ...spec, type: 'bandpass', f1: 1000, f2: 2000 }, 8000, 200), { bands: [0, 800, 1000, 2000, 2200, 4000], desired: [0, 1, 0] })
  assert.deepEqual(remezBands({ ...spec, type: 'bandstop', f1: 1000, f2: 2000 }, 8000, 200).desired, [1, 0, 1])
  assert.throws(() => remezBands(spec, 8000, 0), /transition/)
  assert.throws(() => parsePythonOutput('no result here'), /did not return/)
  assert.throws(() => parsePythonOutput('KSIG_RESULT {broken'), /unreadable/)
  assert.throws(() => parsePythonOutput('KSIG_RESULT {"freqs":[1],"mag_db":[0]}'), /incomplete/)
  const ok = parsePythonOutput('x\nKSIG_RESULT {"scipy":"1.13","method":"remez","b":[0.5,0.5],"a":[1],"freqs":[0,1],"mag_db":[0,-3]}')
  assert.deepEqual(ok.b, [0.5, 0.5]); assert.equal(ok.scipy, '1.13')
  // a pure design differs from a deliberately different one by more than rounding
  const r = parsePythonOutput('KSIG_RESULT ' + JSON.stringify(fixture.requests[3].output))
  assert.ok(crossCheck({ ...fixture.requests[3].request.spec, order: 5 }, 8000, r).maxDiffDb > 0.5)
})

// ============================================================================================ report, figures, formatting

test('report and figures', () => {
  const { p, r } = ex('two-tones')
  const a = analyzeProject(p)
  const md = buildReport(p, a, new Date('2026-01-02T03:04:05Z'))
  assert.match(md, /^# kSignal report: Two tones/)
  assert.match(md, /synthetic/)
  assert.match(md, /\| 1 \| 1000 Hz \| 1 \|/)
  assert.match(md, /1234\.5 Hz/)
  assert.match(md, /2026-01-02/)
  assert.match(md, /Flat top/)
  const pal = DEFAULT_PALETTE
  const sp = traceSpectrum(r.original, p.analysis)
  const fig = spectrumFigure({ primary: sp, primaryName: 'original', compare: [{ window: 'hann', spectrum: traceSpectrum(r.original, p.analysis, 'hann') }], peaks: spectrumPeaks(sp), settings: p.analysis, cursors: { a: 1000, b: null } }, pal)
  assert.ok(fig.data.length >= 3)
  assert.equal(fig.data.filter((t) => t.yaxis === 'y2').length, 1, 'one cursor line, drawn on the overlay axis (works on log axes)')
  const yr = (fig.layout.yaxis as { range: number[] }).range
  assert.ok(yr[1] > 0 && yr[0] === -140)
  const tf = timeFigure({ x: r.original.x, fs: 8192, view: [0, 0.01], cursors: { a: null, b: null }, showOriginal: true, showProcessed: true }, pal)
  assert.ok((tf.data[0].x as number[]).length < 100)
  const design = designFilter(DEFAULT_FILTER, 8000)
  const lines = [{ design, name: 'a', color: '#fff' }]
  for (const f of [magnitudeFigure(lines, pal), phaseFigure(lines, pal), groupDelayFigure(lines, pal, true), poleZeroFigure(lines, pal), stepFigure(lines, pal), stepFigure(lines, pal, 'impulse')]) {
    assert.ok(f.data.length >= 1)
    JSON.stringify(f) // plain data
  }
  const w = welch(r.original.x, 8192, { nperseg: 1024 })
  assert.ok(psdFigure({ psd: w, settings: { ...p.analysis, scale: 'psd' }, cursors: { a: null, b: null }, name: 'psd' }, pal).data.length === 1)
  const st = stft(r.original.x, 8192, { nperseg: 256 })
  assert.equal(spectrogramFigure(st, p.analysis, pal).data[0].type, 'heatmap')
  assert.equal(forExport(fig, LIGHT_PALETTE).layout.paper_bgcolor, '#ffffff')
  assert.equal(fmtHz(1234.6), '1.235 kHz'); assert.equal(fmtHz(0.5), '0.5 Hz'); assert.equal(fmtTime(0.0031), '3.1 ms'); assert.equal(fmtNum(0), '0'); assert.equal(fmtNum(NaN), '–')
  assert.equal(median([3, 1, 2]), 2)
})

// ============================================================================================ AI tools

function fakeHooks(initial = exampleProject(exampleById('am')!), dirty = false) {
  const calls: string[] = []
  const state = { project: initial, samples: null as Float64Array | null, dirty }
  const hooks: Hooks = {
    state: () => state,
    setFilter: (spec, apply) => { calls.push(`filter ${spec.family} ${apply}`); state.project = { ...state.project, filter: spec, process: apply ? { type: 'filter' } : state.project.process } },
    openExample: async (e) => { calls.push(`example ${e.id}`); state.project = exampleProject(e) },
    showSignal: (_s, name) => { calls.push(`show ${name}`) },
  }
  return { calls, state, tools: ksignalTools(hooks) }
}
const ctxFor = (answer: boolean) => ({ caller: 'test', windowId: 'w1', confirm: async () => answer, allowPython: async () => true })
const run = async (tools: ReturnType<typeof ksignalTools>, name: string, args: Record<string, unknown> = {}, answer = true) => {
  const impl = tools[name]
  return (await (typeof impl === 'function' ? impl : impl.run)(args, ctxFor(answer))) as Record<string, any>
}

test('AI tools: the manifest is small and the tools do what they say', async () => {
  assert.ok(KSIGNAL_TOOL_SET.tools.length <= 4)
  assert.ok(KSIGNAL_TOOL_SET.summary.length <= 120)
  assert.ok(KSIGNAL_TOOL_SET.keywords.length >= 5)
  for (const t of KSIGNAL_TOOL_SET.tools) {
    assert.ok(Object.keys((t.inputSchema as { properties: object }).properties).length <= 6, `${t.action}: at most 6 arguments`)
    assert.ok(t.description.length > 20 && t.description.length < 300, `${t.action}: a short description`)
  }
  assert.deepEqual(KSIGNAL_TOOL_SET.tools.map((t) => t.action).sort(), ['analyze', 'design_filter', 'get_state', 'load_example'])
  const { tools, calls } = fakeHooks()
  assert.deepEqual(Object.keys(tools).sort(), KSIGNAL_TOOL_SET.tools.map((t) => t.action).sort(), 'every manifest action has code')
  // get_state
  const st = await run(tools, 'get_state')
  assert.equal(st.name, 'AM modulation spectrum')
  near(st.results.peaks[0].freqHz, 1000, 1e-6)
  assert.equal(st.unsavedChanges, false)
  // analyze a spec
  const an = await run(tools, 'analyze', { signal: { fs: 8000, duration: 1, components: [{ type: 'sine', freq: 1000, amp: 0.5 }, { type: 'sine', freq: 2000, amp: 0.05 }] }, window: 'flattop' })
  near(an.peaks[0].freqHz, 1000, 1e-6); near(an.peaks[0].amplitude, 0.5, 1e-3)
  near(an.toneMetrics.thdPercent, 10, 0.05)
  assert.equal(an.spectrum.window, 'flattop')
  assert.equal(calls.length, 0, 'analysing a spec changes nothing')
  assert.equal((await run(tools, 'analyze', { signal: { fs: 8000, duration: 1, components: [{ type: 'sine', freq: 1000 }] }, max_peaks: 1, fft_size: 4000 })).spectrum.fftLength, 4000)
  await assert.rejects(() => run(tools, 'analyze', { window: 'nope' }), /window/)
  await assert.rejects(() => run(tools, 'analyze', { signal: { fs: 1e9, duration: 1e9 } }), /limit|sample rate/)
  const loaded = await run(tools, 'analyze', {})
  near(loaded.peaks[1].freqHz, 900, 1e-3)
  // show asks first when there are unsaved changes
  const dirty = fakeHooks(exampleProject(exampleById('am')!), true)
  const denied = await run(dirty.tools, 'analyze', { signal: { fs: 8000, duration: 1, components: [{ type: 'sine', freq: 100 }] }, show: true }, false)
  assert.equal(denied.shown, false); assert.equal(dirty.calls.length, 0)
  const shown = await run(dirty.tools, 'analyze', { signal: { fs: 8000, duration: 1, components: [{ type: 'sine', freq: 100 }] }, show: true }, true)
  assert.equal(shown.shown, true); assert.deepEqual(dirty.calls, ['show AI signal'])
  // design_filter
  const df = await run(tools, 'design_filter', { spec: { family: 'butter', type: 'lowpass', order: 4, f1: 1000 }, fs: 8000, coefficients: true })
  near(df.cutoffs3dBHz[0], 1000, 1e-4); near(df.dcGainDb, 0, 0, 1e-6)
  assert.equal(df.sos.length, 2); assert.equal(df.sos[0].length, 6); assert.equal(df.stable, true)
  assert.equal(df.applied, undefined)
  const fir = await run(tools, 'design_filter', { spec: { family: 'fir', order: 51, f1: 1000, window: 'hamming' }, fs: 8000, coefficients: true })
  assert.equal(fir.b.length, 51); near(fir.groupDelaySamplesDc, 25, 1e-6)
  const ap = await run(tools, 'design_filter', { spec: { family: 'notch', f1: 50, q: 30 }, fs: 500, apply: true })
  assert.equal(ap.applied, true); assert.deepEqual(calls, ['filter notch true'])
  await assert.rejects(() => run(tools, 'design_filter', { spec: { family: 'butter', f1: 99999 }, fs: 8000 }), /Nyquist/)
  await assert.rejects(() => run(tools, 'design_filter', { spec: { family: 'scipy' } }), /scipy/)
  // load_example
  const list = await run(tools, 'load_example')
  assert.equal(list.examples.length, EXAMPLES.length)
  assert.ok(list.examples.every((e: { id: string }) => exampleById(e.id)))
  const one = await run(tools, 'load_example', { id: 'aliasing' })
  assert.equal(one.loaded, 'Aliasing: 9 kHz sampled at 8 kHz')
  near(one.peaks[0].freqHz, 1000, 1e-6)
  await assert.rejects(() => run(tools, 'load_example', { id: 'zzz' }), /No example/)
  const d2 = fakeHooks(exampleProject(exampleById('am')!), true)
  await assert.rejects(() => run(d2.tools, 'load_example', { id: 'chirp' }, false), /did not allow/)
  assert.equal(d2.calls.length, 0)
})

// ============================================================================================ small helpers

test('number parsing with engineering suffixes', () => {
  assert.equal(parseEng('1k'), 1000)
  assert.equal(parseEng('2.5 kHz'), 2500)
  assert.equal(parseEng('1,5'), 1.5)
  assert.equal(parseEng('250m'), 0.25)
  assert.equal(parseEng('1e3'), 1000)
  assert.equal(parseEng('-3 dB'), -3)
  assert.equal(parseEng('10u'), 1e-5)
  assert.equal(parseEng('4M'), 4e6)
  assert.ok(Number.isNaN(parseEng('')))
  assert.ok(Number.isNaN(parseEng('abc')))
  assert.ok(Number.isNaN(parseEng('1k2')))
})

test('cursor readouts', () => {
  const x = [0, 1, 2, 3, 4]
  assert.equal(valueAtTime(x, 1, 1.5), 1.5)
  assert.equal(valueAtTime(x, 1, 4), 4)
  assert.equal(valueAtTime(x, 1, 5), null)
  assert.equal(valueAtTime(x, 1, -1), null)
  const r = timeReadout({ original: x, fs: 1 }, { a: 1, b: 3 })
  assert.deepEqual(r.map((q) => q[0]), ['A', 'B', 'Δt', 'Δ value'])
  assert.match(r[2][1], /2 s \(0\.5 Hz\)/)
  assert.equal(r[3][1], '2')
  assert.equal(timeReadout({ original: x, fs: 1, processed: { x: [1, 1, 1, 1, 1], fs: 1 } }, { a: 2, b: null })[0][1], '2 s: 2 → 1')
  const s = ampSpectrum(sine(1024, 100, 1024, 0.5), 1024, { window: 'rectangular' })
  near(amplitudeAtFreq(s, 100)!, 0.5, 1e-9)
  near(amplitudeAtFreq(s, 100.5)!, 0.25, 1e-3)
  assert.equal(amplitudeAtFreq(s, 5000), null)
  const sr = spectrumReadout(s, { a: 100, b: 200 })
  assert.deepEqual(sr.map((q) => q[0]), ['A', 'B', 'Δf', 'f B / f A', 'Δ level'])
  assert.match(sr[0][1], /100 Hz: 0\.5 \(-6\.021 dB\)/)
  assert.deepEqual(spectrumReadout(s, { a: null, b: null }), [])
})
