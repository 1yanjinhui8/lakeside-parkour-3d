/*!
 * PKVS Lobby — 跑酷双人对战 · 对战大厅 UI 组件 v2.0.0
 *
 * 零依赖 · 单文件 · 主题可覆盖 · 可直接内联进游戏
 * 依赖: pkvs.js (window.PKVS)
 *
 * 用法:
 *   const lobby = PKVS_Lobby.create({ name:'玩家', goal:5000 });
 *   lobby.open();
 *   // 游戏循环里: lobby.sendProgress({distance, speed});
 *   // 到达终点:   lobby.reportResult({distance, timeMs, dnf:false});
 *
 * 视觉与《胡艺凡快跑》对齐: 粉金渐变胶囊按钮 / 深紫玻璃面板 / 立体按压阴影。
 * 所有样式限定在 #pk-root 内、类名统一 .pk- 前缀, 不污染宿主页面。
 */
(function (global) {
  'use strict';
  if (global.PKVS_Lobby) return;

  var VERSION = '2.0.0';

  /* ==================================================================
     样式
     ================================================================== */
  var CSS = [
    '#pk-root{',
    '  --pk-pink:#ff4fa8;--pk-pink2:#e0157a;--pk-pink-sh:#9c0f55;',
    '  --pk-blue:#3ec6ff;--pk-blue2:#1878d2;--pk-blue-sh:#0d4e91;',
    '  --pk-gold:#ffd257;--pk-gold2:#ff9d1c;--pk-gold-sh:#b96b00;',
    '  --pk-panel1:#232a5e;--pk-panel2:#1a1550;--pk-panel3:#3b1657;',
    '  --pk-stroke:rgba(255,255,255,.16);',
    '  --pk-r-panel:26px;--pk-r-card:18px;--pk-r-chip:999px;',
    '  --pk-mask:rgba(8,16,40,.66);',
    '  --pk-ok:#7dffa8;--pk-warn:#ffd84a;--pk-err:#ff7a7a;',
    '  --pk-ease:cubic-bezier(.34,1.56,.64,1);',
    '  position:fixed;inset:0;z-index:9000;pointer-events:none;overflow:hidden;',
    '  font-family:"Microsoft YaHei","PingFang SC",system-ui,-apple-system,sans-serif;',
    '  font-size:15px;line-height:1.5;color:#fff;text-align:center;',
    '  -webkit-font-smoothing:antialiased;touch-action:manipulation;',
    '}',
    '#pk-root *,#pk-root *::before,#pk-root *::after{box-sizing:border-box;}',
    '#pk-root button{font-family:inherit;cursor:pointer;border:0;background:none;color:inherit;}',
    '#pk-root input,#pk-root textarea{font-family:inherit;}',

    /* ---------- 屏 ---------- */
    '#pk-root .pk-screen{position:absolute;inset:0;display:none;align-items:center;justify-content:center;',
    '  padding:20px;background:var(--pk-mask);-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);',
    '  pointer-events:auto;overflow-y:auto;overscroll-behavior:contain;}',
    '#pk-root .pk-screen.on{display:flex;animation:pkFade .22s ease both;}',
    '@keyframes pkFade{from{opacity:0}to{opacity:1}}',
    '@keyframes pkPop{0%{transform:scale(.72) translateY(30px);opacity:0}100%{transform:scale(1) translateY(0);opacity:1}}',
    '@keyframes pkSpin{to{transform:rotate(360deg)}}',
    '@keyframes pkShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}',
    '@keyframes pkPulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}',
    '@keyframes pkCountPop{0%{transform:scale(1.9);opacity:0}45%{transform:scale(1);opacity:1}100%{transform:scale(1);opacity:1}}',
    '@keyframes pkBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}',

    /* ---------- 面板 ---------- */
    '#pk-root .pk-panel{position:relative;width:min(94vw,560px);max-height:92vh;overflow-y:auto;overscroll-behavior:contain;',
    '  -webkit-overflow-scrolling:touch;padding:22px 22px 20px;',
    '  background:linear-gradient(160deg,var(--pk-panel1) 0%,var(--pk-panel2) 55%,var(--pk-panel3) 100%);',
    '  border:3px solid var(--pk-stroke);border-radius:var(--pk-r-panel);',
    '  box-shadow:0 30px 70px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.12);',
    '  animation:pkPop .45s var(--pk-ease) both;}',
    '#pk-root .pk-panel::-webkit-scrollbar{width:8px;}',
    '#pk-root .pk-panel::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:8px;}',

    /* ---------- 品牌区 ---------- */
    '#pk-root .pk-brand{margin-bottom:16px;}',
    '#pk-root .pk-brand-mark{font-size:34px;line-height:1;margin-bottom:6px;animation:pkBounce 2.6s ease-in-out infinite;}',
    '#pk-root .pk-title{font-size:42px;font-weight:900;letter-spacing:4px;margin:0;color:#fff;',
    '  text-shadow:0 4px 0 #c2185b,0 10px 24px rgba(0,0,0,.45);}',
    '#pk-root .pk-sub{font-size:14px;color:rgba(255,255,255,.72);margin:6px 0 0;}',

    /* ---------- 头像选择 ---------- */
    '#pk-root .pk-avatars{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:16px 0 14px;}',
    '#pk-root .pk-av{width:46px;height:46px;border-radius:50%;font-size:24px;line-height:1;display:grid;place-items:center;',
    '  background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.16);transition:transform .12s,border-color .15s,box-shadow .15s;}',
    '#pk-root .pk-av:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.4);}',
    '#pk-root .pk-av.on{border-color:#ff8fd1;background:rgba(255,79,168,.22);box-shadow:0 0 0 4px rgba(255,79,168,.18),0 0 18px rgba(255,79,168,.5);}',
    '#pk-root .pk-av:active{transform:scale(.94);}',

    /* ---------- 表单 ---------- */
    '#pk-root .pk-label{display:block;text-align:left;font-size:12px;color:rgba(255,255,255,.6);margin:0 2px 6px;}',
    '#pk-root .pk-input{width:100%;padding:12px 16px;font-size:16px;color:#fff;',
    '  background:rgba(0,0,0,.30);border:2px solid rgba(255,255,255,.18);border-radius:14px;outline:none;',
    '  transition:border-color .15s,box-shadow .15s;}',
    '#pk-root .pk-input::placeholder{color:rgba(255,255,255,.32);}',
    '#pk-root .pk-input:focus{border-color:rgba(255,143,209,.85);box-shadow:0 0 0 4px rgba(255,79,168,.16);}',
    '#pk-root .pk-input.is-err{border-color:rgba(255,122,122,.9);box-shadow:0 0 0 4px rgba(255,122,122,.14);}',
    '#pk-root .pk-input--code{font:12px/1.55 Consolas,"Courier New",monospace;height:78px;resize:none;',
    '  word-break:break-all;user-select:text;-webkit-user-select:text;touch-action:auto;}',

    /* ---------- 按钮 ---------- */
    '#pk-root .pk-btn{--pk-sh:var(--pk-pink-sh);display:inline-flex;align-items:center;justify-content:center;gap:8px;',
    '  padding:13px 30px;font-size:18px;font-weight:bold;color:#fff;border-radius:40px;',
    '  background:linear-gradient(var(--pk-pink),var(--pk-pink2));',
    '  box-shadow:0 6px 0 var(--pk-sh),0 10px 22px rgba(0,0,0,.35);',
    '  transition:transform .08s,box-shadow .08s,filter .2s;-webkit-tap-highlight-color:transparent;}',
    '#pk-root .pk-btn:hover{filter:brightness(1.06);}',
    '#pk-root .pk-btn:active{transform:translateY(4px);box-shadow:0 2px 0 var(--pk-sh);}',
    '#pk-root .pk-btn[disabled]{background:linear-gradient(#5b6180,#3d4260);box-shadow:0 6px 0 #2a2e45;',
    '  color:rgba(255,255,255,.45);cursor:not-allowed;filter:none;}',
    '#pk-root .pk-btn[disabled]:active{transform:none;box-shadow:0 6px 0 #2a2e45;}',
    '#pk-root .pk-btn--blue{--pk-sh:var(--pk-blue-sh);background:linear-gradient(var(--pk-blue),var(--pk-blue2));}',
    '#pk-root .pk-btn--gold{--pk-sh:var(--pk-gold-sh);background:linear-gradient(var(--pk-gold),var(--pk-gold2));',
    '  color:#43260a;text-shadow:0 1px 0 rgba(255,255,255,.35);}',
    '#pk-root .pk-btn--ghost{--pk-sh:transparent;background:rgba(255,255,255,.10);',
    '  box-shadow:inset 0 0 0 2px rgba(255,255,255,.22);}',
    '#pk-root .pk-btn--ghost:active{transform:translateY(2px);box-shadow:inset 0 0 0 2px rgba(255,255,255,.22);}',
    '#pk-root .pk-btn--block{display:flex;width:100%;margin-top:12px;}',
    '#pk-root .pk-btn--sm{padding:9px 18px;font-size:14px;border-radius:999px;box-shadow:0 4px 0 var(--pk-sh);}',
    '#pk-root .pk-btn--sm:active{box-shadow:0 1px 0 var(--pk-sh);}',
    '#pk-root .pk-linkbtn{margin-top:12px;font-size:13px;color:rgba(255,255,255,.55);text-decoration:underline;',
    '  text-underline-offset:3px;padding:6px 10px;}',
    '#pk-root .pk-linkbtn:hover{color:#fff;}',

    /* ---------- 身份屏 ---------- */
    '#pk-root .pk-foot{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:16px;',
    '  font-size:12px;color:rgba(255,255,255,.55);}',
    '#pk-root .pk-devtoggle{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;',
    '  font-size:11px;color:rgba(255,255,255,.34);cursor:pointer;user-select:none;}',
    '#pk-root .pk-devtoggle input{accent-color:#ff4fa8;cursor:pointer;}',
    '#pk-root .pk-dot{width:7px;height:7px;border-radius:50%;flex:none;background:rgba(255,255,255,.35);}',
    '#pk-root .pk-dot--ok{background:var(--pk-ok);box-shadow:0 0 8px rgba(125,255,168,.8);}',
    '#pk-root .pk-dot--warn{background:var(--pk-warn);box-shadow:0 0 8px rgba(255,216,74,.7);}',
    '#pk-root .pk-dot--err{background:var(--pk-err);box-shadow:0 0 8px rgba(255,122,122,.7);}',
    '#pk-root .pk-dot--live{animation:pkPulse 1.4s ease-in-out infinite;}',

    /* ---------- 向导 ---------- */
    '#pk-root .pk-wiz-head{display:flex;align-items:center;gap:10px;margin-bottom:4px;}',
    '#pk-root .pk-wiz-head h2{flex:1;margin:0;font-size:22px;letter-spacing:1px;',
    '  background:linear-gradient(#ffe98a,#ffb830);-webkit-background-clip:text;background-clip:text;color:transparent;',
    '  filter:drop-shadow(0 2px 0 rgba(0,0,0,.3));}',
    '#pk-root .pk-wiz-cancel{font-size:13px;color:rgba(255,255,255,.6);padding:8px 12px;border-radius:999px;',
    '  background:rgba(255,255,255,.08);}',
    '#pk-root .pk-wiz-cancel:hover{background:rgba(255,255,255,.16);color:#fff;}',
    '#pk-root .pk-steps{display:flex;gap:8px;margin:14px 0 16px;padding:0;list-style:none;}',
    '#pk-root .pk-steps li{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 8px;',
    '  border-radius:999px;background:rgba(255,255,255,.06);border:2px solid transparent;',
    '  font-size:12.5px;color:rgba(255,255,255,.5);white-space:nowrap;overflow:hidden;}',
    '#pk-root .pk-steps li i{width:19px;height:19px;flex:none;border-radius:50%;display:grid;place-items:center;',
    '  font-style:normal;font-size:11px;font-weight:bold;background:rgba(255,255,255,.16);color:#fff;}',
    '#pk-root .pk-steps li.on{color:#fff;background:rgba(255,79,168,.18);border-color:rgba(255,79,168,.65);}',
    '#pk-root .pk-steps li.on i{background:linear-gradient(var(--pk-pink),var(--pk-pink2));}',
    '#pk-root .pk-steps li.done{color:var(--pk-ok);}',
    '#pk-root .pk-steps li.done i{background:rgba(125,255,168,.22);color:var(--pk-ok);}',
    '#pk-root .pk-wiz-role{display:none;}',
    '#pk-root .pk-wiz-role.on{display:block;}',

    '#pk-root .pk-card{padding:14px 14px 16px;border-radius:var(--pk-r-card);margin-bottom:12px;',
    '  background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.11);text-align:left;}',
    '#pk-root .pk-card-h{display:flex;align-items:center;gap:8px;font-size:14.5px;font-weight:bold;margin-bottom:10px;}',
    '#pk-root .pk-badge{width:22px;height:22px;flex:none;border-radius:50%;display:grid;place-items:center;',
    '  font-size:12px;font-weight:bold;background:linear-gradient(var(--pk-pink),var(--pk-pink2));',
    '  box-shadow:0 2px 0 var(--pk-pink-sh);}',

    '#pk-root .pk-code{position:relative;}',
    '#pk-root .pk-code textarea{width:100%;height:94px;padding:10px 12px;resize:none;overflow:auto;',
    '  font:11.5px/1.6 Consolas,"Courier New",monospace;color:#cfe0f5;word-break:break-all;',
    '  background:rgba(0,0,0,.38);border:2px solid rgba(255,255,255,.14);border-radius:14px;outline:none;',
    '  user-select:text;-webkit-user-select:text;touch-action:auto;-webkit-touch-callout:default;}',
    '#pk-root .pk-code.expanded textarea{height:210px;}',
    '#pk-root .pk-code:not(.expanded)::after{content:"";position:absolute;left:2px;right:2px;bottom:2px;height:52px;',
    '  border-radius:0 0 12px 12px;pointer-events:none;',
    '  background:linear-gradient(rgba(14,10,42,0) 0%,rgba(14,10,42,.55) 45%,rgba(14,10,42,.95) 100%);}',
    '#pk-root .pk-code-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;flex-wrap:wrap;}',
    '#pk-root .pk-code-len{font-size:11px;color:rgba(255,255,255,.45);font-variant-numeric:tabular-nums;}',
    '#pk-root .pk-row{display:flex;gap:8px;flex-wrap:wrap;}',
    '#pk-root .pk-hint{font-size:11.5px;color:rgba(255,255,255,.42);margin:8px 2px 0;line-height:1.5;}',
    '#pk-root .pk-validate{min-height:18px;font-size:11.5px;margin:6px 2px 0;color:rgba(255,255,255,.45);}',
    '#pk-root .pk-validate.ok{color:var(--pk-ok);}',
    '#pk-root .pk-validate.err{color:var(--pk-err);}',
    '#pk-root .pk-shake{animation:pkShake .35s;}',

    '#pk-root .pk-linkwait{display:none;flex-direction:column;align-items:center;gap:12px;padding:34px 10px 24px;}',
    '#pk-root .pk-linkwait.on{display:flex;}',
    '#pk-root .pk-linkwait-t{font-size:17px;font-weight:bold;}',
    '#pk-root .pk-linkwait-s{font-size:12.5px;color:rgba(255,255,255,.5);}',
    '#pk-root .pk-spinner{width:18px;height:18px;border-radius:50%;flex:none;',
    '  border:2.5px solid rgba(255,255,255,.22);border-top-color:#fff;animation:pkSpin .75s linear infinite;}',
    '#pk-root .pk-spinner--lg{width:44px;height:44px;border-width:4px;}',
    '#pk-root .pk-btn .pk-spinner{width:15px;height:15px;border-width:2px;}',

    /* ---------- 大厅 ---------- */
    '#pk-root .pk-panel-title{margin:0 0 4px;font-size:24px;letter-spacing:2px;',
    '  background:linear-gradient(#ffe98a,#ffb830);-webkit-background-clip:text;background-clip:text;color:transparent;',
    '  filter:drop-shadow(0 2px 0 rgba(0,0,0,.3));}',
    '#pk-root .pk-vs{display:flex;align-items:center;justify-content:center;gap:12px;margin:18px 0 12px;}',
    '#pk-root .pk-player{flex:1;max-width:190px;padding:14px 8px;border-radius:var(--pk-r-card);',
    '  background:rgba(255,255,255,.07);border:2px solid rgba(255,255,255,.12);}',
    '#pk-root .pk-player--me{border-color:rgba(255,79,168,.55);box-shadow:0 0 22px rgba(255,79,168,.2);}',
    '#pk-root .pk-player--peer{border-color:rgba(62,198,255,.45);box-shadow:0 0 22px rgba(62,198,255,.16);}',
    '#pk-root .pk-avatar{width:62px;height:62px;margin:0 auto 8px;border-radius:50%;display:grid;place-items:center;',
    '  font-size:32px;line-height:1;border:2px solid rgba(255,255,255,.28);',
    '  background:radial-gradient(circle at 50% 32%,rgba(255,255,255,.24),rgba(255,255,255,.05));}',
    '#pk-root .pk-pname{font-size:15px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '#pk-root .pk-rolechip{display:inline-block;margin-top:6px;padding:2px 10px;border-radius:999px;font-size:11px;',
    '  background:rgba(255,255,255,.12);color:rgba(255,255,255,.75);}',
    '#pk-root .pk-rolechip.host{background:rgba(255,79,168,.24);color:#ffc6e3;}',
    '#pk-root .pk-rolechip.guest{background:rgba(62,198,255,.2);color:#bfeaff;}',
    '#pk-root .pk-vs-mark{font-size:26px;font-weight:900;color:var(--pk-gold);',
    '  text-shadow:0 3px 0 rgba(0,0,0,.35);font-style:italic;}',
    '#pk-root .pk-net{display:flex;align-items:center;justify-content:center;gap:7px;font-size:12px;',
    '  color:rgba(255,255,255,.6);margin:4px 0 2px;}',
    '#pk-root .pk-modes{margin:14px 0 6px;text-align:left;}',
    '#pk-root .pk-modes-label{display:block;font-size:11.5px;color:rgba(255,255,255,.5);margin-bottom:7px;}',
    '#pk-root .pk-chips{display:flex;gap:8px;flex-wrap:wrap;}',
    '#pk-root .pk-chip{padding:7px 16px;border-radius:999px;font-size:13px;font-weight:bold;',
    '  background:rgba(0,0,0,.28);border:2px solid rgba(255,255,255,.18);color:rgba(255,255,255,.65);',
    '  transition:transform .1s,border-color .15s,background .15s;}',
    '#pk-root .pk-chip.on{background:linear-gradient(var(--pk-pink),var(--pk-pink2));border-color:rgba(255,255,255,.7);',
    '  color:#fff;box-shadow:0 3px 0 var(--pk-pink-sh);}',
    '#pk-root .pk-chip:active{transform:translateY(2px);}',
    '#pk-root .pk-chip.readonly{opacity:.55;cursor:default;}',
    '#pk-root .pk-clock-hint{display:none;text-align:center;margin:10px 0 0;font-size:12px;color:rgba(255,255,255,.55);}',
    '#pk-root .pk-clock-hint.on{display:block;}',

    /* ---------- 倒计时 ---------- */
    '#pk-root .pk-countdown{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;',
    '  justify-content:center;pointer-events:none;}',
    '#pk-root .pk-countdown.on{display:flex;}',
    '#pk-root .pk-count-num{font-size:120px;font-weight:900;line-height:1;color:#fff;',
    '  text-shadow:0 6px 0 #c2185b,0 14px 34px rgba(0,0,0,.6);animation:pkCountPop .6s var(--pk-ease) both;}',
    '#pk-root .pk-count-num.go{color:#ffe066;text-shadow:0 6px 0 #b96b00,0 14px 34px rgba(0,0,0,.6);font-size:100px;letter-spacing:4px;}',
    '#pk-root .pk-count-sub{margin-top:14px;font-size:15px;color:rgba(255,255,255,.85);',
    '  padding:6px 18px;border-radius:999px;background:rgba(8,16,40,.55);border:1.5px solid rgba(255,255,255,.2);}',

    /* ---------- 对局 HUD ---------- */
    '#pk-root .pk-hud{position:absolute;inset:0;display:none;pointer-events:none;}',
    '#pk-root .pk-hud.on{display:block;}',
    '#pk-root .pk-hud-board{position:absolute;top:12px;left:50%;transform:translateX(-50%);',
    '  width:min(560px,92vw);display:flex;flex-direction:column;gap:6px;}',    '#pk-root .pk-hud-row{display:flex;align-items:center;gap:8px;}',
    '#pk-root .pk-hud-tag{flex:none;width:44px;padding:3px 0;border-radius:999px;font-size:11.5px;font-weight:bold;',
    '  text-align:center;box-shadow:0 2px 0 rgba(0,0,0,.35);}',
    '#pk-root .pk-hud-tag--me{background:linear-gradient(var(--pk-pink),var(--pk-pink2));}',
    '#pk-root .pk-hud-tag--peer{background:linear-gradient(var(--pk-blue),var(--pk-blue2));}',
    '#pk-root .pk-hud-track{flex:1;height:13px;border-radius:999px;overflow:hidden;',
    '  background:rgba(0,0,0,.42);border:1.5px solid rgba(255,255,255,.2);',
    '  box-shadow:inset 0 2px 6px rgba(0,0,0,.45);}',
    '#pk-root .pk-hud-track i{display:block;height:100%;width:100%;border-radius:999px;',
    '  transform:scaleX(0);transform-origin:left center;}',
    '#pk-root .pk-hud-row[data-who="me"] i{background:linear-gradient(90deg,#ffa6d4,#ff4fa8);}',
    '#pk-root .pk-hud-row[data-who="peer"] i{background:linear-gradient(90deg,#8fe0ff,#3ec6ff);}',
    '#pk-root .pk-hud-val{flex:none;width:52px;text-align:right;font-size:12px;font-weight:bold;',
    '  font-variant-numeric:tabular-nums;text-shadow:0 2px 4px rgba(0,0,0,.6);}',
    '#pk-root .pk-hud-meta{position:absolute;top:82px;left:50%;transform:translateX(-50%);display:flex;gap:10px;',
    '  align-items:center;font-size:12.5px;font-weight:bold;}',
    '#pk-root .pk-hud-clock{padding:4px 12px;border-radius:999px;background:rgba(8,16,40,.55);',
    '  border:1.5px solid rgba(255,255,255,.18);font-variant-numeric:tabular-nums;}',
    '#pk-root .pk-hud-gap{padding:4px 12px;border-radius:999px;background:rgba(8,16,40,.55);',
    '  border:1.5px solid rgba(255,255,255,.18);}',
    '#pk-root .pk-hud-gap.lead{color:var(--pk-ok);border-color:rgba(125,255,168,.4);}',
    '#pk-root .pk-hud-gap.behind{color:#ff9a9a;border-color:rgba(255,154,154,.4);}',
    '#pk-root .pk-hud-attack{position:absolute;right:16px;bottom:20px;width:64px;height:64px;border-radius:50%;',
    '  font-size:26px;line-height:1;pointer-events:auto;color:#43260a;',
    '  background:linear-gradient(var(--pk-gold),var(--pk-gold2));',
    '  box-shadow:0 5px 0 var(--pk-gold-sh),0 10px 22px rgba(0,0,0,.45);transition:transform .08s,box-shadow .08s;}',
    '#pk-root .pk-hud-attack:active{transform:translateY(4px);box-shadow:0 1px 0 var(--pk-gold-sh);}',
    '#pk-root .pk-hud-attack[disabled]{background:linear-gradient(#6b6f86,#4a4e64);box-shadow:0 5px 0 #2f3245;',
    '  color:rgba(255,255,255,.6);font-size:16px;font-weight:bold;}',
    /* ---- 道具槽（宿主提供 opts.item 时启用）---- */
    /* 有货：金底 + 一圈往外扩的呼吸光环，余光就能看见 */
    '#pk-root .pk-hud-attack.ready{background:linear-gradient(#ffe08a,#ffb019);',
    '  animation:pkSlotPulse 1.15s ease-in-out infinite;}',
    '@keyframes pkSlotPulse{',
    '  0%,100%{box-shadow:0 5px 0 var(--pk-gold-sh),0 0 0 0 rgba(255,206,72,.62);}',
    '  60%{box-shadow:0 5px 0 var(--pk-gold-sh),0 0 0 16px rgba(255,206,72,0);}}',
    '#pk-root .pk-hud-attack{padding:0;}',
    '#pk-root .pk-hud-attack .pk-slot-ico{display:block;font-size:31px;line-height:1;',
    '  filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));}',
    /* 空槽：暗底 + 百分比 + 底部充能条 */
    '#pk-root .pk-hud-attack.charging{background:linear-gradient(#4a5068,#333950);',
    '  box-shadow:0 5px 0 #222739,inset 0 0 0 2px rgba(255,255,255,.07);',
    '  color:#cfe4ff;pointer-events:none;}',
    '#pk-root .pk-hud-attack .pk-slot-pct{display:block;font-size:15px;font-weight:900;line-height:1;',
    '  margin-top:5px;letter-spacing:-.5px;}',
    '#pk-root .pk-hud-attack .pk-slot-bar{position:absolute;left:9px;right:9px;bottom:10px;height:5px;',
    '  border-radius:3px;background:rgba(0,0,0,.34);overflow:hidden;}',
    '#pk-root .pk-hud-attack .pk-slot-bar b{display:block;height:100%;border-radius:3px;',
    '  background:linear-gradient(#9beeff,#2aa6e6);transition:width .18s linear;}',
    '#pk-root .pk-hud-quit{position:absolute;left:18px;bottom:28px;padding:8px 16px;border-radius:999px;',
    '  font-size:13px;pointer-events:auto;background:rgba(8,16,40,.6);border:2px solid rgba(255,255,255,.22);}',
    '#pk-root .pk-hud-quit:active{transform:translateY(2px);}',
    /* 倒计时期间只显示进度条，开跑后才放出计时/干扰/弃赛 */
    '#pk-root .pk-hud-meta,#pk-root .pk-hud-attack,#pk-root .pk-hud-quit{opacity:0;pointer-events:none;',
    '  transition:opacity .25s;}',
    '#pk-root .pk-hud.racing .pk-hud-meta,#pk-root .pk-hud.racing .pk-hud-attack,',
    '#pk-root .pk-hud.racing .pk-hud-quit{opacity:1;pointer-events:auto;}',

    /* ---------- 结算 ---------- */
    '#pk-root .pk-panel--result{width:min(94vw,520px);}',
    '#pk-root .pk-result-badge{font-size:52px;line-height:1;margin-bottom:6px;}',
    '#pk-root .pk-result-title{font-size:40px;font-weight:900;letter-spacing:3px;margin:0;',
    '  filter:drop-shadow(0 3px 0 rgba(0,0,0,.35));}',
    '#pk-root .pk-result-title.win{background:linear-gradient(#ffe98a,#ffb830);-webkit-background-clip:text;',
    '  background-clip:text;color:transparent;}',
    '#pk-root .pk-result-title.lose{color:#c9d2e6;}',
    '#pk-root .pk-result-title.draw{color:#fff;}',
    '#pk-root .pk-result-sub{font-size:13px;color:rgba(255,255,255,.62);margin:8px 0 0;}',
    '#pk-root .pk-score{display:flex;flex-direction:column;gap:8px;margin:16px 0 6px;}',
    '#pk-root .pk-score-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;',
    '  background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.1);}',
    '#pk-root .pk-score-row.win{border-color:rgba(255,216,74,.55);background:rgba(255,216,74,.1);}',
    '#pk-root .pk-score-row .pk-score-av{font-size:20px;}',
    '#pk-root .pk-score-row .pk-score-name{font-size:13.5px;font-weight:bold;max-width:110px;overflow:hidden;',
    '  text-overflow:ellipsis;white-space:nowrap;}',
    '#pk-root .pk-score-row .pk-score-val{margin-left:auto;font-size:13.5px;font-weight:bold;',
    '  font-variant-numeric:tabular-nums;}',
    '#pk-root .pk-score-row .pk-score-note{font-size:11px;color:rgba(255,255,255,.5);}',
    '#pk-root .pk-rematch{display:none;margin-top:14px;padding:10px 12px;border-radius:14px;',
    '  background:rgba(62,198,255,.12);border:1.5px solid rgba(62,198,255,.4);font-size:13px;}',
    '#pk-root .pk-rematch.on{display:block;}',
    '#pk-root .pk-rematch .pk-row{justify-content:center;margin-top:8px;}',

    /* ---------- 提示条 ---------- */
    '#pk-root .pk-toasts{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);z-index:6;',
    '  display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;width:max-content;',
    '  max-width:92vw;}',
    '#pk-root .pk-toast{padding:9px 18px;border-radius:999px;font-size:13px;font-weight:bold;',
    '  background:rgba(10,14,36,.94);border:2px solid rgba(255,255,255,.2);',
    '  box-shadow:0 10px 26px rgba(0,0,0,.45);animation:pkPop .3s var(--pk-ease) both;}',
    '#pk-root .pk-toast.err{border-color:rgba(255,122,122,.7);color:#ffc9c9;}',
    '#pk-root .pk-toast.ok{border-color:rgba(125,255,168,.6);color:#c8ffd8;}',
    '#pk-root .pk-toast.out{animation:pkFade .25s ease reverse both;}',

    /* ---------- 调试抽屉 ---------- */
    '#pk-root .pk-gear{position:absolute;top:14px;right:14px;width:40px;height:40px;border-radius:50%;',
    '  display:grid;place-items:center;font-size:17px;pointer-events:auto;transition:opacity .2s,transform .1s;',
    '  background:rgba(8,16,40,.55);border:2px solid rgba(255,255,255,.2);-webkit-backdrop-filter:blur(6px);',
    '  backdrop-filter:blur(6px);}',
    '#pk-root .pk-gear:active{transform:scale(.92);}',
    '#pk-root.drawer-open .pk-gear{opacity:0;pointer-events:none;}',
    '#pk-root .pk-drawer{position:absolute;top:0;right:0;bottom:0;width:min(370px,94vw);display:flex;',
    '  flex-direction:column;pointer-events:auto;transform:translateX(102%);transition:transform .28s ease;',
    '  background:linear-gradient(180deg,#1a2049,#0c0f26);border-left:2px solid rgba(255,255,255,.14);',
    '  box-shadow:-20px 0 50px rgba(0,0,0,.55);text-align:left;}',
    '#pk-root .pk-drawer.on{transform:none;}',
    '#pk-root .pk-drawer-h{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;',
    '  font-size:15px;font-weight:bold;}',
    '#pk-root .pk-drawer-h button{font-size:16px;color:rgba(255,255,255,.6);padding:4px 8px;}',
    '#pk-root .pk-drawer-tabs{display:flex;gap:6px;padding:0 16px 10px;}',
    '#pk-root .pk-drawer-tabs button{flex:1;padding:8px 0;border-radius:10px;font-size:12.5px;font-weight:bold;',
    '  background:rgba(255,255,255,.07);color:rgba(255,255,255,.6);}',
    '#pk-root .pk-drawer-tabs button.on{background:rgba(255,79,168,.24);color:#fff;}',
    '#pk-root .pk-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 16px 10px;font-size:11.5px;}',
    '#pk-root .pk-stat{padding:7px 10px;border-radius:10px;background:rgba(255,255,255,.06);',
    '  display:flex;justify-content:space-between;gap:6px;}',
    '#pk-root .pk-stat span{color:rgba(255,255,255,.5);}',
    '#pk-root .pk-stat b{font-variant-numeric:tabular-nums;color:#fff;}',
    '#pk-root .pk-drawer-body{display:none;flex:1;min-height:0;flex-direction:column;padding:0 16px 14px;}',
    '#pk-root .pk-drawer-body.on{display:flex;}',
    '#pk-root .pk-log{flex:1;min-height:0;overflow-y:auto;padding:8px 10px;border-radius:12px;',
    '  background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.1);',
    '  font:11px/1.65 Consolas,"Courier New",monospace;color:#c7d3e6;',
    '  user-select:text;-webkit-user-select:text;touch-action:auto;word-break:break-all;}',
    '#pk-root .pk-log .t{color:#5b6a7d;}',
    '#pk-root .pk-log .ok{color:#7fd88f;}',
    '#pk-root .pk-log .err{color:#ff8a8a;}',
    '#pk-root .pk-log .ev{color:#8fd0ff;}',
    '#pk-root .pk-doc{flex:1;min-height:0;overflow-y:auto;font-size:12px;line-height:1.65;',
    '  color:rgba(255,255,255,.78);user-select:text;-webkit-user-select:text;touch-action:auto;}',
    '#pk-root .pk-doc h4{margin:10px 0 6px;font-size:12.5px;color:#ffd84a;}',
    '#pk-root .pk-doc p{margin:0 0 8px;}',
    '#pk-root .pk-doc code{padding:1px 5px;border-radius:5px;background:rgba(255,255,255,.12);',
    '  font:11px Consolas,monospace;color:#ffd9ec;}',
    '#pk-root .pk-doc pre{margin:0 0 8px;padding:9px 10px;border-radius:10px;background:rgba(0,0,0,.45);',
    '  font:10.5px/1.6 Consolas,monospace;color:#cfe0f5;overflow-x:auto;}',

    /* ---------- 窄屏 ---------- */
    '@media (max-width:440px){',
    '  #pk-root .pk-panel{padding:18px 16px 16px;border-width:2px;}',
    '  #pk-root .pk-title{font-size:34px;letter-spacing:2px;}',
    '  #pk-root .pk-steps{gap:6px;}',
    '  #pk-root .pk-steps li{font-size:11px;gap:5px;padding:7px 4px;}',
    '  #pk-root .pk-steps li i{width:17px;height:17px;font-size:10px;}',
    '  #pk-root .pk-btn{font-size:16px;padding:12px 22px;}',
    '  #pk-root .pk-vs{gap:8px;}',
    '  #pk-root .pk-avatars{gap:6px;}',
    '  #pk-root .pk-av{width:38px;height:38px;font-size:20px;}',
    '  #pk-root .pk-avatar{width:52px;height:52px;font-size:27px;}',
    '  #pk-root .pk-result-title{font-size:32px;}',
    '  #pk-root .pk-count-num{font-size:88px;}',
    '  #pk-root .pk-count-num.go{font-size:72px;}',
    '  #pk-root .pk-hud-attack{width:56px;height:56px;font-size:23px;right:14px;bottom:20px;}',
    '  #pk-root .pk-hud-board{width:94vw;}',
    '}',
    /* 矮屏（横屏手机）：压缩首屏高度，避免主按钮被切 */
    '@media (max-height:560px){',
    '  #pk-root .pk-brand-mark{display:none;}',
    '  #pk-root .pk-title{font-size:30px;letter-spacing:2px;}',
    '  #pk-root .pk-sub{font-size:12px;margin-top:4px;}',
    '  #pk-root .pk-brand{margin-bottom:10px;}',
    '  #pk-root .pk-avatars{margin:10px 0;}',
    '  #pk-root .pk-av{width:36px;height:36px;font-size:19px;}',
    '  #pk-root .pk-btn{padding:11px 22px;font-size:16px;}',
    '  #pk-root .pk-btn--block{margin-top:9px;}',
    '  #pk-root .pk-foot{margin-top:10px;}',
    '  #pk-root .pk-devtoggle{display:none;}',
    '}'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('pk-css')) return;
    var s = document.createElement('style');
    s.id = 'pk-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ==================================================================
     模板
     ================================================================== */
  var AVATARS = ['🐰', '🐼', '🐱', '🦊', '🐸', '🐯', '🐧', '🦄'];

  var TPL = [
    '<div id="pk-root">',
    /* ---- 身份屏 ---- */
    '  <div class="pk-screen pk-screen--identity" data-screen="identity">',
    '    <div class="pk-panel">',
    '      <div class="pk-brand">',
    '        <div class="pk-brand-mark">🏁</div>',
    '        <h1 class="pk-title">双人对战</h1>',
    '        <p class="pk-sub">两台设备 · 同一张图 · 同时开跑</p>',
    '      </div>',
    '      <div class="pk-avatars" id="pkAvatars"></div>',
    '      <label class="pk-label" for="pkName">你的昵称</label>',
    '      <input id="pkName" class="pk-input" maxlength="12" placeholder="给自己起个名字" autocomplete="off">',
    '      <button class="pk-btn pk-btn--block" id="pkCreate">创建房间</button>',
    '      <button class="pk-btn pk-btn--blue pk-btn--block" id="pkJoin">加入房间</button>',
    '      <div class="pk-foot"><span class="pk-dot pk-dot--ok"></span>局域网直连 · 无需服务器 · 双击文件即可</div>',
    '      <label class="pk-devtoggle"><input type="checkbox" id="pkBridgeChk">同机双开自动传码（联调）</label>',
    '    </div>',
    '  </div>',

    /* ---- 三步向导 ---- */
    '  <div class="pk-screen pk-screen--wiz" data-screen="wiz">',
    '    <div class="pk-panel">',
    '      <div class="pk-wiz-head">',
    '        <h2 id="pkWizTitle">创建房间</h2>',
    '        <button class="pk-wiz-cancel" id="pkWizCancel">取消</button>',
    '      </div>',
    '      <ol class="pk-steps" id="pkSteps">',
    '        <li data-step="1"><i>1</i><span>生成邀请码</span></li>',
    '        <li data-step="2"><i>2</i><span>交换回执</span></li>',
    '        <li data-step="3"><i>3</i><span>连接成功</span></li>',
    '      </ol>',

    /* 房主 */
    '      <div class="pk-wiz-role" data-wiz-role="host">',
    '        <section class="pk-card">',
    '          <div class="pk-card-h"><span class="pk-badge">1</span>把邀请码发给朋友</div>',
    '          <div class="pk-code" id="pkInviteWrap">',
    '            <textarea id="pkInviteOut" readonly placeholder="正在生成邀请码…"></textarea>',
    '          </div>',
    '          <div class="pk-code-foot">',
    '            <span class="pk-code-len" id="pkInviteLen">— 字符</span>',
    '            <div class="pk-row">',
    '              <button class="pk-btn pk-btn--gold pk-btn--sm" id="pkCopyInvite">复制邀请码</button>',
    '              <button class="pk-btn pk-btn--ghost pk-btn--sm" id="pkExpandInvite">展开</button>',
    '            </div>',
    '          </div>',
    '          <p class="pk-hint">微信 / QQ 直接粘贴发送即可，约 800 字符。</p>',
    '        </section>',
    '        <section class="pk-card">',
    '          <div class="pk-card-h"><span class="pk-badge">2</span>粘贴朋友回传的回执码</div>',
    '          <textarea id="pkReplyIn" class="pk-input pk-input--code" placeholder="在这里粘贴回执码" autocomplete="off"></textarea>',
    '          <div class="pk-validate" id="pkReplyHint">收到回执码后点「确认连接」</div>',
    '          <button class="pk-btn pk-btn--block" id="pkConfirm">确认连接</button>',
    '        </section>',
    '      </div>',

    /* 客人 */
    '      <div class="pk-wiz-role" data-wiz-role="guest">',
    '        <section class="pk-card">',
    '          <div class="pk-card-h"><span class="pk-badge">1</span>粘贴朋友的邀请码</div>',
    '          <textarea id="pkInviteIn" class="pk-input pk-input--code" placeholder="在这里粘贴邀请码" autocomplete="off"></textarea>',
    '          <div class="pk-validate" id="pkInviteHint">信令码较长，请确认完整复制</div>',
    '          <button class="pk-btn pk-btn--block" id="pkJoinGo">加入房间</button>',
    '        </section>',
    '        <section class="pk-card">',
    '          <div class="pk-card-h"><span class="pk-badge">2</span>把回执码发回朋友</div>',
    '          <div class="pk-code" id="pkReplyWrap">',
    '            <textarea id="pkReplyOut" readonly placeholder="点「加入房间」后生成"></textarea>',
    '          </div>',
    '          <div class="pk-code-foot">',
    '            <span class="pk-code-len" id="pkReplyLen">— 字符</span>',
    '            <div class="pk-row">',
    '              <button class="pk-btn pk-btn--gold pk-btn--sm" id="pkCopyReply">复制回执码</button>',
    '              <button class="pk-btn pk-btn--ghost pk-btn--sm" id="pkExpandReply">展开</button>',
    '            </div>',
    '          </div>',
    '          <p class="pk-hint">朋友粘贴后点「确认连接」，双方即接通。</p>',
    '        </section>',
    '      </div>',

    /* 连接中 */
    '      <div class="pk-linkwait" id="pkLinkWait">',
    '        <div class="pk-spinner pk-spinner--lg"></div>',
    '        <div class="pk-linkwait-t" id="pkLinkWaitT">正在打通直连…</div>',
    '        <div class="pk-linkwait-s" id="pkLinkWaitS">通常 1~3 秒，请稍候</div>',
    '      </div>',
    '    </div>',
    '  </div>',

    /* ---- 备战大厅 ---- */
    '  <div class="pk-screen pk-screen--lobby" data-screen="lobby">',
    '    <div class="pk-panel">',
    '      <h2 class="pk-panel-title">对战大厅</h2>',
    '      <div class="pk-vs">',
    '        <div class="pk-player pk-player--me">',
    '          <div class="pk-avatar" id="pkMeAvatar">🐰</div>',
    '          <div class="pk-pname" id="pkMeName">我</div>',
    '          <div class="pk-rolechip host" id="pkMeRole">房主</div>',
    '        </div>',
    '        <div class="pk-vs-mark">VS</div>',
    '        <div class="pk-player pk-player--peer">',
    '          <div class="pk-avatar" id="pkPeerAvatar">🐼</div>',
    '          <div class="pk-pname" id="pkPeerName">对方</div>',
    '          <div class="pk-rolechip guest" id="pkPeerRole">客人</div>',
    '        </div>',
    '      </div>',
    '      <div class="pk-net"><span class="pk-dot pk-dot--ok" id="pkNetDot"></span><span id="pkNetText">延迟 — · 时钟对齐中…</span></div>',
    '      <div class="pk-modes">',
    '        <span class="pk-modes-label">胜负规则</span>',
    '        <div class="pk-chips" id="pkModeChips"></div>',
    '      </div>',
    '      <button class="pk-btn pk-btn--block" id="pkStart">开始对战</button>',
    '      <p class="pk-hint pk-clock-hint" id="pkClockHint">正在校准双方时钟，约 5 秒后可开赛…</p>',
    '      <button class="pk-btn pk-btn--ghost pk-btn--block" id="pkLeave">离开房间</button>',
    '    </div>',
    '  </div>',

    /* ---- 结算 ---- */
    '  <div class="pk-screen pk-screen--result" data-screen="result">',
    '    <div class="pk-panel pk-panel--result">',
    '      <div class="pk-result-badge" id="pkResultBadge">🏆</div>',
    '      <h2 class="pk-result-title win" id="pkResultTitle">你赢了</h2>',
    '      <p class="pk-result-sub" id="pkResultSub"></p>',
    '      <div class="pk-score" id="pkScore"></div>',
    '      <div class="pk-rematch" id="pkRematchBar"></div>',
    '      <button class="pk-btn pk-btn--block" id="pkAgain">再来一局</button>',
    '      <button class="pk-btn pk-btn--blue pk-btn--block" id="pkBackLobby">回到大厅</button>',
    '      <button class="pk-linkbtn" id="pkExit">离开房间</button>',
    '    </div>',
    '  </div>',

    /* ---- 倒计时 / HUD / 提示 ---- */
    '  <div class="pk-countdown" id="pkCountdown">',
    '    <div class="pk-count-num" id="pkCountNum">3</div>',
    '    <div class="pk-count-sub" id="pkCountSub">准备…</div>',
    '  </div>',
    '  <div class="pk-hud" id="pkHud">',
    '    <div class="pk-hud-board">',
    '      <div class="pk-hud-row" data-who="me">',
    '        <span class="pk-hud-tag pk-hud-tag--me">我</span>',
    '        <div class="pk-hud-track"><i id="pkMeBar"></i></div>',
    '        <span class="pk-hud-val" id="pkMeM">0m</span>',
    '      </div>',
    '      <div class="pk-hud-row" data-who="peer">',
    '        <span class="pk-hud-tag pk-hud-tag--peer">对方</span>',
    '        <div class="pk-hud-track"><i id="pkPeerBar"></i></div>',
    '        <span class="pk-hud-val" id="pkPeerM">0m</span>',
    '      </div>',
    '    </div>',
    '    <div class="pk-hud-meta">',
    '      <span class="pk-hud-clock" id="pkTimer">0.0s</span>',
    '      <span class="pk-hud-gap" id="pkGap">—</span>',
    '    </div>',
    '    <button class="pk-hud-attack" id="pkAttack" title="干扰对方：让对方减速 2 秒">⚡</button>',
    '    <button class="pk-hud-quit" id="pkQuit">弃赛</button>',
    '  </div>',
    '  <div class="pk-toasts" id="pkToasts"></div>',

    /* ---- 调试抽屉 ---- */
    '  <button class="pk-gear" id="pkGear" title="调试面板" aria-label="调试面板">⚙</button>',
    '  <aside class="pk-drawer" id="pkDrawer">',
    '    <div class="pk-drawer-h"><b>调试面板</b><button id="pkDrawerClose" aria-label="关闭">✕</button></div>',
    '    <div class="pk-drawer-tabs">',
    '      <button data-tab="log" class="on">事件日志</button>',
    '      <button data-tab="doc">集成说明</button>',
    '    </div>',
    '    <div class="pk-stats" id="pkStats"></div>',
    '    <div class="pk-drawer-body on" data-panel="log">',
    '      <div class="pk-log" id="pkLog"></div>',
    '    </div>',
    '    <div class="pk-drawer-body" data-panel="doc">',
    '      <div class="pk-doc">',
    '        <p>本文件自带插件源码（<code>PKVS 插件源码</code> 标记段）。并入游戏时把 <code>pkvs.js</code> 与 <code>pkvs-lobby.js</code> 一起内联或外链即可。</p>',
    '        <h4>最小接入</h4>',
    '        <pre>const lobby = PKVS_Lobby.create({\n  name: playerName,\n  goal: 5000,\n  on: { start(e){ buildLevel(e.seed) } }\n});\nlobby.open();\n\n// 游戏循环\nlobby.sendProgress({ distance, speed });\n// 到达终点 / 死亡\nlobby.reportResult({ distance, timeMs, dnf });</pre>',
    '        <h4>要点</h4>',
    '        <p>① <code>matchStart.seed</code> 双方必须用于同一个关卡生成器；<br>',
    '        ② 开跑时刻已按钟差换算（&lt;10ms），用 <code>lobby.timeToStart()</code> 驱动倒计时；<br>',
    '        ③ 计时取 <code>Date.now() - startAtLocal</code>；<br>',
    '        ④ 对局中断线自动判对方负；<br>',
    '        ⑤ 游戏自带 HUD 时传 <code>hud:\'off\'</code>，只保留大厅与结算。</p>',
    '        <h4>可覆盖主题</h4>',
    '        <p>在 <code>#pk-root</code> 上覆盖 <code>--pk-pink / --pk-blue / --pk-gold / --pk-panel1..3 / --pk-r-panel</code> 即可换肤。</p>',
    '      </div>',
    '    </div>',
    '  </aside>',
    '</div>'
  ].join('\n');

  /* ==================================================================
     工具
     ================================================================== */
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function avatarFor(name) {
    var s = String(name || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATARS[h % AVATARS.length];
  }

  function fmtSec(ms) {
    if (ms == null || isNaN(ms)) return '—';
    return (ms / 1000).toFixed(2) + 's';
  }

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem('pkvs.' + key);
      if (val === null) localStorage.removeItem('pkvs.' + key);
      else localStorage.setItem('pkvs.' + key, val);
    } catch (e) { /* file:// 隐私模式可能不可用 */ }
    return null;
  }

  /* ==================================================================
     主类
     ================================================================== */
  function Lobby(opts) {
    opts = opts || {};
    this.opts = opts;
    this.name = String(opts.name || store('name') || '玩家').slice(0, 12);
    this.avatar = String((opts.identity && opts.identity.avatar) || store('avatar') || '🐰');
    this.goal = +opts.goal || 5000;
    this.hudMode = opts.hud || 'overlay';
    this.stateHz = opts.stateHz || 15;
    this.countdownMs = (opts.matchOptions && opts.matchOptions.countdownMs) || 3000;
    this.modes = opts.modes || [
      { id: 'race', label: '竞速' },
      { id: 'distance', label: '距离' },
      { id: 'score', label: '分数' }
    ];
    this.mode = (opts.matchOptions && opts.matchOptions.mode) || 'race';

    this.root = null;
    this.vs = null;
    this.screen = 'identity';
    this.role = null;
    this.peerName = null;
    this.rtt = null;
    this.clockReady = false;
    this.offset = 0;
    this.inviteCode = '';
    this.replyCode = '';
    this.busy = '';
    this.race = null;
    this.result = null;
    this.rematch = 'idle';
    this.logs = [];
    this.bridgeOn = opts.bridge !== false;
    this.bc = null;
    this._raf = 0;
    this._linkTimer = 0;
    this._statTimer = 0;
    this._toastTimers = [];
    this._attackCd = 0;
  }

  Lobby.prototype = {

    /* ---------------- 生命周期 ---------------- */
    open: function () {
      this.mount();
      this.root.style.display = '';
      if (this.screen === 'identity') this.setScreen('identity');
      return this;
    },

    close: function () {
      if (!this.root) return;
      this.stopLoop();
      this.root.style.display = 'none';
    },

    destroy: function () {
      this.stopLoop();
      if (this.vs) { try { this.vs.cancel(); } catch (e) { /* noop */ } this.vs = null; }
      if (this.bc) { try { this.bc.close(); } catch (e) { /* noop */ } this.bc = null; }
      clearInterval(this._statTimer);
      if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
      this.root = null;
    },

    mount: function () {
      if (this.root) return;
      if (!global.PKVS) {
        console.error('[PKVS_Lobby] 未找到 PKVS，请先引入 pkvs.js');
        return;
      }
      injectCSS();
      var wrap = document.createElement('div');
      wrap.innerHTML = TPL;
      this.root = wrap.firstElementChild;
      (this.opts.mount || document.body).appendChild(this.root);
      this.$ = function (sel) { return this.root.querySelector(sel); };
      this.$$ = function (sel) { return Array.prototype.slice.call(this.root.querySelectorAll(sel)); };
      this.buildAvatars();
      this.buildModeChips();
      this.bind();
      this.initBridge();
      this.renderIdentity();
      this.renderStats();
      if (!global.PKVS.isSupported) {
        this.toast('当前浏览器不支持 WebRTC，无法联机', 'err');
        this.$('#pkCreate').disabled = true;
        this.$('#pkJoin').disabled = true;
      }
      this.log('PKVS Lobby v' + VERSION + ' 就绪 · 压缩信令 ' +
        (global.PKVS.compressionSupported ? '开启' : '降级'), 'ok');
    },

    /* ---------------- 初始化 ---------------- */
    buildAvatars: function () {
      var self = this;
      var box = this.$('#pkAvatars');
      box.innerHTML = AVATARS.map(function (a) {
        return '<button class="pk-av' + (a === self.avatar ? ' on' : '') + '" data-av="' + a + '">' + a + '</button>';
      }).join('');
      box.addEventListener('click', function (e) {
        var b = e.target.closest('.pk-av');
        if (!b) return;
        self.avatar = b.getAttribute('data-av');
        store('avatar', self.avatar);
        self.$$('.pk-av').forEach(function (n) { n.classList.toggle('on', n === b); });
      });
    },

    buildModeChips: function () {
      var self = this;
      var box = this.$('#pkModeChips');
      box.innerHTML = this.modes.map(function (m) {
        return '<button class="pk-chip' + (m.id === self.mode ? ' on' : '') + '" data-mode="' +
          m.id + '">' + esc(m.label) + '</button>';
      }).join('');
      box.addEventListener('click', function (e) {
        var b = e.target.closest('.pk-chip');
        if (!b || self.role !== 'host') return;
        self.mode = b.getAttribute('data-mode');
        self.$$('#pkModeChips .pk-chip').forEach(function (n) { n.classList.toggle('on', n === b); });
      });
    },

    bind: function () {
      var self = this;
      var $ = function (id) { return self.root.querySelector('#' + id); };

      $('pkName').value = this.name;
      $('pkName').addEventListener('input', function () {
        self.name = this.value.slice(0, 12);
        store('name', self.name);
      });
      $('pkName').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') self.doHost();
      });

      $('pkCreate').addEventListener('click', function () { self.doHost(); });
      $('pkJoin').addEventListener('click', function () { self.enterJoin(); });

      var bridgeChk = $('pkBridgeChk');
      bridgeChk.checked = this.bridgeOn;
      bridgeChk.addEventListener('change', function () { self.bridgeOn = this.checked; });

      /* 向导 */
      $('pkWizCancel').addEventListener('click', function () { self.cancelHandshake(); });
      $('pkCopyInvite').addEventListener('click', function () {
        self.copy(self.inviteCode, this, '复制邀请码');
      });
      $('pkCopyReply').addEventListener('click', function () {
        self.copy(self.replyCode, this, '复制回执码');
      });
      $('pkExpandInvite').addEventListener('click', function () {
        self.toggleExpand($('pkInviteWrap'), this);
      });
      $('pkExpandReply').addEventListener('click', function () {
        self.toggleExpand($('pkReplyWrap'), this);
      });
      $('pkConfirm').addEventListener('click', function () { self.doConfirm(); });
      $('pkJoinGo').addEventListener('click', function () { self.doJoin(); });

      /* 粘贴识别 */
      ['pkReplyIn', 'pkInviteIn'].forEach(function (id) {
        var el = $(id);
        el.addEventListener('input', function () { self.validate(id); });
        el.addEventListener('paste', function () {
          setTimeout(function () { self.validate(id); }, 30);
        });
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (id === 'pkReplyIn') self.doConfirm(); else self.doJoin();
          }
        });
      });

      /* 码卡点击全选 */
      ['pkInviteOut', 'pkReplyOut'].forEach(function (id) {
        $(id).addEventListener('focus', function () { this.select(); });
        $(id).addEventListener('click', function () { this.select(); });
      });

      /* 大厅 */
      $('pkStart').addEventListener('click', function () { self.startMatch(); });
      $('pkLeave').addEventListener('click', function () { self.leave(); });

      /* 结算 */
      $('pkAgain').addEventListener('click', function () { self.askRematch(); });
      $('pkBackLobby').addEventListener('click', function () {
        var offline = self.result && self.result.offline;
        self.result = null;
        self.setScreen(offline ? 'identity' : 'lobby');
        if (!offline) self.renderLobby();
      });
      $('pkExit').addEventListener('click', function () { self.leave(); });

      /* HUD */
      $('pkAttack').addEventListener('click', function () { self.useItem(); });
      $('pkQuit').addEventListener('click', function () {
        if (self.result) return;
        self.reportResult({ distance: Math.round(self.race ? self.race.me : 0), score: 0, timeMs: null, dnf: true });
        self.toast('已弃赛，等待判定…');
      });

      /* 抽屉 */
      $('pkGear').addEventListener('click', function () { self.toggleDrawer(true); });
      $('pkDrawerClose').addEventListener('click', function () { self.toggleDrawer(false); });
      this.$$('.pk-drawer-tabs button').forEach(function (b) {
        b.addEventListener('click', function () {
          self.$$('.pk-drawer-tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
          self.$$('.pk-drawer-body').forEach(function (p) {
            p.classList.toggle('on', p.getAttribute('data-panel') === b.getAttribute('data-tab'));
          });
        });
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.root.classList.contains('drawer-open')) self.toggleDrawer(false);
      });
    },

    initBridge: function () {
      if (!('BroadcastChannel' in window)) return;
      var self = this;
      try {
        this.bc = new BroadcastChannel('pkvs-lobby-bridge');
      } catch (e) { return; }
      this.bc.onmessage = function (e) {
        if (!self.bridgeOn) return;
        var m = e.data || {};
        var phase = self.vs ? self.vs.info().phase : 'idle';
        if (m.type === 'invite' && phase === 'idle' && m.code) {
          self.enterJoin();
          self.$('#pkInviteIn').value = m.code;
          self.validate('pkInviteIn');
          self.doJoin();
        } else if (m.type === 'reply' && phase === 'hosting' && m.code) {
          self.$('#pkReplyIn').value = m.code;
          self.validate('pkReplyIn');
          self.doConfirm();
        }
      };
    },

    /* ---------------- 通用 UI ---------------- */
    setScreen: function (name) {
      this.screen = name;
      var root = this.root;
      this.$$('.pk-screen').forEach(function (el) {
        el.classList.toggle('on', el.getAttribute('data-screen') === name);
      });
      var hud = root.querySelector('#pkHud');
      var showHud = (name === 'race' || name === 'countdown') && this.hudMode !== 'off';
      hud.classList.toggle('on', showHud);
      if (name !== 'countdown') root.querySelector('#pkCountdown').classList.remove('on');
      if (name !== 'race' && name !== 'countdown') this.stopLoop();
    },

    toast: function (msg, kind) {
      if (!this.root) return;
      var box = this.root.querySelector('#pkToasts');
      var el = document.createElement('div');
      el.className = 'pk-toast' + (kind ? ' ' + kind : '');
      el.textContent = msg;
      box.appendChild(el);
      var t = setTimeout(function () {
        el.classList.add('out');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
      }, kind === 'err' ? 3200 : 2200);
      this._toastTimers.push(t);
      while (box.children.length > 3) box.removeChild(box.firstChild);
    },

    log: function (msg, kind) {
      var t = new Date();
      var hh = String(t.getHours()).padStart(2, '0');
      var mm = String(t.getMinutes()).padStart(2, '0');
      var ss = String(t.getSeconds()).padStart(2, '0');
      this.logs.push({ time: hh + ':' + mm + ':' + ss, msg: msg, kind: kind || '' });
      if (this.logs.length > 200) this.logs.shift();
      this.renderLog();
    },

    renderLog: function () {
      if (!this.root) return;
      var box = this.root.querySelector('#pkLog');
      if (!box) return;
      box.innerHTML = this.logs.map(function (l) {
        return '<div><span class="t">[' + l.time + ']</span> <span class="' + l.kind + '">' +
          esc(l.msg) + '</span></div>';
      }).join('');
      box.scrollTop = box.scrollHeight;
    },

    renderStats: function () {
      if (!this.root) return;
      var box = this.root.querySelector('#pkStats');
      if (!box) return;
      var inf = this.vs ? this.vs.info() : null;
      var rows = [
        ['阶段', inf ? inf.phase : 'idle'],
        ['角色', inf && inf.role ? (inf.role === 'host' ? '房主' : '客人') : '—'],
        ['对方', (inf && inf.peerName) || '—'],
        ['延迟', inf && inf.rttMs != null ? inf.rttMs + 'ms' : '—'],
        ['钟差', inf && inf.clockReady ? inf.clockOffsetMs + 'ms' : '对齐中'],
        ['种子', inf && inf.match ? inf.match.seed : '—']
      ];
      box.innerHTML = rows.map(function (r) {
        return '<div class="pk-stat"><span>' + r[0] + '</span><b>' + esc(r[1]) + '</b></div>';
      }).join('');
    },

    toggleDrawer: function (on) {
      if (!this.root) return;
      var drawer = this.root.querySelector('#pkDrawer');
      var open = on == null ? !drawer.classList.contains('on') : on;
      drawer.classList.toggle('on', open);
      this.root.classList.toggle('drawer-open', open);
      clearInterval(this._statTimer);
      if (open) {
        this.renderStats();
        this.renderLog();
        var self = this;
        this._statTimer = setInterval(function () { self.renderStats(); }, 600);
      }
    },

    copy: function (text, btn, label) {
      if (!text) return;
      var self = this;
      var done = function (ok) {
        if (ok) {
          btn.textContent = '已复制 ✓';
          btn.disabled = true;
          setTimeout(function () { btn.textContent = label; btn.disabled = false; }, 1500);
          self.toast('已复制到剪贴板', 'ok');
          self.log('已复制 ' + text.length + ' 字符', 'ok');
        } else {
          self.toast('复制失败，请长按全选复制', 'err');
        }
      };
      // file:// 下 navigator.clipboard 不可用，execCommand 更可靠
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) return done(true);
      } catch (e) { /* 落到 clipboard API */ }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else done(false);
    },

    toggleExpand: function (wrap, btn) {
      var on = wrap.classList.toggle('expanded');
      btn.textContent = on ? '收起' : '展开';
    },

    shake: function (el) {
      if (!el) return;
      el.classList.remove('pk-shake');
      void el.offsetWidth;
      el.classList.add('pk-shake');
      el.classList.add('is-err');
      setTimeout(function () { el.classList.remove('is-err'); }, 1200);
    },

    /* ---------------- 信令码校验 ---------------- */
    checkCode: function (raw) {
      var clean = String(raw || '').replace(/\s+/g, '');
      if (!clean) return { ok: false, msg: '' };
      if (clean.indexOf('PK1') !== 0) return { ok: false, msg: '这不是 PKVS 信令码（应以 PK1 开头）' };
      if (!/^PK1[CR][A-Za-z0-9_-]+\.[0-9a-f]{4}$/.test(clean)) {
        return { ok: false, msg: '信令码不完整，请确认整段复制' };
      }
      if (clean.length < 200) {
        return { ok: false, msg: '信令码只有 ' + clean.length + ' 字符，明显不完整' };
      }
      return { ok: true, msg: '已识别 · ' + clean.length + ' 字符', clean: clean };
    },

    validate: function (id) {
      var el = this.root.querySelector('#' + id);
      var hint = this.root.querySelector(id === 'pkReplyIn' ? '#pkReplyHint' : '#pkInviteHint');
      var r = this.checkCode(el.value);
      if (!r.msg) {
        hint.className = 'pk-validate';
        hint.textContent = id === 'pkReplyIn' ? '收到回执码后点「确认连接」' : '信令码较长，请确认完整复制';
        this.refreshActions();
        return false;
      }
      hint.className = 'pk-validate ' + (r.ok ? 'ok' : 'err');
      hint.textContent = r.msg;
      this.refreshActions();
      return r.ok;
    },

    /* ---------------- 身份 → 创建 / 加入 ---------------- */
    doHost: function () {
      if (this.busy || !this.root) return;
      var self = this;
      this.role = 'host';
      this.inviteCode = '';
      this.replyCode = '';
      this.busy = 'gen';
      this.setScreen('wiz');
      this.renderWiz();
      this.log('创建房间中…');
      var mine = this.vs = this.makeVS();
      this.vs.createRoom().then(function (code) {
        if (self.vs !== mine) return;          // 期间被取消
        self.inviteCode = code;
        self.busy = '';
        self.renderWiz();
        self.log('房间已创建 · 邀请码 ' + code.length + ' 字符', 'ok');
        self.bridgeSend({ type: 'invite', code: code });
      }).catch(function (err) {
        if (self.vs !== mine) return;
        self.busy = '';
        self.vs = null;
        self.setScreen('identity');
        self.toast('创建失败：' + (err && err.message || err), 'err');
        self.log('创建失败 ' + (err && err.message), 'err');
      });
    },

    enterJoin: function () {
      if (this.busy || !this.root) return;
      this.role = 'guest';
      this.inviteCode = '';
      this.replyCode = '';
      this.busy = '';
      this.setScreen('wiz');
      this.renderWiz();
      var el = this.$('#pkInviteIn');
      if (el) setTimeout(function () { el.focus(); }, 120);
    },

    doJoin: function () {
      if (this.busy || !this.root) return;
      var self = this;
      var el = this.$('#pkInviteIn');
      var r = this.checkCode(el.value);
      if (!r.ok) {
        this.shake(el);
        this.toast(r.msg || '请先粘贴邀请码', 'err');
        return;
      }
      this.busy = 'gen';
      this.renderWiz();
      var mine = this.vs = this.makeVS();
      this.vs.joinRoom(r.clean).then(function (reply) {
        if (self.vs !== mine) return;          // 期间被取消
        self.replyCode = reply;
        self.busy = '';
        self.renderWiz();
        self.log('已生成回执码 ' + reply.length + ' 字符', 'ok');
        self.toast('回执码已生成，发给朋友', 'ok');
        self.bridgeSend({ type: 'reply', code: reply });
        self.armLinkTimeout('guest');
      }).catch(function (err) {
        if (self.vs !== mine) return;
        self.busy = '';
        if (self.vs) { try { self.vs.cancel(); } catch (e) { /* noop */ } self.vs = null; }
        self.renderWiz();
        self.shake(el);
        var msg = err && err.message || String(err);
        self.toast(msg, 'err');
        self.log('加入失败 ' + msg, 'err');
        var hint = self.$('#pkInviteHint');
        hint.className = 'pk-validate err';
        hint.textContent = msg;
      });
    },

    doConfirm: function () {
      if (this.busy || !this.root || !this.vs) return;
      var self = this;
      var el = this.$('#pkReplyIn');
      var r = this.checkCode(el.value);
      if (!r.ok) {
        this.shake(el);
        this.toast(r.msg || '请先粘贴回执码', 'err');
        return;
      }
      this.busy = 'link';
      this.renderWiz();
      this.vs.confirmRoom(r.clean).then(function () {
        self.busy = '';
        self.showLinkWait('正在打通直连…');
        self.armLinkTimeout('host');
        self.log('回执已确认，等待通道建立…');
      }).catch(function (err) {
        self.busy = '';
        self.renderWiz();
        self.shake(el);
        var msg = err && err.message || String(err);
        self.toast(msg, 'err');
        self.log('确认失败 ' + msg, 'err');
        var hint = self.$('#pkReplyHint');
        hint.className = 'pk-validate err';
        hint.textContent = msg;
      });
    },

    cancelHandshake: function () {
      var self = this;
      if (this.vs) {
        try { this.vs.cancel(); } catch (e) { /* noop */ }
        this.vs = null;
      }
      clearTimeout(this._linkTimer);
      this.busy = '';
      this.inviteCode = '';
      this.replyCode = '';
      this.rematch = 'idle';
      this.setScreen('identity');
      this.log('已取消');
      this.toast('已取消');
    },

    makeVS: function () {
      var self = this;
      return new global.PKVS({
        name: this.name || '玩家',
        stateHz: this.stateHz,
        onEvent: function (e) { self.onVSEvent(e); }
      });
    },

    armLinkTimeout: function (who) {
      var self = this;
      clearTimeout(this._linkTimer);
      this._linkTimer = setTimeout(function () {
        if (self.screen !== 'wiz') return;
        self.$('#pkLinkWaitT').textContent = '直连建立超时';
        self.$('#pkLinkWaitS').textContent = who === 'host'
          ? '请确认对方已点「确认连接」，或取消后重试'
          : '请确认对方已粘贴回执码并确认，或取消后重试';
        self.log('直连建立超时', 'err');
      }, 15000);
    },

    bridgeSend: function (obj) {
      if (!this.bc || !this.bridgeOn) return;
      try { this.bc.postMessage(obj); } catch (e) { /* noop */ }
    },

    /* ---------------- 插件事件 ---------------- */
    onVSEvent: function (e) {
      switch (e.type) {
        case 'phase': this.onPhase(e.phase); break;

        case 'linkUp':
          clearTimeout(this._linkTimer);
          this.role = this.vs ? this.vs.info().role : this.role;
          this.log('连接已建立 · 我是' + (this.role === 'host' ? '房主' : '客人'), 'ok');
          this.setScreen('lobby');
          this.renderLobby();
          break;

        case 'peerHello':
          this.peerName = e.name;
          this.log('对方：' + e.name, 'ev');
          this.renderLobby();
          break;

        case 'clockReady':
          this.rtt = e.rttMs;
          this.offset = e.offsetMs;
          this.clockReady = true;
          this.log('时钟同步就绪 rtt=' + e.rttMs + 'ms offset=' + e.offsetMs + 'ms', 'ok');
          this.renderLobby();
          break;

        case 'matchStart':
          this.beginRace(e);
          break;

        case 'peerProgress':
          if (this.race) {
            this.race.peer = +e.state.distance || 0;
            this.race.peerAt = performance.now();
            this.race.peerSpeed = +e.state.speed || 13;
            this.race.peerSlow = !!e.state.slow;
          }
          break;

        case 'peerEvent':
          this.log('收到事件 ' + e.event + ' ' + JSON.stringify(e.data || {}), 'ev');
          // 宿主接了道具系统（opts.item）就由它自己判定抗性、播效果；插件不再抢着减速
          if (e.event === 'attack' && !this.opts.item && this.race && !this.race.done) {
            this.race.slowUntil = Date.now() + ((e.data && e.data.ms) || 2000);
            this.toast('💢 被对方干扰，减速 2 秒', 'err');
          }
          break;

        case 'peerResult':
          this.log('对方上报成绩 ' + JSON.stringify(e.result), 'ev');
          break;

        case 'matchEnd':
          this.endRace(e);
          break;

        case 'peerRematch':
          this.rematch = 'peerAsk';
          this.log('对方想再来一局', 'ev');
          this.renderRematch();
          break;

        case 'rematchWait':
          this.rematch = 'waiting';
          this.renderRematch();
          break;

        case 'linkDown':
          clearTimeout(this._linkTimer);
          this.rtt = null;
          this.clockReady = false;
          this.log('连接断开 ' + e.reason, 'err');
          if (this.screen !== 'result' && this.screen !== 'race') {
            this.toast('连接已断开（' + e.reason + '）', 'err');
          }
          break;

        case 'warning':
          this.log('警告 ' + e.message, 'err');
          break;

        case 'error':
          this.log('错误 ' + e.code + ' ' + e.message, 'err');
          this.toast(e.message, 'err');
          break;
      }
      this.forward(e);
    },

    forward: function (e) {
      var h = this.opts.on;
      if (!h) return;
      if (typeof h[e.type] === 'function') {
        try { h[e.type](e); } catch (err) { console.error('[PKVS_Lobby] on.' + e.type, err); }
      }
      if (typeof h['*'] === 'function') {
        try { h['*'](e); } catch (err) { console.error('[PKVS_Lobby] on.*', err); }
      }
    },

    onPhase: function (phase) {
      this.log('阶段 → ' + phase);
      if (phase === 'hosting' || phase === 'joining') {
        if (this.screen !== 'wiz') { this.setScreen('wiz'); }
        this.renderWiz();
      } else if (phase === 'connected') {
        this.setScreen('lobby');
        this.renderLobby();
      } else if (phase === 'idle' || phase === 'closed') {
        clearTimeout(this._linkTimer);
        this.vs = null;
        this.rtt = null;
        this.clockReady = false;
        this.rematch = 'idle';
        if (this.screen === 'result' && this.result) {
          // 对局刚结束就断线：保留结算结果，只把操作降级
          this.result.offline = true;
          this.renderResult();
        } else {
          this.race = null;
          this.result = null;
          this.setScreen('identity');
          this.renderIdentity();
        }
      }
    },

    /* ---------------- 身份 / 向导渲染 ---------------- */
    renderIdentity: function () {
      if (!this.root) return;
      this.$('#pkMeAvatar').textContent = this.avatar;
      this.$('#pkMeName').textContent = this.name || '我';
    },

    showLinkWait: function (title, sub) {
      this.$('#pkLinkWaitT').textContent = title || '正在打通直连…';
      this.$('#pkLinkWaitS').textContent = sub || '通常 1~3 秒，请稍候';
      this.$$('.pk-wiz-role').forEach(function (el) { el.classList.remove('on'); });
      this.$('#pkLinkWait').classList.add('on');
      this.$$('.pk-steps li').forEach(function (li, i) {
        li.classList.remove('on');
        li.classList.toggle('done', i < 2);
        li.querySelector('i').textContent = i < 2 ? '✓' : (i + 1);
      });
      var third = this.$('.pk-steps li[data-step="3"]');
      if (third) third.classList.add('on');
    },

    renderWiz: function () {
      if (!this.root) return;
      var isHost = this.role === 'host';
      var wait = this.$('#pkLinkWait');
      var linkMode = this.busy === 'link' || wait.classList.contains('on');

      this.$('#pkWizTitle').textContent = isHost ? '创建房间' : '加入房间';
      this.$('#pkWizCancel').textContent = linkMode ? '取消' : '取消';

      if (!linkMode) {
        wait.classList.remove('on');
        this.$$('.pk-wiz-role').forEach(function (el) {
          el.classList.toggle('on', el.getAttribute('data-wiz-role') === (isHost ? 'host' : 'guest'));
        });
      }

      // 步骤文案
      var labels = isHost ? ['生成邀请码', '粘贴回执码', '连接成功'] : ['粘贴邀请码', '回传回执码', '连接成功'];
      var lis = this.$$('.pk-steps li');
      lis.forEach(function (li, i) { li.querySelector('span').textContent = labels[i]; });

      var step = 1;
      if (isHost) {
        if (this.inviteCode) step = 2;
        if (linkMode) step = 3;
      } else {
        if (this.replyCode) step = 2;
        if (linkMode) step = 3;
      }
      lis.forEach(function (li, i) {
        var n = i + 1;
        var done = n < step;
        li.classList.toggle('on', n === step);
        li.classList.toggle('done', done);
        li.querySelector('i').textContent = done ? '✓' : n;
      });

      // 码
      var inv = this.$('#pkInviteOut');
      var rep = this.$('#pkReplyOut');
      if (inv) {
        inv.value = this.inviteCode || '';
        this.$('#pkInviteLen').textContent = this.inviteCode
          ? this.inviteCode.length + ' 字符' : '— 字符';
        this.$('#pkExpandInvite').style.display = this.inviteCode ? '' : 'none';
        this.$('#pkCopyInvite').disabled = !this.inviteCode;
      }
      if (rep) {
        rep.value = this.replyCode || '';
        this.$('#pkReplyLen').textContent = this.replyCode
          ? this.replyCode.length + ' 字符' : '— 字符';
        this.$('#pkExpandReply').style.display = this.replyCode ? '' : 'none';
        this.$('#pkCopyReply').disabled = !this.replyCode;
      }

      // 按钮忙碌态
      this.setBusy(this.$('#pkJoinGo'), this.busy === 'gen' && !isHost, '加入房间');
      this.setBusy(this.$('#pkConfirm'), this.busy === 'link' || this.busy === 'gen' && isHost, '确认连接');
      this.refreshActions();
    },

    /* 未粘贴合法信令码时禁用提交，避免点了才知道不行 */
    refreshActions: function () {
      if (!this.root || this.busy) return;
      var confirm = this.$('#pkConfirm');
      var join = this.$('#pkJoinGo');
      if (confirm) confirm.disabled = !this.checkCode(this.$('#pkReplyIn').value).ok;
      if (join) join.disabled = !this.checkCode(this.$('#pkInviteIn').value).ok;
    },

    setBusy: function (btn, on, label) {
      if (!btn) return;
      if (on) {
        btn.disabled = true;
        btn.innerHTML = '<span class="pk-spinner"></span>' + label + '…';
      } else {
        btn.disabled = false;
        btn.textContent = label;
      }
    },

    /* ---------------- 大厅 ---------------- */
    renderLobby: function () {
      if (!this.root) return;
      var isHost = this.role === 'host';
      this.$('#pkMeAvatar').textContent = this.avatar;
      this.$('#pkMeName').textContent = this.name || '我';
      this.$('#pkMeRole').textContent = isHost ? '房主' : '客人';
      this.$('#pkMeRole').className = 'pk-rolechip ' + (isHost ? 'host' : 'guest');
      this.$('#pkPeerAvatar').textContent = this.peerName ? avatarFor(this.peerName) : '🐼';
      this.$('#pkPeerName').textContent = this.peerName || '等待对方…';
      this.$('#pkPeerRole').textContent = isHost ? '客人' : '房主';
      this.$('#pkPeerRole').className = 'pk-rolechip ' + (isHost ? 'guest' : 'host');

      var net = this.$('#pkNetText');
      var dot = this.$('#pkNetDot');
      if (this.rtt == null) {
        net.textContent = '延迟 — · 时钟对齐中…';
        dot.className = 'pk-dot pk-dot--warn pk-dot--live';
      } else {
        var quality = this.rtt < 80 ? 'ok' : (this.rtt < 200 ? 'warn' : 'err');
        net.textContent = '延迟 ' + this.rtt + 'ms · ' + (this.clockReady ? '时钟已对齐' : '对齐中');
        dot.className = 'pk-dot pk-dot--' + quality;
      }

      this.$$('#pkModeChips .pk-chip').forEach(function (c) {
        c.classList.toggle('readonly', !isHost);
      });

      var start = this.$('#pkStart');
      var clockHint = this.$('#pkClockHint');
      clockHint.classList.toggle('on', isHost && !this.clockReady);
      if (isHost) {
        start.disabled = !this.clockReady;
        start.textContent = this.clockReady ? '开始对战' : '对齐时钟…';
        start.style.display = '';
      } else {
        start.disabled = true;
        start.textContent = '等待房主开始…';
        start.style.display = '';
      }
    },

    /* ---------------- 对局 ---------------- */
    startMatch: function () {
      if (!this.vs || this.role !== 'host') return;
      var self = this;
      this.vs.startMatch({
        // mode 只决定胜负怎么判（race 比用时 / distance 比距离）；
        // 具体是 2000 米还是 3 分钟，走 options.matchMode 原样带给宿主
        mode: this.judgeModeOf(this.mode),
        options: { matchMode: this.mode },
        countdownMs: this.countdownMs
      }).catch(function (err) {
        self.toast('开始失败：' + (err && err.message || err), 'err');
      });
    },

    // 大厅里的模式 id 是给玩家看的（d2000 / t60），胜负判定只认 race / distance
    judgeModeOf: function (id) {
      var m = (this.modes || []).filter(function (x) { return x.id === id; })[0];
      return (m && m.judge) || 'race';
    },

    beginRace: function (e) {
      clearTimeout(this._linkTimer);
      this.result = null;
      this.rematch = 'idle';
      this.race = {
        seed: e.seed,
        mode: e.mode,
        startAt: e.startAtLocal,
        goal: this.goal,
        me: 0,
        peer: 0,
        peerAt: 0,
        peerSpeed: 13,
        peerSlow: false,
        slowUntil: 0,
        done: false
      };
      this.log('对局开始 seed=' + e.seed + ' 模式=' + e.mode, 'ok');
      this.$('#pkMeBar').style.transform = 'scaleX(0)';
      this.$('#pkPeerBar').style.transform = 'scaleX(0)';
      this.$('#pkMeM').textContent = '0m';
      this.$('#pkPeerM').textContent = '0m';
      this.$('#pkTimer').textContent = '—';
      this.$('#pkGap').textContent = '—';
      this.$('#pkGap').className = 'pk-hud-gap';
      this.$('#pkHud').classList.remove('racing');
      this.$('#pkCountSub').textContent = this.peerName ? ('对手：' + this.peerName) : '准备…';
      this.setScreen('countdown');
      this.$('#pkCountdown').classList.add('on');
      this.startLoop();
    },

    endRace: function (e) {
      if (this.race) this.race.done = true;
      this.stopLoop();
      var myRes = null, peerRes = null;
      if (e.results) {
        myRes = this.role === 'host' ? e.results.host : e.results.guest;
        peerRes = this.role === 'host' ? e.results.guest : e.results.host;
      }
      if ((!myRes || !peerRes) && this.race) {
        var snap = { distance: Math.round(this.race.me), score: 0, timeMs: null, dnf: false };
        var snapPeer = { distance: Math.round(this.race.peer), score: 0, timeMs: null, dnf: false };
        myRes = myRes || snap;
        peerRes = peerRes || snapPeer;
      }
      this.result = {
        iWin: !!e.iWin,
        draw: !!e.draw,
        reason: e.reason,
        my: myRes,
        peer: peerRes,
        mode: this.race ? this.race.mode : this.mode
      };
      this.log('终局 ' + (e.draw ? '平局' : e.iWin ? '胜' : '负') + ' · ' + e.reason, 'ok');
      this.setScreen('result');
      this.renderResult();
    },

    renderResult: function () {
      var raceVal = function (res) {
        if (!res) return '—';
        if (res.timeMs != null) return fmtSec(res.timeMs);
        if (res.distance) return Math.round(res.distance) + 'm';
        return '—';
      };
      if (!this.root || !this.result) return;
      var r = this.result;
      var badge = this.$('#pkResultBadge');
      var title = this.$('#pkResultTitle');
      var sub = this.$('#pkResultSub');

      badge.textContent = r.draw ? '🤝' : (r.iWin ? '🏆' : '💀');
      title.textContent = r.draw ? '平局' : (r.iWin ? '你赢了' : '你输了');
      title.className = 'pk-result-title ' + (r.draw ? 'draw' : (r.iWin ? 'win' : 'lose'));

      var byDistance = r.mode === 'distance';
      var reasonMap = {
        finish: r.draw ? '双方成绩相同'
          : (byDistance
              ? (r.iWin ? '你比对方跑得更远' : '对方比你跑得更远')
              : (r.iWin ? '你比对方先到终点' : '对方比你先到终点')),
        disconnect: '对方掉线，判你胜' + (r.iWin ? '' : ''),
        fallback: '房主未响应，本地判定'
      };
      if (r.reason === 'disconnect') {
        sub.textContent = r.iWin ? '对方断开了连接' : '连接断开，判对方胜';
      } else {
        sub.textContent = reasonMap[r.reason] || '对局结束';
      }

      var mode = r.mode || 'race';
      var myVal, peerVal;
      if (mode === 'race') {
        myVal = raceVal(r.my);
        peerVal = raceVal(r.peer);
      } else if (mode === 'score') {
        myVal = (r.my && r.my.score || 0) + ' 分';
        peerVal = (r.peer && r.peer.score || 0) + ' 分';
      } else {
        myVal = Math.round((r.my && r.my.distance) || 0) + 'm';
        peerVal = Math.round((r.peer && r.peer.distance) || 0) + 'm';
      }
      var myDnf = r.my && r.my.dnf;
      var peerDnf = r.peer && r.peer.dnf;
      if (myDnf) myVal = '未完成';
      if (peerDnf) peerVal = '未完成';

      var rows = [
        {
          av: this.avatar, name: this.name || '我', val: myVal,
          win: !r.draw && r.iWin, note: '我'
        },
        {
          av: this.peerName ? avatarFor(this.peerName) : '🐼',
          name: this.peerName || '对方', val: peerVal,
          win: !r.draw && !r.iWin, note: '对方'
        }
      ];
      this.$('#pkScore').innerHTML = rows.map(function (row) {
        return '<div class="pk-score-row' + (row.win ? ' win' : '') + '">' +
          '<span class="pk-score-av">' + row.av + '</span>' +
          '<span class="pk-score-name">' + esc(row.name) + '</span>' +
          '<span class="pk-score-note">' + row.note + '</span>' +
          '<span class="pk-score-val">' + esc(row.val) + '</span>' +
          '</div>';
      }).join('');

      this.renderRematch();

      if (r.offline) {
        var again = this.$('#pkAgain');
        again.disabled = true;
        again.textContent = '对方已离线';
        this.$('#pkBackLobby').textContent = '返回首页';
        this.$('#pkExit').style.display = 'none';
      } else {
        this.$('#pkExit').style.display = '';
        this.$('#pkBackLobby').textContent = '回到大厅';
      }
    },

    renderRematch: function () {
      if (!this.root) return;
      var bar = this.$('#pkRematchBar');
      var again = this.$('#pkAgain');
      if (this.rematch === 'peerAsk') {
        bar.className = 'pk-rematch on';
        bar.innerHTML = '对方想再来一局<div class="pk-row">' +
          '<button class="pk-btn pk-btn--gold pk-btn--sm" id="pkAccept">应战</button>' +
          '<button class="pk-btn pk-btn--ghost pk-btn--sm" id="pkDecline">稍后</button></div>';
        var self = this;
        var a = this.$('#pkAccept');
        var d = this.$('#pkDecline');
        if (a) a.onclick = function () { self.askRematch(); };
        if (d) d.onclick = function () { bar.className = 'pk-rematch'; bar.innerHTML = ''; self.rematch = 'idle'; };
        again.style.display = 'none';
      } else if (this.rematch === 'waiting') {
        bar.className = 'pk-rematch on';
        bar.innerHTML = '<span class="pk-spinner" style="display:inline-block;vertical-align:-3px;margin-right:6px"></span>等待对方确认…';
        again.style.display = 'none';
      } else {
        bar.className = 'pk-rematch';
        bar.innerHTML = '';
        again.style.display = '';
        again.disabled = false;
        again.textContent = '再来一局';
      }
    },

    askRematch: function () {
      if (!this.vs) return;
      if (this.vs.requestRematch()) {
        this.rematch = 'waiting';
        this.renderRematch();
      } else {
        this.toast('当前无法再战', 'err');
      }
    },

    leave: function () {
      if (this.vs) {
        try { this.vs.leave(); } catch (e) { /* noop */ }
        this.vs = null;
      }
      clearTimeout(this._linkTimer);
      this.race = null;
      this.result = null;
      this.rematch = 'idle';
      this.clockReady = false;
      this.rtt = null;
      this.setScreen('identity');
      this.log('已离开房间');
      this.toast('已离开房间');
    },

    /* ---------------- HUD ---------------- */
    startLoop: function () {
      var self = this;
      this.stopLoop();
      var step = function () {
        self._raf = requestAnimationFrame(step);
        self.tick();
      };
      this._raf = requestAnimationFrame(step);
    },

    stopLoop: function () {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
    },

    tick: function () {
      if (!this.vs || !this.race) return;
      var t = this.vs.timeToStart();

      if (this.screen === 'countdown') {
        if (t > 0) {
          var n = Math.ceil(t / 1000);
          var num = this.$('#pkCountNum');
          if (num.textContent !== String(n)) {
            num.textContent = String(n);
            num.className = 'pk-count-num';
            void num.offsetWidth;
            num.className = 'pk-count-num';
          }
        } else {
          var go = this.$('#pkCountNum');
          if (go.textContent !== 'GO!') {
            go.textContent = 'GO!';
            go.className = 'pk-count-num go';
          }
          this.screen = 'race';
          this.$('#pkHud').classList.add('racing');
          this.$('#pkCountdown').classList.add('on');
          var self = this;
          setTimeout(function () {
            if (self.screen === 'race') self.$('#pkCountdown').classList.remove('on');
          }, 520);
        }
      }

      if (this.screen === 'race' && !this.race.done) {
        var el = Date.now() - this.race.startAt;
        if (this.race.timeLimit) {
          // 计时赛：显示还剩多久，比"已用 43.2s"有用得多
          var left = Math.max(0, this.race.timeLimit - el);
          var sec = Math.ceil(left / 1000);
          this.$('#pkTimer').textContent = '剩 ' + Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
        } else {
          this.$('#pkTimer').textContent = (Math.max(0, el) / 1000).toFixed(1) + 's';
        }
      }

      this.renderHud();
      this.renderAttackBtn();
    },

    renderHud: function () {
      if (!this.root || !this.race) return;
      var goal = this.race.goal || this.goal;
      var me = clamp(this.race.me, 0, goal);
      var peerNow = this.race.peerAt
        ? clamp(this.race.peer + (performance.now() - this.race.peerAt) / 1000 * this.race.peerSpeed, 0, goal)
        : 0;
      this.$('#pkMeBar').style.transform = 'scaleX(' + (me / goal) + ')';
      this.$('#pkPeerBar').style.transform = 'scaleX(' + (peerNow / goal) + ')';
      this.$('#pkMeM').textContent = Math.round(me) + 'm';
      this.$('#pkPeerM').textContent = Math.round(peerNow) + 'm';

      var gap = Math.round(me - peerNow);
      var gapEl = this.$('#pkGap');
      if (this.screen === 'countdown' || (!this.race.me && !this.race.peer)) {
        gapEl.textContent = '—';
        gapEl.className = 'pk-hud-gap';
      } else if (Math.abs(gap) < 2) {
        gapEl.textContent = '并驾齐驱';
        gapEl.className = 'pk-hud-gap';
      } else if (gap > 0) {
        gapEl.textContent = '领先 ' + gap + 'm';
        gapEl.className = 'pk-hud-gap lead';
      } else {
        gapEl.textContent = '落后 ' + (-gap) + 'm';
        gapEl.className = 'pk-hud-gap behind';
      }
    },

    renderAttackBtn: function () {
      var btn = this.$('#pkAttack');
      if (!btn) return;

      // 宿主接管：道具槽。get() 返回 {ready, icon, name, tip, progress, left}
      var slot = this.opts.item;
      if (slot && slot.get) {
        var st = slot.get() || {};
        if (st.ready) {
          btn.classList.add('ready');
          btn.classList.remove('charging');
          btn.disabled = false;
          if (this._slotKey !== 'r' + st.icon) {
            this._slotKey = 'r' + st.icon;
            btn.innerHTML = '<span class="pk-slot-ico">' + (st.icon || '🎁') + '</span>';
          }
          btn.title = (st.name || '道具') + '：' + (st.tip || '') + '（点击投掷）';
        } else {
          btn.classList.add('charging');
          btn.classList.remove('ready');
          btn.disabled = false;
          btn.title = '道具充能中：再跑 ' + Math.round(st.left || 0) + ' m';
          var pct = Math.round((st.progress || 0) * 100);
          var key = 'c' + pct;
          if (this._slotKey !== key) {
            this._slotKey = key;
            btn.innerHTML = '<span class="pk-slot-pct">' + pct + '%</span>' +
              '<i class="pk-slot-bar"><b style="width:' + pct + '%"></b></i>';
          }
        }
        return;
      }

      var left = this._attackCd - Date.now();
      if (left > 0) {
        btn.disabled = true;
        btn.textContent = Math.ceil(left / 1000) + 's';
      } else {
        btn.disabled = false;
        btn.textContent = '⚡';
      }
    },

    // 点道具槽：宿主接管走 host.fire()，否则退回插件自带的一次减速
    useItem: function () {
      var slot = this.opts.item;
      if (slot && slot.fire) {
        slot.fire();
        this._slotKey = '';
        this.renderAttackBtn();
        return;
      }
      this.attack();
    },

    attack: function () {
      if (!this.vs || !this.race || this.race.done) return;
      if (this._attackCd > Date.now()) return;
      if (this.vs.sendGameEvent('attack', { kind: 'slow', ms: 2000 })) {
        this._attackCd = Date.now() + 6000;
        this.toast('⚡ 已干扰对方', 'ok');
        this.log('发送干扰事件');
      }
    },

    /* ---------------- 对外 API ---------------- */
    sendProgress: function (state) {
      if (!this.vs) return false;
      if (this.race && !this.race.done) {
        this.race.me = +state.distance || 0;
        this.race.slow = Date.now() < this.race.slowUntil;
        this.renderHud();
      }
      return this.vs.sendProgress(state);
    },

    reportResult: function (res) {
      if (!this.vs) return false;
      if (this.race) this.race.done = true;
      var ok = this.vs.reportResult(res);
      if (ok) this.log('已上报成绩 ' + JSON.stringify(res));
      return ok;
    },

    sendGameEvent: function (type, data) {
      return this.vs ? this.vs.sendGameEvent(type, data) : false;
    },

    timeToStart: function () {
      return this.vs ? this.vs.timeToStart() : 0;
    },

    info: function () {
      return this.vs ? this.vs.info() : null;
    },

    setBridge: function (on) {
      this.bridgeOn = !!on;
      var chk = this.root && this.$('#pkBridgeChk');
      if (chk) chk.checked = this.bridgeOn;
    }
  };

  /* ==================================================================
     导出
     ================================================================== */
  global.PKVS_Lobby = {
    version: VERSION,
    create: function (opts) { return new Lobby(opts); },
    Lobby: Lobby,
    avatars: AVATARS
  };

})(typeof window !== 'undefined' ? window : this);
