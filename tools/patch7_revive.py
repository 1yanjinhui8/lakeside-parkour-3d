# -*- coding: utf-8 -*-
"""给 playable.html 加「复活币」：
   规则：100 米起每 100 米结算一次，第 n 个 100 米 = n%；5000 米（第 50 次）必出；
        出过之后概率清零，从 1% 重新攒。拾取后死亡自动复活。
"""
import io, sys

P = 'playable.html'
s = io.open(P, encoding='utf-8').read()
n0 = len(s)


def rep(old, new, cnt=1):
    global s
    c = s.count(old)
    assert c == cnt, '锚点命中 %d 次（期望 %d）: %r' % (c, cnt, old[:90])
    s = s.replace(old, new)


# ------------------------------------------------------------------ ① 配置注释
rep(
    "    coinScore: 10,\n};",
    "    coinScore: 10,\n"
    "    // 复活币的参数（概率 / 必出里程 / 无敌时长）见 GAME-DATA 段的 REVIVE_CFG\n"
    "    // —— 放在纯数据区是为了让 Node 测试和游戏共用同一份数值\n"
    "};",
)

# ------------------------------------------------------- ② 纯数据：概率与结算
rep(
    "// 加权随机选下一场景（不重复当前），rng 默认 Math.random",
    """// ---- 复活币：概率随里程累积 ----
// 规则：从 100 米开始，每 100 米结算一次；第 n 个 100 米 = n% 概率（1%,2%,3%…）；
//       到 5000 米（第 50 次）必出，不看概率；出过之后概率清零，重新从 1% 开始攒。
const REVIVE_CFG = {
    step: 100,          // 每跑 100 米结算一次
    pctPerStep: 1,      // 每过 100 米，概率 +1%
    forceAt: 5000,      // 到这个里程必刷（不吃概率）
    maxHold: 3,         // 最多同时持有几个复活币
    invuln: 2.6,        // 复活后的无敌秒数
    clearAhead: 110,    // 复活瞬间清空前方多少米的障碍
};

// 第 n 个刻度的命中概率（0~1）：n% ；到 forceAt 之后恒为 1
function reviveChanceAt(n, cfg) {
    cfg = cfg || REVIVE_CFG;
    const forceN = Math.round(cfg.forceAt / cfg.step);
    if (n >= forceN) return 1;
    return Math.max(0, Math.min(1, (n * cfg.pctPerStep) / 100));
}

// 结算一个刻度：base = 本轮周期起点，cp = 本次要判定的刻度里程
// 返回 { hit, n, p, base, next }：命中后 base 重置到 cp（概率清零），下个刻度从 1% 重来
function reviveRoll(base, cp, rng, cfg) {
    cfg = cfg || REVIVE_CFG;
    rng = rng || Math.random;
    const n = Math.round((cp - base) / cfg.step);
    const p = reviveChanceAt(n, cfg);
    const hit = rng() < p;
    return { hit, n, p, base: hit ? cp : base, next: cp + cfg.step };
}

// 加权随机选下一场景（不重复当前），rng 默认 Math.random""",
)

# ------------------------------------------------------------- ③ 状态字段初始化
rep(
    "        nextRowS: 45, nextPowerS: 500, safeLane: 1, lastMovingS: -1000,",
    "        nextRowS: 45, nextPowerS: 500, safeLane: 1, lastMovingS: -1000,\n"
    "        // 复活币：reviveBase = 本轮周期起点，nextReviveS = 下一个待判定的刻度\n"
    "        revives: 0, reviveBase: 0, nextReviveS: REVIVE_CFG.step,\n"
    "        reviveSpawned: 0, reviveUsed: 0, lastDeathCause: '',",
)

