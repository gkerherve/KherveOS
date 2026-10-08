// Course 2: Python for science (numpy, scipy, matplotlib, pandas — all run in the browser).

import { doc, pyBlock, src, type Course } from './lessonTypes.ts'

export const PYTHON_SCIENCE: Course = {
  id: 'python-science',
  title: 'Python for science',
  language: 'python',
  blurb: 'Arrays, fitting, integrals, plots and tables with numpy, scipy, matplotlib and pandas.',
  chapters: [
    {
      id: 'sci-numpy',
      title: 'NumPy',
      lessons: [
        {
          id: 'py-data', language: 'python', title: 'Arrays with numpy', level: 'intermediate', minutes: 10, needs: ['numpy'],
          text: doc(
            'numpy works on whole **arrays** at once, with no loops. `np.linspace(0, 10, 11)` makes 11 evenly spaced numbers; `np.arange(5)` counts; arithmetic applies to every element.',
            pyBlock(src`
              import numpy as np

              x = np.linspace(0, 10, 11)
              y = 2.0 * x + 1.0
              print(y[:3], y.mean(), y.max())
              print(x[x > 7])            # a mask picks the elements that pass
              slope, intercept = np.polyfit(x, y, 1)
              print(round(slope, 3), round(intercept, 3))
            `),
            'The first time you import numpy in a window, Python loads it (a few seconds).',
          ),
          task: 'Make `squares` (the square of every element of `x`), `total` (their sum) and `evens` (the elements of `x` that are even — `x % 2 == 0` is the mask).',
          code: src`
            import numpy as np

            x = np.linspace(0, 10, 11)

            squares = None
            total = None
            evens = None
            print(squares, total, evens)
          `,
          hint: 'squares = x ** 2;  total = squares.sum();  evens = x[x % 2 == 0]',
          solution: src`
            import numpy as np

            x = np.linspace(0, 10, 11)

            squares = x ** 2
            total = squares.sum()
            evens = x[x % 2 == 0]
            print(squares, total, evens)
          `,
          checks: [
            { label: 'squares[3] is 9', test: 'assert squares[3] == 9, squares' },
            { label: 'total is 385', test: 'assert total == 385, total' },
            { label: 'evens is [0, 2, 4, 6, 8, 10]', test: 'assert evens.tolist() == [0, 2, 4, 6, 8, 10], evens' },
          ],
        },
        {
          id: 'np-broadcasting', language: 'python', title: 'Shapes, axes and broadcasting', level: 'intermediate', minutes: 10, needs: ['numpy'],
          text: doc(
            'A 2-D array has rows (axis 0) and columns (axis 1). `a.mean(axis=0)` averages down the rows and gives one value per column. `a.shape` tells the size.',
            '**Broadcasting** stretches smaller arrays to fit larger ones: a row of 3 numbers added to a 4×3 table is added to every row. `v[:, None]` turns a flat array into a column, so `col * row` makes a table.',
            pyBlock(src`
              import numpy as np

              a = np.arange(6).reshape(2, 3)    # [[0 1 2], [3 4 5]]
              print(a.shape, a.mean(axis=0), a.sum(axis=1))
              print(a - a.mean(axis=0))          # subtract each column's mean
              print(np.arange(1, 4)[:, None] * np.arange(1, 4))
            `),
          ),
          task: 'Make `centered`: `a` minus the mean of each of its columns. Make `table`: the 5×5 multiplication table (`table[2, 3]` is 3 × 4 = 12).',
          code: src`
            import numpy as np

            a = np.array([[1.0, 2.0, 3.0],
                          [4.0, 6.0, 8.0],
                          [7.0, 10.0, 13.0]])

            centered = None
            table = None
            print(centered)
            print(table)
          `,
          hint: 'centered = a - a.mean(axis=0).  table = np.arange(1, 6)[:, None] * np.arange(1, 6)',
          solution: src`
            import numpy as np

            a = np.array([[1.0, 2.0, 3.0],
                          [4.0, 6.0, 8.0],
                          [7.0, 10.0, 13.0]])

            centered = a - a.mean(axis=0)
            table = np.arange(1, 6)[:, None] * np.arange(1, 6)
            print(centered)
            print(table)
          `,
          checks: [
            { label: 'centered has the shape of a', test: 'assert centered.shape == (3, 3), getattr(centered, "shape", None)' },
            { label: 'every column of centered has mean 0', test: 'assert np.allclose(centered.mean(axis=0), 0)' },
            { label: 'table is 5 × 5', test: 'assert table.shape == (5, 5), table.shape' },
            { label: 'table[2, 3] is 12', test: 'assert table[2, 3] == 12, table[2, 3]' },
          ],
        },
        {
          id: 'np-linalg', language: 'python', title: 'Linear algebra', level: 'advanced', minutes: 10, needs: ['numpy'],
          text: doc(
            '`A @ B` multiplies matrices. `np.linalg.solve(A, b)` solves the system A·x = b (better than inverting A). `np.linalg.det(A)` is the determinant, `np.linalg.eigvals(A)` the eigenvalues.',
            pyBlock(src`
              import numpy as np

              A = np.array([[3.0, 1.0], [1.0, 2.0]])
              b = np.array([9.0, 8.0])
              x = np.linalg.solve(A, b)         # [2, 3]
              print(x, A @ x)
              print(np.linalg.det(A), np.linalg.eigvals(A))
            `),
            'Balancing chemical equations, circuit loops and least squares all end up as A·x = b.',
          ),
          task: 'Solve the three equations 2x + y − z = 8, −3x − y + 2z = −11, −2x + y + 2z = −3 for `x` (an array of three numbers) and put the determinant of `A` in `det`.',
          code: src`
            import numpy as np

            A = np.array([[ 2.0,  1.0, -1.0],
                          [-3.0, -1.0,  2.0],
                          [-2.0,  1.0,  2.0]])
            b = np.array([8.0, -11.0, -3.0])

            x = None
            det = None
            print(x, det)
          `,
          hint: 'x = np.linalg.solve(A, b) and det = np.linalg.det(A)',
          solution: src`
            import numpy as np

            A = np.array([[ 2.0,  1.0, -1.0],
                          [-3.0, -1.0,  2.0],
                          [-2.0,  1.0,  2.0]])
            b = np.array([8.0, -11.0, -3.0])

            x = np.linalg.solve(A, b)
            det = np.linalg.det(A)
            print(x, det)
          `,
          checks: [
            { label: 'A @ x equals b', test: 'assert np.allclose(A @ x, b), A @ x' },
            { label: 'x is [2, 3, -1]', test: 'assert np.allclose(x, [2, 3, -1]), x' },
            { label: 'det is -1', test: 'assert abs(det + 1) < 1e-9, det' },
          ],
        },
        {
          id: 'np-statistics', language: 'python', title: 'Statistics of measurements', level: 'intermediate', minutes: 10, needs: ['numpy'],
          text: doc(
            'Repeat a measurement and you get a spread. The **mean** is the best value; the **sample standard deviation** (`ddof=1`) describes the spread; the **standard error** `s/√n` says how well you know the mean.',
            pyBlock(src`
              import numpy as np

              data = np.array([9.8, 10.1, 10.0, 9.7, 10.3, 10.2])
              mean = data.mean()
              s = data.std(ddof=1)               # ddof=1: divide by n-1
              print(f"{mean:.3f} ± {s / np.sqrt(len(data)):.3f}")
              print(np.median(data), np.percentile(data, [25, 75]))
            `),
            'Random numbers: `rng = np.random.default_rng(42)` then `rng.normal(10, 0.2, size=100)`. The seed makes the "random" numbers the same on every run.',
          ),
          task: 'Compute `mean`, the sample standard deviation `sd` (with `ddof=1`) and the standard error `sem` of `data`.',
          code: src`
            import numpy as np

            data = np.array([9.8, 10.1, 10.0, 9.7, 10.3, 10.2])

            mean = None
            sd = None
            sem = None
            print(mean, sd, sem)
          `,
          hint: 'data.mean(); data.std(ddof=1); sem = sd / np.sqrt(len(data))',
          solution: src`
            import numpy as np

            data = np.array([9.8, 10.1, 10.0, 9.7, 10.3, 10.2])

            mean = data.mean()
            sd = data.std(ddof=1)
            sem = sd / np.sqrt(len(data))
            print(mean, sd, sem)
          `,
          checks: [
            { label: 'mean is 10.0167', test: 'assert abs(mean - 10.016667) < 1e-5, mean' },
            { label: 'sd uses ddof=1 (0.2317)', test: 'assert abs(sd - 0.231661) < 1e-5, sd' },
            { label: 'sem is sd / √n (0.0946)', test: 'assert abs(sem - 0.094575) < 1e-5, sem' },
          ],
        },
      ],
    },
    {
      id: 'sci-scipy',
      title: 'SciPy',
      lessons: [
        {
          id: 'sp-minimize', language: 'python', title: 'Optimisation', level: 'advanced', minutes: 10, needs: ['numpy', 'scipy'],
          text: doc(
            '`scipy.optimize.minimize(f, x0)` looks for the input that makes `f` smallest, starting from the guess `x0`. `f` takes one array and returns one number. The answer is in `result.x`, the lowest value in `result.fun`.',
            pyBlock(src`
              import numpy as np
              from scipy.optimize import minimize

              def f(p):
                  x, y = p
                  return (x - 3) ** 2 + (y + 1) ** 2 + 5

              result = minimize(f, [0, 0])
              print(result.x.round(3), round(result.fun, 3))
            `),
            'To maximise something, minimise its negative.',
          ),
          task: 'Find the minimum of `energy(p)`, a function of two values. Put the result of `minimize` in `result`, starting from `[0, 0]`.',
          code: src`
            import numpy as np
            from scipy.optimize import minimize

            def energy(p):
                x, y = p
                return (x - 1) ** 2 + (y + 2) ** 2 + 0.5 * x * y + 3

            result = None
            print(result)
          `,
          hint: 'result = minimize(energy, [0, 0])  — then result.x holds the best point.',
          solution: src`
            import numpy as np
            from scipy.optimize import minimize

            def energy(p):
                x, y = p
                return (x - 1) ** 2 + (y + 2) ** 2 + 0.5 * x * y + 3

            result = minimize(energy, [0, 0])
            print(result.x, result.fun)
          `,
          checks: [
            { label: 'the optimiser succeeded', test: 'assert result.success' },
            { label: 'the energy there is lower than at the start', test: 'assert result.fun < energy([0, 0]) - 1' },
            { label: 'the minimum is found (x ≈ 1.6, y ≈ −2.4)', test: 'assert np.allclose(result.x, [1.6, -2.4], atol=1e-3), result.x' },
          ],
        },
        {
          id: 'sp-curve-fit', language: 'python', title: 'Fitting a curve to data', level: 'advanced', minutes: 12, needs: ['numpy', 'scipy'],
          text: doc(
            '`curve_fit(model, x, y, p0)` adjusts the parameters of your own function `model(x, a, b, …)` until it matches the data. It returns the best parameters `popt` and their covariance `pcov`; the square roots of the diagonal of `pcov` are the parameter uncertainties.',
            pyBlock(src`
              import numpy as np
              from scipy.optimize import curve_fit

              def line(x, m, c):
                  return m * x + c

              x = np.array([0, 1, 2, 3, 4])
              y = np.array([1.1, 2.9, 5.2, 7.0, 8.9])
              popt, pcov = curve_fit(line, x, y)
              print(popt, np.sqrt(np.diag(pcov)))
            `),
            'Good starting values `p0` matter for curved models: take them from the picture of the data.',
          ),
          task: 'The data decays like a·e^(−k·t). Write `model(t, a, k)`, fit it with `curve_fit` (start from `p0=[5, 1]`) and unpack the result into `a` and `k`.',
          code: src`
            import numpy as np
            from scipy.optimize import curve_fit

            t = np.linspace(0, 5, 11)
            y = np.array([10.15, 7.59, 6.17, 4.67, 3.8, 2.77, 2.28, 1.82, 1.31, 1.07, 0.79])

            def model(t, a, k):
                pass

            a, k = None, None
            print(a, k)
          `,
          hint: 'model returns a * np.exp(-k * t).  popt, pcov = curve_fit(model, t, y, p0=[5, 1]); a, k = popt',
          solution: src`
            import numpy as np
            from scipy.optimize import curve_fit

            t = np.linspace(0, 5, 11)
            y = np.array([10.15, 7.59, 6.17, 4.67, 3.8, 2.77, 2.28, 1.82, 1.31, 1.07, 0.79])

            def model(t, a, k):
                return a * np.exp(-k * t)

            popt, pcov = curve_fit(model, t, y, p0=[5, 1])
            a, k = popt
            print(f"a = {a:.2f}, k = {k:.3f}")
          `,
          checks: [
            { label: 'model(0, 3, 1) is 3', test: 'assert abs(model(0, 3, 1) - 3) < 1e-9' },
            { label: 'a is about 10', test: 'assert abs(a - 10.04) < 0.05, a' },
            { label: 'k is about 0.5', test: 'assert abs(k - 0.501) < 0.01, k' },
          ],
        },
        {
          id: 'sp-integrate', language: 'python', title: 'Integrals', level: 'advanced', minutes: 9, needs: ['numpy', 'scipy'],
          text: doc(
            'For a **function**, `scipy.integrate.quad(f, a, b)` returns the area under it and an error estimate. For **data points**, `trapezoid(y, x)` adds up trapezoids.',
            pyBlock(src`
              import numpy as np
              from scipy.integrate import quad, trapezoid

              area, err = quad(np.sin, 0, np.pi)         # 2
              x = np.linspace(0, np.pi, 50)
              print(area, trapezoid(np.sin(x), x))
            `),
          ),
          task: 'Compute `exact`, the integral of x² from 0 to 3 with `quad` (just the value), and `approx`, the trapezoid rule on the 7 points `x`, `x**2`.',
          code: src`
            import numpy as np
            from scipy.integrate import quad, trapezoid

            x = np.linspace(0, 3, 7)

            exact = None
            approx = None
            print(exact, approx)
          `,
          hint: 'quad returns (value, error): exact, _ = quad(lambda t: t ** 2, 0, 3).   approx = trapezoid(x ** 2, x)',
          solution: src`
            import numpy as np
            from scipy.integrate import quad, trapezoid

            x = np.linspace(0, 3, 7)

            exact, _ = quad(lambda t: t ** 2, 0, 3)
            approx = trapezoid(x ** 2, x)
            print(exact, approx)
          `,
          checks: [
            { label: 'exact is 9', test: 'assert abs(exact - 9) < 1e-9, exact' },
            { label: 'approx is the trapezoid sum (9.125)', test: 'assert abs(approx - 9.125) < 1e-9, approx' },
          ],
        },
      ],
    },
    {
      id: 'sci-plots',
      title: 'Plots and tables',
      lessons: [
        {
          id: 'mpl-line-plot', language: 'python', title: 'Plotting with matplotlib', level: 'intermediate', minutes: 10, needs: ['numpy', 'matplotlib'],
          text: doc(
            'matplotlib draws charts. Make a figure and its axes with `fig, ax = plt.subplots()`, then draw on `ax` with `ax.plot(x, y, label="…")`, and add `ax.set_xlabel`, `ax.set_ylabel`, `ax.legend()`. In kCode the figure appears in the output below the editor.',
            pyBlock(src`
              import numpy as np
              import matplotlib.pyplot as plt

              x = np.linspace(0, 2 * np.pi, 100)
              fig, ax = plt.subplots()
              ax.plot(x, np.sin(x), label="sin")
              ax.set_xlabel("angle (rad)")
              ax.legend()
            `),
            'A good chart has labelled axes with units, and a legend only when there is more than one line.',
          ),
          task: 'Draw sin(x) **and** cos(x) on the same axes, each with a label, add the axis labels and a legend.',
          code: src`
            import numpy as np
            import matplotlib.pyplot as plt

            x = np.linspace(0, 2 * np.pi, 100)
            fig, ax = plt.subplots()
            ax.plot(x, np.sin(x), label="sin")
            # add cos, the labels and the legend
          `,
          hint: 'ax.plot(x, np.cos(x), label="cos"); ax.set_xlabel("angle (rad)"); ax.set_ylabel("value"); ax.legend()',
          solution: src`
            import numpy as np
            import matplotlib.pyplot as plt

            x = np.linspace(0, 2 * np.pi, 100)
            fig, ax = plt.subplots()
            ax.plot(x, np.sin(x), label="sin")
            ax.plot(x, np.cos(x), label="cos")
            ax.set_xlabel("angle (rad)")
            ax.set_ylabel("value")
            ax.legend()
          `,
          checks: [
            { label: 'two lines are drawn', test: 'assert len(ax.lines) == 2, len(ax.lines)' },
            { label: 'the x axis has a label', test: 'assert ax.get_xlabel().strip() != ""' },
            { label: 'the y axis has a label', test: 'assert ax.get_ylabel().strip() != ""' },
            { label: 'there is a legend', test: 'assert ax.get_legend() is not None' },
          ],
        },
        {
          id: 'mpl-histogram', language: 'python', title: 'Histograms and error bars', level: 'advanced', minutes: 11, needs: ['numpy', 'matplotlib'],
          text: doc(
            'A **histogram** counts how many values fall in each bin: `counts, edges = np.histogram(data, bins=10)` or `ax.hist(data, bins=10)`. `ax.errorbar(x, y, yerr=sigma, fmt="o")` draws points with error bars.',
            pyBlock(src`
              import numpy as np
              import matplotlib.pyplot as plt

              rng = np.random.default_rng(1)
              data = rng.normal(10, 0.5, 200)
              fig, (left, right) = plt.subplots(1, 2, figsize=(8, 3))
              left.hist(data, bins=15)
              right.errorbar([1, 2, 3], [2.0, 2.8, 4.1], yerr=[0.2, 0.3, 0.2], fmt="o")
            `),
          ),
          task: 'With the random `data` make `counts, edges` with 10 bins (the counts add up to all 200 values). Then on `ax`, draw the measurements `x`, `y` with error bars `err` using `ax.errorbar`.',
          code: src`
            import numpy as np
            import matplotlib.pyplot as plt

            rng = np.random.default_rng(7)
            data = rng.normal(5.0, 1.0, 200)
            x = np.array([1, 2, 3, 4])
            y = np.array([2.1, 3.9, 6.2, 7.8])
            err = np.array([0.3, 0.3, 0.4, 0.3])

            counts, edges = None, None
            fig, ax = plt.subplots()
            # ax.errorbar(...)
          `,
          hint: 'counts, edges = np.histogram(data, bins=10).   ax.errorbar(x, y, yerr=err, fmt="o")',
          solution: src`
            import numpy as np
            import matplotlib.pyplot as plt

            rng = np.random.default_rng(7)
            data = rng.normal(5.0, 1.0, 200)
            x = np.array([1, 2, 3, 4])
            y = np.array([2.1, 3.9, 6.2, 7.8])
            err = np.array([0.3, 0.3, 0.4, 0.3])

            counts, edges = np.histogram(data, bins=10)
            fig, ax = plt.subplots()
            ax.errorbar(x, y, yerr=err, fmt="o")
          `,
          checks: [
            { label: 'counts has 10 bins', test: 'assert len(counts) == 10, counts' },
            { label: 'the counts add up to 200', test: 'assert counts.sum() == 200, counts.sum()' },
            { label: 'the figure has an error-bar plot', test: 'assert len(ax.containers) >= 1, "nothing drawn with ax.errorbar"' },
          ],
        },
        {
          id: 'pd-dataframe', language: 'python', title: 'pandas: tables', level: 'intermediate', minutes: 10, needs: ['pandas'],
          text: doc(
            'A pandas **DataFrame** is a table with named columns. Pick a column with `df["mass"]`, filter rows with a condition `df[df["mass"] > 5]`, and add a column by assigning to a new name — the calculation applies to the whole column.',
            pyBlock(src`
              import pandas as pd

              df = pd.DataFrame({"sample": ["A", "B", "C"], "mass": [2.0, 5.5, 8.1]})
              df["double"] = df["mass"] * 2
              print(df)
              print(df[df["mass"] > 5]["sample"].tolist())
              print(df["mass"].mean())
            `),
            '`df.describe()` gives count, mean, spread and quartiles of every numeric column.',
          ),
          task: 'Add a column `moles` to `df` (mass divided by molar mass), and put the rows heavier than 5 g in `heavy`.',
          code: src`
            import pandas as pd

            df = pd.DataFrame({
                "sample": ["A", "B", "C", "D"],
                "mass": [2.0, 5.5, 8.1, 3.2],
                "molar_mass": [20.0, 55.0, 81.0, 32.0],
            })

            heavy = None
            print(df)
          `,
          hint: 'df["moles"] = df["mass"] / df["molar_mass"].   heavy = df[df["mass"] > 5]',
          solution: src`
            import pandas as pd

            df = pd.DataFrame({
                "sample": ["A", "B", "C", "D"],
                "mass": [2.0, 5.5, 8.1, 3.2],
                "molar_mass": [20.0, 55.0, 81.0, 32.0],
            })

            df["moles"] = df["mass"] / df["molar_mass"]
            heavy = df[df["mass"] > 5]
            print(df)
            print(heavy)
          `,
          checks: [
            { label: 'df has a "moles" column', test: 'assert "moles" in df.columns, list(df.columns)' },
            { label: 'moles is mass / molar_mass', test: 'assert (df["moles"] - df["mass"] / df["molar_mass"]).abs().max() < 1e-12' },
            { label: 'heavy holds samples B and C', test: 'assert heavy["sample"].tolist() == ["B", "C"], heavy' },
          ],
        },
        {
          id: 'pd-groupby', language: 'python', title: 'pandas: grouping and summaries', level: 'advanced', minutes: 11, needs: ['pandas'],
          text: doc(
            '`df.groupby("sample")["value"].mean()` splits the rows by sample and averages each group. Other summaries: `.std()`, `.count()`, `.max()`; `.agg(["mean", "std"])` gives several at once. `df.sort_values("value")` orders rows.',
            pyBlock(src`
              import io
              import pandas as pd

              text = "sample,value\nA,1.0\nA,3.0\nB,4.0\nB,6.0"
              df = pd.read_csv(io.StringIO(text))     # read_csv also takes a file path
              print(df.groupby("sample")["value"].mean())
            `),
          ),
          task: 'Read the table `text`; make `means` (the mean `value` of each `sample`) and `best`, the name of the sample with the highest mean.',
          code: src`
            import io
            import pandas as pd

            text = "sample,value\nA,1.0\nA,3.0\nB,4.0\nB,6.0\nC,2.5\nC,2.7"

            df = pd.read_csv(io.StringIO(text))
            means = None
            best = None
            print(means, best)
          `,
          hint: 'means = df.groupby("sample")["value"].mean().   best = means.idxmax()',
          solution: src`
            import io
            import pandas as pd

            text = "sample,value\nA,1.0\nA,3.0\nB,4.0\nB,6.0\nC,2.5\nC,2.7"

            df = pd.read_csv(io.StringIO(text))
            means = df.groupby("sample")["value"].mean()
            best = means.idxmax()
            print(means, best)
          `,
          checks: [
            { label: 'means["A"] is 2.0', test: 'assert abs(means["A"] - 2.0) < 1e-9, means' },
            { label: 'means["C"] is 2.6', test: 'assert abs(means["C"] - 2.6) < 1e-9, means' },
            { label: 'best is "B"', test: 'assert best == "B", best' },
          ],
        },
      ],
    },
  ],
}
