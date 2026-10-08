// One terminal window's session: the prompt loop, the shell, the Python
// interpreter, and where keystrokes go while something runs. It talks to
// xterm.js only through SessionHost, so there is no DOM code in here.

import { fs, os } from '@/os'
import { HOME, dirname, isInside, pretty, resolve } from '@/os/path'
import { PythonKernel, type RunHandlers } from '@/os/python/kernel'
import { stripAnsi, style } from './ansi'
import { History, LineEditor, type EditorHost } from './lineEditor'
import { Shell, type Io, type PythonBridge, type ShellEnv, type TermOut } from './shell'
import { OS_VERSION } from './util'

export interface SessionHost extends EditorHost {
  setTitle(title: string): void
  close(): void
}

const USER = 'user'
const HOSTNAME = 'kherveos'
const PROMPT = '>>> '
const MORE = '... '

/**
 * Where keyboard input goes:
 *   read   — a line is being edited (shell prompt or >>> prompt)
 *   busy   — a shell command runs: keys are kept for the next prompt, Ctrl+C stops it
 *   python — Python runs: keys are ignored, Ctrl+C restarts Python
 */
type Mode = 'read' | 'busy' | 'python'

/** How a command run for an AI ended (see TerminalSession.runForAi). */
export interface AiRunResult {
  /** Exit status, or null when it did not end (Python's >>> prompt opened, the window closed). */
  status: number | null
  note?: string
}

/** A command an AI runs: its output so far, and when it ends. */
export interface AiRun {
  done: Promise<AiRunResult>
  /** The text it wrote so far, without colours. */
  output(): string
  /** Stop collecting (the AI stopped waiting); the command keeps running. */
  detach(): void
}

interface AiCapture {
  chunks: string[]
  finish(r: AiRunResult): void
}

type PyOutcome<T> = { ok: true; value: T } | { ok: false; status: number }

/** History kept in localStorage, shared by every terminal window. */
function storedHistory(key: string, max = 500): History {
  const load = (): string[] => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  const h = new History(load(), max)
  h.onChange = (line) => {
    try {
      if (line === null) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify([...load(), line].slice(-max)))
    } catch {
      // storage blocked or full: history just won't outlive this window
    }
  }
  return h
}

