#!/usr/bin/env python3
"""Generate wavecode monogram PNG icons in pure Python (no Pillow/ImageMagick).

Outputs three PNGs to ui/public/:
  - icon-192.png            (192x192, PWA manifest)
  - icon-512.png            (512x512, PWA manifest splash)
  - apple-touch-icon-180.png (180x180, iOS Add-to-Home-Screen)

Design: monogram "wc" in accent color #ff6b6b on #0a0a0a background.
Glyphs are drawn from a 5x7 hand-coded pixel font (rows MSB-first, bit 4 = leftmost).
"""
import os
import struct
import sys
import zlib

BG = (0x0A, 0x0A, 0x0A, 0xFF)
FG = (0xFF, 0x6B, 0x6B, 0xFF)

# 5x7 bitmap font: each row is an int with bits [4..0] = left-to-right.
FONT = {
    "w": [
        0b10001,
        0b10001,
        0b10001,
        0b10101,
        0b10101,
        0b11011,
        0b10001,
    ],
    "c": [
        0b01110,
        0b10001,
        0b10000,
        0b10000,
        0b10000,
        0b10001,
        0b01110,
    ],
}


def png_chunk(typ: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + typ
        + data
        + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
    )


def encode_png(width: int, height: int, pixels: list[tuple[int, int, int, int]]) -> bytes:
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA, no interlace
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: None
        for x in range(width):
            r, g, b, a = pixels[y * width + x]
            raw.append(r)
            raw.append(g)
            raw.append(b)
            raw.append(a)
    idat = zlib.compress(bytes(raw), 9)
    return sig + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", idat) + png_chunk(b"IEND", b"")


def gen(size: int) -> bytes:
    cell = size // 12  # 16@192, 42@512, 15@180
    glyph_w = 5 * cell
    glyph_h = 7 * cell
    gap = cell
    total_w = glyph_w * 2 + gap
    x_off = (size - total_w) // 2
    y_off = (size - glyph_h) // 2

    pixels = [BG] * (size * size)
    for gi, ch in enumerate("wc"):
        glyph = FONT[ch]
        for row in range(7):
            for col in range(5):
                if (glyph[row] >> (4 - col)) & 1:
                    x0 = x_off + gi * (glyph_w + gap) + col * cell
                    y0 = y_off + row * cell
                    for dy in range(cell):
                        for dx in range(cell):
                            px = x0 + dx
                            py = y0 + dy
                            if 0 <= px < size and 0 <= py < size:
                                pixels[py * size + px] = FG
    return encode_png(size, size, pixels)


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    pub = os.path.normpath(os.path.join(here, "..", "..", "ui", "public"))
    os.makedirs(pub, exist_ok=True)
    targets = [
        (192, "icon-192.png"),
        (512, "icon-512.png"),
        (180, "apple-touch-icon-180.png"),
    ]
    for size, name in targets:
        data = gen(size)
        path = os.path.join(pub, name)
        with open(path, "wb") as f:
            f.write(data)
        print(f"wrote {path} ({size}x{size}, {len(data)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
