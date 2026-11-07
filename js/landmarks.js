// ============================================================================
//  js/landmarks.js —— 地标 GLB 接入层
//
//  作用：把美术做的 .glb 地标接进「代码生成」的那套体系里，同时保住三件事：
//    · 324m 循环（槽位、广场、台基仍由 oldtown.js 负责，GLB 只填塔身）
//    · 亮度预算（材质按名字分类，自动挂上 ATMO 的昼夜发光曲线）
//    · 性能（每个 GLB 原型只加载一次，放置时 clone；材质共享，不重复编译）
//
//  建模约定（美术必须遵守，详见 docs/landmark-glb-spec.md）：
//    · 单位是米，原点在「底面中心」，y=0 就是地面
//    · 正面朝局部 -x（接入时会按街道左右自动转 180°）
//    · 材质名带语义：window / neon / trim / mass，接入时按名字注入发光
//
//  夜间灯光（2026-11-01 重做，第二版）：
//    这几座 GLB 都是「单材质 + 白天烘焙贴图」，墙面比窗还亮。之前拿贴图当
//    emissiveMap 再整体提亮，夜里就是一整块发白的板子（没有层次、更谈不上灯效）。
//
//    现在的做法是**用几何灯带**：
//      ① 注册时扫一遍顶点，按 2m 一层、24 个方位记下「每层的截面半径」——等于
//         给模型拍了一张低分辨率的侧面轮廓。
//      ② 按 11 个高度（8%~91%）生成光带，每根光带的半径取该高度实测轮廓的 1.04 倍，
//         所以它是**贴着塔身**的：明珠的球面、春笋的收腰、国贸的方柱都对得上，
//         不会像圆环那样浮在半空。
//      ③ 颜色按高度走：脚部暖琥珀 → 塔身青白 → 冠部冷蓝，越往上越收敛。
//         再叠基座泛光池 / 冠部灯圈 / 塔顶红色信标，四层光从下往上读得出来。
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

export function createLandmarkGLB({ THREE, ATMO }) {

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
