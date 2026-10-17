// Kherve Grand Prix: the place. A sky with its sun (and the same sky as the
// cars' reflections), rolling terrain that sits the circuit in the land, the
// asphalt (rubbered in along the racing line, white lines), red and white
// kerbs, mown grass run-off, gravel traps, Armco and Tecpro barriers with
// catch fences, the pit lane, pit wall and garages, the paddock with the
// team's two transporter trucks, grandstands full of people, the start
// gantry and its five red lights, a footbridge, billboards for the Kherve
// apps, marshal posts, braking boards, woods, mountains and clouds; Kherve
// Park adds wind turbines, farms and balloons, Lac Bleu its lake, boats,
// marina and village.

import * as THREE from 'three'
import { inRange, nearestSample, pitOffset, pointAt, type Track } from './f1Track.ts'
import { buildTruck, merge } from './f1Models.ts'
import { TEAMS } from './f1Race.ts'

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function rng(seed: number) {
  let a = seed >>> 0 || 1
  return () => {
    a ^= a << 13
    a ^= a >>> 17
    a ^= a << 5
    return ((a >>> 0) % 1e7) / 1e7
  }
}

/** Smooth value noise in [-1, 1]. */
function makeNoise(seed: number) {
  const r = rng(seed)
  const N = 256
  const perm = new Uint8Array(N * 2)
  const vals = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    perm[i] = i
    vals[i] = r() * 2 - 1
  }
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[perm[i], perm[j]] = [perm[j], perm[i]]
  }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i]
  const v = (x: number, y: number) => vals[perm[(perm[x & 255] + y) & 255]]
  return (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = xf * xf * (3 - 2 * xf)
    const w = yf * yf * (3 - 2 * yf)
    const a = v(xi, yi)
    const b = v(xi + 1, yi)
    const c = v(xi, yi + 1)
    const d = v(xi + 1, yi + 1)
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w
  }
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

function tex(c: HTMLCanvasElement, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, colors: string[], size: [number, number]) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0]
    const s = size[0] + Math.random() * (size[1] - size[0])
    g.fillRect(Math.random() * w, Math.random() * h, s, s)
  }
}

// ---------------------------------------------------------------- textures

function asphaltTexture(hw: number, edge: number) {
  const W = 1024
  const [c, g] = canvas(W, 1024)
  g.fillStyle = '#4a4d50'
  g.fillRect(0, 0, W, 1024)
  speckle(g, W, 1024, 90000, ['#3d4043', '#55585b', '#46494c', '#5e6164', '#393b3e'], [1, 2.5])
  speckle(g, W, 1024, 2500, ['#6d7073', '#2f3133'], [2, 4])
  // patches of repair
  g.globalAlpha = 0.08
  for (let i = 0; i < 12; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#202224' : '#6a6d70'
    g.fillRect(Math.random() * W, Math.random() * 1024, 40 + Math.random() * 200, 60 + Math.random() * 300)
  }
  g.globalAlpha = 1
  // white lines at the track edges (the ribbon spans ±(hw + edge))
  const span = 2 * (hw + edge)
  for (const sd of [-1, 1]) {
    const u = ((hw + edge + sd * hw) / span) * W
    const lw = (0.3 / span) * W
    g.fillStyle = '#e9ecef'
    g.fillRect(u - lw / 2, 0, lw, 1024)
  }
  // a slightly different shade beyond the lines
  g.globalAlpha = 0.12
  g.fillStyle = '#7a7d80'
  g.fillRect(0, 0, (edge / span) * W - 2, 1024)
  g.fillRect(W - (edge / span) * W + 2, 0, (edge / span) * W, 1024)
  g.globalAlpha = 1
  return tex(c)
}

function grassTexture(seed = 1) {
  const [c, g] = canvas(512, 512)
  g.fillStyle = '#4f7d31'
  g.fillRect(0, 0, 512, 512)
  const r = rng(seed)
  for (let i = 0; i < 60000; i++) {
    const v = r()
    g.fillStyle = v < 0.3 ? '#45722b' : v < 0.6 ? '#5a8a37' : v < 0.85 ? '#3f6a27' : '#6a9a42'
    const x = r() * 512
    const y = r() * 512
    g.fillRect(x, y, 1, 2 + r() * 3)
  }
  return tex(c)
}

function gravelTexture() {
  const [c, g] = canvas(512, 512)
  g.fillStyle = '#b9a68a'
  g.fillRect(0, 0, 512, 512)
  speckle(g, 512, 512, 50000, ['#a8957a', '#cdbb9f', '#9c8a70', '#d8c8ad', '#8e7d65'], [1, 3])
  return tex(c)
}

function kerbTexture() {
  const [c, g] = canvas(64, 256)
  g.fillStyle = '#d62026'
  g.fillRect(0, 0, 64, 128)
  g.fillStyle = '#f2f2f2'
  g.fillRect(0, 128, 64, 128)
  g.globalAlpha = 0.15
  speckle(g, 64, 256, 1500, ['#000', '#fff'], [1, 2])
  g.globalAlpha = 1
  return tex(c)
}

function armcoTexture() {
  const [c, g] = canvas(256, 128)
  g.fillStyle = '#3a3d40'
  g.fillRect(0, 0, 256, 128)
  for (const y of [28, 70]) {
    const grd = g.createLinearGradient(0, y, 0, y + 30)
    grd.addColorStop(0, '#d6dadf')
    grd.addColorStop(0.5, '#9aa0a6')
    grd.addColorStop(1, '#c4c9ce')
    g.fillStyle = grd
    g.fillRect(0, y, 256, 30)
  }
  g.fillStyle = '#2b2d30'
  for (const x of [0, 128]) g.fillRect(x, 0, 10, 128)
  return tex(c)
}

function tecproTexture() {
  const [c, g] = canvas(512, 128)
  const cols = ['#d61f26', '#f1f1f1', '#1f4fd8', '#f1f1f1']
  for (let i = 0; i < 4; i++) {
    g.fillStyle = cols[i]
    g.fillRect(i * 128, 0, 128, 128)
    g.fillStyle = 'rgba(0,0,0,0.25)'
    g.fillRect(i * 128, 0, 4, 128)
    g.fillRect(i * 128, 60, 128, 4)
  }
  return tex(c)
}

function fenceTexture() {
  const [c, g] = canvas(128, 128)
  g.clearRect(0, 0, 128, 128)
  g.strokeStyle = 'rgba(190,196,202,0.95)'
  g.lineWidth = 2
  for (let i = -128; i < 256; i += 16) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i + 128, 128)
    g.moveTo(i + 128, 0)
    g.lineTo(i, 128)
    g.stroke()
  }
  g.fillStyle = 'rgba(120,124,128,1)'
  g.fillRect(0, 0, 128, 4)
  g.fillRect(0, 124, 128, 4)
  return tex(c)
}

const ADS: [string, string, string, string][] = [
  ['KherveOS', 'an OS for the people', '#0d120f', '#22c55e'],
  ['KherveFitting', 'peak fitting for scientists', '#0b2a4a', '#5fd4ff'],
  ['KherveCAD', 'design in solid geometry', '#1c1c1c', '#ffb02e'],
  ['KherveSheet', 'spreadsheets with Python', '#0f3d24', '#e6ffe9'],
  ['Pyodide', 'Python in your browser', '#2b2b73', '#ffd43b'],
  ['Free software', 'GPL-3.0 · share it', '#f2f2f2', '#14532d'],
  ['KherveTeX', 'beautiful documents', '#3a1250', '#f5c542'],
  ['KherveBook', 'notebooks for everyone', '#103b3b', '#9ef3f7'],
]

function adTexture(i: number) {
  const [name, tag, bg, fg] = ADS[i % ADS.length]
  const [c, g] = canvas(512, 96)
  g.fillStyle = bg
  g.fillRect(0, 0, 512, 96)
  g.fillStyle = fg
  g.font = '900 50px system-ui, sans-serif'
  g.textBaseline = 'middle'
  g.fillText(name, 18, 40)
  g.font = '600 20px system-ui, sans-serif'
  g.globalAlpha = 0.85
  g.fillText(tag, 20, 78)
  g.globalAlpha = 1
  g.fillRect(0, 90, 512, 6)
  return tex(c, false)
}

function windowsTexture(cols: number, rows: number, frame: string, glass: string) {
  const [c, g] = canvas(512, 256)
  g.fillStyle = frame
  g.fillRect(0, 0, 512, 256)
  const w = 512 / cols
  const h = 256 / rows
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const grd = g.createLinearGradient(0, j * h, 0, j * h + h)
      grd.addColorStop(0, glass)
      grd.addColorStop(1, '#0a1016')
      g.fillStyle = grd
      g.fillRect(i * w + 3, j * h + 3, w - 6, h - 6)
    }
  }
  return tex(c, true)
}

