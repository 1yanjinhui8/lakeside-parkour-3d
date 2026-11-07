// ── 主逻辑片段 01/08 ──────────────────────────────
// 分节：文件头 + 游戏配置 —— 角色、追捕者、道具、难度都在这里改 + 加载 Three.js：优先本地文件（需本地服务器），否则走 CDN + 常量与工具 + 渲染器 / 相机 / 
// 按编号顺序合起来 = src/game.module.js 的全部逻辑（资源已用占位符替代）
// 生成自 playable.html，勿手改；重跑 tools/extract-src.py 同步
// ────────────────────────────────────────────────────────────────

// =====================================================================
//  ① 游戏配置 —— 角色、追捕者、道具、难度都在这里改
// =====================================================================
// 角色 GLB：只存一份（以前在 model 数组和重绑骨源里各写了一遍，白占 14.9MB）
const PLAYER_GLB = 'data:model/gltf-binary;base64,OMITTED-04-3.88MB-see-INLINE-ASSETS-md';

const CONFIG = {
    title: '胡艺凡快跑',
    player: {
        name: '粉衣少女',
        // 颜色参考照片：玫红冲锋衣、深色阔腿裤、驼色马丁靴、黑色长发、银色墨镜（推到头顶）
        colors: {
            skin: 0xf1c7a5, hair: 0x1d1512, top: 0xff2d95, bottom: 0x1b2238, shoes: 0xc98a3e,
            glasses: 0xe8eef4, sole: 0x8a5a2b, cuff: 0xd0207a, zipper: 0xd8d0c8,
            eye: 0x241610, mouth: 0xc0605c, blush: 0xf2a0a8,
        },
        longHair: true,
        glasses: true,
        // GLB 真实骨骼角色：按顺序尝试，第一个加载成功的生效；留空数组 = 用代码拼的角色
        model: [PLAYER_GLB, ''],
    },
    chaser: {
        name: '奶蛙',
        colors: { skin: 0xe0b48f, hair: 0x2a1d14, top: 0x2a3f7a, bottom: 0x1d2433, shoes: 0x111111, cap: 0x1a2a55 },
    },
    // 道具：name 显示名称，icon HUD 图标，color 3D 颜色，duration 持续秒数
    powerUps: {
        magnet:   { name: '磁铁',     icon: '🧲', color: 0xff3344, duration: 10 },
        sneakers: { name: '弹跳鞋',   icon: '👟', color: 0x33dd66, duration: 10 },
        double:   { name: '双倍金币', icon: '✨', color: 0xb455ff, duration: 12 },
        shield:   { name: '护盾',     icon: '🛡️', color: 0x33aaff, duration: 15 },
        wings:    { name: '天使之翼', icon: '🕊️', color: 0xffffff, duration: 7 },
        // [PKVS] 双人对战专属·干扰道具。吃到不会加到自己身上：
        // 拾取循环里以 pk_ 前缀识别，交给接入层 __pkPickItem 立刻打对手
        pk_ink:    { name: '墨水弹',   icon: '🖋', color: 0x7a4bd0, duration: 0 },
        pk_slow:   { name: '粘液弹',   icon: '🧪', color: 0x36d97a, duration: 0 },
        pk_fog:    { name: '冷凝雾',   icon: '🌫', color: 0x9fc8e8, duration: 0 },
        pk_invert: { name: '反向符',   icon: '🔀', color: 0xff3f8a, duration: 0 },
        // 赛道上实际只刷这一种：盲盒。吃到才抽签（tools/vs-items.js 的 rollKind）
        pk_box:    { name: '盲盒',     icon: '❓', color: 0xffc84a, duration: 0 },
    },
    // maxMul：极限速度相对起始速度的封顶倍率。原本按 2.0 倍封顶，现压到 1.6 倍
    // （15 m/s -> 24 m/s）；到顶后由 TOP_SPEED 难度联动接管（障碍 / 迎面车变难）。
    // max 仍是绝对安全上限，防止以后调 factor 时失控。
    speed: { start: 15, max: 60, maxMul: 1.6, step: 1000, factor: 1.1 }, // 每 step 米速度 ×factor
    jump:  { velocity: 9.5, superVelocity: 14, gravity: 28 },
    flyHeight: 7,                                           // 飞行高度（火车顶是 3）
    // 飞行器（天使之翼）：起飞 → 巡航（可 ↑ 爬升 / ↓ 俯冲）→ 收翼降落 → 落地缓冲
    flight: {
        cruiseY: 7,        // 巡航高度
        takeoff: 0.55,     // 起飞上升时长 (s)
        land: 0.8,         // 收翼下降时长 (s)
        landPause: 0.22,   // 触地缓冲时长 (s)
        altRate: 3.4,      // 高度调整响应速度
        climbRange: 1.8,   // 按 ↑/空格 可再爬升的高度
        diveRange: 2.2,    // 按 ↓ 可压低的高度
        diveLand: 0.55,    // 压低到离地这么近就提前落地
        flare: 1.05,       // 剩余时间低于此值开始收翼降落
    },
    coinScore: 10,
    // 复活币的参数（概率 / 必出里程 / 无敌时长）见 GAME-DATA 段的 REVIVE_CFG
    // —— 放在纯数据区是为了让 Node 测试和游戏共用同一份数值
};

