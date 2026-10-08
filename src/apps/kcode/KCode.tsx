// kCode — learn Python and JavaScript. About fifty lessons in four courses, each with
// an explanation, a task, automatic checks, a hint and a solution; a scratchpad for any
// script of your own. Python runs in the app's own Pyodide kernel (the one KherveBook
// uses); JavaScript runs in a Web Worker with a timeout, away from the page.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import {
  ArrowLeft, ArrowRight, BookOpen, Eye, FolderOpen, Lightbulb, ListChecks, NotebookPen, PanelLeft, PanelLeftClose, PenLine, Play, RotateCcw, Save, Square,
} from 'lucide-react'
import { HOME, os, type AppProps, type MenuBarMenu } from '@/os'
import { basename } from '@/os/path'
import { CodeEditor } from '@/os/ui/CodeEditor'
import { useAppTools } from '@/os/ai/appTools'
import { kcodeTools, type CheckSummaryInfo, type LessonInfo, type ProgressInfo, type RunSummary } from './aiTools'
import { summarizeChecks, usesInput, type CheckResult } from './checks.ts'
import { Divider } from './Divider'
import { showErrorLine } from './errorMark'
import { COURSES, LESSONS, lessonById, neighbour, placeOf, searchLessons, type Language, type Lesson } from './lessons.ts'
import { LessonPane, type CheckView } from './LessonPane'
import { lessonNotebook } from './notebook.ts'
import { OutputPane } from './OutputPane'
import { ProgressStore, loadPrefs, savePrefs, type Prefs } from './progress.ts'
import { pushSeg, reportText, type RunReport, type Seg } from './report.ts'
import { Runner } from './runner'
import { Sidebar } from './Sidebar'
import './kcode.css'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl+'
const SHIFT_MOD = isMac ? '⇧⌘' : 'Ctrl+Shift+'
const ALT_MOD = isMac ? '⌥⌘' : 'Ctrl+Alt+'

type Mode = 'lessons' | 'scratch'

const SCRATCH_STARTER: Record<Language, string> = {
  python: '# The scratchpad: any Python you like. Run it with Ctrl/Cmd+Enter.\nprint("Hello from the scratchpad")\n',
  javascript: '// The scratchpad: any JavaScript you like. Run it with Ctrl/Cmd+Enter.\nconsole.log("Hello from the scratchpad");\n',
}

interface Scratch {
  lang: Language
  python: string
  javascript: string
  /** The file being edited (Open… / Save As…). */
  path: string | null
  /** Its text when it was opened or saved: differences from it are unsaved changes. */
  saved: string | null
}

const languageOfPath = (path: string): Language => (/\.(m?js|cjs)$/i.test(path) ? 'javascript' : 'python')

