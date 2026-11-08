// Last Train: the city's furniture and its special places. Small things the
// streets are full of (benches, traffic lights, name plates, containers,
// sandbags, cones, barriers, railings); and what stands on a block that is
// not just buildings: a park, a square with a fountain, a church you can walk
// into, a petrol station, a car park, a building site with its crane, a
// supermarket you can walk into, a hospital; the town hall at the end of
// Kherve Street and the military checkpoint that shuts Station Road's west
// end. Everything is laid out in station coordinates (y up from the street).

import * as THREE from 'three'
import { add, BOX, building, bin, bollard, CYL, footprint, local, once, PLANE, proxy, rubbish, tree, uvBox, metres, vehicle, type Ctx, type Hole, facadeGeo, windowAt } from './lastTrainCityKit'
import { canvas, grime, rng, texture, words } from './lastTrainWorld'
import { makeCar, merge, paint, type CarKind } from './lastTrainVehicles'
import type { Box2 } from './lastTrainPlan'

/** One face of a block, for a row of ordinary buildings along it. */
export type Face = 'S' | 'N' | 'W' | 'E'
export type RowFn = (face: Face, from: number, to: number) => void

// ---------------------------------------------------------------- textures

/** Winter grass worn to mud along the edges, leaves, a few weeds: 4 m square. */
function grassTex(): THREE.CanvasTexture {
  return once('grass', () => {
    const S = 512
    const [c, g] = canvas(S, S)
    const r = rng(81)
    g.fillStyle = '#3a4426'
    g.fillRect(0, 0, S, S)
    for (let i = 0; i < 26000; i++) {
      const k = r()
      g.strokeStyle = k < 0.5 ? `rgba(${70 + r() * 40},${80 + r() * 40},${40 + r() * 20},0.6)` : k < 0.8 ? 'rgba(30,36,20,0.6)' : `rgba(${110 + r() * 40},${100 + r() * 30},${60},0.5)`
      const x = r() * S
      const y = r() * S
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 5)
      g.stroke()
    }
    for (let i = 0; i < 14; i++) {
      const x = r() * S
      const y = r() * S
      const rad = 20 + r() * 50
      const grad = g.createRadialGradient(x, y, 0, x, y, rad)
      grad.addColorStop(0, 'rgba(60,46,30,0.6)')
      grad.addColorStop(1, 'rgba(60,46,30,0)')
      g.fillStyle = grad
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
    for (let i = 0; i < 300; i++) {
      g.fillStyle = ['#7a4a1e', '#9a6a2a', '#5a3a1a'][Math.floor(r() * 3)]
      g.beginPath()
      g.ellipse(r() * S, r() * S, 2 + r() * 3, 1 + r() * 2, r() * 3, 0, Math.PI * 2)
      g.fill()
    }
    return metres(texture(c), 4)
  })
}

/** Gravel paths: buff and grey stones, a puddle or two. 2 m square. */
function gravelTex(): THREE.CanvasTexture {
  return once('gravelpath', () => {
    const S = 256
    const [c, g] = canvas(S, S)
    const r = rng(82)
    g.fillStyle = '#7a6e58'
    g.fillRect(0, 0, S, S)
    for (let i = 0; i < 9000; i++) {
      const k = (110 + r() * 90) | 0
      g.fillStyle = `rgba(${k},${k - 10},${k - 30},${0.4 + r() * 0.5})`
      g.fillRect(r() * S, r() * S, 1 + r() * 2.5, 1 + r() * 2)
    }
    grime(g, S, S, r, 0.4)
    return metres(texture(c), 2)
  })
}

