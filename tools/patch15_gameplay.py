# -*- coding: utf-8 -*-
"""
patch15_gameplay.py —— 正式版玩法补丁（幂等，可重复跑）

   1. 校园建筑撞楼判死：楼照旧占路，只补精确碰撞（有向矩形），
      并保证楼占两道时安全道留空，不产生必死局。
   2. 速度上限倍率 2.0x -> 1.6x。
   3. 到顶后障碍密度 x1.5、迎面障碍自带速度 x1.5，
      同时加严「同时最多一辆行驶障碍」和「三道全封死」的防护。

用法： "D:/PythonAPPS/python386/python.exe" tools/patch15_gameplay.py
"""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'playable.html')

s = io.open(HTML, encoding='utf-8', newline='').read()
orig_len = len(s)
notes = []


def rep(old, new, note, once=True):
    global s
    n = s.count(old)
    assert n >= 1, '锚点缺失：%s' % note
    if once:
        assert n == 1, '锚点重复 %d 次：%s' % (n, note)
    s = s.replace(old, new, 1)
    notes.append(note)
    print('  [OK] ' + note)


def has(mark):
    return mark in s


# ------------------------------------------------------------------ ① 速度上限
if not has('maxMul: 1.6'):
    rep(
        "    speed: { start: 15, max: 60, step: 1000, factor: 1.1 }, // 单位/秒，每跑 step 米速度乘以 factor（1.1 倍）",
        """    // maxMul：极限速度相对起始速度的封顶倍率。原本按 2.0 倍封顶，现压到 1.6 倍
    // （15 m/s -> 24 m/s）；到顶后由 TOP_SPEED 难度联动接管（障碍 / 迎面车变难）。
    // max 仍是绝对安全上限，防止以后调 factor 时失控。
    speed: { start: 15, max: 60, maxMul: 1.6, step: 1000, factor: 1.1 }, // 每 step 米速度 ×factor""",
        '速度封顶 2.0x -> 1.6x')

