// AI tools of kElec: draw a circuit and simulate it. ≤ 8 tools, ≤ 6 arguments each.
// The code is in src/apps/kelec/aiTools.ts.

import type { AppToolSet, Schema } from '../appToolsCore.ts'
import { num, object, oneOf, str } from './schema.ts'

const anyObject = (description: string): Schema => ({ type: 'object', description, additionalProperties: true })
const strings = (description: string): Schema => ({ type: 'array', items: { type: 'string' }, description })

export const KELEC_TOOL_SET: AppToolSet = {
  app: 'kelec',
  name: 'kElec',
  summary: 'electronics: draw a circuit, simulate DC, AC and transient behaviour, read the scope, calculators.',
  keywords: [
    'kelec', 'electronics', 'electronic', 'electricity', 'circuit', 'circuits', 'spice', 'schematic', 'resistor', 'capacitor', 'inductor', 'diode', 'transistor', 'op-amp', 'opamp',
    'voltage divider', 'ohm', 'bode', 'filter', 'oscilloscope', 'simulate', 'netlist', 'led resistor', 'rc circuit',
  ],
  tools: [
    {
      action: 'get_circuit',
      description: 'The circuit in kElec: every part with its value and the net on each pin, the nets, problems found (no ground, floating parts) and the simulation settings; or the SPICE text.',
      inputSchema: object({ format: oneOf(['summary', 'spice'], 'summary (default) or the SPICE netlist text.') }),
      readOnly: true,
    },
    {
      action: 'load_example',
      description: 'Open one of ~22 ready circuits (divider, RC filter, rectifiers, Zener, BJT and MOSFET stages, op-amp stages, oscillators, H-bridge…). Without an id, lists them.',
      inputSchema: object({ id: str('The example id, e.g. "rc-lowpass" or "ce-amp". Leave out to list them.') }),
    },
    {
      action: 'set_netlist',
      description: 'Replace the circuit with a SPICE netlist (R C L V I D Q M E G K, .model .param .op .dc .ac .tran; suffixes 4.7k 1meg 10u). It is drawn as a schematic and kept in the Netlist tab.',
      inputSchema: object({ text: str('The netlist, one element per line, e.g. "V1 in 0 5\\nR1 in out 1k\\nR2 out 0 1k\\n.op".'), name: str('Optional circuit name.') }, ['text']),
      destructive: true,
    },
    {
      action: 'add_part',
      description: 'Place a part on the schematic and optionally join its pins to nets by name (a net named 0 or gnd is ground). Pins on the same net name are connected. Returns the new reference.',
      inputSchema: object({
        kind: str('resistor, capacitor, inductor, battery, vsine, vpulse, isource, diode, led, zener, npn, pnp, nmos, pmos, opamp, switch, ground, … (or r, c, l, v, d, q).'),
        value: str('The value: 4.7k, 100n, 5, or a model such as 2N3904 / red.'),
        connect: anyObject('Pin → net name, e.g. {"1":"in","2":"out"} for a resistor, {"B":"base","C":"out","E":"0"} for a transistor, {"+":"vcc","-":"0"} for a source.'),
        rotation: oneOf(['0', '90', '180', '270'], 'Rotation in degrees (default 0).'),
        x: num('Optional x position on the sheet (multiples of 10).'),
        y: num('Optional y position on the sheet (multiples of 10).'),
      }, ['kind']),
    },
    {
      action: 'connect',
      description: 'Connect two pins, e.g. from "R1.2" to "C1.1", by giving them the same net (a short stub with a net label). Optionally name the net; "0" is ground.',
      inputSchema: object({ from: str('A pin: part reference, a dot and the pin name (R1.2, Q1.B, U1.OUT).'), to: str('The other pin.'), net: str('Optional net name.') }, ['from', 'to']),
    },
    {
      action: 'simulate',
      description: 'Run a DC operating point (op), DC sweep (dc), AC sweep (ac) or transient (tran) on the schematic (or the Netlist tab) and return the key results: node voltages, measurements and samples of the waveforms. It also shows them in kElec.',
      inputSchema: object({
        analysis: oneOf(['op', 'dc', 'ac', 'tran'], 'The analysis (default: the one selected in kElec).'),
        params: anyObject('dc: {source,start,stop,step}; ac: {fstart,fstop,points}; tran: {tstop,tstep,tmax,uic}. Values like "1k", "10u".'),
        signals: strings('Traces to report: V(out), I(R1), P(R1), V(a)-V(b). Default: the labelled nodes.'),
        samples: num('How many samples of each waveform to return (default 12).'),
        source: oneOf(['schematic', 'netlist'], 'Which to simulate (default: the schematic, or the netlist text if the sheet is empty).'),
      }),
    },
    {
      action: 'calculate',
      description: 'Electronics calculators: ohm, colorcode, eseries, seriesparallel, divider, led, timeconst, cutoff, filter, opamp, ne555, rccharge, impedance, pf, battery, awg, db, thevenin. Without a name, lists them with their inputs.',
      inputSchema: object({ calculator: str('The calculator id, e.g. "divider" or "led".'), inputs: anyObject('Its inputs by field name, e.g. {"vin":"12","r1":"10k","r2":"4.7k"}; leave one empty to solve for it.') }),
      readOnly: true,
    },
    {
      action: 'export',
      description: 'Write the circuit to a file: kelec (save), svg, png (schematic images), cir (SPICE), bom / bom-md (parts list), knetlist (kPCB JSON), csv (plot data), or kpcb to open it in kPCB. Asks the user first.',
      inputSchema: object({ format: oneOf(['kelec', 'svg', 'png', 'cir', 'bom', 'bom-md', 'knetlist', 'csv', 'kpcb'], 'The file format (default kelec).'), path: str('Where to write it (default: ~/Documents/kElec/<name>.<ext>).') }),
      destructive: true,
    },
  ],
}
