// Practice and quiz: a titration of an unknown to do by hand (add titrant, read the pH, find the equivalence
// point, calculate the concentration) and multiple-choice questions computed from the same model.

import { useMemo, useState } from 'react'
import { Check as CheckIcon, RotateCcw, Undo2, X } from 'lucide-react'
import { detectEquivalence } from './analyse'
import { fixed, sig } from './format'
import { concFromVolume, gradeConcentration, makePractice, makeQuestion, type PracticeTask, type Question } from './practice'
import { computeResult, type TitrationResult } from './result'
import { newProject, type Project } from './project'
import { Notice, Section } from './ui'

const freshSeed = () => (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0

export interface PracticeState {
  seed: number
  task: PracticeTask
  project: Project
  result: TitrationResult
  readings: Array<{ V: number; y: number }>
  V: number
  /** The curve is shown in full (after the answer or on request). */
  revealed: boolean
  answer: string
  feedback: null | { grade: 'excellent' | 'close' | 'off'; errorPercent: number }
  add(dv: number): void
  undo(): void
  restart(seed?: number): void
  setAnswer(a: string): void
  check(): void
  reveal(): void
}

export function usePractice(): PracticeState {
  const [seed, setSeed] = useState(freshSeed)
  const [readings, setReadings] = useState<Array<{ V: number; y: number }>>([])
  const [revealed, setRevealed] = useState(false)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<PracticeState['feedback']>(null)
  const task = useMemo(() => makePractice(seed), [seed])
  const project = useMemo(() => {
    const p = newProject()
    p.name = 'Practice titration'
    p.acidbase = task.spec
    return p
  }, [task])
  const result = useMemo(() => computeResult(project), [project])
  const V = readings.length ? readings[readings.length - 1].V : 0
  return {
    seed, task, project, result, readings, V, revealed, answer, feedback,
    add(dv) {
      const next = Math.min(result.vmax * 1.2, Math.round((V + dv) * 1000) / 1000)
      if (next <= V) return
      setReadings((r) => [...r, { V: next, y: result.at(next).y }])
    },
    undo() { setReadings((r) => r.slice(0, -1)) },
    restart(s) {
      setSeed(s ?? freshSeed())
      setReadings([])
      setRevealed(false)
      setAnswer('')
      setFeedback(null)
    },
    setAnswer,
    check() {
      const v = Number(answer.replace(',', '.'))
      if (!Number.isFinite(v) || v <= 0) return
      setFeedback(gradeConcentration(task.trueConc, v))
      setRevealed(true)
    },
    reveal() { setRevealed(true) },
  }
}

export function PracticePanel({ p }: { p: PracticeState }) {
  const eq = useMemo(() => {
    if (p.readings.length < 6) return null
    const e = detectEquivalence({ V: [0, ...p.readings.map((r) => r.V)], pH: [p.result.start?.y ?? p.result.y[0], ...p.readings.map((r) => r.y)] })
    return e[0] ?? null
  }, [p.readings, p.result])
  const [hint, setHint] = useState(false)
  const { task } = p
  const truth = concFromVolume(task, p.result.eq[0]?.V ?? NaN)
  return (
    <div className="ti-practice">
      <Notice>
        <strong>Practice.</strong> {task.brief} Add titrant with the buttons on the right, watch the pH and the colour, and find the volume at the equivalence point. Then calculate the concentration: c = V<sub>eq</sub> × c<sub>titrant</sub> / V<sub>sample</sub>.
      </Notice>
      <Section title="Your readings" id="pr-readings">
        {p.readings.length === 0 ? <div className="ti-hint">Nothing added yet. Start with 1 mL steps, then go slowly near the steep part.</div> : (
          <div className="ti-scroll">
            <table className="ti-table compact" aria-label="Readings">
              <thead><tr><th>V / mL</th><th>pH</th><th>ΔpH / mL</th></tr></thead>
              <tbody>
                {p.readings.map((r, i) => {
                  const prev = i ? p.readings[i - 1] : { V: 0, y: p.result.y[0] }
                  return <tr key={i}><td>{fixed(r.V, 2)}</td><td>{fixed(r.y, 2)}</td><td>{fixed((r.y - prev.y) / (r.V - prev.V), 2)}</td></tr>
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="ti-btnrow">
          <button type="button" className="k-btn small" onClick={p.undo} disabled={p.readings.length === 0}><Undo2 size={12} /> Undo</button>
          <button type="button" className="k-btn small" onClick={() => setHint((h) => !h)} disabled={p.readings.length < 6}>Hint</button>
        </div>
        {hint && (eq ? <div className="ti-hint">The steepest rise so far is near <b>{fixed(eq.V, 2)} mL</b>. Add titrant in small steps around it to be sure.</div> : <div className="ti-hint">Take a few more readings first.</div>)}
      </Section>
      <Section title="Your answer" id="pr-answer">
        <div className="ti-row wide">
          <span className="ti-row-label">Concentration of the unknown</span>
          <span className="ti-row-ctl">
            <input className="k-input ti-input" value={p.answer} placeholder="mol/L, e.g. 0.0872" aria-label="Your answer in mol per litre" inputMode="decimal" onChange={(e) => p.setAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') p.check() }} />
            <button type="button" className="k-btn primary small" onClick={p.check} disabled={!(Number(p.answer.replace(',', '.')) > 0)}>Check</button>
          </span>
        </div>
        {p.feedback && (
          <Notice kind={p.feedback.grade === 'off' ? 'warn' : 'info'}>
            {p.feedback.grade === 'excellent' ? <CheckIcon size={13} /> : p.feedback.grade === 'close' ? <CheckIcon size={13} /> : <X size={13} />}{' '}
            {p.feedback.grade === 'excellent' ? 'Excellent: within 1 %.' : p.feedback.grade === 'close' ? 'Close: within 3 %. Take smaller steps near the equivalence point.' : 'Not quite: more than 3 % off.'}{' '}
            You gave {sig(Number(p.answer.replace(',', '.')), 4)} M ({p.feedback.errorPercent >= 0 ? '+' : ''}{fixed(p.feedback.errorPercent, 2)} %). The true value is <b>{sig(task.trueConc, 4)} M</b> (equivalence at {fixed(truth > 0 ? p.result.eq[0].V : NaN, 2)} mL).
          </Notice>
        )}
        <div className="ti-btnrow">
          <button type="button" className="k-btn small" onClick={p.reveal} disabled={p.revealed}>Show the full curve</button>
          <button type="button" className="k-btn small" onClick={() => p.restart()}><RotateCcw size={12} /> New unknown</button>
        </div>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- quiz

export interface QuizState {
  question: Question
  picked: number | null
  score: { right: number; total: number }
  streak: number
  choose(i: number): void
  next(): void
}

export function useQuiz(): QuizState {
  const [seed, setSeed] = useState(freshSeed)
  const [picked, setPicked] = useState<number | null>(null)
  const [score, setScore] = useState({ right: 0, total: 0 })
  const [streak, setStreak] = useState(0)
  const question = useMemo(() => makeQuestion(seed), [seed])
  return {
    question, picked, score, streak,
    choose(i) {
      if (picked !== null) return
      setPicked(i)
      const ok = i === question.answer
      setScore((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1 }))
      setStreak((s) => (ok ? s + 1 : 0))
    },
    next() {
      setSeed(freshSeed())
      setPicked(null)
    },
  }
}

export function QuizPanel({ q }: { q: QuizState }) {
  const { question } = q
  return (
    <div className="ti-quiz">
      <div className="ti-quiz-score" aria-live="polite">Score {q.score.right} / {q.score.total}{q.streak >= 3 ? ` · streak ${q.streak}` : ''}</div>
      <p className="ti-quiz-q" id="ti-quiz-q">{question.prompt}</p>
      <div className="ti-quiz-choices" role="radiogroup" aria-labelledby="ti-quiz-q">
        {question.choices.map((c, i) => {
          const state = q.picked === null ? '' : i === question.answer ? ' right' : i === q.picked ? ' wrong' : ''
          return (
            <button key={i} type="button" role="radio" aria-checked={q.picked === i} disabled={q.picked !== null} className={`ti-quiz-choice${state}`} onClick={() => q.choose(i)}>
              <kbd>{i + 1}</kbd> {c}
            </button>
          )
        })}
      </div>
      {q.picked !== null && (
        <Notice kind={q.picked === question.answer ? 'info' : 'warn'}>
          <strong>{q.picked === question.answer ? 'Correct. ' : 'Not this one. '}</strong>{question.explanation}
        </Notice>
      )}
      <div className="ti-btnrow">
        <button type="button" className="k-btn primary small" onClick={q.next}>{q.picked === null ? 'Skip' : 'Next question'}</button>
      </div>
    </div>
  )
}

