// ── 主逻辑片段 07/08 ──────────────────────────────
// 分节：b 动画核心 + 飞行控制器 + 障碍物 / 金币 / 道具 的模型 + 游戏状态 + 关卡生成 + 物理 / 碰撞
// 按编号顺序合起来 = src/game.module.js 的全部逻辑（资源已用占位符替代）
// 生成自 playable.html，勿手改；重跑 tools/extract-src.py 同步
// ────────────────────────────────────────────────────────────────

//  ⑧b 动画核心 + 飞行控制器
//  纯逻辑，不依赖 THREE / DOM；node 测试按标记直接从本文件提取执行
//  TESTABLE-CORE-START
// =====================================================================
const TAU = Math.PI * 2;
const clampC = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth01 = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const easeOutC = t => 1 - Math.pow(1 - clamp01(t), 3);
const easeInC = t => Math.pow(clamp01(t), 2.2);
/** 与帧率无关的阻尼 */
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * Math.max(0, dt)));

let ARM_Z_SCALE = 1;      // 真实模型的手臂张开缩小比例（避免肩部拉伸）
let ARM_Z_DIR = 1;        // 手臂向外对应的 z 旋转方向（代码角色 +1，真实骨骼 -1）
const ANIM_CFG = {
    runRate: 17, airRate: 12, landRate: 24, flyRate: 10,
    jumpAnticip: 0.09,     // 起跳前下蹲蓄力 (s)
    landTime: 0.24,        // 落地缓冲时长 (s)
    squashMax: 0.17,       // 落地下压幅度
    stretchMax: 0.08,      // 起跳拉伸幅度
    hairRate: 7,
    rollTime: 0.62,
    jointLimit: 3.4,       // 单关节最大摆角（测试用）
};

function createAnim() {
    return { k: 1, t: 0, airT: 0, land: 0, squash: 0, stretch: 0, hair: 0, lean: 0, bank: 0 };
}

/** 每帧推进动画状态（帧率无关） */
function stepAnim(a, dt, st) {
    st = st || {};
    const grounded = !!st.grounded, flying = !!st.flying;
    a.t += dt;
    a.k = 1 - Math.exp(-(grounded ? ANIM_CFG.runRate : flying ? ANIM_CFG.flyRate : ANIM_CFG.airRate) * Math.max(0, dt));
    a.airT = (grounded || flying) ? 0 : a.airT + dt;
    if (a.land > 0) a.land = Math.max(0, a.land - dt);
    // 落地压缩：落地瞬间最大，随后回弹
    const landP = a.land > 0 ? 1 - a.land / ANIM_CFG.landTime : 0;
    a.squash = damp(a.squash, a.land > 0 ? Math.sin(Math.PI * clamp01(landP)) : 0, 30, dt);
    // 起跳拉伸
    const stretch = (!grounded && !flying && (st.vy || 0) > 4.5 && a.airT < 0.16) ? ANIM_CFG.stretchMax : 0;
    a.stretch = damp(a.stretch, stretch, 20, dt);
    // 头发 / 衣角惯性
    const vy = st.vy || 0, speed = st.speed || 0;
    const hairTarget = flying
        ? 0.5 + 0.35 * clamp01(speed / 31)
        : clampC(-vy / 15, -0.85, 0.85) * 0.85 + clamp01(speed / 34) * 0.3;
    a.hair = damp(a.hair, hairTarget, ANIM_CFG.hairRate, dt);
    // 横向倾斜 / 飞行侧倾
    a.lean = damp(a.lean, clampC((st.vx || 0) / 9, -1, 1), 11, dt);
    a.bank = damp(a.bank, flying ? clampC((st.vx || 0) / 12, -1, 1) : 0, 8, dt);
    return a;
}

// ---- 关节辅助：阻尼逼近目标（k 由 stepAnim 按帧长算出） ----
const JR = (obj, axis, target, k) => { if (obj) obj.rotation[axis] += (target - obj.rotation[axis]) * k; };
const JP = (obj, axis, target, k) => { if (obj) obj.position[axis] += (target - obj.position[axis]) * k; };

function poseRun(h, a, st) {
    const k = a.k, p = st.phase || 0, s = Math.sin(p);
    const spd = clamp01(((st.speed || 15) - 10) / 24);        // 0..1 速度系数
    const swing = 0.95 + spd * 0.38;      // 大腿摆幅加大（大臂同理），让上段肢体明显在摆动
    h.pivot.rotation.x = 0;
    JP(h.pivot, 'y', 0.9, k);
    JP(h.body, 'y', -0.9 + Math.abs(Math.cos(p)) * (0.055 + spd * 0.05), k);
    h.body.scale.y = 1 - a.squash * 0.12;
    h.body.scale.x = 1 + a.squash * 0.06;
    JR(h.body, 'y', s * 0.07, k);
    JR(h.body, 'z', a.lean * 0.1, k);
    // 腿：大腿前后摆、后摆时屈膝（跑步的重心变化）
    JR(h.legL, 'x', s * swing, k);
    JR(h.legR, 'x', -s * swing, k);
    JR(h.legL, 'z', 0.05, k);
    JR(h.legR, 'z', -0.05, k);
    JR(h.kneeL, 'x', -0.20 - 1.30 * Math.max(0, Math.sin(p + 0.55)), k);
    JR(h.kneeR, 'x', -0.20 - 1.30 * Math.max(0, Math.sin(-p + 0.55)), k);
    // 躯干反向扭转（跑步自然感的关键）
    JR(h.torso, 'y', -s * 0.3, k);
    JR(h.torso, 'x', -0.15 - spd * 0.09, k);
    JR(h.torso, 'z', -a.lean * 0.05, k);
    // 手臂与腿反相、肘部随速度弯曲
    JR(h.armL, 'x', -s * (1.25 + spd * 0.40), k);
    JR(h.armR, 'x', s * (1.25 + spd * 0.40), k);
    const flare = 0.16 + spd * 0.06 + Math.abs(s) * 0.26;   // 摆臂时手臂向外张开（贴身体，别甩成翅膀）
    JR(h.armL, 'z', flare * 0.6 * ARM_Z_DIR, k);            // 左右一致地贴身体，别甩成翅膀
    JR(h.armR, 'z', -flare * 0.6 * ARM_Z_DIR, k);
    JR(h.elbowL, 'x', 1.00 + Math.max(0, -s) * 0.55, k);
    JR(h.elbowR, 'x', 1.00 + Math.max(0, s) * 0.55, k);
    // 头部保持稳定
    JR(h.head, 'x', 0.11 + Math.cos(p * 2) * 0.02, k);
    JR(h.head, 'y', s * 0.04 - a.lean * 0.07, k);
    // 头发 / 衣角次级运动
    JR(h.hair, 'x', -0.34 - a.hair * 0.5, k);
    JR(h.hair, 'z', -a.lean * 0.14, k);
    return h;
}

/** 起跳前的下蹲蓄力（预备动作） */
function poseCrouch(h, a, st) {
    const k = a.k;
    const q = 1 - clamp01((st.anticip || 0) / ANIM_CFG.jumpAnticip);   // 0→1 蓄力完成
    h.pivot.rotation.x = 0;
    JP(h.pivot, 'y', 0.9, k);
    JP(h.body, 'y', -0.9 - 0.2 * q, k);
    h.body.scale.y = 1 - 0.1 * q;
    h.body.scale.x = 1 + 0.05 * q;
    JR(h.legL, 'x', 0.55 * q, k); JR(h.legR, 'x', 0.55 * q, k);
    JR(h.kneeL, 'x', -1.05 * q, k); JR(h.kneeR, 'x', -1.05 * q, k);
    JR(h.torso, 'x', -0.3 * q, k);
    JR(h.armL, 'x', 0.55 * q, k); JR(h.armR, 'x', 0.55 * q, k);
    JR(h.armL, 'z', 0.2, k); JR(h.armR, 'z', -0.2, k);
    JR(h.elbowL, 'x', 0.5, k); JR(h.elbowR, 'x', 0.5, k);
    JR(h.hair, 'x', -0.3 - 0.2 * q, k);
    return h;
}

/** 空中：起跳伸展 → 顶点收腿 → 下落伸腿准备落地 */
function poseAir(h, a, st) {
    const k = a.k, vy = st.vy || 0;
    const rise = clamp01(vy / 8), fall = clamp01(-vy / 12);
    const tuck = clamp01(1 - Math.abs(vy) / 9);
    h.pivot.rotation.x = 0;
    JP(h.pivot, 'y', 0.9, k);
    JP(h.body, 'y', -0.9, k);
    h.body.scale.y = 1 + a.stretch;
    h.body.scale.x = 1 - a.stretch * 0.5;
    JR(h.body, 'z', a.lean * 0.08, k);
    JR(h.legL, 'x', 0.5 * rise + 1.2 * tuck + 0.15 * fall, k);
    JR(h.kneeL, 'x', -0.3 - 1.5 * tuck - 0.2 * fall, k);
    JR(h.legR, 'x', -0.4 * rise - 0.45 * tuck + 0.3 * fall, k);
    JR(h.kneeR, 'x', -0.22 - 1.05 * tuck - 0.15 * fall, k);
    // 张开双臂保持平衡
    JR(h.armL, 'z', (1.15 + 0.55 * tuck) * ARM_Z_SCALE * ARM_Z_DIR, k);
    JR(h.armR, 'z', -(1.15 + 0.55 * tuck) * ARM_Z_SCALE * ARM_Z_DIR, k);
    JR(h.armL, 'x', -0.35 * rise + 0.25 * fall, k);
    JR(h.armR, 'x', -0.3 * rise + 0.22 * fall, k);
    JR(h.elbowL, 'x', 0.35, k); JR(h.elbowR, 'x', 0.22, k);
    JR(h.torso, 'x', -0.1, k);
    JR(h.head, 'x', 0.05 - 0.1 * rise, k);
    JR(h.hair, 'x', -0.5 - a.hair * 0.55, k);
    return h;
}

/** 落地缓冲：下压 → 回弹 */
function poseLand(h, a, st) {
    const k = a.k;
    const q = a.land > 0 ? 1 - a.land / ANIM_CFG.landTime : 0;
    const dip = Math.sin(Math.PI * clamp01(q));
    h.pivot.rotation.x = 0;
    JP(h.pivot, 'y', 0.9, k);
    JP(h.body, 'y', -0.9 - 0.24 * dip, k * 1.4);
    h.body.scale.y = 1 - 0.14 * dip;
    h.body.scale.x = 1 + 0.07 * dip;
    JR(h.legL, 'x', 0.8 * dip, k); JR(h.legR, 'x', 0.65 * dip, k);
    JR(h.kneeL, 'x', -1.3 * dip, k); JR(h.kneeR, 'x', -1.15 * dip, k);
    JR(h.torso, 'x', -0.4 * dip, k);
    JR(h.armL, 'z', 0.85 * dip * ARM_Z_SCALE * ARM_Z_DIR, k); JR(h.armR, 'z', -0.85 * dip * ARM_Z_SCALE * ARM_Z_DIR, k);
    JR(h.armL, 'x', -0.45 * dip, k); JR(h.armR, 'x', -0.4 * dip, k);
    JR(h.elbowL, 'x', 0.5, k); JR(h.elbowR, 'x', 0.4, k);
    JR(h.head, 'x', 0.2 * dip, k);
    JR(h.hair, 'x', -0.4 - 0.6 * dip, k);
    return h;
}

