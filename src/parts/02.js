// ── 主逻辑片段 02/08 ──────────────────────────────
// 分节：性能档位 —— 手机不是电脑，光影得能「减配」而不是硬开 + 注册时扫一遍顶点，按 2m 一层、24 个方位记下「每层的截面半径」——等于 + 按 11 个高度（8%~91%）生成
// 按编号顺序合起来 = src/game.module.js 的全部逻辑（资源已用占位符替代）
// 生成自 playable.html，勿手改；重跑 tools/extract-src.py 同步
// ────────────────────────────────────────────────────────────────

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
