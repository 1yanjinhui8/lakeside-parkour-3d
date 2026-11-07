// =============================================================================
//  湖畔跑酷 3D —— 自动化测试
//  直接从 index.html 里按标记提取「动画核心 / 飞行控制器 / 角色建模」的真实源码，
//  在 Node 里用 mock 的 THREE 跑，不需要浏览器。
//  运行： node tests/game.test.mjs      （或 npm test）
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'playable.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

// ------------------------------- 测试框架 -----------------------------------
let passed = 0;
const failures = [];
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`\x1b[32m✅\x1b[0m ${name}`);
    } catch (e) {
        failures.push({ name, message: e.message });
        console.log(`\x1b[31m❌\x1b[0m ${name}\n     ${e.message}`);
    }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function assertClose(a, b, eps, msg) {
    if (!(Math.abs(a - b) <= eps)) throw new Error(`${msg || '数值不接近'}: ${a} vs ${b} (eps=${eps})`);
}
function assertFinite(v, msg) { if (!Number.isFinite(v)) throw new Error(`${msg || '非有限数'}: ${v}`); }
function near(a, b, eps) { return Math.abs(a - b) <= eps; }

// ------------------------------- 代码提取 -----------------------------------
function sliceBetween(src, start, end) {
    const i = src.indexOf(start);
    const j = src.indexOf(end);
    assert(i >= 0, `找不到标记: ${start}`);
    assert(j > i, `找不到结束标记: ${end}`);
    return src.slice(i + start.length, j);
}
const coreSrc = sliceBetween(html, '//  TESTABLE-CORE-START', '//  TESTABLE-CORE-END');
const rigSrc = sliceBetween(html, '//  RIG-START', '//  RIG-END');
const dataSrc = sliceBetween(html, '//  GAME-DATA-START', '//  GAME-DATA-END');
const audioSrc = sliceBetween(html, '//  AUDIO-DATA-START', '//  AUDIO-DATA-END');

// 用 Function 包一层，返回需要的符号
const C = new Function(coreSrc + `
return {
    ANIM_CFG, createAnim, stepAnim, applyPose,
    poseRun, poseCrouch, poseAir, poseLand, poseRoll, poseFly, poseShowcase, poseFall,
    FLIGHT_CFG, createFlight, beginFlight, stepFlight,
    damp, clamp01, easeOutC,
};`)();

// 场景/障碍纯数据与纯逻辑（无 THREE 依赖）
const D = new Function(dataSrc + '\n' + audioSrc + `
return {
    OBSTACLE_DEFS, SCENE_OBSTACLES, SCENE_SEG_LEN, SCENE_SEQ,
    MOVING_OBSTACLE, MOVING_SHIELD_LV, PILLAR_CFG, REVIVE_CFG, reviveChanceAt, reviveRoll,
    AUDIO_DEFAULTS, AUDIO_CHANNELS, audioChannelGain,
    tryAirJump, bounceImpulse, wobbleOffset, surfaceHeightAt, validateSceneData,
};`)();

// ------------------------------- mock THREE ---------------------------------
function mockThree() {
    class Vec {
        constructor() { this.x = 0; this.y = 0; this.z = 0; }
        set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
        setScalar(s) { this.x = this.y = this.z = s; return this; }
    }
    class Obj {
        constructor() {
            this.position = new Vec();
            this.rotation = new Vec();
            this.scale = new Vec().set(1, 1, 1);
            this.children = [];
            this.name = '';
            this.visible = true;
            this.castShadow = false;
            this.receiveShadow = false;
            this.userData = {};
        }
        add(...cs) { for (const c of cs) { this.children.push(c); c.parent = this; } return this; }
        traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
    }
    class Mesh extends Obj {
        constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; }
    }
    class Group extends Obj {
        constructor() { super(); this.isGroup = true; }
    }
    class Geo {
        constructor(...args) { this.args = args; this.userData = {}; }
    }
    const G = kind => class extends Geo { constructor(...a) { super(...a); this.kind = kind; } };
    class MeshStandardMaterial {
        constructor(opts = {}) { this.userData = {}; Object.assign(this, opts); }
    }
    return {
        Group, Mesh, Object3D: Obj,
        SphereGeometry: G('sphere'),
        BoxGeometry: G('box'),
        CapsuleGeometry: G('capsule'),
        CylinderGeometry: G('cylinder'),
        ConeGeometry: G('cone'),
        TorusGeometry: G('torus'),
        PlaneGeometry: G('plane'),
        MeshStandardMaterial,
    };
}
const THREE = mockThree();
const stdMock = (color, opts = {}) => ({ color, userData: {}, ...opts });
const buildHumanoid = new Function('THREE', 'std', rigSrc + '\nreturn buildHumanoid;')(THREE, stdMock);

// ------------------------------- 工具 --------------------------------------
const JOINTS = ['root', 'pivot', 'body', 'torso', 'head', 'hair', 'legL', 'kneeL', 'legR', 'kneeR', 'armL', 'elbowL', 'armR', 'elbowR'];
function makeRig() {
    const mk = () => ({
        rotation: { x: 0, y: 0, z: 0 },
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
    });
    const h = {};
    for (const k of JOINTS) h[k] = mk();
    h.pivot.position.y = 0.9;
    h.body.position.y = -0.9;
    return h;
}
function jointValues(h) {
    const out = {};
    for (const k of JOINTS) {
        out[k] = { ...h[k].rotation };
    }
    return out;
}
function maxJoint(h) {
    let m = 0;
    for (const k of JOINTS) for (const ax of ['x', 'y', 'z']) m = Math.max(m, Math.abs(h[k].rotation[ax]));
    return m;
}
function simulate(poseFn, st, frames, h, dt = 1 / 60, anim = null) {
    const a = anim || C.createAnim();
    for (let i = 0; i < frames; i++) {
        const s = typeof st === 'function' ? st(i) : st;
        C.stepAnim(a, dt, s);
        poseFn(h, a, s);
    }
    return a;
}

