# -*- coding: utf-8 -*-
"""检查 GLB 里到底有哪些三角形落在水面上。

底板是离线烘焙的，直接读 GLB 比在浏览器里猜更准：
  - 按 glTF 的 node 层级累计矩阵
  - 取每个 mesh 的三角形质心（局部 → 世界）
  - plate 的 +y(北) 在 GLB 里变成了 -z，所以平面坐标是 (x, -z)
  - 和水面多边形做点内判定，按材质统计

用法：python tools/campus-src/diag-glb-onlake.py [glb路径]
"""
import json
import os
import struct
import sys
from collections import Counter

from shapely.geometry import Point, Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GLB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'assets', 'campus', 'beida-campus.glb')
SRC = os.path.join(ROOT, 'assets', 'campus', '_src', 'pku_z14.json')

D = json.load(open(SRC, encoding='utf-8'))
MLON = 111320.0 * 0.766
MLAT = 110574.0


def poly_from_ring(ring):
    try:
        g = Polygon(ring).buffer(0)
    except Exception:
        return None
    if g.is_empty:
        return None
    if g.geom_type == 'MultiPolygon':
        g = max(g.geoms, key=lambda x: x.area)
    return g


water = []
wd = os.path.join(os.path.dirname(SRC), 'water_detailed.json')
if os.path.exists(wd):
    det = json.load(open(wd, encoding='utf-8'))
    for e in det.get('elements', []):
        geom = e.get('geometry') or []
        if len(geom) < 4:
            continue
        ring = [((q['lon'] - 116.31) * MLON, (q['lat'] - 39.9895) * MLAT) for q in geom]
        g = poly_from_ring(ring)
        if g is not None and g.area > 30:
            water.append(g)
for w in D['water']:
    if len(w['p']) < 4:
        continue
    g = poly_from_ring(w['p'])
    if g is not None and g.area > 30:
        water.append(g)
print('水面 %d 块（含精细岸线）' % len(water))


def in_water(x, north):
    pt = Point(x, north)
    for g in water:
        if g.contains(pt):
            return True
    return False


raw = open(GLB, 'rb').read()
magic, ver, total = struct.unpack('<III', raw[:12])
off = 12
chunks = {}
while off < len(raw):
    clen, ctype = struct.unpack('<II', raw[off:off + 8])
    chunks[ctype] = raw[off + 8: off + 8 + clen]
    off += 8 + clen
gltf = json.loads(chunks[0x4E4F534A].decode('utf-8'))
BIN = chunks[0x004E4942]

ACC = gltf['accessors']
BV = gltf['bufferViews']


def read_acc(i):
    a = ACC[i]
    bv = BV[a['bufferView']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = a['count']
    ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    fmt = {5126: ('f', 4), 5125: ('I', 4), 5123: ('H', 2), 5121: ('B', 1)}[a['componentType']]
    stride = bv.get('byteStride') or (fmt[1] * ncomp)
    out = []
    for k in range(n):
        base = start + k * stride
        out.append(struct.unpack_from('<' + fmt[0] * ncomp, BIN, base))
    return out


def mat_mul(a, b):
    # 列主序 4x4
    return [sum(a[i + 4 * k] * b[k + 4 * j] for k in range(4)) for j in range(4) for i in range(4)]


IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def node_matrix(n):
    if 'matrix' in n:
        return n['matrix']
    t = n.get('translation', [0, 0, 0])
    r = n.get('rotation', [0, 0, 0, 1])
    s = n.get('scale', [1, 1, 1])
    x, y, z, w = r
    rm = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1,
    ]
    for i in range(3):
        for j in range(3):
            rm[i + 4 * j] *= s[j]
    rm[12], rm[13], rm[14] = t
    return rm


def xform(m, p):
    x, y, z = p[0], p[1], p[2]
    return (m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])


hits = Counter()
tris = Counter()
sample = {}

def walk(ni, parent):
    n = gltf['nodes'][ni]
    m = mat_mul(parent, node_matrix(n))
    if 'mesh' in n:
        mesh = gltf['meshes'][n['mesh']]
        for prim in mesh['primitives']:
            mi = prim.get('material')
            name = gltf['materials'][mi]['name'] if mi is not None else '(none)'
            if 'indices' not in prim:
                continue
            pos = read_acc(prim['attributes']['POSITION'])
            idx = [v[0] for v in read_acc(prim['indices'])]
            for k in range(0, len(idx) - 2, 3):
                p0 = xform(m, pos[idx[k]])
                p1 = xform(m, pos[idx[k + 1]])
                p2 = xform(m, pos[idx[k + 2]])
                cx = (p0[0] + p1[0] + p2[0]) / 3.0
                cy = (p0[1] + p1[1] + p2[1]) / 3.0
                cz = (p0[2] + p1[2] + p2[2]) / 3.0
                tris[name] += 1
                # 只关心水面之上、又不是水面本身的三角形
                if cy > 0.05 and name not in ('water',):
                    if in_water(cx, -cz):
                        hits[name] += 1
                        if name not in sample:
                            sample[name] = (round(cx, 1), round(cy, 1), round(-cz, 1))
    for c in n.get('children', []):
        walk(c, m)


scene = gltf['scenes'][gltf.get('scene', 0)]
for ni in scene['nodes']:
    walk(ni, IDENT)

print('\n各材质三角形总数：')
for k, v in tris.most_common():
    print('  %-8s %7d' % (k, v))
print('\n落在水面上的「非水面」三角形（y>0.05）：')
if not hits:
    print('  无 —— 几何上没有建筑压在水面上')
for k, v in hits.most_common():
    print('  %-8s %6d 个，样例 (%.1f, %.1f, %.1f)' % ((k, v) + sample[k]))
