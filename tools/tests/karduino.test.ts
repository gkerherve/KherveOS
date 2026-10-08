// kArduino's pure logic: compiler output, serial plotter data, pin detection, boards,
// sketch tabs and the built-in examples. Run:
//   node --test tools/tests/karduino.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatBytes, normalizeResult, parseDiagnostics, parseSize, sizeBars } from '../../src/apps/karduino/build.ts'
import { PlotBuffer, linePath, niceTicks, parseLine, plotRange } from '../../src/apps/karduino/plotter.ts'
import { INT_PINS, PWM_PINS, detectPins, pinoutOf, stripCode } from '../../src/apps/karduino/pins.ts'
import { BOARDS, boardByFqbn, coreOf, familyOf, validFqbn } from '../../src/apps/karduino/boards.ts'
import { EXAMPLES, EXAMPLE_CATEGORIES, SNIPPETS, exampleById } from '../../src/apps/karduino/examples.ts'
import {
  balanced, detectBaud, includesOf, libraryForHeader, lineEnding, safeSketchName, serverNames, stamp, tabNameProblem, tabOf, toRequest,
} from '../../src/apps/karduino/sketch.ts'

const GCC = `/data/arduino/abc/sketch/sketch.ino: In function 'void loop()':
/data/arduino/abc/sketch/sketch.ino:7:3: error: 'digitlWrite' was not declared in this scope
   digitlWrite(13, HIGH);
/data/arduino/abc/sketch/util.h:2:10: warning: unused variable 'x' [-Wunused-variable]
/home/u/Arduino/libraries/Servo/src/Servo.h:12:5: warning: in a library
/data/arduino/abc/sketch/sketch.ino:9: fatal error: Missing.h: No such file or directory
`

// ------------------------------------------------------------------ compiler output

test('diagnostics: gcc lines become structured, own files are mapped', () => {
  const d = parseDiagnostics(GCC, ['sketch.ino', 'util.h'])
  assert.equal(d.length, 4)
  assert.deepEqual(d[0], { file: 'sketch.ino', line: 7, col: 3, severity: 'error', message: "'digitlWrite' was not declared in this scope" })
  assert.equal(d[1].file, 'util.h')
  assert.equal(d[1].severity, 'warning')
  assert.equal(d[2].external, true)
  assert.equal(d[3].severity, 'error')
  assert.equal(d[3].col, 1)
})

test('diagnostics: Windows paths, .ino.cpp and duplicates', () => {
  const win = parseDiagnostics("C:\\Users\\a\\Temp\\sketch\\sketch.ino:3:1: error: expected ';' before '}' token")
  assert.equal(win[0].file, 'sketch.ino')
  assert.equal(win[0].line, 3)
  assert.equal(parseDiagnostics('/t/sketch/sketch.ino.cpp:4:2: error: boom')[0].file, 'sketch.ino')
  assert.equal(parseDiagnostics('/t/sketch/sketch.ino:4:2: error: boom\n/t/sketch/sketch.ino:4:2: error: boom').length, 1)
  assert.deepEqual(parseDiagnostics('Sketch uses 12 bytes'), [])
})

test('size: flash and RAM with and without a maximum', () => {
  const out = `Sketch uses 924 bytes (2%) of program storage space. Maximum is 32256 bytes.
Global variables use 9 bytes (0%) of dynamic memory, leaving 2039 bytes for local variables. Maximum is 2048 bytes.`
  assert.deepEqual(parseSize(out), { flash: 924, flashMax: 32256, ram: 9, ramMax: 2048 })
  assert.deepEqual(parseSize('Sketch uses 100 bytes (1%) of program storage space.'), { flash: 100, flashMax: null })
  assert.equal(parseSize('error'), null)
  const bars = sizeBars(parseSize(out))
  assert.equal(bars.length, 2)
  assert.equal(bars[0].percent, 2.9)
  assert.equal(bars[1].label, 'Dynamic memory (RAM)')
  assert.equal(sizeBars(null).length, 0)
  assert.equal(formatBytes(924), '924 B')
  assert.equal(formatBytes(32256), '31.5 kB')
})

test('normalizeResult fills what an older server leaves out', () => {
  const r = normalizeResult({ ok: false, cli: true, output: GCC }, ['sketch.ino', 'util.h'])
  assert.equal(r.diagnostics.length, 4)
  const keep = normalizeResult({ ok: true, output: 'x', diagnostics: [], size: null }, ['sketch.ino'])
  assert.equal(keep.size, null)
  assert.equal(keep.cli, true)
})

// ----------------------------------------------------------------------- plotter

