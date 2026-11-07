# -*- coding: utf-8 -*-
"""
patch16_citylights.py —— 城市夜景立面灯效重做（改 js/oldtown.js，幂等）

原来整条街只有两张随机窗格贴图（暖黄 / 冷白），所有楼共用，
夜里看起来就是「一模一样的黄色噪点」。现在按真实建筑照明的分层做法
（地埋灯 / 裙楼内光外透、线形 LED 楼层带、窄光竖向鳍、投光灯照冠部、
泛光随高度衰减、窗洞按整层成带点亮）做 8 套色温与节奏各异的立面档案，
按塔位确定性分配，让未来之城有冷暖对比和可读的层次。

参考（2026-11-05 检索）：
  · 云知光《城市灯光秀：建筑媒体立面的表达形式》—— 内光外透 / 条带型立面 / 水平线形照明 / 垂直分隔窄光
  · 上观新闻《外滩"高光10秒"》—— 高区/中区/低区分组点亮、地埋灯+洗墙灯+投光灯、2200K 暖调
  · GDC22《Cyberpunk 2077: Bringing light to Night City》—— 有组织的 layering、控制视觉噪点、霓虹管光与体积雾

改完要跑：
    "D:/PythonAPPS/python386/python.exe" tools/patch10_inline.py oldtown atmo
"""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'js', 'oldtown.js')
s = io.open(SRC, encoding='utf-8', newline='').read()
orig = len(s)
notes = []


def rep(old, new, note):
    global s
    assert s.count(old) == 1, '锚点异常（%d 次）：%s' % (s.count(old), note)
    s = s.replace(old, new, 1)
    notes.append(note)
    print('  [OK] ' + note)


MARK = '// ==== CITYLIGHTS-BEGIN（tools/patch16_citylights.py 生成，勿手改）===='
END = '// ==== CITYLIGHTS-END ===='

