// Kherve Grand Prix — the podium after the race: the top three on their steps
// with their trophies, confetti, champagne and, for a win, fireworks over the
// circuit, the fanfare and the crowd cheering. Also the short burst of
// confetti for a pole position.

import { useEffect, useRef } from 'react'
import { TEAMS, type Classified } from './f1Race'
import { champagne, cheer, fanfare, firework } from './f1Cheer'

const GOLD = ['#fff4b0', '#ffd34a', '#c98a12', '#7a4e05']
const SILVER = ['#ffffff', '#d9dee6', '#8f98a6', '#4b525e']
const BRONZE = ['#ffd9b0', '#d98f4e', '#9a5a26', '#55300f']
const METALS = [GOLD, SILVER, BRONZE]
const CONFETTI = ['#ffd34a', '#ff4d6d', '#22c55e', '#3b82f6', '#f97316', '#a855f7', '#ffffff', '#06b6d4']

export function Trophy({ place, size = 64 }: { place: number; size?: number }) {
  const [hi, mid, lo, dark] = METALS[place - 1] ?? GOLD
  const id = `gp-tr${place}`
  return (
    <svg className="gp-trophy" width={size} height={size * 1.25} viewBox="0 0 80 100" aria-label={`Trophy for P${place}`}>
      <defs>
        <linearGradient id={`${id}a`} x1="0" x2="1">
          <stop offset="0" stopColor={lo} />
          <stop offset="0.35" stopColor={hi} />
          <stop offset="0.6" stopColor={mid} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" x2="1">
          <stop offset="0" stopColor="#2a1d12" />
          <stop offset="0.4" stopColor="#5a4030" />
          <stop offset="1" stopColor="#1a120b" />
        </linearGradient>
      </defs>
      {/* handles */}
      <path d="M17 18 C2 18 2 44 24 48" fill="none" stroke={`url(#${id}a)`} strokeWidth="5" strokeLinecap="round" />
      <path d="M63 18 C78 18 78 44 56 48" fill="none" stroke={`url(#${id}a)`} strokeWidth="5" strokeLinecap="round" />
      {/* the cup */}
      <path d="M14 10 H66 C66 38 56 54 40 58 C24 54 14 38 14 10 Z" fill={`url(#${id}a)`} stroke={dark} strokeWidth="1" />
      <ellipse cx="40" cy="10" rx="26" ry="4" fill={dark} />
      <ellipse cx="40" cy="10" rx="24" ry="2.8" fill={lo} />
      {/* the shine */}
      <path d="M22 16 C22 34 28 46 35 51" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round" />
      {/* the place, engraved */}
      <text x="44" y="38" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="18" fill={dark} opacity="0.55">
        {place}
      </text>
      {/* stem and base */}
      <path d="M36 57 H44 L45 70 H35 Z" fill={`url(#${id}a)`} />
      <ellipse cx="40" cy="71" rx="12" ry="3" fill={mid} stroke={dark} strokeWidth="0.8" />
      <path d="M24 76 H56 L59 96 H21 Z" fill={`url(#${id}b)`} />
      <rect x="31" y="82" width="18" height="7" rx="1" fill={mid} />
    </svg>
  )
}

interface Bit {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  color: string
  kind: 'confetti' | 'rocket' | 'spark' | 'fizz'
  rot: number
  vr: number
  size: number
  boom?: number
}

