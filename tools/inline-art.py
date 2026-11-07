# -*- coding: utf-8 -*-
"""把 js/art.js 内联进 playable.html，并接上各个钩子。

为什么不用 pack.mjs：playable.html 才是唯一事实源（单文件游戏），
所有改动都必须落在它身上；js/art.js 只是方便编辑的源文件。

用法：
    "D:/PythonAPPS/python386/python.exe" tools/inline-art.py
    "D:/PythonAPPS/python386/python.exe" tools/inline-art.py --check
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'playable.html')
ART = os.path.join(ROOT, 'js', 'art.js')

BEGIN = '// ==== ART-BLOCK BEGIN（tools/inline-art.py 生成，勿手改）===='
END = '// ==== ART-BLOCK END ===='

check_only = '--check' in sys.argv

html = io.open(SRC, encoding='utf-8', newline='').read()
orig_len = len(html)

art = io.open(ART, encoding='utf-8').read()
art = re.sub(r'^export\s+', '', art, flags=re.M)

# 建筑包围盒（摆件避让用）：由 tools/gen-blockers.py 生成
BLK = os.path.join(ROOT, 'js', 'art-blockers.js')
blockers = io.open(BLK, encoding='utf-8').read() if os.path.exists(BLK) else 'const ART_BLOCKERS = {};\n'

# 底板行道树的树干中心（撞树判定用），由 tools/gen-campus-trees.py 从 GLB 烘焙
TREES = os.path.join(ROOT, 'js', 'campus-trees.js')
trees = io.open(TREES, encoding='utf-8').read() if os.path.exists(TREES) else \
    'const PLATE_TREES = { campus: [], campus2: [] };\n'

INSTANCE = """
// 美术升级包实例：贴图/材质一次性建好，两个校园共用同一套
const ART = createArtKit({
    THREE, scene, renderer, camera,
    mergeGeometries, CAMPUS_SETS,
    getCampus: () => CAMPUS,
    getTheme: () => curTheme,
    rand, pick, clamp, shared,
});
ART.buildMaterials();
"""

block = BEGIN + '\n' + blockers + '\n' + trees + '\n' + art.rstrip() + '\n' + INSTANCE + END

# ---------------------------------------------------------------- 1 内联模块
if BEGIN in html:
    a = html.index(BEGIN)
    b = html.index(END) + len(END)
    html = html[:a] + block + html[b:]
else:
    anchor = '// ==== CAMPUS-BLOCK END ===='
    n = html.count(anchor)
    assert n == 1, '校园块锚点异常：%d' % n
    html = html.replace(anchor, anchor + '\n\n' + block, 1)

# ---------------------------------------------------------------- 2 钩子
HOOKS = []


def hook(old, new, note, allow_many=False):
    global html
    if new in html:
        HOOKS.append(note + '（已应用）')
        return
    n = html.count(old)
    assert n >= 1, '锚点缺失：%s' % note
    if not allow_many:
        assert n == 1, '锚点重复 %d 次：%s' % (n, note)
    html = html.replace(old, new, 1)
    HOOKS.append(note)


# 2.0 清掉历史版本留下的重复调用（同一处注入过两次会把配色覆盖回去）
html = html.replace("            ART.upgradeCampusMaterials(gltf.scene);   // 换掉「灰墙绿树」的程序贴图\n", "")

# 2.05 gzip 底板：把 'gz:...' 解压成 Blob URL 再交给 GLTFLoader
hook("""async function loadCampusPlates() {""",
     """// 内联底板是 gzip + base64：解压成 Blob URL 再交给 GLTFLoader。
// 直接喂 data URI 的话，8.3MB 的 GLB 要先转成 11MB 的 base64 文本，
// 光解码就要几百毫秒；gzip 版只有 2.4MB 文本，解压是原生的流式实现。
async function resolvePlate(url) {
    if (!url || url.indexOf('gz:') !== 0) return url;
    const b64 = url.slice(url.indexOf('base64,') + 7);
    const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    const buf = await new Response(
        new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))
    ).arrayBuffer();
    return URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
}

async function loadCampusPlates() {""",
     'gzip 底板解压')

# 2.1 底板载入后：升级材质 + 挂摆件 + 用新博雅塔
# 锚点只取 tune(gltf.scene)：上面 resolvePlate 那一步会改掉 loadAsync 那一行，
# 用两行做锚点的话，第二次跑这个脚本就找不到锚点了。
hook("""            tune(gltf.scene);""",
     """            tune(gltf.scene);
            ART.upgradeCampusMaterials(gltf.scene, S.id);   // 换掉「灰墙绿树」的程序贴图""",
     '校园底板材质升级')

hook("""                if (lm.name === '博雅塔') g.add(buildBoyaPagoda(lm.x, lm.z, lm.h || 31));""",
     """                if (lm.name === '博雅塔') g.add(ART.makePagoda(lm.x, lm.z, lm.h || 31));""",
     '博雅塔换成新版')

hook("""            S.group = g;
            S.ready = true;""",
     """            S.group = g;
            S.ready = true;
            try { ART.decorateCampus(S); } catch (e) { console.warn('[art] 校园摆件失败', e); }""",
     '校园摆件挂载')

# 2.2 城市：赛博层（连廊 / 全息广告 / 光柱 / 飞行器）
hook("""function buildCityDecor() {
    if (!OLDTOWN) OLDTOWN = createOldTown(cityCtx());
    OLDTOWN.buildDecor();
}""",
     """function buildCityDecor() {
    if (!OLDTOWN) OLDTOWN = createOldTown(cityCtx());
    OLDTOWN.buildDecor();
    try { ART.decorateCity(addScenery); } catch (e) { console.warn('[art] 城市科幻层失败', e); }
}""",
     '城市科幻层')