// =====================================================================
//  ② 加载 Three.js：优先本地文件（需本地服务器），否则走 CDN
// =====================================================================
async function loadThree() {
    return await import('three');
}

let THREE;
try {
    THREE = await loadThree();
} catch (e) {
    document.querySelector('#loading .sub').innerHTML =
        '3D 引擎加载失败。<br>需联网加载 3D 引擎（CDN）。';
    throw e;
}

// =====================================================================
//  ③ 常量与工具
// =====================================================================
const LANES = [-2.4, 0, 2.4];
const TRAIN_H = 3.0;        // 火车车顶高度
const SPAWN_DIST = 150;     // 前方多远开始生成物体
const SPAN = 324;           // 场景装饰循环长度
const ROLL_TIME = 0.65;
const RAMP_LEN = 10;

// ==== PATCH15-BEGIN（tools/patch15_gameplay.py 生成，勿手改）====
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
    // 飞行不豁免撞楼：翅膀能飞过矮障碍，但楼是实心的（穿模属于"违背物理"）
    if (S.state !== 'playing' || Scene.phase !== 'run') return false;
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

const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 共享资源打上标记，回收物体时不释放
const shared = x => { x.userData.shared = true; return x; };
const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts });

function disposeObj(obj) {
    if (obj.parent) obj.parent.remove(obj);
    obj.traverse(n => {
        if (!n.isMesh) return;
        if (!n.geometry.userData.shared) n.geometry.dispose();
        for (const m of [].concat(n.material)) {
            if (m.userData.shared) continue;
            if (m.map && !m.map.userData.shared) m.map.dispose();
            m.dispose();
        }
    });
}

// ---------- 金币银行 & 道具升级（localStorage 持久化） ----------
// 规则：本局拾取的金币在结算时入库；每件道具每升 1 级 +1 秒持续时间，
//       首次升级 500 金币，之后价格翻倍，最高 10 级。
const UPGRADE_CFG = { maxLevel: 10, baseCost: 500, costMul: 2, bonusPerLevel: 1 };
const SAVE_KEY = 'parkour3d_save_v1';
let SAVE = { bank: 0, up: {} };
try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
        if (Number.isFinite(+raw.bank) && +raw.bank >= 0) SAVE.bank = Math.floor(+raw.bank);
        if (raw.up && typeof raw.up === 'object') {
            for (const k in CONFIG.powerUps) {
                const lv = +raw.up[k];
                if (Number.isFinite(lv) && lv > 0) SAVE.up[k] = clamp(Math.floor(lv), 0, UPGRADE_CFG.maxLevel);
            }
        }
    }
} catch (e) {}
function persistSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (e) {} }
/** 当前等级 lv → 升到 lv+1 一级所需金币（500 / 1000 / 2000 …） */
const upCost = lv => Math.round(UPGRADE_CFG.baseCost * Math.pow(UPGRADE_CFG.costMul, lv));
/** 道具实际持续时间 = 基础时长 + 已升级级数 × 1 秒 */
const powerDur = type => CONFIG.powerUps[type].duration + (SAVE.up[type] || 0) * UPGRADE_CFG.bonusPerLevel;
/** 购买升级，返回 'ok' | 'poor'（金币不足）| 'max'（已满级） */
function tryBuyUpgrade(type) {
    const lv = SAVE.up[type] || 0;
    if (lv >= UPGRADE_CFG.maxLevel) return 'max';
    const cost = upCost(lv);
    if (SAVE.bank < cost) return 'poor';
    SAVE.bank -= cost;
    SAVE.up[type] = lv + 1;
    persistSave();
    return 'ok';
}
const fmtCoin = n => n.toLocaleString('en-US');