FACADE = r"""// ==== CITYLIGHTS-BEGIN（tools/patch16_citylights.py 生成，勿手改）====
    // 幕墙窗格：一格约 3.2m 宽 × 3.4m 高，6 列 × 12 行 = 19.2m × 40.8m
    const TEX_W = 19.2, TEX_H = 40.8;
    const WIN_COLS = 6, WIN_ROWS = 12;

    // 贴图生成用的可复现伪随机：不能用 Math.random，否则每次刷新整条街的灯都换一遍
    function rngOf(seed) {
        let s = seed >>> 0;
        return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    }

    // -----------------------------------------------------------------
    //  夜景立面照明档案
    //  现实里的楼不是「一整面随机亮点」：底部有地埋灯 / 裙楼内透，
    //  楼层之间有线形 LED，竖向上有窄光鳍，冠部被投光灯打亮，
    //  亮度随高度衰减；办公室是「几层亮、几层暗」的整层节奏。
    //  八套档案的色温（2200K 暖金 → 6500K 冷白 → 青/洋红/薄荷媒体立面）、
    //  亮层节奏、竖向鳍和冠部处理各不相同，整条街不再千楼一面。
    // -----------------------------------------------------------------
    const FACADE_PROFILES = [
        // key      窗光 RGB        强调色         emissive 暖/冷      12 层亮暗(上→下)  亮间率 水平带 竖鳍 冠部    衰减  夜增益
        { key:'amber',   lit:'255,196,120', accent:'255,152,72',  emW:0xffb060, emC:0xffd9a0, floors:'011011101101', bay:0.86, band:0, fins:0, crown:'lit',  dusk:0.30, glow:0.62, pulse:0.00 },
        { key:'ice',     lit:'206,236,255', accent:'150,225,255', emW:0xbfe9ff, emC:0x8fd4ff, floors:'010010010010', bay:0.72, band:3, fins:0, crown:'dark', dusk:0.18, glow:0.58, pulse:0.00 },
        { key:'cyan',    lit:'120,232,255', accent:'0,234,255',   emW:0x35d9ff, emC:0x9af2ff, floors:'001001001001', bay:0.55, band:2, fins:2, crown:'lit',  dusk:0.42, glow:0.74, pulse:0.16 },
        { key:'magenta', lit:'255,140,205', accent:'255,45,146',  emW:0xff5ab4, emC:0xffa8dc, floors:'010010100101', bay:0.62, band:0, fins:3, crown:'lit',  dusk:0.34, glow:0.70, pulse:0.13 },
        { key:'mint',    lit:'170,255,220', accent:'90,255,170',  emW:0x5affb0, emC:0xc4ffe4, floors:'101101011011', bay:0.78, band:4, fins:0, crown:'dark', dusk:0.22, glow:0.60, pulse:0.00 },
        { key:'violet',  lit:'188,168,255', accent:'164,87,255',  emW:0xa457ff, emC:0xd0bcff, floors:'010100101010', bay:0.66, band:3, fins:0, crown:'lit',  dusk:0.52, glow:0.66, pulse:0.10 },
        { key:'home',    lit:'255,208,150', accent:'255,170,90',  emW:0xffc078, emC:0xffe0b0, floors:'101001010010', bay:0.42, band:0, fins:0, crown:'dark', dusk:0.12, glow:0.48, pulse:0.00 },
        { key:'dual',    lit:'150,226,255', accent:'255,120,200', emW:0xff78c8, emC:0x96e2ff, floors:'110110001101', bay:0.80, band:4, fins:3, crown:'lit',  dusk:0.26, glow:0.72, pulse:0.12 },
    ];

    /** 一张立面窗光贴图：按「层」组织，不撒噪点 */
    function makeFacadeTex(p, seed, skyMode) {
        const W = 128, H = 256;
        return makeTex(W, H, (c, w, h) => {
            const r = rngOf(seed);
            c.fillStyle = skyMode ? '#070b16' : '#0a1120';
            c.fillRect(0, 0, w, h);
            const cw = w / WIN_COLS, ch = h / WIN_ROWS;
            for (let row = 0; row < WIN_ROWS; row++) {
                const y = row * ch;
                // 泛光照明随高度衰减：越靠上越暗
                const up = 1 - p.dusk * (row / (WIN_ROWS - 1));
                const lit = p.floors[row] === '1';
                for (let col = 0; col < WIN_COLS; col++) {
                    const x = col * cw;
                    if (skyMode) {
                        c.fillStyle = '#0a1220';
                        c.fillRect(x + 1, y + 2, cw - 2, ch - 3);
                    } else {
                        const g = c.createLinearGradient(0, y, 0, y + ch);
                        g.addColorStop(0, 'rgb(38,56,80)');
                        g.addColorStop(1, 'rgb(14,23,37)');
                        c.fillStyle = g;
                        c.fillRect(x + 1, y + 2, cw - 2, ch - 3);
                    }
                    if (row >= WIN_ROWS - 2) {
                        // 裙楼：地埋灯 + 大堂/商铺内光外透，连成一条暖光带
                        const pg = c.createLinearGradient(0, y, 0, y + ch);
                        pg.addColorStop(0, 'rgba(' + p.lit + ',' + (0.88 * up).toFixed(2) + ')');
                        pg.addColorStop(1, 'rgba(' + p.lit + ',0.34)');
                        c.fillStyle = pg;
                        c.fillRect(x + 2, y + 3, cw - 4, ch - 6);
                        c.fillStyle = 'rgba(6,10,18,0.55)';   // 柱间暗缝，留住开间节奏
                        c.fillRect(x + cw - 2, y + 3, 1.5, ch - 6);
                    } else if (row === 0 && p.crown === 'lit') {
                        // 投光灯照亮的冠部：一条压顶亮带
                        c.fillStyle = 'rgba(' + p.accent + ',0.82)';
                        c.fillRect(x + 2, y + 4, cw - 4, ch * 0.40);
                    } else if (row === 0 && p.crown === 'dark') {
                        // 设备层基本全暗，只留零星值班灯
                        if (r() < 0.28) {
                            c.fillStyle = 'rgba(' + p.lit + ',0.52)';
                            c.fillRect(x + 3, y + 5, cw * 0.38, ch * 0.32);
                        }
                    } else if (lit && r() < p.bay) {
                        const a = (0.55 + r() * 0.45) * up;
                        c.fillStyle = 'rgba(' + p.lit + ',' + a.toFixed(3) + ')';
                        c.fillRect(x + 2, y + 3, cw - 4, ch - 6);
                        if (r() < 0.42) {          // 窗帘 / 内景暗块，避免每格一样亮
                            c.fillStyle = 'rgba(5,9,16,' + (0.25 + r() * 0.35).toFixed(2) + ')';
                            c.fillRect(x + 2, y + 3, cw - 4, (ch - 6) * (0.25 + r() * 0.4));
                        }
                    }
                    c.fillStyle = 'rgba(180,215,255,0.06)';
                    c.fillRect(x + 1, y + 2, cw - 2, 1);
                }
                // 水平线形 LED：强化楼层分隔（真实条带型立面常用做法）
                if (p.band && row > 0 && row < WIN_ROWS - 2 && row % p.band === 0) {
                    c.fillStyle = 'rgba(' + p.accent + ',0.18)';
                    c.fillRect(0, y - 2, w, 5);
                    c.fillStyle = 'rgba(' + p.accent + ',0.80)';
                    c.fillRect(0, y, w, 1.6);
                }
                if (skyMode && lit) {
                    c.fillStyle = 'rgba(' + p.lit + ',0.16)';
                    c.fillRect(0, y + ch - 3, w, 2);
                }
            }
            // 竖向窄光鳍（媒体立面 / 垂直分隔立面的窄光投射）：下亮上暗
            if (p.fins) {
                for (let k = 0; k <= WIN_COLS; k += p.fins) {
                    const g = c.createLinearGradient(0, 0, 0, h);
                    g.addColorStop(0, 'rgba(' + p.accent + ',0.10)');
                    g.addColorStop(1, 'rgba(' + p.accent + ',0.88)');
                    c.fillStyle = g;
                    c.fillRect(k * cw - 1, 0, 2.2, h);
                }
            }
            // 铝框 / 楼层横缝
            for (let k = 0; k <= WIN_COLS; k++) { c.fillStyle = 'rgba(120,150,180,0.10)'; c.fillRect(k * cw - 0.7, 0, 1.4, h); }
            for (let k = 0; k <= WIN_ROWS; k++) { c.fillStyle = 'rgba(0,0,0,0.42)'; c.fillRect(0, k * ch - 0.7, w, 1.4); }
        });
    }

    /** 街面橱窗：四种开间（亮橱窗 / 卷帘门 / 全息屏 / 暗门洞），颜色随档案走 */
    function makeShopTex(p, seed) {
        const r = rngOf(seed);
        // 实际 256×128，按 512×256 坐标绘制（8 张共 1MB 显存，视觉不变）
        return makeTex(256, 128, (c, _w, _h) => {
            c.save(); c.scale(0.5, 0.5);
            const w = 512, h = 256;
            c.fillStyle = '#080d16'; c.fillRect(0, 0, w, h);
            const bays = 4, bw = w / bays;
            for (let i = 0; i < bays; i++) {
                const x = i * bw;
                c.fillStyle = '#111a26'; c.fillRect(x + 5, 8, bw - 10, h - 16);
                const kind = (i + seed) % 4;
                if (kind === 0) {
                    // 亮橱窗：光从门楣往下衰减（内光外透）
                    const g = c.createLinearGradient(0, 16, 0, h - 22);
                    g.addColorStop(0, 'rgba(' + p.lit + ',0.92)');
                    g.addColorStop(0.55, 'rgba(' + p.lit + ',0.55)');
                    g.addColorStop(1, 'rgba(' + p.lit + ',0.18)');
                    c.fillStyle = g; c.fillRect(x + 14, 16, bw - 28, h - 38);
                    for (let k = 0; k < 5; k++) {
                        c.fillStyle = 'rgba(8,12,20,' + (0.25 + r() * 0.35).toFixed(2) + ')';
                        c.fillRect(x + 24 + k * (bw - 70) / 5, 45 + r() * 90, 10 + r() * 16, 18 + r() * 40);
                    }
                } else if (kind === 1) {
                    // 卷帘门：横向条纹 + 冷光缝隙
                    for (let y = 20; y < h - 24; y += 7) {
                        c.fillStyle = 'rgba(60,76,96,0.55)';
                        c.fillRect(x + 14, y, bw - 28, 3);
                    }
                    c.fillStyle = 'rgba(' + p.accent + ',0.55)';
                    c.fillRect(x + 14, 20, bw - 28, 2);
                } else if (kind === 2) {
                    // 全息橱窗：横向色带 + 扫描线
                    const g = c.createLinearGradient(x + 14, 0, x + bw - 14, 0);
                    g.addColorStop(0, 'rgba(' + p.accent + ',0.20)');
                    g.addColorStop(0.5, 'rgba(' + p.accent + ',0.72)');
                    g.addColorStop(1, 'rgba(' + p.lit + ',0.35)');
                    c.fillStyle = g; c.fillRect(x + 14, 18, bw - 28, h - 40);
                    c.fillStyle = 'rgba(255,255,255,0.10)';
                    for (let y = 24; y < h - 26; y += 5) c.fillRect(x + 14, y, bw - 28, 1);
                } else {
                    // 暗门洞 + 门框灯
                    c.fillStyle = '#060a12'; c.fillRect(x + 20, 24, bw - 40, h - 48);
                    c.fillStyle = 'rgba(' + p.accent + ',0.62)';
                    c.fillRect(x + 20, 24, bw - 40, 3);
                    c.fillRect(x + 20, 24, 2.5, h - 48);
                    c.fillRect(x + bw - 22.5, 24, 2.5, h - 48);
                }
                // 门楣霓虹条：每间按档案配色，街面不再一片同款暖黄
                c.fillStyle = 'rgba(' + (i % 2 ? p.accent : p.lit) + ',0.88)';
                c.fillRect(x + 10, 5, bw - 20, 4);
            }
            c.restore();
        });
    }

    // 8 套共享材质池（不能 per-building clone，否则静态合并会失效）
    const FACADE_POOL = FACADE_PROFILES.map((p, i) => {
        const winTex = shared(makeFacadeTex(p, 1000 + i * 37, false));
        const skyTex = shared(makeFacadeTex(p, 5000 + i * 53, true));
        const warm = shared(std(0x16202c, {
            name: 'facadeWarm-' + p.key, map: winTex,
            emissive: p.emW, emissiveMap: winTex, emissiveIntensity: 0.1,
            roughness: 0.5, metalness: 0.25,
        }));
        const cool = shared(std(0x131d2a, {
            name: 'facadeCool-' + p.key, map: winTex,
            emissive: p.emC, emissiveMap: winTex, emissiveIntensity: 0.09,
            roughness: 0.42, metalness: 0.35,
        }));
        const skyA = shared(std(0x0b1322, {
            name: 'skylineA-' + p.key, map: skyTex,
            emissive: p.emW, emissiveMap: skyTex, emissiveIntensity: 0.4, roughness: 0.85,
        }));
        const skyB = shared(std(0x101525, {
            name: 'skylineB-' + p.key, map: skyTex,
            emissive: p.emC, emissiveMap: skyTex, emissiveIntensity: 0.36, roughness: 0.85,
        }));
        const shopTex = shared(makeShopTex(p, 9000 + i * 71));
        const shop = shared(std(0x121a24, {
            name: 'shop-' + p.key, map: shopTex,
            emissive: p.emW, emissiveMap: shopTex, emissiveIntensity: 0.06, roughness: 0.55,
        }));
        // 夜里分三档亮：裙楼/街面最亮、塔身窗次之、楼体轮廓收敛
        ATMO.registerGlow(warm, { base: 0.12, gain: p.glow, pulse: p.pulse, phase: i * 0.8 });
        ATMO.registerGlow(cool, { base: 0.10, gain: p.glow * 0.9, pulse: p.pulse, phase: i * 0.8 + 1.6 });
        ATMO.registerGlow(skyA, { base: 0.38, gain: 1.25, pulse: p.pulse * 0.6, phase: i * 0.5 });
        ATMO.registerGlow(skyB, { base: 0.34, gain: 1.18, pulse: p.pulse * 0.6, phase: i * 0.5 + 2.1 });
        ATMO.registerGlow(shop, { base: 0.08, gain: 0.62 });   // L0 街面橱窗，最亮的一层
        return { p, winTex, skyTex, warm, cool, skyA, skyB, shop };
    });

    // 当前正在搭的楼用哪套灯：塔体 / 地标 / 背景塔 / 远景天际线各自切换，
    // 所有引用这些变量的建模函数都是「调用时取值」，所以能动态换材质。
    let twrWinWarm = FACADE_POOL[0].warm;
    let twrWinCool = FACADE_POOL[0].cool;
    let towerMatA = FACADE_POOL[0].skyA;
    let towerMatB = FACADE_POOL[0].skyB;
    let twrShop = FACADE_POOL[0].shop;
    function setFacade(i) {
        const n = FACADE_POOL.length;
        const f = FACADE_POOL[((i % n) + n) % n];
        twrWinWarm = f.warm; twrWinCool = f.cool;
        towerMatA = f.skyA; towerMatB = f.skyB;
        twrShop = f.shop;
    }
// ==== CITYLIGHTS-END ====

"""

