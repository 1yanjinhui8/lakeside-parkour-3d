# -*- coding: utf-8 -*-
"""
refresh-inline-models.py —— 把 playable.html 里内联的角色 / 保安换成本地最新文件

这两个模型没有独立的内联脚本（当年是直接贴进 html 的），改了 assets/*.glb 之后
必须手动同步，否则文件里还是旧模型。这里按「旧文件哈希」定位 data URI：

    tmp/backup-models-slim/guard2_rigged.glb   → 旧字节，用来认出是哪一段
    assets/guard2_rigged.glb                   → 新字节，替换进去

用法：
    python tools/refresh-inline-models.py --check
    python tools/refresh-inline-models.py
"""
import base64
import hashlib
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'playable.html')
BAK = os.path.join(ROOT, 'tmp', 'backup-models-slim')
JOBS = ['guard2_rigged.glb', 'character.glb']
PAT = re.compile(r'(["\']?)(data:model/gltf-binary;base64,([A-Za-z0-9+/=]{1000,}))\1')

s = io.open(HTML, encoding='utf-8', newline='').read()
mode_check = '--check' in sys.argv

for name in JOBS:
    old = os.path.join(BAK, name)
    new = os.path.join(ROOT, 'assets', name)
    if not (os.path.exists(old) and os.path.exists(new)):
        print('%-22s 跳过（缺备份或新文件）' % name)
        continue
    old_sha = hashlib.sha256(io.open(old, 'rb').read()).hexdigest()
    new_raw = io.open(new, 'rb').read()
    new_sha = hashlib.sha256(new_raw).hexdigest()
    new_b64 = 'data:model/gltf-binary;base64,' + base64.b64encode(new_raw).decode('ascii')

    hit = None
    for m in PAT.finditer(s):
        if hashlib.sha256(base64.b64decode(m.group(3))).hexdigest() == old_sha:
            hit = m
            break
    if not hit:
        # 已经是新模型？
        same = False
        for m in PAT.finditer(s):
            if hashlib.sha256(base64.b64decode(m.group(3))).hexdigest() == new_sha:
                same = True
                break
        print('%-22s %s' % (name, '已是新模型' if same else '★没找到旧模型★'))
        continue

    print('%-22s %.2fMB -> %.2fMB  @%d' % (name, len(base64.b64decode(hit.group(3))) / 1048576,
                                          len(new_raw) / 1048576, hit.start()))
    if not mode_check:
        quote = hit.group(1) or "'"
        s = s[:hit.start()] + quote + new_b64 + quote + s[hit.end():]

if mode_check:
    print('（--check：没写文件）')
    sys.exit(0)

io.open(HTML, 'w', encoding='utf-8', newline='').write(s)
print('playable.html = %.1f MB' % (os.path.getsize(HTML) / 1048576))
