# -*- coding: utf-8 -*-
"""patch18_visual.py —— 本轮画面升级（城堡 / 火车 / 隧道）打进 playable.html

三个区块都是「整段替换」，锚点固定、幂等：
  · 城堡块   从 `// ---- 湖畔：北欧式城堡` 到 `// ---- 火车隧道`
  · 火车块   `function makeTrain(` 到 `const rampGeo`
  · 隧道块   `function buildTunnelWorld(` 到 `// ---- 城市街区`

另外三处小改：装饰回收支持自定义周期、柱阵排期贴住隧道出口、主循环挂动画钩子。

用法：
    python tools/patch18_visual.py            # 全部
    python tools/patch18_visual.py castle     # 只打某一块
"""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'playable.html')
TMP = os.path.join(ROOT, 'tmp')

which = set(a for a in sys.argv[1:] if not a.startswith('-')) or {'castle', 'train', 'tunnel', 'misc'}
src = io.open(HTML, encoding='utf-8', newline='').read()
orig = len(src)
done = []


def splice(start_anchor, end_anchor, new_text, tag):
    global src
    a = src.find(start_anchor)
    assert a >= 0, '找不到开端锚点: ' + tag
    b = src.find(end_anchor, a)
    assert b > a, '找不到结束锚点: ' + tag
    src = src[:a] + new_text + src[b:]
    done.append(tag)


def rep(old, new, tag, expect=1):
    global src
    n = src.count(old)
    assert n == expect, '锚点异常（%d 次）: %s' % (n, tag)
    src = src.replace(old, new)
    done.append(tag)


# ---------------------------------------------------------------- 城堡
CASTLE_START = '// ---- 湖畔：北欧式城堡（白 / 黑双色 · 对称几何 · 宏大尺度）----'
CASTLE_END = '// ---- 火车隧道（昏暗 + 顶灯掠过）----'
if 'castle' in which and 'CASTLE_STONE' not in src:
    body = io.open(os.path.join(TMP, 'new_castle.js'), encoding='utf-8').read()
    splice(CASTLE_START, CASTLE_END, body + '\n', 'castle-block')



# ---------------------------------------------------------------- 火车
if 'train' in which and 'roundedCarGeo' not in src:
    train_body = io.open(os.path.join(TMP, 'new_train.js'), encoding='utf-8').read()
    splice('function makeTrain(L, style, oncoming) {', 'const rampGeo = shared((() => {', train_body + '\n', 'train-block')

# ---------------------------------------------------------------- 隧道
if 'tunnel' in which and 'TUNNEL_CYCLE' not in src:
    tunnel_body = io.open(os.path.join(TMP, 'new_tunnel.js'), encoding='utf-8').read()
    splice('// ---- 火车隧道（昏暗 + 顶灯掠过）----', '// ---- 城市街区（白天阳光）----', tunnel_body + '\n', 'tunnel-block')

