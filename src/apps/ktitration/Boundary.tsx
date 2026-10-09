// If a tab fails while drawing (a damaged file, a number nobody expected) the window shows what happened and a
// way back instead of going blank.

import { Component, type ReactNode } from 'react'

export class Boundary extends Component<{ children: ReactNode; onReset?: () => void; label: string }, { error: string | null }> {
  state = { error: null as string | null }

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) }
  }

  render() {
    if (this.state.error === null) return this.props.children
    return (
      <div className="ti-empty" role="alert">
        <strong>Something went wrong in {this.props.label}.</strong>
        <div className="ti-hint">{this.state.error}</div>
        <div className="ti-btnrow">
          <button type="button" className="k-btn" onClick={() => this.setState({ error: null })}>Try again</button>
          {this.props.onReset && <button type="button" className="k-btn danger" onClick={() => { this.props.onReset?.(); this.setState({ error: null }) }}>Start a new titration</button>}
        </div>
      </div>
    )
  }
}
