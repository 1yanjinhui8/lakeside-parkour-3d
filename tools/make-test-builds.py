# -*- coding: utf-8 -*-
"""
make-test-builds.py —— 生成两份「能秒开」的测试副本（playable.html 不动）

背景：playable.html 是 63MB 单文件，48MB 是内联 base64 的 GLB。无头浏览器里
fetch 一个 31MB 的 data: URI 会卡住几分钟（连原版也一样），根本没法跑自动化。

  .perf-real.html  模型改成 /assets/*.glb（同一个模型，走 HTTP）→ 2 秒加载，几何/贴图全是真的
  .perf-lite.html  模型换成 4 字节垃圾 → GLTFLoader 秒失败 → 走代码模型兜底，最轻

这两份只用于测试，不参与发布。
"""
import io, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = io.open(os.path.join(ROOT, 'playable.html'), encoding='utf-8').read()
pat = re.compile(r'data:model/gltf-binary;base64,[A-Za-z0-9+/=]{200,}')

# 川大校门 / 新葡京：2026-11-04 起以 gz: 形式内联（file:// 下 fetch .glb 会被 CORS 拦）。
# 测试副本换回 HTTP，省掉 8.8MB base64 解码。
src = re.sub(r"const GATE_URL = '[^']*';", "const GATE_URL = 'assets/models/scu_gate.glb';", src)
src = re.sub(r"const LISBOA_URL = '[^']*';", "const LISBOA_URL = 'assets/landmarks/lisboa.glb';", src)

# three 也换成本地副本：这台机器经常连不上 jsdelivr，不放这个的话所有浏览器测试
# 都会卡在 `import 'three'` 上（页面白屏，看不出是网络问题）。
# 注意 three/addons/ 前缀映射不能用 —— 本地 lib/ 没有 loaders/ 子目录，
# 必须给 GLTFLoader / BufferGeometryUtils 各写一条精确映射
# （精确键的优先级高于前缀键）。
src = re.sub(r'"three":\s*"https://cdn\.jsdelivr\.net/[^"]+"',
             '"three": "./lib/three.module.js"', src)
src = re.sub(r'"three/addons/":\s*"https://cdn\.jsdelivr\.net/[^"]+"',
             '"three/addons/loaders/GLTFLoader.js": "./lib/GLTFLoader.js",\n'
             '    "three/addons/utils/BufferGeometryUtils.js": "./lib/BufferGeometryUtils.js"', src)

# 正式版已经把 three 内联成 data URI 了（发给别人不用联网）。测试副本没必要跟着
# 每次解码 1.8MB base64，换回同目录 lib/ —— 反正跑测试时这些文件就在旁边。
# 注意用 lib/ 里的原版 GLTFLoader：它内部是 './three.module.js' 相对导入，落在 lib/ 下正好。
src = re.sub(r'("three/addons/loaders/GLTFLoader\.js":\s*)"data:text/javascript;base64,[A-Za-z0-9+/=]+"',
             r'\1"./lib/GLTFLoader.js"', src)
src = re.sub(r'("three/addons/utils/BufferGeometryUtils\.js":\s*)"data:text/javascript;base64,[A-Za-z0-9+/=]+"',
             r'\1"./lib/BufferGeometryUtils.js"', src)
src = re.sub(r'("three":\s*)"data:text/javascript;base64,[A-Za-z0-9+/=]+"',
             r'\1"./lib/three.module.js"', src)
# 校园底板不是角色模型：先换回 HTTP，避免被下面的通用替换吃掉
# 带 mtime 版本号：否则无头浏览器会一直用缓存里的旧底板，
# 改了 GLB 但截图一点变化都没有（这个坑踩过一次）
_glb = os.path.join(ROOT, 'assets', 'campus', 'beida-campus.glb')
_ver = int(os.path.getmtime(_glb)) if os.path.exists(_glb) else 0
src = re.sub(r"const CAMPUS_PLATE_URL = '[^']*';",
             "const CAMPUS_PLATE_URL = 'assets/campus/beida-campus.glb?v=%d';" % _ver, src)
_glb2 = os.path.join(ROOT, 'assets', 'campus2', 'bmu-campus.glb')
_ver2 = int(os.path.getmtime(_glb2)) if os.path.exists(_glb2) else 0
src = re.sub(r"const CAMPUS2_PLATE_URL = '[^']*';",
             "const CAMPUS2_PLATE_URL = 'assets/campus2/bmu-campus.glb?v=%d';" % _ver2, src)

# 7 座地标也会被内联（37.8MB base64）：测试副本要改回 HTTP，
# 否则下面的通用替换会把它们统统换成空串 → 地标静默回退成代码生成的塔，
# 截图里永远看不到真模型（这个坑会让人以为「模型没加载」）。
LM_NAMES = ['pearl', 'guomao', 'bamboo', 'gateSuzhou', 'gateHangzhou', 'waist', 'cbd']


def _lm_block(mo):
    body = mo.group(1)
    for k in LM_NAMES:
        f = os.path.join(ROOT, 'assets', 'landmarks', k + '.glb')
        ver = int(os.path.getmtime(f)) if os.path.exists(f) else 0
        body = re.sub(r"(\b" + re.escape(k) + r":\s*)'[^']*'",
                      lambda mm, v='/assets/landmarks/%s.glb?v=%d' % (k, ver): mm.group(1) + "'" + v + "'",
                      body, count=1)
    return 'const LANDMARK_MODELS = {' + body + '\n};'


src = re.sub(r'const LANDMARK_MODELS = \{(.*?)\n\};', _lm_block, src, count=1, flags=re.S)

# 三处内联模型的位置：玩家候选列表 / 重绑骨源网格 / 保安
# 去重后只剩两段：角色（PLAYER_GLB 常量）+ 保安
paths = ['/assets/character.glb', '/assets/guard2_rigged.glb']

out, last, n = [], 0, 0
for m in pat.finditer(src):
    out.append(src[last:m.start()])
    out.append(paths[n] if n < len(paths) else '')
    last = m.end()
    n += 1
out.append(src[last:])
io.open(os.path.join(ROOT, '.perf-real.html'), 'w', encoding='utf-8', newline='').write(''.join(out))

io.open(os.path.join(ROOT, '.perf-lite.html'), 'w', encoding='utf-8', newline='').write(
    pat.sub(lambda m: 'data:model/gltf-binary;base64,AAAA', src))

print('已生成 .perf-real.html / .perf-lite.html（替换 %d 处内联模型）' % n)
