// SPICE netlist text ⇄ Circuit: a pragmatic subset (R C L V I D Q M E G K, S and X for kElec's own
// switches, op-amps and gates; .model .param .op .dc .ac .tran .end).

import type { Analysis, Behaviour, BjtModel, Circuit, DiodeModel, Elem, GateKind, MosModel, Source, SwitchSpec, Wave } from './circuit.ts'
import { DEFAULT_BJT, DEFAULT_DIODE, DEFAULT_NMOS, DEFAULT_PMOS, isGround } from './circuit.ts'
import { knownModel } from './models.ts'
import { parseValue, spiceValue } from './units.ts'

export class SpiceError extends Error {
  line: number
  constructor(message: string, line: number) {
    super(line > 0 ? `Line ${line}: ${message}` : message)
    this.line = line
  }
}

export interface ParsedNetlist {
  circuit: Circuit
  analyses: Analysis[]
  warnings: string[]
  /** nodes named in .print / .plot / .probe lines */
  probes: string[]
}

const GATES: GateKind[] = ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor']

// ------------------------------------------------------------------------------ small expression evaluator for .param

function evalNumber(text: string, params: Map<string, number>, line: number): number {
  const src = text.trim().replace(/^[{'"]|[}'"]$/g, '')
  let i = 0
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++ }
  const atom = (): number => {
    ws()
    if (src[i] === '(') {
      i++
      const v = sum()
      ws()
      if (src[i] !== ')') throw new SpiceError(`Missing “)” in “${text}”.`, line)
      i++
      return v
    }
    if (src[i] === '-') { i++; return -atom() }
    if (src[i] === '+') { i++; return atom() }
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?[a-zµ]*/i.exec(src.slice(i))
    if (m) {
      const v = parseValue(m[0])
      if (v === null) throw new SpiceError(`“${m[0]}” is not a number.`, line)
      i += m[0].length
      return v
    }
    const id = /^[A-Za-z_]\w*/.exec(src.slice(i))
    if (id) {
      i += id[0].length
      const v = params.get(id[0].toLowerCase())
      if (v === undefined) throw new SpiceError(`Unknown parameter “${id[0]}”.`, line)
      return v
    }
    throw new SpiceError(`Cannot read “${text}” as a number.`, line)
  }
  const pow = (): number => {
    const a = atom()
    ws()
    if (src[i] === '^' || (src[i] === '*' && src[i + 1] === '*')) { i += src[i] === '^' ? 1 : 2; return Math.pow(a, pow()) }
    return a
  }
  const prod = (): number => {
    let a = pow()
    for (;;) {
      ws()
      if (src[i] === '*' && src[i + 1] !== '*') { i++; a *= pow() } else if (src[i] === '/') { i++; a /= pow() } else return a
    }
  }
  const sum = (): number => {
    let a = prod()
    for (;;) {
      ws()
      if (src[i] === '+') { i++; a += prod() } else if (src[i] === '-') { i++; a -= prod() } else return a
    }
  }
  const v = sum()
  ws()
  if (i < src.length) throw new SpiceError(`Cannot read “${text}” as a number.`, line)
  return v
}

// ------------------------------------------------------------------------------ parsing

interface Line { n: number; text: string }

function logicalLines(text: string): Line[] {
  const out: Line[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    let s = raw.replace(/\s+$/, '')
    const semi = s.search(/[;$]/)
    if (semi >= 0) s = s.slice(0, semi)
    if (s.trim() === '') return
    if (s.trimStart().startsWith('*')) { out.push({ n: i + 1, text: s.trim() }); return }
    if (s.trimStart().startsWith('+') && out.length) { out[out.length - 1].text += ' ' + s.trimStart().slice(1); return }
    out.push({ n: i + 1, text: s.trim() })
  })
  return out
}

function tokens(s: string): string[] {
  return s.replace(/[(),]/g, ' ').replace(/\s*=\s*/g, '=').split(/\s+/).filter(Boolean)
}

function looksLikeElement(s: string): boolean {
  const t = tokens(s)
  if (t.length < 4 || !/^[rclviqmegskxd]/i.test(t[0])) return false
  const c = t[0][0].toLowerCase()
  if ('rcl'.includes(c)) return parseValue(t[3]) !== null || t[3].includes('=') || /^\{/.test(t[3])
  return /[0-9]/.test(t[0]) && t.length >= 4
}

function keyValues(toks: string[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const t of toks) {
    const k = t.indexOf('=')
    if (k > 0) m.set(t.slice(0, k).toLowerCase(), t.slice(k + 1))
  }
  return m
}

export function parseSpice(text: string): ParsedNetlist {
  const lines = logicalLines(text)
  const warnings: string[] = []
  const probes: string[] = []
  const analyses: Analysis[] = []
  let title = ''
  let start = 0
  if (lines.length && !lines[0].text.startsWith('.')) {
    if (lines[0].text.startsWith('*')) { title = lines[0].text.replace(/^\*+\s*/, ''); start = 1 } else if (!looksLikeElement(lines[0].text)) { title = lines[0].text; start = 1 }
  }
  const body = lines.slice(start)
  const params = new Map<string, number>()
  // pass 1: .param and .model
  const dModels = new Map<string, DiodeModel>()
  const qModels = new Map<string, BjtModel>()
  const mModels = new Map<string, MosModel>()
  const num = (t: string, ln: number) => evalNumber(t, params, ln)
  for (const l of body) {
    const low = l.text.toLowerCase()
    if (low.startsWith('.param')) {
      for (const t of l.text.replace(/\s*=\s*/g, '=').split(/\s+/).slice(1)) {
        const k = t.indexOf('=')
        if (k > 0) params.set(t.slice(0, k).toLowerCase(), num(t.slice(k + 1), l.n))
      }
    }
  }
  for (const l of body) {
    if (!l.text.toLowerCase().startsWith('.model')) continue
    const t = l.text.replace(/\(/g, ' ').replace(/\)/g, ' ').replace(/\s*=\s*/g, '=').split(/\s+/).filter(Boolean)
    if (t.length < 3) throw new SpiceError('.model needs a name and a type.', l.n)
    const name = t[1]
    const type = t[2].toLowerCase()
    const kv = keyValues(t.slice(3))
    const g = (k: string, d: number) => (kv.has(k) ? num(kv.get(k)!, l.n) : d)
    if (type === 'd') {
      const m: DiodeModel = { name, is: g('is', DEFAULT_DIODE.is), n: g('n', 1) }
      if (kv.has('bv')) { m.bv = Math.abs(g('bv', 0)); m.ibv = g('ibv', 1e-3) }
      dModels.set(name.toLowerCase(), m)
    } else if (type === 'npn' || type === 'pnp') {
      const m: BjtModel = { name, pol: type === 'npn' ? 1 : -1, is: g('is', DEFAULT_BJT.is), bf: g('bf', 100), br: g('br', 1) }
      const va = kv.has('vaf') ? g('vaf', 0) : kv.has('va') ? g('va', 0) : 0
      if (va > 0) m.vaf = va
      if (kv.has('cje')) m.cje = g('cje', 0)
      if (kv.has('cjc')) m.cjc = g('cjc', 0)
      qModels.set(name.toLowerCase(), m)
    } else if (type === 'nmos' || type === 'pmos') {
      const base = type === 'nmos' ? DEFAULT_NMOS : DEFAULT_PMOS
      const mm: MosModel = { name, pol: base.pol, vto: g('vto', base.vto), kp: g('kp', base.kp), lambda: g('lambda', 0), w: g('w', 1), l: g('l', 1) }
      if (kv.has('cgs')) mm.cgs = g('cgs', 0)
      if (kv.has('cgd')) mm.cgd = g('cgd', 0)
      mModels.set(name.toLowerCase(), mm)
    } else warnings.push(`Line ${l.n}: model type “${t[2]}” is not supported and was ignored.`)
  }
  const dModel = (name: string, ln: number): DiodeModel => {
    const m = dModels.get(name.toLowerCase())
    if (m) return m
    const k = knownModel(name)
    if (k?.type === 'D') return k.m
    throw new SpiceError(`The model “${name}” is not defined (add a .model line).`, ln)
  }
  const qModel = (name: string, ln: number): BjtModel => {
    const m = qModels.get(name.toLowerCase())
    if (m) return m
    const k = knownModel(name)
    if (k?.type === 'Q') return k.m
    throw new SpiceError(`The model “${name}” is not defined (add a .model line).`, ln)
  }
  const mModel = (name: string, ln: number, kv: Map<string, string>): MosModel => {
    let m = mModels.get(name.toLowerCase())
    if (!m) {
      const k = knownModel(name)
      if (k?.type === 'M') m = k.m
    }
    if (!m) throw new SpiceError(`The model “${name}” is not defined (add a .model line).`, ln)
    return { ...m, w: kv.has('w') ? num(kv.get('w')!, ln) : m.w, l: kv.has('l') ? num(kv.get('l')!, ln) : m.l }
  }

  const elements: Elem[] = []
  const seen = new Set<string>()
  const node = (s: string) => (isGround(s) ? '0' : s)

  const parseSource = (toks: string[], ln: number): Source => {
    const s: Source = { dc: 0, acMag: 0, acPhase: 0 }
    let i = 0
    const isNum = (t: string | undefined) => t !== undefined && /^[+-]?(\d|\.\d|\{)/.test(t)
    while (i < toks.length) {
      const k = toks[i].toLowerCase()
      if (k === 'dc') { i++; if (isNum(toks[i])) s.dc = num(toks[i++], ln) } else if (k === 'ac') {
        i++
        s.acMag = isNum(toks[i]) ? num(toks[i++], ln) : 1
        if (isNum(toks[i])) s.acPhase = num(toks[i++], ln)
      } else if (k === 'sin' || k === 'pulse' || k === 'pwl') {
        i++
        const vals: number[] = []
        while (i < toks.length && isNum(toks[i])) vals.push(num(toks[i++], ln))
        s.wave = waveFrom(k, vals, ln)
      } else if (isNum(toks[i])) s.dc = num(toks[i++], ln)
      else throw new SpiceError(`Do not know what “${toks[i]}” means in a source.`, ln)
    }
    if (s.wave?.kind === 'sin' && s.dc === 0) s.dc = s.wave.offset
    return s
  }

  for (const l of body) {
    const t = tokens(l.text)
    if (t.length === 0 || l.text.startsWith('*')) continue
    const head = t[0]
    if (head.startsWith('.')) {
      const d = head.toLowerCase()
      if (d === '.end' || d === '.ends') break
      if (d === '.op') analyses.push({ type: 'op' })
      else if (d === '.dc') {
        if (t.length < 5) throw new SpiceError('.dc needs: source start stop step', l.n)
        analyses.push({ type: 'dc', source: t[1], start: num(t[2], l.n), stop: num(t[3], l.n), step: num(t[4], l.n) })
        if (t.length >= 9) warnings.push(`Line ${l.n}: only the first sweep of .dc is used.`)
      } else if (d === '.ac') {
        const mode = (t[1] ?? '').toLowerCase()
        const pts = num(t[2] ?? '10', l.n)
        const f1 = num(t[3] ?? '1', l.n)
        const f2 = num(t[4] ?? '1meg', l.n)
        let perDecade = pts
        if (mode === 'oct') perDecade = pts / Math.log10(2)
        if (mode === 'lin') { perDecade = Math.max(10, Math.round(pts / Math.max(Math.log10(f2 / f1), 0.1))); warnings.push(`Line ${l.n}: a linear AC sweep is run with logarithmic spacing.`) }
        analyses.push({ type: 'ac', fstart: f1, fstop: f2, perDecade })
      } else if (d === '.tran') {
        const rest = t.slice(1).filter((x) => x.toLowerCase() !== 'uic')
        const uic = t.slice(1).some((x) => x.toLowerCase() === 'uic')
        if (rest.length < 2) throw new SpiceError('.tran needs: tstep tstop', l.n)
        const an: Analysis = { type: 'tran', tstop: num(rest[1], l.n), tstep: num(rest[0], l.n) }
        if (rest[3]) an.tmax = num(rest[3], l.n)
        if (uic) an.uic = true
        analyses.push(an)
      } else if (d === '.print' || d === '.plot' || d === '.probe') {
        for (const x of t.slice(1)) { const m = /^[vV]\((.+)\)$/.exec(x); if (m) probes.push(m[1]); else if (/^[A-Za-z0-9_]+$/.test(x) && !['dc', 'ac', 'tran', 'op'].includes(x.toLowerCase())) probes.push(x) }
        for (let k = 1; k < t.length; k++) if (/^v$/i.test(t[k]) && t[k + 1]) probes.push(t[k + 1])
      } else if (!['.model', '.param', '.options', '.option', '.title', '.temp', '.global', '.include', '.lib'].includes(d)) {
        warnings.push(`Line ${l.n}: ${head} is not supported and was ignored.`)
      }
      continue
    }
    const c = head[0].toLowerCase()
    if (!/^[rclvidqmegskx]$/.test(c)) throw new SpiceError(`“${head}” is not a part: names start with R, C, L, V, I, D, Q, M, E, G, K, S or X.`, l.n)
    if (seen.has(head.toLowerCase())) throw new SpiceError(`“${head}” is used twice.`, l.n)
    seen.add(head.toLowerCase())
    const need = (k: number, what: string) => { if (t.length < k) throw new SpiceError(`${head}: expected ${what}.`, l.n) }
    switch (c) {
      case 'r': case 'c': case 'l': {
        need(4, `${head} node node value`)
        const value = num(t[3], l.n)
        if (c === 'r' && !(value > 0)) throw new SpiceError(`${head}: a resistor must be above zero ohms.`, l.n)
        if ((c === 'c' || c === 'l') && !(value > 0)) throw new SpiceError(`${head}: the value must be above zero.`, l.n)
        const kv = keyValues(t.slice(4))
        const e: Elem = { kind: c.toUpperCase() as 'R', name: head, nodes: [node(t[1]), node(t[2])], value }
        if (c !== 'r' && kv.has('ic')) (e as { ic?: number }).ic = num(kv.get('ic')!, l.n)
        elements.push(e)
        break
      }
      case 'v': case 'i':
        need(3, `${head} node node [DC value] [AC mag] [waveform]`)
        elements.push({ kind: c === 'v' ? 'V' : 'I', name: head, nodes: [node(t[1]), node(t[2])], src: parseSource(t.slice(3), l.n) })
        break
      case 'd':
        need(4, `${head} anode cathode model`)
        elements.push({ kind: 'D', name: head, nodes: [node(t[1]), node(t[2])], model: dModel(t[3], l.n) })
        break
      case 'q':
        need(5, `${head} collector base emitter model`)
        elements.push({ kind: 'Q', name: head, nodes: [node(t[1]), node(t[2]), node(t[3])], model: qModel(t[4], l.n) })
        break
      case 'm': {
        need(6, `${head} drain gate source body model`)
        elements.push({ kind: 'M', name: head, nodes: [node(t[1]), node(t[2]), node(t[3])], model: mModel(t[5], l.n, keyValues(t.slice(6))) })
        break
      }
      case 'e': case 'g':
        need(6, `${head} n+ n- nc+ nc- gain`)
        elements.push({ kind: c === 'e' ? 'E' : 'G', name: head, nodes: [node(t[1]), node(t[2]), node(t[3]), node(t[4])], value: num(t[5], l.n) })
        break
      case 'k':
        need(4, `${head} L1 L2 coupling`)
        elements.push({ kind: 'K', name: head, l1: t[1], l2: t[2], k: num(t[3], l.n) })
        break
      case 's': {
        need(4, `${head} node node ON|OFF|TIMED(delay on period)`)
        const kv = keyValues(t.slice(3))
        const ron = kv.has('ron') ? num(kv.get('ron')!, l.n) : 0.01
        const roff = kv.has('roff') ? num(kv.get('roff')!, l.n) : 1e9
        const mode = t[3].toLowerCase()
        let spec: SwitchSpec
        if (mode === 'on') spec = { fixed: true }
        else if (mode === 'off') spec = { fixed: false }
        else if (mode === 'timed') spec = { delay: num(t[4] ?? '0', l.n), on: num(t[5] ?? '1', l.n), period: num(t[6] ?? '0', l.n) }
        else throw new SpiceError(`${head}: write ON, OFF or TIMED(delay on period).`, l.n)
        elements.push({ kind: 'S', name: head, nodes: [node(t[1]), node(t[2])], ron, roff, spec })
        break
      }
      case 'x': {
        const kvStart = t.findIndex((x, k) => k > 0 && x.includes('='))
        const plain = kvStart < 0 ? t : t.slice(0, kvStart)
        const sub = plain[plain.length - 1].toLowerCase()
        const kv = keyValues(t)
        const g = (k: string, d: number) => (kv.has(k) ? num(kv.get(k)!, l.n) : d)
        if (sub === 'opamp') {
          if (plain.length !== 5 && plain.length !== 7) throw new SpiceError(`${head}: expected X in+ in- out [V+ V-] OPAMP.`, l.n)
          const supply = plain.length === 7
          const fn: Behaviour = { type: 'opamp', gain: g('gain', 1e6), rail: g('rail', 15), supply, ro: g('ro', 0) }
          elements.push({ kind: 'B', name: head, nodes: [node(plain[3]), node(plain[1]), node(plain[2]), ...(supply ? [node(plain[4]), node(plain[5])] : [])], fn })
        } else if ((GATES as string[]).includes(sub)) {
          const two = sub !== 'not'
          const inputs = plain.slice(1, plain.length - 2)
          if (inputs.length !== (two ? 2 : 1)) throw new SpiceError(`${head}: a ${sub.toUpperCase()} gate needs ${two ? 'two inputs' : 'one input'} and an output: X a${two ? ' b' : ''} out ${sub.toUpperCase()}.`, l.n)
          const out = plain[plain.length - 2]
          elements.push({ kind: 'B', name: head, nodes: [node(out), ...inputs.map(node)], fn: { type: 'gate', gate: sub as GateKind, vdd: g('vdd', 5), ro: g('ro', 50) } })
        } else throw new SpiceError(`${head}: subcircuit “${plain[plain.length - 1]}” is not supported (use OPAMP, AND, OR, NOT, NAND, NOR, XOR, XNOR or BUF).`, l.n)
        break
      }
    }
  }
  return { circuit: { title, elements }, analyses, warnings, probes }
}

function waveFrom(kind: string, v: number[], ln: number): Wave {
  if (kind === 'sin') {
    if (v.length < 3) throw new SpiceError('SIN needs at least offset, amplitude and frequency: SIN(0 1 1k).', ln)
    return { kind: 'sin', offset: v[0], amp: v[1], freq: v[2], delay: v[3] ?? 0, damping: v[4] ?? 0, phase: v[5] ?? 0 }
  }
  if (kind === 'pulse') {
    if (v.length < 2) throw new SpiceError('PULSE needs at least the two levels: PULSE(0 5 0 1n 1n 0.5m 1m).', ln)
    return { kind: 'pulse', v1: v[0], v2: v[1], delay: v[2] ?? 0, rise: v[3] ?? 0, fall: v[4] ?? 0, width: v[5] ?? 1e9, period: v[6] ?? 0 }
  }
  const pts: [number, number][] = []
  for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]])
  if (pts.length === 0) throw new SpiceError('PWL needs time/value pairs.', ln)
  return { kind: 'pwl', points: pts }
}

