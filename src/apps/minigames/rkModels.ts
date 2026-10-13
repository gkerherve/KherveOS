// Animated monster and character models (Quaternius, CC0 1.0: public/models/quaternius,
// see the README there for every file and its source). Each game role has
// several variants; a monster takes one at random. Models are loaded once,
// then each monster gets its own copy (SkeletonUtils.clone) with its own
// materials (tinted by the light where it stands, flashed when hit, a little
// colour variation per spawn, glowing eyes), a contact shadow, an
// AnimationMixer, and the clips the game needs found by name across the
// different rigs: idle, walk, run, attack, shoot, leap, hit, death.

import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

export type ModelKind = 'grunt' | 'knight' | 'brute' | 'ravager' | 'hound' | 'wraith' | 'zombie'
export type Move = 'idle' | 'walk' | 'run' | 'attack' | 'shoot' | 'leap' | 'hit' | 'death'

interface Variant {
  file: string
  /** Height in metres, feet to top of head. */
  height: number
  /** A weapon for the right hand (rigs with a Wrist.R bone). */
  weapon?: 'shotgun' | 'sword'
  /** Clips to prefer for some moves (otherwise CLIP_NAMES decides). */
  prefer?: Partial<Record<Move, string[]>>
}

const VARIANTS: Record<ModelKind, Variant[]> = {
  grunt: [{ file: 'soldier', height: 1.8, weapon: 'shotgun' }],
  knight: [
    { file: 'king', height: 1.9, weapon: 'sword' },
    { file: 'skeleton', height: 1.85 },
    { file: 'orc', height: 1.95, prefer: { attack: ['Weapon', 'Punch'] } },
  ],
  brute: [
    { file: 'giant', height: 2.5 },
    { file: 'yeti', height: 2.4 },
    { file: 'enemy-large', height: 2.3, prefer: { attack: ['Weapon', 'Punch'] } },
  ],
  ravager: [
    { file: 'demon', height: 2.2 },
    { file: 'blue-demon', height: 2.2, prefer: { run: ['Run2', 'Run'] } },
  ],
  hound: [
    { file: 'wolf', height: 1.05 },
    { file: 'goblin', height: 1.2 },
  ],
  wraith: [
    { file: 'ghost', height: 1.7 },
    { file: 'ghost-skull', height: 1.5 },
    { file: 'dragon', height: 1.9 },
    { file: 'winged-demon', height: 1.8 },
  ],
  zombie: [
    { file: 'zombie', height: 1.8, prefer: { run: ['Run_Arms', 'Run'], attack: ['Punch', 'Idle_Attack'] } },
    { file: 'zombie2', height: 1.8 },
  ],
}

/** For each move, the clip names the various rigs use, best first. */
const CLIP_NAMES: Record<Move, string[]> = {
  idle: ['Idle_Gun', 'Idle_Sword', 'Idle', 'Flying_Idle', 'Skeleton_Idle'],
  walk: ['Walk', 'Fast_Flying', 'Skeleton_Running', 'Run'],
  run: ['Run_Shoot', 'Run', 'Gallop', 'Fast_Flying', 'Skeleton_Running', 'Walk'],
  attack: ['Sword_Slash', 'Attack', 'Bite_Front', 'Headbutt', 'Punch', 'Weapon', 'Skeleton_Attack'],
  shoot: ['Gun_Shoot', 'Punch', 'Weapon', 'Attack', 'Headbutt', 'Bite_Front', 'Skeleton_Attack'],
  leap: ['Gallop_Jump', 'Jump', 'Roll', 'Fast_Flying'],
  hit: ['HitRecieve', 'HitReact', 'Idle_HitReact_Left'],
  death: ['Death', 'Skeleton_Death'],
}

interface Loaded {
  gltf: GLTF
  scale: number
  lift: number
  radius: number
  clips: Map<string, THREE.AnimationClip>
}

const cache = new Map<string, Loaded>()
const pending = new Map<string, Promise<void>>()

/** Clip names come as "CharacterArmature|Walk", sometimes repeated: keep the last part. */
const short = (name: string) => name.split('|').pop() ?? name

