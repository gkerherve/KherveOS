// Kherve Grand Prix — the drivers. A modern driver wears a full-face helmet
// (the team's design, number and name painted on it, an air scoop on top, a
// little spoiler at the back, a smoked iridescent visor with its pivots and
// tear-off tab, chin vents) over a white fireproof balaclava: the eyes look
// out through the visor. A HANS collar sits on the shoulders of the race suit.
// A 1970s driver wears an open-face helmet with a peak and a chin strap: the
// whole face shows (eyes, brows, nose, mouth, sideburns, now and then a
// moustache or aviator sunglasses), above a suit with harness straps, arms
// reaching for the wheel, and leather gloves. Every driver looks a little
// different (skin, eyes, hair), picked from the car's number.
//
// The group's origin is the centre of the head; +x looks forward.

import * as THREE from 'three'
import type { Team } from './f1Race.ts'

export interface DriverModel {
  group: THREE.Group
  dispose(): void
}

export interface DriverOpts {
  team: Team
  num: number
  classic: boolean
  /** Classic: where the hands hold the steering wheel (relative to the head), its radius and its tilt. */
  wheel?: { x: number; y: number; r: number; tilt: number }
  black: THREE.Material
  carbon: THREE.Material
}

const SKIN = ['#f3cfb3', '#e8b896', '#d29c74', '#b07a52', '#8a5a3a', '#5e3b26', '#432a1c']
const IRIS = ['#5a3a1e', '#3a2614', '#4c6f8f', '#5e7d4a', '#7a5a2e', '#2f4a6b']
const HAIR = ['#1c140f', '#3a2616', '#6b4a2a', '#a9783f', '#2a2a2a', '#8c8c8c']

/** A small deterministic random from the car's number. */
function picker(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 10000) / 10000
  }
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/**
 * Part of a sphere (radius r, phi round the vertical axis with phi = π looking forward along +x,
 * theta down from the top), with UVs of the whole sphere, so every part of a helmet shares one painted design.
 */
function sphere(r: number, phi0: number, phi1: number, th0: number, th1: number, ws = 24, hs = 12): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, ws, hs, phi0, phi1 - phi0, th0, th1 - th0)
  const p = g.attributes.position
  const uv = g.attributes.uv
  const span = phi1 - phi0
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    let phi = Math.atan2(z, -x)
    if (phi < 0) phi += Math.PI * 2
    // keep the part's own range (no jump at the seam behind)
    if (phi < phi0 - 0.01) phi += Math.PI * 2
    if (phi > phi0 + span + 0.01) phi -= Math.PI * 2
    uv.setXY(i, phi / (Math.PI * 2), 1 - Math.acos(Math.max(-1, Math.min(1, y / r))) / Math.PI)
  }
  return g
}

