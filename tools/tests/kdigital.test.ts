// kDigital: the Boolean tools (parser, Quine–McCluskey, Karnaugh maps), the four-valued event simulator, net
// extraction, the editor operations, the .kdig file, every example (loaded, wired as intended and simulated against
// the behaviour it documents), state machines, number systems, the HDL export, timing diagrams and the AI tools.
// No browser. Run:
//   node --test tools/tests/kdigital.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  C0, C1, and, equivalent, evaluate, format, normalize, not, nand, nor, or, parse, ParseError, toBasic, toNandOnly, toNorOnly, truthVector, variables, v as varNode, xor, gateStats, tryParse,
  type Node,
} from '../../src/apps/kdigital/expr.ts'
import { minimize, minimizeBoth, canonicalPos, canonicalSop, implicantBits, termNode, sigmaText, piText, type Implicant } from '../../src/apps/kdigital/qmc.ts'
import { analyse, nextCell, parseFunctionLine, parseFunctions, tableFromNodes, tableToText, type Cell } from '../../src/apps/kdigital/truth.ts'
import { groupRects, hazardFreeCover, kmapCells, kmapGroups, kmapLayout, staticOneHazards } from '../../src/apps/kdigital/kmap.ts'
import { resolve as resolveNet, vand, vnot, vor, vxor, vparse, numberOf, bitsOf, type V } from '../../src/apps/kdigital/logic.ts'
import { Simulator, DEFAULT_SIM, circuitTable, parseMemory, readSettings, type SimSettings } from '../../src/apps/kdigital/sim.ts'
import { Builder, intendedGroups } from '../../src/apps/kdigital/builder.ts'
import { extractNets, resolveTarget } from '../../src/apps/kdigital/netlist.ts'
import { KIND_LIST, KIND_DEFS, emptyDoc, newPart, pinPositions, partBounds, shapeOf, toWorld, HEX_SEGMENTS, SEGMENT_NAMES, type Doc, type Kind } from '../../src/apps/kdigital/model.ts'
import {
  History, cloneDoc, copyItems, deleteItems, docBounds, hitPart, hitPin, hitWire, itemsInBox, junctions, mirrorItems, moveItems, pasteClip, rotateItems, searchParts, splitWires, addPath, route, stubToNet,
} from '../../src/apps/kdigital/editor.ts'
import { parseKdig, serializeKdig, parseDoc, canonicalIds, emptyFile, type KdigFile } from '../../src/apps/kdigital/file.ts'
import { EXAMPLES, exampleById } from '../../src/apps/kdigital/examples.ts'
import { kdigitalExampleFiles, KDIGITAL_EXAMPLES_FOLDER } from '../../src/apps/kdigital/exampleFiles.ts'
import { addLogic, circuitFunctions, expressionsToDoc, styled } from '../../src/apps/kdigital/layout.ts'
import {
  analyseFsm, assignStates, deriveEquations, emptyFsm, fsmToCircuit, fsmWave, patternMatches, sequenceDetector, simulateFsm, transitionGeometry, condHolds, checkCondition, type Fsm, type Encoding,
} from '../../src/apps/kdigital/fsm.ts'
import * as N from '../../src/apps/kdigital/numbers.ts'
import { toVerilog, toVhdl, verilogTestbench, vhdlTestbench, fsmToVerilog, fsmToVhdl, fsmVerilogTestbench, fsmVhdlTestbench, sanitize } from '../../src/apps/kdigital/hdl.ts'
import { busText, defaultProbes, parseStimulus, probeTextAt, stimulusText, waveJson, type Probe } from '../../src/apps/kdigital/wave.ts'
import { runSpec, summarizeRun, findGlitches } from '../../src/apps/kdigital/session.ts'
import { docToSvg, DARK_COLORS } from '../../src/apps/kdigital/svg.ts'
import { livePrims, partPrims } from '../../src/apps/kdigital/display.ts'
import { analyseExpressions, describeCircuit, kdigitalTools, type Hooks } from '../../src/apps/kdigital/aiTools.ts'
import { KDIGITAL_TOOL_SET } from '../../src/os/ai/manifests/kdigital.ts'
import { kdigitalOutputs, indexText } from '../export_kdigital_examples.ts'
import { exampleFileName, readExampleIndex } from '../../src/os/exampleFiles.ts'

// ------------------------------------------------------------------------------ helpers

function prng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const VARS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const bitsMsb = (n: number, w: number): number[] => Array.from({ length: w }, (_, i) => (n >> (w - 1 - i)) & 1)

function randomNode(rnd: () => number, vars: string[], depth: number): Node {
  if (depth === 0 || rnd() < 0.2) {
    const r = rnd()
    if (r < 0.05) return rnd() < 0.5 ? C0 : C1
    const x = varNode(vars[Math.floor(rnd() * vars.length)])
    return rnd() < 0.3 ? not(x) : x
  }
  const kind = ['and', 'or', 'xor', 'not', 'nand', 'nor', 'xnor'][Math.floor(rnd() * 7)]
  if (kind === 'not') return not(randomNode(rnd, vars, depth - 1))
  const n = 2 + Math.floor(rnd() * 2)
  return { t: kind as 'and', a: Array.from({ length: n }, () => randomNode(rnd, vars, depth - 1)) }
}

const covers = (i: Implicant, m: number) => (m & ~i.mask) === i.value
const fnOf = (cover: Implicant[]) => (m: number) => cover.some((i) => covers(i, m))

// ------------------------------------------------------------------------------ four-valued logic

test('four-valued logic: unknowns, dominating values and bus resolution', () => {
  assert.equal(vand([0, 2]), 0, 'a 0 dominates AND')
  assert.equal(vand([1, 2]), 2)
  assert.equal(vand([1, 3]), 2, 'Z is read as unknown')
  assert.equal(vor([1, 2]), 1, 'a 1 dominates OR')
  assert.equal(vor([0, 2]), 2)
  assert.equal(vxor([1, 1, 1]), 1)
  assert.equal(vxor([1, 2]), 2)
  assert.equal(vnot(0), 1)
  assert.equal(vnot(3), 2)
  assert.equal(resolveNet([3, 3]), 3, 'nobody drives: Z')
  assert.equal(resolveNet([1, 3]), 1, 'Z gives way')
  assert.equal(resolveNet([1, 1]), 1)
  assert.equal(resolveNet([0, 1]), 2, 'a conflict is X')
  assert.equal(vparse('x'), 2)
  assert.equal(vparse('Z'), 3)
  assert.equal(numberOf(bitsOf(11, 4)), 11)
  assert.equal(numberOf([1, 2]), null)
})

// ------------------------------------------------------------------------------ expressions

test('the parser reads every notation of the brief', () => {
  const same = (a: string, b: string) => assert.ok(equivalent(parse(a), parse(b)).equal, `${a}  ≡  ${b}`)
  same('A & B | !C', 'A AND B OR NOT C')
  same('A & B | !C', "A B + C'")
  same("A'B + AB'", 'A ^ B')
  same('~A', "A'")
  same('A^B', 'A XOR B')
  same('A * B', 'A·B')
  same("(A+B)'", '!A & !B')
  same("A''", 'A')
  same('AB', 'A & B')
  same('A NAND B', '!(A & B)')
  same('A NOR B', '!(A | B)')
  same('A XNOR B', "(A ^ B)'")
  same('A(B+C)', 'A&B | A&C')
  same('(A+B)(C+D)', '(A|B)&(C|D)')
  same('A + B && C', 'A | (B & C)')
  same('1 & A', 'A')
  same('0 | A', 'A')
  same('!!A', 'A')
  same('A | B ^ C & D', 'A | (B ^ (C & D))') // AND binds tighter than XOR, XOR tighter than OR
  same('Cin & (A ^ B) | A & B', '(A & B) | (Cin & (A ^ B))')
  assert.deepEqual(variables(parse('Cin & (A ^ B)')), ['A', 'B', 'Cin'])
  assert.deepEqual(variables(parse('Q10 & Q2 | Q1')), ['Q1', 'Q2', 'Q10'], 'natural order')
  // multi-letter names are kept whole when they are mixed case, or listed as names
  assert.deepEqual(variables(parse('Sum & Cin')), ['Cin', 'Sum'])
  assert.deepEqual(variables(parse('CLK & EN', { names: ['CLK', 'EN'] })), ['CLK', 'EN'])
  assert.deepEqual(variables(parse('CLK & EN', { splitUpper: false })), ['CLK', 'EN'])
  assert.deepEqual(variables(parse('ABC')), ['A', 'B', 'C'], 'textbook notation')
})

test('parse errors say what is wrong and where', () => {
  const bad = (text: string, re: RegExp) => {
    const r = tryParse(text)
    assert.ok('error' in r, `${text} is rejected`)
    assert.match(r.error, re)
  }
  bad('', /Type an expression/)
  bad('A &', /ends too early/)
  bad('(A | B', /closing bracket is missing/)
  bad('A | B)', /closing bracket too many/)
  bad('A $ B', /Unexpected/)
  bad('2 & A', /not a name or a constant/)
  bad('A -> B', /Implication/)
  const r = tryParse('A & | B')
  assert.ok('error' in r && r.pos === 4, 'the position of the stray operator')
  assert.throws(() => parse('A &&& B'), ParseError)
})

test('printing: every style reads back as the same function', () => {
  const rnd = prng(7)
  const vars = ['A', 'B', 'C', 'D']
  for (let i = 0; i < 120; i++) {
    const n = randomNode(rnd, vars, 4)
    for (const style of ['prime', 'bang', 'words', 'verilog', 'vhdl', 'math'] as const) {
      const text = format(n, style)
      // the printed text uses only operators the parser knows (the math style uses symbols it accepts too)
      const back = parse(text, style === 'prime' ? {} : { splitUpper: false })
      const names = variables([n, back])
      assert.deepEqual(Array.from(truthVector(n, names)), Array.from(truthVector(back, names)), `${style}: ${text}`)
    }
  }
  assert.equal(format(parse("A'B + C")), "A'B + C")
  assert.equal(format(parse('A & !B | C'), 'bang'), 'A & !B | C')
  assert.equal(format(parse('(A | B) & C'), 'verilog'), '(A | B) & C')
  assert.equal(format(parse('!(A & B)'), 'vhdl'), 'not (A and B)')
  assert.equal(format(parse('Cin & A')), 'Cin · A', 'multi-letter names are not run together')
})

test('normalising keeps the function and simplifies', () => {
  const rnd = prng(11)
  for (let i = 0; i < 150; i++) {
    const n = randomNode(rnd, ['A', 'B', 'C'], 4)
    const m = normalize(n)
    assert.ok(equivalent(n, m).equal, format(n))
    assert.ok(equivalent(n, toBasic(n)).equal)
  }
  assert.equal(format(normalize(parse('A & A & 1'))), 'A')
  assert.equal(format(normalize(parse("A & !A"))), '0')
  assert.equal(format(normalize(parse('A | !A'))), '1')
  assert.equal(format(normalize(parse('A ^ A'))), '0')
  assert.equal(format(normalize(parse('!!A'))), 'A')
  assert.equal(format(normalize(parse('A | (B | C)'))), 'A + B + C')
})

test('NAND-only and NOR-only forms are equivalent and use only those gates', () => {
  const rnd = prng(3)
  const onlyGate = (n: Node, kind: 'nand' | 'nor'): boolean => (n.t === 'var' || n.t === 'const' ? true : n.t === kind ? n.a.every((c) => onlyGate(c, kind)) : false)
  for (let i = 0; i < 200; i++) {
    const n = randomNode(rnd, ['A', 'B', 'C'], 3)
    const a = toNandOnly(n)
    const b = toNorOnly(n)
    assert.ok(equivalent(n, a).equal, `NAND: ${format(n)}`)
    assert.ok(equivalent(n, b).equal, `NOR: ${format(n)}`)
    assert.ok(onlyGate(a, 'nand'), 'only NAND gates')
    assert.ok(onlyGate(b, 'nor'), 'only NOR gates')
  }
  assert.equal(gateStats(toNandOnly(parse('A & B'))).gates, 2, 'an AND is a NAND and an inverter (a one-input NAND)')
  assert.equal(gateStats(toNandOnly(parse('A ^ B'))).gates, 4, 'the four-NAND exclusive OR')
})

test('equivalence checking finds a counter-example', () => {
  assert.ok(equivalent(parse("A'B + AB'"), parse('A ^ B')).equal)
  assert.ok(equivalent(parse("(A+B)'"), parse("A'B'")).equal, 'De Morgan')
  assert.ok(equivalent(parse('AB + A\'C + BC'), parse('AB + A\'C')).equal, 'the consensus term is redundant')
  const r = equivalent(parse('A & B'), parse('A | B'))
  assert.equal(r.equal, false)
  assert.ok(r.counterexample)
  assert.notEqual(evaluate(parse('A & B'), r.counterexample!), evaluate(parse('A | B'), r.counterexample!))
  assert.deepEqual(equivalent(parse('A'), parse('B & 1')).vars, ['A', 'B'])
})

// ------------------------------------------------------------------------------ Quine–McCluskey

test('QMC: the textbook example with don\'t-cares', () => {
  // F = Σm(4,8,10,11,12,15) + d(9,14)
  const r = minimize(4, [4, 8, 10, 11, 12, 15], [9, 14])
  const bits = r.primes.map((p) => implicantBits(p, 4)).sort()
  assert.deepEqual(bits, ['-100', '1--0', '1-1-', '10--'], 'the four prime implicants')
  const ess = r.essential.map((p) => implicantBits(p, 4)).sort()
  assert.deepEqual(ess, ['-100', '1-1-'], "BC'D' and AC are essential")
  assert.equal(r.cover.length, 3)
  const f = fnOf(r.cover)
  for (const m of [4, 8, 10, 11, 12, 15]) assert.ok(f(m), `covers ${m}`)
  for (const m of [0, 1, 2, 3, 5, 6, 7, 13]) assert.ok(!f(m), `does not cover ${m}`)
  assert.equal(r.coveredByEssentials, false)
  assert.equal(r.chart.length, 4, 'one chart row per prime')
  assert.equal(r.chart[0].length, 6, 'one column per minterm')
  // minterm 4 (only -100) and 15 (only 1-1-) have a single prime; 12 is also in -100 but 1--0 covers it too
  assert.deepEqual(r.essentialColumns.map((c) => r.on[c]), [4, 15])
})

test('QMC: the standard results', () => {
  const sop = (n: number, on: number[], dc: number[] = []) => {
    const vars = VARS.slice(0, n)
    return format(minimizeBoth(vars, on, dc).sopNode)
  }
  assert.equal(sop(3, [3, 5, 6, 7]), 'AB + AC + BC', 'majority')
  assert.equal(sop(2, [1, 2]), "A'B + AB'", 'XOR cannot be reduced')
  assert.equal(sop(3, [0, 1, 2, 3, 4, 5, 6, 7]), '1')
  assert.equal(sop(3, []), '0')
  assert.equal(sop(3, [0, 1, 2], [3, 4, 5, 6, 7]), '1', 'with don\'t-cares everywhere it is constant 1')
  assert.equal(sop(4, [0, 2, 8, 10]), "B'D'", 'the four corners')
  assert.equal(sop(4, [0, 1, 2, 5, 6, 7, 8, 9, 10, 14]).split('+').length, 3, 'three terms')
  // all-ones except one cell
  assert.equal(sop(3, [0, 1, 2, 3, 4, 5, 6]), "A' + B' + C'")
  // BCD digits: segment e is on for 0, 2, 6, 8 (don't-cares 10–15): B'D' + CD'
  const e = minimizeBoth(['D3', 'D2', 'D1', 'D0'], [0, 2, 6, 8], [10, 11, 12, 13, 14, 15])
  assert.equal(e.sop.cover.length, 2)
  // Σm(1,2,4,7) is the three-input XOR: four terms
  assert.equal(minimize(3, [1, 2, 4, 7]).cover.length, 4)
})

test('QMC: random functions give a correct, minimal cover (against brute force)', () => {
  const rnd = prng(2024)
  for (let trial = 0; trial < 160; trial++) {
    const n = 2 + Math.floor(rnd() * 3) // 2..4 variables
    const size = 1 << n
    const on: number[] = [], dc: number[] = [], off: number[] = []
    for (let m = 0; m < size; m++) { const r = rnd(); if (r < 0.4) on.push(m); else if (r < 0.55) dc.push(m); else off.push(m) }
    const res = minimize(n, on, dc)
    const f = fnOf(res.cover)
    for (const m of on) assert.ok(f(m), `trial ${trial}: ${m} is covered`)
    for (const m of off) assert.ok(!f(m), `trial ${trial}: ${m} is not covered`)
    // every prime implicant is a valid implicant, and none is contained in another
    for (const p of res.primes) for (const m of p.minterms) assert.ok(!off.includes(m), 'a prime never contains an off-set minterm')
    for (const p of res.primes) for (const q of res.primes) if (p !== q) assert.ok(!(q.minterms.every((m) => p.minterms.includes(m))), 'primes are maximal')
    // brute force: the fewest primes that cover the on-set
    if (on.length > 0 && res.primes.length <= 14) {
      let best = Infinity
      for (let mask = 1; mask < 1 << res.primes.length; mask++) {
        const chosen = res.primes.filter((_, i) => (mask >> i) & 1)
        if (on.every((m) => chosen.some((p) => covers(p, m)))) best = Math.min(best, chosen.length)
      }
      assert.equal(res.cover.length, best, `trial ${trial}: minimal number of terms (${on}|${dc})`)
    }
    // the product of sums equals the function on the care set
    const both = minimizeBoth(VARS.slice(0, n), on, dc)
    for (const m of [...on, ...off]) {
      const env: Record<string, number> = {}
      VARS.slice(0, n).forEach((v, k) => { env[v] = (m >> (n - 1 - k)) & 1 })
      const want = on.includes(m) ? 1 : 0
      assert.equal(evaluate(both.sopNode, env), want, 'SOP')
      assert.equal(evaluate(both.posNode, env), want, 'POS')
    }
  }
})

