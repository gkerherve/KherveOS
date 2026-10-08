// The desktop's icons (icons.py): its Material Design Icons (qtawesome "mdi.*",
// here from npm @mdi/js — the same icon set), the element chip (a sun-lit
// sphere), the view-cube icons with one face shaded, and the KMol app mark
// (an ethanol ball-and-stick under "KMol" on the amber tile).

import { useId } from 'react'
import { darker, lighter } from './molrepr'

export function Mdi({ path, size = 20, title, className }: { path: string; size?: number; title?: string; className?: string }) {
  return (
    <svg className={`km-mdi${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path d={path} fill="currentColor" />
    </svg>
  )
}

/** icons.element_icon: a little sun-lit sphere in *color*. */
export function ElementChip({ color, size = 18 }: { color: string; size?: number }) {
  const id = useId().replace(/:/g, '')
  const r = size * 0.4
  const c = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="km-chip" aria-hidden>
      <defs>
        <radialGradient id={`g${id}`} cx={c - r * 0.32} cy={c - r * 0.32} r={r * 1.5} fx={c - r * 0.42} fy={c - r * 0.42} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={lighter(color, 160)} />
          <stop offset="1" stopColor={darker(color, 150)} />
        </radialGradient>
      </defs>
      <circle cx={c} cy={c} r={r} fill={`url(#g${id})`} stroke={darker(color, 180)} strokeWidth={Math.max(0.6, r * 0.12)} />
    </svg>
  )
}

// ------------------------------------------------------------- view cube

type V3 = [number, number, number]
const CUBE_V: V3[] = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
const CUBE_F: [V3, number[]][] = [
  [[1, 0, 0], [1, 2, 6, 5]],
  [[-1, 0, 0], [0, 4, 7, 3]],
  [[0, 1, 0], [2, 3, 7, 6]],
  [[0, -1, 0], [0, 1, 5, 4]],
  [[0, 0, 1], [4, 5, 6, 7]],
  [[0, 0, -1], [0, 3, 2, 1]],
]
const VIEW_NORMAL: Record<string, V3 | null> = {
  front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 0, 1], bottom: [0, 0, -1], isometric: null,
}
const vdot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const vcross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const vunit = (a: V3): V3 => {
  const n = Math.sqrt(vdot(a, a)) || 1
  return [a[0] / n, a[1] / n, a[2] / n]
}

/** icons.view_cube_icon: a small cube with the face for *view* shaded. */
export function ViewCubeIcon({ view, size = 24, accent = '#159c74' }: { view: string; size?: number; accent?: string }) {
  const target = VIEW_NORMAL[view] ?? null
  const cam = target === null ? vunit([1, -1, 0.8]) : vunit(target.map((n) => (n ? n * 1.3 : 0.5)) as V3)
  const worldUp: V3 = Math.abs(cam[2]) > 0.94 ? [0, 1, 0] : [0, 0, 1]
  const right = vunit(vcross(worldUp, cam))
  const up = vunit(vcross(cam, right))
  const pv = CUBE_V.map((v) => [vdot(v, right), -vdot(v, up), vdot(v, cam)] as V3)
  const all = pv.flatMap((p) => [p[0], p[1]])
  const lo = Math.min(...all), hi = Math.max(...all)
  const span = hi - lo || 1
  const margin = size * 0.16
  const scale = (size - 2 * margin) / span
  const px = (p: V3) => `${(margin + (p[0] - lo) * scale).toFixed(2)},${(margin + (p[1] - lo) * scale).toFixed(2)}`
  const faces: [number, number[], boolean][] = []
  for (const [normal, idx] of CUBE_F) {
    if (vdot(normal, cam) <= 0.01) continue
    const depth = idx.reduce((s, i) => s + pv[i][2], 0) / 4
    const isTarget = target !== null && normal[0] === target[0] && normal[1] === target[1] && normal[2] === target[2]
    faces.push([depth, idx, isTarget])
  }
  faces.sort((a, b) => a[0] - b[0])
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      {faces.map(([, idx, t], k) => (
        <polygon key={k} points={idx.map((i) => px(pv[i])).join(' ')} fill={t ? accent : '#e6e8ec'} stroke="#33373d" strokeWidth={Math.max(1, size * 0.05)} strokeLinejoin="round" />
      ))}
    </svg>
  )
}

// --------------------------------------------------------------- KMol mark

function Sphere({ cx, cy, r, body, id }: { cx: number; cy: number; r: number; body: string; id: string }) {
  return (
    <>
      <defs>
        <radialGradient id={id} cx={cx - r * 0.32} cy={cy - r * 0.32} r={r * 1.5} fx={cx - r * 0.42} fy={cy - r * 0.42} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={lighter(body, 160)} />
          <stop offset="1" stopColor={darker(body, 150)} />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} stroke={darker(body, 180)} strokeWidth={Math.max(0.6, r * 0.12)} />
    </>
  )
}

/** icons._paint_kmol: "KMol" above an ethanol ball-and-stick on the amber tile. */
export function KMolMark({ size = 64 }: { size?: number }) {
  const uid = useId().replace(/:/g, '')
  const s = size
  const m = s * 0.06
  const radius = s * 0.22
  const x = m, y = m, w = s - 2 * m, h = s - 2 * m
  const bx = x + w * 0.04, by = y + h * 0.42, bw = w * 0.92, bh = h * 0.54
  const P = (ux: number, uy: number) => [bx + ux * bw, by + uy * bh] as const
  const c1 = P(0.26, 0.54), c2 = P(0.5, 0.34), o = P(0.74, 0.54), ho = P(0.92, 0.4), h1 = P(0.09, 0.42)
  const hr = Math.min(bw, bh) * 0.24, rh = Math.min(bw, bh) * 0.14
  return (
    <svg width={size} height={size} viewBox={`0 0 ${s} ${s}`} aria-label="kMol">
      <rect x={x} y={y} width={w} height={h} rx={radius} fill="#ffe27a" stroke="#e6bd44" strokeWidth={Math.max(1, s * 0.02)} />
      <text x={x + w / 2} y={y + h * 0.05 + h * 0.19} textAnchor="middle" dominantBaseline="central" fontFamily='"Segoe UI", system-ui, sans-serif' fontWeight="bold" fontSize={h * 0.3} fill="#2b2b2b">
        KMol
      </text>
      {[[c1, c2], [c2, o], [o, ho], [c1, h1]].map(([a, b], k) => (
        <line key={k} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#63676e" strokeWidth={Math.max(1.4, Math.min(bw, bh) * 0.11)} strokeLinecap="round" />
      ))}
      <Sphere cx={h1[0]} cy={h1[1]} r={rh} body="#f4f4f4" id={`${uid}a`} />
      <Sphere cx={ho[0]} cy={ho[1]} r={rh} body="#f4f4f4" id={`${uid}b`} />
      <Sphere cx={c1[0]} cy={c1[1]} r={hr} body="#3a3a3a" id={`${uid}c`} />
      <Sphere cx={c2[0]} cy={c2[1]} r={hr} body="#3a3a3a" id={`${uid}d`} />
      <Sphere cx={o[0]} cy={o[1]} r={hr * 0.96} body="#e01f1f" id={`${uid}e`} />
    </svg>
  )
}
