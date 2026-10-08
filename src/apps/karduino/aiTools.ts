// AI tools of kArduino (the manifest is src/os/ai/manifests/karduino.ts).

import type { useAppTools } from '@/os/ai/appTools'
import type { CompileResult } from './build'

type Tools = Parameters<typeof useAppTools>[1]

interface Hooks {
  get(): { name: string; board: string; code: string; files: string[]; lines: string[]; open: boolean; dirty: boolean }
  setCode(code: string): void
  compile(): Promise<CompileResult>
  save(): Promise<string>
  send(text: string): Promise<void>
  examples(): { id: string; title: string; category: string; description: string }[]
  loadExample(id: string): Promise<{ loaded: boolean; title: string; board: string; libraries: string[]; wiring: string }>
  upload(): Promise<CompileResult>
  setBoard(board: string): string
  addFile(name: string, content: string): Promise<void>
}

/** What the AI needs of a compile: the verdict, the problems, the size, and the raw output (cut). */
const summary = (r: CompileResult) => ({
  ok: r.ok,
  cli: r.cli,
  output: r.output.length > 6000 ? `${r.output.slice(0, 6000)}\n… (cut)` : r.output,
  diagnostics: r.diagnostics.filter((d) => !d.external).slice(0, 30),
  size: r.size,
})

export function karduinoTools(h: Hooks): Tools {
  return {
    get_sketch: async () => {
      const s = h.get()
      return { name: `${s.name}.ino`, board: s.board, code: s.code, files: s.files }
    },
    set_sketch: async (a) => {
      const code = String(a.code ?? '')
      if (!code.trim()) throw new Error('Give the sketch code.')
      h.setCode(code)
      return { shown: true, note: 'Shown in kArduino: call kArduino compile to check it.' }
    },
    compile: async () => summary(await h.compile()),
    save: async () => ({ saved: await h.save() }),
    serial_read: async (a) => {
      const s = h.get()
      const n = Math.min(200, Math.max(1, Number(a.lines ?? 20)))
      return { connected: s.open, lines: s.lines.slice(-n) }
    },
    serial_send: async (a, ctx) => {
      const text = String(a.text ?? '')
      if (!h.get().open) throw new Error('The serial monitor is not connected: the user has to connect it first.')
      if (!(await ctx.confirm('send a line to the board', text))) return { sent: false }
      await h.send(text)
      return { sent: true }
    },
    load_example: async (a, ctx) => {
      const id = String(a.id ?? '').trim()
      if (!id) return { examples: h.examples() }
      if (h.get().dirty && !(await ctx.confirm('replace the open sketch with an example', id))) return { loaded: false }
      return h.loadExample(id)
    },
    upload: async (_a, ctx) => {
      const s = h.get()
      if (!(await ctx.confirm('upload the sketch to a board plugged into the KherveOS server\'s computer', s.board))) return { uploaded: false, note: 'The user declined.' }
      const r = await h.upload()
      return { ...summary(r), uploaded: !!r.uploaded, port: r.port }
    },
    set_board: async (a) => ({ board: h.setBoard(String(a.board ?? '')) }),
    add_file: async (a) => {
      const name = String(a.name ?? '').trim()
      await h.addFile(name, String(a.content ?? ''))
      return { added: name, note: 'A new tab of the sketch: it is sent to the compiler with the main file.' }
    },
  }
}
