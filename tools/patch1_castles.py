# -*- coding: utf-8 -*-
"""补丁 1：湖畔地图建筑 → 北欧式城堡（白/黑双色、对称几何、宏大尺度）"""
import io, os

P = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'playable.html')
src = io.open(P, encoding='utf-8').read()
orig_len = len(src)

ANCHOR = "function buildLakesideDecor() {\n    for (let i = 0; i < 18; i++) {\n"
assert src.count(ANCHOR) == 1, 'buildLakesideDecor 锚点不唯一'

CASTLE = r'''
// ---- 湖畔：北欧式城堡（白 / 黑双色 · 对称几何 · 宏大尺度）----
// 设计原则（欧式几何美感）：所有尺寸取 3m 模数；腰线 / 壁柱 / 窗洞 / 城垛严格等分，
// 立面靠"横向腰线 + 竖向壁柱 + 网格窗洞"三段几何关系撑住，不靠贴图糊细节。
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
const castleWhiteTex = castleStone('#ded9cf', 'rgba(118,114,106,0.34)', 'rgba(88,86,80,0.16)');
const castleBlackTex = castleStone('#23262c', 'rgba(6,7,10,0.78)', 'rgba(0,0,0,0.38)');

const CASTLE_MAT = {
    white:     shared(std(0xffffff, { map: castleWhiteTex, roughness: 0.88 })),
    black:     shared(std(0xffffff, { map: castleBlackTex, roughness: 0.92 })),
    whiteTrim: shared(std(0xf3efe6, { roughness: 0.66 })),
    blackTrim: shared(std(0x3d434c, { roughness: 0.82, metalness: 0.14 })),
    whiteRoof: shared(std(0x39434f, { roughness: 0.5, metalness: 0.34, flatShading: true })),
    blackRoof: shared(std(0x14181e, { roughness: 0.46, metalness: 0.44, flatShading: true })),
    winDark:   shared(std(0x1d2a3a, { roughness: 0.22, metalness: 0.5, emissive: 0x0b1622, emissiveIntensity: 0.6 })),
    winLit:    shared(std(0x2b2018, { roughness: 0.3, emissive: 0xffb04a, emissiveIntensity: 1.25 })),
    gold:      shared(std(0xd9b45c, { roughness: 0.32, metalness: 0.9 })),
    banner:    shared(std(0xb2323f, { roughness: 0.75, side: THREE.DoubleSide })),
};

// 一座北欧式城堡：台基 → 主体 → 腰线/壁柱/窗洞 → 城垛 → 四角圆塔 → 中央主塔 → 旗
function makeNordicCastle(white) {
    const g = new THREE.Group();
    const M = 3;                                             // 模数
    const sx = (4 + Math.round(rand(0, 2))) * M;             // 进深 12–18（沿 x，往轨道外）
    const sz = (6 + Math.round(rand(0, 2))) * M;             // 面宽 18–24（沿 z，顺轨道）
    const hy = (5 + Math.round(rand(0, 4))) * M;             // 主体高 15–27
    const mat  = white ? CASTLE_MAT.white : CASTLE_MAT.black;
    const trim = white ? CASTLE_MAT.whiteTrim : CASTLE_MAT.blackTrim;
    const roof = white ? CASTLE_MAT.whiteRoof : CASTLE_MAT.blackRoof;
    const win  = white ? CASTLE_MAT.winDark : CASTLE_MAT.winLit;
    const Y0 = 2.2;                                          // 台基顶面
    const face = sx / 2;                                     // 朝向轨道的那一面（+x）

    const put = (mesh, x, y, z) => { mesh.position.set(x, y, z); g.add(mesh); return mesh; };
    const box = (w, h, d, m, x, y, z) => put(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y, z);
    const cyl = (r, hh, seg, m, x, y, z) => put(new THREE.Mesh(new THREE.CylinderGeometry(r, r, hh, seg), m), x, y, z);
    const cone = (r, hh, seg, m, x, y, z, ry) => {
        const me = put(new THREE.Mesh(new THREE.ConeGeometry(r, hh, seg), m), x, y, z);
        if (ry) me.rotation.y = ry;
        return me;
    };

    // ① 台基：两级收分（古典台基比例，让整座城堡"坐得住"）
    box(sx + 5.0, 1.2, sz + 5.0, trim, 0, 0.6, 0);
    box(sx + 2.6, 1.0, sz + 2.6, mat, 0, 1.7, 0);

    // ② 主体
    box(sx, hy, sz, mat, 0, Y0 + hy / 2, 0);

    // ③ 两道腰线 + 檐口：横向几何节奏
    for (const t of [0.4, 0.72]) box(sx + 0.7, 0.34, sz + 0.7, trim, 0, Y0 + hy * t, 0);
    box(sx + 1.1, 0.55, sz + 1.1, trim, 0, Y0 + hy + 0.28, 0);

    // ④ 壁柱：面宽六等分，竖向律动（与腰线交叉出格子感）
    for (let i = 0; i <= 6; i++) {
        box(0.6, hy - 1.4, 0.85, trim, face + 0.28, Y0 + hy / 2 - 0.4, -sz / 2 + i * sz / 6);
    }

    // ⑤ 窗洞：严格 cols × rows 网格，深色内凹
    const cols = Math.max(3, Math.floor(sz / 3.4));
    const rows = Math.max(2, Math.floor(hy / 4));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            box(0.3, 1.8, 0.95, win, face + 0.02,
                Y0 + 2.6 + r * ((hy - 4.4) / rows), -sz / 2 + sz * (c + 0.5) / cols);
        }
    }

    // ⑥ 城垛：正面 + 两端，齿间距恒定为 2 倍齿宽
    const mw = 0.95, mh = 1.2, topY = Y0 + hy + 0.55 + mh / 2;
    for (let z = -sz / 2 + mw / 2; z <= sz / 2 - mw / 2 + 0.01; z += mw * 2) {
        box(0.9, mh, mw, mat, face - 0.45, topY, z);
    }
    for (const s of [-1, 1]) {
        for (let x = -sx / 2 + mw / 2; x <= sx / 2 - mw / 2 + 0.01; x += mw * 2) {
            box(mw, mh, 0.9, mat, x, topY, s * (sz / 2 - 0.45));
        }
    }

    // ⑦ 四角圆塔：塔基 → 塔身 → 檐环 → 垛口环 → 锥顶 → 金饰
    const tr = 2.3, th = hy + 5;
    for (const ax of [-1, 1]) for (const az of [-1, 1]) {
        const tx = ax * (sx / 2 - 0.6), tz = az * (sz / 2 - 0.6);
        cyl(tr + 0.5, 1.5, 12, trim, tx, Y0 + 0.75, tz);
        cyl(tr, th, 12, mat, tx, Y0 + th / 2, tz);
        cyl(tr + 0.34, 0.46, 12, trim, tx, Y0 + th - 0.23, tz);
        for (let k = 0; k < 8; k++) {
            const a = k * Math.PI / 4;
            box(0.8, 1.0, 0.8, mat, tx + Math.cos(a) * (tr - 0.15), Y0 + th + 0.5, tz + Math.sin(a) * (tr - 0.15));
        }
        const tipY = Y0 + th + 1.0 + 6.4;
        cone(tr + 0.55, 6.4, 12, roof, tx, Y0 + th + 1.0 + 3.2, tz);
        cone(0.4, 1.1, 8, CASTLE_MAT.gold, tx, tipY + 0.4, tz);
        for (let k = 0; k < 3; k++) {                        // 塔身朝轨道的竖窗
            box(0.34, 1.5, 0.55, win, tx + tr * 0.94, Y0 + th * 0.42 + k * 3.4, tz);
        }
        // 前沿两座塔顶挂旗，给黑/白巨石加一点暖色
        if (ax > 0) {
            box(0.12, 3.6, 0.12, CASTLE_MAT.gold, tx, tipY + 2.0, tz);
            box(0.08, 1.4, 1.0, CASTLE_MAT.banner, tx, tipY + 3.0, tz + 0.58);
        }
    }

    // ⑧ 中央主塔：整体最高的体量，压住构图（宏大感主要来自这里）
    const cw = 5.2, ch = hy + 9;
    box(cw, ch, cw, mat, face - cw / 2 + 0.35, Y0 + ch / 2, 0);
    box(cw + 0.9, 0.55, cw + 0.9, trim, face - cw / 2 + 0.35, Y0 + ch - 0.3, 0);
    cone(cw * 0.86, 8.0, 4, roof, face - cw / 2 + 0.35, Y0 + ch + 4.2, 0, Math.PI / 4);
    cone(0.36, 1.0, 8, CASTLE_MAT.gold, face - cw / 2 + 0.35, Y0 + ch + 8.6, 0);
    for (let k = 0; k < 2; k++) {
        box(0.34, 2.2, 0.7, win, face + 0.38, Y0 + ch * 0.55 + k * 4.2, 0);
    }

    // ⑨ 拱门：门洞 + 门框 + 台阶（比例 1:2，欧式拱门的经典分割）
    box(0.4, 4.8, 2.8, darkMat, face + 0.42, Y0 + 2.4, 0);
    for (const s of [-1, 1]) box(0.55, 4.8, 0.55, trim, face + 0.62, Y0 + 2.4, s * 1.65);
    box(0.55, 0.55, 3.9, trim, face + 0.62, Y0 + 5.05, 0);
    for (let k = 0; k < 2; k++) box(3.2 + k * 1.2, 0.35, 5.0 + k * 1.4, trim, face + 1.2 + k * 0.6, 0.18 + k * 0.35, 0);

    g.userData.halfX = (sx + 5.0) / 2;    // 台基半宽：调用方据此把最外沿贴到护栏外
    return g;
}
'''