// ------------------------------------------------------------------------------ generating

const N = (v: number) => spiceValue(v)
const nodeOut = (n: string) => (isGround(n) ? '0' : n.replace(/\s+/g, '_'))

function waveText(w: Wave): string {
  if (w.kind === 'sin') return `SIN(${N(w.offset)} ${N(w.amp)} ${N(w.freq)} ${N(w.delay)} ${N(w.damping)} ${N(w.phase)})`
  if (w.kind === 'pulse') return `PULSE(${N(w.v1)} ${N(w.v2)} ${N(w.delay)} ${N(w.rise)} ${N(w.fall)} ${N(w.width)} ${N(w.period)})`
  return `PWL(${w.points.map(([t, v]) => `${N(t)} ${N(v)}`).join(' ')})`
}

function sourceText(s: Source): string {
  const parts: string[] = []
  if (s.dc !== 0 || !s.wave) parts.push(`DC ${N(s.dc)}`)
  if (s.acMag !== 0) parts.push(`AC ${N(s.acMag)}${s.acPhase ? ' ' + N(s.acPhase) : ''}`)
  if (s.wave) parts.push(waveText(s.wave))
  return parts.join(' ')
}

/** The SPICE name for an element: it must start with its type letter. */
function spiceName(e: Elem): string {
  const letter = e.kind === 'B' ? 'X' : e.kind
  return e.name[0].toUpperCase() === letter ? e.name : letter + e.name
}

