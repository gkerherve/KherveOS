// The words of a talk (the desktop's vocabulary.py): the names, acronyms and
// technical terms found in the notes, suggested for the "Words in this talk"
// box that is kept with the note and given to the AI.

// Acronyms and formulas (XPS, ToF-SIMS, LLZO, Li7La3Zr2O12), words with a capital
// inside or a hyphen (KherveFitting, Hall-Petch), and capitalised names that
// are not at the start of a sentence (Tougaard, Shirley).
const TOKEN = /\b[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*\b/g
const COMMON = new Set(
  `The This That These Those There Then When Where What Which While With
Without From For And But Not Note Notes Page Section Figure Table Summary Key Question
Introduction Conclusion Methods Results Discussion Abstract References Today Next First
Second Third Finally However Also Here Each Every All Some Most Our Their They We You
It Its In On At By Of To As An If Or So No Yes Dr Prof Mr Mrs Ms`.split(/\s+/),
)

const upperCount = (w: string) => [...w].filter((c) => c >= 'A' && c <= 'Z').length

function interesting(word: string): boolean {
  if (COMMON.has(word) || word.length < 2) return false
  const upper = upperCount(word)
  return upper >= 2 || (word.includes('-') && upper >= 1) || (/\d/.test(word) && upper >= 1)
}

const isTitleCase = (w: string) => /^[A-Z]/.test(w) && w.slice(1) === w.slice(1).toLowerCase() && /[a-z]/.test(w.slice(1))

/** Terms worth listening for, most frequent first, without the ones already in `known`. */
export function suggest(texts: string[], limit = 30, known = ''): string[] {
  const have = new Set(known.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean))
  const counts = new Map<string, number>()
  const names = new Map<string, number>()
  const bump = (m: Map<string, number>, w: string, n = 1) => m.set(w, (m.get(w) ?? 0) + n)
  for (const text of texts) {
    for (const sentence of text.split(/(?<=[.!?:;])\s+|\n/)) {
      const words = sentence.match(TOKEN) ?? []
      words.forEach((w, i) => {
        if (interesting(w)) bump(counts, w)
        else if (i > 0 && isTitleCase(w) && !COMMON.has(w) && w.length > 3) bump(names, w)
      })
    }
  }
  // A name used twice is worth having.
  for (const [w, n] of names) if (n >= 2) bump(counts, w, n)
  const out: string[] = []
  const ranked = [...counts.entries()].map(([w, n], i) => ({ w, n, i })).sort((a, b) => b.n - a.n || a.i - b.i)
  for (const { w } of ranked) {
    if (!have.has(w.toLowerCase()) && !out.some((o) => o.toLowerCase() === w.toLowerCase())) out.push(w)
    if (out.length >= limit) break
  }
  return out
}

export function merge(known: string, extra: string[]): string {
  const words = known.split(',').map((w) => w.trim()).filter(Boolean)
  for (const w of extra) if (!words.some((x) => x.toLowerCase() === w.toLowerCase())) words.push(w)
  return words.join(', ')
}
