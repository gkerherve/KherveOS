// App AI tools: the registry, picking a window, which tools a model is offered,
// and the manifest's shape.  Run:  node --test tools/tests/app-tools.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AppToolRegistry, appsToOffer, describeApps, mentionedApps, pickWindow, runOf, splitToolName, toolName, waitUntil, withWindowArg,
  type AppToolContext,
} from '../../src/os/ai/appToolsCore.ts'
import { APP_TOOL_SETS } from '../../src/os/ai/appManifest.ts'

const ctx = (windowId: string): AppToolContext => ({
  caller: 'test',
  windowId,
  confirm: async () => true,
  allowPython: async () => true,
})

test('register, find and unregister a window\'s tools', async () => {
  const reg = new AppToolRegistry()
  let changes = 0
  const off = reg.subscribe(() => changes++)
  const un1 = reg.register('khervesheet', 'w1', { read_range: async () => ({ from: 'w1' }) })
  const un2 = reg.register('khervesheet', 'w2', { read_range: async () => ({ from: 'w2' }) })
  assert.deepEqual(reg.windows('khervesheet'), ['w1', 'w2'])
  assert.deepEqual(reg.apps(), ['khervesheet'])
  const impl = reg.impl('khervesheet', 'read_range', 'w2')
  assert.ok(impl)
  assert.deepEqual(await runOf(impl)({}, ctx('w2')), { from: 'w2' })
  assert.equal(reg.impl('khervesheet', 'nope', 'w1'), null)
  assert.equal(reg.impl('notepad', 'read_range', 'w1'), null)
  un1()
  un1() // twice is harmless
  assert.deepEqual(reg.windows('khervesheet'), ['w2'])
  un2()
  assert.deepEqual(reg.apps(), [])
  assert.equal(changes, 4)
  off()
  reg.register('notepad', 'w3', {})
  assert.equal(changes, 4, 'no calls after unsubscribing')
})

test('the latest registration of a window wins', async () => {
  const reg = new AppToolRegistry()
  reg.register('notepad', 'w1', { read: async () => 'old' })
  const un = reg.register('notepad', 'w1', { read: async () => 'new' })
  assert.equal(await runOf(reg.impl('notepad', 'read', 'w1')!)({}, ctx('w1')), 'new')
  un()
  assert.equal(await runOf(reg.impl('notepad', 'read', 'w1')!)({}, ctx('w1')), 'old')
})

test('tools the manifest does not list are offered with their own spec', () => {
  const reg = new AppToolRegistry()
  reg.register('khervedb', 'w1', {
    select_element: { description: 'Show an element.', inputSchema: { type: 'object', properties: { element: { type: 'string' } } }, run: async () => 1 },
    bare: async () => 2, // no spec: not offered on its own
  })
  reg.register('khervesheet', 'w2', { read_range: async () => 3 }) // in the manifest: not extra
  const extra = reg.extraSpecs(APP_TOOL_SETS)
  assert.deepEqual(
    extra.map((e) => toolName(e.app, e.spec.action)),
    ['khervedb_select_element'],
  )
})

test('waitFor resolves when a window registers, or gives up', async () => {
  const reg = new AppToolRegistry()
  const later = reg.waitFor('khervebook', null, 2000)
  setTimeout(() => reg.register('khervebook', 'w9', { list_cells: async () => [] }), 20)
  assert.equal(await later, 'w9')
  assert.equal(await reg.waitFor('khervebook', 'w9', 10), 'w9', 'already there')
  assert.equal(await reg.waitFor('khervebook', 'w10', 30), null, 'times out')
  const ac = new AbortController()
  const waiting = reg.waitFor('notepad', null, 5000, ac.signal)
  ac.abort()
  assert.equal(await waiting, null, 'aborted')
})