function startFolder(path: string | undefined): string {
  if (!path) return HOME
  const p = resolve(HOME, path)
  if (fs.isDir(p)) return p
  if (fs.isFile(p) && fs.isDir(dirname(p))) return dirname(p)
  return HOME
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export class TerminalSession {
  private host: SessionHost
  private winId: string
  private editor: LineEditor
  private history = storedHistory('kherveos.terminal.history')
  private pyHistory = storedHistory('kherveos.terminal.python-history')
  private shell: Shell
  private mode: Mode = 'busy'
  /** Stops the running shell command (Ctrl+C in busy mode). */
  private abort: AbortController | null = null
  /** Stops the running Python call (Ctrl+C in python mode). */
  private interruptPython: (() => void) | null = null
  private kernel: PythonKernel | null = null
  private pythonStarted = false
  private pyVersion: string | null = null
  private inRepl = false
  private replMore = false
  private atLineStart = true
  private closing = false
  private disposed = false
  private unwatch: () => void
  /** The command an AI runs, while its output is collected. */
  private aiRun: AiCapture | null = null

  constructor(host: SessionHost, opts: { winId: string; cwd?: string }) {
    this.host = host
    this.winId = opts.winId
    this.editor = new LineEditor(host)
    this.shell = new Shell(this.makeEnv(), startFolder(opts.cwd))
    // Follow the current folder when it is renamed, moved or deleted (here or in Files).
    this.unwatch = fs.watch((ev) => {
      const before = this.shell.cwd
      if (ev.type === 'rename') this.shell.followRename(ev.oldPath, ev.path)
      else if (ev.type === 'delete' || ev.path === '/') this.shell.fixCwd()
      if (this.shell.cwd !== before) {
        this.updateTitle()
        if (this.mode === 'read' && !this.inRepl) this.editor.setPrompt(this.prompt())
      }
    })
  }

  start(): void {
    this.write(`${style.bold('KherveOS Terminal')} ${style.muted(OS_VERSION)}\n`)
    this.write(
      style.muted('Type ') + style.bold('help') + style.muted(' to see the commands, ') +
        style.bold('python') + style.muted(' to start Python.') + '\n\n',
    )
    void this.loop()
  }

  /** Keyboard input from xterm.js (onData). */
  input(data: string): void {
    if (this.disposed) return
    if (this.mode === 'read') return this.editor.feed(data)
    const ctrlC = data.includes('\x03')
    if (this.mode === 'python') {
      if (ctrlC && this.interruptPython) {
        this.editor.clearQueue()
        this.interruptPython()
      }
      return
    }
    if (!ctrlC) return this.editor.feed(data) // typed ahead: used by the next prompt
    this.editor.clearQueue()
    if (this.abort && !this.abort.signal.aborted) {
      this.write('^C\n')
      this.abort.abort()
    }
  }

  /** The current folder. */
  get cwd(): string {
    return this.shell.cwd
  }

  /** A command or Python runs, or Python's >>> prompt is open: no shell prompt to type at. */
  get busy(): boolean {
    return this.mode !== 'read' || this.inRepl || this.disposed
  }

  /**
   * Type a command line at the shell prompt and run it, as if the user had
   * (they see it), collecting its output. What the user was typing comes back
   * at the next prompt. Throws when there is no shell prompt (see busy).
   */
  runForAi(line: string, cwd?: string): AiRun {
    if (this.busy || this.aiRun) throw new Error('busy')
    if (cwd && cwd !== this.shell.cwd) {
      this.shell.cwd = cwd
      this.updateTitle()
      this.editor.setPrompt(this.prompt())
    }
    let finish: (r: AiRunResult) => void = () => {}
    const done = new Promise<AiRunResult>((resolve) => (finish = resolve))
    const capture: AiCapture = {
      chunks: [],
      finish: (r) => {
        if (this.aiRun === capture) this.aiRun = null
        finish(r)
      },
    }
    this.aiRun = capture
    const typed = this.editor.enter(line)
    if (typed === null) {
      this.aiRun = null
      throw new Error('busy')
    }
    if (typed) this.editor.feed(typed)
    return {
      done,
      output: () => capture.chunks.join('').replace(/\r\n?/g, '\n'),
      detach: () => {
        if (this.aiRun === capture) this.aiRun = null
      },
    }
  }

  /** Ctrl+C for an AI: stop what runs, or leave Python's >>> prompt. What it did, or null when nothing ran. */
  interrupt(): string | null {
    if (this.disposed) return null
    if (this.mode === 'read') {
      if (!this.inRepl) return null
      this.editor.feed('\x03\x04') // drop the line, then leave the prompt
      return "Left Python's >>> prompt (its variables are lost)."
    }
    this.input('\x03')
    return this.mode === 'python' ? 'Stopped Python (it was restarted, so its variables are lost).' : 'Stopped the running command.'
  }

  /** The terminal changed size. */
  resized(): void {
    if (this.mode === 'read') this.editor.resync()
  }

  /** Clear the screen (menu, Cmd+K), keeping the line being typed. */
  clearScreen(): void {
    if (this.mode === 'read') return this.editor.clearScreen()
    this.host.write('\x1b[H\x1b[2J')
    this.atLineStart = true
  }

  /** Throw Python away and start a fresh one (variables are lost, files are kept). */
  restartPython(): void {
    if (this.interruptPython) {
      this.interruptPython()
      return
    }
    if (!this.kernel) return this.notice('Python is not running.')
    this.kernel.restart().catch(() => {})
    this.replMore = false
    this.notice('Python restarted: its variables were cleared.')
    if (this.inRepl && this.mode === 'read') this.editor.setPrompt(PROMPT)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.aiRun?.finish({ status: null, note: 'The Terminal window was closed.' })
    this.unwatch()
    this.abort?.abort()
    this.editor.cancel()
    this.kernel?.dispose()
    this.kernel = null
  }

  // ------------------------------------------------------------ the shell

  private makeEnv(): ShellEnv {
    return {
      fs,
      user: USER,
      hostname: HOSTNAME,
      openFile: (path) => void os.openFile(path).catch((e) => console.warn('[terminal] open failed', e)),
      openApp: (appId, args) => void os.open(appId, args),
      download: (path) => os.download(path),
      upload: (dir) => os.upload(dir),
      exit: () => {
        this.closing = true
        this.host.close()
      },
      history: this.history,
      python: this.pythonBridge(),
    }
  }

  private prompt(): string {
    return `${style.boldGreen(`${USER}@${HOSTNAME}`)}:${style.boldBlue(pretty(this.shell.cwd))}$ `
  }

  private updateTitle(): void {
    this.host.setTitle(`Term — ${pretty(this.shell.cwd)}`)
  }

  private async loop(): Promise<void> {
    while (!this.disposed && !this.closing) {
      this.shell.fixCwd()
      this.updateTitle()
      this.ensureLineStart()
      this.mode = 'read'
      const r = await this.editor.read({
        prompt: this.prompt(),
        history: this.history,
        complete: (line, at) => this.shell.complete(line, at),
      })
      this.atLineStart = true
      this.mode = 'busy'
      if (this.disposed) return
      const ai = this.aiRun
      if (r.type === 'interrupt') {
        this.shell.status = 130
      } else if (r.type === 'eof') {
        this.write(style.muted('Type exit to close the terminal.') + '\n')
      } else if (r.text.trim()) {
        this.history.add(r.text)
        await this.runLine(r.text)
      }
      if (ai && this.aiRun === ai) ai.finish({ status: this.shell.status })
    }
  }

  private async runLine(line: string): Promise<void> {
    const ac = new AbortController()
    this.abort = ac
    const stopped = new Promise<void>((done) => ac.signal.addEventListener('abort', () => done(), { once: true }))
    try {
      await Promise.race([this.shell.run(line, this.termOut(ac.signal), ac.signal), stopped])
    } catch (e) {
      this.ensureLineStart()
      this.write(style.red(`shell: ${e instanceof Error ? e.message : String(e)}`) + '\n')
    } finally {
      this.abort = null
    }
  }

  private termOut(signal: AbortSignal): TermOut {
    return {
      out: (s) => {
        if (!signal.aborted) this.write(s)
      },
      err: (s) => {
        if (!signal.aborted) this.write(style.red(s))
      },
      clear: () => {
        this.host.write('\x1b[H\x1b[2J\x1b[3J')
        this.atLineStart = true
      },
      cols: () => this.host.cols(),
    }
  }

  // --------------------------------------------------------------- output

  private write(text: string): void {
    if (this.disposed || !text) return
    this.host.write(text)
    const visible = stripAnsi(text)
    if (visible) this.atLineStart = visible.endsWith('\n')
    this.aiRun?.chunks.push(visible)
  }

  /** Start a new line unless the output already ended with one (so prompts never trail output). */
  private ensureLineStart(): void {
    if (!this.atLineStart) this.write('\n')
  }

  /** A dimmed line: progress, tips, saved figures. */
  private note(text: string): void {
    this.ensureLineStart()
    this.write(style.muted(text) + '\n')
  }

  /** A dimmed line that may arrive while a line is being edited. */
  private notice(text: string): void {
    if (this.mode === 'read') this.editor.interject(style.muted(text) + '\r\n')
    else this.note(text)
  }

  // --------------------------------------------------------------- python

  private pythonBridge(): PythonBridge {
    return {
      repl: (io) => this.repl(io),
      script: async (path, argv, cwd, io) => {
        const r = await this.runPython(io, (k, h) => k.runScript(path, argv, isInside(cwd, HOME) ? cwd : HOME, h))
        if (!r.ok) return r.status
        await this.saveFigures(r.value.figures)
        return r.value.exit_code
      },
      code: async (source, io) => {
        const r = await this.runPython(io, async (k, h) => {
          const res = await k.runCell(source, h)
          await k.resetNamespace() // like a separate `python -c` process
          return res
        })
        if (!r.ok) return r.status
        if (r.value.error) io.err(r.value.error.traceback + '\n')
        await this.saveFigures(r.value.figures)
        return r.value.ok ? 0 : 1
      },
      install: (packages, io) => this.install(packages, io),
      version: async (io) => {
        const r = await this.runPython(io, (k) => this.pythonVersion(k))
        if (!r.ok) return r.status
        io.out(`Python ${r.value}\n`)
        return 0
      },
    }
  }

  /**
   * Run something in this window's Python, starting it first if needed.
   * Ctrl+C meanwhile restarts Python (or cancels the start).
   */
  private async runPython<T>(io: Io, op: (k: PythonKernel, h: RunHandlers) => Promise<T>): Promise<PyOutcome<T>> {
    const previous = this.mode
    this.mode = 'python'
    const k = this.kernel ?? (this.kernel = new PythonKernel('term-' + this.winId))
    let interrupted = false
    let starting = false
    let stop: (reason: Error) => void = () => {}
    const stopped = new Promise<never>((_, reject) => (stop = reject))
    stopped.catch(() => {})
    this.interruptPython = () => {
      if (interrupted) return
      interrupted = true
      this.write('^C\n')
      if (starting) {
        k.dispose()
        if (this.kernel === k) this.kernel = null
      } else k.restart().catch(() => {})
      stop(new Error('interrupted'))
    }
    const handlers: RunHandlers = {
      onStdout: (t) => io.out(t),
      onStderr: (t) => io.err(t),
      onStatus: (t) => {
        if (t.trim()) this.note(t.trim())
      },
    }
    try {
      if (k.status !== 'idle' && k.status !== 'busy') {
        if (!this.pythonStarted) this.note('Starting Python (the first time downloads it, ~10 MB)…')
        starting = true
        await Promise.race([k.start(), stopped])
        starting = false
        this.pythonStarted = true
      }
      return { ok: true, value: await Promise.race([op(k, handlers), stopped]) }
    } catch (e) {
      if (this.disposed) return { ok: false, status: 1 }
      if (interrupted) {
        this.replMore = false
        this.note(starting ? 'Python start cancelled.' : 'KeyboardInterrupt — Python was restarted, so its variables were lost (files are kept).')
        return { ok: false, status: 130 }
      }
      this.ensureLineStart()
      io.err(`${e instanceof Error ? e.message : String(e)}\n`)
      return { ok: false, status: 1 }
    } finally {
      this.interruptPython = null
      this.mode = previous
    }
  }

  private async install(packages: string[], io: Io): Promise<number> {
    const r = await this.runPython(io, (k, h) => k.install(packages, h))
    return r.ok ? 0 : r.status
  }

  private async pythonVersion(k: PythonKernel): Promise<string> {
    if (!this.pyVersion) {
      let out = ''
      await k.runReplLine("print(__import__('sys').version.split()[0])", { onStdout: (t) => void (out += t) })
      this.pyVersion = out.trim() || '3'
    }
    return this.pyVersion
  }

  /** The interactive >>> prompt. */
  private async repl(io: Io): Promise<number> {
    const v = await this.runPython(io, (k) => this.pythonVersion(k))
    if (!v.ok) return v.status
    this.write(`Python ${v.value} (Pyodide ${this.kernel?.version ?? '?'}) on KherveOS\n`)
    this.write(style.muted('exit() or Ctrl+D leaves · %pip install <package> adds packages') + '\n')
    this.inRepl = true
    this.replMore = false
    this.aiRun?.finish({
      status: null,
      note: "Python's interactive >>> prompt is open and waits for typing: terminal_interrupt leaves it. Use python -c \"…\" or a script instead.",
    })
    try {
      while (!this.disposed) {
        this.ensureLineStart()
        this.mode = 'read'
        const r = await this.editor.read({ prompt: this.replMore ? MORE : PROMPT, history: this.pyHistory, indent: '    ' })
        this.atLineStart = true
        this.mode = 'python'
        if (this.disposed || r.type === 'eof') break
        if (r.type === 'interrupt') {
          this.write(style.red('KeyboardInterrupt') + '\n')
          if (this.replMore) await this.runPython(io, (k) => k.cancelReplInput())
          this.replMore = false
          continue
        }
        const line = r.text
        this.pyHistory.add(line)
        if (!this.replMore && /^\s*%pip(\s|$)/.test(line)) {
          await this.magicPip(line, io)
          continue
        }
        if (!this.replMore && !line.trim()) continue
        const res = await this.runPython(io, (k, h) => k.runReplLine(line, h))
        if (!res.ok) {
          this.replMore = false
          continue
        }
        await this.saveFigures(res.value.figures)
        if (res.value.exit) break
        this.replMore = res.value.more
      }
      // Leaving the prompt ends this Python "process": the next one starts with no variables.
      if (this.kernel && !this.disposed) {
        await this.runPython(io, async (k) => {
          if (this.replMore) await k.cancelReplInput()
          await k.resetNamespace()
        })
      }
    } finally {
      this.inRepl = false
      this.replMore = false
      this.mode = 'busy'
    }
    return 0
  }

  private async magicPip(line: string, io: Io): Promise<void> {
    const [, sub, ...rest] = line.trim().slice(1).split(/\s+/)
    const packages = rest.filter((w) => !w.startsWith('-'))
    if (sub !== 'install' || !packages.length) {
      io.err('usage: %pip install <package>…\n')
      return
    }
    await this.install(packages, io)
  }

  /** Save matplotlib figures as ~/Pictures/figure-YYYYMMDD-HHMMSS-N.png. */
  private async saveFigures(figures: string[]): Promise<void> {
    if (!figures.length) return
    const d = new Date()
    const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
    let n = 1
    for (const b64 of figures) {
      let path = ''
      for (; !path || fs.exists(path); n++) path = `${HOME}/Pictures/figure-${stamp}-${n}.png`
      try {
        await fs.writeBytes(path, base64Bytes(b64), { mkdirs: true })
        this.ensureLineStart()
        this.write(`${style.muted('Figure saved:')} ${pretty(path)}\n`)
      } catch (e) {
        this.ensureLineStart()
        this.write(style.red(`Could not save the figure: ${e instanceof Error ? e.message : String(e)}`) + '\n')
      }
    }
  }
}