test('plotter: the line formats', () => {
  assert.deepEqual(parseLine('512'), [{ label: null, value: 512 }])
  assert.deepEqual(parseLine('1,2,3').map((r) => r.value), [1, 2, 3])
  assert.deepEqual(parseLine('1 2.5\t-3'), [{ label: null, value: 1 }, { label: null, value: 2.5 }, { label: null, value: -3 }])
  assert.deepEqual(parseLine('a:1 b:2'), [{ label: 'a', value: 1 }, { label: 'b', value: 2 }])
  assert.deepEqual(parseLine('temp=23.5, hum=40'), [{ label: 'temp', value: 23.5 }, { label: 'hum', value: 40 }])
  assert.deepEqual(parseLine('Temperature: 23.5 C'), [{ label: 'Temperature', value: 23.5 }])
  assert.deepEqual(parseLine('x:-1.5e2'), [{ label: 'x', value: -150 }])
  assert.equal(parseLine('hello world'), null)
  assert.equal(parseLine(''), null)
  assert.equal(parseLine('x1'), null)
})

test('plotter buffer: series, trimming, gaps and bounds', () => {
  const b = new PlotBuffer(3)
  assert.equal(b.bounds(), null)
  b.pushLine('a:1 b:10')
  b.pushLine('a:2 b:20')
  b.pushLine('a:3 b:30')
  b.pushLine('a:4 b:40 c:5')
  assert.deepEqual(b.names, ['a', 'b', 'c'])
  assert.equal(b.length, 3)
  assert.equal(b.total, 4)
  const cols = b.columns()
  assert.deepEqual(cols[0].values, [2, 3, 4])
  assert.deepEqual(cols[2].values.map((v) => (Number.isNaN(v) ? null : v)), [null, null, 5])
  assert.deepEqual(b.bounds(), { min: 2, max: 40 })
  assert.deepEqual(b.bounds(new Set(['b'])), { min: 2, max: 5 })
  assert.equal(b.pushLine('no number'), false)
  assert.ok(b.toCsv().startsWith('sample,a,b,c\n1,2,20,\n'))
  b.clear()
  assert.equal(b.length, 0)
  assert.deepEqual(b.names, [])
})

test('plotter buffer: unlabelled values are ch1, ch2…; keeps 300 points by default', () => {
  const b = new PlotBuffer()
  for (let i = 0; i < 500; i++) b.pushLine(`${i},${i * 2}`)
  assert.equal(b.length, 300)
  assert.deepEqual(b.names, ['ch1', 'ch2'])
  assert.equal(b.columns()[0].values[0], 200)
})

test('plotter: range, ticks, path', () => {
  assert.deepEqual(plotRange(null), { lo: 0, hi: 1 })
  const flat = plotRange({ min: 5, max: 5 })
  assert.ok(flat.lo < 5 && flat.hi > 5)
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100])
  assert.deepEqual(niceTicks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1])
  const d = linePath([1, 2, Number.NaN, 4], (i) => i * 10, (v) => v)
  assert.equal(d, 'M0.0 1.0L10.0 2.0M30.0 4.0')
})

// -------------------------------------------------------------------------- pins

const pinsOf = (code: string, family: 'uno' | 'mega' | 'other' = 'uno') => detectPins(code, family).pins.map((p) => p.pin)

test('pins: literals, LED_BUILTIN, #define, const int and analog', () => {
  assert.deepEqual(pinsOf('void setup(){ pinMode(7, OUTPUT); digitalWrite(7, HIGH); }'), ['D7'])
  assert.deepEqual(pinsOf('void setup(){ pinMode(LED_BUILTIN, OUTPUT); }'), ['D13'])
  assert.deepEqual(pinsOf('#define PIN 7\nvoid loop(){ digitalWrite(PIN, 1); }'), ['D7'])
  assert.deepEqual(pinsOf('const int led = 9;\nvoid loop(){ analogWrite(led, 10); int v = analogRead(A0); }'), ['D9', 'A0'])
  assert.deepEqual(pinsOf('int v = analogRead(2);'), ['A2'])
  assert.deepEqual(pinsOf('digitalWrite(14, HIGH);'), ['A0'])
})

test('pins: ignores comments and strings', () => {
  assert.deepEqual(pinsOf('// pinMode(3, OUTPUT)\nSerial.println("digitalWrite(4, HIGH)");'), [])
  assert.equal(stripCode('a // b\n"c" /* d\ne */ f').split('\n').length, 3)
})

