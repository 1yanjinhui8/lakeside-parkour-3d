"""医学部路线规划 + 体检：总长 / 拐角 / 穿楼 / 穿场地。

用法： /d/Anaconda3/python.exe tools/campus-src/plan-campus2-route.py [--save]
体检不过就改下面的 ROUTE 再跑，全部通过后 --save 写出 bmu_route.json。
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, 'assets', 'campus2', '_src', 'bmu_z14.json')
OUT = os.path.join(ROOT, 'assets', 'campus2', '_src', 'bmu_route.json')

D = json.load(open(SRC, encoding='utf-8'))

# 环线（米制，x=东 y=北）。闭合：首尾由脚本相接。
# 自动选轴的结果：在全部 (west/north/east/south) 组合里按「穿楼数」最少选出。
# 医学部是网格布局，矩形环 4 个 90° 弯，难度比燕园（20 拐点 10 急弯）低一档。
ROUTE = [
    (390, -150),  # 0 西南角（体育场北缘 8m）
    (390, 512),   # 1 西北角（球场群 x395 之西 5m）
    (690, 512),   # 2 东北角
    (690, -150),  # 3 东南角
]


def seg_len(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def seg_dist(p, a, b):
    ux, uz = b[0] - a[0], b[1] - a[1]
    L2 = ux * ux + uz * uz
    if L2 < 1e-9:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = max(0.0, min(1.0, ((p[0] - a[0]) * ux + (p[1] - a[1]) * uz) / L2))
    return math.hypot(p[0] - (a[0] + t * ux), p[1] - (a[1] + t * uz))


def ring_area(pts):
    a = 0.0
    for i in range(len(pts) - 1):
        a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    return abs(a) * 0.5


N = len(ROUTE)
closed = ROUTE + [ROUTE[0]]
total = sum(seg_len(closed[i], closed[i + 1]) for i in range(N))
print('拐点 %d  总长 %.0f m' % (N, total))

print('\n拐角：')
for i in range(N):
    a, b, c = closed[i - 1], closed[i], closed[i + 1]
    v1 = (b[0] - a[0], b[1] - a[1])
    v2 = (c[0] - b[0], c[1] - b[1])
    L1 = math.hypot(*v1) or 1
    L2 = math.hypot(*v2) or 1
    cosang = (v1[0] * v2[0] + v1[1] * v2[1]) / (L1 * L2)
    deg = math.degrees(math.acos(max(-1, min(1, cosang))))
    turn = 180 - deg          # 转向角（0=直行）
    if turn >= 30:
        print('  @%d (%4.0f,%4.0f)  转 %5.1f° %s' % (i, b[0], b[1], turn,
              '←' if (v1[0] * v2[1] - v1[1] * v2[0]) > 0 else '→'))

# 穿楼：路线中心线 3.8m 内有建筑 → 穿楼
ROAD_HALF = 3.8
hits = []
for i in range(N):
    a, b = closed[i], closed[i + 1]
    for bi, bld in enumerate(D['building']):
        for p in bld['p']:
            if seg_dist(p, a, b) < ROAD_HALF:
                hits.append((i, bi))
                break
print('\n穿楼段：', ['段%d(建筑%d)' % h for h in hits[:8]] or '无')

# 穿场地（pitch/track）
from shapely.geometry import Polygon, LineString, Point
line = LineString(closed)
pitch_hits = []
for g in D['ground']:
    try:
        p = Polygon(g['p']).buffer(0)
    except Exception:
        continue
    if p.is_empty or p.area < 50:
        continue
    if g.get('cls') in ('university', 'school', 'hospital', 'library'):
        continue   # 地块标签，不是实体障碍
    if p.intersects(line.buffer(ROAD_HALF)):
        pitch_hits.append((g.get('cls'), round(p.area)))
print('穿场地：', pitch_hits or '无')

# 沿途 20m 内的建筑数（看两侧有没有景可看）
near = 0
for bld in D['building']:
    cx = sum(p[0] for p in bld['p']) / len(bld['p'])
    cy = sum(p[1] for p in bld['p']) / len(bld['p'])
    d = line.distance(Point(cx, cy))
    if d < 20:
        near += 1
print('沿途 20m 内建筑：', near, '/', len(D['building']))

# 穿楼 ≤8 可接受：烘焙时走廊 9m 内的建筑会被剔除（in_corridor），不会真的穿模
ok = len(hits) <= 8 and not pitch_hits and 1200 < total < 2600
print('\n体检：%s' % ('通过 ✅' if ok else '未通过 ❌'))

if ok and '--save' in sys.argv:
    R = {'route': [[round(x, 1), round(y, 1)] for x, y in ROUTE], 'length': round(total, 1)}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(R, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('已写出', OUT)
