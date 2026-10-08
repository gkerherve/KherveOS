// The desktop's icons (icons.py): monochrome Material Design Icons — qtawesome
// "mdi6.*" there, npm @mdi/js here (the same icon set) — under the desktop's
// semantic names, and the KhervePDF app mark (appmark.py: the "Kpdf" wordmark
// over a page with a magnifier, on the red tile).

import type { ReactNode } from 'react'
import {
  mdiAccountSchoolOutline, mdiArrowExpandHorizontal, mdiArrowTopRight, mdiBookSearchOutline, mdiBookshelf, mdiChevronDoubleLeft,
  mdiChevronDoubleRight, mdiClose, mdiCloudUploadOutline, mdiCogOutline, mdiContentCopy, mdiContentCut, mdiContentPaste, mdiContentSaveEditOutline,
  mdiContentSaveOutline, mdiCursorDefaultOutline, mdiCursorMove, mdiCursorText, mdiDeleteOutline, mdiDownload, mdiDrawPen, mdiEllipseOutline,
  mdiEmailOutline, mdiEraser, mdiFileDocumentOutline, mdiFileImageOutline, mdiFilePdfBox, mdiFilePlus, mdiFilePlusOutline, mdiFitToPageOutline,
  mdiFolderOpenOutline, mdiFormatAlignCenter, mdiFormatAlignJustify, mdiFormatAlignLeft, mdiFormatAlignRight, mdiFormatBold, mdiFormatItalic,
  mdiFormatStrikethroughVariant, mdiFormatSubscript, mdiFormatSuperscript, mdiFormatText, mdiFormatUnderline, mdiFullscreen, mdiFullscreenExit,
  mdiGithub, mdiHandBackRightOutline, mdiHelpCircleOutline, mdiHistory, mdiIdentifier, mdiImageOutline, mdiInformationOutline, mdiLinkedin,
  mdiLinkVariant, mdiMagnify, mdiMagnifyMinusOutline, mdiMagnifyPlusOutline, mdiMarker, mdiMenuDown, mdiMonitorScreenshot, mdiNoteOutline,
  mdiPageLayoutSidebarLeft, mdiPause, mdiPlay, mdiPlayBoxOutline, mdiPresentationPlay, mdiPrinterOutline, mdiRectangleOutline, mdiRedo,
  mdiRefresh, mdiRepeat, mdiRobotOutline, mdiRotateLeft, mdiRotateRight, mdiScissorsCutting, mdiSend, mdiSetMerge, mdiSignatureFreehand,
  mdiSkipNext, mdiSkipPrevious, mdiSort, mdiSourceBranch, mdiSourceCommit, mdiTextBoxEditOutline, mdiTextRecognition, mdiTimerPlayOutline,
  mdiUndo, mdiUpdate, mdiVectorLine, mdiViewGridOutline, mdiEyeOffOutline,
} from '@mdi/js'

