"""The function catalogue: categories, order and help text.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

# ── Function catalog ─────────────────────────────────────────────────
# Each category maps to a sorted list of function names.
# These mirror Excel's Function Library ribbon categories.

FUNCTION_CATEGORIES = {
    "Math && Trig": [
        "ABS", "ACOS", "ACOSH", "ACOT", "ACOTH",
        "ASIN", "ASINH", "ATAN", "ATAN2", "ATANH",
        "BASE", "CEILING.MATH",
        "COMBIN", "COMBINA", "COS", "COSH", "COT", "COTH",
        "CSC", "CSCH", "DECIMAL", "DEGREES",
        "EVEN", "EXP", "FACT", "FACTDOUBLE",
        "FLOOR.MATH", "GCD", "INT", "LCM",
        "LN", "LOG", "LOG10",
        "MDETERM", "MINVERSE", "MMULT",
        "MOD", "MROUND", "MULTINOMIAL",
        "ODD", "PI", "POWER", "PRODUCT",
        "QUOTIENT", "RADIANS", "RAND", "RANDBETWEEN",
        "ROMAN", "ROUND", "ROUNDDOWN", "ROUNDUP",
        "SEC", "SECH", "SIGN", "SIN", "SINH",
        "SQRT", "SQRTPI",
        "SUBTOTAL", "SUM", "SUMIF", "SUMIFS", "SUMPRODUCT",
        "SUMSQ", "SUMX2MY2", "SUMX2PY2", "SUMXMY2",
        "TAN", "TANH", "TRUNC",
    ],
    "Text": [
        "CHAR", "CLEAN", "CODE", "CONCAT", "CONCATENATE",
        "DOLLAR", "EXACT", "FIND",
        "FIXED", "LEFT", "LEN", "LOWER",
        "MID", "NUMBERVALUE", "PROPER",
        "REPLACE", "REPT", "RIGHT",
        "SEARCH", "SUBSTITUTE",
        "T", "TEXT", "TEXTJOIN",
        "TRIM", "UNICHAR", "UNICODE",
        "UPPER", "VALUE",
    ],
    "Date && Time": [
        "DATE", "DATEVALUE", "DAY", "DAYS", "DAYS360",
        "EDATE", "EOMONTH",
        "HOUR", "ISOWEEKNUM",
        "MINUTE", "MONTH",
        "NETWORKDAYS", "NETWORKDAYS.INTL",
        "NOW", "SECOND",
        "TIME", "TIMEVALUE", "TODAY",
        "WEEKDAY", "WEEKNUM",
        "WORKDAY", "WORKDAY.INTL",
        "YEAR", "YEARFRAC",
    ],
    "Logical": [
        "AND", "FALSE", "IF", "IFERROR", "IFNA",
        "IFS", "NOT", "OR",
        "SWITCH", "TRUE", "XOR",
    ],
    "Lookup && Reference": [
        "ADDRESS", "AREAS", "CHOOSE",
        "COLUMN", "COLUMNS",
        "HLOOKUP", "INDEX",
        "INDIRECT", "LOOKUP", "MATCH",
        "OFFSET", "ROW", "ROWS",
        "TRANSPOSE", "VLOOKUP", "XLOOKUP",
    ],
    "Financial": [
        "ACCRINT", "ACCRINTM",
        "DB", "DDB",
        "DISC", "DOLLARDE", "DOLLARFR",
        "DURATION", "EFFECT",
        "FV", "FVSCHEDULE",
        "INTRATE", "IPMT", "IRR",
        "ISPMT",
        "MDURATION", "MIRR",
        "NOMINAL", "NPER", "NPV",
        "PMT", "PPMT", "PRICE", "PRICEDISC", "PRICEMAT",
        "PV", "RATE", "RECEIVED",
        "SLN", "SYD",
        "XIRR", "XNPV",
        "YIELD", "YIELDDISC", "YIELDMAT",
    ],
    "Statistical": [
        "AVERAGE", "AVERAGEA", "AVERAGEIF", "AVERAGEIFS",
        "CORREL", "COUNT", "COUNTA", "COUNTBLANK",
        "COUNTIF", "COUNTIFS",
        "FORECAST", "FREQUENCY",
        "GEOMEAN", "HARMEAN",
        "INTERCEPT",
        "LARGE", "LINEST",
        "MAX", "MAXA", "MEDIAN", "MIN", "MINA", "MODE",
        "PERCENTILE", "PERCENTRANK",
        "QUARTILE", "RANK",
        "RSQ", "SLOPE", "SMALL",
        "STDEV", "STDEVA", "STDEVP", "STDEVPA",
        "TREND", "TRIMMEAN",
        "VAR", "VARA", "VARP", "VARPA",
    ],
    "Engineering": [
        "BIN2DEC", "BIN2HEX", "BIN2OCT",
        "COMPLEX", "CONVERT",
        "DEC2BIN", "DEC2HEX", "DEC2OCT", "DELTA",
        "ERF", "ERFC",
        "GESTEP",
        "HEX2BIN", "HEX2DEC", "HEX2OCT",
        "IMABS", "IMAGINARY", "IMARGUMENT",
        "IMCONJUGATE", "IMCOS", "IMDIV",
        "IMEXP", "IMLN", "IMLOG10", "IMLOG2",
        "IMPOWER", "IMPRODUCT", "IMREAL",
        "IMSIN", "IMSQRT", "IMSUB", "IMSUM",
        "OCT2BIN", "OCT2DEC", "OCT2HEX",
    ],
    "Information": [
        "ERROR.TYPE", "ISBLANK", "ISERR", "ISERROR",
        "ISEVEN", "ISLOGICAL", "ISNA",
        "ISNONTEXT", "ISNUMBER", "ISODD",
        "ISREF", "ISTEXT",
        "N", "NA", "TYPE",
    ],
    "Data Analysis": [
        # ── Derivative ──
        "DERIV", "DERIV2", "DERIV.SMOOTH",
        # ── Integration ──
        "TRAPZ", "CUMTRAPZ", "SIMPS",
        # ── Smoothing & filtering ──
        "SAVGOL", "MOVAVG", "EWMA",
        "LOWPASS", "HIGHPASS", "BANDPASS",
        "MEDIAN.FILTER",
        # ── Normalisation ──
        "NORM.MAX", "NORM.AREA", "NORM.MINMAX", "NORM.ZSCORE",
        "NORM.PEAK", "NORM.RANGE",
        # ── FFT / spectral ──
        "FFT.MAG", "FFT.PHASE", "FFT.FREQ",
        "FFT.REAL", "FFT.IMAG", "IFFT",
        "FFT.POWER",
        # ── Interpolation & resampling ──
        "INTERP.LINEAR", "INTERP.SPLINE", "INTERP.AKIMA",
        "RESAMPLE",
        # ── Peak detection ──
        "FIND.PEAKS", "FIND.PEAKS.X", "FIND.PEAKS.Y",
        # ── Baseline ──
        "BASELINE.POLY", "BASELINE.ALS",
    ],
}

# Order for the menu (matches Excel's ribbon left-to-right).
CATEGORY_ORDER = [
    "Math && Trig", "Text", "Date && Time",
    "Logical", "Lookup && Reference", "Financial",
    "Statistical", "Engineering", "Information",
    "Data Analysis",
]

# ── Function help (syntax + one-line description) ────────────────────
# Shown as tooltip when hovering over a function in the menu.

FUNCTION_HELP = {
    # ── Math & Trig ──────────────────────────────────────────────
    "ABS":          "ABS(number)\nReturns the absolute value of a number.",
    "ACOS":         "ACOS(number)\nReturns the arccosine of a number, in radians.",
    "ACOSH":        "ACOSH(number)\nReturns the inverse hyperbolic cosine.",
    "ACOT":         "ACOT(number)\nReturns the arccotangent of a number.",
    "ACOTH":        "ACOTH(number)\nReturns the inverse hyperbolic cotangent.",
    "ASIN":         "ASIN(number)\nReturns the arcsine of a number, in radians.",
    "ASINH":        "ASINH(number)\nReturns the inverse hyperbolic sine.",
    "ATAN":         "ATAN(number)\nReturns the arctangent of a number, in radians.",
    "ATAN2":        "ATAN2(x, y)\nReturns the arctangent from x and y coordinates.",
    "ATANH":        "ATANH(number)\nReturns the inverse hyperbolic tangent.",
    "BASE":         "BASE(number, radix, [min_length])\nConverts a number to text in a given base.",
    "CEILING.MATH": "CEILING.MATH(number, [significance], [mode])\nRounds a number up to the nearest multiple.",
    "COMBIN":       "COMBIN(n, k)\nReturns the number of combinations.",
    "COMBINA":      "COMBINA(n, k)\nReturns the number of combinations with repetitions.",
    "COS":          "COS(number)\nReturns the cosine of an angle (radians).",
    "COSH":         "COSH(number)\nReturns the hyperbolic cosine.",
    "COT":          "COT(number)\nReturns the cotangent of an angle.",
    "COTH":         "COTH(number)\nReturns the hyperbolic cotangent.",
    "CSC":          "CSC(number)\nReturns the cosecant of an angle.",
    "CSCH":         "CSCH(number)\nReturns the hyperbolic cosecant.",
    "DECIMAL":      "DECIMAL(text, radix)\nConverts a text representation in a given base to decimal.",
    "DEGREES":      "DEGREES(angle)\nConverts radians to degrees.",
    "EVEN":         "EVEN(number)\nRounds a number up to the nearest even integer.",
    "EXP":          "EXP(number)\nReturns e raised to the power of number.",
    "FACT":         "FACT(number)\nReturns the factorial of a number.",
    "FACTDOUBLE":   "FACTDOUBLE(number)\nReturns the double factorial of a number.",
    "FLOOR.MATH":   "FLOOR.MATH(number, [significance], [mode])\nRounds a number down to the nearest multiple.",
    "GCD":          "GCD(number1, number2, ...)\nReturns the greatest common divisor.",
    "INT":          "INT(number)\nRounds a number down to the nearest integer.",
    "LCM":          "LCM(number1, number2, ...)\nReturns the least common multiple.",
    "LN":           "LN(number)\nReturns the natural logarithm of a number.",
    "LOG":          "LOG(number, [base])\nReturns the logarithm of a number to a specified base.",
    "LOG10":        "LOG10(number)\nReturns the base-10 logarithm.",
    "MDETERM":      "MDETERM(array)\nReturns the matrix determinant of an array.",
    "MINVERSE":     "MINVERSE(array)\nReturns the inverse matrix of an array.",
    "MMULT":        "MMULT(array1, array2)\nReturns the matrix product of two arrays.",
    "MOD":          "MOD(number, divisor)\nReturns the remainder from division.",
    "MROUND":       "MROUND(number, multiple)\nRounds a number to the nearest specified multiple.",
    "MULTINOMIAL":  "MULTINOMIAL(number1, number2, ...)\nReturns the multinomial of a set of numbers.",
    "ODD":          "ODD(number)\nRounds a number up to the nearest odd integer.",
    "PI":           "PI()\nReturns the value of pi (3.14159...).",
    "POWER":        "POWER(number, power)\nReturns the result of a number raised to a power.",
    "PRODUCT":      "PRODUCT(number1, number2, ...)\nMultiplies all the numbers given as arguments.",
    "QUOTIENT":     "QUOTIENT(numerator, denominator)\nReturns the integer portion of a division.",
    "RADIANS":      "RADIANS(angle)\nConverts degrees to radians.",
    "RAND":         "RAND()\nReturns a random number between 0 and 1.",
    "RANDBETWEEN":  "RANDBETWEEN(bottom, top)\nReturns a random integer between two values.",
    "ROMAN":        "ROMAN(number)\nConverts an arabic numeral to Roman text.",
    "ROUND":        "ROUND(number, num_digits)\nRounds a number to a specified number of digits.",
    "ROUNDDOWN":    "ROUNDDOWN(number, num_digits)\nRounds a number down, toward zero.",
    "ROUNDUP":      "ROUNDUP(number, num_digits)\nRounds a number up, away from zero.",
    "SEC":          "SEC(number)\nReturns the secant of an angle.",
    "SECH":         "SECH(number)\nReturns the hyperbolic secant.",
    "SIGN":         "SIGN(number)\nReturns the sign of a number (+1, 0, or -1).",
    "SIN":          "SIN(number)\nReturns the sine of an angle (radians).",
    "SINH":         "SINH(number)\nReturns the hyperbolic sine.",
    "SQRT":         "SQRT(number)\nReturns the positive square root.",
    "SQRTPI":       "SQRTPI(number)\nReturns the square root of (number * pi).",
    "SUBTOTAL":     "SUBTOTAL(function_num, ref1, ...)\nReturns a subtotal in a list or database.",
    "SUM":          "SUM(number1, number2, ...)\nAdds all the numbers in a range of cells.",
    "SUMIF":        "SUMIF(range, criteria, [sum_range])\nAdds cells specified by a given condition.",
    "SUMIFS":       "SUMIFS(sum_range, criteria_range1, criteria1, ...)\nAdds cells that meet multiple criteria.",
    "SUMPRODUCT":   "SUMPRODUCT(array1, array2, ...)\nReturns the sum of products of corresponding arrays.",
    "SUMSQ":        "SUMSQ(number1, number2, ...)\nReturns the sum of the squares of the arguments.",
    "SUMX2MY2":     "SUMX2MY2(array_x, array_y)\nReturns the sum of differences of squares.",
    "SUMX2PY2":     "SUMX2PY2(array_x, array_y)\nReturns the sum of sums of squares.",
    "SUMXMY2":      "SUMXMY2(array_x, array_y)\nReturns the sum of squares of differences.",
    "TAN":          "TAN(number)\nReturns the tangent of an angle (radians).",
    "TANH":         "TANH(number)\nReturns the hyperbolic tangent.",
    "TRUNC":        "TRUNC(number, [num_digits])\nTruncates a number to an integer.",

    # ── Text ─────────────────────────────────────────────────────
    "CHAR":         "CHAR(number)\nReturns the character specified by the code number.",
    "CLEAN":        "CLEAN(text)\nRemoves all non-printable characters from text.",
    "CODE":         "CODE(text)\nReturns a numeric code for the first character.",
    "CONCAT":       "CONCAT(text1, text2, ...)\nJoins several text strings into one.",
    "CONCATENATE":  "CONCATENATE(text1, text2, ...)\nJoins several text strings into one.",
    "DOLLAR":       "DOLLAR(number, [decimals])\nConverts a number to text in currency format.",
    "EXACT":        "EXACT(text1, text2)\nChecks whether two text strings are identical (case-sensitive).",
    "FIND":         "FIND(find_text, within_text, [start_num])\nFinds one text string within another (case-sensitive).",
    "FIXED":        "FIXED(number, [decimals], [no_commas])\nFormats a number as text with a fixed number of decimals.",
    "LEFT":         "LEFT(text, [num_chars])\nReturns the leftmost characters from a text value.",
    "LEN":          "LEN(text)\nReturns the number of characters in a text string.",
    "LOWER":        "LOWER(text)\nConverts text to lowercase.",
    "MID":          "MID(text, start_num, num_chars)\nReturns characters from the middle of a text string.",
    "NUMBERVALUE":  "NUMBERVALUE(text, [decimal_sep], [group_sep])\nConverts text to number, locale-independent.",
    "PROPER":       "PROPER(text)\nCapitalises the first letter of each word in text.",
    "REPLACE":      "REPLACE(old_text, start_num, num_chars, new_text)\nReplaces characters within text.",
    "REPT":         "REPT(text, number_times)\nRepeats text a given number of times.",
    "RIGHT":        "RIGHT(text, [num_chars])\nReturns the rightmost characters from a text value.",
    "SEARCH":       "SEARCH(find_text, within_text, [start_num])\nFinds one text string within another (case-insensitive).",
    "SUBSTITUTE":   "SUBSTITUTE(text, old_text, new_text, [instance_num])\nSubstitutes new text for old text.",
    "T":            "T(value)\nConverts its argument to text.",
    "TEXT":         "TEXT(value, format_text)\nFormats a number as text with a given format.",
    "TEXTJOIN":     "TEXTJOIN(delimiter, ignore_empty, text1, ...)\nJoins text with a delimiter.",
    "TRIM":         "TRIM(text)\nRemoves extra spaces from text.",
    "UNICHAR":      "UNICHAR(number)\nReturns the Unicode character for the given number.",
    "UNICODE":      "UNICODE(text)\nReturns the Unicode number for the first character.",
    "UPPER":        "UPPER(text)\nConverts text to uppercase.",
    "VALUE":        "VALUE(text)\nConverts a text string that represents a number to a number.",

    # ── Date & Time ──────────────────────────────────────────────
    "DATE":             "DATE(year, month, day)\nReturns the serial number of a date.",
    "DATEVALUE":        "DATEVALUE(date_text)\nConverts a date in text form to a serial number.",
    "DAY":              "DAY(serial_number)\nReturns the day of the month (1-31).",
    "DAYS":             "DAYS(end_date, start_date)\nReturns the number of days between two dates.",
    "DAYS360":          "DAYS360(start_date, end_date, [method])\nReturns the number of days (360-day year).",
    "EDATE":            "EDATE(start_date, months)\nReturns the date a given number of months away.",
    "EOMONTH":          "EOMONTH(start_date, months)\nReturns the last day of the month, months away.",
    "HOUR":             "HOUR(serial_number)\nReturns the hour component of a time.",
    "ISOWEEKNUM":       "ISOWEEKNUM(date)\nReturns the ISO week number of the year.",
    "MINUTE":           "MINUTE(serial_number)\nReturns the minute component of a time.",
    "MONTH":            "MONTH(serial_number)\nReturns the month component (1-12).",
    "NETWORKDAYS":      "NETWORKDAYS(start_date, end_date, [holidays])\nReturns the number of working days.",
    "NETWORKDAYS.INTL": "NETWORKDAYS.INTL(start_date, end_date, [weekend], [holidays])\nReturns working days with custom weekends.",
    "NOW":              "NOW()\nReturns the current date and time.",
    "SECOND":           "SECOND(serial_number)\nReturns the second component of a time.",
    "TIME":             "TIME(hour, minute, second)\nReturns the serial number of a time.",
    "TIMEVALUE":        "TIMEVALUE(time_text)\nConverts a time in text form to a serial number.",
    "TODAY":            "TODAY()\nReturns today's date.",
    "WEEKDAY":          "WEEKDAY(serial_number, [return_type])\nReturns the day of the week.",
    "WEEKNUM":          "WEEKNUM(serial_number, [return_type])\nReturns the week number in the year.",
    "WORKDAY":          "WORKDAY(start_date, days, [holidays])\nReturns the date after a number of workdays.",
    "WORKDAY.INTL":     "WORKDAY.INTL(start_date, days, [weekend], [holidays])\nReturns workday date with custom weekends.",
    "YEAR":             "YEAR(serial_number)\nReturns the year component of a date.",
    "YEARFRAC":         "YEARFRAC(start_date, end_date, [basis])\nReturns the fraction of the year between two dates.",

    # ── Logical ──────────────────────────────────────────────────
    "AND":      "AND(logical1, logical2, ...)\nReturns TRUE if all arguments are TRUE.",
    "FALSE":    "FALSE()\nReturns the logical value FALSE.",
    "IF":       "IF(logical_test, value_if_true, [value_if_false])\nReturns one value if true, another if false.",
    "IFERROR":  "IFERROR(value, value_if_error)\nReturns value_if_error if the expression is an error.",
    "IFNA":     "IFNA(value, value_if_na)\nReturns value_if_na if the expression is #N/A.",
    "IFS":      "IFS(logical_test1, value1, ...)\nChecks multiple conditions, returns first TRUE match.",
    "NOT":      "NOT(logical)\nReverses the logic of its argument.",
    "OR":       "OR(logical1, logical2, ...)\nReturns TRUE if any argument is TRUE.",
    "SWITCH":   "SWITCH(expression, value1, result1, ...)\nEvaluates expression against a list of values.",
    "TRUE":     "TRUE()\nReturns the logical value TRUE.",
    "XOR":      "XOR(logical1, logical2, ...)\nReturns TRUE if an odd number of arguments are TRUE.",

    # ── Lookup & Reference ───────────────────────────────────────
    "ADDRESS":   "ADDRESS(row, column, [abs], [a1], [sheet])\nReturns a cell reference as text.",
    "AREAS":     "AREAS(reference)\nReturns the number of areas in a reference.",
    "CHOOSE":    "CHOOSE(index_num, value1, value2, ...)\nChooses a value from a list based on index.",
    "COLUMN":    "COLUMN([reference])\nReturns the column number of a reference.",
    "COLUMNS":   "COLUMNS(array)\nReturns the number of columns in an array.",
    "HLOOKUP":   "HLOOKUP(lookup_value, table_array, row_index, [range_lookup])\nSearches the first row and returns a value.",
    "INDEX":     "INDEX(array, row_num, [col_num])\nReturns the value of an element in a table.",
    "INDIRECT":  "INDIRECT(ref_text, [a1])\nReturns the reference specified by a text string.",
    "LOOKUP":    "LOOKUP(lookup_value, lookup_vector, [result_vector])\nLooks up a value in a range.",
    "MATCH":     "MATCH(lookup_value, lookup_array, [match_type])\nSearches for a value and returns its position.",
    "OFFSET":    "OFFSET(reference, rows, cols, [height], [width])\nReturns a reference offset from a given reference.",
    "ROW":       "ROW([reference])\nReturns the row number of a reference.",
    "ROWS":      "ROWS(array)\nReturns the number of rows in an array.",
    "TRANSPOSE": "TRANSPOSE(array)\nTransposes rows and columns of an array.",
    "VLOOKUP":   "VLOOKUP(lookup_value, table_array, col_index, [range_lookup])\nSearches the first column and returns a value.",
    "XLOOKUP":   "XLOOKUP(lookup_value, lookup_array, return_array, ...)\nSearches a range and returns a matching item.",

    # ── Financial ────────────────────────────────────────────────
    "ACCRINT":    "ACCRINT(issue, first_interest, settlement, rate, par, frequency, ...)\nReturns accrued interest for a periodic coupon.",
    "ACCRINTM":   "ACCRINTM(issue, settlement, rate, par, [basis])\nReturns accrued interest at maturity.",
    "DB":         "DB(cost, salvage, life, period, [month])\nReturns fixed-declining balance depreciation.",
    "DDB":        "DDB(cost, salvage, life, period, [factor])\nReturns double-declining balance depreciation.",
    "DISC":       "DISC(settlement, maturity, pr, redemption, [basis])\nReturns the discount rate for a security.",
    "DOLLARDE":   "DOLLARDE(fractional_dollar, fraction)\nConverts a fractional dollar price to decimal.",
    "DOLLARFR":   "DOLLARFR(decimal_dollar, fraction)\nConverts a decimal dollar price to fractional.",
    "DURATION":   "DURATION(settlement, maturity, coupon, yld, frequency, [basis])\nReturns the Macauley duration.",
    "EFFECT":     "EFFECT(nominal_rate, npery)\nReturns the effective annual interest rate.",
    "FV":         "FV(rate, nper, pmt, [pv], [type])\nReturns the future value of an investment.",
    "FVSCHEDULE": "FVSCHEDULE(principal, schedule)\nReturns future value with variable interest rates.",
    "INTRATE":    "INTRATE(settlement, maturity, investment, redemption, [basis])\nReturns the interest rate for a fully invested security.",
    "IPMT":       "IPMT(rate, per, nper, pv, [fv], [type])\nReturns the interest payment for a given period.",
    "IRR":        "IRR(values, [guess])\nReturns the internal rate of return.",
    "ISPMT":      "ISPMT(rate, per, nper, pv)\nReturns the interest paid during a specific period.",
    "MDURATION":  "MDURATION(settlement, maturity, coupon, yld, frequency, [basis])\nReturns the modified Macauley duration.",
    "MIRR":       "MIRR(values, finance_rate, reinvest_rate)\nReturns the modified internal rate of return.",
    "NOMINAL":    "NOMINAL(effect_rate, npery)\nReturns the annual nominal interest rate.",
    "NPER":       "NPER(rate, pmt, pv, [fv], [type])\nReturns the number of periods for an investment.",
    "NPV":        "NPV(rate, value1, value2, ...)\nReturns the net present value of an investment.",
    "PMT":        "PMT(rate, nper, pv, [fv], [type])\nReturns the periodic payment for an annuity.",
    "PPMT":       "PPMT(rate, per, nper, pv, [fv], [type])\nReturns the principal payment for a given period.",
    "PRICE":      "PRICE(settlement, maturity, rate, yld, redemption, frequency, [basis])\nReturns the price per $100 face value.",
    "PRICEDISC":  "PRICEDISC(settlement, maturity, discount, redemption, [basis])\nReturns the price of a discounted security.",
    "PRICEMAT":   "PRICEMAT(settlement, maturity, issue, rate, yld, [basis])\nReturns the price of a security that pays interest at maturity.",
    "PV":         "PV(rate, nper, pmt, [fv], [type])\nReturns the present value of an investment.",
    "RATE":       "RATE(nper, pmt, pv, [fv], [type], [guess])\nReturns the interest rate per period.",
    "RECEIVED":   "RECEIVED(settlement, maturity, investment, discount, [basis])\nReturns the amount received at maturity.",
    "SLN":        "SLN(cost, salvage, life)\nReturns straight-line depreciation for one period.",
    "SYD":        "SYD(cost, salvage, life, per)\nReturns sum-of-years' digits depreciation.",
    "XIRR":       "XIRR(values, dates, [guess])\nReturns the IRR for a schedule of cash flows.",
    "XNPV":       "XNPV(rate, values, dates)\nReturns the NPV for a schedule of cash flows.",
    "YIELD":      "YIELD(settlement, maturity, rate, pr, redemption, frequency, [basis])\nReturns the yield on a security.",
    "YIELDDISC":  "YIELDDISC(settlement, maturity, pr, redemption, [basis])\nReturns the yield on a discounted security.",
    "YIELDMAT":   "YIELDMAT(settlement, maturity, issue, rate, pr, [basis])\nReturns the yield of a security that pays interest at maturity.",

    # ── Statistical ──────────────────────────────────────────────
    "AVERAGE":     "AVERAGE(number1, number2, ...)\nReturns the arithmetic mean of the arguments.",
    "AVERAGEA":    "AVERAGEA(value1, value2, ...)\nReturns the average, including text and logicals.",
    "AVERAGEIF":   "AVERAGEIF(range, criteria, [average_range])\nAverages cells that meet a condition.",
    "AVERAGEIFS":  "AVERAGEIFS(average_range, criteria_range1, criteria1, ...)\nAverages cells that meet multiple criteria.",
    "CORREL":      "CORREL(array1, array2)\nReturns the correlation coefficient between two data sets.",
    "COUNT":       "COUNT(value1, value2, ...)\nCounts cells that contain numbers.",
    "COUNTA":      "COUNTA(value1, value2, ...)\nCounts cells that are not empty.",
    "COUNTBLANK":  "COUNTBLANK(range)\nCounts empty cells in a range.",
    "COUNTIF":     "COUNTIF(range, criteria)\nCounts cells that meet a condition.",
    "COUNTIFS":    "COUNTIFS(criteria_range1, criteria1, ...)\nCounts cells that meet multiple criteria.",
    "FORECAST":    "FORECAST(x, known_y's, known_x's)\nReturns a predicted value based on linear regression.",
    "FREQUENCY":   "FREQUENCY(data_array, bins_array)\nReturns a frequency distribution as a vertical array.",
    "GEOMEAN":     "GEOMEAN(number1, number2, ...)\nReturns the geometric mean.",
    "HARMEAN":     "HARMEAN(number1, number2, ...)\nReturns the harmonic mean.",
    "INTERCEPT":   "INTERCEPT(known_y's, known_x's)\nReturns the intercept of the linear regression line.",
    "LARGE":       "LARGE(array, k)\nReturns the k-th largest value in a data set.",
    "LINEST":      "LINEST(known_y's, [known_x's], [const], [stats])\nReturns statistics for a linear trend.",
    "MAX":         "MAX(number1, number2, ...)\nReturns the maximum value in a list.",
    "MAXA":        "MAXA(value1, value2, ...)\nReturns the maximum, including text and logicals.",
    "MEDIAN":      "MEDIAN(number1, number2, ...)\nReturns the median of the given numbers.",
    "MIN":         "MIN(number1, number2, ...)\nReturns the minimum value in a list.",
    "MINA":        "MINA(value1, value2, ...)\nReturns the minimum, including text and logicals.",
    "MODE":        "MODE(number1, number2, ...)\nReturns the most common value.",
    "PERCENTILE":  "PERCENTILE(array, k)\nReturns the k-th percentile of values.",
    "PERCENTRANK": "PERCENTRANK(array, x, [significance])\nReturns the percentage rank of a value.",
    "QUARTILE":    "QUARTILE(array, quart)\nReturns the quartile of a data set.",
    "RANK":        "RANK(number, ref, [order])\nReturns the rank of a number in a list.",
    "RSQ":         "RSQ(known_y's, known_x's)\nReturns the R-squared value of a linear regression.",
    "SLOPE":       "SLOPE(known_y's, known_x's)\nReturns the slope of the linear regression line.",
    "SMALL":       "SMALL(array, k)\nReturns the k-th smallest value in a data set.",
    "STDEV":       "STDEV(number1, number2, ...)\nEstimates standard deviation based on a sample.",
    "STDEVA":      "STDEVA(value1, value2, ...)\nEstimates standard deviation, including text and logicals.",
    "STDEVP":      "STDEVP(number1, number2, ...)\nCalculates standard deviation based on the entire population.",
    "STDEVPA":     "STDEVPA(value1, value2, ...)\nPopulation standard deviation, including text and logicals.",
    "TREND":       "TREND(known_y's, [known_x's], [new_x's], [const])\nReturns values along a linear trend.",
    "TRIMMEAN":    "TRIMMEAN(array, percent)\nReturns the mean of the interior of a data set.",
    "VAR":         "VAR(number1, number2, ...)\nEstimates variance based on a sample.",
    "VARA":        "VARA(value1, value2, ...)\nEstimates variance, including text and logicals.",
    "VARP":        "VARP(number1, number2, ...)\nCalculates variance based on the entire population.",
    "VARPA":       "VARPA(value1, value2, ...)\nPopulation variance, including text and logicals.",

    # ── Engineering ──────────────────────────────────────────────
    "BIN2DEC":     "BIN2DEC(number)\nConverts a binary number to decimal.",
    "BIN2HEX":     "BIN2HEX(number, [places])\nConverts a binary number to hexadecimal.",
    "BIN2OCT":     "BIN2OCT(number, [places])\nConverts a binary number to octal.",
    "COMPLEX":     "COMPLEX(real, imaginary, [suffix])\nConverts real and imaginary coefficients to complex.",
    "CONVERT":     "CONVERT(number, from_unit, to_unit)\nConverts a number from one unit to another.",
    "DEC2BIN":     "DEC2BIN(number, [places])\nConverts a decimal number to binary.",
    "DEC2HEX":     "DEC2HEX(number, [places])\nConverts a decimal number to hexadecimal.",
    "DEC2OCT":     "DEC2OCT(number, [places])\nConverts a decimal number to octal.",
    "DELTA":       "DELTA(number1, [number2])\nTests whether two values are equal (returns 1 or 0).",
    "ERF":         "ERF(lower_limit, [upper_limit])\nReturns the error function.",
    "ERFC":        "ERFC(x)\nReturns the complementary error function.",
    "GESTEP":      "GESTEP(number, [step])\nTests whether a number is >= a step value (returns 1 or 0).",
    "HEX2BIN":     "HEX2BIN(number, [places])\nConverts a hexadecimal number to binary.",
    "HEX2DEC":     "HEX2DEC(number)\nConverts a hexadecimal number to decimal.",
    "HEX2OCT":     "HEX2OCT(number, [places])\nConverts a hexadecimal number to octal.",
    "IMABS":       "IMABS(inumber)\nReturns the absolute value (modulus) of a complex number.",
    "IMAGINARY":   "IMAGINARY(inumber)\nReturns the imaginary coefficient of a complex number.",
    "IMARGUMENT":  "IMARGUMENT(inumber)\nReturns the argument (angle) of a complex number.",
    "IMCONJUGATE": "IMCONJUGATE(inumber)\nReturns the complex conjugate.",
    "IMCOS":       "IMCOS(inumber)\nReturns the cosine of a complex number.",
    "IMDIV":       "IMDIV(inumber1, inumber2)\nReturns the quotient of two complex numbers.",
    "IMEXP":       "IMEXP(inumber)\nReturns the exponential of a complex number.",
    "IMLN":        "IMLN(inumber)\nReturns the natural logarithm of a complex number.",
    "IMLOG10":     "IMLOG10(inumber)\nReturns the base-10 logarithm of a complex number.",
    "IMLOG2":      "IMLOG2(inumber)\nReturns the base-2 logarithm of a complex number.",
    "IMPOWER":     "IMPOWER(inumber, number)\nReturns a complex number raised to a power.",
    "IMPRODUCT":   "IMPRODUCT(inumber1, inumber2, ...)\nReturns the product of complex numbers.",
    "IMREAL":      "IMREAL(inumber)\nReturns the real coefficient of a complex number.",
    "IMSIN":       "IMSIN(inumber)\nReturns the sine of a complex number.",
    "IMSQRT":      "IMSQRT(inumber)\nReturns the square root of a complex number.",
    "IMSUB":       "IMSUB(inumber1, inumber2)\nReturns the difference of two complex numbers.",
    "IMSUM":       "IMSUM(inumber1, inumber2, ...)\nReturns the sum of complex numbers.",
    "OCT2BIN":     "OCT2BIN(number, [places])\nConverts an octal number to binary.",
    "OCT2DEC":     "OCT2DEC(number)\nConverts an octal number to decimal.",
    "OCT2HEX":     "OCT2HEX(number, [places])\nConverts an octal number to hexadecimal.",

    # ── Information ──────────────────────────────────────────────
    "ERROR.TYPE": "ERROR.TYPE(error_val)\nReturns a number corresponding to an error type.",
    "ISBLANK":    "ISBLANK(value)\nReturns TRUE if the value is blank.",
    "ISERR":      "ISERR(value)\nReturns TRUE if the value is any error except #N/A.",
    "ISERROR":    "ISERROR(value)\nReturns TRUE if the value is any error.",
    "ISEVEN":     "ISEVEN(number)\nReturns TRUE if the number is even.",
    "ISLOGICAL":  "ISLOGICAL(value)\nReturns TRUE if the value is a logical value.",
    "ISNA":       "ISNA(value)\nReturns TRUE if the value is #N/A.",
    "ISNONTEXT":  "ISNONTEXT(value)\nReturns TRUE if the value is not text.",
    "ISNUMBER":   "ISNUMBER(value)\nReturns TRUE if the value is a number.",
    "ISODD":      "ISODD(number)\nReturns TRUE if the number is odd.",
    "ISREF":      "ISREF(value)\nReturns TRUE if the value is a reference.",
    "ISTEXT":     "ISTEXT(value)\nReturns TRUE if the value is text.",
    "N":          "N(value)\nConverts a value to a number.",
    "NA":         "NA()\nReturns the error value #N/A.",
    "TYPE":       "TYPE(value)\nReturns a number indicating the data type of a value.",

    # ── Data Analysis — Derivative ──────────────────────────────
    "DERIV":
        "DERIV(y_range, x_range)\n"
        "Returns the numerical first derivative dy/dx using central "
        "finite differences (numpy.gradient).  The result is an array "
        "the same length as the input.  Select the output range first, "
        "type the formula, then press Ctrl+Shift+Enter.",
    "DERIV2":
        "DERIV2(y_range, x_range)\n"
        "Returns the numerical second derivative d\u00b2y/dx\u00b2 by applying "
        "numpy.gradient twice.  Useful for finding inflection points in "
        "spectroscopy data.",
    "DERIV.SMOOTH":
        "DERIV.SMOOTH(y_range, x_range, [window], [poly_order])\n"
        "Returns the Savitzky\u2013Golay first derivative.  Combines "
        "smoothing and differentiation in a single step — often "
        "cleaner than DERIV on noisy data.  Default window = 7, "
        "poly_order = 3.",

    # ── Data Analysis — Integration ─────────────────────────────
    "TRAPZ":
        "TRAPZ(y_range, x_range)\n"
        "Returns the definite integral of y over x using the "
        "trapezoidal rule (numpy.trapz).  Returns a single number.",
    "CUMTRAPZ":
        "CUMTRAPZ(y_range, x_range)\n"
        "Returns the cumulative trapezoidal integral — an array whose "
        "i-th element is the integral from x\u2080 to x\u1d62.  "
        "Select an output range the same length as the input.",
    "SIMPS":
        "SIMPS(y_range, x_range)\n"
        "Returns the definite integral using Simpson\u2019s rule "
        "(scipy.integrate.simpson).  More accurate than TRAPZ for "
        "smooth curves.  Returns a single number.",

    # ── Data Analysis — Smoothing & filtering ───────────────────
    "SAVGOL":
        "SAVGOL(y_range, [window], [poly_order])\n"
        "Applies a Savitzky\u2013Golay smoothing filter "
        "(scipy.signal.savgol_filter).  Preserves peak shape better "
        "than a moving average.  Default window = 7, poly_order = 3.",
    "MOVAVG":
        "MOVAVG(y_range, [window])\n"
        "Returns the centred moving-average of y.  Default window = 5.  "
        "Edge values are filled with the original data so the output "
        "has the same length as the input.",
    "EWMA":
        "EWMA(y_range, [alpha])\n"
        "Returns the exponentially weighted moving average.  "
        "alpha = 0 keeps the raw data, alpha = 1 maximises smoothing.  "
        "Default alpha = 0.3.",
    "LOWPASS":
        "LOWPASS(y_range, x_range, cutoff_freq)\n"
        "Applies a Butterworth low-pass filter.  cutoff_freq is in "
        "the same units as 1/x (e.g. Hz if x is seconds).  "
        "Removes high-frequency noise.",
    "HIGHPASS":
        "HIGHPASS(y_range, x_range, cutoff_freq)\n"
        "Applies a Butterworth high-pass filter.  Removes slow "
        "baseline drifts while preserving sharp features.",
    "BANDPASS":
        "BANDPASS(y_range, x_range, low_freq, high_freq)\n"
        "Applies a Butterworth band-pass filter.  Keeps only the "
        "frequency components between low_freq and high_freq.",
    "MEDIAN.FILTER":
        "MEDIAN.FILTER(y_range, [kernel_size])\n"
        "Applies a median filter — replaces each point with the "
        "median of its kernel_size neighbours.  Excellent for removing "
        "spike artifacts.  Default kernel_size = 5.",

    # ── Data Analysis — Normalisation ───────────────────────────
    "NORM.MAX":
        "NORM.MAX(y_range)\n"
        "Normalises by dividing every value by the maximum.  "
        "The output peaks at 1.",
    "NORM.AREA":
        "NORM.AREA(y_range, x_range)\n"
        "Normalises so the integral of y over x equals 1 "
        "(area normalisation).",
    "NORM.MINMAX":
        "NORM.MINMAX(y_range)\n"
        "Scales y linearly so the minimum becomes 0 and the "
        "maximum becomes 1.",
    "NORM.ZSCORE":
        "NORM.ZSCORE(y_range)\n"
        "Returns (y \u2212 mean) / stdev for each point (z-score "
        "standardisation).",
    "NORM.PEAK":
        "NORM.PEAK(y_range, x_range, x_ref)\n"
        "Normalises by dividing every value by the y-value at the "
        "x position closest to x_ref.  Useful when normalising to "
        "a reference peak.",
    "NORM.RANGE":
        "NORM.RANGE(y_range, new_min, new_max)\n"
        "Scales y linearly into the interval [new_min, new_max].",

    # ── Data Analysis — FFT / spectral ──────────────────────────
    "FFT.MAG":
        "FFT.MAG(y_range)\n"
        "Returns the magnitude (absolute value) of the discrete "
        "Fourier transform — the single-sided amplitude spectrum.  "
        "Output length is N/2 + 1.",
    "FFT.PHASE":
        "FFT.PHASE(y_range)\n"
        "Returns the phase angle (in radians) of each FFT bin.",
    "FFT.FREQ":
        "FFT.FREQ(y_range, x_range)\n"
        "Returns the frequency axis corresponding to FFT.MAG.  "
        "Units are 1/x-units (e.g. Hz if x is in seconds).  "
        "Output length is N/2 + 1.",
    "FFT.REAL":
        "FFT.REAL(y_range)\n"
        "Returns the real part of the discrete Fourier transform.",
    "FFT.IMAG":
        "FFT.IMAG(y_range)\n"
        "Returns the imaginary part of the discrete Fourier transform.",
    "IFFT":
        "IFFT(real_range, imag_range)\n"
        "Returns the inverse FFT from real and imaginary components.  "
        "Use after filtering in frequency domain to reconstruct the "
        "time/space signal.",
    "FFT.POWER":
        "FFT.POWER(y_range)\n"
        "Returns the power spectral density — the squared magnitude "
        "of each FFT bin, normalised by N.",

    # ── Data Analysis — Interpolation & resampling ──────────────
    "INTERP.LINEAR":
        "INTERP.LINEAR(y_range, x_range, new_x_range)\n"
        "Interpolates y onto new x-values using linear interpolation.",
    "INTERP.SPLINE":
        "INTERP.SPLINE(y_range, x_range, new_x_range)\n"
        "Interpolates y onto new x-values using cubic spline "
        "(scipy.interpolate.CubicSpline).",
    "INTERP.AKIMA":
        "INTERP.AKIMA(y_range, x_range, new_x_range)\n"
        "Interpolates y onto new x-values using Akima spline — "
        "less prone to overshoot than cubic spline near sharp changes.",
    "RESAMPLE":
        "RESAMPLE(y_range, x_range, n_points)\n"
        "Resamples y onto n_points equally spaced x-values spanning "
        "the original x range.  Returns the resampled y-values.",

    # ── Data Analysis — Peak detection ──────────────────────────
    "FIND.PEAKS":
        "FIND.PEAKS(y_range, [prominence], [distance])\n"
        "Returns the row indices (1-based) of detected peaks using "
        "scipy.signal.find_peaks.  Optional prominence and minimum "
        "distance thresholds filter weak or closely spaced peaks.",
    "FIND.PEAKS.X":
        "FIND.PEAKS.X(y_range, x_range, [prominence], [distance])\n"
        "Returns the x-positions of detected peaks.",
    "FIND.PEAKS.Y":
        "FIND.PEAKS.Y(y_range, [prominence], [distance])\n"
        "Returns the y-values (heights) of detected peaks.",

    # ── Data Analysis — Baseline ────────────────────────────────
    "BASELINE.POLY":
        "BASELINE.POLY(y_range, x_range, [degree])\n"
        "Fits a polynomial baseline to the data and returns it.  "
        "Subtract the result from y to get baseline-corrected data.  "
        "Default degree = 3.",
    "BASELINE.ALS":
        "BASELINE.ALS(y_range, [lam], [p])\n"
        "Estimates the baseline using asymmetric least-squares "
        "smoothing (Eilers & Boelens 2005).  lam controls smoothness "
        "(default 1e6), p controls asymmetry (default 0.01).  "
        "Excellent for broad baselines in spectroscopy.",
}
