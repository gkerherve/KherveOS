// Material Lab rules, ported from KherveFitting's ChemistryLab.py: put
// elements in the reactor, set the furnace (each fuel level adds 100 °C when
// it is on) and react. 44 reactions to discover, each with its temperature
// window; a discovery is worth 100 points and unlocks new elements, making a
// known compound again 10 (the first three times). Discover them all, or
// finish the session, to end the game. Plain logic with no DOM, so it can be
// tested on its own.

export const ROOM_TEMP = 25
export const MAX_FUEL = 10
export const DEG_PER_FUEL = 100
/** How fast the reactor warms up or cools down, °C a second. */
export const HEAT_RATE = 400
/** Atoms the reactor holds. */
export const CAPACITY = 20
export const POINTS = { discovery: 100, repeat: 10, repeats: 3, complete: 500 }
/** Seconds a reaction fizzes in the reactor. */
export const REACT_TIME = 2

export type Category =
  | 'alkali_metal' | 'alkaline_earth' | 'transition_metal' | 'post_transition' | 'metalloid'
  | 'nonmetal' | 'halogen' | 'noble_gas'

export const CATEGORY_COLORS: Record<Category, string> = {
  alkali_metal: '#ff6666',
  alkaline_earth: '#ffdead',
  transition_metal: '#ffc0cb',
  post_transition: '#cccccc',
  metalloid: '#97ffff',
  nonmetal: '#a0ffa0',
  halogen: '#ffff99',
  noble_gas: '#c8a2c8',
}

export const CATEGORY_NAMES: Record<Category, string> = {
  alkali_metal: 'Alkali metal',
  alkaline_earth: 'Alkaline earth',
  transition_metal: 'Transition metal',
  post_transition: 'Post-transition',
  metalloid: 'Metalloid',
  nonmetal: 'Nonmetal',
  halogen: 'Halogen',
  noble_gas: 'Noble gas',
}

export interface Element {
  symbol: string
  name: string
  z: number
  category: Category
}

const el = (symbol: string, name: string, z: number, category: Category): Element => ({ symbol, name, z, category })

export const ELEMENTS: Element[] = [
  el('H', 'Hydrogen', 1, 'nonmetal'),
  el('He', 'Helium', 2, 'noble_gas'),
  el('Li', 'Lithium', 3, 'alkali_metal'),
  el('Be', 'Beryllium', 4, 'alkaline_earth'),
  el('B', 'Boron', 5, 'metalloid'),
  el('C', 'Carbon', 6, 'nonmetal'),
  el('N', 'Nitrogen', 7, 'nonmetal'),
  el('O', 'Oxygen', 8, 'nonmetal'),
  el('F', 'Fluorine', 9, 'halogen'),
  el('Ne', 'Neon', 10, 'noble_gas'),
  el('Na', 'Sodium', 11, 'alkali_metal'),
  el('Mg', 'Magnesium', 12, 'alkaline_earth'),
  el('Al', 'Aluminium', 13, 'post_transition'),
  el('Si', 'Silicon', 14, 'metalloid'),
  el('P', 'Phosphorus', 15, 'nonmetal'),
  el('S', 'Sulfur', 16, 'nonmetal'),
  el('Cl', 'Chlorine', 17, 'halogen'),
  el('Ar', 'Argon', 18, 'noble_gas'),
  el('K', 'Potassium', 19, 'alkali_metal'),
  el('Ca', 'Calcium', 20, 'alkaline_earth'),
  el('Fe', 'Iron', 26, 'transition_metal'),
  el('Cu', 'Copper', 29, 'transition_metal'),
  el('Zn', 'Zinc', 30, 'transition_metal'),
]

export const ELEMENT = new Map(ELEMENTS.map((e) => [e.symbol, e]))

