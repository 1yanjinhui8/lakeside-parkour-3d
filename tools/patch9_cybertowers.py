# -*- coding: utf-8 -*-
"""
patch9_cybertowers.py —— 把 js/oldtown.js 的新版（赛博高塔）内联进 playable.html

playable.html 是单文件发布版，js/oldtown.js 在打包时会被去 export 后内联。
本脚本就地替换「内联模块：js/oldtown.js」那一段，不动其它任何内容。
"""
import io, os, re, shutil, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'playable.html')
SRC = os.path.join(ROOT, 'js', 'oldtown.js')

MARK = '// ---- 内联模块：js/oldtown.js'
ANCHOR = '\nconst ATMO = createAtmo({ THREE, scene, camera, hemi, sun });'

html = io.open(HTML, encoding='utf-8', newline='').read()
src = io.open(SRC, encoding='utf-8').read()
src = re.sub(r'^export\s+', '', src, flags=re.M)

i = html.find(MARK)
if i < 0:
    raise SystemExit('!! 找不到 oldtown 内联标记')
j = html.find(ANCHOR, i)
if j < 0:
    raise SystemExit('!! 找不到 ATMO 锚点')

old_len = j - i
bak = os.path.join(ROOT, 'playable.bak-%s-cybertowers.html' % datetime.date.today().strftime('%Y%m%d'))
if not os.path.exists(bak):
    shutil.copyfile(HTML, bak)

new_block = ('// ---- 内联模块：js/oldtown.js（赛博高塔 + 赛博街道） ----\n' + src + '\n')
html = html[:i] + new_block + html[j:]

io.open(HTML, 'w', encoding='utf-8', newline='').write(html)
print('替换 %d 字符 -> %d 字符' % (old_len, len(new_block)))
print('备份：%s' % os.path.basename(bak))
print('playable.html = %.1f MB' % (os.path.getsize(HTML) / 1024 / 1024))
