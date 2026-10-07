// A ball (a circle) against the parts of a pinball table: line segments and
// capsules (segments with round ends), circles, thin arcs, and flippers
// (tapered capsules that turn). Each test says how the ball touches the part:
// the normal pointing at the ball, how deep it overlaps, and the touching
// point. The table moves the ball in small sub-steps, and each test also
// takes where the ball was before the sub-step: a centre that crossed a
// segment's middle line is pushed back out on the side it came from, so a
// ball can never be squeezed through a wall or a flipper.

export interface Hit {
  /** Unit normal from the surface towards the ball. */
  nx: number
  ny: number
  /** How much the ball overlaps the surface. */
  depth: number
  /** The touching point on the surface. */
  px: number
  py: number
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Where P falls along segment AB, as a fraction (0..1) of its length. */
export function segmentT(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return 0
  return clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1)
}

/** Which side of the line A→B the point P is on (+ or -), times the segment's length. */
export function side(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax)
}

/**
 * Ball of radius `r` at (x, y), which was at (ox, oy) a moment ago, against
 * a capsule from A to B with radius `sr` (and its radius at B, `srB`, for a
 * tapered one).
 */
export function hitCapsule(
  x: number, y: number, r: number, ox: number, oy: number,
  ax: number, ay: number, bx: number, by: number, sr: number, srB = sr,
): Hit | null {
  const t = segmentT(x, y, ax, ay, bx, by)
  const qx = ax + (bx - ax) * t
  const qy = ay + (by - ay) * t
  const rad = sr + (srB - sr) * t
  const reach = r + rad
  const dx = x - qx
  const dy = y - qy
  const d2 = dx * dx + dy * dy
  if (d2 >= reach * reach) return null
  const d = Math.sqrt(d2)

  if (t > 0 && t < 1) {
    const now = side(x, y, ax, ay, bx, by)
    const before = side(ox, oy, ax, ay, bx, by)
    if (now * before < 0 || d < 1e-9) {
      // The centre crossed the middle line: back out the way it came.
      const len = Math.hypot(bx - ax, by - ay)
      const s = before >= 0 ? 1 : -1
      const nx = (-(by - ay) / len) * s
      const ny = ((bx - ax) / len) * s
      return { nx, ny, depth: reach + d, px: qx + nx * rad, py: qy + ny * rad }
    }
  }
  if (d < 1e-9) {
    // Exactly on an end point: push away from the segment's direction.
    const len = Math.hypot(bx - ax, by - ay) || 1
    const nx = t <= 0 ? -(bx - ax) / len : (bx - ax) / len
    const ny = t <= 0 ? -(by - ay) / len : (by - ay) / len
    return { nx, ny, depth: reach, px: qx + nx * rad, py: qy + ny * rad }
  }
  const nx = dx / d
  const ny = dy / d
  return { nx, ny, depth: reach - d, px: qx + nx * rad, py: qy + ny * rad }
}

/** Ball against a solid circle (a bumper or a post). */
export function hitCircle(x: number, y: number, r: number, cx: number, cy: number, cr: number): Hit | null {
  const dx = x - cx
  const dy = y - cy
  const reach = r + cr
  const d2 = dx * dx + dy * dy
  if (d2 >= reach * reach) return null
  const d = Math.sqrt(d2)
  const nx = d > 1e-9 ? dx / d : 0
  const ny = d > 1e-9 ? dy / d : -1
  return { nx, ny, depth: reach - d, px: cx + nx * cr, py: cy + ny * cr }
}

/** Is angle `a` within the arc that turns from `a0` to `a1` (increasing)? */
export function angleIn(a: number, a0: number, a1: number): boolean {
  const TAU = Math.PI * 2
  const span = (((a1 - a0) % TAU) + TAU) % TAU || TAU
  const t = (((a - a0) % TAU) + TAU) % TAU
  return t <= span
}

/**
 * Ball inside a circular wall (the arch over the top of the table): the arc
 * of radius `R` round (cx, cy) from angle `a0` to `a1`. Pushes the ball back
 * towards the centre.
 */