/** 前滚翻：贴地旋转一圈（旋转中心下移，起止都是 2π 的整数倍） */
function poseRoll(h, a, st) {
    const k = a.k, prog = clamp01(st.rollProg || 0);
    const rot = smooth01((prog - 0.08) / 0.8);
    const dip = Math.sin(Math.PI * clamp01(prog / 0.94));
    h.pivot.rotation.x = -TAU * rot;                     // 结束正好 -2π（视觉等于 0）
    JP(h.pivot, 'y', 0.9 - 0.36 * dip, 1);               // 贴地滚动
    JP(h.body, 'y', -0.9, k);
    h.body.scale.y = 1 - 0.12 * dip;
    h.body.scale.x = 1 + 0.05 * dip;
    const tuck = Math.sin(Math.PI * clamp01(prog / 0.92));
    JR(h.legL, 'x', 1.5 * tuck, k); JR(h.kneeL, 'x', -2.05 * tuck, k);
    JR(h.legR, 'x', 1.3 * tuck, k); JR(h.kneeR, 'x', -1.9 * tuck, k);
    JR(h.armL, 'x', 1.25 * tuck, k); JR(h.armR, 'x', 1.1 * tuck, k);
    JR(h.armL, 'z', 0.3 + 0.3 * tuck, k); JR(h.armR, 'z', -0.3 - 0.3 * tuck, k);
    JR(h.elbowL, 'x', 0.4 + 0.9 * tuck, k); JR(h.elbowR, 'x', 0.4 + 0.8 * tuck, k);
    JR(h.torso, 'x', -0.45 * tuck, k);
    JR(h.head, 'x', 0.45 * tuck, k);
    JR(h.hair, 'x', -0.3 - 0.7 * tuck, k);
    return h;
}

/** 飞行滑翔姿态（含侧倾、俯仰、脚下垂、头发上飘） */
function poseFly(h, a, st) {
    const k = a.k, t = a.t, climb = clampC(st.climb || 0, -1, 1);
    h.pivot.rotation.x = 0;
    JP(h.pivot, 'y', 0.9, k);
    JP(h.body, 'y', -0.9 + Math.sin(t * 2.1) * 0.02, k);
    h.body.scale.y = 1;
    h.body.scale.x = 1;
    JR(h.body, 'z', -a.bank * 0.3, k);
    JR(h.body, 'x', -0.16 - climb * 0.12, k);
    JR(h.legL, 'x', -0.34 + Math.sin(t * 2.4) * 0.05, k);
    JR(h.legR, 'x', -0.3 - Math.sin(t * 2.4) * 0.05, k);
    JR(h.kneeL, 'x', -0.55, k); JR(h.kneeR, 'x', -0.5, k);
    JR(h.legL, 'z', 0.06, k); JR(h.legR, 'z', -0.06, k);
    JR(h.armL, 'z', (1.35 - climb * 0.22) * ARM_Z_SCALE * ARM_Z_DIR, k);
    JR(h.armR, 'z', -(1.35 - climb * 0.22) * ARM_Z_SCALE * ARM_Z_DIR, k);
    JR(h.armL, 'x', -0.2, k); JR(h.armR, 'x', -0.2, k);
    JR(h.elbowL, 'x', 0.2, k); JR(h.elbowR, 'x', 0.2, k);
    JR(h.torso, 'x', 0.06, k);
    JR(h.head, 'x', -0.1 - climb * 0.12, k);
    JR(h.hair, 'x', -1.0 - a.hair * 0.4, k);
    return h;
}

/** 主菜单角色展示（面向镜头 + 挥手） */
function poseShowcase(h, a, t) {
    const k = a.k, wave = Math.sin(t * 3.3);
    h.pivot.rotation.x = 0;
    JP(h.pivot, 'y', 0.9, k);
    JP(h.body, 'y', -0.9 + Math.sin(t * 2.2) * 0.008, k);
    h.body.scale.y = 1; h.body.scale.x = 1;
    JR(h.legL, 'x', 0.02, k); JR(h.legR, 'x', -0.04, k);
    JR(h.kneeL, 'x', -0.05, k); JR(h.kneeR, 'x', -0.08, k);
    JR(h.torso, 'x', -0.04 + Math.sin(t * 2.2) * 0.02, k);
    JR(h.torso, 'y', Math.sin(t * 1.4) * 0.06, k);
    JR(h.armR, 'z', -2.1, k); JR(h.armR, 'x', -0.12, k);
    JR(h.elbowR, 'x', 0.45 + wave * 0.32, k);
    JR(h.armL, 'z', 0.26 + Math.sin(t * 2.2) * 0.02, k);
    JR(h.elbowL, 'x', 0.22, k);
    JR(h.head, 'x', 0.02, k); JR(h.head, 'y', Math.sin(t * 1.3) * 0.07, k);
    JR(h.hair, 'x', -0.24 + Math.sin(t * 1.7) * 0.05, k);
    return h;
}

function poseFall(h, a) {
    const k = a ? a.k : 1;
    h.pivot.rotation.x = 0;
    JP(h.pivot, 'y', 0.9, k);
    JR(h.root, 'x', 1.35, k);
    JR(h.armL, 'z', 1.6, k); JR(h.armR, 'z', -1.6, k);
    JR(h.legL, 'x', 0.4, k); JR(h.legR, 'x', 0.1, k);
    JR(h.kneeL, 'x', -0.3, k); JR(h.kneeR, 'x', -0.3, k);
    JR(h.hair, 'x', -0.9, k);
    return h;
}

/** 真实模型的主菜单待机展示：呼吸 + 轻微转身，不用挥手（避免骨骼轴向导致手臂横伸） */
function poseModelIdle(h, a, t) {
    const k = a.k;
    JP(h.pivot, 'y', 0.9, k);
    JP(h.body, 'y', -0.9 + Math.sin(t * 1.6) * 0.006, k);
    h.body.rotation.set(0, 0, 0);
    JR(h.legL, 'x', 0.02, k); JR(h.legR, 'x', -0.03, k);
    JR(h.kneeL, 'x', -0.04, k); JR(h.kneeR, 'x', -0.05, k);
    JR(h.torso, 'x', -0.02 + Math.sin(t * 1.6) * 0.015, k);
    JR(h.torso, 'y', Math.sin(t * 0.9) * 0.1, k);
    JR(h.armL, 'z', -0.04 - Math.sin(t * 1.6) * 0.02, k);
    JR(h.armR, 'z', 0.04 + Math.sin(t * 1.6) * 0.02, k);
    JR(h.armL, 'x', Math.sin(t * 1.1) * 0.05, k);
    JR(h.armR, 'x', -Math.sin(t * 1.1) * 0.05, k);
    JR(h.elbowL, 'x', 0.12, k); JR(h.elbowR, 'x', 0.12, k);
    JR(h.head, 'x', 0.02, k); JR(h.head, 'y', Math.sin(t * 0.7) * 0.12, k);
    return h;
}

/** 按当前状态选择姿态 */
function applyPose(h, a, st) {
    if (st.rolling > 0) return poseRoll(h, a, st);
    if (st.flying) return poseFly(h, a, st);
    if (!st.grounded) return poseAir(h, a, st);
    if ((st.anticip || 0) > 0) return poseCrouch(h, a, st);
    if (a.land > 0) return poseLand(h, a, st);
    return poseRun(h, a, st);
}

// ---------------------- 飞行控制器（状态机） ----------------------
const FLIGHT_CFG = {
    cruiseY: 7, takeoff: 0.55, land: 0.8, landPause: 0.22,
    altRate: 3.4, climbRange: 1.8, diveRange: 2.2, diveLand: 0.55, flare: 1.05,
};
function createFlight() {
    return { phase: 'idle', t: 0, y: 0, y0: 0, open: 0, active: false, done: false, landed: false, groundY: 0, maxY: 0 };
}
function beginFlight(f, groundY) {
    f.phase = 'takeoff'; f.t = 0; f.y0 = groundY; f.y = groundY; f.groundY = groundY;
    f.open = 0; f.active = true; f.done = false; f.landed = false; f.maxY = groundY;
    return f;
}
/**
 * 推进飞行器：idle → takeoff → cruise →(剩余时间耗尽 / 主动俯冲)→ descent → land → idle
 * @param f 飞行状态；@param dt 帧长；@param input {climb,dive}；@param ctx {groundY,timeLeft,cfg}
 */
function stepFlight(f, dt, input, ctx) {
    input = input || {}; ctx = ctx || {};
    const cfg = Object.assign({}, FLIGHT_CFG, ctx.cfg || {});
    const g = ctx.groundY != null ? ctx.groundY : f.groundY;
    const timeLeft = ctx.timeLeft != null ? ctx.timeLeft : 0;
    switch (f.phase) {
        case 'takeoff': {
            f.t += dt;
            const p = clamp01(f.t / cfg.takeoff);
            f.y = f.y0 + (cfg.cruiseY - f.y0) * easeOutC(p);
            f.open = easeOutC(clamp01(p * 1.6));
            f.maxY = Math.max(f.maxY, f.y);
            if (p >= 1) { f.phase = 'cruise'; f.t = 0; }
            break;
        }
        case 'cruise': {
            f.t += dt;
            // 按 ↓：直接收翼俯冲降落（提前结束飞行）
            if (input.dive) {
                f.phase = 'descent'; f.t = 0; f.y0 = f.y;
                break;
            }
            const target = cfg.cruiseY + (input.climb ? cfg.climbRange : 0);
            f.y = damp(f.y, target, cfg.altRate, dt);
            f.open = damp(f.open, 1, 8, dt);
            f.maxY = Math.max(f.maxY, f.y);
            if (timeLeft <= cfg.land + 0.12) { f.phase = 'descent'; f.t = 0; f.y0 = f.y; }
            break;
        }
        case 'descent': {
            f.t += dt;
            const dur = Math.max(0.35, Math.min(cfg.land, timeLeft + 0.25));
            const p = clamp01(f.t / dur);
            f.y = f.y0 + (g - f.y0) * easeInC(p);
            f.open = 1 - easeOutC(p);
            if (p >= 1) { f.phase = 'land'; f.t = 0; f.y = g; f.landed = true; }
            break;
        }
        case 'land': {
            f.t += dt;
            f.y = g;
            f.open = damp(f.open, 0, 12, dt);
            if (f.t >= cfg.landPause) { f.phase = 'idle'; f.active = false; f.done = true; }
            break;
        }
        default: break;
    }
    f.active = f.phase !== 'idle';
    return f;
}
//  TESTABLE-CORE-END
// ---- 地标 GLB：模型表 + 加载 ----------------------------------------
// 必须放在模块顶层：放到 `if (CONFIG.player.model …) { … }` 里面会变成块级作用域，
// 导出对象（window.__game）和后面的 buildCityWorld 都访问不到。
// 开发时走 HTTP（/assets/landmarks/*.glb），发布时由 tools/inline-landmarks.py 换成 data URI。
// 表里留空或文件不存在都会被 catch 掉，对应地标自动回退到代码生成版本——
// 所以「美术只做好 3 座」也能直接跑，不用等 7 座齐。
const LANDMARK_MODELS = {
    pearl:        'data:model/gltf-binary;base64,OMITTED-09-2.32MB-see-INLINE-ASSETS-md',        // 东方明珠（左 s0）
    guomao:       'data:model/gltf-binary;base64,OMITTED-10-2.14MB-see-INLINE-ASSETS-md',       // 国贸三期（左 s3）
    bamboo:       'data:model/gltf-binary;base64,OMITTED-11-1.34MB-see-INLINE-ASSETS-md',       // 春笋（左 s6）
    gateSuzhou:   'data:model/gltf-binary;base64,OMITTED-12-2.51MB-see-INLINE-ASSETS-md',   // 苏州东方之门（左 s9）
    gateHangzhou: 'data:model/gltf-binary;base64,OMITTED-13-2.28MB-see-INLINE-ASSETS-md', // 杭州之门（右 s1）
    waist:        'data:model/gltf-binary;base64,OMITTED-14-2.46MB-see-INLINE-ASSETS-md',        // 小蛮腰（右 s4）
    cbd:          'data:model/gltf-binary;base64,OMITTED-15-2.39MB-see-INLINE-ASSETS-md',          // 国贸 CBD 群（右 s7）
};

