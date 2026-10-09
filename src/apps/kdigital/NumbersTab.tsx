// The Numbers tab: an integer in every representation (binary, octal, decimal, hex, two's complement,
// sign-magnitude, one's complement, Gray, BCD), fixed point, IEEE-754 half / single / double with editable bit
// fields, binary add / subtract / multiply / divide with the working and the flags, and the ASCII table.

import { useMemo, useState } from 'react'
import * as N from './numbers'
import type { NumbersState } from './file'

interface Props {
  state: NumbersState
  onState(patch: Partial<NumbersState>): void
}

const BITS = [4, 8, 12, 16, 24, 32, 64]

function Bits({ bits, onFlip, groups }: { bits: string; onFlip?(i: number): void; groups?: { from: number; to: number; cls: string; label: string }[] }) {
  return (
    <span className="dg-bits" role="group" aria-label="Bits">
      {bits.split('').map((b, i) => {
        const g = groups?.find((x) => i >= x.from && i < x.to)
        return (
          <button key={i} className={`dg-bit b${b}${g ? ` ${g.cls}` : ''}${(i + 1) % 4 === 0 && i < bits.length - 1 && !groups ? ' gap' : ''}`} disabled={!onFlip} onClick={() => onFlip?.(i)} title={g ? `${g.label}, bit ${bits.length - 1 - i}` : `bit ${bits.length - 1 - i}`} aria-label={`bit ${bits.length - 1 - i} is ${b}`}>{b}</button>
        )
      })}
    </span>
  )
}

