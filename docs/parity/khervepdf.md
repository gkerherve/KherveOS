# KhervePDF — parity with the desktop app

Reference: `../KhervePDF` branch `dev` (v0.75, e8fff0c): `mainwindow.py`, `pdftab.py`, `thumbnails.py`,
`outline.py`, `find_bar.py`, `welcome.py`, `slideshow.py`, `icons.py`, `appmark.py`, `about_author.py`,
`history_dialog.py`, `remote_dialog.py`, `git_backend.py`, `themes.py`; screenshots in
`../khervefitting-web/public/screenshots/tools/khervepdf/` (v0.63, before the monochrome icons).
Web edition: `src/apps/khervepdf/`; text editing in the PDF service (`src/os/services/pdf.engine.ts`
`rewriteText`). Pass of 2026-10-08.

✔ same as the desktop · ~ partly / differently · ✘ missing · + web extra

## Look

| | Item | Notes |
|---|---|---|
| ✔ | Icons | the desktop's Material Design Icons (qtawesome `mdi6.*` = npm `@mdi/js`), monochrome in the theme colour, same names as `icons._GLYPHS` (`icons.tsx`) — was lucide |
| ✔ | App mark | `appmark.paint` redrawn in SVG: red tile, "Kpdf", page + magnifier (welcome page) |
| ✔ | Layout | toolbar on top; "Document" dock on the left; tabs above the page view; status bar |
| ✔ | Page view | pages stacked with a 12 px gap on the desktop's grey (`Qt.gray`) desk, fit-width on open |
| ✔ | Zoom scale | 100 % = the desktop's 144 dpi base (2 px per point), so the same percentages give the same size (was 96 dpi) |
| ✔ | Tabs | `themes.tab_stylesheet`: inactive muted, selected bold with an accent frame, accent line under the bar, × on each tab; no file icon (removed) |
| ✔ | Window title | `KhervePDF v0.75 — file.pdf` (`_update_title`) |
| ~ | Themes | View ▸ Theme ▸ Kherve Green (dark) / Light; the desktop's 13 KherveTeX themes are not offered (one KherveOS theme) |
| ✔ | Marks | selection, marquee, ghost boxes in the desktop's #1976d2; eraser trail #c62828 4 px; find match #fff176 / #b58900 |

## Menus

