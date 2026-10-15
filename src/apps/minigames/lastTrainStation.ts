// Last Train: a station. Platform, tiled walls, columns, ceiling, lights,
// benches, posters, the track and the tunnels, the two stairways with the gate
// at the top, and the clutter that makes each station of the line look its own
// (lastTrainStyles.ts holds the table). Everything is drawn on canvases.

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import {
  archWallGeometry, box, canvas, ceilingTiles, CEIL_Y, concrete, cyl, FINAL_STATION, floorTexture, graffiti, gravel, LAMP_PITCH, LANDING,
  lineMap, panel, poster, REACH, rng, shade, stain, stairY, STAIR, STAIRS, stationAt, std, tactile, texture, tiles, tmpBox, tmpCyl, TRACK_Y,
  vaultGeometry, vaultY, vines, wallTexture, words, HALL,
} from './lastTrainWorld'
import { STYLES, type Decor, type StationStyle } from './lastTrainStyles'

/** An axis-aligned obstacle on the platform. */
export interface Block {
  x0: number
  x1: number
  z0: number
  z1: number
}

export interface Pillar {
  x: number
  z: number
  r: number
}

/** A stairway up to the street: the gate at the top and the crowd behind it. */
export interface ExitBuild {
  x: number
  /** 0 shut … 1 open: slides the gate apart and lets the daylight in. */
  setOpen(k: number): void
  /** Where the zombies of this stairway come out on the landing. */
  spawn: THREE.Vector3
  /** The far end of the ticket hall above the landing (they come through its gates). */
  hallSpawn: THREE.Vector3
  /** The red emergency light of the ticket hall (it flickers). */
  hallLight: THREE.PointLight
  /** Where the crowd stands behind the gate: [x, z] in station coordinates, y is the landing. */
  crowd: [number, number][]
  /** The things that rattle (the gate halves). */
  gate: THREE.Object3D
  /** The group the crowd is added to (it leaves with the station). */
  crowdGroup: THREE.Group
  light: THREE.PointLight
}

export interface StationBuild {
  group: THREE.Group
  /** Meshes bullets hit (walls, floors, pillars, furniture). */
  solids: THREE.Object3D[]
  /** The "next train" board (redrawn by the engine). */
  board: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }
  /** The signal lenses at the tunnel mouths. */
  signals: { red: THREE.MeshStandardMaterial; green: THREE.MeshStandardMaterial }
  /** The fluorescent tube that flickers, with its bright and dim intensities. */
  flicker: { mat: THREE.MeshStandardMaterial; light: THREE.PointLight; matOn: number; lightOn: number }
  /** Where bullet holes and pickups go (cleared with the station). */
  litter: THREE.Group
  pillars: Pillar[]
  blocks: Block[]
  exits: ExitBuild[]
  style: StationStyle
  /** The last station: its gate opens when the wave is cleared. */
  final: boolean
  dispose(): void
}

type Own = <T extends { dispose(): void }>(x: T) => T

