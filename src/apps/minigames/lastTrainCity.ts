// Last Train: the street above the station, behind the chained gates. A
// London street at night after it all went wrong: the station's oxblood
// faience front with its arched windows; terraces of stock brick over shops
// (fascias, shutters, smashed glass), red-brick mansion blocks, a Portland
// stone office, a warehouse, a glass tower; windows set in real reveals with
// sash frames, stone sills and lintels, a few still lit; chimneys, cornices,
// drainpipes. The road: worn asphalt with cracks, patches and puddles that
// shine, kerbs, double yellow lines, a zebra crossing with Belisha beacons,
// manholes and drains; paving slabs. Cars, a black cab, a police car and a
// bus, left where they stopped (lastTrainVehicles.ts). Lamp posts, phone
// boxes, a pillar box, a bus shelter, bollards, bins, bare plane trees,
// rubbish, burning barrels; the night sky over the rooftops and the moon.
//
// Everything that does not move is merged by material at the end (a few
// dozen draw calls); windows and frames are instanced; bullets hit simple
// invisible boxes. Textures are drawn once and kept for every station.

import * as THREE from 'three'
import { AVENUE, canvas, concrete, FINAL_STATION, grime, LANDING, rng, sprite, STAIRS, stationAt, STREET, texture, wallTexture, words } from './lastTrainWorld'
import { makeBus, makeCar, merge, paint, vehicleMats, type CarKind, type CarState, type Vehicle, type VehicleMats } from './lastTrainVehicles'

interface Block {
  x0: number
  x1: number
  z0: number
  z1: number
}
type Own = <T extends { dispose(): void }>(x: T) => T

export interface StreetBuild {
  /** All of it (hidden while the player is down on the platform, where none of it can be seen). */
  group: THREE.Group
  /** The burning barrels' light (it flickers). */
  fire: THREE.PointLight
  /** The moon's light: on only while the player is out there (it would light the station too). */
  moon: THREE.DirectionalLight
  /** Every frame: blinking hazards and beacons, flames, smoke. */
  update(t: number): void
}

export interface StreetCtx {
  group: THREE.Group
  solids: THREE.Object3D[]
  blocks: Block[]
  own: Own
  index: number
}

/** The colour the night fades to in the street (the engine blends the fog to it out there). */
export const NIGHT_FOG = 0x14161c

const Y = new THREE.Vector3(0, 1, 0)
const BOX = new THREE.BoxGeometry(1, 1, 1)
const PLANE = new THREE.PlaneGeometry(1, 1)
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16)

// ---------------------------------------------------------------- textures (drawn once, kept)

const kept = new Map<string, unknown>()
function once<T>(key: string, make: () => T): T {
  if (!kept.has(key)) kept.set(key, make())
  return kept.get(key) as T
}

/** A texture whose UVs are metres: it repeats every `m` metres (or m × n). */
function metres<T extends THREE.Texture>(t: T, w: number, h = w): T {
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / w, 1 / h)
  return t
}

interface Surface {
  map: THREE.Texture
  bump?: THREE.Texture
  rough?: THREE.Texture
}

/** Worn asphalt, 8 m square: aggregate, patches of newer tarmac, cracks, oil, puddles (smooth in the roughness map). */
function asphalt(): Surface {
  return once('asphalt', () => {
    const S = 1024
    const [c, g] = canvas(S, S)
    const [rc, rg] = canvas(S, S)
    const [bc, bg] = canvas(S, S)
    const r = rng(41)
    g.fillStyle = '#2e2f31'
    g.fillRect(0, 0, S, S)
    rg.fillStyle = 'rgb(220,220,220)'
    rg.fillRect(0, 0, S, S)
    bg.fillStyle = '#808080'
    bg.fillRect(0, 0, S, S)
    for (let i = 0; i < 70000; i++) {
      const v = r()
      const k = (150 + r() * 70) | 0
      g.fillStyle = v < 0.55 ? `rgba(0,0,0,${0.12 + r() * 0.3})` : `rgba(${k},${k},${k - 6},${0.06 + r() * 0.16})`
      const s = 1 + r() * 2
      g.fillRect(r() * S, r() * S, s, s)
      if (i % 4 === 0) {
        bg.fillStyle = r() < 0.5 ? '#6a6a6a' : '#999'
        bg.fillRect(r() * S, r() * S, s, s)
      }
    }
    for (let i = 0; i < 6; i++) {
      const x = r() * S
      const y = r() * S
      const w = 90 + r() * 280
      const h = 60 + r() * 220
      g.fillStyle = r() < 0.5 ? 'rgba(12,12,13,0.38)' : 'rgba(70,70,70,0.22)'
      g.fillRect(x, y, w, h)
      bg.strokeStyle = '#555'
      bg.lineWidth = 3
      bg.strokeRect(x, y, w, h)
      g.strokeStyle = 'rgba(0,0,0,0.5)'
      g.strokeRect(x, y, w, h)
    }
    for (let i = 0; i < 30; i++) {
      let x = r() * S
      let y = r() * S
      const a0 = r() * Math.PI * 2
      const lw = 1 + r() * 1.6
      g.strokeStyle = 'rgba(6,6,6,0.85)'
      bg.strokeStyle = '#262626'
      g.lineWidth = lw
      bg.lineWidth = lw + 1
      g.beginPath()
      bg.beginPath()
      g.moveTo(x, y)
      bg.moveTo(x, y)
      const n = 10 + r() * 24
      for (let k = 0; k < n; k++) {
        x += Math.cos(a0 + (r() - 0.5) * 1.7) * (6 + r() * 12)
        y += Math.sin(a0 + (r() - 0.5) * 1.7) * (6 + r() * 12)
        g.lineTo(x, y)
        bg.lineTo(x, y)
      }
      g.stroke()
      bg.stroke()
    }
    for (let i = 0; i < 10; i++) {
      const x = r() * S
      const y = r() * S
      const rad = 20 + r() * 60
      const grad = g.createRadialGradient(x, y, 0, x, y, rad)
      grad.addColorStop(0, `rgba(5,5,8,${0.3 + r() * 0.3})`)
      grad.addColorStop(1, 'rgba(5,5,8,0)')
      g.fillStyle = grad
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
    // puddles: a few overlapping blobs, darker and smooth
    for (let i = 0; i < 9; i++) {
      const x = r() * S
      const y = r() * S
      for (let k = 0; k < 6; k++) {
        const px = x + (r() - 0.5) * 120
        const py = y + (r() - 0.5) * 60
        const rx = 25 + r() * 70
        const ry = 15 + r() * 40
        rg.fillStyle = 'rgb(60,60,60)'
        rg.beginPath()
        rg.ellipse(px, py, rx, ry, r() * 3, 0, Math.PI * 2)
        rg.fill()
        g.fillStyle = 'rgba(0,0,0,0.22)'
        g.beginPath()
        g.ellipse(px, py, rx, ry, r() * 3, 0, Math.PI * 2)
        g.fill()
      }
    }
    return { map: metres(texture(c), 8), rough: metres(texture(rc, undefined, false), 8), bump: metres(texture(bc, undefined, false), 8) }
  })
}

/** Paving slabs, 1.8 m square: nine 0.6 m slabs, stained, chewing gum, a cracked one. */
function paving(): Surface {
  return once('paving', () => {
    const S = 512
    const [c, g] = canvas(S, S)
    const [bc, bg] = canvas(S, S)
    const [rc, rg] = canvas(S, S)
    const r = rng(52)
    g.fillStyle = '#4c4a45'
    g.fillRect(0, 0, S, S)
    bg.fillStyle = '#000'
    bg.fillRect(0, 0, S, S)
    rg.fillStyle = 'rgb(225,225,225)'
    rg.fillRect(0, 0, S, S)
    const n = 3
    const s = S / n
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = 0.86 + r() * 0.22
        const k = (v * 120) | 0
        g.fillStyle = `rgb(${k + 8},${k + 5},${k})`
        g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6)
        for (let p = 0; p < 900; p++) {
          g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${r() * 0.18})` : `rgba(255,255,255,${r() * 0.08})`
          g.fillRect(i * s + 3 + r() * (s - 6), j * s + 3 + r() * (s - 6), 1.5, 1.5)
        }
        bg.fillStyle = '#c8c8c8'
        bg.fillRect(i * s + 4, j * s + 4, s - 8, s - 8)
        if (r() < 0.15) {
          g.strokeStyle = 'rgba(10,10,10,0.7)'
          bg.strokeStyle = '#333'
          g.lineWidth = bg.lineWidth = 2
          g.beginPath()
          bg.beginPath()
          const x0 = i * s + r() * s
          g.moveTo(x0, j * s)
          bg.moveTo(x0, j * s)
          g.lineTo(i * s + r() * s, j * s + s)
          bg.lineTo(i * s + r() * s, j * s + s)
          g.stroke()
          bg.stroke()
        }
      }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(200,200,190,${0.3 + r() * 0.3})`
      g.beginPath()
      g.arc(r() * S, r() * S, 2 + r() * 3, 0, Math.PI * 2)
      g.fill()
    }
    for (let i = 0; i < 4; i++) {
      const x = r() * S
      const y = r() * S
      rg.fillStyle = 'rgb(110,110,110)'
      rg.beginPath()
      rg.ellipse(x, y, 30 + r() * 50, 20 + r() * 30, r() * 3, 0, Math.PI * 2)
      rg.fill()
    }
    grime(g, S, S, r, 0.5)
    return { map: metres(texture(c), 1.8), bump: metres(texture(bc, undefined, false), 1.8), rough: metres(texture(rc, undefined, false), 1.8) }
  })
}

/** Large stone blocks in courses, 2.4 m square: Portland stone with black weathering, or granite. */
function ashlar(key: string, base: string, dirt: number, cols: number, rows: number, covers: number): Surface {
  return once(key, () => {
    const S = 512
    const [c, g] = canvas(S, S)
    const [bc, bg] = canvas(S, S)
    const r = rng(key.length * 31)
    g.fillStyle = '#8f897b'
    g.fillRect(0, 0, S, S)
    bg.fillStyle = '#000'
    bg.fillRect(0, 0, S, S)
    const bw = S / cols
    const bh = S / rows
    for (let j = 0; j < rows; j++)
      for (let i = -1; i <= cols; i++) {
        const x = i * bw + (j % 2 ? bw / 2 : 0)
        const y = j * bh
        const col = new THREE.Color(base).multiplyScalar(0.9 + r() * 0.16)
        g.fillStyle = '#' + col.getHexString()
        g.fillRect(x + 2, y + 2, bw - 4, bh - 4)
        for (let p = 0; p < 500; p++) {
          g.fillStyle = r() < 0.5 ? `rgba(60,55,45,${r() * 0.14})` : `rgba(255,250,235,${r() * 0.1})`
          g.fillRect(x + r() * bw, y + r() * bh, 1.5, 1.5)
        }
        bg.fillStyle = '#d0d0d0'
        bg.fillRect(x + 3, y + 3, bw - 6, bh - 6)
      }
    grime(g, S, S, r, dirt)
    return { map: metres(texture(c), covers), bump: metres(texture(bc, undefined, false), covers) }
  })
}

