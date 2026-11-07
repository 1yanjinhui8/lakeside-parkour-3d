# -*- coding: utf-8 -*-
"""
simplify-landmarks.py —— 批量减面 + 贴图降采样

美术给的 7 座地标是 50 万面/座、3 张 4K PNG，合计 418 MB / 350 万面。
地标在游戏里最近 60m、最远 200m+，这个精度完全用不上，但会让加载到几十秒、
显存吃到 1 GB 以上。

本脚本调 Blender 批处理：
    · Decimate 到 ratio（默认 0.08，50 万面 → 4 万面）
    · 贴图缩到 1024，非法线贴图转 JPEG(q82)
    · 实测单座 53.8 MB → 5.4 MB

原件备份到 assets/landmarks/_hd/，随时可以回滚（--restore 直接拷回来）。

用法：
    python tools/simplify-landmarks.py                  # 默认 0.08 / 1024
    python tools/simplify-landmarks.py --ratio 0.04     # 更激进（2 万面）
    python tools/simplify-landmarks.py --restore        # 从 _hd 还原成原件
"""
import io
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'assets', 'landmarks')
HD = os.path.join(DIR, '_hd')
BLENDER = r'D:/3DBlender/blender.exe'
SCRIPT = os.path.join(ROOT, 'tools', 'blender_simplify.py')

FILES = ['pearl.glb', 'guomao.glb', 'bamboo.glb', 'gateSuzhou.glb',
         'gateHangzhou.glb', 'waist.glb', 'cbd.glb']

args = sys.argv[1:]
ratio = '0.08'
tex = '1024'
restore = '--restore' in args
for i, a in enumerate(args):
    if a == '--ratio' and i + 1 < len(args):
        ratio = args[i + 1]
    if a == '--tex' and i + 1 < len(args):
        tex = args[i + 1]

os.makedirs(HD, exist_ok=True)

if restore:
    n = 0
    for f in FILES:
        src = os.path.join(HD, f)
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(DIR, f))
            print('还原 %s (%.1f MB)' % (f, os.path.getsize(src) / 1048576))
            n += 1
    print('已还原 %d 个文件' % n)
    sys.exit(0)

if not os.path.exists(BLENDER):
    raise SystemExit('!! 找不到 Blender: %s' % BLENDER)

t_all = time.time()
total_in = total_out = 0

for f in FILES:
    cur = os.path.join(DIR, f)
    hd = os.path.join(HD, f)
    if not os.path.exists(cur):
        print('!! 缺失 %s，跳过' % f)
        continue

    # 第一次跑：先把当前文件备份成高清原件
    if not os.path.exists(hd):
        shutil.copyfile(cur, hd)
        print('备份原件 %s (%.1f MB)' % (f, os.path.getsize(hd) / 1048576))

    t0 = time.time()
    r = subprocess.run(
        [BLENDER, '--background', '--python', SCRIPT, '--', hd, cur, ratio, tex],
        capture_output=True, text=True, timeout=600,
        encoding='utf-8', errors='replace')

    line = ''
    for ln in (r.stdout or '').splitlines():
        if ln.startswith('RESULT|'):
            line = ln
    if not line:
        print('!! %s 处理失败' % f)
        tail = (r.stderr or r.stdout or '')[-600:]
        print(tail)
        continue

    sz = os.path.getsize(cur) / 1048576
    total_in += os.path.getsize(hd) / 1048576
    total_out += sz
    print('%s  (%.1fs)' % (line.replace('RESULT|', ''), time.time() - t0))

print('')
print('合计 %.1f MB -> %.1f MB（%.0f%%），耗时 %.0fs' % (
    total_in, total_out, 100 * total_out / max(total_in, 0.001), time.time() - t_all))
