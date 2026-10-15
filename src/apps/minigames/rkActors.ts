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
  core: { hp: 260, speed: 0, radius: 0.75, height: 2.4, points: 1000, melee: 0, meleeDmg: 0, range: 0, painChance: 0 },
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
    // the same soldier models dressed for their part: chrome androids, dark heavies, black-clad commandos
    const look = kind === 'ravager' ? { c: [0.78, 0.82, 0.9], metal: 0.9, rough: 0.22 } : kind === 'brute' ? { c: [0.42, 0.46, 0.36], metal: 0.4, rough: 0.6 } : kind === 'knight' ? { c: [0.45, 0.45, 0.48], metal: 0.2, rough: 0.7 } : null
    if (look)
      for (const m of inst.mats) {
        const base = m.userData.base as THREE.Color | undefined
        if (kind === 'ravager') {
          // chrome all over: the soldier's colours gone, a cold sheen
          const l = base ? (base.r + base.g + base.b) / 3 : 0.5
          const v = 0.35 + l * 0.6
          base?.setRGB(v * look.c[0], v * look.c[1], v * look.c[2])
          m.emissive.setRGB(0.02, 0.06, 0.14)
        } else base?.multiply(new THREE.Color(...look.c))
        m.metalness = look.metal
        m.roughness = look.rough
      }
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

  if (kind === 'core') {
    // a core server: a tall black cabinet, a glowing core behind a window, cables down its back
    const shell = M({ color: 0x15171b, roughness: 0.35, metalness: 0.8 })
    const glow = M({ color: 0x103050, emissive: 0x30a8ff, emissiveIntensity: 2.6, glow: true, roughness: 0.2 })
    const warn = M({ color: 0xc8a020, roughness: 0.5 })
    const hips = pivot(body, [0, 0, 0])
    part(hips, G.box, shell, [1.3, 2.4, 1.0], [0, 1.2, 0])
    part(hips, G.box, warn, [1.32, 0.12, 1.02], [0, 2.3, 0])
    part(hips, G.box, warn, [1.32, 0.12, 1.02], [0, 0.1, 0])
    // glowing strips down every face, and the core itself showing through a window front and back
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) part(hips, G.box, glow, [0.08, 1.6, 0.02], [sx * 0.5, 1.2, sz * 0.51])
      part(hips, G.box, glow, [0.36, 1.2, 0.02], [0, 1.2, sz * 0.505])
      for (let k = 0; k < 5; k++) part(hips, G.box, shell, [0.4, 0.03, 0.03], [0, 0.72 + k * 0.24, sz * 0.52])
    }
    for (const sx of [-1, 1]) for (const sz of [-0.3, 0.3]) part(hips, G.box, glow, [0.02, 1.6, 0.08], [sx * 0.66, 1.2, sz])
    Object.assign(rig, { hips, spine: pivot(hips, [0, 1.2, 0]), head: pivot(hips, [0, 2.2, 0]) })
    const meshes: THREE.Mesh[] = []
    root.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh))
    rig.meshes = meshes
    return rig as Rig
  }

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
    // the drone: a body, four arms with spinning rotors, a camera eye, a gun under it
    const shell = M({ color: 0x2c3034, roughness: 0.4, metalness: 0.7 })
    const trim = M({ color: 0xc8a020, roughness: 0.5, metalness: 0.3 })
    const blade = M({ color: 0x15171a, roughness: 0.6, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    const hips = pivot(body, [0, 1.3, 0])
    const spine = pivot(hips, [0, 0, 0])
    part(spine, G.box, shell, [0.42, 0.14, 0.5], [0, 0, 0])
    part(spine, G.box, trim, [0.44, 0.03, 0.12], [0, 0.07, -0.12])
    part(spine, G.sphere, shell, [0.16, 0.1, 0.16], [0, -0.1, 0.12])
    part(spine, G.cyl, shell, [0.025, 0.24, 0.025], [0, -0.16, 0.2], [Math.PI / 2, 0, 0])
    const head = pivot(spine, [0, -0.04, 0.26])
    part(head, G.sphere, M({ color: 0x050505, roughness: 0.2 }), [0.07, 0.07, 0.05], [0, 0, 0])
    eye(head, 0, 0, 0.045, 0.03)
    const rotors: THREE.Object3D[] = []
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      part(spine, G.box, shell, [0.05, 0.04, 0.42], [x * 0.24, 0.02, z * 0.24], [0, Math.atan2(x, z), 0])
      part(spine, G.cyl, shell, [0.05, 0.06, 0.05], [x * 0.38, 0.05, z * 0.38])
      const rot = pivot(spine, [x * 0.38, 0.1, z * 0.38])
      part(rot, G.box, blade, [0.34, 0.006, 0.05], [0, 0, 0])
      part(rot, G.box, blade, [0.05, 0.006, 0.34], [0, 0, 0])
      rotors.push(rot)
    }
    Object.assign(rig, { hips, spine, head, arms: [rotors[0], rotors[1]], fores: [rotors[2], rotors[3]] })
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
  if (kind === 'core') return
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
    // the drone hovers, tilts into its flight, and its rotors spin
    r.hips.position.y = 1.3 + Math.sin(t * 2) * 0.06
    r.spine.rotation.x = Math.min(0.35, speed * 0.06) - a * 0.2
    r.spine.rotation.z = Math.sin(t * 1.3) * 0.06
    for (const [i, rot] of [...r.arms, ...r.fores].entries()) rot.rotation.y = t * (i % 2 ? -40 : 40)
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

export type WeaponId = 'axe' | 'pistol' | 'shotgun' | 'shotgun2' | 'nailgun' | 'supernail' | 'grenadel' | 'rocketl' | 'thunder' | 'railgun'
export type AmmoType = 'shells' | 'nails' | 'rockets' | 'cells'

export interface WeaponDef {
  id: WeaponId
  name: string
  slot: number
  ammo: AmmoType | null
  use: number
  delay: number
}

// keys 1–9 then 0; the ids stay those of the first version (saves, pickups), the names are the military ones
export const WEAPONS: WeaponDef[] = [
  { id: 'axe', name: 'Combat Knife', slot: 1, ammo: null, use: 0, delay: 0.42 },
  { id: 'pistol', name: 'Service Pistol', slot: 2, ammo: 'nails', use: 1, delay: 0.28 },
  { id: 'shotgun', name: 'Pump Shotgun', slot: 3, ammo: 'shells', use: 1, delay: 0.5 },
  { id: 'shotgun2', name: 'Combat Shotgun', slot: 4, ammo: 'shells', use: 2, delay: 0.7 },
  { id: 'nailgun', name: 'Assault Rifle', slot: 5, ammo: 'nails', use: 1, delay: 0.1 },
  { id: 'supernail', name: 'Minigun', slot: 6, ammo: 'nails', use: 2, delay: 0.07 },
  { id: 'grenadel', name: 'Grenade Launcher', slot: 7, ammo: 'rockets', use: 1, delay: 0.6 },
  { id: 'rocketl', name: 'Rocket Launcher', slot: 8, ammo: 'rockets', use: 1, delay: 0.8 },
  { id: 'thunder', name: 'Arc Gun', slot: 9, ammo: 'cells', use: 1, delay: 0.1 },
  { id: 'railgun', name: 'Railgun', slot: 10, ammo: 'cells', use: 5, delay: 1.25 },
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
  const glove = M({ color: 0x3a2e24, roughness: 0.85 })
  const g = new THREE.Group()
  const muzzle = new THREE.Object3D()
  let spinner: THREE.Object3D | undefined
  const tube = (r: number, len: number, x: number, y: number, z: number, m: THREE.Material) => part(g, G.cyl, m, [r, len, r], [x, y, z], [Math.PI / 2, 0, 0])
  const hand = () => {
    part(g, G.sphere, glove, [0.05, 0.055, 0.07], [0.02, -0.07, 0.08])
    part(g, G.limb, M({ color: 0x4a3a2c, roughness: 0.9 }), [0.045, 0.06, 0.045], [0.06, -0.15, 0.28], [-1.1, 0, -0.15])
  }
  // shared parts: a black receiver, a picatinny rail with its slots, a red-dot sight, a magazine
  const poly = M({ color: 0x23262a, roughness: 0.7, metalness: 0.15 })
  const tan = M({ color: 0x8a7a58, roughness: 0.75 })
  const box = (p: THREE.Object3D, m: THREE.Material, s: [number, number, number], at: [number, number, number], r?: [number, number, number]) => part(p, G.box, m, s, at, r)
  const rail = (z0: number, z1: number, y: number) => {
    box(g, dark, [0.026, 0.008, z1 - z0], [0, y, (z0 + z1) / 2])
    for (let z = z0 + 0.01; z < z1; z += 0.022) box(g, steel, [0.028, 0.006, 0.006], [0, y + 0.006, z])
  }
  const redDot = (z: number, y: number) => {
    box(g, dark, [0.034, 0.018, 0.05], [0, y, z])
    part(g, G.cyl, dark, [0.024, 0.05, 0.024], [0, y + 0.03, z], [Math.PI / 2, 0, 0])
    part(g, G.sphere, M({ color: 0xff2010, emissive: 0xff2010, emissiveIntensity: 3, glow: true }), [0.004, 0.004, 0.004], [0, y + 0.03, z + 0.02])
  }
  switch (id) {
    case 'axe': {
      // a combat knife: black blade with a bright edge, a ribbed grip, a guard
      const h = new THREE.Group()
      part(h, G.cyl, poly, [0.02, 0.13, 0.02], [0, 0.06, 0])
      for (let k = 0; k < 5; k++) part(h, G.cyl, dark, [0.022, 0.006, 0.022], [0, 0.01 + k * 0.025, 0])
      box(h, steel, [0.07, 0.012, 0.03], [0, 0.135, 0])
      box(h, dark, [0.008, 0.2, 0.034], [0, 0.24, 0.0])
      box(h, M({ color: 0xd0d4d8, roughness: 0.15, metalness: 1 }), [0.004, 0.19, 0.008], [0, 0.24, 0.02])
      part(h, G.cone, dark, [0.017, 0.05, 0.004], [0, 0.36, 0.005])
      h.rotation.set(-0.9, 0, 0.35)
      h.position.set(0.02, -0.12, 0)
      g.add(h)
      spinner = h
      part(g, G.sphere, glove, [0.055, 0.06, 0.07], [0.02, -0.1, 0.02])
      muzzle.position.set(0, 0.1, -0.4)
      break
    }
    case 'pistol': {
      // a polymer pistol: slide with serrations, sights, rail, trigger guard, magazine base
      box(g, dark, [0.034, 0.036, 0.2], [0, 0.02, -0.06])
      for (let k = 0; k < 5; k++) box(g, steel, [0.036, 0.028, 0.004], [0, 0.02, 0.02 + k * 0.008])
      box(g, steel, [0.012, 0.01, 0.05], [0, 0.034, -0.04])
      box(g, dark, [0.006, 0.012, 0.006], [0, 0.044, -0.15])
      box(g, dark, [0.026, 0.01, 0.01], [0, 0.044, 0.03])
      box(g, poly, [0.03, 0.03, 0.16], [0, -0.012, -0.05])
      rail(-0.13, -0.07, -0.03)
      box(g, poly, [0.03, 0.11, 0.045], [0, -0.075, 0.03], [-0.25, 0, 0])
      box(g, steel, [0.032, 0.012, 0.05], [0, -0.13, 0.045], [-0.25, 0, 0])
      box(g, poly, [0.02, 0.008, 0.05], [0, -0.04, -0.03])
      tube(0.008, 0.02, 0, 0.02, -0.165, steel)
      hand()
      muzzle.position.set(0, 0.02, -0.18)
      break
    }
    case 'shotgun': {
      // a pump shotgun: receiver, barrel over a tube magazine, ribbed pump, side saddle, stock
      tube(0.016, 0.56, 0, 0.022, -0.3, steel)
      tube(0.014, 0.44, 0, -0.012, -0.24, dark)
      const pump = new THREE.Group()
      part(pump, G.cyl, poly, [0.024, 0.15, 0.024], [0, 0, 0], [Math.PI / 2, 0, 0])
      for (let k = 0; k < 6; k++) part(pump, G.cyl, dark, [0.026, 0.006, 0.026], [0, 0, -0.06 + k * 0.024], [Math.PI / 2, 0, 0])
      pump.position.set(0, -0.012, -0.24)
      g.add(pump)
      box(g, dark, [0.05, 0.07, 0.2], [0, 0.0, 0.02])
      box(g, steel, [0.004, 0.022, 0.06], [0.026, 0.008, 0.0])
      for (let k = 0; k < 4; k++) part(g, G.cyl, M({ color: 0xa02a1a, roughness: 0.5 }), [0.011, 0.05, 0.011], [-0.03, 0.0, -0.03 + k * 0.024])
      box(g, poly, [0.045, 0.1, 0.06], [0, -0.065, 0.1], [-0.35, 0, 0])
      box(g, poly, [0.045, 0.07, 0.24], [0, -0.03, 0.26], [0.1, 0, 0])
      box(g, M({ color: 0x111111, roughness: 0.95 }), [0.048, 0.085, 0.02], [0, -0.04, 0.385], [0.1, 0, 0])
      box(g, steel, [0.006, 0.008, 0.006], [0, 0.044, -0.57])
      hand()
      muzzle.position.set(0, 0.022, -0.6)
      break
    }
    case 'shotgun2': {
      // a combat shotgun: magazine-fed, a heat shield over the barrel, rail and red dot, a folding stock
      tube(0.019, 0.52, 0, 0.02, -0.29, steel)
      box(g, dark, [0.044, 0.03, 0.4], [0, 0.04, -0.26])
      for (let k = 0; k < 8; k++) box(g, M({ color: 0x0a0a0a, roughness: 1 }), [0.046, 0.012, 0.016], [0, 0.04, -0.12 - k * 0.04])
      box(g, poly, [0.06, 0.06, 0.2], [0, -0.01, -0.2])
      box(g, dark, [0.06, 0.08, 0.24], [0, 0.0, 0.02])
      rail(-0.06, 0.12, 0.045)
      redDot(0.04, 0.06)
      box(g, poly, [0.05, 0.14, 0.07], [0, -0.1, -0.03], [0.15, 0, 0])
      box(g, poly, [0.045, 0.1, 0.06], [0, -0.07, 0.12], [-0.35, 0, 0])
      box(g, dark, [0.012, 0.012, 0.22], [0.02, -0.02, 0.27])
      box(g, dark, [0.012, 0.012, 0.22], [-0.02, -0.02, 0.27])
      box(g, poly, [0.05, 0.09, 0.02], [0, -0.03, 0.38])
      hand()
      muzzle.position.set(0, 0.02, -0.56)
      break
    }
    case 'nailgun': {
      // an assault rifle: rail, handguard with slots, red dot, curved magazine, flash hider, stock
      box(g, dark, [0.05, 0.06, 0.26], [0, 0, 0.02])
      box(g, poly, [0.056, 0.056, 0.24], [0, -0.004, -0.22])
      for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) box(g, M({ color: 0x0a0a0a, roughness: 1 }), [0.004, 0.012, 0.026], [sx * 0.029, -0.004, -0.14 - k * 0.04])
      rail(-0.33, 0.13, 0.034)
      redDot(-0.02, 0.05)
      tube(0.011, 0.16, 0, 0, -0.4, steel)
      tube(0.016, 0.05, 0, 0, -0.5, dark)
      box(g, dark, [0.024, 0.03, 0.03], [0, 0.0, -0.35])
      box(g, poly, [0.04, 0.12, 0.06], [0, -0.09, -0.03], [0.25, 0, 0])
      box(g, poly, [0.036, 0.1, 0.045], [0, -0.075, 0.11], [-0.35, 0, 0])
      tube(0.017, 0.12, 0, -0.005, 0.2, dark)
      box(g, tan, [0.044, 0.075, 0.13], [0, -0.02, 0.29])
      box(g, M({ color: 0x111111, roughness: 0.95 }), [0.046, 0.08, 0.016], [0, -0.02, 0.36])
      hand()
      muzzle.position.set(0, 0, -0.53)
      break
    }
    case 'supernail': {
      // a minigun: six spinning barrels, a motor housing, a carry handle, an ammo box
      box(g, dark, [0.13, 0.12, 0.22], [0, 0, 0.02])
      box(g, steel, [0.03, 0.05, 0.16], [0, 0.09, 0.0])
      box(g, M({ color: 0x3c4a2a, roughness: 0.7 }), [0.12, 0.12, 0.12], [-0.11, -0.04, 0.04])
      const s2 = new THREE.Group()
      s2.position.set(0, 0.0, -0.22)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        part(s2, G.cyl, steel, [0.012, 0.42, 0.012], [Math.cos(a) * 0.035, Math.sin(a) * 0.035, -0.12], [Math.PI / 2, 0, 0])
      }
      for (const z of [-0.02, -0.3]) part(s2, G.cyl, dark, [0.055, 0.02, 0.055], [0, 0, z], [Math.PI / 2, 0, 0])
      g.add(s2)
      spinner = s2
      hand()
      muzzle.position.set(0, 0, -0.56)
      break
    }
    case 'grenadel': {
      // a revolver grenade launcher: a fat cylinder, a short barrel, a frame, a stock
      tube(0.04, 0.24, 0, 0.0, -0.26, dark)
      tube(0.046, 0.03, 0, 0.0, -0.37, steel)
      const cyl6 = new THREE.Group()
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        part(cyl6, G.cyl, steel, [0.026, 0.12, 0.026], [Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0], [Math.PI / 2, 0, 0])
      }
      part(cyl6, G.cyl, dark, [0.08, 0.12, 0.08], [0, 0, 0], [Math.PI / 2, 0, 0])
      cyl6.position.set(0, -0.01, -0.06)
      g.add(cyl6)
      rail(-0.2, 0.06, 0.06)
      box(g, poly, [0.04, 0.11, 0.05], [0, -0.09, 0.07], [-0.3, 0, 0])
      box(g, poly, [0.04, 0.08, 0.24], [0, -0.03, 0.24], [0.1, 0, 0])
      hand()
      muzzle.position.set(0, 0, -0.4)
      break
    }
    case 'rocketl': {
      // a launcher tube with its sight, the grip, a warhead showing at the front
      tube(0.055, 0.72, 0, 0.0, -0.18, M({ color: 0x4a5a3a, roughness: 0.6 }))
      tube(0.062, 0.05, 0, 0.0, -0.53, dark)
      tube(0.062, 0.05, 0, 0.0, 0.16, dark)
      part(g, G.cone, M({ color: 0x7a7a6a, roughness: 0.5 }), [0.04, 0.09, 0.04], [0, 0, -0.6], [-Math.PI / 2, 0, 0])
      box(g, dark, [0.04, 0.06, 0.12], [-0.07, 0.04, -0.12])
      part(g, G.cyl, M({ color: 0x223344, roughness: 0.1, metalness: 0.5 }), [0.018, 0.02, 0.018], [-0.07, 0.04, -0.19], [Math.PI / 2, 0, 0])
      box(g, poly, [0.04, 0.12, 0.05], [0, -0.1, 0.0], [-0.2, 0, 0])
      box(g, poly, [0.04, 0.1, 0.05], [0, -0.1, -0.22])
      box(g, M({ color: 0xc8a020, roughness: 0.5 }), [0.112, 0.012, 0.03], [0, 0.0, -0.4])
      hand()
      muzzle.position.set(0, 0, -0.62)
      break
    }
    case 'thunder': {
      // the arc gun: a capacitor body with glowing coils and a forked emitter
      box(g, dark, [0.12, 0.12, 0.3], [0, 0, 0])
      const coil = M({ color: 0x406080, roughness: 0.3, metalness: 0.8, emissive: 0x2050ff, emissiveIntensity: 1.6, glow: true })
      for (let i = 0; i < 5; i++) part(g, G.cyl, coil, [0.05, 0.022, 0.05], [0, 0.0, -0.18 - i * 0.05], [Math.PI / 2, 0, 0])
      tube(0.015, 0.34, 0, 0, -0.3, steel)
      for (const sx of [-1, 1]) box(g, steel, [0.008, 0.008, 0.12], [sx * 0.03, 0.0, -0.46])
      rail(-0.12, 0.1, 0.065)
      box(g, poly, [0.04, 0.12, 0.05], [0, -0.1, 0.06], [-0.3, 0, 0])
      hand()
      muzzle.position.set(0, 0, -0.5)
      break
    }
    case 'railgun': {
      // the railgun: two long rails with a glowing channel between them, a scope, a stock
      const glowRail = M({ color: 0x1a3040, emissive: 0x40c0ff, emissiveIntensity: 2.2, glow: true })
      for (const sy of [-1, 1]) box(g, steel, [0.026, 0.014, 0.62], [0, sy * 0.028, -0.3])
      box(g, glowRail, [0.01, 0.03, 0.6], [0, 0, -0.3])
      for (let k = 0; k < 6; k++) box(g, dark, [0.05, 0.08, 0.02], [0, 0, -0.06 - k * 0.1])
      box(g, dark, [0.07, 0.09, 0.22], [0, 0, 0.06])
      part(g, G.cyl, dark, [0.022, 0.18, 0.022], [0, 0.08, -0.02], [Math.PI / 2, 0, 0])
      part(g, G.cyl, M({ color: 0x223344, roughness: 0.1, metalness: 0.5 }), [0.02, 0.01, 0.02], [0, 0.08, -0.115], [Math.PI / 2, 0, 0])
      box(g, poly, [0.04, 0.11, 0.05], [0, -0.09, 0.1], [-0.3, 0, 0])
      box(g, poly, [0.045, 0.08, 0.22], [0, -0.02, 0.27])
      hand()
      muzzle.position.set(0, 0, -0.62)
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
      // a keycard: blue (silver doors) or red (gold doors), with its chip and a stripe
      const col = kind === 'key_silver' ? 0x2070ff : 0xe02020
      const m = M({ color: col, roughness: 0.3, metalness: 0.2, emissive: col, emissiveIntensity: 0.6, glow: true })
      part(g, G.box, m, [0.34, 0.22, 0.012], [0, 0.85, 0])
      part(g, G.box, M({ color: 0xe8e8e8, roughness: 0.4 }), [0.34, 0.04, 0.014], [0, 0.92, 0])
      part(g, G.box, M({ color: 0xc8a030, roughness: 0.3, metalness: 1 }), [0.06, 0.05, 0.016], [-0.1, 0.82, 0])
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
