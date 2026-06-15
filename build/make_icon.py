#!/usr/bin/env python3
"""翰文 应用图标（定稿·现代极简）：浅米底 + 深墨「文」字 + 底部一抹金线。
4 倍超采样后缩小，输出 build/icon.png 与多尺寸 build/icon.ico。"""
from PIL import Image, ImageDraw, ImageFont

SANS = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
S = 4
W = 256 * S
CHAR = '文'


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


# 圆角(squircle)遮罩
mask = Image.new('L', (W, W), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.235), fill=255)

# 浅米色竖向渐变底
grad = Image.new('RGB', (W, W))
gd = ImageDraw.Draw(grad)
top, bot = (245, 242, 235), (227, 222, 211)
for y in range(W):
    gd.line([(0, y), (W, y)], fill=lerp(top, bot, y / (W - 1)))

img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
img.paste(grad, (0, 0), mask)
d = ImageDraw.Draw(img)

# 深墨「文」字，居中
font = ImageFont.truetype(SANS, int(W * 0.50))
bbox = d.textbbox((0, 0), CHAR, font=font)
cw, ch = bbox[2] - bbox[0], bbox[3] - bbox[1]
d.text(((W - cw) / 2 - bbox[0], (W - ch) / 2 - bbox[1] - int(W * 0.012)),
       CHAR, font=font, fill=(31, 34, 42))

# 底部一抹金线点缀
ly = int(W * 0.795)
d.rounded_rectangle([int(W * 0.40), ly, int(W * 0.60), ly + int(W * 0.014)],
                    radius=int(W * 0.007), fill=(186, 150, 92))

icon = img.resize((256, 256), Image.LANCZOS)
icon.save('/root/my/wenshu/build/icon.png')
icon.save('/root/my/wenshu/build/icon.ico',
          sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('定稿图标已生成：build/icon.png, build/icon.ico')
