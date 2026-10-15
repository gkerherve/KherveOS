// Last Train: how each station looks. Every station of the line has its own
// tiles, floor, ceiling, columns, lights and clutter (lastTrainWorld.ts reads
// this table); the name and colour of the station stay in STATIONS.

export type WallKind = 'subway' | 'square' | 'stack' | 'brick' | 'mosaic' | 'plates' | 'marble'
export type FloorKind = 'concrete' | 'checker' | 'terrazzo' | 'slate' | 'plate' | 'terracotta'
export type CeilKind = 'beams' | 'vault' | 'ducts' | 'panels'
export type PillarKind = 'square' | 'round' | 'ribbed' | 'girder' | 'none'
export type LightKind = 'tube' | 'globe' | 'panel' | 'strip' | 'cage'
export type Decor = 'kiosk' | 'sandbags' | 'rubble' | 'machines' | 'crates' | 'planters' | 'tarp' | 'cart' | 'fans'

export interface StationStyle {
  wall: WallKind
  /** The colour of the wall tiles. */
  wallColor: string
  /** Texture repeats per metre (1.5: a 512 px tile map covers 0.67 m). */
  wallScale: number
  wallRough: number
  wallMetal: number
  /** A band of coloured tiles at eye height, or a coloured dado from the floor up. */
  band: 'stripe' | 'dado' | 'none'
  floor: FloorKind
  floorA: string
  floorB: string
  ceil: CeilKind
  ceilColor: string
  pillar: PillarKind
  /** x of each column along the platform. */
  pillars: number[]
  light: LightKind
  lightColor: number
  /** Multiplies the point lights of the platform. */
  lightPower: number
  fog: number
  /** Where the benches stand (x), and whether the station keeps the vending machine. */
  benches: number[]
  vending: boolean
  decor: Decor[]
  /** The graffiti words sprayed on the walls. */
  graffiti: string[]
}

const every = (a: number, b: number, step: number) => {
  const out: number[] = []
  for (let x = a; x <= b + 1e-6; x += step) out.push(x)
  return out
}

