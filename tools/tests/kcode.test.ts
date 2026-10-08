// kCode: the curriculum (every lesson's checks are run, in real Python and real JavaScript),
// the markdown reader, the progress store and the check helpers.  Run:
//   node --test tools/tests/kcode.test.ts
// Python lessons run with the system python3 (-I); lessons needing numpy/scipy/matplotlib/pandas
// are skipped, with a note, where those are not installed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COURSES, LESSONS, lessonById, neighbour, placeOf, searchLessons } from '../../src/apps/kcode/lessons.ts'
import type { Lesson, Need } from '../../src/apps/kcode/lessons.ts'
import { parseInline, parseMarkdown, plainText } from '../../src/apps/kcode/markdown.ts'
import type { Block, Inline } from '../../src/apps/kcode/markdown.ts'
import {
  DEFAULT_PREFS, ProgressStore, dayKey, loadPrefs, savePrefs, streaks, type KeyValueStorage,
} from '../../src/apps/kcode/progress.ts'
import {
  formatChecks, inputShim, parsePythonChecks, pyErrorLine, pythonHarness, stripCheckMark, summarizeChecks, usesInput,
  type CheckResult,
} from '../../src/apps/kcode/checks.ts'
import { JS_WORKER_SOURCE } from '../../src/apps/kcode/jsworker.ts'
import { lessonNotebook } from '../../src/apps/kcode/notebook.ts'
import { MAX_OUTPUT_CHARS, emptyReport, errorLine, pushSeg, reportText, type Seg } from '../../src/apps/kcode/report.ts'
import { src } from '../../src/apps/kcode/lessonTypes.ts'

// ---------------------------------------------------------------- JavaScript runner

interface WorkerMessage { type: string; [key: string]: unknown }

/** Run the real worker program with a fake `self`. */
async function runJs(code: string, checks: { label: string; test: string }[] = []): Promise<{ logs: string[]; done: WorkerMessage }> {
  const logs: string[] = []
  let finish!: (m: WorkerMessage) => void
  const done = new Promise<WorkerMessage>((r) => { finish = r })
  const self: Record<string, unknown> = {
    postMessage: (m: WorkerMessage) => {
      if (m.type === 'log') logs.push(String(m.text))
      else if (m.type === 'done') finish(m)
    },
    setTimeout, setInterval, clearTimeout, clearInterval,
  }
  new Function('self', JS_WORKER_SOURCE)(self)
  ;(self.onmessage as (e: unknown) => void)({ data: { code, checks } })
  const timeout = new Promise<WorkerMessage>((_, rej) => setTimeout(() => rej(new Error('the program did not finish')), 4000).unref())
  return { logs, done: await Promise.race([done, timeout]) }
}

const resultsOf = (m: WorkerMessage) => (m.checks as CheckResult[] | undefined) ?? []

// ---------------------------------------------------------------- Python runner

function hasPython(): boolean {
  return spawnSync('python3', ['-I', '-c', '1'], { encoding: 'utf8' }).status === 0
}
const PY = hasPython()
const available = new Map<string, boolean>()
function haveModule(name: string): boolean {
  if (!available.has(name)) available.set(name, PY && spawnSync('python3', ['-I', '-c', `import ${name}`], { encoding: 'utf8' }).status === 0)
  return available.get(name)!
}
const missingFor = (needs: Need[] = []) => needs.filter((n) => !haveModule(n))

const sandbox = PY ? mkdtempSync(join(tmpdir(), 'kcode-test-')) : ''

interface PyOutcome { error: string | null; output: string; results: CheckResult[] | null; stderr: string }

/** What kCode does: run the code in a namespace, then the checks in the same namespace. */
function runPython(code: string, checks: { label: string; test: string }[] = []): PyOutcome {
  // Two passes: the learner's code (to get its printed text), then the same code with the harness.
  const first = spawnPy(wrap(code, null))
  const m = /\x1dOUT(.*)\n/.exec(first.stdout)
  if (!m) return { error: first.stderr || 'python produced nothing', output: '', results: null, stderr: first.stderr }
  const info = JSON.parse(m[1]) as { error: string | null; output: string }
  if (info.error !== null || !checks.length) return { error: info.error, output: info.output, results: null, stderr: first.stderr }
  const second = spawnPy(wrap(code, pythonHarness(checks, info.output)))
  const results = parsePythonChecks(second.stdout)
  return { error: null, output: info.output, results, stderr: second.stderr }
}

