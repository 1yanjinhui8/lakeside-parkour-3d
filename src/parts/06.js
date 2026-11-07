// ── 主逻辑片段 06/08 ──────────────────────────────
// 分节：循环滚动的装饰：楼房、路灯、湖边岩石、金色相框 (3) + ⑦ 主题注册表与世界重建 + ⑧ 场景管理器：段落长度 / 黑场转场 / 下一场景选择 + shader 按【世界高度】
// 按编号顺序合起来 = src/game.module.js 的全部逻辑（资源已用占位符替代）
// 生成自 playable.html，勿手改；重跑 tools/extract-src.py 同步
// ────────────────────────────────────────────────────────────────

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
