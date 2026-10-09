// Writes the kMech example files to public/examples/kmech/ (the files the app copies into
// ~/Documents/kMech Examples on first use, see src/os/exampleFiles.ts), plus index.json.
//
//   node tools/export_kmech_examples.ts          write (or refresh) the files
//   node tools/export_kmech_examples.ts --check  exit 1 when a file on disk differs from what would be written
//
// The output is deterministic, so a diff shows only real changes. Never edit the files by hand.
// `kmechExampleOutputs()` is the pure part (tools/tests/kmech.test.ts uses it); importing this module writes nothing.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { kmechExampleFiles, KMECH_EXAMPLES_FOLDER } from '../src/apps/kmech/exampleFiles.ts'

export interface Output {
  /** Path relative to the project root: public/examples/kmech/01 Crank-rocker four-bar.kmech */
  path: string
  content: string
}

export function indexText(): string {
  const examples = kmechExampleFiles().map((f) => ({ file: f.file, title: f.title, description: f.description ?? '', ...(f.group ? { group: f.group } : {}) }))
  return JSON.stringify({ app: 'kmech', folder: KMECH_EXAMPLES_FOLDER, examples }, null, 2) + '\n'
}

export function kmechExampleOutputs(): Output[] {
  return [
    ...kmechExampleFiles().map((f) => ({ path: `public/examples/kmech/${f.file}`, content: f.content })),
    { path: 'public/examples/kmech/index.json', content: indexText() },
  ]
}

function main(root: string, check: boolean): number {
  const outputs = kmechExampleOutputs()
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
  const dir = join(root, 'public/examples/kmech')
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const rel = `public/examples/kmech/${name}`
      if (wanted.has(rel) || !(name.endsWith('.kmech') || name === 'index.json')) continue
      changed++
      if (check) console.error(`stale: ${rel}`)
      else { rmSync(join(dir, name)); console.log(`removed ${rel}`) }
    }
  }
  console.log(check ? (changed ? `${changed} file(s) out of date` : 'up to date') : `${outputs.length} files in public/examples/kmech (${changed} written or removed)`)
  return check && changed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = main(root, process.argv.includes('--check'))
}
