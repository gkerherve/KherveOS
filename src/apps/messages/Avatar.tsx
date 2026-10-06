import { Users } from 'lucide-react'
import { initials, toneOf } from './format'

interface AvatarProps {
  name: string
  /** Picks the colour, so a person keeps theirs everywhere. */
  id: number
  size?: number
  /** Show the green dot when true; nothing when false/undefined. */
  online?: boolean
  group?: boolean
}

export function Avatar({ name, id, size = 36, online, group }: AvatarProps) {
  return (
    <span
      className={`msg-avatar tone-${toneOf(id)}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {group ? <Users size={Math.round(size * 0.48)} /> : initials(name)}
      {online && <span className="msg-online-dot" style={{ width: Math.max(9, size * 0.3), height: Math.max(9, size * 0.3) }} />}
    </span>
  )
}