# ------------------------------------------------- ④ 道具/复活币统一的摆放函数
rep(
    """function placePowerUp(lane, s, type = pick(Object.keys(CONFIG.powerUps))) {
    const mesh = makePowerMesh(type);
    const p = { type, x: LANES[lane], y: 1.2, z: zOf(s), mesh };
    mesh.position.set(p.x, p.y, p.z);
    scene.add(mesh);
    pickups.push(p);
}""",
    """function placePickup(lane, s, type) {
    const revive = type === 'revive';
    const mesh = revive ? makeReviveMesh() : makePowerMesh(type);
    const p = { type, x: LANES[lane], y: revive ? 1.55 : 1.2, z: zOf(s), mesh };
    mesh.position.set(p.x, p.y, p.z);
    scene.add(mesh);
    pickups.push(p);
    return p;
}

function placePowerUp(lane, s, type = pick(Object.keys(CONFIG.powerUps))) {
    return placePickup(lane, s, type);
}

// ---------- 复活币投放 ----------
// 每 100 米结算一次概率；命中就摆一个，并把这个周期的概率清零
function spawnReviveIfDue(s) {
    let guard = 0;
    while (s >= S.nextReviveS && guard++ < 8) {
        const cp = S.nextReviveS;
        const r = reviveRoll(S.reviveBase, cp);
        S.reviveBase = r.base;
        S.nextReviveS = r.next;
        if (!r.hit) continue;
        placeRevive(cp);
        S.reviveSpawned++;
        return;                    // 一行最多出一个，别让两个复活币挤在一起
    }
}

// 选一条此刻最干净的道，把复活币摆上去
function placeRevive(cp) {
    // 柱阵区中间道是禁区：只往两侧摆
    const cands = (Scene.id === 'tunnel' && S.pillar && S.pillar.active) ? [0, 2] : [0, 1, 2];
    let lane = cands[0];
    for (const l of cands) if (S.laneFree[l] < S.laneFree[lane]) lane = l;
    // 一般就摆在刚结算的那个刻度上；那条道最近被占过就往后挪到干净处
    let at = Math.max(cp, S.D + 60);
    at = Math.max(at, S.laneFree[lane] + 16);
    placePickup(lane, at, 'revive');
    S.laneFree[lane] = Math.max(S.laneFree[lane], at + 10);   // 这一段先别塞障碍，保证拿得到
    return { lane, at };
}""",
)

# --------------------------------------------------------------- ⑤ 生成入口挂上
rep(
    """function spawnRow(s) {
    // 隧道·柱阵区走专用分支：中间道被封，只留左右两条 + 一辆火车
    if (Scene.id === 'tunnel' && pillarRow(s)) return;""",
    """function spawnRow(s) {
    spawnReviveIfDue(s);            // 复活币的里程概率（与障碍生成互不干扰）
    // 隧道·柱阵区走专用分支：中间道被封，只留左右两条 + 一辆火车
    if (Scene.id === 'tunnel' && pillarRow(s)) return;""",
)

# ------------------------------------------------------------ ⑥ 复活币的3D外观
rep(
    """    g.add(icon);
    g.userData.icon = icon;
    return g;
}""",
    """    g.add(icon);
    g.userData.icon = icon;
    return g;
}

// ---------- 复活币：比普通道具更大更亮，远处先看见一根粉色光柱 ----------
const reviveCoinGeo = shared(new THREE.CylinderGeometry(0.52, 0.52, 0.13, 30).rotateX(Math.PI / 2));
const reviveGoldMat = shared(new THREE.MeshStandardMaterial({
    color: 0xffd75e, metalness: 0.85, roughness: 0.18, emissive: 0xff5c9a, emissiveIntensity: 0.55,
}));
const reviveHeartMat = shared(new THREE.MeshStandardMaterial({
    color: 0xff2f6d, emissive: 0xff2f6d, emissiveIntensity: 1.5, roughness: 0.35, metalness: 0.1,
}));
const reviveRingMat = shared(new THREE.MeshBasicMaterial({
    color: 0xff7ab5, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
}));
const reviveBeamMat = shared(new THREE.MeshBasicMaterial({
    color: 0xff5c9a, transparent: true, opacity: 0.12,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
}));
const reviveRingGeo = shared(new THREE.TorusGeometry(0.78, 0.05, 8, 40));
const reviveRing2Geo = shared(new THREE.TorusGeometry(0.96, 0.022, 6, 40));
const reviveBeamGeo = shared(new THREE.CylinderGeometry(0.62, 0.62, 9, 16, 1, true));
const reviveGlowGeo = shared(new THREE.CircleGeometry(1.15, 28));

// 心形图案（币面上的徽记）
function makeHeartGeo(size) {
    const sh = new THREE.Shape();
    sh.moveTo(0, -0.28 * size);
    sh.bezierCurveTo(0.46 * size, 0.04 * size, 0.32 * size, 0.40 * size, 0, 0.17 * size);
    sh.bezierCurveTo(-0.32 * size, 0.40 * size, -0.46 * size, 0.04 * size, 0, -0.28 * size);
    const g = new THREE.ExtrudeGeometry(sh, {
        depth: 0.06, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1,
    });
    g.center();
    return shared(g);
}
const reviveHeartGeo = makeHeartGeo(1.0);

function makeReviveMesh() {
    const g = new THREE.Group();
    const spin = new THREE.Group();                 // pickup 循环每帧转这个
    spin.add(new THREE.Mesh(reviveCoinGeo, reviveGoldMat));
    for (const side of [1, -1]) {                   // 正反两面都刻心，转起来不会突然变空币
        const h = new THREE.Mesh(reviveHeartGeo, reviveHeartMat);
        h.position.z = side * 0.085;
        if (side < 0) h.rotation.y = Math.PI;
        spin.add(h);
    }
    const ring = new THREE.Mesh(reviveRingGeo, reviveRingMat);
    const ring2 = new THREE.Mesh(reviveRing2Geo, reviveRingMat);
    ring2.rotation.x = Math.PI / 2;                 // 一圈竖着、一圈横着，形成立体光晕
    const beam = new THREE.Mesh(reviveBeamGeo, reviveBeamMat);
    beam.position.y = 3.4;
    const glow = new THREE.Mesh(reviveGlowGeo, reviveRingMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -1.5;                         // 币心 1.55 → 地面光斑
    g.add(ring, ring2, spin, beam, glow);
    g.userData.icon = spin;
    g.userData.ring = ring;
    return g;
}""",
)

