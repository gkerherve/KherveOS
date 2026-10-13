// Rune Keep: a level in three.js. Turns a MapDef (rkMaps.ts) into meshes
// with high-resolution procedural textures, bakes the lights into the
// vertices (with shadows: each vertex marches to each light through the
// grid, and to the sky for the sun), and answers the game's questions:
// floors, ceilings, what is solid, where a ray hits. Doors slide up, lifts
// carry you, lava glows, the sky drifts.

import * as THREE from 'three'
import { cellOf, STEP, type Cell, type Liquid, type MapDef, type Tex } from './rkMaps'

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// ---------------------------------------------------------------- textures

function rand(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas(n = 512): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = n
  return [c, c.getContext('2d')!]
}

/** Speckle and blotches: the grain every surface gets. */
function grain(g: CanvasRenderingContext2D, r: () => number, n: number, dark = 0.22, light = 0.1) {
  for (let i = 0; i < n; i++) {
    const s = 1 + r() * 3
    g.fillStyle = r() < 0.55 ? `rgba(0,0,0,${r() * dark})` : `rgba(255,240,220,${r() * light})`
    g.fillRect(r() * 512, r() * 512, s, s)
  }
  for (let i = 0; i < 26; i++) {
    const x = r() * 512
    const y = r() * 512
    const rad = 20 + r() * 90
    const gr = g.createRadialGradient(x, y, 0, x, y, rad)
    gr.addColorStop(0, `rgba(${r() < 0.5 ? '20,14,8' : '90,80,60'},${0.08 + r() * 0.12})`)
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gr
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
}

/** Blocks with mortar, chipped edges; the bump canvas gets the same layout. */
function blocks(g: CanvasRenderingContext2D, bg: CanvasRenderingContext2D, r: () => number, rows: number, cols: number, base: [number, number, number], vary: number, mortar: string, offset = 0.5) {
  g.fillStyle = mortar
  g.fillRect(0, 0, 512, 512)
  bg.fillStyle = '#000'
  bg.fillRect(0, 0, 512, 512)
  const h = 512 / rows
  const w = 512 / cols
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? w * offset : 0
    for (let col = -1; col <= cols; col++) {
      const x = col * w + off + 3
      const y = row * h + 3
      const k = 1 - vary / 2 + r() * vary
      const [cr, cg, cb] = base.map((v) => Math.round(v * k))
      const gr = g.createLinearGradient(x, y, x + w, y + h)
      gr.addColorStop(0, `rgb(${cr + 12},${cg + 10},${cb + 8})`)
      gr.addColorStop(1, `rgb(${cr - 10},${cg - 10},${cb - 8})`)
      g.fillStyle = gr
      g.beginPath()
      // slightly irregular, chipped corners
      const j = () => (r() - 0.5) * 4
      g.moveTo(x + 2 + j(), y + j())
      g.lineTo(x + w - 6 + j(), y + j())
      g.lineTo(x + w - 6 + j(), y + h - 6 + j())
      g.lineTo(x + j(), y + h - 6 + j())
      g.closePath()
      g.fill()
      bg.fillStyle = `rgb(${200 + r() * 55},${200 + r() * 55},${200 + r() * 55})`
      bg.fillRect(x + 2, y + 1, w - 9, h - 8)
      if (r() < 0.25) {
        g.strokeStyle = 'rgba(0,0,0,0.45)'
        g.lineWidth = 1.2
        g.beginPath()
        let px = x + r() * w
        let py = y
        g.moveTo(px, py)
        for (let s = 0; s < 4; s++) g.lineTo((px += (r() - 0.5) * 20), (py += h / 4))
        g.stroke()
      }
    }
  }
}

function rivets(g: CanvasRenderingContext2D, bg: CanvasRenderingContext2D, xs: number[], ys: number[]) {
  for (const x of xs)
    for (const y of ys) {
      const gr = g.createRadialGradient(x - 2, y - 2, 0, x, y, 7)
      gr.addColorStop(0, '#d8cbb0')
      gr.addColorStop(1, '#2a2218')
      g.fillStyle = gr
      g.beginPath()
      g.arc(x, y, 6, 0, Math.PI * 2)
      g.fill()
      bg.fillStyle = '#fff'
      bg.beginPath()
      bg.arc(x, y, 6, 0, Math.PI * 2)
      bg.fill()
    }
}