/** Where each element sits in the little periodic table: [row, column]. */
export const TABLE_POS: Record<string, [number, number]> = {
  H: [0, 0], He: [0, 7],
  Li: [1, 0], Be: [1, 1], B: [1, 2], C: [1, 3], N: [1, 4], O: [1, 5], F: [1, 6], Ne: [1, 7],
  Na: [2, 0], Mg: [2, 1], Al: [2, 2], Si: [2, 3], P: [2, 4], S: [2, 5], Cl: [2, 6], Ar: [2, 7],
  K: [3, 0], Ca: [3, 1], Fe: [3, 3], Cu: [3, 4], Zn: [3, 5],
}

export const START_UNLOCKED = ['H', 'O', 'C', 'N', 'Na', 'Cl', 'Ca', 'Fe']

/** Making a compound for the first time unlocks these elements. */
export const UNLOCKS: Record<string, string[]> = {
  H2O: ['F', 'Li'],
  NaCl: ['K', 'Mg'],
  CO2: ['Si', 'P'],
  NH3: ['S', 'Ar'],
  CaO: ['Fe', 'Cu'],
  FeS: ['Zn', 'Al'],
  SO2: ['Be', 'B'],
  CH4: ['He', 'Ne'],
  LiF: ['Be'],
  MgO: ['B'],
  Al2O3: ['Si'],
  Na3PO4: ['K'],
  CaC2: ['Si'],
}

export type ProductPhase = 'solid' | 'liquid' | 'gas'

export interface Reaction {
  reactants: Record<string, number>
  product: string
  name: string
  minTemp: number
  maxTemp: number
  phase: ProductPhase
  /** Colour of the product, and of the particles it gives off. */
  color: string
  particles: string
  equation: string
  fact: string
}

const WHITE = '#ffffff'
const GRAY = '#808080'
const LIGHT_GRAY = '#c8c8c8'
const DARK_GRAY = '#404040'
const YELLOW = '#ffff00'
const BROWN = '#8b4513'

const rx = (
  reactants: Record<string, number>, product: string, name: string, minTemp: number, maxTemp: number,
  phase: ProductPhase, color: string, equation: string, fact: string, particles = color,
): Reaction => ({ reactants, product, name, minTemp, maxTemp, phase, color, particles, equation, fact })

