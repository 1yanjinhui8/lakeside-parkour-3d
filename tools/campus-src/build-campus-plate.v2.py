"""把北大未名湖片区烘成游戏用的校园底板 GLB（v2：贴图 + 植栽 + 路灯）。

产出 assets/campus/beida-campus.glb：
  · 带贴图的地面（草地 / 硬化场地 / 绿地 / 水面）
  · 真实建筑轮廓拉伸，四种立面变体（米白教学 / 红砖老楼 / 灰石 / 浅黄附属）
  · 沿路线生成的 7.6m 跑道 + 2.4m 人行道 + 车道线 + 路口斑马线
  · 校园真实路网细带
  · 行道树（三种树型）、灌木、路灯、女儿墙
单位：米。plate 坐标 = (东, 北)，导出时 z 取负，保证不镜像。
"""
import json
import math
import os
import struct

import numpy as np
import mapbox_earcut as earcut
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union
from shapely.strtree import STRtree

HERE = os.path.dirname(os.path.abspath(__file__))          # tools/campus-src
ROOT = os.path.dirname(os.path.dirname(HERE))              # 项目根

# 同一条管线烘两个校园：CAMPUS_VARIANT=campus2 → 北大医学部（学院路 38 号）
# 数据源缺文件时全部走回退分支（精细建筑/精细水面/湖 relation 都只在燕园有）
VARIANT = os.environ.get('CAMPUS_VARIANT', 'campus')
if VARIANT == 'campus2':
    SRC = os.path.join(ROOT, 'assets', 'campus2', '_src', 'bmu_z14.json')
    ROUTE_F = os.path.join(ROOT, 'assets', 'campus2', '_src', 'bmu_route.json')
    CHUNK_DIR = os.path.join(ROOT, 'assets', 'campus2', '_src', 'pku_chunks')
    OUT_DIR = os.path.join(ROOT, 'assets', 'campus2')
    GLB_NAME = 'bmu-campus.glb'
    ROUTE_OUT = 'campus2_route.json'
    # 底板尺寸跟着医学部的建筑范围（x[-199,960] y[-739,717]）走
    BASE_RECT = [(-350, -900), (1050, -900), (1050, 800), (-350, 800)]
else:
    SRC = os.path.join(ROOT, 'assets', 'campus', '_src', 'pku_z14.json')
    ROUTE_F = os.path.join(ROOT, 'assets', 'campus', '_src', 'pku_route.json')
    CHUNK_DIR = os.path.join(ROOT, 'assets', 'campus', '_src', 'pku_chunks')
    OUT_DIR = os.path.join(ROOT, 'assets', 'campus')
    GLB_NAME = 'beida-campus.glb'
    ROUTE_OUT = 'campus_route.json'
    BASE_RECT = [(-1120, -740), (140, -740), (140, 900), (-1120, 900)]
if os.environ.get('CAMPUS_OUT_DIR'):
    OUT_DIR = os.environ['CAMPUS_OUT_DIR']      # 试烘到临时目录，比对完再覆盖正式资产
os.makedirs(OUT_DIR, exist_ok=True)

ROAD_HALF = 3.8
WALK_OUT = 6.4
CORRIDOR_CLEAR = 9.0
FLOOR_H = 3.6
BAY_W = 3.8

D = json.load(open(SRC, encoding='utf-8'))
R = json.load(open(ROUTE_F, encoding='utf-8'))
ROUTE = [tuple(p) for p in R['route']]
NSEG = len(ROUTE)

# 跑道走廊：沿路线 buffer 出来的净空区。
# 老代码只判「建筑顶点到路线 < 9m」，一栋 100m 长的教学楼四角都在 9m 外、
# 整面墙却压在路面上，于是玩家会直接跑进教学楼（看着就是死路）。
CORRIDOR = LineString(list(ROUTE) + [ROUTE[0]]).buffer(CORRIDOR_CLEAR, join_style=2)

# 路口正前方的「视觉净空」：拐角处如果正对着一栋楼，玩家在最后 30m 看到的就是一堵墙，
# 像死路。把每个 ≥45° 路口沿进弯方向、宽 22m、深 42m 的矩形里的楼切掉。
JUNC_CLEAR_LEN = 42.0
JUNC_CLEAR_HALF = 11.0


def build_junction_aprons():
    polys = []
    n = len(ROUTE)
    for i in range(n):
        prev, cur, nxt = ROUTE[i - 1], ROUTE[i], ROUTE[(i + 1) % n]
        ux, uz = cur[0] - prev[0], cur[1] - prev[1]
        vx, vz = nxt[0] - cur[0], nxt[1] - cur[1]
        lu = math.hypot(ux, uz) or 1.0
        lv = math.hypot(vx, vz) or 1.0
        ux, uz, vx, vz = ux / lu, uz / lu, vx / lv, vz / lv
        deg = math.degrees(math.atan2(ux * vz - uz * vx, ux * vx + uz * vz))
        if abs(deg) < 45:
            continue
        nx, nz = -uz, ux                      # 进弯方向的左法线
        a = (cur[0] + nx * JUNC_CLEAR_HALF, cur[1] + nz * JUNC_CLEAR_HALF)
        b = (a[0] + ux * JUNC_CLEAR_LEN, a[1] + uz * JUNC_CLEAR_LEN)
        c = (b[0] - nx * 2 * JUNC_CLEAR_HALF, b[1] - nz * 2 * JUNC_CLEAR_HALF)
        d = (cur[0] - nx * JUNC_CLEAR_HALF, cur[1] - nz * JUNC_CLEAR_HALF)
        polys.append(Polygon([a, b, c, d]))
    return unary_union(polys) if polys else None


APRONS = build_junction_aprons()
print('路口净空矩形 %d 个 / %.0f m²' % (len(APRONS.geoms) if APRONS is not None else 0,
                                    APRONS.area if APRONS is not None else 0))

# 建筑禁区 = 跑道走廊 ∪ 路口正前方净空
CLEAR_ZONE = CORRIDOR if APRONS is None else CORRIDOR.union(APRONS)


def clip_building(cs):
    """把这栋楼的轮廓从走廊里切掉，返回剩下可以建的部分（可能为空）。"""
    try:
        g = Polygon(cs).buffer(0)
    except Exception:
        return [cs]
    if g.is_empty:
        return []
    if g.geom_type == 'MultiPolygon':
        g = max(g.geoms, key=lambda x: x.area)
    if g.geom_type != 'Polygon':
        return []
    if not g.intersects(CLEAR_ZONE):
        return [cs]
    g2 = g.difference(CLEAR_ZONE)
    parts = list(g2.geoms) if g2.geom_type == 'MultiPolygon' else ([g2] if not g2.is_empty else [])
    out = []
    for q in parts:
        if q.geom_type != 'Polygon' or q.area < 18:
            continue          # 切剩的碎片不如不建
        ring = dedupe_ring([(float(c[0]), float(c[1])) for c in q.exterior.coords][:-1], 0.4)
        if len(ring) >= 3 and abs(ring_area(ring)) > 18:
            out.append(ring)
    return out


