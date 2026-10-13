// Rune Keep: the models. Monsters (rigged from primitives with painted
// skins, animated by code), the weapons in your hands, and the pickups.
// Every material keeps its base colour in userData.base so the game can
// tint it with the light where the thing stands (the level's light is baked).

import * as THREE from 'three'
import type { ItemKind, MonsterKind } from './rkMaps'
import { buildHuman, disposeHumanTextures } from './rkHumans'
import { hasModel, instanceModel, type ModelInstance } from './rkModels'

// ---------------------------------------------------------------- skins

function skin(base: string, seed: number, kind: 'flesh' | 'cloth' | 'armor' | 'fur' | 'robe'): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  let a = seed
  const r = () => ((a = (a * 16807) % 2147483647) / 2147483647)
  g.fillStyle = base
  g.fillRect(0, 0, 256, 256)
  if (kind === 'armor') {
    for (let y = 0; y < 256; y += 64) {
      g.fillStyle = 'rgba(0,0,0,0.35)'
      g.fillRect(0, y, 256, 4)
      g.fillStyle = 'rgba(255,255,255,0.12)'
      g.fillRect(0, y + 4, 256, 3)
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(110,60,25,${r() * 0.4})`
      g.fillRect(r() * 256, r() * 256, 3 + r() * 20, 2 + r() * 30)
    }
  } else if (kind === 'fur') {
    for (let i = 0; i < 2500; i++) {
      g.strokeStyle = `rgba(${r() < 0.5 ? '0,0,0' : '200,170,140'},${r() * 0.3})`
      g.beginPath()
      const x = r() * 256
      const y = r() * 256
      g.moveTo(x, y)
      g.lineTo(x + (r() - 0.5) * 4, y + 4 + r() * 6)
      g.stroke()
    }
  } else if (kind === 'robe') {
    for (let i = 0; i < 30; i++) {
      g.strokeStyle = `rgba(0,0,0,${0.2 + r() * 0.3})`
      g.lineWidth = 2 + r() * 4
      g.beginPath()
      const x = r() * 256
      g.moveTo(x, 0)
      g.bezierCurveTo(x + 10, 80, x - 10, 170, x + (r() - 0.5) * 20, 256)
      g.stroke()
    }
  } else {
    for (let i = 0; i < 70; i++) {
      g.fillStyle = kind === 'flesh' ? `rgba(${r() < 0.5 ? '90,20,20' : '40,30,20'},${r() * 0.3})` : `rgba(0,0,0,${r() * 0.25})`
      g.beginPath()
      g.arc(r() * 256, r() * 256, 2 + r() * 14, 0, Math.PI * 2)
      g.fill()
    }
    if (kind === 'flesh')
      for (let i = 0; i < 14; i++) {
        g.strokeStyle = 'rgba(60,10,20,0.4)'
        g.beginPath()
        let x = r() * 256
        let y = r() * 256
        g.moveTo(x, y)
        for (let k = 0; k < 5; k++) g.lineTo((x += (r() - 0.5) * 30), (y += (r() - 0.5) * 30))
        g.stroke()
      }
  }
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.08})`
    g.fillRect(r() * 256, r() * 256, 2, 2)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

let skins: Record<string, THREE.CanvasTexture> | null = null
function skinSet() {
  skins ??= {
    flesh: skin('#8a6a58', 3, 'flesh'),
    pale: skin('#9a9488', 5, 'flesh'),
    olive: skin('#4a4a30', 7, 'cloth'),
    rust: skin('#6a4a30', 9, 'armor'),
    steel: skin('#6c6e72', 11, 'armor'),
    fur: skin('#4a3626', 13, 'fur'),
    robe: skin('#2a2030', 17, 'robe'),
    hide: skin('#5a3a3a', 19, 'flesh'),
  }
  return skins
}

export function disposeSkins() {
  disposeHumanTextures()
  if (!skins) return
  for (const t of Object.values(skins)) t.dispose()
  skins = null
}

function mat(o: THREE.MeshStandardMaterialParameters & { glow?: boolean }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial(o)
  m.userData.base = m.color.clone()
  m.userData.glow = !!o.glow
  return m
}

// shared geometry
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  /** Unit radius, 6 long: scale (r, length / 6, r). */
  limb: new THREE.CapsuleGeometry(1, 4, 5, 12),
  sphere: new THREE.SphereGeometry(1, 20, 14),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  cone: new THREE.ConeGeometry(1, 1, 18, 1, true),
}

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, s: [number, number, number], p: [number, number, number], r?: [number, number, number]) {
  const mesh = new THREE.Mesh(geo, m)
  mesh.scale.set(...s)
  mesh.position.set(...p)
  if (r) mesh.rotation.set(...r)
  mesh.castShadow = false
  parent.add(mesh)
  return mesh
}

