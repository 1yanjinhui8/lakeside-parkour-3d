# -*- coding: utf-8 -*-
"""
patch17_campus.py —— 校园：树/绿篱撞上判死 + 转向窗口收紧到 10m（幂等）

   1. 校园里的行道树、垂柳、绿篱以前只是装饰网格，能直接穿过去。
      现在把它们和楼一起登记成静态实体（art.js），主模块做精确扫掠判定：
      撞上行道树 / 绿篱 / 教学楼都会死。附「三条道全被占死」豁免，杜绝必死局。
      加了底板坐标空间哈希，避免上千棵树每帧全表遍历。
   2. 转向输入窗口 72m → 10m：只在离路口 10m 内按方向键（或滑动屏幕）
      才算「打方向」，远离 10m 只会在三条车道间左右换道。
      没及时拐弯仍然判负，复活币回到路口前 100m 的设定保持不变。

用法： "D:/PythonAPPS/python386/python.exe" tools/patch17_campus.py
依赖：先跑 inline-art.py（art.js 的实体登记）、patch10_inline.py atmo oldtown（灯效回滚）
"""
import io, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'playable.html')
s = io.open(HTML, encoding='utf-8', newline='').read()
orig = len(s)
notes = []


def rep(old, new, note):
    global s
    n = s.count(old)
    if n == 0:
        # 幂等：新内容已经在文件里，说明这一条上次已应用过
        probe = new.strip().split('\n')[0][:40]
        if probe and probe in s:
            print('  [..] ' + note + '（已应用）')
            return
        raise AssertionError('锚点缺失：' + note)
    assert n == 1, '锚点异常（%d 次）：%s' % (n, note)
    s = s.replace(old, new, 1)
    notes.append(note)
    print('  [OK] ' + note)


# ------------------------------------------------------------------ ① 转向窗口
rep(
    """    S.INPUT_WINDOW = 72;      // 路口前这个距离内按下才算数""",
    """    S.INPUT_WINDOW = 10;      // 只有离路口 10m 内按下才算「打方向」；再远只换道""",
    'INPUT_WINDOW 72m → 10m')

rep(
    """    S.TURN_HOLD = 30;""",
    """    S.TURN_HOLD = 10;         // 和转向窗口对齐：最后 10m 没打方向才冻住底板朝向""",
    'TURN_HOLD 30m → 10m')

rep(
    """function campusNoteInput(dir) {
    if (curTheme !== CAMPUS.id || !CAMPUS.ready) return;
    CAMPUS.pendingDir = dir;
    CAMPUS.pendingAt = CAMPUS.s;
}""",
    """function campusNoteInput(dir) {
    if (curTheme !== CAMPUS.id || !CAMPUS.ready) return;
    // 只有「离路口 10m 以内」的横向输入才登记为转向；
    // 更远的地方按左右键 / 滑屏只走 moveLane，在跑道上正常换道，不算打方向。
    const C = CAMPUS;
    const toJ = C.nextAbs - C.s;
    if (toJ <= 0 || toJ > C.INPUT_WINDOW) return;
    C.pendingDir = dir;
    C.pendingAt = C.s;
}""",
    'campusNoteInput 加 10m 窗口')

rep(
    """    const need = j.dir === 'L' ? -1 : 1;
    const ok = C.pendingDir === need;
    el.classList.remove('hidden');
    el.classList.toggle('ok', ok);
    const ar = el.querySelector('.ar'), tx = el.querySelector('.tx');
    if (ar) ar.textContent = j.dir === 'L' ? '⬅' : '➡';
    if (tx) tx.textContent = (ok ? '已转向 · ' : (j.dir === 'L' ? '左转 ' : '右转 '))
        + Math.max(0, Math.round(dist)) + 'm';""",
    """    const need = j.dir === 'L' ? -1 : 1;
    const near = dist <= C.INPUT_WINDOW;
    const ok = near && C.pendingDir === need;
    el.classList.remove('hidden');
    el.classList.toggle('ok', ok);
    const ar = el.querySelector('.ar'), tx = el.querySelector('.tx');
    if (ar) ar.textContent = j.dir === 'L' ? '⬅' : '➡';
    const m = Math.max(0, Math.round(dist)) + 'm';
    if (tx) tx.textContent = !near
        ? (j.dir === 'L' ? '左转 ' : '右转 ') + m + ' · 10m 内再打方向'
        : (ok ? '已转向 · ' : '现在打方向！') + m;""",
    '路口提示按 10m 窗口改文案')

# ------------------------------------------------------------------ ② 整块替换碰撞工具
BEGIN = '// ==== PATCH15-BEGIN（tools/patch15_gameplay.py 生成，勿手改）===='
END = '// ==== PATCH15-END ===='
assert BEGIN in s and END in s, '找不到 PATCH15 工具块'