# ------------------------------------------------------------------ ② 常量 + 撞楼 / 极速工具
MARK = '// ==== PATCH15-BEGIN（tools/patch15_gameplay.py 生成，勿手改）===='
END = '// ==== PATCH15-END ===='
HELPERS = r"""// ==== PATCH15-BEGIN（tools/patch15_gameplay.py 生成，勿手改）====
// ---------------------------------------------------------------------
//  极速阶段难度联动
// ---------------------------------------------------------------------
const TOP_OBSTACLE_MUL = 1.5;       // 到顶后障碍数量 ×1.5（靠行距缩到 1/1.5 实现）
const TOP_MOVING_SPEED_MUL = 1.5;   // 到顶后迎面障碍自带速度 ×1.5

/** 基础速度封顶（不含 THEMES.speedMul 的场景系数） */
function speedBaseCap() {
    return Math.min(CONFIG.speed.max, CONFIG.speed.start * (CONFIG.speed.maxMul || 1.6));
}
/** 基础速度是否已到封顶点（用基础速度判，避免校园 0.72 系数把判定拖后） */
function atTopSpeed() {
    const raw = CONFIG.speed.start * Math.pow(CONFIG.speed.factor, Math.floor(S.D / CONFIG.speed.step));
    return raw >= speedBaseCap() - 1e-6;
}
function topMovingMul() { return atTopSpeed() ? TOP_MOVING_SPEED_MUL : 1; }

function topSpeedTick() {
    if (!atTopSpeed() || S.topSpeedShown) return;
    S.topSpeedShown = true;
    showMsg('⚡ 已达极速 · 障碍密度 ×1.5 · 迎面车速 ×1.5');
}

// ---------------------------------------------------------------------
//  校园建筑碰撞：建筑仍然横在两条车道上，只补「撞上就死」的判定
//
//  为什么不用 AABB：ART_BLOCKERS 是 OSM 原始多边形的外包盒，
//  24 个框看着压路、实际几何在 6m 外，拿它判会冤死人。
//  这里用的是 art.js 造楼时登记的**有向矩形**（和楼体几何同源），
//  底板 GLB 里的楼离路线 ≥6m，玩家永远在路线 ±2.4m 内，撞不到，不用管。
// ---------------------------------------------------------------------
function campusBoxes() {
    return (typeof ART !== 'undefined' && ART.getBuildingBoxes)
        ? ART.getBuildingBoxes(CAMPUS.id) : [];
}

/** 盒体局部坐标命中的公共判据（x/z 是底板坐标，pad 是玩家半径） */
function inCampusBox(b, qx, qz, pad) {
    const dx = qx - b.x, dz = qz - b.z;
    const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
    return Math.abs(lx) <= b.hw + pad && Math.abs(lz) <= b.hd + pad;
}

/**
 * 未来某个「轨道里程 s」处，哪几条车道被楼占住。
 * 生成障碍时用来保证：楼占两条道时，剩下那条道绝不刷障碍。
 * arc 与 placeOnTrack 用的是同一套：C.s + (s - S.D)。
 */
function campusBlockedLanes(s, arcOverride) {
    if (!CAMPUS.ready || (curTheme !== 'campus' && curTheme !== 'campus2')) return [];
    const boxes = campusBoxes();
    if (!boxes.length) return [];
    const arc = arcOverride != null ? arcOverride : CAMPUS.s + (s - S.D);
    const p = campusPoint(arc), d = campusDir(arc);
    const rx = -d.z, rz = d.x;
    const out = [];
    for (let l = 0; l < 3; l++) {
        const qx = p.x + rx * LANES[l], qz = p.z + rz * LANES[l];
        for (const b of boxes) {
            if (inCampusBox(b, qx, qz, 0.38)) { out.push(l); break; }
        }
    }
    return out;
}

/**
 * 前方 38m 内这条道会不会被楼占住。
 * 换道时用它「挡一下」：楼横在两条道上的那段正好压在右转路口前，
 * 而按右键登记转向会顺带 moveLane(+1) —— 不挡住的话，
 * 玩家为了过弯必须往被楼占的道里挤，就成了必死局。
 * 方向键仍然登记转弯，只是换道被墙拦下，人留在唯一那条活路上。
 */
function campusLaneBlockedSoon(lane) {
    if (!CAMPUS.ready || (curTheme !== 'campus' && curTheme !== 'campus2')) return false;
    const boxes = campusBoxes();
    if (!boxes.length) return false;
    for (let a = CAMPUS.s; a <= CAMPUS.s + 38; a += 3) {
        const p = campusPoint(a), d = campusDir(a);
        const qx = p.x - d.z * LANES[lane], qz = p.z + d.x * LANES[lane];
        for (const b of boxes) if (inCampusBox(b, qx, qz, 0.38)) return true;
    }
    return false;
}

/** 玩家这一帧有没有撞进楼里；返回 true = 已处理（判死 / 护盾挡下） */
function campusWallCrash(dt) {
    if (S.flying || S.state !== 'playing' || Scene.phase !== 'run') return false;
    if (!CAMPUS.ready || (curTheme !== 'campus' && curTheme !== 'campus2')) return false;
    const boxes = campusBoxes();
    if (!boxes.length) return false;
    const C = CAMPUS, ct = Math.cos(C.theta), st = Math.sin(C.theta);
    const p = campusPoint(C.s);
    // 玩家在底板坐标下的位置：路线点 + 横向车道偏移。
    // 横向用「当前底板朝向」而不是路线朝向 —— 路口冻住转向时，判定和画面才一致。
    const bx = p.x + S.x * ct, bz = p.z + S.x * st;
    const fx = st, fz = -ct;      // 本帧前进方向（底板坐标）
    const rx = ct, rz = st;       // 横向（底板坐标）
    const reach = clamp(S.speed * dt + 0.75, 0.9, 3.2);
    const pass = S.wallPass;
    // 沿前进方向取 4 个采样点 × 3 个横向采样点，等价于一个带半径的扫掠体
    for (let k = 0; k <= 3; k++) {
        const t = reach * k / 3;
        for (const side of [-0.32, 0, 0.32]) {
            const qx = bx + fx * t + rx * side, qz = bz + fz * t + rz * side;
            for (const b of boxes) {
                if (pass && pass.indexOf(b) >= 0) continue;   // 护盾刚挡过的那栋楼
                if (S.y > b.h - 0.2) continue;                // 在楼顶之上不算撞
                if (!inCampusBox(b, qx, qz, 0.22)) continue;
                return campusWallHit(b);
            }
        }
    }
    return false;
}

function campusWallHit(b) {
    // 护盾按「支撑柱」的规则硬扛一次；楼是静态的，得记下这栋楼本次不再判死，
    // 否则下一帧人还在楼里会被连续判死，护盾等于白给。
    if (S.power.shield > 0) {
        S.power.shield = 0;
        if (!S.wallPass) S.wallPass = [];
        S.wallPass.push(b);
        S.chaserTimer = Math.max(S.chaserTimer, 5);
        SFX.shield(); SFX.guard();
        showMsg('🛡️ 护盾硬扛了一下教学楼！' + CONFIG.chaser.name + '追上来了');
        return false;
    }
    die('一头撞上了教学楼！');
    return true;
}
// ==== PATCH15-END ====
"""

