// Paper sizes (khervedoc/page_sizes.py): the page card on screen has the
// paper's proportions, and the same code picks the geometry package option.

export interface PageSize {
  code: string
  /** \\usepackage[<this>]{geometry} */
  geometryOption: string
  widthIn: number
  heightIn: number
}

export const PAGE_SIZES: PageSize[] = [
  { code: 'A4', geometryOption: 'a4paper', widthIn: 8.27, heightIn: 11.69 },
  { code: 'Letter', geometryOption: 'letterpaper', widthIn: 8.5, heightIn: 11.0 },
  { code: 'Legal', geometryOption: 'legalpaper', widthIn: 8.5, heightIn: 14.0 },
]

export function pageSizeByCode(code: string): PageSize {
  return PAGE_SIZES.find((p) => p.code.toLowerCase() === (code ?? '').toLowerCase()) ?? PAGE_SIZES[0]
}
