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
export function createOldTown({
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
