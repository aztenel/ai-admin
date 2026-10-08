# Рисует иконки приложения (180, 192, 512 px) в папку pult/. Запуск: python3 tools/make-icons.py
from PIL import Image, ImageDraw
import os
S = 2048
img = Image.new("RGB", (S, S), "#0A0A0A")
d = ImageDraw.Draw(img)
# фон: плавный тёмно-зелёный градиент сверху вниз, без полос
top, bot = (13, 52, 36), (7, 22, 15)
for y in range(S):
    t = y / (S - 1)
    d.line([(0, y), (S, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
# пузырь переписки
g = "#2BCB68"
x0, y0, x1, y1, r = 380, 520, 1668, 1400, 300
d.rounded_rectangle([x0, y0, x1, y1], r, fill=g)
d.polygon([(560, 1340), (560, 1640), (860, 1380)], fill=g)
# галочка внутри
w = 96
d.line([(720, 960), (910, 1150), (1330, 760)], fill="#052E16", width=w, joint="curve")
for (cx, cy) in [(720, 960), (910, 1150), (1330, 760)]:
    d.ellipse([cx - w // 2, cy - w // 2, cx + w // 2, cy + w // 2], fill="#052E16")
os.makedirs("pult", exist_ok=True)
for n in (180, 192, 512):
    img.resize((n, n), Image.LANCZOS).save("pult/icon-%d.png" % n, optimize=True)
print("ok")