/** Large pale stone slabs of a square, 3.6 m square. */
function plazaTex(): THREE.CanvasTexture {
  return once('plaza', () => {
    const S = 512
    const [c, g] = canvas(S, S)
    const r = rng(83)
    g.fillStyle = '#3e3c38'
    g.fillRect(0, 0, S, S)
    const n = 4
    const s = S / n
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const k = (120 + r() * 30) | 0
        g.fillStyle = `rgb(${k + 6},${k + 3},${k - 4})`
        g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4)
        for (let p = 0; p < 600; p++) {
          g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${r() * 0.15})` : `rgba(255,255,255,${r() * 0.07})`
          g.fillRect(i * s + r() * s, j * s + r() * s, 1.5, 1.5)
        }
      }
    grime(g, S, S, r, 0.6)
    return metres(texture(c), 3.6)
  })
}

/** Grey slates in courses (a church roof). 2 m square. */
function slateTex(): THREE.CanvasTexture {
  return once('slate', () => {
    const S = 256
    const [c, g] = canvas(S, S)
    const r = rng(84)
    g.fillStyle = '#1e2024'
    g.fillRect(0, 0, S, S)
    for (let y = 0; y < S; y += 16)
      for (let x = -16; x < S; x += 22) {
        const k = (40 + r() * 26) | 0
        g.fillStyle = `rgb(${k},${k + 3},${k + 8})`
        g.fillRect(x + (y / 16) % 2 * 11 + 1, y + 1, 20, 14)
      }
    grime(g, S, S, r, 0.6)
    return metres(texture(c), 2)
  })
}

/** Corrugated steel: vertical ribs, rust bleeding from the top. 2.4 m square; the material's colour tints it. */
function corrugatedTex(): THREE.CanvasTexture {
  return once('corrugated', () => {
    const S = 256
    const [c, g] = canvas(S, S)
    const r = rng(85)
    for (let x = 0; x < S; x += 12) {
      const grad = g.createLinearGradient(x, 0, x + 12, 0)
      grad.addColorStop(0, '#9a9a9a')
      grad.addColorStop(0.5, '#ffffff')
      grad.addColorStop(1, '#7a7a7a')
      g.fillStyle = grad
      g.fillRect(x, 0, 12, S)
    }
    for (let i = 0; i < 30; i++) {
      const x = r() * S
      const grad = g.createLinearGradient(0, 0, 0, 40 + r() * 140)
      grad.addColorStop(0, 'rgba(120,60,20,0.6)')
      grad.addColorStop(1, 'rgba(120,60,20,0)')
      g.fillStyle = grad
      g.fillRect(x, 0, 3 + r() * 10, 200)
    }
    grime(g, S, S, r, 0.8)
    return metres(texture(c), 2.4)
  })
}

/** A building site's hoarding: green panels, the white lettering of what was going to be built. 9.6 m wide. */
function hoardingTex(): THREE.CanvasTexture {
  return once('hoarding', () => {
    const [c, g] = canvas(1024, 256)
    const r = rng(86)
    g.fillStyle = '#1d4a33'
    g.fillRect(0, 0, 1024, 256)
    g.fillStyle = '#2fbf71'
    g.fillRect(0, 196, 1024, 12)
    g.fillStyle = '#f2f2ea'
    g.font = 'bold 62px Helvetica, Arial, sans-serif'
    g.fillText('KHERVE LABS', 40, 95)
    g.font = '34px Helvetica, Arial, sans-serif'
    g.fillText('A new research centre — open science for everyone', 40, 150)
    for (let x = 0; x < 1024; x += 128) {
      g.fillStyle = 'rgba(0,0,0,0.35)'
      g.fillRect(x, 0, 3, 256)
    }
    grime(g, 1024, 256, r, 1.2)
    // tags sprayed over it
    for (let i = 0; i < 3; i++) {
      g.strokeStyle = ['#d9232d', '#f5f5f5', '#f0c419'][i]
      g.lineWidth = 6
      g.beginPath()
      let x = 100 + r() * 800
      let y = 120 + r() * 80
      g.moveTo(x, y)
      for (let k = 0; k < 6; k++) {
        x += (r() - 0.3) * 50
        y += (r() - 0.5) * 50
        g.lineTo(x, y)
      }
      g.stroke()
    }
    return texture(c)
  })
}

/** Shelves of goods seen from the aisle: bright packets, tins, bottles; gaps where it was looted. */
function goodsTex(): THREE.CanvasTexture {
  return once('goods', () => {
    const [c, g] = canvas(512, 256)
    const r = rng(87)
    g.fillStyle = '#d8d8d2'
    g.fillRect(0, 0, 512, 256)
    const cols = ['#c0392b', '#2e86c1', '#f1c40f', '#27ae60', '#8e44ad', '#e67e22', '#ecf0f1', '#1abc9c', '#d35400', '#34495e']
    for (let row = 0; row < 4; row++) {
      const y = 8 + row * 62
      g.fillStyle = '#8a8f8c'
      g.fillRect(0, y + 52, 512, 6)
      for (let x = 2; x < 508; ) {
        const w = 8 + r() * 18
        if (r() < 0.22) {
          x += w * 2
          continue
        }
        const h = 18 + r() * 30
        g.fillStyle = cols[Math.floor(r() * cols.length)]
        g.fillRect(x, y + 52 - h, w - 2, h)
        g.fillStyle = 'rgba(255,255,255,0.3)'
        g.fillRect(x + 2, y + 54 - h, 2, h - 6)
        x += w
      }
    }
    return texture(c)
  })
}

/** Stained glass in a lancet: saints' colours in lead cames, candlelit from inside. */
function stainedTex(): THREE.CanvasTexture {
  return once('stained', () => {
    const [c, g] = canvas(128, 192)
    const r = rng(88)
    const cols = ['#b0242a', '#1f4fa8', '#d9a520', '#2a7a3a', '#7a2a8a', '#e8d8a0']
    for (let y = 0; y < 192; y += 16)
      for (let x = 0; x < 128; x += 16) {
        g.fillStyle = cols[Math.floor(r() * cols.length)]
        g.fillRect(x, y, 16, 16)
      }
    g.strokeStyle = '#111'
    g.lineWidth = 2
    for (let y = 0; y < 192; y += 16) {
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(128, y)
      g.stroke()
    }
    for (let x = 0; x < 128; x += 16) {
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, 192)
      g.stroke()
    }
    g.lineWidth = 5
    g.beginPath()
    g.arc(64, 70, 34, 0, Math.PI * 2)
    g.stroke()
    return texture(c)
  })
}

/** A clock face: Roman numerals, hands stopped at the hour it happened. */
function clockTex(): THREE.CanvasTexture {
  return once('clock', () => {
    const [c, g] = canvas(256, 256)
    g.fillStyle = '#f2ead2'
    g.beginPath()
    g.arc(128, 128, 124, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = '#222'
    g.lineWidth = 8
    g.stroke()
    g.fillStyle = '#1a1a1a'
    g.font = 'bold 26px Georgia, serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const R = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']
    R.forEach((t, i) => {
      const a = (i / 12) * Math.PI * 2
      g.fillText(t, 128 + Math.sin(a) * 96, 128 - Math.cos(a) * 96)
    })
    g.lineCap = 'round'
    g.lineWidth = 9
    g.beginPath()
    g.moveTo(128, 128)
    g.lineTo(128 + Math.sin(1.75) * 52, 128 - Math.cos(1.75) * 52)
    g.stroke()
    g.lineWidth = 6
    g.beginPath()
    g.moveTo(128, 128)
    g.lineTo(128 + Math.sin(4.1) * 84, 128 - Math.cos(4.1) * 84)
    g.stroke()
    return texture(c)
  })
}

/** A notice board under its little roof, covered in the notes people left: missing, gone to, meet at. */
function noticeTex(): THREE.CanvasTexture {
  return once('notices', () => {
    const [c, g] = canvas(512, 256)
    const r = rng(89)
    g.fillStyle = '#5a3a20'
    g.fillRect(0, 0, 512, 256)
    const notes = ['MISSING', 'HAVE YOU SEEN', 'GONE NORTH', 'MEET AT THE CHURCH', 'WATER AT THE PARK', 'MUM — WE ARE OK', 'DO NOT GO DOWN', 'TRAINS STILL RUN']
    for (let i = 0; i < 26; i++) {
      const x = r() * 470
      const y = r() * 220
      g.save()
      g.translate(x + 30, y + 22)
      g.rotate((r() - 0.5) * 0.3)
      g.fillStyle = ['#f4f0e0', '#f6e27a', '#f0f0f0', '#e8d0d0'][Math.floor(r() * 4)]
      g.fillRect(-30, -24, 64, 52)
      g.fillStyle = '#222'
      g.font = 'bold 9px Helvetica, Arial, sans-serif'
      g.fillText(notes[Math.floor(r() * notes.length)], -27, -12)
      for (let k = 0; k < 4; k++) g.fillRect(-26, -2 + k * 6, 30 + r() * 24, 1.5)
      g.fillStyle = '#c0392b'
      g.beginPath()
      g.arc(0, -22, 2.5, 0, Math.PI * 2)
      g.fill()
      g.restore()
    }
    return texture(c)
  })
}

/** Painted words on a board (cached by text): signs of the city. */
function signTex(text: string, bg: string, fg: string, w = 1024, h = 192, font = 'bold 92px Helvetica, Arial, sans-serif'): THREE.CanvasTexture {
  return once('sg' + text + bg + fg + w, () => words(text, w, h, bg, fg, font))
}

// ---------------------------------------------------------------- shared materials (one set per city)

interface SiteMats {
  grass: THREE.Material
  gravel: THREE.Material
  plaza: THREE.Material
  slate: THREE.Material
  water: THREE.Material
  hoarding: THREE.Material
  plywood: THREE.Material
  yellow: THREE.Material
  green: THREE.Material
  render: THREE.Material
  canvas: THREE.Material
  goods: THREE.Material
  fridge: THREE.Material
  tile: THREE.Material
  ceiling: THREE.Material
  strip: THREE.Material
  stained: THREE.Material
  clock: THREE.Material
  candle: THREE.Material
  wood: THREE.Material
  yew: THREE.Material
  tarmac: THREE.Material
  steel: THREE.Material
  orange: THREE.Material
  redWhite: THREE.Material
  wire: THREE.Material
  notices: THREE.Material
  container: THREE.Material[]
}

const SM = new WeakMap<Ctx, SiteMats>()

/** Ground layers drawn over the pavement: pulled towards the camera so they never flicker into it. */
function layer(m: THREE.Material, k: number): THREE.Material {
  m.polygonOffset = true
  m.polygonOffsetFactor = -k
  m.polygonOffsetUnits = -2 * k
  return m
}

export function siteMats(c: Ctx): SiteMats {
  let s = SM.get(c)
  if (s) return s
  const std = (o: THREE.MeshStandardMaterialParameters) => c.own(new THREE.MeshStandardMaterial(o))
  const corr = corrugatedTex()
  s = {
    grass: layer(std({ map: grassTex(), roughness: 1 }), 1),
    gravel: layer(std({ map: gravelTex(), roughness: 1 }), 2),
    plaza: layer(std({ map: plazaTex(), roughness: 0.85 }), 1),
    slate: std({ map: slateTex(), roughness: 0.7, side: THREE.DoubleSide }),
    water: std({ color: 0x0c1418, roughness: 0.05, metalness: 0.9 }),
    hoarding: std({ map: hoardingTex(), roughness: 0.8 }),
    plywood: std({ color: 0x9e8455, roughness: 0.9 }),
    yellow: std({ color: 0xe0a812, roughness: 0.5, metalness: 0.2 }),
    green: std({ color: 0x3a4a2a, roughness: 0.8 }),
    render: std({ color: 0xd8d6cc, roughness: 0.85 }),
    canvas: std({ color: 0xe6e2d4, roughness: 0.95, side: THREE.DoubleSide }),
    goods: std({ map: goodsTex(), roughness: 0.7 }),
    fridge: std({ color: 0x000000, emissive: 0xcfe8ff, emissiveIntensity: 0.7 }),
    tile: layer(std({ color: 0x8a877e, roughness: 0.45 }), 1),
    ceiling: std({ color: 0x9a9a92, roughness: 0.9, side: THREE.DoubleSide }),
    strip: std({ color: 0xffffff, emissive: 0xf0f6ff, emissiveIntensity: 2.4 }),
    stained: std({ map: stainedTex(), emissive: 0xffffff, emissiveMap: stainedTex(), emissiveIntensity: 0.9, side: THREE.DoubleSide }),
    clock: std({ map: clockTex(), emissive: 0xfff0c0, emissiveMap: clockTex(), emissiveIntensity: 0.55 }),
    candle: std({ color: 0x000000, emissive: 0xffb050, emissiveIntensity: 3 }),
    wood: std({ color: 0x4a3020, roughness: 0.8 }),
    yew: std({ color: 0x14241a, roughness: 1 }),
    tarmac: layer(std({ color: 0x232426, roughness: 0.95 }), 1),
    steel: std({ color: 0x8a9094, roughness: 0.4, metalness: 0.8 }),
    orange: std({ color: 0xe8560e, roughness: 0.6 }),
    redWhite: std({
      map: once('redwhite', () => {
        const [cv, g] = canvas(128, 16)
        for (let x = 0; x < 128; x += 16) {
          g.fillStyle = (x / 16) % 2 ? '#f2f2ea' : '#c8102e'
          g.fillRect(x, 0, 16, 16)
        }
        return texture(cv)
      }),
      roughness: 0.6,
    }),
    wire: std({ color: 0x9aa0a4, roughness: 0.3, metalness: 1 }),
    notices: std({ map: noticeTex(), roughness: 0.9 }),
    container: [0x8a2a1e, 0x1f4a7a, 0x2f5a3a, 0x8a6a1e, 0x5a5e62].map((col) => std({ map: corr, color: col, roughness: 0.7, metalness: 0.3 })),
  }
  SM.set(c, s)
  return s
}

// ---------------------------------------------------------------- helpers

/** A box at (x, y above the street, z), size sx × sy × sz, turned ry. */
export function bx(c: Ctx, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0): THREE.Mesh {
  return add(c, BOX, mat, local(x, c.y0 + y, z, sx, sy, sz, ry))
}

/** The same with its UVs in metres (for textured walls). */
export function ub(c: Ctx, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0): THREE.Mesh {
  return add(c, uvBox(sx, sy, sz), mat, local(x, c.y0 + y, z, 1, 1, 1, ry))
}

export function cy(c: Ctx, mat: THREE.Material, x: number, y: number, z: number, rad: number, h: number): THREE.Mesh {
  return add(c, CYL, mat, local(x, c.y0 + y, z, rad, h, rad))
}

/** Nobody walks through x0..x1 × z0..z1. */
export function solidArea(c: Ctx, x0: number, x1: number, z0: number, z1: number) {
  c.blocks.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) })
}

/** A flat patch of ground (grass, gravel, tarmac…) with its UVs in metres. */
export function flat(c: Ctx, mat: THREE.Material, x0: number, x1: number, z0: number, z1: number, dy = 0.004) {
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0)
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, x0 + uv.getX(i) * (x1 - x0), z0 + uv.getY(i) * (z1 - z0))
  const m = add(c, c.own(geo), mat, new THREE.Matrix4())
  m.rotation.x = -Math.PI / 2
  m.position.set((x0 + x1) / 2, c.y0 + dy, (z0 + z1) / 2)
  m.updateMatrix()
}

/** A disc of ground (a pond, a fountain's water). */
function disc(c: Ctx, mat: THREE.Material, x: number, z: number, rad: number, dy: number) {
  const m = add(c, once('disc', () => new THREE.CircleGeometry(1, 32)), mat, new THREE.Matrix4())
  m.rotation.x = -Math.PI / 2
  m.scale.set(rad, rad, 1)
  m.position.set(x, c.y0 + dy, z)
  m.updateMatrix()
}

/** A sign board on two posts, or flat on a wall (posts = false). */
export function board(c: Ctx, text: string, bg: string, fg: string, x: number, y: number, z: number, w: number, h: number, ry: number, glow = 0, posts = false) {
  const t = signTex(text, bg, fg)
  const key = 'board' + text + bg + glow
  let m = c.signs.get(key)
  if (!m) c.signs.set(key, (m = c.own(new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: glow ? 0xffffff : 0x000000, emissiveMap: glow ? t : null, emissiveIntensity: glow }))))
  add(c, PLANE, m, local(x, c.y0 + y, z, w, h, 1, ry))
  add(c, BOX, c.M.darkMetal, local(x - Math.sin(ry) * 0.03, c.y0 + y, z - Math.cos(ry) * 0.03, w + 0.06, h + 0.06, 0.04, ry))
  if (posts) {
    for (const s of [-1, 1]) {
      const px = x + Math.cos(ry) * s * (w / 2 - 0.15) - Math.sin(ry) * 0.06
      const pz = z - Math.sin(ry) * s * (w / 2 - 0.15) - Math.cos(ry) * 0.06
      cy(c, c.M.pole, px, y / 2, pz, 0.05, y + h / 2)
      solidArea(c, px - 0.1, px + 0.1, pz - 0.1, pz + 0.1)
    }
  }
}

// ---------------------------------------------------------------- street furniture

/** A park bench: cast-iron ends, wooden slats; facing ry (0: facing +z). */
export function bench(c: Ctx, x: number, z: number, ry: number) {
  const S = siteMats(c)
  const B = local(x, c.y0, z, 1, 1, 1, ry)
  for (let i = 0; i < 3; i++) add(c, BOX, S.wood, B.clone().multiply(local(0, 0.45, -0.12 + i * 0.13, 1.8, 0.04, 0.1)))
  for (let i = 0; i < 2; i++) add(c, BOX, S.wood, B.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.66 + i * 0.16, -0.27), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, 0, 0)), new THREE.Vector3(1.8, 0.1, 0.035))))
  for (const s of [-0.8, 0.8]) {
    add(c, BOX, c.M.black, B.clone().multiply(local(s, 0.22, 0, 0.06, 0.44, 0.5)))
    add(c, BOX, c.M.black, B.clone().multiply(local(s, 0.62, -0.26, 0.06, 0.45, 0.06)))
  }
  const v = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry)
  const hx = Math.abs(v.x) * 0.95 + 0.3
  const hz = Math.abs(v.z) * 0.95 + 0.3
  solidArea(c, x - hx, x + hx, z - hz, z + hz)
}

/** Traffic lights on a pole: three lamps in a black head, the amber one still blinking (blink: the shared material). */
export function trafficLight(c: Ctx, x: number, z: number, ry: number, amber: THREE.Material) {
  const B = local(x, c.y0, z, 1, 1, 1, ry)
  add(c, CYL, c.M.pole, B.clone().multiply(local(0, 1.8, 0, 0.07, 3.6, 0.07)))
  add(c, BOX, c.M.black, B.clone().multiply(local(0, 3.2, 0.12, 0.3, 0.95, 0.22)))
  add(c, BOX, c.M.black, B.clone().multiply(local(0, 3.2, 0.25, 0.42, 1.05, 0.03)))
  const lens = once('lens', () => new THREE.CylinderGeometry(0.1, 0.1, 0.04, 14).rotateX(Math.PI / 2))
  add(c, lens, c.M.lampOff, B.clone().multiply(local(0, 3.5, 0.24)))
  add(c, lens, amber, B.clone().multiply(local(0, 3.2, 0.24)))
  add(c, lens, c.M.lampOff, B.clone().multiply(local(0, 2.9, 0.24)))
  // the push button box for the crossing
  add(c, BOX, c.M.yellow, B.clone().multiply(local(0, 1.15, 0.08, 0.16, 0.26, 0.1)))
  solidArea(c, x - 0.15, x + 0.15, z - 0.15, z + 0.15)
}

/** A street name plate on a wall: black capitals on white, the district in red. */
export function namePlate(c: Ctx, name: string, x: number, y: number, z: number, ry: number) {
  const key = 'plate' + name
  let m = c.signs.get(key)
  if (!m) {
    const t = once(key, () => {
      const [cv, g] = canvas(512, 128)
      g.fillStyle = '#f4f2ea'
      g.fillRect(0, 0, 512, 128)
      g.strokeStyle = '#111'
      g.lineWidth = 6
      g.strokeRect(6, 6, 500, 116)
      g.fillStyle = '#111'
      g.font = 'bold 54px Helvetica, Arial, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(name.toUpperCase(), 256, 56)
      g.fillStyle = '#b3201a'
      g.font = 'bold 22px Helvetica, Arial, sans-serif'
      g.fillText('KHERVE CITY  ·  K1', 256, 102)
      return texture(cv)
    })
    c.signs.set(key, (m = c.own(new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }))))
  }
  add(c, PLANE, m, local(x, c.y0 + y, z, 1.6, 0.4, 1, ry))
}

/** A shipping container (6.1 × 2.6 × 2.44), standing, or stacked on another (level 1). */
export function container(c: Ctx, x: number, z: number, ry: number, level = 0, col = 0) {
  const S = siteMats(c)
  const mat = S.container[col % S.container.length]
  const B = local(x, c.y0 + level * 2.6, z, 1, 1, 1, ry)
  add(c, uvBox(6.06, 2.59, 2.44), mat, B.clone().multiply(local(0, 1.3, 0)))
  // corner castings and the door bars at one end
  for (const sx of [-3.0, 3.0]) for (const sz of [-1.19, 1.19]) for (const sy of [0.08, 2.52]) add(c, BOX, c.M.darkMetal, B.clone().multiply(local(sx, sy, sz, 0.18, 0.16, 0.18)))
  for (const sz of [-0.8, -0.3, 0.3, 0.8]) add(c, BOX, c.M.darkMetal, B.clone().multiply(local(3.04, 1.3, sz, 0.03, 2.4, 0.04)))
  const v = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry)
  const hx = Math.abs(v.x) * 3.03 + Math.abs(v.z) * 1.22
  const hz = Math.abs(v.z) * 3.03 + Math.abs(v.x) * 1.22
  if (level === 0) solidArea(c, x - hx, x + hx, z - hz, z + hz)
  proxy(c, B.clone().multiply(local(0, 1.3, 0, 6.06, 2.59, 2.44)))
}

/** A wall of sandbags from (x0, z0) to (x1, z1), `rows` high. */
export function sandbags(c: Ctx, x0: number, z0: number, x1: number, z1: number, rows = 3) {
  const bag = once('sandbag', () => new THREE.BoxGeometry(0.62, 0.22, 0.36))
  const len = Math.hypot(x1 - x0, z1 - z0)
  const ry = -Math.atan2(z1 - z0, x1 - x0)
  const n = Math.max(1, Math.round(len / 0.6))
  const r = rng(Math.round(x0 * 7 + z0 * 13))
  for (let row = 0; row < rows; row++)
    for (let k = 0; k < n - (row % 2); k++) {
      const t = (k + 0.5 + (row % 2) * 0.5) / n
      add(c, bag, c.M.sandbag, local(x0 + (x1 - x0) * t, c.y0 + 0.11 + row * 0.21, z0 + (z1 - z0) * t, 1, 1, 1, ry + (r() - 0.5) * 0.2))
    }
  const pad = 0.25
  solidArea(c, Math.min(x0, x1) - pad, Math.max(x0, x1) + pad, Math.min(z0, z1) - pad, Math.max(z0, z1) + pad)
}

export function cone(c: Ctx, x: number, z: number, down = false) {
  const S = siteMats(c)
  const g = once('cone', () => new THREE.ConeGeometry(0.17, 0.7, 12))
  if (down) add(c, g, S.orange, new THREE.Matrix4().compose(new THREE.Vector3(x, c.y0 + 0.17, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, x * 3, 0)), new THREE.Vector3(1, 1, 1)))
  else {
    add(c, g, S.orange, local(x, c.y0 + 0.36, z))
    add(c, BOX, c.M.black, local(x, c.y0 + 0.02, z, 0.4, 0.04, 0.4))
  }
}

/** A concrete crash barrier (a "Jersey" block), 3 m long. */
export function jersey(c: Ctx, x: number, z: number, ry: number) {
  const g = once('jersey', () => {
    const s = new THREE.Shape()
    s.moveTo(-0.3, 0)
    s.lineTo(0.3, 0)
    s.lineTo(0.18, 0.3)
    s.lineTo(0.1, 0.82)
    s.lineTo(-0.1, 0.82)
    s.lineTo(-0.18, 0.3)
    s.lineTo(-0.3, 0)
    const geo = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: false })
    geo.translate(0, 0, -1.5)
    geo.rotateY(Math.PI / 2)
    return geo
  })
  add(c, g, c.M.concrete, local(x, c.y0, z, 1, 1, 1, ry))
  const v = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry)
  solidArea(c, x - Math.abs(v.x) * 1.5 - Math.abs(v.z) * 0.3, x + Math.abs(v.x) * 1.5 + Math.abs(v.z) * 0.3, z - Math.abs(v.z) * 1.5 - Math.abs(v.x) * 0.3, z + Math.abs(v.z) * 1.5 + Math.abs(v.x) * 0.3)
  proxy(c, local(x, c.y0 + 0.4, z, 3, 0.82, 0.6, ry))
}

/** Coils of razor wire along a line. */
export function razorWire(c: Ctx, x0: number, z0: number, x1: number, z1: number) {
  const S = siteMats(c)
  const coil = once('coil', () => new THREE.TorusGeometry(0.45, 0.012, 4, 18))
  const len = Math.hypot(x1 - x0, z1 - z0)
  const n = Math.round(len / 0.35)
  const ry = Math.atan2(x1 - x0, z1 - z0)
  for (let k = 0; k < n; k++) {
    const t = k / n
    add(c, coil, S.wire, new THREE.Matrix4().compose(new THREE.Vector3(x0 + (x1 - x0) * t, c.y0 + 0.45, z0 + (z1 - z0) * t), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, (k % 2) * 0.3)), new THREE.Vector3(1, 1, 1)))
  }
  solidArea(c, Math.min(x0, x1) - 0.45, Math.max(x0, x1) + 0.45, Math.min(z0, z1) - 0.45, Math.max(z0, z1) + 0.45)
}

/** Iron railings on a low stone kerb from (x0, z0) to (x1, z1) (straight along x or z), with gaps (along the line) left open. */
export function railings(c: Ctx, x0: number, z0: number, x1: number, z1: number, gaps: [number, number][] = [], h = 1.4) {
  const len = Math.hypot(x1 - x0, z1 - z0)
  const ux = (x1 - x0) / len
  const uz = (z1 - z0) / len
  const ry = -Math.atan2(uz, ux)
  const spear = once('spear', () => new THREE.ConeGeometry(0.03, 0.12, 6))
  const segs: [number, number][] = []
  let from = 0
  for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (a > from) segs.push([from, a])
    from = Math.max(from, b)
  }
  if (from < len) segs.push([from, len])
  for (const [a, b] of segs) {
    const mid = (a + b) / 2
    const cx = x0 + ux * mid
    const cz = z0 + uz * mid
    add(c, uvBox(b - a, 0.4, 0.3), c.M.stone, local(cx, c.y0 + 0.2, cz, 1, 1, 1, ry))
    add(c, BOX, c.M.black, local(cx, c.y0 + 0.5, cz, b - a, 0.05, 0.05, ry))
    add(c, BOX, c.M.black, local(cx, c.y0 + h - 0.1, cz, b - a, 0.05, 0.05, ry))
    for (let t = a + 0.08; t < b; t += 0.14) {
      const px = x0 + ux * t
      const pz = z0 + uz * t
      add(c, BOX, c.M.black, local(px, c.y0 + 0.4 + (h - 0.4) / 2, pz, 0.022, h - 0.4, 0.022))
      add(c, spear, c.M.gold, local(px, c.y0 + h + 0.06, pz))
    }
    const pad = 0.2
    solidArea(c, Math.min(x0 + ux * a, x0 + ux * b) - pad, Math.max(x0 + ux * a, x0 + ux * b) + pad, Math.min(z0 + uz * a, z0 + uz * b) - pad, Math.max(z0 + uz * a, z0 + uz * b) + pad)
    proxy(c, local(cx, c.y0 + h / 2, cz, b - a, h, 0.3, ry))
  }
  // stone piers either side of each gap
  for (const [a, b] of gaps)
    for (const t of [a - 0.3, b + 0.3]) {
      const px = x0 + ux * t
      const pz = z0 + uz * t
      add(c, uvBox(0.6, 1.9, 0.6), c.M.stone, local(px, c.y0 + 0.95, pz, 1, 1, 1, ry))
      add(c, BOX, c.M.stone, local(px, c.y0 + 1.95, pz, 0.75, 0.12, 0.75, ry))
      add(c, once('ball', () => new THREE.SphereGeometry(0.2, 12, 8)), c.M.stone, local(px, c.y0 + 2.2, pz))
      solidArea(c, px - 0.4, px + 0.4, pz - 0.4, pz + 0.4)
    }
}

/** A conifer (a yew in a churchyard, a fir in the park): stacked cones. */
export function conifer(c: Ctx, x: number, z: number, h: number) {
  const S = siteMats(c)
  const g = once('fir', () => {
    const parts: THREE.BufferGeometry[] = []
    for (let k = 0; k < 4; k++) {
      const cn = new THREE.ConeGeometry(0.9 - k * 0.18, 1.3, 9)
      cn.translate(0, 0.9 + k * 0.75, 0)
      parts.push(cn)
    }
    const t = new THREE.CylinderGeometry(0.1, 0.12, 0.8, 6)
    t.translate(0, 0.4, 0)
    parts.push(t)
    return merge(parts)
  })
  add(c, g, S.yew, local(x, c.y0, z, h / 4, h / 4, h / 4, x * 1.7))
  solidArea(c, x - 0.3, x + 0.3, z - 0.3, z + 0.3)
}

/** A pointed-arch window w wide, h tall (a rectangle under a half circle), its sill at y = 0. */
function lancet(w: number, h: number): THREE.ShapeGeometry {
  return once('lancet' + w + 'x' + h, () => {
    const s = new THREE.Shape()
    const top = h - w / 2
    s.moveTo(-w / 2, 0)
    s.lineTo(w / 2, 0)
    s.lineTo(w / 2, top)
    s.absarc(0, top, w / 2, 0, Math.PI, false)
    s.lineTo(-w / 2, 0)
    return new THREE.ShapeGeometry(s, 10)
  })
}

/** A heap of rubble (bricks and broken concrete) where something came down. */
export function rubble(c: Ctx, x: number, z: number, size: number) {
  const r = rng(Math.round(x * 31 + z * 17))
  for (let k = 0; k < 14 * size; k++) {
    const a = r() * Math.PI * 2
    const d = r() * size
    const s = 0.2 + r() * 0.6
    add(c, BOX, r() < 0.5 ? c.M.brick[1] : c.M.concrete, new THREE.Matrix4().compose(new THREE.Vector3(x + Math.cos(a) * d, c.y0 + s * 0.3 * (1.2 - d / size), z + Math.sin(a) * d), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)), new THREE.Vector3(s, s * 0.6, s * 0.8)))
  }
  solidArea(c, x - size * 0.6, x + size * 0.6, z - size * 0.6, z + size * 0.6)
}

/** A parked car of the city (its body material shared by colour). */
export function carAt(c: Ctx, kind: CarKind, state: 'parked' | 'abandoned' | 'smashed' | 'burnt', x: number, z: number, heading: number, col?: number) {
  const palette = [0xa7abb0, 0x111316, 0xd6d7d8, 0x1b2a4a, 0x6e1010, 0x55595d, 0x22352a, 0x8f8470, 0x2f3e57, 0x7a7d80]
  const colour = kind === 'cab' ? 0x0c0c0d : kind === 'police' ? 0xe9eaea : kind === 'van' ? 0xdcdcda : (col ?? palette[Math.floor(c.r() * palette.length)])
  const key = 'paint' + colour
  let m = c.signs.get(key)
  if (!m) c.signs.set(key, (m = paint(c.own, colour, 0.3 + c.r() * 0.4)))
  vehicle(c, makeCar(kind, state, m, c.V, Math.floor(c.r() * 1e6)), x, z, heading)
}

// ---------------------------------------------------------------- the special places

/** A park: railings and gates, gravel paths, a bandstand, a pond, a playground, trees and benches. */
export function park(c: Ctx, b: Box2, name: string) {
  const S = siteMats(c)
  const { r } = c
  const cx = (b.x0 + b.x1) / 2
  const cz = (b.z0 + b.z1) / 2
  const i = 0.6
  flat(c, S.grass, b.x0 + i, b.x1 - i, b.z0 + i, b.z1 - i)
  // paths: a cross from the four gates, a ring round the bandstand
  flat(c, S.gravel, cx - 1.6, cx + 1.6, b.z0 + i, b.z1 - i, 0.008)
  flat(c, S.gravel, b.x0 + i, b.x1 - i, cz - 1.6, cz + 1.6, 0.008)
  const ring = once('ringpath', () => new THREE.RingGeometry(6.5, 8.5, 40))
  const rm = add(c, ring, S.gravel, new THREE.Matrix4())
  rm.rotation.x = -Math.PI / 2
  rm.position.set(cx, c.y0 + 0.009, cz)
  rm.updateMatrix()
  // railings with a gate in the middle of each side
  const gap = (len: number): [number, number][] => [[len / 2 - 1.8, len / 2 + 1.8]]
  railings(c, b.x0 + i, b.z0 + i, b.x1 - i, b.z0 + i, gap(b.x1 - b.x0 - 2 * i))
  railings(c, b.x0 + i, b.z1 - i, b.x1 - i, b.z1 - i, gap(b.x1 - b.x0 - 2 * i))
  railings(c, b.x0 + i, b.z0 + i, b.x0 + i, b.z1 - i, gap(b.z1 - b.z0 - 2 * i))
  railings(c, b.x1 - i, b.z0 + i, b.x1 - i, b.z1 - i, gap(b.z1 - b.z0 - 2 * i))
  board(c, name.toUpperCase(), '#1d3a2a', '#e8e2c8', cx + 4.2, 1.6, b.z0 - 0.2, 3.2, 0.7, Math.PI, 0, true)
  // the bandstand: eight iron columns, a lead roof, a railing round its stage
  const bs = 4.2
  add(c, once('bsbase', () => new THREE.CylinderGeometry(1, 1, 1, 8)), c.M.stone, local(cx, c.y0 + 0.4, cz, bs + 0.3, 0.8, bs + 0.3))
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8
    cy(c, c.M.paintWhite, cx + Math.cos(a) * bs, 2.4, cz + Math.sin(a) * bs, 0.09, 3.2)
    const nx = cx + Math.cos(a + Math.PI / 8) * bs * 0.95
    const nz = cz + Math.sin(a + Math.PI / 8) * bs * 0.95
    add(c, BOX, c.M.paintWhite, local(nx, c.y0 + 1.25, nz, 0.04, 0.5, bs * 0.75, -(a + Math.PI / 8)))
  }
  add(c, once('bsroof', () => new THREE.ConeGeometry(1, 1, 8, 1, true)), S.slate, local(cx, c.y0 + 4.9, cz, bs + 0.6, 1.8, bs + 0.6, Math.PI / 8))
  add(c, once('bsrim', () => new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)), c.M.paintWhite, local(cx, c.y0 + 4.05, cz, bs + 0.6, 0.3, bs + 0.6, Math.PI / 8))
  add(c, once('bsfin', () => new THREE.SphereGeometry(0.25, 10, 8)), c.M.gold, local(cx, c.y0 + 5.9, cz))
  solidArea(c, cx - bs - 0.2, cx + bs + 0.2, cz - bs - 0.2, cz + bs + 0.2)
  proxy(c, local(cx, c.y0 + 2.4, cz, bs * 2, 4.8, bs * 2))
  c.supplies.push([cx, c.y0 + 0.8, cz])
  // the pond in one quarter, the playground in another
  const qx = r() < 0.5 ? -1 : 1
  const qz = r() < 0.5 ? -1 : 1
  const px = cx + qx * 11
  const pz = cz + qz * 11
  add(c, once('pondrim', () => new THREE.TorusGeometry(1, 0.06, 6, 40)), c.M.stone, new THREE.Matrix4().compose(new THREE.Vector3(px, c.y0 + 0.08, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(6.5, 6.5, 2.5)))
  disc(c, S.water, px, pz, 6.4, 0.02)
  solidArea(c, px - 5.6, px + 5.6, pz - 5.6, pz + 5.6)
  const gx = cx - qx * 11
  const gz = cz + qz * 11
  playground(c, gx, gz)
  // trees inside the railings, a few firs, benches along the cross paths, low park lamps
  for (let t = b.x0 + 4; t < b.x1 - 3; t += 8) {
    if (Math.abs(t - cx) < 3) continue
    tree(c, t, b.z0 + 3.5, Math.round(t * 3))
    tree(c, t, b.z1 - 3.5, Math.round(t * 5))
  }
  for (let t = b.z0 + 12; t < b.z1 - 10; t += 8) {
    if (Math.abs(t - cz) < 3) continue
    tree(c, b.x0 + 3.5, t, Math.round(t * 7))
    tree(c, b.x1 - 3.5, t, Math.round(t * 11))
  }
  for (const [fx, fz] of [[cx + qx * 15, cz - qz * 15], [cx - qx * 4, cz - qz * 16]]) conifer(c, fx, fz, 6 + r() * 3)
  for (const s of [-1, 1]) {
    bench(c, cx + 2.6, cz + s * 13, -Math.PI / 2)
    bench(c, cx + s * 13, cz - 2.6, 0)
  }
  for (const [lx, lz] of [[cx - 2.4, cz - 9.5], [cx + 2.4, cz + 9.5], [cx - 9.5, cz + 2.4], [cx + 9.5, cz - 2.4]]) parkLamp(c, lx, lz, r() < 0.6)
  if (r() < 0.6) c.supplies.push([cx + 2.6, c.y0 + 0.5, cz + 13])
}

/** A short park lamp: a fluted post, a lantern on top. */
function parkLamp(c: Ctx, x: number, z: number, lit: boolean) {
  cy(c, c.M.black, x, 1.8, z, 0.06, 3.6)
  cy(c, c.M.black, x, 0.3, z, 0.12, 0.6)
  add(c, BOX, lit ? c.M.lampOn : c.M.lampOff, local(x, c.y0 + 3.8, z, 0.3, 0.42, 0.3))
  add(c, once('lcap', () => new THREE.ConeGeometry(0.28, 0.3, 4)), c.M.black, local(x, c.y0 + 4.15, z, 1, 1, 1, Math.PI / 4))
  solidArea(c, x - 0.15, x + 0.15, z - 0.15, z + 0.15)
  if (lit) c.lights.push({ p: new THREE.Vector3(x, c.y0 + 3.6, z), color: 0xffd8a0, power: 10, range: 16 })
}

/** Swings, a slide, a roundabout, behind a low fence. */
function playground(c: Ctx, x: number, z: number) {
  const S = siteMats(c)
  flat(c, S.tarmac, x - 6, x + 6, z - 5, z + 5, 0.006)
  // swings: an A-frame each end, a bar, two seats on chains (one hangs still, one is wound round the bar)
  for (const s of [-1, 1]) {
    for (const t of [-0.5, 0.5]) add(c, BOX, S.steel, new THREE.Matrix4().compose(new THREE.Vector3(x - 3 + s * 1.6, c.y0 + 1.2, z - 2.5 + t * 0.7), new THREE.Quaternion().setFromEuler(new THREE.Euler(t * 0.5, 0, 0)), new THREE.Vector3(0.07, 2.5, 0.07)))
  }
  add(c, BOX, S.steel, local(x - 3, c.y0 + 2.4, z - 2.5, 3.3, 0.08, 0.08))
  for (const s of [-0.6, 0.6]) {
    add(c, BOX, S.wire, local(x - 3 + s, c.y0 + 1.6, z - 2.5, 0.02, 1.6, 0.02))
    add(c, BOX, c.M.black, local(x - 3 + s, c.y0 + 0.75, z - 2.5, 0.45, 0.04, 0.2))
  }
  solidArea(c, x - 4.8, x - 1.2, z - 3.0, z - 2.0)
  // the slide: ladder, platform, chute
  add(c, BOX, S.steel, local(x + 2.5, c.y0 + 1.1, z - 2.2, 0.8, 0.06, 0.8))
  for (const sx of [-0.35, 0.35]) for (const sz of [-0.35, 0.35]) add(c, BOX, S.steel, local(x + 2.5 + sx, c.y0 + 0.55, z - 2.2 + sz, 0.05, 1.1, 0.05))
  add(c, BOX, S.orange, new THREE.Matrix4().compose(new THREE.Vector3(x + 2.5, c.y0 + 0.6, z - 0.6), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0, 0)), new THREE.Vector3(0.6, 0.05, 2.6)))
  solidArea(c, x + 2.0, x + 3.0, z - 2.7, z + 0.6)
  // the roundabout
  add(c, once('rbt', () => new THREE.CylinderGeometry(1.3, 1.3, 0.12, 20)), S.orange, local(x - 1, c.y0 + 0.3, z + 2.5))
  cy(c, S.steel, x - 1, 0.7, z + 2.5, 0.05, 0.8)
  solidArea(c, x - 2.3, x + 0.3, z + 1.2, z + 3.8)
}

/** A square: big stone slabs, a fountain with an armillary sphere, trees in planters, market stalls, a clock, a notice board. */
export function square(c: Ctx, b: Box2) {
  const S = siteMats(c)
  const { r } = c
  const cx = (b.x0 + b.x1) / 2
  const cz = (b.z0 + b.z1) / 2
  flat(c, S.plaza, b.x0, b.x1, b.z0, b.z1)
  // the fountain: a round basin, its water, a column with two bowls, and the sphere of rings on top
  add(c, once('basin', () => new THREE.CylinderGeometry(1, 1, 1, 40, 1, true)), c.M.stone, local(cx, c.y0 + 0.35, cz, 5, 0.7, 5))
  add(c, once('basinrim', () => new THREE.TorusGeometry(1, 0.05, 6, 48)), c.M.stone, new THREE.Matrix4().compose(new THREE.Vector3(cx, c.y0 + 0.7, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(5, 5, 3)))
  disc(c, S.water, cx, cz, 4.95, 0.45)
  cy(c, c.M.stone, cx, 1.6, cz, 0.45, 2.6)
  add(c, once('bowl', () => new THREE.CylinderGeometry(1, 0.4, 0.4, 24)), c.M.stone, local(cx, c.y0 + 2.2, cz, 1.8, 1, 1.8))
  cy(c, c.M.stone, cx, 3.2, cz, 0.25, 1.6)
  add(c, once('bowl', () => new THREE.CylinderGeometry(1, 0.4, 0.4, 24)), c.M.stone, local(cx, c.y0 + 3.9, cz, 0.9, 0.8, 0.9))
  const ringG = once('armring', () => new THREE.TorusGeometry(1, 0.035, 6, 40))
  for (const [ax, ay, az] of [[0, 0, 0], [Math.PI / 2, 0, 0], [Math.PI / 2, 0.41, 0], [0, Math.PI / 2, 0], [0.4, 0, Math.PI / 2]] as [number, number, number][])
    add(c, ringG, c.M.gold, new THREE.Matrix4().compose(new THREE.Vector3(cx, c.y0 + 5.0, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(ax, ay, az)), new THREE.Vector3(0.95, 0.95, 0.95)))
  add(c, once('armaxis', () => new THREE.CylinderGeometry(0.03, 0.03, 2.6, 6)), c.M.gold, new THREE.Matrix4().compose(new THREE.Vector3(cx, c.y0 + 5.0, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.41)), new THREE.Vector3(1, 1, 1)))
  solidArea(c, cx - 4.7, cx + 4.7, cz - 4.7, cz + 4.7)
  proxy(c, local(cx, c.y0 + 2, cz, 8, 4, 8))
  // benches round it, facing in
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8
    bench(c, cx + Math.cos(a) * 8.5, cz + Math.sin(a) * 8.5, -a - Math.PI / 2)
  }
  // trees in square planters at the corners, period lamp standards
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const tx = cx + sx * 15
      const tz = cz + sz * 15
      ub(c, c.M.granite, tx, 0.3, tz, 2.4, 0.6, 2.4)
      flat(c, S.grass, tx - 1.05, tx + 1.05, tz - 1.05, tz + 1.05, 0.62)
      tree(c, tx, tz, Math.round(tx + tz))
      solidArea(c, tx - 1.2, tx + 1.2, tz - 1.2, tz + 1.2)
      const lx = cx + sx * 9.5
      const lz = cz + sz * 15
      cy(c, c.M.black, lx, 2.4, lz, 0.08, 4.8)
      for (const d of [-1, 1]) add(c, BOX, r() < 0.6 ? c.M.lampOn : c.M.lampOff, local(lx + d * 0.45, c.y0 + 4.6, lz, 0.28, 0.4, 0.28))
      add(c, BOX, c.M.black, local(lx, c.y0 + 4.35, lz, 1.0, 0.05, 0.05))
      solidArea(c, lx - 0.15, lx + 0.15, lz - 0.15, lz + 0.15)
      if (sx === sz) c.lights.push({ p: new THREE.Vector3(lx, c.y0 + 4.4, lz), color: 0xffd8a0, power: 12, range: 20 })
    }
  // the market: a row of stalls along one side, striped canopies, crates, one blown over
  const side = r() < 0.5 ? -1 : 1
  const mz = cz + side * 19
  const stripes = ['#b3201a', '#1f4fa8', '#2a7a3a', '#d9a520']
  for (let k = 0; k < 5; k++) {
    const sx = b.x0 + 6 + k * 7.5
    if (k === 2 && r() < 0.7) {
      // toppled
      add(c, BOX, S.wood, new THREE.Matrix4().compose(new THREE.Vector3(sx, c.y0 + 0.4, mz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.3, 1.3)), new THREE.Vector3(2.6, 0.06, 1.4)))
      for (let q = 0; q < 6; q++) add(c, BOX, S.plywood, local(sx + (r() - 0.5) * 4, c.y0 + 0.15, mz + (r() - 0.5) * 3, 0.5, 0.3, 0.35, r() * 3))
      continue
    }
    for (const dx of [-1.4, 1.4]) for (const dz of [-0.8, 0.8]) add(c, BOX, S.steel, local(sx + dx, c.y0 + 1.15, mz + dz, 0.05, 2.3, 0.05))
    add(c, BOX, S.wood, local(sx, c.y0 + 0.85, mz, 3.0, 0.06, 1.8))
    const awn = once('stall' + k, () => {
      const [cv, g] = canvas(128, 32)
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#efe8d8' : stripes[k % stripes.length]
        g.fillRect(i * 16, 0, 16, 32)
      }
      return texture(cv)
    })
    let am = c.signs.get('stall' + k)
    if (!am) c.signs.set('stall' + k, (am = c.own(new THREE.MeshStandardMaterial({ map: awn, roughness: 0.9, side: THREE.DoubleSide }))))
    add(c, PLANE, am, new THREE.Matrix4().compose(new THREE.Vector3(sx, c.y0 + 2.35, mz), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + side * 0.2, 0, 0)), new THREE.Vector3(3.2, 2.0, 1)))
    for (let q = 0; q < 4; q++) add(c, BOX, S.plywood, local(sx - 1 + q * 0.65, c.y0 + 1.0, mz + (r() - 0.5) * 0.6, 0.5, 0.26, 0.36))
    solidArea(c, sx - 1.6, sx + 1.6, mz - 1.0, mz + 1.0)
  }
  c.supplies.push([b.x0 + 6 + 7.5 * 3, c.y0 + 0.9, mz])
  // the clock pillar and the notice board
  const kx = cx - side * 18
  const kz = cz - side * 18
  cy(c, c.M.black, kx, 2.2, kz, 0.16, 4.4)
  for (let k = 0; k < 4; k++) add(c, PLANE, S.clock, local(kx + Math.sin((k * Math.PI) / 2) * 0.36, c.y0 + 4.5, kz + Math.cos((k * Math.PI) / 2) * 0.36, 0.66, 0.66, 1, (k * Math.PI) / 2))
  add(c, BOX, c.M.black, local(kx, c.y0 + 4.5, kz, 0.7, 0.7, 0.7))
  solidArea(c, kx - 0.3, kx + 0.3, kz - 0.3, kz + 0.3)
  const nx = cx + side * 18
  const nz = cz - side * 18
  add(c, PLANE, S.notices, local(nx, c.y0 + 1.5, nz + 0.06, 2.6, 1.3, 1))
  add(c, BOX, S.wood, local(nx, c.y0 + 1.5, nz, 2.8, 1.5, 0.1))
  add(c, BOX, S.slate, local(nx, c.y0 + 2.35, nz, 3.0, 0.08, 0.6))
  for (const s of [-1, 1]) add(c, BOX, S.wood, local(nx + s * 1.35, c.y0 + 1.1, nz, 0.1, 2.2, 0.1))
  solidArea(c, nx - 1.5, nx + 1.5, nz - 0.2, nz + 0.2)
}

/** The church: a stone nave with lancet windows lit from inside, a west tower and spire, a churchyard; its door stands open. */
export function church(c: Ctx, b: Box2) {
  const S = siteMats(c)
  const { r, M } = c
  const cx = (b.x0 + b.x1) / 2
  const cz = (b.z0 + b.z1) / 2
  flat(c, S.grass, b.x0 + 0.5, b.x1 - 0.5, b.z0 + 0.5, b.z1 - 0.5)
  // the churchyard wall with the gate (lychgate) on the south side
  railings(c, b.x0 + 0.5, b.z0 + 0.5, b.x1 - 0.5, b.z0 + 0.5, [[(b.x1 - b.x0) / 2 - 7.5, (b.x1 - b.x0) / 2 - 3.5]], 1.2)
  railings(c, b.x0 + 0.5, b.z1 - 0.5, b.x1 - 0.5, b.z1 - 0.5, [], 1.2)
  railings(c, b.x0 + 0.5, b.z0 + 0.5, b.x0 + 0.5, b.z1 - 0.5, [[(b.z1 - b.z0) / 2 - 2, (b.z1 - b.z0) / 2 + 2]], 1.2)
  railings(c, b.x1 - 0.5, b.z0 + 0.5, b.x1 - 0.5, b.z1 - 0.5, [], 1.2)
  // the nave: x from n0 to n1 (the tower at its west end), z ± half
  const n0 = cx - 11
  const n1 = cx + 13
  const half = 6
  const eaves = 9
  const ridge = 15
  const t = 0.6
  const lz = cz - 2
  // the walls with their windows: south and north long walls, the east gable
  const winds: Hole[] = []
  for (let k = 0; k < 5; k++) winds.push({ x: 2.5 + k * 4.4, y: 3.0, w: 1.6, h: 5.0, arch: true })
  for (const s of [-1, 1]) {
    const B = s < 0 ? local(n0, c.y0, lz - half, 1, 1, 1, Math.PI).multiply(local(-(n1 - n0), 0, 0)) : local(n0, c.y0, lz + half)
    add(c, facadeGeo(n1 - n0, 0, eaves, s < 0 ? winds.map((h) => ({ ...h, x: n1 - n0 - h.x - h.w })) : winds, t), M.stone, B)
    for (const h of winds) {
      const hx = s < 0 ? n1 - n0 - h.x - h.w : h.x
      add(c, lancet(h.w, h.h), S.stained, B.clone().multiply(local(hx + h.w / 2, h.y, -t / 2)))
      // buttresses between the windows
      add(c, uvBox(0.6, eaves - 1, 1.0), M.stone, B.clone().multiply(local(hx - 0.6, (eaves - 1) / 2, 0.5)))
    }
    add(c, BOX, M.stone, B.clone().multiply(local((n1 - n0) / 2, eaves, 0.1, n1 - n0 + 0.4, 0.3, 0.5)))
  }
  // the gables: a pointed end wall each end (the west one hidden by the tower), the east window
  const gable = (door: boolean) =>
    once('gable' + half + door, () => {
      const s = new THREE.Shape()
      s.moveTo(-half, 0)
      if (door) {
        s.lineTo(-1.5, 0)
        s.lineTo(-1.5, 3.4)
        s.lineTo(1.5, 3.4)
        s.lineTo(1.5, 0)
      }
      s.lineTo(half, 0)
      s.lineTo(half, eaves)
      s.lineTo(0, ridge)
      s.lineTo(-half, eaves)
      s.lineTo(-half, 0)
      if (!door) {
        const hole = new THREE.Path()
        hole.moveTo(-1.4, 4)
        hole.lineTo(1.4, 4)
        hole.lineTo(1.4, 6.8)
        hole.absarc(0, 6.8, 1.4, 0, Math.PI, false)
        hole.lineTo(-1.4, 4)
        s.holes.push(hole)
      }
      const geo = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false })
      geo.translate(0, 0, -t / 2)
      return geo
    })
  add(c, gable(true), M.stone, local(n0, c.y0, lz, 1, 1, 1, Math.PI / 2))
  add(c, gable(false), M.stone, local(n1, c.y0, lz, 1, 1, 1, Math.PI / 2))
  add(c, lancet(2.8, 4.2), S.stained, local(n1, c.y0 + 4, lz, 1, 1, 1, Math.PI / 2))
  // the roof: two slate slopes (seen from inside too), a ridge
  const slope = Math.hypot(half + 0.4, ridge - eaves)
  const pitch = Math.atan2(half + 0.4, ridge - eaves)
  for (const s of [-1, 1]) {
    const m = add(c, PLANE, S.slate, new THREE.Matrix4())
    m.position.set((n0 + n1) / 2, c.y0 + (eaves + ridge) / 2, lz + (s * (half + 0.4)) / 2)
    m.rotation.x = -s * pitch
    m.scale.set(n1 - n0 + 0.8, slope, 1)
    m.updateMatrix()
  }
  add(c, BOX, c.M.lead, local((n0 + n1) / 2, c.y0 + ridge, lz, n1 - n0 + 0.8, 0.18, 0.3))
  // inside: a stone floor, the pews either side of the aisle, the altar with its candles, a hanging lamp
  flat(c, S.plaza, n0 + 0.3, n1 - 0.3, lz - half + 0.3, lz + half - 0.3, 0.02)
  for (let k = 0; k < 7; k++) {
    const px = n0 + 4 + k * 2.2
    for (const s of [-1, 1]) {
      const pz = lz + s * 2.9
      add(c, BOX, S.wood, local(px, c.y0 + 0.45, pz, 0.45, 0.06, 3.6))
      add(c, BOX, S.wood, local(px - 0.22, c.y0 + 0.75, pz, 0.06, 0.6, 3.6))
      for (const e of [-1.8, 1.8]) add(c, BOX, S.wood, local(px, c.y0 + 0.45, pz + e, 0.5, 0.9, 0.06))
      solidArea(c, px - 0.3, px + 0.3, pz - 1.85, pz + 1.85)
    }
  }
  ub(c, c.M.stone, n1 - 2.2, 0.5, lz, 1.2, 1.0, 3.0)
  add(c, BOX, c.M.paintWhite, local(n1 - 2.2, c.y0 + 1.02, lz, 1.25, 0.03, 3.1))
  solidArea(c, n1 - 2.9, n1 - 1.5, lz - 1.6, lz + 1.6)
  for (let k = 0; k < 6; k++) {
    const kz = lz - 1.2 + k * 0.48
    cy(c, c.M.paintWhite, n1 - 2.2, 1.2 + (k % 2) * 0.08, kz, 0.03, 0.3 + (k % 2) * 0.16)
    add(c, BOX, S.candle, local(n1 - 2.2, c.y0 + 1.42 + (k % 2) * 0.16, kz, 0.03, 0.06, 0.03))
  }
  c.lights.push({ p: new THREE.Vector3(n1 - 3.2, c.y0 + 2.2, lz), color: 0xffa040, power: 7, range: 16 })
  c.lights.push({ p: new THREE.Vector3((n0 + n1) / 2, c.y0 + 6, lz), color: 0xffb060, power: 4, range: 18 })
  c.supplies.push([n1 - 4, c.y0, lz])
  c.supplies.push([n0 + 4, c.y0, lz + 5])
  // the long walls and the east end are solid; the west end opens through the tower's door
  solidArea(c, n0, n1, lz - half - 1.0, lz - half + t)
  solidArea(c, n0, n1, lz + half - t, lz + half + 1.0)
  solidArea(c, n1 - t / 2, n1 + t / 2, lz - half, lz + half)
  solidArea(c, n0 - t / 2, n0 + t / 2, lz - half, lz - 3.2)
  solidArea(c, n0 - t / 2, n0 + t / 2, lz + 3.2, lz + half)
  proxy(c, local((n0 + n1) / 2, c.y0 + eaves / 2, lz - half, n1 - n0, eaves, t))
  proxy(c, local((n0 + n1) / 2, c.y0 + eaves / 2, lz + half, n1 - n0, eaves, t))
  proxy(c, local(n1, c.y0 + eaves / 2, lz, t, eaves, half * 2))
  // the tower: four walls round its stair, a door to the west and an arch into the nave, the belfry, the spire
  const tw = 6.4
  const tx = n0 - tw / 2 + 0.3
  const th = 21
  const towerHoles = (doorW: number): Hole[] => [{ x: tw / 2 - doorW / 2, y: 0.02, w: doorW, h: 3.4, arch: true }, { x: tw / 2 - 0.9, y: th - 6, w: 1.8, h: 2.7, arch: true }]
  const walls: [THREE.Matrix4, Hole[]][] = [
    [local(tx - tw / 2, c.y0, lz - tw / 2, 1, 1, 1, -Math.PI / 2), towerHoles(2.2)], // west, the door
    [local(tx + tw / 2, c.y0, lz + tw / 2, 1, 1, 1, Math.PI / 2), towerHoles(3.0)], // east, into the nave
    [local(tx - tw / 2, c.y0, lz + tw / 2), [{ x: tw / 2 - 0.9, y: th - 6, w: 1.8, h: 2.7, arch: true }]], // north
    [local(tx + tw / 2, c.y0, lz - tw / 2, 1, 1, 1, Math.PI), [{ x: tw / 2 - 0.9, y: th - 6, w: 1.8, h: 2.7, arch: true }]], // south
  ]
  for (const [B, holes] of walls) {
    add(c, facadeGeo(tw, 0, th, holes, 0.7), M.stone, B)
    for (const h of holes) if (h.y > 1) windowAt(c, B, h, 'D', 'none', 0)
    add(c, BOX, M.stone, B.clone().multiply(local(tw / 2, th, 0.15, tw + 0.3, 0.5, 0.4)))
    // pinnacles at the corners of the parapet
    add(c, once('pinn', () => new THREE.ConeGeometry(0.3, 2.2, 4)), M.stone, B.clone().multiply(local(0.2, th + 1.3, -0.2)))
  }
  const spire = once('spire', () => new THREE.ConeGeometry(1, 1, 8))
  add(c, spire, S.slate, local(tx, c.y0 + th + 9, lz, tw / 2 - 0.4, 18, tw / 2 - 0.4, Math.PI / 8))
  add(c, BOX, c.M.gold, local(tx, c.y0 + th + 18.6, lz, 0.06, 1.4, 0.06))
  add(c, BOX, c.M.gold, local(tx, c.y0 + th + 18.8, lz, 0.6, 0.06, 0.06))
  ub(c, c.M.concrete, tx, th - 0.2, lz, tw - 1.4, 0.3, tw - 1.4)
  add(c, PLANE, S.clock, local(tx, c.y0 + th - 2.3, lz - tw / 2 - 0.36, 1.9, 1.9, 1, Math.PI))
  add(c, PLANE, S.clock, local(tx - tw / 2 - 0.36, c.y0 + th - 2.3, lz, 1.9, 1.9, 1, -Math.PI / 2))
  // the tower's walls (the doorways left open)
  const tw0 = tx - tw / 2
  const tw1 = tx + tw / 2
  solidArea(c, tw0 - 0.35, tw1 + 0.35, lz - tw / 2 - 0.35, lz - tw / 2 + 0.35)
  solidArea(c, tw0 - 0.35, tw1 + 0.35, lz + tw / 2 - 0.35, lz + tw / 2 + 0.35)
  solidArea(c, tw0 - 0.35, tw0 + 0.35, lz - tw / 2, lz - 1.1)
  solidArea(c, tw0 - 0.35, tw0 + 0.35, lz + 1.1, lz + tw / 2)
  solidArea(c, tw1 - 0.35, tw1 + 0.35, lz - tw / 2, lz - 1.5)
  solidArea(c, tw1 - 0.35, tw1 + 0.35, lz + 1.5, lz + tw / 2)
  proxy(c, local(tx, c.y0 + th / 2 + 3.4, lz, tw, th - 3.4, tw))
  ub(c, c.M.concrete, tx, 3.8, lz, tw - 1.4, 0.2, tw - 1.4)
  // a path from the gate round to the tower's door
  flat(c, S.gravel, b.x0 + (b.x1 - b.x0) / 2 - 7.5, b.x0 + (b.x1 - b.x0) / 2 - 3.5, b.z0 + 0.5, lz - tw / 2 - 1, 0.008)
  flat(c, S.gravel, tw0 - 4, b.x0 + (b.x1 - b.x0) / 2 - 3.5, lz - tw / 2 - 3, lz - tw / 2 - 1, 0.008)
  flat(c, S.gravel, tw0 - 4, tw0 - 0.4, lz - tw / 2 - 3, lz + 1.4, 0.008)
  // the graves: headstones in rows, a few leaning, crosses, a table tomb; yews
  const stone = once('headstone', () => {
    const s = new THREE.Shape()
    s.moveTo(-0.35, 0)
    s.lineTo(0.35, 0)
    s.lineTo(0.35, 0.75)
    s.absarc(0, 0.75, 0.35, 0, Math.PI, false)
    s.lineTo(-0.35, 0)
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false, curveSegments: 6 })
    g.translate(0, 0, -0.05)
    return g
  })
  for (let gx = b.x0 + 3; gx < b.x1 - 2; gx += 2.2)
    for (const gz of [b.z1 - 3, b.z1 - 5.5, b.z1 - 8]) {
      if (r() < 0.25) continue
      const lean = (r() - 0.5) * 0.3
      if (r() < 0.2) {
        add(c, BOX, c.M.stone, local(gx, c.y0 + 0.55, gz, 0.1, 1.1, 0.1))
        add(c, BOX, c.M.stone, local(gx, c.y0 + 0.8, gz, 0.55, 0.1, 0.1))
      } else add(c, stone, c.M.stone, new THREE.Matrix4().compose(new THREE.Vector3(gx, c.y0, gz), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, (r() - 0.5) * 0.15, 0)), new THREE.Vector3(1, 0.8 + r() * 0.5, 1)))
      solidArea(c, gx - 0.4, gx + 0.4, gz - 0.15, gz + 0.15)
    }
  for (let gx = n0 + 2; gx < b.x1 - 3; gx += 2.4) {
    if (r() < 0.4) continue
    const gz = b.z0 + 4 + r() * 2
    add(c, stone, c.M.stone, local(gx, c.y0, gz, 1, 0.9, 1, Math.PI))
    solidArea(c, gx - 0.4, gx + 0.4, gz - 0.15, gz + 0.15)
  }
  ub(c, c.M.stone, b.x1 - 6, 0.5, cz + 3, 2.2, 1.0, 1.1)
  solidArea(c, b.x1 - 7.2, b.x1 - 4.8, cz + 2.3, cz + 3.7)
  for (const [yx, yz] of [[b.x0 + 3, b.z0 + 3], [b.x1 - 3, b.z1 - 12], [b.x0 + 3, b.z1 - 12]]) conifer(c, yx, yz, 7 + r() * 2)
  board(c, 'ST KHERVE · ALL WELCOME', '#1a2a4a', '#e8e2c8', b.x0 + (b.x1 - b.x0) / 2 - 10, 1.4, b.z0 - 0.15, 3.4, 0.6, Math.PI, 0, true)
}

/** A petrol station on the block's south side: a canopy over four pumps, its shop, the price sign; buildings behind. */
export function petrol(c: Ctx, b: Box2, row: RowFn) {
  const S = siteMats(c)
  const { r, M } = c
  const fz1 = b.z0 + 26
  const cx = (b.x0 + b.x1) / 2
  flat(c, S.tarmac, b.x0, b.x1, b.z0, fz1)
  // the canopy: four columns, a deep fascia in the company's green, lit strips underneath
  const cz = b.z0 + 9
  const cw = 20
  const cd = 11
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const px = cx + sx * (cw / 2 - 2.5)
      const pz = cz + sz * (cd / 2 - 2)
      ub(c, c.M.paintWhite, px, 2.6, pz, 0.4, 5.2, 0.4)
      solidArea(c, px - 0.3, px + 0.3, pz - 0.3, pz + 0.3)
    }
  ub(c, c.M.paintWhite, cx, 5.55, cz, cw, 0.7, cd)
  const fuelT = signTex('KHERVE FUEL', '#0f5a35', '#ffffff', 1024, 96, 'bold 64px Helvetica, Arial, sans-serif')
  let fm = c.signs.get('fuelfascia')
  if (!fm) c.signs.set('fuelfascia', (fm = c.own(new THREE.MeshStandardMaterial({ map: fuelT, emissive: 0xffffff, emissiveMap: fuelT, emissiveIntensity: 0.7 }))))
  for (const s of [-1, 1]) add(c, PLANE, fm, local(cx, c.y0 + 5.55, cz + s * (cd / 2 + 0.01), cw, 0.7, 1, s > 0 ? 0 : Math.PI))
  for (let k = -3; k <= 3; k++) add(c, BOX, k % 2 ? S.strip : c.M.lampOff, local(cx + k * 2.6, c.y0 + 5.18, cz, 1.6, 0.04, 0.3))
  c.lights.push({ p: new THREE.Vector3(cx, c.y0 + 4.8, cz), color: 0xf0f4ff, power: 22, range: 26 })
  proxy(c, local(cx, c.y0 + 5.55, cz, cw, 0.7, cd))
  // two islands, two pumps each, hoses hanging; one pump knocked over
  for (const sx of [-1, 1]) {
    const ix = cx + sx * 4.5
    ub(c, c.M.concrete, ix, 0.1, cz, 1.4, 0.2, 6)
    solidArea(c, ix - 0.8, ix + 0.8, cz - 3.1, cz + 3.1)
    for (const sz of [-1.6, 1.6]) {
      if (sx > 0 && sz > 0 && r() < 0.6) {
        add(c, BOX, c.M.paintWhite, new THREE.Matrix4().compose(new THREE.Vector3(ix + 1.2, c.y0 + 0.4, cz + sz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.3, Math.PI / 2 - 0.1)), new THREE.Vector3(0.7, 1.8, 0.5)))
        continue
      }
      ub(c, c.M.paintWhite, ix, 1.1, cz + sz, 0.7, 1.8, 0.55)
      add(c, BOX, c.M.black, local(ix, c.y0 + 1.55, cz + sz, 0.72, 0.4, 0.4))
      add(c, BOX, c.M.lampOff, local(ix + 0.37 * sx, c.y0 + 1.5, cz + sz, 0.01, 0.25, 0.3))
      add(c, BOX, S.green, local(ix, c.y0 + 2.05, cz + sz, 0.74, 0.14, 0.57))
      add(c, BOX, c.M.black, local(ix - 0.45 * sx, c.y0 + 1.0, cz + sz + 0.2, 0.05, 0.9, 0.05))
    }
  }
  // a car at a pump, its door open; another left across the exit
  carAt(c, 'hatch', 'abandoned', cx + 7.2, cz - 1.2, Math.PI / 2 + 0.05)
  carAt(c, 'saloon', r() < 0.5 ? 'smashed' : 'abandoned', cx - 9, b.z0 + 2.5, 0.4)
  c.supplies.push([cx + 4.5, c.y0 + 0.2, cz])
  // the shop at the back: glass front, lit, shelves, a counter
  const sw = 14
  const sd = 8
  const sz0 = fz1 - sd - 1
  const shopB = local(cx - sw / 2, c.y0, sz0 + sd, 1, 1, 1, 0)
  const sh = 4
  ub(c, c.M.paintWhite, cx, sh / 2, sz0 + sd / 2, sw, sh, sd)
  const front = local(cx + sw / 2, c.y0, sz0, 1, 1, 1, Math.PI)
  add(c, facadeGeo(sw, 0, sh, [{ x: 1, y: 0.4, w: sw - 4.6, h: 2.6 }, { x: sw - 3, y: 0.02, w: 1.8, h: 2.5 }], 0.2), c.M.paintWhite, front.clone().multiply(local(0, 0, 0.21)))
  c.I.shop.add(front, local(1 + (sw - 4.6) / 2, 1.7, 0.05, sw - 4.6, 2.6, 1), new THREE.Color(0.9, 0.9, 0.9))
  c.I.glass.add(front, local(sw - 2.1, 1.26, 0.05, 1.8, 2.5, 1))
  add(c, PLANE, fm, front.clone().multiply(local(sw / 2, sh - 0.4, 0.23, sw - 1, 0.6, 1)))
  footprint(c, shopB, 0, sw, -sd - 0.2, 0.25)
  void shopB
  // the price sign by the road
  const tx = b.x0 + 3
  const tz = b.z0 + 2
  ub(c, c.M.paintWhite, tx, 3, tz, 1.4, 6, 0.4)
  const priceT = once('prices', () => {
    const [cv, g] = canvas(256, 512)
    g.fillStyle = '#0f5a35'
    g.fillRect(0, 0, 256, 512)
    g.fillStyle = '#fff'
    g.font = 'bold 40px Helvetica, Arial, sans-serif'
    g.textAlign = 'center'
    g.fillText('KHERVE', 128, 60)
    g.fillText('FUEL', 128, 104)
    g.font = 'bold 30px Helvetica, Arial, sans-serif'
    const lines: [string, string][] = [['UNLEADED', '---.9'], ['DIESEL', '---.9'], ['', ''], ['CLOSED', '']]
    lines.forEach(([a, p], i) => {
      g.fillStyle = '#111'
      g.fillRect(16, 150 + i * 84, 224, 70)
      g.fillStyle = i === 3 ? '#ff4030' : '#ffb020'
      g.fillText(a, 128, 180 + i * 84)
      g.fillText(p, 128, 210 + i * 84)
    })
    return texture(cv)
  })
  let pm = c.signs.get('prices')
  if (!pm) c.signs.set('prices', (pm = c.own(new THREE.MeshStandardMaterial({ map: priceT, emissive: 0xffffff, emissiveMap: priceT, emissiveIntensity: 0.8 }))))
  for (const s of [-1, 1]) add(c, PLANE, pm, local(tx, c.y0 + 3.4, tz + s * 0.21, 1.3, 2.6, 1, s > 0 ? 0 : Math.PI))
  solidArea(c, tx - 0.8, tx + 0.8, tz - 0.3, tz + 0.3)
  // a low wall along the back of the forecourt, tyres, an air machine; the buildings behind on the other faces
  ub(c, M.brick[0], cx, 0.5, fz1 + 0.15, b.x1 - b.x0, 1.0, 0.3)
  solidArea(c, b.x0, b.x1, fz1, fz1 + 0.4)
  ub(c, c.M.red, b.x1 - 2, 0.75, fz1 - 1, 0.6, 1.5, 0.4)
  for (let k = 0; k < 5; k++) add(c, once('tyre', () => new THREE.TorusGeometry(0.3, 0.12, 6, 14)), c.V.tyre, new THREE.Matrix4().compose(new THREE.Vector3(b.x1 - 4 - (k % 2) * 0.3, c.y0 + 0.12 + Math.floor(k / 2) * 0.24, fz1 - 1.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1)))
  solidArea(c, b.x1 - 4.6, b.x1 - 1.6, fz1 - 1.6, fz1 - 0.6)
  row('N', b.x0, b.x1)
  row('W', fz1 + 0.5, b.z1 - 13)
  row('E', fz1 + 0.5, b.z1 - 13)
}

/** A car park: white bays, rows of cars, a barrier, a pay machine, floodlights on tall columns. */
export function carpark(c: Ctx, b: Box2) {
  const S = siteMats(c)
  const { r, M } = c
  flat(c, S.tarmac, b.x0, b.x1, b.z0, b.z1)
  // a low wall round it with two ways in
  const w = (x0: number, z0: number, x1: number, z1: number) => {
    ub(c, M.brick[3], (x0 + x1) / 2, 0.45, (z0 + z1) / 2, Math.max(0.3, Math.abs(x1 - x0)), 0.9, Math.max(0.3, Math.abs(z1 - z0)))
    solidArea(c, Math.min(x0, x1) - 0.15, Math.max(x0, x1) + 0.15, Math.min(z0, z1) - 0.15, Math.max(z0, z1) + 0.15)
  }
  const cx = (b.x0 + b.x1) / 2
  w(b.x0, b.z0 + 0.2, cx - 3.5, b.z0 + 0.2)
  w(cx + 3.5, b.z0 + 0.2, b.x1, b.z0 + 0.2)
  w(b.x0, b.z1 - 0.2, b.x1, b.z1 - 0.2)
  w(b.x0 + 0.2, b.z0, b.x0 + 0.2, b.z1)
  w(b.x1 - 0.2, b.z0, b.x1 - 0.2, (b.z0 + b.z1) / 2 - 3.5)
  w(b.x1 - 0.2, (b.z0 + b.z1) / 2 + 3.5, b.x1 - 0.2, b.z1)
  // the barrier arm, up; the pay machine
  ub(c, S.yellow, cx + 3.2, 0.55, b.z0 + 1, 0.4, 1.1, 0.4)
  add(c, BOX, S.redWhite, new THREE.Matrix4().compose(new THREE.Vector3(cx + 3.0, c.y0 + 2.6, b.z0 + 1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.4)), new THREE.Vector3(3.2, 0.1, 0.1)))
  solidArea(c, cx + 2.9, cx + 3.5, b.z0 + 0.7, b.z0 + 1.3)
  ub(c, S.steel, cx - 6, 0.8, b.z0 + 2, 0.6, 1.6, 0.4)
  add(c, BOX, S.fridge, local(cx - 6, c.y0 + 1.25, b.z0 + 2.21, 0.3, 0.2, 0.01))
  solidArea(c, cx - 6.4, cx - 5.6, b.z0 + 1.7, b.z0 + 2.3)
  // bays in four rows, cars in most of them
  const line = (x: number, z0: number, z1: number) => flat(c, c.M.white, x - 0.06, x + 0.06, z0, z1, 0.014)
  const rows = [b.z0 + 6, b.z0 + 17, b.z0 + 27, b.z0 + 38]
  const kinds: CarKind[] = ['hatch', 'saloon', 'estate', 'suv', 'hatch', 'van']
  rows.forEach((rz, ri) => {
    for (let x = b.x0 + 2; x < b.x1 - 2; x += 2.6) {
      line(x, rz - 2.5, rz + 2.5)
      const bayX = x + 1.3
      if (bayX > b.x1 - 2.5 || r() < 0.3) continue
      const st = r()
      carAt(c, kinds[Math.floor(r() * kinds.length)], st < 0.6 ? 'parked' : st < 0.8 ? 'abandoned' : st < 0.92 ? 'smashed' : 'burnt', bayX, rz + (r() - 0.5) * 0.4, (ri % 2 ? Math.PI / 2 : -Math.PI / 2) + (r() - 0.5) * 0.1)
    }
  })
  // floodlight columns
  for (const [lx, lz] of [[b.x0 + 3, b.z0 + 11.5], [b.x1 - 3, b.z0 + 32.5]]) {
    cy(c, c.M.pole, lx, 5, lz, 0.12, 10)
    add(c, BOX, c.M.lampOn, local(lx, c.y0 + 9.9, lz, 0.9, 0.2, 0.5))
    solidArea(c, lx - 0.2, lx + 0.2, lz - 0.2, lz + 0.2)
    c.lights.push({ p: new THREE.Vector3(lx, c.y0 + 9.5, lz), color: 0xe8f0ff, power: 30, range: 30 })
  }
  c.supplies.push([cx, c.y0, b.z0 + 22])
  board(c, 'PAY & DISPLAY', '#1f4fa8', '#ffffff', cx - 8, 2.2, b.z0 - 0.2, 2.2, 0.5, Math.PI, 0, true)
}

/** A building site: a hoarding round it, a half-built concrete frame, scaffolding, a tower crane, cabins, a skip, a digger. */
export function works(c: Ctx, b: Box2) {
  const S = siteMats(c)
  const { r, M } = c
  const cx = (b.x0 + b.x1) / 2
  const cz = (b.z0 + b.z1) / 2
  flat(c, S.gravel, b.x0, b.x1, b.z0, b.z1)
  // the hoarding: panels 2.4 m high on all four sides, the gates open on the south side
  const hoard = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const ry = -Math.atan2(z1 - z0, x1 - x0)
    const ux = (x1 - x0) / len
    const uz = (z1 - z0) / len
    for (let t = 0; t < len - 0.1; t += 9.6) {
      const l = Math.min(9.6, len - t)
      const mx = x0 + ux * (t + l / 2)
      const mz = z0 + uz * (t + l / 2)
      add(c, BOX, S.hoarding, new THREE.Matrix4().compose(new THREE.Vector3(mx, c.y0 + 1.2, mz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(l, 2.4, 0.06)))
    }
    solidArea(c, Math.min(x0, x1) - 0.15, Math.max(x0, x1) + 0.15, Math.min(z0, z1) - 0.15, Math.max(z0, z1) + 0.15)
    proxy(c, local((x0 + x1) / 2, c.y0 + 1.2, (z0 + z1) / 2, Math.max(0.1, Math.abs(x1 - x0)), 2.4, Math.max(0.1, Math.abs(z1 - z0))))
  }
  const i = 0.5
  hoard(b.x0 + i, b.z0 + i, cx - 4, b.z0 + i)
  hoard(cx + 4, b.z0 + i, b.x1 - i, b.z0 + i)
  hoard(b.x1 - i, b.z1 - i, b.x0 + i, b.z1 - i)
  hoard(b.x0 + i, b.z1 - i, b.x0 + i, b.z0 + i)
  hoard(b.x1 - i, b.z0 + i, b.x1 - i, b.z1 - i)
  // the gates, swung open
  for (const s of [-1, 1]) add(c, BOX, S.plywood, new THREE.Matrix4().compose(new THREE.Vector3(cx + s * 3.0, c.y0 + 1.2, b.z0 + i + 1.9), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s * 1.25), new THREE.Vector3(3.8, 2.4, 0.06)))
  board(c, 'SITE ENTRANCE · HARD HATS', '#f0c419', '#111111', cx - 5.8, 1.9, b.z0 - 0.05, 2.4, 0.5, Math.PI)
  // the frame: columns on a 6 m grid, three floors of slabs, the top one columns only
  const fx0 = cx - 13
  const fz0 = cz - 4
  const nx = 5
  const nz = 3
  for (let f = 0; f < 4; f++) {
    const y = f * 3.6
    if (f > 0 && f < 3) ub(c, M.concrete, fx0 + (nx - 1) * 3, y, fz0 + (nz - 1) * 3, (nx - 1) * 6 + 1, 0.3, (nz - 1) * 6 + 1)
    for (let a = 0; a < nx; a++)
      for (let k = 0; k < nz; k++) {
        if (f === 3 && (a + k) % 2) continue
        ub(c, M.concrete, fx0 + a * 6, y + 1.8, fz0 + k * 6, 0.45, 3.6, 0.45)
        if (f === 3) for (let q = 0; q < 4; q++) add(c, BOX, S.steel, local(fx0 + a * 6 + (q % 2 ? 0.15 : -0.15), c.y0 + y + 3.8, fz0 + k * 6 + (q < 2 ? 0.15 : -0.15), 0.02, 0.8, 0.02))
        if (f === 0) solidArea(c, fx0 + a * 6 - 0.3, fx0 + a * 6 + 0.3, fz0 + k * 6 - 0.3, fz0 + k * 6 + 0.3)
      }
  }
  // the ground-floor slab's edge and the stair core
  ub(c, M.concrete, fx0 + (nx - 1) * 6 - 2, 5.4, fz0 + 3, 3, 10.8, 4)
  solidArea(c, fx0 + (nx - 1) * 6 - 3.6, fx0 + (nx - 1) * 6 - 0.4, fz0 + 0.9, fz0 + 5.1)
  proxy(c, local(fx0 + (nx - 1) * 3, c.y0 + 7.2, fz0 + (nz - 1) * 3, (nx - 1) * 6, 7.2, (nz - 1) * 6))
  c.supplies.push([fx0 + 9, c.y0, fz0 + 6])
  // scaffolding up the south face: standards, ledgers, boards
  const sz = fz0 - 1.4
  for (let a = 0; a <= 16; a++) {
    const x = fx0 - 0.5 + a * 1.6
    for (const dz of [0, 1.2]) add(c, BOX, S.steel, local(x, c.y0 + 5.4, sz - dz, 0.05, 10.8, 0.05))
  }
  for (let f = 1; f <= 5; f++) {
    for (const dz of [0, 1.2]) add(c, BOX, S.steel, local(fx0 - 0.5 + 12.8, c.y0 + f * 2, sz - dz, 25.6, 0.05, 0.05))
    add(c, BOX, S.plywood, local(fx0 - 0.5 + 12.8, c.y0 + f * 2 - 0.04, sz - 0.6, 25.6, 0.04, 1.1))
  }
  solidArea(c, fx0 - 0.7, fx0 + 25.3, sz - 1.4, sz + 0.2)
  // the tower crane: a lattice mast, the jib over the street, the counter-jib and its weights, the cab, the hook
  const kx = cx + 15
  const kz = cz + 12
  const mh = 38
  const ms = 1.6
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) add(c, BOX, S.yellow, local(kx + (sx * ms) / 2, c.y0 + mh / 2, kz + (sz2 * ms) / 2, 0.12, mh, 0.12))
  for (let y = 1; y < mh; y += 1.6) {
    for (const s of [-1, 1]) {
      add(c, BOX, S.yellow, new THREE.Matrix4().compose(new THREE.Vector3(kx, c.y0 + y + 0.8, kz + (s * ms) / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.78 * (Math.floor(y) % 2 ? 1 : -1))), new THREE.Vector3(2.2, 0.06, 0.06)))
      add(c, BOX, S.yellow, new THREE.Matrix4().compose(new THREE.Vector3(kx + (s * ms) / 2, c.y0 + y + 0.8, kz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.78 * (Math.floor(y) % 2 ? 1 : -1), 0, 0)), new THREE.Vector3(0.06, 0.06, 2.2)))
    }
  }
  ub(c, M.concrete, kx, 0.6, kz, 4.2, 1.2, 4.2)
  solidArea(c, kx - 2.2, kx + 2.2, kz - 2.2, kz + 2.2)
  const jibA = r() * Math.PI * 2
  const J = new THREE.Matrix4().compose(new THREE.Vector3(kx, c.y0 + mh, kz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), jibA), new THREE.Vector3(1, 1, 1))
  add(c, BOX, S.yellow, J.clone().multiply(local(0, 0.8, 0, 2.2, 1.6, 2.2)))
  add(c, BOX, c.M.glassPane, J.clone().multiply(local(1.3, 0.9, 0.6, 0.05, 1.1, 1.2)))
  for (const s of [-1, 1]) add(c, BOX, S.yellow, J.clone().multiply(local(15, 1.8, s * 0.6, 34, 0.12, 0.12)))
  add(c, BOX, S.yellow, J.clone().multiply(local(15, 2.9, 0, 34, 0.12, 0.12)))
  for (let x = 0; x < 32; x += 1.7) add(c, BOX, S.yellow, new THREE.Matrix4().copy(J).multiply(new THREE.Matrix4().compose(new THREE.Vector3(x + 0.85, 2.35, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.9 * (Math.floor(x / 1.7) % 2 ? 1 : -1))), new THREE.Vector3(1.4, 0.06, 0.06))))
  for (const s of [-1, 1]) add(c, BOX, S.yellow, J.clone().multiply(local(-6, 1.8, s * 0.6, 12, 0.14, 0.14)))
  add(c, BOX, M.concrete, J.clone().multiply(local(-10.5, 1.2, 0, 2.4, 2.0, 1.6)))
  add(c, BOX, S.yellow, J.clone().multiply(local(0, 5.4, 0, 0.3, 5, 0.3)))
  add(c, BOX, S.wire, J.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(14, 4.7, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.19)), new THREE.Vector3(29, 0.03, 0.03))))
  add(c, BOX, S.wire, J.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(-6, 4.4, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.42)), new THREE.Vector3(13, 0.03, 0.03))))
  // the trolley, the cable and the hook block hanging at mid height
  add(c, BOX, c.M.darkMetal, J.clone().multiply(local(22, 1.6, 0, 1, 0.3, 1)))
  add(c, BOX, S.wire, J.clone().multiply(local(22, -mh / 4 + 1.6, 0, 0.03, mh / 2, 0.03)))
  add(c, BOX, S.yellow, J.clone().multiply(local(22, -mh / 2 + 1.6, 0, 0.6, 0.8, 0.4)))
  add(c, once('aviat', () => new THREE.SphereGeometry(0.14, 10, 8)), c.M.aviation, J.clone().multiply(local(0, 8.1, 0)))
  add(c, once('aviat', () => new THREE.SphereGeometry(0.14, 10, 8)), c.M.aviation, J.clone().multiply(local(31.5, 3.2, 0)))
  // cabins stacked two high, a skip, pallets of blocks, a cement mixer, the digger
  for (let k = 0; k < 2; k++) {
    const kx2 = b.x0 + 6
    const kz2 = b.z1 - 5 - k * 0.1
    add(c, uvBox(7, 2.6, 2.6), S.container[(k + 2) % 5], local(kx2, c.y0 + 1.3 + k * 2.65, kz2))
    for (let w = 0; w < 3; w++) c.I.glass.add(local(kx2 - 2.4 + w * 2.4, c.y0 + 1.6 + k * 2.65, kz2 - 1.31, 1, 1, 1, Math.PI), local(0, 0, 0, 1.0, 0.8, 1))
  }
  solidArea(c, b.x0 + 2.4, b.x0 + 9.6, b.z1 - 6.4, b.z1 - 3.6)
  ub(c, S.container[0], b.x1 - 7, 0.75, b.z0 + 6, 4, 1.5, 2)
  rubble(c, b.x1 - 7, b.z0 + 6, 1.3)
  for (let k = 0; k < 3; k++) {
    ub(c, S.wood, b.x0 + 4 + k * 1.6, 0.07, b.z0 + 5, 1.2, 0.14, 1.0)
    ub(c, M.concrete, b.x0 + 4 + k * 1.6, 0.6, b.z0 + 5, 1.1, 0.9, 0.9)
  }
  solidArea(c, b.x0 + 3.3, b.x0 + 7.9, b.z0 + 4.4, b.z0 + 5.6)
  digger(c, cx - 8, b.z1 - 9, r() * 6)
  for (let k = 0; k < 6; k++) cone(c, cx - 3 + k * 1.2, b.z0 + 4, k === 3)
}

/** A yellow excavator: tracks, the cab on its turntable, the boom and the bucket down. */
function digger(c: Ctx, x: number, z: number, ry: number) {
  const S = siteMats(c)
  const B = local(x, c.y0, z, 1, 1, 1, ry)
  for (const s of [-1, 1]) add(c, BOX, c.M.darkMetal, B.clone().multiply(local(0, 0.45, s * 1.1, 3.6, 0.9, 0.6)))
  add(c, BOX, S.yellow, B.clone().multiply(local(-0.2, 1.4, 0, 3.0, 1.0, 2.4)))
  add(c, BOX, S.yellow, B.clone().multiply(local(0.4, 2.4, 0.5, 1.2, 1.4, 1.1)))
  add(c, BOX, c.M.glassPane, B.clone().multiply(local(1.01, 2.5, 0.5, 0.02, 1.0, 0.9)))
  add(c, BOX, S.yellow, B.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(2.3, 2.6, -0.4), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.55)), new THREE.Vector3(3.2, 0.4, 0.35))))
  add(c, BOX, S.yellow, B.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(4.2, 1.8, -0.4), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -1.1)), new THREE.Vector3(2.4, 0.3, 0.3))))
  add(c, BOX, c.M.darkMetal, B.clone().multiply(local(4.8, 0.45, -0.4, 0.8, 0.7, 0.9)))
  const v = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry)
  const hx = Math.abs(v.x) * 2.6 + Math.abs(v.z) * 1.5
  const hz = Math.abs(v.z) * 2.6 + Math.abs(v.x) * 1.5
  solidArea(c, x - hx, x + hx, z - hz, z + hz)
  proxy(c, local(x, c.y0 + 1.3, z, 4, 2.6, 2.6, ry))
}

/** A supermarket you can walk into: a glass front with its doors smashed, aisles, fridges, tills, trolleys; its car park in front. */
export function mart(c: Ctx, b: Box2) {
  const S = siteMats(c)
  const { r, M } = c
  const cx = (b.x0 + b.x1) / 2
  const W = 34
  const D = 22
  const H = 5.2
  const sx0 = cx - W / 2
  const sx1 = cx + W / 2
  const sz0 = b.z1 - 1.5 - D
  const sz1 = b.z1 - 1.5
  flat(c, S.tarmac, b.x0, b.x1, b.z0, sz0)
  // the car park: bays, trolleys, a few cars
  for (let x = b.x0 + 3; x < b.x1 - 3; x += 2.6) flat(c, c.M.white, x - 0.06, x + 0.06, b.z0 + 7, b.z0 + 12, 0.014)
  for (let x = b.x0 + 4.3; x < b.x1 - 4; x += 2.6) if (r() < 0.45) carAt(c, (['hatch', 'estate', 'suv', 'saloon'] as CarKind[])[Math.floor(r() * 4)], r() < 0.7 ? 'parked' : 'abandoned', x, b.z0 + 9.5 + (r() - 0.5) * 0.3, Math.PI / 2 + (r() - 0.5) * 0.1)
  for (let k = 0; k < 7; k++) trolley(c, b.x0 + 4 + r() * (W - 4), b.z0 + 13 + r() * (sz0 - b.z0 - 15), r() * 6, r() < 0.2)
  // the walls: brick sides and back, the front all glass between steel posts, the doorway smashed open
  const wallT = 0.3
  ub(c, M.brick[1], cx, H / 2, sz1, W, H, wallT)
  ub(c, M.brick[1], sx0, H / 2, (sz0 + sz1) / 2, wallT, H, D)
  ub(c, M.brick[1], sx1, H / 2, (sz0 + sz1) / 2, wallT, H, D)
  ub(c, c.M.darkMetal, cx, H - 0.5, sz0, W, 1.0, wallT)
  ub(c, c.M.darkMetal, cx, 0.2, sz0, W, 0.4, wallT)
  const doorX = cx + (r() - 0.5) * 8
  for (let x = sx0 + 2.5; x < sx1 - 1; x += 2.5) {
    if (Math.abs(x - doorX) < 1.6) continue
    add(c, BOX, c.M.darkMetal, local(x, c.y0 + 2.4, sz0, 0.12, 4.0, 0.14))
  }
  for (let x = sx0 + 1.25; x < sx1; x += 2.5) {
    if (Math.abs(x - doorX) < 1.5) continue
    add(c, BOX, c.M.glassPane, local(x, c.y0 + 2.4, sz0, 2.4, 3.6, 0.03))
  }
  // the doors: one slid open, one shattered, glass on the floor
  add(c, BOX, c.M.glassPane, local(doorX + 1.1, c.y0 + 1.3, sz0 + 0.12, 1.2, 2.5, 0.03))
  for (let k = 0; k < 18; k++) add(c, BOX, c.M.glassPane, local(doorX + (r() - 0.5) * 3, c.y0 + 0.01, sz0 + (r() - 0.5) * 2.5, 0.1 + r() * 0.2, 0.01, 0.08 + r() * 0.2, r() * 3))
  const signT = signTex('KHERVE MART', '#ffffff', '#0f7a45', 1024, 160, 'bold 120px Helvetica, Arial, sans-serif')
  let sm = c.signs.get('martsign')
  if (!sm) c.signs.set('martsign', (sm = c.own(new THREE.MeshStandardMaterial({ map: signT, emissive: 0xffffff, emissiveMap: signT, emissiveIntensity: 0.9 }))))
  add(c, PLANE, sm, local(cx, c.y0 + H + 0.9, sz0 - 0.05, 12, 1.9, 1, Math.PI))
  add(c, BOX, M.darkMetal, local(cx, c.y0 + H + 0.9, sz0 + 0.06, 12.2, 2.0, 0.1))
  solidArea(c, sx0 - 0.2, sx1 + 0.2, sz1 - 0.2, sz1 + 0.4)
  solidArea(c, sx0 - 0.3, sx0 + 0.2, sz0, sz1)
  solidArea(c, sx1 - 0.2, sx1 + 0.3, sz0, sz1)
  solidArea(c, sx0 - 0.3, doorX - 1.5, sz0 - 0.2, sz0 + 0.15)
  solidArea(c, doorX + 1.5, sx1 + 0.3, sz0 - 0.2, sz0 + 0.15)
  proxy(c, local(cx, c.y0 + H / 2, sz1, W, H, wallT))
  proxy(c, local(sx0, c.y0 + H / 2, (sz0 + sz1) / 2, wallT, H, D))
  proxy(c, local(sx1, c.y0 + H / 2, (sz0 + sz1) / 2, wallT, H, D))
  // the roof (the flat roof seen from above and the ceiling below), the strip lights, some still on
  ub(c, M.concrete, cx, H + 0.2, (sz0 + sz1) / 2, W + 0.4, 0.4, D + 0.3)
  add(c, BOX, S.ceiling, local(cx, c.y0 + H - 0.02, (sz0 + sz1) / 2, W - 0.3, 0.02, D - 0.3))
  flat(c, S.tile, sx0 + 0.15, sx1 - 0.15, sz0 + 0.1, sz1 - 0.15, 0.01)
  for (let x = sx0 + 3; x < sx1 - 2; x += 4)
    for (let z = sz0 + 3; z < sz1 - 2; z += 4) add(c, BOX, r() < 0.4 ? S.strip : c.M.lampOff, local(x, c.y0 + H - 0.06, z, 1.4, 0.05, 0.25))
  c.lights.push({ p: new THREE.Vector3(cx - 6, c.y0 + H - 0.6, (sz0 + sz1) / 2), color: 0xeaf2ff, power: 9, range: 22 })
  c.lights.push({ p: new THREE.Vector3(cx + 9, c.y0 + H - 0.6, sz1 - 4), color: 0xeaf2ff, power: 6, range: 16 })
  // the aisles: double-sided shelving runs, back to front
  const aisleZ0 = sz0 + 7
  const aisleZ1 = sz1 - 4
  for (let k = 0; k < 6; k++) {
    const ax = sx0 + 4.5 + k * 5
    if (ax > sx1 - 3) break
    const len = aisleZ1 - aisleZ0
    const az = (aisleZ0 + aisleZ1) / 2
    add(c, BOX, c.M.paintWhite, local(ax, c.y0 + 1.0, az, 1.1, 2.0, len))
    for (const s of [-1, 1]) add(c, PLANE, S.goods, local(ax + s * 0.56, c.y0 + 1.05, az, len, 1.9, 1, (s * Math.PI) / 2))
    add(c, BOX, S.green, local(ax, c.y0 + 2.2, az, 1.2, 0.3, len))
    solidArea(c, ax - 0.65, ax + 0.65, aisleZ0 - 0.1, aisleZ1 + 0.1)
    proxy(c, local(ax, c.y0 + 1, az, 1.1, 2, len))
    // things knocked off the shelves
    for (let q = 0; q < 5; q++) add(c, BOX, c.M.cardboard, local(ax + (r() < 0.5 ? -1 : 1) * (0.9 + r() * 0.6), c.y0 + 0.1, aisleZ0 + r() * len, 0.3, 0.2, 0.2, r() * 3))
    if (k % 2 === 0) c.supplies.push([ax + 1.6, c.y0, az + (r() - 0.5) * len * 0.6])
  }
  // fridges along the back wall, glowing
  for (let x = sx0 + 1.5; x < sx1 - 1.5; x += 2.2) {
    add(c, BOX, c.M.paintWhite, local(x, c.y0 + 1.1, sz1 - 0.65, 2.1, 2.2, 0.9))
    add(c, BOX, S.fridge, local(x, c.y0 + 1.15, sz1 - 1.11, 1.9, 1.8, 0.02))
  }
  solidArea(c, sx0, sx1, sz1 - 1.2, sz1)
  // the tills by the front, conveyor belts, a trolley jammed in one
  for (let k = 0; k < 4; k++) {
    const tx = sx0 + 6 + k * 5.5
    if (Math.abs(tx - doorX) < 2.5) continue
    add(c, BOX, c.M.darkMetal, local(tx, c.y0 + 0.45, sz0 + 4, 0.8, 0.9, 3.2))
    add(c, BOX, c.M.black, local(tx, c.y0 + 0.92, sz0 + 4, 0.6, 0.04, 3.0))
    add(c, BOX, c.M.lampOff, local(tx + 0.5, c.y0 + 1.25, sz0 + 3, 0.2, 0.35, 0.3))
    solidArea(c, tx - 0.5, tx + 0.5, sz0 + 2.3, sz0 + 5.7)
  }
  trolley(c, doorX - 2, sz0 + 2, 0.4, false)
  trolley(c, cx + 3, sz0 + 6, 2.2, true)
  c.supplies.push([doorX + 2.5, c.y0, sz0 + 6])
  // the back of the block: a service yard wall
  void b
}

/** A shopping trolley (on its side, maybe). */
function trolley(c: Ctx, x: number, z: number, ry: number, down: boolean) {
  const S = siteMats(c)
  const B = new THREE.Matrix4().compose(new THREE.Vector3(x, c.y0 + (down ? 0.3 : 0), z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, down ? Math.PI / 2 : 0, 'YXZ')), new THREE.Vector3(1, 1, 1))
  for (const s of [-1, 1]) add(c, BOX, S.wire, B.clone().multiply(local(0, 0.75, s * 0.28, 0.85, 0.45, 0.02)))
  add(c, BOX, S.wire, B.clone().multiply(local(0.42, 0.75, 0, 0.02, 0.45, 0.56)))
  add(c, BOX, S.wire, B.clone().multiply(local(-0.42, 0.75, 0, 0.02, 0.45, 0.56)))
  add(c, BOX, S.wire, B.clone().multiply(local(0, 0.53, 0, 0.85, 0.02, 0.56)))
  add(c, BOX, S.orange, B.clone().multiply(local(-0.55, 1.0, 0, 0.04, 0.04, 0.6)))
  for (const sx of [-0.35, 0.35]) for (const sz of [-0.25, 0.25]) add(c, BOX, c.M.black, B.clone().multiply(local(sx, 0.08, sz, 0.08, 0.1, 0.03)))
  solidArea(c, x - 0.5, x + 0.5, z - 0.5, z + 0.5)
}

/** A hospital: a block of white wards with ribbon windows, the A&E entrance under its canopy, ambulances, a field tent. */
export function hospital(c: Ctx, b: Box2) {
  const S = siteMats(c)
  const { r } = c
  const cx = (b.x0 + b.x1) / 2
  const i = 7
  const x0 = b.x0 + 2
  const x1 = b.x1 - 2
  const z0 = b.z0 + i + 6
  const z1 = b.z1 - 2
  const floors = 5
  const fh = 3.5
  const H = floors * fh + 1.2
  ub(c, S.render, cx, H / 2, (z0 + z1) / 2, x1 - x0, H, z1 - z0)
  footprint(c, new THREE.Matrix4(), x0, x1, z0, z1)
  proxy(c, local(cx, c.y0 + H / 2, (z0 + z1) / 2, x1 - x0, H, z1 - z0))
  // ribbon windows round all four sides, a lit ward now and then; the dark bands between
  const sides: [number, number, number, number, number][] = [
    [cx, z0 - 0.02, x1 - x0, Math.PI, 0],
    [cx, z1 + 0.02, x1 - x0, 0, 0],
    [x0 - 0.02, (z0 + z1) / 2, z1 - z0, -Math.PI / 2, 1],
    [x1 + 0.02, (z0 + z1) / 2, z1 - z0, Math.PI / 2, 1],
  ]
  for (const [px, pz, len, ry] of sides)
    for (let f = 0; f < floors; f++) {
      const y = c.y0 + 1.6 + f * fh
      for (let x = -len / 2 + 1.2; x < len / 2 - 1; x += 2.4) {
        const ux = Math.cos(ry)
        const uz = -Math.sin(ry)
        const B = local(px + ux * x, y, pz + uz * x, 1, 1, 1, ry)
        if (f > 0 && r() < 0.12) c.I.room.add(B, local(0, 0, 0.01, 2.2, 1.4, 1), new THREE.Color(0.75, 0.85, 0.95))
        else c.I.glass.add(B, local(0, 0, 0.01, 2.2, 1.4, 1))
      }
      add(c, BOX, c.M.darkMetal, local(px, y + 1.05, pz, Math.abs(Math.cos(ry)) * len + 0.1, 0.08, Math.abs(Math.sin(ry)) * len + 0.1))
    }
  // the sign on the roof, the A&E canopy and its sign, ambulances, stretchers, the military tent, sandbags
  const hT = signTex('ST KHERVE HOSPITAL', '#005eb8', '#ffffff', 1024, 128, 'bold 76px Helvetica, Arial, sans-serif')
  let hm = c.signs.get('hosp')
  if (!hm) c.signs.set('hosp', (hm = c.own(new THREE.MeshStandardMaterial({ map: hT, emissive: 0xffffff, emissiveMap: hT, emissiveIntensity: 0.7 }))))
  add(c, PLANE, hm, local(cx, c.y0 + H + 1.1, z0 - 0.05, 18, 2.2, 1, Math.PI))
  const ax = cx + 8
  ub(c, c.M.paintWhite, ax, 3.6, z0 - 3.5, 10, 0.4, 7)
  for (const s of [-1, 1]) ub(c, c.M.paintWhite, ax + s * 4.6, 1.8, z0 - 6.6, 0.3, 3.6, 0.3)
  for (const s of [-1, 1]) solidArea(c, ax + s * 4.6 - 0.25, ax + s * 4.6 + 0.25, z0 - 6.85, z0 - 6.35)
  const aeT = signTex('A&E · EMERGENCY', '#b3201a', '#ffffff', 1024, 128, 'bold 80px Helvetica, Arial, sans-serif')
  let am = c.signs.get('ae')
  if (!am) c.signs.set('ae', (am = c.own(new THREE.MeshStandardMaterial({ map: aeT, emissive: 0xffffff, emissiveMap: aeT, emissiveIntensity: 1.2 }))))
  add(c, PLANE, am, local(ax, c.y0 + 3.6, z0 - 7.02, 9, 0.4, 1, Math.PI))
  c.I.shop.add(local(ax, c.y0, z0 - 0.03, 1, 1, 1, Math.PI), local(0, 1.4, 0, 4, 2.8, 1), new THREE.Color(0.6, 0.65, 0.7))
  c.lights.push({ p: new THREE.Vector3(ax, c.y0 + 3.2, z0 - 3.5), color: 0xffe8e0, power: 12, range: 18 })
  for (const k of [0, 1]) {
    const ambulance = makeCar('van', k ? 'abandoned' : 'parked', siteAmbulance(c), c.V, 400 + k)
    vehicle(c, ambulance, ax - 2.2 + k * 4.6, z0 - 4 - k * 0.6, Math.PI / 2 + (k ? 0.25 : 0))
  }
  for (let k = 0; k < 3; k++) {
    const sx = ax - 3 + k * 2.2
    const sz = z0 - 9 - r() * 2
    add(c, BOX, c.M.paintWhite, local(sx, c.y0 + 0.75, sz, 0.6, 0.08, 1.9, r() * 0.4))
    for (const dx of [-0.25, 0.25]) for (const dz of [-0.85, 0.85]) add(c, BOX, S.steel, local(sx + dx, c.y0 + 0.37, sz + dz, 0.03, 0.74, 0.03))
    solidArea(c, sx - 0.5, sx + 0.5, sz - 1.1, sz + 1.1)
  }
  c.supplies.push([ax, c.y0, z0 - 2])
  c.supplies.push([ax - 3, c.y0, z0 - 9])
  // the field tent (white, a red cross), on the west side of the forecourt
  const tx = b.x0 + 9
  const tz = b.z0 + 8
  const tent = once('tent', () => {
    const s = new THREE.Shape()
    s.moveTo(-3, 0)
    s.lineTo(3, 0)
    s.lineTo(3, 2)
    s.lineTo(0, 3.4)
    s.lineTo(-3, 2)
    s.lineTo(-3, 0)
    const g = new THREE.ExtrudeGeometry(s, { depth: 8, bevelEnabled: false })
    g.translate(0, 0, -4)
    return g
  })
  add(c, tent, S.canvas, local(tx, c.y0, tz, 1, 1, 1, Math.PI / 2))
  const cross = once('redcross', () => {
    const [cv, g] = canvas(128, 128)
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, 128, 128)
    g.fillStyle = '#c8102e'
    g.fillRect(48, 16, 32, 96)
    g.fillRect(16, 48, 96, 32)
    return texture(cv)
  })
  let cm = c.signs.get('redcross')
  if (!cm) c.signs.set('redcross', (cm = c.own(new THREE.MeshStandardMaterial({ map: cross, roughness: 0.9 }))))
  add(c, PLANE, cm, local(tx, c.y0 + 1.6, tz - 3.02, 1.4, 1.4, 1, Math.PI))
  solidArea(c, tx - 4.1, tx + 4.1, tz - 3.1, tz + 3.1)
  proxy(c, local(tx, c.y0 + 1.7, tz, 8, 3.4, 6))
  sandbags(c, b.x0 + 3, b.z0 + 2, b.x0 + 16, b.z0 + 2, 3)
  for (const [px, pz] of [[cx - 4, b.z0 + 2], [cx + 15, b.z0 + 3]]) jersey(c, px, pz, 0)
  // buildings face the side streets behind the hospital? no: its own walls go all the way round
  bin(c, x1 - 1, z0 - 1.5)
  bollard(c, ax - 5.5, z0 - 7.4)
  bollard(c, ax + 5.5, z0 - 7.4)
  rubbish(c, x0 + 2, z0 - 1.2)
}

function siteAmbulance(c: Ctx): THREE.Material {
  let m = c.signs.get('ambulance')
  if (!m) {
    const t = once('ambtex', () => {
      const [cv, g] = canvas(256, 128)
      g.fillStyle = '#f2f2ea'
      g.fillRect(0, 0, 256, 128)
      for (let x = 0; x < 256; x += 32) {
        g.fillStyle = (x / 32) % 2 ? '#1f5fbf' : '#e8d820'
        g.fillRect(x, 70, 32, 26)
      }
      g.fillStyle = '#1f5fbf'
      g.font = 'bold 26px Helvetica, Arial, sans-serif'
      g.fillText('AMBULANCE', 50, 50)
      return texture(cv)
    })
    c.signs.set('ambulance', (m = c.own(new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 }))))
  }
  return m
}

/** The town hall closing the end of Kherve Street: a portico of six columns, a pediment, a clock tower with a cupola. */
export function townHall(c: Ctx, x0: number, x1: number, z: number) {
  const S = siteMats(c)
  const { M } = c
  const W = x1 - x0
  const cx = (x0 + x1) / 2
  const B = local(x1, c.y0, z, 1, 1, 1, Math.PI)
  building(c, B, W, 'office', 3, { depth: 22 })
  // the portico in front: a podium with steps, six columns, the entablature and pediment
  const pw = 16
  const pd = 5
  for (let k = 0; k < 4; k++) ub(c, M.stone, cx, 0.15 + k * 0.3, z - pd - 1.2 + k * 0.4, pw + 2 - k * 0.3, 0.3, 1.2)
  ub(c, M.stone, cx, 0.6, z - pd / 2, pw + 1, 1.2, pd)
  for (let k = 0; k < 6; k++) {
    const px = cx - pw / 2 + 1 + (k * (pw - 2)) / 5
    add(c, once('column', () => new THREE.CylinderGeometry(0.42, 0.5, 1, 20)), M.stone, local(px, c.y0 + 1.2 + 4.6, z - pd + 0.8, 1, 9.2, 1))
    ub(c, M.stone, px, 1.35, z - pd + 0.8, 1.2, 0.3, 1.2)
    ub(c, M.stone, px, 10.55, z - pd + 0.8, 1.2, 0.3, 1.2)
  }
  ub(c, M.stone, cx, 11.3, z - pd / 2 + 0.3, pw + 0.4, 1.2, pd + 0.4)
  const ped = once('pediment', () => {
    const s = new THREE.Shape()
    s.moveTo(-pw / 2 - 0.2, 0)
    s.lineTo(pw / 2 + 0.2, 0)
    s.lineTo(0, 3.0)
    s.lineTo(-pw / 2 - 0.2, 0)
    const g = new THREE.ExtrudeGeometry(s, { depth: pd + 0.4, bevelEnabled: false })
    g.translate(0, 0, -(pd + 0.4) / 2)
    return g
  })
  add(c, ped, M.stone, local(cx, c.y0 + 11.9, z - pd / 2 + 0.3))
  const nameT = signTex('KHERVE CITY HALL', '#c2bba8', '#2a2a2a', 1024, 128, 'bold 82px Georgia, serif')
  let nm = c.signs.get('cityhall')
  if (!nm) c.signs.set('cityhall', (nm = c.own(new THREE.MeshStandardMaterial({ map: nameT, roughness: 0.8 }))))
  add(c, PLANE, nm, local(cx, c.y0 + 11.3, z - pd - 0.11, 12, 0.9, 1, Math.PI))
  solidArea(c, cx - pw / 2 - 1.2, cx + pw / 2 + 1.2, z - pd - 2, z)
  proxy(c, local(cx, c.y0 + 7, z - pd / 2, pw, 14, pd))
  // the clock tower behind the portico: lit faces, a cupola, a flagpole
  const tz = z + 6
  ub(c, M.stone, cx, 19, tz, 7, 38, 7)
  for (const [dx, dz, ry] of [[0, 3.53, 0], [0, -3.53, Math.PI], [3.53, 0, Math.PI / 2], [-3.53, 0, -Math.PI / 2]]) add(c, PLANE, S.clock, local(cx + dx, c.y0 + 30, tz + dz, 3.6, 3.6, 1, ry))
  ub(c, M.stone, cx, 38.4, tz, 7.8, 0.8, 7.8)
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    cy(c, M.stone, cx + Math.cos(a) * 2.4, 40.4, tz + Math.sin(a) * 2.4, 0.22, 3.2)
  }
  add(c, once('dome', () => new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)), c.M.lead, local(cx, c.y0 + 42, tz, 3, 3.2, 3))
  add(c, BOX, c.M.gold, local(cx, c.y0 + 46, tz, 0.08, 2.4, 0.08))
}

/** The military checkpoint that closes Station Road at the west end: containers, sandbags, wire, a floodlight, the truck. */
export function checkpoint(c: Ctx, x: number, z0: number, z1: number) {
  const S = siteMats(c)
  const { r } = c
  // two rows of containers across the road, two high, a gap filled with wire and Jersey blocks
  for (let z = z0 + 1.3; z < z1 - 1; z += 2.5) {
    container(c, x - 2, z, Math.PI / 2, 0, Math.floor(r() * 5))
    if (r() < 0.7) container(c, x - 2, z, Math.PI / 2, 1, Math.floor(r() * 5))
  }
  for (let z = z0 + 2; z < z1 - 2; z += 3.2) jersey(c, x + 6, z, Math.PI / 2)
  razorWire(c, x + 3.5, z0 + 1, x + 3.5, z1 - 1)
  sandbags(c, x + 9, z0 + 8, x + 9, z0 + 14, 4)
  sandbags(c, x + 9, z1 - 14, x + 9, z1 - 8, 4)
  // a watch tower of scaffolding with a floodlight, aimed into the city
  const tx = x + 1
  const tz = (z0 + z1) / 2
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(c, BOX, S.steel, local(tx + sx, c.y0 + 3.5, tz + sz * 1.2 + 6, 0.08, 7, 0.08))
  ub(c, S.plywood, tx, 6.2, tz + 6, 2.4, 0.12, 2.8)
  sandbags(c, tx - 1.2, tz + 4.8, tx + 1.2, tz + 4.8, 2)
  add(c, BOX, c.M.lampOn, local(tx + 1.1, c.y0 + 7.2, tz + 6, 0.2, 0.5, 0.7))
  c.lights.push({ p: new THREE.Vector3(tx + 2, c.y0 + 7, tz + 6), color: 0xf4f8ff, power: 40, range: 40 })
  // the signs
  board(c, 'MILITARY CHECKPOINT · NO ENTRY', '#b3201a', '#ffffff', x + 4.5, 2.2, z0 + 6, 4.4, 0.8, Math.PI / 2, 0.3, true)
  board(c, 'QUARANTINE ZONE · STAY INDOORS', '#f0c419', '#111111', x + 4.5, 2.2, z1 - 6, 4.4, 0.8, Math.PI / 2, 0.2, true)
  // the army truck, the sentry box, the dead floodlight on its trailer
  const truck = local(x + 13, c.y0, (z0 + z1) / 2 - 3, 1, 1, 1, 0.2)
  const army = S.green
  add(c, BOX, army, truck.clone().multiply(local(-2.3, 1.5, 0, 2.2, 2.2, 2.4)))
  add(c, BOX, c.M.glassPane, truck.clone().multiply(local(-3.42, 1.9, 0, 0.04, 0.8, 2.0)))
  add(c, BOX, army, truck.clone().multiply(local(1.6, 1.2, 0, 5.4, 0.3, 2.5)))
  add(c, once('truckhood', () => new THREE.CylinderGeometry(1.3, 1.3, 5.2, 12, 1, true, 0, Math.PI).rotateZ(Math.PI / 2)), S.canvas, truck.clone().multiply(local(1.6, 2.0, 0, 1, 1, 1)))
  for (const wx of [-2.6, 0.6, 2.8]) for (const s of [-1, 1]) add(c, once('twheel', () => new THREE.CylinderGeometry(0.55, 0.55, 0.4, 14).rotateX(Math.PI / 2)), c.V.tyre, truck.clone().multiply(local(wx, 0.55, s * 1.15)))
  solidArea(c, x + 9.2, x + 16.8, (z0 + z1) / 2 - 5.2, (z0 + z1) / 2 - 0.8)
  proxy(c, truck.clone().multiply(local(0, 1.5, 0, 7.5, 3, 2.5)))
  ub(c, army, x + 8, 1.3, z1 - 3, 1.4, 2.6, 1.4)
  solidArea(c, x + 7.2, x + 8.8, z1 - 3.8, z1 - 2.2)
  for (let k = 0; k < 5; k++) cone(c, x + 11 + k * 1.3, z0 + 4 + (k % 2) * 0.5, r() < 0.3)
  c.supplies.push([x + 11, c.y0, (z0 + z1) / 2 + 3])
  c.supplies.push([x + 10, c.y0, z1 - 5])
}
