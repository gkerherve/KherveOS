// AI tools of kMotion (the manifest is src/os/ai/manifests/kmotion.ts). Written against a small set of hooks the window
// provides, so that the logic can be tested without a browser.

import type { useAppTools } from '@/os/ai/appTools'
import { runHeadless, readoutText } from './analysis.ts'
import { motionExamples, exampleById } from './examples.ts'
import { isMethod, METHODS, type Method } from './integrators.ts'
import { cleanParams, defaultDoc, defaultMethod, SCENES, sceneById } from './registry.ts'
import { paramsOf } from './common.ts'
import type { KMotionDoc, ParamValue, Params, Readout, SceneId } from './types.ts'

type Tools = Parameters<typeof useAppTools>[1]

export interface Hooks {
  state(): { doc: KMotionDoc; dirty: boolean; t: number; running: boolean; method: Method; sample: Record<string, number>; readouts: Readout[]; finished: boolean; title: string }
  /** Replaces the scene (the window shows it from t = 0). */
  load(doc: KMotionDoc, label?: string): void
  /** Changes one parameter; returns the parameters after the change. */
  setParam(key: string, value: ParamValue): Params
  setMethod(m: Method): void
  setMode(mode: string): Params
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const round = (x: number) => (Number.isFinite(x) ? Number(x.toPrecision(7)) : null)

/** The parameter definitions of a mode as the AI sees them. */
export function describeParams(scene: SceneId, mode: string) {
  const def = sceneById(scene)!
  return paramsOf(def.params, mode).filter((d) => d.key !== 'world').map((d) =>
    d.kind === 'number'
      ? { key: d.key, label: d.label, unit: d.unit ?? '', min: d.min, max: d.max, default: d.value, live: d.live === true }
      : d.kind === 'choice'
        ? { key: d.key, label: d.label, choices: d.options.map((o) => o.value), default: d.value, live: d.live === true }
        : { key: d.key, label: d.label, boolean: true, default: d.value, live: d.live === true },
  )
}

/** Parameters shown to the AI: the sandbox world is summarised. */
function visibleParams(p: Params): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p)) {
    if (k === 'world' && v && typeof v === 'object') {
      const w = v as { bodies?: unknown[]; joints?: unknown[] }
      out.world = `${w.bodies?.length ?? 0} bodies, ${w.joints?.length ?? 0} joints`
    } else out[k] = v
  }
  return out
}

