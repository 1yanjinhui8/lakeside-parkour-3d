// ── 主逻辑片段 03/08 ──────────────────────────────
// 分节：全部烘进**一个顶点色 mesh**：加法混合，白天 opacity=0 完全隐形， + 程序生成的贴图 + 静态世界：按主题重建（地面、轨道、围墙、湖、雪山、云…）
// 按编号顺序合起来 = src/game.module.js 的全部逻辑（资源已用占位符替代）
// 生成自 playable.html，勿手改；重跑 tools/extract-src.py 同步
// ────────────────────────────────────────────────────────────────

//      ④ 全部烘进**一个顶点色 mesh**：加法混合，白天 opacity=0 完全隐形，
//         夜里由 ATMO 的昼夜曲线拉起来，一座地标只多 1 个 drawcall。
//
//    材质侧只做「压暗 + 一点点自发光」：贴图颜色乘 0.42，emissive 最多 0.12。
//    这样夜里塔身是暗的、光带是亮的，对比才出得来——反过来就是曝光。
//
//  设计取舍：
//    · GLB 不参与「按材质大合并」——它自带贴图和材质，合并不了。7 座地标各 1~3 个
//      材质，两份滚动副本 = 14~42 个 drawcall，这个代价必须认。
//    · 不用 onBeforeCompile 分层：这些模型的材质是 MeshPhysicalMaterial，
//      程序缓存 + 昼夜曲线每秒都在改 emissiveIntensity，注入的着色器很容易被
//      重新编译/复用成旧程序（实测改了半天没反应）。几何灯带是确定性的。
//    · 归一化只在注册时做一次（改几何、改材质），之后 clone 出来的实例共享全部资源。
//    · 没有 GLB 的 kind 自动回退到代码生成版本，所以这个模块可以在「模型还没做好」
//      的状态下直接上线，不会白屏。
// ============================================================================

