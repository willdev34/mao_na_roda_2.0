"""Recorta caixas e NPCs do mapa como sprites e limpa o chao onde eles estavam.
Uso: python tools/cut_dynamic.py <map_sem_cadeirante.png> <saida public/assets> <mask_office.png>
O chao e reconstruido copiando pedacos do proprio piso (o piso se repete a cada 2 ladrilhos)."""
import sys, json, numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, out = sys.argv[1], sys.argv[2]
S = np.tan(np.radians(30)); T = 53.14
a = np.asarray(Image.open(src).convert('RGB')).copy()
H, W, _ = a.shape
r, g, b = [a[..., i].astype(float) for i in range(3)]
mx = a.max(2).astype(float); mn = a.min(2).astype(float); sat = (mx-mn)/(mx+1e-6)
floor = (r-b >= 14) & (r-b <= 70) & (sat > .07) & (sat < .35) & (mx > 150) & (mx < 245) & (g > b) & (r > g)
nf = ~floor
thick = ndi.binary_opening(nf, structure=np.ones((3, 3)))
yy, xx = np.mgrid[0:H, 0:W]

BOXES = {'a': (900, 432, 948, 472), 'k1': (262, 632, 378, 724),
         'k2': (368, 646, 490, 760), 'k3': (494, 566, 568, 652), 'b': (975, 418, 1090, 498), 'f1': (760, 958, 945, 1072)}
NPCS = {'men': (800, 282, 850, 440), 'maid': (1228, 388, 1322, 508),
        'r1': (1495, 490, 1548, 615), 'r2': (1555, 520, 1625, 660)}

def keep_largest(m):
    lab, n = ndi.label(m, structure=np.ones((3, 3)))
    if n == 0: return m
    sizes = ndi.sum(m, lab, range(1, n+1))
    return lab == 1+int(np.argmax(sizes))

