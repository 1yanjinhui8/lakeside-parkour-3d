# -*- coding: utf-8 -*-
"""补丁 3：隧道支撑柱阵生成 + 撞柱即死 + 火车灯更亮 + 车速随玩家提速"""
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


# ============================================================ ① 火车灯更亮
rep("const headlightMat = shared(std(0xffffaa, { emissive: 0xffff88, emissiveIntensity: 2 }));",
    "// 前照灯：材质自发光拉高 + 加色光晕面片 + 锥形光柱，隧道里一眼就能看见\n"
    "const headlightMat = shared(std(0xfffbe6, { emissive: 0xfff3b0, emissiveIntensity: 5.2 }));\n"
    "const headGlowTex = makeTex(64, 64, (c, w, h) => {\n"
    "    const grd = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);\n"
    "    grd.addColorStop(0, 'rgba(255,255,255,1)');\n"
    "    grd.addColorStop(0.3, 'rgba(255,246,205,0.55)');\n"
    "    grd.addColorStop(0.62, 'rgba(255,232,160,0.16)');\n"
    "    grd.addColorStop(1, 'rgba(255,225,150,0)');\n"
    "    c.fillStyle = grd; c.fillRect(0, 0, w, h);\n"
    "});\n"
    "const headGlowMat = shared(new THREE.MeshBasicMaterial({\n"
    "    map: headGlowTex, transparent: true, opacity: 0.95,\n"
    "    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,\n"
    "}));\n"
    "const headBeamMat = shared(new THREE.MeshBasicMaterial({\n"
    "    color: 0xfff4c8, transparent: true, opacity: 0.085,\n"
    "    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,\n"
    "}));",
    'headlightMat 变亮 + 光晕/光柱材质')

rep("    if (oncoming) {\n"
    "        for (const x of [-0.62, 0.62]) {\n"
    "            const light = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.05), headlightMat);\n"
    "            light.position.set(x, 0.96, L / 2 + 0.02);\n"
    "            g.add(light);\n"
    "        }\n"
    "    }",
    "    if (oncoming) {\n"
    "        for (const x of [-0.62, 0.62]) {\n"
    "            const light = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.06), headlightMat);\n"
    "            light.position.set(x, 0.96, L / 2 + 0.02);\n"
    "            g.add(light);\n"
    "            const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), headGlowMat);\n"
    "            glow.position.set(x, 0.96, L / 2 + 0.14);\n"
    "            g.add(glow);\n"
    "        }\n"
    "        // 前照灯投出的锥形光柱（开口朝 +z，越远越散）\n"
    "        const beam = new THREE.Mesh(new THREE.ConeGeometry(2.6, 17, 14, 1, true), headBeamMat);\n"
    "        beam.rotation.x = -Math.PI / 2;\n"
    "        beam.position.set(0, 0.96, L / 2 + 8.5);\n"
    "        g.add(beam);\n"
    "    }",
    '迎面火车加光晕 + 光柱')

# ============================================================ ② 车速跟着玩家提速
rep("    const t = addObstacle('train', lane, front, L, makeTrain(L, pick(TRAIN_STYLES), oncoming), oncoming ? S.speed * 0.4 : 0);\n"
    "    if (oncoming) t.moving = true;   // 迎面火车是「行驶障碍」：撞击即失败",
    "    const t = addObstacle('train', lane, front, L, makeTrain(L, pick(TRAIN_STYLES), oncoming), oncoming ? S.speed * 0.42 : 0);\n"
    "    if (oncoming) {\n"
    "        t.moving = true;      // 迎面火车是「行驶障碍」：撞击即失败\n"
    "        t.extraRate = 0.42;   // 额外速度 = 当前跑速 × 0.42（玩家越快，迎面火车也越快）\n"
    "    }",
    'placeTrain 记录 extraRate')

rep("    const o = addObstacle(type, lane, s, L, mesh, S.speed * 0.45);\n"
    "    o.moving = true;",
    "    const o = addObstacle(type, lane, s, L, mesh, S.speed * 0.45);\n"
    "    o.moving = true;\n"
    "    o.extraRate = 0.45;    // 同上：相对速度随玩家跑速增长",
    'placeMoving 记录 extraRate')

rep("    for (let i = obstacles.length - 1; i >= 0; i--) {\n"
    "        const o = obstacles[i];\n"
    "        o.z += step + o.extra * dt;",
    "    for (let i = obstacles.length - 1; i >= 0; i--) {\n"
    "        const o = obstacles[i];\n"
    "        if (o.moving) o.extra = S.speed * (o.extraRate || 0.45);   // 玩家提速 → 迎面车跟着提速\n"
    "        o.z += step + o.extra * dt;",
    '每帧刷新行驶障碍速度')

# ============================================================ ③ 撞柱即死
rep("        // 刚飞完的落地保护：落进可站立车辆就直接放到车顶，栏杆忽略（行驶障碍不适用，照样判定撞击）\n"
    "        if (S.landGrace > 0 && !o.moving) {",
    "        // 刚飞完的落地保护：落进可站立车辆就直接放到车顶，栏杆忽略（行驶障碍与支撑柱不适用）\n"
    "        if (S.landGrace > 0 && !o.moving && !o.deadly) {",
    'landGrace 不放行支撑柱')