export function kmotionTools(h: Hooks): Tools {
  return {
    get_state: async () => {
      const s = h.state()
      const def = sceneById(s.doc.scene)!
      const mode = String(s.doc.params.mode)
      return {
        title: s.title,
        scene: s.doc.scene,
        scenes: SCENES.map((x) => ({ id: x.id, modes: x.modes.map((m) => m.id) })),
        mode,
        modeDescription: def.modes.find((m) => m.id === mode)?.blurb,
        params: visibleParams(s.doc.params),
        parameterSpecs: describeParams(s.doc.scene, mode),
        method: s.method,
        methods: METHODS.map((m) => m.id),
        time: round(s.t),
        running: s.running,
        finished: s.finished,
        unsavedChanges: s.dirty,
        values: Object.fromEntries(Object.entries(s.sample).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => [k, round(v)])),
        readouts: s.readouts.map(readoutText),
      }
    },

    load_example: async (a, ctx) => {
      const id = typeof a.id === 'string' ? a.id.trim() : ''
      if (!id) return { examples: motionExamples().map((e) => ({ id: e.id, group: e.group, title: e.title, description: e.description })) }
      const ex = exampleById(id) ?? motionExamples().find((e) => e.title.toLowerCase() === id.toLowerCase())
      if (!ex) throw new Error(`No example “${id}”. Examples: ${motionExamples().map((e) => e.id).join(', ')}.`)
      if (h.state().dirty && !(await ctx.confirm('Replace the open kMotion scene', `Open “${ex.title}” and lose the unsaved changes.`))) return { loaded: false, reason: 'the user declined' }
      h.load(ex.doc, ex.title)
      return { loaded: true, id: ex.id, title: ex.title, description: ex.description, scene: ex.doc.scene, mode: ex.doc.params.mode }
    },

    run: async (a, ctx) => {
      try {
        const open = h.state()
        const sceneId = (typeof a.scene === 'string' && a.scene ? a.scene : open.doc.scene) as SceneId
        const def = sceneById(sceneId)
        if (!def) throw new Error(`Unknown scene “${String(a.scene)}”. Scenes: ${SCENES.map((s) => s.id).join(', ')}.`)
        const same = sceneId === open.doc.scene
        const mode = typeof a.mode === 'string' && a.mode ? a.mode : same ? String(open.doc.params.mode) : def.modes[0].id
        if (!def.modes.some((m) => m.id === mode)) throw new Error(`Unknown mode “${mode}” for ${sceneId}. Modes: ${def.modes.map((m) => m.id).join(', ')}.`)
        const base = same && mode === open.doc.params.mode ? open.doc.params : def.defaults(mode)
        const given = (a.params && typeof a.params === 'object' ? a.params : {}) as Params
        const known = new Set(paramsOf(def.params, mode).map((d) => d.key))
        const unknown = Object.keys(given).filter((k) => !known.has(k) && k !== 'world')
        const params = cleanParams(sceneId, { ...base, ...given, mode })
        const method = isMethod(a.method) ? a.method : same ? open.method : defaultMethod(sceneId, mode)
        const doc: KMotionDoc = { ...defaultDoc(sceneId, mode), params, method }
        const duration = typeof a.duration === 'number' && a.duration > 0 ? a.duration : 10
        const r = runHeadless(doc, { duration, method, samples: 12, maxMillis: 5000 })
        if (a.show === true) {
          if (open.dirty && !(await ctx.confirm('Replace the open kMotion scene', 'Show the run in the window and lose the unsaved changes.'))) {
            /* the user keeps their scene; the numbers are still returned */
          } else h.load(doc, 'AI run')
        }
        return {
          scene: r.scene, mode: r.mode, method: r.method, timeReached: round(r.t), timeUnit: r.timeUnit, lengthUnit: r.lengthUnit, steps: r.steps, finished: r.finished, ...(r.truncated ? { truncated: 'stopped early: the run took too long, ask for a shorter duration' } : {}),
          final: r.final, min: r.min, max: r.max, samples: r.samples, readouts: r.readouts.map(readoutText), energyDrift: r.energyDrift,
          ...(unknown.length ? { ignoredParameters: unknown, validKeys: [...known] } : {}),
        }
      } catch (e) {
        throw new Error(msg(e))
      }
    },

    set_param: async (a) => {
      const key = typeof a.key === 'string' ? a.key.trim() : ''
      if (!key) throw new Error('Give the parameter key (see get_state).')
      const s = h.state()
      const def = sceneById(s.doc.scene)!
      if (key === 'method') {
        if (!isMethod(a.value)) throw new Error(`method must be one of ${METHODS.map((m) => m.id).join(', ')}.`)
        h.setMethod(a.value)
        return { method: a.value }
      }
      if (key === 'mode') {
        const m = String(a.value)
        if (!def.modes.some((x) => x.id === m)) throw new Error(`Unknown mode “${m}”. Modes of ${def.id}: ${def.modes.map((x) => x.id).join(', ')}.`)
        return { mode: m, params: visibleParams(h.setMode(m)), parameterSpecs: describeParams(def.id, m) }
      }
      const d = paramsOf(def.params, String(s.doc.params.mode)).find((x) => x.key === key)
      if (!d) throw new Error(`No parameter “${key}” in ${def.id}/${String(s.doc.params.mode)}. Keys: ${paramsOf(def.params, String(s.doc.params.mode)).map((x) => x.key).join(', ')}.`)
      let value = a.value as ParamValue
      if (d.kind === 'number') {
        const n = typeof value === 'number' ? value : Number(value)
        if (!Number.isFinite(n)) throw new Error(`${key} must be a number between ${d.min} and ${d.max}.`)
        value = Math.min(d.max, Math.max(d.min, n))
      } else if (d.kind === 'choice') {
        if (typeof value !== 'string' || !d.options.some((o) => o.value === value)) throw new Error(`${key} must be one of ${d.options.map((o) => o.value).join(', ')}.`)
      } else value = value === true || value === 'true'
      const params = h.setParam(key, value)
      return { key, value: params[key], clamped: d.kind === 'number' && value !== a.value, live: d.live === true, readouts: h.state().readouts.map(readoutText) }
    },
  }
}
