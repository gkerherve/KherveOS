// Kherve Grand Prix: the engine. Builds the circuit (f1Track), its scenery
// (f1World) and the twelve cars (f1Models), runs the sessions (f1Race) and
// draws them: cameras (chase, T-cam, cockpit, trackside TV; a cinematic tour
// behind the menu, over a demo race), the pit crews at work, tyre smoke and
// dust, the start lights, the sound (engine notes made with WebAudio, tyres,
// wind, the other cars going by), keyboard and gamepad. The window
// (GrandPrix.tsx) shows the HUD from snapshot().

import * as THREE from 'three'
import { buildTrack, inRange, locate, pointAt, trackDef, wrap, type Track, type TrackId } from './f1Track.ts'
import { COMPOUNDS, newTyres, SERIES, speedProfile, tyreGrip, type Compound, type Series } from './f1Physics.ts'
import { DIFFICULTY, Session, TEAMS, fmtLap, setRaceSeries, type Classified, type ClassicModel, type Difficulty, type RaceCar, type SessionEvent } from './f1Race.ts'
import { buildClassic, classicCams } from './f1Classics.ts'
import { buildCar, buildCarGeometry, sharedMaterials, teamLook, type CarGeometry, type CarModel, type Shared, type TeamLook } from './f1Models.ts'
import { buildWorld, type World } from './f1World.ts'
import { audioOut, noise, sfx, tone } from './sound'

export interface GPSettings {
  track: TrackId
  laps: number
  /** Qualifying minutes. */
  quali: number
  difficulty: Difficulty
  assists: boolean
  name: string
  /** Modern single-seaters or classic coupés, and the player's coupé. */
  series: Series
  classic: ClassicModel
}

export type Stage = 'menu' | 'qualifying' | 'qualiResults' | 'race' | 'raceResults'
export type CamMode = 'chase' | 'tcam' | 'cockpit' | 'tv'
const CAMS: CamMode[] = ['chase', 'tcam', 'cockpit', 'tv']

export interface TowerRow {
  pos: number
  code: string
  color: string
  gap: string
  tyre: Compound
  pit: boolean
  player: boolean
  best: string
}

