// AI tools of kClimate. ≤ 6 arguments each, at most 4 tools.
// The code is in src/apps/kclimate/aiTools.ts.

import type { AppToolSet } from '../appToolsCore.ts'
import { bool, int, object, oneOf, str } from './schema.ts'

export const KCLIMATE_TOOL_SET: AppToolSet = {
  app: 'kclimate',
  name: 'kClimate',
  summary: 'climate data: CO2, temperature, sea ice, ENSO; trends with confidence intervals, anomalies; energy-balance model.',
  keywords: [
    'kclimate', 'climate', 'co2', 'carbon dioxide', 'temperature', 'global warming', 'anomaly', 'baseline', 'trend', 'per decade', 'enso', 'el nino', 'sea ice',
    'sea level', 'keeling', 'mauna loa', 'hadcrut', 'gistemp', 'warming stripes', 'energy balance', 'climate sensitivity', 'albedo', 'greenhouse',
  ],
  tools: [
    {
      action: 'get_state',
      description: 'Read what kClimate shows: loaded datasets and series (ids, units, years), the open tab with its key numbers, and today’s warming and CO2.',
      inputSchema: object({}),
      readOnly: true,
    },
    {
      action: 'query_series',
      description: 'A statistic of a climate series over years: mean, min, max, first, last, count, trend (per decade with 95 % CI) or anomaly against a baseline. Datasets load as needed.',
      inputSchema: object(
        {
          series: str('Series id like "gistemp.global", "hadcrut5.anomaly", "co2_mlo.co2", "oni.oni", "arctic_ice.extent@9" (@9 = September values), or words like "mauna loa co2".'),
          stat: oneOf(['mean', 'min', 'max', 'first', 'last', 'count', 'trend', 'anomaly'], 'The statistic (default mean).'),
          from: int('First year (default: start of the record).'),
          to: int('Last year, inclusive (default: end of the record).'),
          baseline: str('For "anomaly": the baseline period as "1961-1990" (default), "1850-1900", "1951-1980"…'),
        },
        ['series'],
      ),
      readOnly: true,
    },
    {
      action: 'fit_trend',
      description: 'Fit a trend to a series over a period and show it in kClimate: slope per decade with a 95 % CI corrected for AR(1) autocorrelation, p, R², the naive CI for comparison.',
      inputSchema: object(
        {
          series: str('Series id or words, e.g. "gistemp.global" or "co2".'),
          from: int('First year (default: start).'),
          to: int('Last year (default: end).'),
          model: oneOf(['linear', 'quadratic', 'exponential'], 'Trend model (default linear).'),
          annual: bool('Fit annual means instead of every month (default true).'),
          ar1: bool('Correct the interval for AR(1) autocorrelation (default true).'),
        },
        ['series'],
      ),
    },
    {
      action: 'load_example',
      description: 'Open a built-in kClimate example (Keeling curve, warming stripes, ENSO lag, sea ice, energy-balance model…). With no id it lists them. Asks first if there are unsaved changes.',
      inputSchema: object({ id: str('The example number from the list, or part of its title. Leave out to list the examples.') }),
    },
  ],
}
