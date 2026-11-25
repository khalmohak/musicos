#!/usr/bin/env python3
"""Render the Plymouth splash record (same design as ui/src/components/Record.tsx). Stdlib only.

    python3 scripts/gen-boot-assets.py   # writes image/mkosi.extra/usr/share/plymouth/themes/musicos/record.png
"""
import math
import os
import struct
import zlib

SIZE = 360          # output px; plymouth scales to the screen
SS = 3              # supersampling per axis
LABEL = (226, 225, 221)   # neutral label, as in Record.tsx
OUT = os.path.join(os.path.dirname(__file__), "..", "image", "mkosi.extra", "usr", "share", "plymouth",
                   "themes", "musicos", "record.png")


def lerp(a, b, t):
    return a + (b - a) * t


def sample(x, y):
    """Colour (r, g, b, a) at a point in the 0..100 viewBox."""
    dx, dy = x - 50, y - 50
    r = math.hypot(dx, dy)
    if r > 49.3:
        return (0, 0, 0, 0)
    if r <= 2.2:
        return (10, 10, 13, 255)
    if r <= 17:
        c = LABEL
        # subtle darker arc on the label
        if 10.7 < r < 11.3:
            c = tuple(int(v * 0.9) for v in c)
        if r > 16.6:
            c = tuple(int(v * 0.78) for v in c)
        return c + (255,)
    # vinyl: radial gradient + grooves + diagonal sheen
    t = r / 49
    base = [lerp(38, 17, t), lerp(38, 17, t), lerp(43, 20, t)]
    groove = (46 - r) / 1.9
    if r < 46.5 and abs(groove - round(groove)) < 0.09:
        base = [46, 46, 52]
    if r > 48.7:
        base = [59, 59, 66]
    s = ((x + y) / 200.0)
    sheen = max(0.0, 1 - abs(s - 0.47) / 0.08) * 0.10
    base = [min(255, v + 255 * sheen) for v in base]
    return (int(base[0]), int(base[1]), int(base[2]), 255)


def render():
    rows = []
    for py in range(SIZE):
        row = bytearray([0])
        for px in range(SIZE):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) / SIZE * 100
                    y = (py + (sy + 0.5) / SS) / SIZE * 100
                    r, g, b, a = sample(x, y)
                    acc[0] += r * a
                    acc[1] += g * a
                    acc[2] += b * a
                    acc[3] += a
            n = SS * SS
            alpha = acc[3] / n
            if acc[3]:
                row += bytes((int(acc[0] / acc[3]), int(acc[1] / acc[3]), int(acc[2] / acc[3]), int(alpha)))
            else:
                row += b"\0\0\0\0"
        rows.append(bytes(row))
    return b"".join(rows)


def png(path, w, h, raw):
    def chunk(tag, body):
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n")
        fh.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        fh.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        fh.write(chunk(b"IEND", b""))


if __name__ == "__main__":
    png(os.path.realpath(OUT), SIZE, SIZE, render())
    print(os.path.realpath(OUT))