/** Painted stucco over a rusticated ground floor: cream, flaking, grimy; grooves every 0.45 m. */
function stucco(): Surface {
  return once('stucco', () => {
    const S = 512
    const [c, g] = canvas(S, S)
    const [bc, bg] = canvas(S, S)
    const r = rng(63)
    g.fillStyle = '#cbc2aa'
    g.fillRect(0, 0, S, S)
    bg.fillStyle = '#c0c0c0'
    bg.fillRect(0, 0, S, S)
    for (let i = 0; i < 300; i++) {
      const x = r() * S
      const y = r() * S
      const rad = 5 + r() * 30
      const grad = g.createRadialGradient(x, y, 0, x, y, rad)
      grad.addColorStop(0, r() < 0.7 ? `rgba(150,140,115,${r() * 0.25})` : `rgba(250,245,230,${r() * 0.2})`)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = grad
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
    // flaking paint: patches of grey render beneath
    for (let i = 0; i < 12; i++) {
      g.fillStyle = 'rgba(120,118,110,0.55)'
      g.beginPath()
      const x = r() * S
      const y = r() * S
      g.moveTo(x, y)
      for (let k = 0; k < 7; k++) g.lineTo(x + (r() - 0.5) * 50, y + (r() - 0.5) * 40)
      g.fill()
    }
    const step = S / 6.67
    for (let y = step; y < S; y += step) {
      g.fillStyle = 'rgba(60,55,45,0.55)'
      g.fillRect(0, y - 2, S, 4)
      bg.fillStyle = '#202020'
      bg.fillRect(0, y - 3, S, 6)
    }
    grime(g, S, S, r, 1.1)
    return { map: metres(texture(c), 3), bump: metres(texture(bc, undefined, false), 3) }
  })
}

/** Brick (wallTexture's): its 512 px cover four bricks by eight courses, 0.9 × 0.6 m. */
function brick(key: string, base: string): Surface {
  return once('brick' + key, () => {
    const t = wallTexture('brick', base, key.length * 13 + 5, 1.1)
    return { map: metres(t.map, 0.9, 0.6), bump: metres(t.bump, 0.9, 0.6) }
  })
}

/** The station's glazed oxblood faience: square blocks 0.4 m. */
function faience(): Surface {
  return once('faience', () => {
    const t = wallTexture('square', '#7a1b16', 17, 0.35)
    return { map: metres(t.map, 1.6), bump: metres(t.bump, 1.6) }
  })
}

/** A lit room seen from the street: warm light, a lampshade, curtains drawn half across, a sofa's back. */
function roomTex(): THREE.CanvasTexture {
  return once('room', () => {
    const [c, g] = canvas(128, 192)
    const grad = g.createLinearGradient(0, 0, 0, 192)
    grad.addColorStop(0, '#5a3a1e')
    grad.addColorStop(0.35, '#e0a85a')
    grad.addColorStop(1, '#7a4a22')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 192)
    const lamp = g.createRadialGradient(64, 40, 2, 64, 40, 70)
    lamp.addColorStop(0, 'rgba(255,240,200,0.95)')
    lamp.addColorStop(1, 'rgba(255,200,120,0)')
    g.fillStyle = lamp
    g.fillRect(0, 0, 128, 192)
    g.fillStyle = '#c87a3a'
    g.beginPath()
    g.moveTo(52, 30)
    g.lineTo(76, 30)
    g.lineTo(82, 46)
    g.lineTo(46, 46)
    g.fill()
    g.fillStyle = '#3a2412'
    g.fillRect(20, 140, 88, 52)
    g.fillStyle = '#2a1a10'
    g.fillRect(84, 70, 22, 30)
    for (const [x, w] of [[0, 34], [94, 34]]) {
      const cg = g.createLinearGradient(x, 0, x + w, 0)
      cg.addColorStop(0, '#6a2a22')
      cg.addColorStop(0.5, '#8a3a2c')
      cg.addColorStop(1, '#5a2018')
      g.fillStyle = cg
      g.fillRect(x, 0, w, 192)
      g.strokeStyle = 'rgba(0,0,0,0.25)'
      for (let k = x + 5; k < x + w; k += 7) {
        g.beginPath()
        g.moveTo(k, 0)
        g.lineTo(k, 192)
        g.stroke()
      }
    }
    return texture(c)
  })
}

/** A shop still lit inside: strip lights, shelves of goods, a counter. */
function shopTex(): THREE.CanvasTexture {
  return once('shop', () => {
    const [c, g] = canvas(256, 160)
    g.fillStyle = '#d8dcd6'
    g.fillRect(0, 0, 256, 160)
    g.fillStyle = '#fff'
    for (const x of [30, 140]) g.fillRect(x, 6, 80, 5)
    const r = rng(8)
    const cols = ['#c0392b', '#2e86c1', '#f1c40f', '#27ae60', '#8e44ad', '#e67e22', '#ecf0f1']
    for (let row = 0; row < 4; row++) {
      g.fillStyle = '#8a8f8c'
      g.fillRect(0, 36 + row * 26, 256, 3)
      for (let x = 2; x < 254; x += 6 + r() * 8) {
        g.fillStyle = cols[Math.floor(r() * cols.length)]
        const h = 10 + r() * 12
        g.fillRect(x, 36 + row * 26 - h, 4 + r() * 6, h)
      }
    }
    g.fillStyle = '#5a4030'
    g.fillRect(150, 120, 106, 40)
    g.fillStyle = '#9a9c98'
    g.fillRect(0, 140, 256, 20)
    return texture(c)
  })
}

/** An office floor at night: ceiling panels, the cold light, desks and partitions. */
function officeTex(): THREE.CanvasTexture {
  return once('office', () => {
    const [c, g] = canvas(256, 128)
    const grad = g.createLinearGradient(0, 0, 0, 128)
    grad.addColorStop(0, '#c9d6dc')
    grad.addColorStop(0.5, '#8a9aa2')
    grad.addColorStop(1, '#3a4448')
    g.fillStyle = grad
    g.fillRect(0, 0, 256, 128)
    g.fillStyle = '#f4fbff'
    for (let x = 8; x < 256; x += 42) g.fillRect(x, 6, 26, 6)
    g.fillStyle = '#2a3236'
    for (let x = 0; x < 256; x += 64) {
      g.fillRect(x + 6, 78, 50, 26)
      g.fillStyle = '#1a2024'
      g.fillRect(x + 20, 64, 16, 12)
      g.fillStyle = '#2a3236'
    }
    return texture(c)
  })
}

/** A roller shutter pulled down: corrugated steel, rust, tags. */
function shutterTex(): THREE.CanvasTexture {
  return once('shutter', () => {
    const [c, g] = canvas(256, 256)
    const r = rng(19)
    for (let y = 0; y < 256; y += 8) {
      const grad = g.createLinearGradient(0, y, 0, y + 8)
      grad.addColorStop(0, '#8a8d8f')
      grad.addColorStop(0.5, '#b4b7b8')
      grad.addColorStop(1, '#5e6163')
      g.fillStyle = grad
      g.fillRect(0, y, 256, 8)
    }
    grime(g, 256, 256, r, 1.2)
    const tags = ['#d9232d', '#1d1d1d', '#2a7ad9', '#f5f5f5', '#30b04a']
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = tags[Math.floor(r() * tags.length)]
      g.lineWidth = 4 + r() * 5
      g.lineCap = 'round'
      g.beginPath()
      let x = 20 + r() * 200
      let y = 60 + r() * 150
      g.moveTo(x, y)
      for (let k = 0; k < 8; k++) {
        x += (r() - 0.4) * 40
        y += (r() - 0.5) * 40
        g.quadraticCurveTo(x + (r() - 0.5) * 30, y - 20, x, y)
      }
      g.stroke()
    }
    return texture(c)
  })
}

/** Plywood nailed over a window, a spray-painted cross. */
function boardTex(): THREE.CanvasTexture {
  return once('board', () => {
    const [c, g] = canvas(128, 192)
    const r = rng(23)
    g.fillStyle = '#9e8455'
    g.fillRect(0, 0, 128, 192)
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = `rgba(90,62,30,${r() * 0.35})`
      g.beginPath()
      const y = r() * 192
      g.moveTo(0, y)
      g.bezierCurveTo(40, y + (r() - 0.5) * 10, 90, y + (r() - 0.5) * 10, 128, y)
      g.stroke()
    }
    g.fillStyle = 'rgba(0,0,0,0.4)'
    g.fillRect(0, 95, 128, 2)
    grime(g, 128, 192, r, 0.8)
    g.strokeStyle = 'rgba(200,20,20,0.85)'
    g.lineWidth = 7
    g.beginPath()
    g.moveTo(20, 30)
    g.lineTo(108, 160)
    g.moveTo(108, 30)
    g.lineTo(20, 160)
    g.stroke()
    return texture(c)
  })
}

function soft(): THREE.CanvasTexture {
  return once('soft', () => sprite('soft'))
}

/** A pool of lamplight on the ground. */
function poolTex(): THREE.CanvasTexture {
  return once('pool', () => {
    const [c, g] = canvas(256, 256)
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.4, 'rgba(255,255,255,0.35)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 256, 256)
    return texture(c)
  })
}

/** A manhole cover (cast iron, a chequered pattern) or a gully grate. */
function ironTex(kind: 'manhole' | 'grate'): THREE.CanvasTexture {
  return once(kind, () => {
    const [c, g] = canvas(128, 128)
    if (kind === 'manhole') {
      g.fillStyle = '#1e1e1f'
      g.beginPath()
      g.arc(64, 64, 62, 0, Math.PI * 2)
      g.fill()
      g.save()
      g.beginPath()
      g.arc(64, 64, 54, 0, Math.PI * 2)
      g.clip()
      for (let x = 0; x < 128; x += 8)
        for (let y = 0; y < 128; y += 8) {
          g.fillStyle = (x + y) % 16 ? '#3a3a3a' : '#2a2a2a'
          g.fillRect(x + 1, y + 1, 6, 6)
        }
      g.restore()
      g.strokeStyle = '#555'
      g.lineWidth = 3
      g.beginPath()
      g.arc(64, 64, 58, 0, Math.PI * 2)
      g.stroke()
    } else {
      g.fillStyle = '#262626'
      g.fillRect(4, 24, 120, 80)
      g.fillStyle = '#050505'
      for (let x = 12; x < 116; x += 12) g.fillRect(x, 32, 6, 64)
    }
    return texture(c)
  })
}

/** The sky over the rooftops: black overhead, an orange glow of fires and the dead city on the horizon, clouds, stars. */
function skyTex(): THREE.CanvasTexture {
  return once('sky', () => {
    const W = 2048
    const H = 512
    const [c, g] = canvas(W, H)
    const r = rng(5)
    const grad = g.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, '#020306')
    grad.addColorStop(0.45, '#070a12')
    grad.addColorStop(0.75, '#141620')
    grad.addColorStop(0.9, '#2a221e')
    grad.addColorStop(1, '#3a2a20')
    g.fillStyle = grad
    g.fillRect(0, 0, W, H)
    for (let i = 0; i < 900; i++) {
      const y = r() * H * 0.6
      g.fillStyle = `rgba(230,235,255,${(0.2 + r() * 0.7) * (1 - y / (H * 0.6))})`
      const s = r() < 0.05 ? 2 : 1
      g.fillRect(r() * W, y, s, s)
    }
    for (let i = 0; i < 70; i++) {
      const x = r() * W
      const y = H * (0.3 + r() * 0.55)
      const rx = 80 + r() * 260
      const ry = 12 + r() * 40
      const low = y / H
      const cg = g.createRadialGradient(x, y, 0, x, y, rx)
      cg.addColorStop(0, `rgba(${(30 + low * 60) | 0},${(28 + low * 34) | 0},${(32 + low * 20) | 0},${0.35 + r() * 0.3})`)
      cg.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = cg
      g.save()
      g.translate(x, y)
      g.scale(1, ry / rx)
      g.translate(-x, -y)
      g.fillRect(x - rx, y - rx, rx * 2, rx * 2)
      g.restore()
    }
    // a column of smoke far off, lit from beneath
    for (const sx of [W * 0.3, W * 0.72]) {
      for (let k = 0; k < 40; k++) {
        const y = H - k * 9
        const x = sx + Math.sin(k * 0.25) * 30 + k * 4
        const rad = 30 + k * 2.5
        const sg = g.createRadialGradient(x, y, 0, x, y, rad)
        sg.addColorStop(0, `rgba(${80 - k},${45 - k * 0.6},${30 - k * 0.4},${0.25 - k * 0.005})`)
        sg.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = sg
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
      }
    }
    return texture(c)
  })
}

