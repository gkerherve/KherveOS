// Course 3: JavaScript basics. The code runs in a Web Worker, away from the page.

import { doc, jsBlock, src, type Course } from './lessonTypes.ts'

// Lesson code cannot hold backticks or dollar-brace directly (it sits in template literals).
const BT = '`'
const D = '${'

export const JAVASCRIPT_BASICS: Course = {
  id: 'javascript-basics',
  title: 'JavaScript basics',
  language: 'javascript',
  blurb: 'The language of the web: values, functions, arrays, objects, JSON, promises and classes.',
  chapters: [
    {
      id: 'js-first',
      title: 'First steps',
      lessons: [
        {
          id: 'js-hello', language: 'javascript', title: 'Hello, JavaScript', level: 'beginner', minutes: 4,
          text: doc(
            'JavaScript runs in every browser. `console.log()` shows a value in the output; several values are separated by spaces. Statements end with `;` (optional but common), comments start with `//`.',
            'kCode runs your code in a separate worker: it cannot touch this window, and it is stopped after 5 seconds if it never ends. The value of the **last expression** is shown too, like in a calculator.',
            jsBlock(src`
              console.log("Hello, lab!");
              console.log(2 + 3 * 4);   // 14
              2 ** 10                    // the last value is shown: 1024
            `),
          ),
          task: 'Log the number of seconds in one day (24 hours of 60 minutes of 60 seconds); let JavaScript multiply.',
          code: src`
            console.log("Hello, lab!");
            console.log(2 + 3 * 4);

            // Your turn: log the seconds in a day
          `,
          hint: 'console.log(24 * 60 * 60);',
          solution: src`
            console.log("Hello, lab!");
            console.log(2 + 3 * 4);

            console.log(24 * 60 * 60);
          `,
          checks: [{ label: 'logs 86400', test: '__logs.some((line) => line.includes("86400"))' }],
        },
        {
          id: 'js-types', language: 'javascript', title: 'Values and types', level: 'beginner', minutes: 7,
          text: doc(
            'The basic kinds of value: **number** (`3`, `2.5`), **string** (`"text"`), **boolean** (`true`, `false`), `null` (nothing, on purpose) and `undefined` (not set). `typeof x` tells which.',
            'Take care with `+`: with a string on either side it **joins text** instead of adding. `Number("42")` converts text to a number; `String(42)` and `x.toFixed(2)` go the other way. Compare with `===` (strict), not `==`.',
            jsBlock(src`
              console.log(typeof 42, typeof "42", typeof true, typeof undefined);
              console.log("4" + 2, 4 + 2, Number("4") + 2);
              console.log(0.1 + 0.2 === 0.3, Math.abs(0.1 + 0.2 - 0.3) < 1e-9);
            `),
          ),
          task: '`total` should be 50 (a number), but the text "42" makes `+` join strings. Convert the text first.',
          code: src`
            const text = "42";
            let total = text + 8;
            console.log(total, typeof total);
          `,
          hint: 'Number(text) + 8',
          solution: src`
            const text = "42";
            let total = Number(text) + 8;
            console.log(total, typeof total);
          `,
          checks: [
            { label: 'total is a number', test: 'typeof total === "number" || "total is a " + typeof total' },
            { label: 'total is 50', test: 'total === 50 || "total is " + JSON.stringify(total)' },
          ],
        },
        {
          id: 'js-strings', language: 'javascript', title: 'Strings and template literals', level: 'beginner', minutes: 7,
          text: doc(
            'Strings have methods: `.toUpperCase()`, `.trim()`, `.split(",")`, `.includes("x")`, `.slice(0, 3)`, `.replace("a", "b")`, `.padStart(5, "0")`. A **template literal**, between backticks, puts values into text: write the value as dollar sign, braces around it.',
            jsBlock(src`
              const name = "NaCl";
              const mass = 5.8443;
              console.log(${BT}${D}name} weighs ${D}mass.toFixed(2)} g${BT});
              console.log("a,b,c".split(","), "  hi  ".trim().toUpperCase());
            `),
          ),
          task: 'Log exactly `Concentration: 0.0250 mol/L` using a template literal and `toFixed(4)` on `value`.',
          code: src`
            const value = 0.025;

            console.log("Concentration:", value);
          `,
          hint: 'console.log(' + BT + 'Concentration: ' + D + 'value.toFixed(4)} mol/L' + BT + ');',
          solution: src`
            const value = 0.025;

            console.log(${BT}Concentration: ${D}value.toFixed(4)} mol/L${BT});
          `,
          checks: [{ label: 'logs "Concentration: 0.0250 mol/L"', test: '__logs.includes("Concentration: 0.0250 mol/L") || "logged " + JSON.stringify(__logs)' }],
        },
        {
          id: 'js-variables', language: 'javascript', title: 'Variables and arrays', level: 'beginner', minutes: 8,
          text: doc(
            '`const` names a value that will not be reassigned; `let` names one that will. Prefer `const`. An **array** is a list: `[1.2, 3.4]`, indexed from 0, with `.length`, `.push(x)` (add at the end), `.pop()`, `.includes(x)` and `.slice(a, b)`.',
            jsBlock(src`
              const masses = [1.2, 3.4, 5.6];
              masses.push(7.8);
              let total = 0;
              for (const m of masses) {
                total += m;
              }
              console.log(masses.length, total.toFixed(2), masses[0]);
            `),
            'A `const` array can still change its contents: only the name is fixed.',
          ),
          task: 'Add 7.8 to `masses`, then set `total` to the sum and `mean` to the average of the four values.',
          code: src`
            const masses = [1.2, 3.4, 5.6];
            let total = 0;
            let mean = 0;

            console.log(masses, total, mean);
          `,
          hint: 'masses.push(7.8); then loop with for (const m of masses) { total += m; }  and  mean = total / masses.length;',
          solution: src`
            const masses = [1.2, 3.4, 5.6];
            masses.push(7.8);
            let total = 0;
            for (const m of masses) {
              total += m;
            }
            let mean = total / masses.length;

            console.log(masses, total, mean);
          `,
          checks: [
            { label: 'masses has 4 values, the last is 7.8', test: 'masses.length === 4 && masses[3] === 7.8' },
            { label: 'total is 18', test: 'Math.abs(total - 18) < 1e-9 || "total is " + total' },
            { label: 'mean is 4.5', test: 'Math.abs(mean - 4.5) < 1e-9 || "mean is " + mean' },
          ],
        },
        {
          id: 'js-control', language: 'javascript', title: 'Conditions and loops', level: 'beginner', minutes: 8,
          text: doc(
            '`if (condition) { … } else if (…) { … } else { … }` chooses. `for (let i = 0; i < 5; i++)` repeats with a counter; `for (const x of list)` visits every item; `while (condition)` repeats until the condition is false. `&&` is and, `||` is or, `!` is not, `%` the remainder.',
            jsBlock(src`
              for (let i = 1; i <= 5; i++) {
                if (i % 2 === 0) console.log(i, "even");
                else console.log(i, "odd");
              }
            `),
          ),
          task: 'Write `describe(n)`: it returns "FizzBuzz" if n divides by 3 and by 5, "Fizz" if only by 3, "Buzz" if only by 5, otherwise the number as text.',
          code: src`
            function describe(n) {
              return "";
            }

            for (let i = 1; i <= 15; i++) console.log(describe(i));
          `,
          hint: 'Test the both-case first: if (n % 15 === 0) return "FizzBuzz"; then n % 3, then n % 5; finally return String(n).',
          solution: src`
            function describe(n) {
              if (n % 15 === 0) return "FizzBuzz";
              if (n % 3 === 0) return "Fizz";
              if (n % 5 === 0) return "Buzz";
              return String(n);
            }

            for (let i = 1; i <= 15; i++) console.log(describe(i));
          `,
          checks: [
            { label: 'describe(15) is "FizzBuzz"', test: 'describe(15) === "FizzBuzz" || "got " + JSON.stringify(describe(15))' },
            { label: 'describe(9) is "Fizz"', test: 'describe(9) === "Fizz" || "got " + JSON.stringify(describe(9))' },
            { label: 'describe(10) is "Buzz"', test: 'describe(10) === "Buzz" || "got " + JSON.stringify(describe(10))' },
            { label: 'describe(7) is "7"', test: 'describe(7) === "7" || "got " + JSON.stringify(describe(7))' },
          ],
        },
      ],
    },
    {
      id: 'js-functions-ch',
      title: 'Functions and arrays',
      lessons: [
        {
          id: 'js-functions', language: 'javascript', title: 'Functions', level: 'beginner', minutes: 7,
          text: doc(
            'A function takes inputs (**parameters**) and gives back a result with `return`. Two spellings: `function area(r) { return Math.PI * r ** 2; }` and the **arrow function** `const area = (r) => Math.PI * r ** 2;`. Parameters can have defaults: `(r, digits = 2) => …`.',
            jsBlock(src`
              const area = (r) => Math.PI * r ** 2;
              for (const r of [1, 2, 3]) {
                console.log("r =", r, "area =", area(r).toFixed(3));
              }
            `),
          ),
          task: 'Write the arrow function `volume(r)` for the volume of a sphere, 4/3 π r³.',
          code: src`
            const volume = (r) => 0;

            console.log(volume(1));
          `,
          hint: 'const volume = (r) => (4 / 3) * Math.PI * r ** 3;',
          solution: src`
            const volume = (r) => (4 / 3) * Math.PI * r ** 3;

            console.log(volume(1));
          `,
          checks: [
            { label: 'volume(1) is 4.18879', test: 'Math.abs(volume(1) - 4.18879) < 1e-4 || "got " + volume(1)' },
            { label: 'volume(2) is 33.51032', test: 'Math.abs(volume(2) - 33.51032) < 1e-4 || "got " + volume(2)' },
          ],
        },
        {
          id: 'js-closures', language: 'javascript', title: 'Closures and scope', level: 'intermediate', minutes: 9,
          text: doc(
            'A function remembers the variables around where it was created — a **closure**. Variables of `let` and `const` live inside the nearest `{ }` block. A function returned from another function keeps its own private copy of the outer variables.',
            jsBlock(src`
              function makeCounter() {
                let count = 0;
                return () => ++count;
              }
              const a = makeCounter();
              const b = makeCounter();
              console.log(a(), a(), a(), b());   // 1 2 3 1
            `),
          ),
          task: 'Write `makeAccumulator(start)`: it returns a function that adds its argument to a running total (beginning at `start`) and returns the new total. Two accumulators must not share their totals.',
          code: src`
            function makeAccumulator(start) {
              return (amount) => 0;
            }

            const acc = makeAccumulator(10);
            console.log(acc(5), acc(7));
          `,
          hint: 'Keep let total = start; inside makeAccumulator, and let the returned function do total += amount; return total;',
          solution: src`
            function makeAccumulator(start) {
              let total = start;
              return (amount) => {
                total += amount;
                return total;
              };
            }

            const acc = makeAccumulator(10);
            console.log(acc(5), acc(7));
          `,
          checks: [
            { label: 'adds to the start value (10 + 5 + 7 = 22)', test: '(() => { const a = makeAccumulator(10); a(5); const t = a(7); return t === 22 || "got " + t; })()' },
            { label: 'two accumulators are independent', test: '(() => { const a = makeAccumulator(0); const b = makeAccumulator(100); a(1); b(1); return a(0) === 1 && b(0) === 101; })()' },
          ],
        },
        {
          id: 'js-array-methods', language: 'javascript', title: 'map, filter and reduce', level: 'intermediate', minutes: 10,
          text: doc(
            'Arrays have methods that take a function: `map` makes a new array by transforming each item, `filter` keeps items that pass a test, `reduce` folds the whole array into one value, `find`, `some`, `every` and `sort((a, b) => a - b)` do what they say.',
            jsBlock(src`
              const values = [3, 1, 4, 1, 5];
              console.log(values.map((v) => v * 2));
              console.log(values.filter((v) => v > 2));
              console.log(values.reduce((sum, v) => sum + v, 0));
            `),
            '`map` and `filter` return a new array; the original is untouched.',
          ),
          task: 'From the Celsius `readings` make `fahrenheit` (each × 9/5 + 32) with `map`, `hot` (only readings above 25) with `filter`, and `sum` with `reduce`.',
          code: src`
            const readings = [18.5, 22, 26.5, 30, 24];

            let fahrenheit = [];
            let hot = [];
            let sum = 0;
            console.log(fahrenheit, hot, sum);
          `,
          hint: 'readings.map((c) => c * 9 / 5 + 32);  readings.filter((c) => c > 25);  readings.reduce((s, c) => s + c, 0)',
          solution: src`
            const readings = [18.5, 22, 26.5, 30, 24];

            const fahrenheit = readings.map((c) => (c * 9) / 5 + 32);
            const hot = readings.filter((c) => c > 25);
            const sum = readings.reduce((s, c) => s + c, 0);
            console.log(fahrenheit, hot, sum);
          `,
          checks: [
            { label: 'fahrenheit has the 5 converted values (65.3 first)', test: 'fahrenheit.length === 5 && Math.abs(fahrenheit[0] - 65.3) < 1e-9 || "got " + JSON.stringify(fahrenheit)' },
            { label: 'hot is [26.5, 30]', test: 'JSON.stringify(hot) === "[26.5,30]" || "got " + JSON.stringify(hot)' },
            { label: 'sum is 121', test: 'Math.abs(sum - 121) < 1e-9 || "got " + sum' },
          ],
        },
      ],
    },
    {
      id: 'js-data',
      title: 'Objects and data',
      lessons: [
        {
          id: 'js-objects', language: 'javascript', title: 'Objects', level: 'beginner', minutes: 8,
          text: doc(
            'An **object** groups named values: `{ name: "NaCl", mass: 5.844 }`. Read with `sample.mass` or `sample["mass"]`, add or change with `sample.molarMass = 58.44`. `Object.keys(o)`, `Object.values(o)` and `Object.entries(o)` list the parts; `"key" in o` tests for one.',
            jsBlock(src`
              const sample = { name: "NaCl", mass: 5.844 };
              sample.molarMass = 58.44;
              for (const [key, value] of Object.entries(sample)) {
                console.log(key, "->", value);
              }
            `),
          ),
          task: 'Give `sample` a `molarMass` of 58.44, and write `moles(s)` that returns the mass divided by the molar mass of the object it gets.',
          code: src`
            const sample = { name: "NaCl", mass: 5.844 };

            function moles(s) {
              return 0;
            }

            console.log(sample, moles(sample));
          `,
          hint: 'sample.molarMass = 58.44;  and in moles:  return s.mass / s.molarMass;',
          solution: src`
            const sample = { name: "NaCl", mass: 5.844 };
            sample.molarMass = 58.44;

            function moles(s) {
              return s.mass / s.molarMass;
            }

            console.log(sample, moles(sample));
          `,
          checks: [
            { label: 'sample.molarMass is 58.44', test: 'sample.molarMass === 58.44 || "got " + sample.molarMass' },
            { label: 'moles(sample) is 0.1', test: 'Math.abs(moles(sample) - 0.1) < 1e-9 || "got " + moles(sample)' },
            { label: 'moles works for any object', test: 'moles({ mass: 10, molarMass: 20 }) === 0.5' },
          ],
        },
        {
          id: 'js-destructuring', language: 'javascript', title: 'Destructuring and spread', level: 'intermediate', minutes: 8,
          text: doc(
            '**Destructuring** unpacks arrays and objects into variables: `const [a, b] = list`, `const { name, mass } = sample`, and renaming `const { mass: m } = sample`. The **rest** `...` collects the remainder; the **spread** `...` copies items into a new array or object.',
            jsBlock(src`
              const [first, ...others] = [10, 20, 30];
              const { name, mass: m } = { name: "Fe", mass: 55.85 };
              const merged = { ...{ a: 1, b: 2 }, b: 3 };
              console.log(first, others, name, m, merged);
            `),
          ),
          task: 'Using destructuring and spread: `head` and `tail` from `values` (first value, the others), `symbol` from the `element` object, and `settings`: `defaults` overridden by `options`.',
          code: src`
            const values = [4, 8, 15, 16];
            const element = { symbol: "Fe", mass: 55.85 };
            const defaults = { unit: "g", digits: 2 };
            const options = { digits: 4 };

            let head, tail, symbol, settings;
            console.log(head, tail, symbol, settings);
          `,
          hint: 'const [head, ...tail] = values;  const { symbol } = element;  const settings = { ...defaults, ...options };  (delete the let line first)',
          solution: src`
            const values = [4, 8, 15, 16];
            const element = { symbol: "Fe", mass: 55.85 };
            const defaults = { unit: "g", digits: 2 };
            const options = { digits: 4 };

            const [head, ...tail] = values;
            const { symbol } = element;
            const settings = { ...defaults, ...options };
            console.log(head, tail, symbol, settings);
          `,
          checks: [
            { label: 'head is 4', test: 'head === 4 || "got " + head' },
            { label: 'tail is [8, 15, 16]', test: 'JSON.stringify(tail) === "[8,15,16]" || "got " + JSON.stringify(tail)' },
            { label: 'symbol is "Fe"', test: 'symbol === "Fe" || "got " + symbol' },
            { label: 'settings is { unit: "g", digits: 4 }', test: 'JSON.stringify(settings) === \'{"unit":"g","digits":4}\' || "got " + JSON.stringify(settings)' },
          ],
        },
        {
          id: 'js-json', language: 'javascript', title: 'JSON', level: 'intermediate', minutes: 8,
          text: doc(
            '**JSON** is the text format most web services and data files use. `JSON.stringify(value)` turns an object into text (`JSON.stringify(value, null, 2)` indents it); `JSON.parse(text)` turns text back into an object. Functions and `undefined` are dropped; invalid text throws a `SyntaxError`.',
            jsBlock(src`
              const text = '{"sample": "A", "values": [1, 2, 3]}';
              const data = JSON.parse(text);
              console.log(data.sample, data.values.length);
              console.log(JSON.stringify({ ok: true, n: 3 }));
            `),
          ),
          task: 'Parse `text` into `data`, collect the `name` of every entry of `data.items` in `names`, and make `copy`: the JSON text of `{ names }` with indentation of 2 spaces.',
          code: src`
            const text = '{"items": [{"name": "Na", "z": 11}, {"name": "Cl", "z": 17}, {"name": "K", "z": 19}]}';

            let data, names, copy;
            console.log(data, names, copy);
          `,
          hint: 'const data = JSON.parse(text); const names = data.items.map((i) => i.name); const copy = JSON.stringify({ names }, null, 2);',
          solution: src`
            const text = '{"items": [{"name": "Na", "z": 11}, {"name": "Cl", "z": 17}, {"name": "K", "z": 19}]}';

            const data = JSON.parse(text);
            const names = data.items.map((i) => i.name);
            const copy = JSON.stringify({ names }, null, 2);
            console.log(data, names, copy);
          `,
          checks: [
            { label: 'data has 3 items', test: 'Boolean(data && data.items && data.items.length === 3)' },
            { label: 'names is ["Na", "Cl", "K"]', test: 'JSON.stringify(names) === \'["Na","Cl","K"]\' || "got " + JSON.stringify(names)' },
            { label: 'copy is JSON text with 2-space indentation', test: 'typeof copy === "string" && copy.includes("\\n  \\"names\\"") && JSON.parse(copy).names.length === 3' },
          ],
        },
      ],
    },
    {
      id: 'js-advanced',
      title: 'Classes, errors, async',
      lessons: [
        {
          id: 'js-classes', language: 'javascript', title: 'Classes', level: 'intermediate', minutes: 10,
          text: doc(
            'A **class** is a blueprint for objects. `constructor` sets up a new one (`new Vector(3, 4)`), methods are functions on it, `this` is the object, and a `get` property is calculated when read. `extends` builds on another class.',
            jsBlock(src`
              class Point {
                constructor(x, y) {
                  this.x = x;
                  this.y = y;
                }
                get norm() {
                  return Math.hypot(this.x, this.y);
                }
              }
              console.log(new Point(3, 4).norm);   // 5
            `),
          ),
          task: 'Finish `Vector`: the method `add(other)` returns a **new** Vector (the sum), and the getter `length` returns the length (√(x²+y²)).',
          code: src`
            class Vector {
              constructor(x, y) {
                this.x = x;
                this.y = y;
              }

              add(other) {
                return this;
              }

              get length() {
                return 0;
              }
            }

            const v = new Vector(3, 4).add(new Vector(0, 0));
            console.log(v.length);
          `,
          hint: 'add: return new Vector(this.x + other.x, this.y + other.y);   length: return Math.hypot(this.x, this.y);',
          solution: src`
            class Vector {
              constructor(x, y) {
                this.x = x;
                this.y = y;
              }

              add(other) {
                return new Vector(this.x + other.x, this.y + other.y);
              }

              get length() {
                return Math.hypot(this.x, this.y);
              }
            }

            const v = new Vector(3, 4).add(new Vector(0, 0));
            console.log(v.length);
          `,
          checks: [
            { label: 'new Vector(3, 4).length is 5', test: 'new Vector(3, 4).length === 5 || "got " + new Vector(3, 4).length' },
            { label: 'add gives the sum (1,2)+(3,4) = (4,6)', test: '(() => { const s = new Vector(1, 2).add(new Vector(3, 4)); return s.x === 4 && s.y === 6; })()' },
            { label: 'add does not change the original', test: '(() => { const a = new Vector(1, 2); a.add(new Vector(5, 5)); return a.x === 1 && a.y === 2; })()' },
          ],
        },
        {
          id: 'js-errors', language: 'javascript', title: 'Errors and try/catch', level: 'intermediate', minutes: 8,
          text: doc(
            'When something fails JavaScript **throws** an error and stops, unless you catch it: `try { … } catch (error) { … } finally { … }`. Throw your own with `throw new RangeError("message")`. Errors have a `name` and a `message`.',
            jsBlock(src`
              try {
                JSON.parse("{not json}");
              } catch (error) {
                console.log(error.name + ": " + error.message);
              }
            `),
            'kCode shows an uncaught error with the line it came from; click the line number to jump there.',
          ),
          task: 'Write `divide(a, b)`: it returns a / b, but throws a `RangeError` when b is 0. Write `parseOr(text, fallback)`: the parsed JSON, or `fallback` if the text is not valid JSON.',
          code: src`
            function divide(a, b) {
              return a / b;
            }

            function parseOr(text, fallback) {
              return JSON.parse(text);
            }

            console.log(divide(6, 3), parseOr("[1,2]", null));
          `,
          hint: 'divide: if (b === 0) throw new RangeError("division by zero");  parseOr: wrap JSON.parse in try { … } catch { return fallback; }',
          solution: src`
            function divide(a, b) {
              if (b === 0) throw new RangeError("division by zero");
              return a / b;
            }

            function parseOr(text, fallback) {
              try {
                return JSON.parse(text);
              } catch {
                return fallback;
              }
            }

            console.log(divide(6, 3), parseOr("[1,2]", null));
          `,
          checks: [
            { label: 'divide(6, 3) is 2', test: 'divide(6, 3) === 2' },
            { label: 'divide(1, 0) throws a RangeError', test: '(() => { try { divide(1, 0); } catch (e) { return e instanceof RangeError || "threw " + e.name; } return "it did not throw"; })()' },
            { label: 'parseOr("[1,2]", null) is [1, 2]', test: 'JSON.stringify(parseOr("[1,2]", null)) === "[1,2]"' },
            { label: 'parseOr("{oops", 42) is 42', test: 'parseOr("{oops", 42) === 42' },
          ],
        },
        {
          id: 'js-promises', language: 'javascript', title: 'Promises and async/await', level: 'advanced', minutes: 12,
          text: doc(
            'Some things take time: a download, a timer. A **Promise** stands for a value that will arrive. `async` functions return promises, and `await` pauses until one is ready — in kCode, `await` also works at the top of your code.',
            jsBlock(src`
              const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

              async function main() {
                console.log("start");
                await pause(100);
                console.log("100 ms later");
              }
              await main();
            `),
            '`Promise.all([a, b, c])` waits for several promises at once and gives all results in order. `try { await … } catch (e) { … }` catches failures.',
          ),
          task: 'Write `wait(ms, value)`: it returns a promise that resolves to `value` after `ms` milliseconds. Then set `results` to what `Promise.all` gives for `wait(30, "a")`, `wait(10, "b")`, `wait(20, "c")`.',
          code: src`
            function wait(ms, value) {
              return null;
            }

            let results;
            console.log(results);
          `,
          hint: 'return new Promise((resolve) => setTimeout(() => resolve(value), ms));   results = await Promise.all([wait(30, "a"), wait(10, "b"), wait(20, "c")]);',
          solution: src`
            function wait(ms, value) {
              return new Promise((resolve) => setTimeout(() => resolve(value), ms));
            }

            const results = await Promise.all([wait(30, "a"), wait(10, "b"), wait(20, "c")]);
            console.log(results);
          `,
          checks: [
            { label: 'wait(5, "x") gives "x"', test: '(await wait(5, "x")) === "x"' },
            { label: 'results is ["a", "b", "c"] (in the order asked)', test: 'JSON.stringify(results) === \'["a","b","c"]\' || "got " + JSON.stringify(results)' },
          ],
        },
      ],
    },
  ],
}
