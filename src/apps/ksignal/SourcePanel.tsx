// The left panel of kSignal: where the signal comes from (generator, imported file or microphone), its sample rate,
// duration, quantiser and noise.

import { useEffect, useRef, useState } from 'react'
import { AudioLines, FileAudio, Mic, Plus, Square, X } from 'lucide-react'
import { os } from '@/os'
import { startRecording, type Recorder } from './audio'
import { NumField, Section, SelectField, Segmented } from './Fields'
import {
  COMPONENT_FIELDS, COMPONENT_LABELS, COMPONENT_TYPES, defaultComponent, partialsFromText, partialsToText, sourceProblems, normalizeGenerator,
  type Component, type ComponentType, type GeneratorSource,
} from './generators'
import type { DataSource, KsigProject, Source } from './project'
import { fmtHz, fmtTime } from './stats'

export interface RecordedSignal { x: Float64Array; fs: number }

interface Props {
  project: KsigProject
  /** The generator the user had before switching to a file (restored with the Generator button). */
  lastGenerator: GeneratorSource
  channels: number
  onSource: (s: Source) => void
  onName: (name: string) => void
  onImport: () => void
  onRecorded: (r: RecordedSignal) => void
  onChannel: (c: number | 'mix') => void
}

type Mode = 'generator' | 'import' | 'mic'