// ------------------------------------------------------------------
//  川大校门 GLB（传送门视觉）：原型只加载一次，spawnPortalPreview 时 clone
// ------------------------------------------------------------------
const GATE_FX = { proto: null, ready: false, size: null, center: null, baseY: 0 };
const GATE_URL = 'gz:model/gltf-binary;base64,OMITTED-16-4.24MB-see-INLINE-ASSETS-md';
// 原始模型 1.0 x 0.3 x 0.6 m；按门总宽 30 m 放大 → 高 9 m、进深 18 m
const GATE_SCALE = 30.0;

async function loadGateGLB() {
    if (GATE_FX.ready) return true;
    try {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader().loadAsync(await resolvePlate(GATE_URL));
        const root = gltf.scene;
        // 贴图各向异性 + 双面：门楼有大量薄檐口，单面渲染侧面会漏
        const maxAniso = renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 4;
        root.traverse(o => {
            if (!o.isMesh) return;
            o.castShadow = true;
            o.receiveShadow = true;
            const list = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of list) {
                if (!m) continue;
                m.side = THREE.DoubleSide;
                if (m.map) { m.map.anisotropy = Math.min(8, maxAniso); m.map.needsUpdate = true; }
                m.needsUpdate = true;
            }
        });
        GATE_FX.proto = root;
        // 真实包围盒：门是「底面贴地」还是「中心在原点」不能靠注释猜，量一次最省事
        const bbox = new THREE.Box3().setFromObject(root);
        GATE_FX.size = bbox.getSize(new THREE.Vector3());
        GATE_FX.center = bbox.getCenter(new THREE.Vector3());
        GATE_FX.baseY = -bbox.min.y;
        GATE_FX.ready = true;
        console.log('[gate] 川大校门 GLB 已载入（传送门视觉）');
        return true;
    } catch (e) {
        console.info('[gate] 校门 GLB 不可用，校园段尾声回退黑场:', e && e.message || e);
        return false;
    }
}

async function loadLandmarkGLBs() {
    const entries = Object.entries(LANDMARK_MODELS).filter(([, url]) => !!url);
    if (!entries.length) return { loaded: 0, total: 0 };
    // GLTFLoader 走动态导入：主模块顶层没有静态 import 它（角色模型那边也是这么用的）
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    let loaded = 0, missing = 0;
    await Promise.all(entries.map(async ([kind, url]) => {
        try {
            const gltf = await loader.loadAsync(url);
            if (LMGLB.register(kind, gltf.scene)) loaded++;
        } catch (e) {
            missing++;
            console.info('[landmark] ' + kind + ' 没有 GLB，回退代码生成');
        }
    }));
    if (loaded) console.log('[landmark] 已接入 ' + loaded + ' 座 GLB 地标', LMGLB.list());
    else console.log('[landmark] 没有 GLB 地标，全部使用代码生成版本');
    return { loaded, missing, total: entries.length };
}

const ANIM = createAnim();          // 玩家动画状态
const CHASER_ANIM = createAnim();   // 追捕者动画状态

let player = null;
if (CONFIG.player.model && CONFIG.player.model.length) {
    try { player = await loadModelCharacter(CONFIG.player.model); }
catch (e) { console.warn('[角色] GLB 模型不可用，回退到代码拼的角色:', e); }
// 地标 GLB：必须在第一次 buildCityWorld 之前注册好，否则建世界时 LMGLB 还是空的。
// 整个加载过程容错——文件缺失只是少几座 GLB，不会影响开局。
try { await loadLandmarkGLBs(); } catch (e) { console.warn('[landmark] 加载异常', e); }
// 川大门：校园段尾声的传送门视觉，同样容错——加载失败只是回退黑场
try { await loadGateGLB(); } catch (e) { console.warn('[gate] 加载异常', e); }
// 新葡京路标（传送门正后方）：有 GLB 就用模型 + 光效层，没有就走代码生成版
try { await loadLisboaGLB(); } catch (e) { console.warn('[lisboa] 加载异常', e); }
}
if (player && player.isModel) { ARM_Z_SCALE = 0.55; ARM_Z_DIR = -1; }
if (!player) player = buildHumanoid({ ...CONFIG.player.colors, longHair: CONFIG.player.longHair, glasses: CONFIG.player.glasses ? CONFIG.player.colors.glasses : 0 });
scene.add(player.root);
ATMO.attachPlayer(player.root);
const shieldBubble = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x55bbff, transparent: true, opacity: 0.25, emissive: 0x3399ff, emissiveIntensity: 0.5, depthWrite: false })
);
shieldBubble.position.y = 0.9;
shieldBubble.visible = false;
player.root.add(shieldBubble);

// ---------- 天使翅膀 ----------
const wingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, emissive: 0xfff4e0, emissiveIntensity: 0.25 });
wingMat.userData.shared = true;
// 单侧翅膀：向 +X 展开，由一根翼骨和两层扇形羽毛组成
function makeWing(mat) {
    const g = new THREE.Group();
    const bone = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.95, 4, 10), mat);
    bone.position.set(0.48, 0.3, 0);
    bone.rotation.z = -1.0;
    bone.castShadow = true;
    g.add(bone);
    const layers = [
        { n: 8, len: [0.55, 1.15], r: 0.075, z: -0.02, tilt: [0.1, 0.75] },   // 长飞羽
        { n: 6, len: [0.3, 0.6],   r: 0.085, z: 0.04,  tilt: [0.2, 0.6] },    // 短覆羽
    ];
    for (const L of layers) {
        for (let i = 0; i < L.n; i++) {
            const t = i / (L.n - 1);
            const len = L.len[0] + t * (L.len[1] - L.len[0]);
            const a = L.tilt[0] + t * (L.tilt[1] - L.tilt[0]);
            const bx = 0.08 + t * 0.86, by = 0.04 + t * 0.6;
            const f = new THREE.Mesh(new THREE.CapsuleGeometry(L.r, len, 4, 8), mat);
            f.scale.z = 0.35;
            f.rotation.z = a;   // 羽毛向下并略微向外
            f.position.set(bx + Math.sin(a) * len / 2, by - Math.cos(a) * len / 2, L.z);
            f.castShadow = true;
            g.add(f);
        }
    }
    return g;
}
// 挂在角色背后，左右镜像；flap 层负责扇动
const wings = [1, -1].map(side => {
    const mount = new THREE.Group();
    mount.position.set(side * 0.1, 0.55, 0.24);
    const flap = new THREE.Group();
    flap.add(makeWing(wingMat));
    mount.add(flap);
    mount.visible = false;
    (player.wingAnchor || player.torso).add(mount);
    return { mount, flap, side };
});
const halo = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 24),
    std(0xffe27a, { emissive: 0xffd040, emissiveIntensity: 1, metalness: 0.5 }));
halo.rotation.x = Math.PI / 2;
halo.position.y = 0.36;
halo.visible = false;
player.headAnchor ? player.headAnchor.add(halo) : player.head.add(halo);

let wingGrow = 0;
let wingPhase = 0;                      // 翅膀自己的慢速摆动计时（不受跑动相位影响）
/**
 * 翅膀视觉：open 0..1 由飞行状态机给出（起飞张开 / 降落收起），climb -1..1 影响迎角
 * 注意：扇动要慢（约 1.2Hz）+ 幅度小。之前用 S.phase 乘 11 相当于每秒上百弧度，非常晃眼。
 */
function updateWings(dt, open, climb) {
    climb = clamp(climb || 0, -1, 1);
    wingGrow = damp(wingGrow, clamp01(open), 7, dt);
    const k = Math.max(0.001, wingGrow) * 0.92;
    wingPhase += dt * (1.15 + 0.55 * clamp01(open) + 0.25 * climb);   // 约 1.2~1.7 Hz
    const flap = Math.sin(wingPhase * Math.PI * 2);
    const flapAmp = (0.09 + 0.07 * clamp01(open)) * (1 - 0.35 * Math.abs(climb));  // 幅度约 0.09~0.16 rad
    for (const w of wings) {
        w.mount.visible = wingGrow > 0.02;
        w.mount.scale.set(w.side * k, k, k);
        w.flap.rotation.y = -0.28 + climb * 0.1 + flap * 0.03;
        w.flap.rotation.z = -0.08 + flap * flapAmp + climb * 0.08;
    }
    halo.visible = wingGrow > 0.55;
    halo.rotation.z += dt * 0.8;
}

const chaser = buildHumanoid({ ...CONFIG.chaser.colors });
chaser.root.scale.setScalar(1.05);
scene.add(chaser.root);

// ---- 用真实 GLB 模型替换保安的外观 ----
const chaserModel = new THREE.Group();
let guardClock = 0;   // 保安动画时钟（秒），别用距离当相位，否则速度一快就抖
const chaserOldMeshes = [];
chaser.root.traverse(o => { if (o.isMesh) chaserOldMeshes.push(o); });
chaser.root.add(chaserModel);
const chaserLoadPromise = (async () => {
    try {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader().loadAsync("data:model/gltf-binary;base64,OMITTED-17-2.39MB-see-INLINE-ASSETS-md");
        const m = gltf.scene;
        m.traverse(o => { if (o.isMesh) { o.frustumCulled = false; if (o.material) o.material.side = THREE.FrontSide; } });
        m.rotation.y = 0;                            // 朝向由 chaserModel 每帧对准玩家
        m.updateMatrixWorld(true);   // 尺寸/缩放已在模型里烘焙，运行时不再缩放（SkinnedMesh 缩放会叠加）
        const box2 = new THREE.Box3().setFromObject(m);
        m.position.set(-(box2.min.x + box2.max.x) / 2, -box2.min.y, -(box2.min.z + box2.max.z) / 2);
        chaserModel.add(m);
        const bones = {};
        m.traverse(o => { if (o.isBone) bones[o.name] = o; });
        chaser.bones = bones;
        console.log('[保安] 骨骼:', Object.keys(bones).join(','));
        // 只摘掉代码拼的保安：GLB 已经替代它的外观，留着只是白白占着 ~34k 顶点和
        // 每次场景遍历的开销（之前只置 visible=false，网格仍挂在树上）。
        // 不 dispose 几何：这些几何体有可能是和玩家共用同一份，dispose 会连玩家一起弄坏。
        for (const o of chaserOldMeshes) {
            o.visible = false;
            if (o.parent) o.parent.remove(o);
        }
        chaserOldMeshes.length = 0;
        chaser.hasModel = true;
        console.log('[保安] GLB 模型已加载');
    } catch (e) {
        console.warn('[保安] GLB 加载失败，保留代码模型', e && (e.message || e));
    }
})();

// =====================================================================
//  ⑨ 障碍物 / 金币 / 道具 的模型
// =====================================================================
// ---- 火车：圆角车身 · 多节编组（造型按真实动车 / 地铁车厢来）----
// 尺寸：车宽 2.2、车顶 2.95（碰撞用 TRAIN_H=3.0，站在车顶几乎无落差）、
// 四角半径 0.5 的圆角断面，车长按总长自动拆成 2–4 节，节间留 0.55m 风挡。
const CAR_W = 2.2, CAR_H = 2.4, CAR_Y0 = 0.55, CAR_R = 0.5;

