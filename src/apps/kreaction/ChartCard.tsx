// A chart with its Save PNG / SVG and Pin buttons.

import { useRef } from 'react'
import { Image as ImageIcon, Pin } from 'lucide-react'
import type { Figure } from './figures'
import PlotlyChart, { svgFromDataUrl, type ChartHandle } from './PlotlyChart'
import { Card, useKr } from './ui'

interface Props {
  title: string
  figure: Figure | null
  printFigure?: Figure | null
  height?: number
  /** File name without extension. */
  name: string
  /** Text pinned with the chart. */
  pinText?: string
  tool: string
  empty?: string
  children?: React.ReactNode
}

export function ChartCard({ title, figure, printFigure, height = 300, name, pinText, tool, empty, children }: Props) {
  const kr = useKr()
  const chart = useRef<ChartHandle>(null)
  const save = async (format: 'png' | 'svg') => {
    const url = await chart.current?.toImage(format)
    if (!url) return kr.say('The chart is not ready yet.')
    kr.saveImage(name, format === 'svg' ? svgFromDataUrl(url) : url, format)
  }
  const pin = async () => {
    const url = await chart.current?.toImage('svg')
    kr.pin(tool, title, pinText ?? title, url ? [svgFromDataUrl(url)] : [])
  }
  return (
    <Card
      title={title}
      actions={
        <>
          <button className="k-btn small" onClick={() => void save('png')} disabled={!figure} title="Save the chart as a PNG picture"><ImageIcon size={13} /> PNG</button>
          <button className="k-btn small" onClick={() => void save('svg')} disabled={!figure} title="Save the chart as an SVG picture"><ImageIcon size={13} /> SVG</button>
          <button className="k-btn small" onClick={() => void pin()} disabled={!figure} title="Pin the chart and its numbers to the notebook"><Pin size={13} /> Pin</button>
        </>
      }
    >
      <PlotlyChart ref={chart} figure={figure} printFigure={printFigure} height={height} empty={empty} />
      {children}
    </Card>
  )
}
