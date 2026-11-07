# -*- coding: utf-8 -*-
"""体检底板的「湖面穿帮」：水与草重叠、建筑落水、树落水、建筑高度分布。

只读，不产出模型。用法：
    python tools/campus-src/diag-overlap.py
"""
import json
import os
import sys
import collections

from shapely.geometry import Polygon
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, 'assets', 'campus', '_src', 'pku_z14.json')
CHUNK_DIR = os.path.join(ROOT, 'assets', 'campus', '_src', 'pku_chunks')

sys.path.insert(0, HERE)

D = json.load(open(SRC, encoding='utf-8'))


def poly(pts):
    if len(pts) < 4:
        return None
    try:
        g = Polygon(pts).buffer(0)
    except Exception:
        return None
    if g.is_empty:
        return None
    if g.geom_type == 'MultiPolygon':
        g = max(g.geoms, key=lambda x: x.area)
    return g if g.geom_type == 'Polygon' else None


water = [poly(w['p']) for w in D['water']]
water = [w for w in water if w is not None and w.area > 30]
WU = unary_union(water)
print('水面：%d 块 / 合计 %.0f m²' % (len(water), WU.area))

green = [poly(g['p']) for g in D['green']]
green = [g for g in green if g is not None and g.area > 25]
GU = unary_union(green)
print('绿地：%d 块 / 合计 %.0f m²' % (len(green), GU.area))

ov = GU.intersection(WU)
print('  ⚠ 绿地与水面重叠 %.0f m²（占绿地 %.1f%%）→ 这是蓝绿闪烁的来源'
      % (ov.area, 100.0 * ov.area / max(1.0, GU.area)))

# 建筑落水
bad = []
for i, b in enumerate(D['building']):
    g = poly(b['p'])
    if g is None or g.area < 12:
        continue
    inter = g.intersection(WU).area
    if inter > 3.0:
        bad.append((round(inter, 1), round(g.area, 1), i, g.centroid.x, g.centroid.y))
bad.sort(reverse=True)
print('\n建筑落在水面上：%d 栋（阈值 3 m²）' % len(bad))
for r in bad[:15]:
    print('   水面占用 %7.1f m² / 占地 %7.1f m²   idx=%-4d  质心 (%.0f, %.0f)' % r)

# 精细建筑是否也有落水的
det_bad = 0
if os.path.isdir(CHUNK_DIR):
    for fn in os.listdir(CHUNK_DIR):
        if not fn.endswith('.json'):
            continue
        try:
            d = json.load(open(os.path.join(CHUNK_DIR, fn), encoding='utf-8'))
        except Exception:
            continue
        for e in d.get('elements', []):
            geom = e.get('geometry') or []
            if len(geom) < 4:
                continue
            pts = [((p['lon'] - 116.31) * 111320.0 * 0.766, (p['lat'] - 39.9895) * 110574.0) for p in geom]
            g = poly(pts)
            if g is not None and g.area > 12 and g.intersection(WU).area > 3:
                det_bad += 1
print('精细建筑落水：%d 栋' % det_bad)

# 高度分布（z14 回落部分）
hdist = collections.Counter(b.get('h') for b in D['building'])
print('\nz14 建筑高度标签分布（前 10）：', hdist.most_common(10))
