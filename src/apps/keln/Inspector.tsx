// The right panel: metadata and hash of the entry, linked samples, instruments, attachments (with their SHA-256),
// links, and the entry's audit trail.

import { useState } from 'react'
import { Check, ExternalLink, FileText, FlaskConical, Image as ImageIcon, Link2, Microscope, Paperclip, Plus, ShieldAlert, Trash2, X } from 'lucide-react'
import { docInstruments } from './doc'
import { fileSize } from './blocks'
import { checkAttachment, isImage } from './files'
import { entryHash, getSample, linkedSamples, type Attachment, type Entry, type EntryLink, type Notebook } from './model'
import { stamp } from './ui'

interface Props {
  nb: Notebook
  entry: Entry
  readOnly: boolean
  attUrl(id: string): string | null
  onOpenSample(id: string): void
  onLinkSample(id: string): void
  onUnlinkSample(id: string): void
  onOpenAttachment(a: Attachment): void
  onRemoveAttachment(id: string): void
  onAttach(): void
  onAddLink(): void
  onRemoveLink(i: number): void
  onOpenLink(l: EntryLink): void
  onOpenAudit(): void
  onOpenEntry(id: string): void
  /** Files dragged in from the Files app (paths) or from the computer. */
  onDropFiles(paths: string[], files: File[]): void
}

const DRAG_MIME = 'application/x-kherveos-paths'

