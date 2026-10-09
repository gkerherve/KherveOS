// AI tools of kMotion: a classical-mechanics sandbox. ≤ 4 tools, ≤ 6 arguments each.
// The code is in src/apps/kmotion/aiTools.ts.

import type { AppToolSet, Schema } from '../appToolsCore.ts'
import { bool, num, object, oneOf, str } from './schema.ts'

const anyObject = (description: string): Schema => ({ type: 'object', description, additionalProperties: true })

export const KMOTION_TOOL_SET: AppToolSet = {
  app: 'kmotion',
  name: 'kMotion',
  summary: 'mechanics sandbox: projectiles, pendulums, collisions, orbits; run models and read results.',
  keywords: [
    'kmotion', 'mechanics', 'physics', 'projectile', 'trajectory', 'pendulum', 'double pendulum', 'chaos', 'oscillator', 'resonance', 'spring', 'orbit', 'kepler', 'hohmann',
    'collision', 'newton', "newton's cradle", 'n-body', 'three-body', 'gravity', 'slingshot', 'incline', 'friction', 'atwood', 'coriolis', 'gyroscope', 'planck', 'motion',
  ],
  tools: [
    {
      action: 'get_state',
      description: 'What kMotion shows: the scene, its mode and parameters (with ranges), the integrator, the simulated time, the current values and the readouts.',
      inputSchema: object({}),
      readOnly: true,
    },
    {
      action: 'load_example',
      description: 'Open one of the ready experiments (projectiles, pendulums, collisions, orbits, rigid bodies…). Without an id, lists them with their ids.',
      inputSchema: object({ id: str('The example id, e.g. "projectile-vacuum" or "orbit-hohmann". Leave out to list them.') }),
    },
    {
      action: 'run',
      description: 'Run a model headless and measure it: scene (projectile, pendulum, oscillator, collision, orbit, sandbox, circular), mode, parameters and a duration. Returns the final values, extremes, samples, readouts and energy drift.',
      inputSchema: object({
        scene: oneOf(['projectile', 'pendulum', 'oscillator', 'collision', 'orbit', 'sandbox', 'circular'], 'The scene (default: the open one).'),
        mode: str('The mode of the scene, e.g. "flight", "double", "hohmann" (default: the first). get_state lists them.'),
        params: anyObject('Parameter values by key, e.g. {"v0": 30, "angle": 40, "drag": "quadratic"}; the rest keep their defaults (or the open scene\'s values when scene is omitted).'),
        duration: num('Simulated time (the scene\'s time unit: seconds, years…). Default: until the motion ends or 10 time units.'),
        method: oneOf(['euler', 'semi', 'verlet', 'rk4', 'rk45'], 'Integrator (default: rk4; the scene decides).'),
        show: bool('Also load the result into the window so the user sees it (asks first if there are unsaved changes).'),
      }),
    },
    {
      action: 'set_param',
      description: 'Change one parameter of the open scene (a slider value, a choice, "mode" or "method"). Live ones change while running; the others restart the run.',
      inputSchema: object({ key: str('The parameter key from get_state, e.g. "v0", "angle", "drag", "mode", "method".'), value: { type: ['number', 'string', 'boolean'], description: 'The new value.' } as Schema }, ['key', 'value']),
    },
  ],
}
