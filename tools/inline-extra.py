# -*- coding: utf-8 -*-
"""把「必须单文件可用」的两个模型内联进 playable.html。

为什么必须内联：file:// 下 fetch 本地 .glb 会被 CORS 拦（origin null），
于是双击版里新葡京回退成代码生成、川大校门直接不出现。项目定位是「双击就能玩」，
所以这两个模型只能进单文件。

为什么先瘦身：两个模型各 7.5MB，其中 3.6~4.1MB 是三张 1024 PNG。用
tools/slim-glb.py 换成 q86 JPEG 后各降到 4.2MB，再 gzip+base64 到 4.4MB。
运行时用和校园底板同一套 resolvePlate（DecompressionStream）。

用法：
    python tools/slim-glb.py assets/models/scu_gate.glb tmp/scu_gate_slim.glb
    python tools/slim-glb.py assets/landmarks/lisboa.glb tmp/lisboa_slim.glb
    python tools/inline-extra.py            # 内联（读 tmp/*_slim.glb）
    python tools/inline-extra.py --restore  # 还原成 HTTP 路径
"""
import base64
import gzip
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'playable.html')

ITEMS = [
    ('GATE_URL', 'tmp/scu_gate_slim.glb', 'assets/models/scu_gate.glb'),
    ('LISBOA_URL', 'tmp/lisboa_slim.glb', 'assets/landmarks/lisboa.glb'),
]

restore = '--restore' in sys.argv
html = io.open(HTML, encoding='utf-8', newline='').read()

for VAR, SLIM, HTTP in ITEMS:
    pat = re.compile(r"(const %s = ')([^']*)(';)" % VAR)
    m = pat.search(html)
    assert m, '找不到 %s 声明' % VAR
    if restore:
        html = html[:m.start()] + m.group(1) + HTTP + m.group(3) + html[m.end():]
        print('%s -> %s' % (VAR, HTTP))
        continue
    src = os.path.join(ROOT, SLIM)
    assert os.path.exists(src), '缺 %s，先跑 tools/slim-glb.py' % SLIM
    raw = open(src, 'rb').read()
    gz = gzip.compress(raw, 9, mtime=0)
    b64 = base64.b64encode(gz).decode('ascii')
    new = m.group(1) + 'gz:model/gltf-binary;base64,' + b64 + m.group(3)
    html = html[:m.start()] + new + html[m.end():]
    print('%s: %.2fMB -> gzip %.2fMB -> base64 %.2fMB' % (VAR, len(raw) / 1e6, len(gz) / 1e6, len(new) / 1e6))

io.open(HTML, 'w', encoding='utf-8', newline='').write(html)
print('整份 html %.2f MB' % (len(html) / 1048576))