HELPERS = r"""// ==== PATCH15-BEGIN（tools/patch15_gameplay.py 生成，勿手改）====
// ==== PATCH17：校园静态实体（楼 / 树 / 绿篱）与极速联动，见 tools/patch17_campus.py ====
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
//  校园静态实体碰撞
//
//  实体由 art.js 在造景时登记，坐标是底板坐标（和 CAMPUS.pts / sideAt 同一套）：
//    kind='box'   教学楼主楼体，有向矩形
//    kind='hedge' 绿篱段，有向矩形（矮，跳得过去）
//    kind='tree'  行道树 / 垂柳，圆形（跳不过去）
//  不用 ART_BLOCKERS：那是 OSM 原始多边形外包盒，看着压路、实际墙在 6m 外，
//  拿它判会冤死人。底板 GLB 里的楼和树按 ≥6m 净空生成，玩家在路线 ±2.4m 内，
//  正常直道撞不到；真正压进跑道的是弯道处用平滑方向摆出来的代码生成实体。
// ---------------------------------------------------------------------
const SOLID_CELL = 8;
let _solidGrid = null, _solidGridSrc = null;

function campusBoxes() {
    return (typeof ART !== 'undefined' && ART.getBuildingBoxes)
        ? ART.getBuildingBoxes(CAMPUS.id) : [];
}

/** 底板坐标 8m 网格：上千棵树不能每帧全表扫 */
function campusSolidGrid() {
    const boxes = campusBoxes();
    if (_solidGrid && _solidGridSrc === boxes) return _solidGrid;
    const g = new Map();
    for (const b of boxes) {
        const ex = b.kind === 'tree' ? b.r : Math.abs(b.hw * b.c) + Math.abs(b.hd * b.s);
        const ez = b.kind === 'tree' ? b.r : Math.abs(b.hw * b.s) + Math.abs(b.hd * b.c);
        for (let gx = Math.floor((b.x - ex) / SOLID_CELL); gx <= Math.floor((b.x + ex) / SOLID_CELL); gx++) {
            for (let gz = Math.floor((b.z - ez) / SOLID_CELL); gz <= Math.floor((b.z + ez) / SOLID_CELL); gz++) {
                const k = gx + ',' + gz;
                let arr = g.get(k);
                if (!arr) { arr = []; g.set(k, arr); }
                arr.push(b);
            }
        }
    }
    _solidGrid = g; _solidGridSrc = boxes;
    return g;
}
/** 取覆盖该点的候选实体（注册时已按外扩范围写进所有相交网格，查单格即可） */
function nearCampusSolids(qx, qz) {
    return campusSolidGrid().get(Math.floor(qx / SOLID_CELL) + ',' + Math.floor(qz / SOLID_CELL)) || [];
}

/** 命中判据：树用圆，楼/绿篱用有向矩形；pad 是玩家半径 */
function inCampusBox(b, qx, qz, pad) {
    const dx = qx - b.x, dz = qz - b.z;
    if (b.kind === 'tree') {
        const rr = b.r + pad;
        return dx * dx + dz * dz <= rr * rr;
    }
    const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
    return Math.abs(lx) <= b.hw + pad && Math.abs(lz) <= b.hd + pad;
}

/**
 * 未来某个「轨道里程 s」处，哪几条车道被静态实体占住。
 * spawnRow 用它保证：实体占两条道时，剩下那条道绝不刷障碍。
 * arc 与 placeOnTrack 同一套：C.s + (s - S.D)。
 */
function campusBlockedLanes(s, arcOverride) {
    if (!CAMPUS.ready || (curTheme !== 'campus' && curTheme !== 'campus2')) return [];
    if (!campusBoxes().length) return [];
    const arc = arcOverride != null ? arcOverride : CAMPUS.s + (s - S.D);
    const p = campusPoint(arc), d = campusDir(arc);
    const rx = -d.z, rz = d.x;
    const out = [];
    for (let l = 0; l < 3; l++) {
        const qx = p.x + rx * LANES[l], qz = p.z + rz * LANES[l];
        for (const b of nearCampusSolids(qx, qz)) {
            if (inCampusBox(b, qx, qz, 0.38)) { out.push(l); break; }
        }
    }
    return out;
}

/**
 * 前方 38m 内这条道会不会被实体占住。换道时拦一下：
 * 楼/树横在两条道上的那段正好压在路口前，而按方向键登记转向会顺带 moveLane，
 * 不挡住的话玩家为了过弯必须往实体里挤，就成了必死局。
 */
function campusLaneBlockedSoon(lane) {
    if (!CAMPUS.ready || (curTheme !== 'campus' && curTheme !== 'campus2')) return false;
    if (!campusBoxes().length) return false;
    for (let a = CAMPUS.s; a <= CAMPUS.s + 38; a += 3) {
        const p = campusPoint(a), d = campusDir(a);
        const qx = p.x - d.z * LANES[lane], qz = p.z + d.x * LANES[lane];
        for (const b of nearCampusSolids(qx, qz)) if (inCampusBox(b, qx, qz, 0.38)) return true;
    }
    return false;
}

/** 玩家这一帧有没有撞进静态实体；返回 true = 已处理（判死 / 护盾挡下） */
function campusWallCrash(dt) {
    if (S.flying || S.state !== 'playing' || Scene.phase !== 'run') return false;
    if (!CAMPUS.ready || (curTheme !== 'campus' && curTheme !== 'campus2')) return false;
    if (!campusBoxes().length) return false;
    const C = CAMPUS, ct = Math.cos(C.theta), st = Math.sin(C.theta);
    const p = campusPoint(C.s);
    // 玩家在底板坐标下的位置：路线点 + 横向车道偏移。
    // 横向用「当前底板朝向」而不是路线朝向 —— 路口冻住转向时，判定和画面才一致。
    const bx = p.x + S.x * ct, bz = p.z + S.x * st;
    const fx = st, fz = -ct;      // 本帧前进方向（底板坐标）
    const rx = ct, rz = st;       // 横向（底板坐标）
    const reach = clamp(S.speed * dt + 0.75, 0.9, 3.2);
    const pass = S.wallPass;

    // 必死局豁免：三条道同时被实体占死时不能判死（否则玩家无论怎么走都得死）。
    // 只要还留着一条活路，撞上实体就照常判负。
    let freeLane = false;
    for (const lx of LANES) {
        const qx = p.x + lx * ct, qz = p.z + lx * st;
        let blocked = false;
        for (const b of nearCampusSolids(qx, qz)) {
            if (S.y > b.h - 0.2) continue;
            if (inCampusBox(b, qx, qz, 0.38)) { blocked = true; break; }
        }
        if (!blocked) { freeLane = true; break; }
    }
    if (!freeLane) return false;

    // 沿前进方向取 4 个采样点 × 3 个横向采样点，等价于一个带半径的扫掠体
    for (let k = 0; k <= 3; k++) {
        const t = reach * k / 3;
        for (const side of [-0.32, 0, 0.32]) {
            const qx = bx + fx * t + rx * side, qz = bz + fz * t + rz * side;
            for (const b of nearCampusSolids(qx, qz)) {
                if (pass && pass.indexOf(b) >= 0) continue;   // 护盾刚挡过的那个实体
                if (S.y > b.h - 0.2) continue;                // 跳过矮绿篱 / 在楼顶之上
                if (!inCampusBox(b, qx, qz, 0.22)) continue;
                return campusWallHit(b);
            }
        }
    }
    return false;
}

function campusWallHit(b) {
    const what = b.kind === 'tree' ? '行道树' : (b.kind === 'hedge' ? '绿篱' : '教学楼');
    // 护盾按「支撑柱」的规则硬扛一次；实体是静态的，得记下它本次不再判死，
    // 否则下一帧人还在树里会被连续判死，护盾等于白给。
    if (S.power.shield > 0) {
        S.power.shield = 0;
        if (!S.wallPass) S.wallPass = [];
        S.wallPass.push(b);
        S.chaserTimer = Math.max(S.chaserTimer, 5);
        SFX.shield(); SFX.guard();
        showMsg('🛡️ 护盾硬扛了一下' + what + '！' + CONFIG.chaser.name + '追上来了');
        return false;
    }
    die(b.kind === 'box' ? '一头撞上了教学楼！' : '一头撞上了' + what + '！');
    return true;
}
// ==== PATCH15-END ====
"""

