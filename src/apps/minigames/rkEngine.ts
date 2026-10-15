// Rune Keep: the game. Quake-style movement (ground friction, air control
// that rewards strafe-jumping, rocket jumps), eight weapons, six monsters
// that wake, hunt you through the level on a flow field and fight in their
// own ways, keys and doors, lifts, liquids, secrets, an exit portal, and
// three levels in a row. The window (RuneKeep.tsx) feeds the input and
// shows the HUD from snapshot().

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { noise, sfx, tone } from './sound'
import { LEVELS, MONSTERS, STEP, type Ent, type ItemKind, type Key, type MonsterKind } from './rkMaps'
import { Level, portalMaterial } from './rkLevel'
import {
  disposeSkins, makeItem, makeMonster, makeWeapon, poseMonster, STATS, tint, WEAPONS,
  type AmmoType, type MonsterStats, type Rig, type ViewModel, type WeaponId,
} from './rkActors'

const R = 0.4
const H = 1.75
const EYE = 1.45
const MAXSPEED = 9.2
const ACCEL = 10
const AIRCAP = 0.95
const FRICTION = 4
const STOPSPEED = 3.1
const GRAVITY = 25
const JUMP = 8.4
const MAX_AMMO: Record<AmmoType, number> = { shells: 100, nails: 200, rockets: 100, cells: 100 }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const rnd = (a: number, b: number) => a + Math.random() * (b - a)

export type RKStage = 'play' | 'dead' | 'intermission' | 'finished'

export interface RKHud {
  stage: RKStage
  level: string
  levelIndex: number
  levels: number
  health: number
  armor: number
  armorColor: string
  weapon: WeaponId
  weaponName: string
  ammo: number | null
  ammoType: AmmoType | null
  ammoAll: Record<AmmoType, number>
  owned: WeaponId[]
  keys: Key[]
  quad: number
  kills: number
  monsters: number
  secrets: number
  secretsTotal: number
  time: number
  score: number
  log: string[]
  center: string
}

export interface RKHudEls {
  hurt: HTMLElement | null
  flash: HTMLElement | null
  tint: HTMLElement | null
}

/** The state at the start of a level: where Continue picks up. */
export interface RKSave {
  level: number
  levelName: string
  health: number
  armor: number
  armorType: number
  ammo: Record<AmmoType, number>
  owned: WeaponId[]
  score: number
  totalKills: number
}

export interface RKResult {
  score: number
  levels: number
  kills: number
  won: boolean
}

interface Mon {
  kind: MonsterKind
  s: MonsterStats
  rig: Rig
  pos: THREE.Vector3
  vel: THREE.Vector3
  yaw: number
  hp: number
  state: 'idle' | 'chase' | 'dead'
  awake: boolean
  see: boolean
  seeT: number
  walk: number
  act: number
  actKind: 'melee' | 'range' | 'leap'
  hit: boolean
  cd: number
  pain: number
  flash: number
  deadT: number
  fall: number
  strafe: number
  onGround: boolean
  light: THREE.Color
  lightT: number
}

interface Item {
  kind: ItemKind
  group: THREE.Group
  mats: THREE.MeshStandardMaterial[]
  pos: THREE.Vector3
  t: number
  taken: boolean
  light: THREE.Color
}

interface Proj {
  kind: 'nail' | 'rocket' | 'grenade' | 'spit' | 'bgrenade'
  mesh: THREE.Object3D
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  fromPlayer: boolean
  dmg: number
  trail: number
}

interface Particle {
  p: THREE.Vector3
  v: THREE.Vector3
  life: number
  grav: number
}

interface Gib {
  mesh: THREE.Mesh
  v: THREE.Vector3
  spin: THREE.Vector3
  life: number
}

interface Boom {
  sprite: THREE.Sprite
  t: number
  size: number
}