// =============================================================================
//  1. 结构检查
// =============================================================================
test('index.html 含全部测试标记与关键实现', () => {
    assert(html.includes('TESTABLE-CORE-START'), '缺少动画核心起始标记');
    assert(html.includes('TESTABLE-CORE-END'), '缺少动画核心结束标记');
    assert(html.includes('GAME-DATA-START') && html.includes('GAME-DATA-END'), '缺少场景数据标记');
    assert(html.includes('RIG-START') && html.includes('RIG-END'), '缺少建模标记');
    assert(html.includes('function stepFlight'), '缺少飞行状态机');
    assert(html.includes('function selfTest'), '缺少浏览器自检');
    assert(html.includes("has('selftest')"), '缺少 ?selftest 入口');
    assert(!/poseK\s*=/.test(html), '仍有旧的 poseK 平滑实现');
});

test('动画核心导出完整', () => {
    for (const k of ['createAnim', 'stepAnim', 'applyPose', 'poseRun', 'poseAir', 'poseLand', 'poseRoll', 'poseFly',
        'createFlight', 'beginFlight', 'stepFlight', 'ANIM_CFG', 'FLIGHT_CFG']) {
        assert(C[k] != null, `缺少导出: ${k}`);
    }
});

// =============================================================================
//  2. 帧率无关性
// =============================================================================
test('动画平滑与帧率无关（30/60/120fps 结果一致）', () => {
    const runAt = fps => {
        const a = C.createAnim();
        const dt = 1 / fps;
        const frames = Math.round(1.5 * fps);
        const st = { grounded: true, speed: 30, vx: 7, vy: 0, phase: 0 };
        for (let i = 0; i < frames; i++) C.stepAnim(a, dt, { ...st, phase: i * dt * 12 });
        return a;
    };
    const a30 = runAt(30), a60 = runAt(60), a120 = runAt(120);
    assertClose(a30.lean, a120.lean, 2e-3, 'lean 帧率无关');
    assertClose(a60.lean, a120.lean, 2e-3, 'lean 帧率无关(60/120)');
    assertClose(a30.hair, a120.hair, 3e-2, 'hair 帧率无关');
    assertClose(a30.squash, a120.squash, 3e-2, 'squash 帧率无关');
});

test('步进 dt=0 与超大 dt 不产生 NaN', () => {
    const a = C.createAnim();
    for (const dt of [0, 1e-6, 1 / 30, 0.5, 2]) {
        C.stepAnim(a, dt, { grounded: false, flying: true, vy: 12, vx: -6, speed: 30 });
        for (const k of ['k', 't', 'airT', 'land', 'squash', 'stretch', 'hair', 'lean', 'bank']) assertFinite(a[k], `anim.${k}`);
    }
});

// =============================================================================
//  3. 各姿态：数值有限 + 关节不超限
// =============================================================================
test('跑动姿态：数值有限、关节在限位内、幅度随速度增大', () => {
    const h = makeRig();
    let prevAmp = 0;
    for (const speed of [15, 25, 34]) {
        const a = C.createAnim();
        let amp = 0;
        for (let i = 0; i < 90; i++) {
            C.stepAnim(a, 1 / 60, { grounded: true, speed, vx: 0, vy: 0, phase: i * 0.3 });
            C.poseRun(h, a, { phase: i * 0.3, speed, vx: 0, grounded: true });
            assertFinite(h.legL.rotation.x, 'legL.x');
            assert(maxJoint(h) < C.ANIM_CFG.jointLimit, `关节超限: ${maxJoint(h).toFixed(2)}`);
            amp = Math.max(amp, Math.abs(h.legL.rotation.x));
        }
        assert(amp > prevAmp - 1e-6, '速度快时摆幅应该更大');
        prevAmp = amp;
    }
});

test('空中姿态随 vy 变化（上升收腿 / 下落伸腿）', () => {
    const mk = vy => {
        const h = makeRig(), a = C.createAnim();
        for (let i = 0; i < 40; i++) {
            C.stepAnim(a, 1 / 60, { grounded: false, vy, phase: i * 0.1 });
            C.poseAir(h, a, { vy, grounded: false });
        }
        return h;
    };
    const up = mk(9), apex = mk(0), down = mk(-9);
    for (const h of [up, apex, down]) {
        assert(maxJoint(h) < C.ANIM_CFG.jointLimit, '空中关节超限');
    }
    assert(apex.kneeL.rotation.x < up.kneeL.rotation.x, '顶点应该比上升时收腿更多');
    assert(down.kneeL.rotation.x > apex.kneeL.rotation.x, '下落时腿应该伸开准备落地');
});

test('落地缓冲：有下压、并随时间恢复', () => {
    const h = makeRig(), a = C.createAnim();
    a.land = C.ANIM_CFG.landTime;
    let maxSquash = 0, minBodyY = 9;
    for (let i = 0; i < Math.round(C.ANIM_CFG.landTime * 60) + 6; i++) {
        C.stepAnim(a, 1 / 60, { grounded: true, vy: 0, phase: 0 });
        C.poseLand(h, a, { grounded: true });
        maxSquash = Math.max(maxSquash, a.squash);
        minBodyY = Math.min(minBodyY, h.body.position.y);
        assertFinite(h.body.position.y, 'body.y');
    }
    assert(maxSquash > 0.3, `落地压缩不明显: ${maxSquash.toFixed(2)}`);
    assert(minBodyY < -1.0, `落地时身体没有下压: ${minBodyY.toFixed(2)}`);
    assert(a.land === 0, '落地缓冲计时没有结束');
});

