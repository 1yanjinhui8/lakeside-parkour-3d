// ── 主逻辑片段 08/08 ──────────────────────────────
// 分节：每帧更新 + 操作 + 界面 + 浏览器内自检（?selftest 或控制台 __game.selfTest()） + 主循环
// 按编号顺序合起来 = src/game.module.js 的全部逻辑（资源已用占位符替代）
// 生成自 playable.html，勿手改；重跑 tools/extract-src.py 同步
// ────────────────────────────────────────────────────────────────

//  ⑬ 每帧更新
// =====================================================================
function updatePlaying(dt) {
    // 主题可带 speedMul：校园两图压一档（跑速按绝对里程涨，到第 4 段已经太快）
    const _spdMul = (THEMES[curTheme] && THEMES[curTheme].speedMul) || 1;
    const _rawSpeed = CONFIG.speed.start * Math.pow(CONFIG.speed.factor, Math.floor(S.D / CONFIG.speed.step));
    S.speed = Math.min(speedBaseCap(), _rawSpeed) * _spdMul;
    topSpeedTick();                       // 首次到达 1.6x 封顶时提示难度联动开启
    // [PKVS] 对局内速度可能被干扰压低，或被冻结（倒计时 / 冲线等待）
    const step = S.speed * dt * (typeof window.__pkSpeedMul === 'function' ? window.__pkSpeedMul() : 1);
    S.D += step;
    scrollWorld(step, S.D);
    updateScene(dt);

    // [PKVS] 双人对战：生成期把 Math.random 换成 seed 流，两端障碍布局一致。
    // 行距里的速度用「该行的里程」算，避免速度档位差在两端累计漂移。
    if (Scene.phase === 'run' && S.nextRowS < S.D + SPAWN_DIST) {
        const pkRnd = window.__pkRnd, pkReal = Math.random;
        if (pkRnd) Math.random = pkRnd;
        try {
            while (Scene.phase === 'run' && S.nextRowS < S.D + SPAWN_DIST) {
                spawnRow(S.nextRowS);
                const spd = pkRnd
                    ? Math.min(speedBaseCap(), CONFIG.speed.start * Math.pow(CONFIG.speed.factor, Math.floor(S.nextRowS / CONFIG.speed.step)))
                    : S.speed;
                // 极速阶段障碍数量 ×1.5：行距缩到 1/1.5。26m 是反应距离地板
                // （24m/s 约 1.1s），再密就来不及换道了。
                const gap = 20 + spd * 0.7 + Math.random() * 14;
                S.nextRowS += Math.max(26, gap / (atTopSpeed() ? TOP_OBSTACLE_MUL : 1));
            }
        } finally {
            if (pkRnd) Math.random = pkReal;
        }
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
        const o = obstacles[i];
        // 极速阶段：只放大障碍「自己迎面开」的那部分速度，不是整体时间流速
        if (o.moving) o.extra = S.speed * (o.extraRate || 0.45) * topMovingMul();
        o.z += step + o.extra * dt;
        if (o.wobble) {   // 校园·自行车轻微横移（碰撞用实时 x）
            o.x = o.baseX + wobbleOffset(S.D, o.wobble);
        }
        placeOnTrack(o.mesh, o.x, 0, o.z);
        if (o.z - o.len / 2 > 12) { disposeObj(o.mesh); obstacles.splice(i, 1); }
    }

    for (const k in S.power) S.power[k] = Math.max(0, S.power[k] - dt);
    S.stumbleCool -= dt;
    S.chaserTimer -= dt;
    if (S.rolling > 0) S.rolling -= dt;
    S.landGrace -= dt;
    S.transGrace = Math.max(0, (S.transGrace || 0) - dt);
    S.climbPulse = Math.max(0, (S.climbPulse || 0) - dt);

    // 横向移动
    S.x += (LANES[S.lane] - S.x) * Math.min(1, dt * 14);

    // 起跳蓄力（预备动作）：计时结束才真正给向上的速度
    if (S.anticip > 0) {
        S.anticip -= dt;
        if (S.anticip <= 0) { S.anticip = 0; applyJumpImpulse(); }
    }

    // —— 飞行器状态机：起飞 / 巡航（↑爬升 ↓俯冲）/ 收翼降落 / 落地缓冲 ——
    const fl = S.flight;
    // 下落时把这帧的位移量喂给站立面判定（高速下落也能稳稳踩上车顶）
    const _drop = S.vy < 0 ? Math.min(1.6, -S.vy / 60 * 1.8 + (-S.vy) * 0.02) : 0;
    const groundY = surfaceAt(S.x, S.y, _drop);
    if (fl.active) {
        const prevY = S.y;
        stepFlight(fl, dt, { climb: !!(S.holdUp || S.climbPulse > 0), dive: !!S.holdDown }, { groundY, timeLeft: S.power.wings });
        S.y = fl.y;
        S.vy = (S.y - prevY) / Math.max(dt, 1e-4);
        S.grounded = false;
        S.rolling = 0;
        S.flying = true;
        if (fl.landed && !fl.landHandled) {
            fl.landHandled = true;
            ANIM.land = ANIM_CFG.landTime;
            S.landGrace = 0.45;
            S.speed = Math.min(speedBaseCap(), S.speed + 1.5);
            SFX.shield();
            showMsg('🕊 王从天降！');
        }
        if (fl.done) { S.power.wings = 0; fl.landHandled = false; }
    } else {
        S.flying = false;
        const g = groundY;
        if (S.vy > 0 || S.y > g + 0.01) {
            S.vy -= CONFIG.jump.gravity * dt;
            S.y += S.vy * dt;
            if (S.y <= g) {
                const src = standOb, vyIn = S.vy;
                if (!S.grounded && S.vy < -3) ANIM.land = ANIM_CFG.landTime;   // 落地缓冲
                S.y = g; S.vy = 0; S.grounded = true;
                // 城市·车顶弹跳：落在小汽车顶上自动弹起
                const b = bounceImpulse(src, vyIn, Scene.id);
                if (b > 0) {
                    S.vy = b;
                    S.grounded = false;
                    SFX.jump();
                    showMsg('🚗 车顶弹跳！');
                }
            } else S.grounded = false;
        } else {
            S.y = g; S.vy = 0; S.grounded = true;
        }
        if (S.grounded) S.airJumps = 0;      // 落地清零二段跳计数
    }

    if (!S.flying) checkCollisions(dt);
    if (S.state !== 'playing') return;

    // 金币
    const cy = S.y + (S.rolling > 0 ? 0.4 : 0.9);
    for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        if (S.power.magnet > 0 && c.z > -30 && c.z < 2) c.magnet = true;
        if (c.magnet) {
            const k = Math.min(1, dt * 12);
            c.x += (S.x - c.x) * k; c.y += (cy - c.y) * k; c.z += (0 - c.z) * k;
        } else {
            c.z += step;
        }
        placeOnTrack(c.mesh, c.x, c.y, c.z);
        trackSpin(c.mesh, dt, 4);
        const dx = c.x - S.x, dy = c.y - cy, dz = c.z;
        if (dx * dx + dy * dy + dz * dz < 1.1) {
            S.coins += S.power.double > 0 ? 2 : 1;
            SFX.coin();
            scene.remove(c.mesh); coins.splice(i, 1);
        } else if (c.z > 4) {
            scene.remove(c.mesh); coins.splice(i, 1);
        }
    }

    // 道具
    for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        p.z += step;
        placeOnTrack(p.mesh, p.x, p.y + Math.sin(S.D * 0.2) * 0.15, p.z);
        p.mesh.userData.icon.rotation.y += dt * 3;
        if (p.mesh.userData.ring) p.mesh.userData.ring.rotation.z += dt * 1.4;
        if (p.mesh.userData.halo) p.mesh.userData.halo.scale.setScalar(1 + Math.sin(S.D * 0.3) * 0.07);
        const dx = p.x - S.x, dy = p.y - cy, dz = p.z;
        const hitR = p.type === 'revive' ? 3.4 : 1.7;    // 复活币体积大，判定放宽，别擦肩而过
        if (dx * dx + dy * dy + dz * dz < hitR) {
            if (p.type === 'revive') takeRevive();
            // [PKVS] 干扰道具：不进自己的 power 计时，吃到立刻打对手
            else if (p.type.indexOf('pk_') === 0) {
                if (typeof window.__pkPickItem === 'function') window.__pkPickItem(p.type.slice(3));
                else showMsg('获得 ' + CONFIG.powerUps[p.type].name + '！');
            }
            else {
                S.power[p.type] = powerDur(p.type);
                if (p.type === 'wings') startFlight();
                else { SFX.power(); showMsg('获得 ' + CONFIG.powerUps[p.type].icon + ' ' + CONFIG.powerUps[p.type].name + '！'); }
            }
            disposeObj(p.mesh); pickups.splice(i, 1);
        } else if (p.z > 4) {
            disposeObj(p.mesh); pickups.splice(i, 1);
        }
    }

    S.score = Math.floor(S.D) + S.coins * CONFIG.coinScore;

    // —— 角色动画（状态机 + 帧率无关平滑 + 次级运动） ——
    S.phase += dt * (8 + S.speed * 0.28);
    const instVx = (S.x - S.prevX) / Math.max(dt, 1e-4);
    S.prevX = S.x;
    S.vx = damp(S.vx, instVx, 12, dt);
    const poseState = {
        phase: S.phase, speed: S.speed, vx: S.vx, vy: S.vy,
        grounded: S.grounded, flying: S.flying,
        rolling: S.rolling, rollProg: S.rolling > 0 ? 1 - S.rolling / ROLL_TIME : 0,
        anticip: S.anticip, climb: S.holdUp ? 1 : (S.holdDown ? -1 : 0), wing: S.flight.open,
    };
    stepAnim(ANIM, dt, poseState);
    applyPose(player, ANIM, poseState);
    if (player.sync) player.sync();
    updateWings(dt, S.flight.open, poseState.climb);
    player.root.position.set(S.x, S.y, 0);
    player.root.rotation.y = damp(player.root.rotation.y, 0, 10, dt);   // 菜单展示时转身，开局转回前方
    const shake = S.stumbleCool > 0 ? Math.sin(S.stumbleCool * 45) * 0.2 * S.stumbleCool : 0;
    player.root.rotation.z = (S.x - LANES[S.lane]) * 0.12 + shake + ANIM.lean * 0.05;
    shieldBubble.visible = S.power.shield > 0;
    shieldBubble.material.opacity = 0.18 + Math.sin(S.D * 0.3) * 0.07;
    if (player.shoeMat) player.shoeMat.color.setHex(S.power.sneakers > 0 ? CONFIG.powerUps.sneakers.color : player.baseShoe);

    // 追捕者：平时在镜头后面，绊倒后会追到身后
    const target = S.chaserTimer > 0 && !S.flying ? 2.2 : 16;
    S.chaserDist += (target - S.chaserDist) * Math.min(1, dt * 2);
    updateChaser(dt, S.chaserDist);
}