test('pins: arrays, for loops, interrupts, servo, constructors', () => {
  assert.deepEqual(pinsOf('const int leds[] = {2, 4, 6};\nfor (int i = 0; i < 3; i++) { pinMode(leds[i], OUTPUT); }'), ['D2', 'D4', 'D6'])
  assert.deepEqual(pinsOf('for (int p = 2; p <= 5; p++) pinMode(p, OUTPUT);'), ['D2', 'D3', 'D4', 'D5'])
  const r = detectPins('attachInterrupt(digitalPinToInterrupt(2), f, FALLING); servo.attach(9);')
  assert.deepEqual(r.pins.map((p) => [p.pin, p.roles[0]]), [['D2', 'int'], ['D9', 'out']])
  assert.deepEqual(pinsOf('DHT dht(4, DHT11);'), ['D4'])
  assert.deepEqual(pinsOf('Stepper s(2048, 8, 10, 9, 11);'), ['D8', 'D9', 'D10', 'D11'])
})

test('pins: roles and lines', () => {
  const r = detectPins('void setup() {\n  pinMode(2, INPUT_PULLUP);\n}\nvoid loop() {\n  int a = digitalRead(2);\n}')
  assert.deepEqual(r.pins, [{ pin: 'D2', roles: ['in'], lines: [2, 5] }])
})

test('pins: facts and warnings (Uno/Nano)', () => {
  assert.deepEqual(PWM_PINS.uno, [3, 5, 6, 9, 10, 11])
  assert.deepEqual(INT_PINS.uno, [2, 3])
  assert.ok(detectPins('analogWrite(4, 100);').warnings[0].includes('not a PWM pin'))
  assert.equal(detectPins('analogWrite(5, 100);').warnings.length, 0)
  assert.ok(detectPins('attachInterrupt(digitalPinToInterrupt(7), f, RISING);').warnings[0].includes('external interrupt'))
  assert.ok(detectPins('pinMode(40, OUTPUT);').warnings[0].includes('does not exist'))
  assert.ok(detectPins('void setup(){ Serial.begin(9600); pinMode(1, OUTPUT); }').warnings.some((w) => w.includes('USB serial')))
  const bus = detectPins('#include <Wire.h>\nvoid setup(){ Wire.begin(); }')
  assert.deepEqual(bus.pins.map((p) => p.pin), ['A4', 'A5'])
  assert.deepEqual(pinsOf('Wire.begin();', 'mega'), ['D20', 'D21'])
  assert.deepEqual(pinsOf('digitalWrite(30, HIGH); analogRead(A12);', 'mega'), ['D30', 'A12'])
})

test('pinout: Uno has 14 digital and 6 analog pins with the right tags', () => {
  const [digital, analog] = pinoutOf('uno')
  assert.equal(digital.pins.length, 14)
  assert.equal(analog.pins.length, 6)
  assert.deepEqual(digital.pins.filter((p) => p.pwm).map((p) => p.label), ['3', '5', '6', '9', '10', '11'])
  assert.deepEqual(digital.pins[2].tags, ['INT0'])
  assert.deepEqual(digital.pins[3].tags, ['PWM', 'INT1'])
  assert.deepEqual(analog.pins[4].tags, ['SDA'])
  assert.deepEqual(analog.pins[5].tags, ['SCL'])
  assert.equal(pinoutOf('other').length, 0)
  const mega = pinoutOf('mega')
  assert.equal(mega.reduce((n, g) => n + g.pins.length, 0), 54 + 16)
})

// ------------------------------------------------------------------------ boards

