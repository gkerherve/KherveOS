// The starting screen while the NIST library loads, and the welcome window.
// The desktop app's auto-update has no place in KherveOS.

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { FloatingWindow } from './Popups'

export const VERSION = '5.0'
const ICON = `${import.meta.env.BASE_URL}icons/apps/khervedb.png`

export function SplashScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="kdb-splash" role="status" aria-label="Loading KherveDB">
      <div className="kdb-splash-card">
        <img src={ICON} alt="" width={104} height={104} draggable={false} />
        <div>
          <div className="kdb-splash-title">KherveDB</div>
          <div className="kdb-splash-sub">XPS Binding Energy Database</div>
          <div className="kdb-muted">Version {VERSION}</div>
        </div>
      </div>
      {error ? (
        <div className="kdb-splash-error">
          <span>Could not load the NIST database: {error}</span>
          <button type="button" className="k-btn" onClick={onRetry}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      ) : (
        <div className="kdb-splash-status">
          <span className="kdb-splash-progress" />
          Loading NIST library…
        </div>
      )}
    </div>
  )
}

export function Welcome({ onClose }: { onClose: (dontShowAgain: boolean) => void }) {
  const [dontShow, setDontShow] = useState(false)
  const close = () => onClose(dontShow)
  return (
    <FloatingWindow title="Welcome to KherveDB" onClose={close} wide>
      <div className="kdb-welcome">
        <div className="kdb-welcome-banner">
          <img src={ICON} alt="" width={64} height={64} draggable={false} />
          <div>
            <div className="kdb-welcome-title">Welcome to KherveDB</div>
            <div className="kdb-welcome-sub">XPS binding energies at your fingertips</div>
          </div>
        </div>
        <ul>
          <li>
            <b>Click</b> an element to list its XPS binding energies from the NIST database.
          </li>
          <li>
            <b>Right-click</b> an element for its electronic structure, XPS peak positions and overlaps.
          </li>
          <li>
            <b>Double-click</b> it, or press <b>Other Databases &amp; Properties</b>, for XPS Fitting, Harwell, Thermo and Google
            Scholar pages that follow the element you select.
          </li>
          <li>
            Filter with the <b>XPS line</b>, <b>Formula</b> and <b>Name</b> boxes; click a result for all its details, right-click it
            to copy the reference.
          </li>
          <li>Hover over any control to see what it does.</li>
        </ul>
        <div className="kdb-welcome-foot">
          <label className="kdb-check">
            <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
            Don't show this again
          </label>
          <button type="button" className="k-btn primary" onClick={close} autoFocus>
            Start
          </button>
        </div>
      </div>
    </FloatingWindow>
  )
}
