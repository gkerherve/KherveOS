// The left column: the lesson's text, the task, the list of checks, the hint and the solution.

import { useEffect, useRef } from 'react'
import { ArrowRight, CircleCheck, Clock3, Eye, Lightbulb, X } from 'lucide-react'
import type { CheckResult } from './checks.ts'
import { summarizeChecks } from './checks.ts'
import type { Chapter, Course, Lesson } from './lessons.ts'
import { CodeBlock, MarkdownView } from './MarkdownView.tsx'

export interface CheckView {
  results: CheckResult[]
  /** The code was edited after these results were produced. */
  stale: boolean
}

interface Props {
  lesson: Lesson
  course: Course
  chapter: Chapter
  done: boolean
  hintShown: boolean
  solutionShown: boolean
  onHint(): void
  onSolution(): void
  onUseSolution(): void
  onClose(what: 'hint' | 'solution'): void
  checkView: CheckView | null
  next: Lesson | null
  onNext(): void
  fontSize: number
}

const LEVELS = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' } as const

export function LessonPane(p: Props) {
  const { lesson, checkView } = p
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => { top.current?.scrollTo({ top: 0 }) }, [lesson.id])
  const summary = checkView ? summarizeChecks(checkView.results) : null
  const passed = !!summary?.allPassed && !checkView?.stale

  return (
    <div className="kcd-lesson" ref={top}>
      <div className="kcd-crumb">{p.course.title} › {p.chapter.title}</div>
      <div className="kcd-title-row">
        <h2 className="kcd-title">{lesson.title}</h2>
        {p.done && <span className="kcd-done-badge" title="You completed this lesson"><CircleCheck size={13} /> Done</span>}
      </div>
      <div className="kcd-badges">
        <span className={`kcd-badge ${lesson.level}`}>{LEVELS[lesson.level]}</span>
        <span className="kcd-badge"><Clock3 size={11} /> {lesson.minutes} min</span>
        <span className="kcd-badge">{lesson.language === 'python' ? 'Python' : 'JavaScript'}</span>
      </div>

      <MarkdownView text={lesson.text} fontSize={p.fontSize} />

      {lesson.task && (
        <div className="kcd-task">
          <div className="kcd-task-head">Your turn</div>
          <MarkdownView text={lesson.task} fontSize={p.fontSize} />
          {lesson.checks && (
            <ul className="kcd-checks" aria-label="What is checked">
              {lesson.checks.map((c, i) => {
                const r = checkView?.results.find((x) => x.label === c.label)
                const state = !r || checkView?.stale ? 'pending' : r.ok ? 'ok' : 'fail'
                return (
                  <li key={i} className={state}>
                    <span className="kcd-check-mark" aria-label={state === 'ok' ? 'Passed' : state === 'fail' ? 'Failed' : 'Not checked yet'}>
                      {state === 'ok' ? '✓' : state === 'fail' ? '✗' : '○'}
                    </span>
                    <span>{c.label}{state === 'fail' && r?.detail ? <em className="kcd-why"> — {r.detail}</em> : null}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {passed && (
        <div className="kcd-success" role="status">
          <CircleCheck size={16} />
          <div>
            <strong>{summary!.headline}.</strong> Well done — this lesson is complete.
          </div>
          {p.next && <button className="k-btn small primary" onClick={p.onNext}>Next lesson <ArrowRight size={13} /></button>}
        </div>
      )}

      {(lesson.hint || lesson.solution) && (
        <div className="kcd-help">
          {lesson.hint && (
            <div>
              <button className="k-btn small" onClick={p.hintShown ? () => p.onClose('hint') : p.onHint} aria-expanded={p.hintShown}>
                <Lightbulb size={13} /> {p.hintShown ? 'Hide hint' : 'Show hint'}
              </button>
              {p.hintShown && <p className="kcd-reveal"><span>{lesson.hint}</span></p>}
            </div>
          )}
          {lesson.solution && (
            <div>
              <button className="k-btn small" onClick={p.solutionShown ? () => p.onClose('solution') : p.onSolution} aria-expanded={p.solutionShown}>
                {p.solutionShown ? <X size={13} /> : <Eye size={13} />} {p.solutionShown ? 'Hide solution' : 'Show solution'}
              </button>
              {p.solutionShown && (
                <div className="kcd-reveal">
                  <CodeBlock text={lesson.solution.replace(/\n$/, '')} lang={lesson.language} fontSize={p.fontSize - 0.5} />
                  <button className="k-btn small" onClick={p.onUseSolution}>Use this code in the editor</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!passed && p.done && p.next && (
        <div className="kcd-nextrow"><button className="k-btn small" onClick={p.onNext}>Next lesson <ArrowRight size={13} /></button></div>
      )}
    </div>
  )
}