if MARK in s:
    if 'PATCH17' in s:
        # patch17 已把这块升级成「楼 + 树 + 绿篱」的通用实体碰撞，
        # 这里不能再拿旧版 HELPERS 覆盖回去。
        notes.append('极速 / 撞楼工具块：已由 patch17 接管，跳过')
    else:
        a = s.index(MARK)
        b = s.index(END) + len(END) + 1
        s = s[:a] + HELPERS + s[b:]
        notes.append('极速 / 撞楼工具块（已替换）')
else:
    anchor = "const RAMP_LEN = 10;\n"
    assert s.count(anchor) == 1, 'RAMP_LEN 锚点异常'
    s = s.replace(anchor, anchor + '\n' + HELPERS, 1)
    notes.append('插入极速 / 撞楼工具块')

# ------------------------------------------------------------------ ③ 状态复位
if 'wallPass: null, topSpeedShown: false,' not in s:
    rep("        pillar: newPillarState(0),\n",
        "        pillar: newPillarState(0),\n"
        "        wallPass: null, topSpeedShown: false,   // 护盾挡过的楼 / 极速提示只弹一次\n",
        'resetState 补状态')

# ------------------------------------------------------------------ ④ checkCollisions 接上撞楼
if 'if (campusWallCrash(dt)) return;' not in s:
    rep(
        "function checkCollisions(dt) {\n    if (S.transGrace > 0) return;   // 转场无敌期\n",
        "function checkCollisions(dt) {\n"
        "    if (S.transGrace > 0) return;   // 转场无敌期\n"
        "    if (campusWallCrash(dt)) return;   // 校园：撞上教学楼（建筑照旧占路，只补判定）\n",
        'checkCollisions 接上撞楼判定')

# ------------------------------------------------------------------ ⑤ 速度计算 / 极速提示
if 'const _rawSpeed =' not in s:
    rep(
        """    S.speed = Math.min(CONFIG.speed.max, CONFIG.speed.start * Math.pow(CONFIG.speed.factor, Math.floor(S.D / CONFIG.speed.step))) * _spdMul;""",
        """    const _rawSpeed = CONFIG.speed.start * Math.pow(CONFIG.speed.factor, Math.floor(S.D / CONFIG.speed.step));
    S.speed = Math.min(speedBaseCap(), _rawSpeed) * _spdMul;
    topSpeedTick();                       // 首次到达 1.6x 封顶时提示难度联动开启""",
        'updatePlaying 速度封顶 + 极速提示')

