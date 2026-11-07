# -*- coding: utf-8 -*-
"""把「阳光校园」换成真实三维校园（北大未名湖片区）+ 左右转向。

一次性脚本，幂等性靠 unique-anchor 断言保证：锚点出现次数不为 1 就直接报错。
用法： "D:/PythonAPPS/python386/python.exe" tools/patch11_real_campus.py
"""
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'playable.html')
BLOCK = os.path.join(HERE, 'campus-src', 'campus_block.js')
ROUTE = os.path.join(ROOT, 'assets', 'campus', 'campus_route.json')
ROUTE2 = os.path.join(ROOT, 'assets', 'campus2', 'campus2_route.json')

s = io.open(SRC, encoding='utf-8', newline='').read()
orig = len(s)
changes = []


def rep(old, new, note):
    """判重必须看「new 已存在」而不是「old 消失」——
    好几个 new 的结尾就是 old 本身，连续跑两次会重复注入。"""
    global s
    if new in s:
        changes.append(note + '（已应用，跳过）')
        return
    n = s.count(old)
    assert n == 1, '锚点异常（出现 %d 次）：%s' % (n, note)
    s = s.replace(old, new, 1)
    changes.append(note)


# ---------------------------------------------------------------- 1 注入路线
route = json.load(io.open(ROUTE, encoding='utf-8'))
pts_js = json.dumps(route['pts'], separators=(',', ':'))
block = io.open(BLOCK, encoding='utf-8').read()
block = block.replace('__CAMPUS_PTS__', pts_js)
block = block.replace('__CAMPUS_TOTAL__', '%.2f' % route['length'])
block = block.replace('__CAMPUS_LM__', json.dumps(route.get('landmarks', []), ensure_ascii=False))
# 医学部（campus2）的路线上报：底板缺文件时该场景自动回退直道
if os.path.exists(ROUTE2):
    route2 = json.load(io.open(ROUTE2, encoding='utf-8'))
    pts2 = route2['pts']
    block = block.replace('__CAMPUS2_PTS__',
                          '[' + ','.join('[%s,%s]' % (p[0], p[1]) for p in pts2) + ']')
    block = block.replace('__CAMPUS2_TOTAL__', '%.2f' % route2['length'])
    block = block.replace('__CAMPUS2_LM__', json.dumps(route2.get('landmarks', []), ensure_ascii=False))
else:
    block = block.replace('__CAMPUS2_PTS__', '[[0,0],[0,-100]]')
    block = block.replace('__CAMPUS2_TOTAL__', '100')
    block = block.replace('__CAMPUS2_LM__', '[]')
assert '__CAMPUS_' not in block, '路线占位符没替换干净'

BEGIN = '// ==== CAMPUS-BLOCK BEGIN（tools/patch11_real_campus.py 生成，勿手改）===='
END = '// ==== CAMPUS-BLOCK END ===='
if BEGIN in s:
    start = s.index(BEGIN)
    end = s.index(END) + len(END)
elif '//  阳光校园 → 真实三维校园' in s:
    # 早期注入过、还没有标记的版本：从块首注释到 scrollWorld 之间整段换掉
    start = s.index('//  阳光校园 → 真实三维校园') - len('// =====================================================================\n')
    end = s.index('function scrollWorld(step, D) {')
else:
    start = s.index('// ---- 阳光校园（午后暖阳）----')
    end = s.index('function scrollWorld(step, D) {')
s = s[:start] + BEGIN + '\n' + block.rstrip() + '\n' + END + '\n\n' + s[end:]
changes.append('注入校园场景代码块（%d 字符）' % len(block))

# ---------------------------------------------------------------- 2 场景配置
rep("""    campus: {
        name: '阳光校园', span: 560, segLen: SCENE_SEG_LEN.campus,
        env: {
            bg: 0xa9c6e8, fog: [0xf2d5a8, 80, 240],
            hemi: [0xfff2dd, 0x7a8a6a, 1.05],
            sun: { color: 0xffdfae, i: 1.5, pos: [18, 12, 10], shadow: true },
        },
        texScroll: [[campusRoadTex, 6]],
        buildWorld: buildCampusWorld,
        buildDecor: buildCampusDecor,
    },""",
    """    campus: {
        name: '燕园·未名湖', span: 560, segLen: SCENE_SEG_LEN.campus,
        env: {
            bg: 0xa9c6e8, fog: [0xdfe6ee, 120, 330],
            hemi: [0xf4f6ff, 0x6f7a6a, 1.02],
            sun: { color: 0xffe6bf, i: 1.45, pos: [18, 14, 10], shadow: true },
        },
        texScroll: [],
        buildWorld: buildCampusWorld,
        buildDecor: buildCampusDecor,
    },""", '场景配置：改名 / 拉远雾 / 去掉路面贴图滚动')

# ---------------------------------------------------------------- 3 世界滚动里推进底板
rep("""function scrollWorld(step, D) {
    const T = THEMES[curTheme];""",
    """function scrollWorld(step, D) {
    const T = THEMES[curTheme];
    campusUpdate(step);       // 校园：整块底板绕玩家转，弯道就发生在这里""",
    'scrollWorld：每帧推进校园底板')

