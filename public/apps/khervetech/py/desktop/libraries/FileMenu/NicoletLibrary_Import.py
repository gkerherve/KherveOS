# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/NicoletLibrary_Import.py. Regenerate with tools/export_khervetech.py.
# libraries/FileMenu/NicoletLibrary_Import.py
"""
Nicolet / Thermo OMNIC spectral-library importer (.LBD / .LBT / .LBP / .LBG).

These files are the search libraries shipped with Nicolet FT-IR instruments
(Georgia forensic paints, EPA hazardous chemicals, Aldrich solvents, Hummel
polymers, ...). A library is a *set* of files that share a base name:

    <name>.LBD   the spectral DATA (one record per reference spectrum)
    <name>.LBT   the text index  (compound name, CAS #, catalog #, pointers)
    <name>.LBP   a small peak / pointer table
    <name>.LBG   a group file

Only the .LBD holds the actual curves, so whichever member the user picks we
resolve to the sibling .LBD and read every spectrum from there; the sibling
.LBT (if present) supplies the compound names.

Binary layout (reverse-engineered - there is no public spec)
------------------------------------------------------------
Byte 0..blk is an ASCII header block (blk is line 0, always 1024), terminated
by a 0x1A (Ctrl-Z) marker. The header lines used here are, by index:

    [3]  library title
    [6],[7]   number-of-spectra and record-stride, in *either* order
    [14] points per spectrum (npoints)
    [15] first wavenumber   [16] last wavenumber   (cm-1, ascending)

Spectra records start at byte `blk`, one every `stride` bytes. The ordinate
encoding evolved across instrument generations; we pick it deterministically
from the record geometry (ratio = stride / npoints):

    ratio < 1.5                     -> 8-bit  unsigned            (u8)
    ratio ~ 4 and floats look real  -> 32-bit IEEE float, LE      (f32LE)   modern hi-res
    trailer = stride-2*npoints <=64 -> 16-bit unsigned, LE        (u16LE)   modern contiguous
    otherwise                       -> 16-bit unsigned byte-planar, big-endian
                                       [npoints hi bytes][npoints lo bytes]  (planBE)  old Nicolet

The integer ordinates are per-spectrum full-scale absorbances; we rescale them
to a nominal 0..1 absorbance. Float ordinates are already physical absorbance.

The .LBT text fields are either length-prefixed ([len byte][bytes]) or fixed
width behind a 0xFF marker; the older Nicolet libraries obfuscate them with a
per-library XOR key (0x4C, 0xC3, ...) which we auto-detect, the 2000s Thermo
libraries store them in clear. We only need the compound-name column of each
record; if nothing lines up with the spectra we fall back to generic names.
"""

import os
import re

import numpy as np
import openpyxl
import wx

from libraries.FileMenu.FTIR_Import import (_next_ftir_sheet_name,
                                            _write_ftir_sheet,
                                            Y_UNIT_ABSORBANCE)

_XOR_KEY = 0x4C           # a common old-Nicolet .LBT text-obfuscation key
_CAS_RE = re.compile(r'^\d{1,7}-\d{2}-\d$')


# ---------------------------------------------------------------------------
# Header + spectra
# ---------------------------------------------------------------------------

def _resolve_lbd(path):
    """Given any library member, return the path of the sibling .LBD data file.

    Extensions are matched case-insensitively (instruments write LBD or lbd)."""
    root, ext = os.path.splitext(path)
    if ext.lower() == '.lbd':
        return path
    for cand_ext in ('.LBD', '.lbd', '.Lbd'):
        cand = root + cand_ext
        if os.path.exists(cand):
            return cand
    # Last resort: case-insensitive directory scan
    base = os.path.basename(root).lower()
    folder = os.path.dirname(path) or '.'
    for fn in os.listdir(folder):
        stem, e = os.path.splitext(fn)
        if e.lower() == '.lbd' and stem.lower() == base:
            return os.path.join(folder, fn)
    return None