/** What the street reflects (puddles, paint, glass): the night sky above, the dark of the city below, a glow of fire and lamps at the horizon. */
function nightEnv(): THREE.CanvasTexture {
  return once('nightEnv', () => {
    const [c, g] = canvas(1024, 512)
    g.drawImage(skyTex().image as HTMLCanvasElement, 0, 0, 1024, 256)
    const grad = g.createLinearGradient(0, 256, 0, 512)
    grad.addColorStop(0, '#2a2420')
    grad.addColorStop(0.08, '#0d0d0f')
    grad.addColorStop(1, '#050506')
    g.fillStyle = grad
    g.fillRect(0, 256, 1024, 256)
    // windows and lamps around the horizon
    const r = rng(12)
    for (let i = 0; i < 120; i++) {
      g.fillStyle = r() < 0.6 ? 'rgba(255,190,110,0.8)' : 'rgba(200,220,255,0.6)'
      g.fillRect(r() * 1024, 240 + r() * 40, 2 + r() * 3, 2 + r() * 4)
    }
    const t = texture(c)
    t.mapping = THREE.EquirectangularReflectionMapping
    return t
  })
}

/** Plane-tree bark: olive, cream and grey flakes. */
function barkTex(): THREE.CanvasTexture {
  return once('bark', () => {
    const [c, g] = canvas(128, 256)
    const r = rng(33)
    g.fillStyle = '#6d6a55'
    g.fillRect(0, 0, 128, 256)
    for (let i = 0; i < 160; i++) {
      g.fillStyle = ['#a8a07a', '#c9c3a6', '#4c4a3a', '#8a8a6a'][Math.floor(r() * 4)]
      g.beginPath()
      const x = r() * 128
      const y = r() * 256
      g.ellipse(x, y, 4 + r() * 12, 6 + r() * 18, r() * 3, 0, Math.PI * 2)
      g.fill()
    }
    const t = texture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    return t
  })
}

/** The black and white bands of a Belisha beacon's pole. */
function stripesTex(): THREE.CanvasTexture {
  return once('stripes', () => {
    const [c, g] = canvas(16, 128)
    for (let y = 0; y < 128; y += 16) {
      g.fillStyle = (y / 16) % 2 ? '#f0f0ea' : '#111'
      g.fillRect(0, y, 16, 16)
    }
    return texture(c)
  })
}

/** A K6 telephone kiosk's side: red glazing bars, panes faintly lit, the TELEPHONE sign. `glow`: only what shines. */
function kioskTex(glow: boolean): THREE.CanvasTexture {
  return once('kiosk' + glow, () => {
    const [c, g] = canvas(128, 384)
    g.fillStyle = glow ? '#000' : '#a3150f'
    g.fillRect(0, 0, 128, 384)
    g.fillStyle = glow ? '#fff' : '#f4f1e2'
    g.fillRect(14, 8, 100, 26)
    g.fillStyle = glow ? '#000' : '#111'
    g.font = 'bold 15px Helvetica, Arial, sans-serif'
    g.textAlign = 'center'
    g.fillText('TELEPHONE', 64, 27)
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 3; col++) {
        g.fillStyle = glow ? 'rgba(255,230,170,0.5)' : '#c8c2a0'
        g.fillRect(18 + col * 32, 50 + row * 38, 26, 32)
      }
    if (!glow) grime(g, 128, 384, rng(3), 0.6)
    return texture(c)
  })
}

// ---------------------------------------------------------------- geometry helpers

/** A box whose UVs are in metres on every face. */
function uvBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  const uv = g.attributes.uv as THREE.BufferAttribute
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]
  for (let f = 0; f < 6; f++)
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1])
    }
  return g
}

interface Hole {
  x: number
  y: number
  w: number
  h: number
  /** A round head over the opening (its radius is w/2, the head ends at y + h). */
  arch?: boolean
}

/** A wall W × H with openings, `t` thick, its face at z = 0 (the reveals of the openings are real). */
function facadeGeo(W: number, y0: number, H: number, holes: Hole[], t = 0.3): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(0, y0)
  s.lineTo(W, y0)
  s.lineTo(W, H)
  s.lineTo(0, H)
  s.lineTo(0, y0)
  for (const h of holes) {
    const p = new THREE.Path()
    const top = h.arch ? h.y + h.h - h.w / 2 : h.y + h.h
    p.moveTo(h.x, h.y)
    p.lineTo(h.x, top)
    if (h.arch) p.absarc(h.x + h.w / 2, top, h.w / 2, Math.PI, 0, true)
    else p.lineTo(h.x + h.w, top)
    p.lineTo(h.x + h.w, h.y)
    p.lineTo(h.x, h.y)
    s.holes.push(p)
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 10 })
  g.translate(0, 0, -t)
  return g
}

/** A glazed opening with a round head: 1 wide, a 1 m tall rectangle under a half-circle (so 1.5 tall). */
const ARCH = (() => {
  const s = new THREE.Shape()
  s.moveTo(-0.5, 0)
  s.lineTo(0.5, 0)
  s.lineTo(0.5, 1)
  s.absarc(0, 1, 0.5, 0, Math.PI, false)
  s.lineTo(-0.5, 0)
  return new THREE.ShapeGeometry(s, 12)
})()

function local(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Y, ry), new THREE.Vector3(sx, sy, sz))
}

/** Instances gathered while the street is laid out, made into one InstancedMesh at the end. */
class Batch {
  private list: { m: THREE.Matrix4; c: THREE.Color | null }[] = []
  readonly geo: THREE.BufferGeometry
  readonly mat: THREE.Material
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material) {
    this.geo = geo
    this.mat = mat
  }
  add(B: THREE.Matrix4, l: THREE.Matrix4, c: THREE.Color | null = null) {
    this.list.push({ m: B.clone().multiply(l), c })
  }
  build(parent: THREE.Object3D) {
    if (!this.list.length) return
    const im = new THREE.InstancedMesh(this.geo, this.mat, this.list.length)
    const white = new THREE.Color(1, 1, 1)
    const colours = this.list.some((x) => x.c)
    this.list.forEach((x, i) => {
      im.setMatrixAt(i, x.m)
      if (colours) im.setColorAt(i, x.c ?? white)
    })
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
    im.userData.keep = true
    parent.add(im)
  }
}

// ---------------------------------------------------------------- the street

type Style = 'terrace' | 'mansion' | 'office' | 'warehouse' | 'modern'

interface Mats {
  brick: THREE.Material[]
  stone: THREE.Material
  granite: THREE.Material
  stucco: THREE.Material
  faience: THREE.Material
  concrete: THREE.Material
  paintWhite: THREE.Material
  darkMetal: THREE.Material
  lead: THREE.Material
  pots: THREE.Material
  pavement: THREE.Material
  road: THREE.Material
  white: THREE.Material
  yellow: THREE.Material
  pole: THREE.Material
  lampOn: THREE.Material
  lampOff: THREE.Material
  red: THREE.Material
  black: THREE.Material
  gold: THREE.Material
  bark: THREE.Material
  glassPane: THREE.Material
  bag: THREE.Material
  cardboard: THREE.Material
  barrel: THREE.Material
  sandbag: THREE.Material
  beacon: THREE.MeshStandardMaterial
  stripes: THREE.Material
  kiosk: THREE.Material
  manhole: THREE.Material
  grate: THREE.Material
  poolWarm: THREE.Material
  poolWhite: THREE.Material
  proxy: THREE.Material
}

interface Ctx {
  g: THREE.Group
  own: Own
  solids: THREE.Object3D[]
  blocks: Block[]
  r: () => number
  M: Mats
  V: VehicleMats
  y0: number
  index: number
  /** Instanced: dark glass, lit rooms, lit shops, shutters, boards, arched glass, white and dark frames, stone dressings, pipes. */
  I: Record<'glass' | 'room' | 'shop' | 'office' | 'shutter' | 'board' | 'arch' | 'archLit' | 'frameW' | 'frameD' | 'dress' | 'pipe', Batch>
  signs: Map<string, THREE.Material>
}

const SHOPS: [string, string, string][] = [
  ['NEWS & WINE', '#1b3f6b', '#ffffff'], ['CHEMIST', '#0d6b4a', '#ffffff'], ['CAFÉ', '#3a2418', '#f2d9a6'], ['LAUNDERETTE', '#e8e4d8', '#1b4f8a'],
  ['FISH & CHIPS', '#0f3c78', '#f6d23a'], ['BOOKS', '#22301f', '#e8d9a8'], ['BARBER', '#141414', '#e8e8e8'], ['OFF LICENCE', '#6a1010', '#f5e6c8'],
  ['BAKERY', '#e9dcc0', '#6a3a1a'], ['PHONE REPAIR', '#f0c419', '#111111'], ['DRY CLEANERS', '#ffffff', '#c0392b'], ['THE RED LION', '#173a2a', '#d9b45a'],
  ['KHERVE BOOKS', '#0f2a1c', '#2fbf71'], ['GROCER', '#2a5a1e', '#ffffff'], ['HARDWARE', '#3a3a3a', '#ffcc33'], ['PIZZA', '#b31d17', '#ffffff'],
]

function signMat(c: Ctx, name: string, bg: string, fg: string): THREE.Material {
  let m = c.signs.get(name)
  if (!m) {
    const t = once('sign' + name, () => words(name, 768, 112, bg, fg, `bold 70px ${name.startsWith('THE') ? 'Georgia, serif' : 'Helvetica, Arial, sans-serif'}`))
    m = c.own(new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: c.r() < 0.3 ? 0.5 : 0.04 }))
    c.signs.set(name, m)
  }
  return m
}

function add(c: Ctx, geo: THREE.BufferGeometry, mat: THREE.Material, M: THREE.Matrix4): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.applyMatrix4(M)
  c.g.add(m)
  return m
}

/** An invisible box that bullets hit (the real thing is merged into one big mesh). */
function proxy(c: Ctx, M: THREE.Matrix4) {
  const m = new THREE.Mesh(BOX, c.M.proxy)
  m.applyMatrix4(M)
  m.visible = false
  m.userData.keep = true
  c.g.add(m)
  c.solids.push(m)
}