function pivot(parent: THREE.Object3D, p: [number, number, number]) {
  const o = new THREE.Object3D()
  o.position.set(...p)
  parent.add(o)
  return o
}

// ---------------------------------------------------------------- monsters

export interface MonsterStats {
  hp: number
  speed: number
  radius: number
  height: number
  points: number
  /** Melee reach and damage; 0 = none. */
  melee: number
  meleeDmg: number
  /** Ranged attack range; 0 = none. */
  range: number
  flies?: boolean
  painChance: number
}

export const STATS: Record<MonsterKind, MonsterStats> = {
  grunt: { hp: 30, speed: 3.2, radius: 0.4, height: 1.8, points: 100, melee: 0, meleeDmg: 0, range: 30, painChance: 0.8 },
  hound: { hp: 25, speed: 7.5, radius: 0.45, height: 1.0, points: 100, melee: 1.5, meleeDmg: 8, range: 0, painChance: 0.6 },
  knight: { hp: 75, speed: 4.2, radius: 0.45, height: 1.9, points: 200, melee: 1.8, meleeDmg: 14, range: 0, painChance: 0.4 },
  brute: { hp: 200, speed: 2.8, radius: 0.6, height: 2.3, points: 400, melee: 2.0, meleeDmg: 18, range: 24, painChance: 0.15 },
  wraith: { hp: 80, speed: 4.0, radius: 0.5, height: 1.8, points: 250, melee: 0, meleeDmg: 0, range: 28, flies: true, painChance: 0.5 },
  ravager: { hp: 300, speed: 5.5, radius: 0.65, height: 2.2, points: 600, melee: 2.1, meleeDmg: 28, range: 0, painChance: 0.1 },
}

export interface Rig {
  root: THREE.Group
  body: THREE.Group
  hips: THREE.Object3D
  spine: THREE.Object3D
  head: THREE.Object3D
  arms: THREE.Object3D[]
  fores: THREE.Object3D[]
  legs: THREE.Object3D[]
  shins: THREE.Object3D[]
  tail?: THREE.Object3D
  weapon?: THREE.Object3D
  mats: THREE.MeshStandardMaterial[]
  meshes: THREE.Mesh[]
  eyes: THREE.Mesh[]
  /** An animated model (rkModels.ts) instead of the code-posed parts. */
  model?: ModelInstance
}

