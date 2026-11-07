# -*- coding: utf-8 -*-
"""从两块校园底板 GLB 里提取行道树的树干中心，生成 js/campus-trees.js。

底板树是 build-campus-plate.py 的 tree_at() 生成的：圆柱干底面一圈顶点
固定在 y = -0.1、半径 0.16m。取这些顶点按 1m 网格聚类求均值，即每棵树的
(x, z)。只存坐标，半径由主模块统一给（避免每棵树单独存半径、数据变大）。

用法： "D:/PythonAPPS/python386/python.exe" tools/gen-campus-trees.py
"""
import io, json, os, struct
from array import array
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETS = [
    ('campus', 'assets/campus/beida-campus.glb'),
    ('campus2', 'assets/campus2/bmu-campus.glb'),
]
DT = {5126: ('f', 4), 5125: ('I', 4), 5123: ('H', 2), 5121: ('B', 1)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def load_glb(path):
    raw = open(path, 'rb').read()
    off, chunks = 12, {}
    while off < len(raw):
        clen, ctype = struct.unpack('<II', raw[off:off + 8])
        chunks[ctype] = raw[off + 8:off + 8 + clen]
        off += 8 + clen
    return json.loads(chunks[0x4E4F534A].decode('utf-8')), chunks[0x004E4942]


def read_pos(gltf, BIN, i):
    a = gltf['accessors'][i]
    bv = gltf['bufferViews'][a['bufferView']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n, nc = a['count'], NC[a['type']]
    code, sz = DT[a['componentType']]
    stride = bv.get('byteStride') or sz * nc
    arr = array(code)
    if stride == sz * nc:
        arr.frombytes(BIN[start:start + n * nc * sz])
    else:
        for k in range(n):
            arr.frombytes(BIN[start + k * stride:start + k * stride + sz * nc])
    return arr, nc


def tree_centers(path):
    gltf, BIN = load_glb(path)
    mi = [i for i, m in enumerate(gltf.get('materials', [])) if m.get('name') == 'tree']
    assert mi, '找不到 tree 材质：' + path
    mi = mi[0]
    buckets = defaultdict(list)
    for mesh in gltf['meshes']:
        for prim in mesh['primitives']:
            if prim.get('material') != mi:
                continue
            pos, nc = read_pos(gltf, BIN, prim['attributes']['POSITION'])
            for k in range(len(pos) // nc):
                x, y, z = pos[k * nc], pos[k * nc + 1], pos[k * nc + 2]
                if -0.18 <= y <= -0.02:            # 树干底面那一圈
                    buckets[(int(x // 1.0), int(z // 1.0))].append((x, z))
    # 每格一个中心，再合并跨格的同一棵树（相邻格中心距离 < 0.9m）
    raw = []
    for (gx, gz), pts in buckets.items():
        raw.append([sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts), len(pts)])
    merged = []
    for x, z, w in raw:
        for c in merged:
            if abs(x - c[0]) < 0.9 and abs(z - c[1]) < 0.9:
                t = c[2] + w
                c[0] = (c[0] * c[2] + x * w) / t
                c[1] = (c[1] * c[2] + z * w) / t
                c[2] = t
                break
        else:
            merged.append([x, z, w])
    return sorted([[round(c[0], 1), round(c[1], 1)] for c in merged])


out = {}
for key, rel in SETS:
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        out[key] = []
        continue
    out[key] = tree_centers(p)
    print('%s: %d 棵树' % (key, len(out[key])))

js = ('// 由 tools/gen-campus-trees.py 生成：底板行道树树干中心 [x,z]（底板坐标）\n'
      '// 给主模块做撞树判定用；半径在 art.js 的 registerTree 里统一给。\n'
      'const PLATE_TREES = ' + json.dumps(out, separators=(',', ':')) + ';\n')
dst = os.path.join(ROOT, 'js', 'campus-trees.js')
io.open(dst, 'w', encoding='utf-8', newline='').write(js)
print('js/campus-trees.js %d KB' % (len(js) // 1024))
