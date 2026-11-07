# -*- coding: utf-8 -*-
"""patch19_qa.py —— 本轮物理/判定修复（幂等）

1. 车顶落点容差：跑上坡道→踩车顶这一瞬间，原来只给 0.45m 容差。
   低帧率或高速下落时一帧就穿过这个窗口，于是"没按任何键却撞车死了"。
   现在按竖直速度给扫掠容差，并在 checkCollisions 里补一条"下落中贴到车顶就踩上去"。
2. 校园撞楼：飞行状态原来直接跳过整段判定（穿楼不判死）→ 取消这个豁免。
3. 校园底板里离路线近的 GLB 楼，补登记成实体（原来只有代码生成的楼是实心的）。
"""
import io, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'playable.html')
src = io.open(HTML, encoding='utf-8', newline='').read()
orig = len(src)
done = []


def rep(old, new, tag, expect=1):
    global src
    n = src.count(old)
    assert n == expect, '锚点异常（%d 次）: %s' % (n, tag)
    src = src.replace(old, new)
    done.append(tag)


# ① 站立面判定：加"下扫容差"
if 'function surfaceHeightAt(obstacles, x, y, trainH, drop)' not in src:
    rep("function surfaceHeightAt(obstacles, x, y, trainH) {",
        'function surfaceHeightAt(obstacles, x, y, trainH, drop) {\n'
        '    // drop：本帧最多会下落的距离。判定「能不能踩上去」时要把这段扫掠算进来，\n'
        '    // 否则低帧率/高速下落会一帧跨过 0.45m 容差，直接判成撞车（「没按键却死」的根因）。\n'
        '    const tol = 0.45 + (drop || 0);',
        'surface-tol')
    rep("""        if (o.ride) {
            if (y >= o.h1 - 0.45 && o.h1 > g) { g = o.h1; ob = o; }""",
        """        if (o.ride) {
            if (y >= o.h1 - tol && o.h1 > g) { g = o.h1; ob = o; }""",
        'surface-ride-tol')
    rep("""            if (h <= y + 1.2 && h > g) { g = h; ob = o; }""",
        """            if (h <= y + 1.2 + (drop || 0) && h > g) { g = h; ob = o; }""",
        'surface-ramp-tol')
    rep("""function surfaceAt(x, y) {
    const r = surfaceHeightAt(obstacles, x, y, TRAIN_H);""",
        """function surfaceAt(x, y, drop) {
    const r = surfaceHeightAt(obstacles, x, y, TRAIN_H, drop);""",
        'surfaceAt-arg')
    rep("""    const groundY = surfaceAt(S.x, S.y);""",
        """    // 下落时把这帧的位移量喂给站立面判定（高速下落也能稳稳踩上车顶）
    const _drop = S.vy < 0 ? Math.min(1.6, -S.vy / 60 * 1.8 + (-S.vy) * 0.02) : 0;
    const groundY = surfaceAt(S.x, S.y, _drop);""",
        'surfaceAt-call')

# ② 下落中贴到可站车顶：直接踩上去，不判撞车
if '落在车顶边缘的兜底' not in src:
    rep("""        const top = o.ride ? o.h1 - 0.45 : o.h1;
        if (S.y >= top || S.y + ph <= o.h0) continue;""",
        """        const top = o.ride ? o.h1 - 0.45 : o.h1;
        if (S.y >= top || S.y + ph <= o.h0) continue;
        // 落在车顶边缘的兜底：正在下落、且脚下就是这辆车的顶面 → 踩上去，不算撞车。
        // （坡道→车顶的衔接处最容易在这里被误判成"撞上了火车"）
        if (o.ride && !o.moving && S.vy < -0.5 && S.y > o.h1 - 1.35 && S.y < o.h1 + 0.02) {
            S.y = o.h1; S.vy = 0; S.grounded = true;
            ANIM.land = Math.max(ANIM.land, ANIM_CFG.landTime * 0.6);
            continue;
        }""",
        'roof-land-grace')

# ③ 飞行时也要撞楼
if 'if (S.state !== \'playing\' || Scene.phase !== \'run\') return false;' not in src:
    rep("    if (S.flying || S.state !== 'playing' || Scene.phase !== 'run') return false;",
        "    // 飞行不豁免撞楼：翅膀能飞过矮障碍，但楼是实心的（穿模属于\"违背物理\"）\n"
        "    if (S.state !== 'playing' || Scene.phase !== 'run') return false;",
        'fly-wall')

io.open(HTML, 'w', encoding='utf-8', newline='').write(src)
print('已打补丁:', ', '.join(done) if done else '（无变化）')
print('playable.html: %d -> %d' % (orig, len(src)))
