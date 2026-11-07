# -*- coding: utf-8 -*-
"""inline-campus.py —— 把两块校园底板以 gzip 形式内联进 playable.html

为什么不用原来的裸 base64：
    beida-campus.glb 8.28MB + bmu-campus.glb 4.22MB = 12.5MB，
    转成 base64 是 16.7MB —— 占了 playable.html 的四成。而 GLB 的几何数据
    压缩率极高（gzip 后 8.28→1.84、4.22→1.14，约 23%），base64 之后只要 4.0MB。
    运行时用浏览器原生的 DecompressionStream('gzip') 解压，再交给 GLTFLoader，
    解析出来的场景和原来完全一致。

用法：
    python tools/inline-campus.py            # 内联（gzip + base64）
    python tools/inline-campus.py --plain    # 退回裸 base64（调试兼容用）
    python tools/inline-campus.py --restore  # 还原成 HTTP 路径
    python tools/inline-campus.py --check    # 只检查状态，不写文件

幂等：重复跑结果一致。
"""
import base64
import gzip
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'playable.html')

PLATES = [
    ('CAMPUS_PLATE_URL', 'assets/campus/beida-campus.glb'),
    ('CAMPUS2_PLATE_URL', 'assets/campus2/bmu-campus.glb'),
]

mode = 'gzip'
args = sys.argv[1:]
if '--restore' in args:
    mode = 'restore'
elif '--check' in args:
    mode = 'check'
elif '--plain' in args:
    mode = 'plain'

html = io.open(HTML, encoding='utf-8', newline='').read()

for VAR, REL in PLATES:
    # 三种形态都要认：裸 base64 / gz 前缀 / HTTP 路径
    pat = re.compile(r"const %s = '[^']*';" % VAR)
    m = pat.search(html)
    assert m, '找不到 %s 声明' % VAR
    cur = m.group(0)

    if mode == 'check':
        kind = 'gz' if cur.startswith("const %s = 'gz:" % VAR) else (
            'base64' if "base64," in cur else 'http')
        print('%s：%s（%.2f MB）' % (VAR, kind, len(cur) / 1048576))
        continue

    if mode == 'restore':
        new = "const %s = '%s';" % (VAR, REL)
        html = html[:m.start()] + new + html[m.end():]
        print('%s：已还原成 HTTP 路径' % VAR)
        continue

    raw = open(os.path.join(ROOT, REL), 'rb').read()
    if mode == 'plain':
        b64 = base64.b64encode(raw).decode('ascii')
        new = "const %s = 'data:model/gltf-binary;base64,%s';" % (VAR, b64)
    else:
        # mtime=0：让压缩结果稳定（否则每次构建字节都不同，diff 全是噪声）
        gz = gzip.compress(raw, 9, mtime=0)
        b64 = base64.b64encode(gz).decode('ascii')
        new = "const %s = 'gz:model/gltf-binary;base64,%s';" % (VAR, b64)
        print('%s：%.2f MB → gzip %.2f MB → base64 %.2f MB'
              % (VAR, len(raw) / 1048576, len(gz) / 1048576, len(new) / 1048576))
    html = html[:m.start()] + new + html[m.end():]

io.open(HTML, 'w', encoding='utf-8', newline='').write(html)
print('整份 html %.2f MB' % (len(html) / 1048576))
