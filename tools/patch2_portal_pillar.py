# -*- coding: utf-8 -*-
"""补丁 2：赛博朋克传送门 + 隧道支撑柱阵 + 火车灯/车速 + 场景段长 3500m"""
import io, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'playable.html')
src = io.open(P, encoding='utf-8').read()
orig = len(src)


def rep(old, new, tag):
    global src
    n = src.count(old)
    assert n == 1, '[%s] 期望 1 次匹配，实际 %d 次' % (tag, n)
    src = src.replace(old, new)
    print('OK   ' + tag)


# ============================================================ ① 场景段长 3500m
rep("const SCENE_SEG_LEN = { lakeside: [1500, 1500], tunnel: [1500, 1500], city: [1500, 1500], campus: [1500, 1500] };  // 每段固定 1500 米（每 1500 米切换一次场景）",
    "// 每段固定 3500 米：跑满 3500 米才换一次场景（原来是 1500 米）\nconst SCENE_SEG_LEN = { lakeside: [3500, 3500], tunnel: [3500, 3500], city: [3500, 3500], campus: [3500, 3500] };",
    'SCENE_SEG_LEN → 3500 米')

rep("    segEnd: 450 + Math.random() * 350,   // 本段结束里程（到达后触发转场）",
    "    segEnd: SCENE_SEG_LEN.lakeside[0],   // 本段结束里程（首段同样是整段 3500 米）",
    '首段 segEnd → 3500 米')


# ============================================================ ② 支撑柱：数据与配置
rep("    hurdle:    { h1: 0.95, hw: 0.9 },",
    "    hurdle:     { h1: 0.95, hw: 0.9 },\n"
    "    // 隧道·支撑柱：从地面顶到拱顶，跳不过去也站不上，碰到就是死（deadly）\n"
    "    pillar:     { h1: 7.2, hw: 1.0, deadly: true, name: '支撑柱' },",
    'OBSTACLE_DEFS + pillar')

rep("    tunnel:   ['train', 'lowBar', 'highBar'],",
    "    tunnel:   ['train', 'lowBar', 'highBar', 'pillar'],",
    '隧道障碍集 + pillar')

rep("const sceneBarTypes = () => SCENE_OBSTACLES[Scene.id].filter(t => !OBSTACLE_DEFS[t].ride && t !== 'ramp');",
    "// 支撑柱由柱阵生成器专门摆放，不能混进普通栏杆池\n"
    "const sceneBarTypes = () => SCENE_OBSTACLES[Scene.id].filter(t =>\n"
    "    !OBSTACLE_DEFS[t].ride && !OBSTACLE_DEFS[t].deadly && t !== 'ramp');",
    'sceneBarTypes 排除 deadly')

# 纯数据（会被 Node 测试整段提取执行，只能有字面量）
rep("const SCENE_WEIGHTS = { lakeside: 0.25, tunnel: 0.15, city: 0.3, campus: 0.3 };",
    "const SCENE_WEIGHTS = { lakeside: 0.25, tunnel: 0.15, city: 0.3, campus: 0.3 };\n"
    "\n"
    "// ---- 隧道·支撑柱阵（一柱一柱排开，段与段之间留出能横切的间隙）----\n"
    "const PILLAR_STEP = 3.0;                 // 立柱间距（沿轨道，米）\n"
    "const PILLAR_CFG = {\n"
    "    cols: [6, 9],                        // 每段柱子几根立柱 → 段长 (cols-1)×3 = 15~24 米\n"
    "    gap: [20, 28],                       // 两段柱子之间的间隙：唯一的横切通道\n"
    "    span: [150, 220],                    // 单段柱阵覆盖的里程\n"
    "    cooldown: 320,                       // 两段柱阵之间至少空出的里程\n"
    "    firstAfter: 380,                     // 进隧道后至少跑这么远才会遇到柱阵\n"
    "    trainLead: [40, 110],                // 柱阵内那辆行驶火车的出现位置偏移\n"
    "};",
    'PILLAR_CFG 数据')

