# 重新分配四肢外壳顶点权重（平滑过渡版）
# - 离骨链近的顶点：主要给手臂/腿骨
# - 离骨链远（接近阈值）：手臂权重渐弱，保留 Hips 权重混合，避免硬切拉丝
import numpy as np
from pygltflib import GLTF2
import shutil, os

SRC = 'assets/guard2_rigged.glb'
if not os.path.exists(SRC + '.bak_reweight2'):
    shutil.copy(SRC, SRC + '.bak_reweight2')

g = GLTF2().load_binary(SRC)
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
J = read_acc(prim.attributes.JOINTS_0).astype(np.int64).copy()
W = read_acc(prim.attributes.WEIGHTS_0).astype(np.float32).copy()
nverts = len(P)
ji = {n:i for i,n in enumerate(jnames)}
HIPS = ji['Hips']

B = {
 'LeftArm':(-0.196,1.008,-0.04),'LeftForeArm':(-0.339,0.806,-0.06),'LeftHand':(-0.406,0.611,-0.06),
 'RightArm':(0.196,1.008,-0.04),'RightForeArm':(0.336,0.806,-0.06),'RightHand':(0.405,0.611,-0.06),
 'LeftUpLeg':(-0.163,0.676,0),'LeftLeg':(-0.163,0.364,0),'LeftFoot':(-0.163,0.091,0),
 'RightUpLeg':(0.164,0.676,0),'RightLeg':(0.164,0.364,0),'RightFoot':(0.164,0.091,0),
}
B = {k:np.array(v,dtype=np.float32) for k,v in B.items()}

def proj_onto(p, chain):
    best=(1e9,0.0)
    for i in range(2):
        A,Bp = chain[i],chain[i+1]
        ab = Bp-A; L2=ab@ab
        t = np.dot(p-A,ab)/L2; tc = max(0.0,min(1.0,t))
        d = np.linalg.norm(p-(A+ab*tc))
        if d<best[0]: best=(d,i+tc)
    return best[1], best[0]

# (chain, innerR, outerR): d<innerR 完全给肢体; innerR~outerR 渐弱; >outerR 不动
LIMBS = [
 (['LeftArm','LeftForeArm','LeftHand'],   0.030, 0.17),
 (['RightArm','RightForeArm','RightHand'],0.030, 0.17),
 (['LeftUpLeg','LeftLeg','LeftFoot'],     0.050, 0.14),
 (['RightUpLeg','RightLeg','RightFoot'],  0.050, 0.14),
]
def smoothstep(a,b,x):
    t = max(0.0,min(1.0,(x-a)/(b-a)))
    return t*t*(3-2*t)

reassigned=0
for chain, Ri, Ro in LIMBS:
    pts=[B[n] for n in chain]
    iA,iB,iC = ji[chain[0]],ji[chain[1]],ji[chain[2]]
    for vi in range(nverts):
        p = P[vi]
        t,d = proj_onto(p, pts)
        if d > Ro: continue
        # 肢体权重占比：d<Ri -> 1.0; d=Ro -> 0
        limb_share = 1.0 - smoothstep(Ri, Ro, d)
        # 在两节骨骼间分配
        if t <= 1.0:
            wA = 1.0 - smoothstep(0.15,0.85,t); wB = 1.0-wA
        else:
            u=t-1.0; wB = 1.0-smoothstep(0.15,0.85,u); wC=1.0-wB
        # 取最大两节 + Hips 补底
        entries=[]
        if t<=1.0:
            entries=[(iA,wA*limb_share),(iB,wB*limb_share)]
        else:
            entries=[(iB,wB*limb_share),(iC,wC*limb_share)]
        entries.append((HIPS, 1.0-limb_share))
        # 按权重排序取前4
        entries.sort(key=lambda e:-e[1])
        entries=[e for e in entries if e[1]>0.001][:4]
        s=sum(w for _,w in entries)
        entries=[(i,w/s) for i,w in entries]
        slots=[0,0,0,0]; sw=[0.,0.,0.,0.]
        for k,(i,w) in enumerate(entries):
            slots[k]=i; sw[k]=w
        J[vi]=slots; W[vi]=sw
        reassigned+=1

print('重分配顶点:', reassigned,'/',nverts)

attr_names = [k for k in vars(prim.attributes) if not k.startswith('_') and getattr(prim.attributes,k) is not None]
new_bin=bytearray(); new_bvs=[]
def append_bv(data):
    while len(new_bin)%4: new_bin.append(0)
    off=len(new_bin); new_bin.extend(data); new_bvs.append({'buffer':0,'byteOffset':off,'byteLength':len(data)}); return len(new_bvs)-1

joint_dtype = np.uint8 if J.max()<256 else np.uint16
for ai,a in enumerate(g.accessors):
    if ai==prim.attributes.JOINTS_0:
        bv=append_bv(J.astype(joint_dtype).tobytes())
    elif ai==prim.attributes.WEIGHTS_0:
        bv=append_bv(W.astype(np.float32).tobytes())
    else:
        bv_=g.bufferViews[a.bufferView]; off=(bv_.byteOffset or 0)+(a.byteOffset or 0)
        ds=CT[a.componentType][1]; n=NC[a.type]
        bv=append_bv(blob[off:off+a.count*n*ds])
    a.bufferView=bv; a.byteOffset=0

for img in (g.images or []):
    if img.bufferView is None: continue
    old=g.bufferViews[img.bufferView]; off0=old.byteOffset or 0
    img.bufferView=append_bv(blob[off0:off0+old.byteLength])

from pygltflib import BufferView, Buffer
g.bufferViews=[BufferView(**b) for b in new_bvs]
g.buffers=[Buffer(byteLength=len(new_bin))]
g.set_binary_blob(bytes(new_bin))
g.save_binary(SRC)
print('saved',SRC)
