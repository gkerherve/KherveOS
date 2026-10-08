// Course 1: Python basics.

import { doc, pyBlock, src, type Course } from './lessonTypes.ts'

export const PYTHON_BASICS: Course = {
  id: 'python-basics',
  title: 'Python basics',
  language: 'python',
  blurb: 'The language from the first print() to classes and files.',
  chapters: [
    {
      id: 'py-first',
      title: 'First steps',
      lessons: [
        {
          id: 'py-hello', language: 'python', title: 'Hello, Python', level: 'beginner', minutes: 4,
          text: doc(
            'A program is a list of instructions that Python carries out one after the other. `print()` shows something on the screen.',
            'Text goes between quotes (a **string**); numbers do not. Python does arithmetic with the usual signs: `+ - * /`, and `**` for a power. Anything after a `#` is a comment: Python ignores it, people read it.',
            pyBlock(src`
              print("Hello, lab!")
              print(2 + 3 * 4)   # multiplication first: 14
            `),
            'Press **Run** (or Ctrl+Enter) to see what the code prints.',
          ),
          task: 'Print the number of seconds in one day: 24 hours of 60 minutes of 60 seconds. Let Python do the multiplication.',
          code: src`
            print("Hello, lab!")
            print(2 + 3 * 4)

            # Your turn: print the seconds in a day
          `,
          hint: 'Write print(24 * 60 * 60). You do not have to work out the answer yourself.',
          solution: src`
            print("Hello, lab!")
            print(2 + 3 * 4)

            print(24 * 60 * 60)
          `,
          checks: [{ label: 'prints 86400', test: 'assert "86400" in OUTPUT' }],
        },
        {
          id: 'py-variables', language: 'python', title: 'Variables and numbers', level: 'beginner', minutes: 6,
          text: doc(
            'A **variable** keeps a value under a name: `mass = 2.5`. Use the name later and Python uses the value. Names use letters, digits and `_`, and cannot start with a digit.',
            'Whole numbers are `int`, numbers with a decimal point are `float`. `/` always gives a float; `//` divides and drops the fraction; `%` gives the remainder; `round(x, 3)` rounds.',
            pyBlock(src`
              mass = 2.5          # grams
              molar_mass = 18.0   # g/mol
              moles = mass / molar_mass
              print("moles =", round(moles, 4))
              print(7 // 2, 7 % 2, 3 ** 2)
            `),
          ),
          task: 'A volume of 250 mL of solution has a concentration of 0.10 mol/L. Set `moles` to the amount of substance in it (concentration times volume in litres).',
          code: src`
            volume_ml = 250
            concentration = 0.10   # mol/L

            moles = None   # replace None with a calculation
            print("moles =", moles)
          `,
          hint: 'Convert millilitres to litres first: volume_ml / 1000. Then multiply by the concentration.',
          solution: src`
            volume_ml = 250
            concentration = 0.10   # mol/L

            moles = concentration * volume_ml / 1000
            print("moles =", moles)
          `,
          checks: [
            { label: 'moles is a number', test: 'assert isinstance(moles, (int, float))' },
            { label: 'moles is 0.025', test: 'assert abs(moles - 0.025) < 1e-9, f"moles is {moles}"' },
          ],
        },
        {
          id: 'py-strings', language: 'python', title: 'Strings', level: 'beginner', minutes: 7,
          text: doc(
            'A string is a sequence of characters. Join strings with `+`, repeat them with `*`, count them with `len()`. Indexes start at **0**: `s[0]` is the first character, `s[-1]` the last, `s[1:4]` a slice.',
            'Strings have methods, called with a dot: `.upper()`, `.lower()`, `.strip()` (removes spaces at both ends), `.split()` (cuts into a list of words), `.replace(old, new)`, `.startswith(text)`.',
            pyBlock(src`
              formula = "H2SO4"
              print(len(formula), formula[0], formula[-1], formula[1:3])
              print(formula.lower(), "-" * 10)
              print("a,b,c".split(","))
            `),
          ),
          task: 'The string `sample` has stray spaces and mixed case. Make `clean` the same text without the outer spaces and in capitals, and `first_word` its first word.',
          code: src`
            sample = "  Sodium chloride  "

            clean = ""
            first_word = ""
            print(repr(clean), repr(first_word))
          `,
          hint: 'sample.strip().upper() chains two methods. clean.split() gives a list of words; the first one is at index 0.',
          solution: src`
            sample = "  Sodium chloride  "

            clean = sample.strip().upper()
            first_word = clean.split()[0]
            print(repr(clean), repr(first_word))
          `,
          checks: [
            { label: 'clean is "SODIUM CHLORIDE"', test: 'assert clean == "SODIUM CHLORIDE", repr(clean)' },
            { label: 'first_word is "SODIUM"', test: 'assert first_word == "SODIUM", repr(first_word)' },
          ],
        },
        {
          id: 'py-fstrings', language: 'python', title: 'f-strings and formatting', level: 'beginner', minutes: 6,
          text: doc(
            'Put an `f` before the opening quote and write values or calculations in braces: Python fills them in. After a colon you say how to show the number.',
            '- `{x:.2f}` two decimals, `{x:8.3f}` at least 8 characters wide\n- `{x:.3e}` scientific notation, `{x:.1%}` a percentage\n- `{n:05d}` an integer padded with zeros, `{name:<10}` text padded to the right',
            pyBlock(src`
              pressure = 101325.0
              ratio = 0.0731
              print(f"p = {pressure:.3e} Pa")
              print(f"yield: {ratio:.1%}")
              print(f"{2 * 21 = }")
            `),
          ),
          task: 'The variable `value` holds 0.025. Print exactly `Concentration: 0.0250 mol/L` using an f-string that shows four decimals.',
          code: src`
            value = 0.025

            print("Concentration:", value)
          `,
          hint: 'print(f"Concentration: {value:.4f} mol/L")',
          solution: src`
            value = 0.025

            print(f"Concentration: {value:.4f} mol/L")
          `,
          checks: [{ label: 'prints "Concentration: 0.0250 mol/L"', test: 'assert "Concentration: 0.0250 mol/L" in OUTPUT, OUTPUT' }],
        },
      ],
    },
    {
      id: 'py-flow',
      title: 'Decisions and loops',
      lessons: [
        {
          id: 'py-conditionals', language: 'python', title: 'if, elif and else', level: 'beginner', minutes: 7,
          text: doc(
            '`if` runs a block only when a condition is true. The block is **indented** by four spaces. `elif` (else if) tries another condition; `else` catches the rest.',
            'Comparisons: `== != < <= > >=`. Combine conditions with `and`, `or`, `not`. Note `==` compares, `=` assigns.',
            pyBlock(src`
              temperature = 37.5
              if temperature > 38:
                  print("fever")
              elif temperature >= 36:
                  print("normal")
              else:
                  print("low")
            `),
          ),
          task: 'Finish `classify(ph)`: it returns the text "acidic" below 7, "basic" above 7 and "neutral" at exactly 7. Use `return`, not `print`.',
          code: src`
            def classify(ph):
                pass

            print(classify(3.2))
          `,
          hint: 'if ph < 7: return "acidic"  /  elif ph > 7: return "basic"  /  else: return "neutral"',
          solution: src`
            def classify(ph):
                if ph < 7:
                    return "acidic"
                elif ph > 7:
                    return "basic"
                else:
                    return "neutral"

            print(classify(3.2))
          `,
          checks: [
            { label: 'classify(3) is "acidic"', test: 'assert classify(3) == "acidic", repr(classify(3))' },
            { label: 'classify(7) is "neutral"', test: 'assert classify(7) == "neutral", repr(classify(7))' },
            { label: 'classify(11.2) is "basic"', test: 'assert classify(11.2) == "basic", repr(classify(11.2))' },
          ],
        },
        {
          id: 'py-loops', language: 'python', title: 'for and while loops', level: 'beginner', minutes: 8,
          text: doc(
            '`for` repeats a block for every item of a sequence; `range(n)` counts 0 … n-1, `range(a, b)` counts a … b-1. `while` repeats as long as a condition is true — make sure something in the block changes it, or it never ends.',
            pyBlock(src`
              total = 0
              for i in range(1, 6):      # 1, 2, 3, 4, 5
                  total += i             # same as total = total + i
              print("sum:", total)

              n = 100
              while n > 10:
                  n = n / 2
              print(n)
            `),
            '`break` leaves a loop early, `continue` skips to the next round.',
          ),
          task: 'Set `total` to the sum of the squares 1², 2², … 10² with a `for` loop. Then use a `while` loop to count in `steps` how many times 100 can be halved before it drops below 1.',
          code: src`
            total = 0
            # for ... in range(...): add the square of i to total

            value = 100
            steps = 0
            # while value >= 1: halve value, count a step

            print(total, steps)
          `,
          hint: 'for i in range(1, 11): total += i ** 2.   while value >= 1: value = value / 2; steps += 1.',
          solution: src`
            total = 0
            for i in range(1, 11):
                total += i ** 2

            value = 100
            steps = 0
            while value >= 1:
                value = value / 2
                steps += 1

            print(total, steps)
          `,
          checks: [
            { label: 'total is 385', test: 'assert total == 385, f"total is {total}"' },
            { label: 'steps is 7', test: 'assert steps == 7, f"steps is {steps}"' },
          ],
        },
        {
          id: 'py-lists', language: 'python', title: 'Lists and loops', level: 'beginner', minutes: 8,
          text: doc(
            'A **list** holds many values in order: `[20.1, 21.4, 19.8]`. Index and slice it like a string; unlike a string you can change it: `values[0] = 5`, `values.append(x)`, `values.remove(x)`, `values.sort()`.',
            'Useful functions: `len(v)`, `sum(v)`, `min(v)`, `max(v)`, `sorted(v)`. `for item in v:` visits every item.',
            pyBlock(src`
              temperatures = [20.1, 21.4, 19.8, 22.0]
              temperatures.append(21.0)
              total = 0
              for t in temperatures:
                  total += t
              print("mean =", round(total / len(temperatures), 2))
              print(max(temperatures), temperatures[-1], temperatures[1:3])
            `),
          ),
          task: 'Add the reading 23.5 to `temperatures`, then set `average` to the mean of the five readings.',
          code: src`
            temperatures = [20.1, 21.4, 19.8, 22.0]

            average = None
            print(temperatures, average)
          `,
          hint: 'temperatures.append(23.5) first, then average = sum(temperatures) / len(temperatures).',
          solution: src`
            temperatures = [20.1, 21.4, 19.8, 22.0]
            temperatures.append(23.5)

            average = sum(temperatures) / len(temperatures)
            print(temperatures, average)
          `,
          checks: [
            { label: 'temperatures has 5 readings, the last is 23.5', test: 'assert len(temperatures) == 5 and temperatures[-1] == 23.5, temperatures' },
            { label: 'average is the mean (21.36)', test: 'assert abs(average - 21.36) < 1e-9, f"average is {average}"' },
          ],
        },
      ],
    },
    {
      id: 'py-data',
      title: 'Collections',
      lessons: [
        {
          id: 'py-dicts', language: 'python', title: 'Dictionaries', level: 'beginner', minutes: 8,
          text: doc(
            'A **dictionary** maps keys to values: `{"H": 1.008, "O": 15.999}`. Look up with `d["H"]`, add or change with `d["Na"] = 22.99`. `d.get(key, default)` does not fail on a missing key; `key in d` tests for it.',
            'Loop with `for key, value in d.items():`; `d.keys()` and `d.values()` give the parts.',
            pyBlock(src`
              masses = {"H": 1.008, "C": 12.011, "O": 15.999}
              water = 2 * masses["H"] + masses["O"]
              print("water:", round(water, 3))
              for symbol, m in masses.items():
                  print(symbol, m)
            `),
          ),
          task: 'Add sodium (`"Na"`, 22.99) to `masses`, then set `nacl` to the molar mass of NaCl (Na plus Cl, with Cl = 35.45) using the dictionary where you can.',
          code: src`
            masses = {"H": 1.008, "C": 12.011, "O": 15.999, "Cl": 35.45}

            nacl = None
            print(masses, nacl)
          `,
          hint: 'masses["Na"] = 22.99 adds the key. Then nacl = masses["Na"] + masses["Cl"].',
          solution: src`
            masses = {"H": 1.008, "C": 12.011, "O": 15.999, "Cl": 35.45}
            masses["Na"] = 22.99

            nacl = masses["Na"] + masses["Cl"]
            print(masses, nacl)
          `,
          checks: [
            { label: 'masses["Na"] is 22.99', test: 'assert masses.get("Na") == 22.99, masses' },
            { label: 'nacl is 58.44', test: 'assert abs(nacl - 58.44) < 1e-9, f"nacl is {nacl}"' },
          ],
        },
        {
          id: 'py-tuples-sets', language: 'python', title: 'Tuples and sets', level: 'beginner', minutes: 7,
          text: doc(
            'A **tuple** is a list that cannot change: `point = (3, 4)`. Use it for a fixed group of values. You can unpack it: `x, y = point`. Functions often return tuples.',
            'A **set** keeps each value once, without order: `set([1, 2, 2, 3])` is `{1, 2, 3}`. Sets answer "is it in there?" fast and combine like maths: `a | b` union, `a & b` common elements, `a - b` only in a.',
            pyBlock(src`
              x, y = (3, 4)
              print(x + y)
              a = {"Fe", "Cu", "Zn"}
              b = {"Cu", "Ag"}
              print(a & b, a | b, a - b)
            `),
          ),
          task: 'From the list `readings` make `unique` (a set of the distinct values) and, from the two sets, `common` (values in both).',
          code: src`
            readings = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]
            a = {1, 2, 3, 4}
            b = {3, 4, 5, 6}

            unique = None
            common = None
            print(unique, common)
          `,
          hint: 'unique = set(readings) and common = a & b',
          solution: src`
            readings = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]
            a = {1, 2, 3, 4}
            b = {3, 4, 5, 6}

            unique = set(readings)
            common = a & b
            print(unique, common)
          `,
          checks: [
            { label: 'unique has the 7 distinct readings', test: 'assert unique == {1, 2, 3, 4, 5, 6, 9}, unique' },
            { label: 'common is {3, 4}', test: 'assert common == {3, 4}, common' },
          ],
        },
        {
          id: 'py-comprehensions', language: 'python', title: 'Comprehensions', level: 'intermediate', minutes: 8,
          text: doc(
            'A **list comprehension** builds a list in one line: `[expression for item in sequence if condition]`. It reads like the loop it replaces.',
            pyBlock(src`
              squares = [n ** 2 for n in range(1, 6)]            # [1, 4, 9, 16, 25]
              odd = [n for n in range(10) if n % 2 == 1]         # [1, 3, 5, 7, 9]
              lengths = {w: len(w) for w in ["ion", "atom"]}     # a dict comprehension
              print(squares, odd, lengths)
            `),
            'Keep them short: when it needs more than one condition, a normal loop is clearer.',
          ),
          task: 'Make `even_squares`: the squares of the even numbers from 1 to 10. Make `fahrenheit`: each value of `celsius` converted with F = C × 9/5 + 32.',
          code: src`
            celsius = [0, 25, 37, 100]

            even_squares = []
            fahrenheit = []
            print(even_squares, fahrenheit)
          `,
          hint: '[n ** 2 for n in range(1, 11) if n % 2 == 0]  and  [c * 9 / 5 + 32 for c in celsius]',
          solution: src`
            celsius = [0, 25, 37, 100]

            even_squares = [n ** 2 for n in range(1, 11) if n % 2 == 0]
            fahrenheit = [c * 9 / 5 + 32 for c in celsius]
            print(even_squares, fahrenheit)
          `,
          checks: [
            { label: 'even_squares is [4, 16, 36, 64, 100]', test: 'assert even_squares == [4, 16, 36, 64, 100], even_squares' },
            { label: 'fahrenheit is [32, 77, 98.6, 212]', test: 'assert len(fahrenheit) == 4 and all(abs(a - b) < 1e-9 for a, b in zip(fahrenheit, [32, 77, 98.6, 212])), fahrenheit' },
          ],
        },
      ],
    },
    {
      id: 'py-functions-ch',
      title: 'Functions',
      lessons: [
        {
          id: 'py-functions', language: 'python', title: 'Functions', level: 'beginner', minutes: 8,
          text: doc(
            '`def` names a reusable calculation. The names in the brackets are its **parameters**; `return` hands the result back. A function that does not `return` gives `None`.',
            'The first string in a function is its **docstring**: a note on what it does.',
            pyBlock(src`
              def ideal_gas_pressure(n, T, V):
                  """p = nRT/V in Pa (T in kelvin, V in m³)."""
                  R = 8.314
                  return n * R * T / V

              print(round(ideal_gas_pressure(1, 298.15, 0.0244)), "Pa")
            `),
          ),
          task: 'Write `to_kelvin(celsius)` that returns the temperature in kelvin (add 273.15).',
          code: src`
            def ideal_gas_pressure(n, T, V):
                """p = nRT/V in Pa (T in kelvin, V in m³)."""
                R = 8.314
                return n * R * T / V


            # write to_kelvin here


            print(round(ideal_gas_pressure(1, 298.15, 0.0244)), "Pa")
          `,
          hint: 'def to_kelvin(celsius):  then an indented  return celsius + 273.15',
          solution: src`
            def ideal_gas_pressure(n, T, V):
                """p = nRT/V in Pa (T in kelvin, V in m³)."""
                R = 8.314
                return n * R * T / V


            def to_kelvin(celsius):
                return celsius + 273.15


            print(round(ideal_gas_pressure(1, to_kelvin(25), 0.0244)), "Pa")
          `,
          checks: [
            { label: 'to_kelvin(0) is 273.15', test: 'assert abs(to_kelvin(0) - 273.15) < 1e-9' },
            { label: 'to_kelvin(25) is 298.15', test: 'assert abs(to_kelvin(25) - 298.15) < 1e-9' },
            { label: 'ideal_gas_pressure still works', test: 'assert abs(ideal_gas_pressure(1, 298.15, 0.0244) - 101590) < 5' },
          ],
        },
        {
          id: 'py-args', language: 'python', title: 'Default and keyword arguments', level: 'intermediate', minutes: 7,
          text: doc(
            'A parameter can have a **default**: `def power(x, n=2)`. Callers may leave it out. Arguments can be given by name (**keyword arguments**), in any order: `power(n=3, x=2)`.',
            pyBlock(src`
              def power(x, n=2):
                  return x ** n

              print(power(5), power(5, 3), power(n=3, x=2))
            `),
            'Put parameters with defaults after those without. Never use a list as a default value: it would be shared between calls.',
          ),
          task: 'Write `molarity(moles, volume_l=1.0)`: it returns the concentration in mol/L.',
          code: src`
            def molarity(moles, volume_l):
                pass

            print(molarity(0.5))
          `,
          hint: 'The default goes in the signature: volume_l=1.0. The body is return moles / volume_l.',
          solution: src`
            def molarity(moles, volume_l=1.0):
                return moles / volume_l

            print(molarity(0.5), molarity(0.5, volume_l=0.25))
          `,
          checks: [
            { label: 'molarity(0.5) is 0.5 (one litre by default)', test: 'assert molarity(0.5) == 0.5' },
            { label: 'molarity(0.5, volume_l=0.25) is 2.0', test: 'assert molarity(0.5, volume_l=0.25) == 2.0' },
            { label: 'molarity(moles=1, volume_l=2) is 0.5', test: 'assert molarity(moles=1, volume_l=2) == 0.5' },
          ],
        },
        {
          id: 'py-recursion', language: 'python', title: 'Recursion', level: 'intermediate', minutes: 9,
          text: doc(
            'A function may call itself. A **recursive** function needs a **base case** that answers directly, and a step that moves towards it. Factorial: 0! = 1 and n! = n × (n−1)!.',
            pyBlock(src`
              def countdown(n):
                  if n == 0:               # base case
                      print("liftoff")
                  else:
                      print(n)
                      countdown(n - 1)     # smaller problem

              countdown(3)
            `),
            'Python stops a runaway recursion after about a thousand calls with a RecursionError.',
          ),
          task: 'Write `factorial(n)` recursively. `factorial(5)` is 120, `factorial(0)` is 1. Also write `fib(n)`: 0, 1, 1, 2, 3, 5, 8 … (`fib(0)` is 0, `fib(1)` is 1, each next is the sum of the two before).',
          code: src`
            def factorial(n):
                pass


            def fib(n):
                pass


            print(factorial(5), fib(10))
          `,
          hint: 'factorial: if n == 0 return 1, else return n * factorial(n - 1). fib: if n < 2 return n, else return fib(n - 1) + fib(n - 2).',
          solution: src`
            def factorial(n):
                if n == 0:
                    return 1
                return n * factorial(n - 1)


            def fib(n):
                if n < 2:
                    return n
                return fib(n - 1) + fib(n - 2)


            print(factorial(5), fib(10))
          `,
          checks: [
            { label: 'factorial(0) is 1', test: 'assert factorial(0) == 1' },
            { label: 'factorial(5) is 120', test: 'assert factorial(5) == 120' },
            { label: 'factorial(10) is 3628800', test: 'assert factorial(10) == 3628800' },
            { label: 'fib(0..10) is 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55', test: 'assert [fib(i) for i in range(11)] == [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]' },
          ],
        },
      ],
    },
    {
      id: 'py-bigger',
      title: 'Bigger programs',
      lessons: [
        {
          id: 'py-exceptions', language: 'python', title: 'Errors and exceptions', level: 'intermediate', minutes: 8,
          text: doc(
            'When something goes wrong, Python **raises an exception** (ValueError, ZeroDivisionError, KeyError…) and stops. `try` / `except` catches it so the program can carry on. Catch the specific kind you expect, not everything.',
            pyBlock(src`
              try:
                  x = float("12,5")
              except ValueError:
                  print("not a number")
              else:
                  print("fine", x)
              finally:
                  print("always runs")
            `),
            'Raise your own with `raise ValueError("negative mass")`. Read a traceback from the bottom: the last line says what happened, the lines above say where.',
          ),
          task: 'Write `safe_float(text, default=0.0)`: it returns `float(text)`, or `default` when the text is not a number (also when it is `None`).',
          code: src`
            def safe_float(text, default=0.0):
                return float(text)

            print(safe_float("3.5"), safe_float("abc"))
          `,
          hint: 'Wrap return float(text) in try:, and catch (ValueError, TypeError) in the except line: return default.',
          solution: src`
            def safe_float(text, default=0.0):
                try:
                    return float(text)
                except (ValueError, TypeError):
                    return default

            print(safe_float("3.5"), safe_float("abc"))
          `,
          checks: [
            { label: 'safe_float("3.5") is 3.5', test: 'assert safe_float("3.5") == 3.5' },
            { label: 'safe_float("abc") is 0.0', test: 'assert safe_float("abc") == 0.0' },
            { label: 'safe_float("x", default=-1) is -1', test: 'assert safe_float("x", default=-1) == -1' },
            { label: 'safe_float(None, default=7) is 7', test: 'assert safe_float(None, default=7) == 7' },
          ],
        },
        {
          id: 'py-classes', language: 'python', title: 'Classes', level: 'intermediate', minutes: 10,
          text: doc(
            'A **class** bundles data and the functions that work on it. `__init__` sets up a new object; `self` is the object itself. Functions inside a class are called **methods**.',
            pyBlock(src`
              class Point:
                  def __init__(self, x, y):
                      self.x = x
                      self.y = y

                  def distance_to_origin(self):
                      return (self.x ** 2 + self.y ** 2) ** 0.5

              p = Point(3, 4)
              print(p.x, p.distance_to_origin())
            `),
          ),
          task: 'Finish the class `Sample`: its `moles()` method returns `mass / molar_mass`, and `__repr__` returns text like `Sample(NaCl, 5.844 g)`.',
          code: src`
            class Sample:
                def __init__(self, name, mass, molar_mass):
                    self.name = name
                    self.mass = mass
                    self.molar_mass = molar_mass

                def moles(self):
                    pass

                def __repr__(self):
                    return "Sample"


            s = Sample("NaCl", 5.844, 58.44)
            print(s, s.moles())
          `,
          hint: 'Inside a method, reach the data through self: return self.mass / self.molar_mass. For __repr__ use an f-string: f"Sample({self.name}, {self.mass} g)".',
          solution: src`
            class Sample:
                def __init__(self, name, mass, molar_mass):
                    self.name = name
                    self.mass = mass
                    self.molar_mass = molar_mass

                def moles(self):
                    return self.mass / self.molar_mass

                def __repr__(self):
                    return f"Sample({self.name}, {self.mass} g)"


            s = Sample("NaCl", 5.844, 58.44)
            print(s, s.moles())
          `,
          checks: [
            { label: 'moles() of 5.844 g NaCl is 0.1', test: 'assert abs(Sample("NaCl", 5.844, 58.44).moles() - 0.1) < 1e-9' },
            { label: 'moles() uses the sample\'s own values', test: 'assert abs(Sample("X", 10, 20).moles() - 0.5) < 1e-9' },
            { label: 'repr is "Sample(NaCl, 5.844 g)"', test: 'assert repr(Sample("NaCl", 5.844, 58.44)) == "Sample(NaCl, 5.844 g)", repr(Sample("NaCl", 5.844, 58.44))' },
          ],
        },
        {
          id: 'py-modules', language: 'python', title: 'Modules and imports', level: 'beginner', minutes: 7,
          text: doc(
            'A **module** is a file of ready-made tools. `import math` makes `math.sqrt`, `math.pi` and `math.log10` available; `from statistics import mean` brings in one name. The standard library has hundreds: `random`, `statistics`, `datetime`, `json`, `csv`, `pathlib`…',
            pyBlock(src`
              import math
              from statistics import mean, stdev

              print(math.sqrt(2), math.pi)
              data = [4.1, 4.3, 3.9, 4.2]
              print(mean(data), round(stdev(data), 3))
            `),
            'Any Python file you write can be imported too. For numbers on a large scale, the next course uses **numpy**.',
          ),
          task: 'Compute `area`, the area of a circle of radius 2.5 (π r²), with `math.pi`, and `m` and `s`: the mean and the sample standard deviation (`stdev`) of `data`.',
          code: src`
            import math
            from statistics import mean, stdev

            data = [9.8, 10.1, 10.0, 9.7, 10.3, 10.2]
            r = 2.5

            area = None
            m = None
            s = None
            print(area, m, s)
          `,
          hint: 'area = math.pi * r ** 2;  m = mean(data);  s = stdev(data)',
          solution: src`
            import math
            from statistics import mean, stdev

            data = [9.8, 10.1, 10.0, 9.7, 10.3, 10.2]
            r = 2.5

            area = math.pi * r ** 2
            m = mean(data)
            s = stdev(data)
            print(area, m, s)
          `,
          checks: [
            { label: 'area is π × 2.5²', test: 'assert abs(area - 19.634954) < 1e-5, area' },
            { label: 'm is the mean of data', test: 'assert abs(m - 10.016667) < 1e-5, m' },
            { label: 's is the sample standard deviation', test: 'assert abs(s - 0.231661) < 1e-5, s' },
          ],
        },
        {
          id: 'py-files', language: 'python', title: 'Reading and writing files', level: 'intermediate', minutes: 10,
          text: doc(
            'Python in KherveOS works in your home folder of the KherveOS drive: files it writes appear in Files, files you put there can be read. `open(path, "w")` writes, `open(path)` reads; `with` closes the file for you.',
            pyBlock(src`
              from pathlib import Path

              path = Path.home() / "kcode-demo.txt"
              with open(path, "w") as f:
                  f.write("first line\n")
                  f.write("second line\n")

              with open(path) as f:
                  for line in f:
                      print(line.strip())
            `),
            '`Path` objects join with `/`; `path.exists()`, `path.read_text()` and `path.write_text(text)` are shortcuts for the common cases.',
          ),
          task: 'Write the numbers 1 to 5 to the file `path`, one per line, then read the file back into the list `numbers` (as integers, not text).',
          code: src`
            from pathlib import Path

            path = Path.home() / "kcode-numbers.txt"

            # write 1..5, one per line

            numbers = []
            # read them back, as ints

            print(numbers)
          `,
          hint: 'path.write_text("\\n".join(str(i) for i in range(1, 6)))  then  numbers = [int(line) for line in path.read_text().split()]',
          solution: src`
            from pathlib import Path

            path = Path.home() / "kcode-numbers.txt"

            with open(path, "w") as f:
                for i in range(1, 6):
                    f.write(f"{i}\n")

            with open(path) as f:
                numbers = [int(line) for line in f]

            print(numbers)
          `,
          checks: [
            { label: 'the file exists', test: 'assert path.exists(), "no file at " + str(path)' },
            { label: 'the file has 5 lines', test: 'assert len(path.read_text().split()) == 5, path.read_text()' },
            { label: 'numbers is [1, 2, 3, 4, 5]', test: 'assert numbers == [1, 2, 3, 4, 5], numbers' },
          ],
        },
      ],
    },
  ],
}
