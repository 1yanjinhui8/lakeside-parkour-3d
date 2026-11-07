// ── 主逻辑片段 04/08 ──────────────────────────────
// 分节：循环滚动的装饰：楼房、路灯、湖边岩石、金色相框 (1)
// 按编号顺序合起来 = src/game.module.js 的全部逻辑（资源已用占位符替代）
// 生成自 playable.html，勿手改；重跑 tools/extract-src.py 同步
// ────────────────────────────────────────────────────────────────

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
