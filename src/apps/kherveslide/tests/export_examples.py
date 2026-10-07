"""Build the desktop KherveSlide's example presentations (examples.py) into
KherveOS: public/examples/kherveslide/<file>.kslide + media/ + index.json,
and the desktop serializer's LaTeX for each into the app's test fixtures.

Run with a Python that has matplotlib + numpy, on an export of the dev branch
(never the user's checkout):
    git -C ../KherveSlide archive origin/dev | tar -x -C /tmp/ks
    python3 src/apps/kherveslide/tests/export_examples.py /tmp/ks . $(git -C ../KherveSlide rev-parse --short origin/dev)
"""
import json, re, shutil, sys, tempfile
from dataclasses import replace
from pathlib import Path

src, kos, sha = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
sys.path.insert(0, str(src))
from kherveslide import examples, serializer
from kherveslide.model import deck_to_json, deck_from_json, SlidePicture, SlideVideo

out = kos / "public/examples/kherveslide"
media = out / "media"
fixtures = kos / "src/apps/kherveslide/tests/fixtures"
for d in (out, media, fixtures):
    d.mkdir(parents=True, exist_ok=True)
assets = Path(tempfile.mkdtemp())


def slug(name):
    return re.sub(r"[^A-Za-z0-9]+", " ", name).strip()


def rel(p):
    if not p:
        return p
    pp = Path(p)
    if not pp.exists():
        raise SystemExit(f"missing media {p}")
    shutil.copyfile(pp, media / pp.name)
    return f"media/{pp.name}"


items = []
for name, desc, factory in examples.EXAMPLES:
    deck = factory(assets)
    for s in deck.slides + [deck.master]:
        for o in s.objects:
            if isinstance(o, SlidePicture):
                o.path = rel(o.path)
            if isinstance(o, SlideVideo):
                o.poster = rel(o.poster)
    if deck.theme_spec.logo:
        deck.theme_spec.logo = rel(deck.theme_spec.logo)
    fname = slug(name) + ".kslide"
    text = deck_to_json(deck)
    # The desktop reloads a file through deck_from_json, which types every
    # field (ints written for float fields come back as floats): that
    # canonical form is what a KherveOS round trip must reproduce.
    (fixtures / (slug(name) + ".canonical.kslide")).write_text(
        deck_to_json(deck_from_json(text)), encoding="utf-8")
    (out / fname).write_text(text, encoding="utf-8")
    (fixtures / (slug(name) + ".tex")).write_text(serializer.serialize_deck(deck), encoding="utf-8")
    items.append({"title": name, "description": desc, "file": fname})

