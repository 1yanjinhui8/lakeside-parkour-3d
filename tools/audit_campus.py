# -*- coding: utf-8 -*-
"""校园底板「可跑性」离线审计：把 GLB 的三角形和路线走廊对一遍。

审计三件事（全部按 GLB 真实几何，不看生成脚本的意图）：
  1. 挡路：墙/屋顶/树干 在跑道走廊内（沿路线 ±2.6m、高度 0.15~1.9m）
  2. 断路：路线中心脚下没有路面（road/walk/street/paved）
  3. 落水：路线中心在水面上

用法：
    python tools/audit_campus.py                 # 默认燕园
    python tools/audit_campus.py --glb assets/campus2/bmu-campus.glb --route assets/campus2/campus2_route.json
"""
import json
import math
import os
import struct
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB = os.path.join(ROOT, 'assets', 'campus', 'beida-campus.glb')
ROUTE_F = os.path.join(ROOT, 'assets', 'campus', 'campus_route.json')
for i, a in enumerate(sys.argv):
    if a == '--glb':
        GLB = sys.argv[i + 1]
    if a == '--route':
        ROUTE_F = sys.argv[i + 1]

# ---------------------------------------------------------------- GLB 读取
raw = open(GLB, 'rb').read()
off = 12
chunks = {}
while off < len(raw):
    clen, ctype = struct.unpack('<II', raw[off:off + 8])
    chunks[ctype] = raw[off + 8:off + 8 + clen]
    off += 8 + clen
gltf = json.loads(chunks[0x4E4F534A].decode('utf-8'))
BIN = chunks[0x004E4942]
ACC, BV = gltf['accessors'], gltf['bufferViews']


def read_acc(i):
    a = ACC[i]
    bv = BV[a['bufferView']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = a['count']
    ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    fmt = {5126: ('f', 4), 5125: ('I', 4), 5123: ('H', 2), 5121: ('B', 1)}[a['componentType']]
    stride = bv.get('byteStride') or (fmt[1] * ncomp)
    # 快路径：紧凑存储直接 frombuffer
    if stride == fmt[1] * ncomp:
        dt = {'f': '<f4', 'I': '<u4', 'H': '<u2', 'B': '<u1'}[fmt[0]]
        return np.frombuffer(BIN, dtype=dt, count=n * ncomp, offset=start).reshape(n, ncomp)
    out = np.zeros((n, ncomp), dtype=np.float32)
    for k in range(n):
        out[k] = struct.unpack_from('<' + fmt[0] * ncomp, BIN, start + k * stride)
    return out


def node_matrix(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    t = np.array(n.get('translation', [0, 0, 0]), dtype=np.float64)
    q = n.get('rotation', [0, 0, 0, 1])
    s = np.array(n.get('scale', [1, 1, 1]), dtype=np.float64)
    x, y, z, w = q
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ], dtype=np.float64)
    m = np.eye(4)
    m[:3, :3] = r * s[None, :]
    m[:3, 3] = t
    return m


tris_by_mat = {}


def walk(ni, parent):
    n = gltf['nodes'][ni]
    m = parent @ node_matrix(n)
    if 'mesh' in n:
        for prim in gltf['meshes'][n['mesh']]['primitives']:
            mi = prim.get('material')
            name = gltf['materials'][mi]['name'] if mi is not None else '(none)'
            if 'indices' not in prim:
                continue
            pos = read_acc(prim['attributes']['POSITION']).astype(np.float64)
            idx = read_acc(prim['indices']).reshape(-1).astype(np.int64)
            p = pos @ m[:3, :3].T + m[:3, 3]
            tri = p[idx].reshape(-1, 3, 3)
            tris_by_mat.setdefault(name, []).append(tri)
    for c in n.get('children', []):
        walk(c, m)


for ni in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
    walk(ni, np.eye(4))

T = {k: np.concatenate(v, axis=0) for k, v in tris_by_mat.items()}
print('GLB=%s' % os.path.relpath(GLB, ROOT))
print('材质三角形：', ', '.join('%s=%d' % (k, len(v)) for k, v in sorted(T.items())))

ALL = np.concatenate([v for v in T.values()], axis=0)
MN, MX = ALL.reshape(-1, 3).min(axis=0), ALL.reshape(-1, 3).max(axis=0)
print('包围盒 x[%.1f,%.1f] y[%.1f,%.1f] z[%.1f,%.1f]' % (MN[0], MX[0], MN[1], MX[1], MN[2], MX[2]))

