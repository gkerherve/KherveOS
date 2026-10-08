// AI tools of kCode (the manifest is src/os/ai/manifests/kcode.ts).

import type { useAppTools } from '@/os/ai/appTools'

type Tools = Parameters<typeof useAppTools>[1]

export interface LessonInfo {
  id: string
  language: string
  title: string
  course: string
  chapter: string
  level: string
  minutes: number
  done: boolean
  exercise: boolean
}

export interface RunSummary {
  ok: boolean
  output: string
  error?: string
}

export interface CheckSummaryInfo extends RunSummary {
  lesson: string
  passed: number
  total: number
  allPassed: boolean
  results: { label: string; ok: boolean; detail: string }[]
  note?: string
}

export interface ProgressInfo {
  completed: number
  total: number
  percent: number
  streak: { current: number; best: number }
  current: { id: string; title: string } | null
  next: { id: string; title: string } | null
  courses: { id: string; title: string; completed: number; total: number }[]
}

interface Hooks {
  lessons(filter: { course?: string; language?: string; query?: string }): LessonInfo[]
  open(id: string): void
  run(source: string): Promise<RunSummary>
  language(): string
  check(): Promise<CheckSummaryInfo>
  hint(): { lesson: string; hint: string | null; task: string | null }
  progress(): ProgressInfo
  setCode(code: string): { lesson: string | null; language: string }
}

const opt = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export function kcodeTools(h: Hooks): Tools {
  return {
    lessons: async (a) => h.lessons({ course: opt(a.course), language: opt(a.language), query: opt(a.query) }),
    open: async (a) => {
      h.open(String(a.lesson ?? ''))
      return { shown: true }
    },
    run: async (a) => {
      const source = String(a.code ?? '')
      if (!source.trim()) throw new Error('Give the code to run.')
      return { language: h.language(), ...(await h.run(source)) }
    },
    check: async () => h.check(),
    hint: async () => h.hint(),
    progress: async () => h.progress(),
    set_code: async (a) => {
      const code = String(a.code ?? '')
      if (!code.trim()) throw new Error('Give the code to put in the editor.')
      return { set: true, ...h.setCode(code) }
    },
  }
}
