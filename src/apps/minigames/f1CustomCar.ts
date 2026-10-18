// Kherve Grand Prix — a classic car shaped in KherveCAD. KherveCAD exports a
// glTF binary (File > Export for Other CAD > glTF, or export_document .glb)
// with one named node per part; the KherveOS server serves the files in
// ~/Documents/Kherve Grand Prix cars (/api/gp/cars), and a file named after a
// model (stoccarda.glb, dieppe.glb, bavaria.glb) replaces the car the game
// builds itself. The parts are found by name, as the game's own export names
// them: *paint / *plain take the team's colour, *glass is glass, *tail the
// brake lights, *lamp the headlamps, wheel_fl|fr|rl|rr_* the four wheels
// (their *tyre the tyres, which change with the compound), bumper_front_* /
// bumper_rear_* hang from pivots so a crash can break them, and any driver
// part is left out (the game seats its own). glTF is Y-up in metres with the
// front towards +Z; the game's cars face +X.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bendWheels, contactShadow, showDamage, type CarModel, type Shared } from './f1Models.ts'
import { classicCams } from './f1Classics.ts'
import { buildDriver } from './f1Driver.ts'
import type { ClassicModel, Team } from './f1Race.ts'
import type { Compound, Damage } from './f1Physics.ts'

/** The models with a KherveCAD car on the server, loaded (null: none, or not loaded). */
const scenes = new Map<ClassicModel, THREE.Group | null>()

/** Fetch the KherveCAD cars on the server (once; again with `fresh`). Resolves to the models that have one. */
export async function loadCustomCars(fresh = false): Promise<ClassicModel[]> {
  if (fresh) scenes.clear()
  let names: string[] = []
  try {
    const r = await fetch('/api/gp/cars', { credentials: 'same-origin' })
    if (r.ok) names = ((await r.json()) as { cars: string[] }).cars
  } catch {
    return []
  }
  const loader = new GLTFLoader()
  for (const m of ['stoccarda', 'dieppe', 'bavaria'] as ClassicModel[]) {
    if (scenes.has(m)) continue
    if (!names.includes(m)) {
      scenes.set(m, null)
      continue
    }
    try {
      const g = await loader.loadAsync(`/api/gp/cars/${m}.glb?t=${Date.now()}`)
      scenes.set(m, g.scene)
    } catch {
      scenes.set(m, null)
    }
  }
  return [...scenes].filter(([, s]) => s).map(([m]) => m)
}

export function hasCustomCar(model: ClassicModel): boolean {
  return !!scenes.get(model)
}

