// AI tools of kDilatometer (the dilatometry technique of KherveFitting-AI as an app).
// The `run` actions are src/apps/khervedilatometer/actions.ts.

import { techniqueToolSet } from './technique.ts'

export const KHERVEDILATOMETER_TOOL_SET = techniqueToolSet({
  app: 'khervedilatometer',
  name: 'kDilatometer',
  summary: 'Dilatometry: heating / dwell / cooling segments, thermal-expansion coefficient (CTE), sintering shrinkage.',
  keywords: ['khervedilatometer', 'kdilatometer', 'dilatometer', 'dilatometry', 'dil', 'thermal expansion', 'cte', 'alpha', 'sintering', 'shrinkage', 'dl/l0', 'pushrod', 'netzsch', 'linseis', 'glass transition', 'phase transformation'],
  files: 'dilatometer export (.csv/.txt/.dat: T and dL/L0, dL in µm, or %)',
  actions: {
    segments: 'Lists the programme segments of the sheet (S1, S2…: heating / cooling / isothermal, T start, T end, points) and the sheet summary. Read-only.',
    segment_sheet: 'options.segment = the number of the segment (1 = S1). Writes it out as its own DIL~Heat / DIL~Cool / DIL~Iso sheet — do this before the CTE: a whole heat / cool run is a loop.',
    all_segment_sheets: 'Writes every segment out as its own sheet.',
    mean_cte: 'low / high = T1 / T2 (°C), both inside the sheet (run it on a single ramp). Mean (technical) CTE α = (dL/L0(T2) − dL/L0(T1)) / (T2 − T1), in 10⁻⁶ K⁻¹.',
    alpha: 'options.window = Savitzky-Golay window in points (default 51). Makes the DIL~Alpha sheet: α(T) = d(dL/L0)/dT in 10⁻⁶ K⁻¹.',
    sintering: 'options.onset = % of dL/L0 below the maximum that defines the shrinkage onset (default 0.1), options.window as above. Maximum expansion, shrinkage onset, temperature of the maximum shrinkage rate, total shrinkage (run it on the heating segment).',
    label_plot: 'Puts the sintering results (max, onset, max rate) on the plot as labels. Needs sintering first.',
    clear_labels: 'Removes those labels.',
  },
})
