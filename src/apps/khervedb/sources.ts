// The other databases KherveDB links to, for the selected element.

import type { ElementMeta } from './data'

export interface Source {
  id: string
  title: string
  help: string
  /** Sources with a search box: the material typed by the user refines the query. */
  search?: {
    placeholder: string
    /** The query sent to Google Scholar, shown under the box. */
    describe: (terms: string) => string
    query: (terms: string, newest: boolean) => string
    /** Offers "High citations" (unticked: newest papers first), as the Python app. */
    sortable?: boolean
  }
  url: (el: string, meta: ElementMeta) => string
}

const scholar = (q: string, newest = false) =>
  `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}${newest ? '&scisbd=1' : ''}`
const sssQuery = (t: string) => `source:"Surface Science Spectra" XPS ${t}`
const estrQuery = (t: string) => `electronic structure ${t}`
export const elementName = (el: string, m: ElementMeta) => String(m.props.Name ?? el)

export const SOURCES: Source[] = [
  {
    id: 'xpsfitting',
    title: 'XPS Fitting',
    help: 'XPSfitting.com (M. Biesinger): practical notes, reference spectra and fitting parameters for the element.',
    url: (_el, m) => m.urls.xpsfitting,
  },
  {
    id: 'harwell',
    title: 'Harwell XPS Guru',
    help: 'Harwell XPS knowledge base: peak positions, fitting advice and pitfalls for the element.',
    url: (_el, m) => m.urls.harwell,
  },
  {
    id: 'thermo',
    title: 'Thermo Knowledge',
    help: 'Thermo Fisher XPS periodic table: main peaks, overlaps, spin-orbit splitting and chemical-state tables.',
    url: (_el, m) => m.urls.thermo,
  },
  {
    id: 'sss',
    title: 'SSS from Scholar',
    help:
      'Reference spectra from Surface Science Spectra. Type a material in the search box (e.g. Fe2O3) and press Enter: ' +
      'the search is refined to source:"Surface Science Spectra" XPS + your material.',
    search: { placeholder: 'Material, e.g. Fe2O3', describe: sssQuery, query: (t) => scholar(sssQuery(t)) },
    url: (el, m) => scholar(sssQuery(elementName(el, m))),
  },
  {
    id: 'estr',
    title: 'Good paper Scholar',
    help:
      'Papers on the electronic structure of a material. Type a material in the search box (e.g. TiO2 anatase) ' +
      "and press Enter: 'electronic structure' is added to your terms.",
    search: {
      placeholder: 'Material, e.g. TiO2 anatase',
      describe: estrQuery,
      query: (t, newest) => scholar(estrQuery(t), newest),
      sortable: true,
    },
    url: (el, m) => scholar(estrQuery(elementName(el, m))),
  },
]

export const PROPS_TAB = {
  id: 'props',
  title: 'General Properties',
  help: 'Physical and atomic properties of the element, and its main XPS lines.',
}

/** The page a source opens: the search for the typed terms (else the element's name), or the element's own page. */
export function sourceUrl(s: Source, el: string, m: ElementMeta, terms = '', newest = false): string {
  if (!s.search) return s.url(el, m)
  return s.search.query(terms.trim() || elementName(el, m), newest)
}
