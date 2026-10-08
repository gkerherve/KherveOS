// RDKit draws black-on-transparent SVG with fixed element colours. For the screen the strokes become
// currentColor and the element colours become theme variables, so a structure reads on a dark theme and on a
// light one. For files the plain picture (with a white background) is used. Pure string functions.

/** RDKit's element colours → theme variables. */
const ELEMENT_COLOURS: Record<string, string> = {
  '#0000FF': 'var(--k-link)', // N
  '#FF0000': 'var(--k-danger)', // O
  '#00CC00': 'var(--k-success)', // Cl
  '#33CCCC': 'var(--k-success)', // F
  '#7F4C19': 'var(--k-warning)', // Br
  '#CCCC00': 'var(--k-warning)', // S
  '#FF8000': 'var(--k-warning)', // P
  '#7F007F': 'var(--k-link)', // I
}

function clean(svg: string): string {
  return svg.replace(/<\?xml[^>]*\?>\s*/, '').replace(/<!--[\s\S]*?-->\s*/g, '').trim()
}

/** The SVG for the screen: themed colours, no fixed background. */
export function themeSvg(raw: string): string {
  let svg = clean(raw)
  // attributes fill='#RRGGBB' → style (var() is only safe in CSS)
  svg = svg.replace(/ fill='(#[0-9A-Fa-f]{6})'/g, (_m, c: string) => {
    const up = c.toUpperCase()
    return ` style='fill:${up === '#000000' ? 'currentColor' : (ELEMENT_COLOURS[up] ?? c)}'`
  })
  svg = svg.replace(/(stroke|fill):(#[0-9A-Fa-f]{6})/g, (_m, prop: string, c: string) => {
    const up = c.toUpperCase()
    return `${prop}:${up === '#000000' ? 'currentColor' : (ELEMENT_COLOURS[up] ?? c)}`
  })
  // drop a white background rectangle if there is one
  svg = svg.replace(/<rect [^>]*fill:#FFFFFF[^>]*>\s*<\/rect>\s*/i, '')
  return svg
}

/** Width and height from the viewBox. */
export function svgSize(svg: string): { w: number; h: number } {
  const m = /viewBox='0 0 ([\d.]+) ([\d.]+)'/.exec(svg)
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 200, h: 150 }
}

/** The plain picture for files: RDKit's colours on a white background. */
export function staticSvg(raw: string): string {
  const svg = clean(raw)
  const { w, h } = svgSize(svg)
  return svg.replace(/(<svg[^>]*>)/, `$1<rect width='${w}' height='${h}' style='fill:#FFFFFF;stroke:none'/>`)
}

/** An SVG as an image URL for <img> or Markdown. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}

/** Makes an SVG scale with its container (removes the fixed pixel size, keeps the viewBox). */
export function responsiveSvg(svg: string): string {
  return svg.replace(/(<svg[^>]*?) width='[\d.]+px' height='[\d.]+px'/, `$1`)
}