function createLandmarkGLB({ THREE, ATMO }) {

    // kind -> { obj, tris, h, w, d, mats }
    const proto = new Map();

    // 街道版塔身的目标高度（从 4m 台基顶算起）。真实地标 53~58m，这里取 54。
    // 72m：普通塔楼 32~64m，地标要比它们高出一头，才能从街谷里拔出来
    const TARGET_H = 72;
    // 两个方向的上限完全不同，不能用一个数卡：
    //   X（进深，朝街道方向）：街宽 7.6m、路缘 |x|=3.8、地标轴心 x=±12 → 最多 16m
    //   Z（沿街方向）：槽距 27m、广场进深 26m → 最多 26m
    // 「门」类地标（东方之门 / 杭州之门）本来就是横向铺开的，用 X 的上限卡会把它们
    // 压成 16m 高的矮墩子；按 Z 的 26m 算，高度能到 26m 左右，才是「门」该有的比例。
    const MAX_X = 16;
    const MAX_Z = 26;
    const MAX_Z_BY_KIND = { cbd: 26 };

    // 轮廓采样：2m 一层 × 24 方位。再细就只是在给顶点数付利息，看不出差别。
    const SLICE_H = 2.0;
    const SECT = 24;

    // ---------------------------------------------------------------- 昼夜基色
    // 地标的 albedo 是「白天烘焙」的亮贴图：
    //   · 白天要保持原样（乘 0.52 已经有点压，再暗就成黑楼）
    //   · 夜里必须压到 0.07 左右，否则整座塔像混凝土一样发白，灯带对比全没了
    // 材质颜色不在 ATMO 的 glow 曲线里（那条曲线只管 emissiveIntensity），
    // 所以这里自己跟着 ATMO.state().night 做一次线性插值，每帧改 7 个颜色，成本可忽略。
    const tintMats = [];
    const TINT_DAY = new THREE.Color(0.52, 0.54, 0.58);
    const TINT_NIGHT = new THREE.Color(0.070, 0.082, 0.100);
    let tintTicking = false;

    function startTintTick() {
        if (tintTicking) return;
        tintTicking = true;
        const cur = new THREE.Color();
        const loop = () => {
            requestAnimationFrame(loop);
            if (!tintMats.length) return;
            const st = ATMO.state ? ATMO.state() : null;
            const n = st ? Math.max(0, Math.min(1, st.night || 0)) : 0;
            cur.copy(TINT_DAY).lerp(TINT_NIGHT, n);
            for (let i = 0; i < tintMats.length; i++) tintMats[i].color.copy(cur);
        };
        loop();
    }

    // ---------------------------------------------------------------- 材质分类
    // 名字里带什么词就归哪一类。分类决定「夜里怎么亮」，而不是「长什么样」——
    // 造型是美术的事，这里只管亮度预算，避免 GLB 把整条街照糊。
    function classify(name, mat) {
        const n = String(name || (mat && mat.name) || '').toLowerCase();
        if (/neon|glow|halo|light_?bar|led/.test(n)) return 'neon';
        if (/window|win|glass|curtain/.test(n)) return 'window';
        if (/trim|frame|edge|rib|mullion/.test(n)) return 'trim';
        return 'mass';
    }

    // 冷暖窗：名字里带 warm/amber 就是暖光，其余走冷光（和现有 twrWinWarm/Cool 一致）
    function isWarm(name) {
        return /warm|amber|gold|orange/i.test(String(name || ''));
    }

    // ---------------------------------------------------------------- 材质改写
    // GLB 的 PBR 材质在夜里几乎全黑（项目没有 environment map），但**不能**靠大功率
    // emissive 去补——那会变成一块发光板。这里只给一点点底光，把「存在感」交给灯带。
    function retint(mat, tag, name) {
        if (!mat) return mat;

        if (tag === 'neon') {
            // 霓虹线：换成 basic（颜色 × 昼夜系数），和 twrNeonC/V/A 完全同一套行为。
            const c = mat.color ? mat.color.clone() : new THREE.Color(0x00eaff);
            const nb = new THREE.MeshBasicMaterial({ color: c, fog: true });
            nb.name = mat.name;
            ATMO.registerGlow(nb, { kind: 'basic', base: 0.30, gain: 0.62 });
            return nb;
        }

        if (tag === 'window') {
            const warm = isWarm(name);
            mat.emissive = new THREE.Color(warm ? 0xffd68c : 0xbfe9ff);
            mat.emissiveIntensity = warm ? 0.05 : 0.04;
            ATMO.registerGlow(mat, { base: mat.emissiveIntensity, gain: warm ? 0.20 : 0.18 });
            return mat;
        }

        if (tag === 'trim') {
            mat.emissive = new THREE.Color(0x0a1220);
            mat.emissiveIntensity = 0.04;
            ATMO.registerGlow(mat, { base: 0.04, gain: 0.12 });
            return mat;
        }

        // mass：大面积塔身。夜里上限压到 0.132（0.012 + 0.12），永远低于车道线的 0.82。
        mat.emissive = new THREE.Color(0x14213a);
        mat.emissiveIntensity = 0.012;
        ATMO.registerGlow(mat, { base: 0.012, gain: 0.12 });
        return mat;
    }

    // ---------------------------------------------------------------- 轮廓扫描
    // 一次遍历三个产出：
    //   prof   —— 每层（2m）× 每方位（24）的最大半径（米），灯带就贴着它画
    //   crownX/crownZ —— 86%~96% 高度那圈的最大半宽，冠部灯圈用
    //   verts  —— 顶点数（调试用）
    function scanProfile(wrap, s, hM) {
        const SL = Math.max(4, Math.min(64, Math.ceil(hM / SLICE_H)));
        const prof = new Float32Array(SL * SECT);
        const inv = new THREE.Matrix4().copy(wrap.matrixWorld).invert();
        const rel = new THREE.Matrix4();
        const v = new THREE.Vector3();
        const out = { prof, SL, crownX: 0, crownZ: 0, verts: 0 };
        const TAU = Math.PI * 2;

        wrap.updateMatrixWorld(true);
        wrap.traverse(o => {
            if (!o.isMesh || !o.geometry) return;
            const p = o.geometry.attributes && o.geometry.attributes.position;
            if (!p) return;
            rel.multiplyMatrices(inv, o.matrixWorld);
            for (let i = 0; i < p.count; i++) {
                v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(rel);
                const ym = v.y * s;
                if (ym < 0) continue;
                const sl = Math.min(SL - 1, Math.floor(ym / SLICE_H));
                const r = Math.hypot(v.x, v.z) * s;
                if (r <= 0) continue;
                let sec = Math.floor((Math.atan2(v.z, v.x) + Math.PI) / TAU * SECT) % SECT;
                if (sec < 0) sec += SECT;
                const k = sl * SECT + sec;
                if (r > prof[k]) prof[k] = r;
                // 冠部轮廓：只取 86%~96% 高度
                const h = ym / hM;
                if (h > 0.86 && h < 0.96) {
                    const ax = Math.abs(v.x) * s, az = Math.abs(v.z) * s;
                    if (ax > out.crownX) out.crownX = ax;
                    if (az > out.crownZ) out.crownZ = az;
                }
                out.verts++;
            }
        });
        return out;
    }

    // 某高度处的截面半径（取相邻两层、每个方位的最大值，避免正好落在凹槽里）
    function radiusAt(pr, SL, yM) {
        const sl = Math.max(0, Math.min(SL - 1, Math.round(yM / SLICE_H)));
        const out = new Float32Array(SECT);
        for (let sec = 0; sec < SECT; sec++) {
            let r = 0;
            for (let k = Math.max(0, sl - 1); k <= Math.min(SL - 1, sl + 1); k++) {
                const q = pr[k * SECT + sec];
                if (q > r) r = q;
            }
            out[sec] = r;
        }
        return out;
    }

    // ---------------------------------------------------------------- 表面分层
    // 给每个顶点烘一个 0~1 的高度（相对整座地标），着色器按它做三件事：
    //   _line  楼层灯线：每 4m 一条细亮线（占层高 24%），其余压暗
    //   _grad  竖向梯度：脚部 1.0 → 塔顶 0.45
    //   _tint  色温：脚部琥珀 → 塔身青白
    // 好处是灯线**长在模型表面上**，跟着球面/收腰/方柱走，不会有几何环浮空的问题。
    function bakeHeightAttr(wrap, heightRel) {
        const inv = new THREE.Matrix4().copy(wrap.matrixWorld).invert();
        const rel = new THREE.Matrix4();
        const v = new THREE.Vector3();
        let count = 0;
        wrap.updateMatrixWorld(true);
        wrap.traverse(o => {
            if (!o.isMesh || !o.geometry) return;
            const g = o.geometry;
            const p = g.attributes && g.attributes.position;
            if (!p) return;
            rel.multiplyMatrices(inv, o.matrixWorld);
            let a = g.getAttribute('aH');
            if (!a || a.count !== p.count) {
                a = new THREE.BufferAttribute(new Float32Array(p.count), 1);
                g.setAttribute('aH', a);
            }
            const arr = a.array;
            for (let i = 0; i < p.count; i++) {
                v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(rel);
                arr[i] = heightRel > 1e-6 ? v.y / heightRel : 0;
            }
            a.needsUpdate = true;
            count += p.count;
        });
        return count;
    }

    function addLayerShader(mat, opt) {
        const floors = Math.max(6, Math.min(30, Math.round((opt.hM || 60) / 4)));   // 每 4m 一层
        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uFloorN = { value: floors };
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nattribute float aH;\nvarying float vLH;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLH = aH;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying float vLH;\nuniform float uFloorN;')
                // 锚点用「声明 totalEmissiveRadiance」而不是 chunk：r160 的
                // meshmaterial 里 chunk 名能变，这句声明一直在（踩过：换错锚点
                // 会静默不生效 —— 顶点端改了、片元没改，塔身就是一片平光）。
                .replace('vec3 totalEmissiveRadiance = emissive;', [
                    'vec3 totalEmissiveRadiance = emissive;',
                    'float _lh = clamp( vLH, 0.0, 1.0 );',
                    'float _f = fract( _lh * uFloorN );',
                    'float _line = smoothstep( 0.0, 0.03, _f ) * ( 1.0 - smoothstep( 0.06, 0.13, _f ) );',
                    'float _wash = 0.10 + 0.90 * _line;',
                    'float _grad = mix( 1.0, 0.45, smoothstep( 0.05, 0.95, _lh ) );',
                    'vec3 _tint = mix( vec3( 1.00, 0.62, 0.30 ), vec3( 0.45, 0.78, 1.00 ), smoothstep( 0.08, 0.60, _lh ) );',
                    'totalEmissiveRadiance *= _tint * _grad * _wash;',
                ].join('\n'));
        };
        // 层数不同的地标必须分开编译，否则会共用同一个程序
        mat.customProgramCacheKey = () => 'lmBand/' + floors;
    }

    // ---------------------------------------------------------------- 灯带骨架
    // 四层光，全部烘进一个顶点色 mesh（加法混合 → 白天 opacity=0 隐形）：
    //   L0 基座泛光池（暖）→ L2 冠部灯圈（冷蓝）→ L3 信标（红）
    //   （塔身的竖向分层灯线由材质着色器负责，不占几何——见 addLayerShader）
    let rigMat = null;
    function getRigMaterial() {
        if (rigMat) return rigMat;
        rigMat = new THREE.MeshBasicMaterial({
            vertexColors: true, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
            side: THREE.DoubleSide, fog: true,
        });
        rigMat.name = 'lmRig';
        ATMO.registerGlow(rigMat, { kind: 'add', base: 0, gain: 0.95 });
        return rigMat;
    }

    function buildLightRig(pM, s, mat, scan) {
        const POS = [], COL = [];
        const vtx = (x, y, z, c) => { POS.push(x / s, y / s, z / s); COL.push(c[0], c[1], c[2]); };
        const tri = (a, b, c, col) => { vtx(a[0], a[1], a[2], col); vtx(b[0], b[1], b[2], col); vtx(c[0], c[1], c[2], col); };
        const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
        const TAU = Math.PI * 2;

        // L0 基座泛光：广场上一圈暖光池（半径按实测轮廓，别把光池铺到马路上去）
        let maxR = 0;
        for (let i = 0; i < scan.prof.length; i++) if (scan.prof[i] > maxR) maxR = scan.prof[i];
        const R = Math.max(3.2, Math.min(maxR * 0.95, 13));
        const RB = [0, 0.30, 0.55, 0.76, 0.90, 1.0];
        const SEG = 36;
        const ringCol = t => { const k = Math.pow(1 - t, 1.7) * 0.55; return [1.00 * k, 0.62 * k, 0.30 * k]; };
        for (let i = 0; i < RB.length - 1; i++) {
            const r0 = RB[i] * R, r1 = RB[i + 1] * R;
            const c0 = ringCol(RB[i]), c1 = ringCol(RB[i + 1]);
            for (let k = 0; k < SEG; k++) {
                const a0 = (k / SEG) * TAU, a1 = ((k + 1) / SEG) * TAU;
                const A = [Math.cos(a0) * r0, 0.12, Math.sin(a0) * r0];
                const B = [Math.cos(a0) * r1, 0.12, Math.sin(a0) * r1];
                const C2 = [Math.cos(a1) * r1, 0.12, Math.sin(a1) * r1];
                const D2 = [Math.cos(a1) * r0, 0.12, Math.sin(a1) * r0];
                vtx(A[0], A[1], A[2], c0); vtx(B[0], B[1], B[2], c1); vtx(C2[0], C2[1], C2[2], c1);
                vtx(A[0], A[1], A[2], c0); vtx(C2[0], C2[1], C2[2], c1); vtx(D2[0], D2[1], D2[2], c0);
            }
        }

        // L2 冠部灯圈：细长塔在 93.5% 套一圈冷蓝灯；宽扁的「门 / 群楼」跳过——
        // 它们的轮廓是横向铺开的，套圈会横穿马路（实测很怪）。
        const aspect = Math.max(pM.w, pM.d) / Math.max(pM.h, 1);
        if (aspect <= 0.55) {
            const yc = pM.h * 0.935;
            const rr = radiusAt(scan.prof, scan.SL, yc);
            const cCrown = [0.16, 0.32, 0.58];
            for (let sec = 0; sec < SECT; sec++) {
                const r0 = rr[sec], r1 = rr[(sec + 1) % SECT];
                if (r0 < 0.6 || r1 < 0.6) continue;
                const a0 = ((sec + 0.5) / SECT) * TAU - Math.PI;
                const a1 = ((sec + 1.5) / SECT) * TAU - Math.PI;
                const p00 = [Math.cos(a0) * r0 * 1.06, yc - 0.28, Math.sin(a0) * r0 * 1.06];
                const p01 = [Math.cos(a1) * r1 * 1.06, yc - 0.28, Math.sin(a1) * r1 * 1.06];
                const p02 = [Math.cos(a1) * r1 * 1.06, yc + 0.28, Math.sin(a1) * r1 * 1.06];
                const p03 = [Math.cos(a0) * r0 * 1.06, yc + 0.28, Math.sin(a0) * r0 * 1.06];
                quad(p00, p01, p02, p03, cCrown);
            }
        }

        // L3 塔顶信标：夜里天际线上唯一的红点（航空障碍灯）。交叉双面片，
        // 不用 Sprite —— Sprite 没有可烘焙几何，静态合并会把整对象吞掉。
        const yb = pM.h + 1.3, r = 1.5;
        const cBeacon = [0.85, 0.12, 0.08];
        quad([-r, yb - r, 0], [r, yb - r, 0], [r, yb + r, 0], [-r, yb + r, 0], cBeacon);
        quad([0, yb - r, -r], [0, yb - r, r], [0, yb + r, r], [0, yb + r, -r], cBeacon);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(POS, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(COL, 3));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = 'lmRig';
        mesh.userData.noMerge = true;      // 跟 GLB 一起退出静态合并（父组本来也是 noMerge）
        mesh.renderOrder = 3;
        return mesh;
    }

    // ---------------------------------------------------------------- 归一化
    function normalize(root, kind) {
        root.updateMatrixWorld(true);

        // ① 把「底面中心」挪到原点
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        root.position.x -= center.x;
        root.position.z -= center.z;
        root.position.y -= box.min.y;
        root.updateMatrixWorld(true);

        // ② 按高度缩放到 TARGET_H；再分别检查 X / Z 两个方向，超了按超得最多的那个缩
        const h = Math.max(size.y, 0.001);
        let s = TARGET_H / h;
        const maxZ = MAX_Z_BY_KIND[kind] || MAX_Z;
        const needX = (size.x * s) / MAX_X;
        const needZ = (size.z * s) / maxZ;
        const over = Math.max(needX, needZ, 1);
        let clipped = false;
        if (over > 1) {
            s /= over;
            clipped = true;
        }

        // 缩放包一层 Group，避免直接改美术模型的根变换（他们可能在根上打了旋转）
        const wrap = new THREE.Group();
        wrap.add(root);
        wrap.scale.setScalar(s);
        wrap.updateMatrixWorld(true);

        // ③ 最终尺寸 + 轮廓扫描（灯带要按真实高度/半径生成）
        const finalBox = new THREE.Box3().setFromObject(wrap);
        const finalSize = finalBox.getSize(new THREE.Vector3());
        const hM = finalSize.y;
        const lineVerts = bakeHeightAttr(wrap, hM / s);
        const scan = scanProfile(wrap, s, hM);

        // ④ 扫一遍：统计三角面、收集材质
        let tris = 0;
        const meshList = [];
        const matSet = new Set();
        root.traverse(o => {
            if (!o.isMesh) return;
            meshList.push(o);
            const g = o.geometry;
            if (g) {
                tris += (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
            }
            const m = o.material;
            if (Array.isArray(m)) m.forEach(x => x && matSet.add(x));
            else if (m) matSet.add(m);
        });

        // 单材质模型（美术用一张贴图搞定整栋楼，材质名通常就是 Material.001）：
        // 名字没有语义，按名字分类会全部落到 mass。这里统一按 mass 处理，
        // 夜里交给灯带去交代轮廓——贴图只负责白天的质感。
        const onlyMat = matSet.size === 1 ? [...matSet][0] : null;
        const singleTex = !!(onlyMat && !/window|win|glass|neon|trim|frame/i.test(onlyMat.name || '')
            && onlyMat.map);

        // ⑤ 材质改写
        const matInfo = [];
        const seen = new Set();
        for (const o of meshList) {
            const apply = (m) => {
                if (!m || seen.has(m.uuid)) return m;
                seen.add(m.uuid);
                if (singleTex) {
                    // 白天烘焙贴图：颜色压到 0.42，夜里靠灯带而不是靠贴图发光。
                    // emissive 只留 0.012→0.13 的一点点底光，让人看得出体块，
                    // 再多就变成「一整块发光的板子」（这个坑踩过）。
                    m.color.copy(TINT_DAY);                   // 之后由 rAF 跟着昼夜往下压
                    tintMats.push(m);
                    startTintTick();
                    m.emissive = new THREE.Color(0xffffff);   // 颜色交给着色器按高度染
                    m.emissiveIntensity = 0.012;
                    m.emissiveMap = null;
                    addLayerShader(m, { hM });
                    ATMO.registerGlow(m, { base: 0.012, gain: 0.22 });
                    matInfo.push({ name: m.name, tag: 'band-lit' });
                    return m;
                }
                const tag = classify(m.name, m);
                matInfo.push({ name: m.name, tag });
                return retint(m, tag, m.name);
            };
            if (Array.isArray(o.material)) o.material = o.material.map(apply);
            else o.material = apply(o.material);
            // 地标不进静态合并：材质/贴图各不相同，合了反而更慢
            o.userData.noMerge = true;
        }

        // ⑥ 灯带骨架
        const rig = buildLightRig({
            h: hM, w: finalSize.x, d: finalSize.z,
            crownX: scan.crownX, crownZ: scan.crownZ,
        }, s, getRigMaterial(), scan);
        wrap.add(rig);

        return {
            obj: wrap,
            tris: Math.round(tris),
            h: finalSize.y,
            w: finalSize.x,
            d: finalSize.z,
            mats: matInfo,
            lightVerts: lineVerts,
            clipped,
            srcH: h,
        };
    }

    // ---------------------------------------------------------------- 公开接口
    /** 注册一个已加载的 GLB 场景。重复注册同一个 kind 会被忽略。 */
    function register(kind, gltfScene) {
        if (!kind || !gltfScene || proto.has(kind)) return false;
        try {
            const p = normalize(gltfScene, kind);
            proto.set(kind, p);
            const names = p.mats.map(m => m.name + ':' + m.tag).join(', ');
            console.log(`[landmark] ${kind}: ${p.tris} 面 · ${p.h.toFixed(1)}×${p.w.toFixed(1)}×${p.d.toFixed(1)}m`
                + (p.clipped ? ' · 超宽已按 16m 收缩' : '')
                + ` · 材质 [${names}] · 轮廓 ${p.lightVerts} 顶点`);
            if (p.tris > 16000) {
                console.warn(`[landmark] ${kind} 有 ${p.tris} 面，超出 1.6 万预算，手机端可能掉帧`);
            }
            return true;
        } catch (e) {
            console.warn('[landmark] 归一化失败', kind, e);
            return false;
        }
    }

    /** 有没有这个 kind 的 GLB */
    function has(kind) { return proto.has(kind); }

    /** 已注册的 kind 列表（调试用） */
    function list() {
        return [...proto.entries()].map(([k, p]) => ({
            kind: k, tris: p.tris, h: +p.h.toFixed(1),
            w: +p.w.toFixed(1), d: +p.d.toFixed(1),
            mats: p.mats, clipped: p.clipped,
        }));
    }

    /**
     * 把一个地标放进 group。返回 true 表示用 GLB 建好了，false 表示没有模型、调用方该回退。
     * @param group 目标 Group（街道版是地标组，环上版是塔身组）
     * @param kind  'pearl' | 'waist' | ...
     * @param IN    正面朝向：-1 表示朝局部 -x，+1 表示朝 +x（街道左右不同）
     * @param y0    塔身起始高度（街道版 4m 台基顶，环上版 0）
     */
    function build(group, kind, IN, y0) {
        const p = proto.get(kind);
        if (!p) return false;
        const inst = p.obj.clone(true);      // 共享几何与材质，只复制节点
        inst.position.y = y0;
        // 建模约定是「正面朝 -x」，街道左侧的地标要转 180° 才朝向街道
        inst.rotation.y = IN > 0 ? Math.PI : 0;
        inst.userData.glbKind = kind;        // 探针靠这个统计「场上到底放了几座 GLB 地标」
        group.add(inst);
        return true;
    }

    return { register, has, build, list, TARGET_H, MAX_X, MAX_Z };
}