/** In the original's order: room temperature, then hotter and hotter, then gases and phosphates. */
export const REACTIONS: Reaction[] = [
  // Room temperature
  rx({ H: 2, O: 1 }, 'H2O', 'Water', 25, 100, 'liquid', '#add8e6', '2H + O → H₂O', "Essential for life. Covers 71% of Earth's surface. Boils at 100 °C.", '#00ffff'),
  rx({ Na: 1, Cl: 1 }, 'NaCl', 'Salt', 25, 200, 'solid', WHITE, 'Na + Cl → NaCl', 'Table salt. Used to preserve food, and essential for human health.'),
  rx({ H: 2, Cl: 2 }, 'HCl', 'Hydrochloric Acid', 25, 150, 'liquid', YELLOW, '2H + 2Cl → 2HCl', 'Strong acid, also found in the stomach (pH 1–2). Used in cleaning and metal processing.'),
  rx({ Li: 1, F: 1 }, 'LiF', 'Lithium Fluoride', 25, 200, 'solid', WHITE, 'Li + F → LiF', 'Melts at 845 °C. Used in molten-salt reactors and in optics that pass far-UV light.'),
  rx({ K: 1, Cl: 1 }, 'KCl', 'Potassium Chloride', 25, 300, 'solid', WHITE, 'K + Cl → KCl', 'Salt substitute for low-sodium diets, and an essential fertilizer for plants.'),
  rx({ Ca: 1, Cl: 2 }, 'CaCl2', 'Calcium Chloride', 25, 250, 'solid', WHITE, 'Ca + 2Cl → CaCl₂', 'Road de-icer and desiccant: it absorbs moisture from the air.'),
  // Low heat
  rx({ N: 1, H: 3 }, 'NH3', 'Ammonia', 100, 300, 'gas', '#90ee90', 'N + 3H → NH₃', 'Key ingredient of fertilizers, with a pungent smell. One of the most produced chemicals in the world.', '#00ff00'),
  rx({ S: 1, O: 2 }, 'SO2', 'Sulfur Dioxide', 200, 400, 'gas', GRAY, 'S + 2O → SO₂', 'Preservative in wine and dried fruit; also an air pollutant that causes acid rain.'),
  rx({ P: 2, O: 5 }, 'P2O5', 'Phosphorus Pentoxide', 100, 300, 'solid', WHITE, '2P + 5O → P₂O₅', 'Powerful drying agent, used to make phosphoric acid. Extremely hygroscopic.'),
  rx({ Na: 3, P: 1, O: 4 }, 'Na3PO4', 'Sodium Phosphate', 200, 400, 'solid', WHITE, '3Na + P + 4O → Na₃PO₄', 'Cleaning agent and food additive, used in detergents.'),
  rx({ Mg: 1, Cl: 2 }, 'MgCl2', 'Magnesium Chloride', 150, 350, 'solid', WHITE, 'Mg + 2Cl → MgCl₂', 'De-icing salt, less corrosive than sodium chloride. Used to make tofu.'),
  rx({ Al: 1, Cl: 3 }, 'AlCl3', 'Aluminium Chloride', 100, 300, 'solid', WHITE, 'Al + 3Cl → AlCl₃', 'Catalyst in organic chemistry, used in antiperspirants. Sublimes at 180 °C.'),
  // Medium heat
  rx({ C: 1, O: 2 }, 'CO2', 'Carbon Dioxide', 300, 600, 'gas', LIGHT_GRAY, 'C + 2O → CO₂', 'Greenhouse gas that plants use for photosynthesis. Makes soda fizzy; dry ice at −78 °C.'),
  rx({ Cu: 1, S: 1 }, 'CuS', 'Copper Sulfide', 400, 700, 'solid', DARK_GRAY, 'Cu + S → CuS', 'The mineral covellite, a deep indigo copper ore. Studied as a semiconductor.'),
  rx({ Zn: 1, S: 1 }, 'ZnS', 'Zinc Sulfide', 500, 800, 'solid', WHITE, 'Zn + S → ZnS', 'Phosphor in glow-in-the-dark products. Its ore is sphalerite, the main source of zinc.'),
  rx({ Al: 2, S: 3 }, 'Al2S3', 'Aluminium Sulfide', 400, 700, 'solid', GRAY, '2Al + 3S → Al₂S₃', 'Reacts with water, giving hydrogen sulfide with its rotten-egg smell.'),
  rx({ Be: 1, O: 1 }, 'BeO', 'Beryllium Oxide', 400, 700, 'solid', WHITE, 'Be + O → BeO', 'Excellent thermal conductor but toxic. Used in nuclear reactors and electronics.'),
  rx({ B: 2, O: 3 }, 'B2O3', 'Boron Oxide', 350, 650, 'solid', WHITE, '2B + 3O → B₂O₃', 'Glass former in borosilicate glass, the heat-resistant glass of Pyrex.'),
  rx({ Li: 2, O: 1 }, 'Li2O', 'Lithium Oxide', 300, 600, 'solid', WHITE, '2Li + O → Li₂O', 'Used in ceramic glazes, and to absorb CO₂ in spacecraft and submarines.'),
  rx({ K: 2, O: 1 }, 'K2O', 'Potassium Oxide', 350, 650, 'solid', WHITE, '2K + O → K₂O', 'How the potash in fertilizers is counted. Strongly alkaline in water.'),
  // High heat
  rx({ Fe: 1, S: 1 }, 'FeS', 'Iron Sulfide', 600, 900, 'solid', DARK_GRAY, 'Fe + S → FeS', "Iron(II) sulfide; its cousin pyrite, FeS₂, is fool's gold, which sparks when struck with steel."),
  rx({ Ca: 1, O: 1 }, 'CaO', 'Calcium Oxide', 700, 1000, 'solid', WHITE, 'Ca + O → CaO', 'Quicklime, used in cement. Reacts violently with water, giving heat and steam.'),
  rx({ Mg: 1, O: 1 }, 'MgO', 'Magnesium Oxide', 600, 900, 'solid', WHITE, 'Mg + O → MgO', 'Refractory that melts at 2852 °C. Used to line furnaces.'),
  rx({ Fe: 2, O: 3 }, 'Fe2O3', 'Iron Oxide (Rust)', 700, 1000, 'solid', '#ff3b30', '2Fe + 3O → Fe₂O₃', 'Common rust. Red pigment in paints and pottery; Mars gets its colour from it.'),
  rx({ Cu: 1, O: 1 }, 'CuO', 'Copper Oxide', 600, 900, 'solid', '#151515', 'Cu + O → CuO', 'Black copper oxide, used in batteries, ceramics and wood preservatives.'),
  rx({ Zn: 1, O: 1 }, 'ZnO', 'Zinc Oxide', 700, 1000, 'solid', WHITE, 'Zn + O → ZnO', 'White pigment in paints and sunscreen. Piezoelectric, used in electronics.'),
  rx({ Ca: 1, S: 1 }, 'CaS', 'Calcium Sulfide', 800, 1100, 'solid', WHITE, 'Ca + S → CaS', 'Phosphorescent: used in luminous paints that glow in the dark.'),
  rx({ Mg: 1, S: 1 }, 'MgS', 'Magnesium Sulfide', 750, 1050, 'solid', WHITE, 'Mg + S → MgS', 'Found in some meteorites as niningerite. Gives off hydrogen sulfide in water.'),
  // Very high heat
  rx({ Al: 2, O: 3 }, 'Al2O3', 'Aluminium Oxide', 900, 1200, 'solid', WHITE, '2Al + 3O → Al₂O₃', 'Sapphire and ruby are crystalline forms of it. An extremely hard abrasive.'),
  rx({ Si: 1, O: 2 }, 'SiO2', 'Silicon Dioxide', 1000, 1200, 'solid', WHITE, 'Si + 2O → SiO₂', "Quartz, sand and glass. One of the most abundant minerals of Earth's crust."),
  rx({ C: 1, S: 2 }, 'CS2', 'Carbon Disulfide', 800, 1100, 'liquid', YELLOW, 'C + 2S → CS₂', 'Toxic solvent used to make rayon. Highly flammable, with a blue flame.'),
  rx({ Ca: 1, C: 2 }, 'CaC2', 'Calcium Carbide', 900, 1200, 'solid', GRAY, 'Ca + 2C → CaC₂', 'Gives acetylene gas with water, which lit the carbide lamps of miners.'),
  rx({ Li: 2, S: 1 }, 'Li2S', 'Lithium Sulfide', 900, 1200, 'solid', WHITE, '2Li + S → Li₂S', 'Used in the electrolytes and cathodes of solid-state and lithium–sulfur batteries.'),
  rx({ Be: 1, S: 1 }, 'BeS', 'Beryllium Sulfide', 950, 1200, 'solid', WHITE, 'Be + S → BeS', 'A wide-gap semiconductor. Extremely toxic, like all beryllium compounds.'),
  // Gases
  rx({ H: 2, S: 1 }, 'H2S', 'Hydrogen Sulfide', 200, 400, 'gas', YELLOW, '2H + S → H₂S', 'Rotten-egg smell. A highly toxic gas made by decaying organic matter.'),
  rx({ C: 1, H: 4 }, 'CH4', 'Methane', 300, 600, 'gas', LIGHT_GRAY, 'C + 4H → CH₄', 'Natural gas, and a strong greenhouse gas, made by cows and swamps.'),
  rx({ N: 1, O: 2 }, 'NO2', 'Nitrogen Dioxide', 400, 700, 'gas', BROWN, 'N + 2O → NO₂', 'The brown gas of smog, from car exhausts. Causes acid rain.'),
  rx({ S: 1, O: 3 }, 'SO3', 'Sulfur Trioxide', 300, 600, 'gas', WHITE, 'S + 3O → SO₃', 'Used to make sulfuric acid. Reacts violently with water, giving an acid mist.'),
  rx({ P: 1, H: 3 }, 'PH3', 'Phosphine', 200, 500, 'gas', LIGHT_GRAY, 'P + 3H → PH₃', 'Highly toxic gas that can catch fire by itself. Used to dope semiconductors.'),
  rx({ C: 1, O: 1 }, 'CO', 'Carbon Monoxide', 400, 800, 'gas', LIGHT_GRAY, 'C + O → CO', 'The silent killer: an odourless gas from incomplete burning that binds to haemoglobin.'),
  // Phosphates
  rx({ Ca: 3, P: 2, O: 8 }, 'Ca3P2O8', 'Calcium Phosphate', 600, 900, 'solid', WHITE, '3Ca + 2P + 8O → Ca₃(PO₄)₂', 'The main mineral of bones and teeth. Used in fertilizers and supplements.'),
  rx({ Mg: 3, P: 2, O: 8 }, 'Mg3P2O8', 'Magnesium Phosphate', 650, 950, 'solid', WHITE, '3Mg + 2P + 8O → Mg₃(PO₄)₂', 'Flame retardant and food additive; makes strong ceramics when fired.'),
  rx({ Al: 1, P: 1, O: 4 }, 'AlPO4', 'Aluminium Phosphate', 500, 800, 'solid', WHITE, 'Al + P + 4O → AlPO₄', 'Used in dental cements and as a catalyst support. Its crystals (berlinite) look like quartz.'),
  rx({ Fe: 1, P: 1, O: 4 }, 'FePO4', 'Iron Phosphate', 600, 900, 'solid', BROWN, 'Fe + P + 4O → FePO₄', 'With lithium (LiFePO₄) it is the cathode of long-lived lithium-ion batteries; also a rust-proof coating.'),
]

