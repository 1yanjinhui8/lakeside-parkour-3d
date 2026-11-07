# -*- coding: utf-8 -*-
"""
patch13_gate_portal.py —— 把川大校门 GLB 接成「燕园」场景的专属传送门。

背景：校园段尾声此前没有洞口（直接黑场）。这里给 makeTransitPortal 增加 kind='gate'：
川大门模型（assets/models/scu_gate.glb，150 万面已减到 7.5 万）+ 门洞里的黑色内芯。
玩家跑到段落尾声时看到一座真实的校门立在跑道上，穿过去触发既有转场。

幂等：重复跑全部跳过。必须在 patch11 / patch12 之后执行。

注意模型的原始尺寸只有 1.0 x 0.3 x 0.6 米（Blender 导出没带缩放），
所以接入时要按「门宽 30 m」放大 30 倍，并整体抬高半个高度让底座落地。
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'playable.html')

s = io.open(SRC, encoding='utf-8', newline='').read()
changes = []


def rep(old, new, note):
    """判重看「new 已存在」；原因见 patch12 顶部注释。"""
    global s
    if new in s:
        changes.append(note + '（已应用，跳过）')
        return
    n = s.count(old)
    assert n == 1, '锚点异常（出现 %d 次）：%s' % (n, note)
    s = s.replace(old, new, 1)
    changes.append(note)


# ---------------------------------------------------------------- 1. 加载川大门
rep("""async function loadLandmarkGLBs() {""",
    """// ------------------------------------------------------------------
//  川大校门 GLB（传送门视觉）：原型只加载一次，spawnPortalPreview 时 clone
// ------------------------------------------------------------------
const GATE_FX = { proto: null, ready: false };
const GATE_URL = 'assets/models/scu_gate.glb';
// 原始模型 1.0 x 0.3 x 0.6 m；按门总宽 30 m 放大 → 高 9 m、进深 18 m
const GATE_SCALE = 30.0;

async function loadGateGLB() {
    if (GATE_FX.ready) return true;
    try {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader().loadAsync(GATE_URL);
        const root = gltf.scene;
        // 贴图各向异性 + 双面：门楼有大量薄檐口，单面渲染侧面会漏
        const maxAniso = renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 4;
        root.traverse(o => {
            if (!o.isMesh) return;
            o.castShadow = true;
            o.receiveShadow = true;
            const list = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of list) {
                if (!m) continue;
                m.side = THREE.DoubleSide;
                if (m.map) { m.map.anisotropy = Math.min(8, maxAniso); m.map.needsUpdate = true; }
                m.needsUpdate = true;
            }
        });
        GATE_FX.proto = root;
        GATE_FX.ready = true;
        console.log('[gate] 川大校门 GLB 已载入（传送门视觉）');
        return true;
    } catch (e) {
        console.info('[gate] 校门 GLB 不可用，校园段尾声回退黑场:', e && e.message || e);
        return false;
    }
}

async function loadLandmarkGLBs() {""",
    '川大门 GLB 加载器')

# ---------------------------------------------------------------- 2. gate 分支
rep("""function makeTransitPortal(kind) {
    if (kind === 'cyber') return makeCyberPortal();""",
    """function makeTransitPortal(kind) {
    if (kind === 'cyber') return makeCyberPortal();
    // 川大校门：校园段尾声的专属传送门。模型加载失败时返回 null，
    // 调度处会改走黑场（和没有洞口的场景一样），不会白屏。
    if (kind === 'gate') {
        if (!GATE_FX.ready || !GATE_FX.proto) return null;
        const g = new THREE.Group();
        const gate = GATE_FX.proto.clone(true);
        gate.scale.setScalar(GATE_SCALE);
        // 原始包围盒 y ∈ [-0.15, 0.15]（中心在 0）：抬高半高让底座落在地面
        gate.position.y = 0.15 * GATE_SCALE;
        // z ∈ [-0.62, 0]：门体向后延伸，门洞平面大约在 z=0 附近
        gate.userData.noMerge = true;
        g.add(gate);
        // 门洞黑色内芯：穿门时的「糊满画面」靠它，尺寸要盖住整个门洞
        const core = new THREE.Mesh(
            new THREE.PlaneGeometry(26, 11),
            new THREE.MeshBasicMaterial({ color: 0x04060a, fog: false })
        );
        core.position.set(0, 5.0, -2.0);
        g.add(core);
        return g;
    }""",
    'makeTransitPortal 增加 gate 分支')

# ---------------------------------------------------------------- 3. 调度：校园段尾声用校门
rep("""            // 城市 → 校园：走赛博朋克传送门，而不是黑场
            else if (Scene.id === 'city' && Scene.next === 'campus') spawnPortalPreview('cyber', Scene.next);""",
    """            // 城市 → 校园：走赛博朋克传送门，而不是黑场
            else if (Scene.id === 'city' && Scene.next === 'campus') spawnPortalPreview('cyber', Scene.next);
            // 校园段尾声：川大校门立在跑道上，穿过去传送到下一场景
            else if (Scene.id === 'campus') spawnPortalPreview('gate', Scene.next);""",
    '校园段尾声调度川大门')

# makeTransitPortal 返回 null 时（GLB 没加载出来）不要挂一个空门
rep("""    PortalFX.group = makeTransitPortal(kind);
    PortalFX.group.userData.noMerge = true;   // 传送门有缩放/透明动画，不能参与静态合并
    addScenery(PortalFX.group, -(PORTAL_CFG.previewLead + PORTAL_CFG.startGap));""",
    """    const portal = makeTransitPortal(kind);
    if (!portal) { PortalFX.kind = null; PortalFX.next = null; return; }   // GLB 缺失 → 黑场转场
    PortalFX.group = portal;
    PortalFX.group.userData.noMerge = true;   // 传送门有缩放/透明动画，不能参与静态合并
    addScenery(PortalFX.group, -(PORTAL_CFG.previewLead + PORTAL_CFG.startGap));""",
    '洞口为空时回退黑场')

# ---------------------------------------------------------------- 4. 加载时机
rep("""try { await loadLandmarkGLBs(); } catch (e) { console.warn('[landmark] 加载异常', e); }""",
    """try { await loadLandmarkGLBs(); } catch (e) { console.warn('[landmark] 加载异常', e); }
// 川大门：校园段尾声的传送门视觉，同样容错——加载失败只是回退黑场
try { await loadGateGLB(); } catch (e) { console.warn('[gate] 加载异常', e); }""",
    '川大门加载时机')

io.open(SRC, 'w', encoding='utf-8', newline='').write(s)
print('patch13 完成（%d 项）：' % len(changes))
for c in changes:
    print('  ·', c)
