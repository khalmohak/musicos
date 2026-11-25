#!/usr/bin/env python3
"""Convert a binary PPM (QEMU `screendump` output) to PNG. Stdlib only.

    python3 scripts/ppm2png.py shot.ppm shot.png
"""
import struct
import sys
import zlib


def ppm_to_png(src, dst):
    data = open(src, "rb").read()
    magic, w, h, maxval, pixels = data.split(maxsplit=4)
    if magic != b"P6" or int(maxval) != 255:
        raise SystemExit("expected 8-bit binary PPM (P6)")
    w, h = int(w), int(h)
    stride = w * 3
    raw = b"".join(b"\0" + pixels[y * stride:(y + 1) * stride] for y in range(h))

    def chunk(tag, body):
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    with open(dst, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n")
        fh.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        fh.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        fh.write(chunk(b"IEND", b""))
    return w, h


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    print("%dx%d" % ppm_to_png(sys.argv[1], sys.argv[2]))