/** A carved glyph: straight strokes and arcs on a grid (made up, not any real script). */
function glyph(g: CanvasRenderingContext2D, r: () => number, x: number, y: number, s: number) {
  g.beginPath()
  g.moveTo(x, y + (r() < 0.5 ? 0 : s))
  for (let k = 0; k < 4; k++) {
    const nx = x + Math.round(r() * 2) * (s / 2)
    const ny = y + Math.round(r() * 2) * (s / 2)
    if (r() < 0.25) g.arc(x + s / 2, y + s / 2, s / 2.4, r() * 6, r() * 6)
    else g.lineTo(nx, ny)
  }
  g.stroke()
}

export interface SurfaceTex {
  map: THREE.CanvasTexture
  bump: THREE.CanvasTexture
  rough: number
  metal: number
  /** Glowing parts (rune channels, tech lights). */
  glow?: THREE.CanvasTexture
}

function makeTex(kind: Tex): SurfaceTex {
  const [c, g] = canvas()
  const [bc, bg] = canvas()
  const r = rand(kind.length * 977 + kind.charCodeAt(0) * 31)
  let rough = 0.85
  let metal = 0
  let glowCanvas: HTMLCanvasElement | null = null
  switch (kind) {
    case 'stone':
      blocks(g, bg, r, 4, 2, [104, 92, 76], 0.35, '#2a241d')
      grain(g, r, 9000)
      break
    case 'brick':
      blocks(g, bg, r, 16, 4, [122, 64, 44], 0.3, '#3a2a20')
      grain(g, r, 7000, 0.25, 0.06)
      break
    case 'slab':
      blocks(g, bg, r, 2, 2, [92, 86, 78], 0.25, '#221e1a', 0.25)
      grain(g, r, 12000)
      break
    case 'dirt': {
      g.fillStyle = '#4a3a28'
      g.fillRect(0, 0, 512, 512)
      bg.fillStyle = '#808080'
      bg.fillRect(0, 0, 512, 512)
      for (let i = 0; i < 2600; i++) {
        const x = r() * 512
        const y = r() * 512
        const s = 1 + r() * 6
        const v = 40 + r() * 60
        g.fillStyle = `rgb(${v + 20},${v + 8},${v - 10})`
        g.beginPath()
        g.ellipse(x, y, s, s * (0.5 + r() * 0.5), r() * 3, 0, Math.PI * 2)
        g.fill()
        bg.fillStyle = `rgb(${120 + r() * 135},${120 + r() * 135},${120 + r() * 135})`
        bg.fillRect(x - s / 2, y - s / 2, s, s)
      }
      grain(g, r, 6000)
      break
    }
    case 'wood': {
      bg.fillStyle = '#000'
      bg.fillRect(0, 0, 512, 512)
      for (let p = 0; p < 6; p++) {
        const x = (p * 512) / 6
        const v = 70 + r() * 30
        g.fillStyle = `rgb(${v + 30},${v},${v - 30})`
        g.fillRect(x, 0, 512 / 6, 512)
        for (let k = 0; k < 40; k++) {
          g.strokeStyle = `rgba(30,18,8,${0.15 + r() * 0.3})`
          g.lineWidth = 1 + r() * 1.5
          g.beginPath()
          const lx = x + r() * (512 / 6)
          g.moveTo(lx, 0)
          g.bezierCurveTo(lx + (r() - 0.5) * 12, 170, lx + (r() - 0.5) * 12, 340, lx + (r() - 0.5) * 8, 512)
          g.stroke()
        }
        g.fillStyle = '#1a1008'
        g.fillRect(x, 0, 4, 512)
        bg.fillStyle = '#fff'
        bg.fillRect(x + 5, 0, 512 / 6 - 6, 512)
      }
      g.fillStyle = '#3a3530'
      for (const y of [60, 450]) {
        g.fillRect(0, y, 512, 22)
        bg.fillStyle = '#fff'
        bg.fillRect(0, y, 512, 22)
      }
      rivets(g, bg, [40, 125, 210, 296, 382, 468], [71, 461])
      grain(g, r, 5000)
      break
    }
    case 'metal': {
      rough = 0.55
      metal = 0.6
      g.fillStyle = '#5a5248'
      g.fillRect(0, 0, 512, 512)
      bg.fillStyle = '#9a9a9a'
      bg.fillRect(0, 0, 512, 512)
      for (const [x, y, w, h] of [[0, 0, 256, 256], [256, 0, 256, 256], [0, 256, 512, 256]]) {
        const gr = g.createLinearGradient(x, y, x, y + h)
        gr.addColorStop(0, '#6e665a')
        gr.addColorStop(1, '#4a4239')
        g.fillStyle = gr
        g.fillRect(x + 4, y + 4, w - 8, h - 8)
        bg.fillStyle = '#c8c8c8'
        bg.fillRect(x + 4, y + 4, w - 8, h - 8)
        bg.fillStyle = '#000'
        bg.fillRect(x, y, w, 4)
        bg.fillRect(x, y, 4, h)
      }
      rivets(g, bg, [18, 238, 274, 494], [18, 238, 274, 494])
      // rust runs
      for (let i = 0; i < 60; i++) {
        const x = r() * 512
        const y = r() * 512
        const len = 20 + r() * 120
        const gr = g.createLinearGradient(0, y, 0, y + len)
        gr.addColorStop(0, `rgba(120,55,20,${0.2 + r() * 0.35})`)
        gr.addColorStop(1, 'rgba(120,55,20,0)')
        g.fillStyle = gr
        g.fillRect(x, y, 2 + r() * 8, len)
      }
      grain(g, r, 9000, 0.25, 0.12)
      break
    }
    case 'grate': {
      rough = 0.5
      metal = 0.7
      g.fillStyle = '#0a0806'
      g.fillRect(0, 0, 512, 512)
      bg.fillStyle = '#000'
      bg.fillRect(0, 0, 512, 512)
      for (let y = 0; y < 512; y += 32)
        for (let x = 0; x < 512; x += 32) {
          g.fillStyle = '#5c544a'
          g.fillRect(x, y, 32, 6)
          g.fillRect(x, y, 6, 32)
          bg.fillStyle = '#fff'
          bg.fillRect(x, y, 32, 6)
          bg.fillRect(x, y, 6, 32)
        }
      g.fillStyle = '#3c352d'
      for (const v of [0, 256]) {
        g.fillRect(v, 0, 14, 512)
        g.fillRect(0, v, 512, 14)
      }
      grain(g, r, 6000, 0.3, 0.1)
      break
    }
    case 'tech': {
      rough = 0.45
      metal = 0.5
      g.fillStyle = '#34363a'
      g.fillRect(0, 0, 512, 512)
      bg.fillStyle = '#888'
      bg.fillRect(0, 0, 512, 512)
      const [gc, gg] = canvas()
      gg.fillStyle = '#000'
      gg.fillRect(0, 0, 512, 512)
      for (let i = 0; i < 9; i++) {
        const x = Math.floor(r() * 6) * 80 + 16
        const y = Math.floor(r() * 6) * 80 + 16
        const w = 60 + Math.floor(r() * 3) * 80
        const h = 60 + Math.floor(r() * 2) * 80
        g.fillStyle = `rgb(${60 + r() * 20},${62 + r() * 20},${68 + r() * 20})`
        g.fillRect(x, y, w, h)
        bg.fillStyle = '#ddd'
        bg.fillRect(x, y, w, h)
        g.strokeStyle = '#16181a'
        g.lineWidth = 3
        g.strokeRect(x, y, w, h)
      }
      for (let i = 0; i < 10; i++) {
        const x = 20 + r() * 470
        const y = 20 + r() * 470
        gg.fillStyle = r() < 0.5 ? '#40c0ff' : '#ff9030'
        gg.fillRect(x, y, 10, 4)
        g.fillStyle = gg.fillStyle
        g.fillRect(x, y, 10, 4)
      }
      g.fillStyle = '#c8a020'
      for (let x = 0; x < 512; x += 32) {
        g.beginPath()
        g.moveTo(x, 490)
        g.lineTo(x + 16, 490)
        g.lineTo(x + 4, 512)
        g.lineTo(x - 12, 512)
        g.fill()
      }
      grain(g, r, 7000, 0.2, 0.08)
      glowCanvas = gc
      break
    }
    case 'rune': {
      blocks(g, bg, r, 3, 2, [70, 66, 72], 0.25, '#151317')
      grain(g, r, 8000)
      const [gc, gg] = canvas()
      gg.fillStyle = '#000'
      gg.fillRect(0, 0, 512, 512)
      // a band of carved glyphs with a faint glow in the grooves
      for (const band of [180]) {
        g.fillStyle = '#2a2730'
        g.fillRect(0, band, 512, 120)
        bg.fillStyle = '#e0e0e0'
        bg.fillRect(0, band, 512, 120)
        for (let k = 0; k < 8; k++) {
          for (const [ctx, col, w] of [[g, '#120f14', 7], [gg, '#ff5a20', 3], [bg, '#000', 7]] as const) {
            const rr = rand(1000 + k)
            ctx.strokeStyle = col
            ctx.lineWidth = w
            ctx.lineCap = 'round'
            glyph(ctx, rr, 14 + k * 64, band + 28, 40)
          }
        }
      }
      glowCanvas = gc
      break
    }
  }
  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  const bump = new THREE.CanvasTexture(bc)
  const glow = glowCanvas ? new THREE.CanvasTexture(glowCanvas) : undefined
  if (glow) glow.colorSpace = THREE.SRGBColorSpace
  for (const t of [map, bump, glow]) {
    if (!t) continue
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
  }
  return { map, bump, rough, metal, glow }
}

