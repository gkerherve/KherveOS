// The right-hand panel of kArduino: serial monitor and serial plotter.

import { useEffect, useRef, useState } from 'react'
import { Clipboard, Download, Pause, Play, Plug, Send, Trash2, Unplug } from 'lucide-react'
import { PlotChart } from './PlotChart'
import { colorOf, type Column } from './plotter'
import { BAUD_RATES, stamp } from './sketch'
import type { LineEnding } from './serial'

export interface LogEntry {
  t: number
  text: string
  /** Sent by us (shown with a ">"). */
  tx?: boolean
}

export const lineText = (e: LogEntry, timestamps: boolean): string => `${timestamps ? `[${stamp(e.t)}] ` : ''}${e.tx ? '> ' : ''}${e.text}`

const SHOWN = 1000

interface Props {
  supported: boolean
  open: boolean
  baud: number
  onBaud(n: number): void
  resetDtr: boolean
  onResetDtr(v: boolean): void
  onConnect(): void
  onDisconnect(): void
  note: string | null
  view: 'monitor' | 'plotter'
  onView(v: 'monitor' | 'plotter'): void
  entries: LogEntry[]
  columns: Column[]
  total: number
  timestamps: boolean
  onTimestamps(v: boolean): void
  autoscroll: boolean
  onAutoscroll(v: boolean): void
  paused: boolean
  onPause(): void
  ending: LineEnding
  onEnding(e: LineEnding): void
  onSend(text: string): void
  onClear(): void
  onCopy(): void
  onSave(): void
  onSaveCsv(): void
  hidden: ReadonlySet<string>
  onToggleSeries(name: string): void
}

export function SerialPanel(p: Props) {
  const [text, setText] = useState('')
  const log = useRef<HTMLPreElement>(null)
  const shown = p.entries.slice(-SHOWN)
  useEffect(() => {
    const el = log.current
    if (el && p.autoscroll && !p.paused) el.scrollTop = el.scrollHeight
  })

  return (
    <aside className="ka-serial" aria-label="Serial">
      <div className="ka-tabs" role="tablist">
        <button role="tab" aria-selected={p.view === 'monitor'} className={p.view === 'monitor' ? 'on' : ''} onClick={() => p.onView('monitor')}>Serial monitor</button>
        <button role="tab" aria-selected={p.view === 'plotter'} className={p.view === 'plotter' ? 'on' : ''} onClick={() => p.onView('plotter')}>Serial plotter</button>
      </div>
      {!p.supported && <div className="ka-note">Web Serial is not in this browser: use Chrome or Edge to talk to a board.</div>}
      <div className="ka-row">
        <select className="k-input" value={p.baud} onChange={(e) => p.onBaud(Number(e.target.value))} disabled={p.open} aria-label="Baud rate">
          {BAUD_RATES.map((b) => <option key={b} value={b}>{b} baud</option>)}
        </select>
        {p.open ? (
          <button className="k-btn" onClick={p.onDisconnect}><Unplug size={13} /> Disconnect</button>
        ) : (
          <button className="k-btn" disabled={!p.supported} onClick={p.onConnect}><Plug size={13} /> Connect…</button>
        )}
      </div>
      <label className="ka-check" title="Pulse the DTR line when connecting: most boards restart, so setup() runs again and the first lines are not missed">
        <input type="checkbox" checked={p.resetDtr} onChange={(e) => p.onResetDtr(e.target.checked)} disabled={p.open} /> Reset the board on connect (DTR)
      </label>
      {p.note && <div className="ka-note">{p.note}</div>}

      <div className="ka-row ka-wrap">
        <button className="k-btn small" onClick={p.onPause} title="Freeze the display; data keeps arriving">
          {p.paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
        </button>
        <button className="k-btn small" onClick={p.onClear}><Trash2 size={12} /> Clear</button>
        {p.view === 'monitor' ? (
          <>
            <button className="k-btn small" onClick={p.onCopy}><Clipboard size={12} /> Copy</button>
            <button className="k-btn small" onClick={p.onSave}><Download size={12} /> Save log</button>
            <label className="ka-check"><input type="checkbox" checked={p.timestamps} onChange={(e) => p.onTimestamps(e.target.checked)} /> Timestamps</label>
            <label className="ka-check"><input type="checkbox" checked={p.autoscroll} onChange={(e) => p.onAutoscroll(e.target.checked)} /> Autoscroll</label>
          </>
        ) : (
          <button className="k-btn small" onClick={p.onSaveCsv} disabled={!p.columns.length}><Download size={12} /> Save CSV</button>
        )}
      </div>

      {p.view === 'monitor' ? (
        <>
          <pre className="ka-log" ref={log} aria-label="Serial output">{shown.length ? shown.map((e) => lineText(e, p.timestamps)).join('\n') : 'Nothing received yet.'}</pre>
          <form className="ka-row" onSubmit={(e) => { e.preventDefault(); if (p.open) { p.onSend(text); setText('') } }}>
            <input className="k-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={p.open ? 'Send a line' : 'Connect first'} disabled={!p.open} aria-label="Line to send" />
            <select className="k-input ka-ending" value={p.ending} onChange={(e) => p.onEnding(e.target.value as LineEnding)} aria-label="Line ending">
              <option value="none">No line ending</option>
              <option value="nl">Newline</option>
              <option value="cr">Carriage return</option>
              <option value="crnl">Both NL &amp; CR</option>
            </select>
            <button className="k-icon-btn" disabled={!p.open} aria-label="Send"><Send size={13} /></button>
          </form>
        </>
      ) : (
        <>
          <div className="ka-legend">
            {p.columns.map((c, i) => (
              <button key={c.name} className={`ka-series${p.hidden.has(c.name) ? ' off' : ''}`} onClick={() => p.onToggleSeries(c.name)} title="Show or hide this series">
                <span className="ka-swatch" style={{ background: colorOf(i) }} /> {c.name}
                {!p.hidden.has(c.name) && lastValue(c) !== null && <span className="k-muted"> {lastValue(c)}</span>}
              </button>
            ))}
          </div>
          <PlotChart columns={p.columns} hidden={p.hidden} total={p.total} />
        </>
      )}
      <div className="ka-hint k-muted">
        The web page can read the board but cannot flash it. Use Upload (the board must be plugged into the computer the KherveOS server runs on) or the Arduino IDE.
      </div>
    </aside>
  )
}

function lastValue(c: Column): string | null {
  for (let i = c.values.length - 1; i >= 0; i--) if (Number.isFinite(c.values[i])) return String(Math.round(c.values[i] * 1000) / 1000)
  return null
}
