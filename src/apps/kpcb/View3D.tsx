// The 3D tab of the board (three.js is loaded the first time it is shown).

import { useEffect, useRef, useState } from 'react'
import { Box, Layers, Orbit, RotateCw } from 'lucide-react'
import type { Design, Fills } from './types.ts'
import type { Scene3D, ViewMode } from './scene3d.ts'

interface Props {
  design: Design
  fills: Fills
}

export function View3D({ design, fills }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<Scene3D | null>(null)
  const latest = useRef({ design, fills })
  latest.current = { design, fills }
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [wire, setWire] = useState(false)
  const [spin, setSpin] = useState(false)
  const [mode, setMode] = useState<ViewMode>('iso')

  useEffect(() => {
    let dead = false
    const el = host.current
    if (!el) return
    import('./scene3d.ts')
      .then((m) => {
        if (dead) return
        const s = m.createScene3D(el)
        scene.current = s
        s.setDesign(latest.current.design, latest.current.fills)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (!dead) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      dead = true
      scene.current?.dispose()
      scene.current = null
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => scene.current?.setDesign(design, fills), 150)
    return () => clearTimeout(t)
  }, [design, fills])
  useEffect(() => { scene.current?.setWireframe(wire) }, [wire])
  useEffect(() => { scene.current?.setRotate(spin) }, [spin])

  const pick = (m: ViewMode) => {
    setMode(m)
    scene.current?.setView(m)
  }

  return (
    <div className="kb-3d">
      <div ref={host} className="kb-3d-host" />
      <div className="kb-3d-bar">
        <button className={`k-icon-btn${mode === 'top' ? ' active' : ''}`} title="View from the top" aria-label="Top view" onClick={() => pick('top')}><Layers size={15} /></button>
        <button className={`k-icon-btn${mode === 'bottom' ? ' active' : ''}`} title="View from the bottom" aria-label="Bottom view" onClick={() => pick('bottom')}><Layers size={15} style={{ transform: 'scaleY(-1)' }} /></button>
        <button className={`k-icon-btn${mode === 'iso' ? ' active' : ''}`} title="Three-quarter view" aria-label="Three-quarter view" onClick={() => pick('iso')}><Box size={15} /></button>
        <span className="k-sep" />
        <button className={`k-icon-btn${spin ? ' active' : ''}`} title="Rotate by itself" aria-label="Rotate" onClick={() => setSpin((v) => !v)}><RotateCw size={15} /></button>
        <button className={`k-icon-btn${wire ? ' active' : ''}`} title="Wireframe" aria-label="Wireframe" onClick={() => setWire((v) => !v)}><Orbit size={15} /></button>
      </div>
      {loading && !error && <div className="kb-3d-note">Loading the 3D view…</div>}
      {error && <div className="kb-3d-note kb-bad">The 3D view needs WebGL: {error}</div>}
      <div className="kb-3d-hint k-muted">Drag to turn, scroll to zoom, right-drag to move</div>
    </div>
  )
}
