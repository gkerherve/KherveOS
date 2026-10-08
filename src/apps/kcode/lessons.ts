// The curriculum of kCode: courses → chapters → lessons.  The lessons themselves are in
// lessons.python.ts, lessons.science.ts, lessons.js.ts and lessons.lab.ts.

import type { Chapter, Course, Lesson } from './lessonTypes.ts'
import { PYTHON_BASICS } from './lessons.python.ts'
import { PYTHON_SCIENCE } from './lessons.science.ts'
import { JAVASCRIPT_BASICS } from './lessons.js.ts'
import { LAB_RECIPES } from './lessons.lab.ts'

export type { Chapter, Course, Lesson, Language, Level, Need } from './lessonTypes.ts'

export const COURSES: Course[] = [PYTHON_BASICS, PYTHON_SCIENCE, JAVASCRIPT_BASICS, LAB_RECIPES]

/** Every lesson in teaching order. */
export const LESSONS: Lesson[] = COURSES.flatMap((c) => c.chapters.flatMap((ch) => ch.lessons))

export interface LessonPlace {
  lesson: Lesson
  course: Course
  chapter: Chapter
  /** Position in LESSONS. */
  index: number
}

const PLACES = new Map<string, LessonPlace>()
LESSONS.forEach((lesson, index) => {
  for (const course of COURSES) {
    for (const chapter of course.chapters) {
      if (chapter.lessons.includes(lesson)) PLACES.set(lesson.id, { lesson, course, chapter, index })
    }
  }
})

export const lessonById = (id: string): Lesson | undefined => PLACES.get(id)?.lesson
export const placeOf = (id: string): LessonPlace | undefined => PLACES.get(id)

/** The lesson after or before `id` (null at the ends). */
export function neighbour(id: string, delta: 1 | -1): Lesson | null {
  const p = PLACES.get(id)
  return p ? (LESSONS[p.index + delta] ?? null) : null
}

/** Lessons whose title, course, chapter or text contains every word of the query. */
export function searchLessons(query: string, plain: (lesson: Lesson) => string = (l) => l.text): Lesson[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return LESSONS
  return LESSONS.filter((l) => {
    const p = PLACES.get(l.id)!
    const hay = `${l.title} ${p.course.title} ${p.chapter.title} ${l.level} ${l.language} ${plain(l)}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
