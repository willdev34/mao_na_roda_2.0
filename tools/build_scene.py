"""Monta a cena: mapa base, grade de colisao, caixas, primeiro plano (oclusao) e alvos das missoes.
Uso: python tools/build_scene.py <map_base.png> <public/assets> <mask_office.png>
Projecao isometrica verdadeira (30 graus): u = y - S*x, v = y + S*x.
"""
import sys, json, numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, out, maskf = sys.argv[1], sys.argv[2], sys.argv[3]
S = np.tan(np.radians(30)); C = 26.55
U0, V0, NU, NV = -360.0, 792.0, 41, 38
THR = 0.4
START_PX = (598, 522)               # pes do cadeirante, em pixels do mapa original
# pontos de interacao das missoes (pixels do mapa original, no chao)
TARGETS = {
    'cafe':      {'px': (292, 690), 'r': 62, 'cls': 'cafeteira', 'obj': (180, 585, 70, 62)},
    'impressora': {'px': (1012, 300), 'r': 62, 'cls': 'impressora', 'obj': (965, 150, 66, 98)},
    'mesa':      {'px': (846, 1058), 'r': 62, 'cls': 'mesa', 'obj': (775, 1078, 215, 165)},
}
NPC_FEET = [(822, 428), (838, 400), (1285, 497), (1518, 605), (1583, 652)]
STATIC_BOX_PX = []                   # caixas que ficam fixas (nao chutaveis) ja estao no mapa

def uv(x, y): return y - S*x, y + S*x
def xy(u, v): return (v-u)/(2*S), (u+v)/2

im = Image.open(src).convert('RGB'); a = np.asarray(im).astype(float)
H, W, _ = a.shape
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mx = a.max(2); mn = a.min(2); s = (mx-mn)/(mx+1e-6)
yellow = (r > 200) & (g > 190) & (b < 90)
floor = (r-b >= 14) & (r-b <= 70) & (s > .07) & (s < .35) & (mx > 150) & (mx < 245) & (g > b) & (r > g)
floor |= yellow                      # faixa amarela e chao andavel
relax = ((mx > 165) & (r >= b+2) & (r >= g-4) & (s < .32) & (b > r-30)) | floor
fr_s = ndi.uniform_filter(floor.astype(float), 13)
fr_r = ndi.uniform_filter(relax.astype(float), 13)

