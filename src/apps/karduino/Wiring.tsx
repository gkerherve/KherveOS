// The Wiring panel: how the open example is wired, the board's pinout with the pins the code uses lit.

import { ChevronDown, ChevronRight } from 'lucide-react'
import { Pinout } from './Pinout'
import { ROLE_NAMES, type PinReport } from './pins'
import type { Family } from './boards'
import type { Example } from './examples'

interface Props {
  open: boolean
  onToggle(): void
  example: Example | null
  report: PinReport
  family: Family
  boardName: string
  onLibrary(name: string): void
}

export function Wiring({ open, onToggle, example, report, family, boardName, onLibrary }: Props) {
  return (
    <section className="ka-wiring" aria-label="Wiring">
      <button className="ka-wiring-head" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Wiring and pins
        <span className="k-muted"> {report.pins.length ? `${report.pins.length} pin${report.pins.length > 1 ? 's' : ''} used` : 'no pins used yet'}{report.warnings.length ? `, ${report.warnings.length} warning${report.warnings.length > 1 ? 's' : ''}` : ''}</span>
      </button>
      {open && (
        <div className="ka-wiring-body">
          <div className="ka-wiring-text">
            {example ? (
              <>
                <div className="ka-subtitle">{example.title}</div>
                <p className="ka-wiring-desc">{example.description}</p>
                <pre className="ka-wiring-pre">{example.wiring}</pre>
                {example.libraries.length > 0 && (
                  <div className="ka-chips">
                    <span className="k-muted">Libraries:</span>
                    {example.libraries.map((l) => <button key={l} className="ka-chip" onClick={() => onLibrary(l)} title="Find it in Libraries">{l}</button>)}
                  </div>
                )}
              </>
            ) : (
              <div className="k-muted">Open an example to see how it is wired. The board drawing shows the pins your code uses ({boardName}).</div>
            )}
            {report.pins.length > 0 && (
              <ul className="ka-pinlist">
                {report.pins.map((p) => (
                  <li key={p.pin}><b>{p.pin.startsWith('D') ? p.pin.slice(1) : p.pin}</b> {p.roles.map((r) => ROLE_NAMES[r]).join(', ')} <span className="k-muted">line {p.lines.join(', ')}</span></li>
                ))}
              </ul>
            )}
            {report.warnings.map((w) => <div key={w} className="ka-note">{w}</div>)}
          </div>
          <div className="ka-wiring-board">
            <Pinout family={family} report={report} />
            <div className="ka-legend-pins k-muted">~ PWM · INT interrupt · lit pins are used by the code</div>
          </div>
        </div>
      )}
    </section>
  )
}
