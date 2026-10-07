// The periodic table: one tile per element with its atomic number, the binding
// energy of its main XPS line and that line. Click selects, double-click opens
// the other databases, right-click shows the XPS information.

import { memo, type MouseEvent } from 'react'
import type { ElementsFile } from './data'

export const CATEGORY_NAMES: Record<string, string> = {
  alkali_metal: 'Alkali metal',
  alkaline_earth: 'Alkaline earth',
  transition_metal: 'Transition metal',
  post_transition: 'Post-transition',
  metalloid: 'Metalloid',
  nonmetal: 'Nonmetal',
  halogen: 'Halogen',
  noble_gas: 'Noble gas',
  lanthanide: 'Lanthanide',
  actinide: 'Actinide',
}

interface Props {
  meta: ElementsFile
  withData: Set<string>
  selected: string | null
  /** Symbol only, no category colours (the Python app's Simplified Periodic Table). */
  simplified: boolean
  /** Tiles too small for the small labels: symbol only. */
  dense: boolean
  onSelect: (el: string) => void
  onOpen: (el: string) => void
  onInfo: (el: string, x: number, y: number) => void
}

/** Where to open the info window: at the pointer, or under the tile for a keyboard context menu. */
function menuPoint(e: MouseEvent<HTMLElement>) {
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY }
  const r = e.currentTarget.getBoundingClientRect()
  return { x: r.left, y: r.bottom }
}

function PeriodicTable({ meta, withData, selected, simplified, dense, onSelect, onOpen, onInfo }: Props) {
  return (
    <div
      className={`kdb-ptable${simplified ? ' kdb-simple' : ''}${dense ? ' kdb-dense' : ''}`}
      role="group"
      aria-label="Periodic table"
    >
      {Object.entries(meta.elements).map(([el, m]) => {
        const enabled = withData.has(el)
        const name = String(m.props.Name ?? el)
        // The tile's small labels, for when they are hidden (small tiles, simplified table).
        const main = /^\d/.test(m.be) ? ` · ${el} ${m.main} ≈ ${m.be} eV` : ''
        return (
          <button
            key={el}
            type="button"
            className={`kdb-tile kdb-cat-${m.cat}${selected === el ? ' kdb-selected' : ''}${enabled ? '' : ' kdb-off'}`}
            style={{ gridRow: m.row + 1, gridColumn: m.col + 1 }}
            aria-disabled={!enabled || undefined}
            aria-pressed={selected === el}
            aria-label={`${name}, ${el}`}
            tabIndex={enabled ? 0 : -1}
            title={
              enabled
                ? `${name}${main}\nClick to show NIST entries, double-click for Other Databases & Properties,\nright-click for electronic structure, XPS peak positions and overlaps`
                : `${name}${main}\nNo entries in the NIST database`
            }
            onClick={() => enabled && onSelect(el)}
            onDoubleClick={() => enabled && onOpen(el)}
            onContextMenu={(e) => {
              e.preventDefault()
              if (!enabled) return
              const p = menuPoint(e)
              onInfo(el, p.x, p.y)
            }}
          >
            <span className="kdb-z">{m.z}</span>
            <span className="kdb-be">{m.be}</span>
            <span className="kdb-sym">{el}</span>
            <span className="kdb-line">{m.main}</span>
          </button>
        )
      })}
      <span className="kdb-marker" style={{ gridRow: 6, gridColumn: 3 }}>*</span>
      <span className="kdb-marker" style={{ gridRow: 7, gridColumn: 3 }}>**</span>
      <span className="kdb-marker" style={{ gridRow: 9, gridColumn: 2 }}>*</span>
      <span className="kdb-marker" style={{ gridRow: 10, gridColumn: 2 }}>**</span>
      {/* The colour key fills the gap above the transition metals. */}
      {!simplified && !dense && (
        <div className="kdb-legend" style={{ gridRow: '1 / span 3', gridColumn: '3 / span 10' }} aria-hidden="true">
          <div className="kdb-legend-items">
            {Object.entries(CATEGORY_NAMES).map(([cat, label]) => (
              <span key={cat} className="kdb-legend-item">
                <i className={`kdb-swatch kdb-cat-${cat}`} />
                {label}
              </span>
            ))}
          </div>
          <div className="kdb-legend-hint">Click: NIST entries · Double-click: databases · Right-click: XPS info</div>
        </div>
      )}
    </div>
  )
}

export default memo(PeriodicTable)
