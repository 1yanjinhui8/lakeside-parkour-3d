#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 PKVS 双人对战接进 playable.html（幂等：重复运行只是重刷同一批块）。

做四件事：
  1. 把 assets/vs/pkvs.js + pkvs-lobby.js 内联到单文件里（保持"双击即用"）；
  2. 内联 tools/vs-integration.js（接入层：大厅入口 / 同种子开跑 / 进度 / 判胜负）；
  3. 菜单加「⚔️ 双人对战」按钮 + 让开联机 HUD 的样式；
  4. 游戏主模块里只加 8 个带 [PKVS] 注释的小钩子（便于回滚）。

用法：
    "D:/PythonAPPS/python386/python.exe" tools/add-vs.py
    "D:/PythonAPPS/python386/python.exe" tools/add-vs.py --check   # 只检查不写盘

设计说明：
  · 为什么不把逻辑直接写进主模块：主文件 76MB（40MB 内联模型 + 30MB 校园底板），
    每次改动都要全量读写；逻辑放独立文件，改对战只需重跑本脚本。
  · 关卡一致性用「生成期临时替换 Math.random」实现：spawnRow 内部还套着
    placeRide / placeBarrier / pillarRow，逐处替换容易漏，整段换源最稳。
"""

import io
import os
import sys

SRC = 'playable.html'
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CHECK = '--check' in sys.argv

LIB_FILES = [
    ('assets/vs/pkvs.js', 'PKVS 传输层：WebRTC P2P / 手动信令 / 时钟同步'),
    ('assets/vs/pkvs-lobby.js', 'PKVS 对战大厅：身份 / 三步向导 / 备战 / HUD / 结算'),
]
APP_FILE = 'tools/vs-integration.js'
ITEM_FILE = 'tools/vs-items.js'

LIB_A, LIB_B = '<!-- PKVS:LIBS -->', '<!-- /PKVS:LIBS -->'
ITEM_A, ITEM_B = '<!-- PKVS:ITEMS -->', '<!-- /PKVS:ITEMS -->'
APP_A, APP_B = '<!-- PKVS:APP -->', '<!-- /PKVS:APP -->'
CSS_A, CSS_B = '    /* PKVS:CSS-BEGIN */\n', '    /* PKVS:CSS-END */\n'
MENU_A, MENU_B = '    <!-- PKVS:MENU -->\n', '    <!-- /PKVS:MENU -->\n'
MENU_PLAIN = '    <button class="btn" id="startBtn">开始奔跑</button>\n'

s = io.open(os.path.join(ROOT, SRC), encoding='utf-8', newline='').read()
orig = len(s)
changes = []


def rep(old, new, note):
    """精确替换；已经应用过就跳过（幂等）；锚点不唯一直接报错。"""
    global s
    if new in s:
        print('  [..] 已应用，跳过：' + note)
        return
    n = s.count(old)
    assert n == 1, '锚点异常（出现 %d 次）: %s' % (n, note)
    s = s.replace(old, new, 1)
    changes.append(note)
    print('  [OK] ' + note)


def strip_block(begin, end):
    global s
    i = s.find(begin)
    if i < 0:
        return False
    j = s.find(end, i)
    assert j > 0, '注入块不完整：%s' % begin
    s = s[:i] + s[j + len(end):]
    return True


def read(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8', newline='').read()


print('读取 %s（%.2f MB）' % (SRC, orig / 1048576))

# ------------------------------------------------------------ 0. 清理旧注入
def strip_inject():
    """脚本块（libs + app）当成一整段来拆，连尾随换行一起拆掉，避免越跑越多空行。"""
    global s
    i = s.find(LIB_A)
    if i < 0:
        return False
    j = s.find(APP_B, i)
    assert j > 0, '脚本注入块不完整'
    k = j + len(APP_B)
    if s[k:k + 1] == '\n':
        k += 1
    s = s[:i] + s[k:]
    return True


if strip_inject():
    print('  [..] 清掉上一次注入的脚本块')

for a, b, name in ((CSS_A, CSS_B, 'css'),):
    if strip_block(a, b):
        print('  [..] 清掉上一次注入的 %s 块' % name)

# 菜单块：注入后原本那行「开始奔跑」被包进了 .btnRow，所以拆块时要把它还原成独立一行，
# 否则下次跑锚点就找不到了
_i = s.find(MENU_A)
if _i >= 0:
    _j = s.find(MENU_B, _i)
    assert _j > 0, '菜单注入块不完整'
    s = s[:_i] + MENU_PLAIN + s[_j + len(MENU_B):]
    # 老格式里「开始奔跑」在 marker 外面，还原后会变成两行挨着，去重
    while MENU_PLAIN + MENU_PLAIN in s:
        s = s.replace(MENU_PLAIN + MENU_PLAIN, MENU_PLAIN, 1)
    print('  [..] 清掉上一次注入的 menu 块')

# ------------------------------------------------------------ 1. 内联两个插件
libs = [LIB_A]
for rel, note in LIB_FILES:
    code = read(rel)
    assert '</script' not in code, '%s 里出现 </script，不能直接内联' % rel
    libs += ['<!-- %s -->' % note, '<script>\n' + code + '\n</script>']
libs.append(LIB_B)

app = read(APP_FILE)
assert '</script' not in app, 'vs-integration.js 里出现 </script，不能直接内联'
app_block = '\n'.join([APP_A, '<script>', app, '</script>', APP_B])

items = read(ITEM_FILE)
assert '</script' not in items, 'vs-items.js 里出现 </script，不能直接内联'
item_block = '\n'.join([ITEM_A, '<script>', items, '</script>', ITEM_B])

rep('<script type="module">',
    '\n'.join(libs) + '\n' + item_block + '\n' + app_block + '\n<script type="module">',
    '内联 pkvs.js / pkvs-lobby.js / vs-items.js / vs-integration.js（%.0f KB）'
    % ((len(app) + len(items) + sum(len(read(r)) for r, _ in LIB_FILES)) / 1024.0))
# ------------------------------------------------------------ 2. 样式
CSS = CSS_A + """
    /* ===== 双人对战（PKVS）=====================================
       入口按钮（和「开始奔跑」并排）+ 对局中把游戏 HUD 让开顶部的联机进度条 */
    .btnRow {
        display: flex; gap: 14px; justify-content: center; align-items: center;
        flex-wrap: wrap; margin-top: 16px;
    }
    .btnRow .btn { margin-top: 0; }
    #vsBtn {
        background: linear-gradient(#3ec6ff, #1477c9);
        box-shadow: 0 6px 0 #0b4f8a;
        padding: 14px 34px;
    }
    #vsBtn:active { transform: translateY(4px); box-shadow: 0 2px 0 #0b4f8a; }
    body.pk-vs #hud { top: 86px; }
    body.pk-vs #powers { top: 186px; }
    /* 矮窗口（<620px）时装不下就允许滚动，别把按钮裁掉 */
    #menu { justify-content: safe center; overflow-y: auto; }
