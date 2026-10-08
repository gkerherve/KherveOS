// The 118 elements for kChem: names, standard atomic weights, periodic-table position,
// electronegativity (Pauling), melting / boiling points, density, common oxidation states,
// discovery, electron configuration (Aufbau + the known exceptions) and the natural isotopes
// of the stable elements (for isotope patterns). Pure data and functions: no React.

export type Category =
  | 'alkali' | 'alkaline' | 'transition' | 'post' | 'metalloid' | 'nonmetal' | 'halogen' | 'noble' | 'lanthanide' | 'actinide'

export const CATEGORY_LABEL: Record<Category, string> = {
  alkali: 'Alkali metal',
  alkaline: 'Alkaline earth metal',
  transition: 'Transition metal',
  post: 'Post-transition metal',
  metalloid: 'Metalloid',
  nonmetal: 'Reactive nonmetal',
  halogen: 'Halogen',
  noble: 'Noble gas',
  lanthanide: 'Lanthanide',
  actinide: 'Actinide',
}

export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[]

export interface Element {
  z: number
  symbol: string
  name: string
  /** Standard atomic weight (conventional / most stable isotope when there is no stable one). */
  weight: number
  /** True when the weight is the mass number of the longest-lived isotope. */
  radioactive: boolean
  category: Category
  period: number
  /** 1–18; null for the lanthanides and actinides (the f-block series). */
  group: number | null
  block: 's' | 'p' | 'd' | 'f'
  /** Pauling electronegativity, null when none is defined. */
  en: number | null
  /** Melting point in K. */
  mp: number | null
  /** Boiling point in K. */
  bp: number | null
  /** g/cm³ for solids and liquids, at 20 °C (gases: the gas at 0 °C, 1 atm). */
  density: number | null
  /** State at 25 °C and 1 atm. */
  state: 'solid' | 'liquid' | 'gas' | 'unknown'
  /** Common oxidation states, most common first. */
  oxidation: number[]
  year: string
  discoverer: string
}

