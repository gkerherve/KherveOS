// Writes the kSignal example files to public/examples/ksignal/ (the files the app copies into
// ~/Documents/kSignal Examples on first use, see src/os/exampleFiles.ts), plus the folder's index.json.
//
//   node tools/export_ksignal_examples.ts          write (or refresh) the files
//   node tools/export_ksignal_examples.ts --check  exit 1 when a file on disk differs from what would be written
//
// The output is deterministic (the signals are generated from the specs in the files, keys in a fixed order,
// 2-space indent), so the files can be regenerated at any time. Never edit them by hand. Importing this module
// writes nothing; the pure function `ksignalOutputs()` is what tools/tests/ksignal.test.ts checks.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { KSIGNAL_EXAMPLES_FOLDER, ksignalExampleFiles } from '../src/apps/ksignal/exampleFiles.ts'

export interface Output {
  /** Path relative to the project root. */
  path: string
  content: string
}

export const APP = 'ksignal'

/** Every file to write, with its content. */
export function ksignalOutputs(): Output[] {
  const files = ksignalExampleFiles()
  const index = {
    app: APP,
    folder: KSIGNAL_EXAMPLES_FOLDER,
    examples: files.map((f) => ({ file: f.file, title: f.title, description: f.description ?? '', ...(f.group ? { group: f.group } : {}) })),
  }
  return [
    ...files.map((f) => ({ path: `public/examples/${APP}/${f.file}`, content: f.content })),
    { path: `public/examples/${APP}/index.json`, content: JSON.stringify(index, null, 2) + '\n' },
  ]
}

function main(root: string, check: boolean): number {
  const outputs = ksignalOutputs()
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
  // files an earlier run made that are not examples any more
  const dir = join(root, 'public/examples', APP)
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const rel = `public/examples/${APP}/${name}`
      if (wanted.has(rel) || !(name.endsWith('.ksig') || name === 'index.json')) continue
      changed++
      if (check) console.error(`stale: ${rel}`)
      else {
        rmSync(join(dir, name))
        console.log(`removed ${rel}`)
      }
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
