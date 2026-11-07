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

BASE = [(-1120, -740), (140, -740), (140, 900), (-1120, 900)]
P['ground'].poly_flat(BASE, -0.55, (1.0, 1.0, 1.0), uv_scale=1 / 8.0)

# 分层高度（越大越靠上）。层与层之间至少留 5cm：
# 相机 near=0.1 / far=230，24 位深度在 200m 处的精度只有 ~5cm，
# 靠得太近的两层就会出现「一会这个一会那个」的深度冲突。
# 顺序也要对：水面必须在草地「之下」，不然湖会浮在岸上。
Y_GROUND, Y_WATER, Y_GREEN, Y_PAVED, Y_STREET = -0.55, -0.36, -0.28, -0.24, -0.16

PLAZA = ('pitch', 'track', 'stadium', 'playground', 'recreation_ground')
paved_polys = []
for g in D['ground']:
    if g.get('cls') in PLAZA:
        cs = clean_poly(g['p'], 40.0)
        if cs:
            P['paved'].poly_flat(cs, Y_PAVED, (1.0, 1.0, 1.0), uv_scale=1 / 8.0)
            paved_polys.append(Polygon(cs))

WATER_DETAIL = os.path.normpath(os.path.join(HERE, '..', '..', 'assets', 'campus', '_src', 'water_detailed.json'))
WATER_REL = os.path.normpath(os.path.join(HERE, '..', '..', 'assets', 'campus', '_src', 'water_relation.json'))

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
for cs, inners in water_items:
    P['water'].poly_flat(cs, Y_WATER, (1.0, 1.0, 1.0), uv_scale=1 / 40.0)
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


# 沿岸 3.8m 草带：中间探进水面 2.2m，把水网格边缘的碎角盖住，
# 可见的岸线就变成草带的边——比水面的三角边界干净得多。
for cs, inners in water_items:
    ring_band(P['green'], cs, -2.2, 1.6, Y_GREEN, (0.97, 1.0, 0.93))
print('沿岸草带 %d 圈' % len(water_items))


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
    n = len(pts)
    out = []
    for i in range(n):
        a, b = pts[i - 1], pts[(i + 1) % n]
        ux, uz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(ux, uz) or 1
        out.append((pts[i][0] - uz / L * off, pts[i][1] + ux / L * off))
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

