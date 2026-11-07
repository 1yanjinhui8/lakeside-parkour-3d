# -*- coding: utf-8 -*-
"""补丁 1b：把北欧城堡构建代码插入 buildLakesideDecor 之前（1 号补丁漏插）"""
import io, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'playable.html')
src = io.open(P, encoding='utf-8').read()

# 从 patch1_castles.py 里把 CASTLE 文本原样取出来（单一事实来源）
psrc = io.open(os.path.join(ROOT, 'tools', 'patch1_castles.py'), encoding='utf-8').read()
m = re.search(r"CASTLE = r'''(.*?)'''", psrc, re.S)
assert m, '取不到 CASTLE 源码'
CASTLE = m.group(1)

assert 'castleWhiteTex' not in src, '城堡代码似乎已存在'
ANCHOR = 'function buildLakesideDecor() {'
assert src.count(ANCHOR) == 1, '锚点不唯一'

src = src.replace(ANCHOR, CASTLE.strip('\n') + '\n\n' + ANCHOR)
io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('OK  城堡代码已插入，文件 %d 字节' % len(src))
