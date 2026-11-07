"""按「路线两侧 240m 可见带」分块抓取精细建筑，块数远少于扫全矩形。

雾在游戏里只到 ~155~230m，更远的楼本来也看不清，所以只补路线附近。
断点续传：已存在且能解析的块直接跳过。
"""
import json
import os
import subprocess
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'campus', '_src', 'pku_chunks')
os.makedirs(OUT, exist_ok=True)
ROUTE_F = os.path.join(ROOT, 'assets', 'campus', '_src', 'pku_route.json')

MLON = 111320.0 * 0.7665
MLAT = 110574.0
LON0, LAT0 = 116.31, 39.9895
URL = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'

R = json.load(open(ROUTE_F, encoding='utf-8'))
pts = [tuple(p) for p in R['route']]

# 沿路线每 130m 取一个中心点
centers = []
acc = 0.0
prev = pts[0]
centers.append(prev)
for i in range(1, len(pts) + 1):
    p = pts[i % len(pts)]
    d = ((p[0] - prev[0]) ** 2 + (p[1] - prev[1]) ** 2) ** 0.5
    steps = int(d // 130)
    for k in range(1, steps + 1):
        t = k * 130.0 / d if d > 0 else 0
        centers.append((prev[0] + (p[0] - prev[0]) * t, prev[1] + (p[1] - prev[1]) * t))
    prev = p

HALF = 130.0
boxes = {}
for (cx, cy) in centers:
    xa = round((cx - HALF) / 40.0) * 40.0
    ya = round((cy - HALF) / 40.0) * 40.0
    boxes[(int(xa), int(ya))] = True
BOXES = sorted(boxes.keys())
print('需要 %d 块（路线 %d 个中心点 → 去重）' % (len(BOXES), len(centers)), flush=True)

fail = []
for i, (xa, ya) in enumerate(BOXES, 1):
    xb, yb = xa + 260.0, ya + 260.0
    name = 'r%da_%da.json' % (int(xa), int(ya))
    path = os.path.join(OUT, name)
    if os.path.exists(path):
        try:
            json.load(open(path, encoding='utf-8'))
            print('[%2d/%2d] skip %s' % (i, len(BOXES), name), flush=True)
            continue
        except Exception:
            pass
    s = LAT0 + ya / MLAT
    w = LON0 + xa / MLON
    n = LAT0 + yb / MLAT
    e = LON0 + xb / MLON
    q = '[out:json][timeout:60];way["building"](%.6f,%.6f,%.6f,%.6f);out tags geom;' % (s, w, n, e)
    ok = False
    for attempt in range(2):
        subprocess.run(['curl', '-s', '-m', '90', '-X', 'POST',
                        '--data-urlencode', 'data=' + q, URL, '-o', path],
                       capture_output=True)
        try:
            d = json.load(open(path, encoding='utf-8'))
            print('[%2d/%2d] %-16s ways=%d' % (i, len(BOXES), name, len(d.get('elements', []))), flush=True)
            ok = True
            break
        except Exception:
            print('[%2d/%2d] %-16s 失败 %d' % (i, len(BOXES), name, attempt + 1), flush=True)
            time.sleep(2)
    if not ok:
        fail.append(name)
        try:
            os.remove(path)
        except Exception:
            pass
    time.sleep(0.5)

print('\n完成。失败 %d 块：%s' % (len(fail), fail if fail else '无'), flush=True)