test('QMC: eight variables and canonical forms', () => {
  const vars = VARS
  const rnd = prng(5)
  const on: number[] = []
  for (let m = 0; m < 256; m++) if (rnd() < 0.3) on.push(m)
  const t0 = Date.now()
  const r = minimizeBoth(vars, on)
  assert.ok(Date.now() - t0 < 20000, 'eight variables finish quickly')
  const f = fnOf(r.sop.cover)
  for (let m = 0; m < 256; m++) assert.equal(f(m), on.includes(m))
  const a = analyse(['A', 'B', 'C'], 'F', [0, 0, 0, 1, 0, 1, 1, 1])
  assert.equal(format(a.canonicalSop), "A'BC + AB'C + ABC' + ABC")
  assert.equal(format(a.canonicalPos), '(A + B + C)(A + B + C\')(A + B\' + C)(A\' + B + C)')
  assert.equal(a.sigma, 'Σm(3, 5, 6, 7)')
  assert.equal(a.pi, 'ΠM(0, 1, 2, 4)')
  assert.equal(sigmaText([1, 2], [5]), 'Σm(1, 2) + d(5)')
  assert.equal(piText([0], [1]), 'ΠM(0) · d(1)')
  assert.equal(format(canonicalSop(['A'], [])), '0')
  assert.equal(format(canonicalPos(['A'], [])), '1')
  assert.equal(format(termNode({ value: 0b101, mask: 0b010, minterms: [] }, ['A', 'B', 'C'])), 'AC')
})

// ------------------------------------------------------------------------------ truth tables

test('function lines: expressions, minterm lists, don\'t-cares and maxterms', () => {
  const f = parseFunctions('F = A & B | !C\nG(A,B,C) = Σm(1,2,4,7)\nH = m(0,3) + d(5)\nK(A,B) = ΠM(0,3)\n# a comment\n')
  assert.deepEqual(f.errors, [])
  assert.deepEqual(f.table.vars, ['A', 'B', 'C'])
  assert.deepEqual(f.table.outputs.map((o) => o.name), ['F', 'G', 'H', 'K'])
  const g = f.table.outputs[1].values
  assert.deepEqual(g.flatMap((v, i) => (v === 1 ? [i] : [])), [1, 2, 4, 7])
  const h = f.table.outputs[2].values
  assert.equal(h[5], 2, 'don\'t-care')
  assert.deepEqual(h.flatMap((v, i) => (v === 1 ? [i] : [])), [0, 3])
  assert.equal(parseFunctionLine('Y = A^B', 'F').name, 'Y')
  assert.equal(parseFunctionLine('A^B', 'F').name, 'F')
  assert.deepEqual(parseFunctions('F = A &').errors.map((e) => e.line), [1])
  const big = parseFunctions('F(A,B,C,D,E,F,G,H,I) = m(1)')
  assert.ok(big.errors.some((e) => /At most 8/.test(e.message)))
  const range = parseFunctions('F = m(1-3)')
  assert.deepEqual(range.table.outputs[0].values.flatMap((v, i) => (v === 1 ? [i] : [])), [1, 2, 3])
  assert.equal(nextCell(0), 1); assert.equal(nextCell(1), 2); assert.equal(nextCell(2), 0)
  const text = tableToText(f.table)
  assert.match(text, /^F\(A,B,C\) = Σm\(/)
  assert.deepEqual(parseFunctions(text).table.outputs.map((o) => o.values), f.table.outputs.map((o) => o.values), 'the table text parses back')
})

test('truth tables of expressions', () => {
  const t = tableFromNodes([{ name: 'S', node: parse('A^B') }, { name: 'C', node: parse('A&B') }])
  assert.deepEqual(t.vars, ['A', 'B'])
  assert.deepEqual(t.outputs[0].values, [0, 1, 1, 0])
  assert.deepEqual(t.outputs[1].values, [0, 0, 0, 1])
  assert.throws(() => tableFromNodes([{ name: 'F', node: parse('A&B&C&D&E&F&G&H&I') }]), /limited to 8/)
})

// ------------------------------------------------------------------------------ Karnaugh maps

test('K-map layout: Gray code order and the cell ↔ minterm mapping', () => {
  const l4 = kmapLayout(['A', 'B', 'C', 'D'])
  assert.deepEqual(l4.rowLabels, ['00', '01', '11', '10'])
  assert.deepEqual(l4.colLabels, ['00', '01', '11', '10'])
  assert.equal(l4.cell(0, 2, 3), 0b1110, 'row 11, column 10 → ABC\'D... A=1,B=1,C=1,D=0')
  const l3 = kmapLayout(['A', 'B', 'C'])
  assert.deepEqual([l3.rows, l3.cols], [2, 4])
  assert.deepEqual(l3.colLabels, ['00', '01', '11', '10'])
  const l5 = kmapLayout(['A', 'B', 'C', 'D', 'E'])
  assert.deepEqual([l5.layers, l5.rows, l5.cols], [2, 4, 4])
  assert.deepEqual(l5.layerVars, ['A'])
  assert.throws(() => kmapLayout(['A']), /2 to 5/)
  assert.throws(() => kmapLayout(VARS.slice(0, 6)), /2 to 5/)
  for (const n of [2, 3, 4, 5]) {
    const l = kmapLayout(VARS.slice(0, n))
    const seen = new Set<number>()
    for (let a = 0; a < l.layers; a++) for (let r = 0; r < l.rows; r++) for (let c = 0; c < l.cols; c++) {
      const m = l.cell(a, r, c)
      seen.add(m)
      assert.deepEqual(l.where(m), { layer: a, row: r, col: c }, 'where is the inverse of cell')
      // neighbours differ in one bit (also around the edge)
      const right = l.cell(a, r, (c + 1) % l.cols)
      if (l.cols > 2) assert.equal(popcount(m ^ right), 1, 'columns are Gray-coded')
      const down = l.cell(a, (r + 1) % l.rows, c)
      if (l.rows > 2) assert.equal(popcount(m ^ down), 1, 'rows are Gray-coded')
    }
    assert.equal(seen.size, 1 << n, 'every minterm has exactly one cell')
  }
})

function popcount(x: number) { let c = 0; while (x) { c += x & 1; x >>= 1 } return c }

test('K-map groups cover exactly the on-set (random functions of 2–5 variables)', () => {
  const rnd = prng(99)
  for (let trial = 0; trial < 120; trial++) {
    const n = 2 + (trial % 4)
    const vars = VARS.slice(0, n)
    const size = 1 << n
    const values: Cell[] = Array.from({ length: size }, () => { const r = rnd(); return (r < 0.4 ? 1 : r < 0.5 ? 2 : 0) as Cell })
    const a = analyse(vars, 'F', values)
    const layout = kmapLayout(vars)
    const groups = kmapGroups(a.min.sop.cover, layout)
    const covered = new Set<number>()
    for (const g of groups) {
      // a group is a power of two
      assert.ok(Number.isInteger(Math.log2(g.implicant.minterms.length)), 'group sizes are powers of two')
      // the rectangles draw exactly the group's cells
      const drawn = new Set<number>()
      for (const rect of g.rects) {
        for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) drawn.add(layout.cell(rect.layer, r, c))
      }
      assert.deepEqual([...drawn].sort((x, y) => x - y), [...g.implicant.minterms].sort((x, y) => x - y), `rectangles of ${g.bits}`)
      for (const m of g.implicant.minterms) { assert.notEqual(values[m], 0, 'no group touches an off-set cell'); covered.add(m) }
    }
    for (let m = 0; m < size; m++) if (values[m] === 1) assert.ok(covered.has(m), `minterm ${m} is in a group`)
    for (let m = 0; m < size; m++) if (values[m] === 0) assert.ok(!covered.has(m))
  }
  // a group that wraps around the edge is drawn in two pieces with open sides
  const wrap = groupRects({ value: 0b0000, mask: 0b0101, minterms: [0, 1, 4, 5] }, kmapLayout(['A', 'B', 'C', 'D']))
  assert.ok(wrap.length >= 1)
  const corners = groupRects({ value: 0b0000, mask: 0b1010, minterms: [0, 2, 8, 10] }, kmapLayout(['A', 'B', 'C', 'D']))
  assert.equal(corners.length, 4, 'the four corners are four pieces')
  assert.ok(corners.every((c) => (c.openTop || c.openBottom) && (c.openLeft || c.openRight)))
  const cells = kmapCells(['A', 'B'], [0, 1, 1, 2])
  assert.equal(cells.cells[0][1][1].v, 2)
})

test('hazards: a cover that misses neighbouring ones is flagged, and the consensus term fixes it', () => {
  // F = AB + A'C : minterms 3 (A'BC), 5 (AB'C), 6 (ABC'), 7 (ABC) — 3 and 7 are neighbours in different terms
  const vars = ['A', 'B', 'C']
  const m = minimizeBoth(vars, [3, 5, 6, 7])
  assert.equal(staticOneHazards(m.sop, vars).length, 0, 'the minimal cover of the majority has no hazard')
  const res = minimize(3, [3, 4 + 1, 6, 7].filter((x) => x !== 5).concat([1, 3]).filter((x, i, arr) => arr.indexOf(x) === i), [])
  void res
  const f = minimize(3, [1, 3, 6, 7]) // A'C (1,3) and AB (6,7)
  const cover = f.cover
  const haz = staticOneHazards(f, vars, cover)
  assert.equal(haz.length, 1, 'one pair of neighbours: 3 and 7')
  assert.deepEqual([haz[0].a, haz[0].b], [3, 7])
  assert.equal(haz[0].variable, 'A', 'A is the variable that changes')
  assert.ok(haz[0].fix, 'a prime covers both')
  assert.equal(implicantBits(haz[0].fix!, 3), '-11', 'BC, the consensus term')
  const fixed = hazardFreeCover(f, vars)
  assert.equal(fixed.cover.length, cover.length + 1)
  assert.equal(staticOneHazards(f, vars, fixed.cover).length, 0)
})

// ------------------------------------------------------------------------------ circuits

/** A tiny circuit builder for the simulator tests: parts by kind with pin connections by net name. */
function circuit(parts: { kind: Kind; props?: Record<string, string>; pins?: Record<string, string> }[]): Doc {
  const b = new Builder()
  parts.forEach((p, i) => {
    const ref = b.add(p.kind, 300 * (i % 6), 200 * Math.floor(i / 6), p.props ?? {})
    for (const [pin, net] of Object.entries(p.pins ?? {})) b.tie(`${ref}.${pin}`, net, 20)
  })
  return b.doc
}

const run = (doc: Doc, until: number, settings: Partial<SimSettings> = {}) => { const s = new Simulator(doc, { ...DEFAULT_SIM, ...settings }); s.run(until); return s }

test('every gate: the truth table, with X and Z', () => {
  const rows: Record<string, (a: number, b: number) => number> = {
    and: (a, b) => a & b, or: (a, b) => a | b, nand: (a, b) => 1 - (a & b), nor: (a, b) => 1 - (a | b), xor: (a, b) => a ^ b, xnor: (a, b) => 1 - (a ^ b),
  }
  for (const [kind, f] of Object.entries(rows)) {
    const doc = circuit([
      { kind: 'switch', props: { name: 'A' }, pins: { Y: 'a' } }, { kind: 'switch', props: { name: 'B' }, pins: { Y: 'b' } },
      { kind: kind as Kind, pins: { A: 'a', B: 'b', Y: 'y' } }, { kind: 'led', props: { name: 'Y' }, pins: { A: 'y' } },
    ])
    const sim = new Simulator(doc)
    for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      sim.setInput('A', a); sim.setInput('B', b); sim.settle()
      assert.equal(sim.value('Y'), f(a, b), `${kind}(${a},${b})`)
    }
    // unknowns: X in, X out unless the other input decides
    sim.setInput('A', 'X'); sim.setInput('B', 0); sim.settle()
    const want = kind === 'and' ? 0 : kind === 'nand' ? 1 : 2
    assert.equal(sim.value('Y'), want, `${kind}(X,0)`)
    sim.setInput('B', 1); sim.settle()
    assert.equal(sim.value('Y'), kind === 'or' ? 1 : kind === 'nor' ? 0 : 2, `${kind}(X,1)`)
  }
  // n-input gates
  for (const n of [3, 4, 8]) {
    const names = 'ABCDEFGH'.slice(0, n).split('')
    const doc = circuit([
      ...names.map((x) => ({ kind: 'switch' as Kind, props: { name: x }, pins: { Y: x.toLowerCase() } })),
      { kind: 'and' as Kind, props: { inputs: String(n) }, pins: { ...Object.fromEntries(names.map((x) => [x, x.toLowerCase()])), Y: 'y' } },
      { kind: 'xor' as Kind, props: { inputs: String(n) }, pins: { ...Object.fromEntries(names.map((x) => [x, x.toLowerCase()])), Y: 'p' } },
      { kind: 'led' as Kind, props: { name: 'Y' }, pins: { A: 'y' } }, { kind: 'led' as Kind, props: { name: 'P' }, pins: { A: 'p' } },
    ])
    const sim = new Simulator(doc)
    for (let v = 0; v < 1 << n; v++) {
      names.forEach((x, k) => sim.setInput(x, (v >> k) & 1))
      sim.settle()
      assert.equal(sim.value('Y'), v === (1 << n) - 1 ? 1 : 0, `${n}-input AND`)
      assert.equal(sim.value('P'), popcount(v) & 1, `${n}-input XOR is parity`)
    }
  }
  // buffer, inverter and tri-state
  const doc = circuit([
    { kind: 'switch', props: { name: 'A' }, pins: { Y: 'a' } }, { kind: 'switch', props: { name: 'E' }, pins: { Y: 'e' } },
    { kind: 'not', pins: { A: 'a', Y: 'n' } }, { kind: 'buf', pins: { A: 'a', Y: 'b' } }, { kind: 'tribuf', pins: { A: 'a', EN: 'e', Y: 't' } },
    { kind: 'led', props: { name: 'N' }, pins: { A: 'n' } }, { kind: 'led', props: { name: 'B' }, pins: { A: 'b' } }, { kind: 'led', props: { name: 'T' }, pins: { A: 't' } },
  ])
  const sim = new Simulator(doc)
  sim.setInput('A', 1); sim.setInput('E', 0); sim.settle()
  assert.deepEqual([sim.value('N'), sim.value('B'), sim.value('T')], [0, 1, 3], 'disabled tri-state is Z')
  sim.setInput('E', 1); sim.settle()
  assert.equal(sim.value('T'), 1)
  sim.setInput('E', 'X'); sim.settle()
  assert.equal(sim.value('T'), 2)
})

test('delays: unit delay moves an edge by one unit per gate; zero delay settles in the same instant', () => {
  // three inverters in a row
  const doc = circuit([
    { kind: 'switch', props: { name: 'A' }, pins: { Y: 'a' } },
    { kind: 'not', pins: { A: 'a', Y: 'n1' } }, { kind: 'not', pins: { A: 'n1', Y: 'n2' } }, { kind: 'not', pins: { A: 'n2', Y: 'n3' } },
    { kind: 'led', props: { name: 'Y' }, pins: { A: 'n3' } },
  ])
  const sim = new Simulator(doc)
  sim.settle()
  sim.setInput('A', 1)
  sim.run(sim.time + 10)
  const t0 = sim.time - 10
  const n3 = sim.netIndex('n3')
  const changes = sim.hist[n3].t.map((t, i) => [t, sim.hist[n3].v[i]])
  const last = changes[changes.length - 1]
  assert.equal(last[1], 0, 'three inversions: 1 in, 0 out')
  assert.equal(last[0] - t0, 3, 'three gate delays')
  // per-gate delays
  const d2 = circuit([
    { kind: 'switch', props: { name: 'A' }, pins: { Y: 'a' } },
    { kind: 'not', props: { delay: '5' }, pins: { A: 'a', Y: 'n1' } }, { kind: 'not', props: { delay: '2' }, pins: { A: 'n1', Y: 'n2' } },
    { kind: 'led', props: { name: 'Y' }, pins: { A: 'n2' } },
  ])
  const s2 = new Simulator(d2, { ...DEFAULT_SIM, delayMode: 'gate' })
  s2.settle(); s2.setInput('A', 1); s2.run(s2.time + 20)
  const h = s2.hist[s2.netIndex('n2')]
  assert.equal(h.t[h.t.length - 1] - h.t[h.t.length - 2] >= 0, true)
  assert.equal(h.t[h.t.length - 1], 7 + 0 * 0 + (s2.hist[s2.netIndex('a')].t[s2.hist[s2.netIndex('a')].t.length - 1]), '5 + 2 after the input change')
  // zero delay: everything at the same instant
  const s3 = new Simulator(doc, { ...DEFAULT_SIM, delayMode: 'zero' })
  s3.settle(); s3.setInput('A', 1); s3.settle()
  const h3 = s3.hist[s3.netIndex('n3')]
  const ta = s3.hist[s3.netIndex('a')]
  assert.equal(h3.t[h3.t.length - 1], ta.t[ta.t.length - 1], 'no time passes')
  assert.equal(s3.value('Y'), 0)
})

