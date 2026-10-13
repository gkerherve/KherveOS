// Last Train: the game. A first-person shooter in the subway station of
// lastTrainWorld.ts: zombies climb off the track and come down the stairs;
// clear the wave and a train pulls in; board it, the doors close, and it
// carries you through the tunnel to the next station and a harder wave.
// Three weapons (pistol, rifle, shotgun) with recoil, muzzle flash, tracers,
// shell casings and sounds made with WebAudio (./sound).
//
// The window (LastTrain.tsx) owns the canvas, the pointer lock, the HUD and
// the cards; it feeds input in and calls frame() every animation frame.

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { noise, sfx, tone } from './sound'
import { hasModel, instanceModel, type ModelInstance } from './rkModels'
import {
  buildStation, buildTrain, CAR, DOORS, drawBoard, PILLARS, PLATFORM, rng, sprite, STAIRS, stationAt, texture, TRACK_Y, TRAVEL,
  updateTrainMap, type StationBuild, type TrainBuild,
} from './lastTrainWorld'

const EYE = 1.62
const WALK = 4.6
const SPRINT = 7.4
const GRAVITY = 22

// ---------------------------------------------------------------- weapons

export interface WeaponDef {
  id: 'pistol' | 'rifle' | 'shotgun'
  name: string
  auto: boolean
  damage: number
  pellets: number
  rpm: number
  mag: number
  /** Starting spare ammo; -1 = endless. */
  reserve: number
  reload: number
  spread: number
  kick: number
  range: number
}

export const WEAPONS: WeaponDef[] = [
  { id: 'pistol', name: 'K-9 Pistol', auto: false, damage: 34, pellets: 1, rpm: 380, mag: 12, reserve: -1, reload: 1.15, spread: 0.010, kick: 0.028, range: 80 },
  { id: 'rifle', name: 'KR-4 Rifle', auto: true, damage: 26, pellets: 1, rpm: 640, mag: 30, reserve: 150, reload: 1.9, spread: 0.016, kick: 0.017, range: 120 },
  { id: 'shotgun', name: 'Breacher 12', auto: false, damage: 15, pellets: 9, rpm: 72, mag: 6, reserve: 30, reload: 0.5, spread: 0.065, kick: 0.085, range: 40 },
]

interface Gun {
  def: WeaponDef
  mag: number
  reserve: number
  model: THREE.Group
  muzzle: THREE.Object3D
  /** Moves during reloads (magazine or pump). */
  moving: THREE.Object3D | null
}

// ---------------------------------------------------------------- zombies

type Kind = 'walker' | 'runner' | 'brute'
type ZState = 'track' | 'climb' | 'stairs' | 'chase' | 'dead'

interface Zombie {
  kind: Kind
  /** An animated model (rkModels.ts) instead of the code-posed body. */
  model?: ModelInstance
  root: THREE.Group
  hips: THREE.Object3D
  spine: THREE.Object3D
  head: THREE.Object3D
  arms: [THREE.Object3D, THREE.Object3D]
  fores: [THREE.Object3D, THREE.Object3D]
  thighs: [THREE.Object3D, THREE.Object3D]
  shins: [THREE.Object3D, THREE.Object3D]
  mats: THREE.MeshStandardMaterial[]
  eyes: THREE.Mesh[]
  meshes: THREE.Mesh[]
  shadow: THREE.Mesh
  hp: number
  maxHp: number
  speed: number
  state: ZState
  t: number
  phase: number
  attack: number
  hitT: number
  flash: number
  deadT: number
  fall: number
  groan: number
  goalX: number
  stairX: number
  points: number
}

const KINDS: Record<Kind, { hp: number; speed: number; dmg: number; scale: number; points: number }> = {
  walker: { hp: 100, speed: 1.55, dmg: 12, scale: 1, points: 100 },
  runner: { hp: 62, speed: 4.3, dmg: 8, scale: 0.95, points: 150 },
  brute: { hp: 340, speed: 1.25, dmg: 26, scale: 1.32, points: 450 },
}

// ---------------------------------------------------------------- HUD

export type Stage = 'fight' | 'cleared' | 'trainIn' | 'board' | 'depart' | 'arrive' | 'alight' | 'dying'

export interface Hud {
  health: number
  weapon: string
  slot: number
  mag: number
  reserve: number
  reloading: boolean
  wave: number
  score: number
  kills: number
  left: number
  station: string
  stationColor: string
  stage: Stage
  message: string
  sub: string
}

export interface HudEls {
  crosshair: HTMLElement | null
  hit: HTMLElement | null
  hurt: HTMLElement | null
}

/** The state on arrival at a station: where Continue picks up. */
export interface LTSave {
  wave: number
  station: number
  stationName: string
  health: number
  score: number
  kills: number
  guns: { mag: number; reserve: number }[]
}

export interface GameResult {
  score: number
  wave: number
  kills: number
}

interface Particle {
  p: THREE.Vector3
  v: THREE.Vector3
  life: number
  max: number
}

interface Tracer {
  mesh: THREE.Mesh
  from: THREE.Vector3
  dir: THREE.Vector3
  len: number
  t: number
}

interface Casing {
  mesh: THREE.Mesh
  v: THREE.Vector3
  spin: THREE.Vector3
  life: number
  bounced: number
}

interface Pickup {
  mesh: THREE.Group
  kind: 'ammo' | 'health'
  t: number
}