# ============================================================ ③ 赛博朋克传送门
rep("const PortalFX = { group: null, kind: null, next: null, armed: false };",
    "const PortalFX = { group: null, kind: null, next: null, armed: false, lastKind: null };\n"
    "// 传送门逐帧动画（霓虹呼吸 / 光环旋转 / 扫描线 / 碎片浮动）\n"
    "const PortalAnim = { t: 0, items: null };\n"
    "function updatePortalFX(dt) {\n"
    "    const it = PortalAnim.items;\n"
    "    if (!it) return;\n"
    "    PortalAnim.t += dt;\n"
    "    const t = PortalAnim.t;\n"
    "    for (const r of it.rings) r.mesh.rotation.z = r.spd * t + r.ph;\n"
    "    for (const p of it.pulse) p.mat.opacity = p.base * (0.72 + 0.28 * Math.sin(t * p.fr + p.ph));\n"
    "    if (it.scan) it.scan.map.offset.y = (t * 0.55) % 1;\n"
    "    if (it.core) it.core.material.opacity = 0.72 + 0.18 * Math.sin(t * 3.1);\n"
    "    for (const s of it.shards) {\n"
    "        s.mesh.position.y = s.y0 + Math.sin(t * s.fr + s.ph) * 0.55;\n"
    "        s.mesh.rotation.y = t * s.spd;\n"
    "        s.mesh.rotation.x = t * s.spd * 0.62;\n"
    "    }\n"
    "    for (const g of it.glitch) {\n"
    "        g.mesh.visible = Math.sin(t * g.fr + g.ph) > 0.62;\n"
    "        if (g.mesh.visible) g.mesh.material.opacity = 0.25 + 0.55 * Math.random();\n"
    "    }\n"
    "}\n"
    "function clearPortalAnim() { PortalAnim.t = 0; PortalAnim.items = null; }\n"
    "\n"
    "// ---- 赛博朋克传送门：霓虹门框 + 双层旋转光环 + 全息门面 + 扫描线 + 浮动碎片 ----\n"
    "let cyberCoreTex = null, cyberScanTex = null, cyberGlowTex = null;\n"
    "function cyberTextures() {\n"
    "    if (cyberCoreTex) return;\n"
    "    cyberCoreTex = makeTex(128, 128, (c, w, h) => {\n"
    "        const grd = c.createRadialGradient(w / 2, h / 2, 3, w / 2, h / 2, w * 0.52);\n"
    "        grd.addColorStop(0, '#ffffff');\n"
    "        grd.addColorStop(0.22, '#9df6ff');\n"
    "        grd.addColorStop(0.48, '#2f7bff');\n"
    "        grd.addColorStop(0.74, '#9c1dff');\n"
    "        grd.addColorStop(1, 'rgba(14,0,34,0.92)');\n"
    "        c.fillStyle = grd; c.fillRect(0, 0, w, h);\n"
    "    }, 1, 1);\n"
    "    cyberScanTex = makeTex(64, 256, (c, w, h) => {\n"
    "        c.clearRect(0, 0, w, h);\n"
    "        for (let y = 0; y < h; y += 6) {\n"
    "            c.fillStyle = 'rgba(150,244,255,' + (y % 12 ? 0.05 : 0.2) + ')';\n"
    "            c.fillRect(0, y, w, 2);\n"
    "        }\n"
    "        for (let i = 0; i < 26; i++) {\n"
    "            c.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '255,90,205' : '120,240,255') + ',' + rand(0.05, 0.22) + ')';\n"
    "            c.fillRect(rand(0, w), rand(0, h), rand(6, 26), rand(1, 3));\n"
    "        }\n"
    "    }, 1, 2);\n"
    "    cyberGlowTex = makeTex(64, 64, (c, w, h) => {\n"
    "        const grd = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);\n"
    "        grd.addColorStop(0, 'rgba(255,255,255,0.95)');\n"
    "        grd.addColorStop(0.35, 'rgba(150,240,255,0.45)');\n"
    "        grd.addColorStop(1, 'rgba(120,200,255,0)');\n"
    "        c.fillStyle = grd; c.fillRect(0, 0, w, h);\n"
    "    }, 1, 1);\n"
    "}",
    'PortalFX + 传送门动画')

