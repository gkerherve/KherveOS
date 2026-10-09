// Writes the kELN example notebooks to public/examples/keln/ (the files the app copies into ~/Documents/kELN Examples
// on first use, see src/os/exampleFiles.ts), plus index.json.
//
//   node tools/export_keln_examples.ts          write (or refresh) the files
//   node tools/export_keln_examples.ts --check  exit 1 when a file on disk differs from what would be written
//
// The output is deterministic (fixed clock, counting ids, stable key order), so the files can be regenerated at any
// time and a diff shows only real changes. Never edit them by hand. Importing this module writes nothing.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { KELN_EXAMPLES_FOLDER, kelnExampleFiles } from '../src/apps/keln/exampleFiles.ts'

export interface Output {
  /** Path relative to the project root. */
  path: string
  content: string
}

/** Every file to write, with its content. */
export function kelnExampleOutputs(): Output[] {
  const files = kelnExampleFiles()
  const examples = files.map((f) => ({ file: f.file, title: f.title, description: f.description ?? '', ...(f.group ? { group: f.group } : {}) }))
  return [
    ...files.map((f) => ({ path: `public/examples/keln/${f.file}`, content: f.content })),
    { path: 'public/examples/keln/index.json', content: JSON.stringify({ app: 'keln', folder: KELN_EXAMPLES_FOLDER, examples }, null, 2) + '\n' },
  ]
}

function main(root: string, check: boolean): number {
  const outputs = kelnExampleOutputs()
  const wanted = new Set(outputs.map((o) => o.path))
  let changed = 0
  for (const o of outputs) {
    const target = join(root, o.path)
    if (existsSync(target) && readFileSync(target, 'utf8') === o.content) continue
    changed++
    if (check) {
      console.error(`differs: ${o.path}`)
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, o.content)
    console.log(`wrote ${o.path}`)
  }
  const dir = join(root, 'public/examples/keln')
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const rel = `public/examples/keln/${name}`
      if (wanted.has(rel) || !(name.endsWith('.keln') || name === 'index.json')) continue
      changed++
      if (check) console.error(`stale: ${rel}`)
      else {
        rmSync(join(dir, name))
        console.log(`removed ${rel}`)
      }
    }
  }
  console.log(check ? (changed ? `${changed} file(s) out of date` : 'up to date') : `${outputs.length} files in public/examples/keln (${changed} written or removed)`)
  return check && changed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = main(root, process.argv.includes('--check'))
}