test('inertial delay swallows short pulses, transport delay passes them', () => {
  const doc = circuit([
    { kind: 'switch', props: { name: 'A' }, pins: { Y: 'a' } },
    { kind: 'buf', props: { delay: '5' }, pins: { A: 'a', Y: 'y' } }, { kind: 'led', props: { name: 'Y' }, pins: { A: 'y' } },
  ])
  const pulse = (inertial: boolean, width: number) => {
    const sim = new Simulator(doc, { ...DEFAULT_SIM, delayMode: 'gate', inertial })
    sim.setInput('A', 0); sim.run(20)
    sim.setInput('A', 1); sim.run(20 + width); sim.setInput('A', 0); sim.run(60)
    const h = sim.hist[sim.netIndex('y')]
    return h.v.filter((v) => v === 1).length
  }
  assert.equal(pulse(true, 2), 0, 'a 2-unit pulse through a 5-unit gate disappears')
  assert.equal(pulse(false, 2), 1, 'transport delay keeps it')
  assert.equal(pulse(true, 5), 1, 'a pulse as long as the delay passes')
  assert.equal(pulse(true, 8), 1)
})

test('oscillation: a ring of inverters is reported, a zero-delay loop is cut off', () => {
  const ring = circuit([
    { kind: 'not', pins: { A: 'c', Y: 'a' } }, { kind: 'not', pins: { A: 'a', Y: 'b' } }, { kind: 'not', pins: { A: 'b', Y: 'c' } },
    { kind: 'led', props: { name: 'O' }, pins: { A: 'c' } },
  ])
  // a loop of unknowns never starts: give it a kick with a NAND
  const kicked = circuit([
    { kind: 'switch', props: { name: 'EN' }, pins: { Y: 'en' } },
    { kind: 'nand', pins: { A: 'en', B: 'c', Y: 'a' } }, { kind: 'not', pins: { A: 'a', Y: 'b' } }, { kind: 'not', pins: { A: 'b', Y: 'c' } },
    { kind: 'led', props: { name: 'O' }, pins: { A: 'c' } },
  ])
  void ring
  const off = new Simulator(kicked)
  off.run(400)
  assert.equal(off.oscillations.length, 0, 'held by EN=0')
  assert.equal(off.value('O'), 1, 'NAND(0, x) = 1, and two inversions keep it')
  const on = new Simulator(kicked)
  on.run(10); on.setInput('EN', 1); on.run(1500)
  assert.ok(on.oscillations.length > 0, 'oscillation detected')
  assert.ok(on.problems().some((p) => /oscillat/.test(p.message)), 'and reported as a problem')
  // period: 3 gate delays × 2 transitions = 6
  const h = on.hist[on.netIndex('O')]
  const gaps = h.t.slice(-6).map((t, i, a) => (i ? t - a[i - 1] : 0)).slice(1)
  assert.ok(gaps.every((g) => g === 3), `half-period is three gate delays (${gaps})`)
  // zero-delay inverter loop with a kick: never settles at an instant
  const loop = circuit([
    { kind: 'switch', props: { name: 'EN' }, pins: { Y: 'en' } },
    { kind: 'nand', pins: { A: 'en', B: 'q', Y: 'q' } },
  ])
  const z = new Simulator(loop, { ...DEFAULT_SIM, delayMode: 'zero', maxDelta: 50 })
  z.settle(); z.setInput('EN', 1); z.settle()
  assert.ok(z.oscillations.some((o) => o.zeroDelay), 'delta-cycle limit reached')
  assert.equal(z.value('q'), 2, 'shown as X')
})

test('SR latch, D latch and flip-flops', () => {
  const sr = circuit([
    { kind: 'switch', props: { name: 'S' }, pins: { Y: 's' } }, { kind: 'switch', props: { name: 'R' }, pins: { Y: 'r' } },
    { kind: 'srlatch', pins: { S: 's', R: 'r', Q: 'q', QN: 'qn' } }, { kind: 'led', props: { name: 'Q' }, pins: { A: 'q' } }, { kind: 'led', props: { name: 'QN' }, pins: { A: 'qn' } },
  ])
  const s = new Simulator(sr)
  const set = (S: number, R: number) => { s.setInput('S', S); s.setInput('R', R); s.settle(); return [s.value('Q'), s.value('QN')] }
  assert.deepEqual(set(0, 0), [2, 2], 'power-up: unknown')
  assert.deepEqual(set(1, 0), [1, 0])
  assert.deepEqual(set(0, 0), [1, 0], 'remembers')
  assert.deepEqual(set(0, 1), [0, 1])
  assert.deepEqual(set(0, 0), [0, 1])
  assert.deepEqual(set(1, 1), [0, 0], 'forbidden')
  assert.deepEqual(set(0, 0), [2, 2], 'released together: unpredictable')
  // D flip-flop: edge triggered, with asynchronous set / reset
  const ff = circuit([
    { kind: 'switch', props: { name: 'D' }, pins: { Y: 'd' } }, { kind: 'switch', props: { name: 'CLK' }, pins: { Y: 'ck' } }, { kind: 'switch', props: { name: 'S' }, pins: { Y: 's' } }, { kind: 'switch', props: { name: 'R' }, pins: { Y: 'r' } },
    { kind: 'dff', pins: { D: 'd', CLK: 'ck', S: 's', R: 'r', Q: 'q', QN: 'qn' } }, { kind: 'led', props: { name: 'Q' }, pins: { A: 'q' } }, { kind: 'led', props: { name: 'QN' }, pins: { A: 'qn' } },
  ])
  const f = new Simulator(ff)
  f.settle()
  assert.equal(f.value('Q'), 0, 'starts at its initial value')
  f.setInput('D', 1); f.settle()
  assert.equal(f.value('Q'), 0, 'D alone does nothing')
  f.setInput('CLK', 1); f.settle()
  assert.equal(f.value('Q'), 1, 'rising edge')
  f.setInput('D', 0); f.settle()
  assert.equal(f.value('Q'), 1, 'no change while the clock stays high')
  f.setInput('CLK', 0); f.settle()
  assert.equal(f.value('Q'), 1, 'falling edge does nothing')
  f.setInput('CLK', 1); f.settle()
  assert.equal(f.value('Q'), 0)
  assert.equal(f.value('QN'), 1)
  f.setInput('S', 1); f.settle()
  assert.equal(f.value('Q'), 1, 'asynchronous set')
  f.setInput('R', 1); f.settle()
  assert.equal(f.value('Q'), 2, 'set and reset together')
  f.setInput('S', 0); f.settle()
  assert.equal(f.value('Q'), 0, 'reset wins when alone')
  // JK and T
  const jk = circuit([
    { kind: 'switch', props: { name: 'J' }, pins: { Y: 'j' } }, { kind: 'switch', props: { name: 'K' }, pins: { Y: 'k' } }, { kind: 'switch', props: { name: 'CLK' }, pins: { Y: 'ck' } },
    { kind: 'jkff', pins: { J: 'j', K: 'k', CLK: 'ck', Q: 'q' } }, { kind: 'led', props: { name: 'Q' }, pins: { A: 'q' } },
    { kind: 'tff', props: { edge: 'falling' }, pins: { CLK: 'ck', Q: 'tq' } }, { kind: 'led', props: { name: 'TQ' }, pins: { A: 'tq' } },
  ])
  const j = new Simulator(jk)
  j.settle()
  const tick = () => { j.setInput('CLK', 1); j.settle(); j.setInput('CLK', 0); j.settle() }
  j.setInput('J', 1); j.setInput('K', 0); tick(); assert.equal(j.value('Q'), 1, 'J: set')
  j.setInput('J', 0); j.setInput('K', 0); tick(); assert.equal(j.value('Q'), 1, 'hold')
  j.setInput('J', 0); j.setInput('K', 1); tick(); assert.equal(j.value('Q'), 0, 'K: reset')
  j.setInput('J', 1); j.setInput('K', 1); tick(); assert.equal(j.value('Q'), 1, 'toggle')
  tick(); assert.equal(j.value('Q'), 0, 'toggle')
  assert.equal(j.value('TQ'), 1 - 1 + (5 % 2), 'the T flip-flop toggled on every falling edge (5 so far)')
  // D latch is transparent while enabled
  const dl = circuit([
    { kind: 'switch', props: { name: 'D' }, pins: { Y: 'd' } }, { kind: 'switch', props: { name: 'EN' }, pins: { Y: 'en' } },
    { kind: 'dlatch', pins: { D: 'd', EN: 'en', Q: 'q' } }, { kind: 'led', props: { name: 'Q' }, pins: { A: 'q' } },
  ])
  const l = new Simulator(dl)
  l.setInput('EN', 1); l.setInput('D', 1); l.settle(); assert.equal(l.value('Q'), 1)
  l.setInput('D', 0); l.settle(); assert.equal(l.value('Q'), 0, 'transparent')
  l.setInput('D', 1); l.setInput('EN', 0); l.settle(); assert.equal(l.value('Q'), 0, 'closed: holds')
})

test('combinational blocks: mux, demux, decoder, encoder, adders, comparator, BCD to 7-segment', () => {
  const sw = (name: string, net = name.toLowerCase()) => ({ kind: 'switch' as Kind, props: { name }, pins: { Y: net } })
  const led = (name: string, net: string) => ({ kind: 'led' as Kind, props: { name }, pins: { A: net } })
  // 4:1 multiplexer
  const mux = new Simulator(circuit([
    sw('D0'), sw('D1'), sw('D2'), sw('D3'), sw('S1'), sw('S0'),
    { kind: 'mux', props: { select: '2' }, pins: { D0: 'd0', D1: 'd1', D2: 'd2', D3: 'd3', S1: 's1', S0: 's0', Y: 'y' } }, led('Y', 'y'),
  ]))
  for (let sel = 0; sel < 4; sel++) for (let d = 0; d < 16; d++) {
    for (let k = 0; k < 4; k++) mux.setInput(`D${k}`, (d >> k) & 1)
    mux.setInput('S1', sel >> 1); mux.setInput('S0', sel & 1); mux.settle()
    assert.equal(mux.value('Y'), (d >> sel) & 1, `mux sel ${sel} data ${d}`)
  }
  mux.setInput('S0', 'X'); mux.setInput('D0', 1); mux.setInput('D1', 1); mux.setInput('S1', 0); mux.settle()
  assert.equal(mux.value('Y'), 1, 'unknown select but equal data: known output')
  // decoder 3 → 8 and encoder
  const dec = new Simulator(circuit([sw('A2'), sw('A1'), sw('A0'), { kind: 'decoder', props: { bits: '3' }, pins: { A2: 'a2', A1: 'a1', A0: 'a0', EN: 'one', ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`Y${i}`, `y${i}`])) } },
    ...Array.from({ length: 8 }, (_, i) => led(`Y${i}`, `y${i}`)), { kind: 'const', props: { value: '1', name: '' }, pins: { Y: 'one' } }]))
  for (let a = 0; a < 8; a++) {
    dec.setInput('A2', (a >> 2) & 1); dec.setInput('A1', (a >> 1) & 1); dec.setInput('A0', a & 1); dec.settle()
    for (let i = 0; i < 8; i++) assert.equal(dec.value(`Y${i}`), i === a ? 1 : 0, `decoder ${a}`)
  }
  const enc = new Simulator(circuit([sw('I0'), sw('I1'), sw('I2'), sw('I3'), { kind: 'encoder', props: { bits: '2' }, pins: { I0: 'i0', I1: 'i1', I2: 'i2', I3: 'i3', A1: 'a1', A0: 'a0', V: 'v' } }, led('A1', 'a1'), led('A0', 'a0'), led('V', 'v')]))
  enc.settle()
  assert.equal(enc.value('V'), 0)
  enc.setInput('I1', 1); enc.setInput('I2', 1); enc.settle()
  assert.deepEqual([enc.value('A1'), enc.value('A0'), enc.value('V')], [1, 0, 1], 'priority: the highest input wins')
  // 4-bit adder and comparator: exhaustive
  const names = (p: string) => [3, 2, 1, 0].map((i) => `${p}${i}`)
  const add = new Simulator(circuit([
    ...names('A').map((n) => sw(n)), ...names('B').map((n) => sw(n)), sw('CI'),
    { kind: 'adder', props: { bits: '4' }, pins: { ...Object.fromEntries(names('A').map((n) => [n, n.toLowerCase()])), ...Object.fromEntries(names('B').map((n) => [n, n.toLowerCase()])), CI: 'ci', ...Object.fromEntries(names('S').map((n) => [n, n.toLowerCase()])), CO: 'co' } },
    ...names('S').map((n) => led(n, n.toLowerCase())), led('CO', 'co'),
    { kind: 'comparator', props: { bits: '4' }, pins: { ...Object.fromEntries(names('A').map((n) => [n, n.toLowerCase()])), ...Object.fromEntries(names('B').map((n) => [n, n.toLowerCase()])), GT: 'gt', EQ: 'eq', LT: 'lt' } },
    led('GT', 'gt'), led('EQ', 'eq'), led('LT', 'lt'),
  ]))
  for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (const ci of [0, 1]) {
    names('A').forEach((n, k) => add.setInput(n, (a >> (3 - k)) & 1)); names('B').forEach((n, k) => add.setInput(n, (b >> (3 - k)) & 1)); add.setInput('CI', ci); add.settle()
    const sum = add.number(['CO', 'S3', 'S2', 'S1', 'S0'])
    assert.equal(sum, a + b + ci, `${a}+${b}+${ci}`)
    assert.deepEqual([add.value('GT'), add.value('EQ'), add.value('LT')], [a > b ? 1 : 0, a === b ? 1 : 0, a < b ? 1 : 0])
  }
  // half and full adder blocks
  const fa = new Simulator(circuit([sw('A'), sw('B'), sw('C'), { kind: 'fulladder', pins: { A: 'a', B: 'b', CI: 'c', S: 's', CO: 'co' } }, led('S', 's'), led('CO', 'co'), { kind: 'halfadder', pins: { A: 'a', B: 'b', S: 'hs', C: 'hc' } }, led('HS', 'hs'), led('HC', 'hc')]))
  for (let v = 0; v < 8; v++) {
    fa.setInput('A', v & 1); fa.setInput('B', (v >> 1) & 1); fa.setInput('C', (v >> 2) & 1); fa.settle()
    const total = popcount(v)
    assert.deepEqual([fa.value('S'), fa.value('CO')], [total & 1, total >> 1])
    assert.deepEqual([fa.value('HS'), fa.value('HC')], [(v & 1) ^ ((v >> 1) & 1), (v & 1) & ((v >> 1) & 1)])
  }
  // BCD → 7 segment
  const bcd = new Simulator(circuit([...names('D').map((n) => sw(n)), { kind: 'bcd7', props: { hex: 'yes' }, pins: { ...Object.fromEntries(names('D').map((n) => [n, n.toLowerCase()])), ...Object.fromEntries(SEGMENT_NAMES.map((s) => [s, `seg_${s}`])) } },
    ...SEGMENT_NAMES.map((s) => led(`o${s}`, `seg_${s}`))]))
  for (let d = 0; d < 16; d++) {
    names('D').forEach((n, k) => bcd.setInput(n, (d >> (3 - k)) & 1)); bcd.settle()
    for (const s of SEGMENT_NAMES) assert.equal(bcd.value(`o${s}`), HEX_SEGMENTS[d].includes(s) ? 1 : 0, `digit ${d} segment ${s}`)
  }
})

