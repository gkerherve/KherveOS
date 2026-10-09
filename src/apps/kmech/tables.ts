// Data tables behind the plots (pure): for "Open in kPlot" and the CSV exports.

import type { Cycle } from './analysis.ts'
import type { CamProfile, ProgramTable } from './cam.ts'
import type { DynResult } from './dynamics.ts'
import type { EngineResult } from './engine.ts'

export interface Table {
  header: string[]
  rows: number[][]
}

export function motionTable(c: Cycle): Table {
  const u = c.outputUnit === 'deg' ? ['deg', 'deg/s', 'deg/s2'] : ['mm', 'mm/s', 'mm/s2']
  return {
    header: ['input_deg', `output_${u[0]}`, `velocity_${u[1]}`, `acceleration_${u[2]}`, 'transmission_deg', 'mechanical_advantage'],
    rows: c.theta.map((t, i) => [t, c.pos[i], c.vel[i], c.acc[i], c.mu[i] ?? NaN, c.ma[i]]),
  }
}

export function tracerTable(c: Cycle): Table {
  const ids = Object.keys(c.tracers)
  return {
    header: ['input_deg', ...ids.flatMap((id) => [`${id}_x`, `${id}_y`])],
    rows: c.theta.map((t, i) => [t, ...ids.flatMap((id) => [c.tracers[id][i]?.x ?? NaN, c.tracers[id][i]?.y ?? NaN])]),
  }
}

export function engineTable(r: EngineResult): Table {
  return {
    header: ['crank_deg', 'volume_cm3', 'pressure_kPa', 'gas_torque_Nm', 'inertia_torque_Nm', 'total_torque_Nm', 'energy_J'],
    rows: r.phi.map((f, i) => [f, r.vol[i], r.p[i], r.gasTorque[i], r.inertiaTorque[i], r.torque[i], r.energy[i]]),
  }
}

export function dynamicsTable(d: DynResult): Table {
  return {
    header: ['t_s', 'driver_deg', 'driver_rpm', 'motor_torque_Nm', 'output', 'output_velocity', 'energy_J', ...d.joints.map((j) => `force_${j.name}_N`)],
    rows: d.t.map((t, i) => [t, d.theta[i], d.rpm[i], d.motorTorque[i], d.outPos[i], d.outVel[i], d.energy[i], ...d.joints.map((j) => j.force[i] ?? NaN)]),
  }
}

export function programCsvTable(t: ProgramTable, unit = 'mm'): Table {
  return {
    header: ['cam_deg', `lift_${unit}`, `velocity_${unit}_per_rad`, `acceleration_${unit}_per_rad2`, `jerk_${unit}_per_rad3`],
    rows: t.theta.map((th, i) => [th, t.s[i], t.v[i], t.a[i], t.j[i]]),
  }
}

export function profileTable(p: CamProfile): Table {
  return {
    header: ['cam_deg', 'lift', 'profile_x_mm', 'profile_y_mm', 'pitch_x_mm', 'pitch_y_mm', 'pressure_angle_deg', 'radius_of_curvature_mm'],
    rows: p.theta.map((th, i) => [th, p.s[i], p.profile[i].x, p.profile[i].y, p.pitch[i].x, p.pitch[i].y, p.phi[i], Number.isFinite(p.rho[i]) ? p.rho[i] : NaN]),
  }
}
