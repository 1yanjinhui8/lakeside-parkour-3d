# -*- coding: utf-8 -*-
"""补丁 4：视觉打磨 —— 城堡退距/加体量分段、支撑柱在暗隧道里更可读、传送门不过曝"""
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


# ---------------------------------------------------------------- 城堡：退距 + 体量分段
rep("        c.position.x = -5.4 - c.userData.halfX - rand(0, 1.8);   // 台基最外沿贴到护栏外",
    "        c.position.x = -9.6 - c.userData.halfX - rand(0, 2.2);   // 退到站台外，别贴脸挡死轨道",
    '城堡退距')

rep("    const hy = (5 + Math.round(rand(0, 4))) * M;             // 主体高 15–27",
    "    const hy = (4 + Math.round(rand(0, 3))) * M;             // 主体高 12–21（加塔尖后 30–40）",
    '城堡主体降高')

# 腰线 / 檐口：挑出更多，掠射角下也能看出横向分层
rep("    for (const t of [0.4, 0.72]) box(sx + 0.7, 0.34, sz + 0.7, trim, 0, Y0 + hy * t, 0);\n"
    "    box(sx + 1.1, 0.55, sz + 1.1, trim, 0, Y0 + hy + 0.28, 0);",
    "    for (const t of [0.4, 0.72]) box(sx + 1.05, 0.4, sz + 1.05, trim, 0, Y0 + hy * t, 0);\n"
    "    box(sx + 1.5, 0.6, sz + 1.5, trim, 0, Y0 + hy + 0.3, 0);\n"
    "    // 顶层退台：主体上面再叠一层收进的小体量，剪影不至于是一整块方糕\n"
    "    box(sx * 0.66, 9.0, sz * 0.72, mat, 0, Y0 + hy + 5.1, 0);\n"
    "    box(sx * 0.66 + 1.0, 0.55, sz * 0.72 + 1.0, trim, 0, Y0 + hy + 9.8, 0);\n"
    "    for (let i = 0; i < 4; i++) {          // 退台上的小窗，跟下面同一个模数\n"
    "        box(0.28, 1.5, 0.8, win, sx * 0.33 + 0.02, Y0 + hy + 3.4, -sz * 0.36 + i * sz * 0.24);\n"
    "    }",
    '城堡腰线 + 退台')

# 壁柱加厚加深：掠射角下就是一道道竖向石肋
rep("        box(0.6, hy - 1.4, 0.85, trim, face + 0.28, Y0 + hy / 2 - 0.4, -sz / 2 + i * sz / 6);",
    "        box(1.0, hy - 1.4, 1.15, trim, face + 0.5, Y0 + hy / 2 - 0.4, -sz / 2 + i * sz / 6);",
    '城堡壁柱加厚')

# ---------------------------------------------------------------- 支撑柱：暗隧道里能看见
rep("const pillarMateMat = shared(std(0xb6b0a4, { roughness: 0.92 }));\n"
    "const pillarWarnMat = shared(new THREE.MeshBasicMaterial({ color: 0xffb020 }));",
    "// 隧道里太阳是关掉的，不给一点自发光的话柱子会糊成一团黑\n"
    "const pillarMateMat = shared(std(0xc8c2b6, { roughness: 0.9, emissive: 0x241f18, emissiveIntensity: 0.55 }));\n"
    "const pillarWarnMat = shared(new THREE.MeshBasicMaterial({ color: 0xffb020 }));",
    '支撑柱材质提亮')

rep("        bands.push(new THREE.CylinderGeometry(0.79, 0.79, 0.26, 10).translate(0, 1.32, z));",
    "        bands.push(new THREE.CylinderGeometry(0.79, 0.79, 0.3, 10).translate(0, 1.35, z));\n"
    "        bands.push(new THREE.CylinderGeometry(0.72, 0.72, 0.22, 10).translate(0, 3.4, z));",
    '支撑柱加第二道反光箍')

# ---------------------------------------------------------------- 传送门：核心别过曝、地面导流线收细
rep("        grd.addColorStop(0, '#ffffff');\n"
    "        grd.addColorStop(0.22, '#9df6ff');",
    "        grd.addColorStop(0, '#d9fbff');\n"
    "        grd.addColorStop(0.26, '#7fe8ff');",
    '传送门核心降白')

rep("        new THREE.MeshBasicMaterial({ map: cyberCoreTex, transparent: true, opacity: 0.82,",
    "        new THREE.MeshBasicMaterial({ map: cyberCoreTex, transparent: true, opacity: 0.66,",
    '传送门核心降不透明')

rep("    // ⑤ 地面导流线：从远处一路亮进门里\n"
    "    for (const s of [-1, 1]) {\n"
    "        add(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 26), s < 0 ? neonCyan : neonPink).rotateX(-Math.PI / 2),\n"
    "            s * 3.0, 0.06, 12);\n"
    "    }",
    "    // ⑤ 地面导流线：从远处一路亮进门里（半透明，别比轨道还抢眼）\n"
    "    for (const s of [-1, 1]) {\n"
    "        const lm = new THREE.MeshBasicMaterial({\n"
    "            color: s < 0 ? 0x35f0ff : 0xff35c8, transparent: true, opacity: 0.55,\n"
    "            blending: THREE.AdditiveBlending, depthWrite: false, fog: false,\n"
    "        });\n"
    "        add(new THREE.Mesh(new THREE.PlaneGeometry(0.34, 26), lm).rotateX(-Math.PI / 2), s * 3.1, 0.06, 12);\n"
    "    }",
    '传送门地面导流线收细')

io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('done %d -> %d bytes' % (orig, len(src)))