test('counters, registers, shift registers and memories', () => {
  const sw = (name: string, net = name.toLowerCase()) => ({ kind: 'switch' as Kind, props: { name }, pins: { Y: net } })
  const led = (name: string, net: string) => ({ kind: 'led' as Kind, props: { name }, pins: { A: net } })
  const ctr = new Simulator(circuit([
    sw('CLK'), sw('RST'), sw('LD'), sw('UP', 'up'), sw('D3'), sw('D2'), sw('D1'), sw('D0'),
    { kind: 'counter', props: { bits: '4', modulus: '10' }, pins: { CLK: 'clk', RST: 'rst', LD: 'ld', UP: 'up', D3: 'd3', D2: 'd2', D1: 'd1', D0: 'd0', Q3: 'q3', Q2: 'q2', Q1: 'q1', Q0: 'q0', CO: 'co' } },
    led('Q3', 'q3'), led('Q2', 'q2'), led('Q1', 'q1'), led('Q0', 'q0'), led('CO', 'co'),
  ]))
  ctr.setInput('UP', 1); ctr.settle()
  const tick = () => { ctr.setInput('CLK', 1); ctr.settle(); ctr.setInput('CLK', 0); ctr.settle() }
  const q = () => ctr.number(['Q3', 'Q2', 'Q1', 'Q0'])
  const seen: (number | null)[] = [q()]
  for (let i = 0; i < 12; i++) { tick(); seen.push(q()) }
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2], 'modulo-10 counter wraps after 9')
  ctr.setInput('UP', 0); tick(); assert.equal(q(), 1, 'counting down')
  tick(); tick(); assert.equal(q(), 9, 'down from 0 wraps to the modulus − 1')
  assert.equal(ctr.value('CO'), 0)
  ctr.setInput('UP', 1); ctr.settle(); assert.equal(ctr.value('CO'), 1, 'carry out at the terminal count (9 going up)')
  ctr.setInput('RST', 1); ctr.settle(); assert.equal(q(), 0, 'asynchronous reset')
  ctr.setInput('RST', 0); ctr.setInput('D1', 1); ctr.setInput('D0', 1); ctr.setInput('LD', 1); tick(); assert.equal(q(), 3, 'synchronous load')
  // register
  const reg = new Simulator(circuit([
    sw('CLK'), sw('EN'), sw('CLR'), sw('D3'), sw('D2'), sw('D1'), sw('D0'),
    { kind: 'register', props: { bits: '4' }, pins: { D3: 'd3', D2: 'd2', D1: 'd1', D0: 'd0', CLK: 'clk', EN: 'en', CLR: 'clr', Q3: 'q3', Q2: 'q2', Q1: 'q1', Q0: 'q0' } },
    led('Q3', 'q3'), led('Q2', 'q2'), led('Q1', 'q1'), led('Q0', 'q0'),
  ]))
  reg.setInput('EN', 1); reg.settle()
  const val = (v: number) => { ['D3', 'D2', 'D1', 'D0'].forEach((n, k) => reg.setInput(n, (v >> (3 - k)) & 1)); reg.settle(); reg.setInput('CLK', 1); reg.settle(); reg.setInput('CLK', 0); reg.settle() }
  val(11); assert.equal(reg.number(['Q3', 'Q2', 'Q1', 'Q0']), 11)
  reg.setInput('EN', 0); val(5); assert.equal(reg.number(['Q3', 'Q2', 'Q1', 'Q0']), 11, 'disabled: holds')
  reg.setInput('CLR', 1); reg.settle(); assert.equal(reg.number(['Q3', 'Q2', 'Q1', 'Q0']), 0, 'clear')
  assert.equal(reg.stored('U1'), 0)
  // shift register: right shift with a ring
  const sh = new Simulator(circuit([
    sw('CLK'), sw('RST'),
    { kind: 'shift', props: { bits: '4', init: '1000' }, pins: { CLK: 'clk', RST: 'rst', SIN: 'q0', Q3: 'q3', Q2: 'q2', Q1: 'q1', Q0: 'q0' } },
    led('Q3', 'q3'), led('Q2', 'q2'), led('Q1', 'q1'), led('Q0', 'q0'),
  ]))
  sh.settle()
  const state: string[] = []
  const bits = () => ['Q3', 'Q2', 'Q1', 'Q0'].map((n) => sh.value(n)).join('')
  state.push(bits())
  for (let i = 0; i < 5; i++) { sh.setInput('CLK', 1); sh.settle(); sh.setInput('CLK', 0); sh.settle(); state.push(bits()) }
  assert.deepEqual(state, ['1000', '0100', '0010', '0001', '1000', '0100'], 'a ring counter')
  // ROM and RAM
  const rom = new Simulator(circuit([sw('A1'), sw('A0'), { kind: 'rom', props: { abits: '2', dbits: '4', data: '3 A F' }, pins: { A1: 'a1', A0: 'a0', D3: 'd3', D2: 'd2', D1: 'd1', D0: 'd0' } }, led('D3', 'd3'), led('D2', 'd2'), led('D1', 'd1'), led('D0', 'd0')]))
  const word = (a: number) => { rom.setInput('A1', a >> 1); rom.setInput('A0', a & 1); rom.settle(); return rom.number(['D3', 'D2', 'D1', 'D0']) }
  assert.deepEqual([0, 1, 2, 3].map(word), [3, 10, 15, 0], 'contents, and 0 for the missing word')
  assert.deepEqual(parseMemory('1F 0x2 zz', 4, 4), [15, 2, 0, 0])
  const ram = new Simulator(circuit([sw('CLK'), sw('WE'), sw('A0'), sw('I1', 'i1'), sw('I0', 'i0'),
    { kind: 'ram', props: { abits: '1', dbits: '2' }, pins: { A0: 'a0', DI1: 'i1', DI0: 'i0', CLK: 'clk', WE: 'we', DO1: 'o1', DO0: 'o0' } }, led('O1', 'o1'), led('O0', 'o0')]))
  ram.settle()
  const wr = (a: number, v: number) => { ram.setInput('A0', a); ram.setInput('I1', v >> 1); ram.setInput('I0', v & 1); ram.setInput('WE', 1); ram.settle(); ram.setInput('CLK', 1); ram.settle(); ram.setInput('CLK', 0); ram.setInput('WE', 0); ram.settle() }
  const rd = (a: number) => { ram.setInput('A0', a); ram.settle(); return ram.number(['O1', 'O0']) }
  wr(0, 2); wr(1, 3)
  assert.deepEqual([rd(0), rd(1)], [2, 3])
  assert.deepEqual(ram.memory('U1'), [2, 3])
})

test('tri-state nets: contention is X, nobody driving is Z, a pull-up gives a level', () => {
  const sw = (name: string, net = name.toLowerCase()) => ({ kind: 'switch' as Kind, props: { name }, pins: { Y: net } })
  const doc = circuit([
    sw('A'), sw('EA'), sw('B'), sw('EB'),
    { kind: 'tribuf', pins: { A: 'a', EN: 'ea', Y: 'bus' } }, { kind: 'tribuf', pins: { A: 'b', EN: 'eb', Y: 'bus' } }, { kind: 'led', props: { name: 'BUS' }, pins: { A: 'bus' } },
  ])
  const s = new Simulator(doc)
  const set = (a: number, ea: number, b: number, eb: number) => { s.setInput('A', a); s.setInput('EA', ea); s.setInput('B', b); s.setInput('EB', eb); s.settle(); return s.value('BUS') }
  assert.equal(set(1, 0, 0, 0), 3, 'nobody drives: Z')
  assert.equal(set(1, 1, 0, 0), 1)
  assert.equal(set(0, 0, 1, 1), 1)
  assert.equal(set(1, 1, 0, 1), 2, 'conflict: X')
  assert.equal(set(1, 1, 1, 1), 1, 'two drivers agree')
  const pulled = circuit([
    sw('A'), sw('EA'), { kind: 'tribuf', pins: { A: 'a', EN: 'ea', Y: 'bus' } }, { kind: 'pull', props: { level: '1' }, pins: { P: 'bus' } }, { kind: 'led', props: { name: 'BUS' }, pins: { A: 'bus' } },
  ])
  const p = new Simulator(pulled)
  p.setInput('A', 0); p.setInput('EA', 0); p.settle(); assert.equal(p.value('BUS'), 1, 'pulled up')
  p.setInput('EA', 1); p.settle(); assert.equal(p.value('BUS'), 0, 'a driver beats the pull-up')
  // the problem list points at two outputs wired together
  const bad = circuit([sw('A'), sw('B'), { kind: 'and', pins: { A: 'a', B: 'a', Y: 'y' } }, { kind: 'or', pins: { A: 'b', B: 'b', Y: 'y' } }, { kind: 'led', props: { name: 'Y' }, pins: { A: 'y' } }])
  assert.ok(extractNets(bad).problems.some((q) => q.level === 'error' && /wired together/.test(q.message)))
})

test('the history of every net is recorded and read back by time', () => {
  const doc = circuit([{ kind: 'switch', props: { name: 'A' }, pins: { Y: 'a' } }, { kind: 'not', pins: { A: 'a', Y: 'y' } }, { kind: 'led', props: { name: 'Y' }, pins: { A: 'y' } }])
  const s = new Simulator(doc)
  s.run(10); s.setInput('A', 1); s.run(30); s.setInput('A', 0); s.run(50)
  const n = s.netIndex('Y')
  assert.equal(s.valueAt(n, 0), 2, 'unknown at the start')
  assert.equal(s.valueAt(n, 5), 1)
  assert.equal(s.valueAt(n, 12), 0)
  assert.equal(s.valueAt(n, 35), 1)
  assert.equal(s.time, 50)
  assert.equal(s.inputValue('A'), 0)
  assert.equal(s.setInput('nope', 1), false)
  assert.equal(s.reset().time, 0, 'reset starts over')
  assert.equal(readSettings({ delayMode: 'zero', unitDelay: 3 }).unitDelay, 3)
  assert.equal(readSettings({ delayMode: 'nonsense' }).delayMode, 'unit')
})

// ------------------------------------------------------------------------------ netlist, builder, editor

test('every part kind draws pins on the grid with unique names', () => {
  for (const def of KIND_LIST) {
    const part = newPart(emptyDoc(), def.kind, 0, 0)
    const sh = shapeOf(part)
    const names = sh.pins.map((p) => p.name)
    assert.equal(new Set(names).size, names.length, `${def.kind}: unique pin names`)
    for (const p of sh.pins) {
      assert.equal(Math.abs(p.x % 10), 0, `${def.kind}.${p.name} x on the grid`)
      assert.equal(Math.abs(p.y % 10), 0, `${def.kind}.${p.name} y on the grid`)
    }
    assert.ok(sh.prims.length > 0)
    assert.ok(def.name && def.prefix && def.keywords.length > 0)
  }
  for (const [kind, props] of [['and', { inputs: '8' }], ['mux', { select: '3' }], ['adder', { bits: '8' }], ['probe', { bits: '16' }], ['rom', { abits: '8', dbits: '8' }], ['shift', { bits: '8', parallel: 'yes' }], ['dff', { en: 'yes', edge: 'falling' }]] as [Kind, Record<string, string>][]) {
    const p = newPart(emptyDoc(), kind, 0, 0, { props })
    for (const q of shapeOf(p).pins) { assert.equal(Math.abs(q.x % 10), 0, `${kind}`); assert.equal(Math.abs(q.y % 10), 0, `${kind}`) }
  }
  assert.equal(shapeOf(newPart(emptyDoc(), 'and', 0, 0, { props: { inputs: '8' } })).pins.filter((p) => p.dir === 'in').length, 8)
  assert.equal(shapeOf(newPart(emptyDoc(), 'mux', 0, 0, { props: { select: '3' } })).pins.filter((p) => p.name.startsWith('D')).length, 8)
  // rotation and mirroring move pins consistently
  const g = newPart(emptyDoc(), 'and', 100, 100)
  const out = pinPositions(g).find((p) => p.name === 'Y')!
  assert.deepEqual([out.x, out.y], [130, 100])
  const rot = pinPositions({ ...g, rot: 90 }).find((p) => p.name === 'Y')!
  assert.deepEqual([rot.x, rot.y], [100, 130], 'a quarter turn clockwise')
  assert.equal(pinPositions({ ...g, mirror: true }).find((p) => p.name === 'Y')!.x, 70)
  assert.deepEqual(toWorld({ x: 0, y: 0, rot: 180, mirror: false }, 10, 20), { x: -10, y: -20 })
  const b = partBounds(g)
  assert.ok(b.x1 < 100 && b.x2 > 100)
  assert.equal(new Set(KIND_LIST.map((d) => d.kind)).size, KIND_LIST.length)
  for (const need of ['switch', 'button', 'clock', 'const', 'led', 'seg7', 'hex', 'probe', 'buf', 'not', 'and', 'or', 'nand', 'nor', 'xor', 'xnor', 'mux', 'demux', 'decoder', 'encoder', 'halfadder', 'fulladder', 'adder', 'comparator', 'tribuf', 'srlatch', 'dlatch', 'dff', 'jkff', 'tff', 'register', 'counter', 'shift', 'rom', 'ram'] as Kind[]) assert.ok(KIND_DEFS[need], `${need} is in the catalogue`)
  // the live look of a part never throws
  for (const def of KIND_LIST) {
    const part = newPart(emptyDoc(), def.kind, 0, 0)
    assert.ok(Array.isArray(livePrims(part, null)))
    assert.ok(partPrims(part, null).length > 0)
  }
})

test('net extraction: wires, T-junctions, labels, names and problems', () => {
  const b = new Builder()
  const a = b.add('switch', 0, 0, { name: 'A' })
  const c = b.add('switch', 0, 40, { name: 'C' })
  const g = b.add('and', 100, 20)
  const l = b.add('led', 200, 20, { name: 'Y' })
  b.link(`${a}.Y`, `${g}.A`)
  b.link(`${c}.Y`, `${g}.B`)
  b.link(`${g}.Y`, `${l}.A`)
  const ex = extractNets(b.build())
  assert.deepEqual(ex.nets.map((n) => n.name).sort(), ['A', 'C', 'Y'], 'nets are named after their inputs and outputs')
  assert.equal(ex.pinNet.get('U1.A'), ex.pinNet.get('SW1.Y'))
  assert.equal(ex.problems.filter((p) => p.level !== 'info').length, 0)
  // a label joins nets by name even without a wire; a label name wins over a part name
  const d = new Builder()
  const s = d.add('switch', 0, 0, { name: 'A' })
  const n = d.add('not', 100, 0)
  d.tie(`${s}.Y`, 'sig', 20)
  d.tie(`${n}.A`, 'sig', 20)
  const e2 = extractNets(d.build())
  assert.equal(e2.pinNet.get('SW1.Y'), e2.pinNet.get('U1.A'))
  assert.equal(e2.nets[e2.pinNet.get('SW1.Y')!].name, 'sig')
  // crossing wires are not joined; a wire that ends on another is
  const doc = emptyDoc()
  doc.wires.push({ id: 'w1', x1: 0, y1: 50, x2: 100, y2: 50 }, { id: 'w2', x1: 50, y1: 0, x2: 50, y2: 100 })
  assert.equal(new Set(extractNets(doc).pointNet.values()).size, 2, 'a crossing is not a connection')
  doc.wires.push({ id: 'w3', x1: 50, y1: 50, x2: 50, y2: 90 })
  assert.equal(new Set(extractNets(doc).pointNet.values()).size, 1, 'a wire ending on another joins them')
  // problems: an unconnected input, and an empty sheet
  const lone = new Builder()
  lone.add('and', 100, 100)
  lone.add('led', 200, 100, { name: 'Y' })
  assert.match(extractNets(lone.build()).problems.map((p) => p.message).join('|'), /U1\.A is not connected/)
  assert.deepEqual(extractNets(emptyDoc()).problems.map((p) => p.level), ['info'])
  // resolving a target: net name, signal name, pin
  const doc2 = b.build()
  const ex2 = extractNets(doc2)
  assert.equal(resolveTarget(doc2, ex2, 'Y')?.name, 'Y')
  assert.equal(resolveTarget(doc2, ex2, 'U1.Y')?.name, 'Y')
  assert.equal(resolveTarget(doc2, ex2, 'SW1')?.name, 'A')
  assert.equal(resolveTarget(doc2, ex2, 'nothing'), undefined)
})

/** The nets of the drawing must be exactly the groups of pins the builder meant to connect. */
function checkDrawing(b: Builder, what: string) {
  const doc = b.build()
  const ex = extractNets(doc)
  const groups = intendedGroups(b)
  const owner = new Map<number, string[]>()
  for (const g of groups) {
    const nets = new Set(g.map((p) => ex.pinNet.get(p)))
    assert.equal(nets.size, 1, `${what}: ${g.join(', ')} are on one net`)
    const n = [...nets][0]!
    assert.ok(!owner.has(n), `${what}: ${g.join(', ')} share a net with ${owner.get(n)?.join(', ')}`)
    owner.set(n, g)
  }
  for (const [n, g] of owner) for (const p of ex.nets[n].pins) assert.ok(g.includes(`${p.ref}.${p.pin}`), `${what}: ${p.ref}.${p.pin} must not be on net ${ex.nets[n].name}`)
  return ex
}

test('the builder routes cleanly or falls back to labels, and the drawing matches the intention', () => {
  const rnd = prng(31)
  for (let trial = 0; trial < 12; trial++) {
    const b = new Builder()
    const gates: string[] = []
    const sources: string[] = []
    for (let i = 0; i < 4; i++) sources.push(b.add('switch', 0, i * 60, { name: `I${i}` }))
    for (let i = 0; i < 6; i++) gates.push(b.add((['and', 'or', 'xor', 'nand'] as Kind[])[Math.floor(rnd() * 4)], 150 + (i % 3) * 150, 20 + Math.floor(i / 3) * 110))
    const outs = gates.map((_, i) => b.add('led', 650, i * 60, { name: `O${i}` }))
    gates.forEach((g, i) => {
      for (const pin of ['A', 'B']) {
        const from = i < 3 || rnd() < 0.4 ? `${sources[Math.floor(rnd() * 4)]}.Y` : `${gates[Math.floor(rnd() * 3)]}.Y`
        b.link(from, `${g}.${pin}`)
      }
      b.link(`${g}.Y`, `${outs[i]}.A`)
    })
    checkDrawing(b, `random circuit ${trial}`)
  }
})

