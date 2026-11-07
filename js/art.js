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
export function createArtKit(ctx) {
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
