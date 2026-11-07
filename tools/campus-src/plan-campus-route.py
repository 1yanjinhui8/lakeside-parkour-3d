"""路线 v4：手工控制点 + 自动体检（穿湖 / 穿楼 / 拐角 / 腿长）。"""
import json, math
from shapely.geometry import Polygon, Point

D = json.load(open(r'D:\阿布\tmp\pku_z14.json', encoding='utf-8'))
lake = max(D['water'], key=lambda w: len(w['p']))
LP = Polygon(lake['p']).buffer(0)
if LP.geom_type != 'Polygon':
    LP = max(LP.geoms, key=lambda g: g.area)

# 闭合回路：南侧教学区蛇形 → 湖东南 → 绕湖（东/北/西）→ 南下一路回到底部 → 向东闭合
ROUTE = [
    (-508, -410),   # 0  底部起步（向南门方向）
    (-508, -226),   # 1
    (-700, -226),   # 2
    (-700, -37),    # 3
    (-484, -37),    # 4
    (-484, 96),     # 5
    (-289, 96),     # 6
    (-289, 250),    # 7
    (-330, 330),    # 8  湖东南（博雅塔一带）
    (-380, 430),    # 9  东岸
    (-392, 505),    # 10 东北角
    (-500, 548),    # 11 北岸
    (-640, 542),    # 12
    (-800, 470),    # 13 西北岸
    (-800, 360),    # 14 西岸
    (-755, 240),    # 15
    (-700, 120),    # 16
    (-660, -20),    # 17
    (-640, -200),   # 18
    (-640, -410),   # 19 底部
]


def seg_len(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


n = len(ROUTE)
total = sum(seg_len(ROUTE[i], ROUTE[(i + 1) % n]) for i in range(n))
print('顶点 %d  总长 %.0f m  平均腿长 %.0f m' % (n, total, total / n))

print('\n idx    坐标             腿长    拐角')
for i in range(n):
    a, b, p = ROUTE[i], ROUTE[(i + 1) % n], ROUTE[i - 1]
    u0 = (a[0] - p[0], a[1] - p[1]); u1 = (b[0] - a[0], b[1] - a[1])
    n0 = math.hypot(*u0) or 1; n1 = math.hypot(*u1) or 1
    cr = (u0[0] / n0) * (u1[1] / n1) - (u0[1] / n0) * (u1[0] / n1)
    dt = (u0[0] / n0) * (u1[0] / n1) + (u0[1] / n0) * (u1[1] / n1)
    print('%3d (%7.1f,%7.1f) %7.1f  %+7.1f°' % (i, a[0], a[1], seg_len(a, b), math.degrees(math.atan2(cr, dt))))

print('\n--- 水面 ---')
worst = min((LP.exterior.distance(Point(p)), i) for i, p in enumerate(ROUTE))
print('控制点离岸最小 %.1f m (idx %d)' % worst)
# 沿线段采样
bad = []
for i in range(n):
    a, b = ROUTE[i], ROUTE[(i + 1) % n]
    for k in range(21):
        t = k / 20.0
        p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        if LP.contains(Point(p)):
            bad.append((i, p))
print('线段采样落入湖内：%d 个 %s' % (len(bad), bad[:4]))

print('\n--- 建筑 ---')
HALF = 9.0
hit = []
for b in D['building']:
    poly = b['p']
    for i in range(n):
        a, c = ROUTE[i], ROUTE[(i + 1) % n]
        if any(seg_dist(p, a, c) < HALF for p in poly):
            hit.append((i, len(poly)))
            break
print('走廊半宽 %.0f m 内被清除的建筑：%d / %d' % (HALF, len(hit), len(D['building'])))
from collections import Counter
print('落在各段的分布：', Counter([h[0] for h in hit]).most_common())

json.dump({'route': ROUTE, 'length': total}, open(r'D:\阿布\tmp\pku_route.json', 'w'), indent=1)
print('\n已保存')
