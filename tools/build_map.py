"""Gera o mapa com transparencia e a grade de colisao a partir do print original.
Uso: python tools/build_map.py <mapa_original.png> <saida public/assets>
Projecao isometrica verdadeira (30 graus): u = y - S*x, v = y + S*x.
"""
import sys, json, numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, out = sys.argv[1], sys.argv[2]
S = np.tan(np.radians(30))
C = 26.55                      # meio ladrilho, em unidades u/v
U0, V0, NU, NV = -360.0, 792.0, 41, 38
START_UV = (177.0, 867.0)      # onde o cadeirante nasce
THR = 0.4                    # fracao minima de piso para a celula ser livre

im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(float)
H, W, _ = a.shape
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mx = a.max(2); mn = a.min(2); s = (mx - mn) / (mx + 1e-6)

# piso: bege quente, saturacao media
floor = (r-b >= 14) & (r-b <= 70) & (s > .07) & (s < .35) & (mx > 150) & (mx < 245) & (g > b) & (r > g)
# piso visto atraves do vidro (mais claro e desbotado)
relax = ((mx > 165) & (r >= b+2) & (r >= g-4) & (s < .32) & (b > r-30)) | floor
fr_s = ndi.uniform_filter(floor.astype(float), 13)
fr_r = ndi.uniform_filter(relax.astype(float), 13)

def to_xy(u, v): return (v-u)/(2*S), (u+v)/2

blocked = np.zeros((NU, NV), bool)
for i in range(NU):
    for j in range(NV):
        uc, vc = U0+(i+.5)*C, V0+(j+.5)*C
        x, y = to_xy(uc, vc); x, y = int(round(x)), int(round(y))
        glass = uc > 728-6*C or vc > 1801-6*C
        blocked[i, j] = (fr_r[y, x] < .75) if glass else (fr_s[y, x] < THR)
# personagens em pe (pes na imagem original): bloqueiam a celula e as vizinhas
for fx, fy in [(822, 428), (838, 400), (1285, 497), (1518, 605), (1583, 652)]:
    uu, vv = fy - S*fx, fy + S*fx
    ci, cj = int((uu-U0)//C), int((vv-V0)//C)
    blocked[max(ci-2, 0):ci+3, max(cj-2, 0):cj+3] = True
blocked[0, :] = blocked[-1, :] = True
blocked[:, 0] = blocked[:, -1] = True

# so vale o que e alcancavel a partir do ponto inicial
si, sj = int((START_UV[0]-U0)//C), int((START_UV[1]-V0)//C)
lab, _ = ndi.label(~blocked)
reach = lab == lab[si, sj]
blocked = ~reach

# mapa recortado, com transparencia fora do escritorio
mask = np.asarray(Image.open(sys.argv[3]).convert('L')) > 127 if len(sys.argv) > 3 else np.ones((H, W), bool)
ys, xs = np.nonzero(mask)
x0, y0, x1, y1 = xs.min(), ys.min(), xs.max()+1, ys.max()+1
rgba = np.dstack([a, mask*255]).astype(np.uint8)
Image.fromarray(rgba).crop((x0, y0, x1, y1)).save(f'{out}/office.png')

json.dump({
    'S': S, 'C': C, 'u0': U0, 'v0': V0, 'nu': NU, 'nv': NV,
    'offsetX': int(x0), 'offsetY': int(y0), 'width': int(x1-x0), 'height': int(y1-y0),
    'start': START_UV,
    'blocked': [''.join('1' if blocked[i, j] else '0' for j in range(NV)) for i in range(NU)],
}, open(f'{out}/collision.json', 'w'))
print("mapa", x1-x0, y1-y0, "livres", int((~blocked).sum()), "de", blocked.size)