const LMGLB = createLandmarkGLB({ THREE, ATMO });


// =====================================================================
//  ⑤ 程序生成的贴图
// =====================================================================
function makeTex(w, h, draw, rx = 1, ry = 1) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 8;
    return shared(t);
}
function noise(c, w, h, base, alpha, count) {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let i = 0; i < count; i++) {
        const light = Math.random() < 0.5;
        c.fillStyle = `rgba(${light ? '255,255,255' : '0,0,0'},${Math.random() * alpha})`;
        c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
}
function stripes(c1, c2) {
    return makeTex(128, 32, (c, w, h) => {
        c.fillStyle = c1; c.fillRect(0, 0, w, h);
        c.fillStyle = c2;
        for (let x = -h; x < w + h; x += 32) {
            c.beginPath(); c.moveTo(x, h); c.lineTo(x + 16, h); c.lineTo(x + 16 + h, 0); c.lineTo(x + h, 0); c.fill();
        }
    });
}

const groundTex = makeTex(128, 128, (c, w, h) => noise(c, w, h, '#8a8576', 0.3, 1500), 3.5, 85);
const trackTex = makeTex(128, 128, (c, w, h) => {
    noise(c, w, h, '#6b5f52', 0.35, 2600);
    noise(c, w, h, 'rgba(0,0,0,0)', 0.5, 900);          // 更密的道砟颗粒
    c.fillStyle = '#5b3a1f'; c.fillRect(6, 44, w - 12, 40);           // 枕木
    c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(6, 78, w - 12, 6);
    c.fillStyle = 'rgba(255,255,255,.1)'; c.fillRect(6, 44, w - 12, 4);
    // 钢轨位置的高光亮带（对应 3D 钢轨 ±0.55m / 道床宽 2.4m）
    c.fillStyle = 'rgba(225,236,248,.32)';
    c.fillRect(Math.round(w * 0.271) - 1, 0, 3, h);
    c.fillRect(Math.round(w * 0.729) - 1, 0, 3, h);
}, 1, 170);
const winTex = makeTex(64, 64, (c, w, h) => {
    c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2b3a55';
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) c.fillRect(6 + x * 32, 6 + y * 32, 20, 22);
});