/** The car from its KherveCAD file, in the team's colours (null when there is none). */
export function buildCustomCar(model: ClassicModel, team: Team, num: number, sh: Shared): CarModel | null {
  const src = scenes.get(model)
  if (!src) return null
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const owned: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(x: T) => {
    owned.push(x)
    return x
  }
  const light = own(new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2020, emissiveIntensity: 0.4 }))
  const paint = own(new THREE.MeshPhysicalMaterial({ color: team.color, roughness: 0.26, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 }))
  const glass = own(new THREE.MeshPhysicalMaterial({ color: 0x1a2630, roughness: 0.03, metalness: 0.2, transparent: true, opacity: 0.5, depthWrite: false, clearcoat: 1 }))
  const lamp = own(new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1cc, emissiveIntensity: 0.35, roughness: 0.1 }))
  // glTF (front +Z, Y up) into the game's frame (front +X): a quarter turn about Y
  const turn = new THREE.Matrix4().makeRotationY(Math.PI / 2)
  src.updateMatrixWorld(true)
  type Piece = { name: string; geo: THREE.BufferGeometry; mat: THREE.Material }
  const pieces: Piece[] = []
  src.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const name = (m.name || m.parent?.name || '').toLowerCase()
    if (name.includes('driver')) return
    const geo = own(m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(turn, m.matrixWorld)))
    const role = name.replace(/[^a-z_]/g, '')
    let mat = m.material as THREE.Material
    if (/(paint|plain)$/.test(role)) mat = paint
    else if (/glass$/.test(role)) mat = glass
    else if (/tail$/.test(role)) mat = light
    else if (/lamp$/.test(role)) mat = lamp
    else mat = own((mat as THREE.Material).clone())
    pieces.push({ name: role, geo, mat })
  })
  // the wheels: their parts round a pivot at the tyre's centre, spinning inside it
  const wheels: CarModel['wheels'] = []
  for (const key of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
    const mine = pieces.filter((p) => p.name.startsWith(key))
    if (!mine.length) continue
    const tyrePiece = mine.find((p) => p.name.endsWith('tyre')) ?? mine[0]
    tyrePiece.geo.computeBoundingBox()
    const c = tyrePiece.geo.boundingBox!.getCenter(new THREE.Vector3())
    const pivot = new THREE.Group()
    pivot.position.copy(c)
    const spin = new THREE.Group()
    pivot.add(spin)
    let tyre: THREE.Mesh | null = null
    for (const p of mine) {
      p.geo.translate(-c.x, -c.y, -c.z)
      const mesh = new THREE.Mesh(p.geo, p === tyrePiece ? sh.tyre.medium : p.mat)
      mesh.castShadow = true
      spin.add(mesh)
      if (p === tyrePiece) tyre = mesh
    }
    root.add(pivot)
    wheels.push({ pivot, spin, tyre: tyre!, front: key[6] === 'f', base: pivot.position.clone() })
  }
  // the bumpers on pivots at their ends (a crash bends them or knocks them off), the rest is the body
  const bumper = (prefix: string, front: boolean) => {
    const mine = pieces.filter((p) => p.name.startsWith(prefix))
    if (!mine.length) return null
    const box = new THREE.Box3()
    for (const p of mine) {
      p.geo.computeBoundingBox()
      box.union(p.geo.boundingBox!)
    }
    const at = new THREE.Vector3(front ? box.min.x : box.max.x, box.getCenter(new THREE.Vector3()).y, 0)
    const g = new THREE.Group()
    g.position.copy(at)
    for (const p of mine) {
      const mesh = new THREE.Mesh(p.geo.translate(-at.x, -at.y, 0), p.mat)
      mesh.castShadow = true
      g.add(mesh)
    }
    body.add(g)
    return g
  }
  const front = bumper('bumper_front', true)
  const rear = bumper('bumper_rear', false)
  for (const p of pieces) {
    if (p.name.startsWith('wheel_') || p.name.startsWith('bumper_')) continue
    const mesh = new THREE.Mesh(p.geo, p.mat)
    mesh.castShadow = p.mat !== glass
    mesh.receiveShadow = p.mat === paint
    if (p.mat === glass) mesh.renderOrder = 2
    body.add(mesh)
  }
  // the driver in the seat, a contact shadow under the car
  const cams = classicCams(model)
  const driver = buildDriver({ team, num, classic: true, wheel: { x: 0.44, y: -0.15, r: 0.17, tilt: 0.45 }, black: sh.black, carbon: sh.black })
  driver.group.name = 'driver'
  driver.group.position.set(cams.eye.x, cams.eye.y - 0.02, cams.eye.z)
  body.add(driver.group)
  const all = new THREE.Box3().setFromObject(body)
  const shadow = contactShadow(all.max.x - all.min.x + 0.4, all.max.z - all.min.z + 0.3)
  shadow.position.x = (all.max.x + all.min.x) / 2
  root.add(shadow)
  return {
    root,
    body,
    wheels,
    flap: new THREE.Mesh(),
    light,
    setCompound(c: Compound) {
      for (const w of wheels) w.tyre.material = sh.tyre[c]
    },
    setDamage(d: Damage) {
      showDamage(front, d.fw, 0.35, 0.4, d.side)
      showDamage(rear, d.rw, -0.3, 0.35, d.side)
      bendWheels(wheels, d)
    },
    setCockpit(on: boolean) {
      driver.group.visible = !on
    },
    dispose() {
      driver.dispose()
      for (const o of owned) o.dispose()
    },
  }
}