def box_mask(bb):
    x0, y0, x1, y1 = bb
    reg = (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
    m = reg & (r-b > 45) & (sat > .36) & (r > 120)
    m = ndi.binary_closing(m, structure=np.ones((5, 5)))
    m = ndi.binary_fill_holes(m)
    m = ndi.binary_dilation(m, iterations=2) & reg & nf
    return m

def npc_mask(bb):
    x0, y0, x1, y1 = bb
    reg = (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
    bluegray = (b-r > 12) & (b > g+3) & (mx > 55)
    yellow = (r > 200) & (g > 190) & (b < 90)
    m = reg & nf & ~bluegray & ~yellow & ~SHADOW & thick
    m = keep_largest(m)
    m = ndi.binary_closing(m, structure=np.ones((5, 5)))
    m = ndi.binary_fill_holes(m)
    m = ndi.binary_dilation(m, iterations=2) & reg & nf
    return keep_largest(m)

SHADOW = ~floor & (r-b >= 12) & (sat < .34) & (mx > 120) & (mx < 218)
masks = {}
for k, bb in BOXES.items(): masks[k] = box_mask(bb)
for k, bb in NPCS.items(): masks[k] = npc_mask(bb)

# limpa o chao
ok = floor | (nf & ~ndi.binary_opening(nf, structure=np.ones((4, 4))))
near = (ndi.uniform_filter(ok.astype(float), 9) > 0.93) & ((yy - S*xx) < 728-5*26.55) & ((yy + S*xx) < 1801-5*26.55) & ((yy - S*xx) > -330) & ((yy + S*xx) > 830)
allm = np.zeros((H, W), bool)
shadow = SHADOW
for k, m in masks.items():
    if k in NPCS: continue          # NPCs ficam no mapa; o sprite so se mexe por cima
    allm |= ndi.binary_dilation(m, iterations=2)
    allm |= ndi.binary_dilation(m, iterations=14) & shadow
def sh(du, dv): return int(round((dv-du)/(2*S))), int(round((du+dv)/2))
shifts = [(0, -2), (-2, 0), (2, 0), (0, 2), (2, 2), (-2, -2), (-4, 0), (0, -4), (4, 0), (0, 4), (2, -2), (-2, 2)]
clean = a.copy(); todo = allm.copy()
# o que estava escondido atras da caixa (balcao, piso): move-se ao longo dos eixos do escritorio.
# Balcao e piso se repetem ao longo do eixo, entao a copia continua a mesma "linha" do movel.
dist, (iy, ix) = ndi.distance_transform_edt(allm, return_indices=True)
ref = a[iy, ix]                                   # cor do vizinho visivel mais proximo
# caixa encostada num balcao: o balcao escondido atras e reconstruido copiando ao longo do eixo dele
AXIS_FILL = {'b': (-92, -53)}
for key, (dx, dy) in AXIS_FILL.items():
    reg_k = (ndi.binary_dilation(masks[key], iterations=2) | (ndi.binary_dilation(masks[key], iterations=14) & SHADOW)) & todo
    ys, xs = np.nonzero(reg_k)
    sx, sy = xs+dx, ys+dy
    ok_ = (sx >= 0) & (sx < W) & (sy >= 0) & (sy < H)
    ok_[ok_] &= ~allm[sy[ok_], sx[ok_]]
    clean[ys[ok_], xs[ok_]] = a[sy[ok_], sx[ok_]]
    todo[ys[ok_], xs[ok_]] = False
axis_reg = ~todo & allm & ndi.binary_dilation(masks['b'], iterations=16)   # so a regiao reconstruida do balcao
# piso: copia pedacos do proprio piso (repete a cada 2 ladrilhos)
for k1, k2 in shifts:
    dx, dy = sh(k1*T, k2*T)
    ys, xs = np.nonzero(todo); sx, sy = xs+dx, ys+dy
    good = (sx >= 0) & (sx < W) & (sy >= 0) & (sy < H)
    good[good] &= near[sy[good], sx[good]] & ~allm[sy[good], sx[good]]
    clean[ys[good], xs[good]] = a[sy[good], sx[good]]
    todo[ys[good], xs[good]] = False
print('sem preencher:', int(todo.sum()))
# alisa o preenchimento (tira o ruido de pixels vizinhos copiados de lugares diferentes)
reg_ = axis_reg
for c in range(3):
    med = ndi.median_filter(clean[..., c], size=5)
    clean[..., c][reg_] = med[reg_]
# sobras: cor lisa do piso, e sombras escuras das caixas viram piso
interior = (yy - S*xx < 600) & (yy + S*xx < 1700) & (yy - S*xx > -300) & (yy + S*xx > 850)
typ = np.median(a[floor & interior & (mx > 195)], axis=0)
clean[todo] = typ
R = ndi.binary_dilation(allm, iterations=14)
dark = R & floor & (mx < 200) & ~ndi.binary_dilation(~ok & ~floor, iterations=0)
dark = ndi.binary_opening(dark, structure=np.ones((2, 2)))
clean[dark] = typ
Image.fromarray(clean).save(f'{out}/../../tools/map_base.png')

meta = {'boxes': {}, 'npcs': {}}
for k, m in masks.items():
    ys, xs = np.nonzero(m); x0, x1, y0, y1 = xs.min(), xs.max()+1, ys.min(), ys.max()+1
    rgba = np.dstack([a, m*255]).astype(np.uint8)[y0:y1, x0:x1]
    Image.fromarray(rgba).save(f'{out}/dyn_{k}.png')
    info = {'file': f'dyn_{k}.png', 'x': int(x0), 'y': int(y0), 'w': int(x1-x0), 'h': int(y1-y0)}
    # pegada no chao: parte de baixo da silhueta
    low = m & (yy > y0 + 0.5*(y1-y0))
    info['foot'] = [int(xs[ys > y0+0.5*(y1-y0)].mean()), int(y1)]
    (meta['boxes'] if k in BOXES else meta['npcs'])[k] = info
json.dump(meta, open(f'{out}/dynamic.json', 'w'), indent=1)
print({k: (v['w'], v['h']) for d in meta.values() for k, v in d.items()})
