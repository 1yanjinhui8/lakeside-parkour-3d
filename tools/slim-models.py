# -*- coding: utf-8 -*-
"""
slim-models.py —— 给角色 / 保安这类「单文件重模型」压贴图

和 slim-landmarks.py 同一套逻辑，只是规格不同：这两份是人物，脸/衣服要经得起近看，
所以 baseColor 比地标留得大，法线也只降一档。

实测（2026-11-01）：
  guard2_rigged.glb  22.87MB：3 张 4096² PNG 就占 21.2MB → 纹理内存 192MB
  character.glb      11.21MB：1 张 4096² PNG 法线 + 两张 jpeg → 纹理内存 96MB

用法：
    python tools/slim-models.py --check
    python tools/slim-models.py
    python tools/slim-models.py --restore
"""
import io
import json
import os
import shutil
import struct
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BAK = os.path.join(ROOT, 'tmp', 'backup-models-slim')

# 文件 -> {用途: (边长, JPEG 质量)}
JOBS = {
    'assets/guard2_rigged.glb': {
        'base': (1024, 86),
        'normal': (512, 90),
        'mr': (256, 85),
    },
    'assets/character.glb': {
        'base': (2048, 88),
        'normal': (1024, 90),
        'mr': (512, 86),
    },
}

MODE = 'apply'
if '--check' in sys.argv:
    MODE = 'check'
elif '--restore' in sys.argv:
    MODE = 'restore'


def read_glb(path):
    raw = io.open(path, 'rb').read()
    off = 12
    js, bin_ = None, b''
    while off < len(raw):
        ln, ty = struct.unpack('<II', raw[off:off + 8])
        ch = raw[off + 8:off + 8 + ln]
        if ty == 0x4E4F534A:
            js = json.loads(ch.decode('utf-8'))
        elif ty == 0x004E4942:
            bin_ = ch
        off += 8 + ln
    return js, bin_


def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(',', ':')).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = bin_ + b'\x00' * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(jb) + (8 + len(bb) if bb else 0)
    with io.open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A))
        f.write(jb)
        if bb:
            f.write(struct.pack('<II', len(bb), 0x004E4942))
            f.write(bb)


def kind_of(name):
    n = (name or '').lower()
    if 'normal' in n:
        return 'normal'
    if 'metallic' in n or 'roughness' in n or 'orm' in n or 'metal' in n:
        return 'mr'
    return 'base'


def shrink(blob, spec):
    side, q = spec
    im = Image.open(io.BytesIO(blob))
    if im.mode not in ('RGB', 'L'):
        im = im.convert('RGB')
    w, h = im.size
    if max(w, h) > side:
        k = side / float(max(w, h))
        im = im.resize((max(1, int(round(w * k))), max(1, int(round(h * k)))), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=q, optimize=True)
    return out.getvalue(), (w, h), im.size


if MODE == 'restore':
    n = 0
    for rel in JOBS:
        src = os.path.join(BAK, os.path.basename(rel))
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(ROOT, rel))
            n += 1
    print('已还原 %d 个模型' % n)
    sys.exit(0)

if MODE == 'apply' and not os.path.exists(BAK):
    os.makedirs(BAK, exist_ok=True)
    for rel in JOBS:
        p = os.path.join(ROOT, rel)
        if os.path.exists(p):
            shutil.copyfile(p, os.path.join(BAK, os.path.basename(rel)))
    print('原件备份：tmp/backup-models-slim/')

for rel, spec in JOBS.items():
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        print('%-34s 缺失' % rel)
        continue
    sz0 = os.path.getsize(p)
    js, bin_ = read_glb(p)
    views = js.get('bufferViews', [])
    img_view = {}
    for i, im in enumerate(js.get('images', [])):
        if 'bufferView' in im:
            img_view[im['bufferView']] = i

    new_bytes, info = {}, []
    for vi, ii in img_view.items():
        bv = views[vi]
        st = bv.get('byteOffset', 0)
        blob = bin_[st:st + bv['byteLength']]
        kind = kind_of(js['images'][ii].get('name'))
        nb, old, now = shrink(blob, spec[kind])
        new_bytes[vi] = nb
        info.append((kind, old, now, len(blob), len(nb)))

    out = bytearray()
    for vi, bv in enumerate(views):
        if vi in new_bytes:
            data = new_bytes[vi]
            js['images'][img_view[vi]]['mimeType'] = 'image/jpeg'
        else:
            st = bv.get('byteOffset', 0)
            data = bin_[st:st + bv['byteLength']]
        while len(out) % 4:
            out.append(0)
        bv['byteOffset'] = len(out)
        bv['byteLength'] = len(data)
        out.extend(data)
    while len(out) % 4:
        out.append(0)
    js['buffers'][0]['byteLength'] = len(out)

    est = len(json.dumps(js, separators=(',', ':')).encode('utf-8')) + len(out)
    print('%-34s %6.2fMB -> %6.2fMB' % (rel, sz0 / 1048576, est / 1048576))
    for kind, old, now, b0, b1 in info:
        print('    %-6s %4dx%-4d -> %4dx%-4d  %6.2fMB -> %6.0fKB' %
              (kind, old[0], old[1], now[0], now[1], b0 / 1048576, b1 / 1024))
    if MODE == 'apply':
        write_glb(p, js, bytes(out))

if MODE == 'check':
    print('（--check：只预估，没写文件）')
