"""A browsable catalog of named compounds (name → SMILES).

Feeds the Molecule Explorer so you can pick "Aspirin" or "Glycine" from a
searchable list instead of typing SMILES by hand. Building any of these
into 3D uses RDKit when installed and the built-in embedder (`smiles`)
otherwise; `compounds` absorbs the entries its own library lacks.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

#: (category, name, SMILES). Categories are shown in first-appearance order.
_CURATED = [
    # --- Solvents -----------------------------------------------------------
    ("Solvents", "Water", "O"),
    ("Solvents", "Methanol", "CO"),
    ("Solvents", "Ethanol", "CCO"),
    ("Solvents", "Isopropanol", "CC(C)O"),
    ("Solvents", "Acetone", "CC(=O)C"),
    ("Solvents", "Acetonitrile", "CC#N"),
    ("Solvents", "DMSO", "CS(=O)C"),
    ("Solvents", "DMF", "CN(C)C=O"),
    ("Solvents", "THF", "C1CCOC1"),
    ("Solvents", "Diethyl ether", "CCOCC"),
    ("Solvents", "Ethyl acetate", "CC(=O)OCC"),
    ("Solvents", "Chloroform", "C(Cl)(Cl)Cl"),
    ("Solvents", "Dichloromethane", "C(Cl)Cl"),
    ("Solvents", "Carbon tetrachloride", "C(Cl)(Cl)(Cl)Cl"),
    ("Solvents", "Toluene", "Cc1ccccc1"),
    ("Solvents", "Benzene", "c1ccccc1"),
    ("Solvents", "Hexane", "CCCCCC"),
    ("Solvents", "Pyridine", "c1ccncc1"),

    # --- Hydrocarbons -------------------------------------------------------
    ("Hydrocarbons", "Methane", "C"),
    ("Hydrocarbons", "Ethane", "CC"),
    ("Hydrocarbons", "Propane", "CCC"),
    ("Hydrocarbons", "Butane", "CCCC"),
    ("Hydrocarbons", "Isobutane", "CC(C)C"),
    ("Hydrocarbons", "Pentane", "CCCCC"),
    ("Hydrocarbons", "Octane", "CCCCCCCC"),
    ("Hydrocarbons", "Isooctane", "CC(C)CC(C)(C)C"),
    ("Hydrocarbons", "Ethylene", "C=C"),
    ("Hydrocarbons", "Propene", "CC=C"),
    ("Hydrocarbons", "1,3-Butadiene", "C=CC=C"),
    ("Hydrocarbons", "Acetylene", "C#C"),
    ("Hydrocarbons", "Cyclopropane", "C1CC1"),
    ("Hydrocarbons", "Cyclopentane", "C1CCCC1"),
    ("Hydrocarbons", "Cyclohexane", "C1CCCCC1"),

    # --- Aromatics & heterocycles ------------------------------------------
    ("Aromatics", "Benzene", "c1ccccc1"),
    ("Aromatics", "Toluene", "Cc1ccccc1"),
    ("Aromatics", "Phenol", "Oc1ccccc1"),
    ("Aromatics", "Aniline", "Nc1ccccc1"),
    ("Aromatics", "Styrene", "C=Cc1ccccc1"),
    ("Aromatics", "Benzaldehyde", "O=Cc1ccccc1"),
    ("Aromatics", "Nitrobenzene", "O=[N+]([O-])c1ccccc1"),
    ("Aromatics", "Naphthalene", "c1ccc2ccccc2c1"),
    ("Aromatics", "Anthracene", "c1ccc2cc3ccccc3cc2c1"),
    ("Aromatics", "Furan", "c1ccoc1"),
    ("Aromatics", "Thiophene", "c1ccsc1"),
    ("Aromatics", "Pyrrole", "c1cc[nH]c1"),
    ("Aromatics", "Imidazole", "c1c[nH]cn1"),
    ("Aromatics", "Pyridine", "c1ccncc1"),
    ("Aromatics", "Pyrimidine", "c1cncnc1"),
    ("Aromatics", "Indole", "c1ccc2[nH]ccc2c1"),

    # --- Functional-group examples -----------------------------------------
    ("Functional groups", "Formaldehyde", "C=O"),
    ("Functional groups", "Acetaldehyde", "CC=O"),
    ("Functional groups", "Acetone (ketone)", "CC(=O)C"),
    ("Functional groups", "Formic acid", "OC=O"),
    ("Functional groups", "Acetic acid", "CC(=O)O"),
    ("Functional groups", "Methylamine", "CN"),
    ("Functional groups", "Trimethylamine", "CN(C)C"),
    ("Functional groups", "Acetamide", "CC(N)=O"),
    ("Functional groups", "Urea", "NC(N)=O"),
    ("Functional groups", "Nitromethane", "C[N+](=O)[O-]"),
    ("Functional groups", "Methanethiol", "CS"),
    ("Functional groups", "Dimethyl sulfide", "CSC"),
    ("Functional groups", "Dimethyl ether", "COC"),
    ("Functional groups", "Acetonitrile (nitrile)", "CC#N"),
    ("Functional groups", "Acetic anhydride", "CC(=O)OC(C)=O"),

    # --- Carboxylic acids ---------------------------------------------------
    ("Acids", "Acetic acid", "CC(=O)O"),
    ("Acids", "Propionic acid", "CCC(=O)O"),
    ("Acids", "Butyric acid", "CCCC(=O)O"),
    ("Acids", "Oxalic acid", "OC(=O)C(=O)O"),
    ("Acids", "Lactic acid", "CC(O)C(=O)O"),
    ("Acids", "Citric acid", "OC(=O)CC(O)(CC(=O)O)C(=O)O"),
    ("Acids", "Benzoic acid", "OC(=O)c1ccccc1"),
    ("Acids", "Salicylic acid", "OC(=O)c1ccccc1O"),

    # --- Amino acids --------------------------------------------------------
    ("Amino acids", "Glycine", "NCC(=O)O"),
    ("Amino acids", "Alanine", "CC(N)C(=O)O"),
    ("Amino acids", "Serine", "OCC(N)C(=O)O"),
    ("Amino acids", "Cysteine", "SCC(N)C(=O)O"),
    ("Amino acids", "Valine", "CC(C)C(N)C(=O)O"),
    ("Amino acids", "Leucine", "CC(C)CC(N)C(=O)O"),
    ("Amino acids", "Isoleucine", "CCC(C)C(N)C(=O)O"),
    ("Amino acids", "Threonine", "CC(O)C(N)C(=O)O"),
    ("Amino acids", "Methionine", "CSCCC(N)C(=O)O"),
    ("Amino acids", "Proline", "O=C(O)C1CCCN1"),
    ("Amino acids", "Phenylalanine", "NC(Cc1ccccc1)C(=O)O"),
    ("Amino acids", "Tyrosine", "NC(Cc1ccc(O)cc1)C(=O)O"),
    ("Amino acids", "Tryptophan", "NC(Cc1c[nH]c2ccccc12)C(=O)O"),
    ("Amino acids", "Aspartic acid", "NC(CC(=O)O)C(=O)O"),
    ("Amino acids", "Glutamic acid", "NC(CCC(=O)O)C(=O)O"),
    ("Amino acids", "Asparagine", "NC(CC(N)=O)C(=O)O"),
    ("Amino acids", "Glutamine", "NC(CCC(N)=O)C(=O)O"),
    ("Amino acids", "Lysine", "NCCCCC(N)C(=O)O"),
    ("Amino acids", "Arginine", "NC(CCCNC(N)=N)C(=O)O"),
    ("Amino acids", "Histidine", "NC(Cc1c[nH]cn1)C(=O)O"),

    # --- Sugars & vitamins --------------------------------------------------
    ("Sugars & vitamins", "Glucose", "OCC1OC(O)C(O)C(O)C1O"),
    ("Sugars & vitamins", "Fructose", "OCC(=O)C(O)C(O)C(O)CO"),
    ("Sugars & vitamins", "Ribose", "OCC1OC(O)C(O)C1O"),
    ("Sugars & vitamins", "Deoxyribose", "OCC1OC(O)CC1O"),
    ("Sugars & vitamins", "Sucrose",
     "OCC1OC(OC2(CO)OC(CO)C(O)C2O)C(O)C(O)C1O"),
    ("Sugars & vitamins", "Ascorbic acid (vit C)", "OCC(O)C1OC(=O)C(O)=C1O"),

    # --- Nucleobases --------------------------------------------------------
    ("Nucleobases", "Adenine", "C1=NC2=NC=NC(=C2N1)N"),
    ("Nucleobases", "Guanine", "C1=NC2=C(N1)C(=O)NC(=N2)N"),
    ("Nucleobases", "Cytosine", "C1=CC(=NC(=O)N1)N"),
    ("Nucleobases", "Thymine", "CC1=CNC(=O)NC1=O"),
    ("Nucleobases", "Uracil", "C1=CNC(=O)NC1=O"),

    # --- Drugs & bioactive --------------------------------------------------
    ("Drugs & bioactive", "Aspirin", "CC(=O)Oc1ccccc1C(=O)O"),
    ("Drugs & bioactive", "Paracetamol", "CC(=O)Nc1ccc(O)cc1"),
    ("Drugs & bioactive", "Ibuprofen", "CC(C)Cc1ccc(cc1)C(C)C(=O)O"),
    ("Drugs & bioactive", "Caffeine", "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"),
    ("Drugs & bioactive", "Nicotine", "CN1CCCC1c1cccnc1"),
    ("Drugs & bioactive", "Dopamine", "NCCc1ccc(O)c(O)c1"),
    ("Drugs & bioactive", "Serotonin", "NCCc1c[nH]c2ccc(O)cc12"),
    ("Drugs & bioactive", "Adrenaline", "CNCC(O)c1ccc(O)c(O)c1"),
    ("Drugs & bioactive", "Amphetamine", "CC(N)Cc1ccccc1"),
    ("Drugs & bioactive", "Vanillin", "O=Cc1ccc(O)c(OC)c1"),
    ("Drugs & bioactive", "Menthol", "CC(C)C1CCC(C)CC1O"),
    ("Drugs & bioactive", "Camphor", "CC1(C)C2CCC1(C)C(=O)C2"),
    ("Drugs & bioactive", "Cholesterol",
     "CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C"),

    # --- Small inorganic / gases -------------------------------------------
    ("Gases & inorganic", "Carbon dioxide", "O=C=O"),
    ("Gases & inorganic", "Carbon monoxide", "[C-]#[O+]"),
    ("Gases & inorganic", "Ammonia", "N"),
    ("Gases & inorganic", "Hydrogen peroxide", "OO"),
    ("Gases & inorganic", "Sulfur dioxide", "O=S=O"),
    ("Gases & inorganic", "Hydrogen cyanide", "C#N"),
    ("Gases & inorganic", "Ozone", "[O-][O+]=O"),
    ("Gases & inorganic", "Hydrazine", "NN"),
    ("Gases & inorganic", "Hydroxylamine", "NO"),
    ("Gases & inorganic", "Carbon disulfide", "S=C=S"),
    ("Gases & inorganic", "Phosgene", "O=C(Cl)Cl"),
    ("Gases & inorganic", "Nitrous oxide", "[N-]=[N+]=O"),

    # --- Alcohols & polyols -------------------------------------------------
    ("Alcohols & polyols", "Propan-1-ol", "CCCO"),
    ("Alcohols & polyols", "Propan-2-ol", "CC(C)O"),
    ("Alcohols & polyols", "Butan-1-ol", "CCCCO"),
    ("Alcohols & polyols", "tert-Butanol", "CC(C)(C)O"),
    ("Alcohols & polyols", "Allyl alcohol", "C=CCO"),
    ("Alcohols & polyols", "Benzyl alcohol", "OCc1ccccc1"),
    ("Alcohols & polyols", "Phenethyl alcohol", "OCCc1ccccc1"),
    ("Alcohols & polyols", "Ethylene glycol", "OCCO"),
    ("Alcohols & polyols", "Propylene glycol", "CC(O)CO"),
    ("Alcohols & polyols", "Glycerol", "OCC(O)CO"),
    ("Alcohols & polyols", "Sorbitol", "OCC(O)C(O)C(O)C(O)CO"),
    ("Alcohols & polyols", "Catechol", "Oc1ccccc1O"),
    ("Alcohols & polyols", "Resorcinol", "Oc1cccc(O)c1"),
    ("Alcohols & polyols", "Hydroquinone", "Oc1ccc(O)cc1"),
    ("Alcohols & polyols", "Cresol", "Cc1ccccc1O"),
    ("Alcohols & polyols", "Thymol", "Cc1ccc(C(C)C)cc1O"),

    # --- More aromatics -----------------------------------------------------
    ("Aromatics", "o-Xylene", "Cc1ccccc1C"),
    ("Aromatics", "Anisole", "COc1ccccc1"),
    ("Aromatics", "Acetophenone", "CC(=O)c1ccccc1"),
    ("Aromatics", "Benzamide", "NC(=O)c1ccccc1"),
    ("Aromatics", "Benzonitrile", "N#Cc1ccccc1"),
    ("Aromatics", "Biphenyl", "c1ccc(-c2ccccc2)cc1"),
    ("Aromatics", "Phenanthrene", "c1ccc2ccc3ccccc3c2c1"),
    ("Aromatics", "Pyrene", "c1cc2ccc3cccc4ccc(c1)c2c34"),
    ("Aromatics", "Benzoquinone", "O=C1C=CC(=O)C=C1"),
    ("Aromatics", "Phthalic acid", "OC(=O)c1ccccc1C(=O)O"),
    ("Aromatics", "Terephthalic acid", "OC(=O)c1ccc(C(=O)O)cc1"),
    ("Aromatics", "Azobenzene", "c1ccc(N=Nc2ccccc2)cc1"),

    # --- Heterocycles -------------------------------------------------------
    ("Heterocycles", "Pyrrolidine", "C1CCNC1"),
    ("Heterocycles", "Piperidine", "C1CCNCC1"),
    ("Heterocycles", "Piperazine", "C1CNCCN1"),
    ("Heterocycles", "Morpholine", "C1COCCN1"),
    ("Heterocycles", "1,4-Dioxane", "C1COCCO1"),
    ("Heterocycles", "Pyrazole", "c1cc[nH]n1"),
    ("Heterocycles", "Oxazole", "c1ocnc1"),
    ("Heterocycles", "Thiazole", "c1cscn1"),
    ("Heterocycles", "Quinoline", "c1ccc2ncccc2c1"),
    ("Heterocycles", "Isoquinoline", "c1ccc2cnccc2c1"),
    ("Heterocycles", "Benzimidazole", "c1ccc2[nH]cnc2c1"),
    ("Heterocycles", "Benzofuran", "c1ccc2occc2c1"),
    ("Heterocycles", "Benzothiophene", "c1ccc2sccc2c1"),
    ("Heterocycles", "Furfural", "O=Cc1ccco1"),
    ("Heterocycles", "Coumarin", "O=c1ccc2ccccc2o1"),
    ("Heterocycles", "Caprolactam", "O=C1CCCCCN1"),

    # --- Pharmaceuticals ----------------------------------------------------
    ("Pharmaceuticals", "Naproxen", "COc1ccc2cc(C(C)C(=O)O)ccc2c1"),
    ("Pharmaceuticals", "Diclofenac", "OC(=O)Cc1ccccc1Nc1c(Cl)cccc1Cl"),
    ("Pharmaceuticals", "Metformin", "CN(C)C(=N)NC(=N)N"),
    ("Pharmaceuticals", "Warfarin", "CC(=O)CC(c1ccccc1)c1c(O)c2ccccc2oc1=O"),
    ("Pharmaceuticals", "Diazepam", "CN1c2ccc(Cl)cc2C(=NCC1=O)c1ccccc1"),
    ("Pharmaceuticals", "Salbutamol", "CC(C)(C)NCC(O)c1ccc(O)c(CO)c1"),
    ("Pharmaceuticals", "Theobromine", "Cn1cnc2c1c(=O)[nH]c(=O)n2C"),
    ("Pharmaceuticals", "Theophylline", "Cn1c(=O)c2[nH]cnc2n(C)c1=O"),
    ("Pharmaceuticals", "Ibuprofen", "CC(C)Cc1ccc(cc1)C(C)C(=O)O"),
    ("Pharmaceuticals", "Lidocaine", "CCN(CC)CC(=O)Nc1c(C)cccc1C"),
    ("Pharmaceuticals", "Procaine", "CCN(CC)CCOC(=O)c1ccc(N)cc1"),

    # --- Vitamins -----------------------------------------------------------
    ("Vitamins", "Niacin (B3)", "OC(=O)c1cccnc1"),
    ("Vitamins", "Nicotinamide", "NC(=O)c1cccnc1"),
    ("Vitamins", "Pyridoxine (B6)", "Cc1ncc(CO)c(O)c1CO"),
    ("Vitamins", "Ascorbic acid (C)", "OCC(O)C1OC(=O)C(O)=C1O"),
    ("Vitamins", "para-Aminobenzoic acid", "Nc1ccc(C(=O)O)cc1"),

    # --- Hormones & neurotransmitters --------------------------------------
    ("Hormones & neuro", "Dopamine", "NCCc1ccc(O)c(O)c1"),
    ("Hormones & neuro", "Serotonin", "NCCc1c[nH]c2ccc(O)cc12"),
    ("Hormones & neuro", "Noradrenaline", "NCC(O)c1ccc(O)c(O)c1"),
    ("Hormones & neuro", "Histamine", "NCCc1c[nH]cn1"),
    ("Hormones & neuro", "GABA", "NCCCC(=O)O"),
    ("Hormones & neuro", "Acetylcholine", "CC(=O)OCC[N+](C)(C)C"),
    ("Hormones & neuro", "Melatonin", "CC(=O)NCCc1c[nH]c2ccc(OC)cc12"),

    # --- Steroids -----------------------------------------------------------
    ("Steroids", "Cholesterol",
     "CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C"),
    ("Steroids", "Testosterone",
     "CC12CCC3C(CCC4=CC(=O)CCC34C)C1CCC2O"),
    ("Steroids", "Estradiol",
     "CC12CCC3c4ccc(O)cc4CCC3C1CCC2O"),

    # --- Terpenes & fragrances ---------------------------------------------
    ("Terpenes & fragrances", "Limonene", "CC1=CCC(CC1)C(=C)C"),
    ("Terpenes & fragrances", "alpha-Pinene", "CC1=CCC2CC1C2(C)C"),
    ("Terpenes & fragrances", "Geraniol", "CC(=CCCC(=CCO)C)C"),
    ("Terpenes & fragrances", "Linalool", "CC(=CCCC(C)(C=C)O)C"),
    ("Terpenes & fragrances", "Eugenol", "C=CCc1ccc(O)c(OC)c1"),
    ("Terpenes & fragrances", "Carvone", "CC(=C)C1CC=C(C)C(=O)C1"),
    ("Terpenes & fragrances", "Menthone", "CC(C)C1CCC(C)CC1=O"),
    ("Terpenes & fragrances", "Cinnamaldehyde", "O=CC=Cc1ccccc1"),
    ("Terpenes & fragrances", "Isoamyl acetate", "CC(C)CCOC(=O)C"),

    # --- Fatty acids --------------------------------------------------------
    ("Fatty acids", "Lauric acid", "CCCCCCCCCCCC(=O)O"),
    ("Fatty acids", "Myristic acid", "CCCCCCCCCCCCCC(=O)O"),
    ("Fatty acids", "Palmitic acid", "CCCCCCCCCCCCCCCC(=O)O"),
    ("Fatty acids", "Stearic acid", "CCCCCCCCCCCCCCCCCC(=O)O"),
    ("Fatty acids", "Oleic acid", "CCCCCCCCC=CCCCCCCCC(=O)O"),
    ("Fatty acids", "Linoleic acid", "CCCCCC=CCC=CCCCCCCCC(=O)O"),

    # --- Monomers -----------------------------------------------------------
    ("Monomers", "Vinyl chloride", "C=CCl"),
    ("Monomers", "Acrylonitrile", "C=CC#N"),
    ("Monomers", "Methyl methacrylate", "CC(=C)C(=O)OC"),
    ("Monomers", "Tetrafluoroethylene", "FC(F)=C(F)F"),
    ("Monomers", "Isoprene", "CC(=C)C=C"),
    ("Monomers", "Vinyl acetate", "CC(=O)OC=C"),
    ("Monomers", "Acrylic acid", "C=CC(=O)O"),
    ("Monomers", "Bisphenol A",
     "CC(C)(c1ccc(O)cc1)c1ccc(O)cc1"),
    ("Monomers", "Caprolactam", "O=C1CCCCCN1"),

    # --- Reagents -----------------------------------------------------------
    ("Reagents", "Triethylamine", "CCN(CC)CC"),
    ("Reagents", "Guanidine", "NC(=N)N"),
    ("Reagents", "Formamide", "O=CN"),
    ("Reagents", "Thiourea", "NC(=S)N"),
    ("Reagents", "Trifluoroacetic acid", "OC(=O)C(F)(F)F"),
    ("Reagents", "Malonic acid", "OC(=O)CC(=O)O"),
    ("Reagents", "Succinic acid", "OC(=O)CCC(=O)O"),
    ("Reagents", "Maleic acid", "OC(=O)C=CC(=O)O"),
    ("Reagents", "Tartaric acid", "OC(=O)C(O)C(O)C(=O)O"),

    # --- Agrochemicals & misc ----------------------------------------------
    ("Agrochemicals & misc", "DDT",
     "ClC(Cl)(Cl)C(c1ccc(Cl)cc1)c1ccc(Cl)cc1"),
    ("Agrochemicals & misc", "Glyphosate", "OC(=O)CNCP(=O)(O)O"),
    ("Agrochemicals & misc", "Atrazine",
     "CCNc1nc(Cl)nc(NC(C)C)n1"),
    ("Agrochemicals & misc", "TNT",
     "Cc1c([N+](=O)[O-])cc([N+](=O)[O-])cc1[N+](=O)[O-]"),
    ("Agrochemicals & misc", "Picric acid",
     "Oc1c([N+](=O)[O-])cc([N+](=O)[O-])cc1[N+](=O)[O-]"),
]

# --------------------------------------------------- generated series
#: IUPAC multiplying prefixes for chain lengths 1..20.
_STEMS = ["meth", "eth", "prop", "but", "pent", "hex", "hept", "oct", "non",
          "dec", "undec", "dodec", "tridec", "tetradec", "pentadec",
          "hexadec", "heptadec", "octadec", "nonadec", "icos"]


def _stem(n):
    return _STEMS[n - 1] if 1 <= n <= len(_STEMS) else f"C{n}"


def _series():
    """Homologous series as guaranteed-valid SMILES — a large, systematic
    body of molecules (alkanes, alkenes, alkynes, alcohols, acids, amines,
    aldehydes, cycloalkanes)."""
    out = []
    for n in range(1, 21):                       # n-alkanes C1..C20
        out.append(("Alkanes (series)", f"{_stem(n).capitalize()}ane",
                    "C" * n))
    for n in range(2, 13):                       # 1-alkenes C2..C12
        out.append(("Alkenes (series)", f"{_stem(n).capitalize()}ene",
                    "C=C" + "C" * (n - 2)))
    for n in range(2, 13):                       # 1-alkynes C2..C12
        out.append(("Alkynes (series)", f"{_stem(n).capitalize()}yne",
                    "C#C" + "C" * (n - 2)))
    for n in range(1, 13):                       # 1-alkanols C1..C12
        out.append(("Alcohols (series)", f"{_stem(n).capitalize()}an-1-ol",
                    "C" * n + "O"))
    for n in range(1, 13):                       # n-alkanoic acids C1..C12
        out.append(("Carboxylic acids (series)",
                    f"{_stem(n).capitalize()}anoic acid",
                    "C" * (n - 1) + "C(=O)O"))
    for n in range(1, 11):                        # 1-aminoalkanes C1..C10
        out.append(("Amines (series)", f"{_stem(n).capitalize()}ylamine",
                    "C" * n + "N"))
    for n in range(1, 11):                        # n-alkanals C1..C10
        out.append(("Aldehydes (series)", f"{_stem(n).capitalize()}anal",
                    "C" * (n - 1) + "C=O"))
    for n in range(3, 9):                          # cycloalkanes C3..C8
        out.append(("Cycloalkanes (series)",
                    f"Cyclo{_stem(n)}ane", "C1" + "C" * (n - 1) + "1"))
    return out


#: (category, name, SMILES) for every catalogued compound.
CATALOG = _CURATED + _series()


def categories():
    """Category titles in first-appearance order."""
    seen = []
    for cat, _name, _smi in CATALOG:
        if cat not in seen:
            seen.append(cat)
    return seen


def grouped():
    """Ordered ``[(category, [(name, smiles), ...]), ...]``."""
    out = []
    index = {}
    for cat, name, smi in CATALOG:
        if cat not in index:
            index[cat] = []
            out.append((cat, index[cat]))
        index[cat].append((name, smi))
    return out


def all_entries():
    """Flat ``[(name, smiles), ...]`` for searching/validation."""
    return [(name, smi) for _cat, name, smi in CATALOG]
