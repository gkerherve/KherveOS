// The start screen (no notebook open): create or open a notebook, recent notebooks, the example notebooks.

import { BookOpen, FilePlus, FolderOpen, NotebookTabs, ShieldCheck } from 'lucide-react'
import { path as osPath } from '@/os'
import type { ExampleFile } from '@/os/exampleFiles'
import { groupExamples } from '@/os/exampleFiles'

interface Props {
  recent: string[]
  examples: ExampleFile[]
  onNew(): void
  onOpen(): void
  onOpenPath(path: string): void
  onExamplesFolder(): void
}

export function Home({ recent, examples, onNew, onOpen, onOpenPath, onExamplesFolder }: Props) {
  const groups = groupExamples(examples)
  return (
    <div className="ln-home">
      <div className="ln-home-card">
        <div className="ln-home-title"><NotebookTabs size={30} /><div><h2>kELN</h2><p className="k-muted">An electronic lab notebook that lives in one file you own.</p></div></div>
        <div className="ln-home-actions">
          <button className="k-btn primary" onClick={onNew}><FilePlus size={14} /> New notebook…</button>
          <button className="k-btn" onClick={onOpen}><FolderOpen size={14} /> Open…</button>
          <button className="k-btn" onClick={onExamplesFolder}><BookOpen size={14} /> Examples folder</button>
        </div>
        {recent.length > 0 && (
          <section>
            <h4>Recent notebooks</h4>
            <ul className="ln-list">{recent.map((p) => <li key={p}><button className="ln-linkbtn" onClick={() => onOpenPath(p)} title={p}>{osPath.basename(p).replace(/\.keln$/, '')}</button><span className="ln-li-sub">{osPath.pretty(osPath.dirname(p))}</span></li>)}</ul>
          </section>
        )}
        {examples.length > 0 && (
          <section>
            <h4>Examples</h4>
            {groups.map((g) => (
              <div key={g.group}>
                <h5>{g.group}</h5>
                <ul className="ln-list">{g.files.map((f) => <li key={f.path}><button className="ln-linkbtn" onClick={() => onOpenPath(f.path)} title={f.description}>{f.title}</button><span className="ln-li-sub">{f.description}</span></li>)}</ul>
              </div>
            ))}
          </section>
        )}
        <p className="ln-honest"><ShieldCheck size={13} /> Signed entries are locked and every change is written to a SHA-256-chained audit log, so tampering is detectable. It is a tamper-evident record kept in your files, not a certified 21 CFR Part 11 system.</p>
      </div>
    </div>
  )
}