/** The original's temperature groups for the recipe book. */
export const GROUPS: { name: string; from: number; to: number }[] = [
  { name: 'Room temperature (25 °C)', from: 0, to: 6 },
  { name: 'Low heat (100–400 °C)', from: 6, to: 12 },
  { name: 'Medium heat (300–700 °C)', from: 12, to: 20 },
  { name: 'High heat (600–1100 °C)', from: 20, to: 28 },
  { name: 'Very high heat (900 °C and up)', from: 28, to: 34 },
  { name: 'Gases', from: 34, to: 40 },
  { name: 'Phosphates', from: 40, to: 44 },
]

/** The fuel level that brings the reactor up to `temp` (0 = room temperature will do). */
export function fuelFor(temp: number): number {
  return Math.max(0, Math.ceil((temp - ROOM_TEMP) / DEG_PER_FUEL))
}

export type Feedback = 'empty' | 'cold' | 'hot' | 'none' | 'new' | 'again' | 'mastered'

export interface ReactResult {
  kind: Feedback
  message: string
  reaction?: Reaction
  points: number
  unlocked: string[]
}

export type LabEvent =
  | { type: 'add'; symbol: string }
  | { type: 'full' }
  | { type: 'locked'; symbol: string }
  | { type: 'clear' }
  | { type: 'fuel'; level: number }
  | { type: 'furnace'; on: boolean }
  | { type: 'react'; result: ReactResult }
  | { type: 'complete' }
  | { type: 'finished' }

