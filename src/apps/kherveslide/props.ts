// What the property dialogs show, per object type and for the presentation
// (the desktop's object_props.py, theme builder and page setup).

import type { FieldSpec } from './dialogs'
import type { ObjectType } from './model'
import { SHAPE_GROUPS } from './shapes'
import { ASPECTS } from './look'
import { BEAMER_COLOR_THEMES, BEAMER_THEMES, FONT_FAMILIES } from './serializer'
import { BULLET_STYLES } from './templates'

const ALIGN: [string, string][] = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]
const LINE_STYLES: [string, string][] = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]
const CORNERS: [string, string][] = [['sharp', 'Sharp'], ['rounded', 'Rounded']]
const GRADIENT: [string, string][] = [['vertical', 'Top → bottom'], ['horizontal', 'Left → right']]

const GEOMETRY: FieldSpec[] = [
  { key: 'x', label: 'Left (0–1)', kind: 'number', step: 0.01, section: 'Position and size (fractions of the slide)' },
  { key: 'y', label: 'Top (0–1)', kind: 'number', step: 0.01 },
  { key: 'w', label: 'Width', kind: 'number', step: 0.01 },
  { key: 'h', label: 'Height', kind: 'number', step: 0.01 },
]

const FRAME: FieldSpec[] = [
  { key: 'fill', label: 'Fill', kind: 'color', section: 'Box' },
  { key: 'fill2', label: 'Gradient to', kind: 'color' },
  { key: 'gradient', label: 'Gradient', kind: 'select', options: GRADIENT },
  { key: 'fill_opacity', label: 'Fill opacity', kind: 'number', min: 0, max: 1, step: 0.05 },
  { key: 'border_color', label: 'Border', kind: 'color' },
  { key: 'border_width', label: 'Border width (pt)', kind: 'number', min: 0.2, max: 20, step: 0.1 },
  { key: 'border_style', label: 'Border style', kind: 'select', options: LINE_STYLES },
  { key: 'corner', label: 'Corners', kind: 'select', options: CORNERS },
  { key: 'corner_radius', label: 'Corner radius (pt)', kind: 'number', min: 0, max: 40, step: 0.5 },
  { key: 'shadow', label: 'Drop shadow', kind: 'bool' },
]

const LOCK: FieldSpec = { key: 'locked', label: 'Locked (beamer places it)', kind: 'bool' }

