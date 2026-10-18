// Kherve Grand Prix: the classic cars as OBJ + MTL in named, coloured parts (mm, Z up, front towards -Y),
// to open in KherveCAD (File > Import mesh: one Object, a group per part). Export a car back from KherveCAD
// as glTF (File > Export for Other CAD > .glb) named stoccarda.glb, dieppe.glb or bavaria.glb into
// ~/Documents/Kherve Grand Prix cars, and the game races it instead of the one it builds (f1CustomCar.ts).
//
//   node tools/export_gp_cars.ts [folder]      (default: ~/Documents/Kherve Grand Prix cars)
const ctx: any = new Proxy(function () {}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop() {} }) : () => ctx), set: () => true })
;(globalThis as any).document = { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) }
const THREE = await import('three')
const { buildClassic } = await import('../src/apps/minigames/f1Classics.ts')
const { sharedMaterials } = await import('../src/apps/minigames/f1Models.ts')
const { teamsOf, CLASSIC_MODELS } = await import('../src/apps/minigames/f1Race.ts')
const { writeFileSync, mkdirSync } = await import('node:fs')
const { homedir } = await import('node:os')
const out = process.argv[2] ?? `${homedir()}/Documents/Kherve Grand Prix cars`
mkdirSync(out, { recursive: true })
const sh = sharedMaterials()
for (const model of Object.keys(CLASSIC_MODELS)) {
  const team = teamsOf('classic').find((t: any) => t.model === model)!
  const car = buildClassic(model, team, 7, sh)
  car.root.updateMatrixWorld(true)
  const groups = new Map<string, { color: string; lines: string[] }>()
  const verts: string[] = []
  car.root.traverse((o: any) => {
    if (!o.isMesh || !o.visible || !o.geometry?.attributes?.position) return
    o.geometry.computeBoundingBox()
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)
    if (o.material?.transparent && bb.max.y - bb.min.y < 0.003 && bb.max.y < 0.06) return // the ground shadow
    if (o.material?.map && o.material?.transparent) return // stickers and roundels: pictures, not shapes
    // the part's name: the named groups above it (wheel_fl, bumper_rear, driver) and its own
    const names: string[] = []
    for (let n = o; n && n !== car.root; n = n.parent) if (n.name && !names.includes(n.name)) names.unshift(n.name)
    let name = names.join('_') || 'detail'
    if (/^wheel_/.test(name) && !name.endsWith('tyre')) name = names[0] + '_rim'
    if (names[0] === 'driver') name = 'driver'
    const mat = o.material
    const color = name.endsWith('paint') || name.endsWith('plain') ? team.color : '#' + (mat?.color?.getHexString?.() ?? 'bbbbbb')
    let g = groups.get(name)
    if (!g) groups.set(name, (g = { color, lines: [] }))
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry
    const p = geo.attributes.position
    const v = new THREE.Vector3()
    const base = verts.length + 1
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld)
      // three: x forward, y up, z to the right -> CAD: X = -z, Y = -x (front towards -Y), Z = y, mm (right-handed: no mirror)
      verts.push(`v ${(-v.z * 1000).toFixed(2)} ${(-v.x * 1000).toFixed(2)} ${(v.y * 1000).toFixed(2)}`)
    }
    for (let i = 0; i < p.count; i += 3) g.lines.push(`f ${base + i} ${base + i + 1} ${base + i + 2}`)
  })
  const mtl: string[] = []
  const obj = [`# ${CLASSIC_MODELS[model].name} from Kherve Grand Prix (KherveOS): mm, Z up, front towards -Y`, `mtllib ${model}.mtl`, ...verts]
  for (const [name, g] of groups) {
    const h = g.color.replace('#', '')
    const kd = [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)).join(' ')
    mtl.push(`newmtl ${name}`, `Kd ${kd}`, '')
    obj.push(`o ${name}`, `usemtl ${name}`, ...g.lines)
  }
  writeFileSync(`${out}/${model}.obj`, obj.join('\n'))
  writeFileSync(`${out}/${model}.mtl`, mtl.join('\n'))
  console.log(model, groups.size, 'parts:', [...groups.keys()].join(', '))
}
