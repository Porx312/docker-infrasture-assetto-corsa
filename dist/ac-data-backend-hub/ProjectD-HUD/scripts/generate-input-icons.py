#!/usr/bin/env python3
"""Generate wheel/controller/keyboard PNG icons for ProjectD-HUD (32x32, white on transparent)."""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

SIZE = 32
OUT = Path(__file__).resolve().parent.parent / "assets" / "input"
STROKE = (255, 255, 255, 255)
FILL = (255, 255, 255, 220)


def new_canvas() -> list[list[tuple[int, int, int, int]]]:
    return [[(0, 0, 0, 0) for _ in range(SIZE)] for _ in range(SIZE)]


def set_px(px: list[list[tuple[int, int, int, int]]], x: float, y: float, color: tuple[int, int, int, int], r: float = 0.8) -> None:
    for yy in range(SIZE):
        for xx in range(SIZE):
            if (xx - x) ** 2 + (yy - y) ** 2 <= r * r:
                px[yy][xx] = color


def draw_thick_line(px, x0, y0, x1, y1, color, width=1.6):
    steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 4) + 1
    for i in range(steps + 1):
        t = i / max(steps, 1)
        x = x0 + (x1 - x0) * t
        y = y0 + (y1 - y0) * t
        set_px(px, x, y, color, width / 2)


def draw_circle(px, cx, cy, radius, color, width=1.6):
    n = 96
    for i in range(n):
        a0 = 2 * math.pi * i / n
        a1 = 2 * math.pi * (i + 1) / n
        x0 = cx + math.cos(a0) * radius
        y0 = cy + math.sin(a0) * radius
        x1 = cx + math.cos(a1) * radius
        y1 = cy + math.sin(a1) * radius
        draw_thick_line(px, x0, y0, x1, y1, color, width)


def draw_round_rect(px, x, y, w, h, color, width=1.4):
    draw_thick_line(px, x, y, x + w, y, color, width)
    draw_thick_line(px, x + w, y, x + w, y + h, color, width)
    draw_thick_line(px, x + w, y + h, x, y + h, color, width)
    draw_thick_line(px, x, y + h, x, y, color, width)


def icon_wheel() -> list[list[tuple[int, int, int, int]]]:
    px = new_canvas()
    cx, cy, r = 16, 16, 10
    draw_circle(px, cx, cy, r, STROKE, 1.8)
    for deg in (0, 120, 240):
        a = math.radians(deg)
        draw_thick_line(px, cx, cy, cx + math.cos(a) * (r - 2), cy + math.sin(a) * (r - 2), STROKE, 1.6)
    draw_circle(px, cx, cy, 2.2, FILL, 2.2)
    return px


def icon_controller() -> list[list[tuple[int, int, int, int]]]:
    px = new_canvas()
    # body
    draw_round_rect(px, 7, 11, 18, 11, STROKE, 1.6)
    draw_thick_line(px, 7, 14, 4, 18, STROKE, 1.5)
    draw_thick_line(px, 4, 18, 4, 21, STROKE, 1.5)
    draw_thick_line(px, 25, 14, 28, 18, STROKE, 1.5)
    draw_thick_line(px, 28, 18, 28, 21, STROKE, 1.5)
    # d-pad
    set_px(px, 12, 16, FILL, 1.2)
    set_px(px, 11, 17, FILL, 1.2)
    set_px(px, 13, 17, FILL, 1.2)
    set_px(px, 12, 18, FILL, 1.2)
    # buttons
    for ox in (20, 22):
        set_px(px, ox, 15.5, FILL, 1.1)
        set_px(px, ox, 18.5, FILL, 1.1)
    return px


def icon_keyboard() -> list[list[tuple[int, int, int, int]]]:
    px = new_canvas()
    draw_round_rect(px, 5, 10, 22, 12, STROKE, 1.6)
    rows = [(8, 14), (8, 17), (8, 20)]
    for x0, y in rows:
        for i in range(6):
            x = x0 + i * 3.2
            draw_round_rect(px, x, y, 2.2, 1.6, FILL, 0.9)
    draw_round_rect(px, 14, 20, 6, 1.6, FILL, 0.9)
    return px


def write_png(path: Path, pixels: list[list[tuple[int, int, int, int]]]) -> None:
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b, a in row:
            raw.extend((r, g, b, a))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / "wheel.png", icon_wheel())
    write_png(OUT / "controller.png", icon_controller())
    write_png(OUT / "keyboard.png", icon_keyboard())
    print(f"Wrote icons to {OUT}")


if __name__ == "__main__":
    main()
