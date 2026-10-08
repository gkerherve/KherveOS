// AI tools of kPCB (printed circuit boards). ≤ 6 arguments each.
// The code is in src/apps/kpcb/aiTools.ts.

import type { AppToolSet } from '../appToolsCore.ts'
import { bool, num, object, oneOf, str } from './schema.ts'

export const KPCB_TOOL_SET: AppToolSet = {
  app: 'kpcb',
  name: 'kPCB',
  summary: 'PCB design: place parts, route (manual or auto), zones, design-rule check, Gerber/SVG/PNG/BOM export.',
  keywords: [
    'kpcb', 'pcb', 'circuit board', 'printed circuit', 'board layout', 'gerber', 'footprint', 'routing', 'autorouter', 'trace', 'track', 'copper zone', 'ground plane',
    'drc', 'design rule', 'netlist', 'bom', 'pick and place', 'layout', 'via', 'silkscreen', 'drill',
  ],
  tools: [
    {
      action: 'get_board',
      description: 'Read the open board: size, parts (reference, value, footprint, position, rotation, side), nets with their pins and open connections, track/via/zone counts and the design-rule result.',
      inputSchema: object({}),
      readOnly: true,
    },
    {
      action: 'load_example',
      description: 'Open a ready-made, routed board: "555-blinker", "uno-shield" (Arduino Uno shield) or "esp32-breakout". Without id the list is returned. Replaces the open board.',
      inputSchema: object({ id: str('Example id; leave out to list them.') }),
    },
    {
      action: 'import_netlist',
      description: 'Import a netlist: kElec\'s knetlist object ({format:"knetlist", components:[{ref, kind, value, footprint?, pins}], nets:[{name, pins:[{ref, pin}]}]}), or text lines "R1 10k R_0805 | VCC:1 GND:2" (or KiCad). New parts are laid out in the board.',
      inputSchema: object(
        {
          netlist: { description: 'A knetlist object, or the text of a netlist.' },
          mode: oneOf(['replace', 'update'], 'replace starts the parts again, update keeps placement and routing. Default: update when parts exist.'),
        },
        ['netlist'],
      ),
    },
    {
      action: 'place',
      description: 'Place a footprint, or move/change a part (give its ref). mm, y down, rotation counter-clockwise in degrees. Footprints: R_0805, C_0805, CP_Radial_THT, LED_5mm, SOT-23, TO-92, DIP-8, SOIC-8, QFP-32, PinHeader_1x04… (values come from the netlist)',
      inputSchema: object({
        ref: str('Reference such as "R1". For a new part leave it out to get the next free one.'),
        footprint: str('Footprint name, e.g. "R_0805". Needed for a new part.'),
        x: num('Position in mm.'),
        y: num('Position in mm.'),
        rotation: num('Degrees, counter-clockwise.'),
        side: oneOf(['top', 'bottom'], 'Which side of the board.'),
      }),
    },
    {
      action: 'route',
      description: 'Route copper. "auto": auto-route one net (or "all") and report the completion. "manual-points": draw a track of a net through points (via:true adds a via and changes layer). "zone": add a filled copper zone of a net (polygon, or the whole board).',
      inputSchema: object(
        {
          net: str('Net name, or "all" with mode auto.'),
          mode: oneOf(['auto', 'manual-points', 'zone'], 'What to do. Default auto.'),
          points: {
            type: 'array',
            description: 'For manual-points the path (pad centres and corners); for zone the polygon corners (optional).',
            items: object({ x: num('mm'), y: num('mm'), via: bool('Add a via here and continue on the other layer.') }, ['x', 'y']),
          },
          layer: oneOf(['F.Cu', 'B.Cu'], 'Copper layer to start on (zone: its layer, default B.Cu).'),
          width: num('Track width in mm (default: the net class width).'),
        },
        ['net'],
      ),
    },
    {
      action: 'run_drc',
      description: 'Run the design-rule check (clearance, track width, annular ring, drill, board edge, courtyard, silkscreen, unconnected nets, shorts, dangling tracks) and list the violations with positions.',
      inputSchema: object({}),
      readOnly: true,
    },
    {
      action: 'set_outline',
      description: 'Set the board outline: a preset ("uno" shield 68.6x53.3 with holes, "nano", "50x50", "rpi-hat") or a rectangle (width, height, corner radius). No arguments: returns the outline and the presets.',
      inputSchema: object({
        preset: oneOf(['uno', 'nano', '50x50', 'rpi-hat'], 'A ready-made outline.'),
        width: num('Rectangle width in mm.'),
        height: num('Rectangle height in mm.'),
        corner_radius: num('Corner radius in mm.'),
        x: num('Left edge in mm (default 0).'),
        y: num('Top edge in mm (default 0).'),
      }),
    },
    {
      action: 'export',
      description: 'Write a file: gerber (zip of all layers + drills), svg or png (top or bottom image), bom (CSV, or .md), pnp (pick and place CSV). The user is asked first.',
      inputSchema: object(
        {
          what: oneOf(['gerber', 'svg', 'png', 'bom', 'pnp'], 'The kind of file.'),
          path: str('File path, or a folder (a default name is added), e.g. "~/Documents/kPCB".'),
          side: oneOf(['top', 'bottom'], 'For svg / png.'),
          scheme: oneOf(['board', 'bw'], 'For svg / png: realistic green board, or black and white for printing.'),
        },
        ['what', 'path'],
      ),
    },
  ],
}
