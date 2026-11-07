// =====================================================================
//  js/atmo.js —— 昼夜循环 + 天气（雨 / 薄雾 / 星空）
//  · 天空穹顶（渐变着色器）+ 星空 + 日月 + 云
//  · 太阳/半球光随时段插值，雾距随天气压缩
//  · 雨丝粒子 / 薄雾精灵 / 湿地面（粗糙度联动）
//  · 提供给旧城模块注册「霓虹发光」与「湿地面」材质
//  只依赖外部传入的 THREE / scene / camera / hemi / sun，不改主模块状态
// =====================================================================
export function createAtmo({ THREE, scene, camera, hemi, sun }) {
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