// =====================================================================
//  音量配置（纯数据 + 纯函数；Node 测试按 AUDIO-DATA 标记提取）
//  总音量 × 各通道音量。保安笑声(laugh)与背景音乐(music)是两条独立通道，互不影响
// =====================================================================
//  AUDIO-DATA-START
const AUDIO_DEFAULTS = { master: 0.8, sfx: 0.85, laugh: 0.8, music: 0.55, muted: false };
const AUDIO_CHANNELS = ['sfx', 'laugh', 'music'];
/** 某通道的最终线性增益（0~1）：静音时全 0；master 控制整体，通道音量各自独立 */
function audioChannelGain(cfg, ch) {
    const c01 = v => Math.max(0, Math.min(1, v));   // 自包含：不依赖外部 clamp
    if (!cfg || cfg.muted) return 0;
    const master = c01(typeof cfg.master === 'number' ? cfg.master : AUDIO_DEFAULTS.master);
    if (ch === 'master') return master;
    const own = typeof cfg[ch] === 'number' ? cfg[ch] : (AUDIO_DEFAULTS[ch] || 0);
    return c01(master * c01(own));
}
//  AUDIO-DATA-END

// ---------- 音效（WebAudio 合成 + 程序化 BGM，无需音频文件） ----------
// 音量分四条：总音量 master × [音效 sfx / 保安笑声 laugh / 背景音乐 music]
const AUDIO_KEY = 'parkour3d_audio_v1';
const AUDIO = Object.assign({}, AUDIO_DEFAULTS);
try {
    const raw = JSON.parse(localStorage.getItem(AUDIO_KEY) || 'null');
    if (raw && typeof raw === 'object') {
        for (const k of ['master', 'sfx', 'laugh', 'music']) {
            const v = +raw[k];
            if (Number.isFinite(v)) AUDIO[k] = Math.max(0, Math.min(1, v));
        }
        if (typeof raw.muted === 'boolean') AUDIO.muted = raw.muted;
    }
} catch (e) {}
function persistAudio() {
    try {
        localStorage.setItem(AUDIO_KEY, JSON.stringify({
            master: AUDIO.master, sfx: AUDIO.sfx, laugh: AUDIO.laugh, music: AUDIO.music, muted: AUDIO.muted,
        }));
    } catch (e) {}
}

let actx = null;
let masterGain = null, sfxGain = null, musicGain = null;   // 三条独立增益总线
function ensureGainGraph() {
    if (!actx || masterGain) return;
    try {
        masterGain = actx.createGain();
        sfxGain = actx.createGain();
        musicGain = actx.createGain();
        sfxGain.connect(masterGain);
        musicGain.connect(masterGain);
        masterGain.connect(actx.destination);
    } catch (e) { masterGain = null; }
}
function initAudio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    else if (actx.state === 'suspended') actx.resume();
    ensureGainGraph();
    applyAudioLevels();
}
/** 把 AUDIO 设置同步到各增益总线（滑块/静音实时生效） */
function applyAudioLevels() {
    // 记录最近一次实际应用的线性增益（AudioParam.gain.value 读不到 automation 值，诊断/测试用这个）
    AUDIO.applied = {
        master: audioChannelGain(AUDIO, 'master'),
        sfx: audioChannelGain(AUDIO, 'sfx'),
        music: audioChannelGain(AUDIO, 'music'),
        laugh: audioChannelGain(AUDIO, 'laugh'),
    };
    if (masterGain) {
        const t = actx.currentTime;
        // 音量突跳不会爆音；直接赋值保证静音/调节立刻生效
        masterGain.gain.setValueAtTime(AUDIO.applied.master, t);
        sfxGain.gain.setValueAtTime(AUDIO.applied.sfx, t);
        musicGain.gain.setValueAtTime(AUDIO.applied.music, t);
    }
    if (guardAudio) {
        const lg = Math.min(1, AUDIO.applied.laugh);
        guardAudio.volume = lg;
        // 音量降到 0 不保证立刻静音（部分编解码器），正在响的要 pause 掉
        if (lg <= 0.001) { try { guardAudio.pause(); guardAudio.currentTime = 0; } catch (e) {} }
    }
}
function tone(f1, f2, dur, type = 'sine', vol = 0.15) {
    if (!actx || !sfxGain) return;
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(sfxGain);
    o.start(t); o.stop(t + dur);
}