export function buildStation(index: number): StationBuild {
  const st = stationAt(index)
  const style = STYLES[Math.min(index, STYLES.length - 1)]
  const final = index >= FINAL_STATION
  const r = rng(1000 + index * 77)
  const group = new THREE.Group()
  const solids: THREE.Object3D[] = []
  const blocks: Block[] = []
  const pillars: Pillar[] = []
  const owned: { dispose(): void }[] = []
  const own: Own = (x) => (owned.push(x), x)
  const solid = (m: THREE.Mesh) => (solids.push(m), m)
  const sc = style.wallScale

  const white = wallTexture(style.wall, style.wallColor, 11 + index, 1)
  const band = tiles(st.color, 31 + index, 0.4)
  owned.push(white.map, white.bump, band.map, band.bump)
  /** Wall tiles repeated rx × ry times per UV unit (panels have UVs in metres). */
  const wallMat = (rx: number, ry: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const map = white.map.clone()
    const bump = white.bump.clone()
    for (const t of [map, bump]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(rx, ry)
      t.needsUpdate = true
      own(t)
    }
    return own(std({ map, bumpMap: bump, bumpScale: style.wall === 'brick' ? 2.4 : 1.4, roughness: style.wallRough, metalness: style.wallMetal, ...extra }))
  }
  const wallPanel = wallMat(sc, sc)
  /** A coloured band w × h metres, its tiles at the scale of the wall's. */
  const bandMat = (w: number, h: number) => {
    const map = band.map.clone()
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(w * 1.5, h * 1.5)
    map.needsUpdate = true
    own(map)
    return own(std({ map, roughness: 0.2, metalness: 0 }))
  }

  const floorTex = own(floorTexture(style.floor, style.floorA, style.floorB, 41 + index))
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping
  floorTex.repeat.set(1 / 4, 1 / 4)
  const shiny = style.floor === 'checker' || style.floor === 'terrazzo' || style.floor === 'slate'
  const floorMat = own(std({ map: floorTex, roughness: shiny ? 0.34 : style.floor === 'plate' ? 0.45 : 0.55, metalness: style.floor === 'plate' ? 0.55 : 0.05 }))
  const darkConcrete = own(concrete(5, '#3b3a37', 0.03))
  darkConcrete.wrapS = darkConcrete.wrapT = THREE.RepeatWrapping
  darkConcrete.repeat.set(1 / 4, 1 / 4)
  const darkMat = own(std({ map: darkConcrete, roughness: 0.9 }))
  const metal = own(std({ color: 0x8a8d8f, roughness: 0.35, metalness: 0.85 }))
  const darkMetal = own(std({ color: 0x24272a, roughness: 0.5, metalness: 0.7 }))
  const black = own(std({ color: 0x0a0a0a, roughness: 0.9 }))
  const frame = own(std({ color: 0x1c1d1f, roughness: 0.4, metalness: 0.6 }))

  // -- platform slab, its edge, the yellow line, "mind the gap"
  const floor = solid(panel(group, floorMat, 80, 10.2))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0, 4.9)
  const edge = solid(box(group, darkMat, 80, 1.3, 0.25, 0, -0.65, 0.12))
  edge.receiveShadow = true
  box(group, own(std({ color: 0xbfbcb2, roughness: 0.7 })), 80, 0.06, 0.32, 0, -0.03, 0.04)
  const tact = own(tactile())
  tact.wrapS = tact.wrapT = THREE.RepeatWrapping
  tact.repeat.set(80 / 0.4, 1)
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(80, 0.4), own(std({ map: tact, roughness: 0.6 })))
  strip.rotation.x = -Math.PI / 2
  strip.position.set(0, 0.004, 0.45)
  group.add(strip)
  const gapTex = own(words('MIND THE GAP', 512, 96, 'rgba(0,0,0,0)', '#f2f2e8', 'bold 64px Helvetica, Arial, sans-serif'))
  const gapMat = own(new THREE.MeshStandardMaterial({ map: gapTex, transparent: true, roughness: 0.6, depthWrite: false }))
  for (const x of [-27, -2, 23]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.48), gapMat)
    m.rotation.x = -Math.PI / 2
    m.position.set(x, 0.005, 0.95)
    group.add(m)
  }

  // -- puddles, litter and blood
  const puddle = own(std({ color: 0x0b0c0c, roughness: 0.04, metalness: 0.3, transparent: true, opacity: 0.75 }))
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.5 + r() * 0.8, 24), puddle)
    m.scale.set(1.6 + r(), 1, 1)
    m.rotation.x = -Math.PI / 2
    m.position.set(-36 + r() * 72, 0.006, 1.5 + r() * 7)
    group.add(m)
  }
  const paper = own(std({ color: 0xd8d4c8, roughness: 0.95 }))
  const can = own(std({ color: 0xb03a2e, roughness: 0.3, metalness: 0.8 }))
  for (let i = 0; i < 14; i++) {
    const m = box(group, paper, 0.3 + r() * 0.2, 0.006, 0.4, -38 + r() * 76, 0.006, 1 + r() * 8.3)
    m.rotation.y = r() * Math.PI
  }
  for (let i = 0; i < 6; i++) {
    const m = cyl(group, can, 0.033, 0.12, -38 + r() * 76, 0.033, 1 + r() * 8.3, 'x')
    m.rotation.y = r() * Math.PI
  }
  const blood = [0, 1, 2].map((k) => own(stain(700 + index * 7 + k)))
  const bloodMats = blood.map((t) => own(new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })))
  for (let i = 0; i < 8; i++) {
    const s = 1 + r() * 1.6
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), bloodMats[i % 3])
    m.rotation.x = -Math.PI / 2
    m.rotation.z = r() * Math.PI * 2
    m.position.set(-34 + r() * 68, 0.008, 1.2 + r() * 7.8)
    group.add(m)
  }

  // -- what stands along the back wall (benches, bins, machines…) takes room in this list
  const used: [number, number][] = STAIRS.map((sx) => [sx - 2.8, sx + 2.8])
  const place = (x: number, w: number): boolean => {
    if (used.some(([a, b]) => x - w / 2 < b && x + w / 2 > a)) return false
    used.push([x - w / 2 - 0.25, x + w / 2 + 0.25])
    return true
  }
  const free = (cands: number[], w: number, n: number): number[] => {
    const out: number[] = []
    for (const x of cands) if (out.length < n && place(x, w)) out.push(x)
    return out
  }

  // -- back wall (z = 10) with two stair openings
  const segs: [number, number][] = [[-40, -22], [-18, 18], [22, 40]]
  const bandH = 0.42
  const dadoH = 1.1
  for (const [a, b] of segs) {
    const w = b - a
    const m = solid(panel(group, wallPanel, w, CEIL_Y))
    m.rotation.y = Math.PI
    m.position.set((a + b) / 2, CEIL_Y / 2, 10)
    if (style.band === 'stripe') solid(box(group, bandMat(w, bandH), w, bandH, 0.06, (a + b) / 2, 2.55, 9.97))
    else if (style.band === 'dado') {
      solid(box(group, bandMat(w, dadoH), w, dadoH, 0.06, (a + b) / 2, dadoH / 2 + 0.25, 9.97))
      box(group, darkMetal, w, 0.05, 0.09, (a + b) / 2, dadoH + 0.27, 9.96)
    }
    box(group, darkMat, w, 0.25, 0.04, (a + b) / 2, 0.125, 9.98)
  }
  const exits: ExitBuild[] = []
  for (const sx of STAIRS) {
    const lintel = solid(panel(group, wallPanel, 4, 1.5))
    lintel.rotation.y = Math.PI
    lintel.position.set(sx, 3.75, 10)
    exits.push(buildExit({ group, solids, blocks, own, wallPanel, floorMat, metal, darkMetal, black, final, style, sx, r }))
  }

  // name plaques, posters
  const nameTex = own(words(st.name.toUpperCase(), 1024, 160, '#f4f1e6', '#1d1d1b', 'bold 84px Helvetica, Arial, sans-serif', st.color))
  const nameMat = own(std({ map: nameTex, roughness: 0.3 }))
  for (const x of [-30, -10, 10, 30]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.66), nameMat)
    m.rotation.y = Math.PI
    m.position.set(x, 3.3, 9.95)
    group.add(m)
  }
  for (const [k, x] of [-25, -5, 15, 35].entries()) {
    const t = own(poster(k + index, 300 + index * 10 + k))
    solid(box(group, frame, 2.5, 1.7, 0.05, x, 1.65, 9.96))
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.36, 1.56), own(std({ map: t, roughness: 0.35 })))
    m.rotation.y = Math.PI
    m.position.set(x, 1.65, 9.93)
    group.add(m)
  }

  // benches, bins, the vending machine
  const wood = own(std({ color: 0x6b4a2b, roughness: 0.6 }))
  for (const x of style.benches) {
    place(x, 2.4)
    bench(group, x, wood, darkMetal, solids)
    blocks.push({ x0: x - 1.15, x1: x + 1.15, z0: 8.95, z1: 9.7 })
  }
  for (const x of [-12, 12, -32]) {
    place(x, 0.7)
    solid(cyl(group, darkMetal, 0.28, 0.85, x, 0.425, 9.45))
    cyl(group, metal, 0.29, 0.05, x, 0.86, 9.45)
    blocks.push({ x0: x - 0.32, x1: x + 0.32, z0: 9.1, z1: 9.8 })
  }
  if (style.vending) {
    place(31.5, 1.3)
    vending(group, 31.5, st.color, solids, own)
    blocks.push({ x0: 30.95, x1: 32.05, z0: 9.1, z1: 9.9 })
  }
  place(5, 5.4)
  mapBoard(group, 5, index, solids, own, frame)

  // -- pillars
  const ceilFlat = style.ceil !== 'vault'
  for (const x of style.pillars) pillars.push(buildPillar({ group, solids, own, wallMat, bandMat, darkMat, darkMetal, metal, nameMat, style, index, x, sc }))

  // -- ceiling and lights
  const ceilTex = own(style.ceil === 'panels' ? ceilingTiles(style.ceilColor, 9 + index) : concrete(9 + index, style.ceilColor, 0.02))
  ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping
  if (style.ceil === 'panels') ceilTex.repeat.set(1 / 4.8, 1 / 4.8)
  else ceilTex.repeat.set(1 / 5, 1 / 5)
  const ceilMat = own(std({ map: ceilTex, roughness: 0.95, side: THREE.DoubleSide }))
  const V = { hw: 7.3, rise: 1.3, zc: 2.7 }
  /** The ceiling height over z (the vault rises; the others are flat). */
  const ceilAt = (z: number) => (ceilFlat ? CEIL_Y : vaultY(z, V.hw, V.rise, CEIL_Y, V.zc))
  if (ceilFlat) {
    const ceil = solid(panel(group, ceilMat, 80, 14.6))
    ceil.rotation.x = Math.PI / 2
    ceil.position.set(0, CEIL_Y, 2.7)
  } else {
    const v = new THREE.Mesh(own(vaultGeometry(80, V.hw, V.rise, CEIL_Y, V.zc)), ceilMat)
    group.add(v)
    solids.push(v)
    // ribs under the vault, and the arched ends of the hall
    const ribMat = own(std({ color: shade(style.ceilColor, 0.8), roughness: 0.7 }))
    for (let x = -40; x <= 40; x += 5) {
      const rib = new THREE.Mesh(own(vaultGeometry(0.34, V.hw, V.rise, CEIL_Y - 0.12, V.zc, 24)), ribMat)
      rib.position.x = x
      group.add(rib)
    }
    const arch = wallMat(sc, sc, { side: THREE.DoubleSide })
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(own(archWallGeometry(s * 40, V.hw, V.rise, CEIL_Y, V.zc)), arch)
      group.add(a)
      solids.push(a)
    }
  }
  if (style.ceil === 'beams') {
    for (let x = -40; x <= 40; x += 5) box(group, darkMat, 0.35, 0.4, 14.6, x, CEIL_Y - 0.2, 2.7)
    if (index === 4) for (const z of [-3.8, 0, 3.8, 7.5]) box(group, darkMat, 80, 0.3, 0.35, 0, CEIL_Y - 0.15, z)
  } else if (style.ceil === 'ducts') {
    const duct = own(std({ color: 0x70787c, roughness: 0.5, metalness: 0.7 }))
    box(group, duct, 80, 0.7, 0.9, 0, CEIL_Y - 0.4, -1.1)
    box(group, duct, 80, 0.9, 1.2, 0, CEIL_Y - 0.5, 5.0)
    for (let x = -40; x <= 40; x += 4) {
      box(group, darkMetal, 0.08, 0.75, 1.0, x, CEIL_Y - 0.4, -1.1)
      box(group, darkMetal, 0.08, 0.95, 1.3, x, CEIL_Y - 0.5, 5.0)
    }
    const pipeMat = own(std({ color: index === 6 ? 0xc0602a : 0x4a5a64, roughness: 0.5, metalness: 0.6 }))
    for (const [z, rad] of [[2.5, 0.1], [3.0, 0.07], [8.6, 0.12], [-2.6, 0.08]] as const) cyl(group, pipeMat, rad, 80, 0, CEIL_Y - 0.3, z, 'x')
    box(group, darkMetal, 80, 0.04, 0.45, 0, CEIL_Y - 0.1, 7.2)
    for (let x = -40; x <= 40; x += 0.6) box(group, darkMetal, 0.03, 0.03, 0.45, x, CEIL_Y - 0.12, 7.2)
  }
  for (const [z, rad] of [[-3.9, 0.09], [-3.6, 0.06], [9.6, 0.12]] as const) cyl(group, darkMetal, rad, 80, 0, ceilAt(z) - 0.4, z, 'x')
  box(group, darkMetal, 80, 0.04, 0.5, 0, 3.75, -3.7)

  // lights: fixtures along the platform, one flickering
  const tubeMat = own(std({ color: 0xffffff, emissive: style.lightColor, emissiveIntensity: 3.2 }))
  const flickerMat = own(std({ color: 0xffffff, emissive: style.lightColor, emissiveIntensity: 3.2 }))
  const housing = own(std({ color: 0xcfd2cc, roughness: 0.5, metalness: 0.4 }))
  const cageMat = own(std({ color: 0x222222, roughness: 0.6, metalness: 0.5 }))
  const rows = style.light === 'strip' ? [0.5, 2.7, 4.9] : [2.2, 7.2]
  const flickerAt = Math.floor(r() * rows.length * 8)
  let k = 0
  for (const z of rows) {
    for (let x = -35; x <= 35; x += 10) {
      const m = k === flickerAt ? flickerMat : tubeMat
      const ceilY = ceilAt(z)
      switch (style.light) {
        case 'globe': {
          const hang = ceilY - 4.0
          cyl(group, darkMetal, 0.008, hang, x, ceilY - hang / 2, z)
          box(group, darkMetal, 0.12, 0.05, 0.12, x, 4.02, z)
          const g = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), m)
          g.position.set(x, 3.84, z)
          group.add(g)
          break
        }
        case 'panel':
          box(group, housing, 1.3, 0.05, 0.7, x, ceilY - 0.03, z)
          box(group, m, 1.2, 0.03, 0.6, x, ceilY - 0.06, z)
          break
        case 'strip':
          box(group, housing, 9.4, 0.05, 0.2, x, ceilY - 0.06, z)
          box(group, m, 9.2, 0.03, 0.1, x, ceilY - 0.09, z)
          break
        case 'cage': {
          cyl(group, darkMetal, 0.006, 0.4, x, ceilY - 0.2, z)
          cyl(group, darkMetal, 0.006, 0.4, x + 0.12, ceilY - 0.2, z)
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), m)
          bulb.position.set(x + 0.06, ceilY - 0.52, z)
          group.add(bulb)
          box(group, cageMat, 0.3, 0.02, 0.3, x + 0.06, ceilY - 0.4, z)
          for (const [cx, cz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]] as const) cyl(group, cageMat, 0.006, 0.26, x + 0.06 + cx, ceilY - 0.53, z + cz)
          box(group, cageMat, 0.3, 0.02, 0.3, x + 0.06, ceilY - 0.66, z)
          break
        }
        default:
          box(group, housing, 2.5, 0.08, 0.3, x, 4.22, z)
          box(group, m, 2.35, 0.05, 0.07, x, 4.16, z - 0.06)
          box(group, m, 2.35, 0.05, 0.07, x, 4.16, z + 0.06)
      }
      k++
    }
  }
  if (index === 7) {
    // the skylights of the last stop: pale daylight through the vault
    const sky = own(std({ color: 0xffffff, emissive: 0xbcd6ff, emissiveIntensity: 1.4, roughness: 0.4 }))
    for (let x = -35; x <= 35; x += 10) {
      box(group, sky, 3.6, 0.04, 2.4, x, vaultY(2.7, V.hw, V.rise, CEIL_Y, V.zc) - 0.05, 2.7)
      box(group, darkMetal, 3.7, 0.05, 0.06, x, vaultY(2.7, V.hw, V.rise, CEIL_Y, V.zc) - 0.07, 2.7)
      box(group, darkMetal, 0.06, 0.05, 2.5, x, vaultY(2.7, V.hw, V.rise, CEIL_Y, V.zc) - 0.07, 2.7)
    }
  }
  let flickerLight: THREE.PointLight | null = null
  const lightOn = 14 * style.lightPower
  for (let x = -35; x <= 35; x += 10) {
    const l = new THREE.PointLight(style.lightColor, lightOn, 17, 1.4)
    l.position.set(x, 3.95, 4.2)
    group.add(l)
    if (!flickerLight && Math.abs(x - (-35 + (flickerAt % 8) * 10)) < 1) flickerLight = l
  }
  const trackLight = new THREE.PointLight(0xdfeee8, 6, 16, 1.5)
  trackLight.position.set(0, 3.6, -2.2)
  group.add(trackLight)

  // -- the hanging clock and the next-train board
  const clock = own(clockFace())
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.32, 40), own(std({ map: clock, roughness: 0.3 })))
    m.position.set(-16, 3.35, 2.2 + s * 0.06)
    if (s < 0) m.rotation.y = Math.PI
    group.add(m)
  }
  cyl(group, darkMetal, 0.35, 0.1, -16, 3.35, 2.2, 'z')
  cyl(group, darkMetal, 0.015, 0.8, -16, 3.95, 2.2)
  const [bc] = canvas(512, 96)
  const boardTex = own(texture(bc))
  const boardMat = own(std({ color: 0x000000, emissive: 0xffffff, emissiveMap: boardTex, emissiveIntensity: 1.6 }))
  for (const x of [-20, 20]) {
    box(group, darkMetal, 3.0, 0.62, 0.22, x, 3.25, 2.2)
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.5), boardMat)
      m.position.set(x, 3.25, 2.2 + s * 0.115)
      if (s < 0) m.rotation.y = Math.PI
      group.add(m)
    }
    cyl(group, darkMetal, 0.015, 0.9, x - 1.2, 3.95, 2.2)
    cyl(group, darkMetal, 0.015, 0.9, x + 1.2, 3.95, 2.2)
  }

  // -- end walls of the platform
  for (const s of [-1, 1]) {
    const m = solid(panel(group, wallPanel, 10, CEIL_Y))
    m.rotation.y = (-s * Math.PI) / 2
    m.position.set(s * 40, CEIL_Y / 2, 5)
    const door = box(group, own(std({ color: 0x3c4a44, roughness: 0.5, metalness: 0.5 })), 0.06, 2.1, 1.1, s * 39.97, 1.05, 7.5)
    solids.push(door)
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.24),
      own(std({ map: own(words('STAFF ONLY', 256, 56, '#b22a1f', '#fff', 'bold 34px Helvetica, Arial, sans-serif')) })),
    )
    sign.position.set(s * 39.93, 2.35, 7.5)
    sign.rotation.y = (-s * Math.PI) / 2
    group.add(sign)
    // the portal over the tunnel mouth
    const p = solid(panel(group, wallPanel, 4.6, 1.3))
    p.rotation.y = (-s * Math.PI) / 2
    p.position.set(s * 40, 3.85, -2.3)
  }

  // -- the track: bed, sleepers, rails, third rail, the far wall with posters
  const grav = own(gravel())
  grav.wrapS = grav.wrapT = THREE.RepeatWrapping
  grav.repeat.set(REACH, 2)
  const bed = solid(new THREE.Mesh(new THREE.PlaneGeometry(REACH * 2, 4.6), own(std({ map: grav, roughness: 1 }))))
  bed.rotation.x = -Math.PI / 2
  bed.position.set(0, TRACK_Y, -2.3)
  group.add(bed)
  const sleeperMat = own(std({ color: 0x5f5a52, roughness: 0.95 }))
  const nSleepers = Math.floor((REACH * 2) / 0.7)
  const sleepers = new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.24, 0.14, 2.5)), sleeperMat, nSleepers)
  const mtx = new THREE.Matrix4()
  for (let i = 0; i < nSleepers; i++) {
    mtx.makeTranslation(-REACH + i * 0.7, TRACK_Y + 0.07, -1.75)
    sleepers.setMatrixAt(i, mtx)
  }
  group.add(sleepers)
  const railMat = own(std({ color: 0x6b6058, roughness: 0.45, metalness: 0.9 }))
  const railTop = own(std({ color: 0xd6d8da, roughness: 0.18, metalness: 1 }))
  for (const z of [-1.75 - 0.72, -1.75 + 0.72]) {
    box(group, railMat, REACH * 2, 0.14, 0.07, 0, TRACK_Y + 0.21, z)
    box(group, railTop, REACH * 2, 0.025, 0.075, 0, TRACK_Y + 0.29, z)
  }
  box(group, own(std({ color: 0x8a6a3a, roughness: 0.8 })), REACH * 2, 0.05, 0.3, 0, TRACK_Y + 0.33, -0.4)
  box(group, metal, REACH * 2, 0.08, 0.08, 0, TRACK_Y + 0.25, -0.4)

  const far = solid(panel(group, wallPanel, 80, CEIL_Y - TRACK_Y))
  far.position.set(0, (CEIL_Y + TRACK_Y) / 2, -4.6)
  if (style.band === 'stripe') box(group, bandMat(80, bandH), 80, bandH, 0.06, 0, 2.55, -4.57)
  else if (style.band === 'dado') box(group, bandMat(80, dadoH), 80, dadoH, 0.06, 0, dadoH / 2 + 0.25, -4.57)
  const farName = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.66), nameMat)
  for (const x of [-20, 0, 20]) {
    const m = farName.clone()
    m.position.set(x, 3.3, -4.55)
    group.add(m)
  }
  for (let i = 0; i < 9; i++) {
    const x = -32 + i * 8
    if (Math.abs(x - 0) < 3 || Math.abs(x - 20) < 3 || Math.abs(x + 20) < 3) continue
    const t = own(poster(i + 3 + index, 500 + index * 13 + i))
    box(group, frame, 2.7, 1.8, 0.05, x, 1.0, -4.57)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.56, 1.66), own(std({ map: t, roughness: 0.35 })))
    m.position.set(x, 1.0, -4.54)
    group.add(m)
  }

  // -- signals at the tunnel mouths
  const red = own(std({ color: 0x200000, emissive: 0xff2a1a, emissiveIntensity: 4 }))
  const green = own(std({ color: 0x002000, emissive: 0x22ff66, emissiveIntensity: 0 }))
  for (const s of [-1, 1]) {
    box(group, black, 0.3, 0.75, 0.25, s * 39, 2.2, -4.2)
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 10), red)
    a.position.set(s * 39, 2.38, -4.06)
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 10), green)
    b.position.set(s * 39, 2.08, -4.06)
    group.add(a, b)
  }

  // -- tunnels beyond both ends
  for (const s of [-1, 1]) buildTunnel(group, s, solids, own)

  // -- what makes the station its own: clutter, graffiti
  const ctx: DecorCtx = { group, solids, blocks, own, r, style, index, place, free, wallPanel }
  for (const d of style.decor) DECOR[d](ctx)
  const ink = ['#e8372c', '#f2f0e2', '#ffd23a', '#58e0ff']
  const spots = free([-15, 25, -33, 35, -1, 14, -26], 2.8, 2)
  spots.forEach((x, i) => {
    const t = own(graffiti(style.graffiti[i % style.graffiti.length], ink[(index + i * 2) % ink.length], 60 + index * 3 + i))
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 0.84), own(new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, color: 0xcccccc })))
    m.rotation.y = Math.PI
    m.position.set(x, 1.45 + r() * 0.2, 9.94)
    group.add(m)
  })

  const litter = new THREE.Group()
  group.add(litter)

  return {
    group,
    solids,
    board: { canvas: bc, tex: boardTex },
    signals: { red, green },
    flicker: { mat: flickerMat, light: flickerLight ?? trackLight, matOn: 3.2, lightOn },
    litter,
    pillars,
    blocks,
    exits,
    style,
    final,
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry && m.geometry !== tmpBox && m.geometry !== tmpCyl) m.geometry.dispose()
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose()
      })
      for (const o of owned) o.dispose()
    },
  }
}

