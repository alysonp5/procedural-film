"""prep.py : generated stills -> assets/cut/<id>.webp for tools/photos.cjs (instrument mode).

    python3 tools/prep.py

Every assets/gen/**/*.jpg becomes assets/cut/<basename>.webp. Stills for the tall sky pan are sized to
1080 wide and saved at quality 95 (lower posterizes the gradients): name them sky_* to also grade them
toward one saturated afternoon blue (hue ~211 deg, clouds left alone), or pan_* to keep their own
colour (a dusk, a night). Everything else keeps its size at quality 88.
Stills named *iso* are keyed: their plain white studio background becomes alpha.
"""
import glob, os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN = os.path.join(ROOT, 'assets', 'gen')
OUT = os.path.join(ROOT, 'assets', 'cut')


def grade_sky(im):
    hsv = np.asarray(im.convert('HSV')).astype(np.float32) / 255.0
    rgb = np.asarray(im).astype(np.float32) / 255.0
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    blue = np.clip((rgb[..., 2] - rgb[..., 0]) * 6.0, 0, 1)  # sky-ness: bluish, not a warm cloud
    h2 = h * (1 - blue) + 0.585 * blue
    s2 = s * (1 - blue) + np.clip(0.50 + (s - 0.2) * 0.6, 0.35, 0.68) * blue
    v2 = v * (1 - blue) + np.clip(v * 0.93 + 0.02, 0, 1) * blue
    out = np.stack([h2, s2, v2], -1)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), 'HSV').convert('RGB')


def key_white(im):
    a = np.asarray(im).astype(np.float32) / 255.0
    alpha = np.clip((0.93 - a.min(-1)) / 0.10, 0, 1)
    m = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    im = im.copy()
    im.putalpha(m)
    return im


os.makedirs(OUT, exist_ok=True)
for f in sorted(glob.glob(os.path.join(GEN, '**', '*.jpg'), recursive=True)):
    id_ = os.path.splitext(os.path.basename(f))[0]
    im = Image.open(f).convert('RGB')
    q = 88
    if 'iso' in id_:
        im = key_white(im)
    elif id_.startswith('sky_') or id_.startswith('pan_'):
        if id_.startswith('sky_'):
            im = grade_sky(im)
        im = im.resize((1080, round(im.height * 1080 / im.width)), Image.LANCZOS)
        q = 95
    im.save(os.path.join(OUT, id_ + '.webp'), 'WEBP', quality=q, method=6)
    print(id_, im.size)