# ------------------------------------------------------------------ ⑥ 行距 ×1.5
if 'gap / (atTopSpeed() ? TOP_OBSTACLE_MUL : 1)' not in s:
    rep(
        """                const spd = pkRnd
                    ? Math.min(CONFIG.speed.max, CONFIG.speed.start * Math.pow(CONFIG.speed.factor, Math.floor(S.nextRowS / CONFIG.speed.step)))
                    : S.speed;
                S.nextRowS += 20 + spd * 0.7 + Math.random() * 14;""",
        """                const spd = pkRnd
                    ? Math.min(speedBaseCap(), CONFIG.speed.start * Math.pow(CONFIG.speed.factor, Math.floor(S.nextRowS / CONFIG.speed.step)))
                    : S.speed;
                // 极速阶段障碍数量 ×1.5：行距缩到 1/1.5。26m 是反应距离地板
                // （24m/s 约 1.1s），再密就来不及换道了。
                const gap = 20 + spd * 0.7 + Math.random() * 14;
                S.nextRowS += Math.max(26, gap / (atTopSpeed() ? TOP_OBSTACLE_MUL : 1));""",
        '极速阶段行距 → 障碍 ×1.5')

# ------------------------------------------------------------------ ⑦ 迎面障碍速度 ×1.5
if 'o.extraRate || 0.45) * topMovingMul()' not in s:
    rep(
        """        if (o.moving) o.extra = S.speed * (o.extraRate || 0.45);   // 玩家提速 → 迎面车跟着提速""",
        """        // 极速阶段：只放大障碍「自己迎面开」的那部分速度，不是整体时间流速
        if (o.moving) o.extra = S.speed * (o.extraRate || 0.45) * topMovingMul();""",
        '极速阶段迎面障碍速度 ×1.5')

# ------------------------------------------------------------------ ⑧ 相遇点用真实闭合速度
if '(1 + 0.45 * topMovingMul())' not in s:
    rep(
        """    const meetArc = CAMPUS.s + (s - S.D) / 1.45;""",
        """    // 相遇里程要按「真实相对速度」算：极速阶段迎面车更快，相遇点会更靠前
    const meetArc = CAMPUS.s + (s - S.D) / (1 + 0.45 * topMovingMul());""",
        '相遇里程随车速联动')

# ------------------------------------------------------------------ ⑨ 迎面车前后净空随速度放大
if '40 * topMovingMul()' not in s:
    rep(
        """    S.laneFree[lane] = Math.max(S.laneFree[lane], s + L + 40);""",
        """    // 车更快 → 留给玩家的换道净空也要同步放大
    S.laneFree[lane] = Math.max(S.laneFree[lane], s + L + 40 * topMovingMul());""",
        '迎面车净空 ×1.5')

# ------------------------------------------------------------------ ⑩ spawnRow：楼占道时的公平性
if 'const wallLanes =' not in s:
    rep(
        """    if (isCampus && campusJunctionGap(CAMPUS.s + (s - S.D)) < J_CLEAR) return;""",
        """    if (isCampus && campusJunctionGap(CAMPUS.s + (s - S.D)) < J_CLEAR) return;
    // 校园里有几栋楼横在两条车道上（医学部路口最典型）。楼照旧占路，
    // 但「唯一活路」那一段必须完全不刷障碍，否则就是必死局。
    const wallLanes = isCampus ? campusBlockedLanes(s) : [];
    if (wallLanes.length >= 3) return;              // 兜底：三条道全被楼占，整行不刷
    if (wallLanes.length >= 2) {
        const free = [0, 1, 2].filter(l => wallLanes.indexOf(l) < 0);
        S.safeLane = free[0];
        S.laneSafeUntil[S.safeLane] = s;
        return;                                     // 楼有纵深，前后各让出一行
    }""",
        '楼占两道时整行留空')

if 'if (free.indexOf(S.safeLane) < 0) S.safeLane = pick(free);' not in s:
    rep(
        """    if (Scene.id === 'tunnel' && pillarRow(s)) return;
    // 偶尔把安全道换到相邻且已空出足够距离的车道
    if (Math.random() < 0.35) {
        const cands = [S.safeLane - 1, S.safeLane + 1].filter(l => l >= 0 && l <= 2 && S.laneFree[l] <= s - 22);""",
        """    if (Scene.id === 'tunnel' && pillarRow(s)) return;
    // 楼只占一条道时，安全道也必须避开它
    if (wallLanes.length) {
        const free = [0, 1, 2].filter(l => wallLanes.indexOf(l) < 0);
        if (!free.length) return;
        if (free.indexOf(S.safeLane) < 0) S.safeLane = pick(free);
    }
    // 偶尔把安全道换到相邻且已空出足够距离的车道
    if (Math.random() < 0.35) {
        const cands = [S.safeLane - 1, S.safeLane + 1].filter(l => l >= 0 && l <= 2
            && wallLanes.indexOf(l) < 0 && S.laneFree[l] <= s - 22);""",
        '安全道避开被楼占的车道')

