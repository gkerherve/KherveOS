// Last Train: the kit the city is built with (lastTrainCity.ts lays it out,
// lastTrainSites.ts adds its special places). Textures drawn on canvases once
// and kept for every station; the shared materials (Mats); helpers that add a
// mesh, an invisible box for bullets, a footprint the walkers cannot cross;
// instanced batches for windows; buildings (terraces, mansion blocks, offices,
// warehouses, glass towers) with real window reveals; the station's front;
// the street furniture; the vehicles left where they stopped.

import * as THREE from 'three'
import { canvas, grime, HALL, LANDING, outDoorX, rng, sprite, STAIRS, stationAt, texture, wallTexture, words } from './lastTrainWorld'
import type { Vehicle, VehicleMats } from './lastTrainVehicles'
import { merge } from './lastTrainVehicles'

export interface Block {
  x0: number
  x1: number
  z0: number
  z1: number
}
export type Own = <T extends { dispose(): void }>(x: T) => T

export const Y = new THREE.Vector3(0, 1, 0)
export const BOX = new THREE.BoxGeometry(1, 1, 1)
export const PLANE = new THREE.PlaneGeometry(1, 1)
export const CYL = new THREE.CylinderGeometry(1, 1, 1, 16)

// ---------------------------------------------------------------- textures (drawn once, kept)

export const kept = new Map<string, unknown>()
export function once<T>(key: string, make: () => T): T {
  if (!kept.has(key)) kept.set(key, make())
  return kept.get(key) as T
}

/** A texture whose UVs are metres: it repeats every `m` metres (or m × n). */
export function metres<T extends THREE.Texture>(t: T, w: number, h = w): T {
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / w, 1 / h)
  return t
}

export interface Surface {
  map: THREE.Texture
  bump?: THREE.Texture
  rough?: THREE.Texture
}