export function loadModels(kinds: ModelKind[]): Promise<void> {
  const loader = new GLTFLoader()
  const variants = kinds.flatMap((k) => VARIANTS[k])
  return Promise.all(
    variants.map((v) => {
      if (cache.has(v.file)) return Promise.resolve()
      let p = pending.get(v.file)
      if (!p) {
        p = loader.loadAsync(`/models/quaternius/${v.file}.glb`).then((gltf) => {
          gltf.scene.updateMatrixWorld(true)
          const box = new THREE.Box3().setFromObject(gltf.scene)
          const size = Math.max(0.01, box.max.y - box.min.y)
          const scale = v.height / size
          const clips = new Map<string, THREE.AnimationClip>()
          for (const c of gltf.animations) clips.set(short(c.name), c)
          const radius = (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * scale) / 2
          cache.set(v.file, { gltf, scale, lift: -box.min.y * scale, radius, clips })
        })
        pending.set(v.file, p)
      }
      return p
    }),
  ).then(() => undefined)
}

export const hasModel = (k: string): k is ModelKind => k in VARIANTS && VARIANTS[k as ModelKind].some((v) => cache.has(v.file))

export interface ModelInstance {
  root: THREE.Group
  mixer: THREE.AnimationMixer
  mats: THREE.MeshStandardMaterial[]
  meshes: THREE.Mesh[]
  /** Which file this one is (for variety-aware tuning). */
  variant: string
  height: number
  /** Play a move (cross-fades; one-shot moves hold their last frame). `seconds` stretches a one-shot to that length. */
  play(move: Move, seconds?: number): void
  /** Walk/run cadence to match the speed. */
  pace(k: number): void
  current: Move | null
}

const ONCE: Move[] = ['attack', 'shoot', 'leap', 'hit', 'death']

let shadowTex: THREE.CanvasTexture | null = null
function contactShadow(radius: number): THREE.Mesh {
  if (!shadowTex) {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')!
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    gr.addColorStop(0, 'rgba(0,0,0,0.6)')
    gr.addColorStop(0.55, 'rgba(0,0,0,0.3)')
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, 128, 128)
    shadowTex = new THREE.CanvasTexture(c)
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
  m.rotation.x = -Math.PI / 2
  m.position.y = 0.02
  m.scale.setScalar(Math.max(0.7, radius * 2.4))
  m.renderOrder = -1
  return m
}

export function instanceModel(kind: ModelKind): ModelInstance {
  const options = VARIANTS[kind].filter((v) => cache.has(v.file))
  const v = options[Math.floor(Math.random() * options.length)]
  const L = cache.get(v.file)!
  const root = new THREE.Group()
  const inner = cloneSkinned(L.gltf.scene) as THREE.Group
  inner.scale.setScalar(L.scale)
  inner.position.y = L.lift
  root.add(inner)
  root.add(contactShadow(L.radius))
  // a little variety: brightness and a slight hue shift per monster
  const shift = (Math.random() - 0.5) * 0.06
  const bright = 0.9 + Math.random() * 0.2
  const mats: THREE.MeshStandardMaterial[] = []
  const meshes: THREE.Mesh[] = []
  const own = new Map<THREE.Material, THREE.MeshStandardMaterial>()
  inner.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.frustumCulled = false
    const swap = (mat: THREE.Material) => {
      let c = own.get(mat)
      if (!c) {
        c = (mat as THREE.MeshStandardMaterial).clone()
        const name = mat.name.toLowerCase()
        const eye = /^eye(_black)?$|pupil|iris/.test(name)
        if (eye && kind !== 'grunt') {
          // monsters' eyes glow in the dark
          c.emissive = new THREE.Color(kind === 'wraith' ? 0x60a0ff : 0xff3010)
          c.emissiveIntensity = 2.5
          c.userData.glow = true
        } else c.userData.glow = false
        c.color.offsetHSL(shift, 0, 0).multiplyScalar(bright)
        c.roughness = Math.min(1, Math.max(0.35, c.roughness))
        c.userData.base = c.color.clone()
        own.set(mat, c)
        mats.push(c)
      }
      return c
    }
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material)
    meshes.push(m)
  })
  const wrist = v.weapon && inner.getObjectByName('Wrist.R')
  if (wrist && v.weapon) {
    const w = v.weapon === 'shotgun' ? shotgun(mats) : sword(mats)
    // the bone lives inside the scaled model: undo the scale so the weapon keeps real sizes
    w.scale.setScalar(1 / L.scale)
    wrist.add(w)
  }
  const mixer = new THREE.AnimationMixer(inner)
  const actions = new Map<Move, THREE.AnimationAction>()
  for (const move of Object.keys(CLIP_NAMES) as Move[]) {
    const names = [...(v.prefer?.[move] ?? []), ...CLIP_NAMES[move]]
    const clip = names.map((n) => L.clips.get(n)).find(Boolean)
    if (!clip) continue
    const a = mixer.clipAction(clip)
    if (ONCE.includes(move)) {
      a.setLoop(THREE.LoopOnce, 1)
      a.clampWhenFinished = true
    }
    actions.set(move, a)
  }
  const inst: ModelInstance = {
    root,
    mixer,
    mats,
    meshes,
    variant: v.file,
    height: v.height,
    current: null,
    play(move, seconds) {
      const next = actions.get(move) ?? actions.get('idle')
      if (!next) return
      const prev = inst.current ? actions.get(inst.current) : undefined
      // a one-shot asked again after it finished starts over (the next attack); death never repeats
      const again = ONCE.includes(move) && move !== 'death' && seconds !== undefined && !next.isRunning()
      if (inst.current === move && !again) return
      inst.current = move
      next.reset()
      next.timeScale = 1
      if (seconds && ONCE.includes(move)) next.setDuration(seconds)
      next.enabled = true
      next.setEffectiveWeight(1)
      next.play()
      if (prev && prev !== next) prev.crossFadeTo(next, move === 'death' ? 0.1 : 0.18, false)
    },
    pace(k) {
      if (inst.current !== 'walk' && inst.current !== 'run') return
      const a = actions.get(inst.current)
      if (a) a.timeScale = THREE.MathUtils.clamp(k, 0.5, 1.8)
    },
  }
  inst.play('idle')
  mixer.update(Math.random() * 2) // so a group doesn't breathe in step
  return inst
}

