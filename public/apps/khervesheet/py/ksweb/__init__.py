"""KherveSheet for KherveOS: the Python side of the web app.

The grid lives in the browser (TypeScript); every calculation runs here,
in the window's Pyodide worker, through the desktop's unchanged core
(``khervesheet.core``):

- ``bridge``    the requests the grid sends, answered as JSON
- ``workbook``  the engine's Workbook with a faster dependency index,
                raw restores and snapshots
- ``edit``      fill, paste, sort, inserting and deleting rows/columns
- ``ksheetio``  .ksheet files (HDF5), read and written like the desktop
- ``chartsio``  desktop charts ↔ chart specs, drawn by core.charts

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""
