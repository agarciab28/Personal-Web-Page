#!/usr/bin/env python3
"""Verify the generated favicon assets are transparent and use the right colors.

Dependencies: python3 -m pip install pillow
Usage: python3 scripts/test-favicons.py
"""
import re
import sys
from pathlib import Path

from PIL import Image

DIR = Path(__file__).resolve().parent.parent / "public/img/favicon"
PNGS = {
    "favicon-16x16.png": 16,
    "favicon-32x32.png": 32,
    "apple-touch-icon.png": 180,
    "android-chrome-192x192.png": 192,
    "android-chrome-512x512.png": 512,
}
ICO_SIZES = {16, 32, 48, 64}
INK = (0xF3, 0xED, 0xF9)
ACCENT = (0xBD, 0x94, 0xF8)

failures = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        failures.append(msg)


def close(a, b, tol=12):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def check_image(label, im):
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    check(all(c[3] == 0 for c in corners), f"{label}: corners fully transparent")
    data = list(im.get_flattened_data())
    check(any(p[3] == 0 for p in data), f"{label}: contains alpha=0 pixels")
    # At 16px the original regular-weight glyphs can be entirely antialiased.
    check(any(p[3] > 0 for p in data), f"{label}: contains visible glyph pixels")
    if w >= 32:
        check(any(p[3] == 255 for p in data), f"{label}: contains opaque pixels")
    if w >= 32:
        opaque = [p[:3] for p in data if p[3] == 255]
        check(any(close(p, INK) for p in opaque), f"{label}: has #f3edf9")
        check(any(close(p, ACCENT) for p in opaque), f"{label}: has #bd94f8")


for name, size in PNGS.items():
    with Image.open(DIR / name) as im:
        check(im.size == (size, size), f"{name}: size {size}x{size}")
        check(im.mode == "RGBA", f"{name}: RGBA mode")
        check_image(name, im)

with Image.open(DIR / "favicon.ico") as ico:
    sizes = {s[0] for s in ico.info.get("sizes", {ico.size})}
    check(sizes == ICO_SIZES, f"favicon.ico: sizes {sorted(sizes)}")
    for s in sorted(sizes):
        ico.size = (s, s)
        ico.load()
        check_image(f"favicon.ico[{s}]", ico)

svg = (DIR / "favicon.svg").read_text(encoding="utf-8")
check(len(re.findall(r"<path\b", svg)) >= 3, "favicon.svg: has path elements")
check(not re.search(r"<(rect|text|image|circle)\b", svg), "favicon.svg: no rect/text/image/circle")
check("#f3edf9" in svg and "#bd94f8" in svg, "favicon.svg: palette colors")

sys.exit(1 if failures else 0)
