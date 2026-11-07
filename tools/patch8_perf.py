# -*- coding: utf-8 -*-
"""
patch8_perf.py —— 手机端性能优化：光影减配 + 自适应分辨率 + 阴影节流

背景：手机 GPU 的填充率和内存带宽跟台式机差一个量级。原版把
PCFSoftShadowMap(1024) + 5 盏点光 + 1.5 倍像素比一股脑全开，在手机上
就是「光影太重 → 掉帧 → 一卡一卡」。

改动（全部是渲染层，不碰任何玩法数值）：
  1. 画质三档 high/mid/low，按设备自动判定，可用 ?q= 或暂停面板手调
  2. 低档关实时阴影，改成脚下一张径向渐变贴片（保住落地感，0 阴影 pass）
  3. 阴影节流：shadowMap.autoUpdate=false，每 N 帧刷一次（1 帧≈0.3m，看不出）
  4. 阴影视锥收紧：1024→768/关闭，远平面 100→78/62，小摆件不再投影
  5. 点光源按优先级裁剪：城市夜景只留霓虹两盏，隧道只留顶部两盏
  6. 自适应分辨率：帧时 >20.5ms 逐级降采样，稳住了再慢慢加回来
  7. 高刷屏（>=90Hz）把帧率上限压到 60，避免 120Hz 白烧电＋烤机降频
  8. 雨丝 / 薄雾精灵按档位减量（过度绘制是手机头号杀手）

用法： python tools/patch8_perf.py
"""
import io, sys, os

P = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'playable.html')
s = io.open(P, encoding='utf-8').read()
orig_len = len(s)
hits = []


def sub(tag, old, new, count=1):
    """精确替换 + 唯一性断言，防止锚点漂移把文件改坏"""
    global s
    n = s.count(old)
    assert n == count, 'anchor [%s] 命中 %d 次（期望 %d）' % (tag, n, count)
    s = s.replace(old, new)
    hits.append(tag)


