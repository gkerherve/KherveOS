// Two small in-app dialogs: a multi-line text box (the netlist) and the help with the shortcuts.

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { NETLIST_HELP, SHORTCUTS } from './ui.ts'

export function TextDialog({ title, hint, initial = '', okLabel, onSubmit, onCancel, extra }: {
  title: string
  hint?: string
  initial?: string
  okLabel: string
  onSubmit: (text: string) => void
  onCancel: () => void
  extra?: React.ReactNode
}) {
  const [text, setText] = useState(initial)
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ta.current?.focus() }, [])
  return (
    <div className="kb-modal" role="dialog" aria-label={title} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}>
      <div className="kb-dialog">
        <div className="kb-dialog-head"><b>{title}</b><button className="k-icon-btn" aria-label="Close" onClick={onCancel}><X size={14} /></button></div>
        {hint && <pre className="kb-dialog-hint k-muted">{hint}</pre>}
        <textarea ref={ta} className="k-input kb-dialog-text" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} placeholder="R1 10k R_0805 | VCC:1 OUT:2" />
        {extra}
        <div className="kb-btnrow kb-dialog-foot">
          <button className="k-btn" onClick={onCancel}>Cancel</button>
          <button className="k-btn primary" disabled={!text.trim()} onClick={() => onSubmit(text)}>{okLabel}</button>
        </div>
      </div>
    </div>
  )
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'keys' | 'netlist' | 'start'>('start')
  return (
    <div className="kb-modal" role="dialog" aria-label="kPCB help" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="kb-dialog kb-help">
        <div className="kb-dialog-head"><b>kPCB help</b><button className="k-icon-btn" aria-label="Close" onClick={onClose}><X size={14} /></button></div>
        <div className="kb-tabs">
          <button className={tab === 'start' ? 'on' : ''} onClick={() => setTab('start')}>Getting started</button>
          <button className={tab === 'keys' ? 'on' : ''} onClick={() => setTab('keys')}>Shortcuts</button>
          <button className={tab === 'netlist' ? 'on' : ''} onClick={() => setTab('netlist')}>Netlist formats</button>
        </div>
        <div className="kb-help-body">
          {tab === 'start' && (
            <ol className="kb-steps">
              <li><b>Outline.</b> Pick a preset (Arduino Uno shield, Nano, 50 x 50, Raspberry Pi HAT) in the Properties, or draw a rectangle or polygon on the Edge.Cuts layer. Add mounting holes.</li>
              <li><b>Parts and nets.</b> Send a design from kElec (it opens here), paste a text or KiCad netlist (Nets › Import netlist), or place parts from the Library and put their pads on nets by hand.</li>
              <li><b>Place.</b> Place › Place all parts lays the parts out in rows inside the board, keeping connected parts together. Then move, rotate (R) and flip (F) them.</li>
              <li><b>Route.</b> Press X and click a pad; click to place corners (⇧ switches 45° / 90°), V adds a via and changes layer, click a pad of the same net to finish. The track turns red when it is too close to other copper. Or use Route › Auto-route all.</li>
              <li><b>Zones.</b> Press Z to draw a copper zone, give it a net (usually GND) and press B to fill it.</li>
              <li><b>Check.</b> Inspect › Run the design-rule check, click a message to see where. Then File › Export › Gerber files.</li>
            </ol>
          )}
          {tab === 'keys' && (
            <table className="kb-keys"><tbody>{SHORTCUTS.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
          )}
          {tab === 'netlist' && <pre className="kb-netlist-help">{NETLIST_HELP}</pre>}
        </div>
      </div>
    </div>
  )
}
