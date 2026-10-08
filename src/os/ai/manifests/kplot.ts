// AI tools of kPlot (publication-quality plots from a table). ≤ 6 arguments each.
// The code is in src/apps/kplot/aiTools.ts.

import type { AppToolSet } from '../appToolsCore.ts'
import { bool, object, oneOf, str } from './schema.ts'

export const KPLOT_TOOL_SET: AppToolSet = {
  app: 'kplot',
  name: 'kPlot',
  summary: 'plots from a table (scatter, bar, histogram, box, heat map, 3D), fits and annotations; export PNG or SVG.',
  keywords: ['kplot', 'plot', 'graph', 'chart', 'figure', 'curve', 'svg', 'png', 'publication', 'histogram', 'bar chart', 'box plot', 'heatmap', 'scatter'],
  tools: [
    {
      action: 'set_data',
      description: 'Put a table in kPlot: rows on lines, columns separated by commas, tabs or semicolons; a header row first. Replaces the data; the first column is x.',
      inputSchema: object({ text: str('The table as text, e.g. "x,y\\n0,1\\n1,2".') }, ['text']),
    },
    {
      action: 'set_options',
      description: 'Set what kPlot draws: the x column, the y columns (comma-separated, names or numbers from 1), the title, the axis labels and the style. Labels accept H_2O, m^2, \\alpha.',
      inputSchema: object(
        {
          x: str('The x column (name or number from 1).'),
          y: str('The y columns, comma-separated (names or numbers from 1), e.g. "signal, reference".'),
          title: str('The plot title.'),
          x_label: str('The x-axis label.'),
          y_label: str('The y-axis label.'),
          style: oneOf(['both', 'line', 'points'], 'Points and lines, lines only, or points only.'),
        },
      ),
    },
    {
      action: 'set_figure',
      description: 'Choose the kind of plot and how it looks: chart type, engine (interactive Plotly or publication SVG), legend, theme, colour palette, figure size preset.',
      inputSchema: object(
        {
          type: oneOf(['xy', 'bar', 'stacked', 'histogram', 'box', 'area', 'heatmap', 'contour', 'scatter3d', 'surface', 'violin', 'matrix'], 'xy = scatter / line. bar = grouped bars (x column gives the categories). heatmap, contour and surface take the numeric columns as a matrix. scatter3d takes x, then y and z columns. matrix = scatter matrix.'),
          engine: oneOf(['plotly', 'svg'], 'plotly = interactive view, svg = the publication figure.'),
          legend: oneOf(['auto', 'none', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'outside-right', 'outside-top'], 'Where the legend goes.'),
          theme: oneOf(['white', 'dark', 'transparent'], 'The figure page: white (publication), dark, or a transparent background.'),
          palette: oneOf(['publication', 'okabe-ito', 'greyscale', 'kherve-green'], 'The series colours (okabe-ito is colour-blind safe).'),
          size: oneOf(['screen', 'single', 'onehalf', 'double', 'slide', 'square'], 'Figure size: single = 86 mm column, onehalf = 120 mm, double = 178 mm, slide = 16:9.'),
        },
      ),
    },
    {
      action: 'set_axis',
      description: 'Set one axis: scale (linear, log10, ln), limits, reversed direction (e.g. binding energy), grid. y2 is the right axis.',
      inputSchema: object(
        {
          axis: oneOf(['x', 'y', 'y2'], 'Which axis.'),
          scale: oneOf(['linear', 'log10', 'ln'], 'log10 shows decades; ln shows the natural logarithm of the values.'),
          min: str('The lowest value shown: a number, or "auto".'),
          max: str('The highest value shown: a number, or "auto".'),
          invert: bool('Reverse the axis (large values on the left / bottom).'),
          grid: bool('Show grid lines.'),
        },
        ['axis'],
      ),
    },
    {
      action: 'add_overlay',
      description: 'Add to the plot: a "fit" line (returns coefficients and R²), a reference "line", a text "note", a shaded "region", or "clear" them all. The argument notes say what each kind uses.',
      inputSchema: object(
        {
          kind: oneOf(['fit', 'line', 'note', 'region', 'clear'], 'What to add.'),
          target: str('fit: the y column (name or number from 1). line: x, y or y2. region: x or y.'),
          value: str('line: its value. note: x. region: where it starts.'),
          to: str('note: y. region: where it ends.'),
          text: str('A label or the note text (H_2O, m^2, \\alpha are formatted).'),
          degree: str('fit: polynomial degree 1–6 (default 1).'),
        },
        ['kind'],
      ),
    },
    {
      action: 'save',
      description: 'Save the plot shown in kPlot as an SVG file in Documents/kPlot. Returns its path.',
      inputSchema: object({ name: str('A file name (without .svg); default: the title or "plot".') }),
    },
    {
      action: 'export',
      description: 'Export the plot to Documents/kPlot as png (1, 2 or 4 ×), svg or plotly_svg; copy the image to the clipboard; or get the SVG markup as svg_text.',
      inputSchema: object(
        {
          format: oneOf(['png', 'svg', 'plotly_svg', 'clipboard', 'svg_text'], 'The output.'),
          scale: str('png: 1, 2 or 4 (default 2).'),
          name: str('A file name without extension.'),
          engine: oneOf(['plotly', 'svg'], 'png / clipboard: which engine draws it (default: the one shown).'),
        },
        ['format'],
      ),
    },
  ],
}