# ---------------------------------------------------------------- 1. PERF 模块
PERF_BLOCK = r'''// =====================================================================
//  ③ 性能档位 —— 手机不是电脑，光影得能「减配」而不是硬开
//     · 三档 high / mid / low：默认按设备自动判定，?q=low 可强制，面板里也能手调
//     · 低档：关实时阴影（换成脚下一张投影贴片）、砍点光源、降采样、雨雾减量
//     · 运行中自适应：帧时超 20.5ms 就逐级降采样，稳住了再慢慢加回来
//  原则：视觉上「几乎看不出来」，但阴影 pass 和片元光照的开销能砍掉一大半
// =====================================================================
const QUALITY_PRESETS = {
    high: {   // 台式机 / 独显：保留原来的观感
        label: '高', pr: 1.5, aa: true,
        shadow: true, soft: true, shadowSize: 1024, shadowEvery: 1,
        cam: { l: -20, r: 20, t: 35, b: -35, far: 100 },
        pointLights: 3, rain: 1500, mist: 10, fpsCap: 60, minScale: 0.8,
    },
    mid: {    // 主流手机 / 核显轻薄本：阴影降规格 + 每 2 帧刷一次
        label: '中', pr: 1.25, aa: true,
        shadow: true, soft: false, shadowSize: 768, shadowEvery: 2,
        cam: { l: -15, r: 15, t: 25, b: -25, far: 76 },
        pointLights: 3, rain: 1100, mist: 7, fpsCap: 60, minScale: 0.68,
    },
    low: {    // 入门机 / 老机型：关实时阴影，换投影贴片
        label: '低', pr: 1.0, aa: false,
        shadow: false, soft: false, shadowSize: 512, shadowEvery: 3,
        cam: { l: -13, r: 13, t: 20, b: -20, far: 62 },
        pointLights: 2, rain: 700, mist: 5, fpsCap: 60, minScale: 0.55,
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
        // 桌面按像素量分：4K / 超宽屏别一上来就顶 1.5 倍像素比
        return (innerWidth * innerHeight > 2.6e6) ? 'mid' : 'high';
    }
    if (cores <= 4 || mem <= 3) return 'low';   // 入门机、老机型
    return 'mid';                                // 主流手机先中档，真卡了自适应会继续降
}

const QUALITY = {
    tier: detectQualityTier(),
    scale: 1,          // 自适应分辨率倍率（1 = 满档，下限见各档 minScale）
    ms: 16.7,          // 帧时滑动均值
    win: 0,            // 当前统计窗口累计毫秒
    good: 0,           // 连续「够快」的窗口数
    hz: 0,             // 实测刷新率（0 = 还没测出来）
    adaptive: true,    // 基准测试时可关掉，避免测量过程被自动降采样污染
};
const QP = () => QUALITY_PRESETS[QUALITY.tier];

// ---- 分辨率：基础像素比 × 自适应倍率 --------------------------------
function applyResolution() {
    const dpr = window.devicePixelRatio || 1;
    const base = Math.min(dpr, QP().pr);
    renderer.setPixelRatio(Math.max(0.5, base * QUALITY.scale));
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
    m.visible = S.state !== 'menu';
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
    updateBlobShadow();
}

let atmoRef = null;
function attachAtmo(a) { atmoRef = a; if (a) a.setQuality(QP()); }

function setQuality(tier) {
    if (!QUALITY_PRESETS[tier]) return QUALITY.tier;
    QUALITY.tier = tier;
    QUALITY.scale = 1;
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
        // 只有确认是高刷屏（>=90Hz）才把上限压到 60：普通 60Hz 屏不用管
        return QUALITY.hz >= 88 ? QP().fpsCap : 0;
    },
    tick(raw) {
        const ms = raw * 1000;
        if (!(ms > 0) || ms > 34) return;          // 加载/切场景的异常帧不参与统计
        QUALITY.ms = QUALITY.ms * 0.9 + ms * 0.1;

        // 前 60 帧估一下屏幕刷新率（只用来决定要不要限帧）
        if (QUALITY.hz === 0) {
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
        const q = QP();
        if (QUALITY.ms > 20.5 && QUALITY.scale > q.minScale) {
            // 掉了：一次降 10%，别指望一口气到位，慢慢找平衡点
            QUALITY.scale = Math.max(q.minScale, QUALITY.scale - 0.1);
            QUALITY.good = 0;
            applyResolution();
        } else if (QUALITY.ms < 14.2 && QUALITY.scale < 1) {
            // 稳住了：连着 3 个窗口都够快才加回来，避免来回抖
            if (++QUALITY.good >= 3) {
                QUALITY.scale = Math.min(1, QUALITY.scale + 0.06);
                QUALITY.good = 0;
                applyResolution();
            }
        } else {
            QUALITY.good = 0;
        }
    },
};

'''

sub('perf-block',
    "const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });\n"
    "renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));   // 高分屏上限 1.5：4K/Retina 下省掉一半像素填充\n"
    "renderer.setSize(innerWidth, innerHeight);\n"
    "renderer.shadowMap.enabled = true;\n"
    "renderer.shadowMap.type = THREE.PCFSoftShadowMap;\n"
    "$('app').appendChild(renderer.domElement);\n",
    PERF_BLOCK +
    "const renderer = new THREE.WebGLRenderer({\n"
    "    antialias: QP().aa,              // 低档关 MSAA：手机上是实打实的带宽开销\n"
    "    powerPreference: 'high-performance',\n"
    "    stencil: false,                  // 用不到模板缓冲，省一份附件\n"
    "});\n"
    "renderer.setPixelRatio(1);            // 真实像素比在 applyResolution() 里按档位给\n"
    "renderer.setSize(innerWidth, innerHeight);\n"
    "renderer.shadowMap.enabled = QP().shadow;\n"
    "renderer.shadowMap.type = QP().soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;\n"
    "renderer.shadowMap.autoUpdate = false;   // 手动节流：影子不必每帧重算\n"
    "renderer.shadowMap.needsUpdate = true;\n"
    "$('app').appendChild(renderer.domElement);\n")

