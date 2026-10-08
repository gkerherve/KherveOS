// AI tools of kPCB (the manifest is src/os/ai/manifests/kpcb.ts). They work on the open board
// through the hooks the window gives (no browser code here: Node tests drive them with fake hooks).

import type { AppToolContext, useAppTools } from '@/os/ai/appTools'
import { analyze, ratsnest } from './analysis.ts'
import { addPart, addTrackPath, addVia, adoptNets, applyOutlinePreset, boardZone, addZone, OUTLINE_PRESETS, setOutlineRect } from './ops.ts'
import { getFootprint, searchFootprints } from './footprints.ts'
import { drcSummary } from './drc.ts'
import { EXAMPLES } from './examples.ts'
import { netClassOf, trackLength } from './board.ts'
import { bomCsv, bomMarkdown, pickAndPlaceCsv } from './export/bom.ts'
import { renderSvg } from './export/svg.ts'
import { gerberZip } from './export/zip.ts'
import { boardSummary } from './export/summary.ts'
import type { NetlistReport } from './netlist.ts'
import type { RouteResult } from './autoroute.ts'
import type { CopperId, Design, Fills, Violation } from './types.ts'
import type { Pt } from './geom.ts'

type Tools = Parameters<typeof useAppTools>[1]

export interface Hooks {
  get(): Design
  /** The zones filled for the current design. */
  fills(): Fills
  /** Make a change (one undo step). */
  commit(d: Design): void
  /** Replace the whole board (an example); resolves when it is on screen. */
  load(id: string): Promise<{ title: string }>
  importNetlist(input: unknown, mode: 'replace' | 'update'): NetlistReport
  drc(): Violation[]
  route(nets?: string[]): RouteResult
  /** Write a text file or bytes (creating folders). */
  write(path: string, data: string | Uint8Array): Promise<void>
  /** A PNG image of the board. */
  png(side: 'F' | 'B', scheme: 'board' | 'bw'): Promise<Uint8Array>
}

const num = (v: unknown, fallback?: number): number => {
  const n = Number(v)
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) {
    if (fallback !== undefined) return fallback
    throw new Error(`${String(v)} is not a number.`)
  }
  return n
}
const r3 = (n: number) => Math.round(n * 1000) / 1000
const layerOf = (v: unknown, fallback: CopperId = 'F.Cu'): CopperId => {
  const s = String(v ?? '').toLowerCase()
  if (!s) return fallback
  if (s === 'f.cu' || s === 'f' || s === 'top') return 'F.Cu'
  if (s === 'b.cu' || s === 'b' || s === 'bottom') return 'B.Cu'
  throw new Error(`"${String(v)}" is not a copper layer: use F.Cu or B.Cu.`)
}

function footprintError(name: string): Error {
  const near = searchFootprints(name.split(/[\s_-]/)[0] ?? '').slice(0, 8).map((f) => f.name)
  return new Error(`No footprint "${name}".${near.length ? ` Similar: ${near.join(', ')}.` : ' Examples: R_0805, C_0805, DIP-8, PinHeader_1x04, LED_5mm.'}`)
}

/** Points as the AI gives them: {x, y, via?} or [x, y]. */
function pointsOf(v: unknown): Array<Pt & { via?: boolean }> {
  if (!Array.isArray(v)) return []
  return v.map((p) => {
    if (Array.isArray(p)) return { x: num(p[0]), y: num(p[1]) }
    const o = p as Record<string, unknown>
    return { x: num(o.x), y: num(o.y), ...(o.via ? { via: true } : {}) }
  })
}

export function describeBoard(d: Design, fills: Fills, drc: Violation[]) {
  const an = analyze(d, fills)
  const rats = ratsnest(d, an)
  const missing = new Map<string, number>()
  for (const r of rats) missing.set(r.net, (missing.get(r.net) ?? 0) + 1)
  const s = boardSummary(d, fills)
  const sum = drcSummary(drc)
  return {
    name: d.name,
    size_mm: { width: s.widthMm, height: s.heightMm },
    outline: d.outline.rect ? { ...d.outline.rect } : { polygon_corners: d.outline.pts.length },
    parts: d.parts.slice(0, 150).map((p) => ({ ref: p.ref, value: p.value, footprint: p.fp, x: r3(p.x), y: r3(p.y), rotation: p.rot, side: p.side, ...(p.locked ? { locked: true } : {}), ...(p.stale ? { not_in_netlist: true } : {}) })),
    nets: d.nets.slice(0, 150).map((n) => ({ name: n.name, class: n.cls, pins: n.pins.map((p) => `${p.ref}.${p.pin}`), unconnected: missing.get(n.name) ?? 0 })),
    tracks: { segments: d.tracks.length, length_mm: r3(trackLength(d)) },
    vias: d.vias.length,
    zones: d.zones.map((z) => ({ net: z.net, layer: z.layer })),
    mounting_holes: d.holes.length,
    unconnected_connections: rats.length,
    drc: { errors: sum.errors, warnings: sum.warnings },
    truncated: d.parts.length > 150 || d.nets.length > 150,
  }
}

