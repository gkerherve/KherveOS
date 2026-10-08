// The SPICE netlist tab: type or paste a netlist and simulate it without a drawing, or generate the text from
// the schematic and send it back as a schematic.

import { ArrowDownToLine, ArrowUpFromLine, FileText, Play } from 'lucide-react'
import { CodeEditor } from '@/os/ui/CodeEditor'

interface Props {
  text: string
  message: { level: 'error' | 'ok' | 'info'; text: string } | null
  running: boolean
  onText(t: string): void
  onFromSchematic(): void
  onToSchematic(): void
  onRun(): void
  onExport(): void
}

const SAMPLE = `Low-pass filter
V1 in 0 AC 1 PULSE(0 5 0 1n 1n 5m 10m)
R1 in out 1k
C1 out 0 1u
.ac dec 20 10 100k
.tran 20u 10m
.end
`

export function NetlistTab({ text, message, running, onText, onFromSchematic, onToSchematic, onRun, onExport }: Props) {
  return (
    <div className="ke-netlist">
      <div className="k-toolbar ke-subbar">
        <button className="k-btn" onClick={onFromSchematic} title="Write the schematic as SPICE text"><ArrowDownToLine size={13} /> From schematic</button>
        <button className="k-btn" onClick={onToSchematic} title="Draw this netlist as a schematic"><ArrowUpFromLine size={13} /> To schematic</button>
        <button className="k-btn" onClick={onExport} title="Save as a .cir file"><FileText size={13} /> Save .cir</button>
        <span className="k-spacer" />
        {!text.trim() && <button className="k-btn" onClick={() => onText(SAMPLE)}>Insert a sample</button>}
        <button className="k-btn primary" disabled={running} onClick={onRun} title="Simulate this text (⌘R)"><Play size={13} /> Simulate</button>
      </div>
      <div className="ke-netlist-edit">
        <CodeEditor value={text} onChange={onText} language="plain" lineNumbers placeholder={'* Type a SPICE netlist, e.g.\nV1 in 0 5\nR1 in out 1k\nR2 out 0 3k\n.op'} />
      </div>
      <div className={`ke-netlist-msg ${message?.level ?? 'info'}`} role="status">
        {message?.text ?? 'R C L V I D Q M E G K, switches (S1 a b ON), op-amps (X1 in+ in- out OPAMP) and gates are supported. Lines .op .dc .ac .tran .model .param are read. Engineering suffixes: 4.7k 1meg 10u 2.2n.'}
      </div>
    </div>
  )
}