/** icons._GLYPHS: semantic name → glyph. */
export const GLYPHS = {
  new: mdiFilePlusOutline,
  open: mdiFolderOpenOutline,
  save: mdiContentSaveOutline,
  save_as: mdiContentSaveEditOutline,
  print: mdiPrinterOutline,
  export_png: mdiFileImageOutline,
  export_txt: mdiFileDocumentOutline,
  close: mdiClose,
  undo: mdiUndo,
  redo: mdiRedo,
  cut: mdiContentCut,
  copy: mdiContentCopy,
  paste: mdiContentPaste,
  find: mdiMagnify,
  zoom_in: mdiMagnifyPlusOutline,
  zoom_out: mdiMagnifyMinusOutline,
  fit_width: mdiArrowExpandHorizontal,
  fit_page: mdiFitToPageOutline,
  rotate_l: mdiRotateLeft,
  rotate_r: mdiRotateRight,
  thumbs: mdiViewGridOutline,
  hide_panel: mdiChevronDoubleLeft,
  hide_panel_r: mdiChevronDoubleRight,
  ai: mdiRobotOutline,
  refresh: mdiRefresh,
  send: mdiSend,
  settings: mdiCogOutline,
  help: mdiHelpCircleOutline,
  close_x: mdiClose,
  select: mdiCursorDefaultOutline,
  select_text: mdiCursorText,
  hand: mdiHandBackRightOutline,
  image: mdiImageOutline,
  edit_text: mdiTextBoxEditOutline,
  move_text: mdiCursorMove,
  pen: mdiDrawPen,
  highlight: mdiMarker,
  strikeout: mdiFormatStrikethroughVariant,
  snapshot: mdiMonitorScreenshot,
  ocr: mdiTextRecognition,
  text: mdiFormatText,
  line: mdiVectorLine,
  arrow: mdiArrowTopRight,
  rect: mdiRectangleOutline,
  ellipse: mdiEllipseOutline,
  note: mdiNoteOutline,
  signature: mdiSignatureFreehand,
  erase: mdiEraser,
  // Not a desktop toolbar tool (Tools ▸ Redact is a menu item there).
  redact: mdiEyeOffOutline,
  page_insert: mdiFilePlus,
  page_delete: mdiDeleteOutline,
  page_merge: mdiSetMerge,
  page_split: mdiScissorsCutting,
  reorder: mdiSort,
  commit: mdiSourceCommit,
  history: mdiHistory,
  remote: mdiCloudUploadOutline,
  branch: mdiSourceBranch,
  bold: mdiFormatBold,
  italic: mdiFormatItalic,
  underline: mdiFormatUnderline,
  superscript: mdiFormatSuperscript,
  subscript: mdiFormatSubscript,
  align_left: mdiFormatAlignLeft,
  align_center: mdiFormatAlignCenter,
  align_right: mdiFormatAlignRight,
  align_justify: mdiFormatAlignJustify,
  about: mdiInformationOutline,
  author: mdiAccountSchoolOutline,
  update: mdiUpdate,
  download: mdiDownload,
  recent_doc: mdiFilePdfBox,
  kherveref: mdiBookshelf,
  kherveref_show: mdiBookSearchOutline,
  normal_view: mdiPageLayoutSidebarLeft,
  slideshow_window: mdiPlayBoxOutline,
  slideshow_full: mdiPresentationPlay,
  autoplay: mdiTimerPlayOutline,
  play: mdiPlay,
  pause: mdiPause,
  prev_page: mdiSkipPrevious,
  next_page: mdiSkipNext,
  loop: mdiRepeat,
  fullscreen: mdiFullscreen,
  exit_full: mdiFullscreenExit,
  link: mdiLinkVariant,
  github: mdiGithub,
  linkedin: mdiLinkedin,
  email: mdiEmailOutline,
  orcid: mdiIdentifier,
  paper: mdiFileDocumentOutline,
  menu_down: mdiMenuDown,
} as const

export type Glyph = keyof typeof GLYPHS

export function Icon({ name, size = 20, className, title }: { name: Glyph; size?: number; className?: string; title?: string }) {
  return (
    <svg className={`kp-mdi${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path d={GLYPHS[name]} fill="currentColor" />
    </svg>
  )
}

/** A menu item's icon (MenuItem.image). */
export const mi = (name: Glyph): ReactNode => <Icon name={name} size={15} />

/** appmark.paint: the red tile, the "Kpdf" wordmark and the page-with-magnifier. */
export function AppMark({ size = 88 }: { size?: number }) {
  // Everything in a 100-unit box, as appmark.py works in fractions of the tile.
  const m = 6
  const w = 100 - 2 * m
  const bw = w * 0.46
  const bh = w * 0.38
  const bx = m + (w - bw) / 2
  const by = m + w * 0.54
  const P = (x: number, y: number) => `${(bx + x * bw).toFixed(2)},${(by + y * bh).toFixed(2)}`
  const page = [
    `M${P(0.1, 0.05)} L${P(0.6, 0.05)} L${P(0.78, 0.23)} L${P(0.78, 0.9)} L${P(0.1, 0.9)} Z`,
    `M${P(0.6, 0.05)} L${P(0.6, 0.23)} L${P(0.78, 0.23)}`,
    `M${P(0.2, 0.38)} L${P(0.58, 0.38)}`,
    `M${P(0.2, 0.5)} L${P(0.66, 0.5)}`,
    `M${P(0.2, 0.62)} L${P(0.48, 0.62)}`,
  ].join(' ')
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="kp-appmark">
      <rect x={m} y={m} width={w} height={w} rx={22} fill="#c62828" stroke="#a81f1f" strokeWidth={2} />
      <text x={50} y={m + w * 0.05 + w * 0.22} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontWeight={700} fontSize={30} fontFamily="'Segoe UI', system-ui, sans-serif">
        Kpdf
      </text>
      <path d={page} fill="none" stroke="#ffffff" strokeWidth={bh * 0.045} strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx={bx + 0.69 * bw} cy={by + 0.69 * bh} rx={0.17 * bw} ry={0.17 * bh} fill="none" stroke="#ffffff" strokeWidth={bh * 0.05} />
      <path d={`M${P(0.83, 0.83)} L${P(1, 1)}`} stroke="#ffffff" strokeWidth={bh * 0.05} strokeLinecap="round" />
    </svg>
  )
}