// ---------------------------------------------------------------- pillars

interface PillarCtx {
  group: THREE.Group
  solids: THREE.Object3D[]
  own: Own
  wallMat: (rx: number, ry: number, extra?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial
  bandMat: (w: number, h: number) => THREE.MeshStandardMaterial
  darkMat: THREE.Material
  darkMetal: THREE.Material
  metal: THREE.Material
  nameMat: THREE.Material
  style: StationStyle
  index: number
  x: number
  sc: number
}

function hazardTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64)
  g.fillStyle = '#e8b81c'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#17181a'
  for (let i = -2; i < 4; i++) {
    g.beginPath()
    g.moveTo(i * 32, 0)
    g.lineTo(i * 32 + 16, 0)
    g.lineTo(i * 32 + 16 + 64, 64)
    g.lineTo(i * 32 + 64, 64)
    g.fill()
  }
  return texture(c)
}

function buildPillar(c: PillarCtx): Pillar {
  const { group, solids, own, wallMat, bandMat, darkMat, darkMetal, metal, nameMat, style, x, sc } = c
  const z = 5
  const H = CEIL_Y
  const add = (m: THREE.Mesh) => (solids.push(m), m)
  switch (style.pillar) {
    case 'round': {
      const R = 0.42
      const m = add(new THREE.Mesh(own(new THREE.CylinderGeometry(R, R, H, 28, 1)), wallMat(2 * Math.PI * R * sc, H * sc)))
      m.position.set(x, H / 2, z)
      group.add(m)
      const ring = (y: number, h: number, mat: THREE.Material, rad = R + 0.03) => {
        const k = new THREE.Mesh(own(new THREE.CylinderGeometry(rad, rad, h, 28, 1)), mat)
        k.position.set(x, y, z)
        group.add(k)
        return k
      }
      const gold = own(std({ color: 0xc9a14a, roughness: 0.3, metalness: 0.9 }))
      ring(2.55, 0.42, style.band === 'stripe' ? bandMat(2 * Math.PI * R, 0.42) : (gold as THREE.Material))
      ring(2.82, 0.05, gold, R + 0.045)
      ring(2.28, 0.05, gold, R + 0.045)
      ring(0.14, 0.28, darkMat, R + 0.09)
      ring(H - 0.14, 0.28, darkMat, R + 0.09)
      return { x, z, r: 0.5 }
    }
    case 'ribbed': {
      const R = 0.5
      const mat = wallMat(2 * Math.PI * R * sc, H * sc, { flatShading: true })
      const m = add(new THREE.Mesh(own(new THREE.CylinderGeometry(R, R, H, 12, 1)), mat))
      m.position.set(x, H / 2, z)
      group.add(m)
      for (const [y, h] of [[0.15, 0.3], [H - 0.15, 0.3], [2.4, 0.12]] as const) {
        const k = new THREE.Mesh(own(new THREE.CylinderGeometry(R + 0.08, R + 0.08, h, 12, 1)), darkMat)
        k.position.set(x, y, z)
        group.add(k)
      }
      return { x, z, r: 0.56 }
    }
    case 'girder': {
      const paint = own(std({ color: style.band === 'dado' ? 0xc8662a : 0x7a3b2b, roughness: 0.6, metalness: 0.45 }))
      const hz = own(new THREE.MeshStandardMaterial({ map: own(hazardTexture()), roughness: 0.6 }))
      hz.map!.wrapS = hz.map!.wrapT = THREE.RepeatWrapping
      hz.map!.repeat.set(1, 1)
      for (const s of [-1, 1]) add(box(group, paint, 0.62, H, 0.1, x, H / 2, z + s * 0.26))
      add(box(group, paint, 0.1, H, 0.42, x, H / 2, z))
      add(box(group, darkMetal, 0.9, 0.1, 0.9, x, 0.05, z))
      add(box(group, darkMetal, 0.9, 0.1, 0.9, x, H - 0.05, z))
      for (const [bx, bz] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]] as const) cyl(group, metal, 0.035, 0.14, x + bx, 0.16, z + bz)
      // rivet rows and a hazard-striped foot
      for (let y = 0.9; y < H - 0.2; y += 0.7)
        for (const s of [-1, 1]) for (const dx of [-0.24, 0.24]) cyl(group, metal, 0.02, 0.025, x + dx, y, z + s * 0.315, 'z')
      box(group, hz, 0.7, 0.6, 0.7, x, 0.4, z).scale.set(0.66, 0.6, 0.62)
      return { x, z, r: 0.5 }
    }
    default: {
      const m = add(new THREE.Mesh(new THREE.BoxGeometry(0.8, H, 0.8), wallMat(0.8 * sc, H * sc)))
      m.position.set(x, H / 2, z)
      group.add(m)
      box(group, bandMat(0.84, 0.42), 0.84, 0.42, 0.84, x, 2.55, z)
      box(group, darkMat, 0.84, 0.25, 0.84, x, 0.125, z)
      for (const s of [-1, 1]) {
        const n = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.13), nameMat)
        n.position.set(x, 1.85, z + s * 0.415)
        if (s < 0) n.rotation.y = Math.PI
        group.add(n)
      }
      return { x, z, r: 0.62 }
    }
  }
}

