/* =====================================================================
   PKVS · 双人对战接入层
   ---------------------------------------------------------------------
   把《胡艺凡快跑》接到 pkvs.js / pkvs-lobby.js 上：菜单入口 → 大厅
   → 同一 seed 开跑 → 实时进度 → 判胜负 → 再战。

   设计取舍（为什么这么接）：
   1. 逻辑全放在这个文件里，游戏主模块只留几个一行钩子（都带 [PKVS] 注释，
      由 tools/add-vs.py 注入）：__pkSpeedMul / __pkOnDie / __pkInputLock /
      setHomeTheme / getHomeTheme / 生成期 seed 随机源。
      这样改对战不用碰 76MB 的主文件，也方便反复调试。
   2. 地图一致靠「生成期临时替换 Math.random」：spawnRow 整条链路
      （含 placeRide / placeBarrier / pillarRow 里所有随机）都走同一个
      种子流，两边调用顺序相同 → 障碍布局相同。
   3. 开局不靠"到点再建世界"（建世界要 200ms，会吃掉双方的公平时间），
      而是倒计时一开始就把世界建好、速度锁 0，到点解冻。
   ===================================================================== */
(function () {
  'use strict';

  // 对局模式。judge 决定胜负怎么判（race 比用时 / distance 比距离），
  // kind 决定什么时候结束（跑到 goal / 时间到）。est 只是给 HUD 进度条用的估算距离，
  // 观众看的是「我跟他差多少」，不是精确终点。
  var MODES = {
    d1000: { judge: 'race',     kind: 'distance', goal: 1000, label: '1000 米' },
    d2000: { judge: 'race',     kind: 'distance', goal: 2000, label: '2000 米' },
    d3000: { judge: 'race',     kind: 'distance', goal: 3000, label: '3000 米' },
    t60:   { judge: 'distance', kind: 'time', sec: 60,  est: 1100, label: '1 分钟' },
    t120:  { judge: 'distance', kind: 'time', sec: 120, est: 2400, label: '2 分钟' },
    t180:  { judge: 'distance', kind: 'time', sec: 180, est: 3900, label: '3 分钟' }
  };

  var CFG = {
    goal: 1000,          // 默认里程（具体看玩家选的模式）
    countdownMs: 3000,   // 倒计时
    home: 'lakeside',    // 开局统一地图：湖畔轨道（单人也是从这里开跑）
    slowMul: 0.45,       // 被干扰时的速度系数（老事件兼容；道具走 vs-items.js）
    reportHz: 20         // 进度上报频率（插件自身还会再节流）
  };

  var VS = {
    phase: 'idle',       // idle | countdown | run | waiting | done
    active: false,       // 是否在一场对局里（决定是否接管场景轮换）
    seed: 0,
    startAt: 0,
    runStart: 0,
    goal: CFG.goal,
    modeId: 'd1000',     // 玩家选的具体模式（d2000 / t60 …）
    modeKind: 'distance',// distance = 跑到 goal；time = 时间到
    durationMs: 0,       // 计时赛的总时长
    slowUntil: 0,
    reported: false,
    peer: 0,
    lobby: null,
    lastReport: 0,
    lastWait: 0,
    prevHome: null
  };
  window.__PKVS_APP = VS;

  function G() { return window.__game; }
  function $(id) { return document.getElementById(id); }
  function now() { return Date.now(); }
  // 道具模块（tools/vs-items.js）——独立文件，内联在本文件之前
  function IT() { return window.__PKITEMS; }

  /* ---------------------------------------------------------------- 随机 */
  // mulberry32：小、快、够用；同 seed → 同序列（两端障碍一致的前提）
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* -------------------------------------------------- 游戏主模块读的钩子 */
  // 速度系数：倒计时/等待/结算 = 0（冻结），被干扰 = slowMul，其余 = 1
  window.__pkSpeedMul = function () {
    if (VS.phase === 'countdown' || VS.phase === 'waiting' || VS.phase === 'done') return 0;
    if (VS.phase === 'run') {
      var m = 1;
      if (now() < VS.slowUntil) m = CFG.slowMul;      // 老版 attack 事件
      var it = IT();
      if (it) m *= it.speedMul();                     // 粘液弹
      return m;
    }
    return 1;
  };

  // 雾：主模块在 ATMO.update 之后每帧调用（那里才刚被重写成正常值）
  window.__pkFogAura = function (fog) {
    var it = IT();
    if (it) it.fogAura(fog);
  };

  // 左右操作反转（反向符）：返回 1 / -1
  window.__pkInputFlip = function () {
    var it = IT();
    return it ? it.inputFlip() : 1;
  };

  // 赛道上吃到干扰道具（主模块的拾取循环按 pk_ 前缀分流过来）
  window.__pkPickItem = function (kind) {
    var it = IT();
    if (it) it.pick(kind);
  };

  // 死亡：对局中死亡直接判负上报（复活币已经用掉之后才会走到这里）
  window.__pkOnDie = function () {
    if (VS.phase !== 'run') return;
    report(true);
  };

  // 输入锁：大厅开着时键盘留给输入框（昵称 / 信令码），不要触发起跑和跳跃
  // 注意不能只看 #pk-root 是否显示：对局中 HUD 也挂在 pk-root 里、display 一直是空串，
  // 按旧判据会把整场对局的键盘全锁死（左右跳滚统统没反应）。
  window.__pkInputLock = function () {
    if (VS.phase === 'run' || VS.phase === 'countdown') return false;   // 正在跑，键盘归游戏
    var lb = VS.lobby;
    if (!lb || !lb.root || lb.root.style.display === 'none') return false;
    return true;    // 大厅 / 三步向导 / 结算：留给输入框和按钮
  };

  /* ---------------------------------------------------------------- 界面 */
  var CSS = [
    '#pkWait{position:fixed;inset:0;z-index:8600;display:none;align-items:center;justify-content:center;',
    '  pointer-events:none;background:radial-gradient(circle at 50% 45%,rgba(10,18,40,.42),rgba(6,10,24,.82));',
    '  font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#fff;text-align:center;}',
    '#pkWait.on{display:flex;}',
    '#pkWait .w{min-width:300px;padding:26px 40px 22px;border-radius:26px;',
    '  background:linear-gradient(160deg,rgba(35,42,94,.94),rgba(26,21,80,.96) 60%,rgba(59,22,87,.96));',
    '  border:2px solid rgba(255,255,255,.18);box-shadow:0 24px 60px rgba(0,0,0,.5);}',
    '#pkWait .e{font-size:54px;line-height:1;margin-bottom:8px;}',
    '#pkWait .t{font-size:28px;font-weight:900;letter-spacing:2px;text-shadow:0 3px 0 rgba(0,0,0,.35);}',
    '#pkWait .s{margin-top:8px;font-size:16px;color:rgba(255,255,255,.86);}',
    '#pkWait .live{margin-top:14px;font-size:14px;color:#9fe1ff;}',
    '#pkWait .live b{color:#ffd257;font-size:17px;}',
    '#pkVsToast{position:fixed;left:50%;top:20%;transform:translateX(-50%);z-index:8700;',
    '  padding:10px 22px;border-radius:999px;background:rgba(210,40,70,.9);border:2px solid rgba(255,120,150,.8);',
    '  color:#fff;font:700 20px/1.2 "Microsoft YaHei",sans-serif;opacity:0;transition:opacity .18s;pointer-events:none;}',
    '#pkVsToast.on{opacity:1;}',
    'body.pk-vs #hud{top:86px;}',
    'body.pk-vs #powers{top:190px;}',
    /* 对局中暂停按钮是死键（togglePause 被禁），留着只会挡住右下角 */
    'body.pk-vs #pauseBtn{display:none;}',
    'body.pk-vs #volBtn{bottom:16px;}',
    /* 道具改成赛道拾取、吃到即生效，HUD 上那个槽位没有意义了，藏掉 */
    'body.pk-vs #pk-root .pk-hud-attack{display:none;}',
    /* 菜单多了一个按钮，窗口矮（<560px）时会顶出屏幕：允许滚动，别被裁掉 */
    '#menu{justify-content:safe center;overflow-y:auto;}',
    /* 大厅左上角「返回游戏」：组件自带界面没有退出到游戏的入口 */
    '#pkVsBack{position:fixed;left:16px;top:16px;z-index:9100;pointer-events:auto;',
    '  padding:9px 20px;border-radius:999px;border:2px solid rgba(255,255,255,.28);',
    '  background:rgba(10,18,40,.72);color:#fff;font:700 14px/1 "Microsoft YaHei",sans-serif;',
    '  cursor:pointer;box-shadow:0 3px 0 rgba(0,0,0,.35);}',
    '#pkVsBack:hover{border-color:rgba(255,255,255,.6);}',
    '#pkVsBack.hide{display:none;}'
  ].join('\n');

  var TPL = [
    '<div id="pkWait"><div class="w">',
    '<div class="e">🏁</div><div class="t">冲线！</div>',
    '<div class="s"></div><div class="live"></div>',
    '</div></div>',
    '<div id="pkVsToast"></div>'
  ].join('');

  function injectUI() {
    if ($('pkWait')) return;
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
    var d = document.createElement('div');
    d.innerHTML = TPL;
    while (d.firstElementChild) document.body.appendChild(d.firstElementChild);
  }

  function toast(msg) {
    var el = $('pkVsToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('on'); }, 1600);
  }

  var WAIT_TPL = {
    out: { e: '💀', t: '你已出局' },
    finish: { e: '🏁', t: '冲线！' },
    timeup: { e: '⏱', t: '时间到' },
    winout: { e: '🏆', t: '对手出局' }
  };

  function showWait(kind, sub) {
    injectUI();
    var box = $('pkWait');
    if (!box) return;
    var t = WAIT_TPL[kind] || WAIT_TPL.finish;
    box.querySelector('.e').textContent = t.e;
    box.querySelector('.t').textContent = t.t;
    box.querySelector('.s').textContent = sub || '';
    box.querySelector('.live').innerHTML = '';
    box.classList.add('on');
  }

  function hideWait() {
    var box = $('pkWait');
    if (box) box.classList.remove('on');
  }

  // 等待期间显示对手实时里程（按上一次进度帧 + 速度外推）
  function tickWait() {
    var box = $('pkWait');
    if (!box || !box.classList.contains('on') || !VS.lobby || !VS.lobby.race) return;
    var t = now();
    if (t - VS.lastWait < 200) return;
    VS.lastWait = t;
    var r = VS.lobby.race;
    var peer = r.peerAt ? r.peer + (performance.now() - r.peerAt) / 1000 * (r.peerSpeed || 15) : r.peer;
    peer = Math.max(0, Math.min(VS.goal, peer));
    var live = box.querySelector('.live');
    if (!live) return;
    live.innerHTML = '对手进度 <b>' + Math.round(peer) + '</b> m / ' + VS.goal + ' m' +
      (peer >= VS.goal ? ' · 已冲线' : '');
  }

  /* ------------------------------------------------------------ 大厅装配 */
  function ensureLobby() {
    if (VS.lobby) return VS.lobby;
    if (!window.PKVS_Lobby) {
      alert('双人对战插件没加载成功（PKVS_Lobby 未定义）');
      return null;
    }
    VS.lobby = window.PKVS_Lobby.create({
      name: '玩家',
      goal: CFG.goal,
    modeId: 'd1000',     // 玩家选的具体模式（d2000 / t60 …）
    modeKind: 'distance',// distance = 跑到 goal；time = 时间到
    durationMs: 0,       // 计时赛的总时长
      stateHz: 15,
      hud: 'overlay',
      bridge: true,                       // 同机双开自动传码，联调/同屏对战很省事
      modes: Object.keys(MODES).map(function (id) {
        return { id: id, label: MODES[id].label, judge: MODES[id].judge };
      }),
      matchOptions: { mode: 'd1000', countdownMs: CFG.countdownMs },
      // 干扰道具改成赛道拾取后不再有背包。这里仍然传一个空 item：
      // 插件只要看到 opts.item 就不会自己接管 attack 事件（否则会重复减速）
      item: {
        get: function () { return { ready: false, progress: 0, left: 0 }; },
        fire: function () { }
      },
      on: {
        matchStart: onMatchStart,
        peerProgress: function (e) { VS.peer = +e.state.distance || 0; },
        peerResult: function (e) { if (e.result && e.result.dnf) onPeerOut(); },
        peerEvent: onPeerEvent,
        matchEnd: onMatchEnd,
        phase: function (e) {
          // 终局后 2 秒内不响应 idle / closed：这两个事件在收尾阶段可能迟到或与 matchEnd
          // 并发到达，早先会把房主的结算屏直接拆掉踢回主菜单（约 1/5 概率，见 QA D9）。
          // 2 秒后正常放行，玩家点「离开房间」照旧能退。
          if (e.phase === 'idle' || e.phase === 'closed') {
            var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            if (VS.endedAt && now - VS.endedAt < 2000) return;
            leaveMatch();
          }
        },
        linkDown: function (e) {
          if (VS.active) toast('连接断开：' + (e.reason || ''));
        }
      }
    });
    return VS.lobby;
  }

  function openLobby() {
    var lb = ensureLobby();
    if (!lb) return;
    injectUI();
    lb.open();
    mountBackBtn(lb);
  }

  // 大厅界面里没有「退出到游戏」的入口（组件只做了房间流程），这里补一个
  function mountBackBtn(lb) {
    if (!lb.root || $('pkVsBack')) return;
    var b = document.createElement('button');
    b.id = 'pkVsBack';
    b.textContent = '← 返回游戏';
    b.addEventListener('click', function () {
      if (lb.vs) { try { lb.leave(); } catch (e) { /* noop */ } }
      lb.close();
      leaveMatch();
    });
    lb.root.appendChild(b);
  }

  /* --------------------------------------------------------------- 对局 */
  function onMatchStart(e) {
    var g = G();
    VS.active = true;
    VS.seed = e.seed >>> 0;
    VS.startAt = e.startAtLocal;
    // 玩家选的模式决定「跑多远」还是「跑多久」
    var mid = (e.options && e.options.matchMode) || 'd1000';
    var M = MODES[mid] || MODES.d1000;
    VS.modeId = mid;
    VS.modeKind = M.kind;
    VS.durationMs = M.kind === 'time' ? M.sec * 1000 : 0;
    VS.goal = M.kind === 'distance' ? M.goal : M.est;
    if (VS.lobby) {
      VS.lobby.goal = VS.goal;                       // HUD 进度条按这个缩放
      if (VS.lobby.race) VS.lobby.race.timeLimit = VS.durationMs;   // 计时赛显示倒计时
    }
    VS.reported = false;
    VS.peer = 0;
    VS.slowUntil = 0;
    var it = IT();
    if (it) it.begin(VS.seed);          // 道具系统归零 + 用它自己的随机源排道具位
    // 生成期随机源：spawnRow 会临时把 Math.random 换成它
    window.__pkRnd = mulberry32(VS.seed);
    document.body.classList.add('pk-vs');
    hideWait();
    // 先把世界建好并冻结在起点：到点解冻，避免开局那段 200ms 建图时间算进成绩
    if (g) {
      // 对局固定从湖畔轨道开跑（单人也是这个顺序），换图两端天然一致，
      // 不需要再按 seed 排场景；这里只防止 ?theme= 调试打开时两端起点不同。
      VS.prevHome = g.getHomeTheme ? g.getHomeTheme() : null;
      g.setHomeTheme(CFG.home);
      g.startGame();
    }
    VS.phase = 'countdown';
    hideMenuBits();
    if (g && g.showMsg) g.showMsg('');
  }

  function hideMenuBits() {
    ['menu', 'over', 'pause', 'upgrades', 'volume'].forEach(function (id) {
      var el = $(id);
      if (el) el.classList.add('hidden');
    });
  }

  function beginRun() {
    VS.phase = 'run';
    VS.runStart = now();
    VS.lastReport = 0;
  }

  function crossLine() {
    if (VS.reported) return;
    report(false);
  }

  function onPeerOut() {
    // 对手已判负：我这边立刻上报当前成绩，房主收到两份成绩就能收局（不必真跑到终点）
    if (VS.phase === 'run' && !VS.reported) {
      toast('对手出局！');
      report(false, 'winout');
    }
  }

  function report(dnf, kind) {
    if (VS.reported || !VS.lobby) return false;
    var g = G(); if (!g) return false;
    VS.reported = true;
    VS.phase = 'waiting';
    // 出局/冲线之后还会挂着「等待对手」面板，别让 3.6 秒的墨继续糊在上面
    var it = IT();
    if (it) it.clearAllFx();
    var S = g.S;
    var timeMs = dnf ? null : Math.max(1, now() - VS.runStart);
    var ok = VS.lobby.reportResult({
      distance: Math.floor(S.D),
      score: Math.floor(S.score || 0),
      timeMs: timeMs,
      dnf: !!dnf
    });
    if (dnf) showWait('out', '跑了 ' + Math.floor(S.D) + ' m · 等待对手完成比赛…');
    else if (kind === 'winout') showWait('winout', '对手先出局了，正在判定…');
    else if (VS.modeKind === 'time') showWait('timeup', '跑了 ' + Math.floor(S.D) + ' m · 等待对手跑完…');
    else showWait('finish', '用时 ' + (timeMs / 1000).toFixed(1) + ' s · 等待对手完成比赛…');
    return ok;
  }

  var ITEM_NAME = { ink: '墨水弹', slow: '粘液弹', fog: '冷凝雾', invert: '反向符' };

  function onPeerEvent(e) {
    var it = IT();

    if (e.event === 'attack') {
      if (VS.phase !== 'run') return;
      if (it) { it.onPeerAttack(e.data, VS.lobby); return; }
      // 兜底：没加载道具模块时退回老的单次减速
      var ms = (e.data && e.data.ms) || 2000;
      VS.slowUntil = Math.max(VS.slowUntil, now() + ms);
      toast('💢 被对手干扰，减速 ' + Math.round(ms / 1000) + ' 秒');
      return;
    }

    // 对方回执：打中了 / 被抗性挡了。
    // 没有这个的话扔出去完全没反馈，分不清是命中还是对面卡了。
    if (e.event === 'hitback') {
      var d = e.data || {};
      // again = 对面身上本来就有同一个效果，这次只把结束时间往后推（不叠加）
      if (d.again) toast('💢 ' + (ITEM_NAME[d.kind] || '道具') + ' 又打中（效果不叠加）');
      else toast('✅ ' + (ITEM_NAME[d.kind] || '道具') + ' 命中！');
    }
  }

  function onMatchEnd() {
    VS.phase = 'done';
    VS.endedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    VS.active = false;
    window.__pkRnd = null;
    var it = IT();
    if (it) it.end();                     // 结算屏上别还糊着墨
    hideWait();
    document.body.classList.remove('pk-vs');
    // 结算面板由大厅负责；这里把游戏钉住，别再往前跑
    var g = G();
    if (g) { g.S.paused = false; }
    // 死在被抓住的结算屏上时，那屏会从大厅面板的缝里透出来，收掉它
    var over = $('over');
    if (over) over.classList.add('hidden');
  }

  /* 退出对战（大厅 leave / 断线回 idle）：回到单机菜单 */
  function leaveMatch() {
    if (VS.phase === 'idle') return;
    var wasActive = VS.active;
    VS.phase = 'idle';
    VS.active = false;
    window.__pkRnd = null;
    var itp = IT();
    if (itp) itp.end();
    hideWait();
    document.body.classList.remove('pk-vs');
    if (!wasActive) return;
    var g = G();
    if (g) {
      if (g.setHomeTheme) g.setHomeTheme(VS.prevHome || null);   // 还原菜单里选的图
      g.resetState();
      g.resetScene();
      g.S.state = 'menu';
      g.Scene.phase = 'run';
      if (g.showMsg) g.showMsg('');
    }
    var menu = $('menu');
    if (menu) menu.classList.remove('hidden');
    var hud = $('hud'); if (hud) hud.classList.add('hidden');
    var pb = $('pauseBtn'); if (pb) pb.classList.add('hidden');
    var over = $('over'); if (over) over.classList.add('hidden');
  }

  /* ---------------------------------------------------------------- 主循环 */
  function loop() {
    requestAnimationFrame(loop);
    var g = G();
    if (!g) return;
    var t = now();

    // 「返回游戏」只在对局之外出现：开局/跑动/等待对手时点它等于中途逃跑
    var back = $('pkVsBack');
    if (back) back.classList.toggle('hide', VS.phase === 'countdown' || VS.phase === 'run' || VS.phase === 'waiting');

    if (VS.phase === 'countdown') {
      if (t >= VS.startAt) beginRun();
      return;
    }

    if (VS.phase === 'run') {
      var S = g.S;
      var ended = VS.modeKind === 'time'
        ? (t - VS.runStart >= VS.durationMs)     // 计时赛：时间到就收
        : (S.D >= VS.goal);                       // 距离赛：跑到终点
      if (ended) { crossLine(); return; }
      // 干扰道具：效果计时 + 到里程就往赛道上刷一个
      var it = IT();
      if (it) it.tick(0, S, VS.lobby);
      if (t - VS.lastReport >= 1000 / CFG.reportHz) {
        VS.lastReport = t;
        if (VS.lobby) VS.lobby.sendProgress({
          distance: Math.floor(S.D),
          speed: S.speed,
          lane: S.lane,
          // 减速标记：VS.slowUntil 是没加载道具模块时的老兜底，主路径要看 speedMul
          slow: t < VS.slowUntil || !!(it && it.speedMul && it.speedMul() < 1)
        });
      }
      return;
    }

    if (VS.phase === 'waiting') {
      tickWait();
      // 死亡后游戏会自己弹「再来一局」，对战里不能重开，否则成绩对不上
      var over = $('over');
      if (over && !over.classList.contains('hidden')) over.classList.add('hidden');
    }
  }

  /* ---------------------------------------------------------------- 入口 */
  function bindMenu() {
    var btn = $('vsBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      openLobby();
    });
  }

  function boot() {
    injectUI();
    bindMenu();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.__PKVS_API = { openLobby: openLobby, VS: VS, CFG: CFG };
})();
