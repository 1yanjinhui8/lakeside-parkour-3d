# -*- coding: utf-8 -*-
"""
patch10_inline.py —— 把 js/*.js 源码重新内联进 playable.html

playable.html 是单文件发布版：js/atmo.js、js/oldtown.js、js/OrbitFanfareCamera.js
在打包时会被去 export 后内联。本脚本按「内联模块」标记就地替换这些段，
不动其它任何内容（包括主模块里的手改）。

两种语义：
  · replace —— 段已存在：从 banner 替换到下一个锚点
  · insert  —— 段还不存在：插到锚点之前（只做一次，之后走 replace）

用法：
    python tools/patch10_inline.py            # 全部重内联
    python tools/patch10_inline.py atmo       # 只重内联 atmo
    python tools/patch10_inline.py oldtown
    python tools/patch10_inline.py fanfare
"""
import io, os, re, shutil, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'playable.html')

# name: (源文件, banner, 结束锚点, 缺失时的插入锚点 or None)
BLOCKS = {
    'atmo': (
        os.path.join(ROOT, 'js', 'atmo.js'),
        '// ---- 内联模块：js/atmo.js（昼夜/天气） ----\n',
        '// ---- 内联模块：js/oldtown.js',
        None,
    ),
    'oldtown': (
        os.path.join(ROOT, 'js', 'oldtown.js'),
        '// ---- 内联模块：js/oldtown.js（赛博高塔 + 赛博街道） ----\n',
        '\nconst ATMO = createAtmo({ THREE, scene, camera, hemi, sun });',
        None,
    ),
    'fanfare': (
        os.path.join(ROOT, 'js', 'OrbitFanfareCamera.js'),
        '// ---- 内联模块：js/OrbitFanfareCamera.js（终点环绕过场镜头） ----\n',
        '\n// ---- 终点环绕过场：实例与状态',
        '\nconst camPos = new THREE.Vector3(0, 4.3, 7.4), camLook = new THREE.Vector3(0, 1.3, -9);\n',
    ),
    # 地标 GLB 接入层：必须在 `const ATMO = createAtmo(...)` 之后（要用 ATMO），
    # 结束锚点是实例化那一行——块内只放 createLandmarkGLB 的定义，实例化留在块外，
    # 这样重内联不会把 `new` 出来的实例一起覆盖掉。
    'landmarks': (
        os.path.join(ROOT, 'js', 'landmarks.js'),
        '// ---- 内联模块：js/landmarks.js（地标 GLB 接入） ----\n',
        '\nconst LMGLB = createLandmarkGLB(',
        '\nconst LMGLB = createLandmarkGLB(',
    ),
}


def strip_exports(src):
    # `export default X;` 整行删掉（否则会剩一个裸的 `default X;` 语法错）
    src = re.sub(r'^export\s+default\s+[^;\n]*;?[ \t]*\n', '', src, flags=re.M)
    src = re.sub(r'^export\s+', '', src, flags=re.M)
    return src


# 需要作用域隔离的块：模块里可能有和宿主同名的内部函数（clamp / damp / UP ...），
# 直接内联会 "Identifier has already been declared"。用 IIFE 包起来只导出类名。
WRAP = {
    'fanfare': 'OrbitFanfareCamera',
}

want = sys.argv[1:] or list(BLOCKS)
for k in want:
    if k not in BLOCKS:
        raise SystemExit('!! 未知模块 %s（可选：%s）' % (k, ' / '.join(BLOCKS)))

html = io.open(HTML, encoding='utf-8', newline='').read()

bak = os.path.join(ROOT, 'playable.bak-%s-inline.html' % datetime.date.today().strftime('%Y%m%d'))
if not os.path.exists(bak):
    shutil.copyfile(HTML, bak)
    print('备份：%s' % os.path.basename(bak))

for k in want:
    src_path, banner, anchor, insert_at = BLOCKS[k]
    src = strip_exports(io.open(src_path, encoding='utf-8').read())
    if k in WRAP:
        src = ('const %s = (function () {\n' % WRAP[k]) + src.rstrip('\n') + \
              ('\nreturn %s;\n})();' % WRAP[k])
    new_block = banner + src.rstrip('\n') + '\n'

    mark = banner.strip()
    i = html.find(mark)
    if i >= 0:
        j = html.find(anchor, i + len(mark))
        if j < 0:
            raise SystemExit('!! 找不到 %s 的结束锚点' % k)
        old_len = j - i
        html = html[:i] + new_block + html[j:]
        print('%s: 替换 %d 字符 -> %d 字符' % (k, old_len, len(new_block)))
    elif insert_at:
        p = html.find(insert_at)
        if p < 0:
            raise SystemExit('!! 找不到 %s 的插入锚点' % k)
        html = html[:p] + '\n' + new_block + html[p:]
        print('%s: 首次插入 %d 字符' % (k, len(new_block)))
    else:
        raise SystemExit('!! 找不到 %s 的内联标记' % k)

io.open(HTML, 'w', encoding='utf-8', newline='').write(html)
print('playable.html = %.1f MB' % (os.path.getsize(HTML) / 1024 / 1024))