# 门体构建：在 makeTransitPortal 前插入 cyber 版本
rep("function makeTransitPortal(kind) {\n    const R = TUNNEL_R;",
    "// 赛博朋克传送门：城市 → 校园的专用入口\n"
    "function makeCyberPortal() {\n"
    "    cyberTextures();\n"
    "    const g = new THREE.Group();\n"
    "    const W = 18, H = 17;                 // 门面尺寸（跑到跟前时糊满画面）\n"
    "    const neonCyan = new THREE.MeshBasicMaterial({ color: 0x35f0ff, fog: false });\n"
    "    const neonPink = new THREE.MeshBasicMaterial({ color: 0xff35c8, fog: false });\n"
    "    const neonViolet = new THREE.MeshBasicMaterial({ color: 0x9a5bff, fog: false });\n"
    "    const frameMat = std(0x14161d, { roughness: 0.35, metalness: 0.85 });\n"
    "    const pulse = [];\n"
    "    const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); g.add(mesh); return mesh; };\n"
    "\n"
    "    // ① 门面：全息核心 + 扫描线层\n"
    "    const core = add(new THREE.Mesh(new THREE.PlaneGeometry(W, H),\n"
    "        new THREE.MeshBasicMaterial({ map: cyberCoreTex, transparent: true, opacity: 0.82,\n"
    "            blending: THREE.AdditiveBlending, depthWrite: false, fog: false })), 0, H / 2, -1.2);\n"
    "    const scanTex = cyberScanTex.clone();\n"
    "    scanTex.userData.shared = false;\n"
    "    scanTex.wrapS = scanTex.wrapT = THREE.RepeatWrapping;\n"
    "    scanTex.needsUpdate = true;\n"
    "    const scanMat = new THREE.MeshBasicMaterial({ map: scanTex, transparent: true, opacity: 0.7,\n"
    "        blending: THREE.AdditiveBlending, depthWrite: false, fog: false });\n"
    "    add(new THREE.Mesh(new THREE.PlaneGeometry(W, H), scanMat), 0, H / 2, -0.9);\n"
    "\n"
    "    // ② 门框：两根立柱 + 门楣 + 底座（黑金属 + 霓虹内嵌条）\n"
    "    for (const s of [-1, 1]) {\n"
    "        add(new THREE.Mesh(new THREE.BoxGeometry(1.3, H + 2.4, 1.6), frameMat), s * (W / 2 + 0.8), (H + 2.4) / 2, 0);\n"
    "        add(new THREE.Mesh(new THREE.BoxGeometry(0.22, H - 1.2, 0.22), s < 0 ? neonCyan : neonPink), s * (W / 2 + 0.12), H / 2, 0.3);\n"
    "        add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 3.4), frameMat), s * (W / 2 + 0.8), 0.25, 0);\n"
    "        add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 0.5), neonViolet), s * (W / 2 + 0.8), 0.55, 1.4);\n"
    "        for (let k = 0; k < 5; k++) {     // 立柱上的故障灯块\n"
    "            add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.32), k % 2 ? neonPink : neonCyan),\n"
    "                s * (W / 2 + 1.5), 3.0 + k * 2.6, 0.5);\n"
    "        }\n"
    "    }\n"
    "    add(new THREE.Mesh(new THREE.BoxGeometry(W + 3.4, 1.6, 1.8), frameMat), 0, H + 1.6, 0);\n"
    "    add(new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 0.2, 0.24), neonCyan), 0, H + 0.9, 0.5);\n"
    "    add(new THREE.Mesh(new THREE.BoxGeometry(W - 2.0, 0.14, 0.24), neonPink), 0, H + 2.3, 0.5);\n"
    "\n"
    "    // ③ 双层旋转光环：反向转，像正在充能的传送装置\n"
    "    const rings = [];\n"
    "    for (const [rad, tube, mat, seg, spd] of [[7.6, 0.16, neonCyan, 44, 0.9], [6.1, 0.11, neonPink, 36, -1.35]]) {\n"
    "        const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, tube, 8, seg), mat);\n"
    "        ring.position.set(0, H / 2, 0.35);\n"
    "        g.add(ring);\n"
    "        rings.push({ mesh: ring, spd, ph: rand(0, 6.28) });\n"
    "    }\n"
    "    // 环上挂几颗光点\n"
    "    for (let i = 0; i < 8; i++) {\n"
    "        const a = i * Math.PI / 4;\n"
    "        const dot = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6),\n"
    "            new THREE.MeshBasicMaterial({ map: cyberGlowTex, transparent: true, opacity: 0.75,\n"
    "                blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));\n"
    "        dot.position.set(Math.cos(a) * 7.6, H / 2 + Math.sin(a) * 7.6, 0.5);\n"
    "        g.add(dot);\n"
    "    }\n"
    "\n"
    "    // ④ 浮动碎片 + 门面故障条\n"
    "    const shards = [];\n"
    "    for (let i = 0; i < 12; i++) {\n"
    "        const s = rand(0.35, 1.1);\n"
    "        const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * rand(0.5, 1.6), s * 0.25),\n"
    "            i % 3 === 0 ? neonPink : (i % 3 === 1 ? neonCyan : neonViolet));\n"
    "        const x = rand(-W * 0.62, W * 0.62), y = rand(1.5, H - 1.0);\n"
    "        m.position.set(x, y, rand(-0.4, 1.6));\n"
    "        g.add(m);\n"
    "        shards.push({ mesh: m, y0: y, fr: rand(0.5, 1.5), ph: rand(0, 6.28), spd: rand(0.3, 1.1) * (Math.random() < 0.5 ? 1 : -1) });\n"
    "    }\n"
    "    const glitch = [];\n"
    "    for (let i = 0; i < 6; i++) {\n"
    "        const wBar = rand(2.5, W * 0.85);\n"
    "        const mat = new THREE.MeshBasicMaterial({ color: i % 2 ? 0x9df6ff : 0xff5ad0, transparent: true,\n"
    "            opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });\n"
    "        const m = new THREE.Mesh(new THREE.PlaneGeometry(wBar, rand(0.12, 0.4)), mat);\n"
    "        m.position.set(rand(-W * 0.2, W * 0.2), rand(2, H - 1), 0.1);\n"
    "        g.add(m);\n"
    "        glitch.push({ mesh: m, fr: rand(2.5, 7), ph: rand(0, 6.28) });\n"
    "    }\n"
    "\n"
    "    // ⑤ 地面导流线：从远处一路亮进门里\n"
    "    for (const s of [-1, 1]) {\n"
    "        add(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 26), s < 0 ? neonCyan : neonPink).rotateX(-Math.PI / 2),\n"
    "            s * 3.0, 0.06, 12);\n"
    "    }\n"
    "\n"
    "    for (const p of [core]) pulse.push({ mat: p.material, base: 0.82, fr: 2.4, ph: 0 });\n"
    "    PortalAnim.t = 0;\n"
    "    PortalAnim.items = { rings, pulse, shards, glitch, scan: scanTex, core };\n"
    "    return g;\n"
    "}\n"
    "\n"
    "function makeTransitPortal(kind) {\n"
    "    if (kind === 'cyber') return makeCyberPortal();\n"
    "    const R = TUNNEL_R;",
    '赛博朋克传送门构建')