rep("        // 行驶障碍：任何接触直接失败（护盾规则见 movingCrash；跳过/钻过/换道躲避仍然有效）\n"
    "        if (o.moving) return movingCrash(o);",
    "        // 行驶障碍：任何接触直接失败（护盾规则见 movingCrash；跳过/钻过/换道躲避仍然有效）\n"
    "        if (o.moving) return movingCrash(o);\n"
    "        // 支撑柱：从地面顶到拱顶，跳不过、钻不过、擦一下也是死（护盾按普通撞击规则抵挡一次）\n"
    "        if (o.deadly) return pillarCrash(o);",
    'checkCollisions + deadly 分支')

rep("function startFlight() {",
    "// 撞上支撑柱：跳不过也钻不过，任何接触都算撞（护盾可以按普通撞击规则扛一次）\n"
    "function pillarCrash(o) {\n"
    "    if (S.power.shield > 0) {\n"
    "        S.power.shield = 0;\n"
    "        obstacles.splice(obstacles.indexOf(o), 1);\n"
    "        disposeObj(o.mesh);\n"
    "        SFX.shield();\n"
    "        S.chaserTimer = Math.max(S.chaserTimer, 5);\n"
    "        SFX.guard();\n"
    "        showMsg('🛡️ 护盾硬扛了一根支撑柱！' + CONFIG.chaser.name + '追上来了');\n"
    "        return;\n"
    "    }\n"
    "    die('一头撞上了支撑柱！');\n"
    "}\n"
    "\n"
    "function startFlight() {",
    'pillarCrash')

# ============================================================ ④ 全局：同时只允许一辆行驶障碍
rep("    else if (canMoving && (dueMoving || r < 0.56)) { placeMoving(lane, s); S.lastMovingS = s; }",
    "    // 同一时刻只允许一辆行驶障碍在场上（两辆迎面车同时封死两条道就是必死局）\n"
    "    else if (canMoving && (dueMoving || r < 0.56) && !obstacles.some(o => o.moving)) { placeMoving(lane, s); S.lastMovingS = s; }",
    '行驶障碍全局唯一')