/** The confetti, champagne and fireworks, drawn on a canvas over the whole game. */
function Sky({ fireworks, champagneFrom, duration }: { fireworks: boolean; champagneFrom: number[]; duration: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    let w = 0
    let h = 0
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      w = cv.clientWidth
      h = cv.clientHeight
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(cv)
    const bits: Bit[] = []
    const rnd = (a: number, b: number) => a + Math.random() * (b - a)
    const confetti = (n: number, fromTop: boolean) => {
      for (let i = 0; i < n; i++)
        bits.push({
          x: fromTop ? rnd(0, w) : w / 2 + rnd(-40, 40),
          y: fromTop ? rnd(-h * 0.5, -10) : h * 0.62,
          vx: fromTop ? rnd(-30, 30) : rnd(-420, 420),
          vy: fromTop ? rnd(40, 120) : rnd(-760, -380),
          life: 0,
          max: rnd(5, 9),
          color: CONFETTI[i % CONFETTI.length],
          kind: 'confetti',
          rot: rnd(0, 6),
          vr: rnd(-9, 9),
          size: rnd(5, 10),
        })
    }
    const rocket = () => {
      const hue = CONFETTI[Math.floor(Math.random() * CONFETTI.length)]
      bits.push({ x: rnd(w * 0.12, w * 0.88), y: h + 10, vx: rnd(-40, 40), vy: rnd(-h * 1.05, -h * 0.8), life: 0, max: rnd(0.9, 1.3), color: hue, kind: 'rocket', rot: 0, vr: 0, size: 3, boom: rnd(0.75, 1.1) })
    }
    const explode = (b: Bit) => {
      const n = 70
      const speed = rnd(140, 260)
      const two = Math.random() < 0.4 ? CONFETTI[Math.floor(Math.random() * CONFETTI.length)] : b.color
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd(-0.05, 0.05)
        const s = speed * rnd(0.6, 1)
        bits.push({ x: b.x, y: b.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: rnd(1.2, 2), color: i % 2 ? b.color : two, kind: 'spark', rot: 0, vr: 0, size: rnd(1.6, 2.6) })
      }
      firework(0, 1 + (1 - b.y / h) * 0.6)
    }
    confetti(fireworks ? 220 : 120, true)
    if (champagneFrom.length) confetti(90, false)
    let t = 0
    let nextRocket = 0.4
    let last = performance.now()
    let raf = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      t += dt
      if (fireworks && t < duration && t > nextRocket) {
        rocket()
        if (Math.random() < 0.35) rocket()
        nextRocket = t + rnd(0.35, 0.9)
      }
      if (t < duration - 2 && Math.random() < dt * (fireworks ? 14 : 6)) confetti(3, true)
      // champagne: two jets of fizz from the podium steps
      if (t > 0.6 && t < 3.6)
        for (const fx of champagneFrom)
          for (let k = 0; k < 6; k++) {
            const a = -Math.PI / 2 + (fx < 0.5 ? 0.5 : -0.5) + rnd(-0.25, 0.25)
            const s = rnd(380, 620)
            bits.push({ x: fx * w, y: h * 0.58, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: rnd(0.8, 1.4), color: Math.random() < 0.7 ? '#fff6d0' : '#ffe58a', kind: 'fizz', rot: 0, vr: 0, size: rnd(1.5, 3.5) })
          }
      g.clearRect(0, 0, w, h)
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i]
        b.life += dt
        if (b.kind === 'confetti') {
          b.vy = Math.min(b.vy + 260 * dt, 90)
          b.vx *= 1 - 1.4 * dt
          b.x += (b.vx + Math.sin(b.life * 3 + b.rot) * 30) * dt
        } else if (b.kind === 'rocket') {
          b.vy += 420 * dt
          b.x += b.vx * dt
          if (b.life > b.boom!) {
            explode(b)
            bits.splice(i, 1)
            continue
          }
        } else {
          b.vy += (b.kind === 'spark' ? 90 : 700) * dt
          b.vx *= 1 - (b.kind === 'spark' ? 1.2 : 0.4) * dt
          b.x += b.vx * dt
        }
        b.y += b.vy * dt
        b.rot += b.vr * dt
        if (b.life > b.max || b.y > h + 40) {
          bits.splice(i, 1)
          continue
        }
        const fade = Math.min(1, (b.max - b.life) * 2)
        g.globalAlpha = fade
        g.fillStyle = b.color
        if (b.kind === 'confetti') {
          g.save()
          g.translate(b.x, b.y)
          g.rotate(b.rot)
          g.scale(1, Math.cos(b.life * 6 + b.rot))
          g.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2)
          g.restore()
        } else if (b.kind === 'rocket') {
          g.fillRect(b.x - 1.5, b.y - 1.5, 3, 3)
          g.globalAlpha = 0.4
          g.fillRect(b.x - 1, b.y, 2, 14)
        } else {
          g.beginPath()
          g.arc(b.x, b.y, b.size, 0, Math.PI * 2)
          g.fill()
          if (b.kind === 'spark') {
            g.globalAlpha = fade * 0.25
            g.beginPath()
            g.arc(b.x, b.y, b.size * 3, 0, Math.PI * 2)
            g.fill()
          }
        }
      }
      g.globalAlpha = 1
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [fireworks, champagneFrom, duration])
  return <canvas ref={ref} className="gp-sky" />
}

const NONE: number[] = []
const STEPS = [1, 0, 2] // left to right: P2, P1, P3

/** The podium ceremony. `place` is the player's finishing position (1-3). */
export function Podium({ rows, place, onDone }: { rows: Classified[]; place: number; onDone: () => void }) {
  const win = place === 1
  // the player's step sprays the champagne: P2 on the left, P1 in the middle, P3 on the right
  const spray = useRef([[0.5, 0.36, 0.64], [0.36], [0.64]][place - 1] ?? []).current
  useEffect(() => {
    fanfare(place)
    cheer(win ? 9 : 6, win)
    const pop = window.setTimeout(() => champagne(), 600)
    return () => window.clearTimeout(pop)
  }, [place, win])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault()
        onDone()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onDone])
  const me = rows[place - 1]
  return (
    <div className="gp-podium-wrap">
      <Sky fireworks={win} champagneFrom={spray} duration={win ? 14 : 8} />
      <div className="gp-cheer">
        <div className="gp-hooray">{win ? 'HOORAY!' : place === 2 ? 'BRAVO!' : 'PODIUM!'}</div>
        <div className="gp-cheer-sub">
          {win ? `${me?.name ?? 'You'} wins the Grand Prix!` : `${me?.name ?? 'You'} finishes P${place} — on the podium!`}
        </div>
        <div className="gp-podium">
          {STEPS.map((k) => {
            const r = rows[k]
            if (!r) return <div key={k} className="gp-step-col" />
            return (
              <div key={k} className={`gp-step-col gp-p${k + 1} ${r.player ? 'gp-me' : ''}`}>
                <Trophy place={k + 1} size={k === 0 ? 76 : 56} />
                <div className="gp-step-name">
                  <i style={{ background: TEAMS[r.team].color2 }} />
                  {r.name}
                </div>
                <div className="gp-step-team">{TEAMS[r.team].name}</div>
                <div className="gp-step">
                  <b>{k + 1}</b>
                </div>
              </div>
            )
          })}
        </div>
        <button className="k-btn gp-go" onClick={onDone} autoFocus>
          See the results
        </button>
      </div>
    </div>
  )
}

/** A short shower of confetti and a cheer, for a pole position. */
export function PoleBurst() {
  useEffect(() => {
    cheer(4, false)
    fanfare(3)
  }, [])
  return <Sky fireworks={false} champagneFrom={NONE} duration={4} />
}
