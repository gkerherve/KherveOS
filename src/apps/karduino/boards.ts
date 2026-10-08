// The boards kArduino offers first (pure data: no React, no "@/" imports).
// Keep the FQBNs in step with CURATED_BOARDS in server/kherveos_server/arduino.py
// (tools/tests/karduino.test.ts checks it).

/** Which pin layout the Wiring panel can draw. */
export type Family = 'uno' | 'mega' | 'other'

export interface BoardInfo {
  id: string
  name: string
  /** Fully qualified board name, as arduino-cli wants it. */
  fqbn: string
  family: Family
}

export const BOARDS: BoardInfo[] = [
  { id: 'uno', name: 'Arduino Uno', fqbn: 'arduino:avr:uno', family: 'uno' },
  { id: 'unor4wifi', name: 'Arduino Uno R4 WiFi', fqbn: 'arduino:renesas_uno:unor4wifi', family: 'uno' },
  { id: 'unor4minima', name: 'Arduino Uno R4 Minima', fqbn: 'arduino:renesas_uno:minima', family: 'uno' },
  { id: 'nano', name: 'Arduino Nano', fqbn: 'arduino:avr:nano:cpu=atmega328', family: 'uno' },
  { id: 'nanoold', name: 'Arduino Nano (old bootloader)', fqbn: 'arduino:avr:nano:cpu=atmega328old', family: 'uno' },
  { id: 'nanoevery', name: 'Arduino Nano Every', fqbn: 'arduino:megaavr:nona4809', family: 'other' },
  { id: 'mega', name: 'Arduino Mega 2560', fqbn: 'arduino:avr:mega:cpu=atmega2560', family: 'mega' },
  { id: 'leonardo', name: 'Arduino Leonardo', fqbn: 'arduino:avr:leonardo', family: 'other' },
  { id: 'micro', name: 'Arduino Micro', fqbn: 'arduino:avr:micro', family: 'other' },
  { id: 'promini', name: 'Arduino Pro Mini (5 V, 16 MHz)', fqbn: 'arduino:avr:pro:cpu=16MHzatmega328', family: 'uno' },
  { id: 'due', name: 'Arduino Due (programming port)', fqbn: 'arduino:sam:arduino_due_x_dbg', family: 'other' },
  { id: 'mkrwifi1010', name: 'Arduino MKR WiFi 1010', fqbn: 'arduino:samd:mkrwifi1010', family: 'other' },
  { id: 'esp32', name: 'ESP32 Dev Module', fqbn: 'esp32:esp32:esp32', family: 'other' },
  { id: 'nodemcu', name: 'ESP8266 NodeMCU 1.0', fqbn: 'esp8266:esp8266:nodemcuv2', family: 'other' },
  { id: 'pico', name: 'Raspberry Pi Pico', fqbn: 'rp2040:rp2040:rpipico', family: 'other' },
]

export const DEFAULT_BOARD = 'arduino:avr:uno'

/** The same pattern the server accepts. */
const FQBN = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+(:[A-Za-z0-9_.=,-]+)?$/

export const validFqbn = (s: string): boolean => FQBN.test(s)

export const boardByFqbn = (fqbn: string): BoardInfo | undefined => BOARDS.find((b) => b.fqbn === fqbn)

/** "arduino:avr:uno" -> "arduino:avr" (the core to install). */
export const coreOf = (fqbn: string): string => fqbn.split(':').slice(0, 2).join(':')

export function familyOf(fqbn: string): Family {
  const known = boardByFqbn(fqbn)
  if (known) return known.family
  const [pkg, arch, board] = fqbn.split(':')
  if (pkg === 'arduino' && arch === 'avr') return board === 'mega' ? 'mega' : board === 'uno' || board === 'nano' || board === 'pro' ? 'uno' : 'other'
  return 'other'
}

export const boardName = (fqbn: string): string => boardByFqbn(fqbn)?.name ?? fqbn