def _parse_header_fields(raw, total_size):
    """Parse the ASCII header block into geometry fields (no codec detection).

    ``total_size`` is the full .LBD size in bytes; it may differ from
    ``len(raw)`` when only the header chunk was read (the fast folder scan).
    Returns a dict without a ``codec`` key, or raises ValueError."""
    end = raw.find(b'\x1a')
    end = end if 0 < end < 16384 else 1024
    lines = [ln.strip() for ln in raw[:end].decode('latin-1', 'ignore').split('\r\n')]

    def as_int(i):
        return int(float(lines[i]))

    def as_float(i):
        return float(lines[i])

    try:
        blk = as_int(0)
        npoints = as_int(14)
        fx, lx = as_float(15), as_float(16)
        f6, f7 = as_int(6), as_int(7)
    except (IndexError, ValueError):
        raise ValueError("Unrecognised library header")

    if npoints < 8 or not np.isfinite(fx) or not np.isfinite(lx):
        raise ValueError("Implausible library header (npoints/wavenumbers)")

    data_size = total_size - blk
    fields = [f for f in (f6, f7) if f and f > 0]
    if not fields:
        raise ValueError("No record-geometry fields in header")

    # stride must be able to hold at least the spectrum; nspec is the other field.
    wide = [f for f in fields if f >= 2 * npoints]
    if wide:
        stride = min(wide)
    else:
        narrow = [f for f in fields if f >= npoints]
        if not narrow:
            raise ValueError("No field large enough to hold a spectrum")
        stride = min(narrow)
    others = [f for f in fields if f != stride]
    nspec = others[0] if others else data_size // stride
    if nspec < 1 or nspec * stride > data_size:
        nspec = data_size // stride
    if nspec < 1:
        raise ValueError("No spectra found")

    title = lines[3] if len(lines) > 3 else ''
    return dict(blk=blk, title=title.strip(), npoints=npoints, fx=fx, lx=lx,
                stride=stride, nspec=nspec)


def _parse_header(raw):
    """Parse the ASCII header block. Returns a dict or raises ValueError."""
    meta = _parse_header_fields(raw, len(raw))
    meta['codec'] = _detect_codec(raw, meta['blk'], meta['npoints'],
                                  meta['stride'])
    return meta


def _detect_codec(raw, blk, npoints, stride):
    """Decide the ordinate encoding from the record geometry (see module docstring)."""
    ratio = stride / npoints
    trailer = stride - 2 * npoints
    if ratio < 1.5:
        return 'u8'
    if ratio >= 3.5 and stride >= 4 * npoints:
        f = np.frombuffer(raw[blk:blk + 4 * npoints], '<f4').astype(float)
        if f.size == npoints and np.all(np.isfinite(f)) and np.nanmax(np.abs(f)) < 1e4:
            return 'f32LE'
        return 'u16LE' if 0 <= trailer <= 64 else 'planBE'
    if 0 <= trailer <= 64:
        return 'u16LE'
    return 'planBE'


def _decode_record(raw, meta, i):
    """Return the raw ordinate array for spectrum ``i`` (no rescaling)."""
    n = meta['npoints']
    base = meta['blk'] + i * meta['stride']
    rec = raw[base:base + meta['stride']]
    codec = meta['codec']
    if codec == 'u8':
        return np.frombuffer(rec[:n], np.uint8).astype(float)
    if codec == 'u16LE':
        return np.frombuffer(rec[:2 * n], '<u2').astype(float)
    if codec == 'f32LE':
        return np.frombuffer(rec[:4 * n], '<f4').astype(float)
    # planBE: [n high bytes][n low bytes], big-endian 16-bit
    hi = np.frombuffer(rec[:n], np.uint8).astype(float)
    lo = np.frombuffer(rec[n:2 * n], np.uint8).astype(float)
    return hi * 256.0 + lo


