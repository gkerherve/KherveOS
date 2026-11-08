// Last Train: the city above the station, behind the chained gates and the
// ticket halls' ways out. A London-like city at night after it all went
// wrong, laid out by lastTrainPlan.ts: Station Road in front of the station's
// oxblood faience front, and north of it a grid of streets — four running
// east-west, seven north-south, eighteen blocks between them. Blocks of
// terraces over shops (fascias, shutters, awnings), red-brick mansion blocks,
// Portland stone offices, warehouses, glass towers, every corner turned with
// windows on both streets; and the blocks that are something else (a park, a
// square with its fountain, a church, a petrol station, a car park, a building
// site with its crane, a supermarket, a hospital: lastTrainSites.ts). The
// town hall closes the end of Kherve Street; a military checkpoint shuts
// Station Road's west end; to the east the avenue leaves the city.
//
// The roads: worn asphalt with cracks, patches and puddles that shine, granite
// kerbs, lines and give-way markings, zebra crossings with Belisha beacons,
// manholes and drains. Lamp posts (some still lit), traffic lights blinking
// amber, name plates on the corners, trees, bins, phone boxes, bus shelters,
// pillar boxes, bollards, cabinets; cars, cabs, police cars and buses left
// where they stopped; rubbish, burning barrels and wrecks.
//
// Everything that does not move is merged by material and by chunk of the
// city (what is lost in the haze is not drawn); windows and frames are
// instanced; bullets hit simple invisible boxes; footprints keep everyone out
// of walls and cars. Only a few real lights: they go to the lit lamps (and
// fires, and shop lights) nearest the player.

import * as THREE from 'three'
import { AVENUE, canvas, concrete, FINAL_STATION, LANDING, outDoorX, rng, stationAt, STAIRS, STREET, texture, words } from './lastTrainWorld'
import { makeBus, vehicleMats, type CarKind, type CarState } from './lastTrainVehicles'
import {
  add, ARCH, asphalt, ashlar, barkTex, Batch, beacon, bin, boardTex, bollard, BOX, brick, building, chunkOf, CYL, faience, ironTex, kiosk, kioskTex, lamp, local, metres,
  nightEnv, officeTex, once, paving, PLANE, poolTex, postbox, roomTex, rubbish, shelter, shopTex, shutterTex, skyTex, soft, stationFront, stripesTex, stucco, tree, uvBox,
  vehicle, type Block, type Ctx, type LightSpot, type Mats, type Own, type Style, type Surface,
} from './lastTrainCityKit'
import { EW, NS, NS_HALF, NS_ROAD, planCity, STATION_FRONT, type CityBlock, type CityPlan } from './lastTrainPlan'
import {
  bench, board, bx, carAt, carpark, checkpoint, church, cone, flat, hospital, jersey, mart, namePlate, park, petrol, rubble, sandbags, siteMats, solidArea, square, townHall,
  trafficLight, works, type Face,
} from './lastTrainSites'

export interface StreetBuild {
  /** All of it (hidden while the player is down on the platform, where none of it can be seen). */
  group: THREE.Group
  /** The burning barrels' light (it flickers). */
  fire: THREE.PointLight
  /** The moon's light: on only while the player is out there (it would light the station too). */
  moon: THREE.DirectionalLight
  /** The plan of the city: its blocks and what stands on them. */
  plan: CityPlan
  /** Where supplies lie about the city: [x, y, z]. */
  supplies: [number, number, number][]
  /**
   * Every frame: blinking hazards, beacons and amber lights, flames, smoke; the sky follows the eye, the few
   * real lights go to the lamps nearest it, and what is lost in the haze is not drawn. `on`: the street's
   * lights may shine (not while the player is down in the station, which they would light through its roof).
   */
  update(t: number, eye: THREE.Vector3, on: boolean): void
}

export interface StreetCtx {
  group: THREE.Group
  solids: THREE.Object3D[]
  blocks: Block[]
  own: Own
  index: number
}

/** The colour the night fades to in the street (the engine blends the fog to it out there). */
export const NIGHT_FOG = 0x14161c

/** How many real lights the street has (they go to the light spots nearest the player). */
const POOL = 6

/**
 * Merge every plain mesh of the group by material and by chunk of the city: one draw call per material per chunk.
 * The vertices are moved straight into the merged buffers (no copies of tens of thousands of little geometries).
 */
function mergeStatic(g: THREE.Group, own: Own) {
  g.updateMatrixWorld(true)
  const inv = g.matrixWorld.clone().invert()
  type Item = { geo: THREE.BufferGeometry; m: THREE.Matrix4 }
  const byKey = new Map<string, { mat: THREE.Material; items: Item[]; nv: number; ni: number }>()
  const drop: THREE.Object3D[] = []
  const v = new THREE.Vector3()
  g.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh || mesh.userData.keep || Array.isArray(mesh.material)) return
    drop.push(mesh)
    const geo = mesh.geometry
    if (!geo.attributes.normal || !geo.attributes.uv) return
    const m = inv.clone().multiply(mesh.matrixWorld)
    if (!geo.boundingSphere) geo.computeBoundingSphere()
    const bs = geo.boundingSphere!
    v.copy(bs.center).applyMatrix4(m)
    const rad = bs.radius * m.getMaxScaleOnAxis()
    const mat = mesh.material as THREE.Material
    const key = mat.uuid + ':' + (rad > 60 ? -1 : chunkOf(v.x, v.z))
    let e = byKey.get(key)
    if (!e) byKey.set(key, (e = { mat, items: [], nv: 0, ni: 0 }))
    const n = geo.attributes.position.count
    e.items.push({ geo, m })
    e.nv += n
    e.ni += geo.index ? geo.index.count : n
  })
  for (const m of drop) m.removeFromParent()
  const prune = (o: THREE.Object3D): boolean => {
    for (const ch of [...o.children]) if (prune(ch)) ch.removeFromParent()
    return o.type === 'Group' && o.children.length === 0
  }
  for (const o of [...g.children]) if (prune(o)) o.removeFromParent()
  const nm = new THREE.Matrix3()
  for (const { mat, items, nv, ni } of byKey.values()) {
    const pos = new Float32Array(nv * 3)
    const nor = new Float32Array(nv * 3)
    const uv = new Float32Array(nv * 2)
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni)
    let vo = 0
    let io = 0
    for (const { geo, m } of items) {
      const P = geo.attributes.position.array as ArrayLike<number>
      const N = geo.attributes.normal.array as ArrayLike<number>
      const U = geo.attributes.uv.array as ArrayLike<number>
      const n = geo.attributes.position.count
      const e = m.elements
      nm.getNormalMatrix(m)
      const q = nm.elements
      for (let k = 0; k < n; k++) {
        const x = P[k * 3]
        const y = P[k * 3 + 1]
        const z = P[k * 3 + 2]
        const o3 = (vo + k) * 3
        pos[o3] = e[0] * x + e[4] * y + e[8] * z + e[12]
        pos[o3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
        pos[o3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
        const a = N[k * 3]
        const b = N[k * 3 + 1]
        const c = N[k * 3 + 2]
        let nx = q[0] * a + q[3] * b + q[6] * c
        let ny = q[1] * a + q[4] * b + q[7] * c
        let nz = q[2] * a + q[5] * b + q[8] * c
        const l = Math.hypot(nx, ny, nz)
        if (l > 1e-6 && Number.isFinite(l)) {
          nx /= l
          ny /= l
          nz /= l
        } else {
          // a degenerate triangle's corner (where an arch meets its jambs): any normal but none, which would light it NaN
          nx = 0
          ny = 1
          nz = 0
        }
        nor[o3] = nx
        nor[o3 + 1] = ny
        nor[o3 + 2] = nz
        uv[(vo + k) * 2] = U[k * 2]
        uv[(vo + k) * 2 + 1] = U[k * 2 + 1]
      }
      // a mirrored placement turns the triangles inside out: wind them back
      const flip = m.determinant() < 0
      if (geo.index) {
        const I = geo.index.array
        for (let k = 0; k < I.length; k += 3) {
          idx[io++] = I[k] + vo
          idx[io++] = I[flip ? k + 2 : k + 1] + vo
          idx[io++] = I[flip ? k + 1 : k + 2] + vo
        }
      } else
        for (let k = 0; k < n; k += 3) {
          idx[io++] = vo + k
          idx[io++] = vo + (flip ? k + 2 : k + 1)
          idx[io++] = vo + (flip ? k + 1 : k + 2)
        }
      vo += n
    }
    const merged = own(new THREE.BufferGeometry())
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    merged.setIndex(new THREE.BufferAttribute(idx, 1))
    merged.computeBoundingSphere()
    const mesh = new THREE.Mesh(merged, mat)
    mesh.matrixAutoUpdate = false
    g.add(mesh)
  }
}

