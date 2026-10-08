// Mechanism viewer: step through a mechanism (Prev / Next / Play), the structures of each step drawn by RDKit, the
// electron pushing in words, and the matching point highlighted on the energy profile.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, Workflow } from 'lucide-react'
import { equationSvg } from './compose'
import { ARROWS, resolveSpecies } from './reaction'
import { LIBRARY, findReaction, type LibReaction } from './library'
import { profileFigure } from './figures'
import { analyse, profileFromMechanism } from './profile'
import { Mol, Card, Fx, Hint, ResultActions, useKr } from './ui'
import { printSvg } from './structures'
import PlotlyChart, { usePalette } from './PlotlyChart'

const WITH_MECHANISM = LIBRARY.filter((r) => r.mechanism)

function Species({ list, size }: { list: string[]; size: number }) {
  return (
    <div className="kr-mrow">
      {list.map((smiles, i) => {
        const s = resolveSpecies(smiles)
        return (
          <Fragment key={i}>
            {i > 0 && <span className="kr-plus" aria-hidden="true">+</span>}
            <figure className="kr-eqitem">
              <Mol smiles={smiles} width={size} height={Math.round(size * 0.72)} fallback={<span className="kr-bigf"><Fx f={s.formula} charge={s.charge} /></span>} />
              <figcaption className="k-muted kr-small"><Fx f={s.formula} charge={s.charge} /></figcaption>
            </figure>
          </Fragment>
        )
      })}
    </div>
  )
}

function mechanismText(r: LibReaction): string {
  const m = r.mechanism ?? []
  const lines = [`${r.name}: mechanism`]
  m.forEach((s, i) => lines.push(`${i}. ${s.label} (${s.energy} kJ/mol${s.ts !== undefined ? `, TS ${s.ts}` : ''}): ${s.text}`))
  return lines.join('\n')
}