def _ordinate(raw, meta, i):
    """Absorbance array for spectrum ``i``, rescaled to a nominal 0..1 for the
    integer codecs (which store per-spectrum full-scale values); float codecs
    are already physical absorbance and are passed through unchanged."""
    y = _decode_record(raw, meta, i)
    if meta['codec'] == 'u8':
        return y / 255.0
    if meta['codec'] in ('u16LE', 'planBE'):
        return y / 65535.0
    return y  # f32LE - real absorbance


# ---------------------------------------------------------------------------
# Compound names (sibling .LBT)
# ---------------------------------------------------------------------------

def _fields_length_prefixed(buf):
    """Walk a text region as consecutive [len byte][ASCII bytes] fields.

    Used by the libraries that store variable-length fields (most .LBT files,
    clear or XOR-0x4C obfuscated)."""
    fields = []
    i, n = 0, len(buf)
    while i < n:
        length = buf[i]
        if 2 <= length <= 90 and i + 1 + length <= n:
            chunk = buf[i + 1:i + 1 + length]
            if all(32 <= c < 127 for c in chunk):
                fields.append(chunk.decode('latin-1'))
                i += 1 + length
                continue
        i += 1
    return fields


def _fields_ff_marked(buf):
    """Read the printable run that follows each 0xFF marker.

    Some 2000s Thermo libraries store the record text as a fixed-width,
    space-padded field introduced by a 0xFF byte (e.g. sea010d, sea274). The
    length-prefixed walker mis-parses those because a leading capital letter
    (0x41-0x5A) looks like a valid length byte and eats the first character."""
    fields = []
    i, n = 0, len(buf)
    while i < n:
        if buf[i] == 0xFF:
            j = i + 1
            while j < n and 32 <= buf[j] < 127:
                j += 1
            run = buf[i + 1:j].decode('latin-1').strip()
            if len(run) >= 3:
                fields.append(run)
            i = j
        else:
            i += 1
    return fields


def _name_quality(s):
    """Score how much a field looks like a compound name (0..~1.3).

    Rewards letters and spaces; penalises low character diversity (padding
    runs like 'llllAF'), very short strings, digit-heavy codes and bare CAS
    numbers - i.e. the CAS / catalog / index fields that sit beside the name.
    """
    s = s.strip()
    if len(s) < 5 or _CAS_RE.match(s):
        return 0.0
    alpha = sum(c.isalpha() for c in s)
    digit = sum(c.isdigit() for c in s)
    vowels = sum(c in 'aeiouAEIOU' for c in s)
    letters = [c for c in s if c.isalpha()]
    # Random-case codes (e.g. "gDGkDeRB") flip case on nearly every letter;
    # real names ("Piperylene", "PICHLOROHYDRIN") do not.
    case_flips = sum(1 for a, b in zip(letters, letters[1:])
                     if a.isupper() != b.isupper())
    score = alpha / len(s) + (0.3 if ' ' in s else 0.0)
    if len(set(s)) / len(s) < 0.35:          # repetitive padding/garbage
        score *= 0.15
    if digit / len(s) > 0.4:                  # catalog / index code
        score *= 0.3
    if alpha < 3 or vowels == 0:              # needs some letters and a vowel
        score *= 0.3
    if letters and case_flips / len(letters) > 0.35:   # random-case gibberish
        score *= 0.2
    return score


