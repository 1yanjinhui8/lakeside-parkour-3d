# -*- coding: utf-8 -*-
"""
Blender 批处理脚本：减面 + 贴图降采样，然后导出 GLB。

用法（由 tools/simplify-landmarks.py 调用，不直接跑）：
    blender --background --python tools/blender_simplify.py -- <src.glb> <dst.glb> <ratio> <texsize>

为什么要做这一步：
    美术给的模型是 50 万面/座、3 张 4K PNG（单座 46~71 MB）。7 座合计 418 MB、
    350 万面。地标在游戏里最近也就 60m 远、最远 200m+，这个精度完全用不上，
    但会让加载时间到几十秒、显存吃到 1 GB 以上，手机直接 OOM。

    减面到 8%、贴图降到 1024 + JPEG，体积能压到 1/20 左右，剪影和窗格纹理几乎不变。
"""
import bpy
import sys
import os

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
ratio = float(argv[2]) if len(argv) > 2 else 0.08
tex = int(argv[3]) if len(argv) > 3 else 1024

# 干净场景
bpy.ops.wm.read_factory_settings(use_empty=True)

bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    print('!! 没有 mesh:', src)
    sys.exit(1)

before = sum(len(o.data.polygons) for o in meshes)

# ---- 减面 ----
for o in meshes:
    m = o.modifiers.new(name='Decimate', type='DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = ratio
    m.use_collapse_triangulate = True

bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.modifier_apply(modifier='Decimate')

after = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')

# ---- 贴图降采样 ----
scaled = 0
for img in bpy.data.images:
    w, h = img.size[0], img.size[1]
    if w > tex or h > tex:
        s = tex / max(w, h)
        img.scale(max(1, int(w * s)), max(1, int(h * s)))
        scaled += 1

# ---- 导出 ----
# baseColor / metallicRoughness 用 JPEG（体积小），normal 必须留 PNG（JPEG 的块状
# 伪影会直接变成法线上的假凹凸）。Blender 的 gltf 导出器按 image 的 file_format 走，
# 这里把非 normal 的图统一改成 JPEG。
for img in bpy.data.images:
    if 'nor' in (img.name or '').lower():
        continue
    try:
        img.file_format = 'JPEG'
    except Exception:
        pass

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format='GLB',
    export_image_format='AUTO',
    export_jpeg_quality=82,
    export_apply=True,
    export_animations=False,
    export_skins=False,
)

sz_in = os.path.getsize(src) / 1048576
sz_out = os.path.getsize(dst) / 1048576
print('RESULT|%s|面 %d -> %d|贴图缩放 %d 张|%.1f MB -> %.1f MB' % (
    os.path.basename(dst), before, after, scaled, sz_in, sz_out))
