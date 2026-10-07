// Help ▸ KhervePaint Guide: the essentials of the desktop's user guide and
// the keyboard shortcuts.

const SECTIONS: [string, string[]][] = [
  ['The canvas', [
    'A drawing has two layers. The raster layer is a bitmap at the bottom: open a PNG or JPEG into it, paint with the brush, rub out with the eraser, fill with the bucket. Vector items sit on top and stay editable: lines, arrows, shapes, freehand pencil strokes, text and pictures.',
    'The white page is what gets exported. With Infinite paper on, the paper fills the view and the page is outlined.',
  ]],
  ['Selecting and editing', [
    'Pointer (V): click an item, or drag a box around several. Shift or ⌘-click adds or removes an item. An unfilled shape is picked by its outline.',
    'Drag to move (it snaps to the grid when snapping is on). Handles resize: line ends, polygon corners, box corners and sides. The round handle in the middle of a line bends it. The green knob above an item turns it (in 15° steps while snapping).',
    'Double-click a text to edit it, or a shape to give it a label. In a placed symbol, double-click its caption.',
    'The Properties panel edits everything about the selection: stroke, dash, fill and gradients, arrowheads, geometry, text and fonts, dimension style.',
  ]],
  ['Arrange', [
    'Group (⌘G) and Ungroup (⇧⌘G); Explode (⇧⌘E) breaks a shape into its edges; Flip (⇧⌘H, ⇧⌘J); stacking order with ⌘] and ⌘[ (add ⇧ for front and back); Align and distribute from the toolbar or the Arrange menu.',
  ]],
  ['Libraries', [
    'The Library panel and menu hold the desktop’s symbol palettes: flowchart, electrical, optics, vacuum, lab glassware, room layout, network, P&ID, arrows and callouts, biology, maths and 3D scheme blocks. Click a symbol then click on the drawing, or drag it there. Symbols are sized against the page, as on the desktop.',
    'Save selection as object… keeps the selection as an SVG in ~/Documents/KhervePaint Library (type Folder/Name for sub-folders) to insert again later.',
  ]],
  ['Files', [
    'Save writes editable SVG, the desktop’s default format; .kpaint (the desktop’s JSON) is offered too. Both open in the desktop KhervePaint and back here.',
    'Export writes a flattened PNG (with its dpi) or a PDF the figure’s real size. Drawing Size sets the page in px, inches or mm with journal column presets, or fits the page to the drawing.',
  ]],
]

const KEYS: [string, string][] = [
  ['V  H  P  Y  X  K  B', 'Pointer, hand, pencil, brush, eraser, colour picker, bucket'],
  ['L  A  M  T', 'Line, arrow, dimension, text'],
  ['R  C  E', 'Rectangle, circle, ellipse'],
  ['Space + drag, wheel', 'Move the view'],
  ['⌘ + wheel, ⌘+  ⌘−', 'Zoom; ⌘0 fits the page, ⌘1 actual size'],
  ['⌘Z  ⇧⌘Z', 'Undo, redo'],
  ['⌘C  ⌘X  ⌘V  ⌘D', 'Copy, cut, paste, duplicate'],
  ['⌘A  ⌫  arrows', 'Select all, delete, nudge (⇧: ×10)'],
  ['⌘G  ⇧⌘G  ⇧⌘E', 'Group, ungroup, explode'],
  ["⌘'  ⇧⌘'", 'Grid, snap'],
  ['⌘S  ⇧⌘S  ⌘O  ⌘E', 'Save, save as, open, export PNG'],
  ['Esc', 'Back to the pointer, or deselect'],
]

export function HelpDialog({ onClose }: { onClose(): void }) {
  return (
    <div className="kp-modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="kp-dialog kp-help" role="dialog" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose() }} tabIndex={-1}>
        <div className="kp-dialog-title">KhervePaint guide</div>
        <div className="kp-help-body">
          {SECTIONS.map(([title, paras]) => (
            <section key={title}>
              <h4>{title}</h4>
              {paras.map((p, i) => <p key={i}>{p}</p>)}
            </section>
          ))}
          <section>
            <h4>Keyboard</h4>
            <table className="kp-keys">
              <tbody>
                {KEYS.map(([k, v]) => (
                  <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <div className="kp-dialog-buttons">
          <button className="k-btn primary" autoFocus onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
