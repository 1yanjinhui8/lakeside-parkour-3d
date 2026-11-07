# -*- coding: utf-8 -*-
"""把底板源数据画成平面图：水面 / 草地 / 建筑 / 路线，用来核对路线是否穿湖穿楼。

用法： python tools/campus-src/map-campus.py [--out out.png] [--box x0,z0,x1,z1]
坐标：图上 (x, z) = plate 坐标，右 = +x（东），下 = +z（南）。
"""
import json
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, 'assets', 'campus', '_src', 'pku_z14.json')
ROUTE = os.path.join(ROOT, 'assets', 'campus', '_src', 'pku_route.json')
OUT = os.path.join(ROOT, 'screenshots', 'campus-map.png')
SCALE = 0.35

for i, a in enumerate(sys.argv):
    if a == '--out':
        OUT = sys.argv[i + 1]

D = json.load(open(SRC, encoding='utf-8'))
R = json.load(open(ROUTE, encoding='utf-8'))
ROUTE_PTS = [(p[0], -p[1]) for p in R['route']]

X0, Z0, X1, Z1 = -1150, -950, 200, 800
W = int((X1 - X0) * SCALE)
H = int((Z1 - Z0) * SCALE)
img = Image.new('RGB', (W, H), (34, 40, 34))
dr = ImageDraw.Draw(img)


def px(p):
    return ((p[0] - X0) * SCALE, (-p[1] - Z0) * SCALE)


for g in D.get('green', []):
    if len(g['p']) > 2:
        dr.polygon([px(q) for q in g['p']], fill=(52, 74, 46))


def ring_pts(w):
    # 水面在源里是 (x, y_osm)，plate 的 z = -y
    return [(q[0], -q[1]) for q in w['p']]


for w in D.get('water', []):
    if len(w['p']) > 2:
        dr.polygon([((p[0] - X0) * SCALE, (p[1] - Z0) * SCALE) for p in ring_pts(w)],
                   fill=(38, 92, 132))

for b in D.get('building', []):
    if len(b['p']) > 2:
        dr.polygon([((p[0] - X0) * SCALE, (p[1] - Z0) * SCALE) for p in ring_pts(b)],
                   fill=(150, 150, 148), outline=(96, 96, 94))

for r in D.get('road', []):
    for ln in r['lines']:
        pts = [((p[0] - X0) * SCALE, (-p[1] - Z0) * SCALE) for p in ln]
        if len(pts) > 1:
            dr.line(pts, fill=(88, 88, 84), width=1)

rp = [((p[0] - X0) * SCALE, (p[1] - Z0) * SCALE) for p in ROUTE_PTS]
dr.line(rp + [rp[0]], fill=(230, 60, 60), width=3, joint='curve')
for i, p in enumerate(rp):
    dr.ellipse([p[0] - 2.5, p[1] - 2.5, p[0] + 2.5, p[1] + 2.5], fill=(255, 220, 90))
    dr.text((p[0] + 5, p[1] - 5), str(i), fill=(255, 240, 200))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.save(OUT)
print('写出', os.path.relpath(OUT, ROOT), img.size)
