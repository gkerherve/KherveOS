// The technique engine's install step and protocol, without browser or Vite
// imports (the Node tests use this file with the real Pyodide).
//
// public/apps/khervetech/py/files.json lists the files; they are written
// into the worker under ROOT so that desktop/libraries/… and shims/… become
// the packages `libraries`, `wx`, `matplotlib`, and ktech/… stays `ktech`.

export const ROOT = '/kherveos/khervetech'
export const START = '\x02KT-JSON\x03'
export const END = '\x02/KT-JSON\x03'

/** Where a listed file goes in the worker (relative to ROOT). */
export function installedPath(rel: string): string {
  if (rel.startsWith('desktop/')) return rel.slice('desktop/'.length)
  if (rel.startsWith('shims/')) return rel.slice('shims/'.length)
  return rel
}

/** A Python string literal (JSON's escapes are all valid Python). */
export const pyStr = (s: string) => JSON.stringify(s)

/** Python that writes the files (path → text) under ROOT and makes them importable, fresh. */
export function installCode(files: Record<string, string>): string {
  const mapped: Record<string, string> = {}
  for (const [rel, text] of Object.entries(files)) mapped[installedPath(rel)] = text
  return `def _kt_install(files, root):
    import importlib, os, sys
    for rel, text in files.items():
        path = root + '/' + rel
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
    if root not in sys.path:
        sys.path.insert(0, root)
    for name in [m for m in sys.modules if m.split('.')[0] in ('ktech', 'libraries', 'wx', 'matplotlib')]:
        del sys.modules[name]
    importlib.invalidate_caches()
_kt_install(__import__('json').loads(${pyStr(JSON.stringify(mapped))}), ${pyStr(ROOT)})
del _kt_install`
}

/** The cell that answers a batch of requests. */
export function runCode(requests: { op: string; args: unknown }[]): string {
  return `await __import__('ktech.bridge', fromlist=['run']).run(${pyStr(JSON.stringify(requests))})`
}

/** The answers printed between the markers, or null. */
export function parseAnswers<T>(out: string): T[] | null {
  const i = out.lastIndexOf(START)
  const k = i >= 0 ? out.indexOf(END, i) : -1
  if (i < 0 || k <= i) return null
  return JSON.parse(out.slice(i + START.length, k)) as T[]
}