// 圆角断面沿 z 挤出：四个立角都是圆弧，不再是硬邦邦的方块
function roundedCarGeo(w, h, L, r) {
    const hw = w / 2, hh = h / 2;
    const s = new THREE.Shape();
    s.moveTo(-hw + r, -hh);
    s.lineTo(hw - r, -hh);
    s.quadraticCurveTo(hw, -hh, hw, -hh + r);
    s.lineTo(hw, hh - r);
    s.quadraticCurveTo(hw, hh, hw - r, hh);
    s.lineTo(-hw + r, hh);
    s.quadraticCurveTo(-hw, hh, -hw, hh - r);
    s.lineTo(-hw, -hh + r);
    s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    const geo = new THREE.ExtrudeGeometry(s, { depth: L, bevelEnabled: false, curveSegments: 5 });
    geo.translate(0, 0, -L / 2);
    // 重新算 UV：侧面 u 沿车长（每 4m 一个循环，正好对上 3 扇窗的贴图），顶/底 v 跨断面
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const endCap = Math.abs(Math.abs(z) - L / 2) < 0.001;
        if (endCap) {
            uv[i * 2] = (x + hw) / w;
            uv[i * 2 + 1] = (y + hh) / h;
        } else {
            uv[i * 2] = (z + L / 2) / 4;
            uv[i * 2 + 1] = (y + hh) / h;
        }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
}

// 单节车厢：车体（圆角）+ 底架 + 车门 + 车顶空调 + 转向架
function makeTrainCar(style, L, sideMat, isHead, isTail) {
    const car = new THREE.Group();
    const body = new THREE.Mesh(roundedCarGeo(CAR_W, CAR_H, L, CAR_R), [style.frontMat, sideMat]);
    body.position.y = CAR_Y0 + CAR_H / 2;
    body.castShadow = body.receiveShadow = true;
    car.add(body);

    // 底架 / 裙板：把车"压"在轨道上，避免车身悬空
    const under = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.52, L - 0.5), darkMat);
    under.position.y = 0.28;
    car.add(under);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.22, L - 0.9), rampMat);
    skirt.position.y = CAR_Y0 + 0.02;
    car.add(skirt);

    // 车门：两端各一扇，深色玻璃 + 细门框
    for (const sgn of [-1, 1]) {
        const dz = sgn * (L / 2 - 1.05);
        for (const sx of [-1, 1]) {
            const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.86, 0.86), glassDarkMat);
            door.position.set(sx * (CAR_W / 2 - 0.01), 1.62, dz);
            car.add(door);
            const frame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.98, 0.96), roofMat);
            frame.position.set(sx * (CAR_W / 2 - 0.04), 1.62, dz);
            car.add(frame);
        }
    }

    // 车顶：空调机组（对应真实车厢顶上的方盒子）
    for (let i = 0; i < 2; i++) {
        const ac = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, L * 0.26), roofMat);
        ac.position.set(0, CAR_Y0 + CAR_H + 0.07, (i ? 1 : -1) * L * 0.22);
        car.add(ac);
    }

    // 转向架 + 车轮（只在车底露出一半，够读"这是列车"）
    for (const sgn of [-1, 1]) {
        const bz = sgn * (L / 2 - 1.9);
        const bogie = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.34, 2.0), darkMat);
        bogie.position.set(0, 0.34, bz);
        car.add(bogie);
        for (const wz of [-0.62, 0.62]) {
            const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.9, 10), tireMat);
            axle.rotation.z = Math.PI / 2;
            axle.position.set(0, 0.34, bz + wz);
            car.add(axle);
        }
    }

    // 车头：驾驶室前窗 + 前照灯座（圆角断面的端面已经被贴图接管，这里只补立体结构）
    if (isHead) {
        const screen = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.62, 0.06), glassDarkMat);
        screen.position.set(0, 2.05, L / 2 + 0.01);
        car.add(screen);
        const brow = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.14, 0.22), roofMat);
        brow.position.set(0, 2.42, L / 2 - 0.06);
        car.add(brow);
        // 前部导流罩：一块向下的斜面，剪影不再是一刀切
        const nose = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.5, 0.36), rampMat);
        nose.position.set(0, 0.72, L / 2 - 0.02);
        car.add(nose);
    }
    if (isTail) {
        const tail = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.5, 0.3), rampMat);
        tail.position.set(0, 0.72, -L / 2 + 0.02);
        car.add(tail);
    }
    return car;
}

function makeTrain(L, style, oncoming) {
    const g = new THREE.Group();
    // 多节编组：按总长拆车厢（2–4 节），节越少单节越长
    const cars = L <= 14 ? 2 : (L <= 24 ? 3 : 4);
    const GAP = 0.55;
    const carLen = (L - GAP * (cars - 1)) / cars;

    const side = style.side.clone();
    side.userData = {};
    side.repeat.set(1, 1);
    side.needsUpdate = true;
    const sideMat = std(0xffffff, { map: side, roughness: 0.46, metalness: 0.24 });

    for (let i = 0; i < cars; i++) {
        const z = -L / 2 + carLen / 2 + i * (carLen + GAP);
        const car = makeTrainCar(style, carLen, sideMat, i === cars - 1, i === 0);
        car.position.z = z;
        g.add(car);
        // 风挡：节间的黑色褶皱罩，车顶读起来是连续的
        if (i < cars - 1) {
            const bel = new THREE.Mesh(new THREE.BoxGeometry(1.86, 2.16, GAP + 0.24), darkMat);
            bel.position.set(0, CAR_Y0 + 1.12, z + carLen / 2 + GAP / 2);
            g.add(bel);
        }
    }

    // 受电弓：动车顶上那一副折叠臂（湖景区是电气化铁路，没有它反而假）
    if (!oncoming) {
        const pz = -L / 2 + carLen * 0.5;
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.7), roofMat);
        base.position.set(0, CAR_Y0 + CAR_H + 0.12, pz);
        g.add(base);
        for (const sgn of [-1, 1]) {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 0.08), poleMat);
            arm.position.set(sgn * 0.28, CAR_Y0 + CAR_H + 0.66, pz + sgn * 0.22);
            arm.rotation.x = sgn * 0.34;
            g.add(arm);
        }
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.1), poleMat);
        bar.position.set(0, CAR_Y0 + CAR_H + 1.2, pz);
        g.add(bar);
    }

    if (oncoming) {
        const zf = L / 2;
        for (const x of [-0.62, 0.62]) {
            const light = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.06), headlightMat);
            light.position.set(x, 1.05, zf + 0.02);
            g.add(light);
            const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), headGlowMat);
            glow.position.set(x, 1.05, zf + 0.14);
            g.add(glow);
        }
        // 前照灯投出的锥形光柱（开口朝 +z，越远越散）
        const beam = new THREE.Mesh(new THREE.ConeGeometry(1.9, 12, 12, 1, true), headBeamMat);
        beam.rotation.x = -Math.PI / 2;
        beam.position.set(0, 1.05, zf + 6.0);
        g.add(beam);
    }
    return g;
}
// 前照灯：材质自发光拉高 + 加色光晕面片 + 锥形光柱，隧道里一眼就能看见
const headlightMat = shared(std(0xfffbe6, { emissive: 0xfff3b0, emissiveIntensity: 5.2 }));
const headGlowTex = makeTex(64, 64, (c, w, h) => {
    const grd = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,246,205,0.55)');
    grd.addColorStop(0.62, 'rgba(255,232,160,0.16)');
    grd.addColorStop(1, 'rgba(255,225,150,0)');
    c.fillStyle = grd; c.fillRect(0, 0, w, h);
});
const headGlowMat = shared(new THREE.MeshBasicMaterial({
    map: headGlowTex, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
}));
const headBeamMat = shared(new THREE.MeshBasicMaterial({
    // 双面叠加会把两层壁糊成一张灰片，只留正面、再压低透明度，读起来才像光而不是雾墙
    color: 0xfff4c8, transparent: true, opacity: 0.045,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.FrontSide,
}));


const rampGeo = shared((() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(RAMP_LEN, 0); s.lineTo(RAMP_LEN, TRAIN_H); s.lineTo(0, 0);
    return new THREE.ExtrudeGeometry(s, { depth: 2.0, bevelEnabled: false });
})());
function makeRamp() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(rampGeo, rampMat);
    m.rotation.y = Math.PI / 2;           // 形状的 x 轴 → 世界 -Z（越远越高）
    m.position.set(-1.0, 0, RAMP_LEN / 2);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return g;
}

const barMats = {
    red: shared(std(0xffffff, { map: stripes('#e53935', '#ffffff') })),
    yellow: shared(std(0xffffff, { map: stripes('#ffc107', '#222222') })),
    post: shared(std(0x777d85, { metalness: 0.5, roughness: 0.5 })),
};
const barGeos = {
    lowBoard: shared(new THREE.BoxGeometry(2.1, 0.42, 0.12)),
    lowLeg: shared(new THREE.BoxGeometry(0.1, 0.85, 0.1)),
    foot: shared(new THREE.BoxGeometry(0.14, 0.06, 0.5)),
    highBoard: shared(new THREE.BoxGeometry(2.2, 1.15, 0.16)),
    highPost: shared(new THREE.BoxGeometry(0.14, 2.6, 0.14)),
};
function part(g, geo, mat, x, y, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
}
function makeLowBar() {
    const g = new THREE.Group();
    part(g, barGeos.lowBoard, barMats.red, 0, 0.78);
    for (const x of [-0.9, 0.9]) { part(g, barGeos.lowLeg, barMats.post, x, 0.42); part(g, barGeos.foot, barMats.post, x, 0.03); }
    return g;
}
function makeHighBar() {
    const g = new THREE.Group();
    part(g, barGeos.highBoard, barMats.yellow, 0, 1.95);
    for (const x of [-1.12, 1.12]) part(g, barGeos.highPost, barMats.post, x, 1.3);
    return g;
}

// ---- 城市障碍：公交车 / 货车 / 小汽车（车顶弹跳）/ 脚手架 / 锥桶 ----
const glassDarkMat = shared(std(0x18222e, { roughness: 0.15, metalness: 0.6 }));
const routeSignMat = shared(new THREE.MeshBasicMaterial({ color: 0xffd84a }));
const tireMat = shared(std(0x16181c, { roughness: 0.9 }));
const tireGeo = shared(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14).rotateZ(Math.PI / 2));

function addWheels(g, xs, z, r = 0.42) {
    for (const x of xs) for (const zz of z) {
        const w = new THREE.Mesh(tireGeo, tireMat);
        w.scale.setScalar(r / 0.42);
        w.position.set(x, r, zz);
        g.add(w);
    }
}

function makeBus(L, color = 0x3d8fd1) {
    const g = new THREE.Group();
    const bodyMat = std(color, { roughness: 0.4, metalness: 0.15 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.9, L), bodyMat);
    body.position.y = 1.5;
    body.castShadow = body.receiveShadow = true;
    const winBand = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.75, L - 0.8), glassDarkMat);
    winBand.position.y = 2.05;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, L - 0.5), roofMat);
    roof.position.y = 2.7;
    roof.castShadow = true;
    const ac = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, L * 0.4), roofMat);
    ac.position.set(0, 3.03, -L * 0.1);
    // 车头：挡风玻璃 + 线路牌
    const shield = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.08), glassDarkMat);
    shield.position.set(0, 1.95, L / 2 + 0.02);
    const route = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 0.06), routeSignMat);
    route.position.set(0, 2.62, L / 2 + 0.04);
    g.add(body, winBand, roof, ac, shield, route);
    addWheels(g, [-1.05, 1.05], [L / 2 - 1.2, -L / 2 + 1.2]);
    return g;
}