| | Menu | Items |
|---|---|---|
| ✔ | File | New (⌘N), Open… (⌘O), Open Recent ▸ (names, Clear list / (empty)), Save (⌘S), Save As… (⇧⌘S), Export pages as PNG / JPEG…, Export Text…, Compress / shrink…, Encrypt / password protect…, Digitally sign (PKCS#12)…, Print… (⌘P), Print Preview… (⇧⌘P), Close Tab (⌘W), Exit (⌘Q) — with the desktop's icons |
| ~ | File ▸ Digitally sign | the desktop's dialog (Certificate + Browse…, Password, Reason, Location, Contact); then "not in the web edition yet" (pyHanko has no browser version) |
| ~ | File ▸ Print / Print Preview | browser print dialog; the preview is an in-window page list with Print… (Qt's preview window has zoom / two-page modes) |
| + | File | Document Properties…, Download to Computer |
| ✔ | Edit | Undo (⌘Z), Redo (⌘Y), Copy Selected Text (⌘C), Select All Text on Page (⌘A), Edit Selected Text…, Copy Selection as Image, Find… (⌘F) |
| ✔ | View | Zoom In (⌘+ / ⌘=), Zoom Out (⌘−), Fit Width (⌘0), Fit Page, Rotate Left / Right, Show Page Thumbnails (checkable), Show AI Assistant, Slideshow ▸ (Normal View, Slideshow in Window ⇧F5, Slideshow Full Screen F5, Continuous, Loop), Theme ▸ |
| ~ | View ▸ Fit Page / Rotate Left / Right | no-ops on the desktop (`_noop`); here Fit Page fits the page and Rotate turns the current page |
| ~ | View ▸ Show AI Assistant | opens KherveAI (KherveOS's assistant; the desktop docks its own chat panel) |
| ✔ | Tools | Select, Select Text, Pen, Highlight, Text, Line, Arrow, Rectangle, Ellipse, Sticky Note, Signature, Redact (no-ops on the desktop; here they pick the tool), Recognize Text (OCR)…, Add to KherveRef, Show in KherveRef, Locate KherveRef… |
| ✘ | Tools ▸ Recognize Text (OCR)… | message, as the desktop without Tesseract ("OCR support is not available in this build") |
| ~ | Tools ▸ KherveRef | Add sends the PDF to KherveOS's KherveRef (asks to save unsaved annotations first, Yes / No / Cancel); Show opens KherveRef without selecting the entry; Locate explains it is built in |
| + | Tools | Apply Redactions… |
| ✔ | Pages | Insert Blank Page, Delete Current Page ("Cannot delete the last page.", "Delete page N of M?"), Rotate Page Left / Right, Merge PDF(s)…, Split into one PDF per page…, Extract pages… ("1, 3-5, 9"), Watermark every page… (Text, Size 20–200 pt, grey diagonal), Number every page… ("N / total" bottom centre) |
| ~ | Pages ▸ Merge PDF(s)… | one file per pick (the desktop's dialog takes several) |
| ✔ | Git | Commit Now (makes a repository on `dev` in the PDF's folder if there is none), History… (SHA / Date / Author / Subject, Restore to selected, double-click restores, confirm, "File reverted. Close and reopen the tab to view."), Remote / Push… (Origin URL, Save URL, Save & Push) — isomorphic-git through KherveOS's Git service; push to GitHub uses the token from Settings |
| ~ | Save → commit | the desktop commits every save (creating a repository in the folder); here a save is committed only when the folder already is a repository ("Saved … · committed to git") — no surprise .git folders in Documents |
| ✔ | Help | Check for Updates… (always up to date: KherveOS updates the app), Check for Updates Automatically (checkable), About KhervePDF (version, author, libraries), Meet the Author… (badge, 6 links, About, The Kherve tools, Publication, Cite, Licence, Copy citation) |

## Toolbar

| | Button | Notes |
|---|---|---|
| ✔ | Open, Save, Undo, Redo, Insert image (Ctrl+V to paste) | desktop tooltips |
| ✔ | Pages panel toggle (checked when shown), AI panel toggle | AI → KherveAI |
| ✔ | 18 tools in the desktop order: Hand, Select, Select Text, Snapshot, Pen, Highlight, Underline, Strikethrough, Text, Edit Text, Move Text, Line, Arrow, Rectangle, Ellipse, Sticky Note, Signature, Eraser | exclusive, checked = current; desktop tooltips; Redact moved off the bar (Tools menu only, as on the desktop) |
| ✔ | Dropdown arrow beside Pen, Highlight, Underline, Strikethrough, Text, Edit Text, Line, Arrow, Rectangle, Ellipse | the arrow first activates that tool, then opens the options popup (was one shared colour button) |
| ✔ | Options popup | 10×4 colour grid (current colour framed, click applies and closes), Custom colour…, Width 1–30 pt, Opacity 10–100 %, Fill shape + fill-colour swatch, Size 4–96 pt; every row shown, greyed when it doesn't apply |
| ✔ | Zoom Out, Zoom In, Fit Width, magnifier, editable zoom combo (Fit Width, 50 … 400 %; type "137" / "137%" + Enter) | (was a menu button) |
| ✘ | Find and Slideshow buttons | removed from the toolbar (not on the desktop's) |

## Side panel ("Document" dock)

| | Item | Notes |
|---|---|---|
| ✔ | Dock title "Document" with close | double-click / right-click to dock on the other side (the desktop drags it; floating not supported) |
| ✔ | Tabs "Pages (drag to reorder)" and "Contents", chevron in the corner hides the panel | |
| ✔ | Thumbnails 140 px with the page number to the right; click jumps; drag up / down reorders (annotations follow) | |
| + | Thumbnail right-click: insert / delete / rotate / move page | |
| ✔ | Contents: the PDF outline, first two levels open; headings detected by font size when there is none; "(no table of contents)" | |
| + | Contents right-click: rename / delete bookmark, keep detected headings, add a bookmark | |
| ✔ | Hidden on the welcome page, toggle disabled there; remembered | |

## Status bar

| | Item | Notes |
|---|---|---|
| ✔ | "Page N of M" left; messages replace it for a few seconds (showMessage) | + click: Go to page |
| ✔ | Busy bar while opening / working, tool name ("Select text"), zoom "100%", "⎇ branch" when the PDF is in a Git repository | |
| ✔ | View switcher: Normal / Slideshow in window / Slideshow full screen, Continuous toggle, seconds box "5 s" (1–600) | |

## Welcome page

| | Item | Notes |
|---|---|---|
| ✔ | Wallpaper (wash, two glows, flowing curves, dot grid), translucent card | |
| ✔ | App mark 88 px, "KhervePDF", "View, annotate and edit PDFs — with Git history · v0.75" | |
| ✔ | Big "Open PDF…" (accent) and "New" buttons, "RECENT FILES" (8, PDF icon, name + folder, missing files greyed) | |
| ✔ | "Tip: drop a PDF anywhere on this window to open it." | |
| ✘ | Update banner | KherveOS updates the app |

## Keyboard

| | Key | Notes |
|---|---|---|
| ✔ | ⌘N ⌘O ⌘S ⇧⌘S ⌘P ⇧⌘P ⌘W ⌘Q | ⌘N / ⌘W / ⌘Q may be kept by the browser outside the installed app |
| ✔ | ⌘Z / ⌘Y (and ⇧⌘Z) | |
| ✔ | ⌘+ / ⌘= / ⌘− / ⌘0 | steps of ×1.25, Fit Width |
| ✔ | ⌘C copies the text selection; ⌘A selects the page's text | |
| ✔ | ⌘V: a picture is placed centred on the current page (≤ 60 %); text becomes a text box at the last click | |
| ✔ | Delete / Backspace: selected annotations, else the selected text (Delete Selected Text) | the text case was missing |
| ✔ | Esc: clears the text selection, then the annotation selection, then closes Find | |
| ✔ | F5 / ⇧F5 slideshow; in the show ← → Space Enter PgUp PgDn Home End, P (play), F (full screen), Esc | |
| ✔ | ⌘F, Enter = next match, ⇧Enter = previous, Esc closes | |

## Mouse

| | Gesture | Notes |
|---|---|---|
| ✔ | Hand: drag pans; press on text selects it; click a link follows it | |
| ✔ | Select: click an annotation, Ctrl/⌘/Shift-click toggles, drag a selected one moves the group, drag on blank draws a marquee, press on text selects text | |
| ✔ | Click a sticky-note marker (Hand, Select, Note) opens the yellow Post-it editor | now also in Select |
| ✔ | Note tool on blank: "New sticky note" dialog (Note text, OK / Cancel); note in #fff59d | was an inline editor |
| ✔ | Text tool: type on the page with the floating format bar (font, size) | ~ B / I / U, super / sub, alignment, rotation are shown greyed: PDF text boxes keep one font and size |
| ✔ | Edit Text tool: click a paragraph → dashed box + "Edit text" dialog (Font, Size, Bold, Italic, alignment ×4, Preserve PDF line breaks) → the paragraph is rewritten in the page | new; underline / super / sub / rotation greyed |
| ✔ | Move Text tool: drag a paragraph; a dashed box follows; release moves it (stray clicks ignored) | new |
| ✔ | Select Text, double-click selects a word, drag past the edge scrolls | |
| ✔ | Highlight / underline / strike-out swipes snap to words; Pen, Line, Arrow, Rectangle, Ellipse (fill), Snapshot (copies the area as a picture), Signature (box → "Draw your signature" → Stamp on page, ink #1a1a1a), Eraser (red trail, one undo step) | |
| ✔ | Ctrl/⌘ + wheel zooms one ×1.25 step (trackpads: one step per notch's worth) | was continuous |
| ✔ | Right-click with a text selection: Copy, Copy as Image, Edit Selected Text…, Delete Selected Text, Highlight, Underline, Strike Out; then Paste Text Here, Add Text Here, Select All Text on Page | Copy as Image / Edit / Delete were missing |
| + | Right-click on an annotation: Edit Text Box, Open Note, Colour ▸, Delete | |
| ✔ | Edit Selected Text: an editor over the words (white, blue frame), Enter commits, Shift+Enter new line, Esc cancels, click elsewhere commits | new |
| ✔ | Tabs: drag to reorder; drag out of the tab bar or right-click "Open in new window" opens the PDF in a new KhervePDF window | new |
| ✔ | Drop PDFs anywhere on the window → one tab each | |

## Not in the web edition yet

- OCR (Tesseract), PKCS#12 digital signatures (pyHanko), the docked AI chat (KherveAI instead).
- Rich text inside text boxes (per-character bold / italic / underline / super / subscript, rotation).
- The 13 desktop themes; floating the dock.
