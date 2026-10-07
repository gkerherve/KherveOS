"""How values are shown in cells: numbers and number formats.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

def general_display(value: float) -> str:
    """A number as a cell shows it in the General format: two decimals,
    rounded once from the exact value and halves away from zero, as Excel
    does (1.23456 → 1.23, 0.125 → 0.13); huge numbers as 1.00E+20."""
    from decimal import ROUND_HALF_UP, Decimal

    if abs(value) >= 1e15:
        return f"{value:.2E}"
    return str(Decimal(repr(float(value))).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP))


def format_number(value, decimals=3):
    """Format a numeric result for cell display.

    Shows up to *decimals* places (default 3), trailing zeros stripped.
    Integers display without decimals.  Non-numeric values pass through.
    """
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return value
    if not isinstance(value, float):
        return value
    if value != value or value in (float("inf"), float("-inf")):
        return "#NUM!"
    # Very large numbers in scientific notation (1E+20), as Excel does.
    if abs(value) >= 1e15:
        mantissa, exponent = f"{value:.{decimals}E}".split("E")
        mantissa = mantissa.rstrip("0").rstrip(".")
        return f"{mantissa}E{exponent[0]}{exponent[1:].lstrip('0') or '0'}"
    # Exact integer floats.
    if value == int(value):
        return int(value)
    # Round to requested precision and strip trailing zeros.
    rounded = round(value, decimals)
    s = f"{rounded:.{decimals}f}"
    s = s.rstrip("0").rstrip(".")
    return s


def format_value(raw: str, fmt: str) -> str:
    """Display-format a raw cell value according to the format string.

    Parameterised formats use ``Category:param``:
    - ``Currency:€``  — symbol
    - ``Sci:2``       — decimal places
    - ``Date:%d/%m/%Y`` — strftime pattern
    - ``Time:%H:%M``    — strftime pattern
    Legacy single-word strings are kept for backwards compatibility.
    """
    if fmt == "General" or fmt == "Text" or not raw:
        return raw

    # ── Date (serial number → formatted string) ──────────────────
    if fmt.startswith("Date"):
        pattern = fmt.split(":", 1)[1] if ":" in fmt else "%Y-%m-%d"
        try:
            from datetime import datetime, timedelta
            val = float(raw)
            dt = datetime(1899, 12, 30) + timedelta(days=val)
            return dt.strftime(pattern)
        except (ValueError, TypeError, OverflowError):
            return raw

    # ── Time (fractional day → formatted string) ─────────────────
    if fmt.startswith("Time"):
        pattern = fmt.split(":", 1)[1] if ":" in fmt else "%H:%M:%S"
        try:
            from datetime import datetime, timedelta
            val = float(raw)
            frac = val - int(val)
            # Build a datetime so we can use strftime for 12-hour etc.
            base = datetime(2000, 1, 1)
            dt = base + timedelta(seconds=round(frac * 86400))
            return dt.strftime(pattern)
        except (ValueError, TypeError):
            return raw

    try:
        val = float(raw)
    except (ValueError, TypeError):
        return raw

    # ── Number precisions ────────────────────────────────────────
    if fmt == "0":
        return f"{val:.0f}"
    if fmt == "0.0":
        return f"{val:.1f}"
    if fmt == "0.00":
        return f"{val:.2f}"
    if fmt == "0.000":
        return f"{val:.3f}"
    if fmt == "0.0000":
        return f"{val:.4f}"

    # ── Scientific (with precision) ──────────────────────────────
    if fmt == "Scientific" or fmt.startswith("Sci"):
        prec = 4  # legacy default
        if ":" in fmt:
            try:
                prec = int(fmt.split(":", 1)[1])
            except ValueError:
                pass
        return f"{val:.{prec}e}"

    # ── Percentage ───────────────────────────────────────────────
    if fmt == "Percentage":
        return f"{val * 100:.2f}%"

    # ── Currency (with symbol) ───────────────────────────────────
    if fmt == "Currency" or fmt.startswith("Currency:"):
        sym = "$"
        if ":" in fmt:
            sym = fmt.split(":", 1)[1]
        return f"{sym}{val:,.2f}"

    return raw
