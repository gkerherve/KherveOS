// Vector-shape geometry shared by the canvas (SVG) and the serializer (TikZ),
// from the desktop's kherveslide/shapes.py. Every shape is drawn in a unit
// box: (0,0) top-left, (1,1) bottom-right, so it fills whatever box it gets.

export type Pt = [number, number]

function regular(n: number, rot = 0): Pt[] {
  const pts: Pt[] = []
  for (let k = 0; k < n; k++) {
    const a = ((-90 + rot + (k * 360) / n) * Math.PI) / 180
    pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)])
  }
  return pts
}

function star(points: number, inner = 0.4): Pt[] {
  const pts: Pt[] = []
  for (let k = 0; k < points * 2; k++) {
    const r = k % 2 === 0 ? 0.5 : inner
    const a = ((-90 + (k * 180) / points) * Math.PI) / 180
    pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)])
  }
  return pts
}

const POLY: Record<string, Pt[]> = {
  triangle: [[0.5, 0.0], [1.0, 1.0], [0.0, 1.0]],
  right_triangle: [[0.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
  diamond: [[0.5, 0.0], [1.0, 0.5], [0.5, 1.0], [0.0, 0.5]],
  parallelogram: [[0.25, 0.0], [1.0, 0.0], [0.75, 1.0], [0.0, 1.0]],
  trapezoid: [[0.2, 0.0], [0.8, 0.0], [1.0, 1.0], [0.0, 1.0]],
  pentagon: regular(5),
  hexagon: regular(6),
  heptagon: regular(7),
  octagon: regular(8),
  star5: star(5),
  star6: star(6),
  star4: star(4, 0.34),
  arrow_right: [[0.0, 0.32], [0.6, 0.32], [0.6, 0.06], [1.0, 0.5], [0.6, 0.94], [0.6, 0.68], [0.0, 0.68]],
  arrow_left: [[1.0, 0.32], [0.4, 0.32], [0.4, 0.06], [0.0, 0.5], [0.4, 0.94], [0.4, 0.68], [1.0, 0.68]],
  arrow_up: [[0.32, 1.0], [0.32, 0.4], [0.06, 0.4], [0.5, 0.0], [0.94, 0.4], [0.68, 0.4], [0.68, 1.0]],
  arrow_down: [[0.32, 0.0], [0.32, 0.6], [0.06, 0.6], [0.5, 1.0], [0.94, 0.6], [0.68, 0.6], [0.68, 0.0]],
  double_arrow: [[0.0, 0.5], [0.22, 0.08], [0.22, 0.32], [0.78, 0.32], [0.78, 0.08], [1.0, 0.5], [0.78, 0.92], [0.78, 0.68], [0.22, 0.68], [0.22, 0.92]],
  chevron: [[0.0, 0.0], [0.72, 0.0], [1.0, 0.5], [0.72, 1.0], [0.0, 1.0], [0.28, 0.5]],
  pentagon_arrow: [[0.0, 0.0], [0.72, 0.0], [1.0, 0.5], [0.72, 1.0], [0.0, 1.0]],
  plus: [[0.34, 0.0], [0.66, 0.0], [0.66, 0.34], [1.0, 0.34], [1.0, 0.66], [0.66, 0.66], [0.66, 1.0], [0.34, 1.0], [0.34, 0.66], [0.0, 0.66], [0.0, 0.34], [0.34, 0.34]],
  lightning: [[0.55, 0.0], [0.2, 0.55], [0.45, 0.55], [0.3, 1.0], [0.8, 0.4], [0.5, 0.4], [0.7, 0.0]],
  speech: [[0.0, 0.0], [1.0, 0.0], [1.0, 0.75], [0.45, 0.75], [0.2, 1.0], [0.25, 0.75], [0.0, 0.75]],
}

/** The Shapes menu: groups of [key, label]. */
export const SHAPE_GROUPS: [string, [string, string][]][] = [
  ['Rectangles', [['rect', 'Rectangle'], ['rounded_rect', 'Rounded rectangle']]],
  [
    'Basic',
    [
      ['ellipse', 'Ellipse'], ['circle', 'Circle'], ['triangle', 'Triangle'], ['right_triangle', 'Right triangle'], ['diamond', 'Diamond'],
      ['parallelogram', 'Parallelogram'], ['trapezoid', 'Trapezoid'], ['plus', 'Cross / plus'],
    ],
  ],
  ['Polygons', [['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'], ['heptagon', 'Heptagon'], ['octagon', 'Octagon']]],
  [
    'Arrows',
    [
      ['arrow_right', 'Arrow right'], ['arrow_left', 'Arrow left'], ['arrow_up', 'Arrow up'], ['arrow_down', 'Arrow down'],
      ['double_arrow', 'Double arrow'], ['chevron', 'Chevron'], ['pentagon_arrow', 'Arrow pentagon'],
    ],
  ],
  ['Stars & symbols', [['star4', '4-point star'], ['star5', '5-point star'], ['star6', '6-point star'], ['lightning', 'Lightning'], ['speech', 'Speech bubble']]],
]

export type Outline = { kind: 'ellipse' } | { kind: 'rect'; rounded: boolean } | { kind: 'poly'; pts: Pt[] }

export function outline(shape: string): Outline {
  if (shape === 'ellipse' || shape === 'circle') return { kind: 'ellipse' }
  if (shape === 'rounded_rect') return { kind: 'rect', rounded: true }
  if (shape === 'rect') return { kind: 'rect', rounded: false }
  const pts = POLY[shape]
  return pts ? { kind: 'poly', pts } : { kind: 'rect', rounded: false }
}

/** A rect with corner "rounded" is drawn as the rounded rectangle. */
export function effectiveShape(o: { shape: string; corner: string }): string {
  return o.shape === 'rect' && o.corner === 'rounded' ? 'rounded_rect' : o.shape
}
