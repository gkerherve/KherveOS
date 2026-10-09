// AI tools of kDigital: Boolean functions, circuits and their timing. ≤ 4 tools, ≤ 6 arguments each.
// The code is in src/apps/kdigital/aiTools.ts.

import type { AppToolSet, Schema } from '../appToolsCore.ts'
import { bool, num, object, oneOf, str } from './schema.ts'

const strings = (description: string): Schema => ({ type: 'array', items: { type: 'string' }, description })

export const KDIGITAL_TOOL_SET: AppToolSet = {
  app: 'kdigital',
  name: 'kDigital',
  summary: 'digital logic: gates, truth tables, Karnaugh maps, Quine–McCluskey, state machines, timing diagrams.',
  keywords: [
    'kdigital', 'digital', 'logic', 'gate', 'gates', 'karnaugh', 'k-map', 'kmap', 'truth table', 'state machine', 'fsm', 'timing', 'boolean', 'minimise', 'minimize', 'quine', 'mccluskey',
    'flip-flop', 'flip flop', 'latch', 'counter', 'multiplexer', 'adder', 'sum of products', 'nand', 'nor', 'hazard', 'waveform', 'verilog', 'vhdl', 'ieee 754', 'two\'s complement',
  ],
  tools: [
    {
      action: 'get_state',
      description: 'What kDigital shows: the circuit (inputs, outputs, parts, problems), the Boolean functions, the state machine. what = summary (default), circuit, boolean or fsm.',
      inputSchema: object({ what: oneOf(['summary', 'circuit', 'boolean', 'fsm'], 'How much detail (default summary).') }),
      readOnly: true,
    },
    {
      action: 'set_expression',
      description: 'Type Boolean functions into the Boolean tab and get the truth table, canonical and minimal SOP / POS (Quine–McCluskey with don\'t-cares), prime implicants and the Karnaugh-map groups. One per line: "F = A&B | !C", "F(A,B,C,D) = Σm(1,3,7) + d(0,2)". Can also draw the gates.',
      inputSchema: object({
        expression: str('The function(s), one per line: names A B C…, operators ! ~ \' & * | + ^ AND OR NOT XOR NAND NOR, constants 0 1, or Σm(…) + d(…) / ΠM(…).'),
        style: oneOf(['as-is', 'sop', 'pos', 'nand', 'nor'], 'Gate style when drawing the circuit: as written, minimal SOP / POS, NAND-only or NOR-only (default as-is).'),
        build_circuit: bool('true: replace the circuit with these gates (asks the user first).'),
      }, ['expression']),
    },
    {
      action: 'simulate',
      description: 'Simulate a circuit (the open one, an example id, or one built from an expression) with timed input changes and return the waveforms: changes, samples, glitches, oscillation warnings. Also shown in the Timing tab. Inputs are named as the switches are (A, B, CLK…).',
      inputSchema: object({
        example: str('An example id, e.g. "full-adder" or "hazard" (see load_example). Default: the open circuit.'),
        expression: str('Instead of a circuit: simulate gates built from these expressions (all input combinations unless a stimulus is given).'),
        stimulus: str('Timed input changes, one per line: "0 A=0 B=0", "20 A=1", "40 B=1". Time in time units; clocks run by themselves.'),
        until: num('Simulate up to this time (default: a little after the last change).'),
        signals: strings('Names of the signals to report (inputs, outputs, labelled nets). Default: all inputs, clocks and outputs.'),
        delay: oneOf(['unit', 'gate', 'zero'], 'Delay model: one unit per gate (default), each part\'s own delay, or zero delay.'),
      }),
    },
    {
      action: 'load_example',
      description: 'Open one of the ready examples (adders, multiplexers, latches, flip-flops, counters, K-map minimisation, FSMs, hazards…). Without an id, lists them.',
      inputSchema: object({ id: str('The example id, e.g. "detector-1011" or part of its title. Leave out to list them.') }),
    },
  ],
}
