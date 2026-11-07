/* =====================================================================
   PKVS · 干扰道具（Ink & Friends）
   ---------------------------------------------------------------------
   双人对战里互相扔道具：墨水糊视野 / 粘液减速 / 冷凝雾压视野 / 反向符
   逆转操作。全部是「本地表现 + 一条 attack 事件」，不碰关卡生成。

   玩法（2026-11-01 改版）：
   道具不再按里程自动发，而是**赛道上随机刷**，跑过去吃掉就立刻生效、
   自动飞向对手。落点、滚动、拾取判定全部复用主模块的 pickups 系统，
   所以它和护盾 / 磁铁那些道具长得一样、滚得一样，不用另造一套世界。

   三条不能碰的线：
   1. **道具位置用本地随机**，既不按 seed 派生、也绝不走 spawnRow 那条 pkRnd 流。
      生成期往那条流里多塞一次随机，两端的障碍布局立刻错开 —— 这个坑踩过一次。
   2. **赛道上只有盲盒**：一个带问号的金色骰子，看不出里面是什么，吃的瞬间才抽签
      （`pick()` 里的 rollKind）。吃到即生效，没有背包；抗性也去掉了 ——
      玩家控制不了什么时候吃，挡下来就是白捡。同种效果重复命中只刷新时长，不叠加。
   3. 墨水必须留中心视野窗。全黑在跑酷里等价于判死刑，不是「视野受阻」。
   ===================================================================== */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function now() { return performance.now(); }

  function easeOutBack(x) {
    var c = 1.9, c3 = c + 1, u = x - 1;
    return 1 + c3 * u * u * u + c * u * u;
  }

  /* ------------------------------------------------------------ 道具表 */
  // w = 抽签权重。减速最轻但最好中，墨水最抢眼，反向最阴。
  // e* 是同一个盒子里「开坏」的版本：效果一样，但打在自己身上，时长压到正面的六成左右。
  // 负面不能比正面更狠 —— 正面是打对手（他还能反抗），负面是直接扣自己的操作窗口。
  var TABLE = [
    { kind: 'ink',    icon: '🖋', name: '墨水弹', tip: '糊住对手视野',   ms: 3600, w: 30,
      eIcon: '🖤', eName: '漏墨瓶', eMs: 2200 },
    { kind: 'slow',   icon: '🧪', name: '粘液弹', tip: '对手减速 60%',   ms: 2600, w: 26,
      eIcon: '🐌', eName: '沼泽胶', eMs: 1800 },
    { kind: 'fog',    icon: '🌫', name: '冷凝雾', tip: '雾墙压到眼前',   ms: 4000, w: 23,
      eIcon: '💨', eName: '沙尘袋', eMs: 2400 },
    { kind: 'invert', icon: '🔀', name: '反向符', tip: '左右操作反转',   ms: 4000, w: 21,
      eIcon: '🌀', eName: '混乱咒', eMs: 1500 }
  ];
  var BY = {};
  var WSUM = 0;
  TABLE.forEach(function (it) { BY[it.kind] = it; WSUM += it.w; });

  /* ------------------------------------------------------------ 参数 */
  var FIRST_S = [190, 250];    // 第一个道具落在多少米
  var GAP_S = [200, 275];      // 之后每隔多远一个（1000m 一局约 4 个）
  var LEAD_M = 128;            // 提前多少米把它摆到世界里
  var SLOW_MUL = 0.40;         // 被粘液糊住时的速度系数
  var EVIL_RATE = 0.20;        // 盒子开出「自家负面」的概率（一局 4 个盒子平均踩 0.8 个）

  /* ------------------------------------------------------------ 状态 */
  var ST = {
    alive: false,
    nextItemS: 0,
    hits: {},          // kind -> 结束时间戳
    hitUntil: 0,
    fogMix: 0,
    lobby: null,
    picked: 0,         // 本局吃了几个（调试用）
    evil: 0,           // 其中开出负面几个（调试用）
    rounds: 0          // 本局刷了几个
  };
  // 道具位置和类型走**本地**随机，不按 seed 派生。
  // 曾经做成"同 seed 两端一致"，实测发现是个死结：两人在同一位置吃同一个道具、
  // 同时互相扔，效果正好抵消，干扰等于没做（一局 89s 的实测：A@28.5s 被糊，
  // B@28.9s 同时被糊，两边各 3.42s）。改成各刷各的，间隔和权重一样，公平性靠
  // 「一局各 4 个」保证，而不是「同一个道具」。
  var itemRnd = Math.random;

  /* ------------------------------------------------------------ 样式 */
  var CSS = [
    /* 吃到的即时提示：屏幕中上方一块小牌子，比角落的槽位醒目得多 */
    '#pkPickFx{position:fixed;left:50%;top:19%;transform:translate(-50%,-8px) scale(.9);z-index:8460;',
    '  display:flex;align-items:center;gap:11px;padding:9px 20px 10px 14px;border-radius:16px;',
    '  background:linear-gradient(158deg,rgba(52,32,104,.95),rgba(24,15,58,.97));',
    '  border:2px solid rgba(255,208,90,.62);box-shadow:0 12px 34px rgba(0,0,0,.5);',
    '  color:#fff;font:800 17px/1.15 "Microsoft YaHei","PingFang SC",sans-serif;white-space:nowrap;',
    '  opacity:0;pointer-events:none;transition:opacity .16s,transform .16s cubic-bezier(.2,1.4,.4,1);}',
    '#pkPickFx.on{opacity:1;transform:translate(-50%,0) scale(1);}',
    '#pkPickFx .ico{font-size:29px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4));}',
    '#pkPickFx .sub{display:block;margin-top:2px;font-size:12.5px;font-weight:700;',
    '  color:#ffd97a;letter-spacing:.4px;}',
    /* 开出负面：整块换成告警红，一秒就能分清这次是赚了还是被坑了 */
    '#pkPickFx.evil{background:linear-gradient(158deg,rgba(96,18,40,.96),rgba(48,8,26,.97));',
    '  border-color:rgba(255,90,120,.75);}',
    '#pkPickFx.evil .sub{color:#ff8fa8;}',

    /* 投掷动画：图标从玩家身上往上飞出去 */
    '#pkThrowFx{position:fixed;z-index:8450;pointer-events:none;font-size:46px;line-height:1;',
    '  filter:drop-shadow(0 4px 10px rgba(0,0,0,.5));transform:translate(-50%,-50%) scale(.4);',
    '  opacity:1;transition:transform .6s cubic-bezier(.22,.9,.3,1),opacity .6s linear;}',
    '#pkThrowFx.go{transform:translate(-50%,-330%) scale(1.35) rotate(22deg);opacity:0;}',

    /* 冷凝雾：四周压进来的白雾 */
    '#pkFxFog{position:fixed;inset:0;z-index:8300;pointer-events:none;opacity:0;',
    '  transition:opacity .42s ease;',
    '  background:',
    '    radial-gradient(130% 86% at 50% 112%, rgba(216,234,248,.94), rgba(216,234,248,0) 58%),',
    '    radial-gradient(100% 66% at 50% -14%, rgba(228,242,253,.88), rgba(228,242,253,0) 66%),',
    '    linear-gradient(180deg, rgba(219,236,250,.26), rgba(198,222,240,.52));}',
    '#pkFxFog.on{opacity:1;}',

    /* 反向符：洋红脉冲边框 + 中央提示 */
    '#pkFxInvert{position:fixed;inset:0;z-index:8350;pointer-events:none;opacity:0;',
    '  transition:opacity .2s;',
    '  box-shadow:inset 0 0 96px 22px rgba(255,52,120,.5), inset 0 0 26px 6px rgba(255,150,205,.34);}',
    '#pkFxInvert.on{opacity:1;animation:pkInvPulse .82s ease-in-out infinite;}',
    '@keyframes pkInvPulse{0%,100%{opacity:.62}50%{opacity:1}}',
    '#pkFxInvertTag{position:fixed;left:50%;top:8%;transform:translateX(-50%);z-index:8360;',
    '  pointer-events:none;padding:8px 22px;border-radius:999px;opacity:0;transition:opacity .22s;',
    '  background:rgba(190,20,80,.86);border:2px solid rgba(255,150,200,.85);color:#fff;',
    '  font:900 17px/1.1 "Microsoft YaHei","PingFang SC",sans-serif;letter-spacing:1px;',
    '  text-shadow:0 2px 0 rgba(0,0,0,.35);white-space:nowrap;}',
    '#pkFxInvertTag.on{opacity:1;}',

    /* 粘液：绿色 vignette */
    '#pkFxSlow{position:fixed;inset:0;z-index:8290;pointer-events:none;opacity:0;',
    '  transition:opacity .3s;',
    '  background:radial-gradient(circle at 50% 62%, rgba(70,230,130,0) 38%, rgba(52,206,110,.30) 100%);}',
    '#pkFxSlow.on{opacity:1;}'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('pkFxStyle')) return;
    var s = document.createElement('style');
    s.id = 'pkFxStyle';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function layer(id, cls) {
    var el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('div');
    el.id = id;
    if (cls) el.className = cls;
    document.body.appendChild(el);
    return el;
  }

  /* ================================================================
     墨水：canvas 多层不规则墨团 + 中心视野窗
     ================================================================ */
  var ink = { cv: null, ctx: null, t0: 0, dur: 3600, blobs: null, raf: 0 };

  function inkCanvas() {
    if (ink.cv) return ink.cv;
    var cv = document.createElement('canvas');
    cv.id = 'pkInkFx';
    // z-index 8400：盖住 3D 画面和游戏自带 HUD（z=10），但让开大厅 HUD（9000）
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:8400;';
    document.body.appendChild(cv);
    ink.cv = cv;
    ink.ctx = cv.getContext('2d');
    return cv;
  }

  function inkResize() {
    var cv = ink.cv;
    if (!cv) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(innerWidth * dpr));
    var h = Math.max(1, Math.round(innerHeight * dpr));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
  }

  // 墨团：沿四周分布，避开中心那一块（那里是视野窗）
  function makeBlobs(W, H) {
    var diag = Math.sqrt(W * W + H * H);
    var n = 22 + (Math.random() * 7 | 0);
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({
        a: (i / n) * TAU + (Math.random() - 0.5) * 0.62,
        d0: diag * (0.20 + Math.random() * 0.30),   // 离屏幕中心多远
        r: diag * (0.11 + Math.random() * 0.13),    // 墨团半径
        delay: Math.random() * 0.20,                // 溅射先后
        drip: 0.5 + Math.random() * 1.7,            // 流挂速度
        lobes: 3 + (Math.random() * 4 | 0),         // 边缘起伏数
        seed: Math.random() * 100,
        alpha: 0.82 + Math.random() * 0.14
      });
    }
    return out;
  }

  function blobPath(ctx, x, y, r, b, t) {
    var N = 30;
    var wob = b.wob || 0;
    ctx.beginPath();
    for (var i = 0; i <= N; i++) {
      var th = (i / N) * TAU;
      var k = 1
        + 0.17 * Math.sin(th * b.lobes + b.seed)
        + 0.10 * Math.sin(th * (b.lobes + 2) + wob + t * 0.0007)
        + 0.055 * Math.sin(th * 7 + b.seed * 3);
      var px = x + Math.cos(th) * r * k;
      var py = y + Math.sin(th) * r * k;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  // 视野窗轮廓：极坐标多重正弦扰动，边缘才像墨迹而不是「望远镜暗角」
  function holePath(ctx, cx, cy, r, t, seed) {
    var N = 40;
    ctx.beginPath();
    for (var i = 0; i <= N; i++) {
      var th = (i / N) * TAU;
      var k = 1
        + 0.13 * Math.sin(th * 5 + seed)
        + 0.085 * Math.sin(th * 9 + seed * 2.3 + t * 0.00018)
        + 0.05 * Math.sin(th * 14 + seed * 4.1);
      var px = cx + Math.cos(th) * r * k;
      var py = cy + Math.sin(th) * r * k * 0.94;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  // 溅进视野窗里的碎墨点：墨是粘住的，位置固定，不跟着时间转
  function makeSplats() {
    var n = 7 + (Math.random() * 4 | 0), out = [];
    for (var k = 0; k < n; k++) {
      out.push({
        a: Math.random() * TAU,
        d: 0.52 + Math.random() * 0.52,
        r: 0.045 + Math.random() * 0.125,
        land: 0.12 + Math.random() * 0.30,
        lobes: 3 + (Math.random() * 3 | 0),
        seed: Math.random() * 100,
        wob: 0,
        alpha: 1
      });
    }
    return out;
  }

  // 从视野窗上沿垂下来的墨流
  function makeDrips() {
    var out = [];
    for (var k = 0; k < 5; k++) {
      out.push({
        a: -Math.PI / 2 + (k - 2) * 0.34 + (Math.random() - 0.5) * 0.22,
        len: 0.34 + Math.random() * 0.55,
        w: 0.03 + Math.random() * 0.05,
        land: Math.random() * 0.25
      });
    }
    return out;
  }

  function renderInk(el, D) {
    var ctx = ink.ctx, cv = ink.cv;
    if (!ctx || !cv) return;
    var W = innerWidth, H = innerHeight;
    var dpr = cv.width / Math.max(1, W);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var p = clamp(el / D, 0, 1);
    // 整体透明度：稳到 64% 再退，退得慢一点，别像闪一下
    var bodyA = p < 0.64 ? 1 : 1 - (p - 0.64) / 0.36;
    if (bodyA <= 0.01) return;

    var cx = W * 0.5, cy = H * 0.55;
    var shrink = 1 - 0.26 * p;
    var dripT = el / 1000;

    /* ---- 1. 外圈墨团 ---- */
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = 'rgba(22,10,42,.92)';
    ctx.shadowBlur = 20;

    for (var i = 0; i < ink.blobs.length; i++) {
      var b = ink.blobs[i];
      var life = (el - b.delay * 1000) / 300;      // 单个墨团 300ms 溅开
      if (life <= 0) continue;
      var g = easeOutBack(clamp(life, 0, 1));
      var d = b.d0 * shrink;
      var x = cx + Math.cos(b.a) * d;
      var y = cy + Math.sin(b.a) * d * 0.84;
      // 流挂：往下淌
      var sag = b.drip * dripT * 1.6;
      ctx.fillStyle = 'rgba(13,7,24,' + (b.alpha * bodyA).toFixed(3) + ')';
      blobPath(ctx, x, y + sag, b.r * g, b, el);
      ctx.fill();
    }

    /* ---- 2. 视野窗：挖不规则洞 ---- */
    var holeR = Math.min(W, H) * (0.30 - 0.10 * p);
    var hy = H * 0.60;
    if (holeR > 4) {
      var grd = ctx.createRadialGradient(cx, hy, holeR * 0.45, cx, hy, holeR * 1.06);
      grd.addColorStop(0, 'rgba(0,0,0,1)');
      grd.addColorStop(0.55, 'rgba(0,0,0,0.86)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = grd;
      holePath(ctx, cx, hy, holeR, el, 1.7);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // 湿边：沿窗口描一圈极淡的紫。没有这道反光，纯黑会被读成「画面坏了」
      // 而不是「墨糊上来了」—— 这一步是让它像墨而不是像暗角的关键。
      ctx.strokeStyle = 'rgba(108,80,158,' + (0.085 * bodyA).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1.4, holeR * 0.032);
      holePath(ctx, cx, hy, holeR, el, 1.7);
      ctx.stroke();
    }

    /* ---- 3. 碎墨点：溅进视野窗里的那几滴，最出效果 ---- */
    ctx.shadowBlur = 0;
    if (holeR > 4 && ink.splats) {
      for (var s = 0; s < ink.splats.length; s++) {
        var sp = ink.splats[s];
        var lt2 = (el - sp.land * 1000) / 260;
        if (lt2 <= 0) continue;
        var gg = easeOutBack(clamp(lt2, 0, 1));
        var sx = cx + Math.cos(sp.a) * holeR * sp.d;
        var sy = hy + Math.sin(sp.a) * holeR * sp.d * 0.9;
        ctx.fillStyle = 'rgba(12,7,22,' + (0.86 * bodyA).toFixed(3) + ')';
        // 同样走不规则轮廓：圆形墨点一眼就假
        blobPath(ctx, sx, sy, Math.max(1.5, holeR * sp.r * gg), sp, el);
        ctx.fill();
      }
    }

    /* ---- 4. 上沿垂下来的墨流 ---- */
    if (holeR > 4 && ink.drips) {
      for (var q = 0; q < ink.drips.length; q++) {
        var dr = ink.drips[q];
        var grow = clamp((el - dr.land * 1000) / 2200, 0, 1);
        if (grow <= 0) continue;
        var ax = cx + Math.cos(dr.a) * holeR * 1.04;
        var ay = hy + Math.sin(dr.a) * holeR * 1.04;
        var len = holeR * dr.len * grow;
        var w = 2 + holeR * dr.w;
        ctx.fillStyle = 'rgba(11,6,20,' + (0.90 * bodyA).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(ax - w, ay);
        ctx.quadraticCurveTo(ax - w * 0.35, ay + len * 0.72, ax, ay + len);
        ctx.quadraticCurveTo(ax + w * 0.35, ay + len * 0.72, ax + w, ay);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function inkLoop() {
    ink.raf = requestAnimationFrame(inkLoop);
    var el = now() - ink.t0;
    if (el > ink.dur + 260) { inkStop(); return; }
    renderInk(el, ink.dur);
  }

  function inkStart(ms) {
    injectCSS();
    inkCanvas();
    inkResize();
    if (!ink.blobs || innerWidth !== ink._w) {
      ink.blobs = makeBlobs(innerWidth, innerHeight);
      ink._w = innerWidth;
    }
    ink.splats = makeSplats();
    ink.drips = makeDrips();
    ink.dur = ms;
    ink.t0 = now();
    if (!ink.raf) inkLoop();
  }

  function inkStop() {
    if (ink.raf) cancelAnimationFrame(ink.raf);
    ink.raf = 0;
    if (ink.ctx && ink.cv) {
      ink.ctx.setTransform(1, 0, 0, 1, 0, 0);
      ink.ctx.clearRect(0, 0, ink.cv.width, ink.cv.height);
    }
  }

  /* ================================================================
     命中的表现
     ================================================================ */
  function playHit(kind, ms) {
    injectCSS();
    if (kind === 'ink') {
      inkStart(ms);
    } else if (kind === 'fog') {
      layer('pkFxFog').classList.add('on');
    } else if (kind === 'invert') {
      layer('pkFxInvert').classList.add('on');
      var tag = layer('pkFxInvertTag');
      tag.textContent = '⇄ 左右反转中';
      tag.classList.add('on');
      clearTimeout(playHit._it);
      playHit._it = setTimeout(function () { tag.classList.remove('on'); }, 1800);
    } else if (kind === 'slow') {
      layer('pkFxSlow').classList.add('on');
    }
  }

  function clearFx(kind) {
    if (kind === 'ink') inkStop();
    else if (kind === 'fog') { var f = document.getElementById('pkFxFog'); if (f) f.classList.remove('on'); }
    else if (kind === 'invert') {
      var a = document.getElementById('pkFxInvert'); if (a) a.classList.remove('on');
      var t = document.getElementById('pkFxInvertTag'); if (t) t.classList.remove('on');
    } else if (kind === 'slow') { var s = document.getElementById('pkFxSlow'); if (s) s.classList.remove('on'); }
  }

  function clearAllFx() {
    inkStop();
    Object.keys(BY).forEach(function (k) { if (k !== 'ink') clearFx(k); });
    ST.hits = {};
    ST.hitUntil = 0;
    ST.fogMix = 0;
  }

  /* 投掷动画：图标从玩家身上往屏幕上方飞出去 */
  function throwFx(it) {
    injectCSS();
    var el = document.createElement('div');
    el.id = 'pkThrowFx';
    el.textContent = it.icon;
    el.style.left = '50%';
    el.style.top = '62%';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('go'); });
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 700);
  }

  /* 吃到的即时提示：图标 + 名称 + 一行结果 */
  function pickFx(it, sub, evil) {
    injectCSS();
    var el = layer('pkPickFx');
    el.innerHTML = '<span class="ico">' + it.icon + '</span>' +
      '<span>' + it.name + '<i class="sub">' + sub + '</i></span>';
    el.classList.toggle('evil', !!evil);
    el.classList.add('on');
    clearTimeout(pickFx._t);
    pickFx._t = setTimeout(function () { el.classList.remove('on'); }, 1500);
  }

  /* ================================================================
     赛道生成 / 拾取
     ================================================================ */
  function rollKind() {
    var r = itemRnd() * WSUM;
    for (var i = 0; i < TABLE.length; i++) {
      r -= TABLE[i].w;
      if (r <= 0) return TABLE[i].kind;
    }
    return 'ink';
  }

  // 优先放在安全道上（玩家本来就在那），其次任意一条这个位置空着的道。
  // 各自刷各自的之后就不用再迁就两端一致了，可以挑最容易吃到的道。
  function pickLane(S, s) {
    var lf = S.laneFree;
    var safe = (S.safeLane | 0) || 0;
    if (!lf) return safe;
    var order = [safe, 0, 1, 2];
    var tried = {};
    for (var i = 0; i < order.length; i++) {
      var l = order[i];
      if (l < 0 || l > 2 || tried[l]) continue;
      tried[l] = 1;
      // laneFree 是「这条道最近一个被占用的里程」，比 s 大就说明这里空着
      if (lf[l] > s + 6) return l;
    }
    return safe;
  }

  function maybeSpawn(S) {
    if (!ST.alive || !S) return;
    var g = window.__game;
    if (!g || typeof g.placePowerUp !== 'function') return;

    var s = ST.nextItemS;
    if (s > S.D + LEAD_M) return;
    // 终点前 12m 内不再刷：实测最后一个道具会刷在 1017m，玩家 1000m 冲线，白刷
    var goal = (window.__PKVS_APP && window.__PKVS_APP.goal) || 0;
    if (goal && s > goal - 12) return;
    // 落在身后太远（重开 / 换图导致里程跳变）：直接重排，别追着补
    if (s < S.D + 20) { ST.nextItemS = S.D + 60; return; }

    ST.nextItemS = s + GAP_S[0] + itemRnd() * (GAP_S[1] - GAP_S[0]);
    ST.rounds++;
    // 赛道上只有一种外观：盲盒。里面是什么，吃的瞬间才抽（见 pick）
    g.placePowerUp(pickLane(S, s), s, 'pk_box');
  }

  // 主模块拾取到 pk_* 道具时回调这里。
  // 盲盒：type 是 pk_box，**抽签放在这里**，吃下去的瞬间才知道开出什么。
  // 放在生成期抽的话，赛道上的盒子就得长得不一样，盲盒就没意义了。
  function pick(kind) {
    if (!ST.alive) return;
    var evil = false;
    if (kind === 'box') {
      kind = rollKind();                       // 先抽「是哪种效果」
      evil = Math.random() < EVIL_RATE;        // 再抽「这次是正面还是自家负面」
    }
    var it = BY[kind];
    if (!it) return;
    ST.picked++;

    if (evil) {
      // 开坏了：同一套效果打自己身上，不发 attack 事件
      ST.evil++;
      onPeerAttack({ kind: it.kind, ms: it.eMs }, null);
      pickFx({ icon: it.eIcon, name: '开出 · ' + it.eName }, '自己也中招了', true);
      return;
    }

    throwFx(it);
    var sent = false;
    if (ST.lobby && ST.lobby.sendGameEvent) {
      sent = ST.lobby.sendGameEvent('attack', { kind: it.kind, ms: it.ms });
    }
    pickFx({ icon: it.icon, name: '开出 · ' + it.name }, sent ? '已扔向对手' : '没连上对手');
  }

  function onPeerAttack(d, lobby) {
    if (!ST.alive) return null;
    var kind = (d && d.kind) || 'slow';
    var it = BY[kind];
    if (!it) return null;
    var ms = clamp(+(d && d.ms) || it.ms, 500, 9000);
    var t = now();
    // 没有全局抗性了：玩家控制不了什么时候吃到，挡下来就是白捡。
    // 同种效果重复命中只把结束时间推到更晚的那个，不叠加时长。
    var again = !!(ST.hits[kind] && t < ST.hits[kind]);
    var until = Math.max(ST.hits[kind] || 0, t + ms);
    ST.hits[kind] = until;
    ST.hitUntil = Math.max(ST.hitUntil, until);
    // 传「到结束还剩多久」，不是这次的 ms。
    // 反例：身上还有 3.4s 墨，又踩了个负面漏墨瓶（2.2s），按 2.2s 重放的话
    // 墨会在 2.2s 就消失，而状态还认为要糊到 3.4s —— 中间那 1.2s 画面没墨、
    // fogAura 却还在按 ink 加压，看起来就是「莫名起雾」。
    playHit(kind, until - t);
    if (lobby && lobby.sendGameEvent) lobby.sendGameEvent('hitback', { kind: kind, again: again });
    return { kind: kind, again: again };
  }

  /* ================================================================
     每帧推进
     ================================================================ */
  function tick(dt, S, lobby) {
    if (!ST.alive || !S) return;
    ST.lobby = lobby || ST.lobby;
    var t = now();

    // 过期清理
    for (var k in ST.hits) {
      if (ST.hits[k] && t >= ST.hits[k]) {
        ST.hits[k] = 0;
        clearFx(k);
      }
    }

    maybeSpawn(S);
  }

  /* ================================================================
     给外面用的钩子
     ================================================================ */

  // 速度系数：粘液减速
  function speedMul() {
    var t = now();
    if (ST.hits.slow && t < ST.hits.slow) return SLOW_MUL;
    return 1;
  }

  // 主模块每帧在 ATMO.update 之后调用，覆盖它写好的雾
  function fogAura(fog) {
    if (!fog) return;
    var t = now();
    var want = 0;
    if (ST.hits.fog && t < ST.hits.fog) want = 1;
    else if (ST.hits.ink && t < ST.hits.ink) want = 0.45;

    ST.fogMix += (want - ST.fogMix) * 0.16;
    if (ST.fogMix < 0.004) { ST.fogMix = 0; return; }

    var m = ST.fogMix;
    fog.near = fog.near * (1 - m) + 6 * m;
    fog.far = fog.far * (1 - m) + 40 * m;
    // 雾色也往冷白拉。注意这里拿不到模块作用域的 THREE，只能借 fog.color
    // 自己 clone 一个再 setHex —— 直接写 r/g/b 会跳过 sRGB→linear 转换，颜色会发白。
    if (fog.color && fog.color.clone && fog.color.lerp) {
      if (!_cold) {
        _cold = fog.color.clone();
        _cold.setHex(0xdfeefc);
      }
      fog.color.lerp(_cold, Math.min(0.75, m * 0.85));
    }
  }
  var _cold = null;

  // 左右操作反转
  function inputFlip() {
    var t = now();
    return (ST.hits.invert && t < ST.hits.invert) ? -1 : 1;
  }

  // 大厅 HUD 用：现在没有背包，槽位空着（接入层用 CSS 把它藏了）
  function hud() {
    return { ready: false, progress: 0, left: 0, icon: '', name: '', tip: '' };
  }

  function begin(seed) {
    ST.alive = true;
    ST.picked = 0;
    ST.rounds = 0;
    ST.lobby = null;
    clearAllFx();
    injectCSS();
    // seed 参数留着是为了接口稳定，道具位置本身不再依赖它
    ST.nextItemS = FIRST_S[0] + Math.random() * (FIRST_S[1] - FIRST_S[0]);
  }

  function end() {
    ST.alive = false;
    clearAllFx();
    var fx = document.getElementById('pkThrowFx');
    if (fx && fx.parentNode) fx.parentNode.removeChild(fx);
    var pf = document.getElementById('pkPickFx');
    if (pf) pf.classList.remove('on');
  }

  window.__PKITEMS = {
    TABLE: TABLE,
    begin: begin,
    end: end,
    tick: tick,
    pick: pick,
    onPeerAttack: onPeerAttack,
    speedMul: speedMul,
    fogAura: fogAura,
    inputFlip: inputFlip,
    hud: hud,
    state: ST,
    clearAllFx: clearAllFx,
    // 调试/自测用
    _hit: function (kind, ms) { return onPeerAttack({ kind: kind, ms: ms || (BY[kind] || BY.ink).ms }, null); },
    _setNext: function (s) { ST.nextItemS = s; }
  };

  // 转屏 / 改窗口：墨是按当时的分辨率铺的，得重铺，否则会拉伸变形
  addEventListener('resize', function () {
    if (!ink.cv) return;
    inkResize();
    if (ink.raf) {
      ink.blobs = makeBlobs(innerWidth, innerHeight);
      ink._w = innerWidth;
      ink.splats = makeSplats();
      ink.drips = makeDrips();
    }
  });
})();
