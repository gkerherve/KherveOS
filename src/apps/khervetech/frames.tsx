// The desktop's wx frames as floating windows (TechFloat) and its custom dialogs
// (ModalFrame), drawn by WxUI. Used by TechApp.

import { useRef, useState } from 'react'
import './khervetech.css'
import '@/apps/khervefitting/khervefitting.css'
import { WxProvider, WxView, type WxMsg } from './WxUI'
import { WX } from './types'
import type { Arrays, ModalAnswer, ModalSpec, WxFrame, WxNode } from './types'

// ------------------------------------------------------------------ floating wx frames

/** A wx frame's widgets, drawn by WxUI; what they change goes back through `send`. */
export function FrameBody({ frame, arrays, pending, send }: { frame: WxFrame; arrays: Arrays; pending: Map<number, unknown>; send: (m: WxMsg) => void }) {
  const [, bump] = useState(0)
  const ctx = {
    arrays,
    pending,
    setPending: (id: number, v: unknown) => {
      pending.set(id, v)
      bump((n) => n + 1)
    },
    send,
  }
  return <WxProvider value={ctx}>{frame.sizer ? <WxView node={{ t: 'Panel', id: frame.id, sizer: frame.sizer }} /> : null}</WxProvider>
}

export function TechFloat({ frame, arrays, z, onFront, send, bounds, pending }: { frame: WxFrame; arrays: Arrays; z: number; onFront: () => void; send: (m: WxMsg) => void; bounds: { w: number; h: number }; pending: Map<number, unknown> }) {
  const w = Math.min(Math.max(frame.size[0] > 0 ? frame.size[0] : 480, 300), Math.max(320, bounds.w - 20))
  const h = Math.min(Math.max(frame.size[1] > 0 ? frame.size[1] : 560, 240), Math.max(240, bounds.h - 20))
  const [pos, setPos] = useState(() => ({ x: Math.max(0, Math.round((bounds.w - w) / 2)), y: Math.max(0, Math.round((bounds.h - h) / 3)) }))
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  // Maximised, the frame fills the app (the analysis windows have many tabs and plots).
  const [max, setMax] = useState(false)
  const box = max ? { left: 0, top: 0, width: bounds.w, height: bounds.h + 60 } : { left: pos.x, top: pos.y, width: w, height: h }
  return (
    <div className={`kf-float kt-float${max ? ' kt-float-max' : ''}`} style={{ ...box, zIndex: 20 + z }} onPointerDownCapture={onFront} onKeyDown={(e) => e.stopPropagation()} role="dialog" aria-label={frame.title}>
      <div
        className="kf-float-title"
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest('button')) setMax((m) => !m)
        }}
        onPointerDown={(e) => {
          if (max || (e.target as HTMLElement).closest('button')) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          setPos({ x: Math.max(-w + 80, Math.min(bounds.w - 60, e.clientX - drag.current.dx)), y: Math.max(0, Math.min(bounds.h - 28, e.clientY - drag.current.dy)) })
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <span>{frame.title}</span>
        <button type="button" className="kf-float-close kt-float-maxbtn" title={max ? 'Restore' : 'Maximise'} onClick={() => setMax((m) => !m)}>
          {max ? '❐' : '□'}
        </button>
        <button type="button" className="kf-float-close" title="Close" onClick={() => send({ id: frame.id!, type: 'close' })}>
          ✕
        </button>
      </div>
      <div className="kf-float-body kt-float-body">
        <FrameBody frame={frame} arrays={arrays} pending={pending} send={send} />
      </div>
    </div>
  )
}

/** A custom wx.Dialog reached by ShowModal: its widgets, OK / Cancel answer it. */
export function ModalFrame({ spec, arrays, done }: { spec: ModalSpec; arrays: Arrays; done: (a: ModalAnswer) => void }) {
  const pending = useRef(new Map<number, unknown>())
  const [, bump] = useState(0)
  const ids = spec.ids ?? []
  const finish = (id: number) => {
    const values: Record<string, unknown> = {}
    for (const [uid, v] of pending.current) {
      const i = ids.indexOf(uid)
      if (i >= 0) values[String(i)] = v
    }
    done({ id, values })
  }
  const ctx = {
    arrays,
    pending: pending.current,
    setPending: (id: number, v: unknown) => {
      pending.current.set(id, v)
      bump((n) => n + 1)
    },
    send: (m: WxMsg) => {
      if (m.type === 'button') finish(m.id === spec.frame?.id ? WX.ID_CANCEL : buttonId(spec.frame as unknown as WxNode, m.id))
    },
  }
  return (
    <div className="kt-modal-back">
      <div className="kf-float kt-float kt-modal" style={{ position: 'relative', width: Math.min(560, Math.max(320, spec.frame?.size[0] ?? 400)) }}>
        <div className="kf-float-title">
          <span>{spec.frame?.title ?? 'KherveFitting'}</span>
          <button type="button" className="kf-float-close" onClick={() => done({ id: WX.ID_CANCEL })}>
            ✕
          </button>
        </div>
        <div className="kf-float-body kt-float-body">
          <WxProvider value={ctx}>{spec.frame?.sizer ? <WxView node={{ t: 'Panel', sizer: spec.frame.sizer }} /> : null}</WxProvider>
        </div>
      </div>
    </div>
  )
}

function buttonId(frame: WxNode | undefined, uid: number): number {
  let label = ''
  const walk = (n: WxNode | null | undefined) => {
    if (!n) return
    if (n.id === uid && n.label) label = n.label
    n.items?.forEach((i) => walk(i.n))
    if (n.sizer) walk(n.sizer)
  }
  walk(frame)
  return ({ OK: WX.ID_OK, Cancel: WX.ID_CANCEL, Yes: WX.ID_YES, No: WX.ID_NO } as Record<string, number>)[label] ?? WX.ID_OK
}