function makeTruck(L, color = 0xe8eaee) {
    const g = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.0, 2.1), std(0xd23c2e, { roughness: 0.4, metalness: 0.2 }));
    cab.position.set(0, 1.55, L / 2 - 1.05);
    cab.castShadow = true;
    const shield = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 0.08), glassDarkMat);
    shield.position.set(0, 1.85, L / 2 + 0.02);
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.55, 2.6, L - 2.3), std(color, { roughness: 0.6 }));
    cargo.position.set(0, 2.0, -1.15);
    cargo.castShadow = cargo.receiveShadow = true;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.57, 0.35, L - 2.3), std(0x1e88e5, { roughness: 0.5 }));
    stripe.position.set(0, 1.35, -1.15);
    g.add(cab, shield, cargo, stripe);
    addWheels(g, [-1.05, 1.05], [L / 2 - 1.0, -L / 2 + 1.0, -L / 2 + 2.6]);
    return g;
}

// 小汽车：可站立车顶 h=1.45，城市特色「车顶弹跳」；oncoming=迎面驶来（亮前灯，用于行驶障碍）
function makeCar(color = 0xd23c2e, oncoming = false) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.62, 4.2), std(color, { roughness: 0.3, metalness: 0.4 }));
    body.position.y = 0.62;
    body.castShadow = body.receiveShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.0), glassDarkMat);
    cabin.position.set(0, 1.17, -0.2);
    cabin.castShadow = true;
    g.add(body, cabin);
    addWheels(g, [-0.8, 0.8], [1.45, -1.45], 0.3);
    if (oncoming) {
        for (const x of [-0.55, 0.55]) {
            const light = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.06), headlightMat);
            light.position.set(x, 0.72, 2.12);
            g.add(light);
        }
    }
    return g;
}

// 施工脚手架：绿色安全网从顶部垂下，需翻滚钻过（h0=1.30）
const scaffoldMat = shared(std(0xd8b73a, { metalness: 0.5, roughness: 0.5 }));
const netMat = shared(std(0x3f8f4e, { roughness: 0.9, transparent: true, opacity: 0.78, side: THREE.DoubleSide }));
const scafPostGeo = shared(new THREE.BoxGeometry(0.09, 2.6, 0.09));
const scafBeamGeo = shared(new THREE.BoxGeometry(2.2, 0.08, 0.08));
function makeScaffold() {
    const g = new THREE.Group();
    for (const x of [-1.05, 1.05]) for (const z of [-0.35, 0.35])
        part(g, scafPostGeo, scaffoldMat, x, 1.3, z);
    part(g, scafBeamGeo, scaffoldMat, 0, 2.56, -0.35);
    part(g, scafBeamGeo, scaffoldMat, 0, 2.56, 0.35);
    const net = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 0.05), netMat);
    net.position.set(0, 1.95, 0);
    net.castShadow = true;
    g.add(net);
    return g;
}

// 交通锥桶阵：三只一排，跳过（h=0.85）
const coneMat = shared(std(0xf06423, { roughness: 0.6 }));
const coneStripeMat = shared(std(0xffffff, { roughness: 0.5 }));
const coneGeo = shared(new THREE.ConeGeometry(0.28, 0.85, 12));
const coneBaseGeo = shared(new THREE.BoxGeometry(0.42, 0.05, 0.42));
function makeCone() {
    const g = new THREE.Group();
    for (const x of [-0.75, 0, 0.75]) {
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.set(x, 0.45, 0);
        cone.castShadow = true;
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.12, 10), coneStripeMat);
        stripe.position.set(x, 0.48, 0);
        const base = new THREE.Mesh(coneBaseGeo, coneMat);
        base.position.set(x, 0.025, 0);
        g.add(cone, stripe, base);
    }
    return g;
}

// ---- 校园障碍：校车（可站车顶）/ 自行车（横移·跳）/ 横幅（钻）/ 跨栏（跳）----
// 校车：经典黄色 + 黑色腰线 + 红色停车牌
const schoolBusMat = std(0xf7b500, { roughness: 0.45, metalness: 0.15 });
const stopSignMat = shared(new THREE.MeshBasicMaterial({ color: 0xe53935 }));
function makeSchoolBus(L) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.9, L), schoolBusMat);
    body.position.y = 1.5;
    body.castShadow = body.receiveShadow = true;
    const winBand = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.7, L - 0.8), glassDarkMat);
    winBand.position.y = 2.1;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.22, L - 0.4), darkMat);
    stripe.position.y = 1.35;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.45, L - 0.5), std(0xf7b500, { roughness: 0.5 }));
    roof.position.y = 2.67;
    roof.castShadow = true;
    const shield = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.85, 0.08), glassDarkMat);
    shield.position.set(0, 1.95, L / 2 + 0.02);
    const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 8).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), stopSignMat);
    sign.position.set(1.32, 1.75, L / 2 - 1.6);
    g.add(body, winBand, stripe, roof, shield, sign);
    addWheels(g, [-1.05, 1.05], [L / 2 - 1.2, -L / 2 + 1.2]);
    return g;
}

// 自行车：装饰（车棚）与障碍（倒地横在车道上）共用
const bikeWheelGeo = shared(new THREE.TorusGeometry(0.33, 0.045, 8, 18));
const bikeFrameMat = shared(std(0x2a2f36, { metalness: 0.6, roughness: 0.4 }));
function makeBike(color = 0x2e6fd2) {
    const g = new THREE.Group();
    const frameMat = std(color, { metalness: 0.5, roughness: 0.35 });
    for (const z of [-0.52, 0.52]) {
        const w = new THREE.Mesh(bikeWheelGeo, bikeFrameMat);
        w.position.set(0, 0.33, z);
        w.castShadow = true;
        g.add(w);
    }
    // 车架：斜梁 + 立管 + 前叉
    const tube = (x1, y1, z1, x2, y2, z2, r = 0.035) => {
        const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
        const len = Math.hypot(dx, dy, dz);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), frameMat);
        m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
        m.lookAt(new THREE.Vector3(x2 - x1, y2 - y1, z2 - z1).add(m.position));
        m.rotateX(Math.PI / 2);
        g.add(m);
    };
    tube(0, 0.33, 0.52, 0, 0.62, 0.30);          // 前叉
    tube(0, 0.33, -0.52, 0, 0.58, -0.28);        // 后叉
    tube(0, 0.62, 0.30, 0, 0.58, -0.28);         // 上管
    tube(0, 0.33, 0.0, 0, 0.58, -0.28);          // 立管下段
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 6).rotateZ(Math.PI / 2), frameMat);
    bar.position.set(0, 0.78, 0.34);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6), frameMat);
    stem.position.set(0, 0.70, 0.33);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.28), bikeFrameMat);
    seat.position.set(0, 0.66, -0.30);
    g.add(bar, stem, seat);
    return g;
}
// 障碍版：两辆并排横在车道上（跳过，带轻微横移）
// 尺寸对齐：OBSTACLE_DEFS.bike.h1 = 1.0 是判定用的净空高度，而模型原生只有 0.82m
// （车把 0.78 + 管径），视觉比判定矮 0.18m —— 玩家看着车把已经在脚下、判定却还算撞上。
// 这里把模型整体放大到 1.0m（真实自行车车把本来就在 1.0m 上下，放大不违和），
// 再抬 0.05m 抵掉 rotation.z 造成的 4cm 陷地，让「看到的」和「判定的」一致。
const BIKE_OBSTACLE_SCALE = 1.22;   // 0.82 → 1.00
function makeBikeObstacle() {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    for (const x of [-0.5, 0.5]) {
        const b = makeBike(pick([0x2e6fd2, 0xd23c2e, 0x3aa655, 0xe0942e]));
        b.position.set(x, 0, rand(-0.2, 0.2));
        b.rotation.y = Math.PI / 2 + rand(-0.2, 0.2);   // 横放拦住车道
        b.rotation.z = rand(-0.12, 0.12);
        inner.add(b);
    }
    inner.scale.setScalar(BIKE_OBSTACLE_SCALE);
    inner.position.y = 0.05;
    g.add(inner);
    return g;
}

// 行驶自行车（校园·行驶障碍）：一辆正向骑来的自行车，亮着车前灯（区别于横放静止的自行车阵）
function makeBikeRider() {
    const g = new THREE.Group();
    const b = makeBike(pick([0x2e6fd2, 0xd23c2e, 0x3aa655, 0xe0942e]));
    g.add(b);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), headlightMat);
    lamp.position.set(0, 0.82, 0.44);
    g.add(lamp);
    return g;
}

// 横幅：两根立柱 + 红色欢迎横幅（翻滚钻过，h0=1.15）
const bannerTex = shared(makeTex(256, 48, (c, w, h) => {
    c.fillStyle = '#c62828'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffd84a'; c.font = 'bold 26px sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('欢迎新同学', w / 2, h / 2);
}));
function makeBanner() {
    const g = new THREE.Group();
    for (const x of [-1.15, 1.15]) part(g, barGeos.highPost, barMats.post, x, 1.3);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.9, 0.06), std(0xffffff, { map: bannerTex, roughness: 0.8 }));
    banner.position.y = 1.85;                        // 底边 1.4 / 顶边 2.3
    banner.castShadow = true;
    g.add(banner);
    for (const x of [-1.15, 1.15]) part(g, barGeos.foot, barMats.post, x, 0.03);
    return g;
}

// 跨栏：田径栏架（跳过，h=0.95）
const hurdleMat = shared(std(0xf0f2f5, { roughness: 0.4 }));
const hurdleStripeTex = shared(makeTex(64, 32, (c, w, h) => {
    c.fillStyle = '#f0f2f5'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1e88e5';
    for (let i = 0; i < 4; i++) c.fillRect(i * 16 + 4, 0, 8, h);
}));
function makeHurdle() {
    const g = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, 0.08), std(0xffffff, { map: hurdleStripeTex, roughness: 0.5 }));
    board.position.y = 0.8;
    board.castShadow = true;
    g.add(board);
    for (const x of [-0.85, 0.85]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 0.08), hurdleMat);
        leg.position.set(x, 0.475, 0);
        g.add(leg);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.6), hurdleMat);
        foot.position.set(x, 0.025, 0);
        g.add(foot);
    }
    return g;
}

const coinGeo = shared(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 20).rotateX(Math.PI / 2));
const coinMat = shared(std(0xffc93c, { metalness: 0.7, roughness: 0.25, emissive: 0x6a4a00 }));

function starShape(R, r) {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R;
        i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    return s;
}
// [PKVS] 干扰道具的 emoji 贴图。只有 4 张，缓存住别每个道具都新建一一遍
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
    const def = CONFIG.powerUps[type];
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14),
        new THREE.MeshStandardMaterial({ color: type === 'wings' ? 0xffe9a8 : def.color, transparent: true, opacity: 0.28, emissive: def.color, emissiveIntensity: 0.4, depthWrite: false })));
    const icon = new THREE.Group();
    if (type === 'magnet') {
        const u = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.08, 8, 20, Math.PI), std(def.color));
        u.rotation.z = Math.PI;
        icon.add(u);
        for (const x of [-0.22, 0.22]) {
            const tip = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.17), std(0xdddddd, { metalness: 0.8, roughness: 0.2 }));
            tip.position.set(x, 0.06, 0);
            icon.add(tip);
        }
    } else if (type === 'sneakers') {
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.2), std(def.color));
        const sole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.22), std(0xffffff));
        sole.position.y = -0.12;
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.2), std(def.color));
        top.position.set(-0.12, 0.17, 0);
        icon.add(shoe, sole, top);
    } else if (type === 'double') {
        const geo = new THREE.ExtrudeGeometry(starShape(0.3, 0.13), { depth: 0.1, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
        geo.center();
        icon.add(new THREE.Mesh(geo, std(0xffd84a, { metalness: 0.6, roughness: 0.3, emissive: def.color, emissiveIntensity: 0.4 })));
    } else if (type === 'wings') {
        for (const side of [1, -1]) {
            const w = makeWing(wingMat);
            w.scale.set(side * 0.3, 0.3, 0.3);
            w.position.y = -0.08;
            icon.add(w);
        }
        const h = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 16), std(0xffe27a, { emissive: 0xffd040, emissiveIntensity: 1 }));
        h.rotation.x = Math.PI / 2;
        h.position.y = 0.25;
        icon.add(h);
    } else if (type === 'pk_box') {
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
    g.add(icon);
    g.userData.icon = icon;
    return g;
}

