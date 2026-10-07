// Terminal's AI tools (terminal_run_command, _read_output, _interrupt):
// names, arguments and descriptions are in src/os/ai/manifests/terminalViewer.ts;
// Terminal.tsx registers these with useAppTools. A command is typed at the
// window's shell prompt, so the user sees it run; its output is collected by
// the session (not read back from the screen).

import { fs } from '@/os'
import { pretty } from '@/os/path'
import { drivePath } from '@/os/ai/tools'
import { clipText, waitUntil, type AppTools } from '@/os/ai/appTools'
import type { TerminalSession } from './session'

export interface TerminalView {
  session(): TerminalSession | null
  /** The latest `n` lines of the screen and scrollback, as text. */
  lines(n: number): string[]
}

const MAX_OUTPUT = 20_000
const BUSY =
  'The Terminal is busy: a command or Python is running, or Python\'s >>> prompt is open. ' +
  'terminal_read_output shows it; terminal_interrupt stops it.'

const clamp = (v: unknown, def: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def

export function terminalAiTools(view: TerminalView): AppTools {
  const ready = async (signal?: AbortSignal): Promise<TerminalSession> => {
    if (!(await waitUntil(() => !!view.session(), 10_000, signal))) throw new Error('The Terminal is not ready yet. Try again in a moment.')
    return view.session()!
  }

  return {
    async run_command(a, ctx) {
      const command = String(a.command ?? '').trim()
      if (!command) throw new Error('"command" is empty.')
      if (/[\r\n]/.test(command)) throw new Error('"command" must be one line: join commands with ";" or "&&".')
      let cwd: string | undefined
      if (typeof a.cwd === 'string' && a.cwd.trim()) {
        cwd = drivePath(a.cwd)
        if (!fs.isDir(cwd)) throw new Error(`${pretty(cwd)} is not a folder.`)
      }
      const timeout = clamp(a.timeout, 60, 1, 240)
      let session = await ready(ctx.signal)
      if (session.busy) throw new Error(BUSY)
      const where = cwd ? ` in ${pretty(cwd)}` : ''
      if (!(await ctx.confirm(`run "${clipText(command, 300)}" in the Terminal${where}`, 'It can change or delete files.'))) {
        throw new Error('The user did not allow this command.')
      }
      if (ctx.signal?.aborted) throw new Error('Cancelled.')
      session = await ready(ctx.signal) // the window may have been closed meanwhile
      if (session.busy) throw new Error(BUSY)
      const run = session.runForAi(command, cwd)

      let timer: ReturnType<typeof setTimeout> | undefined
      const timedOut = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), timeout * 1000)))
      const aborted = new Promise<'aborted'>((resolve) => ctx.signal?.addEventListener('abort', () => resolve('aborted'), { once: true }))
      const end = await Promise.race([run.done, timedOut, aborted])
      clearTimeout(timer)
      const output = run.output()
      run.detach()
      const out = clipText(output.replace(/\n+$/, ''), MAX_OUTPUT)
      if (end === 'aborted') throw new Error('Cancelled: the command keeps running in the Terminal.')
      const folder = pretty(session.cwd)
      if (end === 'timeout') {
        return {
          output: out,
          still_running: true,
          cwd: folder,
          note: `Not finished after ${timeout} s; it keeps running. terminal_read_output shows more later, terminal_interrupt stops it.`,
        }
      }
      return {
        output: out,
        ...(end.status !== null && { exit_status: end.status }),
        cwd: folder,
        ...(end.note && { note: end.note }),
        ...(output.length > MAX_OUTPUT && { truncated: true }),
      }
    },

    async read_output(a, ctx) {
      const session = await ready(ctx.signal)
      const n = clamp(a.lines, 100, 1, 2000)
      const lines = view.lines(n)
      return {
        text: clipText(lines.join('\n'), MAX_OUTPUT),
        lines: lines.length,
        cwd: pretty(session.cwd),
        busy: session.busy,
      }
    },

    async interrupt(_a, ctx) {
      const session = await ready(ctx.signal)
      const did = session.interrupt()
      return did ? { done: did } : { done: null, note: 'Nothing was running.' }
    },
  }
}