function updateChaser(dt, dist) {
    const visible = dist < 12;
    chaser.root.visible = visible;
    // 站在玩家斜后方，避免挡住镜头
    // 固定在玩家右后方跟随（边道时夹在路基内）；原来 lane 2 会换侧，目标瞬间跳 3.8m 导致猛蹿
    const tx = Math.max(-3.3, Math.min(3.3, S.x + 1.9));
    const cx = chaser.px == null ? tx : chaser.px;   // 跑道系里的横向位置（校园要投影）
    chaser.px = cx + (tx - cx) * Math.min(1, dt * 4);
    placeOnTrack(chaser.root, chaser.px, 0, dist);
    // 不在视野里（dist ≥ 12）就跳过整段动画：保安有 17 根骨骼 + 几十次矩阵运算，
    // 每帧白算是明显的 CPU 浪费。相位由 S.phase 驱动，重新出现时姿态自然衔接。
    if (!visible) return;
    const p = S.phase * 1.05 + 1;
    stepAnim(CHASER_ANIM, dt, { grounded: true, speed: S.speed, phase: p });
    poseRun(chaser, CHASER_ANIM, { phase: p, speed: S.speed, grounded: true });
    if (chaser.hasModel) {
        guardClock += dt;
        const TAU = Math.PI * 2;
        const stepHz = 1.35;
        const ph = guardClock * TAU * stepHz;
        const chasing = S.chaserTimer > 0;
        const cyc = 2.6;
        const pt = (guardClock % cyc) / cyc;
        const punch = chasing && pt < 0.16 ? Math.sin(pt / 0.16 * Math.PI) : 0;
        const b = chaser.bones;
        if (b && b.LeftUpLeg && b.RightUpLeg) {
            // 人类跑步步态（17 骨 Mixamo 命名，真膝/肘关节）
            // 骨骼方向约定（已实测）：腿/臂骨 +x=向后摆，膝 +x=屈膝，肘 -x=屈肘，脊柱 +x=前倾
            // 臂骨 z：左臂 -z=外展，右臂 +z=外展（模型静止时手臂外张约35°，略收一点避免"鸡翅肘"）
            // 髋：前屈约40°、后伸约19°（总摆幅约59°，参考值 60~70°）
            // 膝：触地约23°、支撑期 23~32°，摆动期峰值约110°（参考值 90~110°，快跑可达120°+）
            // 肩：企鹅式贴身轻摆，前后各约13°（圆胖模型大摆臂会把肩膀皮肤拉裂），与同侧腿对摆
            // 肘：模型是短圆鳍状臂，不屈肘，保持自然下垂贴身体（屈90°会把前臂甩成扇面突出来）
            const HIP_MID = 0.21, HIP_AMP = 0.54;
            const SH_MID = 0.0, SH_AMP = 0.22, ARM_Z = 0.12;
            const hipX = (p) => -(HIP_MID + HIP_AMP * Math.cos(p));   // cos=1 时最大前屈（触地）
            const kneeX = (p) => {
                const u = (((p % TAU) + TAU) % TAU) / TAU;            // 0=触地 0.5=离地 1=触地
                if (u >= 0.5) return 0.40 + 1.50 * Math.pow(Math.max(0, Math.sin((u - 0.5) * 2 * Math.PI)), 0.9); // 摆动期收腿，峰值约110°
                return 0.40 + 0.15 * Math.sin(Math.PI * Math.min(1, u / 0.5));                                    // 支撑期微屈，触地约23°
            };
            const phR = ph + Math.PI;
            b.LeftUpLeg.rotation.x = hipX(ph);
            b.RightUpLeg.rotation.x = hipX(phR);
            b.LeftLeg.rotation.x = kneeX(ph);
            b.RightLeg.rotation.x = kneeX(phR);
            b.LeftArm.rotation.x = SH_MID + SH_AMP * Math.cos(ph);
            b.RightArm.rotation.x = SH_MID - SH_AMP * Math.cos(ph) - punch * 1.1;   // 出拳叠加在摆臂上
            b.LeftArm.rotation.z = -ARM_Z;                            // 略外展，肘部避开大肚子
            b.RightArm.rotation.z = ARM_Z;
            b.LeftForeArm.rotation.x = 0;                                          // 短圆鳍状臂：肘不屈，保持下垂贴身体
            b.RightForeArm.rotation.x = punch * 1.0;                              // 只有追上出拳时才伸肘
            b.Spine.rotation.x = 0.06;    // 略微前倾
            b.Head.rotation.x = -0.02;
            b.Hips.rotation.x = 0;
        }
        // 不再做整体起伏/扭动，避免"抖"的观感
        chaserModel.position.y = 0;
        chaserModel.position.z = 0;   // 出拳只挥臂，身体不再每 2.6s 前蹿一次
        chaserModel.rotation.x = -0.04;
        // 朝向：脸朝向玩家，但限制转身速度——玩家换道时 dx 会扫过好几米，
        // 直接跟踪 atan2 目标会让身体朝向高速来回甩（就是之前看到的"抖"）
        const px = player.root.position.x, pz = player.root.position.z;
        const dx = px - chaser.root.position.x, dz = pz - chaser.root.position.z;
        const targetYaw = Math.atan2(dx, dz);
        if (chaser.yaw == null) chaser.yaw = targetYaw;
        let dy = targetYaw - chaser.yaw;
        while (dy > Math.PI) dy -= TAU;
        while (dy < -Math.PI) dy += TAU;
        const maxTurn = 1.2 * dt;                  // 每秒最多转约 69°，平滑转身不甩动
        chaser.yaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
        chaserModel.rotation.y = chaser.yaw;
    }
}

function updateDying(dt) {
    S.dieT += dt;
    const step = S.speed * Math.max(0, 1 - S.dieT * 3) * dt;
    S.D += step;
    scrollWorld(step, S.D);
    for (const o of obstacles) { o.z += step; placeOnTrack(o.mesh, o.x, 0, o.z); }
    for (const c of coins) { c.z += step; placeOnTrack(c.mesh, c.x, c.y, c.z); }
    for (const p of pickups) { p.z += step; placeOnTrack(p.mesh, p.x, p.y, p.z); }

    if (S.y > 0 && surfaceAt(S.x, S.y) < S.y) { S.vy -= CONFIG.jump.gravity * dt; S.y = Math.max(surfaceAt(S.x, S.y), S.y + S.vy * dt); }
    player.root.position.set(S.x, S.y, 0);
    poseFall(player, ANIM);
    if (player.sync) player.sync();
    updateWings(dt, false, 0);

    S.chaserDist += (1.6 - S.chaserDist) * Math.min(1, dt * 3);
    updateChaser(dt, S.chaserDist);
    if (S.dieT > 0.6) poseFall(chaser, CHASER_ANIM);
    else S.phase += dt * 12;

    if (S.dieT > 1.6 && !S.overShown) showGameOver();
}

function updateMenu(dt) {
    S.D = (S.D || 0) + 6 * dt;
    scrollWorld(6 * dt, S.D);
    S.phase = (S.phase || 0) + dt * 9;
    S.menuT = (S.menuT || 0) + dt;
    // 转身面向镜头，展示角色细节（脸、推到头顶的墨镜、连帽外套）
    player.root.rotation.y = damp(player.root.rotation.y, Math.PI * 0.97, 2.8, dt);
    player.root.rotation.z = 0;
    stepAnim(ANIM, dt, { grounded: true, speed: 0, phase: S.menuT });
    if (player.isModel) poseModelIdle(player, ANIM, S.menuT); else poseShowcase(player, ANIM, S.menuT);
    if (player.sync) player.sync();
    // 站到画面右侧，避开菜单中间的按钮和按键提示
    player.root.position.set(1.6, 0, 0);
    updateWings(dt, 0, 0);
    chaser.root.visible = false;
}