(out / "index.json").write_text(json.dumps({
    "source": f"KherveSlide dev @ {sha}",
    "note": "The desktop KherveSlide's example presentations (kherveslide/examples.py), built by "
            "src/apps/kherveslide/tests/export_examples.py; charts drawn with matplotlib, pictures in media/.",
    "items": items}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print(len(items), "examples")


# ---- A feature fixture for the tests: everything the examples don't use,
# written as an OLD desktop file would be (legacy fields, missing keys, ints
# for floats), plus what the desktop makes of it.
legacy = {
    "type": "Deck", "title": "Features", "author": "Tester", "theme": "Madrid",
    "color_theme": "beaver", "aspect": "43", "gap": 0.05, "page_number": "of_total",
    "plain_frames": True, "nav_symbols": True, "header": "Head", "foot_left": "L",
    "foot_center": "C", "foot_right": "R",
    "theme_spec": {"enabled": True, "inner": "rounded", "outer": "infolines",
                   "bullets": "dot", "structure": "#123456", "canvas_bg": "#FFFFEE",
                   "canvas_bg2": "#EEEEFF", "title_rule": True, "footline_rule": True,
                   "footer_bar": True, "logo": "media/icon_kherveslide.png",
                   "logo_corner": "bl", "font_family": "times", "frametitle_size": "Large"},
    "master": {"objects": [
        {"type": "SlideText", "text": "watermark", "x": 0.7, "y": 0.9, "w": 0.3, "h": 0.05},
        {"type": "SlideLine", "x": 0, "y": 0.95, "w": 1, "h": 0, "color": "#FF0000"},
        {"type": "SlideShape", "shape": "star5", "x": 0.9, "y": 0.0, "w": 0.1, "h": 0.1, "fill": "#FFD700"}]},
    "slides": [
        {"title": "Legacy standard slide", "free": False, "bg": "#336699", "bg_alpha": 0.5, "objects": [
            {"type": "SlideShape", "shape": "rect", "x": 0.0, "y": 0.0, "w": 1, "h": 0.2, "fill": "#EEEEEE", "fill2": "#CCCCCC", "gradient": "horizontal", "rotation": 10, "opacity": 0.5, "style": "dashed"},
            {"type": "SlideText", "text": "Line one\nLine two\n\nAfter a blank\n\\mbox{}\n\\begin{itemize}\n\\item a\n\\end{itemize}", "x": 0.05, "y": 0.25, "w": 0.4, "h": 0.3, "bold": 1, "italic": True, "color": "#AA0000", "align": "center", "font_family": "tt", "font_pt": 17.9},
            {"type": "SlideText", "text": "Block body", "block": "alertblock", "block_title": "Careful", "x": 0.5, "y": 0.25, "w": 0.45, "h": 0.3},
            {"type": "SlideText", "text": "A theorem", "block": "theorem", "block_title": "Pythagoras", "x": 0.1, "y": 0.6, "w": 0.6, "h": 0.2, "border_color": "#00FF00", "fill": "#FFFFFF", "corner": "rounded", "shadow": True, "fill_opacity": 0.5, "border_style": "dotted"},
            {"type": "SlideTable", "rows": [["A", "B", "C"], ["1", "2"], ["3", "4", "5"], ["6", 7, 8.5]], "border": False, "striped": True, "caption": "Numbers", "color": "#202020", "x": 0.1, "y": 0.8, "w": 0.4, "h": 0.15},
            {"type": "SlidePicture", "path": "", "x": 0.6, "y": 0.8, "w": 0.3, "h": 0.15},
        ]},
        {"title": "Free slide", "objects": [
            {"type": "SlidePicture", "path": "media/example_xrd.png", "x": 0.1, "y": 0.1, "w": 0.4, "h": 0.4, "crop_l": 0.1, "crop_b": 0.03125, "rotation": 15, "opacity": 0.7, "keep_aspect": False, "border_color": "#000000", "locked": False},
            {"type": "SlidePicture", "path": "media/anim.gif", "x": 0.5, "y": 0.1, "w": 0.2, "h": 0.2, "locked": False},
            {"type": "SlideLine", "x": 0.8, "y": 0.8, "w": -0.3, "h": -0.2, "arrow_start": True, "arrow_end": True, "style": "dotted", "opacity": 0.4, "head_size": 2, "locked": False},
            {"type": "SlideLine", "x": 0.1, "y": 0.6, "w": 0.5, "h": 0.2, "curve": [0.2, -0.5, 0.8, 1.5, 1, 1, 9], "arrow_end": True},
            {"type": "SlideVideo", "path": "clip.mp4", "x": 0.6, "y": 0.5, "w": 0.3, "h": 0.2},
            {"type": "SlideVideo", "path": "clip.mp4", "poster": "media/fit_main.jpg", "x": 0.6, "y": 0.75, "w": 0.3, "h": 0.2},
            {"type": "SlideTable", "rows": [], "grid": "outer", "header": False, "x": 0.1, "y": 0.85, "w": 0.2, "h": 0.1, "locked": False},
            {"type": "SlideText", "text": "$E=mc^2$ and \\ce{H2O}", "x": 0.3, "y": 0.0, "w": 0.4, "h": 0.1, "locked": False},
        ]},
        {"title": "Columns", "objects": [
            {"type": "SlideText", "text": "Left", "x": 0.05, "y": 0.2, "w": 0.4, "h": 0.5},
            {"type": "SlidePicture", "path": "media/example_xps.png", "x": 0.5, "y": 0.2, "w": 0.45, "h": 0.5},
            {"type": "SlideText", "text": "Below, full width", "x": 0.05, "y": 0.75, "w": 0.9, "h": 0.1},
            {"type": "SlideText", "text": "Block", "block": "block", "x": 0.05, "y": 0.9, "w": 0.5, "h": 0.1},
        ]},
        {"title": "Hidden", "hidden": True, "objects": []},
        {"objects": [], "bg": "#ABCDEF"},
    ],
}
raw = json.dumps(legacy, indent=1)
(fixtures / "features.kslide").write_text(raw, encoding="utf-8")
deck = deck_from_json(raw)
(fixtures / "features.canonical.kslide").write_text(deck_to_json(deck), encoding="utf-8")
(fixtures / "features.tex").write_text(serializer.serialize_deck(deck), encoding="utf-8")
# A custom page size and no navigation symbols.
deck.page_w_cm, deck.page_h_cm, deck.nav_symbols, deck.plain_frames = 20, 11.25, False, False
deck.theme_spec.footer_bar = False
(fixtures / "features-page.tex").write_text(serializer.serialize_deck(deck), encoding="utf-8")
print("features fixture")
