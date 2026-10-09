// AI tools of kSignal: analyse a signal and design filters. At most 4 tools, ≤ 6 arguments each.
// The code is in src/apps/ksignal/aiTools.ts.

import type { AppToolSet, Schema } from '../appToolsCore.ts'
import { bool, int, num, object, oneOf, str } from './schema.ts'

const anyObject = (description: string): Schema => ({ type: 'object', description, additionalProperties: true })

export const KSIGNAL_TOOL_SET: AppToolSet = {
  app: 'ksignal',
  name: 'kSignal',
  summary: 'signal processing: FFT spectra, peaks, THD/SNR, spectrograms, filter design, audio.',
  keywords: ['ksignal', 'signal', 'signals', 'fft', 'spectrum', 'spectrogram', 'filter', 'audio', 'frequency', 'dsp', 'butterworth', 'fir', 'iir', 'thd', 'snr', 'sampling', 'aliasing', 'waveform', 'wav'],
  tools: [
    {
      action: 'get_state',
      description: 'The signal in kSignal and what it shows: sample rate, duration, processing, filter, spectrum peaks (frequency, amplitude, phase) and tone metrics (THD, SNR, SINAD, ENOB).',
      inputSchema: object({}),
      readOnly: true,
    },
    {
      action: 'analyze',
      description: 'Spectrum peaks and metrics of a signal. Give a synthetic signal {fs, duration, components:[{type:"sine",freq,amp}…], noise:{sigma}, bits} or leave it out to analyse the signal loaded in kSignal.',
      inputSchema: object({
        signal: anyObject('Generator: {"fs":8000,"duration":1,"components":[{"type":"sine","freq":1000,"amp":1}],"noise":{"sigma":0.1,"seed":1},"bits":0}. Types: sine square triangle saw chirp pulse am fm harmonics partials ecg gaussian dc.'),
        window: oneOf(['rectangular', 'hann', 'hamming', 'blackman', 'blackmanharris', 'flattop', 'kaiser'], 'Spectrum window (default hann).'),
        fft_size: int('FFT length (0 or leave out: the whole signal, at most 65536 samples).'),
        max_peaks: int('How many peaks to list (default 10).'),
        fundamental: num('Fundamental in Hz for THD/SNR (default: the strongest peak).'),
        show: bool('With a signal: also show it in kSignal (asks first if there are unsaved changes).'),
      }),
    },
    {
      action: 'design_filter',
      description: 'Design a digital filter and return its gain at DC and Nyquist, -3 dB frequencies, group delay and stability; optionally the coefficients, and apply it to the signal in kSignal.',
      inputSchema: object({
        spec: anyObject('{"family":"butter|cheby1|cheby2|fir|notch","type":"lowpass|highpass|bandpass|bandstop","order":4,"f1":1000,"f2":2000,"rp":1,"rs":40,"window":"hamming","q":30,"zeroPhase":false}. order = taps for fir; f1 = cutoff (lower edge, notch frequency); f2 = upper edge.'),
        fs: num('Sample rate in Hz (default: the signal in kSignal).'),
        coefficients: bool('Include the second-order sections (IIR) or taps (FIR).'),
        apply: bool('Put the filter in the Filter tab and apply it to the signal.'),
      }, ['spec']),
    },
    {
      action: 'load_example',
      description: 'Open one of the ~16 ready examples (two tones and leakage, window comparison, chirp spectrogram, AM/FM, aliasing, ADC quantisation noise, filters, ECG heart rate…). Without an id, lists them.',
      inputSchema: object({ id: str('The example id, e.g. "aliasing" or "ecg-notch". Leave out to list them.') }),
    },
  ],
}
