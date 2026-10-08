// The on-screen keypad: three layers like a real calculator (normal, SHIFT in
// green above the key, ALPHA in amber). An insert is text with "|" where the
// cursor goes. Pure data + one helper, checked by tools/tests.

export type KeyAction = 'shift' | 'alpha' | 'left' | 'right' | 'backspace' | 'clear' | 'clearAll' | 'exe' | 'approx' | 'up' | 'down'

export interface KeyFace {
  label: string
  insert?: string
  action?: KeyAction
  /** Tooltip. */
  title?: string
}

export interface KeyDef extends KeyFace {
  kind: 'num' | 'op' | 'fn' | 'ctl' | 'exe'
  shift?: KeyFace
  alpha?: KeyFace
}

const k = (kind: KeyDef['kind'], label: string, insert: string, shift?: KeyFace, alpha?: KeyFace, title?: string): KeyDef => ({
  kind, label, insert, shift, alpha, title,
})
const a = (label: string, insert = label): KeyFace => ({ label, insert })
const s = (label: string, insert: string, title?: string): KeyFace => ({ label, insert, title })

export const KEYPAD: KeyDef[][] = [
  [
    { kind: 'ctl', label: 'SHIFT', action: 'shift', title: 'Second functions (green)' },
    { kind: 'ctl', label: 'ALPHA', action: 'alpha', title: 'Letters (amber)' },
    { kind: 'ctl', label: '◀', action: 'left', shift: { label: '▲', action: 'up', title: 'Previous input' } },
    { kind: 'ctl', label: '▶', action: 'right', shift: { label: '▼', action: 'down', title: 'Next input' } },
    { kind: 'ctl', label: 'DEL', action: 'backspace', shift: { label: 'CLR', action: 'clear', title: 'Clear the line' } },
    { kind: 'ctl', label: 'AC', action: 'clear', shift: { label: 'CLR ALL', action: 'clearAll', title: 'Clear the history' } },
  ],
  [
    k('fn', 'x²', '^2', s('x³', '^3'), a('a'), 'Square'),
    k('fn', 'xʸ', '^', s('ʸ√x', 'root(|, )'), a('b'), 'Power'),
    k('fn', '√', 'sqrt(|)', s('∛', 'cbrt(|)'), a('c'), 'Square root'),
    k('fn', 'x⁻¹', '^(-1)', s('x!', '!'), a('d'), 'Inverse'),
    k('fn', 'log', 'log(|)', s('10ˣ', '10^(|)'), a('f'), 'Base-10 logarithm'),
    k('fn', 'ln', 'ln(|)', s('eˣ', 'e^(|)'), a('g'), 'Natural logarithm'),
  ],
  [
    k('fn', 'sin', 'sin(|)', s('sin⁻¹', 'asin(|)'), a('h')),
    k('fn', 'cos', 'cos(|)', s('cos⁻¹', 'acos(|)'), a('j')),
    k('fn', 'tan', 'tan(|)', s('tan⁻¹', 'atan(|)'), a('k')),
    k('fn', 'hyp', 'sinh(|)', s('cosh', 'cosh(|)'), a('l'), 'Hyperbolic sine'),
    k('op', '(', '(', s('[', '['), a('m')),
    k('op', ')', ')', s(']', ']'), a('n')),
  ],
  [
    k('fn', 'd/dx', 'diff(|, x)', s('d/dx|ₐ', 'nderiv(|, x, )'), a('o'), 'Derivative'),
    k('fn', '∫', 'integrate(|, x)', s('∫ₐᵇ', 'integrate(|, x, , )'), a('p'), 'Integral'),
    k('fn', 'Σ', 'sum(|, k, 1, n)', s('Π', 'product(|, k, 1, n)'), a('q'), 'Sum'),
    k('fn', 'lim', 'limit(|, x, 0)', s('series', 'series(|, x, 0, 6)'), a('r'), 'Limit'),
    k('fn', 'solve', 'solve(|, x)', s('nsolve', 'nsolve(|, x, 0)'), a('s'), 'Solve an equation'),
    k('op', '=', '=', s(':=', ' := '), a('u'), 'Equation (SHIFT: define)'),
  ],
  [
    k('num', '7', '7', s('∞', 'oo'), a('v')),
    k('num', '8', '8', s('°', '°'), a('w')),
    k('num', '9', '9', s('nCr', 'nCr(|, )'), a('z')),
    k('op', '÷', '/', s('mod', 'mod(|, )'), a('α', 'alpha')),
    k('fn', 'π', 'pi', s('e', 'e'), a('β', 'β')),
    k('fn', 'i', 'i', s('∠', '∠'), a('θ', 'θ'), 'Imaginary unit (SHIFT: polar ∠)'),
  ],
  [
    k('num', '4', '4', s('abs', 'abs(|)'), a('A')),
    k('num', '5', '5', s('round', 'round(|, 2)'), a('B')),
    k('num', '6', '6', s('gcd', 'gcd(|, )'), a('C')),
    k('op', '×', '*', s('·', '*'), a('λ', 'λ')),
    k('fn', 'x', 'x', s('t', 't'), a('X')),
    k('fn', 'y', 'y', s('z', 'z'), a('Y')),
  ],
  [
    k('num', '1', '1', s('det', 'det(|)'), a('D')),
    k('num', '2', '2', s('inv', 'inv(|)'), a('E')),
    k('num', '3', '3', s('[[ ]]', '[[|, ], [, ]]'), a('F')),
    k('op', '−', '-', s('▶', ' ▶ _'), a('μ', 'μ')),
    k('fn', ',', ', ', s(';', ', '), a('σ', 'σ')),
    k('fn', 'unit', '_', s('const', '#'), a('ω', 'ω'), 'Unit (_m) — SHIFT: constant (#c)'),
  ],
  [
    k('num', '0', '0', s('ans', 'ans'), a('ans2', 'ans2')),
    k('num', '.', '.', s('→', ' → '), a('_', '_')),
    k('num', '×10ⁿ', 'e', s('%', '/100'), a('E', 'E'), 'Times ten to the power'),
    k('op', '+', '+', s('±', '-'), a('f(x)', 'f(x) := ')),
    { kind: 'fn', label: 'ans', insert: 'ans', shift: { label: 'Ans²', insert: 'ans2' }, alpha: { label: 'ans3', insert: 'ans3' } },
    { kind: 'exe', label: 'EXE', action: 'exe', title: 'Calculate (Enter)', shift: { label: '≈', action: 'approx', title: 'Decimal value (Ctrl+Enter)' } },
  ],
]

/** Put an insert into the line at the cursor (or around the selection). Returns the new text and cursor. */
export function applyInsert(text: string, start: number, end: number, insert: string): { text: string; cursor: number } {
  const bar = insert.indexOf('|')
  const selected = text.slice(start, end)
  if (bar < 0) {
    const t = text.slice(0, start) + insert + text.slice(end)
    return { text: t, cursor: start + insert.length }
  }
  const before = insert.slice(0, bar)
  const after = insert.slice(bar + 1)
  const t = text.slice(0, start) + before + selected + after + text.slice(end)
  return { text: t, cursor: start + before.length + selected.length }
}