/** One window: glass (dark, lit, broken or boarded), its frame, sill and lintel. */
function windowAt(c: Ctx, B: THREE.Matrix4, h: Hole, frame: 'W' | 'D', dress: 'brick' | 'stone' | 'none', lit = 0.16) {
  const { r, I } = c
  const cx = h.x + h.w / 2
  const cy = h.y + h.h / 2
  const roll = r()
  if (h.arch) {
    if (roll < lit) I.archLit.add(B, local(cx, h.y, -0.2, h.w, h.w, 1), new THREE.Color().setHSL(0.09, 0.6, 0.55 + r() * 0.2))
    else I.arch.add(B, local(cx, h.y, -0.2, h.w, h.w, 1), roll > 0.9 ? new THREE.Color(0, 0, 0) : new THREE.Color().setScalar(0.7 + r() * 0.5))
  } else if (roll < lit) I.room.add(B, local(cx, cy, -0.2, h.w, h.h, 1), new THREE.Color().setHSL(0.07 + r() * 0.06, 0.4 + r() * 0.4, 0.45 + r() * 0.3))
  else if (roll < lit + 0.08) I.board.add(B, local(cx, cy, 0.02, h.w + 0.12, h.h + 0.12, 1))
  else I.glass.add(B, local(cx, cy, -0.2, h.w, h.h, 1), roll > 0.9 ? new THREE.Color(0, 0, 0) : new THREE.Color().setScalar(0.6 + r() * 0.6))
  // the frame: sides, head, sill rail, the meeting rail and a glazing bar (sash windows)
  const F = frame === 'W' ? I.frameW : I.frameD
  const z = -0.17
  const top = h.arch ? h.y + h.h - h.w / 2 : h.y + h.h
  F.add(B, local(h.x + 0.035, (h.y + top) / 2, z, 0.07, top - h.y, 0.06))
  F.add(B, local(h.x + h.w - 0.035, (h.y + top) / 2, z, 0.07, top - h.y, 0.06))
  F.add(B, local(cx, h.y + 0.04, z, h.w, 0.08, 0.07))
  if (!h.arch) {
    F.add(B, local(cx, top - 0.035, z, h.w, 0.07, 0.06))
    if (frame === 'W') {
      F.add(B, local(cx, cy, z + 0.01, h.w, 0.06, 0.07))
      F.add(B, local(cx, cy, z, 0.035, h.h, 0.04))
    } else F.add(B, local(cx, h.y + h.h * 0.7, z, h.w, 0.05, 0.05))
  } else F.add(B, local(cx, top, z, h.w, 0.05, 0.05))
  if (dress !== 'none') {
    I.dress.add(B, local(cx, h.y - 0.04, 0.06, h.w + 0.18, 0.08, 0.18))
    if (dress === 'brick' && !h.arch) I.dress.add(B, local(cx, h.y + h.h + 0.11, 0.015, h.w + 0.26, 0.22, 0.03))
    if (h.arch) I.dress.add(B, local(cx, h.y + h.h + 0.02, 0.03, 0.24, 0.34, 0.06))
  }
}

/**
 * A building of the street. Its face is local z = 0, its front along local x from 0 to W, standing on y = 0
 * (B places it). `body`: give it depth and a roof (not over the station, whose halls are behind).
 */
function building(c: Ctx, B: THREE.Matrix4, W: number, style: Style, floors: number, body = true) {
  const { r, M, I } = c
  if (style === 'modern') return tower(c, B, W, floors, body)
  const P = {
    terrace: { floorH: 3.15, ground: 4.0, bay: 2.6, ww: 1.05, wh: 1.9, wall: M.brick[r() < 0.6 ? 0 : 1], shops: true, frame: 'W' as const, dress: 'brick' as const, arch: false },
    mansion: { floorH: 3.1, ground: 4.2, bay: 3.0, ww: 1.25, wh: 2.0, wall: M.brick[2], shops: true, frame: 'W' as const, dress: 'stone' as const, arch: false },
    office: { floorH: 3.6, ground: 4.8, bay: 3.2, ww: 1.7, wh: 2.3, wall: M.stone, shops: false, frame: 'D' as const, dress: 'none' as const, arch: false },
    warehouse: { floorH: 3.8, ground: 4.4, bay: 3.4, ww: 1.6, wh: 2.4, wall: M.brick[3], shops: false, frame: 'D' as const, dress: 'stone' as const, arch: true },
  }[style]
  const H = P.ground + P.floorH * floors + 1.1
  const nB = Math.max(1, Math.floor(W / P.bay))
  const m0 = (W - nB * P.bay) / 2
  // upper floors: a window per bay
  const holes: Hole[] = []
  for (let f = 0; f < floors; f++)
    for (let b = 0; b < nB; b++) {
      const top = f === floors - 1 && style === 'terrace'
      const wh = top ? P.wh * 0.78 : P.wh
      const x = m0 + b * P.bay + (P.bay - P.ww) / 2
      holes.push({ x, y: P.ground + f * P.floorH + 0.85, w: P.ww, h: wh, arch: P.arch })
    }
  add(c, facadeGeo(W, P.ground, H, holes), P.wall, B)
  for (const h of holes) windowAt(c, B, h, P.frame, P.dress)
  // the ground floor: shops, or offices behind tall windows, or loading doors
  const gHoles: Hole[] = []
  const groundMat = style === 'office' ? M.granite : style === 'warehouse' ? P.wall : M.stucco
  if (P.shops) {
    for (let b = 0; b < nB; b += 2) {
      const x0 = m0 + b * P.bay
      const x1 = Math.min(W - m0, x0 + P.bay * Math.min(2, nB - b))
      const shop = { x: x0 + 0.4, y: 0.55, w: x1 - x0 - 1.85, h: 2.5 }
      const door = { x: x1 - 1.3, y: 0.02, w: 0.95, h: 2.35 }
      gHoles.push(shop, door)
      const [name, bg, fg] = SHOPS[Math.floor(r() * SHOPS.length)]
      const state = r()
      if (state < 0.3) {
        // shutters down over the window and the door
        I.shutter.add(B, local(shop.x + shop.w / 2, shop.y + shop.h / 2, 0.03, shop.w + 0.1, shop.h + 0.1, 1))
        I.shutter.add(B, local(door.x + door.w / 2, door.h / 2, 0.03, door.w + 0.08, door.h + 0.05, 1))
      } else {
        if (state < 0.55) I.shop.add(B, local(shop.x + shop.w / 2, shop.y + shop.h / 2, -0.22, shop.w, shop.h, 1), new THREE.Color().setScalar(0.65 + r() * 0.35))
        else I.glass.add(B, local(shop.x + shop.w / 2, shop.y + shop.h / 2, -0.22, shop.w, shop.h, 1), new THREE.Color().setScalar(state > 0.85 ? 0 : 0.8))
        I.glass.add(B, local(door.x + door.w / 2, door.h / 2, -0.22, door.w, door.h, 1))
        I.frameD.add(B, local(shop.x + shop.w / 2, shop.y + 0.05, -0.18, shop.w, 0.1, 0.08))
        I.frameD.add(B, local(shop.x + shop.w / 2, shop.y + shop.h - 0.5, -0.18, shop.w, 0.06, 0.06))
        for (let x = shop.x + 1.3; x < shop.x + shop.w - 0.4; x += 1.3) I.frameD.add(B, local(x, shop.y + shop.h / 2, -0.18, 0.06, shop.h, 0.06))
      }
      // the shop's pilasters, its fascia and the name on it, the shutter box
      add(c, BOX, groundMat, B.clone().multiply(local(x0 + 0.17, 1.8, 0.07, 0.34, 3.6, 0.16)))
      add(c, BOX, groundMat, B.clone().multiply(local(x1 - 0.17, 1.8, 0.07, 0.34, 3.6, 0.16)))
      add(c, BOX, M.darkMetal, B.clone().multiply(local((x0 + x1) / 2, 3.25, 0.06, x1 - x0 - 0.5, 0.18, 0.12)))
      add(c, PLANE, signMat(c, name, bg, fg), B.clone().multiply(local((x0 + x1) / 2, 3.68, 0.17, x1 - x0 - 0.6, 0.6, 1)))
      add(c, BOX, M.black, B.clone().multiply(local((x0 + x1) / 2, 3.68, 0.08, x1 - x0 - 0.45, 0.72, 0.16)))
    }
  } else if (style === 'office') {
    const mid = Math.floor(nB / 2)
    for (let b = 0; b < nB; b++) {
      const x = m0 + b * P.bay
      const h = b === mid ? { x: x + 0.5, y: 0.02, w: P.bay - 1, h: 3.4, arch: true } : { x: x + 0.45, y: 0.9, w: P.bay - 0.9, h: 2.9 }
      gHoles.push(h)
      if (b === mid) {
        I.archLit.add(B, local(x + P.bay / 2, 0, -0.25, h.w, h.w, 1), new THREE.Color(0.35, 0.35, 0.33))
        add(c, BOX, M.stone, B.clone().multiply(local(x + P.bay / 2, 3.65, 0.12, P.bay - 0.4, 0.35, 0.3)))
      } else windowAt(c, B, h, 'D', 'none', 0.1)
    }
  } else {
    // loading doors with their shutters, small windows between
    for (let b = 0; b < nB; b++) {
      const x = m0 + b * P.bay
      const h = b % 2 ? { x: x + 0.4, y: 0.02, w: P.bay - 0.8, h: 3.6 } : { x: x + (P.bay - P.ww) / 2, y: 1.0, w: P.ww, h: P.wh, arch: true }
      gHoles.push(h)
      if (b % 2) I.shutter.add(B, local(h.x + h.w / 2, h.h / 2, -0.12, h.w, h.h, 1))
      else windowAt(c, B, h, 'D', 'stone')
    }
  }
  add(c, facadeGeo(W, 0, P.ground, gHoles), groundMat, B)
  // string course, cornice, parapet coping
  add(c, BOX, M.stone, B.clone().multiply(local(W / 2, P.ground, 0.08, W, 0.22, 0.2)))
  if (style === 'mansion') for (let f = 1; f < floors; f++) add(c, BOX, M.stone, B.clone().multiply(local(W / 2, P.ground + f * P.floorH + 0.3, 0.04, W, 0.16, 0.1)))
  const corn = H - 1.1
  add(c, BOX, M.stone, B.clone().multiply(local(W / 2, corn, 0.15, W + 0.1, 0.3, 0.32)))
  add(c, BOX, M.stone, B.clone().multiply(local(W / 2, corn + 0.2, 0.26, W + 0.18, 0.12, 0.55)))
  add(c, BOX, M.stone, B.clone().multiply(local(W / 2, H + 0.05, -0.1, W + 0.04, 0.1, 0.42)))
  // drainpipes at the party walls, with their hoppers
  for (let b = 0; b <= nB; b += 2) {
    if (r() < 0.4) continue
    const x = Math.min(W - 0.15, Math.max(0.15, m0 + b * P.bay))
    I.pipe.add(B, local(x, (P.ground + corn) / 2, 0.08, 0.055, corn - P.ground, 0.055))
    add(c, BOX, M.lead, B.clone().multiply(local(x, corn - 0.25, 0.1, 0.22, 0.28, 0.2)))
  }
  if (!body) {
    // over the station: a roof slab behind the parapet and party walls at the ends (seen over a lower neighbour),
    // nothing that reaches down into the halls
    add(c, uvBox(W, 0.3, 6), P.wall, B.clone().multiply(local(W / 2, H - 0.6, -3.3)))
    for (const x of [0.15, W - 0.15]) add(c, uvBox(0.3, H - 9, 6), P.wall, B.clone().multiply(local(x, 9 + (H - 9) / 2, -3.3)))
    proxy(c, B.clone().multiply(local(W / 2, H / 2, -0.3, W, H, 0.6)))
    return
  }
  const D = 9 + r() * 4
  add(c, uvBox(W, H, D), P.wall, B.clone().multiply(local(W / 2, H / 2, -0.3 - D / 2)))
  proxy(c, B.clone().multiply(local(W / 2, H / 2, -0.3, W, H, 0.6)))
  // chimney stacks with their pots, on the party walls (terraces and mansion blocks)
  if (style === 'terrace' || style === 'mansion')
    for (let b = 0; b <= nB; b += 2) {
      const x = Math.min(W - 0.5, Math.max(0.5, m0 + b * P.bay))
      const sh = 1.6 + r() * 0.8
      add(c, uvBox(0.9, sh, 0.75), P.wall, B.clone().multiply(local(x, H + sh / 2, -1.8)))
      add(c, BOX, M.stone, B.clone().multiply(local(x, H + sh + 0.05, -1.8, 1.0, 0.1, 0.85)))
      for (let k = 0; k < 3; k++) add(c, CYL, M.pots, B.clone().multiply(local(x - 0.27 + k * 0.27, H + sh + 0.35, -1.8, 0.09, 0.55, 0.09)))
    }
}

