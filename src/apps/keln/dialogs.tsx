// The forms kELN opens over its window: new notebook, new entry, settings, project, addendum, link, formula, labels.

import { useMemo, useState } from 'react'
import { os, HOME, path as osPath } from '@/os'
import { Field, Html, Modal } from './ui'
import { renderMath } from './files'
import { getTemplate, templateGroups } from './templates'
import { DEFAULT_LABEL, type LabelOptions } from './samples'
import type { EntryLink, Notebook } from './model'
import { NOTEBOOK_DIR } from './useBook'

export interface NewNotebookValues {
  title: string
  owner: string
  folder: string
  projectCode: string
  projectName: string
  samplePrefix: string
}

export function NewNotebookDialog({ owner, onCreate, onClose }: { owner: string; onCreate(v: NewNotebookValues): void; onClose(): void }) {
  const [v, setV] = useState<NewNotebookValues>({ title: 'My lab notebook', owner, folder: NOTEBOOK_DIR, projectCode: 'LAB', projectName: 'General', samplePrefix: 'S' })
  const ok = v.title.trim() && v.owner.trim() && /^[A-Za-z0-9]{1,8}$/.test(v.projectCode.trim()) && /^[A-Za-z0-9]{1,6}$/.test(v.samplePrefix.trim())
  return (
    <Modal title="New notebook" onClose={onClose} footer={<><button className="k-btn" onClick={onClose}>Cancel</button><button className="k-btn primary" disabled={!ok} onClick={() => onCreate(v)}>Create notebook</button></>}>
      <form className="ln-form" onSubmit={(e) => { e.preventDefault(); if (ok) onCreate(v) }}>
        <Field label="Notebook title"><input className="k-input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Owner" hint="Signs and authors entries by default."><input className="k-input" value={v.owner} onChange={(e) => setV({ ...v, owner: e.target.value })} /></Field>
        <Field label="Folder" hint="The notebook is one .keln file in this folder, so it travels with Files, Git and backups.">
          <span className="ln-inline"><input className="k-input" value={v.folder} onChange={(e) => setV({ ...v, folder: e.target.value })} />
            <button type="button" className="k-btn" onClick={() => void os.dialog.pickFolder({ title: 'Folder for the notebook', startDir: v.folder }).then((f) => f && setV((s) => ({ ...s, folder: f })))}>Browse…</button></span>
        </Field>
        <div className="ln-two">
          <Field label="First project code" hint="Experiment numbers: CODE-2026-001"><input className="k-input" value={v.projectCode} onChange={(e) => setV({ ...v, projectCode: e.target.value.toUpperCase() })} /></Field>
          <Field label="Project name"><input className="k-input" value={v.projectName} onChange={(e) => setV({ ...v, projectName: e.target.value })} /></Field>
        </div>
        <Field label="Sample ID prefix" hint={`Samples are numbered ${v.samplePrefix || 'S'}-0001, ${v.samplePrefix || 'S'}-0002…`}><input className="k-input" value={v.samplePrefix} onChange={(e) => setV({ ...v, samplePrefix: e.target.value.toUpperCase() })} /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export interface NewEntryValues {
  templateId: string
  projectId: string
  title: string
  experiment: string
  date: string
}

export function NewEntryDialog({ nb, initial, onCreate, onClose }: { nb: Notebook; initial: Partial<NewEntryValues>; onCreate(v: NewEntryValues): void; onClose(): void }) {
  const groups = useMemo(() => templateGroups(), [])
  const [v, setV] = useState<NewEntryValues>({ templateId: 'blank', projectId: nb.projects[0]?.id ?? '', title: '', experiment: '', date: '', ...initial })
  const tpl = getTemplate(v.templateId)
  const experiments = [...new Set(nb.entries.filter((e) => e.projectId === v.projectId).map((e) => e.experiment))]
  return (
    <Modal title="New entry" width={560} onClose={onClose} footer={<><button className="k-btn" onClick={onClose}>Cancel</button><button className="k-btn primary" disabled={!v.projectId} onClick={() => onCreate(v)}>Create draft</button></>}>
      <form className="ln-form" onSubmit={(e) => { e.preventDefault(); if (v.projectId) onCreate(v) }}>
        <Field label="Template" hint={tpl?.description}>
          <select className="k-input" value={v.templateId} onChange={(e) => setV({ ...v, templateId: e.target.value })}>
            {groups.map((g) => <optgroup key={g.group} label={g.group}>{g.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
          </select>
        </Field>
        <div className="ln-two">
          <Field label="Project">
            <select className="k-input" value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value, experiment: '' })}>{nb.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select>
          </Field>
          <Field label="Experiment" hint="A new number, or add a day to an existing experiment.">
            <select className="k-input" value={v.experiment} onChange={(e) => setV({ ...v, experiment: e.target.value })}><option value="">new experiment (automatic number)</option>{experiments.map((x) => <option key={x}>{x}</option>)}</select>
          </Field>
        </div>
        <Field label="Title"><input className="k-input" value={v.title} placeholder={tpl?.title ?? 'Entry title'} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Date and time" hint="Empty = now."><input className="k-input" type="datetime-local" value={v.date.slice(0, 16)} onChange={(e) => setV({ ...v, date: e.target.value ? `${e.target.value}:00` : '' })} /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function SettingsDialog({ nb, author, backup, onSave, onClose }: { nb: Notebook; author: string; backup: boolean; onSave(v: { title: string; description: string; owner: string; samplePrefix: string; sampleDigits: number; author: string; backup: boolean }): void; onClose(): void }) {
  const [v, setV] = useState({ title: nb.title, description: nb.description, owner: nb.owner, samplePrefix: nb.settings.samplePrefix, sampleDigits: nb.settings.sampleDigits, author, backup })
  return (
    <Modal title="Notebook settings" onClose={onClose} footer={<><button className="k-btn" onClick={onClose}>Cancel</button><button className="k-btn primary" disabled={!v.title.trim() || !/^[A-Za-z0-9]{1,6}$/.test(v.samplePrefix)} onClick={() => onSave(v)}>Save</button></>}>
      <div className="ln-form">
        <Field label="Notebook title"><input className="k-input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Description"><textarea className="k-input" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <Field label="Notebook owner"><input className="k-input" value={v.owner} onChange={(e) => setV({ ...v, owner: e.target.value })} /></Field>
        <div className="ln-two">
          <Field label="Sample ID prefix"><input className="k-input" value={v.samplePrefix} onChange={(e) => setV({ ...v, samplePrefix: e.target.value.toUpperCase() })} /></Field>
          <Field label="Digits in the counter"><input className="k-input" type="number" min={1} max={8} value={v.sampleDigits} onChange={(e) => setV({ ...v, sampleDigits: Math.max(1, Math.min(8, Number(e.target.value) || 4)) })} /></Field>
        </div>
        <hr />
        <Field label="Your name (this computer)" hint="Used as the author of new entries and as the signer. Empty = your KherveOS account name."><input className="k-input" value={v.author} onChange={(e) => setV({ ...v, author: e.target.value })} /></Field>
        <label className="ln-check-label"><input type="checkbox" checked={v.backup} onChange={(e) => setV({ ...v, backup: e.target.checked })} /> Keep a daily backup copy in ~/Documents/kELN Backups</label>
      </div>
    </Modal>
  )
}

export function ProjectDialog({ onCreate, onClose }: { onCreate(code: string, name: string): void; onClose(): void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const ok = /^[A-Za-z0-9]{1,8}$/.test(code.trim())
  return (
    <Modal title="New project" onClose={onClose} footer={<><button className="k-btn" onClick={onClose}>Cancel</button><button className="k-btn primary" disabled={!ok} onClick={() => onCreate(code, name)}>Create project</button></>}>
      <form className="ln-form" onSubmit={(e) => { e.preventDefault(); if (ok) onCreate(code, name) }}>
        <Field label="Code" hint="Letters and digits, up to 8. Experiment numbers are CODE-YYYY-NNN."><input className="k-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
        <Field label="Name"><input className="k-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function AmendDialog({ entryLabel, onSave, onClose }: { entryLabel: string; onSave(reason: string, markdown: string): void; onClose(): void }) {
  const [reason, setReason] = useState('')
  const [text, setText] = useState('')
  const ok = reason.trim() && text.trim()
  return (
    <Modal title="Add an addendum" width={560} onClose={onClose} footer={<><button className="k-btn" onClick={onClose}>Cancel</button><button className="k-btn primary" disabled={!ok} onClick={() => onSave(reason, text)}>Add addendum</button></>}>
      <div className="ln-form">
        <p className="k-muted">{entryLabel} is signed. The signed text is never changed: the addendum is added below it, with your name, the time and its own SHA-256, and is recorded in the audit log.</p>
        <Field label="Why is it amended?"><input className="k-input" value={reason} placeholder="e.g. corrected a typo in the pH reading" onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="Addendum (Markdown, $maths$)"><textarea className="k-input" rows={7} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

export function LinkDialog({ nb, currentId, onAdd, onClose }: { nb: Notebook; currentId: string; onAdd(l: EntryLink): void; onClose(): void }) {
  const [kind, setKind] = useState<EntryLink['kind']>('entry')
  const [target, setTarget] = useState('')
  const [label, setLabel] = useState('')
  const ok = target.trim() && (kind !== 'url' || /^https?:\/\//i.test(target.trim()))
  return (
    <Modal title="Add a link" onClose={onClose} footer={<><button className="k-btn" onClick={onClose}>Cancel</button><button className="k-btn primary" disabled={!ok} onClick={() => onAdd({ kind, target: target.trim(), label: label.trim() })}>Add link</button></>}>
      <div className="ln-form">
        <Field label="Link to">
          <select className="k-input" value={kind} onChange={(e) => { setKind(e.target.value as EntryLink['kind']); setTarget('') }}><option value="entry">another entry</option><option value="path">a file or folder in the drive</option><option value="url">a web page</option></select>
        </Field>
        {kind === 'entry' && <Field label="Entry"><select className="k-input" value={target} onChange={(e) => { setTarget(e.target.value); if (!label) setLabel(nb.entries.find((x) => x.id === e.target.value)?.title ?? '') }}><option value="">choose…</option>{nb.entries.filter((e) => e.id !== currentId).map((e) => <option key={e.id} value={e.id}>{e.experiment} · {e.title}</option>)}</select></Field>}
        {kind === 'path' && (
          <Field label="Path" hint="e.g. a kTitration curve or a data file; it opens in the right Kherve app.">
            <span className="ln-inline"><input className="k-input" value={target} placeholder={`${HOME}/Documents/…`} onChange={(e) => setTarget(e.target.value)} />
              <button type="button" className="k-btn" onClick={() => void os.dialog.openFile({ title: 'Choose a file' }).then((f) => { if (f) { setTarget(f); if (!label) setLabel(osPath.basename(f)) } })}>Browse…</button></span>
          </Field>
        )}
        {kind === 'url' && <Field label="Address"><input className="k-input" value={target} placeholder="https://" onChange={(e) => setTarget(e.target.value)} /></Field>}
        <Field label="Label"><input className="k-input" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

export function MathDialog({ initial, display, onDone, onClose }: { initial: string; display: boolean; onDone(latex: string): void; onClose(): void }) {
  const [latex, setLatex] = useState(initial)
  return (
    <Modal title={display ? 'Display equation' : 'Formula'} onClose={onClose} footer={<><button className="k-btn" onClick={onClose}>Cancel</button><button className="k-btn primary" onClick={() => onDone(latex)}>{initial ? 'Update' : 'Insert'}</button></>}>
      <form className="ln-form" onSubmit={(e) => { e.preventDefault(); onDone(latex) }}>
        <Field label="LaTeX" hint="e.g. c_1 V_1 = c_2 V_2   or   \frac{m}{M}   or   \Delta G^\circ = -RT\ln K. Empty removes the formula.">
          <textarea className="k-input" rows={display ? 4 : 2} value={latex} onChange={(e) => setLatex(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !display && !e.shiftKey) { e.preventDefault(); onDone(latex) } }} />
        </Field>
        <div className="ln-math-preview" aria-label="Preview">{latex.trim() ? <Html html={renderMath(latex, display)} /> : <span className="k-muted">Preview</span>}</div>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function LabelDialog({ count, onPrint, onPdf, onClose }: { count: number; onPrint(o: LabelOptions): void; onPdf(o: LabelOptions): void; onClose(): void }) {
  const [o, setO] = useState<LabelOptions>(DEFAULT_LABEL)
  const toggle = (f: LabelOptions['fields'][number]) => setO((s) => ({ ...s, fields: s.fields.includes(f) ? s.fields.filter((x) => x !== f) : [...s.fields, f] }))
  return (
    <Modal title={`Print ${count} label${count === 1 ? '' : 's'}`} onClose={onClose} footer={<><button className="k-btn" onClick={onClose}>Cancel</button><button className="k-btn" onClick={() => onPdf(o)}>Save as PDF…</button><button className="k-btn primary" onClick={() => onPrint(o)}>Print…</button></>}>
      <div className="ln-form">
        <p className="k-muted">Each label has the sample ID as a Code-128 barcode and as text. In the print dialog choose “Save as PDF” for a file with the exact page.</p>
        <div className="ln-two">
          <Field label="Label width (mm)"><input className="k-input" type="number" min={20} max={120} value={o.widthMm} onChange={(e) => setO({ ...o, widthMm: Number(e.target.value) || 60 })} /></Field>
          <Field label="Label height (mm)"><input className="k-input" type="number" min={12} max={80} value={o.heightMm} onChange={(e) => setO({ ...o, heightMm: Number(e.target.value) || 30 })} /></Field>
        </div>
        <Field label="Labels per row"><input className="k-input" type="number" min={1} max={6} value={o.columns} onChange={(e) => setO({ ...o, columns: Math.max(1, Math.min(6, Number(e.target.value) || 3)) })} /></Field>
        <div className="ln-chips" role="group" aria-label="Fields on the label">
          {(['composition', 'batch', 'location', 'made', 'project'] as const).map((f) => <label key={f} className="ln-check-label"><input type="checkbox" checked={o.fields.includes(f)} onChange={() => toggle(f)} /> {f}</label>)}
        </div>
      </div>
    </Modal>
  )
}