export function NumbersTab({ state, onState }: Props) {
  const base = state.base as N.Base
  const parsed = N.parseInteger(state.value, base)
  const bits = state.bits
  const rep = parsed !== null ? N.representations(parsed, bits) : null
  const [sub, setSub] = useState<'int' | 'float' | 'arith' | 'ascii'>('int')

  return (
    <div className="dg-num">
      <div className="dg-seg dg-num-tabs" role="tablist">
        {([['int', 'Integers'], ['float', 'Fixed and floating point'], ['arith', 'Arithmetic'], ['ascii', 'ASCII']] as const).map(([id, l]) => <button key={id} role="tab" aria-selected={sub === id} className={sub === id ? 'on' : ''} onClick={() => setSub(id)}>{l}</button>)}
      </div>
      {sub === 'int' && (
        <section className="dg-card">
          <div className="dg-num-row">
            <label className="dg-field"><span>Number</span><input className="k-input dg-mono" value={state.value} aria-label="Number" onChange={(e) => onState({ value: e.target.value })} /></label>
            <label className="dg-field"><span>Written in</span>
              <select className="k-input" value={state.base} onChange={(e) => onState({ base: Number(e.target.value) })}>{[[2, 'binary'], [8, 'octal'], [10, 'decimal'], [16, 'hexadecimal']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label className="dg-field"><span>Width</span>
              <select className="k-input" value={bits} onChange={(e) => onState({ bits: Number(e.target.value) })}>{[...new Set([...BITS, bits])].sort((a, b) => a - b).map((b) => <option key={b} value={b}>{b} bits</option>)}</select>
            </label>
          </div>
          {parsed === null ? <p className="dg-error">“{state.value}” is not a valid {['', '', 'binary', '', '', '', '', '', 'octal', '', 'decimal', '', '', '', '', '', 'hexadecimal'][base] || ''} number. Prefixes 0b, 0o and 0x are understood.</p> : rep && (
            <>
              <div className="dg-bit-row">
                <span className="k-muted">Bit pattern (click a bit to flip it)</span>
                <Bits bits={N.bitString(parsed, bits)} onFlip={(i) => {
                  const s = N.bitString(parsed, bits).split('')
                  s[i] = s[i] === '1' ? '0' : '1'
                  const u = BigInt('0b' + s.join(''))
                  const v = parsed < 0n || (parsed === 0n && false) ? N.fromTwos(s.join('')) : u
                  onState({ value: N.toBase(parsed < 0n ? v : u, base) })
                }} />
              </div>
              <table className="dg-kv">
                <tbody>
                  <Row k="Binary" v={parsed >= 0n ? N.toBase(parsed, 2) : '−' + N.toBase(-parsed, 2)} />
                  <Row k="Octal" v={N.toBase(parsed, 8)} />
                  <Row k="Decimal" v={rep.decimal} />
                  <Row k="Hexadecimal" v={parsed >= 0n ? parsed.toString(16).toUpperCase() : '−' + (-parsed).toString(16).toUpperCase()} />
                  <Row k={`Unsigned ${bits} bits`} v={rep.unsigned} note={rep.fits.unsigned ? '' : `does not fit (0 … ${N.maxUnsigned(bits)})`} />
                  <Row k="Two's complement" v={rep.twos} note={rep.twos ? `range ${N.minSigned(bits)} … ${N.maxSigned(bits)}` : `does not fit (${N.minSigned(bits)} … ${N.maxSigned(bits)})`} />
                  <Row k="Sign-magnitude" v={rep.signMag} />
                  <Row k="One's complement" v={rep.ones} />
                  <Row k="Gray code" v={rep.gray} note={rep.gray ? '' : 'needs a non-negative number that fits'} />
                  <Row k="Packed BCD" v={rep.bcd} note={rep.bcd ? '' : 'needs a non-negative number'} />
                  <Row k={`As ${bits} bits (hex)`} v={rep.hex} note="the bit pattern, whatever the sign" />
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
      {sub === 'float' && <FloatSection />}
      {sub === 'arith' && <ArithSection bits={bits} base={base} onBits={(b) => onState({ bits: b })} />}
      {sub === 'ascii' && <AsciiSection />}
    </div>
  )
}

function Row({ k, v, note }: { k: string; v: string | null; note?: string }) {
  return <tr><th>{k}</th><td className="dg-mono">{v ?? '—'}</td><td className="k-muted dg-small">{note}</td></tr>
}

// ------------------------------------------------------------------------------ fixed and floating point

function FloatSection() {
  const [fmt, setFmt] = useState<'half' | 'single' | 'double'>('single')
  const f = N.FORMATS[fmt]
  const [text, setText] = useState('-118.625')
  const [bits, setBits] = useState(() => N.encodeFloat(-118.625, N.FORMATS.single))
  const [qm, setQm] = useState(4)
  const [qn, setQn] = useState(4)
  const [signed, setSigned] = useState(false)
  const [fx, setFx] = useState('3.14159')

  const setValue = (t: string, format = fmt) => {
    setText(t)
    const x = t.trim().toLowerCase() === 'nan' ? NaN : /^[-+]?inf(inity)?$/i.test(t.trim()) ? (t.trim().startsWith('-') ? -Infinity : Infinity) : Number(t)
    if (t.trim() !== '' && (Number.isNaN(x) ? /nan/i.test(t) : true)) setBits(N.encodeFloat(x, N.FORMATS[format]))
  }
  const changeFormat = (nf: 'half' | 'single' | 'double') => {
    const v = N.decodeFloat(bits, f).value
    setFmt(nf)
    setBits(N.encodeFloat(v, N.FORMATS[nf]))
  }
  const d = N.decodeFloat(bits, f)
  const flip = (i: number) => { const s = bits.split(''); s[i] = s[i] === '1' ? '0' : '1'; const nb = s.join(''); setBits(nb); const dd = N.decodeFloat(nb, f); setText(Number.isNaN(dd.value) ? 'NaN' : String(dd.value)) }
  const hex = BigInt('0b' + bits).toString(16).toUpperCase().padStart(N.formatWidth(f) / 4, '0')
  const step = (delta: bigint) => {
    const v = BigInt('0b' + bits) + delta
    const max = (1n << BigInt(N.formatWidth(f))) - 1n
    if (v < 0n || v > max) return
    const nb = v.toString(2).padStart(N.formatWidth(f), '0')
    setBits(nb); const dd = N.decodeFloat(nb, f); setText(Number.isNaN(dd.value) ? 'NaN' : String(dd.value))
  }
  const xnum = Number(fx)
  const fixed = Number.isFinite(xnum) && qm + qn > 0 && qm + qn <= 52 ? N.toFixed(xnum, qm, qn, signed) : null

  return (
    <>
      <section className="dg-card">
        <h4>IEEE-754</h4>
        <div className="dg-num-row">
          <label className="dg-field"><span>Format</span><select className="k-input" value={fmt} onChange={(e) => changeFormat(e.target.value as 'half' | 'single' | 'double')}>{(Object.keys(N.FORMATS) as ('half' | 'single' | 'double')[]).map((k) => <option key={k} value={k}>{N.FORMATS[k].name}</option>)}</select></label>
          <label className="dg-field"><span>Value</span><input className="k-input dg-mono" value={text} aria-label="Floating-point value" onChange={(e) => setValue(e.target.value)} /></label>
        </div>
        <div className="dg-bit-row">
          <span className="k-muted">Bit fields: sign · exponent ({f.expBits}) · fraction ({f.fracBits}). Click a bit to flip it.</span>
          <Bits bits={bits} onFlip={flip} groups={[{ from: 0, to: 1, cls: 'sign', label: 'sign' }, { from: 1, to: 1 + f.expBits, cls: 'exp', label: 'exponent' }, { from: 1 + f.expBits, to: bits.length, cls: 'frac', label: 'fraction' }]} />
        </div>
        <table className="dg-kv">
          <tbody>
            <Row k="Class" v={d.cls} />
            <Row k="Sign" v={d.sign === '1' ? '1 (negative)' : '0 (positive)'} />
            <Row k="Exponent" v={`${d.exponent} = ${parseInt(d.exponent, 2)}`} note={d.cls === 'normal' ? `− bias ${f.bias} = ${d.exp}` : d.cls === 'subnormal' || d.cls === 'zero' ? `subnormal: 2^${1 - f.bias}` : ''} />
            <Row k="Fraction" v={d.fraction} note={d.cls === 'normal' ? 'with an implicit leading 1' : ''} />
            <Row k="Value" v={Number.isNaN(d.value) ? 'NaN' : String(d.value)} />
            <Row k="Exact value" v={d.exact} />
            <Row k="Hex" v={`0x${hex}`} />
          </tbody>
        </table>
        <div className="dg-actions">
          <button className="k-btn" onClick={() => step(-1n)}>Previous pattern</button>
          <button className="k-btn" onClick={() => step(1n)}>Next pattern</button>
        </div>
      </section>
      <section className="dg-card">
        <h4>Fixed point (Qm.n)</h4>
        <div className="dg-num-row">
          <label className="dg-field"><span>Integer bits m</span><input className="k-input" type="number" min={0} max={40} value={qm} onChange={(e) => setQm(Math.max(0, Math.min(40, Math.round(Number(e.target.value) || 0))))} /></label>
          <label className="dg-field"><span>Fraction bits n</span><input className="k-input" type="number" min={0} max={40} value={qn} onChange={(e) => setQn(Math.max(0, Math.min(40, Math.round(Number(e.target.value) || 0))))} /></label>
          <label className="dg-field"><span>Value</span><input className="k-input dg-mono" value={fx} onChange={(e) => setFx(e.target.value)} /></label>
        </div>
        <label className="dg-check"><input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} /> Signed (two&apos;s complement; m includes the sign bit)</label>
        {fixed ? (
          <table className="dg-kv"><tbody>
            <Row k="Bits" v={`${fixed.bits.slice(0, qm)}${qn ? '.' : ''}${fixed.bits.slice(qm)}`} />
            <Row k="Stored value" v={String(fixed.value)} note={fixed.overflow ? 'out of range: saturated' : ''} />
            <Row k="Error" v={String(fixed.error)} note={`resolution 2^−${qn} = ${2 ** -qn}`} />
          </tbody></table>
        ) : <p className="dg-error dg-small">Enter a number and a width of 1 to 52 bits.</p>}
      </section>
    </>
  )
}

// ------------------------------------------------------------------------------ arithmetic

function ArithSection({ bits, base, onBits }: { bits: number; base: N.Base; onBits(b: number): void }) {
  const [a, setA] = useState('100')
  const [b, setB] = useState('50')
  const [op, setOp] = useState<'+' | '-' | '*' | '/'>('+')
  const w = Math.min(bits, 32)
  const A = N.parseInteger(a, base)
  const B = N.parseInteger(b, base)
  const result = useMemo(() => {
    if (A === null || B === null) return null
    try {
      if (op === '+') return { kind: 'add' as const, r: N.addBits(A, B, w) }
      if (op === '-') return { kind: 'sub' as const, r: N.subBits(A, B, w) }
      if (op === '*') return { kind: 'mul' as const, r: N.mulBits(A, B, w) }
      return { kind: 'div' as const, r: N.divBits(A, B, w) }
    } catch (e) { return { kind: 'error' as const, r: e instanceof Error ? e.message : String(e) } }
  }, [A, B, op, w])
  return (
    <section className="dg-card">
      <h4>Binary arithmetic with the working</h4>
      <div className="dg-num-row">
        <label className="dg-field"><span>A</span><input className="k-input dg-mono" value={a} onChange={(e) => setA(e.target.value)} aria-label="Operand A" /></label>
        <label className="dg-field"><span>Operation</span><select className="k-input" value={op} onChange={(e) => setOp(e.target.value as typeof op)}><option value="+">A + B</option><option value="-">A − B</option><option value="*">A × B</option><option value="/">A ÷ B (unsigned)</option></select></label>
        <label className="dg-field"><span>B</span><input className="k-input dg-mono" value={b} onChange={(e) => setB(e.target.value)} aria-label="Operand B" /></label>
        <label className="dg-field"><span>Width</span><select className="k-input" value={w} onChange={(e) => onBits(Number(e.target.value))}>{[4, 8, 12, 16, 32].map((x) => <option key={x} value={x}>{x} bits</option>)}</select></label>
      </div>
      <p className="k-muted dg-small">Numbers are in the base chosen on the Integers tab; negative numbers use two&apos;s complement; the width is at most 32 here.</p>
      {(A === null || B === null) && <p className="dg-error">Enter two valid numbers.</p>}
      {result?.kind === 'error' && <p className="dg-error">{result.r as string}</p>}
      {result && (result.kind === 'add' || result.kind === 'sub') && (() => {
        const r = result.r
        return (
          <>
            <pre className="dg-work dg-mono">{[
              `carry   ${r.carries.slice().reverse().map(String).join('')}`,
              `   A    ${r.a}`,
              result.kind === 'add' ? `+  B    ${r.b}` : `−  B    ${(r as ReturnType<typeof N.subBits>).notB}  (¬B, then + 1)`,
              `  sum   ${r.sum}`,
            ].join('\n')}</pre>
            <div className="dg-flags">{(['Z', 'N', 'C', 'V'] as const).map((k) => <span key={k} className={`dg-flag-chip${r.flags[k] ? ' on' : ''}`} title={{ Z: 'zero', N: 'negative', C: result.kind === 'sub' ? 'no borrow' : 'carry out', V: 'signed overflow' }[k]}>{k}={r.flags[k] ? 1 : 0}</span>)}</div>
            <table className="dg-kv"><tbody>
              <Row k="Unsigned" v={`${r.unsigned.a} ${result.kind === 'add' ? '+' : '−'} ${r.unsigned.b} = ${r.unsigned.result}`} note={r.unsigned.overflow ? (result.kind === 'add' ? 'overflow (carry out)' : 'borrow: A < B') : 'fits'} />
              <Row k="Signed" v={`${r.signed.a} ${result.kind === 'add' ? '+' : '−'} ${r.signed.b} = ${r.signed.result}`} note={r.signed.overflow ? 'signed overflow: the result is wrong' : 'fits'} />
            </tbody></table>
          </>
        )
      })()}
      {result?.kind === 'mul' && (
        <>
          <pre className="dg-work dg-mono">{[`   A    ${result.r.a}`, `×  B    ${result.r.b}`, ...result.r.partials.map((p) => `bit ${p.shift} (${p.bit}) ${p.row}`), `product ${result.r.product}`].join('\n')}</pre>
          <table className="dg-kv"><tbody><Row k="Unsigned" v={result.r.unsigned.toString()} /><Row k="Signed" v={result.r.signed.toString()} /></tbody></table>
        </>
      )}
      {result?.kind === 'div' && (
        <>
          <table className="dg-fsm-table"><thead><tr><th>Step</th><th>Remainder</th><th>Bring down</th><th>R − B</th><th>q</th></tr></thead>
            <tbody>{result.r.steps.map((s) => <tr key={s.step}><td>{s.step}</td><td className="dg-mono">{s.remainder}</td><td>{s.bringDown}</td><td className="dg-mono">{s.subtracted ? s.trial : `${s.trial} (negative: restore)`}</td><td>{s.quotientBit}</td></tr>)}</tbody></table>
          <table className="dg-kv"><tbody><Row k="Quotient" v={`${result.r.quotient} = ${BigInt('0b' + result.r.quotient)}`} /><Row k="Remainder" v={`${result.r.remainder} = ${BigInt('0b' + result.r.remainder)}`} /></tbody></table>
        </>
      )}
    </section>
  )
}

// ------------------------------------------------------------------------------ ASCII

function AsciiSection() {
  const [q, setQ] = useState('')
  const rows = useMemo(() => N.asciiTable(), [])
  const t = q.trim().toLowerCase()
  const shown = t ? rows.filter((r) => r.char.toLowerCase() === t || r.name.toLowerCase().includes(t) || r.dec === t || r.hex.toLowerCase() === t || r.bin === t) : rows
  return (
    <section className="dg-card">
      <h4>ASCII table</h4>
      <input className="k-input" value={q} placeholder="Find a character, name, code (65, 41, 1000001)…" aria-label="Search the ASCII table" onChange={(e) => setQ(e.target.value)} />
      <div className="dg-ascii">
        <table className="dg-fsm-table">
          <thead><tr><th>Char</th><th>Dec</th><th>Hex</th><th>Oct</th><th>Binary</th><th /></tr></thead>
          <tbody>{shown.map((r) => <tr key={r.code} className={r.control ? 'ctrl' : ''}><td className="dg-mono">{r.char}</td><td>{r.dec}</td><td className="dg-mono">{r.hex}</td><td className="dg-mono">{r.oct}</td><td className="dg-mono">{r.bin}</td><td className="k-muted dg-small">{r.name}</td></tr>)}</tbody>
        </table>
        {shown.length === 0 && <p className="k-muted">Nothing matches.</p>}
      </div>
    </section>
  )
}