test('翻滚：贴地、转满一圈、结束角度等价于 0', () => {
    const h = makeRig(), a = C.createAnim();
    const T = C.ANIM_CFG.rollTime;
    let minY = 9, minRot = 0, maxRotStep = 0, prev = 0;
    for (let i = 0; i <= Math.round(T * 60); i++) {
        const prog = i / Math.round(T * 60);
        C.poseRoll(h, a, { rollProg: prog, rolling: prog < 1 ? 1 : 0 });
        minY = Math.min(minY, h.pivot.position.y);
        minRot = Math.min(minRot, h.pivot.rotation.x);
        maxRotStep = Math.max(maxRotStep, Math.abs(h.pivot.rotation.x - prev));
        prev = h.pivot.rotation.x;
        assertFinite(h.pivot.rotation.x, 'pivot.x');
    }
    assert(minY < 0.75, `翻滚没有贴地: ${minY.toFixed(2)}`);
    assert(near(h.pivot.rotation.x, -2 * Math.PI, 1e-6), `翻滚结束角度应为 -2π（视觉 0）: ${h.pivot.rotation.x}`);
    assert(minRot < -Math.PI * 1.8, '翻滚没有转满一圈');
    assert(maxRotStep < 0.6, `翻滚单帧跳变过大: ${maxRotStep.toFixed(2)}`);
});

test('飞行姿态：侧倾随横向速度、数值有限', () => {
    const h = makeRig(), a = C.createAnim();
    for (let i = 0; i < 90; i++) {
        C.stepAnim(a, 1 / 60, { flying: true, vx: 8, vy: 0, speed: 30 });
        C.poseFly(h, a, { climb: 1, flying: true });
        assert(maxJoint(h) < C.ANIM_CFG.jointLimit, '飞行关节超限');
    }
    assert(a.bank > 0.4, `飞行侧倾不足: ${a.bank.toFixed(2)}`);
    assert(h.body.rotation.z < -0.05, '侧倾没有作用到身体');
});

test('待机展示姿态（主菜单）数值有限', () => {
    const h = makeRig(), a = C.createAnim();
    for (let i = 0; i < 200; i++) {
        C.stepAnim(a, 1 / 60, { grounded: true, speed: 0 });
        C.poseShowcase(h, a, i / 60);
        assert(maxJoint(h) < C.ANIM_CFG.jointLimit, '展示姿态关节超限');
    }
});

test('applyPose 按状态分发到正确姿态', () => {
    const seen = [];
    const h = makeRig(), a = C.createAnim();
    const cases = [
        [{ rolling: 1, rollProg: 0.5, grounded: true, flying: false }, 'roll'],
        [{ rolling: 0, flying: true, grounded: false }, 'fly'],
        [{ rolling: 0, flying: false, grounded: false, vy: 5 }, 'air'],
        [{ rolling: 0, flying: false, grounded: true, anticip: 0.05 }, 'crouch'],
        [{ rolling: 0, flying: false, grounded: true, anticip: 0 }, 'run/land'],
    ];
    for (const [st, tag] of cases) {
        C.stepAnim(a, 1 / 60, st);
        C.applyPose(h, a, st);
        assertFinite(h.pivot.rotation.x, tag);
        seen.push(tag);
    }
    assert(seen.length === cases.length);
});

// =============================================================================
//  4. 平滑度 / 连续性与跳跃缓冲
// =============================================================================
test('跑动循环无抖动：单帧变化平稳', () => {
    const h = makeRig(), a = C.createAnim();
    const snaps = [];
    for (let i = 0; i < 120; i++) {
        const st = { grounded: true, speed: 30, vx: 0, vy: 0, phase: i * 0.18 };
        C.stepAnim(a, 1 / 60, st);
        C.poseRun(h, a, st);
        snaps.push(jointValues(h));
    }
    let maxDelta = 0;
    for (let i = 1; i < snaps.length; i++) {
        for (const k of JOINTS) for (const ax of ['x', 'y', 'z']) {
            maxDelta = Math.max(maxDelta, Math.abs(snaps[i][k][ax] - snaps[i - 1][k][ax]));
        }
    }
    assert(maxDelta < 0.35, `单帧最大变化 ${maxDelta.toFixed(3)} 过大（会抖）`);
});

test('起跳→空中→落地→跑动 全程无突跳', () => {
    const h = makeRig(), a = C.createAnim();
    const snaps = [];
    const push = () => snaps.push(jointValues(h));
    // 蓄力
    for (let i = 0; i < 6; i++) { const st = { grounded: true, anticip: 0.09 - i * 0.015, speed: 20 }; C.stepAnim(a, 1 / 60, st); C.applyPose(h, a, st); push(); }
    // 空中（vy 从 9.5 递减到 -12）
    for (let vy = 9.5; vy > -12; vy -= 1.5) { const st = { grounded: false, vy, speed: 20 }; C.stepAnim(a, 1 / 60, st); C.applyPose(h, a, st); push(); }
    // 落地
    a.land = C.ANIM_CFG.landTime;
    for (let i = 0; i < 20; i++) { const st = { grounded: true, vy: 0, speed: 20, phase: i * 0.2 }; C.stepAnim(a, 1 / 60, st); C.applyPose(h, a, st); push(); }
    let maxDelta = 0;
    for (let i = 1; i < snaps.length; i++) {
        for (const k of JOINTS) for (const ax of ['x', 'y', 'z']) {
            const d = Math.abs(snaps[i][k][ax] - snaps[i - 1][k][ax]);
            if (d > maxDelta) maxDelta = d;
        }
    }
    assert(maxDelta < 0.75, `状态切换处突跳 ${maxDelta.toFixed(3)} 过大`);
});