def _load_names(lbd_path, nspec):
    """Best-effort compound names from the sibling .LBT, in spectrum order.

    A .LBT record is a run of length-prefixed fields (compound name, CAS #,
    catalog #, ...); older Nicolet libraries XOR the text with 0x4C, the 2000s
    Thermo ones store it in clear. We flatten every field, group them into
    ``nspec`` records and keep the column that looks most like compound names.
    Returns a list of length ``nspec``; entries we cannot recover are '' and
    the caller substitutes a generic label. If the whole extraction looks like
    garbage (unknown obfuscation) every entry is ''.
    """
    root = os.path.splitext(lbd_path)[0]
    lbt = None
    for e in ('.LBT', '.lbt', '.Lbt'):
        if os.path.exists(root + e):
            lbt = root + e
            break
    if not lbt:
        return [''] * nspec

    try:
        raw = open(lbt, 'rb').read()
    except OSError:
        return [''] * nspec
    end = raw.find(b'\x1a')
    body = raw[end + 1:] if end > 0 else raw[1024:]

    def best_column(fields):
        """Group length-prefixed fields into nspec records and return the
        (score, names) of the phase that looks most like a name column."""
        # Drop blank / letterless padding and code fields so the records line
        # up on a clean period (some libraries pad every record with several
        # empty fixed-width fields).
        fields = [f.strip() for f in fields if any(c.isalpha() for c in f)]
        # Skip leading padding / header junk so record 0 starts at the first
        # real name - otherwise every name is shifted onto the next spectrum.
        first = next((j for j, f in enumerate(fields) if _name_quality(f) >= 0.5),
                     0)
        fields = fields[first:]
        if len(fields) < 0.7 * nspec:
            return 0.0, None
        k = min(max(1, round(len(fields) / nspec)), 8)
        best_s, best_c = 0.0, None
        for start in range(k):
            col = fields[start::k][:nspec]
            if len(col) < 0.7 * nspec:
                continue
            s = sum(_name_quality(x) for x in col) / len(col)
            if s > best_s:
                best_s, best_c = s, col
        return best_s, best_c

    # Libraries differ in how the .LBT stores text (length-prefixed vs fixed
    # width behind a 0xFF marker) and older ones XOR the bytes with a per-library
    # key (0x4C, 0xC3, ...). Auto-derive candidate keys by assuming the most
    # common byte in the record region is a space (0x20), then try every reading
    # and keep whichever produces the best-scoring name column.
    from collections import Counter
    common = [b for b, _ in Counter(b for b in body if b).most_common(4)]
    # 0x00 = clear text; 0x4C/0xC3 = keys seen in the wild; the rest are derived
    # by assuming the commonest byte is a padded space (works when records are
    # space-padded, which is where the fixed known keys do not already apply).
    keys = list(dict.fromkeys([0x00, _XOR_KEY, 0xC3] + [b ^ 0x20 for b in common]))

    best_score, best_names = 0.0, None
    for key in keys:
        buf = body if key == 0 else bytes(b ^ key for b in body)
        for fields in (_fields_length_prefixed(buf), _fields_ff_marked(buf)):
            score, names = best_column(fields)
            if score > best_score:
                best_score, best_names = score, names

    if best_names is None or best_score < 0.5:
        return [''] * nspec

    # Blank out low-quality entries (padding/garbage records) rather than
    # showing a bogus label; real names score ~0.9+.
    names = [s.strip() if _name_quality(s) >= 0.35 else '' for s in best_names]
    names += [''] * (nspec - len(names))
    return names[:nspec]


# ---------------------------------------------------------------------------
# Public parse entry point
# ---------------------------------------------------------------------------

def parse_nicolet_library(path):
    """Parse a Nicolet/Thermo library. Returns a dict:

        title    : library title from the header
        npoints  : points per spectrum
        x        : np.array of wavenumbers (cm-1, ascending)
        nspec    : number of reference spectra
        names    : list[str] compound names (may contain '' placeholders)
        get_y    : callable(i) -> absorbance np.array for spectrum i
        lbd_path : the resolved .LBD file
        codec    : ordinate encoding tag (diagnostic)

    Raises ValueError / FileNotFoundError on unusable input.
    """
    lbd = _resolve_lbd(path)
    if not lbd:
        raise FileNotFoundError(
            "No .LBD data file found next to this library. The spectra live in "
            "the sibling .LBD file - keep the whole library set together.")

    raw = open(lbd, 'rb').read()
    meta = _parse_header(raw)
    x = np.linspace(meta['fx'], meta['lx'], meta['npoints'])
    names = _load_names(lbd, meta['nspec'])

    def get_y(i):
        return _ordinate(raw, meta, i)

    return dict(title=meta['title'] or os.path.splitext(os.path.basename(lbd))[0],
                npoints=meta['npoints'], x=x, nspec=meta['nspec'],
                names=names, get_y=get_y, lbd_path=lbd, codec=meta['codec'])