export const OBJECT_FIELDS: Record<ObjectType, FieldSpec[]> = {
  SlideText: [
    { key: 'text', label: 'Text (LaTeX)', kind: 'textarea' },
    { key: 'font_pt', label: 'Font size (pt)', kind: 'number', min: 4, max: 200, step: 1 },
    { key: 'font_family', label: 'Typeface', kind: 'select', options: [['', 'Theme'], ['sf', 'Sans serif'], ['rm', 'Serif'], ['tt', 'Typewriter']] },
    { key: 'color', label: 'Colour', kind: 'color' },
    { key: 'align', label: 'Alignment', kind: 'select', options: ALIGN },
    { key: 'bold', label: 'Bold', kind: 'bool' },
    { key: 'italic', label: 'Italic', kind: 'bool' },
    {
      key: 'block', label: 'Beamer block', kind: 'select',
      options: [['', 'None'], ['block', 'Block'], ['alertblock', 'Alert block'], ['exampleblock', 'Example block'], ['theorem', 'Theorem'], ['definition', 'Definition'], ['lemma', 'Lemma'], ['corollary', 'Corollary'], ['example', 'Example'], ['proof', 'Proof'], ['fact', 'Fact']],
    },
    { key: 'block_title', label: 'Block title', kind: 'text' },
    ...FRAME,
    ...GEOMETRY,
    LOCK,
  ],
  SlidePicture: [
    { key: 'path', label: 'Picture file', kind: 'text', hint: 'On the drive; relative paths start next to the .kslide' },
    { key: 'keep_aspect', label: 'Keep proportions', kind: 'bool' },
    { key: 'opacity', label: 'Opacity', kind: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'rotation', label: 'Rotation (°, clockwise)', kind: 'number', step: 1 },
    { key: 'crop_l', label: 'Crop left', kind: 'number', min: 0, max: 0.9, step: 0.01, section: 'Crop (fraction of each side)' },
    { key: 'crop_t', label: 'Crop top', kind: 'number', min: 0, max: 0.9, step: 0.01 },
    { key: 'crop_r', label: 'Crop right', kind: 'number', min: 0, max: 0.9, step: 0.01 },
    { key: 'crop_b', label: 'Crop bottom', kind: 'number', min: 0, max: 0.9, step: 0.01 },
    { key: 'brightness', label: 'Brightness', kind: 'number', min: -1, max: 1, step: 0.05, section: 'Picture effects' },
    { key: 'contrast', label: 'Contrast', kind: 'number', min: -1, max: 1, step: 0.05 },
    { key: 'saturation', label: 'Saturation', kind: 'number', min: 0, max: 2, step: 0.05 },
    { key: 'temperature', label: 'Temperature', kind: 'number', min: -1, max: 1, step: 0.05 },
    { key: 'recolor', label: 'Recolour', kind: 'select', options: [['', 'None'], ['grayscale', 'Greyscale'], ['sepia', 'Sepia'], ['washout', 'Washout'], ['bw', 'Black & white'], ['duotone', 'Duotone']] },
    { key: 'artistic', label: 'Artistic', kind: 'select', options: [['', 'None'], ['blur', 'Blur'], ['posterize', 'Posterize']] },
    { key: 'artistic_amount', label: 'Artistic amount', kind: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'mask', label: 'Shape', kind: 'select', options: [['', 'Rectangle'], ['ellipse', 'Ellipse'], ['rounded', 'Rounded']] },
    { key: 'fade', label: 'Fade', kind: 'select', options: [['', 'None'], ['left', 'From the left'], ['right', 'From the right'], ['top', 'From the top'], ['bottom', 'From the bottom'], ['radial', 'Radial']] },
    { key: 'fade_start', label: 'Fade start', kind: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'fade_end', label: 'Fade end', kind: 'number', min: 0, max: 1, step: 0.05 },
    ...FRAME,
    ...GEOMETRY,
    LOCK,
  ],
  SlideTable: [
    { key: 'font_pt', label: 'Font size (pt)', kind: 'number', min: 4, max: 100, step: 1 },
    { key: 'color', label: 'Text colour', kind: 'color' },
    { key: 'align', label: 'Cell alignment', kind: 'select', options: ALIGN },
    { key: 'header', label: 'Header row', kind: 'bool' },
    { key: 'header_bg', label: 'Header background', kind: 'color' },
    { key: 'header_fg', label: 'Header text', kind: 'color' },
    { key: 'grid', label: 'Rules', kind: 'select', options: [['all', 'All'], ['horizontal', 'Horizontal'], ['outer', 'Top and bottom'], ['none', 'None']] },
    { key: 'rule_color', label: 'Rule colour', kind: 'color' },
    { key: 'rule_width', label: 'Rule width (pt)', kind: 'number', min: 0.1, max: 5, step: 0.1 },
    { key: 'striped', label: 'Striped rows', kind: 'bool' },
    { key: 'stripe_color', label: 'Stripe colour', kind: 'color' },
    { key: 'caption', label: 'Caption', kind: 'text' },
    ...FRAME,
    ...GEOMETRY,
    LOCK,
  ],
  SlideLine: [
    { key: 'color', label: 'Colour', kind: 'color' },
    { key: 'width_pt', label: 'Width (pt)', kind: 'number', min: 0.1, max: 30, step: 0.1 },
    { key: 'style', label: 'Style', kind: 'select', options: LINE_STYLES },
    { key: 'arrow_start', label: 'Arrow at the start', kind: 'bool' },
    { key: 'arrow_end', label: 'Arrow at the end', kind: 'bool' },
    { key: 'head_size', label: 'Arrowhead size', kind: 'number', min: 0.3, max: 5, step: 0.1 },
    { key: 'opacity', label: 'Opacity', kind: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'x', label: 'Start x', kind: 'number', step: 0.01, section: 'Ends (fractions of the slide)' },
    { key: 'y', label: 'Start y', kind: 'number', step: 0.01 },
    { key: 'w', label: 'Δx to the end', kind: 'number', step: 0.01 },
    { key: 'h', label: 'Δy to the end', kind: 'number', step: 0.01 },
    { key: 'locked', label: 'Locked (can\'t be dragged)', kind: 'bool' },
  ],
  SlideShape: [
    { key: 'shape', label: 'Shape', kind: 'select', options: SHAPE_GROUPS.flatMap(([, items]) => items) },
    { key: 'fill', label: 'Fill', kind: 'color' },
    { key: 'fill2', label: 'Gradient to', kind: 'color' },
    { key: 'gradient', label: 'Gradient', kind: 'select', options: GRADIENT },
    { key: 'border_color', label: 'Outline', kind: 'color' },
    { key: 'border_width', label: 'Outline width (pt)', kind: 'number', min: 0, max: 20, step: 0.1 },
    { key: 'style', label: 'Outline style', kind: 'select', options: LINE_STYLES },
    { key: 'corner', label: 'Corners (rectangles)', kind: 'select', options: CORNERS },
    { key: 'opacity', label: 'Opacity', kind: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'rotation', label: 'Rotation (°, clockwise)', kind: 'number', step: 1 },
    ...GEOMETRY,
    { key: 'locked', label: 'Locked (can\'t be dragged)', kind: 'bool' },
  ],
  SlideVideo: [
    { key: 'path', label: 'Video file', kind: 'text', hint: 'In the PDF: a link that opens the file in the video player' },
    { key: 'poster', label: 'Poster picture', kind: 'text' },
    ...GEOMETRY,
    { key: 'locked', label: 'Locked (can\'t be dragged)', kind: 'bool' },
  ],
}