export type State = 'play' | 'complete' | 'finished'

export class MaterialLab {
  /** Atoms in the reactor, in the order the elements were first added. */
  contents = new Map<string, number>()
  /** The order atoms went in (for taking the last one back out). */
  added: string[] = []
  unlocked = new Set<string>(START_UNLOCKED)
  discovered = new Set<string>()
  /** Most recent first. */
  recent: Reaction[] = []
  /** Times each compound was made again. */
  repeats = new Map<string, number>()
  fuel = 0
  furnaceOn = false
  temperature = ROOM_TEMP
  score = 0
  /** The last reaction and how long ago it started (s), for the reactor's look. */
  product: { reaction: Reaction; age: number } | null = null
  state: State = 'play'
  stateTime = 0
  events: LabEvent[] = []

  constructor() {
    this.reset()
  }

  get over(): boolean {
    return this.state !== 'play' && this.stateTime >= (this.state === 'complete' ? 2.5 : 0.5)
  }

  /** The furnace's target: room temperature plus 100 °C a fuel level while it is on. */
  get targetTemp(): number {
    return ROOM_TEMP + (this.furnaceOn ? this.fuel * DEG_PER_FUEL : 0)
  }

  get atoms(): number {
    let n = 0
    for (const v of this.contents.values()) n += v
    return n
  }