# ---------------------------------------------------------------- 2. resize
sub('resize',
    "    camera.updateProjectionMatrix();\n"
    "    renderer.setSize(innerWidth, innerHeight);\n"
    "}\n"
    "addEventListener('resize', onResize);",
    "    camera.updateProjectionMatrix();\n"
    "    renderer.setSize(innerWidth, innerHeight);\n"
    "    applyResolution();          // 横竖屏切换后像素比要重算\n"
    "}\n"
    "addEventListener('resize', onResize);")

# ---------------------------------------------------------------- 3. 太阳光/阴影
sub('sun',
    "const sun = new THREE.DirectionalLight(0xffffff, 1.7);\n"
    "sun.position.set(10, 25, 12);\n"
    "sun.target.position.set(0, 0, -10);\n"
    "sun.castShadow = true;\n"
    "sun.shadow.mapSize.set(1024, 1024);                    // 1024 足够（阴影只铺玩家周围 70m），填充率省 4 倍\n"
    "Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 35, bottom: -35, near: 1, far: 100 });\n"
    "sun.shadow.camera.updateProjectionMatrix();\n"
    "sun.shadow.bias = -0.0006;                              // 低分辨率下抑制自阴影条纹\n"
    "scene.add(sun, sun.target);\n",
    "const sun = new THREE.DirectionalLight(0xffffff, 1.7);\n"
    "sun.position.set(10, 25, 12);\n"
    "sun.target.position.set(0, 0, -10);\n"
    "sun.castShadow = true;\n"
    "sun.shadow.mapSize.set(1024, 1024);                    // 默认值，实际按画质档位覆盖\n"
    "Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 35, bottom: -35, near: 1, far: 100 });\n"
    "sun.shadow.camera.updateProjectionMatrix();\n"
    "sun.shadow.bias = -0.0006;                              // 低分辨率下抑制自阴影条纹\n"
    "scene.add(sun, sun.target);\n"
    "applyQualityOptions();   // 阴影尺寸/视锥/点光/像素比，一次性对齐当前档位\n")

# ---------------------------------------------------------------- 4. ATMO 接入
sub('atmo-attach',
    "const ATMO = createAtmo({ THREE, scene, camera, hemi, sun });",
    "const ATMO = createAtmo({ THREE, scene, camera, hemi, sun });\n"
    "attachAtmo(ATMO);   // 把天气密度/霓虹灯的开关交给性能档位统一管\n")

# ---------------------------------------------------------------- 5. 点光优先级
sub('lamp-order',
    "    const playerLamp = new THREE.PointLight(0xffd7a8, 0, 15, 2);\n"
    "    playerLamp.position.set(0, 2.4, 2);\n",
    "    const playerLamp = new THREE.PointLight(0xffd7a8, 0, 15, 2);\n"
    "    playerLamp.position.set(0, 2.4, 2);\n"
    "    playerLamp.userData.plOrder = 0;          // 优先级最高：人物补光，永远留\n")

sub('street-order',
    "    const streetLights = [\n"
    "        { light: new THREE.PointLight(0x39e6ff, 0, 17, 2), x: -5.4 },\n"
    "        { light: new THREE.PointLight(0xff3ba0, 0, 17, 2), x: 5.4 },\n"
    "    ];\n"
    "    for (const s of streetLights) {\n"
    "        s.light.position.set(s.x, 4.2, 0);\n"
    "        scene.add(s.light);\n"
    "    }\n",
    "    const streetLights = [\n"
    "        { light: new THREE.PointLight(0x39e6ff, 0, 17, 2), x: -5.4 },\n"
    "        { light: new THREE.PointLight(0xff3ba0, 0, 17, 2), x: 5.4 },\n"
    "    ];\n"
    "    streetLights.forEach((s, i) => {\n"
    "        s.light.position.set(s.x, 4.2, 0);\n"
    "        s.light.userData.plOrder = 1 + i;      // 只在赛博街区点亮，其它场景 qOff\n"
    "        scene.add(s.light);\n"
    "    });\n")