// ---------------------------------------------------------------- shaders: liquids and sky

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
`

function liquidMaterial(kind: Liquid, time: { value: number }): THREE.ShaderMaterial {
  const lava = kind === 'lava'
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vW;
      ${NOISE}
      void main() {
        vec2 p = vW.xz * ${lava ? '0.55' : '0.7'};
        // Quake-style warping: the surface swirls on itself
        vec2 q = p + vec2(sin(p.y * 1.7 + uTime * 0.9), cos(p.x * 1.5 + uTime * 0.8)) * 0.35;
        float n = fbm(q * 1.6 + uTime * 0.05);
        float crust = smoothstep(0.42, 0.7, fbm(q * 3.1 - uTime * 0.07));
        ${lava
          ? `vec3 hot = mix(vec3(1.5, 0.38, 0.05), vec3(2.2, 1.1, 0.22), n);
             vec3 col = mix(hot, vec3(0.16, 0.05, 0.02), crust * 0.85);`
          : `vec3 col = mix(vec3(0.08, 0.45, 0.05), vec3(0.45, 1.2, 0.12), n) * (0.6 + 0.5 * (1.0 - crust));`}
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
}

function skyMaterial(time: { value: number }, tint: [number, number, number]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time, uTint: { value: new THREE.Vector3(...tint) } },
    side: THREE.DoubleSide,
    depthWrite: true,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uTint;
      varying vec3 vW;
      ${NOISE}
      void main() {
        vec3 d = normalize(vW - cameraPosition);
        vec2 uv = d.xz / (abs(d.y) + 0.18);
        float back = fbm(uv * 1.2 + vec2(uTime * 0.012, uTime * 0.008));
        float front = fbm(uv * 2.3 + vec2(-uTime * 0.03, uTime * 0.02));
        vec3 col = uTint * (0.25 + back * 0.9);
        col = mix(col, uTint * 1.8 + 0.15, smoothstep(0.5, 0.85, front) * 0.8);
        col *= 0.6 + 0.6 * smoothstep(0.0, 0.6, d.y);
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
}

export function portalMaterial(time: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time, uOn: { value: 1 } },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOn;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float a = atan(p.y, p.x);
        float swirl = fbm(vec2(a * 1.5 + r * 6.0 - uTime * 1.6, r * 3.0 - uTime * 0.7));
        vec3 col = mix(vec3(0.1, 0.4, 1.6), vec3(1.4, 2.4, 3.2), swirl) * (1.2 - r * 0.7);
        col = mix(vec3(0.5, 0.08, 0.06) * (1.0 - r), col, uOn);
        float edge = smoothstep(1.0, 0.86, r);
        gl_FragColor = vec4(col, edge);
      }`,
  })
}