// ---------- 保安笑声（独立通道，单例复用避免叠音） ----------
let guardAudio = null;
function playGuardLaugh() {
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
}

// ---------- 背景音乐：程序化循环（零文件、可独立调音量） ----------
// Am-F-C-G 进行，8 分音符一步；低音三角波 + 和声垫 + 方波旋律 + 鼓
const BGM_CFG = { bpm: 116, gain: 1 };
const BGM_CHORDS = [
    { root: 55.00, notes: [220.00, 261.63, 329.63] },   // Am
    { root: 43.65, notes: [174.61, 220.00, 261.63] },   // F
    { root: 65.41, notes: [261.63, 329.63, 392.00] },   // C
    { root: 49.00, notes: [196.00, 246.94, 293.66] },   // G
];
// 每小节 8 步的旋律（0 = 留空），五声音阶为主，避免刺耳
const BGM_MELODY = [
    [440.00, 0, 523.25, 0, 659.25, 523.25, 0, 440.00],
    [349.23, 0, 440.00, 0, 523.25, 0, 440.00, 349.23],
    [523.25, 0, 659.25, 0, 783.99, 659.25, 523.25, 0],
    [493.88, 0, 587.33, 0, 493.88, 392.00, 0, 493.88],
];
let bgmTimer = null, bgmNextTime = 0, bgmStep = 0, bgmOn = false;

function bgmNote(freq, t, dur, type, vol) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol * BGM_CFG.gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(musicGain);
    o.start(t); o.stop(t + dur + 0.02);
}
function bgmKick(t) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.16 * BGM_CFG.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(musicGain);
    o.start(t); o.stop(t + 0.18);
}
function bgmHat(t) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(7200, t);
    g.gain.setValueAtTime(0.012 * BGM_CFG.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    o.connect(g).connect(musicGain);
    o.start(t); o.stop(t + 0.05);
}
/** 前瞻调度：每次排未来 0.25s 的音符，交给 WebAudio 精确时钟播放 */
function bgmTick() {
    if (!actx || !musicGain || !bgmOn) return;
    const spb = 60 / BGM_CFG.bpm / 2;          // 每步（8 分音符）秒数
    while (bgmNextTime < actx.currentTime + 0.25) {
        const t = bgmNextTime;
        const bar = Math.floor(bgmStep / 8) % BGM_CHORDS.length;
        const step = bgmStep % 8;
        const ch = BGM_CHORDS[bar];
        if (step % 2 === 0) bgmNote(ch.root, t, spb * 2.1, 'triangle', 0.20);   // 低音
        if (step === 0) for (const f of ch.notes) bgmNote(f, t, spb * 6.5, 'sine', 0.035);   // 和声垫
        const mel = BGM_MELODY[bar][step];
        if (mel) bgmNote(mel, t, spb * 1.5, 'square', 0.030);                   // 旋律
        if (step % 4 === 0) bgmKick(t);
        if (step % 2 === 1) bgmHat(t);
        bgmNextTime += spb;
        bgmStep++;
    }
}
function startBgm() {
    initAudio();
    if (!actx || !musicGain || bgmOn) return;
    bgmOn = true;
    bgmNextTime = actx.currentTime + 0.08;
    bgmStep = 0;
    if (!bgmTimer) bgmTimer = setInterval(bgmTick, 80);
    bgmTick();
}
function stopBgm() { bgmOn = false; }

const SFX = {
    guard:   () => playGuardLaugh(),
    coin:    () => tone(1300, 1900, 0.12, 'square', 0.04),
    jump:    () => tone(300, 650, 0.18, 'triangle', 0.12),
    roll:    () => tone(500, 180, 0.2, 'sawtooth', 0.05),
    power:   () => tone(500, 1600, 0.35, 'triangle', 0.12),
    stumble: () => tone(220, 90, 0.25, 'square', 0.1),
    crash:   () => tone(160, 40, 0.6, 'sawtooth', 0.2),
    shield:  () => tone(900, 300, 0.3, 'sine', 0.15),
    wings:   () => { tone(400, 1400, 0.5, 'sine', 0.15); setTimeout(() => tone(700, 2000, 0.4, 'triangle', 0.08), 120); },
};
const GUARD_BGM = "data:audio/mpeg;base64,OMITTED-05-0.06MB-see-INLINE-ASSETS-md";


// =====================================================================
//  ④ 渲染器 / 相机 / 灯光
// =====================================================================
// =====================================================================