# ------------------------------------------------------------ ⑦ 拾取判定分支
rep(
    """        p.mesh.userData.icon.rotation.y += dt * 3;
        const dx = p.x - S.x, dy = p.y - cy, dz = p.z;
        if (dx * dx + dy * dy + dz * dz < 1.7) {
            S.power[p.type] = powerDur(p.type);
            if (p.type === 'wings') startFlight();
            else { SFX.power(); showMsg('获得 ' + CONFIG.powerUps[p.type].icon + ' ' + CONFIG.powerUps[p.type].name + '！'); }
            disposeObj(p.mesh); pickups.splice(i, 1);
        } else if (p.z > 4) {""",
    """        p.mesh.userData.icon.rotation.y += dt * 3;
        if (p.mesh.userData.ring) p.mesh.userData.ring.rotation.z += dt * 1.4;
        const dx = p.x - S.x, dy = p.y - cy, dz = p.z;
        const hitR = p.type === 'revive' ? 3.4 : 1.7;    // 复活币体积大，判定放宽，别擦肩而过
        if (dx * dx + dy * dy + dz * dz < hitR) {
            if (p.type === 'revive') takeRevive();
            else {
                S.power[p.type] = powerDur(p.type);
                if (p.type === 'wings') startFlight();
                else { SFX.power(); showMsg('获得 ' + CONFIG.powerUps[p.type].icon + ' ' + CONFIG.powerUps[p.type].name + '！'); }
            }
            disposeObj(p.mesh); pickups.splice(i, 1);
        } else if (p.z > 4) {""",
)

# ------------------------------------------------------- ⑧ 拾取 / 复活 / 死亡
rep(
    """function die(text) {
    S.state = 'dying';
    S.dieT = 0;
    $('overTitle').textContent = text;
    SFX.crash();
}""",
    """// ---------- 复活币：拾取与使用 ----------
function takeRevive() {
    S.revives = Math.min(REVIVE_CFG.maxHold, S.revives + 1);
    SFX.power();
    SFX.shield();
    showMsg('💖 捡到复活币！死亡自动复活（持有 ' + S.revives + ' 个）');
}

// 用掉一个复活币：原地复活 + 清空身前障碍 + 短暂无敌
function useRevive() {
    S.revives--;
    S.reviveUsed++;
    S.state = 'playing';
    S.dieT = 0;
    // 清场：身前这一段的迎面车、支撑柱、栏杆全部清掉，给一次真正的喘息
    for (let i = obstacles.length - 1; i >= 0; i--) {
        const o = obstacles[i];
        if (o.z + o.len / 2 > -REVIVE_CFG.clearAhead && o.z - o.len / 2 < 8) {
            disposeObj(o.mesh);
            obstacles.splice(i, 1);
        }
    }
    S.y = 0; S.vy = 0; S.grounded = true; S.rolling = 0; S.anticip = 0;
    S.stumbleCool = 0;
    S.chaserTimer = 0;                    // 把追上来的保安甩回去
    S.chaserDist = 16;
    S.landGrace = 0;
    S.transGrace = Math.max(S.transGrace || 0, REVIVE_CFG.invuln);
    player.root.rotation.set(0, 0, 0);
    if (typeof chaserModel !== 'undefined') chaserModel.rotation.set(0, 0, 0);
    const f = $('reviveFlash');
    if (f) { f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }   // 重触发一次闪光
    SFX.shield();
    showMsg('💖 复活币生效！原地复活（还剩 ' + S.revives + ' 个）');
}

function die(text) {
    S.lastDeathCause = text;              // 死因留档：复活之后也能查到是被什么撞的
    if (S.revives > 0) { useRevive(); return; }
    S.state = 'dying';
    S.dieT = 0;
    $('overTitle').textContent = text;
    SFX.crash();
}""",
)

