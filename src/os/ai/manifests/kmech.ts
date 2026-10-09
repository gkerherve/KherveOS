// AI tools of kMech: linkages (kinematics, dynamics), cams and gears. At most 4 tools, ≤ 6 arguments each.
// The code is in src/apps/kmech/aiTools.ts.

import type { AppToolSet, Schema } from '../appToolsCore.ts'
import { bool, num, object, oneOf, str } from './schema.ts'

const anyObject = (description: string): Schema => ({ type: 'object', description, additionalProperties: true })

export const KMECH_TOOL_SET: AppToolSet = {
  app: 'kmech',
  name: 'kMech',
  summary: 'mechanisms: linkage kinematics and dynamics, cams and gears.',
  keywords: [
    'kmech', 'mechanism', 'mechanisms', 'linkage', 'four-bar', 'four bar', 'grashof', 'crank', 'rocker', 'slider', 'slider-crank', 'engine', 'quick return', 'cam', 'follower', 'gear', 'gears',
    'involute', 'planetary', 'epicyclic', 'kinematics', 'coupler', 'transmission angle', 'contact ratio', 'gear train', 'pressure angle',
  ],
  tools: [
    {
      action: 'get_state',
      description: 'What kMech is showing: the workbench (linkages, cams or gears), its model, analysis summary and warnings.',
      inputSchema: object({}),
      readOnly: true,
    },
    {
      action: 'analyse',
      description: 'Kinematic analysis of a planar mechanism over its input cycle: output position, velocity, acceleration, transmission angle, Grashof class, quick-return ratio. Give four_bar, slider_crank, linkage or example; none = the open linkage.',
      inputSchema: object({
        four_bar: anyObject('Link lengths in mm: {"input":40,"coupler":100,"output":70,"ground":90, "coupler_point":[0.5,0.6] (optional), "start_deg":45 (optional), "rpm":30 (optional)}.'),
        slider_crank: anyObject('{"crank":40,"rod":135,"rpm":600} (in-line, mm).'),
        linkage: anyObject('A full linkage as in a .kmech file: {points:[{id,x,y,ground?,tracer?}], links:[{id,pts:[ids]}], sliders:[{id,point,line:{kind:"ground",x,y,angle}}], driver:{from,to,rpm}}.'),
        example: str('The id of a linkage example, e.g. "crank-rocker" or "whitworth" (see load_example).'),
        step_deg: num('Spacing of the table rows in degrees of input (default 15).'),
        show: bool('Also open the mechanism in kMech (asks first when the open document has unsaved changes).'),
      }),
    },
    {
      action: 'gear',
      description: 'Gear calculations: spur_pair geometry, contact ratio and warnings; train ratios and shaft table; planetary Willis ratios; also helical, belt, chain, rack, worm and bevel. Details in params.',
      inputSchema: object({
        kind: oneOf(['spur_pair', 'train', 'planetary', 'helical', 'belt', 'chain', 'rack', 'worm', 'bevel'], 'What to calculate.'),
        params: anyObject('spur_pair: {z1,z2,module (mm),alpha (14.5|20|25),x1,x2 (profile shifts),backlash,centre}; train: {stages:[[driver,driven],…],rpm,torque,efficiency}; planetary: {sun,ring,planets,fixed:"sun|ring|carrier",input,speed}; helical: {module,z1,z2,helix_deg,alpha,width}; belt: {large_diameter,small_diameter,centre,rpm_small,crossed}; chain: {teeth1,teeth2,pitch,centre,rpm1}; rack: {module,z,rpm}; worm: {starts,wheel_teeth,module,worm_diameter,friction}; bevel: {z1,z2,shaft_angle_deg}.'),
        show: bool('Also show it in the Gears workbench (asks first when the open document has unsaved changes).'),
      }, ['kind']),
    },
    {
      action: 'load_example',
      description: 'Open a ready mechanism (four-bars, engine, quick-return, Jansen, Geneva, cams, gear sets). Without an id, lists them.',
      inputSchema: object({ id: str('The example id, e.g. "crank-rocker", "jansen", "cam-345", "planetary". Leave out to list them.') }),
      destructive: true,
    },
  ],
}
