// AI tools of kFEA: finite elements for trusses, beams, frames and plates. At most 4 tools, ≤ 6 arguments each.
// The code is in src/apps/kfea/aiTools.ts.

import type { AppToolSet, Schema } from '../appToolsCore.ts'
import { object, oneOf, num, str } from './schema.ts'

const anyObject = (description: string): Schema => ({ type: 'object', description, additionalProperties: true })
const objects = (description: string): Schema => ({ type: 'array', description, items: { type: 'object', additionalProperties: true } })

export const KFEA_TOOL_SET: AppToolSet = {
  app: 'kfea',
  name: 'kFEA',
  summary: 'finite elements: trusses, beams, frames and plates (mesh, stress maps, modes); solve and read results.',
  keywords: [
    'kfea', 'fea', 'finite element', 'finite elements', 'truss', 'beam', 'frame', 'stress', 'strain', 'deflection', 'mesh', 'structural', 'von mises', 'buckling', 'natural frequency',
    'plate', 'bridge', 'cantilever', 'reaction', 'bending moment', 'shear force', 'safety factor',
  ],
  tools: [
    {
      action: 'get_state',
      description: 'The model open in kFEA (nodes, members, supports, loads or the plate), problems found, and optionally the full .kfea JSON or the last results.',
      inputSchema: object({ include: oneOf(['summary', 'model', 'results'], 'summary (default), the full .kfea JSON (model) or the last solution (results).') }),
      readOnly: true,
    },
    {
      action: 'solve',
      description: 'Solve the open model (static, modal or buckling) and return displacements, reactions, member forces, max stress, safety factor. Or pass a whole .kfea model JSON to solve it without opening it.',
      inputSchema: object({
        model: anyObject('Optional: a complete .kfea model (format "kfea", SI units) to solve instead of the open one.'),
        study: oneOf(['static', 'modal', 'buckling'], 'What to compute for frames (default: the model\'s own).'),
        modes: num('How many modes for modal / buckling (default 6 / 4).'),
        divisions: num('Elements per member for modal / buckling (default 8).'),
        show: { type: 'boolean', description: 'With a model: also open it in the window (asks if there are unsaved changes).' },
      }),
    },
    {
      action: 'load_example',
      description: 'Open one of 17 ready models with known answers (trusses, beams, portal frame, plate with hole, Cook\'s membrane, Lamé cylinder, frequency, buckling). Without an id, lists them.',
      inputSchema: object({ id: str('The example id, e.g. "truss-warren" or "plate-hole". Leave out to list them.') }),
    },
    {
      action: 'add',
      description: 'Add to the open model in its display units: nodes, members (ids or [x,y] ends), supports, nodal/member loads, or for plates the outline, holes, supports and loads.',
      inputSchema: object({
        nodes: objects('[{id?, x, y}]'),
        members: objects('[{id?, from, to, section?, material?, hingeStart?, hingeEnd?}]: from/to are node ids or [x,y]. Sections: IPE200, HEA200, UPN160, RECT100x200, CIRC50, TUBE114x6…; materials: S235, S355, AL6061…'),
        supports: objects('[{node, type: pinned|roller|roller-x|fixed|spring|free, k?}]'),
        loads: objects('[{node, fx?, fy?, mz?}] or [{member, kind: udl|point|thermal, w? (per length), dir? x|y|lx|ly, p?, at?, from?, to?, dT?, dTg?}] (y is up: a downward load is negative)'),
        section: str('Default section for new members.'),
        plate: anyObject('For plane stress / strain models: {outline: [[x,y]…], holes?: [[[x,y]…]], thickness, material, meshSize, elements?: tri|quad, supports?: [{edge|line|circle|vertex|point, ux?, uy?}], loads?: [{edge|line|circle…, pressure|tx,ty|force:{fx,fy}}]}'),
      }),
    },
  ],
}
