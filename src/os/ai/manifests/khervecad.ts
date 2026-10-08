// AI tools of KherveCAD: the desktop app's own MCP tools (mcp_schema.py /
// mcp_tools.py, 89 of them, run by the desktop code in the window's Python),
// the everyday ones by name and the rest through `tool`. ≤ 6 arguments each.
// The code is in src/apps/khervecad/aiTools.ts.

import type { AppToolSet, Schema } from '../appToolsCore.ts'
import { int, object, oneOf, str } from './schema.ts'

const anyObject = (description: string): Schema => ({ type: 'object', description, additionalProperties: true })

export const KHERVECAD_TOOL_SET: AppToolSet = {
  app: 'khervecad',
  name: 'KherveCAD',
  summary: 'the OpenSCAD-powered CAD app (object tree ↔ OpenSCAD program, 2D sketch, 3D view, a part library of ~2,300 parts).',
  keywords: ['khervecad', 'cad', 'openscad', 'scad', '3d model', '3d print', 'cube', 'cylinder', 'extrude', 'stl', 'kcad', 'bracket', 'enclosure'],
  tools: [
    {
      action: 'list_tree',
      description: 'The object tree: every node with its id, type, name, visibility and children (optionally its params). Ids are what the other tools take.',
      inputSchema: object({ node_id: int('Only this subtree.'), depth: int('How many levels (default all).') }),
      readOnly: true,
    },
    {
      action: 'get_code',
      description: 'The OpenSCAD program the tree generates (the whole document, or one node).',
      inputSchema: object({ node_id: int('Only this node.') }),
      readOnly: true,
    },
    {
      action: 'apply_code',
      description: 'Parse an OpenSCAD program into real, editable nodes (append to, or replace, the scope the user is in). End statements with "// Label" to name nodes. One undo step.',
      inputSchema: object({ code: str('The OpenSCAD program.'), mode: oneOf(['append', 'replace'], "'append' (default) or 'replace'."), into_id: int('Apply inside this Object instead.') }, ['code']),
    },
    {
      action: 'insert_part',
      description: 'Add a Part Library part (bolts, flanges, Lego, furniture, molecules…) by its id from list_parts, optionally placed and coloured.',
      inputSchema: object({ part_id: str('The part id, e.g. "bolt_hex".'), x: { type: 'number', description: 'X position (mm).' }, y: { type: 'number', description: 'Y position (mm).' }, z: { type: 'number', description: 'Z position (mm).' }, color: str('A colour, e.g. "#c0392b" or "red".'), name: str('A name for it.') }, ['part_id']),
    },
    {
      action: 'list_parts',
      description: 'Search the Part Library: ids, labels and categories.',
      inputSchema: object({ search: str('Words to look for, e.g. "hinge".'), category: str('Only this category.') }),
      readOnly: true,
    },
    {
      action: 'tool',
      description: 'Run any of the desktop KherveCAD MCP tools by name (add_node, set_params, wrap_nodes, set_color, delete_nodes, mass_properties, check_printability, build_house, build_crystal, load_example, save_document…). list_tools lists them with their arguments.',
      inputSchema: object({ name: str('The tool name, e.g. "set_params".'), args: anyObject('Its arguments, as the tool describes them.') }, ['name']),
    },
    {
      action: 'list_tools',
      description: "Every desktop KherveCAD MCP tool with its description and arguments (what 'tool' can run).",
      inputSchema: object({ search: str('Only tools whose name or description contains this.') }),
      readOnly: true,
    },
  ],
}
