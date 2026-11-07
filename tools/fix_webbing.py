# 拆分"蹼膜"粘连：把跨手臂-身体的混合三角形做顶点分裂
# - 躯干侧保留原顶点（身体权重不动，躯干表面完整）
# - 蹼膜侧复制新顶点，按 y 高度分给 Arm/ForeArm/Hand（100% 权重，随手臂动）
# 结果：手臂摆动时蹼膜跟着手臂走，不再拉出征状丝条
import numpy as np
from pygltflib import GLTF2
import copy, sys, shutil

SRC = 'assets/guard2_rigged.glb'
DST = 'assets/guard2_rigged.glb'  # 原地覆盖（先备份）

g = GLTF2().load_binary(SRC)
blob = g.binary_blob()

CT = {5120: (np.int8, 1), 5121: (np.uint8, 1), 5122: (np.int16, 2), 5123: (np.uint16, 2), 5125: (np.uint32, 4), 5126: (np.float32, 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def read_acc(ai):
    a = g.accessors[ai]
    bv = g.bufferViews[a.bufferView]
    off = (bv.byteOffset or 0) + (a.byteOffset or 0)
    dt, _ = CT[a.componentType]
    n = NC[a.type]
    arr = np.frombuffer(blob, dtype=dt, count=a.count * n, offset=off).reshape(a.count, n)
    return arr

jnames = [g.nodes[j].name for j in g.skins[0].joints]
prim = g.meshes[0].primitives[0]
attr_names = [k for k in vars(prim.attributes) if not k.startswith('_') and getattr(prim.attributes, k) is not None]
P = read_acc(prim.attributes.POSITION).astype(np.float32)
J = read_acc(prim.attributes.JOINTS_0).astype(np.int64)
W = read_acc(prim.attributes.WEIGHTS_0).astype(np.float32)
I = read_acc(prim.indices).reshape(-1, 3).astype(np.int64)
nverts = len(P)
print('attrs:', attr_names, 'verts:', nverts, 'tris:', len(I))

# 每顶点对各骨骼的总权重 → 主导骨
D = np.zeros((nverts, len(jnames)), dtype=np.float32)
for j in range(len(jnames)):
    D[:, j] = (J == j).sum(axis=1) * 0  # init
for slot in range(J.shape[1]):
    D[np.arange(nverts), J[:, slot]] += W[:, slot]
dom = np.argmax(D, axis=1)
domName = np.array(jnames)[dom]

ARM_L = {'LeftArm', 'LeftForeArm', 'LeftHand'}
ARM_R = {'RightArm', 'RightForeArm', 'RightHand'}
BODY = {'Hips', 'Spine', 'Spine1', 'Neck', 'Head'}
isArmL = np.isin(domName, list(ARM_L)); isArmR = np.isin(domName, list(ARM_R))
isBody = np.isin(domName, list(BODY))

# 手臂骨骼线索引（分配蹼膜用）：按 y 高度分带
iL = {n: jnames.index(n) for n in ARM_L}
iR = {n: jnames.index(n) for n in ARM_R}
ELBOW_Y, WRIST_Y = 0.806, 0.611  # 关节世界高度（实测）

def band_index(y, side):
    m = iL if side == 'L' else iR
    pre = 'Left' if side == 'L' else 'Right'
    if y > ELBOW_Y: return m[pre + 'Arm']
    if y > WRIST_Y: return m[pre + 'ForeArm']
    return m[pre + 'Hand']

# 找混合三角形（同三角形里既有手臂主导点又有身体主导点）
triArmL = isArmL[I].any(axis=1); triArmR = isArmR[I].any(axis=1)
triBody = isBody[I].any(axis=1)
mixL = triArmL & triBody
mixR = triArmR & triBody
print('混合三角形 L:', mixL.sum(), ' R:', mixR.sum())

# 需要分裂的顶点：出现在混合三角形里、且主导骨是身体的顶点
dup_of = {}  # 原顶点 -> 新顶点索引（每侧分开映射不需要，一个顶点只属于一侧蹼膜）
new_attrs = {k: [] for k in attr_names}  # 追加数据
new_J, new_W = [], []

def split_vertex(v, side):
    if v in dup_of:
        return dup_of[v]
    nv = nverts + len(dup_of)
    dup_of[v] = nv
    for k in attr_names:
        arr = read_acc(getattr(prim.attributes, k))
        new_attrs[k].append(arr[v].copy())
    # 权重：100% 给手臂骨骼（按 y 分带）
    bi = band_index(float(P[v][1]), side)
    new_J.append([bi, 0, 0, 0])
    new_W.append([1.0, 0.0, 0.0, 0.0])
    return nv

# 改写混合三角形的索引：身体主导顶点换成随手臂的副本
countL = countR = 0
for ti in np.where(mixL)[0]:
    for c in range(3):
        v = I[ti, c]
        if isBody[v]:
            I[ti, c] = split_vertex(int(v), 'L'); countL += 1
for ti in np.where(mixR)[0]:
    for c in range(3):
        v = I[ti, c]
        if isBody[v]:
            I[ti, c] = split_vertex(int(v), 'R'); countR += 1
ndup = len(dup_of)
print('分裂顶点数:', ndup, ' L改写:', countL, ' R改写:', countR)

if ndup == 0:
    print('没有需要处理的顶点，退出'); sys.exit(0)

# ---- 重建 BIN：所有 bufferView 按原顺序重排，受影响的 accessor 用新数据 ----
# 收集每个 accessor 的最终字节数据
def final_acc_bytes(ai):
    a = g.accessors[ai]
    if ai == prim.attributes.POSITION:
        base = P.astype(np.float32)
        extra = np.array(new_attrs['POSITION'], dtype=np.float32).reshape(-1, 3)
        return np.vstack([base, extra]).tobytes(), len(base) + len(extra)
    if ai == prim.indices:
        return I.reshape(-1).astype(np.uint16).tobytes(), I.size
    if ai == prim.attributes.JOINTS_0:
        base = J.astype(np.uint8 if J.max() < 256 else np.uint16)
        extra = np.array(new_J, dtype=base.dtype)
        return np.vstack([base, extra]).tobytes(), len(base) + len(extra)
    if ai == prim.attributes.WEIGHTS_0:
        base = W.astype(np.float32)
        extra = np.array(new_W, dtype=np.float32)
        return np.vstack([base, extra]).tobytes(), len(base) + len(extra)
    for k in attr_names:
        if ai == getattr(prim.attributes, k):
            base = read_acc(ai)
            extra = np.array(new_attrs[k], dtype=base.dtype).reshape(len(dup_of), -1)
            return np.vstack([base, extra]).tobytes(), len(base) + len(extra)
    # 其他 accessor 原样拷贝
    a2 = g.accessors[ai]
    bv = g.bufferViews[a2.bufferView]
    off = (bv.byteOffset or 0) + (a2.byteOffset or 0)
    dt, ds = CT[a2.componentType]
    n = NC[a2.type]
    return blob[off:off + a2.count * n * ds], a2.count

# 注意：多个 accessor 可能共享 bufferView。本模型假设一一对应（需验证）
shared_check = {}
for ai, a in enumerate(g.accessors):
    if a.bufferView in shared_check:
        print('!! accessor 共享 bufferView:', shared_check[a.bufferView], '和', ai, '共享 bv', a.bufferView)
    shared_check[a.bufferView] = ai

new_bin = bytearray()
new_bvs = []
# 以 accessor 为单位重建（假设 accessor 与 bufferView 一一对应）
bv_of_acc = {}
for ai in range(len(g.accessors)):
    a = g.accessors[ai]
    data, cnt = final_acc_bytes(ai)
    # 4 字节对齐
    while len(new_bin) % 4: new_bin.append(0)
    off = len(new_bin)
    new_bin.extend(data)
    new_bvs.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
    bv_of_acc[ai] = len(new_bvs) - 1
    a.count = cnt
    a.bufferView = len(new_bvs) - 1
    a.byteOffset = 0

# 非 accessor 引用的 bufferView（如贴图）：原样保留并修正引用
old_bv_used = set(a.bufferView for a in g.accessors)  # 这是新索引了，重新算旧的
# 更简单：先记录旧的 images
img_bv = [img.bufferView for img in (g.images or []) if img.bufferView is not None]
for ibv in img_bv:
    old_bv = g.bufferViews[ibv]
    off0 = old_bv.byteOffset or 0
    data = blob[off0:off0 + old_bv.byteLength]
    while len(new_bin) % 4: new_bin.append(0)
    off = len(new_bin)
    new_bin.extend(data)
    new_bvs.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
    for img in g.images:
        if img.bufferView == ibv:
            img.bufferView = len(new_bvs) - 1

from pygltflib import BufferView, Buffer
g.bufferViews = [BufferView(**bv) for bv in new_bvs]
g.buffers = [Buffer(byteLength=len(new_bin))]
g.set_binary_blob(bytes(new_bin))

import os
if os.path.exists(DST):
    shutil.copy(DST, DST + '.bak_webbing')
g.save_binary(DST)
print('saved', DST, 'bin bytes:', len(new_bin))
