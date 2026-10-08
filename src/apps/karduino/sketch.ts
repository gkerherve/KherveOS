// The sketch as tabs, names and checks (pure: no React, no "@/" imports).

export interface SketchFile {
  name: string
  content: string
}

export const EXTRA_EXTENSIONS = ['.ino', '.h', '.cpp', '.c', '.hpp']
export const MAX_FILES = 12
export const MAX_FILE_CHARS = 100_000
export const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 500000, 1000000]

const TAB_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/

/** Why a tab name is not allowed (the server checks the same), or null when it is fine. */
export function tabNameProblem(name: string, others: string[], mainName?: string): string | null {
  if (!TAB_NAME.test(name) || name.includes('..')) return 'Use letters, digits, _ - and one dot, with no folder.'
  const dot = name.lastIndexOf('.')
  const ext = dot < 0 ? '' : name.slice(dot).toLowerCase()
  if (!EXTRA_EXTENSIONS.includes(ext)) return `The file must end in ${EXTRA_EXTENSIONS.join(', ')}.`
  const taken = [...others, ...(mainName ? [mainName] : [])].map((o) => o.toLowerCase())
  if (taken.includes(name.toLowerCase()) || name.toLowerCase() === 'sketch.ino') return 'There is a file with this name already.'
  return null
}

/** A sketch name that makes a safe folder and `.ino` name ("My sketch!" -> "My_sketch"). */
export function safeSketchName(name: string): string {
  const s = name.replace(/\.ino$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return (s || 'sketch').slice(0, 60)
}

/** The body for /api/arduino/compile: `code` is the main tab, `files` the other tabs. */
export function toRequest(files: SketchFile[], board: string): { code: string; files: SketchFile[]; board: string } {
  return { code: files[0]?.content ?? '', files: files.slice(1).map((f) => ({ name: f.name, content: f.content })), board }
}

/** Names the compiler may print for this sketch (the main tab is "sketch.ino" on the server). */
export const serverNames = (files: SketchFile[]): string[] => ['sketch.ino', ...files.slice(1).map((f) => f.name)]

/** The tab index a server file name stands for (0 = main), or -1. */
export function tabOf(files: SketchFile[], serverFile: string): number {
  if (serverFile === 'sketch.ino') return 0
  return files.findIndex((f, i) => i > 0 && f.name === serverFile)
}

/** Braces, brackets and parentheses balance, ignoring comments, strings and characters. */
export function balanced(code: string): boolean {
  const s = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
  const stack: string[] = []
  const close: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  for (const ch of s) {
    if ('([{'.includes(ch)) stack.push(ch)
    else if (ch in close && stack.pop() !== close[ch]) return false
  }
  return stack.length === 0
}

/** The baud rate in `Serial.begin(N)`, if the sketch has one. */
export function detectBaud(code: string): number | null {
  const m = /\bSerial\d?\.begin\s*\(\s*(\d+)/.exec(code.replace(/\/\/[^\n]*/g, ''))
  return m ? Number(m[1]) : null
}

/** Library headers the sketch includes: `#include <Servo.h>` -> "Servo". */
export function includesOf(code: string): string[] {
  const out: string[] = []
  for (const m of code.matchAll(/^\s*#\s*include\s*<([\w./-]+)\.h>/gm)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/** Headers that come with the Arduino core (no library to install). */
export const BUILTIN_HEADERS = ['Arduino', 'Wire', 'SPI', 'EEPROM', 'Servo', 'Stepper', 'SoftwareSerial', 'LiquidCrystal', 'SD', 'Ethernet', 'avr/pgmspace', 'avr/sleep', 'avr/wdt', 'avr/io', 'avr/interrupt', 'WiFi', 'math', 'string', 'stdlib', 'stdio']

/** Headers whose library has another name in the library index. */
const HEADER_LIBRARY: Record<string, string> = {
  DHT: 'DHT sensor library',
  LiquidCrystal_I2C: 'LiquidCrystal I2C',
  Adafruit_Sensor: 'Adafruit Unified Sensor',
  Adafruit_GFX: 'Adafruit GFX Library',
  Adafruit_SSD1306: 'Adafruit SSD1306',
  Adafruit_NeoPixel: 'Adafruit NeoPixel',
  FastLED: 'FastLED',
  OneWire: 'OneWire',
  DallasTemperature: 'DallasTemperature',
  PubSubClient: 'PubSubClient',
  ArduinoJson: 'ArduinoJson',
}

/** The library to install for an included header: "Adafruit_NeoPixel" -> "Adafruit NeoPixel". */
export const libraryForHeader = (header: string): string => HEADER_LIBRARY[header] ?? header.replace(/_/g, ' ')

export function lineEnding(kind: 'none' | 'nl' | 'cr' | 'crnl'): string {
  return kind === 'nl' ? '\n' : kind === 'cr' ? '\r' : kind === 'crnl' ? '\r\n' : ''
}

/** "12:03:44.512" for a serial log. */
export function stamp(t: number): string {
  const d = new Date(t)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}