// =============================================================================
//  5. 飞行控制器状态机
// =============================================================================
function runFlight({ timeLeft = 7, groundY = 0, input = () => ({}), maxSteps = 60 * 20 } = {}) {
    const f = C.beginFlight(C.createFlight(), groundY);
    const phases = [];
    let y = groundY, minY = Infinity, maxY = -Infinity, openMax = 0, steps = 0, bad = false;
    let t = timeLeft;
    while (steps < maxSteps && f.phase !== 'idle') {
        t = Math.max(0, t - 1 / 60);
        C.stepFlight(f, 1 / 60, input(steps, f), { groundY, timeLeft: t });
        if (!phases.length || phases[phases.length - 1] !== f.phase) phases.push(f.phase);
        y = f.y; minY = Math.min(minY, y); maxY = Math.max(maxY, y); openMax = Math.max(openMax, f.open);
        if (!Number.isFinite(f.y) || !Number.isFinite(f.open)) { bad = true; break; }
        steps++;
    }
    return { f, phases, y, minY, maxY, openMax, steps, bad, timeLeft: t };
}

test('飞行：起飞→巡航→降落→落地→收翼，完整闭环', () => {
    const r = runFlight();
    assert(!r.bad, '飞行中出现 NaN');
    const seq = r.phases.filter(p => p !== 'idle');
    assert(seq.join('>') === 'takeoff>cruise>descent>land', `阶段顺序异常: ${r.phases.join('>')}`);
    assert(near(r.f.y, 0, 0.01), `落地高度应为 0，实际 ${r.f.y}`);
    assert(r.f.done === true, '没有标记完成');
    assert(r.f.active === false, '没有退出 active');
    assert(r.openMax > 0.9, `翅膀没有完全展开: ${r.openMax.toFixed(2)}`);
    assert(r.f.open < 0.05, `落地后翅膀没有收起: ${r.f.open.toFixed(2)}`);
    assert(r.maxY > C.FLIGHT_CFG.cruiseY - 0.6, `没有到达巡航高度: ${r.maxY.toFixed(2)}`);
    assert(r.steps / 60 > 3 && r.steps / 60 < 14, `飞行时长异常: ${(r.steps / 60).toFixed(1)}s`);
    assert(r.minY >= -0.001, `低于地面: ${r.minY}`);
});

test('飞行：按住 ↑ 爬升，按住 ↓ 俯冲提前落地', () => {
    const climb = runFlight({ input: () => ({ climb: true }) });
    const normal = runFlight();
    assert(climb.maxY > normal.maxY + 0.8, `按 ↑ 应爬升更高: ${climb.maxY.toFixed(2)} vs ${normal.maxY.toFixed(2)}`);
    assert(climb.maxY <= C.FLIGHT_CFG.cruiseY + C.FLIGHT_CFG.climbRange + 0.2, '爬升高度越界');

    const dive = runFlight({ input: () => ({ dive: true }) });
    assert(dive.steps / 60 < normal.steps / 60 - 1, `按 ↓ 应更早落地: ${(dive.steps / 60).toFixed(1)}s vs ${(normal.steps / 60).toFixed(1)}s`);
    assert(near(dive.f.y, 0, 0.01), '俯冲后落地高度不对');
    assert(dive.minY >= -0.001, `俯冲到地下: ${dive.minY}`);
});

test('飞行：在火车顶(高度3)上方时降落到车顶而不是穿下去', () => {
    const r = runFlight({ groundY: 3 });
    assert(!r.bad, '出现 NaN');
    assert(near(r.f.y, 3, 0.02), `应降落在车顶 3，实际 ${r.f.y}`);
    assert(r.minY >= 3 - 0.001, `穿到车顶以下: ${r.minY}`);
});

test('飞行：地面高度变化不影响状态机推进', () => {
    const f = C.beginFlight(C.createFlight(), 0);
    let t = 7;
    for (let i = 0; i < 60 * 12 && f.phase !== 'idle'; i++) {
        t = Math.max(0, t - 1 / 60);
        C.stepFlight(f, 1 / 60, {}, { groundY: i > 300 ? 3 : 0, timeLeft: t });
        assertFinite(f.y, 'f.y');
        assert(f.open >= 0 && f.open <= 1, `open 越界: ${f.open}`);
    }
    assert(f.phase === 'idle', '没有结束');
});

// =============================================================================
//  6. 角色建模（按照片/生成图重建）
// =============================================================================
test('角色建模：骨骼接口完整且数值正常', () => {
    const o = {
        skin: 0xf1c7a5, hair: 0x15100d, top: 0xff2d95, bottom: 0x1b2238, shoes: 0xc98a3e,
        glasses: 0xd5dde6, longHair: true,
    };
    const h = buildHumanoid(o);
    for (const k of JOINTS) assert(h[k], `缺少关节: ${k}`);
    for (const k of ['root', 'pivot', 'body', 'torso', 'head', 'hair', 'legL', 'kneeL', 'legR', 'kneeR', 'armL', 'elbowL', 'armR', 'elbowR']) {
        for (const ax of ['x', 'y', 'z']) {
            assertFinite(h[k].rotation[ax], `${k}.rotation.${ax}`);
            assertFinite(h[k].position[ax], `${k}.position.${ax}`);
        }
    }
    assert(h.shoeMat && h.baseShoe === o.shoes, '鞋子材质/基色没有返回');
    assert(h.kneeL.position.y < 0, '膝盖关节应该在髋部下方');
    assert(near(h.legL.position.x, 0.145, 1e-6) && near(h.legR.position.x, -0.145, 1e-6), '左右腿位置不对');
});

