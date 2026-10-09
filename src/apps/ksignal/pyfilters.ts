// "Advanced (scipy)": the Python code kSignal runs in its Pyodide kernel for designs it cannot do itself (Remez
// equiripple FIR, elliptic, Bessel) and for the cross-check of its own designs, and the reading of the answer (pure).
// The code only ever contains a validated, normalised spec as JSON: nothing the user typed is pasted into Python.

import {
  frequencyGrid, frequencyResponse, normalizeFilterSpec, designFilter, type FilterDesign, type FilterSpec,
} from './filters.ts'

export type PyMethod = 'remez' | 'ellip' | 'bessel' | 'check'

export const PY_METHOD_LABELS: Record<PyMethod, string> = {
  remez: 'Remez (equiripple FIR)', ellip: 'Elliptic (Cauer)', bessel: 'Bessel (maximally flat delay)', check: 'Same design in scipy (cross-check)',
}

export interface PyRequest {
  method: PyMethod
  spec: FilterSpec
  fs: number
  /** Remez: width of the transition bands in Hz. */
  transition: number
}

/** The band edges and desired gains for scipy.signal.remez, validated. */
export function remezBands(spec: FilterSpec, fs: number, transition: number): { bands: number[]; desired: number[] } {
  const nyq = fs / 2
  const tw = transition
  const f1 = spec.f1
  const f2 = spec.f2
  if (!(tw > 0)) throw new Error('The transition width must be above 0 Hz.')
  let bands: number[]
  let desired: number[]
  switch (spec.type) {
    case 'lowpass': bands = [0, f1, f1 + tw, nyq]; desired = [1, 0]; break
    case 'highpass': bands = [0, f1 - tw, f1, nyq]; desired = [0, 1]; break
    case 'bandpass': bands = [0, f1 - tw, f1, f2, f2 + tw, nyq]; desired = [0, 1, 0]; break
    default: bands = [0, f1, f1 + tw, f2 - tw, f2, nyq]; desired = [1, 0, 1]
  }
  for (let i = 1; i < bands.length; i++) {
    if (!(bands[i] > bands[i - 1])) throw new Error('The transition bands do not fit between 0 Hz and the Nyquist frequency: use a narrower transition or other edges.')
  }
  return { bands, desired }
}

function validate(req: PyRequest): FilterSpec {
  const spec = normalizeFilterSpec(req.spec)
  if (!(req.fs > 0)) throw new Error('The sample rate must be above 0.')
  const nyq = req.fs / 2
  const band = spec.type === 'bandpass' || spec.type === 'bandstop'
  for (const f of band ? [spec.f1, spec.f2] : [spec.f1]) if (!(f > 0 && f < nyq)) throw new Error(`The cutoff ${f} Hz must be between 0 and ${nyq} Hz.`)
  if (band && !(spec.f1 < spec.f2)) throw new Error('The lower edge must be below the upper edge.')
  if (req.method === 'remez') {
    if (spec.order < 5 || spec.order > 2001) throw new Error('Remez needs 5 to 2001 taps.')
    remezBands(spec, req.fs, req.transition)
  } else if (req.method === 'ellip' || req.method === 'bessel') {
    if (spec.order < 1 || spec.order > 24) throw new Error('The order must be a whole number from 1 to 24.')
    if (req.method === 'ellip' && !(spec.rp > 0 && spec.rs > spec.rp)) throw new Error('Elliptic filters need a passband ripple above 0 dB and a stopband attenuation larger than it.')
  }
  return spec
}

