# 诊断 guard2_rigged.glb 的蒙皮权重分布
# 输出：每根骨骼影响的顶点数、顶点 y 范围、离骨骼原点距离
import numpy as np
from pygltflib import GLTF2

g = GLTF2().load_binary('assets/guard2_rigged.glb')
blob = g.binary_blob()
CT = {5120:(np.int8,1),5121:(np.uint8,1),5122:(np.int16,2),5123:(np.uint16,2),5125:(np.uint32,4),5126:(np.float32,4)}
NC = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def read_acc(ai):
    a = g.accessors[ai]; bv = g.bufferViews[a.bufferView]
    off = (bv.byteOffset or 0)+(a.byteOffset or 0)
    dt,_ = CT[a.componentType]; n = NC[a.type]
    return np.frombuffer(blob,dtype=dt,count=a.count*n,offset=off).reshape(a.count,n)

jnames = [g.nodes[j].name for j in g.skins[0].joints]
prim = g.meshes[0].primitives[0]
P = read_acc(prim.attributes.POSITION).astype(np.float32)
J = read_acc(prim.attributes.JOINTS_0).astype(np.int64)
W = read_acc(prim.attributes.WEIGHTS_0).astype(np.float32)
nverts = len(P)
print(f'joints={len(jnames)} verts={nverts}')

# 每顶点对各骨累计权重
D = np.zeros((nverts,len(jnames)),dtype=np.float32)
for slot in range(J.shape[1]):
    D[np.arange(nverts),J[:,slot]] += W[:,slot]
dom = np.argmax(D,axis=1)
domName = np.array(jnames)[dom]

# 骨骼世界原点（rest pose）
# skin 里 inverseBindMatrices 能拿到骨的世界逆变换
ibm = read_acc(g.skins[0].inverseBindMatrices).reshape(-1,4,4)
# 骨世界原点 = inv(IBM) 平移项
def bone_world_pos(ibm_i):
    m = ibm_i
    inv = np.linalg.inv(m)
    return inv[:3,3]

print(f'\n{"bone":<14} {"nVert":>6} {"yMin":>6} {"yMax":>6} {"xMin":>6} {"xMax":>6} {"centerX":>7} {"boneX":>7}')
for ji,name in enumerate(jnames):
    mask = dom==ji
    n = mask.sum()
    if n==0: continue
    ys = P[mask,1]; xs = P[mask,0]
    bp = bone_world_pos(ibm[ji])
    print(f'{name:<14} {n:>6} {ys.min():>6.3f} {ys.max():>6.3f} {xs.min():>6.3f} {xs.max():>6.3f} {xs.mean():>7.3f} {bp[0]:>7.3f}')

# 重点：手臂区域（|x|>0.15 且 y 在 0.55~1.05）的顶点，主导骨分布
print('\n=== 手臂侧面区域 (|x|>0.15, 0.55<y<1.05) 顶点主导骨分布 ===')
armzone = (np.abs(P[:,0])>0.15) & (P[:,1]>0.55) & (P[:,1]<1.05)
from collections import Counter
c = Counter(domName[armzone])
for name,cnt in c.most_common():
    print(f'  {name:<16} {cnt}')

# 腿区域
print('\n=== 腿区域 (|x|>0.1, y<0.45) 顶点主导骨分布 ===')
legzone = (np.abs(P[:,0])>0.1) & (P[:,1]<0.45)
c2 = Counter(domName[legzone])
for name,cnt in c2.most_common():
    print(f'  {name:<16} {cnt}')