/** Worn asphalt, 8 m square: aggregate, patches of newer tarmac, cracks, oil, puddles (smooth in the roughness map). */
export function asphalt(): Surface {
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
export function paving(): Surface {
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
export function ashlar(key: string, base: string, dirt: number, cols: number, rows: number, covers: number): Surface {
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
export function stucco(): Surface {
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
export function brick(key: string, base: string): Surface {
  return once('brick' + key, () => {
    const t = wallTexture('brick', base, key.length * 13 + 5, 1.1)
    return { map: metres(t.map, 0.9, 0.6), bump: metres(t.bump, 0.9, 0.6) }
  })
}

/** The station's glazed oxblood faience: square blocks 0.4 m. */
export function faience(): Surface {
  return once('faience', () => {
    const t = wallTexture('square', '#7a1b16', 17, 0.35)
    return { map: metres(t.map, 1.6), bump: metres(t.bump, 1.6) }
  })
}

/** A lit room seen from the street: warm light, a lampshade, curtains drawn half across, a sofa's back. */
export function roomTex(): THREE.CanvasTexture {
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
export function shopTex(): THREE.CanvasTexture {
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
export function officeTex(): THREE.CanvasTexture {
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
export function shutterTex(): THREE.CanvasTexture {
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
export function boardTex(): THREE.CanvasTexture {
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

export function soft(): THREE.CanvasTexture {
  return once('soft', () => sprite('soft'))
}

/** A pool of lamplight on the ground. */
export function poolTex(): THREE.CanvasTexture {
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
export function ironTex(kind: 'manhole' | 'grate'): THREE.CanvasTexture {
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
export function skyTex(): THREE.CanvasTexture {
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
export function nightEnv(): THREE.CanvasTexture {
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
export function barkTex(): THREE.CanvasTexture {
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
export function stripesTex(): THREE.CanvasTexture {
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
export function kioskTex(glow: boolean): THREE.CanvasTexture {
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
export function uvBox(w: number, h: number, d: number): THREE.BoxGeometry {
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

export interface Hole {
  x: number
  y: number
  w: number
  h: number
  /** A round head over the opening (its radius is w/2, the head ends at y + h). */
  arch?: boolean
}

/** A wall W × H with openings, `t` thick, its face at z = 0 (the reveals of the openings are real). */
export function facadeGeo(W: number, y0: number, H: number, holes: Hole[], t = 0.3): THREE.BufferGeometry {
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
export const ARCH = (() => {
  const s = new THREE.Shape()
  s.moveTo(-0.5, 0)
  s.lineTo(0.5, 0)
  s.lineTo(0.5, 1)
  s.absarc(0, 1, 0.5, 0, Math.PI, false)
  s.lineTo(-0.5, 0)
  return new THREE.ShapeGeometry(s, 12)
})()

export function local(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Y, ry), new THREE.Vector3(sx, sy, sz))
}

/** Instances gathered while the street is laid out, made into one InstancedMesh at the end. */
export class Batch {
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
  /** One InstancedMesh per chunk of the city (so what is behind the camera is not drawn). */
  build(parent: THREE.Object3D) {
    if (!this.list.length) return
    const white = new THREE.Color(1, 1, 1)
    const colours = this.list.some((x) => x.c)
    const byChunk = new Map<number, { m: THREE.Matrix4; c: THREE.Color | null }[]>()
    for (const x of this.list) {
      const k = chunkOf(x.m.elements[12], x.m.elements[14])
      const l = byChunk.get(k) ?? []
      l.push(x)
      byChunk.set(k, l)
    }
    for (const list of byChunk.values()) {
      const im = new THREE.InstancedMesh(this.geo, this.mat, list.length)
      list.forEach((x, i) => {
        im.setMatrixAt(i, x.m)
        if (colours) im.setColorAt(i, x.c ?? white)
      })
      im.instanceMatrix.needsUpdate = true
      im.computeBoundingSphere()
      im.userData.keep = true
      parent.add(im)
    }
  }
}

/** The city is drawn in chunks about 140 m square: the key of the chunk (x, z) is in. */
export function chunkOf(x: number, z: number): number {
  return Math.floor((x + 230) / 140) * 16 + Math.max(0, Math.floor((z - 20) / 115))
}

// ---------------------------------------------------------------- the street

export type Style = 'terrace' | 'mansion' | 'office' | 'warehouse' | 'modern'

export interface Mats {
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
  /** The red light on a tower's roof (it blinks). */
  aviation: THREE.MeshStandardMaterial
}

/** Somewhere a real light could shine: the few lights the street has go to the ones nearest the player. */
export interface LightSpot {
  p: THREE.Vector3
  color: number
  power: number
  range: number
}

export interface Ctx {
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
  lights: LightSpot[]
  /** Where supplies lie about the city (ammo, health). */
  supplies: [number, number, number][]
}

export const SHOPS: [string, string, string][] = [
  ['NEWS & WINE', '#1b3f6b', '#ffffff'], ['CHEMIST', '#0d6b4a', '#ffffff'], ['CAFÉ', '#3a2418', '#f2d9a6'], ['LAUNDERETTE', '#e8e4d8', '#1b4f8a'],
  ['FISH & CHIPS', '#0f3c78', '#f6d23a'], ['BOOKS', '#22301f', '#e8d9a8'], ['BARBER', '#141414', '#e8e8e8'], ['OFF LICENCE', '#6a1010', '#f5e6c8'],
  ['BAKERY', '#e9dcc0', '#6a3a1a'], ['PHONE REPAIR', '#f0c419', '#111111'], ['DRY CLEANERS', '#ffffff', '#c0392b'], ['THE RED LION', '#173a2a', '#d9b45a'],
  ['KHERVE BOOKS', '#0f2a1c', '#2fbf71'], ['GROCER', '#2a5a1e', '#ffffff'], ['HARDWARE', '#3a3a3a', '#ffcc33'], ['PIZZA', '#b31d17', '#ffffff'],
]

export function signMat(c: Ctx, name: string, bg: string, fg: string): THREE.Material {
  let m = c.signs.get(name)
  if (!m) {
    const t = once('sign' + name, () => words(name, 768, 112, bg, fg, `bold 70px ${name.startsWith('THE') ? 'Georgia, serif' : 'Helvetica, Arial, sans-serif'}`))
    m = c.own(new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: c.r() < 0.3 ? 0.5 : 0.04 }))
    c.signs.set(name, m)
  }
  return m
}

export function add(c: Ctx, geo: THREE.BufferGeometry, mat: THREE.Material, M: THREE.Matrix4): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.applyMatrix4(M)
  c.g.add(m)
  return m
}

/** An invisible box that bullets hit (the real thing is merged into one big mesh). */
export function proxy(c: Ctx, M: THREE.Matrix4) {
  const m = new THREE.Mesh(BOX, c.M.proxy)
  m.applyMatrix4(M)
  m.visible = false
  m.userData.keep = true
  c.g.add(m)
  c.solids.push(m)
}

/** One window: glass (dark, lit, broken or boarded), its frame, sill and lintel. */
export function windowAt(c: Ctx, B: THREE.Matrix4, h: Hole, frame: 'W' | 'D', dress: 'brick' | 'stone' | 'none', lit = 0.16) {
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

export interface BuildOpts {
  /**
   * 'full': a body behind the face (roof, chimneys, a footprint nobody walks through); 'front': over the
   * station (a roof slab, no body: the halls are behind); 'face': the face alone (a corner building's return).
   */
  body?: 'full' | 'front' | 'face'
  /** How deep the body is (9 to 13 m if not given). */
  depth?: number
  /** The corner buildings of a block: their face turns the corner at the left (local x = 0) and/or right end. */
  corners?: [boolean, boolean]
  /** The wall material (a corner's return is the same brick as its front). */
  wall?: THREE.Material
}

/** The footprint of local rectangle x0..x1 × z0..z1 under B: nobody walks through it. */
export function footprint(c: Ctx, B: THREE.Matrix4, x0: number, x1: number, z0: number, z1: number) {
  const v = new THREE.Vector3()
  let ax = Infinity
  let bx = -Infinity
  let az = Infinity
  let bz = -Infinity
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    v.set(x, 0, z).applyMatrix4(B)
    ax = Math.min(ax, v.x)
    bx = Math.max(bx, v.x)
    az = Math.min(az, v.z)
    bz = Math.max(bz, v.z)
  }
  c.blocks.push({ x0: ax, x1: bx, z0: az, z1: bz })
}

/** The matrices of a building's corner returns: at its left end (facing local -x) and its right end (facing +x). */
export function cornerB(B: THREE.Matrix4, W: number, D: number, right: boolean): THREE.Matrix4 {
  return right ? B.clone().multiply(local(W + 0.012, 0, 0, 1, 1, 1, Math.PI / 2)) : B.clone().multiply(local(-0.012, 0, -D, 1, 1, 1, -Math.PI / 2))
}

/**
 * A building of the street. Its face is local z = 0, its front along local x from 0 to W, standing on y = 0
 * (B places it). Returns its height to the parapet.
 */
export function building(c: Ctx, B: THREE.Matrix4, W: number, style: Style, floors: number, o: BuildOpts = {}): number {
  const { r, M, I } = c
  const body = o.body ?? 'full'
  if (style === 'modern') return tower(c, B, W, floors, o)
  const P = {
    terrace: { floorH: 3.15, ground: 4.0, bay: 2.6, ww: 1.05, wh: 1.9, wall: M.brick[r() < 0.6 ? 0 : 1], shops: true, frame: 'W' as const, dress: 'brick' as const, arch: false },
    mansion: { floorH: 3.1, ground: 4.2, bay: 3.0, ww: 1.25, wh: 2.0, wall: M.brick[2], shops: true, frame: 'W' as const, dress: 'stone' as const, arch: false },
    office: { floorH: 3.6, ground: 4.8, bay: 3.2, ww: 1.7, wh: 2.3, wall: M.stone, shops: false, frame: 'D' as const, dress: 'none' as const, arch: false },
    warehouse: { floorH: 3.8, ground: 4.4, bay: 3.4, ww: 1.6, wh: 2.4, wall: M.brick[3], shops: false, frame: 'D' as const, dress: 'stone' as const, arch: true },
  }[style]
  const wall = o.wall ?? P.wall
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
  add(c, facadeGeo(W, P.ground, H, holes), wall, B)
  for (const h of holes) windowAt(c, B, h, P.frame, P.dress)
  // the ground floor: shops, or offices behind tall windows, or loading doors
  const gHoles: Hole[] = []
  const groundMat = style === 'office' ? M.granite : style === 'warehouse' ? wall : M.stucco
  if (P.shops) {
    for (let b = 0; b < nB; b += 2) {
      const x0 = m0 + b * P.bay
      const x1 = Math.min(W - m0, x0 + P.bay * Math.min(2, nB - b))
      if (x1 - x0 < 2.4) {
        // a bay left over: a front door to the flats above, with a fanlight
        const door = { x: (x0 + x1) / 2 - 0.5, y: 0.02, w: 1.0, h: 2.6 }
        gHoles.push(door)
        I.frameD.add(B, local(door.x + 0.5, 1.15, -0.18, 1.0, 2.3, 0.05))
        I.room.add(B, local(door.x + 0.5, 2.45, -0.2, 0.9, 0.28, 1), new THREE.Color(0.5, 0.4, 0.3))
        continue
      }
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
        // a stall-riser under the window
        I.frameD.add(B, local(shop.x + shop.w / 2, shop.y / 2, -0.05, shop.w, shop.y, 0.04))
      }
      // the shop's pilasters, its fascia and the name on it, the shutter box, now and then a torn awning
      add(c, BOX, groundMat, B.clone().multiply(local(x0 + 0.17, 1.8, 0.07, 0.34, 3.6, 0.16)))
      add(c, BOX, groundMat, B.clone().multiply(local(x1 - 0.17, 1.8, 0.07, 0.34, 3.6, 0.16)))
      add(c, BOX, M.darkMetal, B.clone().multiply(local((x0 + x1) / 2, 3.25, 0.06, x1 - x0 - 0.5, 0.18, 0.12)))
      add(c, PLANE, signMat(c, name, bg, fg), B.clone().multiply(local((x0 + x1) / 2, 3.68, 0.17, x1 - x0 - 0.6, 0.6, 1)))
      add(c, BOX, M.black, B.clone().multiply(local((x0 + x1) / 2, 3.68, 0.08, x1 - x0 - 0.45, 0.72, 0.16)))
      if (state > 0.3 && r() < 0.3) awning(c, B, (x0 + x1) / 2, x1 - x0 - 0.6, bg)
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
  if (body === 'face') {
    proxy(c, B.clone().multiply(local(W / 2, H / 2, -0.3, W, H, 0.6)))
    return H
  }
  if (body === 'front') {
    // over the station: a roof slab behind the parapet and party walls at the ends (seen over a lower neighbour),
    // nothing that reaches down into the halls
    add(c, uvBox(W, 0.3, 6), wall, B.clone().multiply(local(W / 2, H - 0.6, -3.3)))
    for (const x of [0.15, W - 0.15]) add(c, uvBox(0.3, H - 9, 6), wall, B.clone().multiply(local(x, 9 + (H - 9) / 2, -3.3)))
    proxy(c, B.clone().multiply(local(W / 2, H / 2, -0.3, W, H, 0.6)))
    return H
  }
  const D = o.depth ?? 9 + r() * 4
  const [cl, cr] = o.corners ?? [false, false]
  // the body, drawn in from a corner so its side does not fight the return's face
  const bx0 = cl ? 0.3 : 0
  const bx1 = cr ? W - 0.3 : W
  add(c, uvBox(bx1 - bx0, H, D), wall, B.clone().multiply(local((bx0 + bx1) / 2, H / 2, -0.3 - D / 2)))
  proxy(c, B.clone().multiply(local(W / 2, H / 2, -0.3, W, H, 0.6)))
  footprint(c, B, 0, W, -0.3 - D, 0.12)
  for (const [k, on] of [cl, cr].entries()) {
    if (!on) continue
    building(c, cornerB(B, W, D + 0.3, k === 1), D + 0.3, style, floors, { body: 'face', wall })
  }
  // chimney stacks with their pots, on the party walls (terraces and mansion blocks); a water tank on a warehouse
  if (style === 'terrace' || style === 'mansion')
    for (let b = 0; b <= nB; b += 2) {
      const x = Math.min(W - 0.5, Math.max(0.5, m0 + b * P.bay))
      const sh = 1.6 + r() * 0.8
      add(c, uvBox(0.9, sh, 0.75), wall, B.clone().multiply(local(x, H + sh / 2, -1.8)))
      add(c, BOX, M.stone, B.clone().multiply(local(x, H + sh + 0.05, -1.8, 1.0, 0.1, 0.85)))
      for (let k = 0; k < 3; k++) add(c, CYL, M.pots, B.clone().multiply(local(x - 0.27 + k * 0.27, H + sh + 0.35, -1.8, 0.09, 0.55, 0.09)))
    }
  else if (r() < 0.6) {
    // a rooftop water tank or plant room
    const tx = W * (0.25 + r() * 0.5)
    if (r() < 0.5) {
      add(c, CYL, M.darkMetal, B.clone().multiply(local(tx, H + 1.3, -D / 2, 1.3, 2.2, 1.3)))
      for (const s of [-1, 1]) add(c, BOX, M.darkMetal, B.clone().multiply(local(tx + s * 0.9, H + 0.35, -D / 2, 0.12, 0.7, 2.2)))
    } else add(c, uvBox(4, 2.4, 3.5), M.concrete, B.clone().multiply(local(tx, H + 1.2, -D / 2)))
  }
  // a satellite dish or an aerial now and then
  if (r() < 0.35) add(c, BOX, M.darkMetal, B.clone().multiply(local(W * r(), H + 0.9, -1.2, 0.04, 1.8, 0.04)))
  return H
}

/** A shop's canvas awning, wound out and torn. */
export function awning(c: Ctx, B: THREE.Matrix4, x: number, w: number, color: string) {
  const mat = once('awn' + color, () => {
    const [cv, g] = canvas(128, 64)
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#e8e2d0' : color === '#ffffff' || color === '#e8e4d8' || color === '#e9dcc0' ? '#2a5a3a' : color
      g.fillRect(i * 16, 0, 16, 64)
    }
    grime(g, 128, 64, rng(color.length), 0.9)
    return texture(cv)
  })
  let m = c.signs.get('awn' + color)
  if (!m) c.signs.set('awn' + color, (m = c.own(new THREE.MeshStandardMaterial({ map: mat, roughness: 0.9, side: THREE.DoubleSide }))))
  const a = new THREE.Matrix4().compose(new THREE.Vector3(x, 3.0, 0.75), new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.05, 0, 0)), new THREE.Vector3(w, 1.7, 1))
  add(c, PLANE, m, B.clone().multiply(a))
  for (const s of [-1, 1]) add(c, BOX, c.M.darkMetal, B.clone().multiply(local(x + (s * w) / 2, 2.62, 0.75, 0.04, 0.04, 1.5)))
}

/** A glass office tower: a curtain wall of panes and mullions, dark spandrels at each floor, a lit lobby, a sign on top. */
export function tower(c: Ctx, B: THREE.Matrix4, W: number, floors: number, o: BuildOpts = {}): number {
  const { r, M, I } = c
  const body = o.body ?? 'full'
  const fh = 3.6
  const H = 4.8 + floors * fh + 0.8
  const D = body === 'full' ? (o.depth ?? 12) : 0.6
  const [cl, cr] = o.corners ?? [false, false]
  if (body !== 'face') {
    const bx0 = cl ? 0.3 : 0
    const bx1 = cr ? W - 0.3 : W
    add(c, uvBox(bx1 - bx0, H, D), M.concrete, B.clone().multiply(local((bx0 + bx1) / 2, H / 2, -D / 2 - 0.05)))
  }
  const pitch = 1.5
  const n = Math.max(1, Math.floor(W / pitch))
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
  if (body !== 'face') add(c, BOX, M.darkMetal, B.clone().multiply(local(W / 2, 4.4, 0.6, W, 0.2, 1.4)))
  add(c, BOX, M.darkMetal, B.clone().multiply(local(W / 2, H - 0.4, 0.05, W + 0.1, 0.8, 0.2)))
  if (body !== 'face' && r() < 0.5) {
    const t = once('labs', () => words('KHERVE LABS', 1024, 160, '#000000', '#2fbf71', 'bold 110px Helvetica, Arial, sans-serif'))
    const m = c.own(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 2.2, transparent: true, alphaMap: t }))
    add(c, PLANE, m, B.clone().multiply(local(W / 2, H + 1.0, -0.4, Math.min(W - 2, 12), 1.9, 1)))
  }
  proxy(c, B.clone().multiply(local(W / 2, H / 2, -0.3, W, H, 0.6)))
  if (body === 'full') {
    footprint(c, B, 0, W, -D - 0.1, 0.12)
    for (const [k, on] of [cl, cr].entries()) if (on) tower(c, cornerB(B, W, D + 0.05, k === 1), D + 0.05, floors, { body: 'face' })
    // a red light on the roof for aircraft
    add(c, BOX, M.darkMetal, B.clone().multiply(local(W - 1, H + 1.2, -D / 2, 0.08, 2.4, 0.08)))
    add(c, once('aviat', () => new THREE.SphereGeometry(0.14, 10, 8)), c.M.aviation, B.clone().multiply(local(W - 1, H + 2.45, -D / 2)))
  }
  return H
}

/**
 * The station: a two-storey front in oxblood faience, arched windows above, the entrances over the stairways
 * and a roundel at each; the doors of the ticket halls' ways out, WAY OUT over them.
 */
export function stationFront(c: Ctx, x0: number, x1: number) {
  const { M, I, y0 } = c
  const B = local(x0, y0, LANDING.endZ)
  const W = x1 - x0
  const H = 9.4
  const holes: Hole[] = []
  const entr = STAIRS.map((sx) => sx - x0)
  const outs = STAIRS.map((sx) => outDoorX(sx) - x0)
  for (const ex of entr) holes.push({ x: ex - 2, y: 0.02, w: 4, h: 3.0 })
  for (const ox of outs) holes.push({ x: ox - HALL.doorW / 2, y: 0.02, w: HALL.doorW, h: 2.6 })
  const clear = (x: number, d: number) => entr.every((ex) => Math.abs(ex - x) > d) && outs.every((ox) => Math.abs(ox - x) > d - 0.6)
  // arched windows of the upper storey, every 4.5 m; tall shop windows below between the entrances
  for (let x = 2.25; x < W - 1; x += 4.5) {
    holes.push({ x: x - 1, y: 4.7, w: 2, h: 3, arch: true })
    if (clear(x, 3.4)) holes.push({ x: x - 1.3, y: 0.6, w: 2.6, h: 2.3 })
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
  for (let x = 0; x <= W; x += 4.5) {
    const px = Math.min(W - 0.2, Math.max(0.2, x))
    if (outs.some((ox) => Math.abs(ox - px) < HALL.doorW / 2 + 0.25)) continue
    add(c, BOX, M.faience, B.clone().multiply(local(px, H / 2, 0.08, 0.4, H, 0.16)))
  }
  // the roof, above the ticket halls' ceilings
  add(c, uvBox(W, 0.3, 6), M.faience, B.clone().multiply(local(W / 2, H + 0.15, -3.2)))
  proxy(c, B.clone().multiply(local(W / 2, H / 2 + 1.5, -0.25, W, H - 3, 0.5)))
  // the ways out: a lit WAY OUT over each pair of doors, a canopy
  const wayT = once('wayout', () => words('WAY OUT', 384, 96, '#118a3a', '#ffffff', 'bold 60px Johnston, "Gill Sans", Helvetica, Arial, sans-serif'))
  const wayM = c.own(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: wayT, emissiveIntensity: 1.6 }))
  for (const ox of outs) {
    add(c, PLANE, wayM, B.clone().multiply(local(ox, 3.05, 0.03, 1.6, 0.4, 1)))
    add(c, BOX, M.darkMetal, B.clone().multiply(local(ox, 3.45, 0.55, HALL.doorW + 0.8, 0.12, 1.1)))
    c.lights.push({ p: new THREE.Vector3(x0 + ox, y0 + 2.9, LANDING.endZ + 0.8), color: 0x9affc0, power: 4, range: 9 })
  }
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
  // the front is a wall except at the entrances and the ways out
  const gaps = [...entr.map((ex) => [ex - 2, ex + 2]), ...outs.map((ox) => [ox - HALL.doorW / 2, ox + HALL.doorW / 2])].sort((a, b) => a[0] - b[0])
  let from = 0
  for (const [a, b] of gaps) {
    if (a > from) c.blocks.push({ x0: x0 + from, x1: x0 + a, z0: LANDING.endZ - 0.4, z1: LANDING.endZ + 0.12 })
    from = b
  }
  if (from < W) c.blocks.push({ x0: x0 + from, x1: x1, z0: LANDING.endZ - 0.4, z1: LANDING.endZ + 0.12 })
}

/**
 * A street lamp: a tapered column, an arm out over the road (towards dx, dz), the lantern (lit or dead).
 * A lit one lays a pool of light and may get one of the few real lights.
 */
export function lamp(c: Ctx, x: number, z: number, dx: number, dz: number, lit: boolean, lean = 0): THREE.Vector3 {
  const { M, y0 } = c
  const B = new THREE.Matrix4().compose(new THREE.Vector3(x, y0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, Math.atan2(dx, dz), 0, 'YXZ')), new THREE.Vector3(1, 1, 1))
  const col = once('lampcol', () => new THREE.CylinderGeometry(0.06, 0.11, 7.6, 12))
  add(c, col, M.pole, B.clone().multiply(local(0, 3.8, 0)))
  add(c, CYL, M.pole, B.clone().multiply(local(0, 0.35, 0, 0.16, 0.7, 0.16)))
  const arm = new THREE.Matrix4().compose(new THREE.Vector3(0, 7.55, 0.55), new THREE.Quaternion().setFromEuler(new THREE.Euler(1.35, 0, 0)), new THREE.Vector3(0.04, 1.2, 0.04))
  add(c, CYL, M.pole, B.clone().multiply(arm))
  add(c, BOX, M.pole, B.clone().multiply(local(0, 7.68, 1.15, 0.34, 0.12, 0.7)))
  add(c, BOX, lit ? M.lampOn : M.lampOff, B.clone().multiply(local(0, 7.6, 1.15, 0.28, 0.03, 0.6)))
  c.blocks.push({ x0: x - 0.18, x1: x + 0.18, z0: z - 0.18, z1: z + 0.18 })
  const at = new THREE.Vector3(x + dx * 1.15, y0 + 7.5, z + dz * 1.15)
  if (lit) {
    pool(c, x + dx * 1.6, z + dz * 1.6, 7.5, c.M.poolWarm)
    c.lights.push({ p: at, color: 0xffc890, power: 26, range: 34 })
  }
  return at
}

/** A soft pool of light laid on the ground. */
export function pool(c: Ctx, x: number, z: number, rad: number, mat: THREE.Material, sx = 1) {
  const m = add(c, PLANE, mat, local(x, c.y0 + 0.03, z, rad * 2 * sx, rad * 2, 1))
  m.rotation.x = -Math.PI / 2
  m.updateMatrix()
}

export function bollard(c: Ctx, x: number, z: number) {
  add(c, CYL, c.M.black, local(x, c.y0 + 0.5, z, 0.1, 1.0, 0.1))
  add(c, CYL, c.M.gold, local(x, c.y0 + 0.88, z, 0.105, 0.05, 0.105))
  add(c, once('cap', () => new THREE.SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), c.M.black, local(x, c.y0 + 1.0, z))
  c.blocks.push({ x0: x - 0.15, x1: x + 0.15, z0: z - 0.15, z1: z + 0.15 })
}

export function bin(c: Ctx, x: number, z: number, down = false) {
  const M = down
    ? new THREE.Matrix4().compose(new THREE.Vector3(x, c.y0 + 0.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, c.r() * 3, 0)), new THREE.Vector3(0.3, 0.9, 0.3))
    : local(x, c.y0 + 0.45, z, 0.3, 0.9, 0.3)
  add(c, CYL, c.M.black, M)
  if (!down) add(c, CYL, c.M.gold, local(x, c.y0 + 0.78, z, 0.305, 0.06, 0.305))
  c.blocks.push({ x0: x - 0.35, x1: x + 0.35, z0: z - 0.35, z1: z + 0.35 })
}

/** A K6 telephone kiosk. */
export function kiosk(c: Ctx, x: number, z: number, ry: number) {
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
export function postbox(c: Ctx, x: number, z: number) {
  add(c, CYL, c.M.black, local(x, c.y0 + 0.08, z, 0.3, 0.16, 0.3))
  add(c, CYL, c.M.red, local(x, c.y0 + 0.75, z, 0.26, 1.2, 0.26))
  add(c, once('pcap', () => new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), c.M.red, local(x, c.y0 + 1.35, z, 1, 0.6, 1))
  add(c, CYL, c.M.red, local(x, c.y0 + 1.36, z, 0.3, 0.06, 0.3))
  add(c, BOX, c.M.black, local(x, c.y0 + 1.15, z - 0.25, 0.22, 0.04, 0.05))
  add(c, BOX, c.M.white, local(x, c.y0 + 0.8, z - 0.26, 0.16, 0.12, 0.01))
  c.blocks.push({ x0: x - 0.35, x1: x + 0.35, z0: z - 0.35, z1: z + 0.35 })
}

/** A bus shelter: a steel frame, glass back and ends (one smashed), a lit advert, a bench; the stop's flag. */
export function shelter(c: Ctx, x: number, z: number) {
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
export function tree(c: Ctx, x: number, z: number, seed: number) {
  const geo = once('tree' + (seed % 3), () => {
    const r = rng(seed % 3 + 70)
    const parts: THREE.BufferGeometry[] = []
    const branch = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
      const to = from.clone().addScaledVector(dir, len)
      const g = new THREE.CylinderGeometry(rad * 0.7, rad, len, 5, 1, true)
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
    branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 3.6, 0.22, 4)
    return merge(parts)
  })
  add(c, geo, c.M.bark, local(x, c.y0, z, 1, 1, 1, c.r() * 6))
  add(c, PLANE, c.M.grate, new THREE.Matrix4().compose(new THREE.Vector3(x, c.y0 + 0.02, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new THREE.Vector3(1.4, 1.4, 1)))
  c.blocks.push({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 })
}

/** A Belisha beacon: a striped pole, the amber globe that blinks. */
export function beacon(c: Ctx, x: number, z: number) {
  add(c, CYL, c.M.stripes, local(x, c.y0 + 1.3, z, 0.06, 2.6, 0.06))
  add(c, once('globe', () => new THREE.SphereGeometry(0.2, 16, 12)), c.M.beacon, local(x, c.y0 + 2.75, z))
  c.blocks.push({ x0: x - 0.12, x1: x + 0.12, z0: z - 0.12, z1: z + 0.12 })
}

/** Black bin bags heaped against a wall, a box or two. */
export function rubbish(c: Ctx, x: number, z: number) {
  const bag = once('bag', () => new THREE.SphereGeometry(0.35, 12, 8))
  for (let k = 0; k < 3 + c.r() * 4; k++) {
    const px = x + (c.r() - 0.5) * 1.6
    const pz = z + (c.r() - 0.5) * 0.8
    add(c, bag, c.M.bag, new THREE.Matrix4().compose(new THREE.Vector3(px, c.y0 + 0.24, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(c.r(), c.r() * 6, c.r() * 0.4)), new THREE.Vector3(1, 0.7 + c.r() * 0.3, 0.9)))
  }
  if (c.r() < 0.7) add(c, BOX, c.M.cardboard, local(x + 0.9, c.y0 + 0.22, z + 0.2, 0.5, 0.44, 0.4, c.r() * 3))
}

/** Place a vehicle (centre, heading) and keep players and zombies out of its footprint. */
export function vehicle(c: Ctx, v: Vehicle, x: number, z: number, heading: number, tilt = 0) {
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

