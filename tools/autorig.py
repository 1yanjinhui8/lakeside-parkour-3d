# -*- coding: utf-8 -*-
"""
给没有骨骼的 Tripo 模型自动绑骨（v2）
- 先把网格节点的缩放/位移烘进顶点，节点归零，避免 skin 空间混乱
- 自动判断「左右轴」和「前后轴」（按水平方向的包围盒宽度）
- 按人体比例生成 Mixamo 命名骨架 + 线段距离蒙皮权重
用法: python autorig2.py <输入.glb> <输出.glb>
"""
import struct, json, sys
import numpy as np

COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
NP = {'<f4': 5126, '<u1': 5121, '<i2': 5122, '<u2': 5123, '<u4': 5125}


def read_glb(path):
    d = open(path, 'rb').read()
    magic, ver, _ = struct.unpack('<4sII', d[:12])
    assert magic == b'glTF'
    off, js, bin_ = 12, None, b''
    while off < len(d):
        clen, ctype = struct.unpack('<II', d[off:off + 8])
        chunk = d[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            bin_ = bytearray(chunk)
        off += 8 + clen
    return js, bin_


def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = bytes(bin_) + b'\x00' * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bb)
    out = bytearray(struct.pack('<4sII', b'glTF', 2, total))
    out += struct.pack('<II', len(jb), 0x4E4F534A) + jb
    out += struct.pack('<II', len(bb), 0x004E4942) + bb
    open(path, 'wb').write(out)


def acc_info(js, bin_, idx):
    a = js['accessors'][idx]
    bv = js['bufferViews'][a['bufferView']]
    fmt, size = COMP[a['componentType']]
    n = NCOMP[a['type']]
    dt = np.dtype('<' + fmt)
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or size * n
    if stride == size * n:
        arr = np.frombuffer(bytes(bin_), dtype=dt, count=a['count'] * n, offset=start).reshape(a['count'], n)
    else:
        arr = np.empty((a['count'], n), dt)
        for i in range(a['count']):
            arr[i] = struct.unpack_from('<' + fmt * n, bin_, start + i * stride)
    return arr, bv, start, stride, a


def read_acc(js, bin_, idx):
    arr, *_ = acc_info(js, bin_, idx)
    return arr.astype(np.float64)


def write_acc(js, bin_, idx, values):
    """原地覆盖 accessor 数据（要求布局连续）"""
    arr, bv, start, stride, a = acc_info(js, bin_, idx)
    dtype = arr.dtype
    values = np.ascontiguousarray(values.astype(dtype))
    n = NCOMP[a['type']]
    if stride == dtype.itemsize * n:
        raw = values.tobytes()
        bin_[start:start + len(raw)] = raw
    else:
        for i in range(len(values)):
            struct.pack_into('<' + 'f' * n, bin_, start + i * stride, *values[i])
    # 更新 min/max（POSITION 需要）
    if 'min' in a:
        a['min'] = [float(x) for x in values.min(axis=0)]
        a['max'] = [float(x) for x in values.max(axis=0)]


