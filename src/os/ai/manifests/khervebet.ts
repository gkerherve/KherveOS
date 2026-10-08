// AI tools of KherveBET (the BET / physisorption technique of KherveFitting-AI
// as an app). The `run` actions are src/apps/khervebet/actions.ts.

import { techniqueToolSet } from './technique.ts'

export const KHERVEBET_TOOL_SET = techniqueToolSet({
  app: 'khervebet',
  name: 'kBET',
  summary: 'N2 physisorption: BET surface area, t-plot, BJH pore sizes, report.',
  keywords: ['khervebet', 'bet', 'physisorption', 'isotherm', 'surface area', 'nitrogen adsorption', 'bjh', 't-plot', 'pore size', 'micropore', 'mesopore', 'micromeritics'],
  files: 'isotherm (.csv/.txt/.dat)',
  actions: {
    bet: 'low / high = the P/P0 window (default 0.05–0.30). Fit BET: S(BET), Qm, C, R², Rouquerol limit, total pore volume.',
    tplot: 'low / high = the Harkins-Jura thickness window in Å (default 3.5–5.0). External area, micropore volume and area.',
    bjh: 'options.branch ("desorption" — the standard — or "adsorption"). Pore-size distribution.',
    report: 'The plain-text physisorption report.',
    bet_plot_sheet: 'Creates the BET~Plot sheet (the transform with the fitted line). Needs bet first.',
    tplot_sheet: 'Creates the BET~tPlot sheet. Needs tplot first.',
    pore_sheet: 'Creates the BET~Pore sheet (dV/dlog D). Needs bjh first.',
  },
})