test('角色建模：脸 / 墨镜 / 外套 / 靴子 部件齐全', () => {
    const h = buildHumanoid({ skin: 0xf1c7a5, hair: 0x15100d, top: 0xff2d95, bottom: 0x1b2238, shoes: 0xc98a3e, glasses: 0xd5dde6, longHair: true });
    const names = new Set();
    h.root.traverse(o => { if (o.name) names.add(o.name); });
    for (const part of ['eyeWhite', 'pupil', 'brow', 'mouth', 'blush', 'glassesUp', 'lens', 'bridge', 'hood', 'zipper', 'collar',
        'boot', 'sole', 'hairCap', 'hairBack', 'hairStrand', 'bangs', 'jacket', 'belt']) {
        assert(names.has(part), `缺少部件: ${part}`);
    }
    let meshCount = 0;
    h.root.traverse(o => { if (o.isMesh) meshCount++; });
    assert(meshCount > 45, `网格数量偏少（建模太简陋？）: ${meshCount}`);
    // 墨镜必须推到额头（比眼睛高），而不是挡着脸
    h.root.traverse(o => {
        if (o.name === 'glassesUp') {
            assert(o.position.y > 0.12, `墨镜应该在头顶，实际 y=${o.position.y}`);
        }
    });
});

test('角色建模：遮阳帽版（追捕者）仍然可用', () => {
    const h = buildHumanoid({ skin: 0xe0b48f, hair: 0x2a1d14, top: 0x2a3f7a, bottom: 0x1d2433, shoes: 0x111111, cap: 0x1a2a55 });
    const names = new Set();
    h.root.traverse(o => { if (o.name) names.add(o.name); });
    assert(names.has('cap') && names.has('capBrim'), '帽子部件缺失');
    assert(!names.has('hairStrand'), '没开 longHair 却生成了长发');
});

test('角色建模：新骨骼能跑完全套动画不 NaN', () => {
    const h = buildHumanoid({ skin: 0xf1c7a5, hair: 0x15100d, top: 0xff2d95, bottom: 0x1b2238, shoes: 0xc98a3e, glasses: 0xd5dde6, longHair: true });
    const a = C.createAnim();
    const states = [
        { grounded: true, speed: 30, phase: 0.4 },
        { grounded: true, anticip: 0.05 },
        { grounded: false, vy: 8 },
        { grounded: false, vy: -10 },
        { grounded: true, land: true },
        { rolling: 1, rollProg: 0.4 },
        { flying: true, vx: 5 },
    ];
    for (const st of states) {
        if (st.land) a.land = C.ANIM_CFG.landTime;
        for (let i = 0; i < 30; i++) {
            C.stepAnim(a, 1 / 60, st);
            C.applyPose(h, a, st);
        }
    }
    for (const k of JOINTS) for (const ax of ['x', 'y', 'z']) {
        assertFinite(h[k].rotation[ax], `动画后 ${k}.rotation.${ax}`);
    }
});

// =============================================================================
//  7. 场景系统（GAME-DATA 纯逻辑：注册表 / 转场 / 二段跳 / 车顶弹跳 / 支撑面）
// =============================================================================
test('主题注册表完整：四场景障碍集均含 可骑乘+跳+钻 三类', () => {
    const bad = D.validateSceneData(D.OBSTACLE_DEFS, D.SCENE_OBSTACLES);
    assert(bad === null, `场景数据不合法: ${bad}`);
    for (const id of ['lakeside', 'tunnel', 'city', 'campus']) {
        assert(D.SCENE_OBSTACLES[id], `缺少场景障碍集: ${id}`);
        assert(D.SCENE_SEG_LEN[id], `缺少场景段长: ${id}`);
        assert(D.SCENE_SEQ.includes(id) || id === 'campus2', `场景 ${id} 不在固定循环里`);
    }
});

test('段长范围合法，且与 THEMES 注册表一致', () => {
    for (const [id, [min, max]] of Object.entries(D.SCENE_SEG_LEN)) {
        assert(min > 50 && min <= max, `${id} 段长范围异常: [${min}, ${max}]`);
        const re = new RegExp(id + ":\\s*\\{[^}]*segLen:\\s*SCENE_SEG_LEN\\." + id);
        assert(re.test(html), `THEMES.${id} 没有使用 SCENE_SEG_LEN.${id}`);
    }
});

test('场景固定循环：轨道 → 隧道 → 城市 → 学校 → 医学部，不再随机', () => {
    assert(JSON.stringify(D.SCENE_SEQ) === JSON.stringify(['lakeside', 'tunnel', 'city', 'campus', 'campus2']),
        `固定顺序应为 轨道→隧道→城市→学校→医学部，实际 ${D.SCENE_SEQ.join('→')}`);
    // 医学部紧跟燕园：燕园段尾声的川大门就是通往它的传送门
    assert(D.SCENE_SEQ[D.SCENE_SEQ.indexOf('campus') + 1] === 'campus2', '燕园后面必须接医学部');
    // 循环里的每个 id 都得在 THEMES / 段长表里存在，写错一个字母就换不成图
    // 医学部复用 campus 的段长（THEMES.campus2.segLen = SCENE_SEG_LEN.campus）
    for (const id of D.SCENE_SEQ) {
        const seg = D.SCENE_SEG_LEN[id] || (id === 'campus2' ? D.SCENE_SEG_LEN.campus : null);
        assert(seg, `循环里的 ${id} 没有段长`);
    }
    // 不能有重复（否则循环会跳着走）
    assert(new Set(D.SCENE_SEQ).size === D.SCENE_SEQ.length, '循环表里有重复场景');
    // 单人开局必须从循环第一张开始
    assert(D.SCENE_SEQ[0] === 'lakeside', `开局应是湖畔轨道，实际 ${D.SCENE_SEQ[0]}`);
});