/** A glass office tower: a curtain wall of panes and mullions, dark spandrels at each floor, a lit lobby, a sign on top. */
function tower(c: Ctx, B: THREE.Matrix4, W: number, floors: number, body: boolean) {
  const { r, M, I } = c
  const fh = 3.6
  const H = 4.8 + floors * fh + 0.8
  const D = body ? 12 : 0.6
  add(c, uvBox(W, H, D), M.concrete, B.clone().multiply(local(W / 2, H / 2, -D / 2 - 0.05)))
  const pitch = 1.5
  const n = Math.floor(W / pitch)
  const m0 = (W - n * pitch) / 2
  for (let f = 0; f < floors; f++) {
    const y = 4.8 + f * fh
    const lit = r() < 0.12
    for (let k = 0; k < n; k++) {
      const x = m0 + (k + 0.5) * pitch
      if (lit && r() < 0.8) I.office.add(B, local(x, y + fh * 0.55, 0.01, pitch, fh - 0.6, 1), new THREE.Color().setScalar(0.55 + r() * 0.2))
      else I.glass.add(B, local(x, y + fh * 0.55, 0.01, pitch, fh - 0.6, 1), r() < 0.06 ? new THREE.Color(0, 0, 0) : new THREE.Color().setScalar(0.9 + r() * 0.4))
    }
    add(c, BOX, M.darkMetal, B.clone().multiply(local(W / 2, y + 0.25, 0.04, W, 0.6, 0.1)))
  }
  for (let k = 0; k <= n; k++) I.frameD.add(B, local(m0 + k * pitch, 4.8 + (H - 5.6) / 2, 0.06, 0.07, H - 5.6, 0.12))
  // the lobby, its doors, a canopy
  for (let k = 0; k < n; k++) I.office.add(B, local(m0 + (k + 0.5) * pitch, 2.2, 0.01, pitch, 4.0, 1), new THREE.Color(0.4, 0.42, 0.42))
  add(c, BOX, M.darkMetal, B.clone().multiply(local(W / 2, 4.4, 0.6, W, 0.2, 1.4)))
  add(c, BOX, M.darkMetal, B.clone().multiply(local(W / 2, H - 0.4, 0.05, W + 0.1, 0.8, 0.2)))
  if (r() < 0.6) {
    const t = once('labs', () => words('KHERVE LABS', 1024, 160, '#000000', '#2fbf71', 'bold 110px Helvetica, Arial, sans-serif'))
    const m = c.own(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 2.2, transparent: true, alphaMap: t }))
    add(c, PLANE, m, B.clone().multiply(local(W / 2, H + 1.0, -0.4, Math.min(W - 2, 12), 1.9, 1)))
  }
  proxy(c, B.clone().multiply(local(W / 2, H / 2, -0.3, W, H, 0.6)))
}

/** The station: a two-storey front in oxblood faience, arched windows above, the entrances over the stairways, a roundel at each. */
function stationFront(c: Ctx, x0: number, x1: number) {
  const { M, I, y0 } = c
  const B = local(x0, y0, LANDING.endZ)
  const W = x1 - x0
  const H = 9.4
  const holes: Hole[] = []
  const entr = STAIRS.map((sx) => sx - x0)
  for (const ex of entr) holes.push({ x: ex - 2, y: 0.02, w: 4, h: 3.0 })
  // arched windows of the upper storey, every 4.5 m; tall shop windows below between the entrances
  for (let x = 2.25; x < W - 1; x += 4.5) {
    holes.push({ x: x - 1, y: 4.7, w: 2, h: 3 + 0, arch: true })
    if (entr.every((ex) => Math.abs(ex - x) > 3.4)) holes.push({ x: x - 1.3, y: 0.6, w: 2.6, h: 2.3 })
  }
  add(c, facadeGeo(W, 0, H, holes, 0.25), M.faience, B)
  for (const h of holes) {
    if (h.arch) windowAt(c, B, h, 'D', 'none', 0.12)
    else if (h.y > 0) {
      I.glass.add(B, local(h.x + h.w / 2, h.y + h.h / 2, -0.15, h.w, h.h, 1), new THREE.Color().setScalar(0.5))
      for (let k = 1; k < 4; k++) I.frameD.add(B, local(h.x + (h.w * k) / 4, h.y + h.h / 2, -0.1, 0.05, h.h, 0.05))
    }
  }
  // the fascia: the station's name in white on the faience, either side of each entrance; a cornice
  const st = stationAt(c.index)
  const nameT = once('stn' + st.name, () => words(`${st.name.toUpperCase()} STATION`, 1024, 128, '#5a120e', '#f4efe2', 'bold 72px Johnston, "Gill Sans", Helvetica, Arial, sans-serif'))
  const nameM = c.own(new THREE.MeshStandardMaterial({ map: nameT, roughness: 0.25 }))
  for (const ex of entr) add(c, PLANE, nameM, B.clone().multiply(local(ex, 3.55, 0.03, 7, 0.86, 1)))
  add(c, BOX, M.faience, B.clone().multiply(local(W / 2, 4.15, 0.1, W, 0.25, 0.22)))
  add(c, BOX, M.faience, B.clone().multiply(local(W / 2, H - 0.3, 0.18, W + 0.1, 0.5, 0.4)))
  add(c, BOX, M.faience, B.clone().multiply(local(W / 2, H + 0.05, -0.05, W + 0.04, 0.2, 0.5)))
  for (let x = 0; x <= W; x += 4.5) add(c, BOX, M.faience, B.clone().multiply(local(Math.min(W - 0.2, Math.max(0.2, x)), H / 2, 0.08, 0.4, H, 0.16)))
  add(c, uvBox(W, 0.3, 6), M.faience, B.clone().multiply(local(W / 2, H - 0.5, -3.2)))
  proxy(c, B.clone().multiply(local(W / 2, H / 2 + 1.5, -0.25, W, H - 3, 0.5)))
  // roundels: one flat over each entrance, one hung out from the wall on a bracket
  const rt = once('roundel' + st.color, () => {
    const [cv, g] = canvas(512, 512)
    g.clearRect(0, 0, 512, 512)
    g.strokeStyle = st.color
    g.lineWidth = 70
    g.beginPath()
    g.arc(256, 256, 190, 0, Math.PI * 2)
    g.stroke()
    g.fillStyle = '#10226e'
    g.fillRect(16, 206, 480, 100)
    g.fillStyle = '#fff'
    g.font = 'bold 76px Johnston, "Gill Sans", Helvetica, Arial, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('SUBWAY', 256, 260)
    return texture(cv)
  })
  const rm = c.own(new THREE.MeshStandardMaterial({ map: rt, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: rt, emissiveIntensity: 0.6 }))
  for (const ex of entr) {
    add(c, PLANE, rm, B.clone().multiply(local(ex, 4.35 + 0.1, 0.24, 1.3, 1.3, 1)))
    const bx = ex + 2.6
    add(c, BOX, M.darkMetal, B.clone().multiply(local(bx, 5.6, 0.45, 0.06, 0.06, 0.9)))
    add(c, PLANE, rm, B.clone().multiply(local(bx, 4.95, 0.75, 1.2, 1.2, 1, Math.PI / 2)))
  }
}

/** A street lamp: a tapered column, an arm out over the road, the lantern (lit or dead); returns the lantern's place. */
function lamp(c: Ctx, x: number, z: number, out: number, lit: boolean, lean = 0): THREE.Vector3 {
  const { M, y0 } = c
  const B = new THREE.Matrix4().compose(new THREE.Vector3(x, y0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, 0, 0)), new THREE.Vector3(1, 1, 1))
  const col = once('lampcol', () => new THREE.CylinderGeometry(0.06, 0.11, 7.6, 12))
  add(c, col, M.pole, B.clone().multiply(local(0, 3.8, 0)))
  add(c, CYL, M.pole, B.clone().multiply(local(0, 0.35, 0, 0.16, 0.7, 0.16)))
  const arm = new THREE.Matrix4().compose(new THREE.Vector3(0, 7.55, out * 0.55), new THREE.Quaternion().setFromEuler(new THREE.Euler(out * 1.35, 0, 0)), new THREE.Vector3(0.04, 1.2, 0.04))
  add(c, CYL, M.pole, B.clone().multiply(arm))
  add(c, BOX, M.pole, B.clone().multiply(local(0, 7.68, out * 1.15, 0.34, 0.12, 0.7)))
  add(c, BOX, lit ? M.lampOn : M.lampOff, B.clone().multiply(local(0, 7.6, out * 1.15, 0.28, 0.03, 0.6)))
  c.blocks.push({ x0: x - 0.18, x1: x + 0.18, z0: z - 0.18, z1: z + 0.18 })
  const at = new THREE.Vector3(x, y0 + 7.5, z + out * 1.15)
  if (lit) pool(c, x, z + out * 1.6, 7.5, c.M.poolWarm)
  return at
}

/** A soft pool of light laid on the ground. */
function pool(c: Ctx, x: number, z: number, rad: number, mat: THREE.Material, sx = 1) {
  const m = add(c, PLANE, mat, local(x, c.y0 + 0.03, z, rad * 2 * sx, rad * 2, 1))
  m.rotation.x = -Math.PI / 2
  m.updateMatrix()
}

function bollard(c: Ctx, x: number, z: number) {
  add(c, CYL, c.M.black, local(x, c.y0 + 0.5, z, 0.1, 1.0, 0.1))
  add(c, CYL, c.M.gold, local(x, c.y0 + 0.88, z, 0.105, 0.05, 0.105))
  add(c, once('cap', () => new THREE.SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), c.M.black, local(x, c.y0 + 1.0, z))
  c.blocks.push({ x0: x - 0.15, x1: x + 0.15, z0: z - 0.15, z1: z + 0.15 })
}

function bin(c: Ctx, x: number, z: number, down = false) {
  const M = down
    ? new THREE.Matrix4().compose(new THREE.Vector3(x, c.y0 + 0.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, c.r() * 3, 0)), new THREE.Vector3(0.3, 0.9, 0.3))
    : local(x, c.y0 + 0.45, z, 0.3, 0.9, 0.3)
  add(c, CYL, c.M.black, M)
  if (!down) add(c, CYL, c.M.gold, local(x, c.y0 + 0.78, z, 0.305, 0.06, 0.305))
  c.blocks.push({ x0: x - 0.35, x1: x + 0.35, z0: z - 0.35, z1: z + 0.35 })
}

/** A K6 telephone kiosk. */
function kiosk(c: Ctx, x: number, z: number, ry: number) {
  const B = local(x, c.y0, z, 1, 1, 1, ry)
  add(c, BOX, c.M.kiosk, B.clone().multiply(local(0, 1.3, 0, 0.92, 2.5, 0.92)))
  add(c, BOX, c.M.red, B.clone().multiply(local(0, 0.08, 0, 1.0, 0.16, 1.0)))
  add(c, BOX, c.M.red, B.clone().multiply(local(0, 2.6, 0, 1.02, 0.12, 1.02)))
  const dome = once('dome', () => new THREE.CylinderGeometry(0.5, 0.5, 1.0, 16, 1, false, 0, Math.PI))
  add(c, dome, c.M.red, B.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(0, 2.66, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new THREE.Vector3(0.4, 1.0, 1.0))))
  c.blocks.push({ x0: x - 0.6, x1: x + 0.6, z0: z - 0.6, z1: z + 0.6 })
  proxy(c, B.clone().multiply(local(0, 1.4, 0, 1, 2.8, 1)))
}

