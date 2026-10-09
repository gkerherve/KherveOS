// HDL export: structural / dataflow Verilog and VHDL from a circuit or a state machine, with test-bench stubs. Pure.

import { HEX_SEGMENTS, SEGMENT_NAMES, busNames, defOf, propNum, shapeOf, signalName, type Doc, type Part } from './model.ts'
import { extractNets, pinKey, type Extracted } from './netlist.ts'
import { analyseFsm, assignStates, initialState, type Fsm } from './fsm.ts'
import { parseMemory } from './sim.ts'
import type { Step } from './file.ts'

export type Lang = 'verilog' | 'vhdl'

const VERILOG_WORDS = new Set('always and assign automatic begin buf case casex casez cmos deassign default defparam disable edge else end endcase endfunction endmodule endprimitive endspecify endtable endtask event for force forever fork function highz0 highz1 if ifnone initial inout input integer join large macromodule medium module nand negedge nmos nor not notif0 notif1 or output parameter pmos posedge primitive pull0 pull1 pulldown pullup rcmos real realtime reg release repeat rnmos rpmos rtran rtranif0 rtranif1 scalared signed small specify specparam strong0 strong1 supply0 supply1 table task time tran tranif0 tranif1 tri tri0 tri1 triand trior trireg unsigned vectored wait wand weak0 weak1 while wire wor xnor xor'.split(' '))
const VHDL_WORDS = new Set('abs access after alias all and architecture array assert attribute begin block body buffer bus case component configuration constant disconnect downto else elsif end entity exit file for function generate generic group guarded if impure in inertial inout is label library linkage literal loop map mod nand new next nor not null of on open or others out package port postponed procedure process pure range record register reject rem report return rol ror select severity shared signal sla sll sra srl subtype then to transport type unaffected units until use variable wait when while with xnor xor'.split(' '))

export function sanitize(name: string, lang: Lang): string {
  let s = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_')
  if (!s || /^[0-9_]/.test(s)) s = `n_${s}`
  if (lang === 'vhdl') s = s.replace(/_$/, '')
  if ((lang === 'verilog' ? VERILOG_WORDS : VHDL_WORDS).has(lang === 'vhdl' ? s.toLowerCase() : s)) s += '_x'
  return s || 'n'
}

interface Model {
  ex: Extracted
  lang: Lang
  /** unique identifier of each net */
  names: string[]
  inputs: { name: string; net: number }[]
  outputs: { name: string; net: number }[]
  consts: { net: number; value: string }[]
  /** nets that are neither ports nor constants */
  internal: number[]
}

function buildModel(doc: Doc, lang: Lang): Model {
  const ex = extractNets(doc)
  const used = new Set<string>()
  const names = ex.nets.map((n) => {
    let s = sanitize(n.name, lang)
    const key = lang === 'vhdl' ? (x: string) => x.toLowerCase() : (x: string) => x
    for (let i = 2; used.has(key(s)); i++) s = `${sanitize(n.name, lang)}_${i}`
    used.add(key(s))
    return s
  })
  const inputs: Model['inputs'] = []
  const outputs: Model['outputs'] = []
  const consts: Model['consts'] = []
  const isPort = new Set<number>()
  const add = (list: { name: string; net: number }[], net: number | undefined) => {
    if (net === undefined || isPort.has(net)) return
    isPort.add(net)
    list.push({ name: names[net], net })
  }
  for (const p of doc.parts) {
    const net = (pin: string) => ex.pinNet.get(pinKey(p.ref, pin))
    if (p.kind === 'switch' || p.kind === 'button' || p.kind === 'clock') add(inputs, net('Y'))
    else if (p.kind === 'const') { const n = net('Y'); if (n !== undefined && !isPort.has(n)) { isPort.add(n); consts.push({ net: n, value: p.props.value || '1' }) } }
  }
  for (const p of doc.parts) {
    const net = (pin: string) => ex.pinNet.get(pinKey(p.ref, pin))
    if (p.kind === 'led') add(outputs, net('A'))
    else if (p.kind === 'seg7') SEGMENT_NAMES.forEach((s) => add(outputs, net(s)))
    else if (p.kind === 'hex' || p.kind === 'probe') for (const pin of shapeOf(p).pins) add(outputs, net(pin.name))
  }
  const internal = ex.nets.map((_, i) => i).filter((i) => !isPort.has(i))
  return { ex, lang, names, inputs, outputs, consts, internal }
}

/** How a part's pin is written in the HDL: a net name, or a constant for an unconnected input. */
function pinRef(m: Model, p: Part, pin: string): string {
  const n = m.ex.pinNet.get(pinKey(p.ref, pin))
  const def = shapeOf(p).pins.find((q) => q.name === pin)
  const lonely = n === undefined || (m.ex.nets[n].pins.length <= 1 && !m.ex.nets[n].labelled)
  if (lonely) {
    if (def?.dir === 'out') return m.lang === 'verilog' ? `${sanitize(p.ref, 'verilog')}_${pin}_nc` : `${sanitize(p.ref, 'vhdl')}_${pin}_nc`
    const v = def?.def
    return m.lang === 'verilog' ? (v === undefined ? "1'bx" : `1'b${v}`) : (v === undefined ? "'X'" : `'${v}'`)
  }
  const nm = m.names[n!]
  return m.lang === 'vhdl' && !m.inputs.some((i) => i.net === n) ? `s_${nm}` : nm
}

const connected = (m: Model, p: Part, pin: string): boolean => {
  const n = m.ex.pinNet.get(pinKey(p.ref, pin))
  return n !== undefined && (m.ex.nets[n].pins.length > 1 || m.ex.nets[n].labelled)
}

const ids = (p: Part, lang: Lang) => sanitize(p.ref, lang).toLowerCase()

// ------------------------------------------------------------------------------ Verilog

const GATE_PRIM: Record<string, string> = { and: 'and', or: 'or', nand: 'nand', nor: 'nor', xor: 'xor', xnor: 'xnor', not: 'not', buf: 'buf' }

