// The Python text KherveCalc sends to its kernel (pure, so tools/tests can run
// it through the real KherveOS runtime in Pyodide).

/** Installs engine.py as the module kcalc_engine in the cell's namespace. */
export function installCode(engineSrc: string): string {
  // The first lines make Pyodide download the packages (SciPy is only imported when used).
  return (
    'import sympy, mpmath, numpy\nif False:\n    import scipy\n' +
    'import sys as _kc_sys, types as _kc_types, json as _kc_json\n' +
    `_kc_mod = _kc_types.ModuleType('kcalc_engine')\n_kc_sys.modules['kcalc_engine'] = _kc_mod\n` +
    `exec(compile(_kc_json.loads(${JSON.stringify(JSON.stringify(engineSrc))}), 'kcalc_engine.py', 'exec'), _kc_mod.__dict__)\n` +
    '_kc_mod.PROGRAM_NS = globals()\n' +
    'del _kc_mod, _kc_sys, _kc_types, _kc_json'
  )
}

/** One request (base64 JSON); the answer is printed between markers. */
export function requestCode(b64: string): string {
  return `__import__('kcalc_engine').emit('${b64}')`
}

/** The answer printed as \x1eKC>base64<KC\x1e (any length: cell results are cut at 20,000 characters). */
export function between(out: string): string | null {
  const i = out.lastIndexOf('\x1eKC>')
  if (i < 0) return null
  const j = out.indexOf('<KC\x1e', i)
  return j < 0 ? null : out.slice(i + 4, j)
}
