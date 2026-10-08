// The Python tab: a cell of Python (SymPy, mpmath, NumPy, SciPy, matplotlib)
// in the calculator's own Python, for anything beyond. Functions defined here
// can be called in Calculate.

import { useState } from 'react'
import { Play, Eraser } from 'lucide-react'
import { CodeEditor } from '@/os/ui/CodeEditor'
import { figureUrl } from '@/os/python/kernel'
import type { CalcBridge } from './bridge'

interface Props {
  bridge: CalcBridge
  code: string
  setCode: (c: string) => void
  onDefined: () => void
}

type Out = { kind: 'out' | 'err' | 'info' | 'result' | 'img'; text: string }

const EXAMPLES: { label: string; code: string }[] = [
  {
    label: 'π to 1000 digits (mpmath)',
    code: 'import mpmath\nmpmath.mp.dps = 1000\nprint(mpmath.pi)\n',
  },
  {
    label: "Newton's method",
    code: 'import sympy as sp\nx = sp.symbols("x")\nf = sp.cos(x) - x\ndf = sp.diff(f, x)\nv = sp.Float(1, 30)\nfor i in range(8):\n    v = v - f.subs(x, v) / df.subs(x, v)\n    print(i, v)\n',
  },
  {
    label: 'Lorenz system (SciPy) + plot',
    code: 'import numpy as np\nfrom scipy.integrate import solve_ivp\nimport matplotlib.pyplot as plt\n\ndef lorenz(t, s, sigma=10, rho=28, beta=8/3):\n    x, y, z = s\n    return [sigma*(y-x), x*(rho-z)-y, x*y-beta*z]\n\nsol = solve_ivp(lorenz, (0, 40), [1, 1, 1], max_step=0.01)\nplt.plot(sol.y[0], sol.y[2], lw=0.5)\nplt.xlabel("x"); plt.ylabel("z")\n',
  },
  {
    label: 'A function for Calculate',
    code: '# After running this, type  collatz(27)  in Calculate.\ndef collatz(n):\n    n = int(n)\n    steps = 0\n    while n != 1:\n        n = n // 2 if n % 2 == 0 else 3*n + 1\n        steps += 1\n    return steps\n',
  },
  {
    label: 'Symbolic: Fourier coefficients',
    code: 'import sympy as sp\nx, n = sp.symbols("x n", integer=False)\nk = sp.symbols("k", integer=True, positive=True)\nf = x\nb = sp.integrate(f*sp.sin(k*x), (x, -sp.pi, sp.pi)) / sp.pi\nsp.simplify(b)\n',
  },
]

export function ProgramView({ bridge, code, setCode, onDefined }: Props) {
  const [out, setOut] = useState<Out[]>([])
  const [running, setRunning] = useState(false)

  const run = async () => {
    if (running) return
    setRunning(true)
    const lines: Out[] = []
    const push = (kind: Out['kind'], text: string) => {
      const last = lines[lines.length - 1]
      if (last && last.kind === kind && kind !== 'img' && kind !== 'result') last.text += text
      else lines.push({ kind, text })
      setOut([...lines])
    }
    try {
      const r = await bridge.runProgram(code, (k, t) => push(k, t))
      if (r.result !== null) push('result', r.result)
      for (const f of r.figures) push('img', f)
      if (r.error) push('err', r.error.traceback || `${r.error.type}: ${r.error.message}`)
      onDefined()
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="kc-program">
      <div className="k-toolbar kc-graph-bar">
        <button className="k-btn primary small" disabled={running} onClick={() => void run()} title="Run (Ctrl+Enter)"><Play size={13} /> Run</button>
        <button className="k-btn small" onClick={() => setOut([])}><Eraser size={13} /> Clear output</button>
        <select className="k-input kc-small-select" value="" onChange={(e) => {
          const ex = EXAMPLES.find((x) => x.label === e.target.value)
          if (ex) setCode(ex.code)
        }}>
          <option value="">Examples…</option>
          {EXAMPLES.map((x) => <option key={x.label}>{x.label}</option>)}
        </select>
        <span className="k-spacer" />
        <span className="k-muted small">Same Python as the calculator: functions defined here work in Calculate.</span>
      </div>
      <div className="kc-program-split">
        <div className="kc-program-editor">
          <CodeEditor value={code} onChange={setCode} language="python" lineNumbers keys={[{ key: 'Mod-Enter', run: () => (void run(), true) }, { key: 'Shift-Enter', run: () => (void run(), true) }]} />
        </div>
        <div className="kc-program-out">
          {!out.length && <div className="k-muted kc-pad">Output appears here. Ctrl+Enter runs the cell.</div>}
          {out.map((o, i) =>
            o.kind === 'img' ? (
              <img key={i} className="kc-fig" src={figureUrl(o.text)} alt="Figure" />
            ) : (
              <pre key={i} className={`kc-out kc-out-${o.kind}`}>{o.kind === 'result' ? `→ ${o.text}` : o.text}</pre>
            ),
          )}
        </div>
      </div>
    </div>
  )
}