// ---------------------------------------------------------------- lights

export interface BakeLight {
  pos: THREE.Vector3
  color: THREE.Color
  power: number
  radius: number
}

// ---------------------------------------------------------------- the level

interface Bucket {
  pos: number[]
  nrm: number[]
  uv: number[]
  idx: number[]
}

export class Level {
  readonly map: MapDef
  readonly group = new THREE.Group()
  readonly lights: BakeLight[] = []
  readonly time = { value: 0 }
  /** Door panels and their state (0 closed .. 1 open). */
  doors: { mesh: THREE.Mesh; open: number; hold: number; unlocked: boolean; cx: number; cz: number; f: number; c: number }[] = []
  lifts: { mesh: THREE.Mesh; y: number; state: 'low' | 'up' | 'high' | 'down'; t: number }[] = []
  private owned: { dispose(): void }[] = []
  private sunDir: THREE.Vector3
  private sunColor: THREE.Color
  private texCache = new Map<Tex, SurfaceTex>()

  constructor(map: MapDef) {
    this.map = map
    this.sunDir = new THREE.Vector3(...map.sun.dir).normalize()
    this.sunColor = new THREE.Color(map.sun.color).multiplyScalar(map.sun.power)
    this.collectLights()
    this.buildStatic()
    this.buildMovers()
  }

  // ---- queries

  cell(x: number, z: number): Cell | null {
    return cellOf(this.map, x, z)
  }

  /** The floor a thing stands on in this cell now (lifts move). */
  floorOf(c: Cell): number {
    return c.lift !== undefined ? this.lifts[c.lift].y : c.f
  }

  blocked(c: Cell | null): boolean {
    return !c || c.solid || (c.door !== undefined && this.doors[c.door].open < 0.92)
  }