test('editing: move, rotate and mirror keep the connections; copy, paste, delete, hit tests and undo', () => {
  const b = new Builder()
  const a = b.add('switch', 0, 0, { name: 'A' })
  const g = b.add('not', 120, 0)
  const l = b.add('led', 240, 0, { name: 'Y' })
  b.link(`${a}.Y`, `${g}.A`)
  b.link(`${g}.Y`, `${l}.A`)
  const doc = b.build()
  const names = (d: Doc) => { const e = extractNets(d); return [...e.pinNet.entries()].map(([k, v]) => `${k}=${e.nets[v].pins.length}`).sort().join(' ') }
  const base = names(doc)
  const partId = (d: Doc, ref: string) => d.parts.find((p) => p.ref === ref)!.id
  // move the inverter: wires stretch, nets stay
  const moved = moveItems(doc, new Set([partId(doc, 'U1')]), 40, 60)
  assert.equal(names(moved), base, 'moving keeps the connections')
  assert.ok(moved.wires.every((w) => w.x1 === w.x2 || w.y1 === w.y2), 'wires stay orthogonal')
  assert.deepEqual([moved.parts.find((p) => p.ref === 'U1')!.x, moved.parts.find((p) => p.ref === 'U1')!.y], [160, 60])
  // rotate and mirror: the whole drawing turns, the nets stay; one part turns by 90° steps
  const all = new Set([...doc.parts.map((p) => p.id), ...doc.wires.map((x) => x.id)])
  const rot = rotateItems(doc, all)
  assert.equal(rot.parts.every((p) => p.rot === 90), true)
  assert.equal(names(rot), base, 'rotating everything keeps the connections')
  assert.equal(rotateItems(rotateItems(rotateItems(rot, new Set([...rot.parts.map((p) => p.id), ...rot.wires.map((x) => x.id)])), new Set([...rot.parts.map((p) => p.id), ...rot.wires.map((x) => x.id)])), new Set([...rot.parts.map((p) => p.id), ...rot.wires.map((x) => x.id)])).parts[0].rot, 0)
  const mir = mirrorItems(doc, all)
  assert.equal(mir.parts.every((p) => p.mirror), true)
  assert.equal(names(mir), base, 'mirroring everything keeps the connections')
  const one = rotateItems(doc, new Set([partId(doc, 'U1')]))
  assert.equal(one.parts.find((p) => p.ref === 'U1')!.rot, 90, 'one part turns a quarter')
  assert.ok(one.wires.every((w) => w.x1 === w.x2 || w.y1 === w.y2))
  // copy and paste: new references and names, nothing shared
  const clip = copyItems(doc, all)
  const pasted = pasteClip(doc, clip, 0, 200)
  assert.equal(pasted.doc.parts.length, 6)
  assert.equal(new Set(pasted.doc.parts.map((p) => p.ref)).size, 6, 'fresh references')
  assert.equal(new Set(pasted.doc.parts.map((p) => p.props.name).filter(Boolean)).size, 4, 'fresh signal names')
  assert.equal(extractNets(pasted.doc).nets.length, 4, 'two copies of two nets each')
  // delete
  const del = deleteItems(doc, new Set([partId(doc, 'U1')]))
  assert.equal(del.parts.length, 2)
  // hit tests
  const pin = hitPin(doc, 31, 1)
  assert.equal(pin?.part.ref, 'SW1')
  assert.equal(pin?.pin, 'Y')
  assert.equal(hitPart(doc, 120, 0)?.ref, 'U1')
  assert.ok(hitWire(doc, 60, 0))
  assert.equal(hitWire(doc, 60, 40), null)
  const box = itemsInBox(doc, -20, -30, 60, 30)
  assert.ok(box.has(partId(doc, 'SW1')) && !box.has(partId(doc, 'LED1')))
  assert.ok(docBounds(doc)!.x2 > 240)
  assert.equal(docBounds(emptyDoc()), null)
  // wires: splitting at pins, junction dots, routes
  const w = splitWires({ ...emptyDoc(), wires: [{ id: 'a', x1: 0, y1: 0, x2: 100, y2: 0 }, { id: 'b', x1: 50, y1: 0, x2: 50, y2: 50 }] })
  assert.equal(w.wires.length, 3, 'the long wire is cut where the other one joins')
  assert.deepEqual(junctions({ ...emptyDoc(), wires: w.wires }), [{ x: 50, y: 0 }])
  assert.deepEqual(route(0, 0, 10, 20, true), [[0, 0], [10, 0], [10, 20]])
  assert.equal(addPath(emptyDoc(), [[0, 0], [20, 0], [20, 20]]).wires.length, 2)
  // stub to a net
  const d2 = cloneDoc(doc)
  stubToNet(d2, d2.parts.find((p) => p.ref === 'U1')!, 'A', 'sig')
  assert.ok(d2.labels.some((x) => x.name === 'sig'))
  // search
  assert.ok(searchParts('nand').some((d) => d.kind === 'nand'))
  assert.ok(searchParts('multiplexer').some((d) => d.kind === 'mux'))
  assert.ok(searchParts('7 segment').some((d) => d.kind === 'seg7'))
  assert.equal(searchParts('zzzzzz').length, 0)
  assert.equal(searchParts('').length, KIND_LIST.length)
  // undo / redo
  const h = new History()
  h.push(doc)
  assert.equal(h.canUndo, true)
  assert.equal(h.undo(del), doc)
  assert.equal(h.canRedo, true)
  assert.equal(h.redo(doc), del)
  assert.equal(h.undo(emptyDoc()), doc)
  h.push(doc); assert.equal(h.canRedo, false, 'a new edit clears redo')
})

// ------------------------------------------------------------------------------ file format

test('the .kdig file round-trips and rejects what is not one', () => {
  const f: KdigFile = {
    ...emptyFile('Mine'), description: 'A test', tab: 'boolean', probes: [{ name: 'S', bits: ['A', 'B'], radix: 'binary' }], stimulus: [{ t: 10, set: { A: 1, B: 'X' } }], until: 123,
    sim: { delayMode: 'gate', inertial: false }, boolean: { text: 'F = A & B', style: 'nand', focus: 'F' }, numbers: { value: '0x7f', base: 16, bits: 16 },
  }
  const b = new Builder()
  b.add('and', 0, 0, { inputs: '3' })
  f.circuit = canonicalIds(b.doc)
  f.fsm = sequenceDetector('101')
  const back = parseKdig(serializeKdig(f))
  assert.equal(back.name, 'Mine')
  assert.equal(back.tab, 'boolean')
  assert.deepEqual(back.probes, f.probes)
  assert.deepEqual(back.stimulus, f.stimulus)
  assert.equal(back.until, 123)
  assert.equal(back.sim?.delayMode, 'gate')
  assert.equal(back.sim?.inertial, false)
  assert.deepEqual(back.boolean, f.boolean)
  assert.deepEqual(back.numbers, f.numbers)
  assert.deepEqual(back.circuit, f.circuit)
  assert.deepEqual(back.fsm, f.fsm)
  assert.throws(() => parseKdig('nope'), /not valid JSON/)
  assert.throws(() => parseKdig('{"format":"kelec"}'), /should be “kdig”/)
  assert.throws(() => parseKdig('{"format":"kdig","version":9}'), /newer kDigital/)
  // unknown parts are skipped, defaults are filled in, duplicate references are made unique
  const odd = parseKdig(JSON.stringify({ format: 'kdig', version: 1, circuit: { parts: [{ kind: 'warp-core', x: 1 }, { kind: 'and', ref: 'U1', x: 0, y: 0 }, { kind: 'and', ref: 'U1', x: 100, y: 0, props: { inputs: 4 } }], wires: [{ x1: 0, y1: 0, x2: 10 }], labels: [{ name: 'a', x: 1, y: 2 }] } }))
  assert.equal(odd.circuit!.parts.length, 2)
  assert.equal(new Set(odd.circuit!.parts.map((p) => p.ref)).size, 2)
  assert.equal(odd.circuit!.parts[1].props.inputs, '4')
  assert.equal(odd.circuit!.wires.length, 0)
  assert.equal(odd.circuit!.labels.length, 1)
  assert.equal(parseDoc(undefined).parts.length, 0)
})

// ------------------------------------------------------------------------------ examples

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const exFile = (id: string) => {
  const ex = exampleById(id)!
  assert.ok(ex, `example ${id}`)
  const f = ex.build()
  return { ex, f, doc: f.circuit!, settings: { ...DEFAULT_SIM, ...(f.sim ?? {}) } as SimSettings }
}
const nets = (sim: Simulator, names: string[], t: number): number | null => numberOf(names.slice().reverse().map((n) => sim.valueAt(sim.netIndex(n), t)))
const at = (sim: Simulator, name: string, t: number): V => sim.valueAt(sim.netIndex(name), t)
const setBits = (sim: Simulator, names: string[], value: number) => names.forEach((n, k) => sim.setInput(n, (value >> (names.length - 1 - k)) & 1))

test('there are at least 14 examples, each with a title, group and a circuit or a workbench', () => {
  assert.ok(EXAMPLES.length >= 14, `${EXAMPLES.length} examples`)
  assert.equal(new Set(EXAMPLES.map((e) => e.id)).size, EXAMPLES.length, 'unique ids')
  assert.equal(new Set(EXAMPLES.map((e) => e.title)).size, EXAMPLES.length, 'unique titles')
  const wanted = ['half-adder', 'full-adder', 'adder-4bit', 'mux-2to1', 'mux-4to1', 'sr-latch', 'dff-master-slave', 'counter-7seg', 'bcd-7seg', 'majority', 'parity', 'traffic-light', 'detector-1011', 'shift-register', 'alu-4bit', 'hazard', 'hazard-fixed']
  for (const id of wanted) assert.ok(exampleById(id), `the brief asks for ${id}`)
  for (const ex of EXAMPLES) {
    assert.ok(ex.title && ex.group && ex.description.length > 10, ex.id)
    const f = ex.build()
    assert.equal(f.format, 'kdig')
    assert.ok(f.name && f.description, `${ex.id} has a name and a description`)
  }
})

test('every example loads from its file and simulates; the drawing is wired as the builder meant', () => {
  for (const ex of EXAMPLES) {
    const f = ex.build()
    const text = serializeKdig(f)
    const back = parseKdig(text)
    assert.deepEqual(back, JSON.parse(text), `${ex.id}: the file round-trips`)
    const doc = back.circuit!
    const builder = lastBuiltFor(ex.id)
    if (builder) checkDrawing(builder, ex.id)
    if (doc.parts.length === 0) continue
    const ex1 = extractNets(doc)
    const errors = ex1.problems.filter((p) => p.level === 'error')
    assert.deepEqual(errors, [], `${ex.id}: no wiring errors`)
    const sim = runSpec({ doc, settings: { ...DEFAULT_SIM, ...readSettings(back.sim) }, steps: back.stimulus ?? [], until: back.until ?? 100 })
    assert.ok(sim.eventCount > 0, `${ex.id} ran`)
    // everything the user sees in the timing diagram resolves
    for (const p of back.probes ?? defaultProbes(doc)) for (const bit of p.bits) assert.ok(sim.netIndex(bit) >= 0, `${ex.id}: probe ${p.name} → ${bit} is a net`)
    // the svg export works and is well-formed
    const svg = docToSvg(doc, undefined, sim).svg
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'))
    assert.equal((svg.match(/<g[ >]/g) ?? []).length, (svg.match(/<\/g>/g) ?? []).length, `${ex.id}: balanced groups`)
    assert.ok(docToSvg(doc, DARK_COLORS).svg.length > 100)
  }
})

function lastBuiltFor(id: string): Builder | null {
  const { lastBuilt } = examplesModule
  exampleById(id)!.build()
  return lastBuilt()
}
import * as examplesModule from '../../src/apps/kdigital/examples.ts'

test('example: half adder, full adder', () => {
  const h = exFile('half-adder')
  const hs = new Simulator(h.doc)
  for (let v = 0; v < 4; v++) { setBits(hs, ['A', 'B'], v); hs.settle(); const a = v >> 1, b = v & 1; assert.deepEqual([hs.value('S'), hs.value('C')], [a ^ b, a & b]) }
  const f = exFile('full-adder')
  const fs = new Simulator(f.doc)
  for (let v = 0; v < 8; v++) { setBits(fs, ['A', 'B', 'Cin'], v); fs.settle(); const t = popcount(v); assert.deepEqual([fs.value('S'), fs.value('Cout')], [t & 1, t >> 1], `full adder ${v}`) }
})

test('example: the 4-bit ripple-carry adder adds all 256 input pairs (and both carry-ins), and the 7-segment shows the sum', () => {
  const { doc } = exFile('adder-4bit')
  const sim = new Simulator(doc)
  const seg = doc.parts.find((p) => p.kind === 'seg7')!
  let cases = 0
  for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (const ci of [0, 1]) {
    setBits(sim, ['A3', 'A2', 'A1', 'A0'], a); setBits(sim, ['B3', 'B2', 'B1', 'B0'], b); sim.setInput('Cin', ci); sim.settle()
    const sum = sim.number(['Cout', 'S3', 'S2', 'S1', 'S0'])
    assert.equal(sum, a + b + ci, `${a} + ${b} + ${ci}`)
    const lit = SEGMENT_NAMES.filter((s) => sim.pinValue(seg.ref, s) === 1).join('')
    assert.equal(lit, HEX_SEGMENTS[(a + b + ci) & 15], `the display shows the low nibble of ${a + b + ci}`)
    cases++
  }
  assert.equal(cases, 512)
  // the carry ripples: A = 1111, B = 0000, Cin goes 0 → 1 changes Cout after four full-adder delays
  const r = new Simulator(doc, { ...DEFAULT_SIM, delayMode: 'unit' })
  setBits(r, ['A3', 'A2', 'A1', 'A0'], 15); setBits(r, ['B3', 'B2', 'B1', 'B0'], 0); r.settle()
  const t0 = r.time
  r.setInput('Cin', 1); r.settle()
  const h = r.hist[r.netIndex('Cout')]
  assert.equal(h.v[h.v.length - 1], 1)
  assert.ok(h.t[h.t.length - 1] - t0 >= 4, 'the carry takes at least one gate delay per stage')
})

test('example: multiplexers', () => {
  const m2 = new Simulator(exFile('mux-2to1').doc)
  for (let v = 0; v < 8; v++) { setBits(m2, ['D0', 'D1', 'S'], v); m2.settle(); const [d0, d1, s] = bitsMsb(v, 3); assert.equal(m2.value('Y'), s ? d1 : d0, `2:1 ${v}`) }
  const m4 = new Simulator(exFile('mux-4to1').doc)
  for (let v = 0; v < 64; v++) {
    setBits(m4, ['D0', 'D1', 'D2', 'D3', 'S1', 'S0'], v); m4.settle()
    const bits = bitsMsb(v, 6)
    assert.equal(m4.value('Y'), bits[(bits[4] << 1) | bits[5]], `4:1 ${v}`)
  }
})

test('example: the SR latch sets, resets, remembers and shows the forbidden state', () => {
  const { f, doc, settings } = exFile('sr-latch')
  const sim = runSpec({ doc, settings, steps: f.stimulus!, until: f.until! })
  const q = (t: number) => [at(sim, 'Q', t), at(sim, 'QN', t)]
  assert.deepEqual(q(10), [2, 2], 'unknown until it is set or reset')
  assert.deepEqual(q(25), [1, 0], 'set')
  assert.deepEqual(q(45), [1, 0], 'S released: it remembers 1')
  assert.deepEqual(q(65), [0, 1], 'reset')
  assert.deepEqual(q(85), [0, 1], 'remembers 0')
  assert.deepEqual(q(105), [0, 0], 'S = R = 1: both outputs 0 (the forbidden state)')
  assert.deepEqual(q(125), [1, 0], 'R released first: the latch ends up set')
  assert.deepEqual(q(165), [1, 0], 'and remembers it')
})

test('example: the master–slave D flip-flop copies D on the rising edge only', () => {
  const { f, doc, settings } = exFile('dff-master-slave')
  const sim = runSpec({ doc, settings, steps: f.stimulus!, until: f.until! })
  const d = f.stimulus!.map((s) => [s.t, Number(s.set.D)])
  const dAt = (t: number) => d.filter(([tt]) => tt <= t).slice(-1)[0][1]
  // CLK period 40, first rising edge at 20
  let prev: number | null = null
  for (let edge = 20; edge + 20 <= f.until!; edge += 40) {
    const want = dAt(edge - 1)
    assert.equal(at(sim, 'Q', edge + 15), want, `Q after the edge at ${edge}`)
    assert.equal(at(sim, 'Q', edge + 38), want, 'and until the next edge')
    if (prev !== null) assert.equal(at(sim, 'Q', edge - 1), prev, 'Q never changes between edges')
    prev = want
  }
  // Q changes only just after a rising edge
  const h = sim.hist[sim.netIndex('Q')]
  h.t.forEach((t, i) => { if (t > 20 && h.v[i] < 2) assert.ok((t - 20) % 40 <= 8, `Q changed at ${t}, away from a clock edge`) })
  // the master is transparent while the clock is low: it follows D at 50 → 0
  assert.equal(at(sim, 'Qm', 55), 0)
})

