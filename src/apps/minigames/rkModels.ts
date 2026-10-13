// Animated character models (Quaternius, CC0 1.0: public/models/quaternius,
// see the README there). Loaded once, then each monster gets its own copy
// (SkeletonUtils.clone) with its own materials (tinted by the light where it
// stands, flashed when hit), an AnimationMixer, and named clips mapped to what
// the game needs: idle, walk, run, attack, shoot, leap, hit, death.
// The soldier and the king get a weapon in their right hand.

import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

export type ModelKind = 'grunt' | 'knight' | 'brute' | 'ravager' | 'hound' | 'wraith' | 'zombie'
export type Move = 'idle' | 'walk' | 'run' | 'attack' | 'shoot' | 'leap' | 'hit' | 'death'

interface Spec {
  file: string
  /** Height in metres, feet to top of head. */
  height: number
  clips: Partial<Record<Move, string>>
}

const SPECS: Record<ModelKind, Spec> = {
  grunt: { file: 'soldier', height: 1.8, clips: { idle: 'Idle_Gun', walk: 'Walk', run: 'Run_Shoot', attack: 'Gun_Shoot', shoot: 'Gun_Shoot', leap: 'Roll', hit: 'HitRecieve', death: 'Death' } },
  knight: { file: 'king', height: 1.9, clips: { idle: 'Idle_Sword', walk: 'Walk', run: 'Run', attack: 'Sword_Slash', shoot: 'Sword_Slash', leap: 'Roll', hit: 'HitRecieve', death: 'Death' } },
  brute: { file: 'giant', height: 2.4, clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Attack', shoot: 'Attack', leap: 'Jump', hit: 'HitRecieve', death: 'Death' } },
  ravager: { file: 'demon', height: 2.2, clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Attack', shoot: 'Attack', leap: 'Jump', hit: 'HitRecieve', death: 'Death' } },
  hound: { file: 'wolf', height: 1.05, clips: { idle: 'Idle', walk: 'Walk', run: 'Gallop', attack: 'Attack', shoot: 'Attack', leap: 'Gallop_Jump', hit: 'Idle_HitReact_Left', death: 'Death' } },
  wraith: { file: 'ghost', height: 1.7, clips: { idle: 'Flying_Idle', walk: 'Fast_Flying', run: 'Fast_Flying', attack: 'Headbutt', shoot: 'Punch', leap: 'Fast_Flying', hit: 'HitReact', death: 'Death' } },
  zombie: { file: 'zombie', height: 1.8, clips: { idle: 'Idle', walk: 'Walk', run: 'Run_Arms', attack: 'Punch', shoot: 'Punch', leap: 'Jump', hit: 'HitReact', death: 'Death' } },
}

interface Loaded {
  gltf: GLTF
  scale: number
  lift: number
  clips: Map<string, THREE.AnimationClip>
}

const cache = new Map<ModelKind, Loaded>()
const pending = new Map<ModelKind, Promise<void>>()

/** Clip names come as "CharacterArmature|Walk", sometimes repeated: keep the last part. */
const short = (name: string) => name.split('|').pop() ?? name

export function loadModels(kinds: ModelKind[]): Promise<void> {
  const loader = new GLTFLoader()
  return Promise.all(
    kinds.map((k) => {
      if (cache.has(k)) return Promise.resolve()
      let p = pending.get(k)
      if (!p) {
        p = loader.loadAsync(`/models/quaternius/${SPECS[k].file}.glb`).then((gltf) => {
          gltf.scene.updateMatrixWorld(true)
          const box = new THREE.Box3().setFromObject(gltf.scene)
          const size = Math.max(0.01, box.max.y - box.min.y)
          const scale = SPECS[k].height / size
          const clips = new Map<string, THREE.AnimationClip>()
          for (const c of gltf.animations) clips.set(short(c.name), c)
          cache.set(k, { gltf, scale, lift: -box.min.y * scale, clips })
        })
        pending.set(k, p)
      }
      return p
    }),
  ).then(() => undefined)
}

export const hasModel = (k: string): k is ModelKind => cache.has(k as ModelKind)

export interface ModelInstance {
  root: THREE.Group
  mixer: THREE.AnimationMixer
  mats: THREE.MeshStandardMaterial[]
  meshes: THREE.Mesh[]
  /** Play a move (cross-fades; one-shot moves hold their last frame). `seconds` stretches a one-shot to that length. */
  play(move: Move, seconds?: number): void
  /** Walk/run cadence to match the speed. */
  pace(k: number): void
  current: Move | null
}

const ONCE: Move[] = ['attack', 'shoot', 'leap', 'hit', 'death']

export function instanceModel(kind: ModelKind): ModelInstance {
  const L = cache.get(kind)
  if (!L) throw new Error(`model ${kind} not loaded`)
  const spec = SPECS[kind]
  const root = new THREE.Group()
  const inner = cloneSkinned(L.gltf.scene) as THREE.Group
  inner.scale.setScalar(L.scale)
  inner.position.y = L.lift
  root.add(inner)
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
        c.userData.base = c.color.clone()
        c.userData.glow = false
        own.set(mat, c)
        mats.push(c)
      }
      return c
    }
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material)
    meshes.push(m)
  })
  // a weapon in the right hand
  const wrist = inner.getObjectByName('Wrist.R')
  if (wrist && (kind === 'grunt' || kind === 'knight')) {
    const w = kind === 'grunt' ? shotgun(mats) : sword(mats)
    // the bone lives inside the scaled model: undo the scale so the weapon keeps real sizes
    w.scale.setScalar(1 / L.scale)
    wrist.add(w)
  }
  const mixer = new THREE.AnimationMixer(inner)
  const actions = new Map<Move, THREE.AnimationAction>()
  for (const [move, name] of Object.entries(spec.clips) as [Move, string][]) {
    const clip = L.clips.get(name)
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
    current: null,
    play(move, seconds) {
      const next = actions.get(move) ?? actions.get('idle')
      if (!next) return
      const prev = inst.current ? actions.get(inst.current) : undefined
      if (inst.current === move && !(ONCE.includes(move) && seconds !== undefined && !next.isRunning() && move !== 'death')) return
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
  // start the idle at a random point so a group doesn't breathe in step
  mixer.update(Math.random() * 2)
  return inst
}

// ---------------------------------------------------------------- hand weapons (metres, along the hand's +y)

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
  // built along +z, then turned to follow the hand
  piece(g, new THREE.BoxGeometry(0.05, 0.07, 0.22), steel, [0, 0, 0.04])
  piece(g, new THREE.CylinderGeometry(0.013, 0.013, 0.5, 12), steel, [0, 0.025, 0.38], [Math.PI / 2, 0, 0])
  piece(g, new THREE.CylinderGeometry(0.012, 0.012, 0.36, 10), steel, [0, -0.008, 0.32], [Math.PI / 2, 0, 0])
  piece(g, new THREE.CylinderGeometry(0.023, 0.023, 0.13, 12), wood, [0, -0.008, 0.28], [Math.PI / 2, 0, 0])
  piece(g, new THREE.BoxGeometry(0.04, 0.07, 0.26), wood, [0, -0.025, -0.18], [0.15, 0, 0])
  piece(g, new THREE.BoxGeometry(0.035, 0.09, 0.04), wood, [0, -0.06, 0.0], [0.4, 0, 0])
  const holder = new THREE.Group()
  holder.add(g)
  // the wrist bone's +y runs along the hand: point the barrel that way
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