// ---------------------------------------------------------------- stairs and the gate

interface ExitCtx {
  group: THREE.Group
  solids: THREE.Object3D[]
  blocks: Block[]
  own: Own
  wallPanel: THREE.Material
  floorMat: THREE.Material
  metal: THREE.Material
  darkMetal: THREE.Material
  black: THREE.Material
  final: boolean
  style: StationStyle
  sx: number
  r: () => number
}

function streetTexture(day: boolean, seed: number): THREE.CanvasTexture {
  const W = 512
  const H = 320
  const [c, g] = canvas(W, H)
  const r = rng(seed)
  const sky = g.createLinearGradient(0, 0, 0, H)
  if (day) {
    sky.addColorStop(0, '#7db8ff')
    sky.addColorStop(0.55, '#d8ecff')
    sky.addColorStop(1, '#fff3d0')
  } else {
    sky.addColorStop(0, '#05070d')
    sky.addColorStop(0.6, '#1a1218')
    sky.addColorStop(1, '#4a2216')
  }
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  if (day) {
    const sun = g.createRadialGradient(W * 0.7, H * 0.28, 4, W * 0.7, H * 0.28, 110)
    sun.addColorStop(0, 'rgba(255,255,240,1)')
    sun.addColorStop(1, 'rgba(255,240,200,0)')
    g.fillStyle = sun
    g.fillRect(0, 0, W, H)
  }
  // buildings
  let x = -10
  while (x < W) {
    const w = 30 + r() * 60
    const h = 60 + r() * 150
    g.fillStyle = day ? shade('#9aa9bd', 0.8 + r() * 0.3) : shade('#0e0d12', 0.8 + r() * 0.8)
    g.fillRect(x, H - h, w, h)
    for (let wy = H - h + 10; wy < H - 10; wy += 16)
      for (let wx = x + 5; wx < x + w - 8; wx += 12) {
        g.fillStyle = day ? 'rgba(255,255,255,0.45)' : r() < 0.12 ? 'rgba(255,190,90,0.85)' : 'rgba(0,0,0,0.25)'
        g.fillRect(wx, wy, 6, 8)
      }
    x += w + r() * 6
  }
  if (!day) {
    // street lamps and a red haze of fires
    for (const lx of [60, 210, 380, 470]) {
      const gl = g.createRadialGradient(lx, H - 70, 2, lx, H - 70, 60)
      gl.addColorStop(0, 'rgba(255,170,80,0.85)')
      gl.addColorStop(1, 'rgba(255,120,40,0)')
      g.fillStyle = gl
      g.fillRect(lx - 60, H - 130, 120, 120)
    }
    const haze = g.createLinearGradient(0, H * 0.55, 0, H)
    haze.addColorStop(0, 'rgba(160,40,20,0)')
    haze.addColorStop(1, 'rgba(160,40,20,0.5)')
    g.fillStyle = haze
    g.fillRect(0, H * 0.55, W, H * 0.45)
  } else {
    // trees and a green street
    for (let i = 0; i < 18; i++) {
      const tx = r() * W
      g.fillStyle = `hsl(${100 + r() * 30},45%,${30 + r() * 15}%)`
      g.beginPath()
      g.arc(tx, H - 36 - r() * 12, 14 + r() * 16, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = '#6f7a66'
    g.fillRect(0, H - 26, W, 26)
  }
  return texture(c)
}

function signTexture(lines: [string, string][], bg: string, fg: string, w = 512, h = 256): THREE.CanvasTexture {
  const [c, g] = canvas(w, h)
  g.fillStyle = bg
  g.fillRect(0, 0, w, h)
  g.strokeStyle = fg
  g.lineWidth = 8
  g.strokeRect(10, 10, w - 20, h - 20)
  g.fillStyle = fg
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const step = (h - 40) / lines.length
  lines.forEach(([t, font], i) => {
    g.font = font
    g.fillText(t, w / 2, 20 + step * (i + 0.5))
  })
  return texture(c)
}

function buildExit(c: ExitCtx): ExitBuild {
  const { group, solids, own, wallPanel, floorMat, metal, darkMetal, final, sx, r } = c
  const g = new THREE.Group()
  group.add(g)
  const add = (m: THREE.Mesh) => (solids.push(m), m)
  const gateZ = LANDING.gateZ
  const top = LANDING.y
  const wallD = own((wallPanel as THREE.MeshStandardMaterial).clone())
  wallD.side = THREE.DoubleSide

  // steps with a pale nosing
  const nosing = own(std({ color: 0xd8cf9a, roughness: 0.7 }))
  for (let i = 0; i < STAIR.steps; i++) {
    const h = STAIR.rise * (i + 1)
    add(box(g, floorMat, 3.9, h, 0.32, sx, h / 2, STAIR.z0 + 0.16 + i * STAIR.tread))
    box(g, nosing, 3.9, 0.025, 0.06, sx, h + 0.002, STAIR.z0 + i * STAIR.tread + 0.03)
  }
  // the landing, walls, roof, the closing panel above the opening
  const landing = add(panel(g, floorMat, 4, LANDING.endZ - LANDING.z0))
  landing.rotation.x = -Math.PI / 2
  landing.position.set(sx, top, (LANDING.z0 + LANDING.endZ) / 2)
  const len = LANDING.endZ - STAIR.z0
  for (const s of [-1, 1]) {
    if (s === 1) {
      const w = add(panel(g, wallPanel, len, 7))
      w.rotation.y = -Math.PI / 2
      w.position.set(sx + 2, 3.5, STAIR.z0 + len / 2)
    } else {
      // the left wall, with the staff doorway cut out of it
      const piece = (z0: number, z1: number, y0: number, y1: number) => {
        const w = add(panel(g, wallD, z1 - z0, y1 - y0))
        w.rotation.y = Math.PI / 2
        w.position.set(sx - 2, (y0 + y1) / 2, (z0 + z1) / 2)
      }
      piece(STAIR.z0, HALL.doorZ0, 0, 7)
      piece(HALL.doorZ1, LANDING.endZ, 0, 7)
      piece(HALL.doorZ0, HALL.doorZ1, 0, top)
      piece(HALL.doorZ0, HALL.doorZ1, top + 2.1, 7)
    }
    // handrail along the slope, then along the landing
    const rise = top - 1.0
    const run = LANDING.z0 - STAIR.z0
    const rail = cyl(g, metal, 0.03, Math.hypot(rise, run), sx + s * 1.85, 1.0 + rise / 2 + 0.9, STAIR.z0 + run / 2, 'z')
    rail.rotation.x = Math.PI / 2 - Math.atan2(rise, run)
    cyl(g, metal, 0.03, gateZ - LANDING.z0 - 0.2, sx + s * 1.85, top + 0.9, (LANDING.z0 + gateZ - 0.2) / 2, 'z')
    for (let i = 0; i <= 6; i++) {
      const z = STAIR.z0 + (run * i) / 6
      cyl(g, metal, 0.015, 0.9, sx + s * 1.85, stairY(z) + 0.45, z)
    }
  }
  const roofMat = own(std({ color: 0x1a1a19, roughness: 1 }))
  const roof = panel(g, roofMat, 4, len)
  roof.rotation.x = Math.PI / 2
  roof.position.set(sx, top + 3.0, STAIR.z0 + len / 2)
  const closing = solid3(panel(g, wallPanel, 4, 2.3), solids)
  closing.rotation.y = Math.PI
  closing.position.set(sx, 5.65, 10)
  const exit = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.36),
    own(std({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 1.8, emissiveMap: own(words('EXIT ↑', 256, 76, '#118a3a', '#fff', 'bold 50px Helvetica, Arial, sans-serif')) })),
  )
  exit.rotation.y = Math.PI
  exit.position.set(sx, 3.2, 9.94)
  group.add(exit)
  // lamps on the landing
  const lamp = own(std({ color: 0xffffff, emissive: 0xffd9a8, emissiveIntensity: 3 }))
  for (const s of [-1, 1]) {
    box(g, darkMetal, 0.14, 0.2, 0.3, sx + s * 1.92, top + 2.2, 16.6)
    box(g, lamp, 0.06, 0.12, 0.22, sx + s * 1.85, top + 2.2, 16.6)
  }
  const light = new THREE.PointLight(0xff9a5a, 5, 11, 1.6)
  light.position.set(sx, top + 1.7, 17.0)
  g.add(light)

  // the staff door on the landing, swung open against the wall: the stairwell up to the ticket hall behind it
  const doorZ = HALL.laneZ
  const wx = sx - 1.99
  const frameM = own(std({ color: 0x2a2f31, roughness: 0.5, metalness: 0.6 }))
  box(g, frameM, 0.14, 0.1, 1.2, wx, top + 2.15, doorZ)
  for (const s of [-1, 1]) box(g, frameM, 0.14, 2.15, 0.1, wx, top + 1.07, doorZ + s * 0.55)
  const hinge = new THREE.Group()
  hinge.position.set(wx + 0.06, top, doorZ - 0.5)
  hinge.rotation.y = Math.PI - 0.12
  g.add(hinge)
  const leaf = box(hinge, own(std({ color: 0x3a4a44, roughness: 0.5, metalness: 0.5 })), 0.05, 2.1, 1.0, 0, 1.05, 0.5)
  solids.push(leaf)
  const stencil = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.18),
    own(std({ map: own(words('STAFF', 192, 64, '#d9b31c', '#1b1b1b', 'bold 40px Helvetica, Arial, sans-serif')), roughness: 0.6 })),
  )
  stencil.position.set(wx + 0.08, top + 2.35, doorZ)
  stencil.rotation.y = Math.PI / 2
  g.add(stencil)
  const hallLight = buildHall(c, g, wallD)
  const spawn = new THREE.Vector3(sx - 1.25, top, doorZ + 0.25)
  /** The far end of the ticket hall, where the broken shutter lets them in. */
  const hallSpawn = new THREE.Vector3(sx - 2 - (HALL.u1 - 0.8), HALL.y, (HALL.z0 + HALL.z1) / 2)

  // the street behind the gate
  const night = new THREE.Mesh(new THREE.PlaneGeometry(4, 3.0), own(new THREE.MeshBasicMaterial({ map: own(streetTexture(false, 500 + sx)), color: 0xbbbbbb })))
  night.rotation.y = Math.PI
  night.position.set(sx, top + 1.5, LANDING.endZ - 0.05)
  g.add(night)
  const day = new THREE.Mesh(new THREE.PlaneGeometry(4, 3.0), own(new THREE.MeshBasicMaterial({ map: own(streetTexture(true, 600 + sx)), transparent: true, opacity: 0, depthWrite: false })))
  day.rotation.y = Math.PI
  day.position.set(sx, top + 1.5, LANDING.endZ - 0.04)
  g.add(day)

  // the gate: two halves of bars that slide into the walls
  const gateGroup = new THREE.Group()
  gateGroup.position.set(sx, top, gateZ)
  g.add(gateGroup)
  const bar = own(std({ color: 0x3c4146, roughness: 0.55, metalness: 0.8 }))
  const rust = own(std({ color: 0x5a3a28, roughness: 0.85, metalness: 0.5 }))
  const halves: THREE.Group[] = []
  for (const s of [-1, 1]) {
    const h = new THREE.Group()
    gateGroup.add(h)
    halves.push(h)
    const hx = (x: number) => s * x
    add(box(h, bar, 1.97, 0.1, 0.07, hx(0.985), 0.12, 0))
    add(box(h, bar, 1.97, 0.1, 0.07, hx(0.985), 1.5, 0))
    add(box(h, bar, 1.97, 0.12, 0.07, hx(0.985), 2.94, 0))
    add(box(h, bar, 0.09, 3.0, 0.09, hx(1.93), 1.5, 0))
    add(box(h, bar, 0.09, 3.0, 0.09, hx(0.045), 1.5, 0))
    for (let i = 0; i < 14; i++) cyl(h, i % 4 === 3 ? rust : bar, 0.018, 2.85, hx(0.12 + i * 0.13), 1.5, 0)
    // a zig-zag brace
    const brace = box(h, bar, 0.03, 2.1, 0.03, hx(0.98), 0.8, 0.02)
    brace.rotation.z = s * 0.82
  }
  // the chain, the padlock and the notice on the bars
  const chainBits = new THREE.Group()
  gateGroup.add(chainBits)
  const chain = own(std({ color: 0x6c7276, roughness: 0.4, metalness: 0.95 }))
  for (let i = -5; i <= 5; i++) {
    const link = new THREE.Mesh(own(new THREE.TorusGeometry(0.035, 0.01, 6, 10)), chain)
    link.position.set(i * 0.06, 1.45 + Math.sin(i * 0.9) * 0.015, -0.06)
    link.rotation.y = (i % 2) * (Math.PI / 2)
    chainBits.add(link)
  }
  box(chainBits, own(std({ color: 0xb8902a, roughness: 0.3, metalness: 1 })), 0.12, 0.15, 0.06, 0, 1.3, -0.07)
  const noticeTex = own(
    final
      ? signTexture([['EXIT', 'bold 92px Helvetica, Arial, sans-serif'], ['street level', '34px Helvetica, Arial, sans-serif']], '#118a3a', '#fff')
      : signTexture([['CLOSED', 'bold 88px Helvetica, Arial, sans-serif'], ['Do not open — use the train', '30px Helvetica, Arial, sans-serif']], '#a8231b', '#fff'),
  )
  const notice = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), own(std({ map: noticeTex, roughness: 0.5 })))
  notice.position.set(0.6, 2.2, -0.05)
  notice.rotation.z = 0.05
  halves[1].add(notice)
  chainBits.rotation.z = 0.02

  // the crowd's places
  const crowd: [number, number][] = [
    [-1.3, 0.62], [-0.65, 0.55], [0, 0.68], [0.65, 0.55], [1.3, 0.62],
    [-0.95, 1.55], [-0.3, 1.5], [0.35, 1.58], [1.0, 1.5],
    [-1.4, 2.5], [0, 2.6], [1.3, 2.5],
  ].map(([dx, dz]) => [sx + dx + (r() - 0.5) * 0.12, gateZ + dz + (r() - 0.5) * 0.1])
  const crowdGroup = new THREE.Group()
  g.add(crowdGroup)

  const setOpen = (k: number) => {
    const e = k * k * (3 - 2 * k)
    halves[0].position.x = -e * 2.0
    halves[1].position.x = e * 2.0
    chainBits.visible = k < 0.02
    night.visible = k < 1
    day.material.opacity = e
    light.color.setRGB(1, 0.6 + e * 0.32, 0.35 + e * 0.5)
    light.intensity = 5 + e * 10
  }
  setOpen(0)

  return { x: sx, setOpen, spawn, hallSpawn, crowd, gate: gateGroup, crowdGroup, light, hallLight }
}

