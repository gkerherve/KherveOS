// The 3D preview (loaded on demand, because it pulls in three.js): the board as a 1.6 mm slab with its
// outline and drilled holes, the top and bottom artwork (solder mask, exposed pads, silkscreen) as
// canvas textures, tracks and vias as thin raised boxes, and the parts as boxes and cylinders from
// each footprint's body. The camera orbits around the board; the up direction is the board's "up"
// (-Z) so turning the board over reads like turning a real one over its vertical axis.

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { pointInPoly } from './geom.ts'
import { getFootprint } from './footprints.ts'
import { toWorld } from './board.ts'
import { drillHits, frameBox } from './layers.ts'
import { renderTexture } from './draw.ts'
import type { Design, Fills } from './types.ts'

export type ViewMode = 'top' | 'bottom' | 'iso'

export interface Scene3D {
  setDesign(d: Design, fills: Fills): void
  setView(v: ViewMode): void
  setWireframe(on: boolean): void
  setRotate(on: boolean): void
  resize(): void
  dispose(): void
}

const THICKNESS = 1.6

function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh
    m.geometry?.dispose()
    const mat = m.material as THREE.Material | THREE.Material[] | undefined
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      ;(x as THREE.MeshStandardMaterial).map?.dispose()
      x.dispose()
    }
  })
}

export function buildModel(d: Design, fills: Fills): { group: THREE.Group; centre: THREE.Vector3; radius: number } {
  const group = new THREE.Group()
  const box = frameBox(d)
  const W = box.x1 - box.x0
  const H = box.y1 - box.y0

  // outline with holes
  const outline = d.outline.pts.length >= 3 ? d.outline.pts : [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }]
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, p.y)))
  for (const h of drillHits(d)) {
    if (!pointInPoly(h.x, h.y, outline)) continue
    const path = new THREE.Path()
    path.absarc(h.x, h.y, h.d / 2, 0, Math.PI * 2, true)
    shape.holes.push(path)
  }

  // the slab: extruded along z, then laid down so z becomes board y and the board hangs below y = 0
  const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: THICKNESS, bevelEnabled: false, curveSegments: 24 })
  slabGeo.rotateX(Math.PI / 2)
  const slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({ color: 0xb9a561, roughness: 0.8, metalness: 0 }))
  group.add(slab)

  // the artwork on both faces
  const ppmm = Math.max(4, Math.min(24, 4096 / Math.max(W, H, 1)))
  for (const side of ['F', 'B'] as const) {
    const geo = new THREE.ShapeGeometry(shape, 24)
    const pos = geo.getAttribute('position')
    const uv = new Float32Array(pos.count * 2)
    for (let i = 0; i < pos.count; i++) {
      uv[2 * i] = (pos.getX(i) - box.x0) / W
      uv[2 * i + 1] = 1 - (pos.getY(i) - box.y0) / H
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.rotateX(Math.PI / 2)
    geo.translate(0, side === 'F' ? 0.004 : -THICKNESS - 0.004, 0)
    const tex = new THREE.CanvasTexture(renderTexture(d, fills, side, box, ppmm))
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide }))
    group.add(mesh)
  }

  // tracks as thin boxes
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x2f9a5a, roughness: 0.5, metalness: 0.2 })
  const unit = new THREE.BoxGeometry(1, 1, 1)
  for (const layer of ['F.Cu', 'B.Cu'] as const) {
    const list = d.tracks.filter((t) => t.layer === layer)
    if (!list.length) continue
    const inst = new THREE.InstancedMesh(unit, trackMat, list.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    list.forEach((t, i) => {
      const len = Math.hypot(t.x2 - t.x1, t.y2 - t.y1)
      e.set(0, -Math.atan2(t.y2 - t.y1, t.x2 - t.x1), 0)
      q.setFromEuler(e)
      m.compose(
        new THREE.Vector3((t.x1 + t.x2) / 2, layer === 'F.Cu' ? 0.03 : -THICKNESS - 0.03, (t.y1 + t.y2) / 2),
        q,
        new THREE.Vector3(len + t.w * 0.5, 0.035, t.w),
      )
      inst.setMatrixAt(i, m)
    })
    inst.instanceMatrix.needsUpdate = true
    group.add(inst)
  }
  if (d.vias.length) {
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 20)
    const vm = new THREE.InstancedMesh(cyl, new THREE.MeshStandardMaterial({ color: 0xc9a95a, roughness: 0.4, metalness: 0.6 }), d.vias.length)
    const m = new THREE.Matrix4()
    d.vias.forEach((v, i) => {
      m.compose(new THREE.Vector3(v.x, -THICKNESS / 2, v.y), new THREE.Quaternion(), new THREE.Vector3(v.d, THICKNESS + 0.08, v.d))
      vm.setMatrixAt(i, m)
    })
    vm.instanceMatrix.needsUpdate = true
    group.add(vm)
  }

  // parts from their bodies
  const matCache = new Map<string, THREE.MeshStandardMaterial>()
  const matOf = (color: string) => {
    let m = matCache.get(color)
    if (!m) matCache.set(color, (m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6, metalness: 0.1 })))
    return m
  }
  for (const part of d.parts) {
    const fp = getFootprint(part.fp)
    if (!fp) continue
    for (const b of fp.bodies) {
      const w = b.x1 - b.x0
      const dep = b.y1 - b.y0
      const z0 = b.z0 ?? 0
      const hh = Math.max(0.05, b.h - z0)
      const c = toWorld(part, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 })
      const geo = b.round ? new THREE.CylinderGeometry(Math.min(w, dep) / 2, Math.min(w, dep) / 2, hh, 24) : new THREE.BoxGeometry(w, hh, dep)
      const mesh = new THREE.Mesh(geo, matOf(b.color ?? '#262626'))
      const up = part.side === 'F'
      mesh.position.set(c.x, up ? z0 + hh / 2 : -THICKNESS - z0 - hh / 2, c.y)
      mesh.rotation.y = (part.rot * Math.PI) / 180
      group.add(mesh)
    }
    // leads of through-hole parts, sticking out of the back
    for (const pad of fp.pads) {
      if (pad.drill === undefined || pad.plated === false) continue
      const c = toWorld(part, pad)
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(pad.drill * 0.35, 0.4), Math.min(pad.drill * 0.35, 0.4), THICKNESS + 2, 8), matOf('#c0c0c0'))
      pin.position.set(c.x, -THICKNESS / 2 + (part.side === 'F' ? -0.4 : 0.4), c.y)
      group.add(pin)
    }
  }

  const centre = new THREE.Vector3((box.x0 + box.x1) / 2, -THICKNESS / 2, (box.y0 + box.y1) / 2)
  return { group, centre, radius: Math.max(W, H, 10) }
}