export function MechanismTool() {
  const kr = useKr()
  const pal = usePalette()
  const wanted = kr.ws.mechanism.reactionId ? findReaction(kr.ws.mechanism.reactionId) : null
  const reaction = wanted?.mechanism ? wanted : WITH_MECHANISM[0]
  const mech = reaction.mechanism ?? []
  const step = Math.min(Math.max(0, kr.ws.mechanism.step), mech.length - 1)
  const [playing, setPlaying] = useState(false)
  const stepRef = useRef(step)
  stepRef.current = step

  const setStep = (s: number) => kr.patch('mechanism', { reactionId: reaction.id, step: Math.min(Math.max(0, s), mech.length - 1) })

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      if (stepRef.current >= mech.length - 1) {
        setPlaying(false)
        return
      }
      kr.patch('mechanism', { reactionId: reaction.id, step: stepRef.current + 1 })
    }, 3200)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, reaction.id, mech.length])

  const profile = useMemo(() => profileFromMechanism(mech), [mech])
  const info = useMemo(() => analyse(profile), [profile])
  const figure = useMemo(() => profileFigure({ profile, active: step * 2 }, pal), [profile, step, pal])
  const cur = mech[step]
  const prev = step > 0 ? mech[step - 1] : null
  const stepInfo = step > 0 ? info.steps[step - 1] : null
  const pinSvgs = () => {
    const rd = kr.rd
    if (!rd) return []
    const pic = (smiles: string) => ({ svg: printSvg(rd, smiles, 260, 180), label: smiles, coeff: 1 })
    return mech.map((m) => equationSvg({ reactants: m.species.map(pic), products: [], arrow: '', above: '', below: '', background: true }))
  }

  return (
    <div className="kr-tool-body kr-mech">
      <Card
        title="Mechanism"
        icon={<Workflow size={15} />}
        actions={<ResultActions tool="mechanism" label={`${reaction.name}: mechanism`} text={mechanismText(reaction)} svgs={pinSvgs} />}
      >
        <div className="kr-mechbar">
          <select
            className="k-input"
            aria-label="Reaction with a mechanism"
            value={reaction.id}
            onChange={(e) => {
              setPlaying(false)
              kr.patch('mechanism', { reactionId: e.target.value, step: 0 })
            }}
          >
            {WITH_MECHANISM.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="kr-transport">
            <button className="k-icon-btn" onClick={() => { setPlaying(false); setStep(step - 1) }} disabled={step === 0} aria-label="Previous step" title="Previous step"><ChevronLeft size={16} /></button>
            <button
              className="k-btn small"
              onClick={() => {
                if (!playing && step >= mech.length - 1) setStep(0)
                setPlaying(!playing)
              }}
              title={playing ? 'Pause' : 'Play through the steps'}
            >
              {playing ? <Pause size={13} /> : <Play size={13} />} {playing ? 'Pause' : 'Play'}
            </button>
            <button className="k-icon-btn" onClick={() => { setPlaying(false); setStep(step + 1) }} disabled={step >= mech.length - 1} aria-label="Next step" title="Next step"><ChevronRight size={16} /></button>
          </div>
        </div>
        <input
          type="range" className="kr-slider" min={0} max={mech.length - 1} value={step} aria-label="Mechanism step"
          onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)) }}
        />
        <div className="kr-timeline" role="tablist" aria-label="Steps">
          {mech.map((m, i) => (
            <button key={i} role="tab" aria-selected={i === step} className={`kr-tl ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`} onClick={() => { setPlaying(false); setStep(i) }} title={m.label}>
              <span className="kr-tl-dot">{i}</span>
              <span className="kr-tl-label">{m.label}</span>
            </button>
          ))}
        </div>
      </Card>

      <div className="kr-mechgrid">
        <Card title={`Step ${step} of ${mech.length - 1}: ${cur.label}`}>
          <div className="kr-flow">
            {prev && (
              <>
                <div className="kr-prev"><Species list={prev.species} size={110} /></div>
                <div className="kr-flowarrow">
                  <span className="kr-small k-muted">TS ‡ {cur.ts !== undefined ? `${cur.ts} kJ/mol` : ''}</span>
                  <span className="kr-arrowglyph">{ARROWS[reaction.arrow === 'equilibrium' && step === mech.length - 1 ? 'equilibrium' : 'forward'].symbol}</span>
                </div>
              </>
            )}
            <div className="kr-now"><Species list={cur.species} size={prev ? 150 : 180} /></div>
          </div>
          <p className="kr-explain">{cur.text}</p>
          <div className="kr-kv">
            <span>Energy of this state</span><b>{cur.energy} kJ/mol</b>
            {stepInfo && <><span>Barrier of this step</span><b>forward {stepInfo.eaF.toFixed(0)}, back {stepInfo.eaR.toFixed(0)} kJ/mol</b></>}
            {stepInfo && <><span>Energy change of the step</span><b>{stepInfo.dE > 0 ? '+' : ''}{stepInfo.dE.toFixed(0)} kJ/mol</b></>}
          </div>
          {stepInfo && <Hint>{stepInfo.hammond}</Hint>}
        </Card>
        <Card title="Energy profile">
          <PlotlyChart figure={figure} height={300} />
          {info.valid && (
            <div className="kr-small k-muted">
              Overall ΔH = {info.dH.toFixed(0)} kJ/mol · highest barrier {info.eaOverall.toFixed(0)} kJ/mol · rate-determining step: <b>{info.steps[info.rds]?.from} → {info.steps[info.rds]?.to}</b>. Energies are illustrative textbook values.
            </div>
          )}
        </Card>
      </div>

      <Card title="All steps">
        <details className="kr-details">
          <summary className="k-muted kr-small">Show every step with its structures</summary>
          <ol className="kr-allsteps">
            {mech.map((m, i) => (
              <li key={i}>
                <b>{m.label}</b>
                <Species list={m.species} size={90} />
                <p className="kr-small">{m.text}</p>
              </li>
            ))}
          </ol>
        </details>
      </Card>

      <Card title="Reaction">
        <p className="kr-explain">{reaction.explanation}</p>
        <div className="kr-actions">
          <button className="k-btn small" onClick={() => kr.loadReaction(reaction.id, 'builder')}>Load in builder</button>
          <button className="k-btn small" onClick={() => kr.loadReaction(reaction.id, 'energy')}>Edit the energy profile</button>
        </div>
      </Card>
    </div>
  )
}