OLD_LOOP = '''    for (let i = 0; i < 18; i++) {
        const w = rand(7, 11), d = rand(13, 16.5), h = rand(8, 26);
        const tex = winTex.clone();
        tex.userData.shared = false;    // 克隆体随楼房一起销毁，避免泄漏
        tex.repeat.set(Math.round(d / 3), Math.round(h / 3));
        tex.needsUpdate = true;
        const color = new THREE.Color().setHSL(Math.random(), 0.45, 0.7);
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(color, { map: tex, roughness: 0.85 }));
        m.position.set(-5.2 - w / 2 - rand(0, 2), h / 2, 0);
        m.castShadow = m.receiveShadow = true;
        addScenery(m, 20 - i * 18);
    }
'''

NEW_LOOP = '''    // 左岸：九座北欧式城堡，白 / 黑交替，沿轨道形成有节律的立面序列
    for (let i = 0; i < 9; i++) {
        const c = makeNordicCastle(i % 2 === 0);
        c.position.x = -5.4 - c.userData.halfX - rand(0, 1.8);   // 台基最外沿贴到护栏外
        c.rotation.y = rand(-0.02, 0.02);
        addScenery(c, 20 - i * 36);
    }
'''

assert src.count(OLD_LOOP) == 1, '旧彩楼循环未唯一匹配'
src = src.replace(OLD_LOOP, NEW_LOOP)
print('OK   buildLakesideDecor 换成城堡')

src = src.replace(ANCHOR, CASTLE + '\n' + ANCHOR)
print('OK   城堡构建代码已插入')

io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('done  %d -> %d bytes' % (orig_len, len(src)))
