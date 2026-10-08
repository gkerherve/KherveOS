// The Base tab: integers in HEX/DEC/OCT/BIN with a word size, bitwise
// operations and a clickable bit grid. Instant (BigInt, no Python).

import { useMemo, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { ProgError, bitsOf, progEval, progFormat, toggleBit, type Base, type WordSize } from './programmer'
import type { CalcSettings } from './session'

interface Props {
  settings: CalcSettings
  setSettings: (p: Partial<CalcSettings>) => void
}

const BASES: { b: Base; label: string }[] = [
  { b: 16, label: 'HEX' },
  { b: 10, label: 'DEC' },
  { b: 8, label: 'OCT' },
  { b: 2, label: 'BIN' },
]

const KEYS: { label: string; ins: string; title?: string; hexOnly?: boolean }[] = [
  ...['A', 'B', 'C', 'D', 'E', 'F'].map((d) => ({ label: d, ins: d, hexOnly: true })),
  { label: 'AND', ins: ' and ' }, { label: 'OR', ins: ' or ' }, { label: 'XOR', ins: ' xor ' }, { label: 'NOT', ins: 'not ' },
  { label: 'NAND', ins: ' nand ' }, { label: 'NOR', ins: ' nor ' }, { label: '<<', ins: ' << ' }, { label: '>>', ins: ' >> ', title: 'Arithmetic shift right' },
  { label: '>>>', ins: ' >>> ', title: 'Logical shift right' }, { label: 'ROL', ins: ' rol ' }, { label: 'ROR', ins: ' ror ' }, { label: 'MOD', ins: ' mod ' },
  { label: 'popcount', ins: 'popcount(' }, { label: '(', ins: '(' }, { label: ')', ins: ')' }, { label: 'ans', ins: 'ans' },
]

const copy = (t: string) => void navigator.clipboard?.writeText(t).catch(() => {})

export function ProgrammerView({ settings, setSettings }: Props) {
  const [line, setLine] = useState('')
  const [value, setValue] = useState<bigint>(0n)
  const [log, setLog] = useState<{ input: string; value: bigint; base: Base }[]>([])
  const input = useRef<HTMLInputElement>(null)
  const o = { base: settings.base, bits: settings.bits, signed: settings.signed }

  const live = useMemo(() => {
    if (!line.trim()) return null
    try {
      return { v: progEval(line, o, { ans: value }) }
    } catch (e) {
      return { error: e instanceof ProgError ? e.message : String(e) }
    }
  }, [line, settings.base, settings.bits, settings.signed, value])

  const run = () => {
    if (!live || !('v' in live) || live.v === undefined) return
    setValue(live.v)
    setLog([...log.slice(-200), { input: line, value: live.v, base: settings.base }])
    setLine('')
  }
  const insert = (t: string) => {
    const el = input.current
    const s = el?.selectionStart ?? line.length
    const e = el?.selectionEnd ?? line.length
    const next = line.slice(0, s) + t + line.slice(e)
    setLine(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(s + t.length, s + t.length)
    })
  }
  const shownValue = live && 'v' in live && live.v !== undefined ? live.v : value
  const bits = bitsOf(shownValue, settings.bits)

  return (
    <div className="kc-prog">
      <div className="kc-btnrow">
        <div className="kc-seg">
          {BASES.map((b) => (
            <button key={b.b} className={settings.base === b.b ? 'active' : ''} onClick={() => setSettings({ base: b.b })}>{b.label}</button>
          ))}
        </div>
        <div className="kc-seg">
          {([8, 16, 32, 64] as WordSize[]).map((w) => (
            <button key={w} className={settings.bits === w ? 'active' : ''} onClick={() => setSettings({ bits: w })}>{w}-bit</button>
          ))}
        </div>
        <div className="kc-seg">
          <button className={settings.signed ? 'active' : ''} onClick={() => setSettings({ signed: true })}>signed</button>
          <button className={!settings.signed ? 'active' : ''} onClick={() => setSettings({ signed: false })}>unsigned</button>
        </div>
      </div>
      <div className="kc-prog-values">
        {BASES.map((b) => (
          <div key={b.b} className={`kc-prog-row${settings.base === b.b ? ' current' : ''}`} onClick={() => setSettings({ base: b.b })}>
            <span className="kc-prog-base">{b.label}</span>
            <span className="kc-mono kc-prog-num">{progFormat(shownValue, b.b, settings.bits, settings.signed, true)}</span>
            <button className="k-icon-btn" title="Copy" onClick={(e) => { e.stopPropagation(); copy(progFormat(shownValue, b.b, settings.bits, settings.signed)) }}><Copy size={13} /></button>
          </div>
        ))}
      </div>
      <div className="kc-bits" style={{ gridTemplateColumns: `repeat(${Math.min(32, settings.bits)}, 1fr)` }}>
        {bits.map((bit, i) => {
          const pos = settings.bits - 1 - i
          return (
            <button
              key={i}
              className={`kc-bit${bit ? ' on' : ''}${pos % 4 === 3 ? ' nib' : ''}`}
              title={`bit ${pos}`}
              onClick={() => {
                const v = toggleBit(shownValue, pos, o)
                setValue(v)
                setLine('')
              }}
            >
              <span>{bit}</span>
              {pos % 4 === 0 && <small>{pos}</small>}
            </button>
          )
        })}
      </div>
      <div className="kc-line">
        <input
          ref={input}
          className="kc-input"
          value={line}
          spellCheck={false}
          placeholder={settings.base === 16 ? 'FF and 0x0F << 2' : settings.base === 2 ? '1010 xor 0110' : '255 and 15 << 2'}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run()
            if (e.key === 'ArrowUp' && log.length) setLine(log[log.length - 1].input)
            if (e.key === 'Escape') setLine('')
          }}
        />
      </div>
      <div className={`kc-prog-live${live && 'error' in live ? ' error' : ''}`}>{live ? ('error' in live ? live.error : `= ${progFormat(live.v!, settings.base, settings.bits, settings.signed)}`) : ' '}</div>
      <div className="kc-prog-keys">
        {KEYS.map((k) => (
          <button key={k.label} className="kc-key kind-fn" disabled={k.hexOnly && settings.base !== 16} title={k.title ?? k.ins.trim()} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(k.ins)}>
            <span className="kc-key-main">{k.label}</span>
          </button>
        ))}
      </div>
      <div className="kc-prog-log">
        {log.slice().reverse().map((l, i) => (
          <div key={i} className="kc-prog-logrow" onClick={() => setLine(l.input)}>
            <span className="kc-mono">{l.input}</span>
            <span className="kc-mono">= {progFormat(l.value, settings.base, settings.bits, settings.signed)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