/** Pulled towards the camera so a ground layer never flickers into the one beneath. */
function layer<T extends THREE.Material>(m: T, k: number): T {
  m.polygonOffset = true
  m.polygonOffsetFactor = -k
  m.polygonOffsetUnits = -2 * k
  return m
}

/** Where a building's face stands, for a row along `face` on the building line `line`, from a, w wide. */
function faceB(face: Face, line: number, a: number, w: number, y0: number): THREE.Matrix4 {
  if (face === 'S') return local(a + w, y0, line, 1, 1, 1, Math.PI)
  if (face === 'N') return local(a, y0, line)
  if (face === 'W') return local(line, y0, a, 1, 1, 1, -Math.PI / 2)
  return local(line, y0, a + w, 1, 1, 1, Math.PI / 2)
}

export function buildStreet(sc: StreetCtx): StreetBuild {
  const { group, solids, blocks, own, index } = sc
  const g = new THREE.Group()
  group.add(g)
  const r = rng(4000 + index)
  const y0 = STREET.y
  const plan = planCity(index)
  const std = (o: THREE.MeshStandardMaterialParameters) => own(new THREE.MeshStandardMaterial(o))
  const surf = (s: Surface, rough: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    std({ map: s.map, bumpMap: s.bump, bumpScale: 1.2, roughnessMap: s.rough, roughness: rough, ...extra })
  const as = asphalt()
  const pv = paving()
  const M: Mats = {
    brick: [surf(brick('stock', '#9a8158'), 0.92), surf(brick('red', '#8a4532'), 0.9), surf(brick('mansion', '#a14a30'), 0.88), surf(brick('dark', '#4f3b32'), 0.95)],
    stone: surf(ashlar('portland', '#c2bba8', 1.4, 2, 4, 2.4), 0.85),
    granite: surf(ashlar('granite', '#6f6e6c', 0.5, 2, 3, 2.4), 0.6),
    stucco: surf(stucco(), 0.9),
    faience: own(new THREE.MeshPhysicalMaterial({ map: faience().map, bumpMap: faience().bump, bumpScale: 0.35, roughness: 0.3, clearcoat: 0.45, clearcoatRoughness: 0.2, envMapIntensity: 0.6 })),
    concrete: std({ map: once('conc', () => metres(concrete(91, '#6c6b67', 0.03), 4)), roughness: 0.9 }),
    paintWhite: std({ color: 0xe6e2d6, roughness: 0.6 }),
    darkMetal: std({ color: 0x1d2022, roughness: 0.5, metalness: 0.6 }),
    lead: std({ color: 0x2c2f31, roughness: 0.7, metalness: 0.4 }),
    pots: std({ color: 0x8a4a2e, roughness: 0.85 }),
    pavement: surf(pv, 1, { envMapIntensity: 0.6 }),
    road: layer(surf(as, 1, { bumpScale: 0.8, envMapIntensity: 0.8 }), 1),
    white: layer(std({ color: 0xdcdcd4, roughness: 0.7 }), 3),
    yellow: layer(std({ color: 0xd8b622, roughness: 0.7 }), 3),
    pole: std({ color: 0x2b2f31, roughness: 0.45, metalness: 0.7 }),
    lampOn: std({ color: 0x000000, emissive: 0xffd2a0, emissiveIntensity: 4 }),
    lampOff: std({ color: 0x3a3c3e, roughness: 0.2, metalness: 0.5 }),
    red: own(new THREE.MeshPhysicalMaterial({ color: 0xa3150f, roughness: 0.4, clearcoat: 0.6 })),
    black: std({ color: 0x0c0d0e, roughness: 0.45 }),
    gold: std({ color: 0xc9a043, roughness: 0.3, metalness: 1 }),
    bark: std({ map: barkTex(), roughness: 0.95 }),
    glassPane: own(new THREE.MeshPhysicalMaterial({ color: 0x9fb0b8, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false })),
    bag: std({ color: 0x0a0a0b, roughness: 0.25 }),
    cardboard: std({ color: 0x8a6a40, roughness: 0.95 }),
    barrel: std({ color: 0x3e2618, roughness: 0.8, metalness: 0.4 }),
    sandbag: std({ color: 0x7a6a4a, roughness: 1 }),
    beacon: std({ color: 0x6a3a08, emissive: 0xffa020, emissiveIntensity: 0, roughness: 0.2, transparent: true, opacity: 0.92 }),
    stripes: std({ map: stripesTex(), roughness: 0.5 }),
    kiosk: std({ map: kioskTex(false), emissive: 0xffffff, emissiveMap: kioskTex(true), emissiveIntensity: 0.45, roughness: 0.45 }),
    manhole: layer(std({ map: ironTex('manhole'), roughness: 0.6, metalness: 0.5, transparent: true, alphaTest: 0.5 }), 4),
    grate: layer(std({ map: ironTex('grate'), roughness: 0.6, metalness: 0.5 }), 4),
    poolWarm: layer(own(new THREE.MeshBasicMaterial({ map: poolTex(), color: new THREE.Color(0.55, 0.38, 0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), 5),
    poolWhite: layer(own(new THREE.MeshBasicMaterial({ map: poolTex(), color: new THREE.Color(0.4, 0.38, 0.33), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), 5),
    proxy: std({ visible: false }),
    aviation: std({ color: 0x300000, emissive: 0xff1a10, emissiveIntensity: 0 }),
  }
  const V = vehicleMats(own)
  const glass = std({ color: 0x0f1418, roughness: 0.06, metalness: 0.85 })
  const lit = (map: THREE.Texture) => own(new THREE.MeshBasicMaterial({ map }))
  const I: Ctx['I'] = {
    glass: new Batch(PLANE, glass),
    room: new Batch(PLANE, lit(roomTex())),
    shop: new Batch(PLANE, lit(shopTex())),
    office: new Batch(PLANE, lit(officeTex())),
    shutter: new Batch(PLANE, std({ map: shutterTex(), roughness: 0.55, metalness: 0.5 })),
    board: new Batch(PLANE, std({ map: boardTex(), roughness: 0.9 })),
    arch: new Batch(ARCH, glass),
    archLit: new Batch(ARCH, lit(roomTex())),
    frameW: new Batch(BOX, M.paintWhite),
    frameD: new Batch(BOX, M.darkMetal),
    dress: new Batch(BOX, M.stone),
    pipe: new Batch(CYL, M.lead),
  }
  const c: Ctx = { g, own, solids, blocks, r, M, V, y0, index, I, signs: new Map(), lights: [], supplies: [] }
  const S = siteMats(c)
  const amber = std({ color: 0x3a2000, emissive: 0xffa010, emissiveIntensity: 0 })
  const SR = EW[0]
  const zN = EW[EW.length - 1].b1

  // ---------------------------------------------------------------- the ground
  const W0 = STREET.x0 - 12
  const W1 = AVENUE.x1 + 40
  flat(c, M.pavement, W0, W1, LANDING.endZ, STREET.z1 + 6, 0)
  // the roads: east-west the whole way (Station Road on out along the avenue), north-south between them
  for (const [i, e] of EW.entries()) flat(c, M.road, i === 0 ? W0 : STREET.x0, i === 0 ? W1 : STREET.x1, e.r0, e.r1, 0.004)
  for (const n of NS) flat(c, M.road, n.x - NS_ROAD, n.x + NS_ROAD, SR.r1 - 0.5, EW[EW.length - 1].r0 + 0.5, 0.004)
  // kerbs: granite along every edge of a road, open where another road joins; a dark gutter beside each
  const gutter = layer(std({ color: 0x15161a, roughness: 0.3 }), 2)
  const kerbX = (x0: number, x1: number, z: number, side: number) => {
    if (x1 - x0 < 0.2) return
    add(c, uvBox(x1 - x0, 0.1, 0.3), M.granite, local((x0 + x1) / 2, y0 + 0.03, z))
    flat(c, gutter, x0, x1, side > 0 ? z + 0.15 : z - 0.55, side > 0 ? z + 0.55 : z - 0.15, 0.006)
  }
  const kerbZ = (z0: number, z1: number, x: number, side: number) => {
    if (z1 - z0 < 0.2) return
    add(c, uvBox(0.3, 0.1, z1 - z0), M.granite, local(x, y0 + 0.03, (z0 + z1) / 2))
    flat(c, gutter, side > 0 ? x + 0.15 : x - 0.55, side > 0 ? x + 0.55 : x - 0.15, z0, z1, 0.006)
  }
  const broken = (x0: number, x1: number, at: number[], half: number): [number, number][] => {
    const out: [number, number][] = []
    let a = x0
    for (const x of [...at].sort((p, q) => p - q)) {
      if (x - half > a) out.push([a, x - half])
      a = Math.max(a, x + half)
    }
    if (a < x1) out.push([a, x1])
    return out
  }
  const nsX = NS.map((n) => n.x)
  for (const [i, e] of EW.entries()) {
    const xa = i === 0 ? W0 : STREET.x0
    const xb = i === 0 ? W1 : STREET.x1
    for (const [a, b] of broken(xa, xb, i === 0 ? [] : nsX, NS_ROAD)) kerbX(a, b, e.r0, 1)
    for (const [a, b] of broken(xa, xb, i === EW.length - 1 ? [] : nsX, NS_ROAD)) kerbX(a, b, e.r1, -1)
  }
  for (const n of NS)
    for (let i = 0; i < EW.length - 1; i++) {
      kerbZ(EW[i].r1, EW[i + 1].r0, n.x - NS_ROAD, 1)
      kerbZ(EW[i].r1, EW[i + 1].r0, n.x + NS_ROAD, -1)
    }
  // markings: dashed centre lines, double yellows on Station Road and single ones elsewhere, give-way lines, zebras
  const lineX = (x0: number, x1: number, z: number, w: number, mat: THREE.Material) => flat(c, mat, x0, x1, z - w / 2, z + w / 2, 0.01)
  const lineZ = (z0: number, z1: number, x: number, w: number, mat: THREE.Material) => flat(c, mat, x - w / 2, x + w / 2, z0, z1, 0.01)
  const zebras: [number, number][] = [[-8, 0], [34, 1], [-96, 2]]
  for (const [i, e] of EW.entries()) {
    const xa = i === 0 ? W0 : STREET.x0
    const xb = i === 0 ? W1 : STREET.x1
    const zc = (e.r0 + e.r1) / 2
    const zx = zebras.filter(([, k]) => k === i).map(([x]) => x)
    const cross = i > 0 && i < EW.length - 1 ? nsX : []
    for (let x = xa; x < xb - 3; x += 6) if (cross.every((nx) => Math.abs(x + 1.5 - nx) > NS_ROAD + 2) && zx.every((zz) => Math.abs(x - zz) > 6)) lineX(x, x + 3, zc, 0.12, M.white)
    for (const [a, b] of broken(xa, xb, [...(i === 0 ? [] : nsX), ...zx], NS_ROAD + 0.5)) lineX(a, b, e.r0 + 0.3, 0.1, M.yellow)
    for (const [a, b] of broken(xa, xb, [...(i === EW.length - 1 ? [] : nsX), ...zx], NS_ROAD + 0.5)) lineX(a, b, e.r1 - 0.3, 0.1, M.yellow)
    if (i === 0)
      for (const [a, b] of broken(xa, xb, [...nsX, ...zx], 5.5)) {
        lineX(a, b, e.r0 + 0.48, 0.1, M.yellow)
        lineX(a, b, e.r1 - 0.48, 0.1, M.yellow)
      }
  }
  for (const n of NS)
    for (let i = 0; i < EW.length - 1; i++) {
      const z0 = EW[i].r1
      const z1 = EW[i + 1].r0
      for (let z = z0 + 4; z < z1 - 6; z += 6) lineZ(z, z + 3, n.x, 0.12, M.white)
      lineZ(z0 + 0.3, z1 - 0.3, n.x - NS_ROAD + 0.3, 0.1, M.yellow)
      lineZ(z0 + 0.3, z1 - 0.3, n.x + NS_ROAD - 0.3, 0.1, M.yellow)
      // give way: a double dashed line across the mouth of each end, a triangle before it
      for (const [zz, s] of [[z0 + 0.7, 1], [z1 - 0.7, -1]] as [number, number][]) {
        for (let x = n.x - NS_ROAD + 0.3; x < n.x + NS_ROAD - 0.4; x += 0.9) {
          lineX(x, x + 0.5, zz, 0.18, M.white)
          lineX(x, x + 0.5, zz + s * 0.4, 0.18, M.white)
        }
        const tri = add(c, once('givetri', () => new THREE.CircleGeometry(1, 3)), M.white, new THREE.Matrix4())
        tri.rotation.set(-Math.PI / 2, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2)
        tri.scale.set(0.9, 2.2, 1)
        tri.position.set(n.x + (s > 0 ? -2.4 : 2.4), y0 + 0.011, zz + s * 5)
        tri.updateMatrix()
      }
    }
  for (const [zx, i] of zebras) {
    const e = EW[i]
    for (let z = e.r0 + 0.4; z < e.r1 - 0.4; z += 1.0) lineX(zx - 1.4, zx + 1.4, z + 0.25, 0.5, M.white)
    for (const s of [-1, 1])
      for (let k = 0; k < 8; k++) {
        const x = zx + s * (2.4 + k * 1.1)
        for (const zz of [e.r0 + 1.0, e.r1 - 1.0]) {
          const m = add(c, PLANE, M.white, new THREE.Matrix4())
          m.rotation.set(-Math.PI / 2, 0, (k % 2 ? 1 : -1) * 0.55)
          m.position.set(x, y0 + 0.012, zz)
          m.scale.set(1.2, 0.1, 1)
          m.updateMatrix()
        }
      }
    for (const zz of [e.r0 - 0.7, e.r1 + 0.7]) {
      beacon(c, zx - 1.6, zz)
      beacon(c, zx + 1.6, zz)
    }
  }
  const lookT = once('look', () => words('LOOK RIGHT', 512, 128, 'rgba(0,0,0,0)', '#e8e8e0', 'bold 92px Helvetica, Arial, sans-serif'))
  const lookM = layer(std({ map: lookT, transparent: true, roughness: 0.7 }), 4)
  for (const [zz, ry] of [[SR.r0 + 1.2, Math.PI], [SR.r1 - 1.2, 0]] as [number, number][]) {
    const m = add(c, PLANE, lookM, new THREE.Matrix4())
    m.rotation.set(-Math.PI / 2, 0, ry)
    m.position.set(-8 + 3.4, y0 + 0.012, zz)
    m.scale.set(2.4, 0.6, 1)
    m.updateMatrix()
  }
  // manholes and gullies
  for (let k = 0; k < 90; k++) {
    const e = EW[Math.floor(r() * EW.length)]
    const x = STREET.x0 + 8 + r() * (STREET.x1 - STREET.x0 - 16)
    const z = e.r0 + 1.5 + r() * (e.r1 - e.r0 - 3)
    const m = add(c, PLANE, M.manhole, new THREE.Matrix4())
    m.rotation.x = -Math.PI / 2
    m.position.set(x, y0 + 0.014, z)
    m.scale.setScalar(0.9)
    m.updateMatrix()
  }
  for (const [i, e] of EW.entries())
    for (let x = (i === 0 ? W0 : STREET.x0) + 4; x < (i === 0 ? W1 : STREET.x1) - 2; x += 11)
      for (const z of [e.r0 + 0.4, e.r1 - 0.4]) {
        if (nsX.some((nx) => Math.abs(x - nx) < NS_ROAD + 0.5)) continue
        const m = add(c, PLANE, M.grate, new THREE.Matrix4())
        m.rotation.x = -Math.PI / 2
        m.position.set(x, y0 + 0.013, z)
        m.scale.set(0.6, 0.4, 1)
        m.updateMatrix()
      }

  // ---------------------------------------------------------------- the buildings
  const floorsOf = (s: Style, core = false) =>
    s === 'terrace' ? 2 + Math.floor(r() * 2) : s === 'mansion' ? 4 + Math.floor(r() * 2) : s === 'office' ? 4 + Math.floor(r() * (core ? 4 : 3)) : s === 'warehouse' ? 3 + Math.floor(r() * 2) : (core ? 8 : 6) + Math.floor(r() * 5)
  const mix = (w: [Style, number][]) => () => {
    let k = r() * w.reduce((a, [, n]) => a + n, 0)
    for (const [s, n] of w) if ((k -= n) <= 0) return s
    return w[0][0]
  }
  const high = mix([['terrace', 5], ['mansion', 3], ['office', 1], ['warehouse', 0.5], ['modern', 0.5]])
  const core = mix([['office', 3.5], ['modern', 3], ['mansion', 2.5], ['terrace', 1]])
  const outer = mix([['warehouse', 3.5], ['terrace', 4], ['mansion', 1.5], ['office', 1]])
  const mid = mix([['terrace', 3.5], ['mansion', 3], ['office', 1.5], ['warehouse', 1], ['modern', 1]])
  /** A row of buildings along a building line (`face` is the way their fronts look), from a to b. */
  const row = (face: Face, line: number, from: number, to: number, pick: () => Style, o: { corners?: boolean; core?: boolean } = {}) => {
    const items: [number, number, Style][] = []
    let a = from
    while (a < to - 4) {
      const s = pick()
      let w = s === 'terrace' ? 10.4 + Math.floor(r() * 2) * 5.2 : s === 'modern' ? 15 + r() * 6 : 12 + r() * 8
      if (to - (a + w) < 6) w = to - a
      items.push([a, w, s])
      a += w
    }
    const flip = face === 'S' || face === 'E'
    items.forEach(([a, w, s], k) => {
      const first = k === 0
      const last = k === items.length - 1
      let cl = false
      let cr = false
      if (o.corners) {
        if (first) {
          if (flip) cr = true
          else cl = true
        }
        if (last) {
          if (flip) cl = true
          else cr = true
        }
      }
      building(c, faceB(face, line, a, w, y0), w, s, floorsOf(s, o.core), { depth: o.corners && (first || last) ? 13 : 10 + r() * 3, corners: [cl, cr] })
    })
  }
  /** The ordinary rows round a block: its north and south faces full length (turning the corners), its sides between. */
  const blockRows = (b: CityBlock, pick: () => Style) => {
    const coreBlock = b.col === 2 || b.col === 3
    row('S', b.z0, b.x0, b.x1, pick, { corners: true, core: coreBlock })
    row('N', b.z1, b.x0, b.x1, pick, { corners: true, core: coreBlock })
    row('W', b.x0, b.z0 + 13.3, b.z1 - 13.3, pick, { core: coreBlock })
    row('E', b.x1, b.z0 + 13.3, b.z1 - 13.3, pick, { core: coreBlock })
  }
  // the station's front and, either side of it, the south side of Station Road
  stationFront(c, STATION_FRONT.x0, STATION_FRONT.x1)
  row('N', LANDING.endZ, STREET.x0 - 13, STATION_FRONT.x0, high)
  row('N', LANDING.endZ, STATION_FRONT.x1, STREET.x1, high)
  // the blocks
  const parkName = ['Kherve Gardens', 'Photon Park', 'Lattice Fields', 'Spectrum Green'][index % 4]
  for (const b of plan.blocks) {
    const pick = b.row === 0 ? high : b.col === 2 || b.col === 3 ? core : b.col === 0 || b.col === 5 ? outer : mid
    if (b.kind === 'buildings') blockRows(b, pick)
    else if (b.kind === 'park') park(c, b, parkName)
    else if (b.kind === 'square') square(c, b)
    else if (b.kind === 'church') church(c, b)
    else if (b.kind === 'petrol') petrol(c, b, (face, from, to) => (face === 'N' ? row('N', b.z1, from, to, pick, { corners: true }) : row(face, face === 'W' ? b.x0 : b.x1, from, to, pick)))
    else if (b.kind === 'carpark') carpark(c, b)
    else if (b.kind === 'works') works(c, b)
    else if (b.kind === 'mart') mart(c, b)
    else if (b.kind === 'hospital') hospital(c, b)
  }
  // the edges of the city: the far side of Observatory Road (the town hall at the end of Kherve Street), the west and east sides
  row('S', zN, STREET.x0 - 13, -22, outer)
  row('S', zN, 22, STREET.x1 + 13, outer)
  townHall(c, -22, 22, zN)
  row('E', STREET.x0, SR.b1 - 4, zN, outer)
  row('W', STREET.x1, LANDING.endZ, AVENUE.z0 - 1.2, outer)
  row('W', STREET.x1, AVENUE.z1 + 1.2, zN, outer)
  // the avenue east, both sides, into the haze
  row('N', AVENUE.z0 - 1.2, STREET.x1 + 0.5, W1, mid)
  row('S', AVENUE.z1 + 1.2, STREET.x1 + 0.5, W1, mid)
  // the checkpoint across the west end of Station Road
  checkpoint(c, STREET.x0 - 1, LANDING.endZ, SR.b1 - 4)

  // ---------------------------------------------------------------- street furniture
  const nearNS = (x: number, d: number) => NS.some((n) => Math.abs(x - n.x) < d)
  const nearEW = (z: number, d: number) => EW.some((e) => z > e.b0 - d && z < e.b1 + d)
  const station = (x: number) => x > STATION_FRONT.x0 - 2 && x < STATION_FRONT.x1 + 2
  // lamps on every street, staggered either side; most dead
  for (const [i, e] of EW.entries()) {
    const xb = i === 0 ? AVENUE.x1 + 30 : STREET.x1 - 4
    for (let x = STREET.x0 + 6; x < xb; x += 26) {
      if (!(i > 0 && nearNS(x, NS_ROAD + 2.5))) lamp(c, x, e.r0 - 0.6, 0, 1, r() < 0.55)
      const x2 = x + 13
      if (x2 < xb && !(i < EW.length - 1 && nearNS(x2, NS_ROAD + 2.5))) lamp(c, x2, e.r1 + 0.6, 0, -1, r() < 0.5, i === 0 && Math.abs(x2 + 30) < 8 ? 0.12 : 0)
    }
  }
  for (const n of NS)
    for (let z = SR.b1 + 7; z < zN - 6; z += 26) {
      if (!nearEW(z, 2)) lamp(c, n.x - NS_ROAD - 0.6, z, 1, 0, r() < 0.5)
      if (!nearEW(z + 13, 2) && z + 13 < zN - 6) lamp(c, n.x + NS_ROAD + 0.6, z + 13, -1, 0, r() < 0.5)
    }
  // trees along Station Road and Market Street
  for (const [i, e] of EW.entries()) {
    if (i > 1) continue
    for (let x = STREET.x0 + 12; x < STREET.x1 - 6; x += 13) {
      if (r() < 0.25) continue
      if (!station(x + 6.5) && !(i > 0 && nearNS(x + 6.5, NS_ROAD + 3))) tree(c, x + 6.5, e.r0 - 2.2, Math.round(x * 7))
      if (!nearNS(x, NS_ROAD + 3)) tree(c, x, e.r1 + 2.2, Math.round(x * 3 + i))
    }
  }
  // the corners: a bollard, the name plates of both streets on the walls, now and then a bin, a cabinet or a pillar box
  for (const n of NS)
    for (const e of EW)
      for (const sx of [-1, 1])
        for (const [zz, has] of [[e.b0 - 0.5, e !== SR], [e.b1 + 0.5, e !== EW[EW.length - 1]]] as [number, boolean][]) {
          if (!has) continue
          const cx = n.x + sx * (NS_HALF - 0.5)
          const face = zz > e.b1 ? 1 : -1
          bollard(c, n.x + sx * (NS_ROAD + 0.5), zz + face * 1.2)
          // the plates go on the corner building's walls (if a building stands on that corner)
          const qx = n.x + sx * (NS_HALF + 2)
          const corner = plan.blocks.find((q) => qx > q.x0 && qx < q.x1 && zz + face * 2 > q.z0 && zz + face * 2 < q.z1)
          const walls = corner ? corner.kind === 'buildings' || (corner.kind === 'petrol' && face < 0) : true
          if (walls) {
            namePlate(c, n.name, n.x + sx * (NS_HALF - 0.04), 3.1, zz + face * 2.6, sx > 0 ? -Math.PI / 2 : Math.PI / 2)
            namePlate(c, e.name, n.x + sx * (NS_HALF + 2.0), 3.1, face > 0 ? e.b1 - 0.04 : e.b0 + 0.04, face > 0 ? Math.PI : 0)
          }
          const roll = r()
          if (roll < 0.3) bin(c, cx - sx * 1.2, zz + face * 1.4)
          else if (roll < 0.45) {
            bx(c, S.green, cx - sx * 1.6, 0.6, zz + face * 1.0, 0.9, 1.2, 0.45)
            solidArea(c, cx - sx * 1.6 - 0.5, cx - sx * 1.6 + 0.5, zz + face * 1.0 - 0.3, zz + face * 1.0 + 0.3)
          } else if (roll < 0.55) postbox(c, cx - sx * 1.6, zz + face * 1.4)
        }
  // traffic lights at crossroads of Market and Lantern Streets, and where Kherve Street meets Station Road
  const signals: [number, number, number][] = []
  for (const n of NS)
    for (const i of [1, 2]) {
      if (r() < 0.4 && n.x !== 0) continue
      const e = EW[i]
      signals.push([n.x - NS_ROAD - 0.7, e.r0 - 0.7, Math.PI], [n.x + NS_ROAD + 0.7, e.r1 + 0.7, 0])
    }
  signals.push([NS[3].x - NS_ROAD - 0.7, SR.r1 + 0.7, 0], [NS[3].x + NS_ROAD + 0.7, SR.r1 + 0.7, 0])
  for (const [x, z, ry] of signals) trafficLight(c, x, z, ry, amber)
  // the station's forecourt: bollards before the entrances and the ways out, bins, sandbags, a fallen barrier
  for (const sx of STAIRS) {
    for (const d of [-3.4, -2.6, 2.6, 3.4]) bollard(c, sx + d, LANDING.endZ + 1.0)
    bin(c, sx + 5.2, 33.0)
    const ox = outDoorX(sx)
    for (const d of [-2.0, 2.0]) bollard(c, ox + d, LANDING.endZ + 1.6)
  }
  kiosk(c, -13.0, SR.r1 + 3.2, Math.PI)
  kiosk(c, -11.8, SR.r1 + 3.2, Math.PI)
  postbox(c, 7.5, 32.9)
  shelter(c, 15.5, SR.r1 + 2.4)
  bin(c, 21.5, SR.r1 + 1.3, true)
  bin(c, -36, 33.1)
  for (const [x, z] of [[-44, 51], [-27, 51.2], [24, 51], [44, 28], [-48, 25.5], [8, 24.8]]) rubbish(c, x, z)
  sandbags(c, STAIRS[1] + 3.2, 25, STAIRS[1] + 5.8, 25, 2)
  {
    const bar = new THREE.Matrix4().compose(new THREE.Vector3(STAIRS[0] - 4.5, y0 + 0.25, 27.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.15, 0.6, 0)), new THREE.Vector3(1, 1, 1))
    add(c, BOX, M.pole, bar.clone().multiply(local(0, 0, 0, 2.3, 0.05, 1.1)))
    for (let k = -5; k <= 5; k++) add(c, BOX, M.pole, bar.clone().multiply(local(k * 0.2, 0.02, 0, 0.025, 0.04, 1.0)))
  }
  // bus shelters on the main streets (a bench beside), phone boxes
  for (const [x, i] of [[-110, 0], [96, 0], [-40, 1], [100, 1], [-150, 1]] as [number, number][]) {
    const e = EW[i]
    shelter(c, x, e.r1 + 2.4)
    bench(c, x + 4.0, e.r1 + 4.2, Math.PI)
  }
  for (const [x, z] of [[-75, EW[1].r0 - 3], [140, EW[2].r1 + 3.2], [-160, SR.r0 - 6]]) {
    kiosk(c, x, z, z > 100 ? Math.PI : 0)
    kiosk(c, x + 1.2, z, z > 100 ? Math.PI : 0)
  }
  // rubbish heaped against the walls
  for (let k = 0; k < 70; k++) {
    if (r() < 0.6) {
      const e = EW[Math.floor(r() * EW.length)]
      const x = STREET.x0 + 4 + r() * (STREET.x1 - STREET.x0 - 8)
      if (nearNS(x, NS_HALF + 1) || (e === SR && station(x))) continue
      rubbish(c, x, r() < 0.5 && e !== SR ? e.b0 - 1.0 : e.b1 + 1.0)
    } else {
      const n = NS[Math.floor(r() * NS.length)]
      const z = SR.b1 + 2 + r() * (zN - SR.b1 - 4)
      if (nearEW(z, 1)) continue
      rubbish(c, n.x + (r() < 0.5 ? -1 : 1) * (NS_HALF - 1.0), z)
    }
  }
  // a police cordon round a crash on Market Street: cones, tape
  {
    const x = NS[1].x + 22
    const z = EW[1].r0 + 3
    carAt(c, 'police', 'abandoned', x, z, 0.4)
    carAt(c, 'saloon', 'smashed', x + 4.5, z + 1.2, -0.6)
    for (let k = 0; k < 7; k++) cone(c, x - 4 + k * 1.6, z + 4, k === 2 || k === 5)
    const tape = std({ color: 0xf0d020, roughness: 0.6, side: THREE.DoubleSide })
    for (const [ax, az, bx2, bz] of [[x - 5, z - 3, x + 8, z - 3], [x + 8, z - 3, x + 8, z + 4], [x - 5, z + 4, x + 8, z + 4]]) {
      const len = Math.hypot(bx2 - ax, bz - az)
      add(c, PLANE, tape, local((ax + bx2) / 2, y0 + 1.0, (az + bz) / 2, len, 0.08, 1, -Math.atan2(bz - az, bx2 - ax)))
    }
  }
  // rubble where a facade came down; crash barriers dragged across two streets
  const built = plan.blocks.filter((q) => q.kind === 'buildings')
  for (let k = 0; k < 4 && built.length; k++) {
    const b = built[Math.floor(r() * built.length)]
    const x = b.x0 + 8 + r() * (b.x1 - b.x0 - 16)
    rubble(c, x, r() < 0.5 ? b.z0 - 2.4 : b.z1 + 2.4, 1.6 + r())
  }
  for (const [x, z] of [[NS[4].x - 3, EW[2].r0 + 2], [NS[2].x + 2, EW[1].r1 - 3]]) {
    jersey(c, x, z, Math.PI / 2 + 0.2)
    jersey(c, x + 3.2, z + 0.3, Math.PI / 2 - 0.1)
  }

  // ---------------------------------------------------------------- vehicles, left where they stopped
  const kinds: CarKind[] = ['hatch', 'saloon', 'estate', 'suv', 'hatch', 'saloon', 'van']
  const pickKind = () => kinds[Math.floor(r() * kinds.length)]
  const pickState = (): CarState => (r() < 0.45 ? 'parked' : r() < 0.7 ? 'abandoned' : r() < 0.85 ? 'smashed' : 'burnt')
  const zebraNear = (x: number, i: number) => zebras.some(([zx, k]) => k === i && Math.abs(x - zx) < 7)
  const car = (kind: CarKind, state: CarState, x: number, z: number, heading: number) => carAt(c, kind, state, x, z, heading)
  // parked along the kerbs of the east-west streets (none at the junctions, the crossings, the station's doors)
  for (const [i, e] of EW.entries())
    for (const [z, side] of [[e.r0 + 1.25, 1], [e.r1 - 1.25, -1]] as [number, number][]) {
      for (let x = STREET.x0 + 4; x < STREET.x1 - 4; x += 6.2 + r() * 3) {
        const joins = (side > 0 && i > 0) || (side < 0 && i < EW.length - 1)
        if ((joins && nearNS(x, NS_ROAD + 4)) || zebraNear(x, i) || r() < 0.76) continue
        if (i === 0 && side > 0 && STAIRS.some((sx) => Math.abs(x - sx) < 6)) continue
        car(pickKind(), pickState(), x, z, r() < 0.5 ? 0 : Math.PI)
      }
    }
  for (const n of NS)
    for (let i = 0; i < EW.length - 1; i++)
      for (let z = EW[i].r1 + 5; z < EW[i + 1].r0 - 5; z += 6.2 + r() * 3)
        for (const side of [-1, 1]) if (r() < 0.13) car(pickKind(), pickState(), n.x + side * (NS_ROAD - 1.25), z, Math.PI / 2 + (r() < 0.5 ? 0 : Math.PI))
  // in the lanes: stopped at angles, doors open; the police; a black cab
  car('cab', 'abandoned', -14.5, 38.2, 0.25)
  car('police', 'abandoned', 28.5, 37.6, Math.PI + 0.55)
  car(pickKind(), 'smashed', 6.5, 42.2, -0.4)
  car(pickKind(), 'burnt', 0.8, 38.0, 0.95)
  car(pickKind(), 'abandoned', 39.5, 41.5, Math.PI - 0.2)
  for (let k = 0; k < 26; k++) {
    if (r() < 0.55) {
      const i = Math.floor(r() * EW.length)
      const e = EW[i]
      const x = STREET.x0 + 10 + r() * (STREET.x1 - STREET.x0 - 20)
      if ((i === 0 && Math.abs(x) < 50) || zebraNear(x, i)) continue
      car(r() < 0.1 ? 'cab' : r() < 0.06 ? 'police' : pickKind(), pickState(), x, e.r0 + 3 + r() * (e.r1 - e.r0 - 6), (r() - 0.5) * 0.9 + (r() < 0.5 ? 0 : Math.PI))
    } else {
      const n = NS[Math.floor(r() * NS.length)]
      const z = SR.b1 + 6 + r() * (zN - SR.b1 - 12)
      if (nearEW(z, 3)) continue
      car(pickKind(), pickState(), n.x + (r() - 0.5) * 3, z, Math.PI / 2 + (r() - 0.5) * 0.9 + (r() < 0.5 ? 0 : Math.PI))
    }
  }
  for (let x = STREET.x1 + 14; x < W1 - 6; x += 9 + r() * 10) car(pickKind(), pickState(), x, 37 + r() * 6, (r() - 0.5) * 0.8 + (r() < 0.5 ? 0 : Math.PI))
  // the buses: one slewed across Station Road into a lamp post, one burnt out on Market Street
  vehicle(c, makeBus(V, true), -30, 43.3, -0.08)
  vehicle(c, makeBus(V, true), NS[4].x + 24, EW[1].r1 - 2.6, Math.PI + 0.12)

  // ---------------------------------------------------------------- fires: the barrels, the wrecks still burning
  const flames: { s: THREE.Sprite; base: THREE.Vector3; ph: number; size: number }[] = []
  const smoke: { s: THREE.Sprite; base: THREE.Vector3; t: number }[] = []
  const flameMat = own(new THREE.SpriteMaterial({ map: soft(), color: new THREE.Color(2.6, 1.1, 0.35), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
  const coreMat = own(new THREE.SpriteMaterial({ map: soft(), color: new THREE.Color(3.2, 2.4, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
  const smokeMat = own(new THREE.SpriteMaterial({ map: soft(), color: 0x1a1612, transparent: true, opacity: 0.45, depthWrite: false }))
  const fire = (x: number, z: number, y: number, size: number) => {
    for (let k = 0; k < 6; k++) {
      const s = new THREE.Sprite(k < 2 ? coreMat : flameMat)
      const base = new THREE.Vector3(x + (Math.random() - 0.5) * size * 0.5, y, z + (Math.random() - 0.5) * size * 0.5)
      s.position.copy(base)
      s.userData.keep = true
      g.add(s)
      flames.push({ s, base, ph: Math.random() * 10, size: size * (k < 2 ? 0.6 : 1) })
    }
    for (let k = 0; k < 5; k++) {
      const s = new THREE.Sprite(own(smokeMat.clone()))
      s.userData.keep = true
      g.add(s)
      smoke.push({ s, base: new THREE.Vector3(x, y + 0.5, z), t: k / 5 })
    }
    c.lights.push({ p: new THREE.Vector3(x, y + 0.9, z), color: 0xff7a30, power: 14 * size, range: 14 + size * 6 })
  }
  const barrels: [number, number][] = [[-14, 27], [3, 29], [14, 26.5], [NS[2].x + 7, EW[1].b1 + 2], [NS[5].x - 7, EW[2].b0 - 2], [NS[1].x + 8, EW[2].b1 + 2.5], [-120, SR.r0 - 4]]
  for (const [x, z] of barrels) {
    add(c, once('barrel', () => new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16, 1, true)), M.barrel, local(x, y0 + 0.45, z))
    blocks.push({ x0: x - 0.4, x1: x + 0.4, z0: z - 0.4, z1: z + 0.4 })
    fire(x, z, y0 + 0.95, 0.7)
  }
  fire(0.8, 38.0, y0 + 0.9, 1.6)
  fire(STREET.x1 + 4, AVENUE.z1 - 1.4, y0 + 1.3, 1.4)
  fire(NS[4].x + 22, EW[1].r1 - 2.6, y0 + 1.6, 1.8)
  const wreck = std({ color: 0x1a1512, roughness: 0.95, metalness: 0.3 })
  add(c, BOX, wreck, local(STREET.x1 + 4, y0 + 0.6, AVENUE.z1 - 1.4, 4.2, 1.2, 1.9))
  blocks.push({ x0: STREET.x1 + 1.9, x1: STREET.x1 + 6.1, z0: AVENUE.z1 - 2.35, z1: AVENUE.z1 })
  const fireLight = new THREE.PointLight(0xff7a30, 14, 24, 1.5)
  fireLight.position.set(1, y0 + 1.8, 31)
  // (the lights hang on the station's group: they stay put while the street is hidden, so no shader is rebuilt)
  group.add(fireLight)
  const avLight = new THREE.PointLight(0xff7a30, 10, 18, 1.6)
  avLight.position.set(STREET.x1 + 4, y0 + 2.4, AVENUE.z1 - 2)
  group.add(avLight)

  // ---------------------------------------------------------------- the way on: overground to the next station, or out of the city
  const last = index >= FINAL_STATION
  const signText = last ? 'WAY OUT  →  CITY LIMITS' : `→  ${stationAt(index + 1).name.toUpperCase()}  (on foot)`
  const signM = std({ map: once('way' + signText, () => words(signText, 1024, 176, last ? '#1d6a3a' : '#e8e2cf', last ? '#fff' : '#9a1c14', 'bold 64px Helvetica, Arial, sans-serif')), roughness: 0.8 })
  add(c, PLANE, signM, new THREE.Matrix4().compose(new THREE.Vector3(STREET.x1 + 1.2, y0 + 3.4, AVENUE.z0 - 0.35), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2 + 0.35), new THREE.Vector3(5.2, 0.9, 1)))
  for (const dz of [-2.2, 2.2]) {
    const px = STREET.x1 + 1.2 + Math.sin(0.35) * dz
    const pz = AVENUE.z0 - 0.35 + Math.cos(0.35) * dz
    add(c, CYL, M.pole, local(px, y0 + 1.9, pz, 0.07, 3.8, 0.07))
    blocks.push({ x0: px - 0.1, x1: px + 0.1, z0: pz - 0.1, z1: pz + 0.1 })
  }
  // evacuation signs along Station Road, and the way back to the station from Market Street
  const evac = last ? 'EVACUATION ROUTE  →  EAST' : `${stationAt(index + 1).name.toUpperCase()}  →  EAST`
  for (const x of [-150, -52, 76, 150]) board(c, evac, '#0b4a8a', '#ffffff', x, 2.6, SR.r1 + 1.1, 3.6, 0.6, Math.PI, 0.2, true)
  board(c, 'STATION  ↓', '#10226e', '#ffffff', NS[3].x + NS_ROAD + 1.4, 2.6, EW[1].r0 - 1.2, 2.4, 0.55, -Math.PI / 2, 0.2, true)

  // ---------------------------------------------------------------- supplies left about the streets
  for (let k = 0; k < 14; k++) {
    const n = NS[Math.floor(r() * NS.length)]
    const e = EW[Math.floor(r() * EW.length)]
    if (r() < 0.5) {
      const z = e.b1 + 6 + r() * 30
      if (z < zN - 2) c.supplies.push([n.x + (r() < 0.5 ? -1 : 1) * (NS_HALF - 1.6), y0, z])
    } else c.supplies.push([STREET.x0 + 20 + r() * (STREET.x1 - STREET.x0 - 40), y0, r() < 0.5 && e !== SR ? e.b0 - 1.6 : e.b1 + 1.6])
  }

  // ---------------------------------------------------------------- the sky and the moon (no fog on them; they follow the eye), the moon's light
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(175, 48, 20, 0, Math.PI * 2, 0, Math.PI * 0.56),
    own(new THREE.MeshBasicMaterial({ map: skyTex(), side: THREE.BackSide, fog: false, depthWrite: false })),
  )
  own(sky.geometry)
  sky.position.set(20, y0 - 8, 42)
  sky.renderOrder = -10
  sky.userData.keep = true
  sky.frustumCulled = false
  g.add(sky)
  const [mc, mg] = canvas(256, 256)
  const grad = mg.createRadialGradient(128, 128, 30, 128, 128, 128)
  grad.addColorStop(0, 'rgba(240,236,220,1)')
  grad.addColorStop(0.45, 'rgba(230,226,210,1)')
  grad.addColorStop(0.5, 'rgba(200,190,170,0.25)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  mg.fillStyle = grad
  mg.fillRect(0, 0, 256, 256)
  const moonM = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), own(new THREE.MeshBasicMaterial({ map: own(texture(mc)), transparent: true, fog: false, depthWrite: false })))
  own(moonM.geometry)
  moonM.position.set(-20, y0 + 60, 160)
  moonM.rotation.y = Math.PI
  moonM.renderOrder = -9
  moonM.userData.keep = true
  moonM.frustumCulled = false
  g.add(moonM)
  const moon = new THREE.DirectionalLight(0x9fb2e0, 0)
  moon.position.set(-40, y0 + 90, 150)
  moon.target.position.set(0, y0, 40)
  group.add(moon, moon.target)

  // ---------------------------------------------------------------- the few real lights: they go to the light spots nearest the eye
  const pool: THREE.PointLight[] = []
  for (let k = 0; k < POOL; k++) {
    const l = new THREE.PointLight(0xffc890, 0, 20, 1.4)
    l.position.set(0, -50, 0)
    group.add(l)
    pool.push(l)
  }
  const spots: LightSpot[] = c.lights
  let poolT = 0

  // ---------------------------------------------------------------- instanced windows and frames, then everything else merged; all of it reflects the night, not the station
  for (const b of Object.values(I)) b.build(g)
  const env = nightEnv()
  g.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | undefined
    if (mat && (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) (mat as THREE.MeshStandardMaterial).envMap = env
  })
  mergeStatic(g, own)
  // what can be hidden when far: every merged mesh and batch that is not the whole city at once
  const far: { o: THREE.Object3D; c: THREE.Vector3; r: number }[] = []
  for (const o of g.children) {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.geometry || o === sky || o === moonM || !m.visible) continue
    const inst = (m as unknown as THREE.InstancedMesh).isInstancedMesh
    if (!inst && !m.geometry.boundingSphere) m.geometry.computeBoundingSphere()
    const bs = inst ? (m as unknown as THREE.InstancedMesh).boundingSphere : m.geometry.boundingSphere
    if (!bs || bs.radius > 120) continue
    far.push({ o, c: bs.center.clone(), r: bs.radius })
  }
  let farT = 0
  let lastT = 0

  return {
    group: g,
    fire: fireLight,
    moon,
    plan,
    supplies: c.supplies,
    update(t: number, eye: THREE.Vector3, on: boolean) {
      const dt = Math.min(0.1, Math.max(0, t - lastT))
      lastT = t
      V.hazard.emissiveIntensity = t % 1.0 < 0.5 ? 3.2 : 0
      M.beacon.emissiveIntensity = (t + 0.3) % 1.2 < 0.6 ? 3.5 : 0.15
      amber.emissiveIntensity = (t + 0.1) % 1.4 < 0.7 ? 3.2 : 0.05
      M.aviation.emissiveIntensity = t % 1.6 < 0.25 ? 5 : 0.1
      V.blue.emissiveIntensity = Math.sin(t * 18) > 0 ? (t % 0.5 < 0.25 ? 7 : 0.2) : 0.2
      for (const f of flames) {
        const k = Math.sin(t * 9 + f.ph) * 0.5 + Math.sin(t * 23 + f.ph * 2) * 0.3
        f.s.position.set(f.base.x + Math.sin(t * 3 + f.ph) * 0.06 * f.size, f.base.y + (0.2 + k * 0.12) * f.size, f.base.z)
        f.s.scale.set(f.size * (0.7 + k * 0.15), f.size * (1.2 + k * 0.3), 1)
      }
      avLight.intensity = on ? 9 + Math.sin(t * 11) * 2 + Math.random() * 2 : 0
      for (const s of smoke) {
        const k = ((t * 0.12 + s.t) % 1 + 1) % 1
        s.s.position.set(s.base.x + k * 1.5, s.base.y + k * 7, s.base.z + Math.sin(k * 6 + s.t * 9) * 0.4)
        s.s.scale.setScalar(0.8 + k * 3.5)
        s.s.material.opacity = 0.45 * (1 - k) * Math.min(1, k * 6)
      }
      // the sky dome and the moon go where the eye goes
      sky.position.set(eye.x, y0 - 8, eye.z)
      moonM.position.set(eye.x - 40, y0 + 60, eye.z + 118)
      // the real lights: to the spots nearest the eye (a few times a second)
      poolT -= dt
      if (poolT <= 0) {
        poolT = 0.25
        const best = spots
          .map((s) => ({ s, d: s.p.distanceToSquared(eye) / (s.power + 4) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, POOL)
        pool.forEach((l, k) => {
          const b = best[k]
          if (!b || !on) {
            l.intensity = 0
            return
          }
          l.position.copy(b.s.p)
          l.color.setHex(b.s.color)
          l.intensity = b.s.power
          l.distance = b.s.range
        })
      }
      // what is lost in the haze is not drawn
      farT -= dt
      if (farT <= 0) {
        farT = 0.2
        for (const f of far) f.o.visible = Math.hypot(f.c.x - eye.x, f.c.z - eye.z) - f.r < 185
      }
    },
  }
}