""" + CSS_B
rep('</style>', CSS + '</style>', '菜单按钮样式 + 对局 HUD 让位')

# ------------------------------------------------------------ 3. 菜单按钮
# 和「开始奔跑」并排放：竖着再加一个按钮会把菜单顶出 560~650px 的矮窗口
rep(MENU_PLAIN,
    MENU_A +
    '    <div class="btnRow">\n'
    '        <button class="btn" id="startBtn">开始奔跑</button>\n'
    '        <button class="btn" id="vsBtn">⚔️ 双人对战</button>\n'
    '    </div>\n' +
    MENU_B,
    '菜单加「双人对战」入口（与开始奔跑并排）')

# ------------------------------------------------------------ 4. 主模块钩子
# 4.0 道具表：干扰道具必须登记在 CONFIG.powerUps 里，makePowerMesh 才拿得到
#     def（颜色 / 图标），placePickup 也只认这里的 type。duration 填 0——
#     它们不进 S.power 的计时，拾取循环里按 pk_ 前缀直接分流给接入层。
rep("""        wings:    { name: '天使之翼', icon: '🕊️', color: 0xffffff, duration: 7 },""",
    """        wings:    { name: '天使之翼', icon: '🕊️', color: 0xffffff, duration: 7 },
        // [PKVS] 双人对战专属·干扰道具。吃到不会加到自己身上：
        // 拾取循环里以 pk_ 前缀识别，交给接入层 __pkPickItem 立刻打对手
        pk_ink:    { name: '墨水弹',   icon: '🖋', color: 0x7a4bd0, duration: 0 },
        pk_slow:   { name: '粘液弹',   icon: '🧪', color: 0x36d97a, duration: 0 },
        pk_fog:    { name: '冷凝雾',   icon: '🌫', color: 0x9fc8e8, duration: 0 },
        pk_invert: { name: '反向符',   icon: '🔀', color: 0xff3f8a, duration: 0 },
        // 赛道上实际只刷这一种：盲盒。吃到才抽签（tools/vs-items.js 的 rollKind）
        pk_box:    { name: '盲盒',     icon: '❓', color: 0xffc84a, duration: 0 },""",
    'CONFIG.powerUps：登记干扰道具 + 盲盒')

# 4.0b emoji 贴图 + 盲盒贴图。
# 这里不能只靠 rep 的整段字符串匹配判重：old 只覆盖 makePowerMesh 那两行，
# 而 new 覆盖了前面一大段贴图代码，一旦文件里已有半份（比如只注入了 emoji 没注入盲盒），
# 就会整段再插一遍 —— 2026-11-02 因此踩到过 `pkEmojiTexCache 重复声明`。
# 改成查函数名，只要盲盒贴图在就跳过。
if 'function pkBoxTex(' in s:
    print('  [..] 已应用，跳过：makePowerMesh：emoji 贴图 + 盲盒贴图')
else:
  rep("""function makePowerMesh(type) {
      const def = CONFIG.powerUps[type];""",
      """// [PKVS] 干扰道具的 emoji 贴图。只有 4 张，缓存住别每个道具都新建一一遍
  const pkEmojiTexCache = {};
  function pkEmojiTex(ch) {
      if (pkEmojiTexCache[ch]) return pkEmojiTexCache[ch];
      const SZ = 128;
      const c = document.createElement('canvas');
      c.width = c.height = SZ;
      const x = c.getContext('2d');
      x.font = '92px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.shadowColor = 'rgba(0,0,0,.55)';
      x.shadowBlur = 10;
      x.fillText(ch, SZ / 2, SZ / 2 + 4);
      const t = new THREE.CanvasTexture(c);
      if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
      pkEmojiTexCache[ch] = t;
      return t;
  }

  // [PKVS] 盲盒的盒子贴图：深色圆角方块 + 金边 + 问号。
  // 不用 emoji 的 '?'，字号和描边都不可控；手画一遍反而更稳。
  let pkBoxTexCache = null;
  function pkBoxTex() {
      if (pkBoxTexCache) return pkBoxTexCache;
      const SZ = 128, R = 20;
      const c = document.createElement('canvas');
      c.width = c.height = SZ;
      const x = c.getContext('2d');
      const rr = (px, py, w, h, r) => {
          x.beginPath();
          x.moveTo(px + r, py);
          x.arcTo(px + w, py, px + w, py + h, r);
          x.arcTo(px + w, py + h, px, py + h, r);
          x.arcTo(px, py + h, px, py, r);
          x.arcTo(px, py, px + w, py, r);
          x.closePath();
      };
      rr(4, 4, SZ - 8, SZ - 8, R);
      x.fillStyle = 'rgba(30,16,56,0.95)';
      x.fill();
      x.lineWidth = 7;
      x.strokeStyle = '#ffd257';
      x.stroke();
      x.fillStyle = '#ffd257';
      x.font = 'bold 84px Arial, Helvetica, sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText('?', SZ / 2, SZ / 2 + 6);
      pkBoxTexCache = new THREE.CanvasTexture(c);
      if (THREE.SRGBColorSpace) pkBoxTexCache.colorSpace = THREE.SRGBColorSpace;
      return pkBoxTexCache;
  }

  function makePowerMesh(type) {
      const def = CONFIG.powerUps[type];""",
      'makePowerMesh：emoji 贴图函数')

rep("""    } else {
        icon.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.27), std(def.color, { flatShading: true, metalness: 0.4 })));
    }
    g.add(icon);""",
    """    } else if (type === 'pk_box') {
        // [PKVS] 盲盒：六面都是问号的骰子，跟着 icon 一起转。
        // 用 Mesh 而不是 Sprite —— 精灵永远正对相机，转了也看不出来
        icon.add(new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.58, 0.58),
            new THREE.MeshBasicMaterial({ map: pkBoxTex(), transparent: true, depthWrite: false, fog: false })));
    } else if (type.indexOf('pk_') === 0) {
        // [PKVS] 干扰道具：emoji 精灵，远处也能一眼看出捡到的是什么
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
            map: pkEmojiTex(def.icon), transparent: true, depthWrite: false, fog: false,
        }));
        sp.scale.set(1.3, 1.3, 1);
        icon.add(sp);
    } else {
        icon.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.27), std(def.color, { flatShading: true, metalness: 0.4 })));
    }
    g.add(icon);""",
    'makePowerMesh：干扰道具图标')

# 4.0c 拾取分流：pk_ 前缀的道具不进 S.power，直接交给接入层
rep("""            if (p.type === 'revive') takeRevive();
            else {
                S.power[p.type] = powerDur(p.type);""",
    """            if (p.type === 'revive') takeRevive();
            // [PKVS] 干扰道具：不进自己的 power 计时，吃到立刻打对手
            else if (p.type.indexOf('pk_') === 0) {
                if (typeof window.__pkPickItem === 'function') window.__pkPickItem(p.type.slice(3));
                else showMsg('获得 ' + CONFIG.powerUps[p.type].name + '！');
            }
            else {
                S.power[p.type] = powerDur(p.type);""",
    '拾取循环：干扰道具分流给接入层')


# 4.1 死亡上报
rep("""    if (S.revives > 0) { useRevive(); return; }
    S.state = 'dying';""",
    """    if (S.revives > 0) { useRevive(); return; }
    // [PKVS] 对局中死亡 → 立刻上报 dnf 判负；等待 / 结算由接入层接管
    if (typeof window.__pkOnDie === 'function') window.__pkOnDie(text);
    S.state = 'dying';""",
    'die()：对局内死亡上报')

# 4.1b 冷凝雾：必须在 ATMO.update 之后覆写，否则下一帧又被写成正常值
rep("""    // 必须在 ATMO.update 之后：它每帧都会重写 scene.fog
    if (FINISH.active) applyFinishFog(dt);""",
    """    // 必须在 ATMO.update 之后：它每帧都会重写 scene.fog
    if (FINISH.active) applyFinishFog(dt);
    // [PKVS] 冷凝雾：同一个道理，得在 ATMO.update 之后才抢得到雾
    if (typeof window.__pkFogAura === 'function') window.__pkFogAura(scene.fog);""",
    '主循环：冷凝雾钩子')

# 4.2 速度系数（干扰减速 / 倒计时冻结）
rep("    const step = S.speed * dt;\n    S.D += step;",
    "    // [PKVS] 对局内速度可能被干扰压低，或被冻结（倒计时 / 冲线等待）\n"
    "    const step = S.speed * dt * (typeof window.__pkSpeedMul === 'function' ? window.__pkSpeedMul() : 1);\n"
    "    S.D += step;",
    'updatePlaying()：速度系数钩子')

# 4.3 迁移：换图改成固定循环后，PvP 不再需要「按 seed 排场景」的钩子
OLD_PK_NEXT = ("    // [PKVS] 双人对战：换图顺序由 seed 决定，两端必须一致\n"
               "    if (typeof window.__pkNextTheme === 'function') {\n"
               "        const t = window.__pkNextTheme();\n"
               "        if (t) return t;\n"
               "    }\n")
if OLD_PK_NEXT in s:
    s = s.replace(OLD_PK_NEXT, "", 1)
    changes.append('移除：场景换图钩子（已改固定循环）')
    print('  [OK] 移除：场景换图钩子（已改固定循环）')

# 4.4 大厅打开时锁键盘
rep("addEventListener('keydown', e => {\n    const k = e.key.toLowerCase();\n",
    "addEventListener('keydown', e => {\n"
    "    const k = e.key.toLowerCase();\n"
    "    // [PKVS] 联机大厅开着时键盘归输入框（昵称 / 信令码），别触发起跑跳跃\n"
    "    if (typeof window.__pkInputLock === 'function' && window.__pkInputLock()) return;\n",
    'keydown：大厅输入锁')

# 4.4b 反向符：左右互换。方向必须同步喂给 campusNoteInput，
#      否则校园图按「原始按键方向」判你打没打方向，会把转向判错。
FLIP = " * (typeof window.__pkInputFlip === 'function' ? window.__pkInputFlip() : 1)"
rep("""    if (k === 'arrowleft' || k === 'a') { moveLane(-1); campusNoteInput(-1); }
    else if (k === 'arrowright' || k === 'd') { moveLane(1); campusNoteInput(1); }""",
    """    // [PKVS] 反向符：被丢中时左右互换
    if (k === 'arrowleft' || k === 'a') { const d = -1""" + FLIP + """; moveLane(d); campusNoteInput(d); }
    else if (k === 'arrowright' || k === 'd') { const d = 1""" + FLIP + """; moveLane(d); campusNoteInput(d); }""",
    'keydown：反向符（键盘）')

rep("if (Math.abs(dx) > Math.abs(dy)) { const d = dx > 0 ? 1 : -1; moveLane(d); campusNoteInput(d); }",
    "if (Math.abs(dx) > Math.abs(dy)) { const d = (dx > 0 ? 1 : -1)" + FLIP + "; moveLane(d); campusNoteInput(d); }",
    'touchend：反向符（触屏）')

# 4.0d 主游戏每 500m 的道具点必须把 pk_ 排除掉。
#      CONFIG.powerUps 是它抽签的池子，混进干扰道具后单机跑到 500m 会捡到
#      「墨水弹」然后什么都不发生（单机没有 __pkPickItem）。必须过滤。
rep("const type = Math.random() < 0.25 ? 'shield' : pick(Object.keys(CONFIG.powerUps).filter(k => k !== 'shield'));",
    "// [PKVS] pk_ 是双人对战专属的干扰道具，不能混进单机的道具池\n"
    "        const type = Math.random() < 0.25 ? 'shield'\n"
    "            : pick(Object.keys(CONFIG.powerUps).filter(k => k !== 'shield' && k.indexOf('pk_') !== 0));",
    'spawnRow：道具池排除 pk_')

# 4.4c 导出 placePowerUp：赛道上的干扰道具由接入层按里程主动落位
rep("""    spawnPickup(type, lane, s) {   // 测试用：在指定位置放一个道具""",
    """    // [PKVS] 双人对战：在赛道上摆一个道具（干扰道具就靠它落位）
    placePowerUp,
    spawnPickup(type, lane, s) {   // 测试用：在指定位置放一个道具""",
    '__game 导出 placePowerUp')

# 4.5 对战中禁止暂停
rep("function togglePause() {\n    if (S.state !== 'playing') return;",
    "function togglePause() {\n"
    "    if (S.state !== 'playing') return;\n"
    "    // [PKVS] 对战中不许暂停：单方面停表，对手还在跑\n"
    "    if (window.__PKVS_APP && window.__PKVS_APP.active) return;",
    'togglePause()：对局内禁用')

# 4.6 导出给接入层用（用 marker 判重：注入内容改过一版，按整段匹配会重复插入）
if '    getHomeTheme() { return urlTheme; },\n' in s:
    print('  [..] 已应用，跳过：__game 导出')
else:
    rep("    addObstacle, makeCar, makeBus, makeTruck, makeScaffold, makeCone,   // 测试用：手动放障碍",
        "    addObstacle, makeCar, makeBus, makeTruck, makeScaffold, makeCone,   // 测试用：手动放障碍\n"
        "    // [PKVS] 双人对战：强制开局地图（urlTheme 是 let，只能走 setter）、重铺场景\n"
        "    setHomeTheme(t) { urlTheme = t || null; },\n"
        "    getHomeTheme() { return urlTheme; },\n"
        "    resetScene,",
        '__game 导出 setHomeTheme / getHomeTheme / resetScene')

# 4.7 生成期随机源
rep("""    while (Scene.phase === 'run' && S.nextRowS < S.D + SPAWN_DIST) {
        spawnRow(S.nextRowS);
        S.nextRowS += 20 + S.speed * 0.7 + Math.random() * 14;
    }""",
    """    // [PKVS] 双人对战：生成期把 Math.random 换成 seed 流，两端障碍布局一致。
    // 行距里的速度用「该行的里程」算，避免速度档位差在两端累计漂移。
    if (Scene.phase === 'run' && S.nextRowS < S.D + SPAWN_DIST) {
        const pkRnd = window.__pkRnd, pkReal = Math.random;
        if (pkRnd) Math.random = pkRnd;
        try {
            while (Scene.phase === 'run' && S.nextRowS < S.D + SPAWN_DIST) {
                spawnRow(S.nextRowS);
                const spd = pkRnd
                    ? Math.min(CONFIG.speed.max, CONFIG.speed.start * Math.pow(CONFIG.speed.factor, Math.floor(S.nextRowS / CONFIG.speed.step)))
                    : S.speed;
                S.nextRowS += 20 + spd * 0.7 + Math.random() * 14;
            }
        } finally {
            if (pkRnd) Math.random = pkReal;
        }
    }""",
    '关卡生成：seed 随机源')

# 4.8 迎面车独占判定改成「按里程」——障碍数组的存活状态依赖帧时机，会破坏两端一致
rep("    else if (canMoving && !meetNearJ && (dueMoving || r < 0.56) && !obstacles.some(o => o.moving)) { placeMoving(lane, s); S.lastMovingS = s; }",
    "    // [PKVS] 对局内用「里程差」判独占：obstacles 里还有没有迎面车要看帧时机，\n"
    "    // 两端会差一帧 → 分支不同 → 后面的随机序列全错开。里程是确定性的。\n"
    "    else if (canMoving && !meetNearJ && (dueMoving || r < 0.56)\n"
    "        && (window.__pkRnd ? (s - S.lastMovingS > 120) : !obstacles.some(o => o.moving))) { placeMoving(lane, s); S.lastMovingS = s; }",
    '关卡生成：迎面车独占判定确定性')

# ------------------------------------------------------------ 落盘
if CHECK:
    print('\n--check：共 %d 处改动，未写盘' % len(changes))
    sys.exit(0)

io.open(os.path.join(ROOT, SRC), 'w', encoding='utf-8', newline='').write(s)
print('\n已写出 %s（%.2f MB，字符数 %+d），共 %d 处改动：'
      % (SRC, len(s) / 1048576, len(s) - orig, len(changes)))
for i, c in enumerate(changes, 1):
    print('  %d. %s' % (i, c))
