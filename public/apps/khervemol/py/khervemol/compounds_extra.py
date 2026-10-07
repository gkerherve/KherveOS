"""Still more compounds (Qt-free): the elements themselves, oxides and
salts, halogenated and nitrogen oxides, and the small organic building
blocks the reaction examples need.

Rows are ``(key, name, SMILES)`` per family; the formula is computed
from the SMILES at import (`smiles.formula_of`), so an entry cannot
disagree with itself. Merged into `compounds.COMPOUNDS`.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

ELEMENTS = "Elements & allotropes"
OXIDES = "Oxides & nitrogen oxides"
SALTS2 = "More salts & minerals"
HALO = "Halogen compounds"
BUILDING = "Small organic building blocks"

CATEGORIES = (ELEMENTS, OXIDES, SALTS2, HALO, BUILDING)


def _ion(*parts):
    return ".".join(parts)


_ROWS = {
    ELEMENTS: [
        ("helium", "Helium", "[He]"), ("neon", "Neon", "[Ne]"),
        ("argon", "Argon", "[Ar]"), ("krypton", "Krypton", "[Kr]"),
        ("xenon", "Xenon", "[Xe]"),
        ("sodium_atom", "Sodium", "[Na]"), ("magnesium_atom", "Magnesium",
                                             "[Mg]"),
        ("aluminium_atom", "Aluminium", "[Al]"), ("iron_atom", "Iron", "[Fe]"),
        ("copper_atom", "Copper", "[Cu]"), ("zinc_atom", "Zinc", "[Zn]"),
        ("silver_atom", "Silver", "[Ag]"), ("gold_atom", "Gold", "[Au]"),
        ("sulfur_s8", "Sulfur (S8 crown)", "S1SSSSSSS1"),
        ("white_phosphorus", "White phosphorus (P4)", "P12P3P1P23"),
        ("tetrasulfur_tetranitride", "Tetrasulfur tetranitride",
         "N1=SN=SN=SN=S1"),
    ],
    OXIDES: [
        ("nitric_oxide", "Nitric oxide", "[N]=O"),
        ("nitrogen_dioxide", "Nitrogen dioxide", "O=[N]=O"),
        ("dinitrogen_tetroxide", "Dinitrogen tetroxide",
         "[O-][N+](=O)[N+](=O)[O-]"),
        ("dinitrogen_pentoxide", "Dinitrogen pentoxide",
         "[O-][N+](=O)O[N+](=O)[O-]"),
        ("nitrous_acid", "Nitrous acid", "ON=O"),
        ("chlorine_dioxide", "Chlorine dioxide", "O=[Cl]=O"),
        ("silicon_dioxide", "Silicon dioxide (monomer)", "O=[Si]=O"),
        ("titanium_dioxide", "Titanium dioxide (monomer)", "O=[Ti]=O"),
        ("phosphorus_pentoxide", "Phosphorus pentoxide",
         "O=P12OP3(=O)OP(=O)(O1)OP(=O)(O2)O3"),
        ("iron_iii_oxide", "Iron(III) oxide",
         _ion("[Fe+3]", "[Fe+3]", "[O-2]", "[O-2]", "[O-2]")),
        ("iron_ii_oxide", "Iron(II) oxide", _ion("[Fe+2]", "[O-2]")),
        ("aluminium_oxide", "Aluminium oxide",
         _ion("[Al+3]", "[Al+3]", "[O-2]", "[O-2]", "[O-2]")),
        ("copper_ii_oxide", "Copper(II) oxide", _ion("[Cu+2]", "[O-2]")),
        ("copper_i_oxide", "Copper(I) oxide", _ion("[Cu+]", "[Cu+]", "[O-2]")),
        ("nickel_oxide", "Nickel(II) oxide", _ion("[Ni+2]", "[O-2]")),
        ("lithium_oxide", "Lithium oxide", _ion("[Li+]", "[Li+]", "[O-2]")),
        ("sodium_oxide", "Sodium oxide", _ion("[Na+]", "[Na+]", "[O-2]")),
        ("barium_oxide", "Barium oxide", _ion("[Ba+2]", "[O-2]")),
    ],
    SALTS2: [
        ("silver_chloride", "Silver chloride", _ion("[Ag+]", "[Cl-]")),
        ("silver_bromide", "Silver bromide", _ion("[Ag+]", "[Br-]")),
        ("sodium_bromide", "Sodium bromide", _ion("[Na+]", "[Br-]")),
        ("sodium_iodide", "Sodium iodide", _ion("[Na+]", "[I-]")),
        ("sodium_fluoride", "Sodium fluoride", _ion("[Na+]", "[F-]")),
        ("potassium_bromide", "Potassium bromide", _ion("[K+]", "[Br-]")),
        ("potassium_iodide", "Potassium iodide", _ion("[K+]", "[I-]")),
        ("potassium_fluoride", "Potassium fluoride", _ion("[K+]", "[F-]")),
        ("calcium_hydroxide", "Calcium hydroxide",
         _ion("[Ca+2]", "[OH-]", "[OH-]")),
        ("magnesium_hydroxide", "Magnesium hydroxide",
         _ion("[Mg+2]", "[OH-]", "[OH-]")),
        ("aluminium_hydroxide", "Aluminium hydroxide",
         _ion("[Al+3]", "[OH-]", "[OH-]", "[OH-]")),
        ("lithium_hydroxide", "Lithium hydroxide", _ion("[Li+]", "[OH-]")),
        ("barium_chloride", "Barium chloride",
         _ion("[Ba+2]", "[Cl-]", "[Cl-]")),
        ("barium_sulfate", "Barium sulfate", _ion("[Ba+2]", "[O-]S(=O)(=O)[O-]")),
        ("magnesium_sulfate", "Magnesium sulfate",
         _ion("[Mg+2]", "[O-]S(=O)(=O)[O-]")),
        ("zinc_chloride", "Zinc chloride", _ion("[Zn+2]", "[Cl-]", "[Cl-]")),
        ("zinc_sulfate", "Zinc sulfate", _ion("[Zn+2]", "[O-]S(=O)(=O)[O-]")),
        ("potassium_carbonate", "Potassium carbonate",
         _ion("[K+]", "[K+]", "[O-]C(=O)[O-]")),
        ("sodium_nitrate", "Sodium nitrate",
         _ion("[Na+]", "[O-][N+]([O-])=O")),
        ("sodium_nitrite", "Sodium nitrite", _ion("[Na+]", "[O-]N=O")),
        ("sodium_phosphate", "Sodium phosphate",
         _ion("[Na+]", "[Na+]", "[Na+]", "[O-]P(=O)([O-])[O-]")),
        ("calcium_phosphate", "Calcium phosphate",
         _ion("[Ca+2]", "[Ca+2]", "[Ca+2]", "[O-]P(=O)([O-])[O-]",
              "[O-]P(=O)([O-])[O-]")),
        ("copper_ii_chloride", "Copper(II) chloride",
         _ion("[Cu+2]", "[Cl-]", "[Cl-]")),
        ("lead_ii_iodide", "Lead(II) iodide", _ion("[Pb+2]", "[I-]", "[I-]")),
        ("sodium_sulfide", "Sodium sulfide", _ion("[Na+]", "[Na+]", "[S-2]")),
        ("sodium_thiosulfate", "Sodium thiosulfate",
         _ion("[Na+]", "[Na+]", "[O-]S(=O)(=S)[O-]")),
        ("silver_nitrite", "Silver nitrite", _ion("[Ag+]", "[O-]N=O")),
    ],
    HALO: [
        ("chloromethane", "Chloromethane", "CCl"),
        ("bromomethane", "Bromomethane", "CBr"),
        ("iodomethane", "Iodomethane", "CI"),
        ("fluoromethane", "Fluoromethane", "CF"),
        ("chloroethane", "Chloroethane", "CCCl"),
        ("bromoethane", "Bromoethane", "CCBr"),
        ("tetrafluoromethane", "Tetrafluoromethane", "FC(F)(F)F"),
        ("trifluoromethane", "Trifluoromethane (fluoroform)", "FC(F)F"),
        ("freon_12", "Dichlorodifluoromethane (Freon-12)", "FC(F)(Cl)Cl"),
        ("tetrachloroethylene", "Tetrachloroethylene", "ClC(Cl)=C(Cl)Cl"),
        ("vinyl_chloride", "Vinyl chloride", "C=CCl"),
        ("tetrafluoroethylene", "Tetrafluoroethylene", "FC(F)=C(F)F"),
        ("chlorine_trifluoride", "Chlorine trifluoride", "FCl(F)F"),
        ("sulfur_tetrafluoride", "Sulfur tetrafluoride", "FS(F)(F)F"),
        ("iodine_heptafluoride", "Iodine heptafluoride",
         "FI(F)(F)(F)(F)(F)F"),
        ("xenon_hexafluoride", "Xenon hexafluoride", "F[Xe](F)(F)(F)(F)F"),
        ("phosphorus_trichloride", "Phosphorus trichloride", "ClP(Cl)Cl"),
        ("thionyl_chloride", "Thionyl chloride", "ClS(Cl)=O"),
        ("sulfuryl_chloride", "Sulfuryl chloride", "ClS(Cl)(=O)=O"),
    ],
    BUILDING: [
("ethyne", "Ethyne", "C#C"),
        ("propyne", "Propyne", "CC#C"), ("allene", "Allene", "C=C=C"),
        ("cyclopropane", "Cyclopropane", "C1CC1"),
        ("ethylamine", "Ethylamine", "CCN"),
        ("diazomethane", "Diazomethane", "C=[N+]=[N-]"),
        ("ketene", "Ketene", "C=C=O"),
        ("glyoxal", "Glyoxal", "O=CC=O"),
        ("ethylene_oxide", "Ethylene oxide", "C1CO1"),
        ("oxetane", "Oxetane", "C1COC1"),
        ("thiirane", "Thiirane", "C1CS1"),
        ("aziridine", "Aziridine", "C1CN1"),
        ("propylene_oxide", "Propylene oxide", "CC1CO1"),
        ("methanethiol", "Methanethiol", "CS"),
        ("dimethyl_sulfide", "Dimethyl sulfide", "CSC"),
        ("carbon_suboxide", "Carbon suboxide", "O=C=C=C=O"),
    ],
}

#: key -> (name, SMILES, category)
EXTRA = {key: (name, smiles, category)
         for category, rows in _ROWS.items()
         for key, name, smiles in rows}
