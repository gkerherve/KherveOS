// Exercises: a lesson's checks, how they run after the learner's code, and how results read.
// No React and no "@/" imports, so Node can test it (tools/tests/kcode.test.ts).
//
// Python: a check's `test` is a few statements (usually `assert …`) run in the learner's
// namespace after the learner's code; it passes when nothing is raised. The text the code
// printed is there as OUTPUT.
// JavaScript: a check's `test` is an expression evaluated in the scope of the learner's code
// (top-level `const`, `let`, functions…); it passes when it is `true` (or any truthy value that
// is not a string). A string is the failure message, so `f(3) === 6 || "f(3) gave " + f(3)`
// explains itself. `__logs` holds what the code logged (an array of lines). `await` works.

export interface Check {
  /** What is checked, as the learner reads it: "double(3) returns 6". */
  label: string
  test: string
}

export interface CheckResult {
  label: string
  ok: boolean
  /** Why it failed ("NameError: name 'double' is not defined"). */
  detail: string
}

export const CHECK_MARK = '\u001eKCHECK'

/** Python source that runs the checks in the current namespace and prints one marked JSON line. */
export function pythonHarness(checks: Check[], output: string): string {
  const payload = JSON.stringify(JSON.stringify({ checks: checks.map((c) => [c.label, c.test]), output }))
  return `def _kc_harness(_payload):
    import json as _json, io as _io, contextlib as _ctx, traceback as _tb
    _data = _json.loads(_payload)
    _g = globals()
    _g["OUTPUT"] = _data["output"]
    _rows = []
    for _label, _src in _data["checks"]:
        _buf = _io.StringIO()
        try:
            with _ctx.redirect_stdout(_buf), _ctx.redirect_stderr(_buf):
                exec(compile(_src, "<check>", "exec"), _g)
            _rows.append([_label, True, ""])
        except BaseException as _e:
            _detail = f"{type(_e).__name__}: {_e}"
            if isinstance(_e, AssertionError):
                _line = ""
                for _fr in _tb.extract_tb(_e.__traceback__):
                    if _fr.filename == "<check>":
                        _lines = _src.splitlines()
                        if 0 < _fr.lineno <= len(_lines):
                            _line = _lines[_fr.lineno - 1].strip()
                _detail = str(_e) or ("did not hold: " + _line if _line else "did not hold")
            _rows.append([_label, False, _detail])
    print("\\x1eKCHECK" + _json.dumps(_rows))

_kc_harness(${payload})
del _kc_harness
`
}

/** The results the harness printed, or null if the line is missing (the code stopped first). */
export function parsePythonChecks(stdout: string): CheckResult[] | null {
  const i = stdout.lastIndexOf(CHECK_MARK)
  if (i < 0) return null
  const line = stdout.slice(i + CHECK_MARK.length).split('\n')[0]
  try {
    const rows = JSON.parse(line) as [string, boolean, string][]
    return rows.map(([label, ok, detail]) => ({ label, ok, detail }))
  } catch {
    return null
  }
}

/** Remove the harness's marked line from what the learner will read. */
export function stripCheckMark(text: string): string {
  return text.replace(/\u001eKCHECK[^\n]*\n?/g, '')
}

export interface CheckSummary {
  passed: number
  total: number
  allPassed: boolean
  /** "3 of 4 checks passed" */
  headline: string
}

export function summarizeChecks(results: CheckResult[]): CheckSummary {
  const total = results.length
  const passed = results.filter((r) => r.ok).length
  const allPassed = total > 0 && passed === total
  let headline: string
  if (total === 0) headline = 'No checks'
  else if (allPassed) headline = total === 1 ? 'The check passed' : `All ${total} checks passed`
  else if (passed === 0) headline = total === 1 ? 'The check did not pass yet' : `None of the ${total} checks passed yet`
  else headline = `${passed} of ${total} checks passed`
  return { passed, total, allPassed, headline }
}

/** The results as lines of text ("3 of 4 checks passed: …" then one line each). */
export function formatChecks(results: CheckResult[]): string {
  const s = summarizeChecks(results)
  const first = results.find((r) => !r.ok)
  const head = first && s.passed > 0 ? `${s.headline}: ${first.label}${first.detail ? ` (${first.detail})` : ''} still fails` : s.headline
  const lines = results.map((r) => `${r.ok ? '✓' : '✗'} ${r.label}${r.ok || !r.detail ? '' : ` — ${r.detail}`}`)
  return [head, ...lines].join('\n')
}

/** The line of the learner's code where a Python traceback ends (null: none named). */
export function pyErrorLine(traceback: string): number | null {
  let line: number | null = null
  for (const m of traceback.matchAll(/File "<cell>", line (\d+)/g)) line = Number(m[1])
  return line
}

/** Does the Python code call input()? (Comments are ignored; strings are not looked into.) */
export function usesInput(code: string): boolean {
  return code.split('\n').some((l) => /(^|[^\w.])input\s*\(/.test(l.replace(/#.*$/, '')))
}

/** Python that makes input() answer from a list, one answer per call (see KCode's "input() answers"). */
export function inputShim(answers: string[]): string {
  const lit = JSON.stringify(JSON.stringify(answers))
  return `def _kc_install_input(_payload):
    import builtins as _b, json as _json
    _answers = _json.loads(_payload)
    _state = {"i": 0}
    def _input(prompt=""):
        if _state["i"] >= len(_answers):
            raise EOFError("input() was called more often than there are answers. Add a line to the 'input() answers' box.")
        _a = _answers[_state["i"]]
        _state["i"] += 1
        print(str(prompt) + _a)
        return _a
    _b.input = _input

_kc_install_input(${lit})
del _kc_install_input
`
}