export default function SourcePanel({ project, lastGenerator, channels, onSource, onName, onImport, onRecorded, onChannel }: Props) {
  const src = project.source
  const [mode, setMode] = useState<Mode>(src.kind === 'data' && src.origin !== 'recording' ? 'import' : src.kind === 'data' ? 'mic' : 'generator')
  useEffect(() => { setMode(src.kind === 'data' ? (src.origin === 'recording' ? 'mic' : 'import') : 'generator') }, [src.kind, src.kind === 'data' ? src.origin : ''])

  const choose = async (m: Mode) => {
    if (m === 'generator' && src.kind === 'data') {
      if (src.origin === 'recording' && !(await os.dialog.confirm('Switching to the generator discards the recording. Continue?', { title: 'Recording', okLabel: 'Switch', danger: true }))) return
      onSource(lastGenerator)
    }
    setMode(m)
  }

  return (
    <div className="sg-panel">
      <div className="sg-panel-head">
        <label className="sg-name">
          <span className="sg-field-label">Name</span>
          <input className="k-input" value={project.name} onChange={(e) => onName(e.target.value)} aria-label="Project name" />
        </label>
        {project.description && (
          <details className="sg-about" open={!!project.synthetic}>
            <summary>{project.synthetic ? 'About this example (synthetic data)' : 'About this signal'}</summary>
            <p>{project.description}</p>
          </details>
        )}
        <Segmented<Mode> label="Signal source" value={mode} onChange={(m) => void choose(m)} options={[
          { value: 'generator', label: 'Generator', icon: <AudioLines size={13} /> },
          { value: 'import', label: 'File', icon: <FileAudio size={13} /> },
          { value: 'mic', label: 'Mic', icon: <Mic size={13} /> },
        ]} />
      </div>
      {mode === 'generator' && src.kind === 'generator' && <GeneratorEditor source={src} onChange={onSource} />}
      {mode === 'import' && <ImportInfo source={src.kind === 'data' ? src : null} channels={channels} onImport={onImport} onSource={onSource} onChannel={onChannel} />}
      {mode === 'mic' && <MicRecorder source={src.kind === 'data' && src.origin === 'recording' ? src : null} onRecorded={onRecorded} />}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------- generator

function GeneratorEditor({ source, onChange }: { source: GeneratorSource; onChange: (s: GeneratorSource) => void }) {
  const set = (patch: Partial<GeneratorSource>) => onChange(normalizeGenerator({ ...source, ...patch }))
  const setComp = (i: number, patch: Partial<Component>) => set({ components: source.components.map((c, k) => (k === i ? { ...c, ...patch } : c)) })
  const problems = sourceProblems(source)
  const n = Math.round(source.fs * source.duration)
  const [add, setAdd] = useState<ComponentType>('sine')
  return (
    <>
      <Section title="Sampling">
        <div className="sg-grid2">
          <NumField label="Sample rate" unit="Hz" value={source.fs} min={1} max={192000} step={100} onChange={(fs) => set({ fs })} />
          <NumField label="Duration" unit="s" value={source.duration} min={0.001} step={0.1} onChange={(duration) => set({ duration })} />
        </div>
        <div className="sg-hint k-muted">{n.toLocaleString('en')} samples · Nyquist {fmtHz(source.fs / 2)} · {fmtTime(source.duration)}</div>
        {problems.map((p) => <div key={p} className="sg-problem">{p}</div>)}
      </Section>
      <Section title={`Components (${source.components.length})`}>
        {source.components.length === 0 && <div className="sg-hint k-muted">No components: the signal is silence (plus the noise below). Add a sine to start.</div>}
        {source.components.map((c, i) => (
          <div className="sg-comp" key={i}>
            <div className="sg-comp-head">
              <strong>{COMPONENT_LABELS[c.type]}</strong>
              <button type="button" className="k-icon-btn" title="Remove this component" aria-label={`Remove ${COMPONENT_LABELS[c.type]}`} onClick={() => set({ components: source.components.filter((_, k) => k !== i) })}><X size={14} /></button>
            </div>
            <div className="sg-grid2">
              {COMPONENT_FIELDS[c.type].map((f) => (
                <NumField key={f.key} label={f.label} unit={f.unit} min={f.min} max={f.max} step={f.step} value={c[f.key] as number} onChange={(v) => setComp(i, { [f.key]: v } as Partial<Component>)} />
              ))}
              {c.type === 'chirp' && <SelectField label="Sweep" value={c.sweep} options={[{ value: 'linear', label: 'Linear' }, { value: 'log', label: 'Logarithmic' }]} onChange={(sweep) => setComp(i, { sweep })} />}
            </div>
            {c.type === 'partials' && (
              <label className="sg-field">
                <span className="sg-field-label">Partials (Hz:amplitude:decay seconds)</span>
                <textarea className="k-input sg-textarea" rows={3} spellCheck={false} defaultValue={partialsToText(c.partials)} key={partialsToText(c.partials)} onBlur={(e) => setComp(i, { partials: partialsFromText(e.target.value) })} />
              </label>
            )}
          </div>
        ))}
        <div className="sg-addrow">
          <select className="k-input" value={add} onChange={(e) => setAdd(e.target.value as ComponentType)} aria-label="Component type">
            {COMPONENT_TYPES.map((t) => <option key={t} value={t}>{COMPONENT_LABELS[t]}</option>)}
          </select>
          <button type="button" className="k-btn small" onClick={() => set({ components: [...source.components, defaultComponent(add)] })}><Plus size={13} /> Add</button>
        </div>
      </Section>
      <Section title="Noise and converter">
        <div className="sg-grid2">
          <NumField label="Noise σ" value={source.noise.sigma} min={0} step={0.01} onChange={(sigma) => set({ noise: { ...source.noise, sigma } })} title="Standard deviation of the added noise" />
          <SelectField label="Colour" value={source.noise.color} options={[{ value: 'white', label: 'White' }, { value: 'pink', label: 'Pink (1/f)' }]} onChange={(color) => set({ noise: { ...source.noise, color } })} />
          <NumField label="Seed" value={source.noise.seed} min={0} step={1} onChange={(seed) => set({ noise: { ...source.noise, seed: Math.round(seed) } })} title="The same seed gives the same noise" />
          <NumField label="Quantiser" unit="bits" value={source.bits} min={0} max={24} step={1} onChange={(bits) => set({ bits: Math.round(bits) })} title="0 = no quantisation" />
          <NumField label="Full scale" unit="±" value={source.fullScale} min={0.001} step={0.1} onChange={(fullScale) => set({ fullScale })} />
        </div>
        <div className="sg-hint k-muted">{source.bits > 0 ? `A full-scale sine has SNR ≈ ${(6.02 * source.bits + 1.76).toFixed(1)} dB at ${source.bits} bits.` : 'Set bits above 0 to simulate an ADC.'}</div>
      </Section>
    </>
  )
}

// ------------------------------------------------------------------------------------------------- imported file

function ImportInfo({ source, channels, onImport, onSource, onChannel }: { source: DataSource | null; channels: number; onImport: () => void; onSource: (s: Source) => void; onChannel: (c: number | 'mix') => void }) {
  return (
    <Section title="Imported signal">
      <button type="button" className="k-btn primary wide" onClick={onImport}><FileAudio size={14} /> Import a file…</button>
      <div className="sg-hint k-muted">WAV and other audio files (mp3, ogg, flac, m4a), or CSV / text with “time, value” rows or one value per line.</div>
      {source ? (
        <>
          <div className="sg-card">
            <div><strong>{source.name}</strong></div>
            <div className="k-muted">{source.count.toLocaleString('en')} samples · {fmtTime(source.count / source.fs)} · {source.origin}</div>
            {source.path && <div className="k-muted sg-path" title={source.path}>{source.path}</div>}
          </div>
          <NumField label="Sample rate" unit="Hz" value={source.fs} min={0.001} step={100} onChange={(fs) => onSource({ ...source, fs })} title="Changing it reinterprets the samples (their number stays the same)" />
          {channels > 1 && (
            <SelectField label="Channel" value={String(source.channel ?? 0)} onChange={(v) => onChannel(v === 'mix' ? 'mix' : Number(v))}
              options={[...Array.from({ length: channels }, (_, c) => ({ value: String(c), label: channels === 2 ? (c === 0 ? 'Left' : 'Right') : `Channel ${c + 1}` })), { value: 'mix', label: 'Mix (mean)' }]} />
          )}
        </>
      ) : <div className="sg-empty k-muted">No file imported yet.</div>}
    </Section>
  )
}

// ------------------------------------------------------------------------------------------------- microphone

function MicRecorder({ source, onRecorded }: { source: DataSource | null; onRecorded: (r: RecordedSignal) => void }) {
  const rec = useRef<Recorder | null>(null)
  const [state, setState] = useState<'idle' | 'starting' | 'recording'>('idle')
  const [secs, setSecs] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (state !== 'recording') return
    const t = window.setInterval(() => { const r = rec.current; if (r) { setSecs(r.count() / r.fs); setLevel(r.level()) } }, 100)
    return () => window.clearInterval(t)
  }, [state])
  useEffect(() => () => { void rec.current?.stop().catch(() => {}) }, [])

  const stop = async () => {
    const r = rec.current
    if (!r) return
    rec.current = null
    setState('idle')
    const out = await r.stop()
    if (out.x.length >= 16) onRecorded(out)
    else setError('The recording was too short.')
  }
  const start = async () => {
    setError(null)
    setState('starting')
    try {
      rec.current = await startRecording(30, () => void stop())
      setSecs(0)
      setState('recording')
    } catch (e) {
      setState('idle')
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <Section title="Microphone">
      {state === 'recording' ? (
        <>
          <button type="button" className="k-btn danger wide" onClick={() => void stop()}><Square size={13} /> Stop recording</button>
          <div className="sg-meter" role="meter" aria-label="Input level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={level}><div style={{ width: `${Math.min(100, level * 100)}%` }} className={level > 0.98 ? 'clip' : ''} /></div>
          <div className="sg-hint k-muted">Recording {secs.toFixed(1)} s (at most 30 s). Raw samples: echo cancellation, noise suppression and gain control are off.</div>
        </>
      ) : (
        <button type="button" className="k-btn primary wide" disabled={state === 'starting'} onClick={() => void start()}><Mic size={14} /> {state === 'starting' ? 'Opening the microphone…' : 'Record'}</button>
      )}
      {error && <div className="sg-problem">{error}</div>}
      {source && state !== 'recording' && (
        <>
          <div className="sg-card">
            <div><strong>{source.name}</strong></div>
            <div className="k-muted">{source.count.toLocaleString('en')} samples at {fmtHz(source.fs)} · {fmtTime(source.count / source.fs)}</div>
          </div>
        </>
      )}
      {!source && state === 'idle' && <div className="sg-hint k-muted">Press Record, make a sound (hum a note, whistle, tap a glass), press Stop. The recording appears in the Time, Spectrum and Spectrogram tabs. For a live view use the Live tab.</div>}
    </Section>
  )
}
