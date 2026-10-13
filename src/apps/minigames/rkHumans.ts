// Rune Keep: detailed human monsters. Anatomical bodies turned on a lathe
// (tapered limbs with muscle, a shaped torso), sculpted heads (jaw, chin,
// nose, brow, cheekbones, ears, eyes), hands with fingers, boots; then each
// kind's kit: the soldier's helmet, goggles, plate carrier, pouches, radio,
// belt, pads and shotgun; the knight's plate, mail, tabard, cape, great helm
// and sword; the brute's iron mask, apron and chainsaw; the ravager's horns,
// spines and claws. Parts are merged per joint (one draw per material per
// bone) and the joints match the Rig that poseMonster animates.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Rig } from './rkActors'

type Kind = 'grunt' | 'knight' | 'brute' | 'ravager'

// ---------------------------------------------------------------- textures

let seedN = 1
const rnd = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647)

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d')!, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 4
  return t
}

function weave(g: CanvasRenderingContext2D, s: number, a = 0.08) {
  for (let y = 0; y < s; y += 2) {
    g.fillStyle = `rgba(0,0,0,${a})`
    g.fillRect(0, y, s, 1)
  }
  for (let x = 0; x < s; x += 3) {
    g.fillStyle = `rgba(255,255,255,${a * 0.5})`
    g.fillRect(x, 0, 1, s)
  }
}

function folds(g: CanvasRenderingContext2D, s: number, n: number) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * s
    const y = rnd() * s
    const len = 30 + rnd() * 90
    const ang = (rnd() - 0.5) * 0.8 + Math.PI / 2
    const gr = g.createLinearGradient(x, y, x + Math.cos(ang) * 8, y + Math.sin(ang) * 8)
    gr.addColorStop(0, 'rgba(0,0,0,0)')
    gr.addColorStop(0.5, `rgba(0,0,0,${0.1 + rnd() * 0.15})`)
    gr.addColorStop(1, 'rgba(255,255,255,0.05)')
    g.strokeStyle = gr
    g.lineWidth = 3 + rnd() * 5
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x + (rnd() - 0.5) * 30, y + len / 2, x + Math.cos(ang) * len, y + Math.sin(ang) * len)
    g.stroke()
  }
}

function dirt(g: CanvasRenderingContext2D, s: number, n: number, col = '40,30,20') {
  for (let i = 0; i < n; i++) {
    const x = rnd() * s
    const y = rnd() * s
    const r = 4 + rnd() * 30
    const gr = g.createRadialGradient(x, y, 0, x, y, r)
    gr.addColorStop(0, `rgba(${col},${0.1 + rnd() * 0.25})`)
    gr.addColorStop(1, `rgba(${col},0)`)
    g.fillStyle = gr
    g.fillRect(x - r, y - r, r * 2, r * 2)
  }
}

interface Tex {
  camo: THREE.CanvasTexture
  olive: THREE.CanvasTexture
  webbing: THREE.CanvasTexture
  skin: THREE.CanvasTexture
  face: THREE.CanvasTexture
  mail: THREE.CanvasTexture
  plate: THREE.CanvasTexture
  tabard: THREE.CanvasTexture
  leather: THREE.CanvasTexture
  hide: THREE.CanvasTexture
  boot: THREE.CanvasTexture
  steel: THREE.CanvasTexture
}

let tex: Tex | null = null

