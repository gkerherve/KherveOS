// AI tools of KherveMol (the desktop app's MCP tools, mcp_schema.py, in the
// KherveOS form: ≤ 6 arguments each). The code is in src/apps/khervemol/aiTools.ts.

import type { AppToolSet } from '../appToolsCore.ts'
import { int, object, oneOf, str, bool, num } from './schema.ts'

const KINDS = ['compound', 'smiles', 'crystal', 'surface', 'nano', 'polymer', 'reaction', 'model', 'mine'] as const
const VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'isometric'] as const

export const KHERVEMOL_TOOL_SET: AppToolSet = {
  app: 'khervemol',
  name: 'KherveMol',
  summary: 'the 2D/3D molecule and crystal builder (700 molecules, 120 crystals, surfaces, nanotubes, polymers, reactions).',
  keywords: ['khervemol', 'molecule', 'molecules', 'crystal', 'smiles', 'atom', 'bond', 'surface', 'graphene', 'nanotube', 'fullerene', 'polymer', 'reaction', 'chemistry', 'caffeine'],
  tools: [
    {
      action: 'get_structure',
      description: 'The structure in the 3D view: name, formula, kind, atoms (index, element, x y z Å) and bonds (i, j, order), and the selection.',
      inputSchema: object({ max_atoms: int('List at most this many atoms (default 200).') }),
      readOnly: true,
    },
    {
      action: 'search_library',
      description: 'Search the library (molecules, crystals, surfaces, nanostructures, polymers, reactions) by name or formula. Returns kind + value to pass to load_entry.',
      inputSchema: object({ text: str('Name, formula or family, e.g. "aspirin", "TiO2", "graphene".'), kind: oneOf(KINDS, 'Only this kind.'), limit: int('At most this many (default 25).') }, ['text']),
      readOnly: true,
    },
    {
      action: 'load_entry',
      description: 'Build a library entry in 3D, as a click in the Library tree: a kind and value from search_library, or a query of the desktop forms (see value).',
      inputSchema: object(
        {
          kind: oneOf(KINDS, 'The entry kind.'),
          value: str('The value or query: crystal "cu?cells=2,2,2", surface "si:111?layers=4", nano "graphene?width=3&layers=2", "nanotube?n=5&m=5", "fullerene?kind=c60", polymer "pvc?n=6", reaction "CH4 + O2 -> CO2 + H2O", smiles "CCO".'),
          label: str('Optional display name.'),
        },
        ['kind', 'value'],
      ),
    },
    {
      action: 'build_molecule',
      description: 'Build a molecule in 3D and 2D from a SMILES string (built-in builder), or by library name.',
      inputSchema: object({ smiles: str('A SMILES string, e.g. "CC(=O)Oc1ccccc1C(=O)O".'), name: str('Or a library molecule name, e.g. "caffeine".') }),
    },
    {
      action: 'build_reaction',
      description: 'Balance a reaction and lay it out in 3D (coefficients, arrow); play it with play_reaction.',
      inputSchema: object({ equation: str('e.g. "CH4 + O2 -> CO2 + H2O" (names, formulas or smiles:CCO).') }, ['equation']),
    },
    {
      action: 'play_reaction',
      description: 'Play the film of the reaction on screen (atoms rearrange), or stop it.',
      inputSchema: object({ stop: bool('Stop and show the equation again.') }),
    },
    {
      action: 'add_atom',
      description: 'Bond a new atom onto an atom of the molecule (valence-checked; placed at the real bond length).',
      inputSchema: object({ element: str('Element symbol, e.g. "O".'), to_atom: int('Index of the atom to bond to (default: the selected / last atom).'), order: int('Bond order 1-3 (default 1).') }, ['element']),
    },
    {
      action: 'delete_atom',
      description: 'Delete an atom (and its bonds) from the molecule.',
      inputSchema: object({ atom: int('Atom index.') }, ['atom']),
      destructive: true,
    },
    {
      action: 'bond_atoms',
      description: 'Bond two existing atoms, or change the order of the bond between them (0 deletes it).',
      inputSchema: object({ a: int('First atom index.'), b: int('Second atom index.'), order: int('1, 2 or 3; 0 deletes the bond (default 1).') }, ['a', 'b']),
    },
    {
      action: 'set_view',
      description: 'Turn the 3D view to a standard view and set the drawing style, labels and spacing.',
      inputSchema: object({
        view: oneOf(VIEWS, 'A view-cube face.'),
        style: oneOf(['ball_and_stick', 'space_filling', 'sticks'], 'Drawing style.'),
        labels: bool('Element symbols on the atoms.'),
        spacing: num('Bond length / atom spacing factor (0.8-3.0; crystals 0-3).'),
        tab: oneOf(['3d', '2d'], 'Show the 3D View or the 2D Sketch tab.'),
      }),
    },
    {
      action: 'properties',
      description: 'Formula, molecular weight, atom counts and (with RDKit) logP, TPSA, H-bond donors/acceptors, InChI; lattice data for a crystal.',
      inputSchema: object({}),
      readOnly: true,
    },
    {
      action: 'keep_molecule',
      description: 'Keep the molecule on the shelf ("My molecules") so reactions can use it as @Name.',
      inputSchema: object({ name: str('Name for it, e.g. "Molecule 1".') }),
    },
    {
      action: 'save_document',
      description: 'Save the structure and the 2D sketch as a .kmol file.',
      inputSchema: object({ path: str('e.g. "~/Documents/caffeine.kmol" (default: the file it came from).') }),
    },
    {
      action: 'open_document',
      description: 'Open a .kmol file, or import a .mol / .sdf / .pdb / .xyz / .cif structure file.',
      inputSchema: object({ path: str('The file, e.g. "~/Documents/caffeine.kmol".') }, ['path']),
    },
    {
      action: 'export_file',
      description: 'Export the structure; the format follows the extension: .png .svg (KhervePaint), .xyz .mol .sdf .pdb .cif, or a 3D-print mesh .stl .3mf .obj .ply .glb.',
      inputSchema: object({ path: str('e.g. "~/Documents/water.png".'), scale: num('Mesh size in mm per Å (default 10).') }, ['path']),
    },
  ],
}