const TRAIN_STYLES = [
    { body: '#d9dee6', stripe: '#1f6fd1', accent: '#ffcc00' },
    { body: '#f28c28', stripe: '#7a2e0e', accent: '#fff1c1' },
    { body: '#3fae6a', stripe: '#185c35', accent: '#e8ffe9' },
    { body: '#e8445a', stripe: '#ffffff', accent: '#ffe36e' },
].map(st => {
    // 车厢侧面：一张贴图 = 4 个单位长
    st.side = makeTex(256, 170, (c, w, h) => {
        c.fillStyle = st.body; c.fillRect(0, 0, w, h);
        c.fillStyle = st.stripe; c.fillRect(0, h * 0.72, w, h * 0.16);
        c.fillStyle = st.accent; c.fillRect(0, h * 0.68, w, 5);
        for (let i = 0; i < 3; i++) {
            c.fillStyle = '#1d2a44'; c.fillRect(14 + i * 82, 30, 64, 58);
            c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(18 + i * 82, 34, 18, 50);
        }
        c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(w - 3, 0, 3, h);
    });
    const front = makeTex(128, 128, (c, w, h) => {
        c.fillStyle = st.body; c.fillRect(0, 0, w, h);
        c.fillStyle = '#1d2a44'; c.fillRect(12, 14, w - 24, 50);
        c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(16, 18, 30, 42);
        c.fillStyle = st.stripe; c.fillRect(0, 80, w, 14);
        c.fillStyle = '#fff6b0';
        for (const x of [28, 100]) { c.beginPath(); c.arc(x, 108, 9, 0, Math.PI * 2); c.fill(); }
    });
    st.frontMat = shared(std(0xffffff, { map: front, roughness: 0.5, metalness: 0.2 }));
    return st;
});
const roofMat = shared(std(0x9aa3ad, { roughness: 0.6, metalness: 0.3 }));
const darkMat = shared(std(0x2a2d33));
const rampMat = shared(std(0x7d8794, { roughness: 0.5, metalness: 0.4 }));

// =====================================================================
//  ⑥ 静态世界：按主题重建（地面、轨道、围墙、湖、雪山、云…）
//  所有静态网格统一挂到 worldGroup，切换场景时整体销毁重建
// =====================================================================
const worldGroup = new THREE.Group();
scene.add(worldGroup);

