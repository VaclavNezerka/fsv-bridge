#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Krátká smyčková videa pro úvodní stránku FSv Bridge (sekce „Moderní metody a laboratoře“).

Videa jsou vypočtená (žádné cizí záběry): laserové skenování mostu, korelace digitálního obrazu
a výpočtový model příhradového mostu s jedoucím zatížením. Každé je 8 s dlouhá plynulá smyčka.

Použití (z kořene projektu):  python tools/tech_videa.py
Vyžaduje numpy, Pillow a ffmpeg. Výstup: src/video/*.webm, *.mp4 a náhledy src/img/tech/*.webp.
"""
import math
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT_VIDEO = ROOT / "src" / "video"
OUT_POSTER = ROOT / "src" / "img" / "tech"
W, H, FPS, SEC = 768, 480, 24, 8
N = FPS * SEC
NAVY0, NAVY1 = np.array([6, 24, 45], float), np.array([11, 42, 74], float)
RNG = np.random.default_rng(7)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def background():
    """Tmavě modrý přechod s jemnou mřížkou (technický výkres)."""
    y = np.linspace(0, 1, H)[:, None, None]
    x = np.linspace(0, 1, W)[None, :, None]
    bg = NAVY0 * (1 - y) + NAVY1 * y
    bg = bg + 14 * np.exp(-((x - 0.82) ** 2 + (y - 0.15) ** 2) / 0.08) * np.array([0, 0.45, 1.0])
    bg = np.broadcast_to(bg, (H, W, 3)).copy()
    bg[::32, :, :] += 5
    bg[:, ::32, :] += 5
    return bg


def vignette(img):
    y = np.linspace(-1, 1, H)[:, None]
    x = np.linspace(-1, 1, W)[None, :]
    v = 1 - 0.28 * (x ** 2 * 0.6 + y ** 2)
    return img * v[:, :, None]


def colormap(t, stops):
    """Lineární barevná škála: t ∈ ⟨0, 1⟩, stops = [(poloha, (r, g, b)), …]."""
    t = np.clip(t, 0, 1)
    pos = np.array([s[0] for s in stops])
    cols = np.array([s[1] for s in stops], float)
    out = np.empty(t.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(t, pos, cols[:, c])
    return out


TURBO = [(0, (48, 18, 160)), (0.18, (40, 110, 240)), (0.38, (30, 200, 220)), (0.55, (80, 230, 120)),
         (0.72, (230, 220, 50)), (0.86, (250, 140, 30)), (1, (220, 40, 30))]
HEIGHT = [(0, (30, 70, 160)), (0.35, (40, 170, 230)), (0.7, (120, 230, 210)), (1, (242, 200, 80))]


def to_uint8(a):
    return np.clip(a, 0, 255).astype(np.uint8)


def glow(arr, radius=4, strength=0.9):
    im = Image.fromarray(to_uint8(arr))
    g = np.asarray(im.filter(ImageFilter.GaussianBlur(radius)), float)
    return arr + strength * g


# ----------------------------------------------------------------------------- 1) laserové skenování
def bridge_cloud():
    pts, kind = [], []

    def add(p, k):
        pts.append(p)
        kind.extend([k] * len(p))

    # mostovka
    xs, ys = RNG.uniform(-30, 30, 4200), RNG.uniform(-5, 5, 4200)
    add(np.c_[xs, ys, np.full(4200, 8.0) + RNG.normal(0, .03, 4200)], 1)
    for yy in (-5, 5):  # boky mostovky
        x = RNG.uniform(-30, 30, 900)
        add(np.c_[x, np.full(900, yy), 8 - RNG.uniform(0, 1.4, 900)], 1)
    # oblouky a závěsy
    for yy in (-4.6, 4.6):
        s = RNG.uniform(-24, 24, 1300)
        z = 8 + 10 * (1 - (s / 24) ** 2)
        add(np.c_[s, yy + RNG.normal(0, .25, 1300), z + RNG.normal(0, .25, 1300)], 2)
        for hx in np.arange(-20, 21, 4):
            top = 8 + 10 * (1 - (hx / 24) ** 2)
            zz = RNG.uniform(8, top, 60)
            add(np.c_[np.full(60, hx) + RNG.normal(0, .06, 60), np.full(60, yy), zz], 2)
    # pilíře a opěry
    for px in (-30, 30):
        a = RNG.uniform(0, 2 * math.pi, 700)
        add(np.c_[px + 1.6 * np.cos(a) * 0.6, 3.5 * np.sin(a), RNG.uniform(0, 8, 700)], 3)
    # terén s údolím a řekou
    gx, gy = RNG.uniform(-48, 48, 11000), RNG.uniform(-32, 32, 11000)
    gz = 7.5 * np.clip(np.abs(gx) / 34, 0, 1) ** 1.6 + 0.6 * np.sin(gy / 5) + RNG.normal(0, .12, 11000)
    add(np.c_[gx, gy, gz], 0)
    return np.vstack(pts), np.array(kind)


def render_scan():
    P, kind = bridge_cloud()
    zn = np.clip(P[:, 2] / 18, 0, 1)
    col = colormap(zn, HEIGHT)
    river = (kind == 0) & (P[:, 2] < 0.9)
    col[river] = [30, 120, 220]
    col[kind == 0] *= 0.55
    bg = vignette(background())
    scanner = np.array([-40.0, -26.0, 3.0])
    frames = []
    for f in range(N):
        t = f / N
        th = math.radians(-58 + 14 * math.sin(2 * math.pi * t))
        el = math.radians(20)
        dist = 118
        target = np.array([0, 0, 7.0])
        cam = target + dist * np.array([math.cos(el) * math.cos(th), math.cos(el) * math.sin(th), math.sin(el)])
        fwd = (target - cam) / np.linalg.norm(target - cam)
        right = np.cross(fwd, [0, 0, 1]); right /= np.linalg.norm(right)
        up = np.cross(right, fwd)
        rel = P - cam
        zc = rel @ fwd
        ok = zc > 1
        xs = (rel @ right)[ok] / zc[ok]
        ys = (rel @ up)[ok] / zc[ok]
        foc = 700
        uf = W / 2 + foc * xs
        vf = H / 2 - foc * ys + 40
        u0, v0 = np.floor(uf).astype(int), np.floor(vf).astype(int)
        fu, fv = uf - u0, vf - v0
        inside = (u0 >= 0) & (u0 < W - 1) & (v0 >= 0) & (v0 < H - 1)
        xsweep = -50 + 100 * t
        band = np.exp(-((P[ok, 0] - xsweep) ** 2) / 3.0)
        inten = 0.8 + 1.6 * band
        c = (col[ok] * inten[:, None] + band[:, None] * np.array([110, 170, 200]))[inside] * 0.95
        acc = np.zeros((H, W, 3))
        # bod rozdělený do čtyř sousedních pixelů – při pohybu kamery nebliká (a video je menší)
        fu, fv, u0, v0 = fu[inside], fv[inside], u0[inside], v0[inside]
        for du, dv, w in ((0, 0, (1 - fu) * (1 - fv)), (1, 0, fu * (1 - fv)), (0, 1, (1 - fu) * fv), (1, 1, fu * fv)):
            np.add.at(acc, (v0 + dv, u0 + du), c * w[:, None])
        img = bg + glow(acc, 2.2, 0.85)
        im = Image.fromarray(to_uint8(img))
        d = ImageDraw.Draw(im, "RGBA")
        # paprsky skeneru k bodům v pásu skenování
        sel = np.where(ok)[0][(band > 0.55) & (kind[ok] > 0)]
        if len(sel):
            pick = RNG.choice(sel, size=min(14, len(sel)), replace=False)
            rs = scanner - cam
            zs = rs @ fwd
            su, sv = W / 2 + foc * (rs @ right) / zs, H / 2 - foc * (rs @ up) / zs + 40
            for i in pick:
                r = P[i] - cam
                zr = r @ fwd
                d.line([(su, sv), (W / 2 + foc * (r @ right) / zr, H / 2 - foc * (r @ up) / zr + 40)], fill=(120, 220, 255, 34), width=1)
            d.ellipse([su - 4, sv - 4, su + 4, sv + 4], fill=(242, 169, 0, 230))
        frames.append(np.asarray(im))
    return frames


# ----------------------------------------------------------------------------- 2) korelace digitálního obrazu
def render_dic():
    bg = vignette(background())
    pw, ph = 560, 290
    x0, y0 = (W - pw) // 2, (H - ph) // 2
    a = 46.0
    # skvrnitý vzor (speckle) vzorku v klidu – jemné tmavé skvrny na světlém podkladu
    sp = np.full((ph, pw), 200.0)
    for _ in range(5200):
        cx, cy, r = RNG.uniform(0, pw), RNG.uniform(0, ph), RNG.uniform(1.2, 3.2)
        ylo, yhi, xlo, xhi = int(max(cy - r - 1, 0)), int(min(cy + r + 2, ph)), int(max(cx - r - 1, 0)), int(min(cx + r + 2, pw))
        yy, xx = np.mgrid[ylo:yhi, xlo:xhi]
        sp[ylo:yhi, xlo:xhi] = np.minimum(sp[ylo:yhi, xlo:xhi], 200 - 170 * np.clip(1.4 - np.hypot(xx - cx, yy - cy) / r, 0, 1))
    yy, xx = np.mgrid[0:ph, 0:pw]
    gx, gy = np.mgrid[0:H, 0:W][1].astype(float), np.mgrid[0:H, 0:W][0].astype(float)
    frames = []
    for f in range(N):
        t = f / N
        s = 0.5 * (1 - math.cos(2 * math.pi * t))
        ex, ey = 1 + 0.045 * s, 1 - 0.014 * s
        # inverzní zobrazení: pixel obrazu → bod vzorku v klidu (protažení vůči středu)
        cxp, cyp = W / 2, H / 2
        sx = (gx - cxp) / ex + pw / 2
        sy = (gy - cyp) / ey + ph / 2
        inside = (sx >= 0) & (sx < pw - 1) & (sy >= 0) & (sy < ph - 1)
        rx, ry = sx - pw / 2, sy - ph / 2
        r = np.hypot(rx, ry)
        hole = r < a
        mask = inside & ~hole
        th = np.arctan2(ry, rx)
        rr = np.maximum(r, a)
        sxx = 1 - (a ** 2 / rr ** 2) * (1.5 * np.cos(2 * th) + np.cos(4 * th)) + 1.5 * (a ** 4 / rr ** 4) * np.cos(4 * th)
        field = colormap((sxx * s) / 3.0, TURBO)
        spv = np.zeros((H, W))
        ixs, iys = sx[mask].astype(int), sy[mask].astype(int)
        spv[mask] = sp[iys, ixs]
        img = bg.copy()
        # bez zatížení šedý snímek vzorku, s rostoucím zatížením vystupuje barevná mapa přetvoření
        alpha = 0.08 + 0.62 * s
        gray = 0.78 * spv[mask][:, None]
        img[mask] = gray * (1 - alpha) + field[mask] * (0.55 + 0.45 * spv[mask][:, None] / 200) * alpha
        img = glow(img, 3, 0.15)
        im = Image.fromarray(to_uint8(img))
        d = ImageDraw.Draw(im, "RGBA")
        # oblast zájmu (ROI) a body výpočetní sítě s vektory posunů
        rx0, ry0 = cxp - pw / 2 * ex, cyp - ph / 2 * ey
        rx1, ry1 = cxp + pw / 2 * ex, cyp + ph / 2 * ey
        for k in range(0, int(rx1 - rx0), 14):
            if (k // 14) % 2 == 0:
                d.line([(rx0 + k, ry0 - 10), (min(rx0 + k + 8, rx1), ry0 - 10)], fill=(100, 210, 255, 170), width=2)
                d.line([(rx0 + k, ry1 + 10), (min(rx0 + k + 8, rx1), ry1 + 10)], fill=(100, 210, 255, 170), width=2)
        for gxp in range(40, pw, 40):
            for gyp in range(30, ph, 40):
                if math.hypot(gxp - pw / 2, gyp - ph / 2) < a + 14:
                    continue
                px, py = cxp + (gxp - pw / 2) * ex, cyp + (gyp - ph / 2) * ey
                ux, uy = (gxp - pw / 2) * 0.045 * s * 1.8, -(gyp - ph / 2) * 0.014 * s * 1.8
                d.line([(px - 3, py), (px + 3, py)], fill=(255, 255, 255, 120))
                d.line([(px, py - 3), (px, py + 3)], fill=(255, 255, 255, 120))
                if s > 0.05:
                    d.line([(px, py), (px + ux, py + uy)], fill=(255, 255, 255, int(200 * s)), width=2)
        # barevná škála vpravo
        for i in range(160):
            c = colormap(np.array([1 - i / 159]), TURBO)[0]
            d.line([(W - 34, 160 + i), (W - 22, 160 + i)], fill=tuple(int(v) for v in c) + (230,))
        d.rectangle([W - 35, 159, W - 21, 320], outline=(200, 225, 255, 160))
        frames.append(np.asarray(im))
    return frames


# ----------------------------------------------------------------------------- 3) výpočtový model příhradového mostu
def truss():
    span, n, h = 32.0, 8, 4.5
    nodes = [(i * span / n, 0.0) for i in range(n + 1)] + [(i * span / n, h) for i in range(1, n)]
    B = list(range(n + 1))
    T = {i: n + i for i in range(1, n)}  # horní uzel nad dolním uzlem i
    el = [(B[i], B[i + 1]) for i in range(n)]
    el += [(T[i], T[i + 1]) for i in range(1, n - 1)]
    el += [(B[0], T[1]), (B[n], T[n - 1])]
    el += [(T[i], B[i]) for i in range(1, n)]
    el += [(T[i], B[i + 1]) for i in range(1, n // 2)] + [(T[i], B[i - 1]) for i in range(n // 2 + 1, n)]
    return np.array(nodes), el, n, span


def solve(nodes, el, n, span, xp, P=1.0):
    nd = len(nodes)
    K = np.zeros((2 * nd, 2 * nd))
    for a, b in el:
        dx, dy = nodes[b] - nodes[a]
        L = math.hypot(dx, dy)
        c, s = dx / L, dy / L
        k = np.array([[c * c, c * s], [c * s, s * s]]) / L
        for i, j, sg in ((a, a, 1), (b, b, 1), (a, b, -1), (b, a, -1)):
            K[2 * i:2 * i + 2, 2 * j:2 * j + 2] += sg * k
    f = np.zeros(2 * nd)
    if 0 <= xp <= span:
        pos = xp / span * n
        i0 = min(int(pos), n - 1)
        w = pos - i0
        f[2 * i0 + 1] -= P * (1 - w)
        f[2 * (i0 + 1) + 1] -= P * w
    fixed = [0, 1, 2 * n + 1]
    free = [d for d in range(2 * nd) if d not in fixed]
    u = np.zeros(2 * nd)
    u[free] = np.linalg.solve(K[np.ix_(free, free)], f[free])
    N_ = []
    for a, b in el:
        dx, dy = nodes[b] - nodes[a]
        L = math.hypot(dx, dy)
        c, s = dx / L, dy / L
        N_.append(((u[2 * b] - u[2 * a]) * c + (u[2 * b + 1] - u[2 * a + 1]) * s) / L)
    return u, np.array(N_)


def render_fem():
    nodes, el, n, span = truss()
    bg = vignette(background())
    sc, ox, oy = 18.5, (W - 32 * 18.5) / 2, H * 0.62
    xps = np.linspace(-9, span + 9, N, endpoint=False)
    sols = [solve(nodes, el, n, span, xp) for xp in xps]
    umax = max(np.abs(u).max() for u, _ in sols) or 1
    nmax = max(np.abs(Nn).max() for _, Nn in sols) or 1
    amp = 26 / umax
    mid = n // 2
    defl = [-u[2 * mid + 1] * amp for u, _ in sols]  # průhyb uprostřed rozpětí – graf jako klouzavé okno (plynulá smyčka)
    frames = []
    for f in range(N):
        u, Nn = sols[f]
        xp = xps[f]
        pts = [(ox + sc * x + amp * u[2 * i], oy - sc * y - amp * u[2 * i + 1]) for i, (x, y) in enumerate(nodes)]
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer, "RGBA")
        for (a, b), Ni in zip(el, Nn):
            q = Ni / nmax
            col = (255, int(120 - 60 * min(q, 1)), 60) if q > 0.03 else ((70, 190, 255) if q < -0.03 else (150, 175, 205))
            d.line([pts[a], pts[b]], fill=col + (255,), width=int(2 + 5 * min(abs(q), 1)))
        glow_l = layer.filter(ImageFilter.GaussianBlur(6))
        base = Image.fromarray(to_uint8(bg)).convert("RGBA")
        d0 = ImageDraw.Draw(base, "RGBA")
        # vozovka, opěry a terén
        d0.line([(0, oy + 10), (W, oy + 10)], fill=(90, 130, 170, 120), width=2)
        for xx in (0, span):
            px = ox + sc * xx
            d0.polygon([(px - 22, oy + 10), (px + 22, oy + 10), (px + 34, H), (px - 34, H)], fill=(25, 55, 90, 255))
        base = Image.alpha_composite(base, glow_l)
        base = Image.alpha_composite(base, glow_l)
        base = Image.alpha_composite(base, layer)
        d2 = ImageDraw.Draw(base, "RGBA")
        for (px, py) in pts:
            d2.ellipse([px - 3.5, py - 3.5, px + 3.5, py + 3.5], fill=(230, 242, 255, 255))
        # vozidlo (zatížení) a šipka síly
        vx = ox + sc * xp
        ix = min(max(int(xp / span * n), 0), n - 1)
        wgt = min(max(xp / span * n - ix, 0), 1)
        vy = oy - amp * (u[2 * ix + 1] * (1 - wgt) + u[2 * (ix + 1) + 1] * wgt) if 0 <= xp <= span else oy
        d2.rounded_rectangle([vx - 26, vy - 30, vx + 26, vy - 8], radius=5, fill=(242, 169, 0, 255))
        d2.rectangle([vx + 8, vy - 40, vx + 26, vy - 28], fill=(242, 169, 0, 255))
        for wx in (vx - 16, vx + 16):
            d2.ellipse([wx - 6, vy - 12, wx + 6, vy], fill=(20, 30, 45, 255), outline=(242, 169, 0, 255))
        d2.line([(vx, vy - 86), (vx, vy - 48)], fill=(255, 215, 120, 220), width=3)
        d2.polygon([(vx - 8, vy - 56), (vx + 8, vy - 56), (vx, vy - 44)], fill=(255, 215, 120, 230))
        # průběh průhybu uprostřed rozpětí (monitorovací graf vlevo nahoře)
        gx0, gy0, gw, gh = 26, 26, 192, 64
        d2.rounded_rectangle([gx0 - 8, gy0 - 8, gx0 + gw + 8, gy0 + gh + 8], radius=8, fill=(8, 30, 56, 200), outline=(80, 150, 210, 120))
        d2.line([(gx0, gy0 + 6), (gx0 + gw, gy0 + 6)], fill=(80, 150, 210, 90))
        seq = [defl[(f - k) % N] for k in range(N - 1, -1, -1)]
        line = [(gx0 + i * gw / (N - 1), gy0 + 6 + (gh - 12) * (v / 26)) for i, v in enumerate(seq)]
        d2.line(line, fill=(90, 220, 255, 255), width=2)
        ex, ey = line[-1]
        d2.ellipse([ex - 4, ey - 4, ex + 4, ey + 4], fill=(242, 169, 0, 255))
        frames.append(np.asarray(base.convert("RGB")))
    return frames


# ----------------------------------------------------------------------------- výstup
def encode(name, frames, poster_at=0.3, crf_vp9=38, crf_264=28):
    OUT_VIDEO.mkdir(parents=True, exist_ok=True)
    OUT_POSTER.mkdir(parents=True, exist_ok=True)
    ff = shutil.which("ffmpeg")
    raw = b"".join(f.astype(np.uint8).tobytes() for f in frames)
    common = [ff, "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    subprocess.run(common + ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", str(crf_vp9), "-row-mt", "1", "-deadline", "good", "-cpu-used", "2",
                             "-pix_fmt", "yuv420p", "-an", str(OUT_VIDEO / f"{name}.webm")], input=raw, check=True)
    subprocess.run(common + ["-c:v", "libx264", "-preset", "slow", "-crf", str(crf_264), "-pix_fmt", "yuv420p", "-profile:v", "main",
                             "-movflags", "+faststart", "-an", str(OUT_VIDEO / f"{name}.mp4")], input=raw, check=True)
    Image.fromarray(frames[int(poster_at * len(frames))].astype(np.uint8)).save(OUT_POSTER / f"{name}.webp", "WEBP", quality=80, method=6)
    sizes = [f"{p.suffix[1:]} {p.stat().st_size / 1024:.0f} kB" for p in (OUT_VIDEO / f"{name}.webm", OUT_VIDEO / f"{name}.mp4", OUT_POSTER / f"{name}.webp")]
    print(f"{name}: " + ", ".join(sizes))


if __name__ == "__main__":
    vyber = set(sys.argv[1:]) or {"skenovani", "dic", "mkp"}
    if "skenovani" in vyber:
        encode("skenovani", render_scan(), 0.45, crf_vp9=44, crf_264=31)  # mračno bodů je jemné – vyšší komprese
    if "dic" in vyber:
        encode("dic", render_dic(), 0.5)
    if "mkp" in vyber:
        encode("mkp", render_fem(), 0.5)