/** A cylinder from a to b. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, seg = 10): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a)
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), seg, 1)
  g.translate(0, d.length() / 2, 0)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()))
  g.translate(a.x, a.y, a.z)
  return g
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // every part is non-indexed with position, normal and uv: join them by hand (no extra import)
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g))
  let n = 0
  for (const g of parts) n += g.attributes.position.count
  const pos = new Float32Array(n * 3)
  const nor = new Float32Array(n * 3)
  const uv = new Float32Array(n * 2)
  let o = 0
  for (const g of parts) {
    const c = g.attributes.position.count
    pos.set(g.attributes.position.array as Float32Array, o * 3)
    nor.set(g.attributes.normal.array as Float32Array, o * 3)
    if (g.attributes.uv) uv.set(g.attributes.uv.array as Float32Array, o * 2)
    o += c
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  for (const g of list) g.dispose()
  for (const g of parts) g.dispose()
  return out
}

// ---------------------------------------------------------------- the paint

/** The helmet's design, painted on the whole sphere (u: round from behind, 0.5 in front; v: up). */
function helmetTexture(team: Team, num: number, classic: boolean): THREE.CanvasTexture {
  const W = 1024
  const H = 512
  const [c, g] = canvas(W, H)
  const base = classic ? '#f4f2ec' : team.color2
  const main = classic ? team.color : team.color
  const edge = team.accent
  g.fillStyle = base
  g.fillRect(0, 0, W, H)
  // the crown stripe, from the brow over the top to the back of the neck
  const stripe = (cx: number, w: number, col: string) => {
    g.fillStyle = col
    g.fillRect(cx - w / 2, 0, w, H * 0.62)
  }
  for (const cx of [W / 2, 0, W]) {
    stripe(cx, classic ? 120 : 70, main)
    stripe(cx - (classic ? 72 : 46), 10, edge)
    stripe(cx + (classic ? 72 : 46), 10, edge)
  }
  if (!classic) {
    // a swoosh along each side, with an accent edge
    for (const s of [0.25, 0.75]) {
      const cx = s * W
      g.fillStyle = main
      g.beginPath()
      g.moveTo(cx - 230, H * 0.6)
      g.bezierCurveTo(cx - 80, H * 0.46, cx + 80, H * 0.5, cx + 230, H * 0.4)
      g.lineTo(cx + 230, H * 0.56)
      g.bezierCurveTo(cx + 80, H * 0.64, cx - 80, H * 0.62, cx - 230, H * 0.72)
      g.closePath()
      g.fill()
      g.strokeStyle = edge
      g.lineWidth = 8
      g.stroke()
    }
    // the band round the visor's edge
    g.fillStyle = '#111'
    g.fillRect(0, H * 0.555, W, 10)
  } else {
    // 70s pinstripes round the brow
    g.fillStyle = main
    g.fillRect(0, H * 0.5, W, 16)
    g.fillStyle = edge
    g.fillRect(0, H * 0.54, W, 5)
  }
  // the car's number on both sides, the team's short name behind
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const s of [0.25, 0.75]) {
    g.font = `900 italic ${classic ? 92 : 80}px system-ui, sans-serif`
    g.lineWidth = 10
    g.strokeStyle = classic ? '#111' : main
    g.strokeText(String(num), s * W, H * (classic ? 0.36 : 0.33))
    g.fillStyle = classic ? main : '#ffffff'
    g.fillText(String(num), s * W, H * (classic ? 0.36 : 0.33))
  }
  g.font = '900 italic 46px system-ui, sans-serif'
  g.fillStyle = classic ? '#111' : team.accent
  for (const x of [0, W]) g.fillText(team.short, x, H * 0.44)
  // a sponsor tag on the chin
  if (!classic) {
    g.font = '800 30px system-ui, sans-serif'
    g.fillStyle = '#ffffff'
    g.fillText('KHERVE', W / 2, H * 0.74)
  }
  return texture(c)
}

/**
 * The face, drawn on a patch of the head facing forward: phi ±0.95 round the front, theta 0.9 .. 2.5
 * (the eyes at about 36 % down, the mouth at 72 %). A modern driver's is a balaclava with an eye slot.
 */