  /** Can a box (radius r, height h) stand with its feet at `feet`? Returns the floor it would stand on, or null. */
  fit(x: number, z: number, r: number, feet: number, h: number): number | null {
    let ground = -Infinity
    for (const cx of [x - r, x + r - 1e-4])
      for (const cz of [z - r, z + r - 1e-4]) {
        const c = this.cell(cx, cz)
        if (this.blocked(c)) return null
        const f = this.floorOf(c!)
        if (f > feet + STEP + 1e-4) return null
        if (c!.c < Math.max(feet, f) + h) return null
        ground = Math.max(ground, f)
      }
    return ground
  }

  ground(x: number, z: number, r: number): number {
    let g = -Infinity
    for (const cx of [x - r, x + r - 1e-4])
      for (const cz of [z - r, z + r - 1e-4]) {
        const c = this.cell(cx, cz)
        if (!this.blocked(c)) g = Math.max(g, this.floorOf(c!))
      }
    return g
  }

  ceiling(x: number, z: number, r: number): number {
    let top = Infinity
    for (const cx of [x - r, x + r - 1e-4])
      for (const cz of [z - r, z + r - 1e-4]) {
        const c = this.cell(cx, cz)
        if (c && !c.solid) top = Math.min(top, c.c)
      }
    return top
  }

  solidAt(x: number, y: number, z: number): boolean {
    const c = this.cell(x, z)
    if (this.blocked(c)) return true
    return y < this.floorOf(c!) || y > c!.c
  }

  /** March a ray through the level. */
  ray(o: THREE.Vector3, d: THREE.Vector3, max: number): { dist: number; point: THREE.Vector3; normal: THREE.Vector3 } | null {
    const step = 0.1
    const p = o.clone()
    let prev = o.clone()
    for (let t = 0; t <= max; t += step) {
      p.copy(o).addScaledVector(d, t)
      if (this.solidAt(p.x, p.y, p.z)) {
        // refine
        let a = Math.max(0, t - step)
        let b = t
        for (let k = 0; k < 6; k++) {
          const m = (a + b) / 2
          if (this.solidAt(o.x + d.x * m, o.y + d.y * m, o.z + d.z * m)) b = m
          else a = m
        }
        prev = o.clone().addScaledVector(d, a)
        const hit = o.clone().addScaledVector(d, b)
        const n = new THREE.Vector3()
        if (Math.floor(prev.x) !== Math.floor(hit.x) && this.blocked(this.cell(hit.x, prev.z))) n.set(-Math.sign(d.x), 0, 0)
        else if (Math.floor(prev.z) !== Math.floor(hit.z) && this.blocked(this.cell(prev.x, hit.z))) n.set(0, 0, -Math.sign(d.z))
        else n.set(0, d.y > 0 ? -1 : 1, 0)
        return { dist: a, point: prev, normal: n }
      }
    }
    return null
  }

  /** Is the straight line between two points clear? */
  clear(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const d = b.clone().sub(a)
    const len = d.length()
    d.divideScalar(len || 1)
    for (let t = 0.2; t < len; t += 0.25) if (this.solidAt(a.x + d.x * t, a.y + d.y * t, a.z + d.z * t)) return false
    return true
  }

  /** The light a thing at this point receives (for monsters, items, the weapon in hand). */
  lightAt(p: THREE.Vector3, out = new THREE.Color()): THREE.Color {
    return this.shade(p, null, out, 0.35)
  }

  // ---- lights

