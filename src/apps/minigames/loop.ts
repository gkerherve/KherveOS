// The game loop: a game moves in equal, fixed steps (so its physics behave the
// same on every screen, at 60 Hz or 144 Hz) and is drawn once per animation
// frame. `alpha` tells the drawing how far the clock is between two steps, so
// fast things can be drawn smoothly in between.

/** Turns real elapsed time into a whole number of fixed steps. */
export class Stepper {
  private acc = 0
  private readonly maxSteps: number
  readonly step: number

  constructor(step: number) {
    this.step = step
    // Never catch up more than 0.1 s in one frame: a slow machine plays slower
    // instead of freezing in a spiral of ever longer frames.
    this.maxSteps = Math.max(1, Math.ceil(0.1 / step))
  }

  /** Runs `update` once per whole step in `elapsed` seconds; returns alpha (0..1). */
  advance(elapsed: number, update: (dt: number) => void): number {
    // After a stall (a background tab, a debugger) don't fast-forward the game.
    this.acc += Math.min(Math.max(elapsed, 0), 0.25)
    let n = 0
    while (this.acc >= this.step) {
      if (n++ >= this.maxSteps) {
        this.acc = 0
        break
      }
      update(this.step)
      this.acc -= this.step
    }
    return this.acc / this.step
  }

  reset() {
    this.acc = 0
  }
}

/**
 * Runs `update` every `step` seconds of real time and `render` once per
 * animation frame, until the returned function is called.
 */
export function runLoop(step: number, update: (dt: number) => void, render: (alpha: number, now: number) => void): () => void {
  const stepper = new Stepper(step)
  let last = performance.now()
  let id = requestAnimationFrame(function frame(now) {
    const alpha = stepper.advance((now - last) / 1000, update)
    last = now
    render(alpha, now)
    id = requestAnimationFrame(frame)
  })
  return () => cancelAnimationFrame(id)
}
