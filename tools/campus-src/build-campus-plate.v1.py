"""把北大未名湖片区做成游戏用的校园底板 GLB。

产出 assets/campus/beida-campus.glb：
  · 一层草地底、landuse 地坪、绿地、水面（全部平铺）
  · 693 栋真实建筑（按 OSM 轮廓拉伸，带窗格贴图）
  · 沿路线生成的 7.6m 跑道 + 2.4m 人行道（真弯道）
  · 沿路与绿地的行道树
单位：米。plate 坐标 = (东, 北)，导出为 (x, y=高, z=北)。
"""
import json, math, os, struct
import numpy as np
import mapbox_earcut as earcut
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))          # tools/campus-src
ROOT = os.path.dirname(os.path.dirname(HERE))              # 项目根
SRC = os.path.join(ROOT, 'assets', 'campus', '_src', 'pku_z14.json')
ROUTE_F = os.path.join(ROOT, 'assets', 'campus', '_src', 'pku_route.json')
OUT_DIR = os.path.join(ROOT, 'assets', 'campus')
os.makedirs(OUT_DIR, exist_ok=True)

ROAD_HALF = 3.8
WALK_OUT = 6.2
CORRIDOR_CLEAR = 9.0

D = json.load(open(SRC, encoding='utf-8'))
R = json.load(open(ROUTE_F, encoding='utf-8'))
ROUTE = [tuple(p) for p in R['route']]
NSEG = len(ROUTE)
ROUTE_LEN = R['length']