export function makeMonster(kind: MonsterKind): Rig {
  if (hasModel(kind)) {
    const inst = instanceModel(kind)
    const root = new THREE.Group()
    root.rotation.order = 'YXZ'
    root.add(inst.root)
    const dummy = () => new THREE.Object3D()
    return {
      root, body: inst.root, hips: dummy(), spine: dummy(), head: dummy(), arms: [dummy(), dummy()], fores: [dummy(), dummy()],
      legs: [dummy(), dummy()], shins: [dummy(), dummy()], mats: inst.mats, meshes: inst.meshes, eyes: [], model: inst,
    }
  }
  if (kind === 'grunt' || kind === 'knight' || kind === 'brute' || kind === 'ravager') return buildHuman(kind)
  const s = skinSet()
  const mats: THREE.MeshStandardMaterial[] = []
  const M = (o: Parameters<typeof mat>[0]) => {
    const m = mat(o)
    mats.push(m)
    return m
  }
  const root = new THREE.Group()
  root.rotation.order = 'YXZ'
  const body = new THREE.Group()
  root.add(body)
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...(kind === 'wraith' ? [0.6, 1.6, 2.4] : [2.2, 0.5, 0.2])) })
  const eyes: THREE.Mesh[] = []
  const eye = (parent: THREE.Object3D, x: number, y: number, z: number, r = 0.022) => {
    const e = new THREE.Mesh(G.sphere, eyeMat)
    e.scale.setScalar(r)
    e.position.set(x, y, z)
    parent.add(e)
    eyes.push(e)
  }
  const rig: Partial<Rig> = { root, body, mats, eyes, arms: [], fores: [], legs: [], shins: [] }

  if (kind === 'hound') {
    const fur = M({ map: s.fur, roughness: 0.95 })
    const hide = M({ map: s.hide, roughness: 0.8 })
    const hips = pivot(body, [0, 0.62, 0])
    const spine = pivot(hips, [0, 0, 0])
    part(spine, G.limb, fur, [0.22, 0.13, 0.2], [0, 0.05, 0.1], [Math.PI / 2, 0, 0])
    part(spine, G.sphere, fur, [0.26, 0.24, 0.3], [0, 0.08, 0.38])
    const head = pivot(spine, [0, 0.2, 0.62])
    part(head, G.sphere, hide, [0.15, 0.14, 0.2], [0, 0, 0])
    part(head, G.box, hide, [0.14, 0.1, 0.22], [0, -0.04, 0.18])
    const jaw = part(head, G.box, M({ color: 0x3a1010, roughness: 0.6 }), [0.12, 0.04, 0.2], [0, -0.1, 0.16], [0.3, 0, 0])
    jaw.userData.jaw = true
    for (const x of [-0.08, 0.08]) {
      part(head, G.cone, hide, [0.04, 0.1, 0.04], [x, 0.14, -0.02])
      eye(head, x * 0.8, 0.04, 0.17)
    }
    for (const [x, z] of [[-0.13, 0.42], [0.13, 0.42], [-0.13, -0.18], [0.13, -0.18]]) {
      const leg = pivot(spine, [x, -0.02, z])
      part(leg, G.limb, fur, [0.06, 0.05, 0.06], [0, -0.16, 0])
      const shin = pivot(leg, [0, -0.32, 0])
      part(shin, G.limb, hide, [0.045, 0.045, 0.045], [0, -0.13, 0])
      rig.legs!.push(leg)
      rig.shins!.push(shin)
    }
    const tail = pivot(spine, [0, 0.08, -0.32])
    part(tail, G.limb, fur, [0.04, 0.07, 0.04], [0, 0, -0.2], [-1.2, 0, 0])
    Object.assign(rig, { hips, spine, head, tail })
  } else if (kind === 'wraith') {
    const robe = M({ map: s.robe, roughness: 0.95, side: THREE.DoubleSide })
    const bone = M({ map: s.pale, roughness: 0.7 })
    const hips = pivot(body, [0, 0.9, 0])
    const spine = pivot(hips, [0, 0, 0])
    part(spine, G.cone, robe, [0.42, 1.2, 0.38], [0, -0.25, 0], [Math.PI, 0, 0])
    part(spine, G.limb, robe, [0.2, 0.08, 0.15], [0, 0.45, 0])
    const head = pivot(spine, [0, 0.85, 0.02])
    part(head, G.cone, robe, [0.2, 0.42, 0.22], [0, 0.05, -0.03])
    part(head, G.sphere, M({ color: 0x050407, roughness: 1 }), [0.14, 0.16, 0.12], [0, -0.02, 0.06])
    eye(head, -0.05, 0.0, 0.16, 0.026)
    eye(head, 0.05, 0.0, 0.16, 0.026)
    for (const x of [-1, 1]) {
      const arm = pivot(spine, [x * 0.24, 0.55, 0])
      part(arm, G.limb, robe, [0.07, 0.06, 0.07], [0, -0.18, 0])
      const fore = pivot(arm, [0, -0.36, 0])
      part(fore, G.limb, bone, [0.035, 0.045, 0.035], [0, -0.13, 0])
      for (let k = -1; k <= 1; k++) part(fore, G.cone, bone, [0.012, 0.12, 0.012], [k * 0.025, -0.33, 0.02], [Math.PI, 0, 0])
      rig.arms!.push(arm)
      rig.fores!.push(fore)
    }
    Object.assign(rig, { hips, spine, head })
  }
  const meshes: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !eyes.includes(o as THREE.Mesh)) meshes.push(o as THREE.Mesh)
  })
  mats.push(eyeMat as unknown as THREE.MeshStandardMaterial) // disposed with the rest; never tinted
  rig.meshes = meshes
  return rig as Rig
}