const ease = {
  in: (t: number) => t * t,
  out: (t: number) => 1 - (1 - t) * (1 - t),
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const RIDE_TIME = 7

export class LastTrainEngine {
  readonly renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.03, 260)
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private world = new THREE.Group()
  private station!: StationBuild
  private stationIndex = 0
  private train: TrainBuild
  private hitTargets: THREE.Object3D[] = []
  private raycaster = new THREE.Raycaster()
  private env: THREE.Texture

  // shared textures and geometries
  private tex = { soft: sprite('soft'), flash: sprite('flash'), hole: sprite('hole'), shadow: sprite('shadow') }
  private holeGeo = new THREE.PlaneGeometry(0.12, 0.12)
  private holeMat: THREE.MeshBasicMaterial
  private shadowMat: THREE.MeshBasicMaterial
  private skins: THREE.CanvasTexture[] = []
  private shirts: THREE.CanvasTexture[] = []
  private zGeo = {
    torso: new THREE.CapsuleGeometry(0.17, 0.3, 6, 14),
    /** Unit radius, 6 long: scale (r, length / 6, r). */
    limb: new THREE.CapsuleGeometry(1, 4, 4, 10),
    head: new THREE.SphereGeometry(0.12, 18, 14),
    box: new THREE.BoxGeometry(1, 1, 1),
    eye: new THREE.SphereGeometry(0.022, 8, 6),
    helmet: new THREE.SphereGeometry(0.15, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  }
  private eyeMats: Record<Kind, THREE.MeshBasicMaterial>
  private socketMat = new THREE.MeshBasicMaterial({ color: 0x050303 })

  // player
  private pos = new THREE.Vector3(0, 0, 6)
  private vel = new THREE.Vector3()
  private yaw = -Math.PI / 2
  private pitch = 0
  private onGround = true
  private health = 100
  private bob = 0
  private stepAcc = 0
  private hurtT = 0
  private punch = new THREE.Vector2()
  private keys = new Set<string>()
  private firing = false
  private aiming = false
  private aim = 0
  private dyingT = 0

  // weapons
  private guns: Gun[] = []
  private slot = 0
  private nextSlot = -1
  private switchT = 0
  private cooldown = 0
  private reloadT = 0
  private triggerHeld = false
  private bloomSpread = 0
  private kickT = 0
  private vm = new THREE.Group()
  private vmSway = new THREE.Vector2()
  private flashSprite: THREE.Sprite
  private flashLight = new THREE.PointLight(0xffc070, 0, 12, 1.6)
  private flashT = 0

  // effects
  private sparks!: { points: THREE.Points; list: Particle[] }
  private blood!: { points: THREE.Points; list: Particle[] }
  private dust: THREE.Points
  private tracers: Tracer[] = []
  private casings: Casing[] = []
  private holes: THREE.Mesh[] = []
  private pickups: Pickup[] = []

  // game
  private zombies: Zombie[] = []
  stage: Stage = 'fight'
  private stageT = 0
  wave = 1
  score = 0
  kills = 0
  private toSpawn = 0
  private spawnT = 0
  private maxAlive = 6
  private doorOpen = 0
  private shake = 0
  private message = ''
  private sub = ''
  private messageT = 0
  private hud: HudEls = { crosshair: null, hit: null, hurt: null }
  private hitT = 0
  private attractT = 0
  private boardT = 0
  private rumbleT = 0
  private lastBoard = ''

  private onOver: (r: GameResult) => void

  constructor(canvas: HTMLCanvasElement, onOver: (r: GameResult) => void) {
    this.onOver = onOver
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.scene.background = new THREE.Color(0x070908)
    this.scene.fog = new THREE.FogExp2(0x070908, 0.021)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const room = new RoomEnvironment()
    this.env = pmrem.fromScene(room, 0.04).texture
    room.dispose()
    pmrem.dispose()
    this.scene.environment = this.env
    this.scene.environmentIntensity = 0.28
    this.scene.add(new THREE.HemisphereLight(0xc8e6d8, 0x1a1712, 0.32))

    this.composer = new EffectComposer(
      this.renderer,
      new THREE.WebGLRenderTarget(16, 16, { samples: 4, type: THREE.HalfFloatType }),
    )
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(16, 16), 0.38, 0.4, 0.92)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.camera.rotation.order = 'YXZ'
    this.scene.add(this.camera, this.world)
    this.camera.add(this.vm, this.flashLight)
    this.flashLight.position.set(0.1, -0.05, -0.6)

    this.holeMat = new THREE.MeshBasicMaterial({ map: this.tex.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })
    this.shadowMat = new THREE.MeshBasicMaterial({ map: this.tex.shadow, transparent: true, depthWrite: false })
    this.eyeMats = {
      walker: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.35, 0.6) }),
      runner: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 1.6, 1.5) }),
      brute: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.5, 0.25) }),
    }
    this.makeZombieTextures()

    this.train = buildTrain(0)
    this.scene.add(this.train.group)
    this.setStation(0)

    // the viewmodel: built in real sizes, then scaled down towards the eye so it never clips into walls
    this.vm.scale.setScalar(0.3)
    this.flashSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex.flash, color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    )
    this.flashSprite.visible = false
    this.buildGuns()

    this.sparks = this.particles(0xffc768, 0.05, THREE.AdditiveBlending, 400)
    this.blood = this.particles(0x6a0a06, 0.07, THREE.NormalBlending, 600)
    this.dust = this.makeDust()

    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      )
      mesh.visible = false
      this.scene.add(mesh)
      this.tracers.push({ mesh, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 0, t: 1 })
    }
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.3, metalness: 1 })
    const red = new THREE.MeshStandardMaterial({ color: 0x9a1c14, roughness: 0.5 })
    const casingGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.026, 8)
    const shellGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.06, 10)
    for (let i = 0; i < 30; i++) {
      const mesh = new THREE.Mesh(i % 3 === 2 ? shellGeo : casingGeo, i % 3 === 2 ? red : brass)
      mesh.visible = false
      this.scene.add(mesh)
      this.casings.push({ mesh, v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, bounced: 0 })
    }
    this.reset()
  }

  // ---------------------------------------------------------------- setup

  private setStation(index: number) {
    if (this.station) {
      this.world.remove(this.station.group)
      this.station.dispose()
    }
    for (const p of this.pickups) p.mesh.removeFromParent()
    this.pickups = []
    this.holes = []
    this.stationIndex = index
    this.station = buildStation(index)
    this.world.add(this.station.group)
    updateTrainMap(this.train, index)
    this.lastBoard = ''
    this.refreshTargets()
  }

  private refreshTargets() {
    this.hitTargets = [...this.station.solids, ...this.train.solids, ...this.zombies.filter((z) => z.state !== 'dead').flatMap((z) => z.meshes)]
  }

  private makeZombieTextures() {
    const r = rng(99)
    const skinCols = ['#7f8f6e', '#8a9479', '#6f7d68', '#97907a', '#7a8670']
    for (const base of skinCols) {
      const c = document.createElement('canvas')
      c.width = c.height = 128
      const g = c.getContext('2d')!
      g.fillStyle = base
      g.fillRect(0, 0, 128, 128)
      for (let i = 0; i < 60; i++) {
        g.fillStyle = r() < 0.5 ? `rgba(60,20,30,${r() * 0.25})` : `rgba(200,210,170,${r() * 0.15})`
        g.beginPath()
        g.arc(r() * 128, r() * 128, 2 + r() * 10, 0, Math.PI * 2)
        g.fill()
      }
      g.strokeStyle = 'rgba(60,40,70,0.35)'
      for (let i = 0; i < 10; i++) {
        g.beginPath()
        let x = r() * 128
        let y = r() * 128
        g.moveTo(x, y)
        for (let k = 0; k < 5; k++) g.lineTo((x += (r() - 0.5) * 24), (y += (r() - 0.5) * 24))
        g.stroke()
      }
      this.skins.push(texture(c))
    }
    const shirtCols = ['#3a4a6a', '#6a3a2a', '#d0cfc4', '#2b2b2b', '#4a5a3a', '#8a6a2a', '#5a2a4a']
    for (const base of shirtCols) {
      const c = document.createElement('canvas')
      c.width = c.height = 128
      const g = c.getContext('2d')!
      g.fillStyle = base
      g.fillRect(0, 0, 128, 128)
      for (let i = 0; i < 18; i++) {
        g.fillStyle = r() < 0.6 ? `rgba(80,8,6,${0.3 + r() * 0.5})` : `rgba(30,25,15,${r() * 0.4})`
        g.beginPath()
        g.ellipse(r() * 128, r() * 128, 3 + r() * 14, 2 + r() * 9, r() * 3, 0, Math.PI * 2)
        g.fill()
      }
      // tears
      g.fillStyle = 'rgba(20,15,12,0.9)'
      for (let i = 0; i < 4; i++) {
        const x = r() * 128
        const y = r() * 128
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x + 6 + r() * 10, y + 2)
        g.lineTo(x + 3, y + 10 + r() * 10)
        g.fill()
      }
      this.shirts.push(texture(c))
    }
  }

  private particles(color: number, size: number, blending: THREE.Blending, n: number) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3).fill(-999), 3))
    const mat = new THREE.PointsMaterial({
      color: blending === THREE.AdditiveBlending ? new THREE.Color(color).multiplyScalar(3) : color,
      size,
      map: this.tex.soft,
      transparent: true,
      depthWrite: false,
      blending,
      sizeAttenuation: true,
    })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false
    this.scene.add(points)
    const list: Particle[] = []
    for (let i = 0; i < n; i++) list.push({ p: new THREE.Vector3(0, -999, 0), v: new THREE.Vector3(), life: 0, max: 1 })
    return { points, list }
  }

  private emit(sys: { list: Particle[] }, at: THREE.Vector3, normal: THREE.Vector3, n: number, speed: number, life: number) {
    let k = 0
    for (const p of sys.list) {
      if (p.life > 0) continue
      p.p.copy(at)
      p.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(speed).addScaledVector(normal, speed * (0.4 + Math.random()))
      p.life = p.max = life * (0.5 + Math.random() * 0.8)
      if (++k >= n) break
    }
  }

  private makeDust(): THREE.Points {
    const n = 900
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = -40 + Math.random() * 80
      pos[i * 3 + 1] = Math.random() * 4.3
      pos[i * 3 + 2] = -4 + Math.random() * 13.5
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xd8e8dc, size: 0.025, map: this.tex.soft, transparent: true, opacity: 0.55, depthWrite: false }),
    )
    this.world.add(pts)
    return pts
  }

  // ---------------------------------------------------------------- the guns

  private buildGuns() {
    const black = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.42, metalness: 0.8 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6, metalness: 0.5 })
    const polymer = new THREE.MeshStandardMaterial({ color: 0x3a3d35, roughness: 0.75, metalness: 0.1 })
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4425, roughness: 0.55 })
    const steel = new THREE.MeshStandardMaterial({ color: 0x9ea3a8, roughness: 0.25, metalness: 1 })
    const glove = new THREE.MeshStandardMaterial({ color: 0x222420, roughness: 0.85 })
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x2f4a3a, roughness: 0.9 })
    const dot = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.3) })
    const sight = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.5, 0.8) })
    const B = (p: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(this.zGeo.box, m)
      mesh.scale.set(w, h, d)
      mesh.position.set(x, y, z)
      p.add(mesh)
      return mesh
    }
    const C = (p: THREE.Object3D, m: THREE.Material, r: number, len: number, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), m)
      mesh.rotation.x = Math.PI / 2
      mesh.position.set(x, y, z)
      p.add(mesh)
      return mesh
    }
    /** A gloved hand at `hand` and a sleeved forearm running back to an elbow below and behind it. */
    const limb = (p: THREE.Object3D, hand: THREE.Vector3, elbow: THREE.Vector3) => {
      const dir = elbow.clone().sub(hand)
      const len = dir.length()
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, len, 4, 10), sleeve)
      arm.position.copy(hand).addScaledVector(dir, 0.5 + 0.06 / len)
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.05, 12), glove)
      cuff.position.copy(hand).addScaledVector(dir, 0.05)
      cuff.quaternion.copy(arm.quaternion)
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), glove)
      fist.scale.set(0.95, 1.1, 1.35)
      fist.position.copy(hand)
      p.add(arm, cuff, fist)
    }
    const arms = (p: THREE.Object3D, rightZ: number, leftZ: number, leftY = -0.02) => {
      limb(p, new THREE.Vector3(0.005, -0.07, rightZ), new THREE.Vector3(0.1, -0.36, rightZ + 0.34))
      limb(p, new THREE.Vector3(-0.012, leftY - 0.035, leftZ), new THREE.Vector3(-0.26, -0.34, Math.max(leftZ + 0.38, 0.2)))
    }

    // pistol
    {
      const g = new THREE.Group()
      B(g, black, 0.034, 0.036, 0.2, 0, 0.0, -0.02)
      B(g, polymer, 0.03, 0.03, 0.17, 0, -0.03, -0.0)
      const grip = B(g, polymer, 0.03, 0.11, 0.045, 0, -0.085, 0.055)
      grip.rotation.x = 0.25
      B(g, black, 0.006, 0.012, 0.008, 0, 0.024, -0.11)
      B(g, black, 0.026, 0.01, 0.01, 0, 0.022, 0.07)
      C(g, steel, 0.007, 0.03, 0, 0.004, -0.125)
      const slide = B(g, black, 0.035, 0.02, 0.06, 0, 0.012, 0.04)
      const muzzle = new THREE.Object3D()
      muzzle.position.set(0, 0.004, -0.15)
      g.add(muzzle)
      arms(g, 0.06, 0.07, -0.05)
      this.guns.push({ def: WEAPONS[0], mag: 0, reserve: 0, model: g, muzzle, moving: slide })
    }
    // rifle
    {
      const g = new THREE.Group()
      B(g, black, 0.05, 0.06, 0.26, 0, 0, 0.02)
      B(g, dark, 0.055, 0.055, 0.24, 0, -0.005, -0.22)
      for (let i = 0; i < 6; i++) B(g, black, 0.058, 0.008, 0.02, 0, 0.026, -0.12 - i * 0.035)
      C(g, steel, 0.011, 0.2, 0, 0.0, -0.42)
      C(g, black, 0.018, 0.06, 0, 0.0, -0.53)
      const mag = B(g, polymer, 0.035, 0.13, 0.06, 0, -0.09, -0.03)
      mag.rotation.x = 0.2
      const grip = B(g, polymer, 0.035, 0.1, 0.045, 0, -0.07, 0.12)
      grip.rotation.x = 0.35
      B(g, polymer, 0.045, 0.07, 0.2, 0, -0.015, 0.25)
      // red-dot sight
      B(g, black, 0.03, 0.02, 0.08, 0, 0.045, 0.0)
      C(g, black, 0.024, 0.07, 0, 0.075, -0.0)
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 18), new THREE.MeshStandardMaterial({ color: 0x223322, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.35 }))
      lens.position.set(0, 0.075, 0.036)
      g.add(lens)
      const reddot = new THREE.Mesh(new THREE.CircleGeometry(0.0022, 10), dot)
      reddot.position.set(0, 0.075, 0.03)
      g.add(reddot)
      const muzzle = new THREE.Object3D()
      muzzle.position.set(0, 0, -0.57)
      g.add(muzzle)
      arms(g, 0.13, -0.24)
      this.guns.push({ def: WEAPONS[1], mag: 0, reserve: 0, model: g, muzzle, moving: mag })
    }
    // shotgun
    {
      const g = new THREE.Group()
      B(g, black, 0.05, 0.065, 0.2, 0, 0, 0.0)
      C(g, steel, 0.014, 0.52, 0, 0.012, -0.34)
      C(g, black, 0.012, 0.44, 0, -0.018, -0.3)
      const pump = C(g, wood, 0.022, 0.15, 0, -0.018, -0.25)
      const stock = B(g, wood, 0.045, 0.08, 0.28, 0, -0.04, 0.22)
      stock.rotation.x = 0.12
      B(g, sight, 0.006, 0.008, 0.006, 0, 0.026, -0.6)
      const muzzle = new THREE.Object3D()
      muzzle.position.set(0, 0.012, -0.61)
      g.add(muzzle)
      arms(g, 0.1, -0.25, -0.03)
      this.guns.push({ def: WEAPONS[2], mag: 0, reserve: 0, model: g, muzzle, moving: pump })
    }
    for (const g of this.guns) {
      g.model.visible = false
      g.model.traverse((o) => (o.frustumCulled = false))
      this.vm.add(g.model)
    }
  }

  private get gun(): Gun {
    return this.guns[this.slot]
  }

  // ---------------------------------------------------------------- public

  /** Called with a checkpoint each time the train reaches a new station. */
  onCheckpoint: ((s: LTSave) => void) | null = null

  /** Start again from a checkpoint: on the platform of that station, its wave about to begin. */
  continueFrom(s: LTSave) {
    this.reset()
    this.setStation(s.station)
    this.wave = s.wave
    this.health = Math.max(50, s.health)
    this.score = s.score
    this.kills = s.kills
    s.guns.forEach((g, i) => {
      if (!this.guns[i]) return
      this.guns[i].mag = g.mag
      this.guns[i].reserve = g.reserve
    })
    this.startWave()
    this.refreshTargets()
  }

  reset() {
    for (const z of this.zombies) this.removeZombie(z)
    this.zombies = []
    if (this.stationIndex !== 0) this.setStation(0)
    for (const p of this.pickups) p.mesh.removeFromParent()
    this.pickups = []
    for (const h of this.holes) h.removeFromParent()
    this.holes = []
    this.world.position.x = 0
    this.train.group.position.x = -TRAVEL
    this.train.group.visible = false
    this.doorOpen = 0
    this.setDoors(0)
    this.pos.set(-4, 0, 6)
    this.vel.set(0, 0, 0)
    this.yaw = Math.PI / 2 + 0.25
    this.pitch = 0
    this.health = 100
    this.score = 0
    this.kills = 0
    this.wave = 1
    this.dyingT = 0
    this.hurtT = 0
    this.punch.set(0, 0)
    for (const [i, g] of this.guns.entries()) {
      g.mag = g.def.mag
      g.reserve = g.def.reserve
      g.model.visible = i === 0
    }
    this.slot = 0
    this.nextSlot = -1
    this.switchT = 0
    this.reloadT = 0
    this.cooldown = 0
    this.keys.clear()
    this.firing = false
    this.aiming = false
    this.startWave()
    this.refreshTargets()
  }

  bindHud(els: HudEls) {
    this.hud = els
  }

  resize(w: number, h: number, dpr: number) {
    const pr = Math.min(dpr, 1.75)
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(pr)
    this.composer.setSize(w, h)
    this.bloom.resolution.set(w * pr * 0.5, h * pr * 0.5)
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
  }

  snapshot(): Hud {
    const g = this.gun
    const st = stationAt(this.stationIndex)
    return {
      health: Math.max(0, Math.ceil(this.health)),
      weapon: g.def.name,
      slot: this.slot,
      mag: g.mag,
      reserve: g.reserve,
      reloading: this.reloadT > 0,
      wave: this.wave,
      score: this.score,
      kills: this.kills,
      left: this.toSpawn + this.zombies.filter((z) => z.state !== 'dead').length,
      station: st.name,
      stationColor: st.color,
      stage: this.stage,
      message: this.messageT > 0 ? this.message : '',
      sub: this.messageT > 0 ? this.sub : '',
    }
  }

  keyDown(code: string) {
    this.keys.add(code)
    if (this.stage === 'dying') return
    if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') this.switchTo(Number(code.slice(5)) - 1)
    else if (code === 'KeyQ') this.switchTo((this.slot + 2) % 3)
    else if (code === 'KeyR') this.startReload()
    else if (code === 'Space' && this.onGround) {
      this.vel.y = 6.4
      this.onGround = false
    }
  }

  keyUp(code: string) {
    this.keys.delete(code)
  }

  releaseAll() {
    this.keys.clear()
    this.firing = false
    this.aiming = false
    this.triggerHeld = false
  }

  look(dx: number, dy: number) {
    if (this.stage === 'dying') return
    const sens = 0.0022 * (this.aiming ? 0.6 : 1)
    this.yaw -= dx * sens
    this.pitch = clamp(this.pitch - dy * sens, -1.5, 1.5)
    this.vmSway.x = clamp(this.vmSway.x + dx * 0.00012, -0.03, 0.03)
    this.vmSway.y = clamp(this.vmSway.y + dy * 0.00012, -0.03, 0.03)
  }

  mouseDown(button: number) {
    if (button === 0) {
      this.firing = true
      this.triggerHeld = false
    } else if (button === 2) this.aiming = true
  }

  mouseUp(button: number) {
    if (button === 0) {
      this.firing = false
      this.triggerHeld = false
    } else if (button === 2) this.aiming = false
  }

  wheel(dy: number) {
    if (Math.abs(dy) < 4) return
    this.switchTo((this.slot + (dy > 0 ? 1 : 2)) % 3)
  }

  /** One animation frame. `playing` false: the scene is drawn, nothing moves (or the attract camera glides). */
  frame(dt: number, mode: 'attract' | 'playing' | 'still') {
    dt = Math.min(dt, 0.05)
    if (mode === 'playing') this.update(dt)
    else if (mode === 'attract') this.attract(dt)
    this.composer.render()
  }

  dispose() {
    this.station.dispose()
    this.train.dispose()
    this.composer.dispose()
    this.env.dispose()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
    for (const t of [...Object.values(this.tex), ...this.skins, ...this.shirts]) t.dispose()
    this.renderer.dispose()
  }

  // ---------------------------------------------------------------- the attract camera (start card)

  private attract(dt: number) {
    this.attractT += dt
    const t = this.attractT * 0.05
    this.camera.position.set(Math.sin(t) * 26, 1.8 + Math.sin(t * 1.7) * 0.25, 2.6 + Math.sin(t * 0.6) * 0.8)
    this.camera.rotation.set(-0.05, -Math.PI / 2 + 0.35 + Math.sin(t * 0.8) * 0.35, 0)
    this.vm.visible = false
    this.animateStation(dt)
  }

  // ---------------------------------------------------------------- update

  private update(dt: number) {
    this.vm.visible = this.stage !== 'dying'
    this.stageT += dt
    this.messageT -= dt
    this.updateStage(dt)
    this.updatePlayer(dt)
    this.updateWeapon(dt)
    this.updateZombies(dt)
    this.updateEffects(dt)
    this.updatePickups(dt)
    this.animateStation(dt)
    this.placeCamera(dt)
    this.updateHudEls(dt)
  }

  private say(message: string, sub = '', secs = 3.5) {
    this.message = message
    this.sub = sub
    this.messageT = secs
  }

  private startWave() {
    this.stage = 'fight'
    this.stageT = 0
    const w = this.wave
    this.toSpawn = 5 + w * 4
    this.maxAlive = Math.min(16, 4 + w * 2)
    this.spawnT = 2.5
    this.station.signals.red.emissiveIntensity = 4
    this.station.signals.green.emissiveIntensity = 0
    this.say(`Wave ${w}`, stationAt(this.stationIndex).name, 3)
  }

  private updateStage(dt: number) {
    const train = this.train.group
    switch (this.stage) {
      case 'fight': {
        this.spawnT -= dt
        const alive = this.zombies.filter((z) => z.state !== 'dead').length
        if (this.toSpawn > 0 && this.spawnT <= 0 && alive < this.maxAlive) {
          this.spawn()
          this.toSpawn--
          this.spawnT = Math.max(0.45, 2.4 - this.wave * 0.22) * (0.6 + Math.random() * 0.8)
        }
        if (this.toSpawn === 0 && alive === 0 && this.stageT > 3) {
          const bonus = 500 * this.wave
          this.score += bonus
          this.stage = 'cleared'
          this.stageT = 0
          this.say('Wave cleared', `+${bonus} — the train is coming`, 4)
          this.station.signals.red.emissiveIntensity = 0
          this.station.signals.green.emissiveIntensity = 4
        }
        break
      }
      case 'cleared':
        if (this.stageT > 3) {
          this.stage = 'trainIn'
          this.stageT = 0
          train.visible = true
          train.position.x = -TRAVEL
          this.setDoors(0)
          sfx('horn', () => {
            tone({ freq: 220, dur: 1.1, type: 'sawtooth', vol: 0.05 })
            tone({ freq: 277, dur: 1.1, type: 'sawtooth', vol: 0.04 })
          })
        }
        break
      case 'trainIn': {
        const k = clamp(this.stageT / RIDE_TIME, 0, 1)
        train.position.x = -TRAVEL * (1 - ease.out(k))
        this.rumble(dt, (1 - k) * 0.8 + 0.15, 30 - Math.abs(train.position.x) * 0.15)
        if (k > 0.55) sfx('brake', () => tone({ freq: 2600, to: 2300, dur: 1.4, type: 'sine', vol: 0.025 }), 1.3)
        if (k >= 1) {
          this.stage = 'board'
          this.stageT = 0
          this.chime()
          this.say('Board the train', 'Step inside — the doors close behind you', 5)
        }
        break
      }
      case 'board': {
        this.doorOpen = Math.min(1, this.doorOpen + dt / 1.1)
        this.setDoors(this.doorOpen)
        const inside = this.inCar()
        this.boardT = inside ? this.boardT + dt : 0
        if (this.boardT > 0.9) {
          this.stage = 'depart'
          this.stageT = 0
          this.chime()
          noise({ dur: 0.9, freq: 900, to: 300, filter: 'lowpass', vol: 0.12 })
        }
        break
      }
      case 'depart': {
        if (this.stageT < 1.2) {
          this.doorOpen = Math.max(0, 1 - this.stageT / 1.1)
          this.setDoors(this.doorOpen)
          break
        }
        const k = clamp((this.stageT - 1.2) / RIDE_TIME, 0, 1)
        this.world.position.x = -TRAVEL * ease.in(k)
        this.rumble(dt, 0.3 + k * 0.9, 1)
        if (k >= 1) {
          this.wave++
          this.setStation(this.stationIndex + 1)
          this.world.position.x = TRAVEL
          this.stage = 'arrive'
          this.stageT = 0
          this.say('Next station', stationAt(this.stationIndex).name, 4)
          // a little resupply on the way
          this.health = Math.min(100, this.health + 25)
          for (const g of this.guns) if (g.reserve >= 0) g.reserve = Math.min(g.def.reserve * 2, g.reserve + Math.ceil(g.def.mag * 1.5))
        }
        break
      }
      case 'arrive': {
        const k = clamp(this.stageT / RIDE_TIME, 0, 1)
        this.world.position.x = TRAVEL * (1 - ease.out(k))
        this.rumble(dt, 1.2 - k, 1)
        if (k > 0.6) sfx('brake', () => tone({ freq: 2500, to: 2250, dur: 1.4, type: 'sine', vol: 0.025 }), 1.3)
        if (k >= 1) {
          this.world.position.x = 0
          this.stage = 'alight'
          this.stageT = 0
          this.chime()
          this.onCheckpoint?.({
            wave: this.wave, station: this.stationIndex, stationName: stationAt(this.stationIndex).name, health: Math.max(50, Math.ceil(this.health)),
            score: this.score, kills: this.kills, guns: this.guns.map((g) => ({ mag: g.mag, reserve: g.reserve })),
          })
          this.say(stationAt(this.stationIndex).name, `Step off the train for wave ${this.wave}`, 5)
        }
        break
      }
      case 'alight': {
        if (this.doorOpen < 1) {
          this.doorOpen = Math.min(1, this.doorOpen + dt / 1.1)
          this.setDoors(this.doorOpen)
        }
        if (this.pos.z > 0.6) {
          // off the train: it leaves, the wave begins
          this.startWave()
          this.leaving = 0
        }
        break
      }
      case 'dying':
        this.dyingT += dt
        if (this.dyingT > 1.6 && this.dyingT - dt <= 1.6) this.onOver({ score: this.score, wave: this.wave, kills: this.kills })
        break
    }
    // the train pulls out after you step off
    if (this.leaving >= 0) {
      this.leaving += dt
      if (this.leaving < 1.1) {
        this.doorOpen = Math.max(0, 1 - this.leaving / 1.1)
        this.setDoors(this.doorOpen)
      } else {
        const k = clamp((this.leaving - 1.4) / 6, 0, 1)
        train.position.x = TRAVEL * ease.in(k)
        this.rumble(dt, 0.2 + k * 0.6, 30 - train.position.x * 0.15)
        if (k >= 1) {
          train.visible = false
          this.leaving = -1
        }
      }
    }
  }

  private leaving = -1

  private chime() {
    sfx('chime', () => {
      tone({ freq: 659, dur: 0.5, type: 'sine', vol: 0.12 })
      tone({ freq: 523, dur: 0.7, type: 'sine', vol: 0.12, at: 0.42 })
    }, 0.5)
  }

  private rumble(dt: number, amount: number, near: number) {
    this.rumbleT -= dt
    this.shake = Math.max(this.shake, amount * 0.012 * clamp(near / 30, 0.2, 1))
    if (this.rumbleT <= 0) {
      this.rumbleT = 0.32
      noise({ dur: 0.45, freq: 140 + amount * 60, filter: 'lowpass', vol: 0.07 * amount * clamp(near / 30, 0.15, 1) })
    }
  }

  private setDoors(open: number) {
    const e = ease.inOut(open)
    for (const l of this.train.leaves) l.mesh.position.x = l.x + l.dir * e * 0.68
  }

  private inCar(): boolean {
    return this.pos.x > CAR.x0 && this.pos.x < CAR.x1 && this.pos.z < -0.75 && this.pos.z > CAR.z0 - 0.1
  }

  // ---------------------------------------------------------------- the player

  /** Where the player may stand right now: axis-aligned rectangles. */
  private walkable(): [number, number, number, number][] {
    const plat: [number, number, number, number] = [PLATFORM.x0, PLATFORM.x1, PLATFORM.z0, PLATFORM.z1]
    const car: [number, number, number, number] = [CAR.x0, CAR.x1, CAR.z0, CAR.z1]
    const docked = this.train.group.visible && Math.abs(this.train.group.position.x) < 0.01 && Math.abs(this.world.position.x) < 0.01
    if (this.stage === 'depart' || this.stage === 'arrive') return [car]
    if (docked && this.doorOpen > 0.85) return [plat, car, ...DOORS.map((d) => [d - 0.42, d + 0.42, -0.8, 0.5] as [number, number, number, number])]
    if (docked && this.inCar()) return [car]
    return [plat]
  }

  private free(x: number, z: number, rects: [number, number, number, number][]): boolean {
    if (!rects.some(([x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)) return false
    return true
  }

  private updatePlayer(dt: number) {
    if (this.stage === 'dying') return
    const k = this.keys
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    const sprinting = (k.has('ShiftLeft') || k.has('ShiftRight')) && f > 0 && !this.aiming
    const speed = (sprinting ? SPRINT : WALK) * (this.aiming ? 0.55 : 1)
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
    const want = fwd.multiplyScalar(f).addScaledVector(right, s)
    if (want.lengthSq() > 1) want.normalize()
    want.multiplyScalar(speed)
    const accel = this.onGround ? 14 : 3
    this.vel.x += (want.x - this.vel.x) * Math.min(1, accel * dt)
    this.vel.z += (want.z - this.vel.z) * Math.min(1, accel * dt)

    const rects = this.walkable()
    const nx = this.pos.x + this.vel.x * dt
    if (this.free(nx, this.pos.z, rects)) this.pos.x = nx
    else this.vel.x = 0
    const nz = this.pos.z + this.vel.z * dt
    if (this.free(this.pos.x, nz, rects)) this.pos.z = nz
    else this.vel.z = 0
    // pillars
    for (const p of PILLARS) {
      const dx = this.pos.x - p.x
      const dz = this.pos.z - p.z
      const d = Math.hypot(dx, dz)
      const min = p.r + 0.3
      if (d < min && d > 1e-4) {
        this.pos.x = p.x + (dx / d) * min
        this.pos.z = p.z + (dz / d) * min
      }
    }
    // zombies push back a little
    for (const z of this.zombies) {
      if (z.state === 'dead') continue
      const dx = this.pos.x - z.root.position.x
      const dz = this.pos.z - z.root.position.z
      const d = Math.hypot(dx, dz)
      const min = 0.65 * KINDS[z.kind].scale
      if (d < min && d > 1e-4 && Math.abs(z.root.position.y - this.pos.y) < 1) {
        const nx2 = z.root.position.x + (dx / d) * min
        const nz2 = z.root.position.z + (dz / d) * min
        if (this.free(nx2, nz2, rects)) {
          this.pos.x = nx2
          this.pos.z = nz2
        }
      }
    }
    if (!this.free(this.pos.x, this.pos.z, rects)) {
      // pushed out of bounds: back to the nearest point inside
      const [x0, x1, z0, z1] = rects[0]
      this.pos.x = clamp(this.pos.x, x0, x1)
      this.pos.z = clamp(this.pos.z, z0, z1)
    }

    // jump and gravity
    this.vel.y -= GRAVITY * dt
    this.pos.y += this.vel.y * dt
    if (this.pos.y <= 0) {
      if (!this.onGround && this.vel.y < -4) this.step(0.6)
      this.pos.y = 0
      this.vel.y = 0
      this.onGround = true
    }

    const hs = Math.hypot(this.vel.x, this.vel.z)
    if (this.onGround && hs > 0.5) {
      this.bob += dt * hs * 1.9
      this.stepAcc += hs * dt
      if (this.stepAcc > (sprinting ? 2.4 : 1.9)) {
        this.stepAcc = 0
        this.step(sprinting ? 0.5 : 0.35)
      }
    }
    this.aim += ((this.aiming && this.reloadT <= 0 && this.switchT <= 0 ? 1 : 0) - this.aim) * Math.min(1, dt * 12)
    this.sprinting = sprinting && hs > 3
    this.hurtT = Math.max(0, this.hurtT - dt)
  }

  private sprinting = false

  private step(vol: number) {
    sfx('step', () => {
      noise({ dur: 0.06, freq: 500 + Math.random() * 300, filter: 'lowpass', vol: 0.09 * vol })
      noise({ dur: 0.03, freq: 2400, filter: 'bandpass', q: 2, vol: 0.03 * vol, at: 0.01 })
    }, 0.12)
  }

  private placeCamera(dt: number) {
    const c = this.camera
    this.punch.multiplyScalar(Math.exp(-dt * 11))
    this.shake *= Math.exp(-dt * 5)
    const bobAmt = this.onGround ? Math.min(1, Math.hypot(this.vel.x, this.vel.z) / WALK) : 0
    const by = Math.abs(Math.sin(this.bob)) * 0.045 * bobAmt * (1 - this.aim * 0.8)
    const bx = Math.cos(this.bob) * 0.025 * bobAmt * (1 - this.aim * 0.8)
    let eye = EYE
    let roll = 0
    if (this.stage === 'dying') {
      const k = ease.out(clamp(this.dyingT / 1.1, 0, 1))
      eye = EYE - k * 1.35
      roll = k * 1.2
    }
    // the train sways a little with you in it
    let sway = 0
    if (this.stage === 'depart' || this.stage === 'arrive') sway = Math.sin(performance.now() * 0.0021) * 0.012
    const sh = this.shake
    c.position.set(
      this.pos.x + bx + (Math.random() - 0.5) * sh,
      this.pos.y + eye - by + (Math.random() - 0.5) * sh,
      this.pos.z + (Math.random() - 0.5) * sh,
    )
    c.rotation.set(this.pitch + this.punch.x, this.yaw + this.punch.y, roll + sway)
    const fov = 72 - this.aim * (this.gun.def.id === 'rifle' ? 24 : 14)
    if (Math.abs(c.fov - fov) > 0.01) {
      c.fov = fov
      c.updateProjectionMatrix()
    }
  }

  hurt(dmg: number) {
    if (this.stage === 'dying') return
    this.health -= dmg
    this.hurtT = 0.6
    this.punch.x += 0.05
    this.punch.y += (Math.random() - 0.5) * 0.08
    sfx('hurt', () => {
      noise({ dur: 0.18, freq: 400, to: 150, filter: 'lowpass', vol: 0.25 })
      tone({ freq: 140, to: 70, dur: 0.22, type: 'triangle', vol: 0.14 })
    }, 0.15)
    if (this.health <= 0) {
      this.health = 0
      this.stage = 'dying'
      this.dyingT = 0
      this.releaseAll()
      tone({ freq: 220, to: 55, dur: 1.4, type: 'sawtooth', vol: 0.08 })
    }
  }

  // ---------------------------------------------------------------- shooting

  private switchTo(i: number) {
    if (i === this.slot && this.nextSlot < 0) return
    if (i < 0 || i > 2) return
    this.nextSlot = i
    this.switchT = 0.36
    this.reloadT = 0
    sfx('switch', () => noise({ dur: 0.08, freq: 3000, filter: 'highpass', vol: 0.06 }))
  }

  private startReload() {
    const g = this.gun
    if (this.reloadT > 0 || this.switchT > 0 || g.mag >= g.def.mag || g.reserve === 0) return
    this.reloadT = g.def.id === 'shotgun' ? g.def.reload + 0.25 : g.def.reload
    sfx('reload', () => {
      noise({ dur: 0.05, freq: 2400, filter: 'bandpass', q: 3, vol: 0.12 })
      noise({ dur: 0.05, freq: 1800, filter: 'bandpass', q: 3, vol: 0.12, at: g.def.reload * 0.7 })
    })
  }

  private finishReload() {
    const g = this.gun
    if (g.def.id === 'shotgun') {
      // one shell at a time; keep going while the tube is not full
      g.mag++
      if (g.reserve > 0) g.reserve--
      sfx('shell', () => noise({ dur: 0.06, freq: 1500, filter: 'bandpass', q: 2, vol: 0.12 }))
      if (g.mag < g.def.mag && g.reserve !== 0 && !this.firing) this.reloadT = g.def.reload
      else sfx('pump', () => {
        noise({ dur: 0.05, freq: 1200, filter: 'bandpass', q: 2, vol: 0.14 })
        noise({ dur: 0.05, freq: 1700, filter: 'bandpass', q: 2, vol: 0.14, at: 0.12 })
      })
      return
    }
    const need = g.def.mag - g.mag
    const got = g.reserve < 0 ? need : Math.min(need, g.reserve)
    g.mag += got
    if (g.reserve >= 0) g.reserve -= got
  }

  private updateWeapon(dt: number) {
    this.cooldown -= dt
    this.bloomSpread *= Math.exp(-dt * 5)
    this.kickT = Math.max(0, this.kickT - dt * 7)
    this.flashT -= dt
    this.flashSprite.visible = this.flashT > 0
    this.flashLight.intensity = this.flashT > 0 ? 30 : 0

    if (this.switchT > 0) {
      this.switchT -= dt
      if (this.nextSlot >= 0 && this.switchT < 0.18) {
        this.gun.model.visible = false
        this.slot = this.nextSlot
        this.nextSlot = -1
        this.gun.model.visible = true
      }
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt
      if (this.reloadT <= 0) {
        this.reloadT = 0
        this.finishReload()
      }
    }
    const g = this.gun
    const canShoot = this.stage !== 'dying' && this.switchT <= 0 && !this.sprinting
    if (this.firing && canShoot && this.cooldown <= 0 && (g.def.auto || !this.triggerHeld)) {
      if (g.def.id === 'shotgun' && this.reloadT > 0 && g.mag > 0) this.reloadT = 0 // interrupt the shell-by-shell reload
      if (this.reloadT > 0) {
        // still reloading
      } else if (g.mag <= 0) {
        if (!this.triggerHeld) sfx('dry', () => noise({ dur: 0.03, freq: 3500, filter: 'bandpass', q: 4, vol: 0.12 }))
        this.triggerHeld = true
        this.startReload()
      } else {
        this.shoot()
        this.triggerHeld = true
        if (g.mag === 0) window.setTimeout(() => this.gun === g && this.startReload(), 250)
      }
    }
    if (!this.firing) this.triggerHeld = false
    this.animateViewmodel(dt)
  }

  private shoot() {
    const g = this.gun
    const d = g.def
    g.mag--
    this.cooldown = 60 / d.rpm
    this.kickT = 1
    const k = d.kick * (1 - this.aim * 0.4)
    this.pitch = clamp(this.pitch + k * 0.35, -1.5, 1.5)
    this.punch.x += k * 0.65
    this.punch.y += (Math.random() - 0.5) * k * 0.6
    this.yaw += (Math.random() - 0.5) * k * 0.2
    this.bloomSpread = Math.min(0.06, this.bloomSpread + d.spread * 0.6)
    this.flashT = 0.05
    this.flashSprite.material.rotation = Math.random() * Math.PI
    this.flashSprite.scale.setScalar(d.id === 'shotgun' ? 0.32 : d.id === 'rifle' ? 0.24 : 0.17)
    g.muzzle.add(this.flashSprite)
    this.gunSound(d.id)

    this.scene.updateMatrixWorld()
    const origin = new THREE.Vector3()
    g.muzzle.getWorldPosition(origin)
    const spread = this.currentSpread()
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    let hits = 0
    let head = false
    for (let i = 0; i < d.pellets; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * spread
      const ndc = new THREE.Vector2((Math.cos(a) * Math.tan(r)) / tan / this.camera.aspect, (Math.sin(a) * Math.tan(r)) / tan)
      this.raycaster.setFromCamera(ndc, this.camera)
      this.raycaster.far = d.range
      const hit = this.raycaster.intersectObjects(this.hitTargets, false)[0]
      const end = hit ? hit.point : this.raycaster.ray.at(d.range, new THREE.Vector3())
      if (i < 3 || i % 3 === 0) this.tracer(origin, end)
      if (!hit) continue
      const z = hit.object.userData.zombie as Zombie | undefined
      if (z) {
        const isHead = z.model
          ? hit.point.y - (z.root.position.y + this.world.position.y) > z.model.height * KINDS[z.kind].scale * 0.8
          : hit.object.userData.part === 'head'
        const falloff = d.id === 'shotgun' ? clamp(1.3 - hit.distance / 18, 0.25, 1) : 1
        this.damage(z, d.damage * falloff * (isHead ? 2.4 : 1), isHead, this.raycaster.ray.direction, hit.point)
        hits++
        head ||= isHead
      } else {
        const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0)
        this.emit(this.sparks, hit.point, n, 6, 2.5, 0.35)
        this.bulletHole(hit.point, n)
        if (i === 0) sfx('ric', () => noise({ dur: 0.05, freq: 3000 + Math.random() * 2000, filter: 'bandpass', q: 6, vol: 0.05 }), 0.05)
      }
    }
    if (hits) this.hitMarker(head)
    this.eject(d.id)
  }

  private currentSpread(): number {
    const d = this.gun.def
    const move = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / WALK)
    const air = this.onGround ? 0 : 0.03
    return (d.spread + this.bloomSpread + move * 0.02 + air) * (1 - this.aim * (d.id === 'shotgun' ? 0.3 : 0.75))
  }

  private gunSound(id: WeaponDef['id']) {
    if (id === 'pistol') {
      noise({ dur: 0.16, freq: 2200, to: 500, filter: 'bandpass', q: 0.8, vol: 0.4 })
      tone({ freq: 160, to: 50, dur: 0.12, type: 'sine', vol: 0.3 })
      noise({ dur: 0.5, freq: 900, to: 200, filter: 'lowpass', vol: 0.06, at: 0.04 }) // the station's echo
    } else if (id === 'rifle') {
      noise({ dur: 0.11, freq: 2800, to: 700, filter: 'bandpass', q: 0.7, vol: 0.36 })
      tone({ freq: 120, to: 45, dur: 0.1, type: 'sine', vol: 0.3 })
      noise({ dur: 0.35, freq: 700, to: 150, filter: 'lowpass', vol: 0.05, at: 0.03 })
    } else {
      noise({ dur: 0.32, freq: 3200, to: 260, filter: 'lowpass', vol: 0.6 })
      tone({ freq: 95, to: 32, dur: 0.28, type: 'sine', vol: 0.45 })
      noise({ dur: 0.8, freq: 600, to: 120, filter: 'lowpass', vol: 0.08, at: 0.06 })
      noise({ dur: 0.05, freq: 1200, filter: 'bandpass', q: 2, vol: 0.14, at: 0.38 })
      noise({ dur: 0.05, freq: 1700, filter: 'bandpass', q: 2, vol: 0.14, at: 0.52 })
    }
  }

  private tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const t = this.tracers.find((x) => x.t >= 1) ?? this.tracers[0]
    t.from.copy(from)
    t.dir.subVectors(to, from)
    t.len = t.dir.length()
    t.dir.normalize()
    t.t = 0
    t.mesh.visible = true
  }

  private bulletHole(at: THREE.Vector3, n: THREE.Vector3) {
    const m = new THREE.Mesh(this.holeGeo, this.holeMat)
    m.position.copy(at).addScaledVector(n, 0.004)
    m.lookAt(at.clone().add(n))
    m.rotateZ(Math.random() * Math.PI)
    m.scale.setScalar(0.7 + Math.random() * 0.6)
    // holes live in the world group (they ride away with the station)
    this.world.worldToLocal(m.position)
    this.station.litter.add(m)
    this.holes.push(m)
    if (this.holes.length > 90) this.holes.shift()!.removeFromParent()
  }

  private eject(id: WeaponDef['id']) {
    const c = this.casings.find((x) => x.life <= 0) ?? this.casings[0]
    const shell = id === 'shotgun'
    // shotgun shells are the red ones (every third casing mesh)
    const pick = this.casings.filter((x, i) => x.life <= 0 && (i % 3 === 2) === shell)[0] ?? c
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    pick.mesh.position.copy(this.camera.position).addScaledVector(right, 0.12).addScaledVector(fwd, 0.25).add(new THREE.Vector3(0, -0.1, 0))
    pick.v.copy(right).multiplyScalar(1.6 + Math.random()).addScaledVector(fwd, -0.3 + Math.random() * 0.4).add(new THREE.Vector3(0, 1.8 + Math.random(), 0))
    pick.v.x += this.vel.x
    pick.v.z += this.vel.z
    pick.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20)
    pick.life = 4
    pick.bounced = 0
    pick.mesh.visible = true
  }

  private hitMarker(head: boolean) {
    this.hitT = 0.15
    const el = this.hud.hit
    if (el) el.dataset.head = head ? '1' : ''
    sfx('hitmark', () => tone({ freq: head ? 1800 : 1200, dur: 0.05, type: 'sine', vol: 0.06 }), 0.04)
  }

  private animateViewmodel(dt: number) {
    const g = this.gun
    const t = performance.now() * 0.001
    this.vmSway.multiplyScalar(Math.exp(-dt * 8))
    const bobAmt = this.onGround ? Math.min(1, Math.hypot(this.vel.x, this.vel.z) / WALK) : 0
    const aim = this.aim
    const hip = new THREE.Vector3(0.17, -0.165, -0.36)
    const ads = new THREE.Vector3(0, g.def.id === 'rifle' ? -0.075 : g.def.id === 'pistol' ? -0.022 : -0.022, g.def.id === 'pistol' ? -0.3 : -0.26)
    const p = hip.lerp(ads, aim)
    const breathe = Math.sin(t * 1.6) * 0.003 * (1 - aim)
    p.x += Math.cos(this.bob) * 0.012 * bobAmt * (1 - aim * 0.85) - this.vmSway.x
    p.y += -Math.abs(Math.sin(this.bob)) * 0.012 * bobAmt * (1 - aim * 0.85) + breathe + this.vmSway.y
    // recoil
    const kick = ease.out(this.kickT)
    const kz = g.def.id === 'shotgun' ? 0.09 : g.def.id === 'rifle' ? 0.035 : 0.05
    p.z += kick * kz * (1 - aim * 0.5)
    let rx = kick * (g.def.id === 'shotgun' ? 0.3 : 0.12)
    let ry = 0
    let rz = 0
    // reload and switch dips
    const g2 = g.def
    if (this.reloadT > 0) {
      const k = 1 - this.reloadT / g2.reload
      const dip = Math.sin(clamp(k, 0, 1) * Math.PI)
      p.y -= dip * 0.07
      rx -= dip * 0.35
      rz += dip * 0.4
      if (g.moving && g2.id !== 'shotgun') g.moving.position.y = (g2.id === 'rifle' ? -0.09 : 0.012) - (g2.id === 'rifle' ? dip * 0.25 : 0)
      if (g.moving && g2.id === 'pistol') g.moving.position.z = 0.04 + (k > 0.85 ? (1 - k) * 0.3 : 0)
    } else if (g.moving) {
      if (g2.id === 'rifle') g.moving.position.y = -0.09
      if (g2.id === 'pistol') g.moving.position.z = 0.04 + kick * 0.035 // the slide cycles
      if (g2.id === 'shotgun') g.moving.position.z = -0.25 + Math.sin(clamp(1 - this.cooldown / (60 / g2.rpm), 0, 1) * Math.PI) * 0.07 * (this.cooldown > 0 ? 1 : 0)
    }
    if (this.switchT > 0) {
      const k = this.switchT / 0.36
      const dip = Math.sin(k * Math.PI)
      p.y -= dip * 0.25
      rx -= dip * 0.6
    }
    if (this.sprinting) {
      ry += 0.6
      rx -= 0.25
      p.x -= 0.05
      p.y -= 0.04
    }
    this.vmSmooth.lerp(new THREE.Vector3(rx, ry, rz), Math.min(1, dt * 14))
    g.model.position.copy(p)
    g.model.rotation.set(this.vmSmooth.x + this.vmSway.y * 2, this.vmSmooth.y + this.vmSway.x * 3, this.vmSmooth.z + this.vmSway.x * 2)
  }

  private vmSmooth = new THREE.Vector3()

  // ---------------------------------------------------------------- zombies

  private spawn() {
    const w = this.wave
    const roll = Math.random()
    const kind: Kind = w >= 3 && roll < Math.min(0.22, 0.06 * (w - 2)) ? 'brute' : w >= 2 && roll > 1 - Math.min(0.45, 0.12 * w) ? 'runner' : 'walker'
    const z = this.makeZombie(kind)
    const scale = 1 + (w - 1) * 0.12
    z.maxHp = z.hp = KINDS[kind].hp * scale
    z.speed = KINDS[kind].speed * (1 + (w - 1) * 0.04) * (0.85 + Math.random() * 0.3)
    // nothing comes out of the tunnels while a train is still in the station
    const where = this.leaving >= 0 || this.train.group.visible ? 0 : Math.random()
    if (where < 0.35) {
      // down the stairs, the further one from the player first
      const sx = STAIRS[Math.abs(this.pos.x - STAIRS[0]) > Math.abs(this.pos.x - STAIRS[1]) ? 0 : 1]
      const x = Math.random() < 0.7 ? sx : STAIRS.find((s) => s !== sx)!
      z.state = 'stairs'
      z.stairX = x + (Math.random() - 0.5) * 2.4
      z.root.position.set(z.stairX, 3.8, 15.6)
    } else {
      // out of a tunnel, along the track, then up onto the platform
      const s = Math.random() < 0.5 ? -1 : 1
      z.state = 'track'
      z.root.position.set(s * (44 + Math.random() * 8), TRACK_Y, -2.4 + Math.random() * 1.2)
      z.goalX = clamp(this.pos.x + (Math.random() - 0.5) * 20, -36, 36)
    }
    this.world.add(z.root)
    this.zombies.push(z)
    this.refreshTargets()
  }

  private makeZombie(kind: Kind): Zombie {
    if (hasModel('zombie')) return this.modelZombie(kind)
    const r = Math.random
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
    const skin = new THREE.MeshStandardMaterial({ map: pick(this.skins), roughness: 0.85 })
    const shirt = new THREE.MeshStandardMaterial({ map: pick(this.shirts), roughness: 0.9 })
    const pants = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.6 + r() * 0.15, 0.2, 0.12 + r() * 0.1), roughness: 0.9 })
    const mats = [skin, shirt, pants]
    const g = this.zGeo
    const root = new THREE.Group()
    root.rotation.order = 'YXZ'
    const body = new THREE.Group()
    body.scale.setScalar(KINDS[kind].scale * (0.94 + r() * 0.12))
    root.add(body)
    const meshes: THREE.Mesh[] = []
    const z: Partial<Zombie> = {}
    const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, part: string, sx: number, sy: number, sz: number, x: number, y: number, zz: number) => {
      const m = new THREE.Mesh(geo, mat)
      m.scale.set(sx, sy, sz)
      m.position.set(x, y, zz)
      m.userData.part = part
      parent.add(m)
      meshes.push(m)
      return m
    }
    const hips = new THREE.Object3D()
    hips.position.y = 0.95
    body.add(hips)
    mesh(hips, g.box, pants, 'body', 0.34, 0.18, 0.22, 0, 0, 0)
    const thighs: THREE.Object3D[] = []
    const shins: THREE.Object3D[] = []
    for (const s of [-1, 1]) {
      const thigh = new THREE.Object3D()
      thigh.position.set(s * 0.1, -0.06, 0)
      hips.add(thigh)
      mesh(thigh, g.limb, pants, 'leg', 0.075, 0.074, 0.075, 0, -0.21, 0)
      const shin = new THREE.Object3D()
      shin.position.y = -0.44
      thigh.add(shin)
      mesh(shin, g.limb, pants, 'leg', 0.062, 0.07, 0.062, 0, -0.2, 0)
      mesh(shin, g.box, kind === 'brute' ? pants : skin, 'leg', 0.1, 0.07, 0.22, 0, -0.43, 0.05)
      thighs.push(thigh)
      shins.push(shin)
    }
    const spine = new THREE.Object3D()
    spine.position.y = 0.08
    hips.add(spine)
    mesh(spine, g.torso, shirt, 'body', 1, 1, 0.68, 0, 0.27, 0)
    if (kind === 'brute') {
      // a hi-vis vest: the station's maintenance crew
      const vest = new THREE.MeshStandardMaterial({ color: 0xd8ff2a, emissive: 0x334400, roughness: 0.7 })
      mats.push(vest)
      mesh(spine, g.torso, vest, 'body', 1.04, 0.92, 0.72, 0, 0.27, 0)
    }
    const neck = new THREE.Object3D()
    neck.position.y = 0.6
    spine.add(neck)
    mesh(neck, g.limb, skin, 'head', 0.05, 0.02, 0.05, 0, 0.0, 0)
    const head = new THREE.Object3D()
    head.position.y = 0.05
    neck.add(head)
    mesh(head, g.head, skin, 'head', 1, 1.15, 1.05, 0, 0.11, 0)
    const jaw = mesh(head, g.box, skin, 'head', 0.13, 0.05, 0.12, 0, 0.0, 0.04)
    jaw.rotation.x = 0.35
    const eyes: THREE.Mesh[] = []
    for (const s of [-1, 1]) {
      const sock = mesh(head, g.eye, this.socketMat, 'head', 1.5, 1.3, 0.8, s * 0.045, 0.135, 0.1)
      sock.userData.part = 'head'
      const e = new THREE.Mesh(g.eye, this.eyeMats[kind])
      e.scale.setScalar(0.8)
      e.position.set(s * 0.045, 0.135, 0.112)
      head.add(e)
      eyes.push(e)
    }
    if (kind === 'brute') {
      const hat = new THREE.MeshStandardMaterial({ color: 0xf2b416, roughness: 0.4 })
      mats.push(hat)
      mesh(head, g.helmet, hat, 'head', 1, 0.9, 1.05, 0, 0.16, 0)
    } else if (r() < 0.6) {
      const hair = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.08, 0.3, 0.05 + r() * 0.15), roughness: 1 })
      mats.push(hair)
      mesh(head, g.head, hair, 'head', 1.06, 0.7, 1.06, 0, 0.17, -0.02)
    }
    const arms: THREE.Object3D[] = []
    const fores: THREE.Object3D[] = []
    for (const s of [-1, 1]) {
      const arm = new THREE.Object3D()
      arm.position.set(s * 0.23, 0.5, 0)
      spine.add(arm)
      mesh(arm, g.limb, shirt, 'body', 0.06, 0.052, 0.06, 0, -0.15, 0)
      const fore = new THREE.Object3D()
      fore.position.y = -0.3
      arm.add(fore)
      mesh(fore, g.limb, skin, 'body', 0.05, 0.047, 0.05, 0, -0.14, 0)
      mesh(fore, g.box, skin, 'body', 0.07, 0.11, 0.04, 0, -0.32, 0)
      arms.push(arm)
      fores.push(fore)
    }
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), this.shadowMat)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.01
    root.add(shadow)
    for (const m of meshes) m.userData.zombie = z
    Object.assign(z, {
      kind, root, hips, spine, head: neck, arms, fores, thighs, shins, mats, eyes, meshes, shadow,
      hp: 100, maxHp: 100, speed: 1, state: 'chase', t: 0, phase: r() * 10, attack: 0, hitT: 0, flash: 0,
      deadT: 0, fall: r() < 0.5 ? -1 : 1, groan: 1 + r() * 4, goalX: 0, stairX: 0, points: KINDS[kind].points,
    })
    return z as Zombie
  }

  /** A zombie from the animated models: same game state, the model animates itself. */
  private modelZombie(kind: Kind): Zombie {
    const model = instanceModel('zombie')
    const root = new THREE.Group()
    root.rotation.order = 'YXZ'
    model.root.scale.setScalar(KINDS[kind].scale)
    root.add(model.root)
    const dummy = () => new THREE.Object3D()
    const shadow = new THREE.Mesh(new THREE.BufferGeometry(), this.shadowMat)
    shadow.visible = false
    const z = {
      kind, model, root, hips: dummy(), spine: dummy(), head: dummy(), arms: [dummy(), dummy()], fores: [dummy(), dummy()],
      thighs: [dummy(), dummy()], shins: [dummy(), dummy()], mats: model.mats, eyes: [], meshes: model.meshes, shadow,
      hp: 100, maxHp: 100, speed: 1, state: 'chase', t: 0, phase: Math.random() * 10, attack: 0, hitT: 0, flash: 0,
      deadT: 0, fall: 1, groan: 1 + Math.random() * 4, goalX: 0, stairX: 0, points: KINDS[kind].points,
    } as unknown as Zombie
    for (const m of model.meshes) m.userData.zombie = z
    return z
  }

  private removeZombie(z: Zombie) {
    z.root.removeFromParent()
    for (const m of z.mats) m.dispose()
    z.shadow.geometry.dispose()
  }

  private damage(z: Zombie, dmg: number, head: boolean, dir: THREE.Vector3, at: THREE.Vector3) {
    if (z.state === 'dead') return
    z.hp -= dmg
    z.flash = 1
    z.hitT = 0.25
    this.emit(this.blood, at, dir.clone().multiplyScalar(-0.3).add(new THREE.Vector3(0, 0.4, 0)), head ? 16 : 8, 2.2, 0.7)
    sfx('flesh', () => noise({ dur: 0.07, freq: 500, to: 200, filter: 'lowpass', vol: 0.18 }), 0.03)
    // a shove backwards
    z.root.position.x += dir.x * 0.06 * (z.kind === 'brute' ? 0.3 : 1)
    z.root.position.z += dir.z * 0.06 * (z.kind === 'brute' ? 0.3 : 1)
    if (z.hp <= 0) {
      z.state = 'dead'
      z.deadT = 0
      // fall away from the shot
      const local = new THREE.Vector3(dir.x, 0, dir.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -z.root.rotation.y)
      z.fall = local.z > 0 ? 1 : -1
      for (const e of z.eyes) e.visible = false
      if (head) {
        z.head.visible = false
        this.emit(this.blood, at, new THREE.Vector3(0, 1, 0), 40, 2.8, 1.0)
        sfx('splat', () => noise({ dur: 0.25, freq: 700, to: 150, filter: 'lowpass', vol: 0.3 }), 0.05)
      }
      const pts = Math.round(z.points * (head ? 1.5 : 1))
      this.score += pts
      this.kills++
      this.refreshTargets()
      if (Math.random() < (z.kind === 'brute' ? 0.9 : 0.28)) this.drop(z.root.position, Math.random() < 0.45 ? 'health' : 'ammo')
    }
  }

  private groan(z: Zombie) {
    const d = z.root.position.clone().add(this.world.position).distanceTo(this.pos)
    const vol = clamp(1 - d / 28, 0, 1)
    if (vol <= 0.02) return
    const base = z.kind === 'brute' ? 70 : z.kind === 'runner' ? 150 : 100
    sfx('groan', () => {
      tone({ freq: base * (0.9 + Math.random() * 0.3), to: base * 0.7, dur: 0.7 + Math.random() * 0.6, type: 'sawtooth', vol: 0.05 * vol })
      noise({ dur: 0.6, freq: 500, filter: 'bandpass', q: 3, vol: 0.04 * vol })
    }, 0.4)
  }

  private updateZombies(dt: number) {
    const player = this.pos
    let removed = false
    for (const z of this.zombies) {
      const p = z.root.position
      z.t += dt
      z.flash = Math.max(0, z.flash - dt * 6)
      z.hitT = Math.max(0, z.hitT - dt)
      for (const m of z.mats) if (!m.userData.glow) m.emissive.setRGB(z.flash * 0.5, 0, 0)

      if (z.state === 'dead') {
        z.deadT += dt
        const k = ease.out(clamp(z.deadT / 0.55, 0, 1))
        if (z.model) {
          z.model.play('death')
          z.model.mixer.update(dt)
        } else {
          z.root.rotation.x = z.fall * k * (Math.PI / 2 - 0.08)
          z.hips.position.y = 0.95 - k * 0.55
          z.arms[0].rotation.x = z.arms[1].rotation.x = -k * 2.5 * z.fall
          z.shins[0].rotation.x = k * 0.5
        }
        if (z.deadT > 6) {
          const fade = clamp(1 - (z.deadT - 6) / 1.5, 0, 1)
          for (const m of z.mats) {
            m.transparent = true
            m.opacity = fade
          }
          if (fade <= 0) {
            this.removeZombie(z)
            removed = true
          }
        }
        continue
      }

      const dx = player.x - p.x
      const dz = player.z - p.z
      const dist = Math.hypot(dx, dz)
      z.groan -= dt
      if (z.groan <= 0) {
        z.groan = 2.5 + Math.random() * 4
        this.groan(z)
      }
      let move = new THREE.Vector3()
      let face = Math.atan2(dx, dz)
      let speed = z.speed * (z.hitT > 0 ? 0.35 : 1)

      if (z.state === 'track') {
        // walk along the track bed to below the goal, then climb
        const gx = z.goalX - p.x
        move.set(Math.sign(gx), 0, (-1.0 - p.z) * 0.5)
        face = Math.atan2(move.x, move.z)
        if (Math.abs(gx) < 0.4) {
          z.state = 'climb'
          z.t = 0
        }
        speed = Math.max(speed, 1.6)
      } else if (z.state === 'climb') {
        const k = clamp(z.t / 1.3, 0, 1)
        p.y = TRACK_Y + (0 - TRACK_Y) * ease.inOut(clamp(k * 1.2, 0, 1))
        p.z = THREE.MathUtils.lerp(-0.9, 0.5, ease.inOut(k))
        face = 0
        z.arms[0].rotation.x = z.arms[1].rotation.x = -2.6 + k * 1.2
        z.spine.rotation.x = 0.5 * (1 - k)
        if (k >= 1) {
          z.state = 'chase'
          p.y = 0
        }
        speed = 0
        if (z.t < 0.05 && Math.random() < 0.5) this.groan(z)
      } else if (z.state === 'stairs') {
        move.set((z.stairX - p.x) * 0.5, 0, -1)
        face = Math.PI
        p.y = clamp(((p.z - 10.1) / 5.7) * 3.8, 0, 3.8)
        if (p.z <= 9.7) {
          z.state = 'chase'
          p.y = 0
        }
      } else {
        // chase, keeping apart from the others and out of the pillars
        move.set(dx, 0, dz).normalize()
        for (const o of this.zombies) {
          if (o === z || o.state === 'dead') continue
          const ox = p.x - o.root.position.x
          const oz = p.z - o.root.position.z
          const d = Math.hypot(ox, oz)
          if (d < 0.9 && d > 1e-3) move.add(new THREE.Vector3(ox / d, 0, oz / d).multiplyScalar((0.9 - d) * 2))
        }
        for (const pl of PILLARS) {
          const ox = p.x - pl.x
          const oz = p.z - pl.z
          const d = Math.hypot(ox, oz)
          if (d < pl.r + 1.2) {
            // steer around: push out plus slide sideways
            const tx = -oz / d
            const tz = ox / d
            const side = tx * dx + tz * dz > 0 ? 1 : -1
            move.add(new THREE.Vector3(ox / d + tx * side, 0, oz / d + tz * side).multiplyScalar((pl.r + 1.2 - d) * 0.9))
          }
        }
        if (dist < 1.05 * KINDS[z.kind].scale) speed = 0
        // attack
        z.attack -= dt
        if (dist < 1.25 * KINDS[z.kind].scale && z.attack <= 0 && this.stage !== 'dying') {
          z.attack = z.kind === 'runner' ? 0.75 : 1.15
          z.t = 0
          window.setTimeout(() => {
            if (z.state === 'dead') return
            const d2 = Math.hypot(this.pos.x - z.root.position.x, this.pos.z - z.root.position.z)
            if (d2 < 1.5 * KINDS[z.kind].scale) this.hurt(KINDS[z.kind].dmg * (1 + (this.wave - 1) * 0.06))
          }, 280)
          sfx('swipe', () => noise({ dur: 0.18, freq: 1200, to: 400, filter: 'bandpass', vol: 0.08 }), 0.1)
        }
      }

      if (speed > 0 && move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed * dt)
        p.add(move)
      }
      if (z.state === 'chase') {
        p.x = clamp(p.x, PLATFORM.x0, PLATFORM.x1)
        p.z = clamp(p.z, PLATFORM.z0, PLATFORM.z1)
        for (const pl of PILLARS) {
          const ox = p.x - pl.x
          const oz = p.z - pl.z
          const d = Math.hypot(ox, oz)
          if (d < pl.r + 0.25 && d > 1e-4) {
            p.x = pl.x + (ox / d) * (pl.r + 0.25)
            p.z = pl.z + (oz / d) * (pl.r + 0.25)
          }
        }
      }
      // turn towards where it goes
      let dy = face - z.root.rotation.y
      dy = Math.atan2(Math.sin(dy), Math.cos(dy))
      z.root.rotation.y += dy * Math.min(1, dt * (z.kind === 'runner' ? 8 : 4))

      this.animateZombie(z, dt, speed, dist)
      z.shadow.visible = z.state === 'chase' || z.state === 'track'
    }
    if (removed) this.zombies = this.zombies.filter((z) => z.root.parent)
  }

  private animateZombie(z: Zombie, dt: number, speed: number, dist: number) {
    if (z.model) {
      const m = z.model
      if (z.state === 'climb') m.play('walk')
      else if (z.attack > 0 && dist < 1.6 && z.t < 0.5) m.play('attack', 0.5)
      else if (z.hitT > 0.15) m.play('hit', 0.3)
      else if (speed > 2.6) m.play('run')
      else if (speed > 0.2) m.play('walk')
      else m.play('idle')
      m.pace(speed / (z.kind === 'runner' ? 4 : 1.5))
      m.mixer.update(dt)
      return
    }
    if (z.state === 'climb') return
    const runner = z.kind === 'runner'
    z.phase += dt * (speed * (runner ? 2.6 : 3.4) + 0.4)
    const ph = z.phase
    const swing = runner ? 0.85 : 0.45
    z.thighs[0].rotation.x = Math.sin(ph) * swing
    z.thighs[1].rotation.x = -Math.sin(ph) * swing
    z.shins[0].rotation.x = Math.max(0, -Math.cos(ph)) * swing * 1.4
    z.shins[1].rotation.x = Math.max(0, Math.cos(ph)) * swing * 1.4
    z.hips.position.y = 0.95 - Math.abs(Math.cos(ph)) * 0.04
    z.hips.rotation.z = Math.sin(ph) * (runner ? 0.05 : 0.09)
    const flinch = z.hitT > 0 ? -0.5 * (z.hitT / 0.25) : 0
    z.spine.rotation.x = (runner ? 0.42 : 0.18) + flinch
    z.spine.rotation.z = Math.sin(ph * 0.5 + z.phase * 0.1) * 0.06
    z.head.rotation.z = Math.sin(z.t * 1.3 + z.phase) * 0.25
    z.head.rotation.x = -0.25 + Math.sin(z.t * 2.1) * 0.08
    // attack swipe in the first 0.4 s after an attack began
    const atk = z.attack > 0 && dist < 1.6 && z.t < 0.45 ? Math.sin((z.t / 0.45) * Math.PI) : 0
    if (runner) {
      z.arms[0].rotation.x = -Math.sin(ph) * 0.9 - atk * 1.6
      z.arms[1].rotation.x = Math.sin(ph) * 0.9 - atk * 1.6
      z.fores[0].rotation.x = z.fores[1].rotation.x = -1.2
    } else {
      z.arms[0].rotation.x = -1.35 + Math.sin(ph * 0.5) * 0.12 - atk * 0.9 + atk * 1.8 * 0.5
      z.arms[1].rotation.x = -1.45 - Math.sin(ph * 0.5) * 0.12 - atk * 0.9
      z.fores[0].rotation.x = -0.2 - atk * 0.6
      z.fores[1].rotation.x = -0.3
    }
    z.arms[0].rotation.z = -0.12
    z.arms[1].rotation.z = 0.12
  }

  // ---------------------------------------------------------------- pickups

  private drop(at: THREE.Vector3, kind: Pickup['kind']) {
    const g = new THREE.Group()
    const boxMat = new THREE.MeshStandardMaterial({ color: kind === 'ammo' ? 0x3d4a2a : 0xe8e8e0, roughness: 0.6, metalness: 0.2 })
    const glow = new THREE.MeshBasicMaterial({ color: kind === 'ammo' ? new THREE.Color(2.4, 1.8, 0.4) : new THREE.Color(0.4, 2.6, 0.8) })
    const b = new THREE.Mesh(this.zGeo.box, boxMat)
    b.scale.set(0.36, 0.22, 0.24)
    g.add(b)
    if (kind === 'health') {
      const c1 = new THREE.Mesh(this.zGeo.box, glow)
      c1.scale.set(0.14, 0.04, 0.245)
      const c2 = new THREE.Mesh(this.zGeo.box, glow)
      c2.scale.set(0.045, 0.14, 0.245)
      g.add(c1, c2)
    } else {
      const s = new THREE.Mesh(this.zGeo.box, glow)
      s.scale.set(0.37, 0.04, 0.245)
      g.add(s)
    }
    g.position.set(at.x, 0.35, at.z)
    if (g.position.z < PLATFORM.z0) g.position.z = PLATFORM.z0 + 0.2
    this.station.litter.add(g)
    this.pickups.push({ mesh: g, kind, t: 0 })
  }

  private updatePickups(dt: number) {
    for (const p of this.pickups) {
      p.t += dt
      p.mesh.rotation.y += dt * 1.6
      p.mesh.position.y = 0.35 + Math.sin(p.t * 3) * 0.06
      const d = Math.hypot(p.mesh.position.x + this.world.position.x - this.pos.x, p.mesh.position.z - this.pos.z)
      if (d < 1.1 && this.stage !== 'dying') {
        if (p.kind === 'health') {
          if (this.health >= 100) continue
          this.health = Math.min(100, this.health + 35)
          this.say('+35 health', '', 1.2)
        } else {
          for (const g of this.guns) if (g.reserve >= 0) g.reserve += g.def.id === 'shotgun' ? 8 : 45
          this.say('Ammo', '', 1.2)
        }
        sfx('pickup', () => {
          tone({ freq: 660, dur: 0.08, type: 'triangle', vol: 0.1 })
          tone({ freq: 990, dur: 0.12, type: 'triangle', vol: 0.1, at: 0.07 })
        })
        p.mesh.removeFromParent()
        p.t = -1
      }
    }
    this.pickups = this.pickups.filter((p) => p.t >= 0)
  }

  // ---------------------------------------------------------------- effects

  private updateEffects(dt: number) {
    for (const sys of [this.sparks, this.blood]) {
      const arr = sys.points.geometry.attributes.position as THREE.BufferAttribute
      sys.list.forEach((p, i) => {
        if (p.life > 0) {
          p.life -= dt
          p.v.y -= 9.8 * dt
          p.v.multiplyScalar(1 - dt * 1.5)
          p.p.addScaledVector(p.v, dt)
          if (p.p.y < 0.01 && p.p.z > 0) {
            p.p.y = 0.01
            p.v.set(0, 0, 0)
          }
          arr.setXYZ(i, p.p.x, p.p.y, p.p.z)
        } else arr.setXYZ(i, 0, -999, 0)
      })
      arr.needsUpdate = true
    }
    for (const t of this.tracers) {
      if (t.t >= 1) continue
      const speed = 320
      t.t += (dt * speed) / Math.max(1, t.len)
      const head = Math.min(t.len, t.t * t.len)
      const seg = Math.min(4, head)
      const tail = head - seg
      const mid = t.from.clone().addScaledVector(t.dir, (head + tail) / 2)
      t.mesh.position.copy(mid)
      t.mesh.lookAt(mid.clone().add(t.dir))
      t.mesh.scale.set(0.012, 0.012, Math.max(0.01, seg))
      ;(t.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9
      if (t.t >= 1) t.mesh.visible = false
    }
    for (const c of this.casings) {
      if (c.life <= 0) continue
      c.life -= dt
      c.v.y -= 9.8 * dt
      c.mesh.position.addScaledVector(c.v, dt)
      c.mesh.rotation.x += c.spin.x * dt
      c.mesh.rotation.y += c.spin.y * dt
      c.mesh.rotation.z += c.spin.z * dt
      const floor = c.mesh.position.z < 0 && !this.inCar() ? TRACK_Y : 0.006
      if (c.mesh.position.y < floor) {
        c.mesh.position.y = floor
        if (c.v.y < -0.8 && c.bounced < 3) {
          c.bounced++
          const casing = c.mesh.geometry === this.casings[0].mesh.geometry
          sfx('tink', () => tone({ freq: casing ? 3800 + Math.random() * 1500 : 900, dur: 0.05, type: 'sine', vol: casing ? 0.03 : 0.05 }), 0.02)
        }
        c.v.y = Math.abs(c.v.y) * 0.35
        c.v.x *= 0.5
        c.v.z *= 0.5
        c.spin.multiplyScalar(0.5)
        if (Math.abs(c.v.y) < 0.3) {
          c.v.set(0, 0, 0)
          c.spin.set(0, 0, 0)
        }
      }
      if (c.life <= 0) c.mesh.visible = false
    }
    // the dust drifts
    const dp = this.dust.geometry.attributes.position as THREE.BufferAttribute
    const now = performance.now() * 0.001
    for (let i = 0; i < dp.count; i += 7) {
      dp.setY(i, (dp.getY(i) + dt * 0.03) % 4.3)
      dp.setX(i, dp.getX(i) + Math.sin(now + i) * dt * 0.05)
    }
    dp.needsUpdate = true
  }

  private animateStation(dt: number) {
    const f = this.station.flicker
    const t = performance.now() * 0.001
    const on = Math.sin(t * 13) + Math.sin(t * 7.3) + Math.sin(t * 2.1) > 0.4 || Math.sin(t * 0.7) > 0.6
    f.mat.emissiveIntensity = on ? 3.2 : 0.15
    f.light.intensity = on ? 14 : 5
    // the next-train board
    let l1 = `1  ${stationAt(this.stationIndex + 1).name}`
    let l2 = 'Service suspended'
    if (this.stage === 'cleared') l2 = 'Approaching'
    else if (this.stage === 'trainIn') l2 = 'Arriving'
    else if (this.stage === 'board' || this.stage === 'alight') l2 = 'Stand clear of doors'
    else if (this.stage === 'fight') l2 = `${Math.max(1, this.toSpawn + this.zombies.length)} on the line`
    if (this.lastBoard !== l1 + l2) {
      this.lastBoard = l1 + l2
      drawBoard(this.station.board.canvas, l1, l2)
      this.station.board.tex.needsUpdate = true
    }
    void dt
  }

  private updateHudEls(dt: number) {
    this.hitT = Math.max(0, this.hitT - dt)
    const ch = this.hud.crosshair
    if (ch) {
      const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
      const h = this.renderer.domElement.clientHeight
      const gap = 4 + (Math.tan(this.currentSpread()) / tan) * (h / 2)
      ch.style.setProperty('--gap', `${gap.toFixed(1)}px`)
      ch.style.opacity = String(this.sprinting || this.stage === 'dying' ? 0 : 1 - this.aim * (this.gun.def.id === 'shotgun' ? 0.3 : 0.9))
    }
    if (this.hud.hit) this.hud.hit.style.opacity = String(this.hitT > 0 ? 1 : 0)
    if (this.hud.hurt) {
      const low = this.health < 35 ? 0.35 + Math.sin(performance.now() * 0.006) * 0.12 : 0
      this.hud.hurt.style.opacity = String(Math.max(this.hurtT / 0.6, low, this.stage === 'dying' ? 0.8 : 0))
    }
  }
}