sub('tunnel-order',
    "    const pl1 = new THREE.PointLight(0xffe2b0, 12, 38, 1.5); pl1.position.set(0, 5.2, -5);\n"
    "    const pl2 = new THREE.PointLight(0xdfe8ff, 7, 55, 1.5); pl2.position.set(0, 6, -58);\n"
    "    worldGroup.add(pl1, pl2);\n",
    "    const pl1 = new THREE.PointLight(0xffe2b0, 12, 38, 1.5); pl1.position.set(0, 5.2, -5);\n"
    "    const pl2 = new THREE.PointLight(0xdfe8ff, 7, 55, 1.5); pl2.position.set(0, 6, -58);\n"
    "    pl1.userData.plOrder = 3; pl2.userData.plOrder = 4;   // 和霓虹灯比是次优先\n"
    "    worldGroup.add(pl1, pl2);\n")

# ---------------------------------------------------------------- 6. ATMO 内部
sub('atmo-q-var',
    "    let playerRoot = null;\n",
    "    let playerRoot = null;\n"
    "    let qRainCap = RAIN_MAX, qMistCap = 10;   // 由性能档位下发\n")

sub('atmo-setquality',
    "    const ATMO = {\n"
    "        update,\n"
    "        setTime,\n"
    "        setWeather,\n",
    "    const ATMO = {\n"
    "        update,\n"
    "        setTime,\n"
    "        setWeather,\n"
    "        /** 画质档位：雨丝上限 / 薄雾精灵数量（过度绘制是手机上最贵的开销）*/\n"
    "        setQuality(q) {\n"
    "            if (!q) return;\n"
    "            qRainCap = Math.max(200, Math.min(RAIN_MAX, q.rain || RAIN_MAX));\n"
    "            qMistCap = Math.max(2, Math.min(mistGroup.children.length, q.mist || mistGroup.children.length));\n"
    "            mistGroup.children.forEach((sp, i) => { sp.visible = i < qMistCap; });\n"
    "        },\n")

sub('atmo-onscene',
    "        onScene(id, name) {\n"
    "            st.id = id;\n"
    "            st.indoor = id === 'tunnel';\n"
    "            st.sceneName = name || '';\n"
    "            if (!st.manual) st.mistTimer = Math.min(st.mistTimer, 30);   // 换场后别憋太久才起雾\n"
    "            playerLamp.intensity = st.indoor ? 1.5 : 0.6;\n"
    "        },\n",
    "        onScene(id, name) {\n"
    "            st.id = id;\n"
    "            st.indoor = id === 'tunnel';\n"
    "            st.sceneName = name || '';\n"
    "            if (!st.manual) st.mistTimer = Math.min(st.mistTimer, 30);   // 换场后别憋太久才起雾\n"
    "            playerLamp.intensity = st.indoor ? 1.5 : 0.6;\n"
    "            // 霓虹洗墙灯只有赛博街区用得上，别的地方直接标 qOff（不参与点光预算）\n"
    "            const cityOn = id === 'city';\n"
    "            for (const s of streetLights) s.light.userData.qOff = !cityOn;\n"
    "            if (typeof trimPointLights === 'function') trimPointLights();\n"
    "        },\n")

sub('atmo-rain',
    "            const n = Math.floor(RAIN_MAX * clamp01(st.rain + 0.15));",
    "            const n = Math.min(qRainCap, Math.floor(RAIN_MAX * clamp01(st.rain + 0.15)));")

