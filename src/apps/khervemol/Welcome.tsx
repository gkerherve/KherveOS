// The start screen — the desktop's WelcomeScreen (welcome.py): a soft
// gradient wallpaper with a few translucent circles, a card with the KMol
// mark, New Molecule / Open… / Browse Library…, and the recent files (click
// to open, right-click ▸ Remove from Recent Files).

import { useStore } from 'zustand'
import { mdiFileOutline, mdiFolderOpen, mdiMagnify, mdiMolecule } from '@mdi/js'
import { os, fs, path as vpath } from '@/os'
import { KMolMark, Mdi } from './icons'
import type { MolApp } from './app'

function subtitle(p: string): string {
  const folder = vpath.basename(vpath.dirname(p)) || p
  const st = fs.stat(p)
  if (!st) return folder
  const when = new Date(st.mtime).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
  return `${folder} — ${when}`
}

export function Welcome({ app }: { app: MolApp }) {
  const recent = useStore(app.store, (s) => s.recent)
  return (
    <div className="km-welcome">
      <svg className="km-wall" preserveAspectRatio="none" aria-hidden>
        {[
          [0.12, 0.18, 0.11],
          [0.88, 0.8, 0.16],
          [0.92, 0.1, 0.06],
          [0.06, 0.88, 0.08],
          [0.5, 0.94, 0.05],
        ].map(([cx, cy, r], i) => (
          <circle key={i} cx={`${cx * 100}%`} cy={`${cy * 100}%`} r={`${r * 100}vw`} className="km-wall-dot" />
        ))}
      </svg>
      <div className="km-card">
        <div className="km-card-head">
          <KMolMark size={64} />
          <div>
            <div className="km-card-title">KherveMol</div>
            <div className="km-card-sub">Molecules and crystals, in 3D and 2D.</div>
          </div>
        </div>
        <div className="km-card-actions">
          <button className="k-btn" onClick={() => void app.newDocument()}>
            <Mdi path={mdiFileOutline} size={18} /> New Molecule
          </button>
          <button className="k-btn" onClick={() => void app.openDialog()}>
            <Mdi path={mdiFolderOpen} size={18} /> Open…
          </button>
          <button className="k-btn" onClick={() => void app.openExplorer()}>
            <Mdi path={mdiMagnify} size={18} /> Browse Library…
          </button>
        </div>
        <hr className="km-divider" />
        <div className="km-card-recent">Recent</div>
        {recent.length === 0 ? (
          <div className="km-card-empty">No recent files yet — open or save a molecule to see it here.</div>
        ) : (
          recent.map((p) => (
            <div
              key={p}
              className="km-recent"
              onClick={() => void app.openPath(p)}
              onContextMenu={(e) => {
                e.preventDefault()
                os.contextMenu(e, [
                  { label: 'Open', onClick: () => void app.openPath(p) },
                  { label: 'Remove from Recent Files', onClick: () => app.removeRecent(p) },
                ])
              }}
            >
              <Mdi path={mdiMolecule} size={20} />
              <div>
                <div className="km-recent-name">{vpath.basename(p)}</div>
                <div className="km-recent-sub">{subtitle(p)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
