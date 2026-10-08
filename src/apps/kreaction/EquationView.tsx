// A reaction as a row of structures: coefficient, picture, name and formula for every species, "+" signs and the
// arrow with its conditions. Used by the builder, the library and the predictor.

import { Fragment } from 'react'
import { Fx, Mol } from './ui'

export interface EqItem {
  smiles: string | null
  /** Formula text without the charge, shown under the picture. */
  label: string
  name?: string | null
  coeff?: number | null
  charge?: number
}

interface Props {
  reactants: EqItem[]
  products: EqItem[]
  arrow?: string
  above?: string
  below?: string
  /** Width of a structure picture. */
  size?: number
}

function Side({ items, size }: { items: EqItem[]; size: number }) {
  return (
    <>
      {items.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="kr-plus" aria-hidden="true">+</span>}
          <figure className="kr-eqitem">
            <div className="kr-eqpic">
              {s.coeff !== undefined && s.coeff !== null && s.coeff !== 1 && <b className="kr-coeff">{s.coeff}</b>}
              <Mol smiles={s.smiles} width={size} height={Math.round(size * 0.7)} fallback={<span className="kr-bigf"><Fx f={s.label} charge={s.charge} /></span>} />
            </div>
            <figcaption>
              {s.name && <span className="kr-eqname">{s.name}</span>}
              <span className="k-muted kr-small"><Fx f={s.label} charge={s.charge} /></span>
            </figcaption>
          </figure>
        </Fragment>
      ))}
    </>
  )
}

export function EquationView({ reactants, products, arrow = '→', above = '', below = '', size = 150 }: Props) {
  return (
    <div className="kr-equation">
      <Side items={reactants} size={size} />
      <div className="kr-arrowbox">
        {above && <span className="kr-cond kr-small">{above}</span>}
        <span className="kr-arrowglyph" aria-label="reaction arrow">{arrow}</span>
        {below && <span className="kr-cond kr-small">{below}</span>}
      </div>
      <Side items={products} size={size} />
    </div>
  )
}
