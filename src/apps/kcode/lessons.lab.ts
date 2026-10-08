// Course 4: Lab recipes — small, complete programs a scientist writes again and again.

import { doc, jsBlock, pyBlock, src, type Course } from './lessonTypes.ts'

export const LAB_RECIPES: Course = {
  id: 'lab-recipes',
  title: 'Lab recipes',
  language: 'python',
  blurb: 'Calibration lines, unit conversion, titration curves, error propagation, Monte-Carlo and CSV files.',
  chapters: [
    {
      id: 'lab-data',
      title: 'Measurements and data',
      lessons: [
        {
          id: 'lab-line-fit', language: 'python', title: 'Fit a calibration line', level: 'intermediate', minutes: 12, needs: ['numpy'],
          text: doc(
            'A **calibration curve** relates a signal (absorbance) to a concentration. For a straight line `y = m·x + c`, `np.polyfit(x, y, 1)` returns `m` and `c`. How good is the line? **R²** is 1 for a perfect fit: `1 − Σ(residual²) / Σ(y − mean)²`.',
            pyBlock(src`
              import numpy as np

              x = np.array([0.0, 1.0, 2.0, 3.0])
              y = np.array([0.1, 1.9, 4.1, 5.9])
              m, c = np.polyfit(x, y, 1)
              predicted = m * x + c
              r2 = 1 - ((y - predicted) ** 2).sum() / ((y - y.mean()) ** 2).sum()
              print(m, c, r2)
            `),
            'Once you have the line, you can read an unknown sample back: `concentration = (absorbance − c) / m`.',
          ),
          task: 'Fit the Beer–Lambert data: set `slope`, `intercept` and `r2`. Then compute `unknown`, the concentration (mg/L) of a sample whose absorbance is 0.380.',
          code: src`
            import numpy as np

            conc = np.array([0.0, 2.0, 4.0, 6.0, 8.0, 10.0])               # mg/L
            absorbance = np.array([0.002, 0.152, 0.310, 0.451, 0.607, 0.752])

            slope, intercept, r2, unknown = None, None, None, None
            print(slope, intercept, r2, unknown)
          `,
          hint: 'slope, intercept = np.polyfit(conc, absorbance, 1).  predicted = slope * conc + intercept.  unknown = (0.380 - intercept) / slope.',
          solution: src`
            import numpy as np

            conc = np.array([0.0, 2.0, 4.0, 6.0, 8.0, 10.0])               # mg/L
            absorbance = np.array([0.002, 0.152, 0.310, 0.451, 0.607, 0.752])

            slope, intercept = np.polyfit(conc, absorbance, 1)
            predicted = slope * conc + intercept
            r2 = 1 - ((absorbance - predicted) ** 2).sum() / ((absorbance - absorbance.mean()) ** 2).sum()
            unknown = (0.380 - intercept) / slope
            print(f"A = {slope:.4f} c + {intercept:.4f}  (R² = {r2:.5f})")
            print(f"unknown: {unknown:.2f} mg/L")
          `,
          checks: [
            { label: 'slope is 0.0751 per mg/L', test: 'assert abs(slope - 0.075086) < 1e-5, slope' },
            { label: 'intercept is 0.0036', test: 'assert abs(intercept - 0.003571) < 1e-5, intercept' },
            { label: 'r2 is 0.99983', test: 'assert abs(r2 - 0.999834) < 1e-5, r2' },
            { label: 'unknown is 5.02 mg/L', test: 'assert abs(unknown - 5.0214) < 1e-2, unknown' },
          ],
        },
        {
          id: 'lab-csv', language: 'python', title: 'Parse a CSV file', level: 'intermediate', minutes: 10,
          text: doc(
            'Instruments export **CSV** (comma-separated values). The `csv` module reads it: `csv.DictReader` gives one dictionary per row, keyed by the header. Everything arrives as text — convert numbers with `float()`. To read a real file: `open(path, newline="")` instead of the `StringIO` used here for the text.',
            pyBlock(src`
              import csv, io

              text = "name,mass\nA,1.5\nB,2.5"
              rows = list(csv.DictReader(io.StringIO(text)))
              print(rows[0]["name"], float(rows[1]["mass"]))
            `),
          ),
          task: 'Read `text`: `rows` (a list of dictionaries), `mean_ph` (the mean of the pH column, as a number), and `warm` (the names of the samples whose temperature is above 25).',
          code: src`
            import csv, io

            text = "name,ph,temp\nlake,7.8,18.5\nriver,7.2,22.0\nspring,6.9,9.5\npond,8.1,27.4\nsea,8.0,26.1"

            rows = []
            mean_ph = None
            warm = []
            print(rows, mean_ph, warm)
          `,
          hint: 'rows = list(csv.DictReader(io.StringIO(text))).  mean_ph = sum(float(r["ph"]) for r in rows) / len(rows).  warm = [r["name"] for r in rows if float(r["temp"]) > 25]',
          solution: src`
            import csv, io

            text = "name,ph,temp\nlake,7.8,18.5\nriver,7.2,22.0\nspring,6.9,9.5\npond,8.1,27.4\nsea,8.0,26.1"

            rows = list(csv.DictReader(io.StringIO(text)))
            mean_ph = sum(float(r["ph"]) for r in rows) / len(rows)
            warm = [r["name"] for r in rows if float(r["temp"]) > 25]
            print(rows, mean_ph, warm)
          `,
          checks: [
            { label: 'rows has 5 dictionaries with the header names', test: 'assert len(rows) == 5 and rows[0]["name"] == "lake" and "ph" in rows[0], rows[:1]' },
            { label: 'mean_ph is 7.6', test: 'assert abs(mean_ph - 7.6) < 1e-9, mean_ph' },
            { label: 'warm is ["pond", "sea"]', test: 'assert warm == ["pond", "sea"], warm' },
          ],
        },
        {
          id: 'lab-units', language: 'python', title: 'Unit conversion', level: 'intermediate', minutes: 10,
          text: doc(
            'A tidy way to convert units: store each unit as a factor to a base unit of its kind (metre for lengths, pascal for pressures). Then `value × factor(from) / factor(to)` converts any pair, and a mismatch between kinds can be refused.',
            pyBlock(src`
              LENGTH = {"m": 1.0, "cm": 0.01, "in": 0.0254}
              print(2.5 * LENGTH["in"] / LENGTH["cm"], "cm")
            `),
            'Raise `ValueError` with a clear message when the units do not belong together.',
          ),
          task: 'Write `convert(value, source, target)` for the units in `UNITS` (each is `(kind, factor to the base unit)`). Converting between different kinds, like m to Pa, raises a `ValueError`.',
          code: src`
            UNITS = {
                "m": ("length", 1.0), "cm": ("length", 0.01), "mm": ("length", 0.001), "in": ("length", 0.0254),
                "Pa": ("pressure", 1.0), "kPa": ("pressure", 1000.0), "bar": ("pressure", 1e5), "atm": ("pressure", 101325.0),
            }

            def convert(value, source, target):
                return value

            print(convert(1, "atm", "kPa"))
          `,
          hint: 'kind_a, f_a = UNITS[source]; kind_b, f_b = UNITS[target]; if kind_a != kind_b: raise ValueError(...); return value * f_a / f_b',
          solution: src`
            UNITS = {
                "m": ("length", 1.0), "cm": ("length", 0.01), "mm": ("length", 0.001), "in": ("length", 0.0254),
                "Pa": ("pressure", 1.0), "kPa": ("pressure", 1000.0), "bar": ("pressure", 1e5), "atm": ("pressure", 101325.0),
            }

            def convert(value, source, target):
                kind_a, factor_a = UNITS[source]
                kind_b, factor_b = UNITS[target]
                if kind_a != kind_b:
                    raise ValueError(f"cannot convert {kind_a} ({source}) to {kind_b} ({target})")
                return value * factor_a / factor_b

            print(convert(1, "atm", "kPa"))
          `,
          checks: [
            { label: 'convert(100, "cm", "m") is 1', test: 'assert abs(convert(100, "cm", "m") - 1) < 1e-12' },
            { label: 'convert(1, "atm", "kPa") is 101.325', test: 'assert abs(convert(1, "atm", "kPa") - 101.325) < 1e-9' },
            { label: 'convert(1, "in", "mm") is 25.4', test: 'assert abs(convert(1, "in", "mm") - 25.4) < 1e-9' },
            { label: 'convert(1, "m", "Pa") raises ValueError', test: 'try:\n    convert(1, "m", "Pa")\nexcept ValueError:\n    pass\nelse:\n    raise AssertionError("no ValueError")' },
          ],
        },
      ],
    },
    {
      id: 'lab-chem',
      title: 'Chemistry and statistics',
      lessons: [
        {
          id: 'lab-titration', language: 'python', title: 'Titration curve', level: 'advanced', minutes: 14,
          text: doc(
            'Titrating 25.0 mL of 0.100 M HCl with 0.100 M NaOH: before the equivalence point the pH comes from the acid that is left, at it the solution is neutral (pH 7), after it from the excess base.',
            '- acid left: [H⁺] = (n_acid − n_base) / total volume, pH = −log₁₀[H⁺]\n- equivalence: n_base = n_acid, pH = 7\n- excess base: [OH⁻] = (n_base − n_acid) / total volume, pH = 14 + log₁₀[OH⁻]',
            'Amounts n are in millimoles (mL × mol/L), volumes in mL. Use `math.log10`.',
          ),
          task: 'Write `ph_after(v_ml)`: the pH after adding `v_ml` of NaOH. Check: 0 mL gives 1.0, 25 mL gives 7.0, 30 mL gives 11.96.',
          code: src`
            import math

            ACID_ML, ACID_M, BASE_M = 25.0, 0.100, 0.100

            def ph_after(v_ml):
                n_acid = ACID_ML * ACID_M      # mmol of HCl
                n_base = v_ml * BASE_M         # mmol of NaOH added
                return 7.0

            for v in [0, 12.5, 25, 30]:
                print(v, round(ph_after(v), 2))
          `,
          hint: 'total = ACID_ML + v_ml. If n_base < n_acid: return -math.log10((n_acid - n_base) / total). If equal (within 1e-9): 7.0. Else: return 14 + math.log10((n_base - n_acid) / total).',
          solution: src`
            import math

            ACID_ML, ACID_M, BASE_M = 25.0, 0.100, 0.100

            def ph_after(v_ml):
                n_acid = ACID_ML * ACID_M      # mmol of HCl
                n_base = v_ml * BASE_M         # mmol of NaOH added
                total = ACID_ML + v_ml
                if abs(n_base - n_acid) < 1e-9:
                    return 7.0
                if n_base < n_acid:
                    return -math.log10((n_acid - n_base) / total)
                return 14 + math.log10((n_base - n_acid) / total)

            for v in [0, 12.5, 25, 30]:
                print(v, round(ph_after(v), 2))
          `,
          checks: [
            { label: 'ph_after(0) is 1.00', test: 'assert abs(ph_after(0) - 1.0) < 0.01, ph_after(0)' },
            { label: 'ph_after(12.5) is 1.48', test: 'assert abs(ph_after(12.5) - 1.477) < 0.01, ph_after(12.5)' },
            { label: 'ph_after(25) is 7.00 (equivalence point)', test: 'assert abs(ph_after(25) - 7.0) < 0.01, ph_after(25)' },
            { label: 'ph_after(30) is 11.96', test: 'assert abs(ph_after(30) - 11.959) < 0.01, ph_after(30)' },
          ],
        },
        {
          id: 'lab-error-propagation', language: 'python', title: 'Error propagation', level: 'advanced', minutes: 12,
          text: doc(
            'A result calculated from measurements inherits their uncertainties. For a **product or quotient** of independent quantities the *relative* errors add in quadrature: for `f = a / b`,',
            pyBlock('σf / f = sqrt( (σa / a)² + (σb / b)² )'),
            'For a sum or difference the *absolute* errors add in quadrature. Report the result with the error to one or two significant figures.',
          ),
          task: 'Write `quotient_error(a, da, b, db)` returning the pair `(value, sigma)` of a / b. Use it for a density: mass 12.50 ± 0.05 g, volume 5.0 ± 0.1 mL, in `density, sigma_density`.',
          code: src`
            import math

            def quotient_error(a, da, b, db):
                return (0.0, 0.0)

            density, sigma_density = quotient_error(12.50, 0.05, 5.0, 0.1)
            print(f"density = {density:.3f} ± {sigma_density:.3f} g/mL")
          `,
          hint: 'value = a / b; then sigma = abs(value) * math.sqrt((da / a) ** 2 + (db / b) ** 2). Return (value, sigma).',
          solution: src`
            import math

            def quotient_error(a, da, b, db):
                value = a / b
                sigma = abs(value) * math.sqrt((da / a) ** 2 + (db / b) ** 2)
                return (value, sigma)

            density, sigma_density = quotient_error(12.50, 0.05, 5.0, 0.1)
            print(f"density = {density:.3f} ± {sigma_density:.3f} g/mL")
          `,
          checks: [
            { label: 'the value is a / b', test: 'assert abs(quotient_error(6.0, 0.1, 3.0, 0.1)[0] - 2.0) < 1e-12' },
            { label: 'the error follows the quadrature rule', test: 'assert abs(quotient_error(12.5, 0.05, 5.0, 0.1)[1] - 0.05099) < 1e-4, quotient_error(12.5, 0.05, 5.0, 0.1)' },
            { label: 'density is 2.5 ± 0.051', test: 'assert abs(density - 2.5) < 1e-9 and abs(sigma_density - 0.05099) < 1e-4, (density, sigma_density)' },
          ],
        },
        {
          id: 'lab-monte-carlo', language: 'python', title: 'Monte-Carlo estimate of π', level: 'intermediate', minutes: 10,
          text: doc(
            'Throw random darts at a unit square. The share that lands inside the quarter circle `x² + y² ≤ 1` is π/4. So `4 × inside / total` estimates π. Monte-Carlo methods answer hard questions by random sampling; the error shrinks like 1/√n.',
            pyBlock(src`
              import random

              rng = random.Random(1)       # a seed: the same "random" numbers every run
              x, y = rng.random(), rng.random()
              print(x, y, x * x + y * y <= 1)
            `),
          ),
          task: 'Write `estimate_pi(n, seed=1)`: throw `n` random points with `random.Random(seed)` and return the estimate of π as a float.',
          code: src`
            import random

            def estimate_pi(n, seed=1):
                return 0.0

            print(estimate_pi(100_000))
          `,
          hint: 'rng = random.Random(seed); inside = 0; loop n times: x, y = rng.random(), rng.random(); if x * x + y * y <= 1: inside += 1. Return 4 * inside / n.',
          solution: src`
            import random

            def estimate_pi(n, seed=1):
                rng = random.Random(seed)
                inside = 0
                for _ in range(n):
                    x, y = rng.random(), rng.random()
                    if x * x + y * y <= 1:
                        inside += 1
                return 4 * inside / n

            print(estimate_pi(100_000))
          `,
          checks: [
            { label: 'estimate_pi(100000) is close to π', test: 'assert abs(estimate_pi(100_000) - 3.14159) < 0.02, estimate_pi(100_000)' },
            { label: 'the same seed gives the same estimate', test: 'assert estimate_pi(2000, seed=5) == estimate_pi(2000, seed=5)' },
            { label: 'another seed gives another estimate', test: 'assert estimate_pi(2000, seed=5) != estimate_pi(2000, seed=6)' },
            { label: 'the result is a float', test: 'assert isinstance(estimate_pi(10), float)' },
          ],
        },
        {
          id: 'lab-js-statistics', language: 'javascript', title: 'Mean and standard deviation in JavaScript', level: 'intermediate', minutes: 10,
          text: doc(
            'The same statistics in JavaScript: the **mean** is the sum over the count; the **sample standard deviation** divides the sum of squared deviations by `n − 1`. Write them as small, pure functions that take an array.',
            jsBlock(src`
              const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
              console.log(mean([2, 4, 6]));   // 4
            `),
          ),
          task: 'Write `mean(values)` and `stdev(values)` (sample standard deviation, dividing by n − 1).',
          code: src`
            const mean = (values) => 0;
            const stdev = (values) => 0;

            const data = [2, 4, 4, 4, 5, 5, 7, 9];
            console.log(mean(data), stdev(data));
          `,
          hint: 'stdev: const m = mean(values); const ss = values.reduce((s, v) => s + (v - m) ** 2, 0); return Math.sqrt(ss / (values.length - 1));',
          solution: src`
            const mean = (values) => values.reduce((s, v) => s + v, 0) / values.length;
            const stdev = (values) => {
              const m = mean(values);
              const ss = values.reduce((s, v) => s + (v - m) ** 2, 0);
              return Math.sqrt(ss / (values.length - 1));
            };

            const data = [2, 4, 4, 4, 5, 5, 7, 9];
            console.log(mean(data), stdev(data));
          `,
          checks: [
            { label: 'mean([2, 4, 6]) is 4', test: 'mean([2, 4, 6]) === 4 || "got " + mean([2, 4, 6])' },
            { label: 'mean(data) is 5', test: 'mean(data) === 5 || "got " + mean(data)' },
            { label: 'stdev(data) is 2.138 (n − 1)', test: 'Math.abs(stdev(data) - 2.13809) < 1e-4 || "got " + stdev(data)' },
          ],
        },
      ],
    },
  ],
}