/** Pose a monster. `walk` is the stride phase, `speed` how fast it goes, `act` an attack in progress (0..1, -1 = none). */
export function poseMonster(kind: MonsterKind, r: Rig, walk: number, speed: number, act: number, t: number, pain: number) {
  const a = act >= 0 ? Math.sin(act * Math.PI) : 0
  if (kind === 'hound') {
    const sw = Math.min(1, speed / 3) * 0.7
    r.legs.forEach((l, i) => (l.rotation.x = Math.sin(walk * 1.4 + (i < 2 ? 0 : Math.PI) + (i % 2) * 0.6) * sw))
    r.shins.forEach((s, i) => (s.rotation.x = Math.max(0, Math.cos(walk * 1.4 + (i < 2 ? 0 : Math.PI))) * sw))
    r.spine.rotation.x = Math.sin(walk * 2.8) * 0.05 * sw - a * 0.3
    r.head.rotation.x = -a * 0.5 + Math.sin(t * 3) * 0.05
    r.tail!.rotation.y = Math.sin(t * 9) * 0.5
    r.head.children.forEach((c) => c.userData.jaw && (c.rotation.x = 0.3 + a * 0.6))
    r.hips.position.y = 0.62 + Math.abs(Math.sin(walk * 1.4)) * 0.04 * sw
    return
  }
  if (kind === 'wraith') {
    r.hips.position.y = 0.9 + Math.sin(t * 2) * 0.08
    r.spine.rotation.z = Math.sin(t * 1.3) * 0.08
    r.arms[0].rotation.x = -0.4 + Math.sin(t * 2.2) * 0.2 - a * 1.4
    r.arms[1].rotation.x = -0.4 - Math.sin(t * 2.2) * 0.2 - a * 1.4
    r.arms[0].rotation.z = -0.4
    r.arms[1].rotation.z = 0.4
    r.fores.forEach((f) => (f.rotation.x = -0.6 - a * 0.4))
    return
  }
  const fast = kind === 'ravager' || kind === 'knight' ? 1.2 : 1
  const sw = Math.min(1, speed / 2.5) * 0.6 * fast
  r.legs[0].rotation.x = Math.sin(walk) * sw
  r.legs[1].rotation.x = -Math.sin(walk) * sw
  r.shins[0].rotation.x = Math.max(0, -Math.cos(walk)) * sw * 1.3
  r.shins[1].rotation.x = Math.max(0, Math.cos(walk)) * sw * 1.3
  r.hips.position.y = 0.95 - Math.abs(Math.cos(walk)) * 0.04 * sw
  r.spine.rotation.x = (kind === 'ravager' ? 0.35 : 0.08) - pain * 0.4 + a * 0.2
  r.head.rotation.x = kind === 'ravager' ? -0.3 : 0
  r.head.rotation.y = Math.sin(t * 0.7) * 0.15
  // arms: walking swing, then the attack pose
  let l = -Math.sin(walk) * sw * 0.8
  let rr = Math.sin(walk) * sw * 0.8
  let lf = -0.3
  let rf = -0.3
  if (kind === 'grunt') {
    rr = -1.3 + a * 0.3
    rf = -0.15
    l = -1.1
    lf = -0.7
  } else if (kind === 'knight') {
    rr = act >= 0 ? -2.6 + act * 3.2 : -0.6 + Math.sin(walk) * 0.3
    rf = -0.4
  } else if (kind === 'brute') {
    rr = -1.2 + Math.sin(t * 30) * 0.03 * (act >= 0 ? 1 : 0.2)
    l = act >= 0 ? -2.4 * a : l
    rf = -0.3
  } else if (kind === 'ravager') {
    l = act >= 0 ? -2.8 + act * 3 : -0.4 + l
    rr = act >= 0 ? -2.8 + ((act + 0.3) % 1) * 3 : -0.4 + rr
  }
  r.arms[0].rotation.x = l
  r.arms[1].rotation.x = rr
  r.fores[0].rotation.x = lf
  r.fores[1].rotation.x = rf
  r.arms[0].rotation.z = -0.1
  r.arms[1].rotation.z = 0.1
}

// ---------------------------------------------------------------- weapons

