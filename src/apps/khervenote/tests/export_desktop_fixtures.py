"""Build KherveNote's examples and test fixtures with the desktop app itself.

    git -C ../KherveNote archive origin/dev | tar -x -C /tmp/kn
    python3 src/apps/khervenote/tests/export_desktop_fixtures.py /tmp/kn

Writes, from the desktop's own code (standard library only, no Qt):

- public/examples/khervenote/*.knote + index.json — the eight example notes
  (khervenote/examples.py), as Help > Example notes installs them;
- src/apps/khervenote/tests/fixtures/:
    <stem>.continuous.tex       to_latex(note) of each example
    <stem>.paged.tex            to_latex(note, "paged", show_times=True, transcript=True)
    <stem>.txt                  note.plain_text()
    features.knote / .json      a note using every block kind, marks, lists,
                                maths, symbols, an image, an attachment, a recording
    features.continuous.tex     its LaTeX (asset_dir=None)
    features.paged.tex          paged, with times and transcript
    markdown.json               markdown_blocks() cases
    latex_cases.json            tex() / text_to_latex() / rich_to_latex() cases
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
OUT_EXAMPLES = REPO / "public" / "examples" / "khervenote"
OUT_FIX = HERE / "fixtures"


def main(src: str) -> None:
    sys.path.insert(0, src)
    from khervenote import examples, serializer  # noqa: E402
    from khervenote.knote_file import load_knote, save_knote  # noqa: E402
    from khervenote.library import safe_name  # noqa: E402
    from khervenote.model import (Block, Meta, Note, Recording, Section,  # noqa: E402
                                  Segment, markdown_blocks)

    OUT_EXAMPLES.mkdir(parents=True, exist_ok=True)
    OUT_FIX.mkdir(parents=True, exist_ok=True)
    for old in OUT_EXAMPLES.glob("*.knote"):
        old.unlink()
    items = []
    with tempfile.TemporaryDirectory() as work:
        for ex in examples.EXAMPLES:
            note = examples.build(ex)
            stem = safe_name(ex.title)
            path = OUT_EXAMPLES / f"{stem}.knote"
            save_knote(note, path, Path(work))
            # What the desktop reads back is what the tests compare with.
            note = load_knote(path, Path(work))
            items.append({"title": ex.title, "speaker": ex.speaker, "place": ex.place,
                          "file": path.name})
            (OUT_FIX / f"{stem}.continuous.tex").write_text(serializer.to_latex(note), "utf-8")
            (OUT_FIX / f"{stem}.paged.tex").write_text(
                serializer.to_latex(note, "paged", show_times=True, transcript=True), "utf-8")
            (OUT_FIX / f"{stem}.txt").write_text(note.plain_text(), "utf-8")
    (OUT_EXAMPLES / "index.json").write_text(
        json.dumps({"items": items}, indent=1, ensure_ascii=False) + "\n", "utf-8")

    # A note with everything the examples do not use.
    note = Note(meta=Meta(title="Features & tests: 100% of $x$", speaker="Dr Ø. Ñandú",
                          date="7 October 2026", place="Room #4 {B}", started="2026-10-07T14:00:00",
                          layout="paged", id="0123456789abcdef0123456789abcdef",
                          vocabulary="XPS, ToF-SIMS, LLZO"),
                summary="- first point\n- second with $E=mc^2$\n\nA closing line.",
                sections=[Section(id="s000000000", blocks=[
                    Block(id="b000000001", kind="typed", text="Lead-in before any section, at 12:30.", t=12.5),
                ]), Section(id="s000000001", title="Marks & maths", t=60.0, blocks=[
                    Block(id="b000000002", kind="typed",
                          text="Bold, italic and underlined words, then line\nbreaks.",
                          marks=[[0, 4, "b"], [6, 6, "i"], [17, 10, "u"], [0, 12, "u"]], t=61.0),
                    Block(id="b000000003", kind="typed",
                          text="It costs $5 and $10; inline $E = h\\nu - \\phi$ and \\(k_1\\) and "
                               "$$k = A\\exp(-E_a/RT)$$ then \\[ \\int_0^1 x\\,dx \\] end."),
                    Block(id="b000000004", kind="typed",
                          text="Symbols: α β Δ ≈ → ° × ± µ H₂O Al³⁺ cm⁻¹ ~ ^ \\ _ # & % { } and $λ = 2°$."),
                    Block(id="b000000005", kind="important", text="Remember: $\\Delta G < 0$.", t=70.25),
                    Block(id="b000000006", kind="question", text="Why is it **so**?", t=80.0),
                    Block(id="b000000007", kind="transcript", text="so um the next slide shows", t=90.0),
                    Block(id="b000000008", kind="heading", text="A subsection", level=2, t=95.0),
                    Block(id="b000000009", kind="heading", text="A sub-subsection", level=3),
                ]), Section(id="s000000002", title="Lists", t=120.0, blocks=[
                    Block(id="b000000010", kind="item", text="first", level=0, numbered=True),
                    Block(id="b000000011", kind="item", text="nested", level=1, numbered=True),
                    Block(id="b000000012", kind="item", text="deeper bullet", level=2),
                    Block(id="b000000013", kind="item", text="back to two", level=1, numbered=True,
                          marks=[[0, 4, "b"]]),
                    Block(id="b000000014", kind="item", text="second", level=0, numbered=True),
                    Block(id="b000000015", kind="item", text="a bullet list now", level=0),
                    Block(id="b000000016", kind="typed",
                          text="Typed list:\n- one\n  - one.a\n1. numbered\n\nNew paragraph."),
                    Block(id="b000000017", kind="image", path="assets/abc123.png", text="A caption $x^2$"),
                    Block(id="b000000018", kind="attachment", path="assets/att-0001/Slides.pdf",
                          text="Slides.pdf"),
                ]), Section(id="s000000003", title="", t=300.0)],
                recordings=[Recording("assets/rec-0001.ogg", 5.0, 42.5)],
                transcript=[Segment(5.0, "Good afternoon, everyone."),
                            Segment(65.5, "The energy is $E = h\\nu$ & that's 100%."),
                            Segment(3725.0, "One hour later.")])
    note.attachments = note.attachment_blocks()
    with tempfile.TemporaryDirectory() as work:
        w = Path(work)
        (w / "assets" / "att-0001").mkdir(parents=True)
        # A 1x1 PNG, a fake PDF and a fake recording.
        (w / "assets" / "abc123.png").write_bytes(bytes.fromhex(
            "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
            "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"))
        (w / "assets" / "att-0001" / "Slides.pdf").write_bytes(b"%PDF-1.4\n%fake\n")
        (w / "assets" / "rec-0001.ogg").write_bytes(b"OggS-fake")
        save_knote(note, OUT_FIX / "features.knote", w)
    (OUT_FIX / "features.json").write_text(
        json.dumps(note.to_dict(), indent=1, ensure_ascii=False), "utf-8")
    (OUT_FIX / "features.continuous.tex").write_text(serializer.to_latex(note, "continuous"), "utf-8")
    (OUT_FIX / "features.paged.tex").write_text(
        serializer.to_latex(note, show_times=True, transcript=True), "utf-8")
    (OUT_FIX / "features.txt").write_text(note.plain_text(), "utf-8")

    md_cases = [
        "Just a paragraph\nover two lines.\n\nAnother **bold** one.",
        "# Title\n\nText under it.\n\n## Sub\n- a\n- b **c**\n  - nested\n    - deeper\n1. one\n2) two",
        "### Deep\n#### Deeper\n- x",
        "* star item\n• bullet item\n\n- after blank",
    ]
    md = [{"text": t, "blocks": [{k: v for k, v in b.to_dict().items() if k != "id"}
                                  for b in markdown_blocks(t)]} for t in md_cases]
    (OUT_FIX / "markdown.json").write_text(json.dumps(md, indent=1, ensure_ascii=False), "utf-8")

    texts = ["plain & simple", "costs $5 and $10", "$a$ and $b$5", "H₂O at 25 °C ≈ 298 K",
             "\\(x\\) \\[y\\] $$z$$", "$α + β$", "a_b^c ~ {x} # % & \\ end",
             "multi\nline", "$ not maths $", "$x$y", "100 µm × 3 ± 0.1"]
    blocks = ["- a\n- b\n  - c\n1. d", "Para one\n\nPara two\nline two",
              "Intro:\n  1. one\n  2. two\n     continued\nAfter", "- only\n\n- two lists"]
    rich = [["Bold and italic", [[0, 4, "b"], [9, 6, "i"]]],
            ["overlap here", [[0, 7, "b"], [3, 9, "u"]]],
            ["line\nbreak $x$", [[0, 4, "i"]]],
            ["no marks $y$", []]]
    cases = {"tex": [[t, serializer.tex(t)] for t in texts],
             "escape": [[t, serializer.escape(t)] for t in texts],
             "text_to_latex": [[t, serializer.text_to_latex(t)] for t in blocks + texts],
             "rich_to_latex": [[t, m, serializer.rich_to_latex(t, m)] for t, m in rich]}
    (OUT_FIX / "latex_cases.json").write_text(json.dumps(cases, indent=1, ensure_ascii=False), "utf-8")
    print(f"{len(items)} examples -> {OUT_EXAMPLES}\nfixtures -> {OUT_FIX}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