function verilogPart(m: Model, p: Part, out: string[], decl: string[]): void {
  const r = (pin: string) => pinRef(m, p, pin)
  const id = ids(p, 'verilog')
  const rl = (names: string[]) => names.map(r)
  const concat = (names: string[]) => (names.length === 1 ? r(names[0]) : `{${rl(names).join(', ')}}`)
  const bitsOf = (prefix: string, n: number) => busNames(prefix, n)
  const dflt = (pin: string) => `${r(pin)}`
  void dflt
  switch (p.kind) {
    case 'buf': case 'not': out.push(`  ${GATE_PRIM[p.kind]} ${id} (${r('Y')}, ${r('A')});`); break
    case 'and': case 'or': case 'nand': case 'nor': case 'xor': case 'xnor': {
      const n = propNum(p, 'inputs', 2, 2, 8)
      out.push(`  ${GATE_PRIM[p.kind]} ${id} (${r('Y')}, ${['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].slice(0, n).map(r).join(', ')});`)
      break
    }
    case 'tribuf': out.push(`  assign ${r('Y')} = ${r('EN')} ? ${r('A')} : 1'bz;`); break
    case 'mux': {
      const s = propNum(p, 'select', 1, 1, 3)
      const sel = concat(busNames('S', s))
      let e = "1'bx"
      for (let i = (1 << s) - 1; i >= 0; i--) e = `(${sel} == ${s}'d${i}) ? ${r(`D${i}`)} : ${i === (1 << s) - 1 ? "1'bx" : e}`
      out.push(`  assign ${r('Y')} = ${e};`)
      break
    }
    case 'demux': {
      const s = propNum(p, 'select', 1, 1, 3)
      const sel = concat(busNames('S', s))
      for (let i = 0; i < 1 << s; i++) out.push(`  assign ${r(`Y${i}`)} = (${sel} == ${s}'d${i}) ? ${r('D')} : 1'b0;`)
      break
    }
    case 'decoder': {
      const n = propNum(p, 'bits', 2, 1, 3)
      const addr = concat(bitsOf('A', n))
      const low = p.props.active === 'low'
      for (let i = 0; i < 1 << n; i++) out.push(`  assign ${r(`Y${i}`)} = ${low ? '~' : ''}(${r('EN')} & (${addr} == ${n}'d${i}));`)
      break
    }
    case 'encoder': {
      const n = propNum(p, 'bits', 2, 1, 3)
      let e = `${n}'d0`
      for (let i = 1; i < 1 << n; i++) e = `${r(`I${i}`)} ? ${n}'d${i} : ${e}`
      out.push(`  assign ${concat(bitsOf('A', n))} = ${e};`)
      out.push(`  assign ${r('V')} = |{${Array.from({ length: 1 << n }, (_, i) => r(`I${i}`)).join(', ')}};`)
      break
    }
    case 'bcd7': {
      decl.push(`  reg [6:0] ${id}_seg;`)
      const low = p.props.active === 'low'
      out.push(`  always @* begin`, `    case (${concat(bitsOf('D', 4))})`)
      for (let d = 0; d < 16; d++) {
        const on = d < 10 || p.props.hex === 'yes'
        const word = SEGMENT_NAMES.map((s) => (on && HEX_SEGMENTS[d].includes(s) ? '1' : '0')).join('')
        out.push(`      4'd${d}: ${id}_seg = 7'b${low ? word.replace(/[01]/g, (c) => (c === '1' ? '0' : '1')) : word};`)
      }
      out.push(`      default: ${id}_seg = 7'bx;`, '    endcase', '  end')
      SEGMENT_NAMES.forEach((s, i) => out.push(`  assign ${r(s)} = ${id}_seg[${6 - i}];`))
      break
    }
    case 'halfadder': out.push(`  assign ${r('S')} = ${r('A')} ^ ${r('B')};`, `  assign ${r('C')} = ${r('A')} & ${r('B')};`); break
    case 'fulladder':
      out.push(`  assign ${r('S')} = ${r('A')} ^ ${r('B')} ^ ${r('CI')};`, `  assign ${r('CO')} = (${r('A')} & ${r('B')}) | (${r('CI')} & (${r('A')} ^ ${r('B')}));`)
      break
    case 'adder': {
      const n = propNum(p, 'bits', 4, 1, 8)
      out.push(`  assign {${r('CO')}, ${concat(bitsOf('S', n))}} = {1'b0, ${concat(bitsOf('A', n))}} + {1'b0, ${concat(bitsOf('B', n))}} + ${r('CI')};`)
      break
    }
    case 'comparator': {
      const n = propNum(p, 'bits', 4, 1, 8)
      const a = concat(bitsOf('A', n)), b = concat(bitsOf('B', n))
      out.push(`  assign ${r('GT')} = ${a} > ${b};`, `  assign ${r('EQ')} = ${a} == ${b};`, `  assign ${r('LT')} = ${a} < ${b};`)
      break
    }
    case 'srlatch':
      if (p.props.type === 'nand') out.push(`  assign ${r('Q')} = ~(${r('S')} & ${r('QN')});`, `  assign ${r('QN')} = ~(${r('R')} & ${r('Q')});`)
      else out.push(`  assign ${r('Q')} = ~(${r('R')} | ${r('QN')});`, `  assign ${r('QN')} = ~(${r('S')} | ${r('Q')});`)
      break
    case 'dlatch':
      decl.push(`  reg ${id}_q;`)
      out.push(`  always @* if (${r('EN')}) ${id}_q = ${r('D')};`, `  assign ${r('Q')} = ${id}_q;`, `  assign ${r('QN')} = ~${id}_q;`)
      break
    case 'dff': case 'jkff': case 'tff': {
      decl.push(`  reg ${id}_q = 1'b${p.props.init === '1' ? 1 : 0};`)
      const edge = p.props.edge === 'falling' ? 'negedge' : 'posedge'
      const hasS = connected(m, p, 'S'), hasR = connected(m, p, 'R')
      const sens = [`${edge} ${r('CLK')}`, ...(hasS ? [`posedge ${r('S')}`] : []), ...(hasR ? [`posedge ${r('R')}`] : [])].join(' or ')
      const en = p.props.en === 'yes' ? `if (${r('EN')}) ` : ''
      const next = p.kind === 'dff' ? `${id}_q <= ${r('D')};` : p.kind === 'tff' ? `if (${r('T')}) ${id}_q <= ~${id}_q;` : `case ({${r('J')}, ${r('K')}}) 2'b01: ${id}_q <= 1'b0; 2'b10: ${id}_q <= 1'b1; 2'b11: ${id}_q <= ~${id}_q; default: ; endcase`
      out.push(`  always @(${sens})`)
      if (hasR) out.push(`    if (${r('R')}) ${id}_q <= 1'b0;`, `    else ${hasS ? `if (${r('S')}) ${id}_q <= 1'b1;\n    else ` : ''}${en}begin ${next} end`)
      else if (hasS) out.push(`    if (${r('S')}) ${id}_q <= 1'b1;`, `    else ${en}begin ${next} end`)
      else out.push(`    ${en}begin ${next} end`)
      out.push(`  assign ${r('Q')} = ${id}_q;`, `  assign ${r('QN')} = ~${id}_q;`)
      break
    }
    case 'register': {
      const n = propNum(p, 'bits', 4, 1, 8)
      decl.push(`  reg [${n - 1}:0] ${id}_q = ${n}'d${Number(p.props.init) || 0};`)
      out.push(`  always @(posedge ${r('CLK')} or posedge ${r('CLR')})`, `    if (${r('CLR')}) ${id}_q <= ${n}'d${Number(p.props.init) || 0};`, `    else if (${r('EN')}) ${id}_q <= ${concat(bitsOf('D', n))};`)
      bitsOf('Q', n).forEach((q, i) => out.push(`  assign ${r(q)} = ${id}_q[${n - 1 - i}];`))
      break
    }
    case 'counter': {
      const n = propNum(p, 'bits', 4, 1, 8)
      const mod = (p.props.modulus ?? '').trim() ? Math.max(2, propNum(p, 'modulus', 2 ** n, 2, 256)) : 2 ** n
      const init = (Number(p.props.init) || 0) % mod
      decl.push(`  reg [${n - 1}:0] ${id}_q = ${n}'d${init};`)
      out.push(
        `  always @(posedge ${r('CLK')} or posedge ${r('RST')})`, `    if (${r('RST')}) ${id}_q <= ${n}'d${init};`,
        `    else if (${r('LD')}) ${id}_q <= ${concat(bitsOf('D', n))};`,
        `    else if (${r('EN')}) ${id}_q <= ${r('UP')} ? ((${id}_q == ${n}'d${mod - 1}) ? ${n}'d0 : ${id}_q + 1'b1) : ((${id}_q == ${n}'d0) ? ${n}'d${mod - 1} : ${id}_q - 1'b1);`,
      )
      bitsOf('Q', n).forEach((q, i) => out.push(`  assign ${r(q)} = ${id}_q[${n - 1 - i}];`))
      out.push(`  assign ${r('CO')} = ${r('EN')} & (${r('UP')} ? (${id}_q == ${n}'d${mod - 1}) : (${id}_q == ${n}'d0));`)
      break
    }
    case 'shift': {
      const n = propNum(p, 'bits', 4, 1, 8)
      const init = (p.props.init ?? '').replace(/[^01]/g, '').padStart(n, '0').slice(-n)
      decl.push(`  reg [${n - 1}:0] ${id}_q = ${n}'b${init};`)
      const par = p.props.parallel === 'yes'
      const right = (p.props.dir ?? 'right') !== 'left'
      const shifted = right ? `{${r('SIN')}, ${id}_q[${n - 1}:1]}` : `{${id}_q[${n - 2}:0], ${r('SIN')}}`
      out.push(`  always @(posedge ${r('CLK')} or posedge ${r('RST')})`, `    if (${r('RST')}) ${id}_q <= ${n}'b${init};`)
      out.push(`    else if (${r('EN')}) ${id}_q <= ${par ? `${r('LD')} ? ${concat(bitsOf('D', n))} : ` : ''}${n === 1 ? r('SIN') : shifted};`)
      bitsOf('Q', n).forEach((q, i) => out.push(`  assign ${r(q)} = ${id}_q[${n - 1 - i}];`))
      break
    }
    case 'rom': {
      const a = propNum(p, 'abits', 4, 1, 8), d = propNum(p, 'dbits', 8, 1, 8)
      decl.push(`  reg [${d - 1}:0] ${id}_mem [0:${(1 << a) - 1}];`)
      const words = parseMemory(p.props.data ?? '', 1 << a, d)
      out.push('  initial begin', ...words.map((w, i) => `    ${id}_mem[${i}] = ${d}'h${w.toString(16)};`), '  end')
      out.push(`  wire [${d - 1}:0] ${id}_word = ${id}_mem[${concat(bitsOf('A', a))}];`)
      bitsOf('D', d).forEach((q, i) => out.push(`  assign ${r(q)} = ${id}_word[${d - 1 - i}];`))
      break
    }
    case 'ram': {
      const a = propNum(p, 'abits', 3, 1, 6), d = propNum(p, 'dbits', 4, 1, 8)
      decl.push(`  reg [${d - 1}:0] ${id}_mem [0:${(1 << a) - 1}];`)
      const words = parseMemory(p.props.data ?? '', 1 << a, d)
      out.push('  initial begin', ...words.map((w, i) => `    ${id}_mem[${i}] = ${d}'h${w.toString(16)};`), '  end')
      out.push(`  always @(posedge ${r('CLK')}) if (${r('WE')}) ${id}_mem[${concat(bitsOf('A', a))}] <= ${concat(bitsOf('DI', d))};`)
      out.push(`  wire [${d - 1}:0] ${id}_word = ${id}_mem[${concat(bitsOf('A', a))}];`)
      bitsOf('DO', d).forEach((q, i) => out.push(`  assign ${r(q)} = ${id}_word[${d - 1 - i}];`))
      break
    }
    case 'pull': out.push(`  ${p.props.level === '0' ? 'pulldown' : 'pullup'} (${r('P')});`); break
    default: break // inputs, outputs and constants are ports
  }
}

export function toVerilog(doc: Doc, name = 'circuit'): string {
  const m = buildModel(doc, 'verilog')
  const mod = sanitize(name, 'verilog')
  const ports = [...m.inputs.map((i) => `input ${i.name}`), ...m.outputs.map((o) => `output ${o.name}`)]
  const decl: string[] = []
  const body: string[] = []
  const unconnected = new Set<string>()
  for (const p of doc.parts) verilogPart(m, p, body, decl)
  for (const line of body) for (const mt of line.matchAll(/\b([A-Za-z0-9_]+_nc)\b/g)) unconnected.add(mt[1])
  const wires = [...m.internal.map((i) => m.names[i]), ...unconnected]
  const out: string[] = []
  out.push(`// ${name}: generated by kDigital`, `module ${mod}(`, ports.map((p) => `  ${p}`).join(',\n') || '  // no ports', ');')
  if (wires.length) out.push(`  wire ${wires.join(', ')};`)
  for (const c of m.consts) out.push(`  wire ${m.names[c.net]};`, `  assign ${m.names[c.net]} = ${c.value === 'X' ? "1'bx" : c.value === 'Z' ? "1'bz" : `1'b${c.value}`};`)
  out.push(...decl, ...body, 'endmodule', '')
  return out.join('\n')
}

// ------------------------------------------------------------------------------ VHDL

function vhdlPart(m: Model, p: Part, out: string[], decl: string[]): void {
  const r = (pin: string) => pinRef(m, p, pin)
  const id = ids(p, 'vhdl')
  const cat = (names: string[]) => names.map(r).join(' & ')
  const bitsOf = (prefix: string, n: number) => busNames(prefix, n)
  const bin = (v: number, n: number) => `"${v.toString(2).padStart(n, '0')}"`
  switch (p.kind) {
    case 'buf': out.push(`  ${r('Y')} <= ${r('A')};`); break
    case 'not': out.push(`  ${r('Y')} <= not ${r('A')};`); break
    case 'and': case 'or': case 'nand': case 'nor': case 'xor': case 'xnor': {
      const n = propNum(p, 'inputs', 2, 2, 8)
      const op = p.kind === 'nand' ? 'and' : p.kind === 'nor' ? 'or' : p.kind === 'xnor' ? 'xor' : p.kind
      const expr = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].slice(0, n).map(r).join(` ${op} `)
      out.push(`  ${r('Y')} <= ${p.kind === 'nand' || p.kind === 'nor' || p.kind === 'xnor' ? `not (${expr})` : expr};`)
      break
    }
    case 'tribuf': out.push(`  ${r('Y')} <= ${r('A')} when ${r('EN')} = '1' else 'Z';`); break
    case 'mux': {
      const s = propNum(p, 'select', 1, 1, 3)
      const sel = cat(busNames('S', s))
      const arms = Array.from({ length: 1 << s }, (_, i) => `${r(`D${i}`)} when (${sel}) = ${bin(i, s)}`)
      out.push(`  ${r('Y')} <= ${arms.join(' else ')} else 'X';`)
      break
    }
    case 'demux': {
      const s = propNum(p, 'select', 1, 1, 3)
      for (let i = 0; i < 1 << s; i++) out.push(`  ${r(`Y${i}`)} <= ${r('D')} when (${cat(busNames('S', s))}) = ${bin(i, s)} else '0';`)
      break
    }
    case 'decoder': {
      const n = propNum(p, 'bits', 2, 1, 3)
      const low = p.props.active === 'low'
      for (let i = 0; i < 1 << n; i++) out.push(`  ${r(`Y${i}`)} <= ${low ? "'0'" : "'1'"} when ${r('EN')} = '1' and (${cat(bitsOf('A', n))}) = ${bin(i, n)} else ${low ? "'1'" : "'0'"};`)
      break
    }
    case 'encoder': {
      const n = propNum(p, 'bits', 2, 1, 3)
      const ins = Array.from({ length: 1 << n }, (_, i) => r(`I${i}`))
      out.push(`  process(${ins.join(', ')}) begin`)
      for (let i = (1 << n) - 1; i >= 1; i--) out.push(`    ${i === (1 << n) - 1 ? 'if' : 'elsif'} ${ins[i]} = '1' then ${bitsOf('A', n).map((a, k) => `${r(a)} <= '${(i >> (n - 1 - k)) & 1}';`).join(' ')}`)
      out.push(`    else ${bitsOf('A', n).map((a) => `${r(a)} <= '0';`).join(' ')}`, '    end if;', '  end process;')
      out.push(`  ${r('V')} <= ${ins.join(' or ')};`)
      break
    }
    case 'bcd7': {
      decl.push(`  signal ${id}_seg : std_logic_vector(6 downto 0);`)
      const low = p.props.active === 'low'
      out.push(`  process(${bitsOf('D', 4).map(r).join(', ')}) begin`, `    case (${cat(bitsOf('D', 4))}) is`)
      for (let d = 0; d < 16; d++) {
        const on = d < 10 || p.props.hex === 'yes'
        const word = SEGMENT_NAMES.map((s) => (on && HEX_SEGMENTS[d].includes(s) ? '1' : '0')).join('')
        out.push(`      when ${bin(d, 4)} => ${id}_seg <= "${low ? word.replace(/[01]/g, (c) => (c === '1' ? '0' : '1')) : word}";`)
      }
      out.push(`      when others => ${id}_seg <= "XXXXXXX";`, '    end case;', '  end process;')
      SEGMENT_NAMES.forEach((s, i) => out.push(`  ${r(s)} <= ${id}_seg(${6 - i});`))
      break
    }
    case 'halfadder': out.push(`  ${r('S')} <= ${r('A')} xor ${r('B')};`, `  ${r('C')} <= ${r('A')} and ${r('B')};`); break
    case 'fulladder': out.push(`  ${r('S')} <= ${r('A')} xor ${r('B')} xor ${r('CI')};`, `  ${r('CO')} <= (${r('A')} and ${r('B')}) or (${r('CI')} and (${r('A')} xor ${r('B')}));`); break
    case 'adder': {
      const n = propNum(p, 'bits', 4, 1, 8)
      decl.push(`  signal ${id}_c : std_logic_vector(${n} downto 0);`)
      out.push(`  ${id}_c(0) <= ${r('CI')};`)
      for (let i = 0; i < n; i++) {
        const a = r(`A${i}`), b = r(`B${i}`)
        out.push(`  ${r(`S${i}`)} <= ${a} xor ${b} xor ${id}_c(${i});`, `  ${id}_c(${i + 1}) <= (${a} and ${b}) or (${id}_c(${i}) and (${a} xor ${b}));`)
      }
      out.push(`  ${r('CO')} <= ${id}_c(${n});`)
      break
    }
    case 'comparator': {
      const n = propNum(p, 'bits', 4, 1, 8)
      const a = `unsigned(${cat(bitsOf('A', n))})`, b = `unsigned(${cat(bitsOf('B', n))})`
      out.push(`  ${r('GT')} <= '1' when ${a} > ${b} else '0';`, `  ${r('EQ')} <= '1' when ${a} = ${b} else '0';`, `  ${r('LT')} <= '1' when ${a} < ${b} else '0';`)
      break
    }
    case 'srlatch':
      if (p.props.type === 'nand') out.push(`  ${r('Q')} <= not (${r('S')} and ${r('QN')});`, `  ${r('QN')} <= not (${r('R')} and ${r('Q')});`)
      else out.push(`  ${r('Q')} <= not (${r('R')} or ${r('QN')});`, `  ${r('QN')} <= not (${r('S')} or ${r('Q')});`)
      break
    case 'dlatch':
      decl.push(`  signal ${id}_q : std_logic := '${p.props.init === '1' ? 1 : 0}';`)
      out.push(`  process(${r('D')}, ${r('EN')}) begin`, `    if ${r('EN')} = '1' then ${id}_q <= ${r('D')}; end if;`, '  end process;', `  ${r('Q')} <= ${id}_q;`, `  ${r('QN')} <= not ${id}_q;`)
      break
    case 'dff': case 'jkff': case 'tff': {
      decl.push(`  signal ${id}_q : std_logic := '${p.props.init === '1' ? 1 : 0}';`)
      const edge = p.props.edge === 'falling' ? 'falling_edge' : 'rising_edge'
      const hasS = connected(m, p, 'S'), hasR = connected(m, p, 'R')
      const en = p.props.en === 'yes' ? `if ${r('EN')} = '1' then ` : ''
      const enEnd = p.props.en === 'yes' ? ' end if;' : ''
      const next = p.kind === 'dff' ? `${id}_q <= ${r('D')};` : p.kind === 'tff' ? `if ${r('T')} = '1' then ${id}_q <= not ${id}_q; end if;` : `if ${r('J')} = '1' and ${r('K')} = '1' then ${id}_q <= not ${id}_q; elsif ${r('J')} = '1' then ${id}_q <= '1'; elsif ${r('K')} = '1' then ${id}_q <= '0'; end if;`
      out.push(`  process(${[r('CLK'), ...(hasS ? [r('S')] : []), ...(hasR ? [r('R')] : [])].join(', ')}) begin`)
      let first = true
      if (hasR) { out.push(`    if ${r('R')} = '1' then ${id}_q <= '0';`); first = false }
      if (hasS) { out.push(`    ${first ? 'if' : 'elsif'} ${r('S')} = '1' then ${id}_q <= '1';`); first = false }
      out.push(`    ${first ? 'if' : 'elsif'} ${edge}(${r('CLK')}) then ${en}${next}${enEnd}`, '    end if;', '  end process;')
      out.push(`  ${r('Q')} <= ${id}_q;`, `  ${r('QN')} <= not ${id}_q;`)
      break
    }
    case 'register': {
      const n = propNum(p, 'bits', 4, 1, 8)
      decl.push(`  signal ${id}_q : std_logic_vector(${n - 1} downto 0) := std_logic_vector(to_unsigned(${Number(p.props.init) || 0}, ${n}));`)
      out.push(`  process(${r('CLK')}, ${r('CLR')}) begin`, `    if ${r('CLR')} = '1' then ${id}_q <= std_logic_vector(to_unsigned(${Number(p.props.init) || 0}, ${n}));`,
        `    elsif rising_edge(${r('CLK')}) then if ${r('EN')} = '1' then ${id}_q <= ${cat(bitsOf('D', n))}; end if;`, '    end if;', '  end process;')
      bitsOf('Q', n).forEach((q, i) => out.push(`  ${r(q)} <= ${id}_q(${n - 1 - i});`))
      break
    }
    case 'counter': {
      const n = propNum(p, 'bits', 4, 1, 8)
      const mod = (p.props.modulus ?? '').trim() ? Math.max(2, propNum(p, 'modulus', 2 ** n, 2, 256)) : 2 ** n
      const init = (Number(p.props.init) || 0) % mod
      decl.push(`  signal ${id}_q : unsigned(${n - 1} downto 0) := to_unsigned(${init}, ${n});`)
      out.push(
        `  process(${r('CLK')}, ${r('RST')}) begin`, `    if ${r('RST')} = '1' then ${id}_q <= to_unsigned(${init}, ${n});`,
        `    elsif rising_edge(${r('CLK')}) then`, `      if ${r('LD')} = '1' then ${id}_q <= unsigned(${cat(bitsOf('D', n))});`,
        `      elsif ${r('EN')} = '1' then`, `        if ${r('UP')} = '1' then`, `          if ${id}_q = ${mod - 1} then ${id}_q <= (others => '0'); else ${id}_q <= ${id}_q + 1; end if;`,
        `        else`, `          if ${id}_q = 0 then ${id}_q <= to_unsigned(${mod - 1}, ${n}); else ${id}_q <= ${id}_q - 1; end if;`, '        end if;', '      end if;', '    end if;', '  end process;',
      )
      bitsOf('Q', n).forEach((q, i) => out.push(`  ${r(q)} <= ${id}_q(${n - 1 - i});`))
      out.push(`  ${r('CO')} <= '1' when ${r('EN')} = '1' and ((${r('UP')} = '1' and ${id}_q = ${mod - 1}) or (${r('UP')} = '0' and ${id}_q = 0)) else '0';`)
      break
    }
    case 'shift': {
      const n = propNum(p, 'bits', 4, 1, 8)
      const init = (p.props.init ?? '').replace(/[^01]/g, '').padStart(n, '0').slice(-n)
      decl.push(`  signal ${id}_q : std_logic_vector(${n - 1} downto 0) := "${init}";`)
      const par = p.props.parallel === 'yes'
      const right = (p.props.dir ?? 'right') !== 'left'
      const shifted = n === 1 ? r('SIN') : right ? `${r('SIN')} & ${id}_q(${n - 1} downto 1)` : `${id}_q(${n - 2} downto 0) & ${r('SIN')}`
      out.push(`  process(${r('CLK')}, ${r('RST')}) begin`, `    if ${r('RST')} = '1' then ${id}_q <= "${init}";`, `    elsif rising_edge(${r('CLK')}) then`,
        `      if ${r('EN')} = '1' then`, ...(par ? [`        if ${r('LD')} = '1' then ${id}_q <= ${cat(bitsOf('D', n))}; else ${id}_q <= ${shifted}; end if;`] : [`        ${id}_q <= ${shifted};`]), '      end if;', '    end if;', '  end process;')
      bitsOf('Q', n).forEach((q, i) => out.push(`  ${r(q)} <= ${id}_q(${n - 1 - i});`))
      break
    }
    case 'rom': case 'ram': {
      const a = p.kind === 'rom' ? propNum(p, 'abits', 4, 1, 8) : propNum(p, 'abits', 3, 1, 6)
      const d = p.kind === 'rom' ? propNum(p, 'dbits', 8, 1, 8) : propNum(p, 'dbits', 4, 1, 8)
      const words = parseMemory(p.props.data ?? '', 1 << a, d)
      decl.push(`  type ${id}_t is array (0 to ${(1 << a) - 1}) of std_logic_vector(${d - 1} downto 0);`)
      decl.push(`  signal ${id}_mem : ${id}_t := (${words.map((w) => `"${w.toString(2).padStart(d, '0')}"`).join(', ')});`)
      const addr = `to_integer(unsigned(${cat(bitsOf('A', a))}))`
      if (p.kind === 'ram') out.push(`  process(${r('CLK')}) begin`, `    if rising_edge(${r('CLK')}) then if ${r('WE')} = '1' then ${id}_mem(${addr}) <= ${cat(bitsOf('DI', d))}; end if; end if;`, '  end process;')
      bitsOf(p.kind === 'rom' ? 'D' : 'DO', d).forEach((q, i) => out.push(`  ${r(q)} <= ${id}_mem(${addr})(${d - 1 - i});`))
      break
    }
    case 'pull': out.push(`  ${r('P')} <= '${p.props.level === '0' ? 'L' : 'H'}';`); break
    default: break
  }
}

export function toVhdl(doc: Doc, name = 'circuit'): string {
  const m = buildModel(doc, 'vhdl')
  const ent = sanitize(name, 'vhdl')
  const decl: string[] = []
  const body: string[] = []
  for (const p of doc.parts) vhdlPart(m, p, body, decl)
  const unconnected = new Set<string>()
  for (const line of [...body, ...decl]) for (const mt of line.matchAll(/\b([A-Za-z0-9_]+_nc)\b/g)) unconnected.add(mt[1])
  const ports = [...m.inputs.map((i) => `    ${i.name} : in std_logic`), ...m.outputs.map((o) => `    ${o.name} : out std_logic`)]
  const signals = [...m.internal.map((i) => m.names[i]), ...m.outputs.map((o) => o.name), ...m.consts.map((c) => m.names[c.net])].map((n) => `  signal s_${n} : std_logic;`)
  const out: string[] = []
  out.push(`-- ${name}: generated by kDigital`, 'library ieee;', 'use ieee.std_logic_1164.all;', 'use ieee.numeric_std.all;', '', `entity ${ent} is`)
  out.push(ports.length ? `  port (\n${ports.join(';\n')}\n  );` : '  -- no ports', `end entity ${ent};`, '', `architecture rtl of ${ent} is`)
  out.push(...signals, ...[...unconnected].map((n) => `  signal ${n} : std_logic;`), ...decl, 'begin')
  for (const c of m.consts) out.push(`  s_${m.names[c.net]} <= '${c.value}';`)
  out.push(...body)
  for (const o of m.outputs) out.push(`  ${o.name} <= s_${o.name};`)
  out.push(`end architecture rtl;`, '')
  return out.join('\n')
}

// ------------------------------------------------------------------------------ test benches

interface Bench { inputs: { name: string; part: Part }[]; outputs: string[]; clocks: { name: string; period: number; high: number; offset: number }[] }

function benchInfo(doc: Doc, lang: Lang): Bench & { model: Model } {
  const m = buildModel(doc, lang)
  const inputs = m.inputs.map((i) => ({ name: i.name, part: doc.parts.find((p) => ['switch', 'button', 'clock'].includes(p.kind) && m.ex.pinNet.get(pinKey(p.ref, 'Y')) === i.net)! }))
  const clocks = inputs.filter((i) => i.part.kind === 'clock').map((i) => {
    const period = propNum(i.part, 'period', 20, 2, 1000000)
    const duty = propNum(i.part, 'duty', 50, 1, 99)
    const high = Math.min(period - 1, Math.max(1, Math.round((period * duty) / 100)))
    return { name: i.name, period, high, offset: propNum(i.part, 'offset', 0, 0, 1000000) }
  })
  return { model: m, inputs, outputs: m.outputs.map((o) => o.name), clocks }
}

function stimulusFor(doc: Doc, b: Bench, steps: readonly Step[] | undefined, until: number | undefined): { t: number; sets: [string, string][] }[] {
  const toName = (key: string): string | null => {
    const part = doc.parts.find((p) => signalName(p) === key || p.ref === key)
    const hit = part && b.inputs.find((i) => i.part === part)
    return hit ? hit.name : b.inputs.find((i) => i.name === key)?.name ?? null
  }
  if (steps && steps.length) {
    return [...steps].sort((a, c) => a.t - c.t).map((s) => ({ t: s.t, sets: Object.entries(s.set).flatMap(([k, v]) => { const n = toName(k); return n ? [[n, String(v)] as [string, string]] : [] }) }))
  }
  const data = b.inputs.filter((i) => i.part.kind !== 'clock')
  if (data.length === 0) return []
  const rows = 1 << Math.min(data.length, 4)
  void until
  return Array.from({ length: rows }, (_, r) => ({ t: r * 20, sets: data.map((d, k) => [d.name, String((r >> (data.length - 1 - k)) & 1)] as [string, string]) }))
}

export function verilogTestbench(doc: Doc, name = 'circuit', steps?: readonly Step[], until?: number): string {
  const b = benchInfo(doc, 'verilog')
  const mod = sanitize(name, 'verilog')
  const plain = b.inputs.filter((i) => i.part.kind !== 'clock')
  const stim = stimulusFor(doc, b, steps, until)
  const end = until ?? (stim.length ? stim[stim.length - 1].t + 20 : 100)
  const out: string[] = []
  out.push('`timescale 1ns / 1ps', `module ${mod}_tb;`)
  for (const i of b.inputs) out.push(`  reg ${i.name} = 1'b${i.part.kind === 'clock' ? 0 : i.part.props.value === '1' ? 1 : 0};`)
  for (const o of b.outputs) out.push(`  wire ${o};`)
  out.push('', `  ${mod} dut (${[...b.inputs.map((i) => i.name), ...b.outputs].map((n) => `.${n}(${n})`).join(', ')});`, '')
  for (const c of b.clocks) {
    out.push(`  initial begin`, `    ${c.name} = 1'b0;`, ...(c.offset ? [`    #${c.offset};`] : []), `    forever begin #${c.period - c.high} ${c.name} = 1'b1; #${c.high} ${c.name} = 1'b0; end`, '  end')
  }
  out.push('', '  initial begin', `    $dumpfile("${mod}.vcd");`, `    $dumpvars(0, ${mod}_tb);`)
  let t = 0
  for (const s of stim) {
    if (s.t > t) { out.push(`    #${s.t - t};`); t = s.t }
    for (const [n, v] of s.sets) if (plain.some((p) => p.name === n)) out.push(`    ${n} = 1'b${v === '1' ? 1 : 0};`)
  }
  if (end > t) out.push(`    #${end - t};`)
  out.push('    $finish;', '  end', 'endmodule', '')
  return out.join('\n')
}

export function vhdlTestbench(doc: Doc, name = 'circuit', steps?: readonly Step[], until?: number): string {
  const b = benchInfo(doc, 'vhdl')
  const ent = sanitize(name, 'vhdl')
  const plain = b.inputs.filter((i) => i.part.kind !== 'clock')
  const stim = stimulusFor(doc, b, steps, until)
  const end = until ?? (stim.length ? stim[stim.length - 1].t + 20 : 100)
  const out: string[] = []
  out.push('library ieee;', 'use ieee.std_logic_1164.all;', '', `entity ${ent}_tb is end entity;`, '', `architecture sim of ${ent}_tb is`)
  for (const i of b.inputs) out.push(`  signal ${i.name} : std_logic := '${i.part.kind === 'clock' ? 0 : i.part.props.value === '1' ? 1 : 0}';`)
  for (const o of b.outputs) out.push(`  signal ${o} : std_logic;`)
  out.push('begin', `  dut : entity work.${ent} port map (${[...b.inputs.map((i) => i.name), ...b.outputs].map((n) => `${n} => ${n}`).join(', ')});`)
  for (const c of b.clocks) out.push(`  ${c.name}_gen : process begin${c.offset ? ` wait for ${c.offset} ns;` : ''} loop wait for ${c.period - c.high} ns; ${c.name} <= '1'; wait for ${c.high} ns; ${c.name} <= '0'; end loop; end process;`)
  out.push('  stimulus : process begin')
  let t = 0
  for (const s of stim) {
    if (s.t > t) { out.push(`    wait for ${s.t - t} ns;`); t = s.t }
    for (const [n, v] of s.sets) if (plain.some((p) => p.name === n)) out.push(`    ${n} <= '${v === '1' ? 1 : 0}';`)
  }
  out.push(`    wait for ${Math.max(1, end - t)} ns;`, '    assert false report "end of simulation" severity failure;', '  end process;', 'end architecture sim;', '')
  return out.join('\n')
}

// ------------------------------------------------------------------------------ state machines

function fsmInfo(fsm: Fsm) {
  const an = analyseFsm(fsm)
  const a = assignStates(fsm, 'binary')
  const width = a.bits.length
  const init = initialState(fsm)
  const stateNames = fsm.states.map((s) => s.name)
  return { an, a, width, init, stateNames }
}

const inputVec = (fsm: Fsm, bits: string) => (fsm.inputs.length === 1 ? bits : `{${fsm.inputs.map((_, k) => bits[k]).join(', ')}}`)
void inputVec

export function fsmToVerilog(fsm: Fsm, name?: string): string {
  const mod = sanitize(name ?? fsm.name, 'verilog')
  const { an, width, init } = fsmInfo(fsm)
  const n = fsm.inputs.length
  const ins = fsm.inputs.map((i) => sanitize(i, 'verilog'))
  const outs = fsm.outputs.map((o) => sanitize(o, 'verilog'))
  const S = (s: string) => `S_${sanitize(s, 'verilog').toUpperCase()}`
  const out: string[] = []
  out.push(`// ${fsm.name}: ${fsm.type === 'mealy' ? 'Mealy' : 'Moore'} machine generated by kDigital`)
  out.push(`module ${mod}(`, ['  input clk', '  input rst', ...ins.map((i) => `  input ${i}`), ...outs.map((o) => `  output reg ${o}`)].join(',\n'), ');')
  out.push(`  localparam [${width - 1}:0] ${fsm.states.map((s, i) => `${S(s.name)} = ${width}'d${i}`).join(', ')};`)
  out.push(`  reg [${width - 1}:0] state, next;`, '')
  out.push('  // state register (asynchronous reset to the initial state)', '  always @(posedge clk or posedge rst)', `    if (rst) state <= ${init ? S(init.name) : `${width}'d0`};`, '    else state <= next;', '')
  out.push('  // next state' + (fsm.type === 'mealy' ? ' and outputs' : ''), '  always @* begin', '    next = state;')
  if (fsm.type === 'mealy') outs.forEach((o) => out.push(`    ${o} = 1'b0;`))
  out.push('    case (state)')
  for (const s of fsm.states) {
    out.push(`      ${S(s.name)}: begin`)
    const rows = an.table.filter((r) => r.state === s.name)
    if (n === 0) {
      const r = rows[0]
      if (r) { out.push(`        next = ${S(r.next)};`); if (fsm.type === 'mealy') outs.forEach((o, k) => out.push(`        ${o} = 1'b${r.out[k] ?? 0};`)) }
    } else {
      out.push(`        case ({${ins.join(', ')}})`)
      for (const r of rows) {
        out.push(`          ${n}'b${r.inputBits}: begin next = ${S(r.next)};${fsm.type === 'mealy' ? ' ' + outs.map((o, k) => `${o} = 1'b${r.out[k] ?? 0};`).join(' ') : ''} end`)
      }
      out.push(`          default: next = ${S(s.name)};`, '        endcase')
    }
    out.push('      end')
  }
  out.push(`      default: next = ${init ? S(init.name) : `${width}'d0`};`, '    endcase', '  end')
  if (fsm.type === 'moore') {
    out.push('', '  // Moore outputs depend on the state only', '  always @* begin')
    outs.forEach((o) => out.push(`    ${o} = 1'b0;`))
    out.push('    case (state)')
    for (const s of fsm.states) out.push(`      ${S(s.name)}: begin ${outs.map((o, k) => `${o} = 1'b${s.out[k] ?? 0};`).join(' ')} end`)
    out.push('      default: ;', '    endcase', '  end')
  }
  out.push('endmodule', '')
  return out.join('\n')
}

export function fsmVerilogTestbench(fsm: Fsm, inputs: string, name?: string): string {
  const mod = sanitize(name ?? fsm.name, 'verilog')
  const ins = fsm.inputs.map((i) => sanitize(i, 'verilog'))
  const outs = fsm.outputs.map((o) => sanitize(o, 'verilog'))
  const n = ins.length
  const seq = inputs.split(/[\s,]+/).filter(Boolean)
  const out: string[] = ['`timescale 1ns / 1ps', `module ${mod}_tb;`, '  reg clk = 0, rst = 1;']
  ins.forEach((i) => out.push(`  reg ${i} = 0;`))
  outs.forEach((o) => out.push(`  wire ${o};`))
  out.push(`  ${mod} dut (${['.clk(clk)', '.rst(rst)', ...ins.map((i) => `.${i}(${i})`), ...outs.map((o) => `.${o}(${o})`)].join(', ')});`, '  always #5 clk = ~clk;', '  initial begin', `    $dumpfile("${mod}.vcd"); $dumpvars(0, ${mod}_tb);`, '    #12 rst = 0;')
  for (const s of seq) {
    const bits = s.replace(/[^01]/g, '').padStart(n, '0')
    out.push(`    ${ins.map((i, k) => `${i} = 1'b${bits[k]};`).join(' ')} #10;`)
  }
  out.push('    $finish;', '  end', 'endmodule', '')
  return out.join('\n')
}

export function fsmToVhdl(fsm: Fsm, name?: string): string {
  const ent = sanitize(name ?? fsm.name, 'vhdl')
  const { an, init } = fsmInfo(fsm)
  const n = fsm.inputs.length
  const ins = fsm.inputs.map((i) => sanitize(i, 'vhdl'))
  const outs = fsm.outputs.map((o) => sanitize(o, 'vhdl'))
  const S = (s: string) => `s_${sanitize(s, 'vhdl').toLowerCase()}`
  const out: string[] = []
  out.push(`-- ${fsm.name}: ${fsm.type === 'mealy' ? 'Mealy' : 'Moore'} machine generated by kDigital`, 'library ieee;', 'use ieee.std_logic_1164.all;', '', `entity ${ent} is`, '  port (')
  out.push(['    clk : in std_logic', '    rst : in std_logic', ...ins.map((i) => `    ${i} : in std_logic`), ...outs.map((o) => `    ${o} : out std_logic`)].join(';\n'), '  );', `end entity ${ent};`, '')
  out.push(`architecture rtl of ${ent} is`, `  type state_t is (${fsm.states.map((s) => S(s.name)).join(', ')});`, `  signal state, next_state : state_t := ${init ? S(init.name) : S(fsm.states[0]?.name ?? 'none')};`, 'begin')
  out.push('  process(clk, rst) begin', `    if rst = '1' then state <= ${init ? S(init.name) : S(fsm.states[0]?.name ?? 'none')};`, '    elsif rising_edge(clk) then state <= next_state;', '    end if;', '  end process;', '')
  out.push(`  process(state${ins.length ? ', ' + ins.join(', ') : ''}) begin`, '    next_state <= state;')
  outs.forEach((o) => out.push(`    ${o} <= '0';`))
  out.push('    case state is')
  for (const s of fsm.states) {
    out.push(`      when ${S(s.name)} =>`)
    const rows = an.table.filter((r) => r.state === s.name)
    if (fsm.type === 'moore') outs.forEach((o, k) => out.push(`        ${o} <= '${s.out[k] ?? 0}';`))
    if (n === 0) { if (rows[0]) { out.push(`        next_state <= ${S(rows[0].next)};`); if (fsm.type === 'mealy') outs.forEach((o, k) => out.push(`        ${o} <= '${rows[0].out[k] ?? 0}';`)) } }
    else {
      out.push(`        case (${ins.join(' & ')}) is`)
      for (const r of rows) out.push(`          when "${r.inputBits}" => next_state <= ${S(r.next)};${fsm.type === 'mealy' ? ' ' + outs.map((o, k) => `${o} <= '${r.out[k] ?? 0}';`).join(' ') : ''}`)
      out.push('          when others => null;', '        end case;')
    }
  }
  out.push('    end case;', '  end process;', 'end architecture rtl;', '')
  return out.join('\n')
}

export function fsmVhdlTestbench(fsm: Fsm, inputs: string, name?: string): string {
  const ent = sanitize(name ?? fsm.name, 'vhdl')
  const ins = fsm.inputs.map((i) => sanitize(i, 'vhdl'))
  const outs = fsm.outputs.map((o) => sanitize(o, 'vhdl'))
  const n = ins.length
  const seq = inputs.split(/[\s,]+/).filter(Boolean)
  const out: string[] = ['library ieee;', 'use ieee.std_logic_1164.all;', '', `entity ${ent}_tb is end entity;`, '', `architecture sim of ${ent}_tb is`, "  signal clk : std_logic := '0';", "  signal rst : std_logic := '1';"]
  ins.forEach((i) => out.push(`  signal ${i} : std_logic := '0';`))
  outs.forEach((o) => out.push(`  signal ${o} : std_logic;`))
  out.push('begin', `  dut : entity work.${ent} port map (${['clk => clk', 'rst => rst', ...ins.map((i) => `${i} => ${i}`), ...outs.map((o) => `${o} => ${o}`)].join(', ')});`, "  clk <= not clk after 5 ns;", '  stimulus : process begin', "    wait for 12 ns; rst <= '0';")
  for (const s of seq) {
    const bits = s.replace(/[^01]/g, '').padStart(n, '0')
    out.push(`    ${ins.map((i, k) => `${i} <= '${bits[k]}';`).join(' ')} wait for 10 ns;`)
  }
  out.push('    assert false report "end of simulation" severity failure;', '  end process;', 'end architecture sim;', '')
  return out.join('\n')
}

export { defOf }
