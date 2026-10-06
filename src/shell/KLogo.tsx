// The KherveOS mark: the Breton barred K (Ꝃ, "ker") in a ring, its diagonal
// running right through — as tattooed on the wrist in the wallpaper.

export function KLogo({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" width={size} height={size} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="17">
        <circle cx="100" cy="100" r="78" />
        <path d="M76 42V158M30 170L170 30M84 116L144 168" />
      </g>
    </svg>
  )
}
