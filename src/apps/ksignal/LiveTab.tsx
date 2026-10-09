// The Live tab: the microphone as a live oscilloscope and spectrum analyser with peak hold, drawn on canvases
// (fast, no Plotly). The spectrum is calibrated like the Spectrum tab (a sine of amplitude A reads A).

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, RotateCcw } from 'lucide-react'
import { startLive, type LiveInput } from './audio'
import { Check, SelectField } from './Fields'
import type { Palette } from './figures'
import { ampSpectrum, spectrumPeaks, toDb } from './spectrum'
import { fmtHz, fmtNum } from './stats'
import { WINDOW_LABELS, type WindowName } from './windows'

const SIZES = [2048, 4096, 8192, 16384, 32768]
const FMAX = [1000, 2000, 5000, 10000, 20000, 0]

interface Settings { size: number; window: WindowName; smoothing: number; hold: boolean; log: boolean; fmax: number; gain: number; dbMin: number }
const DEFAULTS: Settings = { size: 4096, window: 'hann', smoothing: 0.5, hold: true, log: true, fmax: 20000, gain: 1, dbMin: -110 }
const KEY = 'kherveos.ksignal.live'

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
    return { ...DEFAULTS, ...Object.fromEntries(Object.entries(raw).filter(([k, v]) => k in DEFAULTS && typeof v === typeof DEFAULTS[k as keyof Settings])) }
  } catch { return DEFAULTS }
}

function fit(c: HTMLCanvasElement): { w: number; h: number; ctx: CanvasRenderingContext2D } | null {
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(10, Math.floor(c.clientWidth))
  const h = Math.max(10, Math.floor(c.clientHeight))
  if (c.width !== Math.floor(w * dpr) || c.height !== Math.floor(h * dpr)) { c.width = Math.floor(w * dpr); c.height = Math.floor(h * dpr) }
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { w, h, ctx }
}

