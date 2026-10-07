"""The formula function library: ~290 Excel-style and science functions.

``build_namespace(host)`` returns the names a compiled formula is evaluated
with.  *host* supplies the cells: ``_cell_val``, ``_cell_raw``,
``_agg_range``, ``_agg_col``, ``_range_values``, ``_range_values_2d``,
``_XC`` and ``_XRANGE`` (see ``values.CellValues``).  No Qt here.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import numpy as np

from .values import Blank, Range


def build_namespace(host):
    """Every function and constant a formula can use, bound to *host*."""
    import math

    import datetime as _dt

    def _flatten(args):
        # Flatten nested ranges/lists; strings stay atomic.
        out = []
        for a in args:
            if (isinstance(a, (list, tuple))
                    or (hasattr(a, '__iter__')
                        and not isinstance(a, str))):
                out.extend(_flatten(a))
            else:
                out.append(a)
        return out

    def _nums(args):
        # Flatten then keep only numeric-convertible values.
        out = []
        for v in _flatten(args):
            if isinstance(v, Blank):
                continue           # empty cells are not numbers
            try:
                out.append(float(v))
            except (TypeError, ValueError):
                pass
        return out

    def _text(v):
        # A value as text, the way Excel writes it: 2 not 2.0,
        # 0.1+0.2 as 0.3 (15 significant digits), "" for empty.
        if v is None or isinstance(v, Blank):
            return ""
        if isinstance(v, bool):
            return "TRUE" if v else "FALSE"
        if isinstance(v, float):
            if v.is_integer() and abs(v) < 1e15:
                return str(int(v))
            return f"{v:.15g}"
        return str(v)

    class _Lazy:
        # An IF/IFS/IFERROR/IFNA argument, computed only when needed.
        __slots__ = ("thunk",)

        def __init__(self, thunk):
            self.thunk = thunk

    def _force(v):
        return v.thunk() if isinstance(v, _Lazy) else v

    def _is_error(v):
        return isinstance(v, str) and v.startswith("#") and (
            v.endswith("!") or v.endswith("?") or v in ("#N/A", "#ERROR"))

    class _Join:
        # The & operator: a & _JOIN & b joins a and b as text.
        def __rand__(self, left):
            return _Joining(left)

    class _Joining:
        __slots__ = ("left",)

        def __init__(self, left):
            self.left = left

        def __and__(self, right):
            return _text(self.left) + _text(right)

    _JOIN = _Join()

    class _Constant(float):
        # PI works both as a value (PI*2) and a function (PI()*2).
        def __call__(self):
            return float(self)

    def _grid(x):
        # A range's rows × columns; a plain list is one column.
        if isinstance(x, Range):
            return x.grid
        if isinstance(x, list) and x and isinstance(x[0], list):
            return x
        return [[v] for v in _flatten([x])]

    def _mean(*args):
        # Accept _mean([1,2,3]), _mean(1,2,3) or mixed ranges.
        v = _nums(args)
        return sum(v) / len(v) if v else 0

    def _SUM(*args):
        return sum(_nums(args))

    def _MINF(*args):
        v = _nums(args)
        return min(v) if v else 0

    def _MAXF(*args):
        v = _nums(args)
        return max(v) if v else 0

    def _PRODUCT(*args):
        v = _nums(args)
        p = 1.0
        for x in v:
            p *= x
        return p if v else 0

    def _COUNT(*args):
        return len(_nums(args))

    def _COUNTA(*args):
        return len([a for a in _flatten(args)
                    if a not in ("", None)])

    def _STDEV(*args):
        v = _nums(args)
        if len(v) < 2:
            return 0
        mn = sum(v) / len(v)
        return (sum((x - mn) ** 2 for x in v) / (len(v) - 1)) ** 0.5

    def _SUMSQ(*args):
        return sum(x * x for x in _nums(args))

    # ── Date & Time helpers ──────────────────────────────
    def _DATE(y, m, d):
        return _dt.date(int(y), int(m), int(d)).isoformat()

    def _TODAY():
        return _dt.date.today().isoformat()

    def _NOW():
        return _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def _TIME(h, m, s=0):
        return _dt.time(int(h), int(m), int(s)).isoformat()

    def _YEAR(d):
        return _dt.date.fromisoformat(str(d)).year

    def _MONTH(d):
        return _dt.date.fromisoformat(str(d)).month

    def _DAY(d):
        return _dt.date.fromisoformat(str(d)).day

    def _HOUR(t):
        return _dt.time.fromisoformat(str(t)).hour

    def _MINUTE(t):
        return _dt.time.fromisoformat(str(t)).minute

    def _SECOND(t):
        return _dt.time.fromisoformat(str(t)).second

    def _DAYS(end, start):
        a = _dt.date.fromisoformat(str(end))
        b = _dt.date.fromisoformat(str(start))
        return (a - b).days

    def _WEEKDAY(d):
        return _dt.date.fromisoformat(str(d)).isoweekday()

    def _DATEVALUE(d):
        return (_dt.date.fromisoformat(str(d)).toordinal()
                - _dt.date(1899, 12, 30).toordinal())

    def _TIMEVALUE(t):
        tm = _dt.time.fromisoformat(str(t))
        return ((tm.hour * 3600 + tm.minute * 60 + tm.second)
                / 86400)

    def _EDATE(start, months):
        d = _dt.date.fromisoformat(str(start))
        m = int(float(months))
        new_month = d.month + m
        new_year = d.year + (new_month - 1) // 12
        new_month = (new_month - 1) % 12 + 1
        import calendar
        max_day = calendar.monthrange(new_year, new_month)[1]
        return _dt.date(new_year, new_month,
                        min(d.day, max_day)).isoformat()

    def _EOMONTH(start, months):
        import calendar
        d = _dt.date.fromisoformat(str(start))
        m = int(float(months))
        new_month = d.month + m
        new_year = d.year + (new_month - 1) // 12
        new_month = (new_month - 1) % 12 + 1
        last = calendar.monthrange(new_year, new_month)[1]
        return _dt.date(new_year, new_month, last).isoformat()

    def _WEEKNUM(d, return_type=1):
        dt = _dt.date.fromisoformat(str(d))
        return dt.isocalendar()[1]

    def _ISOWEEKNUM(d):
        return _dt.date.fromisoformat(str(d)).isocalendar()[1]

    def _YEARFRAC(start, end, basis=0):
        d1 = _dt.date.fromisoformat(str(start))
        d2 = _dt.date.fromisoformat(str(end))
        days = abs((d2 - d1).days)
        return days / 365.25

    def _DAYS360(start, end, method=False):
        d1 = _dt.date.fromisoformat(str(start))
        d2 = _dt.date.fromisoformat(str(end))
        y1, m1, dy1 = d1.year, d1.month, min(d1.day, 30)
        y2, m2, dy2 = d2.year, d2.month, d2.day
        if not method:  # US method
            if dy1 == 30 and dy2 == 31:
                dy2 = 30
            if dy1 == 31:
                dy1 = 30
        else:  # European
            dy1 = min(dy1, 30)
            dy2 = min(dy2, 30)
        return ((y2 - y1) * 360 + (m2 - m1) * 30
                + (dy2 - dy1))

    def _NETWORKDAYS(start, end, holidays=None):
        d1 = _dt.date.fromisoformat(str(start))
        d2 = _dt.date.fromisoformat(str(end))
        hols = set()
        if holidays:
            for h in _flatten([holidays]):
                try:
                    hols.add(_dt.date.fromisoformat(str(h)))
                except Exception:
                    pass
        count = 0
        step = 1 if d2 >= d1 else -1
        d = d1
        while ((step == 1 and d <= d2)
               or (step == -1 and d >= d2)):
            if d.weekday() < 5 and d not in hols:
                count += 1
            d += _dt.timedelta(days=step)
        return count * step

    def _WORKDAY(start, days, holidays=None):
        d = _dt.date.fromisoformat(str(start))
        n = int(float(days))
        hols = set()
        if holidays:
            for h in _flatten([holidays]):
                try:
                    hols.add(_dt.date.fromisoformat(str(h)))
                except Exception:
                    pass
        step = 1 if n > 0 else -1
        count = 0
        while count < abs(n):
            d += _dt.timedelta(days=step)
            if d.weekday() < 5 and d not in hols:
                count += 1
        return d.isoformat()

    # NETWORKDAYS.INTL / WORKDAY.INTL aliased to basic
    _NETWORKDAYS_INTL = _NETWORKDAYS
    _WORKDAY_INTL = _WORKDAY

    # ── Text helpers ─────────────────────────────────────
    def _LEFT(t, n=1):
        return _text(t)[:int(n)]

    def _RIGHT(t, n=1):
        return _text(t)[-int(n):]

    def _MID(t, start, n):
        s = _text(t)
        return s[int(start) - 1:int(start) - 1 + int(n)]

    def _LEN(t):
        return len(_text(t))

    def _LOWER(t):
        return _text(t).lower()

    def _UPPER(t):
        return _text(t).upper()

    def _PROPER(t):
        return _text(t).title()

    def _TRIM(t):
        return " ".join(_text(t).split())

    def _CONCAT(*args):
        return "".join(_text(a) for a in args)

    def _SUBSTITUTE(t, old, new, instance=None):
        s = _text(t)
        if instance is None:
            return s.replace(_text(old), _text(new))
        # Replace only the n-th occurrence.
        count = 0
        idx = 0
        old_s, new_s = _text(old), _text(new)
        while True:
            pos = s.find(old_s, idx)
            if pos == -1:
                return s
            count += 1
            if count == int(instance):
                return s[:pos] + new_s + s[pos + len(old_s):]
            idx = pos + 1

    def _REPT(t, n):
        return _text(t) * int(n)

    def _FIND(find, within, start=1):
        pos = _text(within).find(_text(find), int(start) - 1)
        return pos + 1 if pos >= 0 else "#VALUE!"

    def _REPLACE(old, start, n, new):
        s = _text(old)
        i = int(start) - 1
        return s[:i] + _text(new) + s[i + int(n):]

    def _EXACT(a, b):
        return _text(a) == str(b)

    def _VALUE(t):
        return float(_text(t))

    def _TEXT(v, fmt):
        return format(float(v), str(fmt))

    def _CHAR(n):
        return chr(int(float(n)))

    def _CODE(t):
        s = _text(t)
        return ord(s[0]) if s else 0

    def _CLEAN(t):
        return "".join(c for c in _text(t) if ord(c) >= 32)

    def _T(v):
        return _text(v) if isinstance(v, str) else ""

    def _DOLLAR_F(n, decimals=2):
        return f"${float(n):,.{int(decimals)}f}"

    def _FIXED(n, decimals=2, no_commas=False):
        s = f"{float(n):.{int(decimals)}f}"
        if not no_commas:
            parts = s.split(".")
            intpart = parts[0]
            neg = intpart.startswith("-")
            if neg:
                intpart = intpart[1:]
            groups = []
            while intpart:
                groups.append(intpart[-3:])
                intpart = intpart[:-3]
            result = ",".join(reversed(groups))
            if neg:
                result = "-" + result
            if len(parts) > 1:
                result += "." + parts[1]
            return result
        return s

    def _NUMBERVALUE(text, dec_sep=".", grp_sep=","):
        s = (_text(text).replace(str(grp_sep), "")
             .replace(str(dec_sep), "."))
        return float(s)

    def _SEARCH(find, within, start=1):
        pos = (_text(within).lower()
               .find(_text(find).lower(), int(start) - 1))
        return pos + 1 if pos >= 0 else "#VALUE!"

    def _TEXTJOIN(delimiter, ignore_empty, *args):
        d = _text(delimiter)
        vals = _flatten(args)
        if ignore_empty:
            vals = [_text(v) for v in vals
                    if v not in ("", None)]
        else:
            vals = [_text(v) for v in vals]
        return d.join(vals)

    def _UNICHAR(n):
        return chr(int(float(n)))

    def _UNICODE(t):
        s = str(t)
        return ord(s[0]) if s else 0

    # ── Logical helpers ──────────────────────────────────
    def _IF(cond, true_val=True, false_val=False):
        cond = _force(cond)
        if _is_error(cond):
            return cond
        return _force(true_val) if cond else _force(false_val)

    def _AND(*args):
        return all(args)

    def _OR(*args):
        return any(args)

    def _NOT(val):
        return not val

    def _IFERROR(val, fallback):
        try:
            v = _force(val)
        except Exception:
            return _force(fallback)
        return _force(fallback) if _is_error(v) else v

    def _XOR(*args):
        return sum(bool(a) for a in args) % 2 == 1

    def _IFNA(val, fallback):
        v = _force(val)
        return _force(fallback) if v == "#N/A" else v

    def _IFS(*args):
        # IFS(cond1, val1, cond2, val2, ...)
        for i in range(0, len(args) - 1, 2):
            if _force(args[i]):
                return _force(args[i + 1])
        return "#N/A"

    # ── Information functions ────────────────────────────
    def _ISBLANK(v):
        return v is None or v == ""

    def _ISERROR(v):
        return isinstance(v, str) and v.startswith("#")

    def _ISERR(v):
        return _ISERROR(v) and v != "#N/A"

    def _ISNA(v):
        return isinstance(v, str) and v == "#N/A"

    def _ISNUMBER(v):
        if isinstance(v, (int, float)):
            return True
        if isinstance(v, str):
            try:
                float(v)
                return True
            except (ValueError, TypeError):
                return False
        return False

    def _ISTEXT(v):
        if isinstance(v, str):
            try:
                float(v)
                return False
            except (ValueError, TypeError):
                return v != ""
        return False

    def _ISNONTEXT(v):
        return not _ISTEXT(v)

    def _ISLOGICAL(v):
        return isinstance(v, bool) or v in (True, False)

    def _ISEVEN(v):
        return int(float(v)) % 2 == 0

    def _ISODD(v):
        return int(float(v)) % 2 != 0

    def _ISREF(v):
        # In a spreadsheet context, always False for a value.
        return False

    def _N(v):
        try:
            return float(v)
        except (ValueError, TypeError):
            return 0

    def _NA():
        return "#N/A"

    def _TYPE(v):
        if isinstance(v, (int, float)):
            return 1
        if isinstance(v, str):
            if v.startswith("#"):
                return 16
            return 2
        if isinstance(v, bool):
            return 4
        return 0

    def _ERROR_TYPE(v):
        errs = {"#NULL!": 1, "#DIV/0!": 2, "#VALUE!": 3,
                "#REF!": 4, "#NAME?": 5, "#NUM!": 6, "#N/A": 7}
        return errs.get(v, "#N/A")

    def _COUNTBLANK(*args):
        return sum(1 for a in _flatten(args) if a in ("", None))

    def _COUNTIF(rng, criteria):
        vals = _flatten([rng])
        count = 0
        for v in vals:
            if _countif_match(v, criteria):
                count += 1
        return count

    def _COUNTIFS(*args):
        # COUNTIFS(range1, criteria1, range2, criteria2, ...)
        if len(args) < 2 or len(args) % 2 != 0:
            return 0
        pairs = []
        for i in range(0, len(args), 2):
            pairs.append((_flatten([args[i]]),  args[i + 1]))
        n = min(len(p[0]) for p in pairs)
        count = 0
        for i in range(n):
            if all(_countif_match(p[0][i], p[1]) for p in pairs):
                count += 1
        return count

    def _countif_match(val, criteria):
        c = str(criteria)
        if c.startswith(">="):
            try: return float(val) >= float(c[2:])
            except (ValueError, TypeError): return False
        if c.startswith("<="):
            try: return float(val) <= float(c[2:])
            except (ValueError, TypeError): return False
        if c.startswith("<>"):
            return str(val) != c[2:]
        if c.startswith(">"):
            try: return float(val) > float(c[1:])
            except (ValueError, TypeError): return False
        if c.startswith("<"):
            try: return float(val) < float(c[1:])
            except (ValueError, TypeError): return False
        if c.startswith("="):
            c = c[1:]
        # Exact match (case-insensitive for strings).
        try:
            return float(val) == float(c)
        except (ValueError, TypeError):
            return str(val).lower() == c.lower()

    def _SUMIF(rng, criteria, sum_rng=None):
        vals = _flatten([rng])
        sums = _flatten([sum_rng]) if sum_rng is not None else vals
        total = 0.0
        for i, v in enumerate(vals):
            if _countif_match(v, criteria):
                try:
                    total += float(sums[i]) if i < len(sums) else 0
                except (ValueError, TypeError):
                    pass
        return total

    # ── Math extras ──────────────────────────────────────
    def _CEILING(n, significance=1):
        n, sig = float(n), float(significance)
        if sig == 0:
            return 0.0
        if n > 0 and sig < 0:
            return "#NUM!"
        return math.ceil(n / sig) * sig

    def _FLOOR(n, significance=1):
        n, sig = float(n), float(significance)
        if sig == 0:
            return "#DIV/0!"
        if n > 0 and sig < 0:
            return "#NUM!"
        return math.floor(n / sig) * sig

    def _MOD(n, d):
        return float(n) % float(d)

    def _POWER(n, p):
        return float(n) ** float(p)

    def _QUOTIENT(n, d):
        return int(float(n) // float(d))

    def _SIGN(n):
        n = float(n)
        return 1 if n > 0 else (-1 if n < 0 else 0)

    def _EVEN(n):
        n = math.ceil(abs(float(n)))
        return n + (n % 2) if float(n) >= 0 else -(n + (n % 2))  # noqa: E501

    def _ODD(n):
        n = math.ceil(abs(float(n)))
        if n % 2 == 0:
            n += 1
        return n if float(n) >= 0 else -n

    def _FACT(n):
        return math.factorial(int(n))

    def _GCD(*args):
        from math import gcd
        result = int(args[0])
        for a in args[1:]:
            result = gcd(result, int(a))
        return result

    def _LCM(*args):
        from math import gcd
        result = int(args[0])
        for a in args[1:]:
            result = result * int(a) // gcd(result, int(a))
        return result

    def _RAND():
        import random
        return random.random()

    def _RANDBETWEEN(lo, hi):
        import random
        return random.randint(int(lo), int(hi))

    def _ROUNDDOWN(n, d):
        m = 10 ** int(d)
        return math.trunc(float(n) * m) / m

    def _ROUNDUP(n, d):
        m = 10 ** int(d)
        v = float(n) * m
        return (math.ceil(v) if v >= 0
                else math.floor(v)) / m

    def _TRUNC(n, d=0):
        m = 10 ** int(d)
        return math.trunc(float(n) * m) / m

    def _COMBIN(n, k):
        return math.comb(int(n), int(k))

    def _DEGREES(r):
        return math.degrees(float(r))

    def _RADIANS(d):
        return math.radians(float(d))

    def _ACOT(x):
        return math.atan(1.0 / float(x))

    def _ACOTH(x):
        v = float(x)
        return 0.5 * math.log((v + 1) / (v - 1))

    def _COT(x):
        return 1.0 / math.tan(float(x))

    def _COTH(x):
        return 1.0 / math.tanh(float(x))

    def _CSC(x):
        return 1.0 / math.sin(float(x))

    def _CSCH(x):
        return 1.0 / math.sinh(float(x))

    def _SEC(x):
        return 1.0 / math.cos(float(x))

    def _SECH(x):
        return 1.0 / math.cosh(float(x))

    def _SQRTPI(x):
        return math.sqrt(float(x) * math.pi)

    def _BASE(n, radix, min_len=0):
        num = int(float(n))
        r = int(float(radix))
        digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        if num == 0:
            return "0".zfill(int(min_len))
        result = ""
        while num:
            result = digits[num % r] + result
            num //= r
        return result.zfill(int(min_len))

    def _DECIMAL(text, radix):
        return int(str(text), int(float(radix)))

    def _FACTDOUBLE(n):
        v = int(float(n))
        result = 1
        while v > 1:
            result *= v
            v -= 2
        return result

    def _CEILING_MATH(n, significance=1, mode=0):
        num = float(n)
        sig = float(significance)
        if sig == 0:
            return 0
        if mode and num < 0:
            return (-math.ceil(-num / abs(sig))
                    * abs(sig))
        return math.ceil(num / sig) * sig

    def _FLOOR_MATH(n, significance=1, mode=0):
        num = float(n)
        sig = float(significance)
        if sig == 0:
            return 0
        if mode and num < 0:
            return (-math.floor(-num / abs(sig))
                    * abs(sig))
        return math.floor(num / sig) * sig

    def _MROUND(n, multiple):
        num = float(n)
        m = float(multiple)
        if m == 0:
            return 0
        return round(num / m) * m

    def _MULTINOMIAL(*args):
        vals = [int(float(v)) for v in _flatten(args)]
        total = sum(vals)
        result = math.factorial(total)
        for v in vals:
            result //= math.factorial(v)
        return result

    def _COMBINA(n, k):
        ni, ki = int(float(n)), int(float(k))
        return _COMBIN(ni + ki - 1, ki)

    def _ROMAN(n, form=0):
        num = int(float(n))
        vals = [
            (1000, 'M'), (900, 'CM'), (500, 'D'),
            (400, 'CD'), (100, 'C'), (90, 'XC'),
            (50, 'L'), (40, 'XL'), (10, 'X'),
            (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]
        result = ""
        for v, s in vals:
            while num >= v:
                result += s
                num -= v
        return result

    def _SUMPRODUCT(*args):
        arrays = [_nums([a]) for a in args]
        if not arrays:
            return 0
        n = min(len(a) for a in arrays)
        result = 0
        for i in range(n):
            prod = 1
            for a in arrays:
                prod *= a[i]
            result += prod
        return result

    def _SUMIFS(sum_rng, *args):
        sums = _flatten([sum_rng])
        if len(args) < 2 or len(args) % 2 != 0:
            return 0
        pairs = []
        for i in range(0, len(args), 2):
            pairs.append(
                (_flatten([args[i]]), args[i + 1]))
        n = min(len(sums),
                *(len(p[0]) for p in pairs))
        total = 0.0
        for i in range(n):
            if all(_countif_match(p[0][i], p[1])
                   for p in pairs):
                try:
                    total += float(sums[i])
                except (ValueError, TypeError):
                    pass
        return total

    def _SUMX2MY2(x, y):
        xv, yv = _nums([x]), _nums([y])
        return sum(a ** 2 - b ** 2
                   for a, b in zip(xv, yv))

    def _SUMX2PY2(x, y):
        xv, yv = _nums([x]), _nums([y])
        return sum(a ** 2 + b ** 2
                   for a, b in zip(xv, yv))

    def _SUMXMY2(x, y):
        xv, yv = _nums([x]), _nums([y])
        return sum((a - b) ** 2
                   for a, b in zip(xv, yv))

    def _SUBTOTAL(func_num, *args):
        fn = int(float(func_num))
        funcs = {
            1: _mean, 2: _COUNT, 3: _COUNTA,
            4: _MAXF, 5: _MINF, 6: _PRODUCT,
            7: _STDEV, 9: _SUM,
            101: _mean, 102: _COUNT, 103: _COUNTA,
            104: _MAXF, 105: _MINF, 106: _PRODUCT,
            107: _STDEV, 109: _SUM}
        f = funcs.get(fn)
        if f:
            return f(*args)
        return "#VALUE!"

    def _MDETERM(*args):
        v = _nums(args)
        n = int(len(v) ** 0.5)
        if n * n != len(v):
            return "#VALUE!"
        return float(np.linalg.det(
            np.array(v).reshape(n, n)))

    def _MINVERSE(*args):
        v = _nums(args)
        n = int(len(v) ** 0.5)
        if n * n != len(v):
            return "#VALUE!"
        return (np.linalg.inv(np.array(v).reshape(n, n))
                .flatten().tolist())

    def _MMULT(a, b):
        return "#N/A"

    # ── Data Analysis functions ──────────────────────────────
    def _DERIV(y, x):
        ya, xa = np.array(_nums([y]), float), np.array(_nums([x]), float)
        return np.gradient(ya, xa).tolist()

    def _DERIV2(y, x):
        ya, xa = np.array(_nums([y]), float), np.array(_nums([x]), float)
        return np.gradient(np.gradient(ya, xa), xa).tolist()

    def _DERIV_SMOOTH(y, x, window=7, poly=3):
        from scipy.signal import savgol_filter
        ya = np.array(_nums([y]), float)
        xa = np.array(_nums([x]), float)
        dx = np.gradient(xa)
        dy = savgol_filter(ya, int(window), int(poly), deriv=1)
        return (dy / dx).tolist()

    try:
        _np_trapz = np.trapezoid
    except AttributeError:
        _np_trapz = np.trapz

    def _TRAPZ(y, x):
        return float(_np_trapz(
            np.array(_nums([y]), float),
            np.array(_nums([x]), float)))

    def _CUMTRAPZ(y, x):
        from scipy.integrate import cumulative_trapezoid
        ya, xa = np.array(_nums([y]), float), np.array(_nums([x]), float)
        ct = cumulative_trapezoid(ya, xa, initial=0)
        return ct.tolist()

    def _SIMPS(y, x):
        from scipy.integrate import simpson
        return float(simpson(
            np.array(_nums([y]), float),
            x=np.array(_nums([x]), float)))

    def _SAVGOL(y, window=7, poly=3):
        from scipy.signal import savgol_filter
        return savgol_filter(
            np.array(_nums([y]), float),
            int(window), int(poly)).tolist()

    def _MOVAVG(y, window=5):
        ya = np.array(_nums([y]), float)
        w = int(window)
        kernel = np.ones(w) / w
        smoothed = np.convolve(ya, kernel, mode='same')
        return smoothed.tolist()

    def _EWMA(y, alpha=0.3):
        ya = np.array(_nums([y]), float)
        a = float(alpha)
        out = np.empty_like(ya)
        out[0] = ya[0]
        for i in range(1, len(ya)):
            out[i] = a * ya[i] + (1 - a) * out[i - 1]
        return out.tolist()

    def _LOWPASS(y, x, cutoff):
        from scipy.signal import butter, sosfiltfilt
        xa = np.array(_nums([x]), float)
        fs = 1.0 / np.mean(np.abs(np.diff(xa)))
        sos = butter(4, float(cutoff), 'low', fs=fs, output='sos')
        return sosfiltfilt(
            sos, np.array(_nums([y]), float)).tolist()

    def _HIGHPASS(y, x, cutoff):
        from scipy.signal import butter, sosfiltfilt
        xa = np.array(_nums([x]), float)
        fs = 1.0 / np.mean(np.abs(np.diff(xa)))
        sos = butter(4, float(cutoff), 'high', fs=fs, output='sos')
        return sosfiltfilt(
            sos, np.array(_nums([y]), float)).tolist()

    def _BANDPASS(y, x, lo, hi):
        from scipy.signal import butter, sosfiltfilt
        xa = np.array(_nums([x]), float)
        fs = 1.0 / np.mean(np.abs(np.diff(xa)))
        sos = butter(4, [float(lo), float(hi)], 'band',
                     fs=fs, output='sos')
        return sosfiltfilt(
            sos, np.array(_nums([y]), float)).tolist()

    def _MEDIAN_FILTER(y, kernel=5):
        from scipy.signal import medfilt
        return medfilt(
            np.array(_nums([y]), float),
            int(kernel)).tolist()

    def _NORM_MAX(y):
        ya = np.array(_nums([y]), float)
        return (ya / np.max(np.abs(ya))).tolist()

    def _NORM_AREA(y, x):
        ya = np.array(_nums([y]), float)
        xa = np.array(_nums([x]), float)
        return (ya / _np_trapz(ya, xa)).tolist()

    def _NORM_MINMAX(y):
        ya = np.array(_nums([y]), float)
        lo, hi = ya.min(), ya.max()
        return ((ya - lo) / (hi - lo) if hi != lo
                else np.zeros_like(ya)).tolist()

    def _NORM_ZSCORE(y):
        ya = np.array(_nums([y]), float)
        m, s = ya.mean(), ya.std()
        return ((ya - m) / s if s != 0
                else np.zeros_like(ya)).tolist()

    def _NORM_PEAK(y, x, x_ref):
        ya = np.array(_nums([y]), float)
        xa = np.array(_nums([x]), float)
        idx = np.argmin(np.abs(xa - float(x_ref)))
        ref = ya[idx] if ya[idx] != 0 else 1.0
        return (ya / ref).tolist()

    def _NORM_RANGE(y, new_min, new_max):
        ya = np.array(_nums([y]), float)
        lo, hi = ya.min(), ya.max()
        if hi == lo:
            return np.full_like(ya, float(new_min)).tolist()
        scaled = (ya - lo) / (hi - lo)
        return (scaled * (float(new_max) - float(new_min))
                + float(new_min)).tolist()

    def _FFT_MAG(y):
        ya = np.array(_nums([y]), float)
        ft = np.fft.rfft(ya)
        return np.abs(ft).tolist()

    def _FFT_PHASE(y):
        ya = np.array(_nums([y]), float)
        return np.angle(np.fft.rfft(ya)).tolist()

    def _FFT_FREQ(y, x):
        ya = np.array(_nums([y]), float)
        xa = np.array(_nums([x]), float)
        dt = np.mean(np.abs(np.diff(xa)))
        return np.fft.rfftfreq(len(ya), d=dt).tolist()

    def _FFT_REAL(y):
        return np.fft.rfft(
            np.array(_nums([y]), float)).real.tolist()

    def _FFT_IMAG(y):
        return np.fft.rfft(
            np.array(_nums([y]), float)).imag.tolist()

    def _IFFT(real, imag):
        r = np.array(_nums([real]), float)
        i = np.array(_nums([imag]), float)
        return np.fft.irfft(r + 1j * i).tolist()

    def _FFT_POWER(y):
        ya = np.array(_nums([y]), float)
        ft = np.fft.rfft(ya)
        return (np.abs(ft) ** 2 / len(ya)).tolist()

    def _INTERP_LINEAR(y, x, new_x):
        return np.interp(
            np.array(_nums([new_x]), float),
            np.array(_nums([x]), float),
            np.array(_nums([y]), float)).tolist()

    def _INTERP_SPLINE(y, x, new_x):
        from scipy.interpolate import CubicSpline
        cs = CubicSpline(
            np.array(_nums([x]), float),
            np.array(_nums([y]), float))
        return cs(np.array(_nums([new_x]), float)).tolist()

    def _INTERP_AKIMA(y, x, new_x):
        from scipy.interpolate import Akima1DInterpolator
        ak = Akima1DInterpolator(
            np.array(_nums([x]), float),
            np.array(_nums([y]), float))
        return ak(np.array(_nums([new_x]), float)).tolist()

    def _RESAMPLE(y, x, n):
        xa = np.array(_nums([x]), float)
        ya = np.array(_nums([y]), float)
        new_x = np.linspace(xa.min(), xa.max(), int(n))
        return np.interp(new_x, xa, ya).tolist()

    def _FIND_PEAKS(y, prominence=None, distance=None):
        from scipy.signal import find_peaks as _fp
        ya = np.array(_nums([y]), float)
        kw = {}
        if prominence is not None:
            kw["prominence"] = float(prominence)
        if distance is not None:
            kw["distance"] = int(distance)
        idx, _ = _fp(ya, **kw)
        return (idx + 1).tolist()  # 1-based

    def _FIND_PEAKS_X(y, x, prominence=None, distance=None):
        from scipy.signal import find_peaks as _fp
        ya = np.array(_nums([y]), float)
        xa = np.array(_nums([x]), float)
        kw = {}
        if prominence is not None:
            kw["prominence"] = float(prominence)
        if distance is not None:
            kw["distance"] = int(distance)
        idx, _ = _fp(ya, **kw)
        return xa[idx].tolist()

    def _FIND_PEAKS_Y(y, prominence=None, distance=None):
        from scipy.signal import find_peaks as _fp
        ya = np.array(_nums([y]), float)
        kw = {}
        if prominence is not None:
            kw["prominence"] = float(prominence)
        if distance is not None:
            kw["distance"] = int(distance)
        idx, _ = _fp(ya, **kw)
        return ya[idx].tolist()

    def _BASELINE_POLY(y, x, degree=3):
        ya = np.array(_nums([y]), float)
        xa = np.array(_nums([x]), float)
        coeffs = np.polyfit(xa, ya, int(degree))
        return np.polyval(coeffs, xa).tolist()

    def _BASELINE_ALS(y, lam=1e6, p=0.01):
        from scipy import sparse
        from scipy.sparse.linalg import spsolve
        ya = np.array(_nums([y]), float)
        n = len(ya)
        D = sparse.diags([1, -2, 1], [0, -1, -2],
                         shape=(n, n - 2)).T
        w = np.ones(n)
        for _ in range(10):
            W = sparse.spdiags(w, 0, n, n)
            Z = W + float(lam) * D.T.dot(D)
            z = spsolve(Z, w * ya)
            w = float(p) * (ya > z) + (1 - float(p)) * (ya <= z)
        return z.tolist()

    # ── Engineering / base conversion ────────────────────
    def _DEC2HEX(n, places=None):
        v = int(float(n))
        s = format(v if v >= 0 else v + 2**40, 'X')
        if places is not None:
            s = s.zfill(int(places))
        return s

    def _DEC2BIN(n, places=None):
        v = int(float(n))
        s = format(v if v >= 0 else v + 2**10, 'b')
        if places is not None:
            s = s.zfill(int(places))
        return s

    def _DEC2OCT(n, places=None):
        v = int(float(n))
        s = format(v if v >= 0 else v + 2**30, 'o')
        if places is not None:
            s = s.zfill(int(places))
        return s

    def _HEX2DEC(n):
        return int(str(n), 16)

    def _HEX2BIN(n, places=None):
        return _DEC2BIN(_HEX2DEC(n), places)

    def _HEX2OCT(n, places=None):
        return _DEC2OCT(_HEX2DEC(n), places)

    def _BIN2DEC(n):
        return int(str(int(float(n))), 2)

    def _BIN2HEX(n, places=None):
        return _DEC2HEX(_BIN2DEC(n), places)

    def _BIN2OCT(n, places=None):
        return _DEC2OCT(_BIN2DEC(n), places)

    def _OCT2DEC(n):
        return int(str(int(float(n))), 8)

    def _OCT2BIN(n, places=None):
        return _DEC2BIN(_OCT2DEC(n), places)

    def _OCT2HEX(n, places=None):
        return _DEC2HEX(_OCT2DEC(n), places)

    def _DELTA(a, b=0):
        return 1 if float(a) == float(b) else 0

    def _GESTEP(n, step=0):
        return 1 if float(n) >= float(step) else 0

    def _ERF(x):
        return math.erf(float(x))

    def _ERFC(x):
        return math.erfc(float(x))

    # ── Complex number helpers ──────────────────────────
    def _parse_complex(z):
        """Parse '3+4i' or '3-4i' or number into (real, imag)."""
        s = str(z).strip().replace(" ", "")

        def coeff(t):
            # "", "+" and "-" before i mean 1, 1 and -1.
            return {"": 1.0, "+": 1.0, "-": -1.0}.get(t, None) \
                if t in ("", "+", "-") else float(t)

        if s.endswith("i") or s.endswith("j"):
            s = s[:-1]
            for idx in range(len(s) - 1, 0, -1):
                if s[idx] in "+-" and s[idx - 1] not in "eE":
                    return float(s[:idx]), coeff(s[idx:])
            return 0.0, coeff(s)
        try:
            return float(s), 0.0
        except ValueError:
            return 0.0, 0.0

    def _COMPLEX(real, imag, suffix="i"):
        # Written as Excel does: 3+4i, 4+i, -i, 2.5.
        r, i = float(real), float(imag)
        if i == 0:
            return _text(r)
        coeff = {1.0: "", -1.0: "-"}.get(i, _text(i))
        if r == 0:
            return f"{coeff}{suffix}"
        sign = "+" if i > 0 else ""
        return f"{_text(r)}{sign}{coeff}{suffix}"

    def _IMREAL(z):
        r, i = _parse_complex(z)
        return r

    def _IMAGINARY(z):
        r, i = _parse_complex(z)
        return i

    def _IMABS(z):
        r, i = _parse_complex(z)
        return (r ** 2 + i ** 2) ** 0.5

    def _IMARGUMENT(z):
        r, i = _parse_complex(z)
        return math.atan2(i, r)

    def _IMCONJUGATE(z):
        r, i = _parse_complex(z)
        return _COMPLEX(r, -i)

    def _IMCOS(z):
        r, i = _parse_complex(z)
        return _COMPLEX(math.cos(r) * math.cosh(i),
                        -math.sin(r) * math.sinh(i))

    def _IMSIN(z):
        r, i = _parse_complex(z)
        return _COMPLEX(math.sin(r) * math.cosh(i),
                        math.cos(r) * math.sinh(i))

    def _IMEXP(z):
        r, i = _parse_complex(z)
        e = math.exp(r)
        return _COMPLEX(e * math.cos(i), e * math.sin(i))

    def _IMLN(z):
        r, i = _parse_complex(z)
        return _COMPLEX(math.log((r ** 2 + i ** 2) ** 0.5),
                        math.atan2(i, r))

    def _IMLOG10(z):
        r, i = _parse_complex(z)
        ln_r = math.log((r ** 2 + i ** 2) ** 0.5)
        ln_i = math.atan2(i, r)
        return _COMPLEX(ln_r / math.log(10), ln_i / math.log(10))

    def _IMLOG2(z):
        r, i = _parse_complex(z)
        ln_r = math.log((r ** 2 + i ** 2) ** 0.5)
        ln_i = math.atan2(i, r)
        return _COMPLEX(ln_r / math.log(2), ln_i / math.log(2))

    def _IMPOWER(z, n):
        r, i = _parse_complex(z)
        import cmath
        c = complex(r, i) ** float(n)
        return _COMPLEX(c.real, c.imag)

    def _IMSQRT(z):
        r, i = _parse_complex(z)
        import cmath
        c = cmath.sqrt(complex(r, i))
        return _COMPLEX(c.real, c.imag)

    def _IMSUM(*args):
        tr, ti = 0.0, 0.0
        for a in _flatten(args):
            r, i = _parse_complex(a)
            tr += r; ti += i
        return _COMPLEX(tr, ti)

    def _IMSUB(z1, z2):
        r1, i1 = _parse_complex(z1)
        r2, i2 = _parse_complex(z2)
        return _COMPLEX(r1 - r2, i1 - i2)

    def _IMPRODUCT(*args):
        import cmath
        c = complex(1, 0)
        for a in _flatten(args):
            r, i = _parse_complex(a)
            c *= complex(r, i)
        return _COMPLEX(c.real, c.imag)

    def _IMDIV(z1, z2):
        r1, i1 = _parse_complex(z1)
        r2, i2 = _parse_complex(z2)
        c = complex(r1, i1) / complex(r2, i2)
        return _COMPLEX(c.real, c.imag)

    _UNITS = {
        # length (m)
        "m": ("length", 1.0), "mi": ("length", 1609.344),
        "Nmi": ("length", 1852.0), "in": ("length", 0.0254),
        "ft": ("length", 0.3048), "yd": ("length", 0.9144),
        "ang": ("length", 1e-10), "ell": ("length", 1.143),
        "ly": ("length", 9.46073047258e15), "pc": ("length", 3.08567758e16),
        # mass (g)
        "g": ("mass", 1.0), "lbm": ("mass", 453.59237),
        "ozm": ("mass", 28.349523125), "u": ("mass", 1.66053906660e-24),
        "stone": ("mass", 6350.29318), "ton": ("mass", 907184.74),
        # time (s)
        "sec": ("time", 1.0), "s": ("time", 1.0), "mn": ("time", 60.0),
        "min": ("time", 60.0), "hr": ("time", 3600.0),
        "day": ("time", 86400.0), "d": ("time", 86400.0),
        "yr": ("time", 31557600.0),
        # pressure (Pa)
        "Pa": ("pressure", 1.0), "p": ("pressure", 1.0),
        "atm": ("pressure", 101325.0), "at": ("pressure", 101325.0),
        "mmHg": ("pressure", 133.322), "psi": ("pressure", 6894.757),
        "Torr": ("pressure", 133.322368),
        # force (N)
        "N": ("force", 1.0), "dyn": ("force", 1e-5), "lbf": ("force", 4.4482216),
        # energy (J)
        "J": ("energy", 1.0), "e": ("energy", 1e-7), "c": ("energy", 4.184),
        "cal": ("energy", 4.1868), "eV": ("energy", 1.602176634e-19),
        "ev": ("energy", 1.602176634e-19), "Wh": ("energy", 3600.0),
        "wh": ("energy", 3600.0), "BTU": ("energy", 1055.05585262),
        # power (W)
        "W": ("power", 1.0), "w": ("power", 1.0), "HP": ("power", 745.69987),
        "h": ("power", 745.69987), "PS": ("power", 735.49875),
        # magnetism (T)
        "T": ("magnetism", 1.0), "ga": ("magnetism", 1e-4),
        # volume (l)
        "l": ("volume", 1.0), "L": ("volume", 1.0), "lt": ("volume", 1.0),
        "m3": ("volume", 1000.0), "tsp": ("volume", 0.00492892159375),
        "tbs": ("volume", 0.01478676478125), "oz": ("volume", 0.0295735295625),
        "cup": ("volume", 0.2365882365), "pt": ("volume", 0.473176473),
        "qt": ("volume", 0.946352946), "gal": ("volume", 3.785411784),
        # area (m2)
        "m2": ("area", 1.0), "ha": ("area", 10000.0),
        "ar": ("area", 100.0), "uk_acre": ("area", 4046.8564224),
        # information (bit)
        "bit": ("information", 1.0), "byte": ("information", 8.0),
        # speed (m/s)
        "m/s": ("speed", 1.0), "m/sec": ("speed", 1.0),
        "m/h": ("speed", 1 / 3600.0), "mph": ("speed", 0.44704),
        "kn": ("speed", 0.514444444),
    }
    _PREFIXES = {
        "Y": 1e24, "Z": 1e21, "E": 1e18, "P": 1e15, "T": 1e12, "G": 1e9,
        "M": 1e6, "k": 1e3, "h": 1e2, "da": 1e1, "d": 1e-1, "c": 1e-2,
        "m": 1e-3, "u": 1e-6, "µ": 1e-6, "n": 1e-9, "p": 1e-12,
        "f": 1e-15, "a": 1e-18, "z": 1e-21, "y": 1e-24,
        "ki": 2 ** 10, "Mi": 2 ** 20, "Gi": 2 ** 30, "Ti": 2 ** 40,
    }
    _TEMPERATURES = {"C", "cel", "F", "fah", "K", "kel", "Rank", "Reau"}

    def _unit(name):
        if name in _UNITS:
            return _UNITS[name]
        for prefix in sorted(_PREFIXES, key=len, reverse=True):
            base = name[len(prefix):]
            if name.startswith(prefix) and base in _UNITS:
                kind, factor = _UNITS[base]
                power = 2 if kind == "area" and base.endswith("2") else \
                    3 if kind == "volume" and base.endswith("3") else 1
                return kind, factor * _PREFIXES[prefix] ** power
        return None

    def _to_kelvin(v, unit):
        if unit in ("C", "cel"):
            return v + 273.15
        if unit in ("F", "fah"):
            return (v - 32) * 5 / 9 + 273.15
        if unit == "Rank":
            return v * 5 / 9
        if unit == "Reau":
            return v * 1.25 + 273.15
        return v

    def _from_kelvin(k, unit):
        if unit in ("C", "cel"):
            return k - 273.15
        if unit in ("F", "fah"):
            return (k - 273.15) * 9 / 5 + 32
        if unit == "Rank":
            return k * 9 / 5
        if unit == "Reau":
            return (k - 273.15) * 0.8
        return k

    def _CONVERT(n, from_unit, to_unit):
        v, a, b = float(n), str(from_unit), str(to_unit)
        if a in _TEMPERATURES and b in _TEMPERATURES:
            return _from_kelvin(_to_kelvin(v, a), b)
        ua, ub = _unit(a), _unit(b)
        if ua is None or ub is None or ua[0] != ub[0]:
            return "#N/A"
        return v * ua[1] / ub[1]

    # ── Financial functions ─────────────────────────────
    def _PV(rate, nper, pmt, fv=0, type=0):
        r, n = float(rate), int(float(nper))
        p, f, t = float(pmt), float(fv), int(float(type))
        if r == 0:
            return -(p * n + f)
        return -(f / (1 + r) ** n
                 + p * (1 + r * t) * ((1 + r) ** n - 1)
                 / (r * (1 + r) ** n))

    def _FV(rate, nper, pmt, pv=0, type=0):
        r, n = float(rate), int(float(nper))
        p, v, t = float(pmt), float(pv), int(float(type))
        if r == 0:
            return -(v + p * n)
        return -(v * (1 + r) ** n
                 + p * (1 + r * t) * ((1 + r) ** n - 1) / r)

    def _PMT(rate, nper, pv, fv=0, type=0):
        r, n = float(rate), int(float(nper))
        v, f, t = float(pv), float(fv), int(float(type))
        if r == 0:
            return -(v + f) / n
        q = (1 + r) ** n
        return -(r * (f + v * q)) / ((1 + r * t) * (q - 1))

    def _NPER(rate, pmt, pv, fv=0, type=0):
        r, p = float(rate), float(pmt)
        v, f, t = float(pv), float(fv), int(float(type))
        if r == 0:
            return -(v + f) / p
        z = p * (1 + r * t)
        return (math.log((-f * r + z) / (v * r + z))
                / math.log(1 + r))

    def _RATE(nper, pmt, pv, fv=0, type=0, guess=0.1):
        n, p = int(float(nper)), float(pmt)
        v, f, t = float(pv), float(fv), int(float(type))
        r = float(guess)
        for _ in range(100):
            if abs(r) < 1e-10:
                y = v + p * n + f
            else:
                q = (1 + r) ** n
                y = v * q + p * (1 + r * t) * (q - 1) / r + f
            if abs(r) < 1e-10:
                dy = p * n
            else:
                q = (1 + r) ** n
                dq = n * (1 + r) ** (n - 1)
                dy = (v * dq + p * t * (q - 1) / r
                      + p * (1 + r * t)
                      * (dq * r - (q - 1)) / (r * r))
            if abs(dy) < 1e-14:
                break
            r -= y / dy
        return r

    def _IPMT(rate, per, nper, pv, fv=0, type=0):
        r = float(rate)
        p = int(float(per))
        pmt = _PMT(rate, nper, pv, fv, type)
        t = int(float(type))
        if t == 1 and p == 1:
            return 0.0
        bal = float(pv)
        for i in range(1, p):
            if t == 1 and i > 0:
                bal += pmt
            interest = bal * r
            bal += interest + (pmt if t == 0 else 0)
        if t == 1:
            bal_after_pmt = bal + pmt
            return bal_after_pmt * r / (1 + r)
        return bal * r

    def _PPMT(rate, per, nper, pv, fv=0, type=0):
        return (_PMT(rate, nper, pv, fv, type)
                - _IPMT(rate, per, nper, pv, fv, type))

    def _NPV(rate, *args):
        r = float(rate)
        vals = _nums(args)
        return sum(v / (1 + r) ** (i + 1)
                   for i, v in enumerate(vals))

    def _IRR(values, guess=0.1):
        vals = _nums([values])
        r = float(guess)
        for _ in range(200):
            npv = sum(v / (1 + r) ** i
                      for i, v in enumerate(vals))
            dnpv = sum(-i * v / (1 + r) ** (i + 1)
                       for i, v in enumerate(vals))
            if abs(dnpv) < 1e-14:
                break
            r -= npv / dnpv
            if abs(npv) < 1e-10:
                break
        return r

    def _MIRR(values, finance_rate, reinvest_rate):
        vals = _nums([values])
        fr, rr = float(finance_rate), float(reinvest_rate)
        n = len(vals)
        neg = sum(v / (1 + fr) ** i
                  for i, v in enumerate(vals) if v < 0)
        pos = sum(v * (1 + rr) ** (n - 1 - i)
                  for i, v in enumerate(vals) if v > 0)
        if neg == 0:
            return "#DIV/0!"
        return ((-pos / neg) ** (1.0 / (n - 1))
                * (1 + rr) - 1)

    def _XNPV(rate, values, dates):
        r = float(rate)
        vs = _nums([values])
        ds_raw = _flatten([dates])
        d0 = None
        result = 0.0
        for i, (v, d) in enumerate(zip(vs, ds_raw)):
            try:
                dt = _dt.date.fromisoformat(str(d))
            except Exception:
                dt = _dt.date.today()
            if d0 is None:
                d0 = dt
            days = (dt - d0).days
            result += v / (1 + r) ** (days / 365.0)
        return result

    def _XIRR(values, dates, guess=0.1):
        vs = _nums([values])
        ds_raw = _flatten([dates])
        dates_parsed = []
        for d in ds_raw[:len(vs)]:
            try:
                dates_parsed.append(
                    _dt.date.fromisoformat(str(d)))
            except Exception:
                dates_parsed.append(_dt.date.today())
        d0 = (dates_parsed[0] if dates_parsed
              else _dt.date.today())
        r = float(guess)
        for _ in range(200):
            npv = sum(
                v / (1 + r) ** ((d - d0).days / 365.0)
                for v, d in zip(vs, dates_parsed))
            dnpv = sum(
                -((d - d0).days / 365.0)
                * v / (1 + r) ** ((d - d0).days / 365.0 + 1)
                for v, d in zip(vs, dates_parsed))
            if abs(dnpv) < 1e-14:
                break
            r -= npv / dnpv
            if abs(npv) < 1e-10:
                break
        return r

    def _SLN(cost, salvage, life):
        return ((float(cost) - float(salvage))
                / float(life))

    def _SYD(cost, salvage, life, per):
        c, s = float(cost), float(salvage)
        l, p = float(life), float(per)
        return (c - s) * (l - p + 1) * 2 / (l * (l + 1))

    def _DB(cost, salvage, life, period, month=12):
        c, s = float(cost), float(salvage)
        l, p = float(life), float(period)
        m = float(month)
        rate = round(1 - (s / c) ** (1 / l), 3)
        dep = c * rate * m / 12
        if p == 1:
            return dep
        total = dep
        for i in range(2, int(p) + 1):
            if i == int(l) + 1:
                dep = (c - total) * rate * (12 - m) / 12
            else:
                dep = (c - total) * rate
            total += dep
        return dep

    def _DDB(cost, salvage, life, period, factor=2):
        c, s = float(cost), float(salvage)
        l, p = float(life), float(period)
        f = float(factor)
        rate = f / l
        val = c
        for i in range(1, int(p) + 1):
            dep = val * rate
            if val - dep < s:
                dep = val - s
            val -= dep
        return dep

    def _EFFECT(nominal, npery):
        nr, n = float(nominal), int(float(npery))
        return (1 + nr / n) ** n - 1

    def _NOMINAL(effect, npery):
        er, n = float(effect), int(float(npery))
        return n * ((1 + er) ** (1.0 / n) - 1)

    def _ISPMT(rate, per, nper, pv):
        r, p = float(rate), float(per)
        n, v = float(nper), float(pv)
        return v * r * (p / n - 1)

    def _FVSCHEDULE(principal, schedule):
        p = float(principal)
        for r in _nums([schedule]):
            p *= (1 + r)
        return p

    def _DOLLARDE(dollar, fraction):
        d = float(dollar)
        f = int(float(fraction))
        intpart = int(d)
        fracpart = d - intpart
        return intpart + fracpart * 10 ** len(str(f)) / f

    def _DOLLARFR(dollar, fraction):
        d = float(dollar)
        f = int(float(fraction))
        intpart = int(d)
        fracpart = d - intpart
        return intpart + fracpart * f / 10 ** len(str(f))

    # Bond / duration stubs (need day-count conventions)
    def _ACCRINT(*a): return "#N/A"
    def _ACCRINTM(*a): return "#N/A"
    def _DISC(*a): return "#N/A"
    def _DURATION_F(*a): return "#N/A"
    def _MDURATION(*a): return "#N/A"
    def _INTRATE(*a): return "#N/A"
    def _PRICE(*a): return "#N/A"
    def _PRICEDISC(*a): return "#N/A"
    def _PRICEMAT(*a): return "#N/A"
    def _RECEIVED(*a): return "#N/A"
    def _YIELD_F(*a): return "#N/A"
    def _YIELDDISC(*a): return "#N/A"
    def _YIELDMAT(*a): return "#N/A"

    # ── Lookup & Reference ──────────────────────────────
    def _RANGE2D(c1, r1, c2, r2):
        return host._range_values_2d(c1, r1, c2, r2)

    def _ROW(*args):
        if args:
            return int(float(args[0]))
        return 1

    def _COLUMN_F(*args):
        if args:
            return int(float(args[0]))
        return 1

    def _ROWS(array):
        return len(_grid(array))

    def _COLUMNS(array):
        grid = _grid(array)
        return len(grid[0]) if grid else 0

    def _CHOOSE(idx, *args):
        i = int(float(idx))
        if 1 <= i <= len(args):
            return args[i - 1]
        return "#VALUE!"

    def _ADDRESS(row, col, abs_type=1, a1=True, sheet=""):
        r = int(float(row))
        c = int(float(col))
        result = ""
        n = c
        while n > 0:
            n, rem = divmod(n - 1, 26)
            result = chr(65 + rem) + result
        if abs_type == 1:
            ref = f"${result}${r}"
        elif abs_type == 2:
            ref = f"{result}${r}"
        elif abs_type == 3:
            ref = f"${result}{r}"
        else:
            ref = f"{result}{r}"
        if sheet:
            ref = f"{sheet}!{ref}"
        return ref

    def _MATCH(lookup, array, match_type=1):
        vals = _flatten([array])
        mt = int(float(match_type))
        if mt == 0:
            for i, v in enumerate(vals):
                try:
                    if float(v) == float(lookup):
                        return i + 1
                except (ValueError, TypeError):
                    if str(v).lower() == str(lookup).lower():
                        return i + 1
            return "#N/A"
        elif mt == 1:
            last = "#N/A"
            for i, v in enumerate(vals):
                try:
                    if float(v) <= float(lookup):
                        last = i + 1
                    else:
                        break
                except (ValueError, TypeError):
                    pass
            return last
        else:
            last = "#N/A"
            for i, v in enumerate(vals):
                try:
                    if float(v) >= float(lookup):
                        last = i + 1
                    else:
                        break
                except (ValueError, TypeError):
                    pass
            return last

    def _INDEX(array, row_num, col_num=None):
        grid = _grid(array)
        r = int(float(row_num))
        if col_num is None:
            if len(grid) == 1:           # a single row: INDEX(A1:E1, 3)
                r, c = 1, r
            else:
                c = 1
        else:
            c = int(float(col_num))
        if 1 <= r <= len(grid) and 1 <= c <= len(grid[r - 1]):
            return grid[r - 1][c - 1]
        return "#REF!"

    def _SWITCH(expr, *args):
        i = 0
        while i < len(args) - 1:
            try:
                if float(expr) == float(args[i]):
                    return args[i + 1]
            except (ValueError, TypeError):
                if str(expr) == str(args[i]):
                    return args[i + 1]
            i += 2
        if len(args) % 2 == 1:
            return args[-1]
        return "#N/A"

    def _VLOOKUP(lookup, rng, col_idx, approx=True):
        ci = int(float(col_idx))
        table2d = _grid(rng)
        for row in table2d:
            if not row:
                continue
            first = row[0]
            matched = False
            try:
                matched = (float(first) == float(lookup))
            except (ValueError, TypeError):
                matched = (str(first).lower()
                           == str(lookup).lower())
            if matched:
                if 1 <= ci <= len(row):
                    return row[ci - 1]
                return "#REF!"
        if approx and not isinstance(approx, str):
            last_row = None
            for row in table2d:
                if not row:
                    continue
                try:
                    if float(row[0]) <= float(lookup):
                        last_row = row
                    else:
                        break
                except (ValueError, TypeError):
                    pass
            if last_row and 1 <= ci <= len(last_row):
                return last_row[ci - 1]
        return "#N/A"

    def _HLOOKUP(lookup, rng, row_idx, approx=True):
        ri = int(float(row_idx))
        table2d = _grid(rng)
        ncols = max((len(r) for r in table2d), default=0)
        for c in range(ncols):
            first = table2d[0][c] if c < len(table2d[0]) else None
            matched = False
            try:
                matched = (float(first) == float(lookup))
            except (ValueError, TypeError):
                matched = (str(first).lower()
                           == str(lookup).lower())
            if matched:
                if 1 <= ri <= len(table2d):
                    val = (table2d[ri - 1][c]
                           if c < len(table2d[ri - 1]) else None)
                    return val if val is not None else 0
                return "#REF!"
        return "#N/A"

    def _XLOOKUP(lookup, lookup_arr, return_arr,
                 default="#N/A", match_mode=0, search_mode=1):
        lvals = _flatten([lookup_arr])
        rvals = _flatten([return_arr])
        for i, v in enumerate(lvals):
            matched = False
            try:
                matched = (float(v) == float(lookup))
            except (ValueError, TypeError):
                matched = (str(v).lower()
                           == str(lookup).lower())
            if matched:
                return rvals[i] if i < len(rvals) else default
        return default

    def _LOOKUP(lookup, lookup_vec, result_vec=None):
        lvals = _flatten([lookup_vec])
        rvals = (_flatten([result_vec])
                 if result_vec is not None else lvals)
        last = "#N/A"
        for i, v in enumerate(lvals):
            try:
                if float(v) <= float(lookup):
                    last = rvals[i] if i < len(rvals) else "#N/A"
                else:
                    break
            except (ValueError, TypeError):
                pass
        return last

    # ── Statistical ─────────────────────────────────────
    def _MEDIAN(*args):
        v = sorted(_nums(args))
        n = len(v)
        if n == 0:
            return 0
        if n % 2 == 1:
            return v[n // 2]
        return (v[n // 2 - 1] + v[n // 2]) / 2

    def _VAR(*args):
        v = _nums(args)
        if len(v) < 2:
            return 0
        mn = sum(v) / len(v)
        return sum((x - mn) ** 2 for x in v) / (len(v) - 1)

    def _VARP(*args):
        v = _nums(args)
        if len(v) < 1:
            return 0
        mn = sum(v) / len(v)
        return sum((x - mn) ** 2 for x in v) / len(v)

    def _STDEVP(*args):
        return _VARP(*args) ** 0.5

    def _VARA(*args):
        return _VAR(*args)

    def _VARPA(*args):
        return _VARP(*args)

    def _STDEVA(*args):
        return _VAR(*args) ** 0.5

    def _STDEVPA(*args):
        return _VARP(*args) ** 0.5

    def _CORREL(x, y):
        xv = _nums([x])
        yv = _nums([y])
        n = min(len(xv), len(yv))
        if n < 2:
            return 0
        xv, yv = xv[:n], yv[:n]
        mx = sum(xv) / n
        my = sum(yv) / n
        num = sum((a - mx) * (b - my)
                  for a, b in zip(xv, yv))
        dx = (sum((a - mx) ** 2 for a in xv)) ** 0.5
        dy = (sum((b - my) ** 2 for b in yv)) ** 0.5
        return num / (dx * dy) if dx and dy else 0

    def _SLOPE(y, x):
        xv = _nums([x])
        yv = _nums([y])
        n = min(len(xv), len(yv))
        if n < 2:
            return 0
        xv, yv = xv[:n], yv[:n]
        mx = sum(xv) / n
        my = sum(yv) / n
        num = sum((a - mx) * (b - my)
                  for a, b in zip(xv, yv))
        den = sum((a - mx) ** 2 for a in xv)
        return num / den if den else 0

    def _INTERCEPT(y, x):
        xv = _nums([x])
        yv = _nums([y])
        n = min(len(xv), len(yv))
        if n < 2:
            return 0
        xv, yv = xv[:n], yv[:n]
        mx = sum(xv) / n
        my = sum(yv) / n
        sl = _SLOPE(y, x)
        return my - sl * mx

    def _RSQ(y, x):
        r = _CORREL(x, y)
        return r ** 2

    def _FORECAST(new_x, y, x):
        sl = _SLOPE(y, x)
        ic = _INTERCEPT(y, x)
        return sl * float(new_x) + ic

    def _LARGE(array, k):
        v = sorted(_nums([array]), reverse=True)
        ki = int(float(k))
        if 1 <= ki <= len(v):
            return v[ki - 1]
        return "#NUM!"

    def _SMALL(array, k):
        v = sorted(_nums([array]))
        ki = int(float(k))
        if 1 <= ki <= len(v):
            return v[ki - 1]
        return "#NUM!"

    def _RANK(number, ref, order=0):
        n = float(number)
        v = _nums([ref])
        if int(float(order)) == 0:
            v_sorted = sorted(v, reverse=True)
        else:
            v_sorted = sorted(v)
        try:
            return v_sorted.index(n) + 1
        except ValueError:
            return "#N/A"

    def _PERCENTILE(array, k):
        v = sorted(_nums([array]))
        if not v:
            return 0
        ki = float(k)
        idx = ki * (len(v) - 1)
        lo = int(idx)
        hi = min(lo + 1, len(v) - 1)
        frac = idx - lo
        return v[lo] * (1 - frac) + v[hi] * frac

    def _PERCENTRANK(array, x, significance=3):
        v = sorted(_nums([array]))
        xf = float(x)
        if not v:
            return "#NUM!"
        if xf < v[0] or xf > v[-1]:
            return "#NUM!"
        for i, val in enumerate(v):
            if val == xf:
                return (round(i / (len(v) - 1),
                              int(significance))
                        if len(v) > 1 else 0)
            if val > xf:
                frac = (xf - v[i - 1]) / (val - v[i - 1])
                rank = (i - 1 + frac) / (len(v) - 1)
                return round(rank, int(significance))
        return 1.0

    def _QUARTILE(array, quart):
        q = int(float(quart))
        return _PERCENTILE(array, q / 4.0)

    def _MODE(*args):
        v = _nums(args)
        if not v:
            return "#N/A"
        from collections import Counter
        c = Counter(v)
        return c.most_common(1)[0][0]

    def _GEOMEAN(*args):
        v = _nums(args)
        if not v or any(x <= 0 for x in v):
            return "#NUM!"
        product = 1.0
        for x in v:
            product *= x
        return product ** (1.0 / len(v))

    def _HARMEAN(*args):
        v = _nums(args)
        if not v or any(x <= 0 for x in v):
            return "#NUM!"
        return len(v) / sum(1.0 / x for x in v)

    def _TRIMMEAN(array, percent):
        v = sorted(_nums([array]))
        p = float(percent)
        n = len(v)
        if not n:
            return 0
        trim = int(n * p / 2)
        trimmed = v[trim:n - trim] if trim > 0 else v
        return (sum(trimmed) / len(trimmed)
                if trimmed else 0)

    def _AVERAGEIF(rng, criteria, avg_rng=None):
        vals = _flatten([rng])
        avgs = (_flatten([avg_rng])
                if avg_rng is not None else vals)
        total = 0.0
        count = 0
        for i, v in enumerate(vals):
            if _countif_match(v, criteria):
                try:
                    total += (float(avgs[i])
                              if i < len(avgs) else 0)
                    count += 1
                except (ValueError, TypeError):
                    pass
        return total / count if count else "#DIV/0!"

    def _AVERAGEIFS(avg_rng, *args):
        avgs = _flatten([avg_rng])
        if len(args) < 2 or len(args) % 2 != 0:
            return "#VALUE!"
        pairs = []
        for i in range(0, len(args), 2):
            pairs.append((_flatten([args[i]]), args[i + 1]))
        n = min(len(avgs),
                *(len(p[0]) for p in pairs))
        total = 0.0
        count = 0
        for i in range(n):
            if all(_countif_match(p[0][i], p[1])
                   for p in pairs):
                try:
                    total += float(avgs[i])
                    count += 1
                except (ValueError, TypeError):
                    pass
        return total / count if count else "#DIV/0!"

    def _AVERAGEA(*args):
        v = _flatten(args)
        nums = []
        for x in v:
            if x is True:
                nums.append(1)
            elif x is False or x == "":
                continue
            else:
                try:
                    nums.append(float(x))
                except (ValueError, TypeError):
                    nums.append(0)
        return sum(nums) / len(nums) if nums else 0

    def _MAXA(*args):
        v = _flatten(args)
        nums = []
        for x in v:
            if x is True:
                nums.append(1)
            elif x is False:
                nums.append(0)
            elif x == "":
                continue
            else:
                try:
                    nums.append(float(x))
                except (ValueError, TypeError):
                    nums.append(0)
        return max(nums) if nums else 0

    def _MINA(*args):
        v = _flatten(args)
        nums = []
        for x in v:
            if x is True:
                nums.append(1)
            elif x is False:
                nums.append(0)
            elif x == "":
                continue
            else:
                try:
                    nums.append(float(x))
                except (ValueError, TypeError):
                    nums.append(0)
        return min(nums) if nums else 0

    def _FREQUENCY(data, bins):
        dv = sorted(_nums([data]))
        bv = sorted(_nums([bins]))
        result = [0] * (len(bv) + 1)
        for d in dv:
            placed = False
            for i, b in enumerate(bv):
                if d <= b:
                    result[i] += 1
                    placed = True
                    break
            if not placed:
                result[-1] += 1
        return result

    def _LINEST(y, x):
        sl = _SLOPE(y, x)
        ic = _INTERCEPT(y, x)
        return [sl, ic]

    def _TREND(y, x, new_x=None):
        sl = _SLOPE(y, x)
        ic = _INTERCEPT(y, x)
        if new_x is not None:
            nv = _nums([new_x])
        else:
            nv = _nums([x])
        return [sl * v + ic for v in nv]

    # ── Remaining Lookup helpers ────────────────────────
    def _TRANSPOSE(arr):
        if not isinstance(arr, (list, tuple)):
            return arr
        if arr and isinstance(arr[0], (list, tuple)):
            return [list(row) for row in zip(*arr)]
        # 1-D → column vector
        return [[v] for v in arr]

    def _AREAS(*args):
        # Each contiguous range argument counts as one area.
        return len(args) if args else 1

    def _INDIRECT(ref, a1=True):
        # Dynamic reference resolution is not supported in the
        # compiled-expression engine; return the string as-is.
        return str(ref)

    def _OFFSET(ref, rows, cols, height=None, width=None):
        # Dynamic reference shifting is not supported; stub.
        return ref

    def _ROUND(x, n=0):
        # Excel rounds halves away from zero; Python's round() rounds
        # them to even (ROUND(2.5,0) would give 2).
        from decimal import ROUND_HALF_UP, Decimal
        q = Decimal(1).scaleb(-int(n))
        return float(Decimal(repr(float(x))).quantize(
            q, rounding=ROUND_HALF_UP))

    def _INT(x):
        return math.floor(x)    # Excel INT rounds down: -2.5 -> -3

    ns = {"__builtins__": {}, "math": math, "np": np,
          "abs": abs, "round": round, "int": int, "float": float,
          "sum": _SUM, "min": _MINF, "max": _MAXF, "len": len,
          "mean": _mean, "avg": _mean,
          "ABS": abs, "ROUND": _ROUND, "INT": _INT, "FLOAT": float,
          "SUM": _SUM, "MIN": _MINF, "MAX": _MAXF,
          "MEAN": _mean, "AVG": _mean, "AVERAGE": _mean,
          "COUNT": _COUNT, "COUNTA": _COUNTA,
          "STDEV": _STDEV, "SUMSQ": _SUMSQ,
          "PI": _Constant(math.pi), "pi": _Constant(math.pi),
          "sqrt": math.sqrt, "SQRT": math.sqrt,
          "log": math.log, "LOG": math.log,
          "log10": math.log10, "LOG10": math.log10,
          "exp": math.exp, "EXP": math.exp,
          "sin": math.sin, "SIN": math.sin,
          "cos": math.cos, "COS": math.cos,
          "tan": math.tan, "TAN": math.tan,
          "asin": math.asin, "ASIN": math.asin,
          "acos": math.acos, "ACOS": math.acos,
          "atan": math.atan, "ATAN": math.atan,
          "atan2": math.atan2, "ATAN2": math.atan2,
          "sinh": math.sinh, "SINH": math.sinh,
          "cosh": math.cosh, "COSH": math.cosh,
          "tanh": math.tanh, "TANH": math.tanh,
          "asinh": math.asinh, "ASINH": math.asinh,
          "acosh": math.acosh, "ACOSH": math.acosh,
          "atanh": math.atanh, "ATANH": math.atanh,
          # Date & Time
          "DATE": _DATE, "TODAY": _TODAY, "NOW": _NOW,
          "TIME": _TIME, "YEAR": _YEAR, "MONTH": _MONTH,
          "DAY": _DAY, "HOUR": _HOUR, "MINUTE": _MINUTE,
          "SECOND": _SECOND, "DAYS": _DAYS, "WEEKDAY": _WEEKDAY,
          # Text
          "LEFT": _LEFT, "RIGHT": _RIGHT, "MID": _MID,
          "LEN": _LEN, "LOWER": _LOWER, "UPPER": _UPPER,
          "PROPER": _PROPER, "TRIM": _TRIM,
          "CONCAT": _CONCAT, "CONCATENATE": _CONCAT,
          "SUBSTITUTE": _SUBSTITUTE, "REPT": _REPT,
          "FIND": _FIND, "REPLACE": _REPLACE,
          "EXACT": _EXACT, "VALUE": _VALUE, "TEXT": _TEXT,
          # Logical
          "IF": _IF, "AND": _AND, "OR": _OR, "NOT": _NOT,
          "IFERROR": _IFERROR, "IFNA": _IFNA, "IFS": _IFS,
          "XOR": _XOR,
          "TRUE": True, "FALSE": False,
          # Information
          "ISBLANK": _ISBLANK, "ISERROR": _ISERROR,
          "ISERR": _ISERR, "ISNA": _ISNA,
          "ISNUMBER": _ISNUMBER, "ISTEXT": _ISTEXT,
          "ISNONTEXT": _ISNONTEXT, "ISLOGICAL": _ISLOGICAL,
          "ISEVEN": _ISEVEN, "ISODD": _ISODD,
          "ISREF": _ISREF,
          "N": _N, "NA": _NA, "TYPE": _TYPE,
          "ERROR_TYPE": _ERROR_TYPE,
          "COUNTBLANK": _COUNTBLANK,
          "COUNTIF": _COUNTIF, "COUNTIFS": _COUNTIFS,
          "SUMIF": _SUMIF,
          # Engineering / base conversion
          "DEC2HEX": _DEC2HEX, "DEC2BIN": _DEC2BIN,
          "DEC2OCT": _DEC2OCT,
          "HEX2DEC": _HEX2DEC, "HEX2BIN": _HEX2BIN,
          "HEX2OCT": _HEX2OCT,
          "BIN2DEC": _BIN2DEC, "BIN2HEX": _BIN2HEX,
          "BIN2OCT": _BIN2OCT,
          "OCT2DEC": _OCT2DEC, "OCT2BIN": _OCT2BIN,
          "OCT2HEX": _OCT2HEX,
          "DELTA": _DELTA, "GESTEP": _GESTEP,
          "ERF": _ERF, "ERFC": _ERFC,
          # Math extras
          "MOD": _MOD, "POWER": _POWER,
          "QUOTIENT": _QUOTIENT, "SIGN": _SIGN,
          "EVEN": _EVEN, "ODD": _ODD, "FACT": _FACT,
          "GCD": _GCD, "LCM": _LCM,
          "RAND": _RAND, "RANDBETWEEN": _RANDBETWEEN,
          "ROUNDDOWN": _ROUNDDOWN, "ROUNDUP": _ROUNDUP,
          "TRUNC": _TRUNC, "COMBIN": _COMBIN,
          "DEGREES": _DEGREES, "RADIANS": _RADIANS,
          "LN": math.log, "PRODUCT": _PRODUCT,
          # Data Analysis (dots rewritten to underscores).
          "DERIV": _DERIV, "DERIV2": _DERIV2,
          "DERIV_SMOOTH": _DERIV_SMOOTH,
          "TRAPZ": _TRAPZ, "CUMTRAPZ": _CUMTRAPZ,
          "SIMPS": _SIMPS,
          "SAVGOL": _SAVGOL, "MOVAVG": _MOVAVG, "EWMA": _EWMA,
          "LOWPASS": _LOWPASS, "HIGHPASS": _HIGHPASS,
          "BANDPASS": _BANDPASS,
          "MEDIAN_FILTER": _MEDIAN_FILTER,
          "NORM_MAX": _NORM_MAX, "NORM_AREA": _NORM_AREA,
          "NORM_MINMAX": _NORM_MINMAX,
          "NORM_ZSCORE": _NORM_ZSCORE,
          "NORM_PEAK": _NORM_PEAK, "NORM_RANGE": _NORM_RANGE,
          "FFT_MAG": _FFT_MAG, "FFT_PHASE": _FFT_PHASE,
          "FFT_FREQ": _FFT_FREQ, "FFT_REAL": _FFT_REAL,
          "FFT_IMAG": _FFT_IMAG, "IFFT": _IFFT,
          "FFT_POWER": _FFT_POWER,
          "INTERP_LINEAR": _INTERP_LINEAR,
          "INTERP_SPLINE": _INTERP_SPLINE,
          "INTERP_AKIMA": _INTERP_AKIMA,
          "RESAMPLE": _RESAMPLE,
          "FIND_PEAKS": _FIND_PEAKS,
          "FIND_PEAKS_X": _FIND_PEAKS_X,
          "FIND_PEAKS_Y": _FIND_PEAKS_Y,
          "BASELINE_POLY": _BASELINE_POLY,
          "BASELINE_ALS": _BASELINE_ALS,
          # Lookup & Reference
          "ROW": _ROW, "COLUMN": _COLUMN_F,
          "ROWS": _ROWS, "COLUMNS": _COLUMNS,
          "CHOOSE": _CHOOSE, "ADDRESS": _ADDRESS,
          "MATCH": _MATCH, "INDEX": _INDEX,
          "SWITCH": _SWITCH,
          "VLOOKUP": _VLOOKUP, "HLOOKUP": _HLOOKUP,
          "XLOOKUP": _XLOOKUP, "LOOKUP": _LOOKUP,
          "TRANSPOSE": _TRANSPOSE, "AREAS": _AREAS,
          "INDIRECT": _INDIRECT, "OFFSET": _OFFSET,
          # Statistical
          "MEDIAN": _MEDIAN,
          "VAR": _VAR, "VARP": _VARP,
          "STDEVP": _STDEVP,
          "VARA": _VARA, "VARPA": _VARPA,
          "STDEVA": _STDEVA, "STDEVPA": _STDEVPA,
          "CORREL": _CORREL,
          "SLOPE": _SLOPE, "INTERCEPT": _INTERCEPT,
          "RSQ": _RSQ, "FORECAST": _FORECAST,
          "LARGE": _LARGE, "SMALL": _SMALL,
          "RANK": _RANK,
          "PERCENTILE": _PERCENTILE,
          "PERCENTRANK": _PERCENTRANK,
          "QUARTILE": _QUARTILE,
          "MODE": _MODE,
          "GEOMEAN": _GEOMEAN, "HARMEAN": _HARMEAN,
          "TRIMMEAN": _TRIMMEAN,
          "AVERAGEIF": _AVERAGEIF,
          "AVERAGEIFS": _AVERAGEIFS,
          "AVERAGEA": _AVERAGEA,
          "MAXA": _MAXA, "MINA": _MINA,
          "FREQUENCY": _FREQUENCY,
          "LINEST": _LINEST, "TREND": _TREND,
          # Financial
          "PV": _PV, "FV": _FV, "PMT": _PMT,
          "NPER": _NPER, "RATE": _RATE,
          "IPMT": _IPMT, "PPMT": _PPMT,
          "NPV": _NPV, "IRR": _IRR, "MIRR": _MIRR,
          "XNPV": _XNPV, "XIRR": _XIRR,
          "SLN": _SLN, "SYD": _SYD,
          "DB": _DB, "DDB": _DDB,
          "EFFECT": _EFFECT, "NOMINAL": _NOMINAL,
          "ISPMT": _ISPMT, "FVSCHEDULE": _FVSCHEDULE,
          "DOLLARDE": _DOLLARDE, "DOLLARFR": _DOLLARFR,
          "ACCRINT": _ACCRINT, "ACCRINTM": _ACCRINTM,
          "DISC": _DISC, "DURATION": _DURATION_F,
          "MDURATION": _MDURATION,
          "INTRATE": _INTRATE,
          "PRICE": _PRICE, "PRICEDISC": _PRICEDISC,
          "PRICEMAT": _PRICEMAT,
          "RECEIVED": _RECEIVED,
          "YIELD": _YIELD_F, "YIELDDISC": _YIELDDISC,
          "YIELDMAT": _YIELDMAT,
          # Text (new)
          "CHAR": _CHAR, "CODE": _CODE, "CLEAN": _CLEAN,
          "T": _T, "DOLLAR": _DOLLAR_F, "FIXED": _FIXED,
          "NUMBERVALUE": _NUMBERVALUE, "SEARCH": _SEARCH,
          "TEXTJOIN": _TEXTJOIN,
          "UNICHAR": _UNICHAR, "UNICODE": _UNICODE,
          # Date & Time (new)
          "DATEVALUE": _DATEVALUE, "TIMEVALUE": _TIMEVALUE,
          "EDATE": _EDATE, "EOMONTH": _EOMONTH,
          "WEEKNUM": _WEEKNUM, "ISOWEEKNUM": _ISOWEEKNUM,
          "YEARFRAC": _YEARFRAC, "DAYS360": _DAYS360,
          "NETWORKDAYS": _NETWORKDAYS, "WORKDAY": _WORKDAY,
          "NETWORKDAYS_INTL": _NETWORKDAYS_INTL,
          "WORKDAY_INTL": _WORKDAY_INTL,
          # Math & Trig (new)
          "ACOT": _ACOT, "ACOTH": _ACOTH,
          "COT": _COT, "COTH": _COTH,
          "CSC": _CSC, "CSCH": _CSCH,
          "SEC": _SEC, "SECH": _SECH,
          "SQRTPI": _SQRTPI,
          "BASE": _BASE, "DECIMAL": _DECIMAL,
          "FACTDOUBLE": _FACTDOUBLE,
          "CEILING_MATH": _CEILING_MATH,
          "CEILING.MATH": _CEILING_MATH,
          "FLOOR_MATH": _FLOOR_MATH,
          "FLOOR.MATH": _FLOOR_MATH,
          "MROUND": _MROUND,
          "MULTINOMIAL": _MULTINOMIAL,
          "COMBINA": _COMBINA, "ROMAN": _ROMAN,
          "SUMPRODUCT": _SUMPRODUCT,
          "SUMIFS": _SUMIFS,
          "SUMX2MY2": _SUMX2MY2,
          "SUMX2PY2": _SUMX2PY2,
          "SUMXMY2": _SUMXMY2,
          "SUBTOTAL": _SUBTOTAL,
          "MDETERM": _MDETERM, "MINVERSE": _MINVERSE,
          "MMULT": _MMULT,
          # Engineering — complex numbers (new)
          "COMPLEX": _COMPLEX,
          "IMREAL": _IMREAL, "IMAGINARY": _IMAGINARY,
          "IMABS": _IMABS, "IMARGUMENT": _IMARGUMENT,
          "IMCONJUGATE": _IMCONJUGATE,
          "IMCOS": _IMCOS, "IMSIN": _IMSIN,
          "IMEXP": _IMEXP, "IMLN": _IMLN,
          "IMLOG10": _IMLOG10, "IMLOG2": _IMLOG2,
          "IMPOWER": _IMPOWER, "IMSQRT": _IMSQRT,
          "IMSUM": _IMSUM, "IMSUB": _IMSUB,
          "IMPRODUCT": _IMPRODUCT, "IMDIV": _IMDIV,
          "CONVERT": _CONVERT,
                  "CEILING": _CEILING, "FLOOR": _FLOOR,
                  # Runtime helpers of the compiler: & and lazy IFs.
                  "_JOIN": _JOIN, "_LAZY": _Lazy,
          # Compiled-formula runtime helpers (read live values).
          "_C": host._cell_val,
          "_CR": host._cell_raw,
          "_AGG": host._agg_range,
          "_COL": host._agg_col,
          "_RANGE": host._range_values,
          "_RANGE2D": host._range_values_2d,
          "_XC": host._XC,
          "_XRANGE": host._XRANGE,
          }
    return ns


def lower_names(ns):
    """Case-insensitive lookup table: lower-case name → canonical name."""
    lower = {}
    for name in ns:
        lower.setdefault(name.lower(), name)
    return lower
