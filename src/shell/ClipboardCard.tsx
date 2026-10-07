// The small "Files & Clipboard" card at the top right of the desktop: where
// files live, drag-out to download, and copy/paste between computers when
// signed in. Dismissible (remembered in localStorage); the desktop's
// right-click menu brings it back. Also the progress panel for big pastes.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardPaste, CloudUpload, Download, HardDrive, LogIn, X } from 'lucide-react'
import { create } from 'zustand'
import { formatSize } from '@/os'
import { useAuth, useServer } from '@/os/server'
import { useWindows } from '@/os/windows'
import { clearClipboard, DEVICE_ID, pasteInto, useClipboard } from '@/apps/files/clipboard'
import { canDragOut } from '@/apps/files/dragOut'
import './clipboardCard.css'

const KEY = 'kherveos.clipboardCard.dismissed'

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(v: boolean) {
  try {
    if (v) window.localStorage.setItem(KEY, '1')
    else window.localStorage.removeItem(KEY)
  } catch {
    /* private window: it just comes back next time */
  }
}

export const useClipboardCard = create<{ open: boolean }>(() => ({ open: !readDismissed() }))

/** Show the card again ("About Files & Clipboard" in the desktop menu). */
export function showClipboardCard() {
  writeDismissed(false)
  useClipboardCard.setState({ open: true })
}

function hideClipboardCard() {
  writeDismissed(true)
  useClipboardCard.setState({ open: false })
}

export function ClipboardCard({ desktop, onHeight }: { desktop: string; onHeight?: (h: number) => void }) {
  const open = useClipboardCard((s) => s.open)
  const user = useAuth((s) => s.user)
  const online = useServer((s) => s.status) === 'online'
  const server = useClipboard((s) => s.server)
  const uploading = useClipboard((s) => s.uploading)
  const local = useClipboard((s) => s.local)
  const [el, setEl] = useState<HTMLDivElement | null>(null)

  // The desktop icons move down to make room for the card.
  useEffect(() => {
    if (!open || !el) {
      onHeight?.(0)
      return
    }
    const ro = new ResizeObserver(() => onHeight?.(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, el, onHeight])

  if (!open) return null
  const fromElsewhere = server && server.device_id !== DEVICE_ID
  const n = server?.items.length ?? 0

  return (
    <div className="k-clipcard" ref={setEl} role="note" aria-label="Files and clipboard">
      <div className="k-clipcard-head">
        <span>Files &amp; Clipboard</span>
        <button className="k-clipcard-close" aria-label="Hide" title="Hide (bring it back from the desktop's right-click menu)" onClick={hideClipboardCard}>
          <X size={13} />
        </button>
      </div>
      <p>
        <HardDrive size={14} />
        <span>Your files are kept in this browser, on this computer. Copy and paste (⌘C, ⌘V) works here.</span>
      </p>
      <p>
        <Download size={14} />
        <span>
          {canDragOut
            ? 'Drag files out to your computer to download them.'
            : 'Drag files out of the browser window to download them.'}
        </span>
      </p>
      {user ? (
        <p>
          <CloudUpload size={14} />
          <span>
            Signed in as <b>{user.display_name || user.username}</b>: copy here, paste on your other computers.
            {!online && ' (The server is not reachable right now.)'}
          </span>
        </p>
      ) : (
        <p>
          <CloudUpload size={14} />
          <span>
            Sign in to copy and paste between your computers.{' '}
            <button className="k-clipcard-btn" onClick={() => useWindows.getState().open('settings', { section: 'server' })}>
              <LogIn size={12} /> Sign in
            </button>
          </span>
        </p>
      )}
      {user && uploading && (
        <div className="k-clipcard-status">
          Sharing your copy… {Math.round((100 * uploading.done) / Math.max(1, uploading.total))}%
          <span className="k-clipcard-bar"><span style={{ width: `${(100 * uploading.done) / Math.max(1, uploading.total)}%` }} /></span>
        </div>
      )}
      {user && server && !uploading && (
        <div className="k-clipcard-status">
          <span>
            Shared clipboard: {n === 1 ? `"${server.items[0].name}"` : `${n} items`} ({formatSize(server.size)})
            {fromElsewhere ? ` from ${server.device}` : ', copied here'}
          </span>
          <span className="k-clipcard-actions">
            {fromElsewhere && (
              <button className="k-clipcard-btn" onClick={() => void pasteInto(desktop)}>
                <ClipboardPaste size={12} /> Paste on Desktop
              </button>
            )}
            <button className="k-clipcard-btn" onClick={() => void clearClipboard()}>Clear</button>
          </span>
        </div>
      )}
      {!server && local && (
        <div className="k-clipcard-status">
          <span>
            {local.mode === 'cut' ? 'Cut' : 'Copied'}: {local.paths.length === 1 ? 'one item' : `${local.paths.length} items`}
          </span>
          <span className="k-clipcard-actions">
            <button className="k-clipcard-btn" onClick={() => void clearClipboard()}>Clear</button>
          </span>
        </div>
      )}
    </div>
  )
}

/** "Copying 12 items…" with a bar and Stop, shown above the windows while a paste takes a while. */
export function PasteProgress() {
  const p = useClipboard((s) => s.progress)
  if (!p) return null
  const pct = Math.min(100, (100 * p.done) / Math.max(1, p.total))
  return createPortal(
    <div className="k-paste-progress" role="status">
      <div className="k-paste-title">{p.title}</div>
      <div className="k-clipcard-bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="k-paste-detail">
        <span>{p.detail ?? ''}</span>
        <span>{formatSize(p.done)} of {formatSize(p.total)}</span>
      </div>
      {p.cancel && (
        <button className="k-clipcard-btn" onClick={p.cancel}>Stop</button>
      )}
    </div>,
    document.body,
  )
}
