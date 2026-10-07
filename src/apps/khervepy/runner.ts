// Running Python files: one Pyodide kernel per KhervePY window, its output
// streamed into the Output panel (stderr in red), Stop = restart the kernel.

import { useCallback, useEffect, useRef, useState } from 'react'
import { PythonKernel, type KernelStatus } from '@/os/python/kernel'

export type OutKind = 'out' | 'err' | 'info' | 'cmd' | 'ok' | 'fail' | 'img'

export interface OutLine {
  id: number
  kind: OutKind
  text: string
}

export interface RunResult {
  exitCode: number | null
  stopped: boolean
  /** Everything written to stderr during the run. */
  stderr: string
}

const MAX_CHARS = 400_000

/** Import names whose pip package is called something else (from the desktop app). */
export const PIP_NAMES: Record<string, string> = {
  cv2: 'opencv-python',
  PIL: 'pillow',
  sklearn: 'scikit-learn',
  yaml: 'pyyaml',
  bs4: 'beautifulsoup4',
  Crypto: 'pycryptodome',
  serial: 'pyserial',
  dotenv: 'python-dotenv',
  dateutil: 'python-dateutil',
  OpenGL: 'PyOpenGL',
  docx: 'python-docx',
  pptx: 'python-pptx',
  fitz: 'PyMuPDF',
}

export interface Runner {
  lines: OutLine[]
  version: number
  status: KernelStatus
  /** The file being run, or null. */
  running: string | null
  append(kind: OutKind, text: string): void
  clear(): void
  run(file: string, cwd: string, label: string): Promise<RunResult>
  stop(): Promise<void>
  install(packages: string[]): Promise<boolean>
  restart(): Promise<void>
}

export function useRunner(name: string): Runner {
  const kernel = useRef<PythonKernel | null>(null)
  const [status, setStatus] = useState<KernelStatus>('off')
  const [running, setRunning] = useState<string | null>(null)
  const lines = useRef<OutLine[]>([])
  const chars = useRef(0)
  const nextId = useRef(1)
  const [version, setVersion] = useState(0)
  const frame = useRef<number | null>(null)
  const stopping = useRef(false)

  // Repaint at most once per frame, however fast a program prints.
  const bump = useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      setVersion((v) => v + 1)
    })
  }, [])

  const append = useCallback(
    (kind: OutKind, text: string) => {
      if (!text) return
      const list = lines.current
      const last = list[list.length - 1]
      if (last && last.kind === kind && kind !== 'img' && kind !== 'cmd') last.text += text
      else list.push({ id: nextId.current++, kind, text })
      chars.current += text.length
      while (chars.current > MAX_CHARS && list.length > 1) chars.current -= list.shift()!.text.length
      bump()
    },
    [bump],
  )

  const clear = useCallback(() => {
    lines.current = []
    chars.current = 0
    bump()
  }, [bump])

  const getKernel = useCallback(() => {
    if (!kernel.current) {
      const k = new PythonKernel(name)
      k.onStatus(setStatus)
      kernel.current = k
    }
    return kernel.current
  }, [name])

  useEffect(
    () => () => {
      kernel.current?.dispose()
      kernel.current = null
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  const run = useCallback(
    async (file: string, cwd: string, label: string): Promise<RunResult> => {
      const k = getKernel()
      let stderr = ''
      stopping.current = false
      setRunning(file)
      append('cmd', `$ python ${label}\n`)
      if (k.status === 'off' || k.status === 'starting') append('info', 'Starting Python…\n')
      try {
        const r = await k.runScript(file, [], cwd, {
          onStdout: (t) => append('out', t),
          onStderr: (t) => {
            stderr += t
            append('err', t)
          },
          onStatus: (t) => append('info', t.endsWith('\n') ? t : t + '\n'),
        })
        for (const fig of r.figures) append('img', fig)
        append(r.exit_code === 0 ? 'ok' : 'fail', `\n[Process finished with exit code ${r.exit_code}]\n`)
        return { exitCode: r.exit_code, stopped: false, stderr }
      } catch (e) {
        if (stopping.current) {
          append('info', '\n[Process stopped]\n')
          return { exitCode: null, stopped: true, stderr }
        }
        const msg = e instanceof Error ? e.message : String(e)
        append('fail', `\n[KhervePY] Run failed — ${msg}\n`)
        return { exitCode: null, stopped: false, stderr }
      } finally {
        stopping.current = false
        setRunning(null)
      }
    },
    [append, getKernel],
  )

  const stop = useCallback(async () => {
    const k = kernel.current
    if (!k) return
    stopping.current = true
    // Python can't be interrupted from outside without SharedArrayBuffer: start a fresh one.
    await k.restart().catch((e: unknown) => append('fail', `\n[KhervePY] ${e instanceof Error ? e.message : String(e)}\n`))
  }, [append])

  const restart = useCallback(async () => {
    const k = kernel.current
    if (!k) return
    stopping.current = !!running
    append('info', 'Restarting Python…\n')
    await k.restart().catch((e: unknown) => append('fail', `${e instanceof Error ? e.message : String(e)}\n`))
    append('info', 'Python restarted.\n')
  }, [append, running])

  const install = useCallback(
    async (packages: string[]) => {
      const k = getKernel()
      append('cmd', `$ pip install ${packages.join(' ')}\n`)
      try {
        await k.install(packages, {
          onStdout: (t) => append('out', t),
          onStderr: (t) => append('err', t),
          onStatus: (t) => append('info', t.endsWith('\n') ? t : t + '\n'),
        })
        append('ok', `Installed ${packages.join(', ')}.\n`)
        return true
      } catch (e) {
        append('fail', `pip install failed: ${e instanceof Error ? e.message : String(e)}\n`)
        return false
      }
    },
    [append, getKernel],
  )

  return { lines: lines.current, version, status, running, append, clear, run, stop, install, restart }
}

/** "No module named 'x.y'" in a traceback → the pip package to offer ("x", or its known pip name). */
export function missingModule(stderr: string): { module: string; pip: string } | null {
  const m = /No module named ['"]([\w.]+)['"]/.exec(stderr)
  if (!m) return null
  const top = m[1].split('.')[0]
  return { module: top, pip: PIP_NAMES[top] ?? top }
}

/** Package names from a requirements.txt (specifiers kept, options and comments dropped). */
export function parseRequirements(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+#.*$/, '').trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('-'))
    .map((l) => l.split(';')[0].trim())
}
