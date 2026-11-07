# -*- coding: utf-8 -*-
"""
make-test-landmark.py —— 生成一个测试用的地标 GLB，用来验证接入管线

不是给玩家看的，只用来证明下面这条链是通的：
    GLTFLoader 加载 → 归一化（底面贴地/按 54m 缩放/超宽收缩）→ 材质按名字分类并注入发光
    → 放进 324m 循环的槽位 → 街道版与终点环上版都能显示

生成的造型是「三段收分方塔 + 一圈霓虹腰线」，故意用三个材质名
（tower_mass / window_cool / neon_line），覆盖接入层的三条分支。

用法：
    python tools/make-test-landmark.py            # 写到 assets/landmarks/pearl.glb
    python tools/make-test-landmark.py --out xxx.glb
"""
import io
import json
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def box_verts(w, h, d):
    """返回 (positions, normals, indices)，每面独立顶点（法线不共享）。"""
    hw, hh, hd = w / 2.0, h / 2.0, d / 2.0
    faces = [
        ((0, 0, 1),  [(-hw, -hh, hd), (hw, -hh, hd), (hw, hh, hd), (-hw, hh, hd)]),
        ((0, 0, -1), [(hw, -hh, -hd), (-hw, -hh, -hd), (-hw, hh, -hd), (hw, hh, -hd)]),
        ((1, 0, 0),  [(hw, -hh, hd), (hw, -hh, -hd), (hw, hh, -hd), (hw, hh, hd)]),
        ((-1, 0, 0), [(-hw, -hh, -hd), (-hw, -hh, hd), (-hw, hh, hd), (-hw, hh, -hd)]),
        ((0, 1, 0),  [(-hw, hh, hd), (hw, hh, hd), (hw, hh, -hd), (-hw, hh, -hd)]),
        ((0, -1, 0), [(-hw, -hh, -hd), (hw, -hh, -hd), (hw, -hh, hd), (-hw, -hh, hd)]),
    ]
    pos, nor, idx = [], [], []
    for n, quad in faces:
        base = len(pos)
        for v in quad:
            pos.append(v)
            nor.append(n)
        idx += [base, base + 1, base + 2, base, base + 2, base + 3]
    return pos, nor, idx


def build_glb(parts):
    """
    parts: [(w, h, d, y_center, material_index), ...]
    返回 GLB 字节流。
    """
    buf = bytearray()
    accessors, views, meshes, nodes = [], [], [], []

    def add_accessor(data, comp_type, type_str, target, minmax=False):
        nonlocal buf
        while len(buf) % 4:
            buf.append(0)
        offset = len(buf)
        if comp_type == 5126:      # float
            raw = b''.join(struct.pack('<f', x) for x in data)
        else:                       # uint16 / uint32
            fmt = '<H' if comp_type == 5123 else '<I'
            raw = b''.join(struct.pack(fmt, x) for x in data)
        buf += raw
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(raw), 'target': target})
        acc = {'bufferView': len(views) - 1, 'componentType': comp_type,
               'count': len(data) // (3 if type_str == 'VEC3' else 1), 'type': type_str}
        if minmax:
            if type_str == 'VEC3':
                acc['min'] = [min(data[i::3]) for i in range(3)]
                acc['max'] = [max(data[i::3]) for i in range(3)]
            else:
                acc['min'] = [min(data)]
                acc['max'] = [max(data)]
        accessors.append(acc)
        return len(accessors) - 1

    for (w, h, d, yc, mat) in parts:
        pos, nor, idx = box_verts(w, h, d)
        pos = [v for p in pos for v in p]
        nor = [v for n in nor for v in n]
        # 平移到 y 中心
        for i in range(1, len(pos), 3):
            pos[i] += yc
        a_pos = add_accessor(pos, 5126, 'VEC3', 34962, minmax=True)
        a_nor = add_accessor(nor, 5126, 'VEC3', 34962)
        a_idx = add_accessor(idx, 5123, 'SCALAR', 34963)
        meshes.append({'primitives': [{
            'attributes': {'POSITION': a_pos, 'NORMAL': a_nor},
            'indices': a_idx, 'material': mat,
        }]})
        nodes.append({'mesh': len(meshes) - 1})

    while len(buf) % 4:
        buf.append(0)

    gltf = {
        'asset': {'version': '2.0', 'generator': 'make-test-landmark.py'},
        'scene': 0,
        'scenes': [{'nodes': list(range(len(nodes)))}],
        'nodes': nodes,
        'meshes': meshes,
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': len(buf)}],
        'materials': [
            {'name': 'tower_mass', 'pbrMetallicRoughness': {
                'baseColorFactor': [0.11, 0.16, 0.23, 1],
                'metallicFactor': 0.35, 'roughnessFactor': 0.62}},
            {'name': 'window_cool', 'pbrMetallicRoughness': {
                'baseColorFactor': [0.09, 0.13, 0.17, 1],
                'metallicFactor': 0.35, 'roughnessFactor': 0.42}},
            {'name': 'neon_line', 'pbrMetallicRoughness': {
                'baseColorFactor': [0.0, 0.92, 1.0, 1],
                'metallicFactor': 0.0, 'roughnessFactor': 0.5}},
        ],
    }

    jraw = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    while len(jraw) % 4:
        jraw += b' '
    out = bytearray()
    out += struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jraw) + 8 + len(buf))
    out += struct.pack('<II', len(jraw), 0x4E4F534A) + jraw
    out += struct.pack('<II', len(buf), 0x004E4942) + bytes(buf)
    return bytes(out)


# 三段收分方塔：底 13m → 中 10m → 上 7m，总高 54m（正好等于接入层的 TARGET_H）
parts = [
    (13.0, 20.0, 13.0, 10.0, 0),    # 下段 0~20
    (10.0, 18.0, 10.0, 29.0, 1),    # 中段 20~38（窗格材质）
    (7.0, 16.0, 7.0, 46.0, 0),      # 上段 38~54
    (13.6, 0.5, 13.6, 20.0, 2),     # 腰线 1（霓虹）
    (10.6, 0.5, 10.6, 38.0, 2),     # 腰线 2（霓虹）
]

out_path = os.path.join(ROOT, 'assets', 'landmarks', 'pearl.glb')
args = sys.argv[1:]
for i, a in enumerate(args):
    if a == '--out' and i + 1 < len(args):
        out_path = args[i + 1]

os.makedirs(os.path.dirname(out_path), exist_ok=True)
data = build_glb(parts)
io.open(out_path, 'wb').write(data)
print('已生成 %s（%.1f KB，%d 个 mesh）' % (out_path, len(data) / 1024, len(parts)))
