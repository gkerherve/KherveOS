// KherveBET's AI `run` actions: the BET / Physisorption Analysis window's
// controls and handlers (libraries/ToolsMenu/BET_Analysis.py, attribute names
// as there). Described for models in src/os/ai/manifests/khervebet.ts.

import { defined, optStr, type ActionTable } from '../khervetech/actions.ts'

export const BET_ACTIONS: ActionTable = {
  bet: {
    call: 'on_fit_bet',
    set: ({ low, high }) => defined({ relp_lo_ctrl: low, relp_hi_ctrl: high }),
    read: ['bet_result'],
  },
  tplot: {
    call: 'on_fit_tplot',
    set: ({ low, high }) => defined({ t_lo_ctrl: low, t_hi_ctrl: high }),
    read: ['tplot_result'],
  },
  bjh: {
    call: 'on_run_bjh',
    set: ({ options: o }) => {
      const b = optStr(o, 'branch')
      return defined({ branch_choice: b === undefined ? undefined : b.toLowerCase().startsWith('ads') ? 1 : 0 })
    },
    read: ['bjh_grid'],
  },
  report: { call: '_update_report', read: ['report_ctrl'] },
  bet_plot_sheet: { call: 'on_bet_plot_sheet', read: [] },
  tplot_sheet: { call: 'on_tplot_sheet', read: [] },
  pore_sheet: { call: 'on_pore_sheet', read: [] },
}