export interface GPHud {
  stage: Stage
  kind: 'qualifying' | 'race'
  phase: Session['phase']
  lights: number
  remaining: number
  overtime: boolean
  lap: number
  laps: number
  position: number
  cars: number
  speed: number
  gear: number
  rpm: number
  throttle: number
  brake: number
  lapTime: number
  lastLap: number
  bestLap: number
  sessionBest: number
  sectors: string[]
  tyre: Compound
  wear: number
  temp: number
  grip: number
  compound: Compound
  pit: RaceCar['pit']
  pitT: number
  pitLen: number
  boxRequest: boolean
  limiter: boolean
  drsAvailable: boolean
  drsOpen: boolean
  tower: TowerRow[]
  dots: { x: number; z: number; color: string; player: boolean }[]
  message: SessionEvent | null
  camera: CamMode
  wrongWay: boolean
  offTrack: boolean
  mustChange: boolean
  changed: boolean
  lapValid: boolean
  penalty: number
  trackName: string
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

/** Where to put the braking boards: the start of each big stop. */
function brakingPoints(t: Track, v: Float32Array): number[] {
  const out: number[] = []
  const n = t.n
  for (let i = 0; i < n; i++) {
    const prev = v[(i - 1 + n) % n]
    const next = v[(i + 1) % n]
    if (v[i] >= prev && v[i] > next) {
      // a peak: how far does the speed fall in the next 300 m?
      let low = v[i]
      for (let j = 1; j < 150; j++) low = Math.min(low, v[(i + j) % n])
      if (v[i] - low > 22 && v[i] > 60) out.push(i * t.ds)
    }
  }
  return out
}

export class GrandPrixEngine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 14000)
  stage: Stage = 'menu'
  settings: GPSettings = { track: 'park', laps: 5, quali: 6, difficulty: 'medium', assists: true, name: 'Player', series: 'modern', classic: 'stoccarda' }
  track!: Track
  profile!: { v: Float32Array; lapTime: number }
  world: World | null = null
  session: Session | null = null
  demo: Session | null = null
  cam: CamMode = 'chase'
  /** The last session's classification (qualifying, then the race). */
  qualiResults: Classified[] = []
  raceResults: Classified[] = []
  mapPath = ''
  mapBox = { x: 0, z: 0, w: 1, h: 1 }
  onStage: (s: Stage) => void = () => {}

  private geo: CarGeometry
  private shared: Shared
  private looks: TeamLook[]
  private models: CarModel[] = []
  private keys = new Set<string>()
  private thr = 0
  private brk = 0
  private camPos = new THREE.Vector3()
  private camLook = new THREE.Vector3()
  private camYaw = 0
  private tvIdx = 0
  private time = 0
  private shake = 0
  private attractT = 0
  private attractCar = 0
  private padPrev: boolean[] = []
  private smoke: { s: THREE.Sprite; life: number; v: THREE.Vector3; max: number }[] = []
  private smokeMats: Record<'smoke' | 'dust' | 'grass', THREE.SpriteMaterial>
  private smokeTex: THREE.Texture
  private lastLights = 0
  private audio: EngineAudio | null = null
  private prevGear = 1
  private lastHit = 0
  private bodyPitch = new Map<number, { p: number; r: number; v: number }>()

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.camera.rotation.order = 'YXZ'
    this.scene.add(this.camera)
    // a fresh window starts with the modern cars (the series is module state, kept from a closed window)
    setRaceSeries('modern')
    this.geo = buildCarGeometry()
    this.shared = sharedMaterials()
    this.looks = TEAMS.map((t, i) => teamLook(t, i))
    this.buildCars()
    // smoke and dust
    const [c, g] = (() => {
      const cv = document.createElement('canvas')
      cv.width = cv.height = 64
      return [cv, cv.getContext('2d')!] as const
    })()
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grd.addColorStop(0, 'rgba(255,255,255,0.8)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 64, 64)
    this.smokeTex = new THREE.CanvasTexture(c)
    this.smokeMats = {
      smoke: new THREE.SpriteMaterial({ map: this.smokeTex, color: 0xdddddd, transparent: true, depthWrite: false, opacity: 0.5 }),
      dust: new THREE.SpriteMaterial({ map: this.smokeTex, color: 0xc8b48f, transparent: true, depthWrite: false, opacity: 0.55 }),
      grass: new THREE.SpriteMaterial({ map: this.smokeTex, color: 0x8a7a55, transparent: true, depthWrite: false, opacity: 0.35 }),
    }
    for (let k = 0; k < 90; k++) {
      const s = new THREE.Sprite(this.smokeMats.smoke)
      s.visible = false
      this.scene.add(s)
      this.smoke.push({ s, life: 0, v: new THREE.Vector3(), max: 1 })
    }
    this.setTrack('park')
  }

  // ---------------------------------------------------------------- set-up

  /** The twelve cars of the series being raced. */
  private buildCars() {
    for (const m of this.models) {
      this.scene.remove(m.root)
      m.dispose()
    }
    this.models = []
    const nums = [7, 17, 3, 22, 11, 29, 5, 44, 16, 8, 31, 12]
    for (let i = 0; i < 12; i++) {
      const team = Math.floor(i / 2)
      const t = TEAMS[team]
      const m = SERIES === 'classic' && t.model ? buildClassic(t.model, t, nums[i], this.shared) : buildCar(this.geo, this.looks[team], this.shared, t, nums[i], i % 2 === 1)
      this.models.push(m)
      this.scene.add(m.root)
    }
  }

  /** Switch between the modern single-seaters and the classic coupés (the player's team races `model`). */
  setSeries(series: Series, model: ClassicModel = this.settings.classic) {
    if (series === SERIES && (series === 'modern' || TEAMS[0].model === model)) return
    setRaceSeries(series, model)
    this.settings.series = series
    this.settings.classic = model
    this.buildCars()
    // the profile (and the garages' colours) depend on the series
    this.setTrack(this.settings.track, true)
  }

  setTrack(id: TrackId, force = false) {
    if (!force && this.track && this.track.def.id === id && this.world) return
    if (this.world) {
      this.scene.remove(this.world.group)
      this.world.dispose()
    }
    this.track = buildTrack(trackDef(id))
    this.profile = speedProfile(this.track)
    this.world = buildWorld(this.track, this.renderer, brakingPoints(this.track, this.profile.v))
    this.scene.add(this.world.group)
    this.scene.environment = this.world.env
    this.scene.environmentIntensity = 0.8
    this.scene.fog = this.world.fog
    this.renderer.toneMappingExposure = this.world.exposure
    this.settings.track = id
    // the mini-map
    const t = this.track
    const pad = 40
    this.mapBox = { x: t.minX - pad, z: t.minZ - pad, w: t.maxX - t.minX + 2 * pad, h: t.maxZ - t.minZ + 2 * pad }
    let d = ''
    for (let i = 0; i <= t.n; i += 6) {
      const k = i % t.n
      d += `${i ? 'L' : 'M'}${(t.x[k] - this.mapBox.x).toFixed(1)} ${(t.z[k] - this.mapBox.z).toFixed(1)}`
    }
    this.mapPath = d + 'Z'
    this.startDemo()
  }

  private startDemo() {
    this.demo = new Session({
      track: this.track, profile: this.profile.v, profileLap: this.profile.lapTime, kind: 'race', laps: 9999, minutes: 0,
      difficulty: 'hard', assists: true, playerName: 'Demo', demo: true, seed: 3,
    })
    // a few seconds in, so the cars are spread out
    for (let k = 0; k < 60 * 8; k++) this.demo.step(1 / 60)
  }

  startQualifying(s: GPSettings) {
    this.settings = { ...s }
    this.setSeries(s.series, s.classic)
    this.setTrack(s.track)
    this.session = new Session({
      track: this.track, profile: this.profile.v, profileLap: this.profile.lapTime, kind: 'qualifying', laps: s.laps, minutes: s.quali,
      difficulty: s.difficulty, assists: s.assists, playerName: s.name,
    })
    this.session.compound = 'soft'
    this.stage = 'qualifying'
    this.cam = this.cam === 'tv' ? 'chase' : this.cam
    this.snapCamera()
    this.onStage(this.stage)
  }

  /** Skip qualifying: the AI's times are made up, the player starts at the back. */
  skipQualifying(s: GPSettings) {
    this.settings = { ...s }
    this.setSeries(s.series, s.classic)
    this.setTrack(s.track)
    const q = new Session({
      track: this.track, profile: this.profile.v, profileLap: this.profile.lapTime, kind: 'qualifying', laps: s.laps, minutes: s.quali,
      difficulty: s.difficulty, assists: s.assists, playerName: s.name,
    })
    q.finishQuali()
    this.qualiResults = q.results()
    this.stage = 'qualiResults'
    this.onStage(this.stage)
  }

  /** End qualifying now (the pause card's button). */
  endQualifying() {
    if (this.session?.kind === 'qualifying') this.session.finishQuali()
  }

  startRace(compound: Compound) {
    const s = this.settings
    const grid = this.qualiResults.length ? this.qualiResults.map((r) => r.car) : [...Array(12).keys()].slice(1).concat(0)
    this.session = new Session({
      track: this.track, profile: this.profile.v, profileLap: this.profile.lapTime, kind: 'race', laps: s.laps, minutes: 0,
      difficulty: s.difficulty, assists: s.assists, playerName: s.name, grid, compound,
    })
    this.stage = 'race'
    this.lastLights = 0
    if (this.cam === 'tv') this.cam = 'chase'
    this.snapCamera()
    this.onStage(this.stage)
  }

  backToMenu() {
    this.session = null
    this.stage = 'menu'
    this.qualiResults = []
    this.raceResults = []
    this.onStage(this.stage)
  }

  // ---------------------------------------------------------------- input

  keyDown(code: string) {
    this.keys.add(code)
    const s = this.session
    if (code === 'KeyC') this.cycleCamera()
    if (!s) return
    if (code === 'KeyP') {
      s.boxRequest = !s.boxRequest
      if (s.boxRequest) s.event(`Box, box! ${COMPOUNDS[s.compound].name}s are ready`, 'info')
    }
    if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
      s.compound = (['soft', 'medium', 'hard'] as Compound[])[Number(code.slice(5)) - 1]
      if (s.player.pit === 'garage') s.player.tyres = newTyres(s.compound, true)
    }
    if (code === 'Space') this.toggleDrs()
    if (code === 'KeyR') this.resetCar()
    if ((code === 'Enter' || code === 'ArrowUp' || code === 'KeyW') && s.player.pit === 'garage') s.leaveGarage(s.player)
  }

  keyUp(code: string) {
    this.keys.delete(code)
  }

  releaseAll() {
    this.keys.clear()
  }

  cycleCamera() {
    this.cam = CAMS[(CAMS.indexOf(this.cam) + 1) % CAMS.length]
    this.snapCamera()
  }

  private toggleDrs() {
    const s = this.session
    if (!s) return
    const p = s.player
    if (s.drsOpen) s.drsOpen = false
    else if (p.drs && s.t.drs.some((z) => inRange(p.s, z[0], z[1], s.t.len))) s.drsOpen = true
  }

  /** Back on the track, stopped (it costs time). */
  private resetCar() {
    const s = this.session
    if (!s || s.player.pit !== 'none' || s.phase === 'lights') return
    const p = s.player
    const pt = pointAt(s.t, p.s, Math.max(-s.t.width / 2 + 2, Math.min(s.t.width / 2 - 2, p.lat * 0.3)))
    s.body.place(pt.x, pt.z, Math.atan2(pt.tz, pt.tx), 0)
    s.event('Car reset onto the track', 'info')
  }

  private readInput(dt: number) {
    const s = this.session
    if (!s) return
    const k = this.keys
    let steer = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0)
    const wantT = k.has('ArrowUp') || k.has('KeyW') ? 1 : 0
    const wantB = k.has('ArrowDown') || k.has('KeyS') ? 1 : 0
    this.thr += clamp(wantT - this.thr, -dt * 10, dt * 7)
    this.brk += clamp(wantB - this.brk, -dt * 10, dt * 9)
    let thr = this.thr
    let brk = this.brk
    let analog = false
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    const pad = pads && [...pads].find((p) => p && p.connected)
    if (pad) {
      const ax = pad.axes[0] ?? 0
      const rt = pad.buttons[7]?.value ?? 0
      const lt = pad.buttons[6]?.value ?? 0
      if (Math.abs(ax) > 0.08 || rt > 0.05 || lt > 0.05) {
        analog = Math.abs(ax) > 0.08 || analog
        if (Math.abs(ax) > 0.08) steer = Math.sign(ax) * Math.pow((Math.abs(ax) - 0.08) / 0.92, 1.4)
        thr = Math.max(thr, rt)
        brk = Math.max(brk, lt)
      }
      const pressed = (i: number) => !!pad.buttons[i]?.pressed
      const edge = (i: number) => pressed(i) && !this.padPrev[i]
      if (edge(3)) this.cycleCamera()
      if (edge(2)) this.keyDown('KeyP')
      if (edge(5)) this.toggleDrs()
      if (edge(0) && s.player.pit === 'garage') s.leaveGarage(s.player)
      if (edge(1)) this.resetCar()
      this.padPrev = pad.buttons.map((b) => b.pressed)
      if (thr > 0.3 && s.player.pit === 'garage') s.leaveGarage(s.player)
    }
    s.input = { throttle: thr, brake: brk, steer, analog }
  }

  // ---------------------------------------------------------------- the frame

  frame(dt: number, mode: 'live' | 'attract' | 'still') {
    dt = Math.min(dt, 0.05)
    if (mode === 'still') {
      this.render()
      this.audio?.quiet()
      return
    }
    this.time += dt
    const live = mode === 'live' && this.session
    const s = live ? this.session! : this.demo!
    if (live) this.readInput(dt)
    s.step(dt)
    this.drawCars(s, dt)
    this.drawCrews(s, dt)
    this.particles(s, dt)
    if (live) this.followCamera(s, dt)
    else this.attractCamera(s, dt)
    this.world!.update(dt, this.camLook, this.time)
    // the start lights
    const lights = s.phase === 'lights' ? s.lights : 0
    this.world!.startLights.forEach((m, i) => (m.emissiveIntensity = i < lights ? 6 : 0))
    if (live) {
      if (lights > this.lastLights) sfx('f1light', () => tone({ freq: 660, dur: 0.18, type: 'sine', vol: 0.18 }))
      if (this.lastLights === 5 && lights === 0 && s.phase === 'green') sfx('f1go', () => tone({ freq: 990, dur: 0.4, type: 'sine', vol: 0.2 }))
      this.lastLights = lights
      // the session is over
      if (s.phase === 'done' && s.time - s.doneAt > (s.kind === 'race' ? 0.2 : 1.2)) {
        if (s.kind === 'qualifying' && this.stage === 'qualifying') {
          this.qualiResults = s.results()
          this.stage = 'qualiResults'
          this.onStage(this.stage)
        } else if (s.kind === 'race' && this.stage === 'race') {
          this.raceResults = s.results()
          this.stage = 'raceResults'
          this.onStage(this.stage)
        }
      }
    }
    this.sound(s, !!live, dt)
    this.render()
  }

  private render() {
    this.renderer.render(this.scene, this.camera)
  }

  private drawCars(s: Session, dt: number) {
    const live = s === this.session
    s.cars.forEach((c, i) => {
      const m = this.models[i]
      m.root.position.set(c.x, c.y, c.z)
      m.root.rotation.y = -c.h
      // body pitch and roll from the car's accelerations
      let st = this.bodyPitch.get(i)
      if (!st) this.bodyPitch.set(i, (st = { p: 0, r: 0, v: c.speed }))
      let ax: number
      let ay: number
      if (c.player && live && c.pit === 'none') {
        ax = s.body.ax
        ay = s.body.ay
      } else {
        ax = (c.speed - st.v) / Math.max(dt, 1e-3)
        ay = c.speed * c.steer * 2
      }
      st.v = c.speed
      st.p += (clamp(-ax * 0.0016, -0.03, 0.03) - st.p) * Math.min(1, dt * 6)
      st.r += (clamp(ay * 0.0012, -0.03, 0.03) - st.r) * Math.min(1, dt * 6)
      const stopped = c.pit === 'stop'
      const jack = stopped && c.pitT > 0.25 && c.pitT < c.pitLen - 0.25 ? 0.05 : 0
      m.body.rotation.z = st.p
      m.body.rotation.x = st.r
      m.body.position.y = jack + (c.player && live && c.surface === 'kerb' ? Math.sin(this.time * 60) * 0.01 : 0)
      // wheels: steering, rolling, and off during the stop
      const off = stopped ? Math.max(0, Math.min(1, (c.pitT - 0.35) / 0.3) - Math.max(0, (c.pitT - (c.pitLen - 0.7)) / 0.35)) : 0
      for (const w of m.wheels) {
        if (w.front) w.pivot.rotation.y = -c.steer
        w.spin.rotation.z = -c.wheelRot
        w.pivot.position.set(w.base.x, w.base.y + jack, w.base.z + Math.sign(w.base.z) * off * 0.55)
      }
      m.setCompound(c.tyres.compound)
      // DRS flap, the rear light (it flashes on the limiter)
      const zone = s.t.drs.some((z) => inRange(c.s, z[0], z[1], s.t.len))
      const open = c.player && live ? s.drsOpen : c.drs && zone && c.pit === 'none'
      m.flap.rotation.z += ((open ? 0.02 : 0.5) - m.flap.rotation.z) * Math.min(1, dt * 12)
      const limiter = c.pit === 'in' || c.pit === 'out'
      m.light.emissiveIntensity = limiter ? (Math.floor(this.time * 6) % 2 ? 3 : 0.2) : 0.4
      m.root.visible = true
    })
  }

  /** Pit crews: lined up at the garage, around the car during a stop. */
  private crewPos = new Map<number, THREE.Vector3>()
  private crewMat = new THREE.Matrix4()
  private drawCrews(s: Session, dt: number) {
    const w = this.world!
    const t = s.t
    const p = t.pit
    const q = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    // where each crew member stands around a car in the box: local x forward, z right
    const SPOTS: [number, number, boolean][] = [
      [1.8, 1.45, true], [1.8, -1.45, true], [-1.8, 1.45, true], [-1.8, -1.45, true],
      [2.5, 1.9, false], [2.5, -1.9, false], [-2.6, 1.9, false], [-2.6, -1.9, false],
      [3.7, 0, false], [-3.2, 0, false], [0.3, 1.5, false], [0.3, -1.5, false],
    ]
    TEAMS.forEach((_, k) => {
      const box = p.boxes[k]
      const busy = s.cars.find((c) => c.team === k && (c.pit === 'stop' || (c.pit === 'in' && wrap(box - c.s, t.len) < 120) || (c.pit === 'out' && c.pitT < 1.2)))
      const bp = pointAt(t, box, p.side * p.boxOff)
      const h = Math.atan2(bp.tz, bp.tx)
      const fx = Math.cos(h)
      const fz = Math.sin(h)
      for (let j = 0; j < 12; j++) {
        const id = k * 12 + j
        let tx: number
        let tz: number
        let kneel = false
        let face = h
        if (busy) {
          const [lx, lz, kn] = SPOTS[j]
          tx = bp.x + fx * lx - fz * lz
          tz = bp.z + fz * lx + fx * lz
          kneel = kn && busy.pit === 'stop'
          face = Math.atan2(bp.z - tz, bp.x - tx)
        } else {
          const gp = pointAt(t, box - 5.5 + j, p.side * (p.garageOff + 1.2 + (j % 2) * 0.8))
          tx = gp.x
          tz = gp.z
          face = h + (p.side > 0 ? -Math.PI / 2 : Math.PI / 2)
        }
        let cur = this.crewPos.get(id)
        if (!cur) this.crewPos.set(id, (cur = new THREE.Vector3(tx, 0, tz)))
        const f = Math.min(1, dt * (busy ? 5 : 2))
        cur.x += (tx - cur.x) * f
        cur.z += (tz - cur.z) * f
        q.setFromAxisAngle(up, -face)
        scl.set(1, kneel ? 0.62 : 1, 1)
        this.crewMat.compose(new THREE.Vector3(cur.x, bp.y, cur.z), q, scl)
        w.crewBodies.setMatrixAt(id, this.crewMat)
        w.crewHeads.setMatrixAt(id, this.crewMat)
      }
    })
    w.crewBodies.instanceMatrix.needsUpdate = true
    w.crewHeads.instanceMatrix.needsUpdate = true
  }

  private particles(s: Session, dt: number) {
    const live = s === this.session
    if (live && s.player.pit === 'none') {
      const b = s.body
      const p = s.player
      const off = p.surface === 'gravel' || p.surface === 'grass'
      const amount = (b.slide + b.lock + b.spin) * (b.speed > 6 ? 1 : 0) + (off && b.speed > 8 ? 0.8 : 0)
      if (amount > 0.25 && Math.random() < amount) {
        const free = this.smoke.find((q) => q.life <= 0)
        if (free) {
          const back = b.lock > 0.3 ? 1.8 : -1.8
          free.s.material = off ? (p.surface === 'gravel' ? this.smokeMats.dust : this.smokeMats.grass) : this.smokeMats.smoke
          free.s.position.set(b.x + Math.cos(b.h) * back + (Math.random() - 0.5), p.y + 0.4, b.z + Math.sin(b.h) * back + (Math.random() - 0.5))
          free.v.set((Math.random() - 0.5) * 2 + Math.cos(b.h) * b.vx * 0.15, 0.8 + Math.random(), (Math.random() - 0.5) * 2 + Math.sin(b.h) * b.vx * 0.15)
          free.max = free.life = 1.4 + Math.random()
          free.s.visible = true
        }
      }
    }
    for (const q of this.smoke) {
      if (q.life <= 0) continue
      q.life -= dt
      q.s.position.addScaledVector(q.v, dt)
      q.v.multiplyScalar(1 - dt * 0.8)
      const age = 1 - q.life / q.max
      const sz = 1 + age * 5
      q.s.scale.set(sz, sz, 1)
      q.s.material.opacity = 0.5 * (1 - age)
      if (q.life <= 0) q.s.visible = false
    }
  }

  // ---------------------------------------------------------------- cameras

  private snapCamera() {
    this.camYaw = NaN
  }

  private followCamera(s: Session, dt: number) {
    const p = s.player
    const m = this.models[0]
    const fwd = new THREE.Vector3(Math.cos(p.h), 0, Math.sin(p.h))
    const cam = this.camera
    this.shake = Math.max(this.shake * Math.exp(-dt * 6), p.hit * 0.6, p.surface === 'kerb' && p.speed > 15 ? 0.06 : 0, p.surface === 'gravel' && p.speed > 5 ? 0.12 : 0)
    const jitter = () => (Math.random() - 0.5) * this.shake * 0.25
    if (this.cam === 'chase' || p.pit === 'garage' || p.pit === 'toGarage' || p.pit === 'fromGarage') {
      if (isNaN(this.camYaw)) this.camYaw = p.h
      let dy = p.h - this.camYaw
      while (dy > Math.PI) dy -= Math.PI * 2
      while (dy < -Math.PI) dy += Math.PI * 2
      this.camYaw += dy * Math.min(1, dt * 5)
      const back = p.pit === 'garage' ? 9 : 7.4
      const want = new THREE.Vector3(p.x - Math.cos(this.camYaw) * back, p.y + 2.3, p.z - Math.sin(this.camYaw) * back)
      if (p.pit === 'garage') {
        // in the garage: from the pit lane, looking in
        const t = s.t
        const gp = pointAt(t, p.s - 4, t.pit.side * t.pit.laneOff)
        want.set(gp.x, gp.y + 2.4, gp.z)
      }
      this.camPos.lerp(want, isNaN(dy) ? 1 : Math.min(1, dt * 9))
      if (this.camPos.distanceTo(want) > 30) this.camPos.copy(want)
      cam.position.copy(this.camPos)
      cam.position.x += jitter()
      cam.position.y += jitter()
      this.camLook.set(p.x + Math.cos(this.camYaw) * 3.5, p.y + 0.9, p.z + Math.sin(this.camYaw) * 3.5)
      if (p.pit === 'garage') this.camLook.set(p.x, p.y + 0.6, p.z)
      cam.lookAt(this.camLook)
      cam.fov = 60 + clamp(p.speed * 0.09, 0, 9)
    } else if (this.cam === 'tcam' || this.cam === 'cockpit') {
      const cc = SERIES === 'classic' && TEAMS[0].model ? classicCams(TEAMS[0].model) : null
      const local = cc ? (this.cam === 'tcam' ? cc.roof.clone() : cc.eye.clone()) : this.cam === 'tcam' ? new THREE.Vector3(0.12, 1.13, 0) : new THREE.Vector3(0.62, 0.84, 0)
      m.root.updateMatrixWorld()
      const at = local.applyMatrix4(m.body.matrixWorld)
      cam.position.copy(at)
      cam.position.y += jitter() * 0.4
      this.camLook.copy(at).addScaledVector(fwd, 20)
      this.camLook.y += this.cam === 'tcam' ? -1.3 : -1.0
      cam.lookAt(this.camLook)
      cam.fov = this.cam === 'tcam' ? 68 : 74
    } else {
      // trackside TV: the camera nearest the car, zoomed in
      const tv = this.world!.tvCams
      let best = this.tvIdx
      let bd = Infinity
      for (let k = 0; k < tv.length; k++) {
        const d = Math.hypot(tv[k].x - p.x, tv[k].z - p.z)
        if (d < bd) {
          bd = d
          best = k
        }
      }
      this.tvIdx = best
      cam.position.copy(tv[best])
      this.camLook.set(p.x, p.y + 0.6, p.z)
      cam.lookAt(this.camLook)
      const d = cam.position.distanceTo(this.camLook)
      cam.fov = clamp((2 * Math.atan(9 / d) * 180) / Math.PI, 6, 55)
    }
    cam.updateProjectionMatrix()
  }

  private attractCamera(s: Session, dt: number) {
    this.attractT += dt
    const cam = this.camera
    const shot = Math.floor(this.attractT / 9) % 4
    const t = s.t
    const p = t.pit
    if (shot === 0) {
      // the trucks and the garages
      const a = this.attractT * 0.12
      const c = pointAt(t, p.boxes[0] - 4, p.side * (p.garageOff + 22))
      cam.position.set(c.x + Math.cos(a) * 34, c.y + 9 + Math.sin(a * 0.7) * 2, c.z + Math.sin(a) * 34)
      this.camLook.set(c.x, c.y + 2.5, c.z)
      cam.fov = 50
    } else {
      // a car on its way round, from the trackside cameras
      if (Math.floor((this.attractT - dt) / 9) !== Math.floor(this.attractT / 9)) this.attractCar = (this.attractCar + 5) % s.cars.length
      const c = s.cars[this.attractCar]
      if (shot === 2) {
        // low chase
        const want = new THREE.Vector3(c.x - Math.cos(c.h) * 9, c.y + 1.4, c.z - Math.sin(c.h) * 9)
        this.camPos.lerp(want, Math.min(1, dt * 4))
        if (this.camPos.distanceTo(want) > 40) this.camPos.copy(want)
        cam.position.copy(this.camPos)
        this.camLook.set(c.x, c.y + 0.7, c.z)
        cam.fov = 55
      } else {
        const tv = this.world!.tvCams
        let best = 0
        let bd = Infinity
        for (let k = 0; k < tv.length; k++) {
          const d = Math.hypot(tv[k].x - c.x, tv[k].z - c.z)
          if (d < bd) {
            bd = d
            best = k
          }
        }
        cam.position.copy(tv[best])
        this.camLook.set(c.x, c.y + 0.6, c.z)
        const d = cam.position.distanceTo(this.camLook)
        cam.fov = clamp((2 * Math.atan(10 / d) * 180) / Math.PI, 7, 50)
      }
    }
    cam.lookAt(this.camLook)
    cam.updateProjectionMatrix()
  }

  // ---------------------------------------------------------------- sound

  private sound(s: Session, live: boolean, dt: number) {
    const out = audioOut()
    if (!out) {
      this.audio = null
      return
    }
    if (!this.audio || this.audio.ac !== out.ac) this.audio = new EngineAudio(out.ac, out.dest)
    const a = this.audio
    const cam = this.camera.position
    // the nearest other car going by
    let near: RaceCar | null = null
    let nd = Infinity
    for (const c of s.cars) {
      if (live && c.player) continue
      const d = Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z)
      if (d < nd) {
        nd = d
        near = c
      }
    }
    if (live) {
      const p = s.player
      const b = s.body
      const onboard = this.cam !== 'tv'
      a.engine(p.rpm, p.pit === 'none' ? s.input.throttle : 0.3, onboard ? (this.cam === 'chase' ? 0.8 : 1) : 0.25)
      a.tyres(p.pit === 'none' ? clamp(b.slide * 1.4 + b.lock + b.spin * 0.8, 0, 1) * (b.speed > 5 ? 1 : 0) : 0)
      a.wind(p.speed)
      a.rumble(p.surface === 'kerb' && p.speed > 8 ? 1 : p.surface === 'gravel' && p.speed > 3 ? 0.8 : 0)
      if (p.gear !== this.prevGear) {
        if (p.gear > this.prevGear) sfx('f1shift', () => noise({ dur: 0.05, freq: 2500, vol: 0.08, filter: 'bandpass' }))
        this.prevGear = p.gear
      }
      if (p.hit > 0.15 && this.time - this.lastHit > 0.4) {
        this.lastHit = this.time
        noise({ dur: 0.35, freq: 300, to: 80, vol: 0.4 * p.hit + 0.1, filter: 'lowpass' })
      }
    } else {
      a.engine(0, 0, 0)
      a.tyres(0)
      a.wind(0)
      a.rumble(0)
    }
    if (near) {
      const rel = new THREE.Vector3(near.x - cam.x, 0, near.z - cam.z)
      const dist = Math.max(1, rel.length())
      rel.normalize()
      const vr = Math.cos(near.h) * near.speed * rel.x + Math.sin(near.h) * near.speed * rel.z
      a.other(near.rpm * (1 - clamp(vr / 343, -0.3, 0.3)), clamp(0.5 / Math.pow(1 + dist / 10, 1.3), 0, 0.5))
    } else a.other(0, 0)
    a.crowd(this.stage === 'menu' || live ? 0.025 : 0)
    void dt
  }

  // ---------------------------------------------------------------- the HUD

  snapshot(): GPHud | null {
    const s = this.session
    if (!s) return null
    const p = s.player
    const ord = s.order()
    const pos = ord.indexOf(p) + 1
    const t = s.t
    const near = locate(t, p.x, p.z, p.hint)
    const fwd = Math.cos(p.h) * t.tx[near.i] + Math.sin(p.h) * t.tz[near.i]
    const tower: TowerRow[] = ord.map((c, k) => ({
      pos: k + 1,
      code: c.driver.code,
      color: TEAMS[c.team].color2,
      gap: s.gapText(c),
      tyre: c.tyres.compound,
      pit: c.pit !== 'none',
      player: c.player,
      best: fmtLap(c.bestLap),
    }))
    const last = s.events[s.events.length - 1] ?? null
    return {
      stage: this.stage,
      kind: s.kind,
      phase: s.phase,
      lights: s.lights,
      remaining: Math.max(0, s.duration - s.time),
      overtime: s.overtime,
      lap: Math.min(s.laps, Math.max(1, p.laps + 1)),
      laps: s.laps,
      position: pos,
      cars: s.cars.length,
      speed: Math.round(p.speed * 3.6),
      gear: p.gear,
      rpm: p.rpm,
      throttle: s.input.throttle,
      brake: s.input.brake,
      lapTime: s.phase === 'lights' || !p.lapTimed && s.kind === 'qualifying' ? 0 : Math.max(0, s.time - p.lapStart),
      lastLap: p.lastLap,
      bestLap: p.bestLap,
      sessionBest: s.bestLap.time,
      sectors: s.sectorColors.slice(),
      tyre: p.tyres.compound,
      wear: p.tyres.wear,
      temp: p.tyres.temp,
      grip: tyreGrip(p.tyres),
      compound: s.compound,
      pit: p.pit,
      pitT: p.pitT,
      pitLen: p.pitLen,
      boxRequest: s.boxRequest,
      limiter: p.pit === 'in' || p.pit === 'out',
      drsAvailable: p.drs && t.drs.some((z) => inRange(p.s, z[0], z[1], t.len)) && p.pit === 'none',
      drsOpen: s.drsOpen,
      tower,
      dots: s.cars.map((c) => ({ x: c.x - this.mapBox.x, z: c.z - this.mapBox.z, color: TEAMS[c.team].color2, player: c.player })),
      message: last && s.time - last.t < 4 && s.events.length > 0 ? last : null,
      camera: this.cam,
      wrongWay: p.pit === 'none' && p.speed > 4 && fwd < -0.3,
      offTrack: p.surface === 'grass' || p.surface === 'gravel',
      mustChange: s.mustChange,
      changed: p.used.length >= 2,
      lapValid: p.lapValid,
      penalty: p.penalty,
      trackName: t.def.name,
    }
  }

  /** For the AI tools: the difficulty's name. */
  get difficultyName() {
    return DIFFICULTY[this.settings.difficulty].name
  }

  // ---------------------------------------------------------------- window

  resize(w: number, h: number, dpr: number) {
    this.renderer.setPixelRatio(Math.min(dpr, 1.75))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
  }

  dispose() {
    this.audio?.stop()
    this.audio = null
    if (this.world) {
      this.scene.remove(this.world.group)
      this.world.dispose()
    }
    for (const m of this.models) m.dispose()
    for (const g of this.geo.parts.values()) g.dispose()
    this.geo.tyreF.dispose()
    this.geo.tyreR.dispose()
    this.geo.rim.dispose()
    this.geo.cover.dispose()
    this.geo.drsFlap.dispose()
    for (const l of this.looks) for (const m of Object.values(l)) {
      ;(m as THREE.MeshStandardMaterial).map?.dispose()
      ;(m as THREE.Material).dispose()
    }
    for (const m of Object.values(this.shared)) {
      if (m instanceof THREE.Material) m.dispose()
    }
    for (const m of Object.values(this.shared.tyre)) {
      m.map?.dispose()
      m.dispose()
    }
    this.smokeTex.dispose()
    for (const m of Object.values(this.smokeMats)) m.dispose()
    this.renderer.dispose()
  }
}

