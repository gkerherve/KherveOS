"""Text colours of the peak grid cells, as the desktop paints them.

GENERATED from KherveFittingPro dev-AI libraries/Sheet_Operations.py
(on_sheet_selected, the per-model colouring of the peak rows): grey = derived
value, white = unused for this model, constraint colour on the constraint row
= the value is hidden there, green = calculated (Conc., A/Aᴀ, Split).
Regenerate, don't hand-edit.
"""

CONS = 'cons'


class _Recorder:
    def __init__(self, grid):
        self.grid = grid
        self.colours = {}

    def GetCellValue(self, row, col):
        return self.grid.GetCellValue(row, col)

    def SetCellTextColour(self, row, col, colour):
        self.colours[(row, col)] = colour


def _style_peak(grid, row):
    for col in [10, 11, 12]:  # Columns for Area, sigma and gamma
        grid.SetCellTextColour(row, col, (27, 140, 60))
    for col in [0, 1, 2]:  # Columns for Area, sigma and gamma
        grid.SetCellTextColour(row, col, (0, 0, 0))
        grid.SetCellTextColour(row + 1, col, (0, 0, 0))

    method = grid.GetCellValue(row, 13)
    if method == "Voigt (Area, L/G, \u03c3)":
        for col in [3,4,8]:  # Columns for Height, FWHM
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [5,6,7]:  # Columns for Height, FWHM, L/G ratio
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
        for col in [9]:  # Columns for Area, sigma and gamma
            # grid.SetCellValue(row, col, "0")
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (255, 255, 255))
            grid.SetCellTextColour(row + 1, col, CONS)
    elif method == "Voigt (Area, L/G, \u03c3, S)":
        for col in [3,4,8]:  # Columns for Height, FWHM
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [5,6,7,9]:  # Columns for Height, FWHM, L/G ratio
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
    elif method in ["A*GL (Area, a, b)", "A*SGL (Area, a, b)"]:
        for col in [3]:  # Height is derived for the area-based A*GL / A*SGL
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [4,5,6,7,8]:  # FWHM, L/G, Area, a (sigma col), b (gamma col)
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
        for col in [9]:  # Skew column unused
            grid.SetCellTextColour(row, col, (255, 255, 255))
            grid.SetCellTextColour(row + 1, col, CONS)
    elif method == "LF (Area, σ, γ, w)":
        for col in [3,5]:  # Height and L/G are derived
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [4,6,7,8,9]:  # FWHM, Area, sigma, gamma, w
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
    elif method == "DL (A, σ, γ, aDL)":
        for col in [3,4,5]:  # Height, FWHM, L/G are derived
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [6,7,8,9]:  # Area, sigma, gamma, a_dl
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
    elif method == "TLA (A, μ, α, Wg)":
        for col in [3,5]:  # Height derived, L/G unused
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [4,6,7,8,9]:  # FWHM, Area, mu, wg, alpha
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
    elif method == "SB (Height)":
        for col in [6]:  # Area is derived for the step component
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [3,4,5]:  # Height, FWHM, L/G
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
        for col in [7,8,9]:  # unused
            grid.SetCellTextColour(row, col, (255, 255, 255))
            grid.SetCellTextColour(row + 1, col, CONS)
    elif method == "Voigt (Area)":
        for col in [3,7,8]:  # Height and derived W_g/W_l
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [4,5,6]:  # FWHM, L/G, Area
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
        for col in [9]:  # Skew unused
            grid.SetCellTextColour(row, col, (255, 255, 255))
            grid.SetCellTextColour(row + 1, col, CONS)
    elif method == "Voigt (Area, L/G, S)":
        for col in [3,7,8]:  # Height and derived W_g/W_l
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [4,5,6,9]:  # FWHM, L/G, Area, skew
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
    elif method == "DS (A, \u03c3, \u03b3)":
        for col in [3,4]:  # Columns for Height, FWHM
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [5,6,7,8,9]:  # Columns for Height, FWHM, L/G ratio
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
    elif method in ["DS*G (A, \u03c3, \u03b3, S)"]:
        for col in [3,4]:  # Columns for Height, FWHM
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [5,6,7,8,9]:  # Columns for Height, FWHM, L/G ratio
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
    elif method in ["LA*G (Area, \u03c3/\u03b3, \u03b3)"]:
        for col in [3, 7]:  # Columns for Height and Sigma
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [4, 5, 6, 8, 9]:  # Columns for FWHM, L/G, Area, Gamma, Skew
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
    elif method in ["Voigt (Area, \u03c3, \u03B3)",
                        "ExpGauss.(Area, \u03c3, \u03b3)"]:
        for col in [3,4,5]:  # Columns for Height, FWHM, L/G ratio
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [6,7,8]:  # Columns for Height, FWHM
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
        for col in [9]:  # Columns for Area, sigma and gamma
            # grid.SetCellValue(row, col, "0")
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (255, 255, 255))
            grid.SetCellTextColour(row + 1, col, CONS)
    elif method in ["LA (Area, \u03c3, \u03b3)"]:
        for col in [3,5]:  # Columns for Height, FWHM, L/G ratio
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [4,6,7,8]:  # Columns for Height, FWHM
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
        for col in [9]:  # Columns for Area, sigma and gamma
            # grid.SetCellValue(row, col, "0")
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (255, 255, 255))
            grid.SetCellTextColour(row + 1, col, CONS)
    elif method in ["LA (Area, \u03c3/\u03b3, \u03b3)"]: # LA (Area, \u03c3/\u03b3, \u03b3)
        for col in [3,7]:  # Columns for Height, FWHM, L/G ratio
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [4,5,6,8]:  # Columns for Height, FWHM
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
        for col in [9]:  # Columns for Area, sigma and gamma
            # grid.SetCellValue(row, col, "0")
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (255, 255, 255))
            grid.SetCellTextColour(row + 1, col, CONS)
    elif method in ["Pseudo-Voigt (Area)", "GL (Area)", "SGL (Area)"]:
        for col in [3]:  # Height
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [7, 8]:  # Columns for Area, sigma and gamma
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (255, 255, 255))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [4,5,6]:  # Columns for Height, FWHM, L/G ratio
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
        for col in [9]:  # Columns for Area, sigma and gamma
            # grid.SetCellValue(row, col, "0")
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (255, 255, 255))
            grid.SetCellTextColour(row + 1, col, CONS)
    elif method in ["D-parameter", "Fermi", "Curie-Weiss"]:
        for col in [2]:  # Columns for Height, FWHM, L/G ratio
            pass  # (desktop also writes "0" here; the core does that on select)
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [4,5,6,8]:  # Columns for Height, FWHM
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
    elif method in ["SingleEntity"]:
        for col in [2,3,5,6]:  # Greyed: Position, Height, L/G, Area (derived)
            pass  # (desktop also writes "0" here; the core does that on select)
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [7,8,9]:  # Active: Sigma(shift), Gamma(scale), Wg
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
        for col in [4,5]:  # Hidden: FWHM (unused), L/G (immutable)
            grid.SetCellTextColour(row, col, (255, 255, 255))
            grid.SetCellTextColour(row + 1, col, CONS)
    else:
        pass
        for col in [6]:  # Columns for Area, sigma and gamma
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [7, 8]:  # Columns for Area, sigma and gamma
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (255, 255, 255))
            grid.SetCellTextColour(row + 1, col, CONS)
        for col in [3,4,5]:  # Columns for Height, FWHM, L/G ratio
            grid.SetCellTextColour(row, col, (0, 0, 0))
            grid.SetCellTextColour(row + 1, col, (0, 0, 0))
        for col in [9]:  # Columns for Area, sigma and gamma
            # grid.SetCellValue(row, col, "0")
            # grid.SetCellValue(row + 1, col, "0")
            grid.SetCellTextColour(row, col, (128, 128, 128))
            grid.SetCellTextColour(row + 1, col, CONS)


_CODES = {(128, 128, 128): 'g', (255, 255, 255): 'w', (27, 140, 60): 'k', (0, 0, 0): '.', CONS: 'c'}


def grid_colours(grid):
    """One string per grid row, one character per column: '.' normal,
    'g' grey (derived), 'w' white (unused), 'c' hidden on the constraint
    row, 'k' green (calculated)."""
    rec = _Recorder(grid)
    for row in range(0, grid.GetNumberRows(), 2):
        try:
            _style_peak(rec, row)
        except Exception:
            pass
    out = []
    for row in range(grid.GetNumberRows()):
        out.append(''.join(_CODES.get(rec.colours.get((row, c)), '.') for c in range(grid.GetNumberCols())))
    return out