# ---------------------------------------------------------------- 4 换场时显示/隐藏底板
rep("""    curTheme = id;
    for (let i = worldGroup.children.length - 1; i >= 0; i--) disposeObj(worldGroup.children[i]);""",
    """    curTheme = id;
    if (CAMPUS.group) CAMPUS.group.visible = (id === 'campus');
    for (let i = worldGroup.children.length - 1; i >= 0; i--) disposeObj(worldGroup.children[i]);""",
    'buildWorld：按场景显示/隐藏校园底板')

# ---------------------------------------------------------------- 5 障碍 / 金币 / 道具改投影
rep("    mesh.position.set(o.x, 0, o.z);\n    scene.add(mesh);\n    obstacles.push(o);",
    "    placeOnTrack(mesh, o.x, 0, o.z);\n    scene.add(mesh);\n    obstacles.push(o);",
    'addObstacle：沿路线投影')

rep("    mesh.position.set(c.x, y, c.z);\n    scene.add(mesh);\n    coins.push(c);",
    "    placeOnTrack(mesh, c.x, y, c.z);\n    scene.add(mesh);\n    coins.push(c);",
    'addCoin：沿路线投影')

rep("    mesh.position.set(p.x, p.y, p.z);\n    scene.add(mesh);\n    pickups.push(p);",
    "    placeOnTrack(mesh, p.x, p.y, p.z);\n    scene.add(mesh);\n    pickups.push(p);",
    'placePickup：沿路线投影')

rep("""        o.z += step + o.extra * dt;
        o.mesh.position.z = o.z;
        if (o.wobble) {   // 校园·自行车轻微横移（碰撞用实时 x）
            o.x = o.baseX + wobbleOffset(S.D, o.wobble);
            o.mesh.position.x = o.x;
        }""",
    """        o.z += step + o.extra * dt;
        if (o.wobble) {   // 校园·自行车轻微横移（碰撞用实时 x）
            o.x = o.baseX + wobbleOffset(S.D, o.wobble);
        }
        placeOnTrack(o.mesh, o.x, 0, o.z);""",
    'updatePlaying：障碍改投影（含自行车横移）')

rep("""        c.mesh.position.set(c.x, c.y, c.z);
        c.mesh.rotation.y += dt * 4;""",
    """        placeOnTrack(c.mesh, c.x, c.y, c.z);
        trackSpin(c.mesh, dt, 4);""",
    'updatePlaying：金币改投影 + 保留自转')

rep("        p.mesh.position.set(p.x, p.y + Math.sin(S.D * 0.2) * 0.15, p.z);",
    "        placeOnTrack(p.mesh, p.x, p.y + Math.sin(S.D * 0.2) * 0.15, p.z);",
    'updatePlaying：道具改投影')

rep("""    for (const o of obstacles) { o.z += step; o.mesh.position.z = o.z; }
    for (const c of coins) { c.z += step; c.mesh.position.z = c.z; }
    for (const p of pickups) { p.z += step; p.mesh.position.z = p.z; }""",
    """    for (const o of obstacles) { o.z += step; placeOnTrack(o.mesh, o.x, 0, o.z); }
    for (const c of coins) { c.z += step; placeOnTrack(c.mesh, c.x, c.y, c.z); }
    for (const p of pickups) { p.z += step; placeOnTrack(p.mesh, p.x, p.y, p.z); }""",
    'updateDying：三个循环改投影')

rep("""    const cx = chaser.root.position.x;
    chaser.root.position.set(cx + (tx - cx) * Math.min(1, dt * 4), 0, dist);""",
    """    const cx = chaser.px == null ? tx : chaser.px;   // 跑道系里的横向位置（校园要投影）
    chaser.px = cx + (tx - cx) * Math.min(1, dt * 4);
    placeOnTrack(chaser.root, chaser.px, 0, dist);""",
    'updateChaser：保安改投影')

# ---------------------------------------------------------------- 6 输入
rep("""    if (k === 'arrowleft' || k === 'a') moveLane(-1);
    else if (k === 'arrowright' || k === 'd') moveLane(1);""",
    """    if (k === 'arrowleft' || k === 'a') { moveLane(-1); campusNoteInput(-1); }
    else if (k === 'arrowright' || k === 'd') { moveLane(1); campusNoteInput(1); }""",
    '键盘：左右键同时记录转向意图')

rep("    if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);",
    "    if (Math.abs(dx) > Math.abs(dy)) { const d = dx > 0 ? 1 : -1; moveLane(d); campusNoteInput(d); }",
    '触摸：横滑同时记录转向意图')

