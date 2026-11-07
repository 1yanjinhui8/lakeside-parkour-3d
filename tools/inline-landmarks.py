# -*- coding: utf-8 -*-
"""
inline-landmarks.py —— 把 assets/landmarks/*.glb 内联进 playable.html

开发时地标模型走 HTTP（/assets/landmarks/*.glb），改一个模型刷新就能看到。
但 playable.html 是「单文件发布版」——用户可能只拷一个 html，所以发布前要把
模型转成 data URI 塞进去。

用法：
    python tools/inline-landmarks.py            # 内联（默认）
    python tools/inline-landmarks.py --restore  # 还原成 HTTP 路径
    python tools/inline-landmarks.py --check    # 只检查当前状态，不写文件

幂等：重复跑结果一致；--restore 之后可以再内联。
"""
import base64
import io
import os
import re
import shutil
import sys
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'playable.html')
DIR = os.path.join(ROOT, 'assets', 'landmarks')

# kind -> 文件名（和 playable.html 里的 LANDMARK_MODELS 一一对应）
MODELS = {
    'pearl': 'pearl.glb',
    'guomao': 'guomao.glb',
    'bamboo': 'bamboo.glb',
    'gateSuzhou': 'gateSuzhou.glb',
    'gateHangzhou': 'gateHangzhou.glb',
    'waist': 'waist.glb',
    'cbd': 'cbd.glb',
}

mode = 'inline'
args = sys.argv[1:]
if '--restore' in args:
    mode = 'restore'
elif '--check' in args:
    mode = 'check'

html = io.open(HTML, encoding='utf-8', newline='').read()

# 只替换 LANDMARK_MODELS 对象内部的值，避免误伤别处的同名字符串
m = re.search(r'const LANDMARK_MODELS = \{(.*?)\n\};', html, re.S)
if not m:
    raise SystemExit('!! 找不到 LANDMARK_MODELS 定义')
body = m.group(1)

found = {}
for kind in MODELS:
    mm = re.search(r"(\b%s:\s*)'([^']*)'" % re.escape(kind), body)
    if not mm:
        raise SystemExit('!! LANDMARK_MODELS 里没有 %s' % kind)
    found[kind] = (mm.group(1), mm.group(2))

print('当前状态：')
for kind, (prefix, value) in found.items():
    tag = 'data URI（已内联 %.2f MB）' % (len(value) / 1048576) if value.startswith('data:') else value
    print('  %-12s %s' % (kind, tag))

if mode == 'check':
    sys.exit(0)

new_body = body
total = 0
missing = []

for kind, filename in MODELS.items():
    prefix, value = found[kind]
    if mode == 'restore':
        new_val = '/assets/landmarks/' + filename
    else:
        p = os.path.join(DIR, filename)
        if not os.path.exists(p):
            missing.append(filename)
            new_val = '/assets/landmarks/' + filename   # 没有模型就保留路径（运行时 404 → 回退代码生成）
        else:
            raw = io.open(p, 'rb').read()
            total += len(raw)
            new_val = 'data:model/gltf-binary;base64,' + base64.b64encode(raw).decode('ascii')
            print('  内联 %-14s %.2f MB -> %.2f MB (base64)' % (filename, len(raw) / 1048576, len(new_val) / 1048576))
    # 用 lambda 避免反向引用被 data URI 里的反斜杠干扰
    new_body = re.sub(r"(\b%s:\s*)'[^']*'" % re.escape(kind),
                      lambda mm, v=new_val: mm.group(1) + "'" + v + "'",
                      new_body, count=1)

if mode == 'restore':
    print('已还原成 HTTP 路径（开发模式）')
else:
    if missing:
        print('缺少 %d 个模型，保持 HTTP 路径（运行时回退代码生成）：%s' % (len(missing), ', '.join(missing)))
    print('内联合计 %.2f MB 原始 -> %.2f MB base64' % (total / 1048576, total * 4 / 3 / 1048576))

new_html = html[:m.start(1)] + new_body + html[m.end(1):]

bak = os.path.join(ROOT, 'playable.bak-%s-inline-lm.html' % datetime.date.today().strftime('%Y%m%d'))
if not os.path.exists(bak):
    shutil.copyfile(HTML, bak)
    print('备份：%s' % os.path.basename(bak))

io.open(HTML, 'w', encoding='utf-8', newline='').write(new_html)
print('playable.html = %.1f MB' % (os.path.getsize(HTML) / 1024 / 1024))
