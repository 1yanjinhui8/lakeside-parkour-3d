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
export const DEFAULT_OPTIONS = {
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

export class OrbitFanfareCamera {
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

export default OrbitFanfareCamera;