def append_acc(js, bin_, arr, ctype, typ, extras=None):
    fmt, size = COMP[ctype]
    n = NCOMP[typ]
    arr = np.ascontiguousarray(arr)
    data = arr.astype(np.dtype('<' + fmt)).tobytes()
    bin_.extend(b'\x00' * ((4 - len(bin_) % 4) % 4))
    bv = {'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(data)}
    bin_.extend(data)
    js['bufferViews'].append(bv)
    acc = {'bufferView': len(js['bufferViews']) - 1, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
    if extras:
        acc.update(extras)
    js['accessors'].append(acc)
    js['buffers'][0]['byteLength'] = len(bin_)
    return len(js['accessors']) - 1


def seg_dist(p, a, b):
    ab = b - a
    L2 = float(ab @ ab)
    if L2 < 1e-12:
        return np.linalg.norm(p - a, axis=1)
    t = np.clip(((p - a) @ ab) / L2, 0.0, 1.0)[:, None]
    return np.linalg.norm(p - (a[None, :] + t * ab[None, :]), axis=1)


def is_arm(n):
    return n.endswith('Arm') or n.endswith('ForeArm') or n.endswith('Hand')


def main(src, dst):
    js, bin_ = read_glb(src)
    # ---------- 1. 把网格节点变换烘进顶点 ----------
    prims = []      # (prim, nodeIdx, positions)
    for ni, node in enumerate(js['nodes']):
        if 'mesh' not in node:
            continue
        scale = node.get('scale', [1, 1, 1])
        trans = node.get('translation', [0, 0, 0])
        rot = node.get('rotation', None)
        mesh = js['meshes'][node['mesh']]
        for prim in mesh['primitives']:
            pa = prim['attributes']['POSITION']
            pts = read_acc(js, bin_, pa)[:, :3]
            pts = pts * np.array(scale, float)[None, :]
            if rot:
                x, y, z, w = rot
                R = np.array([
                    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
                ])
                pts = pts @ R.T
            pts = pts + np.array(trans, float)[None, :]
            write_acc(js, bin_, pa, pts)
            prims.append((prim, ni, pts))
        node['scale'] = [1, 1, 1]
        node['translation'] = [0, 0, 0]
        node.pop('rotation', None)
        if 'matrix' in node:
            node.pop('matrix')

    pts_all = np.vstack([p for _, _, p in prims])
    ymin, ymax = pts_all[:, 1].min(), pts_all[:, 1].max()
    H = ymax - ymin
    # ---------- 2. 判断水平轴：宽的是左右，窄的是前后 ----------
    exts = [pts_all[:, 0].max() - pts_all[:, 0].min(), pts_all[:, 2].max() - pts_all[:, 2].min()]
    side_axis = 2 if exts[1] > exts[0] else 0
    front_axis = 0 if side_axis == 2 else 2
    def to_canon(p):
        c = np.empty_like(p)
        c[:, 0] = p[:, side_axis]
        c[:, 1] = p[:, 1]
        c[:, 2] = p[:, front_axis]
        return c
    def from_canon(c):
        m = np.zeros(3)
        m[side_axis] = c[0]
        m[1] = c[1]
        m[front_axis] = c[2]
        return m
    C = to_canon(pts_all)
    print('高度 %.3f，左右轴=%s，前后轴=%s' % (H, 'xyz'[side_axis], 'xyz'[front_axis]))

    zmin_c, zmax_c = C[:, 2].min(), C[:, 2].max()
    cx = 0.0
    def Y(f):
        return ymin + f * H

    def band(f, tol):
        m = np.abs(C[:, 1] - Y(f)) < tol * H
        return C[m]

    b_leg = band(0.30, 0.03)
    legLx = float(np.median(b_leg[b_leg[:, 0] < cx][:, 0])) if (b_leg[:, 0] < cx).sum() > 20 else -0.05 * H
    legRx = float(np.median(b_leg[b_leg[:, 0] > cx][:, 0])) if (b_leg[:, 0] > cx).sum() > 20 else 0.05 * H
    b_mid = band(0.63, 0.04); b_top = band(0.775, 0.03); b_low = band(0.48, 0.035)
    def outer(b, side):
        vals = b[:, 0]
        return (vals.min() if side < 0 else vals.max()) if len(vals) else None
    armLx_s = (outer(b_top, -1) + 0.018 * H) if len(b_top) else -0.085 * H
    armRx_s = (outer(b_top, 1) - 0.018 * H) if len(b_top) else 0.085 * H
    armLx_e = (outer(b_mid, -1) + 0.012 * H) if len(b_mid) else -0.1 * H
    armRx_e = (outer(b_mid, 1) - 0.012 * H) if len(b_mid) else 0.1 * H
    armLx_w = (outer(b_low, -1) + 0.015 * H) if len(b_low) else -0.11 * H
    armRx_w = (outer(b_low, 1) - 0.015 * H) if len(b_low) else 0.11 * H
    print('腿 x: %.3f / %.3f | 肩 %.3f/%.3f 肘 %.3f/%.3f 腕 %.3f/%.3f' % (
        legLx, legRx, armLx_s, armRx_s, armLx_e, armRx_e, armLx_w, armRx_w))

    # ---------- 3. 骨架（canonical 坐标） ----------
    B = []
    def bone(name, parent, head_c, tail_c):
        hc = np.array(head_c, float); tc = np.array(tail_c, float)
        B.append(dict(name=name, parent=parent, head=from_canon(hc), tail=from_canon(tc), head_c=hc, tail_c=tc))
    hips = Y(0.52)
    bone('Hips', None, (cx, hips, 0), (cx, Y(0.60), 0))
    bone('Spine', 'Hips', (cx, Y(0.60), 0), (cx, Y(0.70), 0))
    bone('Spine1', 'Spine', (cx, Y(0.70), 0), (cx, Y(0.79), 0))
    bone('Neck', 'Spine1', (cx, Y(0.79), 0), (cx, Y(0.845), 0))
    bone('Head', 'Neck', (cx, Y(0.845), 0), (cx, Y(0.98), 0))
    for side, lx, axs, axe, axw in (('Left', legLx, armLx_s, armLx_e, armLx_w), ('Right', legRx, armRx_s, armRx_e, armRx_w)):
        up = side + 'UpLeg'
        lo = side + 'Leg'
        bone(up, 'Hips', (lx, hips, 0), (lx, Y(0.28), 0))
        bone(lo, up, (lx, Y(0.28), 0), (lx, Y(0.07), 0))
        bone(side + 'Foot', lo, (lx, Y(0.07), 0), (lx, Y(0.02), zmin_c + 0.25 * (zmax_c - zmin_c)))
        arm = side + 'Arm'; fore = side + 'ForeArm'
        bone(arm, 'Spine1', (axs, Y(0.775), 0), (axe, Y(0.62), 0))
        bone(fore, arm, (axe, Y(0.62), 0), (axw, Y(0.47), 0))
        bone(side + 'Hand', fore, (axw, Y(0.47), 0), (axw, Y(0.41), 0))

    idx = {b['name']: i for i, b in enumerate(B)}
    N = len(pts_all)

    # ---------- 4. 权重 ----------
    D = np.full((N, len(B)), 1e9)
    for bi, b in enumerate(B):
        d = seg_dist(C, b['head_c'], b['tail_c'])
        nm = b['name']
        if nm.startswith('Left'):
            d = np.where(C[:, 0] > 0.02 * H, d * 6.0, d)
        if nm.startswith('Right'):
            d = np.where(C[:, 0] < -0.02 * H, d * 6.0, d)
        if is_arm(nm):
            d = np.where(np.abs(C[:, 0]) < 0.045 * H, d * 3.0, d)
        if nm.startswith(('LeftUpLeg', 'LeftLeg', 'LeftFoot')):
            d = np.where(C[:, 0] > 0.01 * H, d * 8.0, d)
        if nm.startswith(('RightUpLeg', 'RightLeg', 'RightFoot')):
            d = np.where(C[:, 0] < -0.01 * H, d * 8.0, d)
        D[:, bi] = d
    # 半径截断：肢体骨只能影响自己附近的顶点，避免把外套下摆一起拽走
    CUT = np.full(len(B), 0.16 * H)
    for bi, b in enumerate(B):
        nm = b['name']
        if is_arm(nm):
            CUT[bi] = 0.075 * H if nm.endswith(('Arm', 'ForeArm')) else 0.06 * H
        elif nm.startswith(('LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot')):
            CUT[bi] = 0.09 * H
        elif nm in ('Head', 'Neck'):
            CUT[bi] = 0.12 * H
    W = np.where(D < CUT[None, :], 1.0 / np.power(D + 0.010 * H, 3.0), 0.0)
    W[:, idx['Hips']] = np.maximum(W[:, idx['Hips']], 1e-6)   # 兜底
    K = 4
    order = np.argsort(-W, axis=1)[:, :K]
    w = np.take_along_axis(W, order, axis=1)
    w = w / w.sum(axis=1, keepdims=True)
    joints = order.astype(np.uint8)
    weights = w.astype(np.float32)

    # ---------- 5. 写节点 / skin ----------
    base = len(js['nodes'])
    js['nodes'].append({'name': 'Armature', 'children': [base + 1 + idx['Hips']]})
    for b in B:
        node = {'name': b['name'], 'translation': [float(v) for v in b['head']]}
        kids = [base + 1 + idx[x['name']] for x in B if x['parent'] == b['name']]
        if kids:
            node['children'] = kids
        js['nodes'].append(node)
    # 父节点相对位移修正：node.translation 用 head - parentHead
    for b in B:
        if b['parent']:
            b['node_trans'] = b['head'] - B[idx[b['parent']]]['head']
        else:
            b['node_trans'] = b['head']
        js['nodes'][base + 1 + idx[b['name']]]['translation'] = [float(v) for v in b['node_trans']]

    ibms = []
    for b in B:
        m = np.eye(4)
        m[0:3, 3] = -b['head']
        ibms.append(m.T.reshape(-1))
    ibm_acc = append_acc(js, bin_, np.array(ibms, np.float32), 5126, 'MAT4')
    skin_idx = len(js.get('skins', []))
    js.setdefault('skins', []).append({
        'name': 'AutoRig',
        'joints': [base + 1 + idx[b['name']] for b in B],
        'inverseBindMatrices': ibm_acc,
        'skeleton': base + 1 + idx['Hips'],
    })

    off = 0
    for prim, ni, pts in prims:
        cnt = len(pts)
        j = joints[off:off + cnt]; ww = weights[off:off + cnt]; off += cnt
        jacc = append_acc(js, bin_, j, 5121, 'VEC4')
        wacc = append_acc(js, bin_, ww, 5126, 'VEC4')
        prim['attributes']['JOINTS_0'] = jacc
        prim['attributes']['WEIGHTS_0'] = wacc
        js['nodes'][ni]['skin'] = skin_idx
    js['scenes'][js.get('scene', 0)]['nodes'].append(base)
    write_glb(dst, js, bin_)
    print('写回:', dst, '| 骨骼', len(B), '| 顶点', N)



if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