/** The stairwell behind the staff door and the ticket hall above it: its gates, its broken shutter. */
function buildHall(c: ExitCtx, g: THREE.Group, wallD: THREE.Material): THREE.PointLight {
  const { solids, blocks, own, floorMat, darkMetal, metal, black, sx, style } = c
  const add = (m: THREE.Mesh) => (solids.push(m), m)
  const X = (u: number) => sx - 2 - u
  const top = LANDING.y
  const H = HALL
  const ceil = H.y + H.height
  const lane = H.laneZ
  /** A wall facing +x (into the stairway side) or -x, z0..z1 × y0..y1 at u. */
  const wallU = (u: number, z0: number, z1: number, y0: number, y1: number) => {
    const w = add(panel(g, wallD, z1 - z0, y1 - y0))
    w.rotation.y = Math.PI / 2
    w.position.set(X(u), (y0 + y1) / 2, (z0 + z1) / 2)
  }
  /** A wall across z, u0..u1 × y0..y1. */
  const wallZ = (z: number, u0: number, u1: number, y0: number, y1: number) => {
    const w = add(panel(g, wallD, u1 - u0, y1 - y0))
    w.position.set(X((u0 + u1) / 2), (y0 + y1) / 2, z)
  }
  const flat = (mat: THREE.Material, u0: number, u1: number, z0: number, z1: number, y: number, down = false) => {
    const f = add(panel(g, mat, u1 - u0, z1 - z0))
    f.rotation.x = down ? Math.PI / 2 : -Math.PI / 2
    f.position.set(X((u0 + u1) / 2), y, (z0 + z1) / 2)
    return f
  }
  const roofMat = own(std({ color: 0x1d1d1c, roughness: 1 }))

  // -- the stairwell: a flat bit inside the door, ten steps up, its walls and roof
  flat(floorMat, -0.02, H.flightU0, H.flightZ0, H.flightZ1, top)
  const nosing = own(std({ color: 0xd8cf9a, roughness: 0.7 }))
  for (let i = 0; i < H.steps; i++) {
    const h = H.rise * (i + 1)
    const u = H.flightU0 + 0.15 + i * 0.3
    add(box(g, floorMat, 0.3, h, H.flightZ1 - H.flightZ0, X(u), top + h / 2, lane))
    box(g, nosing, 0.06, 0.025, H.flightZ1 - H.flightZ0, X(u - 0.12), top + h + 0.002, lane)
  }
  wallZ(H.flightZ0, 0, H.flightU1, top - 0.1, ceil)
  wallZ(H.flightZ1, 0, H.flightU1, top - 0.1, ceil)
  wallU(0, H.flightZ0, H.flightZ1, 7, ceil)
  flat(roofMat, 0, H.flightU1, H.flightZ0, H.flightZ1, ceil, true)
  // a caged bulkhead lamp halfway up
  const bulb = own(std({ color: 0xffffff, emissive: 0xffe0b0, emissiveIntensity: 2.5 }))
  box(g, darkMetal, 0.5, 0.12, 0.2, X(1.9), top + 3.6, H.flightZ1 - 0.1)
  box(g, bulb, 0.36, 0.07, 0.12, X(1.9), top + 3.52, H.flightZ1 - 0.12)
  // the rail up the flight
  const rise = H.y - top
  const run = H.flightU1 - H.flightU0
  const rail = cyl(g, metal, 0.03, Math.hypot(rise, run), X(H.flightU0 + run / 2), top + rise / 2 + 0.9, H.flightZ0 + 0.15, 'x')
  rail.rotation.z = Math.atan2(rise, run)

  // -- the hall: floor, roof, four walls (the near one open onto the stairwell)
  flat(floorMat, H.flightU1, H.u1, H.z0, H.z1, H.y)
  const tilesTex = own(ceilingTiles('#9a9a90', 300 + sx))
  tilesTex.wrapS = tilesTex.wrapT = THREE.RepeatWrapping
  tilesTex.repeat.set(1 / 2, 1 / 2)
  flat(own(std({ map: tilesTex, roughness: 0.85 })), H.flightU1, H.u1, H.z0, H.z1, ceil, true)
  wallU(H.flightU1, H.z0, H.flightZ0, H.y, ceil)
  wallU(H.flightU1, H.flightZ1, H.z1, H.y, ceil)
  wallU(H.flightU1, H.flightZ0, H.flightZ1, H.y + 2.5, ceil)
  wallU(H.u1, H.z0, H.z1, H.y, ceil)
  wallZ(H.z0, H.flightU1, H.u1, H.y, ceil)
  wallZ(H.z1, H.flightU1, H.u1, H.y, ceil)
  // ceiling strip lights, all dead but one
  const deadTube = own(std({ color: 0x9a9a92, roughness: 0.4 }))
  const liveTube = own(std({ color: 0xffffff, emissive: 0xe8f0ff, emissiveIntensity: 2.6 }))
  for (const u of [6, 12]) for (const z of [14.5, 19.5]) box(g, u === 6 && z === 19.5 ? liveTube : deadTube, 2.2, 0.06, 0.16, X(u), ceil - 0.05, z)
  const tube = new THREE.PointLight(0xdfe8ff, 6, 16, 1.3)
  tube.position.set(X(7), ceil - 0.4, 18.5)
  g.add(tube)

  // -- the ticket gates: a line of cabinets across the hall, glass paddles shut, the wide gate in the middle forced open
  const body = own(std({ color: 0x2e3236, roughness: 0.45, metalness: 0.7 }))
  const steel = own(std({ color: 0xb9bdbf, roughness: 0.25, metalness: 0.95 }))
  const glass = own(std({ color: 0xbfd8e0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false }))
  const green = own(std({ color: 0x000000, emissive: 0x22ff66, emissiveIntensity: 2.2 }))
  const red = own(std({ color: 0x000000, emissive: 0xff2a22, emissiveIntensity: 2.2 }))
  const cu0 = H.gatesU - 0.55
  const cu1 = H.gatesU + 0.55
  const cab: number[] = []
  for (let k = 0; k < 4; k++) cab.push(lane - H.laneW - 0.11 - k * 0.95)
  for (let k = 0; k < 5; k++) cab.push(lane + H.laneW + 0.11 + k * 0.95)
  for (const z of cab) {
    add(box(g, body, 1.1, 1.0, 0.22, X(H.gatesU), H.y + 0.5, z))
    box(g, steel, 1.12, 0.04, 0.24, X(H.gatesU), H.y + 1.02, z)
    for (const end of [-1, 1]) box(g, Math.abs(z - lane) < 1.2 ? green : red, 0.02, 0.08, 0.1, X(H.gatesU + end * 0.56), H.y + 0.9, z)
    // a card reader on top
    box(g, darkMetal, 0.2, 0.05, 0.16, X(H.gatesU - 0.3), H.y + 1.06, z)
  }
  // shut paddles in the narrow lanes
  for (let i = 0; i < cab.length - 1; i++) {
    const a = cab[i]
    const b = cab[i + 1]
    if (Math.abs(b - a) > 1.2 || (a - lane) * (b - lane) < 0) continue
    const mid = (a + b) / 2
    const half = Math.abs(b - a) / 2 - 0.11
    for (const s of [-1, 1]) add(box(g, glass, 0.03, 0.7, half - 0.02, X(H.gatesU), H.y + 0.75, mid + (s * (half + 0.0)) / 2))
  }
  // the wide gate: its two glass doors bent back
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group()
    hinge.position.set(X(H.gatesU - 0.4), H.y, lane + s * (H.laneW - 0.02))
    hinge.rotation.y = s * 1.35
    g.add(hinge)
    add(box(hinge, glass, 0.03, 1.2, 0.7, 0, 0.75, -s * 0.35))
  }
  // the gate line is solid except for the wide gate
  blocks.push(
    { x0: X(cu1), x1: X(cu0), z0: H.z0, z1: lane - H.laneW },
    { x0: X(cu1), x1: X(cu0), z0: lane + H.laneW, z1: H.z1 },
  )

  // -- the ticket office window and the fare machines
  const office = own(std({ color: 0x0b0d0e, roughness: 0.2, metalness: 0.3, emissive: 0x050808 }))
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.1), office)
  win.position.set(X(6), H.y + 1.6, H.z0 + 0.02)
  g.add(win)
  add(box(g, steel, 2.6, 0.06, 0.45, X(6), H.y + 1.0, H.z0 + 0.22))
  add(box(g, body, 2.6, 0.98, 0.4, X(6), H.y + 0.49, H.z0 + 0.2))
  blocks.push({ x0: X(7.3), x1: X(4.7), z0: H.z0, z1: H.z0 + 0.45 })
  const officeSign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.3), own(std({ map: own(words('TICKETS', 384, 64, '#1a3d8f', '#fff', 'bold 44px Helvetica, Arial, sans-serif')), roughness: 0.5 })))
  officeSign.position.set(X(6), H.y + 2.4, H.z0 + 0.03)
  g.add(officeSign)
  const screen = own(std({ color: 0x000000, emissive: 0x2a7fff, emissiveIntensity: 1.4 }))
  for (const u of [5.2, 6.6]) {
    add(box(g, body, 0.8, 1.7, 0.5, X(u), H.y + 0.85, H.z1 - 0.25))
    box(g, screen, 0.42, 0.32, 0.02, X(u), H.y + 1.25, H.z1 - 0.51)
    blocks.push({ x0: X(u + 0.4), x1: X(u - 0.4), z0: H.z1 - 0.5, z1: H.z1 })
  }

  // -- the signs: the way down, the way out
  const down = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.4),
    own(std({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 1.6, emissiveMap: own(words('TRAINS ↓', 320, 80, '#1a3d8f', '#fff', 'bold 50px Helvetica, Arial, sans-serif')) })),
  )
  down.rotation.y = -Math.PI / 2
  down.position.set(X(H.flightU1) - 0.03, H.y + 2.85, lane)
  g.add(down)
  const out = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.4),
    own(std({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 1.6, emissiveMap: own(words('WAY OUT', 320, 90, '#118a3a', '#fff', 'bold 54px Helvetica, Arial, sans-serif')) })),
  )
  out.rotation.y = Math.PI / 2
  out.position.set(X(H.u1) + 0.03, H.y + 2.9, lane)
  g.add(out)

  // -- the street shutter at the far end, torn up from the bottom: darkness, and what comes out of it
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.6), black)
  hole.rotation.y = Math.PI / 2
  hole.position.set(X(H.u1) + 0.02, H.y + 1.3, lane)
  g.add(hole)
  const slatTex = own(stain(77 + sx, '40,30,20'))
  const slat = own(std({ color: 0x777b7d, roughness: 0.55, metalness: 0.7, bumpMap: slatTex, bumpScale: 2 }))
  for (let i = 0; i < 9; i++) {
    const y = H.y + 2.55 - i * 0.12
    const m = add(box(g, slat, 0.04, 0.1, 3.0, X(H.u1) + 0.06, y, lane))
    // the bottom slats buckled
    if (i > 5) {
      m.rotation.x = (i - 5) * 0.12 * (i % 2 ? 1 : -1)
      m.position.x += (i - 5) * 0.05
    }
  }
  box(g, darkMetal, 0.12, 0.3, 3.2, X(H.u1) + 0.07, H.y + 2.75, lane)
  // blood dragged in across the floor
  const smear = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.6), own(new THREE.MeshStandardMaterial({ map: own(stain(91 + sx)), transparent: true, depthWrite: false, roughness: 0.4 })))
  smear.rotation.x = -Math.PI / 2
  smear.position.set(X(12), H.y + 0.006, lane + 0.2)
  g.add(smear)

  // -- the emergency light, red, over the gates
  box(g, darkMetal, 0.5, 0.1, 0.24, X(H.gatesU), ceil - 0.06, lane)
  box(g, red, 0.4, 0.05, 0.16, X(H.gatesU), ceil - 0.12, lane)
  const light = new THREE.PointLight(0xff3424, 7, 15, 1.4)
  light.position.set(X(H.gatesU), ceil - 0.5, lane)
  g.add(light)
  void style
  return light
}

