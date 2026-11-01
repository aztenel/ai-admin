"""Готовит скриншоты кейсов для сайта: WebP нескольких ширин + JPEG как запасной вариант.

Исходники — настоящие снимки живых сайтов (Playwright, deviceScaleFactor 2), в репозиторий не кладутся.
Запуск: python3 scripts/images.py <папка с исходниками>
"""
import sys
from pathlib import Path
from PIL import Image

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "../../.shots")
OUT = Path(__file__).resolve().parent.parent / "public" / "images" / "winchester"
OUT.mkdir(parents=True, exist_ok=True)

# имя на сайте: (файл-исходник, обрезка в пикселях исходника или None, ширины)
JOBS = {
    "site-desktop": ("site-desktop.png", None, [1440, 960]),
    "booking-time": ("book-d-3.png", (1000, 0, 2880, 1800), [1200, 760]),
    "booking-services": ("book-d-2.png", (1000, 0, 2880, 1800), [1200, 760]),
    "booking-masters": ("book-d-1.png", (1000, 0, 2880, 1800), [1200, 760]),
    "site-mobile": ("site-mobile.png", None, [780, 400]),
    "booking-mobile": ("book-m-1.png", None, [780, 400]),
}

for name, (src, crop, widths) in JOBS.items():
    im = Image.open(SRC / src).convert("RGB")
    if crop:
        im = im.crop(crop)
    for w in widths:
        h = round(im.height * w / im.width)
        r = im.resize((w, h), Image.LANCZOS)
        r.save(OUT / f"{name}-{w}.webp", "WEBP", quality=82, method=6)
    big = widths[0]
    im.resize((big, round(im.height * big / im.width)), Image.LANCZOS).save(OUT / f"{name}-{big}.jpg", "JPEG", quality=84, optimize=True, progressive=True)
    print(name, im.size, "->", widths)