// ---------- 复活币：比普通道具更大更亮，远处先看见一团粉光 ----------
const reviveGlowTex = makeTex(64, 64, (c, w, h) => {
    const grd = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,198,224,0.55)');
    grd.addColorStop(0.26, 'rgba(255,126,182,0.4)');
    grd.addColorStop(0.58, 'rgba(255,80,150,0.13)');
    grd.addColorStop(1, 'rgba(255,60,130,0)');
    c.fillStyle = grd; c.fillRect(0, 0, w, h);
});
const reviveGlowMat = shared(new THREE.MeshBasicMaterial({
    map: reviveGlowTex, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
}));
const revivePoolMat = shared(new THREE.MeshBasicMaterial({
    map: reviveGlowTex, transparent: true, opacity: 0.34,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
}));
const reviveCoinGeo = shared(new THREE.CylinderGeometry(0.78, 0.78, 0.16, 32).rotateX(Math.PI / 2));
const reviveGoldMat = shared(new THREE.MeshStandardMaterial({
    // 自发光用暖金：用粉色会把整枚币染成粉团，红心就看不见了
    color: 0xffc93c, metalness: 0.7, roughness: 0.24, emissive: 0xffab24, emissiveIntensity: 0.5,
}));
const reviveHeartMat = shared(new THREE.MeshStandardMaterial({
    color: 0xff2f6d, emissive: 0xff3f78, emissiveIntensity: 1.2, roughness: 0.4, metalness: 0.0,
}));
const reviveRingMat = shared(new THREE.MeshBasicMaterial({
    color: 0xff7ab5, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
}));
const reviveBeamMat = shared(new THREE.MeshBasicMaterial({
    color: 0xff6aa6, transparent: true, opacity: 0.07,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
}));
const reviveRingGeo = shared(new THREE.TorusGeometry(1.08, 0.06, 8, 44));
const reviveRing2Geo = shared(new THREE.TorusGeometry(1.34, 0.028, 6, 44));
const reviveBeamGeo = shared(new THREE.CylinderGeometry(0.58, 0.58, 12, 16, 1, true));

// 心形图案（币面上的徽记）
function makeHeartGeo(size) {
    const sh = new THREE.Shape();
    sh.moveTo(0, -0.28 * size);
    sh.bezierCurveTo(0.46 * size, 0.04 * size, 0.32 * size, 0.40 * size, 0, 0.17 * size);
    sh.bezierCurveTo(-0.32 * size, 0.40 * size, -0.46 * size, 0.04 * size, 0, -0.28 * size);
    const g = new THREE.ExtrudeGeometry(sh, {
        depth: 0.08, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.018, bevelSegments: 1,
    });
    g.center();
    return shared(g);
}
const reviveHeartGeo = makeHeartGeo(1.35);

function makeReviveMesh() {
    const g = new THREE.Group();
    const spin = new THREE.Group();                 // pickup 循环每帧转这个
    spin.add(new THREE.Mesh(reviveCoinGeo, reviveGoldMat));
    for (const side of [1, -1]) {                   // 正反两面都刻心，转起来不会突然变空币
        const h = new THREE.Mesh(reviveHeartGeo, reviveHeartMat);
        h.position.z = side * 0.11;
        if (side < 0) h.rotation.y = Math.PI;
        spin.add(h);
    }
    const ring = new THREE.Mesh(reviveRingGeo, reviveRingMat);
    const ring2 = new THREE.Mesh(reviveRing2Geo, reviveRingMat);
    ring2.rotation.x = Math.PI / 2;                 // 一圈竖着、一圈横着，形成立体光晕
    // 正对镜头的柔光：60 米外也能一眼认出这是个特殊道具（不参与自转）
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), reviveGlowMat);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), revivePoolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = -1.42;                        // 币心 1.55 → 地面光斑
    const beam = new THREE.Mesh(reviveBeamGeo, reviveBeamMat);
    beam.position.y = 4.4;
    g.add(pool, beam, halo, ring, ring2, spin);
    g.userData.icon = spin;
    g.userData.halo = halo;
    g.userData.ring = ring;
    return g;
}

// =====================================================================
//  ⑩ 游戏状态
// =====================================================================
const obstacles = [], coins = [], pickups = [];
let best = 0;
try { best = +localStorage.getItem('parkour3d_best') || 0; } catch (e) {}

const S = { state: 'menu', paused: false, power: {} };

function resetState() {
    clearGrandLisboa();                 // 重开一局时把上一局尾声的路标清掉
    if (FINISH.active) finishCam.skip();   // 过场中重开：走平滑切出，endFinishFanfare 只还原相机
    for (const o of obstacles) disposeObj(o.mesh);
    for (const c of coins) scene.remove(c.mesh);
    for (const p of pickups) disposeObj(p.mesh);
    obstacles.length = coins.length = pickups.length = 0;
    Object.assign(S, {
        D: 0, speed: CONFIG.speed.start, coins: 0, score: 0,
        lane: 1, prevLane: 1, x: 0, y: 0, vy: 0, grounded: true, rolling: 0,
        phase: 0, stumbleCool: 0, flying: false, landGrace: 0, chaserTimer: 5, chaserDist: 2.2, dieT: 0, overShown: false, transGrace: 0,
        nextRowS: 45, nextPowerS: 500, safeLane: 1, lastMovingS: -1000,
        // 复活币：reviveBase = 本轮周期起点，nextReviveS = 下一个待判定的刻度
        revives: 0, reviveBase: 0, nextReviveS: REVIVE_CFG.step,
        reviveSpawned: 0, reviveUsed: 0, lastDeathCause: '', diedTurnAt: null,
        laneFree: [0, 0, 0], laneSafeUntil: [0, 0, 0],
        // 动画 / 输入 / 飞行器新增状态
        anticip: 0, vx: 0, prevX: 0, holdUp: false, holdDown: false, climbPulse: 0, airJumps: 0,
        flight: createFlight(), menuT: 0,
        pillar: newPillarState(0),
        wallPass: null, topSpeedShown: false,   // 护盾挡过的楼 / 极速提示只弹一次
    });
    Object.assign(ANIM, createAnim());
    Object.assign(CHASER_ANIM, createAnim());
    for (const k in CONFIG.powerUps) S.power[k] = 0;
    player.root.rotation.set(0, 0, 0);
    chaser.root.rotation.set(0, 0, 0);          // 死亡时 poseFall 会把保安推倒，重开要回正
    if (typeof chaserModel !== 'undefined') chaserModel.rotation.set(0, 0, 0);
    chaser.yaw = null;                          // 重开后重新对准玩家
    if (player.shoeMat) player.shoeMat.color.setHex(player.baseShoe);
    wingGrow = 0;
    for (const w of wings) w.mount.visible = false;
    halo.visible = false;
}

// =====================================================================
//  ⑪ 关卡生成
//   用"轨道坐标 s"来规划：s 越大越远。物体世界坐标 z = D - s。
//   始终保留一条"安全道"不放火车，保证每一段都有路可走。
// =====================================================================
const zOf = s => S.D - s;

// 障碍注册表与场景障碍集已前移至 GAME-DATA 段（纯数据，Node 测试共用）

function addObstacle(type, lane, sFront, len, mesh, extra = 0) {
    const def = OBSTACLE_DEFS[type] || {};
    const o = {
        type, lane, len, mesh, extra, def,
        x: LANES[lane], z: zOf(sFront + len / 2),
        hw: def.hw != null ? def.hw : 1.1,
        h0: def.h0 || 0,
        h1: def.h1 || 0,
        ride: !!def.ride,
        deadly: !!def.deadly,          // 支撑柱：撞上必死（见 pillarCrash）
        bounce: def.bounce || 0,
        wobble: def.wobble || 0,
        baseX: LANES[lane],
    };
    placeOnTrack(mesh, o.x, 0, o.z);
    scene.add(mesh);
    obstacles.push(o);
    return o;
}

function addCoin(lane, s, y) {
    const mesh = new THREE.Mesh(coinGeo, coinMat);
    mesh.castShadow = true;
    const c = { x: LANES[lane], y, z: zOf(s), mesh, magnet: false };
    placeOnTrack(mesh, c.x, y, c.z);
    scene.add(mesh);
    coins.push(c);
}
function placeCoinLine(lane, s, n, y) {
    for (let i = 0; i < n; i++) addCoin(lane, s + i * 2.5, y);
    S.laneFree[lane] = Math.max(S.laneFree[lane], s + n * 2.5 + 2);
}

function placeTrain(lane, s, withRamp, oncoming) {
    let front = s;
    if (withRamp) {
        addObstacle('ramp', lane, front, RAMP_LEN, makeRamp());
        front += RAMP_LEN;
    }
    const L = oncoming ? 18 : pick([12, 18, 24, 30]);
    const t = addObstacle('train', lane, front, L, makeTrain(L, pick(TRAIN_STYLES), oncoming), oncoming ? S.speed * 0.42 : 0);
    if (oncoming) {
        t.moving = true;      // 迎面火车是「行驶障碍」：撞击即失败
        t.extraRate = 0.42;   // 额外速度 = 当前跑速 × 0.42（玩家越快，迎面火车也越快）
    }
    if (withRamp) placeCoinLine(lane, front + 2, Math.floor((L - 4) / 2.5), TRAIN_H + 1.0);
    S.laneFree[lane] = Math.max(S.laneFree[lane], front + L + (oncoming ? 40 : 8));
}

// 可骑乘车辆建模分发（按场景类型）
function buildVehicleMesh(type, L) {
    switch (type) {
        case 'train': return makeTrain(L, pick(TRAIN_STYLES), false);
        case 'bus': return makeBus(L, pick([0x3d8fd1, 0x3aa655, 0xe0942e]));
        case 'truck': return makeTruck(L, pick([0xe8eaee, 0xd8dee6, 0xb9c4d0]));
        case 'schoolbus': return makeSchoolBus(L);
        case 'car': return makeCar(pick(CAR_COLORS));
    }
}
// 杆类障碍建模分发（跳 / 钻）
function buildBarMesh(type) {
    switch (type) {
        case 'lowBar': return makeLowBar();
        case 'highBar': return makeHighBar();
        case 'scaffold': return makeScaffold();
        case 'cone': return makeCone();
        case 'bike': return makeBikeObstacle();
        case 'banner': return makeBanner();
        case 'hurdle': return makeHurdle();
    }
}
// 当前场景的可骑乘 / 杆类障碍类型
const sceneRideTypes = () => SCENE_OBSTACLES[Scene.id].filter(t => OBSTACLE_DEFS[t].ride);
// 支撑柱由柱阵生成器专门摆放，不能混进普通栏杆池
const sceneBarTypes = () => SCENE_OBSTACLES[Scene.id].filter(t =>
    !OBSTACLE_DEFS[t].ride && !OBSTACLE_DEFS[t].deadly && t !== 'ramp');

