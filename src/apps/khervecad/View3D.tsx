// The 3D preview: the desktop View3D's model, colours, selection tint,
// render styles, backgrounds, platform & shadow, edge lines, ground grid,
// axes, scale bar and source badge — drawn with three.js. The camera is the
// desktop's (yaw / pitch / distance / target, focal 1.2 × the shorter side):
// left-drag orbits, right- or middle-drag pans, the wheel zooms, a
// double-click fits (in Python, which knows the model). In a pick (anchors,
// snap) or Edit Mode the mouse goes to the desktop code instead.

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { floatsFromBase64, u16FromBase64, bounds } from './meshio'
import { qtKey } from './keys'
import { eyeOf, fovFor, focal, orbit, orientation, pan, scaleBar, zoom, lightVector } from './view3dmath'
import type { Camera, MeshPayload, Node, UiEvent, V3State, ViewLook } from './types'
import { QtNode } from './qt/QtNode'

export interface View3DData {
  mesh: MeshPayload | null
  hi: MeshPayload | null
  cam: Camera | null
  camRev: number
  look: ViewLook | null
  markers: NonNullable<V3State['markers']>
}

/** Per-material looks (MATERIAL_STYLES) on top of the render style. */
function materialFor(style: string, mat: string, opaque: boolean): THREE.Material {
  const s = mat && style !== 'Wireframe' && style !== 'X-ray' ? matStyle(mat) : style
  const common = { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }
  switch (s) {
    case 'Wireframe':
      return new THREE.MeshBasicMaterial({ ...common, wireframe: true, vertexColors: false, color: 0x8899aa })
    case 'X-ray':
      return new THREE.MeshLambertMaterial({ ...common, transparent: true, opacity: 0.13, depthWrite: false })
    case 'Matte':
      return new THREE.MeshLambertMaterial({ ...common })
    case 'Clay':
      return new THREE.MeshLambertMaterial({ ...common, vertexColors: false, color: new THREE.Color().setHSL(0.07, 0.25, 0.62) })
    case 'Toon':
      return new THREE.MeshToonMaterial({ ...common })
    case 'Brushed metal':
      return new THREE.MeshStandardMaterial({ ...common, metalness: 0.75, roughness: 0.32 })
    case 'Gold':
      return new THREE.MeshStandardMaterial({ ...common, vertexColors: false, color: 0xd4a537, metalness: 0.9, roughness: 0.28 })
    case 'Copper':
      return new THREE.MeshStandardMaterial({ ...common, vertexColors: false, color: 0xb8733a, metalness: 0.9, roughness: 0.3 })
    case 'Glass':
      return new THREE.MeshPhongMaterial({ ...common, transparent: true, opacity: 0.4, shininess: 120, depthWrite: false })
    case 'Rubber':
      return new THREE.MeshLambertMaterial({ ...common })
    case 'Skin':
      return new THREE.MeshPhongMaterial({ ...common, shininess: 8 })
    case 'Emissive':
      return new THREE.MeshBasicMaterial({ ...common })
    default:
      return new THREE.MeshPhongMaterial({ ...common, shininess: 60, specular: 0x333333, transparent: !opaque, depthWrite: opaque })
  }
}

function matStyle(mat: string): string {
  const map: Record<string, string> = {
    Plastic: 'Shaded', Metal: 'Brushed metal', Matte: 'Matte', Clay: 'Clay', Glass: 'Glass', Rubber: 'Rubber', Skin: 'Skin',
    Gold: 'Gold', Copper: 'Copper', Emissive: 'Emissive',
  }
  return map[mat] ?? 'Matte'
}

function colourOf(value: string | number[], base: THREE.Color): THREE.Color {
  if (Array.isArray(value)) return new THREE.Color(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0)
  const c = new THREE.Color()
  try {
    c.setStyle(value)
    return c
  } catch {
    return base.clone()
  }
}