// ---------- 相机 ----------
// ---- 内联模块：js/OrbitFanfareCamera.js（终点环绕过场镜头） ----
const OrbitFanfareCamera = (function () {
/**
 * ============================================================================
 *  OrbitFanfareCamera · 终点环绕过场镜头（Orbit Fanfare Camera）
 * ============================================================================
 *  纯 ES Module，唯一外部依赖是 three（在 r160 上验证通过，r150+ 理论可用）。
 *
 *  ── 职责边界（很重要，别越界） ──────────────────────────────────────────
 *   ✅ 本模块【只】生产相机位姿（position + quaternion + 可选 fov）。
 *   ✅ 不监听碰撞 / 触发器 —— "何时算到终点" 由调用方判断，然后调 play(target)。
 *   ✅ 不碰 Animator / AnimationMixer —— 通过 onStart / onOrbitStart / onProgress /
 *      onComplete / onSkip 回调把进度告诉你，角色摆什么姿势完全由你决定。
 *   ✅ 不认识你的输入系统 —— 通过 onInputLockChange(locked) 告诉你"该锁"还是"该放"，
 *      你自己接到自己的输入管理器上。模块不知道"输入"在你游戏里长什么样。
 *
 *  ── 帧更新的驱动方式：这里选【调用方驱动 update(delta)】，不自建 rAF ────────
 *   理由（3 条，都是踩过的坑）：
 *     1. 你的游戏必然已经有一个 rAF / renderer.setAnimationLoop 主循环。模块内部再
 *        开一个 rAF 就会出现两套时钟，同帧被步进两次或先后顺序错乱（相机比场景晚一
 *        帧 → 视觉拖影/抖动）。
 *     2. 交给调用方步进，暂停菜单、timeScale、录像回放、逐帧调试都能自然生效。
 *     3. delta 由调用方给，天然与帧率解耦：30fps / 60fps / 120fps 下转速完全一致。
 *   如果你的工程确实没有主循环（例如裸 canvas 试验），自己包 5 行即可：
 *
 *      const clock = new THREE.Clock();               // ← 只 new 一次
 *      function tick() {
 *        requestAnimationFrame(tick);
 *        fanfare.update(clock.getDelta());            // ← 本模块的唯一入口
 *        renderer.render(scene, camera);
 *      }
 *      tick();
 *
 *   注意：clock.getDelta() 每帧只能被调用一次，多处调用会互相"吃掉"时间。
 *
 *  ── 坐标系约定 ────────────────────────────────────────────────────────
 *   假定 Y-up（three.js 默认）。若你的场景是 Z-up，改 UP 常量与球坐标的极轴即可，
 *   本模块不硬编码重力方向以外的假定。
 * ============================================================================
 */

// 内联版：THREE 由宿主主模块提供，不再单独 import

const TWO_PI = Math.PI * 2;
/** 环绕轨道的极轴（Y-up） */
const UP = new THREE.Vector3(0, 1, 0);

/** 缓动：ease-in-out（三次）。用于切入 / 切出，避免生硬加减速 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 数值夹取（避免调用方传 Δ 时还要 import MathUtils） */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 有限数字判断 */
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/* ==========================================================================
 *  ★★★ 所有可调参数都集中在这里，改这里就够了 ★★★
 * ========================================================================== */
const DEFAULT_OPTIONS = {
  // ── 时长（秒）────────────────────────────────────────────────────────
  /** 切入时长：从"当前相机位姿"平滑过渡到环绕轨道起点 */
  introDuration: 1.0,
  /**
   * 切入的"峰值速度预算"，单位是 **每秒多少个角色身高**（不是绝对距离，这样换体型
   * 体型/世界尺度都不用改参数）。<=0 表示关闭自适应。
   *
   * 为什么需要它：切入位移完全取决于调用前相机离角色多远。正常跟随时只有几个单位，
   * 1 秒很舒服；但如果你做了角色瞬移 / 重生 / 关卡跳转，相机可能在 20 单位外，
   * 1 秒飞过来就成了"甩镜"。这个预算会把切入时长自动拉长到峰值速度不超过预算。
   * 默认 13 ≈ 1.8m 的角色对应 23 u/s 的峰值，常规跟随机位（约 5~6 单位）算下来
   * 只需要 0.7 秒，短于 1 秒 → 不会改变默认手感。
   */
  introSpeedBudget: 13,
  /** 自适应拉长后的切入时长上限（秒），防止极远距离导致切入过长 */
  introDurationMax: 3.0,
  /**
   * 主环绕时长：转满 360° 所需时间。
   * 默认 10s = 36°/s，属于"缓慢"档。想要"全程正好 10 秒"就把这个设 8
   * （8 + 1 + 1 = 10）。见 docs 参数表。
   */
  orbitDuration: 10.0,
  /** 切出时长：从结束机位平滑过渡回"交还机位"（默认 = 进场时捕获的那个跟随相机位姿） */
  outroDuration: 1.0,
  /** 切出的峰值速度预算，语义同 introSpeedBudget */
  outroSpeedBudget: 13,
  /** 切出时长上限（秒） */
  outroDurationMax: 3.0,

  // ── 轨道几何（单位 = 你的世界单位，通常为米）───────────────────────────
  /** 水平轨道半径。null = 依据角色包围盒身高 + 相机 FOV 自动推算一个能完整入画的默认值 */
  orbitDistance: null,
  /** 轨道相对"聚焦点"的垂直高度。null = 由 orbitDistance × tan(orbitPitchDeg) 自动推算 */
  orbitHeight: null,
  /** 自动推算高度时使用的仰角（度）。正值 = 相机略高于聚焦点，俯视角色 */
  orbitPitchDeg: 12,
  /**
   * 聚焦点在角色包围盒内的相对高度：0 = 脚底，1 = 头顶。
   * 0.62 ≈ 胸口/下巴，最适合"人物居中"的构图。
   */
  focusHeightRatio: 0.62,
  /**
   * 自动推算距离时的取景占比：角色身高占画面垂直高度的比例。
   * 0.5 = 角色约占画面一半高，上下各留 1/4 空白；0.7 以上会显得逼仄。
   */
  framingFill: 0.5,
  /** 环绕方向：true = 正向（theta 递增），false = 反向 */
  clockwise: true,

  // ── 镜头 ────────────────────────────────────────────────────────────
  /** 过场期间的目标 FOV。null = 完全不碰相机的 fov（推荐先保持 null） */
  fov: null,

  // ── 行为 ────────────────────────────────────────────────────────────
  /** 是否允许中途跳过（按键 / 点击） */
  allowSkip: true,
  /** 触发跳过的 KeyboardEvent.code 列表 */
  skipKeys: ['Space', 'Escape', 'Enter'],
  /** 是否允许鼠标/触摸按下即跳过 */
  skipOnPointer: true,
  /**
   * 单帧 delta 上限（秒）。切标签页 / 断点调试回来后 delta 可能是几十秒，
   * 不夹取会瞬间跳完整段动画。0.1 ≈ 允许的最低 10fps。
   */
  maxDelta: 0.1,

  // ── 回调（全部可选，签名见 docs 参数表）─────────────────────────────
  /** () => void  环绕流程开始（切入的第一帧之前） */
  onStart: null,
  /** () => void  切入完成、360° 环绕正式开始（适合此刻让角色播胜利动作） */
  onOrbitStart: null,
  /** (progress: 0..1, cameraPos: Vector3) => void  环绕阶段的每帧进度 */
  onProgress: null,
  /** () => void  已平滑交还机位、输入锁已释放（整个流程结束） */
  onComplete: null,
  /** () => void  用户中途跳过（在切出开始之前触发） */
  onSkip: null,
  /** () => void  播放中被再次 play() 打断（换目标 / 重播） */
  onCancel: null,
  /** (locked: boolean) => void  输入锁状态变化 —— 请在这里禁用你自己的相机控制器 & 角色输入 */
  onInputLockChange: null,
  /**
   * (outPosition: Vector3, outQuaternion: Quaternion) => void
   * 可选：动态指定"交还机位"。你的 CameraRig 有跟随阻尼时，用它把理想位姿写进
   * outPosition / outQuaternion，切出就会精准落位，不会有最后一帧的"啪"一下。
   * 不提供时 = 回到 play() 时捕获的那个位姿。
   */
  getReturnPose: null,
};

/* ========================================================================== */

/** 播放阶段 */
const PHASE = {
  IDLE: 'idle',
  INTRO: 'intro',
  ORBIT: 'orbit',
  OUTRO: 'outro',
};

class OrbitFanfareCamera {
  /**
   * @param {THREE.Camera} camera  你游戏里正在用的那台相机（模块会直接改写它的 pose）
   * @param {Partial<typeof DEFAULT_OPTIONS>} [options]
   */
  constructor(camera, options = {}) {
    if (!camera || !camera.isCamera) {
      throw new Error('[OrbitFanfareCamera] 第一个参数必须是 THREE.Camera 实例');
    }

    this.camera = camera;
    this.options = Object.assign({}, DEFAULT_OPTIONS, options);

    // 本模块直接写 camera.position / camera.quaternion —— 这两个是【局部坐标】。
    // 如果相机挂在某个父节点（CameraRig / 手持抖动节点）下，写进去的位姿会再乘一次
    // 父变换，画面就会偏。这里提前警告，别等到线上才发现。
    if (camera.parent && camera.parent.type !== 'Scene') {
      console.warn(
        '[OrbitFanfareCamera] 相机不是 Scene 的直接子节点（parent = ' +
        (camera.parent.name || camera.parent.type) +
        '）。本模块写的是局部坐标，父节点带变换时画面会偏。' +
        '解决：过场期间把相机 detach 到 Scene 上，或让相机始终是 Scene 的直接子节点。'
      );
    }

    /** @type {THREE.Object3D|null} 当前环绕目标 */
    this.targetObject = null;

    this._phase = PHASE.IDLE;
    this._disposed = false;
    this._inputLocked = false;

    // ── 计时 ──
    this._phaseTime = 0;      // 当前阶段已用时间（秒）
    this._orbitProgress = 0;  // 环绕进度 0..1

    // ── 本次实际使用的切入/切出时长（可能被速度预算自适应拉长）──
    this._introDuration = this.options.introDuration;
    this._outroDuration = this.options.outroDuration;

    // ── 轨道参数（play() 时求解）──
    this._targetHeight = 1.8;
    this._orbitRadiusH = 3.5;   // 水平半径
    this._orbitHeightY = 0.75;  // 相对聚焦点的高度
    this._startAzimuth = 0;     // 环绕起始方位角（弧度）
    this._dir = 1;              // 旋转方向 ±1

    // ── 聚焦点：以"目标物体局部坐标"保存，每帧用 matrixWorld 求出世界坐标，
    //    这样角色走动/转身时环绕中心能跟着走，而不用每帧重算包围盒 ──
    this._focusLocal = new THREE.Vector3();

    // ── FOV 过渡 ──
    this._homeFov = camera.fov;
    this._orbitFov = null;      // 解析后的目标 fov（null = 不启用）
    this._outroFromFov = camera.fov;

    /* ---------------- 每帧复用的临时对象（update 里绝不 new） ---------------- */
    this._vHomePos = new THREE.Vector3();      // 进场时的相机位置 = 默认交还位置
    this._qHomeQuat = new THREE.Quaternion();  // 进场时的相机朝向
    this._vFromPos = new THREE.Vector3();      // 本次切入的起点位置
    this._qFromQuat = new THREE.Quaternion();  // 本次切入的起点朝向
    this._vFocus = new THREE.Vector3();        // 当前聚焦点（世界坐标）
    this._vOrbitStart = new THREE.Vector3();   // 环绕轨道起点位置（每帧可刷新）
    this._qOrbitStart = new THREE.Quaternion();
    this._vOutroFromPos = new THREE.Vector3();
    this._qOutroFromQuat = new THREE.Quaternion();
    this._vReturnPos = new THREE.Vector3();    // 交还位置
    this._qReturnQuat = new THREE.Quaternion();
    this._spherical = new THREE.Spherical(1, Math.PI / 2, 0);
    this._mat4 = new THREE.Matrix4();
    this._qTmp = new THREE.Quaternion();
    this._box = new THREE.Box3();
    this._vSize = new THREE.Vector3();

    /* ---------------- 跳过监听 ---------------- */
    // 绑定成实例属性，dispose 时才能精确移除（匿名函数是移除不掉的经典内存泄漏）
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._listening = false;
    this._attachSkipListeners();
  }

  /* ====================================================================== */
  /*  公开 API                                                              */
  /* ====================================================================== */

  /** 是否正在播放（切入 / 环绕 / 切出 均算 true） */
  get isPlaying() {
    return this._phase !== PHASE.IDLE;
  }

  /** 当前阶段：'idle' | 'intro' | 'orbit' | 'outro' */
  get phase() {
    return this._phase;
  }

  /** 环绕进度 0..1（切入阶段恒 0，切出阶段恒 1） */
  get progress() {
    return this._orbitProgress;
  }

  /** 输入锁是否已上锁（供调试面板显示） */
  get inputLocked() {
    return this._inputLocked;
  }

  /**
   * 启动环绕。
   * 重复调用的语义：
   *   - 播放中再次 play(newTarget)：从"当前这一帧的真实相机位姿"重新切入到新目标的
   *     轨道；不会重建输入锁；会触发 onCancel。
   *   - 空闲时 play()：捕获当前相机位姿作为"交还机位"，上输入锁，触发 onStart。
   *
   * @param {THREE.Object3D} target  要环绕的物体（通常是角色根节点）
   * @returns {boolean} 是否成功启动
   */
  play(target) {
    if (this._disposed) {
      console.warn('[OrbitFanfareCamera] 实例已 dispose，play() 被忽略');
      return false;
    }
    if (!target || !target.isObject3D) {
      console.warn('[OrbitFanfareCamera] play(target) 需要传入 THREE.Object3D');
      return false;
    }

    const wasPlaying = this._phase !== PHASE.IDLE;

    // 1) 本次切入的起点 = 这一帧的真实相机位姿（保证任何情况下都不硬切）
    this._vFromPos.copy(this.camera.position);
    this._qFromQuat.copy(this.camera.quaternion);

    // 2) "交还机位"只在 idle → 播放 时捕获一次。播放中被重新 play() 时保留原始的
    //    跟随相机位姿，否则会把环绕机位当成"家"而原地不动。
    if (!wasPlaying) {
      this._vHomePos.copy(this.camera.position);
      this._qHomeQuat.copy(this.camera.quaternion);
      this._homeFov = this.camera.fov;
    }

    // 3) 量目标 + 解轨道
    this.targetObject = target;
    this._measureTarget();
    this._solveOrbit();

    // 4) 预演一次轨道起点位姿，据此决定本次切入需要多久（远距离自动拉长）
    this._poseAtAngle(this._startAzimuth, this._vOrbitStart, this._qOrbitStart);
    this._introDuration = this._adaptDuration(
      this.options.introDuration,
      this._vFromPos.distanceTo(this._vOrbitStart),
      this.options.introSpeedBudget,
      this.options.introDurationMax
    );

    // 5) 重置计时与阶段
    this._phaseTime = 0;
    this._orbitProgress = 0;
    this._outroFromFov = this.camera.fov;
    this._phase = PHASE.INTRO;
    this._dir = this.options.clockwise ? 1 : -1;

    // 6) 上输入锁（播放中重复 play 不会重复触发，因为状态没变）
    this._setInputLocked(true);

    if (wasPlaying) this._call('onCancel');
    this._call('onStart');

    return true;
  }

  /**
   * 中途跳过：立刻转入切出阶段（平滑回归 + 交还控制权），不会硬切。
   * 空闲 / 已在切出 / allowSkip=false 时返回 false（幂等）。
   * @returns {boolean} 是否真的执行了跳过
   */
  skip() {
    if (this._disposed) return false;
    if (!this.options.allowSkip) return false;
    if (this._phase === PHASE.IDLE || this._phase === PHASE.OUTRO) return false;

    this._call('onSkip');
    this._beginOutro();
    return true;
  }

  /**
   * 每帧步进入口（把主循环的 delta 喂进来）。
   * @param {number} deltaSeconds 距上一帧的秒数
   */
  update(deltaSeconds) {
    if (this._disposed || this._phase === PHASE.IDLE) return;

    let dt = isNum(deltaSeconds) ? deltaSeconds : 0;
    if (dt < 0) dt = 0;
    if (dt > this.options.maxDelta) dt = this.options.maxDelta;

    switch (this._phase) {
      case PHASE.INTRO:
        this._tickIntro(dt);
        break;
      case PHASE.ORBIT:
        this._tickOrbit(dt);
        break;
      case PHASE.OUTRO:
        this._tickOutro(dt);
        break;
      default:
        break;
    }
  }

  /**
   * 销毁：移除全局监听器、释放在飞的输入锁、断开引用。
   * 播放中 dispose 会触发一次 onInputLockChange(false)，否则你的游戏会永久失去输入。
   */
  dispose() {
    if (this._disposed) return;

    this._detachSkipListeners();

    // 先放锁再断开回调，保证调用方一定能收到"解锁"这件事
    this._setInputLocked(false);

    this._disposed = true;
    this._phase = PHASE.IDLE;
    this._orbitProgress = 0;
    this.targetObject = null;
    this.camera = null;
  }

  /* ====================================================================== */
  /*  阶段实现                                                              */
  /* ====================================================================== */

  /** 切入：位置 lerp + 朝向 slerp + ease-in-out，起点是真实相机位姿，终点是轨道起点 */
  _tickIntro(dt) {
    this._phaseTime += dt;
    const dur = this._introDuration;
    const raw = dur > 0 ? this._phaseTime / dur : 1;

    // 轨道起点每帧重算（角色若在切入过程中走动，目标点跟着走，避免切完瞬间瞬移）
    this._refreshFocusWorld();
    this._poseAtAngle(this._startAzimuth, this._vOrbitStart, this._qOrbitStart);

    if (raw >= 1) {
      // 精确落到轨道起点，杜绝一帧的浮点缝隙
      this.camera.position.copy(this._vOrbitStart);
      this.camera.quaternion.copy(this._qOrbitStart);
      this._applyFov(this._orbitFov);
      this._orbitProgress = 0;
      this._phase = PHASE.ORBIT;
      this._phaseTime = 0;
      this._call('onOrbitStart');
      return;
    }

    const t = easeInOutCubic(raw);
    this.camera.position.lerpVectors(this._vFromPos, this._vOrbitStart, t);
    // slerp 而不是逐轴欧拉插值：避免万向节死锁和朝向"绕远路"
    this.camera.quaternion.copy(this._qFromQuat).slerp(this._qOrbitStart, t);
    if (this._orbitFov !== null) {
      this._applyFov(this._homeFov + (this._orbitFov - this._homeFov) * t);
    }
  }

  /**
   * 环绕：球坐标 + 累积角度，匀速（线性）。
   *
   * 为什么主段不用缓动？
   *   缓动用在首尾会让"中段最快"，而观众的眼睛恰恰在中段最专注 —— 加速穿过最有
   *   信息量的那半圈反而显得毛躁。匀速旋转 = 稳定的观影节奏，也符合"缓慢环绕"的
   *   直觉。加减速的柔和感由 intro/outro 的 ease-in-out 负责，衔接处不会突兀。
   *
   * 为什么绝不对角度取模？
   *   theta 用 `start + dir * p * 2π` 累加，p 从 0 单调走 1，全程只增不减；
   *   如果写成 `lerpAngle(start, start+2π, p)` 再对 2π 取模，359°→0° 会被插值成
   *   反向转一圈（经典 bug）。这里连 wrap 的机会都没有。
   */
  _tickOrbit(dt) {
    this._phaseTime += dt;
    const dur = this.options.orbitDuration;
    const p = dur > 0 ? clamp(this._phaseTime / dur, 0, 1) : 1;
    this._orbitProgress = p;

    this._refreshFocusWorld();

    const theta = this._startAzimuth + this._dir * p * TWO_PI;
    this._spherical.theta = theta;

    // 位置：球坐标 → 世界坐标。直接写进 camera.position，不再额外中转
    this.camera.position.setFromSpherical(this._spherical).add(this._vFocus);

    // 朝向：用 Matrix4.lookAt 一次性算稳定四元数。
    // 不用 camera.lookAt()（它会顺带用 camera.up 和欧拉角路径），也不用逐帧
    // 对"上一帧朝向"做增量插值 —— 后者是镜头抖动的头号来源。
    this._mat4.lookAt(this.camera.position, this._vFocus, UP);
    this.camera.quaternion.setFromRotationMatrix(this._mat4);

    this._call('onProgress', p, this.camera.position);

    if (p >= 1) this._beginOutro();
  }

  /** 切出：从当前真实位姿 slerp/lerp 回"交还机位"（ease-in-out） */
  _tickOutro(dt) {
    this._phaseTime += dt;
    const dur = this._outroDuration;
    const raw = dur > 0 ? this._phaseTime / dur : 1;

    if (raw >= 1) {
      this._finish();
      return;
    }

    const t = easeInOutCubic(raw);
    this.camera.position.lerpVectors(this._vOutroFromPos, this._vReturnPos, t);
    this.camera.quaternion.copy(this._qOutroFromQuat).slerp(this._qReturnQuat, t);
    if (this._orbitFov !== null) {
      this._applyFov(this._outroFromFov + (this._homeFov - this._outroFromFov) * t);
    }
  }

  /** 进入切出阶段：冻结当前位姿作为起点，解析交还机位 */
  _beginOutro() {
    this._vOutroFromPos.copy(this.camera.position);
    this._qOutroFromQuat.copy(this.camera.quaternion);
    this._outroFromFov = this.camera.fov;

    // 默认交还机位 = 进场时捕获的跟随相机位姿
    this._vReturnPos.copy(this._vHomePos);
    this._qReturnQuat.copy(this._qHomeQuat);

    // 调用方可以动态指定（有阻尼跟随的 CameraRig 强烈建议提供）
    const provider = this.options.getReturnPose;
    if (typeof provider === 'function') {
      try {
        provider(this._vReturnPos, this._qReturnQuat);
      } catch (err) {
        console.error('[OrbitFanfareCamera] getReturnPose 执行出错，退回默认交还机位', err);
        this._vReturnPos.copy(this._vHomePos);
        this._qReturnQuat.copy(this._qHomeQuat);
      }
      // 兜底：provider 写了 NaN 就退回默认值，避免相机被 NaN 感染后永久黑屏
      if (!isNum(this._vReturnPos.x) || !isNum(this._vReturnPos.y) || !isNum(this._vReturnPos.z)) {
        console.warn('[OrbitFanfareCamera] getReturnPose 产生了非法位置，退回默认交还机位');
        this._vReturnPos.copy(this._vHomePos);
      }
      this._qReturnQuat.normalize();
    }

    this._orbitProgress = 1;
    this._phase = PHASE.OUTRO;
    this._phaseTime = 0;

    // 交还机位可能离得很远（角色在过场中被移动过 / 你的 Rig 有自己的偏移），
    // 同样用速度预算自适应切出时长，避免"啪"一下甩回去。
    this._outroDuration = this._adaptDuration(
      this.options.outroDuration,
      this._vOutroFromPos.distanceTo(this._vReturnPos),
      this.options.outroSpeedBudget,
      this.options.outroDurationMax
    );

    if (!(this._outroDuration > 0)) this._finish();
  }

  /** 收尾：精确落位 → 恢复 FOV → 置空闲 → 放输入锁 → onComplete */
  _finish() {
    this.camera.position.copy(this._vReturnPos);
    this.camera.quaternion.copy(this._qReturnQuat);
    this._applyFov(this._homeFov);

    this._phase = PHASE.IDLE;
    this._orbitProgress = 1;

    // 先放锁再回调：这样 onComplete 里可以立刻启动下一段相机动效而不会被自己挡住
    this._setInputLocked(false);
    this._call('onComplete');
  }

  /* ====================================================================== */
  /*  几何求解                                                              */
  /* ====================================================================== */

  /**
   * 量目标体型：用包围盒推身高，取包围盒内 focusHeightRatio 处作为聚焦点，
   * 并换算到目标局部坐标（之后每帧只需一次 matrixWorld 乘法，不重算包围盒）。
   */
  _measureTarget() {
    const t = this.targetObject;

    // 目标可能是本帧刚创建/刚移动的，先刷新自身与子节点的世界矩阵
    if (typeof t.updateWorldMatrix === 'function') t.updateWorldMatrix(true, true);

    this._box.setFromObject(t);

    let height = 1.8; // 兜底：成年人身高量级
    if (!this._box.isEmpty()) {
      this._box.getSize(this._vSize);
      if (isNum(this._vSize.y) && this._vSize.y > 0.01) {
        height = this._vSize.y;
      } else {
        // 扁的物体（如一个盘子）没有"身高"，退化为最长边
        height = Math.max(this._vSize.x, this._vSize.z, 0.01);
      }
    }
    this._targetHeight = height;

    // 聚焦点（世界坐标）
    if (!this._box.isEmpty()) {
      const ratio = clamp(this.options.focusHeightRatio, 0, 1);
      this._vFocus.set(
        (this._box.min.x + this._box.max.x) * 0.5,
        this._box.min.y + height * ratio,
        (this._box.min.z + this._box.max.z) * 0.5
      );
    } else {
      t.getWorldPosition(this._vFocus);
    }

    // 世界 → 局部，供每帧跟随
    this._focusLocal.copy(this._vFocus);
    if (typeof t.worldToLocal === 'function') t.worldToLocal(this._focusLocal);
  }

  /**
   * 解轨道：水平半径 / 高度 / 3D 半径 / 极角 / 起始方位角。
   * 半径与高度都能从包围盒自动推算，也都能被 options 手动覆盖。
   */
  _solveOrbit() {
    const opt = this.options;

    // 自动取景距离：让身高为目标占画面垂直高度的 framingFill。
    // d = h / (2 · fill · tan(fov/2))   ← 针孔相机竖直方向视锥的解析解
    const fovDeg = isNum(opt.fov) && opt.fov > 0 ? opt.fov : (this.camera.fov || 50);
    const vFov = THREE.MathUtils.degToRad(fovDeg);
    const fill = clamp(opt.framingFill, 0.05, 1);
    const tanHalf = Math.tan(vFov * 0.5);
    const autoDistance = this._targetHeight / (2 * fill * (tanHalf > 1e-4 ? tanHalf : 1e-4));

    const distH = isNum(opt.orbitDistance) && opt.orbitDistance > 1e-3 ? opt.orbitDistance : autoDistance;
    const pitch = THREE.MathUtils.degToRad(opt.orbitPitchDeg || 0);
    const heightY = isNum(opt.orbitHeight) ? opt.orbitHeight : distH * Math.tan(pitch);

    this._orbitRadiusH = distH;
    this._orbitHeightY = heightY;

    // 球坐标：(radius, phi, theta)
    //   phi 是从 +Y 轴量下来的极角，sin(phi) = 水平半径/3D半径，cos(phi) = 高度/3D半径
    //   theta 是从 +Z 轴量起的方位角，等价于 atan2(dx, dz) —— 与下面的 _startAzimuth 一致
    const r3 = Math.hypot(distH, heightY);
    this._spherical.radius = r3 > 1e-4 ? r3 : 1e-4;
    this._spherical.phi = Math.atan2(distH, heightY);
    this._spherical.theta = 0;

    // 起始方位角 = 相机当前相对聚焦点的方位角。
    // 这么做的两个好处：
    //   1. 切入只需要"径向推进 + 抬/降高度"，位移最短，看起来最自然；
    //   2. 转满 360° 后相机恰好回到切入时的方位，切出回到跟随机位几乎是零位移，
    //      完全不会出现"绕完又跳一下"。
    const dx = this._vFromPos.x - this._vFocus.x;
    const dz = this._vFromPos.z - this._vFocus.z;
    const horiz = Math.hypot(dx, dz);
    // 相机正上方/正下方时方位角在数学上无定义，此时任取 0（视觉上也看不出差别）
    this._startAzimuth = horiz > 1e-3 ? Math.atan2(dx, dz) : 0;

    // FOV 过渡准备（_homeFov 只在 play() 的 idle→播放 分支里捕获，这里不能覆盖）
    this._orbitFov = isNum(opt.fov) && opt.fov > 0 ? opt.fov : null;
  }

  /** 用目标的当前 matrixWorld 刷新聚焦点世界坐标（移动/转身的目标也能被正确环绕） */
  _refreshFocusWorld() {
    const t = this.targetObject;
    // 目标中途被移除时不动 _vFocus，沿用最后一次的有效值，让流程仍能平滑收尾
    if (!t) return;
    this._vFocus.copy(this._focusLocal).applyMatrix4(t.matrixWorld);
  }

  /** 求出球坐标轨道上某个方位角对应的位姿（位置 + 看向聚焦点的朝向） */
  _poseAtAngle(theta, outPos, outQuat) {
    this._spherical.theta = theta;
    outPos.setFromSpherical(this._spherical).add(this._vFocus);
    this._mat4.lookAt(outPos, this._vFocus, UP);
    outQuat.setFromRotationMatrix(this._mat4);
  }

  /**
   * 按"峰值速度预算"自适应时长，只拉长不缩短。
   *
   * 推导：ease-in-out cubic（首尾各占一半的 ease）的峰值斜率是平均斜率的 **3 倍**
   * （f(t)=4t³ 在 t=0.5 处 f'=3），所以
   *   peakSpeed = 3 × distance / duration   ⇒   duration >= 3 × distance / budget
   * budget 的单位是"每秒多少个角色身高"，乘上身高换成世界单位。
   * 显式传 0（= 瞬间完成）时不做自适应，尊重调用方的"不要切入"意图。
   */
  _adaptDuration(nominal, distance, budgetInHeights, maxDuration) {
    const base = isNum(nominal) && nominal > 0 ? nominal : 0;
    if (base <= 0) return 0;

    const h = this._targetHeight > 1e-3 ? this._targetHeight : 1;
    const budgetUnits = (isNum(budgetInHeights) ? budgetInHeights : 0) * h;
    if (!(budgetUnits > 0) || !(distance > 1e-4)) return base;

    let dur = Math.max(base, (3 * distance) / budgetUnits);
    if (isNum(maxDuration) && maxDuration > 0) {
      dur = Math.min(dur, Math.max(base, maxDuration));
    }
    return dur;
  }

  /* ====================================================================== */
  /*  杂项                                                                  */
  /* ====================================================================== */

  /** 仅在 fov 真正变化时更新投影矩阵（updateProjectionMatrix 有成本） */
  _applyFov(v) {
    if (this._orbitFov === null || !this.camera) return;
    if (Math.abs(this.camera.fov - v) < 0.001) return;
    this.camera.fov = v;
    if (typeof this.camera.updateProjectionMatrix === 'function') {
      this.camera.updateProjectionMatrix();
    }
  }

  /** 输入锁的状态机：只在真正变化时回调，杜绝重复通知 */
  _setInputLocked(locked) {
    if (this._inputLocked === locked) return;
    this._inputLocked = locked;
    this._call('onInputLockChange', locked);
  }

  /** 固定参数个数的回调调用（不走 ...args，避免每帧 onProgress 产生垃圾） */
  _call(name, a, b) {
    const fn = this.options[name];
    if (typeof fn !== 'function') return;
    try {
      fn(a, b);
    } catch (err) {
      console.error(`[OrbitFanfareCamera] 回调 ${name} 内部抛出异常（已隔离，不影响相机）`, err);
    }
  }

  _attachSkipListeners() {
    if (!this.options.allowSkip) return;
    if (typeof window === 'undefined' || !window.addEventListener) return; // 非浏览器环境（如单测）

    window.addEventListener('keydown', this._onKeyDown, false);
    if (this.options.skipOnPointer) {
      // capture 阶段：即使游戏 UI 在冒泡阶段 stopPropagation 也能收到
      window.addEventListener('pointerdown', this._onPointerDown, true);
    }
    this._listening = true;
  }

  _detachSkipListeners() {
    if (!this._listening) return;
    window.removeEventListener('keydown', this._onKeyDown, false);
    window.removeEventListener('pointerdown', this._onPointerDown, true);
    this._listening = false;
  }

  _onKeyDown(ev) {
    if (!this.isPlaying) return;
    const keys = this.options.skipKeys || [];
    if (keys.indexOf(ev.code) !== -1 || keys.indexOf(ev.key) !== -1) {
      this.skip();
    }
  }

  _onPointerDown() {
    if (!this.isPlaying) return;
    this.skip();
  }
}
return OrbitFanfareCamera;
})();

