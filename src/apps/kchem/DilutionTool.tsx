// Dilution C1·V1 = C2·V2: leave one box empty and it is found.

import { useMemo } from 'react'
import { Droplets } from 'lucide-react'
import { dilution, fmt, parseNum } from './chem'
import type { DilutionForm } from './forms'
import { Answer, Card, Err, Field, Hint, NumInput, ResultActions } from './ui'

const LABELS = { c1: 'C₁ (stock concentration)', v1: 'V₁ (stock volume)', c2: 'C₂ (wanted concentration)', v2: 'V₂ (final volume)' } as const

export function DilutionTool({ f, set }: { f: DilutionForm; set: (p: Partial<DilutionForm>) => void }) {
  const r = useMemo(() => {
    try {
      const keys = ['c1', 'v1', 'c2', 'v2'] as const
      const v = keys.map((k) => parseNum(f[k]))
      if (v.some((x) => x !== null && Number.isNaN(x))) return { error: 'Type numbers (or leave one box empty).' }
      if (v.some((x) => x !== null && x <= 0)) return { error: 'Values must be above zero.' }
      return { d: dilution(v[0], v[1], v[2], v[3]), missing: keys.find((k) => parseNum(f[k]) === null) as (typeof keys)[number] }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [f])
  const text = 'd' in r && r.d
    ? `C1 = ${fmt(r.d.c1)}, V1 = ${fmt(r.d.v1)}, C2 = ${fmt(r.d.c2)}, V2 = ${fmt(r.d.v2)}\nTake ${fmt(r.d.v1)} of stock and add diluent to ${fmt(r.d.v2)} (${fmt(r.d.v2 - r.d.v1)} of diluent).`
    : ''
  return (
    <div className="kc-tool-body">
      <Card title="Dilution: C₁·V₁ = C₂·V₂" icon={<Droplets size={15} />} actions={<ResultActions tool="dilution" label="Dilution" text={text} />}>
        <div className="kc-grid kc-four">
          {(['c1', 'v1', 'c2', 'v2'] as const).map((k) => (
            <Field key={k} label={LABELS[k]}>
              <NumInput value={f[k]} onChange={(v) => set({ [k]: v })} placeholder="empty = find" label={k.toUpperCase()} />
            </Field>
          ))}
        </div>
        {'error' in r ? <Err>{r.error}</Err> : (
          <>
            <Answer>
              {r.missing === 'c1' && <>C₁ = <b>{fmt(r.d.c1)}</b></>}
              {r.missing === 'v1' && <>V₁ = <b>{fmt(r.d.v1)}</b></>}
              {r.missing === 'c2' && <>C₂ = <b>{fmt(r.d.c2)}</b></>}
              {r.missing === 'v2' && <>V₂ = <b>{fmt(r.d.v2)}</b></>}
            </Answer>
            <div className="kc-kv">
              <span>C₁</span><b>{fmt(r.d.c1)}</b><span>V₁</span><b>{fmt(r.d.v1)}</b>
              <span>C₂</span><b>{fmt(r.d.c2)}</b><span>V₂</span><b>{fmt(r.d.v2)}</b>
              <span>Dilution factor</span><b>{fmt(r.d.c1 / r.d.c2)}</b>
              <span>Diluent to add</span><b>{r.d.v2 >= r.d.v1 ? fmt(r.d.v2 - r.d.v1) : '–'}</b>
            </div>
            {r.d.v2 < r.d.v1 && <Err>That would need a final volume smaller than the stock volume: C₂ is higher than C₁ (it is not a dilution).</Err>}
            <div className="kc-result">Take <b>{fmt(r.d.v1)}</b> of the stock and add diluent up to <b>{fmt(r.d.v2)}</b>.</div>
          </>
        )}
        <Hint>Leave exactly one box empty: that is the value found. Concentrations in one unit and volumes in one unit.</Hint>
      </Card>
    </div>
  )
}
