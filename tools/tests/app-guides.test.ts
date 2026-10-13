// The app guides (src/os/ai/guides): every app of the registry has one, a guide
// only names tools that exist, the technique apps' guides mention each of their
// analyses, and the guides read well as text (the app_guide tool, the MCP
// resources). Starts nothing.
//
//   node --test tools/tests/app-guides.test.ts
//
// Adding an app? If this test fails with "needs a guide", add one entry: for a
// technique app in src/os/ai/guides/techniques.ts, otherwise in the file of its
// kind in src/os/ai/guides/ (see index.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { APP_TOOL_SETS } from '../../src/os/ai/appManifest.ts'
import { toolName } from '../../src/os/ai/appToolsCore.ts'
import { READ_ONLY_CORE, toMcpTool } from '../../src/os/ai/mcpCore.ts'
import {
  GROUP_ORDER, findGuideApp, groupsOf, guideAnswer, guideBundle, renderGuide, renderIndex, type AppGuide, type AppInfo,
} from '../../src/os/ai/guides/core.ts'
import { APP_GUIDES } from '../../src/os/ai/guides/index.ts'

const root = new URL('../../', import.meta.url)
const source = (path: string) => readFileSync(new URL(path, root), 'utf8')

/** The apps of src/os/registry.ts, with the tools of the manifests. */
function registryApps(): AppInfo[] {
  const text = source('src/os/registry.ts')
  const start = text.indexOf('export const APPS')
  const body = text.slice(start, text.indexOf('\n]\n', start))
  return body
    .split(/\n {2}\{\n/)
    .slice(1)
    .map((block): AppInfo => {
      const field = (key: string) => block.match(new RegExp(`^ {4}${key}: '((?:[^'\\\\]|\\\\.)*)'`, 'm'))?.[1].replace(/\\'/g, "'") ?? ''
      const id = field('id')
      const types = block.match(/^ {4}fileTypes: \[(.*)\]/m)?.[1] ?? ''
      return {
        id,
        name: field('name'),
        group: field('group'),
        description: field('description'),
        opens: [...types.matchAll(/'([^']*)'/g)].map((m) => m[1]).filter(Boolean),
        tools: APP_TOOL_SETS.filter((s) => s.app === id).flatMap((s) => s.tools.map((t) => toolName(s.app, t.action))),
      }
    })
}

const apps = registryApps()
const ids = new Set(apps.map((a) => a.id))
const infoOf = (id: string) => apps.find((a) => a.id === id)!
// The apps that have a guide (the first test reports the others; the rest checks what exists).
const covered = apps.filter((a) => APP_GUIDES.some((g) => g.app === a.id))
const coreNames = [...source('src/os/ai/tools.ts').matchAll(/^ {4}name: '([a-z_]+)'/gm)].map((m) => m[1])
const allTools = new Set([...coreNames, ...apps.flatMap((a) => a.tools)])

/** Everything a guide says, as one string. */
const textOf = (g: AppGuide) => [g.use, g.about, ...(g.concepts ?? []), ...g.workflow, ...(g.pitfalls ?? []), ...(g.writes ?? [])].join('\n')

test('the registry was read', () => {
  assert.ok(apps.length > 55, `found the apps of registry.ts (${apps.length})`)
  for (const a of apps) assert.ok(a.id && a.name && a.group && a.description, `${a.id}: id, name, group and description are read`)
})

test('every app of the registry has a guide', () => {
  const have = new Set(APP_GUIDES.map((g) => g.app))
  const missing = apps.filter((a) => !have.has(a.id))
  assert.deepEqual(
    missing.map((a) => a.id),
    [],
    missing
      .map((a) => `${a.name} (${a.id}, ${a.group}) needs a guide: add an entry to src/os/ai/guides/${a.group === 'Materials' ? 'techniques.ts (a technique app: one `technique({...})` entry, copy a neighbour) or materials.ts' : 'the file of its kind (science, office, system, games), listed in index.ts'}.`)
      .join('\n'),
  )
  const unknown = APP_GUIDES.filter((g) => !ids.has(g.app)).map((g) => g.app)
  assert.deepEqual(unknown, [], 'every guide is for an app of the registry')
  assert.equal(have.size, APP_GUIDES.length, 'one guide per app')
})

test('each guide is complete and compact', () => {
  for (const g of APP_GUIDES) {
    const where = `guide of ${g.app}`
    assert.ok(g.use.length >= 15 && g.use.length <= 120, `${where}: "use" is one line of at most 120 characters (${g.use.length})`)
    assert.ok(g.about.length >= 30 && g.about.length <= 450, `${where}: "about" is two or three sentences, at most 450 characters (${g.about.length})`)
    assert.ok(g.workflow.length >= 1, `${where}: a workflow`)
    assert.ok(g.workflow.every((s) => s.length > 10), `${where}: workflow steps say something`)
    const info = infoOf(g.app)
    if (info.group !== 'Games') assert.ok((g.concepts?.length ?? 0) >= 1, `${where}: concepts (units, naming, where results are)`)
    const text = renderGuide(g, info, apps)
    assert.ok(text.length <= 6500, `${where}: ${text.length} characters when rendered, at most 6500 (the depth goes in a few lines, not a manual)`)
  }
})

test('guides only name tools that exist', () => {
  for (const g of APP_GUIDES) {
    for (const m of textOf(g).matchAll(/`([a-z0-9]+_[a-z0-9_]+)`/g)) {
      const word = m[1]
      const prefix = word.split('_')[0]
      if (ids.has(prefix)) assert.ok(allTools.has(word), `guide of ${g.app}: \`${word}\` is not a tool (the tools of ${prefix} are ${infoOf(prefix).tools.join(', ')})`)
      if (coreNames.includes(word)) continue
    }
    // An app's guide mostly talks about its own tools.
    if (infoOf(g.app).tools.length) {
      assert.ok(infoOf(g.app).tools.some((t) => textOf(g).includes('`' + t + '`')), `guide of ${g.app} names at least one of its own tools`)
    }
  }
})

test('"works with" names other apps of the registry', () => {
  for (const g of APP_GUIDES) {
    for (const [id, how] of g.with ?? []) {
      assert.ok(ids.has(id), `guide of ${g.app}: works with "${id}", which is not an app id of the registry`)
      assert.notEqual(id, g.app, `guide of ${g.app}: works with itself`)
      assert.ok(how.length > 5, `guide of ${g.app}: say how it works with ${id}`)
    }
  }
})

test('a technique app\'s guide mentions every analysis of its run tool', () => {
  const checked: string[] = []
  for (const set of APP_TOOL_SETS) {
    const run = set.tools.find((t) => t.action === 'run')
    const props = (run?.inputSchema.properties ?? {}) as Record<string, { enum?: string[] }>
    const actions = props.action?.enum
    if (!actions) continue
    const guide = APP_GUIDES.find((g) => g.app === set.app)
    assert.ok(guide, `${set.app} has a guide`)
    const text = textOf(guide)
    const missing = actions.filter((a) => !new RegExp(`(^|[^a-z0-9_])${a}([^a-z0-9_]|$)`).test(text))
    assert.deepEqual(missing, [], `the guide of ${set.app} must say when to use these \`run\` actions: ${missing.join(', ')}`)
    checked.push(set.app)
  }
  for (const app of ['khervetga', 'khervebet', 'kherveuvvis', 'kherveftir', 'kherveraman', 'khervedilatometer']) {
    assert.ok(checked.includes(app), `${app}'s run actions were checked`)
  }
})

test('the technique guides carry what they share', () => {
  for (const app of ['khervetga', 'khervebet', 'kherveuvvis', 'kherveftir', 'kherveraman', 'khervedilatometer']) {
    const g = APP_GUIDES.find((x) => x.app === app)!
    const text = textOf(g)
    assert.match(text, /\.kfit/, `${app}: the .kfit project`)
    assert.match(text, new RegExp(`${app}_open_example`), `${app}: starts from an example`)
    assert.match(text, new RegExp(`${app}_get_results`), `${app}: reads the results`)
    assert.match(text, /Examples/, `${app}: where the examples are`)
  }
  // Sheet naming, as the parity documents have it.
  const sheets: Record<string, string[]> = {
    khervetga: ['TGA~Mass'], khervebet: ['BET~Plot'], kherveuvvis: ['UVvis~Tauc'], kherveftir: ['FTIR1'], kherveraman: ['Raman_'], khervedilatometer: ['DIL~Heat'],
  }
  for (const [app, names] of Object.entries(sheets)) {
    for (const name of names) assert.ok(textOf(APP_GUIDES.find((x) => x.app === app)!).includes(name), `${app}: sheet ${name}`)
  }
})

test('the index lists every app by group', () => {
  const index = renderIndex(APP_GUIDES, apps)
  for (const a of covered) assert.ok(index.includes(`- ${a.id} (${a.name}): `), `${a.id} is in the index`)
  const groups = groupsOf(apps)
  assert.deepEqual(groups.filter((g) => !GROUP_ORDER.includes(g)), [], 'every registry group has a place in GROUP_ORDER')
  let at = 0
  for (const group of groupsOf(covered)) {
    const pos = index.indexOf(`## ${group}\n`)
    assert.ok(pos > at, `group ${group} is listed, in order`)
    at = pos
  }
  assert.ok(index.length <= 13000, `the index is compact (${index.length} characters)`)
})

test('app_guide answers by id, by name, and without an argument', () => {
  const index = guideAnswer(undefined, APP_GUIDES, apps)
  assert.equal(guideAnswer('  ', APP_GUIDES, apps), index)
  for (const query of ['kherveftir', 'kFTIR', 'kftir', 'KherveFTIR', 'Meteor Smash', 'asteroids']) {
    assert.ok(findGuideApp(query, apps), `${query} finds an app`)
  }
  assert.equal(findGuideApp('kFTIR', apps)?.id, 'kherveftir')
  assert.equal(findGuideApp('ftir', apps)?.id, 'kherveftir')
  assert.equal(findGuideApp('kText', apps)?.id, 'notepad')
  const text = guideAnswer('kBET', APP_GUIDES, apps)
  assert.match(text, /^# kBET \(khervebet\) - Materials/)
  assert.match(text, /Workflow:\n1\. /)
  assert.match(text, /Tools: khervebet_open_file/)
  assert.match(text, /Works with:\n- kPlot \(kplot\)/)
  assert.throws(() => guideAnswer('nonexistent', APP_GUIDES, apps), /no app "nonexistent".*khervebet/)
})

test('the guides travel to the server as a bundle that fits', () => {
  const bundle = guideBundle(APP_GUIDES, apps)
  assert.equal(Object.keys(bundle.apps).length, covered.length)
  assert.equal(bundle.apps.khervebet.name, 'kBET')
  assert.equal(bundle.apps.khervebet.group, 'Materials')
  assert.equal(bundle.apps.khervebet.text, guideAnswer('khervebet', APP_GUIDES, apps))
  assert.equal(bundle.index, guideAnswer(undefined, APP_GUIDES, apps))
  const size = JSON.stringify(bundle).length
  const limit = Number(source('server/kherveos_server/mcp_server.py').match(/^MAX_GUIDES_JSON = (\d+) \* (\d+)/m)?.slice(1).reduce((a, b) => Number(a) * Number(b)))
  assert.ok(limit > 0, 'MAX_GUIDES_JSON is in mcp_server.py')
  assert.ok(size * 2 <= limit, `${size} bytes of guides, at most half of the server's ${limit} (room for the apps to come)`)
  console.log(`${covered.length} guides, ${size} bytes as sent to the server (limit ${limit}), index ${bundle.index.length} characters`)
})

test('app_guide is a read-only core tool, and list_apps tells the group', () => {
  assert.ok(coreNames.includes('app_guide'), 'app_guide is a core tool')
  assert.ok(READ_ONLY_CORE.has('app_guide'), 'app_guide is read-only for MCP annotations')
  const tool = toMcpTool({ name: 'app_guide', description: 'x', inputSchema: { type: 'object', properties: {} } })
  assert.equal(tool.annotations.readOnlyHint, true)
  assert.equal(tool.annotations.destructiveHint, undefined)
  const tools = source('src/os/ai/tools.ts')
  assert.match(tools, /id: app\.id, name: app\.name, group: app\.group/, 'list_apps returns the group')
  const description = tools.match(/name: 'app_guide',\s*description:\s*([\s\S]*?),\n\s*inputSchema/)?.[1] ?? ''
  assert.ok(description.length > 0 && description.length < 500, `app_guide's description is short (${description.length} characters)`)
  assert.match(source('src/os/ai/mcpBridge.ts'), /guides/, 'the bridge sends the guides')
})