if MARK in s:
    a = s.index(MARK)
    b = s.index(END) + len(END) + 1
    s = s[:a] + FACADE + s[b:]
    notes.append('立面档案块（已替换）')
else:
    a = s.index('    // 幕墙窗格：')
    b = s.index('    // 人行道石板', a)
    s = s[:a] + FACADE + s[b:]
    notes.append('插入 8 套立面照明档案')

# ---- 删掉旧的单张天际线噪点贴图 -------------------------------------
OLD_SKY_START = '    // 天际线窗光：'
if OLD_SKY_START in s:
    a = s.index(OLD_SKY_START)
    b = s.index('    // -----------------------------------------------------------------\n    //  材质（共享池）', a)
    s = s[:a] + "    // 天际线窗光已改为 CITYLIGHTS 的 8 套分层立面贴图（见上方 FACADE_POOL）\n\n" + s[b:]
    notes.append('移除旧的单张黄色噪点贴图')

# ---- 删掉旧的 twrWinWarm / twrWinCool 定义 ---------------------------
OLD_W = """    const twrWinWarm = shared(std(0x1a2431, {
        map: winWarmTex, emissive: 0xffd68c, emissiveMap: winWarmTex,
        emissiveIntensity: 0.1, roughness: 0.5, metalness: 0.25,
    }));
    const twrWinCool = shared(std(0x16202c, {
        map: winCoolTex, emissive: 0xbfe9ff, emissiveMap: winCoolTex,
        emissiveIntensity: 0.08, roughness: 0.42, metalness: 0.35,
    }));
"""
if OLD_W in s:
    s = s.replace(OLD_W, '', 1)
    notes.append('移除旧的 warm/cool 单一窗光材质')