export type WeaponId = 'axe' | 'shotgun' | 'shotgun2' | 'nailgun' | 'supernail' | 'grenadel' | 'rocketl' | 'thunder'
export type AmmoType = 'shells' | 'nails' | 'rockets' | 'cells'

export interface WeaponDef {
  id: WeaponId
  name: string
  slot: number
  ammo: AmmoType | null
  use: number
  delay: number
}

export const WEAPONS: WeaponDef[] = [
  { id: 'axe', name: 'Axe', slot: 1, ammo: null, use: 0, delay: 0.5 },
  { id: 'shotgun', name: 'Shotgun', slot: 2, ammo: 'shells', use: 1, delay: 0.5 },
  { id: 'shotgun2', name: 'Double Shotgun', slot: 3, ammo: 'shells', use: 2, delay: 0.7 },
  { id: 'nailgun', name: 'Nailgun', slot: 4, ammo: 'nails', use: 1, delay: 0.1 },
  { id: 'supernail', name: 'Super Nailgun', slot: 5, ammo: 'nails', use: 2, delay: 0.1 },
  { id: 'grenadel', name: 'Grenade Launcher', slot: 6, ammo: 'rockets', use: 1, delay: 0.6 },
  { id: 'rocketl', name: 'Rocket Launcher', slot: 7, ammo: 'rockets', use: 1, delay: 0.8 },
  { id: 'thunder', name: 'Thunderbolt', slot: 8, ammo: 'cells', use: 1, delay: 0.1 },
]

export interface ViewModel {
  group: THREE.Group
  muzzle: THREE.Object3D
  /** Spins while firing (nailguns). */
  spinner?: THREE.Object3D
  mats: THREE.MeshStandardMaterial[]
}

