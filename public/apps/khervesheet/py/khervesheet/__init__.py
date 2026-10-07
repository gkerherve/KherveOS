"""KherveSheet's calculation core for KherveOS.

Only ``khervesheet.core`` ships here: the desktop KherveSheet's Qt-free
engine (dev branch, copied unchanged). The desktop package's own
``__init__`` is left out because it reads the version from git.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

APP_NAME = "KherveSheet"
#: The desktop KherveSheet commit the core was copied from.
CORE_SOURCE = "KherveSheet dev @ cef25ce"