OLD_AB = """    const towerMatA = shared(std(0x0c1524, { map: towerWinTex, emissive: 0x4a7fb0, emissiveMap: towerWinTex, emissiveIntensity: 0.5, roughness: 0.85 }));
    const towerMatB = shared(std(0x121a2a, { map: towerWinTex, emissive: 0xb05a8a, emissiveMap: towerWinTex, emissiveIntensity: 0.45, roughness: 0.85 }));
"""
if OLD_AB in s:
    s = s.replace(OLD_AB, '', 1)
    notes.append('移除旧的远景天际线材质')

# ---- 注册 glow 的旧行删掉（新材质池已自行注册） ----------------------
for line in [
    "    ATMO.registerGlow(twrWinWarm, { base: 0.12, gain: 0.62 });   // L2 裙楼窗（暖）\n",
    "    ATMO.registerGlow(twrWinCool, { base: 0.10, gain: 0.56 });   // L3 塔身窗（冷）\n",
    "    ATMO.registerGlow(towerMatA, { base: 0.4, gain: 1.3 });\n",
    "    ATMO.registerGlow(towerMatB, { base: 0.36, gain: 1.3 });\n",
]:
    if line in s:
        s = s.replace(line, '', 1)
notes.append('清理旧的 glow 注册')

# ---- 删掉旧的「四间一样」的街面橱窗贴图 / 材质 / glow ------------------
OLD_SHOP_TEX = '    // 街面店招：4 个开间'
if OLD_SHOP_TEX in s:
    a = s.index(OLD_SHOP_TEX)
    b = s.index('    // 柔和光斑', a)
    s = s[:a] + "    // 街面橱窗已改为 CITYLIGHTS 的 8 套配色（见 makeShopTex）\n\n" + s[b:]
    notes.append('移除旧的同款暖黄橱窗贴图')

