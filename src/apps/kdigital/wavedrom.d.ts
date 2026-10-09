// WaveDrom has no type declarations: only what kDigital uses.
declare module 'wavedrom' {
  export const waveSkin: Record<string, unknown>
  export function renderAny(index: number, source: unknown, skin: unknown, notFirstSignal?: boolean): unknown[]
  export const onml: { stringify(tree: unknown): string }
  const wavedrom: { waveSkin: typeof waveSkin; renderAny: typeof renderAny; onml: typeof onml }
  export default wavedrom
}