function solid3<T extends THREE.Mesh>(m: T, solids: THREE.Object3D[]): T {
  solids.push(m)
  return m
}

// ---------------------------------------------------------------- furniture

function bench(group: THREE.Group, x: number, wood: THREE.Material, legs: THREE.Material, solids: THREE.Object3D[]) {
  for (let i = 0; i < 3; i++) solids.push(box(group, wood, 2.2, 0.05, 0.12, x, 0.46, 9.15 + i * 0.14))
  for (let i = 0; i < 2; i++) {
    const b = box(group, wood, 2.2, 0.11, 0.04, x, 0.72 + i * 0.16, 9.58)
    b.rotation.x = -0.12
  }
  for (const s of [-1, 1]) {
    box(group, legs, 0.06, 0.46, 0.5, x + s * 0.95, 0.23, 9.3)
    box(group, legs, 0.06, 0.5, 0.06, x + s * 0.95, 0.68, 9.6)
  }
}

function vending(group: THREE.Group, x: number, color: string, solids: THREE.Object3D[], own: Own) {
  const [c, g] = canvas(256, 512)
  g.fillStyle = '#0d0f12'
  g.fillRect(0, 0, 256, 512)
  g.fillStyle = color
  g.fillRect(0, 0, 256, 70)
  g.fillStyle = '#fff'
  g.font = 'bold 36px Helvetica, Arial, sans-serif'
  g.textAlign = 'center'
  g.fillText('Kherve Fizz', 128, 46)
  const cols = ['#e04a3a', '#3a8fe0', '#f2c230', '#2fbf71', '#d07ae8']
  for (let row = 0; row < 5; row++)
    for (let k = 0; k < 4; k++) {
      g.fillStyle = cols[(row + k) % cols.length]
      g.fillRect(24 + k * 54, 96 + row * 72, 34, 54)
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.fillRect(28 + k * 54, 100 + row * 72, 6, 46)
    }
  const t = own(texture(c))
  solids.push(box(group, own(std({ color: 0x1e2226, roughness: 0.4, metalness: 0.6 })), 1.1, 2.0, 0.8, x, 1.0, 9.5))
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.72), own(std({ color: 0x000000, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 1.1 })))
  front.rotation.y = Math.PI
  front.position.set(x, 1.05, 9.09)
  group.add(front)
  const glow = new THREE.PointLight(new THREE.Color(color), 2.5, 4, 2)
  glow.position.set(x, 1.1, 8.6)
  group.add(glow)
}