  reset() {
    this.contents = new Map()
    this.added = []
    this.unlocked = new Set(START_UNLOCKED)
    this.discovered = new Set()
    this.recent = []
    this.repeats = new Map()
    this.fuel = 0
    this.furnaceOn = false
    this.temperature = ROOM_TEMP
    this.score = 0
    this.product = null
    this.state = 'play'
    this.stateTime = 0
    this.events = []
  }

  // ------------------------------------------------------------ the bench

  add(symbol: string): boolean {
    if (this.state !== 'play' || !ELEMENT.has(symbol)) return false
    if (!this.unlocked.has(symbol)) {
      this.events.push({ type: 'locked', symbol })
      return false
    }
    if (this.atoms >= CAPACITY) {
      this.events.push({ type: 'full' })
      return false
    }
    // A fresh experiment clears what the last reaction left showing.
    if (!this.atoms) this.product = null
    this.contents.set(symbol, (this.contents.get(symbol) ?? 0) + 1)
    this.added.push(symbol)
    this.events.push({ type: 'add', symbol })
    return true
  }

  /** Takes the last atom put in back out. */
  takeBack(): boolean {
    if (this.state !== 'play') return false
    const s = this.added.pop()
    if (!s) return false
    const n = (this.contents.get(s) ?? 0) - 1
    if (n > 0) this.contents.set(s, n)
    else this.contents.delete(s)
    return true
  }

  /** Takes one atom of an element back out. */
  removeOne(symbol: string): boolean {
    if (this.state !== 'play') return false
    const n = this.contents.get(symbol) ?? 0
    if (!n) return false
    if (n > 1) this.contents.set(symbol, n - 1)
    else this.contents.delete(symbol)
    const k = this.added.lastIndexOf(symbol)
    if (k >= 0) this.added.splice(k, 1)
    return true
  }

  clear() {
    if (this.state !== 'play') return
    this.contents = new Map()
    this.added = []
    this.product = null
    this.events.push({ type: 'clear' })
  }

  setFuel(level: number) {
    if (this.state !== 'play') return
    const v = Math.max(0, Math.min(MAX_FUEL, Math.round(level)))
    if (v === this.fuel) return
    this.fuel = v
    // As in the original, an empty furnace goes out.
    if (v === 0) this.furnaceOn = false
    this.events.push({ type: 'fuel', level: v })
  }

  /** On / off; it only lights with some fuel in it. */
  toggleFurnace(): boolean {
    if (this.state !== 'play') return false
    if (this.fuel === 0 && !this.furnaceOn) return false
    this.furnaceOn = !this.furnaceOn
    this.events.push({ type: 'furnace', on: this.furnaceOn })
    return true
  }

  // ------------------------------------------------------------ reacting

