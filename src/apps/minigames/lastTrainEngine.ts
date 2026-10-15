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
import { ScaryMusic } from './lastTrainMusic'
import { hasModel, instanceModel, type ModelInstance } from './rkModels'
import {
  CAR_L, CAR_PITCH, CAR_W, CAR_XS, CAR_Z, DOORS, drawBoard, FINAL_STATION, HALL, hallAt, hallY, LANDING, PLATFORM, rng, sprite, STAIR, stairSlope, stairY, STAIRS, stationAt, texture,
  TRACK_Y, TRAVEL,
} from './lastTrainWorld'
import { buildStation, type ExitBuild, type StationBuild } from './lastTrainStation'
import { buildTrain, setTrainDisplay, updateTrainMap, type TrainBuild } from './lastTrainCars'
import {
  buildGuns, magReloadTime, makeMag, poseReload, PUMP_T, restGun, SHELL_LEAD, SHELL_T, type Gun, type Pose, type ReloadEvent, type ReloadState,
} from './lastTrainGuns'

const EYE = 1.62
const WALK = 4.6
const SPRINT = 7.4
const GRAVITY = 22

// ---------------------------------------------------------------- weapons: see lastTrainGuns.ts

export type { WeaponDef } from './lastTrainGuns'

// ---------------------------------------------------------------- zombies

type Kind = 'walker' | 'runner' | 'brute' | 'bloater' | 'spitter'
/** `wait`: standing still in the dark of the intro, staring. */
type ZState = 'track' | 'climb' | 'stairs' | 'chase' | 'wait' | 'dead'

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
  /** One of the crowd pressed against a gate: it never dies, it only reaches through the bars. */
  crowd: boolean
  next: number
  /** The spitter's time to its next glob. */
  spit: number
}

/** A sheet of paper blowing about the platform. */
interface Paper {
  mesh: THREE.Mesh
  v: THREE.Vector3
  spin: THREE.Vector3
  air: boolean
  /** How easily the wind lifts it (newspaper flies, cardboard barely). */
  lift: number
  phase: number
}

/** The intro: when the lights come on (start, end in seconds) and how far away they stand by then. */
const INTRO_ON: [number, number, number][] = [
  [1.0, 1.08, 18], [1.25, 1.33, 17], [2.3, 2.95, 13], [3.7, 3.76, 10], [3.9, 4.0, 9.5], [5.0, 5.7, 7], [6.4, 6.46, 5], [6.6, 6.68, 4.4],
]
const INTRO_END = 7.5

interface Glob {
  mesh: THREE.Mesh
  v: THREE.Vector3
  life: number
}

const KINDS: Record<Kind, { hp: number; speed: number; dmg: number; scale: number; points: number }> = {
  walker: { hp: 100, speed: 1.55, dmg: 12, scale: 1, points: 100 },
  runner: { hp: 62, speed: 4.3, dmg: 8, scale: 0.95, points: 150 },
  brute: { hp: 340, speed: 1.25, dmg: 26, scale: 1.32, points: 450 },
  /** Swollen and green: bursts when shot dead or when it reaches you, and hurts everything around it. */
  bloater: { hp: 170, speed: 1.15, dmg: 0, scale: 1.12, points: 300 },
  /** Thin and pale: keeps its distance and spits acid. */
  spitter: { hp: 85, speed: 2.1, dmg: 6, scale: 1.04, points: 250 },
}
/** How far a bloater's burst reaches, and what it does to the player at its centre. */
const BURST = { r: 3.4, dmg: 42 }

// ---------------------------------------------------------------- HUD

export type Stage = 'intro' | 'fight' | 'cleared' | 'trainIn' | 'board' | 'depart' | 'arrive' | 'alight' | 'exit' | 'escaped' | 'dying'