hook("""    curTheme = id;
    for (const _S of Object.values(CAMPUS_SETS)) {""",
     """    curTheme = id;
    if (typeof ART !== 'undefined' && id !== 'city') ART.hideCity();
    for (const _S of Object.values(CAMPUS_SETS)) {""",
     '离开城市时隐藏飞行器')

# 2.3 主循环：水面流动 / 落叶 / 飞行器
# 用 BEGIN/END 标记包起来，重复跑脚本就是「整块替换」，不会越插越多
TICK = """    // ART-TICK-BEGIN（tools/inline-art.py 生成）
    if (typeof ART !== 'undefined') {
        ART.tickWater(dt);
        ART.tickAmbient(dt, curTheme, 0, 0);   // 云层不能吃里程：px/pz 是世界坐标，不是 S.D
        if (curTheme === 'city') ART.tickCity(dt);
    }
    // ART-TICK-END
"""
if '// ART-TICK-BEGIN' in html:
    a = html.index('    // ART-TICK-BEGIN')
    b = html.index('    // ART-TICK-END') + len('    // ART-TICK-END\n')
    html = html[:a] + TICK + html[b:]
    HOOKS.append('美术动画 tick（已替换）')
else:
    anchor = '    updateBlobShadow();\n    // 阴影节流'
    assert html.count(anchor) == 1, 'updateBlobShadow 锚点异常'
    html = html.replace(anchor, TICK + anchor, 1)
    HOOKS.append('美术动画 tick')

# 2.4 画面调色：纯 CSS 暗角（不占 GPU，手机上几乎零成本）
# 用「已存在就跳过」而不是精确匹配 —— CSS 段经常手改，精确匹配会让脚本越插越多
GRADE_CSS = """    /* ---- 画面调色：暗角 + 冷暖分离（纯 CSS，不占 GPU） ---- */
    #grade {
        position: fixed; inset: 0; z-index: 3; pointer-events: none;
        background:
            radial-gradient(118% 86% at 50% 46%, rgba(0,0,0,0) 40%, rgba(18,12,4,.32) 100%),
            linear-gradient(180deg, rgba(255,206,150,.05) 0%, rgba(130,175,220,.02) 48%, rgba(8,16,34,.10) 100%);
    }
    /* 手机上暗角收一点，也不要用 mix-blend-mode（会多一层合成，低端机吃不消） */
    @media (max-width: 820px) {
        #grade { background: radial-gradient(132% 94% at 50% 46%, rgba(0,0,0,0) 48%, rgba(18,12,4,.20) 100%); }
    }
"""
if '#grade {' not in html:
    assert html.count('    #hud {') == 1, '#hud 锚点异常'
    html = html.replace('    #hud {', GRADE_CSS + '    #hud {', 1)
    HOOKS.append('画面暗角')
else:
    HOOKS.append('画面暗角（已存在）')

if '<div id="grade"></div>' not in html:
    assert html.count('<div id="app"></div>') == 1, '#app 锚点异常'
    html = html.replace('<div id="app"></div>', '<div id="app"></div>\n<div id="grade"></div>', 1)
    HOOKS.append('暗角层')
else:
    HOOKS.append('暗角层（已存在）')

# 2.4 燕园环境：更暖的午后 + 更远的雾（原来 120/330 太近，远景糊成一片）
hook("""            bg: 0xa9c6e8, fog: [0xdfe6ee, 120, 330],
            hemi: [0xf4f6ff, 0x6f7a6a, 1.02],
            sun: { color: 0xffe6bf, i: 1.45, pos: [18, 14, 10], shadow: true },""",
     """            bg: 0x9fc4e6, fog: [0xd9e4ee, 150, 420],
            hemi: [0xfff6e8, 0x6f7a5a, 1.05],
            sun: { color: 0xffe0b0, i: 1.62, pos: [22, 16, 12], shadow: true },""",
     '燕园光照')

hook("""            bg: 0xa9c6e8, fog: [0xdfe6ee, 110, 300],
            hemi: [0xf4f6ff, 0x6f7a6a, 1.02],
            sun: { color: 0xffe6bf, i: 1.45, pos: [18, 14, 10], shadow: true },""",
     """            bg: 0xa8c8ea, fog: [0xdde6f0, 140, 400],
            hemi: [0xf6f9ff, 0x6b7568, 1.05],
            sun: { color: 0xfff0d4, i: 1.58, pos: [20, 15, 11], shadow: true },""",
     '医学部光照')

# 2.5 最后再改 loadAsync：这一步会吃掉上面几个钩子的锚点，必须放最后
if 'await resolvePlate(S.url)' not in html:
    n = html.count('new GLTFLoader().loadAsync(S.url)')
    assert n == 1, 'loadAsync 锚点异常：%d' % n
    html = html.replace('new GLTFLoader().loadAsync(S.url)',
                        'new GLTFLoader().loadAsync(await resolvePlate(S.url))', 1)
    HOOKS.append('底板走 resolvePlate')
else:
    HOOKS.append('底板走 resolvePlate（已应用）')

# ---------------------------------------------------------------- 3 写回
if check_only:
    print('检查通过：art 块 %d 字符 / 钩子 %d 个' % (len(block), len(HOOKS)))
    for h in HOOKS:
        print('  -', h)
    sys.exit(0)

io.open(SRC, 'w', encoding='utf-8', newline='').write(html)
print('playable.html %.2fMB -> %.2fMB' % (orig_len / 1e6, len(html) / 1e6))
for h in HOOKS:
    print('  -', h)
