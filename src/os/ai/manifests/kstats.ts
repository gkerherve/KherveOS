// AI tools of kStats (statistics, curve fitting and tests). ≤ 6 arguments each.
// The code is in src/apps/kstats/aiTools.ts.

import type { AppToolSet } from '../appToolsCore.ts'
import { int, num, object, str } from './schema.ts'

export const KSTATS_TOOL_SET: AppToolSet = {
  app: 'kstats',
  name: 'kStats',
  summary: 'statistics for lab data: describe, curve fits with errors, model comparison, t-tests, ANOVA, correlation.',
  keywords: [
    'kstats', 'statistics', 'statistic', 'mean', 'standard deviation', 'regression', 'linear fit', 'curve fit', 'fit', 'r2', 'r²', 'sem',
    't-test', 'ttest', 'anova', 'p-value', 'hypothesis', 'significant', 'correlation', 'outlier', 'confidence interval', 'gaussian', 'exponential',
  ],
  tools: [
    {
      action: 'set_data',
      description: 'Put a table in kStats: rows on lines, columns separated by commas, tabs or semicolons; a header row first (with names). Replaces the data.',
      inputSchema: object({ text: str('The table as text, e.g. "time,signal\\n0,0.1\\n1,2.3".') }, ['text']),
    },
    {
      action: 'describe',
      description: 'Statistics of the columns in kStats: n, mean, sd, sem, median, range, quartiles, skewness, kurtosis, 95 % CI of the mean, outliers (1.5×IQR, Grubbs). One column or all.',
      inputSchema: object({ column: str('A column name, or its number from 1. Leave out for every column.') }),
    },
    {
      action: 'fit',
      description: 'Fit y against x in kStats: parameters with standard errors and 95 % CIs, R², adjusted R², RMSE, AIC. Polynomial of `degree` by default, or a `model`: linear, poly2–6, exp, power, log, mm, gauss, lorentz, logistic.',
      inputSchema: object(
        {
          x: str('The x column (name or number from 1).'),
          y: str('The y column (name or number from 1).'),
          degree: int('Polynomial degree 1–6 (default 1: a straight line). Ignored when model is given.'),
          model: str('Model: linear, poly2…poly6, exp, power, log, mm, gauss, lorentz or logistic.'),
          sigma: str('Optional column of uncertainties (standard deviations of y) for a weighted fit.'),
          predict_at: num('Optional x at which to also predict y (with its intervals).'),
        },
        ['x', 'y'],
      ),
    },
    {
      action: 'compare_models',
      description: 'Fit many models (polynomials, exp, power, log, saturating, Gaussian, Lorentzian, logistic) to y against x and rank them by AIC, with R², adjusted R² and RMSE.',
      inputSchema: object(
        {
          x: str('The x column (name or number from 1).'),
          y: str('The y column (name or number from 1).'),
          sigma: str('Optional column of uncertainties for weighting.'),
          models: str('Optional comma-separated model ids to compare (default: all).'),
        },
        ['x', 'y'],
      ),
    },
    {
      action: 'test',
      description: 'Hypothesis test on kStats columns, with a plain-language verdict and p-value: ttest1, welch, paired, anova (columns = groups), mannwhitney, pearson, spearman, normality.',
      inputSchema: object(
        {
          test: str('ttest1, welch, paired, anova, mannwhitney, pearson, spearman or normality.'),
          columns: str('Column names or numbers, comma-separated (use | if a name has a comma): one for ttest1/normality, two for welch/paired/mannwhitney/pearson/spearman, two or more for anova (default: every numeric column).'),
          value: num('ttest1 only: the value to compare the mean with (default 0).'),
          alpha: num('Significance level (default 0.05).'),
        },
        ['test'],
      ),
    },
    {
      action: 'correlate',
      description: 'Correlation matrix (Pearson or Spearman) of numeric columns in kStats, with p-values and the significant pairs.',
      inputSchema: object({
        method: str('pearson (default) or spearman.'),
        columns: str('Optional comma-separated columns (default: every numeric column).'),
      }),
    },
    {
      action: 'export_report',
      description: 'Save a Markdown report of what kStats has computed (statistics, fit, comparison, test, correlation) to a file. Asks the user first.',
      inputSchema: object({ path: str('Where to save it, e.g. "~/Documents/report.md" (default ~/Documents/kStats/kstats-report.md).') }),
    },
  ],
}
