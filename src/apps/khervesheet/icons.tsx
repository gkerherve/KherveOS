// The desktop KherveSheet's own icons. On the desktop they are drawn at run
// time (QPainter glyphs and qtawesome MDI icons, khervesheet/icons.py);
// public/apps/khervesheet/icons/{light,dark}/<name>.png are those drawings,
// rendered at 2x by the desktop code itself (tools/render_khervesheet_icons.py).
// The dark set is used on KherveOS's dark chrome, the light set (the desktop's
// default Emerald theme) in a window set to Light, which carries data-dark="0".

import type { ReactNode } from 'react'

const BASE = `${import.meta.env.BASE_URL}apps/khervesheet/icons/`

export type IconName =
  | 'new_file' | 'open_file' | 'save_file' | 'print' | 'undo' | 'redo' | 'solver' | 'fitting' | 'science' | 'robot' | 'lan_connect'
  | 'bold' | 'italic' | 'underline' | 'align_left' | 'align_center' | 'align_right' | 'border' | 'merge_cells' | 'unmerge_cells'
  | 'table_design' | 'image' | 'shapes' | 'sparkline' | 'equation' | 'omega' | 'symbol' | 'checkbox' | 'dropdown' | 'emoji'
  | 'comment' | 'note' | 'link' | 'fx' | 'source_branch' | 'wrap' | 'table_large' | 'bring_forward' | 'send_backward'
  | 'plot_line' | 'plot_scatter' | 'plot_line_symbol' | 'plot_bar' | 'plot_step' | 'plot_stem' | 'plot_histogram' | 'plot_box'
  | 'plot_heatmap' | 'plot_3d_surface' | 'plot_pie' | 'plot_doughnut' | 'plot_3d_pie'
  | 'border_bottom' | 'border_top' | 'border_left' | 'border_right' | 'border_none' | 'border_all' | 'border_outside'
  | 'border_thick_outside' | 'border_bottom_double' | 'border_thick_bottom' | 'border_top_bottom' | 'border_top_thick_bottom'
  | 'border_top_double_bottom'
  | 'py_open_in_new' | 'py_timer' | 'py_play' | 'py_stop' | 'py_ks' | 'py_pick' | 'py_snippets' | 'py_comment' | 'py_play_circle'
  | 'py_stop_circle' | 'py_help'

/** The desktop's chart types (SheetWidget.PLOT_TYPES) and their toolbar icons. */
export const PLOT_ICONS: Record<string, IconName> = {
  Line: 'plot_line',
  Scatter: 'plot_scatter',
  'Line+Symbol': 'plot_line_symbol',
  Bar: 'plot_bar',
  Step: 'plot_step',
  Stem: 'plot_stem',
  Histogram: 'plot_histogram',
  Box: 'plot_box',
  Heatmap: 'plot_heatmap',
  '3D Surface': 'plot_3d_surface',
  Pie: 'plot_pie',
  Doughnut: 'plot_doughnut',
  '3D Pie': 'plot_3d_pie',
}

export function Ico({ name, size = 32 }: { name: IconName; size?: number }) {
  return (
    <span className="kss-ico" style={{ width: size, height: size }} aria-hidden>
      <img className="kss-ico-d" src={`${BASE}dark/${name}.png`} width={size} height={size} alt="" draggable={false} />
      <img className="kss-ico-l" src={`${BASE}light/${name}.png`} width={size} height={size} alt="" draggable={false} />
    </span>
  )
}

/** A desktop icon for a menu item (MenuItem.image). */
export const menuIcon = (name: IconName): ReactNode => <Ico name={name} size={16} />

/**
 * The fill and font colour buttons: the desktop paints an "A" over a bar of
 * the last colour (icons.fill_color_icon / font_color_icon), redrawn here so
 * the bar follows the chosen colour.
 */
export function ColorGlyph({ kind, color, size = 32 }: { kind: 'fill' | 'font'; color: string; size?: number }) {
  const s = size
  const m = s * 0.18
  return (
    <svg className="kss-colorglyph" width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden>
      <text
        x={s / 2}
        y={s * 0.36}
        dominantBaseline="central"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="bold"
        fontSize={Math.round(s * 0.45) * 1.333}
        fill={kind === 'font' ? color : 'currentColor'}
      >
        A
      </text>
      <rect x={m} y={s * 0.76} width={s - 2 * m} height={s * 0.18} fill={color} stroke={kind === 'fill' ? 'currentColor' : 'none'} strokeWidth={Math.max(1, s / 28)} />
    </svg>
  )
}