sub('atmo-mist',
    "            for (const s of mistGroup.children) {\n"
    "                s.position.x = s.userData.x0 + Math.sin(tt * 0.18 + s.userData.ph) * 3.2;\n"
    "            }",
    "            for (const s of mistGroup.children) {\n"
    "                if (!s.visible) continue;   // 被画质档位裁掉的雾片不用算\n"
    "                s.position.x = s.userData.x0 + Math.sin(tt * 0.18 + s.userData.ph) * 3.2;\n"
    "            }")

# ---------------------------------------------------------------- 7. buildWorld 收尾
sub('buildworld',
    "    applyEnv(T.env);\n"
    "    const hs = $('hudScene'); if (hs) hs.textContent = T.name;\n"
    "    if (typeof ATMO !== 'undefined') ATMO.onScene(id, T.name);\n"
    "}\n",
    "    applyEnv(T.env);\n"
    "    const hs = $('hudScene'); if (hs) hs.textContent = T.name;\n"
    "    if (typeof ATMO !== 'undefined') ATMO.onScene(id, T.name);\n"
    "    // 换世界后：重算点光预算、剔掉小摆件的投影、强制刷新一次阴影贴图\n"
    "    if (QUALITY.tier !== 'high' && QP().shadow) trimShadowCasters(worldGroup);\n"
    "    trimPointLights();\n"
    "    renderer.shadowMap.needsUpdate = true;\n"
    "}\n")

# ---------------------------------------------------------------- 8. 主循环
sub('loop',
    "const clock = new THREE.Clock();\n"
    "function loop() {\n"
    "    requestAnimationFrame(loop);\n"
    "    const dt = Math.min(clock.getDelta(), 1 / 30);\n"
    "    if (!S.paused) {\n"
    "        if (S.state === 'menu') updateMenu(dt);\n"
    "        else if (S.state === 'playing') updatePlaying(dt);\n"
    "        else if (S.state === 'dying') updateDying(dt);\n"
    "        if (S.state === 'playing' || S.state === 'dying') updateHud(dt);\n"
    "    }\n"
    "    updatePortalFX(dt);\n"
    "    updateCamera(dt);\n"
    "    ATMO.update(dt, S.D);        // 天气按里程切，得把里程喂进去\n"
    "    renderer.render(scene, camera);\n"
    "}\n",
    "const clock = new THREE.Clock();\n"
    "let _frameT = 0, _carry = 0;\n"
    "function loop(nowMs) {\n"
    "    requestAnimationFrame(loop);\n"
    "    const now = nowMs || performance.now();\n"
    "    const raw = clock.getDelta();\n"
    "\n"
    "    // 高刷屏（90/120Hz）没必要每帧都画：白烧电，还会把手机烤到降频\n"
    "    // 跳过的帧把时间攒进 _carry，下一帧补回来，游戏速度不受影响\n"
    "    const cap = PERF.frameCap();\n"
    "    if (cap && now - _frameT < 1000 / cap - 1.2) { _carry += raw; return; }\n"
    "    const dt = Math.min(raw + _carry, 1 / 30);\n"
    "    _carry = 0;\n"
    "    _frameT = now;\n"
    "\n"
    "    if (!S.paused) {\n"
    "        if (S.state === 'menu') updateMenu(dt);\n"
    "        else if (S.state === 'playing') updatePlaying(dt);\n"
    "        else if (S.state === 'dying') updateDying(dt);\n"
    "        if (S.state === 'playing' || S.state === 'dying') updateHud(dt);\n"
    "    }\n"
    "    updatePortalFX(dt);\n"
    "    updateCamera(dt);\n"
    "    ATMO.update(dt, S.D);        // 天气按里程切，得把里程喂进去\n"
    "    updateBlobShadow();\n"
    "    // 阴影节流：中档每 2 帧、低档每 3 帧刷一次（一帧位移约 0.3m，看不出来）\n"
    "    if (renderer.shadowMap.enabled) {\n"
    "        PERF.shadowTick++;\n"
    "        if (PERF.shadowTick % QP().shadowEvery === 0) renderer.shadowMap.needsUpdate = true;\n"
    "    }\n"
    "    renderer.render(scene, camera);\n"
    "    PERF.tick(raw);\n"
    "}\n")