export const THEME_FIELDS: FieldSpec[] = [
  { key: 'theme', label: 'Beamer theme', kind: 'select', options: BEAMER_THEMES.map((t) => [t, t]), section: 'Base' },
  { key: 'color_theme', label: 'Colour theme', kind: 'select', options: [['', '(theme default)'], ...BEAMER_COLOR_THEMES.map((t): [string, string] => [t, t])] },
  { key: 'enabled', label: 'Use my own theme settings below', kind: 'bool', section: 'Theme builder' },
  { key: 'structure', label: 'Main colour (structure)', kind: 'color' },
  { key: 'text_fg', label: 'Text colour', kind: 'color' },
  { key: 'canvas_bg', label: 'Background', kind: 'color' },
  { key: 'canvas_bg2', label: 'Background gradient to', kind: 'color' },
  { key: 'title_bg', label: 'Title bar', kind: 'color' },
  { key: 'title_fg', label: 'Title text', kind: 'color' },
  { key: 'block_bg', label: 'Block title background', kind: 'color' },
  { key: 'frametitle_size', label: 'Title size', kind: 'select', options: [['', 'Theme'], ['small', 'Small'], ['normal', 'Normal'], ['large', 'Large'], ['Large', 'Larger'], ['huge', 'Huge']] },
  { key: 'font_family', label: 'Typeface', kind: 'select', options: [['', 'Latin Modern (beamer)'], ...Object.entries(FONT_FAMILIES).map(([k, [name]]): [string, string] => [k, name])] },
  { key: 'fonts', label: 'Font theme', kind: 'select', options: [['', 'Theme'], ['default', 'default'], ['serif', 'serif'], ['professionalfonts', 'professionalfonts'], ['structurebold', 'structurebold'], ['structureitalicserif', 'structureitalicserif'], ['structuresmallcapsserif', 'structuresmallcapsserif']] },
  { key: 'bullets', label: 'Bullets', kind: 'select', options: [...Object.entries(BULLET_STYLES), ['dot', 'Dot (•)']] },
  { key: 'inner', label: 'Inner theme', kind: 'select', options: [['', 'Theme'], ...['default', 'circles', 'rectangles', 'rounded', 'inmargin'].map((t): [string, string] => [t, t])] },
  { key: 'outer', label: 'Outer theme', kind: 'select', options: [['', 'Theme'], ...['default', 'infolines', 'miniframes', 'smoothbars', 'sidebar', 'split', 'shadow', 'tree', 'smoothtree'].map((t): [string, string] => [t, t])] },
  { key: 'title_rule', label: 'Line under the title', kind: 'bool', section: 'Lines, footer and logo' },
  { key: 'footline_rule', label: 'Line along the bottom', kind: 'bool' },
  { key: 'rule_color', label: 'Line colour', kind: 'color' },
  { key: 'rule_width', label: 'Line width (pt)', kind: 'number', min: 0.2, max: 10, step: 0.1 },
  { key: 'footer_bar', label: 'Footer bar (author · title · n / N)', kind: 'bool' },
  { key: 'logo', label: 'Logo picture', kind: 'text', hint: 'A picture on the drive, drawn on every slide' },
  { key: 'logo_corner', label: 'Logo corner', kind: 'select', options: [['tr', 'Top right'], ['tl', 'Top left'], ['br', 'Bottom right'], ['bl', 'Bottom left']] },
  { key: 'logo_size', label: 'Logo height (fraction)', kind: 'number', min: 0.03, max: 0.4, step: 0.01 },
]

export const PAGE_FIELDS: FieldSpec[] = [
  { key: 'title', label: 'Title', kind: 'text', section: 'Presentation' },
  { key: 'author', label: 'Author', kind: 'text' },
  { key: 'aspect', label: 'Aspect ratio', kind: 'select', options: ASPECTS, section: 'Page' },
  { key: 'page_w_cm', label: 'Custom width (cm, 0 = aspect)', kind: 'number', min: 0, max: 100, step: 0.1 },
  { key: 'page_h_cm', label: 'Custom height (cm, 0 = aspect)', kind: 'number', min: 0, max: 100, step: 0.1 },
  { key: 'gap', label: 'Margin (fraction of the page)', kind: 'number', min: 0, max: 0.45, step: 0.01 },
  { key: 'plain_frames', label: 'Plain frames (no theme decorations)', kind: 'bool', section: 'Decorations' },
  { key: 'nav_symbols', label: 'Navigation symbols in the PDF', kind: 'bool' },
  { key: 'page_number', label: 'Slide numbers', kind: 'select', options: [['none', 'None'], ['number', 'Number'], ['of_total', 'n / N']] },
  { key: 'header', label: 'Header', kind: 'text' },
  { key: 'foot_left', label: 'Footer left', kind: 'text' },
  { key: 'foot_center', label: 'Footer centre', kind: 'text' },
  { key: 'foot_right', label: 'Footer right', kind: 'text' },
]
