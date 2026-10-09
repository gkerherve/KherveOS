// The built-in examples of kClimate, as projects. They use the real datasets under public/data/kclimate/ (or, for the
// energy-balance model, no data at all) except the last, which is synthetic and says so. exampleFiles.ts turns them
// into .kclim files; the tests open every one and check the numbers it shows.

import { DEFAULT_EBM, DEFAULT_SCENARIO, type EbmParams, type Scenario } from './ebm.ts'
import { cloneProject, DEFAULT_PROJECT, type Project } from './project.ts'
import { sampleDataset } from './synthetic.ts'

export interface Example {
  title: string
  group: string
  description: string
  project: Project
}

function make(title: string, patch: (p: Project) => void, notes: string, datasets: string[]): Project {
  const p = cloneProject(DEFAULT_PROJECT)
  p.title = title
  p.notes = notes
  p.datasets = datasets
  patch(p)
  return p
}

const ebm = (over: Partial<EbmParams>): EbmParams => ({ ...DEFAULT_EBM, ...over })
const scenario = (over: Partial<Scenario>): Scenario => ({ ...DEFAULT_SCENARIO, points: DEFAULT_SCENARIO.points.map((q) => [...q] as [number, number]), ...over })

export function buildExamples(): Example[] {
  const list: Example[] = []
  const add = (group: string, title: string, description: string, project: Project) => list.push({ group, title, description, project })

  add('Carbon dioxide', 'The Keeling curve with seasonal decomposition',
    'Atmospheric CO₂ at Mauna Loa since 1958 split into a long-term trend (quadratic), the seasonal cycle (four harmonics) and the residual. The cycle peaks in May and bottoms out in October as the northern forests grow and rot.',
    make('The Keeling curve', (p) => {
      p.tab = 'seasonal'
      p.seasonal = { series: 'co2_mlo.co2', from: null, to: null, harmonics: 4, degree: 2, windowYears: 5 }
    }, 'NOAA GML monthly CO₂ at Mauna Loa (Scripps/Keeling 1958–1974). The fit is CO₂(t) = quadratic trend + 4 harmonics of the year. Change the number of harmonics or the polynomial degree and watch the residual.', ['co2_mlo']))

  add('Carbon dioxide', 'CO₂ seasonal amplitude is growing',
    'The size of the Mauna Loa seasonal cycle, year by year (a harmonic fit in a sliding 5-year window), with its trend and 95 % confidence band. More CO₂ and a longer growing season make the northern-hemisphere breathing deeper.',
    make('CO₂ seasonal amplitude', (p) => {
      p.tab = 'seasonal'
      p.seasonal = { series: 'co2_mlo.co2', from: 1959, to: null, harmonics: 3, degree: 2, windowYears: 5 }
    }, 'The amplitude panel is below the decomposition. Widen the window for a smoother curve, or restrict the years to see if the growth is steady.', ['co2_mlo']))

  add('Temperature', 'Warming stripes 1850–now (HadCRUT5)',
    'One stripe per year, blue for cooler and red for warmer than the 1961–1990 average, in the style of Ed Hawkins. Nothing else: no axes, no numbers, just the pattern of the last 175 years.',
    make('Warming stripes, HadCRUT5', (p) => {
      p.tab = 'stripes'
      p.stripes = { ...p.stripes, series: 'hadcrut5.anomaly', baseline: '1961-1990', kind: 'stripes', from: null, to: null }
    }, 'Annual means of the HadCRUT5 global anomaly (years with at least 10 months of data). The colour scale is symmetric around the baseline mean. Try the decadal bars and the histogram in the same tab.', ['hadcrut5']))

  add('Temperature', 'Warming stripes 1880–now (GISTEMP)',
    'The same picture from NASA’s GISTEMP record, which starts in 1880. Compare with the HadCRUT5 stripes: two independent analyses of the same thermometers and ships tell the same story.',
    make('Warming stripes, GISTEMP', (p) => {
      p.tab = 'stripes'
      p.stripes = { ...p.stripes, series: 'gistemp.global', baseline: '1951-1980', kind: 'stripes', from: null, to: null }
    }, 'GISTEMP v4 land-ocean index, annual means, against 1951–1980.', ['gistemp']))

  add('Temperature', 'Global warming trend per decade, with confidence band',
    'A straight line through the annual GISTEMP anomalies since 1970 gives about 0.2 °C per decade. The interval allows for the autocorrelation of the residuals (AR(1)), which is wider than the textbook one.',
    make('Warming trend per decade', (p) => {
      p.tab = 'trend'
      p.trend = { ...p.trend, series: 'gistemp.global', from: 1970, to: null, baseline: 'native', model: 'linear', annual: true, ar1: true, breakpoint: false, periods: [[1970, 1990], [1991, 2010], [2011, 2025]] }
    }, 'Switch AR(1) off to see the narrower, naive interval. Use the monthly data (untick “annual means”) to see how autocorrelation changes the effective number of independent points.', ['gistemp']))

  add('Temperature', 'Is warming accelerating: a breakpoint and three periods',
    'A two-segment trend fitted to GISTEMP since 1880 finds a break in the 1970s, after which warming is several times faster. The period comparison shows the trend per decade of three eras with their confidence intervals.',
    make('Breakpoint and periods', (p) => {
      p.tab = 'trend'
      p.trend = { ...p.trend, series: 'gistemp.global', from: 1880, to: null, baseline: 'native', model: 'linear', annual: true, ar1: true, breakpoint: true, periods: [[1880, 1940], [1941, 1975], [1976, 2025]] }
    }, 'The break position is searched over the data, so its p-value is approximate (it flatters the two-segment model). Try the quadratic model for a smooth alternative.', ['gistemp']))

  add('Temperature', 'Baselines: 1951–1980 vs 1961–1990 vs pre-industrial',
    'The same HadCRUT5 record expressed against three baselines. The curves have identical shape and differ only by a constant: the choice of baseline moves the zero line, not the warming.',
    make('Baseline comparison', (p) => {
      p.tab = 'series'
      p.series = {
        lines: [{ ref: 'hadcrut5.anomaly', axis: 'left', baseline: '1951-1980' }, { ref: 'hadcrut5.anomaly', axis: 'left', baseline: '1961-1990' }, { ref: 'hadcrut5.anomaly', axis: 'left', baseline: '1850-1900' }],
        from: null, to: null, baseline: '1961-1990', smooth: { kind: 'running', years: 1 }, trendLine: 'none',
      }
    }, 'The 1850–1900 baseline is the usual reference for “warming above pre-industrial”. A 12-month running mean is applied.', ['hadcrut5']))

  add('Temperature', 'ENSO and global temperature: lagged correlation',
    'Cross-correlation of the Oceanic Niño Index with GISTEMP monthly anomalies, both detrended: global temperature follows El Niño by about three months.',
    make('ENSO vs temperature, lagged', (p) => {
      p.tab = 'relate'
      p.relate = { ...p.relate, mode: 'lag', x: 'oni.oni', y: 'gistemp.global', step: 'monthly', maxLag: 24, detrend: true, from: 1960, to: null }
    }, 'A positive lag means temperature follows the ENSO index. The dotted lines mark the 95 % significance level given the autocorrelation of both series. Untick “detrend” to see how the shared warming trend contaminates the correlation.', ['oni', 'gistemp']))

  add('Temperature', 'Observed warming vs CO₂, ENSO and volcanoes (regression)',
    'Monthly GISTEMP regressed on log₂(CO₂), the ENSO index (3 months earlier) and volcanic aerosol (4 months earlier), 1960–2012. The CO₂ coefficient is the warming per doubling; the green curve has the natural wiggles taken out.',
    make('Warming vs CO2, regression', (p) => {
      p.tab = 'relate'
      p.relate = {
        ...p.relate, mode: 'regression', target: 'gistemp.global', step: 'monthly', from: 1960, to: 2012, trend: false,
        predictors: [{ ref: 'co2_mlo.co2', transform: 'log2', lag: 0 }, { ref: 'oni.oni', transform: 'none', lag: 3 }, { ref: 'giss_aod.global', transform: 'none', lag: 4 }],
      }
    }, 'Aerosol data end in 2012, which sets the end of the period. Solar activity is not included (no open dataset is shipped). The standard errors allow for AR(1) residuals. This is a statistical fit, not a physical model: the next examples add physics.', ['gistemp', 'co2_mlo', 'oni', 'giss_aod']))

  add('Ice and sea level', 'September Arctic sea-ice decline and trend',
    'The Arctic sea-ice extent at its yearly minimum (September), 1979 to now, with a linear trend of about −0.7 million km² per decade and its confidence interval.',
    make('September Arctic sea ice', (p) => {
      p.tab = 'trend'
      p.trend = { ...p.trend, series: 'arctic_ice.extent@9', from: 1979, to: null, baseline: 'native', model: 'linear', annual: true, ar1: true, breakpoint: false, periods: [[1979, 1999], [2000, 2012], [2013, 2026]] }
    }, 'NSIDC Sea Ice Index v4, monthly extent; the series “@9” takes the September values. Try the exponential or quadratic model, and compare the periods.', ['arctic_ice']))

  add('Ice and sea level', 'Sea level: tide gauges and satellites',
    'Global mean sea level from the CSIRO tide-gauge reconstruction (1880–2013) and NOAA satellite altimetry (1993–now), both zeroed on 1993–2013 so that they can be compared. Rising ever faster.',
    make('Sea level rise', (p) => {
      p.tab = 'series'
      p.series = {
        lines: [{ ref: 'sealevel_csiro.gmsl_mm', axis: 'left' }, { ref: 'sealevel_noaa.gmsl_mm', axis: 'left' }],
        from: null, to: null, baseline: '1993-2013', smooth: { kind: 'none' }, trendLine: 'none',
      }
    }, 'The two records overlap in 1993–2013. Add a trend line, or look at the Trends tab with 1993 onward.', ['sealevel_csiro', 'sealevel_noaa']))

  add('Energy-balance model', 'Doubling CO₂: 1.1 K with no feedbacks, 3 K with them',
    'CO₂ is doubled at once in a zero-dimensional energy-balance model. The planet warms until outgoing radiation balances the extra 3.7 W/m²: by 1.1 K without feedbacks, by 3 K with the net feedback of a climate sensitivity of 3 K per doubling.',
    make('Doubling CO2', (p) => {
      p.datasets = []
      p.tab = 'model'
      p.model = {
        tool: 'response', observed: '',
        params: ebm({ deepOcean: false, mixedDepth: 400, ecs: 3 }),
        scenario: scenario({ mode: 'concentration', preset: 'custom', startYear: 1850, points: [[1851, 560]] }),
      }
    }, 'Concentration jumps from 280 to 560 ppm in 1850–1851. The dotted line is the equilibrium warming for that CO₂. Move the sensitivity slider: 1.1 K is what you get with no feedback at all; the textbook range is 2.5–4 K.', []))

  add('Energy-balance model', 'Net zero by 2050 (toy scenario)',
    'Emissions fall in a straight line from today’s level to zero in 2050. The model starts from the real emission history and Mauna Loa CO₂, and warming above 1850–1900 is compared with observed HadCRUT5. A teaching model, not a projection.',
    make('Net zero 2050', (p) => {
      p.datasets = ['co2_mlo', 'owid_co2', 'hadcrut5']
      p.tab = 'model'
      p.model = { tool: 'response', observed: 'hadcrut5.anomaly', params: ebm({}), scenario: scenario({ mode: 'emissions', preset: 'netzero', startYear: 2025, zeroYear: 2050 }) }
    }, 'CO₂ before 2025 is the Mauna Loa record (and, before 1958, the emissions run through a fixed airborne fraction). Try “constant”, “growing” or “peak and decline”, and the ice–albedo and deep-ocean options.', ['co2_mlo', 'owid_co2', 'hadcrut5']))

  add('Energy-balance model', 'Business as usual: emissions growing 1 % a year (toy scenario)',
    'Same model, but emissions keep growing by 1 % a year from 2025. Compare the end-of-century warming with the net-zero example.',
    make('Emissions growing', (p) => {
      p.datasets = ['co2_mlo', 'owid_co2', 'hadcrut5']
      p.tab = 'model'
      p.model = { tool: 'response', observed: 'hadcrut5.anomaly', params: ebm({}), scenario: scenario({ mode: 'emissions', preset: 'growth', startYear: 2025, growthPct: 1 }) }
    }, 'A fixed airborne fraction is used for the future. Real sinks weaken as the ocean warms and saturates, which this toy does not include.', ['co2_mlo', 'owid_co2', 'hadcrut5']))

  add('Energy-balance model', 'Ice–albedo bistability and the snowball hysteresis loop',
    'When ice reflects more sunlight, a cooler Earth gets colder still. With that feedback the same sunlight allows two stable climates, and sweeping the solar constant down and back up traces a hysteresis loop: a frozen Earth needs far more sunlight to thaw than it took to freeze.',
    make('Ice-albedo hysteresis', (p) => {
      p.datasets = []
      p.tab = 'model'
      p.model = { tool: 'hysteresis', observed: '', params: ebm({ ice: true }), scenario: scenario({}) }
    }, 'At today’s solar constant (factor 1) there are two stable temperatures, about 247 K (snowball) and 288 K (today), with an unstable one between them. The red path sweeps the sun’s output down from 1.6 times; the blue one sweeps up from a frozen planet.', []))

  add('Energy-balance model', 'The 255 K Earth with no greenhouse effect',
    'Without an atmosphere that absorbs infrared, Earth’s surface would settle at 255 K (−18 °C): the temperature at which it radiates away the sunlight it absorbs. The real 288 K is 33 K warmer, and that difference is the natural greenhouse effect.',
    make('No-greenhouse Earth', (p) => {
      p.datasets = []
      p.tab = 'model'
      p.model = { tool: 'blackbody', observed: '', params: ebm({}), scenario: scenario({}) }
    }, 'T = [S (1 − α) / (4 σ)]^¼ with S = 1361 W/m² and α = 0.30 gives 254.6 K. Change the albedo or the solar constant, or lower the emissivity to bring in the greenhouse effect.', []))

  add('Your own data', 'Import your own CSV: a synthetic weather station',
    'A starter for your own time series: a made-up weather station (synthetic data, not observations) imported as monthly temperature and rainfall. Use File › Import CSV… with your own file: choose the time column and the value columns, and everything in kClimate works on it.',
    (() => {
      const d = sampleDataset()
      const p = make('Import your own CSV (synthetic starter)', (q) => {
        q.datasets = []
        q.imports = [d]
        q.tab = 'series'
        q.series = { lines: [{ ref: `${d.id}.temperature`, axis: 'left' }, { ref: `${d.id}.rainfall`, axis: 'right' }], from: null, to: null, baseline: 'native', smooth: { kind: 'running', years: 1 }, trendLine: 'linear' }
        q.trend = { ...q.trend, series: `${d.id}.temperature`, from: null, to: null, annual: true }
        q.seasonal = { ...q.seasonal, series: `${d.id}.temperature`, harmonics: 2, degree: 1 }
        q.stripes = { ...q.stripes, series: `${d.id}.temperature`, baseline: '1995-2024' }
        q.relate = { ...q.relate, x: `${d.id}.temperature`, y: `${d.id}.rainfall`, mode: 'correlation', detrend: true, from: null, to: null, step: 'monthly' }
      }, 'SYNTHETIC DATA: invented for this demonstration (a warming trend of 0.4 °C per decade, a seasonal cycle and noise). To use your own, choose File › Import CSV…, pick the time column (a year, a decimal year, dates like 2024-03, or a year and a month column) and the value columns; add “Paste sample” in the dialog to see the expected layout.', [])
      return p
    })())

  return list
}
