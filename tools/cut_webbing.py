# 方案A：直接删除跨手臂-身体的混合三角形（蹼膜）
# 蹼膜是多余膜片：躯干表面/手臂掌面各自闭合，删膜后露出完整肚皮，不留洞
import numpy as np
from pygltflib import GLTF2
import shutil, os

SRC = 'assets/guard2_rigged.glb.bak_webbing'   # 从原始备份出发
DST = 'assets/guard2_rigged.glb'

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
    return np.frombuffer(blob, dtype=dt, count=a.count * n, offset=off).reshape(a.count, n)

jnames = [g.nodes[j].name for j in g.skins[0].joints]
prim = g.meshes[0].primitives[0]
P = read_acc(prim.attributes.POSITION).astype(np.float32)
J = read_acc(prim.attributes.JOINTS_0).astype(np.int64)
W = read_acc(prim.attributes.WEIGHTS_0).astype(np.float32)
I = read_acc(prim.indices).reshape(-1, 3).astype(np.int64)
nverts = len(P)

D = np.zeros((nverts, len(jnames)), dtype=np.float32)
for slot in range(J.shape[1]):
    D[np.arange(nverts), J[:, slot]] += W[:, slot]
domName = np.array(jnames)[np.argmax(D, axis=1)]

ARMS = {'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'}
BODY = {'Hips', 'Spine', 'Spine1', 'Neck', 'Head'}
isArm = np.isin(domName, list(ARMS))
isBody = np.isin(domName, list(BODY))
mix = isArm[I].any(axis=1) & isBody[I].any(axis=1)
print('删除混合三角形:', mix.sum(), '/', len(I))
I2 = I[~mix]

# 重建 BIN：仅替换 indices
new_bin = bytearray()
new_bvs = []
for ai in range(len(g.accessors)):
    a = g.accessors[ai]
    if ai == prim.indices:
        data = I2.reshape(-1).astype(np.uint16).tobytes()
        a.count = I2.size
    else:
        bv = g.bufferViews[a.bufferView]
        off = (bv.byteOffset or 0) + (a.byteOffset or 0)
        dt, ds = CT[a.componentType]
        n = NC[a.type]
        data = blob[off:off + a.count * n * ds]
    while len(new_bin) % 4: new_bin.append(0)
    off = len(new_bin)
    new_bin.extend(data)
    new_bvs.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
    a.bufferView = len(new_bvs) - 1
    a.byteOffset = 0

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
g.save_binary(DST)
print('saved', DST, 'tris:', len(I2), 'bin bytes:', len(new_bin))
