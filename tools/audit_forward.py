# -*- coding: utf-8 -*-
"""沿跑道正前方打射线（胸口 1.2m / 头部 1.7m），找「正前方有墙」的里程。"""
import json, struct, math
import numpy as np

import sys
GLB=sys.argv[1] if len(sys.argv)>1 else 'assets/campus/beida-campus.glb'
ROUTE=sys.argv[2] if len(sys.argv)>2 else 'assets/campus/campus_route.json'
raw=open(GLB,'rb').read(); off=12; ch={}
while off<len(raw):
    l,t=struct.unpack('<II',raw[off:off+8]); ch[t]=raw[off+8:off+8+l]; off+=8+l
g=json.loads(ch[0x4E4F534A]); BIN=ch[0x004E4942]
ACC,BV=g['accessors'],g['bufferViews']
def acc(i):
    a=ACC[i]; bv=BV[a['bufferView']]; st=bv.get('byteOffset',0)+a.get('byteOffset',0); n=a['count']
    nc={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']]; dt={5126:'<f4',5125:'<u4',5123:'<u2'}[a['componentType']]
    return np.frombuffer(BIN,dtype=dt,count=n*nc,offset=st).reshape(n,nc)
tris=[]
for node in g['nodes']:
    if 'mesh' not in node: continue
    pr=g['meshes'][node['mesh']]['primitives'][0]
    if not g['materials'][pr['material']]['name'].startswith(('wall','roof')): continue
    p=acc(pr['attributes']['POSITION']).astype(np.float64)
    idx=acc(pr['indices']).reshape(-1).astype(np.int64)
    tri=p[idx].reshape(-1,3,3)
    tri=tri[tri[:,:,1].min(axis=1)<1.9]          # 只留够得着的
    tris.append(tri)
W=np.concatenate(tris)
X=W[:,:,0]; Y=W[:,:,1]; Z=W[:,:,2]
print('候选三角形', len(W))

R=json.load(open(ROUTE,encoding='utf-8'))
P=np.array([[p[0],p[1]] for p in R['pts']],float)
n=len(P); L=np.linalg.norm(np.roll(P,-1,axis=0)-P,axis=1)
C=np.concatenate([[0],np.cumsum(L)]); T=C[-1]
def at(s):
    s%=T; i=min(max(int(np.searchsorted(C,s,side='right')-1),0),n-1)
    t=(s-C[i])/L[i] if L[i]>1e-9 else 0
    return P[i]+(P[(i+1)%n]-P[i])*t, (P[(i+1)%n]-P[i])/L[i]
juncs=[]
for i in range(1,n):
    a,b,c=P[i-1],P[i],P[(i+1)%n]
    u0=(b-a)/np.linalg.norm(b-a); u1=(c-b)/np.linalg.norm(c-b)
    if abs(math.degrees(math.atan2(u0[0]*u1[1]-u0[1]*u1[0], u0@u1)))>=45: juncs.append(C[i])
def near_j(s,pad):
    return any(min(abs(s-j),abs(s-j+T),abs(s-j-T))<pad for j in juncs)

def hit_at(s, eye):
    p,d=at(s); th=math.atan2(d[1],d[0])+math.pi/2
    ct,st=math.cos(th),math.sin(th)
    dx=X-p[0]; dz=Z-p[1]
    wx=dx*ct+dz*st; wz=-dx*st+dz*ct
    x1,x2,x3=wx[:,0],wx[:,1],wx[:,2]
    y1,y2,y3=Y[:,0],Y[:,1],Y[:,2]
    z1,z2,z3=wz[:,0],wz[:,1],wz[:,2]
    ax,ay=x2-x1,y2-y1; bx,by=x3-x1,y3-y1
    det=ax*by-bx*ay
    ok=np.abs(det)>1e-9
    u=np.where(ok,((-x1)*by-bx*(eye-y1))/np.where(ok,det,1),9)
    v=np.where(ok,(ax*(eye-y1)-(-x1)*ay)/np.where(ok,det,1),9)
    inside=ok&(u>=-0.002)&(v>=-0.002)&(u+v<=1.002)
    zz=z1+u*(z2-z1)+v*(z3-z1)
    dist=np.where(inside&(zz<0),-zz,1e9)
    return float(dist.min())

rows=[]
for s in np.arange(0,T,3.0):
    best=min(hit_at(s,1.2), hit_at(s,1.7))
    if best<45: rows.append((int(s), round(best,1)))
clean=[r for r in rows if not near_j(r[0],50)]
print('正前方 45m 内有墙：%d 个采样点'%len(rows))
print('  其中远离路口(±50m)的：%d 个'%len(clean))
print('  远离路口：', clean[:20])
print('  最近路口外的例子：', [r for r in rows if 40<r[0]<130][:8])
