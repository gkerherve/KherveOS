// Viewer: pictures and PDFs from the drive. PDFs use the browser's own PDF
// viewer until KhervePDF arrives.

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FolderOpen, ImageIcon, Maximize, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { os, fs, path, HOME, useFsVersion, type AppProps } from '@/os'
import { IMAGE_EXTS, mimeType } from '@/os/fileIcons'
import { useSettings } from '@/os/settings'
import './viewer.css'

export const VIEWER_TYPES = [...IMAGE_EXTS, '.pdf']

export default function Viewer({ win, args }: AppProps) {
  const [file, setFile] = useState<string | null>(args.path ?? null)
  const [url, setUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [rotation, setRotation] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const setSettings = useSettings((s) => s.set)
  const version = useFsVersion()

  useEffect(() => {
    if (args.path) setFile(args.path)
  }, [args.path])

  const isPdf = file ? path.extname(file) === '.pdf' : false
  const mtime = file ? fs.stat(file)?.mtime : undefined

  useEffect(() => {
    if (!file) return
    let u: string | null = null
    let alive = true
    setError(null)
    fs.readBytes(file)
      .then((b) => {
        if (!alive) return
        u = URL.createObjectURL(new Blob([b as BlobPart], { type: mimeType(file) }))
        setUrl(u)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    setZoom('fit')
    setRotation(0)
    return () => {
      alive = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [file, mtime])

  useEffect(() => {
    win.setTitle(file ? `${path.basename(file)} — Viewer` : 'Viewer')
  }, [win, file])

  // Other pictures in the same folder, for previous / next.
  const siblings = useMemo(() => {
    if (!file || isPdf || !fs.isDir(path.dirname(file))) return []
    return fs.list(path.dirname(file)).filter((s) => s.type === 'file' && IMAGE_EXTS.includes(path.extname(s.name))).map((s) => s.path)
  }, [file, isPdf, version])
  const index = file ? siblings.indexOf(file) : -1
  const step = (d: number) => {
    if (siblings.length < 2 || index < 0) return
    setFile(siblings[(index + d + siblings.length) % siblings.length])
  }

  const open = async () => {
    const p = await os.dialog.openFile({ startDir: file ? path.dirname(file) : `${HOME}/Pictures`, extensions: VIEWER_TYPES })
    if (p) setFile(p)
  }

  if (!file) {
    return (
      <div className="k-center">
        <ImageIcon size={36} color="var(--k-muted)" />
        <p className="k-muted">Open a picture or a PDF from your drive.</p>
        <button className="k-btn primary" onClick={open}><FolderOpen size={14} /> Open…</button>
      </div>
    )
  }

  return (
    <div
      className="k-app vw-app"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (isPdf) return
        if (e.key === 'ArrowRight') step(1)
        else if (e.key === 'ArrowLeft') step(-1)
        else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(8, (z === 'fit' ? 1 : z) * 1.25))
        else if (e.key === '-') setZoom((z) => Math.max(0.1, (z === 'fit' ? 1 : z) / 1.25))
        else if (e.key === '0') setZoom('fit')
      }}
    >
      <div className="k-toolbar">
        <button className="k-icon-btn" title="Open" onClick={open}><FolderOpen size={16} /></button>
        <button className="k-icon-btn" title="Download to your computer" onClick={() => void os.download(file)}><Download size={16} /></button>
        {!isPdf && (
          <>
            <span className="k-sep" />
            <button className="k-icon-btn" title="Previous" disabled={siblings.length < 2} onClick={() => step(-1)}><ChevronLeft size={16} /></button>
            <button className="k-icon-btn" title="Next" disabled={siblings.length < 2} onClick={() => step(1)}><ChevronRight size={16} /></button>
            <span className="k-sep" />
            <button className="k-icon-btn" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.1, (z === 'fit' ? 1 : z) / 1.25))}><ZoomOut size={16} /></button>
            <button className="k-btn small" title="Fit / actual size" onClick={() => setZoom((z) => (z === 'fit' ? 1 : 'fit'))}>
              {zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}
            </button>
            <button className="k-icon-btn" title="Zoom in" onClick={() => setZoom((z) => Math.min(8, (z === 'fit' ? 1 : z) * 1.25))}><ZoomIn size={16} /></button>
            <button className="k-icon-btn" title="Rotate" onClick={() => setRotation((r) => (r + 90) % 360)}><RotateCw size={16} /></button>
            <span className="k-spacer" />
            <button className="k-btn small" onClick={() => {
              setSettings({ wallpaper: `file:${file}` })
              os.notify({ title: 'Wallpaper changed' })
            }}><Maximize size={13} /> Set as wallpaper</button>
          </>
        )}
      </div>
      <div className={`vw-stage${isPdf ? ' pdf' : ''}`}>
        {error ? (
          <div className="k-center k-error">{error}</div>
        ) : !url ? null : isPdf ? (
          <iframe className="vw-pdf" src={url} title={path.basename(file)} />
        ) : (
          <img
            className={`vw-img${zoom === 'fit' ? ' fit' : ''}`}
            src={url}
            alt={path.basename(file)}
            draggable={false}
            style={{
              transform: `rotate(${rotation}deg)${zoom === 'fit' ? '' : ` scale(${zoom})`}`,
            }}
          />
        )}
      </div>
      {!isPdf && siblings.length > 1 && (
        <div className="k-statusbar">
          <span>{index + 1} of {siblings.length}</span>
          <span style={{ marginLeft: 'auto' }}>{path.pretty(file)}</span>
        </div>
      )}
    </div>
  )
}