function textures(): Tex {
  if (tex) return tex
  seedN = 7
  const camo = canvasTex(256, (g, s) => {
    g.fillStyle = '#5b5e3c'
    g.fillRect(0, 0, s, s)
    for (const [col, n, r] of [['#3d4429', 18, 34], ['#7a6c48', 14, 26], ['#22251a', 16, 18]] as const)
      for (let i = 0; i < n; i++) {
        g.fillStyle = col
        g.beginPath()
        const cx = rnd() * s
        const cy = rnd() * s
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2
          const rr = r * (0.5 + rnd() * 0.7)
          g.lineTo(cx + Math.cos(a) * rr * 1.4, cy + Math.sin(a) * rr)
        }
        g.fill()
      }
    weave(g, s)
    folds(g, s, 26)
    dirt(g, s, 20)
  }, 2)
  const olive = canvasTex(256, (g, s) => {
    g.fillStyle = '#4a4a34'
    g.fillRect(0, 0, s, s)
    weave(g, s, 0.1)
    folds(g, s, 14)
    dirt(g, s, 14)
  })
  const webbing = canvasTex(128, (g, s) => {
    g.fillStyle = '#3e3f2c'
    g.fillRect(0, 0, s, s)
    for (let y = 0; y < s; y += 16) {
      g.fillStyle = '#2a2b1e'
      g.fillRect(0, y, s, 3) // MOLLE webbing rows
      g.fillStyle = 'rgba(255,255,255,0.06)'
      g.fillRect(0, y + 3, s, 1)
    }
    weave(g, s, 0.12)
    dirt(g, s, 8)
  })
  const skinTone = (base: string) => (g: CanvasRenderingContext2D, s: number) => {
    g.fillStyle = base
    g.fillRect(0, 0, s, s)
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? '120,60,50' : '255,220,200'},${rnd() * 0.06})`
      g.fillRect(rnd() * s, rnd() * s, 2, 2)
    }
    dirt(g, s, 6, '120,50,40')
  }
  const skin = canvasTex(128, skinTone('#b98a6e'))
  // the face map (sphere UVs: u around, v up): stubble on the jaw, dark brows, grime
  const face = canvasTex(256, (g, s) => {
    skinTone('#b8876a')(g, s)
    for (let i = 0; i < 2600; i++) {
      const u = rnd()
      const v = 0.25 + rnd() * 0.18
      if (Math.abs(u - 0.25) > 0.2) continue // only on the front (u = 0.25 faces +z)
      g.fillStyle = `rgba(40,28,20,${0.15 + rnd() * 0.25})`
      g.fillRect(u * s, (1 - v) * s, 1.5, 1.5)
    }
    g.fillStyle = 'rgba(30,22,16,0.8)'
    for (const du of [-0.06, 0.06]) g.fillRect((0.25 + du - 0.035) * s, (1 - 0.6) * s, 0.07 * s, 0.018 * s)
    dirt(g, s, 10)
  })
  const mail = canvasTex(128, (g, s) => {
    g.fillStyle = '#1a1a1c'
    g.fillRect(0, 0, s, s)
    for (let y = 0; y < s; y += 6)
      for (let x = (y / 6) % 2 ? 3 : 0; x < s; x += 6) {
        g.strokeStyle = `rgb(${120 + rnd() * 50},${120 + rnd() * 50},${125 + rnd() * 50})`
        g.lineWidth = 1.4
        g.beginPath()
        g.arc(x, y, 2.6, 0, Math.PI * 2)
        g.stroke()
      }
  }, 3)
  const plate = canvasTex(256, (g, s) => {
    const gr = g.createLinearGradient(0, 0, s, s)
    gr.addColorStop(0, '#9aa0a8')
    gr.addColorStop(0.5, '#c8ccd2')
    gr.addColorStop(1, '#80868e')
    g.fillStyle = gr
    g.fillRect(0, 0, s, s)
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * 0.12})`
      g.beginPath()
      const x = rnd() * s
      const y = rnd() * s
      g.moveTo(x, y)
      g.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 6)
      g.stroke()
    }
    dirt(g, s, 10, '80,40,20')
  })
  const tabard = canvasTex(256, (g, s) => {
    g.fillStyle = '#6a1410'
    g.fillRect(0, 0, s, s)
    g.fillStyle = '#c8a040'
    g.fillRect(0, 0, s, 10)
    g.fillRect(0, s - 10, s, 10)
    // a heraldic tower, in gold
    g.fillRect(s * 0.4, s * 0.32, s * 0.2, s * 0.36)
    for (let k = 0; k < 3; k++) g.fillRect(s * (0.38 + k * 0.09), s * 0.26, s * 0.06, s * 0.08)
    g.fillStyle = '#6a1410'
    g.fillRect(s * 0.47, s * 0.55, s * 0.06, s * 0.13)
    weave(g, s, 0.1)
    folds(g, s, 18)
    dirt(g, s, 12)
  })
  const leather = canvasTex(256, (g, s) => {
    g.fillStyle = '#4a2e1c'
    g.fillRect(0, 0, s, s)
    for (let i = 0; i < 400; i++) {
      g.strokeStyle = `rgba(0,0,0,${rnd() * 0.25})`
      g.beginPath()
      const x = rnd() * s
      const y = rnd() * s
      g.moveTo(x, y)
      g.lineTo(x + (rnd() - 0.5) * 14, y + (rnd() - 0.5) * 14)
      g.stroke()
    }
    folds(g, s, 10)
    dirt(g, s, 16, '60,10,10')
  })
  const hide = canvasTex(256, (g, s) => {
    g.fillStyle = '#6a4a40'
    g.fillRect(0, 0, s, s)
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(70,20,40,${0.25 + rnd() * 0.3})`
      g.lineWidth = 1 + rnd() * 2
      g.beginPath()
      let x = rnd() * s
      let y = rnd() * s
      g.moveTo(x, y)
      for (let k = 0; k < 6; k++) g.lineTo((x += (rnd() - 0.5) * 30), (y += (rnd() - 0.5) * 30))
      g.stroke()
    }
    dirt(g, s, 20, '90,20,20')
  })
  const boot = canvasTex(128, (g, s) => {
    g.fillStyle = '#231c16'
    g.fillRect(0, 0, s, s)
    g.strokeStyle = '#6a5a40'
    for (let y = 20; y < s * 0.7; y += 12) {
      g.beginPath()
      g.moveTo(s * 0.4, y)
      g.lineTo(s * 0.6, y + 8)
      g.moveTo(s * 0.6, y)
      g.lineTo(s * 0.4, y + 8)
      g.stroke()
    }
    dirt(g, s, 12, '70,60,40')
  })
  const steel = canvasTex(128, (g, s) => {
    g.fillStyle = '#3a3c40'
    g.fillRect(0, 0, s, s)
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`
      g.fillRect(rnd() * s, rnd() * s, 6, 1)
    }
  })
  tex = { camo, olive, webbing, skin, face, mail, plate, tabard, leather, hide, boot, steel }
  return tex
}

