// The HDL tab: structural Verilog and VHDL of the circuit or of the state machine, with a test-bench stub; copy or save.

import { useMemo, useState } from 'react'
import { Copy, Download } from 'lucide-react'
import { fsmToVerilog, fsmToVhdl, fsmVerilogTestbench, fsmVhdlTestbench, toVerilog, toVhdl, verilogTestbench, vhdlTestbench, type Lang } from './hdl'
import type { Fsm } from './fsm'
import type { Doc } from './model'
import type { Step } from './file'

interface Props {
  doc: Doc
  fsm: Fsm
  name: string
  stimulus: Step[]
  until: number
  fsmSequence: string
  onSave(text: string, defaultName: string, ext: string): void
}

export function HdlTab({ doc, fsm, name, stimulus, until, fsmSequence, onSave }: Props) {
  const [lang, setLang] = useState<Lang>('verilog')
  const [source, setSource] = useState<'circuit' | 'fsm'>(doc.parts.length || !fsm.states.length ? 'circuit' : 'fsm')
  const [bench, setBench] = useState(false)
  const [copied, setCopied] = useState(false)
  const base = (source === 'fsm' ? fsm.name : name).trim() || 'circuit'
  const result = useMemo(() => {
    try {
      let text: string
      if (source === 'circuit') {
        if (doc.parts.length === 0) return { text: '', error: 'The circuit is empty: draw one, open an example, or implement a state machine as a circuit.' }
        text = lang === 'verilog' ? (bench ? verilogTestbench(doc, base, stimulus, until) : toVerilog(doc, base)) : (bench ? vhdlTestbench(doc, base, stimulus, until) : toVhdl(doc, base))
      } else {
        if (fsm.states.length === 0) return { text: '', error: 'The state machine has no states yet.' }
        text = lang === 'verilog' ? (bench ? fsmVerilogTestbench(fsm, fsmSequence, base) : fsmToVerilog(fsm, base)) : (bench ? fsmVhdlTestbench(fsm, fsmSequence, base) : fsmToVhdl(fsm, base))
      }
      return { text, error: null as string | null }
    } catch (e) { return { text: '', error: e instanceof Error ? e.message : String(e) } }
  }, [doc, fsm, lang, source, bench, base, stimulus, until, fsmSequence])
  const ext = lang === 'verilog' ? (bench ? '_tb.v' : '.v') : (bench ? '_tb.vhd' : '.vhd')
  return (
    <div className="dg-hdl">
      <div className="k-toolbar">
        <div className="dg-seg" role="tablist" aria-label="Language">
          <button role="tab" aria-selected={lang === 'verilog'} className={lang === 'verilog' ? 'on' : ''} onClick={() => setLang('verilog')}>Verilog</button>
          <button role="tab" aria-selected={lang === 'vhdl'} className={lang === 'vhdl' ? 'on' : ''} onClick={() => setLang('vhdl')}>VHDL</button>
        </div>
        <div className="dg-seg" role="tablist" aria-label="Source">
          <button role="tab" aria-selected={source === 'circuit'} className={source === 'circuit' ? 'on' : ''} onClick={() => setSource('circuit')}>Circuit</button>
          <button role="tab" aria-selected={source === 'fsm'} className={source === 'fsm' ? 'on' : ''} onClick={() => setSource('fsm')}>State machine</button>
        </div>
        <label className="dg-inline"><input type="checkbox" checked={bench} onChange={(e) => setBench(e.target.checked)} /> Test bench</label>
        <span className="k-spacer" />
        <button className="k-btn" disabled={!result.text} onClick={() => { void navigator.clipboard?.writeText(result.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }).catch(() => undefined) }}><Copy size={13} /> {copied ? 'Copied' : 'Copy'}</button>
        <button className="k-btn primary" disabled={!result.text} onClick={() => onSave(result.text, `${base.replace(/[^\w.+-]+/g, '_')}${ext}`, ext.slice(ext.lastIndexOf('.')))}><Download size={13} /> Save…</button>
      </div>
      {result.error ? <div className="dg-empty-note"><p>{result.error}</p></div> : <pre className="dg-code dg-mono" tabIndex={0} aria-label="Generated HDL">{result.text}</pre>}
    </div>
  )
}