// Z, symbol, name, weight, EN, mp (K), bp (K), density, oxidation states, year, discoverer
// (blank = not known / not defined). Values are the usual handbook values.
const RAW: string[] = [
  '1|H|Hydrogen|1.008|2.20|13.99|20.27|0.00008988|1,-1|1766|Henry Cavendish',
  '2|He|Helium|4.0026||0.95|4.22|0.0001785|0|1895|William Ramsay',
  '3|Li|Lithium|6.94|0.98|453.65|1603|0.534|1|1817|Johan August Arfwedson',
  '4|Be|Beryllium|9.0122|1.57|1560|2742|1.85|2|1798|Louis-Nicolas Vauquelin',
  '5|B|Boron|10.81|2.04|2349|4200|2.34|3|1808|Gay-Lussac and Thénard',
  '6|C|Carbon|12.011|2.55|3823|4098|2.267|4,2,-4|ancient|known since antiquity',
  '7|N|Nitrogen|14.007|3.04|63.15|77.36|0.0012506|-3,3,5,4,2|1772|Daniel Rutherford',
  '8|O|Oxygen|15.999|3.44|54.36|90.20|0.001429|-2,-1|1774|Priestley and Scheele',
  '9|F|Fluorine|18.998|3.98|53.53|85.03|0.001696|-1|1886|Henri Moissan',
  '10|Ne|Neon|20.180||24.56|27.07|0.0008999|0|1898|Ramsay and Travers',
  '11|Na|Sodium|22.990|0.93|370.87|1156|0.971|1|1807|Humphry Davy',
  '12|Mg|Magnesium|24.305|1.31|923|1363|1.738|2|1808|Humphry Davy',
  '13|Al|Aluminium|26.982|1.61|933.47|2792|2.70|3|1825|Hans Christian Ørsted',
  '14|Si|Silicon|28.085|1.90|1687|3538|2.329|4,-4|1824|Jöns Jacob Berzelius',
  '15|P|Phosphorus|30.974|2.19|317.3|553.65|1.82|5,3,-3|1669|Hennig Brand',
  '16|S|Sulfur|32.06|2.58|388.36|717.87|2.07|-2,4,6|ancient|known since antiquity',
  '17|Cl|Chlorine|35.45|3.16|171.6|239.11|0.003214|-1,1,3,5,7|1774|Carl Wilhelm Scheele',
  '18|Ar|Argon|39.948||83.80|87.30|0.0017837|0|1894|Rayleigh and Ramsay',
  '19|K|Potassium|39.098|0.82|336.53|1032|0.862|1|1807|Humphry Davy',
  '20|Ca|Calcium|40.078|1.00|1115|1757|1.55|2|1808|Humphry Davy',
  '21|Sc|Scandium|44.956|1.36|1814|3109|2.985|3|1879|Lars Fredrik Nilson',
  '22|Ti|Titanium|47.867|1.54|1941|3560|4.506|4,3,2|1791|William Gregor',
  '23|V|Vanadium|50.942|1.63|2183|3680|6.0|5,4,3,2|1801|Andrés Manuel del Río',
  '24|Cr|Chromium|51.996|1.66|2180|2944|7.15|3,6,2|1797|Louis-Nicolas Vauquelin',
  '25|Mn|Manganese|54.938|1.55|1519|2334|7.21|2,4,7,3,6|1774|Johan Gottlieb Gahn',
  '26|Fe|Iron|55.845|1.83|1811|3134|7.874|3,2|ancient|known since antiquity',
  '27|Co|Cobalt|58.933|1.88|1768|3200|8.90|2,3|1735|Georg Brandt',
  '28|Ni|Nickel|58.693|1.91|1728|3186|8.908|2,3|1751|Axel Fredrik Cronstedt',
  '29|Cu|Copper|63.546|1.90|1357.77|2835|8.96|2,1|ancient|known since antiquity',
  '30|Zn|Zinc|65.38|1.65|692.68|1180|7.14|2|1746|Andreas Sigismund Marggraf',
  '31|Ga|Gallium|69.723|1.81|302.91|2477|5.91|3|1875|Paul-Émile Lecoq de Boisbaudran',
  '32|Ge|Germanium|72.630|2.01|1211.4|3106|5.323|4,2|1886|Clemens Winkler',
  '33|As|Arsenic|74.922|2.18||887|5.727|3,5,-3|1250|Albertus Magnus',
  '34|Se|Selenium|78.971|2.55|494|958|4.81|-2,4,6|1817|Jöns Jacob Berzelius',
  '35|Br|Bromine|79.904|2.96|265.8|332|3.12|-1,1,5|1826|Antoine Jérôme Balard',
  '36|Kr|Krypton|83.798|3.00|115.79|119.93|0.003733|0,2|1898|Ramsay and Travers',
  '37|Rb|Rubidium|85.468|0.82|312.46|961|1.532|1|1861|Bunsen and Kirchhoff',
  '38|Sr|Strontium|87.62|0.95|1050|1655|2.64|2|1790|Adair Crawford',
  '39|Y|Yttrium|88.906|1.22|1799|3609|4.472|3|1794|Johan Gadolin',
  '40|Zr|Zirconium|91.224|1.33|2128|4682|6.52|4|1789|Martin Heinrich Klaproth',
  '41|Nb|Niobium|92.906|1.6|2750|5017|8.57|5,3|1801|Charles Hatchett',
  '42|Mo|Molybdenum|95.95|2.16|2896|4912|10.28|6,4,3|1778|Carl Wilhelm Scheele',
  '43|Tc|Technetium|98|1.9|2430|4538|11|7,4|1937|Perrier and Segrè',
  '44|Ru|Ruthenium|101.07|2.2|2607|4423|12.45|3,4,2,8|1844|Karl Ernst Claus',
  '45|Rh|Rhodium|102.91|2.28|2237|3968|12.41|3,1|1803|William Hyde Wollaston',
  '46|Pd|Palladium|106.42|2.20|1828.05|3236|12.023|2,4|1803|William Hyde Wollaston',
  '47|Ag|Silver|107.87|1.93|1234.93|2435|10.49|1|ancient|known since antiquity',
  '48|Cd|Cadmium|112.41|1.69|594.22|1040|8.65|2|1817|Friedrich Stromeyer',
  '49|In|Indium|114.82|1.78|429.75|2345|7.31|3,1|1863|Reich and Richter',
  '50|Sn|Tin|118.71|1.96|505.08|2875|7.287|4,2|ancient|known since antiquity',
  '51|Sb|Antimony|121.76|2.05|903.78|1860|6.685|3,5,-3|ancient|known since antiquity',
  '52|Te|Tellurium|127.60|2.1|722.66|1261|6.232|-2,4,6|1782|Franz-Joseph Müller von Reichenstein',
  '53|I|Iodine|126.90|2.66|386.85|457.4|4.93|-1,1,5,7|1811|Bernard Courtois',
  '54|Xe|Xenon|131.29|2.6|161.4|165.03|0.005887|0,2,4,6|1898|Ramsay and Travers',
  '55|Cs|Caesium|132.91|0.79|301.59|944|1.873|1|1860|Bunsen and Kirchhoff',
  '56|Ba|Barium|137.33|0.89|1000|2170|3.594|2|1808|Humphry Davy',
  '57|La|Lanthanum|138.91|1.10|1193|3737|6.145|3|1839|Carl Gustaf Mosander',
  '58|Ce|Cerium|140.12|1.12|1068|3716|6.77|3,4|1803|Berzelius and Hisinger',
  '59|Pr|Praseodymium|140.91|1.13|1208|3793|6.773|3|1885|Carl Auer von Welsbach',
  '60|Nd|Neodymium|144.24|1.14|1297|3347|7.007|3|1885|Carl Auer von Welsbach',
  '61|Pm|Promethium|145|1.13|1315|3273|7.26|3|1945|Marinsky, Glendenin and Coryell',
  '62|Sm|Samarium|150.36|1.17|1345|2067|7.52|3,2|1879|Paul-Émile Lecoq de Boisbaudran',
  '63|Eu|Europium|151.96|1.2|1099|1802|5.243|3,2|1901|Eugène-Anatole Demarçay',
  '64|Gd|Gadolinium|157.25|1.2|1585|3546|7.895|3|1880|Jean Charles de Marignac',
  '65|Tb|Terbium|158.93|1.1|1629|3503|8.229|3,4|1843|Carl Gustaf Mosander',
  '66|Dy|Dysprosium|162.50|1.22|1680|2840|8.55|3|1886|Paul-Émile Lecoq de Boisbaudran',
  '67|Ho|Holmium|164.93|1.23|1734|2993|8.795|3|1878|Delafontaine and Soret',
  '68|Er|Erbium|167.26|1.24|1802|3141|9.066|3|1843|Carl Gustaf Mosander',
  '69|Tm|Thulium|168.93|1.25|1818|2223|9.321|3|1879|Per Teodor Cleve',
  '70|Yb|Ytterbium|173.05|1.1|1097|1469|6.965|3,2|1878|Jean Charles de Marignac',
  '71|Lu|Lutetium|174.97|1.27|1925|3675|9.84|3|1907|Georges Urbain',
  '72|Hf|Hafnium|178.49|1.3|2506|4876|13.31|4|1923|Coster and de Hevesy',
  '73|Ta|Tantalum|180.95|1.5|3290|5731|16.69|5|1802|Anders Gustaf Ekeberg',
  '74|W|Tungsten|183.84|2.36|3695|5828|19.25|6,4|1783|Juan José and Fausto Elhuyar',
  '75|Re|Rhenium|186.21|1.9|3459|5869|21.02|7,4,6|1925|Noddack, Tacke and Berg',
  '76|Os|Osmium|190.23|2.2|3306|5285|22.59|4,8,3|1803|Smithson Tennant',
  '77|Ir|Iridium|192.22|2.20|2719|4701|22.56|3,4|1803|Smithson Tennant',
  '78|Pt|Platinum|195.08|2.28|2041.4|4098|21.45|2,4|1735|Antonio de Ulloa',
  '79|Au|Gold|196.97|2.54|1337.33|3129|19.3|3,1|ancient|known since antiquity',
  '80|Hg|Mercury|200.59|2.00|234.32|629.88|13.534|2,1|ancient|known since antiquity',
  '81|Tl|Thallium|204.38|1.62|577|1746|11.85|1,3|1861|William Crookes',
  '82|Pb|Lead|207.2|2.33|600.61|2022|11.34|2,4|ancient|known since antiquity',
  '83|Bi|Bismuth|208.98|2.02|544.4|1837|9.78|3,5|1753|Claude François Geoffroy',
  '84|Po|Polonium|209|2.0|527|1235|9.196|4,2|1898|Marie and Pierre Curie',
  '85|At|Astatine|210|2.2|575|610||-1,1|1940|Corson, MacKenzie and Segrè',
  '86|Rn|Radon|222|2.2|202|211.3|0.00973|0|1900|Friedrich Ernst Dorn',
  '87|Fr|Francium|223|0.79|300|950||1|1939|Marguerite Perey',
  '88|Ra|Radium|226|0.9|973|2010|5.5|2|1898|Marie and Pierre Curie',
  '89|Ac|Actinium|227|1.1|1323|3573|10.07|3|1899|André-Louis Debierne',
  '90|Th|Thorium|232.04|1.3|2115|5061|11.72|4|1829|Jöns Jacob Berzelius',
  '91|Pa|Protactinium|231.04|1.5|1841|4300|15.37|5,4|1913|Fajans and Göhring',
  '92|U|Uranium|238.03|1.38|1405.3|4404|19.1|6,4,3,5|1789|Martin Heinrich Klaproth',
  '93|Np|Neptunium|237|1.36|917|4273|20.45|5,4,3,6|1940|McMillan and Abelson',
  '94|Pu|Plutonium|244|1.28|912.5|3501|19.816|4,3,5,6|1940|Seaborg and co-workers',
  '95|Am|Americium|243|1.13|1449|2880|12|3,4,5,6|1944|Seaborg and co-workers',
  '96|Cm|Curium|247|1.28|1613|3383|13.51|3|1944|Seaborg and co-workers',
  '97|Bk|Berkelium|247|1.3|1259|2900|14.78|3,4|1949|Seaborg and co-workers',
  '98|Cf|Californium|251|1.3|1173|1743|15.1|3|1950|Seaborg and co-workers',
  '99|Es|Einsteinium|252|1.3|1133||8.84|3|1952|Ghiorso and co-workers',
  '100|Fm|Fermium|257|1.3|1800|||3|1952|Ghiorso and co-workers',
  '101|Md|Mendelevium|258|1.3|1100|||3,2|1955|Ghiorso and co-workers',
  '102|No|Nobelium|259|1.3|1100|||2,3|1958|Ghiorso and co-workers',
  '103|Lr|Lawrencium|266||1900|||3|1961|Ghiorso and co-workers',
  '104|Rf|Rutherfordium|267||||||4|1964|Dubna and Berkeley teams',
  '105|Db|Dubnium|268||||||5|1968|Dubna team',
  '106|Sg|Seaborgium|269||||||6|1974|Berkeley team',
  '107|Bh|Bohrium|270||||||7|1981|GSI Darmstadt',
  '108|Hs|Hassium|269||||||8|1984|GSI Darmstadt',
  '109|Mt|Meitnerium|278||||||3|1982|GSI Darmstadt',
  '110|Ds|Darmstadtium|281||||||0|1994|GSI Darmstadt',
  '111|Rg|Roentgenium|282||||||3|1994|GSI Darmstadt',
  '112|Cn|Copernicium|285||||||2|1996|GSI Darmstadt',
  '113|Nh|Nihonium|286||||||1|2004|RIKEN',
  '114|Fl|Flerovium|289||||||2|1998|Dubna team',
  '115|Mc|Moscovium|290||||||1|2003|Dubna and Livermore teams',
  '116|Lv|Livermorium|293||||||2|2000|Dubna and Livermore teams',
  '117|Ts|Tennessine|294||||||-1|2010|Dubna, Oak Ridge and Livermore teams',
  '118|Og|Oganesson|294||||||0|2002|Dubna and Livermore teams',
]

