// AI tools of KherveCalc (the scientific calculator). ≤ 6 arguments each.
// The code is in src/apps/khervecalc/aiTools.ts.

import type { AppToolSet } from '../appToolsCore.ts'
import { bool, int, object, oneOf, str } from './schema.ts'

export const KHERVECALC_TOOL_SET: AppToolSet = {
  app: 'khervecalc',
  name: 'KherveCalc',
  summary: 'the scientific calculator: exact/decimal maths, calculus, matrices, units, constants (SymPy).',
  keywords: ['khervecalc', 'calculator', 'calculate', 'compute', 'integral', 'derivative', 'solve', 'equation', 'convert', 'unit', 'constant', 'matrix', 'eigen', 'kcalc'],
  tools: [
    {
      action: 'evaluate',
      description:
        'Calculate in KherveCalc and add it to its history. Calculator syntax: ^ powers, 2x, a = b equations, x := 3 and f(x) := x^2 define, 3_m/_s units, #c constants, expr ▶ _km/_h converts, [[1,2],[3,4]] matrices, integrate(f, x, a, b)…',
      inputSchema: object(
        {
          expression: str('What to calculate, e.g. "integrate(exp(-x^2), x, -oo, oo)".'),
          mode: oneOf(['exact', 'decimal', 'fraction'], 'Number mode for this calculation (default: the current one).'),
          digits: int('Significant digits for decimal results (1–1000).'),
        },
        ['expression'],
      ),
    },
    {
      action: 'solve',
      description: 'Solve an equation or a system ("x^2 = 2", or "[x + y = 3, x - y = 1]") exactly, or numerically from a guess. Adds it to the history.',
      inputSchema: object(
        {
          equation: str('The equation(s); without "=", "= 0" is meant.'),
          variable: str('Unknown(s), e.g. "x" or "[x, y]" (default: guessed).'),
          numeric: bool('Find a numeric root (nsolve) instead of exact solutions.'),
          guess: str('Start value for a numeric root (default 0).'),
        },
        ['equation'],
      ),
    },
    {
      action: 'convert',
      description: 'Convert a value between units, e.g. 100 "km/h" to "m/s", 25 "degC" to "degF", 1 "kWh" to "MJ". Unit names may be combined (J/(mol*K)) and prefixed (µm, MPa).',
      inputSchema: object(
        { value: str('The number, e.g. "100" or "1.5e3".'), from: str('Unit of the value, e.g. "km/h".'), to: str('Unit wanted, e.g. "m/s".') },
        ['value', 'from', 'to'],
      ),
      readOnly: true,
    },
    {
      action: 'get_history',
      description: 'The latest calculations in KherveCalc: each input with its result as text (and its decimal value), newest last, plus the defined variables.',
      inputSchema: object({ limit: int('How many entries (default 20).') }),
      readOnly: true,
    },
    {
      action: 'set_mode',
      description: 'Change KherveCalc modes: number (exact/decimal/fraction), angle unit, decimal digits, complex form, number format.',
      inputSchema: object({
        number: oneOf(['exact', 'decimal', 'fraction'], 'Number mode.'),
        angle: oneOf(['deg', 'rad', 'grad'], 'Angle unit.'),
        digits: int('Significant digits (1–1000).'),
        complex: oneOf(['rect', 'polar'], 'Complex results as a + bi or r∠θ.'),
        format: oneOf(['normal', 'sci', 'eng', 'fix'], 'Number format.'),
      }),
    },
  ],
}
