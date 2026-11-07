#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 three / GLTFLoader / BufferGeometryUtils 内联进 playable.html 的 importmap。

为什么要内联
------------
playable.html 是要通过微信 / QQ 直接发给别人、对方双击就能开的东西。原来 three 还从
jsdelivr 拉，等于「38MB 的模型全内联了，唯独引擎要联网」—— 对方没网 / CDN 被墙就是白屏。
（2026-11-02 实测：jsdelivr 完全不通时，双击 playable.html 90 秒都起不来。）

为什么用 data URI 而不是同目录 lib/
------------------------------
同目录 lib/ 意味着要连着三个文件一起发，少一个就白屏。data URI 让「单文件」名副其实。

为什么还要改写 GLTFLoader 的导入
------------------------
data: URL 没有 base，它里面的 `from './three.module.js'` 解析不了。改成裸标识符 'three'，
再由 importmap 映射到另一条 data URI。这是整件事唯一需要动源码的地方。

用法
----
    "D:/PythonAPPS/python386/python.exe" tools/inline-three.py
    "D:/PythonAPPS/python386/python.exe" tools/inline-three.py --check
    "D:/PythonAPPS/python386/python.exe" tools/inline-three.py --restore   # 换回 CDN
"""

import base64
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = 'playable.html'
CHECK = '--check' in sys.argv
RESTORE = '--restore' in sys.argv

CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0'
LIBS = [
    # (importmap 键, 本地文件, 显示名)
    ('three', 'lib/three.module.js', 'three'),
    ('three/addons/loaders/GLTFLoader.js', 'lib/GLTFLoader.js', 'GLTFLoader'),
    ('three/addons/utils/BufferGeometryUtils.js', 'lib/BufferGeometryUtils.js', 'BufferGeometryUtils'),
]

# 整块 importmap（两种形态都吃：CDN 版 / data URI 版）
IMPORTMAP = re.compile(r'<script type="importmap">\s*\{ "imports": \{.*?\} \}\s*</script>', re.S)


def read(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8', newline='').read()


def data_uri(code):
    """模块源码 → data URI。base64 只含 A-Za-z0-9+/=，塞进 JSON 字符串绝对安全，
    也不会因为源码里出现 </script 而炸掉 HTML 解析。"""
    b64 = base64.b64encode(code.encode('utf-8')).decode('ascii')
    return 'data:text/javascript;base64,' + b64


def build_map():
    """生成新的 importmap 块（顺带打印每个库压了多少）。"""
    lines = []
    total = 0
    for key, path, name in LIBS:
        code = read(path)
        if name == 'GLTFLoader':
            # data: URL 没有 base，相对导入必须换成裸标识符
            n1 = code.count("from './three.module.js'")
            n2 = code.count("from './BufferGeometryUtils.js'")
            code = code.replace("from './three.module.js'", "from 'three'")
            code = code.replace("from './BufferGeometryUtils.js'",
                                "from 'three/addons/utils/BufferGeometryUtils.js'")
            assert n1 == 1 and n2 == 1, 'GLTFLoader 的相对导入变了（%d / %d），先看一眼再改' % (n1, n2)
        elif name == 'BufferGeometryUtils':
            n1 = code.count("from './three.module.js'")
            code = code.replace("from './three.module.js'", "from 'three'")
            assert n1 == 1, 'BufferGeometryUtils 的相对导入变了（%d）' % n1
        uri = data_uri(code)
        total += len(uri)
        lines.append('    "%s": "%s"' % (key, uri))
        print('  [OK] %-20s %7.1f KB → %7.1f KB (base64)'
              % (name, len(code.encode('utf-8')) / 1024.0, len(uri) / 1024.0))
    body = ',\n'.join(lines)
    block = '<script type="importmap">\n{ "imports": {\n' + body + '\n} }\n</script>'
    return block, total


def build_cdn_map():
    return ('<script type="importmap">\n{ "imports": {\n'
            '    "three": "%s/build/three.module.js",\n'
            '    "three/addons/": "%s/examples/jsm/"\n'
            '} }\n</script>' % (CDN, CDN))


s = read(SRC)
orig = len(s)

mo = IMPORTMAP.search(s)
assert mo, '找不到 importmap 块'
old_block = mo.group(0)
already = 'data:text/javascript;base64' in old_block
print('读取 %s（%.2f MB）' % (SRC, orig / 1048576.0))
print('当前 importmap：%s' % ('已内联' if already else '走 CDN'))

if RESTORE:
    if not already:
        print('  没内联过，无需还原')
        sys.exit(0)
    new_block = build_cdn_map()
    s = s[:mo.start()] + new_block + s[mo.end():]
    io.open(os.path.join(ROOT, SRC), 'w', encoding='utf-8', newline='').write(s)
    print('\n已还原成 CDN 版（%.2f MB）' % (len(s) / 1048576.0))
    sys.exit(0)

new_block, total = build_map()
s = s[:mo.start()] + new_block + s[mo.end():]

if CHECK:
    print('\n--check：importmap %.1f KB，写盘后约 %.2f MB，未写盘'
          % (total / 1024.0, len(s) / 1048576.0))
    sys.exit(0)

io.open(os.path.join(ROOT, SRC), 'w', encoding='utf-8', newline='').write(s)
print('\n已写出 %s（%.2f MB → %.2f MB，+%.2f MB）'
      % (SRC, orig / 1048576.0, len(s) / 1048576.0, (len(s) - orig) / 1048576.0))
print('现在双击这个文件不再需要联网。')