# 提前布置：城市 → 校园时也提前摆出传送门
rep("            if (Scene.next === 'tunnel') spawnPortalPreview('in', Scene.next);\n"
    "            else if (Scene.id === 'tunnel') spawnPortalPreview('out', Scene.next);",
    "            if (Scene.next === 'tunnel') spawnPortalPreview('in', Scene.next);\n"
    "            else if (Scene.id === 'tunnel') spawnPortalPreview('out', Scene.next);\n"
    "            // 城市 → 校园：走赛博朋克传送门，而不是黑场\n"
    "            else if (Scene.id === 'city' && Scene.next === 'campus') spawnPortalPreview('cyber', Scene.next);",
    '城市→校园 提前摆传送门')

rep("function spawnPortalPreview(kind, next) {\n    PortalFX.kind = kind;",
    "function spawnPortalPreview(kind, next) {\n    PortalAnim.items = null;\n    PortalFX.kind = kind;",
    'spawnPortalPreview 清动画')

# 过场的压黑/压亮颜色 + 换场后闪白
rep("        if (!PortalFX.armed && g.position.z >= PORTAL_CFG.fadeLeadZ) {\n"
    "            PortalFX.armed = true;\n"
    "            setFade(1, 0.22, PortalFX.kind === 'out' ? '#fff' : '#000');\n"
    "        }",
    "        if (!PortalFX.armed && g.position.z >= PORTAL_CFG.fadeLeadZ) {\n"
    "            PortalFX.armed = true;\n"
    "            const c = PortalFX.kind === 'out' ? '#fff' : (PortalFX.kind === 'cyber' ? '#120a2e' : '#000');\n"
    "            setFade(1, 0.22, c);\n"
    "        }",
    '过场覆盖色（cyber 紫黑）')