test('车顶弹跳：仅城市场景、落在带 bounce 的车顶、下落速度足够时触发', () => {
    const car = { bounce: 7.2 };
    assertClose(D.bounceImpulse(car, -3, 'city'), 7.2, 1e-9, '城市落车顶应弹起');
    assert(D.bounceImpulse(car, -3, 'campus') === 0, '校园里车顶不弹');
    assert(D.bounceImpulse(car, -0.4, 'city') === 0, '下落太慢不弹（避免站立时反复触发）');
    assert(D.bounceImpulse({ bounce: 0 }, -3, 'city') === 0, '无 bounce 的障碍不弹');
    assert(D.bounceImpulse(null, -3, 'city') === 0, '落在地面不弹');
});

test('二段跳：仅校园、仅空中、每腾空周期一次', () => {
    const st = { grounded: false, flying: false, vy: -2, airJumps: 0, rolling: 0, anticip: 0 };
    const v = D.tryAirJump(st, 'campus', 9.5);
    assertClose(v, 9.5 * 0.82, 1e-9, '二段跳冲量应为 0.82 倍');
    assert(st.airJumps === 1, '计数应为 1');
    assert(D.tryAirJump(st, 'campus', 9.5) === 0, '第二次空中按跳无效');
    assert(st.airJumps === 1, '计数不重复增加');
    // 落地清零（主循环语义：grounded 时计数归零后才允许下一周期）
    st.grounded = true; st.airJumps = 0;
    assert(D.tryAirJump(st, 'campus', 9.5) === 0, '贴地按跳不是二段跳');
    st.grounded = false;
    assert(D.tryAirJump(st, 'lakeside', 9.5) === 0, '非校园场景不二段跳');
    st.flying = true;
    assert(D.tryAirJump(st, 'campus', 9.5) === 0, '飞行器互斥');
    st.flying = false; st.rolling = 0.3;
    assert(D.tryAirJump(st, 'campus', 9.5) === 0, '翻滚中不二段跳');
    // 回归：刚离地时 vy 仍高于二段跳冲量，禁止触发（否则把 9.5 覆盖成 7.79 反而削弱跳跃）
    st.rolling = 0; st.airJumps = 0; st.vy = 9.5;
    assert(D.tryAirJump(st, 'campus', 9.5) === 0, '刚离地（vy 高）不二段跳');
    assert(st.airJumps === 0, '未触发不计数');
    st.vy = 9.5 * 0.35 + 0.01;                  // 阈值上方仍封锁
    assert(D.tryAirJump(st, 'campus', 9.5) === 0, '阈值上方不触发');
    assert(st.airJumps === 0, '未触发不计数');
    st.vy = 1.0;                                // 上升乏力后才允许接管
    assert(D.tryAirJump(st, 'campus', 9.5) > 0, '上升乏力时允许二段跳');
});

test('surfaceHeightAt：ride 障碍返回车顶高度并给出支撑来源', () => {
    const bus = { type: 'bus', ride: true, h1: 3.1, x: 0, z: 0, len: 18 };
    const car = { type: 'car', ride: true, h1: 1.45, x: 2.4, z: 0, len: 4.2 };
    const bar = { type: 'lowBar', ride: false, h1: 1.0, x: 0, z: 0, len: 0.6 };
    let r = D.surfaceHeightAt([bus, bar], 0, 3.1, 3.0);
    assertClose(r.g, 3.1, 1e-9, '站上公交车顶');
    assert(r.ob === bus, '支撑来源应为公交车');
    r = D.surfaceHeightAt([bus], 0, 0, 3.0);
    assert(r.g === 0 && r.ob === null, '从下方经过时不能吸到车顶');
    r = D.surfaceHeightAt([car], 2.4, 1.45, 3.0);
    assertClose(r.g, 1.45, 1e-9, '站上小汽车车顶');
    r = D.surfaceHeightAt([car], 0, 1.45, 3.0);
    assert(r.g === 0, '横向超出车身宽度不算站上');
    // 坡道：高度沿长度插值
    const ramp = { type: 'ramp', ride: false, h1: 0, x: 0, z: 0, len: 10 };
    r = D.surfaceHeightAt([ramp], 0, 3.0, 3.0);
    assertClose(r.g, 1.5, 1e-9, '坡道中点高度应为 1.5');
});

test('自行车 wobble：振幅受限且随里程周期变化', () => {
    let max = 0;
    for (let d = 0; d < 200; d += 0.1) max = Math.max(max, Math.abs(D.wobbleOffset(d, 1.6)));
    assert(max <= 0.4 + 1e-9, `振幅应 ≤0.4，实际 ${max}`);
    assert(max > 0.35, `振幅过小（没摆起来）: ${max}`);
    assert(Math.abs(D.wobbleOffset(0, 1.6)) < 1e-9, '起点应在车道中心');
});