export function disposeHumanTextures() {
  if (!tex) return
  for (const t of Object.values(tex)) t.dispose()
  tex = null
}

// ---------------------------------------------------------------- geometry helpers

/** A limb hanging down from its joint: radius r0 at the top, r1 at the bottom, a muscle bulge. */
function limbGeo(r0: number, r1: number, len: number, bulge = 0, bulgeAt = 0.35): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = []
  const n = 14
  pts.push(new THREE.Vector2(0.0001, -len - r1 * 0.6))
  for (let i = n; i >= 0; i--) {
    const t = i / n
    const r = r0 + (r1 - r0) * t + bulge * Math.exp(-((t - bulgeAt) ** 2) / 0.04)
    pts.push(new THREE.Vector2(r, -t * len))
  }
  pts.push(new THREE.Vector2(0.0001, r0 * 0.6))
  const g = new THREE.LatheGeometry(pts, 18)
  return g
}

/** The torso: pelvis to neck, wider at the chest; z squashed for depth. */
function torsoGeo(w: number, chest: number, belly: number): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [0.0001, -0.06], [0.135, -0.05], [0.15, 0.0], [0.14 + belly, 0.1], [0.135 + belly * 0.6, 0.18], [0.155, 0.27],
    [0.175 * chest, 0.38], [0.18 * chest, 0.45], [0.165 * chest, 0.52], [0.12, 0.57], [0.06, 0.6], [0.0001, 0.61],
  ]
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * w, y)), 24)
  g.scale(1, 1, 0.66)
  return g
}

/** A head: a sphere pushed into a skull, jaw, chin, nose, brows and cheekbones. Faces +z. */
function headGeo(scale = 1, brute = 0): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.105, 36, 28)
  const p = g.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const bump = (d: THREE.Vector3, c: [number, number, number], sigma: number) => {
    const cc = new THREE.Vector3(...c).normalize()
    const dd = d.distanceTo(cc)
    return Math.exp(-(dd * dd) / (sigma * sigma))
  }
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const d = v.clone().normalize()
    let r = 0.105
    r += 0.012 * bump(d, [0, 0.2, -1], 0.7) // the back of the skull
    r += 0.022 * bump(d, [0, -0.15, 1], 0.12) // nose
    r += 0.006 * bump(d, [0, -0.3, 1], 0.1) // nose tip down
    r += (0.008 + brute * 0.012) * bump(d, [0, 0.35, 1], 0.22) // brow ridge
    r -= 0.01 * bump(d, [0.38, 0.22, 1], 0.14) + 0.01 * bump(d, [-0.38, 0.22, 1], 0.14) // eye sockets
    r += 0.008 * bump(d, [0.6, -0.05, 0.8], 0.25) + 0.008 * bump(d, [-0.6, -0.05, 0.8], 0.25) // cheekbones
    r += (0.01 + brute * 0.02) * bump(d, [0, -0.85, 0.6], 0.25) // chin
    r -= 0.006 * bump(d, [0, -0.55, 0.85], 0.12) // under the lip
    v.copy(d).multiplyScalar(r)
    // a narrower jaw and a longer face
    if (v.y < 0) v.x *= 1 - Math.min(0.32, -v.y * 2.4) * (0.6 + 0.4 * Math.max(0, v.z / 0.1))
    v.y *= 1.16
    if (v.y < -0.06) v.z += (-v.y - 0.06) * 0.35 // jaw juts forward a little
    v.x *= 0.9 + brute * 0.1
    p.setXYZ(i, v.x * scale, v.y * scale, v.z * scale)
  }
  g.computeVertexNormals()
  return g
}

function roundBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const s = new THREE.Shape()
  const x = -w / 2 + r
  const y = -h / 2 + r
  const ww = w - 2 * r
  const hh = h - 2 * r
  s.moveTo(x, y - r)
  s.lineTo(x + ww, y - r)
  s.quadraticCurveTo(x + ww + r, y - r, x + ww + r, y)
  s.lineTo(x + ww + r, y + hh)
  s.quadraticCurveTo(x + ww + r, y + hh + r, x + ww, y + hh + r)
  s.lineTo(x, y + hh + r)
  s.quadraticCurveTo(x - r, y + hh + r, x - r, y + hh)
  s.lineTo(x - r, y)
  s.quadraticCurveTo(x - r, y - r, x, y - r)
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * r * 0.6), bevelEnabled: true, bevelThickness: r * 0.6, bevelSize: r * 0.6, bevelSegments: 3, curveSegments: 4 })
  g.translate(0, 0, -(d - 2 * r * 0.6) / 2)
  // planar UVs in metres-ish so textures don't smear
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2)
  return g
}

// ---------------------------------------------------------------- the builder

interface Builder {
  mats: THREE.MeshStandardMaterial[]
  eyes: THREE.Mesh[]
  M: (o: THREE.MeshStandardMaterialParameters & { glow?: boolean }) => THREE.MeshStandardMaterial
  add: (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p?: [number, number, number], r?: [number, number, number], s?: [number, number, number]) => THREE.Mesh
}

