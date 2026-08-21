"""Generate SHELVES' icons.

Pure stdlib (zlib + struct), so the icons are reproducible from source with no
image library and no binary checked in that nobody can regenerate. Principle IX:
the folder Chrome loads is the folder in the repo — but anything generated
should carry the recipe that made it.

    python tools/make_icons.py

The mark: three stacked shelves, the top one lit, on a dark rounded plate.
"""

import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "extension", "icons")

PLATE = (0x16, 0x1B, 0x22)   # GitHub's --bgColor-muted, dark
EDGE = (0x30, 0x36, 0x3D)    # --borderColor-default
LIT = (0x3F, 0xB9, 0x50)     # --fgColor-success — the shelf that is "yours"
DIM = (0x6E, 0x76, 0x81)     # --fgColor-muted


def png(width, height, rows):
    """rows: list of list of (r,g,b) -> PNG bytes."""
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("3B", *px) for px in row) for row in rows
    )

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def draw(size):
    s = size
    px = [[(0, 0, 0) for _ in range(s)] for _ in range(s)]

    # Rounded plate. The corner radius is a fraction so every size looks alike.
    r = max(1, round(s * 0.18))

    def inside(x, y):
        cx = min(max(x, r), s - 1 - r)
        cy = min(max(y, r), s - 1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

    for y in range(s):
        for x in range(s):
            if not inside(x, y):
                # Transparent is not available in colour-type 2; the browser
                # composites on its own chrome, so match the plate's edge.
                px[y][x] = PLATE
            else:
                px[y][x] = PLATE

    # Border, one pixel in from the rounded silhouette.
    for y in range(s):
        for x in range(s):
            if inside(x, y) and not (
                inside(x - 1, y) and inside(x + 1, y) and inside(x, y - 1) and inside(x, y + 1)
            ):
                px[y][x] = EDGE

    # Three shelves. Proportions in fractions of the plate, so 16px and 128px
    # are the same drawing rather than two drawings that resemble each other.
    pad_x = max(2, round(s * 0.20))
    bar_h = max(1, round(s * 0.115))
    gap = max(1, round(s * 0.085))
    total = bar_h * 3 + gap * 2
    top = round((s - total) / 2)

    for i, colour in enumerate((LIT, DIM, DIM)):
        y0 = top + i * (bar_h + gap)
        # The lit shelf is full width; the dim ones step back, so the mark reads
        # as a list even at 16px where three equal bars turn into a smear.
        x1 = s - pad_x if i == 0 else s - pad_x - round(s * 0.10 * i)
        for y in range(y0, min(y0 + bar_h, s)):
            for x in range(pad_x, min(x1, s)):
                if inside(x, y):
                    px[y][x] = colour

    return png(s, s, px)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(OUT, "%d.png" % size)
        with open(path, "wb") as fh:
            fh.write(draw(size))
        print("wrote %s (%d bytes)" % (os.path.normpath(path), os.path.getsize(path)))


if __name__ == "__main__":
    main()