export const STYLES: StationStyle[] = [
  // 0 Kherve Square: the classic white-tiled platform
  {
    wall: 'subway', wallColor: '#e9e6da', wallScale: 1.5, wallRough: 0.22, wallMetal: 0,
    band: 'stripe', floor: 'concrete', floorA: '#7d7a72', floorB: '#6a675f',
    ceil: 'beams', ceilColor: '#2c2c2a',
    pillar: 'square', pillars: every(-30, 30, 10),
    light: 'tube', lightColor: 0xeefff6, lightPower: 1, fog: 0x070908,
    benches: [-35, -15, 5, 25], vending: true, decor: [], graffiti: ['RUN'],
  },
  // 1 Photon Lane: cream tiles, brass round columns, warm globes, a news stand
  {
    wall: 'square', wallColor: '#e6d8ae', wallScale: 1.5, wallRough: 0.25, wallMetal: 0,
    band: 'stripe', floor: 'checker', floorA: '#d6cbaa', floorB: '#5f4f36',
    ceil: 'panels', ceilColor: '#8d8774',
    pillar: 'round', pillars: every(-30, 30, 15),
    light: 'globe', lightColor: 0xffd9a0, lightPower: 0.95, fog: 0x0c0a05,
    benches: [-27, -7, 13, 33], vending: false, decor: ['kiosk', 'machines'], graffiti: ['STAY AWAY', 'NO EXIT'],
  },
  // 2 Electron Avenue: a barrel vault over blue-white stacked tiles, slate floor
  {
    wall: 'stack', wallColor: '#d9e4ec', wallScale: 1.5, wallRough: 0.16, wallMetal: 0,
    band: 'dado', floor: 'slate', floorA: '#2a3038', floorB: '#3d4651',
    ceil: 'vault', ceilColor: '#c9d4dc',
    pillar: 'none', pillars: [],
    light: 'strip', lightColor: 0xcfe6ff, lightPower: 1.1, fog: 0x05090f,
    benches: [-31, -9, 11, 29], vending: true, decor: ['sandbags', 'cart'], graffiti: ['IT SEES US', 'HELP'],
  },
  // 3 Lattice Gardens: red brick, riveted girders, sodium cage lamps, rubble
  {
    wall: 'brick', wallColor: '#9b4b39', wallScale: 1.5, wallRough: 0.9, wallMetal: 0,
    band: 'none', floor: 'concrete', floorA: '#5b574f', floorB: '#48443e',
    ceil: 'ducts', ceilColor: '#242321',
    pillar: 'girder', pillars: every(-36, 36, 12),
    light: 'cage', lightColor: 0xffb060, lightPower: 0.9, fog: 0x0e0804,
    benches: [-33, -3, 27], vending: false, decor: ['rubble', 'crates'], graffiti: ['THEY COME AT NIGHT', 'DON\'T STOP'],
  },
  // 4 Spectrum Hill: dark marble, terrazzo, round pillars with gold rings
  {
    wall: 'marble', wallColor: '#33283d', wallScale: 0.9, wallRough: 0.18, wallMetal: 0.1,
    band: 'stripe', floor: 'terrazzo', floorA: '#8b8294', floorB: '#4c4455',
    ceil: 'beams', ceilColor: '#1b1620',
    pillar: 'round', pillars: every(-30, 30, 15),
    light: 'strip', lightColor: 0xdccbff, lightPower: 1.05, fog: 0x0a0710,
    benches: [-37, -15, 15, 37], vending: true, decor: ['tarp', 'machines'], graffiti: ['KHERVE WAS HERE', 'GO UP'],
  },
  // 5 Raman Row: teal mosaic, fluted columns, a collapsed ceiling
  {
    wall: 'mosaic', wallColor: '#2e9090', wallScale: 1.5, wallRough: 0.2, wallMetal: 0,
    band: 'none', floor: 'checker', floorA: '#d9ebe9', floorB: '#2c6e6d',
    ceil: 'panels', ceilColor: '#55605f',
    pillar: 'ribbed', pillars: [-30, -10, 10, 30],
    light: 'panel', lightColor: 0xdffffb, lightPower: 1.1, fog: 0x050b0b,
    benches: [-30, -8, 8, 26], vending: true, decor: ['tarp', 'rubble', 'fans'], graffiti: ['LISTEN', '5 MORE MINUTES'],
  },
  // 6 Fermi Gate: an industrial platform, riveted plates, hazard stripes
  {
    wall: 'plates', wallColor: '#59666c', wallScale: 1.5, wallRough: 0.5, wallMetal: 0.55,
    band: 'dado', floor: 'plate', floorA: '#4b5053', floorB: '#34393b',
    ceil: 'ducts', ceilColor: '#2a2d2e',
    pillar: 'girder', pillars: every(-32, 32, 16),
    light: 'cage', lightColor: 0xffe2b0, lightPower: 1, fog: 0x090a0a,
    benches: [-36, -4, 28], vending: false, decor: ['crates', 'fans', 'cart'], graffiti: ['WE TRIED', 'FUSE BLOWN'],
  },
  // 7 Pyodide Park: the last stop, a vault with skylights, terracotta, planters
  {
    wall: 'square', wallColor: '#efe8df', wallScale: 1.5, wallRough: 0.25, wallMetal: 0,
    band: 'stripe', floor: 'terracotta', floorA: '#b0694c', floorB: '#8e533b',
    ceil: 'vault', ceilColor: '#d8d2c6',
    pillar: 'round', pillars: every(-30, 30, 10),
    light: 'globe', lightColor: 0xfff0d8, lightPower: 1.05, fog: 0x090b0c,
    benches: [-35, -15, 5, 25], vending: true, decor: ['planters', 'sandbags'], graffiti: ['DAYLIGHT', 'ALMOST THERE'],
  },
]
