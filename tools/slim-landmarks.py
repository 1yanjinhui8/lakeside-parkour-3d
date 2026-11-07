# -*- coding: utf-8 -*-
"""
slim-landmarks.py —— 只压贴图，不动几何

现状（2026-11-01 实测）：7 座地标每个 5~6MB，其中 **74% 是三张 1024² PNG**：
  xxx_normal.png / xxx.png（baseColor）/ xxx_metallic-..._roughness.png
跑起来三张都要解码成 RGBA 上传显卡：1024²×4B×3×7 ≈ 112MB 纹理内存。

这个脚本按用途分别降分辨率 + 转 JPEG：
  baseColor   768²  q88   —— 街上看塔身的主贴图，保住细节
  normal      384²  q92   —— 夜里基本靠自发光/灯线，法线只需大轮廓
  metal/rough 256²  q86   —— 粗糙度本来就是低频信息
预计每个 5.4MB → 0.5~0.7MB，纹理内存 112MB → ~20MB。

用法：
    python tools/slim-landmarks.py --check     # 只报预期
    python tools/slim-landmarks.py            # 就地瘦身（原件备份到 tmp/backup-lm-slim/）
    python tools/slim-landmarks.py --restore  # 从备份还原
"""
import io
import json
import os
import shutil
import struct
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'assets', 'landmarks')
BAK = os.path.join(ROOT, 'tmp', 'backup-lm-slim')
FILES = ['pearl.glb', 'guomao.glb', 'bamboo.glb', 'gateSuzhou.glb',
         'gateHangzhou.glb', 'waist.glb', 'cbd.glb']
# lisboa（新葡京路标）不在这里：它是 80 万面的重模型，用 tools/simplify-landmarks.py
# 走 Blender 减面（79992 面 / 7.1MB），只压贴图解决不了几何。

# 用途 -> (边长, JPEG 质量)
SPEC = {
    'normal': (384, 92),
    'mr': (256, 86),
    'base': (768, 88),
}

MODE = 'apply'
if '--check' in sys.argv:
    MODE = 'check'
elif '--restore' in sys.argv:
    MODE = 'restore'


def read_glb(path):
    raw = io.open(path, 'rb').read()
    magic, ver, total = struct.unpack('<III', raw[:12])
    assert magic == 0x46546C67, 'not glb'
    off = 12
    js = None
    bin_ = b''
    while off < len(raw):
        ln, ty = struct.unpack('<II', raw[off:off + 8])
        chunk = raw[off + 8:off + 8 + ln]
        if ty == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ty == 0x004E4942:
            bin_ = chunk
        off += 8 + ln
    return js, bin_


def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(',', ':')).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)          # JSON 用空格补齐
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
    if 'metallic' in n or 'roughness' in n or 'metal' in n:
        return 'mr'
    return 'base'


def shrink_image(blob, kind):
    side, q = SPEC[kind]
    im = Image.open(io.BytesIO(blob))
    if im.mode not in ('RGB', 'L'):
        im = im.convert('RGB')
    w, h = im.size
    if max(w, h) > side:
        k = side / float(max(w, h))
        im = im.resize((max(1, int(round(w * k))), max(1, int(round(h * k)))), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=q, optimize=True, progressive=False)
    return out.getvalue(), (w, h), im.size


def process(path):
    js, bin_ = read_glb(path)
    views = js.get('bufferViews', [])
    images = js.get('images', [])
    if not images:
        return None

    # 先把每个 image 对应的 bufferView 标出来
    img_view = {}
    for i, im in enumerate(images):
        if 'bufferView' in im:
            img_view[im['bufferView']] = i

    new_bytes = {}
    detail = []
    for vi, ii in img_view.items():
        bv = views[vi]
        st = bv.get('byteOffset', 0)
        blob = bin_[st:st + bv['byteLength']]
        kind = kind_of(images[ii].get('name') or str(images[ii].get('mimeType')))
        nb, old, now = shrink_image(blob, kind)
        new_bytes[vi] = nb
        detail.append((kind, old, now, len(blob), len(nb)))

    # 重排 BIN：按 bufferView 原顺序复制，图片换成新字节
    out = bytearray()
    for vi, bv in enumerate(views):
        if vi in new_bytes:
            data = new_bytes[vi]
            images[img_view[vi]]['mimeType'] = 'image/jpeg'
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
    return js, bytes(out), detail


if MODE == 'restore':
    n = 0
    for f in FILES:
        src = os.path.join(BAK, f)
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(DIR, f))
            n += 1
    print('已还原 %d 个地标模型' % n)
    sys.exit(0)

if MODE == 'apply' and not os.path.exists(BAK):
    os.makedirs(BAK, exist_ok=True)
    for f in FILES:
        p = os.path.join(DIR, f)
        if os.path.exists(p):
            shutil.copyfile(p, os.path.join(BAK, f))
    print('原件备份：tmp/backup-lm-slim/')

before = after = 0
for f in FILES:
    p = os.path.join(DIR, f)
    if not os.path.exists(p):
        print('%-16s 缺失' % f)
        continue
    sz0 = os.path.getsize(p)
    before += sz0
    res = process(p)
    if not res:
        print('%-16s 没有贴图，跳过' % f)
        continue
    js, bin_, detail = res
    # 预估体积（base64 前后都算一下）
    est = len(json.dumps(js, separators=(',', ':')).encode('utf-8')) + len(bin_)
    print('%-16s %5.2fMB -> %5.2fMB' % (f, sz0 / 1048576, est / 1048576))
    for kind, old, now, b0, b1 in detail:
        print('    %-6s %4dx%-4d -> %4dx%-4d  %6.2fMB -> %6.0fKB' %
              (kind, old[0], old[1], now[0], now[1], b0 / 1048576, b1 / 1024))
    after += est
    if MODE == 'apply':
        write_glb(p, js, bin_)

print('\n合计 %.2fMB -> %.2fMB（-%.0f%%）' % (before / 1048576, after / 1048576, 100 * (1 - after / max(before, 1))))
if MODE == 'check':
    print('（--check：只预估，没写文件）')