test('boards: FQBNs are valid, unique, and match the server list', () => {
  const fqbns = BOARDS.map((b) => b.fqbn)
  assert.equal(new Set(fqbns).size, fqbns.length)
  for (const f of fqbns) assert.ok(validFqbn(f), f)
  assert.equal(validFqbn('uno'), false)
  assert.equal(validFqbn('arduino:avr:uno --upload'), false)
  assert.equal(coreOf('arduino:avr:nano:cpu=atmega328'), 'arduino:avr')
  assert.equal(familyOf('arduino:avr:uno'), 'uno')
  assert.equal(familyOf('arduino:avr:mega:cpu=atmega2560'), 'mega')
  assert.equal(familyOf('esp32:esp32:esp32'), 'other')
  assert.equal(familyOf('arduino:avr:nano'), 'uno')
  assert.equal(boardByFqbn('arduino:avr:uno')?.name, 'Arduino Uno')
  const py = readFileSync(new URL('../../server/kherveos_server/arduino.py', import.meta.url), 'utf8')
  const server = [...py.slice(py.indexOf('CURATED_BOARDS')).split(']\n')[0].matchAll(/"fqbn": "([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(server.sort(), [...fqbns].sort())
})

// ------------------------------------------------------------------- sketch tabs

test('sketch: tab names, sketch names, request body', () => {
  assert.equal(tabNameProblem('util.h', []), null)
  assert.equal(tabNameProblem('Motor_2.cpp', ['util.h']), null)
  for (const bad of ['', '../x.h', 'a/b.h', 'x.txt', 'noext', '.hidden.h', 'a b.h', 'x..h', 'sketch.ino']) assert.notEqual(tabNameProblem(bad, []), null, bad)
  assert.notEqual(tabNameProblem('UTIL.H', ['util.h']), null)
  assert.notEqual(tabNameProblem('blink.ino', [], 'blink.ino'), null)
  assert.equal(safeSketchName('My sketch!.ino'), 'My_sketch')
  assert.equal(safeSketchName('///'), 'sketch')
  const files = [{ name: 'blink.ino', content: 'main' }, { name: 'util.h', content: 'h' }]
  assert.deepEqual(toRequest(files, 'arduino:avr:uno'), { code: 'main', files: [{ name: 'util.h', content: 'h' }], board: 'arduino:avr:uno' })
  assert.deepEqual(serverNames(files), ['sketch.ino', 'util.h'])
  assert.equal(tabOf(files, 'sketch.ino'), 0)
  assert.equal(tabOf(files, 'util.h'), 1)
  assert.equal(tabOf(files, 'nope.h'), -1)
})

test('sketch: helpers', () => {
  assert.equal(detectBaud('void setup(){ Serial.begin(115200); }'), 115200)
  assert.equal(detectBaud('// Serial.begin(9600)\nvoid setup(){}'), null)
  assert.deepEqual(includesOf('#include <Servo.h>\n  #include <Adafruit_NeoPixel.h>\n#include "mine.h"\n#include <Servo.h>'), ['Servo', 'Adafruit_NeoPixel'])
  assert.equal(libraryForHeader('Adafruit_NeoPixel'), 'Adafruit NeoPixel')
  assert.equal(libraryForHeader('DHT'), 'DHT sensor library')
  assert.equal(libraryForHeader('Some_Lib'), 'Some Lib')
  assert.equal(lineEnding('crnl'), '\r\n')
  assert.equal(lineEnding('none'), '')
  assert.match(stamp(0), /^\d\d:\d\d:\d\d\.\d{3}$/)
  assert.equal(balanced('void f() { if (a[1]) { "}" ; } } } // {'), false)
  assert.equal(balanced('void f() { char c = \'{\'; String s = "}"; /* ) */ }'), true)
})

// ---------------------------------------------------------------------- examples

test('examples: at least 25, complete, unique, balanced', () => {
  assert.ok(EXAMPLES.length >= 25, `${EXAMPLES.length} examples`)
  const ids = new Set<string>()
  for (const e of EXAMPLES) {
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`)
    ids.add(e.id)
    assert.ok(e.title.length > 2, e.id)
    assert.ok(e.description.length > 10, e.id)
    assert.ok(e.wiring.length > 10, `${e.id} wiring`)
    assert.ok(validFqbn(e.board), `${e.id} board`)
    assert.match(e.code, /void\s+setup\s*\(\s*\)/, `${e.id} setup`)
    assert.match(e.code, /void\s+loop\s*\(\s*\)/, `${e.id} loop`)
    assert.ok(balanced(e.code), `${e.id} braces`)
    assert.ok(e.code.endsWith('\n'), `${e.id} newline`)
    assert.ok(Array.isArray(e.libraries), e.id)
    assert.equal(exampleById(e.id), e)
  }
  assert.ok(EXAMPLE_CATEGORIES.length >= 5)
})

test('examples: the libraries they need are named, and their pins can be found', () => {
  for (const id of ['servo', 'dht', 'lcd', 'neopixel', 'stepper']) assert.ok(exampleById(id)!.libraries.length > 0, id)
  assert.deepEqual(exampleById('dht')!.libraries, ['DHT sensor library', 'Adafruit Unified Sensor'])
  for (const e of EXAMPLES) {
    const hasPinCalls = /pinMode|analogRead|digitalWrite|Stepper|Adafruit_NeoPixel|DHT\s/.test(e.code)
    const r = detectPins(e.code, 'uno')
    if (hasPinCalls) assert.ok(r.pins.length > 0, `${e.id} has detectable pins`)
    assert.deepEqual(r.warnings, [], `${e.id}: ${r.warnings.join('; ')}`)
  }
  assert.deepEqual(pinsOf(exampleById('knight-rider')!.code), ['D2', 'D3', 'D4', 'D5', 'D6', 'D7'])
  assert.deepEqual(pinsOf(exampleById('hcsr04')!.code), ['D0', 'D1', 'D9', 'D10'])
})

test('snippets: unique ids, balanced', () => {
  assert.ok(SNIPPETS.length >= 10)
  assert.equal(new Set(SNIPPETS.map((s) => s.id)).size, SNIPPETS.length)
  for (const s of SNIPPETS) assert.ok(balanced(s.code), s.id)
})