  /** Reactions whose elements are exactly the reactor's, with enough of each. */
  candidates(): Reaction[] {
    const c = this.contents
    return REACTIONS.filter(
      (r) => Object.keys(r.reactants).length === c.size && Object.entries(r.reactants).every(([s, n]) => (c.get(s) ?? 0) >= n),
    )
  }

  react(): ReactResult {
    const result = this.tryReact()
    if (this.state === 'play') this.events.push({ type: 'react', result })
    return result
  }

  private tryReact(): ReactResult {
    const none = (kind: Feedback, message: string): ReactResult => ({ kind, message, points: 0, unlocked: [] })
    if (this.state !== 'play') return none('none', '')
    if (!this.atoms) return none('empty', 'Add elements to the reactor first!')
    const t = Math.round(this.temperature)
    const list = this.candidates()
    if (!list.length) {
      const what = [...this.contents].map(([s, n]) => `${n}${s}`).join(', ')
      return none('none', `No reaction found for: ${what}`)
    }
    const fits = (r: Reaction) => t >= r.minTemp && t <= r.maxTemp
    const exact = (r: Reaction) => Object.entries(r.reactants).every(([s, n]) => this.contents.get(s) === n)
    const r = list.find((x) => fits(x) && exact(x)) ?? list.find(fits)
    if (!r) {
      const first = list[0]
      if (t < first.minTemp)
        return { ...none('cold', `Needs more heat: ${first.minTemp} °C (fuel ${fuelFor(first.minTemp)} or more, furnace on)`), reaction: first }
      return { ...none('hot', `Too hot! Reduce the fuel (${first.maxTemp} °C at most)`), reaction: first }
    }

    // It reacts: the reactants are used up, any extra atoms stay.
    for (const [s, n] of Object.entries(r.reactants)) {
      const left = (this.contents.get(s) ?? 0) - n
      if (left > 0) this.contents.set(s, left)
      else this.contents.delete(s)
      for (let i = 0; i < n; i++) {
        const k = this.added.lastIndexOf(s)
        if (k >= 0) this.added.splice(k, 1)
      }
    }
    this.product = { reaction: r, age: 0 }

    if (!this.discovered.has(r.product)) {
      this.discovered.add(r.product)
      this.recent.unshift(r)
      this.score += POINTS.discovery
      const unlocked = (UNLOCKS[r.product] ?? []).filter((s) => !this.unlocked.has(s))
      for (const s of unlocked) this.unlocked.add(s)
      if (this.discovered.size === REACTIONS.length) {
        this.score += POINTS.complete
        this.state = 'complete'
        this.stateTime = 0
        this.events.push({ type: 'complete' })
      }
      return { kind: 'new', message: `New discovery: ${r.name}! +${POINTS.discovery} points`, reaction: r, points: POINTS.discovery, unlocked }
    }
    const times = (this.repeats.get(r.product) ?? 0) + 1
    this.repeats.set(r.product, times)
    if (times > POINTS.repeats) return { kind: 'mastered', message: `Made ${r.name} again (already mastered)`, reaction: r, points: 0, unlocked: [] }
    this.score += POINTS.repeat
    return { kind: 'again', message: `Created ${r.name} (+${POINTS.repeat} points)`, reaction: r, points: POINTS.repeat, unlocked: [] }
  }

  /** End the session, keeping the points. */
  finish(): boolean {
    if (this.state !== 'play') return false
    this.state = 'finished'
    this.stateTime = 0
    this.events.push({ type: 'finished' })
    return true
  }

  // ------------------------------------------------------------ the clock

  update(dt: number) {
    this.stateTime += dt
    const target = this.targetTemp
    const d = target - this.temperature
    const step = HEAT_RATE * dt
    this.temperature = Math.abs(d) <= step ? target : this.temperature + Math.sign(d) * step
    if (this.product) this.product.age += dt
  }
}