def cell_of(u, v): return int((u-U0)//C), int((v-V0)//C)

blocked = np.zeros((NU, NV), bool)
for i in range(NU):
    for j in range(NV):
        uc, vc = U0+(i+.5)*C, V0+(j+.5)*C
        x, y = xy(uc, vc); x, y = int(round(x)), int(round(y))
        glass = uc > 728-6*C or vc > 1801-6*C
        blocked[i, j] = (fr_r[y, x] < .75) if glass else (fr_s[y, x] < THR)
# corredores que a classificacao por cor nao enxerga (passagens estreitas, vidro)
FORCE_FREE = [[(1280, 700), (1290, 640), (1300, 590), (1292, 545)],
              [(790, 925), (840, 985), (850, 1040), (846, 1058)]]
for path in FORCE_FREE:
    for (x1, y1), (x2, y2) in zip(path, path[1:]):
        for t in np.linspace(0, 1, 40):
            ci_, cj_ = cell_of(*uv(x1+(x2-x1)*t, y1+(y2-y1)*t))
            blocked[max(ci_-1, 0):ci_+2, max(cj_-1, 0):cj_+2] = False
ring = np.zeros_like(blocked); ring[0, :] = ring[-1, :] = ring[:, 0] = ring[:, -1] = True
ring[-2, :] = ring[:, -2] = True         # margem junto ao vidro
blocked |= ring

npc_cells = np.zeros_like(blocked)
for fx, fy in NPC_FEET:
    ci, cj = cell_of(*uv(fx, fy))
    npc_cells[max(ci-1, 0):ci+2, max(cj-1, 0):cj+2] = True
blocked |= npc_cells

# caixas chutaveis: celulas da metade de baixo da silhueta
dyn = json.load(open(f'{out}/dynamic.json'))
box_cells = {}
for k, bx in dyn['boxes'].items():
    al = np.asarray(Image.open(f"{out}/{bx['file']}"))[..., 3] > 0
    ys, xs = np.nonzero(al)
    low = ys > (bx['h']*0.45)
    cells = set()
    for x_, y_ in zip(xs[low][::2], ys[low][::2]):
        cells.add(cell_of(*uv(bx['x']+x_, bx['y']+y_)))
    cells = {c for c in cells if 0 < c[0] < NU-1 and 0 < c[1] < NV-1}
    box_cells[k] = sorted(cells)
    bx['cells'] = [list(c) for c in cells]

# alcance a partir do inicio, com as caixas contando como livres (podem ser chutadas)
si, sj = cell_of(*uv(*START_PX))
free = ~blocked
for cs in box_cells.values():
    for c in cs: free[c] = True
free[si, sj] = True
lab, _ = ndi.label(free)
reach = lab == lab[si, sj]
# alvos: libera uma pequena area ao redor, se estiver fora do alcance
tinfo = {}
for k, t in TARGETS.items():
    u, v = uv(*t['px']); ci, cj = cell_of(u, v)
    ok_ = reach[max(ci-1, 0):ci+2, max(cj-1, 0):cj+2].any()
    tinfo[k] = {'u': u, 'v': v, 'r': t['r'], 'px': t['px'], 'cls': t['cls'], 'obj': t['obj'], 'reachable': bool(ok_)}
    print(k, 'alcancavel' if ok_ else 'FORA DO ALCANCE')
base_block = ~reach
for cs in box_cells.values():
    for c in cs: base_block[c] = False         # a grade estatica nao conta as caixas

# primeiro plano: pixels nao-piso atribuidos a celula bloqueada logo abaixo
nf = ~floor
thick = ndi.binary_dilation(ndi.binary_opening(nf, structure=np.ones((3, 3))), iterations=1)
mask = np.asarray(Image.open(maskf).convert('L')) > 127
yy, xx = np.mgrid[0:H, 0:W]
uu, vv = yy - S*xx, yy + S*xx
ci = np.floor((uu-U0)/C).astype(int); cj = np.floor((vv-V0)/C).astype(int)
inside = (ci >= 0) & (ci < NU) & (cj >= 0) & (cj < NV)
solid = np.zeros((NU, NV), bool)                # celulas que geram oclusao
solid |= blocked & ~npc_cells
for cs in box_cells.values():
    for c in cs: solid[c] = False
solid[0, :] = False; solid[:, 0] = False        # paredes do fundo ficam sempre atras
cell_front = np.zeros((NU, NV))                 # y do vertice de baixo da celula
for i in range(NU):
    for j in range(NV):
        cell_front[i, j] = xy(U0+(i+1)*C, V0+(j+1)*C)[1]
# nas celulas de vidro a frente da parede cobre o cadeirante
K = 170
depth = np.full((H, W), np.nan)
cand = nf & thick & mask
cand &= ~(relax & ~thick)                    # piso visto pelo vidro nao cobre ninguem
# sprites (NPCs e caixas chutaveis) cuidam da propria profundidade
spr = np.zeros((H, W), bool)
for grp in (dyn['boxes'], dyn['npcs']):
    for v in grp.values():
        al = np.asarray(Image.open(f"{out}/{v['file']}"))[..., 3] > 0
        spr[v['y']:v['y']+v['h'], v['x']:v['x']+v['w']] |= al
spr = ndi.binary_dilation(spr, iterations=2)
cand &= ~spr
ys0, xs0 = np.nonzero(cand)
first = np.full(len(ys0), -1); last = np.full(len(ys0), -1); live = np.ones(len(ys0), bool)
for k in range(K):
    y2 = np.clip(ys0+k, 0, H-1)
    sol = inside[y2, xs0]
    sol[sol] = solid[ci[y2[sol], xs0[sol]], cj[y2[sol], xs0[sol]]]
    start = live & sol & (first < 0)
    first[start] = k; last[start] = k
    cont = live & sol & (first >= 0) & ~start
    last[cont] = k
    live &= ~((first >= 0) & ~sol)           # a sequencia vertical terminou
found = first >= 0
depth[ys0[found], xs0[found]] = ys0[found] + last[found] + 1
fg = ~np.isnan(depth)
print('pixels de primeiro plano', int(fg.sum()))

# agrupa por profundidade (passos de 8 px) e componentes conexos; empacota em atlas
q = np.where(fg, np.round(depth/12)*12, -1)
pieces = []
for dv in np.unique(q[fg]):
    m = q == dv
    ys, xs = np.nonzero(m)
    by0, by1, bx0, bx1 = ys.min(), ys.max()+1, xs.min(), xs.max()+1      # trabalha so na caixa do grupo
    sub = m[by0:by1, bx0:bx1]
    lab2, n = ndi.label(sub, structure=np.ones((3, 3)))
    for k, sl in enumerate(ndi.find_objects(lab2), start=1):
        if sl is None: continue
        mm = lab2[sl] == k
        if mm.sum() < 12: continue
        cy, cx = sl[0].start + by0, sl[1].start + bx0
        for xo in range(0, mm.shape[1], 96):           # fatias de ate 96 px (tiras diagonais)
            part = mm[:, xo:xo+96]
            if part.sum() < 12: continue
            py, px = np.nonzero(part)
            y0, y1, x0, x1 = py.min(), py.max()+1, px.min(), px.max()+1
            part = part[y0:y1, x0:x1]
            gy, gx = cy+y0, cx+xo+x0
            rgba = np.dstack([a[gy:gy+part.shape[0], gx:gx+part.shape[1]], part*255]).astype(np.uint8)
            pieces.append((int(gx), int(gy), rgba, float(dv)-6))
print('pecas', len(pieces))
pieces.sort(key=lambda p: -p[2].shape[0])
PAGE = 2048; pages = []; cur = None
def newpage():
    return {'img': Image.new('RGBA', (PAGE, PAGE), (0, 0, 0, 0)), 'x': 0, 'y': 0, 'rowh': 0, 'items': []}
cur = newpage(); pages.append(cur)
for x0, y0, rgba, dv in pieces:
    h, w = rgba.shape[:2]
    if cur['x']+w+2 > PAGE: cur['x'] = 0; cur['y'] += cur['rowh']+2; cur['rowh'] = 0
    if cur['y']+h+2 > PAGE: cur = newpage(); pages.append(cur)
    cur['img'].paste(Image.fromarray(rgba), (cur['x'], cur['y']))
    cur['items'].append([cur['x'], cur['y'], w, h, x0, y0, dv])
    cur['x'] += w+2; cur['rowh'] = max(cur['rowh'], h)
for n, p in enumerate(pages):
    p['img'].save(f'{out}/fg_{n}.png')
print('paginas fg', len(pages))
for n in range(len(pages)): pass

# mapa recortado com transparencia
ys, xs = np.nonzero(mask)
x0, y0, x1, y1 = xs.min(), ys.min(), xs.max()+1, ys.max()+1
Image.fromarray(np.dstack([a, mask*255]).astype(np.uint8)).crop((x0, y0, x1, y1)).save(f'{out}/office.png')

for k, v in dyn['npcs'].items(): pass
json.dump(dyn, open(f'{out}/dynamic.json', 'w'), indent=1)
json.dump({
    'S': S, 'C': C, 'u0': U0, 'v0': V0, 'nu': NU, 'nv': NV,
    'offsetX': int(x0), 'offsetY': int(y0), 'width': int(x1-x0), 'height': int(y1-y0),
    'start': list(uv(*START_PX)),
    'blocked': [''.join('1' if base_block[i, j] else '0' for j in range(NV)) for i in range(NU)],
    'targets': tinfo,
    'fg': [{'file': f'fg_{n}.png', 'items': p['items']} for n, p in enumerate(pages)],
}, open(f'{out}/collision.json', 'w'))
np.save('/tmp/scene_state.npy', {'base_block': base_block, 'box_cells': box_cells, 'reach': reach}, allow_pickle=True)
print('livres', int((~base_block).sum()))