/** Elements without a stable isotope: their "weight" is the mass number of the longest-lived isotope. */
const NO_STABLE = new Set([43, 61, ...Array.from({ length: 118 - 83 }, (_, i) => 84 + i).filter((z) => z !== 90 && z !== 92 && z !== 91)])

const NOBLE = new Set([2, 10, 18, 36, 54, 86, 118])
const HALOGEN = new Set([9, 17, 35, 53, 85, 117])
const METALLOID = new Set([5, 14, 32, 33, 51, 52])
const POST = new Set([13, 31, 49, 50, 81, 82, 83, 84, 113, 114, 115, 116])
const NONMETAL = new Set([1, 6, 7, 8, 15, 16, 34])

const periodOf = (z: number) => (z <= 2 ? 1 : z <= 10 ? 2 : z <= 18 ? 3 : z <= 36 ? 4 : z <= 54 ? 5 : z <= 86 ? 6 : 7)

/** Group (1–18) of an element, or null for the lanthanide / actinide series (La–Yb, Ac–No). */
function groupOf(z: number): number | null {
  if (z === 1) return 1
  if (z === 2) return 18
  const p = periodOf(z)
  if (p === 2) return z <= 4 ? z - 2 : z + 8
  if (p === 3) return z <= 12 ? z - 10 : z
  if (p === 4 || p === 5) return z - (p === 4 ? 18 : 36)
  const first = p === 6 ? 55 : 87
  const o = z - first
  if (o < 2) return o + 1
  const lastF = p === 6 ? 70 : 102
  if (z <= lastF) return null
  return z - lastF + 2
}

