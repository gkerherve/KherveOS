// A KherveTeX toolbar icon. The desktop draws its icons in a dark and a light
// variant (khervedoc/icons.py, set_dark): icons/<name>.png is the dark set
// (light-grey strokes for KherveOS's dark chrome), icons/light/<name>.png the
// light set (near-black strokes), shown in a window set to Light in Settings ›
// Appearance, which carries data-dark="0" (see texIcons.css).

import { ICON_BASE, iconUrl } from './actions'
import './texIcons.css'

export const lightIconUrl = (name: string) => `${ICON_BASE}light/${name}.png`

export function TexIcon({ name }: { name: string }) {
  return (
    <>
      <img className="ktx-ico-d" src={iconUrl(name)} alt="" draggable={false} />
      <img className="ktx-ico-l" src={lightIconUrl(name)} alt="" draggable={false} />
    </>
  )
}