// 放置一辆当前场景的可骑乘车辆（火车走 placeTrain 保留车厢质感；小汽车矮、直接跳上车顶，不配坡道）
function placeRide(lane, s, withRamp) {
    const type = pick(sceneRideTypes());
    if (type === 'train') { placeTrain(lane, s, withRamp, false); return; }
    let front = s;
    const useRamp = withRamp && type !== 'car';
    if (useRamp) {
        addObstacle('ramp', lane, front, RAMP_LEN, makeRamp());
        front += RAMP_LEN;
    }
    // 车长按车型给：原来所有车都从 [12,18,24,30] 里抽，抽到 30m 的校车在弯道上
    // 会像一堵斜着的黄墙横在两车道之间（这也是「车会自己乱动」的观感来源）
    const VEH_LEN = { car: 4.2, schoolbus: 11.0, bus: 12.0, truck: 15.0 };
    const L = VEH_LEN[type] || 12.0;
    addObstacle(type, lane, front, L, buildVehicleMesh(type, L));
    if (useRamp) placeCoinLine(lane, front + 2, Math.floor((L - 4) / 2.5), OBSTACLE_DEFS[type].h1 + 1.0);
    S.laneFree[lane] = Math.max(S.laneFree[lane], front + L + 8);
}

// 放置当前场景的杆类障碍（跳过 / 钻过），并配金币引导
function placeBarrier(lane, s) {
    const type = pick(sceneBarTypes());
    const def = OBSTACLE_DEFS[type];
    const duck = (def.h0 || 0) > 0.5;      // 需要翻滚钻过
    addObstacle(type, lane, s, 0.6, buildBarMesh(type));
    if (!duck && Math.random() < 0.45) {
        for (let i = 0; i < 5; i++) addCoin(lane, s - 5 + i * 2.5, 0.9 + 1.5 * Math.sin(Math.PI * i / 4));
    } else if (duck && Math.random() < 0.35) {
        for (let i = 0; i < 3; i++) addCoin(lane, s - 2.5 + i * 2.5, 0.6);
    }
    S.laneFree[lane] = Math.max(S.laneFree[lane], s + 6);
}

function placePickup(lane, s, type) {
    const revive = type === 'revive';
    const mesh = revive ? makeReviveMesh() : makePowerMesh(type);
    const p = { type, x: LANES[lane], y: revive ? 1.55 : 1.2, z: zOf(s), mesh };
    placeOnTrack(mesh, p.x, p.y, p.z);
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
}

// 行驶障碍（每个地图一种，见 MOVING_OBSTACLE）：迎着主角开，撞上直接失败
// 铁路场景走迎面火车（带灯、可 40m 缓冲）；城市=逆行小汽车 / 校园=逆行自行车（亮前灯）
function placeMoving(lane, s) {
    const type = MOVING_OBSTACLE[Scene.id];
    if (type === 'train') { placeTrain(lane, s, false, true); return; }
    const L = type === 'car' ? 4.2 : 1.7;
    const mesh = type === 'car' ? makeCar(pick(CAR_COLORS), true) : makeBikeRider();
    const o = addObstacle(type, lane, s, L, mesh, S.speed * 0.45);
    o.moving = true;
    o.extraRate = 0.45;    // 同上：相对速度随玩家跑速增长
    o.wobble = 0;   // 迎面自行车直线冲过来，不叠加横移（保证躲得开）
    // 车更快 → 留给玩家的换道净空也要同步放大
    S.laneFree[lane] = Math.max(S.laneFree[lane], s + L + 40 * topMovingMul());
}

// =====================================================================
//  隧道·支撑柱阵
//  一柱一柱沿轨道排开 → 一整段柱子就是中间道的禁区；段与段之间留 20~28 米空隙，
//  玩家可以借这点空隙横切到另一条道，但没法在中间道上跑起来。
//  柱阵存在期间只剩左右两条道可跑，并且必须有一辆（且只有一辆）迎面火车。
// =====================================================================
// 隧道里太阳是关掉的，不给一点自发光的话柱子会糊成一团黑
const pillarMateMat = shared(std(0xc8c2b6, { roughness: 0.9, emissive: 0x241f18, emissiveIntensity: 0.55 }));
const pillarWarnMat = shared(new THREE.MeshBasicMaterial({ color: 0xffb020 }));
const pillarGeoCache = new Map();

// 一段柱子的几何体（按立柱根数缓存）：结构件合并成 1~2 个 mesh，别把 drawcall 打爆
function pillarBlockParts(cols) {
    if (pillarGeoCache.has(cols)) return pillarGeoCache.get(cols);
    const len = (cols - 1) * PILLAR_STEP;
    const solid = [], bands = [];
    for (let i = 0; i < cols; i++) {
        const z = -len / 2 + i * PILLAR_STEP;
        solid.push(new THREE.CylinderGeometry(0.58, 0.72, 7.5, 10).translate(0, 3.75, z));
        solid.push(new THREE.BoxGeometry(1.7, 0.46, 1.7).translate(0, 0.23, z));
        solid.push(new THREE.BoxGeometry(1.55, 0.4, 1.55).translate(0, 7.28, z));
        bands.push(new THREE.CylinderGeometry(0.79, 0.79, 0.3, 10).translate(0, 1.35, z));
        bands.push(new THREE.CylinderGeometry(0.72, 0.72, 0.22, 10).translate(0, 3.4, z));
    }
    solid.push(new THREE.BoxGeometry(1.9, 0.55, len + 1.4).translate(0, 7.5, 0));   // 顶部横梁
    let parts = null;
    if (mergeGeometries) {
        const a = mergeGeometries(solid, false), b = mergeGeometries(bands, false);
        if (a && b) {
            a.userData.shared = true; b.userData.shared = true;
            parts = [{ geo: a, mat: pillarMateMat }, { geo: b, mat: pillarWarnMat }];
            for (const q of solid) q.dispose();
            for (const q of bands) q.dispose();
        }
    }
    if (!parts) {                                  // 降级：合并不了就直接一坨一坨挂
        for (const q of solid) q.userData.shared = true;
        for (const q of bands) q.userData.shared = true;
        parts = solid.map(q => ({ geo: q, mat: pillarMateMat }))
            .concat(bands.map(q => ({ geo: q, mat: pillarWarnMat })));
    }
    pillarGeoCache.set(cols, parts);
    return parts;
}

function makePillar(len) {
    const cols = clamp(Math.round(len / PILLAR_STEP) + 1, 2, 12);
    const g = new THREE.Group();
    for (const p of pillarBlockParts(cols)) {
        const m = new THREE.Mesh(p.geo, p.mat);
        m.castShadow = true;
        g.add(m);
    }
    return g;
}

function newPillarState(baseD) {
    return {
        active: false,
        nextAt: (baseD || 0) + PILLAR_CFG.firstAfter,
        endS: 0, cursor: 0, cols: 6,
        pendingTrain: false, trainS: 0, trainLane: 1, sections: 0,
    };
}

// 返回 true = 本行属于柱阵区，已经单独处理（中间道整段封闭）
function pillarRow(s) {
    const P = S.pillar;
    if (!P) return false;
    if (!P.active) {
        if (s < P.nextAt) return false;
        // 柱阵必须落在隧道段里，且在洞口前收尾（见隧道块 tunnelAllowsPillar）
        if (!tunnelAllowsPillar(s)) return false;
        // 起阵前三条道都要干净：否则玩家一进柱阵就被「中间封死 + 旁边有车」夹死
        if (S.laneFree[0] > s - 26 || S.laneFree[1] > s - 26 || S.laneFree[2] > s - 26) return false;
        if (obstacles.some(o => o.moving)) return false;   // 迎面车还在场上，等它过去再起阵
        P.active = true;
        P.sections++;
        P.endS = Math.min(s + randRange(PILLAR_CFG.span[0], PILLAR_CFG.span[1]), tunnelExitAt(s) - 12);
        P.cursor = s;
        P.trainLane = pick([0, 2]);                    // 只会在仅剩的左右两条道上
        P.trainS = s + randRange(PILLAR_CFG.trainLead[0], PILLAR_CFG.trainLead[1]);
        P.pendingTrain = true;
        S.laneFree[1] = P.endS;                        // 整段中间道不再给别的生成器用
    }
    // 一根一根铺柱段：段内立柱连续，段间留 gap 作为唯一的横切通道
    while (P.cursor < s + 46 && P.cursor < P.endS) {
        const cols = Math.round(rand(PILLAR_CFG.cols[0], PILLAR_CFG.cols[1]));
        const len = (cols - 1) * PILLAR_STEP;
        addObstacle('pillar', 1, P.cursor, len, makePillar(len));
        P.cursor += len + randRange(PILLAR_CFG.gap[0], PILLAR_CFG.gap[1]);
    }
    // 柱阵里必须有那辆迎面火车；同一时刻只允许一辆
    if (P.pendingTrain && s >= P.trainS && !obstacles.some(o => o.moving)) {
        placeMoving(P.trainLane, s + 14);
        S.lastMovingS = s;
        P.pendingTrain = false;
    }
    // 两侧金币引导（中间道是禁区，不给金币）
    if (Math.random() < 0.55) placeCoinLine(pick([0, 2]), s + 4, 4, 1.0);
    if (P.cursor >= P.endS && s > P.endS + 10) {
        P.active = false;
        P.nextAt = P.endS + PILLAR_CFG.cooldown;
        return false;
    }
    return true;
}

function spawnRow(s) {
    spawnReviveIfDue(s);            // 复活币的里程概率（与障碍生成互不干扰）
    // 校园：路口前后留空——拐弯本身就要打方向，弯里再堵一辆校车就是必死局。
    // 判定用 62m 而不是 45m：addObstacle 把「车头」放在 s，车心还要往后加 len/2；
    // 带坡道的校车更狠——坡道 10m + 半个车身 5.5m ≈ 15.5m。留够余量才真能保证 45m 净空。
    const J_CLEAR = 62;
    const isCampus = (curTheme === 'campus' || curTheme === 'campus2') && CAMPUS.ready;
    if (isCampus && campusJunctionGap(CAMPUS.s + (s - S.D)) < J_CLEAR) return;
    // 校园里有几栋楼横在两条车道上（医学部路口最典型）。楼照旧占路，
    // 但「唯一活路」那一段必须完全不刷障碍，否则就是必死局。
    const wallLanes = isCampus ? campusBlockedLanes(s) : [];
    if (wallLanes.length >= 3) return;              // 兜底：三条道全被楼占，整行不刷
    if (wallLanes.length >= 2) {
        const free = [0, 1, 2].filter(l => wallLanes.indexOf(l) < 0);
        S.safeLane = free[0];
        S.laneSafeUntil[S.safeLane] = s;
        return;                                     // 楼有纵深，前后各让出一行
    }
    // 迎面车会一路往回漂（arc 每秒缩 0.45×跑速），所以它的「相遇点」比落点更靠前：
    // 相遇里程 ≈ 玩家里程 + 距离/1.45。相遇点也不能压在路口上。
    // 相遇里程要按「真实相对速度」算：极速阶段迎面车更快，相遇点会更靠前
    const meetArc = CAMPUS.s + (s - S.D) / (1 + 0.45 * topMovingMul());
    const meetNearJ = isCampus && campusJunctionGap(meetArc) < J_CLEAR;
    // 隧道·柱阵区走专用分支：中间道被封，只留左右两条 + 一辆火车
    if (Scene.id === 'tunnel' && pillarRow(s)) return;
    // 楼只占一条道时，安全道也必须避开它
    if (wallLanes.length) {
        const free = [0, 1, 2].filter(l => wallLanes.indexOf(l) < 0);
        if (!free.length) return;
        if (free.indexOf(S.safeLane) < 0) S.safeLane = pick(free);
    }
    // 偶尔把安全道换到相邻且已空出足够距离的车道
    if (Math.random() < 0.35) {
        const cands = [S.safeLane - 1, S.safeLane + 1].filter(l => l >= 0 && l <= 2
            && wallLanes.indexOf(l) < 0 && S.laneFree[l] <= s - 22);
        if (cands.length) S.safeLane = pick(cands);
    }
    S.laneSafeUntil[S.safeLane] = s;

    // 每 500 米一个道具点：25% 概率是护盾，其余从其它道具里随机
    if (s >= S.nextPowerS && S.laneFree[S.safeLane] <= s - 10) {
        // [PKVS] pk_ 是双人对战专属的干扰道具，不能混进单机的道具池
        const type = Math.random() < 0.25 ? 'shield'
            : pick(Object.keys(CONFIG.powerUps).filter(k => k !== 'shield' && k.indexOf('pk_') !== 0));
        placePowerUp(S.safeLane, s - 6, type);
        S.nextPowerS = s + 500;
    }

    // 全模式统一用「里程差」判独占，不再单靠看帧时机的 obstacles.some：
    // 极速阶段车更快、行更密，两辆迎面车一旦错位叠到同一段就是三排封死。
    // 165m 的间隔 + 单帧最多一辆，保证任何时刻至少留两条可走的车道。
    const MOVING_GAP = 110 * (atTopSpeed() ? TOP_OBSTACLE_MUL : 1);
    for (let lane = 0; lane < 3; lane++) {
        if (S.laneFree[lane] > s) continue;
        const r = Math.random();
        if (lane === S.safeLane) {
            if (r < 0.35) placeBarrier(lane, s);
            else if (r < 0.75) placeCoinLine(lane, s + 2, 6, 1.0);
            continue;
        }
    // 行驶障碍：铁路场景=迎面火车，城市=逆行小汽车，校园=逆行自行车
    // 公平性门槛：开局 200m 缓冲；这条道 45m 内没被占用、且 55m 内不当过安全道（保证来得及换道躲开）
    const canMoving = S.D > 200 && S.laneFree[lane] <= s - 45 && S.laneSafeUntil[lane] < s - 55;
    // 保底：超过 260m 没出现行驶障碍且条件允许时必出一辆（否则纯靠概率，玩家一局都可能遇不上）
    const dueMoving = canMoving && s - S.lastMovingS > 260;
    if (r < 0.38) placeRide(lane, s, Math.random() < 0.4);
    // 同一时刻只允许一辆行驶障碍在场上（两辆迎面车同时封死两条道就是必死局）
    // [PKVS] 对局内用「里程差」判独占：obstacles 里还有没有迎面车要看帧时机，
    // 两端会差一帧 → 分支不同 → 后面的随机序列全错开。里程是确定性的。
    else if (canMoving && !meetNearJ && (dueMoving || r < 0.56)
        && s - S.lastMovingS > MOVING_GAP
        && (window.__pkRnd ? true : !obstacles.some(o => o.moving))) { placeMoving(lane, s); S.lastMovingS = s; }
    else if (r < 0.78) placeBarrier(lane, s);
    else if (r < 0.9) placeCoinLine(lane, s + 2, 5, 1.0);
    }
}