function categoryOf(z: number, group: number | null): Category {
  if (NOBLE.has(z)) return 'noble'
  if (HALOGEN.has(z)) return 'halogen'
  if (METALLOID.has(z)) return 'metalloid'
  if (POST.has(z)) return 'post'
  if (NONMETAL.has(z)) return 'nonmetal'
  if (z >= 57 && z <= 71) return 'lanthanide'
  if (z >= 89 && z <= 103) return 'actinide'
  if (group === 1) return 'alkali'
  if (group === 2) return 'alkaline'
  return 'transition'
}

function blockOf(z: number, group: number | null): Element['block'] {
  if (z === 2) return 's'
  if (group === null) return 'f'
  if (group <= 2) return 's'
  if (group >= 13) return 'p'
  return 'd'
}

function stateOf(mp: number | null, bp: number | null): Element['state'] {
  if (mp === null && bp === null) return 'unknown'
  if (bp !== null && bp < 298.15) return 'gas'
  if (mp !== null && mp < 298.15) return bp !== null && bp > 298.15 ? 'liquid' : 'unknown'
  return 'solid'
}

const numOrNull = (s: string): number | null => (s === '' ? null : Number(s))

export const ELEMENTS: Element[] = RAW.map((line) => {
  const [zs, symbol, name, w, en, mp, bp, dens, ox, year, by] = line.split('|')
  const z = Number(zs)
  const group = groupOf(z)
  const m = numOrNull(mp)
  const b = numOrNull(bp)
  return {
    z, symbol, name, weight: Number(w), radioactive: NO_STABLE.has(z),
    category: categoryOf(z, group), period: periodOf(z), group, block: blockOf(z, group),
    en: numOrNull(en), mp: m, bp: b, density: numOrNull(dens), state: stateOf(m, b),
    oxidation: ox === '' ? [] : ox.split(',').map(Number), year, discoverer: by,
  }
})