a = s.index(BEGIN)
b = s.index(END) + len(END)
s = s[:a] + HELPERS.rstrip('\n') + s[b:]
notes.append('整块替换碰撞工具（树/绿篱 + 空间哈希 + 必死豁免）')

# ------------------------------------------------------------------ ③ 验收出口
if 'campusBoxes, nearCampusSolids' not in s:
    rep(
        """    spawnRow, checkCollisions,   // 关卡生成 / 碰撞（无必死局扫荡用）""",
        """    spawnRow, checkCollisions,   // 关卡生成 / 碰撞（无必死局扫荡用）
    campusBoxes, nearCampusSolids, inCampusBox,   // 校园静态实体（撞树/撞楼验收用）""",
        'window.__game 增加校园实体验收出口')

# ------------------------------------------------------------------ ④ 验收脚本的自动转向时机
FULLRUN = os.path.join(ROOT, 'tools', 'fullrun.mjs')
f = io.open(FULLRUN, encoding='utf-8', newline='').read()
if "dist <= 30" in f:
    f = f.replace("dist <= 30", "dist <= 9", 1)
    io.open(FULLRUN, 'w', encoding='utf-8', newline='').write(f)
    notes.append('fullrun.mjs 自动打方向时机 30m → 9m')
print('  [OK] fullrun.mjs 自动打方向时机（30m → 9m，与 10m 窗口对齐）')

# ------------------------------------------------------------------ 落盘
io.open(HTML, 'w', encoding='utf-8', newline='').write(s)
print('')
print('playable.html %.2fMB -> %.2fMB（%+d 字符）' % (orig / 1e6, len(s) / 1e6, len(s) - orig))