function signTexture(text: string, bg: string, fg: string, w = 1024, h = 128) {
  const [c, g] = canvas(w, h)
  g.fillStyle = bg
  g.fillRect(0, 0, w, h)
  g.fillStyle = fg
  g.font = `900 ${Math.round(h * 0.55)}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, w / 2, h / 2 + 4)
  return tex(c, false)
}

function cloudTexture() {
  const [c, g] = canvas(256, 128)
  for (let i = 0; i < 26; i++) {
    const x = 40 + Math.random() * 176
    const y = 50 + Math.random() * 40 - Math.abs(x - 128) * 0.15
    const r = 18 + Math.random() * 30
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, 'rgba(255,255,255,0.9)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  return tex(c, false)
}

function waterNormal() {
  const N = 256
  const [c, g] = canvas(N, N)
  const img = g.createImageData(N, N)
  const nz = makeNoise(9)
  const h = (x: number, y: number) => nz(x / 9, y / 9) * 0.6 + nz(x / 4 + 30, y / 4) * 0.4
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = h((x + 1) % N, y) - h((x - 1 + N) % N, y)
      const dy = h(x, (y + 1) % N) - h(x, (y - 1 + N) % N)
      const i = (y * N + x) * 4
      img.data[i] = 128 + dx * 90
      img.data[i + 1] = 128 + dy * 90
      img.data[i + 2] = 255
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return tex(c, true, false)
}

// ---------------------------------------------------------------- sky

interface SkyLook {
  top: number
  horizon: number
  ground: number
  sun: THREE.Vector3
  sunColor: number
  sunIntensity: number
  hemiSky: number
  hemiGround: number
  hemi: number
  fog: number
  exposure: number
}

const SKIES: Record<'noon' | 'golden', SkyLook> = {
  noon: {
    top: 0x2f6fcf, horizon: 0xcfe2f1, ground: 0x6d7a5c, sun: new THREE.Vector3(0.45, 0.78, 0.35).normalize(),
    sunColor: 0xfff3df, sunIntensity: 3.1, hemiSky: 0xcfe6ff, hemiGround: 0x4d5a36, hemi: 0.9, fog: 0xc6d9e8, exposure: 1.0,
  },
  golden: {
    top: 0x35548f, horizon: 0xffc187, ground: 0x5c5040, sun: new THREE.Vector3(-0.72, 0.17, -0.55).normalize(),
    sunColor: 0xffb46e, sunIntensity: 3.0, hemiSky: 0xffd9b5, hemiGround: 0x4a3f30, hemi: 0.75, fog: 0xe7b78e, exposure: 1.05,
  },
}

function skyMesh(look: SkyLook): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(look.top) },
      horizon: { value: new THREE.Color(look.horizon) },
      ground: { value: new THREE.Color(look.ground) },
      sunDir: { value: look.sun.clone() },
      sunColor: { value: new THREE.Color(look.sunColor) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunColor;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55));
        c = mix(c, ground, smoothstep(0.0, -0.08, h));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunColor * (pow(s, 900.0) * 14.0 + pow(s, 40.0) * 0.45 + pow(s, 6.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const m = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), mat)
  m.frustumCulled = false
  m.renderOrder = -10
  return m
}

// ---------------------------------------------------------------- the world

export interface World {
  group: THREE.Group
  sun: THREE.DirectionalLight
  env: THREE.Texture
  fog: THREE.Fog
  exposure: number
  /** The start gantry's five pairs of red lights. */
  startLights: THREE.MeshStandardMaterial[]
  /** Trackside TV camera positions. */
  tvCams: THREE.Vector3[]
  /** Pit crews: one instanced body and helmet per crew member (team × 12). */
  crewBodies: THREE.InstancedMesh
  crewHeads: THREE.InstancedMesh
  heightAt(x: number, z: number): number
  update(dt: number, focus: THREE.Vector3, time: number): void
  dispose(): void
}

export function buildWorld(t: Track, renderer: THREE.WebGLRenderer, braking: number[]): World {
  const def = t.def
  const look = SKIES[def.sky]
  const group = new THREE.Group()
  const disposables: { dispose(): void }[] = []
  const keep = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x)
    return x
  }
  const hw = t.width / 2
  const EDGE = 2.5
  const pit = t.pit
  const ps = pit.side
  const R = rng(def.id === 'park' ? 11 : 23)
  const noise = makeNoise(def.id === 'park' ? 5 : 17)

  // ---- sky, light, fog, reflections
  const sky = skyMesh(look)
  group.add(sky)
  keep(sky.geometry)
  keep(sky.material as THREE.Material)
  const envScene = new THREE.Scene()
  envScene.add(skyMesh(look))
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromScene(envScene, 0.02, 0.1, 20000).texture
  pmrem.dispose()
  envScene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
    }
  })
  const hemi = new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemi)
  group.add(hemi)
  const sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const sc = sun.shadow.camera
  sc.left = -75
  sc.right = 75
  sc.top = 75
  sc.bottom = -75
  sc.near = 10
  sc.far = 900
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.04
  group.add(sun, sun.target)
  const fog = new THREE.Fog(look.fog, 500, def.sky === 'golden' ? 7800 : 6200)

  // ---- heights: the land around the circuit
  const lake = def.lake
  const flatZones: { s0: number; s1: number; o0: number; o1: number; y: number }[] = []
  const zoneY = (s: number) => pointAt(t, s).y
  flatZones.push({ s0: pit.entry - 60, s1: pit.exit + 60, o0: 0, o1: pit.garageOff + 150, y: zoneY(0) })
  const standZones = def.stands.map((st) => ({ s0: st.at - 10, s1: st.at + st.len + 10, side: st.side === 0 ? -ps : st.side }))

  const hills = (x: number, z: number) => {
    let h = noise(x / 520, z / 520) * 22 + noise(x / 180 + 7, z / 180 - 3) * 8 + noise(x / 60, z / 60) * 1.6
    const cx = (t.minX + t.maxX) / 2
    const cz = (t.minZ + t.maxZ) / 2
    const r = Math.hypot((x - cx) / 1.1, z - cz)
    h += Math.max(0, r - 1000) * 0.07
    if (lake) {
      const d = ((x - lake.x) / lake.rx) ** 2 + ((z - lake.z) / lake.rz) ** 2
      h = h + (-9 - h) * smooth(1.25, 0.85, d)
    }
    return h
  }
  const heightAt = (x: number, z: number) => {
    const q = nearestSample(t, x, z)
    const base = hills(x, z)
    if (q.i < 0) return base
    const i = q.i
    const d = (x - t.x[i]) * t.nx[i] + (z - t.z[i]) * t.nz[i]
    const run = d > 0 ? t.runR[i] : t.runL[i]
    const ty = t.y[i]
    // the paddock, pits and stands are level with the track
    const s = i * t.ds
    let flat = 0
    for (const f of flatZones) {
      if (inRange(s, f.s0, f.s1, t.len) && d * ps > -hw - 4 && d * ps < f.o1) flat = Math.max(flat, smooth(f.o1 + 30, f.o1, d * ps))
    }
    for (const st of standZones) {
      if (inRange(s, st.s0, st.s1, t.len) && d * st.side > 0 && d * st.side < run + 60) flat = Math.max(flat, 1)
    }
    const near = ty - 0.35
    const w = smooth(run + 4, run + 90, q.d)
    const h = near + (base - near) * w
    return h + (ty - 0.08 - h) * flat
  }

  // ---- terrain
  const grass = keep(grassTexture(3))
  {
    const pad = 1500
    const x0 = t.minX - pad
    const x1 = t.maxX + pad
    const z0 = t.minZ - pad
    const z1 = t.maxZ + pad
    const N = 280
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, N, Math.round((N * (z1 - z0)) / (x1 - x0)))
    geo.rotateX(-Math.PI / 2)
    geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2)
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute
    const col = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const y = heightAt(x, z)
      pos.setY(i, y)
      uv.setXY(i, x / 14, z / 14)
      const n1 = noise(x / 90 + 40, z / 90)
      const dry = smooth(0.25, 0.7, noise(x / 300 - 20, z / 300 + 11))
      const c = new THREE.Color().setRGB(0.92 + n1 * 0.12, 1.0 + n1 * 0.1, 0.85 + n1 * 0.08)
      c.lerp(new THREE.Color(1.25, 1.12, 0.7), dry * 0.45)
      // farmland: fields in a patchwork (wheat, fresh green, dark crops, ploughed earth) away from the circuit
      const qd = nearestSample(t, x, z)
      const away = qd.i < 0 ? 1 : smooth(90, 170, qd.d - (qd.d > 0 ? Math.max(t.runL[qd.i], t.runR[qd.i]) : 0))
      if (away > 0 && y < 70 && !(lake && y < 1)) {
        const fx = Math.floor((x * 0.8 + z * 0.6) / 140)
        const fz = Math.floor((-x * 0.6 + z * 0.8) / 110)
        const h = Math.abs(Math.sin(fx * 12.9898 + fz * 78.233) * 43758.5453) % 1
        const fields = [new THREE.Color(1.7, 1.42, 0.55), new THREE.Color(0.95, 1.3, 0.5), new THREE.Color(0.55, 0.72, 0.38), new THREE.Color(1.2, 0.9, 0.62), new THREE.Color(1.05, 1.18, 0.62), c.clone()]
        const fc = fields[Math.floor(h * fields.length)]
        c.lerp(fc, away * 0.9)
      }
      if (lake && y < -1.5) c.setRGB(0.8, 0.75, 0.55)
      if (y > 60) c.lerp(new THREE.Color(0.8, 0.82, 0.78), smooth(60, 140, y))
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.computeVertexNormals()
    const m = new THREE.Mesh(keep(geo), keep(new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 0.95 })))
    m.receiveShadow = true
    group.add(m)
  }

  // ---- ribbons along the track
  /** A strip between lateral offsets a(i) and b(i) (signed), at height y + dy, for samples in [i0, i1]. */
  const ribbon = (
    i0: number,
    i1: number,
    a: (i: number) => number,
    b: (i: number) => number,
    dy: (i: number, f: number) => number,
    cols: number,
    uvf: (i: number, f: number, off: number) => [number, number],
    color?: (i: number, f: number, off: number) => number,
  ) => {
    const pos: number[] = []
    const uv: number[] = []
    const col: number[] = []
    const idx: number[] = []
    let rows = 0
    for (let k = i0; k <= i1; k++) {
      const i = ((k % t.n) + t.n) % t.n
      for (let c = 0; c <= cols; c++) {
        const f = c / cols
        const off = a(i) + (b(i) - a(i)) * f
        pos.push(t.x[i] + t.nx[i] * off, t.y[i] + dy(i, f), t.z[i] + t.nz[i] * off)
        const [u, v] = uvf(k, f, off)
        uv.push(u, v)
        if (color) {
          const g = color(i, f, off)
          col.push(g, g, g)
        }
      }
      rows++
    }
    const w = cols + 1
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        const p = r * w + c
        // counter-clockwise seen from above: the strips face up
        idx.push(p, p + 1, p + w, p + 1, p + w + 1, p + w)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return keep(g)
  }
  /** Runs of samples where pred holds: [start, end] pairs (end may pass n: it wraps). */
  const runs = (pred: (i: number) => boolean): [number, number][] => {
    const out: [number, number][] = []
    let i0 = 0
    while (i0 < t.n && pred(i0)) i0++
    if (i0 === t.n) return [[0, t.n]]
    let from = -1
    for (let k = i0; k <= i0 + t.n; k++) {
      const on = k < i0 + t.n && pred(k % t.n)
      if (on && from < 0) from = k
      if (!on && from >= 0) {
        out.push([from, k])
        from = -1
      }
    }
    return out
  }
  const sOf = (k: number) => k * t.ds

  // asphalt, rubbered in along the racing line
  const asphalt = keep(asphaltTexture(hw, EDGE))
  const asphaltMat = keep(new THREE.MeshStandardMaterial({ map: asphalt, vertexColors: true, roughness: 0.88, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }))
  {
    const g = ribbon(0, t.n, () => -(hw + EDGE), () => hw + EDGE, () => 0.02, 18, (k, f) => [f, sOf(k) / 22], (i, _f, off) => {
      const line = t.line[i]
      const rub = Math.exp(-(((off - line) / 1.6) ** 2))
      return 1 - rub * 0.28 - (Math.abs(off) > hw ? 0.04 : 0)
    })
    const m = new THREE.Mesh(g, asphaltMat)
    m.receiveShadow = true
    group.add(m)
  }

  // grass run-off (mown in bands) and gravel traps, to the barriers
  const grassMat = keep(new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 }))
  const gravel = keep(gravelTexture())
  const gravelMat = keep(new THREE.MeshStandardMaterial({ map: gravel, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 }))
  for (const sd of [-1, 1]) {
    const run = sd < 0 ? t.runL : t.runR
    const gravelArr = sd < 0 ? t.gravelL : t.gravelR
    const inner = () => sd * (hw + EDGE - 0.1)
    const outer = (i: number) => sd * (run[i] + 1.5)
    const band = (k: number) => (Math.floor(sOf(k) / 12) % 2 === 0 ? 1.0 : 0.82)
    const g = ribbon(0, t.n, sd < 0 ? outer : inner, sd < 0 ? inner : outer, () => -0.02, 3, (k, _f, off) => [off / 9, sOf(k) / 9], (i) => band(i))
    const m = new THREE.Mesh(g, grassMat)
    m.receiveShadow = true
    group.add(m)
    for (const [a, b] of runs((i) => gravelArr[i] === 1)) {
      const gi = () => sd * (hw + EDGE + 1.2)
      const go = (i: number) => sd * Math.max(hw + EDGE + 3, run[i] - 1.2)
      const gg = ribbon(a, b, sd < 0 ? go : gi, sd < 0 ? gi : go, () => 0.0, 3, (k, _f, off) => [off / 6, sOf(k) / 6])
      const gm = new THREE.Mesh(gg, gravelMat)
      gm.receiveShadow = true
      group.add(gm)
    }
  }

  // kerbs: sloped, red and white
  const kerbMat = keep(new THREE.MeshStandardMaterial({ map: keep(kerbTexture()), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
  for (const sd of [-1, 1]) {
    const arr = sd < 0 ? t.kerbL : t.kerbR
    for (const [a, b] of runs((i) => arr[i] === 1)) {
      const ki = () => sd * (hw - 0.05)
      const ko = () => sd * (hw + 1.5)
      const g = ribbon(a, b, sd < 0 ? ko : ki, sd < 0 ? ki : ko, (_i, f) => 0.03 + (sd < 0 ? 1 - f : f) * 0.07, 2, (k, f) => [f, sOf(k) / 2.2])
      const m = new THREE.Mesh(g, kerbMat)
      m.receiveShadow = true
      group.add(m)
    }
  }

  // start/finish line, grid boxes
  {
    const [c, g] = canvas(256, 64)
    g.fillStyle = '#f2f2f2'
    g.fillRect(0, 0, 256, 64)
    g.fillStyle = '#111'
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) if ((x + y) % 2) g.fillRect(x * 16, y * 16, 16, 16)
    const chk = keep(tex(c, false))
    const lineMat = keep(new THREE.MeshStandardMaterial({ map: chk, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }))
    const p = pointAt(t, 0)
    const pl = keep(new THREE.PlaneGeometry(t.width, 1.6))
    const m = new THREE.Mesh(pl, lineMat)
    m.rotation.x = -Math.PI / 2
    m.rotation.z = -Math.atan2(p.tz, p.tx) - Math.PI / 2
    m.position.set(p.x, p.y + 0.035, p.z)
    m.receiveShadow = true
    group.add(m)
    const white = keep(new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }))
    const marks: THREE.BufferGeometry[] = []
    const lineSide = Math.sign(t.line[30]) || 1
    for (let k = 0; k < 12; k++) {
      const s = -14 - k * 8
      const lat = (k % 2 === 0 ? lineSide : -lineSide) * 2.7
      const q = pointAt(t, s + 2.6, lat)
      const h = Math.atan2(q.tz, q.tx)
      for (const [w, d, ox, oz] of [[0.25, 2.4, 0, 0], [1.8, 0.2, -0.8, 1.15], [1.8, 0.2, -0.8, -1.15]] as [number, number, number, number][]) {
        const gg = new THREE.PlaneGeometry(w, d)
        gg.rotateX(-Math.PI / 2)
        gg.translate(ox, 0, oz)
        gg.rotateY(-h)
        gg.translate(q.x, q.y + 0.034, q.z)
        marks.push(gg)
      }
    }
    const gm = new THREE.Mesh(keep(merge(marks)), white)
    gm.receiveShadow = true
    group.add(gm)
  }

  // ---- barriers: Armco on the straights, Tecpro where there is gravel; catch fences on top
  const armcoMat = keep(new THREE.MeshStandardMaterial({ map: keep(armcoTexture()), roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }))
  const tecproMat = keep(new THREE.MeshStandardMaterial({ map: keep(tecproTexture()), roughness: 0.7, side: THREE.DoubleSide }))
  const fenceTex = keep(fenceTexture())
  const fenceMat = keep(new THREE.MeshStandardMaterial({ map: fenceTex, alphaTest: 0.4, transparent: false, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 }))
  const postPts: THREE.Matrix4[] = []
  const pitOpen = (s: number) => inRange(s, pit.entry - 4, pit.exit + 4, t.len)
  for (const sd of [-1, 1]) {
    const run = sd < 0 ? t.runL : t.runR
    const gravelArr = sd < 0 ? t.gravelL : t.gravelR
    const near = (i: number) => {
      for (let j = -12; j <= 12; j++) if (gravelArr[(i + j + t.n) % t.n]) return true
      return false
    }
    const skip = (i: number) => sd === ps && pitOpen(i * t.ds)
    for (const tecpro of [false, true]) {
      for (const [a, b] of runs((i) => !skip(i) && near(i) === tecpro)) {
        const h = tecpro ? 1.15 : 0.95
        // a = b: a vertical strip
        const wall = ribbon(a, b, (i) => sd * (run[i] + 0.3), (i) => sd * (run[i] + 0.3), (_i, f) => -0.3 + f * (h + 0.3), 1, (k, f) => [sOf(k) / 4, f])
        const m = new THREE.Mesh(wall, tecpro ? tecproMat : armcoMat)
        m.castShadow = true
        m.receiveShadow = true
        group.add(m)
        const fence = ribbon(a, b, (i) => sd * (run[i] + 0.6), (i) => sd * (run[i] + 0.6), (_i, f) => h + f * 3.2, 1, (k, f) => [sOf(k) / 3, f * 1.1])
        group.add(new THREE.Mesh(fence, fenceMat))
        for (let k = a; k <= b; k += 3) {
          const i = k % t.n
          const off = sd * (run[i] + 0.6)
          postPts.push(new THREE.Matrix4().makeTranslation(t.x[i] + t.nx[i] * off, t.y[i] + 2.1, t.z[i] + t.nz[i] * off))
        }
      }
    }
  }
  {
    const postGeo = keep(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 6))
    const postMat = keep(new THREE.MeshStandardMaterial({ color: 0x8c9197, metalness: 0.7, roughness: 0.4 }))
    const posts = new THREE.InstancedMesh(postGeo, postMat, postPts.length)
    postPts.forEach((m, k) => posts.setMatrixAt(k, m))
    posts.castShadow = true
    group.add(posts)
  }

  // ---- billboards (Kherve apps) behind the barriers, braking boards before the big stops
  {
    const adMats = ADS.map((_, i) => keep(new THREE.MeshStandardMaterial({ map: keep(adTexture(i)), roughness: 0.6 })))
    const back = keep(new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.8 }))
    const panels: THREE.BufferGeometry[][] = ADS.map(() => [])
    const frames: THREE.BufferGeometry[] = []
    let n = 0
    for (let s = 40; s < t.len - 40; s += 70) {
      const i = Math.floor(s / t.ds)
      for (const sd of [-1, 1]) {
        if ((n + (sd > 0 ? 1 : 0)) % 2) continue
        if (sd === ps && pitOpen(s)) continue
        const run = sd < 0 ? t.runL[i] : t.runR[i]
        const off = sd * (run + 2.2)
        const m = new THREE.Matrix4().makeRotationY(Math.atan2(-t.nx[i] * sd, -t.nz[i] * sd))
        m.setPosition(t.x[i] + t.nx[i] * off, t.y[i], t.z[i] + t.nz[i] * off)
        panels[n % ADS.length].push(new THREE.PlaneGeometry(9, 1.7).translate(0, 2.25, 0.07).applyMatrix4(m))
        frames.push(new THREE.BoxGeometry(9.2, 1.9, 0.12).translate(0, 2.25, 0).applyMatrix4(m))
        for (const lx of [-3.5, 3.5]) frames.push(new THREE.CylinderGeometry(0.06, 0.06, 2, 6).translate(lx, 0.6, -0.05).applyMatrix4(m))
      }
      n++
    }
    panels.forEach((list, k) => list.length && group.add(new THREE.Mesh(keep(merge(list)), adMats[k])))
    if (frames.length) {
      const fm = new THREE.Mesh(keep(merge(frames)), back)
      fm.castShadow = true
      group.add(fm)
    }
    // braking boards: 300, 200, 100 before the big stops, on the outside
    const boardMats = [300, 200, 100].map((d) => keep(new THREE.MeshStandardMaterial({ map: keep(signTexture(String(d), '#f4f4f4', '#111', 256, 160)), roughness: 0.6 })))
    const boardG = keep(new THREE.PlaneGeometry(1.4, 0.9))
    for (const sb of braking) {
      for (let k = 0; k < 3; k++) {
        const s = sb - (3 - k) * 100
        const i = Math.floor((((s % t.len) + t.len) % t.len) / t.ds)
        const sd = t.k[(i + 50) % t.n] > 0 ? -1 : 1
        if (sd === ps && pitOpen(s)) continue
        const off = sd * (hw + EDGE + 1.5)
        const m = new THREE.Mesh(boardG, boardMats[k])
        m.position.set(t.x[i] + t.nx[i] * off, t.y[i] + 0.75, t.z[i] + t.nz[i] * off)
        m.rotation.y = Math.atan2(-t.tx[i], -t.tz[i])
        group.add(m)
      }
    }
  }

  // ---- marshal posts and TV cameras
  const tvCams: THREE.Vector3[] = []
  {
    const hutG = keep(new THREE.BoxGeometry(2.2, 2.4, 2.2))
    const hutM = keep(new THREE.MeshStandardMaterial({ color: 0xf28c28, roughness: 0.7 }))
    const roofM = keep(new THREE.MeshStandardMaterial({ color: 0xe9e9e9, roughness: 0.6 }))
    const roofG = keep(new THREE.BoxGeometry(2.8, 0.2, 2.8))
    let k = 0
    for (let s = 150; s < t.len - 80; s += 330) {
      const i = Math.floor(s / t.ds)
      const sd = k++ % 2 ? 1 : -1
      if (sd === ps && pitOpen(s)) continue
      const run = sd < 0 ? t.runL[i] : t.runR[i]
      const off = sd * (run + 4)
      const hut = new THREE.Mesh(hutG, hutM)
      hut.position.set(t.x[i] + t.nx[i] * off, t.y[i] + 1.2, t.z[i] + t.nz[i] * off)
      hut.castShadow = true
      const roof = new THREE.Mesh(roofG, roofM)
      roof.position.copy(hut.position).y += 1.3
      group.add(hut, roof)
    }
    k = 0
    for (let s = 60; s < t.len; s += 210) {
      const i = Math.floor(s / t.ds)
      const sd = t.k[(i + 30) % t.n] > 0 ? -1 : 1
      const run = sd < 0 ? t.runL[i] : t.runR[i]
      const off = sd * (run + 6)
      tvCams.push(new THREE.Vector3(t.x[i] + t.nx[i] * off, t.y[i] + 5.5, t.z[i] + t.nz[i] * off))
      k++
    }
  }

  // ---- the pit lane, pit wall, garages, paddock
  const concrete = keep(new THREE.MeshStandardMaterial({ color: 0xc9c6bf, roughness: 0.85 }))
  const steel = keep(new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.7 }))
  const darkM = keep(new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.8 }))
  {
    // the lane's surface
    const pi0 = Math.floor(pit.entry / t.ds)
    let pi1 = Math.ceil(pit.exit / t.ds)
    if (pi1 < pi0) pi1 += t.n
    const lane = (i: number) => Math.abs(pitOffset(t, i * t.ds))
    const full = (i: number) => lane(i) / pit.laneOff
    const inner = (i: number) => ps * Math.max(hw + EDGE - 0.3, lane(i) - 4.8)
    const outer = (i: number) => ps * (lane(i) + 4.8 + Math.pow(full(i), 6) * (pit.garageOff - pit.laneOff - 4.8))
    const g = ribbon(pi0, pi1, ps < 0 ? outer : inner, ps < 0 ? inner : outer, () => 0.025, 8, (k, f) => [f * 0.4, sOf(k) / 22], () => 1.05)
    const m = new THREE.Mesh(g, asphaltMat)
    m.receiveShadow = true
    group.add(m)
    // lines: between the fast lane and the boxes; the limiter lines; the team boxes
    const lineM = keep(new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }))
    const quads: THREE.BufferGeometry[] = []
    const quad = (s: number, off: number, len: number, wid: number, y = 0.04) => {
      const q = pointAt(t, s, off)
      const gg = new THREE.PlaneGeometry(len, wid)
      gg.rotateX(-Math.PI / 2)
      gg.rotateY(-Math.atan2(q.tz, q.tx))
      gg.translate(q.x, q.y + y, q.z)
      quads.push(gg)
    }
    for (let s = pit.entryFull; inRange(s, pit.entryFull, pit.exitStart, t.len); s += 4) quad(s, ps * (pit.laneOff + 3), 4, 0.15)
    for (const s of [pit.limitIn, pit.limitOut]) {
      for (let o = 0; o < 9; o++) quad(s, ps * (pit.laneOff - 4 + o), 0.3, 1.0)
    }
    group.add(new THREE.Mesh(keep(merge(quads)), lineM))
    TEAMS.forEach((team, k) => {
      const boxM = keep(new THREE.MeshStandardMaterial({ color: team.color2, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }))
      const qs: THREE.BufferGeometry[] = []
      const s0 = pit.boxes[k]
      for (const [ds, dof, l, w] of [[-3, 0, 0.25, 3.6], [3.4, 0, 0.25, 3.6], [0.2, 1.8, 6.6, 0.2], [0.2, -1.8, 6.6, 0.2]] as [number, number, number, number][]) {
        const q = pointAt(t, s0 + ds, ps * (pit.boxOff + dof))
        const gg = new THREE.PlaneGeometry(l, w)
        gg.rotateX(-Math.PI / 2)
        gg.rotateY(-Math.atan2(q.tz, q.tx))
        gg.translate(q.x, q.y + 0.045, q.z)
        qs.push(gg)
      }
      group.add(new THREE.Mesh(keep(merge(qs)), boxM))
    })
    // pit wall with its fence and the teams' stands
    const wallParts: THREE.BufferGeometry[] = []
    const fenceParts: THREE.BufferGeometry[] = []
    for (let s = pit.entryFull; inRange(s, pit.entryFull, pit.exitStart - 4, t.len); s += 4) {
      const q = pointAt(t, s + 2, ps * pit.wallOff)
      const h = -Math.atan2(q.tz, q.tx)
      wallParts.push(new THREE.BoxGeometry(4.02, 1.1, 0.7).rotateY(h).translate(q.x, q.y + 0.55, q.z))
      fenceParts.push(new THREE.PlaneGeometry(4.02, 2.6).rotateY(h).translate(q.x, q.y + 2.4, q.z))
    }
    const wm = new THREE.Mesh(keep(merge(wallParts)), concrete)
    wm.castShadow = true
    wm.receiveShadow = true
    group.add(wm)
    group.add(new THREE.Mesh(keep(merge(fenceParts)), fenceMat))
    TEAMS.forEach((team, k) => {
      const q = pointAt(t, pit.boxes[k], ps * (pit.wallOff + 1.6))
      const h = -Math.atan2(q.tz, q.tx)
      const st = new THREE.Group()
      st.position.set(q.x, q.y, q.z)
      st.rotation.y = h
      const roof = new THREE.Mesh(keep(new THREE.BoxGeometry(6, 0.15, 2.4)), keep(new THREE.MeshStandardMaterial({ color: team.color, roughness: 0.4, metalness: 0.3 })))
      roof.position.y = 2.6
      roof.castShadow = true
      const desk = new THREE.Mesh(keep(new THREE.BoxGeometry(5.6, 1.0, 1.2)), darkM)
      desk.position.y = 1.1
      const scr = new THREE.Mesh(keep(new THREE.BoxGeometry(5, 0.5, 0.06)), keep(new THREE.MeshStandardMaterial({ color: 0x0a1a2a, emissive: 0x1f4f7f, emissiveIntensity: 0.6 })))
      scr.position.set(0, 1.9, -ps * 0.3)
      const stripe = new THREE.Mesh(keep(new THREE.BoxGeometry(6.02, 0.25, 2.42)), keep(new THREE.MeshStandardMaterial({ color: team.color2 })))
      stripe.position.y = 2.45
      st.add(roof, desk, scr, stripe)
      for (const lx of [-2.8, 2.8]) {
        const leg = new THREE.Mesh(keep(new THREE.BoxGeometry(0.1, 2.6, 0.1)), steel)
        leg.position.set(lx, 1.3, 1)
        st.add(leg)
      }
      group.add(st)
    })

    // the pit building: garages on the ground floor, glass above, the race control tower
    const s0 = pit.boxes[0] - 22
    const s1 = pit.boxes[5] + 22
    const mid = pointAt(t, (s0 + s1) / 2, 0)
    const h = Math.atan2(mid.tz, mid.tx)
    const bLen = s1 - s0
    const depth = 16
    const bld = new THREE.Group()
    const front = pointAt(t, (s0 + s1) / 2, ps * pit.garageOff)
    bld.position.set(front.x, front.y, front.z)
    bld.rotation.y = -h
    group.add(bld)
    // local frame: x along the track, z away from it (towards the paddock) = ps * right
    const zz = (v: number) => v * ps
    const winTex = keep(windowsTexture(16, 2, '#3a3f45', '#5d88a8'))
    winTex.repeat.set(bLen / 40, 1)
    const glassM = keep(new THREE.MeshPhysicalMaterial({ map: winTex, roughness: 0.08, metalness: 0.6, clearcoat: 1 }))
    const shell = new THREE.Mesh(keep(new THREE.BoxGeometry(bLen, 4.4, depth)), concrete)
    shell.position.set(0, 7.0, zz(depth / 2))
    shell.castShadow = true
    shell.receiveShadow = true
    bld.add(shell)
    const glass = new THREE.Mesh(keep(new THREE.PlaneGeometry(bLen, 3.6)), glassM)
    glass.position.set(0, 7.0, zz(-0.02))
    if (ps > 0) glass.rotation.y = Math.PI
    bld.add(glass)
    const balcony = new THREE.Mesh(keep(new THREE.BoxGeometry(bLen, 0.3, 2.4)), concrete)
    balcony.position.set(0, 4.85, zz(-1.0))
    balcony.castShadow = true
    bld.add(balcony)
    const rail = new THREE.Mesh(keep(new THREE.BoxGeometry(bLen, 1.0, 0.05)), keep(new THREE.MeshPhysicalMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.35, roughness: 0.05 })))
    rail.position.set(0, 5.5, zz(-2.15))
    bld.add(rail)
    const roof = new THREE.Mesh(keep(new THREE.BoxGeometry(bLen + 4, 0.5, depth + 4)), keep(new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 })))
    roof.position.set(0, 9.45, zz(depth / 2 - 1))
    roof.castShadow = true
    bld.add(roof)
    const sign = new THREE.Mesh(keep(new THREE.PlaneGeometry(bLen * 0.6, 2.2)), keep(new THREE.MeshStandardMaterial({ map: keep(signTexture(`${def.name.toUpperCase()} · KHERVE GRAND PRIX`, '#0d120f', '#22c55e', 2048, 128)), roughness: 0.5, emissive: 0x0b3d1c, emissiveIntensity: 0.25 })))
    sign.position.set(0, 10.9, zz(-0.4))
    if (ps > 0) sign.rotation.y = Math.PI
    bld.add(sign)
    // garages
    const tyreG = keep(new THREE.CylinderGeometry(0.36, 0.36, 0.32, 16))
    const tyreM = keep(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }))
    const rackPos: THREE.Matrix4[] = []
    TEAMS.forEach((team, k) => {
      const gx = pit.boxes[k] - (s0 + s1) / 2
      const teamM = keep(new THREE.MeshStandardMaterial({ color: team.color, roughness: 0.6 }))
      const teamM2 = keep(new THREE.MeshStandardMaterial({ color: team.color2, roughness: 0.5 }))
      const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(14, depth)), keep(new THREE.MeshStandardMaterial({ color: 0xd9dcdf, roughness: 0.3, metalness: 0.1 })))
      floor.rotation.x = -Math.PI / 2
      floor.position.set(gx, 0.04, zz(depth / 2))
      floor.receiveShadow = true
      const backW = new THREE.Mesh(keep(new THREE.BoxGeometry(14, 4.8, 0.3)), teamM)
      backW.position.set(gx, 2.4, zz(depth - 0.2))
      const sideA = new THREE.Mesh(keep(new THREE.BoxGeometry(0.4, 4.8, depth)), concrete)
      sideA.position.set(gx - 7.2, 2.4, zz(depth / 2))
      sideA.castShadow = true
      const sideB = sideA.clone()
      sideB.position.x = gx + 7.2
      const ceil = new THREE.Mesh(keep(new THREE.BoxGeometry(14.4, 0.3, depth)), concrete)
      ceil.position.set(gx, 4.8, zz(depth / 2))
      const lamp = new THREE.Mesh(keep(new THREE.BoxGeometry(10, 0.08, 0.6)), keep(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9 })))
      lamp.position.set(gx, 4.6, zz(depth / 2))
      const signG = new THREE.Mesh(keep(new THREE.PlaneGeometry(12, 1.0)), keep(new THREE.MeshStandardMaterial({ map: keep(signTexture(team.name.toUpperCase(), team.color, team.color2, 1024, 96)), roughness: 0.5 })))
      signG.position.set(gx, 4.3, zz(-0.06))
      if (ps > 0) signG.rotation.y = Math.PI
      const stripe = new THREE.Mesh(keep(new THREE.BoxGeometry(14, 0.6, 0.32)), teamM2)
      stripe.position.set(gx, 1.2, zz(depth - 0.4))
      bld.add(floor, backW, sideA, sideB, ceil, lamp, signG, stripe)
      // tyre racks
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 3; c++) {
          for (const x0 of [gx - 6, gx + 4.5]) rackPos.push(new THREE.Matrix4().makeTranslation(x0 + c * 0.75, 0.2 + r * 0.34, zz(depth - 1.2)))
        }
      }
      // tool trolleys and screens
      const trolley = new THREE.Mesh(keep(new THREE.BoxGeometry(1.4, 1.1, 0.7)), teamM2)
      trolley.position.set(gx - 3.5, 0.55, zz(depth - 1.6))
      const screen = new THREE.Mesh(keep(new THREE.BoxGeometry(2.4, 1.3, 0.08)), keep(new THREE.MeshStandardMaterial({ color: 0x0a1a2a, emissive: 0x2a6fbf, emissiveIntensity: 0.5 })))
      screen.position.set(gx + 1.5, 2.6, zz(depth - 0.45))
      bld.add(trolley, screen)
    })
    const racks = new THREE.InstancedMesh(tyreG, tyreM, rackPos.length)
    rackPos.forEach((m, k) => racks.setMatrixAt(k, m))
    bld.add(racks)
    // race control tower by the start line
    const towerP = pointAt(t, 30, ps * (pit.garageOff + 6))
    const tower = new THREE.Mesh(keep(new THREE.BoxGeometry(10, 22, 10)), concrete)
    tower.position.set(towerP.x, towerP.y + 11, towerP.z)
    tower.rotation.y = -h
    tower.castShadow = true
    group.add(tower)
    const towerTop = new THREE.Mesh(keep(new THREE.BoxGeometry(13, 4, 13)), glassM)
    towerTop.position.set(towerP.x, towerP.y + 24, towerP.z)
    towerTop.rotation.y = -h
    group.add(towerTop)
    const towerCap = new THREE.Mesh(keep(new THREE.BoxGeometry(14, 0.6, 14)), keep(new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.4 })))
    towerCap.position.set(towerP.x, towerP.y + 26.3, towerP.z)
    towerCap.rotation.y = -h
    group.add(towerCap)

    // the paddock: asphalt, the two Kherve trucks behind their garage, the teams' motorhomes
    const padC = pointAt(t, (s0 + s1) / 2, ps * (pit.garageOff + depth + 45))
    const pad = new THREE.Mesh(keep(new THREE.PlaneGeometry(bLen + 120, 74)), keep(new THREE.MeshStandardMaterial({ map: asphalt, color: 0xc8c8c8, roughness: 0.9 })))
    pad.rotation.x = -Math.PI / 2
    pad.rotation.z = -h
    pad.position.set(padC.x, padC.y + 0.03, padC.z)
    pad.receiveShadow = true
    group.add(pad)
    for (let k = 0; k < 2; k++) {
      const truck = buildTruck(TEAMS[0])
      const tp = pointAt(t, pit.boxes[0] - 12, ps * (pit.garageOff + depth + 12 + k * 5.2))
      truck.position.set(tp.x, tp.y, tp.z)
      truck.rotation.y = -h
      group.add(truck)
      truck.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          disposables.push(o.geometry)
          disposables.push(o.material as THREE.Material)
        }
      })
    }
    TEAMS.forEach((team, k) => {
      if (k === 0) return
      const mp = pointAt(t, pit.boxes[k] - 6, ps * (pit.garageOff + depth + 52))
      const mh = new THREE.Group()
      mh.position.set(mp.x, mp.y, mp.z)
      mh.rotation.y = -h
      const base = new THREE.Mesh(keep(new THREE.BoxGeometry(18, 7, 9)), keep(new THREE.MeshPhysicalMaterial({ color: team.color, roughness: 0.3, clearcoat: 1 })))
      base.position.y = 3.5
      base.castShadow = true
      const band = new THREE.Mesh(keep(new THREE.BoxGeometry(18.1, 2.2, 9.1)), keep(new THREE.MeshPhysicalMaterial({ map: winTex, roughness: 0.1, metalness: 0.5 })))
      band.position.y = 4.6
      const top = new THREE.Mesh(keep(new THREE.BoxGeometry(18.6, 0.3, 9.6)), keep(new THREE.MeshStandardMaterial({ color: team.color2 })))
      top.position.y = 7.1
      mh.add(base, band, top)
      group.add(mh)
    })
    // a few parked cars and service tents in the paddock
    const tentM = keep(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7 }))
    for (let k = 0; k < 5; k++) {
      const tp = pointAt(t, s1 + 20 + k * 16, ps * (pit.garageOff + depth + 14 + (k % 2) * 22))
      const tent = new THREE.Mesh(keep(new THREE.ConeGeometry(6, 4, 4)), tentM)
      tent.position.set(tp.x, tp.y + 4.5, tp.z)
      tent.rotation.y = Math.PI / 4 - h
      const base = new THREE.Mesh(keep(new THREE.BoxGeometry(8.4, 2.5, 8.4)), tentM)
      base.position.set(tp.x, tp.y + 1.25, tp.z)
      base.rotation.y = -h
      tent.castShadow = base.castShadow = true
      group.add(tent, base)
    }
  }

  // ---- the start gantry and its lights
  const startLights: THREE.MeshStandardMaterial[] = []
  {
    const p = pointAt(t, 2, 0)
    const h = Math.atan2(p.tz, p.tx)
    const gan = new THREE.Group()
    gan.position.set(p.x, p.y, p.z)
    gan.rotation.y = -h
    const span = t.width + 6
    for (const sd of [-1, 1]) {
      const post = new THREE.Mesh(keep(new THREE.BoxGeometry(0.6, 8.2, 0.6)), steel)
      post.position.set(0, 4.1, sd * span / 2)
      post.castShadow = true
      gan.add(post)
    }
    const beam = new THREE.Mesh(keep(new THREE.BoxGeometry(0.9, 0.9, span)), steel)
    beam.position.set(0, 7.9, 0)
    beam.castShadow = true
    gan.add(beam)
    const pod = new THREE.Mesh(keep(new THREE.BoxGeometry(0.5, 1.5, 4.4)), darkM)
    pod.position.set(-0.6, 6.6, 0)
    gan.add(pod)
    const bulb = keep(new THREE.SphereGeometry(0.17, 12, 8))
    for (let c = 0; c < 5; c++) {
      const m = keep(new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 0 }))
      startLights.push(m)
      for (const y of [6.25, 6.85]) {
        const l = new THREE.Mesh(bulb, m)
        l.position.set(-0.86, y, -1.6 + c * 0.8)
        gan.add(l)
      }
    }
    const banner = new THREE.Mesh(keep(new THREE.PlaneGeometry(span - 1, 1.1)), keep(new THREE.MeshStandardMaterial({ map: keep(signTexture('KHERVE GRAND PRIX', '#0d120f', '#22c55e', 1024, 96)), roughness: 0.5 })))
    banner.position.set(-0.47, 7.9, 0)
    banner.rotation.y = -Math.PI / 2
    gan.add(banner)
    group.add(gan)
  }

  // ---- the footbridge
  {
    const s = def.bridge
    const p = pointAt(t, s, 0)
    const i = p.i
    const h = Math.atan2(p.tz, p.tx)
    const l = Math.min(t.runL[i], 30) + 4
    const r = Math.min(t.runR[i], 30) + 4
    const br = new THREE.Group()
    br.position.set(p.x, p.y, p.z)
    br.rotation.y = -h
    const deck = new THREE.Mesh(keep(new THREE.BoxGeometry(3.2, 0.6, l + r)), concrete)
    deck.position.set(0, 7.2, (r - l) / 2)
    deck.castShadow = true
    br.add(deck)
    const adM = keep(new THREE.MeshStandardMaterial({ map: keep(signTexture('KherveOS — an OS for the people · free & open source', '#22c55e', '#0d120f', 2048, 128)), roughness: 0.5 }))
    for (const sd of [-1, 1]) {
      const pan = new THREE.Mesh(keep(new THREE.PlaneGeometry(Math.min(l + r, 40), 1.6)), adM)
      pan.position.set(sd * 1.62, 8.3, 0)
      pan.rotation.y = sd > 0 ? Math.PI / 2 : -Math.PI / 2
      br.add(pan)
      const rail = new THREE.Mesh(keep(new THREE.BoxGeometry(0.08, 1.2, l + r)), steel)
      rail.position.set(sd * 1.55, 8.1, (r - l) / 2)
      br.add(rail)
    }
    for (const z of [-l, r]) {
      const tower = new THREE.Mesh(keep(new THREE.BoxGeometry(3.6, 7.2, 3.6)), concrete)
      tower.position.set(0, 3.6, z)
      tower.castShadow = true
      br.add(tower)
    }
    group.add(br)
  }

  // ---- grandstands full of people
  {
    const conc: THREE.BufferGeometry[] = []
    const seats: THREE.BufferGeometry[] = []
    const roofs: THREE.BufferGeometry[] = []
    const people: THREE.Matrix4[] = []
    const colors: THREE.Color[] = []
    const shirt = ['#e63946', '#f1faee', '#1d3557', '#22c55e', '#ffd43b', '#f97316', '#6b2bd9', '#111111', '#2f6fcf', '#ffffff', '#16a34a']
    for (const st of def.stands) {
      const side = st.side === 0 ? -ps : st.side
      const STEPS = 10
      for (let s = st.at; s < st.at + st.len; s += 8) {
        const i = Math.floor((((s % t.len) + t.len) % t.len) / t.ds)
        const run = side < 0 ? t.runL[i] : t.runR[i]
        const p = pointAt(t, s + 4, side * (run + 5))
        const h = Math.atan2(p.tz, p.tx)
        const m = new THREE.Matrix4().makeRotationY(-h)
        m.setPosition(p.x, p.y, p.z)
        const local = (g: THREE.BufferGeometry) => g.applyMatrix4(m)
        for (let k = 0; k < STEPS; k++) {
          const z = side * (k * 1.0 + 0.5)
          conc.push(local(new THREE.BoxGeometry(8.05, 0.5 + k * 0.5, 1.0).translate(0, (0.5 + k * 0.5) / 2, z)))
          seats.push(local(new THREE.BoxGeometry(8.0, 0.25, 0.45).translate(0, 0.5 + k * 0.5 + 0.12, z + side * 0.15)))
          for (let c = 0; c < 9; c++) {
            if (R() < 0.18) continue
            const pm = new THREE.Matrix4().makeTranslation(-3.6 + c * 0.9 + (R() - 0.5) * 0.3, 0.5 + k * 0.5 + 0.55, z - side * 0.05)
            pm.premultiply(m)
            people.push(pm)
            colors.push(new THREE.Color(shirt[(R() * shirt.length) | 0]))
          }
        }
        conc.push(local(new THREE.BoxGeometry(8.05, 7.5, 0.4).translate(0, 3.75, side * (STEPS + 0.2))))
        roofs.push(local(new THREE.BoxGeometry(8.2, 0.25, STEPS + 2.5).rotateX(side * 0.08).translate(0, 9.6, side * (STEPS / 2 - 0.5))))
        for (const zz of [0.2, STEPS]) conc.push(local(new THREE.BoxGeometry(0.25, 9.6, 0.25).translate(-4, 4.8, side * zz)))
      }
    }
    if (conc.length) {
      const c = new THREE.Mesh(keep(merge(conc)), concrete)
      c.castShadow = true
      c.receiveShadow = true
      const sm = new THREE.Mesh(keep(merge(seats)), keep(new THREE.MeshStandardMaterial({ color: 0x1f4fd8, roughness: 0.6 })))
      const rf = new THREE.Mesh(keep(merge(roofs)), keep(new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4, metalness: 0.3 })))
      rf.castShadow = true
      group.add(c, sm, rf)
      const personG = keep(merge([new THREE.BoxGeometry(0.42, 0.62, 0.3).translate(0, 0.31, 0), new THREE.SphereGeometry(0.13, 8, 6).translate(0, 0.78, 0)]))
      const crowd = new THREE.InstancedMesh(personG, keep(new THREE.MeshStandardMaterial({ roughness: 0.8 })), people.length)
      people.forEach((m, k) => {
        crowd.setMatrixAt(k, m)
        crowd.setColorAt(k, colors[k])
      })
      group.add(crowd)
    }
  }

  // ---- trees: pines, broad-leaved, poplars (instanced), kept off the circuit and the paddock
  const treeMeshes: THREE.InstancedMesh[] = []
  {
    const colorGeo = (g: THREE.BufferGeometry, c: THREE.Color) => {
      const n = g.getAttribute('position').count
      const a = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        a[i * 3] = c.r
        a[i * 3 + 1] = c.g
        a[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3))
      return g
    }
    const withColor = (list: [THREE.BufferGeometry, number][]) => {
      const gs = list.map(([g, c]) => {
        const n = g.index ? g.toNonIndexed() : g
        colorGeo(n, new THREE.Color(c))
        return n
      })
      const merged = new THREE.BufferGeometry()
      const pos: number[] = []
      const nor: number[] = []
      const col: number[] = []
      for (const g of gs) {
        g.computeVertexNormals()
        for (const v of g.getAttribute('position').array) pos.push(v)
        for (const v of g.getAttribute('normal').array) nor.push(v)
        for (const v of g.getAttribute('color').array) col.push(v)
      }
      merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
      merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
      return keep(merged)
    }
    const pine = withColor([
      [new THREE.CylinderGeometry(0.25, 0.35, 3, 6).translate(0, 1.5, 0), 0x5a3d22],
      [new THREE.ConeGeometry(3.2, 5, 11, 2).translate(0, 4.6, 0), 0x2b5526],
      [new THREE.ConeGeometry(2.7, 4.6, 11, 2).translate(0, 7.0, 0), 0x31602c],
      [new THREE.ConeGeometry(2.0, 4, 10, 2).translate(0, 9.4, 0), 0x376a31],
      [new THREE.ConeGeometry(1.2, 3.2, 9, 1).translate(0, 11.6, 0), 0x3d7336],
    ])
    const leafy = withColor([
      [new THREE.CylinderGeometry(0.3, 0.45, 4, 6).translate(0, 2, 0), 0x5b4128],
      [new THREE.CylinderGeometry(0.12, 0.2, 2.4, 5).rotateZ(0.6).translate(0.8, 4.2, 0), 0x5b4128],
      [new THREE.IcosahedronGeometry(3.4, 2).scale(1, 0.85, 1).translate(0, 6, 0), 0x4b7a2c],
      [new THREE.IcosahedronGeometry(2.4, 2).translate(1.9, 7.3, 0.7), 0x568a33],
      [new THREE.IcosahedronGeometry(2.2, 2).translate(-1.7, 6.9, -0.9), 0x447025],
      [new THREE.IcosahedronGeometry(1.9, 1).translate(0.2, 8.6, -1.4), 0x5c9238],
    ])
    const poplar = withColor([
      [new THREE.CylinderGeometry(0.2, 0.3, 3, 6).translate(0, 1.5, 0), 0x5b4128],
      [new THREE.SphereGeometry(1.6, 8, 10).scale(1, 4.2, 1).translate(0, 8, 0), 0x3f7a2f],
    ])
    // the foliage is shaded a little unevenly, like leaves
    for (const g of [pine, leafy, poplar]) {
      const pos = g.getAttribute('position') as THREE.BufferAttribute
      const col = g.getAttribute('color') as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        const j = 0.85 + 0.3 * Math.abs(Math.sin(pos.getX(i) * 3.1 + pos.getY(i) * 1.7 + pos.getZ(i) * 2.3))
        const lift = 0.8 + 0.25 * Math.min(1, pos.getY(i) / 10)
        col.setXYZ(i, col.getX(i) * j * lift, col.getY(i) * j * lift, col.getZ(i) * j * lift)
      }
    }
    const treeMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }))
    const kinds = [pine, leafy, poplar]
    // [kind][0 near the track: casts shadows, 1 far: does not]
    const lists: THREE.Matrix4[][][] = [[[], []], [[], []], [[], []]]
    const tint: THREE.Color[][][] = [[[], []], [[], []], [[], []]]
    const pad = 1100
    const x0 = t.minX - pad
    const x1 = t.maxX + pad
    const z0 = t.minZ - pad
    const z1 = t.maxZ + pad
    const want = 5200
    let tries = 0
    let placed = 0
    while (placed < want && tries < want * 8) {
      tries++
      const x = x0 + R() * (x1 - x0)
      const z = z0 + R() * (z1 - z0)
      const woods = noise(x / 260 + 100, z / 260 - 50)
      if (woods < -0.05 && R() > 0.12) continue
      const q = nearestSample(t, x, z)
      let far = 1
      if (q.i >= 0) {
        const i = q.i
        const d = (x - t.x[i]) * t.nx[i] + (z - t.z[i]) * t.nz[i]
        const run = d > 0 ? t.runR[i] : t.runL[i]
        if (q.d < run + 14) continue
        if (q.d < run + 70) far = 0
        const s = i * t.ds
        if (inRange(s, pit.entry - 80, pit.exit + 80, t.len) && d * ps > 0 && d * ps < pit.garageOff + 170) continue
        let stand = false
        for (const st of standZones) if (inRange(s, st.s0 - 10, st.s1 + 10, t.len) && d * st.side > 0 && q.d < run + 30) stand = true
        if (stand) continue
      }
      const y = heightAt(x, z)
      if (lake && y < 0.5) continue
      const kind = woods > 0.3 ? (R() < 0.75 ? 0 : 1) : R() < 0.25 ? 2 : R() < 0.5 ? 0 : 1
      const sc = 0.75 + R() * 0.7
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.3, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28), new THREE.Vector3(sc, sc * (0.85 + R() * 0.4), sc))
      lists[kind][far].push(m)
      tint[kind][far].push(new THREE.Color().setHSL(0.24 + (R() - 0.5) * 0.06, 0.5 + R() * 0.25, 0.42 + R() * 0.18).multiplyScalar(2.2))
      placed++
    }
    kinds.forEach((g, k) => {
      for (const far of [0, 1]) {
        const list = lists[k][far]
        if (!list.length) continue
        const im = new THREE.InstancedMesh(g, treeMat, list.length)
        list.forEach((m, j) => {
          im.setMatrixAt(j, m)
          im.setColorAt(j, tint[k][far][j])
        })
        im.castShadow = far === 0
        im.receiveShadow = far === 0
        group.add(im)
        treeMeshes.push(im)
      }
    })
  }

  // ---- mountains on the horizon
  {
    const cx = (t.minX + t.maxX) / 2
    const cz = (t.minZ + t.maxZ) / 2
    const snow = def.sky === 'golden'
    const parts: THREE.BufferGeometry[] = []
    const M = 30
    for (let k = 0; k < M; k++) {
      const a = (k / M) * Math.PI * 2 + R() * 0.15
      const r = 3300 + R() * 900
      const hgt = (snow ? 650 : 330) + R() * (snow ? 650 : 280)
      const rad = 700 + R() * 600
      const g = new THREE.ConeGeometry(rad, hgt, 30, 12).toNonIndexed()
      const pos = g.getAttribute('position') as THREE.BufferAttribute
      const col = new Float32Array(pos.count * 3)
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i)
        const y = pos.getY(i)
        const z = pos.getZ(i)
        const n = noise(x / 160 + k * 13, z / 160 + y / 200) * 0.22 + noise(x / 50 + k * 7, z / 50 - y / 60) * 0.08
        pos.setX(i, x * (1 + n))
        pos.setZ(i, z * (1 + n))
        // ridges: the slopes are not smooth
        pos.setY(i, y + noise(x / 90 + k, z / 90) * hgt * 0.06 * (1 - Math.abs((y + hgt / 2) / hgt - 0.5) * 2))
        const hh = (y + hgt / 2) / hgt
        const c = new THREE.Color(snow ? 0x51624a : 0x4f6e3c)
        c.lerp(new THREE.Color(0x7d7f80), smooth(0.25, 0.6, hh + n))
        if (snow) c.lerp(new THREE.Color(0xf4f6f8), smooth(0.55, 0.72, hh + n * 0.8))
        col[i * 3] = c.r
        col[i * 3 + 1] = c.g
        col[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      g.translate(cx + Math.cos(a) * r, hgt / 2 - 40, cz + Math.sin(a) * r)
      parts.push(g)
    }
    // merged by hand: merge() keeps no colours
    const merged = new THREE.BufferGeometry()
    const pos: number[] = []
    const col: number[] = []
    for (const g of parts) {
      for (const v of g.getAttribute('position').array) pos.push(v)
      for (const v of g.getAttribute('color').array) col.push(v)
      g.dispose()
    }
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    merged.computeVertexNormals()
    group.add(new THREE.Mesh(keep(merged), keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }))))
  }

  // ---- clouds
  const clouds: THREE.Sprite[] = []
  {
    const ct = keep(cloudTexture())
    const cm = keep(new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: def.sky === 'golden' ? 0.85 : 0.95, color: def.sky === 'golden' ? 0xffd2b0 : 0xffffff }))
    const cx = (t.minX + t.maxX) / 2
    const cz = (t.minZ + t.maxZ) / 2
    for (let k = 0; k < 34; k++) {
      const s = new THREE.Sprite(cm)
      const a = R() * Math.PI * 2
      const r = 300 + R() * 2600
      s.position.set(cx + Math.cos(a) * r, 520 + R() * 500, cz + Math.sin(a) * r)
      const w = 500 + R() * 700
      s.scale.set(w, w * 0.42, 1)
      group.add(s)
      clouds.push(s)
    }
  }

  // ---- extras of each circuit
  const spinners: { obj: THREE.Object3D; speed: number }[] = []
  const drifters: { obj: THREE.Object3D; c: THREE.Vector3; r: number; a: number; speed: number; bob: number }[] = []
  let waterTex: THREE.Texture | null = null
  const white = keep(new THREE.MeshStandardMaterial({ color: 0xf2f4f5, roughness: 0.5 }))
  if (def.id === 'park') {
    // wind turbines on the ridge, a few farms, balloons
    const cx = (t.minX + t.maxX) / 2
    for (let k = 0; k < 7; k++) {
      const x = cx - 900 + k * 300 + R() * 60
      const z = t.maxZ + 520 + Math.sin(k * 1.3) * 80
      const y = heightAt(x, z)
      const tw = new THREE.Group()
      tw.position.set(x, y, z)
      const tower = new THREE.Mesh(keep(new THREE.CylinderGeometry(1.2, 2.2, 70, 12)), white)
      tower.position.y = 35
      tower.castShadow = true
      const nac = new THREE.Mesh(keep(new THREE.BoxGeometry(7, 3.2, 3.2)), white)
      nac.position.set(0, 71, 0)
      const rotor = new THREE.Group()
      rotor.position.set(3.8, 71, 0)
      const hub = new THREE.Mesh(keep(new THREE.SphereGeometry(1.4, 12, 8)), white)
      rotor.add(hub)
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(keep(new THREE.BoxGeometry(0.4, 30, 2.2).translate(0, 16, 0)), white)
        blade.rotation.x = (b * Math.PI * 2) / 3
        rotor.add(blade)
      }
      tw.rotation.y = -0.5
      tw.add(tower, nac, rotor)
      group.add(tw)
      spinners.push({ obj: rotor, speed: 0.9 + R() * 0.4 })
    }
    const barnWall = keep(new THREE.MeshStandardMaterial({ color: 0xa8322b, roughness: 0.8 }))
    const roofM = keep(new THREE.MeshStandardMaterial({ color: 0x3b3b3b, roughness: 0.7 }))
    for (let k = 0; k < 6; k++) {
      const a = R() * Math.PI * 2
      const x = cx + Math.cos(a) * (900 + R() * 400)
      const z = (t.minZ + t.maxZ) / 2 + Math.sin(a) * (700 + R() * 300)
      const q = nearestSample(t, x, z)
      if (q.i >= 0 && q.d < 120) continue
      const y = heightAt(x, z)
      const barn = new THREE.Mesh(keep(new THREE.BoxGeometry(18, 8, 10)), barnWall)
      barn.position.set(x, y + 4, z)
      barn.rotation.y = a
      const rf = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.01, 7.5, 5, 4, 1).rotateY(Math.PI / 4).scale(1.7, 1, 1)), roofM)
      rf.position.set(x, y + 10.5, z)
      rf.rotation.y = a
      barn.castShadow = rf.castShadow = true
      const silo = new THREE.Mesh(keep(new THREE.CylinderGeometry(2.5, 2.5, 14, 12)), white)
      silo.position.set(x + Math.cos(a) * 14, y + 7, z + Math.sin(a) * 14)
      group.add(barn, rf, silo)
    }
    const stripes = [0x22c55e, 0xffd43b, 0xe63946, 0x2f6fcf]
    for (let k = 0; k < 3; k++) {
      const bal = new THREE.Group()
      const env = new THREE.SphereGeometry(9, 16, 12)
      env.scale(1, 1.15, 1)
      const pos = env.getAttribute('position') as THREE.BufferAttribute
      const col = new Float32Array(pos.count * 3)
      for (let i = 0; i < pos.count; i++) {
        const ang = Math.atan2(pos.getZ(i), pos.getX(i))
        const c = new THREE.Color(stripes[(Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 8) + k) % stripes.length])
        col[i * 3] = c.r
        col[i * 3 + 1] = c.g
        col[i * 3 + 2] = c.b
      }
      env.setAttribute('color', new THREE.BufferAttribute(col, 3))
      const em = new THREE.Mesh(keep(env), keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })))
      em.position.y = 14
      const basket = new THREE.Mesh(keep(new THREE.BoxGeometry(2, 1.4, 2)), keep(new THREE.MeshStandardMaterial({ color: 0x7a5530 })))
      bal.add(em, basket)
      bal.traverse((o) => (o.castShadow = true))
      group.add(bal)
      drifters.push({ obj: bal, c: new THREE.Vector3(cx + (k - 1) * 600, 180 + k * 60, (t.minZ + t.maxZ) / 2 + 200), r: 300 + k * 120, a: R() * 6, speed: 0.012 + R() * 0.01, bob: R() * 6 })
    }
  } else if (lake) {
    // the lake, its boats and marina, the village up the hill
    waterTex = keep(waterNormal())
    waterTex.repeat.set(60, 20)
    const wg = new THREE.CircleGeometry(1, 96)
    wg.rotateX(-Math.PI / 2)
    wg.scale(lake.rx * 1.35, 1, lake.rz * 1.35)
    const water = new THREE.Mesh(keep(wg), keep(new THREE.MeshStandardMaterial({ color: 0x0f4a6e, roughness: 0.16, metalness: 0.35, normalMap: waterTex, normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 0.55 })))
    water.position.set(lake.x, -1.6, lake.z)
    water.receiveShadow = true
    group.add(water)
    const hullM = keep(new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4 }))
    const sailM = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide }))
    const sailShape = new THREE.Shape()
    sailShape.moveTo(0, 0)
    sailShape.lineTo(0, 11)
    sailShape.lineTo(-4.5, 0.5)
    sailShape.closePath()
    const sailG = keep(new THREE.ShapeGeometry(sailShape))
    for (let k = 0; k < 12; k++) {
      const boat = new THREE.Group()
      const hull = new THREE.Mesh(keep(new THREE.CylinderGeometry(1.2, 0.6, 7, 10, 1).rotateZ(Math.PI / 2).scale(1, 0.55, 1)), hullM)
      hull.position.y = 0.4
      const mast = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.08, 0.08, 12, 6)), white)
      mast.position.set(0.6, 6.5, 0)
      const sail = new THREE.Mesh(sailG, sailM)
      sail.position.set(0.5, 1.4, 0)
      boat.add(hull, mast, sail)
      boat.traverse((o) => (o.castShadow = true))
      group.add(boat)
      drifters.push({ obj: boat, c: new THREE.Vector3(lake.x + (R() - 0.5) * lake.rx, -1.55, lake.z + (R() - 0.2) * lake.rz * 0.5), r: 60 + R() * 220, a: R() * 6, speed: (0.02 + R() * 0.02) * (R() < 0.5 ? 1 : -1), bob: R() * 6 })
    }
    // marina pier near the paddock
    const pierP = pointAt(t, -260, ps * 180)
    for (let k = 0; k < 4; k++) {
      const pier = new THREE.Mesh(keep(new THREE.BoxGeometry(3, 0.4, 60)), keep(new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 })))
      pier.position.set(pierP.x + k * 40, -0.6, lake.z + lake.rz * 0.92)
      group.add(pier)
    }
    // the village: white houses with red roofs on the hill, a church tower
    const houseG = keep(new THREE.BoxGeometry(8, 6, 7))
    const roofG = keep(new THREE.CylinderGeometry(0.01, 6.2, 3.6, 4, 1).rotateY(Math.PI / 4).scale(1.05, 1, 0.92))
    const houses: THREE.Matrix4[] = []
    const roofs: THREE.Matrix4[] = []
    const vx = 460
    const vz = 760
    for (let k = 0; k < 90; k++) {
      const x = vx + (R() - 0.5) * 520
      const z = vz + (R() - 0.3) * 300
      const q = nearestSample(t, x, z)
      if (q.i >= 0 && q.d < (q.i >= 0 ? Math.max(t.runL[q.i], t.runR[q.i]) : 0) + 14) continue
      const y = heightAt(x, z)
      const a = R() * 6.28
      houses.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + 2.7, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(1, 1, 1)))
      roofs.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + 7.5, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(1, 1, 1)))
    }
    const hm = new THREE.InstancedMesh(houseG, keep(new THREE.MeshStandardMaterial({ color: 0xf1ece2, roughness: 0.8 })), houses.length)
    houses.forEach((m, k) => hm.setMatrixAt(k, m))
    const rm = new THREE.InstancedMesh(roofG, keep(new THREE.MeshStandardMaterial({ color: 0xb4452f, roughness: 0.7 })), roofs.length)
    roofs.forEach((m, k) => rm.setMatrixAt(k, m))
    hm.castShadow = rm.castShadow = true
    hm.receiveShadow = true
    group.add(hm, rm)
    const cy = heightAt(vx + 40, vz + 120)
    const church = new THREE.Mesh(keep(new THREE.BoxGeometry(6, 26, 6)), keep(new THREE.MeshStandardMaterial({ color: 0xe8e2d6 })))
    church.position.set(vx + 40, cy + 13, vz + 120)
    const spire = new THREE.Mesh(keep(new THREE.ConeGeometry(4.4, 12, 4)), keep(new THREE.MeshStandardMaterial({ color: 0x4a5560 })))
    spire.position.set(vx + 40, cy + 32, vz + 120)
    spire.rotation.y = Math.PI / 4
    church.castShadow = spire.castShadow = true
    group.add(church, spire)
  }

  // ---- pit crews (positioned by the engine)
  const crewBodies = new THREE.InstancedMesh(
    keep(merge([new THREE.CapsuleGeometry(0.2, 0.75, 4, 10).translate(0, 0.78, 0), new THREE.CapsuleGeometry(0.07, 0.5, 3, 6).translate(0.25, 1.0, 0)])),
    keep(new THREE.MeshStandardMaterial({ roughness: 0.7 })),
    TEAMS.length * 12,
  )
  const crewHeads = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.15, 12, 10).translate(0, 1.5, 0)), keep(new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 1 })), TEAMS.length * 12)
  for (let k = 0; k < TEAMS.length * 12; k++) {
    crewBodies.setColorAt(k, new THREE.Color(TEAMS[Math.floor(k / 12)].color))
    crewHeads.setColorAt(k, new THREE.Color(TEAMS[Math.floor(k / 12)].color2))
  }
  crewBodies.castShadow = crewHeads.castShadow = true
  crewBodies.frustumCulled = crewHeads.frustumCulled = false
  group.add(crewBodies, crewHeads)

  const tmp = new THREE.Vector3()
  return {
    group,
    sun,
    env,
    fog,
    exposure: look.exposure,
    startLights,
    tvCams,
    crewBodies,
    crewHeads,
    heightAt,
    update(dt, focus, time) {
      // the sun's shadow box follows the camera
      tmp.copy(look.sun).multiplyScalar(420)
      sun.position.copy(focus).add(tmp)
      sun.target.position.copy(focus)
      sky.position.copy(focus)
      for (const s of spinners) s.obj.rotation.x += s.speed * dt
      for (const d of drifters) {
        d.a += d.speed * dt
        d.obj.position.set(d.c.x + Math.cos(d.a) * d.r, d.c.y + Math.sin(time * 0.5 + d.bob) * (d.c.y > 0 ? 3 : 0.08), d.c.z + Math.sin(d.a) * d.r)
        d.obj.rotation.y = -d.a + (d.speed > 0 ? 0 : Math.PI)
      }
      for (const c of clouds) {
        c.position.x += dt * 3
      }
      if (waterTex) {
        waterTex.offset.x = time * 0.004
        waterTex.offset.y = time * 0.002
      }
    },
    dispose() {
      for (const d of disposables) d.dispose()
      env.dispose()
      for (const m of treeMeshes) m.dispose()
      crewBodies.dispose()
      crewHeads.dispose()
      group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose()
      })
    },
  }
}
