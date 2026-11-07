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
//  ③ 性能档位 —— 手机不是电脑，光影得能「减配」而不是硬开
//     · 三档 high / mid / low：默认按设备自动判定，?q=low 可强制，面板里也能手调
//     · 低档：关实时阴影（换成脚下一张投影贴片）、砍点光源、降采样、雨雾减量
//     · 运行中自适应：帧时超 20.5ms 就逐级降采样，稳住了再慢慢加回来
//  原则：视觉上「几乎看不出来」，但阴影 pass 和片元光照的开销能砍掉一大半
// =====================================================================
// ---- 降级阶梯 ------------------------------------------------------
// 手机端「不到 30 帧 + 画面很糊」的根因：原来的自适应**只会降分辨率**，
// 一路降到 0.68×/0.55×（实际像素比 0.85 / 0.55），画面糊了，帧率却上不去——
// 因为瓶颈不在像素数量，而在 GPU 侧的 overdraw / drawcall / 额外 pass。
// 所以每档都带一条阶梯：帧时超标时先砍「真正贵的东西」，分辨率放到最后，
// 而且手机档有 minPR 地板（1 CSS 像素 = 1 渲染像素），永远不会糊到看不清。
const QUALITY_PRESETS = {
    high: {   // 台式机 / 独显：保留原来的观感
        // ssMin：屏幕 dpr 低于它时也按这个比例渲染再缩回去（1.25× 超采样）。
        // 1080p 屏 dpr 常是 1，原来的 min(dpr,pr) 等于完全没超采样，边缘全是硬锯齿；
        // pr 从 1.5 提到 2.0 只是把高分屏的上限放开，低 dpi 屏靠 ssMin 吃到超采样。
        label: '高', pr: 2.0, ssMin: 1.25, aa: true,
        // 阴影 1024→2048：±20/±35 的正交框配 1024 时一个纹素约 4cm，脚底接触影是糊的；
        // 2048 落到 2cm。点光 3→4：城市霓虹与校园路灯多亮一盏。
        shadow: true, soft: true, shadowSize: 2048, shadowEvery: 1,
        cam: { l: -20, r: 20, t: 35, b: -35, far: 100 },
        pointLights: 4, rain: 1500, mist: 10, fpsCap: 0, minScale: 0.8, minPR: 0,
        steps: [
            { shadowEvery: 2 },
            { shadowSize: 1024, soft: false },
            { pointLights: 2, rain: 900 },
            { shadow: false, rain: 600, mist: 6 },
            { scale: 0.85 },                     // 桌面才允许拿分辨率换帧率
            { scale: 0.8 },                      // 1.25×0.8 = 1.0：最后一档退回原生分辨率
        ],
    },
    mid: {    // 主流手机 / 核显轻薄本
        // pr 锁 1.0 + minPR 1：分辨率不再参与自适应，只靠阶梯砍特性
        label: '中', pr: 1.0, aa: true,
        shadow: false, soft: false, shadowSize: 768, shadowEvery: 0,
        cam: { l: -15, r: 15, t: 25, b: -25, far: 76 },
        pointLights: 2, rain: 800, mist: 5, fpsCap: 60, minScale: 1, minPR: 1,
        steps: [
            { pointLights: 1, rain: 520 },       // ① 点光源 + 雨丝（雨是最大的 overdraw 源）
            { mist: 2, rain: 340 },              // ② 薄雾精灵（每个 sprite 一次 drawcall）
            { camFar: 58 },                      // ③ 缩短视距，远景直接不进渲染队列
        ],
    },
    low: {    // 入门机 / 老机型：关实时阴影，换投影贴片
        label: '低', pr: 1.0, aa: false,
        shadow: false, soft: false, shadowSize: 512, shadowEvery: 0,
        cam: { l: -13, r: 13, t: 20, b: -20, far: 62 },
        pointLights: 1, rain: 500, mist: 3, fpsCap: 60, minScale: 1, minPR: 1,
        steps: [
            { rain: 300, mist: 2 },
            { camFar: 52, pointLights: 0 },
        ],
    },
};
const QUALITY_ORDER = ['low', 'mid', 'high'];

function detectQualityTier() {
    const qs = new URLSearchParams(location.search);
    const asked = (qs.get('q') || '').toLowerCase();
    if (QUALITY_PRESETS[asked]) return asked;
    try {
        const saved = localStorage.getItem('huyifan.quality');
        if (QUALITY_PRESETS[saved]) return saved;
    } catch (e) { /* 隐私模式下 localStorage 会抛，忽略 */ }
    const ua = navigator.userAgent || '';
    const touch = (navigator.maxTouchPoints || 0) > 1;
    const small = Math.min(innerWidth || 800, innerHeight || 600) < 820;
    const phone = /Android|iPhone|iPad|iPod|Mobile|MicroMessenger|HarmonyOS|OpenHarmony/i.test(ua) ||
        (touch && small);
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    if (!phone) {
        // 桌面一律给高档：中档现在是「手机优先」配置（关实时阴影），不该套到桌面上。
        // 4K / 超宽屏若真跑不动，自适应会自己沿阶梯降下去。
        return 'high';
    }
    if (cores <= 4 || mem <= 3) return 'low';   // 入门机、老机型
    return 'mid';                                // 主流手机先中档，真卡了沿阶梯继续降
}

const QUALITY = {
    tier: detectQualityTier(),
    level: 0,          // 降级阶梯已走到第几级（0 = 满配）
    scale: 1,          // 自适应分辨率倍率（手机档被 minPR 夹住，实际恒为 1）
    ms: 16.7,          // 帧时滑动均值
    win: 0,            // 当前统计窗口累计毫秒
    good: 0,           // 连续「够快」的窗口数
    hz: 0,             // 实测刷新率（0 = 还没测出来）
    adaptive: true,    // 基准测试时可关掉，避免测量过程被自动降采样污染
};
// 当前生效参数 = 基础档位 + 已降到的阶梯级
// （阶梯只覆盖部分字段；camFar 是便捷写法，折进 cam.far）
function QP() {
    const base = QUALITY_PRESETS[QUALITY.tier];
    const steps = base.steps || [];
    if (!QUALITY.level) return base;
    const q = Object.assign({}, base, { cam: Object.assign({}, base.cam) });
    for (let i = 0; i < QUALITY.level && i < steps.length; i++) {
        Object.assign(q, steps[i]);
        if (steps[i].camFar != null) q.cam.far = steps[i].camFar;
    }
    return q;
}

// ---- 分辨率：基础像素比 × 自适应倍率，受 minPR 地板夹住 --------------
function applyResolution() {
    const dpr = window.devicePixelRatio || 1;
    const q = QP();
    // ssMin：低 dpr 屏（1080p 笔记本、多数 Windows 100% 缩放）用超采样换清晰度；
    // 高分屏本来就 ≥1.25，走 min(ssBase, pr) 不会重复放大。
    const ssBase = q.ssMin ? Math.max(dpr, q.ssMin) : dpr;
    const base = Math.min(ssBase, q.pr);
    // minPR = 分辨率地板（手机档为 1：1 CSS 像素 = 1 渲染像素，再低就明显糊）
    const floor = q.minPR != null ? q.minPR : 0.5;
    renderer.setPixelRatio(Math.max(floor, 0.5, base * QUALITY.scale));
}

// ---- 点光源裁剪：超预算的灯直接 invisible（不进 shader 的灯光循环）----
// 顺序按 userData.plOrder 排；qOff 的灯（比如非赛博街区的霓虹）永远排最后
function trimPointLights() {
    const budget = QP().pointLights;
    const list = [];
    scene.traverse(o => { if (o.isPointLight) list.push(o); });
    if (!list.length) return 0;
    list.sort((a, b) => {
        const ra = (a.userData.qOff ? 1e6 : 0) + (a.userData.plOrder || 0);
        const rb = (b.userData.qOff ? 1e6 : 0) + (b.userData.plOrder || 0);
        return ra - rb;
    });
    let on = 0;
    for (let i = 0; i < list.length; i++) {
        const keep = i < budget;
        if (list[i].visible !== keep) list[i].visible = keep;
        if (keep) on++;
    }
    return on;
}

// ---- 小摆件不投影：锥桶/芦苇/反光条投影几乎看不见，却要占一次 shadow pass ----
function trimShadowCasters(root) {
    if (!root) return 0;
    let cut = 0;
    root.traverse(o => {
        if (!o.isMesh || !o.castShadow || o.userData.__sTrim) return;
        o.userData.__sTrim = true;
        const g = o.geometry;
        if (!g) return;
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (!g.boundingSphere) return;
        const sc = Math.max(Math.abs(o.scale.x), Math.abs(o.scale.y), Math.abs(o.scale.z)) || 1;
        if (g.boundingSphere.radius * sc < 0.9) { o.castShadow = false; cut++; }
    });
    return cut;
}

// ---- 脚下投影贴片：低档关掉实时阴影后，用它保住「站在地上」的实感 ----
const BlobShadow = {
    mesh: null,
    ensure() {
        if (this.mesh) return this.mesh;
        const cv = document.createElement('canvas');
        cv.width = cv.height = 128;
        const c = cv.getContext('2d');
        const grd = c.createRadialGradient(64, 64, 2, 64, 64, 63);
        grd.addColorStop(0, 'rgba(0,0,0,0.62)');
        grd.addColorStop(0.45, 'rgba(0,0,0,0.38)');
        grd.addColorStop(0.78, 'rgba(0,0,0,0.10)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = grd;
        c.fillRect(0, 0, 128, 128);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const m = new THREE.Mesh(
            new THREE.PlaneGeometry(2.1, 2.1),
            new THREE.MeshBasicMaterial({
                map: tex, transparent: true, opacity: 0.85,
                depthWrite: false, depthTest: true, fog: false,
            })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.022;
        m.renderOrder = 3;
        m.frustumCulled = false;
        scene.add(m);
        this.mesh = m;
        return m;
    },
};
function updateBlobShadow() {
    const need = !QP().shadow;
    if (!need) { if (BlobShadow.mesh) BlobShadow.mesh.visible = false; return; }
    const m = BlobShadow.ensure();
    m.visible = S.state === 'playing' || S.state === 'dying';
    m.position.x = S.x || 0;
    const y = S.y || 0;
    const k = Math.max(0, Math.min(1, 1 - y * 0.16));   // 跳/飞越高，影子越淡越小
    m.scale.setScalar(0.78 + 0.3 * k);
    m.material.opacity = 0.88 * k;
}

// ---- 统一的档位下发 --------------------------------------------------
function applyQualityOptions() {
    const q = QP();
    // 阴影
    renderer.shadowMap.enabled = q.shadow;
    renderer.shadowMap.type = q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;       // 手动节流，见主循环
    renderer.shadowMap.needsUpdate = true;
    if (sun) {
        sun.castShadow = q.shadow;
        if (sun.shadow) {
            if (sun.shadow.mapSize.x !== q.shadowSize) {
                sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
                if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
            }
            Object.assign(sun.shadow.camera, {
                left: q.cam.l, right: q.cam.r, top: q.cam.t, bottom: q.cam.b,
                near: 1, far: q.cam.far,
            });
            sun.shadow.camera.updateProjectionMatrix();
        }
    }
    applyResolution();
    trimPointLights();
    if (atmoRef) atmoRef.setQuality(q);
    // 注意：这里不能调 updateBlobShadow()——启动阶段状态对象 S 还没初始化（TDZ）。
    // 贴片的位置/缩放交给主循环每帧更新，这里只决定它该不该出现
    if (BlobShadow.mesh) BlobShadow.mesh.visible = !q.shadow;
}

let atmoRef = null;
function attachAtmo(a) { atmoRef = a; if (a) a.setQuality(QP()); }

function setQuality(tier) {
    if (!QUALITY_PRESETS[tier]) return QUALITY.tier;
    QUALITY.tier = tier;
    QUALITY.scale = 1;
    QUALITY.level = 0;
    QUALITY.ms = 16.7; QUALITY.win = 0; QUALITY.good = 0;
    try { localStorage.setItem('huyifan.quality', tier); } catch (e) { }
    applyQualityOptions();
    if (typeof refreshQualityUI === 'function') refreshQualityUI();
    return tier;
}

// ---- 帧时监控 + 自适应分辨率 ----------------------------------------
const PERF = {
    shadowTick: 0,
    _hzSamples: [],
    frameCap() {
        // 高刷屏限帧要贴着刷新率的整数分之一，否则会抖（90Hz 限到 45 比不限还难看）
        // 120Hz→60fps、144Hz→72fps、240Hz→60fps；60Hz 屏不用管
        const hz = QUALITY.hz;
        if (hz < 88 || QP().fpsCap === 0) return 0;
        const div = Math.max(1, Math.floor(hz / 60));
        return div > 1 ? hz / div : 0;
    },
    tick(raw) {
        const ms = raw * 1000;
        if (!(ms > 0)) return;
        // 卡到 200ms 以上的（切场景/编译着色器）不该把均值一下子拖爆，截一下
        QUALITY.ms = QUALITY.ms * 0.9 + Math.min(ms, 120) * 0.1;

        // 前 60 个正常帧估一下屏幕刷新率（只用来决定要不要限帧）
        if (QUALITY.hz === 0 && ms < 34) {
            this._hzSamples.push(ms);
            if (this._hzSamples.length >= 60) {
                const a = this._hzSamples.slice().sort((x, y) => x - y);
                const med = a[a.length >> 1];
                if (med > 0) QUALITY.hz = Math.round(1000 / med);
                this._hzSamples.length = 0;
            }
        }
        if (!QUALITY.adaptive) return;

        QUALITY.win += ms;
        if (QUALITY.win < 900) return;              // 每 ~0.9 秒判一次
        QUALITY.win = 0;
        const steps = QUALITY_PRESETS[QUALITY.tier].steps || [];
        if (QUALITY.ms > 20.5) {
            QUALITY.good = 0;
            if (QUALITY.level < steps.length) {
                // 先走阶梯：砍特性（点光/雨/雾/视距/阴影），这些才是 GPU 上真贵的
                QUALITY.level++;
                applyQualityOptions();
            } else if (QUALITY.scale > QP().minScale) {
                // 阶梯走完了才动分辨率（手机档 minPR 会把它夹在 1，实际不会糊）
                QUALITY.scale = Math.max(QP().minScale, QUALITY.scale - 0.1);
                applyResolution();
            }
        } else if (QUALITY.ms < 14.2) {
            // 稳住了：连着 3 个窗口都够快才往回加，避免来回抖
            if (++QUALITY.good >= 3) {
                QUALITY.good = 0;
                if (QUALITY.scale < 1) {
                    QUALITY.scale = Math.min(1, QUALITY.scale + 0.06);
                    applyResolution();
                } else if (QUALITY.level > 0) {
                    QUALITY.level--;                // 先把特性加回来
                    applyQualityOptions();
                }
            }
        } else {
            QUALITY.good = 0;
        }
    },
};

const renderer = new THREE.WebGLRenderer({
    antialias: QP().aa,              // 低档关 MSAA：手机上是实打实的带宽开销
    powerPreference: 'high-performance',
    stencil: false,                  // 用不到模板缓冲，省一份附件
});
renderer.setPixelRatio(1);            // 真实像素比在 applyResolution() 里按档位给
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = QP().shadow;
renderer.shadowMap.type = QP().soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;   // 手动节流：影子不必每帧重算
renderer.shadowMap.needsUpdate = true;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x8fd3ff, 70, 190);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 230);   // far 收到雾的尽头外，视锥剔除掉看不见的远景
function onResize() {
    camera.aspect = innerWidth / innerHeight;
    camera.fov = camera.aspect < 1 ? 78 : 62;   // 竖屏时视野放宽，三条道都能看到
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    applyResolution();          // 横竖屏切换后像素比要重算
}
addEventListener('resize', onResize);
onResize();

const hemi = new THREE.HemisphereLight(0xffffff, 0x6b7a8f, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(10, 25, 12);
sun.target.position.set(0, 0, -10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);                    // 默认值，实际按画质档位覆盖
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 35, bottom: -35, near: 1, far: 100 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0006;                              // 低分辨率下抑制自阴影条纹
scene.add(sun, sun.target);
applyQualityOptions();   // 阴影尺寸/视锥/点光/像素比，一次性对齐当前档位

// ---- ④b 昼夜循环 / 天气（雨、薄雾、星空）：实现见 js/atmo.js ----
// ---- 内联模块：js/atmo.js（昼夜/天气） ----
// =====================================================================
//  js/atmo.js —— 昼夜循环 + 天气（雨 / 薄雾 / 星空）
//  · 天空穹顶（渐变着色器）+ 星空 + 日月 + 云
//  · 太阳/半球光随时段插值，雾距随天气压缩
//  · 雨丝粒子 / 薄雾精灵 / 湿地面（粗糙度联动）
//  · 提供给旧城模块注册「霓虹发光」与「湿地面」材质
//  只依赖外部传入的 THREE / scene / camera / hemi / sun，不改主模块状态
// =====================================================================
function createAtmo({ THREE, scene, camera, hemi, sun }) {
    const TAU = Math.PI * 2;
    const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
    const smooth = t => t * t * (3 - 2 * t);

    // ---------------------------------------------------------------
    //  贴图（自建，不走主模块的 makeTex，避免耦合）
    // ---------------------------------------------------------------
    function tex(w, h, draw) {
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        draw(cv.getContext('2d'), w, h);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        return t;
    }
    // 柔和光斑（日月 / 灯笼光晕 / 薄雾）
    const softTex = tex(128, 128, (c, w, h) => {
        const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    // 日月本体（实心圆 + 边缘柔化）
    const discTex = tex(128, 128, (c, w, h) => {
        const g = c.createRadialGradient(w / 2, h / 2, w * 0.12, w / 2, h / 2, w * 0.36);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.72, 'rgba(255,255,255,1)');
        g.addColorStop(0.9, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.beginPath(); c.arc(w / 2, h / 2, w * 0.36, 0, TAU); c.fill();
    });
    // 雨丝
    const rainTex = tex(32, 64, (c, w, h) => {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(190,215,255,0)');
        g.addColorStop(0.35, 'rgba(200,225,255,0.55)');
        g.addColorStop(0.8, 'rgba(225,240,255,0.38)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(w * 0.47, 0, w * 0.06, h);
        c.globalAlpha = 0.35;
        c.fillStyle = g;
        c.fillRect(w * 0.45, 0, w * 0.1, h);
    });
    // 云
    const cloudTex = tex(256, 128, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        for (let i = 0; i < 16; i++) {
            const x = w * (0.15 + Math.random() * 0.7);
            const y = h * (0.35 + Math.random() * 0.35);
            const r = h * (0.18 + Math.random() * 0.22);
            const g = c.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, 'rgba(255,255,255,0.5)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            c.fillStyle = g;
            c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
        }
    });

    // ---------------------------------------------------------------
    //  天空关键帧：清晨 → 正午 → 黄昏 → 深夜 → 拂晓
    // ---------------------------------------------------------------
    const RAW = [
        { t: 0.00, top: 0x14203a, mid: 0x5d5470, bot: 0xffab6b, sunC: 0xffb075, sunI: 0.35, hs: 0x9fb0cc, hg: 0x3b342c, hi: 0.50, fog: 0xd6ad8e, fn: 46, ff: 175, night: 0.55, star: 0.28, cloud: 0x8d7f88, haze: 0.85, name: '黎明' },
        { t: 0.10, top: 0x2f5f9c, mid: 0x8fb6d8, bot: 0xf7cf9c, sunC: 0xffe2b4, sunI: 1.15, hs: 0xd9e6f5, hg: 0x4d4a42, hi: 0.72, fog: 0xcfe0ea, fn: 70, ff: 215, night: 0.20, star: 0.05, cloud: 0xd8dbe2, haze: 0.45, name: '清晨' },
        { t: 0.24, top: 0x2b74c8, mid: 0x77b6e6, bot: 0xd8ecf7, sunC: 0xffffff, sunI: 1.80, hs: 0xffffff, hg: 0x6d7480, hi: 1.10, fog: 0xbfe0f2, fn: 95, ff: 240, night: 0.00, star: 0.00, cloud: 0xffffff, haze: 0.20, name: '正午' },
        { t: 0.36, top: 0x3574bd, mid: 0x8db8d8, bot: 0xf1dfb6, sunC: 0xfff0c8, sunI: 1.55, hs: 0xf6ecdc, hg: 0x6a604f, hi: 0.98, fog: 0xdde6e8, fn: 90, ff: 230, night: 0.06, star: 0.00, cloud: 0xf2ede4, haze: 0.32, name: '午后' },
        { t: 0.48, top: 0x2b3a63, mid: 0x8a5d7a, bot: 0xff9a52, sunC: 0xff8a45, sunI: 1.05, hs: 0xc7a79a, hg: 0x4a3a34, hi: 0.66, fog: 0xd39a78, fn: 80, ff: 200, night: 0.42, star: 0.08, cloud: 0xb58a86, haze: 0.95, name: '黄昏' },
        { t: 0.56, top: 0x141a33, mid: 0x50284a, bot: 0xd4573c, sunC: 0xff5a32, sunI: 0.42, hs: 0x8a6a80, hg: 0x2a2228, hi: 0.56, fog: 0x7b4a4a, fn: 60, ff: 175, night: 0.72, star: 0.32, cloud: 0x6a4a52, haze: 0.85, name: '入夜' },
        { t: 0.66, top: 0x050a18, mid: 0x101a33, bot: 0x1b2748, sunC: 0x7a9ae0, sunI: 0.26, hs: 0x3a4a70, hg: 0x14171e, hi: 0.50, fog: 0x16203a, fn: 50, ff: 165, night: 1.00, star: 0.95, cloud: 0x232b40, haze: 0.30, name: '深夜' },
        { t: 0.82, top: 0x040814, mid: 0x0c1528, bot: 0x16213c, sunC: 0x7a9ae0, sunI: 0.24, hs: 0x35456a, hg: 0x11141a, hi: 0.46, fog: 0x121a30, fn: 46, ff: 155, night: 1.00, star: 1.00, cloud: 0x1e2536, haze: 0.25, name: '凌晨' },
        { t: 0.93, top: 0x0b1730, mid: 0x2c3550, bot: 0x8a6a6a, sunC: 0xa08098, sunI: 0.30, hs: 0x6a7898, hg: 0x24211f, hi: 0.40, fog: 0x4a4a5a, fn: 48, ff: 160, night: 0.80, star: 0.50, cloud: 0x4a4a58, haze: 0.60, name: '拂晓' },
        { t: 1.00, top: 0x14203a, mid: 0x5d5470, bot: 0xffab6b, sunC: 0xffb075, sunI: 0.35, hs: 0x9fb0cc, hg: 0x3b342c, hi: 0.50, fog: 0xd6ad8e, fn: 46, ff: 175, night: 0.55, star: 0.28, cloud: 0x8d7f88, haze: 0.85, name: '黎明' },
    ];
    const KEYS = RAW.map(k => ({
        ...k,
        topC: new THREE.Color(k.top), midC: new THREE.Color(k.mid), botC: new THREE.Color(k.bot),
        sunColor: new THREE.Color(k.sunC), hsky: new THREE.Color(k.hs), hgnd: new THREE.Color(k.hg),
        fogC: new THREE.Color(k.fog), cloudC: new THREE.Color(k.cloud),
    }));

    // 采样缓冲（避免每帧分配）
    const S = {
        top: new THREE.Color(), mid: new THREE.Color(), bot: new THREE.Color(),
        sunC: new THREE.Color(), hs: new THREE.Color(), hg: new THREE.Color(),
        fog: new THREE.Color(), cloud: new THREE.Color(),
        sunI: 1, hi: 1, fn: 80, ff: 200, night: 0, star: 0, haze: 0.5, name: '清晨',
    };
    function sample(t) {
        let i = 0;
        while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
        const a = KEYS[i], b = KEYS[i + 1];
        const u = smooth(clamp01((t - a.t) / Math.max(1e-4, b.t - a.t)));
        S.top.copy(a.topC).lerp(b.topC, u);
        S.mid.copy(a.midC).lerp(b.midC, u);
        S.bot.copy(a.botC).lerp(b.botC, u);
        S.sunC.copy(a.sunColor).lerp(b.sunColor, u);
        S.hs.copy(a.hsky).lerp(b.hsky, u);
        S.hg.copy(a.hgnd).lerp(b.hgnd, u);
        S.fog.copy(a.fogC).lerp(b.fogC, u);
        S.cloud.copy(a.cloudC).lerp(b.cloudC, u);
        S.sunI = lerp(a.sunI, b.sunI, u);
        S.hi = lerp(a.hi, b.hi, u);
        S.fn = lerp(a.fn, b.fn, u);
        S.ff = lerp(a.ff, b.ff, u);
        S.night = lerp(a.night, b.night, u);
        S.star = lerp(a.star, b.star, u);
        S.haze = lerp(a.haze, b.haze, u);
        S.name = u < 0.5 ? a.name : b.name;
        return S;
    }

    // ---------------------------------------------------------------
    //  天空穹顶
    // ---------------------------------------------------------------
    const skyGroup = new THREE.Group();
    skyGroup.userData.noMerge = true;
    scene.add(skyGroup);

    const skyUniforms = {
        uTop: { value: new THREE.Color(0x2b74c8) },
        uMid: { value: new THREE.Color(0x77b6e6) },
        uBot: { value: new THREE.Color(0xd8ecf7) },
        uHaze: { value: 0.3 },
    };
    const skyMat = new THREE.ShaderMaterial({
        uniforms: skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        vertexShader: /* glsl */`
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; uniform float uHaze;
            varying vec3 vDir;
            void main() {
                float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
                vec3 c = mix(uBot, uMid, smoothstep(0.42, 0.56, h));
                c = mix(c, uTop, smoothstep(0.54, 0.98, h));
                float band = exp(-abs(vDir.y) * 6.0);
                c += uHaze * band * vec3(0.22, 0.13, 0.06);
                gl_FragColor = vec4(c, 1.0);
                #include <colorspace_fragment>
            }
        `,
    });
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(200, 28, 18), skyMat);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -1000;
    skyGroup.add(skyMesh);

    // 星空（两层：小星点 + 大亮星）
    function makeStars(count, size, bright) {
        const pos = new Float32Array(count * 3);
        const col = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const a = Math.random() * TAU;
            const y = 0.06 + Math.random() * 0.94;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            pos[i * 3] = Math.cos(a) * r * 182;
            pos[i * 3 + 1] = y * 182;
            pos[i * 3 + 2] = Math.sin(a) * r * 182;
            const tint = Math.random();
            const c = tint < 0.15 ? [1, 0.9, 0.75] : tint < 0.4 ? [0.8, 0.88, 1] : [1, 1, 1];
            col[i * 3] = c[0] * bright; col[i * 3 + 1] = c[1] * bright; col[i * 3 + 2] = c[2] * bright;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const m = new THREE.PointsMaterial({
            size, sizeAttenuation: false, transparent: true, opacity: 0,
            vertexColors: true, depthWrite: false, fog: false,
        });
        const p = new THREE.Points(g, m);
        p.frustumCulled = false;
        p.renderOrder = -900;
        return p;
    }
    const starsSmall = makeStars(900, 1.7, 0.9);
    const starsBig = makeStars(140, 3.1, 1.0);
    skyGroup.add(starsSmall, starsBig);

    // 日 / 月
    const sunGlowMat = new THREE.SpriteMaterial({ map: softTex, color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 });
    const sunDiscMat = new THREE.SpriteMaterial({ map: discTex, color: 0xffffff, transparent: true, depthWrite: false, fog: false, opacity: 0 });
    const sunGlow = new THREE.Sprite(sunGlowMat);
    const sunDisc = new THREE.Sprite(sunDiscMat);
    sunGlow.scale.setScalar(74);
    sunDisc.scale.setScalar(17);
    sunGlow.renderOrder = -880; sunDisc.renderOrder = -879;
    skyGroup.add(sunGlow, sunDisc);

    const moonGlowMat = new THREE.SpriteMaterial({ map: softTex, color: 0xbcd0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 });
    const moonDiscMat = new THREE.SpriteMaterial({ map: discTex, color: 0xdfe8ff, transparent: true, depthWrite: false, fog: false, opacity: 0 });
    // ---- 月相：把"被太阳照亮的那部分"逐像素算出来 ----
    // 圆盘内每点 (dx,dy)，明暗界线是一段投影成椭圆的圆弧：dx = ±cos(2πp)·√(1-dy²)
    const moonPhaseCv = document.createElement('canvas');
    moonPhaseCv.width = moonPhaseCv.height = 96;
    const moonPhaseTex = new THREE.CanvasTexture(moonPhaseCv);
    moonPhaseTex.colorSpace = THREE.SRGBColorSpace;
    let moonPhaseLast = -1;
    function drawMoonPhase(p) {
        const S2 = 96, ctx = moonPhaseCv.getContext('2d');
        const img = ctx.createImageData(S2, S2);
        const R = S2 * 0.47, cx = S2 / 2, cy = S2 / 2;
        const k = Math.cos(p * TAU);
        const waxing = p <= 0.5;
        for (let y = 0; y < S2; y++) {
            for (let x = 0; x < S2; x++) {
                const dx = (x + 0.5 - cx) / R, dy = (y + 0.5 - cy) / R;
                const r2 = dx * dx + dy * dy;
                const i = (y * S2 + x) * 4;
                if (r2 > 1.02) { img.data[i + 3] = 0; continue; }
                const yt = Math.sqrt(Math.max(0, 1 - dy * dy));
                const lit = waxing ? (dx > k * yt) : (dx < -k * yt);
                const soft = Math.max(0, Math.min(1, (1.02 - r2) / 0.12));
                img.data[i] = lit ? 255 : 26;
                img.data[i + 1] = lit ? 250 : 30;
                img.data[i + 2] = lit ? 232 : 44;
                img.data[i + 3] = Math.round(255 * soft * (lit ? 1 : 0.10));
            }
        }
        ctx.putImageData(img, 0, 0);
        moonPhaseTex.needsUpdate = true;
        moonDiscMat.map = moonPhaseTex;
        moonDiscMat.needsUpdate = true;
    }
    drawMoonPhase(0.5);
    moonDiscMat.map = moonPhaseTex;

    const moonGlow = new THREE.Sprite(moonGlowMat);
    const moonDisc = new THREE.Sprite(moonDiscMat);
    moonGlow.scale.setScalar(72);
    moonDisc.scale.setScalar(19);
    skyGroup.add(moonGlow, moonDisc);

    // ---- 太阳光芒：一张放射状软光贴图，晴天旋着微微发亮 ----
    const rayTex = tex(256, 256, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(255,250,225,0.95)');
        g.addColorStop(0.22, 'rgba(255,238,190,0.55)');
        g.addColorStop(0.55, 'rgba(255,228,160,0.16)');
        g.addColorStop(1, 'rgba(255,220,150,0)');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
        c.translate(w / 2, h / 2);
        for (let i = 0; i < 14; i++) {          // 14 道长短不一的光刺
            const a = (i / 14) * TAU + 0.2;
            const len = w * (0.30 + (i % 3) * 0.09);
            c.save();
            c.rotate(a);
            const lg = c.createLinearGradient(0, 0, len, 0);
            lg.addColorStop(0, 'rgba(255,245,205,0.42)');
            lg.addColorStop(1, 'rgba(255,240,190,0)');
            c.fillStyle = lg;
            c.beginPath();
            c.moveTo(0, -w * 0.012); c.lineTo(len, 0); c.lineTo(0, w * 0.012);
            c.closePath(); c.fill();
            c.restore();
        }
    });
    const sunRayMat = new THREE.SpriteMaterial({
        map: rayTex, color: 0xfff0c8, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false, opacity: 0,
    });
    const sunRays = new THREE.Sprite(sunRayMat);
    sunRays.scale.setScalar(150);
    sunRays.renderOrder = -882;
    skyGroup.add(sunRays);

    // 云
    const clouds = [];
    for (let i = 0; i < 8; i++) {
        const m = new THREE.SpriteMaterial({
            map: cloudTex, color: 0xffffff, transparent: true, opacity: 0.3,
            depthWrite: false, fog: false,
        });
        const s = new THREE.Sprite(m);
        const a = (i / 8) * TAU + Math.random() * 0.5;
        s.position.set(Math.cos(a) * 150, 34 + Math.random() * 46, Math.sin(a) * 150);
        s.scale.set(90 + Math.random() * 60, 34 + Math.random() * 20, 1);
        s.userData.drift = 0.004 + Math.random() * 0.004;
        s.userData.baseOp = 0.26 + Math.random() * 0.2;
        clouds.push(s);
        skyGroup.add(s);
    }

    // ---------------------------------------------------------------
    //  雨
    // ---------------------------------------------------------------
    const RAIN_MAX = 1500;
    const rainPos = new Float32Array(RAIN_MAX * 3);
    const rainSpd = new Float32Array(RAIN_MAX);
    for (let i = 0; i < RAIN_MAX; i++) {
        rainPos[i * 3] = (Math.random() - 0.5) * 62;
        rainPos[i * 3 + 1] = Math.random() * 20;
        rainPos[i * 3 + 2] = -6 + (Math.random() - 0.5) * 58;
        rainSpd[i] = 15 + Math.random() * 13;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    const rainMat = new THREE.PointsMaterial({
        map: rainTex, color: 0xbfd4ee, size: 1.25, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    });
    const rainPts = new THREE.Points(rainGeo, rainMat);
    rainPts.frustumCulled = false;
    rainPts.visible = false;
    scene.add(rainPts);

    // ---------------------------------------------------------------
    //  薄雾（贴近地面的柔和精灵）
    // ---------------------------------------------------------------
    const mistGroup = new THREE.Group();
    mistGroup.userData.noMerge = true;
    scene.add(mistGroup);
    const mistMat = new THREE.SpriteMaterial({
        map: softTex, color: 0xd8e6f2, transparent: true, opacity: 0,
        depthWrite: false, fog: false,
    });
    for (let i = 0; i < 10; i++) {
        const s = new THREE.Sprite(mistMat);
        s.position.set((Math.random() - 0.5) * 46, 0.6 + Math.random() * 2.4, -4 - Math.random() * 40);
        s.scale.set(26 + Math.random() * 20, 5 + Math.random() * 3.5, 1);
        s.userData.ph = Math.random() * TAU;
        s.userData.x0 = s.position.x;
        s.userData.z0 = s.position.z;
        mistGroup.add(s);
    }
    mistGroup.visible = false;

    // ---------------------------------------------------------------
    //  玩家跟随补光（让人物在夜景/雨雾里不糊成一团黑）
    // ---------------------------------------------------------------
    const playerLamp = new THREE.PointLight(0xffd7a8, 0, 15, 2);
    playerLamp.position.set(0, 2.4, 2);
    playerLamp.userData.plOrder = 0;          // 优先级最高：人物补光，永远留
    scene.add(playerLamp);
    let playerRoot = null;
    let qRainCap = RAIN_MAX, qMistCap = 10;   // 由性能档位下发

    // 街道霓虹洗墙光：两盏跟随玩家的低价点光，让老墙在夜里也有颜色层次
    const streetLights = [
        { light: new THREE.PointLight(0x39e6ff, 0, 17, 2), x: -5.4 },
        { light: new THREE.PointLight(0xff3ba0, 0, 17, 2), x: 5.4 },
    ];
    streetLights.forEach((s, i) => {
        s.light.position.set(s.x, 4.2, 0);
        s.light.userData.plOrder = 1 + i;      // 只在赛博街区点亮，其它场景 qOff
        scene.add(s.light);
    });

    // ---------------------------------------------------------------
    //  霓虹 / 湿地面 注册表
    // ---------------------------------------------------------------
    const glowList = [];
    const wetList = [];
    function registerGlow(mat, opt = {}) {
        if (!mat || mat.userData.__glow) return mat;
        mat.userData.__glow = true;
        const kind = opt.kind || 'std';
        glowList.push({
            mat, kind,
            base: opt.base != null ? opt.base : (kind === 'add' ? 0.06 : 0.6),
            gain: opt.gain != null ? opt.gain : (kind === 'add' ? 0.6 : 1.2),
            c0: kind === 'basic' ? mat.color.clone() : null,
        });
        return mat;
    }
    function registerWet(mats) {
        for (const m of [].concat(mats)) {
            if (!m || m.userData.__wet) continue;
            m.userData.__wet = true;
            wetList.push({ mat: m, r: m.roughness != null ? m.roughness : 0.8, metal: m.metalness != null ? m.metalness : 0 });
        }
    }

    // ---------------------------------------------------------------
    //  HUD 标签（时段 · 天气）
    // ---------------------------------------------------------------
    let hudEl = null;
    const host = document.querySelector('#hud .small');
    if (host) {
        hudEl = document.createElement('div');
        hudEl.id = 'hudWx';
        hudEl.style.cssText = 'color:#6ff0ff;text-shadow:0 0 6px rgba(60,220,255,.65)';
        host.appendChild(hudEl);
    }

    // ---------------------------------------------------------------
    //  状态
    // ---------------------------------------------------------------
    // 天气节拍：除薄雾外，其余天气一律按里程走，每 5000 米切一次
    // （2026-11-06：切换间隔由 2500 米翻倍到 5000 米；薄雾的持续/间隔、雨的强度与过渡都不动）
    // 薄雾不在这套节拍里——它有自己的进出计时器，节奏和表现都保持不变
    const WX_DIST = 5000;
    const st = {
        t: 0.02, cycle: 190, indoor: false, shelter: false, id: '', sceneName: '湖畔轨道',
        lunar: 0.42,                                      // 朔望月相位：0 朔 / 0.5 望
        weather: 'clear', manual: false, seqIdx: 0,
        seg: 0, lastDist: 0,                              // 里程节拍：第几段 / 上一帧里程
        mistTimer: 90 + Math.random() * 80, mistLeft: 0,  // 薄雾自己的进出计时（不吃里程节拍）
        rain: 0, mist: 0, paused: false, label: '',
    };
    const WX = {
        clear: { rain: 0, mist: 0 },
        rain: { rain: 1, mist: 0 },   // 雨和薄雾互斥：下雨时雾目标恒为 0
        mist: { rain: 0, mist: 1 },
    };

    // URL 参数：?t=0.5&wx=rain
    const qs = new URLSearchParams(location.search);
    if (qs.has('t')) { const v = parseFloat(qs.get('t')); if (isFinite(v)) st.t = ((v % 1) + 1) % 1; }
    if (qs.has('wx') && WX[qs.get('wx')]) { st.weather = qs.get('wx'); st.manual = true; }
    if (st.manual) { st.rain = WX[st.weather].rain; st.mist = WX[st.weather].mist; }

    // 薄雾间隔：城市街区「少雾」（概率减半 = 平均间隔翻倍），其它场景不变
    function mistDelay() {
        return st.id === 'city'
            ? 180 + Math.random() * 160     // 平均 260 秒一次
            : 90 + Math.random() * 80;      // 平均 130 秒一次
    }

    function setWeather(kind, manual = true) {
        if (!WX[kind]) return;
        // 城市街区「少雨」：里程节拍轮到的「雨」有一半概率直接改判成晴。
        // 只拦自动节拍（manual=false），?wx=rain 这种手动指定不受影响。
        if (!manual && kind === 'rain' && st.id === 'city' && Math.random() < 0.5) kind = 'clear';
        st.weather = kind;
        st.manual = manual;
    }
    function setTime(t) { st.t = ((t % 1) + 1) % 1; }

    // 里程节拍用的天气序列：只有晴 / 雨，薄雾不在里面
    const WX_SEQ = ['clear', 'rain', 'clear', 'rain', 'clear'];
    const MIST_LIFE = [10, 18];          // 薄雾一次持续多久（秒）

    function advanceWeather(dt, dist) {
        if (st.manual) return;

        // ① 薄雾：自己计时进出，不吃里程节拍，也不会被 5000 米那一刀砍断
        if (st.weather === 'mist') {
            st.mistLeft -= dt;
            if (st.mistLeft <= 0) setWeather(WX_SEQ[st.seqIdx % WX_SEQ.length], false);   // 雾散，回到里程节的天气
        } else {
            st.mistTimer -= dt;
            if (st.mistTimer <= 0) {
                // 下雨 / 刚停雨时不起雾：两者不能同时出现（要求里的硬约束）
                if (st.rain > 0.02) { st.mistTimer = 4; return; }
                st.mistTimer = mistDelay();
                st.mistLeft = MIST_LIFE[0] + Math.random() * (MIST_LIFE[1] - MIST_LIFE[0]);
                setWeather('mist', false);
            }
        }

        // ② 其余天气：每 5000 米切一次
        if (typeof dist === 'number' && isFinite(dist)) {
            if (dist + 1 < st.lastDist) { st.seg = 0; st.lastDist = 0; }   // 里程归零 = 新的一局
            st.lastDist = dist;
            const seg = Math.floor(dist / WX_DIST);
            if (seg > st.seg) {
                st.seg = seg;
                st.seqIdx++;                                              // 先占位，雾散了立刻生效
                if (st.weather !== 'mist') setWeather(WX_SEQ[st.seqIdx % WX_SEQ.length], false);
            }
        }
    }

    // ---------------------------------------------------------------
    //  每帧更新
    // ---------------------------------------------------------------
    const dir = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const tmpC = new THREE.Color();
    const fogGray = new THREE.Color(0x8e949c);

    function update(dt, dist) {
        if (!st.paused) st.t = (st.t + dt / st.cycle) % 1;
        st.lunar = (st.lunar + dt / (st.cycle * 8)) % 1;   // 8 个游戏日 = 一个朔望月
        advanceWeather(dt, dist);
        const k = sample(st.t);

        // 天气过渡
        const tgt = WX[st.weather] || WX.clear;
        st.rain = damp(st.rain, tgt.rain, 0.9, dt);
        st.mist = damp(st.mist, tgt.mist, st.mist > tgt.mist ? 2.6 : 0.7, dt);
        if (st.rain < 0.004) st.rain = 0;
        if (st.mist < 0.004) st.mist = 0;

        // 天空 / 星空 / 日月 / 云 始终跟随相机
        skyGroup.position.copy(camera.position);

        if (st.indoor) {
            skyGroup.visible = false;
            rainPts.visible = false;
            mistGroup.visible = false;
            playerLamp.intensity = 1.5;   // 室内没有天光，给角色一盏随身补光，避免糊成一团黑影
        } else {
            skyGroup.visible = true;
            applySky(k, dt);
            applyWeather(k, dt);
            applyLight(k);
            playerLamp.intensity = 0.28 + 1.05 * k.night + 0.35 * st.mist + 0.25 * st.rain;
            // 霓虹洗墙灯：仅赛博街区使用，夜间最强
            const nf = clamp01(k.night);
            for (const s of streetLights) {
                s.light.intensity = st.id === 'city' ? 0.55 + 5.2 * nf : 0;
                s.light.position.set(s.x, 4.4, camera.position.z - 12);
            }
        }
        if (st.indoor) for (const s of streetLights) s.light.intensity = 0;
        // 进洞/桥下：雨丝和薄雾一并隐掉（不然雨会下在隧道里）
        if (st.shelter) { rainPts.visible = false; mistGroup.visible = false; }

        // 霓虹 / 灯笼 / 窗光：夜里与雨雾天更亮
        const nightF = clamp01(k.night) * (1 - 0.1 * st.mist) + 0.18 * st.rain;
        for (const e of glowList) {
            const v = e.base + e.gain * nightF;
            if (e.kind === 'std') e.mat.emissiveIntensity = v;
            else if (e.kind === 'basic') e.mat.color.copy(e.c0).multiplyScalar(v);
            else e.mat.opacity = Math.min(1, v);
        }
        // 湿地面
        const wet = Math.max(st.rain, 0.0);
        for (const w of wetList) {
            w.mat.roughness = lerp(w.r, 0.3, wet);
            w.mat.metalness = lerp(w.metal, 0.5, wet);
        }

        // 玩家补光跟随
        if (playerRoot) {
            playerLamp.position.set(playerRoot.position.x, playerRoot.position.y + 2.5, playerRoot.position.z + 1.6);
        }

        // HUD
        if (hudEl) {
            const parts = [st.sceneName, k.name];
            if (st.rain > 0.35) parts.push('雨');
            if (st.mist > 0.3) parts.push('薄雾');
            const label = parts.join(' · ');
            if (label !== st.label) { st.label = label; hudEl.textContent = label; }
        }
    }

    function applySky(k, dt) {
        // 雨雾天把天空往灰白方向拉
        const gray = st.rain * 0.5 + st.mist * 0.34;
        tmpC.copy(S.top).lerp(fogGray, gray * 0.55);
        skyUniforms.uTop.value.copy(tmpC);
        tmpC.copy(S.mid).lerp(fogGray, gray * 0.7);
        skyUniforms.uMid.value.copy(tmpC);
        tmpC.copy(S.bot).lerp(fogGray, gray * 0.55);
        skyUniforms.uBot.value.copy(tmpC);
        skyUniforms.uHaze.value = k.haze * (1 - 0.5 * gray);

        // 星星
        const starOp = clamp01(k.star) * (1 - 0.92 * st.mist - 0.85 * st.rain);
        starsSmall.material.opacity = starOp * 0.9;
        starsBig.material.opacity = starOp;
        starsSmall.material.transparent = true;

        // 日月位置：白天走东→西，夜里月亮反向
        if (st.t < 0.60) {
            const u = clamp01(st.t / 0.60);
            const ang = Math.PI * u;
            dir.set(Math.cos(ang) * 0.95, 0.12 + 0.92 * Math.sin(ang), 0.36 - 0.12 * Math.sin(ang));
        } else {
            const u = clamp01((st.t - 0.60) / 0.34);
            const ang = Math.PI * u;
            dir.set(-Math.cos(ang) * 0.85, 0.22 + 0.6 * Math.sin(ang), 0.45);
        }
        dir.normalize();
        tmp.copy(dir).multiplyScalar(176);
        sunGlow.position.copy(tmp);
        sunDisc.position.copy(tmp);

        sunRays.position.copy(tmp);
        sunRayMat.color.copy(S.sunC);
        sunRayMat.rotation += dt * 0.02;
        sunRayMat.opacity = 0.5 * Math.pow(1 - clamp01(k.night), 1.6) * (1 - 0.9 * st.rain) * (1 - 0.6 * st.mist);
        sunGlowMat.color.copy(S.sunC);
        sunDiscMat.color.copy(S.sunC);
        sunGlowMat.opacity = (0.35 + 0.8 * (1 - k.night)) * (1 - 0.85 * st.rain) * (1 - 0.55 * st.mist);
        sunDiscMat.opacity = (0.9 * (1 - k.night)) * (1 - 0.85 * st.rain) * (1 - 0.6 * st.mist);

        // 月亮：东升西落 + 月相圆缺
        //   u=0 入夜（东边 +x 升起）→ u=0.5 午夜（最高）→ u=1 拂晓（西边 -x 落下）
        if (st.t > 0.52) {
            const u = clamp01((st.t - 0.52) / 0.46);
            const ang = Math.PI * u;
            tmp.set(Math.cos(ang) * 0.88, 0.16 + 0.62 * Math.sin(ang), -0.42);
            tmp.normalize().multiplyScalar(176);
            moonGlow.position.copy(tmp);
            moonDisc.position.copy(tmp);
            moonDisc.material.rotation = 0;
            // 月相：0 = 朔（全黑）、0.5 = 望（满月）、1 = 又回到朔
            const ph = st.lunar % 1;
            if (Math.abs(ph - moonPhaseLast) > 0.006) { drawMoonPhase(ph); moonPhaseLast = ph; }
        }
        const moonOp = clamp01((st.t > 0.5 ? (st.t - 0.5) / 0.16 : 0)) * (1 - 0.7 * st.mist - 0.8 * st.rain);
        moonGlowMat.opacity = 0.62 * moonOp;
        moonDiscMat.opacity = 1.0 * moonOp;

        // 云：缓慢漂移 + 天色染色
        for (const c of clouds) {
            const a = c.userData.drift * dt;
            const x = c.position.x, z = c.position.z;
            c.position.x = x * Math.cos(a) - z * Math.sin(a);
            c.position.z = x * Math.sin(a) + z * Math.cos(a);
            c.material.color.copy(S.cloud);
            c.material.opacity = c.userData.baseOp * (1 - 0.25 * k.night) + st.rain * 0.22 + st.mist * 0.1;
        }
    }

    function applyLight(k) {
        hemi.color.copy(S.hs);
        hemi.groundColor.copy(S.hg);
        hemi.intensity = Math.max(0.44, k.hi);   // 夜间照度下限：低于这个数路面标线在 1080p 下读不出来

        sun.color.copy(S.sunC);
        // 雨雾天削弱直射光，保留方向感
        sun.intensity = k.sunI * (1 - 0.55 * st.rain) * (1 - 0.35 * st.mist) + 0.08;
        sun.position.copy(dir).multiplyScalar(34);
        sun.target.position.set(0, 0, -10);
        sun.target.updateMatrixWorld();

        // 雾：天气压缩视距，夜里向深蓝靠
        scene.fog.color.copy(S.fog).lerp(fogGray, st.rain * 0.25 + st.mist * 0.45);
        const near = k.fn * (1 - 0.62 * st.mist) * (1 - 0.28 * st.rain);
        const far = k.ff * (1 - 0.66 * st.mist) * (1 - 0.3 * st.rain);
        scene.fog.near = Math.max(6, near);
        scene.fog.far = Math.max(28, far);
        if (scene.background && scene.background.isColor) {
            scene.background.copy(S.fog).lerp(fogGray, st.mist * 0.4);
        }
        document.body.style.background = '#' + new THREE.Color(scene.fog.color.getHex()).getHexString();
    }

    function applyWeather(k, dt) {
        // 雨丝
        const raining = st.rain > 0.02;
        rainPts.visible = raining;
        rainMat.opacity = 0.72 * st.rain;
        if (raining) {
            const arr = rainGeo.attributes.position.array;
            const n = Math.min(qRainCap, Math.floor(RAIN_MAX * clamp01(st.rain + 0.15)));
            rainGeo.setDrawRange(0, n);
            for (let i = 0; i < n; i++) {
                arr[i * 3 + 1] -= rainSpd[i] * dt;
                arr[i * 3] -= rainSpd[i] * 0.12 * dt;      // 风斜
                if (arr[i * 3 + 1] < 0) {
                    arr[i * 3 + 1] = 19 + Math.random() * 3;
                    arr[i * 3] = (Math.random() - 0.5) * 62;
                    arr[i * 3 + 2] = -6 + (Math.random() - 0.5) * 58;
                }
                if (arr[i * 3] < -31) arr[i * 3] += 62;
            }
            rainGeo.attributes.position.needsUpdate = true;
            rainPts.position.set(camera.position.x, camera.position.y - 3.2, 0);
        }

        // 薄雾
        mistGroup.visible = st.mist > 0.02;
        mistMat.opacity = 0.34 * st.mist;
        if (mistGroup.visible) {
            const tt = performance.now() * 0.001;
            mistGroup.position.set(camera.position.x, 0, 0);
            for (const s of mistGroup.children) {
                if (!s.visible) continue;   // 被画质档位裁掉的雾片不用算
                s.position.x = s.userData.x0 + Math.sin(tt * 0.18 + s.userData.ph) * 3.2;
            }
        }
    }

    // ---------------------------------------------------------------
    //  对外接口
    // ---------------------------------------------------------------
    const ATMO = {
        update,
        setTime,
        setWeather,
        /** 画质档位：雨丝上限 / 薄雾精灵数量（过度绘制是手机上最贵的开销）*/
        setQuality(q) {
            if (!q) return;
            qRainCap = Math.max(200, Math.min(RAIN_MAX, q.rain || RAIN_MAX));
            qMistCap = Math.max(2, Math.min(mistGroup.children.length, q.mist || mistGroup.children.length));
            mistGroup.children.forEach((sp, i) => { sp.visible = i < qMistCap; });
        },
        setPaused(v) { st.paused = !!v; },
        /** 室内 = 藏掉天空（整张图都是洞内时才用） */
        setIndoor(v) { st.indoor = !!v; },
        /** 遮蔽 = 只藏掉雨丝与薄雾，天空照常（隧道分段开合用这个） */
        setShelter(v) { st.shelter = !!v; },
        onScene(id, name) {
            st.id = id;
            st.indoor = id === 'tunnel';
            st.sceneName = name || '';
            if (!st.manual) st.mistTimer = Math.min(st.mistTimer, 30);   // 换场后别憋太久才起雾
            playerLamp.intensity = st.indoor ? 1.5 : 0.6;
            // 霓虹洗墙灯只有赛博街区用得上，别的地方直接标 qOff（不参与点光预算）
            const cityOn = id === 'city';
            for (const s of streetLights) s.light.userData.qOff = !cityOn;
            if (typeof trimPointLights === 'function') trimPointLights();
        },
        attachPlayer(root) { playerRoot = root; },
        registerGlow,
        registerWet,
        state: () => ({
            t: st.t, name: S.name, night: S.night,
            weather: st.weather, rain: st.rain, mist: st.mist,
            indoor: st.indoor, manual: st.manual,
            fog: [scene.fog.near, scene.fog.far],
            sun: [sun.intensity, sun.position.toArray()],
        }),
        keys: KEYS.map(k => ({ t: k.t, name: k.name })),
        _st: st,
    };
    window.__wx = ATMO;
    return ATMO;
}
// ---- 内联模块：js/oldtown.js（赛博高塔 + 赛博街道） ----
// =====================================================================
//  js/oldtown.js —— 「赛博朋克高塔 + 赛博街道」
//
//  设计约束（为了能参与主世界按材质大合并）：
//   · 每个 mesh 只用单材质，禁止多材质 mesh / InstancedMesh / Sprite
//   · 材质全部走模块级共享池，禁止 per-building clone
//   · 发光/湿地面材质向 ATMO 注册，夜间与雨雾自动联动
//   · 亮度按高度分层：越贴近路面越暗（防炫目，保证三条跑道可辨识）
//
//  塔位网格：12 槽 × 27m = 324m = THEMES.city.span，首尾严格无缝。
//  地标：东方明珠(左 s0) / 小蛮腰(右 s4) / 春笋(左 s8)，间隔 108m。
//  返回 { buildWorld, buildDecor, roadTex }，由主模块的 city 主题委派调用
// =====================================================================
function createOldTown({
    THREE, ATMO, THEMES,
    worldGroup, addMesh, addScenery, flat,
    std, shared, makeTex, rand, pick, clamp,
    LMGLB,     // 地标 GLB 接入层（可选）：有就用美术模型，没有就回退到下面的代码生成
}) {
    // -----------------------------------------------------------------
    //  程序贴图
    // -----------------------------------------------------------------
    // 幕墙窗格：一格约 3.2m 宽 × 3.4m 高，6 列 × 12 行 = 19.2m × 40.8m
    const TEX_W = 19.2, TEX_H = 40.8;
    const WIN_COLS = 6, WIN_ROWS = 12;

    function makeWinTex(litRGB, litRatio, mullion) {
        return makeTex(256, 512, (c, w, h) => {
            c.fillStyle = '#0e1724'; c.fillRect(0, 0, w, h);
            const cw = w / WIN_COLS, ch = h / WIN_ROWS;
            for (let r = 0; r < WIN_ROWS; r++) {
                for (let k = 0; k < WIN_COLS; k++) {
                    const x = k * cw, y = r * ch;
                    // 窗洞底色：深蓝玻璃 + 上亮下暗（模拟天光反射，白天不成死黑）
                    const sky = c.createLinearGradient(0, y, 0, y + ch);
                    sky.addColorStop(0, 'rgb(46,66,92)');
                    sky.addColorStop(0.55, 'rgb(28,42,60)');
                    sky.addColorStop(1, 'rgb(19,29,42)');
                    c.fillStyle = sky;
                    c.fillRect(x + 2, y + 3, cw - 4, ch - 7);
                    if (Math.random() < litRatio) {
                        const a = rand(0.30, 1.0);
                        c.fillStyle = `rgba(${litRGB},${a.toFixed(3)})`;
                        c.fillRect(x + 3, y + 4, cw - 6, ch - 9);
                        // 窗帘 / 内景暗块，避免每格都一样亮
                        if (Math.random() < 0.45) {
                            c.fillStyle = `rgba(6,10,16,${rand(0.25, 0.6).toFixed(3)})`;
                            c.fillRect(x + 3, y + 4, cw - 6, (ch - 9) * rand(0.25, 0.6));
                        }
                    }
                    // 窗台高光
                    c.fillStyle = 'rgba(190,220,255,0.07)';
                    c.fillRect(x + 2, y + 3, cw - 4, 1.5);
                }
            }
            // 竖向铝框
            for (let k = 0; k <= WIN_COLS; k++) {
                c.fillStyle = mullion;
                c.fillRect(k * cw - 1.2, 0, 2.4, h);
            }
            // 楼层横缝
            for (let r = 0; r <= WIN_ROWS; r++) {
                c.fillStyle = 'rgba(0,0,0,0.42)';
                c.fillRect(0, r * ch - 1.4, w, 2.8);
            }
        });
    }
    const winWarmTex = shared(makeWinTex('255,214,140', 0.28, 'rgba(150,170,190,0.10)'));
    const winCoolTex = shared(makeWinTex('191,233,255', 0.22, 'rgba(120,200,230,0.14)'));

    // 人行道石板
    const walkTex = shared(makeTex(256, 256, (c, w, h) => {
        c.fillStyle = '#20242b'; c.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 64) {
            for (let x = 0; x < w; x += 64) {
                const v = rand(0.85, 1.15);
                c.fillStyle = `rgb(${(58 * v) | 0},${(64 * v) | 0},${(73 * v) | 0})`;
                c.fillRect(x + 2, y + 2, 60, 60);
                c.fillStyle = 'rgba(255,255,255,0.05)';
                c.fillRect(x + 2, y + 2, 60, 2);
            }
        }
        for (let i = 0; i < 500; i++) {
            c.fillStyle = `rgba(${rand(90, 160)},${rand(140, 200)},${rand(160, 220)},${rand(0.02, 0.1)})`;
            c.fillRect(rand(0, w), rand(0, h), 2, 2);
        }
    }, 6, 90));

    // 湿沥青 + 霓虹车道
    const roadTex = shared(makeTex(256, 256, (c, w, h) => {
        c.fillStyle = '#171a21'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 1600; i++) {
            const v = Math.random() < 0.55 ? 14 : 46;
            c.fillStyle = `rgba(${v},${v + 8},${v + 14},${rand(0.08, 0.22)})`;
            c.fillRect(rand(0, w), rand(0, h), rand(1, 3), rand(1, 3));
        }
        // 车道分隔线：青色霓虹（对应 x = ±1.2m）
        for (const x of [84, 168]) {
            const g = c.createLinearGradient(0, 0, 0, 150);
            g.addColorStop(0, 'rgba(0,240,255,0.95)');
            g.addColorStop(0.55, 'rgba(0,205,255,0.7)');
            g.addColorStop(1, 'rgba(0,140,220,0.12)');
            c.fillStyle = g;
            c.fillRect(x, 8, 4, 136);
            c.fillStyle = 'rgba(0,240,255,0.22)';
            c.fillRect(x - 4, 8, 12, 136);
        }
        // 路缘洋红霓虹
        for (const x of [0, w - 12]) {
            const g = c.createLinearGradient(x, 0, x + 12, 0);
            if (x === 0) { g.addColorStop(0, 'rgba(255,40,140,0.9)'); g.addColorStop(1, 'rgba(255,40,140,0)'); }
            else { g.addColorStop(0, 'rgba(255,40,140,0)'); g.addColorStop(1, 'rgba(255,40,140,0.9)'); }
            c.fillStyle = g; c.fillRect(x, 0, 12, h);
        }
        // 湿反光污迹
        for (let i = 0; i < 9; i++) {
            const cx = rand(0, w), cy = rand(0, h), r = rand(10, 26);
            const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, pick(['rgba(255,30,120,0.20)', 'rgba(0,225,255,0.18)', 'rgba(160,70,255,0.14)']));
            g.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = g; c.fillRect(cx - r, cy - r * 0.6, r * 2, r * 1.2);
        }
    }, 1, 56));

    // 街面招牌带（6 块霓虹店招，卷成一张 1024×64 长条）
    const SHOP_SIGNS = [
        ['拉麵', '255,86,120'], ['義體', '0,234,255'], ['藥局', '90,255,170'],
        ['電玩', '164,87,255'], ['茶樓', '255,180,92'], ['當鋪', '255,45,146'],
    ];
    const signTex = shared(makeTex(1024, 64, (c, w, h) => {
        c.fillStyle = '#060a12'; c.fillRect(0, 0, w, h);
        const pw = w / SHOP_SIGNS.length;
        SHOP_SIGNS.forEach(([name, rgb], i) => {
            const x = i * pw;
            c.fillStyle = 'rgba(10,16,26,0.96)';
            c.fillRect(x + 3, 4, pw - 6, h - 8);
            c.strokeStyle = `rgba(${rgb},0.85)`; c.lineWidth = 2;
            c.strokeRect(x + 4, 5, pw - 8, h - 10);
            c.fillStyle = `rgb(${rgb})`;
            c.shadowColor = `rgb(${rgb})`; c.shadowBlur = 10;
            c.font = 'bold 34px "Microsoft YaHei","SimHei",sans-serif';
            c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText(name, x + pw / 2, h / 2 + 1);
            c.shadowBlur = 0;
        });
    }));

    // 街面店招：4 个开间（亮橱窗 / 卷帘门 / 门洞 / 霓虹条），贴基座 0.7~3.5m
    // 亮度上限压到 0.16 —— 街面唯一的大面积自发光，必须低于车道线
    const shopfrontTex = shared(makeTex(1024, 256, (c, w, h) => {
        c.fillStyle = '#0a1018'; c.fillRect(0, 0, w, h);
        const bays = 4, bw = w / bays;
        for (let i = 0; i < bays; i++) {
            const x = i * bw;
            const warm = i % 2 === 0;
            // 门框
            c.fillStyle = '#141c26';
            c.fillRect(x + 6, 10, bw - 12, h - 20);
            if (warm) {
                // 亮橱窗：暖光从上部往下衰减
                const g = c.createLinearGradient(0, 18, 0, h - 24);
                g.addColorStop(0, 'rgba(255,214,150,0.95)');
                g.addColorStop(0.5, 'rgba(255,176,96,0.62)');
                g.addColorStop(1, 'rgba(120,70,30,0.30)');
                c.fillStyle = g;
                c.fillRect(x + 16, 18, bw - 32, h - 42);
                // 货架剪影
                for (let k = 0; k < 5; k++) {
                    c.fillStyle = `rgba(20,14,10,${rand(0.3, 0.6).toFixed(2)})`;
                    c.fillRect(x + 26 + k * (bw - 60) / 5, rand(40, h - 80), rand(10, 26), rand(18, 46));
                }
            } else {
                // 卷帘门：竖向条纹 + 冷光缝隙
                for (let y = 18; y < h - 24; y += 7) {
                    c.fillStyle = 'rgba(52,62,76,0.55)';
                    c.fillRect(x + 16, y, bw - 32, 3);
                }
                c.fillStyle = 'rgba(0,234,255,0.30)';
                c.fillRect(x + 16, 20, bw - 32, 2);
            }
            // 门楣霓虹条
            c.fillStyle = i % 2 ? 'rgba(164,87,255,0.85)' : 'rgba(0,234,255,0.85)';
            c.fillRect(x + 12, 6, bw - 24, 5);
        }
    }));

    // 柔和光斑（霓虹光晕 / 蒸汽）
    const softTex = makeTex(128, 128, (c, w, h) => {
        const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
    });

    // 全息广告
    const holoTex = shared(makeTex(256, 128, (c, w, h) => {
        c.fillStyle = 'rgba(4,10,18,0.92)'; c.fillRect(0, 0, w, h);
        c.strokeStyle = 'rgba(0,240,255,0.9)'; c.lineWidth = 3;
        c.strokeRect(6, 6, w - 12, h - 12);
        for (let y = 0; y < h; y += 4) {
            c.fillStyle = 'rgba(0,240,255,0.06)'; c.fillRect(6, y, w - 12, 1);
        }
        c.fillStyle = '#7ff6ff'; c.shadowColor = '#00e5ff'; c.shadowBlur = 14;
        c.font = 'bold 44px "Microsoft YaHei","SimHei",sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('賽博夜行', w / 2, h / 2 - 12);
        c.font = 'bold 22px "Microsoft YaHei",sans-serif';
        c.fillText('NEON  CITY  2088', w / 2, h / 2 + 32);
        c.shadowBlur = 0;
    }));

    // 天际线窗光：**分层**点亮，不是随机散点。
    // 128×256 的贴图按 8px 宽（16 开间）× 10px 高（25 层）切格：
    //   · 底部 12%：裙楼，整条暖光带（写字楼大堂 / 商铺连成一片）
    //   · 顶部 14%：设备层，几乎全暗，只留零星值班灯
    //   · 中间：按「整层成带」点亮 —— 先掷一层亮不亮，亮了再按 72% 开间填。
    // 这样从街上看是「几层亮、几层暗」的节奏，而不是撒了一地噪点。
    const towerWinTex = shared(makeTex(128, 256, (c, w, h) => {
        c.fillStyle = '#0a0f1a'; c.fillRect(0, 0, w, h);
        const COLS = ['255,214,140', '150,235,255', '255,120,200', '180,255,220'];
        const ROW = 10, COL = 8;
        const rows = Math.floor((h - 6) / ROW);
        for (let y = 6, row = 0; y < h; y += ROW, row++) {
            const t = row / rows;
            if (t < 0.12) {
                // 裙楼：连续暖光带
                c.fillStyle = `rgba(255,206,140,${rand(0.5, 0.78)})`;
                c.fillRect(4, y + 2, w - 8, 4);
            } else if (t > 0.86) {
                // 设备层：基本全暗
                if (Math.random() < 0.16) {
                    c.fillStyle = `rgba(${pick(COLS)},0.55)`;
                    c.fillRect(4 + Math.floor(Math.random() * 15) * COL, y, 5, 6);
                }
            } else if (Math.random() < 0.56) {
                // 办公层：整层成带，带内 72% 开间亮
                for (let x = 4, col = 0; x < w; x += COL, col++) {
                    if (Math.random() < 0.72) {
                        c.fillStyle = `rgba(${COLS[(row + col) % COLS.length]},${rand(0.45, 0.88)})`;
                        c.fillRect(x, y, 5, 6);
                    }
                }
            }
        }
    }));

    // -----------------------------------------------------------------
    //  材质（共享池）—— 亮度预算见各 registerGlow 的 base / gain
    // -----------------------------------------------------------------
    const stoneMat = shared(std(0x4a4f58, { roughness: 0.9 }));
    const roadMat = shared(std(0xf2f6ff, { map: roadTex, roughness: 0.58, metalness: 0.18 }));
    const walkMat = shared(std(0xcfd8e6, { map: walkTex, roughness: 0.72, metalness: 0.16 }));

    // 塔身：大面积永远是深蓝，饱和色只出现在「线」上
    // 注意 emissive 必须给颜色，否则 registerGlow 设的 emissiveIntensity 不起作用（夜里纯黑）
    const twrMass = shared(std(0x1d2a3a, {
        roughness: 0.62, metalness: 0.35, emissive: 0x1a2a40, emissiveIntensity: 0.06,
    }));
    const twrMassLt = shared(std(0x36495f, {
        roughness: 0.55, metalness: 0.40, emissive: 0x2b4059, emissiveIntensity: 0.06,
    }));
    const twrWinWarm = shared(std(0x1a2431, {
        map: winWarmTex, emissive: 0xffd68c, emissiveMap: winWarmTex,
        emissiveIntensity: 0.1, roughness: 0.5, metalness: 0.25,
    }));
    const twrWinCool = shared(std(0x16202c, {
        map: winCoolTex, emissive: 0xbfe9ff, emissiveMap: winCoolTex,
        emissiveIntensity: 0.08, roughness: 0.42, metalness: 0.35,
    }));
    const twrTrim = shared(std(0x0a0e15, { roughness: 0.45, metalness: 0.7 }));
    // 街面招牌：唯一允许出现在 0~8m 的自发光，上限压到 0.17
    const twrSign = shared(std(0x0d141d, {
        map: signTex, emissive: 0x9fd4ff, emissiveMap: signTex,
        emissiveIntensity: 0.05, roughness: 0.6,
    }));
    // 街面橱窗：0.7~3.5m 的店招带，夜里最多 0.16（低于车道线 0.82）
    const twrShop = shared(std(0x121a24, {
        map: shopfrontTex, emissive: 0xffd0a0, emissiveMap: shopfrontTex,
        emissiveIntensity: 0.06, roughness: 0.55,
    }));
    // 广场铺地
    const plazaMat = shared(std(0x232b36, { roughness: 0.78, metalness: 0.18 }));

    // 霓虹（basic：颜色 × v）
    const twrNeonC = shared(new THREE.MeshBasicMaterial({ color: 0x00eaff }));
    const twrNeonV = shared(new THREE.MeshBasicMaterial({ color: 0xa457ff }));
    const twrNeonA = shared(new THREE.MeshBasicMaterial({ color: 0xffb45c }));
    // 斜交网格用的弱一档霓虹：24 根线叠在一起也不能抢走路面的注意力
    const twrNeonL = shared(new THREE.MeshBasicMaterial({ color: 0x6fe8ff }));
    // 光晕（additive：opacity = v，夜里最高 0.15）
    const twrHaloC = shared(new THREE.MeshBasicMaterial({
        map: softTex, color: 0x2ad8ff, transparent: true, opacity: 0.02,
        blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const twrHaloV = shared(new THREE.MeshBasicMaterial({
        map: softTex, color: 0x9a5cff, transparent: true, opacity: 0.02,
        blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    // L5 塔顶航空障碍灯：夜里天际线上唯一的一组红点。
    // 用交叉双面片而不是 Sprite —— Sprite 没有可烘焙几何，静态合并时会被整对象吞掉
    // （蒸汽那边踩过同一个坑）。
    const beaconMat = shared(new THREE.MeshBasicMaterial({
        map: softTex, color: 0xff4a3a, transparent: true, opacity: 0.06,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    ATMO.registerGlow(beaconMat, { kind: 'add', base: 0.06, gain: 0.55 });

    // 街道（沿用原赛博街道的那一套）
    const neonCyanMat = shared(new THREE.MeshBasicMaterial({ color: 0x00eaff }));
    const neonPinkMat = shared(new THREE.MeshBasicMaterial({ color: 0xff2d92 }));
    const laneGlowMat = shared(new THREE.MeshBasicMaterial({
        color: 0x00eaff, transparent: true, opacity: 0.18,
        blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const neonHaloMat = shared(new THREE.MeshBasicMaterial({
        map: softTex, color: 0x66f0ff, transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    // 地面蒸汽：用交叉双面片，不用 Sprite。
    // Sprite 没有可烘焙的几何，按材质大合并时会被"整对象移除"静默吞掉（旧实现丢了全部蒸汽）。
    const steamMat = shared(new THREE.MeshBasicMaterial({
        map: softTex, color: 0xcfe6f2, transparent: true, opacity: 0.1,
        depthWrite: false, side: THREE.DoubleSide,
    }));
    const towerMatA = shared(std(0x0c1524, { map: towerWinTex, emissive: 0x4a7fb0, emissiveMap: towerWinTex, emissiveIntensity: 0.5, roughness: 0.85 }));
    const towerMatB = shared(std(0x121a2a, { map: towerWinTex, emissive: 0xb05a8a, emissiveMap: towerWinTex, emissiveIntensity: 0.45, roughness: 0.85 }));
    const archCyanMat = shared(std(0x0fc8e0, { emissive: 0x00eaff, emissiveIntensity: 1.5, roughness: 0.4 }));
    const archPinkMat = shared(std(0xd41d7a, { emissive: 0xff2d92, emissiveIntensity: 1.5, roughness: 0.4 }));
    const holoMat = shared(new THREE.MeshBasicMaterial({
        map: holoTex, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
    }));
    const cableMat = shared(std(0x1a1e26, { roughness: 0.9 }));
    const groundMat = shared(std(0x0e1016, { roughness: 0.92 }));
    const poolCyanMat = shared(new THREE.MeshBasicMaterial({
        map: softTex, color: 0x19c8e6, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const poolPinkMat = shared(new THREE.MeshBasicMaterial({
        map: softTex, color: 0xe62d8a, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    // 终点地标环的塔顶信标光晕：fog:false —— 和金色新葡京同一个理由，
    // 各档雾的 far 只有 100/76/62，不穿雾的话 150m 外的信标根本看不见。
    const ringBeaconMat = shared(new THREE.MeshBasicMaterial({
        map: softTex, color: 0xffb347, transparent: true, opacity: 0.32,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    // 积水（路的低洼处，反射霓虹）
    const puddleMat = shared(new THREE.MeshBasicMaterial({
        map: softTex, color: 0x2c4a78, transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const reflMat = shared(new THREE.MeshBasicMaterial({
        map: makeTex(64, 128, (c, w, h) => {
            const g = c.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, 'rgba(0,240,255,0.62)');
            g.addColorStop(0.3, 'rgba(0,240,255,0.34)');
            g.addColorStop(1, 'rgba(0,240,255,0)');
            c.fillStyle = g; c.fillRect(0, 0, w, h);
            const hz = c.createLinearGradient(0, 0, w, 0);
            hz.addColorStop(0, 'rgba(0,0,0,0)');
            hz.addColorStop(0.5, 'rgba(0,0,0,1)');
            hz.addColorStop(1, 'rgba(0,0,0,0)');
            c.globalCompositeOperation = 'destination-in';
            c.fillStyle = hz; c.fillRect(0, 0, w, h);
            c.globalCompositeOperation = 'source-over';
        }),
        transparent: true, opacity: 0.24, depthWrite: false,
        blending: THREE.AdditiveBlending,
    }));

    // 向昼夜系统注册：夜里更亮、雨天更湿
    // 塔身大面积：夜里也不超过 0.22 —— 路面亮度必须高于塔身
    // 塔身：夜里 0.06 → 0.25（原来 0.22 时大面积区偏死黑，抬一档；仍远低于车道线 0.82）
    // 夜景亮度**按高度分层**（夜里 nightF≈1 时的目标值）：
    //   L0 街面橱窗 0.80  →  L1 招牌 0.48  →  L2 裙楼窗 0.74  →  L3 塔身窗 0.66
    //   L4 楼体轮廓 0.30  →  L5 塔顶信标（见 makeTower）  →  L6 霓虹线 0.9+
    // 越靠近地面越亮、越往上越收敛，视线自然从街面往上"爬"，而不是平铺一层亮斑。
    ATMO.registerGlow(twrMass, { base: 0.06, gain: 0.24 });
    ATMO.registerGlow(twrMassLt, { base: 0.06, gain: 0.24 });
    ATMO.registerGlow(twrWinWarm, { base: 0.12, gain: 0.62 });   // L2 裙楼窗（暖）
    ATMO.registerGlow(twrWinCool, { base: 0.10, gain: 0.56 });   // L3 塔身窗（冷）
    ATMO.registerGlow(twrSign, { base: 0.06, gain: 0.42 });      // L1 招牌
    ATMO.registerGlow(twrShop, { base: 0.08, gain: 0.72 });      // L0 橱窗，最亮
    // 霓虹线：夜里 0.92，低于车道线，且宽度 ≤0.22m
    ATMO.registerGlow(twrNeonC, { kind: 'basic', base: 0.30, gain: 0.62 });
    ATMO.registerGlow(twrNeonV, { kind: 'basic', base: 0.26, gain: 0.55 });
    ATMO.registerGlow(twrNeonA, { kind: 'basic', base: 0.30, gain: 0.75 });
    ATMO.registerGlow(twrNeonL, { kind: 'basic', base: 0.18, gain: 0.36 });
    ATMO.registerGlow(twrHaloC, { kind: 'add', base: 0.02, gain: 0.13 });
    ATMO.registerGlow(twrHaloV, { kind: 'add', base: 0.02, gain: 0.11 });
    ATMO.registerGlow(neonCyanMat, { kind: 'basic', base: 0.82, gain: 0.5 });
    ATMO.registerGlow(neonPinkMat, { kind: 'basic', base: 0.82, gain: 0.5 });
    ATMO.registerGlow(towerMatA, { base: 0.4, gain: 1.3 });
    ATMO.registerGlow(towerMatB, { base: 0.36, gain: 1.3 });
    ATMO.registerGlow(archCyanMat, { base: 0.7, gain: 1.8 });
    ATMO.registerGlow(archPinkMat, { base: 0.7, gain: 1.8 });
    ATMO.registerGlow(holoMat, { kind: 'add', base: 0.28, gain: 0.45 });
    ATMO.registerGlow(laneGlowMat, { kind: 'add', base: 0.1, gain: 0.24 });
    ATMO.registerGlow(neonHaloMat, { kind: 'add', base: 0.06, gain: 0.3 });
    ATMO.registerGlow(reflMat, { kind: 'add', base: 0.1, gain: 0.35 });
    ATMO.registerGlow(poolCyanMat, { kind: 'add', base: 0.12, gain: 0.3 });
    ATMO.registerGlow(poolPinkMat, { kind: 'add', base: 0.12, gain: 0.3 });
    ATMO.registerGlow(puddleMat, { kind: 'add', base: 0.16, gain: 0.3 });
    ATMO.registerWet([roadMat, walkMat, stoneMat, plazaMat, twrMass, twrMassLt]);

    // -----------------------------------------------------------------
    //  几何体缓存（同尺寸复用同一份，且标记 shared：换场不销毁）
    // -----------------------------------------------------------------
    const GC = new Map();
    const gk = (...a) => a.map(v => (typeof v === 'number' ? v.toFixed(2) : String(v))).join('|');
    function geo(key, make) {
        let g = GC.get(key);
        if (!g) { g = shared(make()); GC.set(key, g); }
        return g;
    }
    const BOX = (w, h, d) => geo('b' + gk(w, h, d), () => new THREE.BoxGeometry(w, h, d));
    const CYL = (rt, rb, h, seg) => geo('c' + gk(rt, rb, h, seg), () => new THREE.CylinderGeometry(rt, rb, h, seg));
    const SPH = (r, ws, hs) => geo('s' + gk(r, ws, hs), () => new THREE.SphereGeometry(r, ws, hs));
    const CONE = (r, h, seg) => geo('k' + gk(r, h, seg), () => new THREE.ConeGeometry(r, h, seg));
    const TOR = (r, t, rs, ts) => geo('t' + gk(r, t, rs, ts), () => new THREE.TorusGeometry(r, t, rs, ts));

    // 带窗格的 Box：把 UV 按面换算成「每 19.2m × 40.8m 一次重复」
    const WINBOX = (w, h, d) => geo('wb' + gk(w, h, d), () => {
        const g = new THREE.BoxGeometry(w, h, d);
        const uv = g.attributes.uv;
        const su = [d / TEX_W, d / TEX_W, w / TEX_W, w / TEX_W, w / TEX_W, w / TEX_W];
        const sv = [h / TEX_H, h / TEX_H, d / TEX_H, d / TEX_H, h / TEX_H, h / TEX_H];
        for (let f = 0; f < 6; f++) {
            for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, uv.getX(i) * su[f], uv.getY(i) * sv[f]);
        }
        uv.needsUpdate = true;
        return g;
    });

    function put(g, geometry, mat, x, y, z, rot) {
        const m = new THREE.Mesh(geometry, mat);
        m.position.set(x, y, z);
        if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
        m.castShadow = false; m.receiveShadow = true;
        g.add(m);
        return m;
    }

    // 沿锥度斜贴的构件（竖光条 / 斜网格）：a = 绕 Y 的方位角，twist = 切向倾斜（斜交网格用）
    function strut(g, a, y0, y1, r0, r1, geometry, mat, twist) {
        const m = new THREE.Mesh(geometry, mat);
        m.position.set(0, (y0 + y1) / 2, (r0 + r1) / 2);
        m.rotation.set(-Math.atan2(r0 - r1, y1 - y0), 0, twist || 0);   // 上端向轴心收
        const holder = new THREE.Group();
        holder.rotation.y = a;
        holder.add(m);
        g.add(holder);
        return m;
    }
    function barStrut(g, a, y0, y1, r0, r1, w, mat, twist) {
        const len = Math.hypot(y1 - y0, r1 - r0);
        return strut(g, a, y0, y1, r0, r1, BOX(w, len, w), mat, twist);
    }
    function cylStrut(g, a, y0, y1, r0, r1, rad, mat) {
        const len = Math.hypot(y1 - y0, r1 - r0);
        return strut(g, a, y0, y1, r0, r1, CYL(rad, rad, len, 6), mat);
    }

    // -----------------------------------------------------------------
    //  统一基座（0~6m）：雨棚 + 棚底霓虹 + 街面招牌带
    //  6m 是旧街檐口高度，人尺度与「街墙」关系因此保留下来
    // -----------------------------------------------------------------
    const PODIUM_H = 6;
    function podium(g, IN, deep) {
        const W = 18, D = deep ? 26 : 24;
        put(g, BOX(W, PODIUM_H, D), stoneMat, 0, PODIUM_H / 2, 0);
        // 出挑雨棚（朝街 1.4m）
        put(g, BOX(1.5, 0.34, D - 2.4), twrTrim, IN * (W / 2 + 0.45), PODIUM_H - 0.1, 0);
        // 棚底霓虹边（0.12m 细线，全项目唯一允许贴地的强光）
        put(g, BOX(0.12, 0.12, D - 2.4), twrNeonC, IN * (W / 2 + 1.1), PODIUM_H - 0.34, 0);
        // 街面橱窗带（0.7~3.5m）—— 让 0~6m 不再是一整片空白墙
        put(g, new THREE.PlaneGeometry(D * 0.9, 2.8), twrShop,
            IN * (W / 2 + 0.03), 2.1, 0, [0, IN * Math.PI / 2, 0]);
        // 街面招牌带（贴墙面，0.9m 高）
        put(g, new THREE.PlaneGeometry(D * 0.62, 0.9), twrSign,
            IN * (W / 2 + 0.06), 4.15, 0, [0, IN * Math.PI / 2, 0]);
        // 塔基竖向收边（把塔身与基座的转折交代清楚）
        for (const s of [-1, 1]) {
            put(g, BOX(0.4, PODIUM_H, 0.4), twrTrim, IN * (W / 2 - 0.2), PODIUM_H / 2, s * (D / 2 - 0.2));
        }
    }

    // 地标广场：在连续街墙上开一个口子。
    // 关键几何：FOV 62 / 俯角 -10° 下，只有贴着街墙线（x≈11~12）的塔才不会被
    // 前一栋挡住——所以地标轴心放在 x=±12，广场铺地往后退到 x≈38，形成"塔在广场口"。
    // openW = 开口在 Z 向的宽度（地标占一整个槽 27m 时用 26，新地标用 18 收窄，保住街道峡谷感）
    function plaza(g, OUT, openW) {
        const W = openW || 26;
        const half = W / 2;
        // 铺地（比人行道略高，形成广场层次）
        put(g, BOX(31, 0.3, W), plazaMat, OUT * 10.5, 0.15, 0);
        // 地面导光条：从街边指向广场深处，把视线引过去
        for (const s of [-1, 1]) {
            put(g, BOX(20, 0.06, 0.16), twrNeonV, OUT * 15, 0.32, s * Math.max(4, half - 5));
        }
        // 广场两侧的落地灯箱（低矮，补近处光但不会晃眼）
        for (const s of [-1, 1]) {
            put(g, BOX(0.5, 2.2, 0.5), twrTrim, OUT * 16, 1.1, s * Math.max(3, half - 2));
            put(g, BOX(0.12, 1.6, 0.12), twrNeonA, OUT * 16, 2.6, s * Math.max(3, half - 2));
        }
        // 广场深处的收边矮墙（把开口收住，不至于透出虚空）
        put(g, BOX(0.3, 1.2, W), stoneMat, OUT * 25, 0.6, 0);
        put(g, BOX(0.14, 0.14, W), twrNeonC, OUT * 25, 1.22, 0);
        // 塔脚光池（水平贴地，只照广场地面）。
        // 注意这里是局部坐标：makeLandmark 里 g.position.x = side*12，所以 OUT*2 才是世界 x=±14，
        // 边长 16 → 覆盖世界 6~22，正好压在塔基（7~17）脚下，且不压路面。
        put(g, new THREE.PlaneGeometry(16, 16), twrHaloC, OUT * 2, 0.34, 0, [-Math.PI / 2, 0, 0]);
        // 门屋：把开口两端收住。没有它，开口看起来只是"街墙被削掉一块"，
        // 有了这两座 7.5m 高的小体量，才读成"一个可以走进去的广场"。
        for (const s of [-1, 1]) {
            const z = s * (half + 1.6);
            put(g, BOX(2.6, 7.5, 3.2), twrMass, OUT * 0.5, 3.75, z);
            put(g, BOX(2.9, 0.28, 3.5), twrTrim, OUT * 0.5, 7.64, z);
            put(g, BOX(2.96, 0.12, 3.56), twrNeonC, OUT * 0.5, 7.46, z);
            put(g, new THREE.PlaneGeometry(3.0, 1.1), twrSign, -OUT * 0.92, 6.2, z, [0, OUT * Math.PI / 2, 0]);
        }
    }

    // 冠部：环 / 双鳍 / 天线 / 无
    function crown(g, y, r, kind) {
        if (kind === 'ring') {
            put(g, TOR(r + 0.22, 0.12, 4, 14), twrNeonC, 0, y, 0, [Math.PI / 2, 0, 0]);
            put(g, TOR(r + 0.22, 0.06, 4, 14), twrNeonV, 0, y - 1.6, 0, [Math.PI / 2, 0, 0]);
        } else if (kind === 'fins') {
            for (const s of [-1, 1]) {
                put(g, BOX(0.18, 5.5, 0.9), twrNeonV, s * (r * 0.55), y + 2.2, 0);
            }
            put(g, BOX(r * 2.2, 0.16, 0.16), twrNeonC, 0, y + 4.9, 0);
        } else if (kind === 'antenna') {
            put(g, CYL(0.09, 0.16, 7.5, 6), twrTrim, 0, y + 3.7, 0);
            put(g, SPH(0.34, 8, 6), twrNeonA, 0, y + 7.6, 0);
            put(g, new THREE.PlaneGeometry(6, 6), twrHaloC, 0, y + 7.6, 0);
        }
    }

    // -----------------------------------------------------------------
    //  常规塔 A~F（全部单材质 mesh，可被按材质合并）
    // -----------------------------------------------------------------
    // A 棱柱：八角切面 + 四道竖光 + 冠环
    function towerA(g, IN, H) {
        const y0 = PODIUM_H;
        const segs = [[5.6, 4.6, 0.50], [4.6, 3.4, 0.30], [3.4, 2.6, 0.20]];
        let y = y0;
        segs.forEach(([r0, r1, f], k) => {
            const h = H * f;
            put(g, CYL(r1, r0, h, 8), k === 1 ? twrMassLt : twrMass, 0, y + h / 2, 0);
            put(g, CYL(r1 + 0.42, r1 + 0.42, 0.4, 8), twrTrim, 0, y + h - 0.18, 0);
            if (k > 0) put(g, TOR(r0 + 0.2, 0.1, 4, 12), twrNeonC, 0, y + 0.06, 0, [Math.PI / 2, 0, 0]);
            y += h;
        });
        for (let k = 0; k < 4; k++) {
            barStrut(g, k * Math.PI / 2, y0 + 1.2, y0 + H * 0.84, 5.45, 3.05, 0.16, twrNeonV);
        }
        crown(g, y0 + H + 0.4, 2.7, pick(['ring', 'ring', 'fins', 'antenna']));
    }

    // B 退台：四段收分，每层一圈水平光缝
    function towerB(g, IN, H) {
        const y0 = PODIUM_H, W0 = 16, D0 = 20;
        const steps = [[1.00, 0.42], [0.84, 0.26], [0.68, 0.19], [0.50, 0.13]];
        let y = y0;
        steps.forEach(([k, f], idx) => {
            const h = H * f, w = W0 * k, d = D0 * (0.62 + 0.38 * k);
            put(g, WINBOX(w, h, d), idx % 2 ? twrWinCool : twrWinWarm, 0, y + h / 2, 0);
            put(g, BOX(w + 1.3, 0.36, d + 1.3), twrTrim, 0, y + h + 0.08, 0);
            put(g, BOX(0.1, 0.1, d + 1.1), twrNeonV, IN * (w / 2 + 0.62), y + h - 0.16, 0);
            y += h;
        });
        crown(g, y0 + H + 0.4, W0 * 0.25, pick(['ring', 'antenna', 'none']));
    }

    // C 板式：一块立起来的薄板 + 两道竖光鳍 + 顶招牌屏
    function towerC(g, IN, H) {
        const y0 = PODIUM_H, W = 11, D = 20;
        put(g, WINBOX(W, H, D), twrWinWarm, 0, y0 + H / 2, 0);
        // 街面一侧的冷光幕墙薄板
        put(g, WINBOX(0.5, H * 0.8, D * 0.66), twrWinCool, IN * (W / 2 + 0.22), y0 + H * 0.44, 0);
        for (const s of [-1, 1]) {
            put(g, BOX(0.22, H * 0.86, 0.6), twrNeonV, IN * (W / 2 + 0.3), y0 + H * 0.45, s * (D / 2 - 2.6));
        }
        // 顶招牌屏（横向长条）
        put(g, BOX(0.3, 2.2, 14), twrSign, IN * (W / 2 + 0.1), y0 + H * 0.9, 0);
        crown(g, y0 + H + 0.3, 3.0, pick(['fins', 'antenna', 'none']));
    }

    // D 双塔：两道塔身 + 三道空中连廊
    function towerD(g, IN, H) {
        const y0 = PODIUM_H, W = 8, D = 8;
        for (const s of [-1, 1]) {
            put(g, WINBOX(W, H, D), twrWinCool, 0, y0 + H / 2, s * 8);
            put(g, BOX(0.16, H * 0.8, 0.16), twrNeonC, IN * (W / 2 + 0.1), y0 + H * 0.45, s * 8 - 2.4);
            put(g, BOX(W + 0.5, 0.4, D + 0.5), twrTrim, 0, y0 + H - 0.2, s * 8);
        }
        for (const f of [0.38, 0.62, 0.84]) {
            put(g, BOX(5.6, 3.0, 16), twrMassLt, 0, y0 + H * f, 0);
            put(g, BOX(0.12, 0.12, 16), twrNeonV, IN * 2.9, y0 + H * f - 1.3, 0);
        }
        crown(g, y0 + H + 0.4, 4.0, 'antenna');
    }

    // E 斜切：菱形截面 + 四棱锥冠
    function towerE(g, IN, H) {
        const y0 = PODIUM_H;
        const rg = new THREE.Group();
        rg.rotation.y = Math.PI / 4;
        g.add(rg);
        put(rg, WINBOX(14, H * 0.72, 14), twrWinWarm, 0, y0 + H * 0.36, 0);
        put(rg, CONE(9, H * 0.28, 4), twrMass, 0, y0 + H * 0.86, 0);
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                put(rg, BOX(0.18, H * 0.7, 0.18), twrNeonV, sx * 6.9, y0 + H * 0.36, sz * 6.9);
            }
        }
        put(rg, TOR(7.1, 0.12, 4, 4), twrNeonC, 0, y0 + H * 0.72, 0, [Math.PI / 2, Math.PI / 4, 0]);
        crown(g, y0 + H + 0.2, 2.4, pick(['antenna', 'none']));
    }

    // F 圆筒：箍环塔
    function towerF(g, IN, H) {
        const y0 = PODIUM_H;
        put(g, CYL(4.6, 5.0, H, 12), twrMass, 0, y0 + H / 2, 0);
        const n = 5;
        for (let i = 1; i <= n; i++) {
            const y = y0 + (H * i) / (n + 1);
            const r = 5.0 + (4.6 - 5.0) * (i / (n + 1)) + 0.3;
            put(g, CYL(r, r, 0.26, 12), twrTrim, 0, y, 0);
            if (i % 2) put(g, CYL(r + 0.02, r + 0.02, 0.1, 12), twrNeonC, 0, y - 0.18, 0);
        }
        put(g, WINBOX(0.5, H * 0.7, 6), twrWinCool, IN * 4.4, y0 + H * 0.42, 0);
        crown(g, y0 + H + 0.3, 4.6, pick(['ring', 'antenna']));
    }

    // -----------------------------------------------------------------
    //  三座地标（真实高度在 FOV 62 / fog 155 下不可见，按比例压缩到 54~58m，
    //  识别靠「比例特征」而不是绝对高度）
    // -----------------------------------------------------------------
    // 东方明珠：三球不等径 + 三根外倾斜撑 + 尖顶
    function landmarkPearl(g, IN, y0) {
        // 主桅
        put(g, CYL(2.6, 3.6, 44, 8), twrMass, 0, y0 + 22, 0);
        // 三球：直径比 1 : 0.72 : 0.52，间距 13 / 17 / 11
        const balls = [[5.0, 13, twrWinWarm], [3.6, 30, twrMassLt], [2.6, 41, twrWinCool]];
        for (const [r, y, mat] of balls) {
            put(g, SPH(r, 14, 10), mat, 0, y, 0);
            put(g, TOR(r + 0.16, 0.1, 4, 14), twrNeonV, 0, y, 0, [Math.PI / 2, 0, 0]);
        }
        // 三根斜撑：0~18m 内唯一的近距识别点
        for (let k = 0; k < 3; k++) {
            cylStrut(g, k * (Math.PI * 2 / 3), y0 - 0.4, y0 + 18, 7.4, 2.7, 0.78, twrMass);
        }
        // 尖顶
        put(g, CONE(0.5, 11, 6), twrTrim, 0, y0 + 47.5, 0);
        put(g, SPH(0.36, 8, 6), twrNeonA, 0, y0 + 53.2, 0);
        put(g, TOR(5.2, 0.14, 4, 16), twrNeonC, 0, y0 + 9.5, 0, [Math.PI / 2, 0, 0]);
        // 顶部光晕（唯一一处 additive，贴片 7×7，不落地）
        put(g, new THREE.PlaneGeometry(7, 7), twrHaloV, 0, y0 + 30, 0, [0, IN * Math.PI / 2, 0]);
    }

    // 广州塔「小蛮腰」：外张基座 → 收腰 → 微张塔身，腰比 0.42，斜交网格
    // 腰线压到 24m：FOV 62 下玩家只能看到 30m 左右的高度带，腰必须落在带内才认得出
    function landmarkWaist(g, IN, y0) {
        const WAIST_Y = y0 + 20;          // 收腰高度（相对塔基 4m → 世界 24m）
        put(g, CYL(2.2, 4.8, 20, 12), twrWinCool, 0, y0 + 10, 0);        // 4 → 24，收
        put(g, CYL(3.2, 2.2, 16, 12), twrMass, 0, y0 + 28, 0);           // 24 → 40，微张
        put(g, CYL(1.0, 3.2, 0.5, 12), twrTrim, 0, y0 + 40, 0);          // 顶盖
        // 斜交网格：8 组 × 左右旋，形成织网感（不是直棱）
        for (let k = 0; k < 8; k++) {
            const a = k * (Math.PI * 2 / 8);
            barStrut(g, a, y0 + 0.6, WAIST_Y, 4.7, 2.3, 0.16, twrNeonL, 0.30);
            barStrut(g, a, y0 + 0.6, WAIST_Y, 4.7, 2.3, 0.16, twrNeonL, -0.30);
            barStrut(g, a, WAIST_Y, y0 + 38, 2.3, 3.1, 0.16, twrNeonL, 0.24);
        }
        // 腰部光环（收腰处的识别点）
        put(g, TOR(2.35, 0.15, 4, 16), twrNeonV, 0, WAIST_Y, 0, [Math.PI / 2, 0, 0]);
        put(g, TOR(4.85, 0.12, 4, 16), twrNeonC, 0, y0 + 1.2, 0, [Math.PI / 2, 0, 0]);
        // 顶部桅杆
        put(g, CYL(0.45, 1.2, 9, 8), twrTrim, 0, y0 + 44.5, 0);
        put(g, SPH(0.34, 8, 6), twrNeonA, 0, y0 + 49.2, 0);
        put(g, new THREE.PlaneGeometry(6, 6), twrHaloC, 0, WAIST_Y, 0, [0, IN * Math.PI / 2, 0]);
    }

    // 春笋：六段连续锥度 + 竹节箍 + 下半段斜交线
    function landmarkBamboo(g, IN, y0) {
        const radii = [5.2, 4.4, 3.6, 2.9, 2.2, 1.5, 1.2];
        const SEG_H = 7.4;
        for (let i = 0; i < 6; i++) {
            const y = y0 + i * SEG_H;
            put(g, CYL(radii[i + 1], radii[i], SEG_H, 10), i % 2 ? twrMass : twrWinCool, 0, y + SEG_H / 2, 0);
            // 竹节箍（夜里靠这 6 圈认形）
            const rr = radii[i + 1] + 0.3;
            put(g, CYL(rr, rr, 0.3, 10), twrTrim, 0, y + SEG_H - 0.15, 0);
            put(g, CYL(rr + 0.04, rr + 0.04, 0.1, 10), twrNeonC, 0, y + SEG_H - 0.3, 0);
        }
        // 下半段斜交
        for (let k = 0; k < 8; k++) {
            barStrut(g, k * (Math.PI * 2 / 8), y0 + 0.6, y0 + 26, 5.15, 2.35, 0.18, twrNeonV);
        }
        // 笋尖
        put(g, CONE(1.5, 7.6, 8), twrMass, 0, y0 + 44.4 + 3.8, 0);
        put(g, SPH(0.34, 8, 6), twrNeonA, 0, y0 + 52.6, 0);
        put(g, new THREE.PlaneGeometry(6, 6), twrHaloV, 0, y0 + 20, 0, [0, IN * Math.PI / 2, 0]);
    }

    // -----------------------------------------------------------------
    //  新增 4 座地标（国贸大厦 / 国贸CBD / 杭州之门 / 苏州东方之门）
    //
    //  共同的硬约束：街宽 7.6m、路缘在 |x|=3.8、人行道到 |x|=10.6，
    //  地标轴心贴在街墙线 x=±12，所以 **X 向占地必须 ≤16m**，否则塔身会压到马路上。
    //  真实尺寸（国贸 33m 见方、杭州之门总宽 25m、东方之门 22m）在这里必须压比例，
    //  识别一律靠「剪影 + 比例」而不是绝对尺寸。
    //  光效完全复用现有材质与亮度预算，不新增任何发光材质。
    // -----------------------------------------------------------------

    // 北京国贸大厦（国贸三期）：方塔三段收分 + 灯笼冠
    // 识别三件套：① 方（不是圆柱也不是棱柱）② 三段阶梯收分 ③ 顶部暖色灯笼冠
    function landmarkGuomao(g, IN, y0) {
        // [底宽, 顶宽, 段高] —— 收分靠阶梯叠出来，保持方塔的硬边
        // 主体必须用带贴图的 twrWinCool（twrMass/twrMassLt 没有 map，WINBOX 的窗格 UV 会白给）
        const segs = [[13, 12, 16], [12, 10, 15], [10, 8.6, 14]];
        let y = y0;
        for (let i = 0; i < segs.length; i++) {
            const [b, t, h] = segs[i];
            put(g, WINBOX(b, h, b), twrWinCool, 0, y + h / 2, 0);
            // 段间光缝（夜里靠这三道横线读出"三段"）
            put(g, BOX(b + 0.1, 0.1, b + 0.1), twrNeonL, 0, y + h, 0);
            y += h;
        }
        // 四角竖棱：只做最下段（0~16m），这一段在玩家近距离视野里
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                put(g, BOX(0.16, 15.4, 0.16), twrNeonC, sx * 6.42, y0 + 7.7, sz * 6.42);
            }
        }
        // 灯笼冠：暖窗格 + 一圈琥珀环（这座唯一的"彩色光点"，落在 46m 以上）
        const crownY = y0 + 45;
        put(g, WINBOX(9.2, 5.6, 9.2), twrWinWarm, 0, crownY + 2.8, 0);
        put(g, TOR(6.6, 0.16, 4, 16), twrNeonA, 0, crownY + 0.4, 0, [Math.PI / 2, 0, 0]);
        put(g, TOR(6.6, 0.12, 4, 16), twrNeonA, 0, crownY + 5.4, 0, [Math.PI / 2, 0, 0]);
        // 收头 + 天线
        put(g, BOX(7.2, 1.1, 7.2), twrTrim, 0, crownY + 6.2, 0);
        put(g, BOX(0.22, 3.6, 0.22), twrNeonA, 0, crownY + 8.5, 0);
        put(g, new THREE.PlaneGeometry(7, 7), twrHaloC, 0, crownY + 3, 0, [0, IN * Math.PI / 2, 0]);
    }

    // 北京国贸CBD：4 栋高低错落的金融区塔群（群体剪影，不是单栋）
    // 识别特征：① 一簇而不是一栋 ② 高度参差（34/52/40/46）③ 每栋都有竖向光鳍
    function landmarkCbd(g, IN, y0) {
        // [局部 x, 局部 z, 宽, 高, 材质, 是否暖窗]
        // 主体一律用带贴图的窗材质（twrMass / twrMassLt 无 map，出纯色块）
        const blocks = [
            [-1.0, -9.0, 8.6, 52, twrWinCool, false],
            [1.6, -2.4, 7.8, 38, twrWinWarm, true],
            [-1.8, 4.2, 7.2, 46, twrWinCool, false],
            [1.2, 10.2, 8.0, 34, twrWinWarm, true],
        ];
        for (const [bx, bz, w, h, mat, warm] of blocks) {
            put(g, WINBOX(w, h, w), mat, bx, y0 + h / 2, bz);
            // 顶盖
            put(g, BOX(w + 0.6, 0.5, w + 0.6), twrTrim, bx, y0 + h + 0.25, bz);
            // 竖向光鳍（朝街那一面）
            put(g, BOX(0.14, h * 0.78, 0.14), warm ? twrNeonA : twrNeonC,
                bx + IN * (w / 2 + 0.09), y0 + h * 0.42, bz);
            // 楼顶航空障碍灯
            put(g, SPH(0.3, 8, 6), twrNeonA, bx, y0 + h + 1.2, bz);
        }
        // 群体基座：把 4 栋串成一片（没有它就是一排孤立的塔）
        put(g, BOX(15, 0.5, 26), plazaMat, 0, y0 + 0.25, 0.6);
        put(g, new THREE.PlaneGeometry(7, 7), twrHaloC, 0, y0 + 34, 0, [0, IN * Math.PI / 2, 0]);
    }

    // 杭州之门（杭州世纪中心）：双腿平行 + 顶部弧形连桥，整体是「H」
    // 与苏州东方之门的区分：**这条腿是竖直的**（东方之门是向内收的），连桥在 40~48m 占顶部 1/6
    function landmarkGateHangzhou(g, IN, y0) {
        const LEG_X = 5.6, LEG_W = 5.2, LEG_H = 40;
        for (const s of [-1, 1]) {
            put(g, WINBOX(LEG_W, LEG_H, LEG_W), twrWinCool, s * LEG_X, y0 + LEG_H / 2, 0);
            // 内侧竖向光带（把"两腿之间"的洞框出来）
            put(g, BOX(0.16, LEG_H * 0.92, 0.16), twrNeonC, s * (LEG_X - LEG_W / 2 - 0.1), y0 + LEG_H * 0.46, 0);
            // 外侧竖向光带
            put(g, BOX(0.14, LEG_H * 0.7, 0.14), twrNeonV, s * (LEG_X + LEG_W / 2 + 0.08), y0 + LEG_H * 0.35, 0);
            // 腿顶收头
            put(g, BOX(LEG_W + 0.7, 0.6, LEG_W + 0.7), twrTrim, s * LEG_X, y0 + LEG_H + 0.3, 0);
        }
        // 连桥：三段叠出轻微上拱（纯平的一条会读成"两根柱子加一根横梁"）
        const by = y0 + LEG_H;
        put(g, WINBOX(LEG_X * 2 + 1.0, 2.6, 5.4), twrWinCool, 0, by + 1.3, 0);
        put(g, BOX(LEG_X * 2 - 1.4, 2.2, 4.6), twrMassLt, 0, by + 3.6, 0);
        put(g, BOX(LEG_X * 2 - 3.6, 1.8, 3.8), twrMassLt, 0, by + 5.6, 0);
        // 桥底霓虹 + 桥顶霓虹（"门"的上下沿）
        put(g, BOX(LEG_X * 2 + 1.1, 0.12, 0.12), twrNeonC, 0, by + 0.05, 0);
        put(g, BOX(LEG_X * 2 - 3.5, 0.12, 0.12), twrNeonV, 0, by + 6.5, 0);
        // 顶灯
        put(g, SPH(0.32, 8, 6), twrNeonA, 0, by + 7.2, 0);
        put(g, new THREE.PlaneGeometry(6, 6), twrHaloV, 0, by + 2, 0, [0, IN * Math.PI / 2, 0]);
    }

    // 苏州东方之门：双腿向内收、顶部合拢的拱门（"秋裤"剪影）
    // 与杭州之门的区分：**腿是斜的**（4 段阶梯内收，底部跨度 15.2 → 顶部 5.4），顶部是合拢的实体而不是连桥
    function landmarkGateSuzhou(g, IN, y0) {
        const SEGS = 4, SEG_H = 10;
        const X0 = 6.0, DX = 1.28;      // 每段向内收 1.28m
        for (const s of [-1, 1]) {
            for (let i = 0; i < SEGS; i++) {
                const x = s * (X0 - i * DX);
                const y = y0 + i * SEG_H;
                put(g, WINBOX(5.0, SEG_H + 0.6, 5.0), i % 2 ? twrWinCool : twrWinWarm, x, y + SEG_H / 2, 0);
                // 每段外侧的斜向光带（跟着收分走，强化"腿在往中间收"）
                put(g, BOX(0.15, SEG_H * 0.9, 0.15), twrNeonC,
                    x + s * 2.62, y + SEG_H * 0.5, 0);
                // 段间光缝
                put(g, BOX(5.3, 0.1, 5.3), twrNeonL, x, y + SEG_H, 0);
            }
        }
        // 顶部合拢：两腿在 40m 处并到一起，再往上是一整块
        const topY = y0 + SEGS * SEG_H;
        put(g, WINBOX(11.6, 6.4, 5.4), twrWinWarm, 0, topY + 3.2, 0);
        put(g, BOX(12.2, 0.7, 6.0), twrTrim, 0, topY + 6.6, 0);
        // 门洞下沿：一条横贯的光带，把"洞"的底边画出来（这是拱门最强的识别线）
        put(g, BOX(11.0, 0.14, 0.14), twrNeonA, 0, topY + 0.02, 0);
        // 拱顶轮廓：3 段递减的横线，做出向上收的弧
        put(g, BOX(9.0, 0.12, 0.12), twrNeonV, 0, topY + 2.4, 0);
        put(g, BOX(6.2, 0.12, 0.12), twrNeonV, 0, topY + 4.2, 0);
        put(g, SPH(0.32, 8, 6), twrNeonA, 0, topY + 7.4, 0);
        put(g, new THREE.PlaneGeometry(6, 6), twrHaloC, 0, topY - 6, 0, [0, IN * Math.PI / 2, 0]);
    }

    // -----------------------------------------------------------------
    //  塔位网格：12 槽 × 27m = 324m（= THEMES.city.span）
    //  7 座地标：同侧间距 ≥3 槽（81m），跨侧互不遮挡，所以左右两侧独立排
    const SLOT_N = 12, SLOT_PITCH = 27, SLOT_Z0 = 24;
    //  左：s0 东方明珠 / s3 国贸大厦 / s6 春笋 / s9 东方之门（间距 3/3/3/3，含 9→0 环绕）
    //  右：s1 杭州之门 / s4 小蛮腰 / s7 国贸CBD（间距 3/3/6）
    //  跨街相邻四对的剪影互不相同：球↔H / 方↔腰 / 锥↔群 / 拱↔（常规塔）
    const LM_LEFT = { 0: 'pearl', 3: 'guomao', 6: 'bamboo', 9: 'gateSuzhou' };
    const LM_RIGHT = { 1: 'gateHangzhou', 4: 'waist', 7: 'cbd' };
    // 每座地标的广场开口宽度：老的三座保持 27m 标准口，新的四座收窄到 18m（保住街道峡谷感）
    // 邻位让位：kind -> 紧邻槽位的塔高度倍率
    // 邻位让位：地标两侧的塔按倍率压低，给地标留出天际线。
    // 原来只对两个「宽扁」模型生效；现在 7 座全给——72m 的东方明珠旁边
    // 再杵一栋 64m 的塔，从街上看还是糊成一团。
    const LM_NEIGHBOR_LOW = {
        pearl: 0.44, waist: 0.46, bamboo: 0.50, guomao: 0.52,
        cbd: 0.30, gateSuzhou: 0.38, gateHangzhou: 0.40,
    };
    function neighborHMul(map, s) {
        for (const d of [-1, 1]) {
            const k = (s + d + SLOT_N) % SLOT_N;
            const kind = map[k];
            if (kind && LM_NEIGHBOR_LOW[kind]) return LM_NEIGHBOR_LOW[kind];
        }
        return 1;
    }

    const LM_OPEN = {
        pearl: 26, waist: 26, bamboo: 26,
        guomao: 18, cbd: 18, gateHangzhou: 18, gateSuzhou: 18,
    };
    // 每座地标的塔基尺寸（X 向 ≤16m：街宽 7.6 + 两侧人行道，超过就会压到马路）
    const LM_BASE = {
        pearl: [10, 12], waist: [10, 12], bamboo: [11, 12],
        guomao: [14, 12], cbd: [15, 26], gateHangzhou: [15, 10], gateSuzhou: [14, 10],
    };
    // 每座地标塔身的顶高（相对塔基 4m 之上的局部高度），只给「环上信标」定位用。
    // 数值来自各 landmarkXxx 里最上面那个构件，改动造型时要同步。
    const LM_TOP = {
        pearl: 53.5, waist: 49.5, bamboo: 52.8,
        guomao: 53.5, cbd: 55, gateHangzhou: 47.5, gateSuzhou: 47.5,
    };

    // 常规塔家族序列。
    // 旧实现是「从加权池里随机抽 + 事后首尾交换」，两个硬伤：
    //   · 事后交换只改了 s11，没复查 s11 与 s10 —— 交换本身会造出新的相邻同款（实测 28%）
    //   · pool 里 E/F 各只占 1/10，12 槽抽样经常漏型（实测六型齐全率仅 91%）
    // 改成「轮转铺满 + 轮内洗牌 + 校验重试」：
    //   · 每 6 槽必定把 A~F 各排一次 → 六型齐全 100%，权重均等
    //   · 同轮内元素互不相同 → 轮内相邻必然不同；只需校验轮边界与 324m 接缝
    //   · lmMap 里的槽位是地标，不参与相邻判定（地标本来就和塔不同款）
    //   · avoid 用来避免左右两侧同一槽撞成镜像
    function planFamilies(n, lmMap, avoid) {
        const fams = ['A', 'B', 'C', 'D', 'E', 'F'];
        const isLm = (i) => !!(lmMap && lmMap[i]);
        const build = () => {
            const a = new Array(n);
            for (let i = 0; i < n; i++) a[i] = fams[i % fams.length];
            for (let r = 0; r < n; r += fams.length) {
                const hi = Math.min(n, r + fams.length);
                for (let i = hi - 1; i > r; i--) {
                    const j = r + Math.floor(Math.random() * (i - r + 1));
                    const t = a[i]; a[i] = a[j]; a[j] = t;
                }
            }
            return a;
        };
        const ok = (a) => {
            // 每一侧（去掉地标槽之后）单独看也必须六型齐全，
            // 否则会出现"这一侧缺圆筒"的情况（整条街仍齐全，但单侧不齐）
            const seen = new Set();
            let slots = 0;
            for (let i = 0; i < n; i++) if (!isLm(i)) { seen.add(a[i]); slots++; }
            if (slots >= fams.length && seen.size < fams.length) return false;
            for (let i = 0; i < n; i++) {
                if (avoid && avoid[i] && a[i] === avoid[i]) return false;
                const j = (i + 1) % n;
                if (isLm(i) || isLm(j)) continue;
                if (a[i] === a[j]) return false;
            }
            return true;
        };
        for (let t = 0; t < 400; t++) {
            const a = build();
            if (ok(a)) return a;
        }
        // 兜底：未洗牌的轮转序列天然满足「相邻不同 + 六型齐全」
        const a = new Array(n);
        for (let i = 0; i < n; i++) a[i] = fams[i % fams.length];
        return a;
    }

    function makeTower(side, family, hMul) {
        const g = new THREE.Group();
        const IN = -side;               // 朝街道的方向（局部坐标）
        podium(g, IN, family === 'D');
        let H = family === 'A' ? rand(40, 64)
            : family === 'B' ? rand(34, 52)
                : family === 'C' ? rand(38, 58)
                    : family === 'D' ? rand(44, 60)
                        : family === 'E' ? rand(32, 48)
                            : rand(36, 50);
        // 邻位让位：CBD / 东方之门是「宽扁」模型，归一化后只有 12.7m / 16.2m 高。
        // 紧邻槽位若还是 40~64m 的塔，从街上看它们的体块会把地标围住，
        // 看起来像「卡在大楼里」。按倍率压低邻塔，给地标留出天际线（下限 15m）。
        if (hMul && hMul !== 1) H = Math.max(15, H * hMul);
        ({ A: towerA, B: towerB, C: towerC, D: towerD, E: towerE, F: towerF })[family](g, IN, H);
        // 塔顶信标：整条街 48 栋楼，只靠它把「高度」读出来
        const beaconGeo = geo('beacon', () => new THREE.PlaneGeometry(2.6, 2.6));
        const topY = PODIUM_H + H + 1.0;
        for (let k = 0; k < 2; k++) {
            const b = new THREE.Mesh(beaconGeo, beaconMat);
            b.rotation.y = k * Math.PI / 2;
            b.position.set(0, topY, 0);
            g.add(b);
        }
        g.position.x = side * 20;
        return g;
    }

    // 地标：广场开口 + 轴心贴在街墙线（x=±12），轮廓直接对天空
    const LM_BASE_H = 4;
    const LM_BUILD = {
        pearl: landmarkPearl, waist: landmarkWaist, bamboo: landmarkBamboo,
        guomao: landmarkGuomao, cbd: landmarkCbd,
        gateHangzhou: landmarkGateHangzhou, gateSuzhou: landmarkGateSuzhou,
    };
    function makeLandmark(side, kind) {
        const g = new THREE.Group();
        const IN = -side, OUT = side;
        plaza(g, OUT, LM_OPEN[kind]);
        // 塔基：比常规基座矮，让地标下半段露在广场口。
        // 宽度按地标各自的占地给（X 向一律 ≤16m，见 LM_BASE 的注释）
        const [BW, BD] = LM_BASE[kind] || [10, 12];
        put(g, BOX(BW, LM_BASE_H, BD), stoneMat, 0, LM_BASE_H / 2, 0);
        put(g, BOX(BW + 1.2, 0.3, BD + 1.2), twrTrim, 0, LM_BASE_H - 0.15, 0);
        put(g, BOX(BW + 1.3, 0.1, BD + 1.3), twrNeonC, 0, LM_BASE_H - 0.34, 0);
        // 街面橱窗带（0.4~2.8m，唯一允许出现在这个高度带的自发光）
        put(g, new THREE.PlaneGeometry(Math.min(BW - 1, 13), 2.4), twrShop,
            IN * (BW / 2 + 0.03), 1.6, 0, [0, IN * Math.PI / 2, 0]);
        // 塔身：优先用美术做的 GLB（有就替换），没有就回退到代码生成。
        // 广场、台基、街墙开口、槽位全部不变——GLB 只接管「台基顶面往上」这一段，
        // 所以 324m 循环和亮度分层仍然由这套代码兜着。
        if (!(LMGLB && LMGLB.build(g, kind, IN, LM_BASE_H))) {
            (LM_BUILD[kind] || landmarkBamboo)(g, IN, LM_BASE_H);
        } else {
            // 有 GLB 就整组退出「按材质大合并」：GLB 自带贴图和材质，合并会把
            // 不同贴图的几何烘到一起（画面出错），而且合并后新 mesh 不带 userData，
            // 探针/调试会完全看不到这栋楼存在。
            g.userData.noMerge = true;
        }
        g.position.x = side * 12;
        return g;
    }

    // -----------------------------------------------------------------
    //  终点地标环：6 座特色地标单独摆成一个圆（由主模块在传送门生成时调用）
    //
    //  与街道版 makeLandmark 的差别：
    //   · 没有「街墙开口」广场，改成一座圆形典礼台基（正面朝环心）
    //   · 位置 / 朝向由调用方给：这里只建在原点、正面朝局部 -x
    //   · 台基仍是 4m（= LM_BASE_H），塔身尺度与街道版完全一致
    //
    //  为什么另起一套：街道版把地标贴在 x=±12 的街墙上，背后还压着一整块广场铺地，
    //  直接搬过来摆成一圈会互相穿插；环上每座地标只需要「台基 + 塔身」。
    //  另外环上只被 100m 外的过场镜头看到，细部可以省，台基的两圈霓虹不能省。
    // -----------------------------------------------------------------
    function makeRingLandmark(kind, bodyScale) {
        const g = new THREE.Group();
        const [BW] = LM_BASE[kind] || [10, 12];
        const R = Math.max(7.6, BW * 0.64);             // 台基半径

        // 三级圆台：底盘 → 台身 → 台顶压边（顶面正好 4m，塔身从这里起）
        put(g, CYL(R + 2.4, R + 2.8, 0.5, 28), stoneMat, 0, 0.25, 0);
        put(g, CYL(R, R + 2.4, 3.1, 28), stoneMat, 0, 2.05, 0);
        put(g, CYL(R * 0.88, R, 0.4, 28), twrTrim, 0, 3.8, 0);
        // 台顶 / 台底两圈霓虹：100m 外认「这是一座典礼台」全靠这两圈
        put(g, TOR(R * 0.92, 0.16, 4, 32), twrNeonC, 0, 4.04, 0, [Math.PI / 2, 0, 0]);
        put(g, TOR(R + 2.65, 0.12, 4, 32), twrNeonV, 0, 0.52, 0, [Math.PI / 2, 0, 0]);
        // 地面光池（水平贴地，只照台基脚下）
        put(g, new THREE.PlaneGeometry(R * 4.6, R * 4.6), twrHaloC, 0, 0.08, 0, [-Math.PI / 2, 0, 0]);
        // 台基四周 8 根灯柱（竖向节奏，否则台基读成一块圆饼）
        for (let k = 0; k < 8; k++) {
            const a = k * Math.PI / 4 + Math.PI / 8;
            const x = Math.sin(a) * (R + 1.6), z = Math.cos(a) * (R + 1.6);
            put(g, BOX(0.44, 2.4, 0.44), twrTrim, x, 1.2, z);
            put(g, BOX(0.15, 1.8, 0.15), k % 2 ? twrNeonA : twrNeonC, x, 2.7, z);
        }
        // 塔身：单独一组、绕台基顶面缩放。
        // 整组一起放大（连台基）会得到一张 20m 半径的大圆盘，从空中看像 UFO；
        // 只有塔身放大，才是「小基座 + 高塔」的比例，塔也才从城市森林里拔出来。
        const body = new THREE.Group();
        body.position.y = LM_BASE_H;
        body.scale.setScalar(bodyScale > 0 ? bodyScale : 1);
        g.add(body);
        // 环上版同样优先用 GLB；y0 传 0（缩放和抬升交给外层 body）
        if (!(LMGLB && LMGLB.build(body, kind, -1, 0))) {
            (LM_BUILD[kind] || landmarkBamboo)(body, -1, 0);
        } else {
            g.userData.noMerge = true;   // 同上：有 GLB 的整座典礼台都不进合并
        }

        // ---- 识别信标：一条贯穿正面的霓虹脊 + 塔顶一颗灯 ----
        // 从 150m 外看，塔身只是一团暗色体块，跟周围 40~64m 的普通楼糊在一起。
        // 真正能让人一眼认出「这是哪一座」的，是这条竖线和顶上那颗灯：
        // 镜头绕一圈，六颗灯依次扫过画面，环就成立了。
        const s = bodyScale > 0 ? bodyScale : 1;
        const topY = LM_BASE_H + (LM_TOP[kind] || 52) * s;
        const halfW = BW * 0.5 * s;
        // 竖脊：两段（下段贴着塔基、上段顺着收分往里挪一点），避免整根悬空
        const y0 = LM_BASE_H + 1.5, y1 = topY - 2;
        const mid = (y0 + y1) / 2;
        put(g, BOX(0.42, y1 - y0, 0.42), twrNeonA, -halfW * 0.72, mid, 0);
        put(g, BOX(0.30, y1 - y0, 0.30), twrNeonC, halfW * 0.72, mid, 0);
        // 塔顶信标：球 + 十字光晕（光晕要 fog:false 才穿得过夜雾，和金色新葡京一致）
        put(g, SPH(1.5, 10, 8), twrNeonA, 0, topY + 1.2, 0);
        put(g, TOR(3.2, 0.22, 4, 20), twrNeonC, 0, topY + 0.2, 0, [Math.PI / 2, 0, 0]);
        for (const rot of [0, Math.PI / 2]) {
            const halo = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), ringBeaconMat);
            halo.position.set(0, topY + 1.2, 0);
            halo.rotation.y = rot;
            g.add(halo);
        }
        return g;
    }

    // 二排背景塔（只做剪影与纵深，退到 x = ±50 不与地标广场打架）
    function backTower(side, i) {
        const g = new THREE.Group();
        const H = rand(46, 72), W = rand(12, 16), D = rand(12, 16);
        put(g, WINBOX(W, H, D), i % 2 ? twrWinCool : twrMass, 0, H / 2, 0);
        put(g, BOX(0.16, H * 0.7, 0.16), i % 3 ? twrNeonC : twrNeonV, -side * (W / 2 + 0.1), H * 0.42, 0);
        put(g, BOX(W * 0.7, 0.2, 0.2), twrNeonA, 0, H - 1.5, 0);
        g.position.x = side * 50;
        return g;
    }

    // -----------------------------------------------------------------
    //  赛博街道：地面 / 霓虹车道 / 路缘光带 / 天际线
    // -----------------------------------------------------------------
    function buildWorld() {
        THEMES.city.texScroll = [[roadTex, 6.07]];

        // 外层地面（暗色，衬出霓虹；加宽到塔基之外，避免露出虚空）
        addMesh(flat(120, 340), groundMat, 0, -0.04, -150);
        // 湿沥青主路
        addMesh(flat(7.6, 340), roadMat, 0, 0.02, -150);

        for (const s of [-1, 1]) {
            // 人行道（略高）
            addMesh(flat(6.6, 340), walkMat, s * 7.3, 0.12, -150);
            // 路缘石
            addMesh(new THREE.BoxGeometry(0.24, 0.26, 340), stoneMat, s * 3.92, 0.13, -150);
            // 路缘霓虹光带（洋红）
            addMesh(flat(0.16, 340), neonPinkMat, s * 3.74, 0.035, -150);
            addMesh(flat(0.9, 340), laneGlowMat, s * 3.74, 0.03, -150);
            // 人行道内侧青色导光条
            addMesh(flat(0.12, 340), neonCyanMat, s * 4.14, 0.13, -150);
            addMesh(flat(0.7, 340), laneGlowMat, s * 4.14, 0.125, -150);
        }
        // 车道分隔霓虹线 + 地面反光晕
        for (const x of [-1.2, 1.2]) {
            addMesh(flat(0.1, 340), neonCyanMat, x, 0.035, -150);
            addMesh(flat(0.62, 340), laneGlowMat, x, 0.03, -150);
        }
        // 天桥式霓虹拱（静态地标，每 108m 一座）
        for (let i = 0; i < 3; i++) {
            const arch = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.13, 6, 22, Math.PI), i % 2 ? archPinkMat : archCyanMat);
            arch.position.set(0, 4.4, -26 - i * 108);
            worldGroup.add(arch);
            for (const s of [-1, 1]) {
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 4.6, 8), cableMat);
                post.position.set(s * 5.4, 2.3, -26 - i * 108);
                worldGroup.add(post);
                const neon = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4.4, 0.14), i % 2 ? archPinkMat : archCyanMat);
                neon.position.set(s * 5.4, 2.3, -26 - i * 108 + 0.2);
                worldGroup.add(neon);
            }
        }
        // 远景赛博天际线（两层，暗楼 + 窗光；拉近到雾区以内才有体积感）
        for (let layer = 0; layer < 2; layer++) {
            for (let i = 0; i < 15; i++) {
                const w = rand(12, 26), h = rand(26, 62) - layer * 6;
                const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, 9), layer ? towerMatB : towerMatA);
                const side = i % 2 ? 1 : -1;
                const dist = 56 + Math.floor(i / 2) * 26 + rand(-6, 6);
                tower.position.set(side * dist, h / 2 - 3, -78 - layer * 30 - rand(0, 12));
                worldGroup.add(tower);
                // 楼顶霓虹条
                const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.26, 0.26), layer ? neonPinkMat : neonCyanMat);
                cap.position.set(tower.position.x, h - 2, tower.position.z + 4.6);
                worldGroup.add(cap);
                // 楼体竖向导光条
                const strip = new THREE.Mesh(new THREE.BoxGeometry(0.18, h * 0.8, 0.18), layer ? neonCyanMat : neonPinkMat);
                strip.position.set(tower.position.x - w * 0.42, h * 0.5, tower.position.z + 4.6);
                worldGroup.add(strip);
            }
        }
    }

    // -----------------------------------------------------------------
    //  装饰：高塔、霓虹灯柱、蒸汽、全息广告、电缆
    // -----------------------------------------------------------------
    function makeNeonPole(side) {
        const g = new THREE.Group();
        const mat = side > 0 ? archPinkMat : archCyanMat;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.6, 8), cableMat);
        pole.position.y = 2.3;
        g.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), cableMat);
        arm.position.set(-side * 0.45, 4.5, 0);
        g.add(arm);
        const tube = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.1), mat);
        tube.position.set(-side * 0.9, 4.42, 0);
        g.add(tube);
        const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.4), neonHaloMat);
        halo.rotation.x = -Math.PI / 2;
        halo.position.set(-side * 0.9, 0.06, 0);
        g.add(halo);
        // 地面光池（把霓虹灯下的湿地面照亮，是本作街道光感的关键）
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 6.2), side > 0 ? poolPinkMat : poolCyanMat);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(-side * 0.6, 0.05, 0);
        g.add(pool);
        g.position.x = side * 4.55;
        return g;
    }

    function makeHoloBillboard(side, i) {
        const g = new THREE.Group();
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), holoMat);
        panel.rotation.y = side > 0 ? -Math.PI / 2 + 0.35 : Math.PI / 2 - 0.35;
        panel.position.y = 7.2;
        g.add(panel);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 6.6, 8), cableMat);
        pole.position.y = 3.3;
        g.add(pole);
        const halo = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.6), neonHaloMat);
        halo.rotation.y = panel.rotation.y;
        halo.position.set(0, 7.2, 0);
        g.add(halo);
        g.position.x = side * 9.2;
        return g;
    }

    function buildDecor() {
        // 12 槽 × 双侧 = 24 个塔位；地标占 3 个
        // 右列把左列同槽的家族作为 avoid，避免两侧镜像成同一款
        const planL = planFamilies(SLOT_N, LM_LEFT);
        const planR = planFamilies(SLOT_N, LM_RIGHT,
            planL.map((f, i) => (LM_LEFT[i] || LM_RIGHT[i]) ? null : f));
        for (let s = 0; s < SLOT_N; s++) {
            const z = SLOT_Z0 - s * SLOT_PITCH;
            const lmL = LM_LEFT[s], lmR = LM_RIGHT[s];
            addScenery(lmL ? makeLandmark(-1, lmL) : makeTower(-1, planL[s], neighborHMul(LM_LEFT, s)), z);
            addScenery(lmR ? makeLandmark(1, lmR) : makeTower(1, planR[s], neighborHMul(LM_RIGHT, s)), z);
        }
        // 二排背景塔（6 槽 × 54m = 324m）
        for (let i = 0; i < 6; i++) {
            const z = 12 - i * 54;
            addScenery(backTower(-1, i), z);
            addScenery(backTower(1, i + 1), z);
        }
        // 霓虹路灯
        for (let i = 0; i < 12; i++) {
            const side = i % 2 ? 1 : -1;
            addScenery(makeNeonPole(side), 6 - i * 27);
        }
        // 全息广告
        for (let i = 0; i < 3; i++) {
            addScenery(makeHoloBillboard(i % 2 ? 1 : -1, i), -40 - i * 96);
        }
        // 横跨街道的电缆束
        for (let i = 0; i < 9; i++) {
            const g = new THREE.Group();
            for (let k = 0; k < 3; k++) {
                const wire = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.045, 0.045), cableMat);
                wire.position.set(0, 6.4 + k * 0.16, 0);
                g.add(wire);
            }
            addScenery(g, 3 - i * 37);
        }
        // 地面蒸汽（交叉双面片，两张互成 90° 代替 Sprite 的始终朝相机）
        const steamQuad = geo('pq1', () => new THREE.PlaneGeometry(1, 1));
        for (let i = 0; i < 10; i++) {
            const g = new THREE.Group();
            const w = rand(1.6, 3.0), h = rand(1.2, 2.2);
            for (let k = 0; k < 2; k++) {
                const p = new THREE.Mesh(steamQuad, steamMat);
                p.scale.set(w, h, 1);
                p.rotation.y = k * Math.PI / 2;
                g.add(p);
            }
            g.position.set(pick([-4.7, 4.7]), rand(0.3, 0.6), 0);
            addScenery(g, 10 - i * 33);
        }
        // 地面霓虹反光（贴在路面上，跟随店铺滚动）
        for (let i = 0; i < 8; i++) {
            const r = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 5.5), reflMat);
            r.rotation.set(-Math.PI / 2, 0, 0);
            r.position.set(pick([-2.2, 2.2]), 0.045, 0);
            addScenery(r, 18 - i * 41);
        }
        // 路面积水（拉长的高光椭圆，反射两侧霓虹）
        for (let i = 0; i < 14; i++) {
            const p = new THREE.Mesh(new THREE.PlaneGeometry(rand(1.8, 3.4), rand(6, 12)), puddleMat);
            p.rotation.set(-Math.PI / 2, 0, 0);
            p.position.set(rand(-2.8, 2.8), 0.05, 0);
            addScenery(p, 20 - i * 22 + rand(-6, 6));
        }
    }

    return { buildWorld, buildDecor, roadTex, makeRingLandmark };
}

const ATMO = createAtmo({ THREE, scene, camera, hemi, sun });
attachAtmo(ATMO);   // 把天气密度/霓虹灯的开关交给性能档位统一管

// 地标 GLB 接入层：美术模型放在 assets/landmarks/*.glb，加载后注册进来。
// 没注册的 kind 会自动回退到 js/oldtown.js 里的代码生成版本，所以模型没做好也不影响上线。
// ---- 内联模块：js/landmarks.js（地标 GLB 接入） ----
// ============================================================================
//  js/landmarks.js —— 地标 GLB 接入层
//
//  作用：把美术做的 .glb 地标接进「代码生成」的那套体系里，同时保住三件事：
//    · 324m 循环（槽位、广场、台基仍由 oldtown.js 负责，GLB 只填塔身）
//    · 亮度预算（材质按名字分类，自动挂上 ATMO 的昼夜发光曲线）
//    · 性能（每个 GLB 原型只加载一次，放置时 clone；材质共享，不重复编译）
//
//  建模约定（美术必须遵守，详见 docs/landmark-glb-spec.md）：
//    · 单位是米，原点在「底面中心」，y=0 就是地面
//    · 正面朝局部 -x（接入时会按街道左右自动转 180°）
//    · 材质名带语义：window / neon / trim / mass，接入时按名字注入发光
//
//  夜间灯光（2026-11-01 重做，第二版）：
//    这几座 GLB 都是「单材质 + 白天烘焙贴图」，墙面比窗还亮。之前拿贴图当
//    emissiveMap 再整体提亮，夜里就是一整块发白的板子（没有层次、更谈不上灯效）。
//
//    现在的做法是**用几何灯带**：
//      ① 注册时扫一遍顶点，按 2m 一层、24 个方位记下「每层的截面半径」——等于
//         给模型拍了一张低分辨率的侧面轮廓。
//      ② 按 11 个高度（8%~91%）生成光带，每根光带的半径取该高度实测轮廓的 1.04 倍，
//         所以它是**贴着塔身**的：明珠的球面、春笋的收腰、国贸的方柱都对得上，
//         不会像圆环那样浮在半空。
//      ③ 颜色按高度走：脚部暖琥珀 → 塔身青白 → 冠部冷蓝，越往上越收敛。
//         再叠基座泛光池 / 冠部灯圈 / 塔顶红色信标，四层光从下往上读得出来。
//      ④ 全部烘进**一个顶点色 mesh**：加法混合，白天 opacity=0 完全隐形，
//         夜里由 ATMO 的昼夜曲线拉起来，一座地标只多 1 个 drawcall。
//
//    材质侧只做「压暗 + 一点点自发光」：贴图颜色乘 0.42，emissive 最多 0.12。
//    这样夜里塔身是暗的、光带是亮的，对比才出得来——反过来就是曝光。
//
//  设计取舍：
//    · GLB 不参与「按材质大合并」——它自带贴图和材质，合并不了。7 座地标各 1~3 个
//      材质，两份滚动副本 = 14~42 个 drawcall，这个代价必须认。
//    · 不用 onBeforeCompile 分层：这些模型的材质是 MeshPhysicalMaterial，
//      程序缓存 + 昼夜曲线每秒都在改 emissiveIntensity，注入的着色器很容易被
//      重新编译/复用成旧程序（实测改了半天没反应）。几何灯带是确定性的。
//    · 归一化只在注册时做一次（改几何、改材质），之后 clone 出来的实例共享全部资源。
//    · 没有 GLB 的 kind 自动回退到代码生成版本，所以这个模块可以在「模型还没做好」
//      的状态下直接上线，不会白屏。
// ============================================================================

function createLandmarkGLB({ THREE, ATMO }) {

    // kind -> { obj, tris, h, w, d, mats }
    const proto = new Map();

    // 街道版塔身的目标高度（从 4m 台基顶算起）。真实地标 53~58m，这里取 54。
    // 72m：普通塔楼 32~64m，地标要比它们高出一头，才能从街谷里拔出来
    const TARGET_H = 72;
    // 两个方向的上限完全不同，不能用一个数卡：
    //   X（进深，朝街道方向）：街宽 7.6m、路缘 |x|=3.8、地标轴心 x=±12 → 最多 16m
    //   Z（沿街方向）：槽距 27m、广场进深 26m → 最多 26m
    // 「门」类地标（东方之门 / 杭州之门）本来就是横向铺开的，用 X 的上限卡会把它们
    // 压成 16m 高的矮墩子；按 Z 的 26m 算，高度能到 26m 左右，才是「门」该有的比例。
    const MAX_X = 16;
    const MAX_Z = 26;
    const MAX_Z_BY_KIND = { cbd: 26 };

    // 轮廓采样：2m 一层 × 24 方位。再细就只是在给顶点数付利息，看不出差别。
    const SLICE_H = 2.0;
    const SECT = 24;

    // ---------------------------------------------------------------- 昼夜基色
    // 地标的 albedo 是「白天烘焙」的亮贴图：
    //   · 白天要保持原样（乘 0.52 已经有点压，再暗就成黑楼）
    //   · 夜里必须压到 0.07 左右，否则整座塔像混凝土一样发白，灯带对比全没了
    // 材质颜色不在 ATMO 的 glow 曲线里（那条曲线只管 emissiveIntensity），
    // 所以这里自己跟着 ATMO.state().night 做一次线性插值，每帧改 7 个颜色，成本可忽略。
    const tintMats = [];
    const TINT_DAY = new THREE.Color(0.52, 0.54, 0.58);
    const TINT_NIGHT = new THREE.Color(0.070, 0.082, 0.100);
    let tintTicking = false;

    function startTintTick() {
        if (tintTicking) return;
        tintTicking = true;
        const cur = new THREE.Color();
        const loop = () => {
            requestAnimationFrame(loop);
            if (!tintMats.length) return;
            const st = ATMO.state ? ATMO.state() : null;
            const n = st ? Math.max(0, Math.min(1, st.night || 0)) : 0;
            cur.copy(TINT_DAY).lerp(TINT_NIGHT, n);
            for (let i = 0; i < tintMats.length; i++) tintMats[i].color.copy(cur);
        };
        loop();
    }

    // ---------------------------------------------------------------- 材质分类
    // 名字里带什么词就归哪一类。分类决定「夜里怎么亮」，而不是「长什么样」——
    // 造型是美术的事，这里只管亮度预算，避免 GLB 把整条街照糊。
    function classify(name, mat) {
        const n = String(name || (mat && mat.name) || '').toLowerCase();
        if (/neon|glow|halo|light_?bar|led/.test(n)) return 'neon';
        if (/window|win|glass|curtain/.test(n)) return 'window';
        if (/trim|frame|edge|rib|mullion/.test(n)) return 'trim';
        return 'mass';
    }

    // 冷暖窗：名字里带 warm/amber 就是暖光，其余走冷光（和现有 twrWinWarm/Cool 一致）
    function isWarm(name) {
        return /warm|amber|gold|orange/i.test(String(name || ''));
    }

    // ---------------------------------------------------------------- 材质改写
    // GLB 的 PBR 材质在夜里几乎全黑（项目没有 environment map），但**不能**靠大功率
    // emissive 去补——那会变成一块发光板。这里只给一点点底光，把「存在感」交给灯带。
    function retint(mat, tag, name) {
        if (!mat) return mat;

        if (tag === 'neon') {
            // 霓虹线：换成 basic（颜色 × 昼夜系数），和 twrNeonC/V/A 完全同一套行为。
            const c = mat.color ? mat.color.clone() : new THREE.Color(0x00eaff);
            const nb = new THREE.MeshBasicMaterial({ color: c, fog: true });
            nb.name = mat.name;
            ATMO.registerGlow(nb, { kind: 'basic', base: 0.30, gain: 0.62 });
            return nb;
        }

        if (tag === 'window') {
            const warm = isWarm(name);
            mat.emissive = new THREE.Color(warm ? 0xffd68c : 0xbfe9ff);
            mat.emissiveIntensity = warm ? 0.05 : 0.04;
            ATMO.registerGlow(mat, { base: mat.emissiveIntensity, gain: warm ? 0.20 : 0.18 });
            return mat;
        }

        if (tag === 'trim') {
            mat.emissive = new THREE.Color(0x0a1220);
            mat.emissiveIntensity = 0.04;
            ATMO.registerGlow(mat, { base: 0.04, gain: 0.12 });
            return mat;
        }

        // mass：大面积塔身。夜里上限压到 0.132（0.012 + 0.12），永远低于车道线的 0.82。
        mat.emissive = new THREE.Color(0x14213a);
        mat.emissiveIntensity = 0.012;
        ATMO.registerGlow(mat, { base: 0.012, gain: 0.12 });
        return mat;
    }

    // ---------------------------------------------------------------- 轮廓扫描
    // 一次遍历三个产出：
    //   prof   —— 每层（2m）× 每方位（24）的最大半径（米），灯带就贴着它画
    //   crownX/crownZ —— 86%~96% 高度那圈的最大半宽，冠部灯圈用
    //   verts  —— 顶点数（调试用）
    function scanProfile(wrap, s, hM) {
        const SL = Math.max(4, Math.min(64, Math.ceil(hM / SLICE_H)));
        const prof = new Float32Array(SL * SECT);
        const inv = new THREE.Matrix4().copy(wrap.matrixWorld).invert();
        const rel = new THREE.Matrix4();
        const v = new THREE.Vector3();
        const out = { prof, SL, crownX: 0, crownZ: 0, verts: 0 };
        const TAU = Math.PI * 2;

        wrap.updateMatrixWorld(true);
        wrap.traverse(o => {
            if (!o.isMesh || !o.geometry) return;
            const p = o.geometry.attributes && o.geometry.attributes.position;
            if (!p) return;
            rel.multiplyMatrices(inv, o.matrixWorld);
            for (let i = 0; i < p.count; i++) {
                v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(rel);
                const ym = v.y * s;
                if (ym < 0) continue;
                const sl = Math.min(SL - 1, Math.floor(ym / SLICE_H));
                const r = Math.hypot(v.x, v.z) * s;
                if (r <= 0) continue;
                let sec = Math.floor((Math.atan2(v.z, v.x) + Math.PI) / TAU * SECT) % SECT;
                if (sec < 0) sec += SECT;
                const k = sl * SECT + sec;
                if (r > prof[k]) prof[k] = r;
                // 冠部轮廓：只取 86%~96% 高度
                const h = ym / hM;
                if (h > 0.86 && h < 0.96) {
                    const ax = Math.abs(v.x) * s, az = Math.abs(v.z) * s;
                    if (ax > out.crownX) out.crownX = ax;
                    if (az > out.crownZ) out.crownZ = az;
                }
                out.verts++;
            }
        });
        return out;
    }

    // 某高度处的截面半径（取相邻两层、每个方位的最大值，避免正好落在凹槽里）
    function radiusAt(pr, SL, yM) {
        const sl = Math.max(0, Math.min(SL - 1, Math.round(yM / SLICE_H)));
        const out = new Float32Array(SECT);
        for (let sec = 0; sec < SECT; sec++) {
            let r = 0;
            for (let k = Math.max(0, sl - 1); k <= Math.min(SL - 1, sl + 1); k++) {
                const q = pr[k * SECT + sec];
                if (q > r) r = q;
            }
            out[sec] = r;
        }
        return out;
    }

    // ---------------------------------------------------------------- 表面分层
    // 给每个顶点烘一个 0~1 的高度（相对整座地标），着色器按它做三件事：
    //   _line  楼层灯线：每 4m 一条细亮线（占层高 24%），其余压暗
    //   _grad  竖向梯度：脚部 1.0 → 塔顶 0.45
    //   _tint  色温：脚部琥珀 → 塔身青白
    // 好处是灯线**长在模型表面上**，跟着球面/收腰/方柱走，不会有几何环浮空的问题。
    function bakeHeightAttr(wrap, heightRel) {
        const inv = new THREE.Matrix4().copy(wrap.matrixWorld).invert();
        const rel = new THREE.Matrix4();
        const v = new THREE.Vector3();
        let count = 0;
        wrap.updateMatrixWorld(true);
        wrap.traverse(o => {
            if (!o.isMesh || !o.geometry) return;
            const g = o.geometry;
            const p = g.attributes && g.attributes.position;
            if (!p) return;
            rel.multiplyMatrices(inv, o.matrixWorld);
            let a = g.getAttribute('aH');
            if (!a || a.count !== p.count) {
                a = new THREE.BufferAttribute(new Float32Array(p.count), 1);
                g.setAttribute('aH', a);
            }
            const arr = a.array;
            for (let i = 0; i < p.count; i++) {
                v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(rel);
                arr[i] = heightRel > 1e-6 ? v.y / heightRel : 0;
            }
            a.needsUpdate = true;
            count += p.count;
        });
        return count;
    }

    function addLayerShader(mat, opt) {
        const floors = Math.max(6, Math.min(30, Math.round((opt.hM || 60) / 4)));   // 每 4m 一层
        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uFloorN = { value: floors };
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nattribute float aH;\nvarying float vLH;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLH = aH;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying float vLH;\nuniform float uFloorN;')
                // 锚点用「声明 totalEmissiveRadiance」而不是 chunk：r160 的
                // meshmaterial 里 chunk 名能变，这句声明一直在（踩过：换错锚点
                // 会静默不生效 —— 顶点端改了、片元没改，塔身就是一片平光）。
                .replace('vec3 totalEmissiveRadiance = emissive;', [
                    'vec3 totalEmissiveRadiance = emissive;',
                    'float _lh = clamp( vLH, 0.0, 1.0 );',
                    'float _f = fract( _lh * uFloorN );',
                    'float _line = smoothstep( 0.0, 0.03, _f ) * ( 1.0 - smoothstep( 0.06, 0.13, _f ) );',
                    'float _wash = 0.10 + 0.90 * _line;',
                    'float _grad = mix( 1.0, 0.45, smoothstep( 0.05, 0.95, _lh ) );',
                    'vec3 _tint = mix( vec3( 1.00, 0.62, 0.30 ), vec3( 0.45, 0.78, 1.00 ), smoothstep( 0.08, 0.60, _lh ) );',
                    'totalEmissiveRadiance *= _tint * _grad * _wash;',
                ].join('\n'));
        };
        // 层数不同的地标必须分开编译，否则会共用同一个程序
        mat.customProgramCacheKey = () => 'lmBand/' + floors;
    }

    // ---------------------------------------------------------------- 灯带骨架
    // 四层光，全部烘进一个顶点色 mesh（加法混合 → 白天 opacity=0 隐形）：
    //   L0 基座泛光池（暖）→ L2 冠部灯圈（冷蓝）→ L3 信标（红）
    //   （塔身的竖向分层灯线由材质着色器负责，不占几何——见 addLayerShader）
    let rigMat = null;
    function getRigMaterial() {
        if (rigMat) return rigMat;
        rigMat = new THREE.MeshBasicMaterial({
            vertexColors: true, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
            side: THREE.DoubleSide, fog: true,
        });
        rigMat.name = 'lmRig';
        ATMO.registerGlow(rigMat, { kind: 'add', base: 0, gain: 0.95 });
        return rigMat;
    }

    function buildLightRig(pM, s, mat, scan) {
        const POS = [], COL = [];
        const vtx = (x, y, z, c) => { POS.push(x / s, y / s, z / s); COL.push(c[0], c[1], c[2]); };
        const tri = (a, b, c, col) => { vtx(a[0], a[1], a[2], col); vtx(b[0], b[1], b[2], col); vtx(c[0], c[1], c[2], col); };
        const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
        const TAU = Math.PI * 2;

        // L0 基座泛光：广场上一圈暖光池（半径按实测轮廓，别把光池铺到马路上去）
        let maxR = 0;
        for (let i = 0; i < scan.prof.length; i++) if (scan.prof[i] > maxR) maxR = scan.prof[i];
        const R = Math.max(3.2, Math.min(maxR * 0.95, 13));
        const RB = [0, 0.30, 0.55, 0.76, 0.90, 1.0];
        const SEG = 36;
        const ringCol = t => { const k = Math.pow(1 - t, 1.7) * 0.55; return [1.00 * k, 0.62 * k, 0.30 * k]; };
        for (let i = 0; i < RB.length - 1; i++) {
            const r0 = RB[i] * R, r1 = RB[i + 1] * R;
            const c0 = ringCol(RB[i]), c1 = ringCol(RB[i + 1]);
            for (let k = 0; k < SEG; k++) {
                const a0 = (k / SEG) * TAU, a1 = ((k + 1) / SEG) * TAU;
                const A = [Math.cos(a0) * r0, 0.12, Math.sin(a0) * r0];
                const B = [Math.cos(a0) * r1, 0.12, Math.sin(a0) * r1];
                const C2 = [Math.cos(a1) * r1, 0.12, Math.sin(a1) * r1];
                const D2 = [Math.cos(a1) * r0, 0.12, Math.sin(a1) * r0];
                vtx(A[0], A[1], A[2], c0); vtx(B[0], B[1], B[2], c1); vtx(C2[0], C2[1], C2[2], c1);
                vtx(A[0], A[1], A[2], c0); vtx(C2[0], C2[1], C2[2], c1); vtx(D2[0], D2[1], D2[2], c0);
            }
        }

        // L2 冠部灯圈：细长塔在 93.5% 套一圈冷蓝灯；宽扁的「门 / 群楼」跳过——
        // 它们的轮廓是横向铺开的，套圈会横穿马路（实测很怪）。
        const aspect = Math.max(pM.w, pM.d) / Math.max(pM.h, 1);
        if (aspect <= 0.55) {
            const yc = pM.h * 0.935;
            const rr = radiusAt(scan.prof, scan.SL, yc);
            const cCrown = [0.16, 0.32, 0.58];
            for (let sec = 0; sec < SECT; sec++) {
                const r0 = rr[sec], r1 = rr[(sec + 1) % SECT];
                if (r0 < 0.6 || r1 < 0.6) continue;
                const a0 = ((sec + 0.5) / SECT) * TAU - Math.PI;
                const a1 = ((sec + 1.5) / SECT) * TAU - Math.PI;
                const p00 = [Math.cos(a0) * r0 * 1.06, yc - 0.28, Math.sin(a0) * r0 * 1.06];
                const p01 = [Math.cos(a1) * r1 * 1.06, yc - 0.28, Math.sin(a1) * r1 * 1.06];
                const p02 = [Math.cos(a1) * r1 * 1.06, yc + 0.28, Math.sin(a1) * r1 * 1.06];
                const p03 = [Math.cos(a0) * r0 * 1.06, yc + 0.28, Math.sin(a0) * r0 * 1.06];
                quad(p00, p01, p02, p03, cCrown);
            }
        }

        // L3 塔顶信标：夜里天际线上唯一的红点（航空障碍灯）。交叉双面片，
        // 不用 Sprite —— Sprite 没有可烘焙几何，静态合并会把整对象吞掉。
        const yb = pM.h + 1.3, r = 1.5;
        const cBeacon = [0.85, 0.12, 0.08];
        quad([-r, yb - r, 0], [r, yb - r, 0], [r, yb + r, 0], [-r, yb + r, 0], cBeacon);
        quad([0, yb - r, -r], [0, yb - r, r], [0, yb + r, r], [0, yb + r, -r], cBeacon);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(POS, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(COL, 3));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = 'lmRig';
        mesh.userData.noMerge = true;      // 跟 GLB 一起退出静态合并（父组本来也是 noMerge）
        mesh.renderOrder = 3;
        return mesh;
    }

    // ---------------------------------------------------------------- 归一化
    function normalize(root, kind) {
        root.updateMatrixWorld(true);

        // ① 把「底面中心」挪到原点
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        root.position.x -= center.x;
        root.position.z -= center.z;
        root.position.y -= box.min.y;
        root.updateMatrixWorld(true);

        // ② 按高度缩放到 TARGET_H；再分别检查 X / Z 两个方向，超了按超得最多的那个缩
        const h = Math.max(size.y, 0.001);
        let s = TARGET_H / h;
        const maxZ = MAX_Z_BY_KIND[kind] || MAX_Z;
        const needX = (size.x * s) / MAX_X;
        const needZ = (size.z * s) / maxZ;
        const over = Math.max(needX, needZ, 1);
        let clipped = false;
        if (over > 1) {
            s /= over;
            clipped = true;
        }

        // 缩放包一层 Group，避免直接改美术模型的根变换（他们可能在根上打了旋转）
        const wrap = new THREE.Group();
        wrap.add(root);
        wrap.scale.setScalar(s);
        wrap.updateMatrixWorld(true);

        // ③ 最终尺寸 + 轮廓扫描（灯带要按真实高度/半径生成）
        const finalBox = new THREE.Box3().setFromObject(wrap);
        const finalSize = finalBox.getSize(new THREE.Vector3());
        const hM = finalSize.y;
        const lineVerts = bakeHeightAttr(wrap, hM / s);
        const scan = scanProfile(wrap, s, hM);

        // ④ 扫一遍：统计三角面、收集材质
        let tris = 0;
        const meshList = [];
        const matSet = new Set();
        root.traverse(o => {
            if (!o.isMesh) return;
            meshList.push(o);
            const g = o.geometry;
            if (g) {
                tris += (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
            }
            const m = o.material;
            if (Array.isArray(m)) m.forEach(x => x && matSet.add(x));
            else if (m) matSet.add(m);
        });

        // 单材质模型（美术用一张贴图搞定整栋楼，材质名通常就是 Material.001）：
        // 名字没有语义，按名字分类会全部落到 mass。这里统一按 mass 处理，
        // 夜里交给灯带去交代轮廓——贴图只负责白天的质感。
        const onlyMat = matSet.size === 1 ? [...matSet][0] : null;
        const singleTex = !!(onlyMat && !/window|win|glass|neon|trim|frame/i.test(onlyMat.name || '')
            && onlyMat.map);

        // ⑤ 材质改写
        const matInfo = [];
        const seen = new Set();
        for (const o of meshList) {
            const apply = (m) => {
                if (!m || seen.has(m.uuid)) return m;
                seen.add(m.uuid);
                if (singleTex) {
                    // 白天烘焙贴图：颜色压到 0.42，夜里靠灯带而不是靠贴图发光。
                    // emissive 只留 0.012→0.13 的一点点底光，让人看得出体块，
                    // 再多就变成「一整块发光的板子」（这个坑踩过）。
                    m.color.copy(TINT_DAY);                   // 之后由 rAF 跟着昼夜往下压
                    tintMats.push(m);
                    startTintTick();
                    m.emissive = new THREE.Color(0xffffff);   // 颜色交给着色器按高度染
                    m.emissiveIntensity = 0.012;
                    m.emissiveMap = null;
                    addLayerShader(m, { hM });
                    ATMO.registerGlow(m, { base: 0.012, gain: 0.22 });
                    matInfo.push({ name: m.name, tag: 'band-lit' });
                    return m;
                }
                const tag = classify(m.name, m);
                matInfo.push({ name: m.name, tag });
                return retint(m, tag, m.name);
            };
            if (Array.isArray(o.material)) o.material = o.material.map(apply);
            else o.material = apply(o.material);
            // 地标不进静态合并：材质/贴图各不相同，合了反而更慢
            o.userData.noMerge = true;
        }

        // ⑥ 灯带骨架
        const rig = buildLightRig({
            h: hM, w: finalSize.x, d: finalSize.z,
            crownX: scan.crownX, crownZ: scan.crownZ,
        }, s, getRigMaterial(), scan);
        wrap.add(rig);

        return {
            obj: wrap,
            tris: Math.round(tris),
            h: finalSize.y,
            w: finalSize.x,
            d: finalSize.z,
            mats: matInfo,
            lightVerts: lineVerts,
            clipped,
            srcH: h,
        };
    }

    // ---------------------------------------------------------------- 公开接口
    /** 注册一个已加载的 GLB 场景。重复注册同一个 kind 会被忽略。 */
    function register(kind, gltfScene) {
        if (!kind || !gltfScene || proto.has(kind)) return false;
        try {
            const p = normalize(gltfScene, kind);
            proto.set(kind, p);
            const names = p.mats.map(m => m.name + ':' + m.tag).join(', ');
            console.log(`[landmark] ${kind}: ${p.tris} 面 · ${p.h.toFixed(1)}×${p.w.toFixed(1)}×${p.d.toFixed(1)}m`
                + (p.clipped ? ' · 超宽已按 16m 收缩' : '')
                + ` · 材质 [${names}] · 轮廓 ${p.lightVerts} 顶点`);
            if (p.tris > 16000) {
                console.warn(`[landmark] ${kind} 有 ${p.tris} 面，超出 1.6 万预算，手机端可能掉帧`);
            }
            return true;
        } catch (e) {
            console.warn('[landmark] 归一化失败', kind, e);
            return false;
        }
    }

    /** 有没有这个 kind 的 GLB */
    function has(kind) { return proto.has(kind); }

    /** 已注册的 kind 列表（调试用） */
    function list() {
        return [...proto.entries()].map(([k, p]) => ({
            kind: k, tris: p.tris, h: +p.h.toFixed(1),
            w: +p.w.toFixed(1), d: +p.d.toFixed(1),
            mats: p.mats, clipped: p.clipped,
        }));
    }

    /**
     * 把一个地标放进 group。返回 true 表示用 GLB 建好了，false 表示没有模型、调用方该回退。
     * @param group 目标 Group（街道版是地标组，环上版是塔身组）
     * @param kind  'pearl' | 'waist' | ...
     * @param IN    正面朝向：-1 表示朝局部 -x，+1 表示朝 +x（街道左右不同）
     * @param y0    塔身起始高度（街道版 4m 台基顶，环上版 0）
     */
    function build(group, kind, IN, y0) {
        const p = proto.get(kind);
        if (!p) return false;
        const inst = p.obj.clone(true);      // 共享几何与材质，只复制节点
        inst.position.y = y0;
        // 建模约定是「正面朝 -x」，街道左侧的地标要转 180° 才朝向街道
        inst.rotation.y = IN > 0 ? Math.PI : 0;
        inst.userData.glbKind = kind;        // 探针靠这个统计「场上到底放了几座 GLB 地标」
        group.add(inst);
        return true;
    }

    return { register, has, build, list, TARGET_H, MAX_X, MAX_Z };
}

const LMGLB = createLandmarkGLB({ THREE, ATMO });


// =====================================================================
//  ⑤ 程序生成的贴图
// =====================================================================
function makeTex(w, h, draw, rx = 1, ry = 1) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 8;
    return shared(t);
}
function noise(c, w, h, base, alpha, count) {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let i = 0; i < count; i++) {
        const light = Math.random() < 0.5;
        c.fillStyle = `rgba(${light ? '255,255,255' : '0,0,0'},${Math.random() * alpha})`;
        c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
}
function stripes(c1, c2) {
    return makeTex(128, 32, (c, w, h) => {
        c.fillStyle = c1; c.fillRect(0, 0, w, h);
        c.fillStyle = c2;
        for (let x = -h; x < w + h; x += 32) {
            c.beginPath(); c.moveTo(x, h); c.lineTo(x + 16, h); c.lineTo(x + 16 + h, 0); c.lineTo(x + h, 0); c.fill();
        }
    });
}

const groundTex = makeTex(128, 128, (c, w, h) => noise(c, w, h, '#8a8576', 0.3, 1500), 3.5, 85);
const trackTex = makeTex(128, 128, (c, w, h) => {
    noise(c, w, h, '#6b5f52', 0.35, 2600);
    noise(c, w, h, 'rgba(0,0,0,0)', 0.5, 900);          // 更密的道砟颗粒
    c.fillStyle = '#5b3a1f'; c.fillRect(6, 44, w - 12, 40);           // 枕木
    c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(6, 78, w - 12, 6);
    c.fillStyle = 'rgba(255,255,255,.1)'; c.fillRect(6, 44, w - 12, 4);
    // 钢轨位置的高光亮带（对应 3D 钢轨 ±0.55m / 道床宽 2.4m）
    c.fillStyle = 'rgba(225,236,248,.32)';
    c.fillRect(Math.round(w * 0.271) - 1, 0, 3, h);
    c.fillRect(Math.round(w * 0.729) - 1, 0, 3, h);
}, 1, 170);
const winTex = makeTex(64, 64, (c, w, h) => {
    c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2b3a55';
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) c.fillRect(6 + x * 32, 6 + y * 32, 20, 22);
});

const TRAIN_STYLES = [
    { body: '#d9dee6', stripe: '#1f6fd1', accent: '#ffcc00' },
    { body: '#f28c28', stripe: '#7a2e0e', accent: '#fff1c1' },
    { body: '#3fae6a', stripe: '#185c35', accent: '#e8ffe9' },
    { body: '#e8445a', stripe: '#ffffff', accent: '#ffe36e' },
].map(st => {
    // 车厢侧面：一张贴图 = 4 个单位长
    st.side = makeTex(256, 170, (c, w, h) => {
        c.fillStyle = st.body; c.fillRect(0, 0, w, h);
        c.fillStyle = st.stripe; c.fillRect(0, h * 0.72, w, h * 0.16);
        c.fillStyle = st.accent; c.fillRect(0, h * 0.68, w, 5);
        for (let i = 0; i < 3; i++) {
            c.fillStyle = '#1d2a44'; c.fillRect(14 + i * 82, 30, 64, 58);
            c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(18 + i * 82, 34, 18, 50);
        }
        c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(w - 3, 0, 3, h);
    });
    const front = makeTex(128, 128, (c, w, h) => {
        c.fillStyle = st.body; c.fillRect(0, 0, w, h);
        c.fillStyle = '#1d2a44'; c.fillRect(12, 14, w - 24, 50);
        c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(16, 18, 30, 42);
        c.fillStyle = st.stripe; c.fillRect(0, 80, w, 14);
        c.fillStyle = '#fff6b0';
        for (const x of [28, 100]) { c.beginPath(); c.arc(x, 108, 9, 0, Math.PI * 2); c.fill(); }
    });
    st.frontMat = shared(std(0xffffff, { map: front, roughness: 0.5, metalness: 0.2 }));
    return st;
});
const roofMat = shared(std(0x9aa3ad, { roughness: 0.6, metalness: 0.3 }));
const darkMat = shared(std(0x2a2d33));
const rampMat = shared(std(0x7d8794, { roughness: 0.5, metalness: 0.4 }));

// =====================================================================
//  ⑥ 静态世界：按主题重建（地面、轨道、围墙、湖、雪山、云…）
//  所有静态网格统一挂到 worldGroup，切换场景时整体销毁重建
// =====================================================================
const worldGroup = new THREE.Group();
scene.add(worldGroup);

// ---------- 几何合并工具（把装饰组里的同类 mesh 合成 1 个 drawcall） ----------
// 装饰是纯静态的（只整体平移），按材质合并后 Group 里同材质的几十个小 mesh 只剩 1 个，
// 是 drawcall 的主要削减手段。加载失败时自动降级为不合并。
let mergeGeometries = null;
let MERGE_STATE = 'not-loaded';
for (const src of ['three/addons/utils/BufferGeometryUtils.js', 'three/addons/utils/BufferGeometryUtils.js']) {
    try {
        const mod = await import(src);
        if (mod && typeof mod.mergeGeometries === 'function') { mergeGeometries = mod.mergeGeometries; MERGE_STATE = 'ok:' + src; break; }
    } catch (e) { MERGE_STATE = 'fail:' + src + ':' + (e && e.message); }
}

/**
 * 按材质合并一个装饰 Group 里的所有 mesh。
 * - 顶点按 root 的局部空间烘焙，合并后 Group 的位置/旋转/缩放保持不变
 * - 多材质 mesh（如带贴图数组的车体）或标记了 userData.noMerge 的组整体跳过
 * - 几何体是共享资源时不释放；独占的几何体在合并后释放，避免内存泄漏
 */
function mergeSceneryGroup(root) {
    if (!mergeGeometries || !root || root.userData.noMerge) return root;
    const meshes = [];
    root.updateMatrixWorld(true);
    root.traverse(o => { if (o.isMesh && !o.isInstancedMesh) meshes.push(o); });
    if (meshes.length < 2) return root;
    // 有多材质 mesh → 材质无法按引用分组，保持原样最安全
    if (meshes.some(m => Array.isArray(m.material))) return root;

    const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const byMat = new Map();
    for (const m of meshes) {
        if (!byMat.has(m.material)) byMat.set(m.material, []);
        byMat.get(m.material).push(m);
    }

    const out = new THREE.Group();
    out.position.copy(root.position);
    out.rotation.copy(root.rotation);
    out.scale.copy(root.scale);

    const staleGeos = [];
    for (const [mat, list] of byMat) {
        const geos = [];
        for (const m of list) {
            const g = m.geometry.clone();                    // clone：不改动共享几何体
            g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invRoot, m.matrixWorld));
            geos.push(g);
            if (!m.geometry.userData.shared) staleGeos.push(m.geometry);
        }
        let merged = null;
        try { merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false); } catch (e) { merged = null; }
        if (!merged) {                                        // 属性不兼容 → 该材质保持独立 mesh
            for (let i = 0; i < list.length; i++) {
                const m = list[i];
                m.geometry = geos[i];
                m.matrix.copy(new THREE.Matrix4());
                out.add(m);
            }
            continue;
        }
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = list.some(m => m.castShadow);
        mesh.receiveShadow = list.some(m => m.receiveShadow);
        out.add(mesh);
        if (geos.length > 1) for (const g of geos) g.dispose();
    }
    for (const g of staleGeos) g.dispose();
    return out;
}

/** 该装饰组能否整体参与"按材质大合并"（多材质 mesh / InstancedMesh / 无几何对象不行） */
function canMergeIntoBatch(root) {
    if (!mergeGeometries || !root || root.userData.noMerge) return false;
    let ok = true;
    root.traverse(o => {
        if (!ok) return;
        // Sprite / Points / Line 没有可烘焙的几何，合并后整个对象会被移除，
        // 它们会被静默吞掉（曾经因此丢掉全部地面蒸汽）
        if (o.isSprite || o.isPoints || o.isLine) { ok = false; return; }
        if (!o.isMesh) return;
        if (o.isInstancedMesh || Array.isArray(o.material)) ok = false;
    });
    return ok;
}

/**
 * 把本场景所有可合并的装饰按材质合并成少量大网格，并生成两份副本交替滚动。
 * 装饰本来就以 span 为周期重复（越界后 z -= span），所以"两副本交替"的视觉与原实现一致，
 * 但 drawcall 从「每个装饰 1~3 次」降到「每种材质 2 次」。返回新的 scenery 数组。
 */
function buildTiledDecor(span) {
    if (!mergeGeometries) return null;
    const mergeable = [], kept = [];
    for (const root of scenery) (canMergeIntoBatch(root) ? mergeable : kept).push(root);
    if (!mergeable.length) return null;

    worldGroup.updateMatrixWorld(true);
    const invWorld = new THREE.Matrix4().copy(worldGroup.matrixWorld).invert();
    const byMat = new Map();
    const bakedGeos = [];
    for (const root of mergeable) {
        root.traverse(o => {
            if (!o.isMesh) return;
            const g = o.geometry.clone();
            g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invWorld, o.matrixWorld));
            bakedGeos.push(g);
            if (!byMat.has(o.material)) byMat.set(o.material, { geos: [], cast: false, receive: false });
            const rec = byMat.get(o.material);
            rec.geos.push(g);
            rec.cast = rec.cast || o.castShadow;
            rec.receive = rec.receive || o.receiveShadow;
        });
    }

    // 每种材质只合并一次，两份副本共用同一份 geometry（显存不翻倍）
    const batches = [];
    for (const [mat, rec] of byMat) {
        let merged = null;
        try { merged = rec.geos.length === 1 ? rec.geos[0] : mergeGeometries(rec.geos, false); } catch (e) { merged = null; }
        if (!merged) continue;
        if (!merged.userData) merged.userData = {};
        merged.userData.shared = true;
        batches.push({ mat, geo: merged, cast: rec.cast, receive: rec.receive });
    }
    const usedGeos = new Set(batches.map(b => b.geo));
    for (const g of bakedGeos) if (!usedGeos.has(g)) g.dispose();   // 释放多余的临时几何体（合并产物才是最终数据）

    const makeBatchGroup = (zOffset) => {
        const grp = new THREE.Group();
        grp.position.z = zOffset;
        grp.userData.tiling = true;      // scrollWorld 用两倍 span 回移
        for (const b of batches) {
            const mesh = new THREE.Mesh(b.geo, b.mat);
            mesh.castShadow = b.cast;
            mesh.receiveShadow = b.receive;
            grp.add(mesh);
        }
        return grp;
    };

    // 原装饰已烘焙进大网格：从世界移除，只释放独占几何体（材质/共享几何体还要复用）
    for (const root of mergeable) {
        worldGroup.remove(root);
        root.traverse(o => {
            if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        });
    }

    // 初始位置让前副本盖住身后 24m（视野区间 [-190, 24] 全程有装饰）
    const A = makeBatchGroup(24);
    const B = makeBatchGroup(24 - span);
    worldGroup.add(A, B);
    return kept.concat([A, B]);
}

/**
 * 合并"不滚动"的静态世界物体（天际线、湖、山、围墙等）成按材质的大网格。
 * 它们随场景整体重建，不需要副本，合并不影响任何逻辑。
 */
function mergeStaticWorld() {
    if (!mergeGeometries) return 0;
    const scenerySet = new Set(scenery);
    const mergeable = worldGroup.children.filter(c => !scenerySet.has(c) && canMergeIntoBatch(c));
    if (mergeable.length < 2) return 0;

    worldGroup.updateMatrixWorld(true);
    const invWorld = new THREE.Matrix4().copy(worldGroup.matrixWorld).invert();
    const byMat = new Map();
    const baked = [];
    for (const root of mergeable) {
        root.traverse(o => {
            if (!o.isMesh) return;
            const g = o.geometry.clone();
            g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invWorld, o.matrixWorld));
            baked.push(g);
            if (!byMat.has(o.material)) byMat.set(o.material, { geos: [], cast: false, receive: false });
            const rec = byMat.get(o.material);
            rec.geos.push(g);
            rec.cast = rec.cast || o.castShadow;
            rec.receive = rec.receive || o.receiveShadow;
        });
    }

    let mergedCount = 0;
    const usedGeos = new Set();
    for (const [mat, rec] of byMat) {
        let merged = null;
        try { merged = rec.geos.length === 1 ? rec.geos[0] : mergeGeometries(rec.geos, false); } catch (e) { merged = null; }
        if (!merged) continue;
        if (!merged.userData) merged.userData = {};
        merged.userData.shared = true;
        usedGeos.add(merged);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = rec.cast;
        mesh.receiveShadow = rec.receive;
        worldGroup.add(mesh);
        mergedCount++;
    }
    for (const g of baked) if (!usedGeos.has(g)) g.dispose();
    for (const root of mergeable) {
        worldGroup.remove(root);
        root.traverse(o => {
            if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        });
    }
    return mergedCount;
}

function addMesh(geo, mat, x, y, z, { cast = false, receive = true } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast; m.receiveShadow = receive;
    worldGroup.add(m);
    return m;
}
const flat = (w, l) => new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2);

// 跨重建复用的材质（销毁世界时不释放）
const railMat  = shared(std(0xb8c0c8, { metalness: 0.8, roughness: 0.3 }));
const wallMat  = shared(std(0xb9b3a6, { roughness: 0.95 }));
const mtnMat   = shared(new THREE.MeshLambertMaterial({ color: 0x7d8fa8, fog: false, flatShading: true }));
const snowMat  = shared(new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false, flatShading: true }));
const cloudMat = shared(new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false }));

// ---- 湖畔轨道（起点场景）----
// 湖畔水面只保留「流动」：一层低对比度细长水纹随里程滚动。
// 不挂 ART.applyWaterShine（波光 + 涟漪注入只留给校园水面），
// 也不再画白色高光碎片，避免整片湖面「波光粼粼」。
let flowTex = null;
const wireMat = shared(std(0x4a5058, { metalness: 0.8, roughness: 0.4 }));
const hillMat = shared(new THREE.MeshLambertMaterial({ color: 0x6e8f66, fog: false, flatShading: true }));

// 湖面材质：纯色水面，流动感全靠上层滚动的水纹，不改 fragmentShader
const lakeMat = shared(std(0x2a83d6, { roughness: 0.16, metalness: 0.22 }));

// ---- 湖畔群山：灰岩峰柱 + 崖顶松林 ----
// 结构参考（只取形态特征，不照搬任何具体景点的造型）：
//   · 张家界：近垂直的石英砂岩峰柱、顶面平台、峰顶孤松
//   · 黄山：花岗岩峰脊、峭壁松、前中远三层峰林
//   · 漓江：喀斯特峰丛沿水岸层层退远、山脚植被贴着水面
// 实现：所有峰体 / 岩层 / 松树堆进一个 BufferGeometry，单材质顶点色 → 1 个 drawcall。
// 明暗直接烘焙在顶点色里（阳面亮、阴面暗、上亮下暗），昼夜与天气不会把山染黑。
const LAKE_MTN_MAT = shared(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
const MTN_FOG_COL = new THREE.Color(0x8a9bab);                 // 远山冷蓝灰（不过曝、不发白）
const MTN_ROCK = [0x3a444b, 0x545f67, 0x6f7b84, 0x87939a];   // 山脚阴影 → 崖壁 → 亮面
const MTN_GREEN = [0x2b4634, 0x3d6340, 0x537a49, 0x65864f];   // 深松 → 灌木 → 草
const MTN_MOSS = 0x4e7042;

function buildLakesideMountains() {
    const POS = [], NRM = [], CLR = [];
    const TAU = Math.PI * 2;
    const tmp = new THREE.Color();
    const emit = (hex, k, fog) => {
        tmp.setHex(hex).multiplyScalar(k);
        if (fog) tmp.lerp(MTN_FOG_COL, fog);
        return [tmp.r, tmp.g, tmp.b];
    };
    const tri = (a, b, c, col) => {
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        for (const p of [a, b, c]) {
            POS.push(p.x, p.y, p.z); NRM.push(nx, ny, nz); CLR.push(col[0], col[1], col[2]);
        }
    };
    const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };

    // 松树：树干 + 2~4 层「伞状」树冠（锥台，不是纯锥），可整体倾斜。
    // detailed = 近景用 4 层 7 边；中景 3 层、远景 2 层，树冠逐层收小、下暗上亮，
    // 层与层之间错开一点，远看才有「枝叶一层层摊开」的松树轮廓，而不是一个绿三角。
    const pine = (x, y, z, h, fog, detailed, leanX = 0, leanZ = 0) => {
        const tr = h * 0.05, th = h * 0.40;
        const bark = emit(0x3b352d, 0.96, fog);
        const tx = x + leanX * h * 0.32, tz = z + leanZ * h * 0.32;
        for (let i = 0; i < 4; i++) {                       // 细树干（四片）
            const a0 = i / 4 * TAU, a1 = (i + 1) / 4 * TAU;
            tri(
                { x: x + Math.cos(a0) * tr, y, z: z + Math.sin(a0) * tr },
                { x: tx, y: y + th, z: tz },
                { x: x + Math.cos(a1) * tr, y, z: z + Math.sin(a1) * tr },
                bark
            );
        }
        const tiers = detailed ? 4 : (fog > 0.4 ? 2 : 3);
        const sidesT = detailed ? 7 : 5;
        for (let tier = 0; tier < tiers; tier++) {
            const t0 = 0.24 + tier * (0.68 / tiers);
            const t1 = Math.min(1.02, 0.24 + (tier + 1) * (0.68 / tiers) + 0.03);
            const y0 = y + h * t0, y1 = y + h * t1;
            const r0 = h * (0.32 - tier * (0.20 / tiers));
            const r1 = r0 * 0.44;                           // 收得更急，层片之间才有台阶
            const wob = h * 0.025;                          // 每层中心随机偏一点，树冠不对称
            const ox = x + leanX * h * t0 + rand(-wob, wob), oz = z + leanZ * h * t0 + rand(-wob, wob);
            const ox1 = x + leanX * h * t1 + rand(-wob, wob), oz1 = z + leanZ * h * t1 + rand(-wob, wob);
            const base = tier === tiers - 1 ? MTN_GREEN[1] : MTN_GREEN[tier % 2 === 0 ? 0 : 2];
            for (let i = 0; i < sidesT; i++) {
                const a0 = i / sidesT * TAU, a1 = (i + 1) / sidesT * TAU;
                const col = emit(base, (0.84 + 0.28 * Math.cos(a0 - 0.8)) * (0.92 + 0.06 * tier), fog);
                quad(
                    { x: ox + Math.cos(a0) * r0, y: y0, z: oz + Math.sin(a0) * r0 },
                    { x: ox1 + Math.cos(a0) * r1, y: y1, z: oz1 + Math.sin(a0) * r1 },
                    { x: ox1 + Math.cos(a1) * r1, y: y1, z: oz1 + Math.sin(a1) * r1 },
                    { x: ox + Math.cos(a1) * r0, y: y0, z: oz + Math.sin(a1) * r0 },
                    col
                );
            }
            // 层底压一圈深色缝：树冠是一层层压下去的，远看不会是光滑绿锥
            if (detailed) {
                for (let i = 0; i < sidesT; i++) {
                    const a0 = i / sidesT * TAU, a1 = (i + 1) / sidesT * TAU;
                    tri(
                        { x: ox + Math.cos(a0) * r0, y: y0, z: oz + Math.sin(a0) * r0 },
                        { x: ox + Math.cos(a0) * r0 * 0.88, y: y0 + h * 0.035, z: oz + Math.sin(a0) * r0 * 0.88 },
                        { x: ox + Math.cos(a1) * r0, y: y0, z: oz + Math.sin(a1) * r0 },
                        emit(MTN_GREEN[0], 0.60, fog)
                    );
                }
            }
        }
        // 树尖：一小圈收口，避免树顶被削平
        const tipX = x + leanX * h, tipZ = z + leanZ * h, rTip = h * 0.06;
        for (let i = 0; i < sidesT; i++) {
            const a0 = i / sidesT * TAU, a1 = (i + 1) / sidesT * TAU;
            tri(
                { x: tipX + Math.cos(a0) * rTip, y: y + h * 1.02, z: tipZ + Math.sin(a0) * rTip },
                { x: tipX, y: y + h * 1.14, z: tipZ },
                { x: tipX + Math.cos(a1) * rTip, y: y + h * 1.02, z: tipZ + Math.sin(a1) * rTip },
                emit(MTN_GREEN[1], 1.02, fog)
            );
        }
    };

    // 一座峰柱：8 道不规则环 + 接近垂直的崖壁 + 竖向岩脊/深缝 + 横向岩层带。
    // 陡峭感来自「中下部几乎不收分」（K 从 1.00 只掉到 .93），最后两段才快速收顶；
    // opt.pillar 时变成细高石柱（边更少、层更少、几乎不长树）。
    const peak = (cx, cz, r, h, fog, seed, opt = {}) => {
        const pillar = !!opt.pillar;
        const sides = pillar ? 5 + (seed % 2) : 8 + (seed % 4);
        const LAYERS = pillar ? 6 : 8;
        const pointed = opt.pointed != null ? opt.pointed : (seed % 5 === 0);   // 1/5 尖峰
        const K = pillar ? [1, .97, .93, .86, .66, .26]
            : (pointed ? [1, .93, .85, .75, .63, .47, .28, .05]
                       : [1, .99, .98, .96, .93, .88, .76, .34]);
        const Y = pillar ? [0, .18, .40, .62, .84, 1] : [0, .12, .25, .38, .52, .66, .82, 1];
        const jA = [], jR = [], jS = [], crev = [];
        for (let i = 0; i < sides; i++) {
            jA.push(i / sides * TAU + rand(-0.05, 0.05));
            jR.push(rand(0.84, 1.16));
            jS.push(rand(0.90, 1.08));
            crev.push(((i * 5 + seed) % 5 === 0) ? 0.76 : 1);   // 1/5 扇区是凹进去的竖向深缝
        }
        const rings = [];
        for (let L = 0; L < LAYERS; L++) {
            const ring = [];
            for (let i = 0; i < sides; i++) {
                const rib = 1 + 0.08 * Math.sin(L * 1.9 + i * 2.4);   // 竖向岩脊起伏更明显
                const rr = r * K[L] * jR[i] * crev[i] * rib * rand(0.97, 1.03);
                ring.push({
                    x: cx + Math.cos(jA[i]) * rr + (L > 0 ? rand(-r * 0.025, r * 0.025) : 0),
                    // 第二道环多抖一点：山脚林线的上沿不能是一条水平绿腰带
                    y: -8 + h * Y[L] + rand(-h * (L === 1 ? 0.045 : 0.008), h * (L === 1 ? 0.045 : 0.008)),
                    z: cz + Math.sin(jA[i]) * rr
                });
            }
            rings.push(ring);
        }
        for (let L = 0; L < LAYERS - 1; L++) {
            for (let i = 0; i < sides; i++) {
                const j = (i + 1) % sides, a = jA[i];
                const lit = 0.60 + 0.40 * clamp(0.5 - 0.55 * Math.cos(a) + 0.35 * Math.sin(a), 0, 1);
                let hex;
                // 绿面只保留山脚林带 + 山腰一条稀疏苔缝；崖壁上的绿交给「崖壁松」，
                // 否则按扇区整块染色，远看会像贴了一张绿纸
                if (L === 0 && ((i * 7 + seed) % 5) < 4) hex = MTN_GREEN[(i + seed) % 2 ? 0 : 2];
                else if (L === 1 && (i * 5 + seed) % 7 === 0) hex = MTN_MOSS;
                else hex = MTN_ROCK[L === 0 ? 0 : L <= 2 ? 1 : ((i + seed) % 4 === 0 ? 3 : 2)];
                let k = lit * jS[i] * (0.92 + 0.02 * L);
                if (L % 3 === 2) k *= 0.90;                 // 横向岩层：每三层压一条深带
                if (crev[i] < 1) k *= 0.76;                 // 竖向深缝再压暗，崖壁才不是一整块平面
                quad(rings[L][i], rings[L + 1][i], rings[L + 1][j], rings[L][j], emit(hex, k, fog));
            }
        }
        // 顶面：边缘参差、中心偏移的岩台，不是一刀切平的盖
        const top = rings[LAYERS - 1];
        const ctr = {
            x: cx + rand(-r * 0.12, r * 0.12),
            y: -8 + h + rand(-1.0, 0.8),
            z: cz + rand(-r * 0.12, r * 0.12)
        };
        for (let i = 0; i < sides; i++) {
            tri(top[i], ctr, top[(i + 1) % sides],
                emit(MTN_GREEN[2], 0.88 + 0.16 * Math.cos(jA[i]), fog));
        }
        // 崖顶林：沿顶缘一圈 + 内部几棵，形成起伏的林冠线（不是一撮绿点）
        const topR = r * K[LAYERS - 1];
        const nTree = pillar ? (seed % 2) : (pointed ? 3 : (fog > 0.4 ? 6 + (seed % 3) : 10 + (seed % 5)));
        for (let t = 0; t < nTree; t++) {
            const a = rand(0, TAU), d = (0.15 + 0.85 * Math.sqrt(Math.random())) * topR * 0.94;
            pine(cx + Math.cos(a) * d, -8 + h, cz + Math.sin(a) * d,
                h * rand(0.12, 0.20), fog, fog < 0.25 && !pillar);
        }
        // 山脚林：山根围一圈矮树，远看是一条深绿林线，把山从地面「托」起来
        if (!pillar) {
            const nFoot = fog > 0.4 ? 5 + (seed % 3) : 9 + (seed % 5);
            for (let t = 0; t < nFoot; t++) {
                const a = rand(0, TAU), d = r * rand(1.18, 1.62);
                pine(cx + Math.cos(a) * d, -0.5, cz + Math.sin(a) * d,
                    h * rand(0.08, 0.13), fog, false);
            }
        }
        // 崖壁斜松：从崖壁不同高度向外斜伸，像黄山那种挂在岩缝里的松（只做近/中景）。
        // 崖壁上真正的绿色靠它们，不靠把整个扇区染绿。
        if (fog < 0.3 && !pillar && !pointed) {
            const nCliff = 3 + (seed % 3);
            for (let t = 0; t < nCliff; t++) {
                const L = 1 + (t % 6), i = (seed * 7 + t * 5) % sides;
                const p = rings[L][i];
                pine(p.x, p.y, p.z, h * rand(0.12, 0.18), fog, true,
                    Math.cos(jA[i]) * 0.95, Math.sin(jA[i]) * 0.95);
            }
        }
    };

    // 峰丛：主峰 + 错得更开的副峰 + 1~2 根独立细石柱。
    // 副峰距离从 0.70r 拉到 0.95~1.45r，峰与峰之间留出山谷和空隙 ——
    // 这是「峰林」和「一整块山」的分界：石柱把大块体量切开，轮廓才有陡峭的竖向节奏。
    const cluster = (cx, cz, r, h, fog, seed) => {
        peak(cx, cz, r, h, fog, seed);
        const n = 1 + (seed % 2);
        for (let i = 0; i < n; i++) {
            const a = rand(0, TAU), d = r * rand(0.95, 1.45);
            peak(cx + Math.cos(a) * d, cz + Math.sin(a) * d,
                r * rand(0.40, 0.62), h * rand(0.48, 0.80), fog, seed + i * 17 + 7);
        }
        const np = 1 + (seed % 2);
        for (let i = 0; i < np; i++) {
            const a = rand(0, TAU), d = r * rand(1.15, 1.75);
            peak(cx + Math.cos(a) * d, cz + Math.sin(a) * d,
                r * rand(0.16, 0.28), h * rand(0.55, 1.05), fog, seed + i * 29 + 3, { pillar: true });
        }
    };

    // 三层纵深：近景崖、中景峰林、远景淡蓝山影。
    // 半径整体收窄（高宽比 4~5.5），山体才会「陡」而不是「胖」；高度继续错开，山脊线才有起伏。
    const RANGES = [
        { n: 11, z: -178, zJ: 24, h: [42, 68], r: [11, 19], x: [-190, 230], fog: 0.00 },
        { n: 13, z: -266, zJ: 32, h: [68, 108], r: [16, 26], x: [-260, 300], fog: 0.26 },
        { n: 15, z: -372, zJ: 44, h: [98, 142], r: [24, 38], x: [-340, 380], fog: 0.55 },
    ];
    for (let ri = 0; ri < RANGES.length; ri++) {
        const R = RANGES[ri];
        for (let i = 0; i < R.n; i++) {
            if (i % 7 === 3) continue;                         // 留山口，别连成一堵墙
            const x = R.x[0] + (R.x[1] - R.x[0]) * (i + 0.5) / R.n + rand(-16, 16);
            const z = R.z + rand(-R.zJ, R.zJ);
            const h = rand(R.h[0], R.h[1]) * (i % 4 === 0 ? 1.18 : rand(0.78, 1.05));  // 高低错落
            cluster(x, z, rand(R.r[0], R.r[1]), h, R.fog, i * 13 + ri * 101);
        }
    }
    // 中央两座主峰压住视线：保持瘦高（加宽会变成墩），靠体量与周围拉开
    cluster(-72, -306, 48, 142, 0.16, 991);
    cluster(88, -338, 52, 156, 0.22, 992);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(POS, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(NRM, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(CLR, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, LAKE_MTN_MAT);
    mesh.userData.noMerge = true;      // 已经是整体了，别再被静态合批复制一份
    worldGroup.add(mesh);
}

function buildLakesideWorld() {
    addMesh(flat(14, 340), std(0xffffff, { map: groundTex, roughness: 1 }), 0, 0, -150);
    addMesh(flat(60, 340), std(0x9a9a92, { roughness: 1 }), -34, 0.01, -150);
    addMesh(flat(160, 340), lakeMat, 87, -0.3, -150);   // 湖面

    // 流动水纹层：透明底 + 深浅交错的细长水纹，靠 texScroll 持续滚动产生水流感。
    // 没有白色闪点、没有涟漪圈，只是水在缓慢地流。
    flowTex = makeTex(256, 256, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        // 柔和的横向水带：以深蓝暗带为主、极淡的浅色压在旁边，滚动时看得出水在流。
        // 不用白色闪点、不画涟漪环，所以不会有「波光粼粼」的高光感。
        for (let i = 0; i < 26; i++) {
            const y = rand(0, h), bh = rand(4, 12);
            const g = c.createLinearGradient(0, y, 0, y + bh);
            g.addColorStop(0, 'rgba(10,52,86,0)');
            g.addColorStop(0.5, `rgba(10,52,86,${rand(0.10, 0.22)})`);
            g.addColorStop(1, 'rgba(10,52,86,0)');
            c.fillStyle = g;
            c.fillRect(0, y, w, bh);
            if (i % 2 === 0) {
                c.fillStyle = `rgba(164,214,236,${rand(0.03, 0.07)})`;
                c.fillRect(0, y + bh + 1, w, 2);
            }
        }
        // 细水纹叠在宽带上补细节，同样不含高光
        for (let i = 0; i < 150; i++) {
            const y = rand(0, h), len = rand(24, 120), x = rand(0, w);
            c.fillStyle = `rgba(16,62,96,${rand(0.06, 0.14)})`;
            c.fillRect(x, y, len, rand(1, 2));
        }
    }, 2.5, 14);           // y 方向 14 次重复：每条约 1~3m 宽的水带，远近都看得见
    flowTex.userData.shared = false;   // 随世界一起销毁
    addMesh(flat(160, 340), new THREE.MeshBasicMaterial({ map: flowTex, transparent: true, opacity: 0.85, depthWrite: false }),
        87, -0.26, -150, { receive: false });
    THEMES.lakeside.texScroll = [[groundTex, 4], [trackTex, 2], [flowTex, 14]];   // 水流慢一点，是流不是闪
    // 护城河也去掉波光：保持原来的深蓝水面，不再注入 shine。
    // 校园水面仍用 ART.applyWaterShine，那段注入与湖畔无关。

    for (const lx of LANES) {
        addMesh(flat(2.4, 340), std(0xffffff, { map: trackTex, roughness: 1 }), lx, 0.02, -150);
        for (const off of [-0.55, 0.55]) addMesh(new THREE.BoxGeometry(0.1, 0.14, 340), railMat, lx + off, 0.07, -150);
        // 接触网：接触线 + 承力索（与钢轨同理，全线贯通的静态长条）
        addMesh(new THREE.BoxGeometry(0.024, 0.024, 340), wireMat, lx, 4.72, -150, { receive: false });
        addMesh(new THREE.BoxGeometry(0.02, 0.02, 340), wireMat, lx, 5.55, -150, { receive: false });
    }
    addMesh(new THREE.BoxGeometry(0.4, 1.0, 340), wallMat, -4.3, 0.5, -150, { cast: true });
    addMesh(new THREE.BoxGeometry(0.3, 0.6, 340), wallMat, 4.3, 0.3, -150, { cast: true });

    // 群山：灰岩峰柱 + 崖顶松林，三层纵深环抱湖畔（实现见 buildLakesideMountains）
    buildLakesideMountains();
    // 云团留在山腰之间，接住「黄山云海」那层空气感（原来的云不用改）
    for (let i = 0; i < 8; i++) {
        const g = new THREE.Group();
        for (let j = 0; j < 5; j++) {
            const s = new THREE.Mesh(new THREE.SphereGeometry(rand(6, 11), 10, 8), cloudMat);
            s.position.set(j * 9 - 18, rand(-2, 4), rand(-3, 3));
            g.add(s);
        }
        g.position.set(-200 + i * 55 + rand(-10, 10), rand(45, 70), -280 - rand(0, 40));
        g.scale.y = 0.6;
        worldGroup.add(g);
    }
}

// =====================================================================
//  ⑦ 循环滚动的装饰：楼房、路灯、湖边岩石、金色相框
// =====================================================================
const scenery = [];
// opts.shadow: 是否让这组装饰投射阴影。默认不投（装饰每帧要额外走一遍阴影 pass，
// 是 drawcall 的大头；玩家 / 保安 / 车辆 / 障碍的阴影保留，它们是玩法相关信息）
function addScenery(obj, z, opts = {}) {
    obj.position.z = z;
    if (!opts.shadow) obj.traverse(o => { if (o.isMesh) o.castShadow = false; });
    worldGroup.add(obj);
    scenery.push(obj);
    return obj;
}

const poleMat = shared(std(0x4a525c, { metalness: 0.6, roughness: 0.4 }));
const lampMat = shared(std(0xfff3c4, { emissive: 0xfff0b0, emissiveIntensity: 0.8 }));
const rockMat = shared(std(0x9c968c, { flatShading: true, roughness: 1 }));
const goldMat = shared(std(0xd4a73a, { metalness: 0.6, roughness: 0.35 }));

function makeLamp(side) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 8), poleMat);
    pole.position.y = 2.1;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.08), poleMat);
    arm.position.set(-side * 0.4, 4.15, 0);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.25), lampMat);
    head.position.set(-side * 0.8, 4.08, 0);
    pole.castShadow = true;
    g.add(pole, arm, head);
    g.position.x = side * 4.7;
    return g;
}

// 照片里的金色雕花相框，作为湖边地标
function makeFrame() {
    const g = new THREE.Group();
    const W = 4.6, H = 3.4, T = 0.22;
    const bars = [[W + T, T, 0, H], [W + T, T, 0, 0.1], [T, H, -W / 2, H / 2], [T, H, W / 2, H / 2]];
    for (const [w, h, x, y] of bars) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), goldMat);
        b.position.set(x, y, 0);
        b.castShadow = true;
        g.add(b);
    }
    const flowerMats = [std(0xff8fb8), std(0x7ec8ff), std(0xffffff)];
    for (let i = 0; i < 7; i++) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), flowerMats[i % 3]);
        f.position.set(-W / 2 + 0.3 + i * (W - 0.6) / 6, H, 0.08);
        g.add(f);
    }
    g.position.x = 8.5;
    g.rotation.y = -0.45;
    return g;
}

// ---- 湖畔新增装饰：接触网门架 / 芦苇 / 野花 / 站台 ----
const gantryMat = shared(std(0x7d8790, { metalness: 0.7, roughness: 0.45 }));
const insMat = shared(std(0xe8e2d4, { roughness: 0.5 }));
function makeGantry() {
    // 电气化铁路硬横跨：两根钢柱 + 横梁 + 各股道吊弦
    const g = new THREE.Group();
    for (const px of [-4.9, 4.9]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 6.1, 8), gantryMat);
        p.position.set(px, 3.05, 0);
        p.castShadow = true;
        g.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(10.3, 0.3, 0.3), gantryMat);
    beam.position.y = 5.95;
    beam.castShadow = true;
    g.add(beam);
    for (const lx of LANES) {
        const drop = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), gantryMat);
        drop.position.set(lx, 5.35, 0);
        g.add(drop);
        const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 8), insMat);
        ins.position.set(lx, 4.82, 0);
        g.add(ins);
    }
    return g;
}

const reedMat = shared(std(0x5d9248, { roughness: 0.9 }));
const cattailMat = shared(std(0x7a5230, { roughness: 0.95 }));
function makeReeds() {
    const g = new THREE.Group();
    const n = 6 + Math.floor(rand(0, 4));
    for (let i = 0; i < n; i++) {
        const h = rand(0.7, 1.4);
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.032, h, 5), reedMat);
        b.position.set(rand(-0.55, 0.55), h / 2, rand(-0.55, 0.55));
        b.rotation.set(rand(-0.12, 0.12), 0, rand(-0.12, 0.12));
        g.add(b);
        if (Math.random() < 0.4) {
            const t = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 6), cattailMat);
            t.position.set(b.position.x, h + 0.06, b.position.z);
            g.add(t);
        }
    }
    g.position.x = rand(5.6, 8.6);
    return g;
}

const stemMat = shared(std(0x4e7d3a));
const petalMats = [0xff7fb0, 0xffd94a, 0xffffff, 0xb07fe8].map(c => shared(std(c, { roughness: 0.6 })));
function makeFlowers() {
    const g = new THREE.Group();
    const n = 4 + Math.floor(rand(0, 3));
    for (let i = 0; i < n; i++) {
        const h = rand(0.22, 0.42);
        const x = rand(-0.6, 0.6), z = rand(-0.6, 0.6);
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, h, 4), stemMat);
        s.position.set(x, h / 2, z);
        const f = new THREE.Mesh(new THREE.SphereGeometry(rand(0.06, 0.1), 7, 6), petalMats[i % petalMats.length]);
        f.position.set(x, h + 0.04, z);
        g.add(s, f);
    }
    g.position.x = rand(5.0, 7.5);
    return g;
}

// 蓝底白字中式站名牌
const stationSignTex = makeTex(256, 76, (c, w, h) => {
    c.fillStyle = '#0b4ea2'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#fff'; c.lineWidth = 4; c.strokeRect(3, 3, w - 6, h - 6);
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 38px "Microsoft YaHei", sans-serif';
    c.fillText('湖 畔 站', w / 2, h / 2 - 12);
    c.font = 'bold 15px Arial';
    c.fillText('H U P A N   Z H A N', w / 2, h / 2 + 24);
});
const platMat = shared(std(0xc2c3ba, { roughness: 0.95 }));
const canopyMat = shared(std(0x3f5d86, { metalness: 0.4, roughness: 0.5 }));
const safeLineMat = shared(std(0xf2c520, { roughness: 0.7 }));
function makePlatform() {
    const g = new THREE.Group();
    const LEN = 34;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, LEN), platMat);
    deck.position.set(-6.7, 0.6, 0);
    deck.castShadow = deck.receiveShadow = true;
    g.add(deck);
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, LEN), safeLineMat);
    line.position.set(-5.35, 1.21, 0);
    g.add(line);
    for (const pz of [-LEN / 2 + 3, -LEN / 6, LEN / 6, LEN / 2 - 3]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.7, 8), poleMat);
        p.position.set(-6.9, 2.55, pz);
        p.castShadow = true;
        g.add(p);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.14, LEN - 2), canopyMat);
    roof.position.set(-6.8, 4.0, 0);
    roof.castShadow = true;
    g.add(roof);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.72, 2.3), darkMat);
    board.position.set(-6.5, 3.3, 0);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.64),
        new THREE.MeshBasicMaterial({ map: stationSignTex, side: THREE.DoubleSide }));
    sign.position.set(-6.46, 3.3, 0);
    sign.rotation.y = Math.PI / 2;
    g.add(board, sign);
    return g;
}

// ---- 湖畔：欧式中世纪城堡（青灰石 · 多彩旗帜 · 护城河 / 吊桥）----
// 设计原则（欧式几何美感）：所有尺寸取 3m 模数；腰线 / 壁柱 / 窗洞 / 城垛严格等分。
// 2026-11-06 改版：9 座 → 5 座（间距 36m → 64.8m）、体量 ×1.28、白/黑撞色 → 青灰石；
// 新增护城河 + 可落吊桥 + 吊闸门（都会动）、夜间窗光；屋顶 / 窗型 / 旗帜按 variant 变化。
function castleStone(base, seam, stain) {
    return makeTex(128, 128, (c, w, h) => {
        c.fillStyle = base; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 1100; i++) {
            c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${rand(0.02, 0.08)})`;
            c.fillRect(rand(0, w), rand(0, h), rand(1, 4), rand(1, 4));
        }
        c.strokeStyle = seam; c.lineWidth = 1.4;
        for (let y = 0; y < h; y += 16) {
            c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
            const off = (y / 16) % 2 ? 16 : 0;
            for (let x = off; x < w; x += 32) {
                c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 16); c.stroke();
            }
        }
        for (let i = 0; i < 6; i++) {          // 竖向雨水痕，破掉贴图的平
            const x = rand(0, w);
            const grd = c.createLinearGradient(x, 0, x + 7, 0);
            grd.addColorStop(0, 'rgba(0,0,0,0)');
            grd.addColorStop(0.5, stain);
            grd.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = grd; c.fillRect(x, 0, 7, h);
        }
    }, 2, 2);
}
// 青灰三档：pale 近花岗岩、mid 青石、deep 深青（沿轨道由浅到深，纵深更明显）
const CASTLE_STONE = {
    pale: castleStone('#96a6b1', 'rgba(58,70,80,0.44)', 'rgba(30,42,52,0.20)'),
    mid:  castleStone('#7f909d', 'rgba(44,56,66,0.52)', 'rgba(20,32,42,0.24)'),
    deep: castleStone('#697c8d', 'rgba(34,46,56,0.58)', 'rgba(12,24,34,0.28)'),
};
const CASTLE_ROOF_COLORS = [0x3b4a58, 0x2e4356, 0x3f6259, 0x544a45];
const CASTLE_FLAG_COLORS = [0xd6404a, 0x2f6fc0, 0xe0a52c, 0x2f9a63, 0x8b4fb5, 0xe06a2c, 0xeee8dc, 0x1f8fa8];

const CASTLE_MAT = {
    pale: shared(std(0xffffff, { map: CASTLE_STONE.pale, roughness: 0.90 })),
    mid:  shared(std(0xffffff, { map: CASTLE_STONE.mid, roughness: 0.92 })),
    deep: shared(std(0xffffff, { map: CASTLE_STONE.deep, roughness: 0.93 })),
    trim:  shared(std(0xccd7dd, { roughness: 0.70 })),
    trimD: shared(std(0x9caeb9, { roughness: 0.80 })),
    roof:  CASTLE_ROOF_COLORS.map(c => shared(std(c, { roughness: 0.55, metalness: 0.22, flatShading: true }))),
    // 窗：白天是冷色玻璃，入夜被 ATMO 的发光寄存器点亮成暖黄（registerGlow 见函数末尾）
    win:   shared(std(0x233140, { roughness: 0.24, metalness: 0.32, emissive: 0xffb257, emissiveIntensity: 0.02 })),
    gold:  shared(std(0xd9b45c, { roughness: 0.32, metalness: 0.9 })),
    iron:  shared(std(0x2b3238, { roughness: 0.52, metalness: 0.68 })),
    wood:  shared(std(0x6d4b30, { roughness: 0.86 })),
    // 护城河的「干地」与「砌石岸」：以前岸是深灰（接近水色）又被水面整片盖住，
    // 看起来城堡直接泡在水上；现在岛与外岸用明确的陆地色，河只占中间一圈。
    island: shared(std(0x8b8f7b, { roughness: 1 })),
    bank:  shared(std(0xaab2b4, { roughness: 0.95 })),
    moat:  shared(std(0x24505f, { roughness: 0.10, metalness: 0.36, transparent: true, opacity: 0.96 })),
};
try { ATMO.registerGlow(CASTLE_MAT.win, { base: 0.02, gain: 1.5 }); } catch (e) { }

// 旗帜布面：一个材质吃下所有城堡的旗（每面旗的颜色走顶点色），顶点着色器里做波动。
// 这样无论几十面旗，都只有 1 个 drawcall、1 个 uniform。
const FLAG_UNIFORM = { value: 0 };
const FLAG_MAT = shared(new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.DoubleSide, roughness: 0.86, metalness: 0.02,
}));
FLAG_MAT.onBeforeCompile = (sh) => {
    sh.uniforms.uFlagT = FLAG_UNIFORM;
    sh.vertexShader = 'attribute float aPhase;\nattribute float aAmp;\nattribute float aW;\nattribute vec3 aDir;\nuniform float uFlagT;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            float _wv = aW;
            float _ph = uFlagT * 4.6 + aPhase + _wv * 3.4 + position.y * 0.9;
            float _s = sin(_ph) + 0.34 * sin(_ph * 2.3 + 1.7);
            transformed += aDir * (_s * 0.20 * aAmp * _wv);
            transformed.y += _s * 0.055 * aAmp * _wv;
        `);
};
FLAG_MAT.needsUpdate = true;

// 一块（半圈）护城河水面：外矩形挖去内矩形，形状与城堡台基同轴
function moatShapeGeo(hx, hz, band) {
    const s = new THREE.Shape();
    s.moveTo(-hx, -hz); s.lineTo(hx, -hz); s.lineTo(hx, hz); s.lineTo(-hx, hz); s.closePath();
    const hole = new THREE.Path();
    const ix = hx - band, iz = hz - band;
    hole.moveTo(-ix, -iz); hole.lineTo(-ix, iz); hole.lineTo(ix, iz); hole.lineTo(ix, -iz); hole.closePath();
    s.holes.push(hole);
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);
    return g;
}

// 一座欧式城堡：台基 → 主体 → 腰线/壁柱/窗洞 → 城垛 → 四角塔 → 中央主塔 → 吊桥 / 吊闸
// 返回的 userData.flagPoles 里是旗布挂点（本地坐标），由调用方单独建"会飘"的旗组
function makeNordicCastle(variant) {
    const g = new THREE.Group();
    const K = 1.28;                                          // 体量放大系数
    const M = 3;                                             // 模数
    const sx = (4 + Math.round(rand(0, 2))) * M * K;         // 进深 15.4–23（沿 x，往轨道外）
    const sz = (6 + Math.round(rand(0, 2))) * M * K;         // 面宽 23–30.7（沿 z，顺轨道）
    const hy = (3 + Math.round(rand(0, 3))) * M * K;         // 主体高 11.5–19.2
    const stone = [CASTLE_MAT.pale, CASTLE_MAT.mid, CASTLE_MAT.deep][variant % 3];
    const trim  = variant % 2 ? CASTLE_MAT.trimD : CASTLE_MAT.trim;
    const roof  = CASTLE_MAT.roof[variant % CASTLE_MAT.roof.length];
    const win   = CASTLE_MAT.win;
    const Y0 = 2.2 * K;                                      // 台基顶面
    const face = sx / 2;                                     // 朝向轨道的那一面（+x）
    const flags = [];

    const put = (mesh, x, y, z) => { mesh.position.set(x, y, z); g.add(mesh); return mesh; };
    const box = (w, h, d, m, x, y, z) => put(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y, z);
    const cyl = (r, hh, seg, m, x, y, z) => put(new THREE.Mesh(new THREE.CylinderGeometry(r, r, hh, seg), m), x, y, z);
    const cone = (r, hh, seg, m, x, y, z, ry) => {
        const me = put(new THREE.Mesh(new THREE.ConeGeometry(r, hh, seg), m), x, y, z);
        if (ry) me.rotation.y = ry;
        return me;
    };

    // ① 台基：两级收分（古典台基比例，让整座城堡"坐得住"）
    box(sx + 5.0 * K, 1.2 * K, sz + 5.0 * K, trim, 0, 0.6 * K, 0);
    box(sx + 2.6 * K, 1.0 * K, sz + 2.6 * K, stone, 0, 1.7 * K, 0);

    // ② 主体
    box(sx, hy, sz, stone, 0, Y0 + hy / 2, 0);

    // ③ 两道腰线 + 檐口：横向几何节奏
    for (const t of [0.4, 0.72]) box(sx + 1.05 * K, 0.4 * K, sz + 1.05 * K, trim, 0, Y0 + hy * t, 0);
    box(sx + 1.5 * K, 0.6 * K, sz + 1.5 * K, trim, 0, Y0 + hy + 0.3 * K, 0);
    // 顶层退台：主体上面再叠一层收进的小体量，剪影不至于是一整块方糕
    box(sx * 0.66, 9.0 * K, sz * 0.72, stone, 0, Y0 + hy + 5.1 * K, 0);
    box(sx * 0.66 + 1.0 * K, 0.55 * K, sz * 0.72 + 1.0 * K, trim, 0, Y0 + hy + 9.8 * K, 0);
    const hiRoof = cone(1, 5.6 * K, 4, roof, 0, Y0 + hy + 12.9 * K, 0, Math.PI / 4);
    hiRoof.scale.set(sx * 0.5, 1, sz * 0.56);                // 压成跟退台同比例的方锥
    cone(0.3 * K, 1.0 * K, 8, CASTLE_MAT.gold, 0, Y0 + hy + 16.2 * K, 0);
    for (let i = 0; i < 4; i++) {          // 退台上的小窗，跟下面同一个模数
        box(0.28 * K, 1.5 * K, 0.8 * K, win, sx * 0.33 + 0.02, Y0 + hy + 3.4 * K, -sz * 0.36 + i * sz * 0.24);
    }

    // ④ 壁柱：面宽六等分，竖向律动（与腰线交叉出格子感）
    for (let i = 0; i <= 6; i++) {
        box(1.0 * K, hy - 1.4 * K, 1.15 * K, trim, face + 0.5 * K, Y0 + hy / 2 - 0.4 * K, -sz / 2 + i * sz / 6);
    }

    // ⑤ 窗洞：严格 cols × rows 网格，深色内凹；variant 决定尖拱还是方窗
    const cols = Math.max(3, Math.floor(sz / (3.4 * K)));
    const rows = Math.max(2, Math.floor(hy / (4 * K)));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const wz = -sz / 2 + sz * (c + 0.5) / cols;
            const wy = Y0 + 2.4 * K + r * ((hy - 4.2 * K) / rows);
            box(0.3 * K, 2.0 * K, 0.62 * K, win, face + 0.02, wy, wz);                 // 窄窗身
            if (variant % 2 === 0) {
                const arch = cone(0.44 * K, 0.55 * K, 4, win, face + 0.02, wy + 1.28 * K, wz, Math.PI / 4);
                arch.scale.z = 1.0;                                                    // 尖拱头
            } else {
                box(0.34 * K, 0.16 * K, 0.78 * K, trim, face + 0.03, wy + 1.06 * K, wz);   // 方窗石过梁
            }
        }
    }

    // ⑥ 城垛：正面 + 两端，齿间距恒定为 2 倍齿宽
    const mw = 0.95 * K, mh = 1.2 * K, topY = Y0 + hy + 0.55 * K + mh / 2;
    for (let z = -sz / 2 + mw / 2; z <= sz / 2 - mw / 2 + 0.01; z += mw * 2) {
        box(0.9 * K, mh, mw, stone, face - 0.45 * K, topY, z);
    }
    for (const s of [-1, 1]) {
        for (let x = -sx / 2 + mw / 2; x <= sx / 2 - mw / 2 + 0.01; x += mw * 2) {
            box(mw, mh, 0.9 * K, stone, x, topY, s * (sz / 2 - 0.45 * K));
        }
    }

    // ⑦ 四角塔：塔基 → 塔身 → 檐环 → 垛口环 → 锥顶 → 金饰（variant 决定圆塔 / 方塔）
    const tr = 2.3 * K, th = hy + 5 * K;
    for (const ax of [-1, 1]) for (const az of [-1, 1]) {
        const tx = ax * (sx / 2 - 0.6 * K), tz = az * (sz / 2 - 0.6 * K);
        if (variant % 3 === 1) {                              // 方塔
            box(tr * 1.9, 1.5 * K, tr * 1.9, trim, tx, Y0 + 0.75 * K, tz);
            box(tr * 1.6, th, tr * 1.6, stone, tx, Y0 + th / 2, tz);
            box(tr * 1.8, 0.46 * K, tr * 1.8, trim, tx, Y0 + th - 0.23 * K, tz);
            for (let k = 0; k < 8; k++) {
                const a = k * Math.PI / 4;
                box(0.8 * K, 1.0 * K, 0.8 * K, stone, tx + Math.cos(a) * (tr - 0.15 * K), Y0 + th + 0.5 * K, tz + Math.sin(a) * (tr - 0.15 * K));
            }
            cone(tr * 1.28, 6.4 * K, 4, roof, tx, Y0 + th + 1.0 * K + 3.2 * K, tz, Math.PI / 4);
        } else {                                              // 圆塔
            cyl(tr + 0.5 * K, 1.5 * K, 12, trim, tx, Y0 + 0.75 * K, tz);
            cyl(tr, th, 12, stone, tx, Y0 + th / 2, tz);
            cyl(tr + 0.34 * K, 0.46 * K, 12, trim, tx, Y0 + th - 0.23 * K, tz);
            for (let k = 0; k < 8; k++) {
                const a = k * Math.PI / 4;
                box(0.8 * K, 1.0 * K, 0.8 * K, stone, tx + Math.cos(a) * (tr - 0.15 * K), Y0 + th + 0.5 * K, tz + Math.sin(a) * (tr - 0.15 * K));
            }
            cone(tr + 0.55 * K, 6.4 * K, 12, roof, tx, Y0 + th + 1.0 * K + 3.2 * K, tz);
        }
        const tipY = Y0 + th + 1.0 * K + 6.4 * K;
        cone(0.4 * K, 1.1 * K, 8, CASTLE_MAT.gold, tx, tipY + 0.4 * K, tz);
        for (let k = 0; k < 3; k++) {                        // 塔身朝轨道的竖窗
            box(0.34 * K, 1.5 * K, 0.55 * K, win, tx + tr * 0.94, Y0 + th * 0.42 + k * 3.4 * K, tz);
        }
        // 前沿两座塔顶挂旗：旗杆进城堡本体（静态），旗布单独交给 FLAG_MAT
        if (ax > 0) {
            box(0.12 * K, 3.6 * K, 0.12 * K, CASTLE_MAT.gold, tx, tipY + 2.0 * K, tz);
            flags.push({
                x: tx, y: tipY + 3.55 * K, z: tz,
                w: 2.5 * K, h: 1.5 * K,
                dir: az > 0 ? 1 : -1,                              // 沿 ±z 展开，侧看就是飘带
                color: CASTLE_FLAG_COLORS[(variant + (az > 0 ? 1 : 4)) % CASTLE_FLAG_COLORS.length],
                kind: (variant + (az > 0 ? 0 : 1)) % 3,
            });
        }
    }

    // ⑧ 中央主塔：整体最高的体量，压住构图（宏大感主要来自这里）
    const cw = 5.2 * K, ch = hy + 9 * K;
    box(cw, ch, cw, stone, face - cw / 2 + 0.35 * K, Y0 + ch / 2, 0);
    box(cw + 0.9 * K, 0.55 * K, cw + 0.9 * K, trim, face - cw / 2 + 0.35 * K, Y0 + ch - 0.3 * K, 0);
    cone(cw * 0.86, 8.0 * K, 4, roof, face - cw / 2 + 0.35 * K, Y0 + ch + 4.2 * K, 0, Math.PI / 4);
    cone(0.36 * K, 1.0 * K, 8, CASTLE_MAT.gold, face - cw / 2 + 0.35 * K, Y0 + ch + 8.6 * K, 0);
    for (let k = 0; k < 2; k++) {
        box(0.34 * K, 2.2 * K, 0.7 * K, win, face + 0.38 * K, Y0 + ch * 0.55 + k * 4.2 * K, 0);
    }
    // 主塔尖的大旗（最高、最大的一面）
    box(0.13 * K, 4.2 * K, 0.13 * K, CASTLE_MAT.gold, face - cw / 2 + 0.35 * K, Y0 + ch + 9.0 * K, 0);
    flags.push({
        x: face - cw / 2 + 0.35 * K, y: Y0 + ch + 11.1 * K, z: 0,
        w: 3.4 * K, h: 1.9 * K, dir: 1,
        color: CASTLE_FLAG_COLORS[(variant * 3 + 2) % CASTLE_FLAG_COLORS.length],
        kind: 0,
    });

    // ⑨ 城门楼：正面正中央凸出一座门楼（两墩 + 过梁 + 黑洞门道 + 石拱套），
    //    吊桥与吊闸都长在这座门楼上——不再是挂在墙边的一块木板。
    const GH_X0 = face - 0.6 * K, GH_X1 = face + 2.7 * K;     // 门楼进深
    const GH_CX = (GH_X0 + GH_X1) / 2, GH_D = GH_X1 - GH_X0;
    const GH_W = 5.8 * K, GH_H = 6.2 * K;                    // 门楼面宽 / 高
    const OP_HW = 1.5 * K, OP_H = 4.6 * K;                   // 门洞半宽 / 高
    for (const s of [-1, 1]) {                                // 两侧门墩
        box(GH_D, GH_H, (GH_W / 2 - OP_HW), stone, GH_CX, Y0 + GH_H / 2, s * (OP_HW + (GH_W / 2 - OP_HW) / 2));
        box(GH_D + 0.25 * K, 0.5 * K, (GH_W / 2 - OP_HW) + 0.25 * K, trim, GH_CX, Y0 + GH_H - 0.2 * K, s * (OP_HW + (GH_W / 2 - OP_HW) / 2));
    }
    box(GH_D, GH_H - OP_H, GH_W, stone, GH_CX, Y0 + OP_H + (GH_H - OP_H) / 2, 0);   // 过梁
    box(0.25 * K, OP_H, OP_HW * 2, darkMat, GH_X0 + 0.2 * K, Y0 + OP_H / 2, 0);     // 黑门道（进深）
    // 石拱套（门框）：立柱 + 压顶，正好卡在门洞边缘
    for (const s of [-1, 1]) box(0.45 * K, OP_H, 0.42 * K, trim, GH_X1 + 0.02 * K, Y0 + OP_H / 2, s * (OP_HW + 0.2 * K));
    box(0.45 * K, 0.55 * K, OP_HW * 2 + 0.85 * K, trim, GH_X1 + 0.02 * K, Y0 + OP_H + 0.22 * K, 0);
    // 门前台阶（从台基走到门洞）
    for (let k = 0; k < 2; k++) {
        box(1.5 * K + k * 0.9 * K, 0.3 * K, OP_HW * 2 + 2.2 * K - k * 0.5 * K, trim,
            GH_X1 + 0.75 * K + k * 0.45 * K, Y0 - 0.15 * K - k * 0.3 * K, 0);
    }

    // ⑩ 护城河：城堡坐在一块「陆地岛」上，河只是环绕岛的一圈水，河外还有一圈外岸干地。
    //    旧版水面内边界 face+2.05 比台基半宽 face+3.2 还小（水淹到墙根），而石岸
    //    又被整片水面盖住，从轨道看就是「城堡建在水上」。现在把三层拉开：
    //      台基 → 内岸干地(1.6K) → 河(4.6K) → 外岸干地(2.6K)，
    //    吊桥长 6.1K，从铰链 face+2.78K 落到 face+8.88K，正好跨过河搭到外岸。
    const riverIn = 4.1 * K, riverW = 4.6 * K, outerBank = 2.6 * K;
    const riverOut = riverIn + riverW;
    const landHX = face + riverOut + outerBank, landHZ = sz / 2 + riverOut + outerBank;
    const landGeo = new THREE.PlaneGeometry(landHX * 2, landHZ * 2).rotateX(-Math.PI / 2);
    put(new THREE.Mesh(landGeo, CASTLE_MAT.island), 0, 0.03, 0);         // 干地：内岛 + 外岸连成一块
    const waterGeo = moatShapeGeo(face + riverOut, sz / 2 + riverOut, riverW);
    const water = put(new THREE.Mesh(waterGeo, CASTLE_MAT.moat), 0, 0.11, 0);
    water.userData.moatWater = true;
    // 内外两道砌石护岸，压住河的上下边，河的边界一眼看得出来
    const innerBank = moatShapeGeo(face + riverIn + 0.25 * K, sz / 2 + riverIn + 0.25 * K, 0.7 * K);
    put(new THREE.Mesh(innerBank, CASTLE_MAT.bank), 0, 0.15, 0);
    const outerBankGeo = moatShapeGeo(face + riverOut + 0.45 * K, sz / 2 + riverOut + 0.45 * K, 0.7 * K);
    put(new THREE.Mesh(outerBankGeo, CASTLE_MAT.bank), 0, 0.15, 0);

    // ⑪ 吊桥：铰链在台基前沿，能绕 z 轴落下（整块合并成 2 个 mesh，别把 drawcall 打爆）
    const bridge = new THREE.Group();
    const bw = 3.3 * K, bl = 6.1 * K, bt = 0.28 * K;
    const woodGeos = [], ironGeos = [];
    for (let i = 0; i < 7; i++) {
        woodGeos.push(new THREE.BoxGeometry(bl / 7 * 0.92, bt, bw).translate(bl / 7 * (i + 0.5), 0, 0));
    }
    for (const sd of [-1, 1]) {
        ironGeos.push(new THREE.BoxGeometry(bl, 0.16 * K, 0.14 * K).translate(bl / 2, 0.42 * K, sd * bw / 2));
        for (let i = 0; i < 3; i++) {
            ironGeos.push(new THREE.BoxGeometry(0.14 * K, 0.5 * K, 0.14 * K).translate(bl * (i + 0.5) / 3, 0.2 * K, sd * bw / 2));
        }
    }
    for (const [geos, mat] of [[woodGeos, CASTLE_MAT.wood], [ironGeos, CASTLE_MAT.iron]]) {
        let g2 = null;
        if (mergeGeometries) { try { g2 = mergeGeometries(geos, false); } catch (e) { g2 = null; } }
        if (g2) { geos.forEach(q => q.dispose()); bridge.add(new THREE.Mesh(g2, mat)); }
        else geos.forEach(q => bridge.add(new THREE.Mesh(q, mat)));
    }
    bridge.position.set(face + 2.78 * K, Y0 + 0.12 * K, 0);
    bridge.rotation.z = 1.45;                     // 初始：抬起（下一帧由动画接管）
    bridge.userData.gate = { type: 'bridge', t: rand(0, 9), span: 11.5 };
    g.add(bridge);

    // ⑫ 吊闸（portcullis）：铁栅栏，落下来封门（合并成 1 个 mesh）
    const gate = new THREE.Group();
    const gateGeos = [];
    for (let i = 0; i < 6; i++) {
        gateGeos.push(new THREE.BoxGeometry(0.14 * K, 4.4 * K, 0.14 * K).translate(0, 0, -1.5 * K + i * 0.6 * K));
    }
    for (let i = 0; i < 4; i++) {
        gateGeos.push(new THREE.BoxGeometry(0.12 * K, 0.12 * K, 3.2 * K).translate(0, -1.9 * K + i * 1.25 * K, 0));
    }
    {
        let g3 = null;
        if (mergeGeometries) { try { g3 = mergeGeometries(gateGeos, false); } catch (e) { g3 = null; } }
        if (g3) { gateGeos.forEach(q => q.dispose()); gate.add(new THREE.Mesh(g3, CASTLE_MAT.iron)); }
        else gateGeos.forEach(q => gate.add(new THREE.Mesh(q, CASTLE_MAT.iron)));
    }
    gate.position.set(face + 2.22 * K, Y0 + 4.0 * K, 0);
    gate.userData.gate = { type: 'portcullis', t: rand(0, 5), span: 5.0, baseY: Y0 + 4.0 * K, lowY: Y0 + 2.27 * K };
    g.add(gate);

    g.userData.halfX = face + 2.5 * K;     // 台基半宽：调用方据此把最外沿贴到护栏外
    g.userData.flagPoles = flags;
    g.userData.gates = [bridge, gate];
    return g;
}

// 把一座城堡的旗布合成 1 个网格：顶点里带 aPhase / aAmp / aW / aDir，靠 FLAG_MAT 的
// 顶点着色器统一波动。合并失败时退回逐面 mesh（不掉效果，只是多几个 drawcall）。
function makeFlagCluster(anchors) {
    const geos = [];
    const c = new THREE.Color();
    for (const a of anchors) {
        const seg = a.kind === 1 ? 8 : 10;
        const geo = new THREE.PlaneGeometry(a.w, a.h, seg, 3);
        const pos = geo.attributes.position, uv = geo.attributes.uv;
        const n = pos.count;
        const col = new Float32Array(n * 3);
        const ph = new Float32Array(n);
        const amp = new Float32Array(n);
        const wt = new Float32Array(n);
        const dirGeo = new Float32Array(n * 3);
        const phase = Math.random() * 6.283;
        c.setHex(a.color);
        for (let i = 0; i < n; i++) {
            const u = uv.getX(i), v = uv.getY(i);
            // 旗形：三角旗 / 燕尾旗 / 方旗，靠缩放顶点实现三种剪裁
            let shrinkX = 1, shrinkY = 1;
            if (a.kind === 1) {
                shrinkY = 1 - u * 0.7;                      // 三角旗：越往外越窄
            } else if (a.kind === 2) {
                const tail = 0.34 * Math.abs(v - 0.5) * 2;   // 燕尾：末端中间开叉
                shrinkX = 1 - (u > 0.7 ? tail : 0);
            }
            const px = (u - 0.5) * a.w * shrinkX;
            const py = (v - 0.5) * a.h * shrinkY;
            // 静态褶皱：布面沿宽度方向起伏，静止也看得出是"布"
            const fold = Math.sin(u * 6.0 + a.w) * 0.05 * a.w * u;
            pos.setXYZ(i, px, py, fold);
            col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
            ph[i] = phase;
            amp[i] = 0.55 + a.h * 0.35;
            wt[i] = u;                                                      // 0 = 贴杆，1 = 自由端
            dirGeo[i * 3] = 1; dirGeo[i * 3 + 1] = 0; dirGeo[i * 3 + 2] = 0; // 初值：沿 +x（随后整体旋转）
        }
        // 挂点：左端贴杆（x=0），布面向 +x 展开、向下垂
        geo.translate(a.w / 2, -a.h / 2, 0);
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
        geo.setAttribute('aAmp', new THREE.BufferAttribute(amp, 1));
        geo.setAttribute('aW', new THREE.BufferAttribute(wt, 1));
        geo.setAttribute('aDir', new THREE.BufferAttribute(dirGeo, 3));
        // +x 展开 → +z 展开；dir<0 再转 180° 变 -z 展开（旗杆两侧对称）
        geo.rotateY(-Math.PI / 2);
        if (a.dir < 0) geo.rotateY(Math.PI);
        geo.translate(a.x, a.y, a.z);
        geos.push(geo);
    }
    let merged = null;
    if (mergeGeometries) {
        try { merged = mergeGeometries(geos, false); } catch (e) { merged = null; }
    }
    const grp = new THREE.Group();
    if (merged) {
        merged.userData.shared = true;
        for (const q of geos) q.dispose();
        const m = new THREE.Mesh(merged, FLAG_MAT);
        m.castShadow = false;
        grp.add(m);
    } else {
        for (const q of geos) grp.add(new THREE.Mesh(q, FLAG_MAT));
    }
    grp.userData.noMerge = true;      // 会飘，不能进静态批次
    grp.userData.animateFlag = true;
    return grp;
}

// 吊桥 / 吊闸的循环动画：一座城堡两扇共用一条相位 —— 桥放下时闸一定是抬起的，
// 桥收起后闸才落下。各城堡相位不同，路上一眼能看到"有的刚开门、有的已经关上了"。
// gatePairs 是「批次同步组」里按城堡分好的 [吊桥, 吊闸] 列表，A/B 两份副本相位一致。
function tickCastleGates(dt) {
    FLAG_UNIFORM.value += dt;
    for (const o of scenery) {
        const pairs = o.userData.gatePairs;
        if (!pairs) continue;
        for (const gates of pairs) {
            let bridge = null, port = null;
            for (const g2 of gates) {
                const t2 = g2.userData.gate && g2.userData.gate.type;
                if (t2 === 'bridge') bridge = g2;
                else if (t2 === 'portcullis') port = g2;
            }
            if (!bridge && !port) continue;
            const cfg = (bridge || port).userData.gate;
            cfg.t += dt;
            const span = cfg.span || 11.5;
            const ph = (cfg.t % span) / span;
            // 0–0.30 放下 → 0.30–0.74 平放 → 0.74–1.0 抬起
            let open;
            if (ph < 0.30) open = ph / 0.30;
            else if (ph < 0.74) open = 1;
            else open = 1 - (ph - 0.74) / 0.26;
            const sOpen = open * open * (3 - 2 * open);
            if (bridge) bridge.rotation.z = 1.45 * (1 - sOpen) - 0.355 * sOpen;
            if (port) {
                const p = port.userData.gate;
                // 闸门比吊桥晚半拍：桥落到 35% 才开始抬闸
                const down = 1 - Math.min(1, Math.max(0, (sOpen - 0.35) / 0.5));
                const sd = down * down * (3 - 2 * down);
                port.position.y = p.baseY - sd * (p.baseY - p.lowY);
            }
        }
    }
}

function buildLakesideDecor() {
    // 左岸：五座青灰石城堡，间距 64.8m，立面序列更疏朗
    const CASTLE_N = 5, CASTLE_STEP = 324 / CASTLE_N, CASTLE_SPAN = CASTLE_N * CASTLE_STEP;
    // 关键：buildTiledDecor 会把「可合并」的城堡主体烘焙进大网格，整组基准放到 z = 24，
    // 并复制成相差 span 的 A/B 两份。吊桥 / 吊闸 / 旗布因为要动、要飘不能进合并；
    // 旧版把它们单独留在 scenery 里、z 仍是各自的 cz，于是和城堡整整错开 24m，
    // 回绕周期还不同 —— 看着就是「吊门和栅栏没安在城堡上」。
    // 现在让它们沿用同一基准、同样做 A/B 两份，子对象带城堡完整坐标，严格同步滚动。
    const moving = [];
    for (let i = 0; i < CASTLE_N; i++) {
        const c = makeNordicCastle(i);
        const cx = -17.2 - c.userData.halfX + rand(0, 1.6)
            - (i % 2 === 1 ? rand(2.5, 6.0) : 0);              // 隔一座退后一层，立面有纵深
        const cz = 20 - i * CASTLE_STEP;
        c.position.x = cx;
        const gates = c.userData.gates || [];
        for (const g2 of gates) {
            c.remove(g2);                                        // 从城堡主体里摘出来
            g2.position.set(cx + g2.position.x, g2.position.y, cz);   // 换成批次组内的坐标
        }
        c.userData.gates = null;
        // 旗布单独成组：不参与静态合并，靠顶点着色器一直飘
        const fl = makeFlagCluster(c.userData.flagPoles || []);
        fl.position.set(cx, 0, cz);
        moving.push({ gates, flags: fl, phase: rand(0, 9) });
        addScenery(c, cz);                                       // 主体进大合并批次
    }
    for (const dz of [0, -CASTLE_SPAN]) {
        const batch = new THREE.Group();
        batch.position.z = 24 + dz;                              // 与城堡批次组同一基准
        batch.userData.tiling = true;                            // 同一套两倍 span 回绕
        batch.userData.noMerge = true;
        const pairs = [];
        for (const m of moving) {
            const gates = dz === 0 ? m.gates : m.gates.map(o => o.clone(true));
            for (const o of gates) {
                o.userData.gate = { ...o.userData.gate, t: m.phase };   // 两副本同相位
                batch.add(o);
            }
            pairs.push(gates);
            batch.add(dz === 0 ? m.flags : m.flags.clone(true));
        }
        batch.userData.gatePairs = pairs;
        addScenery(batch, 24 + dz);
    }
    for (let i = 0; i < 12; i++) {
        addScenery(makeLamp(-1), 20 - i * 27);
        addScenery(makeLamp(1), 6 - i * 27);
        addScenery(makeGantry(), 9.5 - i * 27);        // 接触网门架
    }
    for (let i = 0; i < 27; i++) {
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.4, 1.1)), rockMat);
        r.position.set(rand(5.2, 9.5), 0, 0);
        r.scale.y = 0.6;
        r.rotation.y = rand(0, 3);
        r.castShadow = true;
        addScenery(r, 20 - i * 12 + rand(-3, 3));
    }
    for (let i = 0; i < 18; i++) addScenery(makeReeds(), 14 - i * 18 + rand(-3, 3));    // 湖边芦苇
    for (let i = 0; i < 12; i++) addScenery(makeFlowers(), 2 - i * 27 + rand(-4, 4));   // 野花丛
    addScenery(makePlatform(), -60);                                                   // 站台（每循环一座）
    for (let i = 0; i < 3; i++) addScenery(makeFrame(), -30 - i * 108);
}

// ---- 火车隧道：洞间距离固定 50m，各段洞长随机且互不相同 ----
// 洞长不再写死成一张表：每次开局随机分配（110–260m，2m 一档），任意两段至少差 24m，
// 绝不出现「每个隧道长度都一样」；相邻两洞之间的露天段统一 50 米。
//   · 洞内亮度按"距洞口的距离"做顶点色渐变：贴洞口最亮，洞心压到 44%
//   · 管段按各自的长度建几何，滚到身后整段回退一个周期（TUNNEL_CYCLE）
//   · 柱阵排期、洞口亮度、出洞里程全部由 TUNNEL_PLAN 动态推导
const TUNNEL_R = 8;
const TUNNEL_GAP = 50;          // 隧道之间的距离（露天段），固定 50 米
const TUNNEL_COUNT = 5;
function rollTunnelPlan() {
    const LO = 110, HI = 260, MIN_DIFF = 24, STEP = 2;
    const lens = [];
    for (let guard = 0; lens.length < TUNNEL_COUNT && guard < 400; guard++) {
        const v = Math.round((LO + Math.random() * (HI - LO)) / STEP) * STEP;
        if (lens.every(x => Math.abs(x - v) >= MIN_DIFF)) lens.push(v);
    }
    if (lens.length < TUNNEL_COUNT) {                 // 极端兜底：等距铺开，仍然互不相同
        lens.length = 0;
        for (let i = 0; i < TUNNEL_COUNT; i++) {
            lens.push(LO + Math.round(i * (HI - LO) / (TUNNEL_COUNT - 1) / STEP) * STEP);
        }
    }
    return lens.map(len => ({ len, gap: TUNNEL_GAP }));
}
const TUNNEL_PLAN = rollTunnelPlan();
const TUNNEL_CYCLE = TUNNEL_PLAN.reduce((a, p) => a + p.len + p.gap, 0);
const TUNNEL_SHELLS = TUNNEL_PLAN.length;
const tunnelWallMat = shared(new THREE.MeshStandardMaterial({ roughness: 0.92, side: THREE.BackSide }));
const walkwayMat = shared(std(0x83868c, { roughness: 0.9 }));
const drainMat = shared(std(0x191b1f, { roughness: 0.7 }));
const trayMat = shared(std(0x3d4148, { metalness: 0.5, roughness: 0.5 }));
const ledMat = shared(new THREE.MeshBasicMaterial({ color: 0xf4f8ff }));
const reflMat = shared(new THREE.MeshBasicMaterial({ color: 0xffc23a }));
const hydrantMat = shared(std(0xb03028, { roughness: 0.5 }));
const portalMat = shared(new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.95, side: THREE.DoubleSide }));
const tunnelRockMat = shared(std(0x4a4f52, { roughness: 0.98, flatShading: true }));
const tunnelShellMat = shared(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: true }));

// 周期内的相位（0 ~ TUNNEL_CYCLE）
function tunnelPhase(s) {
    return ((s % TUNNEL_CYCLE) + TUNNEL_CYCLE) % TUNNEL_CYCLE;
}
// 相位 p 落在哪一段：返回 { idx, seg, local, start } 或 null（露天）
function tunnelSegAtPhase(p) {
    let acc = 0;
    for (let i = 0; i < TUNNEL_PLAN.length; i++) {
        const seg = TUNNEL_PLAN[i];
        if (p < acc + seg.len) return { idx: i, seg, local: p - acc, start: acc };
        acc += seg.len + seg.gap;
    }
    return null;
}
// 里程 s 处的"洞内程度"：1 = 洞心最暗，0 = 露天或正贴洞口
function tunnelnessAt(s) {
    const hit = tunnelSegAtPhase(tunnelPhase(s));
    if (!hit) return 0;
    const d = Math.min(hit.local, hit.seg.len - hit.local);   // 到最近洞口的距离
    return clamp((d - 4) / 26, 0, 1);
}
// 柱阵排期用：这个里程能不能起一段柱子（必须在洞内、且离两端留够余量）
function tunnelAllowsPillar(s) {
    const hit = tunnelSegAtPhase(tunnelPhase(s));
    if (!hit) return false;
    return hit.local > 30 && hit.local < hit.seg.len - 52;
}
// 本段隧道的出口里程（柱阵在它之前必须收尾，跑完最后一根柱子就出洞）
function tunnelExitAt(s) {
    const p = tunnelPhase(s);
    let acc = 0;
    for (const seg of TUNNEL_PLAN) {
        if (p < acc + seg.len) return s - p + acc + seg.len;
        acc += seg.len + seg.gap;
    }
    return s - p + TUNNEL_CYCLE + TUNNEL_PLAN[0].len;   // 露天段：下一段的出口
}

// 管壁几何：半圆柱 + 顶点色亮度渐变（近洞口亮、洞心暗），按长度缓存
const _tunnelShellGeo = new Map();
function tunnelShellGeo(len) {
    if (_tunnelShellGeo.has(len)) return _tunnelShellGeo.get(len);
    const T = len;
    const g = new THREE.CylinderGeometry(TUNNEL_R, TUNNEL_R, T, 44, Math.max(12, Math.round(T / 4)), true, Math.PI / 2, Math.PI);
    const pos = g.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    // 整体亮度 = 原曲线 × 2/3（洞顶原来偏亮，按需求压到三分之二）
    const DIM = 2 / 3;
    for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) + T / 2) / T;                 // 0 = 洞口，1 = 另一端洞口
        const dEdge = Math.min(t, 1 - t);                    // 距最近洞口（0 = 正好在洞口）
        // 亮度曲线：洞口一圈压暗（从外面看进去是"黑洞"），离洞口 13% 处最亮
        // （天光从洞口漫进来），再往洞心衰减到 44%。
        const peak = 1 - Math.abs(dEdge - 0.13) / 0.235;
        const b0 = dEdge < 0.035 ? 0.46 : 0.44 + 0.60 * clamp(peak, 0, 1);
        const b = b0 * DIM;
        const x = pos.getX(i);                               // 旋转前 x 是侧向：墙根再压一点
        const foot = 1 - 0.22 * clamp((Math.abs(x) - 3.5) / 4.5, 0, 1);
        cols[i * 3] = b * foot * 1.00;
        cols[i * 3 + 1] = b * foot * 0.99;
        cols[i * 3 + 2] = b * foot * 0.95;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.rotateX(Math.PI / 2);          // 管轴躺到 z 方向
    g.translate(0, 0, -T / 2);       // 入口在 z=0，向 -z 延伸
    g.userData.shared = true;
    _tunnelShellGeo.set(len, g);
    return g;
}

// 一段隧道：管壁 + 两端洞门环 + 顶灯 + 壁面轮廓标（全部合进这一组，随世界滚）
function makeTunnelShell(len) {
    const g = new THREE.Group();
    const T = len;
    const tube = new THREE.Mesh(tunnelShellGeo(T), tunnelShellMat);
    tube.receiveShadow = false;
    g.add(tube);
    for (const z of [0, -T]) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(TUNNEL_R + 0.75, TUNNEL_R + 0.75, 1.5, 44, 1, true, Math.PI / 2, Math.PI), portalMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.z = z;
        g.add(ring);
        // 洞口的浅色压顶（像混凝土门楣），远处一眼能认出"那里有个洞"
        const cap = new THREE.Mesh(new THREE.BoxGeometry(TUNNEL_R * 2 + 2.6, 0.9, 1.7), portalMat);
        cap.position.set(0, TUNNEL_R + 0.75, z);
        g.add(cap);
    }
    // 顶灯 + 壁灯：合并成两个 mesh，别让每段隧道多出几十个 drawcall
    const lamps = [], marks = [];
    for (let z = -6; z > -T; z -= 7.5) {
        lamps.push(new THREE.BoxGeometry(0.5, 0.08, 1.6).translate(0, TUNNEL_R - 0.26, z));
    }
    for (let z = -10; z > -T; z -= 13) {
        for (const sx of [-1, 1]) {
            marks.push(new THREE.BoxGeometry(0.06, 0.16, 0.34).translate(sx * 7.4, 1.3, z));
        }
    }
    const lampGeo = mergeGeometries && lamps.length ? mergeGeometries(lamps, false) : null;
    if (lampGeo) {
        for (const q of lamps) q.dispose();
        lampGeo.userData.shared = true;
        g.add(new THREE.Mesh(lampGeo, ledMat));
    } else {
        for (const q of lamps) g.add(new THREE.Mesh(q, ledMat));
    }
    const markGeo = mergeGeometries && marks.length ? mergeGeometries(marks, false) : null;
    if (markGeo) {
        for (const q of marks) q.dispose();
        markGeo.userData.shared = true;
        g.add(new THREE.Mesh(markGeo, reflMat));
    } else {
        for (const q of marks) g.add(new THREE.Mesh(q, reflMat));
    }
    // 露天段（本管段出口到下一段入口之间）的铁路家具：挂在管段上一起滚，
    // 这样它们永远待在露天段里，不会像按 324m 铺的装饰那样跑进洞里
    const gapZ = -T - 26;
    g.add(makeRailMast());
    g.children[g.children.length - 1].position.z = gapZ;
    for (const s2 of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
            const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.5, 1.4)), tunnelRockMat);
            r.position.set(s2 * rand(9.5, 15), rand(0, 0.3) - 0.2, gapZ - k * 7 + rand(-2, 2));
            r.scale.y = 0.55;
            r.rotation.y = rand(0, 3);
            g.add(r);
        }
        for (let k = 0; k < 4; k++) {
            const reed = new THREE.Mesh(new THREE.ConeGeometry(0.1, rand(0.5, 1.0), 4), reedMat);
            reed.position.set(s2 * rand(6.8, 8.4), 0.3, gapZ - 4 - k * 6 + rand(-2, 2));
            g.add(reed);
        }
    }
    g.userData.period = { wrapAt: T + 26, recycle: TUNNEL_CYCLE };
    g.userData.noMerge = true;      // 管段按各自周期回收，不能混进 324m 的静态批次
    return g;
}

function buildTunnelWorld() {
    // 拱形管壁的混凝土贴图（只做一次，所有管段共用）
    const concTex = makeTex(256, 256, (c, w, h) => {
        c.fillStyle = '#565c64'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 900; i++) {   // 噪点
            c.fillStyle = `rgba(${Math.random() < 0.5 ? '40,42,46' : '150,152,156'},${rand(0.04, 0.12)})`;
            c.fillRect(rand(0, w), rand(0, h), rand(1, 3), rand(1, 3));
        }
        for (let i = 0; i < 7; i++) {     // 竖向水渍
            const x = rand(0, w), ww = rand(3, 10);
            const grd = c.createLinearGradient(x, 0, x + ww, 0);
            grd.addColorStop(0, 'rgba(35,37,41,0)'); grd.addColorStop(0.5, `rgba(35,37,41,${rand(0.25, 0.5)})`); grd.addColorStop(1, 'rgba(35,37,41,0)');
            c.fillStyle = grd; c.fillRect(x, 0, ww, h);
        }
        c.fillStyle = 'rgba(28,30,34,0.85)'; c.fillRect(0, 0, w, 3);   // 环缝
    }, 12, 42);
    concTex.userData.shared = false;
    tunnelShellMat.map = concTex;
    tunnelShellMat.needsUpdate = true;

    // 露天段的场地：路基扩展到 120m 宽，两侧是岩石路堑，远处留一层山影，
    // 这样"出洞"看到的是山间铁路，而不是虚空
    addMesh(flat(120, 340), std(0x3d4245, { roughness: 1 }), 0, -0.34, -150);
    addMesh(flat(26, 340), std(0x2f3437, { roughness: 0.95 }), 0, -0.03, -150);
    for (const s of [-1, 1]) {
        const slope = new THREE.Mesh(new THREE.BoxGeometry(26, 15, 340), tunnelRockMat);
        slope.position.set(s * 27, 5.2, -150);
        slope.rotation.z = -s * 0.34;
        slope.receiveShadow = true;
        worldGroup.add(slope);
    }
    for (let i = 0; i < 9; i++) {
        const h = 26 + rand(0, 26), r = 34 + rand(0, 16);
        const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), hillMat);
        m.position.set(-220 + i * 56 + rand(-12, 12), h / 2 - 6, -300 - rand(0, 40));
        worldGroup.add(m);
    }

    // 地面（潮湿低粗糙度反光）+ 轨道 + 钢轨，与湖畔同款保持铁路感
    addMesh(flat(16, 340), std(0x2e3034, { roughness: 0.5, metalness: 0.12 }), 0, 0, -150);
    for (const lx of LANES) {
        addMesh(flat(2.4, 340), std(0xffffff, { map: trackTex, roughness: 0.9 }), lx, 0.02, -150);
        for (const off of [-0.55, 0.55]) addMesh(new THREE.BoxGeometry(0.1, 0.14, 340), railMat, lx + off, 0.07, -150);
    }
    // 两侧检修道 + 排水沟 + 电缆桥架
    for (const s of [-1, 1]) {
        addMesh(new THREE.BoxGeometry(1.6, 0.28, 340), walkwayMat, s * 3.7, 0.14, -150);
        addMesh(new THREE.BoxGeometry(0.5, 0.1, 340), drainMat, s * 2.65, 0.03, -150);
        addMesh(new THREE.BoxGeometry(0.35, 0.12, 340), trayMat, s * 6.9, 3.4, -150, { receive: false });
        addMesh(new THREE.BoxGeometry(0.1, 0.5, 340), trayMat, s * 6.9, 3.15, -150, { receive: false });
    }
    // 洞内暖光：跟着玩家走的一盏，出洞自动灭（见 updateTunnelLight）
    const lamp = new THREE.PointLight(0xffe2b0, 0, 42, 1.6);
    lamp.position.set(0, 5.4, -14);
    lamp.userData.plOrder = 3;
    lamp.userData.tunnelLamp = true;
    lamp.userData.noMerge = true;      // 点光没有几何体，混进静态合批会被整只删掉
    worldGroup.add(lamp);
    tunnelLampRef = lamp;
}

// 接触网门架（露天段的铁路感）
function makeRailMast() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.22, 7.2, 0.22), poleMat);
    pole.position.set(5.2, 3.6, 0);
    g.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.16, 0.16), poleMat);
    arm.position.set(2.2, 6.7, 0);
    g.add(arm);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.12), poleMat);
    brace.position.set(3.8, 6.1, 0);
    brace.rotation.z = -0.42;
    g.add(brace);
    return g;
}

function buildTunnelDecor() {
    // 按「长短表」排管段：每段一个洞口，位置对齐里程相位（世界 z = p0 - 段起点）
    const p0 = tunnelPhase(S.D);
    let acc = 0;
    for (const seg of TUNNEL_PLAN) {
        const shell = makeTunnelShell(seg.len);
        addScenery(shell, p0 - acc);
        acc += seg.len + seg.gap;
    }
}

// 每帧：按玩家里程算"洞内程度"，同时调天空 / 太阳 / 雾 / 暖光
// 必须在 ATMO.update 之后调用（它每帧都会重写 fog / hemi / sun）
const TUNNEL_DARK = { fog: new THREE.Color(0x0b0e14), bg: new THREE.Color(0x0a0d13) };
let tunnelLampRef = null;
function updateTunnelLight(dt) {
    if (curTheme !== 'tunnel') return;
    const tn = tunnelnessAt(S.D);
    // 天空不藏：洞口外面就是白天，藏了天空远端的洞口会变成一块黑板。
    // 洞内只把雨丝/薄雾遮蔽掉（洞里不能下雨），亮度交给下面的雾与光衰减。
    if (typeof ATMO !== 'undefined') {
        if (ATMO.setIndoor) ATMO.setIndoor(false);
        if (ATMO.setShelter) ATMO.setShelter(tn > 0.3);
    }
    if (tn > 0.002) {
        const k = Math.pow(tn, 0.75);
        scene.fog.color.lerp(TUNNEL_DARK.fog, k * 0.95);
        scene.fog.near = scene.fog.near * (1 - k) + 42 * k;
        scene.fog.far = scene.fog.far * (1 - k) + 300 * k;
        hemi.intensity *= (1 - 0.58 * k);
        sun.intensity *= (1 - 0.96 * k);
        if (scene.background && scene.background.isColor) scene.background.lerp(TUNNEL_DARK.bg, k * 0.95);
    }
    // 洞内暖光：贴洞口弱、洞心强，位置固定在玩家前方
    if (tunnelLampRef && tunnelLampRef.parent) {
        tunnelLampRef.intensity = 10 * tn;
        tunnelLampRef.position.set(S.x * 0.4, 5.4, -16);
    }
}

// ---- 城市街区（白天阳光）----
const cityRoadTex = shared(makeTex(256, 256, (c, w, h) => {
    c.fillStyle = '#3a3d44'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
        c.fillStyle = `rgba(${Math.random() < 0.5 ? '20,22,26' : '120,124,132'},${rand(0.05, 0.14)})`;
        c.fillRect(rand(0, w), rand(0, h), rand(1, 3), rand(1, 3));
    }
    c.fillStyle = '#e8e8e2';
    for (const x of [84, 168]) c.fillRect(x, 10, 5, 140);   // 车道虚线（±1.2m 处）
    c.fillRect(6, 0, 4, h); c.fillRect(w - 10, 0, 4, h);    // 路缘实线
}, 1, 56));   // V 向 56 次 → 虚线周期约 6m
const sidewalkMat = shared(std(0x9aa0a8, { roughness: 0.95 }));
const curbMat = shared(std(0x7c828c, { roughness: 0.9 }));
const hedgeMat = shared(std(0x3f6b35, { roughness: 0.9 }));
const hedgeTopMat = shared(std(0x557a44, { roughness: 0.85 }));
const skylineMatA = shared(new THREE.MeshLambertMaterial({ color: 0xa9bdd2 }));
const skylineMatB = shared(new THREE.MeshLambertMaterial({ color: 0x8fa8c2 }));
const slabMat = shared(std(0xd8d4cc, { roughness: 0.9 }));
const acMat = shared(std(0xc8ccd2, { roughness: 0.7, metalness: 0.3 }));
const glassTex = shared(makeTex(128, 128, (c, w, h) => {
    const grd = c.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#7fb2e0'); grd.addColorStop(1, '#4a7cb0');
    c.fillStyle = grd; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
        const r = Math.random();
        if (r < 0.18) { c.fillStyle = r < 0.09 ? '#ffd88a' : '#3a5a7a'; c.fillRect(x + 1, y + 1, 14, 14); }
    }
    c.strokeStyle = 'rgba(230,240,250,0.8)'; c.lineWidth = 1;
    for (let i = 0; i <= w; i += 16) {
        c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke();
        c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke();
    }
}));
const shopTex = shared(makeTex(256, 384, (c, w, h) => {
    const shops = [['便利店', '#e53935'], ['咖啡馆', '#6d4c41'], ['药房', '#1e88e5'], ['书店', '#43a047'], ['水果铺', '#fb8c00'], ['早餐店', '#f9a825']];
    c.textAlign = 'center'; c.textBaseline = 'middle';
    shops.forEach(([name, color], i) => {
        c.fillStyle = color; c.fillRect(0, i * 64, w, 64);
        c.fillStyle = '#fff'; c.font = 'bold 42px sans-serif';
        c.fillText(name, w / 2, i * 64 + 34);
    });
}));
const zebraTex = shared(makeTex(128, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(240,240,235,0.92)';
    for (let x = 8; x < w; x += 24) c.fillRect(x, 0, 12, h);
}));
const busStopTex = shared(makeTex(128, 64, (c, w, h) => {
    c.fillStyle = '#1e88e5'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff'; c.font = 'bold 34px sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('公交站', w / 2, h / 2 + 2);
}));
const adTex = shared(makeTex(256, 128, (c, w, h) => {
    const grd = c.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#ff7043'); grd.addColorStop(1, '#d81b60');
    c.fillStyle = grd; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff'; c.font = 'bold 52px sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('奔跑吧', w / 2, h / 2 - 14);
    c.font = '26px sans-serif';
    c.fillText('城市运动季 · 全民开跑', w / 2, h / 2 + 34);
}));
const trunkMat2 = shared(std(0x7a5c40, { roughness: 0.9 }));
const crownMat = shared(std(0x5d8f4e, { roughness: 0.85, flatShading: true }));
const CAR_COLORS = [0xd23c2e, 0x2e6fd2, 0xf0f2f5, 0xffb81e, 0x3aa655, 0x22262c];

// ---- 城市街区：中式旧城 + 赛博街道（实现见 js/oldtown.js） ----
let OLDTOWN = null;
function cityCtx() {
    return { THREE, ATMO, THEMES, worldGroup, addMesh, addScenery, flat, std, shared, makeTex, rand, pick, clamp, LMGLB };
}
function buildCityWorld() {
    if (!OLDTOWN) OLDTOWN = createOldTown(cityCtx());
    OLDTOWN.buildWorld();
}

// 居民楼 / 玻璃幕墙楼（底部带商铺招牌）
function makeCityBuilding(glass) {
    const g = new THREE.Group();
    const w = rand(9, 14), d = rand(12, 16), h = glass ? rand(24, 44) : rand(10, 24);
    const tex = (glass ? glassTex : winTex).clone();
    tex.userData.shared = false;   // 克隆体随楼一起销毁
    tex.repeat.set(Math.round(d / 3), Math.round(h / 3));
    tex.needsUpdate = true;
    const tint = glass ? 0xdfe8f2 : new THREE.Color().setHSL(Math.random(), 0.35, 0.72);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(tint, { map: tex, roughness: glass ? 0.35 : 0.85 }));
    body.position.y = h / 2;
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    // 底部商铺招牌横条（6 款随机）
    const st = shopTex.clone();
    st.userData.shared = false;
    st.repeat.set(1, 1 / 6);
    st.offset.y = Math.floor(rand(0, 6)) / 6;
    st.needsUpdate = true;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 1.1, 0.15), new THREE.MeshBasicMaterial({ map: st }));
    sign.position.set(0, 3.1, d / 2 + 0.08);
    g.add(sign);
    if (!glass) {
        // 住宅楼：阳台挑板 + 空调外机 + 晾晒色块
        const floors = Math.floor((h - 4) / 3);
        for (let f = 0; f < floors; f++) {
            const y = 4.2 + f * 3;
            const bal = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.12, 0.7), slabMat);
            bal.position.set(0, y, d / 2 + 0.35);
            g.add(bal);
            if (Math.random() < 0.7) {
                const ac = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.3), acMat);
                ac.position.set(rand(-w / 3, w / 3), y - 1.1, d / 2 + 0.16);
                g.add(ac);
            }
            if (Math.random() < 0.4) {
                const laundry = new THREE.Mesh(new THREE.BoxGeometry(rand(0.4, 0.9), 0.5, 0.05),
                    std(pick([0xff8fb8, 0x7ec8ff, 0xffe082, 0xffffff]), { roughness: 0.9 }));
                laundry.position.set(rand(-w / 3, w / 3), y + 0.3, d / 2 + 0.42);
                g.add(laundry);
            }
        }
    }
    g.userData.depth = d;
    return g;
}

function makeCrosswalk() {
    const m = new THREE.Mesh(flat(7.6, 3.2), new THREE.MeshBasicMaterial({ map: zebraTex, transparent: true }));
    m.position.y = 0.035;
    return m;
}

function makeTrafficLight(side) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.4, 8), poleMat);
    pole.position.y = 1.7;
    pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.09, 0.09), poleMat);
    arm.position.set(-side * 0.9, 3.3, 0);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.8, 0.22), darkMat);
    head.position.set(-side * 1.75, 2.92, 0);
    g.add(pole, arm, head);
    const lit = Math.floor(rand(0, 3));
    [0xe53935, 0xfdd835, 0x43a047].forEach((color, i) => {
        const on = i === lit;
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
            on ? new THREE.MeshBasicMaterial({ color }) : std(0x2c2f34, { roughness: 0.6 }));
        dot.position.set(-side * 1.75, 3.18 - i * 0.26, 0.12);
        g.add(dot);
    });
    g.position.x = side * 4.15;
    return g;
}

function makeCityTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 2.4, 7), trunkMat2);
    trunk.position.y = 1.2;
    trunk.castShadow = true;
    g.add(trunk);
    for (const [x, y, z, r] of [[0, 3.0, 0, 1.15], [-0.65, 2.55, 0.25, 0.85], [0.6, 2.6, -0.2, 0.8]]) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(r * rand(0.9, 1.1), 9, 7), crownMat);
        s.position.set(x, y, z);
        s.castShadow = true;
        g.add(s);
    }
    return g;
}

function makeBusStop(side) {
    const g = new THREE.Group();
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 1.5), std(0x4a90d9, { roughness: 0.5 }));
    roof.position.y = 2.5;
    roof.castShadow = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.5, 0.06),
        std(0xbcd8f0, { roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.55 }));
    back.position.set(0, 1.6, side > 0 ? 0.68 : -0.68);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.4), slabMat);
    bench.position.y = 0.55;
    g.add(roof, back, bench);
    for (const x of [-1.6, 1.6]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), poleMat);
        post.position.set(x, 1.25, 0);
        g.add(post);
    }
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.06), new THREE.MeshBasicMaterial({ map: busStopTex }));
    board.position.set(-1.9, 2.0, 0);
    const bpole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), poleMat);
    bpole.position.set(-1.9, 1.0, 0);
    g.add(board, bpole);
    g.position.x = side * 5.4;
    return g;
}

function makeBillboard(side) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 4.6, 8), poleMat);
    pole.position.y = 2.3;
    pole.castShadow = true;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.7, 0.12),
        [darkMat, darkMat, darkMat, darkMat, new THREE.MeshBasicMaterial({ map: adTex }), darkMat]);
    panel.position.y = 5.4;
    panel.castShadow = true;
    g.add(pole, panel);
    g.position.x = side * 9.6;
    g.rotation.y = side > 0 ? -0.25 : 0.25;
    return g;
}

function buildCityDecor() {
    if (!OLDTOWN) OLDTOWN = createOldTown(cityCtx());
    OLDTOWN.buildDecor();
    try { ART.decorateCity(addScenery); } catch (e) { console.warn('[art] 城市科幻层失败', e); }
}

// ==== CAMPUS-BLOCK BEGIN（tools/patch11_real_campus.py 生成，勿手改）====
// =====================================================================
//  阳光校园 → 真实三维校园（北京大学未名湖片区 · OSM 实测 1:1）
//
//  ★ 这个场景的世界模型和另外三个不一样：
//    · 玩家永远在原点、永远朝 -z；相机一动不动
//    · 整块校园底板（660 栋真实建筑 + 未名湖 + 真弯道）绕玩家平移 + 旋转，
//      把「脚下这段路」对齐 -z。路线拐弯 → 画面里整片校园甩过去，
//      和神庙逃亡「镜头跟着人转」等价，但不用动相机、不用动玩家。
//    · 障碍 / 金币仍在「跑道坐标」里做一维逻辑与碰撞（o.z = 距离），
//      只有渲染位置改成沿路线投影（placeOnTrack）。
//  ★ 45° 以上的路口要主动转向：路口前 60m 出箭头，按错方向或没按 = 撞楼。
// =====================================================================
const CAMPUS_PLATE_URL = 'gz:model/gltf-binary;base64,OMITTED-06-2.33MB-see-INLINE-ASSETS-md';
const CAMPUS2_PLATE_URL = 'gz:model/gltf-binary;base64,OMITTED-07-1.45MB-see-INLINE-ASSETS-md';

// 两个校园共用同一套机制（底板绕玩家转 + 路线投影 + 转向判定），
// 各自持有一份运行态（里程 / 转角 / 路口游标），切场景时整体换指向。
const CAMPUS_SETS = {
    campus: {
        id: 'campus',
        url: CAMPUS_PLATE_URL,
        // pts / total 由 tools/patch11_real_campus.py 注入（three 坐标，单位米）
        pts: [[-508,410],[-508,226],[-700,226],[-700,37],[-484,37],[-484,-96],[-289,-96],[-289,-250],[-330,-330],[-380,-430],[-392,-505],[-500,-548],[-640,-542],[-800,-470],[-800,-360],[-755,-240],[-700,-120],[-660,20],[-640,200],[-640,410]],
        total: 3011.35,
        landmarks: [{"name": "邱德拔体育馆", "x": -79.6, "z": 237.1, "h": 16.5}, {"name": "百周年纪念讲堂", "x": -472.2, "z": 106.1, "h": 10.0}, {"name": "博雅塔", "x": -359.5, "z": -347.5, "h": 31.0}],
        startArc: 1300,       // 开局切到博雅塔南侧的湖边直道
    },
    campus2: {
        id: 'campus2',
        url: CAMPUS2_PLATE_URL,
        pts: [[390,150],[390,-512],[690,-512],[690,150]],
        total: 1924.00,
        landmarks: [],
        startArc: 0,          // 矩形环从西南角起步即可
    },
};
for (const S of Object.values(CAMPUS_SETS)) {
    S.roadHalf = 3.8;
    S.cum = [];
    S.junctions = [];
    S.ready = false;
    S.group = null;
    S.s = 0;                  // 玩家沿路线的里程（一直累加，不取模）
    S.theta = 0;              // 底板绕 Y 的旋转
    S.rawTheta = 0;
    S.px = 0; S.pz = 0;       // 玩家脚下的路线点（底板坐标）
    S.ux = 0; S.uz = -1;      // 当前前进方向（底板坐标）
    S.jIdx = 0; S.jLap = 0; S.nextAbs = 0;
    S.pendingDir = 0;         // 最近一次转向输入：-1 左 / +1 右
    S.pendingAt = -1e9;
    S.TURN_DEG = 45;          // 超过这个角度才需要主动转向
    S.INPUT_WINDOW = 10;      // 只有离路口 10m 内按下才算「打方向」；再远只换道
    S.DIR_SMOOTH = 7.0;       // 方向平滑半窗（米）——把 90° 急弯摊成 ~14m 的转身
    // 手动转向：路口前 TURN_HOLD 米内没按对方向，底板就保持进弯朝向（路自己拐走，人直线冲出去）。
    // 按对了才放开，最多按 TURN_RATE 的角速度转——90° 约 14m / 0.9 秒。
    S.TURN_HOLD = 10;         // 和转向窗口对齐：最后 10m 没打方向才冻住底板朝向
    S.TURN_RATE = 0.13;
}
// 当前活动集：campusResetRun / buildCampusWorld 在场景切换时重指
let CAMPUS = CAMPUS_SETS.campus;

(function campusRouteInit() {
    for (const C of Object.values(CAMPUS_SETS)) {
        C.pts = C.pts.map(p => ({ x: p[0], z: p[1] }));
        const n = C.pts.length;
        let acc = 0;
        C.cum = [0];
        for (let i = 0; i < n; i++) {
            const a = C.pts[i], b = C.pts[(i + 1) % n];
            acc += Math.hypot(b.x - a.x, b.z - a.z);
            C.cum.push(acc);
        }
        C.total = acc;
        // 路口表：按里程升序；起点那个拐角算在「一圈末尾」（否则一开场就判负）
        for (let i = 1; i < n; i++) {
            const prev = C.pts[i - 1], cur = C.pts[i], next = C.pts[(i + 1) % n];
            const sx = cur.x - prev.x, sz = cur.z - prev.z;
            const tx = next.x - cur.x, tz = next.z - cur.z;
            const ls = Math.hypot(sx, sz) || 1, lt = Math.hypot(tx, tz) || 1;
            const u0x = sx / ls, u0z = sz / ls, u1x = tx / lt, u1z = tz / lt;
            const cross = u0x * u1z - u0z * u1x;
            const dot = u0x * u1x + u0z * u1z;
            const deg = Math.atan2(cross, dot) * 180 / Math.PI;
            if (Math.abs(deg) < C.TURN_DEG) continue;
            // theta = atan2(uz, ux) + PI/2，所以 dTheta = dPsi：转角为负 = 左转
            C.junctions.push({ at: C.cum[i], dir: deg < 0 ? 'L' : 'R', deg: Math.abs(deg) });
        }
        {
            const prev = C.pts[n - 1], cur = C.pts[0], next = C.pts[1];
            const sx = cur.x - prev.x, sz = cur.z - prev.z;
            const tx = next.x - cur.x, tz = next.z - cur.z;
            const ls = Math.hypot(sx, sz) || 1, lt = Math.hypot(tx, tz) || 1;
            const cross = (sx / ls) * (tz / lt) - (sz / ls) * (tx / lt);
            const dot = (sx / ls) * (tx / lt) + (sz / ls) * (tz / lt);
            const deg = Math.atan2(cross, dot) * 180 / Math.PI;
            if (Math.abs(deg) >= C.TURN_DEG) {
                C.junctions.push({ at: C.total, dir: deg < 0 ? 'L' : 'R', deg: Math.abs(deg) });
            }
        }
    }
})();

/** 路线上的点（arc 取模到一圈内） */
function campusPoint(arc) {
    const C = CAMPUS;
    const L = C.total;
    let a = arc % L;
    if (a < 0) a += L;
    const cum = C.cum;
    let lo = 0, hi = cum.length - 1;
    while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= a) lo = mid; else hi = mid;
    }
    const span = cum[lo + 1] - cum[lo];
    const t = span > 1e-6 ? (a - cum[lo]) / span : 0;
    const A = C.pts[lo], B = C.pts[(lo + 1) % C.pts.length];
    return { x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t };
}

/** 平滑后的前进方向（跨路口时摊开，避免底板瞬间甩 90°） */
function campusDir(arc) {
    const C = CAMPUS;
    const a = campusPoint(arc - C.DIR_SMOOTH);
    const b = campusPoint(arc + C.DIR_SMOOTH);
    let dx = b.x - a.x, dz = b.z - a.z;
    const L = Math.hypot(dx, dz);
    if (L < 1e-4) return { x: 0, z: -1 };
    return { x: dx / L, z: dz / L };
}

/** 把「跑道坐标」(x, y, z) 放到世界里的正确位置（含弯道） */
function placeOnTrack(mesh, x, y, z) {
    if (curTheme !== CAMPUS.id || !CAMPUS.ready) { mesh.position.set(x, y, z); return; }
    const C = CAMPUS;
    const arc = C.s - z;                     // z 为负 = 在前方
    const r = campusPoint(arc);
    const d = campusDir(arc);
    // 跑道系 +x（玩家右手）在底板系里是 (-dz, dx)
    const px = r.x - d.z * x;
    const pz = r.z + d.x * x;
    const th = C.theta, ct = Math.cos(th), st = Math.sin(th);
    const vx = px - C.px, vz = pz - C.pz;
    mesh.position.set(vx * ct + vz * st, y, -vx * st + vz * ct);
    mesh.rotation.y = th + Math.atan2(-d.x, -d.z);
}

/** 校园里网格的 rotation.y 每帧被投影覆盖，自转要单独累计 */
function trackSpin(mesh, dt, spd) {
    if (curTheme === CAMPUS.id && CAMPUS.ready) {
        mesh.userData.spin = (mesh.userData.spin || 0) + dt * spd;
        mesh.rotation.y += mesh.userData.spin;
    } else {
        mesh.rotation.y += dt * spd;
    }
}

/** 每帧推进：算底板该转多少、放哪里 */
function campusUpdate(step) {
    if (!CAMPUS.ready) return;
    const C = CAMPUS;
    // 可见性每帧对齐当前场景：底板是挂在一个独立 Group 上的，
    // 只靠 buildWorld 里那次赋值会被「死亡重开局」踩掉——
    // 结果就是在「湖畔轨道」里把整块燕园（草坪 + 教学楼 + 未名湖）叠上去，
    // 表现为湖面一会蓝一会绿、教学楼凭空立在湖面上。
    C.group.visible = (curTheme === C.id);
    if (curTheme !== C.id) return;
    const prevS = C.s;
    C.s += step;
    const p = campusPoint(C.s);
    const d = campusDir(C.s);
    C.px = p.x; C.pz = p.z; C.ux = d.x; C.uz = d.z;
    const raw = Math.atan2(d.z, d.x) + Math.PI / 2;
    C.rawTheta = raw;
    let dd = raw - C.theta;
    dd = Math.atan2(Math.sin(dd), Math.cos(dd));   // 归一到 (-π, π]
    // ★ 转向是玩家打出来的，不是自动的：
    //   路口前 TURN_HOLD 米内还没按对方向 → 底板保持进弯前的朝向，画面里路自己拐走、
    //   玩家直线冲过去，到路口判负（视觉和死因终于对上了）。
    //   按对了才放开，并且按 TURN_RATE 限速转，避免一瞬间甩 90°。
    const jn = C.junctions[C.jIdx];
    const needDir = jn ? (jn.dir === 'L' ? -1 : 1) : 0;
    const toJ = jn ? C.nextAbs - C.s : Infinity;
    // 内测版无敌 / 自动化截图（__noTurnFail）时不必等按键，直接跟着路线转
    const assist = (typeof BETA_GOD !== 'undefined' && BETA_GOD) || window.__noTurnFail === true;
    const committed = !!jn && (assist || (C.pendingDir === needDir
        && (C.nextAbs - C.pendingAt) <= C.INPUT_WINDOW));
    let maxDd = C.TURN_RATE * Math.max(step, 0);
    if (S.state === 'dying') maxDd = 0;                            // 死亡动画里别再替他拐
    else if (S.state === 'playing' && !committed && toJ > 0 && toJ < C.TURN_HOLD) maxDd = 0; // 没打方向：冻住朝向
    dd = Math.max(-maxDd, Math.min(maxDd, dd));
    C.theta += dd;
    if (C.theta > Math.PI) C.theta -= Math.PI * 2;
    else if (C.theta < -Math.PI) C.theta += Math.PI * 2;
    const ct = Math.cos(C.theta), st = Math.sin(C.theta);
    C.group.rotation.y = C.theta;
    C.group.position.set(-(p.x * ct + p.z * st), 0, -(-p.x * st + p.z * ct));
    campusTurnTick(prevS, C.s);
    campusHintTick();
}

/** 转向判定：跨过路口时看有没有按对方向 */
function campusTurnTick(sPrev, sNow) {
    const C = CAMPUS;
    let guard = 0;
    while (C.nextAbs <= sNow && guard++ < 4) {
        const j = C.junctions[C.jIdx];
        if (j) {
            const need = j.dir === 'L' ? -1 : 1;
            const fresh = C.pendingDir === need && (C.nextAbs - C.pendingAt) <= C.INPUT_WINDOW;
            C.lastTurn = { at: +C.nextAbs.toFixed(0), need, pending: C.pendingDir,
                           gap: +(C.nextAbs - C.pendingAt).toFixed(0), fresh,
                           state: S.state, phase: Scene.phase, grace: +(S.transGrace || 0).toFixed(1) };
            if (fresh) {
                S.diedTurnAt = null;
                tone(660, 1180, 0.14, 'triangle', 0.06);
                showMsg(j.dir === 'L' ? '⬅ 左转成功' : '➡ 右转成功');
            } else if (S.state === 'playing' && Scene.phase === 'run'
                && !(S.transGrace > 0) && !S.flying && !window.__noTurnFail) {
                // 记下死在哪个路口：用复活币要回到这个路口前 100m 重来
                S.diedTurnAt = C.nextAbs;
                const msg = !C.pendingDir ? '没打方向，冲出了跑道'
                    : (C.pendingDir === need ? '方向打早了，冲出了跑道' : '拐错方向，冲出了跑道');
                die(msg);
            }
            C.pendingDir = 0;
        }
        C.jIdx++;
        if (C.jIdx >= C.junctions.length) { C.jIdx = 0; C.jLap++; }
        C.nextAbs = C.junctions.length ? C.jLap * C.total + C.junctions[C.jIdx].at : Infinity;
        if (S.state !== 'playing') break;
    }
}

/** 记录一次横向输入（只在校园场景、且在路口窗口内才算数） */
function campusNoteInput(dir) {
    if (curTheme !== CAMPUS.id || !CAMPUS.ready) return;
    // 只有「离路口 10m 以内」的横向输入才登记为转向；
    // 更远的地方按左右键 / 滑屏只走 moveLane，在跑道上正常换道，不算打方向。
    const C = CAMPUS;
    const toJ = C.nextAbs - C.s;
    if (toJ <= 0 || toJ > C.INPUT_WINDOW) return;
    C.pendingDir = dir;
    C.pendingAt = C.s;
}

/** 路口提示箭头 */
function campusHintTick() {
    const el = $('turnHint');
    if (!el) return;
    const C = CAMPUS;
    if (curTheme !== C.id || !C.ready || S.state !== 'playing'
        || Scene.phase !== 'run' || !C.junctions.length) {
        if (!el.classList.contains('hidden')) el.classList.add('hidden');
        return;
    }
    const j = C.junctions[C.jIdx];
    const dist = C.nextAbs - C.s;
    if (!j || dist > 66 || dist < -1) {
        if (!el.classList.contains('hidden')) el.classList.add('hidden');
        return;
    }
    const need = j.dir === 'L' ? -1 : 1;
    const near = dist <= C.INPUT_WINDOW;
    const ok = near && C.pendingDir === need;
    el.classList.remove('hidden');
    el.classList.toggle('ok', ok);
    const ar = el.querySelector('.ar'), tx = el.querySelector('.tx');
    if (ar) ar.textContent = j.dir === 'L' ? '⬅' : '➡';
    const m = Math.max(0, Math.round(dist)) + 'm';
    if (tx) tx.textContent = !near
        ? (j.dir === 'L' ? '左转 ' : '右转 ') + m + ' · 10m 内再打方向'
        : (ok ? '已转向 · ' : '现在打方向！') + m;
}

/** 换到校园场景时把里程与转角复位 */
/** 开局切入点（沿路线的里程，米）。1300 ≈ 博雅塔南侧的湖边直道 */
const START_ARC = 1300;

function campusResetRun() {
    // 切活动集必须在最前面：本函数在任何场景的重开局都会被调
    CAMPUS = CAMPUS_SETS[curTheme] || CAMPUS_SETS.campus;
    const C = CAMPUS;
    // 开局切入点：燕园从 1300（博雅塔南侧湖边）切入；医学部矩形环从西南角起步
    C.s = C.startArc;
    C.pendingDir = 0;
    C.pendingAt = -1e9;
    // 路口游标要跳到「起点之后第一个路口」，不能从 0 开始数
    C.jIdx = 0;
    while (C.jIdx < C.junctions.length && C.junctions[C.jIdx].at <= C.startArc) C.jIdx++;
    C.jLap = 0;
    C.nextAbs = C.jIdx < C.junctions.length ? C.junctions[C.jIdx].at : Infinity;
    const d0 = campusDir(C.startArc);
    C.rawTheta = Math.atan2(d0.z, d0.x) + Math.PI / 2;
    C.theta = C.rawTheta;
    if (C.ready) {
        // 注意：resetScene 在任何场景都会调这个函数（死亡重开局），
        // 所以这里只能「按当前场景」决定显示，不能无条件 true
        C.group.visible = (curTheme === C.id);
        if (curTheme === C.id) campusUpdate(0);
    }
}

/** 这个路线里程离最近的路口有多远（米）。用来「路口前后不放障碍」 */
function campusJunctionGap(arc) {
    const C = CAMPUS;
    if (!C.junctions || !C.junctions.length) return Infinity;
    const L = C.total;
    const lap = Math.floor(arc / L) * L;
    let best = Infinity;
    for (const j of C.junctions) {
        for (const at of [lap + j.at, lap + j.at - L, lap + j.at + L]) {
            const gap = Math.abs(arc - at);
            if (gap < best) best = gap;
        }
    }
    return best;
}

/** 复活重来：把整块底板倒回路线上的某个里程（拐弯失败时用）。
 *  玩家位置永远在原点，所以「倒退 100m」= 底板沿路线挪回去，转角和朝向一并重算。 */
function campusRewindTo(arc) {
    const C = CAMPUS;
    if (!C.ready || curTheme !== C.id) return false;
    C.pendingDir = 0;
    C.pendingAt = -1e9;
    while (arc < 0) arc += C.total;        // 路口在起点附近：绕到上一圈的同一位置
    // 保留圈数：C.s 是一直累加的，直接取模会把跑第二圈的玩家瞬移回第一圈的开头
    const lap = Math.floor(arc / C.total);
    const local = arc - lap * C.total;
    C.s = arc;
    let idx = 0;
    while (idx < C.junctions.length && C.junctions[idx].at <= local) idx++;
    if (idx >= C.junctions.length) { idx = 0; C.jLap = lap + 1; } else { C.jLap = lap; }
    C.jIdx = idx;
    C.nextAbs = C.junctions.length ? C.jLap * C.total + C.junctions[C.jIdx].at : Infinity;
    const d0 = campusDir(C.s);
    C.rawTheta = Math.atan2(d0.z, d0.x) + Math.PI / 2;
    C.theta = C.rawTheta;
    const p = campusPoint(C.s);
    C.px = p.x; C.pz = p.z; C.ux = d0.x; C.uz = d0.z;
    const ct = Math.cos(C.theta), st = Math.sin(C.theta);
    C.group.rotation.y = C.theta;
    C.group.position.set(-(p.x * ct + p.z * st), 0, -(-p.x * st + p.z * ct));
    C.group.visible = true;
    return true;
}

// ---------------------------------------------------------------------
//  场景搭建：底板由 GLB 提供；这里只做「万一底板没载入」的兜底地面
// ---------------------------------------------------------------------
function buildCampusWorld() {
    CAMPUS = CAMPUS_SETS[curTheme] || CAMPUS_SETS.campus;   // buildWorld 已设好 curTheme
    if (!CAMPUS.ready) {
        // 兜底：没有底板时退回一条直道，至少能跑
        addMesh(flat(70, 400), std(0x8fae62, { roughness: 1 }), 0, -0.05, -180);
        addMesh(flat(7.6, 400), std(0x4c4f52, { roughness: 0.9 }), 0, 0.02, -180);
    }
    campusResetRun();
}

function buildCampusDecor() {
    // 树、楼、湖全在底板里，这里不再生成装饰
}

// ---------------------------------------------------------------------
//  博雅塔：八角十三级密檐塔，按 OSM 的真实位置与真实高度（31m）现搭
// ---------------------------------------------------------------------
function buildBoyaPagoda(x, z, H) {
    const stoneParts = [], eaveParts = [];
    const addStone = (geo, y) => { geo.translate(0, y, 0); stoneParts.push(geo); };
    const addEave = (geo, y) => { geo.translate(0, y, 0); eaveParts.push(geo); };
    // 须弥座
    addStone(new THREE.CylinderGeometry(3.1, 3.6, 1.8, 8), 0.9);
    let y = 1.8;
    const tiers = 13;
    const bodyTop = H * 0.86;
    const tierH = (bodyTop - y) / tiers;
    for (let i = 0; i < tiers; i++) {
        const t = i / (tiers - 1);
        const r0 = 2.55 - 1.65 * t;
        addStone(new THREE.CylinderGeometry(r0 * 0.9, r0, tierH * 0.8, 8), y + tierH * 0.4);
        addEave(new THREE.CylinderGeometry(r0 * 1.30, r0 * 0.95, tierH * 0.16, 8), y + tierH * 0.92);
        y += tierH;
    }
    // 塔刹
    addEave(new THREE.CylinderGeometry(0.1, 0.55, H - y, 8), y + (H - y) / 2);
    const mats = [
        std(0xbdb6a6, { roughness: 0.95, flatShading: true }),
        std(0x8f8878, { roughness: 0.9, flatShading: true }),
    ];
    const grp = new THREE.Group();
    [stoneParts, eaveParts].forEach((arr, i) => {
        const merged = mergeGeometries ? mergeGeometries(arr, false) : arr[0];
        if (!merged) return;
        const m = new THREE.Mesh(merged, mats[i]);
        m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false;
        grp.add(m);
    });
    grp.position.set(x, 0, z);
    return grp;
}

// ---------------------------------------------------------------------
//  底板载入（发布时由 tools/inline-campus.py 换成 data URI）
// ---------------------------------------------------------------------
// 内联底板是 gzip + base64：解压成 Blob URL 再交给 GLTFLoader。
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

async function loadCampusPlates() {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const maxAniso = renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 4;

    function tune(root) {
        root.traverse(o => {
            if (!o.isMesh) return;
            o.frustumCulled = false;      // 底板整体在动，包围盒判定会误剔
            const mname = String((o.material && o.material.name) || '');
            // 建筑/屋顶/女儿墙/树 投影，地面只接收——有影子整个场景才立得住
            o.castShadow = /^wall|^roof|^trim|^tree/.test(mname);
            // 水面不接阴影：一整片水平大平面 + 低太阳角，阴影贴图在掠射角上会刷出
            // 阶梯状 acne（看着就像岸边长了一圈锯齿）
            o.receiveShadow = !/^water/.test(mname);
            const list = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of list) {
                if (!m) continue;
                m.side = THREE.FrontSide;
                if (m.map) {
                    m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
                    // 8→16：底板贴图在掠射角（跑道路面往远处收）会糊成一片，
                    // 各向异性翻倍后远处的车道线和砖缝才留得住，采样开销几乎不变
                    m.map.anisotropy = Math.min(16, maxAniso);
                    m.map.needsUpdate = true;
                }
                if (m.name === 'water') {
                    m.roughness = 0.22; m.metalness = 0.0;
                    // 水面盖在草地之上，再给一点深度偏移，远处也不会和草地打架
                    m.polygonOffset = true;
                    m.polygonOffsetFactor = -2;
                    m.polygonOffsetUnits = -2;
                }
                if (m.name === 'line') {
                    m.polygonOffset = true;
                    m.polygonOffsetFactor = -3;
                    m.polygonOffsetUnits = -3;
                }
                m.needsUpdate = true;
            }
        });
    }

    await Promise.all(Object.values(CAMPUS_SETS).map(async S => {
        try {
            const gltf = await new GLTFLoader().loadAsync(await resolvePlate(S.url));
            tune(gltf.scene);
            ART.upgradeCampusMaterials(gltf.scene, S.id);   // 换掉「灰墙绿树」的程序贴图
            const g = new THREE.Group();
            g.name = 'campusPlate-' + S.id;
            g.userData.noMerge = true;    // 它自己会动，绝不能进静态合并
            g.add(gltf.scene);
            // 地标：博雅塔用代码搭（GLB 里只留了坐标）；医学部没有代码地标
            for (const lm of (S.landmarks || [])) {
                if (lm.name === '博雅塔') g.add(ART.makePagoda(lm.x, lm.z, lm.h || 31));
            }
            g.visible = false;
            scene.add(g);
            S.group = g;
            S.ready = true;
            try { ART.decorateCampus(S); } catch (e) { console.warn('[art] 校园摆件失败', e); }
            console.log('[campus] ' + S.id + ' 底板已载入：' + S.pts.length + ' 拐点 / '
                + Math.round(S.total) + ' m');
        } catch (e) {
            console.warn('[campus] ' + S.id + ' 底板载入失败，该场景回退直道:', e && e.message || e);
        }
    }));
}
// ==== CAMPUS-BLOCK END ====

// ==== ART-BLOCK BEGIN（tools/inline-art.py 生成，勿手改）====
// 由 tools/gen-blockers.py 生成：建筑 AABB（x0,z0,x1,z1），摆件避让用
const ART_BLOCKERS = {"campus":[[-1232.8,-575.8,-1116.6,-500.8],[-835.2,-872.6,-786.7,-750.7],[-865.9,-761.2,-811.9,-710.7],[-874.6,-723.0,-830.2,-685.3],[-1054.4,-740.7,-923.5,-702.1],[-935.4,-694.4,-928.1,-684.8],[-936.3,-829.4,-905.7,-763.9],[-863.1,-824.4,-828.3,-756.2],[-999.9,-838.9,-951.9,-816.2],[-1157.3,-808.0,-1014.6,-786.6],[-1000.8,-794.4,-943.2,-776.2],[-1102.4,-561.7,-1028.7,-502.6],[-1192.1,-496.2,-1150.0,-451.7],[-1021.0,-513.5,-943.6,-451.2],[-877.8,-473.5,-849.8,-462.1],[-861.7,-690.3,-826.5,-661.7],[-812.3,-880.3,-751.9,-665.3],[-779.8,-443.0,-765.2,-423.1],[-746.4,-369.4,-715.3,-349.4],[-813.7,-379.9,-763.8,-349.4],[-809.1,-326.7,-762.5,-294.0],[-885.1,-461.7,-816.4,-363.1],[-891.0,-327.2,-824.7,-302.6],[-902.5,-238.5,-827.9,-214.0],[-894.2,-286.3,-826.1,-261.7],[-801.3,-292.6,-767.9,-241.7],[-804.1,-222.2,-761.5,-189.0],[-812.8,-179.4,-735.9,-111.7],[-805.5,-98.1,-744.6,-41.3],[-793.1,-76.3,-761.5,-53.1],[-804.1,-98.1,-744.6,-41.3],[-870.0,-87.2,-830.2,-1.8],[-903.8,1.4,-828.8,23.2],[-928.1,-30.8,-861.3,-9.0],[-923.5,-93.6,-875.9,-57.7],[-906.1,-129.0,-831.5,-99.0],[-882.3,-137.2,-834.7,-121.7],[-905.2,-159.5,-833.8,-128.5],[-905.7,-197.6,-827.9,-173.1],[-1006.8,-334.4,-956.4,-174.5],[-987.6,-263.1,-972.9,-202.2],[-1058.0,-298.5,-1002.2,-187.2],[-1097.8,-148.1,-988.0,-69.5],[-1133.5,-90.4,-1068.5,-67.7],[-1139.0,-53.1,-1074.0,-30.4],[-1185.7,-96.3,-1145.0,-77.2],[-1196.7,-170.8,-1107.4,-114.5],[-1209.9,-366.7,-1160.5,-192.6],[-1081.4,-341.2,-1048.9,-209.0],[-1021.0,-415.3,-942.7,-343.1],[-1011.4,-434.9,-963.3,-422.6],[-1133.5,-403.1,-1026.9,-359.4],[-1195.7,-415.3,-1138.5,-364.9],[-1223.2,-58.6,-1145.0,-38.6],[-1182.0,362.7,-1129.9,385.0],[-1134.4,410.0,-1122.1,424.1],[-1111.6,365.4,-1048.4,389.5],[-1122.1,409.5,-1071.7,425.4],[-1063.5,317.3,-1030.1,388.6],[-1071.7,416.8,-1050.7,429.1],[-995.8,273.6,-989.8,280.9],[-1100.6,257.3,-1031.5,278.2],[-1105.6,294.1,-1048.9,314.1],[-1191.6,320.9,-1119.3,346.4],[-1192.1,284.6,-1119.8,310.5],[-1187.5,250.0,-1115.2,275.5],[-1183.4,212.7,-1120.2,235.5],[-1096.5,223.2,-1027.4,244.1],[-1112.0,148.2,-1025.1,187.3],[-1160.5,131.9,-1123.9,181.8],[-1111.6,102.8,-1021.0,161.4],[-1108.8,58.7,-1015.5,104.1],[-872.7,158.2,-852.1,169.1],[-935.4,140.9,-892.4,159.1],[-941.8,72.3,-922.6,123.7],[-937.7,34.1,-886.4,53.7],[-882.8,56.9,-832.5,71.4],[-885.5,131.4,-836.6,146.4],[-880.0,69.6,-862.2,132.8],[-916.2,73.7,-883.2,123.7],[-815.1,99.1,-800.4,140.9],[-807.8,22.3,-774.4,34.1],[-806.8,45.5,-768.4,92.8],[-749.6,26.0,-715.3,63.7],[-750.6,77.3,-715.3,114.6],[-751.9,129.6,-715.3,166.8],[-807.3,145.0,-772.5,164.1],[-815.1,45.5,-768.4,164.1],[-827.4,325.0,-808.2,360.0],[-854.9,253.6,-837.9,296.4],[-895.6,300.5,-836.6,323.6],[-897.0,362.3,-837.0,386.3],[-977.0,409.5,-967.4,426.8],[-895.1,458.6,-839.3,480.0],[-898.3,516.3,-839.3,521.8],[-828.3,483.6,-810.0,521.8],[-832.0,387.7,-802.7,458.1],[-832.0,403.2,-802.7,440.9],[-781.2,481.3,-763.4,521.8],[-724.0,482.7,-715.3,521.8],[-739.6,242.7,-721.3,261.4],[-738.7,205.9,-719.9,224.6],[-728.1,-134.9,-715.3,-94.0],[-741.9,-315.8,-715.3,-233.5],[-805.9,-467.6,-715.3,-395.3],[-1134.4,-767.1,-1054.4,-746.2],[-1106.1,27.8,-1014.6,63.2],[-774.8,-796.2,-715.3,-693.0],[-397.4,142.8,-330.1,165.9],[-488.4,359.1,-482.5,363.2],[-773.9,481.8,-763.4,521.8],[-724.0,482.7,-706.6,521.8],[-673.2,488.1,-653.1,521.8],[-615.1,488.1,-595.9,521.8],[-558.9,424.5,-546.0,437.2],[-614.2,296.4,-572.1,315.0],[-739.6,242.7,-721.3,261.4],[-738.7,205.9,-719.9,224.6],[-640.8,210.9,-618.8,255.9],[-638.5,132.3,-601.0,169.6],[-751.9,129.6,-713.0,167.3],[-773.9,145.9,-772.5,164.1],[-773.9,46.4,-768.4,92.8],[-773.9,145.9,-772.5,164.1],[-773.9,46.4,-768.4,92.8],[-750.6,77.3,-711.7,114.6],[-749.6,26.0,-710.8,63.7],[-637.6,78.7,-600.0,117.8],[-636.6,28.7,-599.6,63.7],[-591.3,52.3,-450.9,179.6],[-555.7,122.8,-531.4,150.5],[-519.1,120.0,-511.3,143.7],[-517.2,88.7,-509.4,111.9],[-593.6,210.5,-535.5,237.3],[-513.6,215.0,-452.3,237.7],[-437.2,218.7,-413.4,236.8],[-407.9,218.2,-340.2,246.4],[-415.7,176.4,-321.4,214.6],[-407.4,36.0,-315.5,75.1],[-395.1,92.8,-331.5,114.1],[-282.5,47.8,-211.1,121.4],[-289.8,151.9,-220.3,225.0],[-269.7,180.0,-244.1,195.9],[-325.5,254.6,-258.3,278.6],[-312.7,362.3,-253.2,410.9],[-433.5,301.4,-415.7,309.1],[-440.4,301.4,-407.4,309.1],[-493.4,295.9,-466.9,312.3],[-464.2,299.1,-450.0,320.0],[-401.9,463.6,-372.2,521.8],[-330.6,396.8,-294.4,411.8],[-231.7,374.5,-192.8,443.2],[-251.4,460.4,-215.7,521.8],[-197.9,485.9,-169.5,521.8],[-190.5,370.0,-138.8,452.7],[-180.9,419.1,-153.9,435.0],[-175.0,389.1,-149.8,405.4],[-150.3,497.7,-118.7,521.8],[-151.7,479.1,-99.5,521.8],[-16.7,466.3,3.0,486.8],[-6.2,375.4,153.5,470.0],[33.2,393.6,137.0,445.4],[23.6,508.1,45.1,519.5],[61.5,505.9,73.0,519.9],[87.6,502.7,102.7,515.0],[79.8,516.8,86.7,521.8],[128.3,496.8,138.4,513.1],[186.5,430.9,242.3,448.6],[111.9,353.2,176.4,374.5],[141.2,314.5,173.6,333.6],[108.2,285.5,171.4,306.8],[6.2,285.9,60.6,320.0],[3.4,184.6,168.2,283.2],[82.1,205.5,146.2,246.4],[84.0,93.7,159.0,116.0],[130.6,52.3,161.7,91.9],[175.5,40.1,217.6,56.4],[55.1,20.5,171.4,51.0],[16.7,-44.9,60.2,117.3],[-47.8,24.6,-41.4,33.2],[-50.5,59.6,-44.6,67.8],[-166.3,61.4,-87.1,129.6],[-151.7,79.1,-123.3,107.3],[-157.6,150.9,-91.3,210.9],[-146.6,159.1,-120.1,182.3],[-193.3,-39.0,-87.1,131.9],[-142.1,-9.5,-108.2,19.6],[-151.7,79.1,-123.3,107.3],[-216.2,-25.8,-162.2,13.7],[-282.1,-65.4,-191.5,48.7],[-265.6,-4.0,-231.3,24.6],[-257.3,-46.7,-226.7,-21.3],[-143.0,-184.0,-123.8,-172.2],[-142.5,-190.8,-123.3,-183.1],[-150.7,-154.5,-91.7,-95.8],[-137.0,-136.7,-105.9,-113.1],[-154.4,-32.2,-92.2,36.9],[-142.1,-9.5,-108.2,19.6],[16.7,-105.4,29.5,-74.0],[28.1,-85.8,84.4,-70.8],[105.5,-35.8,163.1,21.9],[175.5,2.8,216.6,16.4],[177.3,-35.4,218.5,-21.3],[101.4,-94.0,175.0,-65.4],[116.5,-161.7,145.3,-92.2],[107.3,-185.8,177.8,-158.5],[22.2,-204.9,35.5,-173.5],[40.0,-166.7,89.0,-151.7],[20.4,-169.0,40.0,-112.2],[38.2,-124.9,87.6,-110.8],[28.1,-328.1,43.7,-271.3],[26.3,-259.9,38.2,-242.2],[37.3,-245.8,85.8,-231.3],[22.2,-241.3,35.0,-207.6],[35.5,-207.2,91.7,-191.7],[88.1,-253.1,127.4,-235.3],[126.5,-250.3,212.1,-228.5],[158.1,-274.0,220.8,-257.6],[131.1,-314.9,158.5,-302.6],[161.3,-309.0,224.0,-292.2],[123.3,-286.3,150.3,-272.2],[98.6,-362.6,160.8,-346.7],[188.3,-334.0,273.4,-315.3],[165.4,-368.5,178.7,-316.7],[165.4,-393.1,202.0,-378.1],[90.8,-440.8,134.8,-417.1],[93.1,-400.8,160.8,-382.1],[31.8,-439.0,90.4,-349.9],[-117.3,-424.0,-48.3,-342.2],[-124.2,-341.2,-53.3,-308.5],[-141.1,-214.0,-121.9,-205.4],[-137.9,-285.8,-112.3,-244.9],[-116.4,-284.9,-42.8,-189.0],[-382.7,-348.5,-351.6,-276.3],[-376.8,-447.6,-345.2,-375.8],[-450.4,-402.6,-398.3,-388.5],[-454.5,-357.6,-402.8,-343.5],[-464.6,-341.7,-447.2,-302.2],[-456.8,-296.7,-405.1,-282.6],[-329.6,-424.9,-303.6,-293.1],[-390.0,-238.1,-362.1,-167.2],[-353.4,-269.9,-301.3,-168.5],[-391.4,-141.3,-311.8,-66.3],[-395.5,-49.0,-319.1,25.5],[-367.2,-24.5,-334.7,6.0],[-537.4,2.3,-435.8,26.9],[-511.3,-142.2,-427.5,-42.2],[-405.6,-105.8,-401.5,-101.3],[-476.5,-244.4,-412.0,-171.7],[-580.8,-193.5,-543.8,-166.3],[-571.2,-186.7,-552.0,-180.8],[-569.4,-139.0,-549.3,-118.6],[-599.1,-164.5,-582.7,-138.1],[-597.7,-117.6,-585.9,-105.4],[-602.3,-105.8,-585.4,-93.6],[-543.3,-136.7,-523.6,-112.2],[-555.2,-56.7,-538.3,-42.2],[-517.7,-42.7,-485.2,-19.5],[-606.9,-64.5,-586.8,-46.3],[-569.4,-99.0,-544.7,-72.2],[-638.0,-63.6,-618.3,-42.7],[-698.4,-15.8,-648.1,10.5],[-773.9,-96.7,-744.6,-41.3],[-773.9,-96.7,-744.6,-41.3],[-708.9,-67.7,-683.3,-51.3],[-728.1,-134.9,-704.8,-93.6],[-773.9,-179.4,-735.9,-111.7],[-672.8,-170.4,-655.9,-144.5],[-638.0,-170.8,-625.7,-149.5],[-773.9,-221.3,-761.5,-189.0],[-773.9,-292.6,-767.9,-254.4],[-741.9,-315.8,-666.4,-232.2],[-773.9,-325.3,-762.5,-294.0],[-604.6,-249.0,-538.7,-227.2],[-525.9,-302.6,-491.6,-225.4],[-602.8,-307.6,-536.0,-285.3],[-556.1,-362.6,-489.3,-321.2],[-549.7,-454.9,-488.9,-389.0],[-546.0,-429.0,-510.8,-413.1],[-632.5,-462.6,-560.2,-390.8],[-606.9,-438.0,-563.0,-416.7],[-640.8,-365.3,-567.1,-324.4],[-693.4,-343.1,-670.0,-325.3],[-773.9,-378.5,-763.8,-349.4],[-746.4,-369.4,-670.0,-347.6],[-697.9,-439.9,-678.3,-418.5],[-773.9,-442.6,-765.2,-423.1],[-773.9,-415.8,-765.2,-398.1],[-773.9,-466.7,-711.2,-395.3],[-708.5,-464.4,-642.1,-392.6],[-657.7,-553.0,-642.1,-543.0],[-702.1,-510.3,-685.6,-502.1],[-572.1,-523.0,-494.3,-503.5],[-460.9,-445.8,-443.6,-405.8],[-487.5,-549.9,-417.5,-499.9],[-485.7,-567.1,-427.1,-551.2],[-417.0,-510.8,-356.2,-498.5],[-447.7,-459.4,-396.0,-445.3],[-348.4,-461.2,-125.6,-434.9],[-284.3,-509.4,-245.5,-498.0],[-277.9,-558.0,-217.1,-543.5],[-353.4,-562.1,-291.7,-545.8],[-353.4,-524.9,-292.6,-500.8],[-410.2,-567.1,-362.1,-553.9],[-416.6,-713.0,-314.5,-678.5],[-552.9,-721.2,-480.2,-684.4],[-644.4,-735.3,-589.1,-681.7],[-773.9,-766.6,-762.9,-725.7],[111.9,-734.8,134.8,-677.1],[74.4,-873.9,181.4,-753.5],[-29.5,-756.7,-22.2,-743.9],[-92.6,-858.5,-25.4,-770.7],[-263.3,-807.6,-214.8,-757.1],[-179.6,-886.6,-101.8,-648.5],[-189.6,-554.9,-129.2,-540.3],[-213.4,-555.3,-191.5,-542.1],[-233.6,-506.2,-174.5,-494.0],[-243.2,-520.8,-233.1,-506.2],[-168.6,-504.4,-111.9,-491.2],[106.8,-644.4,154.4,-630.3],[187.8,-640.3,256.0,-625.8],[156.7,-534.9,233.1,-521.7],[96.3,-536.7,145.7,-522.1],[146.6,-521.2,164.5,-473.0],[199.3,-668.9,224.0,-653.0],[232.7,-668.0,296.7,-653.9],[348.9,-632.6,397.4,-616.7],[412.9,-667.6,474.7,-653.0],[410.6,-630.8,474.7,-615.3],[369.9,-527.1,417.5,-515.8],[265.6,-530.3,344.8,-517.1],[332.4,-507.6,349.3,-459.9],[361.7,-511.2,397.8,-456.2],[395.5,-478.0,447.2,-459.0],[415.7,-494.4,446.3,-479.4],[450.9,-477.6,476.5,-460.3],[461.0,-460.8,478.4,-437.1],[429.9,-524.9,483.4,-492.1],[539.2,-438.0,631.6,-353.5],[567.1,-416.7,610.1,-378.1],[638.5,-656.7,682.0,-643.5],[581.3,-659.4,624.8,-645.8],[489.8,-665.7,551.1,-651.7],[479.7,-824.4,566.7,-726.2],[488.4,-768.5,514.5,-751.7],[490.7,-699.4,552.5,-685.3],[583.1,-697.6,626.6,-684.4],[639.9,-693.5,683.3,-680.3],[583.1,-760.3,626.6,-735.3],[586.8,-821.6,629.8,-796.6],[407.4,-838.5,425.7,-816.2],[422.5,-808.9,434.0,-775.7],[419.8,-774.4,473.8,-717.1],[434.9,-757.1,461.0,-736.2],[414.3,-702.6,476.1,-688.5],[352.1,-706.2,403.3,-693.9],[361.2,-817.6,423.9,-765.3],[277.5,-777.1,342.5,-758.9],[265.1,-741.2,334.2,-724.8],[306.3,-699.4,337.9,-685.3],[237.7,-746.7,250.0,-706.7],[231.3,-701.7,295.8,-685.7],[197.4,-781.6,261.0,-763.9],[278.9,-814.4,342.0,-796.6],[1041.6,-760.7,1157.3,-721.7],[1040.7,-727.1,1130.8,-678.0],[909.8,-763.5,929.0,-743.9],[859.5,-859.4,940.9,-796.6],[669.6,-820.3,712.6,-795.3],[666.9,-758.5,709.9,-733.5],[664.1,-507.1,780.8,-457.6],[804.1,-497.1,853.1,-467.1],[953.3,-471.2,1002.2,-456.7],[977.5,-739.8,1056.2,-618.0],[1077.7,-668.5,1154.6,-626.7],[1020.5,-494.9,1076.8,-474.0],[1128.5,-360.3,1158.7,-335.3],[1106.5,-345.8,1158.7,-325.8],[1069.5,-413.5,1105.2,-389.4],[1010.0,-394.4,1044.3,-380.3],[952.8,-437.1,1001.8,-422.6],[951.9,-403.1,1000.9,-389.0],[949.1,-369.9,998.1,-355.8],[948.7,-335.3,997.6,-320.8],[1009.5,-366.7,1093.7,-348.5],[1008.6,-336.7,1091.4,-321.2],[968.4,-299.4,994.9,-271.3],[913.5,-285.3,923.5,-246.7],[1001.3,-286.7,1022.4,-249.9],[1002.2,-225.4,1079.1,-208.5],[1044.8,-266.7,1130.3,-236.7],[1023.3,-287.6,1039.7,-250.3],[1016.9,-302.2,1050.7,-289.4],[1061.2,-297.6,1131.2,-279.9],[1091.0,-231.3,1103.3,-220.8],[1111.1,-204.9,1158.7,-158.1],[1127.6,-72.6,1158.7,-39.9],[1076.8,-23.1,1128.0,-7.2],[1042.0,-72.2,1075.9,-39.9],[955.1,-73.6,989.4,-41.3],[991.7,-23.1,1042.9,-7.2],[963.8,-31.3,986.7,10.1],[1009.1,-118.1,1129.0,-92.6],[959.7,-198.5,999.5,-169.0],[999.5,-169.9,1054.4,-151.7],[959.7,-272.2,1001.3,-197.2],[892.0,-229.0,912.5,-171.7],[852.2,-215.4,889.2,-169.0],[780.3,-220.4,834.8,-196.7],[783.5,-136.3,909.8,-105.4],[857.6,-24.0,914.8,6.9],[852.2,17.3,870.0,62.3],[782.2,-9.5,807.8,1.4],[797.3,-75.4,901.1,-40.8],[801.4,-46.7,849.9,-29.0],[721.3,-119.9,768.0,-69.9],[773.5,-50.8,800.0,-41.3],[747.4,-5.8,757.4,12.3],[768.9,-31.3,780.3,-0.4],[680.6,-9.0,737.8,15.5],[710.8,-91.7,719.9,-65.8],[680.6,-85.4,709.9,-67.2],[678.8,-141.7,732.7,-109.0],[749.2,-135.4,773.9,-121.3],[777.1,-194.4,834.3,-161.3],[753.8,-226.7,773.5,-190.8],[665.5,-215.4,751.5,-190.8],[669.1,-269.9,742.3,-247.2],[754.7,-246.7,772.1,-234.4],[755.6,-291.3,775.7,-246.7],[795.9,-302.6,823.3,-229.9],[824.2,-258.5,912.5,-237.2],[838.4,-308.1,918.0,-286.7],[785.8,-305.8,797.7,-263.5],[858.6,-378.1,915.3,-329.4],[802.3,-382.1,851.2,-327.2],[852.2,-413.1,866.8,-389.4],[883.3,-399.0,894.7,-384.4],[876.4,-421.2,899.7,-400.8],[814.2,-399.9,854.4,-386.7],[810.5,-458.5,931.3,-360.8],[725.0,-415.8,780.8,-386.2],[761.6,-369.9,787.6,-329.4],[693.8,-353.1,733.2,-334.4],[665.5,-409.9,714.4,-395.3],[660.5,-374.9,689.3,-335.8],[649.5,-319.9,778.9,-286.3],[639.9,-302.6,665.0,-254.9],[500.3,-322.6,554.8,-285.8],[495.7,-242.6,561.2,-221.3],[507.6,-277.6,604.6,-254.4],[428.9,-318.1,471.0,-249.0],[441.8,-434.9,478.4,-348.1],[392.8,-444.4,442.2,-425.8],[388.2,-409.4,434.4,-393.1],[386.8,-375.3,435.3,-358.1],[322.8,-346.7,348.0,-327.2],[327.4,-379.0,375.4,-361.7],[348.4,-421.7,380.4,-383.5],[333.8,-451.2,382.7,-433.5],[273.4,-379.9,315.5,-365.3],[200.6,-364.4,266.1,-347.6],[285.3,-356.7,299.9,-304.9],[306.8,-294.4,339.3,-281.7],[231.3,-300.3,293.5,-283.5],[227.6,-266.7,289.9,-250.3],[219.9,-242.6,299.0,-220.8],[305.9,-261.3,338.8,-245.3],[312.3,-224.9,360.8,-209.9],[360.8,-252.2,407.0,-236.3],[366.7,-296.7,413.4,-280.8],[370.4,-345.8,428.5,-297.2],[341.6,-194.4,408.8,-178.1],[407.4,-189.0,458.7,-137.2],[402.4,-216.3,447.7,-200.4],[377.7,-161.7,416.1,-142.2],[332.4,-145.4,391.9,-116.3],[341.1,-163.1,376.8,-150.4],[191.5,-173.5,257.4,-128.5],[195.6,-86.7,283.0,-59.0],[228.5,-32.7,297.6,-19.0],[227.6,2.3,296.7,17.8],[308.6,-28.6,378.2,-14.0],[306.8,5.1,376.8,21.4],[297.6,-83.6,312.3,-58.1],[325.1,-80.4,382.3,-60.8],[391.4,-127.2,439.5,-56.7],[477.0,-46.3,501.7,-6.3],[540.6,-12.2,606.9,12.8],[479.3,-98.6,533.7,-74.9],[492.1,-220.8,504.9,-184.4],[505.3,-207.6,542.4,-182.2],[488.9,-162.2,626.1,-126.7],[545.2,-217.6,568.9,-178.5],[608.3,-128.5,623.4,-97.2],[638.5,-106.3,665.5,-68.6],[657.7,-54.9,752.0,-24.9],[603.3,-91.7,615.2,-67.7],[569.4,-48.1,610.6,-15.4],[618.4,-11.8,639.4,41.9],[644.4,2.8,671.4,10.5],[649.9,18.7,735.5,36.4],[646.7,38.7,730.9,51.0],[613.8,44.6,625.7,61.0],[613.8,13.2,623.8,42.8],[568.0,88.7,620.2,102.8],[629.8,55.1,662.7,97.8],[627.1,98.2,672.8,111.9],[620.2,118.7,684.7,158.7],[571.2,215.0,874.1,268.2],[569.9,130.5,618.8,148.7],[471.5,76.0,496.7,99.1],[475.6,124.6,549.3,144.1],[498.5,83.7,550.6,100.0],[476.5,4.6,525.0,66.9],[382.7,-32.7,437.2,64.6],[392.3,127.3,450.9,139.6],[369.0,115.0,393.3,135.5],[306.3,43.7,376.3,59.6],[227.6,40.5,298.1,56.0],[224.4,75.5,294.9,90.5],[221.7,112.3,292.1,126.4],[304.5,81.4,361.2,93.7],[302.7,118.7,361.7,133.2],[195.1,226.8,270.6,292.7],[327.8,213.2,349.8,234.1],[347.0,198.2,413.8,265.5],[323.7,327.3,358.9,347.7],[325.5,293.2,371.3,323.6],[208.4,299.5,299.0,346.8],[197.9,355.4,247.3,375.4],[309.1,362.7,358.5,397.7],[256.9,367.3,305.0,415.9],[260.1,370.4,299.9,408.2],[196.5,391.3,246.4,413.6],[140.2,505.0,204.8,521.8],[213.0,509.5,241.4,521.8],[396.0,436.3,423.5,450.4],[388.7,495.0,420.7,511.8],[392.8,465.4,420.2,488.1],[453.6,484.0,477.0,491.3],[456.4,443.6,477.4,451.3],[498.0,456.3,545.2,486.3],[443.6,496.8,487.5,512.7],[492.1,501.3,503.5,514.0],[445.9,463.1,489.3,478.1],[509.0,500.4,515.0,505.9],[523.2,484.5,538.7,504.5],[495.7,419.5,571.2,437.7],[450.0,426.3,490.3,438.6],[450.0,388.2,531.4,408.2],[484.8,372.7,522.3,382.3],[452.3,410.0,487.5,418.2],[400.1,401.3,427.1,415.4],[403.8,365.4,431.2,379.5],[460.5,337.3,504.4,345.9],[409.3,331.4,436.3,345.4],[443.6,282.7,469.2,294.5],[461.4,255.5,489.3,267.3],[512.7,296.4,570.3,308.2],[508.1,318.2,590.4,333.6],[455.0,347.7,536.9,367.7],[602.8,271.8,633.9,305.9],[547.9,356.8,628.9,375.0],[638.0,319.5,668.7,353.6],[545.2,390.9,626.6,410.9],[556.1,379.1,592.7,386.3],[604.2,502.2,654.0,521.8],[634.4,480.0,660.9,512.2],[664.1,491.3,697.5,505.0],[665.0,479.1,698.9,492.7],[661.8,504.0,695.7,517.7],[665.9,465.9,699.8,479.5],[708.5,481.8,742.3,495.4],[707.1,495.0,741.0,508.6],[706.2,508.1,739.6,521.8],[709.9,469.5,743.7,483.1],[706.2,520.9,716.7,521.8],[661.8,517.7,693.8,521.8],[718.1,450.4,744.6,459.1],[718.6,438.2,745.6,446.3],[671.4,446.3,701.6,454.1],[668.2,453.1,701.6,467.2],[633.0,400.4,706.7,419.5],[719.9,425.4,746.9,433.6],[750.6,428.2,777.6,436.3],[750.6,452.7,777.6,460.9],[750.1,440.0,776.7,448.1],[744.2,506.3,768.4,514.5],[745.1,494.0,769.8,502.7],[746.5,481.3,771.2,489.5],[748.8,470.0,773.5,478.1],[780.3,439.1,816.9,447.7],[794.5,452.2,824.2,460.4],[832.5,430.9,869.1,439.5],[829.7,444.5,866.3,453.1],[829.3,456.3,865.9,465.0],[820.1,512.2,845.3,521.8],[821.5,497.2,846.7,507.7],[852.2,505.4,872.3,519.9],[880.1,344.1,910.7,378.2],[844.8,370.9,869.5,384.1],[781.2,425.9,819.2,437.2],[808.2,330.0,838.9,364.1],[843.0,284.6,873.7,318.2],[690.2,319.5,784.4,336.8],[687.9,357.7,781.2,375.9],[686.5,120.5,778.9,160.5],[677.4,105.5,751.5,124.1],[707.1,88.7,730.5,100.5],[669.1,56.4,697.5,99.1],[734.1,54.6,752.9,91.4],[746.0,35.1,757.4,51.9],[766.6,6.0,778.9,36.0],[759.7,85.5,805.9,116.0],[805.9,83.7,822.9,101.0],[779.9,11.4,816.9,76.9],[851.7,88.2,919.4,156.4],[786.7,133.7,847.6,155.0],[927.2,242.7,1054.4,290.9],[981.6,146.4,1037.9,168.2],[965.6,37.8,1032.0,62.8],[971.1,78.7,1034.7,90.5],[974.8,117.3,1038.8,130.0],[1049.3,121.4,1130.3,145.5],[1056.2,84.6,1118.0,99.1],[1045.7,37.8,1071.3,54.1],[1053.5,55.1,1068.6,72.8],[1080.9,61.0,1117.5,69.6],[1081.8,48.2,1119.3,57.8],[1085.5,36.0,1120.7,45.5],[1046.1,164.1,1109.3,177.8],[1116.1,257.7,1158.7,296.4],[1106.5,329.1,1153.2,374.5],[924.4,334.1,994.0,365.4],[1005.4,339.5,1041.6,360.9],[924.4,413.2,957.8,420.9],[899.7,474.1,968.8,490.9],[899.3,510.4,963.8,521.8],[902.9,436.3,972.0,453.1],[979.8,498.1,1046.1,514.0],[985.8,461.3,1046.6,477.7],[985.8,424.1,1050.7,440.0],[1103.3,396.8,1156.9,444.5],[1098.3,470.0,1155.5,512.2],[1158.2,143.7,1158.7,158.7],[1139.0,66.4,1155.0,72.8],[1138.6,78.2,1154.1,85.0],[1126.7,40.1,1153.2,76.4],[1140.9,-94.0,1158.7,-86.3],[1138.6,-248.5,1158.7,-230.8],[1155.0,-263.5,1158.7,-249.4],[1139.0,-264.4,1146.3,-252.6],[1136.7,-291.7,1158.7,-271.3],[199.3,190.5,283.0,210.5],[309.1,404.1,358.0,420.9],[616.5,433.6,661.8,472.7],[531.0,438.6,582.7,462.7],[581.3,426.8,614.7,444.5],[608.7,436.3,622.0,506.3],[-319.1,301.8,-307.2,316.8],[178.7,-512.1,227.2,-497.6],[142.5,-438.0,203.4,-405.8],[172.3,-484.9,219.9,-469.9],[270.2,-477.1,317.8,-461.7],[271.1,-504.4,321.0,-490.3],[263.3,-635.8,336.1,-619.4],[780.8,-93.6,803.2,-58.6],[275.2,-421.7,337.0,-392.6],[213.9,-415.3,260.6,-398.5],[-15.8,497.7,21.3,521.8],[171.8,-453.0,217.1,-439.0],[264.7,-446.7,313.2,-431.7],[580.4,-621.7,623.8,-608.5],[636.2,-619.8,679.7,-606.7],[488.4,-628.0,550.2,-611.7],[1023.3,-452.1,1143.1,-421.2],[537.8,497.7,592.3,519.9],[-137.9,372.3,-94.9,463.1],[-119.6,406.8,-105.9,425.4],[-272.9,-192.2,-167.2,-97.2],[-174.5,-177.2,-155.8,-144.5],[-217.1,-205.4,-161.3,-176.7],[-649.0,-308.1,-613.3,-230.4],[154.0,462.7,248.2,505.9],[-365.3,341.8,-353.9,353.2],[784.9,-759.4,842.1,-659.8],[-550.2,-818.9,-468.7,-769.4],[-636.2,-820.7,-586.3,-777.6],[-269.2,-719.4,-218.9,-671.2],[850.8,-697.1,929.0,-645.8],[-408.8,-808.9,-310.4,-772.6],[-773.9,-796.6,-697.5,-693.0]],"campus2":[[-198.6,670.5,-125.4,689.6],[-124.5,659.6,-54.5,694.6],[-58.6,587.8,-50.8,627.3],[-87.0,610.5,-59.5,620.5],[-94.7,609.6,-87.9,623.7],[-93.4,602.8,-59.1,610.5],[-103.9,601.9,-95.2,611.0],[-103.9,611.9,-95.7,622.3],[-105.3,587.8,-97.0,598.2],[25.1,507.3,41.6,543.3],[16.4,634.1,67.7,674.6],[174.8,684.1,209.5,704.6],[140.4,576.9,201.3,629.6],[71.8,573.7,126.7,622.8],[75.5,529.6,91.0,563.2],[76.4,501.9,121.2,520.5],[45.3,499.6,69.1,580.5],[70.4,445.1,186.7,474.2],[135.9,504.2,200.8,531.4],[245.2,435.1,372.0,487.4],[285.5,541.4,332.6,571.9],[218.7,606.9,296.0,645.5],[235.6,680.9,295.6,697.3],[298.8,664.6,355.0,698.2],[506.0,695.9,568.7,708.2],[698.7,636.4,839.1,716.8],[582.4,701.4,688.1,715.9],[584.7,656.0,663.4,671.0],[581.5,618.2,659.8,630.5],[719.7,598.2,775.5,613.7],[682.2,597.3,715.6,612.3],[651.5,568.7,667.5,614.1],[699.6,529.6,740.3,542.8],[756.8,525.1,814.9,543.3],[623.2,520.1,668.5,553.2],[581.1,518.3,610.8,549.6],[579.2,562.8,625.9,596.9],[498.2,519.6,559.6,543.3],[400.3,509.2,443.8,542.8],[452.0,511.4,486.8,544.6],[436.9,561.4,485.9,591.9],[503.7,544.6,562.8,559.6],[504.2,579.6,564.1,592.8],[509.2,614.1,571.9,628.2],[507.4,649.1,571.5,660.5],[437.9,611.9,500.5,624.6],[401.2,611.0,431.0,623.7],[389.4,645.0,497.8,659.6],[387.1,687.8,490.0,701.9],[318.4,585.5,351.8,649.6],[321.2,512.8,363.7,551.4],[396.2,556.0,410.9,601.0],[488.6,226.9,589.3,243.8],[478.6,367.4,496.0,404.6],[471.7,314.2,489.6,454.6],[701.9,299.7,799.3,469.6],[765.0,234.7,875.7,259.7],[701.9,199.2,751.7,251.9],[604.9,157.0,611.3,162.9],[625.9,159.2,638.3,171.5],[603.5,191.9,673.0,244.2],[624.5,201.5,637.8,212.4],[607.1,121.5,676.7,180.6],[697.7,175.1,748.1,190.1],[764.5,205.1,823.1,227.9],[746.7,135.1,771.4,193.3],[719.7,141.0,743.0,171.0],[699.6,117.9,744.0,135.1],[634.6,67.9,688.6,108.8],[719.7,71.5,780.1,103.8],[705.1,71.1,720.6,77.9],[554.5,62.0,631.9,80.6],[469.4,70.1,549.0,90.1],[408.6,114.7,477.7,167.9],[494.1,117.4,593.9,137.9],[490.0,162.4,594.3,202.4],[408.6,181.0,474.5,237.9],[309.7,186.9,378.8,237.9],[310.2,119.2,379.7,176.0],[409.5,58.3,465.8,94.2],[291.9,53.8,377.9,80.1],[91.9,113.3,198.6,231.0],[161.0,143.8,222.3,214.7],[176.1,220.1,216.4,236.5],[283.2,114.2,354.1,138.8],[241.1,126.5,259.9,201.9],[252.1,209.7,301.5,230.6],[249.8,264.2,371.5,302.8],[284.6,323.7,359.6,425.5],[173.4,295.1,240.2,435.5],[79.1,258.3,195.8,290.6],[-120.4,436.0,-50.8,475.1],[-81.9,302.8,-39.8,336.9],[-108.5,258.3,-54.9,295.1],[-198.6,190.1,-184.4,219.2],[-182.6,200.6,-172.5,225.1],[-197.2,155.6,-95.2,186.5],[-84.2,133.3,-58.6,167.0],[-56.8,140.1,-38.5,166.0],[-58.1,169.7,-44.0,193.8],[-111.2,198.3,-44.0,225.6],[-82.4,109.2,-48.5,117.9],[-82.4,120.1,-49.0,128.8],[-105.7,110.1,-90.2,148.8],[-103.4,78.8,-32.1,97.9],[-160.6,110.6,-114.0,146.5],[-197.2,104.7,-177.6,143.3],[-198.6,39.7,-175.7,61.1],[-134.1,42.9,-72.3,57.4],[-136.4,-148.9,-84.2,-95.7],[-198.6,-78.9,-184.4,-56.2],[-179.4,-158.0,-156.5,-100.7],[-198.6,-156.6,-191.3,-138.9],[-198.6,-238.9,-190.4,-188.5],[110.7,-170.3,235.6,-105.3],[286.4,-58.0,355.9,-39.4],[260.3,-95.3,383.4,-53.5],[251.2,-122.1,270.4,-92.6],[264.0,-182.1,388.0,-134.4],[176.6,-245.3,286.9,-202.5],[80.5,-235.7,144.1,-193.9],[146.4,-327.1,224.6,-259.4],[180.7,-376.6,292.3,-330.7],[275.9,-436.6,400.8,-393.9],[184.8,-418.4,241.1,-397.5],[232.4,-438.4,257.1,-424.8],[66.3,-503.4,159.2,-450.7],[177.0,-441.2,219.1,-423.4],[65.4,-436.2,156.5,-381.6],[65.9,-470.3,77.3,-420.7],[79.6,-457.5,99.7,-437.1],[63.1,-375.7,126.7,-335.7],[-198.6,-255.3,-171.2,-228.9],[-198.6,-349.4,-168.9,-254.4],[-198.6,-374.3,-166.6,-348.0],[-183.0,-434.3,-68.7,-390.7],[-67.7,-509.3,-55.4,-444.8],[-102.1,-474.8,-68.2,-445.3],[-137.3,-477.5,-119.0,-447.1],[-198.6,-423.4,-182.1,-364.8],[-196.3,-480.3,-175.7,-450.7],[-168.4,-515.2,-136.8,-483.4],[-139.6,-515.2,-121.3,-499.8],[-186.3,-574.3,-127.2,-528.4],[-198.6,-574.8,-198.1,-556.2],[-112.6,-574.3,-46.7,-525.7],[-111.7,-511.6,-66.8,-487.1],[-70.5,-739.3,-30.7,-672.1],[-104.3,-670.7,-31.1,-636.2],[-198.6,-675.7,-175.3,-643.0],[91.9,-696.1,157.4,-634.3],[258.5,-687.1,336.7,-621.6],[74.6,-570.7,209.5,-521.6],[73.6,-504.3,103.8,-491.2],[178.9,-498.0,227.8,-450.3],[236.5,-463.0,258.5,-448.4],[238.4,-494.8,258.9,-481.6],[65.4,-563.4,215.0,-507.1],[234.2,-561.6,307.0,-542.1],[261.2,-523.0,302.4,-478.0],[317.5,-543.9,404.4,-477.5],[424.6,-506.6,446.5,-489.8],[469.4,-499.3,544.9,-447.1],[480.4,-505.2,497.3,-490.3],[514.3,-558.4,553.2,-545.2],[426.9,-534.3,501.0,-470.3],[467.1,-627.5,575.6,-601.6],[463.9,-670.7,528.4,-657.5],[354.1,-674.8,385.2,-662.1],[394.8,-668.9,443.3,-658.9],[393.5,-633.4,439.7,-624.8],[391.6,-616.6,452.5,-603.4],[362.4,-617.1,387.5,-606.2],[301.0,-664.8,317.5,-644.8],[356.4,-637.1,388.0,-625.2],[355.5,-706.1,385.7,-695.7],[394.8,-704.8,448.8,-678.0],[463.5,-711.1,528.9,-698.0],[617.2,-724.3,665.7,-712.1],[750.8,-720.7,803.9,-688.4],[746.7,-681.1,861.1,-606.6],[676.7,-702.5,724.7,-688.4],[675.3,-664.8,723.4,-651.6],[617.7,-683.4,667.1,-668.9],[539.4,-679.3,572.4,-655.7],[628.7,-630.2,718.8,-611.2],[602.6,-558.9,657.5,-541.6],[546.3,-509.8,638.3,-434.3],[663.0,-518.0,707.8,-488.4],[728.4,-551.6,775.5,-538.0],[726.6,-512.5,773.7,-499.3],[719.2,-404.8,780.6,-365.3],[722.9,-478.4,773.7,-419.3],[660.7,-429.8,698.7,-398.9],[659.3,-390.7,695.0,-352.1],[722.0,-347.5,785.1,-318.0],[721.1,-280.3,783.3,-253.0],[530.3,-376.2,593.0,-361.6],[602.1,-367.5,658.4,-353.4],[603.5,-396.2,649.2,-375.3],[604.4,-428.4,661.1,-402.5],[499.2,-431.2,594.8,-383.4],[432.8,-379.8,521.1,-363.4],[425.0,-434.8,490.0,-393.4],[420.9,-463.4,437.4,-457.5],[311.6,-370.7,394.8,-326.2],[322.1,-313.9,389.4,-253.5],[425.5,-346.6,475.8,-233.9],[488.2,-325.3,507.9,-197.5],[416.3,-191.6,485.4,-167.6],[315.7,-244.8,390.3,-206.6],[410.9,-86.2,452.5,-61.7],[408.6,-53.5,480.4,-27.6],[415.4,-151.6,458.0,-92.1],[497.3,-51.7,595.7,-25.3],[481.3,-50.7,490.0,-19.4],[610.3,-33.5,667.1,-16.2],[639.2,-143.5,689.5,-75.3],[555.0,-85.3,626.8,-57.1],[559.6,-140.7,619.5,-126.2],[650.6,-330.7,694.5,-171.6],[712.8,-212.5,776.9,-187.5],[711.9,-176.6,743.0,-126.2],[753.1,-141.6,808.9,-113.0],[700.5,-119.4,738.5,-87.6],[707.4,-30.3,828.1,-17.1],[666.6,-46.7,695.0,-18.0],[844.2,-26.2,960.4,-8.9],[793.4,-213.5,820.4,-192.1],[838.7,-211.2,865.2,-190.7],[894.0,-469.3,940.2,-455.7],[868.4,-431.2,937.5,-418.4],[880.8,-341.2,932.0,-328.9],[838.7,-315.3,874.8,-301.6],[884.0,-304.8,941.6,-290.3],[880.3,-272.1,931.6,-259.8],[829.1,-247.5,865.2,-233.0],[839.6,-281.2,875.7,-267.5],[797.5,-275.7,824.0,-252.5],[798.4,-344.4,824.9,-321.2],[786.5,-381.6,836.8,-364.4],[840.0,-347.5,876.2,-333.9],[850.6,-392.1,936.6,-362.5],[873.9,-499.3,888.5,-441.6],[788.3,-419.8,858.8,-404.8],[781.5,-452.5,857.9,-438.9],[783.3,-489.8,857.9,-473.9],[784.7,-520.2,862.5,-497.1],[784.2,-549.8,857.9,-533.0],[874.8,-543.4,943.0,-525.2],[861.5,-519.8,892.7,-495.7],[896.3,-508.0,942.5,-495.3],[883.5,-674.3,938.0,-664.8],[878.5,-645.7,940.2,-633.9],[881.7,-611.2,940.2,-597.5],[834.1,-594.3,913.7,-583.9],[879.4,-704.8,946.2,-693.9],[791.5,84.2,862.5,107.0],[816.2,121.5,860.2,153.8],[804.4,179.7,865.7,199.7],[784.2,148.3,801.6,191.9],[828.1,207.9,882.6,231.0],[835.5,285.1,875.3,297.4],[811.2,315.1,874.8,326.5],[814.0,350.1,882.1,362.4],[812.1,390.1,879.4,405.5],[810.8,432.8,877.6,447.4],[891.7,457.8,948.9,470.1],[893.6,418.7,947.1,432.4],[892.7,496.4,945.3,511.0],[808.5,471.4,878.0,486.9],[849.6,578.7,931.6,598.7],[850.1,543.7,904.1,570.1],[782.8,601.0,841.0,615.1],[853.8,700.0,888.1,713.7],[-198.6,632.3,-114.0,660.5],[-198.6,532.8,-108.0,567.3],[-124.9,501.9,-56.3,528.7],[-198.6,498.7,-194.9,519.2],[-191.3,-209.8,-76.4,-166.6],[-169.3,311.9,-133.6,408.3],[470.8,-152.6,540.3,-124.8],[468.5,-90.3,538.5,-63.5],[-198.6,245.6,-158.3,287.4],[212.7,506.0,279.5,576.4]]};

// 由 tools/gen-campus-trees.py 生成：底板行道树树干中心 [x,z]（底板坐标）
// 给主模块做撞树判定用；半径在 art.js 的 registerTree 里统一给。
const PLATE_TREES = {"campus":[[-809.1,-387.5],[-808.5,-405.8],[-808.4,-424.2],[-808.4,-369.2],[-808.2,-442.5],[-807.9,-387.5],[-807.5,-460.8],[-807.5,-369.2],[-807.2,-424.2],[-806.9,-442.5],[-804.9,-348.6],[-803.7,-348.6],[-798.5,-331.5],[-797.4,-331.5],[-796.1,-481.3],[-794.9,-481.3],[-793.0,-369.2],[-792.9,-405.8],[-792.7,-442.5],[-792.6,-387.5],[-792.4,-424.2],[-792.1,-460.8],[-791.9,-369.2],[-791.8,-442.5],[-791.8,-314.5],[-791.7,-405.8],[-791.7,-387.5],[-791.2,-424.2],[-791.1,-460.8],[-790.4,-314.5],[-790.3,-354.1],[-789.5,-466.6],[-789.0,-354.1],[-788.2,-466.6],[-785.5,-297.2],[-784.5,-297.2],[-783.0,-337.2],[-782.0,-337.2],[-779.8,-488.1],[-778.9,-280.2],[-778.7,-488.1],[-777.5,-280.2],[-777.3,-319.8],[-776.1,-319.8],[-773.1,-473.2],[-772.6,-262.9],[-772.1,-473.2],[-771.4,-262.9],[-771.1,-302.6],[-769.9,-302.6],[-766.2,-245.6],[-764.3,-285.6],[-764.0,-495.7],[-763.1,-285.6],[-762.9,-495.7],[-758.8,-228.2],[-757.9,-268.5],[-757.5,-481.1],[-757.5,-228.2],[-756.7,-268.5],[-756.3,-481.1],[-751.2,-210.9],[-751.0,-251.5],[-750.1,-210.9],[-750.0,-251.5],[-747.7,-502.2],[-746.6,-502.2],[-744.3,-234.8],[-743.2,-193.8],[-743.1,-234.8],[-742.2,-193.8],[-740.7,-487.9],[-736.5,-217.7],[-735.1,-217.7],[-735.0,-176.8],[-734.0,-176.8],[-731.9,-509.6],[-730.6,-509.6],[-728.6,-200.5],[-727.3,-200.5],[-727.3,-159.6],[-726.0,-159.6],[-725.1,-494.7],[-723.9,-494.7],[-720.5,-183.4],[-719.6,-142.4],[-719.4,-183.4],[-718.6,-142.4],[-715.6,-516.6],[-714.7,-516.6],[-712.5,-166.3],[-711.6,-166.3],[-711.4,-125.4],[-710.1,-125.4],[-709.4,-502.5],[-709.1,165.9],[-708.9,62.8],[-708.9,114.3],[-708.8,80.0],[-708.7,131.5],[-708.7,217.4],[-708.6,200.2],[-708.5,45.6],[-708.5,148.7],[-708.4,97.1],[-708.3,183.0],[-708.2,-502.5],[-707.8,114.3],[-707.8,165.9],[-707.7,80.0],[-707.7,217.4],[-707.6,45.6],[-707.6,62.8],[-707.6,200.2],[-707.4,131.5],[-707.4,183.0],[-707.2,97.1],[-705.5,-109.1],[-705.4,-148.9],[-704.4,-109.1],[-704.3,-148.9],[-700.7,-91.6],[-699.9,-523.9],[-699.4,-91.6],[-698.5,-523.9],[-696.5,-132.0],[-695.5,-74.1],[-694.5,-74.1],[-693.0,114.3],[-692.9,183.0],[-692.8,80.0],[-692.7,-509.4],[-692.6,165.9],[-692.4,45.6],[-692.4,62.8],[-692.4,131.5],[-692.3,148.7],[-692.3,200.2],[-692.1,97.1],[-692.1,217.5],[-691.9,114.3],[-691.9,233.7],[-691.7,80.0],[-691.7,183.0],[-691.5,29.1],[-691.5,62.8],[-691.4,131.5],[-691.4,200.2],[-691.3,165.9],[-691.1,97.1],[-691.1,148.7],[-691.0,45.3],[-690.8,217.5],[-690.7,233.7],[-690.6,-56.6],[-690.5,29.1],[-690.1,-113.5],[-689.5,-56.6],[-689.2,-113.5],[-685.9,-39.0],[-685.0,-95.9],[-685.0,-39.0],[-683.4,-531.4],[-681.1,-21.4],[-680.7,-78.4],[-680.1,-21.4],[-679.6,-78.4],[-677.1,-516.4],[-676.1,-516.4],[-675.8,-60.8],[-675.0,-4.1],[-674.7,-60.8],[-674.3,217.9],[-673.8,234.2],[-673.7,45.0],[-673.6,29.0],[-673.3,217.9],[-672.4,29.0],[-672.3,45.0],[-671.0,13.5],[-670.3,-43.5],[-670.0,13.5],[-669.1,-43.5],[-667.7,29.9],[-667.6,-538.1],[-666.6,-538.1],[-666.4,29.9],[-665.6,47.9],[-665.2,-26.0],[-664.6,47.9],[-664.0,-26.0],[-663.5,65.9],[-662.6,65.9],[-661.2,-523.7],[-661.2,83.8],[-660.2,-8.3],[-660.0,-523.7],[-659.9,83.8],[-659.5,101.9],[-658.5,101.9],[-657.0,119.9],[-656.9,217.8],[-656.9,234.5],[-655.8,217.8],[-655.8,234.5],[-655.7,9.1],[-655.4,137.9],[-654.4,9.1],[-653.1,155.8],[-652.0,155.8],[-651.8,28.1],[-651.8,173.9],[-651.1,-545.3],[-650.7,28.1],[-650.7,173.9],[-649.8,191.9],[-649.6,46.1],[-648.8,208.8],[-648.8,243.8],[-648.8,401.2],[-648.6,313.8],[-648.5,191.9],[-648.5,296.2],[-648.4,331.2],[-648.4,348.8],[-648.3,46.1],[-648.3,261.2],[-648.3,383.8],[-648.2,366.2],[-648.1,278.8],[-647.8,401.2],[-647.7,208.8],[-647.7,243.8],[-647.5,348.8],[-647.4,313.8],[-647.4,331.2],[-647.3,366.2],[-647.2,64.1],[-647.2,296.2],[-647.0,261.2],[-647.0,383.8],[-645.3,-531.0],[-645.1,82.1],[-644.1,-531.0],[-643.0,100.1],[-642.0,118.2],[-640.7,118.2],[-639.6,136.1],[-638.4,136.1],[-637.6,45.1],[-637.5,29.4],[-637.4,154.1],[-636.5,29.4],[-636.4,45.1],[-636.2,154.1],[-635.6,172.1],[-634.7,172.1],[-634.1,190.2],[-633.1,331.2],[-633.1,366.2],[-633.0,190.2],[-632.6,296.2],[-632.5,208.8],[-632.5,243.8],[-632.5,313.8],[-632.3,401.2],[-632.2,261.2],[-632.2,348.8],[-632.1,-550.0],[-632.1,278.8],[-632.1,383.8],[-631.8,331.2],[-631.7,366.2],[-631.6,296.2],[-631.5,-534.2],[-631.5,208.8],[-631.5,313.8],[-631.4,243.8],[-631.2,261.2],[-631.2,278.8],[-631.2,417.6],[-631.1,-550.0],[-631.1,402.3],[-631.0,348.8],[-631.0,401.2],[-630.9,383.8],[-630.3,-534.2],[-630.1,402.3],[-630.0,417.6],[-622.1,218.4],[-622.1,234.3],[-620.8,218.4],[-620.8,234.3],[-619.6,28.8],[-619.6,44.6],[-618.4,28.8],[-618.4,44.6],[-614.8,-551.4],[-613.9,-534.7],[-613.4,-551.4],[-612.9,-534.7],[-612.3,402.0],[-612.2,417.8],[-611.2,417.8],[-611.1,402.0],[-604.5,233.8],[-604.0,218.0],[-603.5,233.8],[-601.6,28.7],[-601.6,45.3],[-600.4,28.7],[-600.4,45.3],[-597.3,-552.3],[-596.4,-536.1],[-596.0,-552.3],[-595.4,-536.1],[-593.4,401.8],[-593.3,418.4],[-592.4,418.4],[-592.3,401.8],[-587.1,217.7],[-587.1,234.0],[-586.0,217.7],[-586.0,234.0],[-583.6,29.3],[-583.0,45.1],[-582.4,29.3],[-579.6,-552.6],[-579.1,-537.1],[-578.5,-552.6],[-577.8,-537.1],[-574.6,401.7],[-574.6,417.9],[-573.4,401.7],[-573.4,417.9],[-569.8,233.8],[-569.7,218.4],[-568.5,218.4],[-568.4,233.8],[-565.5,29.5],[-565.5,45.0],[-564.5,29.5],[-564.5,45.0],[-562.2,-553.0],[-561.4,-537.1],[-560.9,-553.0],[-560.4,-537.1],[-555.8,418.3],[-555.7,402.2],[-554.6,402.2],[-554.5,418.3],[-552.3,217.9],[-552.1,234.0],[-551.2,234.0],[-551.0,217.9],[-547.6,44.6],[-547.5,29.4],[-546.5,29.4],[-546.4,44.6],[-544.7,-554.1],[-544.0,-537.9],[-543.5,-554.1],[-542.8,-537.9],[-536.8,402.1],[-536.8,417.6],[-535.8,402.1],[-535.7,417.6],[-534.7,218.4],[-534.2,234.3],[-533.6,218.4],[-529.7,28.7],[-529.5,45.4],[-528.5,45.4],[-528.3,28.7],[-527.2,-555.2],[-526.0,-555.2],[-525.9,-539.3],[-518.0,401.7],[-518.0,417.7],[-517.3,217.9],[-517.2,233.8],[-517.0,364.0],[-516.9,417.7],[-516.8,400.8],[-516.8,401.7],[-516.6,235.2],[-516.6,327.2],[-516.5,272.0],[-516.4,290.4],[-516.4,308.8],[-516.3,345.6],[-516.2,233.8],[-516.1,217.9],[-516.1,253.6],[-516.1,382.4],[-515.8,364.0],[-515.6,327.2],[-515.6,400.8],[-515.5,235.2],[-515.3,272.0],[-515.3,345.6],[-515.2,290.4],[-515.2,308.8],[-515.2,382.4],[-515.0,253.6],[-511.5,44.7],[-511.0,28.8],[-510.5,44.7],[-509.7,-555.6],[-509.0,-539.9],[-508.4,-555.6],[-507.9,-539.9],[-501.1,364.0],[-501.0,382.4],[-500.8,235.2],[-500.7,327.2],[-500.6,290.4],[-500.6,345.6],[-500.4,253.6],[-500.2,272.0],[-500.1,308.8],[-499.8,364.0],[-499.7,345.6],[-499.7,382.4],[-499.7,400.8],[-499.6,235.2],[-499.5,327.2],[-499.3,253.6],[-499.3,290.4],[-499.2,272.0],[-499.1,308.8],[-494.4,-537.4],[-493.6,28.7],[-493.5,44.8],[-493.2,-537.4],[-492.7,-67.5],[-492.6,8.5],[-492.5,-86.5],[-492.5,27.5],[-492.5,44.8],[-492.4,28.7],[-492.3,-10.5],[-492.2,-48.5],[-492.0,-29.5],[-491.7,8.5],[-491.6,-67.5],[-491.2,-86.5],[-491.1,-29.5],[-490.9,-48.5],[-488.6,-551.9],[-487.4,-551.9],[-476.6,-529.6],[-476.6,-48.5],[-476.6,8.5],[-476.4,-10.5],[-476.3,-29.5],[-476.3,27.5],[-476.1,-67.5],[-476.0,-86.5],[-475.7,-88.2],[-475.7,8.5],[-475.6,-104.4],[-475.5,-529.6],[-475.3,-10.5],[-475.2,-48.5],[-475.1,-29.5],[-475.0,-86.5],[-475.0,-67.5],[-474.7,-104.4],[-474.6,-88.2],[-470.5,-544.9],[-469.3,-544.9],[-457.9,-103.9],[-457.9,-88.2],[-456.9,-103.9],[-456.9,-88.2],[-452.4,-537.9],[-451.4,-537.9],[-440.3,-87.9],[-440.2,-103.8],[-439.2,-103.8],[-439.1,-87.9],[-434.5,-530.6],[-433.4,-530.6],[-422.6,-508.1],[-422.4,-103.6],[-422.4,-87.9],[-421.5,-508.1],[-421.5,-103.6],[-421.5,-87.9],[-416.6,-523.5],[-415.3,-523.5],[-404.8,-103.8],[-404.8,-88.3],[-404.5,-501.2],[-403.6,-103.8],[-403.6,-88.3],[-403.4,-501.2],[-399.3,-494.3],[-398.8,-515.6],[-398.1,-494.3],[-397.6,-515.6],[-395.7,-475.6],[-394.7,-475.6],[-392.5,-456.8],[-390.3,-438.1],[-389.2,-438.1],[-387.1,-103.8],[-386.5,-87.5],[-385.9,-103.8],[-383.4,-418.1],[-382.8,-496.9],[-382.4,-418.1],[-381.8,-496.9],[-379.9,-478.2],[-378.7,-478.2],[-377.6,-459.3],[-376.3,-459.3],[-375.2,-401.4],[-374.3,-401.4],[-374.2,-440.6],[-373.2,-440.6],[-369.3,-425.2],[-369.3,-103.8],[-369.3,-88.0],[-368.3,-103.8],[-368.2,-425.2],[-368.2,-88.0],[-365.9,-385.0],[-361.1,-408.5],[-359.9,-408.5],[-357.7,-368.2],[-352.8,-391.8],[-351.8,-391.8],[-351.7,-88.4],[-351.5,-104.2],[-350.6,-104.2],[-350.4,-88.4],[-349.8,-351.6],[-348.8,-351.6],[-343.8,-375.2],[-341.4,-335.0],[-340.4,-335.0],[-336.1,-358.5],[-334.9,-358.5],[-333.8,-103.7],[-333.8,-88.3],[-333.2,-318.5],[-332.8,-103.7],[-332.8,-88.3],[-332.2,-318.5],[-327.4,-342.0],[-326.4,-342.0],[-325.9,-302.1],[-324.7,-302.1],[-318.9,-325.8],[-318.0,-325.8],[-317.1,-286.3],[-316.2,-286.3],[-316.2,-87.8],[-316.1,-103.8],[-315.1,-103.8],[-315.0,-87.8],[-311.5,-309.5],[-310.3,-309.5],[-309.4,-270.1],[-308.3,-270.1],[-303.0,-293.7],[-301.7,-293.7],[-300.5,-254.5],[-299.5,-254.5],[-298.4,-88.3],[-298.0,-121.7],[-297.8,-104.3],[-297.6,-155.9],[-297.5,-190.1],[-297.4,-241.4],[-297.4,-224.3],[-297.4,-207.2],[-297.3,-138.8],[-297.3,-88.3],[-297.2,-173.0],[-296.7,-121.7],[-296.6,-155.9],[-296.5,-190.1],[-296.3,-104.6],[-296.2,-173.0],[-296.1,-224.3],[-296.0,-241.4],[-296.0,-138.8],[-295.1,-277.5],[-294.0,-277.5],[-286.3,-261.7],[-285.3,-261.7],[-282.1,-138.8],[-282.1,-121.7],[-281.7,-173.0],[-281.7,-104.6],[-281.5,-224.3],[-281.5,-190.1],[-281.4,-207.2],[-281.3,-241.4],[-280.9,-138.8],[-280.8,-173.0],[-280.8,-121.7],[-280.7,-155.9],[-280.7,-104.6],[-280.4,-241.4],[-280.4,-190.1],[-280.2,-224.3],[-280.1,-207.2]],"campus2":[[380.9,-311.7],[380.9,-67.8],[380.9,106.4],[381.0,-485.9],[381.0,-276.8],[381.0,1.9],[381.1,-329.1],[381.1,-102.6],[381.1,-85.2],[381.2,-451.0],[381.3,-294.2],[381.3,-242.0],[381.3,-207.1],[381.3,54.2],[381.4,-363.9],[381.4,19.3],[381.4,36.8],[381.5,-416.2],[381.5,-381.3],[381.5,-189.7],[381.6,-137.4],[381.6,-32.9],[381.6,71.6],[381.7,-468.4],[381.7,-398.8],[381.7,-346.5],[381.8,-259.4],[381.8,-50.3],[381.8,-15.5],[381.8,89.0],[381.8,123.9],[381.9,-503.3],[381.9,-120.0],[381.9,141.3],[382.0,-485.9],[382.0,-276.8],[382.0,-224.6],[382.0,-102.6],[382.1,-154.9],[382.2,-451.0],[382.2,-433.6],[382.2,-329.1],[382.2,-311.7],[382.2,-67.8],[382.2,1.9],[382.2,106.4],[382.3,36.8],[382.4,-381.3],[382.4,-294.2],[382.4,-85.2],[382.5,-416.2],[382.5,-207.1],[382.5,-189.7],[382.5,-172.3],[382.6,-468.4],[382.6,-363.9],[382.6,-242.0],[382.6,19.3],[382.6,54.2],[382.8,141.3],[382.9,-398.8],[382.9,-259.4],[382.9,-15.5],[382.9,89.0],[382.9,123.9],[383.0,-503.3],[383.0,-346.5],[383.0,-137.4],[383.0,-50.3],[397.0,-259.4],[397.0,1.9],[397.0,141.3],[397.1,-468.4],[397.1,-207.1],[397.1,-172.3],[397.1,71.6],[397.2,-363.9],[397.2,-32.9],[397.3,-398.8],[397.3,-311.7],[397.3,-276.8],[397.3,19.3],[397.4,-433.6],[397.4,-85.2],[397.4,36.8],[397.4,54.2],[397.5,-485.9],[397.5,-346.5],[397.5,-154.9],[397.6,-381.3],[397.6,-189.7],[397.6,-67.8],[397.6,89.0],[397.7,-329.1],[397.7,-294.2],[397.7,-242.0],[397.7,-120.0],[397.7,123.9],[397.8,-451.0],[397.8,-102.6],[397.8,-50.3],[397.8,106.4],[397.9,-224.6],[397.9,-15.5],[398.1,-416.2],[398.2,-207.1],[398.2,1.9],[398.2,141.4],[398.2,158.3],[398.3,-503.5],[398.3,-468.4],[398.3,-398.8],[398.3,-363.9],[398.3,-259.4],[398.3,-172.3],[398.3,-85.2],[398.3,71.6],[398.4,-520.2],[398.4,-276.8],[398.4,-137.4],[398.4,36.8],[398.5,-32.9],[398.6,-311.7],[398.6,-189.7],[398.6,-154.9],[398.6,19.3],[398.6,54.2],[398.7,-433.6],[398.7,-329.1],[398.7,-120.0],[398.7,123.9],[398.8,-485.9],[398.8,-451.0],[398.8,-381.3],[398.8,-346.5],[398.8,-242.0],[398.9,-294.2],[398.9,-224.6],[398.9,-102.6],[399.0,-67.8],[399.0,-15.5],[399.0,89.0],[399.1,-50.3],[399.1,106.4],[399.3,-520.2],[399.3,-504.0],[399.4,141.6],[399.5,158.3],[415.8,-504.0],[415.8,141.5],[415.9,158.1],[416.0,-520.1],[417.0,-520.1],[417.1,-504.0],[417.1,141.5],[417.1,158.1],[433.5,-520.4],[433.5,142.1],[433.6,-504.0],[433.6,157.8],[434.6,-504.0],[434.7,142.1],[434.7,157.8],[434.8,-520.4],[451.1,-520.1],[451.2,-503.8],[451.3,141.6],[451.3,157.8],[452.3,141.6],[452.3,157.8],[452.4,-520.1],[452.4,-503.8],[468.8,-520.3],[468.8,-504.3],[468.9,142.3],[468.9,157.6],[469.9,142.3],[469.9,157.6],[470.0,-520.3],[470.0,-504.3],[486.4,142.3],[486.5,-520.1],[487.1,-503.5],[487.1,158.0],[487.6,-520.1],[487.7,142.3],[504.0,157.9],[504.1,-520.4],[504.1,-504.1],[504.2,142.5],[505.2,142.5],[505.3,-520.4],[505.3,-504.1],[505.4,157.9],[521.7,141.8],[521.7,157.9],[521.8,-519.7],[521.8,-503.7],[522.9,-519.7],[522.9,-503.7],[523.0,141.8],[523.0,157.9],[539.4,-504.0],[539.4,142.1],[539.5,-520.1],[539.5,158.3],[540.5,-520.1],[540.5,158.3],[540.6,-504.0],[540.6,142.1],[557.0,157.6],[557.1,-519.9],[557.1,-504.1],[557.1,141.8],[558.1,-519.9],[558.1,-504.1],[558.2,141.8],[558.3,157.6],[574.7,-520.0],[574.7,158.5],[574.8,-503.9],[575.3,142.5],[575.8,-503.9],[575.9,-520.0],[575.9,158.5],[592.3,-503.9],[592.4,-520.4],[592.4,157.7],[592.5,142.0],[593.4,142.0],[593.5,-520.4],[593.5,157.7],[593.6,-503.9],[609.9,157.8],[610.0,-519.9],[610.1,-503.8],[610.1,142.0],[611.1,-503.8],[611.1,142.0],[611.2,-519.9],[611.2,157.8],[627.7,-519.6],[627.7,-504.0],[627.8,157.6],[628.2,141.6],[628.7,157.6],[628.8,-519.6],[628.8,-504.0],[645.2,-504.2],[645.3,-520.3],[645.3,141.6],[645.3,157.7],[646.5,-520.3],[646.5,-504.2],[646.5,141.6],[646.5,157.7],[662.9,-503.8],[663.0,-519.6],[663.0,142.0],[663.0,158.3],[664.1,-519.6],[664.1,142.0],[664.1,158.3],[664.2,-503.8],[680.6,141.6],[680.6,157.6],[681.0,-259.4],[681.1,-433.6],[681.1,-276.8],[681.1,-172.3],[681.1,-102.6],[681.1,-50.3],[681.2,-519.5],[681.2,-381.3],[681.2,-329.1],[681.2,-154.9],[681.2,-32.9],[681.2,54.2],[681.2,71.6],[681.3,-503.9],[681.4,-468.4],[681.4,-451.0],[681.4,-85.2],[681.5,-207.1],[681.5,-189.7],[681.5,36.8],[681.5,106.4],[681.5,141.4],[681.6,-294.2],[681.6,-137.4],[681.6,89.0],[681.7,-398.8],[681.7,19.3],[681.8,-485.9],[681.8,-416.2],[681.8,-363.9],[681.8,-311.7],[681.8,-242.0],[681.8,-120.0],[681.8,-67.8],[681.8,-15.5],[681.8,1.9],[681.8,123.9],[681.8,157.6],[682.0,-224.6],[682.0,-102.6],[682.1,-172.3],[682.1,-50.3],[682.2,-433.6],[682.2,-381.3],[682.2,-259.4],[682.3,-346.5],[682.3,-276.8],[682.3,71.6],[682.4,-451.0],[682.4,-329.1],[682.4,-154.9],[682.4,-85.2],[682.4,54.2],[682.5,-32.9],[682.5,106.4],[682.5,141.3],[682.6,-468.4],[682.7,-189.7],[682.7,-15.5],[682.7,19.3],[682.7,89.0],[682.8,-503.3],[682.8,-416.2],[682.8,-207.1],[682.8,-120.0],[682.9,-485.9],[682.9,-363.9],[682.9,-294.2],[682.9,-67.8],[683.0,-398.8],[683.0,-242.0],[697.0,36.8],[697.1,-329.1],[697.1,1.9],[697.1,89.0],[697.2,-433.6],[697.2,-242.0],[697.2,123.9],[697.3,-102.6],[697.3,-67.8],[697.3,-15.5],[697.3,141.3],[697.4,-276.8],[697.4,-154.9],[697.4,-85.2],[697.5,-451.0],[697.5,-398.8],[697.5,-311.7],[697.5,54.2],[697.5,106.4],[697.6,-381.3],[697.6,-189.7],[697.7,-485.9],[697.7,-416.2],[697.7,-207.1],[697.7,-120.0],[697.7,-50.3],[697.7,-32.9],[697.8,-503.3],[697.8,-468.4],[697.8,-346.5],[697.8,-294.2],[697.8,-259.4],[697.8,-224.6],[697.8,-172.3],[697.8,19.3],[697.9,71.6],[698.0,-363.9],[698.1,36.8],[698.2,-242.0],[698.2,89.0],[698.3,-329.1],[698.3,-276.8],[698.3,-137.4],[698.3,-67.8],[698.3,-15.5],[698.3,141.3],[698.4,-433.6],[698.4,1.9],[698.4,123.9],[698.5,-189.7],[698.5,-102.6],[698.5,-85.2],[698.5,54.2],[698.6,-154.9],[698.7,-468.4],[698.7,-451.0],[698.7,-311.7],[698.7,-120.0],[698.7,-50.3],[698.7,106.4],[698.8,-416.2],[698.8,-398.8],[698.8,-346.5],[698.8,-294.2],[698.8,71.6],[698.9,-503.3],[698.9,-363.9],[698.9,-259.4],[698.9,-224.6],[698.9,-207.1],[698.9,-32.9],[698.9,19.3],[699.0,-485.9],[699.0,-172.3]]};

// =====================================================================
//  js/art.js —— 美术升级包（ART）
//
//  目标：把「灰墙绿树」的程序化校园，升级成有北大辨识度的燕园；
//        把城市街区补足成有纵深的科幻都市。
//
//  三条硬约束：
//   1. 零外部资源 —— 所有贴图都是 canvas 现画，不增加下载体积
//   2. 少 drawcall —— 所有静态摆件按材质合并成个位数网格
//   3. 不碰玩法 —— 只加视觉，不改碰撞 / 里程 / 转向
//
//  导出 createArtKit({...}) 由主模块内联调用（tools/inline-art.py 去 export）。
// =====================================================================
function createArtKit(ctx) {
    const {
        THREE, scene, renderer, camera,
        mergeGeometries, CAMPUS_SETS,
        getCampus, getTheme,
        rand, pick, clamp, shared,
    } = ctx;

    const TAU = Math.PI * 2;
    const lerp = (a, b, t) => a + (b - a) * t;
    // 底板里草面在 -0.28、人行道在 +0.01、车道在 0；摆在草地上的东西要沉下去
    const GY = -0.26;
    // 低画质：叶量/摆件密度降档（每次现算，切档后立刻生效）
    const LOWQ = () => (typeof QUALITY !== 'undefined' && QUALITY.tier === 'low');

    // -----------------------------------------------------------------
    //  校园静态实体登记表（撞楼 / 撞树判定用）
    //  底板 GLB 里的楼和树都按 ≥6m 净空生成，真正会横在跑道上的是
    //  代码生成的实心盒子（医学部 modernHall 在路口会压住两条道），
    //  以及在弯道处被平滑方向带进路面的行道树 / 绿篱。
    //  这里统一登记三类实体，坐标都是底板坐标（和 CAMPUS.pts / sideAt 同一套）：
    //    kind='box'   建筑主楼体，有向矩形
    //    kind='hedge' 绿篱段，有向矩形（矮，可以跳过）
    //    kind='tree'  树干 + 低枝，圆形
    // -----------------------------------------------------------------
    const CAMPUS_SOLIDS = { campus: [], campus2: [] };
    let ACTIVE_SET_ID = 'campus';
    function pushSolid(o) {
        const arr = CAMPUS_SOLIDS[ACTIVE_SET_ID] || (CAMPUS_SOLIDS[ACTIVE_SET_ID] = []);
        arr.push(o);
    }
    function registerBuilding(x, z, hw, hd, ry, h) {
        pushSolid({ kind: 'box', x, z, hw, hd, ry, h, c: Math.cos(ry), s: Math.sin(ry) });
    }
    function registerHedge(x, z, hw, hd, ry, h) {
        pushSolid({ kind: 'hedge', x, z, hw, hd, ry, h, c: Math.cos(ry), s: Math.sin(ry) });
    }
    let NO_REG = false;      // 重种底板树时置 true：碰撞表已经由 decorateCampus 统一登记过
    function registerTree(x, z, r) {
        if (NO_REG) return;
        // 树干半径 + 低垂枝的遮挡范围；跳不过去，所以 h 给足
        pushSolid({ kind: 'tree', x, z, r, h: 99, c: 1, s: 0 });
    }
    // 主模块用它取某一张校园图的实体表；切场景时不会串图
    function getBuildingBoxes(setId) { return CAMPUS_SOLIDS[setId] || []; }

    // -----------------------------------------------------------------
    //  0. 画布 / 贴图小工具
    // -----------------------------------------------------------------
    function cv(w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }
    function tex(canvas, { rx = 1, ry = 1, aniso = 8, srgb = true } = {}) {
        const t = new THREE.CanvasTexture(canvas);
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(rx, ry);
        t.anisotropy = Math.min(aniso, renderer.capabilities.getMaxAnisotropy());
        t.needsUpdate = true;
        return t;
    }
    // 可复现的伪随机（贴图要稳定，不能用 Math.random）
    function rngOf(seed) {
        let s = seed >>> 0;
        return () => {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }
    function shade(hex, k) {
        const c = new THREE.Color(hex);
        c.multiplyScalar(k);
        return '#' + c.getHexString();
    }
    function rgba(hex, a) {
        const c = new THREE.Color(hex);
        return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
    }
    // 细颗粒噪点：给墙面 / 地面加「脏」
    function grain(c, w, h, n, amp, seed = 7) {
        const r = rngOf(seed);
        for (let i = 0; i < n; i++) {
            const x = r() * w, y = r() * h;
            const a = r() * amp;
            c.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
            c.fillRect(x, y, 1 + r() * 2, 1 + r() * 2);
        }
    }

    // -----------------------------------------------------------------
    //  1. 立面贴图 —— 一格 = 一个开间(3.8m) × 一层(3.6m)
    //     北大燕园的真实色彩：红砖 + 白窗套、青砖 + 灰石、米白石材
    // -----------------------------------------------------------------
    const FACADE_SPECS = {
        // 红砖教学楼 / 老斋舍：砖红墙 + 米白窗套 + 深色木窗
        brick: {
            wall: '#a24e3a', wall2: '#8f4433', mortar: '#c9b8a6',
            brick: 1, cols: 12, rows: 22,
            frame: '#efe8da', frameW: 5, glass: '#2f4453',
            sill: '#e3dbcb', band: 0, win: [0.16, 0.28, 0.84, 0.74],
            mullion: 2, arch: 0,
        },
        // 青砖系馆：灰砖 + 深灰石窗套 + 竖长窗
        graybrick: {
            wall: '#8c8d85', wall2: '#7b7c75', mortar: '#a8a99f',
            brick: 1, cols: 16, rows: 26,
            frame: '#b9bab1', frameW: 4, glass: '#28394a',
            sill: '#9a9b92', band: 1, win: [0.24, 0.16, 0.76, 0.82],
            mullion: 2, arch: 0,
        },
        // 米白石材：壁柱 + 大窗（图书馆 / 理科楼）
        stone: {
            wall: '#ddd2ba', wall2: '#cdc1a8', mortar: '#cfc6b2',
            brick: 0, cols: 1, rows: 1,
            frame: '#f2ecdd', frameW: 6, glass: '#33485c',
            sill: '#cdc3ad', band: 1, win: [0.13, 0.22, 0.87, 0.78],
            mullion: 3, arch: 0, pilaster: 1,
        },
        // 浅黄抹灰：附属楼 / 老住宅
        pale: {
            wall: '#d6c6a4', wall2: '#c8b792', mortar: '#c2b190',
            brick: 0, cols: 1, rows: 1,
            frame: '#efe6d0', frameW: 5, glass: '#2e4052',
            sill: '#c0ad8c', band: 0, win: [0.22, 0.30, 0.78, 0.70],
            mullion: 2, arch: 0,
        },
    };

    function drawFacade(sp, size = 256) {
        const c = cv(size, size), g = c.getContext('2d');
        const r = rngOf(1337);
        // 底色 + 竖向雨渍
        g.fillStyle = sp.wall; g.fillRect(0, 0, size, size);
        if (sp.brick) {
            const bw = size / sp.cols, bh = size / sp.rows;
            for (let row = 0; row < sp.rows; row++) {
                for (let col = 0; col < sp.cols; col++) {
                    const k = 0.86 + r() * 0.26;
                    g.fillStyle = shade(sp.wall, k);
                    const off = (row % 2) * bw * 0.5;
                    g.fillRect(col * bw + off + 0.7, row * bh + 0.7, bw - 1.4, bh - 1.4);
                }
            }
            g.strokeStyle = rgba(sp.mortar, 0.55);
            g.lineWidth = 1;
            for (let row = 0; row <= sp.rows; row++) {
                g.beginPath(); g.moveTo(0, row * bh); g.lineTo(size, row * bh); g.stroke();
            }
        } else {
            // 抹灰 / 石材：低频斑块
            for (let i = 0; i < 40; i++) {
                const x = r() * size, y = r() * size, rr = 12 + r() * 42;
                const grd = g.createRadialGradient(x, y, 0, x, y, rr);
                grd.addColorStop(0, rgba(r() < 0.5 ? sp.wall2 : '#ffffff', 0.05 + r() * 0.05));
                grd.addColorStop(1, 'rgba(0,0,0,0)');
                g.fillStyle = grd; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
            }
            // 石材横向分缝
            g.strokeStyle = 'rgba(90,86,78,0.16)';
            for (let y = 0; y < size; y += size / 4) {
                g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke();
            }
        }
        grain(g, size, size, 2600, 0.05, 21);

        // 层间腰线（每层底一条深色）
        if (sp.band) {
            g.fillStyle = rgba(sp.wall2, 0.9);
            g.fillRect(0, size - size * 0.055, size, size * 0.055);
            g.fillStyle = 'rgba(255,255,255,0.10)';
            g.fillRect(0, size - size * 0.055, size, 2);
        }
        // 壁柱（米白石材才有）
        if (sp.pilaster) {
            g.fillStyle = rgba('#f4efe2', 0.85);
            g.fillRect(0, 0, size * 0.055, size);
            g.fillRect(size * 0.945, 0, size * 0.055, size);
            g.fillStyle = 'rgba(0,0,0,0.07)';
            g.fillRect(size * 0.055, 0, 3, size);
            g.fillRect(size * 0.945 - 3, 0, 3, size);
        }

        // 窗洞
        const [x0, y0, x1, y1] = [sp.win[0] * size, sp.win[1] * size, sp.win[2] * size, sp.win[3] * size];
        const W = x1 - x0, H = y1 - y0;
        // 窗套
        g.fillStyle = sp.frame;
        g.fillRect(x0 - sp.frameW, y0 - sp.frameW, W + sp.frameW * 2, H + sp.frameW * 2);
        // 拱窗：上半圆
        if (sp.arch) {
            g.beginPath();
            g.arc(x0 + W / 2, y0, W / 2 + sp.frameW, Math.PI, 0);
            g.fill();
        }
        // 玻璃
        const gl = g.createLinearGradient(0, y0, 0, y1);
        gl.addColorStop(0, shade(sp.glass, 1.55));
        gl.addColorStop(0.42, sp.glass);
        gl.addColorStop(1, shade(sp.glass, 0.72));
        g.fillStyle = gl;
        g.beginPath();
        if (sp.arch) {
            g.moveTo(x0, y0 + W / 2);
            g.arc(x0 + W / 2, y0 + W / 2, W / 2, Math.PI, 0);
            g.lineTo(x1, y1); g.lineTo(x0, y1); g.closePath();
        } else {
            g.rect(x0, y0, W, H);
        }
        g.fill();
        // 斜向天光反射
        g.save();
        g.beginPath(); g.rect(x0, y0, W, H); g.clip();
        g.fillStyle = 'rgba(214,236,255,0.16)';
        g.beginPath();
        g.moveTo(x0 - W * 0.1, y1);
        g.lineTo(x0 + W * 0.55, y0);
        g.lineTo(x0 + W * 0.86, y0);
        g.lineTo(x0 + W * 0.2, y1);
        g.closePath(); g.fill();
        // 室内暖光（少量窗户）
        if (r() < 0.18) {
            g.fillStyle = 'rgba(255,214,150,0.20)';
            g.fillRect(x0, y0 + H * 0.45, W, H * 0.55);
        }
        g.restore();
        // 窗棂
        g.strokeStyle = rgba(sp.frame, 0.95);
        g.lineWidth = sp.mullion;
        g.beginPath();
        g.moveTo(x0 + W / 2, y0); g.lineTo(x0 + W / 2, y1);
        g.moveTo(x0, y0 + H * 0.52); g.lineTo(x1, y0 + H * 0.52);
        g.stroke();
        // 窗台（外挑，带投影）
        g.fillStyle = sp.sill;
        g.fillRect(x0 - sp.frameW - 3, y1 + sp.frameW, W + sp.frameW * 2 + 6, size * 0.035);
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.fillRect(x0 - sp.frameW - 3, y1 + sp.frameW + size * 0.035, W + sp.frameW * 2 + 6, 3);
        return c;
    }

    // -----------------------------------------------------------------
    //  2. 地面 / 屋面 / 水面贴图
    // -----------------------------------------------------------------
    function drawLawn(size = 256) {
        const c = cv(size, size), g = c.getContext('2d');
        const r = rngOf(91);
        g.fillStyle = '#5b7c3c'; g.fillRect(0, 0, size, size);
        // 大块深浅（土壤斑 / 修剪痕）
        for (let i = 0; i < 34; i++) {
            const x = r() * size, y = r() * size, rr = 22 + r() * 76;
            const grd = g.createRadialGradient(x, y, 0, x, y, rr);
            const warm = r() < 0.4;
            grd.addColorStop(0, warm ? 'rgba(138,148,78,0.40)' : 'rgba(52,86,38,0.42)');
            grd.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = grd; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
        }
        // 割草条纹（横向宽带，靠对比度撑住远处的观感）
        for (let i = 0; i < 6; i++) {
            g.fillStyle = i % 2 ? 'rgba(150,168,96,0.10)' : 'rgba(38,64,30,0.10)';
            g.fillRect(0, i * size / 6, size, size / 12);
        }
        // 草叶细纹
        for (let i = 0; i < 6200; i++) {
            const x = r() * size, y = r() * size;
            const k = 0.7 + r() * 0.7;
            g.strokeStyle = `rgba(${Math.round(104 * k)},${Math.round(136 * k)},${Math.round(66 * k)},0.55)`;
            g.lineWidth = 1;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 3); g.stroke();
        }
        // 零星小野花 / 落叶
        for (let i = 0; i < 30; i++) {
            const x = r() * size, y = r() * size;
            g.fillStyle = r() < 0.5 ? 'rgba(240,234,172,0.7)' : 'rgba(214,164,98,0.6)';
            g.beginPath(); g.arc(x, y, 1 + r() * 1.6, 0, TAU); g.fill();
        }
        grain(g, size, size, 1800, 0.06, 5);
        return c;
    }

    function drawPaving(size = 256) {
        const c = cv(size, size), g = c.getContext('2d');
        const r = rngOf(55);
        g.fillStyle = '#b6ad99'; g.fillRect(0, 0, size, size);
        const n = 4, s = size / n;
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                g.fillStyle = shade('#bdb4a0', 0.9 + r() * 0.2);
                g.fillRect(ix * s + 1.5, iy * s + 1.5, s - 3, s - 3);
            }
        }
        // 拼缝
        g.strokeStyle = 'rgba(120,114,100,0.55)'; g.lineWidth = 2;
        for (let i = 0; i <= n; i++) {
            g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, size); g.stroke();
            g.beginPath(); g.moveTo(0, i * s); g.lineTo(size, i * s); g.stroke();
        }
        // 水渍 / 青苔
        for (let i = 0; i < 14; i++) {
            const x = r() * size, y = r() * size, rr = 6 + r() * 22;
            const grd = g.createRadialGradient(x, y, 0, x, y, rr);
            grd.addColorStop(0, r() < 0.4 ? 'rgba(96,110,70,0.20)' : 'rgba(80,78,70,0.18)');
            grd.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = grd; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
        }
        grain(g, size, size, 2200, 0.07, 9);
        return c;
    }

    function drawAsphalt(size = 512) {
        const c = cv(size, size), g = c.getContext('2d');
        const r = rngOf(77);
        g.fillStyle = '#53565b'; g.fillRect(0, 0, size, size);
        // 大块深浅（补丁 / 修补痕迹）
        for (let i = 0; i < 26; i++) {
            const x = r() * size, y = r() * size, rr = 20 + r() * 120;
            const grd = g.createRadialGradient(x, y, 0, x, y, rr);
            grd.addColorStop(0, r() < 0.5 ? 'rgba(104,106,111,0.22)' : 'rgba(52,54,58,0.26)');
            grd.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = grd; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
        }
        // 骨料：细到 1px，密度拉高，远看是"砂面"而不是"色块"
        for (let i = 0; i < 16000; i++) {
            const x = r() * size, y = r() * size;
            const k = 0.55 + r() * 1.0;
            g.fillStyle = `rgba(${Math.round(132 * k)},${Math.round(134 * k)},${Math.round(139 * k)},${0.25 + r() * 0.4})`;
            g.fillRect(x, y, 1 + r() * 1.4, 1 + r() * 1.4);
        }
        // 轮迹：两道被车轮磨亮的带子（沿 V 方向拉通，贴图在路面上会被拉长）
        for (const bx of [0.28, 0.62]) {
            const grd = g.createLinearGradient(size * bx - 26, 0, size * bx + 26, 0);
            grd.addColorStop(0, 'rgba(150,152,158,0)');
            grd.addColorStop(0.5, 'rgba(150,152,158,0.13)');
            grd.addColorStop(1, 'rgba(150,152,158,0)');
            g.fillStyle = grd; g.fillRect(size * bx - 26, 0, 52, size);
        }
        // 沥青灌缝：几条长直缝 + 细裂纹
        g.strokeStyle = 'rgba(30,32,36,0.65)'; g.lineWidth = 2.2;
        for (let i = 0; i < 3; i++) {
            const y0 = r() * size;
            g.beginPath(); g.moveTo(0, y0);
            for (let x = 0; x <= size; x += 32) g.lineTo(x, y0 + (r() - 0.5) * 5);
            g.stroke();
        }
        g.strokeStyle = 'rgba(40,42,46,0.5)'; g.lineWidth = 1.1;
        for (let i = 0; i < 7; i++) {
            let x = r() * size, y = r() * size;
            g.beginPath(); g.moveTo(x, y);
            for (let k = 0; k < 9; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); }
            g.stroke();
        }
        return c;
    }

    function drawWalk(size = 256) {
        const c = cv(size, size), g = c.getContext('2d');
        const r = rngOf(31);
        g.fillStyle = '#b3ab97'; g.fillRect(0, 0, size, size);
        const rows = 4, cols = 2;
        const h = size / rows, w = size / cols;
        for (let iy = 0; iy < rows; iy++) {
            for (let ix = 0; ix < cols; ix++) {
                g.fillStyle = shade('#b9b19d', 0.92 + r() * 0.16);
                g.fillRect(ix * w + 1, iy * h + 1, w - 2, h - 2);
            }
        }
        g.strokeStyle = 'rgba(126,120,106,0.5)'; g.lineWidth = 1.6;
        for (let i = 0; i <= rows; i++) { g.beginPath(); g.moveTo(0, i * h); g.lineTo(size, i * h); g.stroke(); }
        for (let i = 0; i <= cols; i++) { g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w, size); g.stroke(); }
        grain(g, size, size, 2400, 0.08, 3);
        return c;
    }

    function drawRoofTile(size = 256) {
        const c = cv(size, size), g = c.getContext('2d');
        const r = rngOf(63);
        g.fillStyle = '#565d66'; g.fillRect(0, 0, size, size);
        // 筒瓦：一排排半圆
        const rows = 10, cols = 14;
        const h = size / rows, w = size / cols;
        for (let iy = 0; iy < rows; iy++) {
            for (let ix = 0; ix < cols; ix++) {
                const k = 0.85 + r() * 0.3;
                g.fillStyle = shade('#6a727c', k);
                g.fillRect(ix * w, iy * h, w - 0.5, h - 1);
                g.fillStyle = 'rgba(255,255,255,0.09)';
                g.fillRect(ix * w, iy * h, w - 0.5, 1.2);
            }
            g.fillStyle = 'rgba(28,30,36,0.5)';
            g.fillRect(0, iy * h + h - 2, size, 2);
        }
        // 苔痕
        for (let i = 0; i < 22; i++) {
            const x = r() * size, y = r() * size, rr = 4 + r() * 14;
            const grd = g.createRadialGradient(x, y, 0, x, y, rr);
            grd.addColorStop(0, 'rgba(92,104,72,0.22)');
            grd.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = grd; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
        }
        grain(g, size, size, 1600, 0.06, 11);
        return c;
    }

    // 水面法线：两层正弦叠加 + 细碎波纹（用于 normalMap，不能带颜色）
    function drawWaterNormal(size = 256) {
        const c = cv(size, size), g = c.getContext('2d');
        const img = g.createImageData(size, size);
        const r = rngOf(17);
        const noise = new Float32Array(size * size);
        for (let i = 0; i < noise.length; i++) noise[i] = r();
        // 简单平滑
        const sm = new Float32Array(size * size);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let s = 0, n = 0;
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        s += noise[((y + dy + size) % size) * size + ((x + dx + size) % size)];
                        n++;
                    }
                }
                sm[y * size + x] = s / n;
            }
        }
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const u = x / size, v = y / size;
                const w1 = Math.sin((u * 4 + v * 1.5) * TAU) * 0.5;
                const w2 = Math.sin((u * -2.2 + v * 5.5) * TAU) * 0.35;
                const w3 = (sm[y * size + x] - 0.5) * 1.4;
                const dx = (w1 + w2 * 0.6 + w3) * 0.5;
                const dz = (w2 - w1 * 0.4 + w3 * 0.8) * 0.5;
                const nx = clamp(0.5 + dx * 0.5, 0, 1);
                const nz = clamp(0.5 + dz * 0.5, 0, 1);
                const i = (y * size + x) * 4;
                img.data[i] = nx * 255;
                img.data[i + 1] = nz * 255;
                img.data[i + 2] = 255;
                img.data[i + 3] = 255;
            }
        }
        g.putImageData(img, 0, 0);
        return c;
    }

    // 匾额 / 标识牌：黑底金字的传统匾
    function drawPlaque(text, { w = 512, h = 160, bg = '#231a16', fg = '#e8c76a', border = '#7a5a2e' } = {}) {
        const c = cv(w, h), g = c.getContext('2d');
        g.fillStyle = bg; g.fillRect(0, 0, w, h);
        g.strokeStyle = border; g.lineWidth = 8;
        g.strokeRect(4, 4, w - 8, h - 8);
        g.fillStyle = fg;
        g.font = `bold ${Math.round(h * 0.56)}px "Songti SC","STSong","SimSun","Noto Serif CJK SC",serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(text, w / 2, h / 2 + h * 0.03);
        grain(g, w, h, 900, 0.07, 41);
        return c;
    }

    // 全息广告：发光文字 + 扫描线（city 用）
    function drawHolo(text, hue, { w = 512, h = 256 } = {}) {
        const c = cv(w, h), g = c.getContext('2d');
        g.clearRect(0, 0, w, h);
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, `hsla(${hue},100%,70%,0.05)`);
        grad.addColorStop(0.5, `hsla(${hue},100%,62%,0.20)`);
        grad.addColorStop(1, `hsla(${hue},100%,70%,0.05)`);
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        g.strokeStyle = `hsla(${hue},100%,72%,0.85)`; g.lineWidth = 3;
        g.strokeRect(10, 10, w - 20, h - 20);
        g.fillStyle = `hsla(${hue},100%,86%,0.95)`;
        g.font = `bold ${Math.round(h * 0.34)}px "PingFang SC","Microsoft YaHei",sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.shadowColor = `hsla(${hue},100%,60%,1)`; g.shadowBlur = 24;
        g.fillText(text, w / 2, h * 0.46);
        g.shadowBlur = 0;
        // 扫描线
        for (let y = 0; y < h; y += 4) {
            g.fillStyle = 'rgba(0,0,0,0.22)';
            g.fillRect(0, y, w, 1.4);
        }
        // 数据条
        const r = rngOf(hue * 13);
        for (let i = 0; i < 26; i++) {
            g.fillStyle = `hsla(${hue + r() * 40},100%,70%,${0.15 + r() * 0.5})`;
            g.fillRect(18 + r() * (w - 40), h * 0.72 + r() * h * 0.2, 6 + r() * 40, 3);
        }
        return c;
    }

    // 世界坐标噪声注入：贴图只有 8m 一个循环，远处一模糊就变成「一整块纯色」。
    // 用低频 value-noise 按世界坐标打碎，草地/树冠/墙面才不会看起来像塑料板。
    const NOISE_GLSL = `
        varying vec3 vArtP;
        float artH(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        varying float vArtNy;
        float artV(vec2 p){
            vec2 i = floor(p), f = fract(p);
            f = f*f*(3.0-2.0*f);
            return mix(mix(artH(i), artH(i+vec2(1.0,0.0)), f.x),
                       mix(artH(i+vec2(0.0,1.0)), artH(i+vec2(1.0,1.0)), f.x), f.y);
        }`;
    function injectNoise(material, { scale = 0.08, scale2 = 0.3, amp = 0.34, tint = null } = {}) {
        material.onBeforeCompile = (sh) => {
            // 注意：flatShading 的材质没有 vNormal（three 在 FLAT_SHADED 下不声明它），
            // 所以朝下的暗部只能自己在顶点阶段算好再传下去。
            sh.vertexShader = sh.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vArtP;\nvarying float vArtNy;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArtP = (modelMatrix * vec4(transformed,1.0)).xyz;\nvArtNy = objectNormal.y;');
            sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', '#include <common>\n' + NOISE_GLSL)
                .replace('#include <color_fragment>', `#include <color_fragment>
                    float artM = artV(vArtP.xz*${scale.toFixed(4)}) * 0.62
                               + artV(vArtP.xz*${scale2.toFixed(4)}) * 0.38;
                    diffuseColor.rgb *= ${(1 - amp / 2).toFixed(3)} + ${amp.toFixed(3)}*artM;
                    diffuseColor.rgb *= mix(0.58, 1.06, clamp(vArtNy * 0.5 + 0.5, 0.0, 1.0));
                    ${tint ? `diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(${tint}), artM*0.55);` : ''}`);
        };
        material.needsUpdate = true;
        return material;
    }
    // -----------------------------------------------------------------
    //  3. 材质库（全局共享，一次创建）
    // -----------------------------------------------------------------
    const MAT = {};
    const TEX = {};
    function buildMaterials() {
        const F = {
            brick: drawFacade(FACADE_SPECS.brick),
            graybrick: drawFacade(FACADE_SPECS.graybrick),
            stone: drawFacade(FACADE_SPECS.stone),
            pale: drawFacade(FACADE_SPECS.pale),
        };
        TEX.facade = {
            brick: tex(F.brick, { aniso: 16 }),
            graybrick: tex(F.graybrick, { aniso: 16 }),
            stone: tex(F.stone, { aniso: 16 }),
            pale: tex(F.pale, { aniso: 16 }),
        };
        TEX.lawn = tex(drawLawn(), { aniso: 8 });
        TEX.paving = tex(drawPaving(), { aniso: 8 });
        TEX.walk = tex(drawWalk(), { aniso: 8 });
        TEX.asphalt = tex(drawAsphalt(512), { aniso: 8 });
        TEX.asphalt.repeat.set(1.6, 1.6);   // 512 的贴图再铺密一点，骨料才看得出是砂面
        TEX.roof = tex(drawRoofTile(), { aniso: 8 });
        TEX.waterN = tex(drawWaterNormal(), { aniso: 4, srgb: false });
        TEX.leaf = tex(drawLeaf(), { aniso: 4 });
        TEX.fence = tex(drawFence(), { aniso: 4 });

        const std = (o) => shared(new THREE.MeshStandardMaterial(o));
        MAT.wall = {
            brick: std({ map: TEX.facade.brick, roughness: 0.94, metalness: 0 }),
            graybrick: std({ map: TEX.facade.graybrick, roughness: 0.95, metalness: 0 }),
            stone: std({ map: TEX.facade.stone, roughness: 0.88, metalness: 0 }),
            pale: std({ map: TEX.facade.pale, roughness: 0.94, metalness: 0 }),
        };
        MAT.roof = std({ map: TEX.roof, roughness: 0.92, metalness: 0.04 });
        MAT.roofDark = std({ color: 0x3c4147, roughness: 0.9 });
        MAT.stone = std({ color: 0xc8c2b3, roughness: 0.92 });
        MAT.stoneDark = std({ color: 0x8f8b81, roughness: 0.95 });
        MAT.marble = std({ color: 0xdcd8cd, roughness: 0.55, metalness: 0.05 });
        MAT.red = std({ color: 0xa63a2c, roughness: 0.62, metalness: 0.05 });
        MAT.redDark = std({ color: 0x8a2f24, roughness: 0.7 });
        MAT.wood = std({ color: 0x6b4a33, roughness: 0.85 });
        MAT.woodLight = std({ color: 0x9a7a52, roughness: 0.85 });
        MAT.glass = std({ color: 0x8fb4c8, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.72 });
        MAT.metal = std({ color: 0x4a4f55, roughness: 0.42, metalness: 0.7 });
        MAT.metalDark = std({ color: 0x2c3036, roughness: 0.5, metalness: 0.6 });
        MAT.gold = std({ color: 0xc8a23a, roughness: 0.32, metalness: 0.85 });
        MAT.white = std({ color: 0xece7db, roughness: 0.85 });
        MAT.black = std({ color: 0x2a2724, roughness: 0.8 });
        MAT.bronze = std({ color: 0x7a6540, roughness: 0.45, metalness: 0.6 });
        MAT.pagodaBody = std({ color: 0xcfc9ba, roughness: 0.92 });
        MAT.pagodaEave = std({ color: 0x6e7278, roughness: 0.9 });
        MAT.lampWarm = std({ color: 0xf0d9a8, emissive: 0xffb648, emissiveIntensity: 0.55, roughness: 0.7 });
        // 叶卡材质：双面 + alphaTest（不用 transparent，避免排序问题与过度绘制）
        // 注意贴图必须在这里就建好——放到后面建，map 会是 undefined，alphaTest 就不裁边了
        if (!TEX.leafMask) TEX.leafMask = tex(drawLeafMask(128), { aniso: 8 });
        for (const [k, c] of [['leafCardA', 0x4f7d34], ['leafCardB', 0x6f9438], ['leafCardC', 0x37633a], ['leafCardG', 0xa8b23c]]) {
            MAT[k] = std({ map: TEX.leafMask, color: c, roughness: 0.9, side: THREE.DoubleSide, alphaTest: 0.42 });
        }
        MAT.leafA = std({ color: 0x4e7a34, roughness: 0.92, flatShading: true });
        MAT.leafB = std({ color: 0x6f8f38, roughness: 0.92, flatShading: true });
        MAT.leafC = std({ color: 0x2f5c33, roughness: 0.92, flatShading: true });
        MAT.leafGinkgo = std({ color: 0xa8b23c, roughness: 0.92, flatShading: true });
        MAT.bark = std({ color: 0x4c3a2a, roughness: 0.95 });
        MAT.flowerRed = std({ color: 0xc2453c, roughness: 0.85, flatShading: true });
        MAT.flowerPink = std({ color: 0xd9738a, roughness: 0.85, flatShading: true });
        MAT.flowerYellow = std({ color: 0xd8b23c, roughness: 0.85, flatShading: true });
        MAT.grass = std({ color: 0x6d8c46, roughness: 0.95, flatShading: true });
        // 球场 / 围网 / 修剪草坪 / 静水面
        MAT.court = std({ color: 0x3f6f5c, roughness: 0.95 });
        MAT.fence = std({ map: TEX.fence, color: 0xffffff, roughness: 0.7, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, depthWrite: false });
        MAT.fence.map.repeat.set(10, 1.6);
        MAT.fence.map.needsUpdate = true;
        // 落叶必须和金币明显区分：金币是亮金立体圆盘，落叶是暗橙褐的小薄片
        MAT.leafDecal = std({ map: TEX.leaf, color: 0x9c6b38, roughness: 0.95, transparent: true, alphaTest: 0.45, side: THREE.DoubleSide, depthWrite: false });
        MAT.lawnFine = std({ map: TEX.lawn.clone(), color: 0xffffff, roughness: 1.0 });
        MAT.lawnFine.map.repeat.set(4, 3);
        MAT.lawnFine.map.needsUpdate = true;
        MAT.waterFlat = std({ color: 0x2f646d, roughness: 0.08, metalness: 0.15 });
        MAT.grayWall = std({ color: 0x8a8b83, roughness: 0.95 });
        MAT.hedge = std({ color: 0x3f6634, roughness: 0.98, flatShading: true });
        // 城市科幻
        MAT.cityBeam = std({ color: 0x1b2230, roughness: 0.45, metalness: 0.7 });
        MAT.cityTower = std({ color: 0x232a38, roughness: 0.6, metalness: 0.5 });
        MAT.neonCyan = shared(new THREE.MeshBasicMaterial({ color: 0x36e6ff }));
        MAT.neonPink = shared(new THREE.MeshBasicMaterial({ color: 0xff3ea5 }));

        // 水面：法线滚动 + 菲涅尔提亮（用 onBeforeCompile 注入，保持 PBR 光照）
        MAT.water = shared(new THREE.MeshStandardMaterial({
            color: 0x2c5f68, roughness: 0.12, metalness: 0.0,
            normalMap: TEX.waterN,
        }));
        MAT.water.normalScale.set(0.45, 0.45);
        MAT.water.userData.flow = true;

        // 树冠：UV 是常量，只能靠世界坐标噪声打碎「一个绿球」的观感
        for (const k of ['leafA', 'leafB', 'leafC', 'leafGinkgo', 'grass', 'lawnFine']) {
            injectNoise(MAT[k], { scale: 0.28, scale2: 0.9, amp: 0.46, tint: '1.12,1.04,0.84' });
        }
    }

    // -----------------------------------------------------------------
    //  4. 几何工具
    // -----------------------------------------------------------------
    const _m4 = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _e = new THREE.Euler();

    function xform(geo, x, y, z, ry = 0, rx = 0, rz = 0, s = 1) {
        _e.set(rx, ry, rz, 'YXZ');
        _q.setFromEuler(_e);
        _m4.compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(s, s, s));
        geo.applyMatrix4(_m4);
        return geo;
    }

    // 收集器：按材质分组，最后一次合并，静态摆件 = 每种材质 1 个 drawcall
    function newBag() { return new Map(); }
    function push(bag, mat, geo) {
        // mergeGeometries 要求「要么全带索引、要么全不带」——Box/Cylinder 带索引，
        // Icosahedron / 手搓屋顶不带，混在一起会整批合并失败（退回几十个 drawcall）。
        // 统一补一条顺序索引，代价只是索引缓冲，顶点数不变。
        if (!geo.index) {
            const n = geo.attributes.position.count;
            const idx = new Uint32Array(n);
            for (let i = 0; i < n; i++) idx[i] = i;
            geo.setIndex(new THREE.BufferAttribute(idx, 1));
        }
        if (!bag.has(mat)) bag.set(mat, []);
        bag.get(mat).push(geo);
        return geo;
    }
    function bagToGroup(bag, { cast = false, receive = true, name = '' } = {}) {
        const g = new THREE.Group();
        g.name = name;
        for (const [mat, list] of bag) {
            if (!list.length) continue;
            let merged = null;
            try {
                merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
            } catch (e) { merged = null; }
            if (!merged) {
                for (const geo of list) {
                    const m = new THREE.Mesh(geo, mat);
                    m.castShadow = cast; m.receiveShadow = receive;
                    g.add(m);
                }
                continue;
            }
            const m = new THREE.Mesh(merged, mat);
            m.castShadow = cast; m.receiveShadow = receive;
            g.add(m);
            if (list.length > 1) for (const geo of list) geo.dispose();
        }
        return g;
    }

    function box(bag, mat, w, h, d, x, y, z, ry = 0) {
        return push(bag, mat, xform(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, ry));
    }
    function cyl(bag, mat, rt, rb, h, seg, x, y, z, ry = 0, rx = 0) {
        return push(bag, mat, xform(new THREE.CylinderGeometry(rt, rb, h, seg), x, y + h / 2, z, ry, rx));
    }

    // 中式坡屋顶（庑殿）：四坡 + 翘角 + 正脊
    function roofGeo(w, d, h, { lift = 0.34, ridge = 0.3, overhang = 0.6 } = {}) {
        const W = w / 2 + overhang, D = d / 2 + overhang;
        const R = w * ridge * 0.5;
        const P = [
            [-W, lift, D], [W, lift, D], [W, lift, -D], [-W, lift, -D], // 0..3 四角
            [0, 0, D], [W, 0, 0], [0, 0, -D], [-W, 0, 0],               // 4..7 檐中
            [-R, h, 0], [R, h, 0],                                       // 8..9 脊
        ];
        const faces = [
            [0, 4, 1, 9, 8],   // 前坡
            [2, 6, 3, 8, 9],   // 后坡
            [1, 5, 2, 9],      // 右坡
            [3, 7, 0, 8],      // 左坡
        ];
        const pos = [], uv = [];
        for (const f of faces) {
            for (let i = 1; i < f.length - 1; i++) {
                for (const k of [f[0], f[i], f[i + 1]]) {
                    const p = P[k];
                    pos.push(p[0], p[1], p[2]);
                    uv.push(p[0] * 0.42, p[2] * 0.42);
                }
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.computeVertexNormals();
        return geo;
    }

    // 檐下板（让屋顶有厚度）
    function eaveBoard(bag, mat, w, d, y, t = 0.18, over = 0.6) {
        const W = w + over * 2, D = d + over * 2;
        box(bag, mat, W, t, 0.16, 0, y - t, D / 2);
        box(bag, mat, W, t, 0.16, 0, y - t, -D / 2);
        box(bag, mat, 0.16, t, D, W / 2, y - t, 0);
        box(bag, mat, 0.16, t, D, -W / 2, y - t, 0);
    }

    function chineseRoof(bag, w, d, y, h, mat = MAT.roof) {
        const g = roofGeo(w, d, h);
        g.translate(0, y, 0);
        push(bag, mat, g);
        eaveBoard(bag, MAT.roofDark, w, d, y + 0.02, 0.2, 0.62);
        // 正脊
        box(bag, MAT.roofDark, w * 0.32, 0.28, 0.34, 0, y + h - 0.05, 0);
        // 两端脊兽（小方块，远看是轮廓）
        for (const s of [-1, 1]) {
            box(bag, MAT.roofDark, 0.34, 0.5, 0.34, s * w * 0.16, y + h + 0.05, 0);
        }
    }

    // 八角密檐塔（博雅塔）
    function pagodaTower(bag, H, R0) {
        const tiers = 13;
        const bodyTop = H * 0.87;
        // 须弥座
        push(bag, MAT.stoneDark, xform(new THREE.CylinderGeometry(R0 * 1.06, R0 * 1.2, 1.5, 8), 0, 0.75, 0));
        let y = 1.5;
        const tierH = (bodyTop - y) / tiers;
        for (let i = 0; i < tiers; i++) {
            const t = i / (tiers - 1);
            const r = R0 * (1 - 0.62 * t);
            // 塔身
            push(bag, MAT.pagodaBody, xform(new THREE.CylinderGeometry(r * 0.94, r, tierH * 0.78, 8), 0, y + tierH * 0.39, 0));
            // 檐
            push(bag, MAT.pagodaEave, xform(new THREE.CylinderGeometry(r * 1.30, r * 1.02, tierH * 0.15, 8), 0, y + tierH * 0.9, 0));
            y += tierH;
        }
        // 塔刹
        push(bag, MAT.bronze, xform(new THREE.CylinderGeometry(0.05, 0.34, H - y, 8), 0, y + (H - y) / 2, 0));
        for (let i = 0; i < 4; i++) {
            push(bag, MAT.gold, xform(new THREE.TorusGeometry(0.32 - i * 0.05, 0.045, 5, 10), 0, y + 0.4 + i * 0.5, 0, 0, Math.PI / 2));
        }
        push(bag, MAT.gold, xform(new THREE.SphereGeometry(0.26, 8, 6), 0, H + 0.2, 0));
    }

    // 石狮（极简但有辨识度）
    function stoneLion(bag, x, z, ry) {
        const B = new THREE.Group();
        const g = newBag();
        box(g, MAT.marble, 1.1, 0.55, 1.6, 0, 0, 0);
        box(g, MAT.marble, 0.78, 0.9, 0.9, 0, 0.55, -0.15);
        push(g, MAT.marble, xform(new THREE.SphereGeometry(0.42, 8, 6), 0, 1.62, -0.42));
        box(g, MAT.marble, 0.3, 0.34, 0.26, 0, 1.72, -0.78);       // 吻部
        for (const s of [-1, 1]) {
            box(g, MAT.marble, 0.16, 0.62, 0.16, s * 0.26, 0.55, 0.42);
            box(g, MAT.marble, 0.16, 0.5, 0.16, s * 0.3, 0.0, -0.1);
        }
        // 绣球
        push(g, MAT.marble, xform(new THREE.SphereGeometry(0.2, 8, 6), 0.36, 0.22, 0.55));
        const merged = bagToGroup(g, { cast: true, receive: true, name: 'lion' });
        merged.position.set(x, 0, z);
        merged.rotation.y = ry;
        return merged;
    }

    // 华表
    function huabiao(bag, x, z, h = 8) {
        push(bag, MAT.marble, xform(new THREE.CylinderGeometry(0.55, 0.7, 0.5, 8), x, 0.25, z));
        push(bag, MAT.marble, xform(new THREE.CylinderGeometry(0.26, 0.32, h, 10), x, h / 2, z));
        // 云板
        box(bag, MAT.marble, 2.0, 0.16, 0.42, x, h * 0.72, z);
        // 承露盘 + 蹲兽
        push(bag, MAT.marble, xform(new THREE.CylinderGeometry(0.5, 0.34, 0.22, 8), x, h + 0.1, z));
        box(bag, MAT.marble, 0.34, 0.5, 0.34, x, h + 0.2, z);
    }

    // 六角亭
    function pavilion(bag, x, z, ry, s = 1) {
        const R = 1.9 * s, H = 3.0 * s;
        push(bag, MAT.stone, xform(new THREE.CylinderGeometry(R * 1.18, R * 1.24, 0.34, 6), x, 0.17, z, ry));
        for (let i = 0; i < 6; i++) {
            const a = ry + i * TAU / 6;
            const px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R;
            push(bag, MAT.red, xform(new THREE.CylinderGeometry(0.13 * s, 0.15 * s, H, 8), px, 0.34 + H / 2, pz));
        }
        // 檐枋
        push(bag, MAT.redDark, xform(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.3 * s, 6), x, 0.34 + H, z, ry));
        // 攒尖顶
        push(bag, MAT.roof, xform(new THREE.ConeGeometry(R * 1.45, 1.9 * s, 6), x, 0.34 + H + 1.0 * s, z, ry));
        push(bag, MAT.roofDark, xform(new THREE.CylinderGeometry(R * 1.5, R * 1.42, 0.14, 6), x, 0.34 + H + 0.16, z, ry));
        push(bag, MAT.gold, xform(new THREE.SphereGeometry(0.2 * s, 8, 6), x, 0.34 + H + 2.0 * s, z));
    }

    // 拱桥（石桥）
    function archBridge(bag, x, z, ry, len = 14, w = 3.2) {
        const seg = 7;
        for (let i = 0; i < seg; i++) {
            const t = (i + 0.5) / seg;
            const y = Math.sin(t * Math.PI) * 1.5;
            const ang = Math.cos(t * Math.PI) * -0.5;
            const lx = (t - 0.5) * len;
            const px = x + Math.cos(ry) * lx, pz = z + Math.sin(ry) * lx;
            box(bag, MAT.stone, len / seg + 0.1, 0.34, w, px, y, pz, ry);
            // 栏杆
            for (const s of [-1, 1]) {
                const ox = Math.cos(ry + Math.PI / 2) * s * (w / 2 - 0.12);
                const oz = Math.sin(ry + Math.PI / 2) * s * (w / 2 - 0.12);
                box(bag, MAT.marble, len / seg + 0.06, 0.5, 0.12, px + ox, y + 0.34, pz + oz, ry);
            }
        }
    }

    // 红砖教学楼（沿路的主力建筑）
    function redHall(bag, x, z, ry, { w = 22, d = 13, floors = 3, roof = true } = {}) {
        const H = floors * 3.6;
        // 台基
        box(bag, MAT.stoneDark, w + 1.2, 0.45, d + 1.2, x, -0.28, z, ry);
        // 主体（UV 走世界尺度，窗格不会拉花）
        const body = new THREE.BoxGeometry(w, H, d);
        const uvAttr = body.attributes.uv;
        const posAttr = body.attributes.position;
        for (let i = 0; i < uvAttr.count; i++) {
            const px = posAttr.getX(i), py = posAttr.getY(i), pz = posAttr.getZ(i);
            const ax = Math.abs(px) / (w / 2), az = Math.abs(pz) / (d / 2);
            const u = ax > az ? (pz + d / 2) / 3.8 : (px + w / 2) / 3.8;
            uvAttr.setXY(i, u, (py + H / 2) / 3.6);
        }
        uvAttr.needsUpdate = true;
        push(bag, MAT.wall.brick, xform(body, x, H / 2 + 0.17, z, ry));
        if (roof) {
            const g = roofGeo(w, d, 2.5, { lift: 0.4, ridge: 0.34, overhang: 0.9 });
            g.rotateY(ry);
            g.translate(x, H + 0.2, z);
            push(bag, MAT.roof, g);
            // 檐下板（沿屋身四周一圈，让屋顶有厚度）
            const W2 = w + 1.8, D2 = d + 1.8;
            for (const s of [-1, 1]) {
                box(bag, MAT.roofDark, W2, 0.2, 0.2, x + Math.sin(ry) * s * (D2 / 2), H + 0.1, z + Math.cos(ry) * s * (D2 / 2), ry);
                box(bag, MAT.roofDark, 0.2, 0.2, D2, x + Math.cos(ry) * s * (W2 / 2), H + 0.1, z - Math.sin(ry) * s * (W2 / 2), ry);
            }
            box(bag, MAT.roofDark, w * 0.34, 0.26, 0.3, x, H + 2.52, z, ry);
        }
        // 入口雨棚 + 台阶
        const fx = x + Math.sin(ry) * (d / 2 + 1.2);
        const fz = z + Math.cos(ry) * (d / 2 + 1.2);
        box(bag, MAT.stone, 4.4, 0.28, 2.2, fx, 3.5, fz, ry);
        for (const s of [-1, 1]) {
            box(bag, MAT.red, 0.28, 3.5, 0.28, fx + Math.cos(ry) * s * 1.9, 0.17, fz - Math.sin(ry) * s * 1.9, ry);
        }
        box(bag, MAT.stone, 4.0, 0.18, 1.0, fx + Math.sin(ry) * 0.7, 0.1, fz + Math.cos(ry) * 0.7, ry);
        // 门
        box(bag, MAT.wood, 2.6, 2.4, 0.16, fx - Math.sin(ry) * 0.1, 0.2, fz - Math.cos(ry) * 0.1, ry);
        registerBlocker(x, z, w / 2 + 1.2, d / 2 + 2.2, ry);   // 含入口雨棚
        registerBuilding(x, z, w / 2, d / 2, ry, H);            // 撞楼判定：只算主楼体
    }

    // 现代玻璃楼（医学部 / 城市用）
    function modernHall(bag, x, z, ry, { w = 30, d = 18, h = 24, tint = 0xd9dde0 } = {}) {
        const body = new THREE.BoxGeometry(w, h, d);
        const uv = body.attributes.uv, pos = body.attributes.position;
        for (let i = 0; i < uv.count; i++) {
            const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
            const ax = Math.abs(px) / (w / 2), az = Math.abs(pz) / (d / 2);
            const u = ax > az ? (pz + d / 2) / 3.8 : (px + w / 2) / 3.8;
            uv.setXY(i, u, (py + h / 2) / 3.6);
        }
        uv.needsUpdate = true;
        push(bag, MAT.wall.stone, xform(body, x, h / 2, z, ry));
        // 竖向遮阳板
        for (let i = -2; i <= 2; i++) {
            const ox = Math.cos(ry) * i * (w / 6);
            const oz = -Math.sin(ry) * i * (w / 6);
            box(bag, MAT.white, 0.3, h * 0.9, 0.5, x + ox + Math.sin(ry) * (d / 2 + 0.2), h / 2, z + oz + Math.cos(ry) * (d / 2 + 0.2), ry);
        }
        box(bag, MAT.white, w + 1.6, 1.0, d + 1.6, x, h, z, ry);
        registerBuilding(x, z, w / 2, d / 2, ry, h);            // 撞楼判定：玻璃楼主体
    }

    // 路灯（中式：石座 + 深灰杆 + 暖光灯笼）
    function lampCN(bag, x, z) {
        const y = GY;
        push(bag, MAT.stoneDark, xform(new THREE.CylinderGeometry(0.24, 0.3, 0.4, 8), x, y + 0.2, z));
        push(bag, MAT.metalDark, xform(new THREE.CylinderGeometry(0.075, 0.1, 4.1, 8), x, y + 2.25, z));
        // 灯笼（灯罩压暗一点，别像一颗亮黄球）
        blob(bag, MAT.lampWarm, 0.24, x, y + 4.42, z, 1, 1.25, 1);
        push(bag, MAT.metalDark, xform(new THREE.ConeGeometry(0.3, 0.2, 8), x, y + 4.78, z));
        push(bag, MAT.metalDark, xform(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 8), x, y + 4.22, z));
    }

    // 长椅
    function bench(bag, x, z, ry) {
        const y = GY;
        for (const s of [-1, 1]) {
            box(bag, MAT.metalDark, 0.12, 0.42, 0.5, x + Math.cos(ry) * s * 0.8, y, z - Math.sin(ry) * s * 0.8, ry);
        }
        box(bag, MAT.woodLight, 2.0, 0.1, 0.5, x, y + 0.42, z, ry);
        box(bag, MAT.woodLight, 2.0, 0.42, 0.09, x - Math.sin(ry) * 0.22, y + 0.52, z - Math.cos(ry) * 0.22, ry);
    }

    // 花坛
    function flowerBed(bag, x, z, r = 2.4, kind = 0) {
        const y = GY;
        push(bag, MAT.stone, xform(new THREE.CylinderGeometry(r, r * 1.04, 0.42, 10), x, y + 0.21, z));
        push(bag, MAT.stoneDark, xform(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.06, 10), x, y + 0.44, z));
        const m = [MAT.flowerRed, MAT.flowerYellow, MAT.flowerPink][kind % 3];
        const rng = rngOf(Math.round(x * 7 + z * 13) >>> 0);
        for (let i = 0; i < 6; i++) {
            const a = rng() * TAU, rr = rng() * r * 0.72;
            push(bag, m, xform(new THREE.SphereGeometry(0.24 + rng() * 0.16, 5, 4), x + Math.cos(a) * rr, y + 0.52 + rng() * 0.1, z + Math.sin(a) * rr));
        }
        blob(bag, MAT.grass, r * 0.82, x, y + 0.42, z, 1, 0.42, 1);
    }

    // 自行车棚
    function bikeShelter(bag, x, z, ry) {
        for (const s of [-1, 1]) {
            for (const t of [-1, 1]) {
                box(bag, MAT.metal, 0.12, 2.4, 0.12, x + Math.cos(ry) * s * 3 + Math.sin(ry) * t * 1.6, 0, z - Math.sin(ry) * s * 3 + Math.cos(ry) * t * 1.6, ry);
            }
        }
        box(bag, MAT.metal, 6.6, 0.1, 3.8, x, 2.4, z, ry);
        // 车
        const rng = rngOf(Math.round(x * 3) >>> 0);
        for (let i = 0; i < 4; i++) {
            const ox = (i - 1.5) * 1.1;
            const px = x + Math.cos(ry) * ox, pz = z - Math.sin(ry) * ox;
            for (const s of [-1, 1]) {
                push(bag, MAT.metalDark, xform(new THREE.TorusGeometry(0.3, 0.045, 3, 8), px + Math.cos(ry) * s * 0.42, 0.3, pz - Math.sin(ry) * s * 0.42, ry, 0, 0));
            }
            box(bag, rng() < 0.5 ? MAT.red : MAT.metal, 0.9, 0.06, 0.06, px, 0.62, pz, ry);
        }
    }

    // 公告栏 / 横幅
    function noticeBoard(bag, x, z, ry, text) {
        for (const s of [-1, 1]) box(bag, MAT.metalDark, 0.1, 2.2, 0.1, x + Math.cos(ry) * s * 1.4, 0, z - Math.sin(ry) * s * 1.4, ry);
        box(bag, MAT.wood, 3.0, 1.6, 0.12, x, 0.7, z, ry);
        const t = tex(drawPlaque(text, { w: 384, h: 192, bg: '#f3ece0', fg: '#2c3a52', border: '#8a6a3a' }));
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), shared(new THREE.MeshBasicMaterial({ map: t })));
        m.position.set(x, 1.5, z + 0.07);
        m.rotation.y = ry;
        // 平面 mesh 单独挂，不能进合并（材质不同且需要正面朝向）
        BAG_EXTRA.push(m);
    }
    const BAG_EXTRA = [];

    // 落叶（带 alpha 的叶片贴图，比纯色小方块自然）
    function drawLeaf(size = 64) {
        const c = cv(size, size), g = c.getContext('2d');
        g.clearRect(0, 0, size, size);
        g.translate(size / 2, size / 2);
        g.rotate(0.4);
        const grd = g.createLinearGradient(-size * 0.3, -size * 0.3, size * 0.3, size * 0.3);
        grd.addColorStop(0, '#8a5a2e');
        grd.addColorStop(0.5, '#a06a35');
        grd.addColorStop(1, '#6f4724');
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(0, 0, size * 0.34, size * 0.20, 0, 0, TAU);
        g.fill();
        g.strokeStyle = 'rgba(120,92,30,0.75)'; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(-size * 0.3, 0); g.lineTo(size * 0.3, 0); g.stroke();
        return c;
    }
    // 铁丝网（透明，围球场用）
    function drawFence(size = 128) {
        const c = cv(size, size), g = c.getContext('2d');
        g.clearRect(0, 0, size, size);
        g.strokeStyle = 'rgba(160,175,175,0.85)'; g.lineWidth = 1.6;
        for (let i = -size; i < size * 2; i += 12) {
            g.beginPath(); g.moveTo(i, 0); g.lineTo(i + size, size); g.stroke();
            g.beginPath(); g.moveTo(i, size); g.lineTo(i + size, 0); g.stroke();
        }
        return c;
    }

    // 叶簇卡：一张卡上画 5 片叶子（一把小枝），叶与叶之间留透明缝隙。
    // 这样"密"和"看得清叶子"能同时成立 —— 既不是绿球，也不用堆几万张单叶。
    function drawLeafMask(size = 128) {
        const c = cv(size, size), g = c.getContext('2d');
        g.clearRect(0, 0, size, size);
        const leaf = (cx, cy, len, wid, ang, tint) => {
            g.save();
            g.translate(cx, cy);
            g.rotate(ang);
            g.beginPath();
            g.moveTo(0, -len * 0.5);
            g.bezierCurveTo(wid, -len * 0.2, wid * 0.86, len * 0.28, 0, len * 0.5);
            g.bezierCurveTo(-wid * 0.86, len * 0.28, -wid, -len * 0.2, 0, -len * 0.5);
            g.fillStyle = tint;
            g.fill();
            g.strokeStyle = 'rgba(190,210,170,0.55)';
            g.lineWidth = size * 0.008;
            g.beginPath(); g.moveTo(0, -len * 0.42); g.lineTo(0, len * 0.42); g.stroke();
            for (let i = 0; i < 3; i++) {
                const yy = -len * 0.22 + i * len * 0.22;
                g.beginPath(); g.moveTo(0, yy); g.lineTo(wid * 0.55, yy + len * 0.12); g.stroke();
                g.beginPath(); g.moveTo(0, yy); g.lineTo(-wid * 0.55, yy + len * 0.12); g.stroke();
            }
            g.restore();
        };
        // 5 片：中间一片正立，四周各一片斜出（深色打底，浅色提亮，模拟受光）
        leaf(size * 0.50, size * 0.48, size * 0.72, size * 0.20, 0, '#e9f2d8');
        leaf(size * 0.31, size * 0.56, size * 0.60, size * 0.17, -0.85, '#cfe0b8');
        leaf(size * 0.69, size * 0.56, size * 0.60, size * 0.17, 0.85, '#cfe0b8');
        leaf(size * 0.40, size * 0.70, size * 0.46, size * 0.14, -1.55, '#b9cf9e');
        leaf(size * 0.60, size * 0.70, size * 0.46, size * 0.14, 1.55, '#b9cf9e');
        return c;
    }

    // 一段树枝：从 (x0,y0,z0) 伸到 (x1,y1,z1)，用圆柱 + 四元数摆正方向
    const _up = new THREE.Vector3(0, 1, 0);
    function limb(bag, mat, x0, y0, z0, x1, y1, z1, r0, r1, seg = 5) {
        const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
        const len = Math.hypot(dx, dy, dz);
        if (len < 0.01) return;
        const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true);
        g.translate(0, len / 2, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(_up, new THREE.Vector3(dx, dy, dz).normalize());
        g.applyQuaternion(q);
        g.translate(x0, y0, z0);
        push(bag, mat, g);
    }

    // 一簇叶子：在椭球【体积内】随机撒叶片卡（不只是外壳），朝向也随机化，
    // 否则从正面看过去全是「侧着的薄片」，树冠会显得空
    function leafCloud(bag, mat, x, y, z, rx, ry, rz, n, rng, droop = 0) {
        for (let i = 0; i < n; i++) {
            // 体积内均匀：半径用立方根分布，才不会都挤在外壳
            const u = rng() * 2 - 1, a = rng() * TAU;
            const rr = Math.cbrt(rng());
            const rxz = Math.sqrt(Math.max(0, 1 - u * u));
            const px = x + Math.cos(a) * rxz * rx * rr;
            const py = y + u * ry * rr - droop * (0.4 + rng() * 0.6);
            const pz = z + Math.sin(a) * rxz * rz * rr;
            const size = 0.78 + rng() * 0.42;
            const g = new THREE.PlaneGeometry(size, size * 0.72);
            g.rotateZ(rng() * TAU);
            g.rotateY(rng() * TAU);                 // 朝向完全随机：任何角度看都有"面"
            g.rotateX((rng() - 0.5) * 1.6);
            g.translate(px, py, pz);
            push(bag, mat, g);
        }
    }

    function leafDecal(bag, x, z, s, ry) {
        const g = new THREE.PlaneGeometry(s, s * 0.72);
        g.rotateX(-Math.PI / 2);
        g.rotateY(ry);
        g.translate(x, 0.04, z);
        push(bag, MAT.leafDecal, g);
    }

    // -----------------------------------------------------------------
    //  5. 校园底板材质升级
    // -----------------------------------------------------------------
    // 把整块树冠网格的顶点按位置哈希揉一下：正二十面体太规整，
    // 一眼就是「绿球插在棍子上」。位移只跟顶点坐标有关，所以共享位置不会裂开。
    function crumpleTree(geo) {
        if (!geo || !geo.attributes || !geo.attributes.position) return;
        const pos = geo.attributes.position;
        const nrm = geo.attributes.normal;
        if (!nrm) return;
        const N = pos.count;
        for (let i = 0; i < N; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            // 低频 value-noise（手工三轴哈希）
            const h = (a, b, c) => {
                const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
                return v - Math.floor(v);
            };
            const q = 1.6;
            const fx = Math.floor(x / q), fy = Math.floor(y / q), fz = Math.floor(z / q);
            const n1 = h(fx, fy, fz);
            const n2 = h(fx + 3, fy + 7, fz + 11);
            const amp = (n1 * 0.62 + n2 * 0.38 - 0.5) * 0.62;
            // 树干（细、靠近树心）少动一点
            const k = Math.min(1, Math.hypot(x - Math.round(x), z - Math.round(z)) * 0.0 + 1);
            pos.setXYZ(i, x + nrm.getX(i) * amp * k, y + nrm.getY(i) * amp * k * 0.8, z + nrm.getZ(i) * amp * k);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
    }

    // 水面「波光粼粼 + 涟漪」着色：校园湖 / 护城河 / 湖畔湖面共用同一段注入
    function applyWaterShine(mat, opt) {
        if (!mat || mat.userData.waterShine) return mat;
        mat.userData.waterShine = true;
        const ripAmp = opt && opt.ripple != null ? opt.ripple : 1.0;
        const glintAmp = opt && opt.glint != null ? opt.glint : 1.0;
        const ripScale = opt && opt.scale != null ? opt.scale : 1.0;
        mat.onBeforeCompile = (sh) => {
            sh.uniforms.uWaterT = WATER_UNIFORM;
            sh.uniforms.uRipAmp = { value: ripAmp };
            sh.uniforms.uGlintAmp = { value: glintAmp };
            sh.uniforms.uRipScale = { value: ripScale };
            sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            sh.fragmentShader = 'varying vec3 vWPos;\nuniform float uWaterT;\nuniform float uRipAmp;\nuniform float uGlintAmp;\nuniform float uRipScale;\n' + sh.fragmentShader
                .replace('#include <normal_fragment_maps>',
                `#include <normal_fragment_maps>
                 {
                    // 视线越斜，水面越像镜子——这是「水」最关键的一条
                    vec3 Vv = normalize(vViewPosition);
                    float fres = pow(1.0 - clamp(dot(normal, Vv), 0.0, 1.0), 2.4);
                    vec3 skyC = vec3(0.42, 0.60, 0.76);
                    diffuseColor.rgb = mix(diffuseColor.rgb, skyC, clamp(fres, 0.0, 0.55));
                 }`)
                .replace('#include <emissivemap_fragment>',
                `#include <emissivemap_fragment>
                 {
                    // ---- 波光粼粼 + 落叶涟漪（全在片元里算，0 额外 drawcall）----
                    vec2 wp = vWPos.xz;
                    float tt = uWaterT;
                    // 用斜向波矢交叉，避免出现横平竖直的"扫描线"
                    float s1 = sin(dot(wp, vec2(2.31, 1.73)) + tt * 1.7) * sin(dot(wp, vec2(-1.87, 2.41)) - tt * 1.15);
                    float s2 = sin(dot(wp, vec2(4.70, -3.10)) - tt * 2.1) * sin(dot(wp, vec2(3.30, 4.90)) + tt * 1.6);
                    float glint = pow(max(0.0, s1 * 0.6 + s2 * 0.4), 10.0);
                    // 涟漪：两套错开的网格，每格里随机一个落点，环向外扩再淡出
                    float rip = 0.0;
                    for (int k = 0; k < 2; k++) {
                        float sc = ((k == 0) ? 6.5 : 11.0) * uRipScale;
                        vec2 cell = floor(wp / sc);
                        float hh = fract(sin(dot(cell, vec2(12.9898, 78.233)) + float(k) * 3.71) * 43758.5453);
                        float ph = fract(tt * (0.24 + float(k) * 0.09) + hh);
                        vec2 c0 = (cell + 0.5 + 0.28 * vec2(sin(hh * 31.0), cos(hh * 17.0))) * sc;
                        float d = length(wp - c0);
                        float rr = ph * sc * 0.55;
                        rip += smoothstep(0.17, 0.0, abs(d - rr)) * (1.0 - ph) * (1.0 - ph);
                    }
                    totalEmissiveRadiance += (vec3(glint) * 0.95 * uGlintAmp + vec3(rip) * 0.52 * uRipAmp) * vec3(0.82, 0.93, 1.0);
                 }`);
        };
        mat.needsUpdate = true;
        return mat;
    }

    function upgradeCampusMaterials(root, setId) {
        // 底板里 62% 的楼是 wall0、24% 是 wall1。
        // 燕园 → 红砖为主（老斋舍、静园六院都是红砖）；医学部 → 米白/青灰的现代楼。
        // 医学部不能有红砖：底板 wall2 是大体量楼，给它石材；红砖只留给燕园
        const wallMap = setId === 'campus2'
            ? [TEX.facade.stone, TEX.facade.graybrick, TEX.facade.stone, TEX.facade.pale]
            : [TEX.facade.brick, TEX.facade.stone, TEX.facade.graybrick, TEX.facade.pale];
        const seen = new Set();
        root.traverse(o => {
            if (!o.isMesh) return;
            const list = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of list) {
                if (!m || seen.has(m)) continue;
                seen.add(m);
                const n = String(m.name || '');
                if (/^wall\d/.test(n)) {
                    const idx = +n.slice(4);
                    m.map = wallMap[idx] || TEX.facade.stone;
                    m.color.setHex(0xffffff);
                    m.roughness = 0.92;
                    m.metalness = 0.0;
                } else if (n === 'ground' || n === 'green') {
                    m.map = TEX.lawn;
                    m.color.setHex(0xffffff);
                    m.roughness = 1.0;
                    injectNoise(m, { scale: 0.038, scale2: 0.15, amp: 0.20, tint: '1.10,1.06,0.82' });
                } else if (n === 'paved') {
                    m.map = TEX.paving;
                    m.color.setHex(0xffffff);
                } else if (n === 'walk') {
                    m.map = TEX.walk;
                    m.color.setHex(0xffffff);
                } else if (n === 'road') {
                    m.map = TEX.asphalt;
                    m.color.setHex(0xffffff);
                    m.roughness = 0.86;
                } else if (n === 'street') {
                    m.color.setHex(0x4a4d51);
                    m.roughness = 0.9;
                } else if (n === 'line') {
                    m.color.setHex(0xe8e2cf);
                    m.roughness = 0.7;
                } else if (n === 'roof') {
                    m.map = TEX.roof;
                    m.color.setHex(0xf0f2f4);
                    m.roughness = 0.94;
                } else if (n === 'water') {
                    // 换成会流动的水：法线滚动 + 掠射角的天空反射（菲涅尔）
                    m.color.setHex(0x2b5a64);
                    m.roughness = 0.12;
                    m.metalness = 0.0;
                    m.normalMap = TEX.waterN;
                    m.normalMap.repeat.set(0.38, 0.38);   // 8m/格 太碎，放大到 ~21m 才看得出涌浪
                    m.normalScale.set(0.95, 0.95);
                    m.envMapIntensity = 1.0;
                    applyWaterShine(m);
                } else if (n === 'tree') {
                    // 底板树冠是"一整块低模绿球"，再多噪声也改不掉剪影。
                    // 直接停用，改由 plantPlateTrees 按烘焙好的树干坐标重种枝干 + 叶片卡。
                    o.visible = false;
                }
                if (m.map) {
                    m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
                    m.map.needsUpdate = true;
                }
                m.needsUpdate = true;
            }
        });
    }

    // 水面法线缓慢流动（在渲染循环里调用）
    const WATER_UNIFORM = { value: 0 };
    let waterT = 0;
    function tickWater(dt) {
        if (!TEX.waterN) return;
        waterT += dt;
        WATER_UNIFORM.value = waterT;
        TEX.waterN.offset.set(waterT * 0.012, waterT * 0.007);
        if (MAT.water) MAT.water.normalMap = TEX.waterN;
    }

    // -----------------------------------------------------------------
    //  6. 校门（横跨跑道的中式门楼 —— 玩家会从门洞里跑过去）
    // -----------------------------------------------------------------
    function chineseGate(bag, x, z, ry, { text = '北京大学', W = 20, H = 5.4 } = {}) {
        const cols = [-W / 2 + 1.4, -4.6, 4.6, W / 2 - 1.4];
        const D = 3.4;
        // 台基（只在两侧，中间留空让玩家跑过）
        for (const s of [-1, 1]) {
            box(bag, MAT.stoneDark, Math.abs(cols[1]) - Math.abs(cols[0]) + 0.6, 0.42, D + 1.4,
                (cols[0] + cols[1]) / 2 * s, -0.28, z, ry);
        }
        // 柱
        for (const cx of cols) {
            for (const cz of [-D / 2, D / 2]) {
                const px = x + Math.cos(ry) * cx + Math.sin(ry) * cz;
                const pz = z - Math.sin(ry) * cx + Math.cos(ry) * cz;
                push(bag, MAT.red, xform(new THREE.CylinderGeometry(0.34, 0.38, H, 10), px, H / 2, pz));
                push(bag, MAT.stone, xform(new THREE.CylinderGeometry(0.5, 0.52, 0.3, 10), px, 0.15, pz));
            }
        }
        // 额枋 + 斗拱
        box(bag, MAT.redDark, W, 0.72, D, x, H - 0.72, z, ry);
        box(bag, MAT.gold, W, 0.1, D + 0.1, x, H - 0.1, z, ry);
        for (let i = 0; i < 13; i++) {
            const cx = -W / 2 + 1.0 + i * (W - 2) / 12;
            const px = x + Math.cos(ry) * cx;
            const pz = z - Math.sin(ry) * cx;
            box(bag, MAT.woodLight, 0.26, 0.34, D + 0.3, px, H + 0.02, pz, ry);
        }
        // 屋顶：先铺一层檐口底板（从下往上看是深色椽子），再压两坡屋面
        box(bag, MAT.wood, W + 2.0, 0.26, D + 2.4, x, H + 0.22, z, ry);
        // 椽子：从下面抬头能看到一排木梁，而不是一块灰板
        for (let i = 0; i < 11; i++) {
            const cx = -W / 2 + 0.8 + i * (W - 1.6) / 10;
            box(bag, MAT.woodLight, 0.16, 0.18, D + 2.2, x + Math.cos(ry) * cx, H + 0.06, z - Math.sin(ry) * cx, ry);
        }
        const g = roofGeo(W + 1.0, D + 1.4, 4.7, { lift: 0.62, ridge: 0.24, overhang: 1.0 });
        g.rotateY(ry);
        g.translate(x, H + 0.5, z);
        push(bag, MAT.roof, g);
        box(bag, MAT.roofDark, (W + 1.0) * 0.26, 0.34, 0.4, x, H + 5.05, z, ry);
        // 檐下彩画（一条青绿带）
        box(bag, MAT.glass, W - 0.4, 0.16, 0.06, x + Math.sin(ry) * (D / 2 + 0.08), H - 0.86, z + Math.cos(ry) * (D / 2 + 0.08), ry);
        // 匾额
        const t = tex(drawPlaque(text));
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.44), shared(new THREE.MeshBasicMaterial({ map: t })));
        pm.position.set(x + Math.sin(ry) * (D / 2 + 0.14), H - 1.5, z + Math.cos(ry) * (D / 2 + 0.14));
        pm.rotation.y = ry;
        BAG_EXTRA.push(pm);
        // 门洞两侧的朱红门扇（侧间：左在 cols[0]~cols[1]，右在 cols[2]~cols[3]）
        for (const s of [-1, 1]) {
            const cx = s < 0 ? (cols[0] + cols[1]) / 2 : (cols[2] + cols[3]) / 2;
            const px = x + Math.cos(ry) * cx;
            const pz = z - Math.sin(ry) * cx;
            box(bag, MAT.redDark, 2.0, H - 1.1, 0.14, px, 0.3, pz, ry);
            box(bag, MAT.gold, 0.1, 0.1, 0.1, px + Math.cos(ry) * 0.7, 1.6, pz, ry);
        }
        // 石狮 + 华表
        for (const s of [-1, 1]) {
            const px = x + Math.cos(ry) * (W / 2 + 2.6) * s + Math.sin(ry) * 3.6;
            const pz = z - Math.sin(ry) * (W / 2 + 2.6) * s + Math.cos(ry) * 3.6;
            const lion = stoneLion(newBag(), px, pz, ry + Math.PI);
            BAG_EXTRA.push(lion);
        }
    }

    // 横幅（校园里最有辨识度的临时构筑物）
    function drawBanner(text, bg = '#b03028', fg = '#fdf6e6') {
        const w = 768, h = 128;
        const c = cv(w, h), g = c.getContext('2d');
        g.fillStyle = bg; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,0.10)';
        for (let x = 0; x < w; x += 24) g.fillRect(x, 0, 2, h);
        g.strokeStyle = 'rgba(255,235,180,0.55)'; g.lineWidth = 3;
        g.strokeRect(6, 6, w - 12, h - 12);
        g.fillStyle = fg;
        g.font = `bold ${Math.round(h * 0.52)}px "PingFang SC","Microsoft YaHei","Heiti SC",sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(text, w / 2, h / 2 + 3);
        return c;
    }
    function bannerOver(bag, x, z, ry, text, bg) {
        const H = 6.6, W = 8.2;
        for (const s of [-1, 1]) {
            const px = x + Math.cos(ry) * s * (W / 2 + 0.7);
            const pz = z - Math.sin(ry) * s * (W / 2 + 0.7);
            push(bag, MAT.metalDark, xform(new THREE.CylinderGeometry(0.07, 0.09, H, 6), px, H / 2, pz));
        }
        box(bag, MAT.metalDark, W + 1.6, 0.06, 0.06, x, H, z, ry);
        const t = tex(drawBanner(text, bg), { aniso: 4 });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.15),
            shared(new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.92 })));
        m.position.set(x, H - 0.66, z);
        m.rotation.y = ry;
        BAG_EXTRA.push(m);
    }

    // 绿篱：连续的低矮灌木带。空荡荡的草地是「没有场景设计」最直接的观感，
    // 一条 0.9m 的绿篱就能把路收出边界，成本只有几个盒体。
    function hedgeRun(bag, C, arc0, arc1, side, off = 9.4) {
        const step = 3.2;
        const rng = rngOf(Math.round(arc0 * 3 + side * 17) >>> 0);
        for (let a = arc0; a < arc1; a += step) {
            let s = sideAt(a, off, side, C);
            if (blocked(s.x, s.z, 0.6)) continue;
            // 弯道处 sideAt 用的是平滑后的方向，绿篱会斜跨整条路面，
            // 三条道一起封死（那撞上就死等于必死）。用足迹九点采样把
            // 侵入中间道的段断掉：绿篱仍贴路肩、最多压住边道，中间道永远留着。
            if (!routeClear(C, s.x, s.z, 0.55, (step + 0.25) / 2, s.yaw, 1.0)) continue;
            const h = 0.82 + rng() * 0.16;
            box(bag, MAT.hedge, 0.95, h, step + 0.25, s.x, GY, s.z, s.yaw);
            registerHedge(s.x, s.z, 0.55, (step + 0.25) / 2, s.yaw, h);
            // 顶面起伏：一个压扁的球就够，三段球在手机上是纯浪费（×3 的面数）
            blob(bag, MAT.hedge, 0.58, s.x, GY + h, s.z, 1.6, 0.5, 1);
        }
    }

    // 一段矮墙（灰砖 + 瓦顶压顶）：把「空草地」圈成有设计的院子
    function wallRun(bag, C, arc0, arc1, side, off = 9.6) {
        const step = 3.0;
        for (let a = arc0; a < arc1; a += step) {
            const s = sideAt(a, off, side, C);
            if (blocked(s.x, s.z, 0.5)) continue;
            box(bag, MAT.grayWall, 0.34, 1.0, step + 0.2, s.x, -0.26, s.z, s.yaw);
            box(bag, MAT.roofDark, 0.54, 0.12, step + 0.26, s.x, 0.74, s.z, s.yaw);
        }
    }

    // 简版牌坊（两柱一门）
    function archway(bag, x, z, ry, text) {
        const W = 9.5, H = 5.2;
        for (const s of [-1, 1]) {
            push(bag, MAT.red, xform(new THREE.CylinderGeometry(0.3, 0.34, H, 10), x + Math.cos(ry) * s * W / 2, H / 2, z - Math.sin(ry) * s * W / 2));
        }
        box(bag, MAT.redDark, W + 1.2, 0.56, 0.7, x, H - 0.56, z, ry);
        // 牌坊屋顶：宽而扁才像「一间房」的顶；做高做窄会变成飞碟
        const g = roofGeo(W + 0.8, 2.2, 1.15, { lift: 0.30, ridge: 0.16, overhang: 0.5 });
        g.rotateY(ry);
        g.translate(x, H + 0.1, z);
        push(bag, MAT.roof, g);
        box(bag, MAT.roofDark, (W + 0.8) * 0.2, 0.24, 0.3, x, H + 1.3, z, ry);
        if (text) {
            const t = tex(drawPlaque(text, { w: 384, h: 128 }));
            const pm = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.86), shared(new THREE.MeshBasicMaterial({ map: t, transparent: true })));
            pm.position.set(x + Math.sin(ry) * 0.38, H - 1.1, z + Math.cos(ry) * 0.38);
            pm.rotation.y = ry;
            BAG_EXTRA.push(pm);
        }
    }

    // 篮球场（地面色块 + 白线 + 篮架 + 围网）
    function court(bag, x, z, ry, W = 15, D = 26) {
        const g = new THREE.PlaneGeometry(W, D);
        g.rotateX(-Math.PI / 2); g.rotateY(ry); g.translate(x, -0.2, z);
        push(bag, MAT.court, g);
        // 边线
        for (const s of [-1, 1]) {
            box(bag, MAT.white, W, 0.02, 0.12, x + Math.cos(ry) * 0 + Math.sin(ry) * s * D / 2, -0.18, z + Math.cos(ry) * s * D / 2, ry);
            box(bag, MAT.white, 0.12, 0.02, D, x + Math.cos(ry) * s * W / 2, -0.18, z - Math.sin(ry) * s * W / 2, ry);
        }
        // 篮架
        for (const s of [-1, 1]) {
            const px = x + Math.sin(ry) * s * (D / 2 + 1.2);
            const pz = z + Math.cos(ry) * s * (D / 2 + 1.2);
            push(bag, MAT.metal, xform(new THREE.CylinderGeometry(0.11, 0.13, 3.4, 8), px, 1.7, pz));
            box(bag, MAT.white, 0.14, 0.8, 1.7, px - Math.sin(ry) * 0.5, 2.9, pz - Math.cos(ry) * 0.5, ry);
            push(bag, MAT.red, xform(new THREE.TorusGeometry(0.34, 0.035, 5, 10), px - Math.sin(ry) * 0.9, 3.05, pz - Math.cos(ry) * 0.9, ry, Math.PI / 2));
        }
        // 围网（半透明，省面数）
        for (const s of [-1, 1]) {
            const g2 = new THREE.PlaneGeometry(D, 3.2);
            g2.rotateY(ry + Math.PI / 2);
            g2.translate(x + Math.cos(ry) * s * W / 2, 1.6, z - Math.sin(ry) * s * W / 2);
            push(bag, MAT.fence, g2);
        }
    }

    // -----------------------------------------------------------------
    //  7. 燕园布局
    // -----------------------------------------------------------------
    // 注意：不能直接用全局 campusPoint()——它读的是「当前活动集」CAMPUS，
    // 而两块底板是在载入时一次性布景的，那时 CAMPUS 还指着另一块。
    function cPoint(C, arc) {
        const L = C.total;
        let a = arc % L;
        if (a < 0) a += L;
        const cum = C.cum;
        let lo = 0, hi = cum.length - 1;
        while (lo + 1 < hi) {
            const mid = (lo + hi) >> 1;
            if (cum[mid] <= a) lo = mid; else hi = mid;
        }
        const span = cum[lo + 1] - cum[lo];
        const t = span > 1e-6 ? (a - cum[lo]) / span : 0;
        const A = C.pts[lo], B = C.pts[(lo + 1) % C.pts.length];
        return { x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t };
    }
    function cDir(C, arc) {
        const sm = C.DIR_SMOOTH || 7;
        const a = cPoint(C, arc - sm), b = cPoint(C, arc + sm);
        let dx = b.x - a.x, dz = b.z - a.z;
        const L = Math.hypot(dx, dz);
        if (L < 1e-4) return { x: 0, z: -1 };
        return { x: dx / L, z: dz / L };
    }
    function frameOf(arc, C) {
        C = C || getCampus();
        const p = cPoint(C, arc);
        const d = cDir(C, arc);
        return {
            x: p.x, z: p.z,
            dx: d.x, dz: d.z,
            yaw: Math.atan2(-d.x, -d.z),
            rx: -d.z, rz: d.x,
        };
    }
    // side: +1 右 / -1 左；返回摆件中心与「朝向路面」的 yaw
    function sideAt(arc, off, side, C) {
        const f = frameOf(arc, C);
        const x = f.x + f.rx * off * side;
        const z = f.z + f.rz * off * side;
        const face = Math.atan2(-f.rx * side, -f.rz * side);
        return { x, z, face, yaw: f.yaw, f };
    }

    // ---- 建筑避让：行道树 / 长椅长在楼里是「程序生成」最明显的破绽 ----
    // ART_BLOCKERS 由 tools/gen-blockers.py 生成（每栋楼一个 xz 包围盒）
    const BLOCK = { grid: null, cell: 26, boxes: null };
    function blockInit(setId) {
        const boxes = (typeof ART_BLOCKERS !== 'undefined' && ART_BLOCKERS[setId]) || [];
        BLOCK.boxes = boxes;
        const cell = BLOCK.cell;
        const grid = new Map();
        for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            const x0 = Math.floor(b[0] / cell), x1 = Math.floor(b[2] / cell);
            const z0 = Math.floor(b[1] / cell), z1 = Math.floor(b[3] / cell);
            for (let gx = x0; gx <= x1; gx++) {
                for (let gz = z0; gz <= z1; gz++) {
                    const k = gx + ',' + gz;
                    let arr = grid.get(k);
                    if (!arr) { arr = []; grid.set(k, arr); }
                    arr.push(i);
                }
            }
        }
        BLOCK.grid = grid;
    }
    // 点是否落在（外扩 pad 的）建筑里
    function blocked(x, z, pad = 0) {
        if (!BLOCK.grid) return false;
        const cell = BLOCK.cell;
        const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const arr = BLOCK.grid.get((gx + dx) + ',' + (gz + dz));
                if (!arr) continue;
                for (const i of arr) {
                    const b = BLOCK.boxes[i];
                    if (x > b[0] - pad && x < b[2] + pad && z > b[1] - pad && z < b[3] + pad) return true;
                }
            }
        }
        return false;
    }
    // 把 art.js 自己造的建筑也注册进避让表 —— blocked() 原来只认底板建筑，
    // 所以自行车棚会穿进 redHall 自己盖的红砖楼里。
    function registerBlocker(x, z, hw, hd, ry) {
        if (!BLOCK.grid) return;
        const c = Math.abs(Math.cos(ry)), si = Math.abs(Math.sin(ry));
        const ex = hw * c + hd * si, ez = hw * si + hd * c;
        const b = [x - ex, z - ez, x + ex, z + ez];
        const idx = BLOCK.boxes.length;
        BLOCK.boxes.push(b);
        const cell = BLOCK.cell;
        for (let gx = Math.floor(b[0] / cell); gx <= Math.floor(b[2] / cell); gx++) {
            for (let gz = Math.floor(b[1] / cell); gz <= Math.floor(b[3] / cell); gz++) {
                const k = gx + ',' + gz;
                let arr = BLOCK.grid.get(k);
                if (!arr) { arr = []; BLOCK.grid.set(k, arr); }
                arr.push(idx);
            }
        }
    }
    // 点到路线折线的最短距离（米）
    function routeDist(C, x, z) {
        const pts = C.pts;
        let best = 1e9;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            const vx = b.x - a.x, vz = b.z - a.z;
            const L2 = vx * vx + vz * vz || 1;
            let t = ((x - a.x) * vx + (z - a.z) * vz) / L2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const dx = x - (a.x + vx * t), dz = z - (a.z + vz * t);
            const d = Math.hypot(dx, dz);
            if (d < best) best = d;
        }
        return best;
    }
    // 足迹（含四角与四边中点）离路线是否够远。车道半宽 3.8 + 人行道 2.6 + 余量。
    // 只查中心点是不够的：一栋 26m 长的楼，中心离路 17m，拐角可能已经压到路面上。
    function routeClear(C, x, z, hw, hd, ry, need = 8.5) {
        const c = Math.abs(Math.cos(ry)), si = Math.abs(Math.sin(ry));
        const ex = hw * c + hd * si, ez = hw * si + hd * c;
        const probes = [[0, 0], [ex, ez], [-ex, ez], [ex, -ez], [-ex, -ez],
                        [ex, 0], [-ex, 0], [0, ez], [0, -ez]];
        for (const [dx, dz] of probes) {
            if (routeDist(C, x + dx, z + dz) < need) return false;
        }
        return true;
    }

    // 跨路构筑物（校门/牌坊）能不能放：两根立柱都必须离整条路线够远。
    // 只看本地路段是不够的——拐角处「垂直于本段」的方向，正好指向下一段路。
    function gateClear(C, x, z, ry, halfW) {
        const c = Math.cos(ry), si = Math.sin(ry);
        for (const sgn of [-1, 1]) {
            const px = x + c * halfW * sgn, pz = z - si * halfW * sgn;
            if (routeDist(C, px, pz) < 4.6) return false;
        }
        return true;
    }

    // 离最近路口还有多远（米）。路口处路面会变宽，off<11 的摆件会落进车道。
    function junctionGap(C, arc) {
        if (!C.junctions || !C.junctions.length) return Infinity;
        const L = C.total;
        let best = Infinity;
        for (const j of C.junctions) {
            for (const at of [j.at, j.at - L, j.at + L]) {
                const g = Math.abs(arc - at);
                if (g < best) best = g;
            }
        }
        return best;
    }

    // 矩形足迹是否放得下（4 角 + 中心采样）
    function fits(x, z, rx, rz, pad = 0.6) {
        for (const dx of [-rx, 0, rx]) {
            for (const dz of [-rz, 0, rz]) {
                if (blocked(x + dx, z + dz, pad)) return false;
            }
        }
        return true;
    }

    const CAMPUS_BEATS = [
        // arc, 类型, 参数
        // 校门放在 1109→1263 的长直道上：转过弯就能看见，跑到 1200 从门洞里穿过
        { arc: 1200, k: 'gate', text: '北京大学' },
        // 开局（1300）正前方 25m 一座小牌坊，第一眼就有「这里是燕园」的信息
        { arc: 1325, k: 'arch', text: '燕园' },
        { arc: 1408, k: 'pavilion', off: 22, side: -1 },
        { arc: 1500, k: 'arch', text: '朗润园', off: 15, side: 1 },
        { arc: 1245, k: 'lions', off: 9.5, side: 1 },
        { arc: 1245, k: 'lions', off: 9.5, side: -1 },
        { arc: 300, k: 'court', off: 24, side: 1 },
        { arc: 640, k: 'lawn', off: 26, side: -1 },
        { arc: 2620, k: 'court', off: 25, side: -1 },
        { arc: 2870, k: 'arch', text: '北大', flip: 1 },
    ];

    // 球体：先缩放再平移（直接对已平移的几何 scale 会把球压到地下）
    function blob(bag, mat, r, x, y, z, sx = 1, sy = 1, sz = 1, seg = 1) {
        const g = seg > 1 ? new THREE.IcosahedronGeometry(r, seg) : new THREE.SphereGeometry(r, 8, 6);
        g.scale(sx, sy, sz);
        g.translate(x, y, z);
        return push(bag, mat, g);
    }

    function layoutYanyuan(bag, C) {
        const S = (arc, off, side) => sideAt(arc, off, side, C);
        // 低端机：树减半、不要第二排。几何量是手机帧率的硬瓶颈，
        // 这一刀能把燕园从 48 万面砍到 30 万面，而近景几乎看不出差别。
        const LOW = (typeof QUALITY !== 'undefined' && QUALITY.tier === 'low');

        // ---- 主要建筑：沿路红砖楼（有空地才放） ----
        const HALL_ARCS = [
            60, 210, 320, 470, 560, 700, 820, 900, 1000, 1060, 1230, 1280,
            1380, 1450, 1560, 1620, 1720, 1800, 1900, 1980, 2100, 2180,
            2260, 2340, 2430, 2520, 2600, 2700, 2790, 2900, 2960,
        ];
        for (let i = 0; i < HALL_ARCS.length; i++) {
            const arc = HALL_ARCS[i];
            const side = (i % 2 === 0) ? 1 : -1;
            const w = 20 + (i % 4) * 3, d = 12 + (i % 2) * 3;
            const floors = 2 + (i % 3);
            let ok = false;
            for (const off of [17, 20, 24, 28, 13]) {
                const s = S(arc, off, side);
                if (fits(s.x, s.z, w / 2 + 1.2, d / 2 + 1.2, 1.0)
                    && routeClear(C, s.x, s.z, w / 2 + 1.2, d / 2 + 2.2, s.face)) {
                    redHall(bag, s.x, s.z, s.face, { w, d, floors });
                    ok = true; break;
                }
            }
            if (!ok) {
                // 挤不下就退一步：只放一栋小体量的（不硬塞进楼里、也不能压路）
                const s = S(arc, 13, side);
                if (fits(s.x, s.z, 6, 5, 0.6) && routeClear(C, s.x, s.z, 6, 6, s.face))
                    redHall(bag, s.x, s.z, s.face, { w: 11, d: 9, floors: 2 });
            }
        }

        // ---- 特色节点 ----
        for (const b of CAMPUS_BEATS) {
            if (b.k === 'gate') {
                // 拐角附近立柱会戳到下一段路：往后找一段直的再放
                let placed = false;
                for (const d of [0, 14, 28, 42, -14, -28]) {
                    const s = S(b.arc + d, 0, 1);
                    if (!gateClear(C, s.f.x, s.f.z, s.f.yaw, 9.0)) continue;
                    chineseGate(bag, s.f.x, s.f.z, s.f.yaw + (b.flip ? Math.PI : 0), { text: b.text });
                    placed = true; break;
                }
                if (!placed) console.info('[art] 校门附近没有足够直的路段，跳过');
            } else if (b.k === 'arch') {
                const s = b.off ? S(b.arc, b.off, b.side || 1) : S(b.arc, 0, 1);
                if (b.off || gateClear(C, s.f.x, s.f.z, s.f.yaw, 5.2)) {
                    archway(bag, s.x, s.z, b.off ? s.face : s.f.yaw, b.text);
                }
            } else if (b.k === 'pavilion') {
                const s = S(b.arc, b.off, b.side);
                pavilion(bag, s.x, s.z, s.face, 1.15);
            } else if (b.k === 'lions') {
                const s = S(b.arc, b.off, b.side);
                BAG_EXTRA.push(stoneLion(newBag(), s.x, s.z, s.face));
            } else if (b.k === 'court') {
                const s = S(b.arc, b.off, b.side);
                court(bag, s.x, s.z, s.face, 15, 26);
            } else if (b.k === 'lawn') {
                const s = S(b.arc, b.off, b.side);
                const g = new THREE.PlaneGeometry(34, 26);
                g.rotateX(-Math.PI / 2); g.rotateY(s.face); g.translate(s.x, -0.24, s.z);
                push(bag, MAT.lawnFine, g);
                for (let i = 0; i < 12; i++) {
                    const a = i / 12 * TAU;
                    treeAt(bag, s.x + Math.cos(a) * 18, s.z + Math.sin(a) * 14, 1.0 + (i % 3) * 0.14, i % 4);
                }
            }
        }

        // ---- 横幅：跨路悬挂，是最便宜的「校园感」 ----
        const BANNERS = [
            { arc: 1180, t: '燕园秋色', bg: '#b03028' },
            { arc: 690, t: '欢迎新同学', bg: '#b03028' },
            { arc: 1780, t: '未名湖畔', bg: '#1f5b8a' },
            { arc: 2450, t: '静园草坪', bg: '#b03028' },
            { arc: 380, t: '百廿北大', bg: '#8c2a22' },
        ];
        for (const b of BANNERS) {
            const s = S(b.arc, 0, 1);
            bannerOver(bag, s.f.x, s.f.z, s.f.yaw, b.t, b.bg);
        }

        // ---- 矮墙：两段，把路边草地圈成院子 ----
        // 矮墙从 9.6 挪到 12.2：原来和绿篱(9.3)横向只差 0.3m，墙被吃掉一半
        wallRun(bag, C, 1520, 1700, 1, 12.2);
        wallRun(bag, C, 2380, 2560, -1, 12.2);

        // ---- 沿路设施：路灯 / 长椅 / 花坛 / 自行车棚 ----
        for (let arc = 0; arc < C.total; arc += 26) {
            const i = Math.round(arc / 26);
            const side = (i % 2 === 0) ? 1 : -1;
            const nearJ = junctionGap(C, arc) < 34;
            const s = S(arc, 8.0, side);
            if (!nearJ && !blocked(s.x, s.z, 0.5)) lampCN(bag, s.x, s.z);
            if (i % 2 === 0 && !nearJ) {
                const b = S(arc + 6, 12.0, -side);
                if (!blocked(b.x, b.z, 0.8)) bench(bag, b.x, b.z, b.face);
            }
            if (i % 3 === 0) {
                // 花坛从 9.2 挪到 12.5：原来和绿篱(9.3, 宽0.95)必然相交
                const f = S(arc + 12, 12.5, side);
                if (!nearJ && !blocked(f.x, f.z, 2.2)) flowerBed(bag, f.x, f.z, 1.5 + (i % 3) * 0.35, i % 3);
            }
            if (i % 5 === 0) {
                const b2 = S(arc + 18, 10.5, -side);
                if (!nearJ && fits(b2.x, b2.z, 3.6, 2.2, 0.6) && routeClear(C, b2.x, b2.z, 3.4, 2.2, b2.face, 8.0)) bikeShelter(bag, b2.x, b2.z, b2.face);
            }
        }

        // ---- 绿篱：沿路两段式，路口前后断开 ----
        const HEDGES = [[40, 300, 1], [330, 600, -1], [640, 940, 1], [980, 1090, -1],
                        [1120, 1175, 1], [1228, 1258, 1], [1265, 1360, -1], [1360, 1520, -1], [1560, 1760, 1], [1800, 2060, -1],
                        [2100, 2340, 1], [2380, 2600, -1], [2640, 2840, 1], [2880, 3000, -1]];
        for (const [a0, a1, sd] of HEDGES) hedgeRun(bag, C, a0, a1, sd, 9.3);

        // ---- 行道树：补在底板那排之间（底板 12.5m 一棵，这里 25m 一棵错开）----
        // 密度是手机帧率的头号杀手：一棵 5 球冠 ~400 面，900 棵就是 36 万面。
        // 所以近排只补空隙，远排用 2 球的简化树，总量压在 20 万面以内。
        for (let arc = 6; arc < C.total; arc += (LOW ? 44 : 25)) {
            for (const side of [-1, 1]) {
                if (Math.abs(arc - 1200) < 26 || Math.abs(arc - 1325) < 16 || Math.abs(arc - 2870) < 16) continue;
                const off = 12.4 + ((Math.round(arc) * 7) % 5) * 1.1;
                const s = S(arc, off, side);
                if (blocked(s.x, s.z, 2.2)) continue;      // 树冠半径 ~2m，别插进楼里
                const k = (Math.round(arc / 25) + (side > 0 ? 1 : 0)) % 5;
                treeAt(bag, s.x, s.z, 1.1 + ((Math.round(arc) % 4) * 0.12), k);
            }
        }
        // ---- 第二排大树：把 25~40m 的空场挡起来，远景不再是一片草 ----
        if (!LOW) {
            for (let arc = 12; arc < C.total; arc += 30) {
                for (const side of [-1, 1]) {
                    const s = S(arc, 27 + ((Math.round(arc) * 5) % 4) * 3, side);
                    if (blocked(s.x, s.z, 2.6)) continue;
                    treeAt(bag, s.x, s.z, 1.45 + ((Math.round(arc) % 3) * 0.14),
                           (Math.round(arc / 30) + (side > 0 ? 2 : 0)) % 5, true);
                }
            }
        }

        // ---- 地面落叶：破掉「一整块绿板」 ----
        const rng = rngOf(20261104);
        for (let arc = 4; arc < C.total; arc += (LOW ? 14 : 6)) {
            const side = rng() < 0.5 ? -1 : 1;
            const s = S(arc, 6.5 + rng() * 2.6, side);
            if (blocked(s.x, s.z, 0.2)) continue;
            leafDecal(bag, s.x, s.z, 0.30 + rng() * 0.26, rng() * TAU);
        }

        // ---- 湖岸：石舫 + 垂柳 ----
        stoneBoat(bag, -414, -436, 1.15);
        for (let i = 0; i < 6; i++) {
            const s = S(1290 + i * 42, 30 + (i % 2) * 6, -1);
            willow(bag, s.x, s.z, 1.0 + (i % 3) * 0.12);
        }
    }

    // 石舫（未名湖畔的标志物）
    function stoneBoat(bag, x, z, ry) {
        const L = 16, W = 5.2;
        for (let i = 0; i < 4; i++) {
            const t = i / 4;
            box(bag, MAT.marble, L - t * 3.4, 0.42, W - t * 1.5, x, 0.2 + i * 0.4, z, ry);
        }
        push(bag, MAT.marble, xform(new THREE.ConeGeometry(W * 0.4, 2.4, 4), x + Math.cos(ry) * L / 2, 1.0, z - Math.sin(ry) * L / 2, ry + Math.PI / 4, Math.PI / 2));
        box(bag, MAT.marble, 7.2, 2.6, 3.6, x, 1.8, z, ry);
        for (let i = 0; i < 4; i++) {
            const ox = -2.6 + i * 1.7;
            box(bag, MAT.wood, 0.12, 1.8, 3.0, x + Math.cos(ry) * ox, 2.0, z - Math.sin(ry) * ox, ry);
        }
        push(bag, MAT.roof, xform(new THREE.CylinderGeometry(2.2, 2.2, 7.6, 8, 1, false, 0, Math.PI), x, 4.4, z, ry + Math.PI / 2, Math.PI / 2));
        for (const s of [-1, 1]) {
            box(bag, MAT.marble, L - 1.2, 0.16, 0.16, x + Math.sin(ry) * s * (W / 2 - 0.3), 1.7, z + Math.cos(ry) * s * (W / 2 - 0.3), ry);
        }
    }

    // 垂柳：主干 + 上部分叉 + 一圈下垂的柳条（每条柳条由 5–7 片叶卡串成）
    function willow(bag, x, z, s = 1) {
        registerTree(x, z, 1.15 * s + 0.35);
        const rng = rngOf(Math.round(x * 31 + z * 17) + 7);
        const gy = GY;
        const topY = gy + 3.9 * s;
        push(bag, MAT.bark, xform(new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 3.6 * s, 7), x, gy + 1.8 * s, z));
        // 树冠主枝
        for (let i = 0; i < 5; i++) {
            const a = i / 5 * TAU + rng() * 0.5;
            limb(bag, MAT.bark, x, gy + 3.2 * s, z,
                 x + Math.cos(a) * 1.5 * s, topY + 0.7 * s, z + Math.sin(a) * 1.5 * s, 0.14 * s, 0.07 * s);
        }
        leafCloud(bag, MAT.leafCardC, x, topY + 0.4 * s, z, 1.5 * s, 0.8 * s, 1.5 * s, Math.round(14 * Math.max(0.6, s)), rng);
        // 柳条：从冠沿垂下去，一根 6 片叶
        for (let i = 0; i < 9; i++) {
            const a = i / 9 * TAU + rng() * 0.4;
            const bx = x + Math.cos(a) * (1.0 + rng() * 0.7) * s;
            const bz = z + Math.sin(a) * (1.0 + rng() * 0.7) * s;
            for (let k = 0; k < 6; k++) {
                const g = new THREE.PlaneGeometry(0.34 * s, 0.5 * s);
                g.rotateY(a + Math.PI / 2);
                g.rotateX(0.35);
                g.translate(bx + Math.cos(a) * k * 0.06, topY + 0.2 * s - k * (0.34 * s), bz + Math.sin(a) * k * 0.06);
                push(bag, MAT.leafCardB, g);
            }
        }
    }

    // 树（5 种）
    //  · 近景：树干 → 主枝 → 分枝 → 枝头叶簇（叶片卡，能看出"一片一片"）
    //  · 远景：低模冠（两个扁球）+ 少量叶卡打碎轮廓 —— 40m 外只看剪影，不值得堆几何
    function treeAt(bag, x, z, s, kind, simple) {
        if (kind !== 4) registerTree(x, z, 1.05 * s + 0.35);
        if (kind === 4) { willow(bag, x, z, s * 0.9); return; }
        const h = 6.4 * s;
        const gy = GY;
        const rng = rngOf(Math.round(x * 19 + z * 13) + kind * 37);
        const barkMat = MAT.bark;
        const leafMat = kind === 1 ? MAT.leafCardG : (kind === 2 ? MAT.leafCardC : (kind === 3 ? MAT.leafCardB : MAT.leafCardA));
        const trunkH = h * (kind === 2 ? 0.55 : 0.42);

        if (simple) {
            // 远景：树干 + 4 根短枝 + 三团叶簇。不再用"绿球"——远处也要看得出是枝叶，
            // 只是叶量降档（卡片少一点、云团大一点）。
            push(bag, barkMat, xform(new THREE.CylinderGeometry(0.14 * s, 0.26 * s, trunkH, 6), x, gy + trunkH / 2, z));
            const cy = gy + trunkH;
            for (let i = 0; i < 4; i++) {
                const a = i / 4 * TAU + kind;
                limb(bag, barkMat, x, cy, z, x + Math.cos(a) * 0.95 * s, cy + 1.35 * s, z + Math.sin(a) * 0.95 * s, 0.1 * s, 0.05 * s, 4);
            }
            leafCloud(bag, leafMat, x, cy + 1.5 * s, z, 1.8 * s, 1.15 * s, 1.8 * s, LOWQ() ? 11 : 15, rng);
            leafCloud(bag, leafMat, x + 0.7 * s, cy + 0.95 * s, z - 0.4 * s, 1.0 * s, 0.75 * s, 1.0 * s, LOWQ() ? 8 : 12, rng);
            leafCloud(bag, leafMat, x - 0.7 * s, cy + 1.05 * s, z + 0.45 * s, 1.0 * s, 0.75 * s, 1.0 * s, LOWQ() ? 8 : 12, rng);
            return;
        }

        // 近景：主干 + 主枝 + 分枝 + 叶簇
        push(bag, barkMat, xform(new THREE.CylinderGeometry(0.13 * s, 0.27 * s, trunkH, 7), x, gy + trunkH / 2, z));
        const forkY = gy + trunkH * 0.94;
        const nBranch = kind === 2 ? 5 : 4 + (kind % 3);
        const up = kind === 2 ? 1.85 : 1.5;
        const out = kind === 2 ? 1.15 : 1.55;
        for (let i = 0; i < nBranch; i++) {
            const a = (i / nBranch) * TAU + kind * 0.7 + rng() * 0.55;
            const len = out * s * (0.8 + rng() * 0.55);
            const tipY = forkY + up * s * (0.8 + rng() * 0.45);
            const tipX = x + Math.cos(a) * len;
            const tipZ = z + Math.sin(a) * len;
            limb(bag, barkMat, x, forkY, z, tipX, tipY, tipZ, 0.11 * s, 0.06 * s, 5);
            // 枝腰再挂一簇：只把叶子堆在枝尖会像"光杆挑着几片叶"
            leafCloud(bag, leafMat, (x + tipX) * 0.5, (forkY + tipY) * 0.5 + 0.35 * s, (z + tipZ) * 0.5,
                1.05 * s, 0.72 * s, 1.05 * s, LOWQ() ? 9 : 15, rng);
            // 枝尖再分两小叉
            for (let k = 0; k < 2; k++) {
                const a2 = a + (k ? 0.62 : -0.62) + (rng() - 0.5) * 0.3;
                const sx2 = tipX + Math.cos(a2) * 0.85 * s;
                const sz2 = tipZ + Math.sin(a2) * 0.85 * s;
                const sy2 = tipY + 0.55 * s;
                limb(bag, barkMat, tipX, tipY, tipZ, sx2, sy2, sz2, 0.055 * s, 0.03 * s, 4);
                leafCloud(bag, leafMat, sx2, sy2 + 0.12 * s, sz2,
                    1.28 * s, 0.95 * s, 1.28 * s, LOWQ() ? 11 : 17, rng);
            }
        }
        // 冠心：一大簇，把中间填满（树冠不能透光）
        leafCloud(bag, leafMat, x, forkY + 1.15 * s, z, 1.7 * s, 1.15 * s, 1.7 * s, LOWQ() ? 14 : 21, rng);
    }

    // 底板行道树重种：GLB 里那层「绿球」已经隐藏（upgradeCampusMaterials 里 o.visible=false），
    // 这里按 PLATE_TREES 的树干坐标一棵一棵种「树干 + 主枝 + 枝头叶簇」。
    // 近排（离路线 26m 内）用完整枝叶，远排降到 2–3 团叶簇；低画质再降一档。
    let PLATE_TREES_STAT = null;
    function plantPlateTrees(bag, C) {
        const list = (typeof PLATE_TREES !== 'undefined' && PLATE_TREES[C.id]) || [];
        if (!list.length) return;
        const rng = rngOf(9182);
        const LOW = (typeof QUALITY !== 'undefined' && QUALITY.tier === 'low');
        let near = 0, far = 0;
        NO_REG = true;                       // 碰撞体在 decorateCampus 里已经登记过，别记两遍
        for (let i = 0; i < list.length; i++) {
            const x = list[i][0], z = list[i][1];
            const d = routeDist(C, x, z);
            if (d > (LOW ? 22 : 40)) continue;
            const sc = 0.92 + rng() * 0.34;
            const kind = Math.floor(rng() * 5);
            treeAt(bag, x, z, sc, kind, d > 16);
            if (d > 16) far++; else near++;
        }
        NO_REG = false;
        PLATE_TREES_STAT = { near, far, total: list.length };
    }

    // -----------------------------------------------------------------
    //  8. 医学部布局（现代校园：广场 / 喷泉 / 白求恩像 / 花坛）
    // -----------------------------------------------------------------
    function layoutBMU(bag, C) {
        const S = (arc, off, side) => sideAt(arc, off, side, C);
        const LOW = (typeof QUALITY !== 'undefined' && QUALITY.tier === 'low');
        const HALLS = [40, 150, 260, 380, 500, 620, 740, 860, 980, 1100, 1220, 1340, 1460, 1580, 1700, 1820];
        for (let i = 0; i < HALLS.length; i++) {
            const s = S(HALLS[i], 21 + (i % 3) * 3, i % 2 === 0 ? 1 : -1);
            modernHall(bag, s.x, s.z, s.face, {
                w: 26 + (i % 3) * 6, d: 16 + (i % 2) * 4,
                h: 14 + (i % 4) * 7,
            });
        }
        const f = S(300, 22, 1);
        fountain(bag, f.x, f.z, 5.2);
        const st = S(700, 13, -1);
        statue(bag, st.x, st.z, st.face);
        for (let arc = 0; arc < C.total; arc += 24) {
            const i = Math.round(arc / 24);
            const s = S(arc, 7.8, i % 2 === 0 ? 1 : -1);
            lampCN(bag, s.x, s.z);
            if (i % 2 === 0) {
                const b = S(arc + 5, 8.4, -1);
                bench(bag, b.x, b.z, b.face);
            }
            if (i % 3 === 0) {
                const fl = S(arc + 10, 9.0, 1);
                flowerBed(bag, fl.x, fl.z, 1.6, i % 3);
            }
        }
        for (let arc = 5; arc < C.total; arc += (LOW ? 22 : 12)) {
            for (const side of [-1, 1]) {
                const s = S(arc, 11.0 + ((Math.round(arc) * 3) % 4) * 0.8, side);
                if (blocked(s.x, s.z, 2.0)) continue;
                treeAt(bag, s.x, s.z, 0.9 + (Math.round(arc) % 3) * 0.08, (Math.round(arc / 12) + (side > 0 ? 0 : 2)) % 5);
            }
        }
        const rng = rngOf(777);
        for (let arc = 3; arc < C.total; arc += (LOW ? 16 : 7)) {
            const s = S(arc, 6.4 + rng() * 2.4, rng() < 0.5 ? -1 : 1);
            if (blocked(s.x, s.z, 0.2)) continue;
            leafDecal(bag, s.x, s.z, 0.28 + rng() * 0.24, rng() * TAU);
        }
    }

    function fountain(bag, x, z, r) {
        push(bag, MAT.stone, xform(new THREE.CylinderGeometry(r, r * 1.06, 0.6, 16), x, 0.3, z));
        push(bag, MAT.waterFlat, xform(new THREE.CylinderGeometry(r * 0.88, r * 0.88, 0.1, 16), x, 0.58, z));
        push(bag, MAT.marble, xform(new THREE.CylinderGeometry(0.5, 0.8, 1.5, 8), x, 1.3, z));
        push(bag, MAT.marble, xform(new THREE.CylinderGeometry(1.5, 1.1, 0.24, 12), x, 2.1, z));
        push(bag, MAT.waterFlat, xform(new THREE.CylinderGeometry(1.32, 1.32, 0.08, 12), x, 2.2, z));
        push(bag, MAT.waterFlat, xform(new THREE.CylinderGeometry(0.1, 0.1, 3.2, 6), x, 3.6, z));
    }

    function statue(bag, x, z, ry) {
        box(bag, MAT.stoneDark, 2.6, 0.5, 2.6, x, 0, z, ry);
        box(bag, MAT.stone, 1.8, 1.9, 1.8, x, 0.5, z, ry);
        box(bag, MAT.bronze, 0.7, 1.5, 0.5, x, 2.4, z, ry);
        push(bag, MAT.bronze, xform(new THREE.SphereGeometry(0.28, 8, 6), x, 4.1, z));
        box(bag, MAT.bronze, 0.24, 0.9, 0.24, x - Math.cos(ry) * 0.45, 3.1, z + Math.sin(ry) * 0.45, ry);
    }

    // -----------------------------------------------------------------
    //  9. 城市科幻增强
    // -----------------------------------------------------------------
    const CITY = { flyers: [], t: 0 };

    function skyBridge(bag, z, y, W = 62) {
        // 横跨跑道的高架连廊
        box(bag, MAT.cityBeam, W, 2.2, 4.4, 0, y, z);
        box(bag, MAT.neonCyan, W, 0.12, 0.3, 0, y + 2.2, z + 2.2);
        box(bag, MAT.neonPink, W, 0.12, 0.3, 0, y + 2.2, z - 2.2);
        for (let i = -2; i <= 2; i++) {
            box(bag, MAT.neonCyan, 0.2, 1.4, 0.2, i * 12, y + 1.2, z + 2.24);
        }
        // 支撑塔
        for (const s of [-1, 1]) {
            box(bag, MAT.cityTower, 3.0, y, 3.0, s * (W / 2 - 2), 0, z);
        }
    }

    // 霓虹光门：门框 + 内圈发光 + 顶部横梁，玩家会从中间穿过去
    function neonArch(bag, x, z, h, hue) {
        const W = 13.5;
        if (!CITY_MAT.neon.has(hue)) {
            CITY_MAT.neon.set(hue, shared(new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue, 1, 0.58) })));
            CITY_MAT.neon.set('d' + hue, shared(new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue, 0.9, 0.30) })));
        }
        const mat = CITY_MAT.neon.get(hue);
        const matDim = CITY_MAT.neon.get('d' + hue);
        for (const s of [-1, 1]) {
            // 立柱（外侧深色结构 + 内侧一条亮边）
            box(bag, MAT.cityTower, 0.7, h, 0.7, x + s * W / 2, 0, z);
            box(bag, mat, 0.16, h - 0.5, 0.16, x + s * (W / 2 - 0.45), 0.3, z + 0.38);
            box(bag, matDim, 0.1, h * 0.8, 0.1, x + s * (W / 2 - 0.45), 0.3, z - 0.38);
        }
        // 顶部横梁 + 灯带
        box(bag, MAT.cityTower, W + 0.7, 0.55, 0.7, x, h, z);
        box(bag, mat, W, 0.1, 0.12, x, h + 0.1, z + 0.38);
        box(bag, mat, W, 0.1, 0.12, x, h + 0.1, z - 0.38);
        // 顶部的小旗标
        for (let i = -1; i <= 1; i++) {
            box(bag, mat, 0.1, 1.1, 0.1, x + i * W * 0.28, h + 0.55, z);
        }
    }

    // 城市层材质/贴图缓存：decorateCity 每次进城市都会重跑，材质若在函数里 new，
    // 又打了 shared 标记，disposeObj 会跳过 → 每次泄漏 20 个材质 + 2MB canvas。
    const CITY_MAT = { holo: new Map(), neon: new Map(), beam: new Map() };
    function holoMaterial(idx, text, hue) {
        if (!CITY_MAT.holo.has(idx)) {
            const t = tex(drawHolo(text, hue), { aniso: 4 });
            CITY_MAT.holo.set(idx, shared(new THREE.MeshBasicMaterial({
                map: t, transparent: true, blending: THREE.AdditiveBlending,
                depthWrite: false, side: THREE.DoubleSide, opacity: 0.92,
            })));
        }
        return CITY_MAT.holo.get(idx);
    }

    function holoBillboard(bag, x, z, ry, text, hue, w = 14, h = 8, idx = 0, y = 10.2) {
        const mat = holoMaterial(idx, text, hue);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        m.position.set(x, y, z);
        m.rotation.y = ry;
        m.renderOrder = 5;
        // 框架
        box(bag, MAT.neonCyan, w + 0.4, 0.16, 0.16, x, y + h / 2, z, ry);
        box(bag, MAT.neonCyan, w + 0.4, 0.16, 0.16, x, y - h / 2, z, ry);
        return m;   // 调用方负责 g.add(m)：4 块广告在不同 z，不能统一塞进最后一个组
    }

    function lightBeam(x, z, h, hue) {
        if (!CITY_MAT.beam.has(hue)) {
            CITY_MAT.beam.set(hue, shared(new THREE.MeshBasicMaterial({
                color: new THREE.Color().setHSL(hue, 1, 0.6),
                transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending,
                depthWrite: false, side: THREE.DoubleSide,
            })));
        }
        const mat = CITY_MAT.beam.get(hue);
        const m = new THREE.Mesh(new THREE.ConeGeometry(3.4, h, 10, 1, true), mat);
        m.position.set(x, h / 2, z);
        m.renderOrder = 4;
        return m;
    }

    function makeFlyer(hue) {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.34, 0.8),
            shared(new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.3, metalness: 0.8 })));
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5),
            shared(new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue, 1, 0.62) })));
        lamp.position.set(0, 0, 0.5);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.5),
            shared(new THREE.MeshBasicMaterial({
                color: new THREE.Color().setHSL(hue, 1, 0.55),
                transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
            })));
        glow.position.set(0, 0, 1.2);
        g.add(body, lamp, glow);
        g.userData.hue = hue;
        return g;
    }

    // -----------------------------------------------------------------
    //  10. 对外：把摆件挂到校园底板上
    // -----------------------------------------------------------------
    function makePagoda(x, z, H) {
        const bag = newBag();
        pagodaTower(bag, H || 31, 2.9);
        const g = bagToGroup(bag, { cast: true, receive: true, name: 'boya' });
        g.position.set(x, 0, z);
        // 塔基栏杆
        const bag2 = newBag();
        for (let i = 0; i < 8; i++) {
            const a = i / 8 * TAU;
            box(bag2, MAT.marble, 0.22, 0.9, 0.22, Math.cos(a) * 4.6, 0, Math.sin(a) * 4.6);
        }
        const rail = bagToGroup(bag2, { cast: false, receive: true });
        g.add(rail);
        return g;
    }

    function decorateCampus(C) {
        if (!C || !C.group || C.art) return;
        // 每次布景前清空该图的实体表：重复挂载（换画质 / 重开局）不能让碰撞体翻倍
        ACTIVE_SET_ID = C.id;
        CAMPUS_SOLIDS[C.id] = [];
        // 底板 GLB 里的行道树：树干中心由 tools/gen-campus-trees.py 离线烘焙成
        // PLATE_TREES（离路线 ≥6.9m，正常直道撞不到；转弯冲出跑道时才会碰到）。
        const plate = (typeof PLATE_TREES !== 'undefined' && PLATE_TREES[C.id]) || [];
        for (let i = 0; i < plate.length; i++) registerTree(plate[i][0], plate[i][1], 1.15);
        try { buildAmbient(); } catch (e) { console.warn('[art] 环境层失败', e); }
        const bag = newBag();
        try {
            blockInit(C.id);
            if (C.id === 'campus2') layoutBMU(bag, C);
            else layoutYanyuan(bag, C);
            plantPlateTrees(bag, C);
        } catch (e) {
            console.warn('[art] 校园摆件生成失败:', e && e.message);
        }
        const g = bagToGroup(bag, { cast: true, receive: true, name: 'campusArt-' + C.id });
        for (const m of BAG_EXTRA) g.add(m);
        BAG_EXTRA.length = 0;
        g.userData.noMerge = true;
        C.group.add(g);
        C.art = g;
        console.log('[art] ' + C.id + ' 摆件已挂载：' + g.children.length + ' 个网格');
    }

    // -----------------------------------------------------------------
    //  10.5 环境动态：落叶 + 云（都很便宜，但「活起来」的效果很明显）
    // -----------------------------------------------------------------
    const AMB = { leaves: null, clouds: null, t: 0, built: false };

    function buildAmbient() {
        if (AMB.built) return;
        AMB.built = true;
        // ---- 落叶：一个 Points 就是全部，1 个 drawcall ----
        const N = 110;
        const pos = new Float32Array(N * 3);
        const spd = new Float32Array(N);
        const ph = new Float32Array(N);
        const rng = rngOf(4242);
        for (let i = 0; i < N; i++) {
            pos[i * 3] = (rng() - 0.5) * 46;
            pos[i * 3 + 1] = rng() * 11;
            pos[i * 3 + 2] = (rng() - 0.5) * 60;
            spd[i] = 0.7 + rng() * 1.1;
            ph[i] = rng() * TAU;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({
            map: TEX.leaf, color: 0xe8c86a, size: 0.5, sizeAttenuation: true,
            transparent: true, alphaTest: 0.35, depthWrite: false, fog: true,
        });
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        pts.userData.spd = spd;
        pts.userData.ph = ph;
        scene.add(pts);
        AMB.leaves = pts;

        // ---- 云：几张大软片，贴着天顶慢慢飘 ----
        const cloudMat = shared(new THREE.MeshBasicMaterial({
            map: makeCloudTex(), transparent: true, opacity: 0.55,
            depthWrite: false, fog: false, side: THREE.DoubleSide,
        }));
        const cg = new THREE.Group();
        const crng = rngOf(909);
        for (let i = 0; i < 7; i++) {
            const w = 90 + crng() * 90;
            const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.42), cloudMat);
            const a = crng() * TAU, r = 120 + crng() * 150;
            m.position.set(Math.cos(a) * r, 62 + crng() * 40, Math.sin(a) * r);
            m.rotation.x = -Math.PI / 2.6;
            m.rotation.z = crng() * TAU;
            cg.add(m);
        }
        cg.userData.noMerge = true;
        scene.add(cg);
        AMB.clouds = cg;
    }

    function makeCloudTex() {
        const w = 256, h = 128;
        const c = cv(w, h), g = c.getContext('2d');
        g.clearRect(0, 0, w, h);
        const rng = rngOf(31);
        for (let i = 0; i < 22; i++) {
            const x = w * (0.12 + rng() * 0.76);
            const y = h * (0.4 + rng() * 0.34);
            const r = h * (0.16 + rng() * 0.3);
            const grd = g.createRadialGradient(x, y, 0, x, y, r);
            grd.addColorStop(0, 'rgba(255,255,255,0.55)');
            grd.addColorStop(0.6, 'rgba(255,255,255,0.22)');
            grd.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = grd;
            g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        return t;
    }

    function tickAmbient(dt, themeId, px, pz) {
        AMB.t += dt;
        // 校园里玩家永远在原点（整块底板绕他转），落叶就别跟着里程跑了
        if (themeId === 'campus' || themeId === 'campus2') { px = 0; pz = 0; }
        if (AMB.leaves) {
            const show = themeId === 'campus' || themeId === 'campus2';
            AMB.leaves.visible = show;
            if (show) {
                const p = AMB.leaves.geometry.attributes.position;
                const arr = p.array, spd = AMB.leaves.userData.spd, ph = AMB.leaves.userData.ph;
                for (let i = 0; i < spd.length; i++) {
                    const k = i * 3;
                    arr[k + 1] -= spd[i] * dt;
                    arr[k] += Math.sin(AMB.t * 1.4 + ph[i]) * dt * 0.9;
                    arr[k + 2] += Math.cos(AMB.t * 1.1 + ph[i]) * dt * 0.7;
                    if (arr[k + 1] < -0.6) {
                        arr[k] = px + (Math.random() - 0.5) * 46;
                        arr[k + 1] = 8 + Math.random() * 4;
                        arr[k + 2] = pz + (Math.random() - 0.5) * 60;
                    }
                }
                p.needsUpdate = true;
            }
        }
        if (AMB.clouds) {
            AMB.clouds.visible = themeId !== 'tunnel';
            AMB.clouds.position.set(px, 0, pz);
            AMB.clouds.rotation.y = AMB.t * 0.006;
        }
    }

    // -----------------------------------------------------------------
    //  11. 对外：城市科幻层
    // -----------------------------------------------------------------
    function decorateCity(addScenery) {
        if (typeof addScenery !== 'function') { console.warn('[art] decorateCity: 没有 addScenery'); return; }
        const SPAN = 324;

        // ---- 霓虹光门：每 54m 一道，6 道刚好铺满一个 span ----
        // 这是最有效的「科幻纵深」：一排门洞把路压出隧道感，颜色还给了节奏。
        const HUES = [0.52, 0.86, 0.62, 0.78, 0.50, 0.90];
        for (let i = 0; i < 6; i++) {
            const bag = newBag();
            const z = -SPAN * i / 6 - 26;
            const hue = HUES[i];
            neonArch(bag, 0, 0, 9.2 + (i % 3) * 0.9, hue);   // 几何建在原点，位置由 addScenery 给
            const g = bagToGroup(bag, { cast: false, receive: false, name: 'neonArch' });
            g.userData.noMerge = true;
            addScenery(g, z);
        }

        // ---- 空中连廊：抬到 13m（原来 20m 在相机视锥之外，等于白做） ----
        for (let i = 0; i < 2; i++) {
            const bag = newBag();
            skyBridge(bag, 0, 13 + i * 2, 58);
            const g = bagToGroup(bag, { cast: false, receive: false, name: 'skybridge' });
            g.userData.noMerge = true;
            addScenery(g, -SPAN * i / 2 - 88);
        }

        // ---- 全息广告：贴到 9.5m，x=±17，才落在画面里 ----
        const HOLOS = [
            { t: '未来已来', hue: 190 }, { t: '赛博长安', hue: 320 },
            { t: '数据洪流', hue: 160 }, { t: '霓虹之城', hue: 275 },
        ];
        for (let i = 0; i < 4; i++) {
            const bag = newBag();
            const side = i % 2 === 0 ? 1 : -1;
            // 悬在路面上空、正面朝向玩家：城市街道只有 ~8m 宽，放两侧会埋进商铺墙
            const holoMesh = holoBillboard(bag, side * 2.6, 0, 0, HOLOS[i].t, HOLOS[i].hue, 12.5, 7.0, i, 12.4);
            const g = bagToGroup(bag, { cast: false, receive: false, name: 'holo' });
            g.add(holoMesh);                 // ★ 必须挂进本组：4 块广告的 z 各不相同
            g.userData.noMerge = true;
            addScenery(g, -SPAN * i / 4 - 34);
        }

        // ---- 天幕光柱：x=±20，才在视野两侧 ----
        for (let i = 0; i < 4; i++) {
            const m = lightBeam((i % 2 ? 1 : -1) * 21, 0, 70, (i * 0.13 + 0.5) % 1);
            m.userData.noMerge = true;
            addScenery(m, -SPAN * i / 4 - 52);
        }

        // ---- 飞行器（不滚动，绕玩家循环） ----
        if (!CITY.flyers.length) {
            for (let i = 0; i < 5; i++) {
                const f = makeFlyer((i * 0.17 + 0.52) % 1);
                f.userData.base = {
                    x: (i % 2 ? 1 : -1) * (12 + i * 5),
                    y: 17 + (i % 3) * 6,
                    z: -40 - i * 22,
                    spd: 0.10 + i * 0.03,
                };
                scene.add(f);
                CITY.flyers.push(f);
            }
        }
        for (const f of CITY.flyers) f.visible = true;
        console.log('[art] 城市科幻层已挂载：光门 6 / 连廊 2 / 全息 4 / 光柱 4 / 飞行器 ' + CITY.flyers.length);
    }

    function tickCity(dt) {
        if (!CITY.flyers.length) return;
        CITY.t += dt;
        for (const f of CITY.flyers) {
            const b = f.userData.base;
            const z = ((b.z + CITY.t * b.spd * 40) % 240 + 240) % 240 - 200;
            f.position.set(b.x + Math.sin(CITY.t * 0.4 + b.x) * 3, b.y + Math.sin(CITY.t * 0.9 + b.z) * 1.2, z);
            f.rotation.y = Math.PI;
        }
    }

    function hideCity() {
        for (const f of CITY.flyers) f.visible = false;
    }

    return {
        buildMaterials, upgradeCampusMaterials, tickWater,
        makePagoda, decorateCampus, decorateCity, tickCity, hideCity, tickAmbient, applyWaterShine,
        MAT, TEX, getBuildingBoxes,
        _internal: { newBag, push, bagToGroup, box, cyl, chineseRoof, roofGeo, redHall, modernHall,
            pavilion, stoneLion, huabiao, archBridge, lampCN, bench, flowerBed, bikeShelter,
            noticeBoard, leafDecal, pagodaTower, tex, cv, drawPlaque, drawHolo, BAG_EXTRA, rngOf, shade,
            chineseGate, archway, court, treeAt, willow, stoneBoat, fountain, statue },
    };
}

// 美术升级包实例：贴图/材质一次性建好，两个校园共用同一套
const ART = createArtKit({
    THREE, scene, renderer, camera,
    mergeGeometries, CAMPUS_SETS,
    getCampus: () => CAMPUS,
    getTheme: () => curTheme,
    rand, pick, clamp, shared,
});
ART.buildMaterials();
// ==== ART-BLOCK END ====





function scrollWorld(step, D) {
    const T = THEMES[curTheme];
    campusUpdate(step);       // 校园：整块底板绕玩家转，弯道就发生在这里
    for (const o of scenery) {
        if (o.userData.trackScroll) {
            // 校园的跑道是弯的：传送门必须跟着路线投影，否则会跑到楼顶/草坪上（悬空）。
            // 逻辑里程存 userData.tz，渲染位置每帧按路线重算——不能直接去加 position.z，
            // 因为 position.z 已经是投影后的世界坐标，再加就滚飞了。
            o.userData.tz = (o.userData.tz == null ? o.position.z : o.userData.tz) + step;
            placeOnTrack(o, 0, 0, o.userData.tz);
            continue;
        }
        o.position.z += step;
        if (o.userData.period) {
            // 自定义周期（隧道管段：200m 一段、同时存在 3 段）
            const P = o.userData.period;
            if (o.position.z > P.wrapAt) o.position.z -= P.recycle;
        } else if (o.userData.tiling) {
            // 大合并装饰有两份副本（相差一个 span）：等本组整体滚过 span 再后移两倍 span，
            // 由另一份副本无缝接管可见区间（早移会在前方留下装饰空档）
            if (o.position.z > 24 + T.span) o.position.z -= T.span * 2;
        } else if (o.position.z > 24) {
            o.position.z -= T.span;
        }
    }
    for (const [tex, div] of T.texScroll) tex.offset.y = (D / div) % 1;
}

//  GAME-DATA-START
// =====================================================================
//  场景/障碍 纯数据与纯逻辑（无 THREE 依赖，Node 测试直接提取本段运行）
// =====================================================================
// 障碍注册表：高度 / 半宽 / 是否可站（ride）/ 特殊机制（bounce 车顶弹跳、wobble 横移）
const OBSTACLE_DEFS = {
    train:     { h1: 3.0 /* =TRAIN_H */, ride: true, name: '火车' },
    ramp:      { h1: 0, hw: 1.0 },
    lowBar:    { h1: 1.0 },
    highBar:   { h0: 1.35, h1: 2.6 },
    bus:       { h1: 3.1, hw: 1.25, ride: true },
    truck:     { h1: 3.3, hw: 1.25, ride: true },
    car:       { h1: 1.45, hw: 0.9, ride: true, bounce: 7.2, name: '小汽车' },   // 城市·车顶弹跳
    scaffold:  { h0: 1.30, h1: 2.6 },
    cone:      { h1: 0.85, hw: 0.7 },
    schoolbus: { h1: 2.89, hw: 1.25, ride: true },                              // 车顶实测 2.89（roof 2.67+0.45/2）；写 3.0 会让站上车顶的角色浮空 11cm
    bike:      { h1: 1.0, hw: 0.8, wobble: 1.6, name: '自行车' },                // 校园·轻微横移（实测 1.15 跳跃余量不足，降至与 lowBar 同档）
    banner:    { h0: 1.15, h1: 2.6 },
    hurdle:     { h1: 0.95, hw: 0.9 },
    // 隧道·支撑柱：从地面顶到拱顶，跳不过去也站不上，碰到就是死（deadly）
    pillar:     { h1: 7.2, hw: 1.0, deadly: true, name: '支撑柱' },
};
// 每个场景使用的障碍类型
const SCENE_OBSTACLES = {
    lakeside: ['train', 'lowBar', 'highBar'],
    tunnel:   ['train', 'lowBar', 'highBar', 'pillar'],
    city:     ['bus', 'truck', 'car', 'scaffold', 'cone'],
    campus:   ['schoolbus', 'bike', 'banner', 'hurdle'],
    campus2:  ['schoolbus', 'bike', 'banner', 'hurdle'],
};
// 每个地图一种「行驶障碍」：迎着主角开（o.moving + o.extra 速度），任何接触直接失败
const MOVING_OBSTACLE = { lakeside: 'train', tunnel: 'train', city: 'car', campus: 'bike', campus2: 'bike' };
// 行驶障碍撞击时护盾默认无效；护盾升级到该等级及以上才能挡下一次行驶撞击
const MOVING_SHIELD_LV = 5;

// 每段固定 3500 米：跑满 3500 米才换一次场景（原来是 1500 米）
const SCENE_SEG_LEN = { lakeside: [3000, 3000], tunnel: [3000, 3000], city: [3000, 3000], campus: [3000, 3000] };
// 单人固定循环：湖畔轨道 → 火车隧道 → 城市街区 → 燕园·未名湖 → 回到轨道。
// 不再有加权随机：顺序永远一样，跑到哪一段都能预判下一张图。
// （医学部 campus2 不进循环，需要时用 ?theme=campus2 单独进）
const SCENE_SEQ = ['lakeside', 'tunnel', 'city', 'campus', 'campus2'];
// campus2（医学部）紧跟在燕园后面：燕园段尾声的川大门就是通往它的传送门

// ---- 隧道·支撑柱阵（一柱一柱排开，段与段之间留出能横切的间隙）----
const PILLAR_STEP = 3.0;                 // 立柱间距（沿轨道，米）
const PILLAR_CFG = {
    cols: [5, 8],                        // 每段柱子几根立柱 → 段长 (cols-1)×3 = 12~21 米
    gap: [24, 34],                       // 两段柱子之间的间隙：唯一的横切通道
    span: [150, 220],                    // 单段柱阵覆盖的里程
    cooldown: 320,                       // 两段柱阵之间至少空出的里程
    firstAfter: 380,                     // 进隧道后至少跑这么远才会遇到柱阵
    trainLead: [40, 110],                // 柱阵内那辆行驶火车的出现位置偏移
};

// ---- 复活币：概率随里程累积 ----
// 规则：从 100 米开始，每 100 米结算一次；第 n 个 100 米 = n×0.5% 概率（0.5%,1%,1.5%…）；
//       到 5000 米（第 50 次）必出，不看概率；出过之后概率清零，重新从 0.5% 开始攒。
const REVIVE_CFG = {
    step: 100,          // 每跑 100 米结算一次
    pctPerStep: 0.5,    // 每过 100 米，概率 +0.5%
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

// 校园·二段跳：空中再按跳，给一次较小冲量（每个腾空周期至多一次）；返回实际 vy（0=未触发）
// 起跳瞬间 vy 仍高于二段跳冲量时禁止触发——否则刚离地就把 vy 从 9.5 覆盖成 7.79，反而削弱跳跃
function tryAirJump(st, sceneId, jumpVel) {
    if (sceneId !== 'campus') return 0;
    if (st.flying || st.grounded || (st.rolling || 0) > 0 || (st.anticip || 0) > 0) return 0;
    if ((st.airJumps || 0) >= 1) return 0;
    if (st.vy > jumpVel * 0.35) return 0;      // 一段跳冲量未耗尽，不接管
    st.airJumps = (st.airJumps || 0) + 1;
    st.vy = jumpVel * 0.82;
    return st.vy;
}

// 城市·车顶弹跳：落在带 bounce 的车顶且下落速度足够时自动弹起；返回弹起速度（0=不弹）
function bounceImpulse(src, vyIn, sceneId) {
    return (src && src.bounce && vyIn < -0.5 && sceneId === 'city') ? src.bounce : 0;
}

// 自行车障碍横移：随里程正弦摆动，返回相对 baseX 的横向偏移
function wobbleOffset(d, speed) { return Math.sin(d * 0.1 * speed) * 0.4; }

// 玩家脚下的支撑面高度（地面 0 / 坡道 / 可站车顶），并返回提供支撑的障碍
function surfaceHeightAt(obstacles, x, y, trainH, drop) {
    // drop：本帧最多会下落的距离。判定「能不能踩上去」时要把这段扫掠算进来，
    // 否则低帧率/高速下落会一帧跨过 0.45m 容差，直接判成撞车（「没按键却死」的根因）。
    const tol = 0.45 + (drop || 0);
    let g = 0, ob = null;
    for (const o of obstacles) {
        if (o.type !== 'ramp' && (!o.ride || o.moving)) continue;   // 行驶中的车辆不能站（迎面开来的车顶弹跳/站立都会变成撞击）
        // 横向窗口必须和 checkCollisions 的 (0.35 + hw) 一致，否则会掉进
        // 「碰得到、抬不上去」的夹缝里，被坡道反复判成侧撞
        if (Math.abs(x - o.x) > 0.35 + (o.hw != null ? o.hw : 1.0)) continue;
        const z0 = o.z - o.len / 2, z1 = o.z + o.len / 2;
        if (z0 > 0 || z1 < 0) continue;
        if (o.ride) {
            if (y >= o.h1 - tol && o.h1 > g) { g = o.h1; ob = o; }
        } else {
            const t = z1 / o.len, k = t < 0 ? 0 : t > 1 ? 1 : t;
            const h = trainH * k;
            // 1.2 = 单帧最大爬升(0.6) 的两倍余量；原来 0.6 正好卡边界，
            // 掉一帧就抬不上去 → 立刻被坡道侧撞判定接住
            if (h <= y + 1.2 + (drop || 0) && h > g) { g = h; ob = o; }
        }
    }
    return { g, ob };
}

// 场景数据自检：每个场景障碍集必须含 可骑乘(ride) + 跳(h0≤0.5) + 钻(h0>0.5) 三类；合法返回 null
function validateSceneData(defs, sceneObstacles) {
    for (const id of Object.keys(sceneObstacles)) {
        const types = sceneObstacles[id];
        if (!types || !types.length) return id + ':empty';
        let ride = 0, jump = 0, duck = 0;
        for (const t of types) {
            const d = defs[t];
            if (!d) return id + ':' + t + ':undef';
            if (d.ride) ride++;
            else if ((d.h0 || 0) > 0.5) duck++;
            else jump++;
        }
        if (!ride || !jump || !duck) return id + ':kinds:' + [ride, jump, duck].join('/');
    }
    return null;
}
//  GAME-DATA-END

// =====================================================================
//  ⑥⑦ 主题注册表与世界重建
//  THEMES[id] = { name, span, env, texScroll, buildWorld, buildDecor }
// =====================================================================
const THEMES = {
    lakeside: {
        name: '湖畔轨道', span: 324, segLen: SCENE_SEG_LEN.lakeside,
        env: {
            bg: 0x8fd3ff, fog: [0x8fd3ff, 70, 190],
            hemi: [0xffffff, 0x6b7a8f, 1.1],
            sun: { color: 0xffffff, i: 1.7, pos: [10, 25, 12], shadow: true },
        },
        texScroll: [[groundTex, 4], [trackTex, 2]],
        buildWorld: buildLakesideWorld,
        buildDecor: buildLakesideDecor,
    },
    tunnel: {
        name: '火车隧道', span: 324, segLen: SCENE_SEG_LEN.tunnel,
        env: {
            bg: 0x0b0e14, fog: [0x0b0e14, 30, 150],
            hemi: [0x7d8db4, 0x0a0c12, 0.55],
            sun: { color: 0xffffff, i: 0, pos: [10, 25, 12], shadow: false },
        },
        texScroll: [[trackTex, 2]],
        buildWorld: buildTunnelWorld,
        buildDecor: buildTunnelDecor,
    },
    city: {
        name: '城市街区', span: 324, segLen: SCENE_SEG_LEN.city,
        env: {
            bg: 0x9fd0f5, fog: [0x9fd0f5, 90, 260],
            hemi: [0xffffff, 0x707a88, 1.05],
            sun: { color: 0xffffff, i: 1.6, pos: [10, 25, 12], shadow: true },
        },
        texScroll: [[cityRoadTex, 6.07]],
        buildWorld: buildCityWorld,
        buildDecor: buildCityDecor,
    },
    campus2: {
        name: '医学部', span: 560, segLen: SCENE_SEG_LEN.campus,
        speedMul: 0.78,        // 底板绕玩家转 + 摆件贴身，同速度下观感比直道快，压一档
        env: {
            bg: 0xa8c8ea, fog: [0xdde6f0, 140, 400],
            hemi: [0xf6f9ff, 0x6b7568, 1.05],
            sun: { color: 0xfff0d4, i: 1.58, pos: [20, 15, 11], shadow: true },
        },
        texScroll: [],
        buildWorld: buildCampusWorld,
        buildDecor: buildCampusDecor,
    },
    campus: {
        name: '燕园·未名湖', span: 560, segLen: SCENE_SEG_LEN.campus,
        speedMul: 0.72,        // 同上：燕园是第 4 段，绝对速度已到 35m/s，压到 ~25m/s
        env: {
            bg: 0x9fc4e6, fog: [0xd9e4ee, 150, 420],
            hemi: [0xfff6e8, 0x6f7a5a, 1.05],
            sun: { color: 0xffe0b0, i: 1.62, pos: [22, 16, 12], shadow: true },
        },
        texScroll: [],
        buildWorld: buildCampusWorld,
        buildDecor: buildCampusDecor,
    },
};

let curTheme = 'lakeside';

// 应用主题环境：背景 / 雾 / 半球光 / 太阳 / 页面底色
function applyEnv(env) {
    scene.background.set(env.bg);
    scene.fog.color.set(env.fog[0]);
    scene.fog.near = env.fog[1];
    scene.fog.far = env.fog[2];
    hemi.color.set(env.hemi[0]);
    hemi.groundColor.set(env.hemi[1]);
    hemi.intensity = env.hemi[2];
    sun.color.set(env.sun.color);
    sun.intensity = env.sun.i;
    sun.position.set(...env.sun.pos);
    sun.castShadow = env.sun.shadow;
    document.body.style.background = '#' + new THREE.Color(env.bg).getHexString();
}

// 重建整个世界（静态 + 装饰 + 环境）
function buildWorld(id) {
    const T = THEMES[id];
    if (!T) return;
    curTheme = id;
    if (typeof ART !== 'undefined' && id !== 'city') ART.hideCity();
    for (const _S of Object.values(CAMPUS_SETS)) {
        if (_S.group) _S.group.visible = (_S.id === id);   // 两个校园底板各自对齐
    }
    for (let i = worldGroup.children.length - 1; i >= 0; i--) disposeObj(worldGroup.children[i]);
    scenery.length = 0;
    T.buildWorld();
    T.buildDecor();
    // 装饰按材质合并成少量大网格（两副本交替滚动），drawcall 从数百降到「材质数×2」
    const batched = buildTiledDecor(T.span);
    if (batched) {
        scenery.length = 0;
        for (const o of batched) scenery.push(o);
    } else {
        // 降级：合并不了时退回逐对象合并（仍然减少一部分 drawcall）
        for (let i = 0; i < scenery.length; i++) {
            const src = scenery[i];
            const merged = mergeSceneryGroup(src);
            if (merged === src) continue;
            worldGroup.remove(src);
            worldGroup.add(merged);
            merged.position.z = src.position.z;
            scenery[i] = merged;
        }
    }
    let _meshAfter = 0;
    worldGroup.traverse(o => { if (o.isMesh) _meshAfter++; });
    const staticBatches = mergeStaticWorld();
    let _meshFinal = 0;
    worldGroup.traverse(o => { if (o.isMesh) _meshFinal++; });
    MERGE_STATE = (mergeGeometries ? 'ok' : 'unavailable') + ' | scenery=' + scenery.length +
        ' | batched=' + (batched ? 'yes' : 'no') + ' | staticBatches=' + staticBatches +
        ' | worldMeshes=' + _meshFinal;
    applyEnv(T.env);
    const hs = $('hudScene'); if (hs) hs.textContent = T.name;
    if (typeof ATMO !== 'undefined') ATMO.onScene(id, T.name);
    // 换世界后：重算点光预算、剔掉小摆件的投影、强制刷新一次阴影贴图
    if (QUALITY.tier !== 'high' && QP().shadow) trimShadowCasters(worldGroup);
    trimPointLights();
    renderer.shadowMap.needsUpdate = true;
}

// 真实校园底板：必须在第一次 buildWorld('campus') 之前载入。
// 注意只能载入一次——8MB 的 GLB 解析两遍等于白烧内存和启动时间，
// 而且会在场景里多挂一整份不可见的底板（drawcall 与显存都翻倍）。
try { await loadCampusPlates(); } catch (e) { console.warn('[campus] 底板载入失败，回退成直道', e); }

buildWorld('lakeside');

// =====================================================================
//  ⑥⑧ 场景管理器：段落长度 / 黑场转场 / 下一场景选择
//  phase: run（正常跑）→ fadeOut（渐黑）→ 黑场中换世界 → fadeIn（渐亮）→ run
// =====================================================================
const Scene = {
    id: 'lakeside',
    segEnd: SCENE_SEG_LEN.lakeside[0],   // 本段结束里程（首段同样是整段 3000 米）
    phase: 'run',                        // run | portalIn | portalOut | fadeOut | fadeIn
    t: 0, flash: false, fadeNext: null,
    next: null,                          // 下一段场景（开段时就定好，便于提前布置洞口）
    queue: [],                           // 固定循环走 SCENE_SEQ；这个队列只给 ?seq= 调试覆盖
};

function randRange(a, b) { return a + Math.random() * (b - a); }

function setFade(opacity, dur, color) {
    const f = $('fade');
    if (!f) return;
    if (color) f.style.background = color;
    f.style.transition = `opacity ${dur}s linear`;
    f.style.opacity = opacity;
}

// 下一场景：按 SCENE_SEQ 固定循环，不再随机。
// Scene.queue 只留给调试用 ?seq=a,b 覆盖（截图 / 转场测试），正常游玩永远是空数组。
function pickNextScene() {
    while (Scene.queue.length && Scene.queue[0] === Scene.id) Scene.queue.shift();
    if (Scene.queue.length) return Scene.queue.shift();
    const i = SCENE_SEQ.indexOf(Scene.id);
    return SCENE_SEQ[(i + 1) % SCENE_SEQ.length];   // 不在循环里的图（医学部）跑完回轨道
}

// 黑场中真正切换世界：清场 → 重建 → 留安全缓冲段 + 短暂无敌
function doSceneSwap(next) {
    clearGrandLisboa();                 // 新葡京是按里程临时加的，换场必须清掉
    Scene.fanfareDone = false;          // 新的一段重新允许触发终点环绕
    // 复活币是稀有品：换场会把场上东西全清掉，别让刚刷出来、玩家还没跑到的那个白丢
    const carryRevive = pickups.some(p => p.type === 'revive');
    for (const o of obstacles) disposeObj(o.mesh);
    for (const c of coins) scene.remove(c.mesh);
    for (const p of pickups) disposeObj(p.mesh);
    obstacles.length = coins.length = pickups.length = 0;
    buildWorld(next);
    Scene.id = next;
    Scene.segEnd = S.D + randRange(...THEMES[next].segLen);
    S.nextRowS = S.D + 70;              // 换场后 70m 无障碍缓冲
    S.transGrace = 1.2;                 // 转场无敌，防止黑场撞车
    S.pillar = newPillarState(S.D);     // 柱阵按新场景的里程重新排期
    S.laneFree = [0, 0, 0];
    S.laneSafeUntil = [0, 0, 0];
    if (!S.flying) { S.y = 0; S.vy = 0; S.grounded = true; }
    Scene.next = pickNextScene();       // 本段一开始就定好下一段，段落尾声好提前布置洞口
    if (carryRevive) placeRevive(S.D + 80);   // 换场后重新摆到新地图上（概率已经清零，不该白丢）
}

// ---- 隧道口过场：进洞 / 出洞 ----
// 段落尾声先把洞口摆到轨道前方 100m 处（远处渐渐变大，不会凭空冒出）；
// 跑到洞口时，拱内芯（进洞=漆黑 / 出洞=白昼）糊满画面，再换世界。
// 观感是"一头扎进洞口"，而不是凭空黑屏。
const PORTAL_CFG = {
    previewLead: 100,   // 提前 100m 把洞口摆好
    startGap: 8,        // 转场开始时洞口距镜头 8m
    endZ: 2,            // 推到此处时画面已被内芯完全遮挡，执行换场
    fadeLeadZ: -2,      // 提前压黑/压白，确保换场瞬间覆盖层已不透明
};

// 传送门的「逻辑里程」：弯道上 position.z 是投影后的世界坐标，不能拿来判断推进
function portalZ(g) {
    if (!g) return 0;
    return g.userData.tz != null ? g.userData.tz : g.position.z;
}

const PortalFX = { group: null, kind: null, next: null, armed: false, lastKind: null };
// 传送门逐帧动画（霓虹呼吸 / 光环旋转 / 扫描线 / 碎片浮动）
const PortalAnim = { t: 0, items: null };
function updatePortalFX(dt) {
    const it = PortalAnim.items;
    if (!it) return;
    PortalAnim.t += dt;
    const t = PortalAnim.t;
    for (const r of it.rings) r.mesh.rotation.z = r.spd * t + r.ph;
    for (const p of it.pulse) p.mat.opacity = p.base * (0.72 + 0.28 * Math.sin(t * p.fr + p.ph));
    if (it.scan) it.scan.offset.y = (t * 0.55) % 1;   // scanTex 本身就是贴图，别再取 .map
    if (it.core) it.core.material.opacity = 0.72 + 0.18 * Math.sin(t * 3.1);
    for (const s of it.shards) {
        s.mesh.position.y = s.y0 + Math.sin(t * s.fr + s.ph) * 0.55;
        s.mesh.rotation.y = t * s.spd;
        s.mesh.rotation.x = t * s.spd * 0.62;
    }
    for (const g of it.glitch) {
        g.mesh.visible = Math.sin(t * g.fr + g.ph) > 0.62;
        if (g.mesh.visible) g.mesh.material.opacity = 0.25 + 0.55 * Math.random();
    }
}
function clearPortalAnim() { PortalAnim.t = 0; PortalAnim.items = null; }

// ---- 赛博朋克传送门：霓虹门框 + 双层旋转光环 + 全息门面 + 扫描线 + 浮动碎片 ----
let cyberCoreTex = null, cyberScanTex = null, cyberGlowTex = null;
function cyberTextures() {
    if (cyberCoreTex) return;
    cyberCoreTex = makeTex(128, 128, (c, w, h) => {
        const grd = c.createRadialGradient(w / 2, h / 2, 3, w / 2, h / 2, w * 0.52);
        grd.addColorStop(0, '#d9fbff');
        grd.addColorStop(0.26, '#7fe8ff');
        grd.addColorStop(0.48, '#2f7bff');
        grd.addColorStop(0.74, '#9c1dff');
        grd.addColorStop(1, 'rgba(14,0,34,0.92)');
        c.fillStyle = grd; c.fillRect(0, 0, w, h);
    }, 1, 1);
    cyberScanTex = makeTex(64, 256, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        for (let y = 0; y < h; y += 6) {
            c.fillStyle = 'rgba(150,244,255,' + (y % 12 ? 0.05 : 0.2) + ')';
            c.fillRect(0, y, w, 2);
        }
        for (let i = 0; i < 26; i++) {
            c.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '255,90,205' : '120,240,255') + ',' + rand(0.05, 0.22) + ')';
            c.fillRect(rand(0, w), rand(0, h), rand(6, 26), rand(1, 3));
        }
    }, 1, 2);
    cyberGlowTex = makeTex(64, 64, (c, w, h) => {
        const grd = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        grd.addColorStop(0, 'rgba(255,255,255,0.95)');
        grd.addColorStop(0.35, 'rgba(150,240,255,0.45)');
        grd.addColorStop(1, 'rgba(120,200,255,0)');
        c.fillStyle = grd; c.fillRect(0, 0, w, h);
    }, 1, 1);
}

// 赛博朋克传送门：城市 → 校园的专用入口
function makeCyberPortal() {
    cyberTextures();
    const g = new THREE.Group();
    const W = 18, H = 17;                 // 门面尺寸（跑到跟前时糊满画面）
    const neonCyan = new THREE.MeshBasicMaterial({ color: 0x35f0ff, fog: false });
    const neonPink = new THREE.MeshBasicMaterial({ color: 0xff35c8, fog: false });
    const neonViolet = new THREE.MeshBasicMaterial({ color: 0x9a5bff, fog: false });
    const frameMat = std(0x14161d, { roughness: 0.35, metalness: 0.85 });
    const pulse = [];
    const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); g.add(mesh); return mesh; };

    // ① 门面：全息核心 + 扫描线层
    const core = add(new THREE.Mesh(new THREE.PlaneGeometry(W, H),
        new THREE.MeshBasicMaterial({ map: cyberCoreTex, transparent: true, opacity: 0.66,
            blending: THREE.AdditiveBlending, depthWrite: false, fog: false })), 0, H / 2, -1.2);
    const scanTex = cyberScanTex.clone();
    scanTex.userData.shared = false;
    scanTex.wrapS = scanTex.wrapT = THREE.RepeatWrapping;
    scanTex.needsUpdate = true;
    const scanMat = new THREE.MeshBasicMaterial({ map: scanTex, transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    add(new THREE.Mesh(new THREE.PlaneGeometry(W, H), scanMat), 0, H / 2, -0.9);

    // ② 门框：两根立柱 + 门楣 + 底座（黑金属 + 霓虹内嵌条）
    for (const s of [-1, 1]) {
        add(new THREE.Mesh(new THREE.BoxGeometry(1.3, H + 2.4, 1.6), frameMat), s * (W / 2 + 0.8), (H + 2.4) / 2, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.22, H - 1.2, 0.22), s < 0 ? neonCyan : neonPink), s * (W / 2 + 0.12), H / 2, 0.3);
        add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 3.4), frameMat), s * (W / 2 + 0.8), 0.25, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 0.5), neonViolet), s * (W / 2 + 0.8), 0.55, 1.4);
        for (let k = 0; k < 5; k++) {     // 立柱上的故障灯块
            add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.32), k % 2 ? neonPink : neonCyan),
                s * (W / 2 + 1.5), 3.0 + k * 2.6, 0.5);
        }
    }
    add(new THREE.Mesh(new THREE.BoxGeometry(W + 3.4, 1.6, 1.8), frameMat), 0, H + 1.6, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 0.2, 0.24), neonCyan), 0, H + 0.9, 0.5);
    add(new THREE.Mesh(new THREE.BoxGeometry(W - 2.0, 0.14, 0.24), neonPink), 0, H + 2.3, 0.5);

    // ③ 双层旋转光环：反向转，像正在充能的传送装置
    const rings = [];
    for (const [rad, tube, mat, seg, spd] of [[7.6, 0.16, neonCyan, 44, 0.9], [6.1, 0.11, neonPink, 36, -1.35]]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, tube, 8, seg), mat);
        ring.position.set(0, H / 2, 0.35);
        g.add(ring);
        rings.push({ mesh: ring, spd, ph: rand(0, 6.28) });
    }
    // 环上挂几颗光点
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        const dot = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6),
            new THREE.MeshBasicMaterial({ map: cyberGlowTex, transparent: true, opacity: 0.75,
                blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        dot.position.set(Math.cos(a) * 7.6, H / 2 + Math.sin(a) * 7.6, 0.5);
        g.add(dot);
    }

    // ④ 浮动碎片 + 门面故障条
    const shards = [];
    for (let i = 0; i < 12; i++) {
        const s = rand(0.35, 1.1);
        const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * rand(0.5, 1.6), s * 0.25),
            i % 3 === 0 ? neonPink : (i % 3 === 1 ? neonCyan : neonViolet));
        const x = rand(-W * 0.62, W * 0.62), y = rand(1.5, H - 1.0);
        m.position.set(x, y, rand(-0.4, 1.6));
        g.add(m);
        shards.push({ mesh: m, y0: y, fr: rand(0.5, 1.5), ph: rand(0, 6.28), spd: rand(0.3, 1.1) * (Math.random() < 0.5 ? 1 : -1) });
    }
    const glitch = [];
    for (let i = 0; i < 6; i++) {
        const wBar = rand(2.5, W * 0.85);
        const mat = new THREE.MeshBasicMaterial({ color: i % 2 ? 0x9df6ff : 0xff5ad0, transparent: true,
            opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(wBar, rand(0.12, 0.4)), mat);
        m.position.set(rand(-W * 0.2, W * 0.2), rand(2, H - 1), 0.1);
        g.add(m);
        glitch.push({ mesh: m, fr: rand(2.5, 7), ph: rand(0, 6.28) });
    }

    // ⑤ 地面导流线：从远处一路亮进门里（半透明，别比轨道还抢眼）
    for (const s of [-1, 1]) {
        const lm = new THREE.MeshBasicMaterial({
            color: s < 0 ? 0x35f0ff : 0xff35c8, transparent: true, opacity: 0.55,
            blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        });
        add(new THREE.Mesh(new THREE.PlaneGeometry(0.34, 26), lm).rotateX(-Math.PI / 2), s * 3.1, 0.06, 12);
    }

    for (const p of [core]) pulse.push({ mat: p.material, base: 0.82, fr: 2.4, ph: 0 });
    PortalAnim.t = 0;
    PortalAnim.items = { rings, pulse, shards, glitch, scan: scanTex, core };
    return g;
}

// =====================================================================
//  新葡京大楼：传送门正后方的金色路标
//  作用：玩家在雾里先看到这座金色塔，就知道「传送门要到了」。
//  关键：必须 fog:false —— 各档雾的 far 只有 100 / 76 / 62，不穿雾就永远看不见。
//  造型取自澳门新葡京：外张莲座 → 收分塔身 → 外张莲瓣冠 → 尖针。
// =====================================================================
// 注意：主相机 far = 230，所以路标只能摆在 230m 内才有意义。
// 传送门生成时在 z = −108，大楼放在它正后方 100m（z = −208）——正好卡在远平面内侧，
// 再远就是白摆。两者同帧摆出，相对位置恒定，滚动时永远保持"门在前、楼在后"。
const LISBOA_CFG = {
    gap: 100,      // 大楼在传送门正后方多少米
};
const LisboaFX = { group: null };

// 灯光分层：自发光按高度分 5 档（0.14 → 0.24 → 0.38 → 0.54 → 0.74），
// 塔身就有了垂直亮度梯度，而不是一整根同亮度的金柱子——那是"灯光基础"的根源。
// 再叠两类"线"（亮描边 / 暗竖棱）做横向量化节奏，最后三层辉光拉开空间层次。
let lisboaBase = null, lisboaGold = null, lisboaGoldMid = null, lisboaGoldLt = null,
    lisboaCrown = null, lisboaHot = null, lisboaEdge = null, lisboaRib = null,
    lisboaGlowWide = null, lisboaGlowMid = null, lisboaGlowHot = null, lisboaWashTex = null;
function lisboaMats() {
    if (lisboaGold) return;
    cyberTextures();                       // 借 cyberGlowTex 做光晕
    const tier = (color, emis, inten, metal, rough) => shared(std(color, {
        metalness: metal, roughness: rough,
        emissive: emis, emissiveIntensity: inten, fog: false,
    }));
    lisboaBase    = tier(0x8a6020, 0xff6a08, 0.14, 0.90, 0.30);   // 莲座：暗铜，只靠边线交代轮廓
    lisboaGold    = tier(0xb8842a, 0xff8c10, 0.42, 0.88, 0.24);   // 塔身下段（带洗墙渐变）
    lisboaCrown   = tier(0xdcae48, 0xffbc38, 0.58, 0.82, 0.18);   // 莲瓣冠冠体：不吃洗墙渐变，必须比塔身顶亮
    lisboaGoldMid = tier(0xc9952f, 0xffa41c, 0.42, 0.86, 0.22);   // 塔身中段
    lisboaGoldLt  = tier(0xdcae48, 0xffbc38, 0.42, 0.82, 0.18);   // 塔身上段 / 冠体
    lisboaHot     = tier(0xf0cd74, 0xffd863, 0.74, 0.74, 0.14);   // 莲瓣：最亮的一档

    // ---- 洗墙光贴图：塔身从下往上被打亮，越往上越暗 ----
    // 做成灰度（只调制亮度、不改色相），否则会和 emissive 的橙色叠成一片死黄。
    // canvas 的 y=0 在顶部，而纹理默认 flipY=true → canvas 底部对应圆柱底部，
    // 所以"底部最亮"要写在 canvas 的下半段。
    lisboaWashTex = makeTex(16, 256, (c, w, h) => {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0.00, 'rgba(112,112,112,1)');    // 塔身高处：衰减到 0.44
        g.addColorStop(0.35, 'rgba(178,178,178,1)');
        g.addColorStop(0.72, 'rgba(238,238,238,1)');
        g.addColorStop(1.00, 'rgba(255,255,255,1)');    // 塔身低处：满亮
        c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    // 塔身三段共用这一张图，但各取 1/3 段（repeat.y = 1/3 + 不同 offset），
    // 拼起来是**一条连续渐变**；如果每段都取全图，就会变成"每段各自亮一遍"，
    // 塔身上出现两道突兀的接缝。
    const washSlice = (i) => {
        const t = lisboaWashTex.clone();
        t.needsUpdate = true;
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.repeat.set(1, 1 / 3);
        t.offset.set(0, i / 3);
        return t;
    };
    lisboaGold.emissiveMap = washSlice(0);
    lisboaGoldMid.emissiveMap = washSlice(1);
    lisboaGoldLt.emissiveMap = washSlice(2);
    lisboaEdge = shared(new THREE.MeshBasicMaterial({ color: 0xffd98a, fog: false }));  // 亮描边
    lisboaRib  = shared(new THREE.MeshBasicMaterial({ color: 0x9a6420, fog: false }));  // 暗棱 / 暗环：比亮棱暗一档做"暗缝"，但别压成黑线——压太狠整座塔会变成鸟笼骨架
    const glow = (op, color) => shared(new THREE.MeshBasicMaterial({
        map: cyberGlowTex, color, transparent: true, opacity: op,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    lisboaGlowWide = glow(0.12, 0xffa01e);   // 第一层：大范围环境辉光，只负责"远处先看到一团暖光"
    lisboaGlowMid  = glow(0.16, 0xffb52e);   // 第二层：主体辉光
    lisboaGlowHot  = glow(0.36, 0xffd76a);   // 第三层：冠部热点，最亮最小
}

// 把一堆 mesh 按材质烘成几个大网格：这座塔 50 多个零件，不合并就是 50 次 drawcall，
// 恰好压在玩家最需要流畅的段落尾声上。
function bakeByMaterial(root) {
    if (!mergeGeometries) return root;
    try {
        root.updateMatrixWorld(true);
        const meshes = [];
        root.traverse(o => { if (o.isMesh) meshes.push(o); });
        const byMat = new Map();
        for (const o of meshes) {
            const bg = o.geometry.clone();
            bg.applyMatrix4(o.matrixWorld);
            if (!byMat.has(o.material)) byMat.set(o.material, []);
            byMat.get(o.material).push(bg);
        }
        const out = new THREE.Group();
        for (const [mat, geos] of byMat) {
            const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
            if (!merged) return root;          // 合并不了就退回原结构，别把塔弄丢
            out.add(new THREE.Mesh(merged, mat));
        }
        for (const o of meshes) {
            // 共享几何（oldtown 的尺寸缓存 userData.shared）不能释放，
            // 否则整条街的塔会在下一帧变成空白
            if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        }
        return out;
    } catch (e) {
        return root;
    }
}

// =====================================================================
//  新葡京 GLB（可选）：美术模型 + 代码生成的光效层
//
//  为什么光效不能只靠模型：
//    模型是单材质（Material.001）、贴图是白天光照的 PBR baseColor。直接当自发光用
//    会变成一整块发光板，没有任何明暗层次。这里做三件事把层次做出来：
//      ① shader 按【世界高度】做洗墙渐变（不依赖 UV，单材质也有效）：
//         塔脚最亮 → 塔身中段沉下去 → 冠部再抬起来，形成「下亮-中暗-上亮」三段
//      ② 叠三层 additive 辉光（大范围弱 / 主体中 / 冠部热点），拉开空间纵深
//      ③ 塔脚地面光池：暖光从街面打上来，塔脚不再是插在地上的一根柱子
// =====================================================================
let LISBOA_GLB = null;
// 相对路径 + 可被内联成 gz: data URI（tools/inline-extra.py）
const LISBOA_URL = 'gz:model/gltf-binary;base64,OMITTED-08-4.17MB-see-INLINE-ASSETS-md';
const LISBOA_H = 74;        // 归一化目标高度（= 代码版最终高度，见 makeGrandLisboa 尾部注释）

function normalizeLisboa(root) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // 底面贴地 + 水平居中
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;

    const wrap = new THREE.Group();
    wrap.add(root);
    wrap.scale.setScalar(LISBOA_H / Math.max(size.y, 0.001));
    wrap.updateMatrixWorld(true);

    // ---- 材质：压暗 + 金色自发光 + 竖向洗墙 shader ----
    const seen = new Set();
    let tris = 0;
    root.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry;
        if (g) tris += (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!m || seen.has(m.uuid)) return;
        seen.add(m.uuid);

        m.color.multiplyScalar(0.52);                 // 白天也不过曝
        m.emissive = new THREE.Color(0xffd88a);       // 淡金：和贴图的暖色相乘不会偏脏
        if (m.map) m.emissiveMap = m.map;
        m.emissiveIntensity = 0.72;
        m.fog = false;                                // 路标必须穿雾，这点和传送门一致
        m.needsUpdate = true;

        // shader 注入：按世界 Y 做三段亮度。用 onBeforeCompile 而不是 emissiveMap，
        // 是因为模型的 UV 是包装 atlas，拿不到「从下到上」这条轴。
        m.onBeforeCompile = (shader) => {
            shader.uniforms.uLisboaY0 = { value: 0 };
            shader.uniforms.uLisboaH = { value: LISBOA_H };
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying float vLisboaY;')
                .replace('#include <begin_vertex>',
                    '#include <begin_vertex>\n\tvLisboaY = (modelMatrix * vec4(transformed, 1.0)).y;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>',
                    '#include <common>\nvarying float vLisboaY;\nuniform float uLisboaY0;\nuniform float uLisboaH;')
                .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    float hN = clamp((vLisboaY - uLisboaY0) / max(uLisboaH, 0.001), 0.0, 1.0);
    // 洗墙：塔脚 1.0，到 70% 高处沉到 0.30；冠部 70%→96% 再抬到 0.92
    float wash = mix(1.0, 0.40, smoothstep(0.0, 0.70, hN));
    float crown = smoothstep(0.70, 0.96, hN) * 0.55;
    totalEmissiveRadiance *= (wash + crown);`);
        };
        // 同一个材质只编译一次，别和别的标准材质共用 program
        m.customProgramCacheKey = () => 'lisboa-glb-wash';
    });

    console.log('[lisboa] GLB 接入：' + Math.round(tris) + ' 面 · 高 ' + LISBOA_H + 'm');
    return wrap;
}

async function loadLisboaGLB() {
    try {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader().loadAsync(await resolvePlate(LISBOA_URL));
        LISBOA_GLB = normalizeLisboa(gltf.scene);
    } catch (e) {
        console.info('[lisboa] 没有 GLB，用代码生成版');
    }
}

// GLB 版：塔身来自模型，光效仍是代码生成（和代码版同一套亮度预算）
function makeGrandLisboaGLB() {
    lisboaMats();
    const g = new THREE.Group();
    g.add(LISBOA_GLB.clone(true));

    // 光效层单独打包，最后统一烘焙 —— GLB 不参与合并（材质不同）
    const fx = new THREE.Group();
    const put = (geo, mat, x, y, z, rot) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
        fx.add(m);
        return m;
    };

    // ① 塔脚地面光池：暖光从街面打上来
    put(new THREE.PlaneGeometry(62, 62), lisboaGlowMid, 0, 1.0, 0, [-Math.PI / 2, 0, 0]);

    // ② 三层辉光：大范围弱 → 主体中 → 冠部热点
    for (const [size, y, mat] of [[78, 50, lisboaGlowWide], [42, 62, lisboaGlowMid], [20, 73, lisboaGlowHot]]) {
        put(new THREE.PlaneGeometry(size, size), mat, 0, y, 0, [0, Math.PI / 4, 0]);
        put(new THREE.PlaneGeometry(size, size), mat, 0, y, 0, [0, -Math.PI / 4, 0]);
    }

    // ③ 塔尖的一点亮：模型顶部如果本身有针，这里补一颗灯把它点出来
    put(new THREE.SphereGeometry(1.8, 10, 8), lisboaHot, 0, LISBOA_H - 1.2, 0);

    const baked = bakeByMaterial(fx);
    if (baked) g.add(baked);
    g.userData.noMerge = true;      // 有 GLB，整组退出按材质大合并
    return g;
}

function makeGrandLisboa() {
    if (LISBOA_GLB) return makeGrandLisboaGLB();   // 有模型就用模型 + 光效层
    lisboaMats();
    const g = new THREE.Group();
    const put = (geo, mat, x, y, z, rot) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
        g.add(m);
        return m;
    };

    // ① 莲座 0~20：暗铜主体 + 上下两道亮环 + 20 片花瓣鳍
    //    「下亮 → 中暗 → 上亮」这个节奏是照着地面洗墙灯做的；
    //    三环同亮就变成三条一模一样的金线，没有层次。
    put(new THREE.CylinderGeometry(22, 20, 7, 20), lisboaBase, 0, 3.5, 0);
    put(new THREE.CylinderGeometry(19, 22, 7, 20), lisboaBase, 0, 10.5, 0);
    put(new THREE.CylinderGeometry(14, 19, 6, 20), lisboaBase, 0, 17, 0);
    for (const [rr, yy, mat] of [[22.1, 7, lisboaEdge], [19.4, 14, lisboaRib], [14.2, 19.6, lisboaEdge]]) {
        put(new THREE.TorusGeometry(rr, 0.22, 4, 24), mat, 0, yy, 0, [Math.PI / 2, 0, 0]);
    }
    // 地面光池：暖光从街面打上来，塔脚不再是"插在地上的一根柱子"
    put(new THREE.PlaneGeometry(54, 54), lisboaGlowMid, 0, 1.0, 0, [-Math.PI / 2, 0, 0]);
    // 花瓣鳍压到中暗档，把最亮的位置留给莲瓣冠
    for (let i = 0; i < 20; i++) {
        const h = new THREE.Group();
        h.rotation.y = i * Math.PI * 2 / 20;
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 15, 2.2), lisboaGold);
        m.position.set(0, 10, 20.6);
        m.rotation.x = -0.30;                  // 上端向外倾，做出莲瓣张开
        h.add(m);
        g.add(h);
    }

    // ② 塔身 20~56：三段收分，自发光逐段递增（0.24 → 0.38 → 0.54）
    put(new THREE.CylinderGeometry(10.6, 14, 12, 18), lisboaGold, 0, 26, 0);
    put(new THREE.CylinderGeometry(8.6, 10.6, 12, 18), lisboaGoldMid, 0, 38, 0);
    put(new THREE.CylinderGeometry(6.8, 8.6, 12, 18), lisboaGoldLt, 0, 50, 0);
    // 楼层环：下两道压暗、上三道提亮，横向也做出梯度
    const bodyR = y => 14 - (y - 20) * (14 - 6.8) / 36;
    for (const y of [24, 30]) put(new THREE.TorusGeometry(bodyR(y) + 0.1, 0.16, 4, 20), lisboaRib, 0, y, 0, [Math.PI / 2, 0, 0]);
    for (const y of [36, 42, 48]) put(new THREE.TorusGeometry(bodyR(y) + 0.1, 0.16, 4, 20), lisboaEdge, 0, y, 0, [Math.PI / 2, 0, 0]);
    // 8 条竖棱拆成上下两段：下段暗、上段亮，沿高度自然过渡
    for (let i = 0; i < 8; i++) {
        const h = new THREE.Group();
        h.rotation.y = i * Math.PI * 2 / 8;
        for (const [y0, y1, mat] of [[20.5, 38, lisboaRib], [38, 55.5, lisboaEdge]]) {
            const r0 = bodyR(y0) - 0.05, r1 = bodyR(y1) - 0.05;
            const len = Math.hypot(y1 - y0, r1 - r0);
            const m = new THREE.Mesh(new THREE.BoxGeometry(0.30, len, 0.30), mat);
            m.position.set(0, (y0 + y1) / 2, (r0 + r1) / 2);
            m.rotation.x = -Math.atan2(r0 - r1, y1 - y0);
            h.add(m);
        }
        g.add(h);
    }

    // ③ 莲瓣冠 56~74：冠体用次亮档、花瓣用最亮档 —— 内暗外亮，才像"张开的莲瓣在发光"
    put(new THREE.CylinderGeometry(13.2, 6.8, 10, 18), lisboaCrown, 0, 61, 0);
    put(new THREE.CylinderGeometry(15.4, 13.2, 8, 18), lisboaCrown, 0, 70, 0);
    put(new THREE.TorusGeometry(15.5, 0.24, 4, 24), lisboaEdge, 0, 73.8, 0, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 14; i++) {
        const h = new THREE.Group();
        h.rotation.y = i * Math.PI * 2 / 14 + 0.22;
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 11, 2.6), lisboaHot);
        m.position.set(0, 66, 12.6);
        // 倾角决定"开多大"：−0.42 是半开，−0.68 是明显外张。
        // 外移到 12.6 是为了让花瓣上端真正探出冠面（冠体在 y=66 处半径只有 13.2），
        // 否则加大倾角只是让花瓣在冠体里转，外面看不出来。
        m.rotation.x = -0.68;
        h.add(m);
        g.add(h);
    }

    // ④ 针尖 74~86：全塔最亮的一点
    put(new THREE.ConeGeometry(2.6, 15, 10), lisboaEdge, 0, 81.5, 0);
    put(new THREE.SphereGeometry(1.6, 10, 8), lisboaHot, 0, 74.5, 0);

    // ⑤ 三层辉光：大范围弱 → 主体中 → 冠部热点。
    //    原来只有一张 44×44 的大光晕，等于给整座塔糊了一层雾；
    //    三层叠加才有"光从塔身里透出来"的空间层次。
    for (const [size, y, mat] of [[78, 50, lisboaGlowWide], [42, 62, lisboaGlowMid], [20, 73, lisboaGlowHot]]) {
        put(new THREE.PlaneGeometry(size, size), mat, 0, y, 0, [0, Math.PI / 4, 0]);
        put(new THREE.PlaneGeometry(size, size), mat, 0, y, 0, [0, -Math.PI / 4, 0]);
    }

    // 整体缩到 74m 高：相机 FOV 62 / 俯角 −10° 下，可见高度带只有地平线上方 20.6°，
    // 入框条件 h ≤ 4.3 + 0.376·d。大楼首次出现在 207m 处，那里的上限是 82m——
    // 原来的 86m 会把莲瓣冠和针尖切掉，等于把最像新葡京的部分丢了。
    // 74m 在 207m 处完整入画，只在贴近时切掉针尖，同时仍是街上最高地标（58m）的 1.3 倍。
    g.scale.setScalar(74 / 86);

    return bakeByMaterial(g);
}

// 摆到轨道前方：比传送门早 LISBOA_CFG.lead 米出现，
// 这样等传送门在 previewLead 处生成时，大楼正好落在它正后方 gap 米。
function spawnGrandLisboa() {
    if (LisboaFX.group) return;
    const portalZ = -(PORTAL_CFG.previewLead + PORTAL_CFG.startGap);
    const g = makeGrandLisboa();
    g.userData.noMerge = true;
    LisboaFX.group = addScenery(g, portalZ - LISBOA_CFG.gap);
    // 同帧摆出 6 座特色地标的环：跟新葡京一样是「按里程临时加」的，换场一起清
    spawnLandmarkRing(portalZ);
}

// 换场 / 重开时必须清掉：它是按里程临时加进来的，不清理会在新一局的开头残留
function clearGrandLisboa() {
    clearLandmarkRing();                // 地标环跟它同生共死
    const g = LisboaFX.group;
    LisboaFX.group = null;
    if (!g) return;
    worldGroup.remove(g);
    const i = scenery.indexOf(g);
    if (i >= 0) scenery.splice(i, 1);
    g.traverse(o => {
        if (o.isMesh && o.geometry) o.geometry.dispose();
    });
}

// =====================================================================
//  终点地标环：6 座特色地标围着传送门摆成一圈
//
//  为什么需要它：城市街道是 22m 宽的峡谷，地标全贴在 x=±12 的街墙上，
//  360° 环绕时绝大多数地标要么在镜头外，要么被前一栋楼完全挡住——
//  「所有特色建筑都能看到」在街道峡谷里物理上不成立。
//  所以尾声把 6 座地标按**等半径**摆成一圈：
//   · 环心 = 过场触发时玩家所在的位置（= 传送门再往玩家这边 42m）
//   · 6 座等距 → 镜头转到任何方位都有一座正面朝内的地标，且画面里尺寸一致
//   · 角度避开 0°/180°：0° 会横在跑道上，180° 会挡住金色新葡京
//   · 金色新葡京留在环外 180° 方向（142m），当整圈的「门脸」
// =====================================================================
const RING_CFG = {
    radius: 150,        // 环半径（6 座地标到环心等距）
    // a：方位角（0 = 玩家正后方 +z，180 = 新葡京方向 -z）
    slots: [
        { a: -158, kind: 'pearl' },          // 新葡京左：上海东方明珠
        { a: -95, kind: 'gateHangzhou' },    // 左侧：杭州之门
        { a: -32, kind: 'bamboo' },          // 身后左：深圳春笋
        { a: 32, kind: 'guomao' },           // 身后右：北京国贸大厦
        { a: 95, kind: 'gateSuzhou' },       // 右侧：苏州东方之门
        { a: 158, kind: 'waist' },           // 新葡京右：广州塔
    ],
    lead: 42,           // 环心相对传送门向玩家一侧偏移多少米
    // 环上的塔身按 1.6 倍放大（台基不动）。
    // 街道版压到 53~58m 是为了「FOV 62 / 俯角 −10° 下 137m 外刚好整栋入画」，
    // 但在这个尾声机位里，58m 的塔和周围 40~64m 的普通楼完全糊成一片——
    // 放到 90m 左右，它们才会从城市森林里拔出来，成为一圈可辨认的剪影。
    // 比例不变，只是尺度变了（真实地标本来也比周围楼高一个量级）。
    bodyScale: 2.0,
};
const RingFX = { group: null };

// 环心舞台的三件套材质：霓虹环 / 暗环 / 地面辉光。
// fog:false —— 和金色新葡京同一个理由：各档雾 far 只有 100/76/62，
// 不穿雾的话 150m 外这圈光根本看不见。
let ringNeonC = null, ringNeonV = null, ringStageC = null, ringStageV = null, ringHaloC = null, ringGroundMat = null;
function ringMats() {
    if (ringNeonC) return;
    cyberTextures();                        // 借 cyberGlowTex 做辉光
    ringNeonC = shared(new THREE.MeshBasicMaterial({ color: 0x35f0ff, fog: false }));
    ringNeonV = shared(new THREE.MeshBasicMaterial({ color: 0xff35c8, fog: false }));
    // 舞台圈用加法发光而不是实心霓虹：人物视角下相机离它只有 2m，
    // 实心青色会变成一根糊在画面上的「激光环」
    ringStageC = shared(new THREE.MeshBasicMaterial({
        color: 0x35f0ff, transparent: true, opacity: 0.62,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    ringStageV = shared(new THREE.MeshBasicMaterial({
        color: 0xff35c8, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    ringHaloC = shared(new THREE.MeshBasicMaterial({
        map: cyberGlowTex, color: 0x2f7bff, transparent: true, opacity: 0.13,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    // 和城市地面同一个色（0x0e1016），环外的地面才不会跟街面差一截
    ringGroundMat = shared(std(0x0e1016, { roughness: 0.92 }));
}

function spawnLandmarkRing(portalZ) {
    if (RingFX.group || !OLDTOWN || !OLDTOWN.makeRingLandmark) return;
    ringMats();
    const root = new THREE.Group();
    for (const s of RING_CFG.slots) {
        const a = s.a * Math.PI / 180;
        const g = OLDTOWN.makeRingLandmark(s.kind, RING_CFG.bodyScale);
        g.position.set(Math.sin(a) * RING_CFG.radius, 0, Math.cos(a) * RING_CFG.radius);
        g.rotation.y = a - Math.PI / 2;      // 正面（局部 -x）转向环心
        root.add(g);
    }
    // 环心的「舞台」：角色就站在这圈光里。
    // 俯瞰机位下角色只有十几个像素，没有这圈光，画面正中是空的。
    const stage = (geo, mat, y, rot) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.y = y;
        if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
        root.add(m);
    };
    stage(new THREE.TorusGeometry(6.4, 0.30, 6, 48), ringStageC, 0.14, [Math.PI / 2, 0, 0]);
    stage(new THREE.TorusGeometry(8.6, 0.16, 4, 48), ringStageV, 0.10, [Math.PI / 2, 0, 0]);
    stage(new THREE.PlaneGeometry(34, 34), ringHaloC, 0.07, [-Math.PI / 2, 0, 0]);
    // 6 道指向地标的导光条：把「这是一个环」写在地上
    for (const s of RING_CFG.slots) {
        const a = s.a * Math.PI / 180;
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.1, RING_CFG.radius - 12), ringNeonC);
        strip.rotation.x = -Math.PI / 2;
        strip.rotation.z = -a;
        strip.position.set(Math.sin(a) * (12 + (RING_CFG.radius - 12) / 2), 0.06,
            Math.cos(a) * (12 + (RING_CFG.radius - 12) / 2));
        root.add(strip);
    }
    // 6 座 × 40 来个零件 = 240 个 drawcall，必须烘成「按材质」的几个大网格。
    // 烘完几何是环的局部坐标，整组再按环心 z 摆出去。
    const merged = bakeByMaterial(root);
    merged.userData.noMerge = true;

    // 只给环上的地标「开小灶」：把标准材质的自发光提亮。
    // 城市里 40~64m 的楼群到了夜里是一层暗蓝剪影，150m 外的地标如果同亮度，
    // 就完全糊在楼群里——提亮之后，六座塔会像六盏灯一样从城市里浮出来。
    // 材质是 clone 的：ATMO 每帧只写原始材质，clone 出来的亮度不会被它拉回去。
    merged.traverse(o => {
        if (!o.isMesh || !o.material || !o.material.emissive) return;
        const c = o.material.clone();
        c.emissiveIntensity = (c.emissiveIntensity || 0) * 1.5 + 0.12;
        o.material = c;
    });

    RingFX.group = addScenery(merged, portalZ + RING_CFG.lead);
}

function clearLandmarkRing() {
    const g = RingFX.group;
    RingFX.group = null;
    if (!g) return;
    worldGroup.remove(g);
    const i = scenery.indexOf(g);
    if (i >= 0) scenery.splice(i, 1);
    // 烘失败的兜底：几何可能是 oldtown 的共享缓存（userData.shared），绝不能 dispose
    g.traverse(o => {
        if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
}

function makeTransitPortal(kind) {
    if (kind === 'cyber') return makeCyberPortal();
    // 川大校门：校园段尾声的专属传送门。模型加载失败时返回 null，
    // 调度处会改走黑场（和没有洞口的场景一样），不会白屏。
    if (kind === 'gate') {
        if (!GATE_FX.ready || !GATE_FX.proto) return null;
        const g = new THREE.Group();
        const gate = GATE_FX.proto.clone(true);
        gate.scale.setScalar(GATE_SCALE);
        // 底座落地：用模型真实包围盒算抬升量。
        // 原来写死 0.15*GATE_SCALE，是按「包围盒中心在 y=0」猜的，
        // 实际模型是底面在 y=0 → 整座门悬空 4.5m（截图里门底下能看见天）。
        gate.position.y = GATE_FX.baseY * GATE_SCALE;
        gate.userData.noMerge = true;
        g.add(gate);
        // 门洞黑色内芯：高度/宽度按门体比例走，位置贴着地面，穿门时才糊得住画面
        const W = GATE_FX.size.x * GATE_SCALE, H = GATE_FX.size.y * GATE_SCALE;
        const cw = Math.max(18, W * 0.86), chh = Math.max(8, H * 0.60);
        const core = new THREE.Mesh(
            new THREE.PlaneGeometry(cw, chh),
            new THREE.MeshBasicMaterial({ color: 0x04060a, fog: false })
        );
        core.position.set(GATE_FX.center.x * GATE_SCALE, chh * 0.5 + 0.5,
                          GATE_FX.center.z * GATE_SCALE - 2.0);
        g.add(core);
        return g;
    }
    const R = TUNNEL_R;
    const g = new THREE.Group();
    // 拱圈 + 门楣 + 两侧短挡墙：像嵌在山体里的洞口，而不是一整面大灰墙
    g.add(new THREE.Mesh(new THREE.TorusGeometry(R + 0.15, 0.55, 10, 40, Math.PI), portalMat));
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2 * R + 2.6, 1.5, 1.4), portalMat);
    cap.position.set(0, R + 0.85, 0);
    g.add(cap);
    for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, R + 1.4, 1.4), portalMat);
        wing.position.set(s * (R + 1.45), (R + 1.4) / 2, 0);
        g.add(wing);
    }
    // 拱内芯：进洞 = 隧道深处的黑；出洞 = 洞口的白昼
    const core = new THREE.Mesh(
        new THREE.PlaneGeometry(2 * R + 6, R + 5),
        new THREE.MeshBasicMaterial({ color: kind === 'out' ? 0xffffff : 0x04060a, fog: false })
    );
    core.position.set(0, R / 2, -3);
    g.add(core);
    if (kind === 'in') {
        // 洞口内侧透出的第一组顶灯和反光标：让人一眼看出"里面是隧道"，而不是一块黑板
        for (const x of [-4.2, 0, 4.2]) {
            const led = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 2.4), ledMat);
            led.position.set(x, R - 1.5, -1.3);
            g.add(led);
        }
        for (const s of [-1, 1]) {
            const dot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.34), reflMat);
            dot.position.set(s * (R - 0.7), 1.3, -1.3);
            g.add(dot);
        }
    }
    return g;
}

// 段落尾声：把洞口预先摆到轨道前方，之后随世界一起滚向镜头
function spawnPortalPreview(kind, next) {
    PortalAnim.items = null;
    PortalFX.kind = kind;
    PortalFX.next = next;
    PortalFX.armed = false;
    const portal = makeTransitPortal(kind);
    if (!portal) { PortalFX.kind = null; PortalFX.next = null; return; }   // GLB 缺失 → 黑场转场
    PortalFX.group = portal;
    PortalFX.group.userData.noMerge = true;   // 传送门有缩放/透明动画，不能参与静态合并
    PortalFX.group.userData.trackScroll = true;   // 跟着路线投影（校园是弯道）
    PortalFX.group.userData.tz = -(PORTAL_CFG.previewLead + PORTAL_CFG.startGap);
    addScenery(PortalFX.group, -(PORTAL_CFG.previewLead + PORTAL_CFG.startGap));
    // 城市段末尾无论通往哪里（赛博传送门→校园，或隧道口→隧道），都在门后配这座金色路标：
    // 玩家看到它就知道"这一段要结束了、前面就是出口"。Scene.id 此时还是 city。
    if (Scene.id === 'city') spawnGrandLisboa();
}

// 真正进入洞口过场（此时洞口已在前方 8m 左右）
function beginPortal() {
    Scene.phase = PortalFX.kind === 'out' ? 'portalOut' : 'portalIn';
    Scene.t = 0;
    S.transGrace = 99;      // 过场期间无敌，别被残留在轨道上的障碍撞死
}

// 换世界：重建后留安全缓冲段 + 短暂无敌
function swapTo(next) {
    const prev = Scene.id;
    doSceneSwap(next);
    Scene.phase = 'fadeIn'; Scene.t = 0;
    Scene.fadeNext = null;
    Scene.flash = prev === 'tunnel' || PortalFX.lastKind === 'cyber';   // 出隧道 / 穿传送门都过曝一下
    PortalFX.lastKind = null;
    setFade(0, Scene.flash ? 0.3 : 0.55, Scene.flash ? '#fff' : '#000');
    showMsg(next === 'tunnel' ? '驶入隧道，注意支撑柱！' : '抵达：' + THEMES[next].name);
}

function finishPortal() {
    const next = PortalFX.next;
    if (!PortalFX.armed) setFade(1, 0.01, next === 'tunnel' ? '#000' : '#fff');
    PortalFX.lastKind = PortalFX.kind;
    PortalFX.group = null; PortalFX.kind = null; PortalFX.next = null;
    clearPortalAnim();
    swapTo(next);
}

function updateScene(dt) {
    if (Scene.phase === 'run') {
        // 下一段是隧道（要进洞），或本段是隧道（要出洞）→ 提前把洞口摆到轨道前方
        if (!PortalFX.group && Scene.next && S.D >= Scene.segEnd - PORTAL_CFG.previewLead) {
            if (Scene.next === 'tunnel') spawnPortalPreview('in', Scene.next);
            else if (Scene.id === 'tunnel') spawnPortalPreview('out', Scene.next);
            // 城市 → 校园：走赛博朋克传送门，而不是黑场
            else if (Scene.id === 'city' && Scene.next === 'campus') spawnPortalPreview('cyber', Scene.next);
            // 校园段尾声：川大校门立在跑道上，穿过去传送到下一场景
            else if (Scene.id === 'campus' || Scene.id === 'campus2') spawnPortalPreview('gate', Scene.next);
        }
        if (S.D >= Scene.segEnd) {
            Scene.fadeNext = Scene.next || pickNextScene();
            // 有洞口就走进洞/出洞过场，其余场景仍用黑场转场
            if (PortalFX.group) beginPortal();
            else { Scene.phase = 'fadeOut'; Scene.t = 0; setFade(1, 0.45); }
        }
        return;
    }
    Scene.t += dt;

    // 洞口扑面（洞口由世界滚动带过来），糊满画面时换场
    if (Scene.phase === 'portalIn' || Scene.phase === 'portalOut') {
        const g = PortalFX.group;
        if (!g) { Scene.phase = 'run'; Scene.t = 0; return; }
        if (!PortalFX.armed && portalZ(g) >= PORTAL_CFG.fadeLeadZ) {
            PortalFX.armed = true;
            const c = PortalFX.kind === 'out' ? '#fff' : (PortalFX.kind === 'cyber' ? '#120a2e' : '#000');
            setFade(1, 0.22, c);
        }
        if (portalZ(g) >= PORTAL_CFG.endZ) finishPortal();
        return;
    }

    if (Scene.phase === 'fadeOut' && Scene.t >= 0.45) {
        swapTo(Scene.fadeNext || pickNextScene());
        Scene.fadeNext = null;
    } else if (Scene.phase === 'fadeIn' && Scene.t >= (Scene.flash ? 0.3 : 0.55)) {
        Scene.phase = 'run'; Scene.t = 0; Scene.flash = false;
        const f = $('fade'); if (f) f.style.background = '#000';
    }
}

// 开局 / 重开：回到起点场景，重排开场序列（?theme 指定时尊重固定主题）
let urlTheme = null;
// 清掉可能还挂着的洞口过场状态（世界重建时网格已随 worldGroup 销毁）
function clearPortalFX() {
    PortalFX.group = null; PortalFX.kind = null; PortalFX.next = null; PortalFX.armed = false;
    PortalFX.lastKind = null;
    Scene.fadeNext = null;
    clearPortalAnim();
}
function resetScene() {
    Scene.phase = 'run'; Scene.t = 0; Scene.flash = false;
    clearPortalFX();
    // 固定从「湖畔轨道」开局，之后按 SCENE_SEQ 循环（urlTheme 只给 ?theme= 调试用）
    const home = urlTheme || SCENE_SEQ[0];
    if (Scene.id !== home) doSceneSwap(home);
    else { Scene.segEnd = randRange(...THEMES[home].segLen); Scene.next = pickNextScene(); }
    campusResetRun();          // 重开局：路线里程归零（主题没换时也得复位）
    setFade(0, 0.01);
}

// 调试钩子：立即切换到指定场景（截图 / 测试用）
window.__forceTheme = function (id) {
    if (!THEMES[id]) return false;
    Scene.queue = [];
    doSceneSwap(id);
    Scene.phase = 'run'; Scene.t = 0; Scene.flash = false;
    clearPortalFX();
    setFade(0, 0.01);
    return true;
};

// =====================================================================
//  ⑧ 3D 人物（代码拼装的低多边形角色，带关节可做动作）
// =====================================================================
// ─────────────────────────────────────────────────────────────────────
//  角色建模：按照片 / 生成图重做
//  · 脸：眼睛（眼白+瞳孔）、眉毛、鼻子、微笑嘴、腮红
//  · 墨镜按生成图的做法「推到头顶」，露出脸
//  · 玫红连帽冲锋衣（兜帽、拉链、袖口、下摆）、深蓝阔腿裤、驼色马丁靴
//  骨骼接口保持不变：root/pivot/body/torso/head/hair + 四肢关节
//  RIG-START
// ─────────────────────────────────────────────────────────────────────
function buildHumanoid(o) {
    const mTop = std(o.top), mBottom = std(o.bottom);
    // 皮肤给一点自发光，避免脸/手在阴影里发灰
    const mSkin = std(o.skin, { roughness: 0.62, emissive: 0x2a1a12, emissiveIntensity: 0.28 });
    const mShoe = std(o.shoes), mHair = std(o.hair, { roughness: 0.55 });
    const mSole = std(o.sole != null ? o.sole : 0x6b4520, { roughness: 0.95 });
    const mCuff = std(o.cuff != null ? o.cuff : o.top, { roughness: 0.7 });
    const mZip = std(o.zipper != null ? o.zipper : 0xded6cf, { roughness: 0.5, metalness: 0.2 });
    const mWhite = std(0xffffff, { roughness: 0.3 });
    const mEye = std(o.eye != null ? o.eye : 0x241610, { roughness: 0.25 });
    const mMouth = std(o.mouth != null ? o.mouth : 0xc0605c, { roughness: 0.6 });
    const mBlush = new THREE.MeshStandardMaterial({ color: o.blush != null ? o.blush : 0xf2a0a8, roughness: 0.9, transparent: true, opacity: 0.5 });
    const mGlasses = std(o.glasses != null ? o.glasses : 0xd5dde6, { metalness: 0.9, roughness: 0.15 });

    const add = (parent, geo, mat, x, y, z, name) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        if (name) m.name = name;
        parent.add(m);
        return m;
    };
    const joint = (parent, x, y, z, name) => {
        const g = new THREE.Group();
        g.position.set(x, y, z);
        if (name) g.name = name;
        parent.add(g);
        return g;
    };

    const root = new THREE.Group();                    // 脚底为原点
    const pivot = joint(root, 0, 0.9, 0, 'pivot');      // 翻滚旋转中心
    const body = joint(pivot, 0, -0.9, 0, 'body');

    // ---------- 腿：阔腿裤（下宽上窄）+ 马丁靴 ----------
    const legs = [];
    for (const sx of [0.145, -0.145]) {
        const hip = joint(body, sx, 0.95, 0, 'hip');
        add(hip, new THREE.CapsuleGeometry(0.118, 0.24, 4, 10), mBottom, 0, -0.22, 0, 'thigh');
        const knee = joint(hip, 0, -0.45, 0, 'knee');
        add(knee, new THREE.CylinderGeometry(0.122, 0.158, 0.3, 10), mBottom, 0, -0.16, 0, 'shin');
        add(knee, new THREE.CylinderGeometry(0.165, 0.152, 0.055, 10), mBottom, 0, -0.29, 0, 'pantCuff');
        // 马丁靴：靴筒 + 脚背 + 圆头 + 厚底 + 鞋跟 + 鞋带
        add(knee, new THREE.CylinderGeometry(0.1, 0.108, 0.15, 10), mShoe, 0, -0.36, 0.005, 'bootShaft');
        add(knee, new THREE.BoxGeometry(0.205, 0.16, 0.22), mShoe, 0, -0.44, -0.03, 'boot');
        const toe = add(knee, new THREE.SphereGeometry(0.098, 10, 8), mShoe, 0, -0.455, -0.16, 'bootToe');
        toe.scale.set(1.0, 0.72, 1.0);
        add(knee, new THREE.BoxGeometry(0.22, 0.05, 0.42), mSole, 0, -0.525, -0.055, 'sole');
        add(knee, new THREE.BoxGeometry(0.22, 0.055, 0.11), mSole, 0, -0.5, 0.105, 'heel');
        for (let i = 0; i < 3; i++) add(knee, new THREE.BoxGeometry(0.185, 0.018, 0.028), mSole, 0, -0.35 + i * 0.042, -0.118, 'lace');
        legs.push({ hip, knee });
    }
    // 腰 / 腰带
    add(body, new THREE.BoxGeometry(0.36, 0.18, 0.23), mBottom, 0, 0.95, 0, 'waist');
    add(body, new THREE.BoxGeometry(0.38, 0.045, 0.24), mSole, 0, 1.035, 0, 'belt');

    // ---------- 上身：玫红连帽冲锋衣 ----------
    const torso = joint(body, 0, 0.95, 0, 'torso');
    add(torso, new THREE.CylinderGeometry(0.072, 0.082, 0.18, 10), mSkin, 0, 0.82, 0, 'neck');
    const chest = add(torso, new THREE.CapsuleGeometry(0.235, 0.32, 6, 12), mTop, 0, 0.4, 0, 'jacket');
    chest.scale.set(1.12, 1, 0.88);
    for (const sx of [0.2, -0.2]) add(torso, new THREE.SphereGeometry(0.115, 10, 8), mTop, sx, 0.72, 0, 'shoulderPad');
    add(torso, new THREE.CylinderGeometry(0.275, 0.255, 0.1, 12), mTop, 0, 0.14, 0, 'hem');
    add(torso, new THREE.BoxGeometry(0.035, 0.5, 0.02), mZip, 0, 0.42, -0.225, 'zipper');
    add(torso, new THREE.CylinderGeometry(0.022, 0.022, 0.05, 8), mZip, 0, 0.6, -0.225, 'zipPull');
    const hood = add(torso, new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), mTop, 0, 0.78, 0.13, 'hood');
    hood.scale.set(1.3, 1.05, 0.9);
    add(torso, new THREE.TorusGeometry(0.115, 0.032, 6, 14), mCuff, 0, 0.8, -0.02, 'collar');
    // 口袋拉链 + 下摆抽绳头
    for (const sx of [0.115, -0.115]) {
        const pk = add(torso, new THREE.BoxGeometry(0.02, 0.12, 0.012), mZip, sx, 0.08, -0.205, 'pocketZip');
        pk.rotation.z = sx > 0 ? 0.4 : -0.4;
    }
    for (const sx of [0.06, -0.06]) {
        add(torso, new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6), mZip, sx, 0.09, -0.24, 'drawcord');
    }

    // ---------- 手臂 ----------
    const arms = [];
    for (const sx of [0.345, -0.345]) {
        const shoulder = joint(torso, sx, 0.73, 0, 'shoulder');
        add(shoulder, new THREE.CapsuleGeometry(0.084, 0.22, 4, 8), mTop, 0, -0.18, 0, 'upperArm');
        const elbow = joint(shoulder, 0, -0.34, 0, 'elbow');
        add(elbow, new THREE.CapsuleGeometry(0.074, 0.2, 4, 8), mTop, 0, -0.16, 0, 'foreArm');
        add(elbow, new THREE.CylinderGeometry(0.082, 0.076, 0.05, 10), mCuff, 0, -0.3, 0, 'sleeveCuff');
        add(elbow, new THREE.SphereGeometry(0.062, 8, 6), mSkin, 0, -0.36, 0, 'hand');
        add(elbow, new THREE.SphereGeometry(0.027, 6, 6), mSkin, (sx > 0 ? -0.045 : 0.045), -0.385, -0.012, 'thumb');
        arms.push({ shoulder, elbow });
    }

    // ---------- 头 + 脸 ----------
    const head = joint(torso, 0, 0.99, 0, 'head');
    // 蛋形头骨 + 下颌，避免"一个球"
    const skull = add(head, new THREE.SphereGeometry(0.19, 18, 16), mSkin, 0, 0.012, 0, 'face');
    skull.scale.set(1.0, 1.12, 1.02);
    const jaw = add(head, new THREE.SphereGeometry(0.118, 14, 12), mSkin, 0, -0.088, -0.03, 'jaw');
    jaw.scale.set(0.95, 0.72, 0.92);
    for (const sx of [0.183, -0.183]) {
        const ear = add(head, new THREE.SphereGeometry(0.042, 8, 8), mSkin, sx, 0.0, 0.012, 'ear');
        ear.scale.set(0.45, 1.0, 0.7);
    }
    // 眼睛：眼白 + 瞳孔 + 高光 + 上眼睑线
    for (const sx of [0.072, -0.072]) {
        const w = add(head, new THREE.SphereGeometry(0.045, 12, 10), mWhite, sx, 0.018, -0.169, 'eyeWhite');
        w.scale.set(1.0, 0.62, 0.4);
        const p = add(head, new THREE.SphereGeometry(0.025, 10, 8), mEye, sx, 0.016, -0.188, 'pupil');
        p.scale.set(1, 1, 0.45);
        add(head, new THREE.SphereGeometry(0.0075, 6, 6), mWhite, sx - 0.009, 0.032, -0.194, 'highlight');
        const lid = add(head, new THREE.BoxGeometry(0.078, 0.011, 0.012), mHair, sx, 0.045, -0.181, 'eyelid');
        lid.rotation.z = sx > 0 ? -0.07 : 0.07;
    }
    // 眉毛
    for (const sx of [0.072, -0.072]) {
        const b = add(head, new THREE.BoxGeometry(0.07, 0.013, 0.014), mHair, sx, 0.101, -0.175, 'brow');
        b.rotation.z = sx > 0 ? 0.15 : -0.15;
    }
    // 鼻子（小锥体）
    const nose = add(head, new THREE.ConeGeometry(0.018, 0.034, 6), mSkin, 0, -0.006, -0.192, 'nose');
    nose.rotation.x = Math.PI / 2;
    // 嘴：下唇 + 两个上扬嘴角（微笑）
    add(head, new THREE.BoxGeometry(0.042, 0.009, 0.008), mMouth, 0, -0.082, -0.189, 'mouth');
    for (const sx of [0.024, -0.024]) {
        const c = add(head, new THREE.BoxGeometry(0.012, 0.009, 0.008), mMouth, sx, -0.078, -0.187, 'mouthCorner');
        c.rotation.z = sx > 0 ? -0.7 : 0.7;
    }
    // 腮红
    for (const sx of [0.112, -0.112]) {
        const bl = add(head, new THREE.SphereGeometry(0.03, 8, 6), mBlush, sx, -0.042, -0.152, 'blush');
        bl.scale.set(1.1, 0.5, 0.26);
    }

    // 头发：头顶发量 + 中分刘海（多片斜发束，不是一块齐刘海）+ 两侧/后侧长发
    add(head, new THREE.SphereGeometry(0.202, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.28), mHair, 0, 0.03, 0.006, 'hairCap');
    // 两侧鬓发 + 后脑发量：补上"帽子和垂发之间的空档"
    for (const sx of [0.172, -0.172]) {
        const hs = add(head, new THREE.SphereGeometry(0.09, 10, 10), mHair, sx, -0.015, 0.025, 'hairSide');
        hs.scale.set(0.5, 1.5, 0.95);
    }
    const hv = add(head, new THREE.SphereGeometry(0.2, 14, 12), mHair, 0, 0.04, 0.08, 'hairVolume');
    hv.scale.set(1.0, 0.98, 0.8);
    const hair = joint(head, 0, 0.05, 0.1, 'hair');
    if (o.longHair) {
        // 后侧长发：扁、上宽下窄、到肩线
        const back = add(hair, new THREE.CylinderGeometry(0.192, 0.108, 0.58, 14), mHair, 0, -0.32, 0.012, 'hairBack');
        back.scale.set(1.0, 1, 0.4);
        // 两侧垂发（耳前垂到肩）
        for (const sx of [0.162, -0.162]) {
            const s = add(hair, new THREE.CapsuleGeometry(0.047, 0.52, 4, 8), mHair, sx, -0.25, -0.05, 'hairStrand');
            s.scale.set(0.85, 1, 1.15);
        }
        // 刘海：两侧各 3 片斜向发束，长度/角度错开
        const fringe = [
            { x: 0.05, y: 0.125, z: -0.263, w: 0.06, h: 0.085, rz: 0.28 },
            { x: 0.105, y: 0.118, z: -0.243, w: 0.055, h: 0.105, rz: 0.5 },
            { x: 0.152, y: 0.1, z: -0.205, w: 0.05, h: 0.135, rz: 0.72 },
            { x: -0.05, y: 0.125, z: -0.263, w: 0.06, h: 0.08, rz: -0.28 },
            { x: -0.105, y: 0.118, z: -0.243, w: 0.055, h: 0.1, rz: -0.5 },
            { x: -0.152, y: 0.1, z: -0.205, w: 0.05, h: 0.13, rz: -0.72 },
        ];
        for (const f of fringe) {
            const b = add(hair, new THREE.BoxGeometry(f.w, f.h, 0.018), mHair, f.x, f.y, f.z, 'bangs');
            b.rotation.z = f.rz;
            b.rotation.x = -0.14;
            b.rotation.y = -f.x * 2.4;      // 顺着额头弧度包过去，避免"一块齐刘海"
        }
        // 鬓角（把刘海和侧发连起来）
        for (const sx of [0.168, -0.168]) {
            const t = add(hair, new THREE.BoxGeometry(0.03, 0.12, 0.05), mHair, sx, 0.02, -0.14, 'sideBurn');
            t.rotation.z = sx > 0 ? 0.18 : -0.18;
        }
    }
    if (o.glasses) {
        // 墨镜推到发顶（露出整张脸和眼睛）
        const gp = joint(head, 0, 0.215, 0.02, 'glassesUp');
        gp.rotation.x = -1.25;
        for (const sx of [0.082, -0.082]) {
            const lens = add(gp, new THREE.BoxGeometry(0.105, 0.055, 0.014), mGlasses, sx, 0, 0, 'lens');
            lens.rotation.z = sx > 0 ? 0.06 : -0.06;
        }
        add(gp, new THREE.BoxGeometry(0.05, 0.012, 0.012), mGlasses, 0, 0.008, 0, 'bridge');
        for (const sx of [0.14, -0.14]) {
            const t = add(gp, new THREE.BoxGeometry(0.018, 0.012, 0.05), mGlasses, sx, 0.008, 0.02, 'temple');
            t.rotation.y = sx > 0 ? -0.75 : 0.75;
        }
    }
    if (o.cap !== undefined) {
        const mCap = std(o.cap);
        add(head, new THREE.CylinderGeometry(0.22, 0.22, 0.12, 16), mCap, 0, 0.14, 0, 'cap');
        add(head, new THREE.BoxGeometry(0.3, 0.03, 0.18), mCap, 0, 0.09, -0.2, 'capBrim');
    }

    return {
        root, pivot, body, torso, head, hair, shoeMat: mShoe, baseShoe: o.shoes,
        legL: legs[0].hip, kneeL: legs[0].knee, legR: legs[1].hip, kneeR: legs[1].knee,
        armL: arms[0].shoulder, elbowL: arms[0].elbow, armR: arms[1].shoulder, elbowR: arms[1].elbow,
    };
}
//  RIG-END

// =====================================================================
//  ⑧c GLB 真实骨骼角色
//  · 把 assets/character.glb（或 Michelle.glb 演示模型）加载进来
//  · 自动归一化高度 / 朝向 / 脚底贴地，自动把 T-pose 的手臂放下来
//  · 按骨骼名自动匹配成游戏需要的那套关节，于是现有动画系统直接驱动真实骨骼
// =====================================================================
/**
 * 真实骨骼关节：姿态角度按「世界轴」解释，再换算到骨骼父空间执行。
 * 这样不管模型骨骼的本地轴朝哪、是不是 Mixamo，跑/跳/翻滚的动作方向都一致。
 */
function makeBoneJoint(bone, opts = {}) {
    const worldAxes = opts.worldAxes || {
        x: new THREE.Vector3(1, 0, 0),   // 左右轴：前后摆动 / 屈伸
        y: new THREE.Vector3(0, 1, 0),   // 竖直轴：扭转
        z: new THREE.Vector3(0, 0, 1),   // 前后轴：张开 / 侧倾
    };
    const axes = {};
    if (bone && bone.parent) {
        const P = new THREE.Quaternion();
        bone.parent.getWorldQuaternion(P);
        const Pinv = P.clone().invert();
        for (const k of ['x', 'y', 'z']) axes[k] = worldAxes[k].clone().applyQuaternion(Pinv).normalize();
    }
    const q = new THREE.Quaternion();
    return {
        bone,
        rest: bone ? bone.quaternion.clone() : null,
        base: opts.base || null,
        rotation: { x: 0, y: 0, z: 0 },
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        axes,
        apply() {
            if (!bone) return;
            bone.quaternion.copy(this.rest);
            if (this.base) bone.quaternion.premultiply(this.base);
            for (const k of ['x', 'y', 'z']) {
                const a = this.rotation[k];
                if (!a) continue;
                q.setFromAxisAngle(axes[k], a);
                bone.quaternion.premultiply(q);
            }
        },
    };
}

/** 计算把一个骨骼（含子骨）在世界空间转到目标方向所需的局部旋转 */
function boneBaseQuat(bone, targetWorldDir) {
    if (!bone) return null;
    const child = bone.children.find(c => c.isBone);
    if (!child) return null;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    bone.getWorldPosition(a);
    child.getWorldPosition(b);
    const cur = b.sub(a).normalize();
    const R = new THREE.Quaternion().setFromUnitVectors(cur, targetWorldDir.clone().normalize());
    const P = new THREE.Quaternion();
    bone.parent.getWorldQuaternion(P);
    return P.clone().invert().multiply(R).multiply(P);
}

// ---- 换人物：把新模型网格按现有骨架重算蒙皮权重，骨架与摆动逻辑全部沿用 ----
// 新模型是双臂张开的静止姿态，所以先把骨架摆到手臂轴线上算权重，再放回自然下垂
function autoSkinWeights(geo, skeleton, armAxes, armAxesFit) {
    const pos = geo.attributes.position;
    const n = pos.count;
    const bones = skeleton.bones;
    const m = new THREE.Matrix4();
    const P = bones.map((b, i) => {
        m.copy(skeleton.boneInverses[i]).invert();
        return new THREE.Vector3().setFromMatrixPosition(m);
    });
    const idxOf = new Map(bones.map((b, i) => [b, i]));
    const SEG = P.map((p, i) => {
        const c = bones[i].children.find(ch => idxOf.has(ch));
        const q = c ? P[idxOf.get(c)].clone().sub(p) : new THREE.Vector3();
        return { p, q, len2: q.lengthSq() };
    });
    const kind = bones.map(b => {
        const s = b.name;
        if (/arm|forearm|hand/i.test(s)) return 'arm';
        if (/leg|thigh|shin|foot|toe|upleg/i.test(s)) return 'leg';
        if (/head/i.test(s)) return 'head';
        if (/spine|hips|chest|neck/i.test(s)) return 'torso';
        return 'skip';
    });
    const byName = (re) => { const i = bones.findIndex(b => re.test(b.name)); return i >= 0 ? P[i] : null; };
    const hips = byName(/hips/i) || new THREE.Vector3();
    const headB = byName(/^head$/i) || byName(/head/i) || new THREE.Vector3(0, 0.9, 0);
    // 这套骨架朝向 +X，所以左右轴是 Z（LeftArm 在 -Z，RightArm 在 +Z）
    const armL = byName(/leftarm$/i) || byName(/leftarm/i);
    const armR = byName(/rightarm$/i) || byName(/rightarm/i);
    const armZ = Math.abs((armL || armR || new THREE.Vector3(0, 0, 0.13)).z) || 0.13;

    const ALLOW = new Uint8Array(n * bones.length);
    const idx = new Uint16Array(n * 4);
    const wgt = new Float32Array(n * 4);
    const v = new THREE.Vector3();
    const tmp = new THREE.Vector3();

    // 手臂三段骨骼（左右各一组）：上臂 / 小臂 / 手
    const armBone = { L: {}, R: {} };
    bones.forEach((b, i) => {
        const side = /left/i.test(b.name) ? 'L' : 'R';
        if (/forearm$/i.test(b.name)) armBone[side].fore = i;
        else if (/hand$/i.test(b.name)) armBone[side].hand = i;
        else if (/arm$/i.test(b.name)) armBone[side].up = i;
    });
    // 腿部三段骨骼（左右各一组）：大腿 / 小腿 / 脚
    const legBone = { L: {}, R: {} };
    bones.forEach((b, i) => {
        const side = /left/i.test(b.name) ? 'L' : 'R';
        if (/upleg$/i.test(b.name)) legBone[side].up = i;
        else if (/leg$/i.test(b.name)) legBone[side].low = i;
        else if (/foot$/i.test(b.name)) legBone[side].foot = i;
    });
    // 髋部到脚底的竖直跨度，用来把「沿腿的高度」归一化成 0(髋) → 1(脚底)
    let footY = hips.y - 0.5;
    for (const s of ['L', 'R']) if (legBone[s].foot !== undefined) footY = Math.min(footY, P[legBone[s].foot].y);
    const legSpan = Math.max(0.05, hips.y - footY);
    const legSeg = {};
    for (const s of ['L', 'R']) {
        const bi = legBone[s];
        if (bi.up === undefined || bi.low === undefined) continue;
        // 膝盖、脚踝在归一化高度上的位置（左右同一套比例）
        legSeg[s] = {
            knee: (hips.y - P[bi.low].y) / legSpan,
            ankle: bi.foot !== undefined ? (hips.y - P[bi.foot].y) / legSpan : 0.88,
        };
    }
    const smooth = (a, b, x) => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    };

    const distSeg = (p, s) => {
        if (s.len2 < 1e-10) return p.distanceTo(s.p);
        tmp.copy(p).sub(s.p);
        const t = Math.max(0, Math.min(1, tmp.dot(s.q) / s.len2));
        return Math.hypot(p.x - (s.p.x + s.q.x * t), p.y - (s.p.y + s.q.y * t), p.z - (s.p.z + s.q.z * t));
    };

    for (let vi = 0; vi < n; vi++) {
        v.fromBufferAttribute(pos, vi);

        // 手臂按「沿手臂轴线的位置」分区，左右用同一套比例，保证两边摆幅一致
        let armUse = 0;
        const armW = [];
        if (armAxes) {
            const side = v.z < 0 ? 'L' : 'R';
            const ax = armAxes[side];
            if (ax && v.z * (side === 'L' ? -1 : 1) > 0 && Math.abs(v.z) >= armZ * 0.9) {
                const along = tmp.copy(v).sub(ax.p).dot(ax.d);
                if (along > 0) {
                    // 径向距离门（按各自 fitted 轴）：袖子贴轴 <0.1，外套下摆 ≈0.33、裤脚 ≈0.5 离轴很远。
                    // 不能用 y 阈值——下垂 40° 的左臂手尖 y≈0.039 低于髋线（0.04），
                    // 会被误踢出手臂拿到纯躯干权重，运行时直戳在体外（左侧 0.76m 碎片）
                    let gate = 1;
                    const fit = armAxesFit && armAxesFit[side];
                    if (fit) {
                        const fa = Math.max(0, tmp.copy(v).sub(fit.p).dot(fit.d));
                        gate = 1 - smooth(0.10, 0.18, Math.hypot(
                            v.x - (fit.p.x + fit.d.x * fa),
                            v.y - (fit.p.y + fit.d.y * fa),
                            v.z - (fit.p.z + fit.d.z * fa)));
                    }
                    const t = along / ax.len;
                    armUse = smooth(0.15, 0.34, t) * gate;              // 肩头 7cm 内留给躯干，否则右肩袖子被顶出尖角
                    const bi = armBone[side];
                    if (bi.up !== undefined) armW.push([bi.up, armUse * (1 - smooth(0.32, 0.58, t))]);
                    if (bi.fore !== undefined) armW.push([bi.fore, armUse * (smooth(0.32, 0.58, t) - smooth(0.76, 0.95, t))]);
                    if (bi.hand !== undefined) armW.push([bi.hand, armUse * smooth(0.76, 0.95, t)]);
                }
            }
        }

        // 腿按「沿腿的高度」分区：整圈同高顶点跟同一段骨骼，
        // 否则宽裤腿的内外侧被拆给不同骨骼，跨步时同一圈布料会被撕成折面/平板
        let legUse = 0;
        const legW = [];
        if (v.y < hips.y + 0.05) {
            const t = (hips.y - v.y) / legSpan;
            const top = smooth(0.02, 0.12, t);                 // 髋线上方交给髋
            const mix = smooth(-0.045, 0.045, v.z);            // 0=全左 1=全右，中线附近两腿混合
            const addChain = (side, mul) => {
                const ls = legSeg[side], bi = legBone[side];
                if (!ls || mul <= 0.001) return;
                // 髋部附近收紧半径：只抓裤腿，别把外套下摆也拖到大腿上
                const ax = P[bi.up];
                const r = Math.hypot(v.x - ax.x, v.z - ax.z);
                const gate = 1 - smooth(0.10, 0.17, r) * (1 - smooth(0.12, 0.28, t));
                if (gate <= 0.001) return;
                const kS = smooth(ls.knee - 0.075, ls.knee + 0.075, t);
                const aS = smooth(ls.ankle - 0.035, ls.ankle + 0.035, t);
                const g = top * mul * gate;
                if (bi.up !== undefined) legW.push([bi.up, g * (1 - kS)]);
                if (bi.low !== undefined) legW.push([bi.low, g * (kS - aS)]);
                if (bi.foot !== undefined) legW.push([bi.foot, g * aS]);
            };
            addChain('L', 1 - mix);
            addChain('R', mix);
            for (const e of legW) legUse += e[1];
            legUse = Math.min(1, legUse);
        }

        let any = false;
        for (let i = 0; i < bones.length; i++) {
            const k = kind[i];
            if (k === 'skip' || k === 'arm' || k === 'leg') continue;   // 手臂/腿已用轴向权重
            let ok = true;
            if (k === 'head') {
                ok = v.y >= headB.y - 0.09;
            }
            if (ok) { ALLOW[vi * bones.length + i] = 1; any = true; }
        }
        if (!any) for (let i = 0; i < bones.length; i++) if (kind[i] !== 'skip' && kind[i] !== 'arm' && kind[i] !== 'leg') ALLOW[vi * bones.length + i] = 1;

        // 其余骨骼按反距离加权 —— 先归一化再按 (1-armUse-legUse) 的比例混合。
        // 否则原始距离权重（1/d² 量级 10~30）会把轴向手臂权重（0~1）挤出前四截断，
        // 肩头 ramp 区实际全归躯干：右肩一撮顶点被留在头侧 0.43m 处
        const best = [];
        const free = (1 - Math.min(1, armUse + legUse));
        let dsum = 0;
        const dw = [];
        for (let i = 0; i < bones.length; i++) {
            if (!ALLOW[vi * bones.length + i]) continue;
            const d = distSeg(v, SEG[i]);
            let w = 1 / (d * d + 0.0006);
            if (kind[i] === 'torso') w *= 1.25;      // 衣服优先跟随躯干，避免被手臂拖走
            dw.push([i, w]);
            dsum += w;
        }
        if (dsum > 0) for (const e of dw) best.push([e[0], e[1] / dsum * free]);
        for (const e of armW) best.push(e);
        for (const e of legW) best.push(e);
        best.sort((a, b) => b[1] - a[1]);
        let sum = 0;
        for (let j = 0; j < 4 && j < best.length; j++) sum += best[j][1];
        for (let j = 0; j < 4; j++) {
            const e = best[j];
            idx[vi * 4 + j] = e ? e[0] : 0;
            wgt[vi * 4 + j] = e && sum > 0 ? e[1] / sum : (j === 0 ? 1 : 0);
        }
    }
    return { idx, wgt };
}

async function reskinUnrigged(model) {
    let skm = null;
    model.traverse(o => { if (!skm && o.isSkinnedMesh) skm = o; });
    if (!skm || !skm.skeleton) return false;
    const oldGeo = skm.geometry;
    let src = null;
    try {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const g = await new GLTFLoader().loadAsync(PLAYER_GLB);
        g.scene.traverse(o => { if (!src && o.isMesh) src = o; });
    } catch (e) {
        console.warn('[角色] 新模型加载失败，保留原网格', e && (e.message || e));
        return false;
    }
    if (!src || !src.geometry) return false;

    const geo = src.geometry.clone();
    // 朝向：新模型静止姿态朝 +Z（双臂沿 X 张开），骨架朝 +X → 绕 Y 转 90°
    geo.rotateY(Math.PI / 2);
    // 尺度：按高度对齐到原网格（同一套骨架空间）
    const ob = new THREE.Box3().setFromBufferAttribute(oldGeo.attributes.position);
    const nb = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
    const k = (ob.max.y - ob.min.y) / Math.max(1e-6, nb.max.y - nb.min.y);
    geo.scale(k, k, k);
    // 位置：水平居中 + 脚底对齐
    const nb2 = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
    const oc = ob.getCenter(new THREE.Vector3()), nc = nb2.getCenter(new THREE.Vector3());
    geo.translate(oc.x - nc.x, ob.min.y - nb2.min.y, oc.z - nc.z);
    const pos = geo.attributes.position;

    // 骨架摆成双臂张开的姿态：新网格的左右手臂并不完全对称（一只略下垂），
    // 所以按网格自己伸出去最远的那撮顶点定手臂轴线，骨骼才会真的落在袖子里
    const bones = skm.skeleton.bones;
    const sh = new THREE.Vector3(), tip = new THREE.Vector3(), tmpV = new THREE.Vector3();
    const armAxes = {};
    for (const side of [-1, 1]) {
        const b = bones.find(x => (side < 0 ? /leftarm$/i : /rightarm$/i).test(x.name));
        if (!b) continue;
        b.updateWorldMatrix(true, true);
        b.getWorldPosition(sh);
        const far = [];
        for (let i = 0; i < pos.count; i += 3) {
            const z = pos.getZ(i);
            if (z * side <= 0.18) continue;
            far.push([Math.abs(z), pos.getX(i), pos.getY(i), z]);
        }
        if (!far.length) continue;
        far.sort((a, c) => c[0] - a[0]);
        const top = far.slice(0, Math.max(8, Math.floor(far.length * 0.05)));
        tip.set(0, 0, 0);
        for (const t of top) tip.add(tmpV.set(t[1], t[2], t[3]));
        tip.multiplyScalar(1 / top.length).sub(sh);
        const armLen = Math.max(0.05, tip.length());
        tip.normalize();
        armAxes[side < 0 ? 'L' : 'R'] = { p: sh.clone(), d: tip.clone(), len: armLen };
    }

    // 两侧轴线做镜像平均后再算权重：新模型左右手臂原始姿态不同（一只下垂约 40°），
    // 直接用各自的轴线会让肩头顶点「归属一边多一边少」，待机时两个肩膀一宽一窄。
    let armAxesSym = null;
    if (armAxes.L && armAxes.R) {
        const flipZ = v => new THREE.Vector3(v.x, v.y, -v.z);
        const dSum = armAxes.L.d.clone().add(flipZ(armAxes.R.d));
        if (dSum.lengthSq() > 1e-4) {
            const dSym = dSum.normalize();
            const len = (armAxes.L.len + armAxes.R.len) * 0.5;
            armAxesSym = {
                L: { p: armAxes.L.p.clone(), d: dSym, len },
                R: { p: armAxes.R.p.clone(), d: flipZ(dSym), len },
            };
        }
    }

    // 权重在 T-pose 上算（手臂平举时和腿部分得最开，高度/横向掩码最干净）
    // 第 4 参数是各自 fitted 轴：径向距离门用它贴合每条手臂的真实走向（左臂下垂 40°，对称轴会偏）
    const { idx, wgt } = autoSkinWeights(geo, skm.skeleton, armAxesSym || armAxes, armAxes);
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wgt, 4));

    // 关键：把袖子网格直接转到自然下垂（每个顶点按自己的手臂权重旋转，肩头权重为 0 不动），
    // 再把骨骼摆到同一方向后才绑定 —— 绑定姿态 = 待机姿态，蒙皮形变为零，
    // 肩头布料不会被「从平举转到下垂」的 40~90° 大旋转顶出尖角。
    const restArm = {
        L: new THREE.Vector3(0.02, -1, -0.055).normalize(),
        R: new THREE.Vector3(-0.02, -1, 0.055).normalize(),
    };
    const armBoneIdx = { L: new Set(), R: new Set() };
    bones.forEach((b, i) => {
        if (/leftarm$|leftforearm|lefthand$/i.test(b.name)) armBoneIdx.L.add(i);
        if (/rightarm$|rightforearm|righthand$/i.test(b.name)) armBoneIdx.R.add(i);
    });
    const nrm = geo.attributes.normal;
    const I = new THREE.Quaternion(), qq = new THREE.Quaternion();
    for (const side of ['L', 'R']) {
        const ax = armAxes[side];
        if (!ax) continue;
        const rot = new THREE.Quaternion().setFromUnitVectors(ax.d, restArm[side]);
        const set = armBoneIdx[side];
        for (let i = 0; i < pos.count; i++) {
            const z = pos.getZ(i);
            if ((side === 'L' ? -z : z) <= 0.05) continue;
            let aw = 0;
            for (let j = 0; j < 4; j++) if (set.has(idx[i * 4 + j])) aw += wgt[i * 4 + j];
            if (aw < 0.02) continue;
            qq.slerpQuaternions(I, rot, aw);
            tmpV.set(pos.getX(i), pos.getY(i), z).sub(ax.p).applyQuaternion(qq).add(ax.p);
            pos.setXYZ(i, tmpV.x, tmpV.y, tmpV.z);
            if (nrm) {
                tmpV.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).applyQuaternion(qq).normalize();
                nrm.setXYZ(i, tmpV.x, tmpV.y, tmpV.z);
            }
        }
    }
    pos.needsUpdate = true;
    if (nrm) nrm.needsUpdate = true;

    // 大臂/小臂/手一起摆到与网格相同的下垂方向（新模型两臂肘部朝向不同，必须一起摆直）
    for (const [re, side] of [
        [/leftarm$/i, 'L'], [/rightarm$/i, 'R'],
        [/leftforearm/i, 'L'], [/rightforearm/i, 'R'],
        [/lefthand$/i, 'L'], [/righthand$/i, 'R'],
    ]) {
        const b = bones.find(x => re.test(x.name));
        if (!b) continue;
        b.updateWorldMatrix(true, true);
        const q = boneBaseQuat(b, restArm[side]);
        if (q) b.quaternion.premultiply(q);
    }
    model.updateMatrixWorld(true);
    skm.skeleton.calculateInverses();
    skm.skeleton.update();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    skm.geometry = geo;
    if (src.material) skm.material = src.material;
    console.info('[角色] 已换成新人物网格并重新蒙皮，顶点', pos.count, '骨骼', bones.length);
    return true;
}

async function loadModelCharacter(paths) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    let gltf = null, used = '';
    for (const p of [].concat(paths)) {
        try { gltf = await loader.loadAsync(p); used = p; break; } catch (e) { console.warn('[角色] GLB 加载失败:', p, e && (e.message || e)); }
    }
    if (!gltf) throw new Error('没有可用的 GLB 模型');
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    // await reskinUnrigged(model);   // 已回退：改回用原人物模型（新网格+重算权重效果更差，2026-10-21 回退）

    // ---- 归一化：高度 1.85、脚底贴地、水平居中、朝向 -Z ----
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); box.getSize(size);
    const scale = 1.85 / Math.max(0.001, size.y);
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3(); box2.getCenter(center);
    model.position.set(model.position.x - center.x, model.position.y - box2.min.y, model.position.z - center.z);
    model.rotation.y = Math.PI / 2;          // 这个 Tripo 模型正面朝 -X，转 90° 让正面朝 -Z（游戏前方）
    model.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        // GLB 通病修复：metalness=1 且没有环境贴图时，金属只反射环境 → 场景里几乎全黑／发灰，
        // 看起来像“角色渲染失效”。这里统一压成低金属度 + 高粗糙度，并纠正贴图色彩空间。
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
            if (!m || m.userData.__charFixed) continue;
            m.userData.__charFixed = true;
            if (m.metalness != null) m.metalness = Math.min(m.metalness, 0.06);
            if (m.roughness != null) m.roughness = Math.max(m.roughness, 0.66);
            if (m.envMapIntensity != null) m.envMapIntensity = 0.8;
            if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
            if (m.emissiveMap) m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            m.needsUpdate = true;
        }
    });
    model.updateMatrixWorld(true);

    // ---- 骨骼匹配（Mixamo / Tripo / 通用命名） ----
    const boneList = [];
    model.traverse(o => { if (o.isBone) boneList.push(o); });
    const find = (...pats) => { for (const p of pats) { const b = boneList.find(o => p.test(o.name)); if (b) return b; } return null; };
    const bones = {
        torso: find(/spine2/i, /spine1/i, /spine/i, /chest/i),
        head: find(/^head$/i, /head$/i),
        legL: find(/leftupleg/i, /leftupperleg/i, /leftthigh/i, /thigh_l/i, /upleg_l/i),
        kneeL: find(/leftleg$/i, /leftshin/i, /leftlowerleg/i, /shin_l/i),
        legR: find(/rightupleg/i, /rightupperleg/i, /rightthigh/i, /thigh_r/i, /upleg_r/i),
        kneeR: find(/rightleg$/i, /rightshin/i, /rightlowerleg/i, /shin_r/i),
        armL: find(/leftarm$/i, /leftupperarm/i, /leftshoulder/i, /arm_l/i, /upperarm_l/i),
        elbowL: find(/leftforearm/i, /leftlowerarm/i, /leftelbow/i, /forearm_l/i),
        armR: find(/rightarm$/i, /rightupperarm/i, /rightshoulder/i, /arm_r/i, /upperarm_r/i),
        elbowR: find(/rightforearm/i, /rightlowerarm/i, /rightelbow/i, /forearm_r/i),
    };

    // ---- 把 T-pose 的手臂放下来（已经是 A-pose 的模型就跳过，否则二次旋转会把网格拧坏） ----
    const armDirDown = (b) => {
        if (!b) return false;
        const child = b.children.find(c => c.isBone);
        if (!child) return false;
        const a = new THREE.Vector3(), c = new THREE.Vector3();
        b.getWorldPosition(a); child.getWorldPosition(c);
        return c.sub(a).normalize().dot(new THREE.Vector3(0, -1, 0)) > 0.35;
    };
    const baseArmL = armDirDown(bones.armL) ? null : boneBaseQuat(bones.armL, new THREE.Vector3(-0.45, -1, -0.12));
    const baseArmR = armDirDown(bones.armR) ? null : boneBaseQuat(bones.armR, new THREE.Vector3(0.45, -1, -0.12));

    // ---- 组装成和代码角色一致的接口 ----
    const root = new THREE.Group();
    const pivot = new THREE.Group(); pivot.position.y = 0.9;
    const body = new THREE.Group(); body.position.y = -0.9;
    root.add(pivot); pivot.add(body); body.add(model);

    const char = {
        root, pivot, body, model, usedUrl: used, isModel: true,
        torso: makeBoneJoint(bones.torso),
        head: makeBoneJoint(bones.head),
        hair: null,
        legL: makeBoneJoint(bones.legL),
        kneeL: makeBoneJoint(bones.kneeL),
        legR: makeBoneJoint(bones.legR),
        kneeR: makeBoneJoint(bones.kneeR),
        armL: makeBoneJoint(bones.armL, { base: baseArmL }),
        elbowL: makeBoneJoint(bones.elbowL),
        armR: makeBoneJoint(bones.armR, { base: baseArmR }),
        elbowR: makeBoneJoint(bones.elbowR),
        shoeMat: null, baseShoe: CONFIG.player.colors.shoes,
    };
    // 翅膀 / 光环挂点（世界单位，不随模型缩放）
    char.wingAnchor = new THREE.Group(); char.wingAnchor.position.set(0, 0.58, 0.16); pivot.add(char.wingAnchor);
    char.headAnchor = new THREE.Group(); char.headAnchor.position.set(0, 1.04, 0); pivot.add(char.headAnchor);
    // 每帧把姿态写回骨骼
    const RIG_KEYS = ['torso', 'head', 'legL', 'kneeL', 'legR', 'kneeR', 'armL', 'elbowL', 'armR', 'elbowR'];
    char.sync = () => { for (const k of RIG_KEYS) { const j = char[k]; if (j && j.apply) j.apply(); } };
    char.boneInfo = { count: boneList.length, matched: Object.fromEntries(Object.entries(bones).map(([k, v]) => [k, v ? v.name : null])) };
    console.info('[角色] GLB 模型已加载:', used, '骨骼数', boneList.length, char.boneInfo.matched);
    return char;
}

// =====================================================================
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
//  ⑬ 每帧更新
// =====================================================================
function updatePlaying(dt) {
    // 主题可带 speedMul：校园两图压一档（跑速按绝对里程涨，到第 4 段已经太快）
    const _spdMul = (THEMES[curTheme] && THEMES[curTheme].speedMul) || 1;
    const _rawSpeed = CONFIG.speed.start * Math.pow(CONFIG.speed.factor, Math.floor(S.D / CONFIG.speed.step));
    S.speed = Math.min(speedBaseCap(), _rawSpeed) * _spdMul;
    topSpeedTick();                       // 首次到达 1.6x 封顶时提示难度联动开启
    // [PKVS] 对局内速度可能被干扰压低，或被冻结（倒计时 / 冲线等待）
    const step = S.speed * dt * (typeof window.__pkSpeedMul === 'function' ? window.__pkSpeedMul() : 1);
    S.D += step;
    scrollWorld(step, S.D);
    updateScene(dt);

    // [PKVS] 双人对战：生成期把 Math.random 换成 seed 流，两端障碍布局一致。
    // 行距里的速度用「该行的里程」算，避免速度档位差在两端累计漂移。
    if (Scene.phase === 'run' && S.nextRowS < S.D + SPAWN_DIST) {
        const pkRnd = window.__pkRnd, pkReal = Math.random;
        if (pkRnd) Math.random = pkRnd;
        try {
            while (Scene.phase === 'run' && S.nextRowS < S.D + SPAWN_DIST) {
                spawnRow(S.nextRowS);
                const spd = pkRnd
                    ? Math.min(speedBaseCap(), CONFIG.speed.start * Math.pow(CONFIG.speed.factor, Math.floor(S.nextRowS / CONFIG.speed.step)))
                    : S.speed;
                // 极速阶段障碍数量 ×1.5：行距缩到 1/1.5。26m 是反应距离地板
                // （24m/s 约 1.1s），再密就来不及换道了。
                const gap = 20 + spd * 0.7 + Math.random() * 14;
                S.nextRowS += Math.max(26, gap / (atTopSpeed() ? TOP_OBSTACLE_MUL : 1));
            }
        } finally {
            if (pkRnd) Math.random = pkReal;
        }
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
        const o = obstacles[i];
        // 极速阶段：只放大障碍「自己迎面开」的那部分速度，不是整体时间流速
        if (o.moving) o.extra = S.speed * (o.extraRate || 0.45) * topMovingMul();
        o.z += step + o.extra * dt;
        if (o.wobble) {   // 校园·自行车轻微横移（碰撞用实时 x）
            o.x = o.baseX + wobbleOffset(S.D, o.wobble);
        }
        placeOnTrack(o.mesh, o.x, 0, o.z);
        if (o.z - o.len / 2 > 12) { disposeObj(o.mesh); obstacles.splice(i, 1); }
    }

    for (const k in S.power) S.power[k] = Math.max(0, S.power[k] - dt);
    S.stumbleCool -= dt;
    S.chaserTimer -= dt;
    if (S.rolling > 0) S.rolling -= dt;
    S.landGrace -= dt;
    S.transGrace = Math.max(0, (S.transGrace || 0) - dt);
    S.climbPulse = Math.max(0, (S.climbPulse || 0) - dt);

    // 横向移动
    S.x += (LANES[S.lane] - S.x) * Math.min(1, dt * 14);

    // 起跳蓄力（预备动作）：计时结束才真正给向上的速度
    if (S.anticip > 0) {
        S.anticip -= dt;
        if (S.anticip <= 0) { S.anticip = 0; applyJumpImpulse(); }
    }

    // —— 飞行器状态机：起飞 / 巡航（↑爬升 ↓俯冲）/ 收翼降落 / 落地缓冲 ——
    const fl = S.flight;
    // 下落时把这帧的位移量喂给站立面判定（高速下落也能稳稳踩上车顶）
    const _drop = S.vy < 0 ? Math.min(1.6, -S.vy / 60 * 1.8 + (-S.vy) * 0.02) : 0;
    const groundY = surfaceAt(S.x, S.y, _drop);
    if (fl.active) {
        const prevY = S.y;
        stepFlight(fl, dt, { climb: !!(S.holdUp || S.climbPulse > 0), dive: !!S.holdDown }, { groundY, timeLeft: S.power.wings });
        S.y = fl.y;
        S.vy = (S.y - prevY) / Math.max(dt, 1e-4);
        S.grounded = false;
        S.rolling = 0;
        S.flying = true;
        if (fl.landed && !fl.landHandled) {
            fl.landHandled = true;
            ANIM.land = ANIM_CFG.landTime;
            S.landGrace = 0.45;
            S.speed = Math.min(speedBaseCap(), S.speed + 1.5);
            SFX.shield();
            showMsg('🕊 王从天降！');
        }
        if (fl.done) { S.power.wings = 0; fl.landHandled = false; }
    } else {
        S.flying = false;
        const g = groundY;
        if (S.vy > 0 || S.y > g + 0.01) {
            S.vy -= CONFIG.jump.gravity * dt;
            S.y += S.vy * dt;
            if (S.y <= g) {
                const src = standOb, vyIn = S.vy;
                if (!S.grounded && S.vy < -3) ANIM.land = ANIM_CFG.landTime;   // 落地缓冲
                S.y = g; S.vy = 0; S.grounded = true;
                // 城市·车顶弹跳：落在小汽车顶上自动弹起
                const b = bounceImpulse(src, vyIn, Scene.id);
                if (b > 0) {
                    S.vy = b;
                    S.grounded = false;
                    SFX.jump();
                    showMsg('🚗 车顶弹跳！');
                }
            } else S.grounded = false;
        } else {
            S.y = g; S.vy = 0; S.grounded = true;
        }
        if (S.grounded) S.airJumps = 0;      // 落地清零二段跳计数
    }

    if (!S.flying) checkCollisions(dt);
    if (S.state !== 'playing') return;

    // 金币
    const cy = S.y + (S.rolling > 0 ? 0.4 : 0.9);
    for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        if (S.power.magnet > 0 && c.z > -30 && c.z < 2) c.magnet = true;
        if (c.magnet) {
            const k = Math.min(1, dt * 12);
            c.x += (S.x - c.x) * k; c.y += (cy - c.y) * k; c.z += (0 - c.z) * k;
        } else {
            c.z += step;
        }
        placeOnTrack(c.mesh, c.x, c.y, c.z);
        trackSpin(c.mesh, dt, 4);
        const dx = c.x - S.x, dy = c.y - cy, dz = c.z;
        if (dx * dx + dy * dy + dz * dz < 1.1) {
            S.coins += S.power.double > 0 ? 2 : 1;
            SFX.coin();
            scene.remove(c.mesh); coins.splice(i, 1);
        } else if (c.z > 4) {
            scene.remove(c.mesh); coins.splice(i, 1);
        }
    }

    // 道具
    for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        p.z += step;
        placeOnTrack(p.mesh, p.x, p.y + Math.sin(S.D * 0.2) * 0.15, p.z);
        p.mesh.userData.icon.rotation.y += dt * 3;
        if (p.mesh.userData.ring) p.mesh.userData.ring.rotation.z += dt * 1.4;
        if (p.mesh.userData.halo) p.mesh.userData.halo.scale.setScalar(1 + Math.sin(S.D * 0.3) * 0.07);
        const dx = p.x - S.x, dy = p.y - cy, dz = p.z;
        const hitR = p.type === 'revive' ? 3.4 : 1.7;    // 复活币体积大，判定放宽，别擦肩而过
        if (dx * dx + dy * dy + dz * dz < hitR) {
            if (p.type === 'revive') takeRevive();
            // [PKVS] 干扰道具：不进自己的 power 计时，吃到立刻打对手
            else if (p.type.indexOf('pk_') === 0) {
                if (typeof window.__pkPickItem === 'function') window.__pkPickItem(p.type.slice(3));
                else showMsg('获得 ' + CONFIG.powerUps[p.type].name + '！');
            }
            else {
                S.power[p.type] = powerDur(p.type);
                if (p.type === 'wings') startFlight();
                else { SFX.power(); showMsg('获得 ' + CONFIG.powerUps[p.type].icon + ' ' + CONFIG.powerUps[p.type].name + '！'); }
            }
            disposeObj(p.mesh); pickups.splice(i, 1);
        } else if (p.z > 4) {
            disposeObj(p.mesh); pickups.splice(i, 1);
        }
    }

    S.score = Math.floor(S.D) + S.coins * CONFIG.coinScore;

    // —— 角色动画（状态机 + 帧率无关平滑 + 次级运动） ——
    S.phase += dt * (8 + S.speed * 0.28);
    const instVx = (S.x - S.prevX) / Math.max(dt, 1e-4);
    S.prevX = S.x;
    S.vx = damp(S.vx, instVx, 12, dt);
    const poseState = {
        phase: S.phase, speed: S.speed, vx: S.vx, vy: S.vy,
        grounded: S.grounded, flying: S.flying,
        rolling: S.rolling, rollProg: S.rolling > 0 ? 1 - S.rolling / ROLL_TIME : 0,
        anticip: S.anticip, climb: S.holdUp ? 1 : (S.holdDown ? -1 : 0), wing: S.flight.open,
    };
    stepAnim(ANIM, dt, poseState);
    applyPose(player, ANIM, poseState);
    if (player.sync) player.sync();
    updateWings(dt, S.flight.open, poseState.climb);
    player.root.position.set(S.x, S.y, 0);
    player.root.rotation.y = damp(player.root.rotation.y, 0, 10, dt);   // 菜单展示时转身，开局转回前方
    const shake = S.stumbleCool > 0 ? Math.sin(S.stumbleCool * 45) * 0.2 * S.stumbleCool : 0;
    player.root.rotation.z = (S.x - LANES[S.lane]) * 0.12 + shake + ANIM.lean * 0.05;
    shieldBubble.visible = S.power.shield > 0;
    shieldBubble.material.opacity = 0.18 + Math.sin(S.D * 0.3) * 0.07;
    if (player.shoeMat) player.shoeMat.color.setHex(S.power.sneakers > 0 ? CONFIG.powerUps.sneakers.color : player.baseShoe);

    // 追捕者：平时在镜头后面，绊倒后会追到身后
    const target = S.chaserTimer > 0 && !S.flying ? 2.2 : 16;
    S.chaserDist += (target - S.chaserDist) * Math.min(1, dt * 2);
    updateChaser(dt, S.chaserDist);
}

function updateChaser(dt, dist) {
    const visible = dist < 12;
    chaser.root.visible = visible;
    // 站在玩家斜后方，避免挡住镜头
    // 固定在玩家右后方跟随（边道时夹在路基内）；原来 lane 2 会换侧，目标瞬间跳 3.8m 导致猛蹿
    const tx = Math.max(-3.3, Math.min(3.3, S.x + 1.9));
    const cx = chaser.px == null ? tx : chaser.px;   // 跑道系里的横向位置（校园要投影）
    chaser.px = cx + (tx - cx) * Math.min(1, dt * 4);
    placeOnTrack(chaser.root, chaser.px, 0, dist);
    // 不在视野里（dist ≥ 12）就跳过整段动画：保安有 17 根骨骼 + 几十次矩阵运算，
    // 每帧白算是明显的 CPU 浪费。相位由 S.phase 驱动，重新出现时姿态自然衔接。
    if (!visible) return;
    const p = S.phase * 1.05 + 1;
    stepAnim(CHASER_ANIM, dt, { grounded: true, speed: S.speed, phase: p });
    poseRun(chaser, CHASER_ANIM, { phase: p, speed: S.speed, grounded: true });
    if (chaser.hasModel) {
        guardClock += dt;
        const TAU = Math.PI * 2;
        const stepHz = 1.35;
        const ph = guardClock * TAU * stepHz;
        const chasing = S.chaserTimer > 0;
        const cyc = 2.6;
        const pt = (guardClock % cyc) / cyc;
        const punch = chasing && pt < 0.16 ? Math.sin(pt / 0.16 * Math.PI) : 0;
        const b = chaser.bones;
        if (b && b.LeftUpLeg && b.RightUpLeg) {
            // 人类跑步步态（17 骨 Mixamo 命名，真膝/肘关节）
            // 骨骼方向约定（已实测）：腿/臂骨 +x=向后摆，膝 +x=屈膝，肘 -x=屈肘，脊柱 +x=前倾
            // 臂骨 z：左臂 -z=外展，右臂 +z=外展（模型静止时手臂外张约35°，略收一点避免"鸡翅肘"）
            // 髋：前屈约40°、后伸约19°（总摆幅约59°，参考值 60~70°）
            // 膝：触地约23°、支撑期 23~32°，摆动期峰值约110°（参考值 90~110°，快跑可达120°+）
            // 肩：企鹅式贴身轻摆，前后各约13°（圆胖模型大摆臂会把肩膀皮肤拉裂），与同侧腿对摆
            // 肘：模型是短圆鳍状臂，不屈肘，保持自然下垂贴身体（屈90°会把前臂甩成扇面突出来）
            const HIP_MID = 0.21, HIP_AMP = 0.54;
            const SH_MID = 0.0, SH_AMP = 0.22, ARM_Z = 0.12;
            const hipX = (p) => -(HIP_MID + HIP_AMP * Math.cos(p));   // cos=1 时最大前屈（触地）
            const kneeX = (p) => {
                const u = (((p % TAU) + TAU) % TAU) / TAU;            // 0=触地 0.5=离地 1=触地
                if (u >= 0.5) return 0.40 + 1.50 * Math.pow(Math.max(0, Math.sin((u - 0.5) * 2 * Math.PI)), 0.9); // 摆动期收腿，峰值约110°
                return 0.40 + 0.15 * Math.sin(Math.PI * Math.min(1, u / 0.5));                                    // 支撑期微屈，触地约23°
            };
            const phR = ph + Math.PI;
            b.LeftUpLeg.rotation.x = hipX(ph);
            b.RightUpLeg.rotation.x = hipX(phR);
            b.LeftLeg.rotation.x = kneeX(ph);
            b.RightLeg.rotation.x = kneeX(phR);
            b.LeftArm.rotation.x = SH_MID + SH_AMP * Math.cos(ph);
            b.RightArm.rotation.x = SH_MID - SH_AMP * Math.cos(ph) - punch * 1.1;   // 出拳叠加在摆臂上
            b.LeftArm.rotation.z = -ARM_Z;                            // 略外展，肘部避开大肚子
            b.RightArm.rotation.z = ARM_Z;
            b.LeftForeArm.rotation.x = 0;                                          // 短圆鳍状臂：肘不屈，保持下垂贴身体
            b.RightForeArm.rotation.x = punch * 1.0;                              // 只有追上出拳时才伸肘
            b.Spine.rotation.x = 0.06;    // 略微前倾
            b.Head.rotation.x = -0.02;
            b.Hips.rotation.x = 0;
        }
        // 不再做整体起伏/扭动，避免"抖"的观感
        chaserModel.position.y = 0;
        chaserModel.position.z = 0;   // 出拳只挥臂，身体不再每 2.6s 前蹿一次
        chaserModel.rotation.x = -0.04;
        // 朝向：脸朝向玩家，但限制转身速度——玩家换道时 dx 会扫过好几米，
        // 直接跟踪 atan2 目标会让身体朝向高速来回甩（就是之前看到的"抖"）
        const px = player.root.position.x, pz = player.root.position.z;
        const dx = px - chaser.root.position.x, dz = pz - chaser.root.position.z;
        const targetYaw = Math.atan2(dx, dz);
        if (chaser.yaw == null) chaser.yaw = targetYaw;
        let dy = targetYaw - chaser.yaw;
        while (dy > Math.PI) dy -= TAU;
        while (dy < -Math.PI) dy += TAU;
        const maxTurn = 1.2 * dt;                  // 每秒最多转约 69°，平滑转身不甩动
        chaser.yaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
        chaserModel.rotation.y = chaser.yaw;
    }
}

function updateDying(dt) {
    S.dieT += dt;
    const step = S.speed * Math.max(0, 1 - S.dieT * 3) * dt;
    S.D += step;
    scrollWorld(step, S.D);
    for (const o of obstacles) { o.z += step; placeOnTrack(o.mesh, o.x, 0, o.z); }
    for (const c of coins) { c.z += step; placeOnTrack(c.mesh, c.x, c.y, c.z); }
    for (const p of pickups) { p.z += step; placeOnTrack(p.mesh, p.x, p.y, p.z); }

    if (S.y > 0 && surfaceAt(S.x, S.y) < S.y) { S.vy -= CONFIG.jump.gravity * dt; S.y = Math.max(surfaceAt(S.x, S.y), S.y + S.vy * dt); }
    player.root.position.set(S.x, S.y, 0);
    poseFall(player, ANIM);
    if (player.sync) player.sync();
    updateWings(dt, false, 0);

    S.chaserDist += (1.6 - S.chaserDist) * Math.min(1, dt * 3);
    updateChaser(dt, S.chaserDist);
    if (S.dieT > 0.6) poseFall(chaser, CHASER_ANIM);
    else S.phase += dt * 12;

    if (S.dieT > 1.6 && !S.overShown) showGameOver();
}

function updateMenu(dt) {
    S.D = (S.D || 0) + 6 * dt;
    scrollWorld(6 * dt, S.D);
    S.phase = (S.phase || 0) + dt * 9;
    S.menuT = (S.menuT || 0) + dt;
    // 转身面向镜头，展示角色细节（脸、推到头顶的墨镜、连帽外套）
    player.root.rotation.y = damp(player.root.rotation.y, Math.PI * 0.97, 2.8, dt);
    player.root.rotation.z = 0;
    stepAnim(ANIM, dt, { grounded: true, speed: 0, phase: S.menuT });
    if (player.isModel) poseModelIdle(player, ANIM, S.menuT); else poseShowcase(player, ANIM, S.menuT);
    if (player.sync) player.sync();
    // 站到画面右侧，避开菜单中间的按钮和按键提示
    player.root.position.set(1.6, 0, 0);
    updateWings(dt, 0, 0);
    chaser.root.visible = false;
}

// ---------- 相机 ----------
// ---- 内联模块：js/OrbitFanfareCamera.js（终点环绕过场镜头） ----
const OrbitFanfareCamera = (function () {
/**
 * ============================================================================
 *  OrbitFanfareCamera · 终点环绕过场镜头（Orbit Fanfare Camera）
 * ============================================================================
 *  纯 ES Module，唯一外部依赖是 three（在 r160 上验证通过，r150+ 理论可用）。
 *
 *  ── 职责边界（很重要，别越界） ──────────────────────────────────────────
 *   ✅ 本模块【只】生产相机位姿（position + quaternion + 可选 fov）。
 *   ✅ 不监听碰撞 / 触发器 —— "何时算到终点" 由调用方判断，然后调 play(target)。
 *   ✅ 不碰 Animator / AnimationMixer —— 通过 onStart / onOrbitStart / onProgress /
 *      onComplete / onSkip 回调把进度告诉你，角色摆什么姿势完全由你决定。
 *   ✅ 不认识你的输入系统 —— 通过 onInputLockChange(locked) 告诉你"该锁"还是"该放"，
 *      你自己接到自己的输入管理器上。模块不知道"输入"在你游戏里长什么样。
 *
 *  ── 帧更新的驱动方式：这里选【调用方驱动 update(delta)】，不自建 rAF ────────
 *   理由（3 条，都是踩过的坑）：
 *     1. 你的游戏必然已经有一个 rAF / renderer.setAnimationLoop 主循环。模块内部再
 *        开一个 rAF 就会出现两套时钟，同帧被步进两次或先后顺序错乱（相机比场景晚一
 *        帧 → 视觉拖影/抖动）。
 *     2. 交给调用方步进，暂停菜单、timeScale、录像回放、逐帧调试都能自然生效。
 *     3. delta 由调用方给，天然与帧率解耦：30fps / 60fps / 120fps 下转速完全一致。
 *   如果你的工程确实没有主循环（例如裸 canvas 试验），自己包 5 行即可：
 *
 *      const clock = new THREE.Clock();               // ← 只 new 一次
 *      function tick() {
 *        requestAnimationFrame(tick);
 *        fanfare.update(clock.getDelta());            // ← 本模块的唯一入口
 *        renderer.render(scene, camera);
 *      }
 *      tick();
 *
 *   注意：clock.getDelta() 每帧只能被调用一次，多处调用会互相"吃掉"时间。
 *
 *  ── 坐标系约定 ────────────────────────────────────────────────────────
 *   假定 Y-up（three.js 默认）。若你的场景是 Z-up，改 UP 常量与球坐标的极轴即可，
 *   本模块不硬编码重力方向以外的假定。
 * ============================================================================
 */

// 内联版：THREE 由宿主主模块提供，不再单独 import

const TWO_PI = Math.PI * 2;
/** 环绕轨道的极轴（Y-up） */
const UP = new THREE.Vector3(0, 1, 0);

/** 缓动：ease-in-out（三次）。用于切入 / 切出，避免生硬加减速 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 数值夹取（避免调用方传 Δ 时还要 import MathUtils） */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 有限数字判断 */
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/* ==========================================================================
 *  ★★★ 所有可调参数都集中在这里，改这里就够了 ★★★
 * ========================================================================== */
const DEFAULT_OPTIONS = {
  // ── 时长（秒）────────────────────────────────────────────────────────
  /** 切入时长：从"当前相机位姿"平滑过渡到环绕轨道起点 */
  introDuration: 1.0,
  /**
   * 切入的"峰值速度预算"，单位是 **每秒多少个角色身高**（不是绝对距离，这样换体型
   * 体型/世界尺度都不用改参数）。<=0 表示关闭自适应。
   *
   * 为什么需要它：切入位移完全取决于调用前相机离角色多远。正常跟随时只有几个单位，
   * 1 秒很舒服；但如果你做了角色瞬移 / 重生 / 关卡跳转，相机可能在 20 单位外，
   * 1 秒飞过来就成了"甩镜"。这个预算会把切入时长自动拉长到峰值速度不超过预算。
   * 默认 13 ≈ 1.8m 的角色对应 23 u/s 的峰值，常规跟随机位（约 5~6 单位）算下来
   * 只需要 0.7 秒，短于 1 秒 → 不会改变默认手感。
   */
  introSpeedBudget: 13,
  /** 自适应拉长后的切入时长上限（秒），防止极远距离导致切入过长 */
  introDurationMax: 3.0,
  /**
   * 主环绕时长：转满 360° 所需时间。
   * 默认 10s = 36°/s，属于"缓慢"档。想要"全程正好 10 秒"就把这个设 8
   * （8 + 1 + 1 = 10）。见 docs 参数表。
   */
  orbitDuration: 10.0,
  /** 切出时长：从结束机位平滑过渡回"交还机位"（默认 = 进场时捕获的那个跟随相机位姿） */
  outroDuration: 1.0,
  /** 切出的峰值速度预算，语义同 introSpeedBudget */
  outroSpeedBudget: 13,
  /** 切出时长上限（秒） */
  outroDurationMax: 3.0,

  // ── 轨道几何（单位 = 你的世界单位，通常为米）───────────────────────────
  /** 水平轨道半径。null = 依据角色包围盒身高 + 相机 FOV 自动推算一个能完整入画的默认值 */
  orbitDistance: null,
  /** 轨道相对"聚焦点"的垂直高度。null = 由 orbitDistance × tan(orbitPitchDeg) 自动推算 */
  orbitHeight: null,
  /** 自动推算高度时使用的仰角（度）。正值 = 相机略高于聚焦点，俯视角色 */
  orbitPitchDeg: 12,
  /**
   * 聚焦点在角色包围盒内的相对高度：0 = 脚底，1 = 头顶。
   * 0.62 ≈ 胸口/下巴，最适合"人物居中"的构图。
   */
  focusHeightRatio: 0.62,
  /**
   * 自动推算距离时的取景占比：角色身高占画面垂直高度的比例。
   * 0.5 = 角色约占画面一半高，上下各留 1/4 空白；0.7 以上会显得逼仄。
   */
  framingFill: 0.5,
  /** 环绕方向：true = 正向（theta 递增），false = 反向 */
  clockwise: true,

  // ── 镜头 ────────────────────────────────────────────────────────────
  /** 过场期间的目标 FOV。null = 完全不碰相机的 fov（推荐先保持 null） */
  fov: null,

  // ── 行为 ────────────────────────────────────────────────────────────
  /** 是否允许中途跳过（按键 / 点击） */
  allowSkip: true,
  /** 触发跳过的 KeyboardEvent.code 列表 */
  skipKeys: ['Space', 'Escape', 'Enter'],
  /** 是否允许鼠标/触摸按下即跳过 */
  skipOnPointer: true,
  /**
   * 单帧 delta 上限（秒）。切标签页 / 断点调试回来后 delta 可能是几十秒，
   * 不夹取会瞬间跳完整段动画。0.1 ≈ 允许的最低 10fps。
   */
  maxDelta: 0.1,

  // ── 回调（全部可选，签名见 docs 参数表）─────────────────────────────
  /** () => void  环绕流程开始（切入的第一帧之前） */
  onStart: null,
  /** () => void  切入完成、360° 环绕正式开始（适合此刻让角色播胜利动作） */
  onOrbitStart: null,
  /** (progress: 0..1, cameraPos: Vector3) => void  环绕阶段的每帧进度 */
  onProgress: null,
  /** () => void  已平滑交还机位、输入锁已释放（整个流程结束） */
  onComplete: null,
  /** () => void  用户中途跳过（在切出开始之前触发） */
  onSkip: null,
  /** () => void  播放中被再次 play() 打断（换目标 / 重播） */
  onCancel: null,
  /** (locked: boolean) => void  输入锁状态变化 —— 请在这里禁用你自己的相机控制器 & 角色输入 */
  onInputLockChange: null,
  /**
   * (outPosition: Vector3, outQuaternion: Quaternion) => void
   * 可选：动态指定"交还机位"。你的 CameraRig 有跟随阻尼时，用它把理想位姿写进
   * outPosition / outQuaternion，切出就会精准落位，不会有最后一帧的"啪"一下。
   * 不提供时 = 回到 play() 时捕获的那个位姿。
   */
  getReturnPose: null,
};

/* ========================================================================== */

/** 播放阶段 */
const PHASE = {
  IDLE: 'idle',
  INTRO: 'intro',
  ORBIT: 'orbit',
  OUTRO: 'outro',
};

class OrbitFanfareCamera {
  /**
   * @param {THREE.Camera} camera  你游戏里正在用的那台相机（模块会直接改写它的 pose）
   * @param {Partial<typeof DEFAULT_OPTIONS>} [options]
   */
  constructor(camera, options = {}) {
    if (!camera || !camera.isCamera) {
      throw new Error('[OrbitFanfareCamera] 第一个参数必须是 THREE.Camera 实例');
    }

    this.camera = camera;
    this.options = Object.assign({}, DEFAULT_OPTIONS, options);

    // 本模块直接写 camera.position / camera.quaternion —— 这两个是【局部坐标】。
    // 如果相机挂在某个父节点（CameraRig / 手持抖动节点）下，写进去的位姿会再乘一次
    // 父变换，画面就会偏。这里提前警告，别等到线上才发现。
    if (camera.parent && camera.parent.type !== 'Scene') {
      console.warn(
        '[OrbitFanfareCamera] 相机不是 Scene 的直接子节点（parent = ' +
        (camera.parent.name || camera.parent.type) +
        '）。本模块写的是局部坐标，父节点带变换时画面会偏。' +
        '解决：过场期间把相机 detach 到 Scene 上，或让相机始终是 Scene 的直接子节点。'
      );
    }

    /** @type {THREE.Object3D|null} 当前环绕目标 */
    this.targetObject = null;

    this._phase = PHASE.IDLE;
    this._disposed = false;
    this._inputLocked = false;

    // ── 计时 ──
    this._phaseTime = 0;      // 当前阶段已用时间（秒）
    this._orbitProgress = 0;  // 环绕进度 0..1

    // ── 本次实际使用的切入/切出时长（可能被速度预算自适应拉长）──
    this._introDuration = this.options.introDuration;
    this._outroDuration = this.options.outroDuration;

    // ── 轨道参数（play() 时求解）──
    this._targetHeight = 1.8;
    this._orbitRadiusH = 3.5;   // 水平半径
    this._orbitHeightY = 0.75;  // 相对聚焦点的高度
    this._startAzimuth = 0;     // 环绕起始方位角（弧度）
    this._dir = 1;              // 旋转方向 ±1

    // ── 聚焦点：以"目标物体局部坐标"保存，每帧用 matrixWorld 求出世界坐标，
    //    这样角色走动/转身时环绕中心能跟着走，而不用每帧重算包围盒 ──
    this._focusLocal = new THREE.Vector3();

    // ── FOV 过渡 ──
    this._homeFov = camera.fov;
    this._orbitFov = null;      // 解析后的目标 fov（null = 不启用）
    this._outroFromFov = camera.fov;

    /* ---------------- 每帧复用的临时对象（update 里绝不 new） ---------------- */
    this._vHomePos = new THREE.Vector3();      // 进场时的相机位置 = 默认交还位置
    this._qHomeQuat = new THREE.Quaternion();  // 进场时的相机朝向
    this._vFromPos = new THREE.Vector3();      // 本次切入的起点位置
    this._qFromQuat = new THREE.Quaternion();  // 本次切入的起点朝向
    this._vFocus = new THREE.Vector3();        // 当前聚焦点（世界坐标）
    this._vOrbitStart = new THREE.Vector3();   // 环绕轨道起点位置（每帧可刷新）
    this._qOrbitStart = new THREE.Quaternion();
    this._vOutroFromPos = new THREE.Vector3();
    this._qOutroFromQuat = new THREE.Quaternion();
    this._vReturnPos = new THREE.Vector3();    // 交还位置
    this._qReturnQuat = new THREE.Quaternion();
    this._spherical = new THREE.Spherical(1, Math.PI / 2, 0);
    this._mat4 = new THREE.Matrix4();
    this._qTmp = new THREE.Quaternion();
    this._box = new THREE.Box3();
    this._vSize = new THREE.Vector3();

    /* ---------------- 跳过监听 ---------------- */
    // 绑定成实例属性，dispose 时才能精确移除（匿名函数是移除不掉的经典内存泄漏）
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._listening = false;
    this._attachSkipListeners();
  }

  /* ====================================================================== */
  /*  公开 API                                                              */
  /* ====================================================================== */

  /** 是否正在播放（切入 / 环绕 / 切出 均算 true） */
  get isPlaying() {
    return this._phase !== PHASE.IDLE;
  }

  /** 当前阶段：'idle' | 'intro' | 'orbit' | 'outro' */
  get phase() {
    return this._phase;
  }

  /** 环绕进度 0..1（切入阶段恒 0，切出阶段恒 1） */
  get progress() {
    return this._orbitProgress;
  }

  /** 输入锁是否已上锁（供调试面板显示） */
  get inputLocked() {
    return this._inputLocked;
  }

  /**
   * 启动环绕。
   * 重复调用的语义：
   *   - 播放中再次 play(newTarget)：从"当前这一帧的真实相机位姿"重新切入到新目标的
   *     轨道；不会重建输入锁；会触发 onCancel。
   *   - 空闲时 play()：捕获当前相机位姿作为"交还机位"，上输入锁，触发 onStart。
   *
   * @param {THREE.Object3D} target  要环绕的物体（通常是角色根节点）
   * @returns {boolean} 是否成功启动
   */
  play(target) {
    if (this._disposed) {
      console.warn('[OrbitFanfareCamera] 实例已 dispose，play() 被忽略');
      return false;
    }
    if (!target || !target.isObject3D) {
      console.warn('[OrbitFanfareCamera] play(target) 需要传入 THREE.Object3D');
      return false;
    }

    const wasPlaying = this._phase !== PHASE.IDLE;

    // 1) 本次切入的起点 = 这一帧的真实相机位姿（保证任何情况下都不硬切）
    this._vFromPos.copy(this.camera.position);
    this._qFromQuat.copy(this.camera.quaternion);

    // 2) "交还机位"只在 idle → 播放 时捕获一次。播放中被重新 play() 时保留原始的
    //    跟随相机位姿，否则会把环绕机位当成"家"而原地不动。
    if (!wasPlaying) {
      this._vHomePos.copy(this.camera.position);
      this._qHomeQuat.copy(this.camera.quaternion);
      this._homeFov = this.camera.fov;
    }

    // 3) 量目标 + 解轨道
    this.targetObject = target;
    this._measureTarget();
    this._solveOrbit();

    // 4) 预演一次轨道起点位姿，据此决定本次切入需要多久（远距离自动拉长）
    this._poseAtAngle(this._startAzimuth, this._vOrbitStart, this._qOrbitStart);
    this._introDuration = this._adaptDuration(
      this.options.introDuration,
      this._vFromPos.distanceTo(this._vOrbitStart),
      this.options.introSpeedBudget,
      this.options.introDurationMax
    );

    // 5) 重置计时与阶段
    this._phaseTime = 0;
    this._orbitProgress = 0;
    this._outroFromFov = this.camera.fov;
    this._phase = PHASE.INTRO;
    this._dir = this.options.clockwise ? 1 : -1;

    // 6) 上输入锁（播放中重复 play 不会重复触发，因为状态没变）
    this._setInputLocked(true);

    if (wasPlaying) this._call('onCancel');
    this._call('onStart');

    return true;
  }

  /**
   * 中途跳过：立刻转入切出阶段（平滑回归 + 交还控制权），不会硬切。
   * 空闲 / 已在切出 / allowSkip=false 时返回 false（幂等）。
   * @returns {boolean} 是否真的执行了跳过
   */
  skip() {
    if (this._disposed) return false;
    if (!this.options.allowSkip) return false;
    if (this._phase === PHASE.IDLE || this._phase === PHASE.OUTRO) return false;

    this._call('onSkip');
    this._beginOutro();
    return true;
  }

  /**
   * 每帧步进入口（把主循环的 delta 喂进来）。
   * @param {number} deltaSeconds 距上一帧的秒数
   */
  update(deltaSeconds) {
    if (this._disposed || this._phase === PHASE.IDLE) return;

    let dt = isNum(deltaSeconds) ? deltaSeconds : 0;
    if (dt < 0) dt = 0;
    if (dt > this.options.maxDelta) dt = this.options.maxDelta;

    switch (this._phase) {
      case PHASE.INTRO:
        this._tickIntro(dt);
        break;
      case PHASE.ORBIT:
        this._tickOrbit(dt);
        break;
      case PHASE.OUTRO:
        this._tickOutro(dt);
        break;
      default:
        break;
    }
  }

  /**
   * 销毁：移除全局监听器、释放在飞的输入锁、断开引用。
   * 播放中 dispose 会触发一次 onInputLockChange(false)，否则你的游戏会永久失去输入。
   */
  dispose() {
    if (this._disposed) return;

    this._detachSkipListeners();

    // 先放锁再断开回调，保证调用方一定能收到"解锁"这件事
    this._setInputLocked(false);

    this._disposed = true;
    this._phase = PHASE.IDLE;
    this._orbitProgress = 0;
    this.targetObject = null;
    this.camera = null;
  }

  /* ====================================================================== */
  /*  阶段实现                                                              */
  /* ====================================================================== */

  /** 切入：位置 lerp + 朝向 slerp + ease-in-out，起点是真实相机位姿，终点是轨道起点 */
  _tickIntro(dt) {
    this._phaseTime += dt;
    const dur = this._introDuration;
    const raw = dur > 0 ? this._phaseTime / dur : 1;

    // 轨道起点每帧重算（角色若在切入过程中走动，目标点跟着走，避免切完瞬间瞬移）
    this._refreshFocusWorld();
    this._poseAtAngle(this._startAzimuth, this._vOrbitStart, this._qOrbitStart);

    if (raw >= 1) {
      // 精确落到轨道起点，杜绝一帧的浮点缝隙
      this.camera.position.copy(this._vOrbitStart);
      this.camera.quaternion.copy(this._qOrbitStart);
      this._applyFov(this._orbitFov);
      this._orbitProgress = 0;
      this._phase = PHASE.ORBIT;
      this._phaseTime = 0;
      this._call('onOrbitStart');
      return;
    }

    const t = easeInOutCubic(raw);
    this.camera.position.lerpVectors(this._vFromPos, this._vOrbitStart, t);
    // slerp 而不是逐轴欧拉插值：避免万向节死锁和朝向"绕远路"
    this.camera.quaternion.copy(this._qFromQuat).slerp(this._qOrbitStart, t);
    if (this._orbitFov !== null) {
      this._applyFov(this._homeFov + (this._orbitFov - this._homeFov) * t);
    }
  }

  /**
   * 环绕：球坐标 + 累积角度，匀速（线性）。
   *
   * 为什么主段不用缓动？
   *   缓动用在首尾会让"中段最快"，而观众的眼睛恰恰在中段最专注 —— 加速穿过最有
   *   信息量的那半圈反而显得毛躁。匀速旋转 = 稳定的观影节奏，也符合"缓慢环绕"的
   *   直觉。加减速的柔和感由 intro/outro 的 ease-in-out 负责，衔接处不会突兀。
   *
   * 为什么绝不对角度取模？
   *   theta 用 `start + dir * p * 2π` 累加，p 从 0 单调走 1，全程只增不减；
   *   如果写成 `lerpAngle(start, start+2π, p)` 再对 2π 取模，359°→0° 会被插值成
   *   反向转一圈（经典 bug）。这里连 wrap 的机会都没有。
   */
  _tickOrbit(dt) {
    this._phaseTime += dt;
    const dur = this.options.orbitDuration;
    const p = dur > 0 ? clamp(this._phaseTime / dur, 0, 1) : 1;
    this._orbitProgress = p;

    this._refreshFocusWorld();

    const theta = this._startAzimuth + this._dir * p * TWO_PI;
    this._spherical.theta = theta;

    // 位置：球坐标 → 世界坐标。直接写进 camera.position，不再额外中转
    this.camera.position.setFromSpherical(this._spherical).add(this._vFocus);

    // 朝向：用 Matrix4.lookAt 一次性算稳定四元数。
    // 不用 camera.lookAt()（它会顺带用 camera.up 和欧拉角路径），也不用逐帧
    // 对"上一帧朝向"做增量插值 —— 后者是镜头抖动的头号来源。
    this._mat4.lookAt(this.camera.position, this._vFocus, UP);
    this.camera.quaternion.setFromRotationMatrix(this._mat4);

    this._call('onProgress', p, this.camera.position);

    if (p >= 1) this._beginOutro();
  }

  /** 切出：从当前真实位姿 slerp/lerp 回"交还机位"（ease-in-out） */
  _tickOutro(dt) {
    this._phaseTime += dt;
    const dur = this._outroDuration;
    const raw = dur > 0 ? this._phaseTime / dur : 1;

    if (raw >= 1) {
      this._finish();
      return;
    }

    const t = easeInOutCubic(raw);
    this.camera.position.lerpVectors(this._vOutroFromPos, this._vReturnPos, t);
    this.camera.quaternion.copy(this._qOutroFromQuat).slerp(this._qReturnQuat, t);
    if (this._orbitFov !== null) {
      this._applyFov(this._outroFromFov + (this._homeFov - this._outroFromFov) * t);
    }
  }

  /** 进入切出阶段：冻结当前位姿作为起点，解析交还机位 */
  _beginOutro() {
    this._vOutroFromPos.copy(this.camera.position);
    this._qOutroFromQuat.copy(this.camera.quaternion);
    this._outroFromFov = this.camera.fov;

    // 默认交还机位 = 进场时捕获的跟随相机位姿
    this._vReturnPos.copy(this._vHomePos);
    this._qReturnQuat.copy(this._qHomeQuat);

    // 调用方可以动态指定（有阻尼跟随的 CameraRig 强烈建议提供）
    const provider = this.options.getReturnPose;
    if (typeof provider === 'function') {
      try {
        provider(this._vReturnPos, this._qReturnQuat);
      } catch (err) {
        console.error('[OrbitFanfareCamera] getReturnPose 执行出错，退回默认交还机位', err);
        this._vReturnPos.copy(this._vHomePos);
        this._qReturnQuat.copy(this._qHomeQuat);
      }
      // 兜底：provider 写了 NaN 就退回默认值，避免相机被 NaN 感染后永久黑屏
      if (!isNum(this._vReturnPos.x) || !isNum(this._vReturnPos.y) || !isNum(this._vReturnPos.z)) {
        console.warn('[OrbitFanfareCamera] getReturnPose 产生了非法位置，退回默认交还机位');
        this._vReturnPos.copy(this._vHomePos);
      }
      this._qReturnQuat.normalize();
    }

    this._orbitProgress = 1;
    this._phase = PHASE.OUTRO;
    this._phaseTime = 0;

    // 交还机位可能离得很远（角色在过场中被移动过 / 你的 Rig 有自己的偏移），
    // 同样用速度预算自适应切出时长，避免"啪"一下甩回去。
    this._outroDuration = this._adaptDuration(
      this.options.outroDuration,
      this._vOutroFromPos.distanceTo(this._vReturnPos),
      this.options.outroSpeedBudget,
      this.options.outroDurationMax
    );

    if (!(this._outroDuration > 0)) this._finish();
  }

  /** 收尾：精确落位 → 恢复 FOV → 置空闲 → 放输入锁 → onComplete */
  _finish() {
    this.camera.position.copy(this._vReturnPos);
    this.camera.quaternion.copy(this._qReturnQuat);
    this._applyFov(this._homeFov);

    this._phase = PHASE.IDLE;
    this._orbitProgress = 1;

    // 先放锁再回调：这样 onComplete 里可以立刻启动下一段相机动效而不会被自己挡住
    this._setInputLocked(false);
    this._call('onComplete');
  }

  /* ====================================================================== */
  /*  几何求解                                                              */
  /* ====================================================================== */

  /**
   * 量目标体型：用包围盒推身高，取包围盒内 focusHeightRatio 处作为聚焦点，
   * 并换算到目标局部坐标（之后每帧只需一次 matrixWorld 乘法，不重算包围盒）。
   */
  _measureTarget() {
    const t = this.targetObject;

    // 目标可能是本帧刚创建/刚移动的，先刷新自身与子节点的世界矩阵
    if (typeof t.updateWorldMatrix === 'function') t.updateWorldMatrix(true, true);

    this._box.setFromObject(t);

    let height = 1.8; // 兜底：成年人身高量级
    if (!this._box.isEmpty()) {
      this._box.getSize(this._vSize);
      if (isNum(this._vSize.y) && this._vSize.y > 0.01) {
        height = this._vSize.y;
      } else {
        // 扁的物体（如一个盘子）没有"身高"，退化为最长边
        height = Math.max(this._vSize.x, this._vSize.z, 0.01);
      }
    }
    this._targetHeight = height;

    // 聚焦点（世界坐标）
    if (!this._box.isEmpty()) {
      const ratio = clamp(this.options.focusHeightRatio, 0, 1);
      this._vFocus.set(
        (this._box.min.x + this._box.max.x) * 0.5,
        this._box.min.y + height * ratio,
        (this._box.min.z + this._box.max.z) * 0.5
      );
    } else {
      t.getWorldPosition(this._vFocus);
    }

    // 世界 → 局部，供每帧跟随
    this._focusLocal.copy(this._vFocus);
    if (typeof t.worldToLocal === 'function') t.worldToLocal(this._focusLocal);
  }

  /**
   * 解轨道：水平半径 / 高度 / 3D 半径 / 极角 / 起始方位角。
   * 半径与高度都能从包围盒自动推算，也都能被 options 手动覆盖。
   */
  _solveOrbit() {
    const opt = this.options;

    // 自动取景距离：让身高为目标占画面垂直高度的 framingFill。
    // d = h / (2 · fill · tan(fov/2))   ← 针孔相机竖直方向视锥的解析解
    const fovDeg = isNum(opt.fov) && opt.fov > 0 ? opt.fov : (this.camera.fov || 50);
    const vFov = THREE.MathUtils.degToRad(fovDeg);
    const fill = clamp(opt.framingFill, 0.05, 1);
    const tanHalf = Math.tan(vFov * 0.5);
    const autoDistance = this._targetHeight / (2 * fill * (tanHalf > 1e-4 ? tanHalf : 1e-4));

    const distH = isNum(opt.orbitDistance) && opt.orbitDistance > 1e-3 ? opt.orbitDistance : autoDistance;
    const pitch = THREE.MathUtils.degToRad(opt.orbitPitchDeg || 0);
    const heightY = isNum(opt.orbitHeight) ? opt.orbitHeight : distH * Math.tan(pitch);

    this._orbitRadiusH = distH;
    this._orbitHeightY = heightY;

    // 球坐标：(radius, phi, theta)
    //   phi 是从 +Y 轴量下来的极角，sin(phi) = 水平半径/3D半径，cos(phi) = 高度/3D半径
    //   theta 是从 +Z 轴量起的方位角，等价于 atan2(dx, dz) —— 与下面的 _startAzimuth 一致
    const r3 = Math.hypot(distH, heightY);
    this._spherical.radius = r3 > 1e-4 ? r3 : 1e-4;
    this._spherical.phi = Math.atan2(distH, heightY);
    this._spherical.theta = 0;

    // 起始方位角 = 相机当前相对聚焦点的方位角。
    // 这么做的两个好处：
    //   1. 切入只需要"径向推进 + 抬/降高度"，位移最短，看起来最自然；
    //   2. 转满 360° 后相机恰好回到切入时的方位，切出回到跟随机位几乎是零位移，
    //      完全不会出现"绕完又跳一下"。
    const dx = this._vFromPos.x - this._vFocus.x;
    const dz = this._vFromPos.z - this._vFocus.z;
    const horiz = Math.hypot(dx, dz);
    // 相机正上方/正下方时方位角在数学上无定义，此时任取 0（视觉上也看不出差别）
    this._startAzimuth = horiz > 1e-3 ? Math.atan2(dx, dz) : 0;

    // FOV 过渡准备（_homeFov 只在 play() 的 idle→播放 分支里捕获，这里不能覆盖）
    this._orbitFov = isNum(opt.fov) && opt.fov > 0 ? opt.fov : null;
  }

  /** 用目标的当前 matrixWorld 刷新聚焦点世界坐标（移动/转身的目标也能被正确环绕） */
  _refreshFocusWorld() {
    const t = this.targetObject;
    // 目标中途被移除时不动 _vFocus，沿用最后一次的有效值，让流程仍能平滑收尾
    if (!t) return;
    this._vFocus.copy(this._focusLocal).applyMatrix4(t.matrixWorld);
  }

  /** 求出球坐标轨道上某个方位角对应的位姿（位置 + 看向聚焦点的朝向） */
  _poseAtAngle(theta, outPos, outQuat) {
    this._spherical.theta = theta;
    outPos.setFromSpherical(this._spherical).add(this._vFocus);
    this._mat4.lookAt(outPos, this._vFocus, UP);
    outQuat.setFromRotationMatrix(this._mat4);
  }

  /**
   * 按"峰值速度预算"自适应时长，只拉长不缩短。
   *
   * 推导：ease-in-out cubic（首尾各占一半的 ease）的峰值斜率是平均斜率的 **3 倍**
   * （f(t)=4t³ 在 t=0.5 处 f'=3），所以
   *   peakSpeed = 3 × distance / duration   ⇒   duration >= 3 × distance / budget
   * budget 的单位是"每秒多少个角色身高"，乘上身高换成世界单位。
   * 显式传 0（= 瞬间完成）时不做自适应，尊重调用方的"不要切入"意图。
   */
  _adaptDuration(nominal, distance, budgetInHeights, maxDuration) {
    const base = isNum(nominal) && nominal > 0 ? nominal : 0;
    if (base <= 0) return 0;

    const h = this._targetHeight > 1e-3 ? this._targetHeight : 1;
    const budgetUnits = (isNum(budgetInHeights) ? budgetInHeights : 0) * h;
    if (!(budgetUnits > 0) || !(distance > 1e-4)) return base;

    let dur = Math.max(base, (3 * distance) / budgetUnits);
    if (isNum(maxDuration) && maxDuration > 0) {
      dur = Math.min(dur, Math.max(base, maxDuration));
    }
    return dur;
  }

  /* ====================================================================== */
  /*  杂项                                                                  */
  /* ====================================================================== */

  /** 仅在 fov 真正变化时更新投影矩阵（updateProjectionMatrix 有成本） */
  _applyFov(v) {
    if (this._orbitFov === null || !this.camera) return;
    if (Math.abs(this.camera.fov - v) < 0.001) return;
    this.camera.fov = v;
    if (typeof this.camera.updateProjectionMatrix === 'function') {
      this.camera.updateProjectionMatrix();
    }
  }

  /** 输入锁的状态机：只在真正变化时回调，杜绝重复通知 */
  _setInputLocked(locked) {
    if (this._inputLocked === locked) return;
    this._inputLocked = locked;
    this._call('onInputLockChange', locked);
  }

  /** 固定参数个数的回调调用（不走 ...args，避免每帧 onProgress 产生垃圾） */
  _call(name, a, b) {
    const fn = this.options[name];
    if (typeof fn !== 'function') return;
    try {
      fn(a, b);
    } catch (err) {
      console.error(`[OrbitFanfareCamera] 回调 ${name} 内部抛出异常（已隔离，不影响相机）`, err);
    }
  }

  _attachSkipListeners() {
    if (!this.options.allowSkip) return;
    if (typeof window === 'undefined' || !window.addEventListener) return; // 非浏览器环境（如单测）

    window.addEventListener('keydown', this._onKeyDown, false);
    if (this.options.skipOnPointer) {
      // capture 阶段：即使游戏 UI 在冒泡阶段 stopPropagation 也能收到
      window.addEventListener('pointerdown', this._onPointerDown, true);
    }
    this._listening = true;
  }

  _detachSkipListeners() {
    if (!this._listening) return;
    window.removeEventListener('keydown', this._onKeyDown, false);
    window.removeEventListener('pointerdown', this._onPointerDown, true);
    this._listening = false;
  }

  _onKeyDown(ev) {
    if (!this.isPlaying) return;
    const keys = this.options.skipKeys || [];
    if (keys.indexOf(ev.code) !== -1 || keys.indexOf(ev.key) !== -1) {
      this.skip();
    }
  }

  _onPointerDown() {
    if (!this.isPlaying) return;
    this.skip();
  }
}
return OrbitFanfareCamera;
})();

// ---- 终点环绕过场：实例与状态 --------------------------------------
// 跟随相机的目标位姿（updateCamera 与终点过场共用）
const camPos = new THREE.Vector3(0, 4.3, 7.4), camLook = new THREE.Vector3(0, 1.3, -9);
// 抵达城市段终点前，相机绕角色转满 360°，把整条街的特色建筑看一遍，再进传送门。
// 相机位姿由 OrbitFanfareCamera 全权接管，所以过场期间必须停掉 updateCamera，
// 否则两边同时写 camera.position，画面会来回打架。
const FINISH = {
    active: false,
    camFar: 230,      // 平时的相机远平面，过场时临时拉远
    fogNear: 0,
    fogFar: 0,
    // 灯光快照：夜里城市是一道黑峡谷，远处地标只剩轮廓线，不补光根本"看不到建筑"
    hemiI: 0, sunI: 0, hemiCur: 0, sunCur: 0,
};

// 切出时交还的"理想跟随位姿"：直接用跟随相机自己的目标值，
// 这样过场结束的那一帧不会"啪"一下跳位
function finishReturnPose(outPos, outQuat) {
    outPos.copy(camPos);
    const m = new THREE.Matrix4().lookAt(camPos, camLook, camera.up);
    outQuat.setFromRotationMatrix(m);
}

const finishCam = new OrbitFanfareCamera(camera, {
    introDuration: 1.6,
    orbitDuration: 12.0,
    outroDuration: 1.4,
    // 轨道几何由 FINISH_VIEW.apply() 每局按玩家选的视角写进来，
    // 这里只是「还没 apply 过」时的兜底值（= 全景视角）
    orbitDistance: 65,
    orbitPitchDeg: 26,
    focusHeightRatio: 0.55,
    fov: 86,
    clockwise: true,
    allowSkip: true,
    skipKeys: ['Space', 'Escape', 'Enter'],
    skipOnPointer: true,
    getReturnPose: finishReturnPose,
    onStart() {
        FINISH.active = true;
        FINISH.camFar = camera.far;
        FINISH.fogNear = scene.fog ? scene.fog.near : 0;
        FINISH.fogFar = scene.fog ? scene.fog.far : 0;
        FINISH.hemiI = hemi ? hemi.intensity : 0;
        FINISH.sunI = sun ? sun.intensity : 0;
        FINISH.hemiCur = FINISH.hemiI;
        FINISH.sunCur = FINISH.sunI;
    },
    onComplete() { endFinishFanfare(); },
});

// ---- 终点镜头视角：把选择权交给玩家 ----
// 人物视角 = 街道内低空环绕（半径 10m，角色在画面中央，看得到街道尽头的新葡京）
// 全景视角 = 无人机升到 78m 再绕（高过全部街墙，六座地标 + 新葡京同框）
//
// 为什么全景视角要升这么高：城市是 22m 宽的峡谷，街墙 32~64m。
// 只要相机低于街墙顶，x=±12 那排楼就会把环上的地标全部挡住——
// 「所有特色建筑都看得到」在峡谷里只有两个解：相机高过街墙，或者把街墙拆了。
const FINISH_VIEW = {
    KEY: 'huyifan.finishView.v2',      // 换 key：预设含义变了，旧的选择不再沿用
    mode: 'drone',
    presets: {
        // gaze = 镜头取景点在角色脚底以上多少米。
        // 取景点抬高之后，相机可以「高但平视」：既高过街墙，又不会俯到只剩地面。
        character: { orbitDistance: 10, orbitPitchDeg: 10, fov: 80, gaze: 1.4 },
        drone: { orbitDistance: 65, orbitPitchDeg: 26, fov: 86, gaze: 68 },
    },
    load() {
        try {
            const v = localStorage.getItem(this.KEY);
            if (v && this.presets[v]) this.mode = v;
        } catch (e) { /* 隐私模式下 localStorage 会抛，忽略 */ }
    },
    set(mode) {
        if (!this.presets[mode]) return;
        this.mode = mode;
        try { localStorage.setItem(this.KEY, mode); } catch (e) { }
        this.apply();
        if (typeof refreshFinishViewUI === 'function') refreshFinishViewUI();
    },
    cur() { return this.presets[this.mode] || this.presets.drone; },
    // 只覆盖这三项，其它选项（时长/补光/回调）保持不动
    apply() {
        const p = this.cur();
        finishCam.options.orbitDistance = p.orbitDistance;
        finishCam.options.orbitPitchDeg = p.orbitPitchDeg;
        finishCam.options.fov = p.fov;
    },
};
FINISH_VIEW.load();
FINISH_VIEW.apply();

// 过场镜头「看向哪里」的取景点。
// 直接 play(player.root) 只能围着角色胸口转，镜头被角色压得很低；
// 换成一个空 Object3D 当取景点，就能把视线抬到角色头顶以上若干米，
// 相机于是可以「站得高、看得平」，街道尽头的地标才进得了画。
const FINISH_GAZE = new THREE.Object3D();
FINISH_GAZE.position.set(0, 1.4, 0);
scene.add(FINISH_GAZE);

function startFinishFanfare() {
    if (!player || !player.root || FINISH.active) return false;
    S.state = 'fanfare';
    FINISH_VIEW.apply();
    // 过场期间世界是冻住的（updatePlaying 不再推进），取景点摆一次就够
    const p = FINISH_VIEW.cur();
    FINISH_GAZE.position.set(
        player.root.position.x,
        player.root.position.y + p.gaze,
        player.root.position.z
    );
    // 先把相机拉到理想跟随位姿再切入：updateCamera 有阻尼，
    // 直接拿滞后位置当起点会让切入多甩一下
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    return finishCam.play(FINISH_GAZE);
}

function endFinishFanfare() {
    FINISH.active = false;
    if (scene.fog) { scene.fog.near = FINISH.fogNear; scene.fog.far = FINISH.fogFar; }
    if (hemi) hemi.intensity = FINISH.hemiI;
    if (sun) sun.intensity = FINISH.sunI;
    camera.far = FINISH.camFar;
    camera.updateProjectionMatrix();
    if (S.state !== 'fanfare') return;      // 过场中被重开 / 换场：只还原相机，不再触发传送门
    S.state = 'playing';
    Scene.fanfareDone = true;
    if (PortalFX.group) beginPortal();
    else { Scene.phase = 'fadeOut'; Scene.t = 0; setFade(1, 0.45); }
}

// 过场期间把雾和远平面一起拉开：平时 fog far 只有 100 / 76 / 62，
// 几十米外的特色建筑全被雾吃掉，"所有建筑都看得到"根本无从谈起。
// 这是谢幕镜头，允许把整条街露出来；结束时写回原值。
function applyFinishFog(dt) {
    // 雾必须拉到很远：环上的地标离镜头 150~250m，按平时的 far=100 全部糊成一片。
    // 90 / 620 是「清澈的夜」——地标还剩 1/4 左右的雾，既有纵深又看得清体块。
    FINISH.fogNear = damp(FINISH.fogNear, 90, 2.5, dt);
    FINISH.fogFar = damp(FINISH.fogFar, 620, 2.0, dt);
    if (scene.fog) { scene.fog.near = FINISH.fogNear; scene.fog.far = FINISH.fogFar; }
    // 雾拉到 620 还不够：相机 far 只有 230，几何在 230 就被裁掉了
    if (Math.abs(camera.far - 620) > 1) {
        camera.far = damp(camera.far, 620, 2.0, dt);
        camera.updateProjectionMatrix();
    }
    // 补一层"蓝调时刻"的环境光：夜里地标只是些黑剪影，不补光等于没看到。
    // 必须用自己的累加器——ATMO 每帧都会按当前时段把 hemi/sun 写回去，
    // 直接 damp(hemi.intensity, ...) 会永远从原值出发、根本涨不上去。
    // 补光要够猛：环上的地标是 90m 的剪影，夜里只靠自发光会糊成一团黑。
    // 1.25 / 0.55 是原来「街道峡谷」那一版的量级；改成俯瞰机位之后，
    // 整片楼群都在画面里，需要更高一档才看得出体块关系。
    FINISH.hemiCur = damp(FINISH.hemiCur, Math.max(FINISH.hemiI, 1.75), 2.2, dt);
    FINISH.sunCur = damp(FINISH.sunCur, Math.max(FINISH.sunI, 0.85), 2.2, dt);
    if (hemi) hemi.intensity = FINISH.hemiCur;
    if (sun) sun.intensity = FINISH.sunCur;
}
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
function updateCamera(dt) {
    if (window.__freezeCam) { camera.updateProjectionMatrix(); return; }   // 截图/调试用：锁死机位
    const flying = !!(S.flight && S.flight.active);
    const k = 1 - Math.exp(-dt * (flying ? 5 : 7));
    const x = S.x || 0, y = S.y || 0;
    // 注意：两个目标必须用不同的临时向量，否则后者会覆盖前者（相机就会往视线目标漂移）
    let targetFov;
    if (flying) {
        camPos.lerp(tmpV.set(x * 0.7, y + 2.1, 8.8), k);
        camLook.lerp(tmpV2.set(x * 0.5, y + 1.0, -9), k);
        targetFov = (camera.aspect < 1 ? 78 : 62) + 4;
    } else {
        // 保安追击时相机后移升高、视线下移：贴身追击时保安会顶到屏幕底边/角落被裁，
        // 拉远升高后玩家和保安都完整入画（带一点"危险拉近"的镜头感）
        const chasing = S.chaserTimer > 0;
        camPos.lerp(tmpV.set(x * 0.7, (chasing ? 4.6 : 4.3) + y * 0.75, chasing ? 8.2 : 7.4), k);
        camLook.lerp(tmpV2.set(x * 0.5, (chasing ? 1.05 : 1.3) + y * 0.6, -9), k);
        targetFov = camera.aspect < 1 ? 78 : 62;
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    // FOV 只在真正变化时重算投影矩阵（静止时省掉每帧的矩阵重建）
    const nextFov = damp(camera.fov, targetFov, 4, dt);
    if (Math.abs(nextFov - camera.fov) > 0.02) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
    }
}

// =====================================================================
//  ⑭ 操作
// =====================================================================
function moveLane(d) {
    const nl = clamp(S.lane + d, 0, 2);
    if (nl === S.lane) return;
    if (campusLaneBlockedSoon(nl)) return;   // 前方有楼横在这条道上：别把人推进墙里
    S.prevLane = S.lane;
    S.lane = nl;
}
function jump() {
    if (S.flying || S.anticip > 0) return;
    if (!S.grounded) {
        // 校园·二段跳：空中再按一次跳，较小冲量（每个腾空周期至多一次）
        if (tryAirJump(S, Scene.id, CONFIG.jump.velocity)) SFX.jump();
        return;
    }
    // 先下蹲蓄力（预备动作），计时结束后由 applyJumpImpulse 真正起跳
    S.anticip = ANIM_CFG.jumpAnticip;
    SFX.jump();
}
/** 蓄力结束、真正离地 */
function applyJumpImpulse() {
    S.vy = S.power.sneakers > 0 ? CONFIG.jump.superVelocity : CONFIG.jump.velocity;
    S.grounded = false;
    S.rolling = 0;
}
function roll() {
    if (S.rolling > 0 || S.flying) return;
    if (!S.grounded) S.vy = -22;   // 空中按下：快速落地并翻滚
    S.rolling = ROLL_TIME;
    SFX.roll();
}

addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    // [PKVS] 联机大厅开着时键盘归输入框（昵称 / 信令码），别触发起跑跳跃
    if (typeof window.__pkInputLock === 'function' && window.__pkInputLock()) return;
    // 音量面板打开时：Esc 关闭、M 静音，其余按键不进游戏
    if (!$('volume').classList.contains('hidden')) {
        if (k === 'escape' || k === 'enter') { e.preventDefault(); closeVolume(); }
        else if (k === 'm') { e.preventDefault(); toggleMute(); }
        return;
    }
    // 升级面板打开时：Esc/Enter 关闭面板，其余按键不进游戏（避免误开局/误暂停）
    if (!$('upgrades').classList.contains('hidden')) {
        if (k === 'escape' || k === 'enter') { e.preventDefault(); closeUpgrades(); }
        return;
    }
    // M 键：任何界面都能切换静音
    if (k === 'm') { e.preventDefault(); toggleMute(); return; }
    // 飞行器的上下控制需要感知“按住”
    if (k === 'arrowup' || k === 'w' || k === ' ') S.holdUp = true;
    if (k === 'arrowdown' || k === 's') S.holdDown = true;
    if (S.state === 'menu' || (S.state === 'over' && S.overShown)) {
        if (k === 'enter' || k === ' ') { e.preventDefault(); startGame(); }
        return;
    }
    if (k === 'p' || k === 'escape') { togglePause(); return; }
    if (S.state !== 'playing' || S.paused || e.repeat) return;
    // [PKVS] 反向符：被丢中时左右互换
    if (k === 'arrowleft' || k === 'a') { const d = -1 * (typeof window.__pkInputFlip === 'function' ? window.__pkInputFlip() : 1); moveLane(d); campusNoteInput(d); }
    else if (k === 'arrowright' || k === 'd') { const d = 1 * (typeof window.__pkInputFlip === 'function' ? window.__pkInputFlip() : 1); moveLane(d); campusNoteInput(d); }
    else if (k === 'arrowup' || k === 'w' || k === ' ') jump();
    else if (k === 'arrowdown' || k === 's') roll();
    else return;
    e.preventDefault();
});
addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w' || k === ' ') S.holdUp = false;
    if (k === 'arrowdown' || k === 's') S.holdDown = false;
});

let touchStart = null;
addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });
addEventListener('touchend', e => {
    if (!touchStart || S.state !== 'playing' || S.paused) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
    if (Math.abs(dx) > Math.abs(dy)) { const d = (dx > 0 ? 1 : -1) * (typeof window.__pkInputFlip === 'function' ? window.__pkInputFlip() : 1); moveLane(d); campusNoteInput(d); }
    else if (dy < 0) { if (S.flying) S.climbPulse = 0.6; else jump(); }
    else roll();
}, { passive: true });

// =====================================================================
//  ⑮ 界面
// =====================================================================
let msgTimer = 0;
function showMsg(text) {
    const el = $('msg');
    el.textContent = text;
    el.style.opacity = 1;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => (el.style.opacity = 0), 1400);
}

function startGame() {
    initAudio();
    startBgm();                     // 背景音乐：随开局启动循环
    resetState();
    SFX.guard();
    resetScene();
    S.state = 'playing';
    S.paused = false;
    for (const id of ['menu', 'over', 'pause']) $(id).classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('pauseBtn').classList.remove('hidden');
}

function togglePause() {
    if (S.state !== 'playing') return;
    // [PKVS] 对战中不许暂停：单方面停表，对手还在跑
    if (window.__PKVS_APP && window.__PKVS_APP.active) return;
    S.paused = !S.paused;
    if (S.paused) stopBgm(); else startBgm();   // 暂停时背景音乐一起停
    $('pause').classList.toggle('hidden', !S.paused);
}

function showGameOver() {
    S.overShown = true;
    S.state = 'over';
    stopBgm();                       // 结算时停背景音乐
    const newBest = S.score > best;
    if (newBest) {
        best = S.score;
        try { localStorage.setItem('parkour3d_best', best); } catch (e) {}
    }
    SAVE.bank += S.coins;             // 本局金币入库
    persistSave();
    $('overScore').textContent = S.score;
    $('overCoins').textContent = S.coins;
    $('overDist').textContent = Math.floor(S.D);
    $('overBest').textContent = newBest ? '🎉 新纪录！' : '最高分 ' + best;
    $('overBank').innerHTML = `本局金币已入库！金库总计 🪙 <b>${fmtCoin(SAVE.bank)}</b>`;
    $('overRevive').textContent = S.reviveUsed > 0 ? `💖 复活币救场 ×${S.reviveUsed}` : '';
    $('over').classList.remove('hidden');
    $('pauseBtn').classList.add('hidden');
}

let hudTimer = 0;
const hudCache = { score: -1, coins: -1, best: -1, dist: -1, revives: -1, powerSig: '', bars: {} };
function updateHud(dt) {
    hudTimer -= dt;
    if (hudTimer > 0) return;
    hudTimer = 0.1;
    // 只在数值变化时写 DOM：避免每 100ms 触发一次样式重算
    if (S.score !== hudCache.score) { $('hudScore').textContent = S.score; hudCache.score = S.score; }
    if (S.coins !== hudCache.coins) { $('hudCoins').textContent = S.coins; hudCache.coins = S.coins; }
    const bestShown = Math.max(best, S.score);
    if (bestShown !== hudCache.best) { $('hudBest').textContent = bestShown; hudCache.best = bestShown; }
    const dist = Math.floor(S.D);
    if (dist !== hudCache.dist) { $('hudDist').textContent = dist + ' m'; hudCache.dist = dist; }
    if (S.revives !== hudCache.revives) {
        $('hudRevive').textContent = S.revives;
        $('reviveBox').classList.toggle('hidden', S.revives <= 0);
        hudCache.revives = S.revives;
    }

    // 道具列表：结构只在「哪些道具在生效」变化时重建，进度条只改宽度
    const active = [];
    for (const k in CONFIG.powerUps) if (S.power[k] > 0) active.push(k);
    const sig = active.join(',');
    if (sig !== hudCache.powerSig) {
        $('powers').innerHTML = active.map(k => {
            const def = CONFIG.powerUps[k];
            return `<div class="pw" data-k="${k}">${def.icon} ${def.name}<div class="bar"><i style="width:0%"></i></div></div>`;
        }).join('');
        hudCache.powerSig = sig;
        hudCache.bars = {};
        for (const k of active) hudCache.bars[k] = document.querySelector(`#powers .pw[data-k="${k}"] i`);
    }
    for (const k of active) {
        const bar = hudCache.bars[k];
        if (!bar) continue;
        const pct = clamp((S.power[k] / powerDur(k)) * 100, 0, 100);
        const w = pct.toFixed(0) + '%';
        if (bar.style.width !== w) bar.style.width = w;
    }
}

$('startBtn').onclick = startGame;
$('restartBtn').onclick = startGame;
$('resumeBtn').onclick = togglePause;
$('pauseBtn').onclick = togglePause;

// ---------- 道具升级面板 ----------
let upOpenedFrom = 'menu';

function refreshCoinLabels() {
    $('menuBank').textContent = SAVE.bank > 0 ? '🪙 金库 ' + fmtCoin(SAVE.bank) : '';
}

function renderUpgrades() {
    let html = '';
    for (const type in CONFIG.powerUps) {
        const def = CONFIG.powerUps[type];
        const lv = SAVE.up[type] || 0;
        const maxed = lv >= UPGRADE_CFG.maxLevel;
        const cost = upCost(lv);
        const afford = SAVE.bank >= cost;
        const col = '#' + def.color.toString(16).padStart(6, '0');
        const pips = Array.from({ length: UPGRADE_CFG.maxLevel }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
        const dur = `<span>${powerDur(type)}s</span>${maxed ? '' : ` <b class="upGain">→ ${powerDur(type) + 1}s</b>`}`;
        html += `
        <div class="upCard" id="upc-${type}">
            <div class="upIcon" style="background:radial-gradient(circle at 32% 28%, ${col}dd, ${col}77 58%, rgba(255,255,255,.08))">${def.icon}</div>
            <div class="upInfo">
                <div class="upName">${def.name}<span class="upLv">Lv ${lv}</span></div>
                <div class="upDur">${dur}</div>
                <div class="upPips">${pips}</div>
            </div>
            ${maxed
                ? '<button class="upBuy maxed" disabled>MAX</button>'
                : `<button class="upBuy${afford ? '' : ' poor'}" data-type="${type}">🪙 ${fmtCoin(cost)}</button>`}
        </div>`;
    }
    $('upCards').innerHTML = html;
    $('upBank').textContent = '🪙 ' + fmtCoin(SAVE.bank);
}

function openUpgrades(from) {
    upOpenedFrom = from;
    renderUpgrades();
    $(from === 'over' ? 'over' : 'menu').classList.add('hidden');
    $('upgrades').classList.remove('hidden');
    const panel = $('upPanel');
    panel.classList.remove('pop'); void panel.offsetWidth; panel.classList.add('pop');
}

function closeUpgrades() {
    $('upgrades').classList.add('hidden');
    $(upOpenedFrom === 'over' ? 'over' : 'menu').classList.remove('hidden');
    refreshCoinLabels();
}

$('upCards').addEventListener('click', e => {
    const btn = e.target.closest('.upBuy');
    if (!btn || btn.disabled) return;
    const type = btn.dataset.type;
    const res = tryBuyUpgrade(type);
    if (res === 'ok') {
        SFX.power();
        renderUpgrades();
        const card = $('upc-' + type);
        if (card) { card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
    } else if (res === 'poor') {
        SFX.stumble();
        btn.classList.remove('shake'); void btn.offsetWidth; btn.classList.add('shake');
    }
});
$('upOpenBtn').onclick = () => openUpgrades('menu');
$('upOpenBtn2').onclick = () => openUpgrades('over');
$('upBack').onclick = closeUpgrades;
refreshCoinLabels();

// ---------- 音量面板 ----------
const VOL_SLIDERS = [
    { ch: 'master', slider: 'volMaster', label: 'volMasterVal' },
    { ch: 'sfx', slider: 'volSfx', label: 'volSfxVal' },
    { ch: 'laugh', slider: 'volLaugh', label: 'volLaughVal' },
    { ch: 'music', slider: 'volMusic', label: 'volMusicVal' },
];

function refreshVolumeUI() {
    for (const { ch, slider, label } of VOL_SLIDERS) {
        const pct = Math.round(AUDIO[ch] * 100);
        $(slider).value = pct;
        $(slider).disabled = AUDIO.muted;
        $(label).textContent = AUDIO.muted ? '静音' : pct + '%';
    }
    const btn = $('volMute');
    btn.textContent = AUDIO.muted ? '🔊 取消静音' : '🔇 静音';
    btn.classList.toggle('on', !!AUDIO.muted);
    $('volBtn').textContent = AUDIO.muted ? '🔇' : (AUDIO.master < 0.02 ? '🔈' : '🔊');
    $('volBtn').classList.toggle('muted', !!AUDIO.muted);
}

function openVolume() {
    initAudio();                    // 用户点击即手势，可以创建/恢复 AudioContext
    refreshVolumeUI();
    $('volume').classList.remove('hidden');
    const panel = $('volPanel');
    panel.classList.remove('pop'); void panel.offsetWidth; panel.classList.add('pop');
}
function closeVolume() {
    $('volume').classList.add('hidden');
    persistAudio();
}

for (const { ch, slider, label } of VOL_SLIDERS) {
    const el = $(slider);
    el.addEventListener('input', () => {
        if (AUDIO.muted) return;
        AUDIO[ch] = clamp(+el.value / 100, 0, 1);
        $(label).textContent = Math.round(AUDIO[ch] * 100) + '%';
        applyAudioLevels();
        persistAudio();
        refreshVolumeUI();          // 同步 🌊 图标
    });
    // 松手时给一次该通道的试听，方便调音
    el.addEventListener('change', () => {
        if (AUDIO.muted) return;
        if (ch === 'sfx') { initAudio(); SFX.coin(); }
        else if (ch === 'laugh') { initAudio(); SFX.guard(); }
        else if (ch === 'music') { initAudio(); startBgm(); }
    });
}

function refreshQualityUI() {
    const row = $('qRow');
    if (!row) return;
    for (const b of row.querySelectorAll('.qBtn')) b.classList.toggle('on', b.dataset.q === QUALITY.tier);
    const tip = $('qTip');
    if (tip) {
        tip.textContent = QP().shadow
            ? '当前：' + QP().label + '档 · 启用实时阴影（更吃性能）'
            : '当前：' + QP().label + '档 · 已关实时阴影，改用脚下投影贴片';
    }
}
for (const b of document.querySelectorAll('#qRow .qBtn')) {
    b.onclick = () => { setQuality(b.dataset.q); initAudio(); SFX.coin(); };
}
refreshQualityUI();

function refreshFinishViewUI() {
    const row = $('fvRow');
    if (!row) return;
    for (const b of row.querySelectorAll('.qBtn')) b.classList.toggle('on', b.dataset.fv === FINISH_VIEW.mode);
    const tip = $('fvTip');
    if (tip) {
        tip.textContent = FINISH_VIEW.mode === 'drone'
            ? '当前：全景视角 · 相机升到 100m 环绕，六座地标与新葡京同框'
            : '当前：人物视角 · 相机贴着街道环绕，角色在画面中央';
    }
}
for (const b of document.querySelectorAll('#fvRow .qBtn')) {
    b.onclick = () => { FINISH_VIEW.set(b.dataset.fv); initAudio(); SFX.coin(); };
}
refreshFinishViewUI();

$('volBtn').onclick = openVolume;
$('volBack').onclick = closeVolume;
$('volMute').onclick = () => {
    AUDIO.muted = !AUDIO.muted;
    applyAudioLevels();
    persistAudio();
    refreshVolumeUI();
};
/** M 键：全局静音开关（面板关闭时也生效） */
function toggleMute() {
    AUDIO.muted = !AUDIO.muted;
    initAudio();
    applyAudioLevels();
    persistAudio();
    refreshVolumeUI();
    showMsg(AUDIO.muted ? '🔇 已静音' : '🔊 已恢复声音');
}
refreshVolumeUI();
document.addEventListener('visibilitychange', () => { if (document.hidden && S.state === 'playing' && !S.paused) togglePause(); });

document.title = CONFIG.title + ' 3D';
$('title').textContent = CONFIG.title;
$('subtitle').textContent = `操控「${CONFIG.player.name}」，别被「${CONFIG.chaser.name}」抓住！`;
$('menuBest').textContent = best ? '最高分 ' + best : '';
await chaserLoadPromise;   // 等保安模型就位再进菜单，开局和玩家一起出现
$('loading').classList.add('hidden');
$('menu').classList.remove('hidden');

// =====================================================================
//  ⑯ 浏览器内自检（?selftest 或控制台 __game.selfTest()）
// =====================================================================
function selfTest() {
    const results = [];
    const ok = (name, cond, info) => results.push({ name, pass: !!cond, info: info == null ? '' : String(info) });
    const prevState = S.state;
    S.paused = false;

    // ① 起跳：预备动作 → 离地 → 落地缓冲
    resetState(); S.state = 'playing';
    jump();
    ok('跳跃有预备下蹲(anticip)', S.anticip > 0 && S.grounded, 'anticip=' + S.anticip.toFixed(2));
    for (let i = 0; i < 12; i++) updatePlaying(1 / 60);
    ok('预备结束后离地', !S.grounded && S.vy > 0, 'vy=' + S.vy.toFixed(2));
    let frames = 0;
    while (!S.grounded && frames < 240) { updatePlaying(1 / 60); frames++; }
    ok('能正常落地', S.grounded, frames + ' 帧');
    ok('落地触发缓冲', ANIM.land > 0, 'land=' + ANIM.land.toFixed(2));

    // ② 翻滚：贴地 + 转满一圈 + 结束回到跑动
    resetState(); S.state = 'playing';
    roll();
    let minPivotY = 9, minRot = 0;
    for (let i = 0; i < Math.ceil(ROLL_TIME * 60) + 4; i++) {
        updatePlaying(1 / 60);
        minPivotY = Math.min(minPivotY, player.pivot.position.y);
        minRot = Math.min(minRot, player.pivot.rotation.x);
    }
    ok('翻滚贴地(旋转中心下移)', minPivotY < 0.75, minPivotY.toFixed(2));
    ok('翻滚转满一圈', Math.abs(minRot) > Math.PI * 1.8, minRot.toFixed(2));
    ok('翻滚结束回到跑姿', Math.abs(player.pivot.rotation.x) < 0.01, player.pivot.rotation.x.toFixed(3));

    // ③ 飞行器全流程：起飞 → 巡航 → 降落 → 落地 → 收翼
    resetState(); S.state = 'playing';
    startFlight();
    ok('飞行器进入起飞', S.flight.phase === 'takeoff', S.flight.phase);
    let cruised = false, descended = false, maxY = 0, n = 0;
    for (; n < 60 * 20; n++) {
        if (S.state !== 'playing') break;
        updatePlaying(1 / 60);
        if (S.flight.phase === 'cruise') cruised = true;
        if (S.flight.phase === 'descent') descended = true;
        maxY = Math.max(maxY, S.y);
        if (S.flight.phase === 'idle') break;
    }
    ok('飞到巡航高度', maxY > CONFIG.flight.cruiseY - 0.6, 'maxY=' + maxY.toFixed(2));
    ok('经历 巡航→降落', cruised && descended, 'cruise=' + cruised + ' descent=' + descended);
    // 落地判定不能写死 y < 0.2：城市 / 隧道地图里可以正好落在车顶（h1 约 1.5~3.3m）上，
    // 只要停在「当前支撑面高度」上就算落地成功（否则每 5 次自检就有 1 次假红灯）。
    // 注意别加 !S.flying —— phase 转 idle 的那一帧 S.flying 还是上一帧留下的 true。
    const gy = surfaceAt(S.x, S.y);
    ok('飞行结束回到地面', S.flight.phase === 'idle' && S.y <= gy + 0.05,
        'phase=' + S.flight.phase + ' y=' + S.y.toFixed(2) + ' 支撑面=' + gy.toFixed(2));
    ok('落地后收翼', wingGrow < 0.2, 'wingGrow=' + wingGrow.toFixed(2));
    ok('飞行时长合理', n / 60 > 3 && n / 60 < powerDur('wings') + 7, (n / 60).toFixed(1) + 's / 上限 ' + (powerDur('wings') + 7).toFixed(0) + 's');

    // ④ 关节数值健康（GLB 模型没有 hair 关节，跳过）
    const rigs = ['pivot', 'body', 'torso', 'head', 'hair', 'legL', 'kneeL', 'legR', 'kneeR', 'armL', 'elbowL', 'armR', 'elbowR']
        .filter(k => !(player.isModel && k === 'hair'));
    const badJoints = [];
    for (const key of rigs) {
        const j = player[key];
        if (!j) { badJoints.push(key + ':missing'); continue; }
        for (const ax of ['x', 'y', 'z']) {
            if (!isFinite(j.rotation[ax])) badJoints.push(key + '.rot' + ax);
            if (!isFinite(j.position[ax])) badJoints.push(key + '.pos' + ax);
        }
    }
    ok('关节数值无 NaN', badJoints.length === 0, badJoints.join(','));

    // ⑤ 角色模型部件：代码拼装角色查命名部件；GLB 模型查骨骼接口
    if (!player.isModel) {
        const names = new Set();
        player.root.traverse(o => { if (o.name) names.add(o.name); });
        for (const part of ['eyeWhite', 'pupil', 'brow', 'mouth', 'blush', 'glassesUp', 'lens', 'hood', 'zipper', 'boot', 'sole', 'hairBack']) {
            ok('角色部件存在：' + part, names.has(part));
        }
    } else {
        ok('GLB 角色骨骼接口完整', ['torso', 'head', 'legL', 'kneeL', 'legR', 'kneeR', 'armL', 'elbowL', 'armR', 'elbowR']
            .every(k => player[k] && isFinite(player[k].rotation.x)), player.usedUrl || 'model');
    }
    ok('角色动画状态在推进', isFinite(ANIM.k) && ANIM.k > 0 && ANIM.k <= 1, 'k=' + ANIM.k.toFixed(3));

    // ⑥ 场景系统：数据完整性 / 段长 / 二段跳 / 主题切换
    const badScene = validateSceneData(OBSTACLE_DEFS, SCENE_OBSTACLES);
    ok('场景障碍数据完整(ride+jump+duck)', badScene === null, badScene || 'ok');
    ok('四场景段长与注册表一致且合法', ['lakeside', 'tunnel', 'city', 'campus'].every(id =>
        THEMES[id] && THEMES[id].segLen === SCENE_SEG_LEN[id] && SCENE_SEG_LEN[id][0] > 50 && SCENE_SEG_LEN[id][0] <= SCENE_SEG_LEN[id][1]));

    // 校园·二段跳：离地后再跳一次，落地清零
    resetState(); window.__forceTheme('campus'); S.state = 'playing';
    jump();
    for (let i = 0; i < 20; i++) updatePlaying(1 / 60);   // 蓄力 5 帧 + 等 vy 衰减到 35% 以下（约需 14 帧空中时间）
    ok('校园场景已激活', Scene.id === 'campus', Scene.id);
    const vyBefore = S.vy;
    jump();
    ok('校园二段跳触发', S.airJumps === 1 && S.vy > vyBefore, 'vy=' + S.vy.toFixed(2));
    const vyAfter = S.vy;
    jump();
    ok('二段跳每个腾空周期仅一次', S.airJumps === 1 && S.vy === vyAfter);
    frames = 0;
    while (!S.grounded && frames < 300) { updatePlaying(1 / 60); frames++; }
    ok('落地后二段跳计数清零', S.grounded && S.airJumps === 0, 'airJumps=' + S.airJumps);

    // 非校园场景没有二段跳
    resetState(); window.__forceTheme('lakeside'); S.state = 'playing';
    jump();
    for (let i = 0; i < 12; i++) updatePlaying(1 / 60);
    jump();
    ok('湖畔场景无二段跳', S.airJumps === 0, 'airJumps=' + S.airJumps);

    // 场景切换：世界重建 + 障碍缓冲
    window.__forceTheme('city');
    ok('强制切场景生效', Scene.id === 'city' && curTheme === 'city', Scene.id);
    ok('切场景后有 70m 无障碍缓冲', S.nextRowS >= S.D + 69, 'nextRowS-D=' + (S.nextRowS - S.D).toFixed(1));

    // ⑦ 升级系统：价格公式 / 时长公式 / 满级与余额防护（不落盘，测完还原）
    ok('升级价格公式 500·2^lv', [0, 1, 2, 3].every(lv => upCost(lv) === 500 * 2 ** lv) && upCost(9) === 256000, 'lv9→' + upCost(9));
    const _saveBak = JSON.parse(JSON.stringify(SAVE));
    SAVE.up = {}; SAVE.bank = 1500;
    ok('时长 = 基础 + 等级×1s', powerDur('magnet') === CONFIG.powerUps.magnet.duration);
    SAVE.up.magnet = 3;
    ok('升级后时长随等级增长', powerDur('magnet') === CONFIG.powerUps.magnet.duration + 3, powerDur('magnet') + 's');
    SAVE.bank = 5000;                                   // Lv3→Lv4 需 4000
    ok('买得起时扣款并升级', tryBuyUpgrade('magnet') === 'ok' && SAVE.up.magnet === 4 && SAVE.bank === 1000, 'bank=' + SAVE.bank);
    SAVE.bank = 10;
    ok('金币不足拒绝购买', tryBuyUpgrade('magnet') === 'poor' && SAVE.up.magnet === 4 && SAVE.bank === 10);
    SAVE.up.magnet = UPGRADE_CFG.maxLevel;
    ok('满级拒绝继续升', tryBuyUpgrade('magnet') === 'max' && SAVE.up.magnet === UPGRADE_CFG.maxLevel, 'Lv' + SAVE.up.magnet);
    ok('满级时长封顶 +10s', powerDur('magnet') === CONFIG.powerUps.magnet.duration + UPGRADE_CFG.maxLevel, powerDur('magnet') + 's');
    SAVE.bank = _saveBak.bank; SAVE.up = _saveBak.up;

    // ⑧ 行驶障碍：迎面开来、撞上即失败、护盾规则（Lv<5 无效 / Lv≥5 挡一次）
    const _saveBak2 = JSON.parse(JSON.stringify(SAVE));
    // 转场无敌期(1.2s=72帧)比碰撞窗口(约34帧)还长，会让迎面车直接穿过玩家；测试要显式清掉
    const setupMoving = (shieldLv, shieldDur) => {
        resetState(); window.__forceTheme('city'); S.state = 'playing';
        S.transGrace = 0;
        S.nextRowS = S.D + 1e6;                       // 关掉自动生成，只保留手动放置的这一辆
        SAVE.up.shield = shieldLv;
        S.power.shield = shieldDur;
        placeMoving(1, 10);
    };
    const runUntilDying = (maxFrames = 300) => {
        let died = false;
        for (let i = 0; i < maxFrames && !died; i++) { updatePlaying(1 / 60); died = S.state === 'dying'; }
        return died;
    };
    setupMoving(0, 0);
    const mv = obstacles.find(o => o.moving);
    ok('城市场景生成行驶障碍(小汽车)', !!mv && mv.type === 'car', mv ? 'extra=' + mv.extra.toFixed(1) : 'missing');
    ok('行驶障碍会朝主角移动', mv.z < 0 && mv.extra > 0, 'z=' + mv.z.toFixed(1));
    ok('被行驶小汽车撞上直接失败', runUntilDying());
    setupMoving(4, 10);                              // 护盾开着但不足 5 级
    ok('护盾不足5级挡不住行驶障碍', runUntilDying());
    setupMoving(MOVING_SHIELD_LV, 10);
    let blocked = false;
    for (let i = 0; i < 300 && !blocked; i++) {
        updatePlaying(1 / 60);
        blocked = S.state === 'playing' && S.power.shield === 0 && !obstacles.some(o => o.moving);
    }
    ok('护盾Lv5可挡一次行驶撞击', blocked, 'state=' + S.state + ' shield=' + S.power.shield.toFixed(1));
    SAVE.bank = _saveBak2.bank; SAVE.up = _saveBak2.up;

    // ⑨ 音量：四通道换算 + 笑声/音乐独立 + 静音归零 + 面板滑块同步
    const _audioBak = JSON.parse(JSON.stringify(AUDIO));
    Object.assign(AUDIO, { master: 0.8, sfx: 0.5, laugh: 0.6, music: 0.4, muted: false });
    ok('音量：音效 = 总音量×音效', Math.abs(audioChannelGain(AUDIO, 'sfx') - 0.4) < 1e-9, audioChannelGain(AUDIO, 'sfx').toFixed(2));
    ok('音量：保安笑声与背景音乐各自独立',
        Math.abs(audioChannelGain(AUDIO, 'laugh') - 0.48) < 1e-9 && Math.abs(audioChannelGain(AUDIO, 'music') - 0.32) < 1e-9,
        'laugh=' + audioChannelGain(AUDIO, 'laugh').toFixed(2) + ' music=' + audioChannelGain(AUDIO, 'music').toFixed(2));
    AUDIO.laugh = 0;
    ok('音量：关掉笑声不影响背景音乐', audioChannelGain(AUDIO, 'laugh') === 0 && audioChannelGain(AUDIO, 'music') > 0);
    AUDIO.laugh = 0.6; AUDIO.muted = true;
    ok('音量：静音时所有通道归零', ['master', 'sfx', 'laugh', 'music'].every(ch => audioChannelGain(AUDIO, ch) === 0));
    AUDIO.muted = false;
    AUDIO.master = 0.5;
    ok('音量：总音量同时作用于笑声与音乐',
        Math.abs(audioChannelGain(AUDIO, 'laugh') - 0.3) < 1e-9 && Math.abs(audioChannelGain(AUDIO, 'music') - 0.2) < 1e-9);
    refreshVolumeUI();
    ok('音量：面板滑块与设置同步', +$('volLaugh').value === 60 && +$('volMaster').value === 50,
        'laugh=' + $('volLaugh').value + ' master=' + $('volMaster').value);
    Object.assign(AUDIO, _audioBak);
    refreshVolumeUI();

    // ⑮ 画质档位：减配必须真的落到渲染器上，不能只是改了个变量
    {
        const bak = QUALITY.tier;
        S.state = 'playing';
        const P = QUALITY_PRESETS;
        ok('画质：三档参数逐级收紧',
            P.high.pr > P.mid.pr && P.mid.pr >= P.low.pr &&
            P.high.shadowSize > P.mid.shadowSize &&
            P.high.pointLights >= P.mid.pointLights && P.mid.pointLights >= P.low.pointLights &&
            P.high.shadow === true && P.mid.shadow === false && P.low.shadow === false,
            'pixelRatio ' + P.high.pr + '/' + P.mid.pr + '/' + P.low.pr +
            ' · 阴影 ' + P.high.shadowSize + '/' + P.mid.shadowSize + '/关');

        // 手机档的分辨率地板：minPR=1 保证 1 CSS 像素 = 1 渲染像素。
        // 这是「画面很糊」的根治点——自适应再怎么降，也不会把分辨率降到 1 以下。
        ok('画质：手机档有分辨率地板（minPR=1）',
            P.mid.minPR === 1 && P.low.minPR === 1 &&
            P.mid.minScale === 1 && P.low.minScale === 1 && !P.high.minPR,
            'minPR ' + P.high.minPR + '/' + P.mid.minPR + '/' + P.low.minPR);

        // 降级阶梯：手机档必须「先砍特性」，不许在阶梯里动分辨率（只有高档末级才允许）
        ok('画质：降级阶梯先砍特性、后砍分辨率',
            (P.mid.steps || []).length >= 2 &&
            (P.mid.steps || []).every(s => s.scale == null) &&
            (P.high.steps || []).slice(-1)[0].scale != null,
            'mid 阶梯 ' + (P.mid.steps || []).length + ' 级 · high 末级含 scale');

        setQuality('low');
        updateBlobShadow();
        ok('画质：低档真的关掉了实时阴影',
            renderer.shadowMap.enabled === false && sun.castShadow === false,
            'shadowMap=' + renderer.shadowMap.enabled + ' sun.castShadow=' + sun.castShadow);
        ok('画质：低档改用脚下投影贴片',
            !!BlobShadow.mesh && BlobShadow.mesh.visible === true,
            'blob=' + (BlobShadow.mesh ? BlobShadow.mesh.visible : 'null'));

        setQuality('mid');
        const want = Math.max(P.mid.minPR, 0.5, Math.min(window.devicePixelRatio || 1, P.mid.pr) * QUALITY.scale);
        ok('画质：切档后像素比按档位同步',
            renderer.shadowMap.enabled === P.mid.shadow && Math.abs(renderer.getPixelRatio() - want) < 1e-6,
            'dpr=' + renderer.getPixelRatio().toFixed(2) + ' 期望=' + want.toFixed(2) +
            ' 阴影=' + renderer.shadowMap.enabled);
        ok('画质：点光源不超预算',
            trimPointLights() <= P.mid.pointLights,
            '实际点亮 ' + trimPointLights() + ' / 预算 ' + P.mid.pointLights);

        setQuality(bak);
        ok('画质：测完能回到原档位', QUALITY.tier === bak, 'tier=' + QUALITY.tier);
    }

    S.state = prevState;
    resetState();
    const pass = results.filter(r => r.pass).length;
    return { pass, fail: results.length - pass, total: results.length, results };
}

// 调试用：在浏览器控制台可以访问游戏状态
window.__game = {
    S, ANIM, ANIM_CFG, FLIGHT_CFG, CONFIG, obstacles, coins, pickups, Scene, THEMES,
    SAVE, UPGRADE_CFG, upCost, powerDur, tryBuyUpgrade, openUpgrades, closeUpgrades, renderUpgrades,
    camera, scene, renderer, player, wings, chaser, chaserModel,
    startGame, moveLane, jump, roll, startFlight, selfTest, resetState,
    placeMoving, movingCrash,   // 行驶障碍（测试用）
    speedBaseCap, atTopSpeed, topMovingMul, campusBlockedLanes, campusWallCrash,  // 极速 / 撞楼（验收用）
    spawnRow, checkCollisions,   // 关卡生成 / 碰撞（无必死局扫荡用）
    campusBoxes, nearCampusSolids, inCampusBox,   // 校园静态实体（撞树/撞楼验收用）
    REVIVE_CFG, reviveChanceAt, reviveRoll, placeRevive, spawnReviveIfDue, takeRevive, useRevive, die,   // 复活币（测试用）
    // 性能档位（测试/调试用）
    QUALITY, QUALITY_PRESETS, QP, setQuality, applyQualityOptions, applyResolution,
    trimPointLights, trimShadowCasters, PERF, BlobShadow,
    MOVING_OBSTACLE, MOVING_SHIELD_LV,
    get mergeState() { return MERGE_STATE; },
    scenery, worldGroup,
    // 传送门 / 新葡京路标（调试、验证用）
    PortalFX, LisboaFX, LISBOA_CFG, PORTAL_CFG, spawnGrandLisboa, clearGrandLisboa,
    RING_CFG, RingFX, spawnLandmarkRing, clearLandmarkRing, FINISH_GAZE,
    // 终点环绕过场（调试、验证用）
    FINISH, finishCam, startFinishFanfare, endFinishFanfare, FINISH_VIEW,
    // 地标 GLB（调试、验证用）
    LMGLB, LANDMARK_MODELS, loadLandmarkGLBs,
    // 真实校园（调试/验证用）。CAMPUS 必须用 getter：它是 let，
    // 切场景时会被重指到另一个集合，对象字面量里的裸引用不会跟着更新
    get CAMPUS() { return CAMPUS; }, CAMPUS_SETS,
    placeOnTrack, campusPoint, campusDir, campusNoteInput,
    campusJunctionGap, campusRewindTo,   // 路口净空 / 复活回退（调试、验证用）
    // 音频（调试/测试用）
    AUDIO, audioChannelGain, applyAudioLevels, toggleMute, openVolume, closeVolume,
    SFX, playGuardLaugh, startBgm, stopBgm,
    audioState: () => ({
        bgmOn: bgmOn, bgmStep: bgmStep,
        actxState: actx ? actx.state : null,
        applied: AUDIO.applied || null,
        laughVolume: guardAudio ? guardAudio.volume : null,
    }),
    addObstacle, makeCar, makeBus, makeTruck, makeScaffold, makeCone,   // 测试用：手动放障碍
    // [PKVS] 双人对战：强制开局地图（urlTheme 是 let，只能走 setter）、重铺场景
    setHomeTheme(t) { urlTheme = t || null; },
    getHomeTheme() { return urlTheme; },
    resetScene,
    makeSchoolBus, makeBikeObstacle, makeBanner, makeHurdle,
    // [PKVS] 双人对战：在赛道上摆一个道具（干扰道具就靠它落位）
    placePowerUp,
    spawnPickup(type, lane, s) {   // 测试用：在指定位置放一个道具
        const mesh = makePowerMesh(type);
        const p = { type, x: LANES[lane], y: 1.2, z: zOf(s), mesh };
        mesh.position.set(p.x, p.y, p.z);
        scene.add(mesh);
        pickups.push(p);
    },
    wingsVisible: () => wings[0].mount.visible,
    wingGrow: () => wingGrow,
    pose: () => ({ pivotX: player.pivot.rotation.x, bodyY: player.body.position.y, land: ANIM.land, squash: ANIM.squash }),
    step(dt) {   // 手动推进一帧逻辑（不渲染）
        if (S.state === 'playing') updatePlaying(dt);
        else if (S.state === 'dying') updateDying(dt);
        else if (S.state === 'menu') updateMenu(dt);
    },
};

// =====================================================================
//  ⑯ 主循环
// =====================================================================
const clock = new THREE.Clock();
let _frameT = 0, _carry = 0;
function loop(nowMs) {
    requestAnimationFrame(loop);
    const now = nowMs || performance.now();
    const raw = clock.getDelta();

    // 高刷屏（90/120Hz）没必要每帧都画：白烧电，还会把手机烤到降频
    // 跳过的帧把时间攒进 _carry，下一帧补回来，游戏速度不受影响
    const cap = PERF.frameCap();
    if (cap && now - _frameT < 1000 / cap - 1.2) { _carry += raw; return; }
    const dt = Math.min(raw + _carry, 1 / 30);
    _carry = 0;
    _frameT = now;

    if (!S.paused) {
        if (S.state === 'menu') updateMenu(dt);
        else if (S.state === 'playing') updatePlaying(dt);
        else if (S.state === 'dying') updateDying(dt);
        if (S.state === 'playing' || S.state === 'dying') updateHud(dt);
    }
    updatePortalFX(dt);
    // 过场期间必须停掉跟随相机，否则两边同时写 camera.position。
    // 注意喂 raw 而不是 dt：dt 被夹在 1/30 是为了玩法稳定，低帧率下会让过场变成慢放；
    // 模块内部自己会把 delta 夹到 maxDelta(0.1s)，切标签页回来也不会一帧跳完。
    if (FINISH.active) finishCam.update(raw); else updateCamera(dt);
    ATMO.update(dt, S.D);        // 天气按里程切，得把里程喂进去
    // 必须在 ATMO.update 之后：它每帧都会重写 scene.fog
    if (FINISH.active) applyFinishFog(dt);
    // [PKVS] 冷凝雾：同一个道理，得在 ATMO.update 之后才抢得到雾
    if (typeof window.__pkFogAura === 'function') window.__pkFogAura(scene.fog);
    // ART-TICK-BEGIN（tools/inline-art.py 生成）
    if (typeof ART !== 'undefined') {
        ART.tickWater(dt);
        ART.tickAmbient(dt, curTheme, 0, 0);   // 云层不能吃里程：px/pz 是世界坐标，不是 S.D
        if (curTheme === 'city') ART.tickCity(dt);
    }
    // ART-TICK-END
    // CASTLE-GATE-TICK-BEGIN（tools/patch18_visual.py 生成）
    if (typeof tickCastleGates === 'function') tickCastleGates(dt);     // 吊桥 / 吊闸 / 旗帜
    if (typeof updateTunnelLight === 'function') updateTunnelLight(dt); // 隧道分段开合的光照
    // CASTLE-GATE-TICK-END
    updateBlobShadow();
    // 阴影节流：中档每 2 帧、低档每 3 帧刷一次（一帧位移约 0.3m，看不出来）
    if (renderer.shadowMap.enabled) {
        PERF.shadowTick++;
        if (PERF.shadowTick % QP().shadowEvery === 0) renderer.shadowMap.needsUpdate = true;
    }
    renderer.render(scene, camera);
    PERF.tick(raw);
}
resetState();
S.state = 'menu';
const _qs = new URLSearchParams(location.search);
// ?seq=tunnel,city —— 指定开场场景序列（转场测试用）
if (_qs.has('seq')) {
    const q = _qs.get('seq').split(',').map(s => s.trim()).filter(id => THEMES[id]);
    if (q.length) Scene.queue = q;
}
// ?theme=city —— 直接以指定场景开局（截图 / 调试）
if (_qs.has('theme')) {
    const t = _qs.get('theme');
    if (THEMES[t]) {
        urlTheme = t;
        if (t !== curTheme) doSceneSwap(t);
    }
}
if (_qs.has('autostart')) startGame();
// ?selftest=1 —— 浏览器内跑一遍自动化自检并把结果显示在页面上
if (_qs.has('selftest')) {
    const res = selfTest();
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:99;background:rgba(8,14,26,.94);color:#fff;' +
        'font:13px/1.7 ui-monospace,Consolas,monospace;padding:22px;overflow:auto;white-space:pre-wrap';
    el.textContent = (res.fail === 0 ? '✅ 全部通过' : '❌ 有失败') + `  ${res.pass}/${res.total}\n\n` +
        res.results.map(r => (r.pass ? '✅ ' : '❌ ') + r.name + (r.info ? '   ' + r.info : '')).join('\n');
    document.body.appendChild(el);
}
loop();
