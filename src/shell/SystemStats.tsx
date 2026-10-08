// The processor and memory of the computer, in the menu bar: "CPU 18%  RAM 72%".
// Read from the KherveOS server every few seconds, while it is running. Without the
// server the readout is hidden (there is nothing real to show).

import { useEffect, useState } from 'react'
import { useServer } from '@/os/server'

interface Stats {
  cpu_percent: number
  cores: number
  memory_percent: number
  memory_used: number
  memory_total: number
}

const gb = (n: number) => `${(n / 1073741824).toFixed(1)} GB`

export function SystemStats() {
  const status = useServer((s) => s.status)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    if (status !== 'online') {
      setStats(null)
      return
    }
    let alive = true
    const poll = async () => {
      try {
        const r = await fetch('/api/system/stats', { cache: 'no-store' })
        if (r.ok && alive) setStats((await r.json()) as Stats)
      } catch {
        if (alive) setStats(null)
      }
    }
    void poll()
    const t = window.setInterval(() => void poll(), 3000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [status])

  if (!stats) return null
  const title = `Processor: ${stats.cpu_percent}% of ${stats.cores} cores\nMemory: ${gb(stats.memory_used)} of ${gb(stats.memory_total)} used (${stats.memory_percent}%)`
  return (
    <span className="k-topbar-stats" title={title} aria-label="Processor and memory use">
      CPU {Math.round(stats.cpu_percent)}%
      <span className="k-topbar-stats-sep" aria-hidden="true">·</span>
      RAM {Math.round(stats.memory_percent)}%
    </span>
  )
}
