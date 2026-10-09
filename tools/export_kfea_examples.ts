// Writes the example files of kFEA to public/examples/kfea/ (the files the app copies into ~/Documents/kFEA Examples on
// first use, see src/os/exampleFiles.ts), plus the folder's index.json.
//
//   node tools/export_kfea_examples.ts          write (or refresh) the files
//   node tools/export_kfea_examples.ts --check  exit 1 when a file on disk differs from what would be written
//
// The output is deterministic (fixed key order, 12 significant digits, 2-space indent), so the files can be regenerated
// at any time and a diff shows only real changes. Never edit them by hand. `kfeaExampleOutputs()` is what
// tools/tests/kfea.test.ts checks; importing this module writes nothing.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { kfeaExampleFiles, KFEA_EXAMPLES_FOLDER } from '../src/apps/kfea/exampleFiles.ts'

export interface Output {
  /** Path relative to the project root: public/examples/kfea/01 Simple truss.kfea */
  path: string
  content: string
}

/** The text of index.json: the list the app reads to copy the files and to build its menu. */
export function kfeaIndexText(): string {
  const examples = kfeaExampleFiles().map((f) => ({ file: f.file, title: f.title, description: f.description ?? '', ...(f.group ? { group: f.group } : {}) }))
  return JSON.stringify({ app: 'kfea', folder: KFEA_EXAMPLES_FOLDER, examples }, null, 2) + '\n'
}

export function kfeaExampleOutputs(): Output[] {
  return [
    ...kfeaExampleFiles().map((f) => ({ path: `public/examples/kfea/${f.file}`, content: f.content })),
    { path: 'public/examples/kfea/index.json', content: kfeaIndexText() },
  ]
}

function main(root: string, check: boolean): number {
  const outputs = kfeaExampleOutputs()
  const wanted = new Set(outputs.map((o) => o.path))
  let changed = 0
  for (const o of outputs) {
    const target = join(root, o.path)
    if (existsSync(target) && readFileSync(target, 'utf8') === o.content) continue
    changed++
    if (check) { console.error(`differs: ${o.path}`); continue }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, o.content)
    console.log(`wrote ${o.path}`)
  }
  const dir = join(root, 'public/examples/kfea')
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const rel = `public/examples/kfea/${name}`
      if (wanted.has(rel) || !(name.endsWith('.kfea') || name === 'index.json')) continue
      changed++
      if (check) console.error(`stale: ${rel}`)
      else { rmSync(join(dir, name)); console.log(`removed ${rel}`) }
    }
  }
  console.log(check ? (changed ? `${changed} file(s) out of date` : 'up to date') : `${outputs.length} files in public/examples/kfea (${changed} written or removed)`)
  return check && changed ? 1 : 0
}

// run only when started as a script (not when a test imports the functions above)
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = main(root, process.argv.includes('--check'))
}
