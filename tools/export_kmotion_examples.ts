// Writes the kMotion example files to public/examples/kmotion/ (the files the app copies into ~/Documents/kMotion Examples
// on first use, see src/os/exampleFiles.ts), plus the folder's index.json.
//
//   node tools/export_kmotion_examples.ts          write (or refresh) the files
//   node tools/export_kmotion_examples.ts --check  exit 1 when a file on disk differs from what would be written
//
// The output is deterministic, so the files can be regenerated at any time and a diff shows only real changes. Never edit
// them by hand. importing this module writes nothing; tools/tests/kmotion.test.ts checks the pure function below.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { kmotionExampleFiles, KMOTION_EXAMPLES_FOLDER } from '../src/apps/kmotion/exampleFiles.ts'

export interface Output {
  /** Path relative to the project root. */
  path: string
  content: string
}

/** Every file to write, with its content. */
export function kmotionExampleOutputs(): Output[] {
  const files = kmotionExampleFiles()
  const index = {
    app: 'kmotion',
    folder: KMOTION_EXAMPLES_FOLDER,
    examples: files.map((f) => ({ file: f.file, title: f.title, description: f.description ?? '', ...(f.group ? { group: f.group } : {}) })),
  }
  return [
    ...files.map((f) => ({ path: `public/examples/kmotion/${f.file}`, content: f.content })),
    { path: 'public/examples/kmotion/index.json', content: JSON.stringify(index, null, 2) + '\n' },
  ]
}

function main(root: string, check: boolean): number {
  const outputs = kmotionExampleOutputs()
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
  const dir = join(root, 'public/examples/kmotion')
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const rel = `public/examples/kmotion/${name}`
      if (wanted.has(rel) || !(name.endsWith('.kmotion') || name === 'index.json')) continue
      changed++
      if (check) console.error(`stale: ${rel}`)
      else {
        rmSync(join(dir, name))
        console.log(`removed ${rel}`)
      }
    }
  }
  console.log(check ? (changed ? `${changed} file(s) out of date` : 'up to date') : `${outputs.length} files in public/examples/kmotion (${changed} written or removed)`)
  return check && changed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = main(root, process.argv.includes('--check'))
}