export const BY_SYMBOL: Record<string, Element> = Object.fromEntries(ELEMENTS.map((e) => [e.symbol, e]))

/** Standard atomic weights by symbol, all 118 elements. */
export const ATOMIC_WEIGHTS: Record<string, number> = Object.fromEntries(ELEMENTS.map((e) => [e.symbol, e.weight]))

/** An element by symbol ("Fe"), name ("iron") or atomic number ("26"), or null. */
export function findElement(q: string | number): Element | null {
  if (typeof q === 'number') return ELEMENTS[q - 1] ?? null
  const t = q.trim()
  if (!t) return null
  if (/^\d+$/.test(t)) return ELEMENTS[Number(t) - 1] ?? null
  const lower = t.toLowerCase()
  return (
    ELEMENTS.find((e) => e.symbol.toLowerCase() === lower) ??
    ELEMENTS.find((e) => e.name.toLowerCase() === lower) ??
    (lower === 'aluminum' ? BY_SYMBOL.Al : lower === 'cesium' ? BY_SYMBOL.Cs : lower === 'sulphur' ? BY_SYMBOL.S : null)
  )
}

/** Elements matching a search: symbol, name, number or category, best matches first. */
export function searchElements(q: string): Element[] {
  const t = q.trim().toLowerCase()
  if (!t) return []
  const score = (e: Element): number => {
    if (e.symbol.toLowerCase() === t || e.name.toLowerCase() === t || String(e.z) === t) return 0
    if (e.name.toLowerCase().startsWith(t) || e.symbol.toLowerCase().startsWith(t)) return 1
    if (e.name.toLowerCase().includes(t)) return 2
    if (CATEGORY_LABEL[e.category].toLowerCase().includes(t)) return 3
    return 9
  }
  return ELEMENTS.map((e) => [score(e), e] as const).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].z - b[1].z).map(([, e]) => e)
}

/** Row and column of an element on the usual 18-column chart (rows 1–7, then 9 / 10 for La–Yb, Ac–No). */
export function gridPosition(e: Element): { row: number; col: number } {
  if (e.group !== null) return { row: e.period, col: e.group }
  const first = e.period === 6 ? 57 : 89
  return { row: e.period === 6 ? 9 : 10, col: e.z - first + 3 }
}

// ------------------------------------------------------------ electron configuration

/** Subshells in Madelung (Aufbau) order. */
const ORDER: [number, number][] = []
for (let sum = 1; sum <= 9; sum++) {
  for (let l = 3; l >= 0; l--) {
    const n = sum - l
    if (n > l && n >= 1 && n <= 7) ORDER.push([n, l])
  }
}
const LETTER = 'spdf'
const CAPACITY = (l: number) => 2 * (2 * l + 1)
const key = (n: number, l: number) => `${n}${LETTER[l]}`

