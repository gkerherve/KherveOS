// Keyboard input for the first-person games (Last Train, Rune Keep).
// Games use physical key codes (KeyW…), which follow the key's position, so
// WASD is ZQSD on an AZERTY keyboard by itself. Some keyboards, remote
// desktops and virtual machines send no code; then the typed letter decides.

const BY_KEY: Record<string, string> = {
  w: 'KeyW', z: 'KeyW', a: 'KeyA', q: 'KeyA', s: 'KeyS', d: 'KeyD', r: 'KeyR', e: 'KeyE',
  ' ': 'Space', spacebar: 'Space', shift: 'ShiftLeft', escape: 'Escape', enter: 'Enter',
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
}

export function gameCode(e: KeyboardEvent): string {
  if (e.code && e.code !== 'Unidentified') return e.code
  const k = (e.key ?? '').toLowerCase()
  if (/^[0-9]$/.test(k)) return 'Digit' + k
  return BY_KEY[k] ?? ''
}