# ---------------------------------------------------------------- 9. 画质面板 HTML
sub('ui-html',
    '        <div class="volBtns">\n'
    '            <button class="btn" id="volMute">🔇 静音</button>',
    '        <div class="volRow" id="qRow">\n'
    '            <span class="lbl"><i>🎛️</i>画质</span>\n'
    '            <div class="qBtns">\n'
    '                <button class="qBtn" data-q="low">低</button>\n'
    '                <button class="qBtn" data-q="mid">中</button>\n'
    '                <button class="qBtn" data-q="high">高</button>\n'
    '            </div>\n'
    '        </div>\n'
    '        <div class="volTip" id="qTip"></div>\n'
    '        <div class="volBtns">\n'
    '            <button class="btn" id="volMute">🔇 静音</button>')

# ---------------------------------------------------------------- 10. 画质面板 CSS
sub('ui-css',
    '    .volBtns { display: flex; gap: 12px; justify-content: center; margin-top: 18px; flex-wrap: wrap; }',
    '    .qBtns { display: flex; gap: 8px; flex: 1; }\n'
    '    .qBtn {\n'
    '        flex: 1; padding: 9px 0; font: bold 15px/1 inherit; color: #fff; cursor: pointer;\n'
    '        background: rgba(255,255,255,.10); border: 2px solid rgba(255,255,255,.22);\n'
    '        border-radius: 10px; transition: background .15s, border-color .15s;\n'
    '    }\n'
    '    .qBtn.on { background: rgba(255,143,209,.34); border-color: #ff8fd1; }\n'
    '    .qBtn:active { transform: translateY(1px); }\n'
    '    .volBtns { display: flex; gap: 12px; justify-content: center; margin-top: 18px; flex-wrap: wrap; }')

# ---------------------------------------------------------------- 11. 画质面板 JS
sub('ui-js',
    "$('volBtn').onclick = openVolume;\n"
    "$('volBack').onclick = closeVolume;",
    "function refreshQualityUI() {\n"
    "    const row = $('qRow');\n"
    "    if (!row) return;\n"
    "    for (const b of row.querySelectorAll('.qBtn')) b.classList.toggle('on', b.dataset.q === QUALITY.tier);\n"
    "    const tip = $('qTip');\n"
    "    if (tip) {\n"
    "        tip.textContent = QP().shadow\n"
    "            ? '当前：' + QP().label + '档 · 启用实时阴影（更吃性能）'\n"
    "            : '当前：' + QP().label + '档 · 已关实时阴影，改用脚下投影贴片';\n"
    "    }\n"
    "}\n"
    "for (const b of document.querySelectorAll('#qRow .qBtn')) {\n"
    "    b.onclick = () => { setQuality(b.dataset.q); initAudio(); SFX.coin(); };\n"
    "}\n"
    "refreshQualityUI();\n"
    "\n"
    "$('volBtn').onclick = openVolume;\n"
    "$('volBack').onclick = closeVolume;")

# ---------------------------------------------------------------- 12. 调试接口
sub('expose',
    "    REVIVE_CFG, reviveChanceAt, reviveRoll, placeRevive, spawnReviveIfDue, takeRevive, useRevive, die,   // 复活币（测试用）",
    "    REVIVE_CFG, reviveChanceAt, reviveRoll, placeRevive, spawnReviveIfDue, takeRevive, useRevive, die,   // 复活币（测试用）\n"
    "    // 性能档位（测试/调试用）\n"
    "    QUALITY, QUALITY_PRESETS, QP, setQuality, applyQualityOptions, applyResolution,\n"
    "    trimPointLights, trimShadowCasters, PERF, BlobShadow,")

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('patched: ' + ', '.join(hits))
print('size %d -> %d (+%d bytes)' % (orig_len, len(s), len(s) - orig_len))
