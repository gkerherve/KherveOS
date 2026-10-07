"""KherveSheet's calculation core, with no Qt: used by the desktop sheet and
by KherveCELL (in the browser, through Pyodide).

- ``refs``      A1 references, cross-sheet references, shifting formulas
- ``numbers``   how values are shown (number formats)
- ``catalog``   the function catalogue and help
- ``functions`` the function library (``build_namespace``)
- ``compiler``  formula text → code (``compile_formula``)
- ``values``    reading cells for formulas (``CellValues``)
- ``engine``    a complete Qt-free workbook (sources, values, recalculation)

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""