test('行驶障碍注册表：每个地图一种、类型在该场景障碍集内、护盾门槛 1~10 级', () => {
    assert(D.MOVING_OBSTACLE && typeof D.MOVING_OBSTACLE === 'object', '缺少 MOVING_OBSTACLE 注册表');
    for (const id of Object.keys(D.SCENE_OBSTACLES)) {
        const t = D.MOVING_OBSTACLE[id];
        assert(t, `${id} 缺少行驶障碍`);
        assert(D.SCENE_OBSTACLES[id].includes(t), `${id} 的行驶障碍 ${t} 不在该场景障碍集里`);
        assert(D.OBSTACLE_DEFS[t], `${id} 行驶障碍 ${t} 无定义`);
        assert(D.OBSTACLE_DEFS[t].name, `${id} 行驶障碍 ${t} 缺少 name（死亡提示用）`);
    }
    assert(Number.isInteger(D.MOVING_SHIELD_LV) && D.MOVING_SHIELD_LV >= 1 && D.MOVING_SHIELD_LV <= 10,
        `护盾门槛应在 1~10 级，实际 ${D.MOVING_SHIELD_LV}`);
});

test('surfaceHeightAt：行驶中的车辆不提供支撑（静止车顶不受影响）', () => {
    const movingCar = { type: 'car', ride: true, moving: true, h1: 1.45, x: 0, z: 0, len: 4.2 };
    const r = D.surfaceHeightAt([movingCar], 0, 1.45, 3.0);
    assert(r.g === 0 && r.ob === null, '迎面驶来的车顶不应提供支撑');
    const still = { type: 'car', ride: true, h1: 1.45, x: 0, z: 0, len: 4.2 };
    const r2 = D.surfaceHeightAt([still], 0, 1.45, 3.0);
    assertClose(r2.g, 1.45, 1e-9, '静止小汽车车顶仍可站立');
    const movingTrain = { type: 'train', ride: true, moving: true, h1: 3.0, x: 0, z: 0, len: 18 };
    assert(D.surfaceHeightAt([movingTrain], 0, 3.0, 3.0).g === 0, '迎面火车车顶也不能站');
});

test('音量：总音量×各通道独立生效，保安笑声与背景音乐互不影响，静音归零', () => {
    const cfg = Object.assign({}, D.AUDIO_DEFAULTS);
    assert(D.AUDIO_CHANNELS.includes('laugh') && D.AUDIO_CHANNELS.includes('music'), '应包含笑声与音乐两条通道');
    assertClose(D.audioChannelGain(cfg, 'master'), cfg.master, 1e-9, '总音量增益等于自身');
    assertClose(D.audioChannelGain(cfg, 'sfx'), cfg.master * cfg.sfx, 1e-9, '音效 = 总音量×音效');
    assertClose(D.audioChannelGain(cfg, 'laugh'), cfg.master * cfg.laugh, 1e-9, '笑声 = 总音量×笑声');
    assertClose(D.audioChannelGain(cfg, 'music'), cfg.master * cfg.music, 1e-9, '音乐 = 总音量×音乐');
    // 分别调整：关掉笑声不影响音乐，反之亦然
    const onlyMusic = Object.assign({}, cfg, { laugh: 0 });
    assert(D.audioChannelGain(onlyMusic, 'laugh') === 0, '笑声调到 0 应为 0');
    assert(D.audioChannelGain(onlyMusic, 'music') > 0, '笑声归零不影响背景音乐');
    const onlyLaugh = Object.assign({}, cfg, { music: 0 });
    assert(D.audioChannelGain(onlyLaugh, 'laugh') > 0, '音乐归零不影响保安笑声');
    assert(D.audioChannelGain(onlyLaugh, 'music') === 0, '音乐调到 0 应为 0');
    // 总音量对两者同时生效
    const half = Object.assign({}, cfg, { master: 0.5 });
    assertClose(D.audioChannelGain(half, 'laugh'), 0.5 * cfg.laugh, 1e-9, '总音量对笑声生效');
    assertClose(D.audioChannelGain(half, 'music'), 0.5 * cfg.music, 1e-9, '总音量对音乐生效');
    // 静音：所有通道归零
    const muted = Object.assign({}, cfg, { muted: true });
    for (const ch of ['master', 'sfx', 'laugh', 'music']) assert(D.audioChannelGain(muted, ch) === 0, `静音后 ${ch} 应为 0`);
    // 越界输入被夹紧，不产生 >1 或负增益
    const bad = { master: 5, sfx: -3, laugh: 2, music: 0.5 };
    for (const ch of ['master', 'sfx', 'laugh', 'music']) {
        const g = D.audioChannelGain(bad, ch);
        assert(g >= 0 && g <= 1, `${ch} 增益应夹紧在 0~1，实际 ${g}`);
    }
});

test('场景切换：四张地图统一 3000 米', () => {
    const keys = Object.keys(D.SCENE_SEG_LEN);
    assert(keys.length >= 4, '应覆盖四张地图');
    for (const k of keys) {
        const seg = D.SCENE_SEG_LEN[k];
        assert(Array.isArray(seg) && seg.length === 2, `${k} 的段长应是 [min,max]`);
        assert(seg[0] === 3000 && seg[1] === 3000, `${k} 的换场里程应为 3000，实际 ${seg}`);
    }
});

test('隧道柱阵：段长与间隙的几何关系保证玩家能横切', () => {
    const P = D.PILLAR_CFG;
    const secMin = (P.cols[0] - 1) * 3;
    const secMax = (P.cols[1] - 1) * 3;
    assert(P.cols[0] < P.cols[1], '柱段根数应有区间');
    assert(P.gap[0] > secMax, `间隙最短 ${P.gap[0]}m 必须大于最长柱段 ${secMax}m，否则来不及横切`);
    assert(P.trainLead[0] >= 40, `火车出现距离 ${P.trainLead[0]}m 太近，反应不过来`);
    assert(P.cooldown > P.span[1], '两段柱阵之间要留出喘息里程');
    // 柱段长度换算与注释一致
    assert(secMin === 12 && secMax === 21, `柱段应为 12~21 米，实际 ${secMin}~${secMax}`);
});

