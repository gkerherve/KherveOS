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

/** py/files.json: the files every technique installs, and per technique (TECHS key) its own. */
export interface FilesIndex {
  rev: string
  common: string[]
  tech: Record<string, { files: string[]; wheels: string[]; packages: string[] }>
}

/** What one technique's worker installs: the common files and its own (py/-relative paths). */
export function filesFor(index: FilesIndex, tech: string): { files: string[]; wheels: string[]; packages: string[] } {
  const own = index.tech[tech.toUpperCase()]
  if (!own) throw new Error(`No technique ${tech} in files.json`)
  return { files: [...index.common, ...own.files], wheels: own.wheels, packages: own.packages }
}

/** KherveFitting's wheels, relative to the site root (shared with KherveFitting). */
export const WHEELS_DIR = 'apps/khervefitting/py/wheels/'

/**
 * Python that writes the files (path → text) under ROOT and makes them importable, fresh;
 * the wheels (name → base64) are unpacked once into ROOT/site.
 */
export function installCode(files: Record<string, string>, wheels: Record<string, string> = {}): string {
  const mapped: Record<string, string> = {}
  for (const [rel, text] of Object.entries(files)) mapped[installedPath(rel)] = text
  return `def _kt_install(files, wheels, root):
    import base64, importlib, io, os, sys, zipfile
    site = root + '/site'
    os.makedirs(site, exist_ok=True)
    for name, b64 in wheels.items():
        mark = site + '/.' + name
        if not os.path.exists(mark):
            zipfile.ZipFile(io.BytesIO(base64.b64decode(b64))).extractall(site)
            open(mark, 'w').close()
    for rel, text in files.items():
        path = root + '/' + rel
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
    if root not in sys.path:
        sys.path.insert(0, root)
    if site not in sys.path:
        sys.path.insert(1, site)
    for name in [m for m in sys.modules if m.split('.')[0] in ('ktech', 'libraries', 'wx', 'matplotlib', 'mpl_toolkits')]:
        del sys.modules[name]
    importlib.invalidate_caches()
_kt_install(__import__('json').loads(${pyStr(JSON.stringify(mapped))}), __import__('json').loads(${pyStr(JSON.stringify(wheels))}), ${pyStr(ROOT)})
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
