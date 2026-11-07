# -*- coding: utf-8 -*-
"""
dedupe-player.py —— 把重复内联的「角色 GLB」抽成一个常量

历史原因，同一个 14.9MB 的角色模型在 playable.html 里出现了两次：
  ① CONFIG.player.model 数组（开局加载角色）
  ② 后面「重绑骨源网格」的 loadAsync(...)
两份字节完全相同，等于白占 14.9MB（base64 后）。

这里把它抽成 `const PLAYER_GLB = '...'`，两处改成引用：
    model: [PLAYER_GLB, ''],
    loadAsync(PLAYER_GLB)
画质、行为都不变，文件直接小 14.9MB。

注意：模型串在原文件里带引号（`"data:..."` 或 `'data:...'`），替换必须连引号一起吃掉，
否则会留下 `"PLAYER_GLB"` 这种字符串字面量（第一次就踩了这个坑）。

用法：
    python tools/dedupe-player.py --check   # 只报状态
    python tools/dedupe-player.py           # 执行（幂等）
"""
import hashlib
import io
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'playable.html')
CONST_NAME = 'PLAYER_GLB'

# 连引号一起匹配：group(2) 是纯 base64 主体
PAT = re.compile(r'(["\']?)(data:model/gltf-binary;base64,[A-Za-z0-9+/=]{1000,})\1')

s = io.open(HTML, encoding='utf-8', newline='').read()

if ('const %s =' % CONST_NAME) in s:
    print('已经去过重（存在 const %s）' % CONST_NAME)
    sys.exit(0)

hits = []
for m in PAT.finditer(s):
    uri = m.group(2)
    h = hashlib.sha256(uri.encode('ascii')).hexdigest()[:12]
    hits.append((m.start(), m.end(), h, uri))

cnt = Counter(x[2] for x in hits)
dup = [h for h, c in cnt.items() if c > 1]
print('内联模型 %d 段，重复的 %d 组' % (len(hits), len(dup)))
if not dup:
    print('没有重复，无需处理')
    sys.exit(0)

# 取「在 CONFIG.player.model 里」的那一段作为常量来源
target = None
for st, en, h, uri in hits:
    if h != dup[0]:
        continue
    if 'model: [' in s[max(0, st - 60):st]:
        target = (st, en, h, uri)
        break
if not target:
    raise SystemExit('!! 没找到 CONFIG.player.model 里的角色模型')

st, en, h, uri = target
print('重复模型 %.1fMB × %d' % (len(uri) / 1048576, cnt[h]))

if '--check' in sys.argv:
    print('--check：可省约 %.1fMB' % (len(uri) * (cnt[h] - 1) / 1048576))
    sys.exit(0)

# 1) 先把同哈希的所有出现处（连引号）换成常量名
out, last, n_rep = [], 0, 0
for m in PAT.finditer(s):
    if hashlib.sha256(m.group(2).encode('ascii')).hexdigest()[:12] != h:
        continue
    out.append(s[last:m.start()])
    out.append(CONST_NAME)
    last = m.end()
    n_rep += 1
out.append(s[last:])
s = ''.join(out)

# 2) 再插入常量定义（顺序很重要：先插会把自己那一行也替换掉）
anchor = 'const CONFIG = {'
assert s.count(anchor) == 1, 'CONFIG 锚点异常'
s = s.replace(anchor,
              "// 角色 GLB：只存一份（以前在 model 数组和重绑骨源里各写了一遍，白占 14.9MB）\n"
              "const %s = '%s';\n\n%s" % (CONST_NAME, uri, anchor), 1)

io.open(HTML, 'w', encoding='utf-8', newline='').write(s)
print('替换 %d 处引用 · playable.html = %.1f MB' % (n_rep, os.path.getsize(HTML) / 1048576))