export function makeWeapon(id: WeaponId): ViewModel {
  const mats: THREE.MeshStandardMaterial[] = []
  const M = (o: Parameters<typeof mat>[0]) => {
    const m = mat(o)
    mats.push(m)
    return m
  }
  const steel = M({ color: 0x5a5c60, roughness: 0.35, metalness: 0.9 })
  const dark = M({ color: 0x262422, roughness: 0.5, metalness: 0.7 })
  const wood = M({ color: 0x6a4024, roughness: 0.55 })
  const brass = M({ color: 0xb08a40, roughness: 0.35, metalness: 1 })
  const glove = M({ color: 0x3a2e24, roughness: 0.85 })
  const g = new THREE.Group()
  const muzzle = new THREE.Object3D()
  let spinner: THREE.Object3D | undefined
  const tube = (r: number, len: number, x: number, y: number, z: number, m: THREE.Material) => part(g, G.cyl, m, [r, len, r], [x, y, z], [Math.PI / 2, 0, 0])
  const hand = () => {
    part(g, G.sphere, glove, [0.05, 0.055, 0.07], [0.02, -0.07, 0.08])
    part(g, G.limb, M({ color: 0x4a3a2c, roughness: 0.9 }), [0.045, 0.06, 0.045], [0.06, -0.15, 0.28], [-1.1, 0, -0.15])
  }
  switch (id) {
    case 'axe': {
      const h = new THREE.Group()
      part(h, G.cyl, wood, [0.022, 0.62, 0.022], [0, 0.18, 0])
      part(h, G.box, steel, [0.02, 0.16, 0.2], [0, 0.43, 0.08])
      part(h, G.box, M({ color: 0xc8ccd0, roughness: 0.2, metalness: 1 }), [0.008, 0.18, 0.04], [0, 0.43, 0.19])
      part(h, G.box, dark, [0.05, 0.06, 0.05], [0, 0.43, -0.03])
      h.rotation.set(-0.9, 0, 0.35)
      h.position.set(0.02, -0.12, 0)
      g.add(h)
      spinner = h
      part(g, G.sphere, glove, [0.055, 0.06, 0.07], [0.02, -0.1, 0.02])
      muzzle.position.set(0, 0.1, -0.4)
      break
    }
    case 'shotgun':
      tube(0.022, 0.6, 0, 0.02, -0.28, steel)
      tube(0.018, 0.45, 0, -0.025, -0.22, dark)
      part(g, G.box, wood, [0.06, 0.06, 0.18], [0, -0.025, -0.25])
      part(g, G.box, dark, [0.06, 0.08, 0.2], [0, 0, 0.02])
      part(g, G.box, wood, [0.055, 0.1, 0.3], [0, -0.05, 0.25], [0.15, 0, 0])
      hand()
      muzzle.position.set(0, 0.02, -0.6)
      break
    case 'shotgun2':
      tube(0.024, 0.6, -0.026, 0.02, -0.28, steel)
      tube(0.024, 0.6, 0.026, 0.02, -0.28, steel)
      part(g, G.box, dark, [0.1, 0.07, 0.18], [0, 0.0, 0.03])
      part(g, G.box, wood, [0.08, 0.06, 0.3], [0, -0.03, -0.12])
      part(g, G.box, wood, [0.07, 0.11, 0.3], [0, -0.05, 0.26], [0.15, 0, 0])
      hand()
      muzzle.position.set(0, 0.02, -0.6)
      break
    case 'nailgun':
    case 'supernail': {
      const big = id === 'supernail'
      part(g, G.box, dark, [big ? 0.14 : 0.1, big ? 0.13 : 0.1, 0.32], [0, 0, -0.02])
      part(g, G.box, brass, [big ? 0.15 : 0.11, 0.025, 0.2], [0, big ? 0.07 : 0.055, -0.04])
      const s = new THREE.Group()
      s.position.set(0, 0.0, -0.3)
      const n = big ? 4 : 2
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        part(s, G.cyl, steel, [0.016, big ? 0.36 : 0.3, 0.016], [Math.cos(a) * 0.03, Math.sin(a) * 0.03, -0.05], [Math.PI / 2, 0, 0])
      }
      part(s, G.cyl, dark, [0.05, 0.03, 0.05], [0, 0, 0.02], [Math.PI / 2, 0, 0])
      g.add(s)
      spinner = s
      hand()
      muzzle.position.set(0, 0, big ? -0.52 : -0.48)
      break
    }
    case 'grenadel':
      tube(0.045, 0.32, 0, 0.0, -0.25, steel)
      part(g, G.cyl, dark, [0.07, 0.12, 0.07], [0, -0.01, -0.02], [0, 0, Math.PI / 2])
      part(g, G.box, wood, [0.06, 0.1, 0.26], [0, -0.05, 0.2], [0.15, 0, 0])
      hand()
      muzzle.position.set(0, 0, -0.42)
      break
    case 'rocketl':
      tube(0.055, 0.7, 0, 0.0, -0.2, dark)
      tube(0.062, 0.06, 0, 0.0, -0.55, steel)
      tube(0.062, 0.06, 0, 0.0, 0.14, steel)
      part(g, G.box, brass, [0.03, 0.05, 0.2], [0, 0.07, -0.1])
      part(g, G.box, dark, [0.04, 0.12, 0.06], [0, -0.09, 0.02])
      hand()
      muzzle.position.set(0, 0, -0.58)
      break
    case 'thunder': {
      part(g, G.box, dark, [0.12, 0.12, 0.3], [0, 0, 0])
      const coil = M({ color: 0x406080, roughness: 0.3, metalness: 0.8, emissive: 0x2050ff, emissiveIntensity: 1.6, glow: true })
      for (let i = 0; i < 4; i++) part(g, G.cyl, coil, [0.05, 0.03, 0.05], [0, 0.0, -0.2 - i * 0.06], [Math.PI / 2, 0, 0])
      tube(0.015, 0.34, 0, 0, -0.3, steel)
      hand()
      muzzle.position.set(0, 0, -0.48)
      break
    }
  }
  g.add(muzzle)
  g.traverse((o) => (o.frustumCulled = false))
  return { group: g, muzzle, spinner, mats }
}

// ---------------------------------------------------------------- pickups

