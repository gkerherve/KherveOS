// App icons in the Ktools style (as on khervetools.com): the app's "K…" name
// above a white pictogram on a coloured tile. Two looks
// (Settings › Appearance › Icon style):
//   classic — bright Ktools tiles with a soft gloss; Ktools apps that have an
//             official icon (KherveBook…) show that picture (default)
//   deep    — the same colours in deeper, darker shades

import type { AppManifest } from '../types'
import { useSettings } from '../settings'

export type IconStyle = 'classic' | 'deep'

export function AppIcon({
  app, size, className, iconStyle,
}: {
  app: AppManifest
  size: number
  className?: string
  /** Force a look (previews); otherwise the one chosen in Settings. */
  iconStyle?: IconStyle
}) {
  const chosen = useSettings((s) => s.iconStyle)
  const style = iconStyle ?? chosen
  const deep = style === 'deep'

  if (!deep && app.image) {
    return (
      <span className={`k-appicon-wrap ${className ?? ''}`}>
        <img
          className="k-appicon-img"
          src={app.image}
          width={size}
          height={size}
          alt=""
          draggable={false}
          style={{ borderRadius: size * 0.22 }}
        />
      </span>
    )
  }

  const b = app.brand ?? { label: app.name, from: app.color, to: app.color }
  const Glyph = app.icon
  // Below ~34px the name would be unreadable: show the pictogram alone, bigger.
  const withLabel = size >= 34
  const [from, to] = deep
    ? (b.deep ?? [`color-mix(in srgb, ${b.from} 70%, #000)`, `color-mix(in srgb, ${b.to} 58%, #000)`])
    : [b.from, b.to]
  const fg = deep ? '#ffffff' : (b.fg ?? '#ffffff')
  const glyph = deep ? (b.deepGlyph ?? '#ffffff') : (b.glyph ?? fg)
  return (
    <span className={`k-appicon-wrap ${className ?? ''}`}>
      <span
        className={`k-appicon ${deep ? 'deep' : 'classic'}`}
        style={{
          width: size,
          height: size,
          borderRadius: deep ? undefined : size * 0.23,
          backgroundImage: `linear-gradient(${deep ? 180 : 165}deg, ${from}, ${to})`,
          color: fg,
        }}
      >
        {withLabel && (
          <span className="k-appicon-label" style={{ fontSize: Math.max(8, size * (deep ? 0.19 : 0.205)) }}>
            {b.label}
          </span>
        )}
        <Glyph
          className="k-appicon-glyph"
          size={withLabel ? size * (deep ? 0.42 : 0.4) : size * (deep ? 0.6 : 0.62)}
          strokeWidth={withLabel ? 1.8 : 2.1}
          color={glyph}
        />
      </span>
    </span>
  )
}
