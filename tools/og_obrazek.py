#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Náhledový obrázek odkazu (Open Graph, 1200 × 630) – src/img/og.png.

Použití (z kořene projektu):  python tools/og_obrazek.py
Vyžaduje numpy a Pillow; písmo Segoe UI (Windows), jinak DejaVu Sans. Kreslí se ve dvojnásobném rozlišení (vyhlazení).
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "img" / "og.png"
S = 2  # převzorkování
W, H = 1200 * S, 630 * S
BLUE, DARK, ACCENT, CYAN = (0, 101, 189), (0, 60, 116), (242, 169, 0), (110, 210, 255)


def font(bold=False, size=20):
    for name in (("segoeuib.ttf" if bold else "segoeui.ttf"), ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")):
        for d in (Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu")):
            if (d / name).exists():
                return ImageFont.truetype(str(d / name), size * S)
    return ImageFont.load_default()


def glow(img, shape, color, blur, strength):
    """Rozmazaná záře barvy podle tvaru nakresleného do masky (shape = funkce kreslící do ImageDraw)."""
    m = Image.new("L", img.size, 0)
    shape(ImageDraw.Draw(m))
    img.paste(color, (0, 0), m.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(v * strength)))


def main():
    # modrý přechod jako úvod webu: vlevo nahoře modrá ČVUT, vpravo dole tmavší
    yy, xx = np.mgrid[0:H, 0:W]
    t = (0.55 * xx / W + 0.45 * yy / H)[..., None]
    img = Image.fromarray((np.array(BLUE) * (1 - t) + np.array(DARK) * t).astype(np.uint8))
    # jemná technická mřížka a světlo za mostem – k okrajům slábnou
    grid = Image.new("L", (W, H), 0)
    g = ImageDraw.Draw(grid)
    for x in range(0, W, 32 * S):
        g.line([(x, 0), (x, H)], fill=255, width=S)
    for y in range(0, H, 32 * S):
        g.line([(0, y), (W, y)], fill=255, width=S)
    size = (int(W * 0.8), int(H * 1.5))
    spot = Image.new("L", (W, H), 255)
    spot.paste(Image.radial_gradient("L").resize(size), (int(W * 0.78 - size[0] / 2), int(H * 0.66 - size[1] / 2)))
    spot = Image.eval(spot, lambda v: 255 - v)  # 255 uprostřed světla, 0 mimo
    img.paste(CYAN, (0, 0), Image.eval(spot, lambda v: int(v * 0.18)))
    img.paste((255, 255, 255), (0, 0), Image.eval(ImageChops.multiply(grid, spot), lambda v: int(v * 0.12)))
    d = ImageDraw.Draw(img)

    # logo: bílá dlaždice se značkou (příhradový nosník a oranžový bod)
    x0, y0, t = 72 * S, 66 * S, 72 * S
    d.rounded_rectangle([x0, y0, x0 + t, y0 + t], radius=12 * S, fill=(255, 255, 255))
    k = t / 64
    p = lambda x, y: (x0 + x * k, y0 + y * k)
    d.line([p(10, 44), p(54, 44)], fill=BLUE, width=int(4 * k))
    d.line([p(14, 44), p(22, 26), p(30, 44), p(38, 26), p(46, 44), p(54, 26)], fill=BLUE, width=int(4 * k), joint="curve")
    d.line([p(22, 26), p(54, 26)], fill=BLUE, width=int(4 * k))
    cx, cy = p(34, 35)
    d.ellipse([cx - 5 * k, cy - 5 * k, cx + 5 * k, cy + 5 * k], fill=ACCENT)

    d.text((168 * S, 80 * S), "FAKULTA STAVEBNÍ ČVUT V PRAZE", font=font(True, 24), fill=(220, 235, 250))
    d.text((168 * S, 112 * S), "Spolupráce s praxí", font=font(False, 22), fill=(201, 221, 242))
    d.text((70 * S, 206 * S), "FSv Bridge", font=font(True, 88), fill=(255, 255, 255))
    d.text((72 * S, 326 * S), "Odborníci Fakulty stavební", font=font(True, 40), fill=(255, 255, 255))
    d.text((72 * S, 378 * S), "pro vaše projekty", font=font(True, 40), fill=(255, 255, 255))
    d.rectangle([72 * S, 452 * S, 158 * S, 458 * S], fill=ACCENT)
    d.text((72 * S, 482 * S), "Zkoušky · měření · posudky · výzkum a vývoj", font=font(False, 30), fill=(227, 238, 249))
    d.text((72 * S, 532 * S), "Popište, co potřebujete – ozveme se vám.", font=font(False, 30), fill=(227, 238, 249))

    # most mezi praxí a fakultou (stejná ilustrace jako na úvodu webu)
    ox, oy, sc = 742 * S, 300 * S, 0.86 * S
    q = lambda x, y: (ox + x * sc, oy + y * sc)
    nodes = [(40, 210), (140, 210), (240, 210), (340, 210), (440, 210), (90, 130), (190, 130), (290, 130), (390, 130)]
    diag = [((40, 210), (90, 130)), ((90, 130), (140, 210)), ((140, 210), (190, 130)), ((190, 130), (240, 210)),
            ((290, 130), (340, 210)), ((340, 210), (390, 130)), ((390, 130), (440, 210))]
    glow(img, lambda m: m.line([q(240, 210), q(290, 130)], fill=255, width=int(18 * sc)), ACCENT, 7 * S, 0.55)
    d = ImageDraw.Draw(img, "RGBA")
    for x in (90, 190, 290, 390):
        d.line([q(x, 130), q(x, 210)], fill=(255, 255, 255, 110), width=int(1.6 * sc))
    for a, b in diag:
        d.line([q(*a), q(*b)], fill=(255, 255, 255, 235), width=int(2.6 * sc))
    d.line([q(40, 210), q(440, 210)], fill=(255, 255, 255), width=int(4 * sc))
    d.line([q(90, 130), q(390, 130)], fill=(255, 255, 255), width=int(4 * sc))
    d.line([q(240, 210), q(290, 130)], fill=ACCENT, width=int(5.5 * sc))
    for sx in (40, 440):
        d.polygon([q(sx, 210), q(sx - 14, 232), q(sx + 14, 232)], outline=(255, 255, 255), width=int(2 * sc))
    for x in range(8, 472, 9):
        d.line([q(x, 242), q(x + 2, 242)], fill=(255, 255, 255, 120), width=int(1.6 * sc))
    for x, y in nodes:
        cx, cy = q(x, y)
        d.ellipse([cx - 4.8 * sc, cy - 4.8 * sc, cx + 4.8 * sc, cy + 4.8 * sc], fill=(255, 255, 255))
    for x, y in [(165, 130), (330, 210)]:  # signál na pásech
        cx, cy = q(x, y)
        glow(img, lambda m: m.ellipse([cx - 12 * sc, cy - 12 * sc, cx + 12 * sc, cy + 12 * sc], fill=255), CYAN, 5 * S, 0.9)
        d = ImageDraw.Draw(img, "RGBA")
        d.ellipse([cx - 4.2 * sc, cy - 4.2 * sc, cx + 4.2 * sc, cy + 4.2 * sc], fill=(255, 255, 255))
    for x, text in ((40, "PRAXE"), (440, "FAKULTA")):
        d.text(q(x, 264), text, font=font(True, 13), fill=(255, 255, 255, 205), anchor="mm")

    img.resize((1200, 630), Image.LANCZOS).save(OUT, optimize=True)
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1024:.0f} kB")


if __name__ == "__main__":
    main()