/** Elements whose real ground state differs from the Aufbau filling: [subshell, electrons] overrides. */
const EXCEPTIONS: Record<number, [string, number][]> = {
  24: [['3d', 5], ['4s', 1]], // Cr
  29: [['3d', 10], ['4s', 1]], // Cu
  41: [['4d', 4], ['5s', 1]], // Nb
  42: [['4d', 5], ['5s', 1]], // Mo
  44: [['4d', 7], ['5s', 1]], // Ru
  45: [['4d', 8], ['5s', 1]], // Rh
  46: [['4d', 10], ['5s', 0]], // Pd
  47: [['4d', 10], ['5s', 1]], // Ag
  57: [['4f', 0], ['5d', 1], ['6s', 2]], // La
  58: [['4f', 1], ['5d', 1], ['6s', 2]], // Ce
  64: [['4f', 7], ['5d', 1], ['6s', 2]], // Gd
  78: [['4f', 14], ['5d', 9], ['6s', 1]], // Pt
  79: [['4f', 14], ['5d', 10], ['6s', 1]], // Au
  89: [['5f', 0], ['6d', 1], ['7s', 2]], // Ac
  90: [['5f', 0], ['6d', 2], ['7s', 2]], // Th
  91: [['5f', 2], ['6d', 1], ['7s', 2]], // Pa
  92: [['5f', 3], ['6d', 1], ['7s', 2]], // U
  93: [['5f', 4], ['6d', 1], ['7s', 2]], // Np
  96: [['5f', 7], ['6d', 1], ['7s', 2]], // Cm
  103: [['5f', 14], ['6d', 0], ['7s', 2], ['7p', 1]], // Lr
}

/** Electrons per subshell, e.g. { '1s': 2, '2s': 2, … }. */
export function subshells(z: number): Record<string, number> {
  const occ: Record<string, number> = {}
  let left = z
  for (const [n, l] of ORDER) {
    if (left <= 0) break
    const take = Math.min(left, CAPACITY(l))
    occ[key(n, l)] = take
    left -= take
  }
  for (const [k, v] of EXCEPTIONS[z] ?? []) occ[k] = v
  return occ
}

const NOBLE_Z = [2, 10, 18, 36, 54, 86]
const NOBLE_SYM = ['He', 'Ne', 'Ar', 'Kr', 'Xe', 'Rn']

/** Subshell labels sorted by shell, then s p d f. */
function sortKeys(keys: string[]): string[] {
  return keys.sort((a, b) => Number(a[0]) - Number(b[0]) || LETTER.indexOf(a[1]) - LETTER.indexOf(b[1]))
}

/** The electron configuration as text: "[Ar] 3d6 4s2". `core: false` writes it in full. */
export function electronConfiguration(z: number, core = true): string {
  const occ = subshells(z)
  const out: Record<string, number> = { ...occ }
  let prefix = ''
  if (core) {
    for (let i = NOBLE_Z.length - 1; i >= 0; i--) {
      if (NOBLE_Z[i] < z) {
        const c = subshells(NOBLE_Z[i])
        const inside = Object.entries(c).every(([k, v]) => (occ[k] ?? 0) >= v)
        if (!inside) continue
        for (const [k, v] of Object.entries(c)) out[k] = (out[k] ?? 0) - v
        prefix = `[${NOBLE_SYM[i]}] `
        break
      }
    }
  }
  const keys = sortKeys(Object.keys(out).filter((k) => out[k] > 0))
  return prefix + keys.map((k) => `${k}${out[k]}`).join(' ')
}

/** Valence electrons for the main-group elements (null for d- and f-block). */
export function valenceElectrons(e: Element): number | null {
  if (e.group === null || e.block === 'd') return null
  if (e.z === 2) return 2
  return e.group <= 2 ? e.group : e.group - 10
}

// ------------------------------------------------------------ isotopes

export interface Isotope {
  /** Exact mass in u. */
  mass: number
  /** Natural abundance in percent. */
  abundance: number
}

const ISO = (...pairs: number[]): Isotope[] => {
  const out: Isotope[] = []
  for (let i = 0; i < pairs.length; i += 2) out.push({ mass: pairs[i], abundance: pairs[i + 1] })
  return out
}