export interface Hud {
  health: number
  weapon: string
  slot: number
  /** The guns found so far: their slot (key = slot + 1) and short name. */
  slots: { slot: number; name: string }[]
  magSize: number
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
  /** True when the player climbed out of the last station. */
  won?: boolean
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

type Rect = [number, number, number, number]

interface Pickup {
  mesh: THREE.Group
  kind: 'ammo' | 'health'
  t: number
  y0: number
}

const ease = {
  in: (t: number) => t * t,
  out: (t: number) => 1 - (1 - t) * (1 - t),
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** The door, the flight and the hall of a stairway as walkable rectangles, kept r from the walls. */
function hallRects(sx: number, r: number): Rect[] {
  const X = (u: number) => sx - 2 - u
  const H = HALL
  return [
    [X(H.flightU0 + 0.1), X(-0.45), H.doorZ0 + r - 0.15, H.doorZ1 - r + 0.15],
    [X(H.flightU1 + 0.2), X(0.1), H.flightZ0 + r, H.flightZ1 - r],
    [X(H.u1 - r), X(H.flightU1 + r - 0.15), H.z0 + r, H.z1 - r],
  ]
}
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
  /** The reload in progress: how far the animation is (see lastTrainGuns.ts), the pose it asks of the viewmodel. */
  private rs: ReloadState = { clock: 0, prev: 0, empty: false, phase: 'mag', first: true }
  private pose: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
  /** The magazines that fell out of the gun and lie on the floor. */
  private magDrops: { kind: 'pistol' | 'rifle'; mesh: THREE.Group; v: THREE.Vector3; spin: THREE.Vector3; life: number; t: number; bounced: number }[] = []
  /** A spent shotgun shell leaves the gun when the pump is worked, a moment after the shot. */
  private pendingEject = 0
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
  private acid!: { points: THREE.Points; list: Particle[] }
  private globs: Glob[] = []
  private globGeo = new THREE.SphereGeometry(0.11, 12, 8)
  private globMat = new THREE.MeshStandardMaterial({ color: 0x5a1a6a, emissive: 0xa8ff3a, emissiveIntensity: 1.8, roughness: 0.2 })
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
  private music = new ScaryMusic()
  private papers: Paper[] = []
  private windT = Math.random() * 100
  /** The draught along the platform (m/s, towards +x), gusting. */
  private windSpeed = 0
  private introZ: Zombie[] = []
  private introStep = -1
  private introLit = false
  private boardT = 0
  private rumbleT = 0
  private lastBoard = ''
  /** The gates: how far open (0 shut … 1 open), the crowd behind them, what the player has been told. */
  private exitOpen = 0
  private crowd: { z: Zombie; exit: number; base: THREE.Vector3; rank: number }[] = []
  private crowdNear: boolean[] = []
  private waveTotal = 1
  private gateHurtT = 0
  private gateTold = false
  private clangT = 0
  private escapeT = 0
  private overSent = false

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
      bloater: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 3.0, 0.4) }),
      spitter: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.6, 2.6) }),
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
    this.guns = buildGuns()
    for (const g of this.guns) this.vm.add(g.model)

    this.sparks = this.particles(0xffc768, 0.05, THREE.AdditiveBlending, 400)
    this.blood = this.particles(0x6a0a06, 0.07, THREE.NormalBlending, 600)
    this.acid = this.particles(0x6aff2a, 0.09, THREE.AdditiveBlending, 400)
    this.dust = this.makeDust()
    this.makePapers()

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
    const casingGeo = new THREE.CylinderGeometry(0.0085, 0.0085, 0.036, 8)
    const shellGeo = new THREE.CylinderGeometry(0.0145, 0.0145, 0.075, 10)
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
    for (const c of this.crowd) this.removeZombie(c.z)
    this.crowd = []
    this.crowdNear = []
    if (this.station) {
      this.world.remove(this.station.group)
      this.station.dispose()
    }
    for (const p of this.pickups) p.mesh.removeFromParent()
    this.pickups = []
    for (const g of this.globs) g.mesh.removeFromParent()
    this.globs = []
    this.holes = []
    this.stationIndex = index
    this.station = buildStation(index)
    this.world.add(this.station.group)
    updateTrainMap(this.train, index)
    const fog = this.scene.fog as THREE.FogExp2
    fog.color.setHex(this.station.style.fog)
    ;(this.scene.background as THREE.Color).setHex(this.station.style.fog)
    this.exitOpen = 0
    this.gateHurtT = 0
    this.gateTold = false
    this.escapeT = 0
    this.renderer.toneMappingExposure = 1.05
    this.fillCrowd()
    this.lastBoard = ''
    this.refreshTargets()
  }

  /** The crowd that presses against the gates at the top of the stairs. */
  private fillCrowd() {
    this.station.exits.forEach((ex, e) => {
      ex.crowd.forEach(([x, zz], rank) => {
        const kind: Kind = rank % 5 === 4 ? 'brute' : rank % 3 === 1 ? 'runner' : 'walker'
        const z = this.makeZombie(kind)
        z.crowd = true
        z.state = 'chase'
        z.root.position.set(x, LANDING.y, zz)
        z.root.rotation.y = Math.PI
        z.phase = Math.random() * 10
        z.next = Math.random() * 2
        z.shadow.visible = false
        ex.crowdGroup.add(z.root)
        this.crowd.push({ z, exit: e, base: z.root.position.clone(), rank })
      })
      this.crowdNear[e] = false
    })
  }

  private refreshTargets() {
    const crowd = this.crowd.filter((c) => this.crowdNear[c.exit] && c.z.root.visible).flatMap((c) => c.z.meshes)
    this.hitTargets = [...this.station.solids, ...this.train.solids, ...this.zombies.filter((z) => z.state !== 'dead').flatMap((z) => z.meshes), ...crowd]
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

  private get gun(): Gun {
    return this.guns[this.slot]
  }

  // ---------------------------------------------------------------- public

  /** Called with a checkpoint each time the train reaches a new station. */
  onCheckpoint: ((s: LTSave) => void) | null = null

  /** Start again from a checkpoint: on the platform of that station, its wave about to begin. */
  continueFrom(s: LTSave) {
    this.reset(false)
    this.setStation(Math.min(s.station, FINAL_STATION))
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

  /** A new game (`intro`: the lights fail and come back on them first; false when continuing from a checkpoint). */
  reset(intro = true) {
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
    this.exitOpen = 0
    this.escapeT = 0
    this.overSent = false
    this.gateHurtT = 0
    this.gateTold = false
    this.renderer.toneMappingExposure = 1.05
    for (const ex of this.station.exits) ex.setOpen(0)
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
    if (intro) this.beginIntro()
    else this.startWave()
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
      slots: this.guns.flatMap((x, i) => (this.hasGun(i) ? [{ slot: i, name: x.def.short }] : [])),
      magSize: g.def.mag,
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
    if (/^Digit[1-9]$/.test(code)) this.switchTo(Number(code.slice(5)) - 1)
    else if (code === 'KeyQ') this.cycleGun(-1)
    else if (code === 'KeyR') this.startReload()
    else if (code === 'Space' && this.onGround && this.stage !== 'escaped') {
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
    this.cycleGun(dy > 0 ? 1 : -1)
  }

  /** One animation frame. `playing` false: the scene is drawn, nothing moves (or the attract camera glides). */
  frame(dt: number, mode: 'attract' | 'playing' | 'still') {
    dt = Math.min(dt, 0.05)
    if (mode === 'playing') this.update(dt)
    else if (mode === 'attract') this.attract(dt)
    if (mode !== 'still') this.updateWind(dt)
    const alive = this.zombies.filter((z) => z.state !== 'dead' && z.state !== 'wait').length
    const tense = this.stage === 'intro' ? 0.5 : mode === 'playing' ? clamp(alive / 9, 0, 1) : 0.15
    this.music.intensity += (tense - this.music.intensity) * Math.min(1, dt * 0.5)
    this.music.windLevel = clamp(this.windSpeed / 6, 0, 1)
    this.music.tick(dt)
    this.composer.render()
  }

  dispose() {
    this.music.dispose()
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
    this.updateGates(dt)
    this.updateEffects(dt)
    this.updatePickups(dt)
    this.updateGlobs(dt)
    this.animateStation(dt)
    this.placeCamera(dt)
    this.updateHudEls(dt)
  }

  private say(message: string, sub = '', secs = 3.5) {
    this.message = message
    this.sub = sub
    this.messageT = secs
  }

  // ---------------------------------------------------------------- the intro: the lights fail

  /** The new game opens in the dark: the tubes stutter, and each time they come on, they are closer. */
  private beginIntro() {
    this.stage = 'intro'
    this.stageT = 0
    this.introStep = -1
    this.introLit = false
    this.introZ = []
    const kinds: Kind[] = ['walker', 'walker', 'runner', 'brute', 'walker']
    for (const kind of kinds) {
      const z = this.makeZombie(kind)
      const scale = 1
      z.maxHp = z.hp = KINDS[kind].hp * scale
      z.speed = KINDS[kind].speed * (0.85 + Math.random() * 0.3)
      z.state = 'wait'
      z.root.visible = false
      this.world.add(z.root)
      this.zombies.push(z)
      this.introZ.push(z)
    }
    setTrainDisplay(this.train, 'NEXT STOP', stationAt(1).name)
  }

  private updateIntro() {
    const t = this.stageT
    const i = INTRO_ON.findIndex(([a, b]) => t >= a && t < b)
    const lit = i >= 0 || t >= INTRO_END
    // the tubes: dark but for the red signals, then a stutter of light
    this.renderer.toneMappingExposure = lit ? (t >= INTRO_END ? 1.05 : 0.75 + Math.random() * 0.3) : 0.03
    if (lit !== this.introLit) {
      this.introLit = lit
      this.music.flicker(lit)
    }
    // each time they come on, they stand a little closer, between you and the far end
    if (i >= 0 && i !== this.introStep) {
      this.introStep = i
      const d = INTRO_ON[i][2]
      const fx = -Math.sin(this.yaw)
      const fz = -Math.cos(this.yaw)
      const sx = fz
      const sz = -fx
      this.introZ.forEach((z, k) => {
        if (z.state !== 'wait') return
        const side = (k - 2) * 1.15 + Math.sin(k * 7.1 + i) * 0.35
        const back = (k % 2) * 1.2
        const x = clamp(this.pos.x + fx * (d + back) + sx * side, PLATFORM.x0 + 0.5, PLATFORM.x1 - 0.5)
        const zz = clamp(this.pos.z + fz * (d + back) + sz * side, PLATFORM.z0 + 0.6, PLATFORM.z1 - 0.6)
        z.root.position.set(x, 0, zz)
        z.root.rotation.y = Math.atan2(this.pos.x - x, this.pos.z - zz)
        z.root.visible = true
      })
      if (i === 2) this.music.stinger(0.45)
      if (i === 5) this.groan(this.introZ[3])
    }
    if (t >= INTRO_END) {
      // the lights hold: they come for you
      this.music.stinger(1)
      this.shake = Math.max(this.shake, 0.05)
      for (const z of this.introZ) if (z.state === 'wait') z.state = 'chase'
      this.introZ = []
      this.startWave()
      this.toSpawn = Math.max(0, this.toSpawn - 5)
      this.refreshTargets()
    }
  }

  // ---------------------------------------------------------------- the wind and the paper

  /** Sheets of newspaper, flyers and tickets lying about the platform. */
  private makePapers() {
    const kinds = [
      { w: 0.42, h: 0.3, lift: 1.0 },
      { w: 0.21, h: 0.3, lift: 1.25 },
      { w: 0.15, h: 0.21, lift: 1.4 },
      { w: 0.07, h: 0.05, lift: 1.7 },
      { w: 0.5, h: 0.36, lift: 0.55 },
    ]
    const mats = [0, 1, 2, 3, 4, 5].map((i) => new THREE.MeshStandardMaterial({ map: this.paperTexture(i), side: THREE.DoubleSide, roughness: 0.9 }))
    for (let i = 0; i < 46; i++) {
      const k = kinds[i % kinds.length]
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(k.w, k.h, 3, 1), mats[i % mats.length])
      // a slight fold down the middle
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute
      for (let v = 0; v < pos.count; v++) pos.setZ(v, Math.abs(pos.getX(v)) * 0.12 * (i % 3 === 0 ? 1 : -0.5))
      mesh.geometry.computeVertexNormals()
      mesh.rotation.order = 'YXZ'
      mesh.position.set(PLATFORM.x0 + Math.random() * (PLATFORM.x1 - PLATFORM.x0), 0.006, 0.8 + Math.random() * 8.4)
      mesh.rotation.set(-Math.PI / 2, Math.random() * 6.3, 0)
      mesh.receiveShadow = true
      this.world.add(mesh)
      this.papers.push({ mesh, v: new THREE.Vector3(), spin: new THREE.Vector3(), air: false, lift: k.lift * (0.8 + Math.random() * 0.4), phase: Math.random() * 10 })
    }
  }

  private paperTexture(i: number): THREE.CanvasTexture {
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 160
    const g = c.getContext('2d')!
    const r = rng(500 + i)
    const bg = ['#e8e3d4', '#d9d2bd', '#f1efe6', '#e0c66a', '#cfd8e4', '#b9a98a'][i]
    g.fillStyle = bg
    g.fillRect(0, 0, 128, 160)
    g.fillStyle = 'rgba(30,30,30,0.85)'
    if (i <= 2) {
      // newspaper: a headline and columns of grey lines
      g.font = 'bold 18px Georgia, serif'
      g.fillText(['EVACUATE', 'NO TRAINS', 'STAY HOME'][i], 8, 24)
      g.fillStyle = 'rgba(40,40,40,0.5)'
      for (let col = 0; col < 3; col++) for (let y = 36; y < 150; y += 5) if (r() > 0.08) g.fillRect(8 + col * 39, y, 32 - r() * 8, 2)
      g.fillStyle = 'rgba(60,60,60,0.35)'
      g.fillRect(48, 40, 36, 30)
    } else if (i === 3) {
      // a ticket
      g.font = 'bold 22px Helvetica, sans-serif'
      g.fillText('SINGLE', 12, 60)
      g.font = '14px Helvetica, sans-serif'
      g.fillText('ZONE 1–2', 12, 90)
      g.fillStyle = '#7a5a10'
      g.fillRect(0, 120, 128, 12)
    } else {
      // a flyer, a cardboard scrap
      g.font = 'bold 16px Helvetica, sans-serif'
      g.fillText(i === 4 ? 'MISSING' : 'FRAGILE', 14, 30)
      g.strokeStyle = 'rgba(30,30,30,0.6)'
      g.strokeRect(24, 44, 80, 70)
    }
    // dirt and a boot print
    for (let k = 0; k < 14; k++) {
      g.fillStyle = `rgba(60,45,30,${r() * 0.18})`
      g.beginPath()
      g.arc(r() * 128, r() * 160, 3 + r() * 14, 0, Math.PI * 2)
      g.fill()
    }
    if (r() < 0.5) {
      g.fillStyle = 'rgba(90,10,8,0.5)'
      g.beginPath()
      g.ellipse(r() * 128, r() * 160, 10, 6, r() * 3, 0, Math.PI * 2)
      g.fill()
    }
    return texture(c)
  }

  /** The draught from the tunnels: gusts lift the paper and send it tumbling down the platform. */
  private updateWind(dt: number) {
    this.windT += dt
    const t = this.windT
    let gust = Math.max(0, Math.sin(t * 0.21) + Math.sin(t * 0.57 + 1.3) * 0.7 + Math.sin(t * 1.7) * 0.2 - 0.35) * 3.2
    // a train in or out of the station pushes the air before it
    if (this.stage === 'trainIn' || this.stage === 'depart' || this.stage === 'arrive') gust += 3
    const target = 0.7 + gust
    this.windSpeed += (target - this.windSpeed) * Math.min(1, dt * 1.2)
    const w = this.windSpeed
    for (const p of this.papers) {
      const m = p.mesh
      p.phase += dt
      // the station's own floor under it (the world moves while the train rides, the papers go with it)
      const floor = (m.position.z > PLATFORM.z0 ? 0 : TRACK_Y) + 0.006
      if (!p.air) {
        // lying flat: a strong enough gust (with a little luck) picks it up
        if (w * p.lift > 2.6 + Math.sin(p.phase * 1.3) * 0.8 && Math.random() < dt * 1.5 * p.lift) {
          p.air = true
          p.v.set(w * 0.4, 1.2 + Math.random() * 1.8 * p.lift, (Math.random() - 0.5) * 1.2)
          p.spin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9)
        } else if (w * p.lift > 1.6) {
          // skittering along the floor
          m.position.x += w * p.lift * 0.08 * dt * (1 + Math.sin(p.phase * 5))
        }
      } else {
        // flying: pulled along by the air, fluttering, slowly falling
        const flutter = Math.sin(p.phase * 7.3) * 1.6
        p.v.x += (w * 0.9 - p.v.x) * dt * 1.4 * p.lift
        p.v.z += (Math.sin(p.phase * 1.9) * 0.8 - p.v.z) * dt * 0.9
        p.v.y += (-1.1 + flutter * 0.5 + (w > 3 ? (w - 3) * 0.35 : 0)) * dt
        p.v.y = clamp(p.v.y, -1.6, 2.5)
        m.position.addScaledVector(p.v, dt)
        m.rotation.x += p.spin.x * dt
        m.rotation.y += p.spin.y * dt
        m.rotation.z += p.spin.z * dt
        p.spin.multiplyScalar(1 - dt * 0.3)
        if (m.position.y > 3.6) p.v.y = -Math.abs(p.v.y)
        if (m.position.y <= floor && p.v.y < 0) {
          // landed: flat on the floor
          p.air = false
          m.position.y = floor
          m.rotation.set(-Math.PI / 2, m.rotation.y, 0)
          p.v.set(0, 0, 0)
        }
      }
      // keep it in the station: the platform, a little over the track
      m.position.z = clamp(m.position.z, -2.4, 9.5)
      if (m.position.x > PLATFORM.x1) m.position.x = PLATFORM.x0 + Math.random() * 3
      if (m.position.x < PLATFORM.x0) m.position.x = PLATFORM.x1
    }
  }

  private startWave() {
    this.renderer.toneMappingExposure = 1.05
    this.stage = 'fight'
    this.stageT = 0
    const w = this.wave
    this.toSpawn = 5 + w * 4
    this.waveTotal = this.toSpawn
    this.maxAlive = Math.min(16, 4 + w * 2)
    this.spawnT = 2.5
    this.station.signals.red.emissiveIntensity = 4
    this.station.signals.green.emissiveIntensity = 0
    this.say(`Wave ${w}`, this.station.final ? 'The last station — hold it, then climb out' : stationAt(this.stationIndex).name, 3)
    setTrainDisplay(this.train, 'NEXT STOP', this.station.final ? 'TERMINUS' : stationAt(this.stationIndex + 1).name)
  }

  private updateStage(dt: number) {
    const train = this.train.group
    switch (this.stage) {
      case 'intro':
        this.updateIntro()
        break
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
          this.stageT = 0
          this.station.signals.red.emissiveIntensity = 0
          this.station.signals.green.emissiveIntensity = 4
          if (this.station.final) {
            // the last station: nothing is left on the street, the gate unlocks
            this.stage = 'exit'
            this.say('Wave cleared', `+${bonus} — the gate is open: climb the stairs`, 6)
            this.chime()
          } else {
            this.stage = 'cleared'
            this.say('Wave cleared', `+${bonus} — the train is coming`, 4)
          }
        }
        break
      }
      case 'exit': {
        // the gate slides open, daylight comes down the stairs; walk out through it
        const ex = this.nearestExit()
        if (this.pos.z > LANDING.gateZ + 0.9 && Math.abs(this.pos.x - ex.x) < 2) {
          this.stage = 'escaped'
          this.stageT = 0
          this.escapeT = 0
          this.score += 2000 + Math.ceil(this.health) * 10
          this.say('You made it out', 'Daylight at last', 5)
          this.chime()
        }
        break
      }
      case 'escaped':
        this.escapeT += dt
        this.renderer.toneMappingExposure = 1.05 + ease.in(clamp(this.escapeT / 2.2, 0, 1)) * 7
        if (this.escapeT > 2.4 && !this.overSent) {
          this.overSent = true
          this.onOver({ score: this.score, wave: this.wave, kills: this.kills, won: true })
        }
        break
      case 'cleared':
        if (this.stageT > 3) {
          this.stage = 'trainIn'
          this.stageT = 0
          train.visible = true
          train.position.x = -TRAVEL
          this.setDoors(0)
          setTrainDisplay(this.train, 'NEXT STOP', stationAt(this.stationIndex + 1).name)
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
          const found = this.guns.findIndex((g) => g.def.from === this.stationIndex)
          if (found >= 0) this.say(`Found: ${this.guns[found].def.name}`, `${stationAt(this.stationIndex).name} — press ${found + 1}`, 5)
          else this.say('Next station', stationAt(this.stationIndex).name, 4)
          setTrainDisplay(this.train, 'NOW ARRIVING', stationAt(this.stationIndex).name)
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
          setTrainDisplay(this.train, stationAt(this.stationIndex).name.toUpperCase(), 'ALIGHT HERE')
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
    this.train.lamp.emissiveIntensity = open > 0.02 ? 3.2 + Math.sin(performance.now() * 0.012) * 0.8 : 0
  }

  /** Inside the train: any of the three cars, or the gangways between them. */
  private inCar(): boolean {
    return this.pos.x > CAR_XS[0] - CAR_L / 2 && this.pos.x < CAR_XS[2] + CAR_L / 2 && this.pos.z < -0.5 && this.pos.z > CAR_Z - CAR_W / 2
  }

  /** The stairway whose foot is nearest to the player. */
  private nearestExit(): ExitBuild {
    return this.station.exits.reduce((a, b) => (Math.abs(a.x - this.pos.x) <= Math.abs(b.x - this.pos.x) ? a : b))
  }

  /** The floor under (x, z): the platform, the steps of a stairway, its landing. */
  private groundAt(x: number, z: number): number {
    if (z > STAIR.z0 && STAIRS.some((sx) => Math.abs(x - sx) < 2)) return stairY(z)
    const h = hallAt(x, z)
    if (h) return hallY(h.u)
    return 0
  }

  // ---------------------------------------------------------------- the player

  /** Where the player may stand right now: axis-aligned rectangles. */
  private walkable(): Rect[] {
    const plat: Rect = [PLATFORM.x0, PLATFORM.x1, PLATFORM.z0, PLATFORM.z1]
    // the stairways: up the steps, over the landing, as far as the gate (or out of it, once it is open)
    const top = this.exitOpen > 0.9 ? LANDING.endZ - 0.7 : LANDING.gateZ - 0.55
    const stairs = STAIRS.map((sx) => [sx - STAIR.halfW + 0.1, sx + STAIR.halfW - 0.1, 9.0, top] as Rect)
    // through the staff door, up the flight, into the ticket hall
    for (const sx of STAIRS) stairs.push(...hallRects(sx, 0.3))
    // the train: the aisle of each car, the door zones between the seats, the gangways
    const train = (doors: boolean): Rect[] => {
      const out: Rect[] = []
      for (const cx of CAR_XS) {
        out.push([cx - 9.5, cx + 9.5, CAR_Z - 0.75, CAR_Z + 0.75])
        for (const d of DOORS) out.push([cx + d - 0.6, cx + d + 0.6, CAR_Z - 1.1, doors ? 0.5 : CAR_Z + 1.1])
      }
      for (const gx of [-CAR_PITCH / 2, CAR_PITCH / 2]) out.push([gx - 1.0, gx + 1.0, CAR_Z - 0.55, CAR_Z + 0.55])
      return out
    }
    const docked = this.train.group.visible && Math.abs(this.train.group.position.x) < 0.01 && Math.abs(this.world.position.x) < 0.01
    if (this.stage === 'depart' || this.stage === 'arrive') return train(false)
    if (docked && this.doorOpen > 0.85) return [plat, ...stairs, ...train(true)]
    if (docked && this.inCar()) return train(false)
    return [plat, ...stairs]
  }

  private free(x: number, z: number, rects: Rect[]): boolean {
    return rects.some(([x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)
  }

  /** The nearest point that is walkable. */
  private nearestFree(x: number, z: number, rects: Rect[]): [number, number] {
    let best: [number, number] = [x, z]
    let bd = Infinity
    for (const [x0, x1, z0, z1] of rects) {
      const cx = clamp(x, x0, x1)
      const cz = clamp(z, z0, z1)
      const d = (cx - x) ** 2 + (cz - z) ** 2
      if (d < bd) {
        bd = d
        best = [cx, cz]
      }
    }
    return best
  }

  /** Push a point (radius r) out of the furniture and clutter standing on the platform. */
  private pushBlocks(p: { x: number; z: number }, r: number) {
    for (const b of this.station.blocks) {
      const nx = clamp(p.x, b.x0, b.x1)
      const nz = clamp(p.z, b.z0, b.z1)
      const dx = p.x - nx
      const dz = p.z - nz
      const d = Math.hypot(dx, dz)
      if (d >= r) continue
      if (d > 1e-4) {
        p.x = nx + (dx / d) * r
        p.z = nz + (dz / d) * r
      } else {
        const l = p.x - b.x0
        const rr = b.x1 - p.x
        const t = p.z - b.z0
        const bt = b.z1 - p.z
        const m = Math.min(l, rr, t, bt)
        if (m === l) p.x = b.x0 - r
        else if (m === rr) p.x = b.x1 + r
        else if (m === t) p.z = b.z0 - r
        else p.z = b.z1 + r
      }
    }
  }

  private updatePlayer(dt: number) {
    if (this.stage === 'dying') return
    const k = this.keys
    // WASD moves; the arrows turn and look up and down (like the mouse, at a steady speed)
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0)
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0)
    const turn = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)
    const tilt = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0)
    if (turn || tilt) this.look(turn * 1100 * dt, tilt * 650 * dt)
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
    // columns and furniture
    for (const p of this.station.pillars) {
      const dx = this.pos.x - p.x
      const dz = this.pos.z - p.z
      const d = Math.hypot(dx, dz)
      const min = p.r + 0.3
      if (d < min && d > 1e-4) {
        this.pos.x = p.x + (dx / d) * min
        this.pos.z = p.z + (dz / d) * min
      }
    }
    this.pushBlocks(this.pos, 0.3)
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
      const [nx3, nz3] = this.nearestFree(this.pos.x, this.pos.z, rects)
      this.pos.x = nx3
      this.pos.z = nz3
    }

    // the floor under the feet (steps, landing), jumping and gravity
    const gy = this.groundAt(this.pos.x, this.pos.z)
    if (this.onGround) {
      // walking: ride the steps up and down
      this.vel.y = 0
      this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 18)
      if (Math.abs(gy - this.pos.y) < 0.003) this.pos.y = gy
      if (this.pos.y - gy > 0.7) this.onGround = false
    } else {
      this.vel.y -= GRAVITY * dt
      this.pos.y += this.vel.y * dt
      if (this.pos.y <= gy && this.vel.y <= 0) {
        if (this.vel.y < -4) this.step(0.6)
        this.pos.y = gy
        this.vel.y = 0
        this.onGround = true
      }
    }
    // the low roof of a car: no jumping through it
    if (this.inCar() && this.pos.y > 0.5) {
      this.pos.y = 0.5
      this.vel.y = Math.min(0, this.vel.y)
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
    const fov = 72 - this.aim * (this.gun.def.zoom)
    if (Math.abs(c.fov - fov) > 0.01) {
      c.fov = fov
      c.updateProjectionMatrix()
    }
  }

  hurt(dmg: number) {
    if (this.stage === 'dying' || this.stage === 'escaped') return
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

  /** A gun is in hand once the train has reached the station where it is found. */
  private hasGun(i: number): boolean {
    return i >= 0 && i < this.guns.length && this.guns[i].def.from <= this.stationIndex
  }

  /** The next (or previous) gun found so far. */
  private cycleGun(step: number) {
    const n = this.guns.length
    const from = this.nextSlot >= 0 ? this.nextSlot : this.slot
    for (let k = 1; k < n; k++) {
      const i = (((from + step * k) % n) + n) % n
      if (this.hasGun(i)) return this.switchTo(i)
    }
  }

  private switchTo(i: number) {
    if (i === this.slot && this.nextSlot < 0) return
    if (!this.hasGun(i)) return
    this.nextSlot = i
    this.switchT = 0.36
    this.reloadT = 0
    this.pendingEject = 0
    sfx('switch', () => noise({ dur: 0.08, freq: 3000, filter: 'highpass', vol: 0.06 }))
  }

  private startReload() {
    const g = this.gun
    if (this.reloadT > 0 || this.switchT > 0 || g.mag >= g.def.mag || g.reserve === 0) return
    const shotgun = g.def.base === 'shotgun'
    this.rs = { clock: 0, prev: 0, empty: g.mag <= 0, phase: shotgun ? 'load' : 'mag', first: true }
    this.reloadT = shotgun ? SHELL_LEAD + SHELL_T : magReloadTime(g, this.rs.empty)
    if (shotgun) sfx('lift', () => noise({ dur: 0.05, freq: 900, filter: 'lowpass', vol: 0.06 }), 0.05)
  }

  private finishReload() {
    const g = this.gun
    if (g.def.base === 'shotgun') {
      if (this.rs.phase === 'pump') return // the pump is worked: ready
      // one shell at a time; keep going while the tube is not full, then pump
      g.mag++
      if (g.reserve > 0) g.reserve--
      const more = g.mag < g.def.mag && g.reserve !== 0 && !this.firing
      this.rs = { clock: 0, prev: 0, empty: false, phase: more ? 'load' : 'pump', first: false }
      this.reloadT = more ? SHELL_T : PUMP_T
      return
    }
    const need = g.def.mag - g.mag
    const got = g.reserve < 0 ? need : Math.min(need, g.reserve)
    g.mag += got
    if (g.reserve >= 0) g.reserve -= got
  }

  /** The animation reaches a moment worth a sound (or a magazine falling). */
  private reloadEvent(e: ReloadEvent) {
    switch (e) {
      case 'release':
        sfx('rel', () => {
          noise({ dur: 0.025, freq: 3600, filter: 'bandpass', q: 4, vol: 0.13 })
          noise({ dur: 0.18, freq: 1100, to: 500, filter: 'lowpass', vol: 0.05, at: 0.03 })
        })
        break
      case 'drop':
        this.dropMag()
        break
      case 'grab':
        sfx('grab', () => noise({ dur: 0.12, freq: 1300, to: 600, filter: 'bandpass', q: 0.8, vol: 0.06 }))
        break
      case 'insert':
        sfx('ins', () => {
          noise({ dur: 0.03, freq: 2000, filter: 'bandpass', q: 3, vol: 0.16 })
          tone({ freq: 160, to: 90, dur: 0.06, type: 'triangle', vol: 0.1 })
          noise({ dur: 0.025, freq: 3000, filter: 'bandpass', q: 4, vol: 0.12, at: 0.05 })
        })
        break
      case 'rack':
        sfx('rack', () => {
          noise({ dur: 0.04, freq: 1500, filter: 'bandpass', q: 2, vol: 0.18 })
          noise({ dur: 0.03, freq: 2600, filter: 'bandpass', q: 3, vol: 0.12, at: 0.03 })
          tone({ freq: 200, to: 110, dur: 0.05, type: 'square', vol: 0.04 })
        })
        break
      case 'pull':
        sfx('pull', () => noise({ dur: 0.1, freq: 1200, to: 2200, filter: 'bandpass', q: 2, vol: 0.12 }))
        break
      case 'shell':
        sfx('shell', () => {
          noise({ dur: 0.03, freq: 1600, filter: 'bandpass', q: 2.5, vol: 0.15 })
          tone({ freq: 760, to: 520, dur: 0.05, type: 'triangle', vol: 0.05 })
        })
        break
      case 'pumpBack':
        sfx('pumpb', () => noise({ dur: 0.07, freq: 1100, to: 1800, filter: 'bandpass', q: 1.5, vol: 0.15 }))
        break
      case 'pumpFwd':
        sfx('pumpf', () => {
          noise({ dur: 0.05, freq: 1700, filter: 'bandpass', q: 2, vol: 0.18 })
          tone({ freq: 180, to: 100, dur: 0.05, type: 'square', vol: 0.035, at: 0.02 })
        })
        break
    }
  }

  /** The old magazine leaves the gun: a real one, tumbling to the floor with its rounds showing. */
  private dropMag() {
    const g = this.gun
    if (!g.magMesh || g.def.base === 'shotgun') return
    const kind = g.def.base as 'pistol' | 'rifle'
    const wp = g.magMesh.getWorldPosition(new THREE.Vector3())
    const wq = g.magMesh.getWorldQuaternion(new THREE.Quaternion())
    let d = this.magDrops.find((x) => x.life <= 0 && x.kind === kind)
    if (!d) {
      const mesh = makeMag(kind)
      mesh.traverse((o) => (o.frustumCulled = false))
      this.scene.add(mesh)
      d = { kind, mesh, v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, t: 0, bounced: 0 }
      this.magDrops.push(d)
    }
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    d.mesh.visible = true
    d.mesh.position.copy(wp)
    d.mesh.quaternion.copy(wq)
    d.mesh.scale.setScalar(this.vm.scale.x)
    d.v.set(0, -1.1, 0).addScaledVector(right, -0.3 + Math.random() * 0.5).addScaledVector(fwd, 0.2 + Math.random() * 0.4)
    d.v.x += this.vel.x
    d.v.z += this.vel.z
    d.spin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9)
    d.life = 6
    d.t = 0
    d.bounced = 0
    g.magMesh.visible = false
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
      if (g.def.base === 'shotgun' && this.reloadT > 0 && g.mag > 0) this.reloadT = 0 // interrupt the shell-by-shell reload
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
    if (this.pendingEject > 0) {
      this.pendingEject -= dt
      if (this.pendingEject <= 0 && this.gun.def.base === 'shotgun') this.eject('shotgun')
    }
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
    this.flashSprite.scale.setScalar(d.base === 'shotgun' ? 0.32 : d.base === 'rifle' ? 0.24 : 0.17)
    g.muzzle.add(this.flashSprite)
    this.gunSound(d.base)

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
        const falloff = d.base === 'shotgun' ? clamp(1.3 - hit.distance / 18, 0.25, 1) : 1
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
    if (d.base === 'shotgun') this.pendingEject = 0.34 // the shell comes out as the pump goes back
    else this.eject(d.base)
  }

  private currentSpread(): number {
    const d = this.gun.def
    const move = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / WALK)
    const air = this.onGround ? 0 : 0.03
    return (d.spread + this.bloomSpread + move * 0.02 + air) * (1 - this.aim * (d.base === 'shotgun' ? 0.3 : 0.75))
  }

  private gunSound(id: Gun['def']['base']) {
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

  private eject(id: Gun['def']['base']) {
    const g = this.gun
    const shell = id === 'shotgun'
    // shotgun shells are the red ones (every third casing mesh)
    const pick = this.casings.find((x, i) => x.life <= 0 && (i % 3 === 2) === shell) ?? this.casings[shell ? 2 : 0]
    const m = g.model.matrixWorld
    const right = new THREE.Vector3(1, 0, 0).transformDirection(m)
    const up = new THREE.Vector3(0, 1, 0).transformDirection(m)
    const back = new THREE.Vector3(0, 0, 1).transformDirection(m)
    g.port.getWorldPosition(pick.mesh.position)
    pick.v.copy(right).multiplyScalar(1.5 + Math.random() * 0.9).addScaledVector(up, 1.1 + Math.random() * 0.8).addScaledVector(back, 0.3 + Math.random() * 0.5)
    pick.v.x += this.vel.x
    pick.v.z += this.vel.z
    pick.spin.set(Math.random() * 24, Math.random() * 24, Math.random() * 24)
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
    const ads = new THREE.Vector3(0, g.def.base === 'rifle' ? -0.075 : g.def.base === 'pistol' ? -0.022 : -0.022, g.def.base === 'pistol' ? -0.3 : -0.26)
    const p = hip.lerp(ads, aim)
    const breathe = Math.sin(t * 1.6) * 0.003 * (1 - aim)
    p.x += Math.cos(this.bob) * 0.012 * bobAmt * (1 - aim * 0.85) - this.vmSway.x
    p.y += -Math.abs(Math.sin(this.bob)) * 0.012 * bobAmt * (1 - aim * 0.85) + breathe + this.vmSway.y
    // recoil
    const kick = ease.out(this.kickT)
    const kz = g.def.base === 'shotgun' ? 0.09 : g.def.base === 'rifle' ? 0.035 : 0.05
    p.z += kick * kz * (1 - aim * 0.5)
    let rx = kick * (g.def.base === 'shotgun' ? 0.3 : 0.12)
    let ry = 0
    let rz = 0
    // the left arm, the magazine, the slide: a reload, or the gun at rest
    const g2 = g.def
    if (this.reloadT > 0) {
      this.rs.prev = this.rs.clock
      this.rs.clock += dt
      poseReload(g, this.rs, this.pose, (e) => this.reloadEvent(e))
    } else {
      restGun(g, this.pose, kick, g2.base === 'shotgun' && this.cooldown > 0 ? 1 - this.cooldown / (60 / g2.rpm) : 0)
    }
    p.x += this.pose.x
    p.y += this.pose.y
    p.z += this.pose.z
    rx += this.pose.rx
    ry += this.pose.ry
    rz += this.pose.rz
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
    const roll2 = Math.random()
    const kind: Kind =
      w >= 2 && roll2 < Math.min(0.16, 0.05 * (w - 1)) ? 'bloater'
      : w >= 2 && roll2 > 1 - Math.min(0.16, 0.05 * (w - 1)) ? 'spitter'
      : w >= 3 && roll < Math.min(0.22, 0.06 * (w - 2)) ? 'brute' : w >= 2 && roll > 1 - Math.min(0.45, 0.12 * w) ? 'runner' : 'walker'
    const z = this.makeZombie(kind)
    const scale = 1 + (w - 1) * 0.12
    z.maxHp = z.hp = KINDS[kind].hp * scale
    z.speed = KINDS[kind].speed * (1 + (w - 1) * 0.04) * (0.85 + Math.random() * 0.3)
    // nothing comes out of the tunnels while a train is still in the station
    const where = this.leaving >= 0 || this.train.group.visible ? 0 : Math.random()
    if (where < 0.22) {
      // in through the shutter at the far end of a ticket hall, through its gates, down to the platform
      const ex = this.station.exits[Math.floor(Math.random() * this.station.exits.length)]
      z.state = 'chase'
      z.root.position.copy(ex.hallSpawn)
      z.root.position.z += (Math.random() - 0.5) * 2.4
    } else if (where < 0.42) {
      // out of the staff door on a landing and down the stairs: the stairway farther from the player first
      const exits = this.station.exits
      const far = exits.filter((e) => Math.hypot(this.pos.x - e.spawn.x, this.pos.z - e.spawn.z) > 7)
      const pool = far.length ? far : exits
      const ex = pool.reduce((a, b) => (Math.abs(a.x - this.pos.x) >= Math.abs(b.x - this.pos.x) ? a : b))
      const pick = Math.random() < 0.7 ? ex : pool[Math.floor(Math.random() * pool.length)]
      z.state = 'stairs'
      z.stairX = pick.x + (Math.random() - 0.5) * 2.2
      z.root.position.copy(pick.spawn)
      z.root.position.x += (Math.random() - 0.5) * 0.3
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
    this.dress(kind, body, meshes, mats, 1.75)
    for (const m of meshes) m.userData.zombie = z
    Object.assign(z, {
      kind, root, hips, spine, head: neck, arms, fores, thighs, shins, mats, eyes, meshes, shadow,
      hp: 100, maxHp: 100, speed: 1, state: 'chase', t: 0, phase: r() * 10, attack: 0, hitT: 0, flash: 0,
      deadT: 0, fall: r() < 0.5 ? -1 : 1, groan: 1 + r() * 4, goalX: 0, stairX: 0, points: KINDS[kind].points, crowd: false, next: 0, spit: 2 + Math.random() * 2,
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
      deadT: 0, fall: 1, groan: 1 + Math.random() * 4, goalX: 0, stairX: 0, points: KINDS[kind].points, crowd: false, next: 0, spit: 2 + Math.random() * 2,
    } as unknown as Zombie
    const extra: THREE.Mesh[] = []
    this.dress(kind, model.root, extra, model.mats, model.height)
    model.meshes.push(...extra)
    for (const m of model.meshes) m.userData.zombie = z
    return z
  }

  /** The look of the special kinds: a bloater swollen and green with a glowing sac, a spitter thin and pale with an acid throat. */
  private dress(kind: Kind, body: THREE.Object3D, meshes: THREE.Mesh[], mats: THREE.MeshStandardMaterial[], height: number) {
    if (kind !== 'bloater' && kind !== 'spitter') return
    const bloat = kind === 'bloater'
    body.scale.x *= bloat ? 1.5 : 0.82
    body.scale.z *= bloat ? 1.45 : 0.82
    if (!bloat) body.scale.y *= 1.08
    const tint = bloat ? new THREE.Color(0.7, 1.12, 0.5) : new THREE.Color(1.05, 0.88, 1.15)
    for (const m of mats) if (!m.userData.glow) m.color.multiply(tint)
    const glow = new THREE.MeshStandardMaterial({
      color: bloat ? 0x6f8a1a : 0x7a2a8a, emissive: bloat ? 0x8aff2a : 0xd03aff, emissiveIntensity: bloat ? 1.2 : 1.6, roughness: 0.3, transparent: true, opacity: 0.9,
    })
    glow.userData.glow = true
    mats.push(glow)
    const h = height * KINDS[kind].scale
    const sac = new THREE.Mesh(this.zGeo.head, glow)
    if (bloat) {
      // a swollen belly and growths on the back
      sac.scale.set(2.4, 2.2, 2.0)
      sac.position.set(0, h * 0.52, 0.2)
      const lump = new THREE.Mesh(this.zGeo.head, glow)
      lump.scale.set(1.3, 1.2, 1.1)
      lump.position.set(0.15, h * 0.7, -0.2)
      lump.userData.part = 'body'
      body.parent ? body.parent.add(lump) : body.add(lump)
      meshes.push(lump)
    } else {
      sac.scale.set(0.7, 0.9, 0.7)
      sac.position.set(0, h * 0.84, 0.1)
    }
    sac.userData.part = 'body'
    ;(body.parent ?? body).add(sac)
    meshes.push(sac)
  }

  private removeZombie(z: Zombie) {
    z.root.removeFromParent()
    for (const m of z.mats) m.dispose()
    z.shadow.geometry.dispose()
  }

  private damage(z: Zombie, dmg: number, head: boolean, dir: THREE.Vector3, at: THREE.Vector3) {
    if (z.state === 'dead') return
    if (z.crowd) {
      // the crowd behind a gate shrugs it off: more of them keep coming
      z.flash = 1
      z.hitT = 0.25
      this.emit(this.blood, at, dir.clone().multiplyScalar(-0.3).add(new THREE.Vector3(0, 0.4, 0)), 6, 2.0, 0.6)
      return
    }
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
      if (z.kind === 'bloater') this.burst(z)
      if (Math.random() < (z.kind === 'brute' ? 0.9 : 0.28)) this.drop(z.root.position, Math.random() < 0.45 ? 'health' : 'ammo')
    }
  }

  /** A bloater bursts: acid all round, and everything near it (the player, other zombies) is hurt. */
  private burst(z: Zombie) {
    const at = z.root.position.clone()
    at.y += 1.0
    z.root.visible = false
    z.deadT = 7.4
    const wat = at.clone().add(this.world.position)
    this.emit(this.acid, wat, new THREE.Vector3(0, 1, 0), 90, 4.5, 1.2)
    this.emit(this.blood, wat, new THREE.Vector3(0, 0.6, 0), 40, 3.5, 1.0)
    const d = Math.hypot(this.pos.x - wat.x, this.pos.y + 1 - wat.y, this.pos.z - wat.z)
    if (d < BURST.r && this.stage !== 'dying' && this.stage !== 'escaped') this.hurt(5 + BURST.dmg * (1 - d / BURST.r))
    this.shake = Math.max(this.shake, clamp(0.09 - d * 0.006, 0.02, 0.09))
    sfx('burst', () => {
      noise({ dur: 0.5, freq: 380, to: 90, filter: 'lowpass', vol: 0.35 * clamp(1 - d / 30, 0.15, 1) })
      tone({ freq: 90, to: 40, dur: 0.4, type: 'sine', vol: 0.18 * clamp(1 - d / 30, 0.1, 1) })
    }, 0.05)
    for (const o of this.zombies) {
      if (o === z || o.state === 'dead') continue
      const od = o.root.position.distanceTo(z.root.position)
      if (od > BURST.r) continue
      const dir = o.root.position.clone().sub(z.root.position).setY(0).normalize()
      this.damage(o, 40 + 260 * (1 - od / BURST.r), false, dir, o.root.position.clone().add(new THREE.Vector3(0, 1.1, 0)).add(this.world.position))
    }
  }

  /** A spitter's glob of acid, lobbed at the player's chest. */
  private spitGlob(z: Zombie) {
    const from = z.root.position.clone()
    from.y += (z.model ? z.model.height : 1.75) * KINDS.spitter.scale * 0.85
    const to = new THREE.Vector3(this.pos.x - this.world.position.x, this.pos.y + 1.1, this.pos.z)
    // lead a little where the player is going
    to.addScaledVector(new THREE.Vector3(this.vel.x, 0, this.vel.z), 0.35)
    const T = clamp(from.distanceTo(to) / 11, 0.45, 1.3)
    const v = to.sub(from).divideScalar(T)
    v.y += 0.5 * 9.8 * T
    const mesh = new THREE.Mesh(this.globGeo, this.globMat)
    mesh.position.copy(from)
    this.world.add(mesh)
    this.globs.push({ mesh, v, life: 0 })
    z.t = 0
    z.attack = 0.6
    sfx('spit', () => noise({ dur: 0.22, freq: 900, to: 300, filter: 'bandpass', q: 2, vol: 0.12 }), 0.1)
  }

  private updateGlobs(dt: number) {
    for (const g of this.globs) {
      g.life += dt
      g.v.y -= 9.8 * dt
      g.mesh.position.addScaledVector(g.v, dt)
      g.mesh.scale.setScalar(1 + Math.sin(g.life * 30) * 0.12)
      const p = g.mesh.position
      const wp = p.clone().add(this.world.position)
      const hitPlayer = Math.hypot(this.pos.x - wp.x, this.pos.y + 1.1 - wp.y, this.pos.z - wp.z) < 0.75
      if (hitPlayer && this.stage !== 'dying' && this.stage !== 'escaped') {
        this.hurt(12 + this.wave * 0.8)
        this.say('Acid!', '', 0.8)
      }
      if (hitPlayer || p.y < this.groundAt(p.x, p.z) || g.life > 3) {
        this.emit(this.acid, wp, new THREE.Vector3(0, 1, 0), 18, 1.6, 0.6)
        g.mesh.removeFromParent()
        g.life = -1
      }
    }
    this.globs = this.globs.filter((g) => g.life >= 0)
  }

  private groan(z: Zombie) {
    const d = z.root.position.clone().add(this.world.position).distanceTo(this.pos)
    const vol = clamp(1 - d / 28, 0, 1)
    if (vol <= 0.02) return
    const base = z.kind === 'brute' ? 70 : z.kind === 'bloater' ? 55 : z.kind === 'spitter' ? 190 : z.kind === 'runner' ? 150 : 100
    sfx('groan', () => {
      tone({ freq: base * (0.9 + Math.random() * 0.3), to: base * 0.7, dur: 0.7 + Math.random() * 0.6, type: 'sawtooth', vol: 0.05 * vol })
      noise({ dur: 0.6, freq: 500, filter: 'bandpass', q: 3, vol: 0.04 * vol })
    }, 0.4)
  }

  /**
   * Where a zombie at p heads to reach the player: straight at them when they share a space,
   * else the next doorway on the way (platform ⇄ stairs ⇄ staff door ⇄ flight ⇄ hall ⇄ the wide ticket gate).
   */
  private route(p: THREE.Vector3): [number, number] {
    const H = HALL
    const lane = H.laneZ
    // cells: 0 platform and stairs, 1 the flight, 2 the hall this side of the gates, 3 beyond them
    const cell = (x: number, z: number): [number, number] => {
      const h = hallAt(x, z)
      if (!h || h.u < 0.05) return [0, STAIRS.reduce((a, b) => (Math.abs(a - x) < Math.abs(b - x) ? a : b))]
      return [h.u < H.flightU1 ? 1 : h.u < H.gatesU ? 2 : 3, h.sx]
    }
    const X = (sx: number, u: number) => sx - 2 - u
    const [zc, zsx] = cell(p.x, p.z)
    const [pc, psx] = cell(this.pos.x, this.pos.z)
    if (zc === pc && (zc === 0 || zsx === psx)) return [this.pos.x, this.pos.z]
    // the cell to go to next, and through which hall
    const sx = zc === 0 ? psx : zsx
    const want = zc !== 0 && (pc === 0 || psx !== zsx) ? zc - 1 : zc + 1
    const lz = (z: number) => clamp(z, lane - 0.4, lane + 0.4)
    if (zc === 0) {
      // up the stairs to the staff door
      if (Math.abs(p.x - sx) > STAIR.halfW - 0.2 || p.z < STAIR.z0 + 0.3) return [sx, STAIR.z0 + 1]
      if (p.z < LANDING.z0 - 0.2) return [sx - 0.8, LANDING.z0 + 0.4]
      // line up with the doorway, then go through it
      const lined = Math.abs(p.z - lane) < 0.36 && p.x < X(sx, -0.9)
      return lined || p.x < X(sx, -0.3) ? [X(sx, 1.2), lane] : [X(sx, -0.6), lane]
    }
    const u = sx - 2 - p.x
    // the portal between this cell and the wanted one, and a point just past it
    const portal = Math.max(zc, want) === 1 ? 0 : Math.max(zc, want) === 2 ? H.flightU1 : H.gatesU
    const dir = want > zc ? 1 : -1
    const before = portal - dir * (portal === H.gatesU ? 1.0 : 0.6)
    if (Math.abs(u - before) < 0.5 || (dir > 0 ? u > before : u < before)) return [X(sx, portal + dir * 1.2), lz(p.z)]
    return [X(sx, before), lane]
  }

  /** Keep a zombie (radius r) on the floor it walks: the platform, the stairs, a hall. */
  private navClamp(p: THREE.Vector3) {
    const h = hallAt(p.x, p.z)
    if (h && h.u > 0.05) {
      const rects = hallRects(h.sx, 0.35)
      const [nx, nz] = this.free(p.x, p.z, rects) ? [p.x, p.z] : this.nearestFree(p.x, p.z, rects)
      p.x = nx
      p.z = nz
      return true
    }
    return false
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
      if (z.state === 'wait') {
        // staring, swaying a little
        let dy = Math.atan2(dx, dz) - z.root.rotation.y
        dy = Math.atan2(Math.sin(dy), Math.cos(dy))
        z.root.rotation.y += dy * Math.min(1, dt * 6)
        this.animateZombie(z, dt, 0, dist)
        continue
      }
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
        const sx = STAIRS.reduce((a, b) => (Math.abs(a - p.x) < Math.abs(b - p.x) ? a : b))
        move.set((z.stairX - p.x) * 0.5, 0, -1)
        face = Math.PI
        p.x = clamp(p.x, sx - 1.55, sx + 1.55)
        p.y = stairSlope(p.z)
        if (p.z <= 9.7) {
          z.state = 'chase'
          p.y = 0
        }
      } else {
        // chase (through the halls if need be), keeping apart from the others and out of the pillars
        const [tx0, tz0] = this.route(p)
        move.set(tx0 - p.x, 0, tz0 - p.z).normalize()
        if (Math.hypot(tx0 - this.pos.x, tz0 - this.pos.z) > 0.01) face = Math.atan2(move.x, move.z)
        for (const o of this.zombies) {
          if (o === z || o.state === 'dead') continue
          const ox = p.x - o.root.position.x
          const oz = p.z - o.root.position.z
          const d = Math.hypot(ox, oz)
          if (d < 0.9 && d > 1e-3) move.add(new THREE.Vector3(ox / d, 0, oz / d).multiplyScalar((0.9 - d) * 2))
        }
        for (const pl of this.station.pillars) {
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
        const sameSpace = Math.hypot(tx0 - player.x, tz0 - player.z) < 0.01 && Math.abs(p.y - player.y) < 2.5
        if (z.kind === 'bloater' && sameSpace && dist < 1.5 && this.stage !== 'dying' && this.stage !== 'escaped') {
          // it reaches you and bursts
          z.points = 0
          this.damage(z, 1e6, false, new THREE.Vector3(0, 0, 1), p.clone())
          continue
        }
        if (z.kind === 'spitter' && sameSpace && dist < 13) {
          // hang back and spit
          if (dist < 6) move.multiplyScalar(-0.6)
          else if (dist < 9) speed = 0
          face = Math.atan2(dx, dz)
          z.spit -= dt
          if (z.spit <= 0 && dist > 3 && this.stage !== 'dying' && this.stage !== 'escaped') {
            z.spit = 2.2 + Math.random() * 1.6
            this.spitGlob(z)
          }
        }
        // attack
        z.attack -= dt
        if (dist < 1.25 * KINDS[z.kind].scale && Math.abs(p.y - player.y) < 1.4 && z.attack <= 0 && this.stage !== 'dying' && this.stage !== 'escaped') {
          z.attack = z.kind === 'runner' ? 0.75 : 1.15
          z.t = 0
          window.setTimeout(() => {
            if (z.state === 'dead') return
            const d2 = Math.hypot(this.pos.x - z.root.position.x, this.pos.z - z.root.position.z)
            if (d2 < 1.5 * KINDS[z.kind].scale && Math.abs(this.pos.y - z.root.position.y) < 1.4) this.hurt(KINDS[z.kind].dmg * (1 + (this.wave - 1) * 0.06))
          }, 280)
          sfx('swipe', () => noise({ dur: 0.18, freq: 1200, to: 400, filter: 'bandpass', vol: 0.08 }), 0.1)
        }
      }

      if (speed > 0 && move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed * dt)
        p.add(move)
      }
      if (z.state === 'chase' && this.navClamp(p)) {
        const h = hallAt(p.x, p.z)!
        p.y += (hallY(h.u, true) - p.y) * Math.min(1, dt * 10)
        this.pushBlocks(p, 0.38)
      } else if (z.state === 'chase') {
        // the platform, and the stairways that open off it
        const sx = STAIRS.find((x) => Math.abs(p.x - x) < (p.z > PLATFORM.z1 + 0.5 ? STAIR.halfW + 0.4 : STAIR.halfW - 0.25))
        p.x = clamp(p.x, PLATFORM.x0, PLATFORM.x1)
        p.z = clamp(p.z, PLATFORM.z0, sx !== undefined ? LANDING.gateZ - 0.9 : PLATFORM.z1)
        const atDoor = sx !== undefined && Math.abs(p.z - HALL.laneZ) < 0.4 && p.z > LANDING.z0
        if (sx !== undefined && p.z > PLATFORM.z1) p.x = clamp(p.x, sx - STAIR.halfW + (atDoor ? -0.3 : 0.35), sx + STAIR.halfW - 0.35)
        const floorY = sx !== undefined && p.z > STAIR.z0 - 0.2 ? stairSlope(p.z) : 0
        p.y += (floorY - p.y) * Math.min(1, dt * 10)
        for (const pl of this.station.pillars) {
          const ox = p.x - pl.x
          const oz = p.z - pl.z
          const d = Math.hypot(ox, oz)
          if (d < pl.r + 0.25 && d > 1e-4) {
            p.x = pl.x + (ox / d) * (pl.r + 0.25)
            p.z = pl.z + (oz / d) * (pl.r + 0.25)
          }
        }
        this.pushBlocks(p, 0.38)
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

  // ---------------------------------------------------------------- the gates at the top of the stairs

  /** The gates: shut (and shaken by the crowd behind them) or, in the last station once its wave is cleared, open. */
  private updateGates(dt: number) {
    const exits = this.station.exits
    const t = performance.now() * 0.001
    const want = this.station.final && (this.stage === 'exit' || this.stage === 'escaped') ? 1 : 0
    if (this.exitOpen !== want) {
      this.exitOpen = clamp(this.exitOpen + Math.sign(want - this.exitOpen) * (dt / 2.6), 0, 1)
      for (const e of exits) e.setOpen(this.exitOpen)
      this.rumble(dt, 0.35, 12)
    }
    const alive = this.zombies.filter((z) => z.state !== 'dead').length
    // the last station: the crowd thins as the wave comes down the stairs, and the street is empty at the end
    const left = this.station.final ? (this.stage === 'fight' ? clamp((this.toSpawn + alive) / Math.max(1, this.waveTotal), 0, 1) : this.stage === 'dying' ? 1 : 0) : 1
    let retarget = false
    for (const [i, e] of exits.entries()) {
      const gx = Math.abs(this.pos.x - e.x)
      const dGate = Math.hypot(gx, this.pos.z - LANDING.gateZ)
      const near = dGate < 26 && this.exitOpen < 1
      if (near !== this.crowdNear[i]) {
        this.crowdNear[i] = near
        retarget = true
      }
      const members = this.crowd.filter((c) => c.exit === i)
      const showing = Math.ceil(members.length * left)
      for (const c of members) {
        const vis = c.rank < showing && (this.exitOpen < 0.5 || !this.station.final)
        if (c.z.root.visible !== vis) {
          c.z.root.visible = vis
          retarget = true
        }
      }
      const upstairs = this.pos.y > 2.5 && this.pos.y < HALL.y - 0.5 && gx < 1.95 && this.pos.z > LANDING.gateZ - 5
      // the player on the landing, up against the bars: they reach through
      if (upstairs && this.exitOpen < 0.5) {
        if (!this.gateTold && this.pos.z > LANDING.gateZ - 4) {
          this.gateTold = true
          this.say('The gate is chained shut', this.station.final ? 'The street is swarming — clear the station first' : 'The street is full of them — only the last station is open', 5)
        }
        if (this.pos.z > LANDING.gateZ - 1.2 && this.stage !== 'dying') {
          this.gateHurtT -= dt
          if (this.gateHurtT <= 0) {
            this.gateHurtT = 0.9
            this.hurt(5 + this.wave * 0.6)
            this.shake = Math.max(this.shake, 0.03)
            sfx('claw', () => noise({ dur: 0.2, freq: 1500, to: 500, filter: 'bandpass', q: 1.2, vol: 0.14 }), 0.1)
          }
        }
      }
      if (near && this.exitOpen < 0.05) {
        const amt = upstairs ? 0.012 : 0.0025
        e.gate.position.x = e.x + Math.sin(t * 41 + i) * amt
        e.gate.position.z = LANDING.gateZ + Math.sin(t * 53 + i * 2) * amt * 0.7
        this.clangT -= dt / Math.max(1, exits.length)
        if (upstairs && this.clangT <= 0) {
          this.clangT = 0.5 + Math.random() * 0.9
          sfx('clang', () => {
            tone({ freq: 190 + Math.random() * 60, to: 120, dur: 0.22, type: 'square', vol: 0.06 })
            noise({ dur: 0.1, freq: 3200, filter: 'bandpass', q: 3, vol: 0.07 })
          }, 0.2)
        }
        for (const c of members) if (near && c.z.root.visible) this.animateCrowd(c.z, c.base, dt, t, upstairs)
      } else if (this.exitOpen >= 0.05) {
        e.gate.position.x = e.x
        e.gate.position.z = LANDING.gateZ
      }
    }
    // the red lamps of the ticket halls stutter
    for (const e of exits) e.hallLight.intensity = Math.sin(t * 7.3 + e.x) > 0.93 ? 1 : 7 + Math.sin(t * 2.1 + e.x) * 1.5
    if (retarget) this.refreshTargets()
  }

  /** One of the crowd: shoves against the bars, reaches through them now and then. */
  private animateCrowd(z: Zombie, base: THREE.Vector3, dt: number, t: number, agitated: boolean) {
    z.t += dt
    z.flash = Math.max(0, z.flash - dt * 6)
    for (const m of z.mats) if (!m.userData.glow) m.emissive.setRGB(z.flash * 0.5, 0, 0)
    z.root.position.z = base.z + Math.sin(t * (1.5 + (z.phase % 1)) + z.phase) * 0.05 - (agitated ? 0.1 : 0)
    z.root.position.x = base.x + Math.sin(t * 1.1 + z.phase * 1.7) * 0.03
    if (z.model) {
      const m = z.model
      if (z.t >= z.next) {
        z.next = z.t + (agitated ? 0.6 : 1.3) + Math.random() * (agitated ? 0.9 : 2.6)
        z.attack = 0.9
        m.play('attack', 0.8)
      } else {
        z.attack -= dt
        if (z.attack <= 0 && m.current === 'attack') m.play('idle')
        else if (z.hitT > 0.15) m.play('hit', 0.3)
      }
      z.hitT = Math.max(0, z.hitT - dt)
      m.mixer.update(dt)
    } else {
      // a cycle of reaching arms
      const t0 = z.t
      z.t = (t + z.phase) % (agitated ? 1.2 : 2.2)
      z.attack = 1
      this.animateZombie(z, dt, 0, 1)
      z.t = t0
    }
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
    const y0 = at.y + 0.35
    g.position.set(at.x, y0, at.z)
    if (g.position.z < PLATFORM.z0) g.position.z = PLATFORM.z0 + 0.2
    this.station.litter.add(g)
    this.pickups.push({ mesh: g, kind, t: 0, y0 })
  }

  private updatePickups(dt: number) {
    for (const p of this.pickups) {
      p.t += dt
      p.mesh.rotation.y += dt * 1.6
      p.mesh.position.y = p.y0 + Math.sin(p.t * 3) * 0.06
      const d = Math.hypot(p.mesh.position.x + this.world.position.x - this.pos.x, p.mesh.position.z - this.pos.z)
      if (d < 1.1 && Math.abs(p.y0 - 0.35 - this.pos.y) < 1.2 && this.stage !== 'dying') {
        if (p.kind === 'health') {
          if (this.health >= 100) continue
          this.health = Math.min(100, this.health + 35)
          this.say('+35 health', '', 1.2)
        } else {
          for (const g of this.guns) if (g.reserve >= 0) g.reserve += g.def.base === 'shotgun' ? 8 : Math.max(6, Math.round(g.def.mag * 1.5))
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
    for (const sys of [this.sparks, this.blood, this.acid]) {
      const arr = sys.points.geometry.attributes.position as THREE.BufferAttribute
      sys.list.forEach((p, i) => {
        if (p.life > 0) {
          p.life -= dt
          p.v.y -= 9.8 * dt
          p.v.multiplyScalar(1 - dt * 1.5)
          p.p.addScaledVector(p.v, dt)
          const gy = p.p.z > 0 ? this.groundAt(p.p.x - this.world.position.x, p.p.z) + 0.01 : -99
          if (p.p.y < gy) {
            p.p.y = gy
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
      const floor = c.mesh.position.z < 0 && !this.inCar() ? TRACK_Y : this.groundAt(c.mesh.position.x, c.mesh.position.z) + 0.006
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
    // magazines that fell out of the gun
    for (const d of this.magDrops) {
      if (d.life <= 0) continue
      d.life -= dt
      d.t += dt
      d.v.y -= 9.8 * dt
      d.mesh.position.addScaledVector(d.v, dt)
      d.mesh.rotation.x += d.spin.x * dt
      d.mesh.rotation.y += d.spin.y * dt
      d.mesh.rotation.z += d.spin.z * dt
      // from the size it had in the hand to its real size, as it falls away from the eye
      d.mesh.scale.setScalar(THREE.MathUtils.lerp(this.vm.scale.x, 1, clamp(d.t * 4, 0, 1)))
      const p = d.mesh.position
      const floor = (p.z < 0 && !this.inCar() ? TRACK_Y : this.groundAt(p.x, p.z)) + 0.05
      if (p.y < floor) {
        p.y = floor
        if (d.v.y < -0.8 && d.bounced < 3) {
          d.bounced++
          sfx('magdrop', () => {
            noise({ dur: 0.06, freq: 1600, filter: 'bandpass', q: 1.5, vol: 0.1 })
            tone({ freq: 220, to: 110, dur: 0.07, type: 'triangle', vol: 0.08 })
          }, 0.08)
        }
        d.v.y = Math.abs(d.v.y) * 0.3
        d.v.x *= 0.45
        d.v.z *= 0.45
        d.spin.multiplyScalar(0.4)
        if (Math.abs(d.v.y) < 0.3) {
          d.v.set(0, 0, 0)
          d.spin.set(0, 0, 0)
        }
      }
      if (d.life <= 0) d.mesh.visible = false
    }
    // the dust drifts
    const dp = this.dust.geometry.attributes.position as THREE.BufferAttribute
    const now = performance.now() * 0.001
    for (let i = 0; i < dp.count; i += 7) {
      dp.setY(i, (dp.getY(i) + dt * 0.03) % 4.3)
      let x = dp.getX(i) + Math.sin(now + i) * dt * 0.05 + this.windSpeed * dt * 0.35
      if (x > 40) x -= 80
      dp.setX(i, x)
    }
    dp.needsUpdate = true
  }

  private animateStation(dt: number) {
    const f = this.station.flicker
    const t = performance.now() * 0.001
    const on = Math.sin(t * 13) + Math.sin(t * 7.3) + Math.sin(t * 2.1) > 0.4 || Math.sin(t * 0.7) > 0.6
    f.mat.emissiveIntensity = on ? f.matOn : 0.15
    f.light.intensity = on ? f.lightOn : f.lightOn * 0.36
    // the next-train board
    const last = this.station.final
    let l1 = last ? 'Terminus  Street level' : `1  ${stationAt(this.stationIndex + 1).name}`
    let l2 = last ? 'Gate locked' : 'Service suspended'
    if (this.stage === 'exit' || this.stage === 'escaped') l2 = 'Gate open: climb'
    else if (this.stage === 'cleared') l2 = 'Approaching'
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
      ch.style.opacity = String(this.sprinting || this.stage === 'dying' ? 0 : 1 - this.aim * (this.gun.def.base === 'shotgun' ? 0.3 : 0.9))
    }
    if (this.hud.hit) this.hud.hit.style.opacity = String(this.hitT > 0 ? 1 : 0)
    if (this.hud.hurt) {
      const low = this.health < 35 ? 0.35 + Math.sin(performance.now() * 0.006) * 0.12 : 0
      this.hud.hurt.style.opacity = String(Math.max(this.hurtT / 0.6, low, this.stage === 'dying' ? 0.8 : 0))
    }
  }
}

