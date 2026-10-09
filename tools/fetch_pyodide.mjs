// Copies Pyodide (Python in the browser) and the common scientific packages into
// public/pyodide/, so KherveOS runs Python with no internet connection.
//
//   node tools/fetch_pyodide.mjs                 the core and the default packages
//   node tools/fetch_pyodide.mjs --packages sympy,pillow     add more (names from the lock file)
//   node tools/fetch_pyodide.mjs --list          the package names available
//
// Run it once on a machine with internet, then copy the project (or just public/pyodide/)
// to the offline server. Every file is checked against the SHA-256 in pyodide-lock.json.
// Packages are resolved with their dependencies, like loadPackagesFromImports does.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = /PYODIDE_VERSION = '([^']+)'/.exec(readFileSync(join(ROOT, 'src/os/version.ts'), 'utf8'))?.[1]
if (!version) throw new Error('PYODIDE_VERSION not found in src/os/version.ts')

const CDN = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`
const OUT = join(ROOT, 'public/pyodide', `v${version}`, 'full')

// The runtime files every Pyodide needs, then the packages KherveOS users reach for.
const CORE = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
const DEFAULT_PACKAGES = [
  'numpy', 'scipy', 'pandas', 'matplotlib', 'scikit-learn', 'sympy', 'mpmath', 'h5py', 'pillow', 'micropip',
  'networkx', 'statsmodels', 'pyyaml', 'uncertainties',
]

const args = process.argv.slice(2)
const flag = (name) => args.indexOf(name)
if (flag('--packages') >= 0 && !args[flag('--packages') + 1]) throw new Error('--packages needs a list, e.g. --packages sympy,pillow')
const extra = flag('--packages') >= 0 ? args[flag('--packages') + 1].split(',').map((s) => s.trim()).filter(Boolean) : []

async function get(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`

mkdirSync(OUT, { recursive: true })
console.log(`Pyodide ${version} → ${join('public/pyodide', `v${version}`, 'full')}`)

// The lock file tells us where each package is and what it needs.
const lockPath = join(OUT, 'pyodide-lock.json')
const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : JSON.parse((await get(`${CDN}pyodide-lock.json`)).toString('utf8'))
const packages = lock.packages ?? {}

if (args.includes('--list')) {
  console.log(Object.keys(packages).sort().join('\n'))
  process.exit(0)
}

// Resolve the packages wanted, with everything they depend on.
const wanted = new Set([...DEFAULT_PACKAGES, ...extra])
const closure = new Set()
const visit = (name) => {
  const key = Object.keys(packages).find((k) => k.toLowerCase() === name.toLowerCase())
  if (!key) throw new Error(`"${name}" is not a Pyodide ${version} package (see --list)`)
  if (closure.has(key)) return
  closure.add(key)
  for (const dep of packages[key].depends ?? []) visit(dep)
}
for (const name of wanted) visit(name)

const files = [...CORE.filter((f) => f !== 'pyodide-lock.json'), ...[...closure].map((k) => packages[k].file_name)]
const expected = new Map(CORE.filter((f) => f !== 'pyodide-lock.json').map((f) => [f, null]))
for (const k of closure) expected.set(packages[k].file_name, packages[k].sha256)

let bytes = 0
for (const file of files) {
  const dest = join(OUT, file)
  const want = expected.get(file)
  if (existsSync(dest) && (!want || sha256(readFileSync(dest)) === want)) continue
  process.stdout.write(`  ${file} … `)
  const buf = await get(`${CDN}${file}`)
  if (want && sha256(buf) !== want) throw new Error(`${file}: the checksum does not match pyodide-lock.json`)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, buf)
  bytes += buf.length
  console.log(mb(buf.length))
}

writeFileSync(lockPath, JSON.stringify(lock))
// The marker tells the OS that this copy is complete (the server answers HTML for missing files).
writeFileSync(join(OUT, 'offline.json'), JSON.stringify({ version, packages: [...closure].sort(), files: files.length }, null, 1))
console.log(`Done: ${files.length} files, ${mb(bytes)} downloaded now. The OS will use this copy automatically.`)