function mapBoard(group: THREE.Group, x: number, index: number, solids: THREE.Object3D[], own: Own, frame: THREE.Material) {
  const t = own(texture(lineMap(index)))
  solids.push(box(group, frame, 5.2, 0.8, 0.05, x, 1.75, 9.96))
  const m = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 0.62), own(std({ map: t, roughness: 0.3 })))
  m.rotation.y = Math.PI
  m.position.set(x, 1.75, 9.93)
  group.add(m)
}

function clockFace(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#f4f2ea'
  g.beginPath()
  g.arc(128, 128, 126, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#1b1b1b'
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2
    const big = i % 5 === 0
    g.save()
    g.translate(128, 128)
    g.rotate(a)
    g.fillRect(-(big ? 4 : 1.5), -116, big ? 8 : 3, big ? 22 : 9)
    g.restore()
  }
  const d = new Date()
  const hand = (a: number, len: number, w: number, col: string) => {
    g.save()
    g.translate(128, 128)
    g.rotate(a)
    g.fillStyle = col
    g.fillRect(-w / 2, -len, w, len + 14)
    g.restore()
  }
  hand((((d.getHours() % 12) + d.getMinutes() / 60) / 12) * Math.PI * 2, 62, 9, '#1b1b1b')
  hand((d.getMinutes() / 60) * Math.PI * 2, 96, 6, '#1b1b1b')
  hand((d.getSeconds() / 60) * Math.PI * 2, 100, 2, '#c4331f')
  return texture(c)
}

/** The tunnel from the platform end (|x| = 40) to REACH: walls, cables, lamps every LAMP_PITCH metres. */
function buildTunnel(group: THREE.Group, s: number, solids: THREE.Object3D[], own: Own) {
  const len = REACH - 40
  const cx = s * (40 + len / 2)
  const tex = own(concrete(77, '#3a3936', 0.03))
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1 / 6, 1 / 6)
  const mat = own(std({ map: tex, roughness: 0.95 }))
  const h = 4.5
  const yc = TRACK_Y + h / 2
  for (const [z, ry] of [[-4.2, 0], [0.6, Math.PI]] as const) {
    const w = solids[solids.push(panel(group, mat, len, h)) - 1] as THREE.Mesh
    w.rotation.y = ry
    w.position.set(cx, yc, z)
  }
  const roof = panel(group, mat, len, 4.8)
  roof.rotation.x = Math.PI / 2
  roof.position.set(cx, TRACK_Y + h, -1.8)
  solids.push(roof)
  const cable = own(std({ color: 0x111111, roughness: 0.6 }))
  for (const [z, y] of [[-4.1, 1.6], [-4.1, 1.75], [-4.1, 1.9], [0.5, 1.2]] as const) cyl(group, cable, 0.025, len, cx, y, z, 'x')
  const lamp = own(std({ color: 0xffffff, emissive: 0xffe2a8, emissiveIntensity: 5 }))
  const cage = own(std({ color: 0x222222, roughness: 0.6, metalness: 0.5 }))
  const first = Math.ceil(46 / LAMP_PITCH) * LAMP_PITCH
  for (let x = first; x <= REACH; x += LAMP_PITCH) {
    box(group, cage, 0.34, 0.2, 0.14, s * x, 2.3, -4.12)
    box(group, lamp, 0.24, 0.1, 0.06, s * x, 2.3, -4.05)
    // a refuge alcove marker every other lamp
    if ((x / LAMP_PITCH) % 2 === 0) box(group, own(std({ color: 0xc9c9c0, roughness: 0.8 })), 0.5, 0.06, 0.02, s * x, 0.9, -4.17)
  }
}

// ---------------------------------------------------------------- clutter

interface DecorCtx {
  group: THREE.Group
  solids: THREE.Object3D[]
  blocks: Block[]
  own: Own
  r: () => number
  style: StationStyle
  index: number
  place: (x: number, w: number) => boolean
  free: (cands: number[], w: number, n: number) => number[]
  wallPanel: THREE.Material
}

function sheet(c: DecorCtx, kind: 'tarp' | 'crate' | 'sack'): THREE.CanvasTexture {
  const [cv, g] = canvas(256, 256)
  const r = rng(c.index * 31 + kind.length)
  if (kind === 'tarp') {
    g.fillStyle = '#2a6aa8'
    g.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.06 + r() * 0.12})`
      g.lineWidth = 1 + r() * 3
      g.beginPath()
      g.moveTo(r() * 256, 0)
      g.lineTo(r() * 256, 256)
      g.stroke()
    }
    g.fillStyle = '#c9c9c0'
    for (const [x, y] of [[8, 8], [248, 8], [8, 248], [248, 248], [128, 8], [128, 248]]) {
      g.beginPath()
      g.arc(x, y, 5, 0, Math.PI * 2)
      g.fill()
    }
  } else if (kind === 'crate') {
    g.fillStyle = '#8a6a40'
    g.fillRect(0, 0, 256, 256)
    for (let y = 0; y < 256; y += 51) {
      g.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.12})`
      g.fillRect(0, y, 256, 3)
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(60,36,12,${r() * 0.2})`
        g.fillRect(r() * 256, y + r() * 48, 20 + r() * 60, 1)
      }
    }
    g.fillStyle = '#5a4026'
    g.fillRect(0, 0, 18, 256)
    g.fillRect(238, 0, 18, 256)
    g.fillStyle = 'rgba(20,20,20,0.7)'
    g.font = 'bold 36px Helvetica, Arial, sans-serif'
    g.textAlign = 'center'
    g.fillText(['KH-12', 'FRAGILE', 'LAB', 'THIS WAY ↑'][Math.floor(r() * 4)], 128, 140)
  } else {
    g.fillStyle = '#8f8157'
    g.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '40,30,10' : '255,240,190'},${r() * 0.14})`
      g.fillRect(r() * 256, r() * 256, 1 + r() * 4, 1)
    }
  }
  return c.own(texture(cv))
}

