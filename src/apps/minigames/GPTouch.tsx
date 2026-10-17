// Kherve Grand Prix — controls for a touch screen (tablet, phone): the pedals
// bottom left (brake, throttle), the steering bottom right (one pad: the
// thumb on its left half steers left, on its right half right, and can slide
// across), the handbrake above it, and small buttons along the top for the
// view, DRS, the pit box, full screen and pause. Every button presses the
// same keys as the keyboard, so the tap-a-little / hold-for-more steering
// works the same. Several fingers at once are fine.

import { useEffect, useRef, useState } from 'react'

export interface TouchKeys {
  down(code: string): void
  up(code: string): void
}

/** Is this a touch device (tablet, phone)? A coarse pointer, or touch points without a mouse. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return coarse || (navigator.maxTouchPoints > 0 && !(window.matchMedia?.('(hover: hover)').matches ?? true))
}

/** Keep getting this finger's events even when it slides off (never fatal: some pointers cannot be captured). */
function capture(e: React.PointerEvent) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    // the finger is still followed while it stays on the control
  }
}

/** A button that holds a key while a finger is on it. */
function Hold({ code, keys, className, children, label }: { code: string; keys: TouchKeys; className: string; children: React.ReactNode; label: string }) {
  const [on, setOn] = useState(false)
  const fingers = useRef(new Set<number>())
  const press = (e: React.PointerEvent) => {
    e.preventDefault()
    capture(e)
    if (!fingers.current.size) keys.down(code)
    fingers.current.add(e.pointerId)
    setOn(true)
  }
  const release = (e: React.PointerEvent) => {
    if (!fingers.current.delete(e.pointerId)) return
    if (!fingers.current.size) {
      keys.up(code)
      setOn(false)
    }
  }
  useEffect(() => () => {
    if (fingers.current.size) keys.up(code)
  }, [code, keys])
  return (
    <button type="button" aria-label={label} className={`gp-t-btn ${className} ${on ? 'gp-t-on' : ''}`} onPointerDown={press} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
      {children}
    </button>
  )
}

/** A button that sends one key press (a tap). */
function Tap({ code, keys, className, children, label, onTap }: { code?: string; keys: TouchKeys; className: string; children: React.ReactNode; label: string; onTap?: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`gp-t-btn ${className}`}
      onPointerDown={(e) => {
        e.preventDefault()
        if (onTap) onTap()
        else if (code) {
          keys.down(code)
          keys.up(code)
        }
      }}
    >
      {children}
    </button>
  )
}

/** The steering pad: left half left, right half right; the thumb can slide from one side to the other. */
function Steer({ keys }: { keys: TouchKeys }) {
  const ref = useRef<HTMLDivElement>(null)
  const fingers = useRef(new Map<number, number>())
  const [dir, setDir] = useState(0)
  const cur = useRef(0)
  const apply = () => {
    let sum = 0
    for (const d of fingers.current.values()) sum += d
    const d = Math.sign(sum)
    if (d === cur.current) return
    if (cur.current < 0) keys.up('ArrowLeft')
    if (cur.current > 0) keys.up('ArrowRight')
    if (d < 0) keys.down('ArrowLeft')
    if (d > 0) keys.down('ArrowRight')
    cur.current = d
    setDir(d)
  }
  const side = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return e.clientX < r.left + r.width / 2 ? -1 : 1
  }
  const move = (e: React.PointerEvent) => {
    if (!fingers.current.has(e.pointerId)) return
    fingers.current.set(e.pointerId, side(e))
    apply()
  }
  const release = (e: React.PointerEvent) => {
    if (!fingers.current.delete(e.pointerId)) return
    apply()
  }
  useEffect(
    () => () => {
      if (cur.current < 0) keys.up('ArrowLeft')
      if (cur.current > 0) keys.up('ArrowRight')
    },
    [keys],
  )
  return (
    <div
      ref={ref}
      className="gp-t-steer"
      role="group"
      aria-label="Steering"
      onPointerDown={(e) => {
        e.preventDefault()
        capture(e)
        fingers.current.set(e.pointerId, side(e))
        apply()
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span className={`gp-t-arrow ${dir < 0 ? 'gp-t-on' : ''}`}>
        <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden>
          <path d="M15 4 L7 12 L15 20" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className={`gp-t-arrow ${dir > 0 ? 'gp-t-on' : ''}`}>
        <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden>
          <path d="M9 4 L17 12 L9 20" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  )
}

export function TouchControls({ keys, drs, onPause, onFullscreen, inGarage }: { keys: TouchKeys; drs: boolean; onPause: () => void; onFullscreen: () => void; inGarage: boolean }) {
  return (
    <div className="gp-touch" onContextMenu={(e) => e.preventDefault()}>
      <div className="gp-t-top">
        <Tap keys={keys} className="gp-t-small" label="Pause" onTap={onPause}>
          II
        </Tap>
        <Tap keys={keys} className="gp-t-small" label="Full screen" onTap={onFullscreen}>
          ⛶
        </Tap>
        <Tap keys={keys} code="KeyV" className="gp-t-small" label="Change view">
          View
        </Tap>
        <Tap keys={keys} code="KeyE" className={`gp-t-small ${drs ? 'gp-t-drs' : ''}`} label="DRS">
          DRS
        </Tap>
        <Tap keys={keys} code="KeyP" className="gp-t-small" label="Box this lap">
          Box
        </Tap>
      </div>
      <div className="gp-t-pedals">
        <Hold code="KeyZ" keys={keys} className="gp-t-brake" label="Brake">
          <span>BRAKE</span>
        </Hold>
        <Hold code="KeyX" keys={keys} className="gp-t-gas" label="Throttle">
          <span>{inGarage ? 'GO' : 'GAS'}</span>
        </Hold>
      </div>
      <div className="gp-t-right">
        <Hold code="Space" keys={keys} className="gp-t-hand" label="Handbrake (drift)">
          <span>DRIFT</span>
        </Hold>
        <Steer keys={keys} />
      </div>
    </div>
  )
}
