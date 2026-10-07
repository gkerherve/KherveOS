// The desktop KherveSlide's own toolbar icons. On the desktop they are drawn
// at run time with QPainter (kherveslide/icons.py), in a light and a dark
// variant; public/apps/kherveslide/icons/{light,dark}/<name>.png are those
// drawings rendered at 2x by the desktop code itself. The dark set is used on
// KherveOS's dark chrome, the light set in a window set to Light
// (Settings › Appearance), which carries data-dark="0".

import type { ReactNode } from 'react'

const BASE = `${import.meta.env.BASE_URL}apps/kherveslide/icons/`

export type IconName =
  | 'align_center' | 'align_left' | 'align_right' | 'arrow_tool' | 'auto_compile_off' | 'auto_compile_on' | 'bold' | 'branch'
  | 'bullet_list' | 'chemfig_structure' | 'chemistry' | 'commit' | 'compile_no_images' | 'delete_box' | 'drawing' | 'ellipse_tool'
  | 'equation_builder' | 'export_pdf' | 'file_new' | 'file_open' | 'file_save' | 'fill_colour' | 'fit_width' | 'flowchart_builder'
  | 'history' | 'image_box' | 'italic' | 'line_tool' | 'lower_box' | 'next_slide' | 'numbered_list' | 'pdf_side_panel' | 'play'
  | 'prev_slide' | 'raise_box' | 'rect_tool' | 'redo' | 'slide_add' | 'slide_remove' | 'slideshow' | 'subscript' | 'superscript'
  | 'symbol' | 'table' | 'templates_icon' | 'text_box' | 'text_colour' | 'theme_palette' | 'to_back' | 'to_front'
  | 'toggle_navigator' | 'undo' | 'video_box' | 'view_master' | 'view_normal' | 'view_overview' | 'zoom_in' | 'zoom_out'

export function Ico({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <span className="ks2-ico" style={{ width: size, height: size }} aria-hidden>
      <img className="ks2-ico-d" src={`${BASE}dark/${name}.png`} width={size} height={size} alt="" draggable={false} />
      <img className="ks2-ico-l" src={`${BASE}light/${name}.png`} width={size} height={size} alt="" draggable={false} />
    </span>
  )
}

/** A desktop icon for a menu item (MenuItem.image). */
export const menuIcon = (name: IconName): ReactNode => <Ico name={name} size={16} />
