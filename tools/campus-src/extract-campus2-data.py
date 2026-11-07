"""把北大医学部（学院路 38 号）的 z14 图层导出成米制 JSON。

用法： /d/Anaconda3/python.exe tools/campus-src/extract-campus2-data.py
输出： assets/campus2/_src/bmu_z14.json（结构与燕园的 pku_z14.json 一致，下游脚本可复用）
"""
import os
import sys
import json
import math

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import mvt_lib as M

TILE_DIR = os.path.join(ROOT, 'assets', 'campus2', '_src', 'tiles')
OUT = os.path.join(ROOT, 'assets', 'campus2', '_src', 'bmu_z14.json')

# 医学部 bbox（学院路 38 号一带）与局部坐标原点（校园中部）
LON_MIN, LON_MAX = 116.3380, 116.3580
LAT_MIN, LAT_MAX = 39.9790, 39.9920
LON0, LAT0 = 116.3472, 39.9855
MLAT = 110574.0
MLON = 111320.0 * math.cos(math.radians(LAT0))


def to_m(lon, lat):
    return ((lon - LON0) * MLON, (lat - LAT0) * MLAT)


out = {'building': [], 'water': [], 'green': [], 'ground': [], 'road': []}
GREEN = ('grass', 'wood', 'forest', 'meadow', 'wetland', 'scrub')
GROUND = ('pitch', 'track', 'stadium', 'playground', 'university', 'school',
          'library', 'recreation_ground', 'garden', 'hospital')

for name in sorted(os.listdir(TILE_DIR)):
    if not name.endswith('.pbf'):
        continue
    z, tx, ty = [int(v) for v in name[:-4].split('_')]
    for layer in M.decode_tile(open(os.path.join(TILE_DIR, name), 'rb').read()):
        lname = layer['name']
        if lname not in ('building', 'water', 'landcover', 'landuse', 'transportation'):
            continue
        ext = layer['extent']

        def rings_lonlat(feat):
            for r in M.decode_geometry(feat['geom']):
                yield [list(to_m(*M.tile_to_lonlat(z, tx, ty, p[0], p[1], ext))) for p in r]

        for feat in layer['features']:
            if lname == 'transportation':
                if feat['type'] not in (2, 3):
                    continue
                lines = [r for r in rings_lonlat(feat) if len(r) >= 2]
                if lines:
                    out['road'].append({'cls': M.feature_props(layer, feat).get('class') or '',
                                        'lines': lines})
                continue

            if feat['type'] != 3:
                continue
            props = M.feature_props(layer, feat)
            cls = props.get('class') or ''
            for r in rings_lonlat(feat):
                if len(r) < 3:
                    continue
                cx = sum(p[0] for p in r) / float(len(r))
                cy = sum(p[1] for p in r) / float(len(r))
                if not ((cx / MLON + LON0) >= LON_MIN and (cx / MLON + LON0) <= LON_MAX
                        and (cy / MLAT + LAT0) >= LAT_MIN and (cy / MLAT + LAT0) <= LAT_MAX):
                    continue
                a = 0.0
                for i in range(len(r) - 1):
                    a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
                if abs(a) * 0.5 < 8:
                    continue
                if lname == 'building':
                    out['building'].append({'p': r, 'h': props.get('render_height'),
                                            'mh': props.get('render_min_height')})
                elif lname == 'water':
                    out['water'].append({'p': r, 'cls': cls})
                elif lname == 'landcover':
                    if cls in GREEN:
                        out['green'].append({'p': r, 'cls': cls})
                elif lname == 'landuse':
                    if cls in GROUND:
                        out['ground'].append({'p': r, 'cls': cls})
                    elif cls in GREEN:
                        out['green'].append({'p': r, 'cls': cls})


def dedupe(items):
    seen = set()
    res = []
    for it in items:
        sig = tuple((round(p[0], 1), round(p[1], 1)) for p in it['p'][:4])
        if sig in seen:
            continue
        seen.add(sig)
        res.append(it)
    return res


for k in ('building', 'water', 'green', 'ground'):
    out[k] = dedupe(out[k])

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
for k, v in out.items():
    print('%-9s %5d' % (k, len(v)))
xs = [p[0] for b in out['building'] for p in b['p']]
ys = [p[1] for b in out['building'] for p in b['p']]
if xs:
    print('建筑范围 x[%.0f, %.0f] y[%.0f, %.0f]' % (min(xs), max(xs), min(ys), max(ys)))
