// Writes the example files of kReaction, kElec and kPCB to public/examples/<app>/ (the files the apps copy into
// ~/Documents/<App> Examples on first use, see src/os/exampleFiles.ts), plus each folder's index.json.
//
//   node tools/export_app_examples.ts          write (or refresh) the files
//   node tools/export_app_examples.ts --check  exit 1 when a file on disk differs from what would be written
//
// The output is deterministic (ids numbered in order, keys in a fixed order, 2-space indent), so the files can be
// regenerated at any time and a diff shows only real changes. Never edit them by hand. The pure function
// `appExampleOutputs()` is what tools/tests/app-examples.test.ts checks; importing this module writes nothing.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ExampleSource } from '../src/os/exampleFiles.ts'
import { kelecExampleFiles, KELEC_EXAMPLES_FOLDER } from '../src/apps/kelec/exampleFiles.ts'
import { kpcbExampleFiles, KPCB_EXAMPLES_FOLDER } from '../src/apps/kpcb/exampleFiles.ts'
import { kreactionExampleFiles, KREACTION_EXAMPLES_FOLDER } from '../src/apps/kreaction/exampleFiles.ts'

export interface AppExamples {
  /** The folder of public/examples/ (also the app's registry id). */
  app: string
  /** The folder made in ~/Documents. */
  folder: string
  /** File extension of the app's files, without the dot. */
  ext: string
  files: ExampleSource[]
}

export interface Output {
  /** Path relative to the project root: public/examples/kelec/01 Voltage divider.kelec */
  path: string
  content: string
}

/** What every app's examples are: the pure part of this script. */
export function appExamples(): AppExamples[] {
  return [
    { app: 'kreaction', folder: KREACTION_EXAMPLES_FOLDER, ext: 'kreact', files: kreactionExampleFiles() },
    { app: 'kelec', folder: KELEC_EXAMPLES_FOLDER, ext: 'kelec', files: kelecExampleFiles() },
    { app: 'kpcb', folder: KPCB_EXAMPLES_FOLDER, ext: 'kpcb', files: kpcbExampleFiles() },
  ]
}

/** The text of an app's index.json: the list the apps read to copy the files and to build their menus. */
export function indexText(a: AppExamples): string {
  const examples = a.files.map((f) => ({ file: f.file, title: f.title, description: f.description ?? '', ...(f.group ? { group: f.group } : {}) }))
  return JSON.stringify({ app: a.app, folder: a.folder, examples }, null, 2) + '\n'
}

/** Every file to write, with its content. */
export function appExampleOutputs(): Output[] {
  return appExamples().flatMap((a) => [
    ...a.files.map((f) => ({ path: `public/examples/${a.app}/${f.file}`, content: f.content })),
    { path: `public/examples/${a.app}/index.json`, content: indexText(a) },
  ])
}

function main(root: string, check: boolean): number {
  const outputs = appExampleOutputs()
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
  for (const a of appExamples()) {
    const dir = join(root, 'public/examples', a.app)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const rel = `public/examples/${a.app}/${name}`
      if (wanted.has(rel) || !(name.endsWith(`.${a.ext}`) || name === 'index.json')) continue
      changed++
      if (check) console.error(`stale: ${rel}`)
      else {
        rmSync(join(dir, name))
        console.log(`removed ${rel}`)
      }
    }
  }
  console.log(check ? (changed ? `${changed} file(s) out of date` : 'up to date') : `${outputs.length} files in public/examples (${changed} written or removed)`)
  return check && changed ? 1 : 0
}

// run only when started as a script (not when a test imports the functions above)
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = main(root, process.argv.includes('--check'))
}
