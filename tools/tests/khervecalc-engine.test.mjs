// KherveCalc's Python engine (src/apps/khervecalc/engine.py), run for real.
//
//   node --test tools/tests/khervecalc-engine.test.mjs
//
// It runs in Pyodide when it can find it (the same Python as in KherveOS):
//   KCALC_PYODIDE=/path/to/node_modules/pyodide node --test …
// (npm i pyodide@<PYODIDE_VERSION> in any scratch folder; the wheels come from
// the jsDelivr CDN, as in the browser). Otherwise it uses the system python3
// when SymPy, mpmath, NumPy and SciPy are installed, and is skipped if neither works.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENGINE = readFileSync(join(ROOT, 'src/apps/khervecalc/engine.py'), 'utf8')
const PYODIDE_VERSION = /PYODIDE_VERSION = '([^']+)'/.exec(readFileSync(join(ROOT, 'src/os/version.ts'), 'utf8'))[1]

// Runs a list of requests through dispatch(); answers come back as JSON.
const DRIVER = `
import json, sys, types
def _kc_run(engine_src, reqs_json):
    mod = sys.modules.get('kcalc_engine')
    if mod is None:
        mod = types.ModuleType('kcalc_engine')
        sys.modules['kcalc_engine'] = mod
        exec(compile(engine_src, 'engine.py', 'exec'), mod.__dict__)
    out = []
    for r in json.loads(reqs_json):
        out.append(mod.dispatch(r))
    return json.dumps(out, default=str)
`

