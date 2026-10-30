"""Gera 4 quadros de 'empurrar a roda' deformando o braco do sprite (warp suave).
Uso: python tools/make_chair_frames.py <char_front_raw.png> <char_back_raw.png> <saida>"""
import sys, numpy as np
from PIL import Image
from scipy import ndimage as ndi

front, back, out = sys.argv[1:4]
CFG = {   # mao e antebraco no sprite bruto (x, y), direcao do empurrao
    'se': {'file': front, 'hand': (33, 132), 'fore': (31, 116), 'dir': (0.5, 1.0)},
    'nw': {'file': back,  'hand': (50, 127), 'fore': (58, 114), 'dir': (0.6, 1.0)},
}
AMP = 7.0
PHASES = [0, 1, 0, -1]          # quadro 0 = parado

def warp(img, cfg, k):
    a = np.asarray(img).astype(float)
    H, W = a.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    dx = dy = 0
    for key, wgt, sig in (('hand', 1.0, 12.0), ('fore', 0.55, 14.0)):
        cx, cy = cfg[key]
        w = np.exp(-((xx-cx)**2 + (yy-cy)**2)/(2*sig**2))
        dx = dx + w*wgt*AMP*k*cfg['dir'][0]
        dy = dy + w*wgt*AMP*k*cfg['dir'][1]
    res = np.zeros_like(a)
    for c in range(4):
        res[..., c] = ndi.map_coordinates(a[..., c], [yy-dy, xx-dx], order=1, mode='constant')
    return Image.fromarray(np.clip(res, 0, 255).astype(np.uint8), 'RGBA')

for name, cfg in CFG.items():
    img = Image.open(cfg['file']).convert('RGBA')
    pad = Image.new('RGBA', (img.width+16, img.height+16), (0, 0, 0, 0)); pad.paste(img, (8, 8))
    for n, k in enumerate(PHASES):
        fr = warp(pad, {**cfg, 'hand': (cfg['hand'][0]+8, cfg['hand'][1]+8), 'fore': (cfg['fore'][0]+8, cfg['fore'][1]+8)}, k)
        fr = fr.resize((round(fr.width*.5), round(fr.height*.5)), Image.LANCZOS)
        mirror = 'sw' if name == 'se' else 'ne'
        fr.save(f'{out}/chair_{name}_{n}.png')
        fr.transpose(Image.FLIP_LEFT_RIGHT).save(f'{out}/chair_{mirror}_{n}.png')
print('ok')
