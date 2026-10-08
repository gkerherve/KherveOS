// A QToolBar: the desktop's horizontal and vertical tool bars. Action
// buttons (checkable ones show their state), the operation families'
// split buttons (GroupButton: a click runs the tool used last, the arrow
// lists the family), and widgets (the Grid spin box, the Plane combo).

import { memo } from 'react'
import { ChevronDown } from 'lucide-react'
import { MdiIcon } from '../MdiIcon'
import { plainText } from '../nodes'
import type { ActionNode, Node } from '../types'
import { useQt } from './context'
import { QtNode, tipAttr } from './QtNode'

const ICON = 24

function ActionButton({ a }: { a: ActionNode }) {
  const { send, menu } = useQt()
  return (
    <button
      type="button"
      className={`kc-tool${a.chk ? ' checked' : ''}${a.beside ? ' beside' : ''}`}
      disabled={!!a.dis}
      aria-label={plainText(a.text)}
      {...tipAttr(a.tip || plainText(a.text))}
      onClick={(e) => {
        if (a.menu) menu(a.menu, e)
        else send({ op: 'trigger', id: a.id })
      }}
    >
      {a.icon ? <MdiIcon name={a.icon} size={ICON} /> : <span className="kc-tool-text">{plainText(a.text)}</span>}
      {a.beside && a.icon ? <span className="kc-tool-text">{plainText(a.text)}</span> : null}
      {a.menu && <ChevronDown size={10} className="kc-chev" />}
    </button>
  )
}

/** The GroupButton: default action + family menu. */
function GroupButton({ n }: { n: Node }) {
  const { send, menu } = useQt()
  return (
    <span className="kc-group-button" {...tipAttr(n.tip)}>
      <button type="button" className={`kc-tool${n.chk ? ' checked' : ''}`} disabled={!!n.dis} onClick={() => n.act && send({ op: 'trigger', id: n.act })}>
        {n.icon ? <MdiIcon name={n.icon} size={ICON} /> : <span className="kc-tool-text">{plainText(n.text)}</span>}
      </button>
      <button
        type="button"
        className="kc-tool-arrow"
        disabled={!!n.dis}
        onClick={(e) => {
          const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
          menu(n.menu ?? [], { clientX: r.left, clientY: r.bottom })
        }}
      >
        <ChevronDown size={11} />
      </button>
    </span>
  )
}

export const Toolbar = memo(function Toolbar({ n }: { n: Node }) {
  const vertical = n.o === 2
  const items = (n.items ?? []) as (ActionNode | Node)[]
  return (
    <div className={`kc-toolbar ${vertical ? 'vertical' : 'horizontal'}`} role="toolbar" aria-label={n.title}>
      {items.map((it, i) => {
        if ('sep' in it && it.sep) return <div key={`s${i}`} className="kc-toolbar-sep" />
        const node = it as Node
        if (node.t === 'tbutton' && node.menu && node.popup === 1) return <GroupButton key={node.id} n={node} />
        if (node.t) return <QtNode key={node.id} n={node} />
        const a = it as ActionNode
        // never an empty button (an unresolved widget, an action with nothing to show)
        if ((node as Node).same || (!a.icon && !plainText(a.text))) return null
        return <ActionButton key={a.id} a={a} />
      })}
    </div>
  )
})