# ------------------------------------------------------------------ ⑨ HUD DOM
rep(
    '        <div id="coinBox">🪙 <span id="hudCoins">0</span></div>',
    '        <div id="coinBox">🪙 <span id="hudCoins">0</span></div>\n'
    '        <div id="reviveBox" class="hidden">💖 <span id="hudRevive">0</span></div>',
)

rep(
    '    #coinBox { font-size: 24px; color: #ffd84a; }',
    '    #coinBox { font-size: 24px; color: #ffd84a; }\n'
    '    #reviveBox { font-size: 22px; color: #ff7ab5; text-shadow: 0 0 12px rgba(255,110,170,.75); }\n'
    '    /* 复活币生效瞬间的粉光 */\n'
    '    #reviveFlash {\n'
    '        position: fixed; inset: 0; z-index: 17; pointer-events: none; opacity: 0;\n'
    '        background: radial-gradient(circle at 50% 62%, rgba(255,120,175,.6), rgba(255,60,120,.18) 44%, rgba(255,60,120,0) 72%);\n'
    '    }\n'
    '    #reviveFlash.on { animation: reviveFlash .8s ease-out; }\n'
    '    @keyframes reviveFlash { 0% { opacity: 0 } 12% { opacity: 1 } 100% { opacity: 0 } }',
)

rep(
    '<div id="fade"></div>',
    '<div id="fade"></div>\n<div id="reviveFlash"></div>',
)

# --------------------------------------------------------------- ⑩ 结算面板
rep(
    '    <div class="stat">距离 <b id="overDist">0</b> m</div>',
    '    <div class="stat">距离 <b id="overDist">0</b> m</div>\n'
    '    <div class="stat" id="overRevive"></div>',
)

rep(
    "    $('overBank').innerHTML = `本局金币已入库！金库总计 🪙 <b>${fmtCoin(SAVE.bank)}</b>`;",
    "    $('overBank').innerHTML = `本局金币已入库！金库总计 🪙 <b>${fmtCoin(SAVE.bank)}</b>`;\n"
    "    $('overRevive').textContent = S.reviveUsed > 0 ? `💖 复活币救场 ×${S.reviveUsed}` : '';",
)

# ------------------------------------------------------------------- ⑪ HUD 刷新
rep(
    "const hudCache = { score: -1, coins: -1, best: -1, dist: -1, powerSig: '', bars: {} };",
    "const hudCache = { score: -1, coins: -1, best: -1, dist: -1, revives: -1, powerSig: '', bars: {} };",
)

rep(
    """    const dist = Math.floor(S.D);
    if (dist !== hudCache.dist) { $('hudDist').textContent = dist + ' m'; hudCache.dist = dist; }""",
    """    const dist = Math.floor(S.D);
    if (dist !== hudCache.dist) { $('hudDist').textContent = dist + ' m'; hudCache.dist = dist; }
    if (S.revives !== hudCache.revives) {
        $('hudRevive').textContent = S.revives;
        $('reviveBox').classList.toggle('hidden', S.revives <= 0);
        hudCache.revives = S.revives;
    }""",
)

# ------------------------------------------------------------- ⑫ 调试导出
rep(
    """    placeMoving, movingCrash,   // 行驶障碍（测试用）""",
    """    placeMoving, movingCrash,   // 行驶障碍（测试用）
    REVIVE_CFG, reviveChanceAt, reviveRoll, placeRevive, spawnReviveIfDue, takeRevive, useRevive, die,   // 复活币（测试用）""",
)

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('patch7 ok  %d -> %d 字节' % (n0, len(s)))
