// What the ribbon and the menus ask the KherveWord window to do.

import type { TemplateId } from '../templates'

export type DialogKind =
  | 'pageSetup' | 'paragraph' | 'headerFooter' | 'symbol' | 'equation' | 'link' | 'footnote' | 'wordCount' | 'templates' | 'image' | 'style'

export interface WordActions {
  newDoc(): void
  newFromTemplate(id?: TemplateId): void
  open(): void
  save(): Promise<boolean>
  saveAs(): Promise<boolean>
  exportPdf(): void
  exportPdfToDrive(): void
  print(): void
  dialog(kind: DialogKind, data?: Record<string, unknown>): void
  insertPicture(): void
  insertTable(rows: number, cols: number): void
  insertTOC(): void
  insertFootnote(): void
  insertCaption(kind: 'Figure' | 'Table' | 'Equation'): void
  insertDate(): void
  newComment(): void
  deleteComment(id?: string): void
  gotoComment(dir: 1 | -1): void
  gotoChange(dir: 1 | -1): void
  review(accept: boolean, which: 'selection' | 'all'): void
  toggleTrack(): void
  setAuthor(): void
  find(replace: boolean): void
  painter(sticky: boolean): void
  painterOn: boolean
  copy(cut: boolean): void
  paste(): void
  setZoom(z: number | 'width' | 'page'): void
  zoom: number
  view: 'print' | 'web'
  setView(v: 'print' | 'web'): void
  ruler: boolean
  toggleRuler(): void
  nav: boolean
  toggleNav(): void
  comments: boolean
  toggleComments(): void
  marks: boolean
  toggleMarks(): void
  spell: boolean
  toggleSpell(): void
  track: boolean
  author: string
  modifyStyle(id: string): void
  newStyle(): void
  updateStyleFromSelection(id: string): void
  setMargins(preset: string): void
  setOrientation(o: 'portrait' | 'landscape'): void
  setSize(size: string): void
}