test('example: the 4-bit counter counts 0–15 and wraps, and the 7-segment shows each digit', () => {
  const { f, doc, settings } = exFile('counter-7seg')
  const sim = runSpec({ doc, settings, steps: f.stimulus!, until: f.until! })
  const seg = doc.parts.find((p) => p.kind === 'seg7')!
  const dsNet = (s: string) => sim.nl.pinNet.get(`${seg.ref}.${s}`)!
  const seen: number[] = []
  // rising edges at 10 + 20k; reset released at t = 8
  for (let k = 0; k < 18; k++) {
    const t = 10 + 20 * k + 8
    const n = nets(sim, ['Q3', 'Q2', 'Q1', 'Q0'], t)!
    seen.push(n)
    const lit = SEGMENT_NAMES.filter((s) => sim.valueAt(dsNet(s), t) === 1).join('')
    assert.equal(lit, HEX_SEGMENTS[n], `digit ${n}`)
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2], 'counts to 15 and wraps to 0')
  assert.equal(nets(sim, ['Q3', 'Q2', 'Q1', 'Q0'], 4), 0, 'RST clears')
  // a reset in the middle of the count
  const sim2 = new Simulator(doc)
  sim2.setInput('RST', 1); sim2.run(8); sim2.setInput('RST', 0); sim2.run(100)
  sim2.setInput('RST', 1); sim2.run(sim2.time + 3)
  assert.equal(sim2.number(['Q3', 'Q2', 'Q1', 'Q0']), 0)
})

test('example: the shift register moves 1011 along; the ring and Johnson counters cycle', () => {
  const { f, doc, settings } = exFile('shift-register')
  const sim = runSpec({ doc, settings, steps: f.stimulus!, until: f.until! })
  const sin = f.stimulus!.map((s) => Number(s.set.SIN))
  const q = (i: number, t: number) => at(sim, `${sim.comps.find((c) => c.kind === 'dff' && c.idx === i)?.part.ref ?? ''}.Q`, t)
  const ffs = doc.parts.filter((p) => p.kind === 'dff').map((p) => p.ref)
  for (let k = 0; k < 7; k++) {
    const t = 10 + 20 * k + 8
    ffs.forEach((ref, i) => assert.equal(at(sim, `${ref}.Q`, t), k - i >= 0 ? sin[k - i] : 0, `Q${i} after edge ${k}`))
  }
  void q
  const r = exFile('ring-johnson')
  const rs = runSpec({ doc: r.doc, settings: r.settings, steps: r.f.stimulus!, until: r.f.until! })
  const ring = r.doc.parts.find((p) => p.kind === 'shift' && p.props.init === '1000')!
  const johnson = r.doc.parts.find((p) => p.kind === 'shift' && p.props.init === '0000')!
  const word = (ref: string, t: number) => ['Q3', 'Q2', 'Q1', 'Q0'].map((p) => at(rs, `${ref}.${p}`, t)).join('')
  const J = ['0000', '1000', '1100', '1110', '1111', '0111', '0011', '0001']
  for (let k = 0; k < 14; k++) {
    const t = 10 + 20 * k + 8
    const hot = ['1000', '0100', '0010', '0001'][(k + 1) % 4]
    assert.equal(word(ring.ref, t), hot, `ring after ${k + 1} edges`)
    assert.equal(word(johnson.ref, t), J[(k + 1) % 8], `Johnson after ${k + 1} edges`)
  }
})

test('example: ROM lookup and the K-map minimised BCD decoder drive the right segments', () => {
  const { doc } = exFile('rom-7seg')
  const sim = new Simulator(doc)
  const seg = doc.parts.find((p) => p.kind === 'seg7')!
  for (let a = 0; a < 16; a++) {
    setBits(sim, ['A3', 'A2', 'A1', 'A0'], a); sim.settle()
    assert.equal(SEGMENT_NAMES.filter((s) => sim.pinValue(seg.ref, s) === 1).join(''), HEX_SEGMENTS[a], `ROM address ${a}`)
  }
  const bcd = exFile('bcd-7seg')
  const bs = new Simulator(bcd.doc)
  const bseg = bcd.doc.parts.find((p) => p.kind === 'seg7')!
  for (let d = 0; d < 10; d++) {
    setBits(bs, ['D3', 'D2', 'D1', 'D0'], d); bs.settle()
    assert.equal(SEGMENT_NAMES.filter((s) => bs.pinValue(bseg.ref, s) === 1).join(''), HEX_SEGMENTS[d], `BCD digit ${d}`)
  }
  // the K-map groups of every segment cover exactly the on-set (with the don't-cares allowed)
  const fs = parseFunctions(bcd.f.boolean!.text)
  assert.deepEqual(fs.errors, [])
  assert.equal(fs.table.outputs.length, 7)
  for (const o of fs.table.outputs) {
    const a = analyse(fs.table.vars, o.name, o.values)
    const groups = kmapGroups(a.min.sop.cover, kmapLayout(fs.table.vars))
    const covered = new Set(groups.flatMap((g) => g.implicant.minterms))
    for (const m of a.on) assert.ok(covered.has(m), `${o.name}: minterm ${m} is in a group`)
    for (const m of covered) assert.ok(a.on.includes(m) || a.dc.includes(m), `${o.name}: group cell ${m} is on or don't-care`)
    assert.ok(a.min.sop.cover.length <= 6, `${o.name}: ${a.min.sop.cover.length} terms`)
    // the minimised expression gives the segment of every digit 0–9
    const digit = o.name as 'a'
    for (let dgt = 0; dgt < 10; dgt++) assert.equal(o.values[dgt], HEX_SEGMENTS[dgt].includes(digit) ? 1 : 0, `${o.name} for digit ${dgt}`)
  }
})

test('example: majority voter, minimisation workbench, parity', () => {
  const m = exFile('majority')
  const ms = new Simulator(m.doc)
  for (let v = 0; v < 8; v++) { setBits(ms, ['A', 'B', 'C'], v); ms.settle(); assert.equal(ms.value('M'), popcount(v) >= 2 ? 1 : 0) }
  const a = analyseExpressions(m.f.boolean!.text).results[0]
  assert.equal(a.minimalSOP, 'AB + AC + BC')
  assert.equal(a.kmap!.groups.length, 3)
  assert.match(a.kmap!.hazards, /free of static-1 hazards/)
  const q = exFile('qmc-dont-care')
  const res = analyseExpressions(q.f.boolean!.text).results
  assert.equal(res.length, 2)
  assert.deepEqual(res[0].dontCares, [9, 14])
  assert.equal(res[0].minimalSOP.split('+').length, 3)
  assert.equal(res[0].primeImplicants.length, 4)
  const p = exFile('parity')
  const ps = new Simulator(p.doc)
  for (let d = 0; d < 16; d++) for (const fault of [0, 1]) {
    setBits(ps, ['D3', 'D2', 'D1', 'D0'], d); ps.setInput('FAULT', fault); ps.settle()
    assert.equal(ps.value('P'), popcount(d) & 1, 'even parity bit')
    assert.equal(ps.value('ERROR'), fault, 'the checker finds a single-bit error, and only then')
  }
})

test('example: the 4-bit ALU does add, and, or and xor for every input', () => {
  const { doc } = exFile('alu-4bit')
  const sim = new Simulator(doc)
  for (let op = 0; op < 4; op++) for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) for (const cin of [0, 1]) {
    setBits(sim, ['A3', 'A2', 'A1', 'A0'], a); setBits(sim, ['B3', 'B2', 'B1', 'B0'], b); sim.setInput('Cin', cin); sim.setInput('S1', op >> 1); sim.setInput('S0', op & 1); sim.settle()
    const want = op === 0 ? a & b : op === 1 ? a | b : op === 2 ? a ^ b : (a + b + cin) & 15
    assert.equal(sim.number(['F3', 'F2', 'F1', 'F0']), want, `op ${op}: ${a}, ${b}, ${cin}`)
    if (op === 3) assert.equal(sim.value('Cout'), (a + b + cin) >> 4, 'carry out')
  }
})

test('example: the static-1 hazard glitches with gate delays and not with the consensus term', () => {
  const h = exFile('hazard')
  const sim = runSpec({ doc: h.doc, settings: h.settings, steps: h.f.stimulus!, until: h.f.until! })
  const F: Probe = { name: 'F', bits: ['Fnet'] }
  const g = findGlitches(sim, F, 2)
  assert.ok(g.length >= 2, `a glitch at each falling edge of A (${g.length})`)
  assert.ok(g.every((x) => x.width === 1), 'one gate delay wide')
  assert.deepEqual(g.map((x) => x.time), [22, 62], 'two units after A falls at 20 and 60 (the inverter and the AND)')
  assert.equal(at(sim, 'Fnet', 21), 1)
  assert.equal(at(sim, 'Fnet', 22), 0, 'the glitch')
  assert.equal(at(sim, 'Fnet', 23), 1)
  const zero = runSpec({ doc: h.doc, settings: { ...h.settings, delayMode: 'zero' }, steps: h.f.stimulus!, until: h.f.until! })
  assert.equal(findGlitches(zero, F, 2).length, 0, 'with zero delay there is nothing to see')
  const fixed = exFile('hazard-fixed')
  const fs = runSpec({ doc: fixed.doc, settings: fixed.settings, steps: fixed.f.stimulus!, until: fixed.f.until! })
  assert.equal(findGlitches(fs, F, 3).length, 0, 'the consensus term holds F at 1')
  assert.equal(at(fs, 'Fnet', 22), 1)
  // and the K-map says the same
  const vars = ['A', 'B', 'C']
  const bad = minimize(3, [1, 3, 6, 7])
  assert.equal(staticOneHazards(bad, vars).length, 1)
  assert.equal(staticOneHazards(bad, vars, hazardFreeCover(bad, vars).cover).length, 0)
})

test('example: the ring oscillator is held by EN and oscillates, with a warning, when it is released', () => {
  const { f, doc, settings } = exFile('ring-oscillator')
  const sim = runSpec({ doc, settings, steps: f.stimulus!, until: f.until! })
  assert.ok(sim.oscillations.length > 0, 'the oscillation is noticed')
  const held = runSpec({ doc, settings, steps: [], until: 300 })
  assert.equal(held.oscillations.length, 0)
  assert.equal(findGlitches(sim, { name: 'x', bits: ['ring'] }, 2).length, 0)
})

test('example: the tri-state bus', () => {
  const { f, doc, settings } = exFile('tristate-bus')
  const sim = runSpec({ doc, settings, steps: f.stimulus!, until: f.until! })
  const want: V[] = [1, 0, 1, 2, 2, 0] // drive 1, drive 0, nobody (pull-up 1), conflict, conflict, drive 0
  want.forEach((v, i) => assert.equal(at(sim, 'BUS', 25 * i + 10), v, `row ${i}`))
})

test('example: the Numbers workbench opens on its tab', () => {
  const { f } = exFile('numbers')
  assert.equal(f.tab, 'numbers')
  assert.equal(f.numbers?.value, '-118.625')
})

// ------------------------------------------------------------------------------ state machines

/** Runs the circuit made from an FSM next to the FSM itself on the same inputs and compares the outputs. */
function compareWithCircuit(fsm: Fsm, bits: string[], encoding: Encoding = 'binary') {
  const circ = fsmToCircuit(fsm, encoding)
  const sim = new Simulator(circ.doc)
  const trace = simulateFsm(fsm, bits)
  sim.setInput('RST', 1); sim.run(5); sim.setInput('RST', 0)
  const n = fsm.inputs.length
  bits.forEach((s, i) => {
    const v = s.padStart(n, '0')
    fsm.inputs.forEach((name, k) => sim.setInput(name, Number(v[k])))
    sim.run(10 + 20 * i - 1) // just before the rising edge
    const got = fsm.outputs.map((o) => sim.value(o)).join('')
    const want = trace[i].out
    assert.equal(got, want, `${fsm.name} (${encoding}) step ${i}, input ${s}: outputs`)
    sim.run(10 + 20 * i + 10)
  })
  return trace
}

test('sequence detectors: Mealy and Moore, with and without overlap, match a plain string search', () => {
  const rnd = prng(8)
  for (const pattern of ['1011', '11', '101', '0110', '10010', '111']) {
    for (const overlap of [true, false]) for (const type of ['mealy', 'moore'] as const) {
      const fsm = sequenceDetector(pattern, { overlap, type })
      const w = analyseFsm(fsm).warnings
      assert.deepEqual(w, [], `${pattern} ${type}: no warnings`)
      assert.equal(fsm.states.length, type === 'mealy' ? pattern.length : pattern.length + 1)
      for (let trial = 0; trial < 6; trial++) {
        const bits = Array.from({ length: 40 }, () => (rnd() < 0.5 ? '1' : '0')).join('')
        const trace = simulateFsm(fsm, bits.split(''))
        const hits = patternMatches(bits, pattern, overlap)
        const got = trace.flatMap((r, i) => (r.out === '1' ? [i] : []))
        // a Mealy output rises with the last bit; a Moore output one clock later
        const want = type === 'mealy' ? hits : hits.map((i) => i + 1).filter((i) => i < bits.length)
        assert.deepEqual(got, want, `${pattern} ${type} overlap=${overlap} on ${bits}`)
      }
    }
  }
  // the brief: 1011 finds overlaps
  const fsm = sequenceDetector('1011', { overlap: true, type: 'mealy' })
  const tr = simulateFsm(fsm, '1011011'.split(''))
  assert.deepEqual(tr.flatMap((r, i) => (r.out === '1' ? [i] : [])), [3, 6], '1011 found twice in 1011011')
  const noOverlap = simulateFsm(sequenceDetector('1011', { overlap: false, type: 'mealy' }), '1011011'.split(''))
  assert.deepEqual(noOverlap.flatMap((r, i) => (r.out === '1' ? [i] : [])), [3], 'no overlap: found once')
  assert.throws(() => sequenceDetector('1', { overlap: true, type: 'mealy' }), /2 to 8 bits/)
})

test('the example detector and traffic light: the generated flip-flop circuit matches the state table', () => {
  const det = exFile('detector-1011')
  const seq = '0110101101101011110'.split('')
  const tr = compareWithCircuit(det.f.fsm!, seq)
  assert.deepEqual(tr.flatMap((r, i) => (r.out === '1' ? [i] : [])), patternMatches(seq.join(''), '1011', true), 'every occurrence incl. overlaps')
  // the timing diagram of the example: Y is 1 just before the edge of every step that completes the pattern
  const sim = runSpec({ doc: det.doc, settings: det.settings, steps: det.f.stimulus!, until: det.f.until! })
  const high = seq.map((_, i) => at(sim, 'Y', 10 + 20 * i - 1)).flatMap((v, i) => (v === 1 ? [i] : []))
  assert.deepEqual(high, patternMatches(seq.join(''), '1011', true))
  const traffic = exFile('traffic-light')
  const fsm = traffic.f.fsm!
  assert.deepEqual(analyseFsm(fsm).warnings, [])
  const t = compareWithCircuit(fsm, ['0', '1', '0', '1', '1', '1', '1', '0', '1', '1', '1'])
  assert.deepEqual(t.map((r) => r.state).filter((s, i, a) => i === 0 || s !== a[i - 1]), ['NS_GREEN', 'NS_YELLOW', 'EW_GREEN', 'EW_YELLOW', 'NS_GREEN', 'NS_YELLOW', 'EW_GREEN', 'EW_YELLOW'])
  // exactly one lamp per direction is on in every state
  for (const r of t) { assert.equal(Number(r.out[0]) + Number(r.out[1]) + Number(r.out[2]), 1); assert.equal(Number(r.out[3]) + Number(r.out[4]) + Number(r.out[5]), 1) }
})

test('state assignment and equations: binary, Gray and one-hot all implement the same machine', () => {
  const rnd = prng(77)
  const machines: Fsm[] = [sequenceDetector('1011', { overlap: true, type: 'mealy' }), sequenceDetector('110', { overlap: true, type: 'moore' }), exFile('traffic-light').f.fsm!]
  for (const fsm of machines) {
    const bits = Array.from({ length: 30 }, () => (rnd() < 0.5 ? '1' : '0'))
    for (const enc of ['binary', 'gray', 'onehot'] as Encoding[]) compareWithCircuit(fsm, bits, enc)
  }
  const fsm = machines[0]
  const bin = assignStates(fsm, 'binary')
  assert.deepEqual(bin.bits, ['Q1', 'Q0'])
  assert.equal(bin.codes.S0, '00', 'the initial state is code 0')
  assert.deepEqual(Object.values(bin.codes), ['00', '01', '10', '11'])
  assert.deepEqual(Object.values(assignStates(fsm, 'gray').codes), ['00', '01', '11', '10'])
  const hot = assignStates(fsm, 'onehot')
  assert.equal(hot.bits.length, 4)
  assert.deepEqual(Object.values(hot.codes), ['0001', '0010', '0100', '1000'])
  // unused codes are don't-cares for binary: a 3-state machine
  const three = sequenceDetector('10', { overlap: true, type: 'moore' })
  assert.deepEqual(assignStates(three, 'binary').unused, [3])
  const eq = deriveEquations(three, 'binary')
  assert.ok(eq.next.every((e) => e.dc.length > 0), 'the unused code gives don\'t-cares')
  assert.equal(eq.next.length, 2)
  assert.equal(eq.outputs.length, 1)
})

