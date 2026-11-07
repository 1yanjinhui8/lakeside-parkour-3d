# -*- coding: utf-8 -*-
"""补丁 5：城堡立面精修 —— 窄高尖拱窗、顶层四坡顶、错落退距"""
import io, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'playable.html')
src = io.open(P, encoding='utf-8').read()


def rep(old, new, tag):
    global src
    n = src.count(old)
    assert n == 1, '[%s] 期望 1 次匹配，实际 %d 次' % (tag, n)
    src = src.replace(old, new)
    print('OK   ' + tag)


# ① 亮窗别糊成一片橙方块
rep("    winLit:    shared(std(0x2b2018, { roughness: 0.3, emissive: 0xffb04a, emissiveIntensity: 1.25 })),",
    "    winLit:    shared(std(0x2b2018, { roughness: 0.3, emissive: 0xffa84a, emissiveIntensity: 0.78 })),",
    '亮窗降亮')

# ② 主体降一档：塔尖群成为天际线主角，不再是一堵开满方窗的墙
rep("    const hy = (4 + Math.round(rand(0, 3))) * M;             // 主体高 12–21（加塔尖后 30–40）",
    "    const hy = (3 + Math.round(rand(0, 3))) * M;             // 主体高 9–15（塔与主堡仍到 30–40）",
    '主体降高')

# ③ 顶层退台：加四坡顶，剪影从"方糕"变成收尖
rep("    box(sx * 0.66 + 1.0, 0.55, sz * 0.72 + 1.0, trim, 0, Y0 + hy + 9.8, 0);",
    "    box(sx * 0.66 + 1.0, 0.55, sz * 0.72 + 1.0, trim, 0, Y0 + hy + 9.8, 0);\n"
    "    const hiRoof = cone(1, 5.6, 4, roof, 0, Y0 + hy + 12.9, 0, Math.PI / 4);\n"
    "    hiRoof.scale.set(sx * 0.5, 1, sz * 0.56);                // 压成跟退台同比例的方锥\n"
    "    cone(0.3, 1.0, 8, CASTLE_MAT.gold, 0, Y0 + hy + 16.2, 0);",
    '顶层四坡顶')

# ④ 窗：窄高窗 + 四棱锥尖拱头（北欧哥特味），比一整排大方块更像石头建筑
rep("""    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            box(0.3, 1.8, 0.95, win, face + 0.02,
                Y0 + 2.6 + r * ((hy - 4.4) / rows), -sz / 2 + sz * (c + 0.5) / cols);
        }
    }""",
    """    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const wz = -sz / 2 + sz * (c + 0.5) / cols;
            const wy = Y0 + 2.4 + r * ((hy - 4.2) / rows);
            box(0.3, 2.0, 0.62, win, face + 0.02, wy, wz);                 // 窄窗身
            const arch = cone(0.44, 0.55, 4, win, face + 0.02, wy + 1.28, wz, Math.PI / 4);
            arch.scale.z = 1.0;                                            // 尖拱头（四棱锥压扁）
        }
    }""",
    '尖拱窄窗')

# ⑤ 摆放：每三座往后错一层，纵深拉开，不再是齐刷刷一堵墙
rep("        c.position.x = -9.6 - c.userData.halfX - rand(0, 2.2);   // 退到站台外，别贴脸挡死轨道",
    "        c.position.x = -9.6 - c.userData.halfX - rand(0, 2.2)\n"
    "            - (i % 3 === 1 ? rand(5, 11) : 0);                 // 每三座往后退一层，立面有纵深",
    '城堡退距错落')

io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('wrote %d chars (was %d)' % (len(src), 0))