# =====================================================================
#  几何小工具
# =====================================================================
def seg_len(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def offset_ring(ring, off):
    """闭环按顶点 miter 偏移。逐边偏移会让相邻四边形在拐点错开，边线成锯齿。"""
    n = len(ring)
    out = []
    for i in range(n):
        a, b = ring[i - 1], ring[(i + 1) % n]
        ux, uz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(ux, uz) or 1
        nx, nz = uz / L, -ux / L
        out.append((ring[i][0] + nx * off, ring[i][1] + nz * off))
    return out


def ring_band(part, ring, inner, outer, y, color):
    """沿闭合折线铺一条草带：从「向内 inner 米」到「向外 outer 米」。
    inner 取负值 = 草探进水面，把水网格边缘的碎角盖住。"""
    ring = ensure_ccw(dedupe_ring([tuple(p) for p in ring]))
    A = offset_ring(ring, inner)
    B = offset_ring(ring, outer)
    n = len(ring)
    for i in range(n):
        j = (i + 1) % n
        ids = [part.v((q[0], y, q[1]), (0, 1, 0), (q[0] / 8.0, q[1] / 8.0), color)
               for q in (A[i], A[j], B[j], B[i])]
        part.tri(ids[0], ids[2], ids[1])
        part.tri(ids[0], ids[3], ids[2])


MLON_C = 111320.0 * math.cos(math.radians(39.9895))
MLAT_C = 110574.0


def to_m(lon, lat):
    return ((lon - 116.31) * MLON_C, (lat - 39.9895) * MLAT_C)


# =====================================================================
#  几何小工具（续）
# =====================================================================
def ring_area(pts):
    return abs(signed_area2(pts))


def signed_area2(pts):
    s = 0.0
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        s += a[0] * b[1] - b[0] * a[1]
    return s * 0.5


def dedupe_ring(pts, eps=0.05):
    """去掉相邻重复/超近点。OSM 的 way 常有重复节点，
    earcut 碰到这种退化边会在边界上丢掉一排细长三角形——表现就是岸边一圈锯齿。"""
    out = []
    for p in pts:
        if not out or (abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps):
            out.append((float(p[0]), float(p[1])))
    while len(out) > 1 and abs(out[0][0] - out[-1][0]) <= eps and abs(out[0][1] - out[-1][1]) <= eps:
        out.pop()
    return out


def ensure_ccw(pts):
    """统一逆时针：earcut 的结果环绕方向跟着输入走，不归一化就会被背面剔除。"""
    return pts if signed_area2(pts) > 0 else pts[::-1]


def clean_poly(pts, min_area=6.0):
    if len(pts) < 3:
        return None
    try:
        p = Polygon(pts).buffer(0)
    except Exception:
        return None
    if p.is_empty:
        return None
    if p.geom_type == 'MultiPolygon':
        p = max(p.geoms, key=lambda g: g.area)
    if p.geom_type != 'Polygon' or p.area < min_area:
        return None
    p = p.simplify(0.4, preserve_topology=True)
    if p.is_empty or p.area < min_area:
        return None
    cs = ensure_ccw(dedupe_ring([(float(c[0]), float(c[1])) for c in p.exterior.coords][:-1]))
    return cs if len(cs) >= 3 else None


def tri_polygon(pts):
    n = len(pts)
    if n < 3:
        return []
    arr = np.asarray(pts, dtype=np.float64)
    idx = earcut.triangulate_float64(arr, np.array([n], dtype=np.uint32))
    return [(int(idx[i]), int(idx[i + 1]), int(idx[i + 2])) for i in range(0, len(idx) - 2, 3)]


class Part:
    """一个材质分组：位置 / 法线 / UV / 顶点色 / 索引，最后按材质导出成一个 primitive。"""

    def __init__(self, name):
        self.name = name
        self.pos, self.nrm, self.uv, self.col, self.idx = [], [], [], [], []

    def v(self, p, n, uv=(0.0, 0.0), c=(1.0, 1.0, 1.0)):
        self.pos.append(p)
        self.nrm.append(n)
        self.uv.append(uv)
        self.col.append(c)
        return len(self.pos) - 1

    def tri(self, a, b, c):
        self.idx.append((a, b, c))

    def quad(self, p0, p1, p2, p3, n, uv0, uv1, uv2, uv3, c):
        i0 = self.v(p0, n, uv0, c)
        i1 = self.v(p1, n, uv1, c)
        i2 = self.v(p2, n, uv2, c)
        i3 = self.v(p3, n, uv3, c)
        self.tri(i0, i1, i2)
        self.tri(i0, i2, i3)

    def poly_flat(self, pts, y, c=(1.0, 1.0, 1.0), uv_scale=1 / 8.0, uv_off=(0.0, 0.0)):
        pts = ensure_ccw(dedupe_ring(pts))
        ids = [self.v((p[0], y, p[1]), (0, 1, 0),
                      (p[0] * uv_scale + uv_off[0], p[1] * uv_scale + uv_off[1]), c) for p in pts]
        # earcut 给出 (a,b,c)，导出时统一做了 z 取负 + 索引翻转，
        # 手工条带在那套翻转下正好朝上，多边形必须提前反一次
        for a, b, cc in tri_polygon(pts):
            self.tri(ids[a], ids[cc], ids[b])


# =====================================================================
#  程序化贴图
# =====================================================================
def _noise(size, amp, blur=0):
    a = np.random.default_rng(7).normal(0, amp, (size, size))
    if blur:
        k = np.ones(blur) / blur
        for ax in (0, 1):
            a = np.apply_along_axis(lambda m: np.convolve(m, k, mode='same'), ax, a)
    return a


def _tile_noise(size, amp, cells, rng):
    """低频块状起伏：用来做草地/沥青的斑驳，比纯随机噪声更像地面。"""
    small = rng.normal(0, amp, (cells, cells))
    img = Image.fromarray(((small - small.min()) / max(1e-6, small.ptp()) * 255).astype(np.uint8))
    img = img.resize((size, size), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 255.0 - 0.5


def tex_grass(path, size=256):
    rng = np.random.default_rng(11)
    base = np.array([112, 124, 90], dtype=np.float32)
    low = _tile_noise(size, 1.0, 9, rng)
    low2 = _tile_noise(size, 1.0, 26, rng)
    fine = rng.normal(0, 1, (size, size))
    shade = 1.0 + low * 0.13 + low2 * 0.10 + fine * 0.045
    rgb = np.clip(base[None, None, :] * shade[:, :, None], 0, 255)
    # 零星深色草簇
    for _ in range(90):
        x, y = int(rng.integers(0, size)), int(rng.integers(0, size))
        rr = int(rng.integers(1, 4))
        rgb[max(0, y - rr):y + rr, max(0, x - rr):x + rr] *= 0.90
    Image.fromarray(rgb.astype(np.uint8)).save(path)


def tex_paved(path, size=256):
    rng = np.random.default_rng(13)
    base = np.array([196, 190, 176], dtype=np.float32)
    n = _tile_noise(size, 1.0, 14, rng) * 0.10 + rng.normal(0, 1, (size, size)) * 0.03
    rgb = np.clip(base[None, None, :] * (1.0 + n[:, :, None]), 0, 255)
    im = Image.fromarray(rgb.astype(np.uint8))
    dr = ImageDraw.Draw(im)
    step = size // 4
    for i in range(0, size + 1, step):
        dr.line([(i, 0), (i, size)], fill=(168, 162, 150), width=1)
        dr.line([(0, i), (size, i)], fill=(168, 162, 150), width=1)
    im.save(path)


def tex_asphalt(path, size=256):
    rng = np.random.default_rng(17)
    base = np.array([96, 98, 100], dtype=np.float32)
    low = _tile_noise(size, 1.0, 12, rng) * 0.12
    fine = rng.normal(0, 1, (size, size)) * 0.10
    rgb = np.clip(base[None, None, :] * (1.0 + low[:, :, None] + fine[:, :, None]), 0, 255)
    Image.fromarray(rgb.astype(np.uint8)).save(path)


def tex_walk(path, size=256):
    rng = np.random.default_rng(19)
    base = np.array([186, 180, 166], dtype=np.float32)
    n = _tile_noise(size, 1.0, 20, rng) * 0.08 + rng.normal(0, 1, (size, size)) * 0.035
    rgb = np.clip(base[None, None, :] * (1.0 + n[:, :, None]), 0, 255)
    im = Image.fromarray(rgb.astype(np.uint8))
    dr = ImageDraw.Draw(im)
    for y in range(0, size, size // 4):
        dr.line([(0, y), (size, y)], fill=(160, 155, 143), width=2)
    for x in range(0, size, size // 2):
        dr.line([(x, 0), (x, size)], fill=(168, 163, 151), width=1)
    im.save(path)


WALL_VARIANTS = [
    ((230, 226, 214), False, (96, 116, 138), (247, 244, 236), (249, 246, 239), 'wide'),
    ((172, 104, 90), True, (88, 104, 124), (242, 236, 224), (236, 230, 218), 'wide'),
    ((196, 194, 186), False, (92, 110, 132), (150, 149, 146), (168, 167, 163), 'tall'),
    ((214, 203, 178), False, (98, 114, 134), (244, 238, 226), (242, 236, 224), 'small'),
]


def _facade_tile(size, wall, brick, glass, frame, sill, style):
    """一张 8m×8m 的立面：墙面 + 一列窗 + 窗台 / 窗框。靠 RepeatWrapping 循环。"""
    im = Image.new('RGB', (size, size), wall)
    dr = ImageDraw.Draw(im)
    rng = np.random.default_rng(23)
    # 墙面轻微的明暗与污渍
    for i in range(1400):
        x, y = rng.integers(0, size), rng.integers(0, size)
        c = 255 if rng.random() < 0.5 else 0
        a = rng.random() * 0.05
        dr.rectangle([x, y, x + rng.integers(1, 6), y + rng.integers(1, 6)],
                     fill=tuple(int(wall[k] * (1 - a) + c * a) for k in range(3)))
    if brick:
        for y in range(0, size, max(4, size // 32)):
            dr.line([(0, y), (size, y)], fill=tuple(int(c * 0.88) for c in wall), width=1)
    # 窗
    if style == 'wide':
        x0, x1 = int(size * 0.15), int(size * 0.85)
        y0, y1 = int(size * 0.30), int(size * 0.72)
    elif style == 'tall':
        x0, x1 = int(size * 0.30), int(size * 0.70)
        y0, y1 = int(size * 0.16), int(size * 0.84)
    elif style == 'small':
        x0, x1 = int(size * 0.24), int(size * 0.76)
        y0, y1 = int(size * 0.34), int(size * 0.68)
    else:
        x0, x1 = int(size * 0.20), int(size * 0.80)
        y0, y1 = int(size * 0.30), int(size * 0.74)
    im.paste(Image.new('RGB', (x1 - x0, y1 - y0), frame), (x0 - 3, y0 - 3))
    # 玻璃：从上到下由深到浅的天光反射
    glass_img = Image.new('RGB', (x1 - x0, y1 - y0))
    gd = ImageDraw.Draw(glass_img)
    h = y1 - y0
    for yy in range(h):
        t = yy / max(1, h - 1)
        c = tuple(int(glass[k] * (0.72 + 0.42 * (1 - t))) for k in range(3))
        gd.line([(0, yy), (x1 - x0, yy)], fill=c)
    im.paste(glass_img, (x0, y0))
    # 窗台
    dr.rectangle([x0 - 5, y1, x1 + 5, y1 + 4], fill=sill)
    return im


def tex_wall_tiles(size=512):
    """每种立面单独一张图，靠 RepeatWrapping 循环——这样每段墙只要一个四边形。"""
    out = []
    for (wall, brick, glass, frame, sill, style) in WALL_VARIANTS:
        tile = _facade_tile(size, wall, brick, glass, frame, sill, style)
        # glTF 的 v=0 在图像顶部；竖着翻一下，让「窗台」落在楼层底部
        out.append(tile.transpose(Image.FLIP_TOP_BOTTOM))
    return out


TEX = {}
for _name, _fn in (('grass', tex_grass), ('paved', tex_paved),
                   ('asphalt', tex_asphalt), ('walk', tex_walk)):
    _p = os.path.join(OUT_DIR, 'tex_%s.png' % _name)
    _fn(_p)
    TEX[_name] = open(_p, 'rb').read()
for _i, _tile in enumerate(tex_wall_tiles()):
    _p = os.path.join(OUT_DIR, 'tex_wall%d.png' % _i)
    _tile.save(_p)
    TEX['wall%d' % _i] = open(_p, 'rb').read()
print('贴图：', {k: '%dKB' % (len(v) // 1024) for k, v in TEX.items()})


# =====================================================================
#  地形
# =====================================================================
P = {k: Part(k) for k in ('ground', 'paved', 'green', 'water', 'street', 'road', 'walk',
                          'line', 'wall0', 'wall1', 'wall2', 'wall3', 'roof', 'trim', 'tree')}

BASE = BASE_RECT
# 底板直接手写两个三角形：earcut 处理 4 点矩形时会给出一组带重复点的索引，
# 导出后第二个三角形退化，整块底板只剩一半（游戏里远处那半片一直是空的）。
_gb = [P['ground'].v((p[0], -0.55, p[1]), (0, 1, 0), (p[0] / 8.0, p[1] / 8.0)) for p in BASE]
P['ground'].tri(_gb[0], _gb[2], _gb[1])
P['ground'].tri(_gb[0], _gb[3], _gb[2])

# 分层高度（越大越靠上）。层与层之间至少留 5cm：
# 相机 near=0.1 / far=230，24 位深度在 200m 处的精度只有 ~5cm，
# 靠得太近的两层就会出现「一会这个一会那个」的深度冲突。
# 顺序也要对：水面必须在草地「之下」，不然湖会浮在岸上。
Y_GROUND, Y_WATER, Y_GREEN, Y_PAVED, Y_STREET = -0.55, -0.10, -0.28, -0.24, -0.16

PLAZA = ('pitch', 'track', 'stadium', 'playground', 'recreation_ground')
paved_polys = []
for g in D['ground']:
    if g.get('cls') in PLAZA:
        cs = clean_poly(g['p'], 40.0)
        if cs:
            P['paved'].poly_flat(cs, Y_PAVED, (1.0, 1.0, 1.0), uv_scale=1 / 8.0)
            paved_polys.append(Polygon(cs))

WATER_DETAIL = os.path.normpath(os.path.join(OUT_DIR, '_src', 'water_detailed.json'))
WATER_REL = os.path.normpath(os.path.join(OUT_DIR, '_src', 'water_relation.json'))

# 三个来源，按精度从高到低：
#   ① relation（未名湖这类 multipolygon，原始外环 300+ 点）
#   ② Overpass 逐条抓的 natural=water way（22 个池塘）
#   ③ z14 矢量瓦片的水面（被瓦片简化过，只补 ①② 都没覆盖到的）
# ③ 必须去重，否则和 ① 在同一高度上叠两层水面，接缝会闪成一排锯齿。
water_items = []       # [(outer, [inners])]
islands = []
det_polys = []

if os.path.exists(WATER_REL):
    rel = json.load(open(WATER_REL, encoding='utf-8'))
    for e in rel.get('elements', []):
        outer = None
        inner = []
        for m in e.get('members') or []:
            g = m.get('geometry') or []
            if len(g) < 4:
                continue
            ring = [to_m(float(q['lon']), float(q['lat'])) for q in g]
            if m.get('role') == 'outer' and outer is None:
                outer = ring
            elif m.get('role') == 'inner':
                inner.append(ring)
        if outer is None:
            continue
        cs = clean_poly(outer, 20.0)
        if not cs:
            continue
        inners = [c for c in (clean_poly(r, 5.0) for r in inner) if c]
        water_items.append((cs, inners))
        det_polys.append(Polygon(cs, inners))
        print('  relation 水面：外环 %d 点 + 内环 %d 个' % (len(cs), len(inners)))

if os.path.exists(WATER_DETAIL):
    det = json.load(open(WATER_DETAIL, encoding='utf-8'))
    for e in det.get('elements', []):
        geom = e.get('geometry') or []
        if len(geom) < 4:
            continue
        ring = [to_m(float(q['lon']), float(q['lat'])) for q in geom]
        cs = clean_poly(ring, 8.0)
        if cs:
            water_items.append((cs, []))
            det_polys.append(Polygon(cs))

DET_WATER_U = unary_union(det_polys) if det_polys else None
print('精细水面 %d 块 / %.0f m²' % (len(det_polys), DET_WATER_U.area if DET_WATER_U else 0))

for w in D['water']:
    cs = clean_poly(w['p'], 18.0)
    if not cs:
        continue
    if DET_WATER_U is not None:
        g = Polygon(cs)
        if g.is_valid and g.area > 0 and DET_WATER_U.intersection(g).area > g.area * 0.35:
            continue
    water_items.append((cs, []))

water_polys = []
PAVE_CLEAR = WALK_OUT + 0.6          # 铺装边线（人行道）再外 0.6m
CORRIDOR_PAVE = LineString(list(ROUTE) + [ROUTE[0]]).buffer(PAVE_CLEAR, join_style=2)


def clip_water(cs):
    """湖面沿路切开：水面带 polygonOffset（会被拉到路面之上渲染），
    只要岸线和跑道走廊有一点点重叠，路上就会浮出一块蓝色三角。"""
    try:
        g = Polygon(cs).buffer(0)
    except Exception:
        return [cs]
    if g.is_empty:
        return []
    if g.geom_type == 'MultiPolygon':
        g = max(g.geoms, key=lambda x: x.area)
    if g.geom_type != 'Polygon' or not g.intersects(CORRIDOR_PAVE):
        return [cs]
    g2 = g.difference(CORRIDOR_PAVE)
    parts = list(g2.geoms) if g2.geom_type == 'MultiPolygon' else ([g2] if not g2.is_empty else [])
    out = []
    for q in parts:
        # 只保留被切开后还成规模的水面：路把湖岸切出的小碎片留在草地上，
        # 会变成一块凭空出现的蓝色三角（比没有水更出戏）
        if q.geom_type != 'Polygon' or q.area < 600:
            continue
        ring = dedupe_ring([(float(c[0]), float(c[1])) for c in q.exterior.coords][:-1], 0.4)
        if len(ring) >= 3:
            out.append(ring)
    return out


for cs, inners in water_items:
    for piece in clip_water(cs):
        P['water'].poly_flat(piece, Y_WATER, (1.0, 1.0, 1.0), uv_scale=1 / 40.0)
    water_polys.append(Polygon(cs, inners))
    for csi in inners:
        # 湖心岛：铺一层高过水面的草地，别让它变成一块水体
        islands.append(csi)
        P['green'].poly_flat(csi, Y_WATER + 0.06, (0.95, 1.0, 0.9), uv_scale=1 / 8.0)

print('水面 %d 块' % len(water_items))
WATER_U = unary_union(water_polys) if water_polys else None
PAVED_U = unary_union(paved_polys) if paved_polys else None


def in_water(x, z, margin=0.0):
    if WATER_U is None:
        return False
    return WATER_U.contains(Point(x, z)) if margin <= 0 else WATER_U.buffer(margin).contains(Point(x, z))


# 岸线交给水面自己：水面比草地高 20cm，绿地又退到岸边 1.6m 外，
# 可见的岸线就是 OSM 的原始湖岸（226 点），没有第二层几何跟它抢。
# 之前铺过一圈「探进水里的草带」，向内偏移在急弯处会自交，反而刷出一排锯齿。
print('岸线：水面覆盖，绿地退让')


def emit_ground_poly(g):
    parts = list(g.geoms) if g.geom_type == 'MultiPolygon' else [g]
    for part in parts:
        if part.is_empty or part.area < 25:
            continue
        cs = ensure_ccw(dedupe_ring([(float(c[0]), float(c[1])) for c in part.exterior.coords][:-1]))
        if len(cs) < 3:
            continue
        t = 0.86 + 0.26 * ((hash(tuple(cs[:2])) % 1000) / 1000.0)
        P['green'].poly_flat(cs, Y_GREEN, (t, t * 1.02, t * 0.92), uv_scale=1 / 8.0)


for g in D['green']:
    cs = clean_poly(g['p'], 25.0)
    if not cs:
        continue
    geom = Polygon(cs)
    if WATER_U is not None:
        geom = geom.difference(WATER_U.buffer(1.6, join_style=1))
    if PAVED_U is not None:
        geom = geom.difference(PAVED_U.buffer(0.25, join_style=1))
    if geom.is_empty:
        continue
    emit_ground_poly(geom)


def offset_pl(pts, off):
    """按斜接（miter）偏移：拐角取两条偏移线的交点。

    旧写法是沿「前后两点连线的法线」走 off，90° 路口实际只偏了 off，
    而正确位置在 off/cos45° = 1.41×off；结果路面在路口内缩、被人行道啃出
    一个三角缺口，远看就像马路分叉成 Y 字（玩家会以为走进死路）。
    """
    n = len(pts)
    out = []
    for i in range(n):
        p = pts[i]
        a = pts[i - 1]
        b = pts[(i + 1) % n]
        d0x, d0z = p[0] - a[0], p[1] - a[1]
        d1x, d1z = b[0] - p[0], b[1] - p[1]
        l0 = math.hypot(d0x, d0z) or 1.0
        l1 = math.hypot(d1x, d1z) or 1.0
        d0x, d0z = d0x / l0, d0z / l0
        d1x, d1z = d1x / l1, d1z / l1
        n0x, n0z = -d0z, d0x          # 左法线
        n1x, n1z = -d1z, d1x
        den = 1.0 + (d0x * d1x + d0z * d1z)
        if den < 0.35:                # 折角 >140°：斜接会拉出长刺，钳一下
            den = 0.35
        out.append((p[0] + (n0x + n1x) * off / den,
                    p[1] + (n0z + n1z) * off / den))
    return out


def band(part, A, B, y, u_max, color=(1, 1, 1)):
    n = len(A)
    acc = 0.0
    for i in range(n):
        j = (i + 1) % n
        L = seg_len(A[i], A[j])
        part.quad((A[i][0], y, A[i][1]), (A[j][0], y, A[j][1]),
                  (B[j][0], y, B[j][1]), (B[i][0], y, B[i][1]), (0, 1, 0),
                  (0, acc / 8.0), (0, (acc + L) / 8.0),
                  (u_max, (acc + L) / 8.0), (u_max, acc / 8.0), color)
        acc += L


band(P['road'], offset_pl(ROUTE, ROAD_HALF), offset_pl(ROUTE, -ROAD_HALF), 0.0, ROAD_HALF * 2 / 8.0)
band(P['walk'], offset_pl(ROUTE, WALK_OUT), offset_pl(ROUTE, ROAD_HALF + 0.16), 0.01,
     (WALK_OUT - ROAD_HALF) / 6.4)
band(P['walk'], offset_pl(ROUTE, -(ROAD_HALF + 0.16)), offset_pl(ROUTE, -WALK_OUT), 0.01,
     (WALK_OUT - ROAD_HALF) / 6.4)


def ribbon_along(part, pts, half, y, dash=None, color=(1, 1, 1)):
    n = len(pts)
    dense = []
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        L = seg_len(a, b)
        k = max(1, int(L / 3.0))
        for j in range(k):
            t = j / k
            dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    acc = 0.0
    m = len(dense)
    for i in range(m):
        a, b = dense[i], dense[(i + 1) % m]
        L = seg_len(a, b)
        if L < 1e-4:
            continue
        if dash and (acc % (dash[0] + dash[1])) > dash[0]:
            acc += L
            continue
        dx, dz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        nx, nz = -dz * half, dx * half
        part.quad((a[0] + nx, y, a[1] + nz), (b[0] + nx, y, b[1] + nz),
                  (b[0] - nx, y, b[1] - nz), (a[0] - nx, y, a[1] - nz), (0, 1, 0),
                  (0, 0), (0, 1), (1, 1), (1, 0), color)
        acc += L


for off in (-1.2, 1.2):
    ribbon_along(P['line'], offset_pl(ROUTE, off), 0.075, 0.02, dash=(3.4, 4.6))
for off in (-3.48, 3.48):
    ribbon_along(P['line'], offset_pl(ROUTE, off), 0.085, 0.02, dash=None, color=(0.93, 0.91, 0.84))

# 路口斑马线
for vi in range(len(ROUTE)):
    v = ROUTE[vi]
    prev = ROUTE[vi - 1]
    ux, uz = v[0] - prev[0], v[1] - prev[1]
    L = math.hypot(ux, uz) or 1
    ux, uz = ux / L, uz / L
    nx, nz = -uz, ux
    cx, cz = v[0] - ux * 4.4, v[1] - uz * 4.4
    for k in range(6):
        t = -2.6 + k * 1.05
        a = (cx + nx * t - ux * 0.20, cz + nz * t - uz * 0.20)
        b = (cx + nx * t + ux * 0.20, cz + nz * t + uz * 0.20)
        w = 0.28
        P['line'].quad((a[0] - nx * w, 0.021, a[1] - nz * w), (b[0] - nx * w, 0.021, b[1] - nz * w),
                       (b[0] + nx * w, 0.021, b[1] + nz * w), (a[0] + nx * w, 0.021, a[1] + nz * w),
                       (0, 1, 0), (0, 0), (1, 0), (1, 1), (0, 1), (0.90, 0.89, 0.84))

# 真实路网细带
STREET_W = {'primary': 5.2, 'secondary': 4.6, 'tertiary': 3.6, 'residential': 3.2,
            'unclassified': 3.2, 'living_street': 2.6, 'service': 2.2,
            'pedestrian': 2.6, 'footway': 1.1, 'path': 0.95, 'cycleway': 1.2, 'track': 1.4}
street_segs = 0
for r in D['road']:
    hw = STREET_W.get(r['cls'])
    if not hw:
        continue
    for ln in r['lines']:
        if len(ln) < 2:
            continue
        pts = [tuple(p) for p in ln]
        if all(any(seg_dist(p, ROUTE[j], ROUTE[(j + 1) % NSEG]) < ROAD_HALF + 1.2
                   for j in range(NSEG)) for p in pts[::max(1, len(pts) // 4)]):
            continue
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            L = seg_len(a, b)
            if L < 0.5:
                continue
            # 路网不铺到水里，也不贴着水边铺：
            # 步道比水面高 20cm，沿着湖岸一段段铺过去，边缘会连成一排锯齿。
            if in_water(a[0], a[1], 1.0) or in_water(b[0], b[1], 1.0):
                continue
            if WATER_U is not None and (
                    WATER_U.distance(Point(a[0], a[1])) < 2.6
                    or WATER_U.distance(Point(b[0], b[1])) < 2.6):
                continue
            dx, dz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            nx, nz = -dz * hw, dx * hw
            P['street'].quad((a[0] + nx, Y_STREET, a[1] + nz), (b[0] + nx, Y_STREET, b[1] + nz),
                             (b[0] - nx, Y_STREET, b[1] - nz), (a[0] - nx, Y_STREET, a[1] - nz),
                             (0, 1, 0), (0, 0), (0, 1), (1, 1), (1, 0), (1, 1, 1))
            street_segs += 1
print('路网细带 %d 段' % street_segs)

def route_dist(pt):
    return min(seg_dist(pt, ROUTE[i], ROUTE[(i + 1) % NSEG]) for i in range(NSEG))


def prism(part, corners, y0, y1, col):
    """任意凸四边形柱体（4 面墙 + 顶）。用来做屋顶设备箱、雨棚梁、柱墩。"""
    corners = ensure_ccw([(float(c[0]), float(c[1])) for c in corners])
    n = len(corners)
    for i in range(n):
        a, c = corners[i], corners[(i + 1) % n]
        L = seg_len(a, c)
        if L < 1e-4:
            continue
        dx, dz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
        nx, nz = dz, -dx
        part.quad((a[0], y0, a[1]), (c[0], y0, c[1]), (c[0], y1, c[1]), (a[0], y1, a[1]),
                  (nx, 0, nz), (0, 0), (1, 0), (1, 1), (0, 1), col)
    ids = [part.v((p[0], y1, p[1]), (0, 1, 0), (p[0] * 0.1, p[1] * 0.1), col) for p in corners]
    for t in tri_polygon(corners):
        part.tri(ids[t[0]], ids[t[2]], ids[t[1]])


BLD_POLY = []
LANDMARKS = []
LM_NAMES = ('博雅塔', '北京大学图书馆', '邱德拔体育馆', '百周年纪念讲堂')


def pick_variant(cs, name):
    area = ring_area(cs)
    seed = (hash(tuple(cs[:2])) % 1000) / 1000.0
    if name and ('图书' in name or '实验' in name or '馆' in name or '中心' in name):
        idx = 2
    elif name and ('宿' in name or '斋' in name or '公寓' in name):
        idx = 1
    elif area < 260:
        idx = 3
    elif area > 2400:
        idx = 2
    else:
        idx = 0 if seed < 0.62 else (1 if seed < 0.86 else 3)
    return idx


def emit_building(cs, h, name=None):
    area = ring_area(cs)
    vi = pick_variant(cs, name)
    wp = P['wall%d' % vi]
    floors = max(1, int(round(max(h, FLOOR_H * 1.5) / FLOOR_H)))
    hh = floors * FLOOR_H
    y0, y1 = -0.25, hh
    seed = (hash(tuple(cs[:2])) % 1000) / 1000.0
    tint = 0.93 + 0.12 * seed
    col = (tint, tint * 0.995, tint * 0.985)
    n = len(cs)
    acc = 0.0
    for i in range(n):
        a, c = cs[i], cs[(i + 1) % n]
        L = seg_len(a, c)
        if L < 0.05:
            continue
        dx, dz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
        nx, nz = dz, -dx
        nrm = (nx, 0, nz)
        wp.quad((a[0], y0, a[1]), (c[0], y0, c[1]), (c[0], y1, c[1]), (a[0], y1, a[1]), nrm,
                (acc / BAY_W, 0.0), ((acc + L) / BAY_W, 0.0),
                ((acc + L) / BAY_W, float(floors)), (acc / BAY_W, float(floors)), col)
        acc += L
    ids = [P['roof'].v((p[0], y1, p[1]), (0, 1, 0), (p[0] * 0.05, p[1] * 0.05),
                       (0.60, 0.61, 0.63)) for p in cs]
    for a, bb, cc in tri_polygon(cs):
        P['roof'].tri(ids[a], ids[cc], ids[bb])
    if area > 420:
        cen = (sum(p[0] for p in cs) / n, sum(p[1] for p in cs) / n)
        ins = 0.30
        inner = []
        for p in cs:
            vx, vz = cen[0] - p[0], cen[1] - p[1]
            L2 = math.hypot(vx, vz) or 1
            inner.append((p[0] + vx / L2 * ins, p[1] + vz / L2 * ins))
        ph = 0.7
        for i in range(n):
            a, c = cs[i], cs[(i + 1) % n]
            ai, ci = inner[i], inner[(i + 1) % n]
            L = seg_len(a, c)
            if L < 0.05:
                continue
            dx, dz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
            nx, nz = dz, -dx
            P['trim'].quad((a[0], y1, a[1]), (c[0], y1, c[1]),
                           (c[0], y1 + ph, c[1]), (a[0], y1 + ph, a[1]), (nx, 0, nz),
                           (0, 0), (1, 0), (1, 1), (0, 1), (0.72, 0.72, 0.73))
        P['trim'].poly_flat(inner, y1 + ph, (0.68, 0.68, 0.69), uv_scale=0.1)
    # ---- 屋顶设备（水箱 / 机房 / 排风）：只给大体量楼加 ----
    # 光秃秃的平屋顶是「体块感」最大的来源，一点小体量就能把天际线打散
    if area > 1100:
        r2 = np.random.default_rng(abs(hash(tuple(cs[:3]))) % (2 ** 31))
        kept = 0
        minx, minz = min(p[0] for p in cs), min(p[1] for p in cs)
        maxx, maxz = max(p[0] for p in cs), max(p[1] for p in cs)
        inner = Polygon(cs).buffer(-2.2)
        for _ in range(3 if area > 2600 else 2):
            for _try in range(10):
                bx = minx + r2.random() * (maxx - minx)
                bz = minz + r2.random() * (maxz - minz)
                if inner.contains(Point(bx, bz)):
                    break
            else:
                continue
            bw = 2.2 + r2.random() * 3.4
            bd = 1.8 + r2.random() * 2.6
            bh = 1.1 + r2.random() * 1.5
            prism(P['trim'], [(bx - bw / 2, bz - bd / 2), (bx + bw / 2, bz - bd / 2),
                              (bx + bw / 2, bz + bd / 2), (bx - bw / 2, bz + bd / 2)],
                  y1, y1 + bh, (0.64, 0.645, 0.655))
            kept += 1

    # ---- 入口雨棚：只给临路的楼加 ----
    # 近景时「一整面贴图墙」最容易露馅，加一段挑出的雨棚 + 两根柱子，尺度感立刻就对了
    cen0 = (sum(p[0] for p in cs) / n, sum(p[1] for p in cs) / n)
    if area > 600 and hh >= 7.0 and route_dist(cen0) < 34:
        kbest = min(range(n), key=lambda i: route_dist(cs[i]))
        a, c = cs[kbest], cs[(kbest + 1) % n]
        L = seg_len(a, c)
        if L > 4.2:
            ux, uz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
            nx, nz = uz, -ux
            mx, mz = (a[0] + c[0]) / 2.0, (a[1] + c[1]) / 2.0
            if route_dist((mx + nx * 3.0, mz + nz * 3.0)) < route_dist((mx, mz)):
                nx, nz = -nx, -nz          # 让法线朝路
            hw = min(4.2, L * 0.34)
            dep = 2.7
            ytop = 3.15
            # 挑板
            prism(P['trim'], [(mx - ux * hw, mz - uz * hw), (mx + ux * hw, mz + uz * hw),
                              (mx + ux * hw + nx * dep, mz + uz * hw + nz * dep),
                              (mx - ux * hw + nx * dep, mz - uz * hw + nz * dep)],
                  ytop, ytop + 0.22, (0.80, 0.79, 0.76))
            # 两根柱
            for sgn in (-1, 1):
                px_ = mx + ux * hw * sgn * 0.92 + nx * (dep - 0.25)
                pz_ = mz + uz * hw * sgn * 0.92 + nz * (dep - 0.25)
                prism(P['trim'], [(px_ - 0.13, pz_ - 0.13), (px_ + 0.13, pz_ - 0.13),
                                  (px_ + 0.13, pz_ + 0.13), (px_ - 0.13, pz_ + 0.13)],
                      0.0, ytop, (0.58, 0.58, 0.59))

    try:
        BLD_POLY.append(Polygon(cs))
    except Exception:
        pass


# ---- 精细建筑（Overpass 分块抓取）----


def load_detailed():
    """读分块抓来的精细建筑：真实轮廓 + height / building:levels + 名称。"""
    rows = []
    if not os.path.isdir(CHUNK_DIR):
        return rows
    for fn in sorted(os.listdir(CHUNK_DIR)):
        if not fn.endswith('.json'):
            continue
        try:
            d = json.load(open(os.path.join(CHUNK_DIR, fn), encoding='utf-8'))
        except Exception:
            continue
        for e in d.get('elements', []):
            geom = e.get('geometry') or []
            if len(geom) < 3:
                continue
            pts = [to_m(float(q['lon']), float(q['lat'])) for q in geom]
            t = e.get('tags') or {}
            h = None
            raw = t.get('height')
            if raw:
                try:
                    h = float(str(raw).replace('m', '').strip())
                except Exception:
                    h = None
            if not h and t.get('building:levels'):
                try:
                    h = float(t['building:levels']) * 3.3
                except Exception:
                    pass
            rows.append((pts, h, t.get('name') or t.get('name:zh')))
    return rows


DET = load_detailed()
DET_UNION = None
if DET:
    _polys = []
    for _pts, _h, _nm in DET:
        try:
            _g = Polygon(_pts).buffer(0)
        except Exception:
            continue
        if _g.is_empty:
            continue
        if _g.geom_type == 'MultiPolygon':
            _g = max(_g.geoms, key=lambda x: x.area)
        _polys.append(_g)
    if _polys:
        DET_UNION = unary_union(_polys)
print('精细建筑 %d 栋（覆盖 %.0f m²）' % (len(DET), DET_UNION.area if DET_UNION else 0))


def guess_h(area, known):
    """known 来自数据。z14 瓦片的 render_height 在缺少 height / building:levels 时
    统一给 5 —— 所以 <=5 当「没有数据」，按占地估楼层，否则几百栋楼全成 5 米平房。"""
    if known:
        try:
            v = float(known)
            if v > 5.5:
                return max(6.0, min(90.0, v))
        except Exception:
            pass
    if area < 120:
        return FLOOR_H * 2
    if area < 320:
        return FLOOR_H * 3
    if area < 800:
        return FLOOR_H * 4
    if area < 1800:
        return FLOOR_H * 5
    if area < 4000:
        return FLOOR_H * 6
    return FLOOR_H * 4


kept, dropped = 0, 0
for pts, h, nm in DET:
    cs = clean_poly(pts, 10.0)
    if not cs:
        continue
    if nm == '博雅塔':
        cx = sum(p[0] for p in cs) / len(cs)
        cy = sum(p[1] for p in cs) / len(cs)
        LANDMARKS.append({'name': nm, 'x': round(cx, 1), 'z': round(-cy, 1), 'h': round(h or 31.0, 1)})
        continue
    if any(seg_dist(p, ROUTE[i], ROUTE[(i + 1) % NSEG]) < CORRIDOR_CLEAR
           for i in range(NSEG) for p in cs):
        dropped += 1
        continue
    parts = clip_building(cs)
    if not parts:
        dropped += 1
        continue
    hh = guess_h(ring_area(cs), h)
    for pc in parts:
        emit_building(pc, hh, nm)
        kept += 1
    if nm in LM_NAMES and not any(l['name'] == nm for l in LANDMARKS):
        cx = sum(p[0] for p in cs) / len(cs)
        cy = sum(p[1] for p in cs) / len(cs)
        LANDMARKS.append({'name': nm, 'x': round(cx, 1), 'z': round(-cy, 1), 'h': round(hh, 1)})

for b in D['building']:
    cs = clean_poly(b['p'], 12.0)
    if not cs:
        continue
    if any(seg_dist(p, ROUTE[i], ROUTE[(i + 1) % NSEG]) < CORRIDOR_CLEAR
           for i in range(NSEG) for p in cs):
        dropped += 1
        continue
    if DET_UNION is not None:
        try:
            g = Polygon(cs)
            if g.is_valid and g.area > 0 and DET_UNION.intersection(g).area > g.area * 0.35:
                continue
        except Exception:
            pass
    parts = clip_building(cs)
    if not parts:
        dropped += 1
        continue
    hb = guess_h(ring_area(cs), b.get('h'))
    for pc in parts:
        emit_building(pc, hb)
        kept += 1
print('建筑：保留 %d / 走廊内剔除 %d' % (kept, dropped))


# ---- 树 / 灌木 / 路灯 ----
ICO_V = [(-1, 1.618, 0), (1, 1.618, 0), (-1, -1.618, 0), (1, -1.618, 0),
         (0, -1, 1.618), (0, 1, 1.618), (0, -1, -1.618), (0, 1, -1.618),
         (1.618, 0, -1), (1.618, 0, 1), (-1.618, 0, -1), (-1.618, 0, 1)]
ICO_F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
         (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
         (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
         (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
ICO_RL = math.sqrt(1 + 1.618 ** 2)


def blob(part, x, y, z, rx, ry, rz, col, shade_lo=0.80, shade_hi=1.02):
    """正二十面体球：树冠 / 灌木共用，20 面一个，比八面体圆得多。"""
    cid = []
    for (vx, vy, vz) in ICO_V:
        nn = (vx / ICO_RL, vy / ICO_RL, vz / ICO_RL)
        sh = shade_lo + (shade_hi - shade_lo) * max(0.0, nn[1])
        cid.append(part.v((x + nn[0] * rx, y + nn[1] * ry, z + nn[2] * rz), nn, (0, 0),
                          (col[0] * sh, col[1] * sh, col[2] * sh)))
    for f in ICO_F:
        part.tri(cid[f[0]], cid[f[1]], cid[f[2]])


def tree_at(part, x, z, scale, kind, rot):
    # 比例按真实行道树来：树高 6.2m 左右，树干到 3.4m，树冠从 3m 起
    # （之前树干只到 3.35m、树冠底在 3.8m，中间空一截，看着像「球插在棍子上」）
    h = 6.2 * scale
    tr = 0.21 * scale
    trunk_col = (0.27, 0.21, 0.15)
    seg = 5
    for i in range(seg):
        a0 = rot + 2 * math.pi * i / seg
        a1 = rot + 2 * math.pi * (i + 1) / seg
        p0 = (x + tr * math.cos(a0), -0.2, z + tr * math.sin(a0))
        p1 = (x + tr * math.cos(a1), -0.2, z + tr * math.sin(a1))
        p2 = (x + tr * 0.62 * math.cos(a1), h * 0.56, z + tr * 0.62 * math.sin(a1))
        p3 = (x + tr * 0.62 * math.cos(a0), h * 0.56, z + tr * 0.62 * math.sin(a0))
        n = (math.cos(a0), 0, math.sin(a0))
        i0 = part.v(p0, n, (0, 0), trunk_col)
        i1 = part.v(p1, n, (1, 0), trunk_col)
        i2 = part.v(p2, n, (1, 1), trunk_col)
        i3 = part.v(p3, n, (0, 1), trunk_col)
        part.tri(i0, i1, i2)
        part.tri(i0, i2, i3)
    jit = ((hash((round(x, 1), round(z, 1))) % 1000) / 1000.0 - 0.5) * 0.14
    if kind == 0:
        rx, ry, rz, cy = 1.85 * scale, 1.55 * scale, 1.85 * scale, h * 0.80
        col = (0.24 + jit, 0.37 + jit, 0.19 + jit * 0.6)
    elif kind == 1:
        rx, ry, rz, cy = 1.25 * scale, 1.95 * scale, 1.25 * scale, h * 0.74
        col = (0.38 + jit, 0.45 + jit, 0.15 + jit * 0.5)
    else:
        rx, ry, rz, cy = 1.05 * scale, 1.85 * scale, 1.05 * scale, h * 0.72
        col = (0.12 + jit * 0.5, 0.26 + jit * 0.5, 0.15 + jit * 0.4)
    # 树冠底部要压到树干上（cy - ry 明显小于树干顶），否则会「悬空」
    blob(part, x, cy, z, rx, ry, rz, col, 0.72, 1.08)
    if kind == 0:
        # 阔叶树叠一层偏移的小冠，剪影不至于是个正球
        col2 = (col[0] * 1.12, col[1] * 1.10, col[2] * 1.06)
        blob(part, x + 0.55 * scale, cy + ry * 0.42, z - 0.42 * scale,
             rx * 0.58, ry * 0.55, rz * 0.58, col2, 0.80, 1.12)


def bush_at(part, x, z, s):
    """灌木：压扁的二十面体，读作圆灌木而不是三角锥。"""
    blob(part, x, 0.42 * s, z, 0.95 * s, 0.55 * s, 0.95 * s, (0.21, 0.34, 0.16))


def lamp_at(x, z, rot):
    pole_col = (0.22, 0.24, 0.26)
    h = 4.6
    seg = 4
    for i in range(seg):
        a0 = rot + 2 * math.pi * i / seg
        a1 = rot + 2 * math.pi * (i + 1) / seg
        p0 = (x + 0.085 * math.cos(a0), 0.0, z + 0.085 * math.sin(a0))
        p1 = (x + 0.085 * math.cos(a1), 0.0, z + 0.085 * math.sin(a1))
        p2 = (x + 0.055 * math.cos(a1), h, z + 0.055 * math.sin(a1))
        p3 = (x + 0.055 * math.cos(a0), h, z + 0.055 * math.sin(a0))
        n = (math.cos(a0), 0, math.sin(a0))
        i0 = P['trim'].v(p0, n, (0, 0), pole_col)
        i1 = P['trim'].v(p1, n, (0, 0), pole_col)
        i2 = P['trim'].v(p2, n, (0, 0), pole_col)
        i3 = P['trim'].v(p3, n, (0, 0), pole_col)
        P['trim'].tri(i0, i1, i2)
        P['trim'].tri(i0, i2, i3)
    dx, dz = math.cos(rot + 1.1), math.sin(rot + 1.1)
    hx, hz = x + dx * 0.72, z + dz * 0.72
    w = 0.17
    px, pz = -dz * w, dx * w
    P['line'].quad((hx - px, h - 0.14, hz - pz), (hx + px, h - 0.14, hz + pz),
                   (hx + px, h + 0.03, hz + pz), (hx - px, h + 0.03, hz - pz), (0, 1, 0),
                   (0, 0), (1, 0), (1, 1), (0, 1), (0.88, 0.86, 0.76))


rng = np.random.default_rng(20261030)
greens = [Polygon(g['p']).buffer(0) for g in D['green'] if len(g['p']) >= 3]
greens = [g for g in greens if g.is_valid and not g.is_empty and g.area > 120]
if WATER_U is not None:
    # 种树用的「陆地草地」：真正的水面要挖掉，否则树会长在湖里
    greens = [g.difference(WATER_U.buffer(0.8, join_style=1)) for g in greens]
    greens = [g for g in greens if not g.is_empty and g.area > 120]
BLD_TREE = STRtree(BLD_POLY) if BLD_POLY else None


def on_building(x, z):
    if BLD_TREE is None:
        return False
    pt = Point(x, z)
    for idx in BLD_TREE.query(pt):
        if BLD_POLY[idx].contains(pt):
            return True
    return False


def near_route(x, z, half):
    return any(seg_dist((x, z), ROUTE[j], ROUTE[(j + 1) % NSEG]) < half for j in range(NSEG))


trees = bushes = lamps = 0
for i in range(NSEG):
    a, b = ROUTE[i], ROUTE[(i + 1) % NSEG]
    L = seg_len(a, b)
    dx, dy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    nx, ny = -dy, dx
    n = max(1, int(L / 12.5))
    for k in range(n):
        t = (k + 0.5) / n
        for side in (-1, 1):
            off = 9.4 + rng.random() * 3.0
            x = a[0] + (b[0] - a[0]) * t + nx * off * side
            z = a[1] + (b[1] - a[1]) * t + ny * off * side
            if near_route(x, z, 7.8) or on_building(x, z) or in_water(x, z, 0.9):
                continue
            kind = 0 if rng.random() < 0.68 else (1 if rng.random() < 0.55 else 2)
            tree_at(P['tree'], x, z, 0.92 + rng.random() * 0.45, kind, rng.random() * 6.28)
            trees += 1
    m = max(1, int(L / 17.0))
    for k in range(m):
        t = (k + 0.5) / m
        for side in (-1, 1):
            off = 7.5 + rng.random() * 1.0
            x = a[0] + (b[0] - a[0]) * t + nx * off * side
            z = a[1] + (b[1] - a[1]) * t + ny * off * side
            if near_route(x, z, 6.9) or on_building(x, z) or in_water(x, z, 0.9):
                continue
            bush_at(P['tree'], x, z, 0.85 + rng.random() * 0.5)
            bushes += 1
    ln = max(1, int(L / 44.0))
    for k in range(ln):
        t = (k + 0.5) / ln
        side = 1 if (i + k) % 2 == 0 else -1
        x = a[0] + (b[0] - a[0]) * t + nx * 7.0 * side
        z = a[1] + (b[1] - a[1]) * t + ny * 7.0 * side
        if near_route(x, z, 6.2) or on_building(x, z) or in_water(x, z, 0.9):
            continue
        lamp_at(x, z, math.atan2(dy, dx) + math.pi / 2 * side)
        lamps += 1

for g in greens:
    minx, miny, maxx, maxy = g.bounds
    if maxx - minx > 700 or maxy - miny > 700:
        continue
    cnt = min(30, int(g.area / 260))
    for _ in range(cnt):
        x = minx + rng.random() * (maxx - minx)
        z = miny + rng.random() * (maxy - miny)
        if not g.contains(Point(x, z)) or near_route(x, z, 7.8) or on_building(x, z) or in_water(x, z, 0.8):
            continue
        kind = 0 if rng.random() < 0.6 else (1 if rng.random() < 0.6 else 2)
        tree_at(P['tree'], x, z, 1.0 + rng.random() * 0.6, kind, rng.random() * 6.28)
        trees += 1

print('树 %d / 灌木 %d / 路灯 %d' % (trees, bushes, lamps))


# =====================================================================
#  GLB 导出
# =====================================================================
def s2l(v):
    out = []
    for c in v[:3]:
        out.append((c / 12.92) if c <= 0.04045 else (((c + 0.055) / 1.055) ** 2.4))
    return tuple(out) + tuple(v[3:])


MATS = {
    'ground': dict(color=(0.47, 0.62, 0.35, 1), rough=1.0, metal=0.0, tex='grass'),
    'paved': dict(color=(1, 1, 1, 1), rough=1.0, metal=0.0, tex='paved'),
    'green': dict(color=(0.46, 0.62, 0.34, 1), rough=1.0, metal=0.0, tex='grass'),
    'water': dict(color=(0.24, 0.50, 0.68, 1), rough=0.22, metal=0.0),
    'street': dict(color=(0.40, 0.40, 0.41, 1), rough=0.95, metal=0.0),
    'road': dict(color=(1, 1, 1, 1), rough=0.90, metal=0.0, tex='asphalt'),
    'walk': dict(color=(1, 1, 1, 1), rough=0.96, metal=0.0, tex='walk'),
    'line': dict(color=(0.93, 0.91, 0.84, 1), rough=0.72, metal=0.0),
    'wall0': dict(color=(1, 1, 1, 1), rough=0.90, metal=0.0, tex='wall0'),
    'wall1': dict(color=(1, 1, 1, 1), rough=0.90, metal=0.0, tex='wall1'),
    'wall2': dict(color=(1, 1, 1, 1), rough=0.90, metal=0.0, tex='wall2'),
    'wall3': dict(color=(1, 1, 1, 1), rough=0.90, metal=0.0, tex='wall3'),
    'roof': dict(color=(0.52, 0.53, 0.55, 1), rough=0.96, metal=0.0),
    'trim': dict(color=(1, 1, 1, 1), rough=0.90, metal=0.0),
    'tree': dict(color=(1, 1, 1, 1), rough=0.92, metal=0.0),
}

bin_parts, views, accessors, meshes, nodes, materials = [], [], [], [], [], []
tex_images, tex_samplers, tex_textures, tex_index = [], [], [], {}


def add_view(data, target=None):
    while sum(len(x) for x in bin_parts) % 4:
        bin_parts.append(b'\x00')
    off = sum(len(x) for x in bin_parts)
    bin_parts.append(data)
    v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
    if target:
        v['target'] = target
    views.append(v)
    return len(views) - 1


for name in ('ground', 'paved', 'green', 'water', 'street', 'road', 'walk', 'line',
             'wall0', 'wall1', 'wall2', 'wall3', 'roof', 'trim', 'tree'):
    part = P[name]
    if not part.idx:
        continue
    pos = np.asarray(part.pos, dtype=np.float32)
    nrm = np.asarray(part.nrm, dtype=np.float32)
    uv = np.asarray(part.uv, dtype=np.float32)
    col = np.asarray(part.col, dtype=np.float32)
    idx = np.asarray(part.idx, dtype=np.uint32).reshape(-1)
    pos[:, 2] *= -1.0
    nrm[:, 2] *= -1.0
    idx = idx.reshape(-1, 3)[:, [0, 2, 1]].reshape(-1)

    pv = add_view(pos.tobytes(), 34962)
    nv = add_view(nrm.tobytes(), 34962)
    uvv = add_view(uv.tobytes(), 34962)
    cv = add_view(col.tobytes(), 34962)
    iv = add_view(idx.tobytes(), 34963)
    a_pos = len(accessors)
    accessors.append({'bufferView': pv, 'componentType': 5126, 'count': len(pos),
                      'type': 'VEC3', 'min': pos.min(axis=0).tolist(), 'max': pos.max(axis=0).tolist()})
    a_nrm = len(accessors)
    accessors.append({'bufferView': nv, 'componentType': 5126, 'count': len(nrm), 'type': 'VEC3'})
    a_uv = len(accessors)
    accessors.append({'bufferView': uvv, 'componentType': 5126, 'count': len(uv), 'type': 'VEC2'})
    a_col = len(accessors)
    accessors.append({'bufferView': cv, 'componentType': 5126, 'count': len(col), 'type': 'VEC3'})
    a_idx = len(accessors)
    accessors.append({'bufferView': iv, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'})

    mdef = MATS[name]
    mj = {'name': name, 'pbrMetallicRoughness': {
        'baseColorFactor': list(s2l(mdef['color'])),
        'metallicFactor': mdef['metal'], 'roughnessFactor': mdef['rough']}}
    if mdef.get('tex'):
        key = mdef['tex']
        if key not in tex_index:
            iv2 = add_view(TEX[key])
            tex_images.append({'bufferView': iv2, 'mimeType': 'image/png', 'name': key})
            tex_samplers.append({'magFilter': 9729, 'minFilter': 9987,
                                 'wrapS': 10497, 'wrapT': 10497})
            tex_textures.append({'sampler': len(tex_samplers) - 1, 'source': len(tex_images) - 1})
            tex_index[key] = len(tex_textures) - 1
        mj['pbrMetallicRoughness']['baseColorTexture'] = {'index': tex_index[key]}
    materials.append(mj)
    meshes.append({'name': name, 'primitives': [{
        'attributes': {'POSITION': a_pos, 'NORMAL': a_nrm, 'TEXCOORD_0': a_uv, 'COLOR_0': a_col},
        'indices': a_idx, 'material': len(materials) - 1, 'mode': 4}]})
    nodes.append({'name': name, 'mesh': len(meshes) - 1})
    print('  %-7s verts=%7d tris=%7d' % (name, len(pos), len(idx) // 3))

blob = b''.join(bin_parts)
while len(blob) % 4:
    blob += b'\x00'

gltf = {
    'asset': {'version': '2.0', 'generator': 'pku-campus-plate v2'},
    'scene': 0,
    'scenes': [{'nodes': list(range(len(nodes)))}],
    'nodes': nodes, 'meshes': meshes, 'materials': materials,
    'accessors': accessors, 'bufferViews': views,
    'buffers': [{'byteLength': len(blob)}],
}
if tex_images:
    gltf['images'] = tex_images
    gltf['samplers'] = tex_samplers
    gltf['textures'] = tex_textures

js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
while len(js) % 4:
    js += b' '
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
glb += struct.pack('<II', len(js), 0x4E4F534A) + js
glb += struct.pack('<II', len(blob), 0x004E4942) + blob
out = os.path.join(OUT_DIR, GLB_NAME)
open(out, 'wb').write(glb)
print('\n写出 %s  %.2f MB' % (out, len(glb) / 1048576))

route_js = {
    'pts': [[round(x, 2), round(-z, 2)] for x, z in ROUTE],
    'length': round(R['length'], 2),
    'roadHalf': ROAD_HALF,
    'landmarks': LANDMARKS,
}
open(os.path.join(OUT_DIR, ROUTE_OUT), 'w', encoding='utf-8').write(
    json.dumps(route_js, ensure_ascii=False, indent=1))
print('写出 %s  %d 拐点 / %.0f m / 地标 %s' % (ROUTE_OUT,
      len(ROUTE), R['length'], [l['name'] for l in LANDMARKS]))