export function toSpice(circuit: Circuit, analyses: Analysis[] = [], opts: { comments?: boolean } = {}): string {
  const out: string[] = [circuit.title ? circuit.title.replace(/\n/g, ' ') : 'kElec circuit']
  const models: string[] = []
  const modelNames = new Map<string, string>()
  let nD = 0, nQ = 0, nM = 0
  const modelFor = (type: 'D' | 'Q' | 'M', m: DiodeModel | BjtModel | MosModel): string => {
    const key = type + JSON.stringify({ ...m, name: undefined })
    const have = modelNames.get(key)
    if (have) return have
    const base = m.name && /^[A-Za-z_][\w-]*$/.test(m.name) && ![...modelNames.values()].includes(m.name) ? m.name : `${type}MOD${type === 'D' ? ++nD : type === 'Q' ? ++nQ : ++nM}`
    modelNames.set(key, base)
    if (type === 'D') {
      const d = m as DiodeModel
      models.push(`.model ${base} D(IS=${d.is.toExponential(4)} N=${N(d.n)}${d.bv ? ` BV=${N(d.bv)} IBV=${N(d.ibv ?? 1e-3)}` : ''})`)
    } else if (type === 'Q') {
      const q = m as BjtModel
      models.push(`.model ${base} ${q.pol > 0 ? 'NPN' : 'PNP'}(IS=${q.is.toExponential(4)} BF=${N(q.bf)} BR=${N(q.br)}${q.vaf ? ` VAF=${N(q.vaf)}` : ''}${q.cje !== undefined ? ` CJE=${N(q.cje)}` : ''}${q.cjc !== undefined ? ` CJC=${N(q.cjc)}` : ''})`)
    } else {
      const f = m as MosModel
      models.push(`.model ${base} ${f.pol > 0 ? 'NMOS' : 'PMOS'}(VTO=${N(f.vto)} KP=${N(f.kp)} LAMBDA=${N(f.lambda)} W=${N(f.w)} L=${N(f.l)}${f.cgs !== undefined ? ` CGS=${N(f.cgs)}` : ''}${f.cgd !== undefined ? ` CGD=${N(f.cgd)}` : ''})`)
    }
    return base
  }
  for (const e of circuit.elements) {
    const nm = spiceName(e)
    switch (e.kind) {
      case 'R': case 'C': case 'L':
        out.push(`${nm} ${nodeOut(e.nodes[0])} ${nodeOut(e.nodes[1])} ${N(e.value)}${'ic' in e && e.ic !== undefined ? ` IC=${N(e.ic)}` : ''}`)
        break
      case 'V': case 'I':
        out.push(`${nm} ${nodeOut(e.nodes[0])} ${nodeOut(e.nodes[1])} ${sourceText(e.src)}`)
        break
      case 'D': out.push(`${nm} ${nodeOut(e.nodes[0])} ${nodeOut(e.nodes[1])} ${modelFor('D', e.model)}`); break
      case 'Q': out.push(`${nm} ${e.nodes.map(nodeOut).join(' ')} ${modelFor('Q', e.model)}`); break
      case 'M': out.push(`${nm} ${nodeOut(e.nodes[0])} ${nodeOut(e.nodes[1])} ${nodeOut(e.nodes[2])} ${nodeOut(e.nodes[2])} ${modelFor('M', e.model)}`); break
      case 'E': case 'G': out.push(`${nm} ${e.nodes.map(nodeOut).join(' ')} ${N(e.value)}`); break
      case 'K': out.push(`${nm} ${e.l1} ${e.l2} ${N(e.k)}`); break
      case 'S': {
        const spec = 'fixed' in e.spec ? (e.spec.fixed ? 'ON' : 'OFF') : `TIMED(${N(e.spec.delay)} ${N(e.spec.on)} ${N(e.spec.period)})`
        out.push(`${nm} ${nodeOut(e.nodes[0])} ${nodeOut(e.nodes[1])} ${spec} RON=${N(e.ron)} ROFF=${N(e.roff)}`)
        break
      }
      case 'B': {
        const f = e.fn
        if (f.type === 'opamp') {
          const [o, p, m, ...sup] = e.nodes
          out.push(`${nm} ${[p, m, o, ...sup].map(nodeOut).join(' ')} OPAMP GAIN=${N(f.gain)} RAIL=${N(f.rail)}${f.ro ? ` RO=${N(f.ro)}` : ''}`)
        } else {
          const [o, ...ins] = e.nodes
          out.push(`${nm} ${[...ins, o].map(nodeOut).join(' ')} ${f.gate.toUpperCase()} VDD=${N(f.vdd)} RO=${N(f.ro)}`)
        }
        break
      }
    }
  }
  out.push(...models)
  for (const a of analyses) {
    if (a.type === 'op') out.push('.op')
    else if (a.type === 'dc') out.push(`.dc ${a.source} ${N(a.start)} ${N(a.stop)} ${N(a.step)}`)
    else if (a.type === 'ac') out.push(`.ac dec ${N(a.perDecade)} ${N(a.fstart)} ${N(a.fstop)}`)
    else out.push(`.tran ${N(a.tstep ?? a.tstop / 500)} ${N(a.tstop)}${a.tmax ? ` 0 ${N(a.tmax)}` : ''}${a.uic ? ' uic' : ''}`)
  }
  if (opts.comments && circuit.elements.some((e) => e.kind === 'S' || e.kind === 'B')) {
    out.push('* S (ON/OFF/TIMED switches) and X (OPAMP, gates) lines are kElec extensions.')
  }
  out.push('.end')
  return out.join('\n') + '\n'
}
