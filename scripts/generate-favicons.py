#!/usr/bin/env python3
"""Generate the transparent "ag." favicon set in public/img/favicon/.

The mark is the header .monogram (Poppins Regular, letter-spacing -0.05em):
"a" in #f3edf9 and "g." in #bd94f8. Glyph outlines are read from
src/assets/fonts/Poppins/Poppins-Regular.ttf and written as SVG paths, so the
SVG contains no <text>, no external fonts and no background.

Dependencies:
    python3 -m pip install fonttools cairosvg pillow
(cairosvg also needs the system cairo library.)

Usage:
    python3 scripts/generate-favicons.py
"""
from io import BytesIO
from pathlib import Path

import cairosvg
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "src/assets/fonts/Poppins/Poppins-Regular.ttf"
OUT = ROOT / "public/img/favicon"

INK = "#f3edf9"
ACCENT = "#bd94f8"
TRACKING_EM = -0.05
INSET = 0.06  # fraction of the canvas kept free on every side
VIEW = 512

PNGS = {
    "favicon-16x16.png": 16,
    "favicon-32x32.png": 32,
    "apple-touch-icon.png": 180,
    "android-chrome-192x192.png": 192,
    "android-chrome-512x512.png": 512,
}
ICO_SIZES = [16, 32, 48, 64]


def layout():
    font = TTFont(FONT)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    items, x = [], 0.0
    for ch, color in (("a", INK), ("g", ACCENT), (".", ACCENT)):
        name = cmap[ord(ch)]
        items.append((name, color, x))
        x += glyphs[name].width + TRACKING_EM * upm
    return glyphs, items


def fmt(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def build_svg():
    glyphs, items = layout()
    # Ink bounds of the whole run, in font units (y up).
    xmin = ymin = float("inf")
    xmax = ymax = float("-inf")
    for name, _, x in items:
        bp = BoundsPen(glyphs)
        glyphs[name].draw(TransformPen(bp, (1, 0, 0, 1, x, 0)))
        x0, y0, x1, y1 = bp.bounds
        xmin, ymin = min(xmin, x0), min(ymin, y0)
        xmax, ymax = max(xmax, x1), max(ymax, y1)
    w, h = xmax - xmin, ymax - ymin
    scale = VIEW * (1 - 2 * INSET) / max(w, h)
    # Centre the ink box in the square canvas; flip y.
    tx = VIEW / 2 - (xmin + w / 2) * scale
    ty = VIEW / 2 + (ymin + h / 2) * scale
    paths = []
    for name, color, x in items:
        pen = SVGPathPen(glyphs, ntos=fmt)
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, tx + x * scale, ty)))
        paths.append(f'  <path fill="{color}" d="{pen.getCommands()}"/>')
    head = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEW} {VIEW}" width="{VIEW}" height="{VIEW}">'
    return head + "\n  <title>ag.</title>\n" + "\n".join(paths) + "\n</svg>\n"


def render(svg, size):
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return Image.open(BytesIO(png)).convert("RGBA")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    svg = build_svg()
    (OUT / "favicon.svg").write_text(svg, encoding="utf-8")
    for name, size in PNGS.items():
        render(svg, size).save(OUT / name, optimize=True)
    render(svg, 256).save(OUT / "favicon.ico", format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"wrote favicon.svg, {len(PNGS)} PNGs and favicon.ico to {OUT}")


if __name__ == "__main__":
    main()
