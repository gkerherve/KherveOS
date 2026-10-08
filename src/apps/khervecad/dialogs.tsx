// The desktop's dialogs in the browser.
//
// - Ask: a modal question the desktop code stopped at — QMessageBox
//   (question / with its own buttons), QInputDialog (text, number, item),
//   QColorDialog. Files go through KherveOS's own file dialog (see
//   KherveCAD.tsx). The answer goes back to Python, which runs the action
//   again with it.
// - WindowFrame: a desktop QDialog (builders, Part Library, analysis…),
//   its widgets drawn by the Qt renderer, floating over the window.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, HelpCircle, Info, X, XCircle } from 'lucide-react'
import type { AskSpec, WindowNode } from './types'
import { QtNode, sanitize } from './qt/QtNode'
import { plainText } from './nodes'
export { filterExtensions } from './logic'

const isHtml = (s?: string) => !!s && /<[a-z][^>]*>/i.test(s)

function Text({ text }: { text?: string }) {
  if (!text) return null
  if (isHtml(text)) return <div className="kc-ask-text" dangerouslySetInnerHTML={{ __html: sanitize(text) }} />
  return <div className="kc-ask-text">{text}</div>
}

export function AskDialog({ spec, answer }: { spec: AskSpec; answer: (v: unknown) => void }) {
  const [value, setValue] = useState<string>(() => {
    if (spec.kind === 'item') return spec.items?.[spec.current ?? 0] ?? ''
    if (spec.kind === 'color') return String(spec.value ?? '#4a90d9')
    return spec.value == null ? '' : String(spec.value)
  })
  const [alpha, setAlpha] = useState(spec.alpha ?? 1)
  const [checked, setChecked] = useState(false)
  const ok = () => {
    if (spec.kind === 'double' || spec.kind === 'int') {
      const v = parseFloat(value)
      answer({ ok: Number.isFinite(v), value: Number.isFinite(v) ? v : spec.value })
    } else if (spec.kind === 'color') answer({ ok: true, value, alpha })
    else answer({ ok: true, value })
  }
  const cancel = () => {
    if (spec.kind === 'question' || spec.kind === 'message') answer({ clicked: -1 })
    else answer({ ok: false, value: '' })
  }
  const icon =
    spec.icon === 2 ? <AlertTriangle size={22} /> : spec.icon === 3 ? <XCircle size={22} /> : spec.kind === 'question' || spec.icon === 4 ? <HelpCircle size={22} /> : <Info size={22} />
  let body: ReactNode
  let buttons: ReactNode
  if (spec.kind === 'question' || spec.kind === 'message') {
    body = (
      <div className="kc-ask-row">
        <span className="kc-ask-icon">{icon}</span>
        <div>
          <Text text={spec.text} />
          <Text text={spec.info} />
          {spec.detail && <pre className="kc-ask-detail">{spec.detail}</pre>}
          {spec.checkbox && (
            <label className="kc-check">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              <span>{spec.checkbox}</span>
            </label>
          )}
        </div>
      </div>
    )
    buttons = (spec.buttons ?? ['OK']).map((b, i) => (
      <button
        key={i}
        type="button"
        autoFocus={i === (spec.default ?? 0)}
        className={`k-btn${i === (spec.default ?? 0) ? ' primary' : ''}`}
        onClick={() => answer({ clicked: i, checked })}
      >
        {plainText(b)}
      </button>
    ))
  } else {
    let field: ReactNode
    if (spec.kind === 'item') {
      field = spec.editable ? (
        <>
          <input className="k-input" list="kc-ask-items" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
          <datalist id="kc-ask-items">
            {(spec.items ?? []).map((it) => (
              <option key={it} value={it} />
            ))}
          </datalist>
        </>
      ) : (
        <select className="k-input" value={value} autoFocus onChange={(e) => setValue(e.target.value)}>
          {(spec.items ?? []).map((it) => (
            <option key={it} value={it}>
              {it}
            </option>
          ))}
        </select>
      )
    } else if (spec.kind === 'color') {
      field = (
        <div className="kc-ask-color">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#4a90d9'} onChange={(e) => setValue(e.target.value)} />
          <input className="k-input" value={value} onChange={(e) => setValue(e.target.value)} />
          {spec.with_alpha && (
            <label>
              Opacity{' '}
              <input type="range" min={0} max={1} step={0.01} value={alpha} onChange={(e) => setAlpha(parseFloat(e.target.value))} /> {Math.round(alpha * 100)} %
            </label>
          )}
        </div>
      )
    } else if (spec.kind === 'double' || spec.kind === 'int') {
      field = (
        <input
          className="k-input"
          type="number"
          autoFocus
          value={value}
          min={spec.min}
          max={spec.max}
          step={spec.kind === 'int' ? 1 : 10 ** -(spec.decimals ?? 1)}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ok()}
        />
      )
    } else if (spec.multiline) {
      field = <textarea className="k-input" rows={8} autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
    } else {
      field = <input className="k-input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
    }
    body = (
      <div className="kc-ask-form">
        <Text text={spec.label} />
        {field}
      </div>
    )
    buttons = (
      <>
        <button type="button" className="k-btn" onClick={cancel}>
          Cancel
        </button>
        <button type="button" className="k-btn primary" onClick={ok}>
          OK
        </button>
      </>
    )
  }
  return (
    <div className="kc-modal-backdrop" onKeyDown={(e) => e.key === 'Escape' && cancel()}>
      <div className="kc-ask" role="dialog" aria-modal="true" aria-label={spec.title}>
        <div className="kc-window-title">
          <span>{spec.title || 'KherveCAD'}</span>
        </div>
        <div className="kc-ask-body">{body}</div>
        <div className="kc-ask-buttons">{buttons}</div>
      </div>
    </div>
  )
}

/** A desktop dialog window, draggable, over the KherveCAD window. */
export function WindowFrame({ w, index, onClose }: { w: WindowNode; index: number; onClose: () => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (pos || !frame.current) return
    const parent = frame.current.parentElement?.getBoundingClientRect()
    const me = frame.current.getBoundingClientRect()
    if (!parent) return
    setPos({
      x: Math.max(8, (parent.width - me.width) / 2 + index * 24),
      y: Math.max(8, Math.min(80, (parent.height - me.height) / 3) + index * 24),
    })
  }, [pos, index])
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const start = { x: e.clientX, y: e.clientY, px: pos?.x ?? 0, py: pos?.y ?? 0 }
    const move = (ev: PointerEvent) => setPos({ x: start.px + ev.clientX - start.x, y: Math.max(0, start.py + ev.clientY - start.y) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('k-dragging')
    }
    document.body.classList.add('k-dragging')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const body = (
    <div
      ref={frame}
      className={`kc-window${w.modal ? ' modal' : ''}`}
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden', minWidth: 280 }}
      role="dialog"
      aria-label={w.title}
    >
      <div className="kc-window-title" onPointerDown={drag}>
        <span>{w.title}</span>
        <button type="button" className="kc-window-close" aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="kc-window-body">
        <QtNode n={w.node} />
      </div>
    </div>
  )
  if (w.modal) return <div className="kc-modal-backdrop">{body}</div>
  return body
}
