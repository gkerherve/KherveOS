""""My molecules": a shelf of molecules you built and kept (Qt-free).

Build a molecule in 3D, keep it — it goes on the shelf as *Molecule 1* —
build the next, keep that as *Molecule 2*, and so on. The shelf is saved in
your user data folder, so it is still there next time. Anything on it can
be loaded back into the 3D view, dragged onto it, or used as a species in
the Reaction builder by writing ``@Molecule_1`` (the name with underscores
for spaces): the reaction is then balanced and drawn from the geometry you
built, atom for atom.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import json
import os
import re
import sys
import time

from . import smiles
from .crystal import BuildError

FILE_NAME = "shelf.json"
MAX_ATOMS = 400


def state_dir() -> str:
    """The per-user data folder (``KHERVEMOL_STATE_DIR`` overrides it)."""
    forced = os.environ.get("KHERVEMOL_STATE_DIR")
    if forced:
        return forced
    if sys.platform.startswith("win"):
        base = (os.environ.get("LOCALAPPDATA")
                or os.path.expanduser("~\\AppData\\Local"))
        return os.path.join(base, "KherveMol")
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/KherveMol")
    base = (os.environ.get("XDG_CONFIG_HOME")
            or os.path.expanduser("~/.config"))
    return os.path.join(base, "KherveMol")


def token(name: str) -> str:
    """How a shelf molecule is written in an equation: ``@Molecule_1``."""
    return "@" + re.sub(r"\s+", "_", name.strip())


def _key(name: str) -> str:
    return re.sub(r"\s+", "_", name.strip()).lower()


class Shelf:
    """An ordered collection of kept molecules, saved as JSON."""

    def __init__(self, path=None):
        self.path = path or os.path.join(state_dir(), FILE_NAME)
        self.items = []             # dicts: name, atoms, bonds, when
        self.load()

    # ---------------------------------------------------------- storage
    def load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.items = [i for i in data.get("molecules", [])
                          if i.get("name") and i.get("atoms")]
        except (OSError, ValueError, AttributeError):
            self.items = []

    def save(self):
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"version": 1, "molecules": self.items}, f,
                          indent=1)
            os.replace(tmp, self.path)
        except OSError:
            pass                    # a read-only profile just loses the shelf

    # ------------------------------------------------------------ names
    def names(self):
        return [i["name"] for i in self.items]

    def __len__(self):
        return len(self.items)

    def _find(self, name):
        k = _key(name.lstrip("@"))
        for item in self.items:
            if _key(item["name"]) == k:
                return item
        return None

    def __contains__(self, name):
        return self._find(name) is not None

    def next_name(self, base="Molecule"):
        n = 1
        while self._find(f"{base} {n}") is not None:
            n += 1
        return f"{base} {n}"

    # ---------------------------------------------------------- content
    def add(self, mol, name=None):
        """Keep a copy of the viewer molecule *mol*; returns the name used
        (a taken name gets replaced when it is given explicitly)."""
        if not mol.atoms:
            raise BuildError("There is no molecule to keep.")
        if mol.crystal or getattr(mol, "notes", None):
            raise BuildError("Only a molecule can be kept, not a crystal, "
                             "surface or reaction scene.")
        if len(mol.atoms) > MAX_ATOMS:
            raise BuildError(f"More than {MAX_ATOMS} atoms.")
        name = (name or "").strip() or self.next_name()
        if not re.search(r"[A-Za-z0-9]", name):
            raise BuildError("A name needs at least one letter or digit.")
        item = {"name": name,
                "atoms": [[a[0], round(float(a[1]), 5), round(float(a[2]), 5),
                           round(float(a[3]), 5)] for a in mol.atoms],
                "bonds": [[int(b[0]), int(b[1]), int(b[2])]
                          for b in mol.bonds],
                "label": getattr(mol, "label", name),
                "when": int(time.time())}
        old = self._find(name)
        if old is not None:
            self.items[self.items.index(old)] = item
        else:
            self.items.append(item)
        self.save()
        return name

    def remove(self, name):
        item = self._find(name)
        if item is not None:
            self.items.remove(item)
            self.save()

    def rename(self, old, new):
        item = self._find(old)
        new = (new or "").strip()
        if item is None:
            raise KeyError(old)
        if not re.search(r"[A-Za-z0-9]", new):
            raise BuildError("A name needs at least one letter or digit.")
        other = self._find(new)
        if other is not None and other is not item:
            raise BuildError(f"'{new}' is already on the shelf.")
        item["name"] = new
        self.save()

    def move(self, name, delta):
        item = self._find(name)
        if item is None:
            return
        i = self.items.index(item)
        j = max(0, min(len(self.items) - 1, i + delta))
        self.items.insert(j, self.items.pop(i))
        self.save()

    def formula(self, name):
        item = self._find(name)
        if item is None:
            raise KeyError(name)
        counts = {}
        for a in item["atoms"]:
            counts[a[0]] = counts.get(a[0], 0) + 1
        return smiles.hill_formula(counts)

    def get(self, name):
        """The stored dict, or KeyError."""
        item = self._find(name)
        if item is None:
            raise KeyError(f"No molecule '{name}' on the shelf.")
        return item

    def compound(self, name):
        """The kept molecule as a `smiles.Compound` (for reactions)."""
        item = self.get(name)
        return smiles.Compound(
            name=item["name"], smiles=token(item["name"]),
            atoms=[list(a) for a in item["atoms"]],
            bonds=[tuple(b) for b in item["bonds"]],
            charges=[0] * len(item["atoms"]), key=token(item["name"]))

    def model(self, name):
        """The kept molecule as a viewer `Molecule`."""
        from .model import Molecule
        item = self.get(name)
        return Molecule(item["atoms"], item["bonds"], name=f"mine:{name}",
                        label=item["name"])


_DEFAULT = None


def default() -> Shelf:
    """The app-wide shelf (one file per user)."""
    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = Shelf()
    return _DEFAULT


def reset_default():
    """Forget the singleton (tests change the state folder)."""
    global _DEFAULT
    _DEFAULT = None