// ---- 终点环绕过场：实例与状态 --------------------------------------
// 跟随相机的目标位姿（updateCamera 与终点过场共用）
const camPos = new THREE.Vector3(0, 4.3, 7.4), camLook = new THREE.Vector3(0, 1.3, -9);
// 抵达城市段终点前，相机绕角色转满 360°，把整条街的特色建筑看一遍，再进传送门。
// 相机位姿由 OrbitFanfareCamera 全权接管，所以过场期间必须停掉 updateCamera，
// 否则两边同时写 camera.position，画面会来回打架。
const FINISH = {
    active: false,
    camFar: 230,      // 平时的相机远平面，过场时临时拉远
    fogNear: 0,
    fogFar: 0,
    // 灯光快照：夜里城市是一道黑峡谷，远处地标只剩轮廓线，不补光根本"看不到建筑"
    hemiI: 0, sunI: 0, hemiCur: 0, sunCur: 0,
};

// 切出时交还的"理想跟随位姿"：直接用跟随相机自己的目标值，
// 这样过场结束的那一帧不会"啪"一下跳位
function finishReturnPose(outPos, outQuat) {
    outPos.copy(camPos);
    const m = new THREE.Matrix4().lookAt(camPos, camLook, camera.up);
    outQuat.setFromRotationMatrix(m);
}