/** Build the model's meshes: one per (material, opaque) group. */
function buildModel(payload: MeshPayload, look: ViewLook | null): THREE.Group {
  const group = new THREE.Group()
  const pos = floatsFromBase64(payload.pos)
  const n = payload.n
  const style = look?.style ?? 'Shaded'
  const baseHex = look?.base ?? '#4a6fa5'
  const base = new THREE.Color(baseHex)
  const hsl = { h: 0, s: 0, l: 0 }
  base.getHSL(hsl)
  const defaultFace = new THREE.Color().setHSL(hsl.h, hsl.s * 0.75, 0.6)
  const pal = payload.pal ?? []
  const idx = payload.idx ? u16FromBase64(payload.idx) : null
  const groups = new Map<string, number[]>()
  for (let t = 0; t < n; t++) {
    const p = idx ? pal[idx[t]] : null
    const alpha = p ? p[1] : 1
    const key = `${p ? p[2] : ''}|${alpha < 0.999 ? 't' : 'o'}`
    let list = groups.get(key)
    if (!list) groups.set(key, (list = []))
    list.push(t)
  }
  for (const [key, tris] of groups) {
    const [mat, op] = key.split('|')
    const g = new THREE.BufferGeometry()
    const p3 = new Float32Array(tris.length * 9)
    const c3 = new Float32Array(tris.length * 9)
    let alphaSum = 0
    tris.forEach((t, k) => {
      p3.set(pos.subarray(t * 9, t * 9 + 9), k * 9)
      const p = idx ? pal[idx[t]] : null
      const col = p && p[0] !== '' && p[0] !== null ? colourOf(p[0], defaultFace) : defaultFace
      alphaSum += p ? p[1] : 1
      for (let v = 0; v < 3; v++) c3.set([col.r, col.g, col.b], k * 9 + v * 3)
    })
    g.setAttribute('position', new THREE.BufferAttribute(p3, 3))
    g.setAttribute('color', new THREE.BufferAttribute(c3, 3))
    let geom = g
    if (look?.smooth && style !== 'Wireframe') {
      geom = toCreasedNormals(g, (40 * Math.PI) / 180)
    } else geom.computeVertexNormals()
    const material = materialFor(style, mat, op === 'o')
    if (op === 't' && 'opacity' in material) {
      ;(material as THREE.MeshPhongMaterial).transparent = true
      ;(material as THREE.MeshPhongMaterial).opacity = Math.max(0.15, alphaSum / tris.length)
      ;(material as THREE.MeshPhongMaterial).depthWrite = false
    }
    const mesh = new THREE.Mesh(geom, material)
    mesh.castShadow = true
    mesh.receiveShadow = false
    group.add(mesh)
    if (look?.edges && style !== 'Wireframe' && tris.length < 400000) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 40), new THREE.LineBasicMaterial({ color: new THREE.Color(look.border ?? '#3a4149').multiplyScalar(0.45), transparent: true, opacity: 0.75 }))
      group.add(edges)
    }
  }
  return group
}

/** The selection: tinted red the way OpenSCAD's # modifier looks, once per pixel. */
function buildHighlight(payload: MeshPayload): THREE.Mesh {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(floatsFromBase64(payload.pos), 3))
  const m = new THREE.MeshBasicMaterial({
    color: 0xff2d2d,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.MultiplyBlending,
    premultipliedAlpha: true,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  })
  const mesh = new THREE.Mesh(g, m)
  mesh.renderOrder = 10
  return mesh
}

interface Props {
  data: View3DData
  node: Node
  send: (ev: UiEvent) => void
}

