"""Draws the "Together" wallpapers: people holding hands in a ring around the
KherveOS emblem (the Breton barred K, Ꝃ, in a ring), with the motto
"An OS for the people — free, open source".

    python3 tools/make_wallpaper.py      # writes public/wallpapers/together-*.svg
"""

from __future__ import annotations

import math
from pathlib import Path

W, H = 2560, 1600
CX, CY = 1660, 760          # centre of the ring of people
FEET = 232                  # radius where the feet stand
N = 14                      # people in the ring

PALETTES = {
    "red": {
        "bg": "#0d0808", "glow": "#e0262c", "emblem": "#f4e8d6", "text": "#f4e8d6", "muted": "#b9a39b",
        "accent": "#ff4a42", "people": ["#f4e8d6", "#e0262c", "#ff9a52", "#b8141c", "#f2b3a6", "#ffcf7a", "#d9473f"],
    },
    "green": {
        "bg": "#070c09", "glow": "#1f9d4f", "emblem": "#e8f3eb", "text": "#e8f3eb", "muted": "#9db5a6",
        "accent": "#4fd07f", "people": ["#e8f3eb", "#1f9d4f", "#9be37a", "#0f7a3a", "#bfe8c9", "#f2d36b", "#3fbf8f"],
    },
}


def polar(r: float, a: float) -> tuple[float, float]:
    return CX + r * math.cos(a), CY + r * math.sin(a)


def person(a: float, color: str) -> str:
    """One standing person, feet on the ring, head pointing outwards (angle a)."""
    deg = math.degrees(a) + 90  # local "up" (-y) → outwards
    x, y = polar(FEET, a)
    body = (
        f'<g transform="translate({x:.1f} {y:.1f}) rotate({deg:.2f})" fill="{color}">'
        # legs, slightly apart
        '<path d="M-26 0 L-8 0 L-4 -70 L4 -70 L8 0 L26 0 L30 -96 L-30 -96 Z"/>'
        # torso, rounded shoulders
        '<path d="M-34 -92 L34 -92 L40 -168 Q40 -188 20 -190 L-20 -190 Q-40 -188 -40 -168 Z"/>'
        # head
        '<circle cx="0" cy="-232" r="34"/>'
        "</g>"
    )
    return body


def arms(palette: list[str]) -> str:
    """Each pair of neighbours joins hands halfway between them, a little below the shoulders."""
    out = []
    step = 2 * math.pi / N
    for i in range(N):
        a0 = i * step - math.pi / 2
        a1 = a0 + step
        hand = polar(FEET + 150, (a0 + a1) / 2)
        for a, side, color in ((a0, 1, palette[i % len(palette)]), (a1, -1, palette[(i + 1) % len(palette)])):
            # shoulder of this person, on the side facing the neighbour
            sx, sy = polar(FEET + 176, a)
            tx, ty = -math.sin(a) * side, math.cos(a) * side
            sx, sy = sx + tx * 30, sy + ty * 30
            out.append(
                f'<path d="M{sx:.1f} {sy:.1f}L{hand[0]:.1f} {hand[1]:.1f}" stroke="{color}" '
                f'stroke-width="22" stroke-linecap="round"/>'
            )
        out.append(f'<circle cx="{hand[0]:.1f}" cy="{hand[1]:.1f}" r="15" fill="{palette[i % len(palette)]}"/>')
    return "".join(out)


def emblem(color: str) -> str:
    """The ringed Ꝃ (same drawing as the logo), 300 units across, centred."""
    return (
        f'<g transform="translate({CX - 150} {CY - 150}) scale(1.5)" fill="none" stroke="{color}" stroke-width="17">'
        '<circle cx="100" cy="100" r="78"/>'
        '<path d="M76 42V158M30 170L170 30M84 116L144 168"/>'
        "</g>"
    )


def build(p: dict) -> str:
    people = p["people"]
    step = 2 * math.pi / N
    figures = "".join(person(i * step - math.pi / 2, people[i % len(people)]) for i in range(N))
    font = "'Avenir Next', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif"
    return "\n".join([
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">',
        "<defs>",
        f'<radialGradient id="glow" cx="{CX / W:.3f}" cy="{CY / H:.3f}" r="0.55">'
        f'<stop offset="0" stop-color="{p["glow"]}" stop-opacity="0.42"/>'
        f'<stop offset="0.45" stop-color="{p["glow"]}" stop-opacity="0.10"/>'
        f'<stop offset="1" stop-color="{p["glow"]}" stop-opacity="0"/></radialGradient>',
        f'<radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">'
        '<stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/>'
        "</radialGradient>",
        "</defs>",
        f'<rect width="{W}" height="{H}" fill="{p["bg"]}"/>',
        f'<rect width="{W}" height="{H}" fill="url(#glow)"/>',
        # faint rings, like ripples spreading out
        *[f'<circle cx="{CX}" cy="{CY}" r="{r}" fill="none" stroke="{p["glow"]}" stroke-opacity="{o}" stroke-width="2"/>'
          for r, o in ((620, 0.22), (760, 0.14), (920, 0.09), (1100, 0.05))],
        arms(people),
        figures,
        emblem(p["emblem"]),
        # the motto
        f'<g font-family="{font}" fill="{p["text"]}">',
        f'<text x="190" y="575" font-size="34" font-weight="700" letter-spacing="12" fill="{p["accent"]}">KHERVEOS</text>',
        '<text x="180" y="705" font-size="128" font-weight="800" letter-spacing="-2">An OS for</text>',
        '<text x="180" y="842" font-size="128" font-weight="800" letter-spacing="-2">the people.</text>',
        f'<text x="186" y="930" font-size="44" font-weight="500" fill="{p["muted"]}" letter-spacing="1">'
        "Free  ·  Open source  ·  Made to help</text>",
        "</g>",
        f'<rect width="{W}" height="{H}" fill="url(#vignette)"/>',
        "</svg>",
    ])


if __name__ == "__main__":
    out_dir = Path(__file__).resolve().parent.parent / "public" / "wallpapers"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, palette in PALETTES.items():
        out = out_dir / f"together-{name}.svg"
        out.write_text(build(palette), encoding="utf-8")
        print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