export function hitArcInside(x: number, y: number, r: number, cx: number, cy: number, R: number, a0: number, a1: number): Hit | null {
  const dx = x - cx
  const dy = y - cy
  const dist = Math.hypot(dx, dy)
  if (dist < R - r || dist < 1e-9) return null
  if (!angleIn(Math.atan2(dy, dx), a0, a1)) return null
  const ux = dx / dist
  const uy = dy / dist
  return { nx: -ux, ny: -uy, depth: dist - (R - r), px: cx + ux * R, py: cy + uy * R }
}

/**
 * Bounces a ball's velocity off a surface that moves at (sx, sy) where they
 * touch. `e` is the bounciness (0..1); `friction` takes a little off the
 * sliding speed. Returns how hard it hit (the closing speed), 0 if the ball
 * was already leaving.
 */
export function bounce(ball: { vx: number; vy: number }, h: Hit, e: number, sx = 0, sy = 0, friction = 0): number {
  const rvx = ball.vx - sx
  const rvy = ball.vy - sy
  const vn = rvx * h.nx + rvy * h.ny
  if (vn >= 0) return 0
  // A ball that just rests on something doesn't bounce (no jitter).
  const k = -vn < 30 ? 0 : e
  const tx = rvx - vn * h.nx
  const ty = rvy - vn * h.ny
  ball.vx = sx + tx * (1 - friction) - k * vn * h.nx
  ball.vy = sy + ty * (1 - friction) - k * vn * h.ny
  return -vn
}

/** A flipper: a tapered capsule turning about its pivot. */
export interface FlipperShape {
  /** Pivot. */
  px: number
  py: number
  len: number
  /** Radius at the pivot and at the tip. */
  r1: number
  r2: number
  /** Current angle (radians, y down) and the angle a sub-step ago. */
  angle: number
  prev: number
}

export function flipperTip(f: FlipperShape, angle = f.angle): [number, number] {
  return [f.px + Math.cos(angle) * f.len, f.py + Math.sin(angle) * f.len]
}

/**
 * Ball against a flipper. The side the ball was on is judged against the
 * flipper as it was a sub-step ago, so a fast flip pushes the ball ahead of
 * it instead of passing through.
 */
export function hitFlipper(x: number, y: number, r: number, ox: number, oy: number, f: FlipperShape): Hit | null {
  const [bx, by] = flipperTip(f)
  const t = segmentT(x, y, f.px, f.py, bx, by)
  const qx = f.px + (bx - f.px) * t
  const qy = f.py + (by - f.py) * t
  const rad = f.r1 + (f.r2 - f.r1) * t
  const reach = r + rad
  const dx = x - qx
  const dy = y - qy
  const d2 = dx * dx + dy * dy
  if (d2 >= reach * reach) return null
  const d = Math.sqrt(d2)
  if (t > 0 && t < 1) {
    const [pbx, pby] = flipperTip(f, f.prev)
    const now = side(x, y, f.px, f.py, bx, by)
    const before = side(ox, oy, f.px, f.py, pbx, pby)
    if (now * before < 0 || d < 1e-9) {
      const s = before >= 0 ? 1 : -1
      const nx = -Math.sin(f.angle) * s
      const ny = Math.cos(f.angle) * s
      return { nx, ny, depth: reach + d, px: qx + nx * rad, py: qy + ny * rad }
    }
  }
  if (d < 1e-9) return { nx: 0, ny: -1, depth: reach, px: qx, py: qy - rad }
  const nx = dx / d
  const ny = dy / d
  return { nx, ny, depth: reach - d, px: qx + nx * rad, py: qy + ny * rad }
}

/** Does the move from O to P cross the segment A–B? (Sensors: rollovers, lanes.) */
export function crosses(ox: number, oy: number, px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  const d1 = side(ox, oy, ax, ay, bx, by)
  const d2 = side(px, py, ax, ay, bx, by)
  if (d1 * d2 > 0 || (d1 === 0 && d2 === 0)) return false
  const d3 = side(ax, ay, ox, oy, px, py)
  const d4 = side(bx, by, ox, oy, px, py)
  return d3 * d4 <= 0
}