function wrap(code: string, harness: string | null): string {
  const lit = (s: string) => JSON.stringify(JSON.stringify(s))
  return `
import contextlib, io, json, traceback
ns = {"__name__": "__main__"}
buf = io.StringIO()
error = None
try:
    with contextlib.redirect_stdout(buf):
        exec(compile(json.loads(${lit(code)}), "<cell>", "exec"), ns)
except BaseException:
    error = traceback.format_exc()
print("\\x1dOUT" + json.dumps({"error": error, "output": buf.getvalue()}))
${harness === null ? '' : `if error is None:\n    exec(compile(json.loads(${lit(harness)}), "<harness>", "exec"), ns)`}
`
}

function spawnPy(script: string): { stdout: string; stderr: string } {
  const file = join(sandbox, 'run.py')
  writeFileSync(file, script)
  const r = spawnSync('python3', ['-I', file], {
    cwd: sandbox, encoding: 'utf8', timeout: 90_000,
    env: { PATH: process.env.PATH ?? '', HOME: sandbox, MPLBACKEND: 'Agg', MPLCONFIGDIR: join(sandbox, 'mpl') },
  })
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// ---------------------------------------------------------------- the curriculum

test('lessons are well formed: unique ids, valid fields, text and code', () => {
  const ids = new Set<string>()
  for (const l of LESSONS) {
    assert.ok(/^[a-z][a-z0-9-]*$/.test(l.id), `${l.id}: id is lower-case words with dashes`)
    assert.ok(!ids.has(l.id), `${l.id}: unique id`)
    ids.add(l.id)
    assert.ok(l.language === 'python' || l.language === 'javascript', `${l.id}: language`)
    assert.ok(['beginner', 'intermediate', 'advanced'].includes(l.level), `${l.id}: level`)
    assert.ok(Number.isInteger(l.minutes) && l.minutes > 0 && l.minutes <= 30, `${l.id}: minutes`)
    for (const f of ['title', 'text', 'code'] as const) assert.ok(l[f].trim().length > 0, `${l.id}: ${f} is not empty`)
    assert.ok(l.text.length > 80, `${l.id}: the explanation says something`)
    assert.ok(l.code.endsWith('\n'), `${l.id}: starter code ends with a newline`)
  }
})

test('the curriculum has courses, chapters and enough lessons', () => {
  assert.ok(LESSONS.length >= 40, `${LESSONS.length} lessons`)
  assert.deepEqual(COURSES.map((c) => c.id), ['python-basics', 'python-science', 'javascript-basics', 'lab-recipes'])
  for (const c of COURSES) {
    assert.ok(c.chapters.length >= 2, `${c.id} has chapters`)
    for (const ch of c.chapters) assert.ok(ch.lessons.length >= 1, `${ch.id} has lessons`)
  }
  assert.ok(LESSONS.filter((l) => l.language === 'python').length >= 25)
  assert.ok(LESSONS.filter((l) => l.language === 'javascript').length >= 10)
  assert.ok(LESSONS.filter((l) => l.checks?.length).length >= 35, 'most lessons are exercises')
})

test('the lesson ids of the first kCode are kept', () => {
  for (const id of ['py-hello', 'py-variables', 'py-lists', 'py-functions', 'py-data', 'js-hello', 'js-variables', 'js-functions']) {
    assert.ok(lessonById(id), id)
  }
  assert.equal(lessonById('py-hello')!.language, 'python')
  assert.equal(lessonById('js-hello')!.language, 'javascript')
})

test('exercises come with a task, a hint and a solution; others at least run', () => {
  for (const l of LESSONS) {
    if (l.checks?.length) {
      assert.ok(l.task && l.task.length > 20, `${l.id}: a task`)
      assert.ok(l.hint && l.hint.length > 10, `${l.id}: a hint`)
      assert.ok(l.solution && l.solution.trim().length > 10, `${l.id}: a solution`)
      assert.notEqual(l.solution, l.code, `${l.id}: the solution differs from the starter`)
      for (const c of l.checks) assert.ok(c.label.trim() && c.test.trim(), `${l.id}: check ${c.label}`)
    }
    if (l.language === 'javascript') assert.ok(!l.needs?.length, `${l.id}: JavaScript needs no packages`)
  }
})

test('lesson texts read as markdown without surprises', () => {
  for (const l of LESSONS) {
    const blocks = parseMarkdown(l.text)
    assert.ok(blocks.length >= 2, `${l.id}: blocks`)
    const fences = (l.text.match(/^```/gm) ?? []).length
    assert.equal(fences % 2, 0, `${l.id}: code fences are paired`)
    assert.ok(!/<\s*script/i.test(l.text), `${l.id}: no html`)
  }
})

test('neighbours, places and search', () => {
  assert.equal(neighbour(LESSONS[0].id, -1), null)
  assert.equal(neighbour(LESSONS[0].id, 1), LESSONS[1])
  assert.equal(neighbour(LESSONS.at(-1)!.id, 1), null)
  assert.equal(placeOf('py-lists')!.course.id, 'python-basics')
  assert.ok(searchLessons('closure').some((l) => l.id === 'js-closures'))
  assert.ok(searchLessons('numpy scipy').length === 0 || searchLessons('numpy scipy').every((l) => l.language === 'python'))
  assert.equal(searchLessons('').length, LESSONS.length)
  assert.equal(searchLessons('zzzzqqq').length, 0)
})

for (const lesson of LESSONS.filter((l) => l.language === 'javascript')) {
  test(`JavaScript lesson ${lesson.id}: the starter runs${lesson.checks ? ', the solution passes and the starter does not' : ''}`, async () => {
    const starter = await runJs(lesson.code, lesson.checks)
    assert.equal(starter.done.ok, true, `${lesson.id}: the starter code runs (${JSON.stringify(starter.done.error)})`)
    if (!lesson.checks) return
    const before = resultsOf(starter.done)
    assert.equal(before.length, lesson.checks.length)
    assert.ok(before.some((r) => !r.ok), `${lesson.id}: the starter does not pass every check`)
    const solved = await runJs(lesson.solution!, lesson.checks)
    assert.equal(solved.done.ok, true, `${lesson.id}: the solution runs (${JSON.stringify(solved.done.error)})`)
    const after = resultsOf(solved.done)
    assert.deepEqual(after.filter((r) => !r.ok), [], `${lesson.id}: the solution passes its checks`)
  })
}

for (const lesson of LESSONS.filter((l) => l.language === 'python')) {
  test(`Python lesson ${lesson.id}: the starter runs${lesson.checks ? ', the solution passes and the starter does not' : ''}`, (t) => {
    if (!PY) return t.skip('python3 is not installed')
    const missing = missingFor(lesson.needs)
    if (missing.length) return t.skip(`needs ${missing.join(', ')}: not installed here`)
    const starter = runPython(lesson.code, lesson.checks)
    // A starter may stop with an error (a blank to fill); it must never pass every check.
    if (starter.error === null) assert.ok(starter.output !== undefined)
    if (!lesson.checks) {
      assert.equal(starter.error, null, `${lesson.id}: the starter runs:\n${starter.error}`)
      return
    }
    const startPassed = starter.error === null && starter.results !== null && starter.results.length === lesson.checks.length && starter.results.every((r) => r.ok)
    assert.equal(startPassed, false, `${lesson.id}: the starter must not pass all the checks`)
    const solved = runPython(lesson.solution!, lesson.checks)
    assert.equal(solved.error, null, `${lesson.id}: the solution runs:\n${solved.error}\n${solved.stderr}`)
    assert.ok(solved.results, `${lesson.id}: the checks ran\n${solved.stderr}`)
    assert.equal(solved.results!.length, lesson.checks.length)
    assert.deepEqual(solved.results!.filter((r) => !r.ok), [], `${lesson.id}: the solution passes its checks`)
  })
}

// ---------------------------------------------------------------- the JavaScript worker

test('worker: console output, values and the last expression', async () => {
  const r = await runJs('console.log("a", 1, [1, 2], { x: 1 });\nconsole.warn("w");\nconsole.error("e");\n2 + 3')
  assert.deepEqual(r.logs, ["a 1 [ 1, 2 ] { x: 1 }", 'w', 'e'])
  assert.equal(r.done.ok, true)
  assert.equal(r.done.value, '5')
})

test('worker: values are shown like a console would', async () => {
  const r = await runJs('console.log(new Map([["a", 1]]), new Set([1]), null, undefined, -0, 10n, [undefined, null], "s");\nconsole.log([ "x" ], { "a-b": 1 }, function f() {}, class A {}, new Error("boom"));')
  assert.equal(r.logs[0], "Map(1) { 'a' => 1 } Set(1) { 1 } null undefined -0 10n [ undefined, null ] s")
  assert.equal(r.logs[1], "[ 'x' ] { 'a-b': 1 } [Function: f] [class A] Error: boom")
})

test('worker: circular structures and long arrays do not hang', async () => {
  const r = await runJs('const a = { n: 1 }; a.self = a; console.log(a);\nconsole.log(Array.from({ length: 150 }, (_, i) => i).length, [1,2,3].concat(Array(0)));\nArray.from({length: 120}, (_, i) => i)')
  assert.equal(r.logs[0], '{ n: 1, self: [Circular] }')
  assert.match(String(r.done.value), /\.\.\. 20 more items/)
})

test('worker: console.table draws a table', async () => {
  const r = await runJs('console.table([{ a: 1, b: "x" }, { a: 2, b: "y" }])')
  assert.match(r.logs[0], /┌/)
  assert.match(r.logs[0], /\(index\)/)
  assert.match(r.logs[0], /'x'/)
})

test('worker: the value of the last expression is only shown for expressions', async () => {
  assert.equal((await runJs('const x = 4;\nx * 2')).done.value, '8')
  assert.equal((await runJs('const x = 4;')).done.value, undefined)
  assert.equal((await runJs('function f() { return 1 }')).done.value, undefined)
  assert.equal((await runJs('const x = [1,2,3]\n// done\n\nx.map((n) => n * 2)')).done.value, '[ 2, 4, 6 ]')
  assert.equal((await runJs('"hi"')).done.value, "'hi'")
  assert.equal((await runJs('await Promise.resolve(7)')).done.value, '7')
  assert.equal((await runJs('console.log(1)')).done.value, undefined)
  assert.equal((await runJs('let a = 1;\nfor (let i = 0; i < 3; i++) {\n  a += i;\n}')).done.value, undefined)
})

test('worker: top-level await and timers are waited for', async () => {
  const r = await runJs('const pause = (ms) => new Promise((r) => setTimeout(r, ms));\nconsole.log("a");\nawait pause(20);\nconsole.log("b");\nsetTimeout(() => console.log("c"), 30);')
  assert.deepEqual(r.logs, ['a', 'b', 'c'])
  assert.equal(r.done.ok, true)
})

test('worker: errors name the line of the learner\'s code', async () => {
  const r = await runJs('const a = 1;\nconst b = 2;\nnull.x;\n')
  assert.equal(r.done.ok, false)
  const err = r.done.error as { name: string; message: string; line: number }
  assert.equal(err.name, 'TypeError')
  assert.equal(err.line, 3)
  const inner = await runJs('function f() {\n  throw new RangeError("bad");\n}\n\nf();')
  assert.equal((inner.done.error as { line: number }).line, 2)
  assert.equal((inner.done.error as { name: string }).name, 'RangeError')
})

test('worker: a syntax error is reported with its line', async () => {
  const r = await runJs('const a = 1;\nconst b = ;\nconsole.log(a);')
  assert.equal(r.done.ok, false)
  const err = r.done.error as { name: string; line: number | null }
  assert.equal(err.name, 'SyntaxError')
  assert.equal(err.line, 2)
})

test('worker: checks see the code\'s variables, functions and logs', async () => {
  const checks = [
    { label: 'x is 3', test: 'x === 3' },
    { label: 'f works', test: 'f(2) === 4' },
    { label: 'wrong', test: 'x === 4' },
    { label: 'explained', test: 'x === 4 || "x is " + x' },
    { label: 'throws', test: 'missing.thing' },
    { label: 'logged', test: '__logs.includes("hello")' },
    { label: 'async', test: '(await Promise.resolve(1)) === 1' },
  ]
  const r = await runJs('const x = 3;\nfunction f(n) { return n * 2 }\nconsole.log("hello")', checks)
  const res = resultsOf(r.done)
  assert.deepEqual(res.map((c) => c.ok), [true, true, false, false, false, true, true])
  assert.equal(res[3].detail, 'x is 3')
  assert.match(res[4].detail, /ReferenceError/)
})

test('worker: a thrown error stops the checks', async () => {
  const r = await runJs('throw new Error("nope")', [{ label: 'x', test: 'true' }])
  assert.equal(r.done.ok, false)
  assert.equal(resultsOf(r.done).length, 0)
})

test('worker: code that looks like it could be a split expression is left alone', async () => {
  const r = await runJs('const r = [1, 2, 3]\n  .map((x) => x * 2)\nconsole.log(r)')
  assert.deepEqual(r.logs, ['[ 2, 4, 6 ]'])
  const fn = await runJs('foo()\nfunction foo() { console.log("hoisted") }', [{ label: 'foo exists', test: 'typeof foo === "function"' }])
  assert.deepEqual(fn.logs, ['hoisted'])
  assert.equal(resultsOf(fn.done)[0].ok, true)
})

// ---------------------------------------------------------------- Python helpers

test('pyErrorLine finds the learner\'s line in a traceback', () => {
  const tb = 'Traceback (most recent call last):\n  File "<cell>", line 7, in <module>\n  File "<cell>", line 3, in f\nValueError: bad'
  assert.equal(pyErrorLine(tb), 3)
  assert.equal(pyErrorLine('  File "<cell>", line 2\n    x = \n        ^\nSyntaxError: invalid syntax'), 2)
  assert.equal(pyErrorLine('ZeroDivisionError'), null)
})

test('usesInput sees input() calls but not comments or other names', () => {
  assert.equal(usesInput('name = input("Name? ")'), true)
  assert.equal(usesInput('x = int(input())'), true)
  assert.equal(usesInput('# input("x")\nprint(1)'), false)
  assert.equal(usesInput('print(user_input(3), self.input(2))'), false)
})

test('the input shim answers from the list and then fails clearly', (t) => {
  if (!PY) return t.skip('python3 is not installed')
  const code = inputShim(['Ada', '42']) + '\nprint(input("Name: "), int(input()) + 1)\ntry:\n    input()\nexcept EOFError as e:\n    print("EOF", "answers" in str(e))\n'
  const r = spawnPy(code)
  assert.match(r.stdout, /Name: Ada\n42\nAda 43\nEOF True/)
})

test('the Python harness reports each check with a readable reason', (t) => {
  if (!PY) return t.skip('python3 is not installed')
  const checks = [
    { label: 'ok', test: 'assert x == 1' },
    { label: 'assert', test: 'assert x == 2' },
    { label: 'message', test: 'assert x == 2, f"x is {x}"' },
    { label: 'name', test: 'assert nothing_here' },
    { label: 'output', test: 'assert "hi" in OUTPUT' },
    { label: 'noisy', test: 'print("hello")\nassert True' },
  ]
  const out = runPython('x = 1\nprint("hi")', checks)
  assert.equal(out.error, null)
  assert.ok(out.results)
  assert.deepEqual(out.results!.map((r) => r.ok), [true, false, false, false, true, true])
  assert.match(out.results![1].detail, /did not hold: assert x == 2/)
  assert.equal(out.results![2].detail, 'AssertionError: x is 1'.replace('AssertionError: ', ''))
  assert.match(out.results![3].detail, /NameError/)
  assert.equal(stripCheckMark('a\n\u001eKCHECK[]\nb'), 'a\nb')
})

test('a learner\'s error stops before the checks', (t) => {
  if (!PY) return t.skip('python3 is not installed')
  const out = runPython('x = 1\nprint(1/0)', [{ label: 'x', test: 'assert x == 1' }])
  assert.match(out.error ?? '', /ZeroDivisionError/)
  assert.equal(out.results, null)
})

test('check results are summed up in plain words', () => {
  const r = (ok: boolean, label: string, detail = ''): CheckResult => ({ ok, label, detail })
  assert.equal(summarizeChecks([r(true, 'a'), r(true, 'b')]).headline, 'All 2 checks passed')
  assert.equal(summarizeChecks([r(true, 'a')]).headline, 'The check passed')
  assert.equal(summarizeChecks([r(false, 'a'), r(false, 'b')]).headline, 'None of the 2 checks passed yet')
  assert.equal(summarizeChecks([r(true, 'a'), r(true, 'b'), r(true, 'c'), r(false, 'd')]).headline, '3 of 4 checks passed')
  assert.equal(summarizeChecks([r(true, 'a'), r(false, 'b')]).allPassed, false)
  assert.equal(summarizeChecks([]).allPassed, false)
  const text = formatChecks([r(true, 'a'), r(true, 'b'), r(true, 'c'), r(false, 'double(3) returns 6', 'got 5')])
  assert.equal(text.split('\n')[0], '3 of 4 checks passed: double(3) returns 6 (got 5) still fails')
  assert.ok(text.includes('✓ a'))
  assert.ok(text.includes('✗ double(3) returns 6 — got 5'))
})

// ---------------------------------------------------------------- markdown

const textOf = (nodes: Inline[]): string => nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.s : textOf(n.c))).join('')

test('markdown: headings, paragraphs, lists, quotes, code blocks', () => {
  const md = '# Title\n\nSome **bold**, *italic* and `code` text\nthat continues.\n\n- one\n- two\n  more\n\n1. first\n2. second\n\n> quoted\n\n```python\nprint("x")\n```\n\n---'
  const blocks = parseMarkdown(md)
  assert.deepEqual(blocks.map((b) => b.t), ['h', 'p', 'ul', 'ol', 'quote', 'code', 'hr'])
  const p = blocks[1] as Extract<Block, { t: 'p' }>
  assert.deepEqual(p.c.map((n) => n.t), ['text', 'b', 'text', 'i', 'text', 'code', 'text'])
  assert.equal(textOf(p.c), 'Some bold, italic and code text that continues.')
  const ul = blocks[2] as Extract<Block, { t: 'ul' }>
  assert.equal(ul.items.length, 2)
  assert.equal(textOf(ul.items[1]), 'two more')
  const code = blocks[5] as Extract<Block, { t: 'code' }>
  assert.equal(code.lang, 'python')
  assert.equal(code.text, 'print("x")')
})

test('markdown: HTML stays text, nothing is ever an element', () => {
  const evil = '<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>hi</b>**\n\n```\n<div onclick="x()">\n```\n\n[click](javascript:alert(1)) [ok](https://example.org/a?b=1)'
  const blocks = parseMarkdown(evil)
  const kinds = new Set<string>()
  const visit = (n: Inline) => { kinds.add(n.t); if ('c' in n) n.c.forEach(visit) }
  for (const b of blocks) if ('c' in b) b.c.forEach(visit)
  assert.ok([...kinds].every((k) => ['text', 'code', 'b', 'i', 'a'].includes(k)), [...kinds].join())
  const first = blocks[0] as Extract<Block, { t: 'p' }>
  assert.ok(textOf(first.c).startsWith('<script>alert(1)</script> <img src=x onerror=alert(1)> <b>hi</b>'))
  const code = blocks[1] as Extract<Block, { t: 'code' }>
  assert.equal(code.text, '<div onclick="x()">')
  const links: string[] = []
  const grab = (n: Inline) => { if (n.t === 'a') links.push(n.href); if ('c' in n) n.c.forEach(grab) }
  for (const b of blocks) if ('c' in b) b.c.forEach(grab)
  assert.deepEqual(links, ['https://example.org/a?b=1'], 'only http(s) links become links')
  assert.ok(textOf((blocks[2] as Extract<Block, { t: 'p' }>).c).includes('[click](javascript:alert(1))'))
})

test('markdown: unfinished markup is kept as typed, escapes work', () => {
  assert.equal(textOf(parseInline('a * b and **open and `tick')), 'a * b and **open and `tick')
  assert.equal(textOf(parseInline('2 \\* 3 \\`x\\`')), '2 * 3 `x`')
  assert.equal(textOf(parseInline('snake_case_name')), 'snake_case_name')
  assert.equal(plainText(parseMarkdown('# A\n\n- b\n- c\n\n```\nd\n```')), 'A\nb\nc\nd')
})

// ---------------------------------------------------------------- progress

class MemoryStorage implements KeyValueStorage {
  map = new Map<string, string>()
  getItem(k: string) { return this.map.get(k) ?? null }
  setItem(k: string, v: string) { this.map.set(k, v) }
  removeItem(k: string) { this.map.delete(k) }
}

test('progress: a round trip through storage', () => {
  const storage = new MemoryStorage()
  const clock = new Date(2026, 9, 8, 12)
  const a = new ProgressStore(storage, undefined, () => clock)
  a.markDone('py-hello')
  a.setCode('py-lists', 'x = 1\n', 'starter\n')
  a.setLast('py-lists')
  a.setScratch('javascript', 'console.log(1)')
  const b = new ProgressStore(storage, undefined, () => clock)
  assert.ok(b.isDone('py-hello'))
  assert.ok(!b.isDone('py-lists'))
  assert.equal(b.getCode('py-lists'), 'x = 1\n')
  assert.equal(b.data.last, 'py-lists')
  assert.deepEqual(b.data.scratch, { python: '', javascript: 'console.log(1)', language: 'javascript' })
  assert.deepEqual(b.data.days, ['2026-10-08'])
  // the starter itself is not stored; going back to it forgets the draft
  b.setCode('py-lists', 'starter\n', 'starter\n')
  assert.equal(b.getCode('py-lists'), null)
  assert.equal(new ProgressStore(storage, undefined, () => clock).getCode('py-lists'), null)
  // reset forgets everything
  b.reset()
  assert.equal(storage.map.size, 0)
  assert.deepEqual([...b.doneIds()], [])
})

test('progress: damaged or missing storage never throws', () => {
  const broken: KeyValueStorage = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('full') },
    removeItem() { throw new Error('blocked') },
  }
  const p = new ProgressStore(broken)
  p.markDone('a')
  p.setCode('a', 'x', 'y')
  p.reset()
  assert.ok(!p.isDone('a'))
  const none = new ProgressStore(null)
  none.markDone('a')
  assert.ok(none.isDone('a'))
  const junk = new MemoryStorage()
  junk.setItem('kcode.progress.v1', '{"done": {"a": "yes", "b": 5}, "days": ["today", "2026-01-02"], "code": {"x": 3}, "scratch": {"language": "cobol"}}')
  const s = new ProgressStore(junk)
  assert.deepEqual([...s.doneIds()], ['b'])
  assert.deepEqual(s.data.days, ['2026-01-02'])
  assert.deepEqual(s.data.code, {})
  assert.equal(s.data.scratch.language, 'python')
  junk.setItem('kcode.progress.v1', 'not json')
  assert.deepEqual([...new ProgressStore(junk).doneIds()], [])
})

test('progress: streaks count consecutive days', () => {
  assert.deepEqual(streaks([], '2026-10-08'), { current: 0, best: 0 })
  assert.deepEqual(streaks(['2026-10-06', '2026-10-07', '2026-10-08'], '2026-10-08'), { current: 3, best: 3 })
  assert.deepEqual(streaks(['2026-10-06', '2026-10-07'], '2026-10-08'), { current: 2, best: 2 }, 'yesterday still counts')
  assert.deepEqual(streaks(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-07'], '2026-10-08'), { current: 1, best: 3 })
  assert.deepEqual(streaks(['2026-10-01'], '2026-10-08'), { current: 0, best: 1 })
  assert.deepEqual(streaks(['2026-02-27', '2026-03-01', '2026-03-02'], '2026-03-02'), { current: 2, best: 2 }, 'a gap of one day breaks it (no 29 Feb in 2026)')
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05')
  const s = new ProgressStore(new MemoryStorage(), undefined, () => new Date(2026, 9, 8))
  s.touch()
  s.touch()
  assert.equal(s.data.days.length, 1)
  assert.deepEqual(s.streak(), { current: 1, best: 1 })
})

test('prefs are clamped and survive a bad storage', () => {
  const st = new MemoryStorage()
  assert.deepEqual(loadPrefs(st), DEFAULT_PREFS)
  savePrefs(st, { ...DEFAULT_PREFS, split: 0.9, font: 40, sidebar: false, folded: ['a'] })
  const p = loadPrefs(st)
  assert.equal(p.split, 0.7)
  assert.equal(p.font, 22)
  assert.equal(p.sidebar, false)
  assert.deepEqual(p.folded, ['a'])
  st.setItem('kcode.prefs.v1', '[1,2')
  assert.deepEqual(loadPrefs(st), DEFAULT_PREFS)
  assert.deepEqual(loadPrefs(null), DEFAULT_PREFS)
})

test('lessons name the packages they import, and none asks for input()', () => {
  for (const l of LESSONS.filter((x) => x.language === 'python')) {
    for (const mod of ['numpy', 'scipy', 'matplotlib', 'pandas'] as const) {
      const imports = new RegExp(`^\\s*(import|from)\\s+${mod}\\b`, 'm').test(l.code + (l.solution ?? ''))
      assert.equal(!!l.needs?.includes(mod), imports, `${l.id}: needs lists ${mod} exactly when it imports it`)
    }
    assert.ok(!usesInput(l.code + (l.solution ?? '')), `${l.id}: input() is not available in the browser`)
  }
})

test('the lesson code helper removes indentation and keeps backslashes', () => {
  assert.equal(src`
    def f():
        return "a\nb"
  `, 'def f():\n    return "a\\nb"\n')
})

test('a lesson opened in kBook is a valid notebook; its Python cells run', (t) => {
  const lesson = LESSONS.find((l) => l.id === 'py-dicts')!
  const book = lessonNotebook(lesson, lesson.solution!)
  assert.equal(book.format, 'kbook')
  assert.equal(book.version, 1)
  assert.deepEqual(book.cells.map((c) => c.type), ['markdown', 'code', 'markdown', 'code'])
  assert.match(book.cells[0].source, /^# Dictionaries/)
  assert.equal(JSON.parse(JSON.stringify(book)).cells.length, 4)
  if (!PY) return t.skip('python3 is not installed')
  // every Python exercise: the notebook made from the solution has code cells that pass
  for (const l of LESSONS.filter((x) => x.language === 'python' && x.checks && !missingFor(x.needs).length)) {
    const cells = lessonNotebook(l, l.solution!).cells.filter((c) => c.type === 'code').map((c) => c.source)
    const script = `ns = {"__name__": "__main__"}\nimport json\nfor c in json.loads(${JSON.stringify(JSON.stringify(cells))}):\n    exec(compile(c, "<cell>", "exec"), ns)\nprint("fine")\n`
    const r = spawnPy(script)
    assert.match(r.stdout, /fine\s*$/, `${l.id}: the notebook's cells run\n${r.stderr.slice(-400)}`)
  }
})

test('run reports: output is merged, capped and read as text', () => {
  const segs: Seg[] = []
  pushSeg(segs, { kind: 'out', text: 'a' })
  pushSeg(segs, { kind: 'out', text: 'b\n' })
  pushSeg(segs, { kind: 'err', text: 'oops\n' })
  pushSeg(segs, { kind: 'status', text: 'x' })
  pushSeg(segs, { kind: 'status', text: 'y' })
  assert.deepEqual(segs.map((s) => [s.kind, s.text]), [['out', 'ab\n'], ['err', 'oops\n'], ['status', 'x'], ['status', 'y']])
  const big: Seg[] = []
  for (let i = 0; i < 50; i++) pushSeg(big, { kind: 'out', text: 'x'.repeat(10_000) })
  const size = big.reduce((n, s) => n + (s.kind === 'out' ? s.text.length : 0), 0)
  assert.equal(size, MAX_OUTPUT_CHARS)
  assert.equal(pushSeg(big, { kind: 'out', text: 'more' }), false)
  const r = emptyReport('python')
  r.segs = [{ kind: 'status', text: 'Loading numpy\n' }, { kind: 'out', text: 'hi\n' }]
  r.value = '42'
  r.error = { name: 'ValueError', message: 'bad', line: 3 }
  assert.equal(reportText(r), 'hi\n=> 42\nValueError: bad (line 3)'.replace('\n=> 42', '\n=> 42'))
  assert.equal(errorLine(r.error), 'ValueError: bad (line 3)')
  assert.equal(reportText(emptyReport('javascript')), '(no output)')
  assert.match(reportText({ ...emptyReport('javascript'), timedOut: true }), /ran too long/)
  assert.ok(reportText({ ...emptyReport('python'), segs: [{ kind: 'out', text: 'z'.repeat(50_000) }] }, 100).length < 130)
})

// A summary of what was skipped, so a green run is not mistaken for full coverage.
test('coverage note', (t) => {
  const skipped = LESSONS.filter((l) => l.language === 'python' && (!PY || missingFor(l.needs).length))
  t.diagnostic(skipped.length ? `${skipped.length} Python lesson(s) not run here: ${skipped.map((l) => l.id).join(', ')}` : 'every lesson was run')
  assert.ok(true)
})

void lessonById as unknown as (id: string) => Lesson | undefined
