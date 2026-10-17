// Kherve Grand Prix: the view from the driver's seat. Its own little scene,
// fixed to the cockpit camera and drawn after the world (the depth cleared,
// so the cockpit is always in front, yet solid within itself), lit like the
// world around it. In a classic coupé: a padded, curved dashboard with five
// round gauges (rev counter, speedometer, oil pressure and temperature, fuel)
// behind chrome bezels and glass, their needles moving; a leather-rimmed
// wheel with stitching and drilled aluminium spokes on its column and stalks;
// gloved hands and arms in team overalls that follow the wheel; a gear lever
// in a pleated leather boot with the shift pattern on its knob, moving
// through the gate; drilled aluminium pedals on a ribbed mat, the racing
// boots on them (the right foot between brake and throttle, the left on the
// clutch for a shift); the door panel with its pull strap and window winder,
// the roll cage, the mirror, harness straps, a switch panel and an
// extinguisher. In a single-seater: the shaped carbon wheel with its screen,
// rev lights, labelled buttons, rotaries, grips and paddles; the padded
// cockpit sides; the legs reaching forward to the pedals in the tub.

import * as THREE from 'three'
import type { Series } from './f1Physics.ts'

export interface CockpitState {
  /** The steering input (-1..1), throttle and brake (0..1). */
  steer: number
  throttle: number
  brake: number
  gear: number
  gears: number
  rpm: number
  idle: number
  redline: number
  /** km/h */
  speed: number
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

function noiseFill(g: CanvasRenderingContext2D, w: number, h: number, base: string, dots: string[], n: number, size = 1.5) {
  g.fillStyle = base
  g.fillRect(0, 0, w, h)
  for (let i = 0; i < n; i++) {
    g.fillStyle = dots[(Math.random() * dots.length) | 0]
    const s = 0.5 + Math.random() * size
    g.fillRect(Math.random() * w, Math.random() * h, s, s)
  }
}

/** A round gauge face: ticks, numbers, its label, a red zone, the maker's line. */
function dialTexture(o: { max: number; step: number; label: string; red?: number; scale?: number; sub?: string; minor?: number }) {
  const [c, g] = canvas(512, 512)
  const grd = g.createRadialGradient(256, 230, 20, 256, 256, 256)
  grd.addColorStop(0, '#1a1b1d')
  grd.addColorStop(1, '#060607')
  g.fillStyle = grd
  g.beginPath()
  g.arc(256, 256, 254, 0, Math.PI * 2)
  g.fill()
  const a0 = Math.PI * 0.75
  const sweep = Math.PI * 1.5
  const at = (v: number) => a0 + (v / o.max) * sweep
  if (o.red !== undefined) {
    g.strokeStyle = '#c8171e'
    g.lineWidth = 22
    g.beginPath()
    g.arc(256, 256, 200, at(o.red), a0 + sweep)
    g.stroke()
  }
  g.strokeStyle = '#eceae4'
  g.fillStyle = '#eceae4'
  const minor = o.minor ?? o.step / 5
  for (let v = 0; v <= o.max + 1e-6; v += minor) {
    const major = Math.abs(v / o.step - Math.round(v / o.step)) < 1e-6
    const half = !major && Math.abs((2 * v) / o.step - Math.round((2 * v) / o.step)) < 1e-6
    const a = at(v)
    g.lineWidth = major ? 9 : half ? 5 : 3
    const r0 = major ? 172 : half ? 186 : 194
    g.beginPath()
    g.moveTo(256 + Math.cos(a) * 212, 256 + Math.sin(a) * 212)
    g.lineTo(256 + Math.cos(a) * r0, 256 + Math.sin(a) * r0)
    g.stroke()
    if (major) {
      g.font = `bold ${o.max > 999 ? 54 : 40}px system-ui, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(String(Math.round(v / (o.scale ?? 1))), 256 + Math.cos(a) * 132, 256 + Math.sin(a) * 132)
    }
  }
  g.font = '600 30px system-ui, sans-serif'
  g.fillStyle = '#c9c6bd'
  g.textAlign = 'center'
  g.fillText(o.label, 256, 340)
  if (o.sub) {
    g.font = '500 22px system-ui, sans-serif'
    g.fillStyle = '#8b8a85'
    g.fillText(o.sub, 256, 380)
  }
  g.font = 'italic 700 22px system-ui, sans-serif'
  g.fillStyle = '#6e6c66'
  g.fillText('KHERVE', 256, 180)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Leather (or suede) grain, with stitching lines along v = 0.5 if `stitch`. */
function leatherTexture(base: string, stitch = false) {
  const [c, g] = canvas(512, 128)
  noiseFill(g, 512, 128, base, ['rgba(255,255,255,0.04)', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.12)'], 9000, 2)
  if (stitch) {
    g.strokeStyle = '#d8d2c4'
    g.lineWidth = 3
    g.setLineDash([10, 8])
    for (const y of [56, 72]) {
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(512, y)
      g.stroke()
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** Holes drilled in a plate (alpha: white kept, black cut). */
function drilledAlpha(cols: number, rows: number) {
  const [c, g] = canvas(256, 128)
  g.fillStyle = '#fff'
  g.fillRect(0, 0, 256, 128)
  g.fillStyle = '#000'
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      g.beginPath()
      g.arc(((i + 0.5) / cols) * 256, ((j + 0.5) / rows) * 128, Math.min(256 / cols, 128 / rows) * 0.3, 0, Math.PI * 2)
      g.fill()
    }
  }
  return new THREE.CanvasTexture(c)
}

/** The gear knob's top: the H pattern of a five-speed box. */
function knobTexture() {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#0c0c0c'
  g.fillRect(0, 0, 256, 256)
  g.strokeStyle = '#e8e4da'
  g.fillStyle = '#e8e4da'
  g.lineWidth = 10
  g.beginPath()
  for (const x of [70, 128, 186]) {
    g.moveTo(x, 70)
    g.lineTo(x, 186)
  }
  g.moveTo(70, 128)
  g.lineTo(186, 128)
  g.stroke()
  g.font = 'bold 34px system-ui'
  g.textAlign = 'center'
  g.fillText('1', 70, 52)
  g.fillText('2', 70, 222)
  g.fillText('3', 128, 52)
  g.fillText('4', 128, 222)
  g.fillText('5', 186, 52)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** The single-seater wheel's face: carbon weave, labelled buttons and rotaries round a screen. */
function f1FaceTexture() {
  const [c, g] = canvas(1024, 512)
  for (let y = 0; y < 512; y += 16) {
    for (let x = 0; x < 1024; x += 16) {
      const odd = ((x + y) / 16) % 2
      const grd = odd ? g.createLinearGradient(x, 0, x + 16, 0) : g.createLinearGradient(0, y, 0, y + 16)
      grd.addColorStop(0, '#15171a')
      grd.addColorStop(0.5, '#2a2e33')
      grd.addColorStop(1, '#131517')
      g.fillStyle = grd
      g.fillRect(x, y, 16, 16)
    }
  }
  // the screen's bezel (the live screen sits in the middle)
  g.fillStyle = '#050607'
  g.fillRect(330, 150, 364, 200)
  const button = (x: number, y: number, r: number, col: string, label: string) => {
    const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r)
    grd.addColorStop(0, '#ffffff55')
    grd.addColorStop(0.25, col)
    grd.addColorStop(1, '#000000aa')
    g.fillStyle = grd
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#f2f2f2'
    g.font = 'bold 20px system-ui'
    g.textAlign = 'center'
    g.fillText(label, x, y + r + 22)
  }
  button(250, 150, 26, '#2f6fcf', 'RADIO')
  button(250, 260, 26, '#ffd43b', 'PIT')
  button(774, 150, 26, '#d61f26', 'DRS')
  button(774, 260, 26, '#22c55e', 'OK')
  button(420, 410, 20, '#9a9ea3', 'N')
  button(604, 410, 20, '#9a9ea3', 'BOX')
  const rotary = (x: number, y: number, label: string) => {
    g.fillStyle = '#3a3e44'
    g.beginPath()
    g.arc(x, y, 44, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#e8e8e8'
    g.font = 'bold 16px system-ui'
    g.textAlign = 'center'
    for (let k = 0; k < 8; k++) {
      const a = -Math.PI * 0.75 + (k / 7) * Math.PI * 1.5 - Math.PI / 2
      g.fillText(String(k + 1), x + Math.cos(a) * 62, y + Math.sin(a) * 62 + 5)
    }
    g.fillText(label, x, y + 92)
  }
  rotary(160, 400, 'BBAL')
  rotary(864, 400, 'DIFF')
  g.fillStyle = '#22c55e'
  g.font = 'italic 900 34px system-ui'
  g.textAlign = 'center'
  g.fillText('KHERVE', 512, 470)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** A clock face: black, sixty marks, the hours in white. */
function clockTexture() {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#0b0b0c'
  g.fillRect(0, 0, 256, 256)
  g.translate(128, 128)
  for (let k = 0; k < 60; k++) {
    g.save()
    g.rotate((k / 60) * Math.PI * 2)
    g.fillStyle = '#f2f2ea'
    if (k % 5 === 0) g.fillRect(-3, -118, 6, 22)
    else g.fillRect(-1.2, -118, 2.4, 10)
    g.restore()
  }
  g.fillStyle = '#f2f2ea'
  g.font = '700 34px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const [n, a] of [[12, 0], [3, 0.5], [6, 1], [9, 1.5]] as [number, number][]) g.fillText(String(n), Math.sin(a * Math.PI) * 76, -Math.cos(a * Math.PI) * 76)
  g.font = '600 15px system-ui, sans-serif'
  g.fillStyle = '#c9c9c0'
  g.fillText('ZEIT', 0, 40)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function matTexture() {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#121213'
  g.fillRect(0, 0, 256, 256)
  for (let y = 0; y < 256; y += 8) {
    g.fillStyle = '#1e1e20'
    g.fillRect(0, y, 256, 3)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(3, 3)
  return t
}

/** A tube between two points (for arms, bars, straps). */
function between(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = new THREE.Vector3().subVectors(b, a)
  mesh.position.copy(a).addScaledVector(d, 0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())
  mesh.scale.set(1, d.length(), 1)
}

// the right hand's trip to the gear lever (seconds): there, the change, back on the wheel
const HAND_AT = 0.16
const HAND_BACK = 0.42
const HAND_DONE = 0.6

/** Where the elbow (or knee) goes for a limb from a to b of lengths l1, l2, bending towards `bend`. */
function bendAt(a: THREE.Vector3, b: THREE.Vector3, l1: number, l2: number, bend: THREE.Vector3): THREE.Vector3 {
  const ab = b.clone().sub(a)
  const d = Math.min(ab.length(), l1 + l2 - 1e-3)
  const dir = ab.normalize()
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x))
  const perp = bend.clone().addScaledVector(dir, -bend.dot(dir)).normalize()
  return a.clone().addScaledVector(dir, x).addScaledVector(perp, h)
}

export class Cockpit {
  /** The cockpit's own scene and camera (drawn after the world, depth cleared). */
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(80, 1, 0.02, 10)
  readonly group = new THREE.Group()
  private readonly series: Series
  private sun = new THREE.DirectionalLight(0xffffff, 2)
  private hemi = new THREE.HemisphereLight(0xdde6ff, 0x2a241e, 0.9)
  private wheel = new THREE.Group()
  private lever: THREE.Group | null = null
  private pedals: { arm: THREE.Group; kind: 'clutch' | 'brake' | 'throttle'; pad: THREE.Vector3 }[] = []
  private needles: { mesh: THREE.Object3D; value: (s: CockpitState) => number; max: number }[] = []
  private paddles: THREE.Object3D[] = []
  private leds: THREE.MeshStandardMaterial[] = []
  private screen: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D; last: string } | null = null
  private arms: { mesh: THREE.Mesh; shoulder: THREE.Vector3; hand: THREE.Object3D }[] = []
  private feet: { right: THREE.Object3D; left: THREE.Object3D } | null = null
  private owned: { dispose(): void }[] = []
  private wheelAngle = 0
  private gear = 1
  private shiftT = 1
  private leverPos = new THREE.Vector2()
  private oilT = 0.2
  private rightOn: 'brake' | 'throttle' = 'throttle'
  /** Classic: arms and legs in two parts, bent at the elbow and the knee (set each frame). */
  private limbs: { upper: THREE.Mesh; fore: THREE.Mesh; joint: THREE.Mesh; end: THREE.Mesh; root: THREE.Vector3; target: () => THREE.Vector3; l1: number; l2: number; bend: THREE.Vector3 }[] = []
  /** Classic: the right hand leaves the wheel for the gear lever on a change, and comes back. */
  private wheelHand: THREE.Object3D | null = null
  private leverHand: THREE.Object3D | null = null
  private handT = 1
  private fromGear = 1
  /** Classic: the rear-view mirror shows the road behind (the engine draws it into this target). */
  readonly mirror: { target: THREE.WebGLRenderTarget; camera: THREE.PerspectiveCamera } | null = null
  private clock: { hour: THREE.Object3D; minute: THREE.Object3D } | null = null

  constructor(series: Series, teamColor: string, accent: string) {
    this.series = series
    // the cockpit is fixed to the driver's head; the camera may look down into it
    this.scene.add(this.camera, this.group)
    this.scene.add(this.hemi, this.sun, this.sun.target)
    const keep = <T extends { dispose(): void }>(x: T) => {
      this.owned.push(x)
      return x
    }
    const std = (o: THREE.MeshStandardMaterialParameters) => keep(new THREE.MeshStandardMaterial(o))
    const phys = (o: THREE.MeshPhysicalMaterialParameters) => keep(new THREE.MeshPhysicalMaterial(o))
    const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(keep(g), m)
      mesh.position.set(x, y, z)
      parent.add(mesh)
      return mesh
    }
    const chrome = std({ color: 0xe4e7ea, roughness: 0.12, metalness: 1 })
    const alu = std({ color: 0xb9bdc2, roughness: 0.35, metalness: 0.9 })
    const black = std({ color: 0x0e0f10, roughness: 0.6 })
    const rubber = std({ color: 0x1b1b1c, roughness: 0.95 })
    // (a 1970s driver's overalls in the team's bright colour: they show against the dark cabin)
    const suit = std({ color: series === 'classic' ? accent : teamColor, roughness: 0.85 })
    const glove = std({ color: accent, roughness: 0.75 })
    const gloveDark = std({ color: 0x1a1a1a, roughness: 0.8 })
    const glass = phys({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.18, metalness: 0, clearcoat: 1, depthWrite: false })

    /** A gloved hand gripping a rim (in the wheel's frame): palm, four fingers wrapped round, the thumb. */
    const hand = (parent: THREE.Object3D, x: number, y: number, side: number, r = 0.016) => {
      const h = new THREE.Group()
      h.position.set(x, y, 0)
      h.rotation.z = Math.atan2(y, x) + Math.PI / 2
      add(h, new THREE.BoxGeometry(0.075, 0.05, 0.035).translate(0, 0, 0.03), glove)
      for (let k = 0; k < 4; k++) {
        const f = add(h, new THREE.TorusGeometry(r + 0.012, 0.011, 6, 10, Math.PI * 1.2), glove, -0.027 + k * 0.018, 0, 0)
        f.rotation.y = Math.PI / 2
        f.rotation.z = -0.3
      }
      add(h, new THREE.CapsuleGeometry(0.011, 0.035, 3, 6).rotateZ(Math.PI / 2 - 0.5 * side), gloveDark, 0.03 * side, -0.025, 0.035)
      parent.add(h)
      return h
    }
    const arm = (shoulder: THREE.Vector3, handObj: THREE.Object3D) => {
      const m = add(this.group, new THREE.CylinderGeometry(0.034, 0.046, 1, 12), suit)
      this.arms.push({ mesh: m, shoulder, hand: handObj })
    }
    /** An arm or a leg in two parts (radius r0 at the root, r1 at the far end), bent towards `bend`. */
    const limb = (root: THREE.Vector3, target: () => THREE.Vector3, l1: number, l2: number, bend: THREE.Vector3, r0: number, r1: number, m: THREE.Material, endM: THREE.Material) => {
      const upper = add(this.group, new THREE.CylinderGeometry(r0 * 0.92, r0, 1, 16), m)
      const fore = add(this.group, new THREE.CylinderGeometry(r1 * 0.85, r1, 1, 16), m)
      const joint = add(this.group, new THREE.SphereGeometry(r0 * 0.95, 16, 12), m)
      const end = add(this.group, new THREE.CylinderGeometry(r1 * 0.95, r1 * 0.95, 0.03, 16), endM)
      add(this.group, new THREE.SphereGeometry(r0 * 1.05, 16, 12), m, root.x, root.y, root.z)
      this.limbs.push({ upper, fore, joint, end, root, target, l1, l2, bend: bend.normalize() })
    }
    /** A leather glove round the rim: the back of the hand, four fingers in two joints, the thumb along the spoke. */
    const gripGlove = std({ map: keep(leatherTexture('#4a2c17')), roughness: 0.62 })
    const knuckleM = std({ color: 0x2d1a0d, roughness: 0.55 })
    const gripHand = (parent: THREE.Object3D, x: number, y: number, side: number) => {
      const h = new THREE.Group()
      h.position.set(x, y, 0)
      h.rotation.z = Math.atan2(y, x) + Math.PI / 2
      // the back of the hand over the rim, the palm under it
      add(h, new THREE.CapsuleGeometry(0.028, 0.045, 6, 12).rotateZ(Math.PI / 2).scale(1, 0.75, 0.8), gripGlove, 0, 0.012, 0.03)
      for (let k = 0; k < 4; k++) {
        const fx = -0.03 + k * 0.019
        const lenK = k === 0 || k === 3 ? 0.85 : 1
        const f = add(h, new THREE.TorusGeometry(0.03, 0.0105 * lenK, 8, 12, Math.PI * 1.25), gripGlove, fx, 0, 0)
        f.rotation.y = Math.PI / 2
        f.rotation.z = -0.35
        add(h, new THREE.SphereGeometry(0.0115, 8, 6), knuckleM, fx, 0.026, 0.022)
      }
      const thumb = add(h, new THREE.CapsuleGeometry(0.011, 0.04, 4, 8), gripGlove, 0.04 * side, -0.024, 0.032)
      thumb.rotation.z = Math.PI / 2 - 0.55 * side
      // the wrist: the glove's cuff with its strap
      add(h, new THREE.CylinderGeometry(0.03, 0.032, 0.035, 14).rotateX(Math.PI / 2), gripGlove, 0, 0.01, 0.06)
      add(h, new THREE.BoxGeometry(0.066, 0.012, 0.012), std({ color: accent, roughness: 0.6 }), 0, 0.01, 0.062)
      parent.add(h)
      return h
    }
    /** The right hand cupped over the gear knob. */
    const gripKnob = (h: THREE.Group) => {
      add(h, new THREE.CapsuleGeometry(0.03, 0.04, 6, 12).rotateZ(Math.PI / 2).scale(1, 0.7, 1), gripGlove, 0, 0.03, 0)
      for (let k = 0; k < 4; k++) {
        const f = add(h, new THREE.TorusGeometry(0.034, 0.0105, 8, 12, Math.PI * 0.9), gripGlove, -0.028 + k * 0.019, 0.0, -0.005)
        f.rotation.y = Math.PI / 2
        f.rotation.z = Math.PI * 0.55
      }
      add(h, new THREE.CapsuleGeometry(0.011, 0.04, 4, 8).rotateX(Math.PI / 2), gripGlove, -0.035, 0.0, 0.03)
      add(h, new THREE.CylinderGeometry(0.03, 0.032, 0.035, 14).rotateX(Math.PI / 2), gripGlove, 0.0, 0.035, 0.045)
    }

    if (series === 'classic') {
      // the car's middle is to the driver's right (they sit on the left)
      const mid = 0.32
      // ---- the dashboard: a padded top curving down to a face, across the car
      const dashShape = new THREE.Shape()
      const P: [number, number][] = [[0.96, -0.17], [0.8, -0.19], [0.66, -0.215], [0.56, -0.24], [0.535, -0.27], [0.54, -0.36], [0.56, -0.43], [0.7, -0.44], [0.96, -0.3]]
      dashShape.moveTo(P[0][0], P[0][1])
      for (const [u, v] of P.slice(1)) dashShape.lineTo(u, v)
      dashShape.closePath()
      const dashGeo = new THREE.ExtrudeGeometry(dashShape, { depth: 1.62, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3, curveSegments: 8 })
      dashGeo.rotateY(Math.PI / 2)
      dashGeo.translate(-0.5, 0, 0)
      const leatherT = keep(leatherTexture('#1d1a18'))
      leatherT.repeat.set(4, 4)
      add(this.group, dashGeo, std({ map: leatherT, roughness: 0.8, color: 0xffffff }))
      // the instrument binnacle, a hood over the dials
      // (a padded brow standing out over the dials)
      const brow = new THREE.TorusGeometry(0.3, 0.018, 8, 40, Math.PI * 0.55)
      brow.rotateZ(Math.PI * 0.225)
      brow.scale(1, 0.35, 1)
      add(this.group, brow, std({ map: leatherT, roughness: 0.85 }), 0, -0.338, -0.515)
      // five round gauges in a row, as in the early-70s rear-engined coupé, left to right: fuel, oil
      // pressure, the big rev counter in the middle, the speedometer, the clock
      const dials: { x: number; r: number; o: Parameters<typeof dialTexture>[0] | null; value: (s: CockpitState) => number }[] = [
        { x: -0.205, r: 0.04, o: { max: 100, step: 25, minor: 5, label: 'FUEL %' }, value: () => 72 },
        { x: -0.105, r: 0.05, o: { max: 10, step: 2, minor: 0.5, label: 'OIL bar', sub: `${Math.round(this.oilT * 130)}°C` }, value: (s) => 1.5 + 5 * (s.rpm / s.redline) },
        { x: 0.0, r: 0.064, o: { max: 9000, step: 1000, minor: 200, label: '1/min ×1000', red: 7200, scale: 1000, sub: 'flat-six' }, value: (s) => s.rpm },
        { x: 0.105, r: 0.05, o: { max: 280, step: 40, minor: 10, label: 'km/h' }, value: (s) => s.speed },
        { x: 0.205, r: 0.04, o: null, value: () => 0 },
      ]
      for (const d of dials) {
        const y = -0.3 + (d.x === 0 ? 0.008 : 0)
        const z = -0.52
        const face = std({ map: keep(d.o ? dialTexture(d.o) : clockTexture()), roughness: 0.6, emissive: 0x332a1a, emissiveIntensity: 0.25 })
        const tilt = new THREE.Group()
        tilt.position.set(d.x, y, z)
        tilt.rotation.x = -0.18
        this.group.add(tilt)
        add(tilt, new THREE.CircleGeometry(d.r, 40), face)
        add(tilt, new THREE.TorusGeometry(d.r + 0.004, 0.0055, 8, 40), chrome, 0, 0, 0.003)
        add(tilt, new THREE.CylinderGeometry(d.r + 0.002, d.r + 0.002, 0.012, 32, 1, true).rotateX(Math.PI / 2), black, 0, 0, -0.004)
        add(tilt, new THREE.SphereGeometry(d.r * 1.6, 24, 8, 0, Math.PI * 2, 0, 0.62).rotateX(Math.PI / 2).translate(0, 0, -d.r * 1.6 * Math.cos(0.62) + 0.007), glass)
        if (!d.o) {
          // the clock keeps the real time: hour and minute hands
          const hand = (len: number, w: number) => {
            const h = new THREE.Group()
            h.position.z = 0.004
            add(h, new THREE.BoxGeometry(w, len, 0.0015).translate(0, len / 2 - 0.004, 0), std({ color: 0xf2f2ea, emissive: 0x333322, roughness: 0.4 }))
            tilt.add(h)
            return h
          }
          this.clock = { hour: hand(d.r * 0.5, 0.0035), minute: hand(d.r * 0.78, 0.0025) }
          add(tilt, new THREE.CylinderGeometry(d.r * 0.1, d.r * 0.1, 0.005, 12).rotateX(Math.PI / 2), black, 0, 0, 0.005)
          continue
        }
        const needle = new THREE.Group()
        needle.position.z = 0.004
        add(needle, new THREE.BoxGeometry(0.0025, d.r * 0.85, 0.0015).translate(0, d.r * 0.36, 0), std({ color: 0xff6a10, emissive: 0x662200, roughness: 0.4 }))
        add(needle, new THREE.CylinderGeometry(d.r * 0.12, d.r * 0.12, 0.004, 14).rotateX(Math.PI / 2), black)
        tilt.add(needle)
        this.needles.push({ mesh: needle, value: d.value, max: d.o.max })
      }
      // the switch panel in the middle of the dash: toggle switches, warning lamps
      const panel = add(this.group, new THREE.BoxGeometry(0.3, 0.07, 0.01), std({ color: 0x0b0b0b, roughness: 0.4, metalness: 0.4 }), mid + 0.08, -0.36, -0.524)
      panel.rotation.x = -0.18
      const lampCols = [0x22ff55, 0xffaa00, 0xff3333, 0x3388ff, 0x22ff55, 0xffaa00]
      for (let k = 0; k < 6; k++) {
        add(this.group, new THREE.CylinderGeometry(0.004, 0.004, 0.028, 8).rotateX(-1.2), chrome, mid - 0.04 + k * 0.045, -0.35, -0.512)
        add(this.group, new THREE.CircleGeometry(0.006, 12), std({ color: lampCols[k], emissive: lampCols[k], emissiveIntensity: 0.4 }), mid - 0.04 + k * 0.045, -0.375, -0.518)
      }
      // the steering column and its stalks
      // (from the wheel's hub forward and down into the dash)
      const column = add(this.group, new THREE.CylinderGeometry(0.035, 0.045, 1, 16), black)
      between(column, new THREE.Vector3(0, -0.315, -0.43), new THREE.Vector3(0, -0.4, -0.6))
      for (const sd of [1, -1]) add(this.group, new THREE.CylinderGeometry(0.005, 0.006, 0.14, 8).rotateZ((Math.PI / 2) * sd + 0.15 * sd), black, 0.09 * sd, -0.37, -0.5)
      // ---- the steering wheel: a 380 mm sport wheel. A thick leather rim with its stitching and a yellow
      // marker at the top, three tapered aluminium spokes drilled with holes, the hub with its six bolts,
      // the horn push with the crest
      this.wheel.position.set(0, -0.31, -0.415)
      this.wheel.rotation.x = 0.36
      const rimT = keep(leatherTexture('#2a1d14', true))
      rimT.repeat.set(12, 1)
      const rimM = std({ map: rimT, roughness: 0.68 })
      add(this.wheel, new THREE.TorusGeometry(0.19, 0.0185, 18, 96), rimM)
      // finger grips moulded on the back of the rim
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2
        add(this.wheel, new THREE.SphereGeometry(0.009, 8, 6).scale(1, 1, 0.8), rimM, Math.cos(a) * 0.19, Math.sin(a) * 0.19, -0.014)
      }
      const marker = add(this.wheel, new THREE.TorusGeometry(0.19, 0.0195, 10, 12, 0.12), std({ color: 0xf2c418, roughness: 0.6 }))
      marker.rotation.z = Math.PI / 2 - 0.06
      // a spoke: wide at the hub, narrow at the rim, three holes, a little dished towards the column
      const spokeShape = new THREE.Shape()
      spokeShape.moveTo(0.035, -0.024)
      spokeShape.lineTo(0.178, -0.014)
      spokeShape.quadraticCurveTo(0.184, 0, 0.178, 0.014)
      spokeShape.lineTo(0.035, 0.024)
      spokeShape.closePath()
      for (const [hx, hr] of [[0.07, 0.0085], [0.105, 0.0075], [0.14, 0.0065]]) {
        const hole = new THREE.Path()
        hole.absarc(hx, 0, hr, 0, Math.PI * 2, true)
        spokeShape.holes.push(hole)
      }
      const spokeGeo = new THREE.ExtrudeGeometry(spokeShape, { depth: 0.004, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 2, curveSegments: 14 })
      spokeGeo.translate(0, 0, -0.01)
      const spokeM = std({ color: 0xc4c8cc, roughness: 0.28, metalness: 0.92 })
      for (const d of [Math.PI + 0.12, -0.12, -Math.PI / 2]) {
        const sp = add(this.wheel, spokeGeo, spokeM)
        sp.rotation.z = d
      }
      add(this.wheel, new THREE.CylinderGeometry(0.05, 0.056, 0.032, 32).rotateX(Math.PI / 2), black, 0, 0, -0.01)
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.26
        add(this.wheel, new THREE.CylinderGeometry(0.0045, 0.0045, 0.006, 8).rotateX(Math.PI / 2), chrome, Math.cos(a) * 0.043, Math.sin(a) * 0.043, 0.008)
      }
      const hornT = (() => {
        const [c, g] = canvas(128, 128)
        g.fillStyle = '#0c0c0c'
        g.fillRect(0, 0, 128, 128)
        g.strokeStyle = '#c9a54a'
        g.lineWidth = 6
        g.beginPath()
        g.arc(64, 64, 46, 0, Math.PI * 2)
        g.stroke()
        g.strokeStyle = '#22c55e'
        g.lineWidth = 5
        g.beginPath()
        g.arc(64, 64, 36, 0, Math.PI * 2)
        g.stroke()
        g.fillStyle = '#eafff1'
        g.font = '900 52px system-ui'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText('K', 64, 67)
        const t = new THREE.CanvasTexture(c)
        t.colorSpace = THREE.SRGBColorSpace
        return keep(t)
      })()
      add(this.wheel, new THREE.CylinderGeometry(0.036, 0.038, 0.012, 28).rotateX(Math.PI / 2), black, 0, 0, 0.006)
      add(this.wheel, new THREE.CircleGeometry(0.034, 28), std({ map: hornT, roughness: 0.35, metalness: 0.2 }), 0, 0, 0.0125)
      // leather gloves, a two-part hand at ten to two
      const gloveM = std({ map: keep(leatherTexture('#3b2414')), roughness: 0.7 })
      const cuffM = std({ color: teamColor, roughness: 0.8 })
      this.hemi.intensity = 1.25
      const lh = gripHand(this.wheel, -0.19 * Math.cos(0.32), 0.19 * Math.sin(0.32), -1)
      const rh = gripHand(this.wheel, 0.19 * Math.cos(0.32), 0.19 * Math.sin(0.32), 1)
      this.wheelHand = rh
      this.group.add(this.wheel)
      // the right hand on the gear knob during a change (shown only then)
      const lev = new THREE.Group()
      gripKnob(lev)
      lev.visible = false
      this.group.add(lev)
      this.leverHand = lev
      // arms: shoulder, upper arm, elbow, forearm in the overalls, the cuff at the wrist
      const wristOf = (h: THREE.Object3D) => () => {
        this.scene.updateMatrixWorld()
        return new THREE.Vector3(0, 0, 0.045).applyMatrix4(h.matrixWorld).applyMatrix4(new THREE.Matrix4().copy(this.group.matrixWorld).invert())
      }
      limb(new THREE.Vector3(-0.21, -0.62, 0.2), wristOf(lh), 0.33, 0.33, new THREE.Vector3(-0.8, -0.6, 0.1), 0.05, 0.04, suit, cuffM)
      limb(new THREE.Vector3(0.21, -0.62, 0.2), () => (lev.visible ? wristOf(lev)() : wristOf(rh)()), 0.33, 0.33, new THREE.Vector3(0.8, -0.6, 0.1), 0.05, 0.04, suit, cuffM)
      void gloveM
      // ---- the tunnel and the gear lever: a pleated leather boot, a chrome stick, the knob with the pattern
      add(this.group, new THREE.BoxGeometry(0.2, 0.22, 0.75), std({ map: leatherT, roughness: 0.85 }), mid, -0.78, -0.42)
      const bootPts: THREE.Vector2[] = []
      for (let i = 0; i <= 16; i++) {
        const t = i / 16
        bootPts.push(new THREE.Vector2(0.075 * (1 - t) + 0.012 + Math.sin(t * Math.PI * 7) * 0.006 * (1 - t), t * 0.13))
      }
      add(this.group, new THREE.LatheGeometry(bootPts, 24), std({ map: leatherT, roughness: 0.75 }), mid - 0.02, -0.63, -0.44)
      add(this.group, new THREE.TorusGeometry(0.085, 0.008, 6, 28).rotateX(Math.PI / 2), chrome, mid - 0.02, -0.628, -0.44)
      const lever = new THREE.Group()
      lever.position.set(mid - 0.02, -0.56, -0.44)
      add(lever, new THREE.CylinderGeometry(0.009, 0.012, 0.26, 12), chrome, 0, 0.1, 0)
      add(lever, new THREE.SphereGeometry(0.038, 24, 16).scale(1, 0.85, 1), std({ color: 0x141414, roughness: 0.25, metalness: 0.1 }), 0, 0.24, 0)
      add(lever, new THREE.CircleGeometry(0.029, 24).rotateX(-Math.PI / 2), std({ map: keep(knobTexture()), roughness: 0.35 }), 0, 0.271, 0)
      this.group.add(lever)
      this.lever = lever
      // a fire extinguisher strapped to the tunnel
      add(this.group, new THREE.CylinderGeometry(0.04, 0.04, 0.3, 16).rotateX(Math.PI / 2), std({ color: 0xc8161d, roughness: 0.35, metalness: 0.2 }), mid + 0.12, -0.74, -0.25)
      add(this.group, new THREE.CylinderGeometry(0.015, 0.02, 0.05, 10).rotateX(Math.PI / 2), chrome, mid + 0.12, -0.74, -0.42)
      // ---- the footwell: ribbed mat, bulkhead, the footrest, drilled pedals, the boots
      add(this.group, new THREE.PlaneGeometry(0.85, 0.8).rotateX(-Math.PI / 2), std({ map: keep(matTexture()), roughness: 0.95 }), 0.02, -1.22, -0.95)
      add(this.group, new THREE.PlaneGeometry(0.85, 0.6), std({ color: 0x151517, roughness: 0.9 }), 0.02, -0.95, -1.25)
      add(this.group, new THREE.BoxGeometry(0.06, 0.18, 0.14), alu, -0.32, -1.12, -1.0)
      const padAlpha = keep(drilledAlpha(4, 3))
      const padM = std({ color: 0xc9cdd2, roughness: 0.35, metalness: 0.85, alphaMap: padAlpha, alphaTest: 0.5, side: THREE.DoubleSide })
      // pedals hinged at the floor (the coupé's 'organ' pedals): an arm up from the hinge, the drilled pad
      for (const [kind, x, w] of [['clutch', -0.17, 0.08], ['brake', -0.02, 0.09], ['throttle', 0.13, 0.06]] as ['clutch' | 'brake' | 'throttle', number, number][]) {
        const a = new THREE.Group()
        a.position.set(x, -1.2, -1.14)
        add(a, new THREE.CylinderGeometry(0.012, 0.012, 0.04, 10).rotateZ(Math.PI / 2), alu)
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.1, 0.03), new THREE.Vector3(0, 0.19, 0.07)])
        add(a, new THREE.TubeGeometry(curve, 12, 0.008, 8), alu)
        const h = kind === 'throttle' ? 0.14 : 0.08
        add(a, new THREE.BoxGeometry(w + 0.01, h, 0.006), rubber, 0, 0.2, 0.078)
        add(a, new THREE.BoxGeometry(w, h - 0.01, 0.004), padM, 0, 0.2, 0.083)
        this.group.add(a)
        this.pedals.push({ arm: a, kind, pad: new THREE.Vector3(x, -1.0, -1.06) })
      }
      // racing boots: sole and heel, a suede upper, the laces; the legs from the seat, bent at the knee
      const bootM = std({ color: 0x15161a, roughness: 0.55 })
      const soleM = std({ color: 0x050505, roughness: 0.9 })
      const boot = () => {
        const b = new THREE.Group()
        add(b, new THREE.BoxGeometry(0.095, 0.022, 0.25), soleM, 0, -0.02, 0.07)
        add(b, new THREE.CapsuleGeometry(0.042, 0.15, 6, 12).rotateX(Math.PI / 2).scale(1.05, 0.85, 1), bootM, 0, 0.018, 0.07)
        add(b, new THREE.CylinderGeometry(0.048, 0.05, 0.1, 14), bootM, 0, 0.06, 0.16)
        for (let k = 0; k < 4; k++) add(b, new THREE.BoxGeometry(0.04, 0.004, 0.006), std({ color: accent, roughness: 0.6 }), 0, 0.052 - k * 0.006, 0.04 + k * 0.03)
        this.group.add(b)
        return b
      }
      this.feet = { right: boot(), left: boot() }
      const ankleOf = (b: THREE.Object3D) => () => b.position.clone().add(new THREE.Vector3(0, 0.1, 0.17))
      limb(new THREE.Vector3(0.12, -0.86, 0.1), ankleOf(this.feet.right), 0.47, 0.44, new THREE.Vector3(0.2, 1, 0.1), 0.075, 0.052, suit, bootM)
      limb(new THREE.Vector3(-0.12, -0.86, 0.1), ankleOf(this.feet.left), 0.47, 0.44, new THREE.Vector3(-0.2, 1, 0.1), 0.075, 0.052, suit, bootM)
      // the ignition key, left of the wheel, its leather fob hanging
      add(this.group, new THREE.CylinderGeometry(0.018, 0.02, 0.02, 18).rotateX(Math.PI / 2 - 0.18), chrome, -0.29, -0.42, -0.52)
      add(this.group, new THREE.BoxGeometry(0.008, 0.03, 0.006), std({ color: 0x1a1a1a, roughness: 0.4 }), -0.29, -0.42, -0.505)
      add(this.group, new THREE.BoxGeometry(0.022, 0.05, 0.004), std({ map: leatherT, color: 0x6a4428, roughness: 0.7 }), -0.29, -0.46, -0.503)
      // ---- the door panel: trim, the pull strap, the window winder, the inner handle
      add(this.group, new THREE.BoxGeometry(0.02, 0.5, 0.8), std({ map: leatherT, roughness: 0.85 }), -0.5, -0.45, -0.5)
      add(this.group, new THREE.BoxGeometry(0.03, 0.02, 0.22), std({ color: 0x3a2412, roughness: 0.7 }), -0.48, -0.42, -0.45)
      const winder = new THREE.Group()
      winder.position.set(-0.485, -0.55, -0.62)
      add(winder, new THREE.CylinderGeometry(0.02, 0.02, 0.012, 14).rotateZ(Math.PI / 2), chrome)
      add(winder, new THREE.BoxGeometry(0.008, 0.08, 0.012), chrome, 0.008, -0.035, 0)
      add(winder, new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8).rotateZ(Math.PI / 2), black, 0.02, -0.07, 0)
      this.group.add(winder)
      add(this.group, new THREE.BoxGeometry(0.02, 0.025, 0.07), chrome, -0.485, -0.32, -0.7)
      // ---- the roll cage inside the A pillars, the mirror, the harness
      const cageM = std({ color: 0xd8d8d2, roughness: 0.5, metalness: 0.3 })
      for (const [x0, x1] of [[-0.5, -0.4], [mid + 0.62, mid + 0.52]]) {
        const bar = add(this.group, new THREE.CylinderGeometry(0.02, 0.02, 1, 10), cageM)
        between(bar, new THREE.Vector3(x0, -0.2, -0.85), new THREE.Vector3(x1, 0.32, -0.25))
      }
      // the rear-view mirror: what is behind, drawn into it every frame (mirrored left to right)
      const target = keep(new THREE.WebGLRenderTarget(512, 128, { colorSpace: THREE.SRGBColorSpace }))
      target.texture.wrapS = THREE.RepeatWrapping
      target.texture.repeat.set(-1, 1)
      target.texture.offset.set(1, 0)
      const rearCam = new THREE.PerspectiveCamera(32, 4, 0.4, 600)
      ;(this as { mirror: Cockpit['mirror'] }).mirror = { target, camera: rearCam }
      const frameShape = new THREE.Shape()
      frameShape.absellipse(0, 0, 0.115, 0.036, 0, Math.PI * 2, false, 0)
      const frameGeo = new THREE.ExtrudeGeometry(frameShape, { depth: 0.014, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 3, curveSegments: 32 })
      const mir = new THREE.Group()
      mir.position.set(mid - 0.05, 0.16, -0.6)
      mir.rotation.set(0.12, -0.28, 0)
      add(mir, frameGeo, black, 0, 0, -0.016)
      const glassShape = new THREE.Shape()
      glassShape.absellipse(0, 0, 0.108, 0.03, 0, Math.PI * 2, false, 0)
      const glassGeo = new THREE.ShapeGeometry(glassShape, 32)
      // map the ellipse to the whole picture
      const uv = glassGeo.attributes.uv
      const pos = glassGeo.attributes.position
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + 0.108) / 0.216, (pos.getY(i) + 0.03) / 0.06)
      add(mir, glassGeo, keep(new THREE.MeshBasicMaterial({ map: target.texture, color: 0xd8dde2 })), 0, 0, 0.003)
      this.group.add(mir)
      add(this.group, new THREE.CylinderGeometry(0.006, 0.008, 0.08, 8), black, mid - 0.05, 0.215, -0.615)
      const strap = std({ color: 0x1f5fd0, roughness: 0.8 })
      for (const sd of [1, -1]) {
        const s = add(this.group, new THREE.BoxGeometry(0.05, 1, 0.006), strap)
        between(s, new THREE.Vector3(0.12 * sd, -0.32, 0.12), new THREE.Vector3(0.04 * sd, -0.85, -0.12))
      }
      add(this.group, new THREE.CylinderGeometry(0.035, 0.035, 0.012, 20).rotateX(Math.PI / 2), chrome, 0, -0.82, -0.1)
    } else {
      // ---- the single-seater: the padded cockpit sides and the tub
      const carbonT = keep(f1FaceTexture())
      const carbon = std({ color: 0x1c1e21, roughness: 0.45, metalness: 0.3 })
      const foam = std({ color: 0x1f3a8a, roughness: 0.95 })
      for (const sd of [1, -1]) {
        add(this.group, new THREE.BoxGeometry(0.06, 0.12, 0.6), carbon, 0.27 * sd, -0.26, -0.45).rotation.y = -0.12 * sd
        add(this.group, new THREE.BoxGeometry(0.08, 0.1, 0.35), foam, 0.24 * sd, -0.28, 0.02)
      }
      add(this.group, new THREE.BoxGeometry(0.46, 0.02, 1.2), carbon, 0, -0.62, -1.05)
      for (const sd of [1, -1]) add(this.group, new THREE.BoxGeometry(0.02, 0.3, 1.2), carbon, 0.22 * sd, -0.48, -1.05).rotation.y = 0.1 * sd
      // the legs reaching forward to the pedals
      for (const sd of [1, -1]) {
        const leg = add(this.group, new THREE.CylinderGeometry(0.06, 0.075, 1, 12), suit)
        between(leg, new THREE.Vector3(0.09 * sd, -0.55, -0.15), new THREE.Vector3(0.065 * sd, -0.47, -1.2))
      }
      for (const [kind, x] of [['brake', -0.065], ['throttle', 0.07]] as ['brake' | 'throttle', number][]) {
        const a = new THREE.Group()
        a.position.set(x, -0.4, -1.42)
        add(a, new THREE.BoxGeometry(0.016, 0.16, 0.016), alu, 0, -0.08, 0)
        add(a, new THREE.BoxGeometry(0.08, 0.1, 0.014), kind === 'brake' ? carbon : alu, 0, -0.17, 0.012)
        this.group.add(a)
        this.pedals.push({ arm: a, kind, pad: new THREE.Vector3(x, -0.57, -1.4) })
      }
      // ---- the wheel: a shaped carbon body with its face, grips, rev lights, the screen, rotaries, paddles
      this.wheel.position.set(0, -0.19, -0.37)
      this.wheel.rotation.x = 0.22
      const outline = new THREE.Shape()
      outline.moveTo(-0.1, -0.07)
      outline.quadraticCurveTo(-0.15, -0.07, -0.155, 0.0)
      outline.quadraticCurveTo(-0.15, 0.065, -0.1, 0.07)
      outline.lineTo(0.1, 0.07)
      outline.quadraticCurveTo(0.15, 0.065, 0.155, 0.0)
      outline.quadraticCurveTo(0.15, -0.07, 0.1, -0.07)
      outline.lineTo(0.05, -0.085)
      outline.lineTo(-0.05, -0.085)
      outline.closePath()
      const body = new THREE.ExtrudeGeometry(outline, { depth: 0.025, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 3 })
      body.translate(0, 0, -0.025)
      add(this.wheel, body, carbon)
      add(this.wheel, new THREE.PlaneGeometry(0.29, 0.145), std({ map: carbonT, roughness: 0.4 }), 0, 0, 0.0075)
      const hands: THREE.Group[] = []
      for (const sd of [1, -1]) {
        const grip = add(this.wheel, new THREE.CapsuleGeometry(0.028, 0.085, 6, 14), rubber, 0.15 * sd, -0.005, -0.01)
        grip.rotation.z = 0.12 * sd
        hands.push(hand(this.wheel, 0.15 * sd, 0.0, sd, 0.03))
        const paddle = add(this.wheel, new THREE.BoxGeometry(0.06, 0.09, 0.004), carbon, 0.085 * sd, 0.01, -0.04)
        paddle.rotation.z = -0.2 * sd
        this.paddles.push(paddle)
        add(this.wheel, new THREE.BoxGeometry(0.035, 0.05, 0.004), alu, 0.06 * sd, -0.05, -0.04)
        const rot = add(this.wheel, new THREE.CylinderGeometry(0.014, 0.014, 0.014, 20).rotateX(Math.PI / 2), alu, 0.123 * sd, -0.06, 0.012)
        rot.rotation.z = 0.4 * sd
      }
      const [c, g] = canvas(256, 128)
      const tex = keep(new THREE.CanvasTexture(c))
      tex.colorSpace = THREE.SRGBColorSpace
      this.screen = { tex, g, last: '' }
      add(this.wheel, new THREE.PlaneGeometry(0.1, 0.055), std({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.8, roughness: 0.2 }), 0, 0.0, 0.009)
      for (let k = 0; k < 15; k++) {
        const m = std({ color: 0x111111, emissive: 0x000000 })
        this.leds.push(m)
        add(this.wheel, new THREE.SphereGeometry(0.0035, 8, 6), m, -0.056 + k * 0.008, 0.061, 0.009)
      }
      add(this.wheel, new THREE.CylinderGeometry(0.025, 0.03, 0.06, 16).rotateX(Math.PI / 2), alu, 0, 0, -0.06)
      this.group.add(this.wheel)
      arm(new THREE.Vector3(0.2, -0.45, 0.1), hands[0])
      arm(new THREE.Vector3(-0.2, -0.45, 0.1), hands[1])
    }
    this.group.traverse((o) => (o.frustumCulled = false))
  }

  /** Follow the main camera's lens (looking down by `pitch` radians) and the world's light. */
  sync(main: THREE.PerspectiveCamera, pitch: number, sunDir: THREE.Vector3, sunColor: THREE.Color, sunIntensity: number, env: THREE.Texture | null) {
    this.camera.fov = main.fov
    this.camera.aspect = main.aspect
    this.camera.rotation.set(-pitch, 0, 0)
    this.camera.updateProjectionMatrix()
    // the sun in the head's frame: into the camera's, then back up by the pitch
    const inv = main.quaternion.clone().invert()
    this.sun.position.copy(sunDir).applyQuaternion(inv).applyQuaternion(this.camera.quaternion).multiplyScalar(5)
    this.sun.color.copy(sunColor)
    this.sun.intensity = sunIntensity * 0.75
    this.scene.environment = env
    this.scene.environmentIntensity = 0.5
  }

  update(dt: number, s: CockpitState) {
    // the wheel turns with the steering (about 85° each way in a coupé on a quick rack, 70° in a single-seater)
    const full = this.series === 'classic' ? 1.5 : 1.2
    this.wheelAngle += (-s.steer * full - this.wheelAngle) * Math.min(1, dt * 18)
    this.wheel.rotation.z = this.wheelAngle
    // the arms follow the hands
    this.scene.updateMatrixWorld()
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert()
    for (const a of this.arms) {
      const wrist = new THREE.Vector3(0, 0, 0.04).applyMatrix4(a.hand.matrixWorld).applyMatrix4(inv)
      between(a.mesh, a.shoulder, wrist)
    }
    // gear changes: the paddles flick, the clutch dips, the lever moves through the gate
    if (s.gear !== this.gear) {
      const up = s.gear > this.gear
      // the right hand goes to the lever (or, mid-change, stays on it for the next one)
      if (this.handT >= HAND_DONE) {
        this.fromGear = this.gear
        this.handT = 0
      } else if (this.handT > HAND_AT) this.handT = HAND_AT
      this.gear = s.gear
      this.shiftT = 0
      if (this.paddles.length) this.paddles[up ? 0 : 1].userData.kick = 1
    }
    this.shiftT = Math.min(1, this.shiftT + dt * 4)
    for (const p of this.paddles) {
      p.userData.kick = Math.max(0, (p.userData.kick ?? 0) - dt * 8)
      p.rotation.x = -0.5 * (p.userData.kick as number)
    }
    const clutch = this.shiftT < 1 ? Math.sin(this.shiftT * Math.PI) : 0
    for (const p of this.pedals) {
      const press = p.kind === 'throttle' ? s.throttle : p.kind === 'brake' ? s.brake : clutch
      p.arm.rotation.x += (-press * 0.42 - p.arm.rotation.x) * Math.min(1, dt * 20)
    }
    if (this.feet) {
      // the right foot covers the brake or the throttle, the left rests, or works the clutch
      if (s.brake > 0.1) this.rightOn = 'brake'
      else if (s.throttle > 0.1) this.rightOn = 'throttle'
      const on = (kind: string) => this.pedals.find((p) => p.kind === kind)!
      const rp = on(this.rightOn)
      const rPress = this.rightOn === 'brake' ? s.brake : s.throttle
      this.feet.right.position.lerp(rp.pad.clone().add(new THREE.Vector3(0, 0.04, 0.12 - rPress * 0.06)), Math.min(1, dt * 14))
      const cp = on('clutch')
      const left = clutch > 0.05 ? cp.pad.clone().add(new THREE.Vector3(0, 0.04, 0.12 - clutch * 0.06)) : new THREE.Vector3(-0.32, -1.06, -0.9)
      this.feet.left.position.lerp(left, Math.min(1, dt * 14))
    }
    if (this.lever) {
      // an H gate: 1 2 / 3 4 / 5 across the planes, odd gears forward, even back. The hand reaches the
      // knob, pulls it out of the old gear, across neutral, into the new one, and goes back to the wheel.
      this.handT = Math.min(HAND_DONE, this.handT + dt)
      const t = this.handT
      const neutral = t >= HAND_AT && t < HAND_AT + 0.1
      const g = Math.max(1, Math.min(5, t < HAND_AT ? this.fromGear : s.gear))
      const plane = g <= 2 ? -1 : g <= 4 ? 0 : 1
      const fore = g % 2 === 1 ? 1 : -1
      this.leverPos.lerp(new THREE.Vector2(neutral ? this.leverPos.x : plane * 0.2, neutral ? 0 : fore * 0.3), Math.min(1, dt * 22))
      this.lever.rotation.set(-this.leverPos.y, 0, -this.leverPos.x)
      if (this.leverHand && this.wheelHand) {
        const ease = (x: number) => x * x * (3 - 2 * x)
        const k = t < HAND_AT ? ease(t / HAND_AT) : t < HAND_BACK ? 1 : t < HAND_DONE ? ease(1 - (t - HAND_BACK) / (HAND_DONE - HAND_BACK)) : 0
        const moving = t < HAND_DONE
        this.leverHand.visible = moving
        this.wheelHand.visible = !moving
        if (moving) {
          this.scene.updateMatrixWorld()
          const toGroup = new THREE.Matrix4().copy(this.group.matrixWorld).invert()
          const onWheel = new THREE.Vector3().setFromMatrixPosition(this.wheelHand.matrixWorld).applyMatrix4(toGroup)
          const onKnob = new THREE.Vector3(0, 0.25, 0).applyMatrix4(this.lever.matrixWorld).applyMatrix4(toGroup)
          this.leverHand.position.copy(onWheel.lerp(onKnob, k))
          this.leverHand.rotation.set(-0.3 * k, 0.4 * (1 - k), 0)
        }
      }
    }
    // arms and legs: from the shoulder or hip to the hand or ankle, bent at the elbow or knee
    for (const l of this.limbs) {
      const b = l.target()
      const elbow = bendAt(l.root, b, l.l1, l.l2, l.bend)
      between(l.upper, l.root, elbow)
      between(l.fore, elbow, b)
      l.joint.position.copy(elbow)
      l.end.position.copy(b)
      l.end.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(elbow).normalize())
    }
    if (this.clock) {
      const now = new Date()
      const m = now.getMinutes() + now.getSeconds() / 60
      this.clock.minute.rotation.z = -(m / 60) * Math.PI * 2
      this.clock.hour.rotation.z = -(((now.getHours() % 12) + m / 60) / 12) * Math.PI * 2
    }
    this.oilT = Math.min(0.85, this.oilT + dt * 0.004 * (0.3 + s.rpm / s.redline))
    for (const n of this.needles) {
      const v = Math.max(0, Math.min(n.max, n.value(s)))
      // 0 at the bottom left, full scale at the bottom right, sweeping clockwise
      n.mesh.rotation.z = Math.PI * 0.75 - (v / n.max) * Math.PI * 1.5
    }
    if (this.leds.length) {
      const f = Math.max(0, Math.min(1, (s.rpm - (s.redline - 3000)) / 2800))
      this.leds.forEach((m, k) => {
        const on = k / 15 < f
        const col = k < 5 ? 0x22ff66 : k < 10 ? 0xff2a2a : 0x3a8bff
        m.emissive.setHex(on ? col : 0x000000)
        m.emissiveIntensity = on ? 3 : 0
      })
    }
    if (this.screen) {
      const text = `${s.gear}|${Math.round(s.speed)}|${Math.round(s.rpm / 100)}`
      if (text !== this.screen.last) {
        this.screen.last = text
        const g = this.screen.g
        g.fillStyle = '#04070a'
        g.fillRect(0, 0, 256, 128)
        g.fillStyle = '#22c55e'
        g.font = '900 92px system-ui, sans-serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(String(s.gear), 128, 68)
        g.fillStyle = '#e8eef3'
        g.font = '700 28px system-ui, sans-serif'
        g.textAlign = 'left'
        g.fillText(String(Math.round(s.speed)), 10, 34)
        g.font = '600 15px system-ui, sans-serif'
        g.fillText('KM/H', 10, 58)
        g.textAlign = 'right'
        g.font = '700 24px system-ui, sans-serif'
        g.fillText(String(Math.round(s.rpm)), 248, 34)
        g.font = '600 15px system-ui, sans-serif'
        g.fillText('RPM', 248, 58)
        this.screen.tex.needsUpdate = true
      }
    }
  }

  dispose() {
    for (const o of this.owned) o.dispose()
  }
}