OLD_SHOP_MAT = """    // 街面橱窗：0.7~3.5m 的店招带，夜里最多 0.16（低于车道线 0.82）
    const twrShop = shared(std(0x121a24, {
        map: shopfrontTex, emissive: 0xffd0a0, emissiveMap: shopfrontTex,
        emissiveIntensity: 0.06, roughness: 0.55,
    }));
"""
if OLD_SHOP_MAT in s:
    s = s.replace(OLD_SHOP_MAT, '', 1)
    notes.append('移除旧的单一橱窗材质')
for line in [
    "    ATMO.registerGlow(twrShop, { base: 0.08, gain: 0.72 });      // L0 橱窗，最亮\n",
]:
    if line in s:
        s = s.replace(line, '', 1)

# ---- 按塔位切档案 -----------------------------------------------------
if 'setFacade((slot || 0) * 3' not in s:
    rep(
        """    function makeTower(side, family, hMul) {
        const g = new THREE.Group();""",
        """    function makeTower(side, family, hMul, slot) {
        // 相邻塔位用不同档案：同侧隔 3 套，双侧错开，避免左右镜像成同一款
        setFacade((slot || 0) * 3 + (side > 0 ? 5 : 0) + family.charCodeAt(0));
        const g = new THREE.Group();""",
        'makeTower 按塔位切灯效档案')

    rep(
        """    function makeLandmark(side, kind) {
        const g = new THREE.Group();""",
        """    function makeLandmark(side, kind) {
        setFacade(kind.length * 7 + (side > 0 ? 3 : 0));
        const g = new THREE.Group();""",
        '地标回退模型也切档案')

    rep(
        """    function backTower(side, i) {
        const g = new THREE.Group();""",
        """    function backTower(side, i) {
        setFacade(i * 5 + 2);
        const g = new THREE.Group();""",
        '二排背景塔切档案')

    rep(
        """                const w = rand(12, 26), h = rand(26, 62) - layer * 6;
                const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, 9), layer ? towerMatB : towerMatA);""",
        """                const w = rand(12, 26), h = rand(26, 62) - layer * 6;
                setFacade(i * 3 + layer * 4 + 1);
                const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, 9), layer ? towerMatB : towerMatA);""",
        '远景天际线逐栋切档案')

    rep(
        """            addScenery(lmL ? makeLandmark(-1, lmL) : makeTower(-1, planL[s], neighborHMul(LM_LEFT, s)), z);
            addScenery(lmR ? makeLandmark(1, lmR) : makeTower(1, planR[s], neighborHMul(LM_RIGHT, s)), z);""",
        """            addScenery(lmL ? makeLandmark(-1, lmL) : makeTower(-1, planL[s], neighborHMul(LM_LEFT, s), s), z);
            addScenery(lmR ? makeLandmark(1, lmR) : makeTower(1, planR[s], neighborHMul(LM_RIGHT, s), s), z);""",
        'buildDecor 传塔位序号')

io.open(SRC, 'w', encoding='utf-8', newline='').write(s)
print('')
print('js/oldtown.js %d -> %d 字符（%+d）' % (orig, len(s), len(s) - orig))