// ---------- 几何合并工具（把装饰组里的同类 mesh 合成 1 个 drawcall） ----------
// 装饰是纯静态的（只整体平移），按材质合并后 Group 里同材质的几十个小 mesh 只剩 1 个，
// 是 drawcall 的主要削减手段。加载失败时自动降级为不合并。
let mergeGeometries = null;
let MERGE_STATE = 'not-loaded';
for (const src of ['three/addons/utils/BufferGeometryUtils.js', 'three/addons/utils/BufferGeometryUtils.js']) {
    try {
        const mod = await import(src);
        if (mod && typeof mod.mergeGeometries === 'function') { mergeGeometries = mod.mergeGeometries; MERGE_STATE = 'ok:' + src; break; }
    } catch (e) { MERGE_STATE = 'fail:' + src + ':' + (e && e.message); }
}

/**
 * 按材质合并一个装饰 Group 里的所有 mesh。
 * - 顶点按 root 的局部空间烘焙，合并后 Group 的位置/旋转/缩放保持不变
 * - 多材质 mesh（如带贴图数组的车体）或标记了 userData.noMerge 的组整体跳过
 * - 几何体是共享资源时不释放；独占的几何体在合并后释放，避免内存泄漏
 */
function mergeSceneryGroup(root) {
    if (!mergeGeometries || !root || root.userData.noMerge) return root;
    const meshes = [];
    root.updateMatrixWorld(true);
    root.traverse(o => { if (o.isMesh && !o.isInstancedMesh) meshes.push(o); });
    if (meshes.length < 2) return root;
    // 有多材质 mesh → 材质无法按引用分组，保持原样最安全
    if (meshes.some(m => Array.isArray(m.material))) return root;

    const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const byMat = new Map();
    for (const m of meshes) {
        if (!byMat.has(m.material)) byMat.set(m.material, []);
        byMat.get(m.material).push(m);
    }

    const out = new THREE.Group();
    out.position.copy(root.position);
    out.rotation.copy(root.rotation);
    out.scale.copy(root.scale);

    const staleGeos = [];
    for (const [mat, list] of byMat) {
        const geos = [];
        for (const m of list) {
            const g = m.geometry.clone();                    // clone：不改动共享几何体
            g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invRoot, m.matrixWorld));
            geos.push(g);
            if (!m.geometry.userData.shared) staleGeos.push(m.geometry);
        }
        let merged = null;
        try { merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false); } catch (e) { merged = null; }
        if (!merged) {                                        // 属性不兼容 → 该材质保持独立 mesh
            for (let i = 0; i < list.length; i++) {
                const m = list[i];
                m.geometry = geos[i];
                m.matrix.copy(new THREE.Matrix4());
                out.add(m);
            }
            continue;
        }
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = list.some(m => m.castShadow);
        mesh.receiveShadow = list.some(m => m.receiveShadow);
        out.add(mesh);
        if (geos.length > 1) for (const g of geos) g.dispose();
    }
    for (const g of staleGeos) g.dispose();
    return out;
}

/** 该装饰组能否整体参与"按材质大合并"（多材质 mesh / InstancedMesh / 无几何对象不行） */
function canMergeIntoBatch(root) {
    if (!mergeGeometries || !root || root.userData.noMerge) return false;
    let ok = true;
    root.traverse(o => {
        if (!ok) return;
        // Sprite / Points / Line 没有可烘焙的几何，合并后整个对象会被移除，
        // 它们会被静默吞掉（曾经因此丢掉全部地面蒸汽）
        if (o.isSprite || o.isPoints || o.isLine) { ok = false; return; }
        if (!o.isMesh) return;
        if (o.isInstancedMesh || Array.isArray(o.material)) ok = false;
    });
    return ok;
}

/**
 * 把本场景所有可合并的装饰按材质合并成少量大网格，并生成两份副本交替滚动。
 * 装饰本来就以 span 为周期重复（越界后 z -= span），所以"两副本交替"的视觉与原实现一致，
 * 但 drawcall 从「每个装饰 1~3 次」降到「每种材质 2 次」。返回新的 scenery 数组。
 */
function buildTiledDecor(span) {
    if (!mergeGeometries) return null;
    const mergeable = [], kept = [];
    for (const root of scenery) (canMergeIntoBatch(root) ? mergeable : kept).push(root);
    if (!mergeable.length) return null;

    worldGroup.updateMatrixWorld(true);
    const invWorld = new THREE.Matrix4().copy(worldGroup.matrixWorld).invert();
    const byMat = new Map();
    const bakedGeos = [];
    for (const root of mergeable) {
        root.traverse(o => {
            if (!o.isMesh) return;
            const g = o.geometry.clone();
            g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invWorld, o.matrixWorld));
            bakedGeos.push(g);
            if (!byMat.has(o.material)) byMat.set(o.material, { geos: [], cast: false, receive: false });
            const rec = byMat.get(o.material);
            rec.geos.push(g);
            rec.cast = rec.cast || o.castShadow;
            rec.receive = rec.receive || o.receiveShadow;
        });
    }

    // 每种材质只合并一次，两份副本共用同一份 geometry（显存不翻倍）
    const batches = [];
    for (const [mat, rec] of byMat) {
        let merged = null;
        try { merged = rec.geos.length === 1 ? rec.geos[0] : mergeGeometries(rec.geos, false); } catch (e) { merged = null; }
        if (!merged) continue;
        if (!merged.userData) merged.userData = {};
        merged.userData.shared = true;
        batches.push({ mat, geo: merged, cast: rec.cast, receive: rec.receive });
    }
    const usedGeos = new Set(batches.map(b => b.geo));
    for (const g of bakedGeos) if (!usedGeos.has(g)) g.dispose();   // 释放多余的临时几何体（合并产物才是最终数据）

    const makeBatchGroup = (zOffset) => {
        const grp = new THREE.Group();
        grp.position.z = zOffset;
        grp.userData.tiling = true;      // scrollWorld 用两倍 span 回移
        for (const b of batches) {
            const mesh = new THREE.Mesh(b.geo, b.mat);
            mesh.castShadow = b.cast;
            mesh.receiveShadow = b.receive;
            grp.add(mesh);
        }
        return grp;
    };

    // 原装饰已烘焙进大网格：从世界移除，只释放独占几何体（材质/共享几何体还要复用）
    for (const root of mergeable) {
        worldGroup.remove(root);
        root.traverse(o => {
            if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        });
    }

    // 初始位置让前副本盖住身后 24m（视野区间 [-190, 24] 全程有装饰）
    const A = makeBatchGroup(24);
    const B = makeBatchGroup(24 - span);
    worldGroup.add(A, B);
    return kept.concat([A, B]);
}

/**
 * 合并"不滚动"的静态世界物体（天际线、湖、山、围墙等）成按材质的大网格。
 * 它们随场景整体重建，不需要副本，合并不影响任何逻辑。
 */