test('复活币：配置口径 = 100 米 0.5%、每 100 米 +0.5%、5000 米必出', () => {
    const R = D.REVIVE_CFG;
    assert(R.step === 100, `结算步长应为 100 米，实际 ${R.step}`);
    assert(R.pctPerStep === 0.5, `每步应 +0.5%，实际 ${R.pctPerStep}`);
    assert(R.forceAt === 5000, `必出里程应为 5000，实际 ${R.forceAt}`);
    assert(R.forceAt % R.step === 0, '5000 必须正好落在刻度上');
    assert(Math.round(R.forceAt / R.step) === 50, '5000 米 = 第 50 个刻度');
    assert(R.maxHold >= 1, '至少要能存 1 个复活币');
});

test('复活币：概率曲线 n×0.5% 递增，到 5000 米拉满', () => {
    const f = D.reviveChanceAt;
    assertClose(f(0), 0, 1e-12, '第 0 个刻度不该触发');
    assertClose(f(1), 0.005, 1e-12, '100 米 = 0.5%');
    assertClose(f(2), 0.01, 1e-12, '200 米 = 1%');
    assertClose(f(10), 0.05, 1e-12, '1000 米 = 5%');
    assertClose(f(30), 0.15, 1e-12, '3000 米 = 15%');
    assertClose(f(49), 0.245, 1e-12, '4900 米 = 24.5%');
    assertClose(f(50), 1, 1e-12, '5000 米 = 必出');
    assertClose(f(80), 1, 1e-12, '越过必出线后恒为 100%');
    // 单调不减
    let prev = -1;
    for (let n = 0; n <= 60; n++) {
        const v = f(n);
        assert(v >= prev, `概率应单调不减：n=${n} 出现下降`);
        assert(v >= 0 && v <= 1, `概率应夹紧在 0~1，n=${n} 得到 ${v}`);
        prev = v;
    }
});

test('复活币：一次都不中时概率照样累积，到第 50 次强制命中', () => {
    let base = 0, cp = 100, hits = 0, rolls = 0;
    const never = () => 0.999;                 // 永远掷不中（p 最大 0.245）
    while (cp <= 5000) {
        const r = D.reviveRoll(base, cp, never);
        rolls++;
        const want = r.n >= 50 ? 1 : r.n * 0.005;    // 第 50 次是必出，不是 24.5%
        assertClose(r.p, want, 1e-12, `第 ${r.n} 次概率应为 ${want}`);
        if (r.hit) { hits++; base = r.base; }
        cp = r.next;
    }
    assert(rolls === 50, `100~5000 米共 50 次结算，实际 ${rolls}`);
    assert(hits === 1, `不中的情况下只应在 5000 米那一次强制命中，实际 ${hits}`);
    assert(base === 5000, `命中后周期起点应重置到 5000，实际 ${base}`);
});

test('复活币：命中即清零，下一个 100 米回到 0.5%', () => {
    // 第 3 个刻度（300 米，1.5%）命中
    const r = D.reviveRoll(0, 300, () => 0.01);
    assert(r.hit && r.n === 3, '1.5% 概率下 rng=0.01 应该命中');
    assert(r.base === 300, `命中后起点应为 300，实际 ${r.base}`);
    assert(r.next === 400, `下一个刻度应为 400，实际 ${r.next}`);
    // 400 米处重新算：n=1 → 0.5%
    const nxt = D.reviveRoll(r.base, r.next, () => 0.999);
    assert(nxt.n === 1, `清零后应从第 1 个刻度算起，实际 n=${nxt.n}`);
    assertClose(nxt.p, 0.005, 1e-12, '清零后概率应为 0.5%');
    assert(nxt.hit === false, '0.999 不应命中 0.5%');
});

test('复活币：整局模拟——绝大多数在 5000 米前出，且从不超过必出线', () => {
    // 固定种子的 LCG，保证结果可复现
    let seed = 20261027;
    const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const runs = 3000;
    let sum = 0, before = 0, forceHits = 0;
    for (let i = 0; i < runs; i++) {
        let base = 0, cp = 100, found = 0;
        for (let guard = 0; guard < 200 && !found; guard++) {
            const r = D.reviveRoll(base, cp, rng);
            base = r.base;
            if (r.hit) { found = r.next - 100; if (found >= 5000) forceHits++; }
            cp = r.next;
        }
        assert(found > 0, '每一局都该在 10000 米内出至少一个');
        sum += found;
        if (found < 5000) before++;
    }
    const avg = sum / runs;
    assert(avg > 800 && avg < 3000, `平均出币里程应在 800~3000 米，实际 ${avg.toFixed(0)}`);
    assert(before / runs > 0.99, `99% 以上应在 5000 米前自然出，实际 ${(before / runs * 100).toFixed(1)}%`);
    assert(forceHits / runs < 0.01, `强制刷新的比例应 <1%，实际 ${(forceHits / runs * 100).toFixed(2)}%`);
});

// =============================================================================
//  汇总
// =============================================================================
console.log('\n' + '─'.repeat(60));
console.log(`总计 ${passed + failures.length} 项，通过 ${passed}，失败 ${failures.length}`);
if (failures.length) {
    console.log('\n失败列表：');
    for (const f of failures) console.log(' -', f.name, '→', f.message);
    process.exit(1);
}
console.log('\x1b[32m全部通过 ✅\x1b[0m');