const PRESET_IDS = OUTLINE_PRESETS.map((p) => p.id)

export function kpcbTools(h: Hooks): Tools {
  return {
    get_board: async () => describeBoard(h.get(), h.fills(), h.drc()),

    load_example: async (a) => {
      const id = String(a.id ?? '').trim()
      if (!id) return { examples: EXAMPLES.map((e) => ({ id: e.id, title: e.title, description: e.description })) }
      if (!EXAMPLES.some((e) => e.id === id)) throw new Error(`No example "${id}". Examples: ${EXAMPLES.map((e) => e.id).join(', ')}.`)
      const r = await h.load(id)
      return { loaded: r.title, ...describeBoard(h.get(), h.fills(), []) }
    },

    import_netlist: async (a) => {
      const mode = String(a.mode ?? '') === 'replace' ? 'replace' : String(a.mode ?? '') === 'update' ? 'update' : h.get().parts.length ? 'update' : 'replace'
      const input = a.netlist ?? a.text
      if (input === undefined || input === null || input === '') throw new Error('netlist is needed: a knetlist object ({format:"knetlist", components, nets}), or text ("R1 10k R_0805 | VCC:1 GND:2").')
      const rep = h.importNetlist(input, mode)
      const d = h.get()
      return { mode, added: rep.added, removed: rep.removed, changed: rep.changed, warnings: rep.warnings.slice(0, 20), parts: d.parts.length, nets: d.nets.length }
    },

    place: async (a) => {
      const d = h.get()
      const ref = String(a.ref ?? '').trim()
      const existing = ref ? d.parts.find((p) => p.ref === ref) : undefined
      const fpName = a.footprint === undefined ? undefined : String(a.footprint)
      if (fpName !== undefined && !getFootprint(fpName)) throw footprintError(fpName)
      if (existing) {
        const next = {
          ...existing,
          ...(fpName ? { fp: getFootprint(fpName)!.name } : {}),
          ...(a.x !== undefined ? { x: num(a.x) } : {}),
          ...(a.y !== undefined ? { y: num(a.y) } : {}),
          ...(a.rotation !== undefined ? { rot: ((num(a.rotation) % 360) + 360) % 360 } : {}),
          ...(a.side !== undefined ? { side: String(a.side).toUpperCase().startsWith('B') ? ('B' as const) : ('F' as const) } : {}),
          ...(a.value !== undefined ? { value: String(a.value) } : {}),
        }
        h.commit({ ...d, parts: d.parts.map((p) => (p.id === existing.id ? next : p)) })
        return { ref, moved: true, x: r3(next.x), y: r3(next.y), rotation: next.rot, side: next.side, footprint: next.fp }
      }
      if (!fpName) throw new Error(ref ? `There is no part ${ref}: give its footprint to place it.` : 'footprint is needed to place a new part.')
      const b = d.outline.pts.length ? { x: (d.outline.rect?.x ?? 0) + (d.outline.rect?.w ?? 50) / 2, y: (d.outline.rect?.y ?? 0) + (d.outline.rect?.h ?? 50) / 2 } : { x: 25, y: 25 }
      const r = addPart(d, fpName, num(a.x, b.x), num(a.y, b.y), {
        rot: a.rotation === undefined ? 0 : ((num(a.rotation) % 360) + 360) % 360,
        side: String(a.side ?? 'F').toUpperCase().startsWith('B') ? 'B' : 'F',
        ...(ref ? { ref } : {}),
        ...(a.value !== undefined ? { value: String(a.value) } : {}),
      })
      h.commit(r.design)
      return { ref: r.part.ref, placed: true, x: r.part.x, y: r.part.y, rotation: r.part.rot, side: r.part.side, footprint: r.part.fp, value: r.part.value }
    },

    route: async (a) => {
      const d = h.get()
      const mode = String(a.mode ?? 'auto')
      const net = String(a.net ?? '').trim()
      if (mode === 'auto') {
        if (net && net.toLowerCase() !== 'all' && !d.nets.some((n) => n.name === net)) throw new Error(`No net "${net}". Nets: ${d.nets.map((n) => n.name).slice(0, 30).join(', ')}.`)
        const r = h.route(net && net.toLowerCase() !== 'all' ? [net] : undefined)
        return {
          routed_percent: r.completion, connections_before: r.total, connections_left: r.remaining, failed_nets: r.failedNets, tracks_added: r.tracksAdded, vias_added: r.viasAdded, seconds: Math.round(r.ms / 100) / 10,
        }
      }
      if (!net) throw new Error('net is needed.')
      if (!d.nets.some((n) => n.name === net)) throw new Error(`No net "${net}". Nets: ${d.nets.map((n) => n.name).slice(0, 30).join(', ')}.`)
      if (mode === 'zone') {
        const layer = layerOf(a.layer, 'B.Cu')
        const pts = pointsOf(a.points)
        const next = pts.length >= 3 ? addZone(d, pts, net, layer).design : boardZone(d, net, layer)
        h.commit(next)
        return { zone: { net, layer, corners: pts.length >= 3 ? pts.length : 'the whole board' }, note: 'The zone is filled automatically.' }
      }
      if (mode !== 'manual-points') throw new Error('mode is "auto", "manual-points" or "zone".')
      const pts = pointsOf(a.points)
      if (pts.length < 2) throw new Error('points needs at least two {x, y} points (pad centres or corners).')
      let layer = layerOf(a.layer)
      const width = num(a.width, netClassOf(d, net).track)
      let cur = d
      let run: Pt[] = [pts[0]]
      let tracks = 0
      let vias = 0
      const flush = () => {
        const r = addTrackPath(cur, run, layer, width, net)
        cur = r.design
        tracks += r.ids.length
      }
      for (let i = 1; i < pts.length; i++) {
        run.push(pts[i])
        if (pts[i].via) {
          flush()
          cur = addVia(cur, pts[i].x, pts[i].y, net).design
          vias++
          layer = layer === 'F.Cu' ? 'B.Cu' : 'F.Cu'
          run = [pts[i]]
        }
      }
      flush()
      h.commit(adoptNets(cur))
      return { net, tracks_added: tracks, vias_added: vias, ending_layer: layer, width }
    },

    run_drc: async () => {
      const v = h.drc()
      const s = drcSummary(v)
      return {
        errors: s.errors,
        warnings: s.warnings,
        clean: v.length === 0,
        violations: v.slice(0, 60).map((x) => ({ severity: x.severity, rule: x.rule, message: x.message, x: r3(x.x), y: r3(x.y) })),
        truncated: v.length > 60,
      }
    },

    set_outline: async (a) => {
      const d = h.get()
      const preset = String(a.preset ?? '').trim()
      if (preset) {
        if (!PRESET_IDS.includes(preset)) throw new Error(`No preset "${preset}". Presets: ${PRESET_IDS.join(', ')}.`)
        h.commit(applyOutlinePreset(d, preset))
        return { preset, ...h.get().outline.rect }
      }
      if (a.width === undefined && a.height === undefined) return { outline: d.outline.rect ?? { polygon_corners: d.outline.pts.length }, presets: OUTLINE_PRESETS.map((p) => ({ id: p.id, name: p.name })) }
      const r = d.outline.rect
      const w = num(a.width, r?.w ?? 50)
      const hh = num(a.height, r?.h ?? 50)
      if (w < 2 || hh < 2) throw new Error('The board must be at least 2 x 2 mm.')
      h.commit(setOutlineRect(d, num(a.x, r?.x ?? 0), num(a.y, r?.y ?? 0), w, hh, num(a.corner_radius, r?.r ?? 0)))
      return { ...h.get().outline.rect }
    },

    export: async (a, ctx: AppToolContext) => {
      const what = String(a.what ?? '').toLowerCase()
      const d = h.get()
      const side: 'F' | 'B' = String(a.side ?? 'top').toLowerCase().startsWith('b') ? 'B' : 'F'
      const scheme: 'board' | 'bw' = /^(bw|black|print|mono)/i.test(String(a.scheme ?? '')) ? 'bw' : 'board'
      const kinds: Record<string, { ext: string; name: string }> = {
        gerber: { ext: '.zip', name: `${d.name}-gerbers.zip` },
        svg: { ext: '.svg', name: `${d.name}-${side === 'F' ? 'top' : 'bottom'}.svg` },
        png: { ext: '.png', name: `${d.name}-${side === 'F' ? 'top' : 'bottom'}.png` },
        bom: { ext: '', name: `${d.name}-bom.csv` },
        pnp: { ext: '.csv', name: `${d.name}-pnp.csv` },
      }
      const k = kinds[what]
      if (!k) throw new Error('what is "gerber", "svg", "png", "bom" or "pnp".')
      let path = String(a.path ?? '').trim()
      if (!path) throw new Error('path is needed (a file or a folder).')
      if (what === 'bom' ? !/\.(csv|md)$/i.test(path) : !path.toLowerCase().endsWith(k.ext)) path = `${path.replace(/\/$/, '')}/${k.name}`
      if (!(await ctx.confirm(`write the ${what} export of ${d.name}`, path))) throw new Error('The user did not allow writing the file.')
      const fills = h.fills()
      if (what === 'gerber') await h.write(path, gerberZip(d, fills))
      else if (what === 'svg') await h.write(path, renderSvg(d, fills, { side, scheme }))
      else if (what === 'png') await h.write(path, await h.png(side, scheme))
      else if (what === 'bom') await h.write(path, path.toLowerCase().endsWith('.md') ? bomMarkdown(d) : bomCsv(d))
      else await h.write(path, pickAndPlaceCsv(d))
      return { written: path, what }
    },
  }
}
