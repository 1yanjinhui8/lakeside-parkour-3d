# -*- coding: utf-8 -*-
"""把校园底板 GLB 转成带贴图的 OBJ + MTL + PNG。

为什么不用之前那份 OBJ：那版是「轮廓 + 高度」直接拉伸，没有 UV、没有贴图，
685 栋楼共用一个 0.80 的灰材质，所以颜色全都一样。
底板 GLB 里每段墙都有 UV（按 3.6m 层高 / 3.8m 开间对齐）和 4 套立面贴图，
这里原样转出来，几何和游戏里完全一致。

用法：
    python tools/campus-src/glb-to-obj.py 输出目录 名字 [--skip line,street]
"""
import json
import os
import shutil
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GLB = os.path.join(ROOT, 'assets', 'campus', 'beida-campus.glb')

argv = [a for a in sys.argv[1:] if not a.startswith('--')]
OUT_DIR = os.path.abspath(argv[0]) if argv else os.path.join(ROOT, 'out')
NAME = argv[1] if len(argv) > 1 else '北京大学'
SKIP = set()
for a in sys.argv[1:]:
    if a.startswith('--skip'):
        SKIP = set((a.split('=', 1)[1] if '=' in a else '').split(','))
        SKIP = {s for s in SKIP if s}

os.makedirs(OUT_DIR, exist_ok=True)
TEX_DIR = os.path.join(OUT_DIR, 'tex')
os.makedirs(TEX_DIR, exist_ok=True)

raw = open(GLB, 'rb').read()
off = 12
chunks = {}
while off < len(raw):
    ln, ty = struct.unpack('<II', raw[off:off + 8])
    chunks[ty] = raw[off + 8: off + 8 + ln]
    off += 8 + ln
G = json.loads(chunks[0x4E4F534A].decode('utf-8'))
BIN = chunks[0x004E4942]