# ---------------------------------------------------------------- 路线
R = json.load(open(ROUTE_F, encoding='utf-8'))
# campus_route.json 存的就是 GLB 坐标 (x, z)：导出时几何和 JSON 一起取了反。
# 别再翻一次——翻反了整条路线会镜像到楼群里，看起来「到处是墙」，其实全是假警报。
PTS = np.array([[p[0], p[1]] for p in R['pts']], dtype=np.float64)
NSEG = len(PTS)
SEG_LEN = np.linalg.norm(np.roll(PTS, -1, axis=0) - PTS, axis=1)
CUM = np.concatenate([[0.0], np.cumsum(SEG_LEN)])
TOTAL = CUM[-1]


def point_at(s):
    a = s % TOTAL
    i = int(np.searchsorted(CUM, a, side='right') - 1)
    i = min(max(i, 0), NSEG - 1)
    t = (a - CUM[i]) / SEG_LEN[i] if SEG_LEN[i] > 1e-9 else 0.0
    p = PTS[i] + (PTS[(i + 1) % NSEG] - PTS[i]) * t
    d = (PTS[(i + 1) % NSEG] - PTS[i]) / SEG_LEN[i]
    return p, d


STEP = 1.0
ARC = np.arange(0, TOTAL, STEP)
CENT = np.zeros((len(ARC), 2))
DIRV = np.zeros((len(ARC), 2))
for k, s in enumerate(ARC):
    p, d = point_at(s)
    CENT[k], DIRV[k] = p, d

# ---------------------------------------------------------------- 1. 挡路
BLOCK_MATS = [k for k in T if k.startswith(('wall', 'roof', 'trim', 'tree'))]
segs, ys, seg_mat = [], [], []
for name in BLOCK_MATS:
    tri = T[name]
    for e in ((0, 1), (1, 2), (2, 0)):
        a, b = tri[:, e[0]], tri[:, e[1]]
        segs.append(np.stack([a[:, [0, 2]], b[:, [0, 2]]], axis=1))
        ys.append(np.stack([a[:, 1], b[:, 1]], axis=1))
        seg_mat.append(np.full(len(tri), name, dtype=object))
SEGS = np.concatenate(segs, axis=0)          # (n,2,2) xz
YS = np.concatenate(ys, axis=0)              # (n,2) y
SEG_MAT = np.concatenate(seg_mat)
seg_lo, seg_hi = YS.min(axis=1), YS.max(axis=1)
COLLIDE = (seg_hi > 0.18) & (seg_lo < 1.95)   # 会撞到人（0.18~1.95m）
SEGS, seg_lo, seg_hi, SEG_MAT = SEGS[COLLIDE], seg_lo[COLLIDE], seg_hi[COLLIDE], SEG_MAT[COLLIDE]
print('\n可能撞人的三角形边：%d 条' % len(SEGS))

A, B = SEGS[:, 0], SEGS[:, 1]
AB = B - A
AB2 = np.maximum((AB ** 2).sum(axis=1), 1e-9)
DIST = np.zeros((len(CENT), len(SEGS)), dtype=np.float32)
for c0 in range(0, len(CENT), 100):
    C = CENT[c0:c0 + 100, None, :]
    t = np.clip(((C - A[None]) * AB[None]).sum(axis=2) / AB2[None], 0, 1)
    proj = A[None] + AB[None] * t[..., None]
    DIST[c0:c0 + 100] = np.linalg.norm(C - proj, axis=2)

NEAR = DIST.min(axis=1) if len(SEGS) else np.full(len(CENT), 99)


def spans(mask, gap=6):
    out, s = [], None
    for i, v in enumerate(mask):
        if v and s is None:
            s = i
        elif not v and s is not None:
            if i - s >= gap:
                out.append((int(ARC[s]), int(ARC[i - 1])))
            s = None
    if s is not None and len(mask) - s >= gap:
        out.append((int(ARC[s]), int(ARC[-1])))
    return out


for th in (1.9, 2.6, 4.2):
    sp = spans(NEAR < th)
    print('走廊 %.1fm 内有实体（≥6m 连续）：%d 段 %s' % (th, len(sp), sp[:12]))

# 逐段详情：谁挡的、在哪个坐标、离中心多远
print('\n走廊 2.6m 内的实体明细（按段）：')
for s0, s1 in spans(NEAR < 2.6, 4)[:40]:
    i0, i1 = int((s0 - ARC[0]) / STEP), int((s1 - ARC[0]) / STEP)
    i = i0 + int(np.argmin(NEAR[i0:i1 + 1]))
    j = int(np.argmin(DIST[i]))
    side = '左' if np.cross(DIRV[i], SEGS[j].mean(axis=0) - CENT[i]) > 0 else '右'
    print('  %4d~%-4dm  最近 %.2fm@%dm %s侧 %-5s 墙高 %.1f~%.1f  中心(%.0f,%.0f)'
          % (s0, s1, NEAR[i], int(ARC[i]), side, SEG_MAT[j], seg_lo[j], seg_hi[j], CENT[i][0], CENT[i][1]))