export function View3D({ data, node, send }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const canvas2d = useRef<HTMLCanvasElement>(null)
  const st = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    persp: THREE.PerspectiveCamera
    ortho: THREE.OrthographicCamera
    model: THREE.Group | null
    hi: THREE.Mesh | null
    stage: THREE.Group
    grid: THREE.GridHelper
    axes: THREE.LineSegments
    sun: THREE.DirectionalLight
    ambient: THREE.AmbientLight
    cam: { yaw: number; pitch: number; distance: number; target: number[]; projection: string }
    w: number
    h: number
    bbox: number[] | null
    frame: number
  } | null>(null)
  const dataRef = useRef(data)
  dataRef.current = data
  const sendRef = useRef(send)
  sendRef.current = send

  // ------------------------------------------------------------- set up
  useEffect(() => {
    const el = host.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.className = 'kc-v3-gl'
    el.prepend(renderer.domElement)
    const scene = new THREE.Scene()
    const persp = new THREE.PerspectiveCamera(45, 1, 0.1, 1e7)
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e7, 1e7)
    persp.up.set(0, 0, 1)
    ortho.up.set(0, 0, 1)
    const ambient = new THREE.AmbientLight(0xffffff, 0.55)
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.radius = 6
    scene.add(ambient, sun, sun.target)
    const stage = new THREE.Group()
    scene.add(stage)
    const grid = new THREE.GridHelper(200, 20, 0x5b6168, 0x5b6168)
    grid.rotation.x = Math.PI / 2
    ;(grid.material as THREE.LineBasicMaterial).transparent = true
    ;(grid.material as THREE.LineBasicMaterial).opacity = 0.5
    scene.add(grid)
    const axesGeo = new THREE.BufferGeometry()
    axesGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3))
    const ac = [0xd6 / 255, 0x45 / 255, 0x45 / 255, 0x3f / 255, 0x9e / 255, 0x4d / 255, 0x3a / 255, 0x6f / 255, 0xd8 / 255]
    axesGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array([...ac.slice(0, 3), ...ac.slice(0, 3), ...ac.slice(3, 6), ...ac.slice(3, 6), ...ac.slice(6, 9), ...ac.slice(6, 9)]), 3))
    const axes = new THREE.LineSegments(axesGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }))
    axes.renderOrder = 20
    scene.add(axes)
    st.current = {
      renderer, scene, persp, ortho, model: null, hi: null, stage, grid, axes, sun, ambient,
      cam: { yaw: -65, pitch: 35, distance: 160, target: [0, 0, 10], projection: 'Perspective' },
      w: 1, h: 1, bbox: null, frame: 0,
    }
    const ro = new ResizeObserver(() => {
      const s = st.current
      if (!s) return
      const r = el.getBoundingClientRect()
      s.w = Math.max(1, Math.round(r.width))
      s.h = Math.max(1, Math.round(r.height))
      renderer.setSize(s.w, s.h, false)
      if (canvas2d.current) {
        const dpr = window.devicePixelRatio || 1
        canvas2d.current.width = s.w * dpr
        canvas2d.current.height = s.h * dpr
      }
      sendRef.current({ op: 'v3_camera', ...s.cam, w: s.w, h: s.h })
      draw()
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      renderer.dispose()
      renderer.domElement.remove()
      st.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------ drawing
  const draw = () => {
    const s = st.current
    if (!s) return
    cancelAnimationFrame(s.frame)
    s.frame = requestAnimationFrame(() => render())
  }

  const render = () => {
    const s = st.current
    if (!s) return
    const look = dataRef.current.look
    const { yaw, pitch, distance, target, projection } = s.cam
    const eye = eyeOf(yaw, pitch, distance, target)
    const { up } = orientation(yaw, pitch)
    const ortho = projection === 'Orthographic'
    const cam = ortho ? s.ortho : s.persp
    if (ortho) {
      const px = focal(s.w, s.h) / Math.max(distance, 1e-6)
      s.ortho.left = -s.w / 2 / px
      s.ortho.right = s.w / 2 / px
      s.ortho.top = s.h / 2 / px
      s.ortho.bottom = -s.h / 2 / px
      s.ortho.near = -distance * 50 - 1e5
      s.ortho.far = distance * 50 + 1e5
    } else {
      s.persp.fov = fovFor(s.w, s.h)
      s.persp.aspect = s.w / s.h
      s.persp.near = Math.max(0.1, distance / 1e4)
      s.persp.far = distance * 200 + 1e5
    }
    cam.position.set(eye[0], eye[1], eye[2])
    cam.up.set(up[0], up[1], up[2])
    cam.lookAt(target[0], target[1], target[2])
    cam.updateProjectionMatrix()
    // the light: the desktop's key light, turned / raised by the sliders
    const light = look?.light ?? [0, 0, 0, 0]
    const lv = lightVector(light[2], light[3])
    const size = s.bbox ? Math.max(s.bbox[3] - s.bbox[0], s.bbox[4] - s.bbox[1], s.bbox[5] - s.bbox[2], 1) : 100
    const c = s.bbox ? [(s.bbox[0] + s.bbox[3]) / 2, (s.bbox[1] + s.bbox[4]) / 2, (s.bbox[2] + s.bbox[5]) / 2] : [0, 0, 0]
    s.sun.position.set(c[0] + lv[0] * size * 3, c[1] + lv[1] * size * 3, c[2] + lv[2] * size * 3)
    s.sun.target.position.set(c[0], c[1], c[2])
    const sc = s.sun.shadow.camera as THREE.OrthographicCamera
    sc.left = sc.bottom = -size * 1.5
    sc.right = sc.top = size * 1.5
    sc.near = 0.1
    sc.far = size * 8
    sc.updateProjectionMatrix()
    const bright = light[0] * 0.45
    const contrast = 2 ** light[1]
    s.sun.intensity = Math.max(0, 1.6 * contrast * (1 + bright))
    s.ambient.intensity = Math.max(0.05, (0.55 / contrast) * (1 + bright * 1.5))
    s.grid.visible = !!look?.grid && !look?.stage
    s.stage.visible = !!look?.stage
    const axisLen = distance / 8
    const ap = s.axes.geometry.getAttribute('position') as THREE.BufferAttribute
    ap.set([0, 0, 0, axisLen, 0, 0, 0, 0, 0, 0, axisLen, 0, 0, 0, 0, 0, 0, axisLen])
    ap.needsUpdate = true
    s.renderer.clearStencil()
    s.renderer.render(s.scene, cam)
    overlay(eye, up)
  }

  /** Axis letters, scale bar, the source badge, flash text, anchors. */
  const overlay = (eye: number[], _up: number[]) => {
    const s = st.current
    const cv = canvas2d.current
    if (!s || !cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, s.w, s.h)
    const d = dataRef.current
    const look = d.look
    const cam = s.cam.projection === 'Orthographic' ? s.ortho : s.persp
    const project = (p: number[]) => {
      const v = new THREE.Vector3(p[0], p[1], p[2]).project(cam)
      if (v.z > 1) return null
      return [(v.x * 0.5 + 0.5) * s.w, (-v.y * 0.5 + 0.5) * s.h]
    }
    void eye
    const bg = look?.bgc?.[1] ?? '#22262b'
    const dark = new THREE.Color(bg).getHSL({ h: 0, s: 0, l: 0 }).l < 0.5
    const ink = dark ? '#e8e8e8' : '#333333'
    // axis letters
    ctx.font = 'bold 12px system-ui, sans-serif'
    const L = s.cam.distance / 8
    ;([[[L, 0, 0], 'X', '#d64545'], [[0, L, 0], 'Y', '#3f9e4d'], [[0, 0, L], 'Z', '#3a6fd8']] as [number[], string, string][]).forEach(([p, label, col]) => {
      const q = project(p)
      if (!q) return
      ctx.fillStyle = col
      ctx.fillText(label, q[0] + 3, q[1] - 3)
    })
    // anchors of the selected Object, as View3D._draw_anchors: automatic
    // (bbox) anchors are small quiet dots without names; the origin is an
    // RGB triad with a yellow hub and its name; picked anchors get an arrow
    // and their name
    const label = (x: number, y: number, text: string, color: string) => {
      if (!text) return
      ctx.font = 'bold 11px system-ui, sans-serif'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0,0,0,0.75)'
      ctx.strokeText(text, x, y)
      ctx.fillStyle = color
      ctx.fillText(text, x, y)
    }
    const tick = s.cam.distance / 14
    for (const m of d.markers) {
      if (!['face', 'edge', 'corner'].includes(m.kind)) continue
      const q = project(m.pos)
      if (!q) continue
      ctx.fillStyle = 'rgba(127,157,184,0.67)'
      ctx.beginPath()
      ctx.arc(q[0], q[1], m.kind === 'face' ? 2.6 : 1.8, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const m of d.markers) {
      if (m.kind !== 'origin') continue
      const q = project(m.pos)
      if (!q) continue
      ;([[[tick, 0, 0], '#d64545'], [[0, tick, 0], '#3f9e4d'], [[0, 0, tick], '#3a6fd8']] as [number[], string][]).forEach(([ax, col]) => {
        const tip = project([m.pos[0] + ax[0] * 0.8, m.pos[1] + ax[1] * 0.8, m.pos[2] + ax[2] * 0.8])
        if (!tip) return
        ctx.strokeStyle = col
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.moveTo(q[0], q[1])
        ctx.lineTo(tip[0], tip[1])
        ctx.stroke()
      })
      ctx.fillStyle = '#ffcf40'
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(q[0], q[1], 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      label(q[0] + 8, q[1] - 6, m.name || 'Origin', '#ffcf40')
    }
    for (const m of d.markers) {
      if (m.kind !== 'custom') continue
      const q = project(m.pos)
      if (!q) continue
      const tip = project([m.pos[0] + m.dir[0] * tick * 1.3, m.pos[1] + m.dir[1] * tick * 1.3, m.pos[2] + m.dir[2] * tick * 1.3])
      if (tip) {
        for (const [col, w] of [['rgba(255,255,255,0.86)', 4.5], ['#f0269e', 2.2]] as [string, number][]) {
          ctx.strokeStyle = col
          ctx.lineWidth = w
          ctx.beginPath()
          ctx.moveTo(q[0], q[1])
          ctx.lineTo(tip[0], tip[1])
          ctx.stroke()
        }
        const len = Math.hypot(tip[0] - q[0], tip[1] - q[1]) || 1
        const vx = (tip[0] - q[0]) / len
        const vy = (tip[1] - q[1]) / len
        ctx.beginPath()
        for (const sg of [1, -1]) {
          ctx.moveTo(tip[0], tip[1])
          ctx.lineTo(tip[0] - 8 * vx - 4.5 * sg * vy, tip[1] - 8 * vy + 4.5 * sg * vx)
        }
        ctx.stroke()
      }
      ctx.fillStyle = '#f0269e'
      ctx.strokeStyle = 'rgba(255,255,255,0.92)'
      ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.arc(q[0], q[1], 5.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      label(q[0] + 9, q[1] - 7, m.name, '#f0269e')
    }
    // the pick's hover / pinned target
    if (look?.hover) {
      const h = look.hover
      if (h.tris) {
        const t = floatsFromBase64(h.tris)
        ctx.fillStyle = 'rgba(47, 157, 240, 0.45)'
        for (let i = 0; i + 8 < t.length; i += 9) {
          const a = project([t[i], t[i + 1], t[i + 2]])
          const b = project([t[i + 3], t[i + 4], t[i + 5]])
          const c2 = project([t[i + 6], t[i + 7], t[i + 8]])
          if (!a || !b || !c2) continue
          ctx.beginPath()
          ctx.moveTo(a[0], a[1])
          ctx.lineTo(b[0], b[1])
          ctx.lineTo(c2[0], c2[1])
          ctx.fill()
        }
      }
      const q = h.pos ? project(h.pos) : null
      if (q && h.label) {
        ctx.font = 'bold 11px system-ui, sans-serif'
        ctx.fillStyle = '#2f9df0'
        ctx.fillText(h.label, q[0] + 8, q[1] - 8)
      }
    }
    // scale bar: true at the orbit centre
    ctx.strokeStyle = ink
    ctx.fillStyle = ink
    if (look?.scale_bar) {
      const ppu = focal(s.w, s.h) / Math.max(s.cam.distance, 1e-6)
      const bar = scaleBar(ppu, look.unit, look.real_scale)
      if (bar) {
        const [label, px] = bar
        const x0 = 14
        const y0 = s.h - 30
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.lineTo(x0 + px, y0)
        ctx.moveTo(x0, y0 - 5)
        ctx.lineTo(x0, y0 + 5)
        ctx.moveTo(x0 + px, y0 - 5)
        ctx.lineTo(x0 + px, y0 + 5)
        ctx.stroke()
        ctx.font = '12px system-ui, sans-serif'
        const w = ctx.measureText(label).width
        ctx.fillText(label, x0 + px / 2 - w / 2, y0 - 8)
        if (look.ratio) ctx.fillText(look.ratio, x0, y0 + 20)
      }
    }
    // the badge: where the mesh came from
    ctx.font = '12px system-ui, sans-serif'
    const count = d.mesh?.n ?? 0
    ctx.fillText(`${look?.source ?? ''} — ${count} triangles · ${look?.style ?? 'Shaded'}`, 8, s.h - 8)
    // banner (pick instructions) and flash messages across the top
    const banner = look?.banner || look?.flash
    if (banner) {
      ctx.font = 'bold 12px system-ui, sans-serif'
      const w = ctx.measureText(banner).width + 24
      ctx.fillStyle = 'rgba(24, 27, 31, 0.8)'
      ctx.fillRect(s.w / 2 - w / 2, 10, w, 26)
      ctx.fillStyle = '#f2f6fa'
      ctx.fillText(banner, s.w / 2 - w / 2 + 12, 28)
    }
  }

  // --------------------------------------------------- data from Python
  useEffect(() => {
    const s = st.current
    if (!s) return
    if (s.model) {
      s.scene.remove(s.model)
      s.model.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose()
      })
      s.model = null
    }
    if (data.mesh && data.mesh.n) {
      s.model = buildModel(data.mesh, data.look)
      s.scene.add(s.model)
      s.bbox = bounds(floatsFromBase64(data.mesh.pos))
    } else s.bbox = null
    // the platform: a round slab under the model, lit from the top left
    s.stage.clear()
    if (s.bbox) {
      const b = s.bbox
      const r = Math.max(b[3] - b[0], b[4] - b[1]) * 0.75 + Math.max(b[5] - b[2], 1) * 0.1 + 2
      const thick = Math.max(r * 0.04, 0.5)
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 1.02, thick, 96),
        new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.85, metalness: 0 }),
      )
      disc.rotation.x = Math.PI / 2
      disc.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[2] - thick / 2 - 0.01)
      disc.receiveShadow = true
      s.stage.add(disc)
    }
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.mesh, data.look?.style, data.look?.smooth, data.look?.edges, data.look?.base])

  useEffect(() => {
    const s = st.current
    if (!s) return
    if (s.hi) {
      s.scene.remove(s.hi)
      s.hi.geometry.dispose()
      ;(s.hi.material as THREE.Material).dispose()
      s.hi = null
    }
    if (data.hi && data.hi.n) {
      s.hi = buildHighlight(data.hi)
      s.scene.add(s.hi)
    }
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.hi])

  useEffect(() => {
    const s = st.current
    if (!s || !data.cam) return
    s.cam = { ...data.cam, target: [...data.cam.target] }
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.camRev])

  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.look, data.markers])

  // ---------------------------------------------------------------- mouse
  const drag = useRef<{ mode: 'orbit' | 'pan'; x: number; y: number } | null>(null)
  const camTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reportCamera = () => {
    if (camTimer.current) clearTimeout(camTimer.current)
    camTimer.current = setTimeout(() => {
      const s = st.current
      if (s) sendRef.current({ op: 'v3_camera', ...s.cam, w: s.w, h: s.h, moved: 1 })
    }, 120)
  }
  const forwarded = () => !!(dataRef.current.look?.pick || dataRef.current.look?.edit)
  const local = (e: React.PointerEvent | React.MouseEvent | React.WheelEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const buttonOf = (b: number) => (b === 0 ? 1 : b === 2 ? 2 : 4)
  const mods = (e: React.MouseEvent) => qtKey({ key: 'Shift', ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }).mods

  const style = data.look?.bgc ? { background: `linear-gradient(${data.look.bgc[0]}, ${data.look.bgc[1]})` } : undefined
  return (
    <div
      ref={host}
      className="kc-view3d"
      style={style}
      tabIndex={0}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('.kc-overlay')) return
        ;(e.currentTarget as HTMLElement).focus()
        const p = local(e)
        if (forwarded()) {
          send({ op: 'v3_press', x: p.x, y: p.y, button: buttonOf(e.button), buttons: e.buttons, mods: mods(e) })
          if (dataRef.current.look?.edit) drag.current = { mode: 'orbit', x: e.clientX, y: e.clientY }
          return
        }
        drag.current = { mode: e.button === 0 ? 'orbit' : 'pan', x: e.clientX, y: e.clientY }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const s = st.current
        if (!s) return
        if (forwarded()) {
          const p = local(e)
          send({ op: 'v3_move', x: p.x, y: p.y, buttons: e.buttons, mods: mods(e) })
          return
        }
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        d.x = e.clientX
        d.y = e.clientY
        if (d.mode === 'orbit') [s.cam.yaw, s.cam.pitch] = orbit(s.cam.yaw, s.cam.pitch, dx, dy)
        else s.cam.target = pan(s.cam.yaw, s.cam.pitch, s.cam.distance, s.cam.target, dx, dy)
        draw()
        reportCamera()
      }}
      onPointerUp={(e) => {
        if (forwarded()) {
          const p = local(e)
          send({ op: 'v3_release', x: p.x, y: p.y, button: buttonOf(e.button), buttons: e.buttons, mods: mods(e) })
        }
        drag.current = null
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.kc-overlay')) return
        const p = local(e)
        send({ op: 'v3_dbl', x: p.x, y: p.y, button: 1, buttons: 1, mods: mods(e) })
      }}
      onWheel={(e) => {
        const s = st.current
        if (!s || (e.target as HTMLElement).closest('.kc-overlay')) return
        if (dataRef.current.look?.edit) {
          const p = local(e)
          send({ op: 'v3_wheel', x: p.x, y: p.y, dy: -e.deltaY })
          return
        }
        s.cam.distance = zoom(s.cam.distance, e.deltaY)
        draw()
        reportCamera()
      }}
      onKeyDown={(e) => {
        const k = qtKey(e.nativeEvent)
        if (!k.key) return
        if (k.key === 0x01000001 /* Tab: Edit Mode */ || forwarded()) {
          e.preventDefault()
          e.stopPropagation()
          send({ op: 'v3_key', key: k.key, mods: k.mods })
        }
      }}
    >
      <canvas ref={canvas2d} className="kc-v3-overlay" />
      {(node.overlays ?? []).map((o) =>
        o.hid ? null : (
          <div key={o.id} className={`kc-overlay kc-overlay-${o.name ?? 'bar'}`}>
            <QtNode n={o} />
          </div>
        ),
      )}
    </div>
  )
}