def nicolet_library_info(path):
    """Fast header-only summary of a Nicolet library, without extracting names.

    Reads only the header chunk (not the whole file), so a folder of large
    libraries can be catalogued cheaply. Returns a dict:

        title, nspec, npoints, x0, x1, lbd_path

    Raises ValueError / FileNotFoundError on unusable input.
    """
    lbd = _resolve_lbd(path)
    if not lbd:
        raise FileNotFoundError("No .LBD data file found next to this library.")
    total_size = os.path.getsize(lbd)
    with open(lbd, 'rb') as f:
        head = f.read(16384)
    meta = _parse_header_fields(head, total_size)
    return dict(title=meta['title'] or os.path.splitext(os.path.basename(lbd))[0],
                nspec=meta['nspec'], npoints=meta['npoints'],
                x0=meta['fx'], x1=meta['lx'], lbd_path=lbd)


def scan_nicolet_folder(folder):
    """Catalogue the Nicolet/OMNIC libraries in ``folder`` (non-recursive).

    A library is one set of files sharing a base name; we key on the resolved
    .LBD so a folder holding both ``SEA228.LBD`` and ``SEA228.LBT`` yields one
    entry. Members that fail to parse are skipped. Returns a list of info dicts
    (see :func:`nicolet_library_info`) sorted by title.
    """
    try:
        names = os.listdir(folder)
    except OSError:
        return []
    seen, out = set(), []
    for name in names:
        if not name.lower().endswith(('.lbd', '.lbt', '.lbp', '.lbg')):
            continue
        path = os.path.join(folder, name)
        lbd = _resolve_lbd(path)
        if not lbd:
            continue
        key = os.path.normcase(os.path.abspath(lbd))
        if key in seen:
            continue
        seen.add(key)
        try:
            out.append(nicolet_library_info(lbd))
        except (ValueError, OSError, FileNotFoundError):
            continue
    out.sort(key=lambda d: d['title'].lower())
    return out


# ---------------------------------------------------------------------------
# Selection dialog
# ---------------------------------------------------------------------------