# 最窄处
idx = np.argsort(NEAR)[:400]
worst = []
used = []
for i in idx:
    if all(abs(ARC[i] - u) > 12 for u in used):
        used.append(ARC[i])
        j = int(np.argmin(DIST[i]))
        worst.append((int(ARC[i]), round(float(NEAR[i]), 2), str(SEG_MAT[j]),
                      round(float(seg_lo[j]), 1), round(float(seg_hi[j]), 1)))
    if len(worst) >= 14:
        break
print('最窄点（里程, 距离, 材质, 底高, 顶高）：')
for w in worst:
    print('   ', w)

# ---------------------------------------------------------------- 2. 断路
ROAD_MATS = [k for k in T if k in ('road', 'walk', 'street', 'paved', 'line')]
cover = np.zeros(len(CENT), dtype=bool)
best_y = np.full(len(CENT), -99.0)
for name in ROAD_MATS:
    for e in range(0, len(T[name]), 4096):
        tri = T[name][e:e + 4096]
        v0, v1, v2 = (tri[:, 0], tri[:, 1], tri[:, 2])
        # 重心坐标判「点是否落在三角形内」（投影到 xz 平面）
        A2 = v0[:, [0, 2]]
        B2 = v1[:, [0, 2]]
        C2 = v2[:, [0, 2]]
        det = (B2[:, 1] - C2[:, 1]) * (A2[:, 0] - C2[:, 0]) + (C2[:, 0] - B2[:, 0]) * (A2[:, 1] - C2[:, 1])
        ok = np.abs(det) > 1e-7
        for c0 in range(0, len(CENT), 200):
            P = CENT[c0:c0 + 200, None, :]
            l1 = ((B2[:, 1] - C2[:, 1]) * (P[..., 0] - C2[:, 0]) + (C2[:, 0] - B2[:, 0]) * (P[..., 1] - C2[:, 1])) / np.where(ok, det, 1)[None]
            l2 = ((C2[:, 1] - A2[:, 1]) * (P[..., 0] - C2[:, 0]) + (A2[:, 0] - C2[:, 0]) * (P[..., 1] - C2[:, 1])) / np.where(ok, det, 1)[None]
            l3 = 1 - l1 - l2
            inside = (l1 >= -0.001) & (l2 >= -0.001) & (l3 >= -0.001) & ok[None]
            hit = inside.any(axis=1)
            cover[c0:c0 + 200] |= hit

print('\n路线中心脚下无路面：%d / %d 个采样点（%.1f%%）' % ((~cover).sum(), len(cover), 100.0 * (~cover).sum() / len(cover)))
if cover.mean() < 0.8:
    print('  ⚠ 覆盖率过低——多半是坐标符号反了（路线镜像），先确认再解读后面的结论')
sp = spans(~cover, 3)
print('  无路面区间（里程）：%d 段 %s' % (len(sp), sp[:20]))

# ---------------------------------------------------------------- 3. 落水
if 'water' in T:
    W = T['water']
    wz = np.concatenate([W[:, :, [0, 2]]], axis=0)  # 不用
    on_water = np.zeros(len(CENT), dtype=bool)
    for e in range(0, len(W), 4096):
        tri = W[e:e + 4096]
        v0, v1, v2 = tri[:, 0], tri[:, 1], tri[:, 2]
        A2, B2, C2 = v0[:, [0, 2]], v1[:, [0, 2]], v2[:, [0, 2]]
        det = (B2[:, 1] - C2[:, 1]) * (A2[:, 0] - C2[:, 0]) + (C2[:, 0] - B2[:, 0]) * (A2[:, 1] - C2[:, 1])
        ok = np.abs(det) > 1e-7
        for c0 in range(0, len(CENT), 200):
            P = CENT[c0:c0 + 200, None, :]
            l1 = ((B2[:, 1] - C2[:, 1]) * (P[..., 0] - C2[:, 0]) + (C2[:, 0] - B2[:, 0]) * (P[..., 1] - C2[:, 1])) / np.where(ok, det, 1)[None]
            l2 = ((C2[:, 1] - A2[:, 1]) * (P[..., 0] - C2[:, 0]) + (A2[:, 0] - C2[:, 0]) * (P[..., 1] - C2[:, 1])) / np.where(ok, det, 1)[None]
            l3 = 1 - l1 - l2
            inside = (l1 >= -0.001) & (l2 >= -0.001) & (l3 >= -0.001) & ok[None]
            on_water[c0:c0 + 200] |= inside.any(axis=1)
    print('\n路线中心在水面上：%d 个采样点 %s' % (on_water.sum(), spans(on_water, 2)[:10]))
else:
    print('\n（GLB 无 water 材质）')
