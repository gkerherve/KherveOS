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
    const suit = std({ color: teamColor, roughness: 0.85 })
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
      // five round gauges: oil temperature, speedometer, the big rev counter, oil pressure, fuel
      const dials: { x: number; r: number; o: Parameters<typeof dialTexture>[0]; value: (s: CockpitState) => number }[] = [
        { x: -0.205, r: 0.04, o: { max: 150, step: 50, minor: 10, label: 'OIL °C' }, value: () => this.oilT * 130 },
        { x: -0.105, r: 0.05, o: { max: 280, step: 40, minor: 10, label: 'km/h' }, value: (s) => s.speed },
        { x: 0.0, r: 0.064, o: { max: 9000, step: 1000, minor: 200, label: '1/min ×1000', red: 7200, scale: 1000, sub: 'flat-six' }, value: (s) => s.rpm },
        { x: 0.105, r: 0.05, o: { max: 10, step: 2, minor: 0.5, label: 'OIL bar' }, value: (s) => 1.5 + 5 * (s.rpm / s.redline) },
        { x: 0.205, r: 0.04, o: { max: 100, step: 25, minor: 5, label: 'FUEL %' }, value: () => 72 },
      ]
      for (const d of dials) {
        const y = -0.3 + (d.x === 0 ? 0.008 : 0)
        const z = -0.52
        const face = std({ map: keep(dialTexture(d.o)), roughness: 0.6, emissive: 0x332a1a, emissiveIntensity: 0.25 })
        const tilt = new THREE.Group()
        tilt.position.set(d.x, y, z)
        tilt.rotation.x = -0.18
        this.group.add(tilt)
        add(tilt, new THREE.CircleGeometry(d.r, 40), face)
        add(tilt, new THREE.TorusGeometry(d.r + 0.004, 0.0055, 8, 40), chrome, 0, 0, 0.003)
        add(tilt, new THREE.CylinderGeometry(d.r + 0.002, d.r + 0.002, 0.012, 32, 1, true).rotateX(Math.PI / 2), black, 0, 0, -0.004)
        add(tilt, new THREE.SphereGeometry(d.r * 1.6, 24, 8, 0, Math.PI * 2, 0, 0.62).rotateX(Math.PI / 2).translate(0, 0, -d.r * 1.6 * Math.cos(0.62) + 0.007), glass)
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
      // ---- the steering wheel: a leather rim with stitching, drilled aluminium spokes, the horn push with the K
      this.wheel.position.set(0, -0.31, -0.415)
      this.wheel.rotation.x = 0.36
      const rimT = keep(leatherTexture('#2a1d14', true))
      rimT.repeat.set(10, 1)
      add(this.wheel, new THREE.TorusGeometry(0.19, 0.017, 14, 72), std({ map: rimT, roughness: 0.7 }))
      const spokeAlpha = keep(drilledAlpha(4, 1))
      const spokeM = std({ color: 0xc4c8cc, roughness: 0.3, metalness: 0.9, alphaMap: spokeAlpha, alphaTest: 0.5, side: THREE.DoubleSide })
      // two spokes a little below the horizontal: the wheel is open at the bottom, the pedals show through
      for (const d of [Math.PI + 0.25, -0.25]) {
        const sp = add(this.wheel, new THREE.BoxGeometry(0.15, 0.032, 0.004), spokeM, Math.cos(d) * 0.1, Math.sin(d) * 0.1, -0.006)
        sp.rotation.z = d
      }
      add(this.wheel, new THREE.CylinderGeometry(0.048, 0.052, 0.03, 28).rotateX(Math.PI / 2), black, 0, 0, -0.008)
      const hornT = (() => {
        const [c, g] = canvas(128, 128)
        g.fillStyle = '#0c0c0c'
        g.fillRect(0, 0, 128, 128)
        g.strokeStyle = '#22c55e'
        g.lineWidth = 7
        g.beginPath()
        g.arc(64, 64, 44, 0, Math.PI * 2)
        g.stroke()
        g.fillStyle = '#eafff1'
        g.font = '900 56px system-ui'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText('K', 64, 67)
        const t = new THREE.CanvasTexture(c)
        t.colorSpace = THREE.SRGBColorSpace
        return keep(t)
      })()
      add(this.wheel, new THREE.CircleGeometry(0.042, 28), std({ map: hornT, roughness: 0.4 }), 0, 0, 0.008)
      const lh = hand(this.wheel, -0.19 * Math.cos(0.32), 0.19 * Math.sin(0.32), -1)
      const rh = hand(this.wheel, 0.19 * Math.cos(0.32), 0.19 * Math.sin(0.32), 1)
      this.group.add(this.wheel)
      arm(new THREE.Vector3(-0.34, -0.8, 0.15), lh)
      arm(new THREE.Vector3(0.34, -0.8, 0.15), rh)
      // ---- the tunnel and the gear lever: a pleated leather boot, a chrome stick, the knob with the pattern
      add(this.group, new THREE.BoxGeometry(0.2, 0.22, 0.75), std({ map: leatherT, roughness: 0.85 }), mid, -0.78, -0.42)
      const bootPts: THREE.Vector2[] = []
      for (let i = 0; i <= 16; i++) {
        const t = i / 16
        bootPts.push(new THREE.Vector2(0.075 * (1 - t) + 0.012 + Math.sin(t * Math.PI * 7) * 0.006 * (1 - t), t * 0.13))
      }
      add(this.group, new THREE.LatheGeometry(bootPts, 24), std({ map: leatherT, roughness: 0.75 }), mid, -0.67, -0.52)
      add(this.group, new THREE.TorusGeometry(0.085, 0.008, 6, 28).rotateX(Math.PI / 2), chrome, mid, -0.668, -0.52)
      const lever = new THREE.Group()
      lever.position.set(mid, -0.6, -0.52)
      add(lever, new THREE.CylinderGeometry(0.008, 0.011, 0.26, 10), chrome, 0, 0.1, 0)
      add(lever, new THREE.SphereGeometry(0.032, 24, 16).scale(1, 0.85, 1), std({ color: 0x111111, roughness: 0.3 }), 0, 0.235, 0)
      add(lever, new THREE.CircleGeometry(0.024, 24).rotateX(-Math.PI / 2), std({ map: keep(knobTexture()), roughness: 0.35 }), 0, 0.262, 0)
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
      for (const [kind, x, w] of [['clutch', -0.17, 0.08], ['brake', -0.02, 0.09], ['throttle', 0.13, 0.06]] as ['clutch' | 'brake' | 'throttle', number, number][]) {
        const a = new THREE.Group()
        a.position.set(x, -0.88, -1.06)
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.1, 0.04), new THREE.Vector3(0, -0.2, 0.06)])
        add(a, new THREE.TubeGeometry(curve, 12, 0.008, 8), alu)
        add(a, new THREE.BoxGeometry(w + 0.01, kind === 'throttle' ? 0.13 : 0.08, 0.006), rubber, 0, -0.22, 0.058)
        add(a, new THREE.BoxGeometry(w, kind === 'throttle' ? 0.12 : 0.07, 0.004), padM, 0, -0.22, 0.064)
        this.group.add(a)
        this.pedals.push({ arm: a, kind, pad: new THREE.Vector3(x, -1.1, -1.0) })
      }
      const boot = () => {
        const b = new THREE.Group()
        add(b, new THREE.CapsuleGeometry(0.045, 0.16, 4, 10).rotateX(Math.PI / 2 - 0.5), std({ color: 0x0d0d0d, roughness: 0.5 }), 0, 0, 0.05)
        add(b, new THREE.CylinderGeometry(0.05, 0.05, 0.25, 10).rotateX(-0.9), suit, 0, 0.1, 0.18)
        this.group.add(b)
        return b
      }
      this.feet = { right: boot(), left: boot() }
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
      add(this.group, new THREE.BoxGeometry(0.2, 0.06, 0.02), black, mid, 0.17, -0.6)
      add(this.group, new THREE.PlaneGeometry(0.18, 0.045), std({ color: 0xffffff, roughness: 0.02, metalness: 1 }), mid, 0.17, -0.589)
      add(this.group, new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6), black, mid, 0.22, -0.6)
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
      // an H gate: 1 2 / 3 4 / 5 across the planes, odd gears forward, even back; through neutral on a change
      const g = Math.max(1, Math.min(5, s.gear))
      const plane = g <= 2 ? -1 : g <= 4 ? 0 : 1
      const fore = g % 2 === 1 ? 1 : -1
      const neutral = this.shiftT < 0.45
      this.leverPos.lerp(new THREE.Vector2(plane * 0.2, neutral ? 0 : fore * 0.3), Math.min(1, dt * 16))
      this.lever.rotation.set(-this.leverPos.y, 0, -this.leverPos.x)
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