export default function KCode({ win, args }: AppProps) {
  // ------------------------------------------------------------- storage
  const storage = useMemo(() => {
    try {
      return window.localStorage
    } catch {
      return null
    }
  }, [])
  const store = useMemo(() => new ProgressStore(storage), [storage])
  const runner = useMemo(() => new Runner(), [])
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])

  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs(storage))
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...patch }
    prefsRef.current = next
    setPrefsState(next)
    savePrefs(storage, next)
  }, [storage])

  // Edits are saved a moment after typing stops (and when the window closes or the lesson changes).
  const pending = useRef(new Map<string, () => void>())
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flushPersist = useCallback(() => {
    clearTimeout(persistTimer.current)
    for (const fn of pending.current.values()) fn()
    pending.current.clear()
  }, [])
  const persist = useCallback((key: string, fn: () => void) => {
    pending.current.set(key, fn)
    clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(flushPersist, 500)
  }, [flushPersist])

  // ------------------------------------------------------------- what is open
  const [mode, setMode] = useState<Mode>(typeof args.path === 'string' ? 'scratch' : 'lessons')
  const [id, setId] = useState<string>(() => {
    const fromArgs = typeof args.lesson === 'string' && lessonById(args.lesson) ? args.lesson : null
    return fromArgs ?? (store.data.last && lessonById(store.data.last) ? store.data.last : LESSONS[0].id)
  })
  const lesson = lessonById(id) ?? LESSONS[0]
  const place = placeOf(lesson.id)!
  const [codes, setCodes] = useState<Record<string, string>>(() => ({ ...store.data.code }))
  const [scratch, setScratch] = useState<Scratch>(() => ({
    lang: store.data.scratch.language,
    python: store.data.scratch.python || SCRATCH_STARTER.python,
    javascript: store.data.scratch.javascript || SCRATCH_STARTER.javascript,
    path: null,
    saved: null,
  }))
  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState<Record<string, { hint?: boolean; solution?: boolean }>>({})
  const [views, setViews] = useState<Record<string, { results: CheckResult[]; code: string }>>({})
  const [narrowTab, setNarrowTab] = useState<'lesson' | 'code'>('lesson')
  const [sideOpen, setSideOpen] = useState<boolean | null>(null)

  const lessonText = codes[lesson.id] ?? lesson.code
  const scratchText = scratch[scratch.lang]
  const code = mode === 'lessons' ? lessonText : scratchText
  const language: Language = mode === 'lessons' ? lesson.language : scratch.lang
  const dirty = scratch.path !== null && scratchText !== scratch.saved

  // ------------------------------------------------------------- layout
  const root = useRef<HTMLDivElement>(null)
  const work = useRef<HTMLDivElement>(null)
  const right = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const measure = () => setNarrow(el.clientWidth < 760)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const showSide = (sideOpen ?? (prefs.sidebar && !narrow)) && mode === 'lessons'
  const toggleSide = () => {
    setSideOpen(!showSide)
    if (!narrow) updatePrefs({ sidebar: !showSide })
  }

  // ------------------------------------------------------------- running
  const [running, setRunning] = useState(false)
  useEffect(() => runner.onRunning(setRunning), [runner])
  const live = useRef<Seg[]>([])
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [segs, setSegs] = useState<Seg[]>([])
  const [figures, setFigures] = useState<string[]>([])
  const [report, setReport] = useState<RunReport | null>(null)
  const [runNo, setRunNo] = useState(0)
  const [answers, setAnswers] = useState('')

  const token = useRef(0)
  const clearOutput = useCallback(() => {
    token.current++ // a run still going no longer shows its output
    live.current = []
    clearTimeout(flushTimer.current)
    flushTimer.current = undefined
    setSegs([])
    setFigures([])
    setReport(null)
    if (viewRef.current) showErrorLine(viewRef.current, null)
  }, [])

  const execute = useCallback(async (source: string, lang: Language, target: Lesson | null, check: boolean): Promise<RunReport> => {
    clearOutput()
    const mine = token.current
    setRunNo((n) => n + 1)
    const r = await runner.run({
      language: lang,
      code: source,
      checks: check ? target?.checks : undefined,
      answers: answers ? answers.replace(/\n$/, '').split('\n') : [],
      onSeg: (seg) => {
        if (token.current !== mine || !pushSeg(live.current, seg)) return
        if (flushTimer.current === undefined) {
          flushTimer.current = setTimeout(() => { flushTimer.current = undefined; setSegs([...live.current]) }, 40)
        }
      },
    })
    clearTimeout(flushTimer.current)
    flushTimer.current = undefined
    const shown = token.current === mine
    if (shown) r.segs = [...live.current]
    // Progress: a lesson with checks is done when they all pass; one without, when it runs.
    store.touch()
    if (target && r.ok && !r.stopped) {
      if (target.checks?.length) {
        if (check && r.checks) {
          setViews((v) => ({ ...v, [target.id]: { results: r.checks!, code: source } }))
          if (summarizeChecks(r.checks).allPassed) store.markDone(target.id)
        }
      } else store.markDone(target.id)
    }
    store.save()
    if (shown) {
      setSegs(r.segs)
      setFigures(r.figures)
      setReport(r)
      if (r.error?.line && viewRef.current) showErrorLine(viewRef.current, r.error.line)
    }
    bump()
    return r
  }, [answers, bump, clearOutput, runner, store])

  const runIt = (check: boolean) => {
    if (runner.running) return
    if (mode === 'lessons') {
      setNarrowTab('code')
      void execute(code, lesson.language, lesson, check && !!lesson.checks?.length)
    } else void execute(code, scratch.lang, null, false)
  }

  // ------------------------------------------------------------- navigation
  const switchMode = useCallback((m: Mode) => {
    if (m === mode) return
    flushPersist()
    setMode(m)
    clearOutput()
  }, [clearOutput, flushPersist, mode])

  const goTo = useCallback((lid: string) => {
    if (!lessonById(lid)) return
    if (runner.running) runner.stop()
    flushPersist()
    setMode('lessons')
    setId(lid)
    store.setLast(lid)
    clearOutput()
    setNarrowTab('lesson')
    if (narrow) setSideOpen(false)
  }, [clearOutput, flushPersist, narrow, runner, store])

  const step = (delta: 1 | -1) => {
    const n = neighbour(lesson.id, delta)
    if (n) goTo(n.id)
  }

  const setCode = (v: string) => {
    if (mode === 'lessons') {
      const lid = lesson.id
      const starter = lesson.code
      setCodes((c) => (c[lid] === v || (c[lid] === undefined && v === starter) ? c : { ...c, [lid]: v }))
      persist(`code:${lid}`, () => store.setCode(lid, v, starter))
    } else {
      const lang = scratch.lang
      setScratch((s) => (s[lang] === v ? s : { ...s, [lang]: v }))
      persist('scratch', () => store.setScratch(lang, v))
    }
  }

  const resetCode = async () => {
    if (mode !== 'lessons') return
    if (lessonText !== lesson.code && !(await os.dialog.confirm('Go back to the starter code of this lesson? Your changes to it will be lost.', { title: 'Reset the code', okLabel: 'Reset', danger: true }))) return
    setCodes((c) => {
      const { [lesson.id]: _gone, ...rest } = c
      void _gone
      return rest
    })
    pending.current.delete(`code:${lesson.id}`)
    store.setCode(lesson.id, lesson.code, lesson.code)
    setViews((v) => {
      const { [lesson.id]: _gone, ...rest } = v
      void _gone
      return rest
    })
    clearOutput()
  }

  const reveal = (what: 'hint' | 'solution', on: boolean) => setRevealed((r) => ({ ...r, [lesson.id]: { ...r[lesson.id], [what]: on } }))
  const useSolution = async () => {
    if (!lesson.solution) return
    if (lessonText !== lesson.code && lessonText !== lesson.solution && !(await os.dialog.confirm('Replace your code with the solution?', { title: 'Use the solution', okLabel: 'Replace', danger: true }))) return
    setCodes((c) => ({ ...c, [lesson.id]: lesson.solution! }))
    persist(`code:${lesson.id}`, () => store.setCode(lesson.id, lesson.solution!, lesson.code))
  }

  // ------------------------------------------------------------- scratchpad files
  const confirmDiscard = async (): Promise<boolean> => {
    if (!dirty) return true
    const choice = await os.dialog.choose(
      `Save the changes to “${basename(scratch.path!)}” first?`,
      [{ label: 'Cancel', value: 'cancel' }, { label: 'Don’t Save', value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }],
      { title: 'Unsaved changes' },
    )
    if (choice === 'save') return saveScript(false)
    return choice === 'discard'
  }

  const openScript = useCallback(async (given?: string) => {
    if (!(await confirmDiscard())) return
    const path = given ?? (await os.dialog.openFile({ title: 'Open script', extensions: ['.py', '.js', '.mjs'] }))
    if (!path) return
    try {
      const text = await os.fs.readText(path)
      const lang = languageOfPath(path)
      flushPersist()
      setScratch((s) => ({ ...s, lang, [lang]: text, path, saved: text }))
      setMode('scratch')
      win.setDocumentPath(path)
      clearOutput()
    } catch (e) {
      await os.dialog.alert(`“${basename(path)}” could not be opened: ${e instanceof Error ? e.message : String(e)}`)
    }
    // confirmDiscard is rebuilt on every render and reads the current state
  }, [clearOutput, flushPersist, win, dirty, scratch.path])

  const saveScript = async (saveAs: boolean): Promise<boolean> => {
    let path = scratch.path
    if (!path || saveAs) {
      path = await os.dialog.saveFile({
        title: 'Save script',
        defaultName: path ? basename(path) : scratch.lang === 'python' ? 'script.py' : 'script.js',
        extensions: scratch.lang === 'python' ? ['.py'] : ['.js'],
      })
      if (!path) return false
    }
    try {
      await os.fs.writeText(path, scratchText, { mkdirs: true })
      const saved = scratchText
      setScratch((s) => ({ ...s, path, saved }))
      win.setDocumentPath(path)
      return true
    } catch (e) {
      await os.dialog.alert(`The script could not be saved: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }

  const switchScratchLanguage = async (lang: Language) => {
    if (lang === scratch.lang) return
    if (scratch.path && !(await confirmDiscard())) return
    flushPersist()
    setScratch((s) => ({ ...s, lang, path: null, saved: null }))
    store.setScratch(lang, scratch[lang])
    win.setDocumentPath(null)
    clearOutput()
  }

  // A script given at the start (args.path), and files or lessons the OS hands over later.
  const lastArgs = useRef<{ path: unknown; lesson: unknown } | null>(null)
  useEffect(() => {
    const prev = lastArgs.current
    lastArgs.current = { path: args.path, lesson: args.lesson }
    if (typeof args.path === 'string' && (!prev || args.path !== prev.path)) void openScript(args.path)
    else if (prev && typeof args.lesson === 'string' && args.lesson !== prev.lesson) goTo(args.lesson)
    // only when the arguments change
  }, [args.path, args.lesson])

  // ------------------------------------------------------------- notebook
  const openInBook = async () => {
    if (mode !== 'lessons') {
      await os.dialog.alert('Open a lesson first: kBook can take the lesson and your code from it.')
      return
    }
    if (lesson.language !== 'python') {
      await os.dialog.alert('kBook notebooks run Python, so only the Python lessons can be opened there.')
      return
    }
    try {
      const dir = `${HOME}/Documents/kCode Lessons`
      const path = `${dir}/${os.fs.uniqueName(dir, `${lesson.id}.kbook`)}`
      await os.fs.writeText(path, JSON.stringify(lessonNotebook(lesson, lessonText), null, 1), { mkdirs: true })
      os.open('khervebook', { path })
    } catch (e) {
      await os.dialog.alert(`The notebook could not be made: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ------------------------------------------------------------- progress
  const resetProgress = async () => {
    if (!(await os.dialog.confirm('Forget the lessons you completed, the code you wrote in them, your scratchpad draft and your streak?', { title: 'Reset progress', okLabel: 'Reset progress', danger: true }))) return
    pending.current.clear()
    store.reset()
    setCodes({})
    setViews({})
    setRevealed({})
    clearOutput()
    bump()
  }

  const done = store.doneIds()
  const streak = store.streak()

  // ------------------------------------------------------------- window
  useEffect(() => {
    win.setTitle(mode === 'lessons' ? `kCode — ${lesson.title}` : `kCode — ${scratch.path ? basename(scratch.path) : 'Scratchpad'}${dirty ? ' •' : ''}`)
  }, [win, mode, lesson.title, scratch.path, dirty])

  const guard = useRef({ dirty, path: scratch.path, saveScript })
  guard.current = { dirty, path: scratch.path, saveScript }
  useEffect(() => {
    win.setCloseGuard(async () => {
      flushPersist()
      const g = guard.current
      if (!g.dirty) return true
      const choice = await os.dialog.choose(
        `Save the changes to “${basename(g.path!)}” before closing?`,
        [{ label: 'Cancel', value: 'cancel' }, { label: 'Don’t Save', value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }],
        { title: 'Unsaved changes' },
      )
      if (choice === 'save') return g.saveScript(false)
      return choice === 'discard'
    })
    return () => win.setCloseGuard(null)
  }, [win, flushPersist])
  useEffect(() => () => { flushPersist(); runner.dispose() }, [flushPersist, runner])

  // ------------------------------------------------------------- AI tools
  const info = (l: Lesson): LessonInfo => {
    const p = placeOf(l.id)!
    return { id: l.id, language: l.language, title: l.title, course: p.course.id, chapter: p.chapter.title, level: l.level, minutes: l.minutes, done: done.has(l.id), exercise: !!l.checks?.length }
  }
  const summaryOf = (r: RunReport): RunSummary => ({
    ok: r.ok,
    output: reportText(r),
    ...(r.error && { error: `${r.error.name}: ${r.error.message}${r.error.line ? ` (line ${r.error.line})` : ''}` }),
  })
  const toolRun = async (source: string, check: boolean): Promise<RunReport> => {
    if (runner.running) throw new Error('kCode is already running something. Wait for it to finish, or stop it.')
    if (mode === 'lessons') {
      setCodes((c) => ({ ...c, [lesson.id]: source }))
      persist(`code:${lesson.id}`, () => store.setCode(lesson.id, source, lesson.code))
      return execute(source, lesson.language, lesson, check)
    }
    setScratch((s) => ({ ...s, [s.lang]: source }))
    return execute(source, scratch.lang, null, false)
  }

  useAppTools(win, kcodeTools({
    lessons: ({ course, language: lang, query: q }) => {
      const base = q ? searchLessons(q) : LESSONS
      return base
        .filter((l) => (!lang || l.language === lang) && (!course || placeOf(l.id)!.course.id === course))
        .map(info)
    },
    open: (lid) => {
      if (!lessonById(lid)) throw new Error(`No lesson "${lid}". Use kcode_lessons for the list.`)
      goTo(lid)
    },
    run: async (source) => summaryOf(await toolRun(source, false)),
    language: () => language,
    check: async (): Promise<CheckSummaryInfo> => {
      if (mode !== 'lessons') throw new Error('The scratchpad has no checks. Open a lesson first (kcode_open).')
      const r = await toolRun(lessonText, true)
      if (!lesson.checks?.length) {
        return { ...summaryOf(r), lesson: lesson.id, passed: 0, total: 0, allPassed: false, results: [], note: 'This lesson has no automatic checks: it counts as done when its code runs without an error.' }
      }
      const results = r.checks ?? []
      const s = summarizeChecks(results)
      return {
        ...summaryOf(r),
        lesson: lesson.id,
        passed: s.passed,
        total: lesson.checks.length,
        allPassed: s.allPassed,
        results,
        ...(r.checks === null && { note: r.error ? 'The code stopped with an error before the checks could run.' : 'The checks could not run.' }),
      }
    },
    hint: () => {
      if (mode !== 'lessons') throw new Error('The scratchpad has no hints. Open a lesson first (kcode_open).')
      if (lesson.hint) setRevealed((r) => ({ ...r, [lesson.id]: { ...r[lesson.id], hint: true } }))
      setNarrowTab('lesson')
      return { lesson: lesson.id, hint: lesson.hint ?? null, task: lesson.task ?? null }
    },
    progress: (): ProgressInfo => {
      const next = LESSONS.find((l) => !done.has(l.id))
      return {
        completed: done.size,
        total: LESSONS.length,
        percent: Math.round((done.size / LESSONS.length) * 100),
        streak,
        current: mode === 'lessons' ? { id: lesson.id, title: lesson.title } : null,
        next: next ? { id: next.id, title: next.title } : null,
        courses: COURSES.map((c) => {
          const ls = c.chapters.flatMap((ch) => ch.lessons)
          return { id: c.id, title: c.title, completed: ls.filter((l) => done.has(l.id)).length, total: ls.length }
        }),
      }
    },
    setCode: (source) => {
      setCode(source)
      return { lesson: mode === 'lessons' ? lesson.id : null, language }
    },
  }))

  // ------------------------------------------------------------- menus
  const hasHint = mode === 'lessons' && !!lesson.hint
  const hasSolution = mode === 'lessons' && !!lesson.solution
  const menus: MenuBarMenu[] = [
    {
      label: 'File',
      items: [
        { label: 'Open Script…', icon: FolderOpen, shortcut: `${MOD}O`, onClick: () => void openScript() },
        { label: 'Save Script', icon: Save, shortcut: `${MOD}S`, disabled: mode !== 'scratch', onClick: () => void saveScript(false) },
        { label: 'Save Script As…', shortcut: `${SHIFT_MOD}S`, disabled: mode !== 'scratch', onClick: () => void saveScript(true) },
        '-',
        { label: 'Open Lesson in kBook', icon: NotebookPen, disabled: mode !== 'lessons' || lesson.language !== 'python', onClick: () => void openInBook() },
      ],
    },
    {
      label: 'Lesson',
      items: [
        { label: 'Run', icon: Play, shortcut: `${MOD}↩`, disabled: running, onClick: () => runIt(false) },
        { label: 'Run & Check', icon: ListChecks, shortcut: `${SHIFT_MOD}↩`, disabled: running || mode !== 'lessons' || !lesson.checks?.length, onClick: () => runIt(true) },
        { label: 'Stop', icon: Square, shortcut: `${MOD}.`, disabled: !running, onClick: () => runner.stop() },
        '-',
        { label: 'Show Hint', icon: Lightbulb, disabled: !hasHint, onClick: () => { setNarrowTab('lesson'); reveal('hint', true) } },
        { label: 'Show Solution', icon: Eye, disabled: !hasSolution, onClick: () => { setNarrowTab('lesson'); reveal('solution', true) } },
        { label: 'Reset Code', icon: RotateCcw, disabled: mode !== 'lessons', onClick: () => void resetCode() },
        '-',
        { label: 'Next Lesson', icon: ArrowRight, shortcut: `${ALT_MOD}→`, disabled: mode === 'lessons' && !neighbour(lesson.id, 1), onClick: () => step(1) },
        { label: 'Previous Lesson', icon: ArrowLeft, shortcut: `${ALT_MOD}←`, disabled: mode === 'lessons' && !neighbour(lesson.id, -1), onClick: () => step(-1) },
        '-',
        { label: 'Reset Progress…', danger: true, onClick: () => void resetProgress() },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Lessons', icon: BookOpen, checked: mode === 'lessons', onClick: () => switchMode('lessons') },
        { label: 'Scratchpad', icon: PenLine, checked: mode === 'scratch', onClick: () => switchMode('scratch') },
        '-',
        { label: 'Course List', icon: PanelLeft, checked: showSide, shortcut: `${MOD}\\`, onClick: () => toggleSide() },
        '-',
        { label: 'Larger Text', disabled: prefs.font >= 22, onClick: () => updatePrefs({ font: prefs.font + 1 }) },
        { label: 'Smaller Text', disabled: prefs.font <= 10, onClick: () => updatePrefs({ font: prefs.font - 1 }) },
        { label: 'Actual Size', disabled: prefs.font === 13, onClick: () => updatePrefs({ font: 13 }) },
        '-',
        { label: 'Clear Output', onClick: clearOutput },
        { label: 'Restart Python', onClick: () => { clearOutput(); void runner.restartPython() } },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'About kCode', onClick: () => void os.dialog.alert(`kCode has ${LESSONS.length} lessons in ${COURSES.length} courses: Python basics, Python for science, JavaScript basics and lab recipes. Each exercise is checked automatically; your progress and your code stay in this browser.`, { title: 'About kCode' }) },
        {
          label: 'Keyboard Shortcuts',
          onClick: () => void os.dialog.alert(
            `${MOD}Enter runs the code.  ${SHIFT_MOD}Enter runs it and checks the exercise.  ${MOD}. stops.\n${ALT_MOD}Right / ${ALT_MOD}Left: next / previous lesson.\n${MOD}O opens a script, ${MOD}S saves it (scratchpad).\nDrag the bars between the panes to resize them; with the keyboard, focus a bar and use the arrow keys.`,
            { title: 'Keyboard shortcuts' },
          ),
        },
        {
          label: 'What Can Python Do Here?',
          onClick: () => void os.dialog.alert(
            'Python runs inside your browser (Pyodide). numpy, scipy, pandas and matplotlib load when you import them; figures appear under the editor. Files you write go to your KherveOS home folder. input() cannot wait for a keystroke: kCode answers it from the “input() answers” box.',
            { title: 'Python in kCode' },
          ),
        },
      ],
    },
  ]
  useEffect(() => {
    win.setMenus(menus)
  })
  useEffect(() => () => win.setMenus(null), [win])

  // ------------------------------------------------------------- keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return
    const mod = e.metaKey || e.ctrlKey
    const handled = (fn: () => void) => { e.preventDefault(); fn() }
    if (mod && e.key === 'Enter') handled(() => runIt(e.shiftKey))
    else if (mod && e.key === '.') handled(() => runner.stop())
    else if (mod && e.altKey && e.key === 'ArrowRight' && mode === 'lessons') handled(() => step(1))
    else if (mod && e.altKey && e.key === 'ArrowLeft' && mode === 'lessons') handled(() => step(-1))
    else if (mod && !e.shiftKey && e.key.toLowerCase() === 'o') handled(() => void openScript())
    else if (mod && e.key.toLowerCase() === 's' && mode === 'scratch') handled(() => void saveScript(e.shiftKey))
    else if (mod && e.key === '\\') handled(() => toggleSide())
  }
  // Only the keys CodeMirror would use itself; the rest is handled by onKeyDown above.
  const editorKeys = [
    { key: 'Mod-Enter', run: () => { runIt(false); return true } },
    { key: 'Mod-Shift-Enter', run: () => { runIt(true); return true } },
  ]

  // ------------------------------------------------------------- view
  const checkView: CheckView | null = mode === 'lessons' && views[lesson.id]
    ? { results: views[lesson.id].results, stale: views[lesson.id].code !== lessonText }
    : null
  const rev = revealed[lesson.id] ?? {}
  const showLesson = mode === 'lessons' && (!narrow || narrowTab === 'lesson')
  const showCode = !narrow || mode === 'scratch' || narrowTab === 'code'
  const nextLesson = neighbour(lesson.id, 1)
  const lessonShare = showLesson && showCode ? prefs.split : showLesson ? 1 : 0

  return (
    <div className={`k-app kcd-app${narrow ? ' narrow' : ''}`} ref={root} onKeyDown={onKeyDown}>
      <div className="k-toolbar kcd-bar">
        {mode === 'lessons' && (
          <button className="k-icon-btn" title={showSide ? 'Hide the course list' : 'Show the course list'} aria-label="Toggle the course list" aria-pressed={showSide} onClick={() => toggleSide()}>
            {showSide ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
          </button>
        )}
        <div className="kcd-seg-ctl" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={mode === 'lessons'} className={mode === 'lessons' ? 'on' : ''} onClick={() => switchMode('lessons')}><BookOpen size={13} /> <span className="lbl">Lessons</span></button>
          <button role="tab" aria-selected={mode === 'scratch'} className={mode === 'scratch' ? 'on' : ''} onClick={() => switchMode('scratch')}><PenLine size={13} /> <span className="lbl">Scratchpad</span></button>
        </div>
        <span className="k-sep" />
        {running ? (
          <button className="k-btn small danger" onClick={() => runner.stop()} title={`Stop (${MOD}.)`}><Square size={12} /> Stop</button>
        ) : (
          <button className="k-btn small primary" onClick={() => runIt(false)} title={`Run (${MOD}Enter)`}><Play size={12} /> Run</button>
        )}
        {mode === 'lessons' && lesson.checks?.length ? (
          <button className="k-btn small" disabled={running} onClick={() => runIt(true)} title={`Run and check the exercise (${SHIFT_MOD}Enter)`}><ListChecks size={13} /> <span className="lbl">Run &amp; check</span></button>
        ) : null}
        {mode === 'lessons' ? (
          <>
            <button className="k-btn small" disabled={!hasHint} onClick={() => { setNarrowTab('lesson'); reveal('hint', !rev.hint) }} title="Hint"><Lightbulb size={13} /> <span className="lbl">Hint</span></button>
            <button className="k-btn small" disabled={!hasSolution} onClick={() => { setNarrowTab('lesson'); reveal('solution', !rev.solution) }} title="Solution"><Eye size={13} /> <span className="lbl">Solution</span></button>
            <button className="k-btn small" onClick={() => void resetCode()} title="Back to the starter code"><RotateCcw size={13} /> <span className="lbl">Reset</span></button>
            <button className="k-btn small" onClick={() => void openInBook()} disabled={lesson.language !== 'python'} title="Open this lesson as a kBook notebook"><NotebookPen size={13} /> <span className="lbl">Open in kBook</span></button>
          </>
        ) : (
          <>
            <button className="k-btn small" onClick={() => void openScript()} title={`Open a script (${MOD}O)`}><FolderOpen size={13} /> <span className="lbl">Open…</span></button>
            <button className="k-btn small" onClick={() => void saveScript(false)} title={`Save (${MOD}S)`}><Save size={13} /> <span className="lbl">Save</span></button>
            <button className="k-btn small" onClick={() => void saveScript(true)} title="Save as…"><span className="lbl">Save As…</span><span className="short">As…</span></button>
            <select className="k-input kcd-lang" aria-label="Language" value={scratch.lang} onChange={(e) => void switchScratchLanguage(e.target.value as Language)}>
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
            </select>
          </>
        )}
        <span className="k-spacer" />
        {mode === 'lessons' && (
          <>
            <button className="k-icon-btn" disabled={!neighbour(lesson.id, -1)} onClick={() => step(-1)} title={`Previous lesson (${ALT_MOD}←)`} aria-label="Previous lesson"><ArrowLeft size={16} /></button>
            <button className="k-icon-btn" disabled={!nextLesson} onClick={() => step(1)} title={`Next lesson (${ALT_MOD}→)`} aria-label="Next lesson"><ArrowRight size={16} /></button>
          </>
        )}
      </div>

      {narrow && mode === 'lessons' && (
        <div className="kcd-tabs" role="tablist" aria-label="Lesson or code">
          <button role="tab" aria-selected={narrowTab === 'lesson'} className={narrowTab === 'lesson' ? 'on' : ''} onClick={() => setNarrowTab('lesson')}>Lesson</button>
          <button role="tab" aria-selected={narrowTab === 'code'} className={narrowTab === 'code' ? 'on' : ''} onClick={() => setNarrowTab('code')}>Code &amp; output</button>
        </div>
      )}

      <div className="kcd-body">
        {showSide && (
          <Sidebar
            current={lesson.id}
            done={done}
            query={query}
            onQuery={setQuery}
            folded={prefs.folded}
            onToggleFold={(cid) => updatePrefs({ folded: prefs.folded.includes(cid) ? prefs.folded.filter((x) => x !== cid) : [...prefs.folded, cid] })}
            onOpen={goTo}
            streak={streak}
          />
        )}
        <div
          className="kcd-work"
          ref={work}
          style={{ gridTemplateColumns: showLesson && showCode ? `minmax(0, ${lessonShare}fr) 7px minmax(0, ${1 - lessonShare}fr)` : 'minmax(0, 1fr)' }}
        >
          {showLesson && (
            <LessonPane
              lesson={lesson}
              course={place.course}
              chapter={place.chapter}
              done={done.has(lesson.id)}
              hintShown={!!rev.hint}
              solutionShown={!!rev.solution}
              onHint={() => reveal('hint', true)}
              onSolution={() => reveal('solution', true)}
              onClose={(what) => reveal(what, false)}
              onUseSolution={() => void useSolution()}
              checkView={checkView}
              next={nextLesson}
              onNext={() => step(1)}
              fontSize={prefs.font}
            />
          )}
          {showLesson && showCode && <Divider dir="col" container={work} share={prefs.split} onChange={(s) => updatePrefs({ split: s })} min={0.2} max={0.7} label="Resize the lesson text" />}
          {showCode && (
            <div
              className="kcd-right"
              ref={right}
              style={{ gridTemplateRows: `minmax(80px, ${prefs.editorShare}fr) 7px minmax(80px, ${1 - prefs.editorShare}fr)` }}
            >
              <div className="kcd-editor">
                <CodeEditor
                  value={code}
                  language={language}
                  onChange={setCode}
                  lineNumbers
                  fontSize={prefs.font}
                  keys={editorKeys}
                  onReady={(v) => { viewRef.current = v }}
                />
              </div>
              <Divider dir="row" container={right} share={prefs.editorShare} onChange={(s) => updatePrefs({ editorShare: s })} min={0.2} max={0.85} label="Resize the editor" />
              <OutputPane
                running={running}
                segs={segs}
                figures={figures}
                report={report}
                runNo={runNo}
                onJump={(line) => viewRef.current && showErrorLine(viewRef.current, line, true)}
                onClear={clearOutput}
                showInput={language === 'python' && usesInput(code)}
                answers={answers}
                onAnswers={setAnswers}
                fontSize={prefs.font}
              />
            </div>
          )}
        </div>
      </div>

      <div className="k-statusbar kcd-status">
        <span className="kcd-where">
          {mode === 'lessons' ? `${place.course.title} › ${place.chapter.title} › ${lesson.title}` : scratch.path ? `${scratch.path}${dirty ? ' (unsaved changes)' : ''}` : `Scratchpad — ${scratch.lang === 'python' ? 'Python' : 'JavaScript'}`}
        </span>
        <span className="k-spacer" />
        <span>{done.size}/{LESSONS.length} lessons</span>
        {streak.current > 0 && <span>{streak.current}-day streak</span>}
        <span>{running ? 'Running…' : language === 'python' ? 'Python' : 'JavaScript'}</span>
      </div>
    </div>
  )
}