test('a call goes to the given window, else the front one offering tools', () => {
  const wins = [
    { id: 'w1', appId: 'khervesheet', z: 12 },
    { id: 'w2', appId: 'khervesheet', z: 15 },
    { id: 'w3', appId: 'khervesheet', z: 20, minimized: true },
    { id: 'w4', appId: 'notepad', z: 30 },
  ]
  assert.deepEqual(pickWindow('khervesheet', undefined, wins, ['w1', 'w2', 'w3']), { id: 'w2', open: true })
  // Only w1 is ready: it wins over the front window still loading.
  assert.deepEqual(pickWindow('khervesheet', undefined, wins, ['w1']), { id: 'w1', open: true })
  // None ready yet: the front one (the caller waits for it).
  assert.deepEqual(pickWindow('khervesheet', undefined, wins, []), { id: 'w2', open: true })
  assert.deepEqual(pickWindow('khervesheet', 'w3', wins, ['w3']), { id: 'w3', open: true })
  assert.match(pickWindow('khervesheet', 'w4', wins, []).error ?? '', /not a khervesheet window/)
  assert.match(pickWindow('khervesheet', 'w99', wins, []).error ?? '', /no window "w99"/)
  assert.deepEqual(pickWindow('khervebook', undefined, wins, []), { id: null, open: false })
})

test('tool names split into app and action', () => {
  const apps = APP_TOOL_SETS.map((s) => s.app)
  assert.deepEqual(splitToolName('khervesheet_set_cells', apps), { app: 'khervesheet', action: 'set_cells' })
  assert.deepEqual(splitToolName('Notepad_Read', apps), { app: 'notepad', action: 'read' })
  assert.equal(splitToolName('list_files', apps), null)
  assert.equal(splitToolName('files', apps), null)
  assert.deepEqual(splitToolName('files_select', apps), { app: 'files', action: 'select' })
})

test('small models are offered the tools of open and named apps only', () => {
  assert.deepEqual(mentionedApps('put 1..5 in A1:A5 of the sheet and sum them in A6', APP_TOOL_SETS), ['khervesheet'])
  assert.deepEqual(mentionedApps('Add a cell to my notebook that plots sin(x)', APP_TOOL_SETS).includes('khervebook'), true)
  assert.deepEqual(mentionedApps('Write a haiku in Notepad', APP_TOOL_SETS), ['notepad'])
  assert.deepEqual(mentionedApps('what is the capital of France?', APP_TOOL_SETS), [])
  assert.deepEqual(mentionedApps('Open KherveSheet', APP_TOOL_SETS), ['khervesheet'])
  // "notebook" is not "note"; "spreadsheets" is not "sheet" by accident but listed
  assert.equal(mentionedApps('my notebook', APP_TOOL_SETS).includes('notepad'), false)
  assert.deepEqual(appsToOffer(APP_TOOL_SETS, ['files', 'terminal'], 'hello'), ['files'])
  assert.deepEqual(appsToOffer(APP_TOOL_SETS, ['notepad'], 'fill the spreadsheet'), ['khervesheet', 'notepad'])
})

test('every app tool takes an optional window id', () => {
  const s = withWindowArg({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }, 'Notepad')
  assert.deepEqual(Object.keys(s.properties as object), ['a', 'window'])
  assert.deepEqual(s.required, ['a'])
  assert.equal(withWindowArg(s, 'Notepad'), s, 'added once')
})

test('the manifest is well formed and small', () => {
  const names = new Set<string>()
  for (const set of APP_TOOL_SETS) {
    assert.match(set.app, /^[a-z0-9]+$/, 'app ids have no "_" (tool names split on it)')
    assert.ok(set.summary.length < 120)
    for (const t of set.tools) {
      const name = toolName(set.app, t.action)
      assert.match(name, /^[A-Za-z0-9_-]{1,64}$/, `${name}: a name MCP accepts`)
      assert.ok(!names.has(name), `${name} is unique`)
      names.add(name)
      assert.ok(t.description.length > 20 && t.description.length < 300, `${name}: a short description`)
      assert.equal(t.inputSchema.type, 'object')
      const props = Object.keys((t.inputSchema.properties ?? {}) as object)
      assert.ok(props.length <= 5, `${name}: few arguments`)
      for (const r of (t.inputSchema.required ?? []) as string[]) assert.ok(props.includes(r), `${name}: "${r}" is described`)
    }
  }
  assert.ok(names.has('khervesheet_set_cells') && names.has('khervebook_run') && names.has('notepad_save') && names.has('files_select'))
  const lines = describeApps(APP_TOOL_SETS)
  assert.equal(lines.length, APP_TOOL_SETS.length)
  assert.match(lines[0], /^- KherveSheet: .* Tools: khervesheet_read_range, khervesheet_set_cells/)
})

test('waitUntil', async () => {
  let n = 0
  assert.equal(await waitUntil(() => ++n >= 3, 1000, undefined, 5), true)
  assert.equal(await waitUntil(() => false, 30, undefined, 5), false)
})
