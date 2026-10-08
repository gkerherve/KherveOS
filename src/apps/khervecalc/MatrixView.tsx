// The Matrix tab: a grid editor for matrices and vectors, stored as calculator
// variables (A…F), with the usual operations one click away.

import { useMemo, useState } from 'react'
import { ArrowDownToLine, Save } from 'lucide-react'
import { Tex } from './Tex'
import { shown } from './display'
import type { CalcSettings, HistoryEntry } from './session'
import type { VarInfo } from './CalcView'

interface Props {
  settings: CalcSettings
  vars: VarInfo[]
  evaluate: (src: string) => Promise<HistoryEntry | null>
  insertToCalc: (text: string) => void
  busy: boolean
}

const NAMES = ['A', 'B', 'C', 'D', 'F', 'G', 'M', 'v', 'b']

const OPS: { label: string; f: (n: string) => string; title?: string }[] = [
  { label: 'det', f: (n) => `det(${n})` },
  { label: 'A⁻¹', f: (n) => `inv(${n})`, title: 'Inverse' },
  { label: 'Aᵀ', f: (n) => `transpose(${n})`, title: 'Transpose' },
  { label: 'rank', f: (n) => `rank(${n})` },
  { label: 'trace', f: (n) => `trace(${n})` },
  { label: 'rref', f: (n) => `rref(${n})`, title: 'Reduced row echelon form' },
  { label: 'eigenvalues', f: (n) => `eigenvals(${n})` },
  { label: 'eigenvectors', f: (n) => `eig(${n})` },
  { label: 'LU', f: (n) => `lu(${n})` },
  { label: 'QR', f: (n) => `qr(${n})` },
  { label: 'SVD', f: (n) => `svd(${n})` },
  { label: 'Cholesky', f: (n) => `cholesky(${n})` },
  { label: 'norm', f: (n) => `norm(${n})` },
  { label: 'cond', f: (n) => `cond(${n})` },
  { label: 'null space', f: (n) => `nullspace(${n})` },
  { label: 'char. poly', f: (n) => `charpoly(${n})` },
  { label: 'exp(A)', f: (n) => `expm(${n})` },
  { label: 'A²', f: (n) => `${n}^2` },
]

/** "[[1, 2], [3, 4]]" (the engine's text of a matrix) -> cells. */
export function parseMatrixText(t: string): string[][] | null {
  const s = t.trim()
  if (!s.startsWith('[[') || !s.endsWith(']]')) return null
  const rows: string[][] = []
  let depth = 0
  let cur = ''
  let row: string[] = []
  for (const c of s.slice(1, -1)) {
    if (c === '[') {
      depth++
      if (depth === 1) {
        row = []
        cur = ''
        continue
      }
    }
    if (c === ']') {
      depth--
      if (depth === 0) {
        row.push(cur.trim())
        rows.push(row)
        cur = ''
        continue
      }
    }
    if (c === ',' && depth === 1) {
      row.push(cur.trim())
      cur = ''
      continue
    }
    if (depth >= 1) cur += c
  }
  return rows.length ? rows : null
}

export function matrixLiteral(cells: string[][]): string {
  return '[' + cells.map((r) => '[' + r.map((c) => c.trim() || '0').join(', ') + ']').join(', ') + ']'
}

