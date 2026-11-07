#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成内测版 playable-beta.html。

与正式版的差异只有四处，全部在这里声明，正式版不受影响：
  1. 地图切换 3000m → 500m（SCENE_SEG_LEN 四张图一起改）
  2. 人物无敌（checkCollisions 早退挡碰撞死；die() 入口早退挡「转向判负」这类
     不经过 checkCollisions 的死因——校园拐错方向就是直接调 die()）
  3. 页面标题加「内测版」
  4. HUD 右上角加「🧪 内测版 · 无敌」角标

用法：
    "D:/PythonAPPS/python386/python.exe" tools/make-beta.py

设计说明：
  · 无敌挂在 checkCollisions 的入口，而不是每帧拉满 S.transGrace。
    transGrace 是「转场无敌」的计时器，每帧会被 -dt 递减；如果靠每帧拉满来维持，
    一旦某帧的更新顺序变了就会漏一帧，出现偶发死亡。用常量早退是确定性的。
  · 不碰 surfaceAt / 跳跃 / 重力：无敌只跳过碰撞判定，玩家仍会被坡道正常抬起、
    仍能站上车顶，手感不变。穿模是必然的（不判定就不会被挡），这是无敌的代价。
"""

import io
import os
import sys

SRC = 'playable.html'
DST = 'playable-beta.html'

s = io.open(SRC, encoding='utf-8', newline='').read()
orig_len = len(s)
changes = []


def rep(old, new, note):
    """精确替换：锚点必须存在且唯一，否则直接报错，不允许静默失败。"""
    global s
    n = s.count(old)
    assert n == 1, '锚点异常（出现 %d 次）: %s' % (n, note)
    s = s.replace(old, new, 1)
    changes.append(note)
    print('  [OK] ' + note)


print('读取 %s（%.2f MB）' % (SRC, orig_len / 1048576))

# ---------------------------------------------------------------- ① 段长 500m
rep(
    "const SCENE_SEG_LEN = { lakeside: [3000, 3000], tunnel: [3000, 3000], city: [3000, 3000], campus: [3000, 3000] };",
    "// 内测版：每 500 米换一张图（正式版是 3000）。\n"
    "// 四张图一起改，否则换到某张图时会跳回 3000，节奏忽快忽慢。\n"
    "const SCENE_SEG_LEN = { lakeside: [500, 500], tunnel: [500, 500], city: [500, 500], campus: [500, 500] };",
    '地图切换 3000m → 500m',
)

rep(
    "segEnd: SCENE_SEG_LEN.lakeside[0],   // 本段结束里程（首段同样是整段 3000 米）",
    "segEnd: SCENE_SEG_LEN.lakeside[0],   // 本段结束里程（首段同样是整段 500 米）",
    '首段注释同步为 500m',
)

# ---------------------------------------------------------------- ② 人物无敌
rep(
    "function die(text) {\n    S.lastDeathCause = text;",
    "// 内测版：die() 入口同样无敌。转向判负（校园拐错方向）不走 checkCollisions，\n"
    "// 只挡 checkCollisions 会漏掉它——玩家会被「拐错了，撞上了教学楼」弄死。\n"
    "// 双人对战时取消无敌（PvP 要真判死，不然比不出胜负）。\n"
    "function die(text) {\n"
    "    if (BETA_GOD && !PKVS_PVP()) { console.info('[beta] 无敌挡掉死因：' + text); return; }\n"
    "    S.lastDeathCause = text;",
    'die() 入口无敌（覆盖转向判负等直接死因）',
)

rep(
    "function checkCollisions(dt) {\n    if (S.transGrace > 0) return;   // 转场无敌期",
    "// 内测版：人物无敌。所有死法（撞车 / 支撑柱 / 被保安抓住）都走 checkCollisions，\n"
    "// 在这里早退就等于关掉了全部死亡判定。\n"
    "// 没有用「每帧把 S.transGrace 拉满」的写法：它是转场无敌的计时器，每帧会被 -dt 递减，\n"
    "// 靠外部维持满值一旦遇到更新顺序变化就会漏一帧、出现偶发死亡。常量早退是确定性的。\n"
    "// 双人对战时取消无敌：PvP 里撞车必须判死，否则两人都跑不完终点。\n"
    "const BETA_GOD = true;\n"
    "// 对战中（PKVS 接入层会把 __PKVS_APP.active 置 true）关掉无敌。\n"
    "// 必须每次调用时求值：模块加载时还没进对局，写成常量会永远为 false。\n"
    "const PKVS_PVP = () => !!(window.__PKVS_APP && window.__PKVS_APP.active);\n"
    "\n"
    "function checkCollisions(dt) {\n"
    "    if (BETA_GOD && !PKVS_PVP()) return;   // 内测版：无敌，不做任何碰撞判定\n"
    "    if (S.transGrace > 0) return;   // 转场无敌期",
    '人物无敌（checkCollisions 早退）',
)

# ---------------------------------------------------------------- ③ 标题
rep(
    "<title>胡艺凡快跑 3D</title>",
    "<title>胡艺凡快跑 3D · 内测版</title>",
    '页面标题加「内测版」',
)

# ------------------------------------------------- ④ 自检：撞车三项期望反转
# 内测版人物无敌，checkCollisions 直接早退，所以「撞车会死」这三项自检必然失败。
# 不跳过它们（那等于把问题藏起来），而是把期望反过来：撞了仍然活着才算通过。
# 这样自检依然在验证「无敌确实生效」。
rep(
    """    ok('被行驶小汽车撞上直接失败', runUntilDying());
    setupMoving(4, 10);                              // 护盾开着但不足 5 级
    ok('护盾不足5级挡不住行驶障碍', runUntilDying());""",
    """    // 内测版：人物无敌，撞车不会死。期望反转 —— 撞了仍然活着才算通过，
    // 这样自检仍然在验证「无敌确实生效」，而不是靠跳过掩盖问题。
    ok('内测版无敌：撞上行驶小汽车也不死', !runUntilDying());
    setupMoving(4, 10);                              // 护盾开着但不足 5 级
    ok('内测版无敌：护盾不足 5 级撞上也不死', !runUntilDying());""",
    '自检：撞车两项期望反转',
)

rep(
    "    ok('护盾Lv5可挡一次行驶撞击', blocked, 'state=' + S.state + ' shield=' + S.power.shield.toFixed(1));",
    """    // 无敌版里 checkCollisions 早退，movingCrash 根本不会被调用，
    // 所以护盾既不会被消耗、障碍也不会消失（blocked 恒 false）。
    ok('内测版无敌：行驶障碍不再消耗护盾', !blocked && S.state === 'playing' && S.power.shield > 0,
        'state=' + S.state + ' shield=' + S.power.shield.toFixed(1));""",
    '自检：护盾消耗期望反转',
)

# ---------------------------------------------------------------- ⑤ HUD 角标
rep(
    '        <div id="hudDist">0 m</div>\n    </div>\n</div>',
    '        <div id="hudDist">0 m</div>\n'
    '        <div id="hudBeta" style="color:#ffb347;font-weight:700;'
    'text-shadow:0 0 8px rgba(255,150,40,.65);">🧪 内测版 · 无敌</div>\n'
    '    </div>\n</div>',
    'HUD 加「内测版 · 无敌」角标',
)

# ---------------------------------------------------------------- 落盘
io.open(DST, 'w', encoding='utf-8', newline='').write(s)

out_len = len(s)
print('')
print('已写出 %s（%.2f MB，字符数 %+d）' % (DST, out_len / 1048576, out_len - orig_len))
print('共 %d 处改动：' % len(changes))
for i, c in enumerate(changes, 1):
    print('  %d. %s' % (i, c))

# ------------------------------------------------- 顺带生成「秒开」测试副本
# playable-beta.html 有 48MB 内联 base64 模型，无头浏览器 fetch 这个 data: URI
# 会卡几分钟，自动化根本跑不动。把三处模型换成 /assets/*.glb（同一批模型，走 HTTP）
# 就能 2 秒加载。这份只用于验证，不参与交付。
import re

pat = re.compile(r'data:model/gltf-binary;base64,[A-Za-z0-9+/=]{200,}')
# 去重后只剩两段：角色（PLAYER_GLB 常量）+ 保安
paths = ['/assets/character.glb', '/assets/guard2_rigged.glb']
# 校园底板是 data URI，但它是关卡底板、不是角色模型：
# 内测版本体保留内联（双击也能跑），只有 .perf-beta 测试副本换回 HTTP 免得无头浏览器卡死
# 2026-11-04 起底板改成 gzip+base64（gz:model/...），用 '[^']*' 一网打尽三种形态
sp = re.sub(r"const CAMPUS_PLATE_URL = '[^']*';",
            "const CAMPUS_PLATE_URL = 'assets/campus/beida-campus.glb';", s)
sp = re.sub(r"const CAMPUS2_PLATE_URL = '[^']*';",
            "const CAMPUS2_PLATE_URL = 'assets/campus2/bmu-campus.glb';", sp)

sp = re.sub(r"const GATE_URL = '[^']*';", "const GATE_URL = 'assets/models/scu_gate.glb';", sp)
sp = re.sub(r"const LISBOA_URL = '[^']*';", "const LISBOA_URL = 'assets/landmarks/lisboa.glb';", sp)

# three 也换成本地副本（和 make-test-builds.py 保持一致）：
# 这台机器连不上 jsdelivr，测试副本还从 CDN 拉 three 的话页面直接白屏。
# 必须在 finditer 之前改 —— 改完 sp 的长度变了，偏移要重新算。
sp = re.sub(r'"three":\s*"https://cdn\.jsdelivr\.net/[^"]+"',
            '"three": "./lib/three.module.js"', sp)
sp = re.sub(r'"three/addons/":\s*"https://cdn\.jsdelivr\.net/[^"]+"',
            '"three/addons/loaders/GLTFLoader.js": "./lib/GLTFLoader.js",\n'
            '    "three/addons/utils/BufferGeometryUtils.js": "./lib/BufferGeometryUtils.js"', sp)

# 正式版把 three 内联成 data URI 了；测试副本换回同目录 lib/，别每次解码 1.8MB
# （和 make-test-builds.py 保持同一套规则）
sp = re.sub(r'("three/addons/loaders/GLTFLoader\.js":\s*)"data:text/javascript;base64,[A-Za-z0-9+/=]+"',
            r'\1"./lib/GLTFLoader.js"', sp)
sp = re.sub(r'("three/addons/utils/BufferGeometryUtils\.js":\s*)"data:text/javascript;base64,[A-Za-z0-9+/=]+"',
            r'\1"./lib/BufferGeometryUtils.js"', sp)
sp = re.sub(r'("three":\s*)"data:text/javascript;base64,[A-Za-z0-9+/=]+"',
            r'\1"./lib/three.module.js"', sp)

parts, last, n = [], 0, 0
for m in pat.finditer(sp):
    parts.append(sp[last:m.start()])
    parts.append(paths[n] if n < len(paths) else '')
    last = m.end()
    n += 1
parts.append(sp[last:])

LITE = '.perf-beta.html'
io.open(LITE, 'w', encoding='utf-8', newline='').write(''.join(parts))
print('')
print('已写出 %s（测试副本，模型走 HTTP，替换 %d 处内联模型）' % (LITE, n))