  private collectLights() {
    const m = this.map
    for (const e of m.ents) {
      if (e.kind !== 'light') continue
      const c = cellOf(m, e.x, e.z)!
      const pos = new THREE.Vector3(e.x, c.f + (e.y ?? 2.4), e.z)
      if (e.style === 'torch') {
        // hang it on the nearest wall
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = cellOf(m, e.x + dx, e.z + dz)
          if (!n || n.solid || n.f > pos.y) {
            pos.x += dx * 0.3
            pos.z += dz * 0.3
            break
          }
        }
      }
      if (e.style === 'lamp') pos.y = (e.y ?? c.c - 0.4) - 0.15
      const power = e.power ?? 1
      this.lights.push({ pos, color: new THREE.Color(e.color ?? 0xffa040), power, radius: 7 + power * 6 })
    }
    // glowing liquids light their surroundings
    for (let z = 1; z < m.h; z += 3)
      for (let x = 1; x < m.w; x += 3) {
        const c = m.cells[z * m.w + x]
        if (c.solid || !c.liquid) continue
        const lava = c.liquid === 'lava'
        this.lights.push({
          pos: new THREE.Vector3(x + 0.5, c.f + 1.0, z + 0.5),
          color: new THREE.Color(lava ? 0xff5a18 : 0x60ff40),
          power: lava ? 0.2 : 0.1,
          radius: lava ? 7 : 4,
        })
      }
  }

  private visible(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const d = to.clone().sub(from)
    const len = d.length()
    d.divideScalar(len)
    for (let t = 0.12; t < len - 0.1; t += 0.2) {
      const x = from.x + d.x * t
      const y = from.y + d.y * t
      const z = from.z + d.z * t
      const c = this.cell(x, z)
      if (!c || c.solid) return false
      const f = c.lift !== undefined ? this.map.lifts[c.lift].low : c.f
      if (y < f - 0.02 || y > c.c + 0.02) return false
    }
    return true
  }

  private sunlit(from: THREE.Vector3): boolean {
    const d = this.sunDir
    for (let t = 0.12; t < 60; t += 0.25) {
      const x = from.x + d.x * t
      const y = from.y + d.y * t
      const z = from.z + d.z * t
      const c = this.cell(x, z)
      if (!c || c.solid) return false
      if (y > c.c) return !!c.sky
      if (y < c.f - 0.02) return false
    }
    return false
  }

  /** Light at a point; with a normal for surfaces (Lambert with a soft wrap). */
  private shade(p: THREE.Vector3, n: THREE.Vector3 | null, out: THREE.Color, ambient: number): THREE.Color {
    out.setRGB(0.05 + ambient * 0.08, 0.045 + ambient * 0.07, 0.05 + ambient * 0.08)
    const from = n ? p.clone().addScaledVector(n, 0.06) : p
    const L = new THREE.Vector3()
    for (const l of this.lights) {
      const dist = l.pos.distanceTo(p)
      if (dist > l.radius) continue
      L.subVectors(l.pos, p).divideScalar(dist || 1)
      const lam = n ? Math.max(0, n.dot(L) * 0.8 + 0.2) : 0.75
      if (lam <= 0) continue
      if (!this.visible(from, l.pos)) continue
      const fall = (1 - dist / l.radius) ** 2
      const k = l.power * 1.9 * fall * lam
      out.r += l.color.r * k
      out.g += l.color.g * k
      out.b += l.color.b * k
    }
    const lam = n ? Math.max(0, n.dot(this.sunDir) * 0.75 + 0.25) : 0.7
    if (lam > 0 && this.sunlit(from)) out.add(this.sunColor.clone().multiplyScalar(lam))
    // sky fill: open air under the sky is never pitch black
    const c = this.cell(from.x, from.z)
    if (c?.sky) {
      // how open is it above? more sky light high up and away from the walls
      const open = clamp01((p.y - c.f) / Math.max(1, c.c - c.f) * 0.5 + 0.5)
      out.add(new THREE.Color(...this.map.skyTint).multiplyScalar(0.42 * open))
    }
    return out
  }

  // ---- geometry

  tex(t: Tex): SurfaceTex {
    let s = this.texCache.get(t)
    if (!s) {
      s = makeTex(t)
      this.texCache.set(t, s)
      this.owned.push(s.map, s.bump)
      if (s.glow) this.owned.push(s.glow)
    }
    return s
  }

  private buildStatic() {
    const m = this.map
    const buckets = new Map<string, Bucket>()
    const bucket = (key: string) => {
      let b = buckets.get(key)
      if (!b) buckets.set(key, (b = { pos: [], nrm: [], uv: [], idx: [] }))
      return b
    }
    /** A quad split into tiles of about a metre (for smooth baked light). */
    const quad = (key: string, o: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, n: THREE.Vector3, uvOf: (p: THREE.Vector3) => [number, number]) => {
      const b = bucket(key)
      const nu = Math.max(1, Math.round(u.length()))
      const nv = Math.max(1, Math.round(v.length()))
      const base = b.pos.length / 3
      for (let j = 0; j <= nv; j++)
        for (let i = 0; i <= nu; i++) {
          const p = o.clone().addScaledVector(u, i / nu).addScaledVector(v, j / nv)
          b.pos.push(p.x, p.y, p.z)
          b.nrm.push(n.x, n.y, n.z)
          b.uv.push(...uvOf(p))
        }
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          const a = base + j * (nu + 1) + i
          const c = a + nu + 1
          b.idx.push(a, a + 1, c, a + 1, c + 1, c)
        }
    }
    const S = 0.5 // one texture repeat per 2 m
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const effFloor = (c: Cell) => (c.lift !== undefined ? m.lifts[c.lift].low : c.f)

    for (let z = 0; z < m.h; z++)
      for (let x = 0; x < m.w; x++) {
        const c = m.cells[z * m.w + x]
        if (c.solid) continue
        const f = effFloor(c)
        // floor (lifts draw their own), liquids
        if (c.liquid) quad('liquid:' + c.liquid, V(x, c.f + 0.35, z + 1), V(1, 0, 0), V(0, 0, -1), V(0, 1, 0), (p) => [p.x * S, p.z * S])
        else if (c.lift === undefined) quad('floor:' + c.floor, V(x, f, z + 1), V(1, 0, 0), V(0, 0, -1), V(0, 1, 0), (p) => [p.x * S, p.z * S])
        // ceiling
        quad(c.sky ? 'sky' : 'ceil:' + c.ceil, V(x, c.c, z), V(1, 0, 0), V(0, 0, 1), V(0, -1, 0), (p) => [p.x * S, p.z * S])
        // walls towards each neighbour
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nb = cellOf(m, x + dx, z + dz)
          const n = V(-dx, 0, -dz)
          // the face sits on the shared edge, seen from this cell
          const ex = dx > 0 ? x + 1 : x
          const ez = dz > 0 ? z + 1 : z
          const start = dx !== 0 ? V(ex, 0, dx > 0 ? z : z + 1) : V(dz > 0 ? x + 1 : x, 0, ez)
          const along = dx !== 0 ? V(0, 0, dx > 0 ? 1 : -1) : V(dz > 0 ? -1 : 1, 0, 0)
          const uvOf = (p: THREE.Vector3): [number, number] => [(dx !== 0 ? p.z : p.x) * S, p.y * S]
          const wall = (y0: number, y1: number, t: Tex) => {
            if (y1 - y0 < 0.01) return
            quad('wall:' + t, V(start.x, y0, start.z), along, V(0, y1 - y0, 0), n, uvOf)
          }
          if (!nb || nb.solid) wall(f, c.c, c.wall)
          else {
            const nf = effFloor(nb)
            if (nf > f) wall(f, Math.min(nf, c.c), nb.wall)
            if (nb.c < c.c) wall(Math.max(nb.c, f), c.c, c.wall)
          }
        }
      }

    for (const [key, b] of buckets) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
      geo.setIndex(b.idx)
      let mat: THREE.Material
      if (key === 'sky') mat = skyMaterial(this.time, m.skyTint)
      else if (key.startsWith('liquid:')) mat = liquidMaterial(key.slice(7) as Liquid, this.time)
      else {
        this.bake(geo)
        mat = this.surface(key.split(':')[1] as Tex)
      }
      this.owned.push(geo, mat)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.matrixAutoUpdate = false
      this.group.add(mesh)
    }
  }

  /** A lit surface material: baked vertex light × texture, plus dynamic lights. */
  surface(t: Tex): THREE.MeshStandardMaterial {
    const s = this.tex(t)
    const mat = new THREE.MeshStandardMaterial({
      map: s.map,
      bumpMap: s.bump,
      bumpScale: 2.2,
      roughness: s.rough,
      metalness: s.metal,
      vertexColors: true,
    })
    if (s.glow) {
      mat.emissiveMap = s.glow
      mat.emissive = new THREE.Color(1, 1, 1)
      mat.emissiveIntensity = 0.9
    }
    return mat
  }

  private bake(geo: THREE.BufferGeometry) {
    const pos = geo.attributes.position as THREE.BufferAttribute
    const nrm = geo.attributes.normal as THREE.BufferAttribute
    const col = new Float32Array(pos.count * 3)
    const p = new THREE.Vector3()
    const n = new THREE.Vector3()
    const out = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i)
      n.fromBufferAttribute(nrm, i)
      this.shade(p, n, out, 1)
      // keep the brightest spots from burning out, softly
      const peak = Math.max(out.r, out.g, out.b)
      const k = peak > 1.2 ? (1.2 + (peak - 1.2) * 0.25) / peak : 1
      col[i * 3] = out.r * k
      col[i * 3 + 1] = out.g * k
      col[i * 3 + 2] = out.b * k
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  }

  private buildMovers() {
    const m = this.map
    const doorTex = this.tex('metal')
    const doorMat = new THREE.MeshStandardMaterial({ map: doorTex.map, bumpMap: doorTex.bump, bumpScale: 2, roughness: 0.5, metalness: 0.6 })
    const keyMats = {
      silver: new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.3, metalness: 1, emissive: 0x405060, emissiveIntensity: 0.4 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xe0b040, roughness: 0.3, metalness: 1, emissive: 0x604010, emissiveIntensity: 0.5 }),
    }
    this.owned.push(doorMat, keyMats.silver, keyMats.gold)
    for (const d of m.doors) {
      const c = m.cells[d.z0 * m.w + d.x0]
      const w = d.x1 - d.x0 + 1
      const dd = d.z1 - d.z0 + 1
      const h = c.c - c.f
      const geo = new THREE.BoxGeometry(w, h, dd)
      this.owned.push(geo)
      const mesh = new THREE.Mesh(geo, doorMat)
      mesh.position.set(d.x0 + w / 2, c.f + h / 2, d.z0 + dd / 2)
      if (d.key) {
        // a coloured band and lock plates tell which key it takes
        const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.001, 0.25, dd * 1.06), keyMats[d.key])
        band.position.y = 0
        mesh.add(band)
        this.owned.push(band.geometry)
      }
      this.group.add(mesh)
      this.doors.push({ mesh, open: 0, hold: 0, unlocked: !d.key, cx: d.x0 + w / 2, cz: d.z0 + dd / 2, f: c.f, c: c.c })
    }
    const liftTex = this.tex('grate')
    const liftMat = new THREE.MeshStandardMaterial({ map: liftTex.map, bumpMap: liftTex.bump, roughness: 0.5, metalness: 0.7 })
    this.owned.push(liftMat)
    for (const l of m.lifts) {
      const w = l.x1 - l.x0 + 1
      const dd = l.z1 - l.z0 + 1
      const geo = new THREE.BoxGeometry(w, 1, dd)
      this.owned.push(geo)
      const mesh = new THREE.Mesh(geo, liftMat)
      mesh.position.set(l.x0 + w / 2, l.low, l.z0 + dd / 2)
      this.group.add(mesh)
      this.lifts.push({ mesh, y: l.low, state: 'low', t: 0 })
    }
    // the doors and lifts are not vertex-lit: tint them with the light where they stand
    const tint = new THREE.Color()
    this.lightAt(new THREE.Vector3(m.doors[0] ? this.doors[0].cx : 0, 1.5, m.doors[0] ? this.doors[0].cz : 0), tint)
    doorMat.color.setRGB(Math.min(1.4, tint.r + 0.25), Math.min(1.4, tint.g + 0.22), Math.min(1.4, tint.b + 0.2))
    if (m.lifts[0]) {
      const l = m.lifts[0]
      this.lightAt(new THREE.Vector3(l.x0 + 1, l.low + 1.5, l.z0 + 1), tint)
      liftMat.color.setRGB(Math.min(1.4, tint.r + 0.3), Math.min(1.4, tint.g + 0.3), Math.min(1.4, tint.b + 0.3))
    }
  }

  /** Move doors and lifts. `near(x, z, r)`: is a player or monster within r of this point? */
  update(dt: number, near: (x: number, z: number, r: number) => boolean, onLift: (id: number) => boolean, sound: (what: 'door' | 'lift', x: number, z: number) => void) {
    this.time.value += dt
    for (const d of this.doors) {
      const want = d.unlocked && near(d.cx, d.cz, 2.8)
      if (want) d.hold = 2.5
      else d.hold -= dt
      const target = d.hold > 0 ? 1 : 0
      if (target === 0 && d.open > 0 && near(d.cx, d.cz, 1.1)) d.hold = 0.5 // never close on someone
      const before = d.open
      d.open = THREE.MathUtils.clamp(d.open + (target ? dt : -dt) / 0.9, 0, 1)
      if ((before === 0 && d.open > 0) || (before === 1 && d.open < 1)) sound('door', d.cx, d.cz)
      const h = d.c - d.f
      d.mesh.position.y = d.f + h / 2 + d.open * (h - 0.12)
    }
    for (const [i, l] of this.lifts.entries()) {
      const def = this.map.lifts[i]
      const speed = 2.2
      if (l.state === 'low' && onLift(i)) {
        l.state = 'up'
        sound('lift', def.x0 + 1, def.z0 + 1)
      } else if (l.state === 'up') {
        l.y = Math.min(def.high, l.y + speed * dt)
        if (l.y >= def.high) {
          l.state = 'high'
          l.t = 3
        }
      } else if (l.state === 'high') {
        if (onLift(i)) l.t = 3
        l.t -= dt
        if (l.t <= 0) {
          l.state = 'down'
          sound('lift', def.x0 + 1, def.z0 + 1)
        }
      } else if (l.state === 'down') {
        l.y = Math.max(def.low, l.y - speed * dt)
        if (l.y <= def.low) {
          l.state = 'low'
          l.t = 1
        }
      }
      const depth = def.high - def.low + 0.5
      l.mesh.scale.y = depth
      l.mesh.position.y = l.y - depth / 2
    }
  }

  dispose() {
    for (const o of this.owned) o.dispose()
    this.group.removeFromParent()
  }
}

export { STEP }
