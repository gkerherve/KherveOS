// AI tools of Terminal and Viewer (see ../appManifest.ts for how app tools work).
// The code: src/apps/terminal/aiTools.ts and src/apps/viewer/aiTools.ts.

import type { AppToolSet } from '../appToolsCore.ts'
import { int, num, object, oneOf, str } from './schema.ts'

export const TERMINAL_VIEWER_TOOL_SETS: AppToolSet[] = [
  {
    app: 'terminal',
    name: 'Terminal',
    summary: 'a shell over the KherveOS drive (ls, cd, cat, grep, python…).',
    keywords: ['terminal', 'shell', 'command line', 'bash', 'console'],
    tools: [
      {
        action: 'run_command',
        description:
          'Run one command line in the Terminal, where the user sees it typed and its output (the user is asked first). ' +
          'Waits for it to finish and returns the output and exit status. Pipes, > and && work; "help" lists the commands.',
        inputSchema: object(
          {
            command: str('The command line, e.g. "ls -l ~/Documents" or "python script.py". One line.'),
            cwd: str('Folder to run it in, e.g. "~/Documents" (default: the Terminal\'s current folder).'),
            timeout: int('Seconds to wait for it to finish (default 60, at most 240). It keeps running after that.'),
          },
          ['command'],
        ),
      },
      {
        action: 'read_output',
        description: 'Read the text on the Terminal screen and scrollback (the latest lines), its current folder and whether a command is running.',
        inputSchema: object({ lines: int('How many of the latest lines (default 100, at most 2000).') }),
        readOnly: true,
      },
      {
        action: 'interrupt',
        description: 'Press Ctrl+C in the Terminal: stops the running command (running Python is restarted, so its variables are lost).',
        inputSchema: object({}),
      },
    ],
  },
  {
    app: 'viewer',
    name: 'Viewer',
    summary: 'shows pictures (PNG, JPEG, GIF, SVG, WebP…) and PDFs from the drive.',
    keywords: ['viewer', 'image', 'images', 'picture', 'pictures', 'photo', 'photos', 'png', 'jpeg', 'jpg'],
    tools: [
      {
        action: 'open',
        description: 'Show a picture or a PDF from the drive in the Viewer, e.g. "~/Pictures/cat.png". Returns what is shown, as viewer_get_state.',
        inputSchema: object({ path: str('The file, e.g. "~/Pictures/photo.jpg" or "~/Documents/paper.pdf".') }, ['path']),
      },
      {
        action: 'show',
        description: 'Show the next, previous, first or last picture of the folder of the picture shown (by name order).',
        inputSchema: object({ which: oneOf(['next', 'previous', 'first', 'last'], 'Which picture.') }, ['which']),
      },
      {
        action: 'set_view',
        description: 'Zoom or rotate the picture shown: zoom "fit", "in", "out" or "actual" (100%), or a percent; rotate by ±90 or 180 degrees.',
        inputSchema: object({
          zoom: oneOf(['fit', 'in', 'out', 'actual'], 'Fit the window, zoom in or out a step, or show at 100%.'),
          percent: num('Zoom level in percent, 10 to 800 (instead of "zoom").'),
          rotate: int('Turn by this many degrees: 90 clockwise, -90 counter-clockwise, 180.'),
          rotation: int('Set the rotation itself: 0, 90, 180 or 270 degrees clockwise.'),
        }),
      },
      {
        action: 'get_state',
        description: 'What the Viewer shows: the file, its type and pixel size, its place in the folder, the zoom and the rotation.',
        inputSchema: object({}),
        readOnly: true,
      },
    ],
  },
]