function mergeStaticWorld() {
    if (!mergeGeometries) return 0;
    const scenerySet = new Set(scenery);
    const mergeable = worldGroup.children.filter(c => !scenerySet.has(c) && canMergeIntoBatch(c));
    if (mergeable.length < 2) return 0;

    worldGroup.updateMatrixWorld(true);
    const invWorld = new THREE.Matrix4().copy(worldGroup.matrixWorld).invert();
    const byMat = new Map();
    const baked = [];
    for (const root of mergeable) {
        root.traverse(o => {
            if (!o.isMesh) return;
            const g = o.geometry.clone();
            g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invWorld, o.matrixWorld));
            baked.push(g);
            if (!byMat.has(o.material)) byMat.set(o.material, { geos: [], cast: false, receive: false });
            const rec = byMat.get(o.material);
            rec.geos.push(g);
            rec.cast = rec.cast || o.castShadow;
            rec.receive = rec.receive || o.receiveShadow;
        });
    }

    let mergedCount = 0;
    const usedGeos = new Set();
    for (const [mat, rec] of byMat) {
        let merged = null;
        try { merged = rec.geos.length === 1 ? rec.geos[0] : mergeGeometries(rec.geos, false); } catch (e) { merged = null; }
        if (!merged) continue;
        if (!merged.userData) merged.userData = {};
        merged.userData.shared = true;
        usedGeos.add(merged);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = rec.cast;
        mesh.receiveShadow = rec.receive;
        worldGroup.add(mesh);
        mergedCount++;
    }
    for (const g of baked) if (!usedGeos.has(g)) g.dispose();
    for (const root of mergeable) {
        worldGroup.remove(root);
        root.traverse(o => {
            if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        });
    }
    return mergedCount;
}

function addMesh(geo, mat, x, y, z, { cast = false, receive = true } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast; m.receiveShadow = receive;
    worldGroup.add(m);
    return m;
}
const flat = (w, l) => new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2);

// 跨重建复用的材质（销毁世界时不释放）
const railMat  = shared(std(0xb8c0c8, { metalness: 0.8, roughness: 0.3 }));
const wallMat  = shared(std(0xb9b3a6, { roughness: 0.95 }));
const mtnMat   = shared(new THREE.MeshLambertMaterial({ color: 0x7d8fa8, fog: false, flatShading: true }));
const snowMat  = shared(new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false, flatShading: true }));
const cloudMat = shared(new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false }));

// ---- 湖畔轨道（起点场景）----
// 湖畔水面只保留「流动」：一层低对比度细长水纹随里程滚动。
// 不挂 ART.applyWaterShine（波光 + 涟漪注入只留给校园水面），
// 也不再画白色高光碎片，避免整片湖面「波光粼粼」。
let flowTex = null;
const wireMat = shared(std(0x4a5058, { metalness: 0.8, roughness: 0.4 }));
const hillMat = shared(new THREE.MeshLambertMaterial({ color: 0x6e8f66, fog: false, flatShading: true }));

// 湖面材质：纯色水面，流动感全靠上层滚动的水纹，不改 fragmentShader
const lakeMat = shared(std(0x2a83d6, { roughness: 0.16, metalness: 0.22 }));