rep("function finishPortal() {\n"
    "    const next = PortalFX.next;\n"
    "    if (!PortalFX.armed) setFade(1, 0.01, next === 'tunnel' ? '#000' : '#fff');\n"
    "    PortalFX.group = null; PortalFX.kind = null; PortalFX.next = null;\n"
    "    swapTo(next);\n"
    "}",
    "function finishPortal() {\n"
    "    const next = PortalFX.next;\n"
    "    if (!PortalFX.armed) setFade(1, 0.01, next === 'tunnel' ? '#000' : '#fff');\n"
    "    PortalFX.lastKind = PortalFX.kind;\n"
    "    PortalFX.group = null; PortalFX.kind = null; PortalFX.next = null;\n"
    "    clearPortalAnim();\n"
    "    swapTo(next);\n"
    "}",
    'finishPortal 记录 kind + 清动画')

rep("    Scene.flash = prev === 'tunnel';                 // 出隧道给一段过曝亮光",
    "    Scene.flash = prev === 'tunnel' || PortalFX.lastKind === 'cyber';   // 出隧道 / 穿传送门都过曝一下\n"
    "    PortalFX.lastKind = null;",
    'swapTo 闪白条件')

rep("    showMsg(next === 'tunnel' ? '驶入隧道，注意灯光！' : '抵达：' + THEMES[next].name);",
    "    showMsg(next === 'tunnel' ? '驶入隧道，注意支撑柱！' : '抵达：' + THEMES[next].name);",
    '进隧道提示文案')

rep("function clearPortalFX() {\n"
    "    PortalFX.group = null; PortalFX.kind = null; PortalFX.next = null; PortalFX.armed = false;\n"
    "    Scene.fadeNext = null;\n"
    "}",
    "function clearPortalFX() {\n"
    "    PortalFX.group = null; PortalFX.kind = null; PortalFX.next = null; PortalFX.armed = false;\n"
    "    PortalFX.lastKind = null;\n"
    "    Scene.fadeNext = null;\n"
    "    clearPortalAnim();\n"
    "}",
    'clearPortalFX 清动画')

# ============================================================ ④ 主循环驱动传送门动画
rep("    updateCamera(dt);\n    ATMO.update(dt);",
    "    updatePortalFX(dt);\n    updateCamera(dt);\n    ATMO.update(dt);",
    '主循环驱动传送门动画')

io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('done %d -> %d bytes' % (orig, len(src)))