export function Inspector(p: Props) {
  const { nb, entry } = p
  const samples = linkedSamples(entry)
  const instruments = docInstruments(entry.content)
  const [checks, setChecks] = useState<Record<string, 'ok' | 'changed' | 'missing' | 'checking'>>({})
  const audit = nb.audit.filter((r) => r.entryId === entry.id)
  const unlinked = nb.samples.filter((s) => !samples.includes(s.id))
  const hash = entryHash(entry)
  return (
    <aside className="ln-inspector" aria-label="Inspector"
      onDragOver={(e) => { if (!p.readOnly && (e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes('Files'))) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDrop={(e) => {
        if (p.readOnly) return
        e.preventDefault()
        let paths: string[] = []
        try { paths = e.dataTransfer.getData(DRAG_MIME) ? (JSON.parse(e.dataTransfer.getData(DRAG_MIME)) as string[]) : [] } catch { paths = [] }
        p.onDropFiles(paths, [...e.dataTransfer.files])
      }}>
      <section>
        <h4>Record</h4>
        <dl className="ln-dl">
          <dt>Experiment</dt><dd>{entry.experiment}</dd>
          <dt>Status</dt><dd>{entry.status}{entry.addenda.length ? `, amended ×${entry.addenda.length}` : ''}</dd>
          <dt>Created</dt><dd>{stamp(entry.created)} UTC</dd>
          <dt>Content hash</dt><dd className="ln-hash" title={hash}>{hash.slice(0, 20)}…</dd>
        </dl>
      </section>

      <section>
        <h4><FlaskConical size={13} /> Samples</h4>
        {samples.length === 0 && <p className="ln-side-empty">None linked. Type @ in the text, or add one here.</p>}
        <ul className="ln-list">
          {samples.map((id) => {
            const s = getSample(nb, id)
            return (
              <li key={id}>
                <button className="ln-linkbtn" onClick={() => p.onOpenSample(id)} title={s ? `${s.name} · ${s.status}` : 'Not in the register'}>{id}</button>
                <span className="ln-li-sub">{s?.name ?? <i>not in the register</i>}</span>
                {!p.readOnly && entry.samples.includes(id) && <button className="k-icon-btn ln-mini" aria-label={`Unlink ${id}`} onClick={() => p.onUnlinkSample(id)}><X size={11} /></button>}
              </li>
            )
          })}
        </ul>
        {!p.readOnly && unlinked.length > 0 && (
          <select className="k-input ln-sel" value="" aria-label="Link a sample" onChange={(e) => e.target.value && p.onLinkSample(e.target.value)}>
            <option value="">Link a sample…</option>
            {unlinked.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
          </select>
        )}
      </section>

      {instruments.length > 0 && (
        <section>
          <h4><Microscope size={13} /> Instruments</h4>
          <ul className="ln-list">{instruments.map((i) => <li key={i}>{i}</li>)}</ul>
        </section>
      )}

      <section>
        <h4><Paperclip size={13} /> Attachments {!p.readOnly && <button className="k-icon-btn ln-mini" aria-label="Attach a file" title="Attach a file" onClick={p.onAttach}><Plus size={12} /></button>}</h4>
        {entry.attachments.length === 0 && <p className="ln-side-empty">No files. Drag one in from Files, or use Attach.</p>}
        <ul className="ln-list att">
          {entry.attachments.map((a) => {
            const url = isImage(a) ? p.attUrl(a.id) : null
            const c = checks[a.id]
            return (
              <li key={a.id}>
                {url ? <img className="ln-thumb" src={url} alt="" /> : isImage(a) ? <ImageIcon size={14} /> : <FileText size={14} />}
                <div className="ln-att-main">
                  <button className="ln-linkbtn" onClick={() => p.onOpenAttachment(a)} title="Open in the right app">{a.name}</button>
                  <span className="ln-li-sub">{fileSize(a.size)} · {a.data != null ? 'embedded' : a.path ? 'linked' : 'no file'} · <span title={a.sha256}>SHA-256 {a.sha256.slice(0, 10)}…</span></span>
                  {c && c !== 'checking' && <span className={`ln-check ${c}`}>{c === 'ok' ? <><Check size={11} /> matches the recorded hash</> : c === 'changed' ? <><ShieldAlert size={11} /> file changed since it was attached</> : <><ShieldAlert size={11} /> file not found</>}</span>}
                </div>
                <button className="k-btn small" onClick={() => { setChecks((s) => ({ ...s, [a.id]: 'checking' })); void checkAttachment(a).then((r) => setChecks((s) => ({ ...s, [a.id]: r }))) }} title="Recompute the SHA-256 and compare it with the one recorded">Check</button>
                {!p.readOnly && <button className="k-icon-btn ln-mini" aria-label={`Remove ${a.name}`} onClick={() => p.onRemoveAttachment(a.id)}><Trash2 size={11} /></button>}
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h4><Link2 size={13} /> Links {!p.readOnly && <button className="k-icon-btn ln-mini" aria-label="Add a link" title="Add a link" onClick={p.onAddLink}><Plus size={12} /></button>}</h4>
        {entry.links.length === 0 && <p className="ln-side-empty">Links to other entries, files in the drive (kTitration curves, data) or web pages.</p>}
        <ul className="ln-list">
          {entry.links.map((l, i) => (
            <li key={i}>
              <button className="ln-linkbtn" onClick={() => p.onOpenLink(l)} title={l.target}><ExternalLink size={11} /> {l.label || l.target}</button>
              {!p.readOnly && <button className="k-icon-btn ln-mini" aria-label="Remove link" onClick={() => p.onRemoveLink(i)}><X size={11} /></button>}
            </li>
          ))}
        </ul>
        <BackLinks nb={nb} entry={entry} onOpen={p.onOpenEntry} />
      </section>

      <section>
        <h4>Audit trail <button className="ln-linkbtn small" onClick={p.onOpenAudit}>full log</button></h4>
        <ol className="ln-trail">
          {audit.slice(-6).map((r) => <li key={r.seq}><span className="ln-seq">#{r.seq}</span> {r.action.replace('entry-', '')} <span className="k-muted">· {r.user} · {stamp(r.time)}</span></li>)}
          {audit.length === 0 && <li className="k-muted">No records.</li>}
        </ol>
      </section>
    </aside>
  )
}

function BackLinks({ nb, entry, onOpen }: { nb: Notebook; entry: Entry; onOpen(id: string): void }) {
  const back = nb.entries.filter((e) => e.id !== entry.id && e.links.some((l) => l.kind === 'entry' && l.target === entry.id))
  if (!back.length) return null
  return (
    <>
      <p className="ln-side-empty">Linked from:</p>
      <ul className="ln-list">{back.map((e) => <li key={e.id}><button className="ln-linkbtn" onClick={() => onOpen(e.id)}>{e.experiment} · {e.title}</button></li>)}</ul>
    </>
  )
}
