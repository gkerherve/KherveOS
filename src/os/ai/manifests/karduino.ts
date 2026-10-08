// AI tools of kArduino (Arduino sketches: edit, compile and upload on the KherveOS server, examples,
// serial monitor). ≤ 6 arguments each. The code is in src/apps/karduino/aiTools.ts.

import type { AppToolSet } from '../appToolsCore.ts'
import { int, object, str } from './schema.ts'

export const KARDUINO_TOOL_SET: AppToolSet = {
  app: 'karduino',
  name: 'kArduino',
  summary: 'Arduino sketches: edit, compile, upload, 25 examples, serial monitor.',
  keywords: ['karduino', 'arduino', 'sketch', 'ino', 'microcontroller', 'board', 'serial', 'uno', 'esp', 'led', 'compile', 'upload', 'example', 'servo', 'sensor'],
  tools: [
    {
      action: 'get_sketch',
      description: 'The sketch open in kArduino: its name, the board, the code of the main file and the names of all its files.',
      inputSchema: object({}),
    },
    {
      action: 'set_sketch',
      description: 'Replace the code of the main file of the sketch open in kArduino (not saved until the user saves it or kArduino save is used).',
      inputSchema: object({ code: str('The whole sketch: setup() and loop().') }, ['code']),
    },
    {
      action: 'compile',
      description: 'Compile the sketch open in kArduino for its board on the KherveOS server. Returns ok, the compiler output, the problems as {file, line, col, severity, message} and the size (flash and RAM).',
      inputSchema: object({}),
    },
    {
      action: 'save',
      description: 'Save the sketch as a folder in Documents/kArduino (name/name.ino plus its other files) and return the path.',
      inputSchema: object({}),
    },
    {
      action: 'serial_read',
      description: 'The last lines the board printed in the kArduino serial monitor, and whether it is connected.',
      inputSchema: object({ lines: int('How many lines (1–200, default 20).') }),
    },
    {
      action: 'serial_send',
      description: 'Send one line to the board over the serial monitor (asks the user first). The monitor must be connected.',
      inputSchema: object({ text: str('The line to send.') }, ['text']),
    },
    {
      action: 'load_example',
      description: 'Load one of the built-in examples (Blink, Fade, Servo sweep, HC-SR04, DHT, LCD, NeoPixel, Morse…) into kArduino; its board is set too and the result tells the wiring and the libraries to install. Without id it lists the examples (id, title, category).',
      inputSchema: object({ id: str('The example id, e.g. "blink" or "servo". Leave empty to list them.') }),
    },
    {
      action: 'upload',
      description: 'Compile and upload the sketch to a board plugged into the computer the KherveOS server runs on (asks the user first). The web page itself cannot flash a board.',
      inputSchema: object({}),
    },
    {
      action: 'set_board',
      description: 'Choose the board kArduino compiles for: a name such as "Arduino Uno", "Arduino Mega 2560", "ESP32 Dev Module", or a full name like arduino:avr:nano:cpu=atmega328.',
      inputSchema: object({ board: str('The board name or its fully qualified name (fqbn).') }, ['board']),
    },
    {
      action: 'add_file',
      description: 'Add another file (a tab) to the sketch: a header (.h), .cpp, .c, .hpp or an extra .ino. Plain file name, no folder.',
      inputSchema: object({ name: str('File name, e.g. "motor.h".'), content: str('The whole file.') }, ['name', 'content']),
    },
  ],
}