function faceTexture(rand: () => number, classic: boolean, skin: string): THREE.CanvasTexture {
  const S = 256
  const [c, g] = canvas(S, S)
  const iris = IRIS[Math.floor(rand() * IRIS.length)]
  const hair = HAIR[Math.floor(rand() * HAIR.length)]
  const ey = S * 0.36
  const ex = S * 0.16
  g.fillStyle = classic ? skin : '#ecebe6'
  g.fillRect(0, 0, S, S)
  if (!classic) {
    // the balaclava's knit, and the slot for the eyes
    g.globalAlpha = 0.18
    g.fillStyle = '#b9b7b0'
    for (let y = 0; y < S; y += 4) g.fillRect(0, y, S, 1)
    g.globalAlpha = 1
    g.fillStyle = skin
    g.beginPath()
    g.roundRect(S * 0.14, ey - S * 0.1, S * 0.72, S * 0.19, S * 0.07)
    g.fill()
  } else {
    // soft shading: the cheeks, under the brow, the jaw
    const shade = g.createRadialGradient(S / 2, S * 0.5, S * 0.12, S / 2, S * 0.5, S * 0.62)
    shade.addColorStop(0, 'rgba(255,255,255,0.06)')
    shade.addColorStop(1, 'rgba(0,0,0,0.28)')
    g.fillStyle = shade
    g.fillRect(0, 0, S, S)
    g.fillStyle = 'rgba(200,80,70,0.12)'
    for (const sx of [-1, 1]) {
      g.beginPath()
      g.ellipse(S / 2 + sx * S * 0.2, S * 0.56, S * 0.08, S * 0.05, 0, 0, Math.PI * 2)
      g.fill()
    }
    // hair under the helmet's edge and the sideburns
    g.fillStyle = hair
    g.fillRect(0, 0, S, S * 0.07)
    for (const sx of [0, S - S * 0.07]) g.fillRect(sx, S * 0.08, S * 0.07, S * 0.42)
  }
  // the eyes: white, iris, pupil, a highlight, the lids
  for (const sx of [-1, 1]) {
    const cx = S / 2 + sx * ex
    g.fillStyle = '#f7f4ee'
    g.beginPath()
    g.ellipse(cx, ey, S * 0.07, S * 0.034, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = iris
    g.beginPath()
    g.arc(cx, ey, S * 0.03, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#0b0b0b'
    g.beginPath()
    g.arc(cx, ey, S * 0.014, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = 'rgba(255,255,255,0.9)'
    g.beginPath()
    g.arc(cx + S * 0.01, ey - S * 0.01, S * 0.007, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = 'rgba(40,20,10,0.75)'
    g.lineWidth = S * 0.008
    g.beginPath()
    g.ellipse(cx, ey, S * 0.072, S * 0.036, 0, Math.PI * 1.05, Math.PI * 1.95)
    g.stroke()
    // the brow
    g.strokeStyle = hair
    g.lineWidth = S * 0.018
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(cx - sx * S * 0.06, ey - S * 0.06)
    g.quadraticCurveTo(cx, ey - S * 0.09, cx + sx * S * 0.075, ey - S * 0.062)
    g.stroke()
  }
  if (classic) {
    // the nose: a soft shadow down one side, the nostrils
    const nose = g.createLinearGradient(S / 2 - S * 0.04, 0, S / 2 + S * 0.04, 0)
    nose.addColorStop(0, 'rgba(0,0,0,0.22)')
    nose.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = nose
    g.beginPath()
    g.moveTo(S / 2 - S * 0.02, ey + S * 0.02)
    g.lineTo(S / 2 - S * 0.05, S * 0.55)
    g.lineTo(S / 2 + S * 0.03, S * 0.56)
    g.closePath()
    g.fill()
    g.fillStyle = 'rgba(60,25,15,0.55)'
    for (const sx of [-1, 1]) {
      g.beginPath()
      g.ellipse(S / 2 + sx * S * 0.022, S * 0.565, S * 0.012, S * 0.007, 0, 0, Math.PI * 2)
      g.fill()
    }
    // the mouth
    g.fillStyle = '#a4554a'
    g.beginPath()
    g.ellipse(S / 2, S * 0.68, S * 0.07, S * 0.018, 0, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = 'rgba(60,15,10,0.7)'
    g.lineWidth = S * 0.006
    g.beginPath()
    g.moveTo(S / 2 - S * 0.07, S * 0.68)
    g.quadraticCurveTo(S / 2, S * 0.69, S / 2 + S * 0.07, S * 0.68)
    g.stroke()
    // a 1970s moustache now and then
    if (rand() < 0.45) {
      g.fillStyle = hair
      g.beginPath()
      g.moveTo(S / 2 - S * 0.09, S * 0.67)
      g.quadraticCurveTo(S / 2, S * 0.58, S / 2 + S * 0.09, S * 0.67)
      g.quadraticCurveTo(S / 2, S * 0.63, S / 2 - S * 0.09, S * 0.67)
      g.fill()
    }
    // the chin's shadow
    g.fillStyle = 'rgba(0,0,0,0.12)'
    g.beginPath()
    g.ellipse(S / 2, S * 0.8, S * 0.12, S * 0.03, 0, 0, Math.PI * 2)
    g.fill()
  }
  return texture(c)
}

/** The race suit: the team's colours, a stripe down each side, a couple of patches. */
function suitTexture(team: Team): THREE.CanvasTexture {
  const S = 256
  const [c, g] = canvas(S, S)
  g.fillStyle = team.color
  g.fillRect(0, 0, S, S)
  g.fillStyle = team.color2
  g.fillRect(0, 0, S * 0.18, S)
  g.fillRect(S * 0.82, 0, S * 0.18, S)
  g.fillStyle = team.accent
  g.fillRect(S * 0.18, 0, 6, S)
  g.fillRect(S * 0.82 - 6, 0, 6, S)
  g.fillStyle = '#ffffff'
  g.fillRect(S * 0.3, S * 0.25, S * 0.18, S * 0.08)
  g.fillStyle = team.color2
  g.fillRect(S * 0.55, S * 0.25, S * 0.14, S * 0.08)
  return texture(c)
}

// ---------------------------------------------------------------- the driver

export function buildDriver(o: DriverOpts): DriverModel {
  const rand = picker(o.num + (o.classic ? 101 : 0))
  const skin = SKIN[Math.floor(rand() * SKIN.length)]
  const owned: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(x: T) => {
    owned.push(x)
    return x
  }
  const group = new THREE.Group()
  const add = (g: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
    const mesh = new THREE.Mesh(own(g), m)
    mesh.castShadow = shadow
    group.add(mesh)
    return mesh
  }
  const helmetMat = own(new THREE.MeshPhysicalMaterial({ map: own(helmetTexture(o.team, o.num, o.classic)), roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06 }))
  // (a little of its own light: inside a helmet the face is mostly in shade)
  const faceTex = own(faceTexture(rand, o.classic, skin))
  const faceMat = own(new THREE.MeshStandardMaterial({ map: faceTex, emissiveMap: faceTex, emissive: 0xffffff, emissiveIntensity: o.classic ? 0.12 : 0.3, roughness: 0.62 }))
  const headMat = own(new THREE.MeshStandardMaterial({ color: o.classic ? skin : '#ecebe6', roughness: 0.75 }))
  const suitMat = own(new THREE.MeshStandardMaterial({ map: own(suitTexture(o.team)), roughness: 0.82 }))
  const r = o.classic ? 0.135 : 0.14
  const PI = Math.PI
  const F = PI // phi looking forward

  // the head (skin or balaclava) and the face patch on it
  const rh = r * 0.8
  add(new THREE.SphereGeometry(rh, 20, 14), headMat, false)
  // (its own UVs: the face picture covers just this patch)
  add(new THREE.SphereGeometry(rh * 1.004, 20, 14, F - 0.95, 1.9, 0.9, 1.6), faceMat, false)
  // the neck
  add(rod(new THREE.Vector3(-0.01, -rh * 0.6, 0), new THREE.Vector3(-0.02, -r * 1.55, 0), 0.052, 0.058), o.classic ? headMat : headMat, false)

  if (!o.classic) {
    // ---- a modern full-face helmet: shell round a window for the eyes, a chin bar below it
    const w = 0.66 // half the window's width (rad)
    const t0 = 1.22
    const t1 = 1.72
    const tb = 2.55
    const shell = merge([
      sphere(r, F + w, 2 * PI, 0, tb, 20, 14),
      sphere(r, 0, F - w, 0, tb, 20, 14),
      sphere(r, F - w, F + w, 0, t0, 8, 6),
      sphere(r, F - w, F + w, t1, tb, 8, 6),
    ])
    shell.scale(1.1, 1.04, 0.94)
    add(shell, helmetMat)
    // the visor: smoked, with a shimmer
    const visorMat = own(
      new THREE.MeshPhysicalMaterial({ color: 0x6c7a92, roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.24, clearcoat: 1, iridescence: 0.7, iridescenceIOR: 1.6, depthWrite: false }),
    )
    const visor = sphere(r * 1.018, F - w - 0.12, F + w + 0.12, t0 - 0.07, t1 + 0.05, 16, 6)
    visor.scale(1.1, 1.04, 0.94)
    const vm = add(visor, visorMat, false)
    vm.renderOrder = 2
    // the pivots each side, a tear-off tab
    for (const sd of [1, -1]) {
      const a = F + sd * (w + 0.2)
      const th = (t0 + t1) / 2
      const p = new THREE.Vector3(-Math.cos(a) * Math.sin(th) * r * 1.1 * 1.03, Math.cos(th) * r * 1.04, Math.sin(a) * Math.sin(th) * r * 0.94 * 1.03)
      add(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 12).rotateX(PI / 2).translate(p.x, p.y, p.z), o.black, false)
    }
    add(new THREE.BoxGeometry(0.012, 0.02, 0.012).translate(r * 0.5, Math.cos(t0) * r, r * 0.86), own(new THREE.MeshStandardMaterial({ color: o.team.accent, roughness: 0.5 })), false)
    // chin vents, the air scoop on top, the little spoiler behind
    for (const sd of [1, -1]) add(new THREE.BoxGeometry(0.01, 0.022, 0.04).translate(r * 1.08, -r * 0.5, sd * 0.03), o.black, false)
    add(new THREE.BoxGeometry(0.07, 0.022, 0.05).translate(r * 0.3, r * 1.02, 0), helmetMat)
    add(new THREE.BoxGeometry(0.012, 0.014, 0.04).translate(r * 0.66, r * 1.0, 0), o.black, false)
    add(new THREE.BoxGeometry(0.04, 0.012, 0.17).translate(-r * 1.03, r * 0.42, 0), o.carbon)
    // the neck roll at the helmet's lower edge
    const roll = new THREE.TorusGeometry(r * 0.62, 0.02, 6, 24)
    roll.rotateX(PI / 2)
    roll.translate(0, -r * 0.84, 0)
    add(roll, o.black, false)
    // the HANS collar on the shoulders, tethered to the helmet
    const hans = new THREE.TorusGeometry(0.1, 0.022, 6, 18, PI * 1.25)
    hans.rotateX(PI / 2)
    hans.rotateY(PI * 0.375 + PI)
    hans.translate(-0.02, -r * 1.45, 0)
    add(hans, o.carbon)
    for (const sd of [1, -1]) {
      add(new THREE.BoxGeometry(0.16, 0.025, 0.05).translate(0.06, -r * 1.55, sd * 0.08), o.carbon)
      add(rod(new THREE.Vector3(-0.07, -r * 1.4, sd * 0.06), new THREE.Vector3(-0.05, -r * 0.4, sd * r * 0.85), 0.006), o.black, false)
    }
    // the shoulders of the race suit
    const shoulders = new THREE.CapsuleGeometry(0.075, 0.3, 6, 12)
    shoulders.rotateX(PI / 2)
    shoulders.translate(-0.02, -r * 1.75, 0)
    add(shoulders, suitMat)
  } else {
    // ---- a 1970s open-face helmet: the shell round the back and sides, the face open in front
    const w = 0.88
    const tTop = 1.08
    const tb = 2.28
    const shell = merge([sphere(r, F + w, 2 * PI, 0, tb, 20, 12), sphere(r, 0, F - w, 0, tb, 20, 12), sphere(r, F - w, F + w, 0, tTop, 10, 6)])
    shell.scale(1.06, 1.06, 0.98)
    add(shell, helmetMat)
    // the snap-on peak over the brow
    const peakMat = own(new THREE.MeshPhysicalMaterial({ color: o.team.color, roughness: 0.3, clearcoat: 1, side: THREE.DoubleSide }))
    const peak = new THREE.RingGeometry(r * 0.9, r * 1.22, 18, 1, -0.62, 1.24)
    peak.rotateX(-PI / 2)
    peak.rotateZ(-0.12)
    peak.translate(0, r * 0.66, 0)
    add(peak, peakMat)
    // the snaps holding it, the chin strap under the jaw
    for (const sd of [1, -1]) {
      const at = new THREE.Vector3(0.5, 0.62, 0.6 * sd).normalize().multiplyScalar(r * 1.05)
      add(new THREE.SphereGeometry(0.009, 8, 6).translate(at.x, at.y, at.z), own(new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.9, roughness: 0.3 })), false)
    }
    const strap = new THREE.TorusGeometry(rh * 0.82, 0.008, 5, 20, PI)
    strap.rotateY(PI / 2)
    strap.rotateX(PI)
    strap.translate(0.01, -rh * 0.15, 0)
    add(strap, o.black, false)
    // aviator sunglasses on some
    if (rand() < 0.35) {
      const glassMat = own(new THREE.MeshPhysicalMaterial({ color: 0x1b1408, roughness: 0.05, metalness: 0.6, clearcoat: 1 }))
      const ty = 1.43
      for (const sd of [1, -1]) {
        const lens = sphere(rh * 1.03, F + sd * 0.29 - 0.17, F + sd * 0.29 + 0.17, ty - 0.12, ty + 0.12, 8, 5)
        add(lens, glassMat, false)
      }
      add(rod(new THREE.Vector3(rh * 1.0, Math.cos(1.38) * rh, 0.04), new THREE.Vector3(rh * 1.0, Math.cos(1.38) * rh, -0.04), 0.003, 0.003, 5), own(new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 1, roughness: 0.3 })), false)
    }
    // the body in its suit, the harness over the shoulders
    const torso = new THREE.CapsuleGeometry(0.15, 0.24, 6, 12)
    torso.scale(0.75, 1, 1.3)
    torso.translate(-0.05, -0.42, 0)
    add(torso, suitMat)
    const harness = own(new THREE.MeshStandardMaterial({ color: 0x1f2c55, roughness: 0.85 }))
    for (const sd of [1, -1]) {
      add(rod(new THREE.Vector3(-0.12, -0.24, sd * 0.1), new THREE.Vector3(0.08, -0.62, sd * 0.07), 0.02, 0.02, 4), harness, false)
    }
    // arms reaching for the wheel, in gloves
    const wl = o.wheel ?? { x: 0.44, y: -0.15, r: 0.17, tilt: 0.45 }
    const glove = own(new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.7 }))
    for (const sd of [1, -1]) {
      // ten-to-two on the rim
      const a = (sd * PI) / 3
      const grip = new THREE.Vector3(0, Math.cos(a) * wl.r, Math.sin(a) * wl.r).applyAxisAngle(new THREE.Vector3(0, 0, 1), -wl.tilt).add(new THREE.Vector3(wl.x, wl.y, 0))
      const shoulder = new THREE.Vector3(-0.06, -0.27, sd * 0.19)
      const elbow = new THREE.Vector3((shoulder.x + grip.x) / 2 - 0.02, (shoulder.y + grip.y) / 2 - 0.1, sd * 0.23)
      add(rod(shoulder, elbow, 0.055, 0.048), suitMat)
      add(rod(elbow, grip.clone().add(new THREE.Vector3(-0.04, 0, 0)), 0.046, 0.038), suitMat)
      add(new THREE.SphereGeometry(0.04, 10, 8).scale(1.2, 0.9, 0.9).translate(grip.x - 0.01, grip.y, grip.z), glove)
    }
  }

  return {
    group,
    dispose() {
      for (const x of owned) x.dispose()
    },
  }
}