test('state-machine analysis: unreachable states, missing and overlapping transitions, conditions', () => {
  const f: Fsm = {
    ...emptyFsm(), inputs: ['X', 'Y'], outputs: ['Z'], type: 'moore',
    states: [{ id: 'a', name: 'A', x: 0, y: 0, out: '0', initial: true }, { id: 'b', name: 'B', x: 100, y: 0, out: '1' }, { id: 'c', name: 'C', x: 200, y: 0, out: '0' }],
    transitions: [
      { id: 't1', from: 'a', to: 'b', cond: '1-', out: '', bend: 0 }, { id: 't2', from: 'a', to: 'a', cond: 'X & !Y', out: '', bend: 0 },
      { id: 't3', from: 'a', to: 'c', cond: '11', out: '', bend: 0 }, { id: 't4', from: 'b', to: 'a', cond: '', out: '', bend: 0 },
    ],
  }
  const an = analyseFsm(f)
  assert.ok(an.warnings.some((w) => /Unreachable.*C/.test(w)) === false, 'C is reachable through t3')
  assert.ok(an.warnings.some((w) => /Not every input is handled/.test(w)), 'A has no transition for X = 0')
  assert.ok(an.warnings.some((w) => /Two transitions apply at once/.test(w)), 't1 and t3 overlap')
  assert.equal(an.table.filter((r) => r.state === 'A').length, 4, 'four input combinations per state')
  assert.ok(condHolds('1-', ['X', 'Y'], 0b10) && !condHolds('1-', ['X', 'Y'], 0b01))
  assert.ok(condHolds('X & !Y', ['X', 'Y'], 0b10))
  assert.ok(condHolds('', ['X', 'Y'], 0))
  assert.match(checkCondition('Q', ['X', 'Y']) ?? '', /not an input/)
  assert.equal(checkCondition('X ^ Y', ['X', 'Y']), null)
  const lonely = { ...f, transitions: f.transitions.filter((t) => t.id !== 't3') }
  assert.ok(analyseFsm(lonely).warnings.some((w) => /Unreachable.*C/.test(w)))
  // the simulation: Moore output belongs to the state, Mealy output to (state, input)
  const wave = fsmWave(f, simulateFsm(f, ['10', '00', '11']))
  assert.equal(wave.signal[0].name, 'clk')
  assert.ok(wave.signal.some((s) => s.name === 'state' && s.data!.length > 0))
  // geometry: a curved arrow and a loop
  const gA = transitionGeometry(f.states[0], f.states[1], 0.3)
  assert.match(gA.d, /^M[\d.\- ]+ Q/)
  assert.match(transitionGeometry(f.states[0], f.states[0], 0).d, /C/)
  assert.equal(analyseFsm(emptyFsm()).warnings.some((w) => /no states/.test(w)), true)
})

// ------------------------------------------------------------------------------ number systems

test('number systems: bases, two\'s complement, sign-magnitude, Gray, BCD', () => {
  assert.equal(N.parseInteger('0xFF'), 255n)
  assert.equal(N.parseInteger('-0b1010'), -10n)
  assert.equal(N.parseInteger('ff', 16), 255n)
  assert.equal(N.parseInteger('1_000'), 1000n)
  assert.equal(N.parseInteger('12', 2), null, 'not a binary number')
  assert.equal(N.parseInteger(''), null)
  assert.equal(N.toBase(255n, 2), '11111111')
  assert.equal(N.toBase(-255n, 16), '-ff')
  assert.equal(N.twosComplement(-5n, 8), '11111011')
  assert.equal(N.twosComplement(-128n, 8), '10000000')
  assert.equal(N.twosComplement(128n, 8), null, 'does not fit')
  assert.equal(N.fromTwos('11111011'), -5n)
  assert.equal(N.signMagnitude(-5n, 8), '10000101')
  assert.equal(N.fromSignMagnitude('10000101'), -5n)
  assert.equal(N.onesComplement(-5n, 8), '11111010')
  assert.equal(N.fromOnesComplement('11111010'), -5n)
  assert.equal(N.signMagnitude(200n, 8), null)
  for (let v = -128n; v <= 127n; v++) {
    assert.equal(N.fromTwos(N.twosComplement(v, 8)!), v)
    if (v > -128n) { assert.equal(N.fromSignMagnitude(N.signMagnitude(v, 8)!), v); assert.equal(N.fromOnesComplement(N.onesComplement(v, 8)!), v) }
  }
  for (let v = 0n; v < 300n; v++) assert.equal(N.grayDecode(N.grayEncode(v)), v)
  assert.equal(N.toBase(N.grayEncode(5n), 2), '111')
  // adjacent Gray codes differ in one bit
  for (let v = 0n; v < 255n; v++) assert.equal(popcount(Number(N.grayEncode(v) ^ N.grayEncode(v + 1n))), 1)
  assert.equal(N.toBcd(1234n), '0001 0010 0011 0100')
  assert.equal(N.fromBcd('0001 0010'), 12n)
  assert.equal(N.fromBcd('1010'), null, 'not a BCD digit')
  assert.equal(N.toBcd(-1n), null)
  const r = N.representations(-5n, 8)
  assert.equal(r.twos, '11111011'); assert.equal(r.unsigned, null); assert.equal(r.hex, 'FB'); assert.equal(r.octal, '373'); assert.equal(r.decimal, '-5')
  assert.deepEqual(r.fits, { unsigned: false, signed: true })
  const u = N.representations(300n, 8)
  assert.equal(u.twos, null); assert.equal(u.fits.unsigned, false)
  assert.equal(N.representations(200n, 8).gray, N.bitString(N.grayEncode(200n), 8))
  assert.equal(N.maxSigned(8), 127n); assert.equal(N.minSigned(8), -128n); assert.equal(N.maxUnsigned(8), 255n)
  // 64-bit integers do not lose precision
  assert.equal(N.representations(2n ** 63n - 1n, 64).hex, '7FFFFFFFFFFFFFFF')
})

test('fixed point', () => {
  const f = N.toFixed(3.14159, 4, 4, false)
  assert.equal(f.bits, '00110010')
  assert.equal(f.value, 3.125)
  assert.ok(Math.abs(f.error) < 1 / 32 + 1e-12)
  assert.equal(N.fromFixed('00110010', 4, false), 3.125)
  assert.equal(N.toFixed(-1.5, 4, 4, true).bits, '11101000')
  assert.equal(N.fromFixed('11101000', 4, true), -1.5)
  assert.equal(N.toFixed(100, 4, 4, false).overflow, true)
  assert.equal(N.toFixed(100, 4, 4, false).value, 255 / 16, 'saturates')
})

test('IEEE-754: half, single and double bit fields', () => {
  const hex = (b: string) => BigInt('0b' + b).toString(16).toUpperCase()
  assert.equal(hex(N.encodeFloat(Math.PI, N.FORMATS.single)), '40490FDB')
  assert.equal(hex(N.encodeFloat(1, N.FORMATS.half)), '3C00')
  assert.equal(hex(N.encodeFloat(0.1, N.FORMATS.double)), '3FB999999999999A')
  assert.equal(hex(N.encodeFloat(-118.625, N.FORMATS.single)), 'C2ED4000')
  assert.equal(hex(N.encodeFloat(65504, N.FORMATS.half)), '7BFF', 'the largest half')
  assert.equal(hex(N.encodeFloat(65520, N.FORMATS.half)), '7C00', 'rounds up to infinity')
  assert.equal(hex(N.encodeFloat(5.960464477539063e-8, N.FORMATS.half)), '1', 'the smallest subnormal half')
  assert.equal(hex(N.encodeFloat(1e-45, N.FORMATS.single)), '1')
  assert.equal(hex(N.encodeFloat(NaN, N.FORMATS.single)), '7FC00000')
  assert.equal(hex(N.encodeFloat(-Infinity, N.FORMATS.single)), 'FF800000')
  assert.equal(N.encodeFloat(-0, N.FORMATS.single)[0], '1', 'negative zero')
  // the single precision encoder agrees with the hardware, and double round-trips
  const rnd = prng(1)
  const dv = new DataView(new ArrayBuffer(4))
  for (let i = 0; i < 3000; i++) {
    const x = (rnd() - 0.5) * 10 ** Math.floor((rnd() - 0.5) * 80)
    dv.setFloat32(0, x)
    const want = dv.getUint32(0).toString(2).padStart(32, '0')
    assert.equal(N.encodeFloat(x, N.FORMATS.single), want, `single ${x}`)
    assert.equal(N.decodeFloat(want, N.FORMATS.single).value, dv.getFloat32(0), `decode ${x}`)
    assert.equal(N.decodeFloat(N.encodeFloat(x, N.FORMATS.double), N.FORMATS.double).value, x, 'double is exact')
  }
  const d = N.decodeFloat(N.encodeFloat(0.1, N.FORMATS.single), N.FORMATS.single)
  assert.equal(d.cls, 'normal'); assert.equal(d.exp, -4); assert.equal(d.exact, '0.100000001490116119384765625')
  assert.equal(N.decodeFloat('0' + '0'.repeat(30) + '1', N.FORMATS.single).cls, 'subnormal')
  assert.equal(N.decodeFloat('0'.repeat(32), N.FORMATS.single).cls, 'zero')
  assert.equal(N.decodeFloat('0' + '1'.repeat(8) + '0'.repeat(23), N.FORMATS.single).cls, 'infinity')
  assert.equal(N.decodeFloat('0' + '1'.repeat(8) + '1' + '0'.repeat(22), N.FORMATS.single).cls, 'nan')
  assert.equal(N.roundToFormat(0.1, N.FORMATS.half), 0.0999755859375)
  assert.equal(N.formatWidth(N.FORMATS.double), 64)
  // every bit pattern of the half format decodes and re-encodes to itself
  for (let v = 0; v < 65536; v++) {
    const bits = v.toString(2).padStart(16, '0')
    const dec = N.decodeFloat(bits, N.FORMATS.half)
    if (dec.cls === 'nan') continue
    assert.equal(N.encodeFloat(dec.value, N.FORMATS.half), bits, `half ${v.toString(16)}`)
  }
})

test('binary arithmetic with the working shown', () => {
  const a = N.addBits(100n, 50n, 8)
  assert.equal(a.sum, '10010110')
  assert.deepEqual(a.flags, { Z: false, N: true, C: false, V: true }, '100 + 50 overflows as signed')
  assert.equal(a.signed.overflow, true); assert.equal(a.unsigned.overflow, false)
  assert.equal(a.carries.length, 8)
  const c = N.addBits(200n, 100n, 8)
  assert.equal(c.carryOut, 1); assert.equal(c.unsigned.overflow, true); assert.equal(c.flags.C, true)
  assert.equal(N.addBits(255n, 1n, 8).flags.Z, true)
  for (let x = 0n; x < 64n; x += 3n) for (let y = 0n; y < 64n; y += 5n) assert.equal(BigInt('0b' + N.addBits(x, y, 8).sum), x + y)
  const s = N.subBits(5n, 10n, 8)
  assert.equal(s.sum, '11111011'); assert.equal(s.signed.result, -5n); assert.equal(s.flags.C, false, 'borrow: carry flag clear'); assert.equal(s.unsigned.overflow, true)
  assert.equal(N.subBits(10n, 5n, 8).flags.C, true)
  assert.equal(N.subBits(-128n, 1n, 8).signed.overflow, true, '−128 − 1 overflows')
  for (let x = 0n; x < 256n; x += 7n) for (let y = 0n; y < 256n; y += 11n) assert.equal(BigInt('0b' + N.subBits(x, y, 8).sum), (x - y) & 255n)
  const m = N.mulBits(13n, 11n, 4)
  assert.equal(m.product, '10001111'); assert.equal(m.unsigned, 143n)
  assert.equal(m.partials.length, 4)
  assert.equal(m.running[3], m.product)
  assert.equal(N.mulBits(-3n, 5n, 4).signed, -15n)
  const q = N.divBits(100n, 7n, 8)
  assert.equal(q.quotient, '00001110'); assert.equal(q.remainder, '00000010'); assert.equal(q.steps.length, 8)
  assert.throws(() => N.divBits(5n, 0n, 8), /Division by zero/)
  for (let x = 0n; x < 256n; x += 13n) for (let y = 1n; y < 256n; y += 17n) { const r = N.divBits(x, y, 8); assert.equal(BigInt('0b' + r.quotient), x / y); assert.equal(BigInt('0b' + r.remainder), x % y) }
  const asc = N.asciiTable()
  assert.equal(asc.length, 128)
  assert.equal(asc[65].char, 'A'); assert.equal(asc[65].bin, '1000001'); assert.equal(asc[65].hex, '41')
  assert.equal(asc[10].char, 'LF'); assert.equal(asc[10].control, true)
  assert.equal(asc[32].char, 'SP'); assert.equal(asc[127].char, 'DEL')
  assert.equal(N.asciiCode('é'), null); assert.equal(N.asciiCode('z'), 122)
})

// ------------------------------------------------------------------------------ timing diagrams

test('timing diagram: WaveJSON from the simulation, buses, glitches, cursors and stimulus text', () => {
  const { f, doc, settings } = exFile('counter-7seg')
  const sim = runSpec({ doc, settings, steps: f.stimulus!, until: f.until! })
  const probes = f.probes!
  const w = waveJson(sim, probes, { t0: 0, t1: 120, step: 5, hscale: 1 })
  assert.equal(w.columns, 25)
  const clk = w.signal.find((s) => s.name === 'CLK')!
  assert.equal(clk.wave.length, 25)
  const count = w.signal.find((s) => s.name === 'count')!
  assert.match(count.wave, /^[x=.z]+$/)
  assert.ok(count.data!.includes('1') && count.data!.includes('5'), 'the bus carries its values')
  // every character is a valid WaveDrom token
  for (const s of w.signal) assert.match(s.wave, /^[01xz=.]+$/, s.name)
  // a "." only repeats the previous column
  for (const s of w.signal) assert.notEqual(s.wave[0], '.')
  assert.equal(busText([1, 0, 1, 1], 'hex'), 'B'); assert.equal(busText([1, 0, 1, 1], 'decimal'), '11'); assert.equal(busText([1, 0, 1, 1], 'binary'), '1011')
  assert.equal(busText([2, 2, 2, 2]), 'X'); assert.equal(busText([3, 3]), 'Z'); assert.equal(busText([1, 0, 1, 1, 0, 1, 1, 0], 'hex'), 'B6')
  assert.equal(probeTextAt(sim, probes.find((p) => p.name === 'count')!, 18), '1')
  assert.equal(probeTextAt(sim, { name: 'q', bits: ['Q3'] }, 4), '0')
  // columns are capped
  assert.ok(waveJson(sim, probes, { t0: 0, t1: 1_000_000, step: 1 }).columns <= 1200)
  // default probes: inputs, clocks, outputs
  const names = defaultProbes(doc).map((p) => p.name)
  assert.ok(names.includes('CLK') && names.includes('RST') && names.includes('Count'))
  // stimulus text
  const p = parseStimulus('# comment\n0 A=0 B=1\n\n20 A=1 # later\nbad line\n30 X')
  assert.deepEqual(p.steps, [{ t: 0, set: { A: '0', B: '1' } }, { t: 20, set: { A: '1' } }])
  assert.equal(p.errors.length, 2)
  assert.equal(stimulusText(p.steps), '0 A=0 B=1\n20 A=1')
  // the summary the AI tool returns
  const sum = summarizeRun(sim, probes, f.until!)
  assert.equal(sum.signals.length, probes.length)
  assert.ok(sum.signals.find((s) => s.name === 'CLK')!.changes.length > 10)
  assert.equal(sum.glitches.length, 0, 'a synchronous counter has no glitches on its outputs')
})

test('circuit → truth table and expressions; expression → circuit (all styles)', () => {
  const rnd = prng(404)
  for (let trial = 0; trial < 30; trial++) {
    const node = randomNode(rnd, ['A', 'B', 'C', 'D'], 3)
    const vars = variables(node)
    if (vars.length === 0) continue
    for (const style of ['as-is', 'sop', 'pos', 'nand', 'nor'] as const) {
      const { doc, summary } = expressionsToDoc([{ name: 'F', expr: node }], style)
      const res = circuitFunctions(doc)
      assert.deepEqual(res.inputs, summary.inputs)
      const want = Array.from(truthVector(node, res.inputs))
      assert.deepEqual(res.outputs[0].values.map(Number), want, `${style}: ${format(node)}`)
      assert.ok(equivalent(res.outputs[0].expr, node).equal, 'the recovered expression is the same function')
      assert.equal(extractNets(doc).problems.filter((p) => p.level === 'error').length, 0)
    }
  }
  // shared sub-expressions are built once
  const { summary } = expressionsToDoc([{ name: 'X', expr: parse('(A&B) | C') }, { name: 'Y', expr: parse('(A&B) ^ C') }])
  assert.equal(summary.counts.AND, 1, 'A&B is built once')
  // NAND-only really is NAND gates
  const nandDoc = expressionsToDoc([{ name: 'F', expr: parse('A&B | !C') }], 'nand').doc
  assert.ok(nandDoc.parts.filter((p) => !['switch', 'led', 'const'].includes(p.kind)).every((p) => p.kind === 'nand'))
  assert.ok(format(styled(parse('A&B | A&!B'), 'sop')) === 'A')
  assert.deepEqual(circuitFunctions(exFile('half-adder').doc).outputs.map((o) => o.text), ['A ⊕ B', 'AB'].map((t) => t === 'A ⊕ B' ? "A'B + AB'" : t))
  const tab = circuitTable(exFile('full-adder').doc)
  assert.equal(tab.rows.length, 8)
  assert.equal(tab.sequential, false)
  assert.equal(circuitTable(exFile('counter-7seg').doc, undefined, 12).sequential, true)
  assert.throws(() => circuitTable(exFile('adder-4bit').doc, undefined, 8), /too many rows/)
})