def seg_len(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def ring_area(pts):
    s = 0.0
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        s += a[0] * b[1] - b[0] * a[1]
    return abs(s) * 0.5


def clean_poly(pts, min_area=6.0):
    """修自交、简化、丢掉碎块。返回外环列表。"""
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
    p = p.simplify(0.45, preserve_topology=True)
    if p.is_empty or p.area < min_area:
        return None
    cs = ensure_ccw([(float(c[0]), float(c[1])) for c in p.exterior.coords][:-1])
    return cs if len(cs) >= 3 else None


def signed_area2(pts):
    s = 0.0
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        s += a[0] * b[1] - b[0] * a[1]
    return s * 0.5


def ensure_ccw(pts):
    """统一逆时针：earcut 的结果环绕方向跟着输入走，不归一化就会被背面剔除。"""
    return pts if signed_area2(pts) > 0 else pts[::-1]


def tri_polygon(pts):
    """简单多边形三角化，返回索引三元组。"""
    n = len(pts)
    if n < 3:
        return []
    arr = np.asarray(pts, dtype=np.float64)
    rings = np.array([n], dtype=np.uint32)
    idx = earcut.triangulate_float64(arr, rings)
    return [(int(idx[i]), int(idx[i + 1]), int(idx[i + 2])) for i in range(0, len(idx) - 2, 3)]


# =====================================================================
#  顶点缓冲工具
# =====================================================================
class Part:
    """一个材质分组的几何累积器。"""

    def __init__(self, name, material):
        self.name = name
        self.material = material
        self.pos = []
        self.nrm = []
        self.uv = []
        self.col = []
        self.idx = []

    def v(self, p, n, uv=(0.0, 0.0), c=(1.0, 1.0, 1.0)):
        self.pos.append(p)
        self.nrm.append(n)
        self.uv.append(uv)
        self.col.append(c)
        return len(self.pos) - 1

    def tri(self, a, b, c):
        self.idx.append((a, b, c))

    def poly_flat(self, pts, y, c=(1.0, 1.0, 1.0), uv_scale=0.05):
        """水平面片（向上法线）。"""
        pts = ensure_ccw(pts)
        ids = [self.v((p[0], y, p[1]), (0, 1, 0),
                      (p[0] * uv_scale, p[1] * uv_scale), c) for p in pts]
        # earcut 给出的是 (a,b,c)，而导出时统一做了 z 取负 + 索引翻转，
        # 手工条带（road/walk/line）在那套翻转下正好朝上，多边形必须提前反一次
        for a, b, cc in tri_polygon(pts):
            self.tri(ids[a], ids[cc], ids[b])


WALL_TEX_PX = 256
WALL_TEX_M = 8.0          # 一张贴图覆盖 8m × 8m（2 开间 × 2 层）


def make_wall_texture(path):
    img = Image.new('RGB', (WALL_TEX_PX, WALL_TEX_PX), (216, 209, 196))
    d = ImageDraw.Draw(img)
    n = WALL_TEX_PX
    half = n // 2
    for gy in range(2):
        for gx in range(2):
            x0, y0 = gx * half, gy * half
            # 墙面微差（砖砌感）
            d.rectangle([x0, y0, x0 + half, y0 + half], fill=(213, 205, 190))
            # 窗洞
            wx0, wy0 = x0 + 26, y0 + 30
            wx1, wy1 = x0 + half - 26, y0 + half - 26
            d.rectangle([wx0 - 4, wy0 - 4, wx1 + 4, wy1 + 4], fill=(236, 231, 220))   # 白色窗套
            d.rectangle([wx0, wy0, wx1, wy1], fill=(52, 66, 82))
            # 玻璃高光和暗部
            d.rectangle([wx0, wy0, wx1, wy0 + (wy1 - wy0) // 3], fill=(74, 92, 110))
            d.rectangle([wx0 + 6, wy0 + 6, wx1 - 6, wy1 - 8], fill=(60, 78, 96))
            # 竖中梃
            mx = (wx0 + wx1) // 2
            d.rectangle([mx - 2, wy0, mx + 2, wy1], fill=(226, 220, 208))
            # 窗台
            d.rectangle([wx0 - 6, wy1 + 2, wx1 + 6, wy1 + 7], fill=(238, 233, 222))
            # 一层墙裙
            d.rectangle([x0, y0 + half - 10, x0 + half, y0 + half], fill=(196, 188, 172))
    img.save(path)
    return path


# =====================================================================
#  组装
# =====================================================================
parts = {}
P_GROUND = Part('ground', 'ground')
P_UNI = Part('paved', 'paved')
P_GREEN = Part('green', 'green')
P_WATER = Part('water', 'water')
P_WALL = Part('wall', 'wall')
P_ROOF = Part('roof', 'roof')
P_ROAD = Part('road', 'road')
P_WALK = Part('walk', 'walk')
P_TREE = Part('tree', 'tree')
P_LINE = Part('line', 'line')      # 跑道车道线
P_STREET = Part('street', 'street')  # 校园真实路网（细带）

# ---- 1. 草地底（覆盖整个可见范围）----
BASE = [(-1120, -720), (120, -720), (120, 860), (-1120, 860)]
P_GROUND.poly_flat(BASE, -0.30, (1.0, 1.0, 1.0), uv_scale=0.01)

# ---- 2. 地坪 / 绿地 / 水面 ----
# 只把球场/操场这类硬化场地铺出来；landuse=university 的整片底色太闷，
# 会让整个校园看上去是一片米色水泥地，草地反而看不见
PLAZA = ('pitch', 'track', 'stadium', 'playground')
for g in D['ground']:
    if g.get('cls') not in PLAZA:
        continue
    cs = clean_poly(g['p'], 40.0)
    if cs:
        P_UNI.poly_flat(cs, -0.22, (1.0, 1.0, 1.0), uv_scale=0.01)
for g in D['green']:
    cs = clean_poly(g['p'], 25.0)
    if cs:
        P_GREEN.poly_flat(cs, -0.16, (1.0, 1.0, 1.0), uv_scale=0.01)
for w in D['water']:
    cs = clean_poly(w['p'], 18.0)
    if cs:
        P_WATER.poly_flat(cs, -0.12, (1.0, 1.0, 1.0), uv_scale=0.01)

# ---- 3. 跑道 + 人行道（沿真实路线，带弯道）----
line = LineString([ROUTE[i] + ROUTE[(i + 1) % NSEG] for i in range(NSEG)] if False else
                  [ROUTE[i] for i in range(NSEG)] + [ROUTE[0]])
road_poly = line.buffer(ROAD_HALF, cap_style=2, join_style=1, resolution=6)
walk_band = line.buffer(WALK_OUT, cap_style=2, join_style=1, resolution=6).difference(
    line.buffer(ROAD_HALF + 0.18, cap_style=2, join_style=1, resolution=6))


def emit_polygon(part, geom, y, color=(1, 1, 1), uv_scale=0.08):
    geoms = list(geom.geoms) if geom.geom_type == 'MultiPolygon' else [geom]
    for g in geoms:
        if g.is_empty or g.area < 2:
            continue
        ext = ensure_ccw([(float(c[0]), float(c[1])) for c in g.exterior.coords][:-1])
        if len(ext) < 3:
            continue
        holes = [ensure_ccw([(float(c[0]), float(c[1])) for c in h.coords][:-1])[::-1]
                 for h in g.interiors]
        holes = [h for h in holes if len(h) >= 3]
        if not holes:
            part.poly_flat(ext, y, color, uv_scale)
            continue
        # 带洞：用 earcut 的「累积环末索引」
        allpts = ext[:]
        cum = [len(ext)]
        for h in holes:
            allpts += h
            cum.append(cum[-1] + len(h))
        arr = np.asarray(allpts, dtype=np.float64)
        idx = earcut.triangulate_float64(arr, np.asarray(cum, dtype=np.uint32))
        ids = [part.v((p[0], y, p[1]), (0, 1, 0), (p[0] * uv_scale, p[1] * uv_scale), color)
               for p in allpts]
        for i in range(0, len(idx) - 2, 3):
            part.tri(ids[int(idx[i])], ids[int(idx[i + 2])], ids[int(idx[i + 1])])


def offset_pl(pts, off):
    """按顶点 miter 偏移折线（闭环）。"""
    n = len(pts)
    out = []
    for i in range(n):
        a, b = pts[i - 1], pts[(i + 1) % n]
        ux, uz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(ux, uz) or 1
        nx, nz = -uz / L, ux / L
        out.append((pts[i][0] + nx * off, pts[i][1] + nz * off))
    return out


def band(part, A, B, y, color=(1, 1, 1)):
    """在两条偏移折线之间铺四边形带。A 必须在 +n 侧（保证朝上正面）。"""
    n = len(A)
    for i in range(n):
        j = (i + 1) % n
        i0 = part.v((A[i][0], y, A[i][1]), (0, 1, 0), (0, 0), color)
        i1 = part.v((A[j][0], y, A[j][1]), (0, 1, 0), (0, 1), color)
        i2 = part.v((B[j][0], y, B[j][1]), (0, 1, 0), (1, 1), color)
        i3 = part.v((B[i][0], y, B[i][1]), (0, 1, 0), (1, 0), color)
        part.tri(i0, i1, i2)
        part.tri(i0, i2, i3)


# 纯手搓条带：比 earcut 处理 3km×7.6m 的超长窄多边形稳得多
band(P_ROAD, offset_pl(ROUTE, ROAD_HALF), offset_pl(ROUTE, -ROAD_HALF), 0.0)
band(P_WALK, offset_pl(ROUTE, WALK_OUT), offset_pl(ROUTE, ROAD_HALF + 0.18), 0.0)
band(P_WALK, offset_pl(ROUTE, -(ROAD_HALF + 0.18)), offset_pl(ROUTE, -WALK_OUT), 0.0)

# ---- 3b. 跑道车道线（沿路线，虚线）----
def ribbon_along(part, pts, half, y, dash=None, color=(1, 1, 1), uv_scale=0.2):
    """沿折线生成细带；dash=(实,虚) 时打断成虚线。pts 为闭环点列。"""
    n = len(pts)
    # 先把整条线按 3m 重采样，保证弯道平滑
    dense = []
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        L = seg_len(a, b)
        k = max(1, int(L / 3.0))
        for j in range(k):
            t = j / k
            dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    m = len(dense)
    acc = 0.0
    for i in range(m):
        a, b = dense[i], dense[(i + 1) % m]
        L = seg_len(a, b)
        if L < 1e-4:
            continue
        if dash:
            on, off = dash
            if (acc % (on + off)) > on:
                acc += L
                continue
        dx, dz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        nx, nz = -dz * half, dx * half
        v0 = acc * uv_scale
        v1 = (acc + L) * uv_scale
        i0 = part.v((a[0] + nx, y, a[1] + nz), (0, 1, 0), (0, v0), color)
        i1 = part.v((b[0] + nx, y, b[1] + nz), (0, 1, 0), (1, v0), color)
        i2 = part.v((b[0] - nx, y, b[1] - nz), (0, 1, 0), (1, v1), color)
        i3 = part.v((a[0] - nx, y, a[1] - nz), (0, 1, 0), (0, v1), color)
        part.tri(i0, i1, i2)
        part.tri(i0, i2, i3)
        acc += L


def offset_route(pts, off):
    n = len(pts)
    out = []
    for i in range(n):
        a, b = pts[i - 1], pts[(i + 1) % n]
        ux, uz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(ux, uz) or 1
        out.append((pts[i][0] - uz / L * off, pts[i][1] + ux / L * off))
    return out


for off in (-1.2, 1.2):
    ribbon_along(P_LINE, offset_route(ROUTE, off), 0.075, 0.015, dash=(3.2, 4.4))
for off in (-3.45, 3.45):
    ribbon_along(P_LINE, offset_route(ROUTE, off), 0.09, 0.015, dash=None,
                 color=(0.92, 0.90, 0.82))

# ---- 3c. 校园真实路网（细带铺地，给个城市肌理）----
STREET_W = {'primary': 5.2, 'secondary': 4.6, 'tertiary': 3.6, 'residential': 3.2,
            'unclassified': 3.2, 'living_street': 2.6, 'service': 2.2,
            'pedestrian': 2.6, 'footway': 1.1, 'path': 0.95, 'cycleway': 1.2, 'track': 1.4}
for r in D['road']:
    hw = STREET_W.get(r['cls'])
    if not hw:
        continue
    for ln in r['lines']:
        if len(ln) < 2:
            continue
        pts = [tuple(p) for p in ln]
        # 与跑道重合的段跳过（跑道自己有更精细的铺装）
        if all(any(seg_dist(p, ROUTE[j], ROUTE[(j + 1) % NSEG]) < ROAD_HALF + 1.2
                   for j in range(NSEG)) for p in pts[::max(1, len(pts) // 4)]):
            continue
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            L = seg_len(a, b)
            if L < 0.5:
                continue
            dx, dz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            nx, nz = -dz * hw, dx * hw
            y = -0.11
            i0 = P_STREET.v((a[0] + nx, y, a[1] + nz), (0, 1, 0), (0, 0))
            i1 = P_STREET.v((b[0] + nx, y, b[1] + nz), (0, 1, 0), (1, 0))
            i2 = P_STREET.v((b[0] - nx, y, b[1] - nz), (0, 1, 0), (1, 1))
            i3 = P_STREET.v((a[0] - nx, y, a[1] - nz), (0, 1, 0), (0, 1))
            P_STREET.tri(i0, i1, i2)
            P_STREET.tri(i0, i2, i3)

# ---- 4. 建筑拉伸（优先用 Overpass 精细数据，缺失处回落到 z14）----
CHUNK_DIR = os.path.join(ROOT, 'assets', 'campus', '_src', 'pku_chunks')
MLON_C = 111320.0 * math.cos(math.radians(39.9895))
MLAT_C = 110574.0


def to_m(lon, lat):
    return ((lon - 116.31) * MLON_C, (lat - 39.9895) * MLAT_C)


def load_detailed():
    """读分块抓来的精细建筑：真实轮廓 + height/levels + 名称。"""
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
            pts = [to_m(float(p['lon']), float(p['lat'])) for p in geom]
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
det_union = None
if DET:
    polys = []
    for pts, h, nm in DET:
        try:
            g = Polygon(pts).buffer(0)
        except Exception:
            continue
        if g.is_empty:
            continue
        if g.geom_type == 'MultiPolygon':
            g = max(g.geoms, key=lambda x: x.area)
        polys.append(g)
    if polys:
        det_union = unary_union(polys)
print('精细建筑 %d 栋（覆盖 %.0f m²）' % (len(DET), det_union.area if det_union else 0))


def guess_h(area, known):
    if known:
        try:
            v = float(known)
            if v > 2:
                return max(4.0, min(90.0, v))
        except Exception:
            pass
    if area < 150:
        h = 10.0
    elif area < 450:
        h = 15.0
    elif area < 1200:
        h = 19.0
    elif area < 3000:
        h = 23.0
    else:
        h = 17.0
    return h


BLD_POLY = []


def emit_building(cs, h, seed_pts):
    try:
        BLD_POLY.append(Polygon(cs))
    except Exception:
        pass
    area = ring_area(cs)
    jitter = (hash(tuple(cs[:2])) % 1000) / 1000.0
    tint = 0.88 + 0.16 * jitter
    col = (tint, tint * (0.985 + 0.02 * jitter), tint * (0.94 + 0.05 * jitter))
    y0, y1 = -0.25, h
    n = len(cs)
    acc = 0.0
    for i in range(n):
        a, c = cs[i], cs[(i + 1) % n]
        L = seg_len(a, c)
        if L < 0.05:
            continue
        dx, dz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
        nx, nz = dz, -dx
        u0, u1 = acc / WALL_TEX_M, (acc + L) / WALL_TEX_M
        v0, v1 = 0.0, (y1 - y0) / WALL_TEX_M
        i0 = P_WALL.v((a[0], y0, a[1]), (nx, 0, nz), (u0, v0), col)
        i1 = P_WALL.v((c[0], y0, c[1]), (nx, 0, nz), (u1, v0), col)
        i2 = P_WALL.v((c[0], y1, c[1]), (nx, 0, nz), (u1, v1), col)
        i3 = P_WALL.v((a[0], y1, a[1]), (nx, 0, nz), (u0, v1), col)
        P_WALL.tri(i0, i1, i2)
        P_WALL.tri(i0, i2, i3)
        acc += L
    ids = [P_ROOF.v((p[0], y1, p[1]), (0, 1, 0), (p[0] * 0.05, p[1] * 0.05),
                    (0.62, 0.63, 0.64)) for p in cs]
    for a, bb, cc in tri_polygon(cs):
        P_ROOF.tri(ids[a], ids[cc], ids[bb])


def in_corridor(cs):
    for i in range(NSEG):
        a, b = ROUTE[i], ROUTE[(i + 1) % NSEG]
        if any(seg_dist(p, a, b) < CORRIDOR_CLEAR for p in cs):
            return True
    return False


kept, dropped = 0, 0
landmarks = []

LM_NAMES = ('博雅塔', '北京大学图书馆', '邱德拔体育馆', '百周年纪念讲堂')
for pts, h, nm in DET:
    cs = clean_poly(pts, 10.0)
    if not cs:
        continue
    if nm == '博雅塔':
        # 塔身交给 JS 生成（八角十三级），这里只记坐标，不拉伸成方盒子
        cx = sum(p[0] for p in cs) / len(cs)
        cy = sum(p[1] for p in cs) / len(cs)
        landmarks.append({'name': nm, 'x': round(cx, 1), 'z': round(-cy, 1), 'h': round(h or 31.0, 1)})
        continue
    if in_corridor(cs):
        dropped += 1
        continue
    hh = guess_h(ring_area(cs), h)
    emit_building(cs, hh, pts)
    kept += 1
    if nm in LM_NAMES:
        cx = sum(p[0] for p in cs) / len(cs)
        cy = sum(p[1] for p in cs) / len(cs)
        if not any(l['name'] == nm for l in landmarks):
            landmarks.append({'name': nm, 'x': round(cx, 1), 'z': round(-cy, 1), 'h': round(hh, 1)})

for b in D['building']:
    cs = clean_poly(b['p'], 12.0)
    if not cs:
        continue
    if in_corridor(cs):
        dropped += 1
        continue
    # 已被精细数据覆盖的，别重复摆一份
    if det_union is not None:
        try:
            g = Polygon(cs)
            if g.is_valid and g.area > 0 and det_union.intersection(g).area > g.area * 0.35:
                continue
        except Exception:
            pass
    emit_building(cs, guess_h(ring_area(cs), b.get('h')), None)
    kept += 1

print('建筑：保留 %d / 剔除 %d（走廊内）' % (kept, dropped))

# ---- 5. 行道树 ----
def tree_at(part, x, z, r):
    """超低模树：圆柱干 + 两个球冠。"""
    h = 4.2 * r
    seg = 5
    # 干
    for i in range(seg):
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * (i + 1) / seg
        p0 = (x + 0.16 * math.cos(a0), -0.1, z + 0.16 * math.sin(a0))
        p1 = (x + 0.16 * math.cos(a1), -0.1, z + 0.16 * math.sin(a1))
        p2 = (x + 0.12 * math.cos(a1), h * 0.55, z + 0.12 * math.sin(a1))
        p3 = (x + 0.12 * math.cos(a0), h * 0.55, z + 0.12 * math.sin(a0))
        i0 = part.v(p0, (math.cos(a0), 0, math.sin(a0)), (0, 0), (0.30, 0.24, 0.18))
        i1 = part.v(p1, (math.cos(a1), 0, math.sin(a1)), (1, 0), (0.30, 0.24, 0.18))
        i2 = part.v(p2, (math.cos(a1), 0, math.sin(a1)), (1, 1), (0.30, 0.24, 0.18))
        i3 = part.v(p3, (math.cos(a0), 0, math.sin(a0)), (0, 1), (0.30, 0.24, 0.18))
        part.tri(i0, i1, i2); part.tri(i0, i2, i3)
    # 树冠：两层八面体
    for li, (cy, rr) in enumerate([(h * 0.75, 1.35 * r), (h * 1.0, 0.95 * r)]):
        col = (0.28 + 0.06 * li, 0.44 + 0.07 * li, 0.24 + 0.05 * li)
        pts = [(x + rr, cy, z), (x - rr, cy, z), (x, cy, z + rr), (x, cy, z - rr),
               (x, cy + rr * 0.8, z), (x, cy - rr * 0.6, z)]
        idx = [part.v(p, (0, 1, 0), (0, 0), col) for p in pts]
        faces = [(4, 0, 2), (4, 2, 1), (4, 1, 3), (4, 3, 0),
                 (5, 2, 0), (5, 1, 2), (5, 3, 1), (5, 0, 3)]
        for f in faces:
            part.tri(idx[f[0]], idx[f[1]], idx[f[2]])


trees = 0
greens = [Polygon(g['p']).buffer(0) for g in D['green'] if len(g['p']) >= 3]
greens = [g for g in greens if g.is_valid and not g.is_empty and g.area > 120]
rng = np.random.default_rng(20261029)

from shapely.strtree import STRtree
BLD_TREE = STRtree(BLD_POLY) if BLD_POLY else None
BLD_BOXES = [p.bounds for p in BLD_POLY]


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


# 沿路行道树：校园里最多的一种元素，不放会显得特别空
for i in range(NSEG):
    a, b = ROUTE[i], ROUTE[(i + 1) % NSEG]
    L = seg_len(a, b)
    step = 13.0
    n = max(1, int(L / step))
    dx, dy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    nx, ny = -dy, dx
    for k in range(n):
        t = (k + 0.5) / n
        for side in (-1, 1):
            off = 9.2 + rng.random() * 3.4
            x = a[0] + (b[0] - a[0]) * t + nx * off * side
            z = a[1] + (b[1] - a[1]) * t + ny * off * side
            if near_route(x, z, 7.6):
                continue
            if on_building(x, z):
                continue
            tree_at(P_TREE, x, z, 0.9 + rng.random() * 0.55)
            trees += 1

# 绿地/湖边再撒一批
for g in greens:
    minx, miny, maxx, maxy = g.bounds
    if maxx - minx > 700 or maxy - miny > 700:
        continue
    cnt = min(34, int(g.area / 220))
    for _ in range(cnt):
        x = minx + rng.random() * (maxx - minx)
        z = miny + rng.random() * (maxy - miny)
        if not g.contains(Point(x, z)):
            continue
        if near_route(x, z, 7.6) or on_building(x, z):
            continue
        tree_at(P_TREE, x, z, 1.0 + rng.random() * 0.7)
        trees += 1
print('树：%d 棵' % trees)

# =====================================================================
#  GLB 导出
# =====================================================================
def s2l(v):
    """sRGB → 线性。glTF 的 baseColorFactor 是线性空间，按 sRGB 填会整片发白。"""
    out = []
    for c in v[:3]:
        out.append((c / 12.92) if c <= 0.04045 else (((c + 0.055) / 1.055) ** 2.4))
    return tuple(out) + tuple(v[3:])


MATS = {
    'ground': dict(color=(0.46, 0.56, 0.34, 1), rough=1.0, metal=0.0),
    'paved':  dict(color=(0.58, 0.57, 0.50, 1), rough=1.0, metal=0.0),
    'green':  dict(color=(0.40, 0.56, 0.28, 1), rough=1.0, metal=0.0),
    'water':  dict(color=(0.30, 0.56, 0.74, 1), rough=0.28, metal=0.0),
    'wall':   dict(color=(1, 1, 1, 1), rough=0.92, metal=0.0, tex=True),
    'roof':   dict(color=(0.55, 0.56, 0.58, 1), rough=0.96, metal=0.0),
    'road':   dict(color=(0.30, 0.31, 0.33, 1), rough=0.88, metal=0.0),
    'walk':   dict(color=(0.70, 0.67, 0.60, 1), rough=0.96, metal=0.0),
    'tree':   dict(color=(1, 1, 1, 1), rough=0.9, metal=0.0),
    'line':   dict(color=(0.94, 0.93, 0.86, 1), rough=0.7, metal=0.0),
    'street': dict(color=(0.44, 0.44, 0.45, 1), rough=0.95, metal=0.0),
}

wall_png = os.path.join(OUT_DIR, 'wall_tex.png')
make_wall_texture(wall_png)
wall_bytes = open(wall_png, 'rb').read()

bin_parts = []
views = []


def add_view(data, target=None):
    while len(bin_parts) and (sum(len(x) for x in bin_parts) % 4):
        bin_parts.append(b'\x00')
    off = sum(len(x) for x in bin_parts)
    bin_parts.append(data)
    v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
    if target:
        v['target'] = target
    views.append(v)
    return len(views) - 1


accessors = []
meshes = []
nodes = []
materials = []
mat_index = {}


def mat_json(name):
    m = MATS[name]
    j = {
        'name': name,
        'pbrMetallicRoughness': {
            'baseColorFactor': list(s2l(m['color'])),
            'metallicFactor': m['metal'],
            'roughnessFactor': m['rough'],
        },
        'doubleSided': False,
    }
    return j


tex_index = None
images = []

for name, P in parts.items():
    pass

ORDER = ['ground', 'paved', 'green', 'water', 'street', 'road', 'walk', 'line', 'wall', 'roof', 'tree']
for name in ORDER:
    P = {'ground': P_GROUND, 'paved': P_UNI, 'green': P_GREEN, 'water': P_WATER, 'street': P_STREET,
         'road': P_ROAD, 'walk': P_WALK, 'line': P_LINE, 'wall': P_WALL, 'roof': P_ROOF,
         'tree': P_TREE}[name]
    if not P.idx:
        continue
    pos = np.asarray(P.pos, dtype=np.float32)
    nrm = np.asarray(P.nrm, dtype=np.float32)
    uv = np.asarray(P.uv, dtype=np.float32)
    col = np.asarray(P.col, dtype=np.float32)
    idx = np.asarray(P.idx, dtype=np.uint32).reshape(-1)
    # plate 的 +y（北）要映射到 three 的 -z，否则校园会左右镜像。
    # 镜像会翻转三角形环绕方向，所以 z 取负后必须把每个三角形的 b/c 换回来。
    pos[:, 2] *= -1.0
    nrm[:, 2] *= -1.0
    idx = idx.reshape(-1, 3)[:, [0, 2, 1]].reshape(-1)

    pv = add_view(pos.tobytes(), 34962)
    nv = add_view(nrm.tobytes(), 34962)
    uv_v = add_view(uv.tobytes(), 34962)
    cv = add_view(col.tobytes(), 34962)
    iv = add_view(idx.tobytes(), 34963)

    mn = pos.min(axis=0).tolist()
    mx = pos.max(axis=0).tolist()
    a_pos = len(accessors)
    accessors.append({'bufferView': pv, 'componentType': 5126, 'count': len(pos),
                      'type': 'VEC3', 'min': mn, 'max': mx})
    a_nrm = len(accessors)
    accessors.append({'bufferView': nv, 'componentType': 5126, 'count': len(nrm), 'type': 'VEC3'})
    a_uv = len(accessors)
    accessors.append({'bufferView': uv_v, 'componentType': 5126, 'count': len(uv), 'type': 'VEC2'})
    a_col = len(accessors)
    accessors.append({'bufferView': cv, 'componentType': 5126, 'count': len(col), 'type': 'VEC3'})
    a_idx = len(accessors)
    accessors.append({'bufferView': iv, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'})

    attrs = {'POSITION': a_pos, 'NORMAL': a_nrm, 'TEXCOORD_0': a_uv, 'COLOR_0': a_col}
    mj = mat_json(name)
    mat_index[name] = len(materials)
    materials.append(mj)
    meshes.append({'name': name, 'primitives': [
        {'attributes': attrs, 'indices': a_idx, 'material': mat_index[name], 'mode': 4}]})
    nodes.append({'name': name, 'mesh': len(meshes) - 1})
    print('  %-7s verts=%7d tris=%7d' % (name, len(pos), len(idx) // 3))

# 墙贴图
img_view = add_view(wall_bytes)
images.append({'bufferView': img_view, 'mimeType': 'image/png', 'name': 'wall'})
samplers = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
textures = [{'sampler': 0, 'source': 0}]
materials[mat_index['wall']]['pbrMetallicRoughness']['baseColorTexture'] = {'index': 0}
# 贴图需要 TEXCOORD v 方向：glTF 的 v 向下，这里直接用，窗格上下对称看不出差别

blob = b''.join(bin_parts)
while len(blob) % 4:
    blob += b'\x00'

gltf = {
    'asset': {'version': '2.0', 'generator': 'pku-campus-plate'},
    'scene': 0,
    'scenes': [{'nodes': list(range(len(nodes)))}],
    'nodes': nodes,
    'meshes': meshes,
    'materials': materials,
    'accessors': accessors,
    'bufferViews': views,
    'buffers': [{'byteLength': len(blob)}],
    'images': images,
    'samplers': samplers,
    'textures': textures,
}
js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
while len(js) % 4:
    js += b' '

glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
glb += struct.pack('<II', len(js), 0x4E4F534A) + js
glb += struct.pack('<II', len(blob), 0x004E4942) + blob
out = os.path.join(OUT_DIR, 'beida-campus.glb')
open(out, 'wb').write(glb)
print('\n写出 %s  %.2f MB' % (out, len(glb) / 1048576))

# 路线数据给游戏
route_js = {
    'pts': [[round(x, 2), round(-z, 2)] for x, z in ROUTE],
    'length': round(ROUTE_LEN, 2),
    'roadHalf': ROAD_HALF,
    'landmarks': landmarks,
}
open(os.path.join(OUT_DIR, 'campus_route.json'), 'w', encoding='utf-8').write(
    json.dumps(route_js, ensure_ascii=False, indent=1))
print('写出 campus_route.json  %d 个拐点  总长 %.1f m' % (len(ROUTE), ROUTE_LEN))