export default function LiveTab({ pal }: { pal: Palette }) {
  const [s, setS] = useState<Settings>(load)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [readout, setReadout] = useState('')
  const input = useRef<LiveInput | null>(null)
  const scope = useRef<HTMLCanvasElement>(null)
  const spec = useRef<HTMLCanvasElement>(null)
  const hold = useRef<Float64Array | null>(null)
  const avg = useRef<Float64Array | null>(null)
  const live = useRef({ s, pal })
  live.current = { s, pal }

  const set = (patch: Partial<Settings>) => setS((old) => { const n = { ...old, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)) } catch { /* storage blocked */ } return n })
  const stop = () => { input.current?.stop(); input.current = null; setRunning(false) }
  const start = async () => {
    setError(null)
    try {
      input.current = await startLive(live.current.s.size, 0)
      hold.current = null
      avg.current = null
      setRunning(true)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => () => { input.current?.stop(); input.current = null }, [])
  useEffect(() => { if (input.current) input.current.analyser.fftSize = s.size; hold.current = null; avg.current = null }, [s.size])

  useEffect(() => {
    if (!running) return
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 33) return
      last = now
      const inp = input.current
      if (!inp) return
      const { s: cfg, pal: colors } = live.current
      const N = cfg.size
      const buf = new Float32Array(N)
      inp.analyser.getFloatTimeDomainData(buf)
      // ---- oscilloscope: triggered on a rising zero crossing
      const sc = scope.current && fit(scope.current)
      if (sc) {
        const { ctx, w, h } = sc
        ctx.clearRect(0, 0, w, h)
        ctx.strokeStyle = colors.border
        ctx.fillStyle = colors.muted
        ctx.font = '10px sans-serif'
        ctx.lineWidth = 1
        for (let k = -1; k <= 1; k += 0.5) { const y = h / 2 - (k * h) / 2.2; ctx.globalAlpha = k === 0 ? 1 : 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
        ctx.globalAlpha = 1
        let t0 = 0
        for (let i = 1; i < N / 2; i++) if (buf[i - 1] < 0 && buf[i] >= 0) { t0 = i; break }
        const span = Math.min(N - t0, Math.max(256, Math.round(inp.fs * 0.02)))
        ctx.strokeStyle = colors.accent
        ctx.lineWidth = 1.5
        ctx.beginPath()
        for (let i = 0; i < span; i++) {
          const x = (i / (span - 1)) * w
          const y = h / 2 - Math.max(-1.2, Math.min(1.2, buf[t0 + i] * cfg.gain)) * (h / 2.2)
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.fillStyle = colors.muted
        ctx.fillText(`${((span / inp.fs) * 1000).toFixed(1)} ms`, w - 52, h - 4)
        ctx.fillText(`×${cfg.gain}`, 4, 12)
      }
      // ---- spectrum
      const sp = ampSpectrum(buf, inp.fs, { window: cfg.window })
      const bins = sp.amp.length
      const a = avg.current && avg.current.length === bins ? avg.current : (avg.current = Float64Array.from(sp.amp))
      const hd = hold.current && hold.current.length === bins ? hold.current : (hold.current = new Float64Array(bins))
      for (let k = 0; k < bins; k++) {
        a[k] = cfg.smoothing * a[k] + (1 - cfg.smoothing) * sp.amp[k]
        if (a[k] > hd[k]) hd[k] = a[k]
      }
      const fmax = cfg.fmax > 0 ? Math.min(cfg.fmax, inp.fs / 2) : inp.fs / 2
      const fmin = 20
      const pk = spectrumPeaks({ ...sp, amp: a }, { maxPeaks: 3, rangeDb: 40, fromBin: Math.ceil(fmin / sp.df) })
      const c2 = spec.current && fit(spec.current)
      if (c2) {
        const { ctx, w, h } = c2
        const left = 34
        const bottom = 16
        const pw = w - left - 6
        const ph = h - bottom - 4
        const xOf = (f: number) => left + (cfg.log ? (Math.log10(Math.max(f, fmin) / fmin) / Math.log10(fmax / fmin)) : (f / fmax)) * pw
        const yOf = (db: number) => 4 + (1 - (db - cfg.dbMin) / (0 - cfg.dbMin)) * ph
        ctx.clearRect(0, 0, w, h)
        ctx.font = '10px sans-serif'
        ctx.lineWidth = 1
        for (let db = 0; db >= cfg.dbMin; db -= 20) {
          ctx.strokeStyle = colors.border; ctx.globalAlpha = 0.6
          ctx.beginPath(); ctx.moveTo(left, yOf(db)); ctx.lineTo(left + pw, yOf(db)); ctx.stroke()
          ctx.globalAlpha = 1; ctx.fillStyle = colors.muted; ctx.fillText(String(db), 2, yOf(db) + 3)
        }
        const ticks = cfg.log ? [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000] : Array.from({ length: 9 }, (_, i) => ((i + 1) * fmax) / 9)
        for (const f of ticks) {
          if (f > fmax) continue
          const x = xOf(f)
          ctx.strokeStyle = colors.border; ctx.globalAlpha = 0.4
          ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, 4 + ph); ctx.stroke()
          ctx.globalAlpha = 1; ctx.fillStyle = colors.muted; ctx.fillText(f >= 1000 ? `${Number((f / 1000).toFixed(1))}k` : String(Math.round(f)), x - 8, h - 3)
        }
        const path = (data: Float64Array) => {
          ctx.beginPath()
          let started = false
          for (let k = Math.max(1, Math.floor(fmin / sp.df)); k < bins && k * sp.df <= fmax; k++) {
            const x = xOf(k * sp.df)
            const y = yOf(Math.max(cfg.dbMin - 10, toDb(data[k])))
            if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
          }
        }
        if (cfg.hold) { ctx.strokeStyle = colors.warning; ctx.globalAlpha = 0.8; ctx.lineWidth = 1; path(hd); ctx.stroke(); ctx.globalAlpha = 1 }
        ctx.strokeStyle = colors.accent; ctx.lineWidth = 1.5; path(a); ctx.stroke()
        ctx.fillStyle = colors.danger
        pk.forEach((p, i) => { if (p.freq <= fmax && p.freq >= fmin) { ctx.beginPath(); ctx.arc(xOf(p.freq), yOf(Math.max(cfg.dbMin, p.ampDb)), 3, 0, 2 * Math.PI); ctx.fill(); if (i === 0) ctx.fillText(fmtHz(p.freq), xOf(p.freq) + 5, yOf(p.ampDb) - 4) } })
      }
      let ms = 0
      for (let i = 0; i < N; i++) ms += buf[i] * buf[i]
      const rmsDb = 10 * Math.log10(Math.max(ms / N, 1e-20))
      setReadout(pk[0] ? `Peak ${fmtNum(pk[0].freq, 6)} Hz · ${fmtNum(pk[0].ampDb, 3)} dB (amplitude ${fmtNum(pk[0].amp, 3)}) · RMS ${fmtNum(rmsDb, 3)} dB` : `No tone above the noise · RMS ${fmtNum(rmsDb, 3)} dB`)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running])

  return (
    <div className="sg-live">
      <div className="sg-live-bar">
        {running ? (
          <button type="button" className="k-btn danger" onClick={stop}><MicOff size={14} /> Stop</button>
        ) : (
          <button type="button" className="k-btn primary" onClick={() => void start()}><Mic size={14} /> Start the microphone</button>
        )}
        <SelectField label="FFT" value={String(s.size)} onChange={(v) => set({ size: Number(v) })} options={SIZES.map((n) => ({ value: String(n), label: String(n) }))} />
        <SelectField label="Window" value={s.window} onChange={(window) => set({ window })} options={(['hann', 'hamming', 'blackman', 'blackmanharris', 'flattop', 'rectangular'] as WindowName[]).map((w) => ({ value: w, label: WINDOW_LABELS[w] }))} />
        <SelectField label="Smoothing" value={String(s.smoothing)} onChange={(v) => set({ smoothing: Number(v) })} options={[0, 0.3, 0.5, 0.7, 0.9].map((v) => ({ value: String(v), label: v === 0 ? 'none' : String(v) }))} />
        <SelectField label="Up to" value={String(s.fmax)} onChange={(v) => set({ fmax: Number(v) })} options={FMAX.map((f) => ({ value: String(f), label: f ? fmtHz(f) : 'Nyquist' }))} />
        <SelectField label="Scope gain" value={String(s.gain)} onChange={(v) => set({ gain: Number(v) })} options={[1, 2, 4, 8, 16].map((g) => ({ value: String(g), label: `×${g}` }))} />
        <Check label="Log axis" checked={s.log} onChange={(log) => set({ log })} />
        <Check label="Peak hold" checked={s.hold} onChange={(h) => set({ hold: h })} />
        <button type="button" className="k-btn small" disabled={!s.hold} onClick={() => { hold.current = null }}><RotateCcw size={12} /> Reset hold</button>
      </div>
      {error && <div className="sg-problem" role="alert">{error}</div>}
      <div className="sg-live-plots">
        <div className="sg-live-box"><div className="sg-live-title">Oscilloscope</div><canvas ref={scope} className="sg-canvas" aria-label="Oscilloscope" /></div>
        <div className="sg-live-box"><div className="sg-live-title">Spectrum (dB re amplitude 1) · amber: peak hold</div><canvas ref={spec} className="sg-canvas" aria-label="Spectrum" /></div>
      </div>
      <div className="sg-live-read" role="status" aria-live="off">{running ? readout : error ? '' : 'The microphone is used only while this tab is running. Nothing is recorded; use the Mic button in the Source panel to record.'}</div>
    </div>
  )
}
