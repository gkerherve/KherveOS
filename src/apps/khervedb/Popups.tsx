// Small windows inside the KherveDB window: the XPS information of an element
// (right-click), all the details of a NIST entry, and the frame they share.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { ElementInfo, ElementsFile, NistDb } from './data'

/**
 * A floating window kept inside the app, near the pointer (x, y in page
 * coordinates) or centred. Not modal; Escape (the app's key handler) or × closes it.
 */
export function FloatingWindow({
  title, x, y, onClose, children, wide, className,
}: {
  title: string
  x?: number
  y?: number
  onClose: () => void
  children: ReactNode
  wide?: boolean
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Re-placed when its content or the app window changes size.
  useLayoutEffect(() => {
    const el = ref.current
    const host = el?.offsetParent as HTMLElement | null
    if (!el || !host) return
    const place = () => {
      const r = host.getBoundingClientRect()
      const w = el.offsetWidth
      const h = el.offsetHeight
      const left = x == null ? (host.clientWidth - w) / 2 : Math.min(x - r.left + 12, host.clientWidth - w - 8)
      const top = y == null ? (host.clientHeight - h) / 2 : Math.min(y - r.top + 12, host.clientHeight - h - 8)
      setPos({ left: Math.max(8, Math.round(left)), top: Math.max(8, Math.round(top)) })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    ro.observe(host)
    return () => ro.disconnect()
  }, [x, y])

  // Take the keyboard focus, so Escape closes it straight away.
  useEffect(() => {
    const el = ref.current
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
  }, [])

  return (
    <div
      ref={ref}
      className={`kdb-floating${wide ? ' kdb-wide' : ''}${className ? ` ${className}` : ''}`}
      style={pos ?? { visibility: 'hidden' }}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
    >
      <div className="kdb-floating-title">
        <span>{title}</span>
        <button type="button" className="k-icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <X size={15} />
        </button>
      </div>
      <div className="kdb-floating-body">{children}</div>
    </div>
  )
}

/** Electronic structure, XPS peak positions, spin–orbit splitting and overlaps of an element. */
export function InfoContent({ el, meta, info }: { el: string; meta: ElementsFile; info: ElementInfo }) {
  const m = meta.elements[el]
  const p = m.props
  return (
    <div className="kdb-info">
      <div className="kdb-info-head">
        <span className={`kdb-info-sym kdb-cat-${m.cat}`}>{el}</span>
        <div>
          <div className="kdb-info-name">{String(p.Name ?? el)}</div>
          <div className="kdb-muted">
            Z = {m.z} · {String(p.Category ?? m.cat)}
          </div>
        </div>
      </div>
      <dl>
        {p['Electron Configuration'] && (
          <>
            <dt>Electron configuration</dt>
            <dd>{String(p['Electron Configuration'])}</dd>
          </>
        )}
        {p['Ground State'] && (
          <>
            <dt>Ground state</dt>
            <dd>{String(p['Ground State'])}</dd>
          </>
        )}
        {info.mainLine && (
          <>
            <dt>Main XPS line</dt>
            <dd>
              {el} {info.mainLine}
            </dd>
          </>
        )}
      </dl>
      {info.peaks.length > 0 ? (
        <>
          <h4>
            XPS peak positions <span className="kdb-muted">(NIST median, 5–95 % range)</span>
          </h4>
          <table className="kdb-peaks">
            <thead>
              <tr>
                <th>Line</th>
                <th className="kdb-num">BE (eV)</th>
                <th className="kdb-num">Range</th>
                <th className="kdb-num">n</th>
              </tr>
            </thead>
            <tbody>
              {info.peaks.map((s) => (
                <tr key={s.line}>
                  <td>{s.line}</td>
                  <td className="kdb-num">{s.median.toFixed(1)}</td>
                  <td className="kdb-num">{s.count > 1 ? `${s.lo.toFixed(1)}–${s.hi.toFixed(1)}` : 'single'}</td>
                  <td className="kdb-num">{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p>No XPS data in the NIST database for this element.</p>
      )}
      {info.spinOrbit.length > 0 && (
        <p>
          <b>Spin–orbit splitting:</b> {info.spinOrbit.join(', ')}
        </p>
      )}
      {info.known && (
        <p>
          <b>Common overlaps:</b> {info.known}
        </p>
      )}
      {info.mainLine && (
        <p>
          <b>NIST lines within ±5 eV of {info.mainLine}:</b>{' '}
          {info.nearby.length ? info.nearby.map((s) => `${s.el} ${s.line} (${s.median.toFixed(1)})`).join(', ') : 'none'}
        </p>
      )}
    </div>
  )
}

/** Every recorded field of one NIST entry. */
export function RowDetails({ db, row }: { db: NistDb; row: number }) {
  return (
    <table className="kdb-details">
      <tbody>
        {db.columns.map((c) => {
          const v = db.value(c, row).trim()
          return v ? (
            <tr key={c}>
              <th>{c}</th>
              <td>{v}</td>
            </tr>
          ) : null
        })}
      </tbody>
    </table>
  )
}
