# -*- coding: utf-8 -*-
"""把 GLB 里的 PNG 贴图换成 JPEG，用来给「必须内联」的模型瘦身。

为什么只动贴图：这两个模型（川大校门 / 新葡京）各 7.5MB，其中 3.6~4.1MB 是三张
1024~2048 的 PNG 贴图。gzip 对 PNG 几乎无效（88%），对 float 顶点也一般；
把 PNG 换成 q86 JPEG 能直接把贴图压到 1/8，再 gzip 才有意义。

只处理「没有 alpha 通道」的图；带透明像素的保持 PNG 不动（免得把镂空贴图压成黑块）。

用法：python tools/slim-glb.py in.glb out.glb [--q=86]
"""
import io
import json
import os
import struct
import sys

from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
Q = 86
for a in sys.argv[3:]:
    if a.startswith('--q='):
        Q = int(a.split('=')[1])

data = open(src, 'rb').read()
magic, ver, total = struct.unpack('<III', data[:12])
assert magic == 0x46546C67, 'not a glb'
off = 12
jlen, jtype = struct.unpack('<II', data[off:off + 8])
assert jtype == 0x4E4F534A
j = json.loads(data[off + 8:off + 8 + jlen])
off2 = off + 8 + jlen
blen, btype = struct.unpack('<II', data[off2:off2 + 8])
assert btype == 0x004E4942
bin_ = data[off2 + 8:off2 + 8 + blen]

views = j['bufferViews']
# 每个 bufferView 的原始字节（可能被多个 accessor 共享）
raw = [bin_[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']] for v in views]

changed = 0
for img in j.get('images', []):
    if img.get('mimeType') != 'image/png':
        continue
    vi = img['bufferView']
    try:
        im = Image.open(io.BytesIO(raw[vi]))
        im.load()
    except Exception as e:
        print('  skip image:', e)
        continue
    has_alpha = (im.mode in ('RGBA', 'LA', 'P') and
                 ('transparency' in im.info or (im.mode == 'RGBA' and im.getextrema()[3][0] < 250)))
    if has_alpha:
        print('  保留 PNG（有透明像素）', im.size, im.mode)
        continue
    buf = io.BytesIO()
    im.convert('RGB').save(buf, format='JPEG', quality=Q, optimize=True, progressive=False)
    newb = buf.getvalue()
    if len(newb) >= len(raw[vi]):
        continue
    print('  %s %s %dKB -> %dKB' % (img.get('name', 'tex'), im.size, len(raw[vi]) // 1024, len(newb) // 1024))
    raw[vi] = newb
    img['mimeType'] = 'image/jpeg'
    changed += 1

# 顺序重建 buffer：bufferView 索引不变，accessor 的 byteOffset 是「相对 bufferView」的，安全
out_bin = bytearray()
for i, v in enumerate(views):
    while len(out_bin) % 4:
        out_bin.append(0)
    v['byteOffset'] = len(out_bin)
    v['byteLength'] = len(raw[i])
    out_bin += raw[i]
while len(out_bin) % 4:
    out_bin.append(0)
j['buffers'] = [{'byteLength': len(out_bin)}]

js = json.dumps(j, separators=(',', ':')).encode('utf-8')
while len(js) % 4:
    js += b' '
head = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out_bin))
out = head + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out_bin), 0x004E4942) + bytes(out_bin)
open(dst, 'wb').write(out)
print('%s %.2fMB -> %.2fMB（替换 %d 张贴图）' % (os.path.basename(src), len(data) / 1e6, len(out) / 1e6, changed))
