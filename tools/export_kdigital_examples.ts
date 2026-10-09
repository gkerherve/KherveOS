// Writes the example files of kDigital to public/examples/kdigital/ (the files the app copies into
// ~/Documents/kDigital Examples on first use, see src/os/exampleFiles.ts), plus the folder's index.json.
//
//   node tools/export_kdigital_examples.ts          write (or refresh) the files
//   node tools/export_kdigital_examples.ts --check  exit 1 when a file on disk differs from what would be written
//
// The output is deterministic (ids numbered in order, keys in a fixed order, 2-space indent): regenerate at any
// time, never edit the files by hand. The pure function `kdigitalOutputs()` is what tools/tests/kdigital.test.ts
// checks; importing this module writes nothing.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { kdigitalExampleFiles, KDIGITAL_EXAMPLES_FOLDER } from '../src/apps/kdigital/exampleFiles.ts'

export interface Output {
  /** Path relative to the project root: public/examples/kdigital/01 Half adder.kdig */
  path: string
  content: string
}

const APP = 'kdigital'
const EXT = 'kdig'

/** The text of index.json: the list the app reads to copy the files and to build its menu. */
export function indexText(): string {
  const examples = kdigitalExampleFiles().map((f) => ({ file: f.file, title: f.title, description: f.description ?? '', ...(f.group ? { group: f.group } : {}) }))
  return JSON.stringify({ app: APP, folder: KDIGITAL_EXAMPLES_FOLDER, examples }, null, 2) + '\n'
}

/** Every file to write, with its content. */
export function kdigitalOutputs(): Output[] {
  return [
    ...kdigitalExampleFiles().map((f) => ({ path: `public/examples/${APP}/${f.file}`, content: f.content })),
    { path: `public/examples/${APP}/index.json`, content: indexText() },
  ]
}

function main(root: string, check: boolean): number {
  const outputs = kdigitalOutputs()
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
  // files an earlier run made that are not examples any more
  const dir = join(root, 'public/examples', APP)
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const rel = `public/examples/${APP}/${name}`
      if (wanted.has(rel) || !(name.endsWith(`.${EXT}`) || name === 'index.json')) continue
      changed++
      if (check) console.error(`stale: ${rel}`)
      else { rmSync(join(dir, name)); console.log(`removed ${rel}`) }
    }
  }
  console.log(check ? (changed ? `${changed} file(s) out of date` : 'up to date') : `${outputs.length} files in public/examples/${APP} (${changed} written or removed)`)
  return check && changed ? 1 : 0
}

// run only when started as a script (not when a test imports the functions above)
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = main(root, process.argv.includes('--check'))
}
