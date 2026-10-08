// The course tree: courses → chapters → lessons, with ticks, a progress bar and a search box.

import { useMemo } from 'react'
import { ChevronDown, ChevronRight, Circle, CircleCheck, Flame, Search, X } from 'lucide-react'
import { COURSES, LESSONS, placeOf, searchLessons, type Lesson } from './lessons.ts'
import { plainText, parseMarkdown } from './markdown.ts'

interface Props {
  current: string | null
  done: Set<string>
  query: string
  onQuery(q: string): void
  folded: string[]
  onToggleFold(courseId: string): void
  onOpen(id: string): void
  streak: { current: number; best: number }
}

const LEVEL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' } as const

/** Searchable text of a lesson, computed once. */
const PLAIN = new Map<string, string>()
const plainOf = (l: Lesson) => {
  let t = PLAIN.get(l.id)
  if (t === undefined) {
    t = plainText(parseMarkdown(l.text)) + ' ' + (l.task ?? '')
    PLAIN.set(l.id, t)
  }
  return t
}

function LessonButton({ lesson, current, done, onOpen, hint }: { lesson: Lesson; current: boolean; done: boolean; onOpen(id: string): void; hint?: string }) {
  return (
    <button
      className={`kcd-item${current ? ' on' : ''}${done ? ' done' : ''}`}
      onClick={() => onOpen(lesson.id)}
      title={`${lesson.title} — ${LEVEL_LABEL[lesson.level]}, about ${lesson.minutes} min${done ? ', completed' : ''}`}
      aria-current={current ? 'true' : undefined}
    >
      <span className="kcd-tick" aria-label={done ? 'Completed' : 'Not completed'}>
        {done ? <CircleCheck size={14} /> : <Circle size={14} />}
      </span>
      <span className="kcd-item-title">{lesson.title}</span>
      {hint && <span className="kcd-item-hint">{hint}</span>}
      <span className={`kcd-lvl ${lesson.level}`} aria-hidden="true" title={LEVEL_LABEL[lesson.level]} />
    </button>
  )
}

export function Sidebar({ current, done, query, onQuery, folded, onToggleFold, onOpen, streak }: Props) {
  const total = LESSONS.length
  const finished = LESSONS.filter((l) => done.has(l.id)).length
  const results = useMemo(() => (query.trim() ? searchLessons(query, plainOf) : null), [query])

  return (
    <aside className="kcd-side" aria-label="Lessons">
      <div className="kcd-search">
        <Search size={13} />
        <input className="k-input" value={query} placeholder="Search lessons" aria-label="Search lessons" onChange={(e) => onQuery(e.target.value)} />
        {query && <button className="k-icon-btn" aria-label="Clear the search" onClick={() => onQuery('')}><X size={13} /></button>}
      </div>
      <div className="kcd-overall" title={`${finished} of ${total} lessons completed`}>
        <div className="kcd-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={finished} aria-label="Progress">
          <div style={{ width: `${(finished / total) * 100}%` }} />
        </div>
        <span>{finished} / {total} done</span>
        {streak.current > 0 && <span className="kcd-streak" title={`Best streak: ${streak.best} days`}><Flame size={12} /> {streak.current} day{streak.current > 1 ? 's' : ''}</span>}
      </div>
      <div className="kcd-tree">
        {results ? (
          results.length ? (
            results.map((l) => {
              const p = placeOf(l.id)!
              return <LessonButton key={l.id} lesson={l} current={l.id === current} done={done.has(l.id)} onOpen={onOpen} hint={p.course.title} />
            })
          ) : (
            <p className="kcd-empty">No lesson matches “{query}”.</p>
          )
        ) : (
          COURSES.map((course) => {
            const lessons = course.chapters.flatMap((c) => c.lessons)
            const n = lessons.filter((l) => done.has(l.id)).length
            const open = !folded.includes(course.id)
            return (
              <div key={course.id} className="kcd-course">
                <button className="kcd-course-head" onClick={() => onToggleFold(course.id)} aria-expanded={open} title={course.blurb}>
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className="kcd-course-title">{course.title}</span>
                  <span className="kcd-count">{n}/{lessons.length}</span>
                </button>
                <div className="kcd-progress thin" aria-hidden="true"><div style={{ width: `${(n / lessons.length) * 100}%` }} /></div>
                {open && course.chapters.map((ch) => (
                  <div key={ch.id} className="kcd-chapter">
                    <div className="kcd-chapter-title">{ch.title}</div>
                    {ch.lessons.map((l) => <LessonButton key={l.id} lesson={l} current={l.id === current} done={done.has(l.id)} onOpen={onOpen} />)}
                  </div>
                ))}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
