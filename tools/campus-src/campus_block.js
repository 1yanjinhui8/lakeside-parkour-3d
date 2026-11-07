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
const CAMPUS_PLATE_URL = 'assets/campus/beida-campus.glb';
const CAMPUS2_PLATE_URL = 'assets/campus2/bmu-campus.glb';

// 两个校园共用同一套机制（底板绕玩家转 + 路线投影 + 转向判定），
// 各自持有一份运行态（里程 / 转角 / 路口游标），切场景时整体换指向。
const CAMPUS_SETS = {
    campus: {
        id: 'campus',
        url: CAMPUS_PLATE_URL,
        // pts / total 由 tools/patch11_real_campus.py 注入（three 坐标，单位米）
        pts: __CAMPUS_PTS__,
        total: __CAMPUS_TOTAL__,
        landmarks: __CAMPUS_LM__,
        startArc: 1300,       // 开局切到博雅塔南侧的湖边直道
    },
    campus2: {
        id: 'campus2',
        url: CAMPUS2_PLATE_URL,
        pts: __CAMPUS2_PTS__,
        total: __CAMPUS2_TOTAL__,
        landmarks: __CAMPUS2_LM__,
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
    S.INPUT_WINDOW = 72;      // 路口前这个距离内按下才算数
    S.DIR_SMOOTH = 7.0;       // 方向平滑半窗（米）——把 90° 急弯摊成 ~14m 的转身
    // 手动转向：路口前 TURN_HOLD 米内没按对方向，底板就保持进弯朝向（路自己拐走，人直线冲出去）。
    // 按对了才放开，最多按 TURN_RATE 的角速度转——90° 约 12m / 0.8 秒。
    S.TURN_HOLD = 30;
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
    CAMPUS.pendingDir = dir;
    CAMPUS.pendingAt = CAMPUS.s;
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
    const ok = C.pendingDir === need;
    el.classList.remove('hidden');
    el.classList.toggle('ok', ok);
    const ar = el.querySelector('.ar'), tx = el.querySelector('.tx');
    if (ar) ar.textContent = j.dir === 'L' ? '⬅' : '➡';
    if (tx) tx.textContent = (ok ? '已转向 · ' : (j.dir === 'L' ? '左转 ' : '右转 '))
        + Math.max(0, Math.round(dist)) + 'm';
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
                    m.map.anisotropy = Math.min(8, maxAniso);
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
            const gltf = await new GLTFLoader().loadAsync(S.url);
            tune(gltf.scene);
            const g = new THREE.Group();
            g.name = 'campusPlate-' + S.id;
            g.userData.noMerge = true;    // 它自己会动，绝不能进静态合并
            g.add(gltf.scene);
            // 地标：博雅塔用代码搭（GLB 里只留了坐标）；医学部没有代码地标
            for (const lm of (S.landmarks || [])) {
                if (lm.name === '博雅塔') g.add(buildBoyaPagoda(lm.x, lm.z, lm.h || 31));
            }
            g.visible = false;
            scene.add(g);
            S.group = g;
            S.ready = true;
            console.log('[campus] ' + S.id + ' 底板已载入：' + S.pts.length + ' 拐点 / '
                + Math.round(S.total) + ' m');
        } catch (e) {
            console.warn('[campus] ' + S.id + ' 底板载入失败，该场景回退直道:', e && e.message || e);
        }
    }));
}