const finishCam = new OrbitFanfareCamera(camera, {
    introDuration: 1.6,
    orbitDuration: 12.0,
    outroDuration: 1.4,
    // 轨道几何由 FINISH_VIEW.apply() 每局按玩家选的视角写进来，
    // 这里只是「还没 apply 过」时的兜底值（= 全景视角）
    orbitDistance: 65,
    orbitPitchDeg: 26,
    focusHeightRatio: 0.55,
    fov: 86,
    clockwise: true,
    allowSkip: true,
    skipKeys: ['Space', 'Escape', 'Enter'],
    skipOnPointer: true,
    getReturnPose: finishReturnPose,
    onStart() {
        FINISH.active = true;
        FINISH.camFar = camera.far;
        FINISH.fogNear = scene.fog ? scene.fog.near : 0;
        FINISH.fogFar = scene.fog ? scene.fog.far : 0;
        FINISH.hemiI = hemi ? hemi.intensity : 0;
        FINISH.sunI = sun ? sun.intensity : 0;
        FINISH.hemiCur = FINISH.hemiI;
        FINISH.sunCur = FINISH.sunI;
    },
    onComplete() { endFinishFanfare(); },
});

// ---- 终点镜头视角：把选择权交给玩家 ----
// 人物视角 = 街道内低空环绕（半径 10m，角色在画面中央，看得到街道尽头的新葡京）
// 全景视角 = 无人机升到 78m 再绕（高过全部街墙，六座地标 + 新葡京同框）
//
// 为什么全景视角要升这么高：城市是 22m 宽的峡谷，街墙 32~64m。
// 只要相机低于街墙顶，x=±12 那排楼就会把环上的地标全部挡住——
// 「所有特色建筑都看得到」在峡谷里只有两个解：相机高过街墙，或者把街墙拆了。
const FINISH_VIEW = {
    KEY: 'huyifan.finishView.v2',      // 换 key：预设含义变了，旧的选择不再沿用
    mode: 'drone',
    presets: {
        // gaze = 镜头取景点在角色脚底以上多少米。
        // 取景点抬高之后，相机可以「高但平视」：既高过街墙，又不会俯到只剩地面。
        character: { orbitDistance: 10, orbitPitchDeg: 10, fov: 80, gaze: 1.4 },
        drone: { orbitDistance: 65, orbitPitchDeg: 26, fov: 86, gaze: 68 },
    },
    load() {
        try {
            const v = localStorage.getItem(this.KEY);
            if (v && this.presets[v]) this.mode = v;
        } catch (e) { /* 隐私模式下 localStorage 会抛，忽略 */ }
    },
    set(mode) {
        if (!this.presets[mode]) return;
        this.mode = mode;
        try { localStorage.setItem(this.KEY, mode); } catch (e) { }
        this.apply();
        if (typeof refreshFinishViewUI === 'function') refreshFinishViewUI();
    },
    cur() { return this.presets[this.mode] || this.presets.drone; },
    // 只覆盖这三项，其它选项（时长/补光/回调）保持不动
    apply() {
        const p = this.cur();
        finishCam.options.orbitDistance = p.orbitDistance;
        finishCam.options.orbitPitchDeg = p.orbitPitchDeg;
        finishCam.options.fov = p.fov;
    },
};
FINISH_VIEW.load();
FINISH_VIEW.apply();

// 过场镜头「看向哪里」的取景点。
// 直接 play(player.root) 只能围着角色胸口转，镜头被角色压得很低；
// 换成一个空 Object3D 当取景点，就能把视线抬到角色头顶以上若干米，
// 相机于是可以「站得高、看得平」，街道尽头的地标才进得了画。
const FINISH_GAZE = new THREE.Object3D();
FINISH_GAZE.position.set(0, 1.4, 0);
scene.add(FINISH_GAZE);

function startFinishFanfare() {
    if (!player || !player.root || FINISH.active) return false;
    S.state = 'fanfare';
    FINISH_VIEW.apply();
    // 过场期间世界是冻住的（updatePlaying 不再推进），取景点摆一次就够
    const p = FINISH_VIEW.cur();
    FINISH_GAZE.position.set(
        player.root.position.x,
        player.root.position.y + p.gaze,
        player.root.position.z
    );
    // 先把相机拉到理想跟随位姿再切入：updateCamera 有阻尼，
    // 直接拿滞后位置当起点会让切入多甩一下
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    return finishCam.play(FINISH_GAZE);
}

function endFinishFanfare() {
    FINISH.active = false;
    if (scene.fog) { scene.fog.near = FINISH.fogNear; scene.fog.far = FINISH.fogFar; }
    if (hemi) hemi.intensity = FINISH.hemiI;
    if (sun) sun.intensity = FINISH.sunI;
    camera.far = FINISH.camFar;
    camera.updateProjectionMatrix();
    if (S.state !== 'fanfare') return;      // 过场中被重开 / 换场：只还原相机，不再触发传送门
    S.state = 'playing';
    Scene.fanfareDone = true;
    if (PortalFX.group) beginPortal();
    else { Scene.phase = 'fadeOut'; Scene.t = 0; setFade(1, 0.45); }
}

// 过场期间把雾和远平面一起拉开：平时 fog far 只有 100 / 76 / 62，
// 几十米外的特色建筑全被雾吃掉，"所有建筑都看得到"根本无从谈起。
// 这是谢幕镜头，允许把整条街露出来；结束时写回原值。
function applyFinishFog(dt) {
    // 雾必须拉到很远：环上的地标离镜头 150~250m，按平时的 far=100 全部糊成一片。
    // 90 / 620 是「清澈的夜」——地标还剩 1/4 左右的雾，既有纵深又看得清体块。
    FINISH.fogNear = damp(FINISH.fogNear, 90, 2.5, dt);
    FINISH.fogFar = damp(FINISH.fogFar, 620, 2.0, dt);
    if (scene.fog) { scene.fog.near = FINISH.fogNear; scene.fog.far = FINISH.fogFar; }
    // 雾拉到 620 还不够：相机 far 只有 230，几何在 230 就被裁掉了
    if (Math.abs(camera.far - 620) > 1) {
        camera.far = damp(camera.far, 620, 2.0, dt);
        camera.updateProjectionMatrix();
    }
    // 补一层"蓝调时刻"的环境光：夜里地标只是些黑剪影，不补光等于没看到。
    // 必须用自己的累加器——ATMO 每帧都会按当前时段把 hemi/sun 写回去，
    // 直接 damp(hemi.intensity, ...) 会永远从原值出发、根本涨不上去。
    // 补光要够猛：环上的地标是 90m 的剪影，夜里只靠自发光会糊成一团黑。
    // 1.25 / 0.55 是原来「街道峡谷」那一版的量级；改成俯瞰机位之后，
    // 整片楼群都在画面里，需要更高一档才看得出体块关系。
    FINISH.hemiCur = damp(FINISH.hemiCur, Math.max(FINISH.hemiI, 1.75), 2.2, dt);
    FINISH.sunCur = damp(FINISH.sunCur, Math.max(FINISH.sunI, 0.85), 2.2, dt);
    if (hemi) hemi.intensity = FINISH.hemiCur;
    if (sun) sun.intensity = FINISH.sunCur;
}
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
function updateCamera(dt) {
    if (window.__freezeCam) { camera.updateProjectionMatrix(); return; }   // 截图/调试用：锁死机位
    const flying = !!(S.flight && S.flight.active);
    const k = 1 - Math.exp(-dt * (flying ? 5 : 7));
    const x = S.x || 0, y = S.y || 0;
    // 注意：两个目标必须用不同的临时向量，否则后者会覆盖前者（相机就会往视线目标漂移）
    let targetFov;
    if (flying) {
        camPos.lerp(tmpV.set(x * 0.7, y + 2.1, 8.8), k);
        camLook.lerp(tmpV2.set(x * 0.5, y + 1.0, -9), k);
        targetFov = (camera.aspect < 1 ? 78 : 62) + 4;
    } else {
        // 保安追击时相机后移升高、视线下移：贴身追击时保安会顶到屏幕底边/角落被裁，
        // 拉远升高后玩家和保安都完整入画（带一点"危险拉近"的镜头感）
        const chasing = S.chaserTimer > 0;
        camPos.lerp(tmpV.set(x * 0.7, (chasing ? 4.6 : 4.3) + y * 0.75, chasing ? 8.2 : 7.4), k);
        camLook.lerp(tmpV2.set(x * 0.5, (chasing ? 1.05 : 1.3) + y * 0.6, -9), k);
        targetFov = camera.aspect < 1 ? 78 : 62;
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    // FOV 只在真正变化时重算投影矩阵（静止时省掉每帧的矩阵重建）
    const nextFov = damp(camera.fov, targetFov, 4, dt);
    if (Math.abs(nextFov - camera.fov) > 0.02) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
    }
}

// =====================================================================
//  ⑭ 操作
// =====================================================================
function moveLane(d) {
    const nl = clamp(S.lane + d, 0, 2);
    if (nl === S.lane) return;
    if (campusLaneBlockedSoon(nl)) return;   // 前方有楼横在这条道上：别把人推进墙里
    S.prevLane = S.lane;
    S.lane = nl;
}
function jump() {
    if (S.flying || S.anticip > 0) return;
    if (!S.grounded) {
        // 校园·二段跳：空中再按一次跳，较小冲量（每个腾空周期至多一次）
        if (tryAirJump(S, Scene.id, CONFIG.jump.velocity)) SFX.jump();
        return;
    }
    // 先下蹲蓄力（预备动作），计时结束后由 applyJumpImpulse 真正起跳
    S.anticip = ANIM_CFG.jumpAnticip;
    SFX.jump();
}
/** 蓄力结束、真正离地 */
function applyJumpImpulse() {
    S.vy = S.power.sneakers > 0 ? CONFIG.jump.superVelocity : CONFIG.jump.velocity;
    S.grounded = false;
    S.rolling = 0;
}
function roll() {
    if (S.rolling > 0 || S.flying) return;
    if (!S.grounded) S.vy = -22;   // 空中按下：快速落地并翻滚
    S.rolling = ROLL_TIME;
    SFX.roll();
}

addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    // [PKVS] 联机大厅开着时键盘归输入框（昵称 / 信令码），别触发起跑跳跃
    if (typeof window.__pkInputLock === 'function' && window.__pkInputLock()) return;
    // 音量面板打开时：Esc 关闭、M 静音，其余按键不进游戏
    if (!$('volume').classList.contains('hidden')) {
        if (k === 'escape' || k === 'enter') { e.preventDefault(); closeVolume(); }
        else if (k === 'm') { e.preventDefault(); toggleMute(); }
        return;
    }
    // 升级面板打开时：Esc/Enter 关闭面板，其余按键不进游戏（避免误开局/误暂停）
    if (!$('upgrades').classList.contains('hidden')) {
        if (k === 'escape' || k === 'enter') { e.preventDefault(); closeUpgrades(); }
        return;
    }
    // M 键：任何界面都能切换静音
    if (k === 'm') { e.preventDefault(); toggleMute(); return; }
    // 飞行器的上下控制需要感知“按住”
    if (k === 'arrowup' || k === 'w' || k === ' ') S.holdUp = true;
    if (k === 'arrowdown' || k === 's') S.holdDown = true;
    if (S.state === 'menu' || (S.state === 'over' && S.overShown)) {
        if (k === 'enter' || k === ' ') { e.preventDefault(); startGame(); }
        return;
    }
    if (k === 'p' || k === 'escape') { togglePause(); return; }
    if (S.state !== 'playing' || S.paused || e.repeat) return;
    // [PKVS] 反向符：被丢中时左右互换
    if (k === 'arrowleft' || k === 'a') { const d = -1 * (typeof window.__pkInputFlip === 'function' ? window.__pkInputFlip() : 1); moveLane(d); campusNoteInput(d); }
    else if (k === 'arrowright' || k === 'd') { const d = 1 * (typeof window.__pkInputFlip === 'function' ? window.__pkInputFlip() : 1); moveLane(d); campusNoteInput(d); }
    else if (k === 'arrowup' || k === 'w' || k === ' ') jump();
    else if (k === 'arrowdown' || k === 's') roll();
    else return;
    e.preventDefault();
});
addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w' || k === ' ') S.holdUp = false;
    if (k === 'arrowdown' || k === 's') S.holdDown = false;
});