function spriteTex(kind: 'soft' | 'fire' | 'flash' | 'smoke'): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  if (kind === 'soft') {
    gr.addColorStop(0, 'rgba(255,255,255,1)')
    gr.addColorStop(0.4, 'rgba(255,255,255,0.5)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, 128, 128)
  } else if (kind === 'smoke') {
    for (let i = 0; i < 14; i++) {
      const x = 40 + Math.random() * 48
      const y = 40 + Math.random() * 48
      const rr = 20 + Math.random() * 24
      const s = g.createRadialGradient(x, y, 0, x, y, rr)
      s.addColorStop(0, 'rgba(255,255,255,0.35)')
      s.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = s
      g.fillRect(0, 0, 128, 128)
    }
  } else if (kind === 'fire') {
    for (let i = 0; i < 18; i++) {
      const x = 30 + Math.random() * 68
      const y = 30 + Math.random() * 68
      const rr = 16 + Math.random() * 30
      const s = g.createRadialGradient(x, y, 0, x, y, rr)
      s.addColorStop(0, 'rgba(255,240,180,0.9)')
      s.addColorStop(0.4, 'rgba(255,140,40,0.6)')
      s.addColorStop(1, 'rgba(120,20,0,0)')
      g.fillStyle = s
      g.fillRect(0, 0, 128, 128)
    }
  } else {
    g.translate(64, 64)
    for (let k = 0; k < 8; k++) {
      g.rotate(Math.PI / 4)
      const l = g.createLinearGradient(0, 0, 0, -60)
      l.addColorStop(0, 'rgba(255,240,200,1)')
      l.addColorStop(1, 'rgba(255,120,20,0)')
      g.fillStyle = l
      g.beginPath()
      g.moveTo(-8, 0)
      g.lineTo(0, k % 2 ? -60 : -40)
      g.lineTo(8, 0)
      g.fill()
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class RuneKeepEngine {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(90, 16 / 9, 0.03, 300)
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private level!: Level
  private levelIndex = 0
  private onOver: (r: RKResult) => void
  private hud: RKHudEls = { hurt: null, flash: null, tint: null }
  private tex = { soft: spriteTex('soft'), fire: spriteTex('fire'), flash: spriteTex('flash'), smoke: spriteTex('smoke') }
  private dyn: THREE.PointLight[] = []
  private dynWant: { p: THREE.Vector3; color: number; power: number }[] = []
  private levelObjects = new THREE.Group()
  private env: THREE.Texture

  // player
  private pos = new THREE.Vector3()
  private vel = new THREE.Vector3()
  private yaw = 0
  private pitch = 0
  private onGround = false
  private stepSmooth = 0
  private health = 100
  private armor = 0
  private armorType = 0
  private ammo: Record<AmmoType, number> = { shells: 25, nails: 0, rockets: 0, cells: 0 }
  private owned = new Set<WeaponId>(['axe', 'shotgun'])
  private weapon: WeaponId = 'shotgun'
  private keysHeld = new Set<Key>()
  private quadT = 0
  private keys = new Set<string>()
  private firing = false
  private cooldown = 0
  private kick = 0
  private punch = 0
  private bob = 0
  private hurtT = 0
  private flashT = 0
  private liquidT = 0
  private deadT = 0
  private megaT = 0
  private vm = new THREE.Group()
  private vms = new Map<WeaponId, ViewModel>()
  private muzzle: THREE.Sprite
  private muzzleT = 0
  private nailSide = 1
  private beam: THREE.Mesh
  private beamOn = false
  private vmLight = new THREE.Color(1, 1, 1)

  // world
  private mons: Mon[] = []
  private items: Item[] = []
  private projs: Proj[] = []
  private gibs: Gib[] = []
  private booms: Boom[] = []
  private holes: THREE.Mesh[] = []
  private flow = new Int16Array(0)
  private flowT = 0
  private portal: THREE.Mesh | null = null
  private portalMat: THREE.ShaderMaterial | null = null
  private exitPos = new THREE.Vector3()
  private flames: THREE.Sprite[] = []
  private sparks!: { pts: THREE.Points; list: Particle[] }
  private blood!: { pts: THREE.Points; list: Particle[] }
  private smoke!: { pts: THREE.Points; list: Particle[] }
  private holeMat: THREE.MeshBasicMaterial
  private holeGeo = new THREE.PlaneGeometry(0.14, 0.14)
  private gibMat = new THREE.MeshStandardMaterial({ color: 0x7a1a12, roughness: 0.6 })
  private gibGeo = new THREE.BoxGeometry(1, 1, 1)

  // game
  stage: RKStage = 'play'
  private time = 0
  private levelTime = 0
  score = 0
  private kills = 0
  private totalKills = 0
  private secretsFound = new Set<number>()
  private log: { text: string; t: number }[] = []
  private center = ''
  private centerT = 0
  private needKeyT = 0
  private shake = 0

  constructor(canvas: HTMLCanvasElement, onOver: (r: RKResult) => void) {
    this.onOver = onOver
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.scene.add(new THREE.AmbientLight(0xffffff, 1))
    // a dim reflection map, so armour, guns and metal walls catch light instead of going black
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const room = new RoomEnvironment()
    this.env = pmrem.fromScene(room, 0.04).texture
    room.dispose()
    pmrem.dispose()
    this.scene.environment = this.env
    this.scene.environmentIntensity = 0.35
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(16, 16, { samples: 4, type: THREE.HalfFloatType }))
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(16, 16), 0.45, 0.5, 0.9)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.camera.rotation.order = 'YXZ'
    this.scene.add(this.camera, this.levelObjects)
    this.camera.add(this.vm)
    this.vm.scale.setScalar(0.35)
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.6)
      this.scene.add(l)
      this.dyn.push(l)
    }
    for (const w of WEAPONS) {
      const vm = makeWeapon(w.id)
      vm.group.visible = false
      vm.group.position.set(0.2, -0.2, -0.42)
      this.vm.add(vm.group)
      this.vms.set(w.id, vm)
    }
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.flash, color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
    this.muzzle.visible = false
    this.beam = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 2.2, 4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    this.beam.frustumCulled = false
    this.beam.visible = false
    this.scene.add(this.beam)
    this.holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: this.tex.soft, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })
    this.sparks = this.particles(new THREE.Color(3, 2, 0.8), 0.06, THREE.AdditiveBlending, 600)
    this.blood = this.particles(new THREE.Color(0x5a0806), 0.09, THREE.NormalBlending, 900)
    this.smoke = this.particles(new THREE.Color(0x6a625a), 0.5, THREE.NormalBlending, 500, this.tex.smoke, 0.5)
    this.newGame()
  }

  // ---------------------------------------------------------------- setup

  private particles(color: THREE.Color, size: number, blending: THREE.Blending, n: number, map = this.tex.soft, opacity = 1) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3).fill(-999), 3))
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, map, transparent: true, opacity, depthWrite: false, blending, sizeAttenuation: true }))
    pts.frustumCulled = false
    this.scene.add(pts)
    const list: Particle[] = []
    for (let i = 0; i < n; i++) list.push({ p: new THREE.Vector3(0, -999, 0), v: new THREE.Vector3(), life: 0, grav: 1 })
    return { pts, list }
  }

  private emit(sys: { list: Particle[] }, at: THREE.Vector3, dir: THREE.Vector3, n: number, speed: number, life: number, grav = 1) {
    let k = 0
    for (const p of sys.list) {
      if (p.life > 0) continue
      p.p.copy(at)
      p.v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(speed).addScaledVector(dir, speed * rnd(0.3, 1.2))
      p.life = life * rnd(0.5, 1.3)
      p.grav = grav
      if (++k >= n) break
    }
  }

  /** Called with a checkpoint each time a level (after the first) begins. */
  onCheckpoint: ((s: RKSave) => void) | null = null

  /** Start again from a checkpoint. */
  continueFrom(s: RKSave) {
    this.score = s.score
    this.totalKills = s.totalKills
    this.health = Math.max(s.health, 50)
    this.armor = s.armor
    this.armorType = s.armorType
    this.ammo = { ...s.ammo }
    this.owned = new Set(s.owned)
    this.loadLevel(clamp(s.level, 0, LEVELS.length - 1))
  }

  newGame() {
    this.score = 0
    this.totalKills = 0
    this.health = 100
    this.armor = 0
    this.armorType = 0
    this.ammo = { shells: 25, nails: 0, rockets: 0, cells: 0 }
    this.owned = new Set(['axe', 'shotgun'])
    this.loadLevel(0)
  }

  private loadLevel(i: number) {
    this.clearLevel()
    this.levelIndex = i
    const map = LEVELS[i]()
    this.level = new Level(map)
    this.levelObjects.add(this.level.group)
    this.scene.background = new THREE.Color(map.fogColor)
    this.scene.fog = new THREE.FogExp2(map.fogColor, map.fog)
    this.stage = 'play'
    this.levelTime = 0
    this.kills = 0
    this.secretsFound.clear()
    this.keysHeld.clear()
    this.quadT = 0
    this.flow = new Int16Array(map.w * map.h).fill(-1)
    for (const e of map.ents) this.spawnEnt(e)
    const start = map.ents.find((e) => e.kind === 'start')!
    this.pos.set(start.x, map.cells[Math.floor(start.z) * map.w + Math.floor(start.x)].f, start.z)
    this.vel.set(0, 0, 0)
    this.yaw = Math.PI - (start.angle ?? 0) // angle 0 faces +z
    this.pitch = 0
    this.selectWeapon(this.bestWeapon(), true)
    this.say(map.name, 3)
    this.message(`Level ${i + 1}: ${map.name}`)
    // a checkpoint at every level after the first
    if (i > 0)
      this.onCheckpoint?.({
        level: i, levelName: map.name, health: Math.min(100, Math.max(this.health, 50)), armor: this.armor, armorType: this.armorType,
        ammo: { ...this.ammo }, owned: [...this.owned], score: this.score, totalKills: this.totalKills,
      })
  }

  private clearLevel() {
    for (const m of this.mons) this.disposeRig(m.rig)
    for (const it of this.items) it.group.removeFromParent()
    for (const p of this.projs) p.mesh.removeFromParent()
    for (const g of this.gibs) g.mesh.removeFromParent()
    for (const b of this.booms) b.sprite.removeFromParent()
    for (const h of this.holes) h.removeFromParent()
    for (const f of this.flames) f.removeFromParent()
    this.portal?.removeFromParent()
    this.portal?.geometry.dispose()
    this.portalMat?.dispose()
    this.portal = null
    this.mons = []
    this.items = []
    this.projs = []
    this.gibs = []
    this.booms = []
    this.holes = []
    this.flames = []
    this.levelObjects.clear()
    this.level?.dispose()
  }

  private disposeRig(r: Rig) {
    r.root.removeFromParent()
    for (const m of r.mats) m.dispose()
  }

  private spawnEnt(e: Ent) {
    const map = this.level.map
    const cell = map.cells[Math.floor(e.z) * map.w + Math.floor(e.x)]
    if ((MONSTERS as string[]).includes(e.kind)) {
      const kind = e.kind as MonsterKind
      const s = STATS[kind]
      const rig = makeMonster(kind)
      const pos = new THREE.Vector3(e.x, s.flies ? cell.f + (e.y ?? 4) : cell.f, e.z)
      rig.root.position.copy(pos)
      this.levelObjects.add(rig.root)
      this.mons.push({
        kind, s, rig, pos, vel: new THREE.Vector3(), yaw: e.angle ?? 0, hp: s.hp, state: 'idle', awake: false, see: false, seeT: 0,
        walk: Math.random() * 10, act: -1, actKind: 'melee', hit: false, cd: rnd(0.5, 1.5), pain: 0, flash: 0, deadT: 0, fall: 1,
        strafe: Math.random() < 0.5 ? -1 : 1, onGround: true, light: new THREE.Color(1, 1, 1), lightT: 0,
      })
    } else if (e.kind === 'light') {
      if (e.style === 'torch') {
        const l = this.level.lights.find((x) => Math.abs(x.pos.x - e.x) < 0.5 && Math.abs(x.pos.z - e.z) < 0.5)
        if (!l) return
        // a bracket and a flame
        const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.6, metalness: 0.6 }))
        bracket.position.copy(l.pos).add(new THREE.Vector3(0, -0.3, 0))
        bracket.material.color.setRGB(0.4, 0.3, 0.2)
        this.levelObjects.add(bracket)
        const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.fire, color: new THREE.Color(e.color ?? 0xffa040).multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
        f.position.copy(l.pos).add(new THREE.Vector3(0, 0.05, 0))
        f.scale.set(0.45, 0.6, 1)
        this.levelObjects.add(f)
        this.flames.push(f)
      } else if (e.style === 'lamp') {
        const l = this.level.lights.find((x) => Math.abs(x.pos.x - e.x) < 0.5 && Math.abs(x.pos.z - e.z) < 0.5)
        if (!l) return
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(e.color ?? 0xdfe8ff).multiplyScalar(2.6) }))
        lamp.position.copy(l.pos)
        this.levelObjects.add(lamp)
        const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, cell.c - l.pos.y, 6), new THREE.MeshStandardMaterial({ color: 0x302820 }))
        cage.position.set(l.pos.x, (cell.c + l.pos.y) / 2, l.pos.z)
        this.levelObjects.add(cage)
      }
    } else if (e.kind === 'exit') {
      this.portalMat = portalMaterial(this.level.time)
      this.portal = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), this.portalMat)
      this.exitPos.set(e.x, cell.f + 1.25, e.z)
      this.portal.position.copy(this.exitPos)
      // face the room it opens onto
      const look = new THREE.Vector3()
      for (let dz = -4; dz <= 4; dz++)
        for (let dx = -4; dx <= 4; dx++) {
          const c = this.level.cell(e.x + dx, e.z + dz)
          if (c && !c.solid) look.add(new THREE.Vector3(dx, 0, dz))
        }
      this.portal.lookAt(this.exitPos.clone().add(look.lengthSq() > 0 ? look.normalize() : new THREE.Vector3(0, 0, -1)))
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.09, 12, 48), new THREE.MeshStandardMaterial({ color: 0x8a7a60, roughness: 0.4, metalness: 0.9 }))
      this.portal.add(ring)
      this.levelObjects.add(this.portal)
    } else if (e.kind !== 'start') {
      const it = makeItem(e.kind as ItemKind)
      it.group.position.set(e.x, cell.f, e.z)
      this.levelObjects.add(it.group)
      const light = this.level.lightAt(new THREE.Vector3(e.x, cell.f + 0.8, e.z))
      this.items.push({ kind: e.kind as ItemKind, group: it.group, mats: it.mats, pos: new THREE.Vector3(e.x, cell.f, e.z), t: Math.random() * 6, taken: false, light })
      tint(it.mats, this.lift(light))
    }
  }

  /** Entities look washed out in pitch black: keep a floor under their light. */
  private lift(c: THREE.Color): THREE.Color {
    return new THREE.Color(Math.max(0.2, c.r * 1.15), Math.max(0.18, c.g * 1.15), Math.max(0.17, c.b * 1.15))
  }

  // ---------------------------------------------------------------- public

  bindHud(els: RKHudEls) {
    this.hud = els
  }

  resize(w: number, h: number, dpr: number) {
    const pr = Math.min(dpr, 2)
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(pr)
    this.composer.setSize(w, h)
    this.camera.aspect = w / Math.max(1, h)
    // a Quake-like horizontal field of view of about 100°
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(100) / 2) / this.camera.aspect))
    this.camera.fov = clamp(this.camera.fov, 60, 95)
    this.camera.updateProjectionMatrix()
  }

  keyDown(code: string) {
    this.keys.add(code)
    if (this.stage !== 'play') return
    const n = /^Digit([1-8])$/.exec(code)
    if (n) {
      const w = WEAPONS[Number(n[1]) - 1]
      if (!this.owned.has(w.id)) this.message(`You don't have the ${w.name}`)
      else if (w.ammo && this.ammo[w.ammo] < w.use) this.message(`Not enough ${w.ammo}`)
      else this.selectWeapon(w.id)
    } else if (code === 'KeyQ') this.cycle(-1)
  }

  keyUp(code: string) {
    this.keys.delete(code)
  }

  releaseAll() {
    this.keys.clear()
    this.firing = false
  }

  look(dx: number, dy: number) {
    if (this.stage !== 'play') return
    this.yaw -= dx * 0.0022
    this.pitch = clamp(this.pitch - dy * 0.0022, -1.5, 1.5)
  }

  mouseDown(button: number) {
    if (button === 0) this.firing = true
  }

  mouseUp(button: number) {
    if (button === 0) this.firing = false
  }

  wheel(dy: number) {
    if (Math.abs(dy) > 3) this.cycle(dy > 0 ? 1 : -1)
  }

  /** Continue after the level's score screen. */
  advance() {
    if (this.stage !== 'intermission') return
    if (this.levelIndex + 1 < LEVELS.length) this.loadLevel(this.levelIndex + 1)
    else {
      this.stage = 'finished'
      this.onOver({ score: this.score, levels: LEVELS.length, kills: this.totalKills, won: true })
    }
  }

  frame(dt: number, mode: 'playing' | 'attract' | 'still') {
    dt = Math.min(dt, 0.05)
    if (mode === 'playing') this.update(dt)
    else if (mode === 'attract') this.attract(dt)
    this.composer.render()
  }

  snapshot(): RKHud {
    const w = WEAPONS.find((x) => x.id === this.weapon)!
    return {
      stage: this.stage,
      level: this.level.map.name,
      levelIndex: this.levelIndex,
      levels: LEVELS.length,
      health: Math.max(0, Math.ceil(this.health)),
      armor: Math.ceil(this.armor),
      armorColor: this.armorType >= 0.8 ? '#e0403a' : this.armorType >= 0.6 ? '#e0c030' : '#40c060',
      weapon: this.weapon,
      weaponName: w.name,
      ammo: w.ammo ? this.ammo[w.ammo] : null,
      ammoType: w.ammo,
      ammoAll: { ...this.ammo },
      owned: WEAPONS.filter((x) => this.owned.has(x.id)).map((x) => x.id),
      keys: [...this.keysHeld],
      quad: Math.ceil(this.quadT),
      kills: this.kills,
      monsters: this.mons.length,
      secrets: this.secretsFound.size,
      secretsTotal: this.level.map.secrets,
      time: Math.floor(this.levelTime),
      score: this.score,
      log: this.log.filter((l) => l.t > 0).map((l) => l.text),
      center: this.centerT > 0 ? this.center : '',
    }
  }

  dispose() {
    this.clearLevel()
    this.composer.dispose()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mt = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mt)) mt.forEach((x) => x.dispose())
      else mt?.dispose()
    })
    for (const t of Object.values(this.tex)) t.dispose()
    disposeSkins()
    this.env.dispose()
    this.renderer.dispose()
  }

  // ---------------------------------------------------------------- messages

  private message(text: string) {
    this.log.push({ text, t: 4 })
    if (this.log.length > 4) this.log.shift()
  }

  private say(text: string, secs = 2.5) {
    this.center = text
    this.centerT = secs
  }

  // ---------------------------------------------------------------- the attract view (start card)

  private attractT = 0
  private attract(dt: number) {
    this.attractT += dt
    const start = this.level.map.ents.find((e) => e.kind === 'start')!
    this.camera.position.set(start.x, 2.2, start.z + 1)
    this.camera.rotation.set(-0.05, Math.PI + Math.sin(this.attractT * 0.15) * 0.9, 0)
    this.vm.visible = false
    this.level.update(dt, () => false, () => false, () => {})
    this.animateScenery(dt)
  }

  // ---------------------------------------------------------------- update

  private update(dt: number) {
    this.time += dt
    this.vm.visible = this.stage === 'play'
    if (this.stage === 'play') this.levelTime += dt
    this.centerT -= dt
    for (const l of this.log) l.t -= dt
    this.dynWant = []
    if (this.stage === 'play' || this.stage === 'dead') {
      this.updatePlayer(dt)
      this.updateWeapon(dt)
      this.updateMonsters(dt)
      this.updateProjectiles(dt)
      this.updateItems(dt)
      this.updateWorld(dt)
    }
    this.updateEffects(dt)
    this.animateScenery(dt)
    this.placeCamera(dt)
    this.applyDynLights()
    this.updateHudEls(dt)
  }

  private updateWorld(dt: number) {
    const lv = this.level
    // doors: keys and the "you need" message
    for (const [i, d] of lv.doors.entries()) {
      const def = lv.map.doors[i]
      const near = Math.hypot(this.pos.x - d.cx, this.pos.z - d.cz) < 2.8
      if (!d.unlocked && near) {
        if (def.key && this.keysHeld.has(def.key)) {
          d.unlocked = true
          this.message(`The ${def.key} key opens the door`)
        } else if (this.needKeyT <= 0) {
          this.say(`You need the ${def.key} key`, 1.8)
          this.needKeyT = 2.5
          sfx('locked', () => tone({ freq: 140, dur: 0.25, type: 'square', vol: 0.06 }))
        }
      }
    }
    this.needKeyT -= dt
    const playerCell = (x: number, z: number) => lv.cell(x, z)
    lv.update(
      dt,
      (x, z, r) => Math.hypot(this.pos.x - x, this.pos.z - z) < r || this.mons.some((m) => m.state !== 'dead' && m.awake && Math.hypot(m.pos.x - x, m.pos.z - z) < r),
      (id) => this.onGround && playerCell(this.pos.x, this.pos.z)?.lift === id,
      (what, x, z) => this.play3d(what, new THREE.Vector3(x, this.pos.y + 1, z), (v) => {
        if (what === 'door') noise({ dur: 0.9, freq: 300, to: 120, filter: 'lowpass', vol: 0.2 * v })
        else noise({ dur: 1.2, freq: 220, filter: 'lowpass', vol: 0.15 * v })
      }),
    )
    // secrets
    const c = lv.cell(this.pos.x, this.pos.z)
    if (c?.secret && !this.secretsFound.has(c.secret)) {
      this.secretsFound.add(c.secret)
      this.score += 500
      this.say('You found a secret area!', 2.5)
      sfx('secret', () => [523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'triangle', vol: 0.1, at: i * 0.09 })))
    }
    // the exit
    if (this.portal && this.portalMat) {
      const open = !lv.map.exitNeedsKills || this.mons.every((m) => m.state === 'dead')
      this.portalMat.uniforms.uOn.value += ((open ? 1 : 0) - this.portalMat.uniforms.uOn.value) * Math.min(1, dt * 3)
      this.portal.rotation.z += dt * 0.3
      this.dynWant.push({ p: this.exitPos, color: open ? 0x5080ff : 0x802010, power: open ? 2.5 : 1 })
      if (this.stage === 'play' && this.pos.distanceTo(this.exitPos.clone().setY(this.pos.y)) < 1.1 && Math.abs(this.exitPos.y - 1.25 - this.pos.y) < 1.5) {
        if (open) this.finishLevel()
        else if (this.needKeyT <= 0) {
          this.say('The vault stays sealed while its guardians live', 2)
          this.needKeyT = 2.5
        }
      }
    }
    this.recomputeFlow(dt)
  }

  private finishLevel() {
    this.stage = 'intermission'
    this.score += 1000
    this.releaseAll()
    sfx('exit', () => [392, 523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.5, type: 'sine', vol: 0.12, at: i * 0.12 })))
  }

  // ---------------------------------------------------------------- the player

  private accelerate(wx: number, wz: number, wishspeed: number, accel: number, cap: number, dt: number) {
    const capped = Math.min(wishspeed, cap)
    const cur = this.vel.x * wx + this.vel.z * wz
    const add = capped - cur
    if (add <= 0) return
    const a = Math.min(add, accel * dt * wishspeed)
    this.vel.x += a * wx
    this.vel.z += a * wz
  }

  private updatePlayer(dt: number) {
    const lv = this.level
    if (this.stage === 'dead') {
      this.deadT += dt
      this.vel.x *= 0.9
      this.vel.z *= 0.9
      if (this.deadT > 1.6 && this.deadT - dt <= 1.6) this.onOver({ score: this.score, levels: this.levelIndex, kills: this.totalKills, won: false })
    }
    const k = this.keys
    const alive = this.stage === 'play'
    // WASD moves; the arrows turn and look up and down (like the mouse, at a steady speed)
    const fwd = alive ? (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) : 0
    const side = alive ? (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) : 0
    const turn = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)
    const tilt = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0)
    if (alive && (turn || tilt)) this.look(turn * 1100 * dt, tilt * 650 * dt)
    const walk = k.has('ShiftLeft') || k.has('ShiftRight') ? 0.5 : 1
    let wx = -Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * side
    let wz = -Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * side
    const wl = Math.hypot(wx, wz)
    if (wl > 0) {
      wx /= wl
      wz /= wl
    }
    const wish = wl > 0 ? MAXSPEED * walk : 0

    if (this.onGround) {
      // friction, then ground acceleration
      const sp = Math.hypot(this.vel.x, this.vel.z)
      if (sp > 0) {
        const drop = Math.max(sp, STOPSPEED) * FRICTION * dt
        const ns = Math.max(0, sp - drop) / sp
        this.vel.x *= ns
        this.vel.z *= ns
      }
      this.accelerate(wx, wz, wish, ACCEL, Infinity, dt)
      if (alive && k.has('Space')) {
        this.vel.y = JUMP
        this.onGround = false
        sfx('jump', () => noise({ dur: 0.08, freq: 600, filter: 'lowpass', vol: 0.08 }), 0.2)
      }
    } else this.accelerate(wx, wz, wish, ACCEL, AIRCAP, dt)

    // horizontal moves in small steps, with stepping up stairs
    const dist = Math.hypot(this.vel.x, this.vel.z) * dt
    const n = Math.max(1, Math.ceil(dist / 0.2))
    for (let i = 0; i < n; i++) {
      this.moveAxis(this.vel.x * (dt / n), 0)
      this.moveAxis(0, this.vel.z * (dt / n))
    }

    // vertical
    const wasGround = this.onGround
    this.vel.y -= GRAVITY * dt
    this.pos.y += this.vel.y * dt
    const ground = lv.ground(this.pos.x, this.pos.z, R)
    if (this.pos.y <= ground) {
      if (!wasGround && this.vel.y < -9) {
        sfx('land', () => noise({ dur: 0.12, freq: 300, filter: 'lowpass', vol: 0.18 }), 0.2)
        if (this.vel.y < -18) this.damage(Math.round((-this.vel.y - 18) * 2), null)
      }
      this.pos.y = ground
      this.vel.y = Math.max(0, this.vel.y)
      this.onGround = true
    } else if (wasGround && this.vel.y <= 0 && this.pos.y - ground < STEP) {
      this.pos.y = ground // down the stairs without bouncing
      this.vel.y = 0
      this.onGround = true
    } else this.onGround = false
    const ceil = lv.ceiling(this.pos.x, this.pos.z, R)
    if (this.pos.y + H > ceil) {
      this.pos.y = ceil - H
      this.vel.y = Math.min(0, this.vel.y)
    }
    if (this.onGround && Math.hypot(this.vel.x, this.vel.z) > 1) {
      const before = this.bob
      this.bob += dt * Math.hypot(this.vel.x, this.vel.z) * 1.1
      if (Math.floor(before / Math.PI) !== Math.floor(this.bob / Math.PI))
        sfx('step', () => noise({ dur: 0.05, freq: 400 + Math.random() * 300, filter: 'lowpass', vol: 0.06 }), 0.15)
    }

    // liquids hurt
    const c = lv.cell(this.pos.x, this.pos.z)
    this.liquidT -= dt
    if (c?.liquid && this.pos.y < c.f + 0.3 && alive && this.liquidT <= 0) {
      this.liquidT = c.liquid === 'lava' ? 0.2 : 0.6
      this.damage(c.liquid === 'lava' ? 10 : 4, null, true)
      if (c.liquid === 'lava') sfx('sizzle', () => noise({ dur: 0.3, freq: 3000, filter: 'highpass', vol: 0.08 }), 0.3)
    }
    // megahealth wears off
    if (this.health > 100) {
      this.megaT -= dt
      if (this.megaT <= 0) {
        this.megaT = 1
        this.health -= 1
      }
    }
    if (this.quadT > 0) {
      const before = this.quadT
      this.quadT -= dt
      if (before > 3 && this.quadT <= 3) this.message('Quad Damage is wearing off')
    }
    this.hurtT = Math.max(0, this.hurtT - dt)
    this.flashT = Math.max(0, this.flashT - dt)
  }

  private moveAxis(dx: number, dz: number) {
    const nx = this.pos.x + dx
    const nz = this.pos.z + dz
    const g = this.level.fit(nx, nz, R, this.pos.y, H)
    if (g === null) {
      if (dx) this.vel.x = 0
      if (dz) this.vel.z = 0
      return
    }
    if (g > this.pos.y) {
      this.stepSmooth -= g - this.pos.y
      this.pos.y = g
      if (this.vel.y < 0) this.vel.y = 0
    }
    this.pos.x = nx
    this.pos.z = nz
  }

  private placeCamera(dt: number) {
    this.stepSmooth *= Math.exp(-dt * 14)
    this.punch *= Math.exp(-dt * 9)
    this.shake *= Math.exp(-dt * 6)
    const sp = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / MAXSPEED)
    const bobY = this.onGround ? Math.sin(this.bob * 2) * 0.05 * sp : 0
    let eye = EYE
    let roll = 0
    if (this.stage === 'dead') {
      eye = Math.max(0.25, EYE - this.deadT * 1.6)
      roll = Math.min(1, this.deadT) * 0.6
    }
    // Quake's view roll when strafing
    const rightSpeed = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw)
    roll += -clamp(rightSpeed / MAXSPEED, -1, 1) * 0.035
    const sh = this.shake
    this.camera.position.set(this.pos.x + rnd(-sh, sh), this.pos.y + eye + bobY + this.stepSmooth + rnd(-sh, sh), this.pos.z + rnd(-sh, sh))
    this.camera.rotation.set(this.pitch + this.punch, this.yaw, roll)
  }

  /** Damage to the player; armour soaks its share. */
  private damage(dmg: number, from: THREE.Vector3 | null, quiet = false) {
    if (this.stage !== 'play') return
    const save = Math.min(this.armor, Math.ceil(dmg * this.armorType))
    this.armor -= save
    if (this.armor <= 0) this.armorType = 0
    this.health -= dmg - save
    this.hurtT = Math.min(1, this.hurtT + 0.3 + dmg / 60)
    this.punch -= Math.min(0.12, dmg * 0.004)
    if (from) {
      const push = this.pos.clone().sub(from).setY(0).normalize().multiplyScalar(Math.min(6, dmg * 0.15))
      this.vel.add(push)
    }
    if (!quiet || Math.random() < 0.3)
      sfx('pain', () => {
        noise({ dur: 0.15, freq: 500, to: 200, filter: 'lowpass', vol: 0.25 })
        tone({ freq: 180, to: 110, dur: 0.18, type: 'sawtooth', vol: 0.05 })
      }, 0.25)
    if (this.health <= 0) {
      this.health = 0
      this.stage = 'dead'
      this.deadT = 0
      this.firing = false
      tone({ freq: 220, to: 60, dur: 1.2, type: 'sawtooth', vol: 0.08 })
      noise({ dur: 0.6, freq: 500, to: 100, filter: 'lowpass', vol: 0.3 })
    }
  }

  // ---------------------------------------------------------------- weapons

  private bestWeapon(): WeaponId {
    for (const w of [...WEAPONS].reverse()) {
      if (w.id === 'thunder' || w.id === 'grenadel') continue // never switch to these by surprise
      if (this.owned.has(w.id) && (!w.ammo || this.ammo[w.ammo] >= w.use)) return w.id
    }
    return 'axe'
  }

  private selectWeapon(id: WeaponId, instant = false) {
    if (id === this.weapon && !instant) return
    this.weapon = id
    for (const [k, vm] of this.vms) vm.group.visible = k === id
    this.kick = instant ? 0 : 1.2 // comes up from below
    this.cooldown = Math.max(this.cooldown, instant ? 0 : 0.25)
    if (!instant) sfx('switch', () => noise({ dur: 0.07, freq: 2500, filter: 'highpass', vol: 0.06 }))
  }

  private cycle(dir: number) {
    const ids = WEAPONS.filter((w) => this.owned.has(w.id) && (!w.ammo || this.ammo[w.ammo] >= w.use)).map((w) => w.id)
    const i = ids.indexOf(this.weapon)
    this.selectWeapon(ids[(i + dir + ids.length) % ids.length])
  }

  private eyePos(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z)
  }

  private aimDir(spreadX = 0, spreadY = 0): THREE.Vector3 {
    const d = new THREE.Vector3(rnd(-spreadX, spreadX), rnd(-spreadY, spreadY), -1).normalize()
    return d.applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'))
  }

  private updateWeapon(dt: number) {
    this.cooldown -= dt
    this.kick = Math.max(0, this.kick - dt * 5)
    this.muzzleT -= dt
    this.muzzle.visible = this.muzzleT > 0
    const w = WEAPONS.find((x) => x.id === this.weapon)!
    this.beamOn = false
    if (this.stage === 'play' && this.firing && this.cooldown <= 0) {
      if (w.ammo && this.ammo[w.ammo] < w.use) {
        this.selectWeapon(this.bestWeapon())
      } else {
        if (w.ammo) this.ammo[w.ammo] -= w.use
        this.cooldown = w.delay
        this.fire(w.id)
      }
    }
    if (this.stage === 'play' && this.firing && this.weapon === 'thunder' && this.ammo.cells > 0) this.beamOn = true
    this.beam.visible = this.beamOn
    if (this.beamOn) this.drawBeam()
    this.animateViewmodel(dt)
  }

  private fire(id: WeaponId) {
    const quad = this.quadT > 0 ? 4 : 1
    const vm = this.vms.get(id)!
    const eye = this.eyePos()
    this.kick = 1
    this.noiseAt(eye, id === 'axe' ? 4 : 22)
    if (quad > 1) sfx('quadfire', () => tone({ freq: 90, to: 60, dur: 0.3, type: 'sawtooth', vol: 0.08 }), 0.2)
    const flash = (scale: number, color = 0xffc070) => {
      vm.muzzle.add(this.muzzle)
      this.muzzle.scale.setScalar(scale)
      this.muzzle.material.rotation = Math.random() * 6
      this.muzzleT = 0.05
      this.dynWant.push({ p: eye.clone().addScaledVector(this.aimDir(), 0.8), color, power: 3 })
      this.flashLightT = 0.06
    }
    switch (id) {
      case 'axe': {
        sfx('axe', () => noise({ dur: 0.15, freq: 1500, to: 400, filter: 'bandpass', vol: 0.1 }))
        const d = this.aimDir()
        const hit = this.rayMonsters(eye, d, 1.8)
        if (hit) {
          this.hurtMonster(hit.m, 20 * quad, d, hit.point)
          sfx('chop', () => noise({ dur: 0.1, freq: 400, filter: 'lowpass', vol: 0.3 }))
        } else {
          const w = this.level.ray(eye, d, 1.8)
          if (w) {
            this.emit(this.sparks, w.point, w.normal, 10, 2.5, 0.3)
            sfx('clang', () => tone({ freq: 1800, to: 1500, dur: 0.12, type: 'triangle', vol: 0.08 }))
          }
        }
        break
      }
      case 'shotgun':
      case 'shotgun2': {
        const two = id === 'shotgun2'
        this.pellets(eye, two ? 14 : 6, two ? 0.14 : 0.04, two ? 0.08 : 0.04, 4 * quad)
        flash(two ? 0.45 : 0.32)
        this.punch += two ? 0.07 : 0.035
        sfx('shot', () => {
          noise({ dur: two ? 0.4 : 0.28, freq: 2600, to: 220, filter: 'lowpass', vol: two ? 0.7 : 0.5 })
          tone({ freq: 90, to: 35, dur: 0.25, type: 'sine', vol: 0.4 })
          noise({ dur: 0.8, freq: 500, to: 100, filter: 'lowpass', vol: 0.08, at: 0.05 })
        }, 0.05)
        break
      }
      case 'nailgun':
      case 'supernail': {
        const sup = id === 'supernail'
        this.nailSide = -this.nailSide
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
        const start = eye.clone().addScaledVector(right, sup ? 0 : this.nailSide * 0.08).add(new THREE.Vector3(0, -0.12, 0))
        this.spawnProj('nail', start, this.aimDir().multiplyScalar(45), (sup ? 18 : 9) * quad, true)
        flash(0.18, 0xffe0a0)
        this.punch += 0.006
        sfx('nail', () => noise({ dur: 0.06, freq: sup ? 1800 : 2600, filter: 'bandpass', q: 1.5, vol: 0.18 }), 0.04)
        break
      }
      case 'grenadel': {
        const d = this.aimDir()
        this.spawnProj('grenade', eye.clone().addScaledVector(d, 0.5).add(new THREE.Vector3(0, -0.15, 0)), d.multiplyScalar(17).add(new THREE.Vector3(0, 4.5, 0)), 120 * quad, true)
        flash(0.3)
        sfx('gren', () => noise({ dur: 0.18, freq: 700, to: 200, filter: 'lowpass', vol: 0.35 }))
        break
      }
      case 'rocketl': {
        const d = this.aimDir()
        this.spawnProj('rocket', eye.clone().addScaledVector(d, 0.6).add(new THREE.Vector3(0, -0.12, 0)), d.multiplyScalar(30), 110 * quad, true)
        flash(0.4)
        this.punch += 0.03
        sfx('rocket', () => {
          noise({ dur: 0.4, freq: 900, to: 300, filter: 'lowpass', vol: 0.4 })
          noise({ dur: 0.6, freq: 2500, to: 800, filter: 'bandpass', vol: 0.1 })
        })
        break
      }
      case 'thunder': {
        const d = this.aimDir()
        const hit = this.rayMonsters(eye, d, 40)
        const wall = this.level.ray(eye, d, 40)
        if (hit && (!wall || hit.t < wall.dist)) this.hurtMonster(hit.m, 30 * quad, d, hit.point)
        else if (wall) this.emit(this.sparks, wall.point, wall.normal, 6, 3, 0.25)
        sfx('zap', () => {
          noise({ dur: 0.12, freq: 4000, filter: 'highpass', vol: 0.12 })
          tone({ freq: 60, dur: 0.12, type: 'sawtooth', vol: 0.12 })
        }, 0.09)
        this.dynWant.push({ p: eye.clone().addScaledVector(d, 3), color: 0x6080ff, power: 3 })
        break
      }
    }
  }

  private flashLightT = 0

  private pellets(eye: THREE.Vector3, n: number, sx: number, sy: number, dmg: number) {
    const hits = new Map<Mon, { dmg: number; d: THREE.Vector3; p: THREE.Vector3 }>()
    for (let i = 0; i < n; i++) {
      const d = this.aimDir(sx, sy)
      const wall = this.level.ray(eye, d, 120)
      const m = this.rayMonsters(eye, d, wall ? wall.dist : 120)
      if (m) {
        const h = hits.get(m.m) ?? { dmg: 0, d, p: m.point }
        h.dmg += dmg
        hits.set(m.m, h)
        this.emit(this.blood, m.point, d.clone().negate(), 3, 1.5, 0.6)
      } else if (wall) {
        this.emit(this.sparks, wall.point, wall.normal, 3, 2.2, 0.25)
        this.emit(this.smoke, wall.point, wall.normal, 1, 0.3, 0.8, -0.05)
        this.hole(wall.point, wall.normal)
      }
    }
    // pellets add up, so the shotgun gibs at close range like it should
    for (const [m, h] of hits) this.hurtMonster(m, h.dmg, h.d, h.p)
  }

  private hole(p: THREE.Vector3, n: THREE.Vector3) {
    const m = new THREE.Mesh(this.holeGeo, this.holeMat)
    m.position.copy(p).addScaledVector(n, 0.01)
    m.lookAt(p.clone().add(n))
    m.scale.setScalar(rnd(0.6, 1.1))
    this.levelObjects.add(m)
    this.holes.push(m)
    if (this.holes.length > 120) this.holes.shift()!.removeFromParent()
  }

  private drawBeam() {
    const vm = this.vms.get('thunder')!
    const from = new THREE.Vector3()
    vm.muzzle.getWorldPosition(from)
    const eye = this.eyePos()
    const d = this.aimDir()
    const wall = this.level.ray(eye, d, 40)
    const hit = this.rayMonsters(eye, d, wall ? wall.dist : 40)
    const to = hit ? hit.point : wall ? wall.point : eye.clone().addScaledVector(d, 40)
    // a jagged ribbon facing the camera
    const pts: THREE.Vector3[] = []
    const segs = 18
    for (let i = 0; i <= segs; i++) {
      const p = from.clone().lerp(to, i / segs)
      if (i > 0 && i < segs) p.add(new THREE.Vector3(rnd(-0.12, 0.12), rnd(-0.12, 0.12), rnd(-0.12, 0.12)))
      pts.push(p)
    }
    const pos: number[] = []
    const camDir = new THREE.Vector3()
    for (let i = 0; i < segs; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      camDir.subVectors(this.camera.position, a).normalize()
      const side = new THREE.Vector3().subVectors(b, a).cross(camDir).normalize().multiplyScalar(0.035)
      pos.push(a.x - side.x, a.y - side.y, a.z - side.z, a.x + side.x, a.y + side.y, a.z + side.z, b.x + side.x, b.y + side.y, b.z + side.z)
      pos.push(a.x - side.x, a.y - side.y, a.z - side.z, b.x + side.x, b.y + side.y, b.z + side.z, b.x - side.x, b.y - side.y, b.z - side.z)
    }
    this.beam.geometry.dispose()
    this.beam.geometry = new THREE.BufferGeometry()
    this.beam.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    this.dynWant.push({ p: to, color: 0x7090ff, power: 2.5 })
  }

  private animateViewmodel(dt: number) {
    const vm = this.vms.get(this.weapon)!
    const sp = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / MAXSPEED)
    const bob = this.onGround ? Math.sin(this.bob * 2) * 0.015 * sp : 0
    const g = vm.group
    // Quake's gun bob: forward and back with the stride
    g.position.set(0.2 + Math.cos(this.bob) * 0.01 * sp, -0.2 + bob - Math.max(0, this.kick - 1) * 1.2, -0.42 + Math.sin(this.bob * 2) * 0.012 * sp + Math.min(1, this.kick) * 0.05)
    g.rotation.set(Math.min(1, this.kick) * 0.06, 0, 0)
    if (this.weapon === 'axe' && vm.spinner) {
      const k = clamp(this.cooldown / 0.5, 0, 1)
      vm.spinner.rotation.x = -0.9 + Math.sin(k * Math.PI) * 1.4
      g.rotation.x = 0
    } else if (vm.spinner && this.firing && this.stage === 'play') vm.spinner.rotation.z += dt * 30
    if (this.weapon === 'thunder' && this.beamOn) g.position.x += rnd(-0.004, 0.004)
    // light the gun like the place you stand in
    this.vmLightT -= dt
    if (this.vmLightT <= 0) {
      this.vmLightT = 0.1
      this.level.lightAt(this.eyePos(), this.vmLight)
    }
    const flash = this.muzzleT > 0 ? 0.8 : 0
    // like Quake, the gun in your hands never goes fully dark
    const l = new THREE.Color(Math.max(0.42, this.vmLight.r), Math.max(0.38, this.vmLight.g), Math.max(0.34, this.vmLight.b))
    tint(vm.mats, new THREE.Color(l.r + flash, l.g + flash * 0.7, l.b + flash * 0.4))
    if (this.quadT > 0) for (const m of vm.mats) if (!m.userData.glow) m.emissive.setRGB(0.05, 0.08, 0.35)
  }

  private vmLightT = 0

  // ---------------------------------------------------------------- projectiles and explosions

  private spawnProj(kind: Proj['kind'], pos: THREE.Vector3, vel: THREE.Vector3, dmg: number, fromPlayer: boolean) {
    let mesh: THREE.Object3D
    if (kind === 'nail') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 1.1) }))
      m.geometry.rotateX(Math.PI / 2)
      mesh = m
    } else if (kind === 'rocket') {
      const g = new THREE.Group()
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0x5a5a52, metalness: 0.6, roughness: 0.4 }))
      body.geometry.rotateX(Math.PI / 2)
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.fire, color: new THREE.Color(3, 2, 1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
      flame.scale.setScalar(0.5)
      flame.position.z = 0.3
      g.add(body, flame)
      mesh = g
    } else if (kind === 'grenade' || kind === 'bgrenade') {
      const g = new THREE.Group()
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), new THREE.MeshStandardMaterial({ color: 0x3a3a30, roughness: 0.5, metalness: 0.6 })))
      const blink = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.2) }))
      blink.position.y = 0.08
      g.add(blink)
      mesh = g
    } else {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.soft, color: new THREE.Color(1, 2.6, 0.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
      s.scale.setScalar(0.45)
      mesh = s
    }
    mesh.position.copy(pos)
    this.levelObjects.add(mesh)
    this.projs.push({ kind, mesh, pos: pos.clone(), vel, life: kind === 'grenade' || kind === 'bgrenade' ? 2.5 : 6, fromPlayer, dmg, trail: 0 })
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projs) {
      if (p.life <= 0) continue
      p.life -= dt
      const grenade = p.kind === 'grenade' || p.kind === 'bgrenade'
      if (grenade) p.vel.y -= GRAVITY * 0.7 * dt
      const steps = Math.max(1, Math.ceil((p.vel.length() * dt) / 0.15))
      let done = false
      for (let s = 0; s < steps && !done; s++) {
        const next = p.pos.clone().addScaledVector(p.vel, dt / steps)
        // monsters / the player
        if (p.fromPlayer) {
          for (const m of this.mons) {
            if (m.state === 'dead') continue
            if (Math.hypot(next.x - m.pos.x, next.z - m.pos.z) < m.s.radius + 0.1 && next.y > m.pos.y && next.y < m.pos.y + m.s.height) {
              if (p.kind === 'nail') {
                this.hurtMonster(m, p.dmg, p.vel.clone().normalize(), next)
                this.emit(this.blood, next, p.vel.clone().normalize().negate(), 4, 1.5, 0.6)
              } else this.explode(next, p.dmg, true, m)
              done = true
              break
            }
          }
        } else if (Math.hypot(next.x - this.pos.x, next.z - this.pos.z) < R + 0.15 && next.y > this.pos.y && next.y < this.pos.y + H && this.stage === 'play') {
          if (p.kind === 'spit') this.damage(p.dmg, p.pos)
          else this.explode(next, p.dmg, false)
          done = true
        }
        if (done) break
        if (this.level.solidAt(next.x, next.y, next.z)) {
          if (grenade) {
            // bounce off whichever side was hit
            const c = this.level
            if (c.solidAt(next.x, p.pos.y, p.pos.z)) p.vel.x *= -0.5
            if (c.solidAt(p.pos.x, p.pos.y, next.z)) p.vel.z *= -0.5
            if (c.solidAt(p.pos.x, next.y, p.pos.z)) {
              p.vel.y *= -0.45
              p.vel.x *= 0.7
              p.vel.z *= 0.7
              if (Math.abs(p.vel.y) > 1) sfx('bounce', () => noise({ dur: 0.05, freq: 1200, filter: 'bandpass', vol: 0.1 }), 0.05)
            }
            continue
          }
          if (p.kind === 'nail') {
            this.emit(this.sparks, p.pos, p.vel.clone().normalize().negate(), 4, 2, 0.2)
            sfx('ric', () => noise({ dur: 0.04, freq: 3500, filter: 'bandpass', q: 5, vol: 0.05 }), 0.05)
          } else if (p.kind === 'spit') this.emit(this.sparks, p.pos, new THREE.Vector3(0, 1, 0), 8, 1.5, 0.3)
          else this.explode(p.pos, p.dmg, p.fromPlayer)
          done = true
          break
        }
        p.pos.copy(next)
      }
      if (!done && grenade && p.life <= 0) {
        this.explode(p.pos, p.dmg, p.fromPlayer)
        done = true
      }
      if (done) p.life = 0
      p.mesh.position.copy(p.pos)
      if (p.kind !== 'spit') p.mesh.lookAt(p.pos.clone().sub(p.vel))
      if (p.kind === 'rocket') {
        p.trail -= dt
        if (p.trail <= 0) {
          p.trail = 0.02
          this.emit(this.smoke, p.pos, p.vel.clone().normalize().negate(), 1, 0.3, 1.0, -0.05)
        }
        this.dynWant.push({ p: p.pos, color: 0xff9040, power: 2 })
      } else if (p.kind === 'spit') this.dynWant.push({ p: p.pos, color: 0x80ff40, power: 1.2 })
      if (p.life <= 0) p.mesh.removeFromParent()
    }
    this.projs = this.projs.filter((p) => p.life > 0)
  }

  private explode(at: THREE.Vector3, dmg: number, fromPlayer: boolean, direct?: Mon) {
    const radius = 4.5
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.fire, color: new THREE.Color(2.6, 1.8, 1.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
    sprite.position.copy(at)
    sprite.material.rotation = Math.random() * 6
    this.levelObjects.add(sprite)
    this.booms.push({ sprite, t: 0, size: 3.2 })
    this.emit(this.sparks, at, new THREE.Vector3(0, 1, 0), 40, 6, 0.6)
    this.emit(this.smoke, at, new THREE.Vector3(0, 1, 0), 14, 1.6, 1.6, -0.1)
    this.boomLight = { p: at.clone(), t: 0.35 }
    const d = this.camera.position.distanceTo(at)
    this.shake = Math.max(this.shake, clamp(0.12 - d * 0.008, 0, 0.12))
    this.play3d('boom', at, (v) => {
      noise({ dur: 0.9, freq: 1400, to: 90, filter: 'lowpass', vol: 0.7 * v })
      tone({ freq: 70, to: 28, dur: 0.6, type: 'sine', vol: 0.5 * v })
    })
    this.noiseAt(at, 25)
    for (const m of this.mons) {
      if (m.state === 'dead') continue
      const c = m.pos.clone().add(new THREE.Vector3(0, m.s.height / 2, 0))
      const dist = Math.max(0, c.distanceTo(at) - m.s.radius)
      if (m === direct) this.hurtMonster(m, dmg + rnd(0, 20), c.clone().sub(at).normalize(), c)
      else if (dist < radius && this.level.clear(at, c)) this.hurtMonster(m, dmg * (1 - dist / radius), c.clone().sub(at).normalize(), c)
    }
    // the player: knocked back (rocket jumps), half damage from your own
    const pc = this.pos.clone().add(new THREE.Vector3(0, H / 2, 0))
    const pd = Math.max(0, pc.distanceTo(at) - R)
    if (pd < radius && this.stage === 'play' && this.level.clear(at, pc)) {
      const k = dmg * (1 - pd / radius)
      const push = pc.clone().sub(at).normalize().multiplyScalar(k * 0.11)
      this.vel.add(push)
      if (push.y > 0.5) this.onGround = false
      this.damage(Math.round(k * (fromPlayer ? 0.5 : 1)), null)
    }
  }

  private boomLight: { p: THREE.Vector3; t: number } | null = null

  // ---------------------------------------------------------------- monsters

  /** Nearest monster a ray hits (vertical cylinders). */
  private rayMonsters(o: THREE.Vector3, d: THREE.Vector3, max: number): { m: Mon; t: number; point: THREE.Vector3 } | null {
    let best: { m: Mon; t: number; point: THREE.Vector3 } | null = null
    for (const m of this.mons) {
      if (m.state === 'dead') continue
      const ox = o.x - m.pos.x
      const oz = o.z - m.pos.z
      const a = d.x * d.x + d.z * d.z
      const b = 2 * (ox * d.x + oz * d.z)
      const c = ox * ox + oz * oz - m.s.radius * m.s.radius
      const disc = b * b - 4 * a * c
      if (disc < 0 || a < 1e-8) continue
      const t = (-b - Math.sqrt(disc)) / (2 * a)
      if (t < 0 || t > max) continue
      const y = o.y + d.y * t
      if (y < m.pos.y || y > m.pos.y + m.s.height) continue
      if (!best || t < best.t) best = { m, t, point: o.clone().addScaledVector(d, t) }
    }
    return best
  }

  private hurtMonster(m: Mon, dmg: number, dir: THREE.Vector3, at: THREE.Vector3) {
    if (m.state === 'dead') return
    m.hp -= dmg
    m.flash = 1
    this.wake(m)
    this.emit(this.blood, at, dir.clone().negate().setY(0.3), Math.min(20, 4 + dmg / 3), 2, 0.7)
    if (!m.s.flies) m.vel.addScaledVector(dir.clone().setY(0), Math.min(4, dmg * 0.04))
    if (m.hp <= 0) return this.kill(m, dir)
    if (m.act < 0 && Math.random() < m.s.painChance * Math.min(1, dmg / 15)) {
      m.pain = 0.3
      this.play3d('mpain', m.pos, (v) => tone({ freq: this.voice(m.kind) * 1.3, to: this.voice(m.kind), dur: 0.2, type: 'sawtooth', vol: 0.07 * v }))
    }
  }

  private voice(k: MonsterKind) {
    return { grunt: 160, hound: 300, knight: 130, brute: 80, wraith: 400, ravager: 70 }[k]
  }

  private kill(m: Mon, dir: THREE.Vector3) {
    m.state = 'dead'
    m.deadT = 0
    this.kills++
    this.totalKills++
    this.score += m.s.points
    m.rig.eyes.forEach((e) => (e.visible = false))
    const gib = m.hp < -40 || (m.hp < -20 && m.s.hp < 60)
    if (gib) {
      // Quake's finest tradition
      m.rig.root.visible = false
      const c = m.pos.clone().add(new THREE.Vector3(0, m.s.height / 2, 0))
      for (let i = 0; i < 9; i++) {
        const mesh = new THREE.Mesh(this.gibGeo, this.gibMat)
        mesh.scale.set(rnd(0.08, 0.22), rnd(0.08, 0.2), rnd(0.08, 0.22))
        mesh.position.copy(c).add(new THREE.Vector3(rnd(-0.3, 0.3), rnd(-0.5, 0.5), rnd(-0.3, 0.3)))
        this.levelObjects.add(mesh)
        this.gibs.push({ mesh, v: new THREE.Vector3(rnd(-4, 4), rnd(3, 9), rnd(-4, 4)).addScaledVector(dir, 3), spin: new THREE.Vector3(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)), life: rnd(6, 10) })
      }
      this.emit(this.blood, c, new THREE.Vector3(0, 1, 0), 60, 3.5, 1.1)
      this.play3d('gib', m.pos, (v) => noise({ dur: 0.4, freq: 600, to: 120, filter: 'lowpass', vol: 0.45 * v }))
    } else {
      const local = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -m.yaw)
      m.fall = local.z > 0 ? 1 : -1
      this.play3d('die', m.pos, (v) => tone({ freq: this.voice(m.kind), to: this.voice(m.kind) * 0.4, dur: 0.6, type: 'sawtooth', vol: 0.08 * v }))
    }
    if (m.kind === 'grunt') {
      // a dropped pack of shells
      const it = makeItem('shells')
      it.group.scale.setScalar(0.7)
      it.group.position.set(m.pos.x, this.level.ground(m.pos.x, m.pos.z, 0.1), m.pos.z)
      this.levelObjects.add(it.group)
      const light = this.level.lightAt(m.pos.clone().setY(m.pos.y + 0.8))
      tint(it.mats, this.lift(light))
      this.items.push({ kind: 'shells', group: it.group, mats: it.mats, pos: it.group.position.clone(), t: 0, taken: false, light })
    }
  }

  private wake(m: Mon) {
    if (m.awake || m.state === 'dead') return
    m.awake = true
    m.state = 'chase'
    this.play3d('sight', m.pos, (v) => {
      tone({ freq: this.voice(m.kind), to: this.voice(m.kind) * 0.7, dur: 0.5, type: 'sawtooth', vol: 0.08 * v })
      noise({ dur: 0.4, freq: this.voice(m.kind) * 4, filter: 'bandpass', q: 3, vol: 0.05 * v })
    })
    // and the ones nearby hear it
    for (const o of this.mons) if (!o.awake && o.state !== 'dead' && o.pos.distanceTo(m.pos) < 7) window.setTimeout(() => this.wake(o), rnd(200, 700))
  }

  /** Gunfire and explosions wake monsters within earshot. */
  private noiseAt(p: THREE.Vector3, r: number) {
    for (const m of this.mons) if (!m.awake && m.pos.distanceTo(p) < r) this.wake(m)
  }

  /** Distances (in cells) from the player over the walkable grid. */
  private recomputeFlow(dt: number) {
    this.flowT -= dt
    if (this.flowT > 0) return
    this.flowT = 0.3
    const lv = this.level
    const m = lv.map
    const flow = this.flow
    flow.fill(-1)
    const sx = Math.floor(this.pos.x)
    const sz = Math.floor(this.pos.z)
    const q = [sz * m.w + sx]
    flow[q[0]] = 0
    for (let h = 0; h < q.length; h++) {
      const i = q[h]
      const a = m.cells[i]
      const x = i % m.w
      const z = (i - x) / m.w
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (z + dz) * m.w + x + dx
        const b = m.cells[j]
        if (!b || flow[j] >= 0 || lv.blocked(b) || b.liquid) continue
        // the search runs from the player outwards, so a monster in b walks into a: a may be up to a step above b
        if (lv.floorOf(a) > lv.floorOf(b) + STEP + 0.01) continue
        flow[j] = flow[i] + 1
        q.push(j)
      }
    }
  }

  private updateMonsters(dt: number) {
    const lv = this.level
    const eye = this.eyePos()
    for (const m of this.mons) {
      m.lightT -= dt
      if (m.lightT <= 0) {
        m.lightT = 0.15 + Math.random() * 0.1
        lv.lightAt(m.pos.clone().setY(m.pos.y + 1.2), m.light)
      }
      m.flash = Math.max(0, m.flash - dt * 5)
      tint(m.rig.mats, this.lift(m.light), m.flash)
      const model = m.rig.model
      if (m.state === 'dead') {
        m.deadT += dt
        const k = 1 - (1 - clamp(m.deadT / 0.5, 0, 1)) ** 2
        if (model) {
          // the model's own death animation; fliers drop to the floor
          model.play('death')
          model.mixer.update(dt)
          if (m.s.flies) m.pos.y = Math.max(lv.ground(m.pos.x, m.pos.z, 0.2), m.pos.y - dt * 6)
        } else if (m.s.flies) {
          m.pos.y = Math.max(lv.ground(m.pos.x, m.pos.z, 0.2), m.pos.y - dt * 6)
          m.rig.root.rotation.x = k * 1.4
        } else {
          m.rig.root.rotation.x = m.fall * k * 1.45
          m.rig.hips.position.y = (m.kind === 'hound' ? 0.62 : 0.95) - k * 0.5
        }
        m.rig.root.position.copy(m.pos)
        continue
      }
      // sight
      m.seeT -= dt
      if (m.seeT <= 0) {
        m.seeT = 0.2 + Math.random() * 0.1
        const head = m.pos.clone().setY(m.pos.y + m.s.height * 0.85)
        const dist = head.distanceTo(eye)
        let see = this.stage === 'play' && dist < 45 && lv.clear(head, eye)
        if (see && !m.awake) {
          // asleep: only what's in front of it
          const to = Math.atan2(eye.x - m.pos.x, eye.z - m.pos.z)
          const diff = Math.abs(Math.atan2(Math.sin(to - m.yaw), Math.cos(to - m.yaw)))
          if (diff > 1.6 && dist > 6) see = false
        }
        m.see = see
        if (see) this.wake(m)
      }
      if (!m.awake) {
        if (model) {
          model.play('idle')
          model.mixer.update(dt)
        } else poseMonster(m.kind, m.rig, m.walk, 0, -1, this.time, 0)
        m.rig.root.position.copy(m.pos)
        m.rig.root.rotation.y = m.yaw
        continue
      }
      const dx = this.pos.x - m.pos.x
      const dz = this.pos.z - m.pos.z
      const dist = Math.hypot(dx, dz)
      const face = Math.atan2(dx, dz)
      m.cd -= dt
      m.pain = Math.max(0, m.pain - dt)

      // attacks
      if (m.act >= 0) {
        const dur = m.actKind === 'melee' ? 0.55 : m.actKind === 'leap' ? 0.9 : 0.7
        const before = m.act
        m.act += dt / dur
        if (m.actKind === 'leap' && !m.hit && dist < m.s.radius + R + 0.4 && Math.abs(this.pos.y - m.pos.y) < 1.5) {
          m.hit = true
          this.damage(m.s.meleeDmg, m.pos)
        }
        if (before < 0.5 && m.act >= 0.5) this.attackHit(m, dist)
        if (m.act >= 1) m.act = -1
      } else if (this.stage === 'play' && m.pain <= 0) {
        if (m.s.melee && dist < m.s.melee && Math.abs(this.pos.y - m.pos.y) < 1.4) this.startAttack(m, 'melee')
        else if ((m.kind === 'ravager' || m.kind === 'hound') && m.see && dist > 3 && dist < 9 && m.cd <= 0 && m.onGround) {
          this.startAttack(m, 'leap')
          const l = m.kind === 'ravager' ? 11 : 9
          m.vel.set((dx / dist) * l, 6, (dz / dist) * l)
          m.onGround = false
          m.cd = rnd(2, 3.5)
        } else if (m.s.range && m.see && dist < m.s.range && m.cd <= 0 && Math.random() < dt * 3) this.startAttack(m, 'range')
      }

      // movement
      let speed = m.pain > 0 || (m.act >= 0 && m.actKind !== 'leap') ? 0 : m.s.speed
      let mx = 0
      let mz = 0
      if (m.s.flies) {
        const want = new THREE.Vector3(this.pos.x, this.pos.y + 2.2 + Math.sin(this.time + m.walk) * 0.6, this.pos.z)
        const to = want.sub(m.pos)
        const keep = dist < 5 ? -1 : 1 // keep a little distance
        to.x *= keep
        to.z *= keep
        to.add(new THREE.Vector3(-dz, 0, dx).normalize().multiplyScalar(m.strafe * 1.5))
        if (to.lengthSq() > 0.01) to.normalize()
        const next = m.pos.clone().addScaledVector(to, speed * dt)
        const head = next.clone().setY(next.y + m.s.height)
        if (!lv.solidAt(next.x, next.y, next.z) && !lv.solidAt(head.x, head.y, head.z)) m.pos.copy(next)
        else m.strafe = -m.strafe
      } else {
        if (m.actKind === 'leap' && m.act >= 0) {
          speed = 0
        } else if (m.see && dist < 14) {
          mx = dx / dist
          mz = dz / dist
          if (m.kind === 'grunt' && dist < 9) {
            // grunts sidestep instead of walking into your face
            mx = -dz / dist * m.strafe
            mz = dx / dist * m.strafe
            if (Math.random() < dt * 0.5) m.strafe = -m.strafe
          }
        } else {
          // follow the flow field downhill
          const i = Math.floor(m.pos.z) * lv.map.w + Math.floor(m.pos.x)
          let best = this.flow[i] >= 0 ? this.flow[i] : 1e9
          let bx = 0
          let bz = 0
          for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const j = i + oz * lv.map.w + ox
            const f = this.flow[j]
            if (f < 0 || f >= best) continue
            if (ox && oz && (this.flow[i + ox] < 0 || this.flow[i + oz * lv.map.w] < 0)) continue
            best = f
            bx = Math.floor(m.pos.x) + ox + 0.5 - m.pos.x
            bz = Math.floor(m.pos.z) + oz + 0.5 - m.pos.z
          }
          if (bx || bz) {
            const l = Math.hypot(bx, bz)
            mx = bx / l
            mz = bz / l
          } else if (dist > 0) {
            mx = dx / dist
            mz = dz / dist
          }
        }
        // keep apart from each other
        for (const o of this.mons) {
          if (o === m || o.state === 'dead') continue
          const ox = m.pos.x - o.pos.x
          const oz = m.pos.z - o.pos.z
          const d = Math.hypot(ox, oz)
          const min = m.s.radius + o.s.radius
          if (d < min && d > 1e-3) {
            mx += (ox / d) * (min - d) * 2
            mz += (oz / d) * (min - d) * 2
          }
        }
        if (dist < m.s.radius + R + 0.1) speed = 0
        // walk, knockback, gravity
        m.vel.x += (mx * speed - m.vel.x) * Math.min(1, dt * (m.onGround ? 10 : 1))
        m.vel.z += (mz * speed - m.vel.z) * Math.min(1, dt * (m.onGround ? 10 : 1))
        for (const [vx, vz] of [[m.vel.x * dt, 0], [0, m.vel.z * dt]]) {
          const g = lv.fit(m.pos.x + vx, m.pos.z + vz, m.s.radius * 0.9, m.pos.y, Math.min(m.s.height, 1.8))
          if (g === null) {
            if (vx) m.vel.x = 0
            if (vz) m.vel.z = 0
            continue
          }
          m.pos.x += vx
          m.pos.z += vz
          if (g > m.pos.y) m.pos.y = g
        }
        m.vel.y -= GRAVITY * dt
        m.pos.y += m.vel.y * dt
        const ground = lv.ground(m.pos.x, m.pos.z, m.s.radius * 0.9)
        if (m.pos.y <= ground || (m.onGround && m.vel.y <= 0 && m.pos.y - ground < STEP)) {
          m.pos.y = ground
          m.vel.y = 0
          m.onGround = true
        } else m.onGround = false
        // monsters in lava burn
        const c = lv.cell(m.pos.x, m.pos.z)
        if (c?.liquid === 'lava' && m.pos.y < c.f + 0.3 && Math.random() < dt * 4) this.hurtMonster(m, 10, new THREE.Vector3(0, 1, 0), m.pos.clone())
      }
      const turn = m.see || m.act >= 0 ? face : Math.atan2(m.vel.x, m.vel.z) || m.yaw
      const dy = Math.atan2(Math.sin(turn - m.yaw), Math.cos(turn - m.yaw))
      m.yaw += dy * Math.min(1, dt * 8)
      const sp = Math.hypot(m.vel.x, m.vel.z)
      m.walk += dt * (sp * 2.6 + 0.2)
      if (model) {
        if (m.act >= 0) {
          const dur = m.actKind === 'melee' ? 0.55 : m.actKind === 'leap' ? 0.9 : 0.7
          model.play(m.actKind === 'melee' ? 'attack' : m.actKind === 'leap' ? 'leap' : 'shoot', dur)
        } else if (m.pain > 0) model.play('hit', 0.3)
        else if (m.s.flies) model.play(m.see ? 'run' : 'idle')
        else if (sp > m.s.speed * 0.65) model.play('run')
        else if (sp > 0.3) model.play('walk')
        else model.play('idle')
        model.pace(sp / Math.max(0.5, m.s.speed * 0.8))
        model.mixer.update(dt)
      } else poseMonster(m.kind, m.rig, m.walk, m.s.flies ? 0 : sp, m.act, this.time, m.pain / 0.3)
      m.rig.root.position.copy(m.pos)
      m.rig.root.rotation.y = m.yaw
      m.rig.root.rotation.x = 0
      if (m.kind === 'brute' && Math.random() < dt * 2) this.play3d('saw', m.pos, (v) => noise({ dur: 0.25, freq: 900, filter: 'bandpass', q: 4, vol: 0.05 * v }))
      if (m.kind === 'wraith' || m.kind === 'ravager') this.dynWant.push({ p: m.pos.clone().setY(m.pos.y + m.s.height * 0.85), color: m.kind === 'wraith' ? 0x4080ff : 0xff8020, power: 0.5 })
    }
  }

  private startAttack(m: Mon, kind: Mon['actKind']) {
    m.act = 0
    m.actKind = kind
    m.hit = false
    if (kind === 'range') m.cd = m.kind === 'grunt' ? rnd(1.4, 2.6) : m.kind === 'brute' ? rnd(2, 3.5) : rnd(1.5, 2.5)
    if (kind === 'melee' && m.kind === 'knight') this.play3d('swing', m.pos, (v) => noise({ dur: 0.25, freq: 1200, to: 300, filter: 'bandpass', vol: 0.1 * v }))
  }

  private attackHit(m: Mon, dist: number) {
    const eye = this.eyePos()
    const from = m.pos.clone().setY(m.pos.y + m.s.height * 0.7)
    if (m.actKind === 'melee') {
      if (dist < m.s.melee + 0.4 && Math.abs(this.pos.y - m.pos.y) < 1.5) {
        this.damage(Math.round(m.s.meleeDmg * rnd(0.7, 1.3)), m.pos)
        this.play3d('hit', m.pos, (v) => noise({ dur: 0.12, freq: 500, filter: 'lowpass', vol: 0.3 * v }))
      }
      return
    }
    if (m.actKind !== 'range') return
    if (m.kind === 'grunt') {
      this.play3d('mshot', from, (v) => {
        noise({ dur: 0.25, freq: 2200, to: 300, filter: 'lowpass', vol: 0.4 * v })
        tone({ freq: 100, to: 40, dur: 0.2, type: 'sine', vol: 0.25 * v })
      })
      this.dynWant.push({ p: from, color: 0xffc070, power: 3 })
      if (!this.level.clear(from, eye)) return
      const acc = clamp(1 - dist / 35, 0.2, 0.9)
      let dmg = 0
      for (let i = 0; i < 4; i++) if (Math.random() < acc) dmg += 4
      if (dmg) this.damage(dmg, m.pos)
      for (let i = 0; i < 3; i++) this.emit(this.sparks, eye.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 0.5), rnd(-1, 1))), new THREE.Vector3(0, 1, 0), 2, 1.5, 0.2)
    } else if (m.kind === 'brute') {
      const to = this.pos.clone().sub(from)
      const flat = Math.hypot(to.x, to.z)
      const t = clamp(flat / 14, 0.5, 1.6)
      const v = new THREE.Vector3(to.x / t, (to.y + 0.5 * GRAVITY * 0.7 * t * t) / t, to.z / t)
      this.spawnProj('bgrenade', from, v, 40, false)
      this.play3d('lob', from, (vv) => noise({ dur: 0.18, freq: 700, to: 200, filter: 'lowpass', vol: 0.3 * vv }))
    } else if (m.kind === 'wraith') {
      for (const s of [-1, 1]) {
        const d = eye.clone().sub(from).normalize()
        d.x += s * 0.04
        this.spawnProj('spit', from.clone(), d.normalize().multiplyScalar(15), 9, false)
      }
      this.play3d('spit', from, (v) => tone({ freq: 900, to: 500, dur: 0.2, type: 'square', vol: 0.05 * v }))
    }
  }

  // ---------------------------------------------------------------- items

  private updateItems(dt: number) {
    for (const it of this.items) {
      if (it.taken) continue
      it.t += dt
      const spin = it.kind.startsWith('key') || it.kind.startsWith('armor') || it.kind === 'quad' || ['shotgun2', 'nailgun', 'supernail', 'grenadel', 'rocketl', 'thunder'].includes(it.kind)
      if (spin) it.group.rotation.y += dt * 1.8
      if (it.kind === 'quad' || it.kind.startsWith('key')) it.group.position.y = it.pos.y + Math.sin(it.t * 2.5) * 0.08
      if (it.kind === 'quad' || it.kind === 'mega') this.dynWant.push({ p: it.pos.clone().setY(it.pos.y + 0.7), color: 0x4060ff, power: 0.8 })
      if (this.stage !== 'play') continue
      if (Math.hypot(this.pos.x - it.pos.x, this.pos.z - it.pos.z) < 0.85 && Math.abs(this.pos.y - it.pos.y) < 1.2 && this.take(it.kind)) {
        it.taken = true
        it.group.removeFromParent()
        this.flashT = 0.25
      }
    }
  }

  private take(kind: ItemKind): boolean {
    const give = (t: AmmoType, n: number) => (this.ammo[t] = Math.min(MAX_AMMO[t], this.ammo[t] + n))
    const ding = (f = 880) => sfx('pick', () => {
      tone({ freq: f, dur: 0.08, type: 'triangle', vol: 0.1 })
      tone({ freq: f * 1.5, dur: 0.12, type: 'triangle', vol: 0.1, at: 0.06 })
    })
    const weapon = WEAPONS.find((w) => w.id === kind)
    if (weapon) {
      const fresh = !this.owned.has(weapon.id)
      this.owned.add(weapon.id)
      if (weapon.ammo) give(weapon.ammo, weapon.ammo === 'shells' ? 5 : weapon.ammo === 'nails' ? 30 : weapon.ammo === 'rockets' ? 5 : 15)
      this.message(`You got the ${weapon.name}`)
      if (fresh && WEAPONS.indexOf(weapon) > WEAPONS.findIndex((w) => w.id === this.weapon)) this.selectWeapon(weapon.id)
      ding(660)
      return true
    }
    switch (kind) {
      case 'shells':
      case 'nails':
      case 'rockets':
      case 'cells': {
        if (this.ammo[kind] >= MAX_AMMO[kind]) return false
        give(kind, { shells: 20, nails: 25, rockets: 5, cells: 6 }[kind])
        this.message(`You got the ${kind}`)
        ding()
        return true
      }
      case 'health':
      case 'health25':
        if (this.health >= 100) return false
        this.health = Math.min(100, this.health + (kind === 'health' ? 15 : 25))
        this.message(`You receive ${kind === 'health' ? 15 : 25} health`)
        ding(700)
        return true
      case 'mega':
        if (this.health >= 250) return false
        this.health = Math.min(250, this.health + 100)
        this.megaT = 5
        this.message('Megahealth!')
        ding(1100)
        return true
      case 'armor1':
      case 'armor2':
      case 'armor3': {
        const [type, amount] = kind === 'armor1' ? [0.3, 100] : kind === 'armor2' ? [0.6, 150] : [0.8, 200]
        if (this.armorType * this.armor >= type * amount) return false
        this.armorType = type
        this.armor = amount
        this.message(`You got the ${kind === 'armor1' ? 'green' : kind === 'armor2' ? 'yellow' : 'red'} armor`)
        sfx('armor', () => noise({ dur: 0.3, freq: 1500, filter: 'bandpass', vol: 0.2 }))
        return true
      }
      case 'quad':
        this.quadT = 30
        this.message('You got the Quad Damage')
        this.say('QUAD DAMAGE', 2)
        sfx('quad', () => [110, 165, 220].forEach((f, i) => tone({ freq: f, dur: 0.6, type: 'sawtooth', vol: 0.06, at: i * 0.05 })))
        return true
      case 'key_silver':
      case 'key_gold': {
        const k = kind.slice(4) as Key
        this.keysHeld.add(k)
        this.message(`You got the ${k} key`)
        ding(1320)
        return true
      }
    }
    return false
  }

  // ---------------------------------------------------------------- effects

  private updateEffects(dt: number) {
    for (const sys of [this.sparks, this.blood, this.smoke]) {
      const arr = sys.pts.geometry.attributes.position as THREE.BufferAttribute
      sys.list.forEach((p, i) => {
        if (p.life > 0) {
          p.life -= dt
          p.v.y -= 9.8 * p.grav * dt
          p.v.multiplyScalar(1 - dt * (p.grav < 0 ? 1.2 : 0.8))
          p.p.addScaledVector(p.v, dt)
          if (p.grav > 0 && this.level.solidAt(p.p.x, p.p.y, p.p.z)) p.v.set(0, 0, 0)
          arr.setXYZ(i, p.p.x, p.p.y, p.p.z)
        } else arr.setXYZ(i, 0, -999, 0)
      })
      arr.needsUpdate = true
    }
    for (const g of this.gibs) {
      if (g.life <= 0) continue
      g.life -= dt
      g.v.y -= GRAVITY * 0.8 * dt
      const next = g.mesh.position.clone().addScaledVector(g.v, dt)
      if (this.level.solidAt(next.x, next.y, next.z)) {
        if (this.level.solidAt(next.x, g.mesh.position.y, next.z)) {
          g.v.x *= -0.3
          g.v.z *= -0.3
        } else {
          if (g.v.y < -3) this.emit(this.blood, g.mesh.position, new THREE.Vector3(0, 1, 0), 3, 1, 0.4)
          g.v.y *= -0.3
          g.v.x *= 0.6
          g.v.z *= 0.6
          g.spin.multiplyScalar(0.5)
        }
      } else g.mesh.position.copy(next)
      g.mesh.rotation.x += g.spin.x * dt
      g.mesh.rotation.y += g.spin.y * dt
      if (g.v.lengthSq() > 4 && Math.random() < 0.5) this.emit(this.blood, g.mesh.position, new THREE.Vector3(), 1, 0.3, 0.5)
      if (g.life <= 0) g.mesh.removeFromParent()
    }
    this.gibs = this.gibs.filter((g) => g.life > 0)
    for (const b of this.booms) {
      b.t += dt
      const k = b.t / 0.45
      b.sprite.scale.setScalar(b.size * (0.4 + k))
      b.sprite.material.opacity = Math.max(0, 1 - k)
      if (k >= 1) b.sprite.removeFromParent()
    }
    this.booms = this.booms.filter((b) => b.t < 0.45)
    if (this.boomLight) {
      this.boomLight.t -= dt
      if (this.boomLight.t > 0) this.dynWant.push({ p: this.boomLight.p, color: 0xffa050, power: 9 * this.boomLight.t })
      else this.boomLight = null
    }
    this.flashLightT -= dt
  }

  private animateScenery(dt: number) {
    const t = this.time + this.attractT
    for (const [i, f] of this.flames.entries()) {
      const k = 0.85 + Math.sin(t * 13 + i * 1.7) * 0.08 + Math.sin(t * 23 + i) * 0.06
      f.scale.set(0.42 * k, 0.62 * (2 - k), 1)
      f.material.rotation = Math.sin(t * 5 + i) * 0.15
    }
    void dt
  }

  /** The handful of real point lights go to the brightest, nearest requests. */
  private applyDynLights() {
    const cam = this.camera.position
    if (this.quadT > 0 && this.stage === 'play') this.dynWant.push({ p: this.eyePos(), color: 0x4060ff, power: 1.4 })
    const list = this.dynWant.sort((a, b) => b.power / (1 + a.p.distanceTo(cam)) - a.power / (1 + b.p.distanceTo(cam)))
    this.dyn.forEach((l, i) => {
      const w = list[i]
      if (!w) {
        l.intensity = 0
        return
      }
      l.position.copy(w.p)
      l.color.set(w.color)
      l.intensity = w.power * 6
      l.distance = 6 + w.power * 2
    })
  }

  private play3d(name: string, at: THREE.Vector3, play: (vol: number) => void) {
    const d = at.distanceTo(this.pos)
    const v = clamp(1 - d / 35, 0, 1)
    if (v > 0.03) sfx(name, () => play(v), 0.05)
  }

  private updateHudEls(dt: number) {
    if (this.hud.hurt) this.hud.hurt.style.opacity = String(clamp(this.hurtT, 0, 0.8) + (this.stage === 'dead' ? 0.5 : 0))
    if (this.hud.flash) this.hud.flash.style.opacity = String(this.flashT * 1.6)
    if (this.hud.tint) {
      const c = this.level.cell(this.pos.x, this.pos.z)
      const under = c?.liquid && this.pos.y + EYE < c.f + 0.35
      const quad = this.quadT > 0
      this.hud.tint.style.background = under ? (c!.liquid === 'lava' ? 'rgba(255,80,0,0.55)' : 'rgba(60,160,20,0.45)') : quad ? 'rgba(40,60,255,0.16)' : 'transparent'
    }
    void dt
  }
}