# ============================================================ ⑤ 柱阵生成器
rep("function spawnRow(s) {\n    // 偶尔把安全道换到相邻且已空出足够距离的车道",
    "// =====================================================================\n"
    "//  隧道·支撑柱阵\n"
    "//  一柱一柱沿轨道排开 → 一整段柱子就是中间道的禁区；段与段之间留 20~28 米空隙，\n"
    "//  玩家可以借这点空隙横切到另一条道，但没法在中间道上跑起来。\n"
    "//  柱阵存在期间只剩左右两条道可跑，并且必须有一辆（且只有一辆）迎面火车。\n"
    "// =====================================================================\n"
    "const pillarMateMat = shared(std(0xb6b0a4, { roughness: 0.92 }));\n"
    "const pillarWarnMat = shared(new THREE.MeshBasicMaterial({ color: 0xffb020 }));\n"
    "const pillarGeoCache = new Map();\n"
    "\n"
    "// 一段柱子的几何体（按立柱根数缓存）：结构件合并成 1~2 个 mesh，别把 drawcall 打爆\n"
    "function pillarBlockParts(cols) {\n"
    "    if (pillarGeoCache.has(cols)) return pillarGeoCache.get(cols);\n"
    "    const len = (cols - 1) * PILLAR_STEP;\n"
    "    const solid = [], bands = [];\n"
    "    for (let i = 0; i < cols; i++) {\n"
    "        const z = -len / 2 + i * PILLAR_STEP;\n"
    "        solid.push(new THREE.CylinderGeometry(0.58, 0.72, 7.5, 10).translate(0, 3.75, z));\n"
    "        solid.push(new THREE.BoxGeometry(1.7, 0.46, 1.7).translate(0, 0.23, z));\n"
    "        solid.push(new THREE.BoxGeometry(1.55, 0.4, 1.55).translate(0, 7.28, z));\n"
    "        bands.push(new THREE.CylinderGeometry(0.79, 0.79, 0.26, 10).translate(0, 1.32, z));\n"
    "    }\n"
    "    solid.push(new THREE.BoxGeometry(1.9, 0.55, len + 1.4).translate(0, 7.5, 0));   // 顶部横梁\n"
    "    let parts = null;\n"
    "    if (mergeGeometries) {\n"
    "        const a = mergeGeometries(solid, false), b = mergeGeometries(bands, false);\n"
    "        if (a && b) {\n"
    "            a.userData.shared = true; b.userData.shared = true;\n"
    "            parts = [{ geo: a, mat: pillarMateMat }, { geo: b, mat: pillarWarnMat }];\n"
    "            for (const q of solid) q.dispose();\n"
    "            for (const q of bands) q.dispose();\n"
    "        }\n"
    "    }\n"
    "    if (!parts) {                                  // 降级：合并不了就直接一坨一坨挂\n"
    "        for (const q of solid) q.userData.shared = true;\n"
    "        for (const q of bands) q.userData.shared = true;\n"
    "        parts = solid.map(q => ({ geo: q, mat: pillarMateMat }))\n"
    "            .concat(bands.map(q => ({ geo: q, mat: pillarWarnMat })));\n"
    "    }\n"
    "    pillarGeoCache.set(cols, parts);\n"
    "    return parts;\n"
    "}\n"
    "\n"
    "function makePillar(len) {\n"
    "    const cols = clamp(Math.round(len / PILLAR_STEP) + 1, 2, 12);\n"
    "    const g = new THREE.Group();\n"
    "    for (const p of pillarBlockParts(cols)) {\n"
    "        const m = new THREE.Mesh(p.geo, p.mat);\n"
    "        m.castShadow = true;\n"
    "        g.add(m);\n"
    "    }\n"
    "    return g;\n"
    "}\n"
    "\n"
    "function newPillarState(baseD) {\n"
    "    return {\n"
    "        active: false,\n"
    "        nextAt: (baseD || 0) + PILLAR_CFG.firstAfter,\n"
    "        endS: 0, cursor: 0, cols: 6,\n"
    "        pendingTrain: false, trainS: 0, trainLane: 1, sections: 0,\n"
    "    };\n"
    "}\n"
    "\n"
    "// 返回 true = 本行属于柱阵区，已经单独处理（中间道整段封闭）\n"
    "function pillarRow(s) {\n"
    "    const P = S.pillar;\n"
    "    if (!P) return false;\n"
    "    if (!P.active) {\n"
    "        if (s < P.nextAt) return false;\n"
    "        if (S.laneFree[1] > s - 14) return false;     // 中间道前方还有旧障碍，等下一行\n"
    "        P.active = true;\n"
    "        P.sections++;\n"
    "        P.endS = s + randRange(PILLAR_CFG.span[0], PILLAR_CFG.span[1]);\n"
    "        P.cursor = s;\n"
    "        P.trainLane = pick([0, 2]);                    // 只会在仅剩的左右两条道上\n"
    "        P.trainS = s + randRange(PILLAR_CFG.trainLead[0], PILLAR_CFG.trainLead[1]);\n"
    "        P.pendingTrain = true;\n"
    "        S.laneFree[1] = P.endS;                        // 整段中间道不再给别的生成器用\n"
    "    }\n"
    "    // 一根一根铺柱段：段内立柱连续，段间留 gap 作为唯一的横切通道\n"
    "    while (P.cursor < s + 46 && P.cursor < P.endS) {\n"
    "        const cols = Math.round(rand(PILLAR_CFG.cols[0], PILLAR_CFG.cols[1]));\n"
    "        const len = (cols - 1) * PILLAR_STEP;\n"
    "        addObstacle('pillar', 1, P.cursor, len, makePillar(len));\n"
    "        P.cursor += len + randRange(PILLAR_CFG.gap[0], PILLAR_CFG.gap[1]);\n"
    "    }\n"
    "    // 柱阵里必须有那辆迎面火车；同一时刻只允许一辆\n"
    "    if (P.pendingTrain && s >= P.trainS && !obstacles.some(o => o.moving)) {\n"
    "        placeMoving(P.trainLane, s + 14);\n"
    "        S.lastMovingS = s;\n"
    "        P.pendingTrain = false;\n"
    "    }\n"
    "    // 两侧金币引导（中间道是禁区，不给金币）\n"
    "    if (Math.random() < 0.55) placeCoinLine(pick([0, 2]), s + 4, 4, 1.0);\n"
    "    if (P.cursor >= P.endS && s > P.endS + 10) {\n"
    "        P.active = false;\n"
    "        P.nextAt = P.endS + PILLAR_CFG.cooldown;\n"
    "        return false;\n"
    "    }\n"
    "    return true;\n"
    "}\n"
    "\n"
    "function spawnRow(s) {\n"
    "    // 隧道·柱阵区走专用分支：中间道被封，只留左右两条 + 一辆火车\n"
    "    if (Scene.id === 'tunnel' && pillarRow(s)) return;\n"
    "    // 偶尔把安全道换到相邻且已空出足够距离的车道",
    '柱阵生成器 + spawnRow 分支')

# ============================================================ ⑥ 状态初始化
rep("        flight: createFlight(), menuT: 0,\n    });",
    "        flight: createFlight(), menuT: 0,\n"
    "        pillar: newPillarState(0),\n"
    "    });",
    'resetState + pillar')

rep("    S.nextRowS = S.D + 70;              // 换场后 70m 无障碍缓冲\n"
    "    S.transGrace = 1.2;                 // 转场无敌，防止黑场撞车",
    "    S.nextRowS = S.D + 70;              // 换场后 70m 无障碍缓冲\n"
    "    S.transGrace = 1.2;                 // 转场无敌，防止黑场撞车\n"
    "    S.pillar = newPillarState(S.D);     // 柱阵按新场景的里程重新排期",
    'doSceneSwap + pillar')

io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('done %d -> %d bytes' % (orig, len(src)))