# ------------------------------------------------------------------ ⑪ 行驶障碍全局独占（确定性，堵死三排火车）
if 'const MOVING_GAP =' not in s:
    rep(
        """    for (let lane = 0; lane < 3; lane++) {""",
        """    // 全模式统一用「里程差」判独占，不再单靠看帧时机的 obstacles.some：
    // 极速阶段车更快、行更密，两辆迎面车一旦错位叠到同一段就是三排封死。
    // 165m 的间隔 + 单帧最多一辆，保证任何时刻至少留两条可走的车道。
    const MOVING_GAP = 110 * (atTopSpeed() ? TOP_OBSTACLE_MUL : 1);
    for (let lane = 0; lane < 3; lane++) {""",
        '行驶障碍最小里程间隔')
    rep(
        """    else if (canMoving && !meetNearJ && (dueMoving || r < 0.56)
        && (window.__pkRnd ? (s - S.lastMovingS > 120) : !obstacles.some(o => o.moving))) { placeMoving(lane, s); S.lastMovingS = s; }""",
        """    else if (canMoving && !meetNearJ && (dueMoving || r < 0.56)
        && s - S.lastMovingS > MOVING_GAP
        && (window.__pkRnd ? true : !obstacles.some(o => o.moving))) { placeMoving(lane, s); S.lastMovingS = s; }""",
        '行驶障碍全局独占判定')

# ------------------------------------------------------------------ ⑪b 换道不允许挤进楼里
if 'if (campusLaneBlockedSoon(nl)) return;' not in s:
    rep(
        """function moveLane(d) {
    const nl = clamp(S.lane + d, 0, 2);
    if (nl === S.lane) return;
    S.prevLane = S.lane;""",
        """function moveLane(d) {
    const nl = clamp(S.lane + d, 0, 2);
    if (nl === S.lane) return;
    if (campusLaneBlockedSoon(nl)) return;   // 前方有楼横在这条道上：别把人推进墙里
    S.prevLane = S.lane;""",
        '换道避开楼体')

# ------------------------------------------------------------------ ⑫ 飞行落地加速也按新封顶
if 'Math.min(speedBaseCap(), S.speed + 1.5)' not in s:
    rep("            S.speed = Math.min(CONFIG.speed.max, S.speed + 1.5);",
        "            S.speed = Math.min(speedBaseCap(), S.speed + 1.5);",
        '落地加速遵守 1.6x 封顶')

# ------------------------------------------------------------------ ⑬ 调试出口
if 'spawnRow, checkCollisions,' not in s:
    # 去掉旧版插入的验收出口，避免重复跑脚本时越插越多
    s = s.replace("    speedBaseCap, atTopSpeed, topMovingMul, campusBlockedLanes, campusWallCrash,  // 极速 / 撞楼（验收用）\n", "")
    rep(
        """    placeMoving, movingCrash,   // 行驶障碍（测试用）""",
        """    placeMoving, movingCrash,   // 行驶障碍（测试用）
    speedBaseCap, atTopSpeed, topMovingMul, campusBlockedLanes, campusWallCrash,  // 极速 / 撞楼（验收用）
    spawnRow, checkCollisions,   // 关卡生成 / 碰撞（无必死局扫荡用）""",
        'window.__game 增加验收出口')

# ------------------------------------------------------------------ 落盘
io.open(HTML, 'w', encoding='utf-8', newline='').write(s)
print('')
print('playable.html %.2fMB -> %.2fMB（%+d 字符）' % (orig_len / 1e6, len(s) / 1e6, len(s) - orig_len))