/** Natural isotopes (exact mass, abundance %) of the elements that have stable isotopes. */
export const ISOTOPES: Record<string, Isotope[]> = {
  H: ISO(1.00782503, 99.9885, 2.01410178, 0.0115),
  He: ISO(3.01602932, 0.000134, 4.00260325, 99.999866),
  Li: ISO(6.0151228, 7.59, 7.0160034, 92.41),
  Be: ISO(9.0121831, 100),
  B: ISO(10.012937, 19.9, 11.0093054, 80.1),
  C: ISO(12, 98.93, 13.00335484, 1.07),
  N: ISO(14.003074, 99.636, 15.0001089, 0.364),
  O: ISO(15.9949146, 99.757, 16.9991317, 0.038, 17.999161, 0.205),
  F: ISO(18.9984032, 100),
  Ne: ISO(19.9924402, 90.48, 20.9938467, 0.27, 21.9913851, 9.25),
  Na: ISO(22.9897693, 100),
  Mg: ISO(23.9850417, 78.99, 24.985837, 10.0, 25.982593, 11.01),
  Al: ISO(26.9815385, 100),
  Si: ISO(27.9769265, 92.223, 28.9764947, 4.685, 29.9737702, 3.092),
  P: ISO(30.973762, 100),
  S: ISO(31.9720712, 94.99, 32.9714589, 0.75, 33.967867, 4.25, 35.9670808, 0.01),
  Cl: ISO(34.9688527, 75.76, 36.9659026, 24.24),
  Ar: ISO(35.9675451, 0.3336, 37.9627324, 0.0629, 39.9623831, 99.6035),
  K: ISO(38.9637065, 93.2581, 39.9639982, 0.0117, 40.9618253, 6.7302),
  Ca: ISO(39.9625909, 96.941, 41.9586183, 0.647, 42.9587668, 0.135, 43.9554818, 2.086, 45.953689, 0.004, 47.952534, 0.187),
  Ti: ISO(45.9526316, 8.25, 46.9517631, 7.44, 47.9479463, 73.72, 48.94787, 5.41, 49.9447912, 5.18),
  V: ISO(49.9471585, 0.25, 50.9439595, 99.75),
  Cr: ISO(49.9460442, 4.345, 51.9405075, 83.789, 52.9406494, 9.501, 53.9388804, 2.365),
  Mn: ISO(54.9380439, 100),
  Fe: ISO(53.939609, 5.845, 55.9349363, 91.754, 56.9353928, 2.119, 57.9332744, 0.282),
  Co: ISO(58.9331943, 100),
  Ni: ISO(57.9353429, 68.0769, 59.9307864, 26.2231, 60.931056, 1.1399, 61.9283451, 3.6345, 63.927966, 0.9256),
  Cu: ISO(62.9295975, 69.15, 64.9277895, 30.85),
  Zn: ISO(63.9291422, 49.17, 65.9260334, 27.73, 66.9271273, 4.04, 67.9248442, 18.45, 69.9253193, 0.61),
  Ga: ISO(68.9255736, 60.108, 70.9247013, 39.892),
  Ge: ISO(69.9242474, 20.57, 71.9220758, 27.45, 72.9234589, 7.75, 73.9211778, 36.5, 75.9214026, 7.73),
  As: ISO(74.9215965, 100),
  Se: ISO(73.9224764, 0.89, 75.9192136, 9.37, 76.919914, 7.63, 77.9173091, 23.77, 79.9165213, 49.61, 81.9166994, 8.73),
  Br: ISO(78.9183376, 50.69, 80.9162897, 49.31),
  Kr: ISO(77.9203648, 0.355, 79.916379, 2.286, 81.9134836, 11.593, 82.9141271, 11.5, 83.9114977, 56.987, 85.9106106, 17.279),
  Rb: ISO(84.9117897, 72.17, 86.9091805, 27.83),
  Sr: ISO(83.9134191, 0.56, 85.9092606, 9.86, 86.9088775, 7.0, 87.9056125, 82.58),
  Y: ISO(88.9058483, 100),
  Zr: ISO(89.9046977, 51.45, 90.9056396, 11.22, 91.9050347, 17.15, 93.9063108, 17.38, 95.9082714, 2.8),
  Nb: ISO(92.906373, 100),
  Mo: ISO(91.906807, 14.84, 93.9050838, 9.25, 94.905841, 15.92, 95.9046761, 16.68, 96.9060181, 9.55, 97.9054048, 24.13, 99.907478, 9.63),
  Ru: ISO(95.9075902, 5.54, 97.905287, 1.87, 98.9059393, 12.76, 99.9042195, 12.6, 100.9055822, 17.06, 101.9043495, 31.55, 103.90543, 18.62),
  Rh: ISO(102.905504, 100),
  Pd: ISO(101.905608, 1.02, 103.904035, 11.14, 104.905084, 22.33, 105.903483, 27.33, 107.903894, 26.46, 109.905153, 11.72),
  Ag: ISO(106.905093, 51.839, 108.904756, 48.161),
  Cd: ISO(105.906458, 1.25, 107.904183, 0.89, 109.9030021, 12.49, 110.9041781, 12.8, 111.9027578, 24.13, 112.9044017, 12.22, 113.9033585, 28.73, 115.904756, 7.49),
  In: ISO(112.904058, 4.29, 114.903878, 95.71),
  Sn: ISO(111.904818, 0.97, 113.902779, 0.66, 114.903342, 0.34, 115.901741, 14.54, 116.902952, 7.68, 117.901603, 24.22, 118.903308, 8.59, 119.9022016, 32.58, 121.9034438, 4.63, 123.9052766, 5.79),
  Sb: ISO(120.903812, 57.21, 122.9042132, 42.79),
  Te: ISO(119.9040593, 0.09, 121.9030435, 2.55, 122.9042698, 0.89, 123.9028171, 4.74, 124.9044299, 7.07, 125.9033109, 18.84, 127.9044613, 31.74, 129.9062227, 34.08),
  I: ISO(126.904473, 100),
  Xe: ISO(123.905892, 0.09, 125.904274, 0.09, 127.9035313, 1.92, 128.9047794, 26.44, 129.903508, 4.08, 130.9050824, 21.18, 131.9041551, 26.89, 133.9053947, 10.44, 135.907219, 8.87),
  Cs: ISO(132.905452, 100),
  Ba: ISO(129.906321, 0.106, 131.905061, 0.101, 133.904508, 2.417, 134.905688, 6.592, 135.904576, 7.854, 136.905827, 11.232, 137.905247, 71.698),
  La: ISO(137.907112, 0.089, 138.9063533, 99.911),
  Ce: ISO(135.907172, 0.185, 137.905991, 0.251, 139.9054387, 88.45, 141.909244, 11.114),
  Pr: ISO(140.9076576, 100),
  Nd: ISO(141.907729, 27.2, 142.90982, 12.2, 143.910093, 23.8, 144.9125793, 8.3, 145.9131226, 17.2, 147.916893, 5.7, 149.920891, 5.6),
  Sm: ISO(143.911999, 3.07, 146.914898, 14.99, 147.914823, 11.24, 148.917185, 13.82, 149.917276, 7.38, 151.919732, 26.75, 153.922209, 22.75),
  Eu: ISO(150.91985, 47.81, 152.92123, 52.19),
  Gd: ISO(151.919791, 0.2, 153.920866, 2.18, 154.922622, 14.8, 155.922123, 20.47, 156.92396, 15.65, 157.924104, 24.84, 159.927054, 21.86),
  Tb: ISO(158.925347, 100),
  Dy: ISO(155.924283, 0.056, 157.924409, 0.095, 159.925197, 2.329, 160.926933, 18.889, 161.926798, 25.475, 162.928731, 24.896, 163.929175, 28.26),
  Ho: ISO(164.930322, 100),
  Er: ISO(161.928778, 0.139, 163.9292, 1.601, 165.930293, 33.503, 166.932048, 22.869, 167.93237, 26.978, 169.935464, 14.91),
  Tm: ISO(168.934213, 100),
  Yb: ISO(167.933897, 0.123, 169.934762, 2.982, 170.936326, 14.086, 171.936382, 21.686, 172.938211, 16.103, 173.938862, 32.025, 175.942572, 12.995),
  Lu: ISO(174.9407752, 97.401, 175.9426897, 2.599),
  Hf: ISO(173.940046, 0.16, 175.941409, 5.26, 176.943221, 18.6, 177.943699, 27.28, 178.945816, 13.62, 179.94655, 35.08),
  Ta: ISO(179.947465, 0.01201, 180.947996, 99.98799),
  W: ISO(179.946704, 0.12, 181.9482042, 26.5, 182.950223, 14.31, 183.9509312, 30.64, 185.9543641, 28.43),
  Re: ISO(184.952955, 37.4, 186.9557531, 62.6),
  Os: ISO(183.9524891, 0.02, 185.9538382, 1.59, 186.9557505, 1.96, 187.9558382, 13.24, 188.9581475, 16.15, 189.958447, 26.26, 191.9614807, 40.78),
  Ir: ISO(190.960594, 37.3, 192.9629264, 62.7),
  Pt: ISO(189.959932, 0.012, 191.961038, 0.782, 193.9626803, 32.86, 194.9647917, 33.78, 195.9649521, 25.21, 197.967893, 7.36),
  Au: ISO(196.9665688, 100),
  Hg: ISO(195.965833, 0.15, 197.9667686, 9.97, 198.9682806, 16.87, 199.9683266, 23.1, 200.9703028, 13.18, 201.9706434, 29.86, 203.9734939, 6.87),
  Tl: ISO(202.9723446, 29.52, 204.9744278, 70.48),
  Pb: ISO(203.973044, 1.4, 205.9744657, 24.1, 206.9758973, 22.1, 207.9766525, 52.4),
  Bi: ISO(208.9803991, 100),
  Th: ISO(232.0380558, 100),
  U: ISO(234.0409523, 0.0054, 235.0439301, 0.7204, 238.0507884, 99.2742),
}

/** Mass of the electron in u (for the m/z of ions). */
export const ELECTRON_MASS = 0.000548579909