/** A pillar box: red, a domed cap, the slot, a white collection plate. */
function postbox(c: Ctx, x: number, z: number) {
  add(c, CYL, c.M.black, local(x, c.y0 + 0.08, z, 0.3, 0.16, 0.3))
  add(c, CYL, c.M.red, local(x, c.y0 + 0.75, z, 0.26, 1.2, 0.26))
  add(c, once('pcap', () => new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), c.M.red, local(x, c.y0 + 1.35, z, 1, 0.6, 1))
  add(c, CYL, c.M.red, local(x, c.y0 + 1.36, z, 0.3, 0.06, 0.3))
  add(c, BOX, c.M.black, local(x, c.y0 + 1.15, z - 0.25, 0.22, 0.04, 0.05))
  add(c, BOX, c.M.white, local(x, c.y0 + 0.8, z - 0.26, 0.16, 0.12, 0.01))
  c.blocks.push({ x0: x - 0.35, x1: x + 0.35, z0: z - 0.35, z1: z + 0.35 })
}

/** A bus shelter: a steel frame, glass back and ends (one smashed), a lit advert, a bench; the stop's flag. */
function shelter(c: Ctx, x: number, z: number) {
  const { M, y0 } = c
  const B = local(x, y0, z)
  const L = 3.6
  const D = 1.4
  for (const [px, pz] of [[-L / 2, -D / 2], [L / 2, -D / 2], [-L / 2, D / 2], [L / 2, D / 2]]) add(c, BOX, M.pole, B.clone().multiply(local(px, 1.25, pz, 0.07, 2.5, 0.07)))
  add(c, BOX, M.pole, B.clone().multiply(local(0, 2.52, 0, L + 0.2, 0.08, D + 0.2)))
  add(c, BOX, M.glassPane, B.clone().multiply(local(-0.45, 1.25, D / 2, L - 0.9, 2.3, 0.02)))
  add(c, BOX, M.glassPane, B.clone().multiply(local(-L / 2, 1.25, 0, 0.02, 2.3, D)))
  const ad = once('shelterad', () => words('KherveFitting · XPS made easy', 512, 760, '#0f2a1c', '#2fbf71', 'bold 46px Helvetica, Arial, sans-serif'))
  const adM = c.own(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: ad, emissiveIntensity: 0.9 }))
  add(c, BOX, M.pole, B.clone().multiply(local(L / 2, 1.25, 0, 0.12, 2.0, 1.1)))
  add(c, PLANE, adM, B.clone().multiply(local(L / 2 + 0.065, 1.25, 0, 1.0, 1.8, 1, Math.PI / 2)))
  add(c, BOX, M.darkMetal, B.clone().multiply(local(-0.3, 0.5, D / 2 - 0.25, 2.0, 0.06, 0.3)))
  add(c, CYL, M.pole, local(x - L / 2 - 1.4, y0 + 1.6, z - D / 2 - 0.2, 0.04, 3.2, 0.04))
  const stop = once('busstop', () => words('BUS STOP', 256, 128, '#c8102e', '#ffffff', 'bold 46px Helvetica, Arial, sans-serif'))
  add(c, BOX, c.own(new THREE.MeshStandardMaterial({ map: stop, roughness: 0.4 })), local(x - L / 2 - 1.4, y0 + 2.9, z - D / 2 - 0.2 + 0.25, 0.03, 0.4, 0.5))
  c.blocks.push({ x0: x - L / 2 - 0.1, x1: x + L / 2 + 0.1, z0: z - D / 2 - 0.1, z1: z + D / 2 + 0.1 })
  proxy(c, B.clone().multiply(local(0, 1.3, 0, L, 2.6, D)))
}

/** A bare London plane tree in a pit with its iron grate: branches split as they rise. */
function tree(c: Ctx, x: number, z: number, seed: number) {
  const geo = once('tree' + (seed % 3), () => {
    const r = rng(seed % 3 + 70)
    const parts: THREE.BufferGeometry[] = []
    const branch = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
      const to = from.clone().addScaledVector(dir, len)
      const g = new THREE.CylinderGeometry(rad * 0.7, rad, len, 7, 1)
      g.translate(0, len / 2, 0)
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, dir))
      g.translate(from.x, from.y, from.z)
      parts.push(g)
      if (depth === 0 || rad < 0.02) return
      const n = depth > 3 ? 2 : 2 + Math.floor(r() * 2)
      for (let k = 0; k < n; k++) {
        const d = dir.clone().add(new THREE.Vector3((r() - 0.5) * 1.3, r() * 0.4, (r() - 0.5) * 1.3)).normalize()
        branch(to, d, len * (0.68 + r() * 0.15), rad * 0.68, depth - 1)
      }
    }
    branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 3.6, 0.22, 5)
    return merge(parts)
  })
  add(c, geo, c.M.bark, local(x, c.y0, z, 1, 1, 1, c.r() * 6))
  add(c, PLANE, c.M.grate, new THREE.Matrix4().compose(new THREE.Vector3(x, c.y0 + 0.02, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new THREE.Vector3(1.4, 1.4, 1)))
  c.blocks.push({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 })
}

/** A Belisha beacon: a striped pole, the amber globe that blinks. */
function beacon(c: Ctx, x: number, z: number) {
  add(c, CYL, c.M.stripes, local(x, c.y0 + 1.3, z, 0.06, 2.6, 0.06))
  add(c, once('globe', () => new THREE.SphereGeometry(0.2, 16, 12)), c.M.beacon, local(x, c.y0 + 2.75, z))
  c.blocks.push({ x0: x - 0.12, x1: x + 0.12, z0: z - 0.12, z1: z + 0.12 })
}

/** Black bin bags heaped against a wall, a box or two. */
function rubbish(c: Ctx, x: number, z: number) {
  const bag = once('bag', () => new THREE.SphereGeometry(0.35, 12, 8))
  for (let k = 0; k < 3 + c.r() * 4; k++) {
    const px = x + (c.r() - 0.5) * 1.6
    const pz = z + (c.r() - 0.5) * 0.8
    add(c, bag, c.M.bag, new THREE.Matrix4().compose(new THREE.Vector3(px, c.y0 + 0.24, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(c.r(), c.r() * 6, c.r() * 0.4)), new THREE.Vector3(1, 0.7 + c.r() * 0.3, 0.9)))
  }
  if (c.r() < 0.7) add(c, BOX, c.M.cardboard, local(x + 0.9, c.y0 + 0.22, z + 0.2, 0.5, 0.44, 0.4, c.r() * 3))
}

/** Place a vehicle (centre, heading) and keep players and zombies out of its footprint. */
function vehicle(c: Ctx, v: Vehicle, x: number, z: number, heading: number, tilt = 0) {
  v.group.position.x = x
  v.group.position.z = z
  v.group.position.y += c.y0
  v.group.rotation.set(0, heading, tilt)
  c.g.add(v.group)
  const ca = Math.abs(Math.cos(heading))
  const sa = Math.abs(Math.sin(heading))
  const hx = (v.L / 2) * ca + (v.W / 2) * sa
  const hz = (v.L / 2) * sa + (v.W / 2) * ca
  c.blocks.push({ x0: x - hx + 0.1, x1: x + hx - 0.1, z0: z - hz + 0.1, z1: z + hz - 0.1 })
  proxy(c, new THREE.Matrix4().compose(new THREE.Vector3(x, c.y0 + v.H * 0.45, z), new THREE.Quaternion().setFromAxisAngle(Y, heading), new THREE.Vector3(v.L * 0.96, v.H * 0.85, v.W * 0.92)))
  if (v.lit) {
    const fx = Math.cos(heading)
    const fz = -Math.sin(heading)
    const m = add(c, PLANE, c.M.poolWhite, new THREE.Matrix4())
    m.position.set(x + fx * (v.L / 2 + 3.2), c.y0 + 0.035, z + fz * (v.L / 2 + 3.2))
    m.rotation.set(-Math.PI / 2, 0, heading)
    m.scale.set(6.5, 3.2, 1)
    m.updateMatrix()
  }
}

/** Merge every plain mesh of the group by material: one draw call per material. */
function mergeStatic(g: THREE.Group, own: Own) {
  g.updateMatrixWorld(true)
  const inv = g.matrixWorld.clone().invert()
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const drop: THREE.Object3D[] = []
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || m.userData.keep || Array.isArray(m.material)) return
    const geo = m.geometry.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld))
    const list = byMat.get(m.material as THREE.Material) ?? []
    list.push(geo)
    byMat.set(m.material as THREE.Material, list)
    drop.push(m)
  })
  for (const m of drop) m.removeFromParent()
  for (const o of [...g.children]) if (o.type === 'Group' && o.children.length === 0) o.removeFromParent()
  for (const [mat, list] of byMat) {
    const merged = own(merge(list))
    merged.computeBoundingSphere()
    for (const l of list) l.dispose()
    const mesh = new THREE.Mesh(merged, mat)
    mesh.matrixAutoUpdate = false
    g.add(mesh)
  }
}