export function MatrixView({ settings, vars, evaluate, insertToCalc, busy }: Props) {
  const [name, setName] = useState('A')
  const [cells, setCells] = useState<string[][]>([['1', '2'], ['3', '4']])
  const [expr, setExpr] = useState('A*B')
  const [last, setLast] = useState<HistoryEntry | null>(null)
  const rows = cells.length
  const cols = cells[0]?.length ?? 1
  const matrices = useMemo(() => vars.filter((v) => v.kind === 'var' && /= \[\[/.test(v.text)), [vars])

  const resize = (r: number, c: number) => {
    r = Math.max(1, Math.min(12, r))
    c = Math.max(1, Math.min(12, c))
    setCells(Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => cells[i]?.[j] ?? '0')))
  }
  const set = (i: number, j: number, v: string) => setCells(cells.map((row, a) => (a === i ? row.map((x, b) => (b === j ? v : x)) : row)))
  const lit = matrixLiteral(cells)
  const run = async (src: string) => setLast(await evaluate(src))
  const load = (v: VarInfo) => {
    const m = parseMatrixText(v.text.slice(v.text.indexOf('=') + 1))
    if (m) {
      setName(v.name)
      setCells(m)
    }
  }
  const sh = last ? shown(last.answer, settings) : null

  return (
    <div className="kc-matrix">
      <div className="kc-matrix-edit">
        <div className="kc-btnrow">
          <label className="kc-inline">
            Name
            <select className="k-input kc-small-select" value={name} onChange={(e) => setName(e.target.value)}>
              {[...new Set([...NAMES, ...matrices.map((m) => m.name)])].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <label className="kc-inline">
            Rows
            <input className="k-input kc-num" type="number" min={1} max={12} value={rows} onChange={(e) => resize(Number(e.target.value), cols)} />
          </label>
          <label className="kc-inline">
            Columns
            <input className="k-input kc-num" type="number" min={1} max={12} value={cols} onChange={(e) => resize(rows, Number(e.target.value))} />
          </label>
          <button className="k-btn small" onClick={() => setCells(cells.map((r, i) => r.map((_, j) => (i === j ? '1' : '0'))))}>Identity</button>
          <button className="k-btn small" onClick={() => setCells(cells.map((r) => r.map(() => '0')))}>Zero</button>
        </div>
        <div className="kc-mgrid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(52px, 90px))` }}>
          {cells.map((row, i) =>
            row.map((v, j) => (
              <input
                key={`${i}-${j}`}
                className="k-input kc-mcell"
                value={v}
                spellCheck={false}
                onChange={(e) => set(i, j, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const next = (e.currentTarget.parentElement?.children[(i * cols + j + 1) % (rows * cols)] as HTMLInputElement | undefined)
                    next?.focus()
                    next?.select()
                  }
                }}
              />
            )),
          )}
        </div>
        <div className="kc-btnrow">
          <button className="k-btn primary small" disabled={busy} onClick={() => void run(`${name} := ${lit}`)}><Save size={13} /> Store as {name}</button>
          <button className="k-btn small" onClick={() => insertToCalc(lit)}><ArrowDownToLine size={13} /> Insert in Calculate</button>
        </div>
        <div className="kc-panel-title">Operations on {name}</div>
        <div className="kc-ops">
          {OPS.map((o) => (
            <button key={o.label} className="k-btn small" disabled={busy} title={o.title ?? o.f(name)} onClick={() => void run(o.f(name))}>{o.label}</button>
          ))}
        </div>
        <div className="kc-panel-title">Expression</div>
        <div className="kc-btnrow">
          <input className="k-input kc-mono" value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void run(expr)} placeholder="A*B, A^-1*b, linsolve(A, b), cross(u, v)…" />
          <button className="k-btn small" disabled={busy} onClick={() => void run(expr)}>=</button>
        </div>
        {matrices.length > 0 && (
          <>
            <div className="kc-panel-title">Stored</div>
            <div className="kc-stored">
              {matrices.map((m) => (
                <button key={m.name} className="kc-stored-item" title="Edit" onClick={() => load(m)}>
                  <Tex tex={m.latex.length > 1500 ? `\\text{${m.name}}` : m.latex} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="kc-matrix-result">
        <div className="kc-panel-title">Result</div>
        {!last && <div className="k-muted kc-pad">Store a matrix, then pick an operation. Every result is also in the Calculate history (as ans).</div>}
        {last && (
          <div className="kc-mresult">
            <div className="k-muted kc-mono">{last.input}</div>
            {sh?.error ? <div className="kc-error">{sh.error}</div> : (
              <>
                {sh?.latex !== null && sh?.latex !== undefined ? <Tex tex={sh.latex} display /> : <pre className="kc-mono">{sh?.text}</pre>}
                {sh?.approxLatex && <Tex tex={`\\approx ${sh.approxLatex}`} display />}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