// ---------------------------------------------------------------- engine sound

class EngineAudio {
  readonly ac: AudioContext
  private nodes: AudioNode[] = []
  private srcs: (OscillatorNode | AudioBufferSourceNode)[] = []
  private eng: { o1: OscillatorNode; o2: OscillatorNode; o3: OscillatorNode; f: BiquadFilterNode; g: GainNode }
  private oth: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode }
  private tyreG: GainNode
  private windG: GainNode
  private windF: BiquadFilterNode
  private rumbleG: GainNode
  private crowdG: GainNode

  constructor(ac: AudioContext, dest: AudioNode) {
    this.ac = ac
    const len = ac.sampleRate
    const buf = ac.createBuffer(1, len, ac.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const noiseSrc = () => {
      const s = ac.createBufferSource()
      s.buffer = buf
      s.loop = true
      s.start(0, Math.random())
      this.srcs.push(s)
      return s
    }
    const osc = (type: OscillatorType) => {
      const o = ac.createOscillator()
      o.type = type
      o.start()
      this.srcs.push(o)
      return o
    }
    const gain = (v: number) => {
      const g = ac.createGain()
      g.gain.value = v
      this.nodes.push(g)
      return g
    }
    const filt = (type: BiquadFilterType, f: number, q = 1) => {
      const n = ac.createBiquadFilter()
      n.type = type
      n.frequency.value = f
      n.Q.value = q
      this.nodes.push(n)
      return n
    }
    // the player's engine: three oscillators through a filter
    {
      const o1 = osc('sawtooth')
      const o2 = osc('square')
      const o3 = osc('sawtooth')
      const m2 = gain(0.35)
      const m3 = gain(0.18)
      const f = filt('lowpass', 1500, 2)
      const g = gain(0)
      o1.connect(f)
      o2.connect(m2).connect(f)
      o3.connect(m3).connect(f)
      f.connect(g).connect(dest)
      this.eng = { o1, o2, o3, f, g }
    }
    {
      const o1 = osc('sawtooth')
      const o2 = osc('square')
      const m2 = gain(0.3)
      const f = filt('lowpass', 2200, 1.5)
      const g = gain(0)
      o1.connect(f)
      o2.connect(m2).connect(f)
      f.connect(g).connect(dest)
      this.oth = { o1, o2, f, g }
    }
    {
      const f = filt('bandpass', 1900, 7)
      this.tyreG = gain(0)
      noiseSrc().connect(f).connect(this.tyreG).connect(dest)
    }
    {
      this.windF = filt('lowpass', 400, 0.7)
      this.windG = gain(0)
      noiseSrc().connect(this.windF).connect(this.windG).connect(dest)
    }
    {
      const f = filt('lowpass', 140, 1)
      this.rumbleG = gain(0)
      noiseSrc().connect(f).connect(this.rumbleG).connect(dest)
    }
    {
      const f = filt('bandpass', 1100, 0.5)
      this.crowdG = gain(0)
      noiseSrc().connect(f).connect(this.crowdG).connect(dest)
    }
  }

  private set(p: AudioParam, v: number, tc = 0.04) {
    p.setTargetAtTime(v, this.ac.currentTime, tc)
  }

  engine(rpm: number, throttle: number, vol: number) {
    const f0 = Math.max(30, rpm / 20)
    this.set(this.eng.o1.frequency, f0, 0.02)
    this.set(this.eng.o2.frequency, f0 / 2, 0.02)
    this.set(this.eng.o3.frequency, f0 * 1.5, 0.02)
    this.set(this.eng.f.frequency, 700 + throttle * 2600 + rpm * 0.08)
    this.set(this.eng.g.gain, vol * (0.06 + throttle * 0.07))
  }

  other(rpm: number, vol: number) {
    const f0 = Math.max(30, rpm / 20)
    this.set(this.oth.o1.frequency, f0, 0.03)
    this.set(this.oth.o2.frequency, f0 / 2, 0.03)
    this.set(this.oth.g.gain, vol * 0.18, 0.06)
  }

  tyres(v: number) {
    this.set(this.tyreG.gain, v * 0.12, 0.05)
  }

  wind(speed: number) {
    this.set(this.windG.gain, Math.min(0.12, speed * 0.0013), 0.1)
    this.set(this.windF.frequency, 250 + speed * 8, 0.1)
  }

  rumble(v: number) {
    this.set(this.rumbleG.gain, v * 0.25, 0.03)
  }

  crowd(v: number) {
    this.set(this.crowdG.gain, v, 0.3)
  }

  quiet() {
    for (const g of [this.eng.g, this.oth.g, this.tyreG, this.windG, this.rumbleG, this.crowdG]) this.set(g.gain, 0, 0.05)
  }

  stop() {
    for (const s of this.srcs) {
      try {
        s.stop()
      } catch {
        // already stopped
      }
      s.disconnect()
    }
    for (const n of this.nodes) n.disconnect()
  }
}