class NicoletLibraryDialog(wx.Dialog):
    """Pick which reference spectra to import from a (possibly large) library."""

    def __init__(self, parent, lib):
        super().__init__(parent, title="Import Nicolet FTIR library",
                         size=(560, 560),
                         style=wx.DEFAULT_DIALOG_STYLE | wx.RESIZE_BORDER)
        self.lib = lib
        panel = wx.Panel(self)
        sizer = wx.BoxSizer(wx.VERTICAL)

        head = wx.StaticText(
            panel, label=f"{lib['title']}\n{lib['nspec']} reference spectra  "
                         f"({lib['npoints']} pts, "
                         f"{lib['x'][0]:.0f}-{lib['x'][-1]:.0f} cm⁻¹)")
        head.SetFont(head.GetFont().Bold())
        sizer.Add(head, 0, wx.ALL, 8)

        filt_row = wx.BoxSizer(wx.HORIZONTAL)
        filt_row.Add(wx.StaticText(panel, label="Filter:"),
                     0, wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 5)
        self.filter = wx.TextCtrl(panel)
        self.filter.Bind(wx.EVT_TEXT, self._on_filter)
        filt_row.Add(self.filter, 1)
        sizer.Add(filt_row, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        self._labels = [self._label(i) for i in range(lib['nspec'])]
        self.listbox = wx.CheckListBox(panel, choices=self._labels)
        self._visible = list(range(lib['nspec']))   # listbox row -> spectrum idx
        sizer.Add(self.listbox, 1, wx.EXPAND | wx.ALL, 8)

        btn_row = wx.BoxSizer(wx.HORIZONTAL)
        for lbl, fn in (("Select all", self._select_all),
                        ("Clear", self._clear)):
            b = wx.Button(panel, label=lbl)
            b.Bind(wx.EVT_BUTTON, fn)
            btn_row.Add(b, 0, wx.RIGHT, 5)
        self.count_lbl = wx.StaticText(panel, label="0 selected")
        btn_row.Add(self.count_lbl, 0, wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 10)
        sizer.Add(btn_row, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        ok_row = wx.StdDialogButtonSizer()
        ok = wx.Button(panel, wx.ID_OK, "Import selected")
        ok.SetDefault()
        ok_row.AddButton(ok)
        ok_row.AddButton(wx.Button(panel, wx.ID_CANCEL))
        ok_row.Realize()
        sizer.Add(ok_row, 0, wx.EXPAND | wx.ALL, 8)

        self.listbox.Bind(wx.EVT_CHECKLISTBOX, lambda e: self._update_count())
        panel.SetSizer(sizer)

    def _label(self, i):
        name = self.lib['names'][i]
        return f"{i + 1:>4}.  {name}" if name else f"{i + 1:>4}.  (spectrum {i + 1})"

    def _on_filter(self, _evt):
        q = self.filter.GetValue().strip().lower()
        checked = set(self.selected_indices())
        if q:
            self._visible = [i for i in range(self.lib['nspec'])
                             if q in self._labels[i].lower()]
        else:
            self._visible = list(range(self.lib['nspec']))
        self.listbox.Set([self._labels[i] for i in self._visible])
        for row, i in enumerate(self._visible):
            if i in checked:
                self.listbox.Check(row, True)
        self._update_count()

    def _select_all(self, _evt):
        for row in range(self.listbox.GetCount()):
            self.listbox.Check(row, True)
        self._update_count()

    def _clear(self, _evt):
        for row in range(self.listbox.GetCount()):
            self.listbox.Check(row, False)
        self._update_count()

    def _update_count(self):
        self.count_lbl.SetLabel(f"{len(self.selected_indices())} selected")

    def selected_indices(self):
        """Spectrum indices currently checked (across all filter states)."""
        return sorted(self._visible[row] for row in range(self.listbox.GetCount())
                      if self.listbox.IsChecked(row))


# ---------------------------------------------------------------------------
# Import menu action
# ---------------------------------------------------------------------------

def _safe_ref(name, idx):
    return name if name else f"Spectrum {idx + 1}"


def _row_key(sheet_name):
    """Sample-Manager row key for an FTIR sheet: 'FTIR' -> '0', 'FTIR7' -> '7'."""
    suffix = sheet_name[4:]
    return suffix if suffix.isdigit() else '0'


def import_nicolet_library(window):
    """File > Import action: read a Nicolet/Thermo FTIR library and import the
    chosen reference spectra as FTIR, FTIR1, ... sheets in a new workbook."""
    from libraries.FileMenu.Open import open_xlsx_file

    wildcard = ("Nicolet FTIR libraries (*.lbd;*.lbt;*.lbp;*.lbg)|"
                "*.lbd;*.lbt;*.lbp;*.lbg;*.LBD;*.LBT;*.LBP;*.LBG|"
                "All files (*.*)|*.*")
    with wx.FileDialog(window, "Open Nicolet FTIR library", wildcard=wildcard,
                       style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST) as dlg:
        if dlg.ShowModal() == wx.ID_CANCEL:
            return
        path = dlg.GetPath()

    try:
        lib = parse_nicolet_library(path)
    except Exception as e:
        window.show_popup_message2("Error", f"Could not read library:\n{e}")
        return

    dialog = NicoletLibraryDialog(window, lib)
    try:
        if dialog.ShowModal() != wx.ID_OK:
            return
        selected = dialog.selected_indices()
    finally:
        dialog.Destroy()

    if not selected:
        return

    if len(selected) > 150:
        proceed = wx.MessageBox(
            f"You selected {len(selected)} spectra. Importing many spectra "
            f"creates one sheet each and can be slow.\n\nContinue?",
            "Large import", wx.YES_NO | wx.ICON_QUESTION, window)
        if proceed != wx.YES:
            return

    try:
        _import_selected(window, lib, selected, path, open_xlsx_file)
    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2("Error", f"Error importing library:\n{e}")


def _import_selected(window, lib, selected, source_path, open_xlsx_file):
    """Write the chosen spectra to a workbook, open it, and tag FTIR units."""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    x = lib['x'].tolist()
    entries = []   # (sheet_name, spectrum_index)
    for idx in selected:
        y = np.asarray(lib['get_y'](idx), dtype=float)
        good = np.isfinite(y)
        data = list(zip(x, y.tolist())) if good.all() else \
            [(xi, yi) for xi, yi, g in zip(x, y.tolist(), good) if g]
        if not data:
            continue
        sheet_name = _next_ftir_sheet_name(wb.sheetnames)
        _write_ftir_sheet(wb, sheet_name, data)
        entries.append((sheet_name, idx))

    if not entries:
        window.show_popup_message2("Error", "No valid spectra to import.")
        return

    _write_description(wb, lib, entries, source_path)

    base = os.path.splitext(os.path.basename(lib['lbd_path']))[0]
    excel_path = os.path.join(os.path.dirname(lib['lbd_path']), f"{base}_FTIR.xlsx")
    wb.save(excel_path)

    open_xlsx_file(window, excel_path)

    # Tag every imported sheet as absorbance (we know the ordinate for sure, so
    # pass full confidence - no unit-confirm dialog). _tag_ftir_units also drops
    # the stale plot limits computed during open (which assumed the %T default,
    # padding below the trace) and redraws, so absorbance bands get the headroom
    # above them - the fix for spectra that came up mislabelled as transmittance.
    from libraries.FileMenu.FTIR_Import import _tag_ftir_units
    reason = "Nicolet/OMNIC library reference (absorbance)."
    _tag_ftir_units(window, {sn: (Y_UNIT_ABSORBANCE, 1.0, reason)
                             for sn, _ in entries})

    # Record the compound name as this sheet's Sample/Experiment name (shown in
    # the Sample Manager, column 0) and as the FTIR reference label. The manager
    # keys names by row index, which is the FTIR sheet's numeric suffix.
    core_levels = window.Data.get('Core levels', {})
    sample_names = window.Data.setdefault('SampleNames', {})
    for sheet_name, idx in entries:
        name = lib['names'][idx].strip()
        if name:
            sample_names[_row_key(sheet_name)] = name
        if sheet_name in core_levels:
            core_levels[sheet_name]['FTIR_Reference'] = \
                f"{_safe_ref(name, idx)} [{lib['title']}]"


def _write_description(wb, lib, entries, source_path):
    """One 'Experimental description' sheet mapping each FTIRn sheet to its
    compound name, so the generic sheet names stay traceable."""
    ws = wb.create_sheet("Experimental description")
    ws.column_dimensions['A'].width = 14
    ws.column_dimensions['B'].width = 60
    rows = [
        ("Library", lib['title']),
        ("Source", os.path.basename(source_path)),
        ("Data file", os.path.basename(lib['lbd_path'])),
        ("Technique", "FTIR (library reference)"),
        ("Y Units", "Absorbance (normalised library reference)"),
        ("Points", str(lib['npoints'])),
        ("Range", f"{lib['x'][0]:.1f}-{lib['x'][-1]:.1f} cm-1"),
        ("Imported", f"{len(entries)} of {lib['nspec']} spectra"),
        ("", ""),
        ("Sheet", "Compound"),
    ]
    r = 1
    for a, b in rows:
        ws[f"A{r}"], ws[f"B{r}"] = a, b
        r += 1
    for sheet_name, idx in entries:
        ws[f"A{r}"] = sheet_name
        ws[f"B{r}"] = _safe_ref(lib['names'][idx], idx)
        r += 1