// ---- 湖畔群山：灰岩峰柱 + 崖顶松林 ----
// 结构参考（只取形态特征，不照搬任何具体景点的造型）：
//   · 张家界：近垂直的石英砂岩峰柱、顶面平台、峰顶孤松
//   · 黄山：花岗岩峰脊、峭壁松、前中远三层峰林
//   · 漓江：喀斯特峰丛沿水岸层层退远、山脚植被贴着水面
// 实现：所有峰体 / 岩层 / 松树堆进一个 BufferGeometry，单材质顶点色 → 1 个 drawcall。
// 明暗直接烘焙在顶点色里（阳面亮、阴面暗、上亮下暗），昼夜与天气不会把山染黑。
const LAKE_MTN_MAT = shared(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
const MTN_FOG_COL = new THREE.Color(0x8a9bab);                 // 远山冷蓝灰（不过曝、不发白）
const MTN_ROCK = [0x3a444b, 0x545f67, 0x6f7b84, 0x87939a];   // 山脚阴影 → 崖壁 → 亮面
const MTN_GREEN = [0x2b4634, 0x3d6340, 0x537a49, 0x65864f];   // 深松 → 灌木 → 草
const MTN_MOSS = 0x4e7042;

function buildLakesideMountains() {
    const POS = [], NRM = [], CLR = [];
    const TAU = Math.PI * 2;
    const tmp = new THREE.Color();
    const emit = (hex, k, fog) => {
        tmp.setHex(hex).multiplyScalar(k);
        if (fog) tmp.lerp(MTN_FOG_COL, fog);
        return [tmp.r, tmp.g, tmp.b];
    };
    const tri = (a, b, c, col) => {
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        for (const p of [a, b, c]) {
            POS.push(p.x, p.y, p.z); NRM.push(nx, ny, nz); CLR.push(col[0], col[1], col[2]);
        }
    };
    const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };

    // 松树：树干 + 2~4 层「伞状」树冠（锥台，不是纯锥），可整体倾斜。
    // detailed = 近景用 4 层 7 边；中景 3 层、远景 2 层，树冠逐层收小、下暗上亮，
    // 层与层之间错开一点，远看才有「枝叶一层层摊开」的松树轮廓，而不是一个绿三角。
    const pine = (x, y, z, h, fog, detailed, leanX = 0, leanZ = 0) => {
        const tr = h * 0.05, th = h * 0.40;
        const bark = emit(0x3b352d, 0.96, fog);
        const tx = x + leanX * h * 0.32, tz = z + leanZ * h * 0.32;
        for (let i = 0; i < 4; i++) {                       // 细树干（四片）
            const a0 = i / 4 * TAU, a1 = (i + 1) / 4 * TAU;
            tri(
                { x: x + Math.cos(a0) * tr, y, z: z + Math.sin(a0) * tr },
                { x: tx, y: y + th, z: tz },
                { x: x + Math.cos(a1) * tr, y, z: z + Math.sin(a1) * tr },
                bark
            );
        }
        const tiers = detailed ? 4 : (fog > 0.4 ? 2 : 3);
        const sidesT = detailed ? 7 : 5;
        for (let tier = 0; tier < tiers; tier++) {
            const t0 = 0.24 + tier * (0.68 / tiers);
            const t1 = Math.min(1.02, 0.24 + (tier + 1) * (0.68 / tiers) + 0.03);
            const y0 = y + h * t0, y1 = y + h * t1;
            const r0 = h * (0.32 - tier * (0.20 / tiers));
            const r1 = r0 * 0.44;                           // 收得更急，层片之间才有台阶
            const wob = h * 0.025;                          // 每层中心随机偏一点，树冠不对称
            const ox = x + leanX * h * t0 + rand(-wob, wob), oz = z + leanZ * h * t0 + rand(-wob, wob);
            const ox1 = x + leanX * h * t1 + rand(-wob, wob), oz1 = z + leanZ * h * t1 + rand(-wob, wob);
            const base = tier === tiers - 1 ? MTN_GREEN[1] : MTN_GREEN[tier % 2 === 0 ? 0 : 2];
            for (let i = 0; i < sidesT; i++) {
                const a0 = i / sidesT * TAU, a1 = (i + 1) / sidesT * TAU;
                const col = emit(base, (0.84 + 0.28 * Math.cos(a0 - 0.8)) * (0.92 + 0.06 * tier), fog);
                quad(
                    { x: ox + Math.cos(a0) * r0, y: y0, z: oz + Math.sin(a0) * r0 },
                    { x: ox1 + Math.cos(a0) * r1, y: y1, z: oz1 + Math.sin(a0) * r1 },
                    { x: ox1 + Math.cos(a1) * r1, y: y1, z: oz1 + Math.sin(a1) * r1 },
                    { x: ox + Math.cos(a1) * r0, y: y0, z: oz + Math.sin(a1) * r0 },
                    col
                );
            }
            // 层底压一圈深色缝：树冠是一层层压下去的，远看不会是光滑绿锥
            if (detailed) {
                for (let i = 0; i < sidesT; i++) {
                    const a0 = i / sidesT * TAU, a1 = (i + 1) / sidesT * TAU;
                    tri(
                        { x: ox + Math.cos(a0) * r0, y: y0, z: oz + Math.sin(a0) * r0 },
                        { x: ox + Math.cos(a0) * r0 * 0.88, y: y0 + h * 0.035, z: oz + Math.sin(a0) * r0 * 0.88 },
                        { x: ox + Math.cos(a1) * r0, y: y0, z: oz + Math.sin(a1) * r0 },
                        emit(MTN_GREEN[0], 0.60, fog)
                    );
                }
            }
        }
        // 树尖：一小圈收口，避免树顶被削平
        const tipX = x + leanX * h, tipZ = z + leanZ * h, rTip = h * 0.06;
        for (let i = 0; i < sidesT; i++) {
            const a0 = i / sidesT * TAU, a1 = (i + 1) / sidesT * TAU;
            tri(
                { x: tipX + Math.cos(a0) * rTip, y: y + h * 1.02, z: tipZ + Math.sin(a0) * rTip },
                { x: tipX, y: y + h * 1.14, z: tipZ },
                { x: tipX + Math.cos(a1) * rTip, y: y + h * 1.02, z: tipZ + Math.sin(a1) * rTip },
                emit(MTN_GREEN[1], 1.02, fog)
            );
        }
    };

    // 一座峰柱：8 道不规则环 + 接近垂直的崖壁 + 竖向岩脊/深缝 + 横向岩层带。
    // 陡峭感来自「中下部几乎不收分」（K 从 1.00 只掉到 .93），最后两段才快速收顶；
    // opt.pillar 时变成细高石柱（边更少、层更少、几乎不长树）。
    const peak = (cx, cz, r, h, fog, seed, opt = {}) => {
        const pillar = !!opt.pillar;
        const sides = pillar ? 5 + (seed % 2) : 8 + (seed % 4);
        const LAYERS = pillar ? 6 : 8;
        const pointed = opt.pointed != null ? opt.pointed : (seed % 5 === 0);   // 1/5 尖峰
        const K = pillar ? [1, .97, .93, .86, .66, .26]
            : (pointed ? [1, .93, .85, .75, .63, .47, .28, .05]
                       : [1, .99, .98, .96, .93, .88, .76, .34]);
        const Y = pillar ? [0, .18, .40, .62, .84, 1] : [0, .12, .25, .38, .52, .66, .82, 1];
        const jA = [], jR = [], jS = [], crev = [];
        for (let i = 0; i < sides; i++) {
            jA.push(i / sides * TAU + rand(-0.05, 0.05));
            jR.push(rand(0.84, 1.16));
            jS.push(rand(0.90, 1.08));
            crev.push(((i * 5 + seed) % 5 === 0) ? 0.76 : 1);   // 1/5 扇区是凹进去的竖向深缝
        }
        const rings = [];
        for (let L = 0; L < LAYERS; L++) {
            const ring = [];
            for (let i = 0; i < sides; i++) {
                const rib = 1 + 0.08 * Math.sin(L * 1.9 + i * 2.4);   // 竖向岩脊起伏更明显
                const rr = r * K[L] * jR[i] * crev[i] * rib * rand(0.97, 1.03);
                ring.push({
                    x: cx + Math.cos(jA[i]) * rr + (L > 0 ? rand(-r * 0.025, r * 0.025) : 0),
                    // 第二道环多抖一点：山脚林线的上沿不能是一条水平绿腰带
                    y: -8 + h * Y[L] + rand(-h * (L === 1 ? 0.045 : 0.008), h * (L === 1 ? 0.045 : 0.008)),
                    z: cz + Math.sin(jA[i]) * rr
                });
            }
            rings.push(ring);
        }
        for (let L = 0; L < LAYERS - 1; L++) {
            for (let i = 0; i < sides; i++) {
                const j = (i + 1) % sides, a = jA[i];
                const lit = 0.60 + 0.40 * clamp(0.5 - 0.55 * Math.cos(a) + 0.35 * Math.sin(a), 0, 1);
                let hex;
                // 绿面只保留山脚林带 + 山腰一条稀疏苔缝；崖壁上的绿交给「崖壁松」，
                // 否则按扇区整块染色，远看会像贴了一张绿纸
                if (L === 0 && ((i * 7 + seed) % 5) < 4) hex = MTN_GREEN[(i + seed) % 2 ? 0 : 2];
                else if (L === 1 && (i * 5 + seed) % 7 === 0) hex = MTN_MOSS;
                else hex = MTN_ROCK[L === 0 ? 0 : L <= 2 ? 1 : ((i + seed) % 4 === 0 ? 3 : 2)];
                let k = lit * jS[i] * (0.92 + 0.02 * L);
                if (L % 3 === 2) k *= 0.90;                 // 横向岩层：每三层压一条深带
                if (crev[i] < 1) k *= 0.76;                 // 竖向深缝再压暗，崖壁才不是一整块平面
                quad(rings[L][i], rings[L + 1][i], rings[L + 1][j], rings[L][j], emit(hex, k, fog));
            }
        }
        // 顶面：边缘参差、中心偏移的岩台，不是一刀切平的盖
        const top = rings[LAYERS - 1];
        const ctr = {
            x: cx + rand(-r * 0.12, r * 0.12),
            y: -8 + h + rand(-1.0, 0.8),
            z: cz + rand(-r * 0.12, r * 0.12)
        };
        for (let i = 0; i < sides; i++) {
            tri(top[i], ctr, top[(i + 1) % sides],
                emit(MTN_GREEN[2], 0.88 + 0.16 * Math.cos(jA[i]), fog));
        }
        // 崖顶林：沿顶缘一圈 + 内部几棵，形成起伏的林冠线（不是一撮绿点）
        const topR = r * K[LAYERS - 1];
        const nTree = pillar ? (seed % 2) : (pointed ? 3 : (fog > 0.4 ? 6 + (seed % 3) : 10 + (seed % 5)));
        for (let t = 0; t < nTree; t++) {
            const a = rand(0, TAU), d = (0.15 + 0.85 * Math.sqrt(Math.random())) * topR * 0.94;
            pine(cx + Math.cos(a) * d, -8 + h, cz + Math.sin(a) * d,
                h * rand(0.12, 0.20), fog, fog < 0.25 && !pillar);
        }
        // 山脚林：山根围一圈矮树，远看是一条深绿林线，把山从地面「托」起来
        if (!pillar) {
            const nFoot = fog > 0.4 ? 5 + (seed % 3) : 9 + (seed % 5);
            for (let t = 0; t < nFoot; t++) {
                const a = rand(0, TAU), d = r * rand(1.18, 1.62);
                pine(cx + Math.cos(a) * d, -0.5, cz + Math.sin(a) * d,
                    h * rand(0.08, 0.13), fog, false);
            }
        }
        // 崖壁斜松：从崖壁不同高度向外斜伸，像黄山那种挂在岩缝里的松（只做近/中景）。
        // 崖壁上真正的绿色靠它们，不靠把整个扇区染绿。
        if (fog < 0.3 && !pillar && !pointed) {
            const nCliff = 3 + (seed % 3);
            for (let t = 0; t < nCliff; t++) {
                const L = 1 + (t % 6), i = (seed * 7 + t * 5) % sides;
                const p = rings[L][i];
                pine(p.x, p.y, p.z, h * rand(0.12, 0.18), fog, true,
                    Math.cos(jA[i]) * 0.95, Math.sin(jA[i]) * 0.95);
            }
        }
    };

    // 峰丛：主峰 + 错得更开的副峰 + 1~2 根独立细石柱。
    // 副峰距离从 0.70r 拉到 0.95~1.45r，峰与峰之间留出山谷和空隙 ——
    // 这是「峰林」和「一整块山」的分界：石柱把大块体量切开，轮廓才有陡峭的竖向节奏。
    const cluster = (cx, cz, r, h, fog, seed) => {
        peak(cx, cz, r, h, fog, seed);
        const n = 1 + (seed % 2);
        for (let i = 0; i < n; i++) {
            const a = rand(0, TAU), d = r * rand(0.95, 1.45);
            peak(cx + Math.cos(a) * d, cz + Math.sin(a) * d,
                r * rand(0.40, 0.62), h * rand(0.48, 0.80), fog, seed + i * 17 + 7);
        }
        const np = 1 + (seed % 2);
        for (let i = 0; i < np; i++) {
            const a = rand(0, TAU), d = r * rand(1.15, 1.75);
            peak(cx + Math.cos(a) * d, cz + Math.sin(a) * d,
                r * rand(0.16, 0.28), h * rand(0.55, 1.05), fog, seed + i * 29 + 3, { pillar: true });
        }
    };

    // 三层纵深：近景崖、中景峰林、远景淡蓝山影。
    // 半径整体收窄（高宽比 4~5.5），山体才会「陡」而不是「胖」；高度继续错开，山脊线才有起伏。
    const RANGES = [
        { n: 11, z: -178, zJ: 24, h: [42, 68], r: [11, 19], x: [-190, 230], fog: 0.00 },
        { n: 13, z: -266, zJ: 32, h: [68, 108], r: [16, 26], x: [-260, 300], fog: 0.26 },
        { n: 15, z: -372, zJ: 44, h: [98, 142], r: [24, 38], x: [-340, 380], fog: 0.55 },
    ];
    for (let ri = 0; ri < RANGES.length; ri++) {
        const R = RANGES[ri];
        for (let i = 0; i < R.n; i++) {
            if (i % 7 === 3) continue;                         // 留山口，别连成一堵墙
            const x = R.x[0] + (R.x[1] - R.x[0]) * (i + 0.5) / R.n + rand(-16, 16);
            const z = R.z + rand(-R.zJ, R.zJ);
            const h = rand(R.h[0], R.h[1]) * (i % 4 === 0 ? 1.18 : rand(0.78, 1.05));  // 高低错落
            cluster(x, z, rand(R.r[0], R.r[1]), h, R.fog, i * 13 + ri * 101);
        }
    }
    // 中央两座主峰压住视线：保持瘦高（加宽会变成墩），靠体量与周围拉开
    cluster(-72, -306, 48, 142, 0.16, 991);
    cluster(88, -338, 52, 156, 0.22, 992);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(POS, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(NRM, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(CLR, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, LAKE_MTN_MAT);
    mesh.userData.noMerge = true;      // 已经是整体了，别再被静态合批复制一份
    worldGroup.add(mesh);
}

function buildLakesideWorld() {
    addMesh(flat(14, 340), std(0xffffff, { map: groundTex, roughness: 1 }), 0, 0, -150);
    addMesh(flat(60, 340), std(0x9a9a92, { roughness: 1 }), -34, 0.01, -150);
    addMesh(flat(160, 340), lakeMat, 87, -0.3, -150);   // 湖面

    // 流动水纹层：透明底 + 深浅交错的细长水纹，靠 texScroll 持续滚动产生水流感。
    // 没有白色闪点、没有涟漪圈，只是水在缓慢地流。
    flowTex = makeTex(256, 256, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        // 柔和的横向水带：以深蓝暗带为主、极淡的浅色压在旁边，滚动时看得出水在流。
        // 不用白色闪点、不画涟漪环，所以不会有「波光粼粼」的高光感。
        for (let i = 0; i < 26; i++) {
            const y = rand(0, h), bh = rand(4, 12);
            const g = c.createLinearGradient(0, y, 0, y + bh);
            g.addColorStop(0, 'rgba(10,52,86,0)');
            g.addColorStop(0.5, `rgba(10,52,86,${rand(0.10, 0.22)})`);
            g.addColorStop(1, 'rgba(10,52,86,0)');
            c.fillStyle = g;
            c.fillRect(0, y, w, bh);
            if (i % 2 === 0) {
                c.fillStyle = `rgba(164,214,236,${rand(0.03, 0.07)})`;
                c.fillRect(0, y + bh + 1, w, 2);
            }
        }
        // 细水纹叠在宽带上补细节，同样不含高光
        for (let i = 0; i < 150; i++) {
            const y = rand(0, h), len = rand(24, 120), x = rand(0, w);
            c.fillStyle = `rgba(16,62,96,${rand(0.06, 0.14)})`;
            c.fillRect(x, y, len, rand(1, 2));
        }
    }, 2.5, 14);           // y 方向 14 次重复：每条约 1~3m 宽的水带，远近都看得见
    flowTex.userData.shared = false;   // 随世界一起销毁
    addMesh(flat(160, 340), new THREE.MeshBasicMaterial({ map: flowTex, transparent: true, opacity: 0.85, depthWrite: false }),
        87, -0.26, -150, { receive: false });
    THEMES.lakeside.texScroll = [[groundTex, 4], [trackTex, 2], [flowTex, 14]];   // 水流慢一点，是流不是闪
    // 护城河也去掉波光：保持原来的深蓝水面，不再注入 shine。
    // 校园水面仍用 ART.applyWaterShine，那段注入与湖畔无关。

    for (const lx of LANES) {
        addMesh(flat(2.4, 340), std(0xffffff, { map: trackTex, roughness: 1 }), lx, 0.02, -150);
        for (const off of [-0.55, 0.55]) addMesh(new THREE.BoxGeometry(0.1, 0.14, 340), railMat, lx + off, 0.07, -150);
        // 接触网：接触线 + 承力索（与钢轨同理，全线贯通的静态长条）
        addMesh(new THREE.BoxGeometry(0.024, 0.024, 340), wireMat, lx, 4.72, -150, { receive: false });
        addMesh(new THREE.BoxGeometry(0.02, 0.02, 340), wireMat, lx, 5.55, -150, { receive: false });
    }
    addMesh(new THREE.BoxGeometry(0.4, 1.0, 340), wallMat, -4.3, 0.5, -150, { cast: true });
    addMesh(new THREE.BoxGeometry(0.3, 0.6, 340), wallMat, 4.3, 0.3, -150, { cast: true });

    // 群山：灰岩峰柱 + 崖顶松林，三层纵深环抱湖畔（实现见 buildLakesideMountains）
    buildLakesideMountains();
    // 云团留在山腰之间，接住「黄山云海」那层空气感（原来的云不用改）
    for (let i = 0; i < 8; i++) {
        const g = new THREE.Group();
        for (let j = 0; j < 5; j++) {
            const s = new THREE.Mesh(new THREE.SphereGeometry(rand(6, 11), 10, 8), cloudMat);
            s.position.set(j * 9 - 18, rand(-2, 4), rand(-3, 3));
            g.add(s);
        }
        g.position.set(-200 + i * 55 + rand(-10, 10), rand(45, 70), -280 - rand(0, 40));
        g.scale.y = 0.6;
        worldGroup.add(g);
    }
}

// =====================================================================
