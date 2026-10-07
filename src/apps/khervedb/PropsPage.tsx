// "General Properties" of an element: the desktop references window's last
// tab, shown here as a tab of the Other Databases & Properties panel.

import type { ElementsFile } from './data'

export const PROPERTY_GROUPS: [string, string[]][] = [
  ['Atomic', ['Atomic Number', 'Atomic Mass', 'Electron Configuration', 'Ground State', 'Electronegativity', 'Atomic Radius', 'Ionization Energy']],
  ['Physical', ['State at 20°C', 'Density', 'Melting Point', 'Boiling Point', 'Specific Heat', 'Group', 'Period', 'Category']],
  ['XPS', ['Common Core Levels', 'Most Intense Line', 'Typical FWHM', 'Chemical Shift Range']],
  // Shown by the Python app's General Information, not by the React version.
  ['Discovery', ['Discovered By', 'Year of Discovery']],
]

export function PropsPage({ el, meta }: { el: string; meta: ElementsFile }) {
  const m = meta.elements[el]
  if (!m) return null
  const overlaps = meta.overlaps[el]
  return (
    <div className="kdb-props-page">
      {PROPERTY_GROUPS.map(([group, keys]) => {
        const present = keys.filter((k) => m.props[k] != null && m.props[k] !== '')
        return present.length ? (
          <section key={group}>
            <h3>{group}</h3>
            <dl className="kdb-props">
              {present.map((k) => (
                <Row key={k} k={k} v={String(m.props[k])} />
              ))}
            </dl>
          </section>
        ) : null
      })}
      {overlaps && (
        <section>
          <h3>Common XPS overlaps</h3>
          <p>{overlaps}</p>
        </section>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  )
}
