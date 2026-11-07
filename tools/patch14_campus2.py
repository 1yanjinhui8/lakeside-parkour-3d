# -*- coding: utf-8 -*-
"""
patch14_campus2.py —— 注册「医学部」场景（campus2）并接入川大门传送链。

  · THEMES 注册 campus2（复用校园场景的 buildWorld/buildDecor，底板与路线在
    campus_block.js 的 CAMPUS_SETS 里）
  · 轮换权重加入 campus2；开场队列加医学部
  · buildWorld 的底板可见性行改为「每个校园集各自对齐」
  · 川大门传送门扩展到 campus2 段尾声
  · 主菜单场景选择器加「医学部」

幂等。必须在 patch11 / patch12 / patch13 之后执行。
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'playable.html')

s = io.open(SRC, encoding='utf-8', newline='').read()
changes = []


def rep(old, new, note):
    global s
    if new in s:
        changes.append(note + '（已应用，跳过）')
        return
    n = s.count(old)
    assert n == 1, '锚点异常（出现 %d 次）：%s' % (n, note)
    s = s.replace(old, new, 1)
    changes.append(note)


# ---------------------------------------------------------------- 1. THEMES 注册
rep("""    campus: {
        name: '燕园·未名湖', span: 560, segLen: SCENE_SEG_LEN.campus,""",
    """    campus2: {
        name: '医学部', span: 560, segLen: SCENE_SEG_LEN.campus,
        env: {
            bg: 0xa9c6e8, fog: [0xdfe6ee, 110, 300],
            hemi: [0xf4f6ff, 0x6f7a6a, 1.02],
            sun: { color: 0xffe6bf, i: 1.45, pos: [18, 14, 10], shadow: true },
        },
        texScroll: [],
        buildWorld: buildCampusWorld,
        buildDecor: buildCampusDecor,
    },
    campus: {
        name: '燕园·未名湖', span: 560, segLen: SCENE_SEG_LEN.campus,""",
    'THEMES 注册 campus2（医学部）')

# ---------------------------------------------------------------- 2. 权重与队列
rep("""const SCENE_OBSTACLES = {
    lakeside: ['train', 'lowBar', 'highBar'],
    tunnel:   ['train', 'lowBar', 'highBar', 'pillar'],
    city:     ['bus', 'truck', 'car', 'scaffold', 'cone'],
    campus:   ['schoolbus', 'bike', 'banner', 'hurdle'],
};""",
    """const SCENE_OBSTACLES = {
    lakeside: ['train', 'lowBar', 'highBar'],
    tunnel:   ['train', 'lowBar', 'highBar', 'pillar'],
    city:     ['bus', 'truck', 'car', 'scaffold', 'cone'],
    campus:   ['schoolbus', 'bike', 'banner', 'hurdle'],
    campus2:  ['schoolbus', 'bike', 'banner', 'hurdle'],
};""",
    '医学部障碍表（sceneRideTypes 每帧取，缺了会抛错）')

rep("const MOVING_OBSTACLE = { lakeside: 'train', tunnel: 'train', city: 'car', campus: 'bike' };",
    "const MOVING_OBSTACLE = { lakeside: 'train', tunnel: 'train', city: 'car', campus: 'bike', campus2: 'bike' };",
    '行驶障碍注册表加 campus2')

rep("const SCENE_WEIGHTS = { lakeside: 0.25, tunnel: 0.15, city: 0.3, campus: 0.3 };",
    "const SCENE_WEIGHTS = { lakeside: 0.22, tunnel: 0.13, city: 0.27, campus: 0.26, campus2: 0.12 };",
    '轮换权重加入 campus2')

rep("""    if (!urlTheme) Scene.queue = ['lakeside', 'city', 'tunnel'];""",
    """    if (!urlTheme) Scene.queue = ['lakeside', 'city', 'campus2', 'tunnel'];""",
    '开场队列加医学部')

# ---------------------------------------------------------------- 3. 底板可见性（buildWorld）
rep("""    if (CAMPUS.group) CAMPUS.group.visible = (id === 'campus');""",
    """    for (const _S of Object.values(CAMPUS_SETS)) {
        if (_S.group) _S.group.visible = (_S.id === id);   // 两个校园底板各自对齐
    }""",
    'buildWorld 底板可见性按集合对齐')

# ---------------------------------------------------------------- 4. 川大门覆盖 campus2
rep("""            // 校园段尾声：川大校门立在跑道上，穿过去传送到下一场景
            else if (Scene.id === 'campus') spawnPortalPreview('gate', Scene.next);""",
    """            // 校园段尾声：川大校门立在跑道上，穿过去传送到下一场景
            else if (Scene.id === 'campus' || Scene.id === 'campus2') spawnPortalPreview('gate', Scene.next);""",
    '川大门覆盖 campus2')

# ---------------------------------------------------------------- 5. 菜单选择器加医学部
rep("""        <button data-theme="campus">燕园 · 未名湖</button>""",
    """        <button data-theme="campus">燕园 · 未名湖</button>
        <button data-theme="campus2">医学部</button>""",
    '菜单加医学部 chip')

rep("""        campus: '燕园 · 未名湖：北大真实数据，3011m 一圈，有 10 个急弯要打方向',""",
    """        campus: '燕园 · 未名湖：北大真实数据，3011m 一圈，有 10 个急弯要打方向',
        campus2: '医学部：学院路 38 号实测，1924m 矩形环穿教学区与宿舍区，4 个直角弯',""",
    '选择器说明加医学部')

io.open(SRC, 'w', encoding='utf-8', newline='').write(s)
print('patch14 完成（%d 项）：' % len(changes))
for c in changes:
    print('  ·', c)