// ------------------------------------------------------------------------------ HDL export

test('Verilog and VHDL export for every example', () => {
  for (const ex of EXAMPLES) {
    const f = ex.build()
    const doc = f.circuit!
    if (doc.parts.length) {
      const v = toVerilog(doc, f.name)
      const h = toVhdl(doc, f.name)
      const tbv = verilogTestbench(doc, f.name, f.stimulus, f.until)
      const tbh = vhdlTestbench(doc, f.name, f.stimulus, f.until)
      for (const text of [v, h, tbv, tbh]) assert.ok(!/undefined|NaN|\[object/.test(text), `${ex.id}: no junk in the HDL`)
      assert.equal((v.match(/\bmodule\b/g) ?? []).length, 1, 'one module')
      assert.equal((v.match(/\bendmodule\b/g) ?? []).length, 1)
      const begins = (v.match(/\bbegin\b/g) ?? []).length
      const ends = (v.match(/\bend\b/g) ?? []).length
      assert.equal(begins, ends, `${ex.id}: begin/end balance in Verilog`)
      assert.equal((v.match(/\bcase\b/g) ?? []).length, (v.match(/\bendcase\b/g) ?? []).length, `${ex.id}: case/endcase`)
      assert.match(h, /entity .* is[\s\S]*end entity/)
      assert.match(h, /architecture rtl of/)
      assert.equal((h.match(/(?<!end )\bcase\b/g) ?? []).length, (h.match(/\bend case\b/g) ?? []).length, `${ex.id}: VHDL case`)
      assert.equal((h.match(/\bprocess\b/g) ?? []).length % 2, 0, 'processes open and close')
      // every port of the Verilog module is declared once
      const ports = [...v.matchAll(/^\s+(input|output) (\w+)/gm)].map((m) => m[2])
      assert.equal(new Set(ports).size, ports.length, `${ex.id}: unique ports`)
      for (const name of ports) assert.ok(new RegExp(`\\.${name}\\(${name}\\)`).test(tbv), `${ex.id}: ${name} is connected in the test bench`)
    }
    if (f.fsm) {
      const fv = fsmToVerilog(f.fsm)
      const fh = fsmToVhdl(f.fsm)
      assert.match(fv, /module .*\(/); assert.match(fv, /endmodule/)
      assert.equal((fv.match(/\bcase\b/g) ?? []).length, (fv.match(/\bendcase\b/g) ?? []).length)
      assert.match(fh, /type state_t is/)
      assert.match(fsmVerilogTestbench(f.fsm, '0 1 1 0 1'), /\$finish/)
      assert.match(fsmVhdlTestbench(f.fsm, '0 1 1 0 1'), /end architecture sim/)
    }
  }
  // the structure of a few things we can read directly
  const ha = toVerilog(exFile('half-adder').doc, 'ha')
  assert.match(ha, /module ha\(/); assert.match(ha, /xor u\d+ \(S, A, B\);/); assert.match(ha, /and u\d+ \(C, A, B\);/)
  const hv = toVhdl(exFile('half-adder').doc, 'ha')
  assert.match(hv, /s_S <= A xor B;/)
  assert.match(toVerilog(exFile('sr-latch').doc, 'sr'), /nor u\d+ \((Q|QN), (R|S), (QN|Q)\);/)
  const blk = circuit([{ kind: 'switch', props: { name: 'S' }, pins: { Y: 's' } }, { kind: 'switch', props: { name: 'R' }, pins: { Y: 'r' } }, { kind: 'srlatch', pins: { S: 's', R: 'r', Q: 'q', QN: 'qn' } }, { kind: 'led', props: { name: 'Q' }, pins: { A: 'q' } }, { kind: 'led', props: { name: 'QN' }, pins: { A: 'qn' } }])
  assert.match(toVerilog(blk, 'sr'), /assign q = ~\(r \| qn\);/)
  assert.match(toVhdl(blk, 'sr'), /s_q <= not \(r or s_qn\);/)
  assert.match(toVerilog(exFile('counter-7seg').doc, 'ctr'), /always @\(posedge CLK or posedge RST\)/)
  assert.match(toVerilog(exFile('rom-7seg').doc, 'rom'), /_mem\[\d+\] = 7'h7e;/)
  assert.match(toVerilog(exFile('tristate-bus').doc, 'bus'), /1'bz/)
  assert.match(toVerilog(exFile('tristate-bus').doc, 'bus'), /pullup/)
  // reserved words and odd names are made safe
  assert.equal(sanitize('wire', 'verilog'), 'wire_x'); assert.equal(sanitize('in', 'vhdl'), 'in_x'); assert.equal(sanitize('3a', 'verilog'), 'n_3a'); assert.equal(sanitize("A'", 'verilog'), 'A_')
  // the state-machine module follows the state table
  const det = fsmToVerilog(exFile('detector-1011').f.fsm!)
  assert.match(det, /1'b1: begin next = S_S1; Y = 1'b1; end/, 'the Mealy output of the completing transition')
  assert.match(det, /localparam \[1:0\] S_S0 = 2'd0/)
  assert.match(fsmToVerilog(exFile('traffic-light').f.fsm!), /NS_G = 1'b1/)
  // test bench stub
  const tb = verilogTestbench(exFile('half-adder').doc, 'ha', exFile('half-adder').f.stimulus, 80)
  assert.match(tb, /`timescale 1ns \/ 1ps/); assert.match(tb, /\$dumpvars/); assert.match(tb, /ha dut \(/); assert.match(tb, /\$finish;/)
})

// ------------------------------------------------------------------------------ AI tools and manifest

function fakeHooks(initial: { doc?: Doc; dirty?: boolean } = {}) {
  const state = { doc: initial.doc ?? emptyDoc(), settings: DEFAULT_SIM, name: 'Untitled', tab: 'circuit' as const, booleanText: '', fsm: emptyFsm(), dirty: initial.dirty ?? false, probes: [] as Probe[], stimulus: [] as { t: number; set: Record<string, string | number> }[], until: 100 }
  const calls: string[] = []
  const hooks: Hooks = {
    state: () => state,
    showBoolean: (text, style, focus) => { state.booleanText = text; calls.push(`boolean:${style}:${focus}`) },
    applyCircuit: (doc, name) => { state.doc = doc; state.name = name; calls.push('circuit') },
    showRun: (steps, until) => { calls.push(`run:${steps.length}:${until}`) },
    openExample: async (ex) => { const f = ex.build(); state.doc = f.circuit!; state.stimulus = f.stimulus ?? []; state.until = f.until ?? 100; state.probes = f.probes ?? []; state.name = ex.title; calls.push(`example:${ex.id}`) },
  }
  return { hooks, state, calls }
}
const ctx = (allow = true) => ({ caller: 'test', windowId: 'w1', confirm: async () => allow, allowPython: async () => false })
type ToolFn = (a: Record<string, unknown>, c: ReturnType<typeof ctx>) => Promise<Record<string, any>>
const tool = (h: Hooks, name: string): ToolFn => (kdigitalTools(h) as Record<string, ToolFn>)[name]

test('AI tools: the manifest is within the limits and matches the code', () => {
  assert.equal(KDIGITAL_TOOL_SET.app, 'kdigital')
  assert.ok(KDIGITAL_TOOL_SET.tools.length >= 1 && KDIGITAL_TOOL_SET.tools.length <= 4, 'at most four tools')
  assert.ok(KDIGITAL_TOOL_SET.summary.length <= 120 + 10)
  assert.ok(KDIGITAL_TOOL_SET.keywords.length >= 8)
  const code = Object.keys(kdigitalTools(fakeHooks().hooks)).sort()
  assert.deepEqual(code, KDIGITAL_TOOL_SET.tools.map((t) => t.action).sort(), 'every manifest tool has code and the other way round')
  for (const t of KDIGITAL_TOOL_SET.tools) {
    const props = Object.keys((t.inputSchema as { properties: object }).properties)
    assert.ok(props.length <= 6, `${t.action}: at most 6 arguments`)
    assert.ok(t.description.length >= 20)
    for (const r of ((t.inputSchema as { required?: string[] }).required ?? [])) assert.ok(props.includes(r))
  }
})

test('AI tools: set_expression gives the truth table, the minimal forms and the K-map groups', async () => {
  const { hooks, calls } = fakeHooks()
  const r = await tool(hooks, 'set_expression')({ expression: 'F(A,B,C,D) = Σm(4,8,10,11,12,15) + d(9,14)' }, ctx())
  const f = r.functions[0]
  assert.equal(f.name, 'F')
  assert.deepEqual(f.minterms, [4, 8, 10, 11, 12, 15]); assert.deepEqual(f.dontCares, [9, 14])
  assert.equal(f.truthTable.length, 16)
  assert.equal(f.minimalSOP.split('+').length, 3)
  assert.equal(f.primeImplicants.length, 4)
  assert.ok(f.kmap.groups.length === 3 && f.kmap.groups.every((g: { cells: number[] }) => g.cells.length >= 2))
  assert.ok(calls.some((c) => c.startsWith('boolean')), 'shown in the Boolean tab')
  const m = await tool(hooks, 'set_expression')({ expression: 'M = A&B | A&C | B&C' }, ctx())
  assert.equal(m.functions[0].minimalSOP, 'AB + AC + BC')
  assert.equal(m.functions[0].minimalPOS, '(A + B)(A + C)(B + C)')
  assert.match(m.functions[0].kmap.hazards, /free of static-1 hazards/)
  const bad = await tool(hooks, 'set_expression')({ expression: 'F = A &' }, ctx()).catch((e: Error) => e)
  assert.ok(bad instanceof Error && /Line 1/.test(bad.message))
  await assert.rejects(tool(hooks, 'set_expression')({ expression: '' }, ctx()), /give a Boolean expression/)
  // building the circuit asks first
  const a = fakeHooks()
  await assert.rejects(tool(a.hooks, 'set_expression')({ expression: 'F = A ^ B', build_circuit: true }, ctx(false)), /did not allow/)
  assert.equal(a.state.doc.parts.length, 0)
  const ok = await tool(a.hooks, 'set_expression')({ expression: 'F = A ^ B', build_circuit: true, style: 'nand' }, ctx())
  assert.equal(ok.circuit.counts.NAND, 4, 'the four-NAND exclusive OR is chosen: it is smaller than the NAND-NAND form')
  assert.ok(a.state.doc.parts.length > 0 && a.calls.includes('circuit'))
  assert.ok(analyseExpressions('A | B').results[0].kmap!.groups.length === 2)
})

test('AI tools: simulate runs the open circuit, an example, or gates built from an expression', async () => {
  const { hooks, state, calls } = fakeHooks()
  await assert.rejects(tool(hooks, 'simulate')({}, ctx()), /no circuit to simulate/)
  const ex = await tool(hooks, 'simulate')({ example: 'full-adder' }, ctx())
  assert.equal(ex.circuit, 'Full adder')
  assert.ok(ex.signals.find((s: { name: string }) => s.name === 'S'))
  assert.equal(ex.signals.find((s: { name: string }) => s.name === 'Cout').final, '1', 'the last stimulus row is 1+1+1')
  assert.ok(calls.some((c) => c.startsWith('run:')))
  const e2 = await tool(hooks, 'simulate')({ expression: 'Y = A & B', stimulus: '0 A=0 B=0\n10 A=1 B=0\n20 A=1 B=1', until: 40, signals: ['A', 'B', 'Y'] }, ctx())
  assert.deepEqual(e2.signals.map((s: { name: string }) => s.name), ['A', 'B', 'Y'])
  assert.deepEqual(e2.signals.find((s: { name: string }) => s.name === 'Y').changes.filter((c: [number, string]) => c[0] > 0).map((c: [number, string]) => c[1]), ['0', '1'].filter(() => true).slice(0, 1).concat(['1']).filter((v, i, a) => a.indexOf(v) === i))
  assert.equal(e2.signals.find((s: { name: string }) => s.name === 'Y').final, '1')
  const hz = await tool(hooks, 'simulate')({ example: 'hazard' }, ctx())
  assert.ok(hz.glitches.length >= 2, 'the glitches are reported')
  const hz0 = await tool(hooks, 'simulate')({ example: 'hazard', delay: 'zero' }, ctx())
  assert.equal(hz0.glitches.length, 0)
  const open = fakeHooks({ doc: exampleById('half-adder')!.build().circuit! })
  const r = await tool(open.hooks, 'simulate')({ stimulus: '0 A=1 B=1', until: 20 }, ctx())
  assert.equal(r.signals.find((s: { name: string }) => s.name === 'C').final, '1')
  await assert.rejects(tool(open.hooks, 'simulate')({ stimulus: 'garbage' }, ctx()), /start with the time/)
  await assert.rejects(tool(hooks, 'simulate')({ example: 'nope-nope' }, ctx()), /No example/)
  void state
})

test('AI tools: load_example lists, loads and asks before replacing unsaved work; get_state reads back', async () => {
  const { hooks, calls } = fakeHooks()
  const list = await tool(hooks, 'load_example')({}, ctx())
  assert.equal(list.examples.length, EXAMPLES.length)
  const r = await tool(hooks, 'load_example')({ id: 'detector-1011' }, ctx())
  assert.equal(r.loaded.startsWith('1011'), true)
  assert.ok(calls.includes('example:detector-1011'))
  assert.ok(r.circuit.inputs.some((i: { name: string }) => i.name === 'X'))
  const byTitle = await tool(hooks, 'load_example')({ id: 'ripple' }, ctx())
  assert.match(byTitle.loaded, /ripple/)
  const dirty = fakeHooks({ dirty: true })
  await assert.rejects(tool(dirty.hooks, 'load_example')({ id: 'half-adder' }, ctx(false)), /did not allow/)
  assert.equal(dirty.calls.length, 0)
  await tool(dirty.hooks, 'load_example')({ id: 'half-adder' }, ctx(true))
  assert.equal(dirty.calls[0], 'example:half-adder')
  await assert.rejects(tool(hooks, 'load_example')({ id: 'zzz' }, ctx()), /No example/)
  const s = await tool(hooks, 'get_state')({}, ctx())
  assert.equal(s.tab, 'circuit'); assert.ok(s.circuit.partCount > 0); assert.equal(s.examples, EXAMPLES.length)
  const c = await tool(hooks, 'get_state')({ what: 'circuit' }, ctx())
  assert.ok(c.circuit.outputs.length > 0 && c.circuit.parts)
  const b = await tool(hooks, 'get_state')({ what: 'boolean' }, ctx())
  assert.equal(b.text, '')
  const d = describeCircuit(exampleById('traffic-light')!.build().circuit!)
  assert.equal(d.outputs.filter((o) => o.kind === 'led').length, 6)
})

// ------------------------------------------------------------------------------ files on disk

test('the files in public/examples/kdigital are what the generator makes, with an index that lists them', () => {
  const outputs = kdigitalOutputs()
  const dir = join(DIR, 'public/examples/kdigital')
  assert.ok(existsSync(dir), 'run: node tools/export_kdigital_examples.ts')
  for (const o of outputs) {
    const path = join(DIR, o.path)
    assert.ok(existsSync(path), `${o.path} exists`)
    assert.equal(readFileSync(path, 'utf8'), o.content, `${o.path} is up to date (run node tools/export_kdigital_examples.ts)`)
  }
  const onDisk = readdirSync(dir).filter((n) => n.endsWith('.kdig') || n === 'index.json').sort()
  assert.deepEqual(onDisk, outputs.map((o) => o.path.split('/').pop()!).sort(), 'no stale files')
  const index = readExampleIndex(JSON.parse(indexText()))
  const files = kdigitalExampleFiles()
  assert.deepEqual(index.map((e) => e.file), files.map((f) => f.file))
  assert.equal(index.length, EXAMPLES.length)
  assert.ok(files.length >= 14)
  for (const e of index) { assert.ok(e.title && e.group && e.description, e.file); assert.match(e.file, /^\d\d [\x20-\x7e]+\.kdig$/) }
  assert.equal(files[0].file, exampleFileName(1, EXAMPLES[0].title, 'kdig'))
  assert.equal(KDIGITAL_EXAMPLES_FOLDER, 'kDigital Examples')
  for (const f of files) parseKdig(f.content)
  assert.deepEqual(JSON.parse(indexText()).folder, KDIGITAL_EXAMPLES_FOLDER)
  void resolve
})

test('the registry entry is complete', () => {
  const text = readFileSync(join(DIR, 'src/os/registry.ts'), 'utf8')
  const at = text.indexOf("\n    id: 'kdigital',")
  assert.ok(at > 0)
  const entry = text.slice(at, text.indexOf('\n  },', at))
  assert.match(entry, /fileTypes: \['\.kdig'\]/)
  assert.match(entry, /group: 'Electricity'/)
  assert.match(entry, /minSize/)
})