function builder(): Builder {
  const mats: THREE.MeshStandardMaterial[] = []
  const eyes: THREE.Mesh[] = []
  return {
    mats,
    eyes,
    M: (o) => {
      const { glow, ...rest } = o
      const m = new THREE.MeshStandardMaterial(rest)
      m.userData.base = m.color.clone()
      m.userData.glow = !!glow
      mats.push(m)
      return m
    },
    add: (parent, geo, mat, p, r, s) => {
      const m = new THREE.Mesh(geo, mat)
      if (p) m.position.set(...p)
      if (r) m.rotation.set(...r)
      if (s) m.scale.set(...s)
      parent.add(m)
      return m
    },
  }
}

const pivot = (parent: THREE.Object3D, p: [number, number, number]) => {
  const o = new THREE.Object3D()
  o.position.set(...p)
  parent.add(o)
  return o
}

/** Merge each joint's meshes into one per material (keeps eyes apart: they switch off on death). */
function mergeJoints(root: THREE.Object3D, keep: Set<THREE.Object3D>) {
  const joints: THREE.Object3D[] = []
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) joints.push(o)
  })
  for (const j of joints) {
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>()
    for (const c of [...j.children]) {
      const m = c as THREE.Mesh
      if (!m.isMesh || keep.has(m) || m.children.length) continue
      m.updateMatrix()
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix)
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name)
      const list = byMat.get(m.material as THREE.Material) ?? []
      list.push(g)
      byMat.set(m.material as THREE.Material, list)
      j.remove(m)
      m.geometry.dispose()
    }
    for (const [mat, list] of byMat) {
      const merged = mergeGeometries(list, false)
      list.forEach((g) => g.dispose())
      if (!merged) continue
      j.add(new THREE.Mesh(merged, mat))
    }
  }
}