async function pyodideRunner() {
  const dir = process.env.KCALC_PYODIDE
  if (!dir || !existsSync(join(dir, 'pyodide.mjs'))) return null
  const { loadPyodide } = await import(pathToFileURL(join(dir, 'pyodide.mjs')).href)
  const py = await loadPyodide({ packageBaseUrl: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/` })
  await py.loadPackage(['sympy', 'mpmath', 'numpy', 'scipy'])
  py.runPython(DRIVER)
  const run = py.globals.get('_kc_run')
  return { name: `Pyodide ${py.version}`, py, run: (reqs) => JSON.parse(run(ENGINE, JSON.stringify(reqs))) }
}

function python3Runner() {
  const probe = spawnSync('python3', ['-c', 'import sympy, mpmath, numpy, scipy'], { encoding: 'utf8' })
  if (probe.status !== 0) return null
  return {
    name: 'python3',
    run: (reqs) => {
      const code = `${DRIVER}\nimport sys\nsrc = open(sys.argv[1], encoding='utf-8').read()\nprint(_kc_run(src, sys.stdin.read()))`
      const r = spawnSync('python3', ['-W', 'ignore', '-c', code, join(ROOT, 'src/apps/khervecalc/engine.py')], {
        input: JSON.stringify(reqs), encoding: 'utf8', maxBuffer: 64 << 20,
      })
      if (r.status !== 0) throw new Error(r.stderr)
      return JSON.parse(r.stdout.trim().split('\n').pop())
    },
  }
}

const runner = (await pyodideRunner().catch((e) => { console.error('Pyodide:', e.message); return null })) ?? python3Runner()
const skip = runner ? false : 'no Pyodide (KCALC_PYODIDE) and no python3 with sympy/mpmath/numpy/scipy'
if (runner) console.log(`# khervecalc engine runs in ${runner.name}`)

const EXACT = { number: 'exact', digits: 12, angle: 'rad', complex: 'rect' }
const ev = (src, settings = {}, extra = {}) => ({ op: 'eval', src, settings: { ...EXACT, ...settings }, ...extra })

/** [request, check] — a string is the expected `text`, a RegExp tests `text`, a function gets the answer. */
const CASES = [
  // arithmetic and exactness
  [ev('2+3*4'), '14'],
  [ev('1/3 + 1/4'), '7/12'],
  [ev('sqrt(8)'), '2*sqrt(2)'],
  [ev('2^100'), '1267650600228229401496703205376'],
  [ev('5!'), '120'],
  [ev('2x(x+1)'), '2*x*(x + 1)'],
  [ev('sin x + sin^2(x)'), 'sin(x)**2 + sin(x)'],
  [ev('0.1+0.2'), (r) => assert.equal(r.num.re.digits, '3')],
  [ev('1/3', { number: 'decimal', digits: 50 }), (r) => assert.equal(r.num.re.digits, '3'.repeat(50))],
  [ev('pi', { number: 'decimal', digits: 60 }), (r) => assert.equal(r.num.re.digits, '314159265358979323846264338327950288419716939937510582097494')],
  [ev('sqrt(2)', { number: 'fraction' }), '941664/665857'],
  [ev('7/3', { number: 'fraction' }), (r) => assert.match(r.mixed_latex, /2\\,\\tfrac\{1\}\{3\}/)],
  [ev('round(3.14159, 2)'), (r) => assert.equal(r.num.re.digits, '314')],
  [ev('log(1000)'), '3'],
  [ev('ln(e^2)'), '2'],
  [ev('log(8, 2)'), '3'],
  [ev('mod(17, 5)'), '2'],
  [ev('sin('), (r) => assert.equal(r.error, "Missing ')'")],
  [ev('ans'), (r) => assert.match(r.error, /no previous answer/)],
  // angles and complex numbers
  [ev('sin(30)', { angle: 'deg' }), '1/2'],
  [ev('asin(1)', { angle: 'deg' }), '90'],
  [ev('cos(100)', { angle: 'grad' }), '0'],
  [ev('sin(90°)', { angle: 'rad' }), '1'],
  [ev('(1+2i)*(3-i)'), '5 + 5*I'],
  [ev('e^(i pi)'), '-1'],
  [ev('2∠90°', { angle: 'deg' }), '2*I'],
  [ev('1+i', { angle: 'deg' }), (r) => { assert.equal(r.num.abs.digits, '141421356237'); assert.equal(r.num.arg.digits, '45') }],
  // special functions
  [ev('gamma(1/2)'), 'sqrt(pi)'],
  [ev('beta(2,3)'), '1/12'],
  [ev('zeta(2)'), 'pi**2/6'],
  [ev('erf(1)', { number: 'decimal' }), (r) => assert.equal(r.num.re.digits, '84270079295')],
  [ev('besselj(0, 2.5)'), (r) => assert.equal(r.num.re.digits, '483837764682')],
  [ev('lambertw(1)', { number: 'decimal' }), (r) => assert.equal(r.num.re.digits, '56714329041')],
  [ev('legendre(3, x)'), '5*x**3/2 - 3*x/2'],
  [ev('airyai(0)', { number: 'decimal' }), (r) => assert.equal(r.num.re.digits, '355028053888')],
  // number theory
  [ev('nCr(10,3)'), '120'],
  [ev('nPr(10,3)'), '720'],
  [ev('gcd(12, 18, 24)'), '6'],
  [ev('lcm(4, 6, 10)'), '60'],
  [ev('isprime(97)'), 'true'],
  [ev('factor(360)'), '2^3*3^2*5'],
  [ev('0xFF + 0b101'), '260'],
  [ev('bxor(12, 10)'), '6'],
  // algebra and calculus
  [ev('factor(x^2-1)'), '(x - 1)*(x + 1)'],
  [ev('expand((x+1)^3)'), 'x**3 + 3*x**2 + 3*x + 1'],
  [ev('simplify(sin(x)^2+cos(x)^2)'), '1'],
  [ev('apart(1/(x^2-1))'), '-1/(2*(x + 1)) + 1/(2*(x - 1))'],
  [ev('diff(x^3, x)'), '3*x**2'],
  [ev('diff(sin(x), x, 2)'), '-sin(x)'],
  [ev('integrate(exp(-x^2), x, -oo, oo)'), 'sqrt(pi)'],
  [ev('integrate(x^2, x, 0, 1)', { number: 'decimal' }), (r) => assert.equal(r.num.re.digits, '333333333333')],
  [ev('nint(sin(x)/x, x, 0, 1)'), (r) => assert.equal(r.num.re.digits, '946083070367')],
  [ev('limit(sin(x)/x, x, 0)'), '1'],
  [ev('taylor(sin(x), x, 0, 6)'), 'x**5/120 - x**3/6 + x'],
  [ev('sum(1/k^2, k, 1, oo)'), 'pi**2/6'],
  [ev('product(k, k, 1, 5)'), '120'],
  [ev('solve(x^2 = 4, x)'), 'x = -2 or x = 2'],
  [ev('solve([x+y=3, x-y=1], [x,y])'), 'x = 2, y = 1'],
  [ev('nsolve(cos(x) = x, x, 1)'), (r) => assert.match(r.text, /^x = 0\.73908513321/)],
  [ev('roots(x^3-6x^2+11x-6)'), 'x = 1 or x = 2 or x = 3'],
  [ev("dsolve(y'' + y = 0)"), 'Eq(y(x), C1*sin(x) + C2*cos(x))'],
  [ev("dsolve(y' = y, y(0) = 2)"), 'Eq(y(x), 2*exp(x))'],
  [ev('odesolve(y, t, y, 0, 1, 1)'), (r) => assert.equal(r.num.re.digits, '271828182846')],
  // linear algebra
  [ev('[[1,2],[3,4]]^-1'), '[[-2, 1], [3/2, -1/2]]'],
  [ev('det([[1,2],[3,4]])'), '-2'],
  [ev('rank([[1,2],[2,4]])'), '1'],
  [ev('[[1,2],[3,4]]*[1,1]'), '[[3], [7]]'],
  [ev('cross([1,0,0],[0,1,0])'), '[[0], [0], [1]]'],
  [ev('dot([1,2,3],[4,5,6])'), '32'],
  [ev('linsolve([[2,1],[1,3]], [3,5])'), '[[4/5], [7/5]]'],
  [ev('eigenvals([[2,1],[1,2]])'), (r) => assert.deepEqual(r.cells.flat().sort(), ['1', '3'])],
  [ev('lu([[4,3],[6,3]])'), (r) => assert.equal(r.kind, 'labeled')],
  [ev('svd([[3,0],[0,4]])', { number: 'decimal' }), (r) => assert.match(r.text, /4\.0+/)],
  [ev('norm([3,4])'), '5'],
  // statistics
  [ev('mean([1,2,3,4])'), '5/2'],
  [ev('stdev([2,4,4,4,5,5,7,9])'), '4*sqrt(14)/7'],
  [ev('binompdf(3, 10, 1/2)'), '15/128'],
  [ev('normcdf(1.96)', { number: 'decimal' }), (r) => assert.equal(r.num.re.digits, '975002104852')],
  [ev('invnorm(0.975)', { number: 'decimal' }), (r) => assert.equal(r.num.re.digits, '195996398454')],
  // units and constants
  [ev('3_m/_s * 2_h'), '21600*_m'],
  [ev('2_kg * 3_m/_s^2'), '6*_N'],
  [ev('1_m + 20_cm'), '6*_m/5'],
  [ev('100_km/_h ▶ _m/_s'), '250*_m/(9*_s)'],
  [ev('3_m/_s -> km/h'), '54*_km/(5*_h)'],
  [ev('20°C -> °F'), (r) => assert.equal(r.num.re.digits, '68')],
  [ev('5_kPa*2'), '10*_kPa'],
  [ev('#c'), '299792458*_m/_s'],
  [ev('#h*#c/(500_nm) -> _eV'), (r) => assert.equal(r.num.re.digits.slice(0, 5), '24796')],
  [ev('3_m ▶ _s'), (r) => assert.match(r.error, /Incompatible units/)],
  [ev('_parsnip'), (r) => assert.match(r.error, /Unknown unit _parsnip/)],
  [{ op: 'convert', value: '1', from: 'atm', to: 'kPa', settings: EXACT }, (r) => assert.equal(r.num.re.digits, '101325')],
  [{ op: 'convert', value: '25', from: 'degC', to: 'degF', settings: EXACT }, '77'],
  [{ op: 'constants' }, (r) => { assert.ok(r.constants.length > 300); assert.ok(r.constants.some((c) => c.alias === 'hbar')) }],
  // definitions, variables, ans
  [ev('a := 2', {}, { id: 'h1' }), 'a := 2'],
  [ev('g(x) := a*x^2', {}, { id: 'h2' }), 'g(x) := a*x**2'],
  [ev('a := 10', {}, { id: 'h3' }), 'a := 10'],
  [ev('g(3)', {}, { id: 'h4' }), '90'],
  [ev('ans + 1', {}, { id: 'h5', ans: ['h4', 'h3'] }), '91'],
  [ev('ans2 * 2', {}, { id: 'h6', ans: ['h5', 'h4'] }), '180'],
  [ev('7 -> b', {}, { id: 'h7' }), 'b := 7'],
  [ev('a + b'), '17'],
  [{ op: 'vars' }, (r) => assert.deepEqual(r.vars.map((v) => v.name), ['a', 'b', 'g'])],
  [{ op: 'delvar', name: 'b' }, (r) => assert.deepEqual(r.vars.map((v) => v.name), ['a', 'g'])],
  [ev('pi := 3'), (r) => assert.match(r.error, /reserved/)],
  [{ op: 'lists', lists: { L1: [1, 2, 3, 4.5] } }, (r) => assert.ok(r.ok)],
  [ev('mean(L1)'), (r) => assert.equal(r.num.re.digits, '2625')],
  // live preview
  [{ op: 'preview', src: '1/3 + sqrt(2)/2', settings: EXACT }, (r) => { assert.equal(r.latex, '\\frac{1}{3} + \\frac{\\sqrt{2}}{2}'); assert.equal(r.approx.re.digits, '104044011451988') }],
  [{ op: 'preview', src: 'integrate(sin(x), x, 0, pi)', settings: EXACT }, (r) => assert.match(r.latex, /^\\int\\limits_\{0\}\^\{\\pi\}/)],
  [{ op: 'preview', src: 'solve(x^2=4, x)', settings: EXACT }, (r) => assert.equal(r.approx, null)],
  // graphs
  [{ op: 'sample', items: [{ kind: 'y', expr: 'x^2' }, { kind: 'implicit', expr: 'x^2+y^2=1', nx: 3, ny: 3 }, { kind: 'polar', expr: '1', tmin: 0, tmax: 'pi' }, { kind: 'y', expr: 'oops(' }], xmin: -1, xmax: 1, ymin: -1, ymax: 1, n: 3, settings: EXACT },
    (r) => {
      assert.deepEqual(r.series[0].y, [1, 0, 1])
      assert.deepEqual(r.series[1].z[1], [0, -1, 0])
      assert.equal(r.series[2].x.length, 6)
      assert.equal(r.series[3].ok, false)
    }],
  [{ op: 'analyze', what: 'roots', expr: 'sin(x)', xmin: -4, xmax: 4, settings: EXACT }, (r) => assert.deepEqual(r.points.map((p) => Math.round(p.x * 1e6) / 1e6), [-3.141593, 0, 3.141593])],
  [{ op: 'analyze', what: 'roots', expr: 'tan(x)', xmin: -2, xmax: 2, settings: EXACT }, (r) => assert.equal(r.points.length, 1)],
  [{ op: 'analyze', what: 'extrema', expr: 'x^3-3x', xmin: -3, xmax: 3, settings: EXACT }, (r) => assert.deepEqual(r.points.map((p) => p.type), ['max', 'min'])],
  [{ op: 'analyze', what: 'intersect', expr: 'x^2', expr2: 'x+2', xmin: -3, xmax: 3, settings: EXACT }, (r) => assert.deepEqual(r.points.map((p) => Math.round(p.x)), [-1, 2])],
  [{ op: 'table', exprs: ['x^2', '1/x'], start: -1, step: 1, count: 3, settings: EXACT }, (r) => assert.deepEqual(r.cols[1], [-1, null, 1])],
  // distributions and tests
  [{ op: 'dist', name: 'binomial', fn: 'pdf', x: 3, params: [10, 0.5] }, (r) => assert.ok(Math.abs(r.value - 0.1171875) < 1e-12)],
  [{ op: 'dist', name: 't', fn: 'inv', x: 0.975, params: [10] }, (r) => assert.ok(Math.abs(r.value - 2.228138851986) < 1e-9)],
  [{ op: 'test', kind: 't1', data: { a: [5.1, 4.9, 5.3, 5.0, 5.2] }, opts: { mu0: 5 } }, (r) => { assert.ok(Math.abs(r.statistic - Math.SQRT2) < 1e-9); assert.equal(r.df, 4) }],
  [{ op: 'test', kind: 'chi2ind', data: { table: [[10, 20], [30, 40]] }, opts: {} }, (r) => assert.equal(r.df, 1)],
]

test('the engine answers like a scientific calculator', { skip }, () => {
  const answers = runner.run(CASES.map(([req]) => req))
  const failures = []
  CASES.forEach(([req, check], i) => {
    const r = answers[i]
    const label = req.src ?? `${req.op} ${req.what ?? req.kind ?? req.name ?? ''}`
    try {
      if (typeof check === 'string') {
        assert.ok(r.ok, r.error)
        assert.equal(r.text, check)
      } else if (check instanceof RegExp) {
        assert.ok(r.ok, r.error)
        assert.match(r.text, check)
      } else check(r)
    } catch (e) {
      failures.push(`${label}: ${e.message.split('\n')[0]}  (got ${JSON.stringify(r).slice(0, 300)})`)
    }
  })
  assert.deepEqual(failures, [])
})

test('every function the help lists exists in the engine', { skip }, async () => {
  const { CATALOG } = await import(pathToFileURL(join(ROOT, 'src/apps/khervecalc/catalog.ts')).href)
  const [init] = runner.run([{ op: 'init' }])
  const have = new Set(init.functions)
  const missing = CATALOG.map((f) => f.name).filter((n) => !have.has(n))
  assert.deepEqual(missing, [])
})

test('in Pyodide, the KherveOS runtime installs the engine and gets long answers back', { skip: runner?.py ? false : 'needs KCALC_PYODIDE' }, async () => {
  const { installCode, requestCode, between } = await import(pathToFileURL(join(ROOT, 'src/apps/khervecalc/pyglue.ts')).href)
  const py = runner.py
  py.FS.mkdirTree('/kherveos')
  py.FS.writeFile('/kherveos/kherveos_runtime.py', readFileSync(join(ROOT, 'src/os/python/runtime.py'), 'utf8'))
  py.runPython("import sys\nif '/kherveos' not in sys.path: sys.path.insert(0, '/kherveos')")
  const rt = py.pyimport('kherveos_runtime')
  const toJs = (v) => { const j = v.toJs({ dict_converter: Object.fromEntries }); v.destroy(); return j }
  let out = ''
  py.setStdout({ write: (b) => { out += new TextDecoder().decode(b); return b.length } })
  const install = toJs(await rt.run_cell(installCode(ENGINE), 'kc-test'))
  assert.ok(install.ok, JSON.stringify(install.error))
  const call = async (req) => {
    out = ''
    const r = toJs(await rt.run_cell(requestCode(Buffer.from(JSON.stringify(req)).toString('base64')), 'kc-test'))
    assert.ok(r.ok, JSON.stringify(r.error))
    return JSON.parse(Buffer.from(between(out), 'base64').toString('utf8'))
  }
  const consts = await call({ op: 'constants' })
  assert.ok(JSON.stringify(consts).length > 20000 && consts.constants.length > 300, 'answers longer than a cell result')
  assert.ok(consts.constants.some((c) => c.name === 'electron mass' && c.value === '9.1093837139e-31'), 'CODATA 2022')
  const fact = await call({ op: 'eval', src: 'factorial(3000)', settings: EXACT })
  assert.equal(fact.text.length, 9131)
  // a function from the Python tab is callable in Calculate
  assert.ok(toJs(await rt.run_cell('def collatz(n):\n    n = int(n); s = 0\n    while n != 1:\n        n = n // 2 if n % 2 == 0 else 3*n + 1; s += 1\n    return s', 'kc-test')).ok)
  assert.equal((await call(ev('collatz(27)'))).text, '111')
})