// ---------------------------------------------------------------- hand weapons

function M(mats: THREE.MeshStandardMaterial[], o: THREE.MeshStandardMaterialParameters) {
  const m = new THREE.MeshStandardMaterial(o)
  m.userData.base = m.color.clone()
  m.userData.glow = false
  mats.push(m)
  return m
}

function piece(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, p: [number, number, number], r: [number, number, number] = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geo, m)
  mesh.position.set(...p)
  mesh.rotation.set(...r)
  mesh.frustumCulled = false
  g.add(mesh)
  return mesh
}

function shotgun(mats: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group()
  const steel = M(mats, { color: 0x2c2e30, roughness: 0.4, metalness: 0.8 })
  const wood = M(mats, { color: 0x5a3a20, roughness: 0.6 })
  piece(g, new THREE.BoxGeometry(0.05, 0.07, 0.22), steel, [0, 0, 0.04])
  piece(g, new THREE.CylinderGeometry(0.013, 0.013, 0.5, 12), steel, [0, 0.025, 0.38], [Math.PI / 2, 0, 0])
  piece(g, new THREE.CylinderGeometry(0.012, 0.012, 0.36, 10), steel, [0, -0.008, 0.32], [Math.PI / 2, 0, 0])
  piece(g, new THREE.CylinderGeometry(0.023, 0.023, 0.13, 12), wood, [0, -0.008, 0.28], [Math.PI / 2, 0, 0])
  piece(g, new THREE.BoxGeometry(0.04, 0.07, 0.26), wood, [0, -0.025, -0.18], [0.15, 0, 0])
  piece(g, new THREE.BoxGeometry(0.035, 0.09, 0.04), wood, [0, -0.06, 0.0], [0.4, 0, 0])
  const holder = new THREE.Group()
  holder.add(g)
  g.rotation.x = -Math.PI / 2
  g.position.set(0, 0.06, 0.02)
  return holder
}

function sword(mats: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group()
  const blade = M(mats, { color: 0xd8dce0, roughness: 0.2, metalness: 1 })
  const gold = M(mats, { color: 0xb8902a, roughness: 0.35, metalness: 0.9 })
  piece(g, new THREE.BoxGeometry(0.05, 0.85, 0.01), blade, [0, 0.55, 0])
  piece(g, new THREE.ConeGeometry(0.025, 0.08, 4), blade, [0, 1.01, 0], [0, Math.PI / 4, 0])
  piece(g, new THREE.BoxGeometry(0.24, 0.03, 0.035), gold, [0, 0.11, 0])
  piece(g, new THREE.CylinderGeometry(0.017, 0.017, 0.16, 10), M(mats, { color: 0x3a2414, roughness: 0.8 }), [0, 0.02, 0])
  piece(g, new THREE.SphereGeometry(0.028, 12, 10), gold, [0, -0.07, 0])
  const holder = new THREE.Group()
  holder.add(g)
  g.position.set(0, 0.05, 0.03)
  g.rotation.x = Math.PI / 2
  return holder
}