export function buildHuman(kind: Kind): Rig {
  const t = textures()
  const b = builder()
  const { M, add } = b
  const root = new THREE.Group()
  root.rotation.order = 'YXZ'
  const body = new THREE.Group()
  root.add(body)
  const big = kind === 'brute' ? 1.25 : kind === 'ravager' ? 1.2 : 1
  body.scale.setScalar(big)

  // materials per kind
  const skin = M({ map: kind === 'ravager' ? t.hide : t.skin, roughness: 0.62, color: kind === 'brute' ? 0xc8a088 : 0xffffff })
  const faceMat = M({ map: kind === 'ravager' ? t.hide : t.face, roughness: 0.6 })
  const cloth =
    kind === 'grunt' ? M({ map: t.camo, roughness: 0.92 }) : kind === 'knight' ? M({ map: t.mail, roughness: 0.45, metalness: 0.75 }) : kind === 'brute' ? M({ map: t.leather, roughness: 0.75 }) : skin
  const pants = kind === 'grunt' ? cloth : kind === 'knight' ? cloth : kind === 'brute' ? M({ map: t.olive, roughness: 0.9, color: 0x8a7a6a }) : skin
  const glove = M({ color: kind === 'knight' ? 0x8a8e94 : 0x2a2622, roughness: kind === 'knight' ? 0.35 : 0.8, metalness: kind === 'knight' ? 0.8 : 0 })
  const bootM = M({ map: t.boot, roughness: 0.6, color: kind === 'knight' ? 0x9aa0a8 : 0xffffff, metalness: kind === 'knight' ? 0.7 : 0 })
  const plate = M({ map: t.plate, roughness: 0.3, metalness: 0.9 })
  const gun = M({ map: t.steel, roughness: 0.38, metalness: 0.85 })
  const black = M({ color: 0x141414, roughness: 0.6 })

  // ---- skeleton and body
  const hips = pivot(body, [0, 0.95, 0])
  add(hips, limbGeo(0.15, 0.14, 0.14, 0.01), pants, [0, 0.06, 0], undefined, [1, 1, 0.72])
  const legs: THREE.Object3D[] = []
  const shins: THREE.Object3D[] = []
  for (const s of [-1, 1]) {
    const leg = pivot(hips, [s * 0.095, -0.04, 0])
    add(leg, limbGeo(0.085, 0.058, 0.42, kind === 'brute' ? 0.02 : 0.012, 0.3), pants)
    const shin = pivot(leg, [0, -0.43, 0])
    add(shin, new THREE.SphereGeometry(0.058, 16, 12), pants) // knee
    add(shin, limbGeo(0.058, 0.04, 0.4, 0.015, 0.25), pants, [0, 0, 0])
    // boot: shaft, foot, sole, toe cap
    add(shin, limbGeo(0.058, 0.05, 0.2), bootM, [0, -0.22, 0])
    add(shin, roundBox(0.1, 0.085, 0.26, 0.03), bootM, [0, -0.44, 0.055])
    add(shin, roundBox(0.11, 0.025, 0.275, 0.01), black, [0, -0.485, 0.055])
    if (kind === 'grunt') add(shin, roundBox(0.1, 0.12, 0.05, 0.02), M({ color: 0x2a2a24, roughness: 0.7 }), [0, -0.02, 0.055]) // knee pad
    if (kind === 'knight') {
      add(shin, limbGeo(0.068, 0.052, 0.36, 0.012), plate, [0, -0.02, 0.008]) // greave
      add(shin, new THREE.SphereGeometry(0.07, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), plate, [0, 0.0, 0.02], [Math.PI / 2, 0, 0]) // poleyn
      add(leg, limbGeo(0.092, 0.07, 0.36, 0.01), plate, [0, -0.02, 0.01]) // cuisse
    }
    legs.push(leg)
    shins.push(shin)
  }
  const spine = pivot(hips, [0, 0.08, 0])
  const chest = kind === 'brute' ? 1.18 : kind === 'ravager' ? 1.12 : 1
  add(spine, torsoGeo(kind === 'brute' ? 1.18 : 1, chest, kind === 'brute' ? 0.04 : 0), kind === 'brute' || kind === 'ravager' ? skin : cloth)
  // neck and trapezius
  add(spine, limbGeo(0.055 * chest, 0.06 * chest, 0.1), skin, [0, 0.67, 0])
  for (const s of [-1, 1]) add(spine, new THREE.SphereGeometry(0.075 * chest, 16, 12), kind === 'brute' || kind === 'ravager' ? skin : cloth, [s * 0.2 * chest, 0.52, 0], undefined, [1.1, 0.8, 0.9])

  // head
  const head = pivot(spine, [0, 0.66, 0.0])
  add(head, headGeo(kind === 'ravager' ? 1.15 : 1, kind === 'brute' || kind === 'ravager' ? 1 : 0), faceMat, [0, 0.12, 0.005])
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.024, 10, 8), skin, [s * 0.098, 0.12, -0.01], undefined, [0.45, 1, 0.75]) // ears
  const eyeWhite = M({ color: 0xd8d0c4, roughness: 0.25 })
  const eyeGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(...(kind === 'ravager' ? [2.4, 1.4, 0.2] : [1.8, 0.35, 0.15])) })
  for (const s of [-1, 1]) {
    add(head, new THREE.SphereGeometry(0.0125, 12, 10), eyeWhite, [s * 0.036, 0.138, 0.084])
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 10, 8), eyeGlow)
    iris.position.set(s * 0.036, 0.138, 0.096)
    head.add(iris)
    b.eyes.push(iris)
  }

  // arms
  const arms: THREE.Object3D[] = []
  const fores: THREE.Object3D[] = []
  for (const s of [-1, 1]) {
    const arm = pivot(spine, [s * 0.215 * chest, 0.5, 0])
    add(arm, new THREE.SphereGeometry(0.07 * chest, 16, 12), kind === 'brute' || kind === 'ravager' ? skin : cloth) // shoulder
    add(arm, limbGeo(0.064 * chest, 0.048, 0.3, kind === 'brute' ? 0.022 : 0.012, 0.4), kind === 'brute' || kind === 'ravager' ? skin : cloth)
    const fore = pivot(arm, [0, -0.3, 0])
    add(fore, new THREE.SphereGeometry(0.05, 14, 10), kind === 'brute' || kind === 'ravager' ? skin : cloth) // elbow
    add(fore, limbGeo(0.05, 0.034, 0.26, kind === 'brute' ? 0.018 : 0.01, 0.25), kind === 'grunt' ? cloth : kind === 'knight' ? cloth : skin)
    // hand: palm, four fingers curled, thumb
    const hand = pivot(fore, [0, -0.29, 0])
    add(hand, roundBox(0.075, 0.085, 0.035, 0.012), glove, [0, -0.03, 0])
    for (let f = 0; f < 4; f++) {
      const fx = (f - 1.5) * 0.019
      add(hand, limbGeo(0.0095, 0.008, 0.045), glove, [fx, -0.07, 0.004], [0.5, 0, 0])
      add(hand, limbGeo(0.008, 0.007, 0.03), glove, [fx, -0.105, 0.025], [1.5, 0, 0])
    }
    add(hand, limbGeo(0.01, 0.008, 0.05), glove, [s * -0.038, -0.03, 0.018], [0.6, 0, s * 0.7])
    if (kind === 'grunt') {
      add(fore, roundBox(0.08, 0.09, 0.07, 0.02), M({ color: 0x2a2a24, roughness: 0.7 }), [0, 0.0, -0.02]) // elbow pad
      add(arm, roundBox(0.06, 0.06, 0.01, 0.005), M({ color: 0x7a6a3a, roughness: 0.8 }), [s * 0.06, -0.08, 0], [0, s * Math.PI / 2, 0]) // patch
    }
    if (kind === 'knight') {
      add(arm, new THREE.SphereGeometry(0.105, 18, 12, 0, Math.PI * 2, 0, Math.PI / 1.9), plate, [s * 0.015, 0.02, 0], [0, 0, s * -0.4]) // pauldron
      add(arm, new THREE.SphereGeometry(0.095, 18, 12, 0, Math.PI * 2, 0, Math.PI / 1.9), plate, [s * 0.02, -0.04, 0], [0, 0, s * -0.55]) // its lame
      add(fore, limbGeo(0.056, 0.042, 0.22, 0.008), plate, [0, -0.02, 0]) // vambrace
      add(fore, new THREE.SphereGeometry(0.058, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), plate, [0, 0, -0.01], [-Math.PI / 2, 0, 0]) // couter
    }
    if (kind === 'ravager') for (let k = 0; k < 3; k++) add(hand, new THREE.ConeGeometry(0.012, 0.13, 8), M({ color: 0xe8e0c8, roughness: 0.35 }), [(k - 1) * 0.022, -0.15, 0.03], [Math.PI + 0.3, 0, 0])
    arms.push(arm)
    fores.push(fore)
  }

  // ---- kit
  const rightHand = fores[1].children.find((c) => !(c as THREE.Mesh).isMesh && c.children.length) as THREE.Object3D
  const weapon = pivot(rightHand, [0, -0.04, 0.02])
  weapon.rotation.x = Math.PI / 2 // weapons are built along +z: point them out of the fist

  if (kind === 'grunt') {
    const web = M({ map: t.webbing, roughness: 0.85 })
    const strapM = M({ color: 0x2c2c22, roughness: 0.8 })
    // plate carrier: front and back plates, shoulder straps, cummerbund
    add(spine, roundBox(0.31, 0.32, 0.06, 0.02), web, [0, 0.38, 0.105])
    add(spine, roundBox(0.31, 0.34, 0.06, 0.02), web, [0, 0.38, -0.105])
    for (const s of [-1, 1]) add(spine, roundBox(0.06, 0.03, 0.24, 0.01), strapM, [s * 0.1, 0.56, 0])
    add(spine, new THREE.TorusGeometry(0.155, 0.028, 8, 24), web, [0, 0.27, 0], [Math.PI / 2, 0, 0], [1, 0.66, 1.8])
    // three magazine pouches with flaps, a radio with its antenna, a grenade
    for (let k = -1; k <= 1; k++) {
      add(spine, roundBox(0.08, 0.11, 0.055, 0.012), web, [k * 0.09, 0.27, 0.155])
      add(spine, roundBox(0.085, 0.035, 0.06, 0.01), strapM, [k * 0.09, 0.325, 0.158])
    }
    add(spine, roundBox(0.06, 0.12, 0.04, 0.01), M({ color: 0x24261e, roughness: 0.5 }), [-0.13, 0.5, 0.11])
    add(spine, new THREE.CylinderGeometry(0.004, 0.004, 0.3, 6), black, [-0.15, 0.68, 0.08])
    add(spine, new THREE.SphereGeometry(0.03, 12, 10), M({ color: 0x3a4430, roughness: 0.6 }), [0.11, 0.48, 0.15])
    // a small pack
    add(spine, roundBox(0.24, 0.26, 0.1, 0.03), M({ map: t.olive, roughness: 0.9 }), [0, 0.4, -0.18])
    // belt, buckle, holster, pouches
    add(hips, new THREE.TorusGeometry(0.15, 0.022, 8, 28), M({ color: 0x2a2418, roughness: 0.7 }), [0, 0.04, 0], [Math.PI / 2, 0, 0], [1, 0.74, 1])
    add(hips, roundBox(0.05, 0.04, 0.02, 0.006), M({ color: 0x8a8a80, roughness: 0.3, metalness: 0.9 }), [0, 0.04, 0.115])
    add(hips, roundBox(0.06, 0.16, 0.05, 0.015), web, [0.17, -0.06, 0.02])
    add(hips, roundBox(0.07, 0.08, 0.05, 0.012), web, [-0.16, 0.0, 0.05])
    // combat helmet with rim, cover, goggles and strap
    const helm = M({ map: t.camo, roughness: 0.8 })
    add(head, new THREE.SphereGeometry(0.13, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2.05), helm, [0, 0.16, -0.01], undefined, [1, 0.95, 1.08])
    add(head, new THREE.TorusGeometry(0.128, 0.009, 6, 32), helm, [0, 0.163, -0.01], [Math.PI / 2, 0, 0], [1, 1.08, 1])
    add(head, new THREE.TorusGeometry(0.12, 0.01, 6, 28, Math.PI), black, [0, 0.21, 0.0], [0, 0, 0], [1, 0.4, 1.05])
    for (const s of [-1, 1]) {
      add(head, new THREE.CylinderGeometry(0.026, 0.026, 0.02, 16), black, [s * 0.04, 0.215, 0.105], [Math.PI / 2 - 0.4, 0, 0])
      add(head, new THREE.CircleGeometry(0.022, 16), M({ color: 0x405a60, roughness: 0.05, metalness: 0.6 }), [s * 0.04, 0.22, 0.117], [-0.4, 0, 0])
      add(head, new THREE.CylinderGeometry(0.004, 0.004, 0.11, 6), strapM, [s * 0.085, 0.07, 0.03], [0.2, 0, 0])
    }
    // pump shotgun: receiver, barrel, magazine tube, grooved pump, stock, grip, trigger guard, sling
    const w = weapon
    add(w, roundBox(0.045, 0.07, 0.2, 0.008), gun, [0, 0.02, 0.06])
    add(w, new THREE.CylinderGeometry(0.012, 0.012, 0.5, 14), gun, [0, 0.04, 0.4], [Math.PI / 2, 0, 0])
    add(w, new THREE.CylinderGeometry(0.011, 0.011, 0.38, 12), gun, [0, 0.008, 0.34], [Math.PI / 2, 0, 0])
    const wood = M({ color: 0x5a3a20, roughness: 0.55 })
    add(w, new THREE.CylinderGeometry(0.022, 0.022, 0.13, 14), wood, [0, 0.012, 0.3], [Math.PI / 2, 0, 0])
    for (let k = 0; k < 5; k++) add(w, new THREE.TorusGeometry(0.022, 0.003, 4, 14), black, [0, 0.012, 0.25 + k * 0.025])
    add(w, roundBox(0.04, 0.07, 0.28, 0.015), wood, [0, -0.01, -0.17], [0.12, 0, 0])
    add(w, roundBox(0.045, 0.085, 0.02, 0.006), black, [0, -0.02, -0.31], [0.12, 0, 0])
    add(w, new THREE.TorusGeometry(0.02, 0.004, 6, 14, Math.PI), gun, [0, -0.02, 0.06], [0, Math.PI / 2, Math.PI])
    add(w, new THREE.CylinderGeometry(0.003, 0.003, 0.6, 5), strapM, [0.03, -0.06, 0.05], [Math.PI / 2 + 0.15, 0, 0])
    add(w, roundBox(0.012, 0.012, 0.02, 0.003), gun, [0, 0.06, 0.62])
  } else if (kind === 'knight') {
    // breastplate and backplate on the mail, faulds over the hips, a gorget
    add(spine, torsoGeo(1.08, 1.04, 0.0), plate, [0, 0.0, 0.006], undefined, [1, 1, 1.05])
    for (let k = 0; k < 3; k++) add(hips, limbGeo(0.165 + k * 0.012, 0.17 + k * 0.012, 0.06), plate, [0, 0.06 - k * 0.055, 0], undefined, [1, 1, 0.74])
    add(spine, limbGeo(0.085, 0.11, 0.07), plate, [0, 0.66, 0])
    // tabard front and back with the house's tower, and a cape
    const tab = M({ map: t.tabard, roughness: 0.9, side: THREE.DoubleSide })
    add(spine, new THREE.PlaneGeometry(0.26, 0.62), tab, [0, 0.1, 0.13], [0.05, 0, 0])
    add(spine, new THREE.PlaneGeometry(0.26, 0.62), tab, [0, 0.1, -0.13], [-0.05, Math.PI, 0])
    const cape = new THREE.PlaneGeometry(0.46, 1.05, 8, 14)
    const cp = cape.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i)
      const y = cp.getY(i)
      cp.setZ(i, Math.sin(x * 22) * 0.025 * (0.6 - y) - (0.5 - y) * 0.06)
    }
    cape.computeVertexNormals()
    add(spine, cape, M({ color: 0x4a0c0a, roughness: 0.92, side: THREE.DoubleSide }), [0, 0.06, -0.17], [0.05, Math.PI, 0])
    // great helm with a visor slit, breaths and a plume
    const helmG = new THREE.LatheGeometry(
      [[0.115, -0.04], [0.13, 0.0], [0.135, 0.12], [0.13, 0.25], [0.1, 0.285], [0.0001, 0.29]].map(([r, y]) => new THREE.Vector2(r, y)),
      28,
    )
    add(head, helmG, plate, [0, 0.0, 0], undefined, [1, 1, 1.08])
    add(head, roundBox(0.2, 0.016, 0.02, 0.005), black, [0, 0.15, 0.135])
    add(head, roundBox(0.012, 0.18, 0.02, 0.005), plate, [0, 0.12, 0.142])
    for (let k = 0; k < 6; k++) add(head, new THREE.CircleGeometry(0.006, 8), black, [0.06 + (k % 3) * 0.015, 0.06 + Math.floor(k / 3) * 0.02, 0.135], [0, 0.5, 0])
    add(head, new THREE.ConeGeometry(0.035, 0.32, 12, 1, true), M({ color: 0x9a1810, roughness: 0.95, side: THREE.DoubleSide }), [0, 0.38, -0.06], [-0.5, 0, 0])
    // longsword: blade with fuller, crossguard, grip, pommel
    const w = weapon
    const blade = M({ color: 0xd0d4d8, roughness: 0.2, metalness: 1 })
    add(w, roundBox(0.045, 0.008, 0.85, 0.003), blade, [0, 0, 0.52])
    add(w, new THREE.ConeGeometry(0.023, 0.08, 4), blade, [0, 0, 0.985], [Math.PI / 2, Math.PI / 4, 0], [1, 1, 0.2])
    add(w, roundBox(0.012, 0.01, 0.7, 0.003), M({ color: 0x8a9096, roughness: 0.3, metalness: 1 }), [0, 0.003, 0.48])
    add(w, roundBox(0.22, 0.025, 0.03, 0.008), M({ color: 0x8a6a30, roughness: 0.35, metalness: 0.9 }), [0, 0, 0.08])
    add(w, new THREE.CylinderGeometry(0.016, 0.016, 0.16, 10), M({ color: 0x3a2414, roughness: 0.8 }), [0, 0, -0.02], [Math.PI / 2, 0, 0])
    add(w, new THREE.SphereGeometry(0.026, 12, 10), M({ color: 0x8a6a30, roughness: 0.35, metalness: 0.9 }), [0, 0, -0.11])
  } else if (kind === 'brute') {
    // iron mask, leather harness and apron, a spiked pauldron, the chainsaw
    const iron = M({ color: 0x4a4440, roughness: 0.45, metalness: 0.85 })
    add(head, new THREE.SphereGeometry(0.118, 24, 16, -Math.PI / 2, Math.PI, 0.3, 1.9), iron, [0, 0.13, 0.012], [0, 0, 0], [1.02, 1.2, 1.1])
    for (const s of [-1, 1]) add(head, roundBox(0.035, 0.012, 0.01, 0.003), black, [s * 0.036, 0.14, 0.123])
    for (let k = 0; k < 5; k++) add(head, new THREE.CylinderGeometry(0.004, 0.004, 0.02, 6), iron, [(k - 2) * 0.018, 0.05, 0.118], [Math.PI / 2, 0, 0])
    const strap = M({ map: t.leather, roughness: 0.7 })
    add(spine, new THREE.TorusGeometry(0.21, 0.018, 6, 28), strap, [0, 0.33, 0], [0.9, 0, 0.6], [1, 1, 0.75])
    add(spine, new THREE.TorusGeometry(0.21, 0.018, 6, 28), strap, [0, 0.33, 0], [0.9, 0, -0.6], [1, 1, 0.75])
    add(hips, new THREE.PlaneGeometry(0.34, 0.6, 4, 8), M({ map: t.leather, roughness: 0.7, side: THREE.DoubleSide }), [0, -0.24, 0.12], [-0.08, 0, 0])
    add(hips, new THREE.TorusGeometry(0.16, 0.026, 8, 28), strap, [0, 0.04, 0], [Math.PI / 2, 0, 0], [1, 0.74, 1])
    add(arms[0], new THREE.SphereGeometry(0.11, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), iron, [-0.01, 0.03, 0], [0, 0, 0.4])
    for (let k = 0; k < 3; k++) add(arms[0], new THREE.ConeGeometry(0.018, 0.1, 8), iron, [-0.03 - k * 0.02, 0.12 - k * 0.01, (k - 1) * 0.05], [0, 0, 0.5])
    const w = weapon
    add(w, roundBox(0.12, 0.16, 0.24, 0.03), M({ color: 0x8a3a1a, roughness: 0.5, metalness: 0.4 }), [0, 0.02, 0.05])
    add(w, roundBox(0.1, 0.06, 0.12, 0.01), black, [0, 0.11, 0.0])
    add(w, new THREE.TorusGeometry(0.06, 0.01, 6, 16), black, [0, 0.12, -0.08], [0, Math.PI / 2, 0])
    add(w, roundBox(0.02, 0.1, 0.6, 0.03), M({ color: 0xa8acb0, roughness: 0.3, metalness: 1 }), [0, 0, 0.45])
    const teeth = M({ color: 0x6a6e72, roughness: 0.4, metalness: 1 })
    for (let k = 0; k < 18; k++) {
      const z = 0.17 + (k % 9) * 0.065
      add(w, new THREE.ConeGeometry(0.008, 0.025, 4), teeth, [0, k < 9 ? 0.06 : -0.06, z], [k < 9 ? 0 : Math.PI, 0, 0])
    }
  } else {
    // ravager: horns, a ridge of spines, a fanged maw
    const bone = M({ color: 0xe0d8c0, roughness: 0.4 })
    for (const s of [-1, 1]) {
      add(head, new THREE.ConeGeometry(0.028, 0.26, 10), bone, [s * 0.07, 0.25, -0.03], [-0.6, 0, s * 0.5])
      add(head, new THREE.ConeGeometry(0.02, 0.14, 8), bone, [s * 0.09, 0.18, 0.02], [-0.2, 0, s * 1.2])
    }
    for (let k = 0; k < 7; k++) add(spine, new THREE.ConeGeometry(0.02, 0.09 + (k % 3) * 0.03, 8), bone, [0, 0.12 + k * 0.07, -0.11], [-0.9, 0, 0])
    add(head, roundBox(0.09, 0.03, 0.05, 0.01), M({ color: 0x2a0806, roughness: 0.4 }), [0, 0.04, 0.085])
    for (let k = 0; k < 6; k++) add(head, new THREE.ConeGeometry(0.005, 0.025, 6), bone, [(k - 2.5) * 0.014, 0.05, 0.1], [Math.PI, 0, 0])
  }

  const keep = new Set<THREE.Object3D>(b.eyes)
  mergeJoints(root, keep)
  const meshes: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !keep.has(o)) meshes.push(o as THREE.Mesh)
  })
  b.mats.push(eyeGlow as unknown as THREE.MeshStandardMaterial)
  return { root, body, hips, spine, head, arms, fores, legs, shins, weapon, mats: b.mats, meshes, eyes: b.eyes }
}