export function buildStreet(sc: StreetCtx): StreetBuild {
  const { group, solids, blocks, own, index } = sc
  const g = new THREE.Group()
  group.add(g)
  const r = rng(4000 + index)
  const y0 = STREET.y
  const std = (o: THREE.MeshStandardMaterialParameters) => own(new THREE.MeshStandardMaterial(o))
  const surf = (s: Surface, rough: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    std({ map: s.map, bumpMap: s.bump, bumpScale: 1.2, roughnessMap: s.rough, roughness: rough, ...extra })
  const as = asphalt()
  const pv = paving()
  const M: Mats = {
    brick: [surf(brick('stock', '#9a8158'), 0.92), surf(brick('red', '#8a4532'), 0.9), surf(brick('mansion', '#a14a30'), 0.88), surf(brick('dark', '#4f3b32'), 0.95)],
    stone: surf(ashlar('portland', '#c2bba8', 1.4, 2, 4, 2.4), 0.85),
    granite: surf(ashlar('granite', '#6f6e6c', 0.5, 2, 3, 2.4), 0.6),
    stucco: surf(stucco(), 0.9),
    faience: own(new THREE.MeshPhysicalMaterial({ map: faience().map, bumpMap: faience().bump, bumpScale: 0.35, roughness: 0.3, clearcoat: 0.45, clearcoatRoughness: 0.2, envMapIntensity: 0.6 })),
    concrete: std({ map: once('conc', () => metres(concrete(91, '#6c6b67', 0.03), 4)), roughness: 0.9 }),
    paintWhite: std({ color: 0xe6e2d6, roughness: 0.6 }),
    darkMetal: std({ color: 0x1d2022, roughness: 0.5, metalness: 0.6 }),
    lead: std({ color: 0x2c2f31, roughness: 0.7, metalness: 0.4 }),
    pots: std({ color: 0x8a4a2e, roughness: 0.85 }),
    pavement: surf(pv, 1, { envMapIntensity: 0.6 }),
    road: surf(as, 1, { bumpScale: 0.8, envMapIntensity: 0.8 }),
    white: std({ color: 0xdcdcd4, roughness: 0.7 }),
    yellow: std({ color: 0xd8b622, roughness: 0.7 }),
    pole: std({ color: 0x2b2f31, roughness: 0.45, metalness: 0.7 }),
    lampOn: std({ color: 0x000000, emissive: 0xffd2a0, emissiveIntensity: 4 }),
    lampOff: std({ color: 0x3a3c3e, roughness: 0.2, metalness: 0.5 }),
    red: own(new THREE.MeshPhysicalMaterial({ color: 0xa3150f, roughness: 0.4, clearcoat: 0.6 })),
    black: std({ color: 0x0c0d0e, roughness: 0.45 }),
    gold: std({ color: 0xc9a043, roughness: 0.3, metalness: 1 }),
    bark: std({ map: barkTex(), roughness: 0.95 }),
    glassPane: own(new THREE.MeshPhysicalMaterial({ color: 0x9fb0b8, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false })),
    bag: std({ color: 0x0a0a0b, roughness: 0.25 }),
    cardboard: std({ color: 0x8a6a40, roughness: 0.95 }),
    barrel: std({ color: 0x3e2618, roughness: 0.8, metalness: 0.4 }),
    sandbag: std({ color: 0x7a6a4a, roughness: 1 }),
    beacon: std({ color: 0x6a3a08, emissive: 0xffa020, emissiveIntensity: 0, roughness: 0.2, transparent: true, opacity: 0.92 }),
    stripes: std({ map: stripesTex(), roughness: 0.5 }),
    kiosk: std({ map: kioskTex(false), emissive: 0xffffff, emissiveMap: kioskTex(true), emissiveIntensity: 0.45, roughness: 0.45 }),
    manhole: std({ map: ironTex('manhole'), roughness: 0.6, metalness: 0.5, transparent: true, alphaTest: 0.5 }),
    grate: std({ map: ironTex('grate'), roughness: 0.6, metalness: 0.5 }),
    poolWarm: own(new THREE.MeshBasicMaterial({ map: poolTex(), color: new THREE.Color(0.55, 0.38, 0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })),
    poolWhite: own(new THREE.MeshBasicMaterial({ map: poolTex(), color: new THREE.Color(0.4, 0.38, 0.33), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })),
    proxy: std({ visible: false }),
  }
  const V = vehicleMats(own)
  const glass = std({ color: 0x0f1418, roughness: 0.06, metalness: 0.85 })
  const lit = (map: THREE.Texture) => own(new THREE.MeshBasicMaterial({ map }))
  const I: Ctx['I'] = {
    glass: new Batch(PLANE, glass),
    room: new Batch(PLANE, lit(roomTex())),
    shop: new Batch(PLANE, lit(shopTex())),
    office: new Batch(PLANE, lit(officeTex())),
    shutter: new Batch(PLANE, std({ map: shutterTex(), roughness: 0.55, metalness: 0.5 })),
    board: new Batch(PLANE, std({ map: boardTex(), roughness: 0.9 })),
    arch: new Batch(ARCH, glass),
    archLit: new Batch(ARCH, lit(roomTex())),
    frameW: new Batch(BOX, M.paintWhite),
    frameD: new Batch(BOX, M.darkMetal),
    dress: new Batch(BOX, M.stone),
    pipe: new Batch(CYL, M.lead),
  }
  const c: Ctx = { g, own, solids, blocks, r, M, V, y0, index, I, signs: new Map() }

  // -- the ground: paving everywhere, the road and the avenue's road, kerbs, gutters, markings
  const xw0 = STREET.x0 - 2
  const xw1 = STREET.x1 + 2
  const xa1 = AVENUE.x1 + 60
  const ground = (x0: number, x1: number, z0: number, z1: number, mat: THREE.Material, dy: number) => {
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0)
    const uv = geo.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, x0 + uv.getX(i) * (x1 - x0), z0 + uv.getY(i) * (z1 - z0))
    const m = add(c, own(geo), mat, new THREE.Matrix4())
    m.rotation.x = -Math.PI / 2
    m.position.set((x0 + x1) / 2, y0 + dy, (z0 + z1) / 2)
    m.updateMatrix()
  }
  ground(xw0, xw1, LANDING.endZ, STREET.z1 + 2, M.pavement, 0)
  ground(xw1, xa1, AVENUE.z0 - 5, AVENUE.z1 + 5, M.pavement, 0)
  ground(xw0, xa1, 34.1, 45.9, M.road, 0.012)
  for (const z of [34.0, 46.0]) {
    add(c, uvBox(xa1 - xw0, 0.08, 0.3), M.granite, local((xw0 + xa1) / 2, y0 + 0.02, z))
    add(c, BOX, M.black, local((xw0 + xa1) / 2, y0 + 0.014, z + (z < 40 ? 0.35 : -0.35), xa1 - xw0, 0.004, 0.4)).material = std({ color: 0x15161a, roughness: 0.3 })
  }
  const zebra = -8
  const line = (x0: number, x1: number, z: number, w: number, mat: THREE.Material) => {
    const m = add(c, PLANE, mat, new THREE.Matrix4())
    m.rotation.x = -Math.PI / 2
    m.position.set((x0 + x1) / 2, y0 + 0.02, z)
    m.scale.set(x1 - x0, w, 1)
    m.updateMatrix()
  }
  // double yellow lines along both kerbs, broken at the crossing
  for (const [za, zb] of [[34.35, 34.5], [45.5, 45.65]])
    for (const [x0, x1] of [[xw0, zebra - 5], [zebra + 5, xa1]]) {
      line(x0, x1, za, 0.1, M.yellow)
      line(x0, x1, zb, 0.1, M.yellow)
    }
  // the centre line, dashed, and the zig-zags either side of the crossing
  for (let x = xw0; x < xa1; x += 6) if (Math.abs(x - zebra) > 6) line(x, x + 3, 40, 0.12, M.white)
  for (const s of [-1, 1])
    for (let k = 0; k < 8; k++) {
      const x = zebra + s * (2.4 + k * 1.1)
      for (const zz of [35.0, 45.0]) {
        const m = add(c, PLANE, M.white, new THREE.Matrix4())
        m.rotation.set(-Math.PI / 2, 0, (k % 2 ? 1 : -1) * 0.55)
        m.position.set(x, y0 + 0.02, zz)
        m.scale.set(1.2, 0.1, 1)
        m.updateMatrix()
      }
    }
  for (let z = 34.4; z < 45.6; z += 1.0) line(zebra - 1.4, zebra + 1.4, z + 0.25, 0.5, M.white)
  const lookT = once('look', () => words('LOOK RIGHT', 512, 128, 'rgba(0,0,0,0)', '#e8e8e0', 'bold 92px Helvetica, Arial, sans-serif'))
  const lookM = std({ map: lookT, transparent: true, roughness: 0.7 })
  for (const [zz, ry] of [[35.2, Math.PI], [44.8, 0]] as [number, number][]) {
    const m = add(c, PLANE, lookM, new THREE.Matrix4())
    m.rotation.set(-Math.PI / 2, 0, ry)
    m.position.set(zebra + 3.4, y0 + 0.021, zz)
    m.scale.set(2.4, 0.6, 1)
    m.updateMatrix()
  }
  for (const zz of [33.3, 46.7]) {
    beacon(c, zebra - 1.6, zz)
    beacon(c, zebra + 1.6, zz)
  }
  // manholes and gullies
  for (const [x, z] of [[-30, 38], [-2, 42.5], [15, 37], [33, 41.5], [64, 38.5], [90, 42], [-18, 52], [26, 28]]) {
    const m = add(c, PLANE, M.manhole, new THREE.Matrix4())
    m.rotation.x = -Math.PI / 2
    m.position.set(x, y0 + 0.025, z)
    m.scale.setScalar(0.9)
    m.updateMatrix()
  }
  for (let x = -44; x < xa1; x += 11)
    for (const z of [34.4, 45.6]) {
      const m = add(c, PLANE, M.grate, new THREE.Matrix4())
      m.rotation.x = -Math.PI / 2
      m.position.set(x, y0 + 0.022, z)
      m.scale.set(0.6, 0.4, 1)
      m.updateMatrix()
    }

  // -- the buildings: the station's front and its neighbours, the far side, both ends, the avenue
  const styles: Style[] = ['terrace', 'terrace', 'mansion', 'office', 'warehouse', 'terrace', 'modern', 'mansion']
  const floorsOf = (s: Style) => (s === 'terrace' ? 2 + Math.floor(r() * 2) : s === 'mansion' ? 4 + Math.floor(r() * 2) : s === 'office' ? 4 + Math.floor(r() * 3) : s === 'warehouse' ? 3 + Math.floor(r() * 2) : 6 + Math.floor(r() * 4))
  const row = (from: number, to: number, place: (a: number, w: number) => THREE.Matrix4, body = true, pick?: () => Style) => {
    let a = from
    while (a < to - 4) {
      const s = pick ? pick() : styles[Math.floor(r() * styles.length)]
      let w = s === 'terrace' ? 10.4 + Math.floor(r() * 2) * 5.2 : s === 'modern' ? 15 + r() * 6 : 12 + r() * 8
      if (to - (a + w) < 6) w = to - a
      building(c, place(a, w), w, s, floorsOf(s), body)
      a += w
    }
  }
  const sx0 = STAIRS[0] - 7
  const sx1 = STAIRS[1] + 7
  stationFront(c, sx0, sx1)
  // either side of the station: terraces over shops (fronts only: the station's halls are behind)
  row(xw0, sx0, (a) => local(a, y0, LANDING.endZ), false, () => 'terrace')
  row(sx1, xw1, (a) => local(a, y0, LANDING.endZ), false, () => (r() < 0.5 ? 'terrace' : 'mansion'))
  // the far side, facing the station
  row(xw0, xw1, (a, w) => local(a + w, y0, STREET.z1 + 1.5, 1, 1, 1, Math.PI))
  // the west end, facing east; the east end, facing west, open where the avenue leaves
  row(LANDING.endZ, STREET.z1 + 1.5, (a, w) => local(xw0, y0, a + w, 1, 1, 1, Math.PI / 2))
  row(LANDING.endZ, AVENUE.z0 - 1.2, (a) => local(xw1, y0, a, 1, 1, 1, -Math.PI / 2))
  row(AVENUE.z1 + 1.2, STREET.z1 + 1.5, (a) => local(xw1, y0, a, 1, 1, 1, -Math.PI / 2))
  // the avenue: both sides, into the haze
  row(xw1 + 13.5, xa1, (a) => local(a, y0, AVENUE.z0 - 1.2))
  row(xw1 + 13.5, xa1, (a, w) => local(a + w, y0, AVENUE.z1 + 1.2, 1, 1, 1, Math.PI))

  // -- street furniture
  const lamps: THREE.Vector3[] = []
  for (let x = -40; x <= 40; x += 16) {
    lamps.push(lamp(c, x, 33.4, 1, r() < 0.65))
    if (x + 8 < STREET.x1) lamps.push(lamp(c, x + 8, 46.6, -1, r() < 0.55, x === -8 ? 0.12 : 0))
  }
  for (let x = xw1 + 10; x < xa1; x += 16) lamp(c, x, 33.85, 1, r() < 0.35)
  for (const sx of STAIRS) {
    for (const d of [-3.4, -2.6, 2.6, 3.4]) bollard(c, sx + d, LANDING.endZ + 1.0)
    bin(c, sx + 5.2, 33.0)
  }
  kiosk(c, -13.0, 49.0, Math.PI)
  kiosk(c, -11.8, 49.0, Math.PI)
  postbox(c, 7.5, 32.9)
  shelter(c, 15.5, 48.4)
  bin(c, 21.5, 47.3, true)
  bin(c, -36, 33.1)
  for (const [x, z] of [[-40, 51], [-26, 51.5], [30, 51.5], [42, 51], [-36, 30.2], [36, 30.2]]) tree(c, x, z, Math.round(x * 7 + z))
  for (const [x, z] of [[-44, 59], [-6, 60], [24, 59.5], [44, 28], [-45, 25.5], [5, 24.6], [74, AVENUE.z1 + 0.9]]) rubbish(c, x, z)
  // sandbags and a crowd barrier knocked over by an entrance
  for (let k = 0; k < 7; k++) add(c, once('sandbag', () => new THREE.BoxGeometry(0.62, 0.22, 0.36)), M.sandbag, local(STAIRS[1] + 3.2 + (k % 4) * 0.62, y0 + 0.11 + Math.floor(k / 4) * 0.22, 25.0, 1, 1, 1, (r() - 0.5) * 0.2))
  c.blocks.push({ x0: STAIRS[1] + 2.8, x1: STAIRS[1] + 5.9, z0: 24.7, z1: 25.3 })
  {
    const bar = new THREE.Matrix4().compose(new THREE.Vector3(STAIRS[0] - 4.5, y0 + 0.25, 27.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.15, 0.6, 0)), new THREE.Vector3(1, 1, 1))
    add(c, BOX, M.pole, bar.clone().multiply(local(0, 0, 0, 2.3, 0.05, 1.1)))
    for (let k = -5; k <= 5; k++) add(c, BOX, M.pole, bar.clone().multiply(local(k * 0.2, 0.02, 0, 0.025, 0.04, 1.0)))
  }

  // -- vehicles, left where they stopped
  const palette = [0xa7abb0, 0x111316, 0xd6d7d8, 0x1b2a4a, 0x6e1010, 0x55595d, 0x22352a, 0x8f8470, 0x2f3e57, 0x7a7d80]
  const car = (kind: CarKind, state: CarState, x: number, z: number, heading: number, color?: number) => {
    const col = kind === 'cab' ? 0x0c0c0d : kind === 'police' ? 0xe9eaea : kind === 'van' ? 0xdcdcda : (color ?? palette[Math.floor(r() * palette.length)])
    vehicle(c, makeCar(kind, state, paint(own, col, 0.3 + r() * 0.5), V, Math.floor(r() * 1e6)), x, z, heading)
  }
  const kinds: CarKind[] = ['hatch', 'saloon', 'estate', 'suv', 'hatch', 'saloon', 'van']
  const pickKind = () => kinds[Math.floor(r() * kinds.length)]
  const pickState = (): CarState => (r() < 0.45 ? 'parked' : r() < 0.7 ? 'abandoned' : r() < 0.85 ? 'smashed' : 'burnt')
  // parked along the kerbs (none in front of the entrances, nor on the crossing)
  for (let x = -44; x < 46; x += 6.2 + r() * 3) {
    if (Math.abs(x - zebra) < 7 || STAIRS.some((sx) => Math.abs(x - sx) < 6)) continue
    if (r() < 0.35) continue
    car(pickKind(), pickState(), x, 35.25, r() < 0.5 ? 0 : Math.PI)
  }
  for (let x = -18; x < 46; x += 6.2 + r() * 3) {
    if (Math.abs(x - zebra) < 7 || Math.abs(x - 15.5) < 3.5 || r() < 0.3) continue
    car(pickKind(), pickState(), x, 44.75, r() < 0.5 ? 0 : Math.PI)
  }
  // in the lanes: stopped at angles, doors left open, a black cab, the police
  car('cab', 'abandoned', -14.5, 38.2, 0.25)
  car('police', 'abandoned', 28.5, 37.6, Math.PI + 0.55)
  car(pickKind(), 'smashed', 6.5, 42.2, -0.4)
  car(pickKind(), 'burnt', 0.8, 38.0, 0.95)
  car(pickKind(), 'abandoned', 39.5, 41.5, Math.PI - 0.2)
  car(pickKind(), 'parked', -36.5, 38.7, 0.1)
  for (let x = xw1 + 14; x < xa1 - 6; x += 9 + r() * 10) car(pickKind(), pickState(), x, 37 + r() * 6, (r() - 0.5) * 0.8 + (r() < 0.5 ? 0 : Math.PI))
  // the bus, slewed across the far lane into a lamp post
  vehicle(c, makeBus(V, true), -30, 43.3, -0.08)

  // -- fires: the barrels, and the burnt-out car still burning
  const flames: { s: THREE.Sprite; base: THREE.Vector3; ph: number; size: number }[] = []
  const smoke: { s: THREE.Sprite; base: THREE.Vector3; t: number }[] = []
  const flameMat = own(new THREE.SpriteMaterial({ map: soft(), color: new THREE.Color(2.6, 1.1, 0.35), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
  const coreMat = own(new THREE.SpriteMaterial({ map: soft(), color: new THREE.Color(3.2, 2.4, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
  const smokeMat = own(new THREE.SpriteMaterial({ map: soft(), color: 0x1a1612, transparent: true, opacity: 0.45, depthWrite: false }))
  const fire = (x: number, z: number, y: number, size: number) => {
    for (let k = 0; k < 6; k++) {
      const s = new THREE.Sprite(k < 2 ? coreMat : flameMat)
      const base = new THREE.Vector3(x + (Math.random() - 0.5) * size * 0.5, y, z + (Math.random() - 0.5) * size * 0.5)
      s.position.copy(base)
      s.userData.keep = true
      g.add(s)
      flames.push({ s, base, ph: Math.random() * 10, size: size * (k < 2 ? 0.6 : 1) })
    }
    for (let k = 0; k < 5; k++) {
      const s = new THREE.Sprite(own(smokeMat.clone()))
      s.userData.keep = true
      g.add(s)
      smoke.push({ s, base: new THREE.Vector3(x, y + 0.5, z), t: k / 5 })
    }
  }
  for (const [x, z] of [[-14, 27], [3, 29], [14, 26.5]]) {
    add(c, once('barrel', () => new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16, 1, true)), M.barrel, local(x, y0 + 0.45, z))
    blocks.push({ x0: x - 0.4, x1: x + 0.4, z0: z - 0.4, z1: z + 0.4 })
    fire(x, z, y0 + 0.95, 0.7)
  }
  fire(0.8, 38.0, y0 + 0.9, 1.6)
  fire(STREET.x1 + 4, AVENUE.z1 - 1.4, y0 + 1.3, 1.4)
  const wreck = std({ color: 0x1a1512, roughness: 0.95, metalness: 0.3 })
  add(c, BOX, wreck, local(STREET.x1 + 4, y0 + 0.6, AVENUE.z1 - 1.4, 4.2, 1.2, 1.9))
  blocks.push({ x0: STREET.x1 + 1.9, x1: STREET.x1 + 6.1, z0: AVENUE.z1 - 2.35, z1: AVENUE.z1 })
  const fireLight = new THREE.PointLight(0xff7a30, 14, 24, 1.5)
  fireLight.position.set(1, y0 + 1.8, 31)
  // (the lights hang on the station's group: they stay put while the street is hidden, so no shader is rebuilt)
  group.add(fireLight)
  const avLight = new THREE.PointLight(0xff7a30, 10, 18, 1.6)
  avLight.position.set(STREET.x1 + 4, y0 + 2.4, AVENUE.z1 - 2)
  group.add(avLight)
  // two street lamps still throw real light
  for (const at of [lamps[1], lamps[lamps.length - 2]]) {
    const l = new THREE.PointLight(0xffc890, 26, 34, 1.4)
    l.position.copy(at)
    group.add(l)
  }

  // -- the sign for the way on: overground to the next station, or out of the city
  const last = index >= FINAL_STATION
  const signText = last ? 'WAY OUT  →  CITY LIMITS' : `→  ${stationAt(index + 1).name.toUpperCase()}  (on foot)`
  const signM = std({ map: once('way' + signText, () => words(signText, 1024, 176, last ? '#1d6a3a' : '#e8e2cf', last ? '#fff' : '#9a1c14', 'bold 64px Helvetica, Arial, sans-serif')), roughness: 0.8 })
  add(c, PLANE, signM, new THREE.Matrix4().compose(new THREE.Vector3(STREET.x1 + 1.2, y0 + 3.4, AVENUE.z0 - 0.35), new THREE.Quaternion().setFromAxisAngle(Y, -Math.PI / 2 + 0.35), new THREE.Vector3(5.2, 0.9, 1)))
  for (const dz of [-2.2, 2.2]) {
    const px = STREET.x1 + 1.2 + Math.sin(0.35) * dz
    const pz = AVENUE.z0 - 0.35 + Math.cos(0.35) * dz
    add(c, CYL, M.pole, local(px, y0 + 1.9, pz, 0.07, 3.8, 0.07))
    blocks.push({ x0: px - 0.1, x1: px + 0.1, z0: pz - 0.1, z1: pz + 0.1 })
  }

  // -- the sky and the moon (no fog on them), and the moon's light
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(175, 48, 20, 0, Math.PI * 2, 0, Math.PI * 0.56),
    own(new THREE.MeshBasicMaterial({ map: skyTex(), side: THREE.BackSide, fog: false, depthWrite: false })),
  )
  own(sky.geometry)
  sky.position.set(20, y0 - 8, 42)
  sky.renderOrder = -10
  sky.userData.keep = true
  g.add(sky)
  const [mc, mg] = canvas(256, 256)
  const grad = mg.createRadialGradient(128, 128, 30, 128, 128, 128)
  grad.addColorStop(0, 'rgba(240,236,220,1)')
  grad.addColorStop(0.45, 'rgba(230,226,210,1)')
  grad.addColorStop(0.5, 'rgba(200,190,170,0.25)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  mg.fillStyle = grad
  mg.fillRect(0, 0, 256, 256)
  const moonM = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), own(new THREE.MeshBasicMaterial({ map: own(texture(mc)), transparent: true, fog: false, depthWrite: false })))
  own(moonM.geometry)
  moonM.position.set(-20, y0 + 60, 160)
  moonM.rotation.y = Math.PI
  moonM.renderOrder = -9
  moonM.userData.keep = true
  g.add(moonM)
  const moon = new THREE.DirectionalLight(0x9fb2e0, 0)
  moon.position.set(-40, y0 + 90, 150)
  moon.target.position.set(0, y0, 40)
  group.add(moon, moon.target)

  // -- instanced windows and frames, then everything else merged by material; all of it reflects the night, not the station
  for (const b of Object.values(I)) b.build(g)
  const env = nightEnv()
  g.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | undefined
    if (mat && (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) (mat as THREE.MeshStandardMaterial).envMap = env
  })
  mergeStatic(g, own)

  return {
    group: g,
    fire: fireLight,
    moon,
    update(t: number) {
      V.hazard.emissiveIntensity = t % 1.0 < 0.5 ? 3.2 : 0
      M.beacon.emissiveIntensity = (t + 0.3) % 1.2 < 0.6 ? 3.5 : 0.15
      V.blue.emissiveIntensity = Math.sin(t * 18) > 0 ? (t % 0.5 < 0.25 ? 7 : 0.2) : 0.2
      for (const f of flames) {
        const k = Math.sin(t * 9 + f.ph) * 0.5 + Math.sin(t * 23 + f.ph * 2) * 0.3
        f.s.position.set(f.base.x + Math.sin(t * 3 + f.ph) * 0.06 * f.size, f.base.y + (0.2 + k * 0.12) * f.size, f.base.z)
        f.s.scale.set(f.size * (0.7 + k * 0.15), f.size * (1.2 + k * 0.3), 1)
      }
      avLight.intensity = 9 + Math.sin(t * 11) * 2 + Math.random() * 2
      for (const s of smoke) {
        const k = ((t * 0.12 + s.t) % 1 + 1) % 1
        s.s.position.set(s.base.x + k * 1.5, s.base.y + k * 7, s.base.z + Math.sin(k * 6 + s.t * 9) * 0.4)
        s.s.scale.setScalar(0.8 + k * 3.5)
        s.s.material.opacity = 0.45 * (1 - k) * Math.min(1, k * 6)
      }
    },
  }
}
