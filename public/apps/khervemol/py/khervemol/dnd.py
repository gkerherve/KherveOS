"""Drag-and-drop payloads shared by the library tree and the two views.

A library leaf carries ``(kind, value)`` — ``("model", key)`` for a built-in
structure or ``("smiles", smi)`` for a catalog compound. Both the 3D viewer
and the 2D sketcher accept it, so a compound can be dragged anywhere.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

#: A library compound being dragged onto a view.
MIME_COMPOUND = "application/x-khervemol-compound"

#: An atom being dragged from one row of the structure tree onto another.
MIME_ATOM = "application/x-khervemol-atom"


def encode(kind, value):
    return f"{kind}|{value}".encode("utf-8")


def decode(raw):
    kind, _, value = bytes(raw).decode("utf-8").partition("|")
    return kind, value
