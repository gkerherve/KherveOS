// The Speech panel (the desktop's speech_panel.py): what is said, line by
// line with the time of day, beside the notes — not mixed into them. The
// words being spoken show live in italics. Click a time to see what you were
// writing then; the lines said before the paragraph at the cursor are
// highlighted. Double-click a line to correct it; right-click for more.

import { useEffect, useRef, type MouseEvent } from 'react'
import { Mic, Pause, Play, Sparkles, Square, Wand2 } from 'lucide-react'
import type { Segment } from './model'

interface Props {
  segments: Segment[]
  partial: string
  listening: boolean
  status: string
  level: number
  vocabulary: string
  selected: Set<number>
  highlight: { from: number; to: number } | null
  playable: (i: number) => boolean
  playing: { index: number; paused: boolean } | null
  timeLabel(t: number): string
  onListen(): void
  onVocabulary(v: string): void
  onSuggest(): void
  onSelect(i: number, e: MouseEvent): void
  onTime(t: number): void
  onCorrect(i: number): void
  onMenu(e: MouseEvent, i: number): void
  onPlay(i: number): void
  onPause(): void
  onStop(): void
  onFill(): void
  onNotes(): void
  aiBusy: boolean
}

export function SpeechPanel(p: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // Follow new lines while the list is scrolled to the bottom.
  useEffect(() => {
    const el = listRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [p.segments.length, p.partial])

  useEffect(() => {
    if (!p.highlight || !listRef.current) return
    const first = listRef.current.querySelector('.kn-seg.hl')
    if (first instanceof HTMLElement) first.scrollIntoView({ block: 'nearest' })
  }, [p.highlight])

  const meter = Math.min(1, Math.sqrt(p.level) * 3)

  return (
    <div className="kn-speech">
      <div className="kn-speech-head">
        <button className={`k-btn small kn-listen${p.listening ? ' on' : ''}`} onClick={p.onListen} title="Listen on / off (Ctrl+L)">
          {p.listening ? <Square size={12} /> : <Mic size={13} />}
          {p.listening ? 'Stop' : 'Listen'}
        </button>
        {p.listening && (
          <div className="kn-meter" title="Microphone level">
            <div style={{ width: `${Math.round(meter * 100)}%` }} />
          </div>
        )}
        <span className="kn-speech-title">Speech</span>
      </div>
      {p.status && <div className="kn-speech-status">{p.status}</div>}
      <div className="kn-vocab">
        <input
          className="kn-vocab-input"
          placeholder="Words in this talk: LLZO, ToF-SIMS, Tougaard…"
          value={p.vocabulary}
          onChange={(e) => p.onVocabulary(e.target.value)}
          title="Names, acronyms and terms of the talk, separated by commas. Kept with the note and given to the AI."
          spellCheck={false}
        />
        <button className="k-btn small" onClick={p.onSuggest} title="Fill in the acronyms, formulas and names found in your notes">
          Suggest
        </button>
      </div>
      <div
        className="kn-seg-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {!p.segments.length && !p.partial && (
          <div className="kn-empty-msg">
            Press <b>Listen</b>: what is said is written here, line by line, with the time it was said. Speech recognition (Whisper) runs in
            this browser — the audio never leaves the computer.
          </div>
        )}
        {p.segments.map((g, i) => {
          const hl = p.highlight && g.t >= p.highlight.from && g.t < p.highlight.to
          const isPlaying = p.playing?.index === i
          return (
            <div
              key={i}
              className={`kn-seg${p.selected.has(i) ? ' selected' : ''}${hl ? ' hl' : ''}${isPlaying ? ' playing' : ''}`}
              onClick={(e) => p.onSelect(i, e)}
              onDoubleClick={() => p.onCorrect(i)}
              onContextMenu={(e) => {
                e.preventDefault()
                p.onMenu(e, i)
              }}
            >
              {p.playable(i) ? (
                <button
                  className="kn-play"
                  title={isPlaying ? 'Stop' : 'Hear this line'}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isPlaying) p.onStop()
                    else p.onPlay(i)
                  }}
                >
                  {isPlaying ? <Square size={9} /> : <Play size={10} />}
                </button>
              ) : (
                <span className="kn-play-gap" />
              )}
              <button
                className="kn-seg-time"
                title="Show my notes at this time"
                onClick={(e) => {
                  e.stopPropagation()
                  p.onTime(g.t)
                }}
              >
                {p.timeLabel(g.t)}
              </button>
              <span className="kn-seg-text">{g.text}</span>
            </div>
          )
        })}
        {p.partial && (
          <div className="kn-seg kn-partial">
            <span className="kn-play-gap" />
            <span className="kn-seg-time">…</span>
            <span className="kn-seg-text">{p.partial}</span>
          </div>
        )}
      </div>
      {p.playing && (
        <div className="kn-player">
          <span>Playing line {p.playing.index + 1}</span>
          <button className="k-icon-btn kn-tiny" onClick={p.onPause} title={p.playing.paused ? 'Play' : 'Pause'}>
            {p.playing.paused ? <Play size={12} /> : <Pause size={12} />}
          </button>
          <button className="k-icon-btn kn-tiny" onClick={p.onStop} title="Stop">
            <Square size={11} />
          </button>
        </div>
      )}
      <div className="kn-speech-foot">
        <button className="k-btn small" disabled={p.aiBusy || !p.segments.length} onClick={p.onFill} title="Add what the speech said that your section misses">
          <Wand2 size={13} /> Fill in my section
        </button>
        <button className="k-btn small" disabled={p.aiBusy || !p.segments.length} onClick={p.onNotes} title="Turn the speech (the selected lines, or all) into notes">
          <Sparkles size={13} /> Make notes
        </button>
      </div>
    </div>
  )
}
