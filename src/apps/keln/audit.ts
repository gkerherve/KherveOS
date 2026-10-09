// Verifying a notebook (pure): recompute the audit chain and every signed hash, and say exactly which record or entry
// does not match. This is a tamper-EVIDENT record kept in a file: it shows that a record was changed after the fact, it
// does not stop someone who rewrites the whole file and every hash. It is not a certified 21 CFR Part 11 system.

import { sha256File } from './hash.ts'
import { addendumHash, entryHash, getEntry, recordHash, type Notebook } from './model.ts'
import { base64ToBytes } from './hash.ts'

export interface Issue {
  level: 'error' | 'warning'
  /** The audit record (1-based) the problem is at, or null for one that is not tied to a record. */
  seq: number | null
  entryId: string
  message: string
}

export interface VerifyReport {
  ok: boolean
  records: number
  signedEntries: number
  /** The first record that does not match (the chain cannot be trusted after it), or null. */
  firstBadSeq: number | null
  issues: Issue[]
}

const short = (h: string): string => (h ? h.slice(0, 12) : '(none)')

/** Everything that can be checked without reading files: the chain, signatures, witnesses, addenda, embedded attachments. */
export async function verifyNotebook(nb: Notebook): Promise<VerifyReport> {
  const issues: Issue[] = []
  const err = (seq: number | null, entryId: string, message: string) => issues.push({ level: 'error', seq, entryId, message })
  let firstBad: number | null = null
  const flag = (seq: number) => { if (firstBad == null) firstBad = seq }

  // 1. the chain
  let prevRec = ''
  nb.audit.forEach((r, i) => {
    const seq = i + 1
    if (r.seq !== seq) {
      err(seq, r.entryId, `Record ${seq} is numbered ${r.seq}: a record was removed, added or moved.`)
      flag(seq)
    }
    if (r.prev !== prevRec) {
      err(seq, r.entryId, `Record ${seq} (${r.action}${r.number ? `, ${r.number}` : ''}) does not follow the record before it: a record was removed, inserted or changed there.`)
      flag(seq)
    }
    if (recordHash(r) !== r.rec) {
      err(seq, r.entryId, `Record ${seq} (${r.action}${r.number ? `, ${r.number}` : ''} by ${r.user}, ${r.time}) was altered: its hash is ${short(recordHash(r))}… but the log says ${short(r.rec)}….`)
      flag(seq)
    }
    prevRec = r.rec
  })

  // 2. signatures, witnesses, addenda against the log
  let signed = 0
  const recordsFor = (entryId: string, action: string) => nb.audit.map((r, i) => ({ r, seq: i + 1 })).filter((x) => x.r.entryId === entryId && x.r.action === action)
  for (const e of nb.entries) {
    if (e.status === 'draft') {
      if (e.signature || e.witness) err(null, e.id, `${e.experiment} is a draft but carries a signature.`)
      continue
    }
    signed++
    const now = entryHash(e)
    const signedRecs = recordsFor(e.id, 'entry-signed')
    const seqS = signedRecs[signedRecs.length - 1]?.seq ?? null
    if (!e.signature) err(seqS, e.id, `${e.experiment} is marked ${e.status} but has no signature.`)
    else {
      if (e.signature.hash !== now) err(seqS, e.id, `${e.experiment} “${e.title}” was changed after ${e.signature.user} signed it (hash now ${short(now)}…, signed ${short(e.signature.hash)}…).`)
      if (!signedRecs.some((x) => x.r.hash === e.signature!.hash)) err(seqS, e.id, `${e.experiment} has a signature that the audit log does not record.`)
    }
    if (e.status === 'witnessed') {
      const wRecs = recordsFor(e.id, 'entry-witnessed')
      const seqW = wRecs[wRecs.length - 1]?.seq ?? null
      if (!e.witness) err(seqW, e.id, `${e.experiment} is marked witnessed but has no witness.`)
      else {
        if (e.witness.hash !== now) err(seqW, e.id, `${e.experiment} was changed after ${e.witness.user} witnessed it.`)
        if (!wRecs.some((x) => x.r.hash === e.witness!.hash)) err(seqW, e.id, `${e.experiment} has a witness that the audit log does not record.`)
      }
    }
    const amended = recordsFor(e.id, 'entry-amended')
    for (const a of e.addenda) {
      const expected = addendumHash(e.signature?.hash ?? now, a)
      if (a.hash !== expected) err(amended.find((x) => x.r.hash === a.hash)?.seq ?? null, e.id, `An addendum to ${e.experiment} (by ${a.author}, ${a.time}) was altered.`)
      if (!amended.some((x) => x.r.hash === a.hash)) err(null, e.id, `An addendum to ${e.experiment} is not in the audit log.`)
    }
  }
  // signed in the log but gone from the notebook
  for (const [i, r] of nb.audit.entries()) {
    if (r.action === 'entry-signed' && !getEntry(nb, r.entryId) && !nb.audit.some((x) => x.action === 'entry-deleted' && x.entryId === r.entryId)) {
      err(i + 1, r.entryId, `${r.number || r.entryId} was signed but is missing from the notebook (and was not deleted through kELN).`)
    }
  }

  // 3. embedded attachments
  for (const e of nb.entries) {
    for (const a of e.attachments) {
      if (a.data == null) continue
      let hash = ''
      try { hash = await sha256File(base64ToBytes(a.data)) } catch { hash = '' }
      if (hash !== a.sha256) err(null, e.id, `The attachment “${a.name}” in ${e.experiment} does not match the hash recorded when it was added.`)
    }
  }

  return { ok: issues.length === 0, records: nb.audit.length, signedEntries: signed, firstBadSeq: firstBad, issues }
}

/** One line for the status bar / dialog. */
export function reportSummary(r: VerifyReport): string {
  if (r.ok) return `Verified: ${r.records} audit records chain correctly and ${r.signedEntries} signed ${r.signedEntries === 1 ? 'entry matches' : 'entries match'} their signatures.`
  const first = r.issues[0]
  return `${r.issues.length} problem${r.issues.length === 1 ? '' : 's'} found${r.firstBadSeq != null ? `, first at audit record ${r.firstBadSeq}` : ''}: ${first.message}`
}