export function createScene3D(host: HTMLElement): Scene3D {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  host.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x151a20)
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 5000)
  camera.up.set(0, 0, -1)
  scene.add(new THREE.AmbientLight(0xffffff, 0.55))
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404858, 0.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.3)
  sun.position.set(30, 90, 40)
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0xffffff, 0.45)
  fill.position.set(-40, -60, -30)
  scene.add(fill)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false
  controls.autoRotateSpeed = 2.2

  let model: THREE.Group | null = null
  let centre = new THREE.Vector3()
  let radius = 50
  let wire = false
  let dead = false
  let frame = 0
  let placed = false

  const render = () => {
    frame = 0
    if (dead) return
    controls.update()
    renderer.render(scene, camera)
    if (controls.autoRotate) frame = requestAnimationFrame(render)
  }
  const want = () => {
    if (!frame && !dead) frame = requestAnimationFrame(render)
  }
  controls.addEventListener('change', want)

  const setView = (v: ViewMode) => {
    const dist = radius * 1.7
    const p = v === 'top' ? [0, dist, 0.001] : v === 'bottom' ? [0, -dist, 0.001] : [0.35 * dist, 0.85 * dist, 0.65 * dist]
    camera.position.set(centre.x + p[0], centre.y + p[1], centre.z + p[2])
    controls.target.copy(centre)
    controls.update()
    want()
  }

  const applyWire = () => {
    model?.traverse((n) => {
      const m = n as THREE.Mesh
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) (x as THREE.MeshStandardMaterial).wireframe = wire
    })
  }

  const resize = () => {
    const w = Math.max(50, host.clientWidth)
    const h = Math.max(50, host.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    want()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(host)
  resize()

  return {
    setDesign(d, fills) {
      if (model) {
        scene.remove(model)
        disposeTree(model)
      }
      const built = buildModel(d, fills)
      model = built.group
      centre = built.centre
      radius = built.radius
      scene.add(model)
      applyWire()
      if (!placed) {
        placed = true
        setView('iso')
      } else want()
    },
    setView,
    setWireframe(on) {
      wire = on
      applyWire()
      want()
    },
    setRotate(on) {
      controls.autoRotate = on
      want()
    },
    resize,
    dispose() {
      dead = true
      if (frame) cancelAnimationFrame(frame)
      ro.disconnect()
      controls.dispose()
      if (model) disposeTree(model)
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