// =====================================================================
//  ⑫ 物理 / 碰撞
// =====================================================================
// 玩家脚下的地面高度（地面 / 坡道 / 车顶）；standOb 记录提供支撑面的障碍
let standOb = null;
function surfaceAt(x, y, drop) {
    const r = surfaceHeightAt(obstacles, x, y, TRAIN_H, drop);
    standOb = r.ob;
    return r.g;
}

function checkCollisions(dt) {
    if (S.transGrace > 0) return;   // 转场无敌期
    if (campusWallCrash(dt)) return;   // 校园：撞上教学楼（建筑照旧占路，只补判定）
    const ph = S.rolling > 0 ? 0.8 : 1.75;
    for (const o of obstacles) {
        const xOver = 0.35 + o.hw - Math.abs(S.x - o.x);
        if (xOver <= 0) continue;
        const z0 = o.z - o.len / 2, z1 = o.z + o.len / 2;
        if (Math.min(0.35, z1) - Math.max(-0.35, z0) <= 0) continue;

        if (o.type === 'ramp') {
            // 从侧面撞上坡道。阈值 1.6 > 抬升容差 1.2：
            // 正常跑上坡的人永远满足 S.y >= h - 1.2，不会再被这里接住。
            const h = TRAIN_H * clamp(z1 / o.len, 0, 1);
            if (S.y < h - 1.6 && S.stumbleCool <= 0) stumble();
            continue;
        }
        const top = o.ride ? o.h1 - 0.45 : o.h1;
        if (S.y >= top || S.y + ph <= o.h0) continue;
        // 落在车顶边缘的兜底：正在下落、且脚下就是这辆车的顶面 → 踩上去，不算撞车。
        // （坡道→车顶的衔接处最容易在这里被误判成"撞上了火车"）
        if (o.ride && !o.moving && S.vy < -0.5 && S.y > o.h1 - 1.35 && S.y < o.h1 + 0.02) {
            S.y = o.h1; S.vy = 0; S.grounded = true;
            ANIM.land = Math.max(ANIM.land, ANIM_CFG.landTime * 0.6);
            continue;
        }

        // 刚飞完的落地保护：落进可站立车辆就直接放到车顶，栏杆忽略（行驶障碍与支撑柱不适用）
        if (S.landGrace > 0 && !o.moving && !o.deadly) {
            if (o.ride) { S.y = o.h1; S.vy = 0; S.grounded = true; }
            continue;
        }

        // 行驶障碍：任何接触直接失败（护盾规则见 movingCrash；跳过/钻过/换道躲避仍然有效）
        if (o.moving) return movingCrash(o);
        // 支撑柱：从地面顶到拱顶，跳不过、钻不过、擦一下也是死（护盾按普通撞击规则抵挡一次）
        if (o.deadly) return pillarCrash(o);

        // 障碍物前沿刚刚越过玩家 → 正面撞击；否则是换道时擦到侧面
        const frontal = z1 - 0.35 < (S.speed + o.extra) * dt * 1.5 + 0.15;
        if (frontal) return crash(o);
        if (S.stumbleCool <= 0) stumble();
        return;
    }
}

// 行驶障碍撞击：普通护盾挡不住；护盾升级到 MOVING_SHIELD_LV 级及以上才能挡下一次
function movingCrash(o) {
    if (S.power.shield > 0 && (SAVE.up.shield || 0) >= MOVING_SHIELD_LV) {
        S.power.shield = 0;
        obstacles.splice(obstacles.indexOf(o), 1);
        disposeObj(o.mesh);
        SFX.shield();
        S.chaserTimer = Math.max(S.chaserTimer, 5);   // 与普通护盾一致：挡下撞击后保安立刻追上来
        SFX.guard();
        showMsg('🛡️ 强化护盾挡下了行驶的' + (OBSTACLE_DEFS[o.type].name || '障碍') + '！');
        return;
    }
    die('被行驶的' + (OBSTACLE_DEFS[o.type].name || '障碍') + '撞上了！');
}

// 撞上支撑柱：跳不过也钻不过，任何接触都算撞（护盾可以按普通撞击规则扛一次）
function pillarCrash(o) {
    if (S.power.shield > 0) {
        S.power.shield = 0;
        obstacles.splice(obstacles.indexOf(o), 1);
        disposeObj(o.mesh);
        SFX.shield();
        S.chaserTimer = Math.max(S.chaserTimer, 5);
        SFX.guard();
        showMsg('🛡️ 护盾硬扛了一根支撑柱！' + CONFIG.chaser.name + '追上来了');
        return;
    }
    die('一头撞上了支撑柱！');
}

function startFlight() {
    SFX.wings();
    S.chaserTimer = 0;
    S.holdDown = false;
    S.rolling = 0;
    // 起飞：以当前地面高度为起点，进入 takeoff 状态
    beginFlight(S.flight, surfaceAt(S.x, S.y));
    S.flight.landHandled = false;
    S.power.wings = powerDur('wings');
    // 在空中铺一条起伏的金币航线，覆盖整个飞行时间
    const cruise = CONFIG.flight.cruiseY;
    const end = S.D + 16 + S.speed * (powerDur('wings') - 1.4);
    let lane = S.lane;
    for (let s = S.D + 16, i = 0; s < end; s += 2.6, i++) {
        if (i % 6 === 5) lane = clamp(lane + pick([-1, 1]), 0, 2);
        addCoin(lane, s, cruise + 0.9 + Math.sin(i * 0.35) * 0.5);
    }
    showMsg('🕊 胡艺凡起飞！');
}

function stumble() {
    S.lane = S.prevLane;
    S.stumbleCool = 0.6;
    if (S.power.shield > 0) return;
    SFX.stumble();
    if (S.chaserTimer > 0) return die('被' + CONFIG.chaser.name + '抓住了！');
    S.chaserTimer = 5;
    SFX.guard();
    showMsg('小心！' + CONFIG.chaser.name + '追上来了');
}

function crash(o) {
    if (S.power.shield > 0) {
        S.power.shield = 0;
        obstacles.splice(obstacles.indexOf(o), 1);
        disposeObj(o.mesh);
        SFX.shield();
        S.chaserTimer = Math.max(S.chaserTimer, 5);   // 护盾挡下撞击，保安立刻追上来
        SFX.guard();
        showMsg('护盾抵挡了一次撞击！' + CONFIG.chaser.name + '追上来了');
        return;
    }
    die('撞上了！');
}

// ---------- 复活币：拾取与使用 ----------
function takeRevive() {
    S.revives = Math.min(REVIVE_CFG.maxHold, S.revives + 1);
    SFX.power();
    SFX.shield();
    showMsg('💖 捡到复活币！死亡自动复活（持有 ' + S.revives + ' 个）');
}

// 用掉一个复活币：拐弯失败 → 回到路口前 100m 重来；其他死因 → 原地复活 + 清空身前障碍
function useRevive() {
    S.revives--;
    S.reviveUsed++;
    S.state = 'playing';
    S.dieT = 0;
    let rewound = false;
    if (S.diedTurnAt != null) {
        // 在弯里原地复活没有意义：方向已经错过，睁眼就在墙里。整块底板倒回弯前 100m。
        const arc = S.diedTurnAt - 100;
        if ((curTheme === 'campus' || curTheme === 'campus2') && campusRewindTo(arc)) {
            for (let i = obstacles.length - 1; i >= 0; i--) { disposeObj(obstacles[i].mesh); obstacles.splice(i, 1); }
            for (let i = coins.length - 1; i >= 0; i--) { disposeObj(coins[i].mesh); coins.splice(i, 1); }
            for (let i = pickups.length - 1; i >= 0; i--) { disposeObj(pickups[i].mesh); pickups.splice(i, 1); }
            S.nextRowS = S.D + 45;          // 重新铺障碍，别在脸上刷
            S.laneFree = [0, 0, 0];
            S.laneSafeUntil = [0, 0, 0];
            S.safeLane = 1;
            rewound = true;
        }
        S.diedTurnAt = null;
    }
    if (!rewound) {
        // 清场：身前这一段的迎面车、支撑柱、栏杆全部清掉，给一次真正的喘息
        for (let i = obstacles.length - 1; i >= 0; i--) {
            const o = obstacles[i];
            if (o.z + o.len / 2 > -REVIVE_CFG.clearAhead && o.z - o.len / 2 < 8) {
                disposeObj(o.mesh);
                obstacles.splice(i, 1);
            }
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
    showMsg(rewound ? '💖 复活币生效：回到路口前 100 米（还剩 ' + S.revives + ' 个）'
                    : '💖 复活币生效！原地复活（还剩 ' + S.revives + ' 个）');
}

function die(text) {
    S.lastDeathCause = text;              // 死因留档：复活之后也能查到是被什么撞的
    if (S.revives > 0) { useRevive(); return; }
    // [PKVS] 对局中死亡 → 立刻上报 dnf 判负；等待 / 结算由接入层接管
    if (typeof window.__pkOnDie === 'function') window.__pkOnDie(text);
    S.state = 'dying';
    S.dieT = 0;
    $('overTitle').textContent = text;
    SFX.crash();
}

// =====================================================================