ACC = G['accessors']
BV = G['bufferViews']
CT = {5126: ('f', 4), 5125: ('I', 4), 5123: ('H', 2), 5121: ('B', 1)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read_acc(i):
    a = ACC[i]
    bv = BV[a['bufferView']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    fmt, size = CT[a['componentType']]
    n = a['count']
    nc = NC[a['type']]
    stride = bv.get('byteStride') or size * nc
    if stride == size * nc:
        # 紧凑排列：一次性解包，比逐元素快一个数量级
        vals = struct.unpack_from('<' + fmt * (n * nc), BIN, start)
        return [vals[k * nc:(k + 1) * nc] for k in range(n)]
    return [struct.unpack_from('<' + fmt * nc, BIN, start + k * stride) for k in range(n)]


def srgb(c):
    """glTF 的 baseColorFactor 是线性空间，MTL 的 Kd 按 sRGB 理解，转回去。"""
    out = []
    for v in c[:3]:
        out.append(v * 12.92 if v <= 0.0031308 else 1.055 * (v ** (1 / 2.4)) - 0.055)
    return out


# ---- 贴图落地 ----
tex_files = {}
for i, img in enumerate(G.get('images', [])):
    bv = BV[img['bufferView']]
    data = BIN[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
    ext = '.png' if img.get('mimeType', '').endswith('png') else '.jpg'
    fn = 'tex_%s%s' % (img.get('name') or ('img%d' % i), ext)
    open(os.path.join(TEX_DIR, fn), 'wb').write(data)
    tex_files[i] = fn
print('贴图 %d 张 -> %s' % (len(tex_files), TEX_DIR))

mat_tex = {}
for mi, m in enumerate(G.get('materials', [])):
    pbr = m.get('pbrMetallicRoughness') or {}
    bct = pbr.get('baseColorTexture')
    if bct:
        mat_tex[mi] = tex_files[bct['index']]

# ---- 顶点色平均 ----
# OBJ/MTL 没有顶点色通道，而底板里树冠的绿、墙面的随机深浅全靠 COLOR_0。
# 不处理的话树会变成白色（Kd 是 1,1,1）。这里把每个材质的平均顶点色乘进 Kd。
mat_col = {}
for mesh in G['meshes']:
    for prim in mesh['primitives']:
        mi = prim.get('material')
        if mi is None or 'COLOR_0' not in prim['attributes']:
            continue
        name = G['materials'][mi]['name']
        cols = read_acc(prim['attributes']['COLOR_0'])
        acc = mat_col.setdefault(name, [0.0, 0.0, 0.0, 0])
        for c in cols:
            acc[0] += c[0]
            acc[1] += c[1]
            acc[2] += c[2]
            acc[3] += 1
for name, a in mat_col.items():
    n = max(1, a[3])
    mat_col[name] = (a[0] / n, a[1] / n, a[2] / n)
print('顶点色均值：', {k: tuple(round(v, 2) for v in c) for k, c in list(mat_col.items())[:4]}, '...')

# ---- MTL ----
mtl = ['# %s 材质（由 tools/campus-src/glb-to-obj.py 生成）' % NAME,
       '# 贴图在 tex/ 目录；UV 是按 3.6m 层高 / 3.8m 开间排的，贴图需设为 Repeat 平铺',
       '']
for m in G.get('materials', []):
    name = m.get('name', 'mat')
    pbr = m.get('pbrMetallicRoughness') or {}
    base = pbr.get('baseColorFactor', [1, 1, 1, 1])
    tint = mat_col.get(name)
    lin = [base[i] * (tint[i] if tint else 1.0) for i in range(3)]
    kd = srgb(lin + [1.0])
    rough = pbr.get('roughnessFactor', 1.0)
    metal = pbr.get('metallicFactor', 0.0)
    mi = G['materials'].index(m)
    mtl += ['newmtl %s' % name,
            'Kd %.4f %.4f %.4f' % tuple(kd),
            'Ka %.4f %.4f %.4f' % tuple(c * 0.6 for c in kd),
            'Ks %.4f %.4f %.4f' % (metal, metal, metal),
            'Ns %.1f' % max(1.0, (1.0 - rough) * 200.0),
            'illum 2',
            'd 1.0']
    if mi in mat_tex:
        mtl.append('map_Kd tex/%s' % mat_tex[mi])
    mtl.append('')
open(os.path.join(OUT_DIR, NAME + '.mtl'), 'w', encoding='utf-8', newline='\n').write('\n'.join(mtl))

# ---- OBJ ----
blocks = []            # 每个图元一块：o/usemtl + 自己的 v/vt/vn + f
vbase = vtbase = vnbase = 0
stats = []


def walk(ni, parent=None):
    global vbase, vtbase, vnbase
    n = G['nodes'][ni]
    if 'mesh' in n and not n.get('matrix') and not n.get('translation') and not n.get('rotation') and not n.get('scale'):
        mesh = G['meshes'][n['mesh']]
        for prim in mesh['primitives']:
            mi = prim.get('material')
            mname = G['materials'][mi]['name'] if mi is not None else 'default'
            if mname in SKIP:
                continue
            pos = read_acc(prim['attributes']['POSITION'])
            nrm = read_acc(prim['attributes']['NORMAL']) if 'NORMAL' in prim['attributes'] else None
            uv = read_acc(prim['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in prim['attributes'] else None
            idx = [v[0] for v in read_acc(prim['indices'])]

            # OBJ 是「遇到 o 就开新对象、遇到 usemtl 就切材质」的流式解析：
            # 必须把 o / usemtl / v / vt / vn / f 挨着写，否则面片会全归到最后一个对象上，
            # OBJLoader 就会把它们合成"一个网格 + 材质数组"，贴图也就挂不上了。
            buf = ['o %s_%s' % (NAME, mname), 'usemtl %s' % mname]
            for p in pos:
                buf.append('v %.4f %.4f %.4f' % (p[0], p[1], p[2]))
            if uv:
                # glTF 的 v=0 在图像顶部，OBJ 的 v=0 在底部
                for t in uv:
                    buf.append('vt %.5f %.5f' % (t[0], 1.0 - t[1]))
            if nrm:
                for q in nrm:
                    buf.append('vn %.4f %.4f %.4f' % (q[0], q[1], q[2]))

            use_uv = uv is not None
            use_n = nrm is not None
            for k in range(0, len(idx) - 2, 3):
                tri = []
                for t in range(3):
                    vi = idx[k + t] + 1 + vbase
                    if use_uv and use_n:
                        tri.append('%d/%d/%d' % (vi, idx[k + t] + 1 + vtbase, idx[k + t] + 1 + vnbase))
                    elif use_uv:
                        tri.append('%d/%d' % (vi, idx[k + t] + 1 + vtbase))
                    elif use_n:
                        tri.append('%d//%d' % (vi, idx[k + t] + 1 + vnbase))
                    else:
                        tri.append('%d' % vi)
                buf.append('f ' + ' '.join(tri))
            blocks.append('\n'.join(buf))
            stats.append((mname, len(pos), len(idx) // 3, 'vt' if use_uv else '  '))
            vbase += len(pos)
            if uv:
                vtbase += len(uv)
            if nrm:
                vnbase += len(nrm)
    for c in n.get('children', []):
        walk(c, n)


for ni in G['scenes'][G.get('scene', 0)]['nodes']:
    walk(ni)

header = [
    '# %s 燕园主校区 三维模型（带贴图版）' % NAME,
    '# 数据来源: OpenStreetMap（z14 矢量瓦片 + Overpass 精细建筑 + 未名湖 relation）',
    '# 单位: 米 | 坐标: y 向上，-z 为北 | 原点: lon 116.31 lat 39.9895',
    '# 贴图: tex/ 目录，UV 已按层高/开间排好，Repeat 平铺',
    'mtllib %s.mtl' % NAME,
    '',
]
open(os.path.join(OUT_DIR, NAME + '.obj'), 'w', encoding='utf-8', newline='\n').write(
    '\n'.join(header + blocks) + '\n')

print('\n%-10s %8s %8s  %s' % ('材质', '顶点', '三角面', 'UV'))
for m, nv, nf, h in stats:
    print('%-10s %8d %8d  %s' % (m, nv, nf, h))
size = os.path.getsize(os.path.join(OUT_DIR, NAME + '.obj'))
print('\n写出 %s（%.1f MB）' % (NAME + '.obj', size / 1048576))
print('写出 %s.mtl，贴图目录 tex/' % NAME)