const DECOR: Record<Decor, (c: DecorCtx) => void> = {
  kiosk(c) {
    const [x] = c.free([-1.5, -9.5, 30.5], 3.2, 1)
    if (x === undefined) return
    const { group, own, solids } = c
    const body = own(std({ color: 0x2a5a44, roughness: 0.5, metalness: 0.4 }))
    const z = 8.5
    solids.push(box(group, body, 2.6, 1.1, 1.0, x, 0.55, z))
    box(group, own(std({ color: 0x1b1d1c, roughness: 0.6 })), 2.7, 0.06, 1.1, x, 1.13, z)
    for (const [dx, dz] of [[-1.3, -0.5], [1.3, -0.5], [-1.3, 0.5], [1.3, 0.5]] as const) cyl(group, own(std({ color: 0x1b1d1c, metalness: 0.7, roughness: 0.4 })), 0.035, 1.3, x + dx, 1.8, z + dz)
    box(group, body, 3.0, 0.09, 1.5, x, 2.48, z)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.42), own(std({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 1.5, emissiveMap: own(words('NEWS & SNACKS', 512, 84, '#c44a1a', '#fff', 'bold 52px Helvetica, Arial, sans-serif')) })))
    sign.rotation.y = Math.PI
    sign.position.set(x, 2.24, z - 0.52)
    group.add(sign)
    // magazines and bottles on the counter and the back shelf
    const cols = [0xe04a3a, 0x3a8fe0, 0xf2c230, 0x2fbf71, 0xd07ae8, 0xf0f0e8]
    for (let i = 0; i < 12; i++) {
      const m = box(group, own(std({ color: cols[i % cols.length], roughness: 0.7 })), 0.26, 0.35, 0.02, x - 1.15 + i * 0.2, 1.4, z + 0.45)
      m.rotation.x = -0.18
    }
    const sh = box(group, own(std({ color: 0x2a2f31, roughness: 0.6 })), 2.5, 0.04, 0.3, x, 1.2, z + 0.42)
    solids.push(sh)
    for (let i = 0; i < 6; i++) cyl(group, own(std({ color: cols[(i * 2) % cols.length], roughness: 0.3, metalness: 0.3 })), 0.04, 0.2, x - 0.9 + i * 0.35 + c.r() * 0.1, 1.26, z - 0.2)
    c.blocks.push({ x0: x - 1.4, x1: x + 1.4, z0: z - 0.6, z1: z + 0.6 })
  },
  machines(c) {
    const xs = c.free([-24.4, -15.6, 15.6, 24.4, -34, 34, -1.8], 0.9, 3)
    const { group, own, solids } = c
    for (const x of xs) {
      const m = own(std({ color: 0x2f3a46, roughness: 0.4, metalness: 0.6 }))
      solids.push(box(group, m, 0.8, 1.7, 0.55, x, 0.85, 9.68))
      const t = own(words('TICKETS', 256, 128, '#0c2a1a', '#6bf2a0', 'bold 46px "Courier New", monospace'))
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.3), own(std({ color: 0x000000, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 1.4 })))
      scr.rotation.y = Math.PI
      scr.position.set(x, 1.3, 9.395)
      group.add(scr)
      box(group, own(std({ color: 0x101214, roughness: 0.7 })), 0.5, 0.08, 0.02, x, 0.95, 9.39)
      for (let i = 0; i < 6; i++) box(group, own(std({ color: 0x9aa0a4, metalness: 0.8, roughness: 0.4 })), 0.07, 0.07, 0.02, x - 0.15 + (i % 3) * 0.15, 1.05 - Math.floor(i / 3) * 0.09, 9.395)
      c.blocks.push({ x0: x - 0.45, x1: x + 0.45, z0: 9.35, z1: 10 })
    }
  },
  sandbags(c) {
    const xs = c.free([-6, 8, -26, 26, -2], 4, 1)
    if (!xs.length) return
    const { group, own, solids } = c
    const mat = own(std({ map: sheet(c, 'sack'), roughness: 1 }))
    const geo = own(new RoundedBoxGeometry(1, 1, 1, 2, 0.3))
    const rows = [6, 5, 4, 3]
    const pts: [number, number, number, number][] = []
    rows.forEach((n, row) => {
      for (let i = 0; i < n; i++) for (const dz of [-0.22, 0.22]) pts.push([(i - (n - 1) / 2) * 0.62, 0.13 + row * 0.25, dz, row])
    })
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const sc = new THREE.Vector3()
    pts.forEach(([dx, dy, dz], i) => {
      q.setFromEuler(new THREE.Euler((c.r() - 0.5) * 0.12, (c.r() - 0.5) * 0.2, (c.r() - 0.5) * 0.12))
      sc.set(0.6 + c.r() * 0.05, 0.24, 0.36)
      m4.compose(new THREE.Vector3(xs[0] + dx, dy, 9.0 + dz), q, sc)
      mesh.setMatrixAt(i, m4)
    })
    group.add(mesh)
    solids.push(mesh)
    c.blocks.push({ x0: xs[0] - 1.95, x1: xs[0] + 1.95, z0: 8.6, z1: 9.45 })
    // a "keep out" sign and a dropped helmet
    const t = own(signTexture([['KEEP BACK', 'bold 64px Helvetica, Arial, sans-serif'], ['by order', '30px Helvetica, Arial, sans-serif']], '#b8281c', '#fff'))
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35), own(std({ map: t })))
    s.position.set(xs[0], 1.22, 8.74)
    s.rotation.y = Math.PI
    group.add(s)
    cyl(group, own(std({ color: 0xc9c9c0 })), 0.012, 0.8, xs[0], 0.9, 8.74)
    const hel = new THREE.Mesh(own(new THREE.SphereGeometry(0.14, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), own(std({ color: 0x4a5a3a, roughness: 0.5 })))
    hel.position.set(xs[0] + 1.1, 0.96, 8.9)
    group.add(hel)
  },
  rubble(c) {
    const xs = c.free([-7, 9, -26.5, 26.5, 2], 2.8, 2)
    const { group, own, solids } = c
    const mat = own(std({ color: 0x77736b, roughness: 0.95 }))
    const dark = own(std({ color: 0x4b4842, roughness: 1 }))
    const rod = own(std({ color: 0x6a3a22, roughness: 0.8, metalness: 0.6 }))
    const geo = own(new THREE.DodecahedronGeometry(1, 0))
    for (const x of xs) {
      for (let i = 0; i < 16; i++) {
        const s = 0.08 + c.r() * c.r() * 0.45
        const m = new THREE.Mesh(geo, i % 3 ? mat : dark)
        const a = c.r() * Math.PI * 2
        const d = c.r() * 1.2
        m.scale.set(s * (0.8 + c.r() * 0.6), s * (0.5 + c.r() * 0.5), s * (0.8 + c.r() * 0.6))
        m.position.set(x + Math.cos(a) * d, s * 0.45, 8.6 + Math.sin(a) * d * 0.7)
        m.rotation.set(c.r() * 3, c.r() * 3, c.r() * 3)
        group.add(m)
        if (s > 0.3) solids.push(m)
      }
      for (let i = 0; i < 4; i++) {
        const rb = cyl(group, rod, 0.012, 0.8 + c.r() * 0.6, x + (c.r() - 0.5) * 1.4, 0.45, 8.5 + (c.r() - 0.5) * 0.8)
        rb.rotation.set((c.r() - 0.5) * 0.9, 0, (c.r() - 0.5) * 0.9)
      }
      const slab = box(group, mat, 1.5, 0.14, 1.0, x - 0.2, 0.3, 9.1)
      slab.rotation.set(0.25, 0.4, 0.12)
      solids.push(slab)
      c.blocks.push({ x0: x - 0.95, x1: x + 0.95, z0: 8.3, z1: 9.9 })
    }
  },
  crates(c) {
    const xs = c.free([-27.5, 8.5, -3, 29, -8], 2.4, 2)
    const { group, own, solids } = c
    const mat = own(std({ map: sheet(c, 'crate'), roughness: 0.85 }))
    const edge = own(std({ color: 0x4a3720, roughness: 0.9 }))
    xs.forEach((x, k) => {
      const stack: [number, number, number, number][] = [[0, 0, 1.05, 0], [1.1, 0, 0.9, 0.1], [0.5, 0.97, 0.8, -0.15]]
      stack.forEach(([dx, dy, s, rot], i) => {
        const cr = solid3(box(group, mat, s, s, s, x + dx - 0.5, dy + s / 2, 9.0 + (i === 2 ? 0 : 0.1)), solids)
        cr.rotation.y = rot + k * 0.2
        for (const e of [-1, 1]) box(cr, edge, 1.02, 0.06, 1.02, 0, e * 0.47, 0)
      })
      c.blocks.push({ x0: x - 1.1, x1: x + 1.15, z0: 8.4, z1: 9.7 })
    })
  },
  planters(c) {
    const xs = c.free([-28, -8, 8, 28, -36], 4.2, 3)
    const { group, own, solids } = c
    const brick = own(std({ color: 0x8a4a38, roughness: 0.9 }))
    const soil = own(std({ color: 0x2a1d12, roughness: 1 }))
    const leaves = [0x2f5a2a, 0x3d7a34, 0x25481f, 0x4a8a3a].map((col) => own(std({ color: col, roughness: 0.8 })))
    const geo = own(new THREE.IcosahedronGeometry(1, 1))
    const flower = [0xf06aa0, 0xf5d142, 0xf0f0f0].map((col) => own(std({ color: col, roughness: 0.6 })))
    const vtex = own(vines(c.index * 9))
    const vmat = own(new THREE.MeshStandardMaterial({ map: vtex, transparent: true, alphaTest: 0.2, roughness: 0.9, side: THREE.DoubleSide }))
    xs.forEach((x, k) => {
      solids.push(box(group, brick, 4.0, 0.55, 0.8, x, 0.275, 9.25))
      box(group, soil, 3.8, 0.04, 0.62, x, 0.56, 9.25)
      for (let i = 0; i < 16; i++) {
        const s = 0.14 + c.r() * 0.22
        const m = new THREE.Mesh(geo, leaves[i % 4])
        m.scale.set(s * 1.2, s, s * 1.2)
        m.position.set(x - 1.8 + (i / 15) * 3.6, 0.58 + s * 0.8, 9.25 + (c.r() - 0.5) * 0.3)
        group.add(m)
        if (i % 3 === 0) {
          const f = new THREE.Mesh(geo, flower[(i + k) % 3])
          f.scale.setScalar(0.045)
          f.position.set(m.position.x + (c.r() - 0.5) * 0.2, m.position.y + s * 0.9, m.position.z)
          group.add(f)
        }
      }
      const v = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3), vmat)
      v.rotation.y = Math.PI
      v.position.set(x + (c.r() - 0.5) * 2, 1.9, 9.9)
      group.add(v)
      c.blocks.push({ x0: x - 2.05, x1: x + 2.05, z0: 8.8, z1: 10 })
    })
    // creepers on the far wall too
    for (const x of [-30, -6, 14, 34]) {
      const v = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 3.4), vmat)
      v.position.set(x, 1.9, -4.5)
      group.add(v)
    }
  },
  tarp(c) {
    const { group, own } = c
    const mat = own(std({ map: sheet(c, 'tarp'), roughness: 0.55, side: THREE.DoubleSide }))
    // blue sheets hung over the damaged wall, tied to the ceiling pipes
    const xs = c.free([-13, 17, -27, 8, 30], 3.6, 2)
    xs.forEach((x, k) => {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.6, 8, 3), mat)
      const pos = t.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 2.2 + k) * 0.1 + (1.3 - pos.getY(i)) * 0.08)
      t.geometry.computeVertexNormals()
      t.rotation.y = Math.PI
      t.position.set(x, CEIL_Y - 1.35, 9.78)
      group.add(t)
      for (const dx of [-1.5, 0, 1.5]) cyl(group, own(std({ color: 0x3a3226, roughness: 0.9 })), 0.012, 0.35, x + dx, CEIL_Y - 0.15, 9.78)
    })
  },
  cart(c) {
    const xs = c.free([-3, 11, 20.6 + 10, -16.5, 2], 2.6, 1)
    if (!xs.length) return
    const x = xs[0]
    const { group, own, solids } = c
    const body = own(std({ color: 0x36424a, roughness: 0.5, metalness: 0.7 }))
    const cart = new THREE.Group()
    cart.position.set(x, 0.42, 8.3)
    cart.rotation.set(0.3, 0.5, Math.PI / 2 - 0.2)
    group.add(cart)
    solids.push(box(cart, body, 1.1, 0.7, 0.62, 0, 0, 0))
    box(cart, body, 0.06, 0.9, 0.62, -0.55, 0.5, 0)
    for (const [wx, wz] of [[-0.45, 0.28], [-0.45, -0.28], [0.45, 0.28], [0.45, -0.28]] as const) cyl(cart, own(std({ color: 0x1a1a1a, roughness: 0.8 })), 0.09, 0.05, wx, -0.4, wz, 'z')
    const bag = own(std({ color: 0x6a3a5a, roughness: 0.7 }))
    for (let i = 0; i < 3; i++) {
      const s = box(group, i % 2 ? bag : own(std({ color: 0x2f4a6a, roughness: 0.7 })), 0.55 + i * 0.08, 0.34, 0.38, x + 0.9 + i * 0.55, 0.17, 8.6 + c.r() * 0.7)
      s.rotation.y = c.r() * 3
      solids.push(s)
    }
    c.blocks.push({ x0: x - 0.9, x1: x + 0.9, z0: 7.7, z1: 8.9 })
  },
  fans(c) {
    const { group, own } = c
    for (const x of c.free([-27, -2, 27, 14], 1.2, 2)) {
      const ring = new THREE.Mesh(own(new THREE.TorusGeometry(0.45, 0.05, 8, 24)), own(std({ color: 0x2a2f31, roughness: 0.5, metalness: 0.7 })))
      ring.position.set(x, 3.0, 9.93)
      group.add(ring)
      const dark = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), own(std({ color: 0x070707 })))
      dark.rotation.y = Math.PI
      dark.position.set(x, 3.0, 9.95)
      group.add(dark)
      for (let i = 0; i < 4; i++) {
        const b = box(group, own(std({ color: 0x5a6064, metalness: 0.7, roughness: 0.4 })), 0.42, 0.09, 0.01, x, 3.0, 9.92)
        b.rotation.z = (i * Math.PI) / 4 + 0.2
      }
    }
  },
}