# ---------------------------------------------------------------- 7 HUD
rep("""    #hudScene { color: #ffd84a; }""",
    """    #hudScene { color: #ffd84a; }

    /* 校园·路口转向提示 */
    #turnHint {
        position: fixed; left: 50%; top: 15%; z-index: 9; pointer-events: none;
        display: flex; align-items: center; gap: 12px;
        padding: 9px 24px; border-radius: 999px;
        background: rgba(255, 64, 64, .20);
        border: 2px solid rgba(255, 96, 96, .78);
        box-shadow: 0 0 24px rgba(255, 60, 60, .45);
        color: #fff; font: bold 25px/1 inherit;
        text-shadow: 0 2px 8px rgba(0, 0, 0, .65);
        transform: translateX(-50%);
        animation: turnPulse .5s ease-in-out infinite alternate;
    }
    #turnHint .ar { font-size: 34px; line-height: 1; }
    #turnHint.ok {
        background: rgba(56, 220, 120, .24);
        border-color: rgba(90, 245, 145, .88);
        box-shadow: 0 0 24px rgba(56, 220, 120, .5);
        animation: none;
    }
    @keyframes turnPulse {
        from { transform: translateX(-50%) scale(1); }
        to   { transform: translateX(-50%) scale(1.09); }
    }""",
    'CSS：路口提示样式')

rep("""<div id="msg"></div>""",
    """<div id="msg"></div>
<div id="turnHint" class="hidden"><span class="ar">⬅</span><span class="tx">左转</span></div>""",
    'HTML：插入路口提示元素')

# ---------------------------------------------------------------- 8 载入底板
rep("""buildWorld('lakeside');""",
    """// 真实校园底板：必须在第一次 buildWorld('campus') 之前载入
try { await loadCampusPlates(); } catch (e) { console.warn('[campus] 底板载入失败，回退成直道', e); }

buildWorld('lakeside');""",
    '载入校园底板')

rep("""    if (Scene.id !== home) doSceneSwap(home);
    else { Scene.segEnd = randRange(...THEMES[home].segLen); Scene.next = pickNextScene(); }""",
    """    if (Scene.id !== home) doSceneSwap(home);
    else { Scene.segEnd = randRange(...THEMES[home].segLen); Scene.next = pickNextScene(); }
    campusResetRun();          // 重开局：路线里程归零（主题没换时也得复位）""",
    'resetScene：重开局重置校园里程')

rep("""function playGuardLaugh() {
    try {
        if (!guardAudio) { guardAudio = new Audio(GUARD_BGM); guardAudio.preload = 'auto'; }
        guardAudio.pause();
        guardAudio.currentTime = 0;
        guardAudio.volume = Math.min(1, audioChannelGain(AUDIO, 'laugh'));
        guardAudio.play().catch(() => {});
    } catch (e) {}
}""",
    """function playGuardLaugh() {
    // 笑话走独立 <audio> 元素，不受 WebAudio 增益总线约束：
    // 必须在入口把关，增益为 0（静音 / 总音量 0 / 笑声通道 0）时直接不播
    const g = audioChannelGain(AUDIO, 'laugh');
    if (!(g > 0.001)) return;
    try {
        if (!guardAudio) { guardAudio = new Audio(GUARD_BGM); guardAudio.preload = 'auto'; }
        guardAudio.pause();
        guardAudio.currentTime = 0;
        guardAudio.volume = Math.min(1, g);
        guardAudio.play().catch(() => {});
    } catch (e) {}
}""",
    '保安笑声：静音时彻底不播')

rep("    if (guardAudio) guardAudio.volume = Math.min(1, AUDIO.applied.laugh);",
    """    if (guardAudio) {
        const lg = Math.min(1, AUDIO.applied.laugh);
        guardAudio.volume = lg;
        // 音量降到 0 不保证立刻静音（部分编解码器），正在响的要 pause 掉
        if (lg <= 0.001) { try { guardAudio.pause(); guardAudio.currentTime = 0; } catch (e) {} }
    }""",
    '音量归零时暂停笑声元素')

rep("    LMGLB, LANDMARK_MODELS, loadLandmarkGLBs,",
    "    LMGLB, LANDMARK_MODELS, loadLandmarkGLBs,\n"
    "    // 真实校园（调试/验证用）。CAMPUS 必须用 getter：它是 let，\n"
    "    // 切场景时会被重指到另一个集合，对象字面量里的裸引用不会跟着更新\n"
    "    get CAMPUS() { return CAMPUS; }, CAMPUS_SETS,\n"
    "    placeOnTrack, campusPoint, campusDir, campusNoteInput,",
    '导出校园调试接口')

# 历史遗留：早期版本的裸 CAMPUS 导出行会让 getter 被对象字面量的后属性覆盖，
# 出现「切换场景后 G.CAMPUS 仍指向旧集合」。全部清掉。
_bare = "    CAMPUS, placeOnTrack, campusPoint, campusDir, campusNoteInput,   // 真实校园（调试/验证用）\n"
if _bare in s:
    s = s.replace(_bare, '')
    changes.append('清理裸 CAMPUS 导出行')

io.open(SRC, 'w', encoding='utf-8', newline='').write(s)
print('playable.html: %d → %d 字符' % (orig, len(s)))
for c in changes:
    print('  ✓', c)