/** The Python program for a request. It prints one line: KSIG_RESULT {json}. */
export function pythonDesignCode(req: PyRequest): string {
  const spec = validate(req)
  const payload = JSON.stringify({ method: req.method, spec, fs: req.fs, transition: req.transition })
  return `import json
import numpy as np
import scipy
from scipy import signal

P = json.loads(${JSON.stringify(payload)})
S = P["spec"]
fs = float(P["fs"])
band = S["type"] in ("bandpass", "bandstop")
edges = [S["f1"], S["f2"]] if band else S["f1"]
method = P["method"]
out = {"scipy": scipy.__version__, "method": method}

def tw_bands():
    tw = P["transition"]; nyq = fs / 2; f1 = S["f1"]; f2 = S["f2"]; t = S["type"]
    if t == "lowpass": return [0, f1, f1 + tw, nyq], [1, 0]
    if t == "highpass": return [0, f1 - tw, f1, nyq], [0, 1]
    if t == "bandpass": return [0, f1 - tw, f1, f2, f2 + tw, nyq], [0, 1, 0]
    return [0, f1, f1 + tw, f2 - tw, f2, nyq], [1, 0, 1]

sos = None; b = None; a = None
if method == "remez":
    taps = int(S["order"])
    if S["type"] in ("highpass", "bandstop") and taps % 2 == 0: taps += 1
    bands, desired = tw_bands()
    b = signal.remez(taps, bands, desired, fs=fs); a = np.array([1.0])
elif method == "ellip":
    sos = signal.ellip(int(S["order"]), S["rp"], S["rs"], edges, btype=S["type"], fs=fs, output="sos")
elif method == "bessel":
    sos = signal.bessel(int(S["order"]), edges, btype=S["type"], norm="phase", fs=fs, output="sos")
else:
    fam = S["family"]
    if fam == "butter": sos = signal.butter(int(S["order"]), edges, btype=S["type"], fs=fs, output="sos")
    elif fam == "cheby1": sos = signal.cheby1(int(S["order"]), S["rp"], edges, btype=S["type"], fs=fs, output="sos")
    elif fam == "cheby2": sos = signal.cheby2(int(S["order"]), S["rs"], edges, btype=S["type"], fs=fs, output="sos")
    elif fam == "notch":
        b, a = signal.iirnotch(S["f1"], S["q"], fs=fs)
    elif fam == "fir":
        taps = int(S["order"])
        if S["type"] in ("highpass", "bandstop") and taps % 2 == 0: taps += 1
        win = ("kaiser", S["beta"]) if S["window"] == "kaiser" else {"rectangular": "boxcar", "blackmanharris": "blackmanharris", "flattop": "flattop"}.get(S["window"], S["window"])
        b = signal.firwin(taps, edges, window=win, pass_zero=S["type"] in ("lowpass", "bandstop"), fs=fs); a = np.array([1.0])
    else:
        raise ValueError("Nothing to cross-check: this filter was made by scipy already.")

freqs = np.linspace(0, fs / 2, 401)
if sos is not None:
    _, h = signal.sosfreqz(sos, worN=freqs, fs=fs)
    out["sos"] = np.asarray(sos).tolist()
else:
    _, h = signal.freqz(b, a, worN=freqs, fs=fs)
    out["b"] = np.asarray(b).tolist(); out["a"] = np.asarray(a).tolist()
out["freqs"] = freqs.tolist()
out["mag_db"] = (20 * np.log10(np.maximum(np.abs(h), 1e-12))).tolist()
print("KSIG_RESULT " + json.dumps(out))
`
}

export interface PyResult {
  method: PyMethod
  scipy: string
  sos?: number[][]
  b?: number[]
  a?: number[]
  freqs: number[]
  magDb: number[]
}

/** Finds and reads the KSIG_RESULT line of the program's output. Throws a readable error when it is missing. */
export function parsePythonOutput(stdout: string): PyResult {
  const line = stdout.split('\n').find((l) => l.startsWith('KSIG_RESULT '))
  if (!line) throw new Error('scipy did not return a result.')
  let o: Record<string, unknown>
  try { o = JSON.parse(line.slice('KSIG_RESULT '.length)) as Record<string, unknown> } catch { throw new Error('scipy returned something unreadable.') }
  const nums = (v: unknown): number[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : undefined)
  const sos = Array.isArray(o.sos) && o.sos.every((s) => nums(s)?.length === 6) ? (o.sos as number[][]) : undefined
  const freqs = nums(o.freqs)
  const magDb = nums(o.mag_db)
  if (!freqs || !magDb || (!sos && !nums(o.b))) throw new Error('scipy returned an incomplete result.')
  return { method: o.method as PyMethod, scipy: String(o.scipy ?? ''), ...(sos ? { sos } : {}), ...(nums(o.b) ? { b: nums(o.b) } : {}), ...(nums(o.a) ? { a: nums(o.a) } : {}), freqs, magDb }
}

/** A filter spec holding scipy's coefficients (family "scipy"), keeping the user's band and cutoffs. */
export function specFromPython(base: FilterSpec, r: PyResult, label: string): FilterSpec {
  return normalizeFilterSpec({ ...base, family: 'scipy', coeffs: { ...(r.sos ? { sos: r.sos } : {}), ...(r.b ? { b: r.b } : {}), ...(r.a ? { a: r.a } : {}), label } })
}

/** Largest difference in dB between scipy's magnitude and kSignal's own design with the same spec (where both are above −150 dB). */
export function crossCheck(spec: FilterSpec, fs: number, r: PyResult): { maxDiffDb: number; at: number; points: number } {
  const ours: FilterDesign = designFilter({ ...spec, coeffs: undefined }, fs)
  const mine = frequencyResponse(ours, r.freqs)
  let worst = 0
  let at = 0
  let points = 0
  for (let i = 0; i < r.freqs.length; i++) {
    if (r.magDb[i] < -150 && mine.magDb[i] < -150) continue
    points++
    const d = Math.abs(mine.magDb[i] - r.magDb[i])
    if (d > worst) { worst = d; at = r.freqs[i] }
  }
  return { maxDiffDb: worst, at, points }
}

export { frequencyGrid }