let touchStart = null;
addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });
addEventListener('touchend', e => {
    if (!touchStart || S.state !== 'playing' || S.paused) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
    if (Math.abs(dx) > Math.abs(dy)) { const d = (dx > 0 ? 1 : -1) * (typeof window.__pkInputFlip === 'function' ? window.__pkInputFlip() : 1); moveLane(d); campusNoteInput(d); }
    else if (dy < 0) { if (S.flying) S.climbPulse = 0.6; else jump(); }
    else roll();
}, { passive: true });

// =====================================================================
//  ⑮ 界面
// =====================================================================
let msgTimer = 0;
function showMsg(text) {
    const el = $('msg');
    el.textContent = text;
    el.style.opacity = 1;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => (el.style.opacity = 0), 1400);
}

function startGame() {
    initAudio();
    startBgm();                     // 背景音乐：随开局启动循环
    resetState();
    SFX.guard();
    resetScene();
    S.state = 'playing';
    S.paused = false;
    for (const id of ['menu', 'over', 'pause']) $(id).classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('pauseBtn').classList.remove('hidden');
}

function togglePause() {
    if (S.state !== 'playing') return;
    // [PKVS] 对战中不许暂停：单方面停表，对手还在跑
    if (window.__PKVS_APP && window.__PKVS_APP.active) return;
    S.paused = !S.paused;
    if (S.paused) stopBgm(); else startBgm();   // 暂停时背景音乐一起停
    $('pause').classList.toggle('hidden', !S.paused);
}

function showGameOver() {
    S.overShown = true;
    S.state = 'over';
    stopBgm();                       // 结算时停背景音乐
    const newBest = S.score > best;
    if (newBest) {
        best = S.score;
        try { localStorage.setItem('parkour3d_best', best); } catch (e) {}
    }
    SAVE.bank += S.coins;             // 本局金币入库
    persistSave();
    $('overScore').textContent = S.score;
    $('overCoins').textContent = S.coins;
    $('overDist').textContent = Math.floor(S.D);
    $('overBest').textContent = newBest ? '🎉 新纪录！' : '最高分 ' + best;
    $('overBank').innerHTML = `本局金币已入库！金库总计 🪙 <b>${fmtCoin(SAVE.bank)}</b>`;
    $('overRevive').textContent = S.reviveUsed > 0 ? `💖 复活币救场 ×${S.reviveUsed}` : '';
    $('over').classList.remove('hidden');
    $('pauseBtn').classList.add('hidden');
}

let hudTimer = 0;
const hudCache = { score: -1, coins: -1, best: -1, dist: -1, revives: -1, powerSig: '', bars: {} };
function updateHud(dt) {
    hudTimer -= dt;
    if (hudTimer > 0) return;
    hudTimer = 0.1;
    // 只在数值变化时写 DOM：避免每 100ms 触发一次样式重算
    if (S.score !== hudCache.score) { $('hudScore').textContent = S.score; hudCache.score = S.score; }
    if (S.coins !== hudCache.coins) { $('hudCoins').textContent = S.coins; hudCache.coins = S.coins; }
    const bestShown = Math.max(best, S.score);
    if (bestShown !== hudCache.best) { $('hudBest').textContent = bestShown; hudCache.best = bestShown; }
    const dist = Math.floor(S.D);
    if (dist !== hudCache.dist) { $('hudDist').textContent = dist + ' m'; hudCache.dist = dist; }
    if (S.revives !== hudCache.revives) {
        $('hudRevive').textContent = S.revives;
        $('reviveBox').classList.toggle('hidden', S.revives <= 0);
        hudCache.revives = S.revives;
    }

    // 道具列表：结构只在「哪些道具在生效」变化时重建，进度条只改宽度
    const active = [];
    for (const k in CONFIG.powerUps) if (S.power[k] > 0) active.push(k);
    const sig = active.join(',');
    if (sig !== hudCache.powerSig) {
        $('powers').innerHTML = active.map(k => {
            const def = CONFIG.powerUps[k];
            return `<div class="pw" data-k="${k}">${def.icon} ${def.name}<div class="bar"><i style="width:0%"></i></div></div>`;
        }).join('');
        hudCache.powerSig = sig;
        hudCache.bars = {};
        for (const k of active) hudCache.bars[k] = document.querySelector(`#powers .pw[data-k="${k}"] i`);
    }
    for (const k of active) {
        const bar = hudCache.bars[k];
        if (!bar) continue;
        const pct = clamp((S.power[k] / powerDur(k)) * 100, 0, 100);
        const w = pct.toFixed(0) + '%';
        if (bar.style.width !== w) bar.style.width = w;
    }
}

$('startBtn').onclick = startGame;
$('restartBtn').onclick = startGame;
$('resumeBtn').onclick = togglePause;
$('pauseBtn').onclick = togglePause;

// ---------- 道具升级面板 ----------
let upOpenedFrom = 'menu';

function refreshCoinLabels() {
    $('menuBank').textContent = SAVE.bank > 0 ? '🪙 金库 ' + fmtCoin(SAVE.bank) : '';
}