# ---------------------------------------------------------------- 配套小改
if 'misc' in which:
    # ① 装饰回收：支持自定义周期（隧道管段按 200m 循环，不能套 324m）
    if 'userData.period' not in src.split('function scrollWorld')[1][:2000]:
        rep("""        o.position.z += step;
        if (o.userData.tiling) {""",
            """        o.position.z += step;
        if (o.userData.period) {
            // 自定义周期（隧道管段：200m 一段、同时存在 3 段）
            const P = o.userData.period;
            if (o.position.z > P.wrapAt) o.position.z -= P.recycle;
        } else if (o.userData.tiling) {""", 'scroll-period')

    # ② 柱阵排期：只长在洞内，并且在隧道出口前收尾 —— 跑完上一根柱子正好出洞
    if 'tunnelAllowsPillar' not in src.split('function pillarRow')[1][:1500]:
        rep("""        if (s < P.nextAt) return false;
        // 起阵前三条道都要干净""",
            """        if (s < P.nextAt) return false;
        // 柱阵必须落在隧道段里，且在洞口前收尾（见隧道块 tunnelAllowsPillar）
        if (!tunnelAllowsPillar(s)) return false;
        // 起阵前三条道都要干净""", 'pillar-gate')
        rep("""        P.endS = s + randRange(PILLAR_CFG.span[0], PILLAR_CFG.span[1]);""",
            """        P.endS = Math.min(s + randRange(PILLAR_CFG.span[0], PILLAR_CFG.span[1]), tunnelExitAt(s) - 12);""",
            'pillar-end')

    # ④ 湖畔湖面 + 护城河套用校园水面的「波光粼粼」着色
    if 'lakeMat' not in src:
        rep("""function buildLakesideWorld() {
    addMesh(flat(14, 340), std(0xffffff, { map: groundTex, roughness: 1 }), 0, 0, -150);
    addMesh(flat(60, 340), std(0x9a9a92, { roughness: 1 }), -34, 0.01, -150);
    addMesh(flat(160, 340), std(0x2a83d6, { roughness: 0.15, metalness: 0.2 }), 87, -0.3, -150);   // 湖面""",
            """// 湖面材质：和校园水面共用同一套「波光 + 涟漪」注入（见 ART.applyWaterShine）
const lakeMat = shared(std(0x2a83d6, { roughness: 0.16, metalness: 0.22 }));

function buildLakesideWorld() {
    addMesh(flat(14, 340), std(0xffffff, { map: groundTex, roughness: 1 }), 0, 0, -150);
    addMesh(flat(60, 340), std(0x9a9a92, { roughness: 1 }), -34, 0.01, -150);
    addMesh(flat(160, 340), lakeMat, 87, -0.3, -150);   // 湖面""", 'lake-mat')
        rep("""    THEMES.lakeside.texScroll = [[groundTex, 4], [trackTex, 2], [sparkleTex, 6.5]];""",
            """    THEMES.lakeside.texScroll = [[groundTex, 4], [trackTex, 2], [sparkleTex, 6.5]];
    // 有了着色器波光，叠层的白色碎片只留一点点当"碎浪"，不再抢戏
    if (typeof ART !== 'undefined' && ART.applyWaterShine) {
        ART.applyWaterShine(lakeMat, { ripple: 0.42, glint: 1.0, scale: 0.62 });   // 湖畔湖面（涟漪圈小一点）
        ART.applyWaterShine(CASTLE_MAT.moat, { ripple: 0.26, glint: 0.85, scale: 0.5 });  // 护城河：水面窄，涟漪更小更淡
    }""", 'lake-shine')
        rep("new THREE.MeshBasicMaterial({ map: sparkleTex, transparent: true, opacity: 0.62, depthWrite: false })",
            "new THREE.MeshBasicMaterial({ map: sparkleTex, transparent: true, opacity: 0.16, depthWrite: false })",
            'sparkle-opacity')

    # ③ 主循环：吊桥 / 吊闸 / 旗帜 + 隧道分段光照
    # 必须插在 ART-TICK 块【外面】：inline-art.py 每次都会整段重写 ART-TICK，
    # 插在块内的话下次内联美术包就被抹掉了（这个坑踩过一次）
    if 'CASTLE-GATE-TICK-BEGIN' not in src:
        rep("""    // ART-TICK-END""",
            """    // ART-TICK-END
    // CASTLE-GATE-TICK-BEGIN（tools/patch18_visual.py 生成）
    if (typeof tickCastleGates === 'function') tickCastleGates(dt);     // 吊桥 / 吊闸 / 旗帜
    if (typeof updateTunnelLight === 'function') updateTunnelLight(dt); // 隧道分段开合的光照
    // CASTLE-GATE-TICK-END""", 'loop-hook')

io.open(HTML, 'w', encoding='utf-8', newline='').write(src)
print('已打补丁:', ', '.join(done) if done else '（无变化，已是最新）')
print('playable.html: %d -> %d 字符' % (orig, len(src)))
