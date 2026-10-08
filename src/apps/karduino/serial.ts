// The serial monitor of kArduino: the Web Serial API (Chrome and Edge). A board plugged
// in over USB shows up after the user picks it; the page then reads and writes lines.
// Other browsers do not have Web Serial: the monitor says so instead of failing.
// Web Serial can read and write the port but cannot flash a board: uploading is done by
// the server (arduino-cli on the computer the board is plugged into) or the Arduino IDE.

import { lineEnding } from './sketch.ts'

export type LineEnding = 'none' | 'nl' | 'cr' | 'crnl'

// The part of the Web Serial API used here (the DOM typings do not include it yet).
interface SerialPortLike {
  readable?: ReadableStream<Uint8Array> | null
  writable?: WritableStream<BufferSource> | null
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  setSignals?(signals: { dataTerminalReady?: boolean; requestToSend?: boolean; break?: boolean }): Promise<void>
}
interface SerialApi {
  requestPort(): Promise<SerialPortLike>
  addEventListener?(type: 'disconnect', fn: (e: Event) => void): void
  removeEventListener?(type: 'disconnect', fn: (e: Event) => void): void
}

const serialApi = (): SerialApi | undefined => (typeof navigator !== 'undefined' ? (navigator as unknown as { serial?: SerialApi }).serial : undefined)

export function serialSupported(): boolean {
  return serialApi() !== undefined
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class SerialMonitor {
  private port: SerialPortLike | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<BufferSource> | null = null
  private running = false
  private onLine: (line: string, time: number) => void
  private onState: (open: boolean, note?: string) => void
  private onUnplug = (e: Event) => {
    const target = (e as Event & { target?: unknown }).target
    if (target === this.port) void this.close('The board was unplugged: the serial monitor is disconnected.')
  }

  constructor(onLine: (line: string, time: number) => void, onState: (open: boolean, note?: string) => void) {
    this.onLine = onLine
    this.onState = onState
  }

  get isOpen(): boolean {
    return this.port !== null
  }

  /**
   * Ask for a board (needs a click) and open it at the baud rate.
   * `reset`: pulse DTR after opening, which restarts most boards (so setup() runs again and
   * the first lines are not missed); off: DTR is held low where the port allows it.
   */
  async open(baudRate: number, reset = true): Promise<void> {
    const api = serialApi()
    if (!api) throw new Error('This browser has no Web Serial. Use Chrome or Edge to talk to a board.')
    const port = await api.requestPort()
    await port.open({ baudRate })
    this.port = port
    this.running = true
    this.reader = port.readable?.getReader() ?? null
    this.writer = port.writable?.getWriter() ?? null
    api.addEventListener?.('disconnect', this.onUnplug)
    let note: string | undefined
    if (typeof port.setSignals === 'function') {
      try {
        if (reset) {
          await port.setSignals({ dataTerminalReady: false, requestToSend: false })
          await sleep(100)
          await port.setSignals({ dataTerminalReady: true, requestToSend: true })
        } else {
          await port.setSignals({ dataTerminalReady: false, requestToSend: false })
        }
      } catch {
        note = 'This port would not change the DTR line: the board may or may not have restarted.'
      }
    } else if (reset) {
      note = 'This browser cannot toggle DTR: the board restarts only if opening the port does it.'
    }
    this.onState(true, note)
    void this.readLoop()
  }

  private async readLoop() {
    let buf = ''
    const decoder = new TextDecoder()
    try {
      while (this.running && this.reader) {
        const { value, done } = await this.reader.read()
        if (done) break
        buf += value ? decoder.decode(value, { stream: true }) : ''
        let i: number
        while ((i = buf.search(/\r?\n|\r(?!$)/)) >= 0) {
          const end = buf.startsWith('\r\n', i) ? i + 2 : i + 1
          this.onLine(buf.slice(0, i), Date.now())
          buf = buf.slice(end)
        }
      }
    } catch (e) {
      if (this.running) void this.close(e instanceof Error ? e.message : String(e))
      return
    }
    if (this.running) void this.close('The serial port closed.')
  }

  /** Send text followed by the chosen line ending. */
  async send(text: string, ending: LineEnding = 'nl'): Promise<void> {
    if (!this.writer) throw new Error('The serial port is not open.')
    await this.writer.write(new TextEncoder().encode(text + lineEnding(ending)))
  }

  async close(note?: string): Promise<void> {
    if (!this.port && !this.running) return
    this.running = false
    serialApi()?.removeEventListener?.('disconnect', this.onUnplug)
    const { reader, writer, port } = this
    this.reader = null
    this.writer = null
    this.port = null
    try { await reader?.cancel() } catch { /* already closed */ }
    try { reader?.releaseLock() } catch { /* already released */ }
    try { writer?.releaseLock() } catch { /* already released */ }
    try { await port?.close() } catch { /* already closed */ }
    this.onState(false, note)
  }
}