function renderUpgrades() {
    let html = '';
    for (const type in CONFIG.powerUps) {
        const def = CONFIG.powerUps[type];
        const lv = SAVE.up[type] || 0;
        const maxed = lv >= UPGRADE_CFG.maxLevel;
        const cost = upCost(lv);
        const afford = SAVE.bank >= cost;
        const col = '#' + def.color.toString(16).padStart(6, '0');
        const pips = Array.from({ length: UPGRADE_CFG.maxLevel }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
        const dur = `<span>${powerDur(type)}s</span>${maxed ? '' : ` <b class="upGain">→ ${powerDur(type) + 1}s</b>`}`;
        html += `
        <div class="upCard" id="upc-${type}">
            <div class="upIcon" style="background:radial-gradient(circle at 32% 28%, ${col}dd, ${col}77 58%, rgba(255,255,255,.08))">${def.icon}</div>
            <div class="upInfo">
                <div class="upName">${def.name}<span class="upLv">Lv ${lv}</span></div>
                <div class="upDur">${dur}</div>
                <div class="upPips">${pips}</div>
            </div>
            ${maxed
                ? '<button class="upBuy maxed" disabled>MAX</button>'
                : `<button class="upBuy${afford ? '' : ' poor'}" data-type="${type}">🪙 ${fmtCoin(cost)}</button>`}
        </div>`;
    }
    $('upCards').innerHTML = html;
    $('upBank').textContent = '🪙 ' + fmtCoin(SAVE.bank);
}

function openUpgrades(from) {
    upOpenedFrom = from;
    renderUpgrades();
    $(from === 'over' ? 'over' : 'menu').classList.add('hidden');
    $('upgrades').classList.remove('hidden');
    const panel = $('upPanel');
    panel.classList.remove('pop'); void panel.offsetWidth; panel.classList.add('pop');
}

function closeUpgrades() {
    $('upgrades').classList.add('hidden');
    $(upOpenedFrom === 'over' ? 'over' : 'menu').classList.remove('hidden');
    refreshCoinLabels();
}

$('upCards').addEventListener('click', e => {
    const btn = e.target.closest('.upBuy');
    if (!btn || btn.disabled) return;
    const type = btn.dataset.type;
    const res = tryBuyUpgrade(type);
    if (res === 'ok') {
        SFX.power();
        renderUpgrades();
        const card = $('upc-' + type);
        if (card) { card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
    } else if (res === 'poor') {
        SFX.stumble();
        btn.classList.remove('shake'); void btn.offsetWidth; btn.classList.add('shake');
    }
});
$('upOpenBtn').onclick = () => openUpgrades('menu');
$('upOpenBtn2').onclick = () => openUpgrades('over');
$('upBack').onclick = closeUpgrades;
refreshCoinLabels();

// ---------- 音量面板 ----------
const VOL_SLIDERS = [
    { ch: 'master', slider: 'volMaster', label: 'volMasterVal' },
    { ch: 'sfx', slider: 'volSfx', label: 'volSfxVal' },
    { ch: 'laugh', slider: 'volLaugh', label: 'volLaughVal' },
    { ch: 'music', slider: 'volMusic', label: 'volMusicVal' },
];

function refreshVolumeUI() {
    for (const { ch, slider, label } of VOL_SLIDERS) {
        const pct = Math.round(AUDIO[ch] * 100);
        $(slider).value = pct;
        $(slider).disabled = AUDIO.muted;
        $(label).textContent = AUDIO.muted ? '静音' : pct + '%';
    }
    const btn = $('volMute');
    btn.textContent = AUDIO.muted ? '🔊 取消静音' : '🔇 静音';
    btn.classList.toggle('on', !!AUDIO.muted);
    $('volBtn').textContent = AUDIO.muted ? '🔇' : (AUDIO.master < 0.02 ? '🔈' : '🔊');
    $('volBtn').classList.toggle('muted', !!AUDIO.muted);
}

function openVolume() {
    initAudio();                    // 用户点击即手势，可以创建/恢复 AudioContext
    refreshVolumeUI();
    $('volume').classList.remove('hidden');
    const panel = $('volPanel');
    panel.classList.remove('pop'); void panel.offsetWidth; panel.classList.add('pop');
}
function closeVolume() {
    $('volume').classList.add('hidden');
    persistAudio();
}

for (const { ch, slider, label } of VOL_SLIDERS) {
    const el = $(slider);
    el.addEventListener('input', () => {
        if (AUDIO.muted) return;
        AUDIO[ch] = clamp(+el.value / 100, 0, 1);
        $(label).textContent = Math.round(AUDIO[ch] * 100) + '%';
        applyAudioLevels();
        persistAudio();
        refreshVolumeUI();          // 同步 🌊 图标
    });
    // 松手时给一次该通道的试听，方便调音
    el.addEventListener('change', () => {
        if (AUDIO.muted) return;
        if (ch === 'sfx') { initAudio(); SFX.coin(); }
        else if (ch === 'laugh') { initAudio(); SFX.guard(); }
        else if (ch === 'music') { initAudio(); startBgm(); }
    });
}

function refreshQualityUI() {
    const row = $('qRow');
    if (!row) return;
    for (const b of row.querySelectorAll('.qBtn')) b.classList.toggle('on', b.dataset.q === QUALITY.tier);
    const tip = $('qTip');
    if (tip) {
        tip.textContent = QP().shadow
            ? '当前：' + QP().label + '档 · 启用实时阴影（更吃性能）'
            : '当前：' + QP().label + '档 · 已关实时阴影，改用脚下投影贴片';
    }
}
for (const b of document.querySelectorAll('#qRow .qBtn')) {
    b.onclick = () => { setQuality(b.dataset.q); initAudio(); SFX.coin(); };
}
refreshQualityUI();

function refreshFinishViewUI() {
    const row = $('fvRow');
    if (!row) return;
    for (const b of row.querySelectorAll('.qBtn')) b.classList.toggle('on', b.dataset.fv === FINISH_VIEW.mode);
    const tip = $('fvTip');
    if (tip) {
        tip.textContent = FINISH_VIEW.mode === 'drone'
            ? '当前：全景视角 · 相机升到 100m 环绕，六座地标与新葡京同框'
            : '当前：人物视角 · 相机贴着街道环绕，角色在画面中央';
    }
}
for (const b of document.querySelectorAll('#fvRow .qBtn')) {
    b.onclick = () => { FINISH_VIEW.set(b.dataset.fv); initAudio(); SFX.coin(); };
}
refreshFinishViewUI();

$('volBtn').onclick = openVolume;
$('volBack').onclick = closeVolume;
$('volMute').onclick = () => {
    AUDIO.muted = !AUDIO.muted;
    applyAudioLevels();
    persistAudio();
    refreshVolumeUI();
};
/** M 键：全局静音开关（面板关闭时也生效） */
function toggleMute() {
    AUDIO.muted = !AUDIO.muted;
    initAudio();
    applyAudioLevels();
    persistAudio();
    refreshVolumeUI();
    showMsg(AUDIO.muted ? '🔇 已静音' : '🔊 已恢复声音');
}
refreshVolumeUI();
document.addEventListener('visibilitychange', () => { if (document.hidden && S.state === 'playing' && !S.paused) togglePause(); });

document.title = CONFIG.title + ' 3D';
$('title').textContent = CONFIG.title;
$('subtitle').textContent = `操控「${CONFIG.player.name}」，别被「${CONFIG.chaser.name}」抓住！`;
$('menuBest').textContent = best ? '最高分 ' + best : '';
await chaserLoadPromise;   // 等保安模型就位再进菜单，开局和玩家一起出现
$('loading').classList.add('hidden');
$('menu').classList.remove('hidden');

// =====================================================================
//  ⑯ 浏览器内自检（?selftest 或控制台 __game.selfTest()）
// =====================================================================
function selfTest() {
    const results = [];
    const ok = (name, cond, info) => results.push({ name, pass: !!cond, info: info == null ? '' : String(info) });
    const prevState = S.state;
    S.paused = false;

    // ① 起跳：预备动作 → 离地 → 落地缓冲
    resetState(); S.state = 'playing';
    jump();
    ok('跳跃有预备下蹲(anticip)', S.anticip > 0 && S.grounded, 'anticip=' + S.anticip.toFixed(2));
    for (let i = 0; i < 12; i++) updatePlaying(1 / 60);
    ok('预备结束后离地', !S.grounded && S.vy > 0, 'vy=' + S.vy.toFixed(2));
    let frames = 0;
    while (!S.grounded && frames < 240) { updatePlaying(1 / 60); frames++; }
    ok('能正常落地', S.grounded, frames + ' 帧');
    ok('落地触发缓冲', ANIM.land > 0, 'land=' + ANIM.land.toFixed(2));

    // ② 翻滚：贴地 + 转满一圈 + 结束回到跑动
    resetState(); S.state = 'playing';
    roll();
    let minPivotY = 9, minRot = 0;
    for (let i = 0; i < Math.ceil(ROLL_TIME * 60) + 4; i++) {
        updatePlaying(1 / 60);
        minPivotY = Math.min(minPivotY, player.pivot.position.y);
        minRot = Math.min(minRot, player.pivot.rotation.x);
    }
    ok('翻滚贴地(旋转中心下移)', minPivotY < 0.75, minPivotY.toFixed(2));
    ok('翻滚转满一圈', Math.abs(minRot) > Math.PI * 1.8, minRot.toFixed(2));
    ok('翻滚结束回到跑姿', Math.abs(player.pivot.rotation.x) < 0.01, player.pivot.rotation.x.toFixed(3));

    // ③ 飞行器全流程：起飞 → 巡航 → 降落 → 落地 → 收翼
    resetState(); S.state = 'playing';
    startFlight();
    ok('飞行器进入起飞', S.flight.phase === 'takeoff', S.flight.phase);
    let cruised = false, descended = false, maxY = 0, n = 0;
    for (; n < 60 * 20; n++) {
        if (S.state !== 'playing') break;
        updatePlaying(1 / 60);
        if (S.flight.phase === 'cruise') cruised = true;
        if (S.flight.phase === 'descent') descended = true;
        maxY = Math.max(maxY, S.y);
        if (S.flight.phase === 'idle') break;
    }
    ok('飞到巡航高度', maxY > CONFIG.flight.cruiseY - 0.6, 'maxY=' + maxY.toFixed(2));
    ok('经历 巡航→降落', cruised && descended, 'cruise=' + cruised + ' descent=' + descended);
    // 落地判定不能写死 y < 0.2：城市 / 隧道地图里可以正好落在车顶（h1 约 1.5~3.3m）上，
    // 只要停在「当前支撑面高度」上就算落地成功（否则每 5 次自检就有 1 次假红灯）。
    // 注意别加 !S.flying —— phase 转 idle 的那一帧 S.flying 还是上一帧留下的 true。
    const gy = surfaceAt(S.x, S.y);
    ok('飞行结束回到地面', S.flight.phase === 'idle' && S.y <= gy + 0.05,
        'phase=' + S.flight.phase + ' y=' + S.y.toFixed(2) + ' 支撑面=' + gy.toFixed(2));
    ok('落地后收翼', wingGrow < 0.2, 'wingGrow=' + wingGrow.toFixed(2));
    ok('飞行时长合理', n / 60 > 3 && n / 60 < powerDur('wings') + 7, (n / 60).toFixed(1) + 's / 上限 ' + (powerDur('wings') + 7).toFixed(0) + 's');

    // ④ 关节数值健康（GLB 模型没有 hair 关节，跳过）
    const rigs = ['pivot', 'body', 'torso', 'head', 'hair', 'legL', 'kneeL', 'legR', 'kneeR', 'armL', 'elbowL', 'armR', 'elbowR']
        .filter(k => !(player.isModel && k === 'hair'));
    const badJoints = [];
    for (const key of rigs) {
        const j = player[key];
        if (!j) { badJoints.push(key + ':missing'); continue; }
        for (const ax of ['x', 'y', 'z']) {
            if (!isFinite(j.rotation[ax])) badJoints.push(key + '.rot' + ax);
            if (!isFinite(j.position[ax])) badJoints.push(key + '.pos' + ax);
        }
    }
    ok('关节数值无 NaN', badJoints.length === 0, badJoints.join(','));

    // ⑤ 角色模型部件：代码拼装角色查命名部件；GLB 模型查骨骼接口
    if (!player.isModel) {
        const names = new Set();
        player.root.traverse(o => { if (o.name) names.add(o.name); });
        for (const part of ['eyeWhite', 'pupil', 'brow', 'mouth', 'blush', 'glassesUp', 'lens', 'hood', 'zipper', 'boot', 'sole', 'hairBack']) {
            ok('角色部件存在：' + part, names.has(part));
        }
    } else {
        ok('GLB 角色骨骼接口完整', ['torso', 'head', 'legL', 'kneeL', 'legR', 'kneeR', 'armL', 'elbowL', 'armR', 'elbowR']
            .every(k => player[k] && isFinite(player[k].rotation.x)), player.usedUrl || 'model');
    }
    ok('角色动画状态在推进', isFinite(ANIM.k) && ANIM.k > 0 && ANIM.k <= 1, 'k=' + ANIM.k.toFixed(3));

    // ⑥ 场景系统：数据完整性 / 段长 / 二段跳 / 主题切换
    const badScene = validateSceneData(OBSTACLE_DEFS, SCENE_OBSTACLES);
    ok('场景障碍数据完整(ride+jump+duck)', badScene === null, badScene || 'ok');
    ok('四场景段长与注册表一致且合法', ['lakeside', 'tunnel', 'city', 'campus'].every(id =>
        THEMES[id] && THEMES[id].segLen === SCENE_SEG_LEN[id] && SCENE_SEG_LEN[id][0] > 50 && SCENE_SEG_LEN[id][0] <= SCENE_SEG_LEN[id][1]));

    // 校园·二段跳：离地后再跳一次，落地清零
    resetState(); window.__forceTheme('campus'); S.state = 'playing';
    jump();
    for (let i = 0; i < 20; i++) updatePlaying(1 / 60);   // 蓄力 5 帧 + 等 vy 衰减到 35% 以下（约需 14 帧空中时间）
    ok('校园场景已激活', Scene.id === 'campus', Scene.id);
    const vyBefore = S.vy;
    jump();
    ok('校园二段跳触发', S.airJumps === 1 && S.vy > vyBefore, 'vy=' + S.vy.toFixed(2));
    const vyAfter = S.vy;
    jump();
    ok('二段跳每个腾空周期仅一次', S.airJumps === 1 && S.vy === vyAfter);
    frames = 0;
    while (!S.grounded && frames < 300) { updatePlaying(1 / 60); frames++; }
    ok('落地后二段跳计数清零', S.grounded && S.airJumps === 0, 'airJumps=' + S.airJumps);

    // 非校园场景没有二段跳
    resetState(); window.__forceTheme('lakeside'); S.state = 'playing';
    jump();
    for (let i = 0; i < 12; i++) updatePlaying(1 / 60);
    jump();
    ok('湖畔场景无二段跳', S.airJumps === 0, 'airJumps=' + S.airJumps);

    // 场景切换：世界重建 + 障碍缓冲
    window.__forceTheme('city');
    ok('强制切场景生效', Scene.id === 'city' && curTheme === 'city', Scene.id);
    ok('切场景后有 70m 无障碍缓冲', S.nextRowS >= S.D + 69, 'nextRowS-D=' + (S.nextRowS - S.D).toFixed(1));

    // ⑦ 升级系统：价格公式 / 时长公式 / 满级与余额防护（不落盘，测完还原）
    ok('升级价格公式 500·2^lv', [0, 1, 2, 3].every(lv => upCost(lv) === 500 * 2 ** lv) && upCost(9) === 256000, 'lv9→' + upCost(9));
    const _saveBak = JSON.parse(JSON.stringify(SAVE));
    SAVE.up = {}; SAVE.bank = 1500;
    ok('时长 = 基础 + 等级×1s', powerDur('magnet') === CONFIG.powerUps.magnet.duration);
    SAVE.up.magnet = 3;
    ok('升级后时长随等级增长', powerDur('magnet') === CONFIG.powerUps.magnet.duration + 3, powerDur('magnet') + 's');
    SAVE.bank = 5000;                                   // Lv3→Lv4 需 4000
    ok('买得起时扣款并升级', tryBuyUpgrade('magnet') === 'ok' && SAVE.up.magnet === 4 && SAVE.bank === 1000, 'bank=' + SAVE.bank);
    SAVE.bank = 10;
    ok('金币不足拒绝购买', tryBuyUpgrade('magnet') === 'poor' && SAVE.up.magnet === 4 && SAVE.bank === 10);
    SAVE.up.magnet = UPGRADE_CFG.maxLevel;
    ok('满级拒绝继续升', tryBuyUpgrade('magnet') === 'max' && SAVE.up.magnet === UPGRADE_CFG.maxLevel, 'Lv' + SAVE.up.magnet);
    ok('满级时长封顶 +10s', powerDur('magnet') === CONFIG.powerUps.magnet.duration + UPGRADE_CFG.maxLevel, powerDur('magnet') + 's');
    SAVE.bank = _saveBak.bank; SAVE.up = _saveBak.up;

    // ⑧ 行驶障碍：迎面开来、撞上即失败、护盾规则（Lv<5 无效 / Lv≥5 挡一次）
    const _saveBak2 = JSON.parse(JSON.stringify(SAVE));
    // 转场无敌期(1.2s=72帧)比碰撞窗口(约34帧)还长，会让迎面车直接穿过玩家；测试要显式清掉
    const setupMoving = (shieldLv, shieldDur) => {
        resetState(); window.__forceTheme('city'); S.state = 'playing';
        S.transGrace = 0;
        S.nextRowS = S.D + 1e6;                       // 关掉自动生成，只保留手动放置的这一辆
        SAVE.up.shield = shieldLv;
        S.power.shield = shieldDur;
        placeMoving(1, 10);
    };
    const runUntilDying = (maxFrames = 300) => {
        let died = false;
        for (let i = 0; i < maxFrames && !died; i++) { updatePlaying(1 / 60); died = S.state === 'dying'; }
        return died;
    };
    setupMoving(0, 0);
    const mv = obstacles.find(o => o.moving);
    ok('城市场景生成行驶障碍(小汽车)', !!mv && mv.type === 'car', mv ? 'extra=' + mv.extra.toFixed(1) : 'missing');
    ok('行驶障碍会朝主角移动', mv.z < 0 && mv.extra > 0, 'z=' + mv.z.toFixed(1));
    ok('被行驶小汽车撞上直接失败', runUntilDying());
    setupMoving(4, 10);                              // 护盾开着但不足 5 级
    ok('护盾不足5级挡不住行驶障碍', runUntilDying());
    setupMoving(MOVING_SHIELD_LV, 10);
    let blocked = false;
    for (let i = 0; i < 300 && !blocked; i++) {
        updatePlaying(1 / 60);
        blocked = S.state === 'playing' && S.power.shield === 0 && !obstacles.some(o => o.moving);
    }
    ok('护盾Lv5可挡一次行驶撞击', blocked, 'state=' + S.state + ' shield=' + S.power.shield.toFixed(1));
    SAVE.bank = _saveBak2.bank; SAVE.up = _saveBak2.up;

    // ⑨ 音量：四通道换算 + 笑声/音乐独立 + 静音归零 + 面板滑块同步
    const _audioBak = JSON.parse(JSON.stringify(AUDIO));
    Object.assign(AUDIO, { master: 0.8, sfx: 0.5, laugh: 0.6, music: 0.4, muted: false });
    ok('音量：音效 = 总音量×音效', Math.abs(audioChannelGain(AUDIO, 'sfx') - 0.4) < 1e-9, audioChannelGain(AUDIO, 'sfx').toFixed(2));
    ok('音量：保安笑声与背景音乐各自独立',
        Math.abs(audioChannelGain(AUDIO, 'laugh') - 0.48) < 1e-9 && Math.abs(audioChannelGain(AUDIO, 'music') - 0.32) < 1e-9,
        'laugh=' + audioChannelGain(AUDIO, 'laugh').toFixed(2) + ' music=' + audioChannelGain(AUDIO, 'music').toFixed(2));
    AUDIO.laugh = 0;
    ok('音量：关掉笑声不影响背景音乐', audioChannelGain(AUDIO, 'laugh') === 0 && audioChannelGain(AUDIO, 'music') > 0);
    AUDIO.laugh = 0.6; AUDIO.muted = true;
    ok('音量：静音时所有通道归零', ['master', 'sfx', 'laugh', 'music'].every(ch => audioChannelGain(AUDIO, ch) === 0));
    AUDIO.muted = false;
    AUDIO.master = 0.5;
    ok('音量：总音量同时作用于笑声与音乐',
        Math.abs(audioChannelGain(AUDIO, 'laugh') - 0.3) < 1e-9 && Math.abs(audioChannelGain(AUDIO, 'music') - 0.2) < 1e-9);
    refreshVolumeUI();
    ok('音量：面板滑块与设置同步', +$('volLaugh').value === 60 && +$('volMaster').value === 50,
        'laugh=' + $('volLaugh').value + ' master=' + $('volMaster').value);
    Object.assign(AUDIO, _audioBak);
    refreshVolumeUI();

    // ⑮ 画质档位：减配必须真的落到渲染器上，不能只是改了个变量
    {
        const bak = QUALITY.tier;
        S.state = 'playing';
        const P = QUALITY_PRESETS;
        ok('画质：三档参数逐级收紧',
            P.high.pr > P.mid.pr && P.mid.pr >= P.low.pr &&
            P.high.shadowSize > P.mid.shadowSize &&
            P.high.pointLights >= P.mid.pointLights && P.mid.pointLights >= P.low.pointLights &&
            P.high.shadow === true && P.mid.shadow === false && P.low.shadow === false,
            'pixelRatio ' + P.high.pr + '/' + P.mid.pr + '/' + P.low.pr +
            ' · 阴影 ' + P.high.shadowSize + '/' + P.mid.shadowSize + '/关');

        // 手机档的分辨率地板：minPR=1 保证 1 CSS 像素 = 1 渲染像素。
        // 这是「画面很糊」的根治点——自适应再怎么降，也不会把分辨率降到 1 以下。
        ok('画质：手机档有分辨率地板（minPR=1）',
            P.mid.minPR === 1 && P.low.minPR === 1 &&
            P.mid.minScale === 1 && P.low.minScale === 1 && !P.high.minPR,
            'minPR ' + P.high.minPR + '/' + P.mid.minPR + '/' + P.low.minPR);

        // 降级阶梯：手机档必须「先砍特性」，不许在阶梯里动分辨率（只有高档末级才允许）
        ok('画质：降级阶梯先砍特性、后砍分辨率',
            (P.mid.steps || []).length >= 2 &&
            (P.mid.steps || []).every(s => s.scale == null) &&
            (P.high.steps || []).slice(-1)[0].scale != null,
            'mid 阶梯 ' + (P.mid.steps || []).length + ' 级 · high 末级含 scale');

        setQuality('low');
        updateBlobShadow();
        ok('画质：低档真的关掉了实时阴影',
            renderer.shadowMap.enabled === false && sun.castShadow === false,
            'shadowMap=' + renderer.shadowMap.enabled + ' sun.castShadow=' + sun.castShadow);
        ok('画质：低档改用脚下投影贴片',
            !!BlobShadow.mesh && BlobShadow.mesh.visible === true,
            'blob=' + (BlobShadow.mesh ? BlobShadow.mesh.visible : 'null'));

        setQuality('mid');
        const want = Math.max(P.mid.minPR, 0.5, Math.min(window.devicePixelRatio || 1, P.mid.pr) * QUALITY.scale);
        ok('画质：切档后像素比按档位同步',
            renderer.shadowMap.enabled === P.mid.shadow && Math.abs(renderer.getPixelRatio() - want) < 1e-6,
            'dpr=' + renderer.getPixelRatio().toFixed(2) + ' 期望=' + want.toFixed(2) +
            ' 阴影=' + renderer.shadowMap.enabled);
        ok('画质：点光源不超预算',
            trimPointLights() <= P.mid.pointLights,
            '实际点亮 ' + trimPointLights() + ' / 预算 ' + P.mid.pointLights);

        setQuality(bak);
        ok('画质：测完能回到原档位', QUALITY.tier === bak, 'tier=' + QUALITY.tier);
    }

    S.state = prevState;
    resetState();
    const pass = results.filter(r => r.pass).length;
    return { pass, fail: results.length - pass, total: results.length, results };
}

// 调试用：在浏览器控制台可以访问游戏状态
window.__game = {
    S, ANIM, ANIM_CFG, FLIGHT_CFG, CONFIG, obstacles, coins, pickups, Scene, THEMES,
    SAVE, UPGRADE_CFG, upCost, powerDur, tryBuyUpgrade, openUpgrades, closeUpgrades, renderUpgrades,
    camera, scene, renderer, player, wings, chaser, chaserModel,
    startGame, moveLane, jump, roll, startFlight, selfTest, resetState,
    placeMoving, movingCrash,   // 行驶障碍（测试用）
    speedBaseCap, atTopSpeed, topMovingMul, campusBlockedLanes, campusWallCrash,  // 极速 / 撞楼（验收用）
    spawnRow, checkCollisions,   // 关卡生成 / 碰撞（无必死局扫荡用）
    campusBoxes, nearCampusSolids, inCampusBox,   // 校园静态实体（撞树/撞楼验收用）
    REVIVE_CFG, reviveChanceAt, reviveRoll, placeRevive, spawnReviveIfDue, takeRevive, useRevive, die,   // 复活币（测试用）
    // 性能档位（测试/调试用）
    QUALITY, QUALITY_PRESETS, QP, setQuality, applyQualityOptions, applyResolution,
    trimPointLights, trimShadowCasters, PERF, BlobShadow,
    MOVING_OBSTACLE, MOVING_SHIELD_LV,
    get mergeState() { return MERGE_STATE; },
    scenery, worldGroup,
    // 传送门 / 新葡京路标（调试、验证用）
    PortalFX, LisboaFX, LISBOA_CFG, PORTAL_CFG, spawnGrandLisboa, clearGrandLisboa,
    RING_CFG, RingFX, spawnLandmarkRing, clearLandmarkRing, FINISH_GAZE,
    // 终点环绕过场（调试、验证用）
    FINISH, finishCam, startFinishFanfare, endFinishFanfare, FINISH_VIEW,
    // 地标 GLB（调试、验证用）
    LMGLB, LANDMARK_MODELS, loadLandmarkGLBs,
    // 真实校园（调试/验证用）。CAMPUS 必须用 getter：它是 let，
    // 切场景时会被重指到另一个集合，对象字面量里的裸引用不会跟着更新
    get CAMPUS() { return CAMPUS; }, CAMPUS_SETS,
    placeOnTrack, campusPoint, campusDir, campusNoteInput,
    campusJunctionGap, campusRewindTo,   // 路口净空 / 复活回退（调试、验证用）
    // 音频（调试/测试用）
    AUDIO, audioChannelGain, applyAudioLevels, toggleMute, openVolume, closeVolume,
    SFX, playGuardLaugh, startBgm, stopBgm,
    audioState: () => ({
        bgmOn: bgmOn, bgmStep: bgmStep,
        actxState: actx ? actx.state : null,
        applied: AUDIO.applied || null,
        laughVolume: guardAudio ? guardAudio.volume : null,
    }),
    addObstacle, makeCar, makeBus, makeTruck, makeScaffold, makeCone,   // 测试用：手动放障碍
    // [PKVS] 双人对战：强制开局地图（urlTheme 是 let，只能走 setter）、重铺场景
    setHomeTheme(t) { urlTheme = t || null; },
    getHomeTheme() { return urlTheme; },
    resetScene,
    makeSchoolBus, makeBikeObstacle, makeBanner, makeHurdle,
    // [PKVS] 双人对战：在赛道上摆一个道具（干扰道具就靠它落位）
    placePowerUp,
    spawnPickup(type, lane, s) {   // 测试用：在指定位置放一个道具
        const mesh = makePowerMesh(type);
        const p = { type, x: LANES[lane], y: 1.2, z: zOf(s), mesh };
        mesh.position.set(p.x, p.y, p.z);
        scene.add(mesh);
        pickups.push(p);
    },
    wingsVisible: () => wings[0].mount.visible,
    wingGrow: () => wingGrow,
    pose: () => ({ pivotX: player.pivot.rotation.x, bodyY: player.body.position.y, land: ANIM.land, squash: ANIM.squash }),
    step(dt) {   // 手动推进一帧逻辑（不渲染）
        if (S.state === 'playing') updatePlaying(dt);
        else if (S.state === 'dying') updateDying(dt);
        else if (S.state === 'menu') updateMenu(dt);
    },
};

// =====================================================================
//  ⑯ 主循环
// =====================================================================
const clock = new THREE.Clock();
let _frameT = 0, _carry = 0;
function loop(nowMs) {
    requestAnimationFrame(loop);
    const now = nowMs || performance.now();
    const raw = clock.getDelta();

    // 高刷屏（90/120Hz）没必要每帧都画：白烧电，还会把手机烤到降频
    // 跳过的帧把时间攒进 _carry，下一帧补回来，游戏速度不受影响
    const cap = PERF.frameCap();
    if (cap && now - _frameT < 1000 / cap - 1.2) { _carry += raw; return; }
    const dt = Math.min(raw + _carry, 1 / 30);
    _carry = 0;
    _frameT = now;

    if (!S.paused) {
        if (S.state === 'menu') updateMenu(dt);
        else if (S.state === 'playing') updatePlaying(dt);
        else if (S.state === 'dying') updateDying(dt);
        if (S.state === 'playing' || S.state === 'dying') updateHud(dt);
    }
    updatePortalFX(dt);
    // 过场期间必须停掉跟随相机，否则两边同时写 camera.position。
    // 注意喂 raw 而不是 dt：dt 被夹在 1/30 是为了玩法稳定，低帧率下会让过场变成慢放；
    // 模块内部自己会把 delta 夹到 maxDelta(0.1s)，切标签页回来也不会一帧跳完。
    if (FINISH.active) finishCam.update(raw); else updateCamera(dt);
    ATMO.update(dt, S.D);        // 天气按里程切，得把里程喂进去
    // 必须在 ATMO.update 之后：它每帧都会重写 scene.fog
    if (FINISH.active) applyFinishFog(dt);
    // [PKVS] 冷凝雾：同一个道理，得在 ATMO.update 之后才抢得到雾
    if (typeof window.__pkFogAura === 'function') window.__pkFogAura(scene.fog);
    // ART-TICK-BEGIN（tools/inline-art.py 生成）
    if (typeof ART !== 'undefined') {
        ART.tickWater(dt);
        ART.tickAmbient(dt, curTheme, 0, 0);   // 云层不能吃里程：px/pz 是世界坐标，不是 S.D
        if (curTheme === 'city') ART.tickCity(dt);
    }
    // ART-TICK-END
    // CASTLE-GATE-TICK-BEGIN（tools/patch18_visual.py 生成）
    if (typeof tickCastleGates === 'function') tickCastleGates(dt);     // 吊桥 / 吊闸 / 旗帜
    if (typeof updateTunnelLight === 'function') updateTunnelLight(dt); // 隧道分段开合的光照
    // CASTLE-GATE-TICK-END
    updateBlobShadow();
    // 阴影节流：中档每 2 帧、低档每 3 帧刷一次（一帧位移约 0.3m，看不出来）
    if (renderer.shadowMap.enabled) {
        PERF.shadowTick++;
        if (PERF.shadowTick % QP().shadowEvery === 0) renderer.shadowMap.needsUpdate = true;
    }
    renderer.render(scene, camera);
    PERF.tick(raw);
}
resetState();
S.state = 'menu';
const _qs = new URLSearchParams(location.search);
// ?seq=tunnel,city —— 指定开场场景序列（转场测试用）
if (_qs.has('seq')) {
    const q = _qs.get('seq').split(',').map(s => s.trim()).filter(id => THEMES[id]);
    if (q.length) Scene.queue = q;
}
// ?theme=city —— 直接以指定场景开局（截图 / 调试）
if (_qs.has('theme')) {
    const t = _qs.get('theme');
    if (THEMES[t]) {
        urlTheme = t;
        if (t !== curTheme) doSceneSwap(t);
    }
}
if (_qs.has('autostart')) startGame();
// ?selftest=1 —— 浏览器内跑一遍自动化自检并把结果显示在页面上
if (_qs.has('selftest')) {
    const res = selfTest();
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:99;background:rgba(8,14,26,.94);color:#fff;' +
        'font:13px/1.7 ui-monospace,Consolas,monospace;padding:22px;overflow:auto;white-space:pre-wrap';
    el.textContent = (res.fail === 0 ? '✅ 全部通过' : '❌ 有失败') + `  ${res.pass}/${res.total}\n\n` +
        res.results.map(r => (r.pass ? '✅ ' : '❌ ') + r.name + (r.info ? '   ' + r.info : '')).join('\n');
    document.body.appendChild(el);
}
loop();