export function makeItem(kind: ItemKind): { group: THREE.Group; mats: THREE.MeshStandardMaterial[]; glow: number } {
  const mats: THREE.MeshStandardMaterial[] = []
  const M = (o: Parameters<typeof mat>[0]) => {
    const m = mat(o)
    mats.push(m)
    return m
  }
  const g = new THREE.Group()
  let glow = 0
  const crate = (col: number, label: number, w = 0.5, h = 0.32, d = 0.36) => {
    part(g, G.box, M({ color: col, roughness: 0.7 }), [w, h, d], [0, h / 2, 0])
    part(g, G.box, M({ color: label, roughness: 0.4, emissive: label, emissiveIntensity: 0.35, glow: true }), [w + 0.005, h * 0.3, d + 0.005], [0, h / 2, 0])
  }
  switch (kind) {
    case 'shells':
      crate(0x5a3a22, 0xd0a040)
      break
    case 'nails':
      crate(0x3a3a3c, 0x80a0c0)
      break
    case 'rockets':
      crate(0x3a4a2a, 0xd05030)
      for (let i = -1; i <= 1; i++) part(g, G.cone, M({ color: 0xa04030, roughness: 0.4, side: THREE.DoubleSide }), [0.05, 0.12, 0.05], [i * 0.14, 0.38, 0])
      break
    case 'cells':
      crate(0x2a3040, 0x40a0ff)
      glow = 0x3080ff
      break
    case 'health':
    case 'health25':
    case 'mega': {
      const big = kind === 'health25' ? 1.15 : 1
      part(g, G.box, M({ color: 0xd8d4c8, roughness: 0.5 }), [0.5 * big, 0.3 * big, 0.5 * big], [0, 0.15 * big, 0])
      const plus = M({ color: kind === 'mega' ? 0x2040ff : 0x20a040, emissive: kind === 'mega' ? 0x2040ff : 0x20c050, emissiveIntensity: 0.8, glow: true })
      part(g, G.box, plus, [0.3 * big, 0.06, 0.1], [0, 0.31 * big, 0])
      part(g, G.box, plus, [0.1, 0.06, 0.3 * big], [0, 0.31 * big, 0])
      if (kind === 'mega') glow = 0x3050ff
      break
    }
    case 'armor1':
    case 'armor2':
    case 'armor3': {
      const col = kind === 'armor1' ? 0x30a040 : kind === 'armor2' ? 0xd0b020 : 0xc02a20
      const m = M({ color: col, roughness: 0.35, metalness: 0.7, emissive: col, emissiveIntensity: 0.35, glow: true })
      part(g, G.box, m, [0.5, 0.55, 0.16], [0, 0.55, 0])
      for (const x of [-1, 1]) part(g, G.sphere, m, [0.13, 0.08, 0.12], [x * 0.27, 0.8, 0])
      glow = col
      break
    }
    case 'quad': {
      const m = M({ color: 0x3040ff, roughness: 0.2, metalness: 0.5, emissive: 0x4060ff, emissiveIntensity: 2.2, glow: true })
      part(g, G.box, m, [0.32, 0.32, 0.32], [0, 0.7, 0], [0.6, 0.6, 0])
      glow = 0x4060ff
      break
    }
    case 'key_silver':
    case 'key_gold': {
      const col = kind === 'key_silver' ? 0xd8dde4 : 0xe0b040
      const m = M({ color: col, roughness: 0.25, metalness: 1, emissive: col, emissiveIntensity: 0.5, glow: true })
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 10, 24), m)
      ring.position.y = 0.95
      g.add(ring)
      part(g, G.box, m, [0.05, 0.4, 0.05], [0, 0.65, 0])
      part(g, G.box, m, [0.14, 0.05, 0.05], [0.07, 0.5, 0])
      part(g, G.box, m, [0.1, 0.05, 0.05], [0.05, 0.6, 0])
      glow = col
      break
    }
    default: {
      // a weapon lying on the floor: its view model, bigger
      const vm = makeWeapon(kind as WeaponId)
      vm.group.scale.setScalar(1.6)
      vm.group.position.y = 0.45
      vm.group.rotation.y = Math.PI / 2
      g.add(vm.group)
      mats.push(...vm.mats)
    }
  }
  return { group: g, mats, glow }
}

/** Set each material to its base colour × the light (and a hit flash). */
export function tint(mats: THREE.MeshStandardMaterial[], light: THREE.Color, flash = 0) {
  for (const m of mats) {
    const base = m.userData.base as THREE.Color | undefined
    if (!base) continue
    m.color.setRGB(base.r * light.r, base.g * light.g, base.b * light.b)
    if (!m.userData.glow) m.emissive.setRGB(flash * 0.8, flash * 0.05, 0)
  }
}
